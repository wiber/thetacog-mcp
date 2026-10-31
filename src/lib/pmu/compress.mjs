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

// ── placePixel — the ACTOR×PATIENT pixel placement (competence, not identity) ─────────────────────
// compress() argmaxes over the 12 axis NODES → a single lane ("who you are" / identity). placePixel()
// argmaxes over the 144 axis-PAIR cells (snippet-library-144: coord "row,col" + composed snippet) → a
// PIXEL: the actor×patient intersection that IS the competence ("you in a field"). This is the
// placement the IDEAL pipeline seals — the seed the on-chip ballistic walk runs from. Same two
// witnesses, gzip-NCD primary. Additive + deterministic: same doc → same pixel, byte-for-byte.
// See docs/architecture/actor-patient-pixel-onchip-walk-research.html.
export function placePixel(doc, pairLib) {
  const cells = Array.isArray(pairLib) ? pairLib : (pairLib?.anchors || pairLib?.nodes || []);
  if (!cells.length) return { pixel: null, sigma: 0, agreement: null, witness: WITNESS, witnesses: {} };
  const docZ = gzipLen(doc);
  const gz = [];
  for (const c of cells) {
    const snip = String(c.snippet || '');
    const snipZ = gzipLen(snip);
    gz.push({ pixel: c.coord, score: ncdSim(docZ, doc, snip, snipZ) });
  }
  gz.sort((a, b) => b.score - a.score);
  const gzPixel = gz[0].pixel;
  const sigmaG = sigmaMargin(gz);
  return {
    pixel: gzPixel,                         // gzip-NCD is the canonical sensor (the one witness)
    sigma: sigmaG,
    agreement: null,                        // C611g: no second witness voted — never reported as true
    witness: WITNESS,
    witnesses: {
      gzipNCD:       { pixel: gzPixel, sigma: sigmaG, scores: gz.slice(0, 5) },
      simhashCosine: { pixel: null, sigma: null, scores: [], retired: RETIRED },
    },
  };
}

