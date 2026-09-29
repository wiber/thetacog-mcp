#!/usr/bin/env node
// scripts/vna/steer-metrics.mjs — C93n: the steer's four gauges become ONE ledger with a target each.
//
// THE NIGHT THAT MADE THIS A ROW (operator 2026-09-19, "make a plan and optimise the metrics I asked for"). Four gauges
// already printed on every turn — the walk's admission, the aperture ratchet's graded count, the goal's turn budget, the
// clear gauge — and each was read off a different receipt by hand: walk admission 0/85 · aperture 144 holds at 0/20 ·
// turn budget 19 of 5–10 ignored · clear gauge OVERDUE from turn 2 at 6.4 MB · commit drift offPct median 35 / laneJump
// median 6 unread. A gauge nobody can add up is a label. This file is the ledger the four already-measured numbers land on
// (one row per prompt turn, written by the steer hook, LLM-free) and the FIVE TARGETS the day is read against — each a
// PASS / FAIL / UNMEASURED with its why, never a bare number:
//   (1) WALK ADMISSION ≥ the seed-release null's OWN admit rate at the ratcheted threshold (C53b). The threshold is a
//       ratchet row (walkThresholdRow) that REFUSES to move without a null re-run whose false-admit sits under its floor —
//       never a hand-lowered gain/z.
//   (2) APERTURE: n_graded under the live version reaches MIN_TURNS within one day of lensed turns (C93m un-starved it).
//   (3) TURN BUDGET: a goal over max HALTS the runner's next dispatch (budgetGate, read by steer-runner before it plans)
//       and prints the overrun on the card — a gate, not a label. The chair is warned, never halted (C91c owns the chair).
//   (4) CARRY: until the eviction (C91c) fires, the ledger counts the turns that ran OVERDUE — the number that must fall.
//   (5) DRIFT FEEDBACK: the last landed commit's offPct and laneJump ride the next row; above a floor read from the tape's
//       OWN distribution (a quantile of measure-history, never a typed 25 %) the snowball count shrinks to 1 and the line
//       says `re-centre` — the knob C93g declares, driven by drift.
// Every reader here is pure over rows handed in; the I/O doors (readRatchet · readMeasure · readNull · appendMetricsRow)
// are named and small so a test never touches the live record.
// @guard tests/vna/c93-steer-metrics.test.mjs
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workRows } from '../pmu/setpoint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const LEDGER = process.env.VNA_STEER_METRICS || resolve(REPO, '.thetacog/vna-steer-metrics.ndjson');
export const RATCHET = process.env.LENS_APERTURE_RATCHET || resolve(REPO, '.thetacog/lens-aperture-ratchet.ndjson');
export const MEASURE = process.env.PMU_MEASURE_HISTORY || resolve(REPO, 'data/pmu/measure-history.ndjson');
export const NULL_ROW = process.env.VNA_SEED_RELEASE_NULL || resolve(REPO, 'data/vna/seed-release-null.json');
export const THRESHOLDS = process.env.VNA_WALK_THRESHOLDS || resolve(REPO, 'data/vna/walk-threshold.ndjson');
export const TARGET_IDS = ['walk', 'aperture', 'budget', 'carry', 'drift'];
export const DRIFT_FLOOR_Q = 0.75, DRIFT_FLOOR_MIN_N = 20, DRIFT_FLOOR_LAST = 200;
export const MIN_TURNS = Number(process.env.LENS_RATCHET_MIN_TURNS || 20);   // the aperture ratchet's own bar (lens-aperture-ratchet.mjs)

