#!/usr/bin/env node
// scripts/pmu/knob-ratchet.mjs — THE KNOB RATCHET: the instrument's configuration ratchets itself (spec §8, 2026-09-16).
//
// Operator: "we probably can create a self ratcheting process … set this up to ratchet the configurations in the same way,
// and use formal methods on it to make sure it never misses." And, an hour later, the question that became the goal: "how
// can we be sure that the ratchet is gripping something real … that we're rating the configurations in the right direction?"
//
// The knobs (worms · perm · firstLatch) were "decided by the replay, never by taste" — a person ran the replay and read the
// table. This file is that decision as a loop, held to three disciplines the formal ledger can check:
//
//   SELECT on half A, CONFIRM on half B, MOVE THE FLOOR ONLY ON B (K1–K5). The frozen corpus (220 prompts, T4-deterministic
//   through the one door) is split by interleaved index into A (even) and B (odd). A candidate is run on A; if it does not
//   strictly beat the floor's A count it is rejected and B is NEVER run for it. If it beats A it is run on B.
//
//   RESOLUTION (KR1) — count-versus-count on 110 rows at a 3.6 % admit rate cannot tell a knob from noise (pass 1, 2026-09-16:
//   worms 6 read 7 vs 4 on A and 4 vs 4 on B). So every run keeps the PER-ROW verdict, which T4 makes exact and free, and B is
//   decided by the paired exact test on the DISCORDANT rows: b = rows the candidate admits and the floor does not, c = the
//   reverse. ACCEPT iff b > c AND the one-sided binomial P(X ≥ b | b + c, ½) ≤ 0.05. If b > c but the test does not clear,
//   the verdict is UNRESOLVED — the floor does not move, and the row says how many one-sided discordant rows it would have
//   taken. UNRESOLVED is a reading of the corpus's resolution, not a rejection of the knob.
//
//   DIRECTION (KR2, reported, not yet a criterion) — each corpus prompt is joined once to the NEXT commit-reality pixel on the
//   live tape (frozen in data/pmu/knob-outcomes.json, the same pairing grip-meter.mjs uses). Every run then reports, per
//   half, how many ADMITTED rows landed within two blocks of the action that followed. A knob that admits more rows while
//   fewer of them predict the action is admitting noise; the ratchet prints that beside the count so the direction is
//   visible. It becomes a veto (admitted-row hit rate must not fall below the floor's) only once the floor's own hit rate
//   clears the shuffled null — a veto on a number that is itself at the null would be a veto on noise. DP-K2.
//
//   SPECIFICITY (K3) — one nonsense line admitted on either half rejects the candidate. DOOR (K4) — over 250 ms rejects.
//   LEDGER (K5) — every candidate leaves a row, whatever happened to it.
//
//   WHAT IT CANNOT DO, stated first: it climbs only what the sensor can see. If nothing clears, the loop prints "no admissible
//   improvement in N candidates" as a READING of the sensor, and the floor stays.
//
// Guard: tests/formal/knob-ratchet.test.mjs. Real runner: ratchet-replay.runArm through walk-door → pmu-onchip. LLM-free.
//   data/pmu/knob-space.json      the finite candidate space (hand-authored)
//   data/pmu/knob-outcomes.json   corpus index → next commit pixel (frozen once from the live tape)
//   data/pmu/knob-floor.json      the current floor: config, per-row verdicts on A and B, history (only B rises)
//   data/pmu/knob-ratchet.ndjson  one row per candidate evaluated, append-only
//
//   node scripts/pmu/knob-ratchet.mjs --run [--max N] [--dry]     node scripts/pmu/knob-ratchet.mjs --check
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { writeReading } from './write-reading.mjs';
import { tmpdir } from 'node:os';
// C575 round 2: --action-read/--check/--dry/--format/--k/--kr3/--kr5/--kr7/--max/--objective/--path/
// --run/--seed/--set/--tol have no napi route (data/vna/linux-fallback-inventory.json) — a
// host-mismatched binary now resolves to null, tripping the existing `!bin || !existsSync(bin)`
// branch below into this file's OWN js-fallback (actionReadJs), exactly as an absent binary already
// did. Byte-identical on a matching host (the SAME path either way).
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';
import { guardBinary } from './engine-resolve.mjs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SPACE = resolve(REPO, 'data/pmu/knob-space.json');
export const FLOOR = resolve(REPO, 'data/pmu/knob-floor.json');
export const LEDGER = resolve(REPO, 'data/pmu/knob-ratchet.ndjson');
export const OUTCOMES = resolve(REPO, 'data/pmu/knob-outcomes.json');
const TAPE = resolve(REPO, '.thetacog/walk-tape.ndjson');
export const DOOR_CEILING_MS = 250;   // §5.7: an instrument that gets slower to get greener bought its number with latency
export const ALPHA = 0.05;            // KR1: the one-sided level the discordant rows must clear on B
export const ACTION_MARGIN = 0.25;    // KR16 (superseded by G3's GAP_MARGIN on 2026-09-16 — kept for the ndjson rows that cite it): the z margin the first pass used
export const LARGE = resolve(REPO, 'data/pmu/ratchet-corpus-large.json');
export const AGG_CACHE = resolve(REPO, 'data/pmu/kr14-agg-cache.json');
export const ACTION_FLOOR = resolve(REPO, 'data/pmu/knob-action-floor.json');
export const ACTION_LEDGER = resolve(REPO, 'data/pmu/knob-action-ratchet.ndjson');

const has = (f) => process.argv.includes(f);
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
export const cfgKey = (cfg) => Object.keys(cfg).sort().map((k) => `${k}=${cfg[k]}`).join('·');

// ── the space ──────────────────────────────────────────────────────────────────────────────────
export function candidates(space) {
  const keys = Object.keys(space.knobs).sort();
  let out = [{}];
  for (const k of keys) out = out.flatMap((c) => space.knobs[k].map((v) => ({ ...c, [k]: v })));
  return out;
}

// ── the split (K2: selection and confirmation are different halves, by construction) ──────────
export function splitCorpus(corpus) {
  const idx = (rows) => rows.map((r, i) => ({ ...r, corpus_index: r.corpus_index ?? i }));
  const all = idx(corpus.rows);
  const A = all.filter((r) => r.corpus_index % 2 === 0), B = all.filter((r) => r.corpus_index % 2 === 1);
  return { A: { ...corpus, rows: A }, B: { ...corpus, rows: B }, rule: 'interleaved by corpus index: A = even, B = odd' };
}

// ── KR1: the paired exact test on discordant rows ───────────────────────────────────────────────
// P(X ≥ b | n = b + c, p = ½), one-sided. Exact, no approximation; n is small by construction.
/** the family-wise bar: the one-sided z whose tail is 0.02275/k (z 2 split k ways) — Abramowitz–Stegun 26.2.23, |ε| < 4.5e-4. One place (KR7, KR19). */
export function zRequired(k = 1) { const p = 0.02275 / Math.max(1, k); const tt = Math.sqrt(-2 * Math.log(p)); return +(tt - (2.515517 + 0.802853 * tt + 0.010328 * tt * tt) / (1 + 1.432788 * tt + 0.189269 * tt * tt + 0.001308 * tt ** 3)).toFixed(2); }
export function binomTailGeq(b, n) {
  if (n === 0) return 1;
  let sum = 0; for (let k = b; k <= n; k++) sum += choose(n, k);
  return sum / 2 ** n;
}
function choose(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
/** smallest b with c = 0 that clears ALPHA — the "how many one-sided rows would it take" number */
export function discordantNeeded(alpha = ALPHA) { let b = 1; while (0.5 ** b > alpha) b++; return b; }
export function pairedTest(candRows, floorRows) {
  const f = new Map(floorRows.map((r) => [r.i, !!r.admissible]));
  let b = 0, c = 0, both = 0;
  for (const r of candRows) { const fa = f.get(r.i) || false; const ca = !!r.admissible; if (ca && !fa) b++; else if (!ca && fa) c++; else if (ca && fa) both++; }
  const n = b + c; const p = binomTailGeq(b, n);
  return { b, c, both, n, p: +p.toFixed(4), clears: b > c && p <= ALPHA, needed: discordantNeeded() };
}

// ── KR2: direction — did the admitted rows predict the action that followed? ───────────────────
const block = (px) => { if (!px || typeof px !== 'string') return null; const m = px.match(/^([ABC][123]?),([ABC][123]?)$/); return m ? m.slice(1) : null; };
const ORDER = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const cheb = (a, b) => Math.max(Math.abs(ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])), Math.abs(ORDER.indexOf(a[1]) - ORDER.indexOf(b[1])));
export function direction(rows, outcomes) {
  let admitted = 0, hits = 0, known = 0;
  for (const r of rows) {
    const o = outcomes[r.i]; if (!o || !o.commitPixel) continue; known++;
    if (!r.admissible) continue; admitted++;
    const a = block(r.pixel), c = block(o.commitPixel); if (a && c && cheb(a, c) <= 2) hits++;
  }
  return { known, admitted, hits, rate: admitted ? +(hits / admitted).toFixed(3) : null };
}

