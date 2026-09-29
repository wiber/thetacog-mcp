#!/usr/bin/env node
// scripts/pmu/rc-compute.mjs — CLAIMED Rc, THE SOFTWARE TWIN (patent US 19/637,714, claim 2).
//
// WHAT THIS IS (AXIOM 0 register — the extension ladder, rung 1): the RUNG-1 SOFTWARE TWIN
// of claim 2's structural certainty metric Rc. Positions are addresses; the hierarchical
// boundary is DECIDABLE from the ShortLex parent of an anchor's row-axis and col-axis, so
// "same hierarchical level as the previous access → cache hit / crossing a hierarchical
// boundary → eviction" (claim 1) becomes a pure, re-runnable computation over the committed
// lattice. The claim's privileged hardware performance counter is RUNG-4 APPARATUS SCOPE
// (AXIOM 0, §10i, counter.rs) and is NOT read here — no hardware counter read is claimed.
// Rc → 1.00 is a ratio computed from measured drift, never a raw perf-counter read
// presented as delivered capability (CLAUDE.md, canonical numbers).
//
// THE CLAIM LANGUAGE THIS TWINS (docs/patent/us-19-637714/_claims.txt):
//   claim 2 — "structural certainty metric Rc defined as the ratio of cache hits to total
//             data accesses within a measurement window of W consecutive data retrievals"
//             + "a decay metric based on the hardware boundary-crossing count and the total
//             access count within the measurement window".
//   claim 1 — hit vs eviction: an access "within the same hierarchical level as a data
//             access at a previous time produces a cache hit"; "crossing a hierarchical
//             boundary relative to a data access at a previous time produces a cache-line
//             boundary eviction".
//   claim 7 — crossings to reach the 50% threshold = ln(2) / decay-rate.
//
// THE HIT/CROSSING DECISION, DOCUMENTED AGAINST CLAIM 1 (the construct, not a token):
//   The walked lattice is 144×144 cells; a cell's row-axis and col-axis are anchors labeled
//   by the 12-axis pair scheme the running walk driver uses (chip-intent-reality-delta.mjs:
//   rowAxis(i)=AXES[⌊i/12⌋], colAxis(i)=AXES[i%12]). The hierarchical PARENT of a 12-axis
//   name follows the ShortLex law (shortlex-registry.mjs): drop the last component —
//   parent(A1)=A; a depth-1 name (A,B,C) is its own root box. An anchor's parent box is the
//   pair (parent(rowAxis), parent(colAxis)) — 9 boxes of 16 anchors. A pair of consecutive
//   accesses is a HIT when BOTH the parent-row box and the parent-col box are unchanged
//   (claim 1: same hierarchical level as the previous access); ANY change is a boundary
//   CROSSING (claim 1: eviction). The first retrieval has no prior and is counted on the
//   crossing side, so Rc = hits / total-accesses matches claim 2's ratio exactly.
//
// TWO CONSTRUCTS, BOTH COMPUTED, LABELED (their agreement/disagreement is a finding):
//   STRUCTURAL Rc  — exact, no sampling: over the lattice's real edge set (edge i→j iff the
//                    anchors share a row OR column axis — the canonical buildIntentGrid rule),
//                    the fraction of transitions that stay in-box. Every anchor has exactly
//                    22 out-edges (11 same-row + 11 same-col) of which 3+3 stay in-box, so
//                    the probability-weighted and edge-count fractions coincide: 864/3168 = 3/11.
//   WALK-MEASURED Rc — over the REAL recursive ballistic walk's emitted access sequence:
//                    pmu-onchip --ballistic frames carry newCells per ply in visitation
//                    order (deterministic — verified same-sequence-twice), the walk's
//                    first-visit paint order over the 20736-cell lattice memory. Revisits
//                    (stackedCells) are aggregate-only in the frames and are excluded; this
//                    is the first-visit access sequence, labeled as such.
//
// USAGE:  node scripts/pmu/rc-compute.mjs [--window W] [--scatter] [--json]
//         [--depth D] [--start LABEL]
//   --window W  claim 2's W (the "hardware configuration register" value). Default 64:
//               register-friendly power of two, wide enough that one window spans several
//               row-sweeps (a lit row holds ≤22 in-lattice neighbors) yet short enough that
//               ~200 windows tile the ~13k-access walk.
//   --scatter   swap in the pathological layout (box = (row+col) mod 12 diagonals) that
//               destroys parent contiguity — the smoke the guard tests with.
//
// LLM-FREE, deterministic, node + repo only. Runs in seconds.
// @guard tests/pmu-simulator/rc-compute.test.mjs

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';   // THE ONE resolver — honours PMU_BINARY, one canonical search (spec v2 Task 2)
import { PMU_SPAWN_DEADLINE } from '../../src/lib/pmu/pmu-binary.mjs';   // the postman fix — every walker spawn hangs up

