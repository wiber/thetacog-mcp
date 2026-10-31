#!/usr/bin/env node
// scripts/vna/forecast-rct.mjs — C610f: THE RANDOMISED READ — DOES THE FORECAST LOWER THE RED RATE AFTER THE COMMIT.
//
// C610e put the forecast in the brief only when its hit rate reads MEASURED. This file asks whether handing it over changes where the
// work lands, as a randomised comparison run on the same days by the same workers:
//   ASSIGN  — armOf(label, seed) is a pure function of (label, seed): sha256(seed \0 label), first byte's low bit. FORECAST gets the
//             block when (and only when) C610e's gate admits it; CONTROL never gets it. The arm is appended to the assignment ledger
//             (<runner dir>/forecast-rct.ndjson) by briefForecast at dispatch time, BEFORE the worker starts, and is never rewritten:
//             a second dispatch of the same label returns the first row. Nothing about the outcome enters the function.
//   SCORE   — after the ticking commit, LLM-free. PRIMARY: the commit's Δ off-lane % against its own row (the C610b outcome panel);
//             SECONDARY: whether an intervention fired (data/interventions/events.ndjson — the ROOM lane, offPct > 15, reported beside
//             the primary and never merged into it); TERTIARY: C609a code-only bits gain for the row, when a scorer supplied it.
//   READ    — halves split by session day; per half the difference control − forecast on the primary (positive = the forecast arm
//             landed closer to its row) against K shuffles of the arm labels inside the half. Bar: n ≥ 20 per arm per half and z ≥ 2
//             in both halves, else UNMEASURED with the counts. An outcome whose commit predates its assignment is FENCED (the arm was
//             not fixed before it), and a recorded arm that disagrees with armOf(label, seed) is EXCLUDED and named.
//   When no FORECAST-arm dispatch could carry the block (C610e's gate read UNMEASURED at every one), the arms cannot differ by
//   construction and the reading is UNMEASURED — "treatment cannot inject: the forecast is UNMEASURED". Never a faked difference.
//
// Writes data/vna/forecast-rct.json; line 1:
//   C610f: Δ off-lane forecast <f> % vs control <c> % · fired <ff> % vs <cf> % · diff <a>|<b> vs null <m>|<m> (sd <s>|<s>) · z <a>|<b> · n <F/C>|<F/C> · MEASURED|UNMEASURED — why
// SUFFICIENT FOR: whether handing the forecast to the builder changed where the work landed, at the row's lane and at the room's.
// NOT SUFFICIENT FOR: whether any single commit was good, or why a builder moved.
// Rust port row: C610f-port — BUILT by C612q: readRct shuttles the ledger and the outcomes to `pmu-onchip --rct-read`
// (lens.rs mod c612q); readRctMjs below is the reference, reached only with VNA_C612Q_MJS=1. armOf stays node (a pure hash).
// @guard tests/vna/c610f-the-randomised-read.test.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { crateCall, bare, mjsReference } from './crate-call.mjs';   // C612q: the read decides in the crate (pmu-onchip --rct-read)

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SEED = 'C610f';
export const ARMS = Object.freeze(['FORECAST', 'CONTROL']);
export const BAR = Object.freeze({ z: 2, n: 20 });
export const K_DEFAULT = 200;
export const OUT_JSON = resolve(REPO, 'data/vna/forecast-rct.json');
export const LEDGER_NAME = 'forecast-rct.ndjson';
export const NO_INJECT = 'treatment cannot inject: the forecast is UNMEASURED';
export const SUFFICIENT_FOR = "whether handing the forecast to the builder changed where the work landed, at the row's lane and at the room's";
export const NOT_SUFFICIENT_FOR = 'whether any single commit was good, or why a builder moved';
export const PORT_ROW = 'C610f-port';

/** THE ARM — a pure function of (label, seed). Nothing else is an input. */
export function armOf(label, seed = SEED) {
  const b = createHash('sha256').update(`${seed}\0${label}`).digest()[0];
  return (b & 1) === 0 ? 'FORECAST' : 'CONTROL';
}

export const rctLedgerPath = (dir) => join(dir, LEDGER_NAME);

function readNdjson(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []; } catch { return []; }
}

/** Record the arm BEFORE the dispatch. Idempotent per (label, seed): the first row stands, the arm is never re-drawn. */
export function assignArm({ label, seed = SEED, ledger, head = null, could_inject = false, at = new Date().toISOString() }) {
  const arm = armOf(label, seed);
  const prior = readNdjson(ledger).find((r) => r.kind === 'rct-assign' && r.label === label && r.seed === seed);
  if (prior) return { ...prior, fresh: false };
  const row = { at, kind: 'rct-assign', row: 'C610f', label, seed, arm, head, could_inject: !!could_inject, in_brief: arm === 'FORECAST' && !!could_inject };
  try { mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify(row) + '\n'); } catch { /* a reading, never a gate */ }
  return { ...row, fresh: true };
}

