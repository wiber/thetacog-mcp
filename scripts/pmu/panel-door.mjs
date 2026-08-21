// scripts/pmu/panel-door.mjs — THE ONE DOOR to the canonical PMU panel.
//
// CANONICAL, COMMITTED SOURCE. packages/thetacog-mcp/scripts/pmu/ is a git-ignored local mirror of
// this directory (see packages/thetacog-mcp/.gitignore: "regenerated from the repo at publish time,
// so it ships in the tarball without bloating git history" — every sibling file here, e.g.
// tolerance-panel.mjs, pipeline.mjs, triptych-build.mjs, has the same tracked-here/mirrored-there
// pair). A byte-identical copy is kept at packages/thetacog-mcp/scripts/pmu/panel-door.mjs so
// packages/thetacog-mcp/scripts/tape/render-panels.mjs — which imports its siblings from that
// directory, matching how it already imported tolerance-panel.mjs before this change — keeps working
// unchanged. Edit THIS file; re-copy to the mirror if you touch it (do not hand-edit the mirror).
//
// ┌─ WHY THIS EXISTS (measured 2026-08-20) ───────────────────────────────────────────────────────┐
// │ The same panel was being reached under FOUR different names with FOUR different argument       │
// │ shapes: composeEncircledPanel (scripts/pmu/tolerance-panel.mjs — the real renderer),            │
// │ pipelinePanels (scripts/rewrite/tesseract.mjs — a thinner wrapper that DROPS `meta` and cannot  │
// │ pass `message`, so the operator's own clauses never reach sliceMessageToRegions),                │
// │ encircledPanel (scripts/pmu/regions-chip.mjs — a different function entirely: chain-fallback    │
// │ over pre-rendered rgba surfaces, not intent/reality text), and buildTriptychInputs               │
// │ (scripts/pmu/triptych-build.mjs — the raw pipeline-input builder, one more layer down). A scan   │
// │ of scripts/, packages/thetacog-mcp/scripts/, and src/ on this date found 45 files reaching one   │
// │ of those five names DIRECTLY. Three regressions this week shared one shape: a new surface        │
// │ reached the pipeline through a different path than the one that had been proven correct, and     │
// │ inherited whatever that path silently drops. Operator: "there is only one canonical way to call  │
// │ it... how do you build this to make it easy to wire up instead of creating a regression every    │
// │ time?"                                                                                            │
// └────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// THE ANSWER: one exported function, one argument object, one return shape. Every new caller wires
// up by calling `panel({ intent, reality, message, ... })` — nothing else, no second way to ask.
//
// This module imports the canonical renderer DIRECTLY — composeEncircledPanel in
// scripts/pmu/tolerance-panel.mjs (walk → heatmaps → tolerance classify → region detect → encircled
// rings, LLM-free) — the SAME way scripts/pmu/lens-receipt-email.mjs:115 does, which is the reference
// invocation because it is what the commit email ships. `message` is ALWAYS forwarded when given, so
// sliceMessageToRegions runs and the operator's own clauses land in the rings — the one thing the
// pipelinePanels wrapper could never do, which is the whole reason that wrapper was wrong.
//
// `axesPath` is forwarded UNCONDITIONALLY (composeEncircledPanel → composeTolerancePanel →
// runPanelPipeline → runPipeline → loadAxes already destructure and use it as of this date). Another
// agent is CONCURRENTLY extending axesPath support elsewhere in tolerance-panel.mjs /
// pipeline-state.mjs — this file does not touch either, and passing an extra key through an options
// object is inert wherever it isn't (yet) read, so there is nothing here to block on.
//
// NEVER FABRICATES: a renderer throw or an empty png comes back as `{ png: null, unmeasured: '<reason>' }`
// — never a blank, never a zero standing in for "we don't know." LLM-FREE by construction: nothing in
// this file's import graph reaches a model.
//
// @guard tests/pmu/one-panel-door.test.mjs — enumerates every caller of the five internal names
// across scripts/, packages/thetacog-mcp/scripts/, src/ and fails if one exists that isn't on the
// committed allowlist (tests/pmu/panel-door-allowlist.json) — i.e. fails the moment a SECOND door is
// born. This file itself is the one hardcoded exception in that guard: it IS the door.
//
//   import { panel } from './panel-door.mjs';
//   const { png, dataUri, meta, regions, unmeasured } = await panel({ intent, reality, message });

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// same directory as tolerance-panel.mjs — this package carries its own copy of scripts/pmu (see
// render-panels.mjs's own note on the duplication; we import the copy that lives beside us).
const RENDERER = resolve(HERE, 'tolerance-panel.mjs');

