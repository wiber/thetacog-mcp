#!/usr/bin/env node
// scripts/vna/resident-client.mjs — C184a THE HOOK ASKS A RESIDENT RUST PROCESS (docs/specs/vna/SPEC-VNA-COCKPIT.md).
//
// The per-tool-call hook (steer-hook.mjs on PostToolUse) used to JSON.parse the 52 MB spec tree in-process on every
// turn that carried a fresh ledger row (peak RSS 413 MB, measured by C171a's mass pass). The tree now lives ONCE, in
// `pmu-onchip --resident --socket <sock> --tree <spec-tree.json>` (.thetacog/pmu/src/resident.rs): a lean index keyed by
// meta.rowSha, re-read only when the file's (len, mtime) moves. This module is TRANSPORT ONLY (MAXIMISE RUST: node
// stays for spawning, sockets and file shuttling): one request line over the unix socket, one response line back,
// a 50 ms door, and a small cache of the last answers so a turn with the resident down still prints its block.
//
//   askResident(req, { sock, timeoutMs })     → { reply } | { err }
//   treeNodesFor(shas, { treePath })          → { resident: 'ok'|'not running'|'timeout'|'error', views: Map<sha, node[]|null>, cached: Set<sha> }
//   ensureResident({ sock, tree, bin })        → detached spawn of the resident when none answers (once per 10 s)
//   placeSpans(spans, opts)                   → C2409: the resident's `place` op (async), one-shot `--place-batch` when it does not answer
//   placeSpansSync(spans, opts)               → the same, synchronously, for the sync callers (walk-door.mjs lensWalk): the request rides
//                                               one `nc -U` exchange (a 10–30 ms spawn of a 30 KB tool, measured 2026-11-05, never a node start)
//   askResidentSync(req, { sock, timeoutMs }) → { reply } | { err }
//
//   node scripts/vna/resident-client.mjs --ping | --start | --stop
//
// Env: PMU_RESIDENT_SOCK (socket path) · PMU_RESIDENT_AUTOSTART=0 (never spawn — the guard's door) ·
//      VNA_TREE_VIEW_CACHE (the cache file) · PMU_BINARY (the crate binary, as everywhere else).
import { createConnection } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, utimesSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';
import { loadPerCoreNow } from '../../src/lib/pmu/walk-budget.mjs';   // C2602a: the one load reading walkBudget takes
// C575 round 2: --resident/--socket/--start/--stop/--tree have no napi route (data/vna/linux-
// fallback-inventory.json) — a host-mismatched binary now guards to null, tripping the existing
// `!bin || !existsSync(bin)` check below exactly as an ABSENT binary already did. Byte-identical on
// a matching host (the SAME path either way).
import { guardBinary } from '../pmu/engine-resolve.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RESIDENT_SOCK = process.env.PMU_RESIDENT_SOCK || resolve(REPO, '.thetacog/pmu-resident.sock');
export const TREE_VIEW_CACHE = process.env.VNA_TREE_VIEW_CACHE || resolve(REPO, '.thetacog/vna-tree-view-cache.json');
export const RESIDENT_TIMEOUT_MS = 50;      // the door: a hook never waits longer than this for the resident
export const CACHE_ENTRIES = 64;            // newest answers kept; a fresh-row turn asks for at most a handful
const START_GAP_MS = 10_000;                // one autostart attempt per 10 s, however many hooks fire meanwhile

export function askResident(req, { sock = RESIDENT_SOCK, timeoutMs = RESIDENT_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    let buf = '', settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); try { c.destroy(); } catch {} done(v); } };
    const timer = setTimeout(() => finish({ err: 'timeout' }), timeoutMs);
    const c = createConnection({ path: sock });
    c.on('connect', () => c.write(JSON.stringify(req) + '\n'));
    c.on('data', (d) => { buf += d; const nl = buf.indexOf('\n'); if (nl >= 0) { try { finish({ reply: JSON.parse(buf.slice(0, nl)) }); } catch (e) { finish({ err: `bad reply: ${String(e.message || e).slice(0, 80)}` }); } } });
    c.on('error', (e) => finish({ err: e.code || String(e.message || e).slice(0, 80) }));
    c.on('close', () => finish({ err: 'closed' }));
  });
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function residentPid(sock = RESIDENT_SOCK) { try { const pid = Number(readFileSync(`${sock}.pid`, 'utf8').trim()); return Number.isInteger(pid) && pidAlive(pid) ? pid : null; } catch { return null; } }