const nd = (p) => { try { return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const r3 = (x) => (x == null ? null : +(+x).toFixed(3));
const quantile = (arr, q) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null; };

// ── the four gauges, each read off its own receipt into a named shape ─────────────────────────────────────────────
// the seed row the hook already built (spec-tree seedSpecFirst): an admitted walk re-aimed; a released one rode as context
// (UNMEASURED); a short or massless prompt abstained — the walk never ran, so it is neither a hit nor a miss on target 1.
export function walkOf(seed) {
  if (!seed || seed.abstained || !seed.leaf) return 'abstained';
  if (seed.released || seed.stage === 'released' || seed.anchor === 'prompt-released') return 'released';
  return 'admitted';
}
export function apertureOf(rows) {
  const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
  if (!last) return { version: null, n_graded: null, floor: null };
  return { version: last.version ?? (last.current && last.current.version) ?? null, n_graded: num(last.current && last.current.n), floor: last.floor ?? null };
}
export function budgetOf(goal) {
  const t = goal && goal.turns; if (!t) return { used: null, max: null, over: null };
  return { used: num(t.used), max: num(t.max), over: t.used != null && t.max != null ? t.used > t.max : null };
}
export function lastCommitOf(rows) {
  const work = workRows(rows);   // C322b: the last WORK commit — a setpoint step (spec-only tick) is never read as drift
  const last = work.length ? work[work.length - 1] : null;
  if (!last) return { sha: null, offPct: null, laneJump: null };
  return { sha: last.sha ?? null, offPct: num(last.offPct), laneJump: num(last.laneJump) };
}
// (5) the floor is the tape's own quantile over its newest rows — under DRIFT_FLOOR_MIN_N it is UNMEASURED and the knob is untouched
export function driftFloor(rows, { q = DRIFT_FLOOR_Q, last = DRIFT_FLOOR_LAST, minN = DRIFT_FLOOR_MIN_N } = {}) {
  const win = workRows(rows).slice(-last);   // C322b: setpoint rows stay on the tape, out of the floor
  const off = win.map((r) => num(r.offPct)).filter((x) => x != null), lj = win.map((r) => num(r.laneJump)).filter((x) => x != null);
  if (off.length < minN) return { status: 'UNMEASURED', n: off.length, q, offPct: null, laneJump: null, why: `${off.length} rows of measure-history carry offPct, need ${minN} — no floor, the knob is untouched` };
  return { status: 'measured', n: off.length, q, offPct: quantile(off, q), laneJump: quantile(lj, q), source: 'data/pmu/measure-history.ndjson' };
}
export function recentre({ lastCommit, floor }) {
  const lc = lastCommit || {};
  if (!floor || floor.status !== 'measured') return { recentre: false, count: null, line: `drift feedback UNMEASURED — ${floor && floor.why ? floor.why : 'no floor'}` };
  if (lc.offPct == null) return { recentre: false, count: null, line: 'drift feedback UNMEASURED — no landed commit on measure-history' };
  const hot = lc.offPct > floor.offPct;
  return hot
    ? { recentre: true, count: 1, line: `re-centre — last commit ${lc.sha || '?'} off-lane ${lc.offPct} % above the tape's p${Math.round(floor.q * 100)} floor ${floor.offPct} % (laneJump ${lc.laneJump ?? '—'} vs ${floor.laneJump ?? '—'}) · snowball count → 1` }
    : { recentre: false, count: null, line: `in band — last commit ${lc.sha || '?'} off-lane ${lc.offPct} % at or under the tape's p${Math.round(floor.q * 100)} floor ${floor.offPct} %` };
}

// ── the row — one per prompt turn, every field present (null is a value; absence is a defect the guard counts) ─────
export function metricsRow({ at = new Date().toISOString(), session = null, turn = null, seed = null, ratchet = [], goal = null, gauge = null, measure = [] } = {}) {
  const last_commit = lastCommitOf(measure), drift_floor = driftFloor(measure), rc = recentre({ lastCommit: last_commit, floor: drift_floor });
  return {
    at, session, turn,
    walk: walkOf(seed), walk_fit: seed && seed.walk ? { gain: num(seed.walk.gain), z: num(seed.walk.z), z_required: num(seed.walk.z_required) } : null,
    aperture: apertureOf(ratchet), budget: budgetOf(goal),
    carry_bytes: gauge ? num(gauge.contextBytes) : null, gauge_state: gauge ? gauge.state ?? null : null,
    last_commit, drift_floor: { status: drift_floor.status, offPct: drift_floor.offPct, laneJump: drift_floor.laneJump, n: drift_floor.n, q: drift_floor.q },
    recentre: rc.recentre, snowball_count: rc.count,
  };
}
export function appendMetricsRow(row, path = LEDGER) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(row) + '\n'); return row; }
export function readMetrics(path = LEDGER, { day = null } = {}) { const rows = nd(path); return day ? rows.filter((r) => String(r.at || '').slice(0, 10) === day) : rows; }
export const readRatchet = (p = RATCHET) => nd(p);
export const readMeasure = (p = MEASURE) => nd(p);
export const readNull = (p = NULL_ROW) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// ── the five targets ──────────────────────────────────────────────────────────────────────────────────────────────
// (1) the null's own admit rate: of the pairs the seed-release null placed, the fraction it found admissible at the threshold in force
export function nullAdmitRate(nullRow) {
  const n = nullRow && nullRow.steering && num(nullRow.steering.n), pairs = nullRow && num(nullRow.pairs);
  return n != null && pairs ? r3(n / pairs) : null;
}
const target = (id, name, status, value, tgt, why, unit = '') => ({ id, name, status, value, target: tgt, why, line: `${status.padEnd(10)} ${name} — ${value == null ? '—' : value}${unit}${tgt == null ? '' : ` vs target ${tgt}${unit}`} · ${why}` });
export function daySummary({ rows = [], day = null, nullRow = null, minTurns = MIN_TURNS } = {}) {
  const R = rows;
  // (1) WALK ADMISSION — admitted / walked (abstained turns were never walked)
  const walked = R.filter((r) => r.walk === 'admitted' || r.walk === 'released'), adm = walked.filter((r) => r.walk === 'admitted').length;
  const nullRate = nullAdmitRate(nullRow), rate = walked.length ? r3(adm / walked.length) : null;
  const walk = !walked.length ? target('walk', 'walk admission', 'UNMEASURED', null, nullRate, `no walked turn on ${day || 'the ledger'} (${R.length - walked.length} abstained)`)
    : nullRate == null ? target('walk', 'walk admission', 'UNMEASURED', rate, null, `the seed-release null carries no admit rate (steering.n / pairs) — target unset, never hand-typed`)
    : target('walk', 'walk admission', rate >= nullRate ? 'PASS' : 'FAIL', rate, nullRate, `${adm} admitted of ${walked.length} walked · null ${nullRow.steering.n}/${nullRow.pairs} at z_required (C53b)`);
  // (2) APERTURE — the live version's graded count against MIN_TURNS, judged once a day's worth of lensed turns has passed
  const apRows = R.filter((r) => r.aperture && r.aperture.version), live = apRows.length ? apRows[apRows.length - 1].aperture : null;
  const nMax = live ? Math.max(...apRows.filter((r) => r.aperture.version === live.version).map((r) => r.aperture.n_graded ?? 0)) : null;
  const aperture = !live ? target('aperture', 'aperture n_graded', 'UNMEASURED', null, minTurns, 'no aperture version on the ledger — the ratchet has not written a row')
    : nMax >= minTurns ? target('aperture', 'aperture n_graded', 'PASS', nMax, minTurns, `version ${live.version} graded ${nMax} turns${live.floor ? ' · floor set' : ' · no floor yet'}`)
    : R.length >= minTurns ? target('aperture', 'aperture n_graded', 'FAIL', nMax, minTurns, `version ${live.version} graded ${nMax} of ${minTurns} across ${R.length} lensed turns — the grader is starved (C93m) or the version rotated`)
    : target('aperture', 'aperture n_graded', 'UNMEASURED', nMax, minTurns, `version ${live.version} graded ${nMax} after ${R.length} lensed turns — under a day's worth (${minTurns}), not yet judged`);
  // (3) TURN BUDGET — any turn that ran over is the gate firing; the value is the worst overrun
  const bRows = R.filter((r) => r.budget && r.budget.max != null), overRows = bRows.filter((r) => r.budget.over);
  const worst = overRows.length ? overRows.reduce((a, b) => (b.budget.used > a.budget.used ? b : a)).budget : null;
  const budget = !bRows.length ? target('budget', 'turn budget', 'UNMEASURED', null, null, 'no /goal on the ledger — no budget to gate')
    : overRows.length ? target('budget', 'turn budget', 'FAIL', overRows.length, 0, `${overRows.length} turn${overRows.length === 1 ? '' : 's'} ran over — worst ${worst.used} of ${worst.max} · the runner halts its next dispatch (budgetGate)`, ' over')
    : target('budget', 'turn budget', 'PASS', 0, 0, `${bRows[bRows.length - 1].budget.used} of ${bRows[bRows.length - 1].budget.max} used, never over`, ' over');
  // (4) CARRY — turns that ran OVERDUE, the number that must fall until C91c evicts
  const gRows = R.filter((r) => r.gauge_state), overdue = gRows.filter((r) => /OVERDUE/i.test(String(r.gauge_state))).length;
  const carry = !gRows.length ? target('carry', 'carry OVERDUE turns', 'UNMEASURED', null, 0, 'no clear-gauge state on the ledger (no transcript_path on these turns)')
    : overdue ? target('carry', 'carry OVERDUE turns', 'FAIL', overdue, 0, `${overdue} of ${gRows.length} turns ran OVERDUE · last carry ${fmtB(gRows[gRows.length - 1].carry_bytes)} — the eviction (C91c) has not fired`)
    : target('carry', 'carry OVERDUE turns', 'PASS', 0, 0, `${gRows.length} turns, none OVERDUE · last carry ${fmtB(gRows[gRows.length - 1].carry_bytes)}`);
  // (5) DRIFT FEEDBACK — the day's last row against the tape's own floor
  const lastR = R.length ? R[R.length - 1] : null;
  const drift = !lastR || !lastR.drift_floor || lastR.drift_floor.status !== 'measured' ? target('drift', 'drift feedback', 'UNMEASURED', lastR && lastR.last_commit ? lastR.last_commit.offPct : null, null, lastR && lastR.drift_floor && lastR.drift_floor.status !== 'measured' ? `floor UNMEASURED (${lastR.drift_floor.n ?? 0} rows, need ${DRIFT_FLOOR_MIN_N})` : 'no row on the ledger')
    : lastR.recentre ? target('drift', 'drift feedback', 'FAIL', lastR.last_commit.offPct, lastR.drift_floor.offPct, `re-centre printed — ${lastR.last_commit.sha || '?'} off-lane above the tape's p${Math.round(lastR.drift_floor.q * 100)} floor · snowball count → 1`, ' %')
    : target('drift', 'drift feedback', 'PASS', lastR.last_commit.offPct, lastR.drift_floor.offPct, `${lastR.last_commit.sha || '?'} at or under the tape's p${Math.round(lastR.drift_floor.q * 100)} floor (n ${lastR.drift_floor.n})`, ' %');
  const targets = [walk, aperture, budget, carry, drift];
  const head = `⟦ STEER METRICS ⟧ ${day || 'all'} · ${R.length} turn${R.length === 1 ? '' : 's'} · ${targets.filter((t) => t.status === 'PASS').length} PASS · ${targets.filter((t) => t.status === 'FAIL').length} FAIL · ${targets.filter((t) => t.status === 'UNMEASURED').length} UNMEASURED`;
  return { day, turns: R.length, targets, lines: [head, ...targets.map((t) => t.line)] };
}
const fmtB = (n) => (n == null || !Number.isFinite(n)) ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;

