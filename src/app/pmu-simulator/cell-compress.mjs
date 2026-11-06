// src/app/pmu-simulator/cell-compress.mjs
//
// The COMPRESSION-COMPARISON step — the missing pipeline stage.
//
// The pipeline had: git log → LLM → 144 cells of {intent text, reality
// text}. It did NOT have the step that turns those cells into the binary
// matrix the XOR walk traverses. This module is that step.
//
// The naive rule — "a cell is 1 if it has a claim" (refs.length > 0) —
// has a blind spot: when intent AND reality both carry a claim but the
// claims CONTRADICT, presence-XOR sees 1 vs 1, scores 0, and the drift is
// invisible. The three drift modes that must all become bit 1:
//   · intent present, reality absent   — a blank not filled
//   · reality present, intent absent   — uncontrolled drift
//   · both present, claims contradict  — the case presence-XOR misses
//
// The fix is the "shorthand of density" the directive reached for:
// Normalized Compression Distance. Compress intent, compress reality,
// compress them TOGETHER. Agreement compresses jointly (shared
// structure); contradiction does not. NCD ≈ 0 → agree, NCD ≈ 1 →
// diverge. This is sub-spec §3c's "the compressor IS the comparator",
// extended from integer subtraction of two sizes to JOINT compression of
// the pair — which is what catches the contradiction case. No LLM in the
// comparison loop: gzip is the comparator, deterministic and ballistic.
//
// Plain ESM (.mjs) — node:zlib only, zero dependencies. The output grid
// drops straight into leaf-walk.mjs's walkCoordinate / walkHeatmap.

import { gzipSync } from 'node:zlib';

// ── the gestalt band — calibrated against real gzip NCD ──────────────
// Measured: identical text ≈ 0.05, a matching intent/reality pair ≈ 0.32,
// a contradictory pair ≈ 0.73. The band sits between (the §G gestalt gap
// made continuous): below SIM_LO the cell agrees, above SIM_HI it
// contradicts, between is GRAY — too coarse to call at this resolution,
// which is exactly where lazy expansion (a deeper walk) must fire.
export const SIM_LO = 0.40;   // ncd ≤ SIM_LO → HIT  (intent and reality agree)
export const SIM_HI = 0.62;   // ncd ≥ SIM_HI → MISS (intent and reality contradict)

// ── §3c — bitrate: the compressed information content of a cell ──────
// The post-gzip byte length of the cell's text. This is the Intent
// Bitrate / Reality Bitrate of sub-spec §3c Transversion 1.
export function bitrate(text) {
  return gzipSync(Buffer.from(text ?? '', 'utf8')).length;
}

// ── NCD — Normalized Compression Distance, the comparison unit ───────
// NCD(a,b) = ( C(a·b) − min(C(a),C(b)) ) / max(C(a),C(b))
// ≈ 0 when a and b share structure (compress well together),
// ≈ 1 when they are unrelated (joint compression saves nothing).
export function ncd(a, b) {
  const ca = bitrate(a), cb = bitrate(b), cab = bitrate(`${a}\n${b}`);
  const max = Math.max(ca, cb);
  if (max === 0) return 0;
  const d = (cab - Math.min(ca, cb)) / max;
  return d < 0 ? 0 : d;          // clamp gzip-envelope float noise
}

const isEmpty = (text) => (text ?? '').trim().length === 0;

// ── classifyNcd — the band logic (HIT / MISS / GRAY / COOL) ──────────
// Pure: takes an already-measured ncd plus the two emptiness flags, so
// the band is testable without gzip noise from short fixtures.
export function classifyNcd(ncdValue, { intentEmpty, realityEmpty }) {
  if (intentEmpty && realityEmpty)
    return { state: 'COOL_EMPTY', bit: 0, sign: 'BALANCED' };          // nothing here
  if (realityEmpty)
    return { state: 'MISS_INTENT_HEAVY', bit: 1, sign: 'INTENT_HEAVY' };   // a blank not filled
  if (intentEmpty)
    return { state: 'MISS_REALITY_HEAVY', bit: 1, sign: 'REALITY_HEAVY' }; // uncontrolled drift
  // both present — the case presence-XOR is blind to
  if (ncdValue <= SIM_LO)
    return { state: 'HIT', bit: 0, sign: 'BALANCED' };                 // predicted AND built
  if (ncdValue >= SIM_HI)
    return { state: 'MISS_CONTRADICTION', bit: 1, sign: 'DIVERGENT' };  // both claim, they disagree
  return { state: 'GRAY', bit: 1, sign: 'AMBIGUOUS' };                  // too coarse — expand deeper
}

// ── classifyCell — intent text + reality text → the comparison unit ──
export function classifyCell(intentText, realityText) {
  const intentBits = bitrate(intentText);
  const realityBits = bitrate(realityText);
  const intentEmpty = isEmpty(intentText);
  const realityEmpty = isEmpty(realityText);
  const ncdValue = (intentEmpty || realityEmpty) ? null : ncd(intentText, realityText);
  const cls = classifyNcd(ncdValue ?? 0, { intentEmpty, realityEmpty });
  return { intentBits, realityBits, ncd: ncdValue, ...cls };
}

// ── presenceXorBit — the NAIVE rule, kept to show its blind spot ─────
// bit = (intent present) XOR (reality present). It cannot see a
// both-present contradiction — that is why classifyCell exists.
export function presenceXorBit(intentText, realityText) {
  return ((isEmpty(intentText) ? 0 : 1) ^ (isEmpty(realityText) ? 0 : 1));
}

// ── deep ShortLex binarization — quality presence ───────────────────
// The depth-2 grid bit means DRIFT (NCD of intent vs reality). Many
// levels deep, where there is often only one side, a node is a 1 or a 0
// on a different question: is the QUALITY present enough — does the node
// carry real compressed information, or is it an empty stub? That is the
// §3c bitrate budget made binary: a node clears the budget (bit 1) when
// its definition compresses to at least QUALITY_BUDGET bytes — measured,
// not similarity. Stubs ("todo", "") fall below it; a real, well-
// explained node clears it. This is how the deep bitmap is built: walk
// the deep glossary, and each node is present (1) or hollow (0).
export const QUALITY_BUDGET = 48;   // gzip bytes — calibrated: stub ≈ 24, real claim ≈ 130+

export function qualityBit(text, budget = QUALITY_BUDGET) {
  return bitrate(text) >= budget ? 1 : 0;
}

// binarizeDeep — a list of deep nodes → the deep bitmap. Each entry
// carries the node's address, its measured bitrate, and its quality bit.
export function binarizeDeep(nodes, budget = QUALITY_BUDGET) {
  return nodes.map((n) => {
    const b = bitrate(n.definition ?? '');
    return { address: n.address, bitrate: b, bit: b >= budget ? 1 : 0 };
  });
}

// ── buildLattice — 144 cells of text → the binary walk grid ──────────
// cells: an array (≤ 144) of { intent, reality } text pairs, indexed by
// lattice position. Returns the Uint8Array the leaf walk traverses, plus
// the per-cell classification for the heatmap.
export function buildLattice(cells) {
  const grid = new Uint8Array(144);
  const classified = new Array(144);
  for (let i = 0; i < 144; i++) {
    const cell = cells[i] ?? { intent: '', reality: '' };
    const c = classifyCell(cell.intent ?? '', cell.reality ?? '');
    grid[i] = c.bit;
    classified[i] = c;
  }
  return { grid, cells: classified };
}