// ── the read ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function rng(seed) {   // mulberry32 over a string hash — the shuffle is re-runnable from (seed, half)
  let a = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = (xs) => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const f1 = (x) => (x == null ? '—' : Number(x).toFixed(1));
const f2 = (x) => (x == null ? '—' : Number(x).toFixed(2));
const pct = (x) => (x == null ? '—' : (100 * x).toFixed(1));

/** One half: control − forecast on the primary, against K shuffles of the arm labels inside the half. */
function readHalf(units, { K, seed, tag }) {
  const F = units.filter((u) => u.arm === 'FORECAST'), C = units.filter((u) => u.arm === 'CONTROL');
  const pf = F.map((u) => u.primary).filter(isNum), pc = C.map((u) => u.primary).filter(isNum);
  const firedRate = (xs) => { const v = xs.map((u) => u.fired).filter((x) => typeof x === 'boolean'); return v.length ? v.filter(Boolean).length / v.length : null; };
  const out = { half: tag, n_forecast: pf.length, n_control: pc.length, forecast: mean(pf), control: mean(pc),
    fired_forecast: firedRate(F), fired_control: firedRate(C), diff: null, null_mean: null, null_sd: null, z: null,
    sessions: [...new Set(units.map((u) => u.session))].sort() };
  if (!pf.length || !pc.length) return out;
  out.diff = mean(pc) - mean(pf);
  const pool = [...pf, ...pc], nf = pf.length, r = rng(`${seed}:${tag}`), draws = [];
  for (let k = 0; k < K; k++) {
    const a = pool.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    draws.push(mean(a.slice(nf)) - mean(a.slice(0, nf)));
  }
  out.null_mean = mean(draws); out.null_sd = sd(draws);
  out.z = out.null_sd > 0 ? (out.diff - out.null_mean) / out.null_sd : (out.diff === out.null_mean ? 0 : null);
  return out;
}

/** readRct — join the assignment ledger with the outcomes; never a naked z (every z rides with both n's, the diff and its null). */
export function readRct({ assignments = [], outcomes = [], seed = SEED, K = K_DEFAULT } = {}) {
  if (mjsReference()) return readRctMjs({ assignments, outcomes, seed, K });
  return bare(crateCall('--rct-read', { assignments, outcomes, seed, K }, { engine: 'rust-rct-read' }));
}
export function readRctMjs({ assignments = [], outcomes = [], seed = SEED, K = K_DEFAULT } = {}) {
  const firstAssign = new Map(), excluded = [];
  for (const a of assignments.filter((r) => r && r.kind === 'rct-assign' && r.seed === seed)) {
    if (firstAssign.has(a.label)) continue;
    if (a.arm !== armOf(a.label, seed)) { excluded.push({ label: a.label, why: `recorded arm ${a.arm} is not armOf(${a.label}, ${seed}) = ${armOf(a.label, seed)}` }); firstAssign.set(a.label, null); continue; }
    firstAssign.set(a.label, a);
  }
  const byLabel = new Map(outcomes.map((o) => [o.label, o]));
  const units = [], fenced = [];
  for (const [label, a] of firstAssign) {
    if (!a) continue;
    const o = byLabel.get(label);
    if (!o) continue;
    if (o.commit_at && a.at && Date.parse(o.commit_at) <= Date.parse(a.at)) { fenced.push({ label, why: `commit ${o.sha || '?'} at ${o.commit_at} is not after the assignment at ${a.at}` }); continue; }
    units.push({ label, arm: a.arm, in_brief: !!a.in_brief, session: String(a.at || '').slice(0, 10), primary: isNum(o.primary) ? o.primary : null, fired: typeof o.fired === 'boolean' ? o.fired : null, bits: isNum(o.bits) ? o.bits : null, landed: o.landed || null, zones: o.zones || null });
  }
  const assigned = [...firstAssign.values()].filter(Boolean);
  const counts = { assigned: assigned.length, forecast: assigned.filter((a) => a.arm === 'FORECAST').length, control: assigned.filter((a) => a.arm === 'CONTROL').length,
    injected: assigned.filter((a) => a.arm === 'FORECAST' && a.in_brief).length, scored: units.length, fenced: fenced.length, excluded: excluded.length };
  const days = [...new Set(units.map((u) => u.session))].sort();
  const cut = Math.ceil(days.length / 2), daysA = new Set(days.slice(0, cut));
  const halves = [readHalf(units.filter((u) => daysA.has(u.session)), { K, seed, tag: 'a' }), readHalf(units.filter((u) => !daysA.has(u.session)), { K, seed, tag: 'b' })];
  const why = [];
  if (counts.injected === 0) why.push(NO_INJECT);
  halves.forEach((h) => {
    if (!(h.n_forecast >= BAR.n)) why.push(`n forecast ${h.n_forecast} < ${BAR.n} in half ${h.half}`);
    if (!(h.n_control >= BAR.n)) why.push(`n control ${h.n_control} < ${BAR.n} in half ${h.half}`);
    if (!(isNum(h.z) && h.z >= BAR.z)) why.push(`z ${f2(h.z)} < ${BAR.z} in half ${h.half}`);
  });
  const verdict = why.length ? 'UNMEASURED' : 'MEASURED';
  const allF = units.filter((u) => u.arm === 'FORECAST'), allC = units.filter((u) => u.arm === 'CONTROL');
  const mp = (xs) => mean(xs.map((u) => u.primary).filter(isNum));
  const fr = (xs) => { const v = xs.map((u) => u.fired).filter((x) => typeof x === 'boolean'); return v.length ? v.filter(Boolean).length / v.length : null; };
  // descriptive only: did a FORECAST-arm commit land inside the forecast's consensus zone or its contested one
  const zone = { consensus: 0, contested: 0, neither: 0, unplaced: 0 };
  for (const u of allF) {
    if (!u.landed || !u.zones) { zone.unplaced++; continue; }
    const contested = new Set(u.zones.contested || []), consensus = new Set((u.zones.consensus || []).filter((c) => !contested.has(c)));
    if (consensus.has(u.landed)) zone.consensus++; else if (contested.has(u.landed)) zone.contested++; else zone.neither++;
  }
  const line = `C610f: Δ off-lane forecast ${f1(mp(allF))} % vs control ${f1(mp(allC))} % · fired ${pct(fr(allF))} % vs ${pct(fr(allC))} % · diff ${halves.map((h) => f2(h.diff)).join('|')} vs null ${halves.map((h) => f2(h.null_mean)).join('|')} (sd ${halves.map((h) => f2(h.null_sd)).join('|')}) · z ${halves.map((h) => f2(h.z)).join('|')} · n ${halves.map((h) => `${h.n_forecast}/${h.n_control}`).join('|')} · ${verdict}${why.length ? ` — ${why.join('; ')}` : ' — control − forecast clears z ≥ 2 with n ≥ 20 per arm in both halves'}`;
  const line2 = `C610f descriptive (never a verdict): FORECAST-arm commits landing in the consensus zone ${zone.consensus} · contested zone ${zone.contested} · neither ${zone.neither} · unplaced ${zone.unplaced} · assigned ${counts.assigned} (forecast ${counts.forecast}, control ${counts.control}, injected ${counts.injected}) · scored ${counts.scored} · fenced ${counts.fenced} · excluded ${counts.excluded}`;
  return { row: 'C610f', llm: false, seed, K, bar: BAR, verdict, why, line, line2, counts, halves, zone, fenced, excluded,
    sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR, port_row: PORT_ROW };
}

