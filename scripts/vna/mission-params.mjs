// scripts/vna/mission-params.mjs — C2343: MISSION PARAMETERS PER ASK (DEGREES OF FREEDOM BEYOND THE BASIN, SENSITIVITY AS
// THE STOP-AND-ASK THRESHOLD, MAX TURNS, BUDGET, THREADS) ARE READ BY THE RUNNER AT DISPATCH AND RECORDED WITH THE OUTCOME,
// SO EACH PARAMETER'S EFFECT (C2376's knob delta) IS MEASURABLE.
//
// The values are the operator's (fill) cells on the Steer · Compiled sheet's Mission tab (scripts/ops/board-steer.mjs
// composeMission, MISSION_FILLS). That tab has no read-back door yet, and the runner never reaches Drive at dispatch, so
// the runner reads ONE local record, data/vna/mission-params.json, which the sheet sync writes:
//   { "at": ISO, "source": "<sheet id or 'hand'>", "defaults": { <key>: value }, "rows": { "<Cn>": { <key>: value } } }
// FOLLOW-UP (filed on the asks ledger): `board-steer.mjs --pull-mission` reads the Mission tab's (fill) cells
// (board-cells.mjs writeCells read:true) and writes this file. Until then a missing file reads every value as unset, and
// the runner runs on its own defaults — named `runner default` on the row, never a silent value.
//
// What the runner does with each value, and says so on the row (`applied`):
//   max_turns           → the -p worker's --max-turns                                         applied
//   degrees_of_freedom  → a brief line: how many files beyond the basin the worker may touch  told to the worker
//   sensitivity         → a brief line: the stop-and-report threshold                          told to the worker
//   budget_usd, threads → recorded only; no runner door enforces them yet                       recorded
// DETECTED · PLACED: an unreadable or malformed value is dropped with its why, never a halt.
// @guard tests/vna/c2343-chair-decomposition-of-the-operator-s.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MISSION_PARAMS = process.env.VNA_MISSION_PARAMS || resolve(HERE, '..', '..', 'data/vna/mission-params.json');
// the Mission tab's (fill) headers (board-steer.mjs MISSION_FILLS) → the record's keys, one map so the sync and the reader agree
export const FILL_TO_KEY = Object.freeze({ 'DEGREES OF FREEDOM (fill)': 'degrees_of_freedom', 'SENSITIVITY (fill)': 'sensitivity', 'MAX TURNS (fill)': 'max_turns', 'BUDGET $ (fill)': 'budget_usd', 'THREADS (fill)': 'threads' });
export const KEYS = Object.freeze(Object.values(FILL_TO_KEY));
export const APPLIED = Object.freeze({ max_turns: 'applied', degrees_of_freedom: 'told to the worker', sensitivity: 'told to the worker', budget_usd: 'recorded', threads: 'recorded' });

/** one value, validated: degrees_of_freedom is a count or 'any'; sensitivity a probability in (0,1]; the rest positive numbers */
export function cleanValue(key, raw) {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const s = String(raw).trim().replace(/^\$/, '');
  if (key === 'degrees_of_freedom' && /^any$/i.test(s)) return { value: 'any' };
  const n = Number(s.replace(/%$/, '')); if (!Number.isFinite(n)) return { value: null, why: `${key}: "${raw}" is not a number` };
  if (key === 'sensitivity') { const p = s.endsWith('%') || n > 1 ? n / 100 : n; return p > 0 && p <= 1 ? { value: p } : { value: null, why: `sensitivity: "${raw}" is not in (0, 1]` }; }
  if (key === 'degrees_of_freedom') return Number.isInteger(n) && n >= 0 ? { value: n } : { value: null, why: `degrees_of_freedom: "${raw}" is not a whole count` };
  if ((key === 'max_turns' || key === 'threads') && !(Number.isInteger(n) && n > 0)) return { value: null, why: `${key}: "${raw}" is not a positive whole number` };
  return n > 0 ? { value: n } : { value: null, why: `${key}: "${raw}" is not positive` };
}

/** the params in force for one row: row value, else the record's default, else unset (the runner's own default applies) */
export function missionParams({ label, path = MISSION_PARAMS, record = undefined } = {}) {
  let rec = record; let readWhy = null;
  if (rec === undefined) { try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { rec = null; readWhy = e.code === 'ENOENT' ? 'no mission record yet (the Mission tab sync has not written data/vna/mission-params.json)' : `mission record unreadable: ${String(e.message).slice(0, 80)}`; } }
  const row = (rec && rec.rows && rec.rows[label]) || {}; const def = (rec && rec.defaults) || {};
  const values = {}; const from = {}; const dropped = [];
  for (const k of KEYS) {
    let picked = null;
    for (const [src, obj] of [['row', row], ['default', def]]) { const c = cleanValue(k, obj[k]); if (c.why) dropped.push(c.why); if (c.value != null) { picked = [src, c.value]; break; } }
    values[k] = picked ? picked[1] : null; from[k] = picked ? picked[0] : 'runner default';
  }
  return { label, source: rec ? (rec.source || 'unnamed') : null, at: rec ? rec.at || null : null, values, from, applied: APPLIED, dropped, ...(readWhy ? { why: readWhy } : {}) };
}

/** the brief lines for the two values the worker itself must act on; '' when neither is set */
export function missionBriefLines(m) {
  const v = (m && m.values) || {}; const out = [];
  if (v.degrees_of_freedom != null) out.push(`MISSION (C2343) degrees of freedom: ${v.degrees_of_freedom === 'any' ? 'any number of files' : v.degrees_of_freedom === 0 ? 'no file' : `at most ${v.degrees_of_freedom} file(s)`} beyond the row's own basin — past that, commit what you have and say what else it needs in the debrief.`);
  if (v.sensitivity != null) out.push(`MISSION (C2343) sensitivity: ${Math.round(v.sensitivity * 100)} % — if your confidence the change is what the row asks for falls below this, stop, commit nothing, and write why in the debrief's left-open line.`);
  return out.join('\n');
}
