#!/usr/bin/env node
// scripts/vna/steer-runner.mjs — C66 THE HEADLESS DISPATCH ENGINE (goal 3 unit 1, 2026-09-18). The execution loop moves
// from the chat REPL to this outer state machine. It holds NO conversational memory: it reads the /goal (goal.mjs) and the
// spec ticks for the next OPEN unit, spawns ONE ephemeral worker — `claude -p "continue"` with every CLAUDE_* session var
// stripped so the steer hook seeds it from the spec leaf (C57: a bare "continue" is not walked; the record is the anchor) —
// streams its stdout/stderr to .thetacog/runner/<n>-<label>.log, and on exit reads ONLY decidable facts:
//   exit 0 · HEAD moved · the commit names the label · a file under tests/ changed · RED WITNESS: the changed tests FAIL on
//   the PARENT commit's tree (git archive HEAD~1 into scratch + the tests copied in) and PASS at HEAD · the fold exits 0
//   (wall time on the row) · a signed flight-tape row for HEAD renders a COMPLETE CAR (bounded poll; post-commit tapes detached).
// ANY gate false → HALT with the reason on .thetacog/runner.ndjson, exit 2, no next unit. Fail-closed.
// C175 — BEFORE any of that, the runner reads the tape-vs-tree watermark (the same reading c176DispatchFields
// receipts as treeAtTape/rowsBehind) and, when the fold is behind, waits up to FOLD_WAIT_MS for it to catch up.
// Still behind past that ceiling, the unfolded ledger rows naming THIS unit are handed into the brief verbatim
// (awaitFold/foldCatchupBrief) — a worker is never silently briefed off a tree that is missing the paste that
// ordered it.
// The WORKER is never turn-capped (operator: "confusing the retrograde seed with an artificial runtime ceiling on the worker
// was a mistake") — it takes the context it needs; the process boundary purges it. --max-units caps DISPATCHES, not turns.
// Zero tokens leak back: this file never reads the worker's transcript, only the exit code, git, and the tape; the worker's
// own `--output-format json` result (usage · cost · num_turns · duration) is kept as a fact on the dispatch row, never estimated.
//   node scripts/vna/steer-runner.mjs [--max-units N] [--dry-run] [--label C44] [--claude <bin>] [--allow-unmeasured-red] [--json]
//                                     [--meter-budget] [--retry-reason "<halt reason>"]   C186: /steer meters the turn budget; a retry carries its halt
//   node scripts/vna/steer-runner.mjs --triage [--limit N] [--dry-run]     C107d: one cold worker on the PENDING residue, two tools
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync, createWriteStream, cpSync, realpathSync, readdirSync, unlinkSync, chmodSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { ENGINE_KEYS_LABEL } from './door-labels.mjs';   // C243: the one name of the keys door in the halt message
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';   // C213: the snowball's sha — a pure hash of what was actually on disk, never estimated · C186x: the dispatch nonce
import { goalStatus, specTicks, goalCopy } from './goal.mjs';
import { readEngineConfig, resolveEngineCommand, missingBinary, engineName, presetOf, DEFAULT_PRESET, keyedEnv, canDispatch, DEFAULT_CLAUDE_MODEL } from './runner-resolver.mjs';   // C166: the engine is a preset · C166a: keyedEnv is the one door a worker's keys pass · C168g: canDispatch refuses a bare-model chat-only preset
import { BUNDLE_TOKEN_CAP, CHARS_PER_TOKEN, bundle as bundleOf } from './spec-tree.mjs';
import { readLose } from './clear-gauge.mjs';   // C176 L2: the fold-lag reader the gauge prints ("N tape rows not in the tree") — never re-derived
import { readWatermark } from './fold-writer.mjs';   // C176 L2: the tree root + watermark off the fold's sidecar
import { ledgerTail } from './ndjson-tail.mjs';   // C175: the SAME tail-past-watermark reader readLose uses internally — reused, never re-derived
import { commitRowFor } from './steer-hook-tape.mjs';   // C176 L2: the one Rust walk's placement of the work commit
import { isoComparable, walkStamp, mismatchWhy } from './iso-config.mjs';   // C226a: a read/write distance only between comparable walks
import { headNamesRow, attributeFrom } from './steer-rules.mjs';   // C236: the credit rule is the crystal's pure function — never a second copy here
import { unloadModel, generatingFor } from './workers.mjs';   // C256: a quiet LOCAL worker's model is unloaded (keep_alive 0) the moment the watchdog ends it
import { parseWorkerLog, STALL_MS } from './worker-trace.mjs';   // C227: what the worker did, off its own log
import { dispatchContext, CONTEXT_FIELDS, contextFits, gooseTurns } from './dispatch-context.mjs';   // C235g: sent vs evaluated vs the context in force — a truncated dispatch is UNMEASURED
import { chosenCap, SWEEP_PATH } from './cap-sweep.mjs';   // C166d: the default cap is the sweep's measured choice, else the constant
import { settingFor } from './snowball-knob.mjs';   // C93g: the cap is a knob per shape, the aperture rides beside it
import { apertureVersion } from '../pmu/prompt-lens.mjs';   // C93g: the aperture in force, stamped on the dispatch row
import { budgetGate } from './steer-metrics.mjs';   // C93n: the turn budget is a gate — over max, no next dispatch
import { dozenBriefFor } from './outward-dozen.mjs';   // C242b: a row that names outward prose carries the dozen's floors up front in its brief

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
import { classifyFailures, UNMEASURED as failuresUnmeasured } from './failure-ratio.mjs';
export const NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const LOG_DIR = process.env.VNA_RUNNER_LOG_DIR || resolve(REPO, '.thetacog/runner');
// C197 — one pid file per running worker, keyed by label, written at spawn and removed on exit or on --stop; this is what
// lets a SEPARATE process invocation (a fresh `node steer-runner.mjs --stop`, sharing no module state with the runner
// that's still running) find and end a live worker from outside.
export const PID_DIR = process.env.VNA_RUNNER_PID_DIR || resolve(REPO, '.thetacog/runner/pids');
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
// the same strip as scripts/lab/run-ab.mjs — env -u CLAUDECODE alone is NOT enough (measured 2026-08-06)
export const STRIP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_EFFORT'];
import { ARCHIVE_PATHS } from './flight-tape.mjs';   // C92a: one list — the guard leg on the CAR archives the same parent tree
import { foldArgv } from './hook-doors.mjs';   // one fold argv — the expanded heap lives there
import { namedPaths } from './spec-clarity.mjs';
import { codeSlot } from './code-slot.mjs';   // C269: the file:lines window the brief carries
import { prepareWitness } from './witness.mjs';
import { dialShape } from './steer-rules.mjs';   // C276: the retry's one dial
import { snapshot, rollback, rollbackLine } from './rollback.mjs';   // C274: the tree as the worker found it   // C270: the host-written red witness for a mechanical row   // C268: the files a row names — the brief's scoped tree state
export { ARCHIVE_PATHS };
// LEAN WORKER CONTEXT (operator 2026-09-23: "Optimise subagent context size"). A worker re-reads its whole context on every turn
// (16–59 turns a unit), and runner.ndjson showed the bill is cache READS, ~90–290k tokens a turn, not new input. Measured on the
// worker's own session transcript: its preload carried a 36k-char skill listing, a 25k-char agent-type listing and ~24k chars of MCP
// tool records (Gmail, Calendar, Drive …) it never uses. A /steer worker edits files and commits; it keeps the tools workers were
// seen to call (Bash · Read · Edit · Write · Grep · Glob) plus the three it coordinates with (ToolSearch · SendMessage · ListAgents —
// a retry worker used them to catch a chair's bug). Measured first-turn context, same prompt and hooks: 72,173 tokens before →
// 46,245 with these flags (−36%). No Agent tool: a worker never spawns its own subagents. Guard: worker-context-is-lean.test.mjs.
export const WORKER_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'ToolSearch', 'SendMessage', 'ListAgents'];
export const WORKER_ARGS = ['-p', 'continue', '--dangerously-skip-permissions', '--output-format', 'json', '--strict-mcp-config', '--disable-slash-commands', '--tools', ...WORKER_TOOLS];
// C107d — THE TRIAGE WORKER: the residue brief IS the prompt; its ONLY tools are the two doors out of PENDING (no skip-permissions —
// in -p mode a tool outside --allowedTools is refused, never prompted), so it can declare or dismiss and nothing else.
export const TRIAGE_TOOLS = ['Bash(node scripts/vna/spec-check.mjs declare:*)', 'Bash(node scripts/vna/spec-check.mjs dismiss:*)'];
export const WORKER_ARGS_TRIAGE = (brief) => ['-p', brief, '--output-format', 'json', '--allowedTools', ...TRIAGE_TOOLS];

const nowIso = () => new Date().toISOString();
export const sha256Hex = (s) => createHash('sha256').update(String(s)).digest('hex');   // C213: the snowball's sha
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch { return null; } };
// C191a — the commit LANDED for a row is the newest one whose SUBJECT names it (`feat(vna): C199 — …`), never one that only
// mentions the id in its body: 2026-09-23 C199 was "re-graded ok" against the 04:01 C176a commit, whose body quoted
// `anchorSeed({leaf:C199,…})`. --grep prefilters the whole message (fast); the subject check is the construct. C199 ≠ C199a.
export function landedFor(repo, label) {
  const re = new RegExp(`(^|[^A-Za-z0-9])${String(label).replace(/[^A-Za-z0-9]/g, '')}(?![A-Za-z0-9])`);
  for (const line of (tryGit(repo, 'log', '--format=%H%x09%s', `--grep=\\b${label}\\b`) || '').split('\n')) {
    const [sha, subj] = line.split('\t'); if (sha && re.test(subj || '')) return sha;
  }
  return null;
}
// C166a: the base passes keyedEnv first — a key the ⚙️ Engines & Keys pill did not inject is dropped here, and the provenance rides the row
// C202 — A DISPATCHED WORKER ANCHORS AT ITS OWN LABEL, NEVER THE GOAL'S LEAF. The worker is a bare `claude -p continue` and the
// steer hook seeds it from the active leaf (C57). That leaf was .thetacog/vna-active-leaf.json, which goal.mjs rewrites to the
// goal's CURRENT unit on every prompt — so `until --scope C199,C201,C201a` (2026-09-23 13:29) spawned three workers whose three
// snowballs all said C199: the C201 and C201a workers claimed and edited the C199 files, the C199 worker found its row already
// taken. VNA_RUNNER_LABEL was exported but nothing on the leaf path read it. Now each dispatch writes its own pin — leaf-<label>.json
// beside its log, by: 'steer-runner' — and hands it to the worker as VNA_ACTIVE_LEAF (the path spec-tree.mjs activeLeaf, goal.mjs
// and hook-doors.mjs all already read); goal.mjs goalStatus leaves a runner-pinned file alone. The triage worker is not a row and
// gets no pin. Guard: c202-a-dispatched-worker-anchors-at-its-own-label.test.mjs.
export const LEAF_LABEL_RE = /^(C\d{1,3}[a-z]?|T\d{1,3})$/;
export function leafPin(label, n, leafDir) {
  if (!LEAF_LABEL_RE.test(String(label))) return null;
  const path = resolve(leafDir, `leaf-${label}.json`);
  mkdirSync(leafDir, { recursive: true });
  writeFileSync(path, JSON.stringify({ label, at: nowIso(), by: 'steer-runner', note: `dispatch ${n}: named row ${label}` }) + '\n');
  return path;
}
export function workerEnv(base, n, label, log, cap = null, leafDir = null, dispatchId = null) {
  const kv = keyedEnv(base);
  const env = {}; for (const [k, v] of Object.entries(kv.env)) if (!STRIP_ENV.includes(k) && !k.startsWith('CLAUDE_') && !k.startsWith('VNA_RUNNER_')) env[k] = v;
  env.VNA_RUNNER_DISPATCH = String(n); env.VNA_RUNNER_LABEL = label; env.VNA_RUNNER_LOG = log;
  if (dispatchId) env.VNA_RUNNER_DISPATCH_ID = String(dispatchId); else delete env.VNA_RUNNER_DISPATCH_ID;   // C186x: the claude worker's contract line prints the trailer off this
  if (cap != null) env.VNA_BUNDLE_CAP = String(cap); else delete env.VNA_BUNDLE_CAP;   // C166d: the steer hook's snowball holds THIS dispatch's cap
  const pin = leafPin(label, n, leafDir || dirname(log)); if (pin) env.VNA_ACTIVE_LEAF = pin; else delete env.VNA_ACTIVE_LEAF;   // C202: the pin sits beside this dispatch's log
  return { env, provenance: kv.provenance };
}
// C166d: every dispatch is a cap-sweep sample — wall seconds, tokens in (input + cache read + cache write) and out, ticked (0 until the verdict)
const sweepFields = (w) => { const u = w.result && w.result.usage; return { wall_s: +(w.ms / 1000).toFixed(1), tokens_in: u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : null, tokens_out: u ? (u.output_tokens ?? null) : null, ticked: 0 }; };
// C166a: the worker's OWN reported cost — 0 is a fact (`|| null` erased it), a local preset spends 0 by construction, absent stays null
const costOf = (w, preset) => { const c = w.result && (w.result.total_cost_usd ?? w.result.cost_usd); if (typeof c === 'number') return { cost_usd: c, cost_source: 'worker' }; const p = presetOf(preset); return p && p.local === true ? { cost_usd: 0, cost_source: 'local-preset' } : { cost_usd: null, cost_source: null }; };
// a nested `node --test` that inherits NODE_TEST_CONTEXT from an outer test runner exits 0 on failure (seen 2026-09-18 while
// building this: the red witness read GREEN on a missing module) — every test the runner runs gets a clean test env
const testEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };
// C227 — ONE LEARNING ROW PER HALT: what the worker did (off its own log) beside why it halted, so "what works" is read off the
// ledger across engines, caps and briefs rather than remembered. worker_caused: true when the worker's own output is the reason.
export function learnRow(path, d, log, reason, workerCaused) {
  let t = null; try { t = parseWorkerLog(readFileSync(log, 'utf8')); } catch { /* no log — the fields say so */ }
  // C235g: the context the dispatch ran under rides the row (sent · evaluated · in force, each with its source); a truncated
  // dispatch is UNMEASURED and never a worker failure, whatever gate the caller read
  const ctx = {}; for (const k of CONTEXT_FIELDS) if (k in d) ctx[k] = d[k];
  const truncated = d.context_verdict === 'UNMEASURED';
  record(path, { kind: 'learn', label: d.label, engine: d.engine || null, preset: d.preset || null, cap: d.cap ?? null, brief_sha: d.snowball_sha || null,
    n_calls: t ? t.calls.length : null, n_calls_total: t ? t.n_calls_total ?? null : null, calls_by_session: t ? t.calls_by_session || null : null, last_tool_call: t ? t.last_tool_call : null, ended_in_prose: t ? t.ended_in_prose : null, asked: t ? t.asked : null,
    alive: d.alive || null, goose_turns: d.goose_turns || null, halt_reason: String(reason).slice(0, 300), worker_caused: truncated ? false : workerCaused, ...ctx, log_why: t ? null : `no readable log at ${log}` });
}
const readNd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const record = (path, row) => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify({ at: nowIso(), ...row }) + '\n'); } catch {} };

