#!/usr/bin/env node
// scripts/vna/return-reading.mjs — C612i: THE READING RETURNS TO THE ACTOR MID-ROUND. LLM-FREE.
//
// Operator 2026-10-03 (/steer paste): "Currently, the system is an open-loop observer … it does not proactively redirect the
// actor". C612g re-reads the worker's diff on the run and appends to the round sidecar; nothing put that reading back in front of
// the worker. This is the PostToolUse half: after an Edit / Write / MultiEdit / NotebookEdit, the just-changed TRACKED path is
// placed by C612g's own fast tier (conscience-watch.mjs fastPlace — inside = under a path the note names), and ONLY when the set of
// paths outside the note (or the rules bound to them) changed, the hook returns `additionalContext`: the path entered, the rules
// bound to it, and the note's named paths. Silent otherwise.
//
// A READING, NEVER A GATE. The tool call already happened. This module never emits a decision field (no block, no deny, no
// "continue": false), always exits 0, never writes to the path that was edited, and swallows every failure into silence. The text
// carries the house verbs (detected · placed) and no imperative — the halt is the buyer's to wire.
//
// WHERE THE ROUND COMES FROM (the claude -p door): the runner exports VNA_RUNNER_LOG = <dir>/<n>-<label>.log, VNA_RUNNER_LABEL
// and VNA_RUNNER_DISPATCH to the worker; the hook's env inherits them. The note's named paths are the runner's
// <n>-<label>.round-named.json (round-sidecar.mjs roundNamedPath — the brief's targets ∪ the fast note's files, the same set C612g
// watches against). No round file → silent: the operator's interactive session never sees a line. VNA_RETURN_READING=0 → silent.
// THE CHAT DOOR is not wired yet: `steer.mjs brief` writes no round file, so a chat subagent's write stays silent until it does
// (the swap point is roundOf below — one more source of { dir, label, n }).
//
// BOUND RULES (C612h): when scripts/vna/path-prediction.mjs exports boundInvariants(paths, sha, { repo }) — C612h's narrowed
// bindings read at the immutable commit — that is the binder. Until it lands, the binder is C612g's rulesOf (rules-for.mjs: the
// file's @guard lines + the CLAUDE.md sections naming the path). THE SWAP POINT is binderFor() below; the reading names which one
// ran. The binding never runs inside the write's latency: boundInvariants is a git grep at HEAD over tests/ (~2 s measured on this
// repo, 2026-10-03), so a newly entered path is bound by a DETACHED job and the bound rules arrive as the NEXT reading ("the bound
// rules changed"), once per path per round. C612j's in-RAM reflex returns them inline and retires the detached job.
//
// SINGLE-FLIGHT: one hook at a time per round (an O_EXCL lock beside the sidecar). A call that meets a live lock appends its path
// to the round's pending list and returns silent; the holder (or the next call) places the pending paths with its own, so a
// path entered under contention still reaches the actor on the next write.
//
// SUFFICIENT FOR: which tracked paths the round has entered outside the note, and the rules bound to them, at write time.
// NOT SUFFICIENT FOR: whether entering them was wrong, or whether the work was good (Rice).
//
// C612j WIRED (follow-up, fa7a8c1071): crateReflex() reads the C612h guard leg at HEAD (one git grep, overlapped with the tracked
// check) and sends the hunk to the --door-serve daemon through --relay (80 ms deadline): the bound guards, with their ncd, arrive in
// the SAME call. Relay exit 3 (no daemon) / 4 (deadline) / any failure → the one-write-late path above. The rule and ceiling legs
// still come from the detached job. Measured 2026-10-03 (load ~27): per write median 111.8 ms [44.6, 222.4] n 30; outside first
// entry median 161.5 ms [127.7, 222.4] n 15 — the git grep at HEAD (~90 ms) is the cost.
// Rust port row: C612i-importers — the guard leg's importer lookup moves into --door-serve (it already holds every tests/ blob at
// HEAD in RAM), retiring the git grep; node keeps the hook's stdin/stdout transport.
//
// @guard tests/vna/c612i-the-reading-returns-to-the-actor.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, openSync, closeSync, unlinkSync, statSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join, basename } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { fastPlace, rulesOf, IGNORE_RE, costLine } from './conscience-watch.mjs';
import { roundSidecarPath, roundNamedPath } from './round-sidecar.mjs';
import { relayAsync } from './crate-call.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const KIND_RETURN = 'return-reading (C612i)';
export const TOOLS = Object.freeze(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const BUDGET_MS = 150;
export const LOCK_STALE_MS = 5000;
export const NAMED_SHOWN = 12;
export const SUFFICIENT_FOR = 'which tracked paths the round has entered outside the note, and the rules bound to them, at write time';
export const NOT_SUFFICIENT_FOR = 'whether entering them was wrong, or whether the work was good (Rice)';

const norm = (p) => String(p || '').replace(/^\.\//, '').replace(/\/+$/, '');
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

/**
 * canonPath — C656a: resolve a path through EVERY symlink so two spellings of the same directory (Claude Code's
 * resolved /private/var/… vs the round's staged /var/… on macOS, where /var is itself a symlink) land on the same
 * string before relative() compares them. realpathSync throws on a path that does not exist yet (a Write about to
 * CREATE a file): walk up to the nearest existing ancestor, realpath THAT, then rejoin the not-yet-written tail.
 */
export function canonPath(p) {
  const abs = resolve(String(p || ''));
  if (existsSync(abs)) return realpathSync(abs);
  const tail = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;   // reached the filesystem root with nothing existing: give up, unresolved
    tail.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...tail);
}

/** The round named paths file, written by the runner before the worker spawns (one JSON object). */
export function writeRoundNamed({ dir, label, n = null, named = [], repo = REPO }) {
  const p = roundNamedPath({ dir, label, n });
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ v: 1, label, n, repo, named: [...new Set(named.map(norm).filter(Boolean))].sort(), at: new Date().toISOString() }) + '\n');
  return p;
}

