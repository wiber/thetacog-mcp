// scripts/vna/worker-trace.mjs — C227 WHAT THE WORKER DID, READ OFF ITS OWN LOG.
// The runner pipes every worker's output to .thetacog/runner/<n>-<row>.log. For a goose worker that log is the tool-call stream:
// each call prints "▸ <tool>" and its first argument line ("command: …", "path …"), and whatever the model says after its last
// call is its closing message. Measured 2026-09-24 on goose/qwen3:8b: C223a made one call (cat its own brief) and stopped;
// C223b wrote two files and ended with "Could you clarify what this script is intended to do?" — headless, nobody answers.
// So a halt carries: how many calls, the last one, and whether the closing message asked something. A log holding several
// sessions (a retry appends) is read from its LAST "new session" banner. Pure over the text; LLM-free.
// Readers: steer-runner.mjs (the `learn` row on every worker-caused halt) and workers.mjs (the live list's last call + stall).
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SESSION_RE = /new session/g;
// C299 — goose's OWN tool-error lines, printed at column 0 under a failed call (measured over 345 replay logs 2026-09-25: the edit
// tool's "No match found for the specified text." ×68, the read tool's "Failed to read <path>: … (os error N)" ×3). Whole line,
// anchored: the same words quoted inside a shell call's output (a cat of a file holding them) are not goose's error. A call goose
// could not PARSE leaves no line of its own in the log (none in 345) — that half is UNMEASURED, never inferred.
export const TOOL_ERROR_RE = /^(?:No match found for the specified text\.|Failed to read \S.*\(os error \d+\))\s*$/gm;
export const TOOL_PARSE_UNMEASURED = 'a tool call goose could not parse leaves no line of its own in the log (0 of 345 replay logs, 2026-09-25)';

/** parseWorkerLog(text) → { format, sessions, calls: [{ tool, arg }], last_tool_call, ended_in_prose, asked, closing }
 *  ended_in_prose: the session's last output is the model talking, not a tool call — in a headless run that is the worker handing
 *  the turn back to a user who is not there (C223b: "Could you clarify…?"; C214: "Let me know if you need further assistance!").
 *  asked: the closing lines include a question. Both are read off the log's structure (where the last ▸ call sits), not its words. */
export function parseWorkerLog(text) {
  const s = String(text || '');
  const starts = [...s.matchAll(SESSION_RE)].map((m) => m.index);
  if (!starts.length) return { format: 'unknown', sessions: 0, tool_errors: null, calls: [], last_tool_call: null, ended_in_prose: null, asked: null, closing: null };
  const lines = s.slice(starts[starts.length - 1]).split('\n'); const calls = []; let lastCall = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*▸\s+(\S+)(.*)$/.exec(lines[i]); if (!m) continue;
    calls.push({ tool: m[1], arg: (lines[i + 1] || '').trim().slice(0, 160) }); lastCall = i;
  }
  // after the last call: its argument/output block, then (if any) the model's closing prose. The closing is the final
  // non-empty lines that come after the call's own first argument line.
  const after = lines.slice(lastCall + 2).map((l) => l.trim()).filter((l) => l && !/^[─-]{8,}$/.test(l) && !/goose is ready|new session|^__\(|^\\____\)|^L L$/.test(l));
  const closingLines = after.slice(-15);
  const ended_in_prose = calls.length ? after.length > 0 && closingLines.some((l) => /[a-z]{3,}.*[.!?:]$/i.test(l)) : after.length > 0;
  const asked = closingLines.some((l) => /\?\s*$/.test(l));
  const last = calls.length ? calls[calls.length - 1] : null;
  // C264 — a retry appends a second session to the same log; `calls` is the LAST session's (what the retry did), and
  // calls_by_session says what every session did, so a dispatch that made calls and then a silent retry never reads as 0 overall
  const calls_by_session = starts.map((st, i) => s.slice(st, starts[i + 1] ?? s.length).split('\n').filter((l) => /^\s*▸\s+\S+/.test(l)).length);
  const tool_errors = (s.match(TOOL_ERROR_RE) || []).length;   // every session: a retry's errors are the trial's too
  return { format: 'goose', sessions: starts.length, tool_errors, calls, calls_by_session, n_calls_total: calls_by_session.reduce((x, y) => x + y, 0), last_tool_call: last ? `${last.tool} ${last.arg}`.trim() : null, ended_in_prose, asked, closing: closingLines.join('\n').slice(-400) || null };
}

/** the newest log for a row in the runner's log dir → { path, mtimeMs, trace } or null */
export function traceFor(label, { logDir = resolve(process.cwd(), '.thetacog/runner') } = {}) {
  let files; try { files = readdirSync(logDir).filter((f) => f.endsWith(`-${label}.log`)); } catch { return null; }
  const withT = files.map((f) => { const p = resolve(logDir, f); try { return { path: p, mtimeMs: statSync(p).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!withT.length) return null;
  let text = ''; try { text = readFileSync(withT[0].path, 'utf8'); } catch {}
  return { ...withT[0], trace: parseWorkerLog(text) };
}

// a worker whose log has not grown for this long while its process lives is flagged STALLED in the list (not ended — the operator ends it)
export const STALL_MS = Number(process.env.VNA_WORKER_STALL_MS || 10 * 60 * 1000);
