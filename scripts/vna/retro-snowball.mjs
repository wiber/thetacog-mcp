// scripts/vna/retro-snowball.mjs — C582: THE RETRO SNOWBALL, ONE HOME. Before C582 the grow-one-row-at-a-time loop lived only inside
// retrieval-bench.mjs runBench() step 3; the book (chapter 8, "The Trace Is Not the Chain of Thought") describes it as the snowball
// proper, so it moved here and both the bench and the live sidecar refresh (snowball-refresh.mjs) import it. Never two copies.
//
// WHAT IT DOES, sentence by sentence as the book states it (tests/vna/c582-the-engine-matches-the-book.test.mjs exercises each):
//   1 it starts from the one spec row nearest the ask by gzip compression distance (textDist; the live default is spec-tree.mjs ncd()).
//   2 it adds rows ONE AT A TIME; under order 'retro' each new row is the one whose walked shape (row.cells, the lit cells the one
//     Rust walk recorded for that row) sits nearest the shape of the read so far — the read chooses its own next mass. Order 'ncd'
//     (the bench's comparison arm) adds the next-nearest row to the ASK by text instead.
//   3 after every addition the WHOLE concatenated read is walked again (walk(readText)), and the overlap of its lit cells with the
//     ask's is recorded.
//   4 growth stops when that overlap reaches τ, or when two additions in a row fail to raise it (retroStop(): the peak is reported,
//     'plateau'), or at maxSteps ('cap').
//   5 the grown row set is what the bundle carries beside the leaf (carryRetro()), inside the same 1,500-token cap, cut first.
// THE SWITCH IS MEASURED, NEVER TASTE: retroLiveFlag() reads data/vna/retrieval-bench.json and turns the live path on only while the
// held-out retro read ranks the answering row better (lower median) than the one-shot ask walk on BOTH folds. VNA_RETRO_GROW=0 forces
// it off; nothing forces it on. LLM-free: gzip and the Rust walk, no model anywhere.
//
// WHAT IT IS NOT: the leaf pick. The leaf stays seedSpecFirst → activeLeaf/anchorSeed → applyHairsPick (C176f, the kept read ranker,
// held-out median 3 | 6.25 against this read's 118 | 200.5). The grown read chooses the NEIGHBOUR rows the worker is handed.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RETRO_BENCH = resolve(REPO, 'data/vna/retrieval-bench.json');
export const RETRO_MAX_STEPS = 6, RETRO_TAU = 0.3, RETRO_MAX_CHARS = 12000;

export function jaccardDistance(a, b) {
  const A = new Set(a || []), B = new Set(b || []); if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return 1 - inter / (A.size + B.size - inter);
}

// the stop rule over an overlap trajectory (overlap after step 1..n): τ reached → that step; else a plateau (two consecutive steps
// not above the running peak) → the peak step, why 'plateau'; else the cap (last step)
export function retroStop(overlaps, tau) {
  if (!overlaps.length) return { step: 0, why: 'none' };
  let peak = -1, peakStep = 0, flat = 0;
  for (let i = 0; i < overlaps.length; i++) {
    const o = overlaps[i]; if (o >= tau) return { step: i + 1, why: 'tau' };
    if (o > peak + 1e-12) { peak = o; peakStep = i + 1; flat = 0; } else { flat++; if (flat >= 2) return { step: peakStep, why: 'plateau' }; }
  }
  return { step: overlaps.length, why: 'cap' };
}

// the rows the snowball can grow over: contract rows that carry a walked shape (the same filter retrieval-bench loadRows() applies)
export function rowsOf(tree) {
  return Object.values((tree && tree.nodes) || {}).filter((n) => n.type === 'contract' && !n.retracted && n.pixel && n.cue && n.walk && Array.isArray(n.walk.cells))
    .map((n) => ({ id: n.cue, node: n.id, pixel: n.pixel, cells: n.walk.cells, text: String((n.content && n.content.text) || ''), origin: { kind: 'contract', node: n.id } }));
}

