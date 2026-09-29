#!/usr/bin/env node
// scripts/vna/long-on-short.mjs — C312: LONG-TERM ON SHORT-TERM ALL RED IS NOT A BREAK, IT'S A RERUN.
//
// Operator, verbatim (2026-09-25): "if the longterm on shorterm is all red - we need to wire in not
// a break, but a rerun and tell the user we may have drifted (trigger another round in the cli)".
//
// The tiers are HORIZONS (mesh.mjs: A long · C medium · B short). Row axis = actor, column axis =
// patient, the 12 axes in ShortLex order A B C A1 A2 A3 B1 B2 B3 C1 C2 C3 (triptych-render.mjs AX12).
// This reads the Δ panel the receipt already carries — the SAME PNG, classified cell-by-cell with the
// byte-exact tolerance hues annotate-regions.mjs owns (TOL_HUE / classify) — and aggregates the block
// whose ROW is a LONG-horizon axis (A A1 A2 A3) and whose COLUMN is a SHORT-horizon axis (B B1 B2 B3).
// ALL LIT CELLS THERE RED, above the panel's own lit-mass floor, reads as "we may have drifted" — a
// red long×short block looks EXACTLY like a deliberate pivot too (short-horizon work landing where the
// long-horizon declaration never touched), so this never claims the work was WRONG (Rice) — it only
// says the rerun is the redirect, and the operator is still the judge. The reverse block (short rows ×
// long columns) is reported BESIDE it, never folded into the same verdict.
//
// Zero LLM in this path — a pure, re-runnable function of the receipt's own Δ panel PNG.
// decides a verdict — Rust port pending (C312)
//
//   node scripts/vna/long-on-short.mjs [--json] [--commit <sha>]      # reads data/vna/cockpit.json
//
// @guard tests/vna/c312-long-on-short-red-reruns.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';   // already a repo dependency (package.json); the one PNG decoder, never a second hand-rolled one
import { classify } from '../pmu/annotate-regions.mjs';   // the SAME classifier the tolerance count and every region reader use
import { LIT_MASS_FLOOR } from '../pmu/triptych-render.mjs';   // the one home for the lit-mass floor (self-lane-panel.mjs imports the same constant)
import { HORIZON } from './mesh.mjs';   // A=long · B=short · C=medium — the one home for the horizon labels

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VNA_REPO || resolve(__dirname, '../..');
export const COCKPIT_JSON = process.env.VNA_COCKPIT_JSON || resolve(REPO, 'data/vna/cockpit.json');

const N = 144;
// the 12 canonical ShortLex block axes, in the SAME order triptych-render.mjs's AX12 and mesh.mjs's
// AXL use — never re-derived, never re-sorted (mesh.mjs: "the lattice is not reordered").
export const AX12 = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const tierOf = (axis) => (axis || '')[0];
export const LONG_IDX = AX12.map((a, i) => (HORIZON[tierOf(a)] === 'long' ? i : -1)).filter((i) => i >= 0);   // A A1 A2 A3
export const SHORT_IDX = AX12.map((a, i) => (HORIZON[tierOf(a)] === 'short' ? i : -1)).filter((i) => i >= 0);  // B B1 B2 B3

function decodePngDataUri(dataUri) {
  const m = /^data:image\/png;base64,(.*)$/s.exec(String(dataUri || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

// classify ONE cell (a block of pixels, since the encircled panel is upscaled — SC=4 in
// annotate-regions.mjs's encircleRegionsRgba) by MAJORITY hue among its OWN pixels, ignoring
// background/foreign pixels (class 0). This is the robustness the ring strokes and the numbered
// disc demand: a ring is drawn in a BRIGHT variant of the region's own colour (so it still classifies
// the same way) and the disc/label is near-black (class 0, below BG_FLOOR) — neither can outvote a
// cell's real fill unless the ring/label pixels are the ONLY lit pixels in that cell, in which case
// there is nothing else to read anyway.
function classifyCell(rgba, W, x0, y0, w, h) {
  const cnt = [0, 0, 0, 0];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * W + x) * 4;
      cnt[classify(rgba[o], rgba[o + 1], rgba[o + 2])]++;
    }
  }
  const lit = cnt[1] + cnt[2] + cnt[3];
  if (!lit) return 0;
  return cnt[1] >= cnt[2] && cnt[1] >= cnt[3] ? 1 : cnt[2] >= cnt[3] ? 2 : 3;
}

