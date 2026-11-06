#!/usr/bin/env node
// scripts/vna/steer-lock.mjs — C273 (U10) ONE OWNER: THE RUN-LOCK. Operator 2026-09-25, verbatim: "A single, atomic run-lock at
// .thetacog/steer.lock containing the owner (claude-code, ui-checkbox, or cli), start timestamp, and PID." The overnight runner was
// launched twice, 12 minutes apart, and the two collided over the same files. Three doors (the Claude Code skill, the ↻ box, the CLI)
// reach ONE loop; the lock is how they know about each other.
//   acquire   exclusive create (O_EXCL). A lock whose pid is dead is STALE and reclaimed — the WIP-claim rule — so a crashed owner
//             never leaves the box stuck on RUNNING. A live holder → { ok:false, holder }; the caller exits 0 and dispatches nothing.
//   stop      writes stop_after_row: true into the lock; the loop finishes the row it is on and starts no other (never a kill — ⏹ End
//             all stays the kill).
//   release   removes the lock only when this pid holds it.
//   node scripts/vna/steer-lock.mjs status | stop
// C2609 — ONE LOCK PER SCOPE, NOT PER MACHINE (2026-11-05: four scopes queued behind one holder, and a holder started in the gap
// between two runs took the lock from the run waiting for it). A whole-spec run still holds .thetacog/steer.lock and covers every
// row — a lock file the old code wrote (no rows field) reads the same, so a holder started before this change stays valid. A
// scoped run holds <lock>.d/<pid>.json naming its rows. Two runs conflict only when their row sets overlap; the check and the
// write sit under one mkdir mutex, so two starts never both pass the check. A waiting row is folded by one holder only: the one
// whose fold claims it into its own lock file, never a row another live holder already covers.
import { openSync, writeSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK = process.env.VNA_STEER_LOCK || resolve(REPO, '.thetacog/steer.lock');
export const OWNERS = ['claude-code', 'ui-checkbox', 'cli', 'chat'];

export const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function readLock(path = LOCK) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

// C2609: the scoped holders' folder, the mutex, the row sets
export const lockDir = (path = LOCK) => `${path}.d`;
const ownFile = (path, pid) => resolve(lockDir(path), `${pid}.json`);
const rowsOf = (scope) => (scope == null || scope === '' ? null : [...new Set(String(scope).split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))]);
/** null rows = every row */
export const overlaps = (a, b) => { if (a == null || b == null) return true; const s = new Set(a); return b.some((x) => s.has(x)); };
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withMutex(path, fn) {
  const m = `${path}.mutex`; mkdirSync(dirname(path), { recursive: true }); const t0 = Date.now();
  for (;;) {
    try { mkdirSync(m); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(m).mtimeMs > 10_000) { rmdirSync(m); continue; } } catch { continue; }   // a crashed holder of the mutex
      if (Date.now() - t0 > 5_000) throw new Error('steer-lock: the lock mutex stayed busy for 5 s');
      pause(15);
    }
  }
  try { return fn(); } finally { try { rmdirSync(m); } catch { /* already gone */ } }
}
/** every live holder, whole-spec file first; rows null = every row (the old code's file has no rows field, and reads that way) */
export function holders({ path = LOCK } = {}) {
  const out = []; const h = readLock(path);
  if (h && alive(h.pid)) out.push({ ...h, rows: Array.isArray(h.rows) ? h.rows : null, file: path });
  let names = []; try { names = readdirSync(lockDir(path)).filter((n) => n.endsWith('.json')); } catch { /* no scoped holder yet */ }
  for (const n of names) { const f = resolve(lockDir(path), n); const x = readLock(f); if (x && alive(x.pid)) out.push({ ...x, rows: Array.isArray(x.rows) ? x.rows : null, file: f }); }
  return out;
}
function reapDead(path) {
  let reclaimed = false;
  const h = readLock(path); if (h && !alive(h.pid)) { try { unlinkSync(path); reclaimed = true; } catch { /* raced */ } }
  let names = []; try { names = readdirSync(lockDir(path)).filter((n) => n.endsWith('.json')); } catch { /* none */ }
  for (const n of names) { const f = resolve(lockDir(path), n); const x = readLock(f); if (!x || !alive(x.pid)) { try { unlinkSync(f); reclaimed = true; } catch { /* raced */ } } }
  return reclaimed;
}

