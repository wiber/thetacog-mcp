#!/usr/bin/env node
// scripts/ops/board-lead-quality.mjs — LEAD QUALITY ON THE PEOPLE TAB: renders, and how fast they come after the send.
// Operator 2026-10-19, verbatim: "more stats for people? I must know quality of elads sorted by - renders, vega on renders from
// hour of send, etc".
//
// THE MEASURED OBJECT: a T3 render — a page that RAN in the reader's browser and carried the reader's own signed token (the same
// event rank-readers-t3.mjs counts; a click a gateway pre-fetched never counts). Per address, off the record:
//   RENDERS · RENDER DAYS · LAST RENDER   — rank-readers-t3's own aggregation (rankReaders), never re-derived
//   RENDER SHAPE                           — machine (its own flag: renders per active day above the lab's setting), else
//                                            the median hours-to-render as scanner-shaped / within 15 min / reader-shaped
//   SENDS RENDERED                         — of the book club sends to that address (email-sent.ndjson), how many drew a render
//                                            within 48 h of the send
//   HOURS TO RENDER (median)               — over those rendered sends, hours from the send to the first render
//   ≤1h · ≤6h · ≤24h                       — the share of rendered sends whose first render came within that many hours: how
//                                            fast this reader answers the hour of send. The operator's word was "vega"; this
//                                            is the measured reading of it, named plainly. Say "vega means …" to re-aim.
// A cache, never state: out/board/lead-quality.json (gitignored), rebuilt only when a session runs `refresh`, never on a timer
// (operator 2026-10-19: "no backround sync unless I start a work session here"). No cache → the People columns read UNMEASURED.
// LLM-FREE.
//
//   node scripts/ops/board-lead-quality.mjs refresh [--since 2026-07-08T00:00:00Z]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE = 'out/board/lead-quality.json';
export const WINDOW_H = 48;
const H = 3_600_000;
const isNewsletter = (r) => /book club/i.test(r.subject || '') || /bookclub/i.test(r.from || '');
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// sends: [{ to, ts }] book-club sends per address · events: [{ recipient, ts }] T3 renders · ranked: rankReaders output.
export function leadQuality({ sends, events, ranked }) {
  const byR = new Map();
  for (const e of events) { const k = String(e.recipient).toLowerCase(); if (!byR.has(k)) byR.set(k, []); byR.get(k).push(Date.parse(e.ts)); }
  for (const v of byR.values()) v.sort((a, b) => a - b);
  const sendsBy = new Map();
  for (const s of sends) { const k = String(s.to).toLowerCase(); if (!sendsBy.has(k)) sendsBy.set(k, []); sendsBy.get(k).push(Date.parse(s.ts)); }
  const rank = new Map(ranked.map((r) => [String(r.recipient).toLowerCase(), r]));
  const out = {};
  for (const k of new Set([...sendsBy.keys(), ...byR.keys()])) {
    const ts = byR.get(k) || []; const ss = (sendsBy.get(k) || []).sort((a, b) => a - b); const lags = [];
    for (let i = 0; i < ss.length; i++) {
      const end = Math.min(ss[i] + WINDOW_H * H, ss[i + 1] ?? Infinity);   // a render belongs to the latest send before it
      const first = ts.find((t) => t >= ss[i] && t < end);
      if (first != null) lags.push((first - ss[i]) / H);
    }
    const r = rank.get(k);
    const share = (h) => (lags.length ? Math.round((100 * lags.filter((x) => x <= h).length) / lags.length) : null);
    out[k] = { renders: r ? r.renders : 0, days: r ? r.days : 0, last: r ? String(r.lastSeen).slice(0, 10) : null, mechanical: !!(r && r.mechanical),
      sends: ss.length, rendered: lags.length, medianH: lags.length ? Math.round(median(lags) * 10) / 10 : null, le1: share(1), le6: share(6), le24: share(24) };
  }
  return out;
}

