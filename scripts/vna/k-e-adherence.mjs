#!/usr/bin/env node
// scripts/vna/k-e-adherence.mjs — C664 k_E AS A PREDICTION WE CAN LOSE (operator 2026-10-05, verbatim: "I wonder if we can learn
// something about the irreversibility of a decision and plotted here in order to test the fundamental or graph the adherence to
// the .3 KE decision … we might be able to create a graph that is a trial or can of points in the direction of this being true").
//
// THE CONSTANT IS RESTATED, NEVER RE-DERIVED (CLAUDE.md CANONICAL NUMBERS): k_E = 0.003, 0.3 bits per boundary crossing, a defined
// unit; half-life = ln 2 ÷ k_E ≈ 231 crossings. The book defines it in chapter 2 (BOOK_LINK). What this file adds is the integer,
// not the yardstick: a decision is a COUNTABLE event on the record, and once it is counted k_E is a curve that can be drawn, fit,
// and lost.
//
// THE COUNT (chosen from what the record already counts, and why): a crossing = ONE PROMPT TURN. The steer hook writes one row per
// turn to .thetacog/vna-steer-metrics.ndjson (C93n), numbered `turn` from the session's first prompt; a /clear starts a new session
// id (the clear gauge ledger records the hand-off), so `turn − 1` IS "crossings since the last re-declaration" with no new counter.
// A commit was the other candidate (a cog, C659) — rejected here because the record gives commits no re-declaration boundary; the
// turn has one by construction. ADHERENCE per crossing = the walk's admission: the hook walks every prompt of ≥ 12 chars and the one
// Rust walk either ADMITS it (it landed in a declared leaf at the ratcheted threshold — the steering share the ledger already
// measures, target 1 of C93n) or RELEASES it. An ABSTAINED turn was never walked and is neither a hit nor a miss (censored).
//
// THE PREDICTION (data/vna/k-e-prediction.json, dated before the first reading; the blind registration is the C664 spec row's own
// commit): P(admitted | n crossings) = A · exp(−k·n) with k = 0.003. The reading fits A and k by maximum likelihood (Bernoulli), then
// A alone with k pinned at 0.003, and reports the likelihood-ratio test between them (χ², 1 df), a bootstrap interval for k over
// sessions, and the pre-registered interval that would REFUTE the prediction. A within-session fit (per-session A, one shared k,
// sessions with ≥ 8 walked turns) is reported beside it because the long sessions are survivors, not a random draw.
//
// SUFFICIENT FOR: whether the walk's admission share falls with crossings since the last re-declaration at the rate k_E names, on
// this record, under this count. NOT SUFFICIENT FOR: whether any decision was right (undecidable, Rice 1953); whether re-declaring
// CAUSES the share to recover (that is the coin-flip arm, UNMEASURED until it has n); or k_E on any other count of a decision.
// Observational, EXPLORATORY on every surface until the coin-flip arm reaches its bar.
//
// NEVER on any surface this file feeds (AXIOM 1): the physical-cost framing of a decision (it dies to "a bigger budget"), "every
// write evicts" (the law is evict OR retain), or a "quantum of exhaust" (k_E is a defined unit, not a measured constant).
// forbiddenFramings() is the construct the guard reads.
//
//   node scripts/vna/k-e-adherence.mjs            # print the reading
//   node scripts/vna/k-e-adherence.mjs --write    # write data/vna/k-e-adherence.json (the receipt the page and the pill read)
// LLM-free; pure readers over rows handed in; the I/O doors (readLedger, readJson, writeReceipt) are named and small.
// Port row: C664r — the fit (what DECIDES the verdict) ports to the crate beside the walk once the coin-flip arm is live.
// @guard tests/vna/c664-k-e-is-a-prediction-we-can-lose.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from './no-river.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const K_E = 0.003;                                   // CLAUDE.md CANONICAL NUMBERS — restated verbatim
export const HALF_LIFE = Math.log(2) / K_E;                 // ≈ 231 crossings (ln 2 ÷ k_E)
export const BOOK_LINK = '/book/chapters/02-universal-pattern-convergence#the-coherence-budget';
export const PREDICTION = 'data/vna/k-e-prediction.json';
export const RECEIPT = 'data/vna/k-e-adherence.json';
export const LEDGER = process.env.VNA_STEER_METRICS || resolve(REPO, '.thetacog/vna-steer-metrics.ndjson');
export const KE_N_FLOOR = Object.freeze({ walked: 200, sessions: 20 });   // below either: UNMEASURED
export const KE_BIN = 5, KE_BIN_MIN_N = 5;                  // a bin is drawn only with ≥ 5 walked turns
export const KE_WITHIN_MIN = 8;                             // a session enters the within-session fit with ≥ 8 walked turns
export const KE_DRAWS = 300, KE_SEED = 664;
export const KE_UNIT = 'crossings to half adherence';
export const KE_WHAT_COG = 'A cog is one minted unit of finished work: a commit whose guard failed on its parent and passes on it (C659). It is the unit tokens are read against; it is NOT the unit counted here.';
export const KE_WHAT_CROSSING = 'A crossing is one prompt turn: the hook numbers every turn from the session\'s first prompt, and a /clear starts a new session, so turn − 1 is the count of crossings since the last re-declaration. Adherence per crossing is whether the one walk admitted that turn into a declared leaf.';
export const KE_WHAT_PREDICTS = `k_E = ${K_E} per crossing: adherence decays as exp(−k_E·n), halving every ${Math.round(HALF_LIFE)} crossings.`;
export const KE_RECOMPUTE = 'node scripts/vna/k-e-adherence.mjs --write';