// ── (1) the threshold is a ratchet row — it moves only on a null re-run whose false-admit sits at or under the floor ─
export function walkThresholdRow({ z, gain, prev = null, nullRerun = null, at = new Date().toISOString(), by = 'cli' } = {}) {
  const floor = prev && num(prev.false_admit_floor);
  if (!nullRerun) return { refused: true, why: 'a walk threshold change without a null re-run row is refused — run the seed-release null at the proposed z/gain and hand its false-admit here' };
  if (num(nullRerun.false_admit) == null || num(nullRerun.n) == null) return { refused: true, why: 'the null re-run must carry false_admit and n (pairs) — a re-run without its n is a feeling' };
  if (floor == null) return { refused: true, why: 'no false-admit floor on the previous threshold row — set prev.false_admit_floor from the first null before ratcheting' };
  if (nullRerun.false_admit > floor) return { refused: true, why: `the null's false-admit ${nullRerun.false_admit} is above its floor ${floor} — the threshold stays at z ${prev.z} / gain ${prev.gain}` };
  return { at, by, z: num(z), gain: num(gain), prev: prev ? { z: prev.z, gain: prev.gain } : null, false_admit_floor: floor, null_rerun: { at: nullRerun.at ?? at, false_admit: nullRerun.false_admit, n: nullRerun.n } };
}
export function appendThresholdRow(row, path = THRESHOLDS) { if (row.refused) return row; mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(row) + '\n'); return row; }
export const lastThreshold = (path = THRESHOLDS) => { const r = nd(path); return r.length ? r[r.length - 1] : null; };

