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
import { dominantBlocks } from './triptych-render.mjs';   // C18: the block rule has ONE home
import { renderTriptych } from './triptych-render.mjs';
import { dirname, resolve as _resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO_ROOT = _resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
export async function runPanelPipeline({ intentText, realityText, intentLabel = 'intent', realityLabel = 'reality', retries = 5, axesPath, log = () => {} } = {}) {
  // axesPath: optional override forwarded straight to runPipeline → loadAxes. undefined (the
  // default on every caller today) = the repo-wide 144 library = unchanged behaviour.
  const ppArgs = { intentText, realityText, intentLabel, realityLabel, axesPath };
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
  if (f32) domBlocks = dominantBlocks(f32, blockOf);   // C18: one home — triptych-render.mjs
  return { r, w, x, domBlocks, pipelineMs };
}

// composeTolerancePanel — runPanelPipeline → renderTriptych WITH domBlocks → the tolerance rgba + meta.
// `extra` carries any email-specific renderTriptych args (tiles, cole, shortlex, crosshair…); the blog
// passes none. killTolerancePct + domBlocks are fixed here so every caller gets the SAME classifier.
export async function composeTolerancePanel({ intentText, realityText, intentLabel, realityLabel, label = 'tolerance', sub = '', extra = {}, axesPath, log = () => {} } = {}) {
  const { r, w, x, domBlocks, pipelineMs } = await runPanelPipeline({ intentText, realityText, intentLabel, realityLabel, axesPath, log });
  if (!w.intent_heatmap_b64 || !x.friction_bitmap_b64) throw new Error('pipeline produced no triptych bitmaps (stages: ' + Object.keys(r.stages || {}).join(',') + ')');

  // ── COLE OR IT IS THE FORBIDDEN PATH ────────────────────────────────────────────────────────
  // renderTriptych picks its decoder on ONE condition:
  //
  //   const hasEdges = cole && cole.intent.matrix && cole.reality.matrix;
  //   const tol = hasEdges ? decodeDeltaThreeColourEdges(...) : decodeDeltaThreeColour(...);
  //
  // Those two are not variants of one reading. decodeDeltaThreeColourEdges derives its in-lane
  // reference from BOTH axes — blkOf(i) -> [row-block, col-block] — and produces the dense,
  // irregular, localized field. decodeDeltaThreeColour classifies by ROW ALONE:
  //
  //   const rowNode = Math.floor(i / N) % 144, d = dist(blockOf(rowNode));
  //
  // Every cell in a row therefore gets the same class, so the field can only ever be horizontal
  // bands — and encircling contiguous same-class regions turns those into ELLIPSES SPANNING THE
  // FULL WIDTH. That is the artifact the operator reported over and over ("too sparse", "should
  // have checkered", "that's not the right rust pipeline png"), and it was never a mass problem:
  // measured 2026-08-21, quadrupling the corpus (intent 388 -> 9781 gzip bytes, reality 1512 ->
  // 33067, ratio inside the band) produced the SAME banded panel, slightly smaller.
  //
  // triptych-build.mjs names this in its own header: "@forbidden-alternative the coarse
  // decodeDeltaThreeColour-only path (no cole)". Callers that spread ...built.renderArgs
  // (attest-serve, the heldout sweeps) have always had the good one. This function hand-rolled its
  // render args and the comment below the signature admits it — "extra carries any email-specific
  // renderTriptych args (tiles, cole, shortlex…); the blog passes none". Passing none silently
  // selected the forbidden decoder, with nothing anywhere saying a lesser reading had been taken.
  //
  // So the edges are built here when the caller has not supplied them. Measured on the decision
  // corpus: 11.0s, and the counts stop being all-bleed — green 669 · amber 611 · red 441.
  let renderArgs = { intentB64: w.intent_heatmap_b64, realityB64: w.reality_heatmap_b64, frictionB64: x.friction_bitmap_b64, domBlocks };
  let edges = 'supplied-by-caller';
  if (!extra.cole) {
    try {
      const { buildTriptychInputs } = await import('./triptych-build.mjs');
      const built = await buildTriptychInputs({
        intentText: String(intentText || ''), realityText: String(realityText || ''),
        repoRoot: REPO_ROOT, killTolerancePct: 25, sigmaType: 'drift',   // walk knobs: inherited from triptych-build WALK_KNOBS, never restated here
      });
      if (built?.renderArgs?.cole?.intent?.matrix && built.renderArgs.cole.reality?.matrix) {
        renderArgs = built.renderArgs;
        edges = 'built';
      } else {
        edges = 'unavailable — builder returned no cole matrices';
      }
    } catch (e) {
      // NEVER silently. A banded panel that nobody knows is banded is how this survived for weeks.
      edges = `unavailable — ${String(e?.message || e).slice(0, 160)}`;
    }
    if (edges !== 'built') log(`   ⚠ DEGRADED PANEL: no ballistic edge matrices, so the row-only decoder is in use — this panel will read as horizontal bands, not a 2-D field (${edges})`);
  }
  const trip = renderTriptych({
    ...renderArgs, killTolerancePct: 25, label, sub, ...extra,
  });
  const tol = trip.tol || {};
  // THE REFUSAL RIDES OUT WITH THE PANEL (2026-09-11). The decoder names its refusal ("LIT-MASS FLOOR …
  // UNMEASURED, never a pass") and this line used to drop it, so every caller downstream saw an rgba
  // and an offPct of null and painted the refusal as a picture — 205/206 blog OG panels were that.
  const meta = { green: tol.green, amber: tol.amber, red: tol.red, offPct: tol.offPct, region: tol.pattern?.region, tooMany: tol.tooMany, domBlocks, edges,
    refused: !!tol.refused, refusal: tol.refusal || null, litMass: tol.litMass || null };
  // THE COLE MATRICES RIDE OUT WITH THE PANEL (2026-09-08). They are built here already — the block
  // above calls buildTriptychInputs to get them — and were then dropped, so any surface that needed
  // the walk's own field had to rebuild it from a different grid with a different seed. That is
  // precisely how scripts/vna/cockpit.mjs became a second door: not out of laziness, but because the
  // one door did not hand back the thing it had. Returning it costs nothing and removes the reason.
  // THE PIPELINE STAGES RIDE OUT TOO. `r`, `w` and `x` are already here; a surface that wanted
  // the walk agreement or the witness split had to call runPipeline a SECOND time to get them, which
  // is the whole mechanism by which a second door is born — not laziness, but the one door withholding
  // what it already computed. Named `stages` because that is what a consumer asks for.
  return { rgba: tol.rgba, meta, trip, r, w, x, domBlocks, pipelineMs, cole: renderArgs.cole || null,
           stages: { walk: w || null, xor: x || null, sense: r?.stages?.sense || null, pipelineMs } };
}

// composeEncircledPanel — the full blog/OG artifact: the SAME tolerance panel the commit email shows,
// then its colored regions detected and burned in as encircled rings (the SHAPE the eye reads). Returns
// the PNG bytes + regions + meta so the caller writes the file and reads counts.
export async function composeEncircledPanel({ intentText, realityText, scale = 4, label = 'encircled', sub = 'tolerance', message, axesPath, log = () => {} } = {}) {
  const { rgba, meta, cole, stages } = await composeTolerancePanel({ intentText, realityText, label, sub, axesPath, log });
  if (!rgba) throw new Error('no tolerance rgba');
  // COVERAGE_ENCIRCLE=1 → the coverage-driven clusterer (fewest ellipses covering ~TARGET% of each
  // colour, purity-reported) instead of the connectivity clusterer (which over-fragments).
  const regions = process.env.COVERAGE_ENCIRCLE === '1'
    ? coverageRegions(rgba, { coreFrac: Number(process.env.COVERAGE_CORE || '0.6'), densityFrac: Number(process.env.COVERAGE_DFRAC || '0.20'), densityAbs: Number(process.env.COVERAGE_DABS || '5'), maxPerColor: Number(process.env.COVERAGE_MAX || '5') })
    : detectRegions(rgba);
  if (message) { const { sliceMessageToRegions } = await import('./region-message.mjs'); sliceMessageToRegions(message, regions); }
  // WHICH ENGINE CLUSTERED rides out with the panel (2026-09-14): detectRegions tags its output with the
  // engine it actually used (rust-regions-chip, or a NAMED js fallback). A consumer that must prove the
  // chip ran reads meta.regionEngine — a fallback that is not reported is the defect.
  meta.regionEngine = regions.engine || (process.env.COVERAGE_ENCIRCLE === '1' ? 'js-coverageRegions (COVERAGE_ENCIRCLE=1)' : null);
  const png = encircleRegionsPng(rgba, regions, { scale });
  return { rgba, regions, png, meta, cole, stages };
}
