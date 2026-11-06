#!/usr/bin/env node
// scripts/vna/retrieval-bench.mjs — C187a: the retrieval benchmark. Does the row that answers an ask live where the ask lands?
//
// GROUND TRUTH: every transcript ask a spec row quotes verbatim (transcript-asks.mjs audit()) × every contract row in
// data/vna/spec-tree.json (each row carries .pixel and .walk.cells — the lit-cell SHAPE the one Rust walk recorded).
// SENSORS, each a distance from the ask to a row, each ranked over ALL rows (rank = 1 + strictly nearer + half the ties):
//   pixel  — block-grid L1 from the ask's walk pixel to the row's placed pixel (one point each; the C187a first run)
//   shape  — 1 − Jaccard over the two walks' lit cells (C176b: "shape match it" — the walk computed a mask, use it)
//   shapeW — the same, order-weighted (cell i weighs 1/(1+i) in walk order). pmu-onchip --lens returns no per-cell weight,
//            so walk ORDER is the only per-cell weight available on both sides; this is that, named honestly.
//   ncd    — text gzip-NCD, ask vs row text (the sensor the hook snowball orders by, C53b)
//   ncdLQ  — text NCD with the ask's own verbatim 8-word runs REMOVED from the row first. Ground truth is BUILT by verbatim
//            quoting (C187), so plain ncd is handed the answer; ncdLQ is the leak-free text sensor the geometry must be
//            compared against on level ground.
// FUSION: score = w · rank_shape + (1 − w) · rank_text (ranks, so the scales agree); w is FITTED on half A (grid 0..1 by 0.1,
//   minimum mean rank) and SCORED on half B, then the halves swap; the held-out number is every ask under the weight fitted
//   on the OTHER half. Never tuned and reported on the same half.
// NULL: the shuffled-ask null — K seeded permutations of which truth set belongs to which ask; z = (null mean − observed) / null sd
//   on the MEAN rank (positive = better than the null; the median is the headline but is a step function under the shuffle).
//   The fusion re-fits its weight under every shuffle.
// RETRO-SNOWBALL (C176c prototype): from the text top-1 row, add mass one row at a time, RE-WALK the concatenated read, and
//   stop when the read's lit-cell shape overlaps the ask's shape ≥ τ, or plateaus (2 steps without a rise, reported), or at
//   maxSteps (the cap). Two growth orders: 'ncd' (next-nearest to the ASK by text) and 'retro' (next-nearest to the READ's own
//   re-walked shape — the read chooses its own mass). At the stop step the grown read's shape/pixel is the query; reported is
//   the answering row's rank under it vs the single-shot ask walk, and whether the answering row is IN the read set, per τ,
//   held-out (τ chosen on A, scored on B, swapped).
// WALKS: lensWalk with tape and receiptsDir pointed at SCRATCH (never the real tape); each walk cached by text sha so a re-run
//   costs nothing; one walker at a time (the door serialises under load). LLM-free.
//
//   node scripts/vna/retrieval-bench.mjs [--transcript <jsonl>] [--scratch <dir>] [--K 200] [--seed 1] [--max-steps 6] [--no-retro] [--dry]
// → data/vna/retrieval-bench.json (latest) + data/vna/retrieval-bench.ndjson (history, one row per run)
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TREE = resolve(REPO, 'data/vna/spec-tree.json');
export const OUT_JSON = resolve(REPO, 'data/vna/retrieval-bench.json');
export const OUT_NDJSON = resolve(REPO, 'data/vna/retrieval-bench.ndjson');
export const DEFAULT_SCRATCH = join(tmpdir(), 'thetacog-retrieval-bench');   // outside the repo: the real tape is never a default
const SL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const sha12 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

