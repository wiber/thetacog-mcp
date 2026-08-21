#!/usr/bin/env node
// scripts/pmu/annotate-regions.mjs — encircle the colored regions ON THE TOLERANCE PANEL.
//
// The tolerance panel is the one that carries colored regions: GREEN (reality landed in the
// lane intent declared), AMBER (a lane or two off — bleed), RED (orthogonal drift — execution
// fired where nothing was declared). This finds each colored CLUSTER and draws an ellipse in
// that cluster's OWN colour, numbers it, and narrates what it means + how the input made it.
// Per-colour, pipeline-native, reusable (detectColorRegions exported).
//
//   npx thetacog-mcp annotate                     # live pipeline → tolerance panel, regions encircled in colour
//   npx thetacog-mcp annotate --intent "…" --reality "…"
//   npx thetacog-mcp annotate --demo              # synthetic mixed panel (green+amber+red) to show all three
//
// Approach (two passes, so thin LINES survive):
//   A. LINE PASS — at CELL resolution, find thin horizontal/vertical drift streaks (red/amber). A
//      streak is the canonical lattice INVARIANT (one actor-row fired across every patient-column, or
//      one patient-column hit from every actor-row). It would otherwise die at block-majority (a
//      1-cell-tall line is a minority inside a 12-cell block), so we detect + claim it FIRST.
//   B. BLOB PASS — classify each remaining cell by hue, reduce to the 12×12 block grid (MAJORITY,
//      or an absolute floor for the rare DRIFT colours), then density-peak cluster same-colour blocks
//      and bound each with an ellipse in that colour. Block-level keeps the blob regions legible.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { regionShortLex } from './shortlex-coords.mjs';
import { coordGist } from './lattice-meaning.mjs';   // Step 1: meaning taken FROM the 144-coord lattice
import { sliceMessageToRegions } from './region-message.mjs';   // commit-message slice per oval (gzip)

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const OUT = resolve(REPO, 'docs/pmu/annotated-tolerance.html');
const N = 144, B = 12, NB = N / B;
const DRIFT_ABS = 6;   // a block with ≥ this many cells of a rare DRIFT colour claims it WITHOUT a majority
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

// ── BURNED-IN ENCIRCLE PNG ───────────────────────────────────────────────────
// The HTML render() overlays the ellipses as SVG; the bearer drift-receipt needs a STANDALONE
// PNG that carries the shape-match in the pixels themselves (CID-inline, recomputable, forwardable).
// We upscale the tolerance panel and burn each region's ellipse RING + a numbered disc in the
// region's own colour, so the green/amber/red SHAPES — not center points — are what the eye reads.
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function pngChunk(type, data) { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([t, data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function pngFromRgba(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; src.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
const FONT3x5 = { '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7] };
function drawText(out, w, h, x, y, str, col, sc) {
  let cx = x;
  for (const ch of String(str)) { const g = FONT3x5[ch]; if (g) for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++) if ((g[ry] >> (2 - rx)) & 1) for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const px = cx + rx * sc + dx, py = y + ry * sc + dy; if (px >= 0 && py >= 0 && px < w && py < h) { const o = (py * w + px) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255; } } cx += 4 * sc; }
}
// rgba tolerance panel (144×144) + detected regions → upscaled RGBA with the rings burned in.
export function encircleRegionsRgba(src144, regions, SC = 4) {
  const w = N * SC, h = N * SC, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const so = (Math.floor(y / SC) * N + Math.floor(x / SC)) * 4, o = (y * w + x) * 4; out[o] = Math.floor(src144[so] * 0.62); out[o + 1] = Math.floor(src144[so + 1] * 0.62); out[o + 2] = Math.floor(src144[so + 2] * 0.62); out[o + 3] = 255; }
  const plot = (x, y, col) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255; };
  for (const r of regions) {
    const col = KIND[r.kind].draw, e = r.ellipse, cx = e.cx * SC, cy = e.cy * SC, rx = e.rx * SC, ry = e.ry * SC;
    const steps = Math.max(120, Math.floor(2 * Math.PI * Math.max(rx, ry)));
    for (let s = 0; s < steps; s++) { const th = 2 * Math.PI * s / steps, px = cx + rx * Math.cos(th), py = cy + ry * Math.sin(th); for (let t = -1; t <= 1; t++) for (let u = -1; u <= 1; u++) plot(px + t, py + u, col); }
    const mx = cx, my = cy - ry;                                        // numbered disc rides the ring's top
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dy * dy <= 64) plot(mx + dx, my + dy, col);
    drawText(out, w, h, Math.round(mx) - 3, Math.round(my) - 5, String(r.n), [8, 10, 16], 2);
  }
  return { rgba: out, w, h };
}
export function encircleRegionsPng(src144, regions, { scale = 4 } = {}) { const { rgba, w, h } = encircleRegionsRgba(src144, regions, scale); return pngFromRgba(rgba, w, h); }

