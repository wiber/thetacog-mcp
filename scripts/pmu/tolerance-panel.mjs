#!/usr/bin/env node
// scripts/pmu/tolerance-panel.mjs — the ONE composed tolerance-panel pipeline.
//
// WHY THIS EXISTS (2026-06-27): the competence panel was being built TWO ways. The commit-email path
// (commit-triptych.mjs) ran the FULL composition — runPipeline → empty-heat retry → compute domBlocks
// (the in-lane reference) → renderTriptych WITH domBlocks → encircle — and came out DENSE + green-rich
// (correct). The blog/OG path (annotate-regions.mjs main) ran a THINNER one — renderTriptych WITHOUT
// domBlocks — so with no in-lane reference the whole panel read as bleed/drift (amber) and looked sparse
// and wrong. Two ways, only one correct = exactly the drift the anti-rules ledger warns about. This
// module is the single source: both consumers compose THESE functions, so the tolerance classification
// (green in-lane vs amber/red drift) is computed against the SAME reference everywhere.
//
// Composition:  runPanelPipeline  →  composeTolerancePanel  →  composeEncircledPanel
//   runPanelPipeline      runPipeline (rust on-chip walk) + empty-heat retry + domBlocks
//   composeTolerancePanel + renderTriptych WITH domBlocks → the tolerance rgba + counts
//   composeEncircledPanel + detectColorRegions + encircleRegionsPng → the burned-in OG artifact

import { runPipeline } from './pipeline.mjs';
import { renderTriptych } from './triptych-render.mjs';
import { coverageRegions, encircleRegionsPng } from './annotate-regions.mjs';
import { detectRegions } from './regions-chip.mjs';   // one functional entry (default JS; PMU_REGIONS_CHIP=auto → chip)

// the 16 ShortLex macro-blocks: cell index → its 4×4 block (matches commit-triptych's blockOf).
const blockOf = (i) => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
const heatEmpty = (b64) => { const b = Buffer.from(b64 || '', 'base64'); if (!b.length) return true; for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false; return true; };
const heatBad = (x) => heatEmpty(x?.stages?.walk?.reality_heatmap_b64) || heatEmpty(x?.stages?.walk?.intent_heatmap_b64);

// runPanelPipeline — runPipeline + empty-heat retry + domBlocks. The empty-heat retry survives the
// concurrent-write race the post-commit fan-out creates (a shared pipeline input caught mid-write hands
// the walk all-zero heat → a blank grid); domBlocks (top-4 intent-heatmap blocks) is the IN-LANE
// reference the tolerance classifier needs — WITHOUT it, reality has nothing to be "in lane" against and
// the whole panel collapses to amber/red. This is the part the blog path was missing.
export async function runPanelPipeline({ intentText, realityText, intentLabel = 'intent', realityLabel = 'reality', retries = 5, log = () => {} } = {}) {
  const ppArgs = { intentText, realityText, intentLabel, realityLabel };
  const t0 = Date.now();
  let r = await runPipeline(ppArgs);
  for (let attempt = 1; attempt <= retries && heatBad(r); attempt++) {
    const waitMs = 300 * attempt;   // 300·600·900·1200·1500ms — outlast the concurrent write window
    log(`   ⚠ empty heat (concurrent-write race) — retry ${attempt}/${retries} after ${waitMs}ms`);
    await new Promise((res) => setTimeout(res, waitMs));
    const r2 = await runPipeline(ppArgs);
    if (!heatBad(r2)) { r = r2; break; }
  }
  const pipelineMs = Date.now() - t0;
  const w = r.stages?.walk || {}, x = r.stages?.xor || {};
  // dominant blocks from the intent heatmap (top-4 by node block mass) → the tolerance reference.
  const ib = Buffer.from(w.intent_heatmap_b64 || '', 'base64');
  const f32 = ib.length === 20736 * 4 ? new Float32Array(ib.buffer, ib.byteOffset, 20736) : null;
  let domBlocks = [];
  if (f32) { const bm = new Array(16).fill(0); for (let i = 0; i < 20736; i++) bm[blockOf((i % 144) % 144)] += f32[i]; domBlocks = [...bm.keys()].filter((b) => bm[b] > 0).sort((a, b) => bm[b] - bm[a]).slice(0, 4); }
  return { r, w, x, domBlocks, pipelineMs };
}

// composeTolerancePanel — runPanelPipeline → renderTriptych WITH domBlocks → the tolerance rgba + meta.
// `extra` carries any email-specific renderTriptych args (tiles, cole, shortlex, crosshair…); the blog
// passes none. killTolerancePct + domBlocks are fixed here so every caller gets the SAME classifier.
export async function composeTolerancePanel({ intentText, realityText, intentLabel, realityLabel, label = 'tolerance', sub = '', extra = {}, log = () => {} } = {}) {
  const { r, w, x, domBlocks, pipelineMs } = await runPanelPipeline({ intentText, realityText, intentLabel, realityLabel, log });
  if (!w.intent_heatmap_b64 || !x.friction_bitmap_b64) throw new Error('pipeline produced no triptych bitmaps (stages: ' + Object.keys(r.stages || {}).join(',') + ')');
  const trip = renderTriptych({
    intentB64: w.intent_heatmap_b64, realityB64: w.reality_heatmap_b64, frictionB64: x.friction_bitmap_b64,
    domBlocks, killTolerancePct: 25, label, sub, ...extra,
  });
  const tol = trip.tol || {};
  const meta = { green: tol.green, amber: tol.amber, red: tol.red, offPct: tol.offPct, region: tol.pattern?.region, tooMany: tol.tooMany, domBlocks };
  return { rgba: tol.rgba, meta, trip, r, w, x, domBlocks, pipelineMs };
}

// composeEncircledPanel — the full blog/OG artifact: the SAME tolerance panel the commit email shows,
// then its colored regions detected and burned in as encircled rings (the SHAPE the eye reads). Returns
// the PNG bytes + regions + meta so the caller writes the file and reads counts.
export async function composeEncircledPanel({ intentText, realityText, scale = 4, label = 'encircled', sub = 'tolerance', message, log = () => {} } = {}) {
  const { rgba, meta } = await composeTolerancePanel({ intentText, realityText, label, sub, log });
  if (!rgba) throw new Error('no tolerance rgba');
  // COVERAGE_ENCIRCLE=1 → the coverage-driven clusterer (fewest ellipses covering ~TARGET% of each
  // colour, purity-reported) instead of the connectivity clusterer (which over-fragments).
  const regions = process.env.COVERAGE_ENCIRCLE === '1'
    ? coverageRegions(rgba, { coreFrac: Number(process.env.COVERAGE_CORE || '0.6'), densityFrac: Number(process.env.COVERAGE_DFRAC || '0.20'), densityAbs: Number(process.env.COVERAGE_DABS || '5'), maxPerColor: Number(process.env.COVERAGE_MAX || '5') })
    : detectRegions(rgba);
  if (message) { const { sliceMessageToRegions } = await import('./region-message.mjs'); sliceMessageToRegions(message, regions); }
  const png = encircleRegionsPng(rgba, regions, { scale });
  return { rgba, regions, png, meta };
}
