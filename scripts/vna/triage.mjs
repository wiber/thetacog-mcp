#!/usr/bin/env node
// scripts/vna/triage.mjs — C278 (U15) GEMMA IN THE LOOP'S CATCH: TRIAGE AND THE NEXT DIAL. Operator 2026-09-25, verbatim: "Gemma looks
// at a stream and guesses? What is the right command to run next … a loop that doesn't just crash but has some self healing
// abilities" · goal: "Gemma keeps running the self healing loop … to make sure that QWEN doesn't get stuck; if it gets stuck
// restarted with a slightly different improved prompt".
// THE SHAPE (settled S3, asks txt §14): the host writes the halt strings itself, so a LOOKUP TABLE sorts the ones it can name; only
// what the table cannot place (UNKNOWN) goes to gemma2:2b — /api/chat, format json, temperature 0, answering from a FIXED enum. Her
// answer is a PROPOSAL row with the tail she read. She never writes a command, a path or a test; every action in the enum is
// reversible (retry with one dial · hold the row for the operator). STASH is not in the enum and never will be.
//   CLASSES  TRUNCATED_CONTEXT · MODEL_MISSING · SERVER_DOWN · NO_TOOL_CALL · RAMBLE_OR_LOOP · TIMEOUT · GATE · BUDGET · HOST_ERROR · UNKNOWN
//   ACTIONS  retry (with a dial from steer-rules DIALS) · hold (not retried: the row waits, named, for the operator or the server)
// TRUST IS EARNED, NOT ASSUMED: `node scripts/vna/triage.mjs --score` runs gemma on halts the table already knows, with the table's
// answer hidden, and writes data/vna/triage-score.json. Her class is USED only while her agreement beats the majority-class
// baseline; her dial is used only then too — otherwise the fixed rotation (retryDial) picks, and her pick is logged beside it.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DIALS } from './steer-rules.mjs';
import { traceFor } from './worker-trace.mjs';
import { impasseLedger } from './impasse-ledger.mjs';   // C315: the dial score reads the SAME fold the ledger prints — never a second copy

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCORE = process.env.VNA_TRIAGE_SCORE || resolve(REPO, 'data/vna/triage-score.json');
export const RUNNER = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const CLASSES = Object.freeze(['TRUNCATED_CONTEXT', 'MODEL_MISSING', 'SERVER_DOWN', 'NO_TOOL_CALL', 'RAMBLE_OR_LOOP', 'TIMEOUT', 'GATE', 'BUDGET', 'HOST_ERROR', 'THINKING_ONLY', 'UNKNOWN']);
// BUDGET (the goal's turns are over) and HOST_ERROR (the fold / the tree failed on the host) are the host's own, never the worker's:
// a retry cannot fix them either
export const HOLD = new Set(['MODEL_MISSING', 'SERVER_DOWN', 'BUDGET', 'HOST_ERROR']);   // a retry cannot fix these — the row waits, named