// ── pure math ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const blk = (p) => { const [r, c] = String(p).split(','); return [SL.indexOf(r), SL.indexOf(c)]; };
export function blockL1(a, b) { const x = blk(a), y = blk(b); if (x.includes(-1) || y.includes(-1)) return Infinity; return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]); }
// jaccardDistance and retroStop live in retro-snowball.mjs (C582: one home for the bench and the live refresh), re-exported here
import * as RS from './retro-snowball.mjs';
const { growRead } = RS;
export const jaccardDistance = RS.jaccardDistance;   // the same function object, bound here (the C582 guard pins identity)
export const retroStop = RS.retroStop;
// order-weighted Jaccard: cell at index i weighs 1/(1+i); a cell in both sides contributes min(wA, wB) to the intersection, max to the union
export function weightedJaccardDistance(a, b) {
  const wa = new Map(), wb = new Map();
  (a || []).forEach((c, i) => { if (!wa.has(c)) wa.set(c, 1 / (1 + i)); });
  (b || []).forEach((c, i) => { if (!wb.has(c)) wb.set(c, 1 / (1 + i)); });
  if (!wa.size && !wb.size) return 1;
  let inter = 0, union = 0;
  for (const [c, w] of wa) { const v = wb.get(c) || 0; inter += Math.min(w, v); union += Math.max(w, v); }
  for (const [c, w] of wb) if (!wa.has(c)) union += w;
  return union ? 1 - inter / union : 1;
}
export const chanceRank = (N) => (N + 1) / 2;
// rank of the best answering row: 1 + rows strictly nearer + half the other rows tied with it
export function rankOf(dist, truthIds) {
  let best = Infinity;
  for (const t of truthIds) {
    if (!(t in dist)) continue; const d = dist[t]; let less = 0, ties = 0;
    for (const id in dist) { const v = dist[id]; if (v < d) less++; else if (v === d) ties++; }
    if (d === Infinity) { less = Object.keys(dist).length - ties; }
    const r = 1 + less + (ties - 1) / 2; if (r < best) best = r;
  }
  return best;
}
export const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : 0; };
export const hitAt = (ranks, k) => ranks.filter((r) => r <= k).length;

// seeded PRNG (mulberry32) — the null and the split are the same on every run
export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function shuffle(xs, r) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function splitHalves(ids, seed = 1) { const s = shuffle(ids, rng(seed)); return { A: s.filter((_, i) => i % 2 === 0), B: s.filter((_, i) => i % 2 === 1) }; }

// fusion: every row's fused score is w · rank_x(row) + (1 − w) · rank_y(row) (per-sensor ranks over ALL rows, so the scales
// agree), and the answering row's fused rank is its rank under that score. NOT a mix of the answering row's two ranks —
// that is linear in w and can only ever pick 0 or 1; the fused rank of the truth among all rows is what changes with w.
export const W_GRID = Array.from({ length: 11 }, (_, i) => +(i / 10).toFixed(1));
export function fitWeight(asks, distX, distY, truth) {
  let best = null;
  for (const w of W_GRID) { const m = mean(asks.map((a) => fusedRankOf(distX[a], distY[a], truth[a], w))); if (best === null || m < best.m - 1e-12) best = { w, m }; }
  return best ? best.w : 0.5;
}
export function fusedRankOf(distX, distY, truth, w) {
  const rx = toRanks(distX), ry = toRanks(distY); const fused = {};
  for (const id in distX) fused[id] = w * rx[id] + (1 - w) * ry[id];
  return rankOf(fused, truth);
}
export function toRanks(dist) {
  const ids = Object.keys(dist).sort((a, b) => dist[a] - dist[b]); const out = {}; let i = 0;
  while (i < ids.length) { let j = i; while (j + 1 < ids.length && dist[ids[j + 1]] === dist[ids[i]]) j++; const r = 1 + i + (j - i) / 2; for (let k = i; k <= j; k++) out[ids[k]] = r; i = j + 1; }
  return out;
}