// the next open unit from the record: the goal's first not-done unit, or a named open row
export function nextUnit({ goalPath, specPath, repo, label = null, skip = new Set() }) {
  const md = readFileSync(specPath, 'utf8'); const ticks = specTicks(md);
  if (label) { if (!(label in ticks)) return { error: `no row ${label} in the spec` }; if (ticks[label]) return { error: `row ${label} is already ticked` }; return { n: null, title: `named row ${label}`, labels: [label], label }; }
  const st = goalStatus({ path: goalPath, repo, md, write: false });
  if (!st) return { error: 'no goal on the record — node scripts/vna/goal.mjs set …' };
  const cur = st.units.find((u) => !u.done && !u.labels.every((l) => skip.has(l)));   // skip: the rows a dry-run already planned
  if (!cur) return { done: true };
  const open = cur.open.find((l) => !skip.has(l)) || cur.labels.find((l) => !skip.has(l));
  return { n: cur.n, of: st.units.length, title: cur.title, labels: cur.labels, label: open };
}

// C192 — DRY IS DRY AT THE SPAWN SITE. A dry-run must never reach child_process.spawn REGARDLESS of what the caller did or
// forgot to do above it (C189: one dry run spawned a paid worker anyway, $1.30) — so the refusal lives here, the one place
// every dispatch (default preset or otherwise) actually calls out to a binary.
export const isDryRun = (dryRun) => !!dryRun || process.env.VNA_DRY_RUN === '1';
// C255 — A QUIET WORKER IS ENDED, AND THE SLOT MOVES ON (operator 2026-09-24: *"build both"*). A worker that produced no output for
// quietMs held Ollama's one slot with nothing to show — C251 sat 14 min at 0 calls. The threshold is the SAME one the chat already
// paints as STALLED (worker-trace.mjs STALL_MS, 10 min; VNA_WORKER_QUIET_MS overrides; 0 turns it off). Any byte on stdout/stderr
// resets the clock. The group gets SIGTERM, then SIGKILL after 10 s, and the result carries quietKilled so the dispatch halts naming it.
export const WORKER_QUIET_MS = process.env.VNA_WORKER_QUIET_MS != null ? Number(process.env.VNA_WORKER_QUIET_MS) : STALL_MS;
// C256 — A QUIET LOCAL WORKER GETS 3 MIN, AND ITS MODEL IS UNLOADED (operator 2026-09-24, verbatim: "If a local worker process goes
// silent for 3 minutes without logging a tool call, send SIGTERM, record verdict: STUCK (timeout), and unload the model immediately").
// A local worker shares the Mac's unified memory with WindowServer, so its limit is tighter than a cloud worker's; VNA_LOCAL_WORKER_QUIET_MS overrides.
export const LOCAL_WORKER_QUIET_MS = process.env.VNA_LOCAL_WORKER_QUIET_MS != null ? Number(process.env.VNA_LOCAL_WORKER_QUIET_MS) : 3 * 60 * 1000;
// C256b — a LOCAL worker whose model is still generating for it is not quiet: the clock resets, up to a hard ceiling of real
// silence (no stdout at all) — VNA_LOCAL_WORKER_HARD_MS, default the cloud limit (WORKER_QUIET_MS, 10 min) — so a runaway still ends.
export const LOCAL_WORKER_HARD_MS = process.env.VNA_LOCAL_WORKER_HARD_MS != null ? Number(process.env.VNA_LOCAL_WORKER_HARD_MS) : (WORKER_QUIET_MS || 10 * 60 * 1000);
export const quietLimitFor = (ep) => (ep && ep.local ? Math.min(LOCAL_WORKER_QUIET_MS, WORKER_QUIET_MS || Infinity) : WORKER_QUIET_MS);
/** C256 — what the dispatch does when the watchdog ended a worker: the row reads STUCK (timeout).
 *  D3 (operator 2026-09-25, verbatim: "Unload Qwen only when the entire loop stops, keeping it warm to bypass the 45s cold prefill
 *  penalty on every retry"): the model is NOT unloaded here any more — measured, a cold prefill of C261's brief is 44.9 s and a warm
 *  one 0.4 s. The unload moves to the loop's end (steer-until.mjs unloadAtLoopEnd). `unload` stays injectable for that one caller. */
export async function onQuietKilled({ ep } = {}) {
  return { verdict: 'STUCK', stuck_reason: 'timeout', model_unloaded: null, unload_deferred: ep && ep.local && ep.model ? 'loop end (D3)' : null };
}
export function runWorker({ claude, cwd, env, log, quiet, args = WORKER_ARGS, label = null, pidDir = PID_DIR, dryRun = false, quietMs = WORKER_QUIET_MS, stillWorking = null, hardMs = null, onData = null }) {   // C265: onData(chunk, ms) lets the replay bench time the first output — never a second spawner
  return new Promise((done) => {
    mkdirSync(dirname(log), { recursive: true });
    if (isDryRun(dryRun)) {
      try { appendFileSync(log, `[runner] --dry-run: refused to spawn ${claude} ${args.join(' ')} — never reaches the spawn site\n`); } catch {}
      done({ exit: null, dryRunRefused: true, spawnError: null, stderr: '', ms: 0, result: null, pid: null });
      return;
    }
    const t0 = Date.now();
    const out = createWriteStream(log, { flags: 'a' });
    let stdout = '', stderr = '';   // C166: the stderr tail names the binary when sh answers 127
    const child = spawn(claude, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    // C197 — the pid file is what a SEPARATE `--stop` invocation reads; detached:true makes child.pid the process GROUP
    // leader on POSIX, so `kill(-pid, …)` (below, and the SIGINT handler at the bottom of this file) reaches the whole tree.
    const pidFile = label ? resolve(pidDir, `${label}.pid`) : null;
    if (pidFile) { try { mkdirSync(pidDir, { recursive: true }); writeFileSync(pidFile, JSON.stringify({ pid: child.pid, label, startedAt: nowIso() })); } catch {} }
    const cleanupPid = () => { if (pidFile) { try { unlinkSync(pidFile); } catch {} } };
    let lastOut = Date.now(), lastReal = Date.now(), quietKilled = null, watch = null;
    // C275 (U12) — WHICH SIGNAL KEPT THE WORKER ALIVE, ON THE ROW: stdout/stderr (real output) vs the server generating for it (C256b)
    const alive = { output_events: 0, generation_resets: 0, generation_extended_ms: 0, longest_silent_generating_ms: 0, last_signal: null };
    if (quietMs > 0) {
      watch = setInterval(() => {
        const q = Date.now() - lastOut; if (quietKilled || q < quietMs) return;
        if (stillWorking && (hardMs == null || Date.now() - lastReal < hardMs)) {   // C256b: thinking is not hanging
          let s = null; try { s = stillWorking(child.pid); } catch {}
          if (s && s.generating) { alive.generation_resets++; alive.generation_extended_ms += q; alive.longest_silent_generating_ms = Math.max(alive.longest_silent_generating_ms, Date.now() - lastReal); alive.last_signal = 'generating'; lastOut = Date.now(); try { out.write(`\n[runner] C256b: no output for ${Math.round(q / 1000)} s, but the model is generating for this worker (client ${(s.client_pids || []).join(',')}, runner cpu ${s.runner_cpu}%) — the clock resets; real silence ${Math.round((Date.now() - lastReal) / 1000)} s of ${Math.round((hardMs || 0) / 1000)} s\n`); } catch {} return; }
        }
        quietKilled = { quiet_ms: q, limit_ms: quietMs };
        try { out.write(`\n[runner] C255 watchdog: no output for ${Math.round(q / 1000)} s (limit ${Math.round(quietMs / 1000)} s) — ending the worker so the slot moves on\n`); } catch {}
        try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
        setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000).unref();
      }, Math.max(50, Math.min(30000, Math.floor(quietMs / 4))));
    }
    child.stdout.on('data', (d) => { alive.output_events++; alive.last_signal = 'output'; lastOut = lastReal = Date.now(); stdout += d; out.write(d); if (onData) { try { onData(String(d), Date.now() - t0); } catch {} } });
    child.stderr.on('data', (d) => { alive.output_events++; alive.last_signal = 'output'; lastOut = lastReal = Date.now(); stderr = (stderr + d).slice(-4000); out.write(d); if (!quiet) process.stderr.write(d); });
    child.on('error', (e) => { if (watch) clearInterval(watch); out.write(`\n[runner] spawn error: ${e.message}\n`); cleanupPid(); done({ exit: -1, spawnError: e.message, stderr, ms: Date.now() - t0, result: null, pid: child.pid, alive }); });
    child.on('close', (code) => { if (watch) clearInterval(watch); out.end(); cleanupPid(); done({ exit: code, stderr, ms: Date.now() - t0, result: parseResult(stdout), pid: child.pid, quietKilled, alive }); });
    runWorker.active = child;
  });
}
runWorker.active = null;

// ── C197 — A RUNNING WORKER IS ENDED FROM OUTSIDE BY ONE COMMAND. Reads the pid file(s) runWorker wrote (one per label,
// PID_DIR), SIGTERMs the process GROUP (the same kill the runner's own SIGINT handler does below), waits up to 5s for it
// to actually die, escalates to SIGKILL, appends a {stopped,label,pid,by:'operator'} row and removes the pid file. A
// label whose process is already gone (a stale pid file — the worker exited and cleanup raced, or the machine restarted)
// is swept away silently, never reported as a stop. Nothing running at all → said, exit 0, no ledger row.
export async function stopWorkers({ label = null, pidDir = PID_DIR, ndjson = NDJSON, quiet = false, waitMs = 5000, everyMs = 200, kill = process.kill } = {}) {
  const say = (s) => { if (!quiet) console.log(s); };
  let files; try { files = readdirSync(pidDir).filter((f) => f.endsWith('.pid')); } catch { files = []; }
  if (label && label !== 'all') files = files.filter((f) => f === `${label}.pid`);
  const alive = (pid) => { try { kill(pid, 0); return true; } catch { return false; } };
  const stopped = [];
  for (const f of files) {
    const p = resolve(pidDir, f);
    let row; try { row = JSON.parse(readFileSync(p, 'utf8')); } catch { try { unlinkSync(p); } catch {} continue; }
    const { pid, label: lbl } = row;
    if (!Number.isFinite(pid) || !alive(pid)) { try { unlinkSync(p); } catch {} continue; }   // stale pid file — no live process to stop
    try { kill(-pid, 'SIGTERM'); } catch { try { kill(pid, 'SIGTERM'); } catch {} }
    const t0 = Date.now(); let dead = false;
    while (Date.now() - t0 < waitMs) { if (!alive(pid)) { dead = true; break; } await new Promise((r) => setTimeout(r, everyMs)); }
    if (!dead) { try { kill(-pid, 'SIGKILL'); } catch { try { kill(pid, 'SIGKILL'); } catch {} } }
    try { unlinkSync(p); } catch {}
    const outRow = { stopped: true, label: lbl, pid, by: 'operator' };
    record(ndjson, { kind: 'stop', ...outRow, escalatedToKill: !dead });
    stopped.push(outRow);
    say(`stopped · ${lbl} · pid ${pid}${dead ? '' : ' (SIGKILL)'}`);
  }
  if (!stopped.length) { say(label && label !== 'all' ? `nothing running for ${label}` : 'nothing running'); return { ok: true, stopped: [], exitCode: 0 }; }
  return { ok: true, stopped, exitCode: 0 };
}
// claude -p --output-format json prints one JSON object (the result) — its usage/cost/num_turns are the worker's own facts
function parseResult(stdout) {
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { const o = JSON.parse(lines[i]); if (o && (o.type === 'result' || o.usage || o.result != null)) return o; } catch {} }
  return null;
}

