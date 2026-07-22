// src/lib/pmu/unified-drift.mjs — THE ONE DRIFT ENGINE (chat receipt === commit gate).
// =============================================================================
// THE UNIFICATION (operator mandate, 2026-06-30). A read-only trace proved the two σ's were two
// different implementations on the SAME text:
//   · the CHAT path (scripts/pmu/prompt-lens.mjs → compress.mjs placePixel) computed σ as a JS
//     gzip-NCD z-score and NEVER ran the walk;
//   · the COMMIT path (spec-deliver-walk.mjs → definerWalk144 → pmu-onchip --ballistic) ran the
//     REAL Rust on-chip ballistic walk and computed a shape-coverage %.
// Two systems = zero systems: they diverge on the same input. This module is the ONE engine both
// import. The walk invocation, WALK_OPTS, seed/litScores logic, and the binary path are LITERALLY the
// same code for the chat receipt and the commit gate.
//
// THE WALK IS ALWAYS THE REAL RECURSIVE ON-CHIP BALLISTIC WALK (CLAUDE.md · "PMU / COMPETENCE WALK"):
// definerWalk144 → one `pmu-onchip --ballistic` process per hop, row → significant column → TRANSPOSE
// → recurse. NEVER the analytic shortcut (placePixel placement, --walk converged/diffusion, a JS BFS,
// Monte-Carlo-as-the-walk). The ONLY non-metal path is the explicit, MARKED gzip-fallback (binary
// missing or a walk that blew a tight wall-clock timeout) — never a silent claim of metal.
//
//   walkShape(text, opts) → { shape:Set, sigma, coords, plies, cells, seed, sensor, ms, heat, raw }
//   shapeCoverage(intentShape, realityShape) → the commit gate's σ (cover / realitySet.size, %).
//
// @canonical-algorithm  the real recursive on-chip ballistic walk (definerWalk144 / pmu-onchip --ballistic)
// @forbidden-alternative  any second walk implementation · gzip-NCD-z-score-AS-the-walk · analytic shortcut
// @guard  tests/lens/pipeline-unity.test.js · tests/pmu-simulator/competence-walk-is-real.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { definerWalk144, COORDS } from '../../../scripts/pmu/definer-walk-144.mjs';
import { resolvePmuBinary } from './pmu-binary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const LIB144 = resolve(REPO_ROOT, 'data/pmu/snippet-library-144.json');
// THE ONE resolver (pmu-binary.mjs) — searches the canonical location set so every calling context
// (commit gate, chat/lens, blog panel, package) lands on the same binary. PMU_BINARY still forces
// "absent" (→ marked gzip-fallback) for the guard. Default = the same on-chip binary definerWalk144 runs.
const DAEMON = resolvePmuBinary(REPO_ROOT);

// re-export COORDS so callers get the labels from the one engine (no second axis table).
export { COORDS };