/** The active round for this hook, or null (→ silent). THE CHAT-DOOR SWAP POINT: a second source of { dir, label, n } goes here. */
export function roundOf(env = process.env) {
  if (env.VNA_RETURN_READING === '0') return null;
  const log = env.VNA_RUNNER_LOG, label = env.VNA_RUNNER_LABEL;
  if (!log || !label) return null;
  const n = env.VNA_RUNNER_DISPATCH != null && env.VNA_RUNNER_DISPATCH !== '' ? Number(env.VNA_RUNNER_DISPATCH) : null;
  const dir = dirname(log);
  const namedFile = roundNamedPath({ dir, label, n });
  const doc = readJson(namedFile, null);
  if (!doc || !Array.isArray(doc.named)) return null;
  const sidecar = roundSidecarPath({ dir, label, n });
  const stem = sidecar.replace(/\.round\.ndjson$/, '');
  const repo = canonPath(doc.repo || REPO);   // C656a: canon once here so every reader of round.repo (isTracked, crateReflex, startBind) agrees
  return { dir, label, n, repo, named: doc.named, sidecar, state: `${stem}.c612i.json`, bound: `${stem}.c612i.bound.ndjson`, bindLock: `${stem}.c612i.bind.lock`, lock: `${stem}.c612i.lock`, pending: `${stem}.c612i.pending` };
}

/** THE C612h SWAP POINT: boundInvariants at the immutable commit when exported, else C612g's rulesOf (rules-for). */
export async function binderFor(repo) {
  try {
    const PP = await import('./path-prediction.mjs');
    if (typeof PP.boundInvariants === 'function') {
      return { source: 'C612h boundInvariants @HEAD', bind: async (paths) => {
        let sha = 'HEAD'; try { sha = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout.trim(); } catch {}
        const out = {}; for (const p of paths) { try { out[p] = (PP.boundInvariants([p], sha, { repo }) || []).map((x) => x.id || String(x)); } catch { out[p] = []; } } return out;
      } };
    }
  } catch { /* not landed, or failed to load: the fallback below */ }
  return { source: 'rules-for (C612h boundInvariants not yet exported — swap point binderFor)', bind: (paths) => rulesOf(paths, repo) };
}

