// scripts/vna/dispatch-context.mjs — C235g A TRUNCATED DISPATCH IS UNMEASURED (the marking half).
// MEASURED 2026-09-24: goose's envelope alone (system + 18 tool schemas + a 92-char order) is ~4,888 prompt tokens; at ollama's
// default context of 4096 the model evaluated 2,799 of them — the row the worker was dispatched on never reached the model. A halt
// on such a dispatch is not a worker failure; it is a cell the instrument did not measure. So every LOCAL dispatch's learn row
// (C227) carries prompt tokens SENT vs EVALUATED and the context IN FORCE, each number with the source it was read from, and a
// verdict: UNMEASURED on (a) full request tokens > the context in force (the structural test) or (b) ollama's own truncation
// line for a request in the window — NEVER on the evaluated count alone (a reused KV-cache prefix lowers prompt_eval_count with
// nothing truncated); UNKNOWN when the structural test cannot be made; MEASURED otherwise. The land-rate series (wash.mjs —
// C225 / C235d / C228) leaves UNMEASURED rows out and prints how many. Nothing here changes the ollama server's context or any
// launchd env — that is the floor half of C235g, applied only after the C235 bench's context axis is read.
//
// THE SOURCES, all observable on this machine without a model call, preferred in this order:
//   1. .thetacog/cache/ollama-serve.log (the launchd StandardErrorPath of `ollama serve`): on a truncated request ollama's runner
//      logs `msg="truncating input prompt" limit=4096 prompt=9127 keep=4 new=4096` — SENT (prompt=) and EVALUATED (new=) on one
//      line, timestamped in local time with its offset. Read from the tail, bounded (the file was 125 MB on 2026-09-23).
//   2. ~/.local/share/goose/sessions/sessions.db, table usage_ledger: one row per request with input_tokens = the prompt tokens
//      ollama reported evaluated (4096 exactly on every truncated request seen), joined to sessions.working_dir so another
//      goose in another repo is never read as ours. `goose run --no-session` still writes it. Read with the sqlite3 CLI, bounded.
//   3. ollama GET /api/ps: the loaded model's context_length — the context in force (goose's /v1 endpoint carries no num_ctx, so
//      the server default is what runs). The same reading brief-bench.mjs takes.
//   4. the ESTIMATE of sent when no truncation line exists: brief-bench's measured envelope (ENVELOPE_TOKENS) + the work order's
//      chars / CHARS_PER_TOKEN — named as an estimate on the row, never presented as a count.
// Pure over injected inputs where it can be (the guard runs on fixtures only); the readers are bounded and never throw.
import { openSync, readSync, fstatSync, closeSync, existsSync , realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { CHARS_PER_TOKEN } from './spec-tree.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** goose's envelope in prompt tokens — system prompt + 18 tool schemas + a 92-char order, measured by brief-bench.mjs 2026-09-24 */
export const ENVELOPE_TOKENS = 4888;
export const OLLAMA_LOG = process.env.VNA_OLLAMA_LOG || resolve(REPO, '.thetacog', 'cache', 'ollama-serve.log');
export const GOOSE_DB = process.env.VNA_GOOSE_DB || resolve(homedir(), '.local', 'share', 'goose', 'sessions', 'sessions.db');
export const OLLAMA_URL = process.env.VNA_OLLAMA_URL || 'http://127.0.0.1:11434';
export const LOG_TAIL_BYTES = Number(process.env.VNA_OLLAMA_LOG_TAIL || 4 * 1024 * 1024);
export const WINDOW_SLACK_MS = 5000;
export const CONTEXT_FIELDS = Object.freeze(['prompt_tokens_sent', 'prompt_tokens_sent_source', 'prompt_tokens_evaluated', 'prompt_tokens_evaluated_source', 'context_length', 'context_length_source', 'context_verdict', 'context_why', 'n_requests', 'n_truncated']);

const TRUNC_RE = /^time=(\S+)\s.*msg="truncating input prompt"\s+limit=(\d+)\s+prompt=(\d+)\s+keep=(\d+)\s+new=(\d+)/;
/** every truncation line in an ollama server log → [{ at (ISO, UTC), limit, prompt, keep, evaluated }] */
export function parseTruncations(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = TRUNC_RE.exec(line); if (!m) continue;
    const t = Date.parse(m[1]); if (!Number.isFinite(t)) continue;
    out.push({ at: new Date(t).toISOString(), limit: +m[2], prompt: +m[3], keep: +m[4], evaluated: +m[5] });
  }
  return out;
}
/** the truncations inside one dispatch's window [at0 − slack, at1 + slack] */
export function truncationsInWindow(text, at0, at1, slackMs = WINDOW_SLACK_MS) {
  const lo = Date.parse(at0) - slackMs, hi = Date.parse(at1) + slackMs;
  return parseTruncations(text).filter((t) => { const x = Date.parse(t.at); return x >= lo && x <= hi; });
}
/** the last `bytes` of a file as text ('' when absent) — the log is never read whole */
export function readLogTail(path = OLLAMA_LOG, bytes = LOG_TAIL_BYTES) {
  try {
    const fd = openSync(path, 'r'); const size = fstatSync(fd).size; const n = Math.min(size, bytes);
    const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n); closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
/** the context in force for one model, off an /api/ps body — null when the model is not loaded (never a default) */
export function psContextLength(ps, model) {
  const models = ps && Array.isArray(ps.models) ? ps.models : [];
  const m = models.find((x) => x && (x.name === model || x.model === model));
  return m && Number.isFinite(m.context_length) ? m.context_length : null;
}
export async function fetchPs(url = OLLAMA_URL, timeoutMs = 3000) {
  try { const r = await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(timeoutMs) }); return r.ok ? await r.json() : null; } catch { return null; }
}
// C235i — THE CONTEXT FLOOR, APPLIED BEFORE THE SEND: goose cannot set num_ctx per request, so the host cannot grow the window to fit a
// brief; what it CAN do is never send one that will be cut. The window in force is the loaded model's context_length (/api/ps), else
// the server's own OLLAMA_CONTEXT_LENGTH (its startup line in ollama-serve.log). Measured 2026-09-24 21:33Z: C245 sent 17,673 tokens
// into 16,384 after the floor was set — cut, and the worker never saw its tools. Unknown window → UNMEASURED, dispatched, said so.
export function serverContextLength(logText) { const m = [...String(logText || '').matchAll(/OLLAMA_CONTEXT_LENGTH:(\d+)/g)].pop(); return m ? Number(m[1]) : null; }
export async function contextFits({ promptChars, model, ps = null, logText = null } = {}) {
  const est = estimateSentTokens(promptChars);
  const live = ps || await fetchPs();
  let ctx = psContextLength(live, model), source = 'ollama /api/ps context_length';
  if (ctx == null) { ctx = serverContextLength(logText ?? readLogTail()); source = 'ollama-serve.log OLLAMA_CONTEXT_LENGTH'; }
  if (ctx == null) return { fits: null, est, ctx: null, source: 'UNMEASURED — no loaded model and no server context line' };
  return { fits: est <= ctx, est, ctx, source };
}
/** goose's usage_ledger rows for requests from THIS repo inside the window → [{ at, model, input_tokens, output_tokens }] or null when unreadable */
export function readGooseUsage({ db = GOOSE_DB, repo = REPO, at0, at1, slackMs = WINDOW_SLACK_MS, timeoutMs = 5000 } = {}) {
  if (!existsSync(db)) return null;
  const lo = Math.floor((Date.parse(at0) - slackMs) / 1000), hi = Math.ceil((Date.parse(at1) + slackMs) / 1000);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const wd = String(repo).replace(/'/g, "''");
  const sql = `select u.created_timestamp, coalesce(u.model,''), coalesce(u.input_tokens,''), coalesce(u.output_tokens,'') from usage_ledger u join sessions s on s.id = u.session_id where s.working_dir = '${wd}' and u.created_timestamp between ${lo} and ${hi} order by u.id;`;
  let out; try { out = execFileSync('sqlite3', ['-readonly', '-separator', '\x1f', db, sql], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  return out.split('\n').filter(Boolean).map((l) => { const [ts, model, i, o] = l.split('\x1f'); return { at: new Date(+ts * 1000).toISOString(), model, input_tokens: i === '' ? null : +i, output_tokens: o === '' ? null : +o }; });
}
// C275b — HOW THE WORKER'S TURNS ENDED, off goose's own session store (the log cannot see it: goose hides thinking). Measured
// 2026-09-25 on the replay bench: two trials whose ONLY assistant turn was a 4,000-character thinking block — no text, no tool call —
// after which goose ended quietly, exit 0, "0 calls". That is qwen3's thinking eating the whole turn (D2), not a silent model, and
// it is named THINKING_ONLY so it is counted, never folded into "no tool call".
export function gooseTurns({ db = GOOSE_DB, workingDir, since = null, timeoutMs = 5000 } = {}) {   // since: an ISO time — the live repo holds many sessions
  if (!existsSync(db) || !workingDir) return null;
  // goose stores the RESOLVED dir (macOS: /var → /private/var); match the path as given and its realpath
  let real = workingDir; try { real = realpathSync(workingDir); } catch { /* gone already — the given path is all there is */ }
  const q = (x) => `'${String(x).replace(/'/g, "''")}'`;
  const sql = `select m.role, m.content_json from messages m join sessions s on s.id = m.session_id where s.working_dir in (${q(workingDir)}, ${q(real)}, ${q(String(workingDir).replace(/^\/var\//, '/private/var/'))})${since ? ` and s.created_at >= '${new Date(since).toISOString().slice(0, 19).replace('T', ' ')}'` : ''} order by m.id`;
  let out; try { out = execFileSync('sqlite3', ['-readonly', '-json', db, sql], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch { return null; }
  let rows = []; try { rows = JSON.parse(out || '[]'); } catch { return null; }
  const turns = rows.filter((r) => r.role === 'assistant').map((r) => { let c = []; try { c = JSON.parse(r.content_json); } catch {} const t = new Set(c.map((x) => x.type)); return t.has('toolRequest') ? 'tool' : t.has('text') ? 'text' : t.has('thinking') ? 'thinking-only' : 'empty'; });
  const last = turns.length ? turns[turns.length - 1] : null;
  return { turns: turns.length, tool_turns: turns.filter((x) => x === 'tool').length, thinking_only_turns: turns.filter((x) => x === 'thinking-only').length, last_turn: last, ended_thinking_only: last === 'thinking-only' };
}
/** the sent-side ESTIMATE: the measured envelope plus the work order's own tokens */
export const estimateSentTokens = (promptChars) => ENVELOPE_TOKENS + Math.ceil(Math.max(0, Number(promptChars) || 0) / CHARS_PER_TOKEN);

/**
 * The verdict over what was observed — each branch says which numbers it read and where they came from. UNMEASURED on exactly
 * two signals: (a) the STRUCTURAL test, full request tokens > the context in force; (b) ollama's own `truncating input prompt`
 * line for a request in the window. NEVER on prompt_eval_count alone: ollama's evaluated count excludes a reused KV-cache prefix,
 * so evaluated < sent is the normal shape of a cached request (measured 2026-09-24 at num_ctx 16384: the bare request is 4,894
 * tokens, prompt_eval_count read 4,888, nothing truncated). The evaluated count rides the row as a reading, not a verdict input.
 */
export function contextVerdict({ truncations = [], sent = null, sent_source = null, evaluated = null, context_length = null } = {}) {
  if (truncations.length) {
    const p = Math.max(...truncations.map((t) => t.prompt)); const t0 = truncations[0];
    return { context_verdict: 'UNMEASURED', context_why: `ollama truncated ${truncations.length} request(s) in the window (ollama-serve.log): sent up to ${p} prompt tokens, evaluated ${t0.evaluated} at limit ${t0.limit} — the model never saw the whole request` };
  }
  if (sent != null && context_length != null && sent > context_length) return { context_verdict: 'UNMEASURED', context_why: `full request ${sent} tokens (${sent_source}) > context in force ${context_length}` };
  if (context_length == null || sent == null) return { context_verdict: 'UNKNOWN', context_why: `the structural test needs both numbers — full request ${sent ?? 'unobserved'}${sent_source ? ` (${sent_source})` : ''}, context in force ${context_length ?? 'unobserved (no /api/ps reading, no ollama log line in the window)'}` };
  return { context_verdict: 'MEASURED', context_why: `full request ${sent} tokens (${sent_source}) ≤ context in force ${context_length}, no truncation line; evaluated ${evaluated ?? 'unobserved'} (a reading — a reused KV-cache prefix lowers it, never a verdict input)` };
}

/**
 * The context fields for one LOCAL dispatch (null for a cloud engine — the fields are absent, never null-filled as if measured).
 * Readers are injected for the guard (ollamaLogText, ps, gooseRows); the runner passes none and the live sources are read, bounded.
 */
export async function dispatchContext({ engine = null, local = false, model = null, at0, at1, promptChars = null, briefChars = null, ollamaLogText, ollamaLog = OLLAMA_LOG, ps, psUrl = OLLAMA_URL, gooseRows, gooseDb = GOOSE_DB, repo = REPO } = {}) {
  if (!local) return null;
  const tag = model || (String(engine || '').includes('/') ? String(engine).split('/').slice(1).join('/') : null);
  const text = ollamaLogText !== undefined ? ollamaLogText : readLogTail(ollamaLog);
  const tr = truncationsInWindow(text, at0, at1);
  const psJ = ps !== undefined ? ps : await fetchPs(psUrl);
  let context_length = psContextLength(psJ, tag), context_length_source = context_length != null ? 'ollama /api/ps context_length' : null;
  if (context_length == null && tr.length) { context_length = tr[0].limit; context_length_source = 'ollama-serve.log limit='; }
  const rows = gooseRows !== undefined ? gooseRows : readGooseUsage({ db: gooseDb, repo, at0, at1 });
  const first = Array.isArray(rows) && rows.length ? rows[0] : null;
  let sent = null, sent_source = null, evaluated = null, evaluated_source = null;
  if (tr.length) { sent = tr[0].prompt; sent_source = 'ollama-serve.log prompt='; evaluated = tr[0].evaluated; evaluated_source = 'ollama-serve.log new='; }
  else {
    if (first && first.input_tokens != null) { evaluated = first.input_tokens; evaluated_source = 'goose sessions.db usage_ledger.input_tokens'; }
    const chars = promptChars ?? briefChars;
    if (chars != null) { sent = estimateSentTokens(chars); sent_source = `estimate: goose envelope ${ENVELOPE_TOKENS} (brief-bench 2026-09-24) + ${chars} prompt chars / ${CHARS_PER_TOKEN}`; }
  }
  const v = contextVerdict({ truncations: tr, sent, sent_source, evaluated, context_length });
  return { prompt_tokens_sent: sent, prompt_tokens_sent_source: sent_source, prompt_tokens_evaluated: evaluated, prompt_tokens_evaluated_source: evaluated_source, context_length, context_length_source, ...v, n_requests: Math.max(tr.length, Array.isArray(rows) ? rows.length : 0), n_truncated: tr.length };
}
