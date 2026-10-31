#!/usr/bin/env node
// scripts/vna/conscience-watch.mjs — C612g: THE CONSCIENCE RE-READS ON THE RUN. LLM-FREE.
//
// Operator 2026-10-03: "it needs to be running while the round runs and on the run". The pre-run drift note (C610g, drift-note.mjs)
// reads the row's declaration once, before the worker wakes. This module keeps reading while the worker runs: each time the
// worker's uncommitted diff changes, the fast tier re-places the diff against the note and, when the set of paths (or the rules
// they carry) OUTSIDE the note's named paths changed, appends ONE line to the round sidecar: what was entered, what was left.
//
// REVISED 2026-10-03 (the row's acceptance, efea97971e): DEBOUNCED and TRACKED-ONLY. The diff is `git diff --name-only HEAD`
// over TRACKED files — untracked files, temp files (.swp, ~, .tmp, .orig) and build output (dist/, build/, .next/, node_modules/,
// target/, coverage/) are never read. A change re-places only after a QUIET WINDOW (500 ms with no further change), so a burst of
// edits is one re-read, and a re-read is SINGLE-FLIGHT: never two at once, and never a second process (the placement runs in
// this process; the only child is the bounded git read).
//
// "Its own paths": the tree is shared with other sessions and daemons, so the watch snapshots every tracked dirty path (with its
// mtime and size) when it starts, and a path counts as the worker's only once its stat differs from that baseline or it appears
// new. Reverting a file back to HEAD drops it out of the set, and that reads as LEFT.
//
// THE FAST TIER (C612a's, built in parallel): the interface is one function,
//     place({ paths, named, note, repo }) → { inside: [path], outside: [path], rules: { [path]: [rule] } }
// The default here (fastPlace) is the narrow version: a path is inside when it equals, or sits under, a named path (the brief's
// targets ∪ the note's own files); the rules for an outside path are read off scripts/ops/rules-for.mjs (its @guard lines and the
// CLAUDE.md sections that name it), the cheap path-keyed reader. C612a's fast tier plugs in through the `place` option.
//
// THE ROUND SIDECAR carries two line kinds: KIND_REREAD (this watch: entered / left) and KIND_DOOR (C612a's slow-tier door panel,
// appended mid-round by drift-note.mjs startDoorTier, so the worker is never blind until the close). The worker reads one file; this
// module only appends, never truncates, so a door line and a re-read line sit side by side in arrival order.
//
// A READING, NEVER A GATE. Nothing in this module signals, waits on, or holds the worker: the poll is an unref'd timer, the git
// read is async and takes no index lock (GIT_OPTIONAL_LOCKS=0, so the worker's own commit never meets a lock it left), every
// failure is swallowed into the record, and the line carries no gate word. stop() only ends the polling, with one final
// placement so an edit just before the exit still lands.
//
// SUFFICIENT FOR: which paths and rules the round entered or left against the note while it ran, at the fast-tier cost.
// NOT SUFFICIENT FOR: whether leaving the note was wrong, or whether the work was good (Rice). A line is information for the
// worker, the close and C612c's path-prediction read, never an instruction.
//
// Rust port row: C612g-rs — the stat diff and the inside/outside placement move into pmu-onchip beside C612a's fast tier (one
// long-lived call); node keeps the timer and the sidecar append (transport, which stays node under MAXIMISE RUST).
//
// @guard tests/vna/c612g-the-conscience-re-reads-on-the-run.test.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { roundSidecarPath } from './round-sidecar.mjs';   // C612i: the light home (drift-note.mjs re-exports it) — the hook loads this module per write

const run = promisify(execFile);
export const KIND_REREAD = 'conscience re-read (C612g)';
export const KIND_DOOR = 'door';   // C612a's startDoorTier (drift-note.mjs) appends these; this module never writes or rewrites them
export const KIND = KIND_REREAD;
export const SUFFICIENT_FOR = 'which paths and rules the round entered or left against the note while it ran';
export const NOT_SUFFICIENT_FOR = 'whether leaving the note was wrong, or whether the work was good (Rice)';
export const DEFAULT_INTERVAL_MS = 250;
export const QUIET_MS = 500;
/** never the worker's diff: the runner's own state, temp files, build output */
export const IGNORE_RE = /^\.thetacog\/|(^|\/)(node_modules|dist|build|\.next|target|coverage|out)\/|\.swp$|\.swo$|~$|\.tmp$|\.orig$|\.rej$|(^|\/)\.#|(^|\/)#[^/]*#$/;

