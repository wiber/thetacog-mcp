#!/usr/bin/env node
// scripts/pmu/sigma-localize.mjs — σ_LOCALIZE: how unlikely is it the edit landed in the RIGHT zone?
// =============================================================================
// THE MEASURE the brain-surgeon demo was missing (operator, 2026-06-11): "How unlikely is it that
// the edit localized to the right area? σ is the right way to think about it" — then ITERATE TO
// INCREASE it. The two-commit probe (baseline 5b875a47b → perturbation 4321b12c7, brain surgery →
// plumbing in the probe doc engineered to live at B3,B3) produced a pair of triptych emails; this
// script turns that pair into ONE z-scored number, percentile-placed against history, banded and
// verdicted from the shared legend (sigma-legend.mjs 'localize').
//
// ALGORITHM — DETERMINISTIC, sense-only (the walk is NEVER invoked; like σ_response, a bad
// σ_localize implicates ingest/seed-library, never walk execution). It is the commit-triptych
// senseDecompose form — claim-level on the 20,736-cell ordered-pair lattice — because that is the
// level where the demo's evidence actually showed (pre-walk overlap 89%→12%, off-lane 0%→20%);
// measured 2026-06-11, the pair-lattice form also separates better than the whole-doc senseDoc
// (z −0.64) or a 144-anchor claim-mean (z −0.48) on this same pair:
//   1. The edited DOC files = the perturbation commit's own diff (git diff-tree), doc-kind only.
//      Both sides' texts are the COMMITTED BLOBS (git show <sha>:<path>) — nothing from the
//      working tree, so the measure is reproducible bit-for-bit from the two shas.
//   2. Per side, the senseDecompose SCORE field (graded, pre-θ — deltas of the graded field are
//      what localize; the binarized grid quantizes them away):
//        claims      = salienceRank(claimify(text)).slice(0, 160)      (the commit-triptych form)
//        score[i,j]  = max over claim sigs of 1 − hamming(claimSig, pairSig[i,j])/SIG_BITS
//      pairSig[i,j] = simhash of node_i+' '+node_j (ordered) — SHARED with commit-triptych via the
//      same .thetacog/cache/pair-sigs-144-<libSha>.json cache (same key derivation, bit for bit).
//   3. delta = pert − base per cell (both INTENT-side — it is a doc edit); absd = |delta|.
//   4. ZONE MASSES — the probe's row+col localization neighborhood, z-scored, over ALL 144 anchor
//      zones: zoneMass[t] = Σ absd over row t ∪ col t of the 144×144 (287 cells). The target zone
//      is one draw from that 144-zone distribution — that is what "how unlikely" means here.
//   5. σ_localize = (zoneMass[target] − median(elsewhere)) / std(elsewhere) — the perturbation-
//      probe estimator form (median centre, population std, target excluded from the background;
//      an elsewhere outlier INFLATES std and DEFLATES σ — fails conservative, cannot be gamed up).
//   6. Percentile vs history: data/pmu/measure-history.ndjson gains sigmaLocalize entries (the
//      percentile is computed BEFORE this run joins the ledger — ranked against the past, never
//      against itself).
//
// BANDS (sigma-legend 'localize', edges exact at 1/3/6): <1 chance · 1–3 weak · 3–6 localized ·
// ≥6 outstanding.
//
// @canonical-algorithm  committed blobs → senseDecompose score fields (claimify + salienceRank →
//   max claim sim vs the 20,736 ordered pair sigs, cache shared with commit-triptych) → |Δ| zone
//   masses over ALL 144 anchor zones (row+col in the 144×144) → z-score of the TARGET zone →
//   band + verdict + percentile from the shared legend
// @forbidden-alternative  whole-doc SimHash (z −0.64 on the probe pair — smears) · grading only
//   the target zone without the 144-zone distribution (no "how unlikely") · θ-binarizing before
//   the delta (quantizes the response away) · a hand-written verdict string (the legend owns the
//   wording) · invoking the walk
// @why  the demo showed the panels; the operator asked for THE NUMBER — a percentile-placed σ the
//   ingest optimizer can push UP, so localization becomes a ratchet objective, not a screenshot
// @guard  tests/pmu-simulator/sigma-localize.test.mjs
//
// Usage:
//   node scripts/pmu/sigma-localize.mjs                                  # the brain-surgeon pair
//   node scripts/pmu/sigma-localize.mjs --base <sha> --pert <sha> --coord B3,B3
//   node scripts/pmu/sigma-localize.mjs --lib <path>                     # candidate library (watcher)
//   node scripts/pmu/sigma-localize.mjs --json                           # machine-readable to stdout
//   node scripts/pmu/sigma-localize.mjs --email                          # templated verdict email
//   node scripts/pmu/sigma-localize.mjs --no-history                     # measure without ledger append
//   node scripts/pmu/sigma-localize.mjs --panel /tmp/localize-panel.png  # the LOCALIZATION GRADIENT PANEL
//     (compression-witness zone deltas diagonal-lifted → from→to gradient · mass brightness ·
//      top-10 rank rings · gestalt-block percentile borders · target crosshair; PNG + axis-labeled HTML)
// Output JSON: data/pmu/sigma-localize/<date>.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { simhash, hamming, wordShingles, SIG_BITS } from '../../src/app/pmu-simulator/signature.mjs';
import { claimify, salienceRank } from './corpus-ingest.mjs';
import { rankCertainty, sigmaFromP } from './rank-certainty.mjs';
import { repoRoot } from './repo-root.mjs';        // stderr-suppressed repo root — no `fatal:` leak outside a repo
import { COORDS } from './definer-walk-144.mjs';   // labels ONLY — the walk is never invoked here
import {
  legend, legendLine, percentile, readMeasureHistory, whatGoodLooksLike, walkCountRow,
  surgicalVerdict, MEASURE_HISTORY,
} from './sigma-legend.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = repoRoot(resolve(HERE, '../..')); // stderr-suppressed (repo-root.mjs) — no `fatal:` leak outside a repo
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// the brain-surgeon pair (probe commits, 2026-06-11) — the default subject of the measure.
export const DEFAULT_BASE = '5b875a47b';
export const DEFAULT_PERT = '4321b12c7';
export const DEFAULT_COORD = 'B3,B3';

const DOC_EXT = /\.(md|mdx|txt)$/, HTML_EXT = /\.html$/;
const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const std = (xs) => { if (!xs.length) return 0; const mu = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length); };

// ── THE SINGLE-ZONE CERTAINTY — the placement-exact σ that closes the std-collapse gap ──────────
// THE ESTIMATOR GAP (found by the 12-tile fresh-pair sweep, 2026-06-12): the house z-estimator in
// sigmaOfZones divides by std(elsewhere). When FEWER THAN 2 zones move, that std collapses to 0
// and the z reads EXACTLY 0 — so a SURGICAL hit (only the target zone moves, zone rank 1/144) and
// a dead miss BOTH print σ 0. The estimator fails CONSERVATIVE: honest (it never over-claims) but
// it UNDERREPORTS true positives, because a perfect single-zone strike is indistinguishable from
// nothing through a ratio whose denominator vanished.
//
// THE FIX — when EXACTLY ONE zone moves and it IS the target, placement is no longer an estimate.
// The chance that a single moved zone happens to be the one of 144 we predicted is EXACTLY 1/144;
// the placement certainty is therefore the EXACT σ-equivalent of a uniform-null p = 1/144, taken
// through the SAME one-sided p→σ map the rank lens uses (sigmaFromP, rank-certainty.mjs — no new
// math, no shuffled null):
//   PLACEMENT_SIGMA = Φ⁻¹(1 − 1/144) ≈ 2.46.
//
// COMPOSITION WITH MAGNITUDE — DELIBERATELY NOT FOLDED IN (and why, rigorously). The magnitude
// read would compare the moved zone's value m against the no-op control noise floor. But the
// control reads EXACTLY 0 (string-identical sides ⇒ NCD 0): a ZERO-VARIANCE null. The
// control-calibrated minimal detectable delta is thus "any m > 0", with NO calibrated noise scale
// to divide by — there is no honest unit in which m becomes additional σ. So we report
// PLACEMENT-ONLY σ and LABEL it 'surgical (placement-exact)': the magnitude m is carried as the
// raw moved-zone value for the reader, never inflated into the σ. This is conservative by
// construction and CANNOT be gamed up — PLACEMENT_SIGMA is a fixed 1/144 constant, not a ratio an
// outlier could swell. A single-zone MISS (the lone mover is elsewhere, target mass 0) keeps its
// honest 0; every MULTI-ZONE case keeps the raw z untouched (the new path NEVER fires when ≥2
// zones move, so it can never inflate a genuine z-scored reading).
export const PLACEMENT_SINGLE_ZONE_P = 1 / 144;               // one draw of 144 anchor zones
export const PLACEMENT_SIGMA = +sigmaFromP(PLACEMENT_SINGLE_ZONE_P).toFixed(2);   // ≈ 2.46

