#!/usr/bin/env node
// scripts/ops/session-focus.mjs — WHAT IS EACH LIVE SESSION ACTUALLY WORKING ON?
//
// Operator, 2026-09-11: "rename all sessions to suffix what they are working on." A session's name
// is the address other sessions message it at (ListAgents / SendMessage), and a name like
// `thetadrivencoach-d6` says nothing about the hand that room is holding. This reads the transcripts
// under ~/.claude/projects/<this repo>/ and prints, per recently-active INTERACTIVE session: its
// current title, the first ask (what it was opened for), the last asks (where it is now), and the
// room its name prefix encodes. It proposes NOTHING — the suffix is judgment, and the skill that
// wraps this (.claude/skills/sessions) makes that call and prints the /rename per terminal.
//
// WRITES NOTHING itself. The rename is a separate, deliberate step — scripts/ops/session-rename.mjs —
// which edits the registry ListAgents reads and appends the custom-title record --resume reads. This
// engine joins each transcript to its live registry entry so the skill can pass a pid straight through.
//
// Headless runs are excluded by CONSTRUCT, not by prompt text: an interactive terminal writes
// `file-history-snapshot` records (the harness snapshots tracked files per turn for a person who can
// undo); a hook-spawned `claude -p` run (INTERVENTION engine, ghost-reads, graders, chief-of-staff
// events) never does. Measured 2026-09-11 over 14 transcripts: every terminal had ≥2 snapshots, every
// headless run had 0. A "You are the …" prompt regex was the first cut and it let through every
// headless run whose prompt opened differently.
//
// Usage: node scripts/ops/session-focus.mjs [--hours 8] [--json] [--last 3]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const HOURS = Number(arg('--hours', 8));
const LAST = Number(arg('--last', 3));
const JSON_OUT = process.argv.includes('--json');

