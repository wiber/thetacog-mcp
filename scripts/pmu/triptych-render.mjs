#!/usr/bin/env node
// scripts/pmu/triptych-render.mjs
//
// SERVER-SIDE render of the SCREENSHOT'S anatomy — the 144×144 lattice triptych
// (INTENT · REALITY · DELTA-XOR), decoded EXACTLY as the running dashboard does
// (docs/pmu-pipeline-dashboard.html → paintBitmap), from the three bitmaps the
// running pipeline emits (scripts/pmu/pipeline.mjs → walk.intent_heatmap_b64,
// walk.reality_heatmap_b64, xor.friction_bitmap_b64). NEVER reinvent the anatomy:
// both axes are the 144 ShortLex anchors, cell (i,j) = row-node ⊕ col-node.
//
// We emit real PNGs (pure node:zlib, zero deps) so the pixelated 144×144 image is
// crisp and travels INSIDE the email — what you see is what the chip computed.
//
// decode contract (matches paintBitmap):
//   · bytes.length === 20736*4  → Float32Array heatmap (graded; colour = rgb × val/max)
//   · else                      → binary bitmap (1 bit/cell; rgb where set, near-black else)
//
// @canonical-algorithm  server-side render of the 144×144 lattice triptych (INTENT·REALITY·DELTA), decoded EXACTLY as the dashboard paintBitmap; ply-coloured visit-FREQUENCY gradient; dual ShortLex axes; aggregate three-colour tolerance; diagonal tile dump
// @forbidden-alternative  reinventing a 12×12 drift map · a BINARY (non-gradient) heatmap · a PER-CELL tolerance alarm (cries wolf on every bleed) · single-axis labels (can't read WHICH lane drifted)
// @why  the screenshot (/d/lattice.png) IS the contract; drifting off the anatomy renders something the customer never sees, and a per-cell alarm destroys the underwriter's "a few off is noise, too much is the claim event" line
// @guard  tests/pmu-simulator/dogfood-success-factors.test.mjs (SF5,SF6,SF7,SF11,SF12) · tests/pmu-simulator/gemini-spec-inspection.test.mjs

import { deflateSync } from 'node:zlib';
import { loadRegistry, zoneBoundaries } from './shortlex-registry.mjs';
import { legendLine, panelCaption } from './sigma-legend.mjs';   // SPEC #3: every number names itself — one shared legend, wording cannot drift
import { allBlockStats, axis12 as blockAxis12, loadRegistry as loadBlockRegistry } from './block-stats.mjs';   // the prefix-intersection block instrument — ALL block-level math routes through it

const N = 144, CELLS = N * N;

// ── CRC32 (PNG chunk checksum) ───────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const body = Buffer.concat([tb, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
// ── 144×144 RGBA → PNG (Buffer) ──────────────────────────────────────────────
export function rgbaToPng(rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit, RGBA, no interlace
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  const raw = Buffer.alloc(N * (1 + N * 4));
  for (let y = 0; y < N; y++) { raw[y * (1 + N * 4)] = 0; src.copy(raw, y * (1 + N * 4) + 1, y * N * 4, (y + 1) * N * 4); }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
export function rgbaToPngDataUri(rgba) { return 'data:image/png;base64,' + rgbaToPng(rgba).toString('base64'); }
// ── decode a heatmap/bitmap b64 → RGBA (paintBitmap contract) ─────────────────
export function decodeToRgba(b64, rgb) {
  const bytes = Buffer.from(b64 || '', 'base64');
  const rgba = new Uint8Array(CELLS * 4);
  if (bytes.length === CELLS * 4) {                       // Float32 graded heatmap
    const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, CELLS);
    let max = 0; for (let i = 0; i < CELLS; i++) if (f32[i] > max) max = f32[i];
    for (let i = 0; i < CELLS; i++) { const v = max > 0 ? f32[i] / max : 0, o = i * 4; rgba[o] = rgb[0] * v; rgba[o + 1] = rgb[1] * v; rgba[o + 2] = rgb[2] * v; rgba[o + 3] = 255; if (v > 0 && v < 0.05) { rgba[o] += 5; rgba[o + 1] += 5; rgba[o + 2] += 5; } }
  } else {                                                // binary bitmap
    for (let i = 0; i < CELLS; i++) { const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1, o = i * 4; if (bit) { rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255; } else { rgba[o] = 5; rgba[o + 1] = 5; rgba[o + 2] = 5; rgba[o + 3] = 255; } }
  }
  return rgba;
}
// ── THE COLE TRACE, ply-coloured (the asymmetric ballistic walk made visible) ────────────────────
// Colour each lit edge (r→j) by the PLY at which it first fired — the jumps to definers-of-definers.
// ply 0 = the seed/anchor (white) → ply 1 (cyan) → 2 (teal) → 3 (blue) → 4 (purple) → 5+ (pink/red).
// Brightness = log edge-weight. Asymmetric: matrix[r·144+j] ≠ matrix[j·144+r].
const PLY_PAL = [[255, 255, 255], [102, 252, 241], [69, 162, 158], [91, 141, 239], [155, 93, 229], [241, 91, 181], [255, 107, 107]];
// ── THE PANEL PALETTE CONTRACT (operator dictation, 2026-06-11: "colors need to be more different
// to make it easier to see"). Adjacent panels reused cyan/amber + the shared ply palette and read
// alike at a glance. The scheme, one family per panel row:
//   PRE-WALK row     — pure CYAN intent · pure AMBER reality · comparison green/cyan/amber
//                      (unchanged: the raw-sense snapshots keep the dashboard's classic colours).
//   WALK INTENT      — BLUE→VIOLET ply ramp (PLY_PAL_INTENT): cold declared-side family.
//   WALK REALITY     — ORANGE→RED ply ramp (PLY_PAL_REALITY): hot shipped-side family.
//   DELTA            — GREEN agree · MAGENTA declared-not-done · AMBER done-not-declared
//                      (magenta reads instantly against green; the old cyan sank into the intent panel).
//   TOLERANCE        — GREEN dimmed · AMBER saturated · RED (drift pops against the in-lane carpet).
// Crosshair stays the pink ◎ ring; the faint ShortLex boundary grid stays on every panel.
const PLY_PAL_INTENT = [[240, 244, 255], [150, 190, 255], [96, 140, 255], [80, 96, 240], [110, 70, 230], [140, 50, 210], [160, 40, 180]];
const PLY_PAL_REALITY = [[255, 250, 235], [255, 200, 110], [255, 160, 60], [255, 120, 40], [240, 80, 30], [220, 50, 25], [200, 30, 20]];
export function coleTraceRgba(matrix, mPly) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  for (let c = 0; c < CELLS; c++) {
    if (matrix[c] <= 0) continue;
    const p = mPly[c] < 0 ? 0 : mPly[c]; const col = PLY_PAL[Math.min(p, PLY_PAL.length - 1)];
    // EARLY PLIES HEAVIER: brightness decays with ply (0.6^ply) so the seed/near-definers dominate
    // the image and the deep jumps fade — the heatmap is heavier for the early ply-coloured steps.
    const a = 0.25 + 0.75 * Math.pow(0.6, p), o = c * 4;
    rgba[o] = Math.floor(col[0] * a); rgba[o + 1] = Math.floor(col[1] * a); rgba[o + 2] = Math.floor(col[2] * a);
  }
  return rgba;
}
// DELTA = the SHAPE MATCH of the two Cole traces: green where both reached, cyan intent-only, amber
// reality-only. The match% = both / (both+intent-only+reality-only).
export function shapeMatchRgba(im, rm) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  let both = 0, io = 0, ro = 0;
  for (let c = 0; c < CELLS; c++) {
    const i = im[c] > 0, r = rm[c] > 0, o = c * 4; let col = null;
    if (i && r) { col = [46, 207, 111]; both++; } else if (i) { col = [0, 180, 220]; io++; } else if (r) { col = [230, 160, 40]; ro++; }
    if (col) { rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
  }
  return { rgba, both, io, ro, matchPct: (both + io + ro) ? Math.round(100 * both / (both + io + ro)) : 0 };
}
// ── DEFINER WALK render — the 12×12 (144-cell) row→transpose→row walk, ply-coloured, each anchor
// drawn as a 12×12 block so it fills the 144×144 panel. Early plies heavier (0.7^ply brightness).
// hue = ply (which definer-of-definer step), INTENSITY = visit frequency (log-scaled) — a real heat
// gradient: cells hit by many definer chains glow, single-hit cells are dim. Not blocky binary.
export function definerWalkRgba(ply144, heat144) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  let mx = 1; if (heat144) for (let i = 0; i < 144; i++) if (heat144[i] > mx) mx = heat144[i];
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
    const k = r * 12 + c, p = ply144[k]; if (p == null || p < 0) continue;
    const col = PLY_PAL[Math.min(p, PLY_PAL.length - 1)];
    const h = heat144 ? heat144[k] : 1;
    const a = heat144 ? (0.2 + 0.8 * Math.log(1 + 9 * h / mx) / Math.LN10) : (0.3 + 0.7 * Math.pow(0.7, p));
    for (let dy = 0; dy < 12; dy++) for (let dx = 0; dx < 12; dx++) { const o = ((r * 12 + dy) * 144 + (c * 12 + dx)) * 4; rgba[o] = Math.floor(col[0] * a); rgba[o + 1] = Math.floor(col[1] * a); rgba[o + 2] = Math.floor(col[2] * a); }
  }
  return rgba;
}
// ── THE TRUE 144×144 EDGE RENDER (operator 2026-06-10: "no more 12×12-looking heatmaps — all 144×144,
// like the reef"). The anchor-block renders above paint each anchor as a uniform 12×12 BLOCK, which
// creates the line/quadrant emphasis the operator flagged — a RENDER artifact, not the walk. The walk
// records the full 20,736-cell EDGE matrix (matrix[i*144+j] = weight of the definer jump i→j, mPly =
// the ply it first fired). These functions render THAT, one pixel per cell, like the reef.
//
// SIGNIFICANCE THRESHOLD (operator: "we need some kind of threshold function that filters which of the
// jumps are significant"): a jump i→j is SIGNIFICANT iff its weight clears the row's own statistics —
// w ≥ μ_row + k·σ_row (each row defines its own noise floor, so a uniformly-hot row doesn't paint a
// line; only jumps that stand OUT of their row render). Exported so the harness pins the rule.
export function significantEdges(matrix, { k = 1.0 } = {}) {
  const sig = new Uint8Array(CELLS);
  for (let i = 0; i < N; i++) {
    let s = 0, s2 = 0, n = 0;
    for (let j = 0; j < N; j++) { const w = matrix[i * N + j]; if (w > 0) { s += w; s2 += w * w; n++; } }
    if (!n) continue;
    const mu = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mu * mu));
    const thr = n >= 3 ? mu + k * sd : 0;          // a row with <3 lit jumps: everything it has is signal
    for (let j = 0; j < N; j++) { const w = matrix[i * N + j]; if (w > 0 && w >= thr) sig[i * N + j] = 1; }
  }
  return sig;
}
// hue = ply of the jump (the definer-of-definer chronology), intensity = log weight. Only SIGNIFICANT
// jumps render — the threshold is what keeps the picture sparse and honest (no row-paint lines).
export function edgeMatrixRgba(matrix, mPly, { k = 1.0 } = {}) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  const sig = significantEdges(matrix, { k });
  let mx = 1; for (let i = 0; i < CELLS; i++) if (sig[i] && matrix[i] > mx) mx = matrix[i];
  for (let i = 0; i < CELLS; i++) {
    if (!sig[i]) continue;
    const p = (mPly && mPly[i] >= 0) ? mPly[i] : 0;
    const col = PLY_PAL[Math.min(p, PLY_PAL.length - 1)];
    const a = 0.25 + 0.75 * Math.log(1 + 9 * matrix[i] / mx) / Math.LN10;
    const o = i * 4; rgba[o] = Math.floor(col[0] * a); rgba[o + 1] = Math.floor(col[1] * a); rgba[o + 2] = Math.floor(col[2] * a);
  }
  return rgba;
}
// ── THE CLOUD SPLAT RENDER (operator 2026-06-10: "the first [hits] have LARGE clouds on the heat map,
// and then they change colour and get smaller as you go — they might also get fainter; we need to be
// able to show where the early hits are and where the later hits are"). Each significant hit paints a
// soft CLOUD at its cell: RADIUS shrinks with ply (early=big → late=a point), COLOUR walks the ply
// palette (white → cyan → teal → blue → purple → pink: warm-bright early, colder later), ALPHA decays
// with both ply and weight. Painted additively on the true 144×144 — this is the shape.
export function cloudSplatRgba(matrix, mPly, { k = 1.0, baseRadius = 4, pal = PLY_PAL } = {}) {
  const acc = new Float32Array(CELLS * 3);
  const sig = significantEdges(matrix, { k });
  let mx = 1e-9; for (let i = 0; i < CELLS; i++) if (sig[i] && matrix[i] > mx) mx = matrix[i];
  for (let i = 0; i < CELLS; i++) {
    if (!sig[i]) continue;
    const p = (mPly && mPly[i] >= 0) ? mPly[i] : 0;
    const col = pal[Math.min(p, pal.length - 1)];
    const r = Math.max(1, baseRadius - p);                       // early = big cloud, later = a point
    const a0 = (0.35 + 0.65 * Math.log(1 + 9 * matrix[i] / mx) / Math.LN10) * Math.pow(0.82, p); // fainter per ply
    const cy = Math.floor(i / N), cx = i % N;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const y = cy + dy, x = cx + dx;
      if (y < 0 || y >= N || x < 0 || x >= N) continue;
      const dist2 = dx * dx + dy * dy; if (dist2 > r * r) continue;
      const falloff = Math.exp(-dist2 / (0.45 * r * r + 0.3)); // gaussian-ish soft edge
      const o = (y * N + x) * 3, a = a0 * falloff;
      acc[o] += col[0] * a; acc[o + 1] += col[1] * a; acc[o + 2] += col[2] * a;
    }
  }
  const rgba = new Uint8Array(CELLS * 4);
  for (let i = 0; i < CELLS; i++) {
    const o3 = i * 3, o4 = i * 4;
    rgba[o4] = Math.min(255, 5 + acc[o3]); rgba[o4 + 1] = Math.min(255, 5 + acc[o3 + 1]); rgba[o4 + 2] = Math.min(255, 5 + acc[o3 + 2]); rgba[o4 + 3] = 255;
  }
  return rgba;
}

