#!/usr/bin/env node
// scripts/vna/worker-holds.mjs — C2342: /STEER WORKERS COORDINATE THROUGH THE CLAIMS AND NEVER STEP ON EACH OTHER.
//
// The incident (2026-11-05, the asks ledger's C2362 note): parallel -p workers share one tree, and a worker's commit swept
// another live worker's uncommitted files under its own message (bd7c69a721, C2360, carried C2362's code), so the witness
// read green-on-parent and the placement was wrong. The claims existed (scripts/ops/wip.mjs) but no worker made one, and
// the runner's only claim was a cap hit's debris. This module is the coordination door, one call line per runner step:
//
//   holdEnv        the worker's claim identity, set in its env: WIP_CLAIM_SESSION = steer-<dispatch id> (two workers of
//                  one parent session read FOREIGN to each other) and WIP_CLAIM_PID = the runner's pid (lives as long as the
//                  worker; a -p worker inherits its parent's CLAUDE_PID, so its own claims would read stale at once, C1255)
//   holdsBrief     the brief block: claim before the first edit (wip.mjs claim, the dispatch id stamped), the files other
//                  live workers hold right now, and commit only the claimed paths with git commit --only
//   atDispatch     the dispatch row's `holds_others` — every live foreign claim at brief time, grouped by holder
//   atClose        the worker row's `holds` (what it claimed) and `overlap` (its claims ∩ a live foreign hold), with the
//                  disposition DISPATCHED — told which files are taken, never blocked
//   withHoldsColumn the run tab's HOLDS column (live claims by row label, else the holds the runner last recorded)
//   sweepRate      the measure for scripts/vna/mission-measures.mjs: of the verdicts (worker rows with a `work` commit), how
//                  many touched a file another LIVE worker held. Rows that carry `holds_others` read those (the claims, the
//                  thing itself); older rows read the declared proxy below and say so.
//
// THE PROXY, NAMED (pre-C2342 rows carry no claims): what another worker O "held" during its live window is the files it
// declared before working (its C2347 called shot) plus the files its own Steer-Dispatch-trailer commits touched. Files every
// worker shares by design (the spec it ticks, the ledgers) never count. It undercounts a full sweep where O neither declared
// nor committed the file, so the baseline is a floor on the true rate, never an overcount.
// Never a gate: a throw reads UNMEASURED, a held file is told, never refused.
// MAXIMISE RUST: sweepRate DECIDES a band once floored — its port is filed beside C2349's ("THOUGHT: C2349 port").
// @guard tests/vna/c2342-chair-decomposition-of-the-operator-s.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listClaims } from '../ops/wip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const holdSession = (dispatchId) => `steer-${dispatchId}`;
export const claimDir = (repo = REPO) => process.env.WIP_CLAIM_DIR || join(repo, '.thetacog', 'wip-claims');
// files every worker writes by design — the spec it ticks, append-only ledgers, generated state — never a sweep
export const SHARED_BY_DESIGN = [/^docs\/specs\/vna\/SPEC-VNA-COCKPIT\.md$/, /^\.thetacog\//, /\.ndjson$/, /^docs\/pmu\/commit-panels\//, /^data\/vna\/steer-compiled\.json$/];
export const isShared = (p) => SHARED_BY_DESIGN.some((re) => re.test(String(p)));

/** the env a worker runs under so its own wip.mjs claims carry its identity */
export function holdEnv({ dispatchId, pid = process.pid } = {}) {
  return dispatchId ? { WIP_CLAIM_SESSION: holdSession(dispatchId), WIP_CLAIM_PID: String(pid) } : {};
}

/** live claims grouped by holder: [{ session, dispatch_id, label, paths }] — own session excluded */
export function liveHolds({ repo = REPO, exceptSession = null, list = (o) => listClaims(o) } = {}) {
  const by = new Map();
  for (const c of list({ dir: claimDir(repo) })) {
    if (!c || !c.live || (exceptSession && c.session === exceptSession)) continue;
    const k = c.session; if (!by.has(k)) by.set(k, { session: k, dispatch_id: c.dispatch_id || null, label: c.label || null, paths: [] });
    by.get(k).paths.push(c.path);
  }
  return [...by.values()].map((h) => ({ ...h, paths: [...new Set(h.paths)].sort() }));
}

/** the brief block — the claim instruction always, the other workers' held files when any */
export function holdsBrief({ label, dispatchId, holds = [] } = {}) {
  const taken = holds.filter((h) => h.paths.length);
  const lines = [
    `HOLDS (C2342): other workers share this tree right now. Before your FIRST edit, claim every file you will touch: node scripts/ops/wip.mjs claim <paths> --note "${label}${dispatchId ? ` ${dispatchId}` : ''}" (your claim identity is already set in your environment; claim each new file the moment you find you need it). Commit ONLY your claimed paths with git commit --only <paths>, then release them: node scripts/ops/wip.mjs release <paths>.`,
    taken.length
      ? `Files other live workers hold — do not edit them; if ${label} needs one, finish what you can without it and name the file in the debrief's left-open line:\n${taken.map((h) => `  ${h.label || h.session}${h.dispatch_id ? ` (${h.dispatch_id})` : ''}: ${h.paths.join(', ')}`).join('\n')}`
      : 'Files other live workers hold: none right now — claim yours anyway, the next worker reads them.',
  ];
  return lines.join('\n');
}

/** the dispatch row's field */
export function atDispatch({ repo = REPO, dispatchId, list } = {}) {
  try { return { holds_others: liveHolds({ repo, exceptSession: dispatchId ? holdSession(dispatchId) : null, ...(list ? { list } : {}) }) }; }
  catch (e) { return { holds_others: null, holds_why: `claims unreadable: ${String(e && e.message || e).slice(0, 100)}` }; }
}

/** the worker row's fields: what this worker claimed, and where that met a live foreign hold */
export function atClose({ repo = REPO, dispatchId, others = [], list } = {}) {
  try {
    const all = (list || ((o) => listClaims(o)))({ dir: claimDir(repo) }).filter(Boolean);
    const mine = [...new Set(all.filter((c) => dispatchId && c.session === holdSession(dispatchId)).map((c) => c.path))].sort();
    const nowOthers = liveHolds({ repo, exceptSession: dispatchId ? holdSession(dispatchId) : null, list: () => all });
    const held = new Map(); for (const h of [...(others || []), ...nowOthers]) for (const p of h.paths) if (!held.has(p)) held.set(p, h.label || h.session);
    const overlap = mine.filter((p) => held.has(p) && !isShared(p)).map((p) => ({ path: p, held_by: held.get(p) }));
    return { holds: mine, holds_others_close: nowOthers, overlap, overlap_disposition: overlap.length ? 'DISPATCHED — told which files were taken, never blocked' : null };
  } catch (e) { return { holds: null, holds_why: `claims unreadable: ${String(e && e.message || e).slice(0, 100)}` }; }
}

// ── the run tab's HOLDS column (board-steer.mjs composeRun) ────────────────────────────────────────────────────────────
/** Map<label, cell>: a live claim stamped with the label first ("LIVE …"), else the last holds the runner recorded for it */
export function holdsByLabel({ repo = REPO, list = (o) => listClaims(o), ledger = resolve(repo, '.thetacog/runner.ndjson'), tailBytes = 1 << 21 } = {}) {
  const out = new Map();
  try {
    let txt = ''; try { const b = readFileSync(ledger); txt = b.subarray(Math.max(0, b.length - tailBytes)).toString('utf8'); } catch { /* no ledger reads as none recorded */ }
    for (const l of txt.split('\n')) { let r; try { r = JSON.parse(l); } catch { continue; } if (r && r.label && (r.kind === 'worker' || r.kind === 'verdict') && Array.isArray(r.holds) && r.holds.length) out.set(r.label, `held ${r.holds.join(', ')} (${String(r.at || '').slice(0, 16)}Z)`); }
    const live = new Map(); for (const c of list({ dir: claimDir(repo) })) if (c && c.live && c.label) { if (!live.has(c.label)) live.set(c.label, []); live.get(c.label).push(c.path); }
    for (const [k, ps] of live) out.set(k, `LIVE ${[...new Set(ps)].sort().join(', ')}`);
  } catch { /* a reading, never a gate */ }
  return out;
}
/** the grid with a HOLDS column after the header's last column; rows with no hold read 'none' */
export function withHoldsColumn(grid, byLabel = new Map()) {
  const h = grid.findIndex((r) => Array.isArray(r) && r[0] === 'ID' && r.includes('COMMENT (fill)'));
  if (h < 0) return grid;
  return grid.map((r, i) => (i < h ? r : i === h ? [...r, 'HOLDS'] : [...r, byLabel.get(r[0]) || 'none']));
}

// ── the measure ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** every Steer-Dispatch trailer's files off one git log read: Map<dispatch_id, Set<path>> */
export function trailerFiles({ repo = REPO, since = null } = {}) {
  const out = new Map();
  let raw = ''; try { raw = execFileSync('git', ['log', ...(since ? [`--since=${since}`] : ['-n', '3000']), '--format=%x00%B%x01', '--name-only'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return out; }
  for (const chunk of raw.split('\x00').slice(1)) {
    const [body, files = ''] = chunk.split('\x01');
    const ids = [...body.matchAll(/^Steer-Dispatch: (\S+)\s*$/gm)].map((m) => m[1]);
    const fs = files.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const id of ids) { if (!out.has(id)) out.set(id, new Set()); for (const f of fs) out.get(id).add(f); }
  }
  return out;
}

/** sweep rate — pure over the runner rows and a dispatch→files map. Lower is better. */
export function sweepRate({ rows = [], files = new Map(), underN = 10 } = {}) {
  const start = new Map(); for (const r of rows) if (r.kind === 'dispatch' && r.dispatch_id && !start.has(r.dispatch_id)) start.set(r.dispatch_id, Date.parse(r.at));
  const closes = new Map(); for (const r of rows) if ((r.kind === 'worker' || r.kind === 'verdict') && r.dispatch_id && r.door !== 'chat') closes.set(r.dispatch_id, { ...(closes.get(r.dispatch_id) || {}), ...r });
  const win = (r) => { const t1 = Date.parse(r.at); const t0 = start.get(r.dispatch_id) ?? (Number.isFinite(r.ms) ? t1 - r.ms : t1); return [t0, t1]; };
  const ownFiles = (r) => new Set([...(files.get(r.dispatch_id) || []), ...((r.called_shot && Array.isArray(r.called_shot.files)) ? r.called_shot.files : []), ...(Array.isArray(r.holds) ? r.holds : [])].filter((p) => !isShared(p)));
  const all = [...closes.values()];
  const verdicts = all.filter((r) => r.work);
  const swept = []; let claimsRead = 0;
  for (const w of verdicts) {
    const touched = new Set([...(files.get(w.dispatch_id) || [])].filter((p) => !isShared(p)));
    if (!touched.size) continue;
    let hit = null;
    if (Array.isArray(w.holds_others)) {   // C2342 rows: the claims themselves
      claimsRead++;
      for (const h of [...w.holds_others, ...(w.holds_others_close || [])]) for (const p of h.paths || []) if (touched.has(p) && !isShared(p)) { hit = { path: p, held_by: h.label || h.session, via: 'claim' }; break; }
    } else {
      const [a0, a1] = win(w);
      for (const o of all) {
        if (o === w || o.label === w.label || !o.dispatch_id) continue;
        const [b0, b1] = win(o); if (!(b0 < a1 && a0 < b1)) continue;   // live at the same time
        for (const p of ownFiles(o)) if (touched.has(p)) { hit = { path: p, held_by: o.label, via: 'proxy' }; break; }
        if (hit) break;
      }
    }
    if (hit) swept.push({ label: w.label, dispatch_id: w.dispatch_id, work: String(w.work).slice(0, 10), ...hit });
  }
  const n = verdicts.length;
  return { num: swept.length, den: n, n, value: n ? swept.length / n : null, state: !n ? 'UNMEASURED' : n < underN ? 'UNDERPOWERED' : 'measured', swept, claims_read: claimsRead, proxy_read: n - claimsRead };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const a2 = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const day = a2('--day') || new Date().toISOString().slice(0, 10);
  const path = a2('--runner') || resolve(REPO, '.thetacog/runner.ndjson');
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && String(r.at || '').startsWith(day));
  const s = sweepRate({ rows, files: trailerFiles({ since: `${day}T00:00:00Z` }) });
  if (argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else { console.log(`sweep rate ${day}: ${s.num}/${s.den} = ${s.value == null ? '—' : s.value.toFixed(3)} (${s.state}; ${s.claims_read} read off claims, ${s.proxy_read} off the declared proxy)`); for (const x of s.swept) console.log(`  ${x.label} ${x.work} touched ${x.path} — held by ${x.held_by} (${x.via})`); }
}
