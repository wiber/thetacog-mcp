#!/usr/bin/env node
// scripts/vna/heavy-lock.mjs — C287 (U19c) ONE HEAVY JOB AT A TIME ON LOCAL METAL. Operator 2026-09-25, verbatim: "Enforce a mutex
// so that heavy verification jobs … and model benchmarks never run simultaneously on local metal." The incident: the full guard
// suite (asked-vs-built --run, 260+ node --test files four at a time) ran beside a replay bench; load 162, and 4 of the bench's first
// 5 trials were watchdog-killed at ~210 s — the bench measured the contention, not the model.
//   acquire   exclusive create (O_EXCL) of .thetacog/heavy.lock (VNA_HEAVY_LOCK overrides) — the same shape as steer-lock.mjs (C273),
//             whose `alive` this imports. A lock whose pid is dead is STALE and reclaimed. A live holder → { ok:false, holder }.
//             A CHILD OF THE HOLDER runs under the holder's lock (nested: true, release is a no-op): asked-vs-built --run holds the
//             lock while its guards call the runner's local dispatch, and a child waiting on its own parent would deadlock.
//   wait      bounded: polls until the lock is free and takes it, or returns { ok:false, holder, waited_ms } — never runs beside it.
//   release   removes the lock only when this pid holds it; a non-holder's release is a no-op.
//   node scripts/vna/heavy-lock.mjs status
// The lock is taken from the next start: a heavy job already running when this landed took no lock, and nothing here reads `ps`
// to find one — a job that never took the lock is out of this file's sight (named, not guessed).
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
import { alive } from './steer-lock.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HEAVY_LOCK = () => process.env.VNA_HEAVY_LOCK || resolve(REPO, '.thetacog/heavy.lock');
export const HEAVY_WAIT_MS = () => (process.env.VNA_HEAVY_WAIT_MS != null ? Number(process.env.VNA_HEAVY_WAIT_MS) : 30 * 60 * 1000);
export { alive };

export function heavyHolder({ path = HEAVY_LOCK() } = {}) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

/** is `pid` an ancestor of this process — walked through ps, bounded at 32 hops; any read failure is "no" */
export function isAncestor(pid) {
  let p = process.ppid;
  for (let i = 0; i < 32 && p > 1; i++) {
    if (p === pid) return true;
    try { p = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(p)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { return false; }
  }
  return false;
}

export function acquireHeavy({ job = 'unnamed', pid = process.pid, path = HEAVY_LOCK(), now = new Date() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify({ job, pid, started_at: now.toISOString(), host: hostname(), argv: process.argv.slice(1).join(' ').slice(0, 300) });
  for (let tries = 0; tries < 2; tries++) {
    try { const fd = openSync(path, 'wx'); writeSync(fd, body); closeSync(fd); return { ok: true, lock: JSON.parse(body), reclaimed: tries > 0 }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const h = heavyHolder({ path });
      if (h && alive(h.pid)) {
        if (pid === process.pid && (h.pid === pid || isAncestor(h.pid))) return { ok: true, lock: h, nested: true };
        return { ok: false, holder: h };
      }
      try { unlinkSync(path); } catch { /* another reclaimer won the race — the next openSync decides */ }
    }
  }
  return { ok: false, holder: heavyHolder({ path }) };
}

export function releaseHeavy({ pid = process.pid, path = HEAVY_LOCK() } = {}) {
  const h = heavyHolder({ path }); if (!h || h.pid !== pid) return false;
  try { unlinkSync(path); return true; } catch { return false; }
}

export const holderLine = (h) => (h ? `${h.job} · pid ${h.pid} · since ${h.started_at}` : 'nobody');

/** bounded wait: take the lock as soon as it is free, or give up after timeoutMs naming who held it */
export async function waitForHeavy({ job = 'unnamed', timeoutMs = HEAVY_WAIT_MS(), pollMs = 2000, path = HEAVY_LOCK(), say = null } = {}) {
  const t0 = Date.now(); let told = 0;
  for (;;) {
    const r = acquireHeavy({ job, path });
    const waited_ms = Date.now() - t0;
    if (r.ok) return { ...r, waited_ms };
    if (waited_ms >= timeoutMs) return { ok: false, holder: r.holder, waited_ms };
    if (say && (told === 0 || waited_ms - told >= 5 * 60 * 1000)) { say(`heavy lock held by ${holderLine(r.holder)} — ${job} waits (≤ ${Math.round(timeoutMs / 1000)} s, load1 ${loadavg()[0].toFixed(1)})`); told = waited_ms || 1; }
    await new Promise((ok) => setTimeout(ok, Math.max(10, Math.min(pollMs, timeoutMs - waited_ms))));
  }
}

let exitHooked = false;
/** release on every way out of this process: normal exit, SIGINT, SIGTERM */
export function releaseOnExit({ path = HEAVY_LOCK() } = {}) {
  if (exitHooked) return; exitHooked = true;
  process.once('exit', () => releaseHeavy({ path }));
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(sig, () => { releaseHeavy({ path }); process.exit(code); });
}

/** run fn holding the lock; { wait: false } is one attempt. Returns { ok:false, holder } without running fn when it is held. */
export async function withHeavy(job, fn, { wait = true, timeoutMs = HEAVY_WAIT_MS(), path = HEAVY_LOCK(), say = null } = {}) {
  const r = wait ? await waitForHeavy({ job, timeoutMs, path, say }) : acquireHeavy({ job, path });
  if (!r.ok) return { ok: false, holder: r.holder, waited_ms: r.waited_ms ?? 0 };
  releaseOnExit({ path });
  try { return { ok: true, value: await fn(), waited_ms: r.waited_ms ?? 0 }; }
  finally { if (!r.nested) releaseHeavy({ path }); }
}

/** a CLI's entry gate: hold the lock for the rest of this process, or say who holds it and exit 0 — never run beside it */
export async function holdOrExit(job, { timeoutMs = HEAVY_WAIT_MS(), path = HEAVY_LOCK(), say = (s) => console.error(s) } = {}) {
  const r = await waitForHeavy({ job, timeoutMs, path, say });
  if (!r.ok) { console.log(`HEAVY_LOCK_HELD: ${job} not started — ${holderLine(r.holder)} holds ${path} (waited ${Math.round(r.waited_ms / 1000)} s); one heavy job at a time on local metal (C287)`); process.exit(0); }
  releaseOnExit({ path });
  return r;
}

export function statusLine({ path = HEAVY_LOCK() } = {}) {
  const h = heavyHolder({ path });
  if (!h) return 'heavy lock: free';
  if (!alive(h.pid)) return `heavy lock: STALE — ${h.job} pid ${h.pid} is gone (reclaimed on the next start)`;
  return `heavy lock: held by ${holderLine(h)} · load1 ${loadavg()[0].toFixed(1)}`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(statusLine());