// ── the banned framings (AXIOM 1) — the construct, so a guard never greps for a paraphrase ───────────────────────
export const FORBIDDEN = Object.freeze([
  { re: /every write evicts/i, why: 'the law is evict OR retain — reversible computation erases nothing' },
  { re: /kinetic exhaust/i, why: 'k_E is not kinetic exhaust; the name is banned' },
  { re: /quantum of exhaust/i, why: 'k_E is a defined unit, not a measured constant' },
  { re: /\b(energy|energetic|heat|joule|joules|thermodynamic|thermodynamics)\b/i, why: 'the physical-cost framing dies to "a bigger budget" (AXIOM 1)' },
]);
/** every banned framing found in `text` → [{ phrase, why }] (empty when clean) */
export function forbiddenFramings(text) {
  const s = String(text || ''); const out = [];
  for (const f of FORBIDDEN) { const m = s.match(f.re); if (m) out.push({ phrase: m[0], why: f.why }); }
  return out;
}
/** every statement of the constant in `text` that is NOT labelled fitted/observed/measured → [{ kind, value }] */
export function constantStatements(text) {
  const s = String(text || ''); const out = [];
  for (const m of s.matchAll(/k_E\s*(?:=|≈|is)\s*(-?\d*\.?\d+)/g)) out.push({ kind: 'k_E', value: Number(m[1]) });
  for (const m of s.matchAll(/(?<!(?:fitted|observed|measured|read)\s)half-life\s*(?:=|≈|of|is|:)?\s*(-?\d*\.?\d+)/gi)) out.push({ kind: 'half-life', value: Number(m[1]) });
  return out;
}

// ── C880 k_E AS A FORMAL METHODS TARGET, WIRED TO THE SNOWBALL SENSOR (operator 2026-10-16, verbatim: "can we
// make ke a formal methods target.. and connect it to the homestasis snowball sensor.. (if it really is
// grounded we wont run into goodhearts - its a signal done right what is and is not going to be a dead end for
// the /steer process (wire them together)"). k_E ALREADY IS a formal methods target: OD1-OD4 on the property
// ledger (data/formal/harness-properties.json, CLAUDE.md CANONICAL NUMBERS crystal rows) PROVE the integer the
// tally is charged on, each seen to fail under a named Rust mutation. formalTargetStatus() reads the ledger's
// own OD rows rather than re-deriving a proof here — the proof lives in one place, and a row's status can fall
// (a later edit un-proves OD3) without this file drifting from it. The snowball's drift-grader (spec-tree.mjs
// grade(), C98i) calls kEGroundingGate() before it will mark a direction's k_E claim KEPT: an UNPROVED target
// cannot police drift without Goodharting — it would be grading a claim against a yardstick nobody has proved
// — so KEPT is withheld with a named why, never silently granted. CORRECTED and REFUSED are never gated: the
// gate only stands between a drifting claim and ACCEPTANCE, so the sensor is never a dead end for the rest of
// the /steer process.
export const KE_FORMAL_IDS = ['OD1', 'OD2', 'OD3', 'OD4'];
export const KE_FORMAL_LEDGER = resolve(REPO, 'data/formal/harness-properties.json');
/** the OD1-OD4 rows read off the formal methods ledger, and whether all four are PROVED (AIMED, in
 * formal-methods-aim.mjs's vocabulary: reachable AND seen to fail under its own mutation) */
export function formalTargetStatus(ledgerPath = KE_FORMAL_LEDGER) {
  const ledger = readJson(ledgerPath);
  const rows = (ledger && Array.isArray(ledger.properties) ? ledger.properties : [])
    .filter((r) => KE_FORMAL_IDS.includes(r.id))
    .map((r) => ({ id: r.id, status: r.status }));
  const aimed = rows.length === KE_FORMAL_IDS.length && rows.every((r) => r.status === 'PROVED');
  return { ids: KE_FORMAL_IDS, rows, aimed };
}
export function groundedForSnowball(ledgerPath = KE_FORMAL_LEDGER) { return formalTargetStatus(ledgerPath).aimed; }
/** Sufficient for: whether a direction's k_E claim may be graded KEPT on the snowball. NOT sufficient for:
 * whether the claim is right (Rice 1953) — only for whether the yardstick it is checked against is itself
 * proved. { ok:true, touches:false } when the text makes no k_E claim at all. */