// Start one when none answers. The resident binds its socket BEFORE warming the tree (~0.6 s on the live 52 MB
// tree), so a hook firing inside that window times out at the door and prints from cache — never waits.
export function ensureResident({ sock = RESIDENT_SOCK, tree = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json'), bin = resolvePmuBinary(REPO), spawnFn = spawn, now = Date.now() } = {}) {
  bin = guardBinary(bin, { flags: ['--resident', '--socket', '--start', '--stop', '--tree'] });
  if (process.env.PMU_RESIDENT_AUTOSTART === '0') return { started: false, why: 'PMU_RESIDENT_AUTOSTART=0' };
  if (residentPid(sock)) return { started: false, why: 'pid alive' };
  if (!bin || !existsSync(bin)) return { started: false, why: 'binary absent' };
  const stamp = `${sock}.starting`;
  try { if (now - statSync(stamp).mtimeMs < START_GAP_MS) return { started: false, why: 'started recently' }; } catch {}
  try { mkdirSync(dirname(sock), { recursive: true }); writeFileSync(stamp, `${now}\n`); utimesSync(stamp, new Date(now), new Date(now)); } catch {}
  try {
    const c = spawnFn(bin, ['--resident', '--socket', sock, '--tree', tree], { cwd: REPO, detached: true, stdio: 'ignore', env: { ...process.env } });
    c.unref();
    return { started: true, pid: c.pid };
  } catch (e) { return { started: false, why: String(e.message || e).slice(0, 80) }; }
}

function readCache(path) { try { const c = JSON.parse(readFileSync(path, 'utf8')); return c && typeof c === 'object' ? c : {}; } catch { return {}; } }
function writeCache(path, cache) {
  const keys = Object.keys(cache).sort((a, b) => (cache[b].at || '').localeCompare(cache[a].at || '')).slice(0, CACHE_ENTRIES);
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(Object.fromEntries(keys.map((k) => [k, cache[k]])))); } catch {}
}

// The tree's nodes for each ledger row sha — from the resident when it answers, from the last cached answer when it
// does not. `views.get(sha)` is the node list treeViewOfRow(nodes, row) takes (the same filter, so the printed block
// is byte-identical to the in-process read), or null when nothing is known for that row this turn.
export async function treeNodesFor(shas, { sock = RESIDENT_SOCK, treePath = null, cachePath = TREE_VIEW_CACHE, timeoutMs = RESIDENT_TIMEOUT_MS, autostart = true } = {}) {
  const views = new Map(), cached = new Set();
  const cache = readCache(cachePath);
  let resident = 'ok', dirty = false, firstErr = null;
  for (const sha of [...new Set(shas.filter(Boolean))]) {
    const r = resident === 'ok' ? await askResident({ op: 'tree-nodes', id: sha.slice(0, 12), rowSha: sha, ...(treePath ? { path: treePath } : {}) }, { sock, timeoutMs }) : { err: firstErr };
    if (r.reply && !r.reply.error && Array.isArray(r.reply.nodes)) {
      const nodes = [...r.reply.nodes, ...(r.reply.inBasins || [])];
      views.set(sha, nodes);
      if (nodes.length) { cache[sha] = { at: new Date().toISOString(), nodes }; dirty = true; }
      continue;
    }
    if (resident === 'ok') { firstErr = r.err || (r.reply && r.reply.error) || 'error'; resident = /ENOENT|ECONNREFUSED|closed/.test(firstErr) ? 'not running' : firstErr === 'timeout' ? 'timeout' : 'error'; }
    if (cache[sha] && Array.isArray(cache[sha].nodes)) { views.set(sha, cache[sha].nodes); cached.add(sha); } else views.set(sha, null);
  }
  if (dirty) writeCache(cachePath, cache);
  if (resident === 'not running' && autostart) ensureResident({ sock, tree: treePath || undefined });
  return { resident, why: firstErr, views, cached };
}

