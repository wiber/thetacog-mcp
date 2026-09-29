#!/usr/bin/env node
// scripts/vna/replay-bench.mjs — C265 (U2) THE REPLAY BENCH: THE SMALL-EDIT BASIN, FROM GIT. Operator 2026-09-25, verbatim: "to
// rebuild.. optimisation targets and small edit tests basins?" Every past commit that changed ONE code file by ≤12 lines and came
// with a test is a ready-made task: at its parent the test is red, the commit is the reference answer, and the test grades any
// other answer. The local worker (qwen3:8b through goose) is handed a brief variant and the bench records, per trial:
//   T1 truncated (ollama's own log, dispatch-context.mjs) · T2 first output s · T3 tool calls (worker-trace.mjs) · T4 landed
//   T5 brief tokens (estimate, named) · T6 wall s · the halt, if any
// T4 LANDED = the task's tests pass in the trial tree AND the worker changed nothing but the task's code file and its tests.
//
//   node scripts/vna/replay-bench.mjs --freeze [--limit N]       enumerate + validate (red on parent) → data/vna/replay-basin.json
//   node scripts/vna/replay-bench.mjs --list                      the frozen basin
//   node scripts/vna/replay-bench.mjs --k 3 [--n 20] [--kind mjs|ts|css] [--variant A|O] [--worker "<sh cmd>"] [--model <tag>[,<tag>]] [--max-openings 2] [--dry-run]
//   node scripts/vna/replay-bench.mjs --report [--since ISO]      landed/trials per variant, with a Wilson 95 % interval
//   node scripts/vna/replay-bench.mjs --record                    C266 · C271: the calibration + the A/B → data/vna/replay-calibration.json
//   node scripts/vna/replay-bench.mjs --legibility [--variant B]  C281: per module (× dial) landed/K + interval, lowest first
//   … --dial window+50|narrow|no-helpers                           C281: K trials of one task with ONE dial moved (variant B)
//
// NEVER THE SHARED TREE. Each trial runs in its own scratch tree: `git archive <parent> -- ARCHIVE_PATHS` (the same archive the
// runner's red witness builds) into a fresh dir with its own `git init`, the task's tests copied in from the commit, the worker's
// cwd set there. The brief never names the live repo's path. The scratch is deleted after the trial, pass or fail.
// REUSED, NEVER FORKED: HOUSE_RULES + runWorker (with C256b's generating check) from steer-runner.mjs, resolveEngineCommand +
// readEngineConfig from runner-resolver.mjs, parseWorkerLog from worker-trace.mjs, dispatchContext from dispatch-context.mjs.
// VARIANTS: A = today's brief (the ask + house rules + the guard path) · O = the ORACLE ceiling (A + the true file and the
// commit's changed line range + the red test's text). B = A + the host's code slot (C269, found in the trial tree from the ask alone) + the red test's text.
// Port row (MAXIMISE RUST): the basin enumeration and the grading hold the mass here — C265p, once the bench has run once.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir, loadavg, cpus } from 'node:os';
import { ARCHIVE_PATHS } from './flight-tape.mjs';
import { HOUSE_RULES, runWorker, LOCAL_WORKER_QUIET_MS, LOCAL_WORKER_HARD_MS } from './steer-runner.mjs';
import { resolveEngineCommand, readEngineConfig, thinkingOf } from './runner-resolver.mjs';
import { parseWorkerLog, TOOL_PARSE_UNMEASURED } from './worker-trace.mjs';
import { generatingFor } from './workers.mjs';
import { codeSlot } from './code-slot.mjs';
import { dialShape } from './steer-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const BASIN = process.env.VNA_REPLAY_BASIN || resolve(REPO, 'data/vna/replay-basin.json');
export const LEDGER = process.env.VNA_REPLAY_LEDGER || resolve(REPO, '.thetacog/replay-bench.ndjson');
export const MAX_LINES = 12;
const CODE_EXT = /\.(mjs|js|cjs|ts|css)$/;
const TEST_RE = /^tests\/.*\.test\.m?js$/;
const inArchive = (f) => ARCHIVE_PATHS.some((p) => f === p || f.startsWith(p + '/'));
const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const cleanEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };

/** the candidates, from one `git log --numstat` pass: one code file (≤ MAX_LINES changed, inside the archive), ≥ 1 test, nothing else */
export function enumerate({ repo = REPO, limit = 6000 } = {}) {
  const out = []; let cur = null;
  const flush = () => {
    if (!cur) return;
    const tests = cur.files.filter((f) => TEST_RE.test(f.p)); const code = cur.files.filter((f) => !TEST_RE.test(f.p));
    if (tests.length && code.length === 1 && CODE_EXT.test(code[0].p) && inArchive(code[0].p) && code[0].a + code[0].d > 0 && code[0].a + code[0].d <= MAX_LINES && !/^chore/.test(cur.subject))
      out.push({ sha: cur.sha, file: code[0].p, lines: code[0].a + code[0].d, tests: tests.map((t) => t.p), subject: cur.subject, kind: code[0].p.split('.').pop() });
  };
  for (const l of git(repo, 'log', '--no-merges', '--numstat', '--format=@@%H%x09%s', '-n', String(limit)).split('\n')) {
    if (l.startsWith('@@')) { flush(); const [sha, ...s] = l.slice(2).split('\t'); cur = { sha, subject: s.join('\t'), files: [] }; }
    else if (l.trim() && cur) { const [a, d, p] = l.split('\t'); cur.files.push({ a: Number(a) || 0, d: Number(d) || 0, p }); }
  }
  flush();
  return out;
}