// rgba (raw RGBA8, W×H, any W/H that divides evenly into the 144×144 lattice) → Int8Array of 144×144
// cell classes (0 unlit/foreign, 1 green, 2 amber, 3 red).
export function classifyPanel(rgba, W, H) {
  const cellW = W / N, cellH = H / N;
  const cls = new Int8Array(N * N);
  for (let br = 0; br < N; br++) {
    const y0 = Math.floor(br * cellH), y1 = Math.max(y0 + 1, Math.floor((br + 1) * cellH));
    for (let bc = 0; bc < N; bc++) {
      const x0 = Math.floor(bc * cellW), x1 = Math.max(x0 + 1, Math.floor((bc + 1) * cellW));
      cls[br * N + bc] = classifyCell(rgba, W, x0, y0, x1 - x0, y1 - y0);
    }
  }
  return cls;
}

// aggregate every 12×12 cell inside the ShortLex blocks named by rowIdxs (actor axes) × colIdxs
// (patient axes) over the 144×144 cell classification: {red, lit} at CELL resolution.
function aggregateBlocks(cls, rowIdxs, colIdxs) {
  let red = 0, lit = 0;
  for (const br of rowIdxs) {
    for (const bc of colIdxs) {
      for (let r = br * 12; r < br * 12 + 12; r++) {
        for (let c = bc * 12; c < bc * 12 + 12; c++) {
          const k = cls[r * N + c];
          if (k) { lit++; if (k === 3) red++; }
        }
      }
    }
  }
  return { red, lit };
}

const unmeasured = (commit, red, lit, reverse, why) => ({ state: 'UNMEASURED', red, lit, reverse, commit, why, line: null });

/**
 * longOnShort(receipt) → { state: 'DRIFT?'|'CLEAR'|'UNMEASURED', red, lit, reverse:{red,lit}, commit, why, line }
 *
 * `receipt` is either:
 *   - a cockpit.json-shaped object: { commit, panels: [{ id:'delta', png:'data:image/png;base64,…' }] }
 *   - or, for callers/tests that already have the pixels, { commit, rgba: Uint8Array, width, height }
 *     where rgba is a 144×144-cell-aligned RGBA8 buffer (any upscale factor).
 *
 * NEVER touches the working tree or git — the caller says which commit's receipt this is; the
 * returned `commit` is exactly what the receipt itself carried, never re-derived.
 */
export async function longOnShort(receipt) {
  const commit = receipt?.commit || receipt?.commitFull || null;
  let rgba, W, H;
  if (receipt?.rgba && receipt?.width && receipt?.height) {
    ({ rgba, width: W, height: H } = receipt);
  } else {
    const panel = (receipt?.panels || []).find((p) => p.id === 'delta');
    if (!panel?.png) return unmeasured(commit, 0, 0, { red: 0, lit: 0 }, 'no Δ panel PNG on this receipt');
    const buf = decodePngDataUri(panel.png);
    if (!buf) return unmeasured(commit, 0, 0, { red: 0, lit: 0 }, 'Δ panel PNG did not decode (not a data:image/png;base64 URI)');
    let decoded;
    try { decoded = await sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true }); }
    catch (e) { return unmeasured(commit, 0, 0, { red: 0, lit: 0 }, `Δ panel PNG failed to decode — ${String(e && e.message || e).slice(0, 160)}`); }
    rgba = decoded.data; W = decoded.info.width; H = decoded.info.height;
  }
  const cls = classifyPanel(rgba, W, H);
  const primary = aggregateBlocks(cls, LONG_IDX, SHORT_IDX);
  const reverse = aggregateBlocks(cls, SHORT_IDX, LONG_IDX);
  const { red, lit } = primary;
  if (lit < LIT_MASS_FLOOR) {
    return unmeasured(commit, red, lit, reverse, `LIT-MASS FLOOR — ${lit} lit cells in the long-actor × short-patient block (floor ${LIT_MASS_FLOOR}); too thin to call. UNMEASURED, never a pass.`);
  }
  const allRed = red === lit;
  const line = allRed
    ? `⚠ we may have drifted — long-term × short-term is all red on ${commit || '(no commit)'} (${red}/${lit} cells) — running another round`
    : null;
  return {
    state: allRed ? 'DRIFT?' : 'CLEAR',
    red, lit, reverse, commit,
    why: allRed
      ? 'every lit cell in the long-actor (A/A1/A2/A3) × short-patient (B/B1/B2/B3) block is red'
      : `${lit - red}/${lit} lit cells in the long×short block are not red — not a break`,
    line,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  let receipt;
  try { receipt = JSON.parse(readFileSync(COCKPIT_JSON, 'utf8')); }
  catch (e) { console.error(`long-on-short: could not read ${COCKPIT_JSON} — ${String(e && e.message || e)}`); process.exitCode = 1; return; }
  const result = await longOnShort(receipt);
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`long-on-short: ${result.state} — red ${result.red}/${result.lit} (reverse ${result.reverse.red}/${result.reverse.lit}) on ${result.commit || '(no commit)'}`);
  if (result.why) console.log(`  ${result.why}`);
  if (result.line) console.log(result.line);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