// ── COVERAGE-DRIVEN ENCIRCLEMENT — DENSITY-PEAK / MAXIMUM-COVERAGE (operator 2026-06-27, BUG 2 fix) ──
// The connectivity clusterer (detectColorRegions) fragments a colour into MANY shapes. This answers the
// real question: for EACH colour, what is the FEWEST set of ellipses whose union encircles ~TARGET% of
// that colour's pixels, each ellipse landing ON a density peak and TIGHTLY wrapping its cluster?
//
// The formal recipe (greedy partial set-cover + density-peak seeding + tight enclosing ellipse):
//   1. SEED at a DENSITY PEAK among the UNCOVERED same-colour pixels — a true mean-shift MODE: start at
//      the densest pixel (most same-colour neighbours in a peakR window) then WALK the seed to the local
//      centroid a few steps until it settles on the mode. (Old code took the raw densest pixel and never
//      shifted → the seed sat on a cluster EDGE, not its peak.)
//   2. GROW the cluster by REGION-GROWING from the mode over uncovered same-colour pixels, linking any
//      pixel within `linkR` of one already in the cluster. SMALL linkR is the whole point: the grow HALTS
//      at the empty saddle between two blobs, so two separated clusters become TWO shapes. (Old code took
//      every pixel within a FIXED growR=20 ball of the seed → it swept across the gap and FUSED two
//      clusters into one panel-spanning ellipse → "the density part is not working".)
//   3. FIT a TIGHT axis-aligned ENCLOSING ellipse: covariance gives the SHAPE (rx0:ry0 from the per-axis
//      std-dev), then scale it by the max normalized radius over the cluster so it JUST encloses every
//      cluster pixel (a practical Löwner–John / minimum-volume enclosing ellipse, ×`enclose` margin).
//      (Old code used 1.6·std+2 padding → loose, neither tight nor guaranteed-enclosing.)
//   4. COVER every uncovered same-colour pixel inside the ellipse; repeat until TARGET% covered or the
//      shape cap is hit.
//   5. PURITY = same-colour / (same + OTHER-colour) inside the ellipse (background is not "other"). A
//      shape that must swallow other-colour pixels to gain coverage is a CONTESTED region; a scattered
//      colour with no real peak hits the cap WITHOUT reaching TARGET — that low coverage IS the honest
//      "there is no clean density spot here" signal.
//
// All tunables are explicit + documented so the geometry is inspectable, not magic.
export function coverageRegions(rgba, {
  target = null,       // when set, each ring is grown to enclose this fraction of ITS cluster's mass (so the UNION
                       //   over the colour approaches TARGET%) — the BUG-2 contract. Overrides coreFrac. null = use coreFrac.
  coreFrac = 0.6,      // each ring encircles this fraction of its cluster's MASS (the dense CORE), not all of it
  densityFrac = 0.20,  // DPC decision cut: a peak earns a ring only if its density ≥ this × the colour's STRONGEST peak
  densityAbs = 5,      // absolute density floor — a peak weaker than this is never a real epicentre
  maxPerColor = 5,     // safety cap on rings per colour (the threshold normally stops it first)
  minLit = 4,          // ignore a colour with fewer lit pixels than this (nothing to encircle)
  peakR = 6,           // mean-shift window (Chebyshev radius): density / centroid taken over this neighbourhood
  shiftIters = 5,      // mean-shift refinement steps — walk the seed to the local density MODE
  linkR = 2,           // region-grow link radius — SMALL so the grow stops at the gap between clusters
  enclose = 1.0,       // margin on the concentration ellipse (1.0 = exactly the coreFrac quantile)
  minR = 2.5,          // floor radius so a tiny cluster still draws a visible ring
} = {}) {
  const cls = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) { const o = i * 4; cls[i] = classify(rgba[o], rgba[o + 1], rgba[o + 2]); }
  const inEll = (c, r, e) => { const dx = (c + 0.5 - e.cx) / e.rx, dy = (r + 0.5 - e.cy) / e.ry; return dx * dx + dy * dy <= 1; };
  const regions = []; let n = 0;
  for (const k of [1, 2, 3]) {
    // `live` = lit same-colour pixels not yet claimed by a cluster.
    const live = new Uint8Array(N * N); let total = 0;
    for (let i = 0; i < N * N; i++) if (cls[i] === k) { live[i] = 1; total++; }
    if (total < minLit) continue;
    // density of a (r,c): count of live same-colour pixels in the peakR Chebyshev window.
    const density = (r, c) => { let d = 0; for (let dr = -peakR; dr <= peakR; dr++) for (let dc = -peakR; dc <= peakR; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < N && cc < N && live[rr * N + cc]) d++; } return d; };
    let shapes = 0, peak0 = -1, claimedCore = 0;
    while (shapes < maxPerColor) {
      // 1a. RANK the epicentres: the densest live pixel is the strongest remaining peak (DPC ρ-max).
      let seedR = -1, seedC = -1, bd = -1;
      for (let i = 0; i < N * N; i++) { if (!live[i]) continue; const r = (i / N) | 0, c = i % N; const d = density(r, c); if (d > bd) { bd = d; seedR = r; seedC = c; } }
      if (seedR < 0) break;
      if (peak0 < 0) peak0 = bd;
      // THRESHOLD: only a peak that clears the density cut earns a ring. Below it = scattered noise, no ring.
      if (bd < Math.max(densityAbs, densityFrac * peak0)) break;
      // 1b. mean-shift: walk the seed to the local density MODE (centroid of the live neighbourhood)
      let sr = seedR, sc = seedC;
      for (let it = 0; it < shiftIters; it++) {
        let mr = 0, mc = 0, m = 0;
        for (let dr = -peakR; dr <= peakR; dr++) for (let dc = -peakR; dc <= peakR; dc++) { const rr = sr + dr, cc = sc + dc; if (rr >= 0 && cc >= 0 && rr < N && cc < N && live[rr * N + cc]) { mr += rr; mc += cc; m++; } }
        if (!m) break; const nr = Math.round(mr / m), nc = Math.round(mc / m); if (nr === sr && nc === sc) break; sr = nr; sc = nc;
      }
      if (!live[sr * N + sc]) { let bdist = Infinity, br = -1, bc = -1; for (let dr = -peakR; dr <= peakR; dr++) for (let dc = -peakR; dc <= peakR; dc++) { const rr = sr + dr, cc = sc + dc; if (rr >= 0 && cc >= 0 && rr < N && cc < N && live[rr * N + cc]) { const dd = dr * dr + dc * dc; if (dd < bdist) { bdist = dd; br = rr; bc = cc; } } } if (br >= 0) { sr = br; sc = bc; } else { sr = seedR; sc = seedC; } }
      // 2. region-grow the cluster from the mode (links within linkR; stops at the inter-cluster gap)
      const cluster = []; const stack = [[sr, sc]]; const seen = new Set([sr * N + sc]);
      while (stack.length) {
        const [r, c] = stack.pop(); cluster.push([r, c]);
        for (let dr = -linkR; dr <= linkR; dr++) for (let dc = -linkR; dc <= linkR; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue; const key = rr * N + cc; if (live[key] && !seen.has(key)) { seen.add(key); stack.push([rr, cc]); } }
      }
      // 3. CONCENTRATION ELLIPSE — covariance gives the SHAPE; scale to the coreFrac MASS quantile of the
      //    cluster so the ring hugs the DENSE CORE (~50-60%), not the scattered tail. (The old code scaled
      //    to the MAX radius = enclose-everything; that is what made the rings sprawl.)
      let mr = 0, mc = 0; for (const [r, c] of cluster) { mr += r; mc += c; }
      const cy = mr / cluster.length + 0.5, cx = mc / cluster.length + 0.5;
      let vr = 0, vc = 0; for (const [r, c] of cluster) { vr += (r + 0.5 - cy) ** 2; vc += (c + 0.5 - cx) ** 2; }
      const rx0 = Math.max(minR, Math.sqrt(vc / cluster.length)), ry0 = Math.max(minR, Math.sqrt(vr / cluster.length));
      const dists = cluster.map(([r, c]) => Math.sqrt(((c + 0.5 - cx) / rx0) ** 2 + ((r + 0.5 - cy) / ry0) ** 2)).sort((a, b) => a - b);
      // radius scale `s`. coreFrac path: the coreFrac MASS quantile (tight dense core, unchanged default).
      // target path (BUG-2 contract): grow the ring to the SMALLEST shell whose ACTUALLY-enclosed pixel
      // fraction ≥ target, measured through the SAME inEll metric — because pixel-coverage-vs-radius is a
      // STEP function (footprint shells), a quantile INDEX undershoots (dists sort-position ≠ inEll count
      // under the minR clamp + float ties), so we measure and round UP to honour the requested coverage.
      const encloseCount = (ss) => { const rx = Math.max(minR, rx0 * ss * enclose), ry = Math.max(minR, ry0 * ss * enclose); let n2 = 0; for (const [r2, c2] of cluster) { const dx = (c2 + 0.5 - cx) / rx, dy = (r2 + 0.5 - cy) / ry; if (dx * dx + dy * dy <= 1) n2++; } return n2; };
      let s;
      if (target != null) {
        const need = Math.ceil(target * cluster.length);
        let gi = Math.min(dists.length - 1, Math.floor(target * dists.length));
        s = dists[gi] || 1;
        while (encloseCount(s) < need && gi < dists.length - 1) { gi++; s = dists[gi]; }   // grow through shells until ≥ target enclosed
        s *= (1 + 1e-9);   // nudge past the float boundary so the whole target shell is inside
      } else {
        s = dists[Math.min(dists.length - 1, Math.floor(coreFrac * dists.length))] || 1;   // the coreFrac mass quantile
      }
      const e = { cx, cy, rx: Math.max(minR, rx0 * s * enclose), ry: Math.max(minR, ry0 * s * enclose) };
      // 4. ONE ring per cluster: claim the WHOLE grown cluster (so the next seed finds a DIFFERENT epicentre),
      //    but the ring itself only encircles the coreFrac core.
      let core = 0; for (const [r, c] of cluster) { if (inEll(c, r, e)) core++; live[r * N + c] = 0; }
      claimedCore += core;
      // 5. purity — OTHER-colour pixels the ellipse swallowed (background class 0 is not "other")
      let other = 0; for (let r = 0; r < N; r++) for (let cc2 = 0; cc2 < N; cc2++) { const cc = cls[r * N + cc2]; if (cc === 0 || cc === k) continue; if (inEll(cc2, r, e)) other++; }
      // blockBox (12×12 block coords) → the ShortLex intersection that NAMES the region (B3,A2 ▸ C3,B3),
      // the field region-message + the email narrative read. Computed from the cluster's pixel extent.
      let R0 = N, R1 = 0, C0 = N, C1 = 0; for (const [r, c] of cluster) { if (r < R0) R0 = r; if (r > R1) R1 = r; if (c < C0) C0 = c; if (c > C1) C1 = c; }
      const blockBox = { r0: Math.floor(R0 / B), r1: Math.floor(R1 / B), c0: Math.floor(C0 / B), c1: Math.floor(C1 / B) };
      const coord = regionShortLex(blockBox);
      // coverage = the running UNION coverage over the colour's total pixels (claimedCore/total). It is
      // cumulative, so the LAST shape carries the final union fraction (Math.max over the shapes == final
      // coverage). Restored here — the density-peak refactor kept accumulating claimedCore but stopped
      // returning it, leaving x.coverage undefined for both callers (main --coverage + the BUG-2 guard).
      regions.push({ kind: k, n: ++n, ellipse: e, blockBox, coord, meaning: coordGist(coord.center), blocks: cluster.length, peakDensity: bd, coreInside: core, otherInside: other, purity: +(core / (core + other || 1)).toFixed(2), coverFrac: +(core / cluster.length).toFixed(2), coverage: +(claimedCore / total).toFixed(2) });
      shapes++;
    }
  }
  return regions;
}

