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
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
 *   cole: { intent:{matrix:Float64Array}, reality:{matrix:Float64Array}, startPixel:number, patientPixel?:number } | null,
 *     — the CANONICAL ballistic walk's own edge matrices, seeded from the sensed argmax with a
 *       deterministic hop budget. Returned so a surface that needs the walk's field (a self-lane
 *       dispersion panel, say) reads THIS one instead of rebuilding it from another grid with
 *       another seed — which is exactly how the last second door was born.
 *   stages: { walk, xor, sense, pipelineMs } | null
 *     — the pipeline stages the renderer already ran. Returned so a caller that wants the walk
 *       agreement or the witness split does not run runPipeline a SECOND time to get them; that
 *       second call is how a second door starts.
 *   regions: Array<{ kind:number, coord:object, name:string|null, center:string|null, span:string|null,
 *                     slices: Array<{clause:string, coord:string, sigma:number}> }>,
 *   unmeasured: string|null
 * }>}
 */
// ── ADMISSIBILITY — STANDING ON THE APERTURE THAT ALREADY EXISTS ──────────────────────────────
// Operator, 2026-08-20: "are you not looking at the rust code and starting from that? aperture is a
// hard won."
//
// Both halves of that were fair. The first version of this block INVENTED its constants — a
// 220-byte floor lifted from physics.mjs (which is the plate-matching entropy floor for a different
// call site) and a 1-25x band over raw TEXT LENGTHS that exists nowhere in this system. It then
// printed NOT ADMISSIBLE with the confidence of a calibrated instrument. That is the same failure it
// was written to catch, committed one layer up.
//
// THE REAL APERTURE, from packages/thetacog-mcp/src/lib/pmu/unified-drift.mjs, is a property of the
// SENSOR — the 144-anchor library the walk seeds from — not of the two texts:
//
//   apertureRatio       = sensor.medianZ / CANONICAL_SENSOR.medianZ
//   APERTURE_RATIO_BAND = [0.25, 4]
//
// It answers "is this reef calibrated to the same size-order as the canonical library, so gzip-NCD
// reads meaning rather than length" — and walkShape already marks apertureRatio / apertureMismatch /
// sensorSource on every receipt. A custom reef (a session axes file, a per-room reef, a foreign-repo
// bootstrap) can fall outside the band; the canonical library is 1.0 by definition.
//
// THE CORPUS FLOOR IS A SECOND, SEPARATE THING and must not be called "the aperture." litScores
// compares the text against 144 anchor snippets whose median gzip mass is 743 bytes (range 376-889,
// measured from CANONICAL_SENSOR.snipZ). A text carrying far less than one anchor's worth of mass is
// being compared against 144 things each heavier than itself, and what comes back is dominated by
// length. So the floor is DERIVED from the sensor in play — one anchor's median mass — never chosen.
//
// MEASURED against the real floor, the earlier finding survives and widens: the nine decision panels
// carried 120-204 gzip bytes of intent against a 743-byte mass floor, and the assembled evidence
// corpus carries 1082-3437. The conclusion did not change; the number it is checked against is now
// the system's own rather than one I picked.
const APERTURE_RATIO_BAND = [0.25, 4];   // mirrors unified-drift.mjs; the guard asserts they are equal
const gzBytes = (t) => { try { return gzipSync(Buffer.from(String(t || ''), 'utf8')).length; } catch { return 0; } };

let _floor;
/** The canonical submission mass floor. Read from physics.mjs — the same 220 the shipped
 *  thetacog-mcp write-lock reports as min_gzip_bytes. Never declared in this file. */
export async function canonicalMassFloor() {
  if (_floor !== undefined) return _floor;
  try {
    const P = await import(resolve(HERE, "..", "..", "packages/thetacog-mcp/scripts/tape/physics.mjs"));
    _floor = P.__internals__?.MIN_GZIP_BYTES ?? null;
  } catch { _floor = null; }
  return _floor;
}

/**
 * The two readings, kept SEPARATE because they are different physics.
 *   corpus floor — does each side carry at least at least the canonical submission mass floor?
 *   aperture     — is the SENSOR in the canonical size-order? (1.0 for the canonical library)
 * `massFloor` must be supplied (or resolved via canonicalMassFloor) so nothing here is a magic
 * number. When it cannot be resolved the reading is UNMEASURED — never silently "fine".
 */
export function admissibility(intent, reality, { massFloor = null, apertureRatio = 1 } = {}) {
  const i = gzBytes(intent), r = gzBytes(reality);
  if (massFloor == null) {
    return {
      admissible: null, intentGzip: i, realityGzip: r, massFloor: null,
      apertureRatio, apertureBand: APERTURE_RATIO_BAND, apertureMismatch: null, notAdmissible: null,
      unmeasured: 'the sensor anchor mass could not be read from unified-drift.mjs, so admissibility is UNMEASURED — never assume it passed',
    };
  }
  const reasons = [];
  if (i < massFloor) reasons.push('the INTENT side carries ' + i + ' gzip bytes against a ' + massFloor + '-byte mass floor — below the floor the compressor has too little to work with and the reading is dominated by length');
  if (r < massFloor) reasons.push('the REALITY side carries ' + r + ' gzip bytes against a ' + massFloor + '-byte mass floor — the same problem on the reality side');
  const apertureMismatch = apertureRatio < APERTURE_RATIO_BAND[0] || apertureRatio > APERTURE_RATIO_BAND[1];
  if (apertureMismatch) reasons.push('the SENSOR is outside the canonical size-order (apertureRatio ' + apertureRatio + ', band ' + APERTURE_RATIO_BAND[0] + '-' + APERTURE_RATIO_BAND[1] + ') — this reef is not calibrated against the canonical library');
  return {
    admissible: reasons.length === 0,
    intentGzip: i, realityGzip: r, massFloor,
    apertureRatio, apertureBand: APERTURE_RATIO_BAND, apertureMismatch,
    notAdmissible: reasons.length ? reasons.join(' · ') : null,
    unmeasured: null,
  };
}