/** The changed text the tool carried (Edit/MultiEdit new_string, Write content, NotebookEdit new_source), capped — the hunk C612j's reflex reads. */
export function hunkOf(input) {
  const ti = (input && input.tool_input) || {};
  const t = ti.new_string ?? ti.content ?? ti.new_source ?? (Array.isArray(ti.edits) ? ti.edits.map((e) => e.new_string || '').join('\n') : '');
  return String(t || '').slice(0, 4096);
}

/**
 * THE C612j SWAP POINT — reflex({ path, hunk, named, repo, rules }) → { entered: [path], rules: { [path]: [rule] } }.
 * The default is C612g's own placement (conscience-watch.mjs fastPlace): entered = the path when it sits outside every named path;
 * rules = whatever the caller's rules reader already holds (the round's bound cache) — the binding itself never runs inline here,
 * because C612h's boundInvariants (a git grep at HEAD over tests/) measured ~2 s on this repo, 13× the per-write budget. A path
 * with no binding yet is bound by a DETACHED job (--bind) that appends to <stem>.c612i.bound.ndjson; the next call merges it and,
 * when it bound a rule, returns that as a reading too ("the bound rules changed"). C612j replaces this function with the
 * pmu-onchip --door-serve relay (a 'reflex' request: the hunk against the bound guards held in RAM, ≤ 25 ms), which returns the
 * rules inline — same shape in, same shape out, passed as returnReading({ reflex }).
 */
export async function defaultReflex({ path, named = [], repo = REPO, rules }) {
  const pl = await fastPlace({ paths: [path], named, repo, rules: rules || (async () => ({})) });
  return { entered: pl.outside || [], rules: pl.rules || {} };
}

/**
 * C612j's real entry, wired (operator follow-up 2026-10-03): the guards C612h binds to the path ('guard' leg: the path itself when it
 * is a test, every test at HEAD that imports it or names its exact path — namesExactPath/importsPath from path-prediction.mjs over one
 * `git grep -F <basename> <head> -- tests/`, the rule and ceiling legs stay with the detached job), sent with the write's hunk to the
 * --door-serve daemon through its --relay (guards held in RAM per HEAD, top 10). Returns null — and the caller takes the
 * one-write-late path — when the predicates are not exported, the relay exits 3 (no daemon) or 4 (deadline), or anything throws.
 * It never starts a daemon (a hook stays side-effect-free); `pmu-onchip --door-serve --socket <sock>` does, detached.
 */
export const RELAY_DEADLINE_MS = 80;
/** C612t: the engine that binds the guard leg — 'crate' (default: the --door-serve daemon binds it with path_predict.rs mod bind
 *  over the tests it holds at HEAD) or 'mjs' (the C612j reference: namesExactPath/importsPath over one git grep, by env) */