// ── (3) the gate the runner reads before it plans a dispatch; the card prints the same line ───────────────────────
export function budgetGate(goal) {
  const b = budgetOf(goal);
  if (b.max == null || b.used == null) return { halt: false, over_by: 0, line: 'no /goal — no budget' };
  const over_by = Math.max(0, b.used - b.max);
  return over_by > 0
    ? { halt: true, over_by, line: `turns ${b.used} of ${goal.turns.min ?? '?'}–${b.max} · OVER by ${over_by} — the runner halts its next dispatch; close or re-set the goal` }
    : { halt: false, over_by: 0, line: `turns ${b.used} of ${goal.turns.min ?? '?'}–${b.max}` };
}

// ── CLI: --day [YYYY-MM-DD] · --json · --threshold --z <z> --gain <g> --false-admit <f> --n <n> ─────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--threshold')) {
    const row = walkThresholdRow({ z: Number(arg('--z')), gain: Number(arg('--gain')), prev: lastThreshold(), nullRerun: arg('--false-admit') != null ? { at: new Date().toISOString(), false_admit: Number(arg('--false-admit')), n: arg('--n') != null ? Number(arg('--n')) : null } : null });
    appendThresholdRow(row); console.log(row.refused ? `REFUSED — ${row.why}` : `ratcheted → z ${row.z} · gain ${row.gain} · null false-admit ${row.null_rerun.false_admit} (n ${row.null_rerun.n}) ≤ floor ${row.false_admit_floor}`); process.exit(row.refused ? 2 : 0);
  }
  const day = arg('--day') && !arg('--day').startsWith('--') ? arg('--day') : new Date().toISOString().slice(0, 10);
  const s = daySummary({ rows: readMetrics(LEDGER, { day }), day, nullRow: readNull() });
  if (argv.includes('--json')) console.log(JSON.stringify(s)); else console.log(s.lines.join('\n'));
  if (!existsSync(LEDGER)) console.error(`steer-metrics: no ledger at ${LEDGER} — the hook writes one row per prompt turn`);
}