// ── PURE MATH (unit-tested on fixtures, no git/library needed) ──────────────────────────────────

// zoneMasses(absd) — absd is the 20,736-cell |Δ| field; for EVERY anchor t of the 144, the mass in
// t's row+col of the 144×144 (287 cells: row t fully + col t minus the diagonal dup). The probe's
// localization neighborhood, generalized to the pair lattice; the target zone is one draw of 144.
export function zoneMasses(absd) {
  const masses = new Float64Array(144);
  for (let t = 0; t < 144; t++) {
    let m = 0;
    for (let j = 0; j < 144; j++) m += absd[t * 144 + j];          // row t
    for (let i = 0; i < 144; i++) if (i !== t) m += absd[i * 144 + t];   // col t (diagonal not double-counted)
    masses[t] = m;
  }
  return masses;
}

// sigmaOfZones(masses, target) — the z-score of the target zone's mass vs the OTHER 143 zones
// (median centre + population std, the σ_response estimator form: an elsewhere outlier inflates
// std and DEFLATES σ — fails conservative). std ≈ 0 (e.g. a uniform field) reads σ = 0, honestly.
export function sigmaOfZones(masses, target) {
  const elsewhere = [];
  for (let t = 0; t < 144; t++) if (t !== target) elsewhere.push(masses[t]);
  const med = median(elsewhere), sd = std(elsewhere);
  const sigma = sd > 1e-12 ? (masses[target] - med) / sd : 0;
  const rank = 1 + [...masses].filter((m, t) => t !== target && m > masses[target]).length;   // 1 = the target zone leads all 144
  // single-zone certainty (see PLACEMENT_SIGMA above): count the moving zones; a SURGICAL hit is
  // exactly one mover and it is the target — its z collapsed to 0 for want of elsewhere variance,
  // so report the placement-exact σ instead. A single-zone MISS (the mover is elsewhere) and every
  // multi-zone field keep the raw z (sigmaComposed === sigma) — the new path never inflates them.
  let nonzeroZones = 0;
  for (let t = 0; t < 144; t++) if (masses[t] > 0) nonzeroZones++;
  const surgical = nonzeroZones === 1 && masses[target] > 0;
  const sigmaComposed = surgical ? PLACEMENT_SIGMA : sigma;
  return { sigma, massAtTarget: masses[target], medianElsewhere: med, stdElsewhere: sd, rank, nonzeroZones, surgical, sigmaComposed };
}

// ── REGION GEOMETRY (operator, 2026-06-11: "the geometric region perturbed needs a measure") ────
// σ_localize says the target ZONE carries unusual mass; these say what SHAPE the perturbed region
// has and where its CENTRE sits — over the same 20,736-cell |Δ| field, in 12×12-block space:
//   centroidError    — the mass-weighted centroid's Chebyshev distance from the target cell,
//                      in block units (cells/12). 0 = the region centres ON the target.
//   gyrationRadius   — R_g = sqrt(Σ D·dist² / Σ D), dist = cell distance from the centroid.
//                      Small = the region is a point; large = a cloud.
//   regionArea       — cells strictly above the top-decile |Δ| value (how many cells the hot
//                      region occupies).
//   regionBlocks     — the minimal number of 12×12 blocks holding 90% of the |Δ| mass
//                      (1 = single-block surgery; 130 = uniform smear).
//   massInTop3Blocks — fraction of total |Δ| mass in the 3 heaviest blocks.
//
// σ-FORMS — DETERMINISTIC NULL, 200 cyclic-shift shuffles of D, every offset from a seeded sha256
// sequence (NO Math.random anywhere). WHY not one global flat shift: a single row-major roll
// preserves local adjacency almost everywhere, so the null gyration of a genuinely tight field
// equals the observed gyration and σ_tight would read ≈0 on the very case it must flag — the null
// must break 2D clustering while preserving the value multiset and rows-as-units. Each shuffle =
// one vertical roll of the rows + an independent cyclic column roll per row. Estimator is the
// house form (median centre, population std — fails conservative); std≈0 (uniform field) reads 0.
//   σ_tight = (median(null R_g) − observed R_g) / std(null R_g)        — tighter-than-chance > 0
//   σ_aim   = (median(null centroidError) − observed) / std(null ...)  — closer-than-chance > 0
// NOTE σ_aim is geometry-capped: the worst possible centroid error is ~11 blocks, so even a
// perfect hit reads low single digits against a broad null — bands still apply, read honestly.

// one-pass moments of the (optionally shuffled) field: total mass, centroid, gyration radius.
// D'(i,j) = D[(i+vOff)%144][(j+hOffs[i])%144]; vOff=0/hOffs=null reads the field as-is.
export function fieldMoments(absd, vOff = 0, hOffs = null) {
  let m = 0, mi = 0, mj = 0, mi2 = 0, mj2 = 0;
  for (let i = 0; i < 144; i++) {
    const rowBase = ((i + vOff) % 144) * 144;
    const h = hOffs ? hOffs[i] : 0;
    for (let j = 0; j < 144; j++) {
      const v = absd[rowBase + ((j + h) % 144)];
      if (v) { m += v; mi += v * i; mj += v * j; mi2 += v * i * i; mj2 += v * j * j; }
    }
  }
  if (m <= 0) return { mass: 0, ci: 71.5, cj: 71.5, rg: 0 };
  const ci = mi / m, cj = mj / m;
  const varSum = Math.max(0, mi2 / m - ci * ci) + Math.max(0, mj2 / m - cj * cj);
  return { mass: m, ci, cj, rg: Math.sqrt(varSum) };
}

// the occupancy measures: regionArea (cells above top-decile |Δ|), regionBlocks (blocks holding
// 90% of mass), massInTop3Blocks — all over the 12×12-block decomposition of the 144×144.
export function regionMeasures(absd) {
  const blockMass = new Float64Array(144);
  let total = 0;
  for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) {
    const v = absd[i * 144 + j];
    if (!v) continue;
    total += v;
    blockMass[((i / 12) | 0) * 12 + ((j / 12) | 0)] += v;
  }
  const sorted = Float64Array.from(absd).sort();
  const threshold = sorted[Math.floor(0.9 * (sorted.length - 1))];
  let regionArea = 0;
  for (let k = 0; k < absd.length; k++) if (absd[k] > threshold) regionArea++;
  const desc = [...blockMass].sort((a, b) => b - a);
  let regionBlocks = 0, cum = 0;
  if (total > 0) for (const bm of desc) { regionBlocks++; cum += bm; if (cum >= 0.9 * total) break; }
  const massInTop3Blocks = total > 0 ? (desc[0] + desc[1] + desc[2]) / total : 0;
  return { regionArea, regionBlocks, massInTop3Blocks, totalMass: total, topDecileThreshold: threshold };
}

// the seeded hash sequence — sha256(`${seed}:${s}:${tag}`) → uint32 → offset. Deterministic.
export function nullOffsets(seed = 'sigma-localize-null-v1', shuffles = 200) {
  const off = (s, tag) => createHash('sha256').update(`${seed}:${s}:${tag}`).digest().readUInt32BE(0) % 144;
  const out = [];
  for (let s = 0; s < shuffles; s++) {
    const h = new Array(144);
    for (let r = 0; r < 144; r++) h[r] = off(s, `h${r}`);
    out.push({ v: off(s, 'v'), h });
  }
  return out;
}