// the shuffled-ask null: permute which truth set belongs to which ask, K times, seeded. The statistic is the MEAN rank: a
// tie-heavy sensor's median is a step function under the shuffle (sd 0 — no z can be taken on it); the median stays the headline.
export function shuffledNull(asks, truth, dists, { K = 200, seed = 1, statistic = null } = {}) {
  const r = rng(seed); const samples = [];
  const stat = statistic || ((perm) => mean(asks.map((a) => rankOf(dists[a], truth[perm[a]]))));
  for (let k = 0; k < K; k++) { const s = shuffle(asks, r); const perm = Object.fromEntries(asks.map((a, i) => [a, s[i]])); samples.push(stat(perm)); }
  return { K, seed, samples, median: median(samples), mean: mean(samples), sd: sd(samples) };
}
export const zScore = (nul, observed) => nul.sd > 0 ? (nul.mean - observed) / nul.sd : 0;

// ── text ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s).toLowerCase().replace(/[*_`"“”'’]/g, '').replace(/\s+/g, ' ').trim();
const WINDOW = 8;
// remove every verbatim 8-word run of the ask from the row text — the leak-free text sensor's input
export function stripQuotes(askText, rowText) {
  const w = norm(askText).split(' ').filter(Boolean); let t = norm(rowText);
  const probes = w.length <= WINDOW ? [w.join(' ')] : Array.from({ length: w.length - WINDOW + 1 }, (_, i) => w.slice(i, i + WINDOW).join(' '));
  for (const p of probes) if (p.length >= 8 && t.includes(p)) t = t.split(p).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

// ── the bench ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function loadRows(tree = TREE) {
  const t = JSON.parse(readFileSync(tree, 'utf8'));
  return Object.values(t.nodes).filter((n) => n.type === 'contract' && n.pixel && n.cue && n.walk && Array.isArray(n.walk.cells))
    .map((n) => ({ id: n.cue, pixel: n.pixel, cells: n.walk.cells, text: String(n.content?.text || ''), admissible: !!n.walk.admissible }));
}
export async function loadAsks(transcript) {
  const { audit } = await import('./transcript-asks.mjs');
  const out = audit({ transcript });
  return out.asks.filter((a) => a.rows.length).map((a) => ({ text: a.text, truth: a.rows.map((r) => r.id), at: a.at }));
}
// the real walker: lensWalk on a scratch tape, cached by text sha + cap
export async function makeWalker(scratch, { timeoutMs = 6000 } = {}) {
  const { lensWalk } = await import('../../src/lib/pmu/walk-door.mjs');
  mkdirSync(scratch, { recursive: true }); const cacheFile = join(scratch, 'walk-cache.json');
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const walker = (text, { maxChars = null } = {}) => {
    const key = sha12(text) + ':' + (maxChars || 'lens');
    if (cache[key]) return { ...cache[key], cached: true };
    const { result, row } = lensWalk(text, { source: 'probe', tape: join(scratch, 'probe-tape.ndjson'), receiptsDir: join(scratch, 'receipts'), timeoutMs, maxChars });
    const r = { pixel: row.pixel, cells: row.cells || [], admissible: !!row.admissible, ms: row.ms, err: row.err, deferred: !!(row.budget && row.budget.deferred) };
    if (r.pixel) { cache[key] = r; writeFileSync(cacheFile, JSON.stringify(cache)); }
    return r;
  };
  return walker;
}

const summarise = (ranks, N) => ({ n: ranks.length, median_rank: median(ranks), mean_rank: ranks.length ? +mean(ranks).toFixed(1) : null, hit1: hitAt(ranks, 1), hit10: hitAt(ranks, 10), chance: chanceRank(N) });