// ── THE WALK KNOBS — IDENTICAL to the commit gate (spec-deliver-walk WALK_OPTS/SEED_K) ──────────────
// budgetMs huge so the DETERMINISTIC hop budget (not wall-clock) terminates the walk — byte-stable σ on
// recompute requires the cap be a hop count, not machine speed. SEED_K=3 + maxDepth=2 = a TIGHT
// localized cloud (wide/deep floods to ~90/144 and σ degenerates to |shape|/144, content-independent).
export const WALK_OPTS = { maxDepth: 2, topK: 3, budget: 120, budgetMs: 600000 };
export const SEED_K = 3;
// ── CHAT-WALK SHALLOW DEPTH (operator 2026-06-30, the saturation finding) ───────────────────────────
// The chat receipt's walk must stay SHALLOW so the 144-cloud never saturates (a saturated lattice →
// |shape|/144 → σ content-independent → meaningless). A depth sweep (scripts/pmu/.depthprobe, recorded
// in the ledger) measured: discrimination (stripe∩blog Jaccard) PLATEAUS at depth 2 (0.63), the 144-shape
// is byte-stable from depth 2 through 4, and depth 1 UNDER-discriminates (0.67). Depths 3-4 add 1.5-9× the
// PMU ms and 2-4× the matrix fill with ZERO shape/discrimination gain. So depth 2 is the SHALLOWEST depth
// that still discriminates domains — the measured floor. Named + decoupled from the commit-gate WALK_OPTS
// so a future commit-side depth bump can't silently deepen (and saturate) the chat walk. Tunable via env
// for re-measurement only. Guarded by tests/lens/target-gate.test.js (sub-gate 6: fill ≤ 70%).
export const CHAT_WALK_MAX_DEPTH = Number(process.env.LENS_CHAT_WALK_DEPTH || 2);
export const CHAT_WALK_OPTS = { ...WALK_OPTS, maxDepth: CHAT_WALK_MAX_DEPTH };
// the saturation ceiling: above this lattice fill the σ is untrustworthy (the receipt renders ⚠ SATURATED).
export const SATURATION_FILL_PCT = Number(process.env.LENS_SATURATION_FILL_PCT || 70);
// the floor that turns a normalized walk-heat field into a SHAPE (the commit gate's --floor default).
export const SHAPE_FLOOR = 0.30;
// the wall-clock safety net for the CHAT path only (commit passes timeoutMs:0 → never races, always
// completes deterministically). The walk is ~tens of ms on chip; this only trips on a missing/slow box.
export const WALK_TIMEOUT_MS = Number(process.env.PMU_WALK_TIMEOUT_MS || 2000);

// ── UNPLACED / SMALL-DIFF-FLOOR FIX (operator 2026-07-01) — the CATO σ=0 blind spot, HONESTLY ────────
// THE BUG (measured, CATO wrong-db commit 546c50165): when a NON-BLANK diff's reality text shares NO
// vocabulary with any of the 144 lattice snippets, gzip-NCD lights ZERO anchors → topSeeds empty →
// the fallback returned sigma:zMargin(all-zeros)=0. A 2-file off-domain change thus read σ≈0 =
// "no drift / perfectly in-lane" — an UNDER-alarm, EXACTLY backwards.
// THE OVER-CORRECTION (also wrong): forcing that same case to weightedBleed 1 / Δ-spread 11 / σ=max makes
// it read OUT / max-drift. That is a FALSE ALARM — for a compliance instrument, as bad as the blind spot:
// a commit we simply COULD NOT PLACE on the lattice (e.g. the CATO commit, actually IN-LANE) gets reported
// as maximally out-of-lane. Neither σ=0-clean nor forced-OUT is honest.
// THE HONEST THIRD VERDICT: `UNPLACED` = "we could not place this on the lattice, so we make NO drift claim
// either way." Non-blank + zero-placement → a DISTINCT `unplaced` sensor state carrying an out-of-band σ
// SENTINEL (never a spurious 0, never a real z-score) that a consumer MAPS to UNPLACED; and evaluateDrift
// returns { verdict:'UNPLACED', weightedBleed:null, coverage:null } — no numeric extreme in either
// direction. Deterministic (no LLM, no randomness).
// FLAG: set PMU_UNPLACED_DRIFT=0 to restore the legacy σ=0 fallback for strict byte-reproducibility of an
// old panel. The DEFAULT is now the honest UNPLACED. TRUE blank/empty text still falls back to σ=0
// (genuinely nothing to place — unchanged; that is a real "nothing here", not an unplaceable something).
export const UNPLACED_DRIFT = process.env.PMU_UNPLACED_DRIFT !== '0';
// σ sentinel for the unplaced reading. Deliberately OUT of any real z-score band (zMargin sharpness rarely
// exceeds ~10) so a scalar-only consumer can NEVER mistake it for a sharp-placement 0 (clean) OR read it as
// a real drift number — it is a flag-in-scalar-clothing that maps to UNPLACED. Paired with sensor:'unplaced'
// + unplaced:true for consumers that key on the state directly.
export const UNPLACED_SIGMA = Number(process.env.PMU_UNPLACED_SIGMA || 99);

