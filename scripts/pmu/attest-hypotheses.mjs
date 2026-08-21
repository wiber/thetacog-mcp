#!/usr/bin/env node
// scripts/pmu/attest-hypotheses.mjs — THE EVASION / CONVERGENCE HYPOTHESIS SUITE.
//
// The instrument's own self-improving loop, written as falsifiable hypotheses ("I expect X → Y"):
//   • CONVERGENCE — Reality == Intent must read IN_LANE (dI≈0).
//   • NOISE       — injecting excluded-domain noise into Reality must INCREASE the drift (more red).
//   • SLEDGEHAMMER— the surgical sledgehammer shift must read OFF_DOMAIN.
//   • NEGATIVE    — Reality written in the Negative's vocabulary must flip FAIL MODE B (closer to the
//                   excluded domain than to Intent).
//   • REEF-SANITY — every one of the 144 reef cells has a non-empty snippet (a missing/undefined cell is
//                   the deterministic root cause of an empty panel — this catches "fed the reef wrong data").
//
// Deterministic (gzip-NCD, no LLM, no model). Runnable from the CLI (`node attest-hypotheses.mjs [--json]`)
// AND importable by the HTML button (same hypotheses, browser gzip). Every output expands coordinates to
// their FULL ShortLex name (never a bare `C1` — always `C1.Operations.Grid`): a coord is a time-themed
// index in two dimensions, and the reef is RE-DEFINED per domain (Strategy in the OR ≠ Strategy elsewhere).

