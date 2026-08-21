// scripts/pmu/region-message.mjs — slice the COMMIT MESSAGE onto the detected regions.
//
// The missing half of the reflexive narrative loop: the ovals on the tolerance panel were named only
// by their lattice LENS (coordGist) — generic, commit-blind. This places each CLAUSE of the commit
// message onto the 144 ShortLex lattice with the SAME gzip-NCD sensor the pipeline uses (placePixel),
// then files each clause under the oval whose blocks it landed in. The result: every region carries
// "the part of the commit message the gzip identified as landing here" — so a per-oval qwen call can
// tell the on-target/drift story about THAT slice, not the generic lane.
//
// Pipeline-native, shared: used by annotate-regions (the panel view) AND commit-drift (the delegation
// drift-watch). gzip-NCD is the canonical PRIMARY sensor (CLAUDE.md) — no SimHash, no model in the path.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placePixel } from '../../src/lib/pmu/compress.mjs';
import { shortLexToBlock } from './shortlex-coords.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAIRLIB_144 = resolve(REPO, 'data/pmu/snippet-library-144.json');

// the canonical 144 snippet library (coord "row,col" + composed snippet) = the pairLib placePixel scores.
export function loadPairLib(path = PAIRLIB_144) {
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'));
    const cells = Array.isArray(arr) ? arr : (arr.anchors || arr.cells || []);
    return cells.filter((c) => c && c.coord && c.snippet).map((c) => ({ coord: String(c.coord).trim(), snippet: String(c.snippet) }));
  } catch { return []; }
}

// break a commit message into the meaning-bearing CLAUSES worth placing. Drops the trailer block
// (Co-Authored-By / Originating-Terminal / Story: …), code fences, and bare paths — those are not
// the ASK, they are metadata, and placing them just adds noise.
export function messageClauses(message) {
  const lines = String(message || '').split('\n');
  const out = [];
  let inFence = false;
  for (let raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line) continue;
    if (/^(Co-Authored-By|Originating-Terminal|Relevant-Rooms|Story|Persona-Intent|Signed-off-by|Reviewed-by):/i.test(line)) continue;
    // split a line into clauses on sentence ends and the middot/semicolon/dash separators the voice uses
    for (let clause of line.split(/(?<=[.!?])\s+|\s+·\s+|\s*;\s*|\s+—\s+/)) {
      clause = clause.replace(/^[-*•]\s+/, '').replace(/`/g, '').trim();
      if (clause.split(/\s+/).length >= 4) out.push(clause);   // skip fragments too short to place
    }
  }
  return out;
}

// (br,bc) inside a region's block bounding box?
function inBox(br, bc, box) { return box && br >= box.r0 && br <= box.r1 && bc >= box.c0 && bc <= box.c1; }
function boxDist(br, bc, box) {
  const dr = br < box.r0 ? box.r0 - br : br > box.r1 ? br - box.r1 : 0;
  const dc = bc < box.c0 ? box.c0 - bc : bc > box.c1 ? bc - box.c1 : 0;
  return Math.max(dr, dc);   // Chebyshev distance from the point to the box
}

// Attach region.messageSlice = the clauses whose gzip pixel landed in (or nearest to) that region.
// MUTATES + returns regions; also returns the placements and the clauses that matched no region.
export function sliceMessageToRegions(message, regions, { pairLib = loadPairLib(), maxDist = 2 } = {}) {
  for (const r of regions) r.messageSlice = [];
  const placements = [], unplaced = [];
  if (!pairLib.length || !regions.length) return { regions, placements, unplaced, sensor: pairLib.length ? 'gzip-NCD' : 'none (no 144 pairLib)' };
  for (const clause of messageClauses(message)) {
    const p = placePixel(clause, pairLib);
    if (!p || !p.pixel) { unplaced.push({ clause }); continue; }
    const { br, bc } = shortLexToBlock(p.pixel);
    placements.push({ clause, coord: p.pixel, sigma: +(p.sigma || 0).toFixed(2), block: [br, bc] });
    // prefer the region that CONTAINS the pixel; else the nearest within maxDist blocks
    let best = null, bestD = Infinity;
    for (const r of regions) {
      const d = inBox(br, bc, r.blockBox) ? 0 : boxDist(br, bc, r.blockBox);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best && bestD <= maxDist) best.messageSlice.push({ clause, coord: p.pixel, sigma: +(p.sigma || 0).toFixed(2) });
    else unplaced.push({ clause, coord: p.pixel });
  }
  for (const r of regions) r.messageSlice.sort((a, b) => b.sigma - a.sigma);
  return { regions, placements, unplaced, sensor: 'gzip-NCD' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lib = loadPairLib();
  console.log(`region-message self-check · pairLib ${lib.length} cells · placing a sample clause…`);
  const demo = 'Repair the corrupted blog frontmatter and harden the index render against title-less posts.';
  const cl = messageClauses(demo);
  console.log(`  clauses: ${cl.length}`);
  if (lib.length) { const p = placePixel(cl[0] || demo, lib); console.log(`  "${(cl[0] || demo).slice(0, 50)}…" → ${p.pixel} (σ ${(+p.sigma).toFixed(2)})`); }
}