// ── the 144 snippet targets the chip senses against (intent/reality → lattice projection) ──
let rawLib = JSON.parse(readFileSync(LIB144, 'utf8'));
if (!Array.isArray(rawLib)) rawLib = rawLib.anchors || rawLib.nodes || [];
const AX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const aIdx = a => AX.indexOf(a);
const libAnchors = new Array(144).fill(null);
for (const a of rawLib) { const r = aIdx(a.row), c = aIdx(a.col); if (r >= 0 && c >= 0) libAnchors[r * 12 + c] = a; }
export const targets = libAnchors.map(a => (a && (a.snippet || a.seed)) || '');

// ── text → 144 SELECTIVE lattice scores via gzip-NCD (the CANONICAL PRIMARY sensor) ──
// gzip-NCD (compress.mjs:ncdSim, the placePixel/pipeline PRIMARY) is SELECTIVE: unrelated prose shares
// no compression with a technical snippet → similarity ≈ 0; on-topic prose compresses together → high.
export const gzipLen = s => gzipSync(Buffer.from(String(s), 'utf8')).length;
const SNIP_Z = targets.map(t => (t ? gzipLen(t) : 0));   // precompute snippet gzip lengths once
export function ncdSim(docZ, doc, snip, snipZ) {
  if (!snip) return 0;
  const joinZ = gzipLen(`${doc}\n${snip}`);
  const denom = Math.max(docZ, snipZ);
  return denom === 0 ? 0 : Math.max(0, 1 - (joinZ - Math.min(docZ, snipZ)) / denom);
}
export function litScores(text) {
  if (!text || !text.trim()) return new Array(144).fill(0);
  const docZ = gzipLen(text);
  return targets.map((t, i) => ncdSim(docZ, text, t, SNIP_Z[i]));
}
export const confidencePixel = (scores) => { let best = -1, bv = -Infinity; for (let i = 0; i < 144; i++) { if (!COORDS[i]) continue; if (scores[i] > bv) { bv = scores[i]; best = i; } } return best; };
export const norm = (a) => { const m = Math.max(...a) || 1; return a.map(x => x / m); };
// the K strongest SELECTIVE landings (gzip-NCD), tie-broken by index for a deterministic seed set.
export function topSeeds(scores, k = SEED_K) {
  return scores.map((v, i) => [v, i]).filter(x => COORDS[x[1]] && x[0] > 0)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, k).map(x => x[1]);
}

// ── σ-margin: top score's z-score vs the rest (placement sharpness) ──
// Used for the gzip-fallback receipt σ (the OLD chat number, honestly marked as a fallback) AND, when
// the metal walk ran, recomputed over the WALK HEAT so the chat σ is REAL-WALK-DERIVED placement.
function zMargin(values) {
  const xs = values.filter(v => v > 0).sort((a, b) => b - a);
  if (xs.length < 2) return 0;
  const top = xs[0];
  const rest = xs.slice(1);
  const mean = rest.reduce((a, b) => a + b, 0) / rest.length;
  const variance = rest.reduce((a, b) => a + (b - mean) ** 2, 0) / rest.length;
  const std = Math.sqrt(variance);
  return std > 0 ? +((top - mean) / std).toFixed(2) : 0;
}

// outer wall-clock timeout — chat-path safety net ONLY (timeoutMs falsy → no race, deterministic).
async function withTimeout(promise, ms) {
  if (!ms) return promise;
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('walk-timeout')), ms); });
  try { return await Promise.race([promise, timer]); } finally { clearTimeout(t); }
}

function shapeFromHeat(heat, floor) {
  const shape = new Set();
  for (let i = 0; i < 144; i++) if (heat[i] > floor) shape.add(i);
  return shape;
}

