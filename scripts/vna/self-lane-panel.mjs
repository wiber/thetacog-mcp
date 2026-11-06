#!/usr/bin/env node
// scripts/vna/self-lane-panel.mjs — ENCIRCLE ALL THREE PANELS (VNA cockpit, 2026-09-07)
//
// GoalNegSp.txt, the operator, verbatim in substance: "you could even have three panels one intent
// one reality and one intent reality Delta, which is what we're doing right now we only do the
// circle panel on the third one, but we could do all of them."
//
// THE BLOCKER THIS SOLVES, and it is why nobody just did it: `classify()` in annotate-regions.mjs
// keys on EXACTLY three tolerance hues and returns 0 for anything else. The intent panel renders
// cyan and the reality panel amber, so feeding either to the encircle door today finds zero regions
// — the rings would be absent, not wrong, and an absent ring is invisible to every check that
// inspects rings that are present.
//
// THE FIX IS A PROJECTION, NOT A SECOND CLASSIFIER (ONE RULE LIVES IN ONE PLACE). This paints a
// matrix into the SAME three hues the tolerance panel paints, reusing `significantEdges` from
// triptych-render.mjs and the byte-exact GREEN/AMBER/RED constants, then hands it to the SAME
// detectRegions → encircleRegionsPng door the Δ panel and the commit email already call. Nothing
// here re-implements clustering, hue matching, or ring fitting.
//
// ── WHAT THE RINGS MEAN ON EACH PANEL, AND WHY MISLABELLING THEM WOULD MAKE THE INSTRUMENT LIE ──
// The Δ panel's bands mean DRIFT: reality fired where intent was weak. That meaning comes from
// measuring reality against INTENT's dominant blocks — two different corpora. On a single panel
// there is no second corpus, so drift is not available and claiming it would be fabrication.
// What IS available is SELF-DISPERSION: how far a corpus's own mass sits from its own centre.
//   INTENT  rings → how CONCENTRATED the declaration is. Red-heavy = you declared many unrelated
//                   things at once. That is a property of the declaration, never a fault in the work.
//   REALITY rings → how CONCENTRATED the work is. Red-heavy = the work sprayed across the lattice.
//                   Scattered work that matches a scattered declaration is IN LANE on the Δ panel
//                   and still red here, and those two readings are both correct.
//   Δ       rings → drift. UNCHANGED, canonical, and the only panel where a ring means out-of-lane.
//
// SUFFICIENCY CONTRACT (AXIOM 1 W6), printed rather than implied:
//   SUFFICIENT FOR: where a corpus's mass concentrates, and how tightly — re-runnable, LLM-free.
//   NOT SUFFICIENT FOR: whether the work is correct (Rice), and — on the intent and reality panels
//   specifically — whether anything drifted. Drift is a two-corpus question and one panel cannot
//   answer it. Read the Δ panel for that, and never narrate an intent ring as drift.
//
// @guard tests/vna/self-lane-panel.test.mjs
import { significantEdges, LIT_MASS_FLOOR as CANONICAL_LIT_MASS_FLOOR } from '../pmu/triptych-render.mjs';
import { detectRegions, localRegions } from '../pmu/regions-chip.mjs';
import { encircleRegionsPng, TOL_RGB } from '../pmu/annotate-regions.mjs';   // C18: one home for the palette

const N = 144, CELLS = N * N, NB = 12;

// The EXACT hues the tolerance panel paints. classify() anchors on these; any other value is
// dropped as a foreign hue and would encircle nothing. Never "close enough" — byte-exact.
const GREEN = TOL_RGB.green, AMBER = TOL_RGB.amber, RED = TOL_RGB.red;   // C18: imported, never re-typed
const BG = 5;

// The same lit-mass floor the Δ panel enforces. A thin corpus builds no lattice mass, and absence
// classifying as a clean concentrated panel is the exact failure the Δ floor exists to stop.
// "The cheapest strategy must never be silence."
// C18: RE-EXPORTED, never re-declared. The floor that decides a refusal lives in
// triptych-render.mjs; two homes meant one surface could refuse while the other rendered.
export const LIT_MASS_FLOOR = CANONICAL_LIT_MASS_FLOOR;

/**
 * Paint a 144×144 heat matrix into tolerance hues by SELF-DISPERSION: bands each significant cell
 * by Chebyshev block distance to the corpus's OWN dominant blocks.
 *
 * The dominant-block rule is lifted verbatim from decodeDeltaThreeColourEdges (mass >= 10% of the
 * peak block) so "dominant" means the same thing on all three panels. A different threshold here
 * would make the intent panel's green disagree with the green the Δ panel computed from the same
 * intent matrix, and two panels disagreeing about one corpus is how an instrument loses trust.
 */