// THE RED WITNESS — decidable from outside the worker: the parent commit's tree cannot have been authored by this dispatch.
// git archive HEAD~1 -- <paths> → scratch; the commit's changed test files copied in; node --test over them must FAIL there
// (RED) and PASS at HEAD (GREEN). A test that fails in the scratch because a module OUTSIDE the archived paths is missing is
// UNMEASURED, not RED — said, and fatal unless --allow-unmeasured-red.
// The scratch is ~8,000 files / 108 MB per head (the whole archived parent tree). The VERDICT is the deliverable; the
// scratch is deleted once the tests have run — nine dispatches once left 72,406 untracked files behind (2026-09-18).
// Guard: tests/vna/red-witness-scratch.test.mjs.
export function redWitness({ repo, head, tests, archivePaths = ARCHIVE_PATHS, scratchRoot }) {
  const parent = tryGit(repo, 'rev-parse', `${head}~1`); if (!parent) return { verdict: 'UNMEASURED', why: 'no parent commit' };
  const dir = resolve(scratchRoot, `red-${head.slice(0, 10)}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  try { return redWitnessIn({ repo, head, parent, tests, archivePaths, dir }); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function redWitnessIn({ repo, head, parent, tests, archivePaths, dir }) {
  const present = archivePaths.filter((p) => tryGit(repo, 'cat-file', '-e', `${parent}:${p}`) !== null);
  if (present.length) { try { execFileSync('bash', ['-c', `git archive ${parent} -- ${present.map((p) => `'${p}'`).join(' ')} | tar -x -C '${dir}'`], { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { return { verdict: 'UNMEASURED', why: `git archive failed: ${String(e.stderr || e.message).slice(0, 120)}` }; } }
  const nm = resolve(repo, 'node_modules'); if (existsSync(nm) && !existsSync(resolve(dir, 'node_modules'))) { try { execFileSync('ln', ['-s', nm, resolve(dir, 'node_modules')]); } catch {} }
  const changed = new Set((tryGit(repo, 'diff', '--name-only', `${parent}`, head) || '').split('\n').filter(Boolean));
  for (const t of tests) { mkdirSync(dirname(resolve(dir, t)), { recursive: true }); cpSync(resolve(repo, t), resolve(dir, t)); }
  let code = 0, err = '';
  try { execFileSync('node', ['--test', ...tests], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, env: testEnv() }); } catch (e) { code = e.status ?? 1; err = String(e.stdout || '') + String(e.stderr || ''); }
  // C93k — the parent run's failures, classified STATIC (surface absent) vs DYNAMIC (invariant failed on a surface the parent had);
  // a green parent run has nothing to classify and carries the UNMEASURED block, never a number
  if (code === 0) return { verdict: 'GREEN-ON-PARENT', why: 'the changed tests pass on the parent tree — nothing they assert was missing before this commit', failures: failuresUnmeasured() };
  const failures = classifyFailures(err);
  const missing = [...err.matchAll(/Cannot find module '([^']+)'/g)].map((m) => m[1]);
  const roots = [dir, (() => { try { return realpathSync(dir); } catch { return dir; } })()];   // macOS: /var is /private/var
  const outside = missing.filter((m) => { const root = roots.find((r) => m.startsWith(r + '/')); const rel = root ? m.slice(root.length + 1) : m; return !changed.has(rel) && !archivePaths.some((p) => rel === p || rel.startsWith(p + '/')); });
  if (outside.length) return { verdict: 'UNMEASURED', why: `the tests could not run on the parent tree: module outside the archive ${outside[0]}`, failures };
  return { verdict: 'RED', why: `the changed tests fail on the parent tree (exit ${code})`, failures };
}

async function pollCar(car, sha, { waitMs, everyMs = 2000 }) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < waitMs) { last = await car(sha); if (last && last.complete) return { ...last, waitedMs: Date.now() - t0 }; await new Promise((r) => setTimeout(r, everyMs)); }
  return { ...(last || { complete: false, missing: ['no tape row'] }), waitedMs: Date.now() - t0, timedOut: true };
}
// C92e — after the verdict row exists the labour block can be read (hours = the verdict ms, the ratio = C93k's classification) and
// stamped on the tape as an amending commit row; dynamic like defaultCar (flight-tape pulls crypto + mesh keys), bounded, never a gate
async function defaultStamp({ sha, ndjson }) { try { const m = await import('./flight-tape.mjs'); const rows = readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); return m.stampLabour({ sha, runnerRows: rows }); } catch (e) { return { ok: false, appended: false, why: String(e.message).slice(0, 120) }; } }
async function defaultCar(sha) { const m = await import('./flight-tape.mjs'); try { const c = m.carFor(sha); return c ? { complete: !!c.complete, missing: c.missing || [], tesseract_sha: c.tesseract_sha || null } : { complete: false, missing: ['no tape row for HEAD yet'] }; } catch (e) { return { complete: false, missing: [String(e.message).slice(0, 80)] }; } }

// THE GATES over the WORK commit in head0..head1 — the newest non-chore commit that CHANGES A TEST FILE. Two live halts taught
// the shape: (1) the post-commit hook's detached chore(commit-page) publish landed before the runner read HEAD ("d174008be8 does
// not name C44" was the chore); (2) the C74 worker landed the unit as TWO commits per ITERATION DISCIPLINE — feat (code + guard)
// then a one-file spec tick — and the newest non-chore commit "changes no file under tests/". The guard commit is the unit; a
// range with no test-changing commit falls back to the newest non-chore one and fails that gate honestly. Each gate is a fact
// from git or the tape; the first false one is the reason.
const isTestPath = (f) => /^tests\/.*\.(test\.)?m?js$/.test(f);
// THE WORK COMMIT on a shared tree (2026-09-18 18:21Z: dispatch 6 HALTED "the commit 60c895b86e does not name C78b" — the
// worker's commit named C78b, a parallel room's test commit landed after it and was picked): the newest commit in the range
// that NAMES the label (subject or body), then the newest touching a test, then the newest non-chore. Other rooms commit
// between a worker's commit and its verdict; the label is what the worker was told to put in the subject (C68 copy).
// C186x — THE WORKER'S COMMIT IS ITS OWN, NOT ANY COMMIT THAT NAMES ITS ROW (2026-09-24: the chair's spec commit df727340da quoted
// "C176k" mid-subject and touched only the spec; the subject rule credited it to the C176k worker — right by accident, since it
// carried no test). Every commit on this tree has ONE git author, so the worker session cannot be read off the signature; the
// dispatch mints a nonce, the brief hands it to the worker as a `Steer-Dispatch: <nonce>` trailer, and the commit carrying that
// exact trailer is the work. For an engine that drops trailers, the fallback is a conventional-commit HEAD that names the row —
// `<type>(<scope>): C176k …` or the scope itself — never a mention anywhere else in the subject. The rule that attributed the
// commit rides the verdict row (attributed_by). Guard: tests/vna/runner-work-commit.test.mjs (C186x cases).
export const DISPATCH_TRAILER_KEY = 'Steer-Dispatch';
export const dispatchTrailer = (nonce) => `${DISPATCH_TRAILER_KEY}: ${nonce}`;
export const mintDispatchId = () => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
// C236: the head rule and the credit rule are steer-rules.mjs's pure functions (headNamesRow · attributeFrom) — the crystal
// enumerates those exports; this reads the range off git and hands them the list (the guard-carrying commit first within a
// rule, C67b: a spec-tick after the feat names it too). Nothing attributable with a label reads as "no commit is the worker's".
export { headNamesRow };
export function attributeWorkCommit(repo, head0, head1, label = null, { nonce = null } = {}) {
  const raw = tryGit(repo, 'log', `--format=%H%x1f%s%x1f%(trailers:key=${DISPATCH_TRAILER_KEY},valueonly,separator=%x2c)%x1e`, `${head0}..${head1}`) || '';
  const list = raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => { const [sha, subject = '', tr = ''] = r.split('\x1f'); return { sha, subject, trailers: tr.split(',').map((s) => s.trim()).filter(Boolean) }; });
  const touchesTest = (c) => (tryGit(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', c.sha) || '').split('\n').some(isTestPath);
  return attributeFrom(list, { label, nonce, touchesTest, head1 });
}
export function workCommit(repo, head0, head1, label = null, opts = {}) { return attributeWorkCommit(repo, head0, head1, label, opts).sha; }
export async function gradeCommit({ repo, head0, head1, label, nonce = null, archivePaths = ARCHIVE_PATHS, scratchRoot, allowUnmeasuredRed = false, fold, car = defaultCar, waitCarMs = 120000 }) {
  const d = { gates: {} }; const fail = (reason) => ({ ok: false, reason, d });
  const att = attributeWorkCommit(repo, head0, head1, label, { nonce }); const work = att.sha; d.work = work; d.attributed_by = att.rule;
  d.gates.labelNamed = att.rule === 'nonce-trailer' || att.rule === 'scope-head';   // C186x: the trailer or the head, never a mention
  const parent = tryGit(repo, 'rev-parse', `${work}~1`) || head0;
  const changed = (tryGit(repo, 'diff', '--name-only', parent, work) || '').split('\n').filter(Boolean);
  const tests = changed.filter((f) => isTestPath(f) && existsSync(resolve(repo, f)));
  d.gates.testChanged = tests.length > 0; d.tests = tests;
  // workCommit prefers a commit naming the label, so a false labelNamed means NO commit in the range names it. The commit it
  // fell back to is the newest in the range — on a shared tree usually another room's (2026-09-23: C223f HALTED "the commit
  // fc73f36b81 does not name C223f" — fc73f36b81 was the C225 room's). It is never recorded as the worker's work: a later
  // revert-on-misnamed step reads d.work, and must not revert a foreign commit. Guard: tests/vna/runner-work-commit.test.mjs
  if (!d.gates.labelNamed) {
    const inRange = (tryGit(repo, 'rev-list', '--count', `${head0}..${head1}`) || '0').trim();
    d.work = null; d.newestInRange = work;
    return fail(`no commit in ${String(head0).slice(0, 10)}..${String(head1).slice(0, 10)} names ${label} at its head${nonce ? ` or carries ${dispatchTrailer(nonce)}` : ''} — ${inRange} commit(s) moved HEAD, none the worker's (newest ${work.slice(0, 10)})`);
  }
  if (!d.gates.testChanged) return fail(`the commit ${work.slice(0, 10)} changes no file under tests/ — no guard, not done`);
  const rw = redWitness({ repo, head: work, tests, archivePaths, scratchRoot }); d.gates.redWitness = rw.verdict; d.redWhy = rw.why;
  d.static_dynamic_ratio = { ...(rw.failures || failuresUnmeasured()), source: 'parent run' };   // C93k — on the verdict row and the audit row
  if (rw.verdict === 'GREEN-ON-PARENT' || (rw.verdict === 'UNMEASURED' && !allowUnmeasuredRed)) return fail(`red witness ${rw.verdict}: ${rw.why}`);
  let green = true, greenErr = ''; try { execFileSync('node', ['--test', ...tests], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, env: testEnv() }); } catch (e) { green = false; greenErr = String(e.stdout || e.stderr || '').split('\n').filter((l) => /^not ok/.test(l)).slice(0, 3).join(' | '); }
  d.gates.guardGreen = green;
  if (!green) return fail(`the guard is not green at HEAD: ${greenErr || 'node --test failed'}`);
  if (fold) { const tf = Date.now(); let foldOk = true, foldErr = ''; try { execFileSync(fold[0], fold.slice(1), { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }); } catch (e) { foldOk = false; foldErr = String(e.stderr || e.message).slice(0, 160); }
    d.gates.foldOk = foldOk; d.foldMs = Date.now() - tf; if (!foldOk) return fail(`the fold failed: ${foldErr}`); }
  const c = await pollCar(car, work, { waitMs: waitCarMs }); d.gates.carComplete = !!c.complete; d.car = c;
  if (!c.complete) return fail(`no COMPLETE CAR for ${work.slice(0, 10)} within ${waitCarMs} ms — missing ${(c.missing || []).join(', ')}`);
  return { ok: true, reason: null, d };
}
// --audit <sha>: grade a commit that already landed (a halted dispatch's work commit, or any row's closing commit) and record it
export async function audit({ repo = REPO, sha, label, ndjson = NDJSON, logDir = LOG_DIR, archivePaths = ARCHIVE_PATHS, scratchRoot = null, allowUnmeasuredRed = false, fold = null, car = defaultCar, stamp = defaultStamp, waitCarMs = 120000, quiet = false } = {}) {
  scratchRoot ||= process.env.CLAUDE_SCRATCHPAD_DIR || resolve(logDir, 'scratch');
  const work = tryGit(repo, 'rev-parse', sha); if (!work) { record(ndjson, { kind: 'audit', ok: false, sha, label, reason: 'no such commit' }); return { ok: false, reason: 'no such commit', gates: {} }; }
  const parent = tryGit(repo, 'rev-parse', `${work}~1`);
  const lbl = label || ((tryGit(repo, 'log', '-1', '--format=%s', work) || '').match(/\b(C\d+[a-z]?|T\d+)\b/) || [])[1] || null;
  const g = await gradeCommit({ repo, head0: parent, head1: work, label: lbl, archivePaths, scratchRoot, allowUnmeasuredRed, fold, car, waitCarMs });
  const row = { kind: 'audit', ok: g.ok, sha: work, label: lbl, reason: g.reason, ...g.d }; record(ndjson, row);
  if (g.ok && stamp) { const st = await stamp({ sha: work, ndjson }); record(ndjson, { kind: 'labour', sha: work, label: lbl, ok: st.ok, appended: st.appended, why: st.why || null, stamp: st.stamp || null }); }
  if (!quiet) console.log(g.ok ? `✓ audit · ${lbl} · ${work.slice(0, 10)} · red ${g.d.gates.redWitness} · green · CAR complete` : `✗ audit · ${lbl} · ${work.slice(0, 10)} · ${g.reason}`);
  return { ok: g.ok, reason: g.reason, gates: g.d.gates, sha: work, label: lbl };
}

