#!/usr/bin/env node
// scripts/pmu/definer-walk-144.mjs — THE GUIDED ROW→TRANSPOSE→ROW WALK AT 144, ON CHIP.
//
// Operator: "The walk is 144 on chip" + "start new pmu-onchip process every time." The leaf-walk
// runs the right ALGORITHM but in JS over the 12 axes. This runs it over the 144 ANCHORS, on the
// metal: the whole walk is ONE `pmu-onchip --definer-walk` process (lens.rs definer_walk, 2026-09-14); before that each hop was a `--ballistic` process. Start at the chosen pixel → ballistic
// from it (one ply) → its ROW's significant column(s) j → TRANSPOSE (column index j → the next
// anchor/row) → ballistic from j → recurse. Guided (follows the significant weight), not a blind
// aggregate. Asymmetric directed connectivity so the walk flows outward + decays + terminates.
//
// @canonical-algorithm  guided row→transpose→row definer walk, 144 anchors, ON CHIP (pmu-onchip --definer-walk, one process; the per-hop --ballistic driver retired 2026-09-14)
// @forbidden-alternative  leaf-walk.mjs (right algo, WRONG substrate: 12-axis JS) · cole-trace.mjs (blind --ballistic fan-out — NOT the definer chain)
// @why  we escape the regressive-definition problem by walking the definer-OF-definer on silicon; a JS/12×12 or a blind fan-out throws away the whole differentiator and only LOOKS right (speed/symmetry are the only tells)
// @guard  tests/pmu-simulator/dogfood-success-factors.test.mjs (SF1,SF2,SF5) · tests/pmu-simulator/gemini-spec-inspection.test.mjs · scripts/pmu/validate-dogfood.sh

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
// THE ONE resolver — same canonical binary in every context (see src/lib/pmu/pmu-binary.mjs).
const { resolvePmuBinary } = await import(resolve(REPO, 'src/lib/pmu/pmu-binary.mjs'));
const { WALK_KNOBS, floorKnobs } = await import(resolve(REPO, 'src/lib/pmu/walk-knobs.mjs'));   // THE ONE WALK-KNOB HOME + THE FLOOR
const DAEMON = resolvePmuBinary(REPO);
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
// budgetMs default 600000: the DETERMINISTIC hop budget (`budget`) terminates the walk; the wall
// clock is a last-resort bound only. A 1500ms default here silently handed any caller that omitted
// budgetMs a machine-speed-dependent σ (Marsh read, 2026-08-13: measured σ 5.47→7.63 varying ONLY
// budgetMs, walks converged by 200ms — the drift ran through the impostor-null shuffles).
// THE FLOOR: defaults come from THE ONE HOME and a caller asking for a SHALLOWER walk is raised to it —
// floorKnobs in walk-knobs.mjs, shared with the tape door (one rule, one place).
export async function definerWalk144(startAnchors, { gridBits = null, maxDepth, topK, budget, budgetMs, decay, onHop = null } = {}) {
  // ONE RUST (operator 2026-09-14: "only the one same rust for all"): the walk runs inside pmu-onchip --definer-walk
  // (lens.rs definer_walk — the hop-for-hop port the tape walk already used, proven mask-identical to this driver's
  // per-hop process orchestration on 2026-09-14). This function is a thin caller: knobs floored at the home,
  // the grid handed over as a file when a caller supplies one, the answer mapped back field for field.
  const knobs = floorKnobs({ maxDepth, topK, budget, budgetMs, decay });
  ({ maxDepth, topK, budget, budgetMs, decay } = knobs);
  if (!existsSync(DAEMON)) throw new Error('pmu-onchip daemon not built');
  const seeds = [...new Set((startAnchors || []).filter((x) => x >= 0 && x < 144 && COORDS[x]))];
  let tmp = null;
  const args = ['--definer-walk', '--seeds', seeds.join(','), '--max-depth', String(maxDepth), '--top-k', String(topK), '--budget', String(budget), '--budget-ms', String(budgetMs), '--decay', String(decay)];
  if (gridBits) {
    tmp = resolve(REPO, `.thetacog/cache/leafwalk-grid-${process.pid}-${Math.floor(Math.random() * 1e6)}.json`);
    mkdirSync(dirname(tmp), { recursive: true }); writeFileSync(tmp, JSON.stringify(Array.from(gridBits, (x) => (x ? 1 : 0)))); args.push('--grid', tmp);
  } else { buildDirected(); }   // the directed connectivity file the binary reads by default
  const t0 = Date.now();
  let j;
  try { j = JSON.parse(execFileSync(DAEMON, args, { encoding: 'utf8', maxBuffer: 5e8 })); }
  finally { if (tmp) { try { unlinkSync(tmp); } catch { /* */ } } }
  if (onHop) for (const h of j.hop_log || []) onHop({ hop: h.hop, anchor: h.anchor, ply: h.ply, row_cells: h.row_cells, followed: h.followed, elapsed_ms: h.elapsed_ms });
  return { heat: j.heat, ply: j.ply, hops: j.hops, maxPly: j.max_ply, matrix: j.matrix, mPly: j.m_ply, timeBudgetTripped: !!j.time_budget_tripped, elapsedMs: Date.now() - t0, knobs: { maxDepth, topK, budget, budgetMs, decay }, knobsRaised: knobs.knobsRaised };
}

// alias kept for callers/guards that name the leaf walk explicitly (same guided engine).
export const leafWalk144 = (gridBits, startAnchor, opts = {}) => definerWalk144([startAnchor], { ...opts, gridBits });