export const HOOK_ENGINE_ENV = 'C612T_HOOK_ENGINE';
export const hookEngine = () => (process.env[HOOK_ENGINE_ENV] === 'mjs' ? 'mjs' : 'crate');
/** the HEAD sha (and, on the mjs reference only, the one git grep its guard leg reads) — started beside the tracked check */
export function guardSearch(path, repo = REPO, { grep = hookEngine() === 'mjs' } = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  return Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repo, env }).then((r) => r.stdout.trim()).catch(() => null),
    grep ? run('git', ['grep', '-n', '-I', '-F', '-e', path.split('/').pop(), 'HEAD', '--', 'tests/'], { cwd: repo, env, maxBuffer: 1 << 26 }).then((r) => r.stdout).catch(() => '') : Promise.resolve(''),
  ]);
}
let PP = null, BIN = null;
/** one request through the daemon relay, never past RELAY_DEADLINE_MS (+60 ms to reap): the parsed answer, or null */
export function relayOnce(req, sock) { return relayAsync(req, { sock, deadlineMs: RELAY_DEADLINE_MS, chip: BIN }); }   // C621: the spawn lives in crate-call.mjs
/** C612t — THE DEFAULT: the hook shuttles (path, hunk, HEAD) and the daemon binds the guard leg and reads the hunk against it */
export async function crateReflex({ path, hunk, named = [], repo = REPO, pre = null, sock = process.env.PMU_DOOR_SOCK || join(repo, '.thetacog/door-serve.sock') }) {
  if (hookEngine() === 'mjs') return crateReflexMjs({ path, hunk, named, repo, pre, sock });
  if (covers(path, named)) return { entered: [], rules: {} };
  if (!existsSync(sock)) return null;
  try { BIN = BIN || (await import('../../src/lib/pmu/pmu-binary.mjs')).resolvePmuBinary(REPO); } catch { return null; }
  if (!BIN) return null;
  const [head] = await (pre || guardSearch(path, repo, { grep: false }));
  if (!head) return null;
  const res = await relayOnce(JSON.stringify({ op: 'reflex', head, repo: resolve(repo), hunk: String(hunk || ''), path, top: 10 }) + '\n', sock);
  if (!res || !Array.isArray(res.readings) || !Array.isArray(res.guards)) return null;   // a daemon older than C612t cannot bind: one write late
  if (!res.guards.length) return { entered: [path], rules: { [path]: [] }, source: `C612j reflex — no guard bound at ${head.slice(0, 10)} (C612t: bound in the crate, ${res.bound_from})` };
  return { entered: [path], rules: { [path]: res.readings.map((x) => `guard:${x.guard} (ncd ${Number(x.ncd).toFixed(3)})`) }, source: `C612j reflex (--door-serve, ${res.disk_reads ?? '?'} disk reads, C612h guard leg bound in the crate from ${res.bound_from} at ${head.slice(0, 10)})` };
}
/** crateReflexMjs — THE C612j REFERENCE (C612T_HOOK_ENGINE=mjs): the guard leg decided here by namesExactPath/importsPath */
export async function crateReflexMjs({ path, hunk, named = [], repo = REPO, pre = null, sock = process.env.PMU_DOOR_SOCK || join(repo, '.thetacog/door-serve.sock') }) {
  if (covers(path, named)) return { entered: [], rules: {} };
  if (!existsSync(sock)) return null;
  try { PP = PP || await import('./path-prediction.mjs'); } catch { return null; }
  if (typeof PP.namesExactPath !== 'function' || typeof PP.importsPath !== 'function') return null;
  try { BIN = BIN || (await import('../../src/lib/pmu/pmu-binary.mjs')).resolvePmuBinary(REPO); } catch { return null; }
  const [head, grep] = await (pre || guardSearch(path, repo));
  if (!head) return null;
  const isTestPath = (f) => /^tests\/.*\.test\.[cm]?[jt]s$/.test(f);
  const guards = new Set(isTestPath(path) ? [path] : []);
  for (const l of grep.split('\n')) {
    const m = /^HEAD:([^:]+):\d+:(.*)$/.exec(l); if (!m || m[1] === path || !isTestPath(m[1])) continue;
    if (PP.namesExactPath(m[2], path) || PP.importsPath(m[2], m[1], path)) guards.add(m[1]);
  }
  const list = [...guards].sort().slice(0, 10);
  if (!list.length) return { entered: [path], rules: { [path]: [] }, source: `C612j reflex — no guard bound at ${head.slice(0, 10)}` };
  const req = JSON.stringify({ op: 'reflex', head, repo: resolve(repo), hunk: String(hunk || ''), guards: list }) + '\n';
  const res = await relayOnce(req, sock);
  if (!res || !Array.isArray(res.readings)) return null;
  return { entered: [path], rules: { [path]: res.readings.map((x) => `guard:${x.guard} (ncd ${Number(x.ncd).toFixed(3)})`) }, source: `C612j reflex (--door-serve, ${res.disk_reads ?? '?'} disk reads, C612h guard leg at ${head.slice(0, 10)})` };
}

const toolPath = (input) => { const ti = (input && input.tool_input) || {}; return ti.file_path || ti.notebook_path || null; };
const covers = (path, named) => named.some((n) => path === n || path.startsWith(n + '/'));

