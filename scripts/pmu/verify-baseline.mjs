#!/usr/bin/env node
// scripts/pmu/verify-baseline.mjs — compare the newest local receipt against the ACTIVATED
// baseline. The local pre-echo of the parametric trigger: the trigger proper is a receipt that
// read in-lane while reality drifted; this command is the daily discipline that makes "check
// when you should have checked" a one-liner.
//
//   npx thetacog-mcp verify-baseline
//
// FAIL-CLOSED THROUGHOUT (the D3/UNMEASURED doctrine):
//   no baseline  -> UNREGISTERED (exit 1) — run register-surface first; not a pass.
//   no current   -> UNMEASURED   (exit 1) — nothing to compare; not a pass.
//   contradiction class (baseline in-lane, current off-domain) -> exit 2, loudly.
//   otherwise    -> the drift table, exit 0.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';

const BASELINE = resolve(os.homedir(), '.thetacog/baseline-receipt.json');
if (!existsSync(BASELINE)) {
  console.error('UNREGISTERED — no baseline at ~/.thetacog/baseline-receipt.json.');
  console.error('Activate one: run the instrument, then `npx thetacog-mcp register-surface --url <your fork>`.');
  process.exit(1);
}
const newestReceipt = (dir) => {
  if (!existsSync(dir)) return null;
  const c = readdirSync(dir).filter((f) => f.startsWith('receipt') && f.endsWith('.json'))
    .map((f) => ({ f: join(dir, f), m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
  return c.length ? c[0].f : null;
};
const cur = newestReceipt(resolve(process.cwd(), '.thetacog')) || newestReceipt(resolve(os.homedir(), '.thetacog'));
if (!cur) { console.error('UNMEASURED — no current receipt found (.thetacog/receipt*.json). Run the instrument first; absence is not a pass.'); process.exit(1); }

const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const base = j(BASELINE), now = j(cur);
const pick = (r) => ({ verdict: r.verdict ?? null, cell: r.sense_axis_cell ?? r.cell ?? null, off: r.off_lane_pct ?? null, state: r.boolean_state ?? null });
const b = pick(base), n = pick(now);
console.log('BASELINE  →', JSON.stringify(b));
console.log('CURRENT   →', JSON.stringify(n), `(${cur})`);
const rows = [
  ['cell', b.cell, n.cell, b.cell === n.cell ? 'held' : 'MOVED'],
  ['boolean_state', b.state, n.state, b.state === n.state ? 'held' : 'CHANGED'],
  ['off_lane_pct', b.off, n.off, (b.off == null || n.off == null) ? 'UNMEASURED side' : (n.off - b.off <= 0 ? 'tightened' : `widened +${(n.off - b.off).toFixed(1)}`)],
];
for (const [k, bv, nv, verdict] of rows) console.log(`  ${k.padEnd(14)} ${String(bv).padEnd(12)} → ${String(nv).padEnd(12)} ${verdict}`);
if (b.state === 'IN_LANE' && (n.state === 'OFF_DOMAIN' || n.state === 'UNPLACEABLE')) {
  console.error('\n⚠️  CONTRADICTION CLASS: baseline was in-lane, current is not. This is the shape the parametric trigger fires on — check now, on the record.');
  process.exit(2);
}
console.log('\n✓ compared against the activated baseline — this run is the record that you checked.');
