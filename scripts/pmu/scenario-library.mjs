#!/usr/bin/env node
// scripts/pmu/scenario-library.mjs — the growing LIBRARY of convergence scenarios.
//
// Operator 2026-07-18: "we need a library of scenarios intent/reality/negative we generate from
// here … generate the reef/rule/hats on iterations and draw charts (and optimise by them)."
//
// One scenario = { key, title, ideal, prompt, negative, sweep:[{step,reality}] } — a real
// (intent, reality-SWEEP, negative) triple whose breach→recovery arc, run through the
// deterministic placement()/lens, is a convergence CHART we learn from and optimise the
// reef/rules/hats against. The library is append-only, versioned in git, and is the single
// source of truth consumed by: velocity-scenarios (charts), scenario-to-tape (bake to file://),
// and reef-converge (the optimisation battery).
//
// The LLM (qwen, local) only AUTHORS scenarios — it never touches a verdict or a metric, so the
// lens stays LLM-free end to end. Generation is scenario-gen.sh; this module is load/save/add.
//
// Usage:
//   node scenario-library.mjs --list
//   node scenario-library.mjs --add '<json>'      # append one scenario (validated)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = resolve(REPO, 'data/pmu/scenarios/library.json');

// ── SEED — the three scenarios proven 2026-07-18 (migrated from velocity-scenarios.mjs so the
// library is the single source of truth). New scenarios are appended by scenario-gen.sh.
const SEED = [
  {
    key: 'poison-recover', title: 'Exemplar poison → gated recovery', ideal: 'git-discipline',
    prompt: 'the agent committed outside its sanctioned scope — flag it to the operator with a signed receipt',
    negative: 'draft the quarterly marketing newsletter about our brand voice and social engagement funnel',
    sweep: [
      { step: 'breach', reality: 'ballistic cascade ply decay ShortLex blocks leaf walk cloud the explosion time budget reef densify snippet library 144 lattice gzip-NCD SimHash walk saturation Chebyshev king-move transpose recursion definer of definer — the PMU dogfood pipeline drives triptych render on the 144-lattice, the walk lands where the payload is heaviest, not where the intent points' },
      { step: 'partial', reality: 'a governance breach: the commit landed out of its authorized lane; some PMU-pipeline context remains but the receipt requirement is surfacing — notify the operator that scope was exceeded' },
      { step: 'recover', reality: 'the commit landed outside its sanctioned scope; flag it to the operator immediately with a signed, verifiable receipt so the out-of-lane change is attributable and cannot be silently merged' },
    ],
  },
  {
    key: 'faithful-hold', title: 'Faithful intent holds at zero (a fixed point, not a bug)', ideal: 'comms-email',
    prompt: 'draft the accumulation email to the reinsurer who already writes AI liability cover',
    negative: 'refactor the webhook signature verification and make the handler idempotent on event id',
    sweep: [
      { step: 'aligned', reality: 'compose the follow-up note to the reinsurer who already underwrites AI liability, opening with the one point and closing with a clear next step for them' },
      { step: 'aligned', reality: 'write the accumulation email to the carrier that already covers AI liability towers, leading with why we believe the correlated-tail argument holds' },
    ],
  },
  {
    key: 'unrecoverable-drift', title: 'Drift that never flips (the negative control — velocity 0, exit loud)', ideal: 'git-discipline',
    prompt: 'flag the out-of-lane commit to the operator with a signed receipt',
    negative: 'flag the out-of-lane commit to the operator with a signed receipt',
    sweep: [
      { step: 'breach', reality: 'flag the out-of-lane commit to the operator with a signed receipt exactly as the negative specifies, word for word, so reality equals the excluded case' },
      { step: 'still-drift', reality: 'flag the out-of-lane commit to the operator with a signed receipt, identical to the excluded boundary, no movement toward the intent at all' },
    ],
  },
];

export function loadScenarios() {
  if (!existsSync(LIB)) return SEED.slice();
  try {
    const doc = JSON.parse(readFileSync(LIB, 'utf8'));
    const arr = Array.isArray(doc) ? doc : (doc.scenarios || []);
    return arr.length ? arr : SEED.slice();
  } catch { return SEED.slice(); }
}

export function validateScenario(s) {
  const errs = [];
  for (const k of ['key', 'title', 'ideal', 'prompt', 'negative']) if (!s[k] || typeof s[k] !== 'string') errs.push(`missing/invalid ${k}`);
  if (!Array.isArray(s.sweep) || s.sweep.length < 2) errs.push('sweep must be an array of ≥2 steps');
  else for (const [i, st] of s.sweep.entries()) { if (!st || typeof st.reality !== 'string' || st.reality.length < 40) errs.push(`sweep[${i}].reality missing or under 40B (dust)`); }
  return errs;
}

export function addScenario(s) {
  const errs = validateScenario(s);
  if (errs.length) throw new Error('invalid scenario: ' + errs.join('; '));
  const lib = loadScenarios();
  if (lib.some((x) => x.key === s.key)) throw new Error(`scenario key "${s.key}" already exists`);
  const next = [...lib, s];
  mkdirSync(dirname(LIB), { recursive: true });
  writeFileSync(LIB, JSON.stringify({ kind: 'thetacog-scenario-library', updated: new Date().toISOString(), scenarios: next }, null, 2) + '\n');
  return next.length;
}

// bootstrap the file on first run so the library is materialised in git, not just in code
export function ensureMaterialised() {
  if (!existsSync(LIB)) { mkdirSync(dirname(LIB), { recursive: true }); writeFileSync(LIB, JSON.stringify({ kind: 'thetacog-scenario-library', updated: 'seed', scenarios: SEED }, null, 2) + '\n'); return true; }
  return false;
}

if (process.argv[1] && process.argv[1].endsWith('scenario-library.mjs')) {
  const argv = process.argv.slice(2);
  if (argv.includes('--add')) {
    const json = argv[argv.indexOf('--add') + 1];
    try { const n = addScenario(JSON.parse(json)); console.log(`✓ added — library now ${n} scenarios`); }
    catch (e) { console.error('✗ ' + e.message); process.exit(1); }
  } else if (argv.includes('--materialise')) {
    console.log(ensureMaterialised() ? '✓ library written' : 'library already exists');
  } else {
    const lib = loadScenarios();
    console.log(`scenario-library · ${lib.length} scenarios (${existsSync(LIB) ? 'from data/pmu/scenarios/library.json' : 'seed — run --materialise to write'})`);
    for (const s of lib) console.log(`  ▸ ${s.key.padEnd(22)} ideal ${String(s.ideal).padEnd(14)} · ${s.sweep.length} steps · ${s.title}`);
  }
}
