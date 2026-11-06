#!/usr/bin/env node
// ThetaCog steer autorun — the personal UserPromptSubmit hook (C2360, chair decomposition 2026-11-05 of "build and ratchet the implied
// ones too"). Copied by `npx thetacog-mcp` to ~/.thetacog/hooks/steer-autorun.mjs and wired into ~/.claude/settings.json, so a
// `/steer <text>` typed in ANY folder compiles and runs the way it does in the engine's own repo (scripts/vna/steer-autorun-hook.mjs):
// the prompt is read off stdin, and when it starts with `/steer ` (never /steergoal, /steerone, /steer-every, a bare /steer or
// "the latest spec") `thetacog-mcp steer-compile "<text>"` is spawned DETACHED in the prompt's own folder and this hook returns at once.
// steer-compile dedupes one dictation inside 30 minutes, so the skill's own Step 0 call finds it already running.
// Node builtins only: it must run after the package is gone from the npx cache. Undo: node ~/.thetacog/hooks/thetacog-undo.mjs --hook
import { readFileSync, appendFileSync, mkdirSync, openSync, existsSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export function dictationOf(prompt) {
  const m = String(prompt || '').match(/^\s*\/steer[ \t]+([\s\S]+)$/);
  if (!m) return null;
  const text = m[1].trim();
  if (!text || /^the latest spec\b/i.test(text)) return null;
  return text;
}

/** how to reach the package: the server.js the installer recorded when it still exists, else npx */
export function launcher(home = process.env.HOME || homedir()) {
  try {
    const st = JSON.parse(readFileSync(join(home, '.thetacog', 'installed.json'), 'utf8'));
    if (st.serverJs && existsSync(st.serverJs)) return { cmd: process.execPath, args: [st.serverJs] };
  } catch { /* no record: npx */ }
  return { cmd: 'npx', args: ['-y', 'thetacog-mcp'] };
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };   // /var vs /private/var on macOS
const isMain = !!process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
if (isMain) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const text = dictationOf(payload.prompt);
  if (!text) process.exit(0);
  const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd();
  try {
    const dir = join(cwd, '.thetacog'); mkdirSync(dir, { recursive: true });
    const out = openSync(join(dir, 'steer-autorun.log'), 'a');
    const l = launcher();
    const env = { ...process.env, VNA_STEER_VIA: 'autorun-hook', ...(payload.session_id ? { VNA_STEER_SESSION_ID: String(payload.session_id) } : {}), ...(payload.transcript_path ? { VNA_STEER_TRANSCRIPT: String(payload.transcript_path) } : {}) };
    const child = spawn(l.cmd, [...l.args, 'steer-compile', text], { cwd, detached: true, stdio: ['ignore', out, out], env });
    child.unref();
    appendFileSync(join(dir, 'steer-autorun.ndjson'), JSON.stringify({ at: new Date().toISOString(), pid: child.pid, chars: text.length, via: l.cmd }) + '\n');
    console.log(`⟦ STEER AUTORUN ⟧ this /steer is compiled and running (pid ${child.pid}): txt in .thetacog/steers/, its log in .thetacog/steer-autorun.log. Never re-run it by hand; steer-compile's own Step 0 call finds it ALREADY RUNNING.`);
  } catch (e) {
    console.log(`⟦ STEER AUTORUN ⟧ could not start compile (${e.message}); run it by hand: npx thetacog-mcp steer-compile "<the dictation>"`);
  }
  process.exit(0);
}
