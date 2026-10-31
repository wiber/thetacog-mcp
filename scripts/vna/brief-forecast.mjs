#!/usr/bin/env node
// scripts/vna/brief-forecast.mjs — C610e: THE FORECAST IN THE BRIEF — ONLY WHEN MEASURED, NEVER A GATE.
//
// At dispatch time the fast tier (drift-note.mjs preRunFastNote, C612a) has already walked the row's declaration and localised its
// cells over the files the row names (C610c's localise()). This file turns that reading into a FORECAST record and decides one
// thing: whether the forecast rides in the brief. It rides ONLY when a scored reading of the forecast's past hit rate reads MEASURED
// — z ≥ 2 with n ≥ 20 in BOTH halves, at the aperture version in force. The readings are read off disk at call time, never
// hard-coded:
//   data/vna/forecast-hit-rate.json  C610b — does the ensemble forecast name where the commit lands, vs a shuffled null
//   data/vna/path-prediction.json    C612c — does a walk version name the invariants the work collides with, per arm, vs a null
// The verdict string is never trusted alone: the halves are re-read and the bar re-applied here, and a reading taken at another
// aperture is UNMEASURED at this one (a different lattice is a different question).
//
// UNMEASURED → the brief is byte-identical to the brief without this file, and the reason goes to the record (the forecast sidecar's
// `line`, and the dispatch's drift-note row), never into the brief: the loop never acts on an UNMEASURED reading.
// In EVERY case the forecast is written beside the brief as <runner dir>/leaf-<label>.forecast.json at dispatch time — the record
// the later score reads, so C610b's backtest turns prospective (the forecast exists before the commit it forecasts).
//
// The block carries no imperative, no refusal, no exit code. Verbs: detected · placed · priced · dispatched.
// SUFFICIENT FOR: handing the builder the both-banks reading at the moment it can still change the work.
// NOT SUFFICIENT FOR: making the builder follow it, or making the commit land green (never claimed).
// Rust port row: none — the gate re-applies a bar the scorers (C610b-port, C612c-port) already decide; this file is orchestration
// (read two receipts, write one sidecar, append one block). The placement is the crate's walk.
// @guard tests/vna/c610e-the-forecast-in-the-brief-only-when-measured.test.mjs
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordName } from '../pmu/shortlex-names.mjs';
import { assignArm, rctLedgerPath, SEED as RCT_SEED } from './forecast-rct.mjs';   // C610f: the arm is drawn (pure in label, seed) and recorded here, before the dispatch

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const READINGS = Object.freeze([resolve(REPO, 'data/vna/forecast-hit-rate.json'), resolve(REPO, 'data/vna/path-prediction.json')]);
export const BAR = Object.freeze({ z: 2, n: 20 });
export const FORECAST_HEAD = 'forecast:';
export const SUFFICIENT_FOR = 'handing the builder the both-banks reading at the moment it can still change the work';
export const NOT_SUFFICIENT_FOR = 'making the builder follow it, or making the commit land green (never claimed)';
const MAX_ZONES = 4;

const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const r3 = (x) => (x == null ? '—' : Number(x).toFixed(3));
const z2 = (x) => (x == null ? '—' : Number(x).toFixed(2));

/** One half re-read into { n, z, rate, null_mean, null_sd } — forecast-hit-rate.json's flat halves or path-prediction.json's metric halves. */
function halfOf(h, metric) {
  if (!h) return { n: null, z: null, rate: null, null_mean: null, null_sd: null };
  const m = metric && h[metric] && typeof h[metric] === 'object' ? h[metric] : null;
  return m ? { n: num(h.n), z: num(m.z), rate: num(m.rate), null_mean: num(m.null_mean), null_sd: num(m.null_sd) }
    : { n: num(h.n), z: num(h.z), rate: num(h.ensemble ?? h.rate), null_mean: num(h.null ?? h.null_mean), null_sd: num(h.null_sd) };
}

/** Re-apply the bar to one scored arm: MEASURED only when its own verdict says so AND both halves clear z ≥ 2 with n ≥ 20. */
function judgeArm({ verdict, halves, aperture, apertureInForce }) {
  const why = [];
  if (!apertureInForce) why.push('no aperture version in force to compare against');
  else if (aperture !== apertureInForce) why.push(`read at aperture ${aperture || 'unstamped'}, ${apertureInForce} is in force`);
  if (halves.length !== 2) why.push(`${halves.length} halves, 2 needed`);
  halves.forEach((h, i) => {
    const tag = i === 0 ? 'a' : 'b';
    if (!(h.n >= BAR.n)) why.push(`n ${h.n ?? '—'} < ${BAR.n} in half ${tag}`);
    if (!(h.z >= BAR.z)) why.push(`z ${z2(h.z)} < ${BAR.z} in half ${tag}`);
  });
  if (verdict !== 'MEASURED') why.push(`the scorer reads ${verdict || 'no verdict'}`);
  return { measured: why.length === 0, why };
}