// the full geometric read of a |Δ| field against a target cell (ti, tj).
export function regionGeometry(absd, ti, tj, { shuffles = 200, seed = 'sigma-localize-null-v1' } = {}) {
  const cheb = (ci, cj) => Math.max(Math.abs(ci - ti), Math.abs(cj - tj)) / 12;   // block units
  const obs = fieldMoments(absd);
  const gyrationRadius = obs.rg;
  const centroidError = obs.mass > 0 ? cheb(obs.ci, obs.cj) : 0;
  const { regionArea, regionBlocks, massInTop3Blocks } = regionMeasures(absd);
  const nullRg = [], nullErr = [];
  for (const o of nullOffsets(seed, shuffles)) {
    const m = fieldMoments(absd, o.v, o.h);
    nullRg.push(m.rg);
    nullErr.push(m.mass > 0 ? cheb(m.ci, m.cj) : 0);
  }
  // closer/tighter than chance = POSITIVE; std≈0 (e.g. uniform — shifts change nothing) reads 0.
  const z = (nulls, observed) => { const sd = std(nulls); return sd > 1e-12 ? (median(nulls) - observed) / sd : 0; };
  return {
    centroidError, gyrationRadius, regionArea, regionBlocks, massInTop3Blocks,
    sigmaTight: z(nullRg, gyrationRadius), sigmaAim: z(nullErr, centroidError),
    nullShuffles: shuffles, nullRgMedian: median(nullRg), nullErrMedian: median(nullErr),
  };
}

// the grip field of an explicit claim list: max claim sim per ordered node-pair cell.
// salienceRank is applied INSIDE (same defense-in-depth as the whole-doc path) so the attributed
// lens and the whole-doc lens read through the identical instrument. An empty list reads a zero
// field — honest, and exactly what the no-op control must produce.
export function senseClaimsField(claimList, pairSigs) {
  const claims = salienceRank(claimList || []).slice(0, 160);
  const claimSigs = claims.map((c) => simhash(c, SIG_BITS, wordShingles));
  const score = new Float32Array(20736);
  for (const cs of claimSigs) for (let k = 0; k < 20736; k++) { const v = 1 - hamming(cs, pairSigs[k]) / SIG_BITS; if (v > score[k]) score[k] = v; }
  return { score, claims: claims.length };
}

// the senseDecompose SCORE field (graded, pre-θ): max claim sim per ordered node-pair cell.
// NO θ EXISTS IN THIS PATH (pre-registered ablation H1, 2026-06-11, refuted-by-inspection): the
// field is graded pre-θ by design, and claimify/salienceRank thresholds are fixed constants —
// there is no per-corpus density target to float, so "frozen θ" holds by construction.
export function senseScore(text, pairSigs) {
  return senseClaimsField(claimify(String(text || '')), pairSigs);
}

// claimDiff — the edit's trace at claim level (pre-registered ablation H2, 2026-06-11): claimify
// both docs; claims present in one and not the other ARE the edit. Set semantics (exact-string,
// post-claimify normalization); deterministic, order-stable.
export function claimDiff(baseText, pertText) {
  const baseClaims = claimify(String(baseText || ''));
  const pertClaims = claimify(String(pertText || ''));
  const baseSet = new Set(baseClaims), pertSet = new Set(pertClaims);
  const added = [...new Set(pertClaims.filter((c) => !baseSet.has(c)))];
  const removed = [...new Set(baseClaims.filter((c) => !pertSet.has(c)))];
  return { added, removed };
}

// attributedDelta — the changed claims' grip field, prepared for the two reads honestly:
//   zone z-score    — computed on the RAW grip field (subtracting any uniform floor from every
//                     cell shifts every 287-cell zone mass by the same constant, so the z is
//                     EXACTLY invariant — no θ enters the σ).
//   geometry        — computed on the grip EXCESS above the field's own median (a robust
//                     centering, NOT a density-target θ: SimHash puts random pairs at sim ≈ 0.5,
//                     so the raw field is dense at that floor and mass-based regionBlocks would
//                     smear by construction, signal or not). max(0, grip − median).
export function attributedDelta(changedClaims, pairSigs) {
  const { score, claims } = senseClaimsField(changedClaims, pairSigs);
  const floor = median([...score]);
  const excess = new Float32Array(20736);
  for (let k = 0; k < 20736; k++) excess[k] = Math.max(0, score[k] - floor);
  return { grip: score, excess, floor, claims };
}

// ── H3: THE TOP-N IMPACT CUT (pre-registered ablation, 2026-06-11) ──────────────────────────────
// Operator: "baseline reef orthogonalises all tiles, but on commit smear only the n most affected —
// maybe a power law of impact; does it predict the right cell?" Rank ALL 20,736 |Δ| cells
// descending; read the rank-impact curve's SHAPE (log-log slope over the top 200 nonzero cells,
// top-10 share of total mass), then sweep n: keep only the top-n cells and recompute the localize
// triple on the truncated field. THE POINT PREDICTION: the top-1 cell (or its 12×12 block) is the
// target's. NOT the walk and never its follow rule (AR-3 guards the walk): this is sense-only
// ANALYSIS of a measurement field, reported alongside — never replacing — the whole-field numbers.

// rankImpact(absd) — descending order of the field + the registered curve readings.
export function rankImpact(absd) {
  const order = [...absd.keys()].sort((a, b) => absd[b] - absd[a] || a - b);   // value desc, index asc on ties — deterministic
  let total = 0;
  for (let k = 0; k < absd.length; k++) total += absd[k];
  let top10 = 0;
  for (let r = 0; r < Math.min(10, order.length); r++) top10 += absd[order[r]];
  const top10Share = total > 0 ? top10 / total : 0;
  // least-squares slope of ln(value) on ln(rank) over the top 200 NONZERO cells
  const pts = [];
  for (let r = 0; r < Math.min(200, order.length); r++) {
    const v = absd[order[r]];
    if (v > 0) pts.push([Math.log(r + 1), Math.log(v)]);
  }
  let slopeTop200 = 0;
  if (pts.length >= 2) {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const den = n * sxx - sx * sx;
    slopeTop200 = den > 1e-12 ? (n * sxy - sx * sy) / den : 0;
  }
  return { order, totalMass: total, top10Share, slopeTop200, curveCells: pts.length };
}

// topNCut(absd, n, order?) — the truncated field: only the top-n cells keep their |Δ|.
export function topNCut(absd, n, order = null) {
  const idx = order || rankImpact(absd).order;
  const out = new Float32Array(absd.length);
  for (let r = 0; r < Math.min(n, idx.length); r++) out[idx[r]] = absd[idx[r]];
  return out;
}

// topNReadings(absd, target, ns) — the full H3 read: curve shape + per-n localize triple + the
// point prediction (top-1 cell / leading block vs the target). An all-zero field (the no-op
// control) reads top1 null, every hit false, every σ 0 — no ranking signal can be claimed.
export function topNReadings(absd, target, ns = [1, 3, 10, 30, 100]) {
  const { order, totalMass, top10Share, slopeTop200, curveCells } = rankImpact(absd);
  const blockOf = (k) => `${((((k / 144) | 0) / 12) | 0)},${(((k % 144) / 12) | 0)}`;
  const targetBlock = `${(target / 12) | 0},${(target / 12) | 0}`;        // the target anchor's diagonal block
  const k0 = order[0];
  const top1 = totalMass > 0 && absd[k0] > 0 ? (() => {
    const i = (k0 / 144) | 0, j = k0 % 144;
    return { i, j, cell: `${COORDS[i]}→${COORDS[j]}`, block: blockOf(k0), value: +absd[k0].toFixed(4),
             inTargetZone: i === target || j === target, blockIsTarget: blockOf(k0) === targetBlock };
  })() : null;
  const sweep = ns.map((n) => {
    const trunc = topNCut(absd, n, order);
    const z = sigmaOfZones(zoneMasses(trunc), target);
    const geo = regionGeometry(trunc, target, target);
    const blockMass = new Map();
    let kept = 0, inTargetZone = 0;
    for (let r = 0; r < Math.min(n, order.length); r++) {
      const k = order[r], v = absd[k];
      if (v <= 0) break;
      kept++;
      const i = (k / 144) | 0, j = k % 144;
      if (i === target || j === target) inTargetZone++;
      blockMass.set(blockOf(k), (blockMass.get(blockOf(k)) || 0) + v);
    }
    let leadBlock = null, lead = -1;
    for (const [b, m] of [...blockMass.entries()].sort()) if (m > lead) { lead = m; leadBlock = b; }   // sorted first — deterministic ties
    return {
      n, kept, sigmaLocalize: +z.sigma.toFixed(2), zoneRank: z.rank,
      sigmaAim: +geo.sigmaAim.toFixed(2), sigmaTight: +geo.sigmaTight.toFixed(2),
      regionBlocks: geo.regionBlocks, inTargetZone, leadBlock,
      hit: leadBlock != null && leadBlock === targetBlock,
    };
  });
  return { totalMass, top10Share, slopeTop200, curveCells, uniformShare10: 10 / absd.length, top1, targetBlock, sweep };
}