// ── THE AXES LIBRARY IN FORCE — stamped, never assumed (operator 2026-09-14: "the tesseract is always
// config properly … build the reef tesseract step by step"). The renderer walks against loadAxes()'s
// default (pipeline-state.mjs LIB_144_PATH, the repo-wide 144 library) whenever the caller passes no
// axesPath. That default is silent by construction, so the door reads the SAME constant and hashes the
// file, and every panel says which library it walked. `canonical: true` = the repo-wide 144 library.
const _axesId = new Map();
export async function axesIdentity(axesPath = null) {
  try {
    const PS = await import(resolve(HERE, 'pipeline-state.mjs'));
    const p = resolve(axesPath != null ? axesPath : PS.LIB_144_PATH);
    if (_axesId.has(p)) return _axesId.get(p);
    const buf = readFileSync(p);
    let cells = null; try { const j = JSON.parse(buf.toString('utf8')); cells = Array.isArray(j) ? j.length : Array.isArray(j?.axes) ? j.axes.length : null; } catch { /* identity still carries the hash */ }
    const id = { path: p, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16), cells, canonical: axesPath == null };
    _axesId.set(p, id);
    return id;
  } catch (e) {
    return { path: axesPath ?? null, sha256: null, cells: null, canonical: axesPath == null, unmeasured: `axes library could not be read: ${String(e?.message || e).slice(0, 120)}` };
  }
}

export async function panel({
  intent, reality, message = null, axesPath = null, label = 'panel', sub = '', scale = undefined,
} = {}) {
  if (intent == null || reality == null) {
    return { png: null, dataUri: null, meta: null, regions: [], cole: null, stages: null, unmeasured: 'intent/reality text required' };
  }

  let composeEncircledPanel;
  try {
    ({ composeEncircledPanel } = await import(RENDERER));
  } catch (e) {
    return { png: null, dataUri: null, meta: null, regions: [], cole: null, stages: null, unmeasured: `renderer unavailable: ${String(e?.message || e).slice(0, 200)}` };
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
    return { png: null, dataUri: null, meta: null, regions: [], cole: null, stages: null, unmeasured: `renderer threw: ${String(e?.message || e).slice(0, 200)}` };
  }
  const ms = Date.now() - t0;

  if (!raw || !raw.png) {
    return { png: null, dataUri: null, meta: null, regions: [], cole: null, stages: null, unmeasured: 'renderer returned no png' };
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
    // THE REFUSAL RIDES THROUGH THE DOOR (2026-09-14). composeTolerancePanel names its lit-mass refusal
    // ("UNMEASURED, never a pass") and this door used to drop it — so a refused panel came out with a
    // png, an offPct of null and nothing saying why. A consumer must read `refused` before showing the png.
    refused: !!m.refused, refusal: m.refusal ?? null, litMass: m.litMass ?? null, edges: m.edges ?? null,
    // Every panel says whether it is evidence. A consumer that shows it as proof must honor this.
    ...admissibility(intent, reality, { massFloor: await canonicalMassFloor(), apertureRatio: raw?.meta?.apertureRatio ?? 1 }),
    engine: 'rust-ballistic-walk · tolerance-panel.mjs (via panel-door.mjs, the one door)',
    // WHICH ENGINES ACTUALLY RAN — read off the pipeline's own stage records, never asserted here.
    // walkEngine is 'rust-ballistic-walk' only when computeWalk (pmu-onchip) produced the heatmaps;
    // regionEngine is 'rust-regions-chip' only when the chip clustered (a JS fallback names itself).
    // A consumer that must prove the Rust path ran (the per-prompt lens PNG) compares these verbatim.
    walkEngine: raw.stages?.walk?.engine ?? null,
    walkMode: raw.stages?.walk?.walk_mode ?? null,
    senseEngine: raw.stages?.sense?.engine ?? null,
    senseWitness: raw.stages?.sense?.primary_witness ?? null,
    regionEngine: m.regionEngine ?? null,
    axes: await axesIdentity(axesPath),
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
    // ADDITIVE (2026-09-14): the block rectangle and the reef expansion the detector already computed.
    // Withholding them is how a second door starts — the lens PNG needs blockBox to ask retrieveRules
    // which rules live inside the ring, and reef.hat / reef.domain to name it, without re-clustering.
    blockBox: r.blockBox || null,
    blocks: r.blocks ?? null,
    reef: r.reef && typeof r.reef === 'object' ? r.reef : null,
    slices: Array.isArray(r.messageSlice)
      ? r.messageSlice.map((s) => ({ clause: String(s.clause || ''), coord: s.coord, sigma: s.sigma }))
      : [],
  }));

  return { png: pngBuf, dataUri, meta, regions, cole: raw.cole || null, stages: raw.stages || null, unmeasured: null };
}

export default panel;
