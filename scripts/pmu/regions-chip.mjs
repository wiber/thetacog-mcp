// scripts/pmu/regions-chip.mjs — THE ONE functional entry to the drift-region pipeline.
//
// "one single rust pipeline we call functionally was the plan" (operator). This is the single choke
// point every caller (email, tolerance-panel, region-narrative, the CLI) routes through, so there is
// ONE pipeline with ONE output shape and no second reimplementation can drift from the chip.
//
// The chip (pmu-onchip --regions) does the HEAVY clustering (line pass + scale-invariant block
// classification + connected components + tight boxes) on the metal; JS does only the LIGHT labeling
// (regionShortLex coord + coordGist meaning + ellipse geometry) — the SAME tail detectColorRegions
// already runs, so the output is byte-shape-identical whether the chip or the JS clusterer produced it.
//
// HARDENED — every way it can be called degrades gracefully, never crashes, never silently wrong:
//   • chip not built / errors / bad output   → JS detectColorRegions (the proven path). email untouched.
//   • rgba wrong length                        → throws a clear error (not garbage regions).
//   • mode 'off' (default)                     → pure JS, byte-identical to today (stays-or-improves).
//   • mode 'on'                                → chip clustering (or JS fallback), same shape.
//   • mode 'auto'                              → chip if built, else JS.
//
// @guard tests/pmu-simulator/regions-rust-matches-js.test.mjs (chip drift === JS golden, scale-invariant)
//        tests/pmu-simulator/regions-callers-single-pipeline.test.mjs (no rogue region clusterer)

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';   // THE ONE resolver — honours PMU_BINARY, one canonical search (spec v2 Task 2)
import { fileURLToPath } from 'node:url';
import { detectColorRegions, classify, encircleRegionsPng } from './annotate-regions.mjs';
import { regionShortLex } from './shortlex-coords.mjs';
import { coordGist } from './lattice-meaning.mjs';
import { expandCoordName } from './reef-coord-name.mjs';   // canonical taxonomy EXTENDED with the reef's problem-space name (lens-computed, LLM-free)

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHIP = resolvePmuBinary(REPO);
const N = 144, B = 12;

export function chipBuilt() { return existsSync(CHIP); }

// rgba tolerance panel → the 144×144 per-cell CLASS bitmap the chip consumes (LLM-free, trivial).
export function rgbaToCls(rgba) {
  if (rgba.length !== N * N * 4) throw new Error(`regions-chip: expected ${N * N * 4} rgba bytes (144×144×4), got ${rgba.length}`);
  const cls = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { const o = i * 4; cls[i] = classify(rgba[o], rgba[o + 1], rgba[o + 2]); }
  return cls;
}

// the SHARED light tail — attach ellipse geometry + coord + lattice meaning. IDENTICAL to the map the
// JS detectColorRegions runs, so a chip region and a JS region are indistinguishable downstream.
function label(raw) {
  return raw
    .slice()
    .sort((a, b) => b.blocks - a.blocks)
    .map((r, i) => {
      const { r0, r1, c0, c1 } = r.blockBox;
      const ellipse = { cx: ((c0 + c1 + 1) / 2) * B, cy: ((r0 + r1 + 1) / 2) * B, rx: ((c1 - c0 + 1) * B) / 2 + 3, ry: ((r1 - r0 + 1) * B) / 2 + 3 };
      const coord = regionShortLex(r.blockBox);
      return { n: i + 1, kind: r.kind, blocks: r.blocks, blockBox: r.blockBox, ellipse, line: r.line || null, coord, meaning: coordGist(coord.center) };
    });
}

// call the chip functionally: cls bitmap in → raw regions out ({kind,blocks,blockBox,line}). Returns
// null on ANY failure so the caller can fall back — the chip never takes the pipeline down.
export function regionsFromChipRaw(cls) {
  try {
    const out = execFileSync(CHIP, ['--regions'], { input: Buffer.from(cls), maxBuffer: 4 << 20 });
    const parsed = JSON.parse(out.toString());
    if (!parsed || !Array.isArray(parsed.regions)) return null;
    return parsed.regions;
  } catch { return null; }
}

// attach the reef-computed PROBLEM-SPACE name to every region — the canonical taxonomy extended with
// the domain the gzip sensor named at that coordinate (guessed from the nearest domain if uncovered).
// So the email carries the FULL coordinate of each encircled intersection. Applied to BOTH the chip and
// JS paths at the one door, so the name is present no matter who clustered. Additive: never removes a field.
function withReefName(regions) {
  return regions.map((r) => ({ ...r, reef: expandCoordName((r.coord && r.coord.center) || r.coord) }));
}

