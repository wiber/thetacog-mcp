#!/usr/bin/env node
// scripts/ops/safari-tidy.mjs — /mem's Safari arm. Operator 2026-10-22, verbatim: "kill safari tabs that seem superflous (close
// them)" · "make it part of /mem - we can be more aggressive, its very unlikely any process (that is not an l1 walk) slowing the
// system is beneficial". Measured that day: 112 tabs in 23 windows, swap 98 %, 17,472 swap-ins/s; closing 58 superfluous tabs
// took swap 30.3 → 24.1 GB, and two Safari WebContent processes (3.2 GB at 84 % CPU, 159 h; 72 % CPU) held the rest of the load.
//
// Two moves, both only while the machine is SLOW (mem.mjs isSlow or ≥ 1000 swap-ins/s), both under --reap:
//   (1) CLOSE SUPERFLUOUS TABS — a rule a stranger could check, never a judgment about content: an exact duplicate of a tab already
//       open (the first copy stays), an empty tab, a Start Page, a blank Gemini or Notebook home, a past calendar day, a Meet home,
//       an empty Claude chat, a /tmp preview, a TD-AUTO notification email. Every closed URL goes to .thetacog/safari-closed.ndjson
//       so any tab can be reopened.
//   (2) STOP A HEAVY TAB — a Safari-owned WebContent process at ≥ HEAVY_TAB_MB footprint and ≥ HEAVY_TAB_AGE_S old. The tab stays
//       ("this webpage was reloaded"); its memory comes back. The owner is read off lsappinfo, so Raycast/NordVPN/Mail web views
//       are never touched. An L1 walk (pmu-onchip) is never a WebContent process, so nothing here can reach it.
// Guard: tests/ops/safari-tidy.test.mjs.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CLOSED_LEDGER = resolve(REPO, '.thetacog/safari-closed.ndjson');
export const HEAVY_TAB_MB = 1500;
export const HEAVY_TAB_AGE_S = 12 * 3600;
export const WEBCONTENT = /\/com\.apple\.WebKit\.WebContent\.xpc\/Contents\/MacOS\/com\.apple\.WebKit\.WebContent$/;