export function kEGroundingGate(text, ledgerPath = KE_FORMAL_LEDGER) {
  const framings = forbiddenFramings(text);
  const expected = { k_E: K_E, 'half-life': Math.round(HALF_LIFE) };
  const drift = constantStatements(text).filter((s) => s.value !== expected[s.kind]);
  if (!framings.length && !drift.length) return { ok: true, touches: false };
  const status = formalTargetStatus(ledgerPath);
  if (!status.aimed) {
    const read = status.rows.length === KE_FORMAL_IDS.length ? status.rows.map((r) => `${r.id}:${r.status}`).join(', ') : `only ${status.rows.length}/${KE_FORMAL_IDS.length} OD rows found`;
    return { ok: false, touches: true, why: `k_E formal target not AIMED (${read}) — KEPT withheld, not spent on an unproved yardstick` };
  }
  if (drift.length) return { ok: false, touches: true, why: `states ${drift[0].kind} = ${drift[0].value}, not the canonical ${expected[drift[0].kind]} (CLAUDE.md) — the PROVED formal target (OD1-OD4) contradicts this; grade CORRECTED or REFUSED, never KEPT` };
  return { ok: false, touches: true, why: `${framings[0].phrase}: ${framings[0].why}` };
}

// ── the count ──────────────────────────────────────────────────────────────────────────────────────────────────
/** ledger rows → one point per WALKED turn: { session, n (crossings since re-declaration), admitted, at } */
export function crossingsOf(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !r.session || !Number.isInteger(r.turn) || r.turn < 1) continue;
    if (r.walk !== 'admitted' && r.walk !== 'released') continue;   // abstained: never walked — censored, not a miss
    out.push({ session: r.session, n: r.turn - 1, admitted: r.walk === 'admitted', at: r.at || null });
  }
  return out;
}
/** points → the groups the likelihood sums over: [{ n, w (walked), a (admitted) }] */
export function groupByN(points) {
  const g = new Map();
  for (const p of points) { const e = g.get(p.n) || { n: p.n, w: 0, a: 0 }; e.w++; if (p.admitted) e.a++; g.set(p.n, e); }
  return [...g.values()].sort((x, y) => x.n - y.n);
}