// THE ENTRY POINT. mode: 'off' (JS, default — byte-identical clustering) · 'on' (chip, JS fallback) ·
// 'auto' (chip if built, else JS). Always returns the detectColorRegions shape + the reef name.
// DEFAULT 'auto' (ratified 2026-08-06, one-pipeline-spec Part C.1: Rust-max, chip canonical): the
// chip's scale-invariant clusterer IS the canonical semantics (regions.rs fixed the JS detector's
// absolute-threshold giant-oval bug — divergence from JS is the FIX, not drift). JS remains the
// chip-less fallback and the byte-reproduction path for historical panels (PMU_REGIONS_CHIP=off).
// THE ENGINE IS REPORTED, NEVER SILENT (2026-09-14). The JS fallback survives for chip-less machines,
// but a fallback nobody can see is the defect: a caller that must prove the Rust chip clustered
// (the per-prompt encircled PNG, CLAUDE.md "a lattice reading comes from the one Rust walk") reads
// `regions.engine` and refuses to emit when it is not REGION_ENGINE_CHIP. Non-enumerable so the
// array still JSON-serialises and iterates exactly as before — additive, never a shape change.
export const REGION_ENGINE_CHIP = 'rust-regions-chip';
export function detectRegions(rgba, { mode = process.env.PMU_REGIONS_CHIP || 'auto' } = {}) {
  const wantChip = mode === 'on' || (mode === 'auto' && chipBuilt());
  let regions, engine;
  if (!wantChip) { regions = detectColorRegions(rgba); engine = mode === 'off' ? 'js-detectColorRegions (PMU_REGIONS_CHIP=off)' : 'js-detectColorRegions (chip not built)'; }
  else {
    const cls = rgbaToCls(rgba);
    const raw = regionsFromChipRaw(cls);
    if (raw) { regions = label(raw); engine = REGION_ENGINE_CHIP; }
    else { regions = detectColorRegions(rgba); engine = 'js-detectColorRegions (CHIP FALLBACK — the chip errored or returned no regions)'; } // graceful fallback — email/panel never breaks, but it SAYS so
  }
  const out = withReefName(regions);
  Object.defineProperty(out, 'engine', { value: engine, enumerable: false });
  return out;
}

// ── THE ENCIRCLED PANEL IS ALWAYS ENCIRCLED (operator 2026-08-04: "that is not even the right frigging
// panel type — do the encircled"). ONE RULE, ONE PLACE — every surface that shows "the encircled panel"
// (attest /render, attest-demo, the HUD) calls THIS, so no call site can re-grow its own chain.
//
// THE REGRESSION THIS KILLS: the 2026-07-15 never-blank fix made the fallback substitute the RAW `delta`
// PNG when detectRegions returned 0 regions — a 144×144 magenta grid displayed under a caption reading
// "the actual encircleRegionsPng output". It fixed emptiness by breaking panel-TYPE invariance, silently.
// Both invariants are non-negotiable and BOTH hold here: we still walk the chain for a substantial
// surface, but we ENCIRCLE whichever surface we land on. The panel type never changes; only the surface
// does, and `source` names it out loud so the caption can be honest instead of lying.
//
// @guard tests/pmu-simulator/attest-catastrophe-nonempty.test.mjs (non-blank AND never a raw pipeline PNG)
// ── THE APERTURE: A RING MUST CLAIM A PLACE, NOT THE WHOLE FIELD ────────────
// MEASURED 2026-09-08 on HEAD: the intent panel drew a ring whose bounding box covered **91.7%** of
// the 12×12 block field and another at 69.4%, while three real clusters sat at 4.2%, 2.1% and 0.7%.
// Those two are the full-width ellipses the operator photographed. A ring is a claim that mass is
// concentrated HERE; at 92% of the lattice there is no "here", and the ellipse asserts a locality
// the data does not contain — the panel looks measured and says nothing.
//
// THE CEILING IS AN ARGUMENT, NOT A KNOB. At 50% of the field a region's complement is exactly as
// large as the region, so "inside the ring" stops distinguishing anything from "outside" it. Above
// that line the shape is a BAND, not a cluster, and it is reported as one instead of drawn.
//
// This is the same failure the 2026-06-27 coverage path already fixed for its own clusterer (two
// blobs fused across an empty saddle into one panel-spanning ellipse). The block-box path never got
// the fix, so the defect survived in exactly the surfaces that show it largest.
//
// It never re-renders and never re-thresholds: the field is what it is, and a field-wide band is a
// real finding about a dispersed corpus. It is suppressed from the DRAWING and reported by name.
export const SPAN_CEILING = 0.5;
export function localRegions(regions, { spanCeiling = SPAN_CEILING } = {}) {
  const drawn = [], fieldWide = [];
  for (const r of regions || []) {
    const b = r.blockBox;
    if (!b) { drawn.push(r); continue; }
    const span = ((b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1)) / 144;   // the box is in 12x12 blocks
    (span >= spanCeiling ? fieldWide : drawn).push({ ...r, spanPct: Math.round(1000 * span) / 10 });
  }
  // Renumber what is actually drawn, so the discs on the panel and the list beneath it agree. A
  // suppressed ring leaving a hole in the numbering would read as a missing panel, not a wide one.
  return { drawn: drawn.map((r, i) => ({ ...r, n: i + 1 })), fieldWide };
}

export const ENCIRCLE_CHAIN = ['tolerance', 'delta', 'reality', 'intent'];
export function encircledPanel(rgbas, { scale = 4, substantial = 1000, chain = ENCIRCLE_CHAIN } = {}) {
  if (!rgbas) return null;
  let best = null;
  for (const id of chain) {
    const rgba = rgbas[id];
    if (!rgba || rgba.length !== N * N * 4) continue;
    let regions = [];
    try { regions = detectRegions(rgba) || []; } catch { regions = []; }   // a detector throw must not cost the panel
    let b64;
    try { b64 = encircleRegionsPng(rgba, regions, { scale }).toString('base64'); } catch { continue; }
    const cand = { dataUri: `data:image/png;base64,${b64}`, regionCount: regions.length, source: id, fallback: id !== chain[0] };
    if (!best) best = cand;                                   // keep the canonical surface as the floor
    // TAKE the first surface that is BOTH substantial AND actually has regions to circle. A 0-region
    // tolerance panel is exactly the catastrophe case that used to fall through to the raw delta.
    if (b64.length > substantial && regions.length > 0) return cand;
  }
  return best;
}

export default detectRegions;
