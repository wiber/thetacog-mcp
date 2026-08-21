#!/usr/bin/env node
// scripts/pmu/lens-tester-open.mjs — `npx thetacog-mcp lens-tester`: serve the Lens Tester page on a
// local 127.0.0.1 port (secure context → same-origin POST /lens + GET /lens-tape work) and open it.
// Mirrors attest-open.mjs (the serve+bash-open pattern): single-runner on the FIXED port (default 7315),
// prior attest-serve replaced by its recorded PID. The lens is LLM-FREE — the page runs the real
// prompt-lens pipeline through /lens; nothing leaves the machine.
//
//   npx thetacog-mcp lens-tester

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
// the served dir: prefer the repo's docs/pmu, else the bundled package's docs/pmu (must hold lens-tester.html)
const candidates = [resolve(HERE, '..', '..', 'docs', 'pmu'), resolve(HERE, '..', '..', '..', 'docs', 'pmu')];
const serveDir = candidates.find((d) => existsSync(resolve(d, 'lens-tester.html')));
if (!serveDir) { console.error('✗ lens-tester.html not found under docs/pmu — run from the thetadrivencoach repo.'); process.exit(1); }

const SCRATCH = resolve(serveDir, '..', '..');                 // scratch, outside serveDir
const portFile = resolve(SCRATCH, '.attest-serve.port');
const pidFile = resolve(SCRATCH, '.attest-serve.pid');
const PORT = Number(process.env.THETACOG_ATTEST_PORT || 7315); // fixed → the URL is known before the bind
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SINGLE-RUNNER: replace any prior attest-serve WE started, by its RECORDED PID (never lsof/pgrep by port).
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (existsSync(pidFile)) {
  const prior = Number(readFileSync(pidFile, 'utf8').trim());
  if (prior && alive(prior)) {
    try { process.kill(prior, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 40 && alive(prior); i++) await sleep(50);   // ≤2s for a clean exit
    console.log(`  ↻ replaced prior attest-serve (pid ${prior})`);
  }
}
try { if (existsSync(portFile)) rmSync(portFile); } catch { /* */ }

const child = spawn(process.execPath, [resolve(HERE, 'attest-serve.mjs'), serveDir, portFile, String(PORT), pidFile], { detached: true, stdio: 'ignore' });
child.unref();

let ready = false;
for (let i = 0; i < 60; i++) { if (existsSync(portFile)) { const p = readFileSync(portFile, 'utf8').trim(); if (p === String(PORT)) { ready = true; break; } if (p === 'ERR') break; } await sleep(50); }

const base = ready ? `http://localhost:${PORT}` : `file://${serveDir}`;
const OPENER = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'cmd' : 'xdg-open');
const openArgs = (u) => process.platform === 'win32' ? ['/c', 'start', '', u] : [u];
const open = (u) => { try { const r = spawnSync(OPENER, openArgs(u), { stdio: 'ignore' }); return r.status === 0; } catch { return false; } };
const ok = open(`${base}/lens-tester.html`);

console.log(`\n  🔬 Lens Tester  ${base}/lens-tester.html   ${ok ? '(opening…)' : ''}`);
console.log(`  ▸ run one from the CLI:  npx thetacog-mcp lens-run "<prompt>" [--ideal <domain>]`);
console.log(`  ${ready ? `✓ serving on :${PORT} (127.0.0.1 only, LLM-free /lens live, replaces prior run, auto-exits 30 min)` : '⚠ file:// fallback — same-origin /lens needs the local server; re-run from the repo.'}`);
if (!ok && ready) console.log(`  ↑ if no tab opened, paste the URL above into your browser.`);
console.log('');