// canonical tolerance hues (brightness-scaled in the panel) → class. `draw` = the BRIGHT ring colour
// the annotator burns on top (legible at thumbnail size); `hue` = the EXACT pixel the tolerance panel
// paints, used by classify as the matching anchor (see TOL_HUE below).
const KIND = { 1: { name: 'green', draw: [70, 211, 105], means: 'in lane — what the commit SAID matched what it DID here' },
               2: { name: 'amber', draw: [255, 176, 0], means: 'adjacent bleed — execution landed a lane or two off the declaration' },
               3: { name: 'red', draw: [255, 80, 80], means: 'orthogonal drift — it acted in a lane it never declared (the rupture)' } };

// ── THE COLOUR READER (BUG 1 fix, operator 2026-06-27) ───────────────────────────────────────────
// The region classifier and the tolerance panel's green/amber/red DECISION must agree exactly, or the
// instrument lies — "drift · N blocks" appears over a panel the tolerance count calls "0 red".
//
// SINGLE SOURCE OF TRUTH: the tolerance panel (triptych-render.mjs → decodeDeltaThreeColourEdges)
// paints ONLY these three hues, each brightness-scaled by v∈[0.45,1] over a near-black [5,5,5]
// background — AND it paints the RED hue ONLY when drift fires (`tooMany`). So an in-tolerance panel
// contains ZERO red-hued pixels. A classifier keyed on THESE anchors is therefore in lock-step with
// the count by construction: 0 red in the tolerance read ⇒ 0 red-hued pixels ⇒ 0 kind-3 cells.
const TOL_HUE = { 1: [30, 145, 80], 2: [255, 176, 0], 3: [255, 59, 59] };   // green · amber · red (EXACT render hues)
const BG_FLOOR = 14;          // max channel below this = unlit background → class 0
const MAX_HUE_DIST2 = 0.15;   // brightness-normalized squared chroma distance: beyond this a pixel is
                              // NOT one of the three tolerance hues. WHY this matters: the OLD cuts
                              // (g/r < 0.34 → red) IGNORED BLUE, so the cloud-DELTA magenta [255,45,215]
                              // and any purple with a collapsed green channel tipped into RED → phantom
                              // drift. Normalizing by the brightest channel drops brightness-scaling out
                              // and compares HUE only; the threshold rejects foreign hues (magenta/cyan/
                              // XOR-noise) so a panel that ISN'T the tolerance panel can't manufacture drift.