// ── H4: THE COMPRESSION WITNESS (pre-registered ablation, 2026-06-11) ───────────────────────────
// Operator: "techniques akin to compression will localise this properly" — the house
// compression-as-sensor thesis; the gzip-NCD form is pipeline.mjs's dual witness, reused here.
// NO SimHash anywhere in this lens: each side's claims are assigned to their best anchor by
// gzip-NCD similarity (the pipeline ncdSim form), then per anchor ZONE the baseline-vs-perturbed
// claim concatenations are compared by NCD — a LOCAL compression witness per zone. The zone index
// set is the same 144 anchors σ_localize draws from, so the z-score reads identically: one draw
// from 144. String-identical concatenations read EXACTLY 0 (the honest no-op control).
const gzLen = (s) => gzipSync(Buffer.from(s, 'utf8')).length;

export function ncdOfPair(x, y) {
  if (x === y) return 0;   // string-identical (incl. both empty) — the no-op reads exactly 0
  const cx = gzLen(x), cy = gzLen(y), cxy = gzLen(`${x}\n${y}`);
  return (cxy - Math.min(cx, cy)) / Math.max(cx, cy);
}

// assignClaimsToAnchors — argmax over the 144 node texts of the pipeline ncdSim form
// (1 − NCD(claim, node)); unfilled anchors cannot grip; strict > keeps ties at the lowest index.
export function assignClaimsToAnchors(claims, nodeTexts) {
  const lens = nodeTexts.map((t) => (t ? gzLen(t) : 0));
  return claims.map((c) => {
    const zc = gzLen(c);
    let best = -1, bestSim = -Infinity;
    for (let t = 0; t < nodeTexts.length; t++) {
      if (!nodeTexts[t]) continue;
      const zab = gzLen(`${c}\n${nodeTexts[t]}`);
      const sim = 1 - (zab - Math.min(zc, lens[t])) / Math.max(zc, lens[t]);
      if (sim > bestSim) { bestSim = sim; best = t; }
    }
    return best;
  });
}

// compressionZoneDeltas — per anchor zone, NCD between the two sides' assigned-claim
// concatenations (claim order preserved — deterministic). Float64Array(144), one value per zone.
export function compressionZoneDeltas(baseClaims, pertClaims, nodeTexts) {
  const xs = Array.from({ length: 144 }, () => []);
  const ys = Array.from({ length: 144 }, () => []);
  assignClaimsToAnchors(baseClaims, nodeTexts).forEach((t, i) => { if (t >= 0) xs[t].push(baseClaims[i]); });
  assignClaimsToAnchors(pertClaims, nodeTexts).forEach((t, i) => { if (t >= 0) ys[t].push(pertClaims[i]); });
  const deltas = new Float64Array(144);
  for (let t = 0; t < 144; t++) deltas[t] = ncdOfPair(xs[t].join('\n'), ys[t].join('\n'));
  return deltas;
}

// ── H5: THE RANK LENS (pre-registered ablation, 2026-06-12) ─────────────────────────────────────
// Operator: "think in tolerances and RANKED lists of cells from the sensor instead of mass — if
// the sensor is clear, the geometric region should be more crystal than σs on the smear." The
// hierarchical rank machinery lives in rank-certainty.mjs (comparator-native, exact uniform-null
// p at every level — no estimator, no shuffled nulls); here it is WIRED as the 'rank' lens,
// computed on the attributed mass field AND on the compression-witness zone field (the predicted
// closer: rank-on-compression), with the whole-doc field read too so the registered P1/P3
// predictions (stated on the whole-doc field) get their honest verdicts.

// zoneFieldToLattice — the 144-zone field (one value per anchor, e.g. the compression witness's
// per-zone NCD deltas) lifted onto the lattice's DIAGONAL cells: zone t → cell (t,t). The lift
// lets rankCertainty read a zone field through the identical hierarchy. HONESTY NOTE: the generic
// hypergeometric null draws from all 20,736 cells while the lift's support is structurally the
// 144 diagonal cells — the generic p is LARGER than the structural one (287/20736 per draw vs
// 1/144), so the read UNDERSTATES certainty. Fails conservative, cannot be gamed up.
export function zoneFieldToLattice(zoneDeltas) {
  const f = new Float32Array(20736);
  for (let t = 0; t < 144; t++) f[t * 144 + t] = zoneDeltas[t];
  return f;
}

// the compact per-field rank summary every surface prints (full rankCertainty kept in the JSON).
export function rankView(rc) {
  return {
    degenerate: rc.degenerate,
    rowRank: rc.level12.row.mass.rank, colRank: rc.level12.col.mass.rank,
    blockRank: rc.level144.mass.rank, blockSigma: rc.level144.mass.sigma,
    topK: rc.topK.map((t) => ({ k: t.k, drawn: t.drawn, hits: t.hits, sigma: t.sigma })),
    sigmaRank: rc.composed.sigmaRank, pComposed: rc.composed.pComposed,
  };
}

// ── the library → the 20,736 ordered pair signatures (SHARED with commit-triptych) ──────────────
// Same key derivation (sha256 of nodeText.join(' ')) and same cache path, so a live-library run is
// a cache HIT on the file commit-triptych already built; a spliced candidate library builds (and
// caches) its own — comparable round to round at fixed instrument.
export function loadPairSigs(libPath) {
  let lib = JSON.parse(readFileSync(libPath, 'utf8'));
  if (!Array.isArray(lib)) lib = lib.anchors || lib.nodes || [];
  const byCoord = {}; for (const e of lib) if (e?.coord) byCoord[e.coord] = String(e.snippet || e.seed || '');
  const nodeText = COORDS.map((c) => byCoord[c] || '');
  const libSha = createHash('sha256').update(nodeText.join(' ')).digest('hex').slice(0, 12);
  const cache = resolve(REPO, `.thetacog/cache/pair-sigs-144-${libSha}.json`);
  let pairSigs, builtMs = 0;
  if (existsSync(cache)) pairSigs = JSON.parse(readFileSync(cache, 'utf8')).map(BigInt);
  else {
    const t0 = Date.now();
    pairSigs = new Array(20736);
    for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) pairSigs[i * 144 + j] = simhash(`${nodeText[i]} ${nodeText[j]}`, SIG_BITS, wordShingles);
    builtMs = Date.now() - t0;
    try { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify(pairSigs.map(String))); } catch { /* cache best-effort */ }
  }
  return { pairSigs, libSha, builtMs, filled: nodeText.filter(Boolean).length, nodeText };
}

// instrument hash — a σ_localize is only comparable to another at EQUAL libSha+codeSha.
export function localizeCodeSha() {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const sense = readFileSync(resolve(REPO, 'src/app/pmu-simulator/signature.mjs'), 'utf8');
  return sha12(self + ' ' + sense);
}

