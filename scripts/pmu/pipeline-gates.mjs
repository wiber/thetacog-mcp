// scripts/pmu/pipeline-gates.mjs — THE ONE GATE READER every pipeline shares.
// ──────────────────────────────────────────────────────────────────────────
// The send-gate RULES live in SQLite (tc_pipeline_gates in data/thetacoach.db, beside
// lens_rules) — data, not prose (operator 2026-07-02, AR-15). This module is the single
// way any emitter consults them, so the pipelines CONNECT CONSISTENTLY: commit-triptych,
// the lens hook, publish-commit-page, controller workers — same reader, same defaults,
// same trip ledger. A missing table/row falls back to the BUILTIN default passed by the
// caller, so a gate can never silently disable itself.
//
// Escalation contract (gate-trip-escalation row): gates run deterministic + $0, sorted by
// the lane's reef; a TRIP suppresses the artifact, appends to the trip ledger (the alarm
// the self-heal loops consume), and ONLY THEN may a model step in — repair worker, never
// checker.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = resolve(REPO, 'data/thetacoach.db');
const TRIP_LEDGER = resolve(REPO, '.thetacog/pipeline-gate-trips.ndjson');

/** Read one gate's value (number). Builtin default if table/row missing or disabled-row absent. */
export function readGate(gate, builtinDefault) {
  try {
    const out = execFileSync('sqlite3', ['-json', DB,
      `SELECT value FROM tc_pipeline_gates WHERE gate='${String(gate).replace(/'/g, "''")}' AND enabled=1;`],
      { encoding: 'utf8' }).trim();
    if (out) {
      const v = parseFloat(JSON.parse(out)[0]?.value);
      if (Number.isFinite(v)) return v;
    }
  } catch { /* sqlite/table optional — builtin holds */ }
  return builtinDefault;
}

/** Record a gate trip — a NONSENSE result means the PIPELINE regressed; the ledger is the alarm. */
export function recordTrip({ gate, sha = '', context = {}, action = '' }) {
  const entry = { ts: new Date().toISOString(), gate, sha, ...context, action };
  try { appendFileSync(TRIP_LEDGER, JSON.stringify(entry) + '\n'); } catch { /* best-effort */ }
  return entry;
}

/** Convenience: check a count against a min-gate; on failure record the trip and return false. */
export function passMinGate({ gate, builtinDefault, actual, sha = '', context = {}, action = '' }) {
  const min = readGate(gate, builtinDefault);
  if (actual >= min) return true;
  recordTrip({ gate, sha, context: { ...context, actual, min }, action });
  return false;
}