// ── KR3: THE VECTOR DERIVATIVE (spec §5.3–5.4, built 2026-09-16 as the direction objective the point hit could not be) ──
// A turn declares a MOVE: from = the previous turn's pixel in the same session under the same run, to = this turn's pixel.
// The action is a move too: parent commit pixel → own commit pixel (prevCommitPixel → commitPixel in the frozen outcomes).
// Agreement, exactly as §5.4 states it: cosine ≥ 0.5 when both vectors have magnitude ≥ 1 block; when either is the zero
// vector the turn declared "stay put" and agreement is Chebyshev(to, own) ≤ 1. Three rates, never one: destination-only
// (today's KR2 hit), direction agreement, and both. Each against a shuffled-pairing null (the same turns paired with the
// wrong actions, K draws, seeded) — the null that must destroy DIRECTION and DESTINATION at once, which is where z comes from.
// LEVERAGE (operator: "how much leverage do we get") is made a number here and nowhere else: aligned admitted rows per
// 1,000 rungs of search — the outcome the search bought, per unit of search it spent. Zero if nothing aligns.
const coord = (px) => { const b = block(px); return b ? [ORDER.indexOf(b[0]), ORDER.indexOf(b[1])] : null; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mag = (v) => Math.hypot(v[0], v[1]);
export function agree(v_declared, v_actual, to, own) {
  const md = Math.max(Math.abs(v_declared[0]), Math.abs(v_declared[1])), ma = Math.max(Math.abs(v_actual[0]), Math.abs(v_actual[1]));
  if (md < 1 || ma < 1) return Math.max(Math.abs(to[0] - own[0]), Math.abs(to[1] - own[1])) <= 1;   // "stay put" — a stronger claim, scored tighter
  const cos = (v_declared[0] * v_actual[0] + v_declared[1] * v_actual[1]) / (mag(v_declared) * mag(v_actual));
  return cos >= 0.5;
}
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
export function kr3(rows, outcomes, { k = 200, seed = 7, rungsTotal = null } = {}) {
  // pairs: rows with a from-pixel (previous same-session row in THIS run) and a known commit pair
  const lastBySession = new Map(); const pairs = [];
  for (const r of rows) {
    const prev = lastBySession.get(r.session); lastBySession.set(r.session, r);
    const o = outcomes[r.i]; const to = coord(r.pixel), own = o && coord(o.commitPixel), parent = o && coord(o.prevCommitPixel), from = prev && coord(prev.pixel);
    if (!to || !own || !parent || !from) continue;
    pairs.push({ i: r.i, admissible: !!r.admissible, from, to, parent, own });
  }
  const score = (ps, actualOf) => {
    let dest = 0, dir = 0, both = 0;
    for (const p of ps) { const a = actualOf(p); const d = Math.max(Math.abs(p.to[0] - a.own[0]), Math.abs(p.to[1] - a.own[1])) <= 2; const g = agree(sub(p.to, p.from), sub(a.own, a.parent), p.to, a.own); if (d) dest++; if (g) dir++; if (d && g) both++; }
    const n = ps.length || 1; return { dest: dest / n, dir: dir / n, both: both / n, n: ps.length, dest_n: dest, dir_n: dir, both_n: both };
  };
  const readings = {};
  for (const [name, ps] of [['admitted', pairs.filter((p) => p.admissible)], ['all', pairs]]) {
    const real = score(ps, (p) => p);
    const rnd = lcg(seed); const draws = { dest: [], dir: [], both: [] };
    for (let d = 0; d < k; d++) {
      const idx = ps.map((_, j) => j); for (let j = idx.length - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); [idx[j], idx[q]] = [idx[q], idx[j]]; }
      const s = score(ps, (p) => ps[idx[ps.indexOf(p)]]);
      draws.dest.push(s.dest); draws.dir.push(s.dir); draws.both.push(s.both);
    }
    const z = (x, arr) => { const m = arr.reduce((a, b) => a + b, 0) / (arr.length || 1); const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length || 1)) || 1e-9; return { rate: +x.toFixed(3), null_mean: +m.toFixed(3), null_sd: +sd.toFixed(3), z: +((x - m) / sd).toFixed(2) }; };
    readings[name] = { n: real.n, counts: { dest: real.dest_n, dir: real.dir_n, both: real.both_n }, destination_only: z(real.dest, draws.dest), direction: z(real.dir, draws.dir), both: z(real.both, draws.both) };
  }
  const aligned = readings.admitted.counts.both;
  const leverage = rungsTotal ? +((1000 * aligned) / rungsTotal).toFixed(3) : null;
  return { pairs: pairs.length, k, readings, leverage: { aligned_admitted: aligned, rungs_total: rungsTotal, aligned_per_1000_rungs: leverage }, rule: '§5.4: cosine ≥ 0.5 when both moves ≥ 1 block, else Chebyshev(to, own) ≤ 1; null = shuffled pairing of turns to actions, K draws' };
}

// ── one candidate against the floor (pure given the runner) ────────────────────────────────────
// runner(cfg, 'A'|'B') → { admissible, n, nonsense_admissible, ms_med, bin_sha, rows: [{ i, admissible, pixel }] }
export function step(floor, cfg, runner, now = new Date().toISOString(), outcomes = null) {
  const a = runner(cfg, 'A');
  const slim = (r) => r && { admissible: r.admissible, n: r.n, nonsense_admissible: r.nonsense_admissible, ms_med: r.ms_med ?? null, bin_sha: r.bin_sha ?? null, direction: outcomes ? direction(r.rows || [], outcomes) : null };
  const row = { ts: now, cfg, key: cfgKey(cfg), A: slim(a), B: null, test: null, verdict: null, why: null, floor_before: { A: floor.A.admissible, B: floor.B.admissible } };
  if (a.nonsense_admissible > 0) { row.verdict = 'REJECT'; row.why = `admitted ${a.nonsense_admissible} nonsense on A`; return { row, floor }; }
  // THE DISCORDANCE MANDATE (the paste's Rule 1, taken): a candidate whose admission mask on A is IDENTICAL to the floor's
  // is degenerate — it consumed a run and changed nothing — and is named as such rather than folded into "not better".
  if (floor.A.rows && a.rows && a.rows.length === floor.A.rows.length) {
    const fm = new Map(floor.A.rows.map((r) => [r.i, !!r.admissible]));
    if (a.rows.every((r) => fm.get(r.i) === !!r.admissible)) { row.verdict = 'REJECT'; row.why = `degenerate — identical admission mask on A to the floor (${a.admissible} rows); B not consulted`; return { row, floor }; }
  }
  if (!(a.admissible > floor.A.admissible)) { row.verdict = 'REJECT'; row.why = `A ${a.admissible} does not beat floor A ${floor.A.admissible} — B not consulted`; return { row, floor }; }
  const b = runner(cfg, 'B'); row.B = slim(b);
  if (b.nonsense_admissible > 0) { row.verdict = 'REJECT'; row.why = `admitted ${b.nonsense_admissible} nonsense on B`; return { row, floor }; }
  if (b.ms_med != null && b.ms_med > DOOR_CEILING_MS) { row.verdict = 'REJECT'; row.why = `door ${b.ms_med} ms over the ${DOOR_CEILING_MS} ms ceiling`; return { row, floor }; }
  const t = pairedTest(b.rows || [], floor.B.rows || []); row.test = t;
  if (!(t.b > t.c)) { row.verdict = 'REJECT'; row.why = `B discordant rows ${t.b} for vs ${t.c} against — not better on B (counts ${b.admissible} vs ${floor.B.admissible}; A did: ${a.admissible} > ${floor.A.admissible})`; return { row, floor }; }
  if (!t.clears) { row.verdict = 'UNRESOLVED'; row.why = `B discordant ${t.b} for vs ${t.c} against, p ${t.p} > ${ALPHA} — the corpus cannot resolve this knob (needs ≥ ${t.needed} one-sided discordant rows); floor unchanged`; return { row, floor }; }
  row.verdict = 'ACCEPT'; row.why = `B discordant ${t.b} for vs ${t.c} against, p ${t.p} ≤ ${ALPHA} · counts B ${b.admissible} > ${floor.B.admissible}, A ${a.admissible} > ${floor.A.admissible} · nonsense 0/0 · door ${b.ms_med ?? '—'} ms`;
  const next = { ...floor, config: cfg, key: cfgKey(cfg), A: { ...slim(a), rows: a.rows }, B: { ...slim(b), rows: b.rows }, since: now,
    history: [...(floor.history || []), { config: cfg, B_admissible: b.admissible, A_admissible: a.admissible, since: now, test: t, tried_on_B: (floor.pending_looks_on_B || 0) + 1, bin_sha: b.bin_sha || null }],
    pending_looks_on_B: 0 };
  return { row, floor: next };
}

