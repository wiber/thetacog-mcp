#!/usr/bin/env node
// scripts/vna/underwriter-line.mjs — THE UNDERWRITER'S TWO NUMBERS, READ OFF THE WALK TAPE (C99e).
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The carrier reads the tape's variance and volume, never the weights (C99 hypothetical 3). The two readings that exist:
//   (1) OFF-LANE SHARE — of the placed commits in the window, the share whose reality landed in a different block from
//       its declared intent (laneJump > 0, the ONE predicate in scripts/pmu/lane-jump-sn.mjs — C93n's reading);
//   (2) RETURN AFTER OFF-LANE — for each off-lane commit, how many subsequent placed commits it took until one landed
//       back in lane (laneJump 0). Median and p90 over the off-lane commits that did return inside the window; a
//       commit still out of lane at the window's end is CENSORED, counted, never guessed.
// A placed commit = one distinct sha with a commit-intent AND a commit-reality row the seed's own null test admits on
// both sides (walk-door: a rejected pixel is ABSENT, never a placement). Prompt rows, lens-cli rows, spec-tree rows and
// unpaired shas never count. Under 20 distinct target commits the line opens with `UNDERPOWERED — <n> of 20` before any
// number (hurdle zero, PN3, the-ratchet-invariants.md). Every number here is read from the rows; none is typed.
// LLM-free, pure over rows.
//
// CONSUMERS (import `underwriterLine` / `underwriterRead`; neither is edited here):
//   · src/app/notarise/page.tsx — the /notarise page's underwriter line, read at render;
//   · scripts/vna/steer-ui.mjs — card 1's ▸ more drawer (the receipt lines, each UNMEASURED on its own when absent).
//
//   node scripts/vna/underwriter-line.mjs [--since <iso>] [--json]
import { readFileSync, existsSync } from 'node:fs';
import { WALK_TAPE } from '../../src/lib/pmu/walk-door.mjs';
import { commitPairs, inLane } from '../pmu/lane-jump-sn.mjs';

export const HURDLE = 20;   // hurdle zero: no reading below 20 distinct target commits
// never on the line, never in the read, never in this source outside this list: the typed-ratio register the paste arrived in
export const BANNED = [/\bSAR\b/, /99\.98/, /\bbonded\b/, /uninsurable/, /deterministic/i, /\d+(\.\d+)?\s*ticks\b/];

const quantile = (xs, q) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))]; };
const median = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

// The read: every number the line carries, plus the counts that explain an UNDERPOWERED (pairs seen, inadmissible, censored).
export function underwriterRead(rows) {
  const all = commitPairs(rows || []);
  const placed = all.filter((c) => c.admissible).sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const n = placed.length, inadmissible = all.length - n;
  const base = { hurdle: HURDLE, n, pairs_seen: all.length, inadmissible, source: 'walk-tape commit-intent × commit-reality pairs (laneJump, lane-jump-sn.mjs)' };
  if (n < HURDLE) return { ...base, status: 'UNDERPOWERED', off_n: null, off_pct: null, return_median: null, return_p90: null, return_n: null, censored: null };
  const off = placed.map((c, i) => ({ i, c })).filter(({ c }) => !inLane(c.d));
  const returns = [], censoredRefs = [];
  for (const { i, c } of off) {
    let k = null; for (let j = i + 1; j < placed.length; j++) { if (inLane(placed[j].d)) { k = j - i; break; } }
    if (k == null) censoredRefs.push(c.ref); else returns.push(k);
  }
  return {
    ...base, status: 'measured', off_n: off.length, off_pct: Math.round(100 * off.length / n),
    return_median: median(returns), return_p90: quantile(returns, 0.9), return_n: returns.length, censored: censoredRefs.length,
    window: { first: placed[0].ts, last: placed[n - 1].ts },
  };
}

export function underwriterLine(rows) {
  const r = underwriterRead(rows);
  if (r.status === 'UNDERPOWERED') return `UNDERPOWERED — ${r.n} of ${r.hurdle} placed commits (${r.pairs_seen} pairs on the tape, ${r.inadmissible} the seed's null test rejects)`;
  const ret = r.return_n
    ? `median ${r.return_median} blocks (p90 ${r.return_p90})${r.censored ? ` · ${r.censored} still out at the window's end` : ''}`
    : r.off_n ? `none returned inside the window (${r.censored} still out)` : 'no off-lane commit in the window';
  return `off-lane ${r.off_pct} % of ${r.n} commits · return after off-lane: ${ret} · ${r.n} commits`;
}

export function readTape(path = WALK_TAPE, { since = null } = {}) {
  if (!existsSync(path)) return [];
  const rows = readFileSync(path, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return since ? rows.filter((r) => String(r.ts || '') >= since) : rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
  const since = arg('--since');
  const rows = readTape(WALK_TAPE, { since });
  const read = underwriterRead(rows), line = underwriterLine(rows);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...read, since, tape: WALK_TAPE, line }));
  else console.log(line);
}