const REPO = resolve(new URL('../..', import.meta.url).pathname);
const projDir = join(homedir(), '.claude', 'projects', REPO.replace(/\//g, '-'));
const SESSIONS = join(homedir(), '.claude', 'sessions');

// pid + live name per sessionId, from the registry a running terminal maintains. A transcript with
// no entry here belongs to a terminal that has exited — it can be read, not renamed.
export function liveRegistry(dir = SESSIONS) {
  const out = new Map();
  let files = []; try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    try { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')); if (j.sessionId) out.set(j.sessionId, { pid: j.pid, name: j.name ?? null, nameSource: j.nameSource ?? null, status: j.status ?? null }); }
    catch { /* half-written — the next read gets it */ }
  }
  return out;
}

// The room is in the prefix — the "App Role" order the operator names rooms by (memory:
// ThetaCog Room Naming). Longest prefix wins so `vs` is not read as `v`, `cu` not as `c`.
const ROOMS = [
  ['vs', 'VS Code · Architect'], ['cu', 'Cursor · Laboratory'], ['w', 'WezTerm · Vault'],
  ['i', 'iTerm · Builder'], ['k', 'Kitty · Operator'], ['t', 'Terminal · Voice'],
  ['r', 'Rio · Navigator'], ['m', 'Messages · Network'], ['a', 'Alacritty · Performer'],
  ['c', 'Cursor · Laboratory'],
];
// WHICH APP THE TERMINAL IS. Operator, 2026-09-11: "these should also know what terminal they are
// running in (unnamed should be the name of the terminal by default)." The process environment
// carries `__CFBundleIdentifier` of the app that spawned the shell — Cursor and VS Code both say
// TERM_PROGRAM=vscode, so the bundle id is the construct, not TERM_PROGRAM. Measured on six live
// pids 2026-09-11: every one resolved. `ps -E` reads another process's environment only for the
// same user, which is the only case here.
export const TERMINALS = [
  ['com.todesktop.230313mzl4w4u92', 'Cursor', 'cu'], ['com.microsoft.VSCode', 'VS Code', 'vs'],
  ['com.googlecode.iterm2', 'iTerm', 'i'], ['net.kovidgoyal.kitty', 'Kitty', 'k'],
  ['com.apple.Terminal', 'Terminal', 't'], ['com.raphaelamorim.rio', 'Rio', 'r'],
  ['com.github.wez.wezterm', 'WezTerm', 'w'], ['org.alacritty', 'Alacritty', 'a'],
];
export function terminalOfEnv(envText) {
  const m = /__CFBundleIdentifier=(\S+)/.exec(envText || '');
  if (!m) return null;
  const hit = TERMINALS.find(([id]) => id === m[1]);
  return hit ? { app: hit[1], prefix: hit[2], bundle: m[1] } : { app: m[1], prefix: null, bundle: m[1] };
}
export function terminalOf(pid) {
  if (!pid) return null;
  try { return terminalOfEnv(execFileSync('ps', ['-E', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })); }
  catch { return null; }
}
// The default name for an unnamed terminal: the app's room prefix, the operator's `o` series, and
// the lowest digit no LIVE session of that prefix already uses — `io1b` occupies 1, so a new
// iTerm gets `io2`. The name is an address; two live terminals must never share one.
export function defaultName(prefix, liveNames) {
  if (!prefix) return null;
  const taken = new Set();
  for (const n of liveNames) { const m = new RegExp(`^${prefix}o(\\d+)`).exec(String(n || '').toLowerCase()); if (m) taken.add(Number(m[1])); }
  let n = 1; while (taken.has(n)) n++;
  return `${prefix}o${n}`;
}

export function roomOf(title) {
  const t = String(title || '').toLowerCase();
  // Room names have a grammar — prefix, at most two letters of variant, then a digit (io1b, to1spec,
  // vso1kidney, cuF1, kf2). A default `thetadrivencoach-d6` starts with t but is not a Voice room.
  for (const [p, room] of ROOMS) if (t.startsWith(p) && new RegExp(`^${p}[a-z]{0,2}\\d`).test(t)) return room;
  return null;
}

const textOf = (m) => {
  if (!m || !m.content) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  return '';
};
// A human ask, not a tool result, not a skill body the harness injected, not a pasted image stub.
const isAsk = (t) => t && !/^\s*</.test(t) && !/^\[Request interrupted/.test(t) && !/^Base directory for this skill/.test(t) && !/^#\s*\//.test(t);
const clip = (s, n = 160) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export function readSession(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let title = null, aiTitle = null, snapshots = 0; const asks = [];
  for (const l of lines) {
    if (!l) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'custom-title' && j.customTitle) title = j.customTitle;
    if (j.type === 'ai-title' && j.aiTitle) aiTitle = j.aiTitle;
    if (j.type === 'file-history-snapshot') snapshots++;
    if (j.type === 'user') { const t = textOf(j.message); if (isAsk(t)) asks.push(clip(t)); }
  }
  return { title, aiTitle, interactive: snapshots > 0, asks };
}

export function focus({ hours = HOURS, last = LAST } = {}) {
  const cutoff = Date.now() - hours * 3600e3;
  let files;
  try { files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl')); }
  catch { return { error: `no transcripts at ${projDir}`, sessions: [] }; }
  const out = [];
  const live = liveRegistry();
  for (const f of files) {
    const p = join(projDir, f);
    const st = statSync(p);
    if (st.mtimeMs < cutoff) continue;
    const { title, aiTitle, interactive, asks } = readSession(p);
    if (!asks.length || !interactive) continue;   // a headless run is not a room
    const id = basename(f, '.jsonl');
    const reg = live.get(id) ?? null;
    const term = terminalOf(reg?.pid);
    // "derived" is the harness's own placeholder (thetadrivencoach-d6); a person never chose it.
    const named = reg ? reg.nameSource === 'user' : !!title;
    const liveNames = [...live.values()].map((r) => r.name);
    out.push({
      id, pid: reg?.pid ?? null, live: !!reg, liveName: reg?.name ?? null, status: reg?.status ?? null,
      terminal: term?.app ?? null, named,
      defaultName: !named && term ? defaultName(term.prefix, liveNames) : null,
      roomMismatch: !!(named && term?.prefix && roomOf(reg?.name ?? title) && roomOf(reg?.name ?? title) !== roomOf(`${term.prefix}o1`)),
      title, aiTitle, room: roomOf(reg?.name ?? title),
      lastActive: new Date(st.mtimeMs).toISOString(),
      minutesAgo: Math.round((Date.now() - st.mtimeMs) / 60e3),
      first: asks[0], last: asks.slice(-last), asks: asks.length,
    });
  }
  out.sort((a, b) => a.minutesAgo - b.minutesAgo);
  return { projDir, hours, sessions: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = focus();
  if (JSON_OUT) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  if (r.error) { console.log(r.error); process.exit(1); }
  console.log(`🗂  ${r.sessions.length} interactive sessions active in the last ${r.hours}h (headless hook runs excluded)\n`);
  for (const s of r.sessions) {
    console.log(`── ${s.liveName ?? s.title ?? `(untitled${s.aiTitle ? ` · harness calls it "${s.aiTitle}"` : ''})`}  [${s.id.slice(0, 8)}]  ${s.live ? `pid ${s.pid} · ${s.status} · in ${s.terminal ?? 'unknown app'}` : 'EXITED — read-only'}  ·  ${s.room ?? 'room: unknown — no prefix'}${s.defaultName ? ` · UNNAMED → default \`${s.defaultName}\`` : ''}${s.roomMismatch ? ' · ⚠ name prefix does not match the app it runs in' : ''}  ·  ${s.minutesAgo}m ago  ·  ${s.asks} asks`);
    console.log(`   opened for : ${s.first}`);
    for (const a of s.last) console.log(`   now        : ${a}`);
  }
  console.log('\nRename a live one from here:  node scripts/ops/session-rename.mjs <pid> <name suffix>   (the terminal you are IN keeps its old name in its own memory until restart; everyone else sees the new one).');
}