// normalize a colour to its brightest channel: brightness-scaling cancels, only the hue direction remains.
function chroma(r, g, b) { const m = Math.max(r, g, b) || 1; return [r / m, g / m, b / m]; }
const TOL_ANCHOR = Object.fromEntries(Object.entries(TOL_HUE).map(([k, c]) => [Number(k), chroma(...c)]));
// classify ONE pixel → nearest tolerance hue (1 green · 2 amber · 3 red) or 0 (background/foreign).
// Pure function; same anchor basis as the panel, so its decision cannot diverge from the tolerance count.
export function classify(r, g, b) {
  if (Math.max(r, g, b) < BG_FLOOR) return 0;                 // unlit background
  const [cr, cg, cb] = chroma(r, g, b);
  let best = 0, bd = Infinity;
  for (const k of [1, 2, 3]) { const a = TOL_ANCHOR[k]; const d = (cr - a[0]) ** 2 + (cg - a[1]) ** 2 + (cb - a[2]) ** 2; if (d < bd) { bd = d; best = k; } }
  return bd <= MAX_HUE_DIST2 ? best : 0;                      // too far from every tolerance hue → not a tolerance class
}

// LINE DETECTOR (cell resolution) — find thin horizontal/vertical streaks of colour k. A streak is a
// band of rows (or cols) that is WIDE (spans ≥ a third of the panel), reasonably FILLED along that
// span (a dotted line still counts), and THIN (≥3× longer than it is thick, so a square blob is NOT
// mistaken for a line — it falls through to the blob clusterer). Returns regions
// {kind,blocks,blockBox,ellipse,line,cells}; cells = the lit cells in the band, claimed so the blob
// pass skips them. This is the canonical line-first invariant read the tolerance VERDICT already speaks
// (triptych-render.mjs byRow/byCol motif), brought to cell resolution so 1-cell lines are not averaged away.
function detectLines(cls, k, { spanMin = 48, fillFrac = 0.25, fillMin = 8, mergeGap = 2, aspect = 3 } = {}) {
  const out = [];
  const scan = (orient) => {                                   // 'h' = rows of cols · 'v' = cols of rows
    const lines = [];
    for (let a = 0; a < N; a++) {
      const bs = [];
      for (let b = 0; b < N; b++) { const idx = orient === 'h' ? a * N + b : b * N + a; if (cls[idx] === k) bs.push(b); }
      if (!bs.length) continue;
      const lo = Math.min(...bs), hi = Math.max(...bs), span = hi - lo + 1;
      if (span >= spanMin && bs.length >= Math.max(fillMin, span * fillFrac)) lines.push({ a, lo, hi });
    }
    lines.sort((x, y) => x.a - y.a);                            // merge adjacent qualifying lines → one band
    let band = null;
    const flush = () => { if (band) { const reg = bandRegion(cls, k, orient, band, aspect); if (reg) out.push(reg); } band = null; };
    for (const ln of lines) {
      if (band && ln.a - band.aMax <= mergeGap && ln.lo <= band.hi && ln.hi >= band.lo) {
        band.aMax = ln.a; band.lo = Math.min(band.lo, ln.lo); band.hi = Math.max(band.hi, ln.hi);
      } else { flush(); band = { aMin: ln.a, aMax: ln.a, lo: ln.lo, hi: ln.hi }; }
    }
    flush();
  };
  scan('h'); scan('v');
  return out;
}
// build a band region from {aMin,aMax,lo,hi}. 'h': a=row, [lo,hi]=cols · 'v': a=col, [lo,hi]=rows.
function bandRegion(cls, k, orient, band, aspect) {
  const aLen = band.aMax - band.aMin + 1, bLen = band.hi - band.lo + 1;          // thickness × length
  if (bLen < aspect * aLen) return null;                                         // not thin enough → it's a blob, defer
  const r0c = orient === 'h' ? band.aMin : band.lo, r1c = orient === 'h' ? band.aMax : band.hi;   // cell rows
  const c0c = orient === 'h' ? band.lo : band.aMin, c1c = orient === 'h' ? band.hi : band.aMax;   // cell cols
  const cells = [];
  for (let r = r0c; r <= r1c; r++) for (let c = c0c; c <= c1c; c++) if (cls[r * N + c] === k) cells.push(r * N + c);
  const blockBox = { r0: Math.floor(r0c / B), r1: Math.floor(r1c / B), c0: Math.floor(c0c / B), c1: Math.floor(c1c / B) };
  const ellipse = { cx: (c0c + c1c + 1) / 2, cy: (r0c + r1c + 1) / 2, rx: (c1c - c0c + 1) / 2 + 3, ry: (r1c - r0c + 1) / 2 + 3 };
  // HONEST block count (operator 2026-06-27): the number of 12×12 blocks the region's LIT cells
  // actually occupy — NOT the bounding-box area. A thin streak across a wide box used to report the
  // box's block-span (e.g. "12 blocks") while only a few blocks were truly lit → "I see zero reds in
  // that zone." `blocks` now = distinct blocks the encircled colour really touches. Guarded by
  // tests/pmu-simulator/region-block-count-honest.test.mjs.
  const touched = new Set(cells.map((idx) => Math.floor(Math.floor(idx / N) / B) * NB + Math.floor((idx % N) / B)));
  const blocks = touched.size;
  const line = orient === 'h' ? { orient: 'horizontal', axis: 'actor', lane: blockBox.r0 } : { orient: 'vertical', axis: 'patient', lane: blockBox.c0 };
  return { kind: k, blocks, blockBox, ellipse, line, cells };
}