// C1175: THE SHEETS, THE RULES AND THE HATS JOIN THE WALK. rowsOf() above gives the contract rows; a turn that
// also wants the three folded kinds (scripts/vna/folded-nodes.mjs: sheet row, rule, hat) passes them here —
// merged into ONE candidate pool, same {id, cells, text, origin} shape growRead() already consumes. A node
// whose origin is incomplete (originComplete(), folded-nodes.mjs) is dropped HERE, before it is a candidate at
// all — the mechanical half of "the carry names each node's origin": a hole never becomes a row to grow over.
export async function mergeFolded(baseRows, foldedRows) {
  const { originComplete } = await import('./folded-nodes.mjs');
  const seen = new Set(baseRows.map((r) => r.id));
  const extra = (foldedRows || []).filter((r) => originComplete(r.origin) && !seen.has(r.id));
  return [...baseRows, ...extra];
}

// THE LOOP. rows [{id, cells, text}] · askCells: the ask's walked lit cells · textDist(rowId) → the ask-to-row text distance ·
// walk(text) → { pixel, cells } · tau null = run the full trajectory (the bench scores several τ after the fact); a number = stop live
// at τ/plateau (retroStop is prefix-decided, so the early stop lands on the same step the full trajectory would report).
export function growRead({ rows, askCells, textDist, walk, order = 'retro', maxSteps = RETRO_MAX_STEPS, tau = null, maxChars = RETRO_MAX_CHARS }) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const byText = rows.map((r) => r.id).sort((x, y) => (textDist(x) - textDist(y)) || (x < y ? -1 : x > y ? 1 : 0));
  const used = new Set(); const steps = []; let readText = ''; let readCells = null;
  for (let k = 0; k < maxSteps; k++) {
    let next;
    if (k === 0 || order === 'ncd' || !readCells) next = byText.find((r) => !used.has(r));
    else next = rows.filter((r) => !used.has(r.id)).map((r) => ({ id: r.id, d: jaccardDistance(readCells, r.cells) + 1e-6 * textDist(r.id) })).sort((x, y) => (x.d - y.d) || (x.id < y.id ? -1 : 1))[0]?.id;
    if (!next) break;
    used.add(next); readText += (readText ? '\n' : '') + byId[next].text;
    const w = walk(readText, { maxChars }) || {};
    if (!w.pixel) { steps.push({ step: k + 1, added: next, overlap: null, err: w.err || 'the walk wrote no pixel' }); break; }
    readCells = w.cells || [];
    steps.push({ step: k + 1, added: next, overlap: +(1 - jaccardDistance(readCells, askCells)).toFixed(3), pixel: w.pixel, cells: readCells, set: [...used], chars: readText.length });
    if (tau != null) { const s = retroStop(steps.map((x) => x.overlap), tau); if (s.why === 'tau' || s.why === 'plateau') break; }
  }
  const ok = steps.filter((s) => s.overlap != null);
  const stop = tau == null ? null : retroStop(ok.map((s) => s.overlap), tau);
  const at = stop && stop.step ? ok[stop.step - 1] : null;
  return { order, steps, stop, set: at ? at.set : [], overlap: at ? at.overlap : null, pixel: at ? at.pixel : null, cells: at ? at.cells : null };
}

// the live entry: the tree and the prompt in, the grown row set out. walk is injected (snowball-refresh passes lensWalk on a scratch
// tape; the guard passes a fixture walker) so nothing here spawns a binary on its own.
export async function retroGrow(tree, prompt, { walk, askCells = null, maxSteps = RETRO_MAX_STEPS, tau = RETRO_TAU, rows = null, textDist = null, order = 'retro' } = {}) {
  const R = rows || rowsOf(tree);
  if (!R.length) return { order, steps: [], stop: { step: 0, why: 'none' }, set: [], overlap: null, why: 'no walked contract rows in the tree' };
  let dist = textDist;
  // C612b: the spec rows are static anchors — the crate (pmu-onchip --door-serve, door.rs anchors/ncd) caches their gzip length once
  // per HEAD (.thetacog/anchor-clen/<head>.bin) and compresses only the prompt and the prompt+row pairs, with the same vendored zlib at
  // spec-tree.mjs's level 9. Absent crate (or PMU_DOOR_CRATE=0) → spec-tree.mjs ncd below, the reference.
  if (!dist) { const { crateTextDist } = await import('./door-crate.mjs'); dist = await crateTextDist({ rows: R, prompt }); }
  if (!dist) {
    const { ncd } = await import('./spec-tree.mjs');
    const p = String(prompt).toLowerCase(); const memo = new Map(); const byId = Object.fromEntries(R.map((r) => [r.id, r]));
    dist = (id) => { if (!memo.has(id)) memo.set(id, ncd(p, byId[id].text.toLowerCase())); return memo.get(id); };
  }
  let A = askCells;
  if (!A) { const w = walk(String(prompt)) || {}; if (!w.pixel) return { order, steps: [], stop: { step: 0, why: 'none' }, set: [], overlap: null, why: `the ask walk wrote no pixel${w.err ? ` (${w.err})` : ''}` }; A = w.cells || []; }
  const g = growRead({ rows: R, askCells: A, textDist: dist, walk, order, maxSteps, tau });
  return { ...g, start: g.steps[0] ? g.steps[0].added : null, askCells: A };
}

