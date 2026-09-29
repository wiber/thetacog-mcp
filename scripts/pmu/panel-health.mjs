#!/usr/bin/env node
// scripts/pmu/panel-health.mjs — ONE health check every panel must pass, everywhere.
//
// WHY THIS EXISTS (operator, 2026-08-12: "we need an overarching rule to check panel health everywhere
// — we are constantly regressing on this point"). The regression is always the same shape and it has
// now happened at least five times: a panel is composed by a path that LOOKS right on screen, and
// nobody can tell by looking, because a wrong panel and a right panel are both "a grid with some
// colour in it". The specific instances, all recorded in the modules' own headers:
//
//   · walkShape().coords painted as lit/unlit 12×12 blocks (triptych-render: @forbidden-alternative)
//   · runPipeline heatmaps decoded as rgb × val/max — graded, but classify() drops the hues: 0 regions
//   · a fence from a coord bounding box, which is not the in-lane reference the classifier needs
//   · the blog/OG path calling renderTriptych WITHOUT domBlocks → everything reads as drift (2026-06-27)
//   · composeTolerancePanel calling renderTriptych WITHOUT cole → EDGE MODE never engaged, so the walk
//     never ran and the numbers were a bitmap decode, not a measurement (2026-08-12, this file's cause)
//
// The lesson each time: a panel cannot be checked by looking at it, and a per-surface check is a check
// that the next surface will not have. So the check lives HERE, it is about the MEASUREMENT and not the
// picture, and everything that makes a panel runs it.
//
// THE INVARIANTS. A healthy panel is one where:
//   1. WALK RAN        walkMode === 'ballistic-edges' — the definer walk on chip, both sides. Any other
//                      value means the coarse decode ran and every count below is a decode, not a walk.
//   2. APERTURE SET    startPixel ∈ [0,144) with well-formed actor/patient coords and grip > 0. The
//                      aperture is derived from the intent (sense → competence pixel → pickStartPixel);
//                      if it is missing, the walk had no point of view and "displacement" means nothing.
//   3. EDGES LIT       both sides carry lit edge cells. One dark side = nothing was compared.
//   4. LATTICE FULL    the panel is 144×144 (20,736 cells), not a 12×12 anchor-block paint.
//   5. PAINTED FLOOR   the classifier coloured more than COARSE_CEILING cells. The coarse path's
//                      signature on real prose is ~400–500 of 20,736 (~2%); a real edge render is
//                      thousands. This is the cheap tell that survives when someone bypasses meta.
//   6. σ PRESENT       matchSigma is a finite number — the walk scored itself against its own null.
//   7. ENCIRCLED       when regions are handed in: at least one region was detected and ringed. Zero
//                      regions is the "encircles nothing" failure, which renders as a bare grid.
//
// USE — three ways, and they are the same check:
//   import { panelHealth, assertPanelHealth } from './panel-health.mjs'
//   const h = panelHealth(meta, { regions })      → { ok, failures[], summary }
//   assertPanelHealth(meta, { surface: 'lens-receipt-email' })   → throws on an unhealthy panel
//   node scripts/pmu/panel-health.mjs --live      → compose a panel through the door and report
//
// Guard: tests/pmu/panel-health-everywhere.test.mjs — the census. It fails when a NEW surface composes
// a panel without going through the door, or draws a lattice of its own.

export const CELLS = 20736;          // 144 × 144
export const COARSE_CEILING = 600;   // observed coarse signature: 441–484 painted cells on real prose

const COORD = /^[ABC][123]?,[ABC][123]?$/;

/**
 * Check a composed panel's meta against the invariants. Pure — no I/O, no throw.
 * @param {object} meta      the meta from composeTolerancePanel / composeEncircledPanel
 * @param {object} [opts]    { regions?: array, surface?: string }
 * @returns {{ok: boolean, failures: string[], summary: string}}
 */