// ── GRADED CLOUD DELTA (operator 2026-06-10: the binary set-algebra delta drew an X-with-corners —
// row∪column bands of shared anchors — not the semantic drift map). This is the graded divergence of
// the two CLOUD fields per cell: GREEN where both carry comparable mass (agreement), MAGENTA where
// intent outweighs reality (declared but not done — was cyan, which sank into the intent panel;
// palette contract 2026-06-11), AMBER where reality outweighs intent (done but not declared — the
// drift direction). Intensity = the local mass, so the topology is the clouds' own.
// (the returned count key stays `cyan` for consumer back-compat — it counts the declared-not-done cells.)
export function deltaCloudRgba(im, rm) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  let mx = 1e-9; for (let i = 0; i < CELLS; i++) { if (im[i] > mx) mx = im[i]; if (rm[i] > mx) mx = rm[i]; }
  let green = 0, cyan = 0, amber = 0;
  for (let i = 0; i < CELLS; i++) {
    const a = im[i] / mx, b = rm[i] / mx; if (a < 0.02 && b < 0.02) continue;
    const v = 0.3 + 0.7 * Math.log(1 + 9 * Math.max(a, b)) / Math.LN10;
    const o = i * 4; let col;
    if (a > 0.02 && b > 0.02 && Math.abs(a - b) <= 0.5 * Math.max(a, b)) { col = [46, 207, 111]; green++; }
    else if (a >= b) { col = [255, 45, 215]; cyan++; }
    else { col = [230, 160, 40]; amber++; }
    rgba[o] = Math.floor(col[0] * v); rgba[o + 1] = Math.floor(col[1] * v); rgba[o + 2] = Math.floor(col[2] * v);
  }
  const tot = green + cyan + amber || 1;
  return { rgba, green, cyan, amber, matchPct: Math.round(100 * green / tot) };
}