export const N = 144;
export const BIN = resolvePmuBinary(process.cwd());
export const AXES = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export const rowAxis = (i) => AXES[Math.floor(i / 12)];
export const colAxis = (i) => AXES[i % 12];

// ShortLex parent of a 12-axis name: drop the last component (A1→A); depth-1 is its own root.
export const axisParent = (name) => name[0];

// ── LAYOUTS: anchor (0..143) → parent-box label ──────────────────────────────
// CANONICAL: the ShortLex parent boxes — (parent(rowAxis), parent(colAxis)), 9 boxes × 16.
export const canonicalLayout = (a) => `${axisParent(rowAxis(a))},${axisParent(colAxis(a))}`;
// SCATTERED (the smoke): box = (row+col) mod 12 — 12 diagonal boxes of 12. No two anchors
// sharing a row axis or a column axis ever share a box, so parent contiguity is destroyed
// BY CONSTRUCTION and structural Rc is exactly 0.
export const scatteredLayout = (a) => `D${(Math.floor(a / 12) + (a % 12)) % 12}`;

// ── the committed connectivity lattice (buildIntentGrid rule, as the running walk driver
//    chip-intent-reality-delta.mjs builds it): edge i→j iff share row OR column axis ──
export function connectivityGrid() {
  const g = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i !== j && (rowAxis(i) === rowAxis(j) || colAxis(i) === colAxis(j))) g[i * N + j] = 1;
  }
  return g;
}

// ── STRUCTURAL Rc: exact over the real edge set, no sampling ─────────────────
export function structuralRc(layout = canonicalLayout) {
  const g = connectivityGrid();
  let inBox = 0, total = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (!g[i * N + j]) continue;
    total++;
    if (layout(i) === layout(j)) inBox++;
  }
  // Degree-regular (22 out-edges per anchor), so edge-fraction == per-anchor-average.
  return { rc: inBox / total, hits: inBox, total, crossings: total - inBox };
}

// ── the REAL recursive ballistic walk's access sequence (first-visit order) ──
export function walkSequence(startLabel = 'A,A', depth = 6) {
  if (!existsSync(BIN)) throw new Error(`pmu-onchip not built at ${BIN} — the walk cannot run; this is "did not run", not "saw nothing"`);
  const grid = Array.from(connectivityGrid());
  const out = execFileSync(BIN, ['--ballistic', '--grid', '-', '--start', startLabel, '--max-depth', String(depth)],
    { ...PMU_SPAWN_DEADLINE, input: `[${grid.join(',')}]`, maxBuffer: 1 << 26 }).toString();
  const frames = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
  return frames.flatMap((f) => f.newCells); // per-ply visitation order, deterministic
}

// A cell in the 20736-space is (anchorRow, anchorCol); a consecutive pair of accesses is a
// HIT when both anchors' parent boxes are unchanged (claim 1's hierarchical-level test).
const cellRow = (c) => Math.floor(c / N);
const cellCol = (c) => c % N;
export function isHit(cellA, cellB, layout = canonicalLayout) {
  return layout(cellRow(cellA)) === layout(cellRow(cellB)) && layout(cellCol(cellA)) === layout(cellCol(cellB));
}

// ── WALK-MEASURED Rc over the whole sequence + claim-2 windows of W ──────────
// Rc(window) = hits / W (claim 2's ratio of cache hits to total data accesses). An access
// is a hit iff same-box as its immediate predecessor; the sequence's first retrieval has
// no prior and counts as a crossing — so the first window's Rc can never be 1.0 (honest
// artifact of the first retrieval, noted rather than smoothed).
export function measuredRc(seq, { layout = canonicalLayout, window = 64 } = {}) {
  let hits = 0;
  for (let k = 1; k < seq.length; k++) if (isHit(seq[k - 1], seq[k], layout)) hits++;
  const total = seq.length;
  const windows = [];
  for (let s = 0; s + window <= seq.length; s += window) {
    let h = 0;
    for (let k = Math.max(s, 1); k < s + window; k++) if (isHit(seq[k - 1], seq[k], layout)) h++;
    windows.push(h / window);
  }
  const mean = windows.length ? windows.reduce((a, b) => a + b, 0) / windows.length : NaN;
  return {
    rc: hits / total, hits, total, crossings: total - hits,
    window, windows: windows.length, windowMean: mean,
    windowMin: windows.length ? Math.min(...windows) : NaN,
    windowMax: windows.length ? Math.max(...windows) : NaN,
  };
}