async function isTracked(repo, rel) {
  try { await run('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }); return true; } catch { return false; }
}

function takeLock(lock) {
  try { closeSync(openSync(lock, 'wx')); return true; } catch {}
  try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); closeSync(openSync(lock, 'wx')); return true; } } catch {}
  return false;
}

/** Every binding the detached jobs landed for this round: { [path]: [rule] } plus the binder that ran. */
export function readBound(file) {
  const rules = {}; let source = null;
  try { for (const l of readFileSync(file, 'utf8').split('\n')) { if (!l) continue; try { const j = JSON.parse(l); Object.assign(rules, j.rules || {}); source = j.binder || source; } catch {} } } catch {}
  return { rules, source };
}

const BIND_STALE_MS = 30000;
const bindLive = (lock) => { try { return Date.now() - statSync(lock).mtimeMs < BIND_STALE_MS; } catch { return false; } };

/** Start the binding for paths as a detached job (never awaited, never in the write's latency); single-flight by the bind lock. */
export function startBind({ round, paths }) {
  try {
    try { writeFileSync(round.bindLock, String(Date.now())); } catch {}
    const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--bind', round.bound, round.repo, round.bindLock, ...paths], { detached: true, stdio: 'ignore', env: process.env });
    c.on('error', () => {}); c.unref(); return true;
  } catch { return false; }
}

/** The reading's text — the house verbs, no imperative, no gate word. */
export function readingText({ round, entered, rules, outside, source, binding = [] }) {
  const named = round.named;
  const shown = named.slice(0, NAMED_SHOWN).join(' · ') + (named.length > NAMED_SHOWN ? ` · (+${named.length - NAMED_SHOWN} more)` : '');
  const ruleOf = (p) => (rules[p] && rules[p].length) ? rules[p].join('; ') : binding.includes(p) ? 'binding at HEAD started (detached) — the bound rules land on the round sidecar and in the next reading' : 'no rule bound';
  return [
    `C612i reading — round ${round.label}${round.n != null ? ` (dispatch ${round.n})` : ''}: detected a write at ${entered.join(', ')}, placed OUTSIDE the note's ${named.length} named paths.`,
    `bound rules (${source}): ${entered.map((p) => `${p} → ${ruleOf(p)}`).join(' | ')}`,
    `the note names: ${shown || '—'}`,
    `outside the note this round so far: ${outside.join(', ')}`,
    `The write stands; nothing was undone. A reading, not an instruction — sufficient for ${SUFFICIENT_FOR}; not for ${NOT_SUFFICIENT_FOR}.`,
  ].join('\n');
}

/**
 * returnReading — one PostToolUse call. Returns { out: string|null, why } where out is the exact stdout (the hookSpecificOutput
 * JSON) or null for silence. Never throws. An inside write costs no git call: the tracked check runs only for outside paths.
 */