// ── walkShape — THE ONE WALK. Run the REAL on-chip ballistic walk on the seeds derived from `text`. ──
// opts:
//   floor      shape threshold over the normalized walk heat (default SHAPE_FLOOR)
//   scores     precomputed litScores(text) (the commit path passes its already-computed projection so
//              the gzip-NCD projection is not recomputed — byte-identical, just not doubled)
//   timeoutMs  chat-path wall-clock safety net; 0/null = no race (commit path, deterministic)
// returns { shape, sigma, coords, plies, cells, seed, sensor, ms, heat, raw } — `raw` carries the full
// definerWalk144 result (heat/ply/hops/maxPly/matrix) so the commit gate keeps every field it had, and
// the follow-up trace persister gets coords/plies/cells/seed provenance for free.
export async function walkShape(text, { floor = SHAPE_FLOOR, scores = null, timeoutMs = 0, opts = WALK_OPTS } = {}) {
  const t0 = performance.now();
  // ── UN-IDLE THE GZIP (operator 2026-06-30) — litScores runs the CANONICAL gzip-NCD sensor over the 144
  // targets to SEED the walk: REAL gzip work on EVERY chat prompt that was previously HIDDEN inside the
  // walk's wall-clock ms (the receipt showed "gzip 0ms" while gzip actually ran — an idle-but-running
  // signal = a UTILIZATION FAILURE). Time it in MICROSECONDS so the receipt can surface the TRUE gzip
  // contribution and never a misleading 0. When the caller PRECOMPUTES `scores` (the commit path passes
  // its already-computed projection so gzip isn't doubled) NO gzip is done in this call → seedGzipUs 0,
  // honestly (this call did no gzip work; the caller paid for it).
  const tSeed = performance.now();
  const sc = scores || litScores(text);
  const seedGzipUs = scores ? 0 : Math.round((performance.now() - tSeed) * 1000);
  const seed = topSeeds(sc);
  const seedCoords = seed.map(i => COORDS[i]);

  // gzip-FALLBACK: the binary is absent (or forced absent via PMU_BINARY) — degrade to gzip placement
  // and MARK the receipt. Never silently claim metal. Empty seeds also land here (no walk to run).
  const fallback = (reason) => {
    const heat = norm(sc);                                  // the selective gzip projection, normalized
    const shape = shapeFromHeat(heat, floor);
    return {
      shape, heat, raw: null,
      sigma: zMargin(sc),                                   // the OLD chat z-score, honestly fallback-marked
      coords: [...shape].map(i => COORDS[i]),
      plies: 0, hops: 0, cells: shape.size, seed, seedCoords,
      // no cloud was walked in the fallback (gzip placement only) — fill is honestly 0, walks/s 0.
      matrixCells: 0, fillPct: 0, walksPerSec: 0, saturated: false,
      seedGzipUs,                                           // the seed gzip-NCD work (litScores) STILL ran here
      sensor: 'gzip-fallback', fallback_reason: reason,
      ms: +(performance.now() - t0).toFixed(2),
    };
  };
  // UNPLACED (the CATO σ=0 fix, done honestly): text is NON-BLANK yet lights ZERO anchors → it lands
  // NOWHERE on the lattice. That is neither clean (σ=0 under-alarm) NOR max-drift (forced-OUT over-alarm):
  // it is an HONEST THIRD STATE — we could not place it, so we make no drift claim. Independent of the
  // daemon (no seeds → no walk to run anyway). Distinct sensor + out-of-band σ SENTINEL so it can NEVER
  // read as a spurious in-lane 0 OR as a real drift number. Blank text still routes to the σ=0 fallback
  // below (genuinely nothing to place). Gated: PMU_UNPLACED_DRIFT=0 restores the legacy σ=0 fallback.
  const blank = !text || !text.trim();
  const unplaced = (reason) => ({
    shape: new Set(), heat: new Array(144).fill(0), raw: null,
    sigma: UNPLACED_SIGMA,                                 // out-of-band sentinel → UNPLACED, NOT a 0 nor a real σ
    coords: [], plies: 0, hops: 0, cells: 0, seed: [], seedCoords: [],
    matrixCells: 0, fillPct: 0, walksPerSec: 0, saturated: false,
    seedGzipUs,                                            // the seed gzip-NCD work (litScores) STILL ran here
    sensor: 'unplaced', unplaced: true, fallback_reason: reason,
    ms: +(performance.now() - t0).toFixed(2),
  });
  if (UNPLACED_DRIFT && !seed.length && !blank)
    return unplaced('non-blank text, zero gzip-NCD lattice placement (off-domain / unknown vocabulary)');
  if (!existsSync(DAEMON)) return fallback('pmu-onchip binary absent');
  if (!seed.length) return fallback('no lit seeds (empty/blank text)');

  // THE METAL: the real recursive on-chip ballistic walk.
  let raw;
  try {
    raw = await withTimeout(definerWalk144(seed, opts), timeoutMs);
  } catch (e) {
    return fallback(`walk failed/timed-out: ${e && e.message ? e.message : e}`);
  }
  const heat = norm(raw.heat);
  const shape = shapeFromHeat(heat, floor);
  // ── WALK READOUT (operator 2026-06-30): fill = lit cells of the 144×144 cloud / 20736. The cloud
  // (raw.matrix) is what saturates at depth; the receipt surfaces fill so a saturated walk (σ meaningless)
  // is VISIBLE. walks/s = lit cells / walk-seconds (the defined throughput of THIS chat walk, not a peak).
  let matrixCells = 0; for (const v of raw.matrix) if (v > 0) matrixCells++;
  const fillPct = +(100 * matrixCells / 20736).toFixed(2);
  const ms = +(performance.now() - t0).toFixed(2);
  const walksPerSec = ms > 0 ? Math.round(matrixCells / (ms / 1000)) : 0;
  return {
    shape, heat, raw,
    sigma: zMargin(raw.heat),                               // REAL-WALK-DERIVED placement sharpness (z-score)
    coords: [...shape].map(i => COORDS[i]),
    plies: raw.maxPly, hops: raw.hops, cells: shape.size, seed, seedCoords,
    matrixCells, fillPct, walksPerSec, saturated: fillPct > SATURATION_FILL_PCT,
    seedGzipUs,                                             // the always-on gzip-NCD seeding time (μs)
    sensor: 'metal',
    ms,
  };
}

