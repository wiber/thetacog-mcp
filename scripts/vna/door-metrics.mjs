// scripts/vna/door-metrics.mjs — C563e THE DOOR /steer DISPATCHES THROUGH IS CHOSEN BY ITS MEASURED COST PER VERIFIED
// OUTCOME (operator 2026-10-02, verbatim: "may be worth being more strict about what /steer runs - these look
// inefficient.."). Today the -p door keeps the worker's own usage · cost · num_turns on its runner.ndjson row and the
// chat door keeps nothing, so the two doors cannot be compared and the chat door is the default by rule (C477), not by
// measurement. This file is the ONE recorder both doors go through (so their rows can never drift into different
// shapes), the verify stamp that makes the denominator VERIFIED OUTCOMES rather than dispatches, and the per-door read.
//
//   recordDoorCompletion   the one recorder — door: 'chat' | 'p', every numeric field a FACT already in hand or null;
//                          there is no default that estimates a missing one.
//   recordChatCompletion   the chat door's call: the subagent's own completion facts (tokens · tool uses · duration),
//                          read off the task notification by the caller, never computed here.
//   stampVerify            steer.mjs verify's stamp — verified:true or verified:false (STUCK), so a dispatch with no
//                          stamp can never enter the denominator.
//   verifiedRows           the join: a runner.ndjson worker row counts only if a later verify-stamp named its label
//                          verified:true.
//   doorStats / doorLines  tokens and wall-clock per verified outcome, grouped by door, median [min,max], n — under
//                          UNDERPOWERED_N per door and the comparison refuses a winner.
//
// @guard tests/vna/c563e-door-by-measured-cost.test.mjs
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = resolve(HERE, '..', '..');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO_DEFAULT, '.thetacog/runner.ndjson');
export const VERIFY_NDJSON = process.env.VNA_VERIFY_NDJSON || resolve(REPO_DEFAULT, '.thetacog/verify-stamps.ndjson');
// the turn cap every -p worker now carries (C563e (4) — reverses the undated "never turn-capped" note at the top of
// steer-runner.mjs: this is the newer, dated operator instruction). Claude Code's own --max-turns.
export const DEFAULT_TURN_CAP = 40;
// under this many verified rows on a door, its reading is UNDERPOWERED — never reported as a winner either way
export const UNDERPOWERED_N = 10;

function readRows(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ }
  }
  return out;
}
function appendRow(path, row) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(row) + '\n'); return row; }

const NUMERIC_FIELDS = ['tokens_in', 'tokens_out', 'tool_uses', 'wall_s'];

/** THE ONE RECORDER — both doors' completion facts land in this shape. A field is a number already read off the
 * worker's own result/notification, or null; anything else (a string, an estimate, a guessed average) throws, so an
 * estimated token figure can never silently become a measured one. */
export function recordDoorCompletion({ door, label, tokens_in = null, tokens_out = null, tool_uses = null, wall_s = null, session = null, at = new Date().toISOString(), ndjson = RUNNER_NDJSON } = {}) {
  if (door !== 'chat' && door !== 'p') throw new Error(`recordDoorCompletion: door must be 'chat' or 'p', got ${JSON.stringify(door)}`);
  if (!label) throw new Error('recordDoorCompletion: needs a label');
  const fields = { tokens_in, tokens_out, tool_uses, wall_s };
  for (const k of NUMERIC_FIELDS) { const v = fields[k]; if (v !== null && typeof v !== 'number') throw new Error(`recordDoorCompletion: ${k} must be a number read off the worker's own result, or null — never estimated (got ${typeof v})`); }
  return appendRow(ndjson, { at, kind: 'worker', door, label, ...fields, ...(session ? { session } : {}) });
}

/** the chat door's own recorder — one subagent's completion, read off the chat host's task notification */
export function recordChatCompletion({ label, tokens_in = null, tokens_out = null, tool_uses = null, wall_s = null, session = null, ndjson = RUNNER_NDJSON } = {}) {
  return recordDoorCompletion({ door: 'chat', label, tokens_in, tokens_out, tool_uses, wall_s, session, ndjson });
}

