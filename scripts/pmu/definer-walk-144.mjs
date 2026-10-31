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
import { PMU_SPAWN_DEADLINE } from '../../src/lib/pmu/pmu-binary.mjs';   // the postman fix — every walker spawn hangs up
import { pmuPlatformLine } from './pmu-platform-line.mjs';   // C569: the shipped-binary-vs-this-machine check, read BEFORE exec

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
  // C569 (2026-10-02): a live Linux run found THIS at EXISTS-and-wrong-architecture — the npm
  // package ships pmu-onchip as Mach-O arm64, existsSync(DAEMON) is true on linux-x64 too, and
  // the exec below used to be the thing that found out, 11 OS-level "Exec format error" lines
  // deep into Pillar 7 with no context attached. Read the header BEFORE the spawn, never after.
  const platformLine = pmuPlatformLine(DAEMON);
  if (platformLine) throw new Error(platformLine);
  const seeds = [...new Set((startAnchors || []).filter((x) => x >= 0 && x < 144 && COORDS[x]))];
  let tmp = null;
  const args = ['--definer-walk', '--seeds', seeds.join(','), '--max-depth', String(maxDepth), '--top-k', String(topK), '--budget', String(budget), '--budget-ms', String(budgetMs), '--decay', String(decay)];
  if (gridBits) {
    tmp = resolve(REPO, `.thetacog/cache/leafwalk-grid-${process.pid}-${Math.floor(Math.random() * 1e6)}.json`);
    mkdirSync(dirname(tmp), { recursive: true }); writeFileSync(tmp, JSON.stringify(Array.from(gridBits, (x) => (x ? 1 : 0)))); args.push('--grid', tmp);
  } else { buildDirected(); }   // the directed connectivity file the binary reads by default
  const t0 = Date.now();
  let j;
  try { j = JSON.parse(execFileSync(DAEMON, args, { ...PMU_SPAWN_DEADLINE, encoding: 'utf8', maxBuffer: 5e8 })); }
  finally { if (tmp) { try { unlinkSync(tmp); } catch { /* */ } } }
  if (onHop) for (const h of j.hop_log || []) onHop({ hop: h.hop, anchor: h.anchor, ply: h.ply, row_cells: h.row_cells, followed: h.followed, elapsed_ms: h.elapsed_ms });
  // hopLog (C338): the binary already computes + returns this ordered anchor-visitation record
  // (lens.rs definer_walk, unconditionally) — it was read only for the onHop side-effect and then
  // dropped. Returning it costs nothing and lets a consumer (rc-compute.mjs's crossingReceipt) count
  // boundary crossings over THIS SAME walk instead of spinning up a second, unrelated one.
  return { heat: j.heat, ply: j.ply, hops: j.hops, maxPly: j.max_ply, matrix: j.matrix, mPly: j.m_ply, timeBudgetTripped: !!j.time_budget_tripped, elapsedMs: Date.now() - t0, knobs: { maxDepth, topK, budget, budgetMs, decay }, knobsRaised: knobs.knobsRaised, hopLog: j.hop_log || [] };
}

// alias kept for callers/guards that name the leaf walk explicitly (same guided engine).
export const leafWalk144 = (gridBits, startAnchor, opts = {}) => definerWalk144([startAnchor], { ...opts, gridBits });

// ── C610a — THE ENSEMBLE WALK: the same walk from K ingress points over ONE grid ─────────────────────
// A thin layer over the start-anchor slice definerWalk144 already takes (lens.rs definer_walk(grid, coords,
// start_anchors, o)). For each ingress cell it runs the walk ONCE from that cell alone, then returns the mean
// heat (144), the per-cell spread across ingress (population sd, 144), the per-ingress marginal change of the
// running mean (L1 — the diminishing-returns curve), and the ingress set used. K = 1 with rule top-k IS today's
// definerWalk144([s]) byte for byte: the ensemble CONTAINS the current walk and never replaces it.
// ORDER-FREE BY CONSTRUCTION: mean and spread are summed in ascending anchor order, so a permuted ingress list
// returns the same bytes; only the marginal curve is read in the order given (it is a curve over that order).
// RUST PORT (MAXIMISE RUST): the ensemble aggregates walks into a forecast that later rows DECIDE on, so its
// home is the crate — `pmu-onchip --ensemble-walk --seeds <csv>`, one process for all K, declared in
// data/vna/rust-punch-list.json `declared`. This mjs is the prototype the backtest uses.
// Sufficient for: whether more walks over the same bytes change what the door sees. NOT sufficient for: whether
// a forecast predicts anything (C610b).
export const INGRESS_RULES = Object.freeze(['top-k', 'intent-anchors', 'rooms']);
export const TOP_K_DEFAULT = 3;   // lens.rs run(): top_seeds(best_scores, coords, 3)