// ── shapeCoverage — the COMMIT GATE's σ, EXACTLY as spec-deliver-walk computes it today ──
// "how much of what the room built (realityShape) lands on what the spec asked for (intentShape)."
// cover / realitySet.size, as an integer %. Empty reality → 0 (the existing guard).
export function shapeCoverage(intentShape, realityShape) {
  if (!realityShape || realityShape.size === 0) return 0;
  let cover = 0;
  for (const i of realityShape) if (intentShape.has(i)) cover++;
  return Math.round(100 * cover / realityShape.size);
}

// =============================================================================
// TEMPORAL TOPOGRAPHY + WEIGHTED BLEED — the "infinite temporal walk" drift upgrade
// (operator 2026-06-30). ALL exports below are ADDITIVE: shapeCoverage / walkShape / the default
// commit path are UNCHANGED (validate-dogfood stays byte-identical). The upgrade carries BOTH numbers
// — coverage stays primary-compatible, weightedBleed is the licensable refinement.
// =============================================================================
//
// THE PROBLEM the upgrade fixes. shapeCoverage is UNWEIGHTED set-cardinality (|R∩I|/|R|). An uncapped /
// deeper walk makes raw accumulated mass GROW with depth — path convergence: the per-ply lit-cell count
// of the 144×144 cloud measured 1 → 12 → 144 → 1666 → 19156 at depth 4 (≈6–23× branching per ply). So an
// UNWEIGHTED / raw-accumulated "infinite" walk EXPLODES and blinds σ (everything saturates lit).
//
// THE FIX — TEMPORAL DECAY. Weight every cell by α^firstDepth, where firstDepth = the FIRST ply the cell
// was lit (the Rust ballistic walk emits this as `first_depth`; surfaced JS-side as raw.ply per anchor).
// With α SMALL enough to beat the branching (α=0.05 ≪ 1/branching) the geometric decay dominates: the
// seed spike (t≤1) holds the majority of the mass and the total CONVERGES (bounded) no matter how deep
// the walk runs. α=0.5 is uselessly slow-decaying (late plies dominate); α must be ~0.05. α is a tunable
// const, proven bounded + seed-spike-dominated at high depth by tests/pmu/temporal-drift.test.js.
//
// THE DRIFT METRIC (operator REJECTED centroids):
//   PRIMARY  σ = weighted Semantic Bleed Ratio = 1 − Σ w(i)·[i∈I∩R] / Σ w(i)·[i∈R], w(i)=α^firstDepth(i).
//            shapeCoverage upgraded from set-cardinality to temporal-mass weight. Sprawl-aware.
//   SECONDARY Δ-spread = the max Chebyshev (king-move) distance from any reality-mass cell to the NEAREST
//            intent-shape cell — "how far the worst bleed travelled out of the lane". Sprawl-AWARE.
//   FORBIDDEN center-of-mass-to-center-of-mass distance: a TIGHT intent + a SPRAWLING reality can share a
//            COM → COM-distance ≈ 0 masks catastrophic sprawl. Proven in the centroid-counterexample test
//            (tight 4-cell intent + symmetric sprawl share a centroid → weighted-bleed HIGH, COM-dist ~0).

