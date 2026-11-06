#!/usr/bin/env node
// scripts/vna/steer-autorun-hook.mjs — UserPromptSubmit: every `/steer <text>` prompt runs the steer, whatever the chair does next.
// C2213b, operator 2026-11-04, verbatim: "did you auto run the steer? if not make it impossible not to in the skill package".
// C2213 made steer-compile run the steer, but a chair that never called compile still left the dictation as words. This hook reads the
// prompt off stdin and, when it starts with `/steer ` (never /steergoal, /steerone, a bare /steer or "the latest spec"), spawns
// steer-compile.mjs on the text, detached, and returns at once (a hook never blocks: unbounded work is detached). steer-compile
// dedupes the same dictation inside 30 minutes, so the chair's own Step 0 call finds it already running and dispatches nothing twice.
// The context line it prints tells the chair the run is live and where its txt and log land.
// @guard tests/vna/c2213b-the-steer-cannot-be-skipped.test.mjs
import { readFileSync, appendFileSync, mkdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPILE = process.env.VNA_STEER_COMPILE_CMD || resolve(REPO, 'scripts/vna/steer-compile.mjs');
const LOG = process.env.VNA_STEER_AUTORUN_LOG || resolve(REPO, '.thetacog/steer-autorun.ndjson');

export function dictationOf(prompt) {
  const m = String(prompt || '').match(/^\s*\/steer[ \t]+([\s\S]+)$/);
  if (!m) return null;
  const text = m[1].trim();
  if (!text || /^the latest spec\b/i.test(text)) return null;   // C1018 has its own door (latest-spec.mjs)
  return text;
}

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
let prompt = '';
try { prompt = JSON.parse(input).prompt || ''; } catch { process.exit(0); }
const text = dictationOf(prompt);
if (!text) process.exit(0);
try {
  mkdirSync(dirname(LOG), { recursive: true });
  const out = openSync(LOG.replace(/\.ndjson$/, '.log'), 'a');
  const child = spawn(process.execPath, [COMPILE, text], { cwd: REPO, detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), pid: child.pid, chars: text.length }) + '\n');
  console.log(`⟦ STEER AUTORUN ⟧ this /steer is compiled and running (pid ${child.pid}): txt in .thetacog/steers/, its run log beside it. The chair never re-runs it by hand; steer-compile's own Step 0 call finds it ALREADY RUNNING.`);
} catch (e) {
  console.log(`⟦ STEER AUTORUN ⟧ could not start compile (${e.message}); run Step 0 by hand: node scripts/vna/steer-compile.mjs "<the dictation>"`);
}
process.exit(0);