// ── C191 — A HALT THE WORKER DID NOT CAUSE IS RE-GRADED, NEVER RE-PAID. MEASURED 2026-09-23: $29.68 of $127.73 (23%) went
// to six paid workers whose output was then discarded by a halt, $18.82 of it verdict-side or machine-side (bugs since
// fixed), not the worker's fault. `--regrade <label>` finds the commit already landed for that label and re-runs the same
// six gates gradeCommit always runs, at $0 — no worker is spawned. gateIsWorkerCaused reads the FIRST false gate off a
// grade and says whether a fresh paid dispatch could plausibly fix it (the worker's own commit/test/code) or whether it is
// the harness's own doing (the fold, the tape, an UNMEASURED red witness) that a retry cannot touch.
export function gateIsWorkerCaused(d) {
  const g = (d && d.gates) || {};
  if (g.labelNamed === false) return { worker: true, gate: 'labelNamed' };
  if (g.testChanged === false) return { worker: true, gate: 'testChanged' };
  if (g.redWitness === 'GREEN-ON-PARENT') return { worker: true, gate: 'redWitness' };   // the worker's test asserted nothing new
  if (g.redWitness === 'UNMEASURED') return { worker: false, gate: 'redWitness' };   // the harness could not even run it on the parent tree
  if (g.guardGreen === false) return { worker: true, gate: 'guardGreen' };
  if (g.foldOk === false) return { worker: false, gate: 'foldOk' };   // the fold script/environment, not the worker's commit
  if (g.carComplete === false) return { worker: false, gate: 'carComplete' };   // tape/timing — the post-commit walk, not the worker
  return { worker: null, gate: null };   // nothing false to classify (a clean grade, or a halt before any commit existed)
}
export async function regrade({ repo = REPO, label, ndjson = NDJSON, logDir = LOG_DIR, archivePaths = ARCHIVE_PATHS, scratchRoot = null, allowUnmeasuredRed = false, fold = null, car = defaultCar, stamp = defaultStamp, waitCarMs = 120000, quiet = false } = {}) {
  const sha = landedFor(repo, label);
  if (!sha) {
    const reason = `no commit on the log names ${label} — nothing landed to re-grade`;
    record(ndjson, { kind: 'regrade', ok: false, label, sha: null, reason, cost_usd: 0, cost_source: 'regrade-no-worker' });
    if (!quiet) console.log(`✗ regrade · ${label} · ${reason}`);
    return { ok: false, reason, sha: null, gates: {}, workerCaused: null, exitCode: 2 };
  }
  const a = await audit({ repo, sha, label, ndjson, logDir, archivePaths, scratchRoot, allowUnmeasuredRed, fold, car, stamp, waitCarMs, quiet: true });
  const w = gateIsWorkerCaused({ gates: a.gates || {} });
  record(ndjson, { kind: 'regrade', ok: a.ok, label, sha: a.sha, reason: a.reason, cost_usd: 0, cost_source: 'regrade-no-worker', gates: a.gates, workerCaused: w.worker, failingGate: w.gate });
  if (!quiet) console.log(a.ok ? `✓ regrade · ${label} · ${a.sha.slice(0, 10)} · re-graded at $0 — the halt did not need a paid worker` : `✗ regrade · ${label} · ${a.reason} · worker-caused ${w.worker}`);
  return { ok: a.ok, reason: a.reason, sha: a.sha, gates: a.gates, workerCaused: w.worker, failingGate: w.gate, exitCode: a.ok ? 0 : 2 };
}

// ── C192(a) — A TICKED OR VERDICT-OK LABEL IS NEVER DISPATCHED AGAIN WITHOUT --force. MEASURED: C157 and C93k were each
// dispatched and paid twice ($17.14 for C157) — the spec checkbox and the runner ledger's verdict-ok row can disagree in
// the window before a worker's tick lands, so the ledger is checked independently of the spec's own tick.
// A VOID ROW RETRACTS ONE VERDICT WITHOUT EDITING THE LEDGER (2026-09-24): {kind:'void', label, sha, reason} — a verdict-ok row whose
// (label, work) has a void row after it no longer counts. The ledger stays append-only; the retraction is itself a dated row.
export function labelAlreadyVerdictOk(ndjsonPath, label) {
  let lines; try { lines = readFileSync(ndjsonPath, 'utf8').split('\n').filter(Boolean); } catch { return false; }
  const ok = new Set(); const sha10 = (x) => String(x || '').slice(0, 10);
  for (const line of lines) { try { const r = JSON.parse(line); if (r.label !== label) continue;
    if (r.kind === 'verdict' && r.ok === true) ok.add(sha10(r.work));
    else if (r.kind === 'void') ok.delete(sha10(r.sha)); } catch {} }
  return ok.size > 0;
}
export function voidVerdict(ndjsonPath, { label, sha, reason }) { record(ndjsonPath, { kind: 'void', label, sha, reason }); }

