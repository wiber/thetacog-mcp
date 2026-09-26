#!/usr/bin/env node
// scripts/vna/keep-running.mjs — C277 (U14) ↻ KEEP /steer RUNNING. Operator 2026-09-25 goal, verbatim: "there's a checkbox that is
// checked when you ask a question and Gemma keeps running the self healing loop … to make sure that QWEN doesn't get stuck". The box
// holds a HOST loop (settled S4: lock → dispatch → verdict → rollback → next — never a model in charge); inside it, the catch is C278's
// triage, the retry is C276's dial, the cleanup is C274, the owner is C273.
//   on  --by ui-checkbox|chat|claude-code|cli   ticks it (.thetacog/steer-keep.json) and starts the daemon if none is alive
//   off                                          unticks it and asks the running pass to stop after its row (never a kill — ⏹ End all is)
//   status [--json]                              the box + the one readout (C264): state, landed/dispatched today, the last pass
// THE DAEMON, one pass after another while the box is ticked:
//   · the lock is someone else's → wait (never a second loop)          · no CLEAR row left → pause (IDLE_MS), then look again
//   · free memory under MIN_FREE → pause (os.freemem, readable without root; heat is not read and never claimed)
//   · otherwise → steerUntil({ owner }) — one full pass; its end line and any YOUR-ACT rows it met are written as PINGS
//     (.thetacog/steer-pings.ndjson, one per new act, with the command the operator runs) — drafted, never acted on
// A pass that lands nothing still ends; the pill shows landed/dispatched so a loop that spins is SEEN, not hidden.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { freemem } from 'node:os';
import { alive, readLock, requestStop, LOCK } from './steer-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const KEEP = process.env.VNA_STEER_KEEP || resolve(REPO, '.thetacog/steer-keep.json');
export const PINGS = process.env.VNA_STEER_PINGS || resolve(REPO, '.thetacog/steer-pings.ndjson');
export const IDLE_MS = Number(process.env.VNA_KEEP_IDLE_MS || 5 * 60 * 1000);
export const BETWEEN_MS = Number(process.env.VNA_KEEP_BETWEEN_MS || 10 * 1000);
export const MIN_FREE = Number(process.env.VNA_KEEP_MIN_FREE_BYTES || 1.5 * 2 ** 30);

export function readKeep(path = KEEP) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { on: false }; } }
function writeKeep(k, path = KEEP) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ ...k, at: new Date().toISOString() }, null, 1) + '\n'); return k; }

/** tick: the box on, and a daemon alive to run it (spawn only when none is) */
export function keepOn({ by = 'cli', path = KEEP, spawnDaemon = true } = {}) {
  const k = readKeep(path);
  const daemonAlive = !!(k.daemon_pid && alive(k.daemon_pid));
  const next = writeKeep({ ...k, on: true, by, daemon_pid: daemonAlive ? k.daemon_pid : null }, path);
  if (!daemonAlive && spawnDaemon) {
    const log = resolve(dirname(path), 'steer-keep.log'); const fd = openSync(log, 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'daemon'], { cwd: REPO, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, VNA_STEER_OWNER: by } });
    child.unref(); writeKeep({ ...next, daemon_pid: child.pid }, path); return { on: true, started: child.pid };
  }
  return { on: true, started: null, daemon_pid: next.daemon_pid };
}
/** untick: the box off, the running pass stops after its row */
export function keepOff({ path = KEEP, lock = LOCK } = {}) { const k = readKeep(path); writeKeep({ ...k, on: false }, path); const s = requestStop({ path: lock }); return { on: false, stop: s.ok }; }

/** one decision of the daemon — pure over its readings, so the guard enumerates it */
export function nextStep({ keep, lockHolder = null, myPid = process.pid, clear = 0, free = Infinity, minFree = MIN_FREE }) {
  if (!keep || !keep.on) return { act: 'exit', why: 'the box is unticked' };
  if (lockHolder && lockHolder.pid !== myPid && alive(lockHolder.pid)) return { act: 'wait', why: `the loop is held by ${lockHolder.owner} (pid ${lockHolder.pid})` };
  if (free < minFree) return { act: 'wait', why: `free memory ${Math.round(free / 2 ** 20)} MB under ${Math.round(minFree / 2 ** 20)} MB` };
  if (clear === 0) return { act: 'idle', why: 'no CLEAR row left — looking again later' };
  return { act: 'pass', why: `${clear} CLEAR row${clear === 1 ? '' : 's'}` };
}