// the host's own halt strings → a class (first match wins; order is specificity)
export const TABLE = Object.freeze([
  ['BUDGET', /turns \d+ of \d+.\d+ · OVER|spend ceiling/i],
  ['HOST_ERROR', /the fold failed|triage could not read the tree|runner printed no JSON/i],
  ['TRUNCATED_CONTEXT', /truncat|UNMEASURED: ollama truncated|limit=\d+ prompt=\d+/i],
  ['MODEL_MISSING', /model ['"]?[\w.:-]+['"]? not found|pull model|no such model|MODEL_MISSING/i],
  ['SERVER_DOWN', /ECONNREFUSED|connection refused|ollama (?:is )?(?:down|not running)|Engine Offline|ENGINE_BINARY_MISSING/i],
  ['RAMBLE_OR_LOOP', /same tool call \d+ times|output past \d+ KB with no file changed/i],
  ['THINKING_ONLY', /THINKING_ONLY|last turn was all reasoning/i],
  ['TIMEOUT', /worker quiet \d+ min|watchdog|timed? ?out/i],
  ['NO_TOOL_CALL', /HEAD did not move|0 calls|ended in prose|no commit/i],
  ['GATE', /does not name|changes no file under tests|red witness|GREEN-ON-PARENT|carComplete|guard/i],
]);
export function tableClass(reason) { for (const [c, re] of TABLE) if (re.test(String(reason || ''))) return c; return 'UNKNOWN'; }

/** the host check the table's RAMBLE_OR_LOOP row reads: the same tool call ≥ 4 times, or ≥ 64 KB of log with 0 calls */
export function rambleOf(trace, logBytes = 0) {
  if (!trace) return null;
  const counts = {}; for (const c of trace.calls || []) { const k = `${c.tool} ${c.arg}`; counts[k] = (counts[k] || 0) + 1; }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 4) return `same tool call ${top[1]} times: ${top[0].slice(0, 80)}`;
  if (logBytes >= 64 * 1024 && !(trace.calls || []).length) return `output past ${Math.round(logBytes / 1024)} KB with no file changed`;
  return null;
}

const PROMPT = (tail) => [
  'You sort why a coding worker stopped. Answer ONLY with JSON: {"class": <one of the list>, "dial": <one of the list>}.',
  `class: ${CLASSES.join(' | ')}`,
  `dial (the one change to the next attempt's brief): ${DIALS.join(' | ')}`,
  'BUDGET = a turn or money limit. HOST_ERROR = the host itself failed. TRUNCATED_CONTEXT = the prompt was cut. MODEL_MISSING = the model is not installed. SERVER_DOWN = the model server did not answer.',
  'NO_TOOL_CALL = it never edited or committed. RAMBLE_OR_LOOP = it repeated itself. TIMEOUT = it went silent. GATE = it committed but a check refused it.',
  '--- the last lines of its log ---', String(tail || '').slice(-3000),
].join('\n');

/** gemma's pick for a tail → { class, dial, ok, ms, why } — never throws; anything outside the enums is refused, not used */
export async function gemmaPick(tail, { host = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434', model = process.env.VNA_TRIAGE_MODEL || 'gemma2:2b', fetchFn = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const t0 = Date.now();
  if (model === 'off') return { class: null, dial: null, ok: false, ms: 0, model, why: 'triage model off (VNA_TRIAGE_MODEL=off — the hermetic test env)' };
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetchFn(`${host}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0, seed: 7, num_predict: 64 }, messages: [{ role: 'user', content: PROMPT(tail) }] }) });
    clearTimeout(to);
    const j = await r.json(); const a = JSON.parse(j.message && j.message.content || '{}');
    const cls = CLASSES.includes(a.class) ? a.class : null; const dial = DIALS.includes(a.dial) ? a.dial : null;
    return { class: cls, dial, ok: !!cls, ms: Date.now() - t0, model, why: cls ? null : `answer outside the enum: ${JSON.stringify(a).slice(0, 120)}` };
  } catch (e) { return { class: null, dial: null, ok: false, ms: Date.now() - t0, model, why: String(e && e.message || e).slice(0, 160) }; }
}

export function readScore(path = SCORE) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export const gemmaTrusted = (s = readScore()) => !!(s && s.n >= 20 && s.agreement > s.majority_baseline);
// her DIAL is a second, separate claim (the row: 'her dial picks beat a fixed dial rotation'): used only once a dial score — landed after
// her dial vs landed after the rotation's, on the retry-dial A/B rows — says she beats it. Until measured, the rotation picks.
export const gemmaDialTrusted = (s = readScore()) => !!(s && s.dial && s.dial.beats_rotation === true);

// C315 — GEMMA'S DIAL PICK VS THE ROTATION'S, BY WHICH ONE'S RETRIES LANDED. Reads the impasse ledger's own fold (never a
// second copy of it): a retry's dial_by names who chose it (gemma | rotation | none), and 'landed' is a tick recorded
// after the retry, not a guess. Right now dialTrusted() is always false (no score has ever run this), so every retry on
// the record was the ROTATION's — there is no gemma-attributed outcome to compare, and this MUST say so, never fabricate
// a comparison from the rotation's numbers alone.
export async function scoreDial({ runner = RUNNER } = {}) {
  const { rates } = await impasseLedger({ runner });
  const g = rates.gemma, r = rates.rotation;
  if (g.rate == null || r.rate == null) {
    const missing = [g.rate == null ? `gemma: ${g.why}` : null, r.rate == null ? `rotation: ${r.why}` : null].filter(Boolean).join(' · ');
    return { n: g.n, beats_rotation: null, why: `UNMEASURED — ${missing}` };
  }
  return { n: g.n, beats_rotation: g.rate > r.rate, gemma_rate: g.rate, rotation_n: r.n, rotation_rate: r.rate, why: null };
}

/** the catch: a halt → { class, source, action, dial|undefined, proposal } — dial undefined means the fixed rotation picks */
export async function triage({ label, reason, logTail = null, pick = gemmaPick, trusted = gemmaTrusted, dialTrusted = gemmaDialTrusted, logDir } = {}) {
  let tail = logTail; let trace = null; let bytes = String(logTail || '').length;
  if (tail == null) { const t = traceFor(label, logDir ? { logDir } : {}); trace = t && t.trace; try { tail = t ? readFileSync(t.path, 'utf8').slice(-4000) : ''; bytes = t ? statSync(t.path).size : 0; } catch { tail = ''; } }
  const ramble = rambleOf(trace, bytes);
  let cls = ramble ? 'RAMBLE_OR_LOOP' : tableClass(reason); let source = 'table'; let proposal = null;
  if (cls === 'UNKNOWN') {
    const g = await pick(tail);
    proposal = { class: g.class, dial: g.dial, ok: g.ok, why: g.why, model: g.model, ms: g.ms, tail_sha: createHash('sha256').update(tail).digest('hex').slice(0, 12) };
    if (g.ok && trusted()) { cls = g.class; source = 'gemma'; }
  }
  const action = HOLD.has(cls) ? 'hold' : 'retry';
  const dial = action === 'retry' && source === 'gemma' && proposal && proposal.dial && dialTrusted() ? proposal.dial : undefined;
  return { label, class: cls, source, action, dial, ramble, proposal };
}

/** --score: gemma on halts the table KNOWS (its answer hidden) → agreement vs always guessing the commonest class,
 *  AND (C315) her dial pick vs the rotation's, by which one's retries landed */
export async function score({ runner = RUNNER, n = 40, pick = gemmaPick, path = SCORE, dial = scoreDial } = {}) {
  let rows = []; try { rows = readFileSync(runner, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'halt'); } catch {}
  const known = rows.map((r) => ({ reason: r.reason, cls: tableClass(r.reason) })).filter((x) => x.cls !== 'UNKNOWN').slice(-n);
  const freq = {}; for (const k of known) freq[k.cls] = (freq[k.cls] || 0) + 1;
  const majority = Object.values(freq).length ? Math.max(...Object.values(freq)) / known.length : 0;
  let agree = 0, answered = 0, model = null; const out = [];
  for (const k of known) { const g = await pick(k.reason); model = model || g.model || null; if (g.ok) answered++; if (g.class === k.cls) agree++; out.push({ table: k.cls, gemma: g.class }); }
  const s = { at: new Date().toISOString(), n: known.length, answered, agreement: known.length ? Math.round(agree / known.length * 1000) / 1000 : 0, majority_baseline: Math.round(majority * 1000) / 1000, beats: known.length ? agree / known.length > majority : false, model, pairs: out };
  s.dial = await dial({ runner });
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(s, null, 1) + '\n');
  return s;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--score')) {
    const s = await score({ n: Number(process.argv[process.argv.indexOf('--n') + 1]) || 40 });
    console.log(`triage score: gemma agrees ${s.agreement} on ${s.n} known halts · majority baseline ${s.majority_baseline} · ${s.beats ? 'BEATS it — her picks are used' : 'does NOT beat it — her picks stay proposals'} → ${SCORE}`);
    console.log(s.dial.beats_rotation == null ? `triage dial score: ${s.dial.why}` : `triage dial score: gemma ${s.dial.beats_rotation ? 'BEATS' : 'does NOT beat'} the rotation (gemma ${s.dial.gemma_rate} n=${s.dial.n} vs rotation ${s.dial.rotation_rate} n=${s.dial.rotation_n})`);
    process.exit(0);
  }
  const reason = process.argv.slice(2).join(' '); console.log(JSON.stringify(await triage({ label: 'cli', reason, logTail: reason })));
}