// ── C79e AUTOMATED LANE ENFORCEMENT — the arm pick retires. Before a dispatch the working tree's placement (the preview
// receipt's pixel, C79d — only a preview NEWER than HEAD says anything about the tree since the commit) is read against the
// unit's basin pixel; the Chebyshev block distance decides: ≤ 1 advance, ≥ 2 pause (a row with both coordinates and the
// distance; the card offers Auto-Amend / Revert), no pixel on either side UNMEASURED — said, never a silent advance or pause.
const SL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const blkOf = (p) => { const [r, c] = String(p || '').split(','); const i = SL.indexOf(r), j = SL.indexOf(c); return i < 0 || j < 0 ? null : [i, j]; };
export const LANE_PAUSE_D = 2;
// C93i — THE LANE CHECK WALKS THE DISPATCH'S OWN PATHS, NOT THE SHARED TREE (2026-09-19: the gate paused C91b ten blocks off-lane on
// another room's uncommitted book edits). The preview is a walk of the WHOLE dirty tree; a dispatch owns the paths its row names
// (C59 path terms) and the paths its label's last commit touched. When nothing dirty intersects those, the drift the preview
// measured is FOREIGN — printed on the row as `foreign: <paths>` and never a pause. When something dirty is ours, the preview's
// reading stands as before. Said, never silently advanced: the row carries both lists.
export function ownPaths({ repo = REPO, label, tree = null }) {
  const out = new Set();
  const n = tree && tree.nodes && tree.nodes[`n_spec_${label}`]; for (const t of ((n && n.defs && n.defs.terms) || [])) if (t.kind === 'path' && t.term) out.add(String(t.term).replace(/\/$/, ''));
  const sha = landedFor(repo, label); if (sha) for (const f of (tryGit(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha) || '').split('\n')) if (f) out.add(f);
  return [...out];
}
export function dirtyPaths(repo = REPO) { return (tryGit(repo, 'status', '--porcelain', '--untracked-files=no') || '').split('\n').filter(Boolean).map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter((f) => !f.startsWith('.thetacog/')); }
export function splitDirty({ dirty, own }) { const covers = (f, o) => f === o || f.startsWith(o + '/') || o.startsWith(f + '/'); const ours = dirty.filter((f) => own.some((o) => covers(f, o))); const foreign = dirty.filter((f) => !ours.includes(f)); return { ours, foreign }; }
export function laneCheck({ treePath = resolve(REPO, 'data/vna/spec-tree.json'), previewPath = resolve(REPO, 'data/vna/cockpit-preview.json'), label, headAt = null, repo = REPO, dirty = null, own = null } = {}) {
  let pv = null; try { pv = JSON.parse(readFileSync(previewPath, 'utf8')); } catch {}
  let tree0 = null; try { tree0 = JSON.parse(readFileSync(treePath, 'utf8')); } catch {}
  const dl = dirty || dirtyPaths(repo); const ol = own || ownPaths({ repo, label, tree: tree0 }); const split = splitDirty({ dirty: dl, own: ol });
  if (dl.length && !split.ours.length) return { state: 'ADVANCE', d: null, own: ol, foreign: split.foreign, why: `foreign: ${split.foreign.slice(0, 6).join(' ')}${split.foreign.length > 6 ? ` +${split.foreign.length - 6}` : ''} — dirty paths belong to another room; none intersects ${label}'s own paths` };
  if (!pv || !pv.generatedAt) return { state: 'ADVANCE', d: null, why: 'no preview receipt — the working tree has not been walked since HEAD' };
  if (headAt && Date.parse(pv.generatedAt) <= Date.parse(headAt)) return { state: 'ADVANCE', d: null, why: `the preview (${pv.generatedAt}) is older than HEAD (${headAt}) — nothing measured on the tree since the commit` };
  const workPixel = String(pv.dignityPixel || pv.pixel || '').split('⊕')[0].trim() || null;
  if (!workPixel || !blkOf(workPixel)) return { state: 'UNMEASURED', d: null, workPixel: null, why: 'the preview carries no pixel — the walk refused; walk again before dispatching' };
  let tree = null; try { tree = JSON.parse(readFileSync(treePath, 'utf8')); } catch {}
  const n = tree && tree.nodes && tree.nodes[`n_spec_${label}`]; const basinPixel = n && n.pixel ? n.pixel : null;
  if (!basinPixel || !blkOf(basinPixel)) return { state: 'UNMEASURED', d: null, workPixel, basinPixel: null, why: `basin ${label} has no pixel on the tree — fold with the walk on before dispatching` };
  const a = blkOf(workPixel), b = blkOf(basinPixel); const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  return { state: d >= LANE_PAUSE_D ? 'PAUSE' : 'ADVANCE', d, workPixel, basinPixel, own: ol, ours: split.ours, foreign: split.foreign, why: d >= LANE_PAUSE_D ? `the working tree sits at ${workPixel}, ${d} blocks from ${label}'s basin at ${basinPixel}` : `in lane — ${d} block${d === 1 ? '' : 's'} from the basin` };
}
// ── C176 LAYER 2 — THE SHAPE GUARD ON THE RECORDS (layers 1 and 3 are open). Every dispatch row carries the half of the read=write
// relation known at brief time: treeRoot · treeWatermark · treeAtTape · rowsBehind (C175) · pack_ratio (C166c) · write_pixel (the
// basin pixel the fold's L1 walk gave the unit's row) · read_set (what the snowball massed into the brief, ids only, ≤ 20). Every
// verdict row carries landed_pixel (the walk's placement of the work commit, source named) and l1_write_to_landed. A field that
// cannot be read is null WITH a *_why beside it — never invented, never a default pixel. Never a gate: a missing reading dispatches.
export const READ_SET_CAP = 20;
export const l1Blocks = (a, b) => { const x = blkOf(a), y = blkOf(b); return x && y ? Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) : null; };
export async function c176DispatchFields({ repo = REPO, label, cap = BUNDLE_TOKEN_CAP, preset = DEFAULT_PRESET, treePath = resolve(repo, 'data/vna/spec-tree.json'), ledgerPath = resolve(repo, 'docs/specs/vna/amendments.ndjson'), tree = undefined, bundleFn = bundleOf } = {}) {
  const f = {};
  const wm = readWatermark(treePath);
  let T = tree; if (T === undefined) { T = null; try { T = JSON.parse(readFileSync(treePath, 'utf8')); } catch {} }   // the hook's own read: no blobs (steer-hook.mjs snowball)
  f.treeRoot = (wm && wm.root) || (T && T.root) || null; f.treeRoot_source = wm && wm.root ? 'spec-tree.watermark.json' : T && T.root ? 'spec-tree.json' : null;
  if (!f.treeRoot) f.treeRoot_why = 'no spec tree on disk — nothing folded';
  try { const L = readLose({ repo, tree: treePath, ledger: ledgerPath }); if (L.treeMissing) { f.treeWatermark = null; f.rowsBehind = null; f.treeAtTape = null; f.rowsBehind_why = 'no spec tree on disk — the fold lag is unmeasured'; } else { f.treeWatermark = L.watermark; f.rowsBehind = L.tapeRows; f.treeAtTape = L.tapeRows === 0; } }
  catch (e) { f.treeWatermark = null; f.rowsBehind = null; f.treeAtTape = null; f.rowsBehind_why = `clear-gauge readLose threw: ${String(e.message).slice(0, 80)}`; }
  f.pack_ratio = null; f.pack_ratio_why = 'not exposed — bundle() (spec-tree.mjs) cuts raw mass oldest-first and receipts only the cut (C166c is open)';
  const n = T && T.nodes && T.nodes[`n_spec_${label}`];
  f.write_pixel = n && blkOf(n.pixel) ? n.pixel : null; f.write_walk = n && n.walk ? walkStamp(n.walk) : null;   // C226a: the basin walk's stamp rides the dispatch f.write_pixel_source = f.write_pixel ? 'spec-tree basin pixel (the fold\'s L1 walk of the row)' : null;
  if (!f.write_pixel) f.write_pixel_why = !T ? 'no spec tree on disk' : !n ? `no basin n_spec_${label} on the tree` : `basin ${label} carries no lattice pixel — the walk refused or the fold ran without it`;
  f.read_set = null; f.read_set_n = null; f.read_set_d_why = null;
  if (preset !== DEFAULT_PRESET) { f.read_set = [{ id: label, d: null }]; f.read_set_n = 1; f.read_set_source = 'snowballText (the unit row + the goal copy)'; f.read_set_d_why = 'the handed snowball is the unit row itself — no NCD distance is taken'; f.pack_cut = null; return f; }
  if (!n) { f.read_set_why = f.write_pixel_why; return f; }
  try {
    const env = await bundleFn(T, n.id || `n_spec_${label}`, { capTokens: cap });
    if (!env) { f.read_set_why = `bundle() returned null for n_spec_${label} (a parent or retracted node)`; return f; }
    const all = [{ id: label, d: null, via: 'basin' }, ...[...env.raw_semantic_mass].reverse().map((m) => ({ id: m.sha8, d: null, via: m.via }))];   // newest first, as the hook prints them
    f.read_set = all.slice(0, READ_SET_CAP); f.read_set_n = all.length; f.read_set_source = 'bundle() at this dispatch\'s cap — the steer hook\'s snowball of the unit basin';
    f.read_set_d_why = 'the default brief is anchored by the record (C57: the goal names the basin) — no NCD distance is computed for an anchored basin or its massed snippets';
    f.pack_cut = env.cap && env.cap.truncated || null;
  } catch (e) { f.read_set_why = `bundle() threw: ${String(e.message).slice(0, 100)}`; }
  return f;
}
export function c176VerdictFields({ repo = REPO, work, write_pixel = null, write_walk = null, walkTape = process.env.PMU_WALK_TAPE || resolve(repo, '.thetacog/walk-tape.ndjson') } = {}) {
  const f = { landed_pixel: null, landed_pixel_source: null, l1_write_to_landed: null };
  const hit = work ? commitRowFor(walkTape, work) : null;
  if (hit && hit.placed) { f.landed_pixel = hit.row.pixel; f.landed_pixel_source = `walk-tape commit-reality row (the one Rust walk) · ref ${hit.row.ref} · ${hit.row.ts}`; }
  else f.landed_pixel_why = !work ? 'no work commit' : hit ? `the walk's row for ${String(work).slice(0, 10)} carries no lattice pixel (${String(hit.row.err || hit.row.sensor || 'refused').slice(0, 80)})` : `no commit-reality row for ${String(work).slice(0, 10)} on the walk tape at verdict time — the post-commit walk is detached`;
  f.l1_write_to_landed = l1Blocks(write_pixel, f.landed_pixel);
  if (f.l1_write_to_landed == null) f.l1_why = !write_pixel ? 'no write_pixel on the dispatch' : !f.landed_pixel ? 'no landed_pixel' : 'a pixel off the lattice';
  // C226a — l1_write_to_landed stays the raw difference; l1_reading is it only when both walks are one instrument
  const iso = isoComparable(write_walk, hit && hit.placed ? hit.row : null);
  f.iso_comparable = iso.ok; f.iso_mismatch = iso.mismatch;
  f.l1_reading = iso.ok ? f.l1_write_to_landed : null;
  if (!iso.ok) f.l1_reading_why = `UNMEASURED — the two walks are not one instrument: ${mismatchWhy(iso.mismatch)}`;
  return f;
}
// ── C213 — EVERY DISPATCH PROVES ITS SNOWBALL AND ITS TREE ROOT, AND THE VERDICT ROW RE-DERIVES BOTH FROM A DURABLE
// RECORD RATHER THAN CARRYING THE DISPATCH-TIME VALUE FORWARD (AXIOM 1 W3 — read a record the actor did not author).
// THE SNOWBALL: a non-default preset writes its brief to a sidecar file (enginePlan's ep.snowball) — hash ITS BYTES
// on disk, so a worker (or a later step) that edits or deletes the file after the brief was handed reads UNMEASURED,
// never a silent pass. The default preset (claude-code-headless) writes no sidecar — C168e: "the hook seeds it from
// the record" — so there is nothing on disk to hash; the bundle it was briefed from (c176DispatchFields' read_set,
// already on the dispatch row) stands in as "the bundle" the spec names.
// THE TREE ROOT: data/vna/spec-tree-roots.ndjson is the append-only fold log (spec-tree.mjs) — a root the dispatch
// row claims must appear as SOME row's `root` on that ledger, or it has no receipt and reads UNMEASURED.
export function snowballSha({ snowballPath = null, readSet = null } = {}) {
  if (snowballPath) {
    try { return { sha: sha256Hex(readFileSync(snowballPath, 'utf8')), source: `sidecar ${snowballPath}` }; }
    catch (e) { return { sha: null, source: null, why: `sidecar ${snowballPath} unreadable: ${String(e.message).slice(0, 100)}` }; }
  }
  if (readSet) return { sha: sha256Hex(JSON.stringify(readSet)), source: 'bundle read_set (the default preset writes no sidecar — the hook seeds it live from the record, C168e)' };
  return { sha: null, source: null, why: 'no sidecar file and no bundle read_set to hash' };
}
export function treeRootProof(root, rootsPath = resolve(REPO, 'data/vna/spec-tree-roots.ndjson')) {
  if (!root) return { verdict: 'UNMEASURED', why: 'no tree root on the dispatch row' };
  let rows; try { rows = readFileSync(rootsPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch (e) { return { verdict: 'UNMEASURED', why: `spec-tree-roots.ndjson unreadable: ${String(e.message).slice(0, 100)}` }; }
  const hit = rows.find((r) => r && r.root === root);
  return hit ? { verdict: 'MATCH', why: `root receipted at ${hit.at}` } : { verdict: 'UNMEASURED', why: `root ${String(root).slice(0, 16)}… has no row on spec-tree-roots.ndjson` };
}
// the brief-time half: every dispatch names {engine, leaf, snowball_sha, tree_root} — engine/treeRoot already ride
// the plan (ep.engine, c176DispatchFields' treeRoot); leaf and snowball_sha are new here, never duplicating either.
export function c213DispatchFields({ label, ep, readSet = null }) {
  const sn = snowballSha({ snowballPath: (ep && ep.snowball) || null, readSet });
  const f = { leaf: label, snowball_sha: sn.sha, snowball_sha_source: sn.source };
  if (sn.why) f.snowball_sha_why = sn.why;
  return f;
}
// the verdict-time half: RE-DERIVE, never copy forward — a stale/edited sidecar or an unreceipted root reads UNMEASURED
export function c213VerdictFields({ snowball_sha, snowball_path = null, readSet = null, treeRoot = null, rootsPath = undefined }) {
  const sn = snowballSha({ snowballPath: snowball_path, readSet });
  const snowball_sha_recomputed = sn.sha;
  const snowball_proof = (snowball_sha && snowball_sha_recomputed && snowball_sha === snowball_sha_recomputed) ? 'MATCH' : 'UNMEASURED';
  const f = { snowball_sha_recomputed, snowball_proof };
  f.snowball_proof_why = snowball_proof === 'MATCH' ? `recompute equals the dispatch row's ${String(snowball_sha).slice(0, 12)}…` : (sn.why || `dispatch claimed ${String(snowball_sha).slice(0, 12)}… but the recompute gives ${String(snowball_sha_recomputed).slice(0, 12)}… — the sidecar changed or vanished after the brief was handed`);
  const tr = rootsPath === undefined ? treeRootProof(treeRoot) : treeRootProof(treeRoot, rootsPath);
  f.tree_root_proof = tr.verdict; f.tree_root_proof_why = tr.why;
  return f;
}
// ── C166 THE ENGINE IS A PRESET. claude-code-headless (the default) spawns exactly what the runner always spawned — `claude -p continue`,
// the steer hook seeds it from the record — so the default path has not moved a byte. Any other preset has no hook to seed it, so it is
// HANDED THE SNOWBALL: the goal in execution order (goal.mjs copy) and the unit's own spec row, cut to the bundle cap, written to
// <logDir>/<n>-<label>.snowball.txt; its template is resolved by runner-resolver.mjs and run under `sh -c`. The keys the ⚙️ Engines &
// Keys pill holds arrive in `env` from the extension (SecretStorage → child env); nothing here reads or writes one.
// ── C166d the cap for dispatch n: --cap wins, --cap-rotate cycles per dispatch (the sweep), else the sweep's MEASURED choice, else the
// spec-tree constant. Never a hand-typed number; the source rides the receipt so every dispatch is a sweep sample.
// C93g: past the sweep, the default is the snowball knob's setting for the row's predicted shape (v1 = the constant for every shape).
export function capFor({ cap = null, capRotate = null, n = 1, sweepPath = SWEEP_PATH, knob = null } = {}) {
  if (Number.isFinite(cap) && cap > 0) return { cap, source: 'flag' };
  if (Array.isArray(capRotate) && capRotate.length) return { cap: capRotate[(n - 1) % capRotate.length], source: 'rotate' };
  const c = chosenCap({ path: sweepPath }); if (c.source !== 'default' || !knob) return { cap: c.cap, source: c.source };
  return { cap: knob.cap, source: `knob v${knob.knob_v} · ${knob.setting_shape}` };
}
// THE WORKER'S BRIEF IS THE ROW AND THE HOUSE RULES, NEVER THE CHAT'S GOAL COPY (2026-09-23, goose/qwen3:8b on C223a–f). The brief
// used to append goalCopy() — all six goal items, the execution order, and "RUN IT HEADLESS: node scripts/vna/steer-runner.mjs
// --max-units N". Two workers obeyed that line: they launched runners of their own (orphaned, `--guard c91-basin-declared…`, a flag
// the runner does not have), whose worker then gutted tests/vna/c91-basin-declared.test.mjs. Another wrote a guard running
// `git commit` against the live repo, another `require('../../../src/auto-ticks')` inside an .mjs. The row carries its own verbatim
// span; the goal is the chair's context, not the worker's. HOUSE_RULES are the facts an 8B model cannot infer from one row.
// 2026-09-24, from the worker logs (C227): C223a/C223b ended by ASKING the user a question ("Could you clarify…") — headless, nobody
// answers, the session ends with no commit; C223b imported createHermetic / ncd-utils.mjs / fence-utils.mjs, none of which exist.
// Guard: tests/vna/worker-brief-is-the-row-and-the-house-rules.test.mjs
export const HOUSE_RULES = [
  'HOUSE RULES (this repository):',
  '- You are the worker the runner dispatched. Never run scripts/vna/steer-runner.mjs or scripts/vna/steer.mjs — that starts another worker.',
  '- Nobody will answer a question — there is no user in this session. Never ask; decide, act, and end with the commit.',
  '- Before importing a name, confirm it is exported: `grep -n "export" <file>`. Never import a module or function you have not seen on disk.',
  '- Tests are ES modules run by `node --test <file>`: `import test from \'node:test\'; import assert from \'node:assert/strict\';` — never require(). A test under tests/vna/ imports \'./_hermetic.mjs\' first.',
  '- Import code by a relative path that exists (tests/vna/x.test.mjs → \'../../scripts/vna/<file>.mjs\'). If the module the row needs does not exist, create it in the same commit.',
  '- Only edit the files the row names or the guard you create. Never rewrite or delete an existing test file.',
  '- A test never runs git commit/reset/revert/checkout in this repository — if it needs git, it makes a scratch repo under os.tmpdir() with `git init`.',
  '- The guard fails before your change and passes after it: run `node --test <guard>` both times.',
  '- Never run a bare `git status` or `git diff`: this tree is shared with other workers and background daemons, and the listing is not your business. The state of YOUR files is below; check them with `git status -- <your files>`.',
].join('\n');
// C268 (U5) — THE WORKER SEES ONLY ITS OWN FILES (operator 2026-09-25, verbatim: "The model never executes a global git status. It is
// handed only the dirty state of its specific target files"). C261's worker ran `git status` first and poured ~190 daemon-dirty paths
// into its prefill. The host computes the scoped state instead: the files the row names (spec-clarity namedPaths) plus its guard,
// each with `git status --porcelain -- <file>` and a short `git diff -- <file>` — never a path the row does not name.
/** the brief's targets: the row's guard + every file it names + the code slot's file (C274 rolls back only these) */
export function briefTargets({ repo = REPO, row = '' } = {}) {
  const guard = (/\(guard:\s*`([^`]+)`/.exec(row) || [])[1] || null;
  let slot = null; try { slot = codeSlot({ repo, ask: row.replace(/^\s*-\s*\[[ xX]\]\s*C\d+[a-z]?\s*\(guard:[^)]*\)\s*/, '') }); } catch {}
  return [...new Set([...(guard && !/\s/.test(guard) ? [guard] : []), ...namedPaths(row), ...(slot ? [slot.file] : [])])].filter((f) => !/^data\/vna\/|^\.thetacog\//.test(f));
}
export function ownFilesBlock({ repo = REPO, row = '', maxDiffLines = 40, diffs = true } = {}) {
  const guard = (/\(guard:\s*`([^`]+)`/.exec(row) || [])[1] || null;
  const files = [...new Set([...(guard && !/\s/.test(guard) ? [guard] : []), ...namedPaths(row)])].filter((f) => !/^data\/vna\/|^\.thetacog\//.test(f));
  if (!files.length) return 'YOUR FILES: the row names none — create the guard it names, and only the files the work needs.';
  const lines = ['YOUR FILES (the only tree state you need — computed by the host at dispatch):'];
  for (const f of files) {
    const st = (tryGit(repo, 'status', '--porcelain', '--', f) || '').trim();
    const onDisk = existsSync(resolve(repo, f));
    lines.push(`- ${f} · ${!onDisk ? 'not on disk yet (you create it)' : st ? `uncommitted: ${st.slice(0, 2).trim()}` : 'clean'}`);
    if (diffs && st && onDisk) { const d = (tryGit(repo, 'diff', '--', f) || '').split('\n').slice(0, maxDiffLines).join('\n'); if (d.trim()) lines.push(d); }
  }
  return lines.join('\n');
}
// C269 (U6) — a CHANGE row's brief carries the code slot (code-slot.mjs): the file and a 40-line window the host found, with its source.
// A row the retriever finds nothing for says so — the worker is never told a location the host did not find.
export function codeSlotBlock({ repo = REPO, row = '', dial = null } = {}) {
  const sh = dialShape(dial);
  let s = null; try { s = codeSlot({ repo, window: sh.window, helpers: sh.helpers, ask: row.replace(/^\s*-\s*\[[ xX]\]\s*C\d+[a-z]?\s*\(guard:[^)]*\)\s*/, '') }); } catch { /* git grep unavailable — no slot */ }
  return ['', s ? s.text : 'THE CODE SLOT: the host found no file for this row — search narrowly (git grep -n <a word from the row> -- scripts src packages).'];
}
export function snowballText({ specPath, label, goalPath, repo, cap: capTokens = BUNDLE_TOKEN_CAP, dial = null }) {
  const row = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '').trim();
  const body = [`UNIT ${label} — land it as ONE commit whose subject names ${label}, with its guard under tests/ failing on the parent and passing at HEAD.`, '', HOUSE_RULES, '', 'THE ROW:', row, '', ownFilesBlock({ repo, row, diffs: dialShape(dial).diffs })].join('\n');   // C268 · C276
  const cap = capTokens * CHARS_PER_TOKEN; return body.length > cap ? body.slice(0, cap) + '\n[cut at the bundle cap]' : body;
}
// C269 — THE DISPATCH BRIEF = the contract (snowballText, exactly as C235's knobs tuned it and capped) + the code slot, bounded on its
// own (a 40-line window). The slot rides outside the cap so it never cuts the row's own text, and outside snowballText so the one-turn
// bench's variants stay byte-equal except their knob. enginePlan hands THIS to a worker; the bench renders the contract alone.
export function dispatchBrief(o) { const row = (readFileSync(o.specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${o.label}\\b`).test(l)) || '').trim(); return [snowballText(o), ...codeSlotBlock({ repo: o.repo || REPO, row, dial: o.dial || null })].join('\n'); }
// C186 (d): a RETRY carries the halt reason in its brief — the default preset's prompt becomes "continue — retry …", any other
// preset gets it as the snowball's last paragraph. Never a silent re-run of the identical brief that just halted. The halt may be
// the harness's (a signal, another room's commit) — the worker is told to fix it only if it names its own work.
// C242b: the halt reason is sliced at 600 chars as before; a dozen line behind it (" · the dozen dropped: …", steer-until.mjs) rides whole,
// so a long halt never cuts the pct, the construct or the ratchet line off the brief.
export const retryBrief = (label, reason) => { const s = String(reason); const i = s.indexOf(' · the dozen dropped:'); const halt = (i >= 0 ? s.slice(0, i) : s).slice(0, 600); const dz = i >= 0 ? s.slice(i) : ''; return `continue — this is the RETRY of ${label}: the previous dispatch HALTED with "${halt}${dz}". If that names something in your own work, fix it; if it names a signal or another room's commit, it was not yours. Then land ${label}.`; };

// ── C175 — THE WORKER WAITS FOR THE FOLD (bounded), AND A BRIEF THAT WOULD HAVE MISSED A RECENT PASTE NEVER SHIPS
// SILENT. Before this, the fold-lag reading (readLose(), the same one c176DispatchFields already receipts as
// treeAtTape/rowsBehind) was informational only — nothing waited on it and nothing changed the brief when it said
// the tree was behind. Now: FOLD_WAIT_MS bounded, FOLD_POLL_MS apart, the runner polls readLose() before ever
// building the brief. Still behind past the ceiling, the ledger rows that named THIS UNIT but never made it into
// the tree (unfoldedRowsForLabel — the exact tail readLose() counts, filtered to `\b<label>\b` in their own text)
// are handed to enginePlan and land in the brief VERBATIM — the default preset's `continue` argument, or the
// snowball's own last paragraph for any other preset. A wait is skipped only on a dry-run (nothing is dispatched,
// so nothing needs a fresh tree) or when no tree/ledger exists at all (readLose's own treeMissing — unmeasured,
// never gated).
export const FOLD_WAIT_MS = Number(process.env.VNA_FOLD_WAIT_MS || 8000);
export const FOLD_POLL_MS = Number(process.env.VNA_FOLD_POLL_MS || 500);
export function unfoldedRowsForLabel({ repo = REPO, label, treePath = resolve(repo, 'data/vna/spec-tree.json'), ledgerPath = resolve(repo, 'docs/specs/vna/amendments.ndjson') } = {}) {
  if (!label) return [];
  const L = readLose({ repo, tree: treePath, ledger: ledgerPath });
  if (L.treeMissing) return [];
  const re = new RegExp(`\\b${label}\\b`);
  const { rows } = ledgerTail(ledgerPath, { afterIndex: L.watermark, source: L.source });   // the exact tail readLose() counted
  return rows.filter((r) => typeof r.text === 'string' && re.test(r.text)).map((r) => ({ at: r.at, text: r.text }));
}
export async function awaitFold({ repo = REPO, label, treePath = resolve(repo, 'data/vna/spec-tree.json'), ledgerPath = resolve(repo, 'docs/specs/vna/amendments.ndjson'), waitMs = FOLD_WAIT_MS, pollMs = FOLD_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = Date.now();
  let L = readLose({ repo, tree: treePath, ledger: ledgerPath });
  while (!L.treeMissing && L.tapeRows > 0 && Date.now() - t0 < waitMs) {
    await sleep(Math.max(1, pollMs));
    L = readLose({ repo, tree: treePath, ledger: ledgerPath });
  }
  const treeAtTape = L.treeMissing ? null : L.tapeRows === 0;
  const unfolded = treeAtTape === false ? unfoldedRowsForLabel({ repo, label, treePath, ledgerPath }) : [];
  return { treeAtTape, rowsBehind: L.treeMissing ? null : L.tapeRows, waitedMs: Date.now() - t0, unfolded };
}
// the unfolded rows, verbatim, as one block a brief can carry — '' when there are none (never an empty heading)
export function foldCatchupBrief(label, rows) {
  if (!rows || !rows.length) return '';
  const body = rows.map((r) => `— ${r.at || 'unknown time'}: ${r.text}`).join('\n');
  return `\n\nFOLD CATCH-UP for ${label} — the spec tree is ${rows.length} paste${rows.length === 1 ? '' : 's'} behind the tape; these name ${label} but are not folded into the tree yet, verbatim:\n${body}\n`;
}
/** C218 — the instruction a tool-using local worker receives: do the row, write its guard, commit naming the row. */
export function localWorkOrder(label, snowPath, brief, nonce = null) {
  // C186x: the commit is attributed by the dispatch trailer, else by a head that opens with the row — the order says both
  const trailer = nonce ? ` -m "${dispatchTrailer(nonce)}"` : '';
  return [
    `You are a /steer worker in this git repository. Finish spec row ${label}. Its contract is below; the same text is saved read-only at ${snowPath} — read it if you need to, never write to it.`,
    `Do the work the contract names: edit or create the files it asks for, write the guard test it names and run it with node --test, then stage ONLY the files you changed (git add <paths>) and run git commit -m "<type>(vna): ${label} — <what you did>"${trailer}. The commit message must contain ${label} right after the "<type>(vna): " head${nonce ? `, and its second -m line must be exactly "${dispatchTrailer(nonce)}" — that trailer is how the runner knows the commit is yours` : ''}. Do not stop before that commit exists.`,
    `Never create files at the repository root — put them where the contract says, or under docs/ or tests/. Other workers share this git tree: if git add or git commit fails with "index.lock", wait 5 seconds and run the same command again (up to 5 times) — never delete the lock file.`,
    '', '--- CONTRACT ---', brief,
  ].join('\n');
}
export function enginePlan({ engine, claude, specPath, label, goalPath, repo, logDir, n, cap = BUNDLE_TOKEN_CAP, dial = null, retryReason = null, foldCatchup = [], dispatchId = null, floorsPath = undefined } = {}) {
  const cfg = engine || readEngineConfig(repo); const p = presetOf(cfg.preset) || presetOf(DEFAULT_PRESET);
  const catchup = foldCatchupBrief(label, foldCatchup);
  // C242b — a row whose text or cited paths name outward prose (a post, the newsletter, an invite, docs/comms) gets the dozen's
  // floors for that kind and the six-needs order AS AN INSTRUCTION up front, so the worker writes to them — fewer regressed turns
  // to repair is the token saving. A row naming no outward prose gets nothing; an unreadable spec gets nothing; never a throw.
  const dozenBlock = dozenBriefFor({ specPath, label, ...(floorsPath ? { floorsPath } : {}) });
  const dozen = dozenBlock ? `\n\n${dozenBlock}\n` : '';
  if (p.id === DEFAULT_PRESET) {
    const contArg = (retryReason ? retryBrief(label, retryReason) : 'continue') + dozen + catchup;
    const args = [...(contArg !== 'continue' ? WORKER_ARGS.map((a) => (a === 'continue' ? contArg : a)) : WORKER_ARGS), '--model', cfg.claudeModel || DEFAULT_CLAUDE_MODEL];   // C215: never the interactive default
    return { engine: engineName(cfg), preset: p.id, file: claude, args, display: `${claude} ${args.join(' ')}` };
  }
  const snow = resolve(logDir, `${n}-${label}.snowball.txt`); mkdirSync(dirname(snow), { recursive: true });
  try { chmodSync(snow, 0o644); } catch { /* first write */ }
  const brief = dispatchBrief({ specPath, label, goalPath, repo, cap, dial }) + dozen + (retryReason ? `\n\n${retryBrief(label, retryReason)}\n` : '') + catchup;
  writeFileSync(snow, brief);
  // C218 — THE LOCAL WORKER IS HANDED THE CONTRACT, NOT ITS FILENAME. {prompt} used to default to the snowball PATH: goose + qwen
  // received one line, ".thetacog/runner/1-C214.snowball.txt", read it as a file to write, and overwrote its own brief with
  // "Task content goes here" on both dispatches — no commit, STUCK. The prompt is now the brief itself under a work order that
  // names the commit; the file is made read-only so a worker can read it but never rewrite it (C213 hashes those bytes).
  try { chmodSync(snow, 0o444); } catch { /* best effort — the verdict's snowball proof still catches a rewrite */ }
  const prompt = localWorkOrder(label, snow, brief, dispatchId);
  const cmd = resolveEngineCommand(cfg, snow, { prompt });   // throws MISSING_SNOWBALL_PLACEHOLDER — the caller halts on it
  return { engine: engineName(cfg), preset: p.id, file: '/bin/sh', args: ['-c', cmd], display: cmd, snowball: snow, promptChars: prompt.length, local: p.local === true, model: p.local === true ? (cfg.subagentModel || null) : null };   // C235g: the sent-side estimate reads promptChars
}
export async function run({
  repo = REPO, goalPath = null, specPath = SPEC_MD, claude = 'claude', maxUnits = 1, dryRun = false, label = null,
  ndjson = NDJSON, logDir = LOG_DIR, fold = foldArgv(REPO), car = defaultCar, stamp = defaultStamp, waitCarMs = 120000,
  archivePaths = ARCHIVE_PATHS, allowUnmeasuredRed = false, quiet = false, scratchRoot = null, env = process.env, engine = null,
  cap = null, capRotate = null, sweepPath = SWEEP_PATH, meterBudget = process.env.VNA_BUDGET_METER === '1', retryReason = null,
  treePath = null, ledgerPath = null, walkTape = null, pidDir = PID_DIR, force = false, dial = null, dialBy = null,
} = {}) {
  goalPath ||= process.env.VNA_GOAL || resolve(repo, 'data/vna/goal.json');
  scratchRoot ||= process.env.CLAUDE_SCRATCHPAD_DIR || resolve(logDir, 'scratch');
  const say = (s) => { if (!quiet) console.log(s); };
  const out = { halted: false, reason: null, dispatched: 0, dispatches: [], planned: [], exitCode: 0 };
  const halt = (reason, extra = {}) => { out.halted = true; out.reason = reason; out.exitCode = 2; record(ndjson, { kind: 'halt', reason, ...extra }); say(`HALT — ${reason}`); return out; };
  const eng0 = engine || readEngineConfig(repo);
  record(ndjson, { kind: 'run', repo, maxUnits, dryRun, label, claude, engine: engineName(eng0), preset: eng0.preset, headAt: tryGit(repo, 'rev-parse', 'HEAD') });
  // C168g — A DISPATCH ENGINE MUST BE AN AGENT THAT CAN COMMIT. Before any unit is even read, refuse a chat-only preset
  // (ollama-local: a bare `ollama run` with no tools, can never move HEAD) — never a wasted plan, never a snowball
  // written, never a spawn attempted. goose-local is the local dispatch path (tools via the `developer` extension).
  if (!canDispatch(eng0.preset)) return halt(`DISPATCH_ENGINE_CANNOT_COMMIT: ${eng0.preset} is a bare model with no tools — it can never move HEAD (gate one) and is never dispatched; it stays the chat engine only. Pick goose-local (local) or claude-code-headless (cloud) on ${ENGINE_KEYS_LABEL}.`, { engine: engineName(eng0), preset: eng0.preset });
  for (let n = 1; n <= maxUnits; n++) {
    const u = nextUnit({ goalPath, specPath, repo, label, skip: new Set(out.planned.map((x) => x.label)) });
    if (u.error) return halt(u.error);
    if (u.done) { record(ndjson, { kind: 'done', why: 'every unit closed' }); say('every goal unit is closed — nothing to dispatch'); break; }
    // C191 — a halt the worker did not cause is re-graded, never re-paid: a RETRY of a named row calls --regrade FIRST.
    // If the commit already landed for this label now grades clean (a machine-side halt — the CAR caught up, the fold was
    // fixed), the unit is done at $0 and no worker is dispatched. If it still fails on a gate that is the WORKER's own
    // doing, the paid retry proceeds below as before. If it still fails on a MACHINE-side gate, a fresh worker could not
    // fix it either, so the runner halts with the regrade's own reason instead of paying to repeat a halt it cannot cure.
    if (n === 1 && retryReason && u.label && !dryRun) {
      const rg = await regrade({ repo, label: u.label, ndjson, logDir, archivePaths, scratchRoot, allowUnmeasuredRed, fold, car, stamp, waitCarMs, quiet: true });
      if (rg.sha) {
        if (rg.ok) { out.regraded = { label: u.label, sha: rg.sha, cost_usd: 0 }; record(ndjson, { kind: 'done', why: `${u.label} re-graded ok at $0 — the halt was not the worker's fault`, label: u.label, sha: rg.sha }); say(`✓ regrade · ${u.label} · ${rg.sha.slice(0, 10)} · re-graded at $0, never re-paid`); return out; }
        if (rg.workerCaused === false) return halt(`regrade of ${u.label} still fails on a non-worker gate (${rg.failingGate}): ${rg.reason} — a paid retry would not fix this`, { n, label: u.label, regraded: true, workerCaused: false, failingGate: rg.failingGate });
        say(`regrade of ${u.label} still fails on a worker-caused gate (${rg.failingGate || '?'}): ${rg.reason} — dispatching the paid retry`);
      }
    }
    // C192(a) — a label whose runner ledger already carries a verdict-ok row is never dispatched again without --force
    // (C157 / C93k were each paid twice: the spec's own checkbox and the ledger's verdict-ok row can disagree in the
    // window before a worker's tick lands, so the ledger is checked independently of nextUnit's tick-based filter above).
    if (!force && u.label && labelAlreadyVerdictOk(ndjson, u.label)) {
      return halt(`${u.label} already has a verdict-ok row on the runner ledger — refusing a second paid dispatch without --force`, { n, label: u.label, verdictOk: true });
    }
    // C93n — THE BUDGET GATE: a goal that crossed its max halts here, before a plan or a spawn, and the overrun is on the row
    if (!label) { const st = goalStatus({ path: goalPath, repo, md: readFileSync(specPath, 'utf8'), write: false }); const bg = budgetGate(st); if (bg.halt) { if (!meterBudget) return halt(bg.line, { n, label: u.label, over_by: bg.over_by, used: st.turns.used, max: st.turns.max }); record(ndjson, { kind: 'meter', n, label: u.label, over_by: bg.over_by, used: st.turns.used, max: st.turns.max, line: bg.line }); say(`METER — ${bg.line} (C186: /steer meters the budget, never halts on it)`); } }
    const head0 = tryGit(repo, 'rev-parse', 'HEAD');
    // C79e — the lane, before the dispatch: in lane advances, drift pauses (the card's two actions resume), unmeasured says so
    const lane = laneCheck({ treePath: resolve(repo, 'data/vna/spec-tree.json'), previewPath: resolve(repo, 'data/vna/cockpit-preview.json'), label: u.label, headAt: tryGit(repo, 'log', '-1', '--format=%cI') });
    if (lane.state === 'PAUSE') { out.paused = true; out.reason = lane.why; out.exitCode = 3; record(ndjson, { kind: 'pause', n, label: u.label, workPixel: lane.workPixel, basinPixel: lane.basinPixel, d: lane.d, ours: lane.ours || null, foreign: lane.foreign || null, why: lane.why }); say(`PAUSE — ${lane.why} · 📝 Auto-Amend Spec Basin or ↩️ Revert Drift Changes on the card, then run again`); return out; }
    if (lane.state === 'UNMEASURED') { out.reason = lane.why; out.exitCode = 3; record(ndjson, { kind: 'lane', state: 'UNMEASURED', n, label: u.label, why: lane.why }); say(`LANE UNMEASURED — ${lane.why}`); return out; }
    const log = resolve(logDir, `${n}-${u.label}.log`);
    let knob = null; try { knob = settingFor({ label: u.label, aperture: apertureVersion() }); } catch {}
    const cp = capFor({ cap, capRotate, n, sweepPath, knob });
    const tp = treePath || resolve(repo, 'data/vna/spec-tree.json'); const lp = ledgerPath || resolve(repo, 'docs/specs/vna/amendments.ndjson');
    // C175 — wait for the fold (bounded), never on a dry-run: still behind past the ceiling, the unfolded rows that
    // name this unit go into the brief itself, not just onto the receipt.
    let af = { treeAtTape: null, rowsBehind: null, waitedMs: 0, unfolded: [] };
    try { af = await awaitFold({ repo, label: u.label, treePath: tp, ledgerPath: lp, waitMs: dryRun ? 0 : FOLD_WAIT_MS }); } catch (e) { af.why = String(e.message).slice(0, 120); }
    const dispatchId = mintDispatchId();   // C186x: this dispatch's nonce — the worker's commit carries it as the Steer-Dispatch trailer
    // C270 (U7) — A MECHANICAL ROW GETS A HOST-WRITTEN RED WITNESS BEFORE THE WORKER WAKES; one already green is never dispatched
    let witness = null;
    if (!isDryRun(dryRun)) {
      const rowLine = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${u.label}\\b`).test(l)) || '');
      witness = prepareWitness({ repo, row: rowLine, label: u.label });
      if (witness.mechanical) record(ndjson, { kind: 'witness', label: u.label, n, state: witness.state, wrote: witness.wrote, witness_kind: witness.kind || null, guard: witness.guard || null, why: witness.why });
      if (witness.refuse) return halt(`WITNESS: ${witness.why} — not dispatched (C270)`, { n, label: u.label, verdict: 'STUCK', witness: witness.state });
    }
    let ep; try { ep = enginePlan({ engine: eng0, claude, specPath, label: u.label, goalPath, repo, logDir, n, cap: cp.cap, retryReason: n === 1 ? retryReason : null, dial: n === 1 ? dial : null, foldCatchup: af.unfolded, dispatchId }); } catch (e) { return halt(String(e.message), { n, label: u.label, engine: engineName(eng0), verdict: 'HALTED' }); }
    const plan = { n, label: u.label, unit: u.n, of: u.of, title: u.title, head0, dispatch_id: dispatchId, engine: ep.engine, preset: ep.preset, cap: cp.cap, cap_source: cp.source, foldWaitMs: af.waitedMs, foldRowsInBrief: af.unfolded.length,
      snowball: { ...(knob || { knob_v: null, knob_why: 'snowball-knob.mjs threw' }), cap: cp.cap, cap_source: cp.source, path: ep.snowball || null } };
    // C176 L2: the brief-time half of the read=write relation rides the dispatch row (and so the verdict row that spreads it)
    try { Object.assign(plan, await c176DispatchFields({ repo, label: u.label, cap: cp.cap, preset: ep.preset, treePath: tp, ledgerPath: lp })); } catch (e) { plan.c176_why = String(e.message).slice(0, 120); }
    // C213 — every dispatch names {engine, leaf, snowball_sha, tree_root}: engine is ep.engine (already on plan), tree_root
    // is the treeRoot c176DispatchFields just set (found, never duplicated) — leaf and snowball_sha are new.
    Object.assign(plan, c213DispatchFields({ label: u.label, ep, readSet: plan.read_set }));
    if (dryRun) { out.planned.push(plan); record(ndjson, { kind: 'dry-run', ...plan }); say(`dry-run · dispatch ${n} → ${u.label} (${u.title}) at HEAD ${String(head0).slice(0, 10)} · would spawn ${ep.display}`); continue; }
    // C235i — a local brief that will not fit the window in force is HELD, named, never sent to be cut (the cut drops the tools first)
    if (ep.local) { const cf = await contextFits({ promptChars: ep.promptChars ?? 0, model: ep.model }); plan.context_fit = cf; if (cf.fits === false) return halt(`BRIEF_OVER_CONTEXT: ${u.label}'s request is ~${cf.est} tokens, the window in force is ${cf.ctx} (${cf.source}) — held, not sent: a cut request loses its tools and instructions (C235i)`, { n, label: u.label, verdict: 'STUCK', context_fit: cf }); }
    record(ndjson, { kind: 'dispatch', ...plan, log });
    // C276 — a retry names its dial and the brief it replaced: every retry is an A/B pair on the ledger
    // C315 — dial_by (gemma | rotation) rides the same row: null only when the caller never said (a row from before
    // this field existed, or a bare CLI invocation) — the impasse ledger reads that as 'none', never a guess
    if (dial && n === 1) { const prevD = readNd(ndjson).filter((r) => r.kind === 'dispatch' && r.label === u.label && r.dispatch_id !== dispatchId).pop(); record(ndjson, { kind: 'retry-dial', label: u.label, dial, dial_by: dialBy || null, before_sha: prevD ? prevD.snowball_sha || null : null, after_sha: plan.snowball_sha || null, reason: retryReason ? String(retryReason).slice(0, 200) : null }); }
    // C274 (U11) — the tree state of the brief's targets at dispatch; any halt below rolls the worker's debris back from it
    const rowNow = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${u.label}\\b`).test(l)) || '');
    const snap = snapshot({ repo, targets: briefTargets({ repo, row: rowNow }) });
    const haltRB = async (reason, extra) => { const rb = await rollback({ repo, snap, nonce: dispatchId, scaffolded: witness && witness.wrote ? witness.guard : null }); record(ndjson, { kind: 'rollback', label: u.label, n, ...rb }); return halt(`${reason} · ${rollbackLine(rb)}`, { ...extra, rollback: rb }); };
    say(`dispatch ${n} → ${u.label} · ${u.title} · worker ${ep.engine} · log ${log}`);
    const we = workerEnv(env, n, u.label, log, cp.cap, null, dispatchId); Object.assign(plan, we.provenance);
    // C287 — a LOCAL dispatch is a model job: it waits (bounded) for and holds the heavy lock for the worker's life only, never beside
    // the guard suite or a bench. The lock sits under THIS run's repo, so a fixture repo's run never contends with the live machine's.
    const hvPath = process.env.VNA_HEAVY_LOCK || resolve(repo, '.thetacog/heavy.lock'); const HL = ep.local ? await import('./heavy-lock.mjs') : null;
    const hv = ep.local ? await HL.waitForHeavy({ job: `steer-runner ${u.label} (local)`, path: hvPath, say }) : null;
    if (hv && !hv.ok) return haltRB(`HEAVY_LOCK_HELD: ${u.label} not dispatched — ${HL.holderLine(hv.holder)} holds the heavy lock (waited ${Math.round(hv.waited_ms / 1000)} s); one heavy job at a time on local metal (C287)`, { n, label: u.label, verdict: 'HALTED' });
    const at0 = nowIso();
    let w; try { w = await runWorker({ claude: ep.file, args: ep.args, cwd: repo, env: we.env, log, quiet, label: u.label, pidDir, dryRun, quietMs: quietLimitFor(ep), stillWorking: ep.local ? (pg) => generatingFor(pg) : null, hardMs: ep.local ? LOCAL_WORKER_HARD_MS : null }); }
    finally { if (hv && hv.ok && !hv.nested) HL.releaseHeavy({ path: hvPath }); }
    out.dispatched++;
    // C235g — the context this LOCAL dispatch ran under: sent vs evaluated vs in force, off the ollama log tail, goose's usage
    // ledger and /api/ps (bounded, never a model call). A cloud engine gets no fields. Never throws: an unreadable source is UNKNOWN.
    let ctx = null; if (ep.local) { try { ctx = await dispatchContext({ engine: ep.engine, local: true, at0, at1: nowIso(), promptChars: ep.promptChars ?? null, repo }); } catch (e) { ctx = { context_verdict: 'UNKNOWN', context_why: `dispatch-context threw: ${String(e.message).slice(0, 120)}` }; } }
    const ctxExtra = ctx && ctx.context_verdict ? { context_verdict: ctx.context_verdict } : {};
    let gooseT = null; if (ep.local) { try { gooseT = gooseTurns({ workingDir: repo, since: at0 }); } catch {} }   // C275b: a thinking-only last turn is named on the row
    // C166: exit 127 / ENOENT is a missing engine — a HALT with the binary named, never UNMEASURED, never green
    const mb = missingBinary({ exit: w.exit, spawnError: w.spawnError, stderr: w.stderr, cmd: ep.display });
    if (mb.missing) { record(ndjson, { kind: 'worker', ...plan, exit: w.exit, ms: w.ms, missing_binary: mb.binary, cost_usd: 0, cost_source: 'never-started', verdict: 'HALTED' }); return halt(`ENGINE_BINARY_MISSING: ${mb.binary} — the ${ep.preset} engine could not start (exit ${w.exit}); install it or pick another preset on ${ENGINE_KEYS_LABEL}`, { n, label: u.label, engine: ep.engine, missing_binary: mb.binary, verdict: 'HALTED' }); }
    const d = { ...plan, exit: w.exit, ms: w.ms, alive: w.alive || null, goose_turns: gooseT, usage: w.result && w.result.usage || null, ...costOf(w, ep.preset), num_turns: w.result && w.result.num_turns || null, gates: {}, ...sweepFields(w), ...(ctx || {}) };
    out.dispatches.push(d);
    if (w.quietKilled) { const qk = await onQuietKilled({ ep }); Object.assign(d, qk); record(ndjson, { kind: 'worker', ...d, quiet_killed: w.quietKilled }); learnRow(ndjson, d, log, `quiet ${Math.round(w.quietKilled.quiet_ms / 60000)} min — ended by the C255 watchdog`, true); return haltRB(`worker quiet ${Math.round(w.quietKilled.quiet_ms / 60000)} min on dispatch ${n} (${u.label}) — ended by the watchdog (C255) · STUCK (timeout)${qk.model_unloaded ? ` · ⏏ ${qk.model_unloaded} unloaded (C256)` : ep.local ? ` · model not unloaded: ${qk.unload_why || 'no model named'}` : ''}; the slot moves on`, { n, label: u.label, verdict: 'STUCK', ...ctxExtra }); }
    if (w.exit !== 0) { record(ndjson, { kind: 'worker', ...d }); return haltRB(`worker exit ${w.exit} on dispatch ${n} (${u.label})${w.spawnError ? ` — ${w.spawnError}` : ''}`, { n, label: u.label, ...ctxExtra }); }
    const head1 = tryGit(repo, 'rev-parse', 'HEAD'); d.head1 = head1; d.headMoved = head1 !== head0;
    if (!d.headMoved) { record(ndjson, { kind: 'worker', ...d }); learnRow(ndjson, d, log, 'HEAD did not move — no commit', true); return haltRB(`HEAD did not move on dispatch ${n} (${u.label}) — the worker exited 0 without a commit${gooseT && gooseT.ended_thinking_only ? ' · THINKING_ONLY — the last turn was all reasoning: no text, no tool call (D2)' : ''}${d.context_verdict === 'UNMEASURED' ? ` · UNMEASURED: ${d.context_why}` : ''}`, { n, label: u.label, ...ctxExtra }); }
    const g = await gradeCommit({ repo, head0, head1, label: u.label, nonce: dispatchId, archivePaths, scratchRoot, allowUnmeasuredRed, fold, car, waitCarMs });
    Object.assign(d, g.d);
    if (!g.ok) { record(ndjson, { kind: 'worker', ...d }); learnRow(ndjson, d, log, g.reason, gateIsWorkerCaused(g.d).worker); return haltRB(`${g.reason}${d.context_verdict === 'UNMEASURED' ? ` · UNMEASURED: ${d.context_why}` : ''}`, { n, label: u.label, ...ctxExtra }); }
    d.ticked = 1; Object.assign(d, c176VerdictFields({ repo, work: d.work, write_pixel: d.write_pixel, write_walk: d.write_walk, walkTape: walkTape || process.env.PMU_WALK_TAPE || resolve(repo, '.thetacog/walk-tape.ndjson') }));
    // C213 — RE-DERIVE, never carry the dispatch-time value forward: the sidecar is re-read off disk (a worker or a
    // later step may have edited or deleted it) and the tree root is looked up on spec-tree-roots.ndjson — the durable
    // fold log, not the live (now post-commit) tree. Either mismatch reads UNMEASURED, never a silent pass.
    Object.assign(d, c213VerdictFields({ snowball_sha: d.snowball_sha, snowball_sha_source: d.snowball_sha_source, snowball_path: (d.snowball && d.snowball.path) || null, readSet: d.read_set, treeRoot: d.treeRoot, rootsPath: process.env.VNA_SPEC_TREE_ROOTS || resolve(repo, 'data/vna/spec-tree-roots.ndjson') }));
    record(ndjson, { kind: 'verdict', ok: true, ...d });
    // C92e — the labour block rides the tape only once the verdict row it reads exists; the stamp row says what landed, or why not
    if (stamp) { const st = await stamp({ sha: d.work, ndjson }); record(ndjson, { kind: 'labour', sha: d.work, label: u.label, ok: st.ok, appended: st.appended, why: st.why || null, stamp: st.stamp || null }); }
    say(`✓ dispatch ${n} · ${u.label} · ${d.work.slice(0, 10)} · worker ${(w.ms / 1000).toFixed(1)} s · red ${d.gates.redWitness} · green · fold ${d.foldMs} ms · CAR complete${d.usage ? ` · tokens in ${d.usage.input_tokens ?? '?'} cache ${d.usage.cache_read_input_tokens ?? '?'} out ${d.usage.output_tokens ?? '?'}` : ''}${d.cost_usd != null ? ` · ${d.cost_usd}` : ''}`);
    if (label) break;   // a named row is one dispatch
  }
  if (!out.halted) record(ndjson, { kind: 'done', dispatched: out.dispatched });
  return out;
}

// ── C107d TRIAGE IS A DOOR THE RUNNER DISPATCHES. `--triage [--limit N] [--dry-run]`: the brief comes from `spec-check.mjs triage --json`
// (the deterministic classes are the SCRIPT's and are applied by `--apply`, never by a model); ONE cold worker gets the residue as its
// prompt and the two doors as its only tools. After it exits the runner reads ONLY decidable facts: exit 0 · every new pending-dismiss
// row on the ledger names an id from the brief · every line the spec gained carries `from pending <id>` with an id from the brief and
// the spec lost no line · the residue count fell. Any false → HALT with the reason on .thetacog/runner.ndjson. The runner commits
// nothing: the ledger rows and the declared rows sit in the tree for the chair's own commit (their message is the receipt).
export function triageFacts({ brief, ledgerBefore, ledgerAfter, specBefore, specAfter, residueBefore, residueAfter, exit }) {
  const ids = new Set((brief.match(/^── (P\d+\.\d+) ·/gm) || []).map((m) => m.slice(3).split(' ')[0]));
  const newRows = ledgerAfter.slice(ledgerBefore.length).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.kind === 'pending-dismiss');
  const strayDismiss = newRows.filter((r) => !ids.has(r.pending)).map((r) => r.pending);
  const b = specBefore.split('\n'), a = specAfter.split('\n');
  const lost = b.filter((l) => !a.includes(l)); const gained = a.filter((l) => !b.includes(l));
  const strayRows = gained.filter((l) => { const m = /from pending (P\d+\.\d+)\)/.exec(l); return !m || !ids.has(m[1]); });
  const gates = { exit0: exit === 0, dismissInBrief: strayDismiss.length === 0, declaresInBrief: strayRows.length === 0 && lost.length === 0, residueFell: residueAfter < residueBefore };
  const reason = !gates.exit0 ? `worker exit ${exit}` : !gates.dismissInBrief ? `dismissed outside the brief: ${strayDismiss.join(' ')}` : !gates.declaresInBrief ? (lost.length ? `the spec lost ${lost.length} line(s) — the worker edited by hand` : `the spec gained a line not stamped from the brief: ${strayRows[0].slice(0, 80)}`) : !gates.residueFell ? `residue did not fall (${residueBefore} → ${residueAfter})` : null;
  return { ok: !reason, reason, gates, dismissed: newRows.length, declared: gained.length - strayRows.length, ids: [...ids] };
}
export async function triage({ repo = REPO, claude = 'claude', ndjson = NDJSON, logDir = LOG_DIR, dryRun = false, quiet = false, env = process.env, limit = null, specPath = SPEC_MD } = {}) {
  const say = (s) => { if (!quiet) console.log(s); };
  const ledgerPath = process.env.VNA_AMEND_LEDGER || resolve(repo, 'docs/specs/vna/amendments.ndjson');
  const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
  const triageJson = () => { const r = execFileSync(process.execPath, [resolve(repo, 'scripts/vna/spec-check.mjs'), 'triage', '--json', ...(limit ? ['--limit', String(limit)] : [])], { cwd: repo, encoding: 'utf8', env, maxBuffer: 1 << 26 }); return JSON.parse(r.trim().split('\n').pop()); };
  const halt = (reason, extra = {}) => { record(ndjson, { kind: 'halt', label: 'C107-triage', reason, ...extra }); say(`HALT — ${reason}`); return { ok: false, halted: true, reason, exitCode: 2 }; };
  let T0; try { T0 = triageJson(); } catch (e) { return halt(`triage could not read the tree — ${String(e.message).slice(0, 120)}`); }
  record(ndjson, { kind: 'run', label: 'C107-triage', repo, dryRun, claude, headAt: tryGit(repo, 'rev-parse', 'HEAD'), pending: T0.pending, held: T0.held, residue: T0.residue });
  if (!T0.residue) { record(ndjson, { kind: 'done', label: 'C107-triage', why: 'no residue — nothing for a worker' }); say('triage: no residue — nothing to dispatch'); return { ok: true, dispatched: 0, residue: 0, exitCode: 0 }; }
  const log = resolve(logDir, `triage-${Date.now()}.log`);
  if (dryRun) { record(ndjson, { kind: 'dry-run', label: 'C107-triage', residue: T0.residue, log }); say(`dry-run · triage → ${T0.residue} residue · would spawn ${claude} -p <brief ${T0.brief.length} chars> --allowedTools ${TRIAGE_TOOLS.join(' ')}`); return { ok: true, dryRun: true, residue: T0.residue, brief: T0.brief, exitCode: 0 }; }
  const ledgerBefore = read(ledgerPath), specBefore = read(specPath);
  record(ndjson, { kind: 'dispatch', label: 'C107-triage', residue: T0.residue, log, tools: TRIAGE_TOOLS });
  say(`dispatch · triage → ${T0.residue} residue · worker ${claude} · log ${log}`);
  const we = workerEnv(env, 0, 'C107-triage', log);
  const w = await runWorker({ claude, cwd: repo, env: we.env, log, quiet, args: WORKER_ARGS_TRIAGE(T0.brief), label: 'C107-triage', dryRun });
  let T1 = null; try { T1 = triageJson(); } catch {}
  const f = triageFacts({ brief: T0.brief, ledgerBefore, ledgerAfter: read(ledgerPath), specBefore, specAfter: read(specPath), residueBefore: T0.residue, residueAfter: T1 ? T1.residue : T0.residue, exit: w.exit });
  const d = { label: 'C107-triage', preset: DEFAULT_PRESET, ...we.provenance, exit: w.exit, ms: w.ms, usage: w.result && w.result.usage || null, ...costOf(w, DEFAULT_PRESET), num_turns: w.result && w.result.num_turns || null, gates: f.gates, dismissed: f.dismissed, declared: f.declared, residueBefore: T0.residue, residueAfter: T1 ? T1.residue : null };
  if (!f.ok) { record(ndjson, { kind: 'worker', ...d }); return halt(f.reason, d); }
  record(ndjson, { kind: 'verdict', ok: true, ...d });
  say(`✓ triage · ${f.dismissed} dismissed · ${f.declared} declared · residue ${T0.residue} → ${d.residueAfter} · worker ${(w.ms / 1000).toFixed(1)} s — the ledger and the spec are in the working tree for the chair's commit`);
  return { ok: true, dispatched: 1, ...d, exitCode: 0 };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const maxUnits = Number(arg('--max-units') || arg('--max-turns') || 1);   // --max-turns kept as an alias: it caps DISPATCHES, never the worker's turns
  const stop = () => { const c = runWorker.active; if (c && c.pid) { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch {} } record(NDJSON, { kind: 'abort', pid: c.pid, by: 'signal' }); } process.exit(130); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  // C197 — `--stop [<label>|all]`: end a running worker FROM A SEPARATE INVOCATION (no shared module state with the
  // process that's still running it). Omitted argument (or "all") stops everything the pid dir knows about.
  if (argv.includes('--stop')) { const i = argv.indexOf('--stop'); const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; const rs = await stopWorkers({ label: val, quiet: argv.includes('--json') }); if (argv.includes('--json')) console.log(JSON.stringify(rs)); process.exit(rs.exitCode); }
  if (argv.includes('--triage')) { const t = await triage({ dryRun: argv.includes('--dry-run'), claude: arg('--claude') || 'claude', quiet: argv.includes('--json'), limit: arg('--limit') ? Number(arg('--limit')) : null }); if (argv.includes('--json')) console.log(JSON.stringify(t)); process.exit(t.exitCode); }
  if (arg('--audit')) { const a = await audit({ sha: arg('--audit'), label: arg('--label'), allowUnmeasuredRed: argv.includes('--allow-unmeasured-red'), quiet: argv.includes('--json') }); if (argv.includes('--json')) console.log(JSON.stringify(a)); process.exit(a.ok ? 0 : 2); }
  // C191 — `--regrade <label>`: re-run the six gates over the commit already landed for that label, at $0, no worker spawned
  if (arg('--regrade')) { const rg = await regrade({ label: arg('--regrade'), quiet: argv.includes('--json') }); if (argv.includes('--json')) console.log(JSON.stringify(rg)); process.exit(rg.exitCode); }
  const capArg = arg('--cap') ? Number(arg('--cap')) : null; const capRotate = arg('--cap-rotate') ? arg('--cap-rotate').split(',').map(Number).filter((x) => Number.isFinite(x) && x > 0) : null;
  if (capArg != null && !(capArg >= 500 && capArg <= 16000)) { console.error(`--cap ${arg('--cap')}: must be 500–16000 tokens`); process.exit(2); }
  const r = await run({ maxUnits, cap: capArg, capRotate, meterBudget: argv.includes('--meter-budget') || process.env.VNA_BUDGET_METER === '1', retryReason: arg('--retry-reason'), dial: arg('--dial'), dialBy: arg('--dial-by'), dryRun: argv.includes('--dry-run'), label: arg('--label'), claude: arg('--claude') || 'claude', allowUnmeasuredRed: argv.includes('--allow-unmeasured-red'), quiet: argv.includes('--json'), force: argv.includes('--force') });
  if (argv.includes('--json')) console.log(JSON.stringify(r));
  process.exit(r.exitCode);
}
