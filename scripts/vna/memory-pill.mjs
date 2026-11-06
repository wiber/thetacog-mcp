#!/usr/bin/env node
// scripts/vna/memory-pill.mjs — 🧠 MEMORY, the sub-pill beside Export in the Steer sidebar (operator 2026-10-22, verbatim: "put the
// new memory as a sub pill, where export is see? at the top of an expanded is room for more + pill" · "its a new sub pill +
// (checkbox aut improve semantinc pressure) - stats of last tick, time since last dev action ie t-45 to launch or t+5 after it
// starts ticking").
// Reads receipts, computes nothing new: the swap-in rate is mem.mjs's last row in .thetacog/mem-hogs.ndjson, the 45-minute clock is
// quiet-gate.mjs check() (the same IDLE_MS session-idle.mjs holds), the last tick is the newest reef-self-loop log, the flag is
// .thetacog/reef-self-improve.on. Default OFF.
// THE ON DOOR REFUSES while hooks/post-commit still launches reef-self-loop on every commit: the 45-minute guard (C1199) must land
// first, or ticking the box would bring back the per-commit runs turned off in 7438bd4e04.
//   node scripts/vna/memory-pill.mjs status | run | on | off
// C1200 (TEND SP-02): THIS module is the one implementation — the repo's own launcher
// (scripts/ops/session-close-cycle.sh) calls `run` here rather than spawning
// scripts/pmu/reef-self-loop.mjs a second way, and `status` names the same five fields the
// sidebar's 🧠 Memory pill reads (last tick at, rounds, accepted seed changes, time since your
// last dev action, state T-minus/T-plus) — UNMEASURED per field, never a silent gap.
import { existsSync, readFileSync, readdirSync, statSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check as quietCheck } from '../ops/quiet-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SELF_LOOP = join(REPO, 'scripts/pmu/reef-self-loop.mjs');
const ROUNDS_LOG_DIR = join(REPO, 'data/pmu/reef-self-loop');
// C1202 — VNA_SELF_IMPROVE_FLAG overrides the flag's path so a guard can prove "default OFF on a fresh
// install, toggling writes the flag" against a throwaway root instead of mutating this repo's own
// .thetacog/reef-self-improve.on (a live switch, and reef-self-improve.off-2026-10-22 is a tracked file —
// a guard that exercised the real path would rename it out from under the next session). Unset in
// production: the default path below is unchanged.
export const FLAG_ON = process.env.VNA_SELF_IMPROVE_FLAG || join(REPO, '.thetacog/reef-self-improve.on');
export const HOOK = join(REPO, 'hooks/post-commit');
const MIN = 60_000;