// C318g: {op:"drift", leaf} — ungraded(tree, {leaf})'s total + hash8 list, straight off the resident's
// own index, no tree in this process at all. Unlike treeNodesFor this never autostarts on a miss: the
// caller's own local computation (driftLine, spec-tree.mjs) IS the fallback (C318a/b's cache keeps
// serving), so a cold resident is never this function's problem to fix.
export async function driftForLeaf(leafId, { sock = RESIDENT_SOCK, treePath = null, timeoutMs = RESIDENT_TIMEOUT_MS } = {}) {
  const r = await askResident({ op: 'drift', id: String(leafId).slice(0, 24), leaf: leafId, ...(treePath ? { path: treePath } : {}) }, { sock, timeoutMs });
  if (r.reply && !r.reply.error && typeof r.reply.total === 'number' && Array.isArray(r.reply.hash8)) return { ok: true, total: r.reply.total, hash8: r.reply.hash8 };
  return { ok: false, why: r.err || (r.reply && r.reply.error) || 'error' };
}

// ── C2409 THE PLACE DOOR ─────────────────────────────────────────────────────────────────────────────────────────────────
// A span is { id, bytes } | { id, path, start?, end? } | { id, blob }. The resident answers one placement per span (place.rs:
// walk_lens::read_text per distinct miss, a content-addressed cache keyed sha256(bytes) + aperture hash). When it does not answer,
// the one-shot `pmu-onchip --place-batch` runs the SAME place.rs on the SAME cache file — so nothing blocks on a resident that is
// down, and a fallback answer is byte-identical to a resident answer. `session` (+ receiptsDir, before) walks WITH the session
// thread and is never cached (the resident says cached:false). Every answer says which door served it: via resident | one-shot.
export const PLACE_TIMEOUT_MS = 10_000;
const NC = process.env.PMU_NC || '/usr/bin/nc';
// read per call (never frozen at import): a test or the bench points PMU_RESIDENT_SOCK at its own resident after this module loaded
const sockNow = () => process.env.PMU_RESIDENT_SOCK || RESIDENT_SOCK;
const placeReq = (spans, { args = [], maxChars = null, session = null, receiptsDir = null, before = null } = {}) => ({ op: 'place', id: `p${process.pid}-${Date.now()}`, spans, args, ...(maxChars ? { max_chars: maxChars } : {}), ...(session ? { session: String(session), ...(receiptsDir ? { receipts_dir: receiptsDir } : {}), ...(before ? { before: String(before) } : {}) } : {}) });
const oneShotArgs = ({ args = [], maxChars = null, session = null }) => ['--place-batch', ...args, ...(maxChars ? ['--max-chars', String(maxChars)] : [])];
// ── THE STALE RESIDENT HEALS ITSELF (measured 2026-11-05 by cuo2: the live resident, started 26 Oct, answered "unknown op: place"
// for every moved call site; each fell through to the spawn, every guard stayed green because the fallback worked, and the production
// upside was zero and invisible). ensureResident() only starts a resident when none is alive, so an OLD live one was never replaced.
// Now: a reply whose error says "unknown op" means the binary on disk has outgrown the process. The client sends shutdown, waits
// ≤ 200 ms for that pid to exit, and calls ensureResident() once (its 10 s start stamp debounces a herd of hooks), the same command
// line the resident was always started with (--socket <sock> --tree <spec-tree.json>). One line per heal on the via-resident ledger.
//
// THE VIA-RESIDENT LEDGER (.thetacog/via-resident.ndjson, PMU_VIA_RESIDENT_LEDGER overrides): one row per place call —
// { at, kind: 'place', via: 'resident'|'one-shot'|null, why, n, hits, misses, caller } — and one per heal { kind: 'heal', … }.
// viaResidentShare() reads it: the share of place calls the resident actually answered. A fallback is counted as a fallback,
// never as the upside. (The tape's walk_route carries the same per-walk fact for lensWalk rows.)
export const VIA_LEDGER = process.env.PMU_VIA_RESIDENT_LEDGER || resolve(REPO, '.thetacog/via-resident.ndjson');
const ledger = (row, path = process.env.PMU_VIA_RESIDENT_LEDGER || VIA_LEDGER) => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...row }) + '\n'); } catch {} };
const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
export const STALE_OP = /^unknown op/;
/** a resident that answered "unknown op": shut it down, wait ≤ waitMs for its pid, start the binary on disk once */
export function healStaleResident(why, { sock = sockNow(), waitMs = 200, ask = askResidentSync, ensure = ensureResident, pidOf = residentPid, alive = pidAlive } = {}) {
  if (!STALE_OP.test(String(why || ''))) return { healed: false };
  const pid = pidOf(sock);
  ask({ op: 'shutdown', id: 'heal' }, { sock, timeoutMs: 500 });
  const t0 = Date.now(); while (pid && alive(pid) && Date.now() - t0 < waitMs) sleepMs(10);
  const started = ensure({ sock });
  ledger({ kind: 'heal', why: String(why).slice(0, 80), old_pid: pid, old_alive: pid ? alive(pid) : null, waited_ms: Date.now() - t0, started });
  return { healed: true, old_pid: pid, started };
}
/** the share of place calls the resident answered, over the ledger's last `hours` */
export function viaResidentShare({ path = process.env.PMU_VIA_RESIDENT_LEDGER || VIA_LEDGER, hours = 24, now = Date.now() } = {}) {
  let rows = []; try { rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  const since = now - hours * 36e5; const calls = rows.filter((r) => r.kind === 'place' && Date.parse(r.at) >= since);
  const byVia = {}; for (const r of calls) byVia[r.via ?? 'none'] = (byVia[r.via ?? 'none'] || 0) + 1;
  const n = calls.length, viaRes = byVia.resident || 0;
  return { hours, n, via: byVia, share: n ? +(viaRes / n).toFixed(4) : null, state: n ? 'measured' : 'UNMEASURED', heals: rows.filter((r) => r.kind === 'heal' && Date.parse(r.at) >= since).length };
}
const okReply = (r) => r && r.reply && !r.reply.error && Array.isArray(r.reply.placements) ? r.reply : null;

/** one request line over the socket, synchronously: `nc -U` carries it, the reply is the first line back */
export function askResidentSync(req, { sock = sockNow(), timeoutMs = RESIDENT_TIMEOUT_MS, nc = NC, exec = execFileSync } = {}) {
  if (!existsSync(sock)) return { err: 'ENOENT' };
  try {
    const out = exec(nc, ['-U', sock], { input: JSON.stringify(req) + '\n', encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] });
    const line = String(out).split('\n')[0];
    if (!line) return { err: 'closed' };
    try { return { reply: JSON.parse(line) }; } catch (e) { return { err: `bad reply: ${String(e.message || e).slice(0, 80)}` }; }
  } catch (e) { return { err: e && e.code === 'ETIMEDOUT' ? 'timeout' : (e && e.signal === 'SIGTERM' ? 'timeout' : String(e && e.code || e && e.message || e).slice(0, 80)) }; }
}