/** The round sidecar's one home is drift-note.mjs (C612a): <n>-<label>.round.ndjson — re-exported, never redefined. */
export { roundSidecarPath };

const norm = (p) => String(p || '').replace(/^\.\//, '').replace(/\/+$/, '');
const covers = (path, named) => { const a = norm(path), b = norm(named); return !!b && (a === b || a.startsWith(b + '/')); };

/** The tracked paths that differ from HEAD, each with a stat key (absent file → 'gone'). Async, lock-free; null on failure. */
export async function trackedDiffStat(repo, { ignore = IGNORE_RE } = {}) {
  let out = '';
  try { out = (await run('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: repo, maxBuffer: 1 << 26, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout; }
  catch { return null; }
  const m = new Map();
  for (const p of out.split('\0')) {
    if (!p || ignore.test(p)) continue;
    let key = 'gone'; try { const s = statSync(join(repo, p)); key = `${s.mtimeMs}:${s.size}`; } catch {}
    m.set(p, key);
  }
  return m;
}

let rulesForMod = null;
/** The default rules reader: the @guard lines and CLAUDE.md sections that name each path (rules-for.mjs). Never throws. */
export async function rulesOf(paths, repo) {
  if (!paths.length) return {};
  try { rulesForMod = rulesForMod || await import('../ops/rules-for.mjs'); } catch { return {}; }
  const out = {};
  for (const p of paths) {
    try {
      const r = rulesForMod.rulesFor([isAbsolute(p) ? p : resolve(repo, p)]);
      out[p] = [...new Set([...(r.guards || []).map((g) => `guard ${g}`), ...(r.claude || []).map((c) => `CLAUDE.md ${c.title}`)])];
    } catch { out[p] = []; }
  }
  return out;
}

/** The narrow fast tier: inside = under a named path; outside paths carry their rules. C612a's place() replaces this. */
export async function fastPlace({ paths = [], named = [], repo = process.cwd(), rules = rulesOf } = {}) {
  const inside = [], outside = [];
  for (const p of paths) (named.some((n) => covers(p, n)) ? inside : outside).push(p);
  return { inside, outside, rules: await rules(outside, repo) };
}

const sigOf = (own) => [...own.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, k]) => `${p}\t${k}`).join('\n');
const minus = (a, b) => a.filter((x) => !b.includes(x));

/**
 * startConscienceWatch — poll the worker's tracked diff while it runs; after a quiet window, re-place it; one sidecar line per
 * change of what lies outside the note.
 *   repo, label, n, note (the drift note), named (the brief's targets), sidecar (path), intervalMs, quietMs, place (the fast tier).
 * Returns { tick, stop, state }. tick() is one poll (single-flight); stop() ends the timer after one final placement.
 */
export async function startConscienceWatch({ repo, label = null, n = null, note = null, named = [], sidecar, intervalMs = DEFAULT_INTERVAL_MS, quietMs = QUIET_MS, place = fastPlace, ignore = IGNORE_RE, now = () => new Date().toISOString(), clock = () => performance.now() } = {}) {
  const namedAll = [...new Set([...(named || []), ...((note && note.files) || [])].map(norm).filter(Boolean))];
  const baseline = (await trackedDiffStat(repo, { ignore })) || new Map();
  const state = { polls: 0, reads: 0, placements: 0, lines: 0, errors: [], read_ms: [], poll_ms: [], outside: [], rules: [], seen: '', placed: '', changedAt: null, active: 0, max_active: 0, stopped: false };
  const sideRel = sidecar ? relative(repo, sidecar) : null;
  let inFlight = null;

  const placeNow = async (own, t0) => {
    const paths = [...own.keys()].filter((p) => own.get(p) !== 'clean');   // a reverted path is no longer in the diff
    const pl = await place({ paths, named: namedAll, note, repo });
    state.placements++; state.reads++;
    const outside = [...new Set(pl.outside || [])].sort();
    const rules = [...new Set(outside.flatMap((p) => (pl.rules && pl.rules[p]) || []))].sort();
    const eP = minus(outside, state.outside), lP = minus(state.outside, outside), eR = minus(rules, state.rules), lR = minus(state.rules, rules);
    state.outside = outside; state.rules = rules;
    state.read_ms.push(+(clock() - t0).toFixed(1));
    if (!eP.length && !lP.length && !eR.length && !lR.length) return null;
    const line = { v: 1, kind: KIND_REREAD, at: now(), label, n, read: state.reads, entered: { paths: eP, rules: eR }, left: { paths: lP, rules: lR },
      outside_now: outside, named: namedAll.length, ms: state.read_ms[state.read_ms.length - 1],
      text: `${label || 'round'} re-read ${state.reads}: entered ${eP.length ? eP.join(', ') : '—'}${eR.length ? ` (rules ${eR.join('; ')})` : ''} · left ${lP.length ? lP.join(', ') : '—'}${lR.length ? ` (rules ${lR.join('; ')})` : ''} — against the note's ${namedAll.length} named paths. A reading for the worker and the close, not an instruction.`,
      sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR };
    if (sidecar) { try { mkdirSync(dirname(sidecar), { recursive: true }); appendFileSync(sidecar, JSON.stringify(line) + '\n'); state.lines++; } catch (e) { state.errors.push(`append: ${String(e.message).slice(0, 80)}`); } }
    return line;
  };

  const poll = async (force) => {
    const t0 = clock();
    state.active++; state.max_active = Math.max(state.max_active, state.active);
    try {
      const cur = await trackedDiffStat(repo, { ignore });
      if (!cur) { state.errors.push('git diff failed'); return null; }
      state.polls++;
      const own = new Map();
      for (const [p, k] of cur) if (baseline.get(p) !== k && p !== sideRel) own.set(p, k);
      for (const p of baseline.keys()) if (!cur.has(p)) own.set(p, 'clean');   // a baseline path the worker reverted to HEAD
      const sig = sigOf(own);
      if (sig !== state.seen) { state.seen = sig; state.changedAt = clock(); if (!force) return null; }   // a change starts the quiet window
      if (sig === state.placed) return null;                                                                // nothing new since the last placement
      if (!force && clock() - state.changedAt < quietMs) return null;                                       // still inside the quiet window
      state.placed = sig;
      return await placeNow(own, t0);
    } catch (e) { state.errors.push(String(e && e.message || e).slice(0, 120)); return null; }
    finally { state.active--; state.poll_ms.push(+(clock() - t0).toFixed(1)); }
  };
  const tick = (force = false) => { if (!inFlight) inFlight = poll(force).finally(() => { inFlight = null; }); return inFlight; };   // single-flight
  const timer = setInterval(() => { if (!state.stopped) tick(); }, Math.max(25, intervalMs));
  if (timer.unref) timer.unref();
  const stop = async () => {
    if (state.stopped) return state; state.stopped = true; clearInterval(timer);
    try { if (inFlight) await inFlight; await tick(true); } catch {}
    return state;
  };
  return { tick, stop, state };
}

/** median [min,max] n of a list of ms — never a lone point value */
export function costLine(ms = []) {
  const a = [...ms].sort((x, y) => x - y); if (!a.length) return 'cost: no reads';
  const med = a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  return `cost: median ${med.toFixed(1)} ms [${a[0].toFixed(1)}, ${a[a.length - 1].toFixed(1)}] n ${a.length}`;
}

// CLI: measure the steady-state poll and a forced placement on a repo — `node scripts/vna/conscience-watch.mjs --bench [N]`
async function main() {
  const i = process.argv.indexOf('--bench'); if (i < 0) { console.error('usage: node scripts/vna/conscience-watch.mjs --bench [N] [--repo <dir>]'); process.exit(2); }
  const N = Number(process.argv[i + 1]) || 10; const r = process.argv.indexOf('--repo');
  const repo = r >= 0 ? process.argv[r + 1] : resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
  const w = await startConscienceWatch({ repo, label: 'bench', named: [], intervalMs: 1e9 });
  for (let k = 0; k < N; k++) { w.state.placed = null; await w.tick(true); }   // forced: every tick is a full re-read (git diff + placement)
  const s = await w.stop();
  console.log(`re-read ${costLine(s.read_ms.slice(0, N))} · poll ${costLine(s.poll_ms.slice(0, N))} · errors ${s.errors.length}`);
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((e) => { console.error(e); process.exit(1); });