// edge-level DELTA: green = both walks' SIGNIFICANT jumps coincide · cyan = intent-only · amber =
// reality-only. One pixel per edge cell — the shape match the way the reef shows it.
export function shapeMatchEdges(im, rm, { k = 1.0 } = {}) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  const is = significantEdges(im, { k }), rs = significantEdges(rm, { k });
  let both = 0, io = 0, ro = 0;
  for (let i = 0; i < CELLS; i++) {
    const a = is[i], b = rs[i]; let col = null;
    if (a && b) { col = [46, 207, 111]; both++; } else if (a) { col = [0, 180, 220]; io++; } else if (b) { col = [230, 160, 40]; ro++; }
    if (col) { const o = i * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
  }
  return { rgba, both, io, ro, matchPct: (both + io + ro) ? Math.round(100 * both / (both + io + ro)) : 0 };
}
// edge-level three-colour TOLERANCE — LANES ARE THE SQUARES (operator, Jun 10: "lanes are actually
// the squares; if a commit is supposed to be in a strategy area you want to see the lanes light up
// in the strategy area — or other areas if it's drifting outside"). A cell's lane is its ShortLex
// BLOCK — the (row-block, col-block) 12×12 square — never a row stripe: classifying by the row
// anchor's domain letter alone made the class constant across a horizontal band ("lanes across the
// lattice — obviously wrong"). Dominant lanes = the block-squares holding the intent's significant
// edge mass; a reality-only edge is classified by the Chebyshev BLOCK-distance of its OWN square:
// d=0 in-lane (green) · d=1 adjacent square (amber bleed) · d≥2 orthogonal square (red when TOO MANY).
export function decodeDeltaThreeColourEdges(im, rm, killTolerancePct = 15, { k = 1.0 } = {}) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  const is = significantEdges(im, { k }), rs = significantEdges(rm, { k });
  const blkOf = i => [Math.floor(Math.floor(i / N) / 12), Math.floor((i % N) / 12)];   // the cell's square
  // dominant lanes: the 12×12 block-squares carrying the intent's significant edge mass
  const blockMass = new Float64Array(144);
  for (let i = 0; i < CELLS; i++) if (is[i]) { const [br, bc] = blkOf(i); blockMass[br * 12 + bc] += im[i] || 1; }
  let bmx = 0; for (let b = 0; b < 144; b++) if (blockMass[b] > bmx) bmx = blockMass[b];
  const domBlocks = [];
  for (let b = 0; b < 144; b++) if (bmx > 0 && blockMass[b] >= 0.10 * bmx) domBlocks.push([Math.floor(b / 12), b % 12]);
  if (!domBlocks.length) domBlocks.push([0, 0]);
  const blkDist = (br, bc) => { let m = Infinity; for (const [dr, dc] of domBlocks) m = Math.min(m, Math.max(Math.abs(br - dr), Math.abs(bc - dc))); return m; };
  const cls = new Uint8Array(CELLS); const perRow = new Array(12).fill(0);
  let inlane = 0, adj = 0, orth = 0;
  let rmx = 1; for (let i = 0; i < CELLS; i++) if (rs[i] && rm[i] > rmx) rmx = rm[i];
  for (let i = 0; i < CELLS; i++) {
    if (is[i] && rs[i]) { cls[i] = 1; inlane++; continue; }
    if (!rs[i]) continue;
    const [br, bc] = blkOf(i);
    const d = blkDist(br, bc);
    if (d <= 0) { cls[i] = 1; inlane++; }
    else if (d === 1) { cls[i] = 2; adj++; }
    else { cls[i] = 3; orth++; perRow[Math.floor(Math.floor(i / N) / 12)] += rm[i] / rmx; }
  }
  const total = inlane + adj + orth || 1;
  const offPct = Math.round(100 * orth / total);
  const tooMany = offPct > killTolerancePct;
  // TOLERANCE PALETTE (operator dictation, 2026-06-11: "colors need to be more different to make it
  // easier to see"): green DIMMED, amber SATURATED — drift must pop against the in-lane carpet.
  const GREEN = [30, 145, 80], AMBER = [255, 176, 0], RED = [255, 59, 59];
  let green = 0, amber = 0, red = 0;
  for (let i = 0; i < CELLS; i++) {
    let col = null; const v = 0.45 + 0.55 * Math.log(1 + 9 * (rm[i] || im[i] || 0) / rmx) / Math.LN10;
    if (cls[i] === 1) { col = GREEN.map(c => Math.floor(c * v)); green++; }
    else if (cls[i] === 2) { col = AMBER.map(c => Math.floor(c * v)); amber++; }
    else if (cls[i] === 3) { col = (tooMany ? RED : AMBER).map(c => Math.floor(c * v)); tooMany ? red++ : amber++; }
    if (col) { const o = i * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
  }
  // LANE PATTERN (operator 2026-06-15: the story must read the PICTURE — "if you see a line across it
  // with green dots, the pattern is what gemini must make sense of" — so expose WHERE the colour sits
  // by lane, not just the totals). Block granularity = the 12 ShortLex macro-lanes on each axis.
  //   greenRow/greenCol — the green (in-lane) cell count per block-row / per block-col → which lanes
  //     carry the competence carpet, and whether it's a horizontal/vertical streak.
  //   greenDiag vs greenOff — green ON the block-diagonal (br===bc, saying=doing in the SAME lane)
  //     vs off it → the canonical "diagonal line of green dots" the operator names.
  //   redBlocks — the orthogonal block-squares the drift actually fired in (top by red mass), each
  //     as [block-row, block-col] so the caller can name the lane pair (e.g. C1 acting on B2).
  const greenRow = new Array(12).fill(0), greenCol = new Array(12).fill(0);
  const redByBlock = new Float64Array(144); let greenDiag = 0, greenOff = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!cls[i]) continue;
    const [br, bc] = blkOf(i);
    if (cls[i] === 1) { greenRow[br]++; greenCol[bc]++; (br === bc ? greenDiag++ : greenOff++); }
    else if (cls[i] === 3 && tooMany) redByBlock[br * 12 + bc] += rm[i] / rmx;
  }
  const redBlocks = [];
  for (let b = 0; b < 144; b++) if (redByBlock[b] > 0) redBlocks.push({ br: Math.floor(b / 12), bc: b % 12, w: Math.round(redByBlock[b] * 100) / 100 });
  redBlocks.sort((a, b) => b.w - a.w);
  // REGION CLASSIFIER — LINE-FIRST (operator 2026-06-15: "it is not just the triangles… any geometry
  // region, often lines"). The carrier of meaning is the LINE, because a line is an INVARIANT — it
  // names what is held CONSTANT across the streak. WHERE the red falls picks the motif:
  //   DIAGONAL  (actor==patient, offset 0): self-reference — saying==doing. Invariant = identity.
  //   HORIZONTAL(actor==const):  one fixed role/actor sprayed across many patients. Invariant = actor.
  //   VERTICAL  (patient==const): one fixed boundary hit from many actors. Invariant = the target.
  //   OFF-DIAGONAL (actor−patient==k≠0): everything shifted k lanes — a SYSTEMATIC transposition, the
  //     work consistently landing k lanes off declared (a calibration/aim error, not random scatter).
  // The triangle (bottom-up vs top-down) is just the SIGN of the offset, derived — not the primary cut.
  // Extent along the chosen line = the BLAST RADIUS (≥6 lanes systemic · 2-5 bounded · 1 point). Axes
  // run ShortLex/time: Strategy(0)→Operations(11); macro distance (Strategy=0·Tactics=1·Ops=2) = severity.
  const macroRank = (idx) => idx < 3 ? idx : Math.floor((idx - 3) / 3);   // A/B/C=0/1/2 · A1-3→0 · B1-3→1 · C1-3→2
  const prefixLen = (idx) => idx < 3 ? 1 : 2;
  let region = { tier: 'INSURABLE', motif: 'none', invariant: null, offset: 0, spread: 0, blastRadius: 'none', direction: 'self', macroDist: 0, severity: 'none', ruling: null };
  if (redBlocks.length) {
    // mass concentrated by each invariant family → which line best explains the red.
    const byRow = new Map(), byCol = new Map(), byOff = new Map();
    let total = 0;
    for (const b of redBlocks) { total += b.w; byRow.set(b.br, (byRow.get(b.br) || 0) + b.w); byCol.set(b.bc, (byCol.get(b.bc) || 0) + b.w); const d = b.br - b.bc; byOff.set(d, (byOff.get(d) || 0) + b.w); }
    const argmax = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];   // [key, mass]
    const [rowKey, rowMass] = argmax(byRow), [colKey, colMass] = argmax(byCol), [offKey, offMass] = argmax(byOff);
    // pick the strongest invariant. ties → prefer the more specific (a held actor/patient over an offset band).
    const cand = [{ motif: offKey === 0 ? 'diagonal' : 'off-diagonal', mass: offMass, key: offKey, kind: 'offset' },
      { motif: 'horizontal', mass: rowMass, key: rowKey, kind: 'row' },
      { motif: 'vertical', mass: colMass, key: colKey, kind: 'col' }].sort((a, b) => b.mass - a.mass);
    const win = cand[0];
    // the blocks ON the winning line → its extent (blast radius) and the most damning block on it.
    const onLine = redBlocks.filter((b) => win.kind === 'row' ? b.br === win.key : win.kind === 'col' ? b.bc === win.key : (b.br - b.bc) === win.key);
    region.motif = win.motif; region.offset = win.kind === 'offset' ? win.key : (win.key);
    region.spread = onLine.length;
    region.blastRadius = onLine.length >= 6 ? 'systemic' : onLine.length >= 2 ? 'bounded' : 'point';
    region.invariant = win.kind === 'row' ? { axis: 'actor', lane: win.key } : win.kind === 'col' ? { axis: 'patient', lane: win.key } : { axis: 'offset', k: win.key };
    // ruling block on the line = biggest macro gap, then mass (underwriters price the worst exposure).
    const r = [...onLine].sort((a, b) => (Math.abs(macroRank(b.br) - macroRank(b.bc)) - Math.abs(macroRank(a.br) - macroRank(a.bc))) || (b.w - a.w))[0];
    const md = Math.abs(macroRank(r.br) - macroRank(r.bc));
    region.ruling = { br: r.br, bc: r.bc, prefixActor: prefixLen(r.br), prefixPatient: prefixLen(r.bc), actorMacro: macroRank(r.br), patientMacro: macroRank(r.bc) };
    region.macroDist = md;
    region.severity = md >= 2 ? 'severe' : md === 1 ? 'moderate' : 'minor';
    region.direction = r.br > r.bc ? 'bottom-up' : r.br < r.bc ? 'top-down' : 'self';   // derived sign of the offset
    // UNINSURABLE when the work reaches UP (bottom-up) into a higher-abstraction lane it never declared,
    // and either crosses a macro tier OR streaks systemically across the lattice. A clean diagonal, or a
    // top-down (intent→execution) line, stays priceable.
    region.tier = (tooMany && region.direction === 'bottom-up' && (md >= 1 || region.blastRadius === 'systemic')) ? 'UNINSURABLE'
      : tooMany ? 'PRICEABLE' : 'INSURABLE';
  }
  const pattern = { greenRow, greenCol, greenDiag, greenOff, redBlocks: redBlocks.slice(0, 4), region };
  // domBlockCount is the INSTRUMENT-BLINDNESS gauge (2026-06-11): when the dominant-lane set covers
  // most of the 144 block-squares, Chebyshev d=0 everywhere → all green → the tolerance can't see.
  return { rgba, green, amber, red, tooMany, offPct, perRow, pattern, domBlockCount: domBlocks.length };
}

// ── THE SHORTLEX-3 ZONE OVERLAY, exported (the reusable form — shortlex-project.mjs draws it
// ALWAYS; renderTriptych keeps it opt-in behind PMU_SHORTLEX_ZONES). Grey lines at the TRUE
// three-length ShortLex zone boundaries — x=y=3 (end of length-1: A,B,C) and x=y=12 (end of
// length-2: A1..C3) slightly brighter, then the sub-boundaries within [12,144) at each length-2
// parent's child-block start. ALL boundaries are COMPUTED from the registry (never hardcoded —
// the child allocation is data-driven: 132 does not divide by 9).
export function shortlexZoneOverlay(rgba, registry = loadRegistry(), { gain = 1 } = {}) {
  const z = zoneBoundaries(registry);
  const lines = [
    ...z.major.map(k => [k, 30 * gain]),                                  // 3 and 12 — slightly brighter
    ...z.childStarts.filter(k => !z.major.includes(k)).map(k => [k, 16 * gain]),  // 27, 42, … 130
  ];
  for (const [k, a] of lines) {
    for (let t = 0; t < N; t++) {
      const o1 = (k * N + t) * 4, o2 = (t * N + k) * 4;            // horizontal + vertical grey line at k
      for (const o of [o1, o2]) { rgba[o] = Math.min(255, rgba[o] + a); rgba[o + 1] = Math.min(255, rgba[o + 1] + a); rgba[o + 2] = Math.min(255, rgba[o + 2] + a); }
    }
  }
  return rgba;
}

// ── INTEGER SEGMENT SPLIT (the mobile-Gmail contract, spec #2 UX) ───────────────
// Proportional cells expressed ONLY as percentages/fractions displace on the phone: mobile Gmail
// recomputes fractional widths per cell and the seams slide off the fixed-width image. The fix is
// EXPLICIT integer width attributes that sum EXACTLY to the image's pixel width — computed here by
// largest remainder (deterministic; ties by index). Used by BOTH axis strips and asserted by
// tests/pmu-simulator/axis-strip-mobile.test.mjs (the width attrs must sum exactly to IMG).
export function intSpans(spans, px) {
  const total = spans.reduce((s, x) => s + x, 0) || 1;
  const raw = spans.map((s) => (px * s) / total);
  const base = raw.map(Math.floor);
  let rem = px - base.reduce((s, x) => s + x, 0);
  const order = raw.map((v, i) => [v - base[i], i]).sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
  for (let k = 0; k < order.length && rem > 0; k++, rem--) base[order[k][1]]++;
  return base;
}