const EMPTY_URL = [/^missing$/, /^favorites:/, /^about:blank$/, /^https:\/\/gemini\.google\.com\/app\/?$/, /^https:\/\/notebook\.google\.com\/?$/,
  /^https:\/\/notebook\.google\.com\/search/, /^https:\/\/meet\.google\.com\/home/, /^https:\/\/claude\.ai\/new$/, /^file:\/\/\/private\/tmp\//];
const NOTIFICATION_NAME = [/\[TD-AUTO\]/];

/** pure: a past calendar day page (calendar.google.com/.../r/day/YYYY/MM/DD before today, or the bare day view titled with a past date) */
export function pastCalendarDay(t, today) {
  if (!/calendar\.google\.com/.test(t.u)) return false;
  const m = t.u.match(/\/r\/day\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` < today;
  const n = t.n.match(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/);
  if (!n) return false;
  const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(n[1]) + 1;
  return `${n[3]}-${String(mo).padStart(2, '0')}-${n[2].padStart(2, '0')}` < today;
}

/** pure: tabs [{w, t, n, u}] in window order → the superfluous ones with their reason. The first copy of any URL stays. */
export function superfluousTabs(tabs, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const seen = new Set(), out = [];
  for (const x of tabs) {
    const key = String(x.u);   // the whole URL: Gmail and Sheets route by the hash, so two threads differ only after #
    let why = null;
    if (EMPTY_URL.some(r => r.test(x.u))) why = 'empty tab';
    else if (NOTIFICATION_NAME.some(r => r.test(x.n))) why = 'notification email';
    else if (pastCalendarDay(x, today)) why = 'past calendar day';
    else if (seen.has(key)) why = 'duplicate';
    seen.add(key);
    if (why) out.push({ ...x, why });
  }
  return out;
}

/** pure: ps rows with footprint mb + owner names → the heavy Safari tabs to stop */
export function heavyTabs(rows, ownerOf) {
  return rows.filter(r => WEBCONTENT.test(r.cmd) && r.mb >= HEAVY_TAB_MB && r.age >= HEAVY_TAB_AGE_S)
    .filter(r => /^Safari\b/.test(ownerOf(r.pid) || ''));
}

export function ownerOf(pid) {
  const asn = (spawnSync('lsappinfo', ['info', '-only', 'parentasn', String(pid)], { encoding: 'utf8', timeout: 5000 }).stdout || '').match(/ASN:[^"]*/)?.[0];
  if (!asn) return null;
  return (spawnSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8', timeout: 5000 }).stdout || '').match(/"LSDisplayName"="([^"]*)"/)?.[1] || null;
}

const SEP = '@@';
export function readSafariTabs() {
  if (spawnSync('pgrep', ['-x', 'Safari']).status !== 0) return [];
  const as = `set out to ""
tell application "Safari"
  repeat with w in windows
    set wid to id of w
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set u to URL of t
      if u is missing value then set u to "missing"
      set out to out & wid & "${SEP}" & ti & "${SEP}" & (name of t) & "${SEP}" & u & linefeed
    end repeat
  end repeat
end tell
return out`;
  const r = spawnSync('osascript', ['-e', as], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return null;
  return r.stdout.trim().split('\n').filter(Boolean).map(l => { const [w, t, n, u] = l.split(SEP); return { w, t: +t, n, u }; });
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
/** close the given tabs, highest index first per window, each only if its URL still matches; ledger every close */
export function closeTabs(list) {
  if (!list.length) return 0;
  const by = {}; for (const x of list) (by[x.w] ||= []).push(x);
  let as = 'tell application "Safari"\nset n to 0\n';
  for (const w of Object.keys(by)) for (const x of by[w].sort((a, b) => b.t - a.t))
    as += `try\nset t to tab ${x.t} of (first window whose id is ${w})\nset uu to URL of t\nif uu is missing value then set uu to "missing"\nif uu is "${q(x.u)}" then\nclose t\nset n to n + 1\nend if\nend try\n`;
  as += 'return n\nend tell';
  const r = spawnSync('osascript', ['-e', as], { encoding: 'utf8', timeout: 60000 });
  const n = Number(r.stdout.trim()) || 0;
  mkdirSync(dirname(CLOSED_LEDGER), { recursive: true });
  const ts = new Date().toISOString();
  for (const x of list) appendFileSync(CLOSED_LEDGER, JSON.stringify({ ts, why: x.why, name: x.n, url: x.u }) + '\n');
  return n;
}

// a zombie (Z) has exited and holds no memory — its parent has not reaped it yet, so kill(pid, 0) still answers
const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } return !/^Z/.test((spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim()); };
/** TERM, wait, then KILL what is still alive — measured 2026-10-22: WebContent ignores TERM ("stopped 6" left the 2.5 GB and 2.1 GB
 *  tabs running). Counts only processes verified gone; ledgers each to .thetacog/mem-reaps.ndjson. */
export function stopTabs(heavy, { waitMs = 3000 } = {}) {
  for (const h of heavy) { try { process.kill(h.pid, 'SIGTERM'); } catch {} }
  if (heavy.length) spawnSync('sleep', [String(waitMs / 1000)]);
  let n = 0; const ts = new Date().toISOString();
  for (const h of heavy) {
    let signal = 'TERM';
    if (alive(h.pid)) { try { process.kill(h.pid, 'SIGKILL'); signal = 'KILL'; } catch {} spawnSync('sleep', ['1']); }
    const gone = !alive(h.pid); if (gone) n++;
    appendFileSync(resolve(REPO, '.thetacog/mem-reaps.ndjson'), JSON.stringify({ ts, pid: h.pid, ageS: h.age, mb: Math.round(h.mb), signal, stopped: gone, why: `heavy Safari tab ≥ ${HEAVY_TAB_MB} MB and ≥ ${HEAVY_TAB_AGE_S / 3600} h (safari-tidy)`, cmd: h.cmd }) + '\n');
  }
  return n;
}

/** /mem's call: read, decide, act (only when reap && slow). Returns a line for the report. */
export function tidy({ reap = false, slow = false, rows = [] } = {}) {
  const tabs = readSafariTabs();
  if (tabs === null) return { line: 'SAFARI  tabs UNMEASURED (osascript refused — Automation permission for Safari)' };
  const extra = superfluousTabs(tabs);
  const heavy = heavyTabs(rows, ownerOf);
  let closed = 0, stopped = 0;
  if (reap && slow) {
    closed = closeTabs(extra);
    stopped = stopTabs(heavy);
  }
  const act = reap && slow ? `closed ${closed}, stopped ${stopped} heavy` : (slow ? 'run with --reap to close and stop' : 'not slow — nothing touched');
  return { line: `SAFARI  ${tabs.length} tabs · ${extra.length} superfluous · ${heavy.length} heavy (≥ ${HEAVY_TAB_MB} MB, ≥ ${HEAVY_TAB_AGE_S / 3600} h) · ${act}`, extra, heavy, closed, stopped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t = readSafariTabs() || [];
  for (const x of superfluousTabs(t)) console.log(`${x.why.padEnd(20)} ${x.n.slice(0, 90)}`);
}