/** anchorScores(gridBits) → 144 lit counts, one per anchor ROW of the 144×144 grid (where a walk can leave from). */
export function anchorScores(gridBits) {
  const s = new Array(144).fill(0);
  if (!gridBits) return s;
  for (let a = 0; a < 144; a++) { let n = 0; for (let j = 0; j < 144; j++) if (gridBits[a * 144 + j]) n++; s[a] = n; }
  return s;
}

/** topSeeds(scores, k) — lens.rs top_seeds mirrored: score DESC, index ASC on ties, score > 0, coord present. */
export function topSeeds(scores, k = TOP_K_DEFAULT) {
  return scores.map((v, i) => [Number(v) || 0, i]).filter(([v, i]) => v > 0 && COORDS[i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, k).map((x) => x[1]);
}

/** ingressFor(rule, { grid, intentGrid, scores, k }) → anchor indices for one of the three named rules. */
export function ingressFor(rule, { grid = null, intentGrid = null, scores = null, k = TOP_K_DEFAULT } = {}) {
  if (rule === 'top-k') return topSeeds(scores || anchorScores(grid), k);
  if (rule === 'intent-anchors') { const s = anchorScores(intentGrid || grid); return s.map((v, i) => (v > 0 && COORDS[i] ? i : -1)).filter((i) => i >= 0); }
  if (rule === 'rooms') return AX.map((x) => COORDS.indexOf(`${x},${x}`)).filter((i) => i >= 0);   // the shapeFromCoord diagonal idiom
  throw new Error(`ensembleWalk: unknown ingress rule '${rule}' (one of ${INGRESS_RULES.join(', ')})`);
}

/**
 * ensembleWalk(grid, ingress[], { rule, walk, ...knobs }) → { rule, k, ingress, ingressCoords, meanHeat, spread,
 * marginal, perIngress, knobs }. `walk` is injectable for a fixture; the default is THE walk (definerWalk144).
 */
export async function ensembleWalk(grid, ingress, { rule = null, walk = definerWalk144, ...knobs } = {}) {
  const seen = new Set();
  const set = (ingress || []).filter((x) => Number.isInteger(x) && x >= 0 && x < 144 && COORDS[x] && !seen.has(x) && seen.add(x));
  const walks = [];
  for (const s of set) walks.push(await walk([s], { ...knobs, gridBits: grid }));
  const K = set.length;
  const order = set.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);   // ascending anchor ⇒ order-free sums
  const meanHeat = new Array(144).fill(0), spread = new Array(144).fill(0);
  if (K) {
    for (let c = 0; c < 144; c++) { let sum = 0; for (const i of order) sum += walks[i].heat[c]; meanHeat[c] = sum / K; }
    for (let c = 0; c < 144; c++) { let ss = 0; for (const i of order) { const d = walks[i].heat[c] - meanHeat[c]; ss += d * d; } spread[c] = Math.sqrt(ss / K); }
  }
  const marginal = []; const run = new Array(144).fill(0);
  walks.forEach((w, n) => { let l1 = 0; for (let c = 0; c < 144; c++) { const next = (run[c] * n + w.heat[c]) / (n + 1); l1 += Math.abs(next - run[c]); run[c] = next; } marginal.push(+l1.toFixed(6)); });
  const perIngress = walks.map((w, i) => ({ anchor: set[i], coord: COORDS[set[i]], reached: w.heat.filter((h) => h > 0).length, hops: w.hops }));
  return { rule, k: K, ingress: set, ingressCoords: set.map((s) => COORDS[s]), meanHeat, spread, marginal, perIngress, knobs: walks[0]?.knobs || null };
}

/** asForecast(ensemble, { candidate, label, aperture_version }) — the shape C610c's localise() reads (forecast-localise.mjs):
 *  mean/spread as 144-arrays in COORDS order, `coords` beside them, K + the ingress list, the candidate text walked, the aperture
 *  stamp. No stamp is passed through as null, and localise() refuses it (UNMEASURED) — never invented here. */
export function asForecast(e, { candidate = '', label = null, aperture_version = null } = {}) {
  return { label: label || `ensemble-${e.rule || 'adhoc'}-K${e.k}`, aperture_version, mean: e.meanHeat, spread: e.spread, coords: COORDS,
    K: e.k, ingress: { rule: e.rule, K: e.k, anchors: e.ingress, coords: e.ingressCoords }, marginal: e.marginal, candidate: String(candidate) };
}
