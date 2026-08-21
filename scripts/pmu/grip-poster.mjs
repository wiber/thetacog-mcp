#!/usr/bin/env node
// scripts/pmu/grip-poster.mjs — GRIP LEDGER v0.2: the poster IN THE PROMPT INJECTION. This is the piece
// that makes the ledger "the reality running in the prompt injection" (not just on the page): at dispatch
// time the lens serves a tier-ordered rule poster, picked by the HEAT MAP (geometric Chebyshev + the
// gzip-NCD placement already computed) around the confidence pixel, one-pass from the RAM projection.
//
// The operator's model, made real: "if the confidence pixel is the rules you're lighting up ... that
// heat map makes a ranked series of hats you need — they're just points in the tesseract." renderGripPoster
// lights the tiles within Chebyshev radius of the placed coordinate, orders them by tier/ĝ-cost (the
// poster, §C.slot), and renders them in a single sweep of the projection. LLM-FREE, sub-second.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjection, renderOnePass } from './grip-project.mjs';

// compression distance — the SECOND half of the retrieval the operator specified ("a geometric distance
// AND a compression distance to find the rules"). Geometric (Chebyshev) picks the neighborhood; gzip-NCD
// to the prompt ranks WHICH rules in that neighborhood are actually on-topic. Without this, a dense pixel
// (76 tiles within Δ2) injects a near-random top-10 by proximity alone — the low-relevance bug.
const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
const ncd = (a, b) => { const ga = gz(a), gb = gz(b), gab = gz(a + '\n' + b); const mx = Math.max(ga, gb); return mx ? (gab - Math.min(ga, gb)) / mx : 1; };
// META-BULK (CLAUDE.md HARD RULE): never match a rule as naked text. Bundle BOTH sides with their cell
// mass, cut the eye to a matched window, pixel at center of mass. cellText loaded once; bulk = text ⊕ cell.
const _SN = (() => { try { return JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8')); } catch { return []; } })();
const cellText = (c) => String((_SN.find((x) => String(x.coord) === String(c)) || {}).snippet || '');
const bulk = (text, coord) => `${String(text || '')}\n${cellText(coord)}`;
/** metaBulkMarginal — RELEVANCE OF THE SORTING (operator 2026-07-23: "there is noise... focus on relevance
 *  of the sorting"). Both sides carry cell mass (meta-bulk), but when many rules share ONE cell the cell
 *  drowns them — every ncd collapses to ~0.09 (a 0.006 spread = a flat, near-arbitrary within-cell sort).
 *  The fix: rank by the rule's MARGINAL grip — full bundle match MINUS the shared-cell baseline — so the
 *  cell's identical contribution cancels and the rule's own signal decides. Measured: recovers a 0.17
 *  spread on the flat case, holds testing→testing / delegation→delegation on the clean cases. Lower (more
 *  negative) = the prompt grips this rule beyond what its cell alone would. */
function metaBulkMarginal(prompt, promptCoord, ruleText, ruleCoord) {
  const pB = bulk(prompt, promptCoord), rB = bulk(ruleText, ruleCoord);
  const eye = Math.min(pB.length, rB.length);
  const full = ncd(pB.slice(0, eye), rB.slice(0, eye));
  const base = ncd(cellText(promptCoord).slice(0, eye), rB.slice(0, eye));   // the shared-cell baseline, canceled
  return full - base;
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TILES = resolve(REPO, 'data/pmu/grip-tiles.ndjson');
const ANCHORS = ['A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2', 'B3', 'C', 'C1', 'C2', 'C3'];
const IDX = Object.fromEntries(ANCHORS.map((a, i) => [a, i]));
function cheb(cA, cB) {
  const a = String(cA).split(','), b = String(cB).split(',');
  if (a.length < 2 || b.length < 2) return 99;
  const ra = IDX[a[0]], ca = IDX[a[1]], rb = IDX[b[0]], cb = IDX[b[1]];
  if (ra == null || ca == null || rb == null || cb == null) return 99;
  return Math.max(Math.abs(ra - rb), Math.abs(ca - cb));
}

let _tiles = null;
function loadTiles() {
  if (_tiles) return _tiles;
  if (!existsSync(TILES)) return (_tiles = []);
  _tiles = readFileSync(TILES, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return _tiles;
}

/** litTilesAt(coord) — the heat map at the confidence pixel: the rule tiles lit within Chebyshev radius,
 *  widening until at least `min` are found, nearest-first. The raw density signal (shared with the ratchet). */
export function litTilesAt(coord, { radius = 0, min = 6, max = 11 } = {}) {
  const tiles = loadTiles();
  if (!tiles.length) return { lit: [], radius };
  // START AT THE CONFIDENCE PIXEL (Δ0 = the exact coordinate's own rules — the most relevant) and widen
  // ONLY if the pixel is too sparse to reach `min`. Starting wide (the old Δ2) grabbed 76 near-equidistant
  // tiles and the top-10 was near-random; starting tight makes the pixel's own rules dominate the poster.
  let lit = [], r = Math.max(0, radius);
  while (r <= max) { lit = tiles.filter((t) => cheb(coord, t.coord) <= r); if (lit.length >= min) break; r++; }
  lit.sort((a, b) => cheb(coord, a.coord) - cheb(coord, b.coord));
  return { lit, radius: r };
}

/**
 * renderGripPoster(coord) — the heat map at the confidence pixel → a ranked, tier-ordered poster.
 * Lights tiles within Chebyshev `radius` of `coord` (widening until it finds at least `min` rules), builds
 * the poster projection over exactly those, sweeps it once, and renders a compact injection block.
 */
/** pickPosterTiles(coord) — THE PICKER: geometric reach (litTilesAt) → rank by COMPRESSION distance to the
 *  prompt (the fix; falls back to proximity with no prompt) → dedup near-dups → top `cap`. The poster and
 *  the relevance ratchet both call this, so the metric measures exactly what is injected. */
export function pickPosterTiles(coord, { radius = 0, cap = 10, min = 6, promptText = '', heatCoords = null } = {}) {
  const tiles = loadTiles();
  if (!tiles.length) return { picked: [], radius: 0, mode: 'empty' };
  const pt = String(promptText || '').trim();
  let pool, r = null, mode;
  if (Array.isArray(heatCoords) && heatCoords.length) {
    // MORPHOLOGICAL MATCHING (operator 2026-07-23: "rules whose own native mass matches that exact lit
    // shape — a key fitting into a lock, not a grenade in a radius"). The prompt's footprint is the walk
    // heatmap; each rule carries its OWN footprint (the cells IT lights). Rank by SHAPE OVERLAP (Jaccard)
    // of the two encirclements, gzip-NCD to the prompt as the tiebreak. SQL got pulled before because it
    // was in the blast radius; its shape never matched the prompt's footprint, so shape-matching drops it.
    // SHAPE OVERLAP on the FAST PATH — a footprint intersection (bitmap AND + popcount = the collision
    // engine's operation, ~40M/s), NO gzip over the full mass. gzip-NCD is computed ONLY on the shortlist.
    const pf = new Set(heatCoords.map(String)); const pfN = pf.size;
    const jacc = (fp) => { const F = fp && fp.length ? fp : []; let inter = 0; const seenF = new Set(); for (const x of F) { const s = String(x); if (seenF.has(s)) continue; seenF.add(s); if (pf.has(s)) inter++; } return seenF.size ? inter / (seenF.size + pfN - inter) : 0; };
    pool = tiles.map((t) => { t._shape = jacc(t.footprint || [t.coord]); return t; }).filter((t) => t._shape > 0);
    mode = 'shape-match';
    if (pool.length < min) {   // no shape overlap anywhere → fall back to the heatmap cells around the hottest
      const have = new Set(pool.map((t) => t.rule_id));
      for (const t of litTilesAt(String(heatCoords[0]), { radius: 1, min }).lit) if (!have.has(t.rule_id)) { t._shape = 0; pool.push(t); }
    }
    // FINDING (measured): raw coord-Jaccard over the broad ~37-cell walk footprints is NOT discriminative
    // (many unrelated rules score shape≈1.0) and Set-Jaccard is ~944K/s, not 40M/s. So shape is the REGION
    // FILTER (the encircled mask) and gzip-NCD to the prompt DISCRIMINATES within it. The true 40M/s pure
    // shape-match needs bitmap-popcount footprints + a distinctive (tight/weighted) footprint — the next build.
    pool.sort((a, b) => b._shape - a._shape);                          // coarse shape filter (fast)
    const shortlist = pool.slice(0, Math.max(cap * 6, 48));           // widen the shortlist, gzip ranks within
    if (pt) shortlist.forEach((t) => { t._ncd = ncd(pt, t.text); });
    shortlist.sort((a, b) => ((a._ncd ?? 1) - (b._ncd ?? 1)) || (b._shape - a._shape));   // gzip DISCRIMINATES, shape breaks ties
    const seenS = new Set(); const pickedS = [];
    for (const t of shortlist) { const k = String(t.text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 50); if (seenS.has(k)) continue; seenS.add(k); pickedS.push(t); if (pickedS.length >= cap) break; }
    return { picked: pickedS, radius: null, mode };
  } else {
    const res = litTilesAt(coord, { radius, min }); pool = res.lit; r = res.radius; mode = 'meta-bulk-marginal';
    // META-BULK + MARGINAL (relevance of the sorting): bundle both sides with cell mass, then rank by the
    // rule's MARGINAL grip (full match minus the shared-cell baseline) so the cell can't flatten the sort.
    // This is "stream bits until density reaches" made concrete — the dead shared-cell bits are canceled,
    // leaving only the density that discriminates.
    pool.forEach((t) => { t._d = cheb(coord, t.coord); t._ncd = pt ? metaBulkMarginal(pt, coord, t.text, t.coord) : 0; });
  }
  if (!pool.length) return { picked: [], radius: r, mode };
  // heat/geometric bucket PRIMARY, gzip-NCD to the prompt SECONDARY within the bucket
  pool.sort((a, b) => (a._d - b._d) || (a._ncd - b._ncd));
  const seen = new Set(); const picked = [];
  for (const t of pool) { const k = String(t.text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 50); if (seen.has(k)) continue; seen.add(k); picked.push(t); if (picked.length >= cap) break; }
  return { picked, radius: r, mode };
}

export function renderGripPoster(coord, { radius = 0, cap = 10, min = 6, promptText = '', heatCoords = null } = {}) {
  const { picked, radius: r, mode } = pickPosterTiles(coord, { radius, cap, min, promptText, heatCoords });
  if (!picked.length) return null;
  const { proj, projection_hash, tiers } = buildProjection(picked);
  const render = renderOnePass(proj);                       // one pass — visit-invariant carried to the receipt
  const top = proj.slice(0, cap);
  const lines = top.map((p, i) => `  ${i + 1}. [T${p.slot.tier}·${p.state}] ${String(p.text).replace(/\s+/g, ' ').slice(0, 96)}`);
  const src = mode === 'walk-heatmap' ? `WALK HEATMAP (${(heatCoords || []).length} lit cells, encircled shape)` : `Δ${r} geometric`;
  const block = [
    `📋 GRIP LEDGER POSTER · ${coord} · ${top.length} rules from the ${src} · ranked by gzip-NCD to the prompt`,
    `   served one-pass from the RAM projection ${projection_hash} · ${render.render_ms}ms · visit-invariant ${render.visit_invariant ? '✓' : '✗'} · tiers ${JSON.stringify(tiers)}`,
    ...lines,
  ].join('\n');
  return { block, meta: { coord, mode, radius: r, rules: top.length, projection_hash, render_ms: render.render_ms, visit_invariant: render.visit_invariant, tiers } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const coord = process.argv[2] || 'B,B1';
  const out = renderGripPoster(coord);
  if (!out) { console.log(`grip-poster · no tiles for ${coord} (run grip-densify first)`); process.exit(0); }
  console.log(out.block);
  console.log(`\nmeta: ${JSON.stringify(out.meta)}`);
}