// ── the likelihood ─────────────────────────────────────────────────────────────────────────────────────────────
const EPS = 1e-9;
const prob = (A, k, n) => Math.min(1 - EPS, Math.max(EPS, A * Math.exp(-k * n)));
/** Bernoulli log-likelihood of P(admitted | n) = A·exp(−k·n) over grouped counts */
export function loglik(groups, A, k) {
  let s = 0;
  for (const g of groups) { const p = prob(A, k, g.n); s += g.a * Math.log(p) + (g.w - g.a) * Math.log(1 - p); }
  return s;
}
function golden(f, lo, hi, iters = 40) {
  const r = (Math.sqrt(5) - 1) / 2; let a = lo, b = hi, c = b - r * (b - a), d = a + r * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < iters; i++) { if (fc > fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); } }
  const x = (a + b) / 2; return { x, f: f(x) };
}
export const K_LO = -0.1, K_HI = 0.5;
/** A alone, k pinned */
export function fitA(groups, k) { const g = golden((A) => loglik(groups, A, k), 1e-4, 1); return { A: g.x, k, ll: g.f }; }
/** A and k by coordinate ascent from a coarse grid (the surface is unimodal in practice; the grid guards the start) */
export function fitFree(groups) {
  let best = { A: 0.5, k: 0, ll: -Infinity };
  for (let k = K_LO; k <= K_HI + 1e-12; k += 0.01) { const f = fitA(groups, k); if (f.ll > best.ll) best = f; }
  for (let round = 0; round < 6; round++) {
    const gk = golden((k) => loglik(groups, best.A, k), Math.max(K_LO, best.k - 0.05), Math.min(K_HI, best.k + 0.05));
    const fa = fitA(groups, gk.x);
    if (fa.ll <= best.ll + 1e-10) break;
    best = fa;
  }
  return best;
}
// χ² with 1 df: p = erfc(√(x/2)) — Numerical Recipes erfcc, fractional error < 1.2e-7
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const chi2p1 = (x) => (x <= 0 ? 1 : erfc(Math.sqrt(x / 2)));
function mulberry32(a) { return function () { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** the 95 % bootstrap interval of the free k, resampling SESSIONS with replacement (a session's turns are not independent) */
export function bootstrapK(points, { draws = KE_DRAWS, seed = KE_SEED } = {}) {
  const bySession = new Map(); for (const p of points) { if (!bySession.has(p.session)) bySession.set(p.session, []); bySession.get(p.session).push(p); }
  const sessions = [...bySession.values()]; if (sessions.length < 2) return { lo: null, hi: null, draws: 0 };
  const rnd = mulberry32(seed >>> 0); const ks = [];
  for (let d = 0; d < draws; d++) {
    const pts = []; for (let i = 0; i < sessions.length; i++) pts.push(...sessions[Math.floor(rnd() * sessions.length)]);
    ks.push(fitFree(groupByN(pts)).k);
  }
  ks.sort((a, b) => a - b);
  return { lo: ks[Math.floor(0.025 * draws)], hi: ks[Math.min(draws - 1, Math.floor(0.975 * draws))], draws };
}
/** per-session A, one shared k, over sessions with ≥ minWalked walked turns — the survivorship check */
export function fitWithin(points, { minWalked = KE_WITHIN_MIN } = {}) {
  const bySession = new Map(); for (const p of points) { if (!bySession.has(p.session)) bySession.set(p.session, []); bySession.get(p.session).push(p); }
  const groups = [...bySession.values()].filter((s) => s.length >= minWalked).map(groupByN);
  if (groups.length < 2) return { sessions: groups.length, walked: groups.reduce((s, g) => s + g.reduce((t, x) => t + x.w, 0), 0), free: null, fixed: null, lr: null, p: null };
  const profile = (k) => groups.reduce((s, g) => s + fitA(g, k).ll, 0);
  let best = { k: 0, ll: -Infinity };
  for (let k = K_LO; k <= K_HI + 1e-12; k += 0.01) { const ll = profile(k); if (ll > best.ll) best = { k, ll }; }
  const g = golden(profile, Math.max(K_LO, best.k - 0.05), Math.min(K_HI, best.k + 0.05)); if (g.f > best.ll) best = { k: g.x, ll: g.f };
  const fixed = { k: K_E, ll: profile(K_E) };
  const lr = 2 * (best.ll - fixed.ll);
  return { sessions: groups.length, walked: groups.reduce((s, g) => s + g.reduce((t, x) => t + x.w, 0), 0), free: { k: best.k, half_life: best.k > 0 ? Math.log(2) / best.k : null, ll: best.ll }, fixed, lr, p: chi2p1(lr) };
}
/** the drawn bins: [{ n0, n1, w, a, share, lo, hi, drawn }] */
export function binsOf(points, { width = KE_BIN, minN = KE_BIN_MIN_N } = {}) {
  const b = new Map();
  for (const p of points) { const n0 = Math.floor(p.n / width) * width; const e = b.get(n0) || { n0, n1: n0 + width - 1, w: 0, a: 0 }; e.w++; if (p.admitted) e.a++; b.set(n0, e); }
  return [...b.values()].sort((x, y) => x.n0 - y.n0).map((e) => { const [lo, hi] = wilson(e.a, e.w); return { ...e, share: e.a / e.w, lo, hi, drawn: e.w >= minN }; });
}

// ── the reading ────────────────────────────────────────────────────────────────────────────────────────────────
/** the verdict rule, pre-registered in the prediction file and applied here, never re-decided by a host */
export function verdictOf({ walked, sessions, ci, p, band, floor = KE_N_FLOOR }) {
  if (walked < floor.walked || sessions < floor.sessions) return { verdict: 'UNMEASURED', why: `n ${walked} walked turns over ${sessions} sessions — below the floor of ${floor.walked} over ${floor.sessions}` };
  if (ci.lo == null) return { verdict: 'UNMEASURED', why: 'no bootstrap interval' };
  if (ci.lo <= K_E && K_E <= ci.hi) return { verdict: 'HOLDS', why: `the 95 % interval of the fitted k [${ci.lo.toFixed(4)}, ${ci.hi.toFixed(4)}] contains ${K_E}` };
  const outside = ci.hi < band.lo || ci.lo > band.hi;
  if (outside && p < 0.05) return { verdict: 'LOSES', why: `the interval [${ci.lo.toFixed(4)}, ${ci.hi.toFixed(4)}] lies wholly outside the refutation band [${band.lo}, ${band.hi}] and the likelihood-ratio test of k = ${K_E} against a free k has p ${p.toExponential(2)}` };
  return { verdict: 'INDISTINGUISHABLE', why: `the interval [${ci.lo.toFixed(4)}, ${ci.hi.toFixed(4)}] excludes ${K_E} but not the whole band [${band.lo}, ${band.hi}]${p >= 0.05 ? ` (likelihood-ratio p ${p.toFixed(3)})` : ''} — this record cannot say` };
}
/** { prediction, receipt } → defects in their dating (a receipt that precedes its prediction is the cherry-pick) */
export function datingDefects({ prediction, receipt }) {
  const out = [];
  const pa = Date.parse(prediction && prediction.at), ra = Date.parse(receipt && receipt.at);
  if (!Number.isFinite(pa)) out.push('the prediction carries no date');
  if (!Number.isFinite(ra)) out.push('the receipt carries no date');
  if (Number.isFinite(pa) && Number.isFinite(ra) && pa > ra) out.push(`the prediction (${prediction.at}) is dated after the reading (${receipt.at})`);
  if (receipt && receipt.prediction && prediction && receipt.prediction.at && receipt.prediction.at !== prediction.at) out.push('the receipt names a prediction dated differently from the prediction file');
  return out;
}
/**
 * keReading({ rows, prediction, flips, at }) → the receipt. rows = ledger rows; prediction = data/vna/k-e-prediction.json;
 * flips = the coin-flip assignment file (or null); the ledger for the coin-flip arm does not exist yet, so the arm reads UNMEASURED.
 */
export function keReading({ rows = [], prediction, flips = null, at = new Date().toISOString(), draws = KE_DRAWS, seed = KE_SEED } = {}) {
  if (!prediction || !prediction.refute || !Number.isFinite(prediction.refute.k_lo) || !Number.isFinite(prediction.refute.k_hi)) throw new Error('keReading: the prediction must declare its refutation interval (refute.k_lo, refute.k_hi) before a reading is taken');
  const band = { lo: prediction.refute.k_lo, hi: prediction.refute.k_hi };
  const points = crossingsOf(rows); const groups = groupByN(points);
  const sessions = new Set(points.map((p) => p.session)).size;
  const abstained = (rows || []).filter((r) => r && r.walk === 'abstained').length;
  const n = { rows: (rows || []).length, walked: points.length, admitted: points.filter((p) => p.admitted).length, abstained, sessions, max_crossings: points.length ? Math.max(...points.map((p) => p.n)) : null };
  const bins = binsOf(points);
  let fit = null, within = null, verdict;
  if (points.length && sessions >= 2) {
    const free = fitFree(groups), fixed = fitA(groups, K_E);
    const lr = 2 * (free.ll - fixed.ll), p = chi2p1(lr);
    const ci = bootstrapK(points, { draws, seed });
    fit = {
      model: 'P(admitted | n) = A · exp(−k·n), Bernoulli maximum likelihood over walked turns',
      free: { A: free.A, k: free.k, half_life: free.k > 0 ? Math.log(2) / free.k : null, ll: free.ll },
      fixed: { A: fixed.A, k: K_E, half_life: HALF_LIFE, ll: fixed.ll },
      lr, df: 1, p, ci_k: [ci.lo, ci.hi], ci_half_life: [ci.hi > 0 ? Math.log(2) / ci.hi : null, ci.lo > 0 ? Math.log(2) / ci.lo : null], draws: ci.draws, seed,
      k_ratio: free.k / K_E,
      drop_over_10: { predicted: 1 - Math.exp(-K_E * 10), fitted: 1 - Math.exp(-free.k * 10) },
    };
    within = fitWithin(points);
    verdict = verdictOf({ walked: points.length, sessions, ci, p, band });
  } else verdict = { verdict: 'UNMEASURED', why: points.length ? 'fewer than 2 sessions' : 'no walked turn on the ledger' };
  const flipsN = flips && flips.assignments ? Object.keys(flips.assignments).length : 0;
  return {
    _what: 'C664 THE k_E READING — GENERATED by node scripts/vna/k-e-adherence.mjs --write from the steer metrics ledger and data/vna/k-e-prediction.json. Never hand-edit. EXPLORATORY: observational, no lever flipped; the coin-flip arm below is UNMEASURED until it has n.',
    at, cmd: KE_RECOMPUTE, status: 'EXPLORATORY', ledger: '.thetacog/vna-steer-metrics.ndjson',
    constant: { k_E: K_E, half_life: HALF_LIFE, unit: '0.3 bits per boundary crossing — a defined unit, restated from CLAUDE.md', book: BOOK_LINK },
    prediction: { file: PREDICTION, at: prediction.at, k: prediction.k, half_life: prediction.half_life, refute: band, rule: prediction.rule || null, blind: prediction.declared_blind_in || null },
    count: { crossing: KE_WHAT_CROSSING, adherence: 'the walk admitted the turn (released = not admitted; abstained = never walked, censored)', cog: KE_WHAT_COG },
    n, bins, fit, within, verdict,
    coin_flip: { arm: 'k-e-redeclare', assignments: prediction.coin_flip ? prediction.coin_flip.assignments : null, seed: prediction.coin_flip ? prediction.coin_flip.seed : null, flips: flipsN, n_pairs: 0, bar: 20, status: 'UNMEASURED', why: flipsN ? `${flipsN} flips declared, 0 pairs run — the runner is a later arm` : 'no flip file' },
    confounders: [
      'the admit threshold is the aperture ratchet\'s and moved with its version over the ledger — admission is read against the threshold in force at that turn',
      'long sessions are survivors: the pooled fit draws its late crossings from sessions that were not cleared; the within-session fit (one k, per-session A, sessions with ≥ 8 walked turns) is the check',
      'the ledger starts 2026-09-19; the count is one prompt turn, so a session that went quiet and resumed counts no crossing for the gap',
    ],
  };
}

// ── the drawing — both hosts paint this string ───────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f4 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(4));
const f0 = (v) => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(v)));
/** x = crossings since re-declaration, y = admitted share: the bins with their Wilson bars, the predicted curve at k_E, the fitted
 *  curve, and the shaded refutation band. Refuses to draw a curve over a reading with no refutation interval. */
export function keAdherenceSvg(r, { w = 480, h = 240 } = {}) {
  if (!r || !r.prediction || !r.prediction.refute || !Number.isFinite(r.prediction.refute.lo) || !Number.isFinite(r.prediction.refute.hi)) return `<p class="ke-un" data-ke-graph="UNMEASURED">k_E adherence: UNMEASURED — no refutation interval declared, so no curve is drawn</p>`;
  if (!r.fit || !r.bins || !r.bins.length) return `<p class="ke-un" data-ke-graph="UNMEASURED">k_E adherence: UNMEASURED — ${esc((r.verdict && r.verdict.why) || 'no reading')}</p>`;
  const P = { l: 44, r: 12, t: 22, b: 36 };
  const maxN = Math.max(10, r.n.max_crossings || 0);
  const X = (n) => P.l + (n / maxN) * (w - P.l - P.r);
  const Y = (v) => h - P.b - Math.max(0, Math.min(1, v)) * (h - P.t - P.b);
  const band = r.prediction.refute, A0 = r.fit.fixed.A;
  const steps = 60; const xs = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * maxN);
  const path = (k, A) => xs.map((n, i) => `${i ? 'L' : 'M'}${X(n).toFixed(1)},${Y(A * Math.exp(-k * n)).toFixed(1)}`).join(' ');
  const bandPoly = [...xs.map((n) => `${X(n).toFixed(1)},${Y(A0 * Math.exp(-band.lo * n)).toFixed(1)}`), ...[...xs].reverse().map((n) => `${X(n).toFixed(1)},${Y(A0 * Math.exp(-band.hi * n)).toFixed(1)}`)].join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${P.l}" x2="${w - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#2a2a2e"/><text x="${P.l - 4}" y="${(Y(v) + 4).toFixed(1)}" fill="#9a9aa2" font-size="11" text-anchor="end">${Math.round(v * 100)}%</text>`).join('');
  const axis = `<text x="${P.l}" y="${h - P.b + 16}" fill="#9a9aa2" font-size="11">0</text><text x="${w - P.r}" y="${h - P.b + 16}" fill="#9a9aa2" font-size="11" text-anchor="end">${maxN}</text><text x="${(P.l + w - P.r) / 2}" y="${h - 4}" fill="#9a9aa2" font-size="11" text-anchor="middle">crossings since the last re-declaration →</text>`;
  const bins = r.bins.filter((b) => b.drawn).map((b) => { const x = X((b.n0 + b.n1 + 1) / 2); return `<g data-bin="${b.n0}-${b.n1}" data-n="${b.w}"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(b.lo).toFixed(1)}" y2="${Y(b.hi).toFixed(1)}" stroke="#c8c8d0" opacity=".6"/><circle cx="${x.toFixed(1)}" cy="${Y(b.share).toFixed(1)}" r="${Math.min(6, 2 + Math.log10(b.w) * 1.6).toFixed(1)}" fill="#c8c8d0"><title>${esc(`crossings ${b.n0}–${b.n1}: ${b.a} of ${b.w} walked turns admitted (${Math.round(b.share * 100)} %, 95 % ${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)} %)`)}</title></circle></g>`; }).join('');
  const thin = r.bins.filter((b) => !b.drawn).length;
  const stamp = `<text data-ke-stamp="EXPLORATORY" x="${w - P.r}" y="${P.t - 8}" fill="#d9733f" font-size="11" text-anchor="end">EXPLORATORY · observational · coin-flip arm ${esc(String(r.coin_flip ? r.coin_flip.status : 'UNMEASURED'))} (${r.coin_flip ? r.coin_flip.n_pairs : 0} of ${r.coin_flip ? r.coin_flip.bar : 20})</text>`;
  const legend = `<div class="ke-legend" style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin:4px 0"><span><b style="color:#7cc4ff">dashed</b> k_E = ${K_E} predicts (half-life ${Math.round(HALF_LIFE)})</span><span><b style="color:#35a08a">solid</b> fitted k ${f4(r.fit.free.k)} [${f4(r.fit.ci_k[0])}, ${f4(r.fit.ci_k[1])}] · fitted half-life ${f0(r.fit.free.half_life)}</span><span><b style="color:#7cc4ff">shaded</b> the refutation band k ∈ [${band.lo}, ${band.hi}]</span><span>likelihood-ratio p ${r.fit.p < 1e-4 ? r.fit.p.toExponential(1) : r.fit.p.toFixed(3)} · n ${r.n.walked} walked turns, ${r.n.sessions} sessions${thin ? ` · ${thin} bins under ${KE_BIN_MIN_N} not drawn` : ''}</span><span data-ke-verdict="${esc(r.verdict.verdict)}"><b>${esc(r.verdict.verdict)}</b> — ${esc(r.verdict.why)}</span></div>`;
  return `<div class="ke" data-ke-graph="MEASURED" data-ke-verdict="${esc(r.verdict.verdict)}"><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="adherence against crossings since re-declaration, with the k_E prediction and the fitted curve" style="display:block;max-width:640px"><title>admitted share of walked turns by crossings since the last re-declaration; dashed: k_E = ${K_E} predicts; solid: the fitted curve; shaded: the band that would refute the prediction; bars: 95 % Wilson intervals</title>${stamp}${grid}${axis}<polygon data-refutation-band="${band.lo},${band.hi}" points="${bandPoly}" fill="#7cc4ff" opacity=".12"/>${bins}<path data-curve="predicted" d="${path(K_E, A0)}" fill="none" stroke="#7cc4ff" stroke-width="2" stroke-dasharray="5 4"/><path data-curve="fitted" d="${path(r.fit.free.k, r.fit.free.A)}" fill="none" stroke="#35a08a" stroke-width="2"/></svg>${legend}</div>`;
}
/** the C647d pill: the face is the fitted half-life in crossings against the 231 k_E names; behind the + the four lines the row
 *  asked for — what a cog is · what a crossing is · what k_E predicts · what we observed — and the book chapter */
