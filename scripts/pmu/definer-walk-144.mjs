#!/usr/bin/env node
// scripts/pmu/definer-walk-144.mjs — THE GUIDED ROW→TRANSPOSE→ROW WALK AT 144, ON CHIP.
//
// Operator: "The walk is 144 on chip" + "start new pmu-onchip process every time." The leaf-walk
// runs the right ALGORITHM but in JS over the 12 axes. This runs it over the 144 ANCHORS, on the
// metal: each hop is a real `pmu-onchip --ballistic` process. Start at the chosen pixel → ballistic
// from it (one ply) → its ROW's significant column(s) j → TRANSPOSE (column index j → the next
// anchor/row) → ballistic from j → recurse. Guided (follows the significant weight), not a blind
// aggregate. Asymmetric directed connectivity so the walk flows outward + decays + terminates.
//
// @canonical-algorithm  guided row→transpose→row definer walk, 144 anchors, ON CHIP (pmu-onchip --ballistic per hop)
// @forbidden-alternative  leaf-walk.mjs (right algo, WRONG substrate: 12-axis JS) · cole-trace.mjs (blind --ballistic fan-out — NOT the definer chain)
// @why  we escape the regressive-definition problem by walking the definer-OF-definer on silicon; a JS/12×12 or a blind fan-out throws away the whole differentiator and only LOOKS right (speed/symmetry are the only tells)
// @guard  tests/pmu-simulator/dogfood-success-factors.test.mjs (SF1,SF2,SF5) · tests/pmu-simulator/gemini-spec-inspection.test.mjs · scripts/pmu/validate-dogfood.sh

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pExecFile = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const DAEMON = resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');
const LIB144 = resolve(REPO, 'data/pmu/snippet-library-144.json');
const DIR_CONN = resolve(REPO, '.thetacog/pmu/reef-connectivity-directed.json');

const AX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const ai = a => AX.indexOf(a);
let raw = JSON.parse(readFileSync(LIB144, 'utf8')); if (!Array.isArray(raw)) raw = raw.anchors || raw.nodes || [];
const anchors = new Array(144).fill(null);
for (const a of raw) { const r = ai(a.row), c = ai(a.col); if (r >= 0 && c >= 0) anchors[r * 12 + c] = a; }
export const COORDS = anchors.map(a => (a && a.coord) || '');

export function buildDirected() {
  if (existsSync(DIR_CONN)) { try { return JSON.parse(readFileSync(DIR_CONN, 'utf8')); } catch { /* */ } }
  const ax = COORDS.map(c => (c || 'A,A').split(','));
  const grid = new Array(20736).fill(0);
  for (let i = 0; i < 144; i++) { const [ri, ci] = ax[i]; grid[i * 144 + i] = 1; for (let j = i + 1; j < 144; j++) { const [rj, cj] = ax[j]; if (ri === rj || ci === cj) grid[i * 144 + j] = 1; } }
  mkdirSync(dirname(DIR_CONN), { recursive: true }); writeFileSync(DIR_CONN, JSON.stringify(grid));
  return grid;
}

