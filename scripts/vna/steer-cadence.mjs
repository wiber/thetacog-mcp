// scripts/vna/steer-cadence.mjs — C2346: THE RUNNER READS ITS PACING (THE SELF-CALLING CADENCE) AND MAX PARALLEL WORKERS
// FROM THE SHEET, BOUNDED BY FREE MEMORY AND THE STEER-PLAN SLOTS.
//
// C2343 shipped the Mission tab's per-row reader (mission-params.mjs) and named its own gap in the comment beside
// `threads`: "recorded only; no runner door enforces them yet." This file is that door, for the two LOOP-WIDE knobs
// (never per-row — pacing and parallelism belong to the run, not one ask): the sheet's Mission `defaults.threads` is a
// CEILING on how many workers steer-until.mjs runs at once, and `defaults.cadence_s` is the self-calling poll interval
// while a row waits out a quiet hold (steer-until.mjs's QUEUE/wait loop). Neither is a NEW column on the Mission tab's
// strict (fill) schema (mission-params.mjs's FILL_TO_KEY/KEYS stay exactly five, pinned by C2343's own guard) — both
// read the SAME record (data/vna/mission-params.json) at its `defaults` object, so the sheet sync that already writes
// that file for C2343 is the one door this reads too.
// `memSlots` is steer-plan.mjs's own free-memory + pmu-onchip reading (C188) — this file never re-measures memory; it
// only CAPS that number further when the sheet asks for fewer, and never raises it when the sheet asks for more (a
// sheet value above what memory allows is dropped to the memory ceiling, named on the row, never granted).
// A missing or malformed value reads `runner default`/unset, never a halt, never an invented number — the same
// contract as mission-params.mjs's cleanValue.
// @guard tests/vna/c2346-chair-decomposition-of-the-operator-s.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanValue } from './mission-params.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PATH = process.env.VNA_MISSION_PARAMS || resolve(HERE, '..', '..', 'data/vna/mission-params.json');

/** the sheet's `defaults.cadence_s`, validated as a positive number of seconds; null when unset or malformed (why said). */
export function cleanCadenceS(raw) {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return { value: null, why: `cadence_s: "${raw}" is not a positive number` };
  return { value: n };
}

/**
 * The run-wide plan: how many workers at once (never above memSlots, the already-measured free-memory/steer-plan
 * ceiling) and how often the loop polls a held row while it waits to self-call again.
 *   path/record — same shape as mission-params.mjs: { defaults: { threads, cadence_s, … }, rows: {…} }, record wins over path (tests)
 *   memSlots    — steer-plan.mjs's own reading for THIS pass; the one number this file is bounded by, never recomputes
 */
export function cadenceAndParallel({ path = DEFAULT_PATH, memSlots = 1, record = undefined } = {}) {
  let rec = record; let readWhy = null;
  if (rec === undefined) { try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { rec = null; readWhy = e.code === 'ENOENT' ? 'no mission record yet (the Mission tab sync has not written data/vna/mission-params.json)' : `mission record unreadable: ${String(e.message).slice(0, 80)}`; } }
  const def = (rec && rec.defaults) || {};
  const dropped = [];
  const threadsC = cleanValue('threads', def.threads); if (threadsC.why) dropped.push(threadsC.why);
  const sheetThreads = threadsC.value;   // null when unset — mission-params' own validator (positive whole number)
  const cadenceC = cleanCadenceS(def.cadence_s); if (cadenceC.why) dropped.push(cadenceC.why);
  const mem = Math.max(1, Number.isInteger(memSlots) && memSlots > 0 ? memSlots : 1);
  const parallel = sheetThreads == null ? mem : Math.max(1, Math.min(mem, sheetThreads));
  const boundedBy = sheetThreads == null ? 'threads runner default — the steer-plan slots' : sheetThreads <= mem ? `sheet threads ${sheetThreads}` : `sheet asked ${sheetThreads}, free memory / steer-plan allow ${mem}`;
  const cadenceMs = cadenceC.value != null ? cadenceC.value * 1000 : null;
  // `pace` is the value the cycle line carries (C2346: the value used is recorded on the cycle line); a missing value reads `runner default`
  const pace = `parallel ${parallel} of ${mem} slot${mem === 1 ? '' : 's'} (${boundedBy}) · cadence ${cadenceMs != null ? `${cadenceC.value} s (sheet)` : 'runner default'}`;
  const line = `steer-cadence: ${pace}`;
  return { parallel, memSlots: mem, sheetThreads, cadenceMs, dropped, pace, source: rec ? (rec.source || 'unnamed') : null, line, ...(readWhy ? { why: readWhy } : {}) };
}
