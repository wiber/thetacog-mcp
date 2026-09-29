#!/usr/bin/env node
// scripts/vna/goose-fence.mjs — C300 (U19j) THE FENCE IS IN THE TREE, BEFORE THE CALL — and never on a file goose does not read
// (operator 2026-09-25, verbatim: *"If the tool call target is not in the declared file whitelist, immediately reject the call with a
// tool-error response"*). Goose owns the tool loop, so the runner cannot intercept a call mid-turn; the row's plan was a `.gooseignore`
// in the trial tree denying every path outside the whitelist (the task's code file + its tests). The row's FIRST step is to measure
// that goose honours the file — "never a fence claimed on a file goose ignores".
//
// THE MEASUREMENT (static, no model): the installed goose binary is scanned for the literal file names its code would open. On
// 2026-09-26, goose 1.50.0 (/opt/homebrew/Cellar/block-goose-cli/1.50.0/bin/goose) carries `.goosehints` ×1 and `.gitignore` ×20
// (the controls — the scan finds what is there) and `.gooseignore` ×0: no code path in this build names the file, so a `.gooseignore`
// fences nothing. And its developer tools run through `developer__shell`, so even an honoured ignore file could not stop a `cat`.
// Verdict UNMEASURED — no fence; the next lever is named below. A dynamic confirmation (one nothink call against a denied path) is
// C300a, held for a quiet window (the no-local-model-during-an-active-session rule).
//
// THE GATE: writeFence() writes the whitelist ONLY when the probe reads honoured === true AND C291's TB bucket (stray touches on the
// calibration record) is > 0 — the row's "armed only when TB > 0". Otherwise it writes nothing and returns the why, which rides the
// trial row as `fence`. Falsifier (the row's): a TB trial on a tree carrying the fence.
//
//   node scripts/vna/goose-fence.mjs [--json]     re-measure the installed goose → data/vna/goose-fence-probe.json, print the verdict
// Port row: none — a one-shot probe and a file write; nothing here decides a placement or holds mass.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const PROBE_PATH = process.env.VNA_GOOSE_FENCE_PROBE || resolve(REPO, 'data/vna/goose-fence-probe.json');
export const CALIBRATION = process.env.VNA_REPLAY_CALIBRATION || resolve(REPO, 'data/vna/replay-calibration.json');
export const FENCE_FILE = '.gooseignore';
export const LITERALS = Object.freeze(['.gooseignore', '.goosehints', '.gitignore', 'developer__shell']);
export const NEXT_LEVER = 'the fence must live below the tool, not in an ignore file: goose 1.50 runs its developer tools through developer__shell, so (a) a SPARSE trial tree that holds only the whitelist and its import closure, or (b) a macOS sandbox-exec profile on the worker denying reads/writes outside the whitelist; until one is built a stray is caught after exit (TB), as today';

const count = (buf, s) => { const n = Buffer.from(s); let c = 0; for (let i = buf.indexOf(n); i >= 0; i = buf.indexOf(n, i + n.length)) c++; return c; };
/** pure over a binary's bytes: how often each literal occurs, and the verdict it supports */
export function readLiterals(buf) {
  const lit = Object.fromEntries(LITERALS.map((s) => [s, count(buf, s)]));
  const controls = lit['.goosehints'] > 0 && lit['.gitignore'] > 0;
  if (!controls) return { literals: lit, honoured: null, verdict: 'UNMEASURED — the control literals are absent too, so the scan cannot tell absence from a packed binary' };
  if (lit[FENCE_FILE] === 0) return { literals: lit, honoured: false, verdict: `UNMEASURED — no fence: the binary names ${FENCE_FILE} 0 times (controls .goosehints ×${lit['.goosehints']}, .gitignore ×${lit['.gitignore']}), so no code path reads it` };
  return { literals: lit, honoured: null, verdict: `UNMEASURED — the binary names ${FENCE_FILE} ×${lit[FENCE_FILE]}; whether the developer tools refuse a denied path needs the dynamic call (C300a)` };
}
export function probeGoose({ bin = null, read = (p) => readFileSync(p), at = new Date().toISOString() } = {}) {
  let path = bin; let version = null;
  try { path = path || execFileSync('which', ['goose'], { encoding: 'utf8' }).trim(); path = realpathSync(path); version = execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(); } catch (e) { return { at, bin: path, version, honoured: null, verdict: `UNMEASURED — goose not runnable: ${String(e.message).slice(0, 100)}`, next_lever: NEXT_LEVER, method: 'static' }; }
  return { at, bin: path, version, ...readLiterals(read(path)), next_lever: NEXT_LEVER, method: 'static — the literal file names in the binary; the dynamic call is C300a' };
}
export function readProbe(path = PROBE_PATH) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
/** C291's TB bucket on the calibration record: stray touches outside the task's file + tests, summed over the arms */
export function tbCount(path = CALIBRATION) {
  try { const c = JSON.parse(readFileSync(path, 'utf8')); return ['A', 'B'].reduce((a, k) => a + ((c[k] && c[k].misses && c[k].misses.TB) || 0), 0); } catch { return null; }
}
export function fenceArmed({ probe = readProbe(), tb = tbCount() } = {}) {
  if (!probe) return { armed: false, why: 'no goose fence probe on the record — node scripts/vna/goose-fence.mjs' };
  if (probe.honoured !== true) return { armed: false, why: `${probe.verdict || 'goose does not read the fence file'} · next lever: ${probe.next_lever || NEXT_LEVER}` };
  if (!(tb > 0)) return { armed: false, why: `C291's TB bucket is ${tb ?? 'UNMEASURED'} — the fence arms only when strays were measured` };
  return { armed: true, why: null };
}
/** gitignore syntax: deny everything, re-admit every directory (so a file inside can be re-admitted), then the whitelist */
export const fenceText = (allowed) => ['*', '!*/', ...[...new Set(allowed)].map((p) => `!${p}`), ''].join('\n');
/** writes the fence into the trial tree only when armed; returns what rides the trial row */
export function writeFence({ task, dir, probe = readProbe(), tb = tbCount() }) {
  const a = fenceArmed({ probe, tb }); const allowed = [task.file, ...(task.tests || [])];
  if (!a.armed) return { armed: false, why: a.why };
  writeFileSync(resolve(dir, FENCE_FILE), fenceText(allowed));
  return { armed: true, file: FENCE_FILE, allowed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = probeGoose(); mkdirSync(dirname(PROBE_PATH), { recursive: true }); writeFileSync(PROBE_PATH, JSON.stringify(p, null, 1) + '\n');
  if (process.argv.includes('--json')) console.log(JSON.stringify(p, null, 1));
  else console.log(`goose ${p.version || '?'} · ${p.verdict}\n  literals ${JSON.stringify(p.literals || {})}\n  next lever: ${p.next_lever}\n  → ${PROBE_PATH.slice(REPO.length + 1)}`);
}