// ── KR16: THE ACTION OBJECTIVE — the ratchet re-perched on the quantity that carries the action (spec §8.18) ────────────
// KR14/KR15: the admissible count is orthogonal to the action (the admitted rows predict it WORSE than all rows), so a floor
// on admits ratchets nothing. The action objective: every row's shipped placement scored within-2 against the cached aggregate
// same-room target on the large corpus, z against a shuffled-pairing null, per interleaved half. A candidate is ACCEPTED iff
// z_A and z_B BOTH rise by ≥ ACTION_MARGIN over the floor and neither veto (nonsense, door) fires; K1 becomes "both halves'
// z never fall"; K5 unchanged. The line's permutation null stays as the nonsense veto — a specificity guard, never the objective.
const chebN = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));   // numeric block coords — the label-based cheb above reads 0 for numbers
export const MIN_DISTINCT_TARGETS = 20;   // PN3 (KR23): a half whose rows share fewer than this many distinct targets is UNMEASURED — six commits wore the n of 1,752 rows
/** the JS body — kept as the fallback when no binary resolves, and as the parity oracle (tests/formal/action-read-parity.test.mjs) */
export function actionReadJs(rows, target, { k = 300, seed = 41 } = {}) {
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const half = (h) => {
    const sc = rows.filter((r) => (h === 'A' ? r.i % 2 === 0 : r.i % 2 === 1) && r.final && target[r.i]).map((r) => ({ p: r.final, t: target[r.i] }));
    const per = {}; for (const x of sc) { const key = x.t.join(','); per[key] = (per[key] || 0) + 1; }   // PN3: distinct target CELLS (a proxy for distinct commits when refs are not on the row)
    const distinct = Object.keys(per).length, maxOne = Math.max(0, ...Object.values(per));
    if (sc.length < 20) return { n: sc.length, hits: 0, rate: null, null_mean: null, null_sd: null, z: null, distinct_targets: distinct, max_rows_one_target: maxOne, measured: false, why: 'fewer than 20 scorable rows' };
    const real = sc.reduce((x, y) => x + (chebN(y.p, y.t) <= 2 ? 1 : 0), 0) / sc.length; const d = [];
    for (let q = 0; q < k; q++) { const ts = sc.map((x) => x.t); for (let j = ts.length - 1; j > 0; j--) { const w = Math.floor(rnd() * (j + 1)); [ts[j], ts[w]] = [ts[w], ts[j]]; } d.push(sc.reduce((x, y, j) => x + (chebN(y.p, ts[j]) <= 2 ? 1 : 0), 0) / sc.length); }
    const m = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / d.length) || 1e-9;
    const measured = distinct >= MIN_DISTINCT_TARGETS;
    return { n: sc.length, hits: Math.round(real * sc.length), rate: +real.toFixed(3), null_mean: +m.toFixed(3), null_sd: +sd.toFixed(3), z: +((real - m) / sd).toFixed(2), distinct_targets: distinct, max_rows_one_target: maxOne, measured, ...(measured ? {} : { why: `${distinct} distinct target cells < ${MIN_DISTINCT_TARGETS} (PN3/KR23) — the z is printed, the reading is UNMEASURED` }) };
  };
  return { A: half('A'), B: half('B'), engine: 'js-fallback' };
}
/** THE ACTION READ — the crate computes it (pmu-onchip --action-read, src/action.rs); the JS above answers only when no binary resolves, and says so */
export function actionRead(rows, target, { k = 300, seed = 41, tol = 2, engine = null } = {}) {
  if (engine === 'js') return actionReadJs(rows, target, { k, seed });
  let bin = resolvePmuBinary(REPO);
  bin = guardBinary(bin, { flags: ['--action-read', '--check', '--dry', '--format', '--k', '--kr3', '--kr5', '--kr7', '--max', '--objective', '--path', '--run', '--seed', '--set', '--tol'] });
  if (!bin || !existsSync(bin)) return actionReadJs(rows, target, { k, seed });
  const tmp = resolve(tmpdir(), `action-read-${process.pid}-${Date.now()}.json`);
  try {
    writeFileSync(tmp, JSON.stringify({ rows: rows.filter((r) => r.final && target[r.i]).map((r) => ({ i: r.i, final: r.final, target: target[r.i] })) }));
    const out = JSON.parse(execFileSync(bin, ['--action-read', '--path', tmp, '--k', String(k), '--seed', String(seed), '--tol', String(tol)], { encoding: 'utf8', timeout: 60000 }).trim().split('\n').pop());
    if (out.engine !== 'rust-action') throw new Error('engine did not name itself');
    return { A: out.A, B: out.B, engine: 'rust-action', gap: out.gap };
  } catch (e) { const r = actionReadJs(rows, target, { k, seed }); r.engine = 'js-fallback'; r.fallback_why = String(e.message || e).slice(0, 120); return r; }
  finally { try { unlinkSync(tmp); } catch {} }
}
/** G3 (spec §8.29): the floor is an EFFECT SIZE. gap := rate − null_mean per half; z ≥ 2 on both halves is admissibility, never the objective. */
export const GAP_MARGIN = 0.01;   // one point of hit rate — §8.23: z rises with √n, the gap does not
export const ADMISSIBLE_Z = 2;
export const gapOf = (read) => ({ A: read?.A && Number.isFinite(read.A.rate) && Number.isFinite(read.A.null_mean) ? +(read.A.rate - read.A.null_mean).toFixed(4) : null, B: read?.B && Number.isFinite(read.B.rate) && Number.isFinite(read.B.null_mean) ? +(read.B.rate - read.B.null_mean).toFixed(4) : null });
export function actionStep(floor, cfg, runner, now = new Date().toISOString(), margin = GAP_MARGIN) {
  // runner(cfg) → { rows, read: actionRead(rows, target), nonsense_admissible, ms_med, rungs } on the LARGE corpus. Every read carries rate, null_mean, z per half (PN1).
  const r = runner(cfg);
  const g = gapOf(r.read); const fg = floor.gap && floor.gap.A != null ? floor.gap : gapOf(floor.read);
  const row = { ts: now, cfg, key: cfgKey(cfg), read: r.read, gap: g, nonsense_admissible: r.nonsense_admissible, ms_med: r.ms_med ?? null, rungs: r.rungs ?? null, admissible: r.admissible ?? null, verdict: null, why: null, floor_before: { key: floor.key, gap: fg, zA: floor.read?.A?.z ?? null, zB: floor.read?.B?.z ?? null }, rule: 'gap' };
  if (r.nonsense_admissible > 0) { row.verdict = 'REJECT'; row.why = `admitted ${r.nonsense_admissible} nonsense`; return { row, floor }; }
  if (r.ms_med != null && r.ms_med > DOOR_CEILING_MS) { row.verdict = 'REJECT'; row.why = `door ${r.ms_med} ms over the ${DOOR_CEILING_MS} ms ceiling`; return { row, floor }; }
  if (g.A == null || g.B == null || r.read.A.z == null || r.read.B.z == null) { row.verdict = 'REJECT'; row.why = 'a half had too few scorable rows, or the read carries no rate/null (PN1)'; return { row, floor }; }
  if (fg.A == null || fg.B == null) { row.verdict = 'REJECT'; row.why = 'the floor carries no gap — migrate the floor file before ratcheting'; return { row, floor }; }
  if (r.read.A.measured === false || r.read.B.measured === false) { row.verdict = 'UNMEASURED'; row.why = `a half is unmeasured (PN3): A ${r.read.A.why || 'ok'} · B ${r.read.B.why || 'ok'} — floor unchanged`; return { row, floor }; }
  const dA = +(g.A - fg.A).toFixed(4), dB = +(g.B - fg.B).toFixed(4);
  if (dA < -margin || dB < -margin) { row.verdict = 'REJECT'; row.why = `effect fell on a half: Δgap A ${dA} B ${dB}`; return { row, floor }; }
  if (!(dA >= margin && dB >= margin)) { row.verdict = 'TIE'; row.why = `effect within the margin on at least one half: Δgap A ${dA} B ${dB} (needs ≥ ${margin} on both) — floor unchanged`; return { row, floor }; }
  if (r.read.A.z < ADMISSIBLE_Z || r.read.B.z < ADMISSIBLE_Z) { row.verdict = 'TIE'; row.why = `effect rose but the reading is not admissible on a half (z A ${r.read.A.z} B ${r.read.B.z} < ${ADMISSIBLE_Z}) — floor unchanged`; return { row, floor }; }
  row.verdict = 'ACCEPT'; row.why = `effect rose on both halves: Δgap A +${dA} B +${dB} (z ${r.read.A.z} / ${r.read.B.z}) · nonsense 0 · door ${r.ms_med ?? '—'} ms · rungs ${r.rungs ?? '—'}`;
  const next = { ...floor, config: cfg, key: cfgKey(cfg), read: r.read, gap: g, rungs: r.rungs ?? null, ms_med: r.ms_med ?? null, since: now, margin, rule: 'gap', history: [...(floor.history || []), { config: cfg, gapA: g.A, gapB: g.B, zA: r.read.A.z, zB: r.read.B.z, since: now, rungs: r.rungs ?? null }] };
  return { row, floor: next };
}
/** the floor never softens — on the GAP where both consecutive entries carry one, on z where an older entry does not */
export function actionFloorNeverSoftens(floor) { const h = floor.history || []; for (let i = 1; i < h.length; i++) { const a = h[i - 1], b = h[i]; if (a.gapA != null && b.gapA != null && a.gapB != null && b.gapB != null) { if (b.gapA < a.gapA || b.gapB < a.gapB) return false; } else if (b.zA < a.zA || b.zB < a.zB) return false; } return true; }

