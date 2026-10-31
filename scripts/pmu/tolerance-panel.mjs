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

import { dirname, resolve as _resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO_ROOT = _resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
import * as DC from '../vna/door-crate.mjs';   // C612b2: the lean encircled path — one pipeline run, no triptych HTML, placements + PNG in the crate
import { walkBoolean } from './tolerance-panel-verdict.mjs';   // C1408: the panel's verdict comes from the one verdict surface, never off meta.tooMany
// C612r: the node half is imported only when it runs. The default door is `pmu-onchip --door-serve {op:"panel"}` (DC.panelCrate), which
// composes the whole panel in the crate; pipeline.mjs, triptych-render.mjs, annotate-regions.mjs and regions-chip.mjs load only on the
// node path (PMU_DOOR_CRATE=0, or a request the crate declines) — their import alone was ~60 ms of every note's door.
const NODE_HALF = async () => {
  const [P, TR, AR, RC] = await Promise.all([import('./pipeline.mjs'), import('./triptych-render.mjs'), import('./annotate-regions.mjs'), import('./regions-chip.mjs')]);
  return { runPipeline: P.runPipeline, dominantBlocks: TR.dominantBlocks, renderTriptych: TR.renderTriptych,   // C18: the block rule has ONE home
    coverageRegions: AR.coverageRegions, encircleRegionsPng: AR.encircleRegionsPng, encircleRegionsRgba: AR.encircleRegionsRgba,
    detectRegions: RC.detectRegions };   // one functional entry (default JS; PMU_REGIONS_CHIP=auto → chip)
};

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
  const { runPipeline, dominantBlocks } = await NODE_HALF();
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
// sensor (C610k): forwarded to buildTriptychInputs ONLY when a caller gives one — absent, the call below is the parent's.
export async function composeTolerancePanel({ intentText, realityText, intentLabel, realityLabel, label = 'tolerance', sub = '', extra = {}, axesPath, sensor, log = () => {}, lean = false } = {}) {
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
        drawBelowFloor: true,   // C1394: a thin commit is direction-only, never blank — the panel is drawn, its stamp says below floor, no verdict reads it
        ...(lean ? { withShortlex: false, ...(axesPath == null ? { pipeline: r } : {}) } : {}),   // C612b2: the pipeline once (same texts, default axes), no shortlex
        ...(sensor !== undefined ? { sensor } : {}),
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
  const { renderTriptych } = await NODE_HALF();
  const trip = renderTriptych({
    ...renderArgs, killTolerancePct: 25, label, sub, ...extra, ...(lean ? { lean: true } : {}),
  });
  const tol = trip.tol || {};
  // THE REFUSAL RIDES OUT WITH THE PANEL (2026-09-11). The decoder names its refusal ("LIT-MASS FLOOR …
  // UNMEASURED, never a pass") and this line used to drop it, so every caller downstream saw an rgba
  // and an offPct of null and painted the refusal as a picture — 205/206 blog OG panels were that.
  // C1408 (2026-10-29): THE ENTRY'S STAMP RIDES OUT WITH THE PANEL, AND THE VERDICT IS walkBoolean's. The C1394 skeptic read this door
  // on the sub-floor sledgehammer: offPct 18, tooMany false and no stamp — the incident reading, with nothing on it saying the text
  // was under the floor (renderTriptych had the stamp; this line dropped it). The stamp is the entry's (door.rs entry_op, carried by
  // buildTriptychInputs into renderArgs.stamp → tol.stamp), below_floor included; meta.verdict is walkBoolean of this reading, so a
  // panel drawn under the floor is UNMEASURED on every surface that reads the verdict instead of the counts.
  const stamp = tol.stamp || renderArgs.stamp || null;
  const meta = { green: tol.green, amber: tol.amber, red: tol.red, offPct: tol.offPct, region: tol.pattern?.region, tooMany: tol.tooMany, domBlocks, edges,
    refused: !!tol.refused, refusal: tol.refusal || null, litMass: tol.litMass || null, stamp };
  meta.verdict = walkBoolean(meta);
  // THE COLE MATRICES RIDE OUT WITH THE PANEL (2026-09-08). They are built here already — the block
  // above calls buildTriptychInputs to get them — and were then dropped, so any surface that needed
  // the walk's own field had to rebuild it from a different grid with a different seed. That is
  // precisely how scripts/vna/cockpit.mjs became a second door: not out of laziness, but because the
  // one door did not hand back the thing it had. Returning it costs nothing and removes the reason.
  // THE PIPELINE STAGES RIDE OUT TOO. `r`, `w` and `x` are already here; a surface that wanted
  // the walk agreement or the witness split had to call runPipeline a SECOND time to get them, which
  // is the whole mechanism by which a second door is born — not laziness, but the one door withholding
  // what it already computed. Named `stages` because that is what a consumer asks for.
  // THE GRIDS THE WALK READ RIDE OUT TOO (C610k). stages.xor is the Rust sensor's grid; the walk reads rawGrids (the
  // claim sensor by default, the xor bits on the ncd arm). A consumer that wanted the walked grid had to call the
  // builder a second time — packed MSB-first like stages.xor (2,592 B a side), null when the builder did not run.
  const packBits = (u8) => { const b = Buffer.alloc(2592); for (let i = 0; i < 20736; i++) if (u8[i]) b[i >> 3] |= 1 << (7 - (i & 7)); return b.toString('base64'); };
  const g = renderArgs.rawGrids;
  const grids = g?.intent && g?.reality ? { intent_b64: packBits(g.intent), reality_b64: packBits(g.reality), sensor: sensor ?? 'claim' } : null;
  return { rgba: tol.rgba, meta, trip, r, w, x, domBlocks, pipelineMs, cole: renderArgs.cole || null, grids,
           stages: { walk: w || null, xor: x || null, sense: r?.stages?.sense || null, pipelineMs } };
}

// C1408: the crate's panel op composes the whole panel without the entry (door_panel.rs; its own entry_op call is the next step named in
// tests/pmu/instrument-entry-allowlist.json). Its answer carries no stamp, so walkBoolean reads it as UNMEASURED ("no health stamp") —
// never a verdict — and no extra crate request is spent to dress it (C612r holds the default door to ONE panel request). The stamp
// and the verdict ride BESIDE meta on both paths, so meta stays the counts the crate and the node half must agree on byte for byte.
function withVerdict(out, stamp) { return { ...out, stamp: stamp || null, verdict: walkBoolean({ ...out.meta, stamp: stamp || null }) }; }

// composeEncircledPanel — the full blog/OG artifact: the SAME tolerance panel the commit email shows,
// then its colored regions detected and burned in as encircled rings (the SHAPE the eye reads). Returns
// the PNG bytes + regions + meta so the caller writes the file and reads counts.
export async function composeEncircledPanel({ intentText, realityText, scale = 4, label = 'encircled', sub = 'tolerance', message, axesPath, sensor, log = () => {} } = {}) {
  // C612r: THE DEFAULT DOOR — the whole panel in one crate request. The crate serves the claim sensor on the repo-wide library with the chip
  // clusterer; anything else (an axes override, the ncd arm, COVERAGE_ENCIRCLE=1, PMU_REGIONS_CHIP=off) and anything it declines runs below.
  // PMU_DOOR_PANEL=0 keeps the C612b2 lean path below (the before arm of the C612r timing receipt).
  if (DC.crateEnabled() && process.env.PMU_DOOR_PANEL !== '0' && axesPath == null && (sensor === undefined || sensor === 'claim') && process.env.COVERAGE_ENCIRCLE !== '1' && (process.env.PMU_REGIONS_CHIP || 'auto') !== 'off') {
    try { const out = await DC.panelCrate({ intentText, realityText, message, scale }); if (out) return withVerdict(out, null); } catch (e) { DC.noteFallback('panel', e); }
  }
  const { coverageRegions, encircleRegionsPng, encircleRegionsRgba, detectRegions } = await NODE_HALF();
  // C612b2: the crate path is LEAN — the encircled panel reads only tol, so the triptych HTML, its PNGs and the shortlex projection are
  // skipped and the pipeline runs once; the clause placements and the final PNG encode run in pmu-onchip --door-serve. PMU_DOOR_CRATE=0
  // is the full path, the reference the C612b2 guard holds this one to.
  const lean = DC.crateEnabled();
  const { rgba, meta: tpMeta, cole, stages, grids } = await composeTolerancePanel({ intentText, realityText, label, sub, axesPath, log, ...(sensor !== undefined ? { sensor } : {}), ...(lean ? { lean: true } : {}) });
  if (!rgba) throw new Error('no tolerance rgba');
  const { stamp, verdict: _v, ...meta } = tpMeta;   // C1408: the stamp and the verdict ride beside meta (withVerdict), as on the crate path
  // COVERAGE_ENCIRCLE=1 → the coverage-driven clusterer (fewest ellipses covering ~TARGET% of each
  // colour, purity-reported) instead of the connectivity clusterer (which over-fragments).
  const regions = process.env.COVERAGE_ENCIRCLE === '1'
    ? coverageRegions(rgba, { coreFrac: Number(process.env.COVERAGE_CORE || '0.6'), densityFrac: Number(process.env.COVERAGE_DFRAC || '0.20'), densityAbs: Number(process.env.COVERAGE_DABS || '5'), maxPerColor: Number(process.env.COVERAGE_MAX || '5') })
    : detectRegions(rgba);
  if (message) {
    const { sliceMessageToRegions, messageClauses, loadPairLib } = await import('./region-message.mjs');
    let placeFn = null;
    if (lean) { try { const lib = loadPairLib(); const cl = messageClauses(message); const ps = cl.length && lib.length ? await DC.placeCrate(cl, lib) : []; const m = new Map(cl.map((c, i) => [c, ps[i]])); placeFn = (c) => m.get(c); } catch (e) { DC.noteFallback('place', e); placeFn = null; } }
    sliceMessageToRegions(message, regions, placeFn ? { placeFn } : {});
  }
  // WHICH ENGINE CLUSTERED rides out with the panel (2026-09-14): detectRegions tags its output with the
  // engine it actually used (rust-regions-chip, or a NAMED js fallback). A consumer that must prove the
  // chip ran reads meta.regionEngine — a fallback that is not reported is the defect.
  meta.regionEngine = regions.engine || (process.env.COVERAGE_ENCIRCLE === '1' ? 'js-coverageRegions (COVERAGE_ENCIRCLE=1)' : null);
  let png = null;
  if (lean) { try { const big = encircleRegionsRgba(rgba, regions, scale); png = await DC.pngCrate(big.rgba, big.w, big.h); } catch (e) { DC.noteFallback('png', e); png = null; } }
  if (!png) png = encircleRegionsPng(rgba, regions, { scale });
  return withVerdict({ rgba, regions, png, meta, cole, stages, grids }, stamp);
}