export async function returnReading({ input, env = process.env, reflex = null, bind = startBind, now = () => new Date().toISOString() } = {}) {
  try {
    if (!input || !TOOLS.includes(input.tool_name)) return { out: null, why: 'not a write tool' };
    const round = roundOf(env); if (!round) return { out: null, why: 'no round active' };
    const fp = toolPath(input); if (!fp) return { out: null, why: 'no path' };
    const abs = canonPath(isAbsolute(fp) ? fp : resolve(input.cwd || round.repo, fp));   // C656a: both sides of relative() canon'd the same way
    const rel = norm(relative(round.repo, abs));
    if (!rel || rel.startsWith('..') || IGNORE_RE.test(rel)) return { out: null, why: 'outside the repo or ignored' };
    const inside = covers(rel, round.named);
    const pre = !inside && !reflex && existsSync(process.env.PMU_DOOR_SOCK || join(round.repo, '.thetacog/door-serve.sock')) ? guardSearch(rel, round.repo) : null;   // overlaps the tracked check
    if (pre) pre.catch(() => {});
    if (!inside && !(await isTracked(round.repo, rel))) return { out: null, why: 'untracked' };
    if (!takeLock(round.lock)) { try { appendFileSync(round.pending, rel + '\n'); } catch {} return { out: null, why: 'single-flight: queued' }; }
    try {
      let pend = []; try { pend = readFileSync(round.pending, 'utf8').split('\n').map(norm).filter(Boolean); writeFileSync(round.pending, ''); } catch {}
      const st = readJson(round.state, { outside: [], rules: {}, binding: [], writes: 0 });
      const bound = readBound(round.bound);
      const rx = reflex || crateReflex;
      const reflexRules = { ...(st.reflexRules || {}) };
      const placed = []; let rxSource = null, fellBack = [];
      for (const q of [...new Set([...pend, rel])]) {
        const args = { path: q, hunk: q === rel ? hunkOf(input) : null, named: round.named, repo: round.repo, rules: async () => ({}), pre: q === rel ? pre : null };
        let r = null; try { r = await rx(args); } catch { r = null; }
        if (r) rxSource = r.source || rx.source || 'reflex (C612j)';
        else { fellBack.push(q); r = await defaultReflex(args); }   // daemon down (exit 3) or past its deadline (exit 4): the one-write-late path
        for (const e of (r && r.entered) || []) { placed.push(e); if (r.rules && Array.isArray(r.rules[e]) && !fellBack.includes(q)) reflexRules[e] = r.rules[e]; }
      }
      // the rules a path carries: the reflex's guard readings (same call) ∪ the detached job's legs it did not cover (rule · ceiling);
      // a path with neither is still binding. The job's guard ids are dropped where the reflex already read the guards.
      const isGuard = (id) => /^guard[: ]/.test(String(id));
      const cached = {};
      for (const q of new Set([...Object.keys(st.rules || {}), ...Object.keys(bound.rules), ...Object.keys(reflexRules)])) {
        const viaRx = reflexRules[q], viaJob = bound.rules[q];
        if (!viaRx && !viaJob) { if (st.rules && q in st.rules) cached[q] = st.rules[q]; continue; }
        cached[q] = [...new Set([...(viaRx || []), ...((viaJob || []).filter((id) => !(viaRx && isGuard(id))))])];
      }
      const outside = [...new Set([...(st.outside || []), ...placed])].sort();
      const entered = outside.filter((q) => !(st.outside || []).includes(q));
      const was = st.rules || {};
      const rulesChanged = outside.filter((q) => (st.outside || []).includes(q) && q in cached && JSON.stringify(was[q] || []) !== JSON.stringify(cached[q] || []) && ((cached[q] || []).length || (was[q] || []).length));
      const unboundJob = outside.filter((q) => !(q in bound.rules));
      // one binding job per round at a time: a live bind lock defers; the next call after it lands starts the rest together
      if (unboundJob.length && bind && !bindLive(round.bindLock)) bind({ round, paths: unboundJob });
      const binding = outside.filter((q) => !(q in cached));
      const source = [rxSource, bound.source || st.binder].filter(Boolean).join(' + ') || 'binding pending (C612h boundInvariants at HEAD, else rules-for — swap point binderFor)';
      writeFileSync(round.state, JSON.stringify({ outside, rules: cached, reflexRules, binding, writes: (st.writes || 0) + 1, binder: bound.source || st.binder || null, reflex_fell_back: fellBack }) + '\n');
      const changed = [...new Set([...entered, ...rulesChanged])];
      if (!changed.length) return { out: null, why: 'nothing changed outside the note' };
      const text = readingText({ round, entered: changed, rules: cached, outside, source, binding });
      try { appendFileSync(round.sidecar, JSON.stringify({ v: 1, kind: KIND_RETURN, at: now(), label: round.label, n: round.n, entered, rules_changed: rulesChanged, rules: Object.fromEntries(changed.map((q) => [q, cached[q] || null])), outside_now: outside, named: round.named.length, binder: source, text, sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR }) + '\n'); } catch {}
      return { out: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }), why: entered.length ? 'entered' : 'rules changed' };
    } finally { try { unlinkSync(round.lock); } catch {} }
  } catch (e) { return { out: null, why: `swallowed: ${String(e && e.message || e).slice(0, 80)}` }; }
}