// ── THE LEAF WALK ON THE SEMANTIC GRID (operator correction, 2026-06-10) ─────────────────────────
// What was wrong before: this module re-implemented the fan-out OUTSIDE the chip (a JS BFS spawning
// --max-depth-1 processes, weight-sorted topK) and walked the STRUCTURAL axis-share connectivity —
// so the picture showed pure lattice structure, never the commit's meaning. Both were re-inventions.
//
// THE CANON (read first, then build): .thetacog/pmu/src/ballistic.rs `ballistic_walk` ALREADY does the
// whole explosion the operator described — per ply every lit cell of each active row spawns its COLUMN
// as a new row next ply (the transpose), weight decays per ply ("heat additions slightly smaller"),
// NO row dedup, weight-floor extinction, `first_depth` per cell (the ply→colour), frames streamed
// per ply (the PMU data the higher level consumes). ONE chip process runs it all.
//
// So the JS layer's ONLY jobs are: (1) hand the chip the COMMIT'S SEMANTIC BINARY GRID — the project/
// binarize decomposition of the ingest onto the 20,736-cell lattice ("we always have to put that on
// the chip by decomposing it into the 144×144 binary lattice, based on the prior step") — NOT the
// structural connectivity; (2) start at the right anchor — the chosen pixel's COLUMN, transposed into
// its row ("if the pixel is in column 5, we jump to row 5"); (3) read the frames back.
//
// significant = lit in the binary grid (the binarize threshold IS the significance function); ranking
// inside the chip is ShortLex order (active rows sorted ascending = gestalt-boundary-first, the
// "beginning of the blocks" — see leaf-walk.mjs rankSignificant).
// THE GUIDED LEAF WALK — the synthesis the spec (docs/architecture/leaf-walk-spec-2026-06-10.md §7)
// and the operator's narration both demand, on the SEMANTIC grid:
//   · start = the chosen intersection's COLUMN, transposed into its row (the first walk);
//   · each row is read ON CHIP (one real pmu-onchip --ballistic process per hop — "fires off a new
//     process on the PMU to walk the row that is the transpose of the column found");
//   · the row's significant cells are RANKED ShortLex-block-aware (ascending index IS
//     gestalt-boundary-first — leaf-walk.mjs rankSignificant; "the high-ranking ones, the ones at the
//     beginning of the blocks") and only the top-K are FOLLOWED (§7.3 — guided keeps it a cloud,
//     not a flood: on the outer-product semantic grid an unguided fan-out saturates to |L|² uniform);
//   · every reached cell paints with decay^ply ("you make the heat-map additions slightly smaller"
//     per ply) — early hits heavy, later fainter; ply = the colour;
//   · budget is TIME + process count (§7.5 — "not loops, it just goes as far as it gets").
export async function definerWalk144(startAnchors, { gridBits = null, maxDepth = 8, topK = 3, budget = 220, budgetMs = 1500, decay = 0.5, onHop = null } = {}) {
  if (!existsSync(DAEMON)) throw new Error('pmu-onchip daemon not built');
  // the grid the chip walks: the commit's SEMANTIC binary decomposition when supplied (the dogfood
  // path); the structural lattice only as the seedless demo substrate.
  let grid = gridBits;
  if (!grid) { buildDirected(); grid = Uint8Array.from(JSON.parse(readFileSync(DIR_CONN, 'utf8')), x => (x ? 1 : 0)); }
  const tmp = resolve(REPO, `.thetacog/cache/leafwalk-grid-${process.pid}-${Math.floor(Math.random() * 1e6)}.json`);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, JSON.stringify(Array.from(grid, b => (b ? 1 : 0))));
  const heat = new Array(144).fill(0), ply = new Array(144).fill(-1);
  const matrix = new Array(20736).fill(0), mPly = new Array(20736).fill(-1);   // the 144×144 cloud
  const seen = new Set(), queued = new Set();
  let frontier = [...new Set((startAnchors || []).filter(a => a >= 0 && a < 144 && COORDS[a]))].map(a => [a, 0]);
  for (const [a] of frontier) queued.add(a);
  if (frontier.length) { const s = frontier[0][0]; if (ply[s] < 0) ply[s] = 0; heat[s] += 1; }
  let hops = 0, maxPly = 0;
  const t0 = Date.now();
  try {
    // THE EXPLOSION IS CONCURRENT (AR-1: a parallel, time-budgeted cascade — never a sequential
    // loop). Each ply's hops are real pmu-onchip processes fired TOGETHER; serializing them spent
    // the whole budgetMs on process-spawn overhead (2006ms > 1500ms budget) and the walk was cut
    // off mid-flight — the under-filled lattice the operator flagged. Determinism is preserved:
    // results merge in frontier order (Promise.all keeps order), the chip read itself is exact.
    while (frontier.length && hops < budget && (Date.now() - t0) < budgetMs) {
      const batch = [];
      for (const [cur, d] of frontier) {
        if (seen.has(cur) || d > maxDepth) continue;
        if (hops + batch.length >= budget) break;
        seen.add(cur); if (ply[cur] < 0) ply[cur] = d; if (d > maxPly) maxPly = d;
        batch.push([cur, d]);
      }
      if (!batch.length) break;
      // ONE chip process per hop, all of this ply's hops in flight at once (the spawned PMU
      // processes of the explosion).
      const reads = await Promise.all(batch.map(([cur]) =>
        pExecFile(DAEMON, ['--ballistic', '--grid', tmp, '--start', COORDS[cur], '--max-depth', '1'], { maxBuffer: 5e8 })
          .then(({ stdout }) => JSON.parse(stdout)).catch(() => null)));
      hops += batch.length;
      const next = [];
      for (let b = 0; b < batch.length; b++) {
        const [cur, d] = batch[b]; const frames = reads[b];
        if (!frames) continue;
        const last = Array.isArray(frames) ? frames[frames.length - 1] : frames; const visits = (last && last.visits) || {};
        const rowCells = [];
        for (let j = 0; j < 144; j++) { const w = Number(visits[cur * 144 + j] || 0); if (w > 0 && j !== cur) rowCells.push([j, w]); }
        // RANK ShortLex-block-aware: ascending anchor index IS gestalt-boundary-first (block starts
        // before members) — the "high-ranking ones at the beginning of the blocks". NOT weight-sorted.
        rowCells.sort((a, b2) => a[0] - b2[0]);
        const fade = Math.pow(decay, d);
        // the whole READ row paints the cloud (the XOR gates' hits), decayed by ply…
        for (const [j, w] of rowCells) { const cell = cur * 144 + j; matrix[cell] += w * fade; if (mPly[cell] < 0) mPly[cell] = d; }
        // …but only the TOP-K ranked UNSEEN are FOLLOWED (transpose: column j → next row j) — guided,
        // not flood. Choosing among UNSEEN keeps the cascade ALIVE into deeper plies: ShortLex-ascending
        // alone re-picks the same low anchors every row, the seen-set collides, and the walk died at
        // ply 2 — one colour, no depth ("doesn't have the clouds getting smaller or changing colour").
        // A process for a row already walked adds nothing; the explosion spends itself on new rows.
        let followed = 0;
        for (const [j] of rowCells) {
          if (followed >= topK) break;
          // heat ONLY on anchors actually FOLLOWED — heating every scanned candidate re-painted the
          // low-index (top-row) anchors on every hop: structural pile-up identical in intent AND
          // reality, collapsing their divergence (the σ 8.5→2 regression). Scanned-but-seen ≠ walked.
          if (seen.has(j) || queued.has(j)) continue;
          if (d + 1 > maxDepth) break;
          if (ply[j] < 0) ply[j] = d + 1;
          heat[j] += fade;
          next.push([j, d + 1]); queued.add(j); followed++;
        }
        // STREAM the hop out as it completes — the guided walk's natural frame is the HOP
        // (each hop = one chip process), so a live renderer/log can follow the explosion
        // without waiting for the budget to drain. No behaviour change when absent.
        if (onHop) onHop({ hop: hops - batch.length + b + 1, anchor: COORDS[cur], ply: d, row_cells: rowCells.length, followed: rowCells.slice(0, topK).map(([j]) => COORDS[j]), elapsed_ms: Date.now() - t0 });
      }
      frontier = next;
    }
  } finally { try { unlinkSync(tmp); } catch { /* */ } }
  return { heat, ply, hops, maxPly, matrix, mPly };
}

// alias kept for callers/guards that name the leaf walk explicitly (same guided engine).
export const leafWalk144 = (gridBits, startAnchor, opts = {}) => definerWalk144([startAnchor], { ...opts, gridBits });
