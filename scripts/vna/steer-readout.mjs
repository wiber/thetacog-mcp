// scripts/vna/steer-readout.mjs — C264 (U1) ONE SMALL READOUT. Operator 2026-09-25, verbatim: "Claude Code should not be asked to
// read 200MB ndjson streams or raw 10,000-line worker logs … A compact, deterministic query command that the skill calls:
// node scripts/vna/steer.mjs status --json". The four guarantees (asks txt N10–N13) end in this one: Claude, gemma and the ↻ pill
// read the SAME ~20 fields, recomputable from the record, instead of each re-deriving a story from the logs.
//
// A READER, NEVER A SECOND ANSWER. Every field is read off a door that already writes it:
//   runner.ndjson          dispatch / verdict / halt / learn rows (steer-runner.mjs)   → land_rate, halts_by_shape, active_row, last_landed
//   steer-loop.json        the last /steer pass's face (steer-until.mjs writeLoopState)  → state, loop {open, clear, stuck, needs}
//   steer.lock             the run-lock (C273), when it exists                          → owner, pid
//   asked-vs-built receipt regressedTicks() (steer-until.mjs, C186c) — imported, not re-read → regressed_ticks
//   the spec markdown      specTicks() (goal.mjs) — imported                              → open (every unticked row)
//   ollama-serve.log       "llama runner started" lines in the last hour                 → model_starts_last_hour (D1's falsifier)
// A missing source is a field that says so ({state:'not run'} / null + a why), never a zero.
// Port row: the readout decides nothing and holds no mass (a tail read), so it stays node (MAXIMISE RUST: transport/orchestration).
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specTicks } from './goal.mjs';
import { regressedTicks } from './steer-until.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PATHS = {
  runner: process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson'),
  loop: process.env.VNA_STEER_LOOP_JSON || resolve(REPO, '.thetacog/steer-loop.json'),
  lock: process.env.VNA_STEER_LOCK || resolve(REPO, '.thetacog/steer.lock'),
  spec: process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'),
  ollamaLog: process.env.VNA_OLLAMA_LOG || resolve(REPO, '.thetacog/cache/ollama-serve.log'),
};

const rows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; } };
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
/** the last `bytes` of a file — the server log is tens of MB; the last hour lives in its tail */
function tail(p, bytes = 4 << 20) {
  try { const n = statSync(p).size, len = Math.min(n, bytes), fd = openSync(p, 'r'), b = Buffer.alloc(len); readSync(fd, b, 0, len, n - len); closeSync(fd); return b.toString('utf8'); } catch { return null; }
}

/** a halt reason with its particulars (row ids, shas, numbers) replaced, cut at its first clause — the shape the host itself wrote */
export function haltShape(reason) {
  return String(reason || '').replace(/\b[0-9a-f]{7,40}\b/g, '<sha>').replace(/\bC\d+[a-z]*\d*(\.\d+)?\b/g, '<row>').replace(/\d+(\.\d+)?/g, 'N').split(/ · | — |: /)[0].trim().slice(0, 80) || '(empty)';
}

/** landed / dispatched over rows at or after `since` (ms). A landing is a verdict row with ok:true — the runner's own grade. */
export function landRate(rs, since = 0, engine = null) {
  const inW = (r) => (Date.parse(r.at) || 0) >= since && (!engine || String(r.engine || '').includes(engine));
  const dispatched = rs.filter((r) => r.kind === 'dispatch' && inW(r)).length;
  const landed = rs.filter((r) => r.kind === 'verdict' && r.ok === true && inW(r)).length;
  return { landed, dispatched };
}

export function readout({ paths = PATHS, now = Date.now() } = {}) {
  const rs = rows(paths.runner);
  const loop = json(paths.loop);
  const lock = json(paths.lock);
  let alive = false; if (lock && lock.pid) { try { process.kill(lock.pid, 0); alive = true; } catch { alive = false; } }
  const out = { at: new Date(now).toISOString() };
  out.state = lock && alive ? (lock.stop_after_row ? 'STOPPING' : 'RUNNING') : loop && loop.live ? 'RUNNING' : 'IDLE';
  out.owner = lock && alive ? lock.owner || null : null;
  out.pid = lock && alive ? lock.pid : loop && loop.live ? loop.pid : null;
  if (!rs) return { ...out, runner: 'not run', why: `no runner ledger at ${paths.runner}` };
  // the active row: the newest dispatch with no verdict/halt for its label after it
  const lastDispatch = [...rs].reverse().find((r) => r.kind === 'dispatch');
  const closed = lastDispatch && rs.some((r) => (r.kind === 'verdict' || r.kind === 'halt') && r.label === lastDispatch.label && r.at >= lastDispatch.at);
  out.active_row = lastDispatch && !closed && out.state !== 'IDLE' ? lastDispatch.label : null;
  out.active_engine = out.active_row ? lastDispatch.engine || null : null;
  out.runtime_sec = out.active_row ? Math.round((now - Date.parse(lastDispatch.at)) / 1000) : null;
  const lastOk = [...rs].reverse().find((r) => r.kind === 'verdict' && r.ok === true);
  out.last_landed = lastOk ? { row: lastOk.label, at: lastOk.at, engine: lastOk.engine || null, sha: lastOk.sha || lastOk.commit || null } : null;
  const day = now - 24 * 3600e3;
  out.land_rate = { last_24h: landRate(rs, day), all: landRate(rs), local_all: landRate(rs, 0, 'qwen') };
  const shapes = {}; for (const r of rs) if (r.kind === 'halt') { const k = haltShape(r.reason); shapes[k] = (shapes[k] || 0) + 1; }
  out.halts_by_shape = Object.fromEntries(Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 12));
  const lastLearn = [...rs].reverse().find((r) => r.kind === 'learn');
  out.last_learn = lastLearn ? { row: lastLearn.label, n_calls: lastLearn.n_calls, n_calls_total: lastLearn.n_calls_total ?? null, calls_by_session: lastLearn.calls_by_session ?? null, halt: haltShape(lastLearn.halt_reason), context: lastLearn.context_verdict || null } : null;
  let md = null; try { md = readFileSync(paths.spec, 'utf8'); } catch {}
  const ticks = md ? specTicks(md) : null;
  out.open = ticks ? Object.values(ticks).filter((v) => !v).length : null;
  out.loop = loop ? { at: loop.at, open: loop.open, clear: loop.clear, stuck: loop.stuck, needs_operator: loop.needs, last: loop.last ? loop.last.id : null } : null;
  const reg = regressedTicks({ md });
  out.regressed_ticks = reg.state === 'read' ? reg.rows.map((r) => r.id) : { state: reg.state };
  const log = tail(paths.ollamaLog);
  if (log == null) { out.model_starts_last_hour = null; out.model_starts_why = `no server log at ${paths.ollamaLog}`; }
  else {
    const hourAgo = now - 3600e3;
    out.model_starts_last_hour = log.split('\n').filter((l) => /llama runner started/.test(l)).map((l) => Date.parse((/time=(\S+)/.exec(l) || [])[1])).filter((t) => t >= hourAgo).length;
  }
  const newest = rs.length ? Date.parse(rs[rs.length - 1].at) : null;
  out.receipt_age_sec = newest ? Math.round((now - newest) / 1000) : null;
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(JSON.stringify(readout(), null, process.argv.includes('--pretty') ? 2 : 0));
