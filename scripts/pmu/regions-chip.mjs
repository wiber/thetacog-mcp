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
import { fileURLToPath } from 'node:url';
import { detectColorRegions, classify } from './annotate-regions.mjs';
import { regionShortLex } from './shortlex-coords.mjs';
import { coordGist } from './lattice-meaning.mjs';
import { expandCoordName } from './reef-coord-name.mjs';   // canonical taxonomy EXTENDED with the reef's problem-space name (lens-computed, LLM-free)

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHIP = resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');
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
export function detectRegions(rgba, { mode = process.env.PMU_REGIONS_CHIP || 'off' } = {}) {
  const wantChip = mode === 'on' || (mode === 'auto' && chipBuilt());
  let regions;
  if (!wantChip) regions = detectColorRegions(rgba);
  else {
    const cls = rgbaToCls(rgba);
    const raw = regionsFromChipRaw(cls);
    regions = raw ? label(raw) : detectColorRegions(rgba); // graceful fallback — email/panel never breaks
  }
  return withReefName(regions);
}

export default detectRegions;
