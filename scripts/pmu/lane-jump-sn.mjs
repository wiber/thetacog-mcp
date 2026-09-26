#!/usr/bin/env node
// scripts/pmu/lane-jump-sn.mjs — THE S/N OF "A DOCTOR ACTING AS A PLUMBER", FROM THE ONE TAPE (spec v4).
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Operator (2026-09-13): "the s/n of knowing when a doctor acts as a plumber appears to be exactly what you
// need to rsi the safety layer (wholly apart from the model's capabilities)". The number, honestly:
//   COMMITS — for each sha with both a commit-intent and a commit-reality row, laneJump = Chebyshev block
//   distance between the two pixels (0 = same cell). Signal = the observed laneJump distribution. Null =
//   the same distances under SHUFFLED pairing (intent of one commit vs reality of another) — the tape's own
//   permutation null, no model, no hand-typed rubric. S/N = (mean_null − mean_obs) / sd_null: how much
//   tighter declared→delivered sits than chance. A commit that plumbs while declaring surgery is an
//   outlier against BOTH: its own laneJump vs the observed distribution.
//   TURNS — the per-turn analogue is the seed's null test already on the row: fit.ok rate and median z.
// UNMEASURED below MIN_N pairs. Read only; the ratchet on this number is a later task.
//   node scripts/pmu/lane-jump-sn.mjs [--last 200] [--json]
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WALK_TAPE } from '../../src/lib/pmu/walk-door.mjs';
import { shortLexToBlock } from './shortlex-coords.mjs';

export const MIN_N = 20;
export const FLOOR = process.env.LANE_JUMP_FLOOR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data/pmu/lane-jump-sn-floor.json');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// THE ONE laneJump — Chebyshev block distance between two pixels on the 144 lattice; 0 = the same block. Every reader of
// "did this commit land in its lane" imports these two (C99e underwriter-line, C93n's reading); a second definition is banned.
export const laneJump = (a, b) => { const A = shortLexToBlock(a), B = shortLexToBlock(b); return Math.max(Math.abs(A.br - B.br), Math.abs(A.bc - B.bc)); };
export const IN_LANE_MAX = 0;
export const inLane = (d) => Number.isFinite(d) && d <= IN_LANE_MAX;
const dist = laneJump;
const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const sd = (xs) => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };

export function readHistory(path = resolve(REPO, 'data/pmu/measure-history.ndjson'), last = 200) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-last);
}
export function readFloor(path = FLOOR) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } }
// the check: worse than the floor → fail; UNMEASURED or no floor → pass (nothing red at birth). Higher S/N is better.
export function check(out, floor) {
  if (out.commits.status === 'UNMEASURED') return { ok: true, why: `UNMEASURED — ${out.commits.n} pairs, need ${MIN_N}` };
  const f = floor.sn; if (!f || !Number.isFinite(f.value)) return { ok: true, why: 'no floor yet — run --ratchet once measured' };
  const snOk = out.commits.sn >= f.value ? { ok: true, why: `S/N ${out.commits.sn} ≥ floor ${f.value} (since ${f.since})` } : { ok: false, why: `S/N ${out.commits.sn} < floor ${f.value} (since ${f.since}) — the detector regressed` };
  // the in-lane Hamming CEILING (on-topic word salad): fails when the in-lane ΔH median rises above the best reached
  const c = floor.hamming_ceiling;
  if (out.salad && out.salad.status === 'measured' && c && Number.isFinite(c.value) && out.salad.inLaneHamming_median > c.value) return { ok: false, why: `${snOk.why}; in-lane ΔH median ${out.salad.inLaneHamming_median} > ceiling ${c.value} (since ${c.since}) — on-topic word salad rising` };
  return snOk;
}
export function ratchet(out, floor, path = FLOOR, today = new Date().toISOString().slice(0, 10)) {
  // each floor ratchets on its own evidence: S/N needs measured pairs; the ΔH ceiling and ε need measured in-lane rows
  let next = floor;
  if (out.commits && out.commits.status !== 'UNMEASURED' && Number.isFinite(out.commits.sn)) { const cur = floor.sn && Number.isFinite(floor.sn.value) ? floor.sn.value : -Infinity; if (out.commits.sn > cur) next = { ...next, sn: { value: out.commits.sn, since: today, n: out.commits.n } }; }
  // the Hamming CEILING only falls: the lowest in-lane ΔH median reached over ≥ MIN_N pairs
  if (out.salad && out.salad.status === 'measured' && Number.isFinite(out.salad.inLaneHamming_median)) { const curC = floor.hamming_ceiling && Number.isFinite(floor.hamming_ceiling.value) ? floor.hamming_ceiling.value : Infinity; if (out.salad.inLaneHamming_median < curC) next = { ...next, hamming_ceiling: { value: out.salad.inLaneHamming_median, since: today, n: out.salad.n } }; }
  // ε (μ_in + 2σ_in) is written once measured and afterwards only TIGHTENS — loosening it is an operator decision, not a ratchet
  if (out.salad && Number.isFinite(out.salad.epsilon)) { const curE = floor.epsilon && Number.isFinite(floor.epsilon.value) ? floor.epsilon.value : Infinity; if (out.salad.epsilon < curE) next = { ...next, epsilon: { value: out.salad.epsilon, since: today, n: out.salad.n, mu_in: out.salad.mu_in, sd_in: out.salad.sd_in, mu_null: out.salad.mu_null } }; }
  if (next !== floor) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(next, null, 2) + '\n'); }
  return next;
}