// ── claim-7: crossings to the 50% threshold = ln(2)/k, k = the measured decay ──
// k here is the LATTICE's measured per-access decay metric (claim 2: crossings/total).
// It is a DIFFERENT number from the canonical calibrated constant k_E = 0.003 (0.3 bits
// per boundary crossing — per-crossing, never per-day; trust half-life ln(2)/k_E = 231
// days) — restated from CLAUDE.md's canonical numbers, never re-derived. Both are printed.
export const K_E_CANONICAL = 0.003;
export const claim7Crossings = (k) => Math.LN2 / k;

export function computeAll({ layout = canonicalLayout, window = 64, depth = 6, start = 'A,A' } = {}) {
  const structural = structuralRc(layout);
  const seq = walkSequence(start, depth);
  const walk = measuredRc(seq, { layout, window });
  const decayStructural = structural.crossings / structural.total; // claim 2's decay metric = 1 − Rc
  const decayWalk = walk.crossings / walk.total;
  return {
    structural: { ...structural, decay: decayStructural, claim7: claim7Crossings(decayStructural) },
    walk: { ...walk, decay: decayWalk, claim7: claim7Crossings(decayWalk) },
    // The smoke flag: a layout whose parent contiguity is destroyed collapses structural Rc.
    parentContiguityDestroyed: structural.rc < 0.05,
    canonical: { k_E: K_E_CANONICAL, halfLifeCrossings: Math.LN2 / K_E_CANONICAL },
  };
}

// ── C338: THE CROSSING IS COUNTED — the unit applied on the receipt ──────────
// Today's receipt (spec-drift, the commit panel, the extension's attest view) reports WHICH
// reality cells land out of lane; nothing on it counts crossings, though the book (Ch 0) already
// defines k_E as a per-crossing unit (operator 2026-09-26). This closes that gap on the walk that
// already exists here (walkSequence/measuredRc/isHit) — never a fresh walk, never a noun-count
// proxy over the reality cells (THE PROXY IS NOT THE THING).
//
// R1: a crossing = a consecutive-access pair whose parent box changed (measuredRc's `crossings`,
// already the claim-1 hit/eviction test; the first access has no prior and counts on the crossing
// side). R2: pass `sequence` to count over the SAME walk that rendered the commit's panel — no
// independent re-walk from 'A,A'; omit it only for standalone CLI/recompute use, where this falls
// back to its own walkSequence(start, depth) call (still LLM-free, still git-show-recomputable).
//
// BITS_PER_CROSSING = 0.3 is the CANONICAL DEFINED UNIT (CLAUDE.md: "0.3 bits per boundary
// crossing"), restated here, never re-derived — like the SI second (project decision,
// 2026-09-26). K_E_CANONICAL = 0.003 is the separate calibrated per-crossing trust-decay
// constant; both are printed, never merged into one figure.
export const BITS_PER_CROSSING = 0.3;