function oneShotSync(spans, opts, bin) {
  if (opts.session) return { err: 'one-shot: --place-batch walks session-free bytes only' };
  if (!bin || !existsSync(bin)) return { err: 'binary absent' };
  try {
    const out = execFileSync(bin, oneShotArgs(opts), { cwd: REPO, input: spans.map((x) => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: opts.timeoutMs || PLACE_TIMEOUT_MS, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] });
    const placements = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { reply: { placements, aperture: placements.find((x) => x.aperture)?.aperture ?? null } };
  } catch (e) { return { err: String(e && e.message || e).slice(0, 120) }; }
}

/** synchronous place: the resident first, the one-shot binary when it does not answer (or answers an older binary's "unknown op") */
export function placeSpansSync(spans, { sock = sockNow(), timeoutMs = PLACE_TIMEOUT_MS, bin = resolvePmuBinary(REPO), oneShot = true, caller = null, heal = {}, ...opts } = {}) {
  const out = placeSpansSyncInner(spans, { sock, timeoutMs, bin, oneShot, heal, ...opts });
  ledger({ kind: 'place', lpc: +loadPerCoreNow().toFixed(2), via: out.via, why: out.via === 'resident' ? null : String(out.residentWhy || out.why || '').slice(0, 80), n: spans.length, hits: out.hits ?? null, misses: out.misses ?? null, caller });
  return out;
}
function placeSpansSyncInner(spans, { sock, timeoutMs, bin, oneShot, heal, ...opts }) {
  const r = askResidentSync(placeReq(spans, opts), { sock, timeoutMs });
  const rep = okReply(r);
  if (rep) return { via: 'resident', ...rep };
  const why = r.err || (r.reply && r.reply.error) || 'error';
  healStaleResident(why, { sock, ...heal });   // an old live resident: replaced now, so the NEXT call is served (this one falls through)
  if (!oneShot || why === 'timeout') return { via: null, why, placements: null };   // a timeout already spent the budget: never walk it twice
  const o = oneShotSync(spans, { ...opts, timeoutMs }, bin);
  return o.reply ? { via: 'one-shot', residentWhy: why, ...o.reply } : { via: null, why: `resident: ${why} · one-shot: ${o.err}`, placements: null };
}