/**
 * panel — THE ONE DOOR. Call this; never import composeEncircledPanel/runPipeline/
 * buildTriptychInputs/pipelinePanels/encircledPanel directly from a new surface.
 *
 * @param {object} args
 * @param {string} args.intent   - required. The INTENT text (a prompt, a quote, a spec).
 * @param {string} args.reality  - required. The REALITY text (a diff, a rule, a delivered surface).
 * @param {string|null} [args.message] - the operator's own words, sliced into the rings via
 *   sliceMessageToRegions when present. Pass the same text as `intent` when there is no separate
 *   commit message to slice (that is what render-panels.mjs does per atom).
 * @param {string|null} [args.axesPath] - optional 144-cell library override. undefined/null = the
 *   repo-wide default (unchanged behaviour for every caller today).
 * @param {string} [args.label]
 * @param {string} [args.sub]
 * @param {number} [args.scale] - ring-burn upscale. Omit to use the renderer's own default (4).
 * @returns {Promise<{
 *   png: Buffer|null, dataUri: string|null,
 *   meta: { offPct:number, green:number, amber:number, red:number, region:object, tooMany:boolean,
 *           domBlocks:number[], engine:string, ms:number } | null,
 *   regions: Array<{ kind:number, coord:object, name:string|null, center:string|null, span:string|null,
 *                     slices: Array<{clause:string, coord:string, sigma:number}> }>,
 *   unmeasured: string|null
 * }>}
 */
export async function panel({
  intent, reality, message = null, axesPath = null, label = 'panel', sub = '', scale = undefined,
} = {}) {
  if (intent == null || reality == null) {
    return { png: null, dataUri: null, meta: null, regions: [], unmeasured: 'intent/reality text required' };
  }

  let composeEncircledPanel;
  try {
    ({ composeEncircledPanel } = await import(RENDERER));
  } catch (e) {
    return { png: null, dataUri: null, meta: null, regions: [], unmeasured: `renderer unavailable: ${String(e?.message || e).slice(0, 200)}` };
  }

  const callArgs = { intentText: String(intent), realityText: String(reality), label, sub };
  // axesPath: forwarded ONLY when the caller actually gave one. The renderer's own chain
  // (composeEncircledPanel → composeTolerancePanel → runPanelPipeline → runPipeline → loadAxes)
  // uses a DEFAULT PARAMETER for the repo-wide 144 library, which only engages when the key is
  // absent/undefined — an explicit `null` bypasses the default and reaches `resolve(null)`, which
  // throws. So null/undefined here means "omit the key," never "pass null through."
  if (axesPath != null) callArgs.axesPath = axesPath;
  if (message != null) callArgs.message = String(message);   // forwarded IFF given — never omitted when the caller has one
  if (scale !== undefined) callArgs.scale = scale;

  const t0 = Date.now();
  let raw;
  try {
    raw = await composeEncircledPanel(callArgs);
  } catch (e) {
    return { png: null, dataUri: null, meta: null, regions: [], unmeasured: `renderer threw: ${String(e?.message || e).slice(0, 200)}` };
  }
  const ms = Date.now() - t0;

  if (!raw || !raw.png) {
    return { png: null, dataUri: null, meta: null, regions: [], unmeasured: 'renderer returned no png' };
  }

  const pngBuf = Buffer.isBuffer(raw.png) ? raw.png : Buffer.from(raw.png);
  const dataUri = `data:image/png;base64,${pngBuf.toString('base64')}`;
  const m = raw.meta || {};
  const meta = {
    offPct: m.offPct ?? null,
    green: m.green ?? null,
    amber: m.amber ?? null,
    red: m.red ?? null,
    region: m.region ?? null,
    tooMany: m.tooMany ?? null,
    domBlocks: m.domBlocks || null,
    engine: 'rust-ballistic-walk · tolerance-panel.mjs (via panel-door.mjs, the one door)',
    ms,
  };

  // Normalize regions to the flat shape the door promises. `coord` off the renderer is the OBJECT
  // regionShortLex() builds ({label, center, anchors, rowSpan, colSpan}); `messageSlice` (present only
  // when `message` was passed) is the array of {clause, coord, sigma} sliceMessageToRegions attaches.
  // This mapping is the one packages/thetacog-mcp/scripts/tape/render-panels.mjs already solved.
  const regions = (raw.regions || []).map((r) => ({
    kind: r.kind,
    coord: r.coord || null,
    name: r.name ?? r.reef ?? null,
    center: r.coord?.center ?? null,
    span: r.coord?.label ?? null,
    slices: Array.isArray(r.messageSlice)
      ? r.messageSlice.map((s) => ({ clause: String(s.clause || ''), coord: s.coord, sigma: s.sigma }))
      : [],
  }));

  return { png: pngBuf, dataUri, meta, regions, unmeasured: null };
}

export default panel;