// α — the temporal-decay base. SMALL (default 0.05) to beat the per-ply branching factor so the seed
// spike dominates and the α-weighted mass converges. Tunable for re-measurement only.
export const ALPHA = Number(process.env.PMU_TEMPORAL_ALPHA || 0.05);

// COMMIT_WALK_DEPTH — the α-bounded "infinite" walk depth for the COMMIT drift TOPOGRAPHY ONLY. The chat
// walk stays SHALLOW (CHAT_WALK_MAX_DEPTH=2 — saturation floor; NEVER deepened here). This deeper walk is
// only used where the richer temporal topography is wanted; α-decay keeps its mass bounded (proven).
export const COMMIT_WALK_DEPTH = Number(process.env.PMU_COMMIT_WALK_DEPTH || 8);
export const COMMIT_WALK_OPTS = { ...WALK_OPTS, maxDepth: COMMIT_WALK_DEPTH };

// ── temporalHeat — the 144-length α^firstDepth weighted heat field ───────────────────────────────────
// firstDepth(i) = raw.ply[i] (the first ply anchor i was lit; -1 = never lit → weight 0). Bounded by
// construction: each anchor contributes α^firstDepth, geometric in depth, so the seed (ply 0 → weight 1)
// dominates and deep cells vanish. Falls back to the walk's own normalized heat when raw/ply is absent
// (the gzip-fallback path has no firstDepth) so evaluateDrift never throws on a degraded sensor.
export function temporalHeat(raw, alpha = ALPHA) {
  const w = new Array(144).fill(0);
  if (raw && Array.isArray(raw.ply)) {
    for (let i = 0; i < 144; i++) { const d = raw.ply[i]; if (d >= 0) w[i] = Math.pow(alpha, d); }
    return w;
  }
  if (raw && Array.isArray(raw.heat)) { const h = norm(raw.heat); for (let i = 0; i < 144; i++) w[i] = h[i]; }
  return w;
}

// ── alphaWeightedMass — the boundedness proof primitive ──────────────────────────────────────────────
// Σ_p count_p · α^p over a per-ply lit-cell-count distribution. Unweighted (α=1) GROWS without bound as
// the walk deepens (the explosion); α < 1/branching CONVERGES (bounded). The α-decay guard feeds it the
// measured per-ply cloud counts and asserts the convergence.
export function alphaWeightedMass(plyCounts, alpha = ALPHA) {
  let m = 0;
  for (let p = 0; p < plyCounts.length; p++) m += plyCounts[p] * Math.pow(alpha, p);
  return m;
}

// ── weightedBleed — the PRIMARY σ (weighted Semantic Bleed Ratio) ────────────────────────────────────
//   σ = 1 − Σ_{i∈I∩R} w(i) / Σ_{i∈R} w(i),  w(i)=realityHeat[i] (= α^firstDepth, temporal).
// "what fraction of the reality MASS landed OUTSIDE the intent lane." shapeCoverage upgraded from
// set-cardinality to temporal mass. Range [0,1]: 0 = reality fully in-lane, →1 as reality bleeds out.
// Sprawl-aware: every lit out-of-lane reality cell adds its (recency-weighted) mass to the denominator
// but not the numerator. floor default 0 = any lit cell counts (the full sprawl-aware cloud); membership
// is "lit" not the tight shape-floor so distant sprawl is never silently dropped. Empty reality → 0.
export function weightedBleed(intentHeat, realityHeat, floor = 0) {
  let num = 0, den = 0;
  for (let i = 0; i < 144; i++) {
    const rw = realityHeat[i];
    if (rw > floor) { den += rw; if (intentHeat[i] > floor) num += rw; }
  }
  return den === 0 ? 0 : +(1 - num / den).toFixed(4);
}