/** a scratch tree at the task's parent with the task's tests copied in from the commit, under its own git — the trial's world */
export function scratchFor(task, { repo = REPO, root = process.env.CLAUDE_SCRATCHPAD_DIR || tmpdir(), tag = 'x' } = {}) {
  const dir = resolve(root, `replay-${task.sha.slice(0, 10)}-${tag}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const parent = `${task.sha}~1`;
  const present = ARCHIVE_PATHS.filter((p) => spawnSync('git', ['cat-file', '-e', `${parent}:${p}`], { cwd: repo }).status === 0);
  execFileSync('bash', ['-c', `git archive ${parent} -- ${present.map((p) => `'${p}'`).join(' ')} | tar -x -C '${dir}'`], { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] });
  const nm = resolve(repo, 'node_modules'); if (existsSync(nm)) { try { symlinkSync(nm, resolve(dir, 'node_modules')); } catch {} }
  for (const t of task.tests) { mkdirSync(dirname(resolve(dir, t)), { recursive: true }); writeFileSync(resolve(dir, t), git(repo, 'show', `${task.sha}:${t}`)); }
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  writeFileSync(resolve(dir, '.gitignore'), 'node_modules\n');
  g('init', '-q'); g('config', 'user.email', 'bench@local'); g('config', 'user.name', 'replay-bench'); g('add', '-A'); g('commit', '-qm', `bench: ${task.sha.slice(0, 10)}~1 + its tests`);
  return { dir, base: g('rev-parse', 'HEAD').trim(), rm: () => rmSync(dir, { recursive: true, force: true }) };
}
/** every path the worker touched: committed or not (diff against the trial's base), plus untracked files */
export function touched(s) {
  const o = (...a) => execFileSync('git', a, { cwd: s.dir, encoding: 'utf8' }).split('\n').filter(Boolean);
  return [...new Set([...o('diff', '--name-only', s.base), ...o('ls-files', '--others', '--exclude-standard')])];
}
const runTests = (dir, tests) => spawnSync('node', ['--test', ...tests], { cwd: dir, encoding: 'utf8', env: cleanEnv(), timeout: 180000 });

/** --freeze: keep a candidate only if its tests FAIL at the parent — a task the parent already passes grades nothing */
export function freeze({ repo = REPO, path = BASIN, limit = 6000, say = console.log } = {}) {
  const cands = enumerate({ repo, limit }); const tasks = []; const dropped = {};
  for (const c of cands) {
    const s = scratchFor(c, { repo, tag: 'freeze' });
    try {
      const r = runTests(s.dir, c.tests);
      if (r.status === 0) { dropped['green on parent'] = (dropped['green on parent'] || 0) + 1; continue; }
      if (/Cannot find module/.test(r.stdout + r.stderr) && !(r.stdout + r.stderr).includes(c.file)) { dropped['a module outside the archive'] = (dropped['a module outside the archive'] || 0) + 1; continue; }
      tasks.push(c); say(`  ✓ ${c.sha.slice(0, 10)} ${c.file} (${c.lines} lines) — red on the parent`);
    } finally { s.rm(); }
  }
  const b = { at: new Date().toISOString(), head: git(repo, 'rev-parse', 'HEAD').trim(), rule: `one code file (${CODE_EXT.source}) inside ARCHIVE_PATHS, 1–${MAX_LINES} changed lines, ≥1 test under tests/, nothing else; not chore; tests red on the parent`, candidates: cands.length, dropped, tasks };
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(b, null, 1) + '\n');
  say(`basin frozen: ${tasks.length} of ${cands.length} candidates · dropped ${JSON.stringify(dropped)} → ${path}`);
  return b;
}

/** the changed line range of the task's file at the parent (for the ORACLE variant only — it is the answer's location) */
function oracleRange(repo, task) {
  const d = git(repo, 'diff', '-U0', `${task.sha}~1`, task.sha, '--', task.file);
  const hunks = [...d.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map((m) => [Number(m[1]), Number(m[1]) + Math.max(0, Number(m[2] ?? 1) - 1)]);
  return hunks.length ? [Math.max(1, Math.min(...hunks.map((h) => h[0])) - 20), Math.max(...hunks.map((h) => h[1])) + 20] : null;
}
export function briefFor(task, variant, { repo = REPO, dir = null, dial = null } = {}) {
  const ask = `THE ASK (a past commit's subject — the change it describes is not in this tree yet): ${task.subject}`;
  const guard = `THE GUARD (already written, currently failing): ${task.tests.join(' · ')} — run it with node --test; make it pass.`;
  const A = [ask, '', guard, '', HOUSE_RULES, '', 'Stage only the files you changed and commit with a message naming what you did.'];
  if (variant === 'A') return A.join('\n');
  if (variant === 'O') {
    const r = oracleRange(repo, task); const src = dir ? readFileSync(resolve(dir, task.file), 'utf8').split('\n') : [];
    const win = r ? src.slice(r[0] - 1, r[1]).map((l, i) => `${r[0] + i}: ${l}`).join('\n') : '';
    const testText = dir ? task.tests.map((t) => `--- ${t}\n${readFileSync(resolve(dir, t), 'utf8').slice(0, 6000)}`).join('\n') : '';
    return [...A, '', `THE FILE TO EDIT: ${task.file}${r ? `, lines ${r[0]}–${r[1]}` : ''}`, win, '', 'THE FAILING TEST:', testText].join('\n');
  }
  if (variant === 'B') {   // C271: today's brief + the host's code slot (C269, found in the trial tree) + the red test's text (C270 hands one)
    const sh = dialShape(dial); const slot = dir ? codeSlot({ repo: dir, ask: task.subject, window: sh.window, helpers: sh.helpers, tests: task.tests }) : null;   // C281: one dial moved · C408: the guard's imports aim the slot
    const testText = dir ? task.tests.map((t) => `--- ${t}\n${readFileSync(resolve(dir, t), 'utf8').slice(0, 6000)}`).join('\n') : '';
    return [...A, '', slot ? slot.text : 'THE CODE SLOT: the host found no file for this ask.', '', 'THE FAILING TEST:', testText].join('\n');
  }
  throw new Error(`UNKNOWN_VARIANT ${variant} — A, B or O`);
}

/** C288 (U19d) THE MODEL TAG IS A BENCH DIAL. The engine command for one trial, with `model` overriding the config's subagent tag
 *  through a COPY of the config (the operator's selection file is never written). A tag the preset cannot carry is refused
 *  (MODEL_NOT_APPLIED) — never run on the config's model under the override's name. The engine names the tag actually used. */
export function engineCommand({ repo = REPO, model = null, prompt = '' } = {}) {
  const base = readEngineConfig(repo); const cfg = model ? { ...base, subagentModel: model } : base;
  const cmd = resolveEngineCommand(cfg, 'brief', { prompt });
  if (model && !resolveEngineCommand(cfg, 'brief', { prompt: '' }).includes(model)) throw new Error(`MODEL_NOT_APPLIED: the ${cfg.preset} template cannot carry --model ${model} (a local preset and a plain ollama tag only)`);
  return { cmd, cfg, engine: `goose/${cfg.subagentModel || '?'}` };
}

/** C289 (U19e) A STARVED OR EVICTED TRIAL IS NOT A READING. The floor is the host's: 2 × cores (VNA_LOAD_FLOOR overrides). */
export const LOAD_FLOOR = Number(process.env.VNA_LOAD_FLOOR) || 2 * cpus().length;
/** C409 — A CONTENDED TRIAL IS NOT A READING EITHER. The start gate (C289) reads the load once; the 2026-09-25 rows show trials that
 *  started at 18–20 and ENDED at 98–347 while the host's own hooks and daemons ran, and 12 of the 25 watchdog misses ended over 40 —
 *  a watchdog under that load measures contention, not the model. The threshold is 2 × the floor (4 × cores): the worker's own
 *  threads add at most `cores` to the 1-min load, so a trial that starts at the floor and runs alone ends under 3 × cores (quiet-box
 *  trials that day ended ≤ 12 on 10 cores); past 4 × cores another process is on the box (the contended ends read 42–347).
 *  The load is sampled through the trial (load_max); at or over this it is stamped invalid: 'contended' — never inside a Wilson count. */
export const CONTENDED_LOAD = Number(process.env.VNA_REPLAY_CONTENDED_LOAD) || 2 * LOAD_FLOOR;
/** the row's invalidity, stamped or read off its own record: a dry run and a legacy row whose only load reading (load1 at the end)
 *  was contended are not readings either — the ledger before C409 carried both inside the counts (O · nothink "misses 1" was a dry run) */
export function invalidityOf(r) {
  if (!r) return null; if (r.invalid) return r.invalid;
  if (/^dry run$/.test(String(r.halt || ''))) return 'dry-run';
  const l = typeof r.load_max === 'number' ? r.load_max : typeof r.load1 === 'number' ? r.load1 : null;
  return l != null && l >= CONTENDED_LOAD ? 'contended' : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** wait (bounded, polling) for load1 to fall under the floor; starved = it never did, and the trial starts anyway, stamped */
export async function waitForLoad({ floor = LOAD_FLOOR, loadFn = () => loadavg()[0], waitMs = Number(process.env.VNA_LOAD_WAIT_MS) || 600000, pollMs = 15000 } = {}) {
  const t0 = Date.now(); let l = loadFn();
  while (l > floor && Date.now() - t0 < waitMs) { await sleep(Math.max(1, Math.min(pollMs, waitMs - (Date.now() - t0)))); l = loadFn(); }
  return { load1: Math.round(l * 10) / 10, waited_s: Math.round((Date.now() - t0) / 100) / 10, starved: l > floor };
}
const OLLAMA = (() => { const h = process.env.OLLAMA_HOST || '127.0.0.1:11434'; return /^https?:/.test(h) ? h : `http://${h}`; })();
/** the tags resident on the model server (/api/ps) — one light read, polled only while a real worker runs */
export async function residentModels(fetchFn = globalThis.fetch) { const j = await (await fetchFn(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(5000) })).json(); return (j.models || []).map((m) => m.name || m.model); }
/** evicted = ANOTHER tag resident and not the worker's. An empty server is the model still cold-loading — never an eviction. */
export function evictedBy(list, tag) {
  if (!tag || !Array.isArray(list) || !list.length) return null;
  const norm = (t) => String(t).replace(/:latest$/, ''); return list.map(norm).includes(norm(tag)) ? null : list;
}

/** one trial → one ledger row. `worker` overrides the engine command (a shell string run in the trial dir) — the guard's stub. */
export async function trial(task, { variant = 'A', k = 1, dial = null, model = null, repo = REPO, ledger = LEDGER, worker = null, dryRun = false, quiet = true, probe = null, requeue = 0 } = {}) {
  // C289: a real worker waits for the host to fall under the floor; a stub trial measures the grader, not the model — gated only when a probe is injected
  const pr = { floor: LOAD_FLOOR, ...(probe || {}) }; const ld = !worker || probe ? await waitForLoad(pr) : null;
  const s = scratchFor(task, { repo, tag: `${variant}${k}` }); const at0 = new Date();
  // the trial's log is RETAINED (AXIOM 1): a silent 0-call trial is only diagnosable from it — the path rides the row
  const log = resolve(process.env.VNA_REPLAY_LOG_DIR || resolve(REPO, '.thetacog/runner/replay'),   // the bench's own repo — never the tree the task was cut from
     `${task.sha.slice(0, 10)}-${variant}${k}-${Date.now().toString(36)}.log`);
  try {
    const brief = briefFor(task, variant, { repo, dir: s.dir, dial });
    const eng = worker ? { cfg: readEngineConfig(repo), cmd: worker, engine: 'stub' } : engineCommand({ repo, model, prompt: brief });   // C288
    const cfg = eng.cfg; const cmd = eng.cmd;
    let firstOut = null, ready = false;
    const tag = worker ? model : cfg.subagentModel; const resident = pr.resident || (worker ? null : () => residentModels());   // C289: is the worker's tag still resident?
    // C409: the brief is RETAINED beside the log (AXIOM 1 — the goose log holds only what the model said back; 30 logs read 2026-09-28
    // could not show what the model was handed), and the load is sampled through the trial, not only at its gate
    const briefPath = log.replace(/\.log$/, '') + '.brief.txt'; mkdirSync(dirname(log), { recursive: true }); writeFileSync(briefPath, brief);
    const loadFn = pr.loadFn || (() => loadavg()[0]); let loadMax = Math.max(ld ? ld.load1 : 0, loadFn());
    let evicted = null; const poll = setInterval(async () => { try { loadMax = Math.max(loadMax, loadFn()); } catch {} if (resident && tag) { try { const e = evictedBy(await resident(), tag); if (e && !evicted) evicted = e; } catch {} } }, pr.residentPollMs || Number(process.env.VNA_RESIDENT_POLL_MS) || 30000);
    const w = await runWorker({ claude: '/bin/sh', args: ['-c', cmd], cwd: s.dir, env: { ...cleanEnv(), REPLAY_BRIEF: brief }, log, quiet, label: `bench-${task.sha.slice(0, 8)}-${variant}${k}`, dryRun,
      quietMs: LOCAL_WORKER_QUIET_MS, hardMs: LOCAL_WORKER_HARD_MS, stillWorking: worker ? null : (pg) => generatingFor(pg),
      onData: (d, ms) => { if (!ready && /goose is ready/.test(d)) { ready = true; return; } if ((ready || worker) && firstOut == null && d.trim()) firstOut = ms; } });
    clearInterval(poll); try { loadMax = Math.max(loadMax, loadFn()); } catch {}
    const at1 = new Date();
    const t = (() => { try { return parseWorkerLog(readFileSync(log, 'utf8')); } catch { return null; } })();
    const g = runTests(s.dir, task.tests);
    const changed = touched(s);
    const allowed = new Set([task.file, ...task.tests]);
    const stray = [...new Set(changed)].filter((f) => !allowed.has(f));
    let ctx = null;
    if (!worker) { try { const { dispatchContext } = await import('./dispatch-context.mjs'); ctx = await dispatchContext({ local: true, model: cfg.subagentModel || null, at0: at0.toISOString(), at1: at1.toISOString(), promptChars: brief.length }); } catch {} }
    let turns = null; if (!worker) { try { const { gooseTurns } = await import('./dispatch-context.mjs'); turns = gooseTurns({ workingDir: s.dir }); } catch {} }   // C275b: how the turns ended — thinking-only is named
    // the machine's 1-min load at the trial's end: a watchdog end under a saturated host (load 40–90 measured 2026-09-25) measures
    // contention, not the model — the record keeps it so calibration() can set those trials apart
    const row = { at: at1.toISOString(), load1: Math.round(loadavg()[0] * 10) / 10, load_max: Math.round(loadMax * 10) / 10, goose_turns: turns, sha: task.sha, file: task.file, kind: task.kind, variant, k, dial: dial || null, engine: eng.engine, model: worker ? model || null : cfg.subagentModel || null,
      load1_start: ld ? ld.load1 : null, load_waited_s: ld ? ld.waited_s : null, invalid: dryRun ? 'dry-run' : ld && ld.starved ? 'starved' : evicted ? 'evicted' : loadMax >= CONTENDED_LOAD ? 'contended' : null, evicted_by: evicted, ...(requeue ? { requeue } : {}),
      brief: briefPath.startsWith(REPO) ? briefPath.slice(REPO.length + 1) : briefPath,
      T1_truncated: ctx ? ctx.context_verdict === 'UNMEASURED' : null, T1_why: ctx ? ctx.context_why || null : 'not read (stub worker)',
      T2_first_output_s: firstOut == null ? null : Math.round(firstOut / 100) / 10,
      T3_calls: t ? t.n_calls_total ?? t.calls.length : null, T3_tool_errors: t ? t.tool_errors ?? null : null, T4_landed: g.status === 0 && stray.length === 0, tests_green: g.status === 0, stray,
      T5_brief_tokens_est: Math.ceil(brief.length / 4), alive: w.alive || null, T6_wall_s: Math.round((at1 - at0) / 100) / 10,
      log: log.startsWith(REPO) ? log.slice(REPO.length + 1) : log, halt: turns && turns.ended_thinking_only && !(g.status === 0) ? 'THINKING_ONLY — the last turn was all reasoning: no text, no tool call (D2)' : w.quietKilled ? `quiet ${Math.round(w.quietKilled.quiet_ms / 1000)} s — watchdog` : w.exit !== 0 && w.exit != null ? `worker exit ${w.exit}` : w.dryRunRefused ? 'dry run' : null };
    mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify(row) + '\n');
    return row;
  } finally { s.rm(); }
}

/** C286 (U19b) THE DEAD-ARM CIRCUIT BREAKER. One named cause per non-landed row, null for a landed one. The halt the trial named
 *  wins (context, then the watchdog, then thinking-only); otherwise the row's own counts decide (no output · output but no call ·
 *  calls but the test stayed red). */
export function failureSignature(r) {
  if (!r || r.T4_landed) return null;
  const halt = String(r.halt || ''); const gt = r.goose_turns || {}; const calls = r.T3_calls || 0;
  if (/BRIEF_OVER_CONTEXT/.test(halt) || r.T1_truncated === true) return 'context-held';
  if (/quiet|watchdog/i.test(halt)) return 'watchdog';
  if (/THINKING_ONLY/.test(halt) || gt.ended_thinking_only || (gt.thinking_only_turns > 0 && !gt.tool_turns)) return 'thinking-only';
  if (calls === 0 && r.T2_first_output_s == null) return 'empty';
  if (calls === 0) return 'no-tool-call';
  return 'tests-red';
}
/** C299 (U19i) THE REPORT BINS EACH MISS. One bucket per valid non-landed trial, off the row (and, for TS only, the trial's own
 *  retained goose log): TC context held · TW watchdog · TB stray (touched a path outside the task's file + tests) · TS goose's own
 *  tool-error line under a call (worker-trace's TOOL_ERROR_RE) · T0 no tool call (empty / no-tool-call / thinking-only) · TF tests
 *  red. Landed, invalid (C289) and ledger-event rows (arm_frozen · arm_opened) are not misses → null. A call goose could not PARSE
 *  leaves no line in its log, so that half of TS is UNMEASURED (TOOL_PARSE_UNMEASURED) — never a guess. */
export const MISS_BUCKETS = Object.freeze(['T0', 'TS', 'TB', 'TF', 'TW', 'TC']);
const isEvent = (r) => r && (r.kind === 'arm_frozen' || r.kind === 'arm_opened');
/** the trial's goose tool-error count: the row's own stamp, else its retained log re-read; null = unread (no log, log gone) */
export function toolErrorsOf(r, { repo = REPO } = {}) {
  if (typeof r.T3_tool_errors === 'number') return r.T3_tool_errors;
  if (!r.log) return null;
  try { return parseWorkerLog(readFileSync(resolve(repo, r.log), 'utf8')).tool_errors ?? null; } catch { return null; }
}
export function missBucket(r, opts = {}) {
  if (!r || isEvent(r) || r.T4_landed || invalidityOf(r)) return null;
  const sig = failureSignature(r);
  if (sig === 'context-held') return 'TC';
  if (sig === 'watchdog') return 'TW';
  if (Array.isArray(r.stray) && r.stray.length) return 'TB';
  if ((toolErrorsOf(r, opts) || 0) > 0) return 'TS';
  if (['empty', 'no-tool-call', 'thinking-only'].includes(sig)) return 'T0';
  return 'TF';
}
/** the six counts over a set of rows + the TS-unread count; throws when the buckets do not sum to the misses (the falsifier) */
export function missesOf(rows, { bucket = missBucket, repo = REPO } = {}) {
  const miss = (rows || []).filter((r) => r && !isEvent(r) && !r.T4_landed && !invalidityOf(r));
  const m = { n: miss.length, ...Object.fromEntries(MISS_BUCKETS.map((b) => [b, 0])), ts_unread: 0 };
  for (const r of miss) {
    const b = bucket(r, { repo }); if (b in m && MISS_BUCKETS.includes(b)) m[b]++;
    if (b === 'TF' || b === 'T0') { if (toolErrorsOf(r, { repo }) == null) m.ts_unread++; }
  }
  const sum = MISS_BUCKETS.reduce((s, b) => s + m[b], 0);
  if (sum !== m.n) throw new Error(`MISS_BUCKETS_DO_NOT_SUM — the buckets do not sum: ${sum} binned of ${m.n} misses (C299)`);
  return m;
}
export const missesLine = (m) => `misses ${m.n} = ${MISS_BUCKETS.map((b) => `${b} ${m[b]}`).join(' · ')}${m.ts_unread ? ` (TS unread on ${m.ts_unread} — log gone)` : ''}`;

/** an arm = variant × engine (the model tag it ran on) × dial */
export const armKey = (r) => `${r.variant}|${r.engine === 'stub' ? `stub:${r.model || ''}` : r.engine}|${r.dial || ''}`;   // a stub row carries its tag in model
/** frozen when the LAST n trials of the arm (default: the last row's arm) are all non-landed with ONE non-null signature. Mixed
 *  signatures never trip it — five different failures are a reading, not a dead arm. tests-red never trips it either: an arm that
 *  made calls and failed five different tasks' tests is a READING of the arm, not a parameter failure (the spec row's list governs). */
export const FREEZING = Object.freeze(['context-held', 'watchdog', 'thinking-only', 'empty', 'no-tool-call']);
export function deadArm(rows, { n = 5, arm = null } = {}) {
  const trialsOf = (rows || []).filter((r) => r && r.kind !== 'arm_frozen' && !invalidityOf(r));   // C289 · C409: an invalid trial is not a reading
  const key = arm || (trialsOf.length ? armKey(trialsOf[trialsOf.length - 1]) : null);
  const last = trialsOf.filter((r) => armKey(r) === key).slice(-n);
  const sigs = new Set(last.map(failureSignature));
  const signature = last.length === n && sigs.size === 1 && FREEZING.includes([...sigs][0]) ? [...sigs][0] : null;
  return { frozen: signature != null, signature, trials: signature ? last.map((r) => r.sha) : [], arm: key };
}

/** C290 (U19f) THE HOST-BUILT TABLE — a frozen arm's signature picks ONE dial for ONE new arm; nothing else moves. Returns
 *  { to, dial, value, because } or { to: null, reason } — never silence. watchdog / thinking-only / empty → the same weights with thinking
 *  off (C285's thinkingOf; the `-nothink` build only if installed) · context-held → narrow (variant B's code slot; A has none) ·
 *  no-tool-call → variant B from A · tests-red → window+50 (the spec's wider window; C286 never freezes on it today). */
export function nextArm(arm, signature, { installed = null } = {}) {
  const none = (reason) => ({ to: null, because: signature, reason });
  if (['watchdog', 'thinking-only', 'empty'].includes(signature)) {
    const m = arm.model; if (!m) return none('the arm names no model tag — nothing to switch thinking off on');
    if (thinkingOf(m) !== 'thinking') return none(`${m} does not think (${thinkingOf(m)}) — no non-thinking tag to open`);
    const cand = `${m.replace(/:latest$/, '')}-nothink`;
    if (!Array.isArray(installed)) return none(`the installed tags were unreadable — ${cand} unconfirmed`);
    if (!installed.map((t) => String(t).replace(/:latest$/, '')).includes(cand)) return none(`${cand} is not installed (config/ollama/qwen3-8b-nothink.Modelfile builds it)`);
    return { to: { ...arm, model: cand }, dial: 'model', value: cand, because: signature };
  }
  if (signature === 'context-held') {
    if (arm.variant !== 'B') return none(`variant ${arm.variant} carries no code slot — narrow would not change its brief`);
    if (arm.dial === 'narrow') return none('the arm is already narrow');
    return { to: { ...arm, dial: 'narrow' }, dial: 'dial', value: 'narrow', because: signature };
  }
  if (signature === 'no-tool-call') return arm.variant === 'A' ? { to: { ...arm, variant: 'B' }, dial: 'variant', value: 'B', because: signature } : none(`variant ${arm.variant} already carries the code slot`);
  if (signature === 'tests-red') return arm.variant === 'B' && arm.dial !== 'window+50' ? { to: { ...arm, dial: 'window+50' }, dial: 'dial', value: 'window+50', because: signature } : none(`variant ${arm.variant}${arm.dial ? ' · ' + arm.dial : ''} has no wider window to open`);
  return none(`no table entry for signature ${signature}`);
}
export const MAX_OPENINGS = Number(process.env.VNA_MAX_ARM_OPENINGS ?? 2);

/** the trial loop, arms = variant × model (× dial). Before each trial a frozen arm is skipped; the freeze is written to the ledger as
 *  an arm_frozen row and said in one line. C290: each freeze then opens ONE new arm from nextArm's table (bounded, MAX_OPENINGS per
 *  run), recorded as arm_opened; the new arm runs the frozen arm's REMAINING jobs, the frozen rows are never re-labelled, and no
 *  parameter changes inside an arm. The run halts ("parameter failure: <signature>") only when every arm is frozen and nothing
 *  opened. Reads THIS run's rows only — yesterday's rows never freeze today's arm. */
export async function runArms({ tasks, K = 1, variants = ['A'], models = [null], dial = null, worker = null, dryRun = false, repo = REPO, ledger = LEDGER, n = 5, say = console.log, probe = null, installed = undefined, maxOpenings = MAX_OPENINGS } = {}) {
  const arms = variants.flatMap((variant) => models.map((model) => ({ variant, model, dial }))); const runRows = []; const frozen = new Map(); let openings = 0;
  const keyOf = (a) => `${a.variant}|${a.model || ''}|${a.dial || ''}`;
  const cfgModel = () => { try { return readEngineConfig(repo).subagentModel; } catch { return null; } };
  const label = (a) => armKey({ variant: a.variant, dial: a.dial, engine: worker ? 'stub' : `goose/${a.model || cfgModel() || '?'}`, model: a.model });
  const write = (row) => { mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify(row) + '\n'); };
  // one queue, interleaved per task and k as before (both arms see the same machine hour); C289 re-queues an invalid trial ONCE at its end
  const queue = []; for (const t of tasks) for (let k = 1; k <= K; k++) for (const a of arms) queue.push({ t, k, a, requeue: 0 });
  for (let qi = 0; qi < queue.length; qi++) {
    const { t, k, a, requeue } = queue[qi];
    if (frozen.has(keyOf(a))) continue;
    const r = await trial(t, { variant: a.variant, k, dial: a.dial, model: a.model, worker, dryRun, repo, ledger, probe, requeue });
    runRows.push({ ...r, _arm: keyOf(a) });
    if (r.invalid && r.invalid !== 'dry-run') { say(`  ⚠ ${t.sha.slice(0, 10)} ${a.variant}${k} invalid (${r.invalid}${r.invalid === 'starved' ? ` — load ${r.load1_start} over ${probe && probe.floor || LOAD_FLOOR}` : r.invalid === 'contended' ? ` — load reached ${r.load_max}, at or over ${CONTENDED_LOAD} during the trial (C409)` : ` — ${(r.evicted_by || []).join(',')} resident`}) — not a reading; ${requeue ? 'second invalid: recorded, not re-queued' : 're-queued once'}`); if (!requeue) queue.push({ t, k, a, requeue: 1 }); continue; }
    say(`  ${t.sha.slice(0, 10)} ${a.variant}${k}${a.model ? ` · ${a.model}` : ''}${a.dial ? ` · ${a.dial}` : ''} · ${r.T4_landed ? 'LANDED' : 'not landed'} · calls ${r.T3_calls ?? '?'} · first ${r.T2_first_output_s ?? '—'} s · wall ${r.T6_wall_s} s${r.halt ? ` · ${r.halt}` : ''}${r.stray.length ? ` · stray ${r.stray.join(',')}` : ''}`);
    const mine = runRows.filter((x) => x._arm === keyOf(a)); const dead = deadArm(mine, { n, arm: armKey(r) });
    if (!dead.frozen) continue;
    const f = { kind: 'arm_frozen', variant: a.variant, engine: r.engine, model: a.model || null, dial: a.dial || null, signature: dead.signature, trials: dead.trials, at: new Date().toISOString() };
    write(f); frozen.set(keyOf(a), f);
    say(`  ✋ arm ${a.variant} · ${r.engine}${a.model && worker ? ` · ${a.model}` : ''}${a.dial ? ` · ${a.dial}` : ''} frozen — ${n} consecutive non-landed trials, one signature: ${dead.signature}`);
    // C290: open ONE new arm, one dial moved, picked by the signature — or say why not
    const armNow = { ...a, model: a.model || (worker ? null : cfgModel()) };
    if (installed === undefined && armNow.model && ['watchdog', 'thinking-only', 'empty'].includes(dead.signature)) { try { installed = (await (await import('./local-models.mjs')).installedTags()).tags; } catch { installed = null; } }
    let o = openings >= maxOpenings ? { to: null, because: dead.signature, reason: `the bound (${maxOpenings} openings per run) is spent` } : nextArm(armNow, dead.signature, { installed });
    if (o.to && arms.some((x) => keyOf(x) === keyOf(o.to))) o = { to: null, because: dead.signature, reason: `${label(o.to)} is already an arm of this run` };
    const left = o.to ? queue.slice(qi + 1).filter((j) => keyOf(j.a) === keyOf(a) && !j.requeue) : [];
    write({ kind: 'arm_opened', from: label(a), to: o.to ? label(o.to) : null, dial: o.dial || null, value: o.value || null, because: dead.signature, remaining: left.length, reason: o.reason || null, at: new Date().toISOString() });
    if (o.to) {
      openings++; arms.push(o.to); for (const j of left) queue.push({ t: j.t, k: j.k, a: o.to, requeue: 0 });
      say(`  ↪ opened arm ${label(o.to)} — ${o.dial} → ${o.value}, because ${dead.signature}; it runs the ${left.length} job(s) the frozen arm had left (C290)`);
    } else say(`  ↪ no arm opened — ${o.reason} (C290)`);
    if (frozen.size === arms.length) {
      const sigs = [...new Set([...frozen.values()].map((x) => x.signature))];
      say(`replay-bench: every arm frozen — parameter failure: ${sigs.join(' · ')} (C286)`);
      return { halted: true, signature: sigs.join(' · '), frozen: [...frozen.values()], openings, rows: runRows.length };
    }
  }
  return { halted: false, signature: null, frozen: [...frozen.values()], openings, rows: runRows.length };
}

