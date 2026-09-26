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
import { openSync, writeSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK = process.env.VNA_STEER_LOCK || resolve(REPO, '.thetacog/steer.lock');
export const OWNERS = ['claude-code', 'ui-checkbox', 'cli', 'chat'];

export const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function readLock(path = LOCK) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

export function acquire({ owner = 'cli', pid = process.pid, path = LOCK, now = new Date() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify({ owner: OWNERS.includes(owner) ? owner : 'cli', pid, started_at: now.toISOString(), host: hostname(), stop_after_row: false });
  for (let tries = 0; tries < 2; tries++) {
    try { const fd = openSync(path, 'wx'); writeSync(fd, body); closeSync(fd); return { ok: true, lock: JSON.parse(body), reclaimed: tries > 0 }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const h = readLock(path);
      if (h && alive(h.pid)) return { ok: false, holder: h };
      try { unlinkSync(path); } catch { /* another reclaimer won the race — the next openSync decides */ }
    }
  }
  const h = readLock(path); return { ok: false, holder: h };
}
export function release({ pid = process.pid, path = LOCK } = {}) {
  const h = readLock(path); if (!h || h.pid !== pid) return false;
  try { unlinkSync(path); return true; } catch { return false; }
}
/** the polite stop: the loop reads it at the row boundary */
export function requestStop({ path = LOCK } = {}) {
  const h = readLock(path); if (!h || !alive(h.pid)) return { ok: false, why: 'no live loop holds the lock' };
  writeFileSync(path, JSON.stringify({ ...h, stop_after_row: true, stop_at: new Date().toISOString() })); return { ok: true, holder: h };
}
export const shouldStop = ({ path = LOCK, pid = process.pid } = {}) => { const h = readLock(path); return !!(h && h.pid === pid && h.stop_after_row); };
export function statusLine({ path = LOCK } = {}) {
  const h = readLock(path);
  if (!h) return 'steer lock: free — no loop running';
  if (!alive(h.pid)) return `steer lock: STALE — ${h.owner} pid ${h.pid} is gone (reclaimed on the next start)`;
  return `steer lock: held by ${h.owner} · pid ${h.pid} · since ${h.started_at}${h.stop_after_row ? ' · STOPPING after the current row' : ''}`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'stop') { const r = requestStop(); console.log(r.ok ? `stop requested — ${r.holder.owner} pid ${r.holder.pid} finishes its row and starts no other` : r.why); process.exit(0); }
  console.log(statusLine());
}