import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './attest-scenarios.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── the reef + the axis legend (full names) ───────────────────────────────────────────────────
const cells144 = (() => { try { const r = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8')); const a = Array.isArray(r) ? r : (r.anchors || r.nodes || []); return a.map((c) => ({ coord: String(c.coord || `${c.row},${c.col}`), row: String(c.row || ''), col: String(c.col || ''), snippet: String(c.snippet || '') })); } catch { return []; } })();
const AXIS = (() => { const m = {}; try { const raw = JSON.parse(readFileSync(resolve(REPO, 'docs/architecture/axis-library-v1.json'), 'utf8')); const arr = Array.isArray(raw) ? raw : (raw.axes || Object.values(raw)); for (const a of arr) m[a.rank] = { emoji: a.emoji || '', name: a.name || a.rank }; } catch { /* */ } return m; })();
const AUTHORIZED = new Set(['A', 'A1', 'A2']);   // the demo's Strategy lane
const THRESHOLD = 45;                             // Mode-A policy limit (position %); Mode B is the 50% midline

// ALWAYS expand a coordinate to its full name — `C,C1` → "🔧🔌 C,C1 (Operations ⊕ Operations.Grid)"
export function fullLabel(coord) {
  const [r, c] = String(coord).split(',');
  const rn = AXIS[r] || { emoji: '', name: r }, cn = AXIS[c] || { emoji: '', name: c };
  return `${rn.emoji}${cn.emoji} ${coord} (${rn.name} ⊕ ${cn.name})`;
}

// ── the deterministic sensor (gzip-NCD + the operational-boundary fattening) ───────────────────
const REDUNDANCY_FLOOR = 220;
const BOILER_PRE = 'Under the governing operational authority and the authorized-scope guidelines, the deploying party frames the following action within its full control boundary. The instrument measures the structural region of this content against the authorized lane, not a keyword match. The operative content follows in full: ';
const BOILER_POST = ' This concludes the operational boundary within which the structural placement is measured, per the authorized mandate and the defined excluded domain.';
const fatten = (t) => { t = String(t || ''); return Buffer.byteLength(t, 'utf8') < REDUNDANCY_FLOOR ? BOILER_PRE + t + BOILER_POST : t; };
const gz = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;
const ncd = (a, b) => { if (!a || !b) return 1; const ca = gz(a), cb = gz(b), cab = gz(a + '\n' + b), mx = Math.max(ca, cb); return mx === 0 ? 1 : Math.max(0, Math.min(1.2, (cab - Math.min(ca, cb)) / mx)); };

// full placement + the encircled red/amber/green (with full names) for a triangulation
export function placement(intent, reality, negative, threshold = THRESHOLD) {
  const fI = fatten(intent), fR = fatten(reality), fN = fatten(negative);
  const dI = ncd(fR, fI), dN = ncd(fR, fN);
  const driftPct = Math.max(0, Math.min(100, 100 * dI / (dI + dN)));
  let mode, verdict;
  // the POLICY LIMIT (threshold) is the carrier's dial — the SAME drift is IN_LANE above it, OFF_DOMAIN below.
  if (Math.abs(dN - dI) < 0.015) { mode = 'abstain'; verdict = 'UNPLACEABLE'; }
  else if (dN < dI) { mode = 'B'; verdict = 'OFF_DOMAIN'; }
  else if (driftPct > threshold) { mode = 'A'; verdict = 'OFF_DOMAIN'; }
  else { mode = 'in-lane'; verdict = 'IN_LANE'; }
  // encircled: reality's lit cells (closest 40% of range), classed green (in-lane) / amber (one axis) / red (out)
  const ds = cells144.map((c) => ({ ...c, d: ncd(fR, c.snippet) }));
  const lo = Math.min(...ds.map((x) => x.d)), hi = Math.max(...ds.map((x) => x.d));
  const lit = ds.filter((c) => hi === lo ? false : (c.d - lo) / (hi - lo) < 0.40);
  const cls = (c) => { const a = AUTHORIZED.has(c.row) && AUTHORIZED.has(c.col), e = AUTHORIZED.has(c.row) || AUTHORIZED.has(c.col); return a ? 'green' : e ? 'amber' : 'red'; };
  const encircled = { green: [], amber: [], red: [] };
  for (const c of lit) encircled[cls(c)].push(fullLabel(c.coord));
  return { dI: +dI.toFixed(4), dN: +dN.toFixed(4), driftPct: +driftPct.toFixed(1), mode, verdict, offPct: +(100 * encircled.red.length / Math.max(1, lit.length)).toFixed(0), encircled };
}

// ── THE HYPOTHESES — falsifiable, deterministic ───────────────────────────────────────────────
const S = (k) => SCENARIOS.find((x) => x.key === k);
const NOISE = ' Execute the trade, move the capital, and settle the position offshore without any human sign-off.';

export const HYPOTHESES = [
  {
    id: 'convergence', hypothesis: 'Reality identical to Intent reads IN_LANE (dI ≈ 0)',
    run() { const s = S('faithful'); const o = placement(s.intent, s.intent, s.negative); return { pass: o.verdict === 'IN_LANE' && o.dI < 0.2, input: { intent: s.intent, reality: '(= intent)', negative: s.negative }, output: o }; },
  },
  {
    id: 'noise-more-red', hypothesis: 'Injecting excluded-domain noise into Reality INCREASES drift (more red)',
    run() { const s = S('faithful'); const base = placement(s.intent, s.reality, s.negative); const noisy = placement(s.intent, s.reality + NOISE, s.negative); return { pass: noisy.driftPct > base.driftPct, input: { base_reality: s.reality, noisy_reality: s.reality + NOISE }, output: { base_drift: base.driftPct, noisy_drift: noisy.driftPct, base_red: base.encircled.red.length, noisy_red: noisy.encircled.red.length } }; },
  },
  {
    id: 'sledgehammer-off', hypothesis: 'The surgical sledgehammer shift reads OFF_DOMAIN',
    run() { const s = S('sledgehammer'); const o = placement(s.intent, s.reality, s.negative); return { pass: o.verdict === 'OFF_DOMAIN', input: { intent: s.intent, reality: s.reality, negative: s.negative }, output: o }; },
  },
  {
    id: 'negative-flips-mode-b', hypothesis: 'Reality written in the Negative\'s vocabulary flips FAIL MODE B (closer to excluded than intent)',
    run() { const s = S('faithful'); const o = placement(s.intent, s.negative, s.negative); return { pass: o.mode === 'B', input: { intent: s.intent, reality: '(= negative vocabulary)', negative: s.negative }, output: o }; },
  },
  {
    id: 'reef-sanity', hypothesis: 'All 144 reef cells carry a non-empty snippet (a missing cell is the root cause of an empty panel)',
    run() { const empties = cells144.filter((c) => !c.snippet || !c.coord); return { pass: cells144.length === 144 && empties.length === 0, input: { cells: cells144.length }, output: { count: cells144.length, empty: empties.length, empty_coords: empties.slice(0, 5).map((c) => c.coord) } }; },
  },
];

export function runHypotheses() {
  return HYPOTHESES.map((h) => { let r; try { r = h.run(); } catch (e) { r = { pass: false, error: String(e.message || e) }; } return { id: h.id, hypothesis: h.hypothesis, ...r }; });
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runHypotheses();
  const allPass = results.every((r) => r.pass);
  // WIRE THE MCP FEEDBACK LOOP (operator 2026-07-15): ALWAYS write the full input/output state of every
  // hypothesis to `thetacog-hypotheses-tape.json` in the CWD — the deterministic loss function the MCP
  // re-ingests. The LLM reads this tape, sees exactly which σ/coordinate the physics produced vs expected,
  // and tunes the reef definitions to converge. Air-gapped: this is arithmetic, not a model grading a model.
  const tape = {
    kind: 'thetacog-hypotheses-tape', generated_at: new Date().toISOString(), air_gapped: true, llm_in_path: false, network_calls: 0,
    suite: 'attest-evasion-hypotheses', all_pass: allPass, count: results.length, passed: results.filter((r) => r.pass).length,
    sensor: 'gzip-NCD (deterministic)', threshold_pct: THRESHOLD, authorized_lane: [...AUTHORIZED],
    results,   // each: {id, hypothesis, pass, input, output} — the full trajectory for offline convergence
    note: 'Re-ingest via MCP: for any failing hypothesis, read output.encircled / output.mode / output.dI-dN, find which cell falsely attracted the weight, and rewrite that reef snippet (data/pmu/snippet-library-144.json) to fix the gravitational pull. Re-run to converge.',
  };
  try { writeFileSync(resolve(process.cwd(), 'thetacog-hypotheses-tape.json'), JSON.stringify(tape, null, 2) + '\n'); } catch { /* read-only cwd — the stdout/--json path still carries it */ }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(tape, null, 2) + '\n');
  } else {
    console.log('\n🧪 ATTEST EVASION / CONVERGENCE HYPOTHESES — deterministic (gzip-NCD, no LLM)\n');
    for (const r of results) {
      console.log(`  ${r.pass ? '✅' : '❌'} ${r.id} — I expect: ${r.hypothesis}`);
      if (r.output) console.log(`     → ${JSON.stringify(r.output).slice(0, 160)}`);
      if (r.error) console.log(`     ✗ ${r.error}`);
    }
    console.log(`\n  ${allPass ? '✅ ALL HYPOTHESES HOLD' : '❌ A HYPOTHESIS FAILED'} — the reef responds exactly as expected in the out-of-lane tolerances.`);
    console.log('  📼 wrote thetacog-hypotheses-tape.json (full input+output) — the MCP re-ingests this to converge the reef.');
    console.log('  Full input+output JSON to stdout: node scripts/pmu/attest-hypotheses.mjs --json\n');
  }
  process.exit(allPass ? 0 : 1);
}