/** Wilson 95 % interval for x successes in n — a rate is never reported without its interval */
export function wilson(x, n, z = 1.96) {
  if (!n) return [null, null];
  const p = x / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)].map((v) => Math.round(v * 1000) / 1000);
}
export function report({ ledger = LEDGER, since = null } = {}) {
  let rows = []; try { rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  if (since) rows = rows.filter((r) => r.at >= since);
  const by = {}; for (const r of rows.filter((r) => r.engine !== 'stub' && !isEvent(r))) { const k = `${r.variant} · ${r.engine}`; (by[k] ||= []).push(r); }
  return Object.fromEntries(Object.entries(by).map(([k, all]) => { const rs = all.filter((r) => !invalidityOf(r)); const inv = invalidOf(all); const x = rs.filter((r) => r.T4_landed).length; return [k, {
    invalid: inv, invalid_line: invalidLine(inv), misses: missesOf(rs), misses_line: missesLine(missesOf(rs)), landed: x, trials: rs.length, wilson95: wilson(x, rs.length), tasks: new Set(rs.map((r) => r.sha)).size,
    T1_truncated: rs.filter((r) => r.T1_truncated).length, T3_zero_calls: rs.filter((r) => r.T3_calls === 0).length,
    T2_median_s: median(rs.map((r) => r.T2_first_output_s).filter((v) => v != null)), T6_median_s: median(rs.map((r) => r.T6_wall_s)) }]; }));
}
/** C289 · C409: invalid rows are counted apart, split by cause — never inside a Wilson count */
export const invalidOf = (rs) => { const inv = rs.map(invalidityOf).filter(Boolean); const c = (k) => inv.filter((v) => v === k).length; return { n: inv.length, starved: c('starved'), evicted: c('evicted'), contended: c('contended'), dry_run: c('dry-run') }; };
export const invalidLine = (i) => `invalid ${i.n} (starved ${i.starved} · evicted ${i.evicted} · contended ${i.contended || 0} · dry-run ${i.dry_run || 0})`;
/** C281 (U18a) THE LEGIBILITY RATE — per module (the task's file) and dial: landed / K with a Wilson 95 % interval, lowest first. A module
 *  the worker cannot edit from a brief, K times, is a refactoring target; a rate is never reported without its K and interval, and a
 *  high rate says the loop can edit it from a brief — never that its design is proven. */
export function legibility({ ledger = LEDGER, since = null, variant = null } = {}) {
  let rows = []; try { rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  rows = rows.filter((r) => r.engine !== 'stub' && !isEvent(r) && (!since || r.at >= since) && (!variant || r.variant === variant));
  const by = {}; for (const r of rows) { const key = `${r.file} · ${r.variant} · ${r.engine}${r.dial ? ' · ' + r.dial : ''}`; (by[key] ||= []).push(r); }
  return Object.entries(by).map(([key, all]) => { const rs = all.filter((r) => !invalidityOf(r)); const x = rs.filter((r) => r.T4_landed).length; return { key, file: all[0].file, variant: all[0].variant, engine: all[0].engine, dial: all[0].dial || null, landed: x, K: rs.length, rate: rs.length ? Math.round(x / rs.length * 1000) / 1000 : null, wilson95: wilson(x, rs.length), invalid: invalidOf(all).n, misses: missesOf(rs) }; })
    .sort((a, b) => a.rate - b.rate || b.K - a.K);
}
/** C266 · C271 — THE RECORD: the calibration (variant A, D2a) and the A/B (B vs A) as one committed file, recomputable from the ledger.
 *  The prediction on record for A is 5–20 % landed; it is FALSIFIED when A lands 0 while most trials made tool calls (the brief, not
 *  the weights). B beats A only when B's interval lies wholly above A's — overlapping intervals are "no difference the count supports". */
export const THINKING_ENGINE = 'goose/qwen3:8b';   // C266 / C271's condition: qwen3:8b, thinking on (D2a)
export const NOTHINK_ENGINE = 'goose/qwen3:8b-nothink';   // C291's condition: the same weights, thinking off
/** C291 (U19g) the prediction on record for the non-thinking gauge: turns under 60 s and B lands ≥ 1 of 20 → HELD; B 0/20 with tool
 *  calls on most trials → FALSIFIED (the brief, not the thinking — C269/C270 are the lever); anything else → MISSED with the numbers.
 *  Fewer than 20 valid B trials is UNMEASURED, never a verdict. The first-output median is over both arms (the turn time is the engine's). */
export function nothinkPrediction(A, B) {
  if (!B || B.trials < 20) return `UNMEASURED — B has ${B ? B.trials : 0} of 20 valid trials on ${NOTHINK_ENGINE}`;
  const firsts = [A && A.T2_median_s, B.T2_median_s].filter((v) => v != null); const med = firsts.length ? Math.max(...firsts) : null;
  if (B.landed >= 1 && med != null && med < 60) return `HELD — B landed ${B.landed}/${B.trials}, median first output ${med} s (under 60 s)`;
  if (B.landed === 0 && B.with_calls > B.trials / 2) return `FALSIFIED — B landed 0/${B.trials} with tool calls on ${B.with_calls}: the brief, not the thinking — C269/C270 are the lever`;
  return `MISSED — B landed ${B.landed}/${B.trials}, median first output ${med ?? 'unread'} s (predicted B ≥ 1 of 20 and under 60 s)`;
}
export const CALIBRATION = process.env.VNA_REPLAY_CALIBRATION || resolve(REPO, 'data/vna/replay-calibration.json');
export function calibration({ ledger = LEDGER, since = null } = {}) {
  let rows = []; try { rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  rows = rows.filter((r) => r.engine !== 'stub' && !isEvent(r) && (!since || r.at >= since));
  // C289 · C409: starved / evicted / contended / dry-run trials first, counted apart, never mixed into the rate (CONTENDED_LOAD is the one threshold)
  const invalid = invalidOf(rows); rows = rows.filter((r) => !invalidityOf(r)); const contended = invalid.contended;
  // C291 fix: an arm is variant × ENGINE — a nothink run never pools with the thinking-on trials. c.A / c.B stay the thinking-on
  // arms (C266 / C271's condition, THINKING_ENGINE); every engine present gets its own { A, B, ab, prediction } under by_engine.
  const arm = (v, eng = THINKING_ENGINE) => { const rs = rows.filter((r) => r.variant === v && r.engine === eng); const x = rs.filter((r) => r.T4_landed).length; return { trials: rs.length, landed: x, rate: rs.length ? Math.round(x / rs.length * 1000) / 1000 : null, wilson95: wilson(x, rs.length), tasks: new Set(rs.map((r) => r.sha)).size, with_calls: rs.filter((r) => (r.T3_calls || 0) > 0).length, truncated: rs.filter((r) => r.T1_truncated).length, watchdog: rs.filter((r) => /watchdog/.test(r.halt || '')).length, T2_median_s: median(rs.map((r) => r.T2_first_output_s).filter((v) => v != null)), misses: missesOf(rs), engine: rs[0] ? rs[0].engine : null, engines: [...new Set(rs.map((r) => r.engine))] }; };
  const abOf = (A, B) => !A.trials || !B.trials ? 'UNMEASURED' : B.wilson95[0] > A.wilson95[1] ? 'B BEATS A — its interval lies wholly above' : A.wilson95[0] > B.wilson95[1] ? 'A BEATS B — B is worse' : 'NO DIFFERENCE THE COUNT SUPPORTS — the intervals overlap';
  const predictionFor = (eng, A, B) => eng === THINKING_ENGINE ? (!A.trials ? 'UNMEASURED' : A.landed === 0 && A.with_calls > A.trials / 2 ? 'FALSIFIED — A landed 0 while most trials called tools: the brief, not the weights' : A.rate >= 0.05 && A.rate <= 0.2 ? 'HELD — A landed within 5–20 %' : `MISSED — A landed ${A.rate} (predicted 5–20 %)`) : eng === NOTHINK_ENGINE ? nothinkPrediction(A, B) : `none on record for ${eng}`;
  const by_engine = Object.fromEntries([...new Set([THINKING_ENGINE, ...rows.map((r) => r.engine).filter(Boolean)])].map((eng) => { const a = arm('A', eng), b = arm('B', eng); return [eng, { A: a, B: b, ab: abOf(a, b), prediction: predictionFor(eng, a, b) }]; }));
  const { A, B, ab, prediction } = by_engine[THINKING_ENGINE];
  return { at: new Date().toISOString(), invalid, contended_excluded: contended, contended_load: CONTENDED_LOAD, ledger: ledger.startsWith(REPO) ? ledger.slice(REPO.length + 1) : ledger, thinking: 'on (D2a — goose cannot send think:false)', ts_parse: `UNMEASURED — ${TOOL_PARSE_UNMEASURED}`, prediction_A: '5–20 % landed', A, B, prediction, ab, by_engine };
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--freeze')) { freeze({ limit: Number(flag('--limit')) || 6000 }); process.exit(0); }
  if (argv.includes('--record')) { const c = calibration({ since: flag('--since') || null }); mkdirSync(dirname(CALIBRATION), { recursive: true }); writeFileSync(CALIBRATION, JSON.stringify(c, null, 1) + '\n'); for (const v of ['A', 'B']) console.log(`${v}: ${missesLine(c[v].misses)}`); console.log(`TS parse half: ${c.ts_parse}`); console.log(`A ${c.A.landed}/${c.A.trials} [${c.A.wilson95}] · B ${c.B.landed}/${c.B.trials} [${c.B.wilson95}] · prediction: ${c.prediction} · A/B: ${c.ab} · ${invalidLine(c.invalid)} (not counted) → ${CALIBRATION}`); for (const [e, x] of Object.entries(c.by_engine)) if (e !== THINKING_ENGINE) console.log(`${e}: A ${x.A.landed}/${x.A.trials} [${x.A.wilson95}] · B ${x.B.landed}/${x.B.trials} [${x.B.wilson95}] · A/B: ${x.ab} · prediction: ${x.prediction}\n  A: ${missesLine(x.A.misses)}\n  B: ${missesLine(x.B.misses)}`); process.exit(0); }
  if (argv.includes('--legibility')) { for (const r of legibility({ since: flag('--since') || null, variant: flag('--variant') || null })) console.log(`${String(r.rate).padEnd(5)} [${r.wilson95.join(', ')}] ${r.landed}/${r.K} · ${r.key}${r.invalid ? ` · invalid ${r.invalid} (not counted)` : ''} · ${missesLine(r.misses)}`); process.exit(0); }
  if (argv.includes('--report')) { const rp = report({ since: flag('--since') || null }); for (const [k, a] of Object.entries(rp)) console.log(`${k}: ${a.misses_line}`); console.log(`TS parse half: UNMEASURED — ${TOOL_PARSE_UNMEASURED}`); console.log(JSON.stringify(rp, null, 1)); process.exit(0); }
  let b; try { b = JSON.parse(readFileSync(BASIN, 'utf8')); } catch { console.error(`no frozen basin at ${BASIN} — run --freeze first`); process.exit(2); }
  if (argv.includes('--list')) { for (const t of b.tasks) console.log(`${t.sha.slice(0, 10)} ${t.kind} ${t.lines} ${t.file} — ${t.subject.slice(0, 80)}`); console.log(`${b.tasks.length} tasks · frozen ${b.at} at ${b.head.slice(0, 10)}`); process.exit(0); }
  if (!argv.includes('--dry-run')) await (await import('./heavy-lock.mjs')).holdOrExit('replay-bench');   // C287: one heavy job at a time on local metal
  const kind = flag('--kind'); const n = Number(flag('--n')) || b.tasks.length; const K = Number(flag('--k')) || 1; const variants = (flag('--variant') || 'A').split(',');   // C271: A,B interleaves per task and k — both arms see the same machine hour
  const tasks = b.tasks.filter((t) => !kind || t.kind === kind).slice(0, n);
  console.log(`replay-bench: ${tasks.length} task(s) × K ${K} · variant ${variants.join(' ⇄ ')}${flag('--model') ? ` · model ${flag('--model').split(',').join(' ⇄ ')}` : ''}${flag('--worker') ? ' · stub worker' : ''} → ${LEDGER}`);
  const models = flag('--model') ? flag('--model').split(',') : [null];   // C288: arms = variant × model — the tag is a dial, stamped on every row
  const run = await runArms({ tasks, K, variants, models, maxOpenings: flag('--max-openings') != null ? Number(flag('--max-openings')) : MAX_OPENINGS, dial: flag('--dial') || null, worker: flag('--worker') || null, dryRun: argv.includes('--dry-run') });   // C286: a dead arm is frozen, all dead halts
  console.log(JSON.stringify(report(), null, 1));
  if (run.halted) { console.log(`parameter failure: ${run.signature} — every arm frozen after 5 same-signature trials (C286)`); process.exit(0); }
}