/** async place — the same doors, for callers already in an async context */
export async function placeSpans(spans, { sock = sockNow(), timeoutMs = PLACE_TIMEOUT_MS, bin = resolvePmuBinary(REPO), oneShot = true, caller = null, heal = {}, ...opts } = {}) {
  const out = await placeSpansInner(spans, { sock, timeoutMs, bin, oneShot, heal, ...opts });
  ledger({ kind: 'place', lpc: +loadPerCoreNow().toFixed(2), via: out.via, why: out.via === 'resident' ? null : String(out.residentWhy || out.why || '').slice(0, 80), n: spans.length, hits: out.hits ?? null, misses: out.misses ?? null, caller });
  return out;
}
async function placeSpansInner(spans, { sock, timeoutMs, bin, oneShot, heal, ...opts }) {
  const r = await askResident(placeReq(spans, opts), { sock, timeoutMs });
  const rep = okReply(r);
  if (rep) return { via: 'resident', ...rep };
  const why = r.err || (r.reply && r.reply.error) || 'error';
  healStaleResident(why, { sock, ...heal });
  if (!oneShot || why === 'timeout') return { via: null, why, placements: null };
  if (opts.session) return { via: null, why: `resident: ${why} · one-shot: session-free bytes only`, placements: null };
  if (!bin || !existsSync(bin)) return { via: null, why: `resident: ${why} · one-shot: binary absent`, placements: null };
  const out = await new Promise((done) => {
    const c = spawn(bin, oneShotArgs(opts), { cwd: REPO, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = ''; const t = setTimeout(() => { try { c.kill(); } catch {} done(null); }, timeoutMs);
    c.stdout.on('data', (d) => { buf += d; });
    c.on('error', () => { clearTimeout(t); done(null); });
    c.on('close', (code) => { clearTimeout(t); done(code === 0 ? buf : null); });
    c.stdin.end(spans.map((x) => JSON.stringify(x)).join('\n') + '\n');
  });
  if (out == null) return { via: null, why: `resident: ${why} · one-shot: failed`, placements: null };
  const placements = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { via: 'one-shot', residentWhy: why, placements, aperture: placements.find((x) => x.aperture)?.aperture ?? null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.includes('--share')) { console.log(JSON.stringify(viaResidentShare({ hours: Number(a[a.indexOf('--share') + 1]) || 24 }))); }
  else if (a.includes('--start')) { console.log(JSON.stringify(ensureResident())); }
  else if (a.includes('--stop')) { askResident({ op: 'shutdown', id: 0 }, { timeoutMs: 1000 }).then((r) => console.log(JSON.stringify(r))); }
  else { askResident({ op: 'ping', id: 0 }, { timeoutMs: 1000 }).then((r) => { console.log(JSON.stringify({ sock: RESIDENT_SOCK, pid: residentPid(), ...r })); process.exit(r.reply ? 0 : 1); }); }
}