// R2 — LLM-FREE, RECOMPUTABLE AT AN ARBITRARY SHA: read a file's content from the IMMUTABLE commit
// object (`git show <sha>:<path>`), never the working tree (AXIOM 1 / W3 — "read a record the actor
// did not author"). A caller building a receipt for a commit that is not the checkout's current HEAD
// (or whose working tree has since been edited) must source its text this way, or two runs against
// the "same" sha can silently disagree because the disk moved out from under them.
export function readAtCommit(sha, relPath, cwd = process.cwd()) {
  if (!sha) throw new Error('readAtCommit: sha required');
  if (!relPath) throw new Error('readAtCommit: relPath required');
  return execFileSync('git', ['show', `${sha}:${relPath}`], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
}

// R3's W6 sufficiency pair (AXIOM 1) — stated once so every caller prints it instead of
// re-deriving a claim about what the count means.
export const SUFFICIENT_FOR = "how many parent-box boundaries this commit's walk crossed, recomputable by anyone from the same commit";
export const NOT_SUFFICIENT_FOR = 'whether any crossing was a defect, what it cost in joules or dollars, or what a reader lost';

// ── the SAME walk the commit's encircled panel emits (never a fresh 'A,A' structural re-walk) ──
// definerWalk144 (definer-walk-144.mjs) already returns `hopLog`, the ordered anchor-visitation
// record the binary computes for every panel/attest/triptych call (lens.rs definer_walk). A hop's
// `anchor` is a "row,col" 12-axis-pair coordinate string (0..143 space) — a SINGLE anchor, not a
// cell pair — so two consecutive hops are folded into ONE synthetic cell index (prevAnchor*N+
// curAnchor) to land back in the 20736-cell space isHit/measuredRc already classify. This is not a
// new walk and not a new hit/crossing rule — it is the existing rc-compute vocabulary applied to
// the panel's own emitted sequence instead of rc-compute's independent structural one.
export function coordToAnchor(coord) {
  const [r, c] = String(coord || '').split(',');
  const ri = AXES.indexOf(r), ci = AXES.indexOf(c);
  return (ri < 0 || ci < 0) ? -1 : ri * 12 + ci;
}

export function sequenceFromHopLog(hopLog) {
  const hops = Array.isArray(hopLog) ? hopLog : [];
  const anchors = hops.map((h) => coordToAnchor(h?.anchor)).filter((a) => a >= 0);
  const cells = [];
  for (let k = 1; k < anchors.length; k++) cells.push(anchors[k - 1] * N + anchors[k]);
  return cells;
}

// R4 — BOTH COUNTED: laneTest(cellIndex) -> boolean | undefined. undefined (no test supplied, or
// the test itself cannot place a given cell) means "not measured for lane" — R5 forbids a 0 or a
// proxy standing in for an absent measurement, so an untested cell is tallied separately, never
// folded into either side.
//
// R5 — REFUSAL: `refusalReason` short-circuits to UNMEASURED before any walk/hopLog is touched —
// the caller's own aperture-floor / lit-mass / "no walk ran" gate rides straight through to the
// same print contract, so every surface refuses the same way instead of inventing its own wording.
export function crossingReceipt({
  sequence = null, hopLog = null, refusalReason = null,
  layout = canonicalLayout, window = 64, depth = 6, start = 'A,A', laneTest = null, sha = null,
} = {}) {
  if (refusalReason) {
    const reason = String(refusalReason);
    return { measured: false, reason, print: () => `crossings: UNMEASURED (${reason})` };
  }
  let seq = sequence;
  if (seq == null && hopLog != null) {
    seq = sequenceFromHopLog(hopLog);
    if (seq.length < 2) {
      const reason = `hop_log too short to count a crossing (${Array.isArray(hopLog) ? hopLog.length : 0} hop(s) → ${seq.length} cell(s))`;
      return { measured: false, reason, print: () => `crossings: UNMEASURED (${reason})` };
    }
  }
  if (seq == null) {
    try {
      seq = walkSequence(start, depth);
    } catch (err) {
      const reason = err.message;
      return { measured: false, reason, print: () => `crossings: UNMEASURED (${reason})` };
    }
  }
  if (!Array.isArray(seq) || seq.length < 2) {
    const reason = `walk sequence too short to count a crossing (${seq ? seq.length : 0} access(es))`;
    return { measured: false, reason, print: () => `crossings: UNMEASURED (${reason})` };
  }

  const walk = measuredRc(seq, { layout, window });
  const crossings = walk.crossings;
  const bits = crossings * BITS_PER_CROSSING;

  // The destination of transition k (k=1..len-1) is seq[k]; the first access (R1: counted on
  // the crossing side, no prior) has no transition partner, so its own cell IS its destination.
  const destinations = [seq[0]];
  for (let k = 1; k < seq.length; k++) if (!isHit(seq[k - 1], seq[k], layout)) destinations.push(seq[k]);

  let inLane = 0, outOfLane = 0, laneUnmeasured = 0;
  if (typeof laneTest === 'function') {
    for (const cell of destinations) {
      const verdict = laneTest(cell);
      if (verdict === true) inLane++;
      else if (verdict === false) outOfLane++;
      else laneUnmeasured++;
    }
  } else {
    laneUnmeasured = destinations.length;
  }
  const laneMeasured = laneUnmeasured === 0;

  const print = () => {
    const lines = [
      `crossings ${crossings} × ${BITS_PER_CROSSING} bits = ${bits.toFixed(4)} bits (unit applied: k_E = ${K_E_CANONICAL} per crossing, a defined unit like the SI second)`,
      laneMeasured
        ? `  in-lane ${inLane} + out-of-lane ${outOfLane} = ${inLane + outOfLane} total (matches crossings)`
        : `  lane split: UNMEASURED (${laneUnmeasured} destination cell(s) not tested against a declared intent shape)`,
      `  SUFFICIENT FOR: ${SUFFICIENT_FOR}.`,
      `  NOT SUFFICIENT FOR: ${NOT_SUFFICIENT_FOR}.`,
    ];
    if (sha) lines.unshift(`commit ${sha}:`);
    return lines.join('\n');
  };

  return {
    measured: true, crossings, bits, bitsPerCrossing: BITS_PER_CROSSING, kE: K_E_CANONICAL,
    inLane, outOfLane, laneMeasured, laneUnmeasured, total: walk.total, hits: walk.hits,
    sufficientFor: SUFFICIENT_FOR, notSufficientFor: NOT_SUFFICIENT_FOR, sha, print,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(f);
  const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const window = Number(opt('--window', 64));
  const depth = Number(opt('--depth', 6));
  const start = opt('--start', 'A,A');
  const layout = flag('--scatter') ? scatteredLayout : canonicalLayout;
  const r = computeAll({ layout, window, depth, start });

  if (flag('--json')) { console.log(JSON.stringify(r, null, 2)); return; }

  if (flag('--receipt')) {
    console.log(crossingReceipt({ layout, window, depth, start }).print());
    return;
  }

  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  console.log('━━ CLAIMED Rc — SOFTWARE TWIN (US 19/637,714 claim 2) ━━━━━━━━━━━━━━━━━━━');
  console.log(`layout: ${flag('--scatter') ? 'SCATTERED (pathological — parent contiguity destroyed)' : 'canonical ShortLex parent boxes'}`);
  console.log('');
  console.log(`STRUCTURAL Rc (exact, over the real edge set — no sampling):`);
  console.log(`  Rc = ${r.structural.hits}/${r.structural.total} = ${r.structural.rc.toFixed(6)} (${pct(r.structural.rc)})`);
  console.log(`  decay metric (crossings/total, claim 2) = ${r.structural.decay.toFixed(6)}`);
  console.log(`  claim-7 crossings to 50% = ln(2)/k = ${r.structural.claim7.toFixed(3)} at measured lattice k = ${r.structural.decay.toFixed(4)}`);
  console.log('');
  console.log(`WALK-MEASURED Rc (real ballistic walk, first-visit access sequence, start ${start}, depth ${depth}):`);
  console.log(`  ${r.walk.total} accesses · ${r.walk.hits} hits · ${r.walk.crossings} crossings`);
  console.log(`  Rc (whole sequence) = ${r.walk.rc.toFixed(4)} (${pct(r.walk.rc)})`);
  console.log(`  windowed W=${r.walk.window} (claim 2's configuration-register value): ${r.walk.windows} windows · mean ${r.walk.windowMean.toFixed(4)} · [${r.walk.windowMin.toFixed(4)}, ${r.walk.windowMax.toFixed(4)}]`);
  console.log(`  decay metric = ${r.walk.decay.toFixed(4)} · claim-7 crossings to 50% = ${r.walk.claim7.toFixed(3)}`);
  console.log('');
  console.log(`canonical constant (restated, never re-derived): k_E = ${r.canonical.k_E} per boundary crossing · ln(2)/k_E = ${Math.round(r.canonical.halfLifeCrossings)} — a calibrated trust constant, a DIFFERENT number from the lattice decay above; both labeled.`);
  if (r.parentContiguityDestroyed) console.log('🚨 FLAG: parent contiguity destroyed — structural Rc has collapsed; this layout cannot satisfy claim 1\'s positional equivalence.');
  if (r.walk.rc < 0.5) console.log(`note: the walk's own hit ratio sits below claim 7's 50% phase-transition boundary — the definer walk is a boundary-crossing instrument by design; the finding is the number, stated, not smoothed.`);
  console.log('');
  console.log('SUFFICIENCY CONTRACT: this number IS the software twin of claim 2\'s Rc over the');
  console.log('committed lattice — decidable, re-runnable, LLM-free. It is NOT a hardware counter');
  console.log('read: the claim\'s privileged performance counter is apparatus scope (AXIOM 0 rung 4)');
  console.log('and is not read here, and this number says nothing about whether any code is bug-free');
  console.log('(Rice) — we don\'t claim that.');
}

if (resolve(process.argv[1] || '') === resolve(new URL(import.meta.url).pathname)) main();