// ── the live shuttle: the ledger's assignments → the ticking commit → its room-lane outcome (git and the ledgers; no LLM) ──
function tickingCommit(label, after) {
  try {
    const out = execFileSync('git', ['log', `--since=${after}`, '--format=%H%x09%cI%x09%s', '-F', `--grep=${label}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] });
    const rows = out.split('\n').filter(Boolean).map((l) => { const [sha, at, subj] = l.split('\t'); return { sha, at, subj }; })
      .filter((r) => new RegExp(`\\b${label}\\b`).test(r.subj) && Date.parse(r.at) > Date.parse(after));
    return rows.length ? rows[rows.length - 1] : null;   // git log is newest first — the first commit after the assignment
  } catch { return null; }
}

export function runLive({ runnerDir = process.env.VNA_RUNNER_LOG_DIR || resolve(REPO, '.thetacog/runner'), out = OUT_JSON, K = K_DEFAULT } = {}) {
  const assignments = readNdjson(rctLedgerPath(runnerDir));
  const events = readNdjson(resolve(REPO, 'data/interventions/events.ndjson'));
  const fired = new Set(events.map((e) => String(e.sha || '').slice(0, 9)).filter(Boolean));
  const outcomes = [];
  for (const a of assignments.filter((r) => r.kind === 'rct-assign' && r.seed === SEED)) {
    const c = tickingCommit(a.label, a.at); if (!c) continue;
    // PRIMARY (Δ off-lane against the row, C610b's outcome panel) is read from the scored sidecar when a scorer has written it;
    // absent → null, never a zero. SECONDARY is the room lane's intervention ledger.
    let primary = null, landed = null, zones = null, bits = null;
    try { const s = JSON.parse(readFileSync(join(runnerDir, `leaf-${a.label}.outcome.json`), 'utf8')); if (s.sha && c.sha.startsWith(String(s.sha).slice(0, 9))) { primary = isNum(s.delta_off_pct) ? s.delta_off_pct : null; landed = s.landed || null; zones = s.zones || null; bits = isNum(s.bits) ? s.bits : null; } } catch { /* unscored */ }
    outcomes.push({ label: a.label, sha: c.sha, commit_at: c.at, primary, fired: fired.has(c.sha.slice(0, 9)), bits, landed, zones });
  }
  const r = readRct({ assignments, outcomes, K });
  const doc = { at: new Date().toISOString(), ...r, ledger: rctLedgerPath(runnerDir), outcomes };
  if (out) try { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); } catch { /* a reading, never a gate */ }
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = runLive();
  console.log(d.line); console.log(d.line2);
}