export function panelHealth(meta, { regions, surface } = {}) {
  const f = [];
  const m = meta || {};
  const where = surface ? `[${surface}] ` : '';

  // 1. THE WALK RAN.
  if (m.walkMode !== 'ballistic-edges') {
    f.push(`walk did not run — walkMode=${JSON.stringify(m.walkMode)}${m.walkNote ? ` (${m.walkNote})` : ''}; the numbers below are a bitmap decode, not a measurement`);
  }

  // 2. THE APERTURE IS SET.
  if (!Number.isInteger(m.startPixel) || m.startPixel < 0 || m.startPixel >= 144) {
    f.push(`aperture unset — startPixel=${JSON.stringify(m.startPixel)}`);
  }
  if (!COORD.test(String(m.actorCoord || ''))) f.push(`aperture actor coord malformed: ${JSON.stringify(m.actorCoord)}`);
  if (!COORD.test(String(m.patientCoord || ''))) f.push(`aperture patient coord malformed: ${JSON.stringify(m.patientCoord)}`);
  if (!(Number(m.pixGrip) > 0)) f.push(`competence pixel has no grip on the intent: ${JSON.stringify(m.pixGrip)}`);

  // 3. BOTH SIDES LIT.
  if (!(Number(m.intentCells) > 0)) f.push(`intent edge matrix is dark (${JSON.stringify(m.intentCells)} cells)`);
  if (!(Number(m.realityCells) > 0)) f.push(`reality edge matrix is dark (${JSON.stringify(m.realityCells)} cells)`);

  // 5. THE PAINTED FLOOR — the coarse signature.
  const painted = (Number(m.green) || 0) + (Number(m.amber) || 0) + (Number(m.red) || 0);
  if (painted <= COARSE_CEILING) {
    f.push(`only ${painted} of ${CELLS} cells classified (≤${COARSE_CEILING}) — that is the 12×12 anchor-block signature, not a 144×144 edge render`);
  }

  // 6. THE WALK SCORED ITSELF.
  if (!Number.isFinite(Number(m.matchSigma))) f.push(`no shape-match σ — the walk was never scored against its null`);

  // 7. SOMETHING WAS ENCIRCLED (only when the caller has regions to show).
  if (regions && regions.length === 0) f.push('0 regions detected — the panel encircles nothing');

  const summary = f.length === 0
    ? `${where}healthy · ${m.walkMode} · aperture ${m.actorCoord}→${m.patientCoord} grip ${m.pixGrip} · ${painted}/${CELLS} classified · σ ${m.matchSigma}`
    : `${where}UNHEALTHY (${f.length}): ${f[0]}`;
  return { ok: f.length === 0, failures: f, summary };
}

/** Throwing form — for composition paths that must not ship an unhealthy panel. */
export function assertPanelHealth(meta, opts = {}) {
  const h = panelHealth(meta, opts);
  if (!h.ok) throw new Error(`panel health failed${opts.surface ? ` on ${opts.surface}` : ''}:\n  - ${h.failures.join('\n  - ')}`);
  return h;
}

/** One-line status for logs and UI. Never throws. */
export function panelHealthLine(meta, opts = {}) {
  try { return panelHealth(meta, opts).summary; } catch (e) { return `panel health check errored: ${e?.message || e}`; }
}

// ── CLI ────────────────────────────────────────────────────────────────────────
// --live : compose a panel through the one door on known-good prose and report health. This is the
//          smoke test to run after touching ANYTHING in the panel chain.
if (import.meta.url === `file://${process.argv[1]}`) {
  const live = process.argv.includes('--live');
  if (!live) {
    console.log('usage: node scripts/pmu/panel-health.mjs --live');
    process.exit(0);
  }
  const intent = `The sixty-year war was fought over methods. The right question was never about the method. It was about the floor. Bits are weightless. A byte costs nothing to copy, nothing to store, nothing to move. That is the whole miracle and the whole problem. When the marginal cost of a copy is zero, the marginal cost of a lie is zero too. Every system we built for scarcity assumed the copy was expensive. None of them survive the copy being free.`;
  const reality = intent.replace('Bits are weightless.', 'Bits have no weight at all.');
  const { composeEncircledPanel } = await import('./tolerance-panel.mjs');
  const t0 = Date.now();
  const { regions, meta, surfaces } = await composeEncircledPanel({ intentText: intent, realityText: reality, label: 'health', sub: 'live check' });
  const h = panelHealth(meta, { regions, surface: 'composeEncircledPanel' });
  console.log(`\n  ${h.ok ? '✅' : '❌'} ${h.summary}`);
  for (const x of h.failures) console.log(`     - ${x}`);
  console.log(`     regions ${regions.length} · sides ${Object.keys(surfaces || {}).join(',') || 'none'} · ${Date.now() - t0}ms\n`);
  process.exit(h.ok ? 0 : 1);
}
