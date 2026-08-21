// scripts/pmu/lens-encircled-png.mjs — the per-PROMPT encircled PNG (operator 2026-08-06: "at the end
// of the prompt we need the pngs encircled to show how well the tesseract performed here … keep to
// using one single rust pipeline for everything").
// ============================================================================================
// ONE PIPELINE, NO NEW RENDERER: this paints the prompt walk's coordinates in the EXACT tolerance
// hues the commit panel paints (TOL_HUE via annotate-regions), then calls the SAME encircle door the
// commit email + attest page call — detectRegions (Rust regions chip when built, PMU_REGIONS_CHIP=auto)
// → encircleRegionsPng. In-lane (inside the Chebyshev fence) = GREEN; one block off the fence = AMBER
// (adjacent bleed); further = RED (orthogonal drift). Same semantics as the ◎ receipt line, as pixels.
// Runs DETACHED from the UserPromptSubmit lens (hooks never block); writes latest.png + latest.json
// (with WRITTEN-OUT hat names per region) so chat can display + read it after each prompt return.
// LLM-FREE — pure function of the walk payload. @guard tests/pmu-simulator/lens-encircled-png.test.mjs
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectRegions } from './regions-chip.mjs';
import { encircleRegionsPng } from './annotate-regions.mjs';
import { shortLexToBlock } from './shortlex-coords.mjs';
import { hatName } from './shortlex-names.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = resolve(REPO, '.thetacog/lens-encircled');
const N = 144, NB = 12;

// EXACT tolerance render hues — the classifier's anchors (annotate-regions TOL_HUE). Painting any
// other hue would make classify() drop the cells as foreign and the panel would encircle nothing.
const HUE = { green: [30, 145, 80], amber: [255, 176, 0], red: [255, 59, 59] };

// Chebyshev distance from a block to the fence rectangle (0 = inside).
function fenceDist(br, bc, f) {
  if (!f) return 99;
  const dr = br < f.r0 ? f.r0 - br : br > f.r1 ? br - f.r1 : 0;
  const dc = bc < f.c0 ? f.c0 - bc : bc > f.c1 ? bc - f.c1 : 0;
  return Math.max(dr, dc);
}

// walk payload → 144×144 rgba in tolerance hues. Each ShortLex coord lights its 12×12 block.
export function paintWalk(coords, fence) {
  const rgba = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) rgba[i * 4 + 3] = 255;   // opaque black background
  for (const c of coords || []) {
    const { br, bc } = shortLexToBlock(c);
    if (!Number.isFinite(br) || !Number.isFinite(bc)) continue;
    const d = fenceDist(br, bc, fence);
    const hue = d === 0 ? HUE.green : d === 1 ? HUE.amber : HUE.red;
    for (let r = br * NB; r < (br + 1) * NB; r++) {
      for (let col = bc * NB; col < (bc + 1) * NB; col++) {
        const o = (r * N + col) * 4;
        rgba[o] = hue[0]; rgba[o + 1] = hue[1]; rgba[o + 2] = hue[2];
      }
    }
  }
  return rgba;
}

// the whole render, importable (the test drives this; the CLI below is just the detached shell).
export function renderLensEncircled(payload) {
  const { coords = [], fence = null, coord = '', domain = '', prompt = '' } = payload || {};
  const rgba = paintWalk(coords, fence);
  const regions = detectRegions(rgba, { mode: process.env.PMU_REGIONS_CHIP || 'auto' }) || [];
  const png = encircleRegionsPng(rgba, regions, { scale: 4 });
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = resolve(OUT_DIR, '.latest.png.tmp');       // atomic — a reader never sees a half PNG
  writeFileSync(tmp, png);
  renameSync(tmp, resolve(OUT_DIR, 'latest.png'));
  // the meta carries the WRITTEN-OUT hats (names, not codes) so any surface reading it has the grip.
  const meta = {
    at: payload.at || null, coord, domain, hat: hatName(coord),
    regions: regions.map((r) => ({ kind: r.kind, coord: r.reef?.coord || r.coord?.center || null, hat: r.reef?.hat || hatName(r.reef?.coord || ''), name: r.reef?.name || null })),
    inLane: coords.filter((c) => { const { br, bc } = shortLexToBlock(c); return fenceDist(br, bc, fence) === 0; }).map((c) => ({ coord: c, hat: hatName(c) })),
    outOfLane: coords.filter((c) => { const { br, bc } = shortLexToBlock(c); return fenceDist(br, bc, fence) > 0; }).map((c) => ({ coord: c, hat: hatName(c) })),
    prompt: String(prompt).slice(0, 200),
  };
  writeFileSync(resolve(OUT_DIR, 'latest.json'), JSON.stringify(meta, null, 2));
  return { png: resolve(OUT_DIR, 'latest.png'), meta };
}

// CLI: node lens-encircled-png.mjs <payload.json> — the detached leg the lens spawns.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const { png, meta } = renderLensEncircled(payload);
    process.stdout.write(`${png} regions=${meta.regions.length}\n`);
  } catch (e) {
    process.stderr.write(`lens-encircled-png: ${e.message}\n`);
    process.exit(1);
  }
}