export function keAdherencePill(r, { id = 'k-e-adherence' } = {}) {
  const has = !!(r && r.fit && r.fit.free);
  const hl = has ? r.fit.free.half_life : null;
  const observed = has ? `Over ${r.n.walked} walked turns in ${r.n.sessions} sessions the admitted share falls from ${Math.round((r.bins[0] ? r.bins[0].share : 0) * 100)} % at the first crossings; the fitted k is ${f4(r.fit.free.k)} per crossing (95 % ${f4(r.fit.ci_k[0])} to ${f4(r.fit.ci_k[1])}), ${r.fit.k_ratio.toFixed(1)}× the ${K_E} k_E names, fitted half-life ${f0(hl)} crossings; the likelihood-ratio test of k = ${K_E} against a free k gives p ${r.fit.p < 1e-4 ? r.fit.p.toExponential(1) : r.fit.p.toFixed(3)}. Verdict: ${r.verdict.verdict} — ${r.verdict.why}.${r.within && r.within.free ? ` Within sessions (${r.within.sessions} with ≥ ${KE_WITHIN_MIN} walked turns, one k, a share per session): k ${f4(r.within.free.k)}, p ${r.within.p < 1e-4 ? r.within.p.toExponential(1) : r.within.p.toFixed(3)}.` : ''}` : (r && r.verdict ? r.verdict.why : 'no reading');
  return {
    id, label: 'Adherence against decisions', value: has && hl != null ? Math.round(hl) : null, unit: `${KE_UNIT} (k_E predicts ${Math.round(HALF_LIFE)})`, n: has ? r.n.walked : 0,
    series: has ? r.bins.filter((b) => b.drawn).map((b) => +b.share.toFixed(3)) : [], why: has ? undefined : (r && r.verdict && r.verdict.why) || 'no reading',
    read: {
      left: `<p data-ke="what-cog">${esc(KE_WHAT_COG)}</p><p data-ke="what-crossing">${esc(KE_WHAT_CROSSING)}</p><p data-ke="what-predicts">${esc(KE_WHAT_PREDICTS)} The constant is defined in <a href="${BOOK_LINK}">chapter 2 of the book</a>; it is restated here, never re-derived.</p>`,
      right: `<p data-ke="what-observed">${esc(observed)}</p><p>EXPLORATORY: one record, no lever flipped. The pre-registered rule: HOLDS when the bootstrap interval of k contains ${K_E}; LOSES when it lies wholly outside the band the prediction file declares and the likelihood-ratio p is under 0.05; INDISTINGUISHABLE between; UNMEASURED under ${KE_N_FLOOR.walked} walked turns or ${KE_N_FLOOR.sessions} sessions.</p>`,
    },
    notFor: {
      left: '<p>Whether any decision was right — undecidable (Rice, 1953). This counts crossings and reads admission against them, never quality. Nor a physical cost of a decision: k_E is a defined unit, and nothing here is read off a meter.</p>',
      right: `<p>Whether re-declaring CAUSES the share to recover: that is the coin-flip arm (${r && r.coin_flip ? `${r.coin_flip.flips} flips declared, ${r.coin_flip.n_pairs} of ${r.coin_flip.bar} pairs run` : 'no flips'}), UNMEASURED until it has n. The admit threshold moved with the aperture version over the ledger, and the late crossings come from sessions that were not cleared.</p>`,
    },
    mitigation: {
      left: `<p>Recompute it from your own ledger: <code>${esc(KE_RECOMPUTE)}</code>. The prediction file is dated before the reading; a reading dated before its prediction is the cherry-pick and the guard reads both dates.</p>`,
      right: '<p>Falsifier: a walked turn on the ledger counted at a crossing other than its turn − 1 within its session; a bin drawn under 5 turns; a receipt whose fitted k differs from a re-run of the command over the same ledger bytes.</p>',
    },
  };
}