/**
 * benchHook — the timing receipt: spawn the real hook process n times (the same `node return-reading.mjs --hook` the settings
 * line runs) on a fixture round in `repo`, alternating inside writes and first-entry outside writes. median [min,max] n, never
 * a lone point value.
 */
export async function benchHook({ repo, named, inside, outside = [], n = 20 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'c612i-bench-'));
  const label = 'C612iBENCH';
  writeRoundNamed({ dir, label, n: 1, named, repo });
  const env = { ...process.env, VNA_RUNNER_LOG: join(dir, `1-${label}.log`), VNA_RUNNER_LABEL: label, VNA_RUNNER_DISPATCH: '1' };
  delete env.VNA_RETURN_READING;
  const ms = [], msIn = [], msOut = []; let emitted = 0, nonzero = 0;
  for (let k = 0; k < n; k++) {
    const isOut = k % 2 === 1 && outside.length;
    const fp = isOut ? outside[(k >> 1) % outside.length] : inside;
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: resolve(repo, fp) }, cwd: repo });
    const t0 = performance.now();
    const r = await new Promise((ok) => {
      const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--hook'], { env, cwd: repo });
      let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', (code) => ok({ code, out })); c.stdin.end(payload);
    });
    const dt = +(performance.now() - t0).toFixed(1);
    ms.push(dt); (isOut ? msOut : msIn).push(dt); if (r.out.trim()) emitted++; if (r.code !== 0) nonzero++;
  }
  const stat = (a) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return { n: 0, median: null, min: null, max: null }; const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; return { n: s.length, median: +med.toFixed(1), min: s[0], max: s[s.length - 1] }; };
  return { all: stat(ms), inside: stat(msIn), outside_first_entry: stat(msOut), line: costLine(ms), emitted, nonzero, budget_ms: BUDGET_MS, loadavg_1m: +loadavg()[0].toFixed(1), at: new Date().toISOString() };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--hook')) {
    let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
    let input = null; try { input = JSON.parse(raw); } catch {}
    const r = await returnReading({ input });
    if (r.out) process.stdout.write(r.out);
    process.exit(0);
  }
  const ki = argv.indexOf('--bind');
  if (ki >= 0) {   // the detached binding job: one line on the round's bound ndjson, never a gate, never a non-zero exit
    const [file, repo, lock, ...paths] = argv.slice(ki + 1);
    try { const b = await binderFor(repo); const t0 = performance.now(); const rules = await b.bind(paths, repo);
      appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), binder: b.source, ms: +(performance.now() - t0).toFixed(1), rules }) + '\n'); } catch {}
    try { unlinkSync(lock); } catch {}
    process.exit(0);
  }
  const bi = argv.indexOf('--bench');
  if (bi >= 0) {
    const N = Number(argv[bi + 1]) || 20;
    const outs = ['scripts/ops/rules-for.mjs', 'scripts/vna/steer-hook.mjs', 'scripts/vna/drift-note.mjs', 'scripts/vna/conscience-watch.mjs', 'CLAUDE.md', 'scripts/vna/spec-tree.mjs', 'scripts/vna/goal.mjs', 'scripts/vna/mesh.mjs', 'scripts/vna/hook-doors.mjs', 'scripts/vna/read-set.mjs'];
    const r = await benchHook({ repo: REPO, named: ['scripts/vna/return-reading.mjs'], inside: 'scripts/vna/return-reading.mjs', outside: outs, n: N });
    console.log(JSON.stringify(r, null, 1));
    console.log(`C612i hook ${r.line} · inside median ${r.inside.median} ms [${r.inside.min}, ${r.inside.max}] n ${r.inside.n} · outside first entry median ${r.outside_first_entry.median} ms [${r.outside_first_entry.min}, ${r.outside_first_entry.max}] n ${r.outside_first_entry.n} · budget ${BUDGET_MS} ms · non-zero exits ${r.nonzero} · load ${r.loadavg_1m}`);
    return;
  }
  console.error('usage: node scripts/vna/return-reading.mjs --hook   (PostToolUse stdin JSON)\n       node scripts/vna/return-reading.mjs --bench [N]');
  process.exit(0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => process.exit(0));