// windows BY SOURCE: the tape mixes turns, commit pairs and CLI/test runs; one tail window would let a burst
// of one source push the others out. Commit rows: last `last` pairs' worth; turn rows: last `last`, session-bearing only.
export function readRows(tape = WALK_TAPE, last = 200) {
  if (!existsSync(tape)) return [];
  const all = readFileSync(tape, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const commits = all.filter((r) => r.source === 'commit-intent' || r.source === 'commit-reality').slice(-2 * last);
  const turns = all.filter((r) => r.source === 'turn' && r.session).slice(-last);
  return [...commits, ...turns];
}

// Deterministic shuffle (LCG) so the null is re-runnable by anyone from the same tape.
function shuffled(xs, seed = 7) { const a = [...xs]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// THE COMMIT PAIRS, one per sha (first-seen order): the last commit-intent and commit-reality pixel written for that ref,
// admissible only when BOTH sides pass the seed's own null test (fit.ok), d = laneJump between them, ts = the reality
// row's timestamp. Rows without a ref or a pixel (turns, lens-cli, spec-tree) never pair. One definition; laneJumpSN and
// the underwriter's line both read through it.
export function commitPairs(rows) {
  const byRef = new Map(), okRef = new Map(), tsRef = new Map();
  for (const r of rows) { if (!r.ref || !r.pixel) continue; if (!byRef.has(r.ref)) byRef.set(r.ref, {}); byRef.get(r.ref)[r.source] = r.pixel; if (!okRef.has(r.ref)) okRef.set(r.ref, {}); okRef.get(r.ref)[r.source] = !!(r.fit && r.fit.ok); if (!tsRef.has(r.ref)) tsRef.set(r.ref, {}); tsRef.get(r.ref)[r.source] = r.ts || null; }
  return [...byRef.entries()].filter(([, p]) => p['commit-intent'] && p['commit-reality']).map(([ref, p]) => ({
    ref, intent: p['commit-intent'], reality: p['commit-reality'], admissible: !!(okRef.get(ref)?.['commit-intent'] && okRef.get(ref)?.['commit-reality']),
    d: laneJump(p['commit-intent'], p['commit-reality']), ts: tsRef.get(ref)?.['commit-reality'] || tsRef.get(ref)?.['commit-intent'] || null,
  }));
}

export function laneJumpSN(rows) {
  // ADMISSIBILITY (2026-09-13): a lane jump between two placements the seed's own null test rejects is noise — measured,
  // 1 admissible pair in 88 gave S/N ≈ 0 exactly as the fit predicted. The S/N that counts is over ADMISSIBLE pairs
  // (both sides fit.ok); the any-pair S/N is kept beside it for transparency, never as the number.
  const all = commitPairs(rows);
  const pairsAll = all.map((c) => [c.ref, { 'commit-intent': c.intent, 'commit-reality': c.reality }]);
  const admissibleRefs = new Set(all.filter((c) => c.admissible).map((c) => c.ref));
  const pairs = pairsAll.map(([, p]) => p);
  const obs = pairs.map((p) => dist(p['commit-intent'], p['commit-reality']));
  const nullD = []; if (pairs.length >= 2) for (let k = 0; k < 5; k++) { const re = shuffled(pairs.map((p) => p['commit-reality']), 7 + k); pairs.forEach((p, i) => { if (re[i] !== p['commit-reality'] || pairs.length < 3) nullD.push(dist(p['commit-intent'], re[i])); }); }
  const snAny = obs.length >= MIN_N && sd(nullD) ? +(((mean(nullD) - mean(obs)) / sd(nullD)).toFixed(2)) : null;
  const admPairs = pairsAll.filter(([ref]) => admissibleRefs.has(ref)).map(([, p]) => p);
  const admObs = admPairs.map((p) => dist(p['commit-intent'], p['commit-reality']));
  const admNull = []; if (admPairs.length >= 2) for (let k = 0; k < 5; k++) { const re = shuffled(admPairs.map((p) => p['commit-reality']), 11 + k); admPairs.forEach((p, i) => { if (re[i] !== p['commit-reality'] || admPairs.length < 3) admNull.push(dist(p['commit-intent'], re[i])); }); }
  const sn = admObs.length >= MIN_N && sd(admNull) ? +(((mean(admNull) - mean(admObs)) / sd(admNull)).toFixed(2)) : null;
  // the PRIOR declaration series (spec v5): prior pixel (last turn before the walk) vs reality, from the priced
  // ledger rows the commit gate writes; and ΔH, the Hamming distance on the 144 mask. Both read off measure-history.
  const hist = readHistory();
  const prior = hist.map((r) => r.laneJumpPrior).filter(Number.isFinite), ham = hist.map((r) => r.laneHamming).filter(Number.isFinite);
  // ON-TOPIC WORD SALAD (operator 2026-09-13): laneJump 0 (stayed in the cell) but ΔH large — the micro-topology moved
  // while the macro did not. inLaneHam = ΔH over pairs with laneJump 0; the CEILING is the best (lowest) median reached
  // over ≥ MIN_N such pairs and only falls; salad_rate = share of in-lane pairs with ΔH above the ceiling.
  const inLaneHam = hist.filter((r) => inLane(r.laneJump) && Number.isFinite(r.laneHamming)).map((r) => r.laneHamming);
  // ε = μ_in + 2σ_in over ≥ MIN_N in-lane pairs (calibrated from the tape, never typed); μ_null from the word-salad
  // walks the commit gate records; separation = (μ_null − μ_in)/σ_in says whether the instrument can tell the two apart.
  const nullHam = hist.map((r) => r.laneHammingNull).filter(Number.isFinite);
  const muIn = inLaneHam.length ? mean(inLaneHam) : null, sdIn = inLaneHam.length >= 2 ? sd(inLaneHam) : null;
  const epsilon = inLaneHam.length >= MIN_N && sdIn != null ? +(muIn + 2 * sdIn).toFixed(2) : null;
  const muNull = nullHam.length ? +mean(nullHam).toFixed(2) : null;
  const separation = epsilon != null && muNull != null && sdIn ? +((muNull - muIn) / sdIn).toFixed(2) : null;
  const saladRate = epsilon != null ? +(inLaneHam.filter((h) => h > epsilon).length / inLaneHam.length).toFixed(3) : null;
  const priorStatuses = hist.map((r) => r.priorStatus).filter(Boolean);
  const priorMix = priorStatuses.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const turns = rows.filter((r) => r.source === 'turn' && r.fit);
  return {
    commits: { n: pairs.length, admissible_n: admPairs.length, status: admObs.length < MIN_N ? 'UNMEASURED' : 'measured', sn_any_pairs: snAny, admissible_laneJump_mean: admObs.length ? +mean(admObs).toFixed(2) : null, laneJump_median: median(obs), laneJump_mean: obs.length ? +mean(obs).toFixed(2) : null, null_mean: nullD.length ? +mean(nullD).toFixed(2) : null, null_sd: nullD.length ? +sd(nullD).toFixed(2) : null, sn, outliers: pairs.map((p, i) => ({ ...p, d: obs[i] })).filter((p) => p.d >= 3).length },
    prior: { n: prior.length, status: prior.length < MIN_N ? 'UNMEASURED' : 'measured', laneJumpPrior_median: median(prior), hamming_median: median(ham), hamming_n: ham.length, priorMix },
    salad: { n: inLaneHam.length, status: inLaneHam.length < MIN_N ? 'UNMEASURED' : 'measured', inLaneHamming_median: median(inLaneHam), mu_in: muIn != null ? +muIn.toFixed(2) : null, sd_in: sdIn != null ? +sdIn.toFixed(2) : null, epsilon, mu_null: muNull, null_n: nullHam.length, separation, salad_rate: saladRate },
    turns: { n: turns.length, status: turns.length < MIN_N ? 'UNMEASURED' : 'measured', fit_ok_rate: turns.length ? +(turns.filter((r) => r.fit.ok).length / turns.length).toFixed(3) : null, z_median: median(turns.map((r) => r.fit.z).filter(Number.isFinite)) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const out = laneJumpSN(readRows(WALK_TAPE, Number(arg('--last', 200))));
  let floor = readFloor(); if (process.argv.includes('--ratchet')) floor = ratchet(out, floor);
  const verdict = check(out, floor);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...out, floor: floor.sn || null, check: verdict }));
  else {
    console.log(`lane-jump S/N · ${WALK_TAPE.replace(REPO + '/', '')}`);
    console.log(`  commits n=${out.commits.n} (admissible ${out.commits.admissible_n}) · ${out.commits.status} · laneJump median ${out.commits.laneJump_median} mean ${out.commits.laneJump_mean} · null mean ${out.commits.null_mean} sd ${out.commits.null_sd} · S/N(admissible) ${out.commits.sn} · S/N(any, transparency) ${out.commits.sn_any_pairs} · outliers(≥3) ${out.commits.outliers}`);
    console.log(`  prior   n=${out.prior.n} · ${out.prior.status} · laneJumpPrior median ${out.prior.laneJumpPrior_median} · ΔH median ${out.prior.hamming_median} (n ${out.prior.hamming_n}) · T0 ${JSON.stringify(out.prior.priorMix)}`);
    console.log(`  salad   n=${out.salad.n} · ${out.salad.status} · in-lane ΔH μ ${out.salad.mu_in} σ ${out.salad.sd_in} · ε=μ+2σ ${out.salad.epsilon} (floor ${floor.epsilon ? floor.epsilon.value : 'none'}) · null μ ${out.salad.mu_null} (n ${out.salad.null_n}) · separation ${out.salad.separation} · salad rate ${out.salad.salad_rate}`);
    console.log(`  turns   n=${out.turns.n} · ${out.turns.status} · fit ok ${out.turns.fit_ok_rate} · z median ${out.turns.z_median}`);
    console.log(`  floor: ${floor.sn ? `${floor.sn.value} since ${floor.sn.since}` : 'none'} · ${verdict.ok ? 'OK' : 'FAIL'} — ${verdict.why}`);
  }
  if (process.argv.includes('--check') && !verdict.ok) process.exit(1);
}
