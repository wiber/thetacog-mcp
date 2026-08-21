#!/usr/bin/env node
// scripts/pmu/null-block-permutation.mjs — THE GRID-LEVEL STRUCTURE-PRESERVING NULL (SN-4).
//
// WHY A SECOND NULL EXISTS AT ALL.
// The null already in the receipt is a seeded Fisher–Yates shuffle of the reality side's 20,736-cell
// lit bitmask (triptych-build.mjs). It preserves the lit COUNT and destroys everything else in the
// same move — per-row mass, per-column mass, and every run of adjacent lit cells. That makes
// σ_vs_scatter a COMPOUND number. It answers "does the walk beat a same-mass, position-scrambled
// reality?" and it cannot answer the question a hostile reader actually asks: how much of that σ is
// the grid pointing at the RIGHT anchors, and how much is the grid merely being CLUMPY at all?
// From one σ against one null there is no way to show them apart.
//
// WHAT THIS NULL DOES INSTEAD.
// It relabels the lattice without deforming it. Row i moves INTACT to row (a·i + b) mod 144 with
// gcd(a,144)=1, and the columns are cyclically shifted by s. The grid now points at the WRONG
// anchors while its shape survives. Exactly preserved:
//   · the lit count
//   · the per-row mass profile (as a multiset — each row's mass travels with the row)
//   · the per-column mass profile (a cyclic shift only relabels columns)
//   · every run of adjacent lit cells inside a row, except across the ONE wrap seam the cyclic
//     column shift introduces per row. Stated exactly, not rounded up to "identical".
// So σ_vs_block-permutation is the anchor-identity signal standing on its own, and the GAP
// (σ_scatter − σ_block-permutation) decomposes today's σ.
//
// THE SIGN OF THE GAP IS A READING, NOT A DEFECT — and the first live run inverted the naive
// expectation, so it is written down here rather than smoothed over. POSITIVE gap: the scatter null
// was collecting σ from clumpiness that the structure-preserving null denies it. NEGATIVE gap: the
// scattered grid was the EASIER thing for the walk to resemble, and the anchor-identity separation
// is the larger of the two numbers. First measurement, 2026-08-16, a real commit-sized intent/reality
// pair on this repo: σ_scatter 0.18 (null μ 0.0447, sd 0.0242) vs σ_block-permutation 2.01 (null
// μ 0.0180, sd 0.0155), gap −1.83, no walk truncated. Mechanism: scattering spreads the lit mass
// across all 144 rows, so the impostor walks fan out broadly and resemble the intent walk MORE than
// the block-permuted grids do, which keep the mass concentrated in a handful of wrong rows. One σ
// against one null could not have shown that at all — which is the argument for the second null.
// Both σ values are reported on the same receipt; neither is published without the other.
//
// THE DIRECT ANCESTOR. This is the grid-side analogue of the dead-reef arm already committed
// sense-side: scripts/pmu/pmu-study-harness.mjs:66, DEAD_PERM(i) = (i·47 + 13) mod 144,
// gcd(47,144) = 1. k = 0 below IS that permutation, on purpose — the two arms are the same
// bijection family applied at two different layers, so a reader who has checked one has checked the
// construction of the other.
//
// COST. Arithmetic only. It draws nothing from the PRNG (so it is recomputable for free and replays
// shape-identical in perpetuity), generates no text, re-senses nothing, and rides the existing walk
// budget — one extra ballistic walk per impostor and nothing else. The cheapest strong null
// available.
//
// WHAT IT IS NOT. It is not a claim about behaviour, prevention, or correctness. It measures how far
// the walk's shape-match sits above a null; a larger gap is a larger measured separation and nothing
// more. The baseline on the intent side remains sealed declared intent, never a Platonic ideal.
//
// @canonical-algorithm  affine row bijection (a·i+b mod 144, gcd(a,144)=1) + cyclic column shift over the 144×144 lit grid → a structure-preserving, anchor-destroying null
// @forbidden-alternative  a full bitmask shuffle presented AS the structure-preserving null · an affine COLUMN map (adjacency becomes a stride, intra-row runs do not survive) · a PRNG-drawn permutation (not recomputable for free) · reporting one σ without its null kind
// @why  one σ against one null cannot separate anchor-identity from clumpiness; two nulls and their gap can
// @guard  tests/pmu/block-permutation-null.test.mjs

// Multipliers coprime to 144 (144 = 2^4·3^2, so a must be odd and not divisible by 3).
// k = 0 → 47, which with b = 13 reproduces pmu-study-harness DEAD_PERM exactly.
export const COPRIME_144 = [47, 5, 7, 11, 13, 17, 19, 23, 25, 29, 31, 35, 37, 41, 43, 49];

export const NULL_KIND_BLOCK_PERMUTATION = 'grid-block-permutation-structure-preserved';

// The human sentence that must travel WITH the number wherever it is printed. A σ whose null is not
// named on the same surface is a number a reader cannot check.
export const NULL_KIND_DESCRIPTIONS = {
  [NULL_KIND_BLOCK_PERMUTATION]:
    'rows relabelled by an affine bijection and columns cyclically shifted — lit count, per-row mass, ' +
    'per-column mass and intra-row runs survive; only the anchor identities are wrong',
};

// The permutation parameters for impostor k. Fixed arithmetic, no PRNG, never the identity.
export function blockPermutationParams(k) {
  const kk = Math.abs(Math.trunc(k));
  const a = COPRIME_144[kk % COPRIME_144.length];
  const b = (13 + 7 * kk) % 144;
  const s = 1 + ((11 + 29 * kk) % 143);   // 1..143 — a zero shift would leave columns fixed
  return { a, b, s };
}