export function acquire({ owner = 'cli', pid = process.pid, path = LOCK, now = new Date(), scope = null, waiting = WAITING } = {}) {
  const rows = rowsOf(scope);
  const lock = { owner: OWNERS.includes(owner) ? owner : 'cli', pid, started_at: now.toISOString(), host: hostname(), stop_after_row: false, rows, waiting };
  return withMutex(path, () => {
    const reclaimed = reapDead(path);
    const clash = holders({ path }).find((h) => h.pid !== pid && overlaps(rows, h.rows));
    if (clash) return { ok: false, holder: clash };
    const file = rows == null ? path : ownFile(path, pid);
    if (rows != null) mkdirSync(lockDir(path), { recursive: true });
    try { const fd = openSync(file, 'wx'); writeSync(fd, JSON.stringify(lock)); closeSync(fd); }
    catch (e) { if (e.code === 'EEXIST') return { ok: false, holder: readLock(file) }; throw e; }
    return { ok: true, lock, reclaimed, file };
  });
}
export function release({ pid = process.pid, path = LOCK } = {}) {
  for (const f of [path, ownFile(path, pid)]) { const h = readLock(f); if (h && h.pid === pid) { try { unlinkSync(f); return true; } catch { return false; } } }
  return false;
}
/** the polite stop: every live loop (or the one pid) reads it at the row boundary */
export function requestStop({ path = LOCK, pid = null } = {}) {
  const hs = holders({ path }).filter((h) => pid == null || h.pid === pid);
  if (!hs.length) return { ok: false, why: 'no live loop holds the lock' };
  const at = new Date().toISOString();
  for (const h of hs) { const { file, ...rest } = h; const raw = readLock(file) || rest; writeFileSync(file, JSON.stringify({ ...raw, stop_after_row: true, stop_at: at })); }
  return { ok: true, holder: hs[0], holders: hs };
}
export const shouldStop = ({ path = LOCK, pid = process.pid } = {}) => [path, ownFile(path, pid)].some((f) => { const h = readLock(f); return !!(h && h.pid === pid && h.stop_after_row); });
// WAITING ROWS (operator 2026-11-02: "make sure that the /steer always executes. It doesn't"). Measured that evening: four dictated
// steers declared 14 rows and dispatched none — each found the lock held by an `until --scope` run over other rows and printed
// "your rows are declared and wait for it", but the holder only ever classifies its own scope, so the wait had no end. Now a
// dictated run that finds the lock held writes its rows here, and the holder folds them into its scope at every cycle.
export const WAITING = process.env.VNA_STEER_WAITING || resolve(dirname(LOCK), 'steer-waiting.json');
export function waitingIds({ path = WAITING } = {}) { try { return JSON.parse(readFileSync(path, 'utf8')).ids || []; } catch { return []; } }
export function addWaiting(ids, { path = WAITING } = {}) {
  const next = [...new Set([...waitingIds({ path }), ...String(ids || '').split(',').map((s) => s.trim()).filter(Boolean)])];
  writeFileSync(path, JSON.stringify({ ids: next, at: new Date().toISOString() }, null, 2) + '\n'); return next;
}
// A scope plus the waiting rows no other live holder covers. A null scope already means the whole spec, so it stays null. When
// this pid holds a scoped lock the fold is CLAIMED into its lock file under the mutex (C2609), so a second holder never folds it.
export function withWaiting(scope, { path = WAITING, lock = LOCK, pid = process.pid, claim = true } = {}) {
  if (!scope) return scope;
  const w = waitingIds({ path }); const own = rowsOf(scope) || [];
  if (!w.length) return scope;
  const freeOf = () => { const others = holders({ path: lock }).filter((h) => h.pid !== pid); return w.filter((id) => !own.includes(id) && !others.some((h) => h.rows == null || h.rows.includes(id))); };
  const mine = readLock(ownFile(lock, pid));
  if (!claim || !mine || mine.pid !== pid) { const free = freeOf(); return free.length ? [...own, ...free].join(',') : scope; }
  return withMutex(lock, () => {
    const me = readLock(ownFile(lock, pid)); const free = freeOf();
    const rows = [...new Set([...(me.rows || own), ...own, ...free])];
    writeFileSync(ownFile(lock, pid), JSON.stringify({ ...me, rows }));
    return [...new Set([...own, ...free])].join(',');
  });
}
/** C2609: the preview's own line for the waiting rows a scoped run folds, so a plan never misreads its scope */
export function foldedLine(scope, { path = WAITING, lock = LOCK } = {}) {
  if (!scope) return '  waiting rows: a whole-spec run covers them';
  const own = rowsOf(scope); const all = rowsOf(withWaiting(scope, { path, lock, claim: false })) || [];
  const folded = all.filter((id) => !own.includes(id));
  return folded.length ? `  + ${folded.length} waiting row${folded.length === 1 ? '' : 's'} folded into this scope from ${path}: ${folded.slice(0, 12).join(' ')}${folded.length > 12 ? ' …' : ''}` : `  + 0 waiting rows folded (${path})`;
}

export function statusLine({ path = LOCK } = {}) {
  const hs = holders({ path }); const h = readLock(path);
  if (!hs.length) return h && !alive(h.pid) ? `steer lock: STALE — ${h.owner} pid ${h.pid} is gone (reclaimed on the next start)` : 'steer lock: free — no loop running';
  const shared = resolve(dirname(path), 'steer-waiting.json');
  return hs.map((x) => {
    const scope = x.rows == null ? 'every row' : `${x.rows.length} row${x.rows.length === 1 ? '' : 's'} (${x.rows.slice(0, 6).join(' ')}${x.rows.length > 6 ? ' …' : ''})`;
    const iso = x.waiting && resolve(x.waiting) !== shared ? ` · isolated waiting file ${x.waiting} — rows queued on ${shared} are not folded by this loop` : '';
    return `steer lock: held by ${x.owner} · pid ${x.pid} · since ${x.started_at} · scope ${scope}${x.stop_after_row ? ' · STOPPING after the current row' : ''}${iso}`;
  }).join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'stop') { const r = requestStop(); console.log(r.ok ? `stop requested — ${r.holder.owner} pid ${r.holder.pid} finishes its row and starts no other` : r.why); process.exit(0); }
  console.log(statusLine());
}
