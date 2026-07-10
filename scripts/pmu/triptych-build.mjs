#!/usr/bin/env node
// scripts/pmu/triptych-build.mjs — THE SHARED TRIPTYCH INPUT BUILDER.
//
// The on-commit emailer (commit-triptych.mjs) and the npx walkthrough (attest-demo.mjs) must render
// the SAME instrument — never a rigged subset. The email used to be the only path that fed
// renderTriptych the BALLISTIC EDGE matrices (cole), the pre-walk sense grids (rawGrids), the
// SHORTLEX-3 projection (shortlex), the competence-pixel statement, the diagonal tile dump, and the
// self-naming σ; attest-demo passed none of it and silently fell to the coarse heatmap-bitmap
// tolerance (decodeDeltaThreeColour, "no walk at all") with flat decode-only panels.
//
// This module extracts that construction — commit-triptych.mjs:214-520, byte-faithful — into ONE
// reusable function so BOTH surfaces build identical inputs from (intentText, realityText). It does
// NOT render; it returns the exact arg-set to spread into renderTriptych, plus the readout meta
// (pixel, σ, lane, tier, timings) the caller surfaces. The grand-slam npx run = this, fed real.
//
// @canonical-algorithm  commit-scoped sense decompose (20,736 ordered node-pair sigs) → competence pixel → leaf/definer ballistic walk ON CHIP both sides → coleData (edge matrices + matchSigma) → SHORTLEX-3 projection → the full renderTriptych input set
// @forbidden-alternative  the coarse decodeDeltaThreeColour-only path (no cole) · a 12-axis JS walk · symmetric outer-product sensing · feeding the spec LABEL (not its semantic content) into INTENT
// @why  attest-demo's tolerance/panels MUST be the same ballistic instrument the commit email ships (SUPERSET, never subset) or the npx run demonstrates gzip placement, not ShortRank
// @guard  tests/pmu-simulator/attest-demo-uses-edges.test.mjs · scripts/pmu/validate-dogfood.sh

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runPipeline } from './pipeline.mjs';
import { definerWalk144, COORDS } from './definer-walk-144.mjs';
import { pickStartPixel } from './start-pixel.mjs';

const AX12 = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const AXNAME = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy·Law', A2: 'Strategy·Goal', A3: 'Strategy·Fund', B1: 'Tactics·Speed', B2: 'Tactics·Deal', B3: 'Tactics·Signal', C1: 'Operations·Grid', C2: 'Operations·Loop', C3: 'Operations·Flow' };
const tileWords = (coord) => { const [r, c] = String(coord || '').split(','); return r && c ? `${AXNAME[r] || r} × ${AXNAME[c] || c}` : String(coord || '?'); };
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const heatEmpty = (b64) => { const b = Buffer.from(b64 || '', 'base64'); if (!b.length) return true; for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false; return true; };