/** steer.mjs verify's stamp: verified or STUCK, with why. A row with no stamp can never be counted. */
export function stampVerify({ label, verified, reason = null, since = null, at = new Date().toISOString(), ledgerPath = VERIFY_NDJSON } = {}) {
  if (!label) throw new Error('stampVerify: needs a label');
  return appendRow(ledgerPath, { at, kind: 'verify-stamp', label, verified: !!verified, reason, since });
}

/** the denominator: every runner.ndjson worker row whose label was later stamped verified:true — the newest worker
 * row of that label AT OR BEFORE the stamp's time (a stamp never reaches forward past a dispatch it has not seen). A
 * dispatch with no stamp at all is excluded, by construction (C563e falsifier: "a dispatch without a verify stamp
 * enters the denominator"). */
export function verifiedRows({ ndjson = RUNNER_NDJSON, verifyLedger = VERIFY_NDJSON } = {}) {
  const workers = readRows(ndjson).filter((r) => r.kind === 'worker' && r.label);
  const stamps = readRows(verifyLedger).filter((r) => r.kind === 'verify-stamp' && r.verified === true);
  const out = [];
  for (const s of stamps) {
    const candidates = workers.filter((w) => w.label === s.label && (!w.at || !s.at || Date.parse(w.at) <= Date.parse(s.at)));
    const w = candidates[candidates.length - 1];
    if (w) out.push({ ...w, verified_at: s.at });
  }
  return out;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b); const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function spread(nums) { return nums.length ? { median: median(nums), min: Math.min(...nums), max: Math.max(...nums), n: nums.length } : null; }

/** tokens and wall-clock per verified outcome, grouped by door. A row with no `door` field is a -p row from before
 * C563e named the field — it reads as 'p', never silently dropped. */
export function doorStats({ ndjson = RUNNER_NDJSON, verifyLedger = VERIFY_NDJSON, underpoweredN = UNDERPOWERED_N } = {}) {
  const rows = verifiedRows({ ndjson, verifyLedger });
  const byDoor = {};
  for (const r of rows) (byDoor[r.door || 'p'] ||= []).push(r);
  const out = {};
  for (const [door, rs] of Object.entries(byDoor)) {
    const toks = rs.filter((r) => r.tokens_in != null || r.tokens_out != null).map((r) => (r.tokens_in || 0) + (r.tokens_out || 0));
    const walls = rs.filter((r) => r.wall_s != null).map((r) => r.wall_s);
    out[door] = { n: rs.length, tokens: spread(toks), wall_s: spread(walls), underpowered: rs.length < underpoweredN };
  }
  return out;
}

/** `steer.mjs door`'s print — never names a winner under UNDERPOWERED_N verified on either side being compared. */
export function doorLines({ ndjson = RUNNER_NDJSON, verifyLedger = VERIFY_NDJSON } = {}) {
  const stats = doorStats({ ndjson, verifyLedger });
  const doors = Object.keys(stats).sort();
  if (!doors.length) return ['door: no verified outcome on either door yet — the denominator is verified rows (steer.mjs verify), never dispatches'];
  const lines = doors.map((d) => {
    const s = stats[d];
    const t = s.tokens ? `tokens/outcome ${s.tokens.median} [${s.tokens.min},${s.tokens.max}] n=${s.tokens.n}` : 'tokens UNMEASURED';
    const w = s.wall_s ? `wall ${s.wall_s.median}s [${s.wall_s.min}s,${s.wall_s.max}s] n=${s.wall_s.n}` : 'wall UNMEASURED';
    return `door ${d}: ${s.n} verified${s.underpowered ? ` — UNDERPOWERED (< ${UNDERPOWERED_N} verified)` : ''} · ${t} · ${w}`;
  });
  const powered = doors.filter((d) => !stats[d].underpowered && stats[d].tokens);
  if (powered.length < 2) lines.push('door winner: UNDERPOWERED — the default stays -p for CLEAR rows with a written guard (C477, C563e)');
  else {
    const best = [...powered].sort((a, b) => stats[a].tokens.median - stats[b].tokens.median)[0];
    lines.push(`door winner (tokens per verified outcome): ${best}`);
  }
  return lines;
}
