#!/usr/bin/env node
// scripts/pmu/grip-ab-sweep.mjs — THE GRIP A/B SWEEP (operator 2026-07-22: "run a B test — zero
// injection / raw dump / knock-on inject — bury them and measure ... a whole different level of grip").
//
// Measures how each injection tier changes PLACEMENT SHARPNESS (σ from the REAL on-chip walk) and the
// BYTE COST — the with-vs-without proof, on real prompts, recomputable. This is the offline measurement
// engine; the live per-prompt loop and the hourly roundup call the same grip primitive.
//
// HONESTY (rule 4 — LLM-free verdict): this measures PLACEMENT concentration (σ of the walk on
// prompt+bundle), an LLM-free proxy for how tightly the injection binds a prompt to its coordinate.
// It does NOT run the model — post-generation drift is the LIVE loop's job and stays OUT of this
// deterministic verdict. Direction (does Arm 2 beat Arm 1 on grip?) is REPORTED as data, never asserted.
//
// Run:  node scripts/pmu/grip-ab-sweep.mjs   →   data/pmu/grip-ab-sweep.json + a table

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkShape, CHAT_WALK_OPTS, WALK_TIMEOUT_MS } from '../../src/lib/pmu/unified-drift.mjs';
import { loadCollisionEngine } from './mass-collision.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// cell melds = each coordinate's self-definer = today's {rules+hats} semantic content (hats ARE the meld,
// per the operator: a hat is the coordinate's own self-definition worn as a persona). Until builder lands
// rules/hats as mass-types, the meld is the on-coordinate constraint text we inject.
const CELLS = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'));
const meldOf = new Map(CELLS.map((c) => [String(c.coord), String(c.snippet || '')]));
// Arm 1's naive "dump everything" baseline: many melds concatenated toward ~128KB.
const RAW_DUMP = CELLS.map((c) => String(c.snippet || '')).join('\n').slice(0, 128 * 1024);

// deterministic arm burial for the LIVE loop (recomputable, LLM-free) — the sweep itself runs ALL arms
// per prompt for a paired comparison, but exports the burial so the live loop assigns one arm per prompt.
export function buriedArm(prompt) { let h = 0; const s = String(prompt); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 3; }

const FIXTURE = [
  'add a bank to the river so the water does not flood the town',   // drift-prone: invents structure out-of-lane
  'wire the collision engine into the lens for prompt injection',
  'route diary logistics through the executive assistant for scheduling',
  'compute the drift vector for this commit and place it on the lattice',
  'write a blog post about why undecidable AI is uninsurable',
  'seed rules and hats as mass types in the index so the walk pulls them',
];

const sigOf = async (text) => { const w = await walkShape(String(text), { opts: CHAT_WALK_OPTS, timeoutMs: WALK_TIMEOUT_MS }); return { sigma: w.sigma || 0, sensor: w.sensor, fill: w.fillPct || 0 }; };

// ── MAIN (only when run directly — importing this module must NOT run the sweep) ──
if (import.meta.url === `file://${process.argv[1]}`) {
// MAX-YIELD OFFLINE (operator 2026-07-23 "set it up for max yield"): --from-log N replays N real
// historical prompts through the PAIRED A/B (each measured F0 vs F1). Real prompts, real placement,
// measured both ways — the honest fast path to the drift curve. No internet, no live prompts, no faking.
let PROMPTS = FIXTURE;
const li = process.argv.indexOf('--from-log');
if (li > -1) {
  const N = +(process.argv[li + 1] || 600);
  const { readFileSync: rf, existsSync: ex } = await import('node:fs');
  const LOG = resolve(REPO, '.thetacog/lens-injected.log');
  const log = ex(LOG) ? rf(LOG, 'utf8') : '';
  const all = [...new Set((log.match(/^PROMPT:\s*(.+)$/gm) || []).map((l) => l.replace(/^PROMPT:\s*/, '').trim()).filter((p) => p.length > 12))];
  PROMPTS = all.slice(-N);   // the most recent N unique real prompts
  console.log(`grip A/B · MAX-YIELD from-log · ${PROMPTS.length} real prompts (paired F0 vs F1)\n`);
}
const eng = loadCollisionEngine();
const rows = [];
for (const p of PROMPTS) {
  const coin = await eng.coinRead(p);
  const bundle2 = coin.inject.map((c) => meldOf.get(c.coord) || '').filter(Boolean).join('\n');   // targeted, on-coordinate
  const a0 = await sigOf(p);                          // Arm 0: zero injection (raw baseline)
  const a1 = await sigOf(p + '\n' + RAW_DUMP);        // Arm 1: raw dump (the naive ~128KB approach)
  const a2 = await sigOf(p + '\n' + bundle2);         // Arm 2: knock-on targeted inject
  rows.push({
    prompt: p.slice(0, 52), arm: buriedArm(p),
    arm0: { sigma: +a0.sigma.toFixed(3), bytes: 0, sensor: a0.sensor },
    arm1: { sigma: +a1.sigma.toFixed(3), bytes: RAW_DUMP.length, sensor: a1.sensor },
    arm2: { sigma: +a2.sigma.toFixed(3), bytes: bundle2.length, sensor: a2.sensor },
    gripPct: coin.gripPct,
  });
}
const mean = (f) => +(rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(3);
const aggregate = {
  arm0: { label: 'zero injection (raw baseline)', mean_sigma: mean((r) => r.arm0.sigma), mean_bytes: 0 },
  arm1: { label: 'raw dump (~128KB naive)', mean_sigma: mean((r) => r.arm1.sigma), mean_bytes: Math.round(mean((r) => r.arm1.bytes)) },
  arm2: { label: 'knock-on targeted inject', mean_sigma: mean((r) => r.arm2.sigma), mean_bytes: Math.round(mean((r) => r.arm2.bytes)) },
};
const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const nowIso = new Date().toISOString();
const out = {
  ts: nowIso,
  note: 'Grip A/B sweep — σ (real-walk placement sharpness) + byte cost per injection tier. LLM-free, real on-chip walk. Recompute: node scripts/pmu/grip-ab-sweep.mjs',
  honest_limit: 'measures PLACEMENT concentration (LLM-free), NOT model post-generation drift — that is the live loop; direction is data, not asserted.',
  provenance: { host: hostname(), commit, node: process.version, measured_at: nowIso },
  token_economy: { arm2_vs_arm1_byte_ratio: aggregate.arm1.mean_bytes ? +(aggregate.arm2.mean_bytes / aggregate.arm1.mean_bytes).toFixed(4) : null },
  aggregate, rows,
};
writeFileSync(resolve(REPO, 'data/pmu/grip-ab-sweep.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`grip A/B sweep · ${rows.length} prompts · measured on ${out.provenance.host} @ ${commit}`);
for (const [k, a] of Object.entries(aggregate)) console.log(`  ${k} ${a.label.padEnd(30)} mean σ ${a.mean_sigma}  ·  mean bytes ${a.mean_bytes.toLocaleString()}`);
console.log(`  token economy: Arm 2 spends ${(100 * (out.token_economy.arm2_vs_arm1_byte_ratio || 0)).toFixed(2)}% of Arm 1's bytes`);
}   // end MAIN