// EXPORTED, reusable: rgba tolerance panel → colored regions with ellipse geometry.
export function detectColorRegions(rgba, { minLit = 3 } = {}) {
  // 0. classify every CELL once (the line pass needs cell resolution; the block pass reuses it).
  const cls = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) { const o = i * 4; cls[i] = classify(rgba[o], rgba[o + 1], rgba[o + 2]); }
  const cellCount = [0, 0, 0, 0]; for (let i = 0; i < N * N; i++) cellCount[cls[i]]++;
  const dominant = [1, 2, 3].reduce((a, b) => (cellCount[b] > cellCount[a] ? b : a), 1);

  // A. LINE PASS (cell resolution, drift colours only). A thin horizontal/vertical streak is the
  //    canonical lattice INVARIANT and dies at block-majority reduction (a 1-cell line is a minority
  //    inside a 12-cell block), so detect it BEFORE blocking and CLAIM its cells so the blob pass
  //    neither swallows nor recircles it. Drift (red, then amber) only — a green streak is the
  //    in-lane diagonal carpet, not drift. Red first so a cell on a red∩amber crossing reads as drift.
  const claimed = new Set();
  const lineRegions = [];
  for (const k of [3, 2]) {
    if (k === dominant) continue;
    for (const L of detectLines(cls, k)) { lineRegions.push({ kind: k, blocks: L.blocks, blockBox: L.blockBox, ellipse: L.ellipse, line: L.line }); for (const idx of L.cells) claimed.add(idx); }
  }

  // B. BLOCK REDUCTION (excludes line-claimed cells). A clear MAJORITY claims the block, BUT a rare
  //    DRIFT colour (red/amber) claims it on an ABSOLUTE floor without a majority — requiring a
  //    majority is the wrong gate for the minority signal we most want to surface. A block that is
  //    half green / half amber with neither at floor is still left UNCLAIMED (no green-over-amber swallow).
  const blockKind = new Int8Array(NB * NB); // 0 none, 1/2/3
  const kindCount = [0, 0, 0, 0];
  for (let br = 0; br < NB; br++) for (let bc = 0; bc < NB; bc++) {
    const cnt = [0, 0, 0, 0];
    for (let r = br * B; r < br * B + B; r++) for (let c = bc * B; c < bc * B + B; c++) { const idx = r * N + c; if (claimed.has(idx)) continue; cnt[cls[idx]]++; }
    const lit = cnt[1] + cnt[2] + cnt[3];
    if (lit < minLit) continue;
    let k = 0;
    for (const dc of [3, 2]) if (dc !== dominant && cnt[dc] >= DRIFT_ABS) { k = dc; break; }   // drift override
    if (!k) { const kk = cnt[1] >= cnt[2] && cnt[1] >= cnt[3] ? 1 : cnt[2] >= cnt[3] ? 2 : 3; if (cnt[kk] / lit >= 0.55) k = kk; }
    if (!k) continue;
    blockKind[br * NB + bc] = k; kindCount[k]++;
  }
  // 2. DENSITY-PEAK CLUSTERING (Rodriguez & Laio 2014), per colour, on the block grid.
  //    Replaces the old erosion + 4-connect + ad-hoc K-core split (which merged touching clusters
  //    and dropped cores in arbitrary spots). Each cluster is ONE density peak: every block follows
  //    its nearest HIGHER-density neighbour up to a peak, so two adjacent dense blobs separate at the
  //    low-density saddle between them instead of fusing into one bounding ellipse. Cluster COUNT
  //    emerges from the data (a peak = high local density ρ AND far δ from any denser block); thin
  //    carpet (ρ below floor, not adjacent to a peak) is left un-circled as noise — but ONLY for the
  //    dominant colour. Minority amber/red (the DRIFT signal) keeps every patch, never thinned.
  const ell = (cells) => {
    const brs = cells.map((x) => x[0]), bcs = cells.map((x) => x[1]);
    const r0 = Math.min(...brs), r1 = Math.max(...brs), c0 = Math.min(...bcs), c1 = Math.max(...bcs);
    return { blockBox: { r0, r1, c0, c1 },
      ellipse: { cx: ((c0 + c1 + 1) / 2) * B, cy: ((r0 + r1 + 1) / 2) * B, rx: ((c1 - c0 + 1) * B) / 2 + 3, ry: ((r1 - r0 + 1) * B) / 2 + 3 } };
  };
  function densityPeak(cells, { R = 1, gap = 2, rhoFloor = 1 } = {}) {
    const key = (r, c) => r * NB + c;
    const present = new Set(cells.map(([r, c]) => key(r, c)));
    // ρ: local density = same-colour blocks within Chebyshev radius R (self included)
    const rho = new Map();
    for (const [r, c] of cells) { let d = 0; for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) if (present.has(key(r + dr, c + dc))) d++; rho.set(key(r, c), d); }
    // process descending ρ; δ = Chebyshev distance to nearest ALREADY-SEEN (≥) density block = parent
    const order = [...cells].sort((a, b) => rho.get(key(b[0], b[1])) - rho.get(key(a[0], a[1])));
    const parent = new Map(), delta = new Map();
    for (let i = 0; i < order.length; i++) {
      const [r, c] = order[i]; let best = Infinity, bp = null;
      for (let j = 0; j < i; j++) { const [r2, c2] = order[j]; const dist = Math.max(Math.abs(r - r2), Math.abs(c - c2)); if (dist < best) { best = dist; bp = key(r2, c2); } }
      delta.set(key(r, c), bp === null ? Infinity : best); parent.set(key(r, c), bp);
    }
    // a block is a PEAK (cluster centre) if it is the global densest (δ=∞) or sits a real GAP away
    // from anything denser (δ ≥ gap) — that gap IS the saddle that separates two touching clusters.
    const cluster = new Map();
    for (const [r, c] of order) { const k = key(r, c); if (delta.get(k) === Infinity || delta.get(k) >= gap) cluster.set(k, k); else cluster.set(k, cluster.get(parent.get(k))); }
    const groups = new Map();
    for (const [r, c] of cells) { const k = key(r, c), cl = cluster.get(k); if (cl == null) continue; if (!groups.has(cl)) groups.set(cl, []); groups.get(cl).push([r, c]); }
    return [...groups.values()].filter((g) => g.length >= rhoFloor);
  }
  // peel ONE sprawling cluster into ≤K tight cores at its densest cells (the dominant carpet only —
  // a uniform in-lane frame has a single density peak, so its bounding ellipse would span the whole
  // panel and swallow the drift ovals; we show a few "strongly on-target" cores and leave the diffuse
  // tail un-circled). The amber/red DRIFT is never peeled — each cluster stays ONE legible oval.
  function tighten(cells, K = 3, RAD = 1) {
    const remaining = new Map(cells.map((c) => [c[0] * NB + c[1], c]));
    const dens = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].reduce((n, [dr, dc]) => n + (remaining.has((c[0] + dr) * NB + (c[1] + dc)) ? 1 : 0), 0);
    const cores = []; let made = 0;
    while (remaining.size && made < K) {
      let best = null, bd = -1;
      for (const c of remaining.values()) { const d = dens(c); if (d > bd) { bd = d; best = c; } }
      const core = [];
      for (const c of [...remaining.values()]) if (Math.abs(c[0] - best[0]) <= RAD && Math.abs(c[1] - best[1]) <= RAD) { core.push(c); remaining.delete(c[0] * NB + c[1]); }
      cores.push(core); made++;
    }
    return cores;   // a diffuse remainder past K cores is the baseline carpet — intentionally un-circled
  }
  const split = [...lineRegions];   // line regions first; they sort high on block-span and read as the headline invariant
  for (const k of [1, 2, 3]) {
    const cells = [];
    for (let br = 0; br < NB; br++) for (let bc = 0; bc < NB; bc++) if (blockKind[br * NB + bc] === k) cells.push([br, bc]);
    if (!cells.length) continue;
    // gap=2 keeps a solid band as ONE cluster but separates two blobs joined only by a thin saddle.
    // dominant carpet drops lone-block noise (≥2 to circle); minority drift keeps every patch (≥1).
    for (const g of densityPeak(cells, { R: 1, gap: 2, rhoFloor: k === dominant ? 2 : 1 })) {
      const brs = g.map((x) => x[0]), bcs = g.map((x) => x[1]);
      const span = Math.max(Math.max(...brs) - Math.min(...brs), Math.max(...bcs) - Math.min(...bcs)) + 1;
      if (k !== dominant || (g.length <= 6 && span <= 4)) { split.push({ kind: k, blocks: g.length, ...ell(g) }); continue; }
      for (const core of tighten(g)) split.push({ kind: k, blocks: core.length, ...ell(core) });
    }
  }
  split.sort((a, b) => b.blocks - a.blocks);
  // attach the ShortLex bound coordinate(s) so every consumer (CLI, Rust panel, email) names the
  // region the same way — "A,A1" for a single block, "A,A1 ▸ B1,C2" for a span.
  return split.map((r, i) => {
    const coord = regionShortLex(r.blockBox);
    return { n: i + 1, ...r, coord, meaning: coordGist(coord.center) };   // what this coordinate MEANS in the lattice
  });
}