// THE MEASURED FLAG: on only while the held-out retro read beats the one-shot ask walk on both folds of the bench record
export function retroLiveFlag({ bench = RETRO_BENCH, env = process.env } = {}) {
  if (env.VNA_RETRO_GROW === '0') return { on: false, why: 'VNA_RETRO_GROW=0' };
  let b = bench;
  if (typeof bench === 'string') { if (!existsSync(bench)) return { on: false, why: 'UNMEASURED: no retrieval-bench.json on record' }; try { b = JSON.parse(readFileSync(bench, 'utf8')); } catch { return { on: false, why: 'UNMEASURED: retrieval-bench.json unreadable' }; } }
  const r = Array.isArray(b && b.retro) ? b.retro.find((x) => x.order === 'retro' && x.tau === 'held-out') : null;
  if (!r || !r.scored_on_A || !r.scored_on_B) return { on: false, why: 'UNMEASURED: no held-out retro row in the bench record' };
  const fold = (s) => ({ n: s.n, retro: s.shape.median_rank, single: s.single_shape.median_rank });
  const A = fold(r.scored_on_A), B = fold(r.scored_on_B);
  const beats = (f) => Number.isFinite(f.retro) && Number.isFinite(f.single) && f.retro < f.single;
  const on = beats(A) && beats(B);
  const tau = r.fit_on_A_tau === r.fit_on_B_tau ? r.fit_on_A_tau : RETRO_TAU;
  return { on, tau, at: b.at || null, chance: b.chance ?? null, A, B, why: on ? `held-out retro median ${B.retro} | ${A.retro} beats one-shot ${B.single} | ${A.single} (chance ${b.chance})` : `held-out retro median ${B.retro} | ${A.retro} does not beat one-shot ${B.single} | ${A.single} on both folds` };
}

// THE BUNDLE CARRIES THE GROWN SET: rows beside the leaf, inside the envelope's own cap, cut first (newest-added first) when it binds
export function carryRetro(env, grown, rows, { exclude = null } = {}) {
  if (!env || !env.cap || !grown) return env;
  const byId = Object.fromEntries((rows || []).map((r) => [r.id, r]));
  // C1175: a sheet/rule/hat row reaches the bundle only WITH its origin — the same hole folded-nodes.mjs's
  // originComplete() checks at the fold, checked again here because carryRetro is the one door every bundle
  // passes through; a contract row (origin.kind 'contract', or none yet on an older tree) is never dropped.
  const hasOrigin = (id) => { const o = byId[id] && byId[id].origin; return !o || o.kind === 'contract' ? true : (o.sheet || o.file || o.axis) ? true : false; };
  const set = (grown.set || []).filter((id) => id !== exclude && byId[id] && hasOrigin(id));
  env.retro_snowball = { order: grown.order, stop: grown.stop ? grown.stop.why : null, steps: grown.stop ? grown.stop.step : 0, overlap: grown.overlap, rows: set.map((id) => ({ cue: id, head: byId[id].text.replace(/\s+/g, ' ').slice(0, 160), origin: byId[id].origin || { kind: 'contract', node: id } })), cut: 0 };
  const size = () => JSON.stringify(env).length + 200;
  while (size() > env.cap.chars && env.retro_snowball.rows.length) { env.retro_snowball.rows.pop(); env.retro_snowball.cut++; }
  if (size() > env.cap.chars) delete env.retro_snowball;   // an envelope already at the cap carries no retro rows, never an overrun
  env.cap.chars_used = size(); env.cap.tokens_est = Math.ceil(env.cap.chars_used / (env.cap.chars / env.cap.tokens));
  return env;
}