// RENDER SHAPE reads the median hours-to-render. Measured 2026-10-19 over 152 addresses that rendered a send (22 machine-shaped): 110 rendered within
// 3 minutes (median), 17 within 15, 3 later. A person does not open every send within 3 minutes for weeks; a mail scanner that runs
// the page on arrival does. So the fastest renders are the least human, and the label says so instead of ranking them first.
export const SHAPE = [[0.05, 'instant (≤3 min): scanner-shaped'], [0.25, 'within 15 min'], [Infinity, 'later: reader-shaped']];
export const renderShape = (q) => (!q || q.medianH == null ? '' : q.mechanical ? 'machine (too many renders a day)' : SHAPE.find(([h]) => q.medianH <= h)[1]);
export const LQ_COLS = ['RENDERS', 'RENDER DAYS', 'LAST RENDER', 'SENDS RENDERED', 'HOURS TO RENDER (median)', '≤1h', '≤6h', '≤24h', 'RENDER SHAPE'];
export function loadLeadQuality(file = resolve(REPO, CACHE)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }
export function lqCells(email, lq) {
  if (!lq) return LQ_COLS.map((_, i) => (i ? '' : `UNMEASURED — no cache; node scripts/ops/board-lead-quality.mjs refresh`));
  const q = lq.people[String(email || '').toLowerCase()];
  if (!q) return ['0', '0', '', '0 of 0', '', '', '', '', ''];   // no send and no render on the record for this address
  const pct = (v) => (v == null ? '' : `${v}%`);
  return [String(q.renders), String(q.days), q.last || '', `${q.rendered} of ${q.sends}`, q.medianH == null ? '' : String(q.medianH), pct(q.le1), pct(q.le6), pct(q.le24), renderShape(q)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2); const arg = (f, d) => (a.includes(f) ? a[a.indexOf(f) + 1] : d);
  if (cmd !== 'refresh') { console.error('usage: board-lead-quality.mjs refresh [--since ISO]'); process.exit(2); }
  const { sbEnv, fetchAllRows } = await import('../bookclub/sb-env.mjs');
  const { decodeTokenPayload } = await import('../bookclub/traffic-uplift-rank.mjs');
  const { rankReaders } = await import('../bookclub/rank-readers-t3.mjs');
  const { loadSettings } = await import('../bookclub/rank-settings.mjs');
  const S = loadSettings(); const since = arg('--since', S.since);
  const sb = sbEnv(); if (!sb) { console.log('lead quality: UNMEASURED — no Supabase env; refusing to fake it'); process.exit(0); }
  const rows = await fetchAllRows(`${sb.SB}/rest/v1/user_activity_logs?created_at=gte.${since}&event_data->flags->>t=not.is.null&select=created_at,event_data&order=created_at.asc`, sb.headers);
  const events = []; for (const v of rows) { const p = decodeTokenPayload(v.event_data?.flags?.t); if (p?.recipient_email) events.push({ recipient: p.recipient_email, ts: v.created_at }); }
  let excludeFn = () => false; try { excludeFn = (await import('../bookclub/internal-addresses.mjs')).skipForPersonalReply; } catch { /* rank everyone */ }
  const ranked = rankReaders(events, { excludeFn, mechPerDay: S.mechPerDay });
  const sends = [];
  for (const l of readFileSync(resolve(REPO, '.thetacog/email-sent.ndjson'), 'utf8').split('\n')) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (!isNewsletter(r) || /^\[preview/i.test(r.subject || '') || Date.parse(r.ts) < Date.parse(since)) continue;
    for (const to of [...(r.to || []), ...(r.bcc || [])]) sends.push({ to, ts: r.ts });
  }
  // The same exclusion the ranking applies (self, internal, role boxes) applies to the latency count, or a role box reads
  // "rendered 9 of 69" beside "0 renders".
  const kept = events.filter((e) => !excludeFn(e.recipient));
  const people = leadQuality({ sends: sends.filter((s) => !excludeFn(s.to)), events: kept, ranked });
  mkdirSync(dirname(resolve(REPO, CACHE)), { recursive: true });
  writeFileSync(resolve(REPO, CACHE), JSON.stringify({ at: new Date().toISOString(), since, renders: events.length, sends: sends.length, window_h: WINDOW_H, people }));
  const rendered = Object.values(people).filter((p) => p.rendered > 0).length;
  console.log(`lead quality · ${events.length} T3 renders · ${sends.length} book-club sends · ${Object.keys(people).length} addresses · ${rendered} rendered a send within ${WINDOW_H} h → ${CACHE}`);
}