/** the registry row for data/vna/measures.json — inserted the commit the component reaches a surface (a row for a graph not on
 *  the surface is a ghost under C647f) */
export const KE_MEASURE_ROW = Object.freeze({
  id: 'k-e-adherence-against-crossings',
  graph: 'adherence against crossings since re-declaration (C664): x crossings since the last re-declaration (turn − 1 within a session), y the admitted share of walked turns per 5-crossing bin with its Wilson bar; dashed the k_E = 0.003 prediction, solid the fitted exp(−k·n), shaded the pre-registered refutation band — one function (scripts/vna/k-e-adherence.mjs) painted by src/components/receipt/KEAdherence.tsx in the token-efficiency beat',
  surface: '/backup/adherence · the landing token-efficiency beat',
  bank: 'right',
  anchors: [{ file: 'scripts/vna/k-e-adherence.mjs', match: 'aria-label="adherence against crossings since re-declaration' }],
  sufficient_for: 'whether the walk\'s admission share falls with crossings since the last re-declaration at the rate k_E names, on this ledger, under the turn count',
  not_sufficient_for: 'whether any decision was right (Rice); whether re-declaring causes recovery (the coin-flip arm, UNMEASURED); k_E under any other count of a decision; the admit threshold moved with the aperture version',
  null: 'the pinned model k = 0.003 against a free k — a likelihood-ratio test, not a lever control; the coin-flip arm is the control and has no n',
  falsifier: 'a walked turn counted at a crossing other than turn − 1 within its session; a bin drawn under 5 turns; a receipt whose fitted k differs from a re-run over the same ledger bytes; a prediction file dated after the receipt',
  recompute: KE_RECOMPUTE,
  persuasion: { verdict: 'NO-CONTROL', why: 'observational — the likelihood-ratio p tests the prediction, not a lever; EXPLORATORY until the coin-flip arm has n', from: RECEIPT, fields: { fitted_k: 'fit.free.k', ci_lo: 'fit.ci_k.0', ci_hi: 'fit.ci_k.1', lr_p: 'fit.p', verdict: 'verdict.verdict', n_walked: 'n.walked' } },
});