// THE SHARED BUILD. Returns { renderArgs, meta }.
//   renderArgs — spread directly into renderTriptych (the caller adds label/sub/killTolerancePct).
//   meta       — { walkMode, startPixel, patientPixel, pixGrip, actorCoord, patientCoord,
//                  matchSigma, sigmaType, senseI, senseR, timings, diagTiles, domBlocks, note }.
// EVERYTHING is best-effort + honest: a thin corpus, a missing registry, or an unbuilt daemon
// degrades a sub-part to null/'coarse-fallback' with a note — NEVER a throw, NEVER a faked panel.
export async function buildTriptychInputs({
  intentText, realityText, repoRoot,
  intentLabel = 'spec', realityLabel = 'work',
  killTolerancePct = 25, sigmaType = 'drift',
  impostors = 8, budgetMs = 1200, topK = 2, decay = 0.5,
} = {}) {
  const REPO = repoRoot || process.cwd();
  const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');
  const meta = { walkMode: 'coarse-fallback', note: null };

  // ── 1. runPipeline → the walk HEATMAP bitmaps (with the empty-heat retry guard) ──
  const ppArgs = { intentText, realityText, intentLabel, realityLabel };
  let r = await runPipeline(ppArgs);
  const heatBad = (x) => heatEmpty(x?.stages?.walk?.reality_heatmap_b64) || heatEmpty(x?.stages?.walk?.intent_heatmap_b64);
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 5 && heatBad(r); attempt++) {
    await new Promise((res) => setTimeout(res, 300 * attempt));
    const r2 = await runPipeline(ppArgs);
    if (!heatBad(r2)) { r = r2; break; }
  }
  const pipelineMs = Date.now() - t0;
  const S = r.stages || {}, w = S.walk || {}, x = S.xor || {};
  const intentB64 = w.intent_heatmap_b64, realityB64 = w.reality_heatmap_b64, frictionB64 = x.friction_bitmap_b64;

  // ── 2. dominant blocks (top-4 intent block-mass) — the tolerance in-lane reference ──
  const ib = Buffer.from(intentB64 || '', 'base64');
  const f32 = ib.length === 20736 * 4 ? new Float32Array(ib.buffer, ib.byteOffset, 20736) : null;
  const blockOf = (i) => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
  let domBlocks = [];
  if (f32) { const bm = new Array(16).fill(0); for (let i = 0; i < 20736; i++) bm[blockOf((i % 144) % 144)] += f32[i]; domBlocks = [...bm.keys()].filter((b) => bm[b] > 0).sort((a, b) => bm[b] - bm[a]).slice(0, 4); }
  meta.domBlocks = domBlocks;

  // ── 3. the 144-node snippet library + the 20,736 ordered pair signatures (cached) ──
  let _lib = [];
  try { _lib = JSON.parse(read('data/pmu/snippet-library-144.json')); if (!Array.isArray(_lib)) _lib = _lib.anchors || _lib.nodes || []; } catch { _lib = []; }
  const seedOf = (coord) => String((_lib.find((t) => t.coord === coord) || {}).snippet || '(empty tile)').replace(/\s+/g, ' ').trim();
  const meaning = {}; for (const a of _lib) if (a && a.coord) meaning[a.coord] = String(a.snippet || a.seed || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].slice(0, 110);

  let cole = null, rawGrids = null, shortlex = null, pixelStatementHtml = '', diagTiles = null, pixelCell = null;
  let tCole = 0, tIngest = null;
  try {
    const { simhash: sh, hamming: hd, SIG_BITS: SB, wordShingles: wsh } = await import('../../src/app/pmu-simulator/signature.mjs');
    const { claimify, salienceRank } = await import('./corpus-ingest.mjs');
    const nodeText = new Array(144).fill('');
    for (let a = 0; a < 144; a++) nodeText[a] = String((_lib.find((t) => t.coord === COORDS[a]) || {}).snippet || '');
    const libSha = createHash('sha256').update(nodeText.join(' ')).digest('hex').slice(0, 12);
    const PAIR_CACHE = resolve(REPO, `.thetacog/cache/pair-sigs-144-${libSha}.json`);
    let pairSigs;
    if (existsSync(PAIR_CACHE)) {
      pairSigs = JSON.parse(readFileSync(PAIR_CACHE, 'utf8')).map(BigInt);
    } else {
      pairSigs = new Array(20736);
      for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) pairSigs[i * 144 + j] = sh(`${nodeText[i]} ${nodeText[j]}`, SB, wsh);
      try { writeFileSync(PAIR_CACHE, JSON.stringify(pairSigs.map(String))); } catch { /* cache best-effort */ }
    }
    // ── senseDecompose: directional 20,736-cell sensor decision (commit-triptych:317-333) ──
    const tIn0 = Date.now();
    const senseDecompose = (text) => {
      const claims = salienceRank(claimify(String(text || ''))).slice(0, 160);
      const claimSigs = claims.map((c) => sh(c, SB, wsh));
      const score = new Float32Array(20736);
      for (const cs of claimSigs) for (let k = 0; k < 20736; k++) { const v = 1 - hd(cs, pairSigs[k]) / SB; if (v > score[k]) score[k] = v; }
      const sorted = Float32Array.from(score).sort().reverse();
      const TARGET = 900;
      const theta = Math.max(0.56, sorted[Math.min(TARGET, sorted.length - 1)] || 0.56);
      const g = new Uint8Array(20736); let lit = 0;
      for (let k = 0; k < 20736; k++) if (score[k] >= theta && score[k] > 0) { g[k] = 1; lit++; }
      return { grid: g, score, lit, theta, claims: claims.length };
    };
    const senseI = senseDecompose(intentText), senseR = senseDecompose(realityText);
    tIngest = Date.now() - tIn0;
    meta.senseI = { lit: senseI.lit, theta: senseI.theta, claims: senseI.claims };
    meta.senseR = { lit: senseR.lit, theta: senseR.theta, claims: senseR.claims };
    const intentGrid = senseI.grid, realityGrid = senseR.grid;
    rawGrids = { intent: intentGrid, reality: realityGrid };

    // ── competence pixel: sensed argmax actor∩patient (commit-triptych:345-364) ──
    let pix = 0, pixScore = -1;
    for (let k2 = 0; k2 < 20736; k2++) if (senseI.score[k2] > pixScore) { pixScore = senseI.score[k2]; pix = k2; }
    const actorA = Math.floor(pix / 144);
    const topCells = [...senseI.score.keys()].sort((a, b) => senseI.score[b] - senseI.score[a]).slice(0, 8);
    const actorMass = new Map(); for (const c of topCells) { const a = Math.floor(c / 144); actorMass.set(a, (actorMass.get(a) || 0) + senseI.score[c]); }
    const startPick = pickStartPixel([...actorMass.keys()], (a) => actorMass.get(a) || 0, { iters: 50, damping: 0.85 });
    const startPixel = startPick.start, startRow = Math.floor(startPixel / 12);
    let patientPixel = 0, pixGrip = -1;
    for (let j = 0; j < 144; j++) { const v = senseI.score[startPixel * 144 + j]; if (v > pixGrip) { pixGrip = v; patientPixel = j; } }
    pixelCell = startPixel * 144 + patientPixel;
    Object.assign(meta, { startPixel, patientPixel, pixGrip: +pixGrip.toFixed(3), actorCoord: COORDS[startPixel], patientCoord: COORDS[patientPixel] });

    // ── the leaf/definer ballistic walk ON CHIP, both sides + matchSigma (commit-triptych:370-407) ──
    // bounded for the interactive npx path: fewer impostors + a smaller per-walk budget than the
    // detached email path (which can afford 12 × 2.5s). Speed is a correctness signal — stay on chip.
    const leafWalk = (grid) => definerWalk144([startPixel, patientPixel], { gridBits: grid, maxDepth: 8, topK, decay, budgetMs });
    const tc0 = Date.now();
    const [it, rt] = await Promise.all([leafWalk(intentGrid), leafWalk(realityGrid)]);
    tCole = Date.now() - tc0;
    const cosine = (a, b) => { let dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return (na && nb) ? dot / Math.sqrt(na * nb) : 0; };
    const shapeOverlap = (a, b) => cosine(a.matrix, b.matrix);
    const actual = shapeOverlap(it, rt);
    const shuffle = (g) => { const a = Uint8Array.from(g); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    const impWalks = await Promise.all(Array.from({ length: Math.max(2, impostors) }, () => leafWalk(shuffle(realityGrid))));
    const imps = impWalks.map((iw) => shapeOverlap(it, iw));
    const mu = imps.reduce((s, v) => s + v, 0) / imps.length;
    const sd = Math.sqrt(imps.reduce((s, v) => s + (v - mu) ** 2, 0) / imps.length);
    const matchSigma = sd ? (actual - mu) / sd : 0;
    const cellsOf = (wlk) => wlk.matrix.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
    cole = { intent: it, reality: rt, startPixel, startRow, pixelCell, hops: it.hops + rt.hops, maxPly: Math.max(it.maxPly, rt.maxPly), matchSigma: +matchSigma.toFixed(2), actualMatch: +actual.toFixed(4), impMean: +mu.toFixed(3), intentCells: cellsOf(it), realityCells: cellsOf(rt) };
    meta.matchSigma = cole.matchSigma;
    meta.walkMode = 'ballistic-edges';

    // ── the competence-pixel statement (commit-triptych:471-476) ──
    pixelStatementHtml = `<div style="margin:-6px 0 16px;padding:11px 13px;background:#0a1018;border:1px solid #1a2a3a;border-left:3px solid #ff50c8;border-radius:6px;font-size:12px;line-height:1.6;text-align:left">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#ff8ad8;text-transform:uppercase;margin-bottom:6px">◎ the pixel this work belongs to</div>
<div style="color:#c9d1d9"><b style="color:#ff8ad8">${COORDS[startPixel]}</b> — ${tileWords(COORDS[startPixel])} (actor) acting on <b style="color:#ff8ad8">${COORDS[patientPixel]}</b> — ${tileWords(COORDS[patientPixel])} (patient) · grip ${pixGrip.toFixed(3)}</div>
<div style="margin-top:7px;color:#8b98a5"><b style="color:#66fcf1">actor seed ${COORDS[startPixel]}</b> — ${esc(seedOf(COORDS[startPixel]))}</div>
<div style="margin-top:5px;color:#8b98a5"><b style="color:#fbbf24">patient seed ${COORDS[patientPixel]}</b> — ${esc(seedOf(COORDS[patientPixel]))}</div>
</div>`;

    // ── the diagonal tile dump (commit-triptych:255-262) ──
    const SENSE = S.sense || {};
    const icm = SENSE.intent_claim_map || {}, rcm = SENSE.reality_claim_map || {};
    const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    diagTiles = AX12.map((a) => { const coord = `${a},${a}`, ic = icm[coord] || {}, rc = rcm[coord] || {};
      return { coord, meaning: meaning[coord] || '', intent: clip(ic.claim, 95), intentSim: Math.round((ic.frag_sim ?? ic.assign_sim ?? 0) * 100), reality: clip(rc.claim, 95), realitySim: Math.round((rc.frag_sim ?? rc.assign_sim ?? 0) * 100) }; });

    // ── the SHORTLEX-3 projection row (commit-triptych:484-503) — degrades to a note ──
    try {
      const { shortlexLattice, zoneOccupancy, defaultSigOf } = await import('./shortlex-project.mjs');
      const { loadRegistry, REGISTRY_PATH } = await import('./shortlex-registry.mjs');
      const CAND_PATH = resolve(REPO, 'data/pmu/shortlex-children-candidate.json');
      if (!existsSync(REGISTRY_PATH)) throw new Error('registry missing');
      if (!existsSync(CAND_PATH)) throw new Error('candidate children missing');
      const slReg = loadRegistry();
      const slSigOf = defaultSigOf();
      const claimsOf = (t) => salienceRank(claimify(String(t || ''))).slice(0, 160);
      const tSl = Date.now();
      const lat = shortlexLattice({ registry: slReg, sigOf: slSigOf, intentClaims: claimsOf(intentText), realityClaims: claimsOf(realityText) });
      const slMs = Date.now() - tSl;
      const zi = zoneOccupancy(lat.intentGrid, slReg), zr = zoneOccupancy(lat.realityGrid, slReg);
      shortlex = { intentGrid: lat.intentGrid, realityGrid: lat.realityGrid, registry: slReg, zi, zr, ms: slMs, intentMeta: lat.intent, realityMeta: lat.reality };
    } catch (e) {
      shortlex = { note: String(e.message || e).slice(0, 140) };
    }
  } catch (e) {
    // the heavy ballistic path failed (unbuilt daemon, thin corpus, missing sensor dep) — degrade
    // HONESTLY to the coarse heatmap tolerance; the report states which path ran (walkMode).
    meta.note = String(e?.message || e).slice(0, 160);
  }

  meta.timings = { ingest: tIngest, walk: tCole || null, total: pipelineMs + tCole };

  return {
    renderArgs: {
      intentB64, realityB64, frictionB64, domBlocks,
      cole, rawGrids, shortlex, pixelStatementHtml, pixelCell,
      tiles: diagTiles || [], sigmaType,
      timings: meta.timings,
    },
    meta,
  };
}