// ── THE SHORTLEX-3 AXIS STRIPS, exported (operator, Jun 11 — IMG_3936: "the axis is
// unsymmetrical — if we don't annotate it right I can't verify it's doing what it should").
// You cannot write out all 144 names at phone size; you CAN write the three-zone summary:
// "ABC" over [0,3) · "A1–C3" over [3,12) · one compact child-range per length-2 parent
// ("A1A–O" = A1A through A1O, "C3A–N" …) over its child block. Every segment's width is
// PROPORTIONAL to its index span, so each label sits exactly over its zone seams at any
// rendered scale. The SAME label list goes on the TOP strip and the LEFT column — the symmetry
// IS the verification: the operator reads top against left. All boundaries + ranges are
// COMPUTED from the registry (never hardcoded — the child allocation is data-driven).
// Gmail-safe: tables + inline styles only, no flexbox/writing-mode rotation — the left side
// follows the pair panels' proven label-column pattern (rows at proportional heights,
// vertical-align:middle), title= carries the full range for hover/inspection.
export function shortlexAxisStrip(registry = loadRegistry(), px = 300) {
  const e = registry.entries, n = e.length;
  const { major, childStarts } = zoneBoundaries(registry);
  const [b1, b2] = major;                                   // [3, 12] under the default allocation — computed, never assumed
  const segs = [
    { start: 0, end: b1, label: e.slice(0, b1).map(x => x.name).join(''), full: `${e[0].name}–${e[b1 - 1].name} — the ${b1} length-1 parents` },
    { start: b1, end: b2, label: `${e[b1].name}–${e[b2 - 1].name}`, full: `${e[b1].name}–${e[b2 - 1].name} — the ${b2 - b1} length-2 axes` },
    ...childStarts.map((s, k) => {
      const end = childStarts[k + 1] ?? n;
      return { start: s, end, label: `${e[s].name}–${e[end - 1].name.slice(-1)}`, full: `${e[s].name}–${e[end - 1].name} — ${end - s} children of ${e[s].parent}` };
    }),
  ];
  // MOBILE-GMAIL CONTRACT (spec #2 UX — "the axis strips displace on the phone"): every cell
  // carries an EXPLICIT integer width/height ATTRIBUTE, the integers sum EXACTLY to px
  // (intSpans, largest remainder), table-layout stays fixed, padding stays 0, and there is NO
  // max-width:100% on the strip (a shrinking strip beside a fixed-width left column is exactly
  // the displacement the operator photographed). Percentages alone are not enough.
  const widths = intSpans(segs.map((s) => s.end - s.start), px);
  const heights = intSpans(segs.map((s) => s.end - s.start), px);
  const tint = (i) => i === 0 ? '#1c2736' : i === 1 ? '#151f2d' : (i % 2 ? '#0e1521' : '#0a101a');
  const font = (size) => `font:${size}px ui-monospace,monospace;color:#7e8ea0;line-height:1`;
  // TOP: two label rows over the SAME fixed proportional columns (the tinted bands carry the
  // exact geometry). Row 1: "ABC" left-anchored at x=0 (wider than its 3/144 band, so it bleeds
  // RIGHT over the EMPTY length-2 cell) + the child ranges centered in their own cells (they
  // fit). Row 2: "A1–C3" left-anchored at its band's left seam, bleeding right over empty child
  // cells. Two rows = zero label collisions while every anchor point stays on its seam.
  const cell = (s, i, inner) => `<td width="${widths[i]}" title="${s.full}" style="width:${widths[i]}px;background:${tint(i)};padding:0;overflow:visible">${inner}</td>`;
  const top = `<table width="${px}" cellpadding="0" cellspacing="0" style="width:${px}px;margin:0 0 1px;table-layout:fixed;border-collapse:collapse">`
    + `<tr style="height:10px">${segs.map((s, i) => cell(s, i, i === 0 ? `<div style="${font(7)};text-align:left;white-space:nowrap">${s.label}</div>` : i >= 2 ? `<div style="${font(7.5)};text-align:center;white-space:nowrap">${s.label}</div>` : '')).join('')}</tr>`
    + `<tr style="height:9px">${segs.map((s, i) => cell(s, i, i === 1 ? `<div style="${font(7)};text-align:left;white-space:nowrap">${s.label}</div>` : '')).join('')}</tr></table>`;
  // LEFT: the same labels down the side at integer ROW heights (sums to px exactly).
  // The "ABC" row is only ~6px tall → 6px font so the row cannot expand and push
  // every seam below it out of alignment.
  const W = 36;
  const left = `<td width="${W}" style="width:${W}px;padding:0;vertical-align:top"><table width="${W}" cellpadding="0" cellspacing="0" style="height:${px}px;width:${W}px;table-layout:fixed;border-collapse:collapse">`
    + segs.map((s, i) => `<tr><td height="${heights[i]}" title="${s.full}" style="height:${heights[i]}px;background:${tint(i)};${font(i === 0 ? 6 : i === 1 ? 7 : 7.5)};text-align:right;padding:0 3px 0 0;vertical-align:middle;white-space:nowrap">${s.label}</td></tr>`).join('')
    + `</table></td>`;
  return { top, left, segs, widths, heights, width: W };
}

// ── THE PAIR-COORDINATE TWIN (spec #2 UX: ALL panels read the same way) ─────────
// The pair panels keep their 12-label strip but render it with the SAME proportional mechanism
// as the ShortLex-3 strip: tinted bands, explicit integer width/height attrs summing exactly to
// px, a left column at the same 36px — so every image in the email carries 144-style annotated
// axes and the two coordinate systems differ only in their labels, never in their furniture.
// The 12 anchor blocks are labeled by their axis names (rank visible at strip size; the full
// "rank — name · cell range" rides in title= for hover/inspection).
export const AX_NAME12 = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Law', A2: 'Goal', A3: 'Fund', B1: 'Speed', B2: 'Deal', B3: 'Signal', C1: 'Grid', C2: 'Loop', C3: 'Flow' };
export function pairAxisStrip(px = 300) {
  const segs = AXES12.map((a, i) => ({ label: a, full: `${a} — ${AX_NAME12[a]} (anchor block ${i * 12}–${i * 12 + 11})` }));
  const widths = intSpans(segs.map(() => 1), px);
  const heights = intSpans(segs.map(() => 1), px);
  const tint = (i) => (i % 2 ? '#0e1521' : '#0a101a');
  const font = (size) => `font:${size}px ui-monospace,monospace;color:#7e8ea0;line-height:1`;
  const top = `<table width="${px}" cellpadding="0" cellspacing="0" style="width:${px}px;margin:0 0 1px;table-layout:fixed;border-collapse:collapse"><tr style="height:10px">`
    + segs.map((s, i) => `<td width="${widths[i]}" title="${s.full}" style="width:${widths[i]}px;background:${tint(i)};padding:0"><div style="${font(8)};text-align:center;white-space:nowrap">${s.label}</div></td>`).join('')
    + `</tr></table>`;
  const W = 36;
  const left = `<td width="${W}" style="width:${W}px;padding:0;vertical-align:top"><table width="${W}" cellpadding="0" cellspacing="0" style="height:${px}px;width:${W}px;table-layout:fixed;border-collapse:collapse">`
    + segs.map((s, i) => `<tr><td height="${heights[i]}" title="${s.full}" style="height:${heights[i]}px;background:${tint(i)};${font(8)};text-align:right;padding:0 3px 0 0;vertical-align:middle;white-space:nowrap">${s.label}</td></tr>`).join('')
    + `</table></td>`;
  return { top, left, segs, widths, heights, width: W };
}

// ── THE COMPETENCE-PIXEL CROSSHAIR, module-level (hoisted from renderTriptych so the
// localization gradient panel reuses the SAME crosshair — one ◎, never two dialects):
// full-width row+col hairlines at low alpha + a hot 3px ring at the pixel itself.
export function markPixel(rgba, cell, col = [255, 80, 200]) {
  if (cell == null || cell < 0) return rgba;
  const py = Math.floor(cell / N), px = cell % N;
  for (let t = 0; t < N; t++) {                          // hairlines
    const o1 = (py * N + t) * 4, o2 = (t * N + px) * 4;
    rgba[o1] = Math.min(255, rgba[o1] + 38); rgba[o1 + 2] = Math.min(255, rgba[o1 + 2] + 38);
    rgba[o2] = Math.min(255, rgba[o2] + 38); rgba[o2 + 2] = Math.min(255, rgba[o2 + 2] + 38);
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {   // the hot ring
    if (Math.max(Math.abs(dy), Math.abs(dx)) !== 2) continue;
    const y = py + dy, x = px + dx; if (y < 0 || y >= N || x < 0 || x >= N) continue;
    const o = (y * N + x) * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2];
  }
  return rgba;
}

// ── THE LOCALIZATION GRADIENT PANEL (operator, accumulated: "express as pixels with color
// gradients — from-to color, mass and rank" + "ranks/percentiles in gestalt blocks" + "per
// prefix-intersection boundaries (B1×C3 has stats X) and USE it"). The visual form of the
// ranked-geometric claim — if the top-ranked cells land in the top true blocks, the surgeon
// isn't doing plumbing. ONE panel over a 20,736-cell localization field (e.g. sigma-localize's
// per-zone compression deltas diagonal-lifted via zoneFieldToLattice, or any |Δ| field):
//   · per-cell COLOUR = the from→to gradient by normalized signal (cool cyan = the pre-edit
//     floor, hot magenta = where the edit's compression delta concentrates); BRIGHTNESS = mass
//     (the log idiom every other panel uses). One pixel per cell — NEVER a block paint (AR-8).
//   · TOP-10 RANK RINGS: ranked cells get a ring overlay, rank 1 largest/brightest (gold).
//     Rings fire ONLY for cells above the field's own μ+σ — a uniform field earns NO rings
//     (no manufactured emphasis, the AR-8 spirit); ordering = value desc, index asc (the
//     rankImpact convention, deterministic).
//   · GESTALT-BLOCK PERCENTILES: every 12×12 ShortLex block's perimeter drawn with intensity
//     proportional to its mass percentile among the 144 — ALL block math routed through
//     block-stats.mjs (allBlockStats — this panel is its first consumer). The percentile is
//     computed from MASS with ties sharing (strictly-smaller count / 143), so tied blocks —
//     including the all-tied uniform field — read 0 and draw the uniform faint grid:
//     alphabetic rank order must never paint emphasis. Overlay only — cells stay 1:1.
//   · optional CROSSHAIR on the target cell (markPixel — the same ◎ every panel carries).
// Returns { rgba, rings, blockPercentiles, flat, maxCell } — rgba is the standard
// 144×144 one-pixel-per-cell RGBA buffer the other panels return.
export const LOCALIZATION_PANEL_LEGEND = 'what good looks like: one bright block, rings clustered, everything else dark — cyan→magenta = pre-edit floor→delta concentration · brightness = mass · gold rings = top-10 ranked cells (rank 1 largest) · block borders = gestalt-block mass percentile (block-stats)';
export function localizationPanelRgba(field, { from = [0, 180, 220], to = [255, 45, 215], target = null, topK = 10, ringK = 1.0, registry = null, nulls = 1 } = {}) {
  if (!field || field.length !== CELLS) throw new Error(`localizationPanelRgba: field must have ${CELLS} cells, got ${field?.length}`);
  const rgba = new Uint8Array(CELLS * 4);
  for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  // 1. the from→to gradient — colour mixes by normalized |signal|, brightness = mass (log idiom)
  const abs = new Float64Array(CELLS);
  let mx = 0, mxIdx = -1, s = 0, s2 = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = Math.abs(field[i]); abs[i] = v; s += v; s2 += v * v;
    if (v > mx) { mx = v; mxIdx = i; }
  }
  const mu = s / CELLS, sd = Math.sqrt(Math.max(0, s2 / CELLS - mu * mu));
  if (mx > 0) for (let i = 0; i < CELLS; i++) {
    const t = abs[i] / mx; if (t <= 0) continue;
    const a = 0.25 + 0.75 * Math.log(1 + 9 * t) / Math.LN10;
    const o = i * 4;
    rgba[o] = Math.min(255, Math.floor((from[0] + (to[0] - from[0]) * t) * a));
    rgba[o + 1] = Math.min(255, Math.floor((from[1] + (to[1] - from[1]) * t) * a));
    rgba[o + 2] = Math.min(255, Math.floor((from[2] + (to[2] - from[2]) * t) * a));
  }
  // 2. gestalt-block percentile borders — block-stats owns ALL the block math (first consumer)
  const reg = registry || loadBlockRegistry();
  const ax = blockAxis12(reg);
  const table = allBlockStats(abs, 2, { registry: reg, nulls });
  const masses = table.map((b) => b.mass);
  const flat = table.length < 2 || masses[0] - masses[masses.length - 1] <= 1e-12;   // table is mass-desc
  const pctOf = (m) => table.length > 1 ? 100 * masses.filter((x) => x < m - 1e-12).length / (masses.length - 1) : 0;
  const blockPercentiles = table.map((b) => ({ block: b.block, rank: b.rank, mass: b.mass, share: b.share, percentile: +pctOf(b.mass).toFixed(2) }));
  for (const b of blockPercentiles) {
    const [rp, cp] = b.block.split('×');
    const r0 = ax.indexOf(rp) * 12, c0 = ax.indexOf(cp) * 12;
    if (r0 < 0 || c0 < 0) continue;
    const add = Math.round(12 + 68 * b.percentile / 100);                            // faint floor + percentile gain
    for (let t = 0; t < 12; t++) {
      for (const [y, x] of [[r0, c0 + t], [r0 + 11, c0 + t], [r0 + t, c0], [r0 + t, c0 + 11]]) {
        const o = (y * N + x) * 4;
        rgba[o] = Math.min(255, rgba[o] + add); rgba[o + 1] = Math.min(255, rgba[o + 1] + add); rgba[o + 2] = Math.min(255, rgba[o + 2] + add);
      }
    }
  }
  // 3. the top-K rank rings — only cells that stand OUT of the field's own statistics ring
  const rings = [];
  if (mx > 0 && sd > 1e-12) {
    const order = [...abs.keys()].sort((a, b) => abs[b] - abs[a] || a - b);          // value desc, index asc
    const thr = mu + ringK * sd;
    for (let r = 0; r < order.length && rings.length < topK; r++) {
      const k = order[r], v = abs[k];
      if (!(v > thr) || v <= 0) break;                                               // ordered desc — first failure ends it
      const rank = rings.length + 1;
      const radius = rank === 1 ? 4 : rank <= 3 ? 3 : 2;                             // rank 1 largest…
      rings.push({ rank, cell: k, i: (k / N) | 0, j: k % N, value: +v.toFixed(6), radius });
    }
    // paint LOWEST rank LAST so where rings overlap, the brighter (higher-ranked) ring wins
    for (const g of [...rings].reverse()) {
      const scale = 1 - 0.06 * (g.rank - 1);                                         // …and brightest
      const col = [Math.round(255 * scale), Math.round(220 * scale), Math.round(90 * scale)];
      for (let dy = -g.radius; dy <= g.radius; dy++) for (let dx = -g.radius; dx <= g.radius; dx++) {
        if (Math.max(Math.abs(dy), Math.abs(dx)) !== g.radius) continue;
        const y = g.i + dy, x = g.j + dx; if (y < 0 || y >= N || x < 0 || x >= N) continue;
        const o = (y * N + x) * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2];
      }
    }
  }
  // 4. the crosshair on the supplied target cell (the same ◎ every panel carries)
  if (target != null && target >= 0) markPixel(rgba, target);
  const maxCell = mx > 0 ? { cell: mxIdx, i: (mxIdx / N) | 0, j: mxIdx % N, value: +mx.toFixed(6) } : null;
  return { rgba, rings, blockPercentiles, flat, maxCell };
}

