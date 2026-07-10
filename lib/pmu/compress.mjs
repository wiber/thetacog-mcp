// src/lib/pmu/compress.mjs
//
// TWO-WITNESS COMPRESS — project a document onto a fixed axis library.
//
// Given a doc and a 12-axis library of meaning-bearing snippets, return
// the cell the doc most aligns with, computed via TWO independent
// witnesses:
//
//   · gzipNCD       — Normalized Compression Distance (compression-based;
//                     the gold-standard semantic distance proxy).
//   · simhashCosine — Hamming distance over 64-bit SimHash signatures
//                     (the on-chip-shaped, deterministic approximation;
//                     see src/app/pmu-simulator/signature.mjs).
//
// Both witnesses score every axis. The top axis under each is the
// witness's cell. AGREEMENT (cells match) = high confidence. DISAGREEMENT
// is surfaced as the field `agreement: false` and IS the calibration
// signal — never silently hidden, never reconciled by majority.
//
// σ-margin: top axis's z-score vs the other 11. σ > 3 ≈ clean placement;
// σ < 1 ≈ doc is between axes (or the library needs tuning).
//
// Pure ESM. Reuses signature.mjs for simhash and node:zlib for gzip.

import { gzipSync } from 'node:zlib';
import { simhash, hamming, wordShingles, SIG_BITS } from './signature.mjs';

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

// ── simhash cosine ───────────────────────────────────────────────────
// 1 - hamming/SIG_BITS ∈ [0,1]. Uses wordShingles (domain-bearing,
// stoplist-stripped) — per signature.mjs, this is the right shingler
// for classification, not char n-grams.
function simSim(sigA, sigB) {
  return 1 - hamming(sigA, sigB) / SIG_BITS;
}

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

// ── compress — the two-witness projection ────────────────────────────
export function compress(doc, axisLib) {
  const empty = !doc || !doc.trim();
  if (empty || !axisLib?.axes?.length) {
    return {
      cell: null, sigma: 0, agreement: false,
      witnesses: {
        gzipNCD:        { cell: null, sigma: 0, scores: [] },
        simhashCosine:  { cell: null, sigma: 0, scores: [] },
      },
    };
  }

  // pre-compute doc-side state for both witnesses
  const docZ = gzipLen(doc);
  const docSig = simhash(doc, SIG_BITS, wordShingles);

  // per-axis: mean similarity to that axis's snippets, under both witnesses
  const gzipScores = [];
  const simScores = [];
  for (const axis of axisLib.axes) {
    let gzipSum = 0, simSum = 0;
    for (const snip of axis.snippets) {
      const snipZ = gzipLen(snip);
      gzipSum += ncdSim(docZ, doc, snip, snipZ);
      const snipSig = simhash(snip, SIG_BITS, wordShingles);
      simSum += simSim(docSig, snipSig);
    }
    const n = axis.snippets.length;
    gzipScores.push({ rank: axis.rank, name: axis.name, emoji: axis.emoji, score: gzipSum / n });
    simScores.push({ rank: axis.rank, name: axis.name, emoji: axis.emoji, score: simSum / n });
  }

  gzipScores.sort((a, b) => b.score - a.score);
  simScores.sort((a, b) => b.score - a.score);

  const gzipCell = gzipScores[0].rank;
  const simCell = simScores[0].rank;
  const sigmaG = sigmaMargin(gzipScores);
  const sigmaS = sigmaMargin(simScores);
  const agreement = gzipCell === simCell;

  return {
    cell: agreement ? gzipCell : null,
    sigma: agreement ? Math.min(sigmaG, sigmaS) : 0,
    agreement,
    witnesses: {
      gzipNCD:        { cell: gzipCell, sigma: sigmaG, scores: gzipScores },
      simhashCosine:  { cell: simCell,  sigma: sigmaS, scores: simScores },
    },
  };
}