export function selfLaneRgba(matrix, { k = 1.0 } = {}) {
  const rgba = new Uint8Array(CELLS * 4);
  for (let i = 0; i < CELLS; i++) { rgba[i * 4] = BG; rgba[i * 4 + 1] = BG; rgba[i * 4 + 2] = BG; rgba[i * 4 + 3] = 255; }
  const sig = significantEdges(matrix, { k });

  let mass = 0; for (let i = 0; i < CELLS; i++) if (sig[i]) mass++;
  if (mass < LIT_MASS_FLOOR) {
    return { rgba, green: 0, amber: 0, red: 0, dispersionPct: null, refused: true, litMass: mass,
      refusal: `LIT-MASS FLOOR — ${mass} significant cells (floor ${LIT_MASS_FLOOR}); too thin to band. UNMEASURED, never a pass.` };
  }

  const blkOf = (i) => [Math.floor(Math.floor(i / N) / NB), Math.floor((i % N) / NB)];
  const blockMass = new Float64Array(144);
  for (let i = 0; i < CELLS; i++) if (sig[i]) { const [br, bc] = blkOf(i); blockMass[br * 12 + bc] += matrix[i] || 1; }
  let peak = 0; for (let b = 0; b < 144; b++) if (blockMass[b] > peak) peak = blockMass[b];
  const dom = [];
  for (let b = 0; b < 144; b++) if (peak > 0 && blockMass[b] >= 0.10 * peak) dom.push([Math.floor(b / 12), b % 12]);
  if (!dom.length) dom.push([0, 0]);
  const dist = (br, bc) => { let m = Infinity; for (const [dr, dc] of dom) m = Math.min(m, Math.max(Math.abs(br - dr), Math.abs(bc - dc))); return m; };

  let mx = 1; for (let i = 0; i < CELLS; i++) if (sig[i] && matrix[i] > mx) mx = matrix[i];
  let green = 0, amber = 0, red = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!sig[i]) continue;
    const [br, bc] = blkOf(i);
    const d = dist(br, bc);
    const hue = d === 0 ? GREEN : d === 1 ? AMBER : RED;
    if (d === 0) green++; else if (d === 1) amber++; else red++;
    // same brightness ramp as the tolerance panel, so a cell of equal mass reads equally bright
    // across all three panels and brightness never becomes a fourth, uncalibrated channel.
    const v = 0.45 + 0.55 * Math.log(1 + 9 * (matrix[i] || 0) / mx) / Math.LN10;
    const o = i * 4;
    rgba[o] = Math.floor(hue[0] * v); rgba[o + 1] = Math.floor(hue[1] * v); rgba[o + 2] = Math.floor(hue[2] * v);
  }
  const total = green + amber + red || 1;
  return { rgba, green, amber, red, dispersionPct: Math.round(100 * red / total), refused: false,
    litMass: mass, domBlockCount: dom.length };
}

/**
 * The full door: matrix → banded rgba → the SAME detectRegions/encircleRegionsPng chain the Δ panel
 * uses → { png, regions, counts }. A refused (too-thin) matrix returns png:null and its refusal,
 * never a blank panel dressed as a clean one.
 */
export function encircleSelfLane(matrix, { k = 1.0, scale = 4 } = {}) {
  const band = selfLaneRgba(matrix, { k });
  if (band.refused) return { ...band, png: null, regions: [] };
  // A ring spanning half the lattice is a BAND, not a cluster; it is reported rather than drawn.
  const { drawn, fieldWide } = localRegions(detectRegions(band.rgba));
  // C20: a self-lane ring is DISPERSION (the declaration or the work sprayed over itself), never drift — said on the region
  const regions = drawn.map((r) => ({ ...r, semantics: 'dispersion' }));
  const png = encircleRegionsPng(band.rgba, regions, { scale });
  return { ...band, png, regions, fieldWide };
}

export const PANEL_MEANING = {
  intent:  'ring = a cluster of DECLARED mass. Red = the declaration is dispersed across unrelated lanes. NOT drift.',
  reality: 'ring = a cluster of PERFORMED mass. Red = the work is dispersed across unrelated lanes. NOT drift.',
  delta:   'ring = DRIFT. green in-lane · amber adjacent bleed · red orthogonal — the only panel where a ring means out-of-lane.'
};