// ── chebyshevSpread — the SECONDARY Δ-spread (max king-move out of lane) ──────────────────────────────
// The max Chebyshev (king-move) distance from any reality-mass cell to the NEAREST intent-shape cell, on
// the 12×12 ShortLex axes (cell i → row=⌊i/12⌋, col=i%12; both are AX ordinal indices). "How far the
// worst bleed travelled out of the lane." Grows with the worst out-of-lane reach. No intent lane → 11
// (max king-move on the 12×12). No reality mass → 0.
const _cheb = (i, j) => {
  const r1 = Math.floor(i / 12), c1 = i % 12, r2 = Math.floor(j / 12), c2 = j % 12;
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
};
export function chebyshevSpread(intentShape, realityHeat, floor = 0) {
  const I = [...intentShape];
  if (!I.length) return 11;
  let maxD = 0;
  for (let i = 0; i < 144; i++) {
    if (realityHeat[i] > floor) {
      let minD = Infinity;
      for (const q of I) { const d = _cheb(i, q); if (d < minD) minD = d; if (minD === 0) break; }
      if (minD > maxD) maxD = minD;
    }
  }
  return maxD;
}

// ── evaluateDrift — carry BOTH numbers additively, GATED behind {weighted} ───────────────────────────
// Default ({weighted:false}) returns ONLY { coverage, sensor } — IDENTICAL to the existing shapeCoverage
// path, so the commit gate's byte output is untouched. {weighted:true} ADDS the temporal upgrade:
// weightedBleed (primary σ) + deltaSpread (secondary), computed from the walks' per-cell firstDepth.
export function evaluateDrift(intentWalk, realityWalk, { weighted = false, alpha = ALPHA } = {}) {
  // UNPLACED reality = the delivered work landed NOWHERE on the competence lattice (off-domain/unknown
  // vocabulary → zero gzip-NCD placement, the CATO σ=0 case). This is the HONEST THIRD VERDICT — neither
  // a clean IN (a spurious σ=0/weightedBleed 0 UNDER-alarm) NOR a false OUT (forcing weightedBleed 1 /
  // Δ-spread 11 is an OVER-alarm — for a compliance instrument, as bad as a blind spot: it reports an
  // unplaceable-but-possibly-in-lane commit, like the CATO one, as maximally out-of-lane). We make NO drift
  // claim either way: verdict 'UNPLACED', the numeric drift fields null, so a scalar consumer maps UNPLACED
  // and never silently to 0 or to a real number. Consumers that require a number (greeks, predictive-validity)
  // already null-guard weightedBleed and thus abstain honestly. Gated by PMU_UNPLACED_DRIFT so the legacy
  // path stays byte-reproducible when disabled.
  const realityUnplaced = UNPLACED_DRIFT && realityWalk && realityWalk.unplaced;
  if (realityUnplaced) {
    const out = {
      unplaced: true,
      verdict: 'UNPLACED',
      coverage: null,                                       // no placement → no coverage claim, not a 0
      sensor: realityWalk.sensor || intentWalk.sensor || null,
    };
    if (weighted) { out.weightedBleed = null; out.deltaSpread = null; }  // no drift claim either way
    return out;
  }
  const out = {
    coverage: shapeCoverage(intentWalk.shape, realityWalk.shape),
    sensor: realityWalk.sensor || intentWalk.sensor || null,
  };
  if (weighted) {
    const iHeat = temporalHeat(intentWalk.raw || { heat: intentWalk.heat }, alpha);
    const rHeat = temporalHeat(realityWalk.raw || { heat: realityWalk.heat }, alpha);
    out.weightedBleed = weightedBleed(iHeat, rHeat, 0);
    out.deltaSpread = chebyshevSpread(intentWalk.shape, rHeat, 0);
  }
  return out;
}

export { DAEMON as PMU_DAEMON_PATH };