function synthTolerance() {
  const G = [30, 145, 80], A = [255, 176, 0], R = [255, 59, 59];
  const rgba = new Uint8Array(N * N * 4);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const o = (r * N + c) * 4; rgba[o + 3] = 255;
    if ((r + c) % 3 !== 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 5; continue; }
    const br = Math.floor(r / B), bc = Math.floor(c / B);
    let col = G; if (br >= 8 && bc >= 8) col = R; else if (br >= 4 && br <= 7 && bc <= 4) col = A; else if (br <= 3 && bc >= 9) col = R;
    rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2];
  }
  // thin DRIFT LINES (override the sparsity) to exercise the line detector: a horizontal red streak
  // across most of the width, and a vertical red streak down most of the height.
  for (let c = 18; c <= 128; c++) { const o = (60 * N + c) * 4; rgba[o] = R[0]; rgba[o + 1] = R[1]; rgba[o + 2] = R[2]; rgba[o + 3] = 255; }
  for (let r = 12; r <= 130; r++) { const o = (r * N + 104) * 4; rgba[o] = R[0]; rgba[o + 1] = R[1]; rgba[o + 2] = R[2]; rgba[o + 3] = 255; }
  return rgba;
}

async function main() {
  const { rgbaToPngDataUri, rgbaToPng } = await import('./triptych-render.mjs');
  const toUri = (rgba) => rgbaToPngDataUri ? rgbaToPngDataUri(rgba) : 'data:image/png;base64,' + Buffer.from(rgbaToPng(rgba)).toString('base64');

  let rgba, meta = {};
  if (has('--demo')) {
    rgba = synthTolerance();
    console.log('  --demo: synthetic tolerance panel (green + amber + red) to show all three encircled.');
  } else {
    // SHARED composition — the SAME domBlocks-correct tolerance panel the commit email builds (one way,
    // not a thinner copy). composeTolerancePanel runs runPipeline + empty-heat retry + domBlocks +
    // renderTriptych(domBlocks); without the domBlocks reference this panel collapsed to all-amber.
    const { composeTolerancePanel } = await import('./tolerance-panel.mjs');
    const intentText = arg('--intent'); const realityText = arg('--reality');
    console.log('  Composing the live tolerance panel (shared domBlocks-correct pipeline)…');
    const out = await composeTolerancePanel({ intentText, realityText, intentLabel: 'intent', realityLabel: 'reality', label: 'annotate', sub: 'tolerance', log: (m) => console.error(m) });
    rgba = out.rgba; meta = out.meta;
    if (!rgba) { console.error('no tolerance rgba'); process.exit(3); }
  }

  const regions = has('--coverage') ? coverageRegions(rgba, { target: Number(arg('--target', '0.8')), maxPerColor: Number(arg('--max-per-color', '4')) }) : detectColorRegions(rgba);
  // --message "<commit message>": place each clause on the lattice (gzip) and file it under the oval
  // it landed in, so each region names the COMMIT-MESSAGE slice it carries — not only the generic lens.
  const message = arg('--message');
  if (message) sliceMessageToRegions(message, regions);
  for (const r of regions) {
    const k = KIND[r.kind];
    const slice = (r.messageSlice || [])[0];
    const shape = r.line ? `${r.line.orient.toUpperCase()} LINE (invariant ${r.line.axis}) ` : '';
    r.narrative = `${k.name.toUpperCase()} ${shape}region at ShortLex ${r.coord.label}${r.meaning ? ` · «${r.meaning}»` : ''} (${r.blocks} block${r.blocks === 1 ? '' : 's'}) — ${k.means}.${r.line ? ` This is a ${r.line.orient} streak: one fixed ${r.line.axis} held constant across the whole span — a held invariant, not scattered drift.` : ''}${slice ? ` ASK-SLICE (gzip σ${slice.sigma}): "${slice.clause.slice(0, 90)}"` : ''}`;
  }
  console.log(`\n  TOLERANCE PANEL — ${regions.length} colored region${regions.length === 1 ? '' : 's'} encircled in their own colour:`);
  for (const r of regions) console.log(`     ▸ Area ${r.n} · ${r.narrative}`);

  // --png <path>: emit the STANDALONE burned-in PNG (the bearer artifact) — rings in the pixels,
  // not an SVG overlay, so it CID-inlines into the drift-receipt attestation and forwards clean.
  const pngPath = arg('--png');
  if (pngPath) {
    const abs = resolve(REPO, pngPath); mkdirSync(dirname(abs), { recursive: true });
    // For the SHARE/OG image keep it legible: draw only the significant SHAPES — every drift (red)
    // region plus the biggest clusters, capped. Sparse real panels yield a long tail of 1-block
    // singletons that read as noise in a thumbnail; the headline is the few large shapes. (The HTML
    // view + narration still carry every region.) Override with --png-top N.
    const cap = Math.max(1, parseInt(arg('--png-top', '6'), 10) || 6);
    const top = regions.filter((r) => r.kind === 3);             // never drop drift
    for (const r of regions) { if (top.length >= cap) break; if (!top.includes(r)) top.push(r); }
    top.sort((a, b) => b.blocks - a.blocks);
    const pngRegions = top.map((r, i) => ({ ...r, n: i + 1 }));   // renumber the shown subset
    writeFileSync(abs, encircleRegionsPng(rgba, pngRegions, { scale: 4 }));
    console.log(`  🖼  burned-in encircled PNG → ${pngPath} (${N * 4}×${N * 4}, ${pngRegions.length} of ${regions.length} regions shown)`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(toUri(rgba), regions, meta));
  console.log(`\n  📄 annotated tolerance panel → ${OUT.replace(REPO + '/', '')}`);
  if (!has('--no-open')) spawnSync('open', [OUT]);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function css(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }
// The insurability read — REUSED from the renderer's tol.pattern.region (the same source the
// commit email's VERDICT/NATURE/VECTOR/RUPTURE block is built from). This is the rich
// tolerance read the npm proof output needs, priced from the geometry, not reinvented.
function insurBlock(meta) {
  const reg = meta.region; if (!reg) return '';
  const verdict = reg.tier || 'UNDETERMINED';
  return `<div style="background:#0e131e;border:1px solid #1a2130;border-left:3px solid #f0b429;border-radius:10px;padding:14px 16px;margin-top:16px;font-size:14px">
    <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.12em;color:#f0b429;margin-bottom:8px">PROOF OF INSURABILITY · priced from the geometry, not the code</div>
    <div><b>VERDICT:</b> ${esc(verdict)}${meta.tooMany ? ' · ⚠ TOO MANY out-of-lane' : ''}</div>
    <div><b>NATURE:</b> ${esc(reg.motif || 'none')} · ${esc(reg.blastRadius || 'none')} blast radius${reg.invariant ? ' · invariant ' + esc(reg.invariant) : ''}</div>
    <div><b>VECTOR:</b> ${esc(reg.direction || 'self')}${reg.macroDist ? ' · macro-distance ' + reg.macroDist : ''}</div>
    <div><b>RUPTURE:</b> ${esc(reg.severity || 'none')}${reg.spread ? ' · spans ' + reg.spread + ' lanes' : ''}</div>
    ${reg.ruling ? `<div><b>RATIONALE:</b> ${esc(reg.ruling)}</div>` : ''}
    <div style="color:#8a94a8;margin-top:8px;font-size:13px">counts: ${meta.green ?? '?'} green · ${meta.amber ?? '?'} amber · ${meta.red ?? '?'} red · off-lane ${meta.offPct ?? '?'}%</div>
  </div>`;
}
function render(uri, regions, meta) {
  const SC = 4, px = N * SC;
  const ell = regions.map((r) => {
    const e = r.ellipse, col = css(KIND[r.kind].draw);
    return `<ellipse cx="${e.cx * SC}" cy="${e.cy * SC}" rx="${e.rx * SC}" ry="${e.ry * SC}" fill="none" stroke="${col}" stroke-width="3"/>
      <circle cx="${e.cx * SC}" cy="${(e.cy - e.ry) * SC}" r="12" fill="${col}"/>
      <text x="${e.cx * SC}" y="${(e.cy - e.ry) * SC + 4}" text-anchor="middle" fill="#000" font-family="ui-monospace,Menlo,monospace" font-size="14" font-weight="700">${r.n}</text>`;
  }).join('');
  const narr = regions.map((r) => `<li><b style="color:${css(KIND[r.kind].draw)}">Area ${r.n} · ${KIND[r.kind].name}</b> — ${esc(r.narrative.replace(/^[A-Z]+ region /, ''))}</li>`).join('') || '<li class="dim">no colored region detected (panel sparse)</li>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tolerance panel — colored regions encircled</title><style>
  body{margin:0;background:#070910;color:#e9edf5;font:15px/1.55 -apple-system,BlinkMacSystemFont,sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:30px 20px 70px} h1{font-size:24px;margin:0 0 4px} .sub{color:#8a94a8;font-size:14px;margin-bottom:18px}
  .pair{display:flex;gap:18px;flex-wrap:wrap} figure{margin:0} figcaption{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#8a94a8;margin-bottom:6px}
  img{image-rendering:pixelated;border:1px solid #1a2130;border-radius:8px;display:block;max-width:100%}
  .stage{position:relative;width:${N * 4}px;max-width:100%} .stage svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  ul{padding-left:18px;font-size:14.5px} li{margin:6px 0} .dim{color:#5a6478} code{font-family:ui-monospace,Menlo,monospace;color:#9fe6b0}
  .key{font-size:13px;color:#8a94a8;margin-top:6px}
</style></head><body><div class="wrap">
  <h1>Tolerance panel — colored regions, encircled in their colour</h1>
  <div class="sub">Each colored cluster on the tolerance panel is detected and circled in its own colour, numbered, and read by area. ${meta.green != null ? `Panel: ${meta.green} green / ${meta.amber} amber / ${meta.red} red, off-lane ${meta.offPct}%.` : ''}</div>
  <div class="pair">
    <figure><figcaption>raw tolerance panel</figcaption><img src="${uri}" width="${N * 4}"></figure>
    <figure><figcaption>annotated — colored regions encircled</figcaption>
      <div class="stage"><img src="${uri}" width="${N * 4}"><svg viewBox="0 0 ${px} ${px}">${ell}</svg></div></figure>
  </div>
  <div class="key">🟢 green = in lane (say = do) · 🟡 amber = adjacent bleed · 🔴 red = orthogonal drift (did what it never said)</div>
  ${insurBlock(meta)}
  <ul style="margin-top:14px">${narr}</ul>
  <p class="dim" style="margin-top:18px">Pipeline-native: <code>detectColorRegions(tol.rgba)</code> exported from <code>scripts/pmu/annotate-regions.mjs</code> for the panel renderer to call.</p>
</div></body></html>`;
}
// import-safe: only run the CLI when executed directly, so detectColorRegions / encircleRegionsPng
// can be imported by the commit-triptych email path without triggering a live pipeline render.
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.stack || e.message); process.exit(3); });
