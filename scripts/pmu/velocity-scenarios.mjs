#!/usr/bin/env node
// scripts/pmu/velocity-scenarios.mjs — the experimental design AS runnable scenarios.
//
// Each scenario is a real (prompt, reality-SWEEP, negative) triple: the prompt is the pointer,
// the negative is the excluded case, and the SWEEP is a sequence of realities from BREACH
// (drifted off-lane) to RECOVERY (on-lane). Running each reality through the deterministic
// placement() (gzip-NCD, LLM-free, the SAME math the page's gauges show — NO server needed)
// produces a CONVERGENCE CHART: driftPct per step. The convergence velocity is drift-removed
// per step — flat when a step does nothing, steep when it grips.
//
// This is the single-loop the sense-making thread asked for, made a fixture: intent + negative
// in, a signed-able trajectory out, one metric (did drift cross back under the policy limit, and
// how fast). The scenarios are exported so BOTH the unit test AND the page endpoint drive them.
//
// Usage: node scripts/pmu/velocity-scenarios.mjs [--json]

import { placement } from './attest-hypotheses.mjs';
import { loadScenarios } from './scenario-library.mjs';

const THRESHOLD = 45; // Mode-A policy limit (attest-hypotheses default)

// THE SCENARIOS now come from the growing LIBRARY (data/pmu/scenarios/library.json) — the single
// source of truth generated from scenario-gen.sh. Kept as an export for back-compat.
export const SCENARIOS = loadScenarios();

// ── RUN one scenario → its convergence chart ──────────────────────────────────────────────────
export function runScenario(sc) {
  const chart = sc.sweep.map((s, i) => {
    const p = placement(sc.prompt, s.reality, sc.negative, THRESHOLD);
    return { i, step: s.step, driftPct: +p.driftPct.toFixed(1), verdict: p.verdict, mode: p.mode,
      inLane: p.driftPct <= THRESHOLD };
  });
  // convergence velocity on drift: how much drift is removed per step, over the breach→flip span.
  const first = chart[0], last = chart[chart.length - 1];
  const breached = first.driftPct > THRESHOLD;
  const flipped = last.driftPct <= THRESHOLD;
  const steps = chart.length - 1;
  const driftRemoved = first.driftPct - last.driftPct;
  const velocity = (breached && flipped && steps > 0) ? +(driftRemoved / steps).toFixed(2) : 0;
  return {
    key: sc.key, title: sc.title, ideal: sc.ideal, threshold: THRESHOLD,
    chart, breached, flipped,
    velocity,                       // drift-%-removed per step over a real recovery; 0 if never flipped
    drift: breached && !flipped,    // an unrecovered breach = drift on the tape
    reads: !breached ? 'held at/under the limit (fixed point)'
      : flipped ? `recovered in ${steps} step(s) at ${velocity}%/step`
      : 'BREACH NEVER FLIPPED — drift',
  };
}

export function runAll() {
  const results = SCENARIOS.map(runScenario);
  const drift = results.filter((r) => r.drift);
  return { ts_note: 'deterministic · gzip-NCD · LLM-free · same math as the page gauges', threshold: THRESHOLD,
    results, summary: { scenarios: results.length, drift: drift.length,
      converging: results.filter((r) => !r.drift).length,
      reads: 'every non-negative-control scenario must recover or hold; a drift result exits 1 (heals via tape-health kickback)' } };
}

if (process.argv[1] && process.argv[1].endsWith('velocity-scenarios.mjs')) {
  const out = runAll();
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`velocity-scenarios · ${out.results.length} scenarios · threshold ${out.threshold}%`);
    for (const r of out.results) {
      console.log(`\n  ▸ ${r.title} [${r.key}] — ${r.reads}`);
      console.log(`    chart: ${r.chart.map((c) => `${c.step}=${c.driftPct}%${c.inLane ? '✓' : '✗'}`).join(' → ')}`);
    }
    console.log(`\n  ${out.summary.converging}/${out.summary.scenarios} converging · ${out.summary.drift} drift`);
  }
  // the drift scenario is a NEGATIVE CONTROL (unrecoverable by design) — it SHOULD report drift,
  // so exit non-zero only if a scenario that is NOT the control drifts.
  const badDrift = out.results.filter((r) => r.drift && r.key !== 'unrecoverable-drift');
  process.exit(badDrift.length ? 1 : 0);
}