export function shapeMatch144(ip, rp) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  let both = 0, io = 0, ro = 0;
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
    const i = (ip[r * 12 + c] ?? -1) >= 0, rr = (rp[r * 12 + c] ?? -1) >= 0; let col = null;
    if (i && rr) { col = [46, 207, 111]; both++; } else if (i) { col = [0, 180, 220]; io++; } else if (rr) { col = [230, 160, 40]; ro++; }
    if (col) for (let dy = 0; dy < 12; dy++) for (let dx = 0; dx < 12; dx++) { const o = ((r * 12 + dy) * 144 + (c * 12 + dx)) * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
  }
  return { rgba, both, io, ro, matchPct: (both + io + ro) ? Math.round(100 * both / (both + io + ro)) : 0 };
}
// count lit cells in a binary bitmap
export function bitmapCount(b64) {
  const bytes = Buffer.from(b64 || '', 'base64'); let n = 0;
  for (let i = 0; i < CELLS; i++) n += (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return n;
}
// ── THREE-COLOUR tolerance from the GRADED Δ-PERSPECTIVE (better out-of-lane reasoning) ──
// The binary XOR conflates "intent is silent here" (benign — a short message doesn't cover
// everything) with "reality is doing something intent didn't sanction" (real out-of-lane). So we
// reason from the GRADED heatmaps instead (the Δ perspective the dashboard uses — "smooths XOR
// noise"): a cell is OUT-OF-LANE only when REALITY fires strongly where INTENT is weak — reality
// going somewhere it wasn't told to. Then:
//   GREEN  = in-lane agreement (intent AND reality both present).
//   AMBER  = reality-beyond-intent in an ADJACENT block (a few is fine — neighbouring bleed).
//   RED    = reality-beyond-intent in an ORTHOGONAL block, AND too many of them (aggregate flip) —
//            the surgeon doing plumbing. A few orthogonal stays amber; a concentration flips red.
export function decodeDeltaThreeColour(intentB64, realityB64, domBlocks, killTolerancePct = 15) {
  const rb = Buffer.from(realityB64 || '', 'base64');
  const frr = rb.length === CELLS * 4 ? new Float32Array(rb.buffer, rb.byteOffset, CELLS) : null;
  const rgba = new Uint8Array(CELLS * 4).fill(5); for (let i = 0; i < CELLS; i++) rgba[i * 4 + 3] = 255;
  if (!frr) return { rgba, green: 0, amber: 0, red: 0, tooMany: false, offPct: 0, perRow: [] };
  let rmax = 0; for (let i = 0; i < CELLS; i++) if (frr[i] > rmax) rmax = frr[i];
  const blockOf = i => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
  // IN-LANE REFERENCE (harness guard, 2026-06-18): this function is HANDED intentB64 — use it. If the
  // caller didn't supply domBlocks, derive the top-4 intent blocks here so the function is
  // self-sufficient and CANNOT silently emit a degenerate all-orthogonal/all-red panel (the
  // attest-demo 2.11.1 class of error). If even the intent is empty, FLAG degenerate — the caller must
  // surface that as an explicit error, never paint it green-blind as if it were a real verdict.
  if (!domBlocks || !domBlocks.length) {
    const ib = Buffer.from(intentB64 || '', 'base64');
    const fi = ib.length === CELLS * 4 ? new Float32Array(ib.buffer, ib.byteOffset, CELLS) : null;
    if (fi) { const bm = new Array(16).fill(0); for (let i = 0; i < CELLS; i++) bm[blockOf((i % 144) % 144)] += fi[i];
      domBlocks = [...bm.keys()].filter(b => bm[b] > 0).sort((a, b) => bm[b] - bm[a]).slice(0, 4); }
  }
  if (!domBlocks || !domBlocks.length) return { rgba, green: 0, amber: 0, red: 0, tooMany: false, offPct: 0, perRow: [], degenerate: true };
  const dist = b => { const br = Math.floor(b / 4), bc = b % 4; let m = Infinity; for (const d of domBlocks) { const dr = Math.floor(d / 4), dc = d % 4; m = Math.min(m, Math.max(Math.abs(br - dr), Math.abs(bc - dc))); } return Number.isFinite(m) ? m : 9; };
  // LANE-based: where REALITY fires (rv>OUT), colour by the block-distance of its row-node from the
  // dominant (intent) blocks. d=0 in-lane (green, the competence) · d=1 adjacent (amber, a few ok) ·
  // d≥2 orthogonal (the surgeon doing plumbing → red when TOO MANY). Ties directly to the 12 axes.
  const OUT = 0.10;
  const cls = new Int8Array(CELLS); let inlane = 0, adj = 0, orth = 0;
  const perRow = new Array(12).fill(0);   // orthogonal-out mass per ROW-axis (read which lane drifts)
  for (let i = 0; i < CELLS; i++) {
    const rv = rmax > 0 ? frr[i] / rmax : 0; if (rv < OUT) continue;
    const rowNode = Math.floor(i / N) % 144 % 144, d = dist(blockOf(rowNode % 144));
    if (d === 0) { cls[i] = 1; inlane++; } else if (d === 1) { cls[i] = 2; adj++; } else { cls[i] = 3; orth++; perRow[Math.floor((i % N) % 144 / 12) % 12] += rv; }
  }
  const total = inlane + adj + orth || 1;
  const offPct = Math.round(100 * orth / total);
  const tooMany = offPct > killTolerancePct;
  const GREEN = [46, 207, 111], AMBER = [224, 160, 32], RED = [255, 59, 59];
  let green = 0, amber = 0, red = 0;
  for (let i = 0; i < CELLS; i++) {
    const o = i * 4; let c = null; const v = rmax > 0 ? frr[i] / rmax : 0;
    if (cls[i] === 1) { c = GREEN.map(ch => Math.floor(ch * (0.45 + 0.55 * v))); green++; }
    else if (cls[i] === 2) { c = AMBER; amber++; }
    else if (cls[i] === 3) { if (tooMany) { c = RED; red++; } else { c = AMBER; amber++; } }
    if (c) { rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; }
  }
  // REGION — name WHICH lane drifted (fixes "region: n/a"): the row-axis (actor lane) carrying the most
  // orthogonal-out mass. This is the HORIZONTAL invariant of the line-first classifier, computed from
  // perRow (the data the B64 path already has; the full diagonal/offset analysis lives in the edges
  // variant). Never null when there is drift — the panel must always be able to say which lane.
  const _AX12 = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
  let region = { motif: 'none', axis: 'actor', lane: null, lanePct: 0, blastRadius: 'none' };
  const offSum = perRow.reduce((a, b) => a + b, 0);
  if (tooMany && offSum > 0) {
    let mi = 0; for (let i = 1; i < 12; i++) if (perRow[i] > perRow[mi]) mi = i;
    const lit = perRow.filter((v) => v > 0).length;
    region = { motif: 'horizontal', axis: 'actor', lane: _AX12[mi], lanePct: Math.round(100 * perRow[mi] / offSum),
      blastRadius: lit >= 6 ? 'systemic' : lit >= 2 ? 'bounded' : 'point', ruling: _AX12[mi] };
  }
  return { rgba, green, amber, red, tooMany, offPct, perRow, pattern: { region } };
}

// BRICK #4 (2026-06-10): the HEAT-CONSISTENT tolerance. The bitmap version above reads the PIPELINE
// heatmaps + coarse 4×4 block distance; but the σ (Brick #3) now reads the DEFINER-WALK heat. This reads
// the SAME definer-walk heat vectors, so "where did we drift" matches the shape we actually score:
//   per anchor, REALITY hot where INTENT is weak = drift. Classify by ROW-AXIS DOMAIN (top-level letter):
//     GREEN  = intent present (in-lane agreement — reality may pile on, that's the competence).
//     AMBER  = reality-beyond-intent but in the SAME domain letter as a declared intent lane (bleed, fine).
//     RED    = reality-beyond-intent in a DIFFERENT domain (the surgeon doing plumbing) — when TOO MANY.
// Each anchor drawn as a 12×12 block (like definerWalkRgba) so it fills the 144×144 panel consistently.
const AXES12 = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export function decodeDeltaThreeColourHeat(intentHeat, realityHeat, killTolerancePct = 15) {
  const rgba = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { rgba[i * 4] = 5; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 5; rgba[i * 4 + 3] = 255; }
  const ih = intentHeat || [], rh = realityHeat || [];
  const imax = Math.max(1e-9, ...ih), rmax = Math.max(1e-9, ...rh);
  const IN = 0.12, OUT = 0.12;   // normalized thresholds: intent "present", reality "fires"
  // dominant intent DOMAINS = the top-level letters (A/B/C) of the row-axes intent lit with real mass.
  const domLetters = new Set();
  for (let i = 0; i < 144; i++) if (ih[i] / imax >= IN) domLetters.add(AXES12[Math.floor(i / 12)][0]);
  if (!domLetters.size) domLetters.add('A');
  const GREEN = [46, 207, 111], AMBER = [224, 160, 32], RED = [255, 59, 59];
  const cls = new Int8Array(144); const perRow = new Array(12).fill(0);
  let inlane = 0, adj = 0, orth = 0;
  for (let i = 0; i < 144; i++) {
    const iv = ih[i] / imax, rv = rh[i] / rmax;
    if (iv >= IN) { cls[i] = 1; inlane++; continue; }          // intent present → in-lane (green)
    if (rv < OUT) { cls[i] = 0; continue; }                    // neither → background
    const letter = AXES12[Math.floor(i / 12)][0];              // reality fired where intent is weak
    if (domLetters.has(letter)) { cls[i] = 2; adj++; }         // same domain → amber (bleed)
    else { cls[i] = 3; orth++; perRow[Math.floor(i / 12)] += rv; }  // other domain → orthogonal
  }
  const total = inlane + adj + orth || 1;
  const offPct = Math.round(100 * orth / total);
  const tooMany = offPct > killTolerancePct;
  let green = 0, amber = 0, red = 0;
  const paint = (anchor, col, a) => { const r = Math.floor(anchor / 12), c = anchor % 12; for (let dy = 0; dy < 12; dy++) for (let dx = 0; dx < 12; dx++) { const o = ((r * 12 + dy) * 144 + (c * 12 + dx)) * 4; rgba[o] = Math.floor(col[0] * a); rgba[o + 1] = Math.floor(col[1] * a); rgba[o + 2] = Math.floor(col[2] * a); } };
  for (let i = 0; i < 144; i++) {
    if (cls[i] === 1) { paint(i, GREEN, 0.45 + 0.55 * (ih[i] / imax)); green++; }
    else if (cls[i] === 2) { paint(i, AMBER, 0.5 + 0.5 * (rh[i] / rmax)); amber++; }
    else if (cls[i] === 3) { if (tooMany) { paint(i, RED, 0.5 + 0.5 * (rh[i] / rmax)); red++; } else { paint(i, AMBER, 0.5 + 0.5 * (rh[i] / rmax)); amber++; } }
  }
  return { rgba, green, amber, red, tooMany, offPct, perRow };
}
// ── the full triptych — returns BOTH a data-URI HTML (for the attached file, renders in a browser)
// and a CID HTML (for the email BODY — Gmail strips data: URIs, so the body uses <img src="cid:…">)
// plus the raw PNG buffers to attach inline. timings/tolerances/commit-context are shown in the HTML.
export function renderTriptych({ intentB64, realityB64, frictionB64, domBlocks = [], killTolerancePct = 15, label = '', sub = '', timings = {}, message = '', files = [], tiles = [], cidSuffix = '', cole = null, rawGrids = null, pixelCell = null, pixelStatementHtml = '', shortlex = null, sigmaType = 'drift', shortlexZones = process.env.PMU_SHORTLEX_ZONES === '1' }) {
  // EDGE MODE (the goal): when the walk carries the full 20,736-cell EDGE matrices, every panel is the
  // true 144×144 one-pixel-per-cell render (like the reef) with the significance threshold — never the
  // anchor-block (12×12-looking) paint. Tolerance reads the same thresholded edges.
  const hasEdges = cole && cole.intent && cole.intent.matrix && cole.reality && cole.reality.matrix;
  // BRICK #4: the tolerance reads the SAME shape the σ scores; edge-level when edges exist, anchor-heat
  // as the bridge fallback, pipeline-bitmap only when there's no walk at all.
  // tolerance = CLOUD-TOPOLOGY per cell (operator: "lane bands" was a misread — the read is where
  // drift mass CONCENTRATES in the map vs the intent shape, not stay-in-row stripes).
  // SELF-SUFFICIENT IN-LANE REFERENCE (harness guard, 2026-06-18): domBlocks — the top-4 intent
  // blocks — is the tolerance's in-lane reference. It used to be computed per-CALLER: commit-triptych
  // had it, attest-demo didn't, so the demo silently shipped a degenerate 0-green/all-red panel
  // (every block read orthogonal). Derive it HERE from the intent heat whenever a caller omits it,
  // so that ENTIRE CLASS of divergence cannot recur regardless of which surface calls renderTriptych.
  let domB = domBlocks;
  if ((!domB || !domB.length) && intentB64) {
    const ib = Buffer.from(intentB64, 'base64');
    const f32 = ib.length === CELLS * 4 ? new Float32Array(ib.buffer, ib.byteOffset, CELLS) : null;
    if (f32) {
      const blk = (i) => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
      const bm = new Array(16).fill(0); for (let i = 0; i < CELLS; i++) bm[blk((i % 144) % 144)] += f32[i];
      domB = [...bm.keys()].filter((b) => bm[b] > 0).sort((a, b) => bm[b] - bm[a]).slice(0, 4);
    }
  }
  const tol = hasEdges
    ? decodeDeltaThreeColourEdges(cole.intent.matrix, cole.reality.matrix, killTolerancePct)
    : (cole && cole.intent && cole.intent.heat)
      ? decodeDeltaThreeColourHeat(cole.intent.heat, cole.reality.heat, killTolerancePct)
      : decodeDeltaThreeColour(intentB64, realityB64, domB, killTolerancePct);
  const friction = bitmapCount(frictionB64);
  // THE COMPETENCE-PIXEL CROSSHAIR (operator: "the intersection must be CLEAR in the images so we
  // see where the competence pixel originates"). A bright marker at (actor,patient) on every panel:
  // full-width row+col hairlines at low alpha + a hot 3px ring at the pixel itself.
  // THE SHORTLEX BOUNDARY GRID (operator, Jun 11: "headlines on the images to show where the
  // short-rank boundaries are — faint enough that the heat mask overlapping those boundaries is
  // interesting to show"). Faint lines every 12 cells (the 12 anchor-blocks per side); slightly
  // brighter at the domain seams (36 = parents A·B·C | A1-3, 72 = | B1-3, 108 = | C1-3). Additive
  // and dim — structure for the eye, never competing with the heat.
  // THE SHORTLEX-3 ZONE OVERLAY (operator, Jun 11 — opt-in, gated behind shortlexZones /
  // env PMU_SHORTLEX_ZONES=1 so current callers are unchanged): grey lines at the TRUE
  // three-length ShortLex zone boundaries — x=y=3 (end of length-1: A,B,C) and x=y=12 (end of
  // length-2: A1..C3) slightly brighter, then the sub-boundaries within [12,144) at each
  // length-2 parent's child-block start. ALL boundaries are COMPUTED from
  // data/pmu/shortlex-144-registry.json (never hardcoded — the child allocation is data-driven:
  // 132 does not divide by 9). This overlay shows where dots WILL belong under the new axis, so
  // the operator can verify the three nested diagonal zones (3×3 dot · 9×9 · 132×132 crystal
  // lattice) against current images before the axis itself migrates.
  const addShortlexZones = (rgba) => shortlexZones ? shortlexZoneOverlay(rgba) : rgba;
  // OPERATOR (Jun 11 screenshots): "the one with GREY LINES is correct — make all of them so."
  // The strong zone seams (gain 3, the projection row's look) go on EVERY panel; the faint
  // addBlockGrid remains only as the registry-missing fallback.
  const greyZones = (rgba) => { try { return shortlexZoneOverlay(rgba, loadRegistry(), { gain: 3 }); } catch { return addBlockGrid(rgba); } };
  const addBlockGrid = (rgba) => {
    const faint = 14, seam = 26, isSeam = (k) => k === 36 || k === 72 || k === 108;
    for (let k = 12; k < N; k += 12) {
      const a = isSeam(k) ? seam : faint;
      for (let t = 0; t < N; t++) {
        const o1 = (k * N + t) * 4, o2 = (t * N + k) * 4;   // horizontal + vertical line at k
        for (const o of [o1, o2]) { rgba[o] = Math.min(255, rgba[o] + a); rgba[o + 1] = Math.min(255, rgba[o + 1] + a); rgba[o + 2] = Math.min(255, rgba[o + 2] + a); }
      }
    }
    return addShortlexZones(rgba);   // existing 12-block default stays; zones only when opted in
  };
  // ONE pixel cell for every crosshair: the explicit option wins, cole.pixelCell is the fallback.
  // (markPixel is module-level now — the localization gradient panel reuses the same crosshair.)
  const pxCell = pixelCell ?? (cole && cole.pixelCell != null ? cole.pixelCell : null);
  let panels, shape = null;
  if (hasEdges) {
    shape = deltaCloudRgba(cole.intent.matrix, cole.reality.matrix);
    panels = [
      { id: 'intent', lbl: 'INTENT · leaf-walk clouds · BLUE→VIOLET by ply (◎ = the competence pixel: actor∩patient)', color: '#7c8cff', rgba: greyZones(markPixel(cloudSplatRgba(cole.intent.matrix, cole.intent.mPly, { pal: PLY_PAL_INTENT }), pxCell)) },
      { id: 'reality', lbl: 'REALITY · leaf-walk clouds · ORANGE→RED by ply (◎ = the same pixel — the shared perspective)', color: '#ff7a3d', rgba: greyZones(markPixel(cloudSplatRgba(cole.reality.matrix, cole.reality.mPly, { pal: PLY_PAL_REALITY }), pxCell)) },
      { id: 'delta', lbl: `DELTA · graded cloud divergence (green agree · magenta declared-not-done · amber done-not-declared) · ${shape.matchPct}% agree`, color: '#2ecf6f', rgba: greyZones(markPixel(shape.rgba, pxCell)) },
      { id: 'tolerance', lbl: `TOLERANCE · cloud topology (dim green in-shape · hot amber bleed · red orthogonal concentration)${tol.tooMany ? ' · ⚠ TOO MANY' : ''}`, color: tol.tooMany ? '#ff3b3b' : '#2ecf6f', rgba: greyZones(markPixel(tol.rgba, pxCell)) },
    ];
  } else if (cole && cole.intent && cole.reality && cole.intent.ply) {
    shape = shapeMatch144(cole.intent.ply, cole.reality.ply);
    panels = [
      { id: 'intent', lbl: 'INTENT · definer walk (ply×freq)', color: '#66fcf1', rgba: definerWalkRgba(cole.intent.ply, cole.intent.heat) },
      { id: 'reality', lbl: 'REALITY · definer walk (ply×freq)', color: '#fbbf24', rgba: definerWalkRgba(cole.reality.ply, cole.reality.heat) },
      { id: 'delta', lbl: `DELTA · shape match ${shape.matchPct}%`, color: '#2ecf6f', rgba: shape.rgba },
      { id: 'tolerance', lbl: `TOLERANCE${tol.tooMany ? ' · ⚠ TOO MANY' : ''}`, color: tol.tooMany ? '#ff3b3b' : '#2ecf6f', rgba: tol.rgba },
    ];
  } else {
    panels = [
      { id: 'intent', lbl: 'INTENT', color: '#00d4ff', rgba: decodeToRgba(intentB64, [0, 212, 255]) },
      { id: 'reality', lbl: 'REALITY', color: '#fbbf24', rgba: decodeToRgba(realityB64, [251, 191, 36]) },
      { id: 'delta', lbl: 'DELTA (XOR)', color: '#ef4444', rgba: decodeToRgba(frictionB64, [239, 68, 68]) },
      { id: 'tolerance', lbl: `TOLERANCE${tol.tooMany ? ' · ⚠ TOO MANY' : ''}`, color: tol.tooMany ? '#ff3b3b' : '#2ecf6f', rgba: tol.rgba },
    ];
  }
  // ── PRE-WALK SENSE PANELS (operator, Jun 11: "the straight comparison of the 2 ingested grids —
  // not the walk, no point of view — the clearest expression of whether the ShortRank works,
  // because it's simply the algorithm; the definer steps are implied in it"). The raw binary sense
  // grids, exactly as the decompose lit them: snapshot of INTENT, snapshot of REALITY, and their
  // straight comparison. The two SNAPSHOTS stay crosshair-free (a crosshair IS a point of view);
  // the COMPARISON panel gets the competence-pixel crosshair (operator dictation, Jun 11: "so you
  // can see where the chosen pixel sits in the raw overlap"). Boundary grid YES on all three (the
  // ShortRank structure is what these panels exist to check).
  let preWalkCount = 0, preWalk = null;
  if (rawGrids && rawGrids.intent && rawGrids.reality) {
    const gi = rawGrids.intent, gr = rawGrids.reality;
    const rawRgba = (g, rgb) => { const r = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { const o = i * 4; if (g[i]) { r[o] = rgb[0]; r[o + 1] = rgb[1]; r[o + 2] = rgb[2]; } else { r[o] = 5; r[o + 1] = 5; r[o + 2] = 5; } r[o + 3] = 255; } return r; };
    const cmp = new Uint8Array(CELLS * 4); let both = 0, io = 0, ro = 0;
    for (let i = 0; i < CELLS; i++) {
      const o = i * 4; let col = null;
      if (gi[i] && gr[i]) { col = [46, 207, 111]; both++; } else if (gi[i]) { col = [0, 180, 220]; io++; } else if (gr[i]) { col = [230, 160, 40]; ro++; }
      if (col) { cmp[o] = col[0]; cmp[o + 1] = col[1]; cmp[o + 2] = col[2]; } else { cmp[o] = 5; cmp[o + 1] = 5; cmp[o + 2] = 5; }
      cmp[o + 3] = 255;
    }
    const rawPct = (both + io + ro) ? Math.round(100 * both / (both + io + ro)) : 0;
    preWalk = { both, io, ro, rawPct };
    panels.unshift(
      { id: 'raw-intent', lbl: 'PRE-WALK SENSE \u00b7 INTENT grid \u2014 the snapshot, no point of view', color: '#00d4ff', rgba: greyZones(rawRgba(gi, [0, 212, 255])) },
      { id: 'raw-reality', lbl: 'PRE-WALK SENSE \u00b7 REALITY grid \u2014 the snapshot, no point of view', color: '#fbbf24', rgba: greyZones(rawRgba(gr, [251, 191, 36])) },
      { id: 'raw-compare', lbl: `PRE-WALK \u0394 \u00b7 straight comparison of the two ingested grids (green both \u00b7 cyan intent-only \u00b7 amber reality-only) \u00b7 ${rawPct}% overlap \u00b7 \u25ce = where the competence pixel sits in the raw overlap`, color: '#2ecf6f', rgba: greyZones(markPixel(cmp, pxCell)) },
    );
    preWalkCount = 3;
  }
  // ── THE SHORTLEX-3 PROJECTION ROW (operator, Jun 11: "the commit images still lack the
  // three-length") — the commit's OWN corpora projected in the NEW 144-NAME coordinate system
  // (shortlexLattice: ABC · A1..C3 · the 132 children). A DIFFERENT coordinate system from the
  // pair lattice above, so: the zone seams are ALWAYS drawn here (they are the point of this row)
  // and the 12-block pair grid + AX12 axis strips stay OFF (pair-coordinate labels on name-coordinate
  // panels would lie). Zone 3 = CANDIDATE children, pre-ratchet — labeled honestly, never painted over.
  let shortlexInfo = '';
  if (shortlex && shortlex.intentGrid && shortlex.realityGrid && shortlex.registry) {
    const reg = shortlex.registry;
    const ov = (rgba) => shortlexZoneOverlay(rgba, reg, { gain: 3 });
    const slGrid = (g, rgb) => { const r = new Uint8Array(CELLS * 4); for (let i = 0; i < CELLS; i++) { const o = i * 4; if (g[i]) { r[o] = rgb[0]; r[o + 1] = rgb[1]; r[o + 2] = rgb[2]; } else { r[o] = 5; r[o + 1] = 5; r[o + 2] = 5; } r[o + 3] = 255; } return r; };
    const gi2 = shortlex.intentGrid, gr2 = shortlex.realityGrid;
    const cmp2 = new Uint8Array(CELLS * 4); let slBoth = 0, slIo = 0, slRo = 0;
    for (let i = 0; i < CELLS; i++) {
      const o = i * 4; let col = null;
      if (gi2[i] && gr2[i]) { col = [46, 207, 111]; slBoth++; } else if (gi2[i]) { col = [0, 180, 220]; slIo++; } else if (gr2[i]) { col = [230, 160, 40]; slRo++; }
      if (col) { cmp2[o] = col[0]; cmp2[o + 1] = col[1]; cmp2[o + 2] = col[2]; } else { cmp2[o] = 5; cmp2[o + 1] = 5; cmp2[o + 2] = 5; }
      cmp2[o + 3] = 255;
    }
    const slPct = (slBoth + slIo + slRo) ? Math.round(100 * slBoth / (slBoth + slIo + slRo)) : 0;
    if (panels[0]) panels[0].rowLabel = 'PAIR LATTICE (the map we normally see)';
    panels.push(
      { id: 'sl-intent', lbl: 'PROJECTED INTENT · the commit’s claims, head→axis_i tail→axis_j (cyan)', color: '#00d4ff', slAxes: true, rowLabel: 'SHORTLEX-3 PROJECTION (ABC · A1..C3 · the 132 children — candidate, pre-ratchet)', rgba: ov(slGrid(gi2, [0, 212, 255])) },
      { id: 'sl-reality', lbl: 'PROJECTED REALITY · same projection law (amber)', color: '#fbbf24', slAxes: true, rgba: ov(slGrid(gr2, [251, 191, 36])) },
      { id: 'sl-compare', lbl: `STRAIGHT COMPARISON · green both · cyan intent-only · amber reality-only · ${slPct}% overlap`, color: '#2ecf6f', slAxes: true, rgba: ov(cmp2) },
    );
    const zi2 = shortlex.zi, zr2 = shortlex.zr;
    const occLine = (side, o2) => o2 ? `<b>${side}</b>: ${o2.z1} in the 3×3 ABC corner · ${o2.z2} in the 9×9 A1..C3 square · ${o2.z3} in the ${N - o2.b2}×${N - o2.b2} children square · ${o2.cross} cross-zone` : '';
    shortlexInfo = `<div style="font-size:11.5px;color:#8b98a5;line-height:1.7;margin:2px 0 12px;padding:8px 11px;background:#0a0f17;border-left:3px solid #45a29e;border-radius:5px;text-align:left">
<span style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.14em;color:#45a29e;text-transform:uppercase">shortlex-3 zone occupancy (lit cells per diagonal square)</span><br>
${occLine('INTENT', zi2)}<br>${occLine('REALITY', zr2)}<br>
<span style="color:#8b98a5">axes: identical 144 ShortLex names both sides (symmetric); weights asymmetric</span><br>
<span style="color:#5a6673">zone 3 = candidate children, pre-ratchet (repo-derived dumps not yet past the perturbation-probe gate) · ${shortlex.intentMeta ? `intent ${shortlex.intentMeta.claims} claims @ θ ${shortlex.intentMeta.theta} · ` : ''}${shortlex.realityMeta ? `reality ${shortlex.realityMeta.claims} claims @ θ ${shortlex.realityMeta.theta} · ` : ''}projection ${shortlex.ms != null ? `${shortlex.ms}ms` : '—'}</span></div>`;
  } else if (shortlex && shortlex.note) {
    shortlexInfo = `<div style="font-size:11.5px;color:#e0a020;margin:2px 0 12px;padding:7px 10px;background:#1a1408;border-radius:5px;text-align:left">SHORTLEX-3 PROJECTION row skipped — ${String(shortlex.note).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
  }
  // UNIQUE cid per send (sha + nonce): Gmail caches/dedupes inline images by Content-ID, so static
  // names like trip-intent.png make it hide "unchanged" panels across emails. A unique suffix fixes it.
  const sfx = cidSuffix ? `-${cidSuffix}` : '';
  const pngs = panels.map(p => ({ name: `trip-${p.id}${sfx}.png`, buf: rgbaToPng(p.rgba) }));
  const dataUris = panels.map(p => rgbaToPngDataUri(p.rgba));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const T = (k) => timings[k] != null ? `${timings[k]}ms` : '—';
  const timingRow = `<div style="font-family:ui-monospace,monospace;font-size:11px;color:#8b98a5;margin:8px 0;padding:7px 10px;background:#0b0f17;border-radius:5px">
    ⏱ <b style="color:#66fcf1">ingest</b> ${T('ingest')} <span style="color:#5a6673">(corpus→lattice)</span> · <b style="color:#66fcf1">definer walk</b> ${T('walk')} <span style="color:#5a6673">(row→transpose→row, ballistic XOR per hop)</span> · <b style="color:#fff">total ${T('total')}</b><br><span style="color:#5a6673">ingest here = commit-scoped SENSING only (this commit's message + changed files → lit anchors) — deep seed authoring lives in the reef-self-loop, off the commit path</span></div>`;
  const tolRow = `<div style="font-size:12px;color:#8b98a5;line-height:1.55;margin-top:4px">
    <b>Three-colour tolerance</b> (out-of-lane = reality fires where intent is weak, in orthogonal blocks): <span style="color:#2ecf6f">green</span>=in-lane agreement · <span style="color:#ffb000">amber</span>=a few out-of-lane (tolerated) · <span style="color:#ff3b3b">red</span>=<b>${tol.tooMany ? 'FIRED' : 'armed'}</b> — orthogonal out-of-lane <b>${tol.offPct}%</b> vs tolerance <b>${killTolerancePct}%</b>.<br>
    <b style="color:#2ecf6f">${tol.green}</b> green · <b style="color:#ffb000">${tol.amber}</b> amber · <b style="color:#ff3b3b">${tol.red}</b> red · ${friction} XOR-friction cells.</div>`;
  const ctxRow = (message || files.length) ? `<details style="margin-top:8px"><summary style="font-size:11px;color:#45a29e;cursor:pointer">commit context — ${files.length} file(s)</summary><pre style="font-size:11px;color:#9aa;background:#0b0f17;padding:8px 10px;border-radius:5px;white-space:pre-wrap;overflow-x:auto;margin:5px 0">${esc(message).slice(0, 1200)}\n\n${esc(files.join('\n'))}</pre></details>` : '';
  // TILE DUMP — what the SimHash matched on the diagonal (A,A … C3,C3), so the sensor can't hide nonsense.
  const tileRows = (tiles || []).map(t => `<div style="border-bottom:1px solid #141a26;padding:5px 0;font-size:11px">
    <div><code style="color:#fcd34d">${esc(t.coord)}</code> <span style="color:#7a8693">${esc(t.meaning)}</span></div>
    <div style="margin-left:6px"><span style="color:#00d4ff">intent</span> ${t.intentSim ? `<span style="color:#5a6673">${t.intentSim}%</span> ` : ''}${t.intent ? esc(t.intent) : '<span style="color:#5a6673">—</span>'}</div>
    <div style="margin-left:6px"><span style="color:#fbbf24">reality</span> ${t.realitySim ? `<span style="color:#5a6673">${t.realitySim}%</span> ` : ''}${t.reality ? esc(t.reality) : '<span style="color:#5a6673">—</span>'}</div></div>`).join('');
  // COLLAPSED by default (operator, 2026-06-12: the phone reader flagged the open dump as raw-data
  // overload — AR-10 inspectability is preserved, one tap away, but it no longer costs a screen).
  const tilesDump = tileRows ? `<details style="margin-top:8px"><summary style="font-size:11px;color:#45a29e;cursor:pointer">tile dump — what the SimHash matched on the diagonal (inspect the sensor; tap to expand)</summary><div style="background:#0b0f17;padding:8px 10px;border-radius:5px;margin:5px 0">${tileRows}</div></details>` : '';

  // the 12 canonical ShortLex lanes (both axes), in order — so you can READ which row/lane drifts.
  const AX12 = AXES12;
  const AX_NAME = AX_NAME12;
  const IMG = 560;   // panel display size — FULL email-column width (operator 2026-06-18: "the triptych
  // images need to be full width of the column"). The axis strips scale with this px (top strip = IMG, left
  // gutter fixed 36px), so frame total = 36 + IMG = 596 inside the 600px block; Gmail mobile scales the whole
  // fixed-px table to the viewport as a unit, so image + strips stay aligned (no max-width:100% mismatch).
  // ORIENTATION — one line, governs every panel below (all panels render the same row-major
  // i·144+j buffers, so the story is identical everywhere). The walk panels' upper-triangle skew
  // is REAL, not a mirror bug: probed 2026-06-11, the raw sense grids are ~symmetric (above/below
  // within ~2%) while the walk concentrates ~2:1 above the diagonal because the guided follow is
  // ShortLex-ASCENDING — definer chains migrate to early-ranked ACTOR rows acting on later-ranked
  // patients (the definer-of-definer runs uphill in rank; its objects spread downhill).
  const legend = `<div style="font-size:11px;color:#8b98a5;margin:6px 0 4px;line-height:1.7"><b style="color:#c9d1d9">rows = ACTOR (lens) · cols = PATIENT (object) · diagonal = self-reference; ◎ at actor-row × patient-col</b> — every panel, same orientation. Heat above the diagonal = actors ranking ShortLex-earlier than their patients (the walk follows definers uphill in rank).<br>The 12 canonical lanes (rows top→bottom, cols left→right): ${AX12.map(a => `<b style="color:#9aabb5">${a}</b>·${AX_NAME[a]}`).join(' · ')}</div>`;
  const pr = tol.perRow || [];
  const worstIdx = pr.length ? pr.indexOf(Math.max(...pr)) : -1;
  const laneRead = (worstIdx >= 0 && Math.max(...pr) > 0)
    ? `<div style="font-size:12.5px;color:#e0a020;margin:6px 0;padding:6px 10px;background:#1a1408;border-radius:5px">Most out-of-lane row: <b style="color:#ffce6b">${AX12[worstIdx]} · ${AX_NAME[AX12[worstIdx]]}</b> — that lane is drifting most (read the red band in that row).</div>` : '';

  // LEFT + TOP axis (the 12 lanes, both sides of every panel) — spec #2 UX: the pair panels use
  // the SAME proportional strip mechanism as the ShortLex-3 row (pairAxisStrip: tinted bands,
  // explicit integer width attrs summing exactly to IMG, the same 36px left column), so every
  // image in the email reads the same way and the strips survive mobile Gmail without displacing.
  // OPERATOR (Jun 11, screenshot): "all of them need the 144 axis" — the pair-anchor positions
  // coincide with the registry indices (the canon reconciliation), so EVERY panel carries the
  // proven 144 strip (ABC · A1–C3 · child ranges); the 12-label pairAxisStrip is only the
  // fallback when the registry is absent. (The 12-label top strip also collapsed its labels
  // into one corner on the phone — the 144 strip is the one verified correct.)
  let pairAx;
  try { pairAx = shortlexAxisStrip(loadRegistry(), IMG); } catch { pairAx = pairAxisStrip(IMG); }
  const LBL_W = pairAx.width;
  const leftAxis = pairAx.left;
  const topAxis = pairAx.top;
  // SHORTLEX-3 axis strips for the projection row — built from the SAME registry the panels were
  // projected with (one label list, both sides: top and left carry IDENTICAL labels so the
  // operator can check the axes against each other — the symmetry is the point).
  const slAx = (shortlex && shortlex.registry && shortlex.intentGrid) ? shortlexAxisStrip(shortlex.registry, IMG) : null;
  // ROW LABELS (operator: the email carries TWO coordinate systems — say so out loud): a heavier
  // divider before a panel that opens a row, so PAIR LATTICE vs SHORTLEX-3 PROJECTION never blur.
  const rowLbl = (t) => `<div style="margin:18px 0 10px;padding:7px 10px;background:#0c1320;border-left:3px solid #66fcf1;border-radius:5px;font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.14em;color:#66fcf1;text-transform:uppercase;text-align:left">${esc(t)}</div>`;
  const mk = (srcs) => {
    // slAxes panels live in the ShortLex-3 NAME coordinate system — the AX12 pair-axis strips
    // would be the wrong labels there, so they carry their OWN proportional strips
    // (shortlexAxisStrip: ABC · A1–C3 · per-parent child ranges), identical top and left so the
    // operator can verify the axes are symmetric. Bare image only if the strips can't be built.
    // NO max-width:100% inside the strip frame: the strips carry fixed integer widths, so a
    // shrinking image beside them is exactly the phone displacement spec #2 fixes. 596px total
    // (36px gutter + 560px image) = the full 600px email column; Gmail scales the whole fixed-px
    // table to the phone viewport as ONE unit, so image + strips stay aligned (the displacement
    // bug was max-width:100% scaling the image but NOT the strips — avoided by keeping all px).
    const slImg = (i, p) => `<img src="${srcs[i]}" width="${IMG}" height="${IMG}" alt="${p.lbl} 144×144 (axes = identical 144 ShortLex-3 names both sides)" style="image-rendering:pixelated;background:#000;border-radius:4px;border:1px solid #1a2230;display:block"/>`;
    const frame = (ax, topStrip, leftStrip, inner) => `<table width="${ax.width + IMG}" cellpadding="0" cellspacing="0" style="width:${ax.width + IMG}px;margin:0 auto;table-layout:fixed;border-collapse:collapse"><tr><td width="${ax.width}" style="width:${ax.width}px;padding:0"></td><td width="${IMG}" style="width:${IMG}px;padding:0">${topStrip}</td></tr><tr>${leftStrip}<td width="${IMG}" style="width:${IMG}px;padding:0">${inner}</td></tr></table>`;
    // SPEC #3: every panel label carries its one-clause "what does good look like here?" caption
    // from the ONE shared legend (panelCaption) — wording cannot drift per surface.
    const cap = (p) => { const c = panelCaption(p.id); return c ? `<div style="font-size:10.5px;font-weight:400;color:#8b98a5;margin-top:1px">${esc(c)}</div>` : ''; };
    const panel = (i, p) => `${p.rowLabel ? rowLbl(p.rowLabel) : ''}<div style="text-align:center;margin:0 0 16px">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:${p.color};margin-bottom:4px">${p.lbl}${cap(p)}</div>
${p.slAxes
    ? (slAx
        ? frame(slAx, slAx.top, slAx.left, slImg(i, p))
        : slImg(i, p))
    : frame(pairAx, topAxis, leftAxis, `<img src="${srcs[i]}" width="${IMG}" height="${IMG}" alt="${p.lbl} 144×144 (axes = the 144 ShortLex anchors on both sides)" style="image-rendering:pixelated;background:#000;border-radius:4px;border:1px solid #1a2230;display:block"/>`)}</div>`;
    return `<div style="font-family:-apple-system,system-ui,sans-serif;color:#c9d1d9;max-width:600px;margin:0 auto">
${label ? `<div style="font-size:13px;color:#66fcf1;margin:0 0 2px">${esc(label)}</div>` : ''}
${sub ? `<div style="font-size:12px;color:#8b98a5;margin:0 0 6px">${esc(sub)}</div>` : ''}
${timingRow}${legend}
${panels.map((p, i) => panel(i, p) + (pixelStatementHtml && i === preWalkCount - 1 ? pixelStatementHtml : '')).join('')}${shortlexInfo}
${cole && cole.matchSigma != null ? `<div style="font-size:12px;color:#66fcf1;margin:6px 0;padding:6px 10px;background:#0a1418;border-radius:5px">SHAPE-MATCH <b>σ = ${cole.matchSigma}</b> — the real intent↔reality definer walk vs random-reality (actual ${cole.actualMatch} vs random ${cole.impMean}). >0 = the walk distinguishes real alignment from noise; aggregate over independent walks → the divergent series.<br><span style="color:#8b98a5">${esc(legendLine(sigmaType, cole.matchSigma))}</span></div>` : ''}
${laneRead}${tolRow}
<div style="font-size:11px;color:#5a6673;margin-top:6px;line-height:1.5">Both axes = the 144 ShortLex anchors, cell=row⊕col, on the chip. <span style="color:#00d4ff">INTENT</span>=docs+rules · <span style="color:#fbbf24">REALITY</span>=code · <span style="color:#ef4444">DELTA</span>=friction.</div>
${tilesDump}${ctxRow}</div>`;
  };
  return { dataHtml: mk(dataUris), cidHtml: mk(pngs.map(p => `cid:${p.name}`)), pngs, tol, friction, preWalk };
}
// back-compat: data-URI HTML only (for callers that just want a self-contained block)
export function renderTriptychHtml(opts) { return renderTriptych(opts).dataHtml; }