/** One reading file → { path, row, arms: [{ arm, measured, why, halves }] }. A missing or unreadable file is one UNMEASURED arm. */
export function readReading(path, { apertureInForce }) {
  let j = null; try { j = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { j = null; }
  if (!j) return { path, row: null, arms: [{ arm: null, measured: false, why: [`${path} is absent or unreadable`], halves: [] }] };
  const aperture = j.aperture_version || j.aperture || null;
  if (Array.isArray(j.arms) && j.arms.length && typeof j.arms[0] === 'object') {   // C612c's shape: one scored arm per walk version
    const metric = j.primary || 'invariant_recall';
    return { path, row: j.row || null, aperture, metric, arms: j.arms.map((a) => { const halves = (a.halves || []).map((h) => halfOf(h, metric));
      return { arm: a.arm, halves, ...judgeArm({ verdict: a.verdict, halves, aperture, apertureInForce }) }; }) };
  }
  const halves = (j.halves || []).map((h) => halfOf(h, null));   // C610b's shape: one verdict, flat halves
  return { path, row: j.row || null, aperture, metric: 'hit_rate', arms: [{ arm: 'ensemble', halves, ...judgeArm({ verdict: j.verdict, halves, aperture, apertureInForce }) }] };
}

/** THE GATE ON THE BRIEF (never on the work): measured when any scored arm in any reading clears the bar at the aperture in force. */
export function forecastGate({ paths = READINGS, apertureVersion = null } = {}) {
  const av = apertureVersion || null;
  const readings = paths.map((p) => readReading(p, { apertureInForce: av }));
  const hit = readings.flatMap((r) => r.arms.map((a) => ({ r, a }))).find(({ a }) => a.measured) || null;
  const stat = (r, a) => `${r.row || r.path.split('/').pop()}${a.arm ? ` ${a.arm}` : ''} ${r.metric || ''}: rate ${a.halves.map((h) => r3(h.rate)).join('|') || '—'} vs null ${a.halves.map((h) => r3(h.null_mean)).join('|') || '—'} (sd ${a.halves.map((h) => r3(h.null_sd)).join('|') || '—'}) · z ${a.halves.map((h) => z2(h.z)).join('|') || '—'} · n ${a.halves.map((h) => h.n ?? '—').join('|') || '—'}`;
  if (hit) return { measured: true, aperture: av, by: { path: hit.r.path, row: hit.r.row, arm: hit.a.arm }, line: `forecast: MEASURED — ${stat(hit.r, hit.a)} · in the brief`, readings };
  const why = readings.map((r) => { const a = r.arms[0]; return `${stat(r, a)} — ${r.arms.length > 1 ? `all ${r.arms.length} arms UNMEASURED, first: ` : ''}${a.why.join('; ')}`; });
  return { measured: false, aperture: av, by: null, line: `forecast: UNMEASURED — ${why.join(' · ')}`, readings };
}

/** The forecast record for one dispatch, from the fast-tier note (or an injected ensemble forecast's zones). Every coordinate the
 *  block can name is in this record: path_coord, row_coord, and each zone's coord. */
export function forecastOf({ label, note = null, rowCoord = null, contested = null, apertureVersion = null, head = null } = {}) {
  const zones = (note && Array.isArray(note.zones) ? note.zones : []).slice(0, MAX_ZONES).map((z) => ({ coord: z.coord, lane: coordName(z.coord) || null, rows: (z.rows || []).map((r) => (typeof r === 'string' ? r : r.id)), files: (z.files || []).map((f) => (typeof f === 'string' ? f : f.path)) }));
  const row = rowCoord || (note && note.pixel) || null;
  const path = zones.length ? zones[0].coord : row;
  const disputed = (Array.isArray(contested) ? contested : []).map((c) => ({ coord: c, lane: coordName(c) || null }));
  return { v: 1, row: 'C610e', at: new Date().toISOString(), label, head: head || (note && note.head) || null, aperture_version: apertureVersion,
    placed: !!(note && note.placed && path), path_coord: path, path_lane: path ? coordName(path) || null : null, row_coord: row, row_lane: row ? coordName(row) || null : null,
    zones, contested: disputed, ingress: disputed.length ? 'ensemble' : 'single (K = 1 — the declaration\'s walk; spread 0 by construction)',
    why: note && !note.placed ? (note.why || 'the walk placed nothing') : null, sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR };
}

/** The block — C610c's localisation lines plus one sentence. Names only coordinates in the forecast record. No imperative. */
export function forecastBlock(f) {
  if (!f || !f.placed) return null;
  const lane = (c, l) => `${c}${l ? ` (${l})` : ''}`;
  const zl = f.zones.map((z) => `  zone ${lane(z.coord, z.lane)} · rows ${z.rows.length ? z.rows.join(',') : '—'} · files ${z.files.length ? z.files.join(', ') : '—'}`);
  const dispute = f.contested.length ? `the ingress points disagree on ${f.contested.map((c) => lane(c.coord, c.lane)).join(' · ')}` : 'the ingress points disagree on no zone (one ingress, spread 0)';
  const where = f.path_coord === f.row_coord ? `lands on the row's own coordinate ${lane(f.row_coord, f.row_lane)}` : `leans to ${lane(f.path_coord, f.path_lane)}, against the row's own coordinate ${lane(f.row_coord, f.row_lane)}`;
  return [`${FORECAST_HEAD} (C610e, aperture ${f.aperture_version || 'unversioned'}) — the lattice places this path where the named files light up: it ${where}; ${dispute}.`,
    ...zl,
    `  Where the path leads is placed here; which way the work goes is yours. Sufficient for: ${SUFFICIENT_FOR}. Not for: ${NOT_SUFFICIENT_FOR}.`].join('\n');
}

// C806: one append log per runner dir, edited in place — never a leaf-<label>.forecast.json per dispatch (157 such files on 2026-10-13).
export const forecastPath = ({ dir }) => join(dir, 'forecasts.ndjson');
/** The latest forecast recorded for a label, or null. */
export function readForecast({ dir, label }) {
  let t = ''; try { t = readFileSync(forecastPath({ dir }), 'utf8'); } catch { return null; }
  let hit = null; for (const l of t.split('\n')) { if (!l.includes(`"label":${JSON.stringify(label)}`)) continue; try { const r = JSON.parse(l); if (r.label === label) hit = r; } catch {} }
  return hit;
}

/** Gate + record + sidecar, in one call. Writes the sidecar always; returns { in_brief, block, line, path, forecast, gate }. */
// C610f: `rct` — { seed, ledger? } draws this dispatch's arm (FORECAST | CONTROL) as a pure function of (label, seed) and appends it
// to <dir>/forecast-rct.ndjson BEFORE the brief is returned; CONTROL never carries the block. Default: on for the live readings
// (paths === READINGS, VNA_FORECAST_RCT !== '0'), off for a caller that hands its own reading paths (a fixture or a backtest).
const rctDefault = (paths) => (paths === READINGS && process.env.VNA_FORECAST_RCT !== '0' ? { seed: RCT_SEED } : null);
export function briefForecast({ label, note = null, rowCoord = null, contested = null, dir, paths = READINGS, apertureVersion = null, head = null, rct = undefined } = {}) {
  const gate = forecastGate({ paths, apertureVersion });
  const forecast = forecastOf({ label, note, rowCoord, contested, apertureVersion, head });
  const block = forecastBlock(forecast);
  const could_inject = gate.measured && !!block;
  const r = rct === undefined ? rctDefault(paths) : rct;
  const assign = r ? assignArm({ label, seed: r.seed || RCT_SEED, ledger: r.ledger || rctLedgerPath(dir), head: forecast.head, could_inject }) : null;
  const arm = assign ? assign.arm : null;
  const in_brief = could_inject && arm !== 'CONTROL';
  const base = gate.measured && !block ? `forecast: UNMEASURED — the gate reads MEASURED but the walk placed nothing (${forecast.why || 'no placement'})` : gate.line;
  const line = arm ? `${base} · rct arm ${arm} (seed ${assign.seed}${could_inject ? '' : ', treatment cannot inject'})` : base;
  let path = null;
  try { mkdirSync(dir, { recursive: true }); path = forecastPath({ dir, label }); appendFileSync(path, JSON.stringify({ label, ...forecast, in_brief, line, block, arm, rct: assign ? { seed: assign.seed, arm, at: assign.at, could_inject } : null, gate: { measured: gate.measured, by: gate.by, readings: gate.readings } }) + '\n'); } catch { path = null; }
  return { in_brief, block: in_brief ? block : null, line, path, forecast, gate, arm };
}

/** The brief with the block appended ONLY when in_brief; otherwise the very same string. */
export function withForecast(brief, fc) {
  return fc && fc.in_brief === true && fc.block ? `${brief}\n\n${fc.block}` : brief;
}