// ── the pass ───────────────────────────────────────────────────────────────────────────────────
export function runPass({ space, floor, runner, tried = new Set(), max = Infinity, now = () => new Date().toISOString(), outcomes = null }) {
  const rows = []; let f = { ...floor, pending_looks_on_B: floor.pending_looks_on_B || 0 };
  let evaluated = 0;
  for (const cfg of candidates(space)) {
    const key = cfgKey(cfg);
    if (key === f.key || tried.has(key)) continue;
    if (evaluated >= max) break;
    const before = f;
    const { row, floor: after } = step(f, cfg, runner, now(), outcomes);
    if (row.B) after.pending_looks_on_B = row.verdict === 'ACCEPT' ? 0 : (before.pending_looks_on_B || 0) + 1;
    f = after; rows.push(row); evaluated++;
  }
  return { rows, floor: f, evaluated, accepted: rows.filter((r) => r.verdict === 'ACCEPT').length, unresolved: rows.filter((r) => r.verdict === 'UNRESOLVED').length };
}

// K1 in one line: the floor's B never softens across history.
export function floorNeverSoftens(floor) {
  const h = floor.history || [];
  for (let i = 1; i < h.length; i++) if (h[i].B_admissible <= h[i - 1].B_admissible) return false;
  return true;
}

