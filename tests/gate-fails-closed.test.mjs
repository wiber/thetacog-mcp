// packages/thetacog-mcp/tests/gate-fails-closed.test.mjs — THE MARSH GUARD (2026-08-13)
// Born from the Adam-at-Marsh adversarial read (THETACOG_ATTEST_INCIDENT_REPORT.md, Part 5d).
// Two regressions this test makes impossible:
//
//   1. FAIL-OPEN GATE — attest-demo-lifecycle.mjs once read
//        (offPct == null || offPct < 25) → IN_LANE
//      so a MISSING off-lane count resolved to a clean pass. For an insurance trigger,
//      absent data must read UNMEASURED, never IN_LANE. ("Submitting nothing must never
//      be the cheapest way to score perfectly.")
//
//   2. WALL-CLOCK WALKS ON THE DEMO PATH — triptych-build/attest-demo/attest-serve carried
//      budgetMs 1200/1500, so the walk's hop count depended on machine speed and the demo's
//      walk σ drifted 9.5→9.6 across runs beside the words "byte-identical". The repo's own
//      rule (unified-drift.mjs) is: the DETERMINISTIC hop budget terminates the walk; the
//      wall-clock ceiling exists only as a last-resort bound and must be ≥ 600000ms.
//
// Run: node tests/gate-fails-closed.test.mjs   (exit 0 = both invariants hold)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check BOTH trees when present: the package copy under scripts/pmu is a DERIVED artifact
// (bundle-pmu.mjs copies from the repo root at prepack) — the repo-root source is the truth.
// In the shipped tarball only the package copy exists; in the repo both must hold.
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '..', '..');
const roots = [PKG, existsSync(resolve(REPO, 'scripts/pmu/attest-demo-lifecycle.mjs')) ? REPO : null].filter(Boolean);
const read = (p) => roots.map((r) => readFileSync(resolve(r, p), 'utf8')).join('\n/*═tree-boundary═*/\n');
let failures = 0;
const assert = (ok, msg) => { if (ok) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; } };

// ── 1. the gate fails CLOSED on absent data ─────────────────────────────────
// Tested the Marsh way (evaluator, 2026-08-13): the boolean_state expression is extracted
// VERBATIM from the source, compiled, and evaluated against a truth table — a reimplemented
// copy of the logic would pass on an unpatched file, which is exactly the tautology the
// evaluator caught in the first cut of this check.
// SCOPE (two findings, one closed): this gate closes the NULL hole (absent data -> UNMEASURED).
// It does NOT close the CALIBRATION hole — offPct=18 still passes kill@25 (fake_ops). That is a
// separate owed item (threshold calibration on the real-n corpus), not part of this fix.
const lifecycle = read('scripts/pmu/attest-demo-lifecycle.mjs');
assert(!/offPct\s*==\s*null\s*\|\|/.test(lifecycle),
  'no fail-open pattern (offPct == null ||) in the boolean_state gate');
{
  const m = lifecycle.match(/boolean_state:\s*(placed[^\n]+?),\s*\n/);
  assert(!!m, 'boolean_state expression found in source');
  if (m) {
    let fn = null;
    try { fn = new Function('placed', 'cell', 'offPct', `return (${m[1]});`); } catch { /* compile fail -> asserts below fail */ }
    const rows = [
      ['placed', 'A2', null, 'UNMEASURED'],
      ['placed', 'A2', 0, 'IN_LANE'],
      ['placed', 'A2', 18, 'IN_LANE'],      // calibration hole — open by design of THIS fix
      ['placed', 'A2', 25, 'OFF_DOMAIN'],
      ['placed', 'B1', 10, 'OFF_DOMAIN'],
      ['UNPLACEABLE', 'A2', null, 'UNPLACEABLE'],
    ];
    for (const [placed, cell, offPct, want] of rows) {
      const got = fn ? fn(placed, cell, offPct) : '(compile failed)';
      assert(got === want, `real expression: (${placed}, ${cell}, ${offPct}) -> ${want} (got ${got})`);
    }
  }
}

// ── 2. demo walk paths ride the hop budget, not the wall clock ──────────────
// definer-walk-144.mjs included: its SIGNATURE default was 1500ms — any caller omitting budgetMs
// silently got a wall clock back (evaluator's latent-default finding, 2026-08-13).
const WALL_CLOCK_FLOOR = 600000;
for (const file of ['scripts/pmu/triptych-build.mjs', 'scripts/pmu/attest-demo.mjs', 'scripts/pmu/attest-serve.mjs', 'scripts/pmu/definer-walk-144.mjs']) {
  const src = read(file);
  const values = [...src.matchAll(/budgetMs\s*[=:]\s*(\d+)/g)].map((m) => Number(m[1]));
  assert(values.length > 0 && values.every((v) => v >= WALL_CLOCK_FLOOR),
    `${file}: every budgetMs literal ≥ ${WALL_CLOCK_FLOOR} (deterministic hop budget terminates the walk) — found [${values.join(', ')}]`);
}

if (failures) { console.error(`\ngate-fails-closed: ${failures} FAILURE(S)`); process.exit(1); }
console.log('\ngate-fails-closed: ALL INVARIANTS HOLD');