export async function runBench({ rows, asks, walker, scratch = DEFAULT_SCRATCH, K = 200, seed = 1, taus = [0.3, 0.5, 0.7], maxSteps = 6, retro = true, write = true, transcript = null } = {}) {
  const t0 = Date.now(); const N = rows.length; const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const { ncd } = await import('./transcript-asks.mjs');
  const walks = { count: 0, ms: 0, deferred: 0, admissible: 0 };
  const doWalk = (text, opts) => { const w = walker(text, opts); if (!w.cached) { walks.count++; walks.ms += Number(w.ms) || 0; if (w.deferred) walks.deferred++; } if (w.admissible) walks.admissible++; return w; };
  // 1 · single-shot: walk each ask once, distances to every row under every sensor
  const askIds = []; const truth = {}; const D = { pixel: {}, shape: {}, shapeW: {}, ncd: {}, ncdLQ: {} }; const askWalk = {}; const skipped = [];
  asks.forEach((a, i) => {
    const t = a.truth.filter((id) => byId[id]); if (!t.length) { skipped.push({ i, why: 'no answering row in the tree' }); return; }
    const w = doWalk(a.text); if (!w.pixel) { skipped.push({ i, why: w.err || 'no pixel' }); return; }
    const id = `q${i}`; askIds.push(id); truth[id] = t; askWalk[id] = w;
    const tl = a.text.toLowerCase();
    D.pixel[id] = {}; D.shape[id] = {}; D.shapeW[id] = {}; D.ncd[id] = {}; D.ncdLQ[id] = {};
    for (const r of rows) {
      D.pixel[id][r.id] = blockL1(w.pixel, r.pixel); D.shape[id][r.id] = jaccardDistance(w.cells, r.cells); D.shapeW[id][r.id] = weightedJaccardDistance(w.cells, r.cells);
      D.ncd[id][r.id] = ncd(tl, r.text.toLowerCase()); D.ncdLQ[id][r.id] = ncd(norm(a.text), stripQuotes(a.text, r.text));
    }
  });
  const sensors = {}; const ranks = {};
  for (const s of Object.keys(D)) {
    ranks[s] = Object.fromEntries(askIds.map((id) => [id, rankOf(D[s][id], truth[id])]));
    const rs = askIds.map((id) => ranks[s][id]); const nul = shuffledNull(askIds, truth, D[s], { K, seed });
    sensors[s] = { ...summarise(rs, N), null_mean_rank: +nul.mean.toFixed(1), null_sd: +nul.sd.toFixed(2), z: +zScore(nul, mean(rs)).toFixed(2) };   // z on the mean rank vs the shuffled-ask null
  }
  // 2 · fusion, held-out: shape × text (leak-free text), weight fitted on the other half; z re-fits under every shuffle
  const { A, B } = splitHalves(askIds, seed);
  const fusion = { pair: ['shape', 'ncdLQ'], folds: [], held_out: null };
  const heldOut = {};
  for (const [fit, score] of [[A, B], [B, A]]) {
    const w = fitWeight(fit, D.shape, D.ncdLQ, truth);
    const rs = score.map((id) => { const r = fusedRankOf(D.shape[id], D.ncdLQ[id], truth[id], w); heldOut[id] = r; return r; });
    fusion.folds.push({ fit_n: fit.length, w, scored_n: score.length, ...summarise(rs, N) });
  }
  const hoRanks = askIds.map((id) => heldOut[id]);
  const fusionNull = shuffledNull(askIds, truth, null, { K, seed, statistic: (perm) => {
    const tr = Object.fromEntries(askIds.map((id) => [id, truth[perm[id]]]));
    const out = [];
    for (const [fit, score] of [[A, B], [B, A]]) { const w = fitWeight(fit, D.shape, D.ncdLQ, tr); for (const id of score) out.push(fusedRankOf(D.shape[id], D.ncdLQ[id], tr[id], w)); }
    return mean(out);
  } });
  fusion.held_out = { ...summarise(hoRanks, N), null_mean_rank: +fusionNull.mean.toFixed(1), null_sd: +fusionNull.sd.toFixed(2), z: +zScore(fusionNull, mean(hoRanks)).toFixed(2) };
  // also the naive pair the first run used (pixel × plain ncd), same protocol, so the number is comparable
  const naive = {}; for (const [fit, score] of [[A, B], [B, A]]) { const w = fitWeight(fit, D.pixel, D.ncd, truth); for (const id of score) naive[id] = fusedRankOf(D.pixel[id], D.ncd[id], truth[id], w); }
  fusion.pixel_x_ncd_held_out = summarise(askIds.map((id) => naive[id]), N);
  // 3 · the retro-snowball, per growth order, per τ, held-out on τ
  let retroOut = null;
  if (retro) {
    const traj = {};   // askId → order → [{ step, added, overlap, pixel, cells, chars }]
    for (const id of askIds) {
      const a = asks[Number(id.slice(1))]; const S = askWalk[id].cells; traj[id] = {};
      for (const order of ['ncd', 'retro']) {
        // C582: the loop is retro-snowball.mjs growRead() — the same function the live sidecar refresh runs (tau null: the full
        // trajectory, every τ scored after the fact)
        const { steps } = growRead({ rows, askCells: S, textDist: (rid) => D.ncdLQ[id][rid], walk: doWalk, order, maxSteps, tau: null });
        traj[id][order] = steps;
      }
    }
    const evalAt = (id, order, tau) => {
      const steps = traj[id][order].filter((s) => s.overlap != null); const stop = retroStop(steps.map((s) => s.overlap), tau);
      if (!stop.step) return null; const s = steps[stop.step - 1];
      const shapeD = {}, pixD = {}; for (const r of rows) { shapeD[r.id] = jaccardDistance(s.cells, r.cells); pixD[r.id] = blockL1(s.pixel, r.pixel); }
      return { step: stop.step, why: stop.why, overlap: s.overlap, shape_rank: rankOf(shapeD, truth[id]), pixel_rank: rankOf(pixD, truth[id]), in_set: truth[id].some((t) => s.set.includes(t)), set_n: s.set.length, single_shape_rank: ranks.shape[id], single_pixel_rank: ranks.pixel[id], text_topk_hit: truth[id].some((t) => Object.keys(D.ncdLQ[id]).sort((x, y) => D.ncdLQ[id][x] - D.ncdLQ[id][y]).slice(0, s.set.length).includes(t)) };
    };
    retroOut = [];
    for (const order of ['ncd', 'retro']) for (const tau of taus) {
      const per = Object.fromEntries(askIds.map((id) => [id, evalAt(id, order, tau)]));
      const ok = askIds.filter((id) => per[id]);
      const sum = (ids) => { const e = ids.map((id) => per[id]); return { n: e.length, shape: summarise(e.map((x) => x.shape_rank), N), pixel: summarise(e.map((x) => x.pixel_rank), N), single_shape: summarise(e.map((x) => x.single_shape_rank), N), in_set: e.filter((x) => x.in_set).length, text_topk_in_set: e.filter((x) => x.text_topk_hit).length, mean_steps: e.length ? +mean(e.map((x) => x.step)).toFixed(2) : null, why: e.reduce((m, x) => (m[x.why] = (m[x.why] || 0) + 1, m), {}), mean_overlap: e.length ? +mean(e.map((x) => x.overlap)).toFixed(3) : null }; };
      retroOut.push({ order, tau, all: sum(ok), A: sum(A.filter((id) => per[id])), B: sum(B.filter((id) => per[id])) });
    }
    // τ chosen on A (best shape median rank, then in_set), scored on B, and swapped — per order
    for (const order of ['ncd', 'retro']) {
      const pick = (side) => retroOut.filter((r) => r.order === order).sort((x, y) => (x[side].shape.median_rank - y[side].shape.median_rank) || (y[side].in_set - x[side].in_set))[0];
      const tA = pick('A'), tB = pick('B');
      retroOut.push({ order, tau: 'held-out', fit_on_A_tau: tA.tau, scored_on_B: tA.B, fit_on_B_tau: tB.tau, scored_on_A: tB.A });
    }
  }
  const out = { at: new Date().toISOString(), transcript, n_rows: N, n_asks: askIds.length, skipped, chance: chanceRank(N), admissible_ask_walks: askIds.filter((id) => askWalk[id].admissible).length,
    sensors, fusion, retro: retroOut, walks: { ...walks, ms_per_walk: walks.count ? +(walks.ms / walks.count).toFixed(0) : null }, K, seed, taus, maxSteps, scratch, elapsed_ms: Date.now() - t0 };
  if (write) { mkdirSync(dirname(OUT_JSON), { recursive: true }); writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n'); appendFileSync(OUT_NDJSON, JSON.stringify({ ...out, retro: out.retro ? out.retro.map((r) => ({ order: r.order, tau: r.tau, all: r.all, scored_on_B: r.scored_on_B, scored_on_A: r.scored_on_A })) : null }) + '\n'); }
  return out;
}

export function printBench(o) {
  const L = [];
  L.push(`retrieval-bench · ${o.n_asks} asks × ${o.n_rows} rows · chance ${o.chance} · admissible ask walks ${o.admissible_ask_walks}/${o.n_asks} · walks ${o.walks.count} (${o.walks.ms_per_walk} ms each, ${o.walks.deferred} deferred) · ${(o.elapsed_ms / 1000).toFixed(0)} s`);
  L.push('  sensor    median  mean   hit@1 hit@10  null-mean   z');
  for (const [s, v] of Object.entries(o.sensors)) L.push(`  ${s.padEnd(9)} ${String(v.median_rank).padStart(6)} ${String(v.mean_rank).padStart(6)}  ${String(v.hit1).padStart(4)}  ${String(v.hit10).padStart(5)}   ${String(v.null_mean_rank).padStart(8)}  ${v.z}`);
  const f = o.fusion; L.push(`  fusion ${f.pair.join('×')} held-out: median ${f.held_out.median_rank} hit@1 ${f.held_out.hit1} hit@10 ${f.held_out.hit10} z ${f.held_out.z} (folds w=${f.folds.map((x) => x.w).join('/')}) · pixel×ncd held-out median ${f.pixel_x_ncd_held_out.median_rank} hit@10 ${f.pixel_x_ncd_held_out.hit10}`);
  if (o.retro) for (const r of o.retro) {
    if (r.tau === 'held-out') L.push(`  retro[${r.order}] τ fitted on A=${r.fit_on_A_tau} → B: shape median ${r.scored_on_B.shape.median_rank} (single ${r.scored_on_B.single_shape.median_rank}) hit@10 ${r.scored_on_B.shape.hit10}/${r.scored_on_B.n} in_set ${r.scored_on_B.in_set} · fitted on B=${r.fit_on_B_tau} → A: shape median ${r.scored_on_A.shape.median_rank} (single ${r.scored_on_A.single_shape.median_rank}) hit@10 ${r.scored_on_A.shape.hit10}/${r.scored_on_A.n} in_set ${r.scored_on_A.in_set}`);
    else L.push(`  retro[${r.order}] τ=${r.tau}: n ${r.all.n} steps ${r.all.mean_steps} overlap ${r.all.mean_overlap} why ${JSON.stringify(r.all.why)} · shape median ${r.all.shape.median_rank} hit@10 ${r.all.shape.hit10} (single-shot ${r.all.single_shape.median_rank}/${r.all.single_shape.hit10}) · pixel median ${r.all.pixel.median_rank} · in_set ${r.all.in_set} vs text top-k ${r.all.text_topk_in_set}`);
  }
  return L.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const { newestSession } = await import('./transcript-asks.mjs');
  const transcript = arg('--transcript', null) || newestSession();
  const scratch = resolve(arg('--scratch', DEFAULT_SCRATCH));
  const rows = loadRows(); const asks = await loadAsks(transcript);
  const walker = await makeWalker(scratch);
  const out = await runBench({ rows, asks, walker, scratch, K: Number(arg('--K', 200)), seed: Number(arg('--seed', 1)), maxSteps: Number(arg('--max-steps', 6)), retro: !argv.includes('--no-retro'), write: !argv.includes('--dry'), transcript });
  console.log(printBench(out));
  if (!argv.includes('--dry')) console.log(`→ ${OUT_JSON.replace(REPO + '/', '')} · ${OUT_NDJSON.replace(REPO + '/', '')}`);
}