// ── the measure: committed blobs → score fields → |Δ| → zone z-score ────────────────────────────
export function computeSigmaLocalize({
  baseSha = DEFAULT_BASE, pertSha = DEFAULT_PERT, coord = DEFAULT_COORD,
  libPath = resolve(REPO, 'data/pmu/snippet-library-144.json'),
  historyPath = MEASURE_HISTORY, appendHistory = true,
} = {}) {
  const target = COORDS.indexOf(coord);
  if (target < 0) throw new Error(`unknown coord ${coord}`);

  // 1. the edited doc files = the perturbation commit's own diff, doc-kind only.
  const changed = execSync(`git diff-tree --no-commit-id --name-only -r ${pertSha}`, { cwd: REPO, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((f) => f && (DOC_EXT.test(f) || HTML_EXT.test(f)));
  if (!changed.length) throw new Error(`no doc files in ${pertSha}'s diff — nothing to localize`);
  const blob = (sha, f) => { try { return execSync(`git show ${sha}:${JSON.stringify(f)}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 5e7 }); } catch { return ''; } };
  const stripHtml = (c) => c.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const textOf = (sha) => changed.map((f) => (HTML_EXT.test(f) ? stripHtml(blob(sha, f)) : blob(sha, f))).join('\n\n');
  const baseText = textOf(baseSha), pertText = textOf(pertSha);

  // 2–3. senseDecompose score fields (both INTENT-side — a doc edit), then the |Δ| field.
  const { pairSigs, libSha, builtMs, filled, nodeText } = loadPairSigs(libPath);
  const t0 = Date.now();
  const base = senseScore(baseText, pairSigs);
  const pert = senseScore(pertText, pairSigs);
  const senseMs = Date.now() - t0;
  const absd = new Float32Array(20736);
  for (let k = 0; k < 20736; k++) absd[k] = Math.abs(pert.score[k] - base.score[k]);
  // the signed delta at the target's own diagonal cell (target,target) — should DROP on a foreign swap.
  const deltaSignedAtTarget = pert.score[target * 144 + target] - base.score[target * 144 + target];

  // 4–5. zone masses over ALL 144 anchor zones → z-score of the target zone.
  const masses = zoneMasses(absd);
  const { sigma, massAtTarget, medianElsewhere, stdElsewhere, rank } = sigmaOfZones(masses, target);
  const sigmaLocalize = +sigma.toFixed(2);
  const l = legend('localize', sigmaLocalize);

  // 5b. REGION GEOMETRY — the shape/centre of the perturbed region vs the deterministic null.
  const t0g = Date.now();
  const geo = regionGeometry(absd, target, target);   // target cell = the anchor's diagonal cell
  const geometryMs = Date.now() - t0g;
  const sigmaAim = +geo.sigmaAim.toFixed(2), sigmaTight = +geo.sigmaTight.toFixed(2);
  const centroidError = +geo.centroidError.toFixed(2);

  // 5c. THE ATTRIBUTED LENS (pre-registered ablation H2, 2026-06-11) — a SECOND lens, never a
  // replacement: the whole-doc field stays the headline; this reads ONLY the edit's trace
  // (claim-diff of the pair) through the same instrument. On a no-op pair the diff is empty,
  // the field is zero, and every attributed number reads 0 — the control honesty requirement.
  const t0a = Date.now();
  const { added, removed } = claimDiff(baseText, pertText);
  const att = attributedDelta([...added, ...removed], pairSigs);
  const attMasses = zoneMasses(att.grip);                       // z on the RAW grip (floor-invariant)
  const attZ = sigmaOfZones(attMasses, target);
  const attGeo = regionGeometry(att.excess, target, target);    // geometry on the excess-above-floor
  const attributedMs = Date.now() - t0a;
  const sigmaLocalizeAttributed = +attZ.sigma.toFixed(2);
  const lAtt = legend('localize-attributed', sigmaLocalizeAttributed);
  const attributed = {
    lens: 'changed-claims-only — the claim-diff of the pair sensed through the same instrument; second lens, never a replacement for the whole-doc field',
    claimsAdded: added.length, claimsRemoved: removed.length, claimsSensed: att.claims,
    gripFloor: +att.floor.toFixed(4),
    sigmaLocalize: sigmaLocalizeAttributed, band: lAtt.band, verdict: lAtt.verdict,
    zoneRank: attZ.rank, massAtTarget: +attZ.massAtTarget.toFixed(3),
    medianElsewhere: +attZ.medianElsewhere.toFixed(3), stdElsewhere: +attZ.stdElsewhere.toFixed(3),
    sigmaAim: +attGeo.sigmaAim.toFixed(2), aimBand: legend('aim', attGeo.sigmaAim).band,
    sigmaTight: +attGeo.sigmaTight.toFixed(2), tightBand: legend('tight', attGeo.sigmaTight).band,
    centroidError: +attGeo.centroidError.toFixed(2), gyrationRadius: +attGeo.gyrationRadius.toFixed(1),
    regionArea: attGeo.regionArea, regionBlocks: attGeo.regionBlocks,
    massInTop3Blocks: +attGeo.massInTop3Blocks.toFixed(3),
  };

  // 5d. THE COMPRESSION WITNESS (pre-registered ablation H4, 2026-06-11; z half confirmed at 5.28,
  // rank half missed at 3 — wired with the rank SHOWN so the miss stays visible) — an independent,
  // SimHash-free second witness, never a replacement: both sides' claims assigned to anchors by
  // gzip-NCD, then per-zone NCD between the assigned-claim concatenations, z-scored over 144 zones.
  const t0n = Date.now();
  const baseClaimList = salienceRank(claimify(baseText)).slice(0, 160);
  const pertClaimList = salienceRank(claimify(pertText)).slice(0, 160);
  const ncdDeltas = compressionZoneDeltas(baseClaimList, pertClaimList, nodeText);
  const ncdZ = sigmaOfZones(ncdDeltas, target);
  const ncdMs = Date.now() - t0n;
  const sigmaLocalizeNcd = +ncdZ.sigma.toFixed(2);
  const sigmaLocalizeNcdComposed = +ncdZ.sigmaComposed.toFixed(2);
  const lNcd = legend('localize-ncd', sigmaLocalizeNcd);
  const ncdOrder = [...ncdDeltas.keys()].sort((a, b) => ncdDeltas[b] - ncdDeltas[a] || a - b);
  const ncd = {
    lens: 'compression witness — gzip-NCD per anchor zone between the two sides’ zone-assigned claims (the pipeline.mjs dual-witness form; NO SimHash anywhere in this lens); independent second witness, never a replacement',
    sigmaLocalize: sigmaLocalizeNcd, band: lNcd.band, verdict: lNcd.verdict,
    // surgical = the std-collapse degenerate hit: only the target zone moved, so the z reads 0 for
    // want of elsewhere variance, but placement is exact at 1/144. sigmaComposed reports
    // PLACEMENT_SIGMA in that case (the raw σ is preserved above, never replaced).
    surgical: ncdZ.surgical, sigmaComposed: sigmaLocalizeNcdComposed,
    composedVerdict: ncdZ.surgical ? surgicalVerdict(ncdZ.massAtTarget) : lNcd.verdict,
    zoneRank: ncdZ.rank, ncdAtTarget: +ncdZ.massAtTarget.toFixed(4),
    medianElsewhere: +ncdZ.medianElsewhere.toFixed(4), stdElsewhere: +ncdZ.stdElsewhere.toFixed(4),
    nonzeroZones: ncdZ.nonzeroZones,
    topZones: ncdOrder.slice(0, 3).filter((t) => ncdDeltas[t] > 0)
      .map((t) => ({ coord: COORDS[t], ncdDelta: +ncdDeltas[t].toFixed(4), isTarget: t === target })),
    claims: { base: baseClaimList.length, pert: pertClaimList.length },
    // the full 144-zone delta field — what the localization gradient panel (--panel) renders;
    // 144 small numbers, carried so the panel is recomputable from the JSON alone.
    zoneDeltas: Array.from(ncdDeltas, (v) => +v.toFixed(6)),
  };

  // 5e. THE RANK LENS (pre-registered ablation H5, 2026-06-12) — hierarchical rank certainty
  // (rank-certainty.mjs: level-12 row/col p = rank/12 · level-144 block p = rank/144 · top-k∩zone
  // exact hypergeometric · composed σ_rank, ties conservative, exact uniform nulls throughout) on
  // THREE fields, honestly: the whole-doc |Δ| (the registered P1/P3 field), the attributed grip
  // (rank is invariant to the uniform SimHash floor — every block has 144 cells, every level-12
  // group 1728), and the compression-witness zone field diagonal-lifted (the predicted closer).
  const t0rk = Date.now();
  const rankWholeDoc = rankCertainty(absd, target);
  const rankAttributed = rankCertainty(att.grip, target);
  const rankCompression = rankCertainty(zoneFieldToLattice(ncdDeltas), target);
  const rankMs = Date.now() - t0rk;
  const sigmaRank = rankCompression.composed.sigmaRank;       // the headline: rank-on-compression
  const sigmaRankAttributed = rankAttributed.composed.sigmaRank;
  const lRank = legend('rank', sigmaRank);
  const rankLens = {
    lens: 'hierarchical rank certainty (rank-certainty.mjs) — the target’s position in the sensor’s own ordered significance list at three levels, each an EXACT uniform-null p (no estimator, no shuffled nulls); computed on the attributed mass field and the compression-witness zone field (headline = rank-on-compression, the registered closer), with the whole-doc field read for the P1/P3 verdicts; ties conservative, a flat field reads degenerate σ 0',
    sigmaRank, band: lRank.band, verdict: lRank.verdict,
    sigmaRankAttributed,
    compression: { ...rankView(rankCompression), field: 'compression-witness zone deltas, diagonal-lifted (generic hypergeometric null understates certainty on the lift — fails conservative)', detail: rankCompression },
    attributed: { ...rankView(rankAttributed), field: 'changed-claims grip (raw — ranks are floor-invariant across equal-size groups)', detail: rankAttributed },
    wholeDoc: { ...rankView(rankWholeDoc), field: 'whole-doc |Δ| (the registered P1/P3 field)', detail: rankWholeDoc },
  };

  // 6. percentile BEFORE this run joins the ledger — ranked against the past, never itself.
  const pct = percentile('sigmaLocalize', sigmaLocalize, { historyPath, window: 10 });
  if (appendHistory) {
    try {
      const line = JSON.stringify({
        kind: 'localize', baseSha, pertSha, coord, ts: new Date().toISOString(), sigmaLocalize, libSha,
        sigmaAim, sigmaTight, regionBlocks: geo.regionBlocks, centroidError,
        sigmaLocalizeAttributed, attributedRegionBlocks: attributed.regionBlocks,
        attributedZoneRank: attributed.zoneRank,
        sigmaLocalizeNcd, sigmaLocalizeNcdComposed, ncdSurgical: ncd.surgical, ncdZoneRank: ncd.zoneRank,
        sigmaRank, sigmaRankAttributed, rankNcdBlockRank: rankLens.compression.blockRank,
      });
      const prev = existsSync(historyPath) ? readFileSync(historyPath, 'utf8').split('\n').filter(Boolean) : [];
      prev.push(line);
      writeFileSync(historyPath, prev.slice(-200).join('\n') + '\n');
    } catch (e) { log('   measure-history append skipped:', String(e.message || e).slice(0, 80)); }
  }

  const topZones = [...masses.keys()].sort((a, b) => masses[b] - masses[a]).slice(0, 5)
    .map((t) => ({ coord: COORDS[t], mass: +masses[t].toFixed(3), isTarget: t === target }));

  return {
    measured: new Date().toISOString().slice(0, 19),
    sigmaType: 'sigma_localize',
    baseSha, pertSha, coord, files: changed,
    lib: libPath.replace(REPO + '/', ''), libSha, filled, codeSha: localizeCodeSha(),
    senseOnly: 'the walk is NEVER invoked — σ_localize implicates ingest/seed-library only, never walk execution',
    inputs: {
      sense: `senseDecompose form: salienceRank(claimify(blob)).slice(0,160) → simhash ${SIG_BITS}b wordShingles, score[i,j] = max claim sim vs ordered pairSig[i,j] (graded, pre-θ)`,
      delta: 'pert − base per pair cell, both intent-side (doc edit); committed blobs via git show, never the working tree',
      zones: 'zoneMass[t] = Σ|Δ| over row t ∪ col t of the 144×144 (287 cells) — ALL 144 anchor zones, the target is one draw',
      estimator: 'z = (mass[target] − median(other 143)) / population-std(other 143) — an elsewhere outlier deflates σ (fails conservative)',
      bands: '<1 chance · 1–3 weak · 3–6 localized · ≥6 outstanding (edges exact, lower-inclusive)',
      geometry: 'centroidError = Chebyshev block-distance of the mass-weighted |Δ| centroid from the target cell · R_g = sqrt(ΣD·dist²/ΣD) from the centroid · regionArea = cells above top-decile |Δ| · regionBlocks = 12×12 blocks holding 90% of mass',
      null: `${geo.nullShuffles} deterministic cyclic-shift shuffles (vertical roll + per-row column rolls, offsets from a seeded sha256 sequence — no Math.random); σ_tight = tighter-than-null, σ_aim = closer-than-null (median centre, population std, fails conservative)`,
      attribution: 'claim-diff of the pair (claims present in one doc and not the other) → grip field via the same senseClaimsField; zone z on the RAW grip (uniform-floor-invariant: every zone has 287 cells); geometry on the excess above the field’s own median (robust centering, NOT a density-target θ — SimHash random-pair sim ≈ 0.5 makes the raw field dense at that floor)',
      compression: 'both sides’ claims (salienceRank(claimify(blob)).slice(0,160)) assigned to their best anchor by gzip-NCD (the pipeline.mjs ncdSim form — no SimHash in this lens); per zone, NCD between the two sides’ assigned-claim concatenations (string-identical reads exactly 0); z over the same 144 anchor zones, house estimator',
      rank: 'comparator-native hierarchical ranks (rank-certainty.mjs): level-12 block-row/col p = rank/12 EXACT · level-144 block p = rank/144 EXACT · top-k cells (k ∈ {5,10,25}, nonzero only) ∩ target zone = exact hypergeometric tail · composed σ_rank = Fisher-corrected p_row × p_within; ties conservative (a tie ranks worse), a flat field reads degenerate σ 0; the compression zone field is diagonal-lifted (zone t → cell (t,t)) and the generic null understates certainty on the lift — fails conservative',
    },
    claims: { base: base.claims, pert: pert.claims },
    attributed,
    ncd,
    rank: rankLens,
    sigmaRank, rankBand: lRank.band,
    timings: { pairSigBuildMs: builtMs, senseMs, geometryMs, attributedMs, ncdMs, rankMs },
    sigmaLocalize, band: l.band, verdict: l.verdict,
    sigmaAim, aimBand: legend('aim', sigmaAim).band,
    sigmaTight, tightBand: legend('tight', sigmaTight).band,
    centroidError, gyrationRadius: +geo.gyrationRadius.toFixed(1),
    regionArea: geo.regionArea, regionBlocks: geo.regionBlocks,
    massInTop3Blocks: +geo.massInTop3Blocks.toFixed(3),
    nullRgMedian: +geo.nullRgMedian.toFixed(1), nullErrMedian: +geo.nullErrMedian.toFixed(2),
    percentile: pct,                                   // vs history BEFORE this run joined the ledger
    zoneRank: rank,                                    // 1 = the target zone leads all 144
    massAtTarget: +massAtTarget.toFixed(3),
    medianElsewhere: +medianElsewhere.toFixed(3), stdElsewhere: +stdElsewhere.toFixed(3),
    deltaSignedAtTarget: +deltaSignedAtTarget.toFixed(4),   // the target's diagonal cell should DROP on a foreign swap
    topZones,
  };
}

// ── THE TEMPLATED EMAIL — the same row machinery the commit emails use, no bespoke prose ────────
// One intro line, then legend rows: σ_localize (band · verdict · percentile) · σ_drift before/after
// · offPct flip · pre-walk overlap flip · walk counts · what-good-looks-like incl. the localize
// expectation. CID-safe: no data: URIs anywhere in the body (Gmail strips them).
const row = (k, v) => `<tr><td style="padding:2px 10px 2px 0;color:#5f6b78;white-space:nowrap;vertical-align:top">${k}</td><td style="color:#c9d1d9">${v}</td></tr>`;

// the rank table — one line per field (compression · attributed · whole-doc): target row rank /
// col rank / block rank / top-k hits / composed σ_rank. Same wording on every surface.
function rankTable(rank) {
  const line = (tag, v) => `<tr><td style="padding:1px 8px 1px 0;color:#5f6b78;white-space:nowrap">${tag}</td><td style="padding:1px 8px 1px 0;color:#c9d1d9;white-space:nowrap">row ${v.rowRank}/12 · col ${v.colRank}/12 · block ${v.blockRank}/144</td><td style="padding:1px 8px 1px 0;color:#c9d1d9;white-space:nowrap">top-k hits ${v.topK.map((t) => `${t.hits}/${t.drawn}@${t.k}`).join(' · ')}</td><td style="padding:1px 0;color:#c9d1d9;white-space:nowrap">σ_rank <b>${v.sigmaRank}</b>${v.degenerate ? ' · DEGENERATE (flat field, no hit claimable)' : ''}</td></tr>`;
  return `<table style="border-collapse:collapse;font-size:11px">${line('compression', rank.compression)}${line('attributed', rank.attributed)}${line('whole-doc', rank.wholeDoc)}</table><span style="color:#5f6b78;font-size:10.5px">exact uniform-null p at every level (rank/12 · rank/144 · hypergeometric top-k∩zone) — rank certainty → exact unlikeliness without nulls → the locked goal</span>`;
}

export function buildLocalizeEmail(r, { historyPath = MEASURE_HISTORY } = {}) {
  // before/after rows come from the SAME measure-history ledger the commit emails write —
  // the latest entry per sha (the pair's own on-commit reads), never re-derived by hand.
  const hist = readMeasureHistory(historyPath);
  const entryOf = (sha) => [...hist].reverse().find((e) => e.sha === sha) || null;
  const before = entryOf(r.baseSha), after = entryOf(r.pertSha);
  const flip = (k, unit = '') => (before && after && before[k] != null && after[k] != null)
    ? `${before[k]}${unit} → <b>${after[k]}${unit}</b>` : '— (one side missing from the ledger)';
  const driftRow = (e, tag) => e && e.sigmaDrift != null
    ? `${tag} σ ${e.sigmaDrift} · ${legendLine('drift', e.sigmaDrift)}` : `${tag} — not in the ledger`;
  const walksI = (e) => (e && e.walksIntent != null) ? { hops: e.walksIntent, lit: e.litIntent ?? e.walksIntent } : null;
  const walksR = (e) => (e && e.walksReality != null) ? { hops: e.walksReality, lit: e.litReality ?? e.walksReality } : null;

  const wgl = whatGoodLooksLike({ localize: true });
  const wglSeen = {
    sigma: after && after.sigmaDrift != null ? `σ ${after.sigmaDrift} after the edit (was ${before?.sigmaDrift ?? '—'})` : '—',
    tolerance: after ? `off-lane ${after.offPct}% (was ${before?.offPct ?? '—'}%)` : '—',
    prewalk: after ? `${after.prewalkOverlap}% (was ${before?.prewalkOverlap ?? '—'}%)` : '—',
    walks: after && after.walksIntent != null ? `intent ${after.walksIntent} · reality ${after.walksReality} hops (after)` : '—',
    localize: `σ_localize <b>${r.sigmaLocalize}</b> · ${r.band} · ${r.percentile ?? 'no history yet'} · zone rank ${r.zoneRank}/144`,
  };
  const wglBlock = `<div style="margin:0 0 16px;padding:12px 15px;background:#0a1018;border:1px solid #1a2a3a;border-left:3px solid #2ecf6f;border-radius:8px;font-size:12px;line-height:1.65">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#2ecf6f;text-transform:uppercase;margin-bottom:7px">what good looks like · expected vs seen (phantom P1 + the σ bands + the localize expectation)</div>
<table style="border-collapse:collapse;font-size:11.5px">${wgl.map((g) => `<tr>
<td style="padding:2px 8px 2px 0;color:#5f6b78;white-space:nowrap;vertical-align:top">${g.measure}</td>
<td style="padding:2px 8px 2px 0;color:#8b98a5;vertical-align:top">expected: ${g.expected}</td>
<td style="padding:2px 0;color:#c9d1d9;vertical-align:top"><b>seen: ${wglSeen[g.id] ?? '—'}</b></td></tr>`).join('')}</table></div>`;

  const statsBlock = `<div style="margin:18px 0;padding:13px 16px;background:#0a0f17;border-left:3px solid #45a29e;border-radius:6px;font-family:ui-monospace,monospace;font-size:12px">
<div style="font-size:11px;letter-spacing:.18em;color:#45a29e;text-transform:uppercase;margin-bottom:7px">σ_localize · the brain-surgeon pair · every measurement of this read</div>
<table style="border-collapse:collapse">
${row('σ_localize', `<b style="font-size:14px">${r.sigmaLocalize}</b> · <b style="color:#66fcf1">${legendLine('localize', r.sigmaLocalize)}</b> · <b>${r.percentile ?? 'no history yet'}</b>`)}
${r.attributed ? row('σ_localize(attr)', `<b>${r.attributed.sigmaLocalize}</b> · ${legendLine('localize-attributed', r.attributed.sigmaLocalize)} · zone rank ${r.attributed.zoneRank}/144 · claims +${r.attributed.claimsAdded}/−${r.attributed.claimsRemoved} (${r.attributed.claimsSensed} sensed) · regionBlocks ${r.attributed.regionBlocks} — the SECOND lens (changed claims only), never a replacement for the whole-doc read`) : ''}
${r.ncd ? row('σ_localize(ncd)', `<b>${r.ncd.surgical ? r.ncd.sigmaComposed : r.ncd.sigmaLocalize}</b>${r.ncd.surgical ? ` <b style="color:#66fcf1">(surgical — placement-exact; raw z ${r.ncd.sigmaLocalize})</b> · ${r.ncd.composedVerdict}` : ` · ${legendLine('localize-ncd', r.ncd.sigmaLocalize)}`} · zone rank ${r.ncd.zoneRank}/144 · NCD@target ${r.ncd.ncdAtTarget} vs median ${r.ncd.medianElsewhere} (std ${r.ncd.stdElsewhere}) · ${r.ncd.nonzeroZones} zone(s) move at all${r.ncd.topZones?.length ? ' · top: ' + r.ncd.topZones.map((z) => `${z.isTarget ? '<b style="color:#66fcf1">' + z.coord + '◎</b>' : z.coord} ${z.ncdDelta}`).join(' · ') : ''} — the COMPRESSION witness (no SimHash), independent of the whole-doc read`) : ''}
${r.rank ? row('σ_rank', `<b style="font-size:14px">${r.sigmaRank}</b> · <b>${legendLine('rank', r.sigmaRank)}</b> — headline = rank-on-compression (the H5 composed lens); attributed σ_rank ${r.rank.sigmaRankAttributed}`) : ''}
${r.rank ? row('the rank table', rankTable(r.rank)) : ''}
${row('zone rank', `${r.zoneRank}/144 — the target zone ${r.zoneRank === 1 ? 'LEADS all 144 anchor zones' : `is beaten by ${r.zoneRank - 1} zone(s)`} by |Δ| mass`)}
${row('the pair', `baseline ${r.baseSha} → perturbation ${r.pertSha} · target <b>${r.coord}</b> · ${r.files.join(' · ')}`)}
${row('Δ at target', `${r.deltaSignedAtTarget} signed at the target's diagonal cell (should DROP on a foreign swap) · zone mass ${r.massAtTarget} vs median ${r.medianElsewhere} (std ${r.stdElsewhere})`)}
${row('σ_aim', `<b>${r.sigmaAim}</b> · ${legendLine('aim', r.sigmaAim)}`)}
${row('σ_tight', `<b>${r.sigmaTight}</b> · ${legendLine('tight', r.sigmaTight)}`)}
${row('regionBlocks', `<b>${r.regionBlocks}</b> of 144 blocks hold 90% of the |Δ| mass · top-3 blocks carry ${(r.massInTop3Blocks * 100).toFixed(1)}% · regionArea ${r.regionArea} cells above the top-decile |Δ|`)}
${row('centroidError', `<b>${r.centroidError}</b> blocks (Chebyshev, mass centroid → target cell; null median ${r.nullErrMedian}) · R_g ${r.gyrationRadius} cells (null median ${r.nullRgMedian})`)}
${row('top zones by |Δ| mass', r.topZones.map((z) => `${z.isTarget ? '<b style="color:#66fcf1">' + z.coord + '◎</b>' : z.coord} ${z.mass}`).join(' · '))}
${row('σ_drift before', driftRow(before, `baseline ${r.baseSha}:`))}
${row('σ_drift after', driftRow(after, `perturbed ${r.pertSha}:`))}
${row('off-lane flip', `${flip('offPct', '%')} — the planted out-of-lane act SHOULD raise this`)}
${row('pre-walk overlap flip', `${flip('prewalkOverlap', '%')} — the edit pulls the doc away from what it declared`)}
${row('walk counts', (walksI(after) && walksR(after)) ? walkCountRow(walksI(after), walksR(after)) : '—')}
${row('instrument', `lib ${r.libSha} (${r.filled}/144 filled) · code ${r.codeSha} · claims base ${r.claims.base} / pert ${r.claims.pert} — σ comparisons are only valid at equal hashes`)}
${row('estimator', r.inputs.estimator)}
</table></div>`;

  const intro = `<p style="font-size:13px;color:#c9d1d9;line-height:1.6">The brain-surgeon pair, re-read through the template: one z-scored number for "did the edit land in the right zone?", percentile-placed, with the ingest optimizer wired to push it up.</p>`;
  const footer = `<p style="font-size:12px;color:#5a6673;margin-top:16px;border-top:1px solid #1a2230;padding-top:10px">Sense-only (the walk is never invoked). Recompute: <code>node scripts/pmu/sigma-localize.mjs --base ${r.baseSha} --pert ${r.pertSha} --coord ${r.coord}</code></p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>σ_localize · ${r.coord}</title></head>
<body style="background:#05070d;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px"><div style="max-width:780px;margin:0 auto">
<div style="font-family:ui-monospace,monospace;font-size:.7em;letter-spacing:.2em;color:#45a29e;text-transform:uppercase">PMU · σ_localize · the brain-surgeon measure</div>
${intro}${wglBlock}${statsBlock}${footer}</div></body></html>`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const r = computeSigmaLocalize({
    baseSha: arg('--base', DEFAULT_BASE),
    pertSha: arg('--pert', DEFAULT_PERT),
    coord: arg('--coord', DEFAULT_COORD),
    libPath: resolve(arg('--lib', resolve(REPO, 'data/pmu/snippet-library-144.json'))),
    appendHistory: !process.argv.includes('--no-history'),
  });

  const dir = resolve(REPO, 'data/pmu/sigma-localize');
  mkdirSync(dir, { recursive: true });
  const fp = resolve(dir, `${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(fp, JSON.stringify(r, null, 2));

  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else {
    log(`\x1b[1m🧠→🔧 σ_LOCALIZE — how unlikely is it the edit landed in the right zone?\x1b[0m`);
    log(`   pair ${r.baseSha} → ${r.pertSha} · target ${r.coord} · lib ${r.libSha} · code ${r.codeSha}`);
    log(`   σ_localize = \x1b[1m${r.sigmaLocalize}\x1b[0m · ${legendLine('localize', r.sigmaLocalize)} · ${r.percentile ?? 'no history yet'}`);
    log(`   zone rank ${r.zoneRank}/144 · mass ${r.massAtTarget} vs median ${r.medianElsewhere} (std ${r.stdElsewhere}) · Δsigned@target ${r.deltaSignedAtTarget}`);
    log(`   σ_localize(attr) = \x1b[1m${r.attributed.sigmaLocalize}\x1b[0m · ${legendLine('localize-attributed', r.attributed.sigmaLocalize)} · rank ${r.attributed.zoneRank}/144 · claims +${r.attributed.claimsAdded}/−${r.attributed.claimsRemoved} · regionBlocks ${r.attributed.regionBlocks} (second lens)`);
    log(`   σ_localize(ncd) = \x1b[1m${r.ncd.surgical ? r.ncd.sigmaComposed : r.ncd.sigmaLocalize}\x1b[0m · ${r.ncd.surgical ? `SURGICAL (placement-exact; raw z ${r.ncd.sigmaLocalize}) — ${r.ncd.composedVerdict}` : legendLine('localize-ncd', r.ncd.sigmaLocalize)} · rank ${r.ncd.zoneRank}/144 · NCD@target ${r.ncd.ncdAtTarget} · ${r.ncd.nonzeroZones} zone(s) move (compression witness, no SimHash)`);
    const rkLine = (tag, v) => log(`   σ_rank(${tag}) = \x1b[1m${v.sigmaRank}\x1b[0m · row ${v.rowRank}/12 · col ${v.colRank}/12 · block ${v.blockRank}/144 · top-k hits ${v.topK.map((t) => `${t.hits}/${t.drawn}@${t.k}(σ${t.sigma})`).join(' ')}${v.degenerate ? ' · DEGENERATE' : ''}`);
    log(`   σ_rank = \x1b[1m${r.sigmaRank}\x1b[0m · ${legendLine('rank', r.sigmaRank)} (headline = rank-on-compression)`);
    rkLine('compression', r.rank.compression);
    rkLine('attributed', r.rank.attributed);
    rkLine('whole-doc', r.rank.wholeDoc);
    log(`   σ_aim = \x1b[1m${r.sigmaAim}\x1b[0m · ${legendLine('aim', r.sigmaAim)}`);
    log(`   σ_tight = \x1b[1m${r.sigmaTight}\x1b[0m · ${legendLine('tight', r.sigmaTight)}`);
    log(`   region: ${r.regionBlocks} block(s) hold 90% of mass · top-3 ${(r.massInTop3Blocks * 100).toFixed(1)}% · area ${r.regionArea} cells · centroidError ${r.centroidError} blocks (null ${r.nullErrMedian}) · R_g ${r.gyrationRadius} (null ${r.nullRgMedian})`);
    log(`   timings: pair-sig build ${r.timings.pairSigBuildMs}ms (0 = cache hit) · sense ${r.timings.senseMs}ms · geometry ${r.timings.geometryMs}ms`);
    log(`   → ${fp.replace(REPO + '/', '')}`);
  }

  // ── THE LOCALIZATION GRADIENT PANEL (--panel <out.png>) — the queued visual debt landed:
  // "express as pixels with color gradients — from-to color, mass and rank" + "ranks/percentiles
  // in gestalt blocks". The CHAMPION lens's field (the compression witness's per-zone NCD deltas,
  // diagonal-lifted via zoneFieldToLattice — the established honest lift, no cross-paint) rendered
  // by triptych-render's localizationPanelRgba: 144×144 one pixel per cell (AR-8), from→to
  // gradient, top-10 rank rings, gestalt-block percentile borders (block-stats), target crosshair.
  // PNG + an axis-labeled HTML sidecar (the shortlexAxisStrip furniture; data: URI is fine here —
  // this is a local inspection file, never an email body).
  const panelOut = arg('--panel', null);
  if (panelOut) {
    const { localizationPanelRgba, rgbaToPng, rgbaToPngDataUri, shortlexAxisStrip, pairAxisStrip, LOCALIZATION_PANEL_LEGEND } =
      await import('./triptych-render.mjs');
    const targetIdx = COORDS.indexOf(r.coord);
    const fieldLat = zoneFieldToLattice(Float64Array.from(r.ncd.zoneDeltas));
    const panel = localizationPanelRgba(fieldLat, { target: targetIdx * 144 + targetIdx });
    const outPng = resolve(panelOut);
    writeFileSync(outPng, rgbaToPng(panel.rgba));
    const IMG = 432;
    let ax; try { ax = shortlexAxisStrip(undefined, IMG); } catch { ax = pairAxisStrip(IMG); }   // the renderTriptych strip idiom
    const ringLine = panel.rings.length
      ? panel.rings.map((g) => `#${g.rank} ${COORDS[g.i]}→${COORDS[g.j]} ${g.value}`).join(' · ')
      : 'none (no cell stands out of the field — honest)';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>σ_localize panel · ${r.coord}</title></head>
<body style="background:#05070d;color:#c9d1d9;font-family:ui-monospace,monospace;padding:18px">
<div style="font-size:11px;letter-spacing:.18em;color:#45a29e;text-transform:uppercase">PMU · localization gradient panel · ${r.baseSha} → ${r.pertSha} · target ${r.coord}</div>
<p style="font-size:12px;color:#8b98a5;max-width:${IMG + 80}px">${LOCALIZATION_PANEL_LEGEND}</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="width:${ax.width}px"></td><td>${ax.top}</td></tr>
<tr>${ax.left}<td><img src="${rgbaToPngDataUri(panel.rgba)}" width="${IMG}" height="${IMG}" style="display:block;image-rendering:pixelated" alt="localization gradient panel"></td></tr></table>
<p style="font-size:11px;color:#5f6b78">rings: ${ringLine}</p>
</body></html>`;
    const outHtml = outPng.replace(/\.png$/i, '') + '.html';
    writeFileSync(outHtml, html);
    log(`   panel → ${outPng.replace(REPO + '/', '')} (+ ${outHtml.replace(REPO + '/', '')})`);
    log(`   ${LOCALIZATION_PANEL_LEGEND}`);
    log(`   rings: ${ringLine} · block table flat ${panel.flat}`);
  }

  if (process.argv.includes('--email')) {
    const html = buildLocalizeEmail(r);
    const tmp = `/tmp/sigma-localize-${r.pertSha}.html`;
    writeFileSync(tmp, html);
    const subject = `🧠→🔧 σ_localize ${r.sigmaLocalize} · ${r.band} — the brain-surgeon pair, templated`;
    execSync(`node ${resolve(REPO, 'scripts/email-artifact.mjs')} --html ${tmp} --no-attach --attach ${fp} --to eliasmoosman@gmail.com --to elias@thetadriven.com --from laboratory@thetadriven.com --subject ${JSON.stringify(subject)}`, { cwd: REPO, stdio: 'inherit' });
  }
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