// ── the outcome table (KR2 / KR3 / KR4), frozen once from the live tape ────────────────────────────
// KR4 (2026-09-16): the tape's commit rows carry session: null, but two maps exist on disk — a session's ROOM is in its
// lens receipts (running_in.key), and a commit's ROOM is in its Originating-Terminal trailer. So the pairing can be done by
// ROOM on the existing tape, tonight: each prompt → the next commit-reality row FROM THE SAME ROOM. Both pairings are frozen
// side by side (time-only and same-room) so every meter can be read on both and the difference is the reading.
import { roomKey } from '../../src/lib/pmu/room-key.mjs';   // the one normaliser — the tape door stamps rows with the same function
export { roomKey };
function sessionRooms(sessions) {
  const dir = resolve(REPO, '.thetacog/lens-receipts'); const want = new Set(sessions); const found = {};
  if (!existsSync(dir)) return found;
  for (const f of readdirSync(dir).filter((f) => /^lens-.*\.json$/.test(f))) { if (Object.keys(found).length >= want.size) break; let r; try { r = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; } if (r.session && want.has(r.session) && !found[r.session] && r.running_in && r.running_in.key) found[r.session] = r.running_in.key; }
  return found;
}
function commitRooms(shas) {
  // one git log over the recent history: sha → Originating-Terminal room key
  const out = {}; let log = '';
  try { log = execFileSync('git', ['log', '-n', '8000', '--format=%h%x1f%B%x1e'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return out; }
  const want = new Set(shas);
  for (const rec of log.split('\x1e')) { const [h, body] = rec.trim().split('\x1f'); if (!h) continue; const short = h.trim(); const hit = [...want].find((s) => short.startsWith(s) || s.startsWith(short)); if (!hit) continue; const m = (body || '').match(/^Originating-Terminal:\s*(.+)$/m); out[hit] = m ? roomKey(m[1]) : null; }
  return out;
}
export function buildOutcomes(corpus, tapePath = TAPE) {
  const commits = []; const intentByRef = new Map();
  for (const l of readFileSync(tapePath, 'utf8').split('\n')) { if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; } if (r.source === 'commit-reality' && r.pixel && r.ts) commits.push({ ts: r.ts, pixel: r.pixel, ref: r.ref || null }); if (r.source === 'commit-intent' && r.pixel && r.ref) intentByRef.set(r.ref, r.pixel); }
  commits.sort((x, y) => x.ts.localeCompare(y.ts));
  const rooms = commitRooms([...new Set(commits.map((c) => c.ref).filter(Boolean))]);
  for (const c of commits) c.room = c.ref ? rooms[c.ref] ?? null : null;
  const sess = sessionRooms([...new Set(corpus.rows.map((r) => r.session))]);
  const out = {}; let sameRoomPaired = 0;
  corpus.rows.forEach((r, i) => {
    const ci = commits.findIndex((k) => k.ts > r.ts); const c = ci >= 0 ? commits[ci] : null; const p = ci > 0 ? commits[ci - 1] : null;
    const room = sess[r.session] || null;
    let sc = null, sp = null;
    if (room) { for (let j = 0; j < commits.length; j++) { if (commits[j].room !== room) continue; if (commits[j].ts > r.ts) { sc = commits[j]; break; } sp = commits[j]; } }
    if (sc) sameRoomPaired++;
    // KR7 targets: T2 the commit's INTENT pixel (the message's placement, same ref); T3 the same-room BUNDLE — every same-room
    // commit between this prompt and the next corpus prompt of the same session (the action side at the scale of the prompt side)
    const nextSame = corpus.rows.slice(i + 1).find((x) => x.session === r.session);
    const bundle = room ? commits.filter((k) => k.room === room && k.ts > r.ts && (!nextSame || k.ts <= nextSame.ts)).map((k) => k.pixel) : [];
    out[i] = { ts: r.ts, session: r.session, room, commitPixel: c ? c.pixel : null, commitTs: c ? c.ts : null, commitRef: c ? c.ref : null, prevCommitPixel: p ? p.pixel : null,
      sameRoomCommitPixel: sc ? sc.pixel : null, sameRoomCommitTs: sc ? sc.ts : null, sameRoomCommitRef: sc ? sc.ref : null, sameRoomPrevCommitPixel: sp ? sp.pixel : null, sameRoomPrevCommitRef: sp ? sp.ref : null, sameRoomPrevCommitTs: sp ? sp.ts : null,
      sameRoomIntentPixel: sc && sc.ref ? intentByRef.get(sc.ref) || null : null, sameRoomBundlePixels: bundle };
  });
  return { frozen: new Date().toISOString(), rule: 'each corpus prompt → the NEXT commit-reality row by time (time-only, the grip-meter pairing) AND the next commit-reality row FROM THE SAME ROOM (KR4: session→room via lens receipts running_in.key, commit→room via the Originating-Terminal trailer); prev* is the commit before it under the same pairing, so (prev → next) is the actual vector for KR3', commits_seen: commits.length, commits_with_room: commits.filter((c) => c.room).length, sessions_with_room: Object.keys(sess).length, same_room_paired: sameRoomPaired, outcomes: out };
}
/** project an outcomes table onto one pairing so kr2/kr3 read it unchanged */
export function pairing(outcomes, mode = 'time') { if (mode !== 'same-room') return outcomes; const o = {}; for (const [k, v] of Object.entries(outcomes)) o[k] = { ...v, commitPixel: v.sameRoomCommitPixel, prevCommitPixel: v.sameRoomPrevCommitPixel, commitTs: v.sameRoomCommitTs, commitRef: v.sameRoomCommitRef }; return o; }

// ── the real runner ────────────────────────────────────────────────────────────────────────────
async function realRunner() {
  const { loadCorpus, runArm } = await import('./ratchet-replay.mjs');
  const { SEED_APERTURE } = await import('../../src/lib/pmu/walk-knobs.mjs');
  const corpus = loadCorpus(); const halves = splitCorpus(corpus);
  const runner = (cfg, half) => {
    const rows = [];
    const r = runArm(halves[half], { ...SEED_APERTURE, ...cfg }, { onRow: (row, src) => rows.push({ i: src.corpus_index, session: src.session, admissible: !!row.admissible, pixel: row.pixel || null }) });
    return { admissible: r.admissible, n: r.n, nonsense_admissible: r.nonsense_admissible, nonsense_n: r.nonsense_n, ms_med: r.ms_med ?? null, bin_sha: r.bin_sha || null, raw_admissible: r.raw_admissible ?? null, rows };
  };
  const current = { worms: SEED_APERTURE.worms, perm: SEED_APERTURE.perm, firstLatch: !!SEED_APERTURE.firstLatch };
  let outcomes = null;
  if (existsSync(OUTCOMES)) outcomes = JSON.parse(readFileSync(OUTCOMES, 'utf8')).outcomes;
  else if (existsSync(TAPE)) { const o = buildOutcomes(corpus); writeFileSync(OUTCOMES, JSON.stringify(o, null, 1) + '\n'); outcomes = o.outcomes; console.log(`froze ${Object.values(o.outcomes).filter((x) => x.commitPixel).length}/${corpus.rows.length} corpus → next-commit outcomes from ${o.commits_seen} commit rows`); }
  return { runner, current, corpus_sha: sha(JSON.stringify(corpus.rows)), split: halves.rule, nA: halves.A.rows.length, nB: halves.B.rows.length, outcomes };
}

async function main() {
  const space = JSON.parse(readFileSync(SPACE, 'utf8'));
  if (has('--check')) {
    if (!existsSync(FLOOR)) { console.log('no knob floor yet — run --run once to bootstrap from the shipped knobs'); return; }
    const f = JSON.parse(readFileSync(FLOOR, 'utf8'));
    console.log(`knob floor: ${f.key} · A ${f.A.admissible}/${f.A.n} · B ${f.B.admissible}/${f.B.n} · direction B ${f.B.direction ? `${f.B.direction.hits}/${f.B.direction.admitted} admitted rows predicted the action` : '—'} · since ${f.since} · history ${f.history.length} · never softens: ${floorNeverSoftens(f)}`);
    if (existsSync(LEDGER)) { const rows = readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); const last = rows.filter((r) => r.pass === rows.at(-1).pass); console.log(`last pass ${rows.at(-1)?.pass}: ${last.length} candidates · ${last.filter((r) => r.verdict === 'ACCEPT').length} accepted · ${last.filter((r) => r.verdict === 'UNRESOLVED').length} unresolved · ${last.filter((r) => r.B).length} reached B`); }
    return;
  }
  if (has('--kr3')) {
    const { loadCorpus, runArm } = await import('./ratchet-replay.mjs');
    const { SEED_APERTURE } = await import('../../src/lib/pmu/walk-knobs.mjs');
    const corpus = loadCorpus();
    let outcomes = existsSync(OUTCOMES) ? JSON.parse(readFileSync(OUTCOMES, 'utf8')) : null;
    if (!outcomes || !Object.values(outcomes.outcomes)[0] || !('sameRoomBundlePixels' in Object.values(outcomes.outcomes)[0])) { outcomes = buildOutcomes(corpus); writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1) + '\n'); console.log(`re-froze outcomes: ${outcomes.commits_with_room}/${outcomes.commits_seen} commits with a room · ${outcomes.sessions_with_room} sessions with a room · ${outcomes.same_room_paired}/${corpus.rows.length} prompts same-room paired`); }
    const cfg = existsSync(FLOOR) ? JSON.parse(readFileSync(FLOOR, 'utf8')).config : { worms: SEED_APERTURE.worms, perm: SEED_APERTURE.perm, firstLatch: !!SEED_APERTURE.firstLatch };
    for (const s of process.argv.filter((x, i, arr) => arr[i - 1] === '--set')) { const [kk, vv] = s.split('='); cfg[kk] = vv === 'true' ? true : vv === 'false' ? false : Number.isFinite(Number(vv)) ? Number(vv) : vv; }   // e.g. --set wormsOrthogonal=true
    const rows = []; let rungs = 0; const t0 = Date.now();
    const r = runArm({ ...corpus, rows: corpus.rows.map((x, i) => ({ ...x, corpus_index: i })) }, { ...SEED_APERTURE, ...cfg }, { onRow: (row, src) => { rows.push({ i: src.corpus_index, session: src.session, admissible: !!row.admissible, pixel: row.pixel || null }); rungs += (row.attempts || []).length; } });
    const rec = { ts: new Date().toISOString(), config: cfg, key: cfgKey(cfg), rows: rows.length, admissible: r.admissible, nonsense_admissible: r.nonsense_admissible, ms_med: r.ms_med ?? null, bin_sha: r.bin_sha || null, wall_s: Math.round((Date.now() - t0) / 1000), rungs, pairings: {} };
    for (const mode of ['time', 'same-room']) {
      const oc = pairing(outcomes.outcomes, mode);
      const out = kr3(rows, oc, { rungsTotal: rungs });
      const d2 = direction(rows, oc);
      rec.pairings[mode] = { ...out, kr2: d2 };
      console.log(`── pairing: ${mode} · KR2 admitted ${d2.hits}/${d2.admitted} within 2 blocks (known ${d2.known})`);
      for (const name of ['admitted', 'all']) { const R = out.readings[name]; console.log(`   KR3 ${name.padEnd(8)} n=${R.n} · destination ${R.counts.dest} (${R.destination_only.rate} vs null ${R.destination_only.null_mean} z ${R.destination_only.z}) · direction ${R.counts.dir} (${R.direction.rate} vs ${R.direction.null_mean} z ${R.direction.z}) · both ${R.counts.both} (${R.both.rate} vs ${R.both.null_mean} z ${R.both.z})`); }
      console.log(`   leverage: ${out.leverage.aligned_admitted} aligned admitted rows / ${rungs} rungs = ${out.leverage.aligned_per_1000_rungs} per 1,000 rungs`);
    }
    writeReading(resolve(REPO, 'data/pmu/kr3-latest.json'), rec, 'js');
    console.log(`${rec.wall_s}s · ${cfgKey(cfg)}`);
    return;
  }
  // ── KR5: THE BACKWARD SNOWBALL, RUN AGAINST LEVERAGE PER DEPTH (operator: "the worms snowball backwards in time context
  // until leverage is solid on the fulcrum"). Every rung on a row is labelled with its depth: stage 0 = the line alone
  // (labels none / given / guided:N), stage k = the line plus k prior prompts (tK:…), and worm rings r = 1..3
  // (wormK@CELL:rR). For each depth the bundle's best rung (highest gain) gives that depth's pixel; per depth, on SAME-ROOM
  // pairs, read the destination hit (KR2) and the vector agreement (KR3) against the shuffled-pairing null, over the rows
  // that reached that depth, and again over the rows ADMITTED at that depth. If a depth predicts the action where depth 0
  // does not, the sentence is true and that depth is the fulcrum. Nothing pooled across depths.
  if (has('--kr5')) {
    const { loadCorpus, runArm } = await import('./ratchet-replay.mjs');
    const { SEED_APERTURE } = await import('../../src/lib/pmu/walk-knobs.mjs');
    const corpus = loadCorpus();
    const oc0 = JSON.parse(readFileSync(OUTCOMES, 'utf8')).outcomes; const oc = pairing(oc0, 'same-room');
    const cfg = existsSync(FLOOR) ? JSON.parse(readFileSync(FLOOR, 'utf8')).config : { worms: SEED_APERTURE.worms, perm: SEED_APERTURE.perm, firstLatch: !!SEED_APERTURE.firstLatch };
    for (const s of process.argv.filter((x, i, arr) => arr[i - 1] === '--set')) { const [kk, vv] = s.split('='); cfg[kk] = vv === 'true' ? true : vv === 'false' ? false : Number.isFinite(Number(vv)) ? Number(vv) : vv; }   // e.g. --set wormsOrthogonal=true
    const rows = []; const t0 = Date.now();
    runArm({ ...corpus, rows: corpus.rows.map((x, i) => ({ ...x, corpus_index: i })) }, { ...SEED_APERTURE, ...cfg }, { onRow: (row, src) => rows.push({ i: src.corpus_index, session: src.session, admissible: !!row.admissible, pixel: row.pixel || null, attempts: (row.attempts || []).map((a) => ({ label: a.label, pixel: a.pixel || null, gain: a.gain ?? null, ok: !!a.ok })), seeds: row.ratchet?.worms?.seeds || [] }) });
    // F21 / KR6 companion: are the walkers bunched? per row, the mean pairwise Chebyshev distance between the seeds on the block
    // grid, and whether the seeds occupy distinct block-rows AND block-columns (the orthogonal condition) — counted, not believed
    const seedSpread = (() => { let rowsWith = 0, sumMean = 0, allDistinct = 0; for (const r of rows) { const cs = (r.seeds || []).map(coord).filter(Boolean); if (cs.length < 2) continue; rowsWith++; let s = 0, n = 0; for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) { s += Math.max(Math.abs(cs[a][0] - cs[b][0]), Math.abs(cs[a][1] - cs[b][1])); n++; } sumMean += s / n; const rs = new Set(cs.map((c) => c[0])), ks = new Set(cs.map((c) => c[1])); if (rs.size === cs.length && ks.size === cs.length) allDistinct++; } return { rows_with_seeds: rowsWith, mean_pairwise_chebyshev: rowsWith ? +(sumMean / rowsWith).toFixed(2) : null, rows_all_seeds_distinct_row_and_col: allDistinct }; })();
    const depthOf = (label) => { const m = String(label).match(/^t(\d+):/); if (m) return { kind: 'stage', d: Number(m[1]) }; const w = String(label).match(/^worm\d+@[^:]+:r(\d+)$/); if (w) return { kind: 'ring', d: Number(w[1]) }; return { kind: 'stage', d: 0 }; };
    const table = [];
    for (const [kind, depths] of [['stage', [0, 1, 2, 3, 4]], ['ring', [1, 2, 3]]]) for (const d of depths) {
      const reached = [], admitted = [];
      for (const r of rows) {
        const rungs = r.attempts.filter((x) => { const k = depthOf(x.label); return k.kind === kind && k.d === d && x.pixel; });
        if (!rungs.length) continue;
        const best = rungs.reduce((b, x) => (x.gain ?? -1) > (b.gain ?? -1) ? x : b, rungs[0]);
        const row = { i: r.i, session: r.session, admissible: best.ok, pixel: best.pixel };
        reached.push(row); if (best.ok) admitted.push(row);
      }
      // destination over EVERY row that reached the depth (admissible forced true so direction() counts them all), and again over the admitted subset — two populations, two rates, never one
      const rd = direction(reached.map((x) => ({ ...x, admissible: true })), oc), ad = direction(admitted.map((x) => ({ ...x, admissible: true })), oc);
      const k3 = kr3(reached.map((x) => ({ ...x, admissible: true })), oc, { k: 200 });
      table.push({ kind, depth: d, rows: reached.length, dest_hits: rd.hits, dest_rate: rd.rate, admitted: admitted.length, admitted_hits: ad.hits, admitted_rate: ad.rate, kr3: k3.readings.admitted });
    }
    // the shuffled null for the destination hit at each depth, so the rate has a companion
    const rnd = lcg(11); const nullDest = (rs) => { const ks = Object.keys(oc).filter((k) => oc[k].commitPixel); const draws = []; for (let q = 0; q < 200; q++) { let h = 0, n = 0; for (const r of rs) { const o = oc[ks[Math.floor(rnd() * ks.length)]]; const a = block(r.pixel), c = block(o.commitPixel); if (!a || !c) continue; n++; if (cheb(a, c) <= 2) h++; } draws.push(n ? h / n : 0); } const m = draws.reduce((x, y) => x + y, 0) / draws.length; const sd = Math.sqrt(draws.reduce((x, y) => x + (y - m) ** 2, 0) / draws.length) || 1e-9; return { m: +m.toFixed(3), sd: +sd.toFixed(3) }; };
    const nullFor = (rs) => nullDest(rs);
    for (const row of table) { const rs = rows.map((r) => { const rungs = r.attempts.filter((x) => { const k = depthOf(x.label); return k.kind === row.kind && k.d === row.depth && x.pixel; }); if (!rungs.length) return null; const best = rungs.reduce((b, x) => (x.gain ?? -1) > (b.gain ?? -1) ? x : b, rungs[0]); return { pixel: best.pixel, ok: best.ok }; }).filter(Boolean); const nl = nullFor(rs); row.dest_null = nl; row.dest_z = row.dest_rate == null ? null : +(((row.dest_rate - nl.m) / nl.sd)).toFixed(2); const adm = rs.filter((x) => x.ok); const nla = adm.length ? nullFor(adm) : { m: null, sd: null }; row.admitted_null = nla; row.admitted_z = row.admitted_rate == null || nla.sd == null ? null : +(((row.admitted_rate - nla.m) / nla.sd)).toFixed(2); }
    const rec = { ts: new Date().toISOString(), config: cfg, key: cfgKey(cfg), pairing: 'same-room', rows: rows.length, wall_s: Math.round((Date.now() - t0) / 1000), seed_spread: seedSpread, admissible: rows.filter((r) => r.admissible).length, table };
    const outName = cfg.wormsOrthogonal ? 'data/pmu/kr5-latest-orthogonal.json' : 'data/pmu/kr5-latest.json';
    writeReading(resolve(REPO, outName), rec, 'js');
    console.log(`KR5 · same-room pairing · ${rows.length} rows · admissible ${rec.admissible} · ${cfgKey(cfg)} · ${rec.wall_s}s`);
    console.log(`seed spread: rows with ≥2 seeds ${seedSpread.rows_with_seeds} · mean pairwise Chebyshev ${seedSpread.mean_pairwise_chebyshev} blocks · rows with all seeds in distinct block-rows AND block-columns ${seedSpread.rows_all_seeds_distinct_row_and_col}`);
    console.log('kind   depth  rows  dest_hits  rate   null(sd)       z      | admitted  hits  rate   null    z      | kr3 dir z  both z');
    for (const r of table) console.log(`${r.kind.padEnd(6)} ${String(r.depth).padEnd(6)} ${String(r.rows).padEnd(5)} ${String(r.dest_hits).padEnd(10)} ${String(r.dest_rate).padEnd(6)} ${String(r.dest_null.m).padEnd(5)}(${r.dest_null.sd})  ${String(r.dest_z).padEnd(7)}| ${String(r.admitted).padEnd(9)} ${String(r.admitted_hits).padEnd(5)} ${String(r.admitted_rate).padEnd(6)} ${String(r.admitted_null.m).padEnd(7)} ${String(r.admitted_z).padEnd(7)}| ${String(r.kr3.direction.z).padEnd(10)} ${r.kr3.both.z}`);
    return;
  }
  // ── KR7: THE TARGET, decided by measurement (§8.11). Four targets scored for the LINE ALONE (stage-0 best rung) and for the
  // final winner, on half A and half B separately, each against its own shuffled-pairing null. A target is chosen only if the
  // line alone clears z_required(4) ≈ 2.6 on BOTH halves. Nothing pooled across halves, targets, or pixels.
  if (has('--kr7')) {
    const { loadCorpus, runArm } = await import('./ratchet-replay.mjs');
    const { SEED_APERTURE } = await import('../../src/lib/pmu/walk-knobs.mjs');
    const corpus = loadCorpus();
    let outcomes = existsSync(OUTCOMES) ? JSON.parse(readFileSync(OUTCOMES, 'utf8')) : null;
    if (!outcomes || !('sameRoomBundlePixels' in Object.values(outcomes.outcomes)[0])) { outcomes = buildOutcomes(corpus); writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1) + '\n'); console.log('re-froze outcomes with intent + bundle targets'); }
    const oc = outcomes.outcomes;
    const cfg = existsSync(FLOOR) ? JSON.parse(readFileSync(FLOOR, 'utf8')).config : { worms: SEED_APERTURE.worms, perm: SEED_APERTURE.perm, firstLatch: !!SEED_APERTURE.firstLatch };
    const rows = []; const t0 = Date.now();
    runArm({ ...corpus, rows: corpus.rows.map((x, i) => ({ ...x, corpus_index: i })) }, { ...SEED_APERTURE, ...cfg }, { onRow: (row, src) => { const s0 = (row.attempts || []).filter((a) => a.pixel && !/^t\d+:/.test(a.label) && !/^worm/.test(a.label)); const best = s0.length ? s0.reduce((b, x) => (x.gain ?? -1) > (b.gain ?? -1) ? x : b, s0[0]) : null; rows.push({ i: src.corpus_index, admissible: !!row.admissible, final: row.pixel || null, line: best ? best.pixel : null }); } });
    const rowLabel = (px) => { const b = block(px); return b ? b[0] : null; };
    const TARGETS = {
      T1_reality_cell: (px, o) => o.sameRoomCommitPixel ? (cheb(block(px), block(o.sameRoomCommitPixel)) <= 2 ? 1 : 0) : null,
      T2_intent_cell: (px, o) => o.sameRoomIntentPixel ? (cheb(block(px), block(o.sameRoomIntentPixel)) <= 2 ? 1 : 0) : null,
      T3_bundle_any: (px, o) => o.sameRoomBundlePixels && o.sameRoomBundlePixels.length ? (o.sameRoomBundlePixels.some((b) => cheb(block(px), block(b)) <= 2) ? 1 : 0) : null,
      T4_lane_row: (px, o) => o.sameRoomCommitPixel ? (rowLabel(px) === rowLabel(o.sameRoomCommitPixel) ? 1 : 0) : null,
    };
    const zreq = zRequired(4);
    const table = []; const rnd = lcg(19);
    for (const [tname, fn] of Object.entries(TARGETS)) for (const which of ['line', 'final']) for (const half of ['A', 'B']) {
      const rs = rows.filter((r) => (half === 'A' ? r.i % 2 === 0 : r.i % 2 === 1) && r[which] && block(r[which]));
      const scored = rs.map((r) => ({ px: r[which], o: oc[r.i], hit: fn(r[which], oc[r.i]) })).filter((x) => x.hit !== null);
      const rate = scored.length ? scored.reduce((s, x) => s + x.hit, 0) / scored.length : null;
      const draws = []; for (let d = 0; d < 200; d++) { const os = scored.map((x) => x.o); for (let j = os.length - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); [os[j], os[q]] = [os[q], os[j]]; } let h = 0, n = 0; scored.forEach((x, j) => { const v = fn(x.px, os[j]); if (v !== null) { n++; h += v; } }); draws.push(n ? h / n : 0); }
      const m = draws.reduce((a, b) => a + b, 0) / draws.length; const sd = Math.sqrt(draws.reduce((a, b) => a + (b - m) ** 2, 0) / draws.length) || 1e-9;
      const bundleSize = tname.startsWith('T3') ? +(scored.reduce((s, x) => s + (x.o.sameRoomBundlePixels || []).length, 0) / Math.max(1, scored.length)).toFixed(1) : null;
      table.push({ target: tname, pixel: which, half, n: scored.length, hits: scored.reduce((s, x) => s + x.hit, 0), rate: rate == null ? null : +rate.toFixed(3), null_mean: +m.toFixed(3), null_sd: +sd.toFixed(3), z: rate == null ? null : +((rate - m) / sd).toFixed(2), bundle_size: bundleSize });
    }
    const chosen = Object.keys(TARGETS).filter((tn) => ['A', 'B'].every((h) => { const r = table.find((x) => x.target === tn && x.pixel === 'line' && x.half === h); return r && r.z != null && r.z >= zreq; }));
    const rec = { ts: new Date().toISOString(), config: cfg, key: cfgKey(cfg), rows: rows.length, z_required_4: zreq, table, chosen_targets: chosen, wall_s: Math.round((Date.now() - t0) / 1000) };
    writeReading(resolve(REPO, 'data/pmu/kr7-latest.json'), rec, 'js');
    console.log(`KR7 · ${rows.length} rows · z_required(4) = ${zreq} · ${cfgKey(cfg)} · ${rec.wall_s}s`);
    console.log('target           pixel  half  n    hits  rate   null(sd)        z      bundle');
    for (const r of table) console.log(`${r.target.padEnd(16)} ${r.pixel.padEnd(6)} ${r.half}     ${String(r.n).padEnd(4)} ${String(r.hits).padEnd(5)} ${String(r.rate).padEnd(6)} ${String(r.null_mean).padEnd(6)}(${r.null_sd})  ${String(r.z).padEnd(6)} ${r.bundle_size ?? ''}`);
    console.log(`chosen (line alone clears z_required on BOTH halves): ${chosen.length ? chosen.join(', ') : 'none — the target is not the problem either; the projector is next'}`);
    return;
  }
  if (has('--run') && arg('--objective', 'admits') === 'action') {
    // THE ACTION OBJECTIVE, live: large corpus, cached aggregate target; one walk per candidate (~5 min at worms 4).
    if (!existsSync(LARGE) || !existsSync(AGG_CACHE)) { console.error('the large corpus or the aggregate-target cache is missing — run scripts/pmu/kr15-config-rank.mjs once'); process.exit(2); }
    const { runArm } = await import('./ratchet-replay.mjs'); const { SEED_APERTURE } = await import('../../src/lib/pmu/walk-knobs.mjs');
    const corpus = JSON.parse(readFileSync(LARGE, 'utf8')); const target = JSON.parse(readFileSync(AGG_CACHE, 'utf8')).target_by_index;
    const runner = (cfg) => { const rows = []; let rungs = 0; const res = runArm({ ...corpus, rows: corpus.rows.map((x, i) => ({ ...x, corpus_index: i })) }, { ...SEED_APERTURE, ...cfg }, { onRow: (row, src) => { rows.push({ i: src.corpus_index, admissible: !!row.admissible, final: coord(row.pixel) }); rungs += (row.attempts || []).length; } }); return { rows, read: actionRead(rows, target), nonsense_admissible: res.nonsense_admissible, ms_med: res.ms_med ?? null, rungs, admissible: rows.filter((r) => r.admissible).length, bin_sha: res.bin_sha || null }; };
    const dry = has('--dry'); const max = Number(arg('--max', Infinity));
    let floor;
    if (existsSync(ACTION_FLOOR)) floor = JSON.parse(readFileSync(ACTION_FLOOR, 'utf8'));
    else { const current = { worms: SEED_APERTURE.worms, perm: SEED_APERTURE.perm, firstLatch: !!SEED_APERTURE.firstLatch }; console.log(`bootstrapping the ACTION floor from the shipped knobs ${cfgKey(current)} on the large corpus…`); const r0 = runner(current); floor = { objective: 'action', config: current, key: cfgKey(current), read: r0.read, gap: gapOf(r0.read), rungs: r0.rungs, ms_med: r0.ms_med, since: new Date().toISOString(), margin: GAP_MARGIN, rule: 'gap', history: [{ config: current, gapA: gapOf(r0.read).A, gapB: gapOf(r0.read).B, zA: r0.read.A.z, zB: r0.read.B.z, since: new Date().toISOString(), rungs: r0.rungs, note: 'bootstrap — the shipped knobs, nothing accepted' }] }; console.log(`  action floor: A z ${r0.read.A.z} · B z ${r0.read.B.z} · rungs ${r0.rungs} · door ${r0.ms_med} ms`); if (!dry) writeFileSync(ACTION_FLOOR, JSON.stringify(floor, null, 1) + '\n'); }
    const led = existsSync(ACTION_LEDGER) ? readFileSync(ACTION_LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const tried = new Set(led.filter((r) => r.floor_key === floor.key).map((r) => r.key)); const pass = led.length ? (led.at(-1).pass || 0) + 1 : 1;
    let f = floor, evaluated = 0, accepted = 0; const t0 = Date.now();
    for (const cfg of candidates(space)) { const key = cfgKey(cfg); if (key === f.key || tried.has(key)) continue; if (evaluated >= max) break; const { row, floor: after } = actionStep(f, cfg, runner); row.pass = pass; row.floor_key = floor.key; f = after; evaluated++; if (row.verdict === 'ACCEPT') accepted++; console.log(`  ${row.verdict.padEnd(7)} ${row.key.padEnd(44)} A z ${row.read.A.z} B z ${row.read.B.z} · rungs ${row.rungs} · ${row.ms_med} ms — ${row.why}`); if (!dry) appendFileSync(ACTION_LEDGER, JSON.stringify(row) + '\n'); }
    if (!dry && accepted) writeFileSync(ACTION_FLOOR, JSON.stringify(f, null, 1) + '\n');
    console.log(`\naction pass ${pass}: ${evaluated} candidates · ${accepted} accepted · ${Math.round((Date.now() - t0) / 1000)}s · floor ${f.key} A z ${f.read.A.z} B z ${f.read.B.z}`);
    if (!actionFloorNeverSoftens(f)) { console.error('K1 VIOLATED on the action floor'); process.exit(3); }
    return;
  }
  if (!has('--run')) { console.log('usage: --run [--objective admits|action] [--max N] [--dry] | --check | --kr3 | --kr5 | --kr7'); return; }
  const dry = has('--dry'); const max = Number(arg('--max', Infinity));
  const { runner, current, corpus_sha, split, nA, nB, outcomes } = await realRunner();
  let floor;
  if (existsSync(FLOOR)) floor = JSON.parse(readFileSync(FLOOR, 'utf8'));
  else {
    // BOOTSTRAP: the shipped knobs measured on both halves become the first floor. Nothing is accepted in a bootstrap.
    console.log(`bootstrapping the floor from the shipped knobs ${cfgKey(current)} on A (${nA}) and B (${nB})…`);
    const a = runner(current, 'A'), b = runner(current, 'B');
    const dA = outcomes ? direction(a.rows, outcomes) : null, dB = outcomes ? direction(b.rows, outcomes) : null;
    floor = { config: current, key: cfgKey(current), A: { ...a, direction: dA }, B: { ...b, direction: dB }, since: new Date().toISOString(), corpus_sha, split, door_ceiling_ms: DOOR_CEILING_MS, alpha: ALPHA,
      history: [{ config: current, B_admissible: b.admissible, A_admissible: a.admissible, since: new Date().toISOString(), tried_on_B: 0, bin_sha: b.bin_sha || null, note: 'bootstrap — the shipped knobs, nothing accepted' }], pending_looks_on_B: 0 };
    console.log(`  floor: A ${a.admissible}/${a.n} nonsense ${a.nonsense_admissible} · B ${b.admissible}/${b.n} nonsense ${b.nonsense_admissible} · door ${b.ms_med} ms · direction A ${dA ? `${dA.hits}/${dA.admitted}` : '—'} B ${dB ? `${dB.hits}/${dB.admitted}` : '—'} admitted rows within 2 blocks of the next commit`);
    if (!dry) writeFileSync(FLOOR, JSON.stringify(floor, null, 1) + '\n');
  }
  const ledgerRows = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const tried = new Set(ledgerRows.filter((r) => r.floor_key === floor.key && r.corpus_sha === corpus_sha).map((r) => r.key));
  const pass = ledgerRows.length ? (ledgerRows.at(-1).pass || 0) + 1 : 1;
  const t0 = Date.now();
  const res = runPass({ space, floor, runner, tried, max, outcomes });
  for (const row of res.rows) {
    row.pass = pass; row.floor_key = floor.key; row.corpus_sha = corpus_sha;
    const dir = (h) => h && h.direction && h.direction.admitted ? ` dir ${h.direction.hits}/${h.direction.admitted}` : '';
    console.log(`  ${row.verdict.padEnd(10)} ${row.key.padEnd(34)} A ${row.A.admissible}${dir(row.A)}${row.B ? ` · B ${row.B.admissible}${dir(row.B)} · ${row.B.ms_med} ms` : ''} — ${row.why}`);
    if (!dry) appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  }
  if (!dry) writeFileSync(FLOOR, JSON.stringify(res.accepted ? res.floor : { ...floor, pending_looks_on_B: res.floor.pending_looks_on_B }, null, 1) + '\n');
  const wall = Math.round((Date.now() - t0) / 1000);
  console.log(`\npass ${pass}: ${res.evaluated} candidates · ${res.rows.filter((r) => r.B).length} reached B · ${res.unresolved} unresolved · ${res.accepted} accepted · ${wall}s · floor ${res.floor.key} B ${res.floor.B.admissible}/${res.floor.B.n}${res.accepted ? '' : ' — no admissible improvement: a reading of the sensor and of the corpus\'s resolution, not a failure of the loop'}`);
  if (!floorNeverSoftens(res.floor)) { console.error('K1 VIOLATED — the floor softened; refusing to write'); process.exit(3); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