/** pure: does the post-commit hook still launch the loop on every commit? (the ON door's refusal) */
export function hookLaunches(hookText) { return /reef-self-loop/.test(hookText) && /\$SELF_LOOP"? --optimize response/.test(hookText); }

/** pure: the one-line state on the pill face */
export function faceState({ on, idleMs = null, quietMs = 45 * MIN, tickingSinceMs = null }) {
  if (!on) return 'auto-improve OFF';
  if (tickingSinceMs != null) return `ticking T+${Math.max(0, Math.round(tickingSinceMs / MIN))} min`;
  if (idleMs == null) return 'auto-improve ON · last dev action UNMEASURED';
  if (idleMs < quietMs) return `T-${Math.ceil((quietMs - idleMs) / MIN)} min to launch`;
  return 'auto-improve ON · quiet, waits for the next idle edge';
}

export function readMemory(now = Date.now()) {
  const m = { on: existsSync(FLAG_ON), swapinsPerS: null, memAt: null, idleMs: null, quietMs: 45 * MIN, lastTick: null, tickingSinceMs: null };
  try { const last = readFileSync(join(REPO, '.thetacog/mem-hogs.ndjson'), 'utf8').trim().split('\n').pop(); const r = JSON.parse(last); m.swapinsPerS = r.swapinsPerS ?? null; m.memAt = r.ts; } catch {}
  try { const logs = readdirSync(join(REPO, '.thetacog/cache')).filter(f => /^reef-self-loop-.*\.log$/.test(f)).map(f => statSync(join(REPO, '.thetacog/cache', f)).mtimeMs); if (logs.length) m.lastTick = new Date(Math.max(...logs)).toISOString(); } catch {}
  const ps = spawnSync('ps', ['-axo', 'etime=,command='], { encoding: 'utf8' }).stdout || '';
  const run = ps.split('\n').find(l => /reef-self-loop\.mjs/.test(l) && !/grep/.test(l));
  if (run) { const e = run.trim().split(/\s+/)[0].split(/[-:]/).map(Number).reverse(); m.tickingSinceMs = ((e[0] || 0) + 60 * (e[1] || 0) + 3600 * (e[2] || 0) + 86400 * (e[3] || 0)) * 1000; }
  try { const q = quietCheck({ now }); m.idleMs = q.idleFor ?? null; m.quietMs = q.quietMs ?? m.quietMs; } catch {}
  return m;
}

/** pure: pull {rounds, applied} off the newest rounds-log json reef-self-loop.mjs wrote to LOG_DIR — the
 *  ledger C1204's SI targets ratchet against. Takes the dir so a guard can point it at a fixture. */
export function latestRoundsLedger(dir = ROUNDS_LOG_DIR) {
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  if (!names.length) return null;
  const newest = names.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
  try {
    const j = JSON.parse(readFileSync(join(dir, newest), 'utf8'));
    return { rounds: j.rounds ?? null, applied: j.appliedRounds ?? null, file: newest };
  } catch { return null; }
}

// C1200 (TEND SP-02): THE FIVE STATUS FIELDS — status() names each one by the words the operator's
// own spec row used, UNMEASURED where the receipt has nothing to read, never a silent gap.
export function status(now = Date.now()) {
  const m = readMemory(now);
  const ledger = latestRoundsLedger();
  return {
    lastTickAt: m.lastTick ?? 'UNMEASURED',
    rounds: ledger?.rounds ?? 'UNMEASURED',
    acceptedSeedChanges: ledger?.applied ?? 'UNMEASURED',
    sinceLastDevActionMs: m.idleMs ?? 'UNMEASURED',
    state: faceState(m),
  };
}

/** pure: the argv reef-self-loop.mjs runs with when `run` carries none of its own — the exact flags
 *  session-close-cycle.sh used before this module became the one door in. */
export function runArgs(extra = []) { return extra.length ? extra : ['--optimize', 'response', '--rounds', '1', '--llm', '--max-minutes', '5']; }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ago = (iso, now) => { if (!iso) return 'never'; const s = Math.round((now - Date.parse(iso)) / 1000); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

// C1202 THE CHECKBOX RIDES THE FACE (operator 2026-10-22, on a screenshot of this drawer: "the checkbxes must be on the button - we
// have a design idiom lets stick to it everywhere - guard against this regression, the - button with checkbox and stats on one row,
// then more graphs and controls when you hit the +"). The pill is the house shape every other pill uses (pillBox: [+] · the
// checkbox label · the action button · the stats on one face row), the same <label class="sb chk"><input type="checkbox"> the
// 🟢 auto-paste and 🎙️ audio pills carry; the reap door and the readings live behind the +. A toggle drawn as a ☐/☑ button
// is the regression; tests/vna/c1202-the-checkbox-rides-the-face.test.mjs fails on it anywhere on the steer page.
export function memoryToggle(m) {
  const on = !!(m && m.on);
  return `<label class="sb chk ${on ? 'on' : ''}" title="${on ? 'auto-improve is on: the self-improve loop runs only 45 min after your last dev action; untick to stop it' : 'tick to auto-improve semantic pressure: the loop runs only 45 min after your last dev action; refused until the 45-minute guard (C1199) lands'}"><input type="checkbox" ${on ? 'checked ' : ''}onchange="go(this.checked ? 'vna.selfImproveOn' : 'vna.selfImproveOff')"> auto-improve</label>`;
}
/** the 🧠 Memory pill: pillBox and B are steer-ui's own painters, handed in so this file paints the one shape */
export function renderMemoryPill(m, { B, pillBox, now = Date.now() } = {}) {
  const state = faceState(m);
  const swap = m.swapinsPerS == null ? 'swap-ins UNMEASURED' : `${m.swapinsPerS} swap-ins/s${m.swapinsPerS >= 1000 ? ' ⚠ thrash' : ''}`;
  const idle = m.idleMs == null ? 'UNMEASURED' : `${Math.round(m.idleMs / MIN)} min (launch at ${Math.round(m.quietMs / MIN)})`;
  const open = `<button class="action" onclick="go('vna.memRead')" title="read memory now: pressure, then each process by what it costs (/mem, read only — nothing is killed; 🧹 Reap now is under the +)">🧠 Memory</button>`;
  const L = (label, body) => `<span class="c3l dim"><b class="lb">${label}</b> <span class="measure">${esc(body)}</span></span>`;
  const inner = [
    `<span class="c3l">${B('vna.memReap', '🧹 Reap now', 'run /mem --reap: orphans, off-screen tabs, superfluous Safari tabs — the same pass the 5-minute tick runs')}</span>`,
    L('last tick', ago(m.lastTick, now)),
    L('since your last dev action', idle),
    L('memory', `${swap}${m.memAt ? ` · read ${ago(m.memAt, now)}` : ''}`),
  ].join('');
  return pillBox('c-memory nested', 'memory', `${memoryToggle(m)} ${open}`, { faceDoor: ` · <span class="measure">${esc(swap)} · ${esc(state)}</span>`, beat: 'memory', plusTitle: 'the reap door, the last tick, the 45-minute clock and the memory reading', inner });
}

// doOn/doOff are the ON/OFF doors as pure-ish actions (their only side effect is FLAG_ON's own file), pulled out of the
// CLI block so a guard can call them directly against an overridden FLAG_ON instead of spawning the real entry point —
// spawning it would read process.env at a fresh-process import anyway, same code, one fewer moving part to isolate.
export function doOn() {
  const hook = existsSync(HOOK) ? readFileSync(HOOK, 'utf8') : '';
  if (hookLaunches(hook)) return { ok: false, message: 'refused — hooks/post-commit still starts the loop on every commit; the 45-minute guard (C1199) lands first' };
  const flagDir = dirname(FLAG_ON);
  mkdirSync(flagDir, { recursive: true });
  let off = null;
  try { off = readdirSync(flagDir).find(f => f.startsWith('reef-self-improve.off')); } catch {}
  if (off) renameSync(join(flagDir, off), FLAG_ON); else writeFileSync(FLAG_ON, 'on\n');
  return { ok: true, message: 'auto-improve ON — runs 45 min after your last dev action' };
}
export function doOff() {
  if (existsSync(FLAG_ON)) renameSync(FLAG_ON, join(dirname(FLAG_ON), `reef-self-improve.off-${new Date().toISOString().slice(0, 10)}`));
  return { ok: true, message: 'auto-improve OFF' };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const verb = process.argv[2] || 'status';
  if (verb === 'on') {
    const r = doOn();
    console.log(r.message);
    if (!r.ok) process.exit(3);
  } else if (verb === 'off') {
    console.log(doOff().message);
  } else if (verb === 'run') {
    // C1200 (TEND SP-02): the one door reef-self-loop.mjs runs through — session-close-cycle.sh calls
    // `memory-pill.mjs run` instead of spawning SELF_LOOP a second way.
    const r = spawnSync('node', [SELF_LOOP, ...runArgs(process.argv.slice(3))], { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  } else {
    const s = status();
    console.log(`last tick at: ${s.lastTickAt}`);
    console.log(`rounds: ${s.rounds}`);
    console.log(`accepted seed changes: ${s.acceptedSeedChanges}`);
    console.log(`since your last dev action: ${s.sinceLastDevActionMs === 'UNMEASURED' ? s.sinceLastDevActionMs : `${Math.round(s.sinceLastDevActionMs / MIN)} min`}`);
    console.log(`state: ${s.state}`);
  }
}