/** the pings: every YOUR-ACT row a pass met, once each, with what the operator runs — never run by the loop */
export function writePings(acts, { path = PINGS } = {}) {
  let seen = new Set(); try { seen = new Set(readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id)); } catch {}
  const fresh = (acts || []).filter((a) => !seen.has(a.id));
  for (const a of fresh) appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), id: a.id, act: (a.missing || []).join(' · ').slice(0, 300), approve: `the row names the act; the loop never runs it — ${a.id}` }) + '\n');
  return fresh.length;
}

export async function daemon({ path = KEEP, pings = PINGS, steer = null, classify = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), say = console.log, maxPasses = Infinity } = {}) {
  const { steerUntil } = steer ? { steerUntil: steer } : await import('./steer-until.mjs');
  const clearCount = classify || (async () => { const { classifySpec, SPEC_MD } = await import('./spec-clarity.mjs'); const c = classifySpec(readFileSync(SPEC_MD, 'utf8')); return c.rows.filter((r) => !c.ticked[r.id] && r.class === 'CLEAR').length; });
  writeKeep({ ...readKeep(path), daemon_pid: process.pid }, path);
  let passes = 0;
  for (;;) {
    const st = nextStep({ keep: readKeep(path), lockHolder: readLock(), clear: await clearCount(), free: freemem() });
    say(`[keep ${new Date().toISOString()}] ${st.act} — ${st.why}`);
    if (st.act === 'exit') break;
    if (st.act === 'wait') { await sleep(60 * 1000); continue; }
    if (st.act === 'idle') { await sleep(IDLE_MS); continue; }
    const r = await steerUntil({ owner: readKeep(path).by || 'ui-checkbox', openLedger: false, say });
    const pinged = writePings(r.acts || [], { path: pings });
    writeKeep({ ...readKeep(path), last_pass: { at: new Date().toISOString(), ticked: (r.ticked || []).length, stuck: (r.stuck || []).length, cycles: r.cycles || 0, pinged, end: String(r.end || '').slice(0, 300) } }, path);
    if (++passes >= maxPasses) break;
    await sleep(BETWEEN_MS);
  }
  const k = readKeep(path); if (k.daemon_pid === process.pid) writeKeep({ ...k, daemon_pid: null }, path);
}

export async function status({ path = KEEP } = {}) {
  const k = readKeep(path); const { readout } = await import('./steer-readout.mjs'); const r = readout();
  const lr = r.land_rate && r.land_rate.last_24h; const face = `↻ ${k.on ? 'on' : 'off'}${lr ? ` · landed ${lr.landed}/${lr.dispatched} today` : ''}${r.state && r.state !== 'IDLE' ? ` · ${r.state} ${r.active_row || ''}`.trimEnd() : ''}`;
  return { on: !!k.on, by: k.by || null, daemon_alive: !!(k.daemon_pid && alive(k.daemon_pid)), last_pass: k.last_pass || null, face, readout: r };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const cmd = argv[0] || 'status'; const by = argv.includes('--by') ? argv[argv.indexOf('--by') + 1] : 'cli';
  if (cmd === 'daemon') { await daemon(); process.exit(0); }
  if (cmd === 'on') { const r = keepOn({ by }); console.log(`↻ on (by ${by})${r.started ? ` · daemon started, pid ${r.started}` : ` · daemon already running, pid ${r.daemon_pid}`}`); process.exit(0); }
  if (cmd === 'off') { const r = keepOff(); console.log(`↻ off${r.stop ? ' · the running pass stops after its row' : ' · no pass was running'}`); process.exit(0); }
  const s = await status(); console.log(argv.includes('--json') ? JSON.stringify({ ...s, readout: undefined, land_rate: s.readout.land_rate }) : `${s.face} · daemon ${s.daemon_alive ? 'alive' : 'not running'}${s.last_pass ? ` · last pass ${s.last_pass.at}: ticked ${s.last_pass.ticked}, stuck ${s.last_pass.stuck}` : ''}`);
}