// row i ↦ (a·i + b) mod 144. A bijection because gcd(a,144) = 1.
export function rowPermutation(k) {
  const { a, b } = blockPermutationParams(k);
  const perm = new Int16Array(144);
  for (let i = 0; i < 144; i++) perm[i] = (a * i + b) % 144;
  return perm;
}

// Apply the null to a 20,736-cell lit grid (row-major, 144×144). Input untouched.
export function permuteGrid(grid, k) {
  if (!grid || grid.length !== 20736) throw new Error('permuteGrid expects a 20736-cell grid');
  const { a, b, s } = blockPermutationParams(k);
  const out = new Uint8Array(20736);
  for (let i = 0; i < 144; i++) {
    const src = i * 144, dst = ((a * i + b) % 144) * 144;
    for (let j = 0; j < 144; j++) if (grid[src + j]) out[dst + ((j + s) % 144)] = 1;
  }
  return out;
}

// The whole null family for N impostors, in order. Deterministic in k, so a stranger who knows N
// re-derives the exact same N grids from the same reality grid — nothing to seed, nothing to store.
export function blockPermutationFamily(grid, n) {
  return Array.from({ length: Math.max(0, Math.trunc(n)) }, (_, k) => permuteGrid(grid, k));
}

const _mu = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const _sd = (xs, mu) => (xs.length ? Math.sqrt(xs.reduce((s, v) => s + (v - mu) ** 2, 0) / xs.length) : null);
// A null whose draws all landed on the same overlap has NO spread, and a z-score divided by that
// spread is not a measurement. The old test `sd ? … : 0` only catches an EXACT zero — and float
// arithmetic rarely gives one: the mean of three identical 0.1s is 0.10000000000000002, so sd comes
// back as ~1.4e-17 and the σ prints as 5.7e16, a fabricated number that reads as an enormous result.
// Judge degeneracy against an epsilon, and report the fallback as a fallback. Caught by the SN-4
// guard on its first run, which is what the guard is for.
const SD_FLOOR = 1e-12;
const _degenerate = (sd) => !(sd > SD_FLOOR);

// THE PAIRED READOUT. Same measured overlap, two null families, both σ on the same receipt.
//   scatterOverlaps    — shape-overlaps of intent vs the bitmask-shuffle impostor walks
//   blockPermOverlaps  — shape-overlaps of intent vs the block-permutation impostor walks (may be [])
// clumpinessShare is σ_scatter − σ_blockPerm, signed. Positive: σ points the scatter null was
// collecting from clumpiness rather than from anchor identity. Negative: the scattered grid was the
// easier thing to resemble and the anchor-identity separation is the larger number. Either way it is
// a decomposition of a measurement, not a prediction about anything.
// sd === 0 is reported as degenerate rather than smuggled through as a σ of 0 — a fallback must
// never be printed in the same typeface as a measurement.
export function dualNullSigma({ actual, scatterOverlaps = [], blockPermOverlaps = [] } = {}) {
  const sMu = _mu(scatterOverlaps), sSd = _sd(scatterOverlaps, sMu);
  const bMu = _mu(blockPermOverlaps), bSd = _sd(blockPermOverlaps, bMu);
  const sSigma = scatterOverlaps.length ? (_degenerate(sSd) ? 0 : (actual - sMu) / sSd) : null;
  const bSigma = blockPermOverlaps.length ? (_degenerate(bSd) ? 0 : (actual - bMu) / bSd) : null;
  // The gap is computed from the ROUNDED σ that are actually printed, not from the raw ones. A
  // reader who subtracts the two numbers on the receipt must land on the third number on the
  // receipt; a gap derived from hidden precision reads as an arithmetic error to the one person
  // who checks.
  const sOut = sSigma == null ? null : +sSigma.toFixed(2);
  const bOut = bSigma == null ? null : +bSigma.toFixed(2);
  return {
    actual,
    matchSigma: sOut,
    matchSigmaBlockPerm: bOut,
    clumpinessShare: (sOut == null || bOut == null) ? null : +(sOut - bOut).toFixed(2),
    scatter: scatterOverlaps.length
      ? { n: scatterOverlaps.length, mu: +sMu.toFixed(4), sd: +sSd.toFixed(4), degenerate: _degenerate(sSd) }
      : null,
    blockPerm: blockPermOverlaps.length
      ? { n: blockPermOverlaps.length, kind: NULL_KIND_BLOCK_PERMUTATION, mu: +bMu.toFixed(4), sd: +bSd.toFixed(4), degenerate: _degenerate(bSd) }
      : null,
  };
}

// ── invariant witnesses (used by the guard; cheap enough to call on a live receipt) ───────────────
export function rowMasses(grid) { const m = new Int32Array(144); for (let i = 0; i < 144; i++) { let s = 0; for (let j = 0; j < 144; j++) s += grid[i * 144 + j] ? 1 : 0; m[i] = s; } return m; }
export function colMasses(grid) { const m = new Int32Array(144); for (let j = 0; j < 144; j++) { let s = 0; for (let i = 0; i < 144; i++) s += grid[i * 144 + j] ? 1 : 0; m[j] = s; } return m; }
export function litCount(grid) { let s = 0; for (let k = 0; k < 20736; k++) if (grid[k]) s++; return s; }
// Run lengths of adjacent lit cells inside each row, LINEAR (no wrap) — the clumpiness witness.
export function rowRunLengths(grid, i) { const runs = []; let run = 0; for (let j = 0; j < 144; j++) { if (grid[i * 144 + j]) run++; else if (run) { runs.push(run); run = 0; } } if (run) runs.push(run); return runs; }