// ── placePixelBulked — THE SAME PLACEMENT, MASS-MATCHED (META-BULK applied to the seed) ──────────
// Operator (2026-09-12, dictated): "you can't compare an NCD compression distance for a very small
// seed with a very large cell … if you have a very small prompt you have to build it up … see what
// fits at a similarly small aperture, and then as you figure out the address, expand the aperture
// because you added mass." Measured before this existed: cell snippets are 671–1,899 chars (median
// 1,477); prompts median 111 — a 13× mass mismatch. placePixel() on a 25–123 char prompt returned
// the diagonal magnets (B3,B3 · C,C · B,B · C2,C2) with top-5 similarities within 0.002 of each
// other: length noise wearing a σ of 3.3. That is exactly what META-BULK forbids for rules; the
// placement seed had never been held to it.
//   1. BULK the prompt with the lane's own mass (the previous receipt's prompt, its served rules) so
//      the intent side is aperture-sized, not naked.
//   2. CUT THE EYE on both sides — the same character window on the intent and on every cell — so
//      mass and density are equal at each comparison.
//   3. COARSE → FINE: a small eye over all 144 cells picks the region (top-K); a wider eye, with the
//      bulked intent, decides among them. The aperture widens as mass is added — never before.
//   4. FIT, reported: the fine margin over the coarse field, and whether the winner beats the
//      coarse mean by more than two coarse-σ (better than random), so a placement that is still
//      noise says so instead of wearing a number.
// Additive: placePixel() is untouched; the caller chooses. Deterministic, byte-for-byte.
export const BULK_EYE_COARSE = 320, BULK_EYE_FINE = 900, BULK_TOP_K = 12;
// MASS RATIO: the bulk may never outweigh the prompt more than BULK_MAX_RATIO : 1, or the placement
// becomes the lane's placement and a clearly different prompt ("fix the stripe webhook" after a
// book-edit turn) is dragged to the previous lane. Measured 2026-09-12: unbounded bulk sent four
// unrelated prompts to the same pixel. Momentum is a bias, never the signal.
export const BULK_MAX_RATIO = 2;
export const FIT_MIN_GAIN = 0.015;   // a calibrated gain below this is length noise, whatever the z says
/** deterministic word shuffle — the same-mass null document for calibration */
export function shuffleWords(s) {
  const w = String(s).split(/\s+/).filter(Boolean); let seed = 7;
  for (let i = w.length - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; const j = seed % (i + 1); [w[i], w[j]] = [w[j], w[i]]; }
  return w.join(' ');
}
export function placePixelBulked(doc, pairLib, { bulk = '', summaries = null, eyeCoarse = BULK_EYE_COARSE, eyeFine = BULK_EYE_FINE, topK = BULK_TOP_K, maxRatio = BULK_MAX_RATIO } = {}) {
  const cells = Array.isArray(pairLib) ? pairLib : (pairLib?.anchors || pairLib?.nodes || []);
  if (!cells.length) return { pixel: null, sigma: 0, mode: 'bulked', fit: null };
  const prompt = String(doc || '');
  const bulkCut = String(bulk || '').slice(0, Math.max(0, Math.floor(prompt.length * maxRatio)));
  const intent = (prompt + (bulkCut ? '\n' + bulkCut : '')).slice(0, eyeFine);
  // COARSE at the PROMPT's own scale: the prompt alone against each cell's one-line summary (name +
  // hat + vocab, ~100 chars) when summaries are given — a small seed against small cells, the
  // "similarly small aperture" — else against the snippet cut to the coarse eye.
  const dC = summaries ? prompt.slice(0, eyeCoarse) : intent.slice(0, eyeCoarse), dCz = gzipLen(dC);
  const coarse = cells.map((c) => { const sn = summaries ? String(summaries[c.coord] || c.snippet || '').slice(0, eyeCoarse) : String(c.snippet || '').slice(0, eyeCoarse); return { pixel: c.coord, score: ncdSim(dCz, dC, sn, gzipLen(sn)) }; }).sort((a, b) => b.score - a.score);
  const cMean = coarse.reduce((a, x) => a + x.score, 0) / coarse.length;
  const cStd = Math.sqrt(coarse.reduce((a, x) => a + (x.score - cMean) ** 2, 0) / coarse.length) || 1e-9;
  const region = coarse.slice(0, topK);
  // FINE, CALIBRATED: each cell's score minus the score the SAME cell gives a same-mass NULL document
  // (the intent's words shuffled, deterministically) — what is left is meaning, not mass. Measured
  // 2026-09-12: without this, a nonsense prompt ("zzz qqq unknown words") scored z 3.3 over the
  // coarse field, because some snippet always co-compresses short text best. Placement and fit both
  // come from the calibrated gain; better_than_random needs a real gain AND a real margin.
  const dF = intent, dFz = gzipLen(dF);
  const nullDoc = shuffleWords(dF), nullZ = gzipLen(nullDoc);
  const fine = region.map((r) => { const c = cells.find((x) => x.coord === r.pixel); const sn = String(c?.snippet || '').slice(0, eyeFine); const snZ = gzipLen(sn); const raw = ncdSim(dFz, dF, sn, snZ); const nul = ncdSim(nullZ, nullDoc, sn, snZ); return { pixel: r.pixel, score: raw - nul, raw, nul, coarse: r.score }; }).sort((a, b) => b.score - a.score);
  const top = fine[0];
  const gains = fine.map((x) => x.score);
  const gMean = gains.reduce((a, x) => a + x, 0) / gains.length, gStd = Math.sqrt(gains.reduce((a, x) => a + (x - gMean) ** 2, 0) / gains.length) || 1e-9;
  const fit = { gain: Math.round(top.score * 1e4) / 1e4, margin: Math.round((top.score - (fine[1]?.score ?? top.score)) * 1e4) / 1e4, z_fine: Math.round(((top.score - gMean) / gStd) * 100) / 100, z_coarse: Math.round(((top.coarse - cMean) / cStd) * 100) / 100, better_than_random: top.score >= FIT_MIN_GAIN && (top.score - gMean) / gStd >= 2 };
  return {
    pixel: top.pixel, sigma: sigmaMargin(fine.length > 2 ? fine.map((x) => ({ pixel: x.pixel, score: x.score })) : coarse), mode: 'bulked', fit,
    eye: { coarse: eyeCoarse, fine: eyeFine, top_k: topK }, mass: { prompt: prompt.length, bulk: String(bulk || '').length, intent: intent.length },
    coarse_top: region.map((r) => r.pixel), fine: fine.slice(0, 5),
  };
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
