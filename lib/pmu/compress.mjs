// src/lib/pmu/compress.mjs
//
// COMPRESS — project a document onto a fixed axis library, by gzip-NCD.
//
// Given a doc and a 12-axis library of meaning-bearing snippets, return
// the cell the doc most aligns with, computed by ONE witness:
//
//   · gzipNCD       — Normalized Compression Distance (compression-based;
//                     the canonical similarity sensor).
//
// C611g (2026-10-03): this was a TWO-witness design — a second witness,
// simhashCosine (Hamming over 64-bit SimHash signatures), scored every axis
// beside NCD and `agreement` reported whether the two picked the same cell.
// The C611d census measured that arm with no perf reason: it re-signed all
// 144 snippets per call (178.2 / 167.1 ms) while NCD ran in 6.5 / 6.9 ms, and
// C610k measured the SimHash claim sensor refusing 27 of 29 items NCD lit.
// The arm is dropped. The output shape is kept so callers still read it, but
// it says what is true: `witness: 'ncd-only'`, `agreement: null` (no second
// witness voted — never true, never false), and witnesses.simhashCosine is
// { cell/pixel: null, sigma: null, scores: [], retired }. `cell` is the NCD
// cell; `sigma` is the NCD σ-margin.
//
// σ-margin: top axis's z-score vs the other 11. σ > 3 ≈ clean placement;
// σ < 1 ≈ doc is between axes (or the library needs tuning).
//
// Pure ESM. node:zlib for gzip.

import { gzipSync } from 'node:zlib';

// ── gzip NCD ─────────────────────────────────────────────────────────
// NCD(a,b) = ( |Z(a+b)| - min(|Z(a)|, |Z(b)|) ) / max(|Z(a)|, |Z(b)|)
// similarity = 1 - NCD ∈ [0,1] roughly. We cache gzipped lengths per
// snippet to keep the per-axis cost down (12 axes × 4 snippets = 48
// gzips, but each snippet is gzipped ONCE per call to compress).
function gzipLen(s) { return gzipSync(Buffer.from(s, 'utf8')).length; }

function ncdSim(docZ, doc, snippet, snipZ) {
  const joinZ = gzipLen(`${doc}\n${snippet}`);
  const numer = joinZ - Math.min(docZ, snipZ);
  const denom = Math.max(docZ, snipZ);
  if (denom === 0) return 0;
  const ncd = numer / denom;
  return Math.max(0, 1 - ncd);
}

// ── the retired second witness (C611g) — reported, never faked ───────
export const WITNESS = 'ncd-only';
const RETIRED = 'C611g: the SimHash arm is retired (no perf reason; it re-signed every snippet per call). One witness — gzip-NCD. agreement is null, never true.';

// ── σ-margin: top score's z-score vs the other axes ──────────────────
function sigmaMargin(scores) {
  if (scores.length < 2) return 0;
  const top = scores[0].score;
  const rest = scores.slice(1).map(s => s.score);
  const mean = rest.reduce((a, b) => a + b, 0) / rest.length;
  const variance = rest.reduce((a, b) => a + (b - mean) ** 2, 0) / rest.length;
  const std = Math.sqrt(variance);
  return std > 0 ? (top - mean) / std : 0;
}

// ── compress — the gzip-NCD projection (one witness since C611g) ─────
export function compress(doc, axisLib) {
  const empty = !doc || !doc.trim();
  if (empty || !axisLib?.axes?.length) {
    return {
      cell: null, sigma: 0, agreement: null, witness: WITNESS,
      witnesses: {
        gzipNCD:        { cell: null, sigma: 0, scores: [] },
        simhashCosine:  { cell: null, sigma: null, scores: [], retired: RETIRED },
      },
    };
  }

  const docZ = gzipLen(doc);

  // per-axis: mean NCD similarity to that axis's snippets
  const gzipScores = [];
  for (const axis of axisLib.axes) {
    let gzipSum = 0;
    for (const snip of axis.snippets) gzipSum += ncdSim(docZ, doc, snip, gzipLen(snip));
    gzipScores.push({ rank: axis.rank, name: axis.name, emoji: axis.emoji, score: gzipSum / axis.snippets.length });
  }
  gzipScores.sort((a, b) => b.score - a.score);

  const gzipCell = gzipScores[0].rank;
  const sigmaG = sigmaMargin(gzipScores);

  return {
    cell: gzipCell,                         // the one witness's cell
    sigma: sigmaG,
    agreement: null,                        // C611g: no second witness voted — never reported as true
    witness: WITNESS,
    witnesses: {
      gzipNCD:        { cell: gzipCell, sigma: sigmaG, scores: gzipScores },
      simhashCosine:  { cell: null, sigma: null, scores: [], retired: RETIRED },
    },
  };
}