// ── I/O doors ──────────────────────────────────────────────────────────────────────────────────────────────────
export function readLedger(path = LEDGER) { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
export function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function writeReceipt(r, path = resolve(REPO, RECEIPT)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(r, null, 1) + '\n'); return path; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prediction = readJson(resolve(REPO, PREDICTION));
  if (!prediction) { console.error(`no ${PREDICTION} — write the prediction before the reading`); process.exit(2); }
  const flips = prediction.coin_flip && prediction.coin_flip.assignments && existsSync(resolve(REPO, prediction.coin_flip.assignments)) ? readJson(resolve(REPO, prediction.coin_flip.assignments)) : null;
  const r = keReading({ rows: readLedger(), prediction, flips });
  if (process.argv.includes('--write')) console.log(`wrote ${writeReceipt(r)}`);
  console.log(`k_E ${K_E} (half-life ${Math.round(HALF_LIFE)}) · n ${r.n.walked} walked / ${r.n.abstained} abstained over ${r.n.sessions} sessions, max ${r.n.max_crossings} crossings`);
  if (r.fit) console.log(`fitted k ${f4(r.fit.free.k)} [${f4(r.fit.ci_k[0])}, ${f4(r.fit.ci_k[1])}] (fitted half-life ${f0(r.fit.free.half_life)}) · A ${r.fit.free.A.toFixed(3)} · LR ${r.fit.lr.toFixed(2)} p ${r.fit.p.toExponential(2)} · within-session k ${r.within && r.within.free ? f4(r.within.free.k) : '—'} p ${r.within && r.within.p != null ? r.within.p.toExponential(2) : '—'} (${r.within ? r.within.sessions : 0} sessions)`);
  console.log(`${r.verdict.verdict} — ${r.verdict.why}`);
  console.log(`coin-flip arm: ${r.coin_flip.status} — ${r.coin_flip.why}`);
}
