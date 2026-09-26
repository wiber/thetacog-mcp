#!/usr/bin/env node
// scripts/pmu/attest-open.mjs — `npx thetacog-mcp attest-open`: serve the already-built attest-demo pages
// on a local 127.0.0.1 port (secure context → flight tape + WebCrypto + the /render Rust endpoint work) and
// open them. No re-render — this is the fast "open the dev server page" command. Run `attest-demo` first if
// the pages are absent. Air-gapped to the internet; the local Rust /render lives in attest-serve.
//
// Single-runner on a FIXED port (default 7315, THETACOG_ATTEST_PORT to override): a prior attest-serve we
// started is killed by its recorded PID and replaced, so the URL is stable and the browser opens right away.
//
//   npx thetacog-mcp attest-open            # (replace prior) serve + open the instrument + the report
//   npx thetacog-mcp attest-open --golden   # pre-seed the faithful→sledgehammer tape first

import { existsSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const BUILD_ARGS = [resolve(HERE, 'attest-demo.mjs'), '--no-open', '--no-serve', '--no-llm'];
const BUILD_CWD = resolve(HERE, '..', '..');   // the repo (or bundled package) root
// the served dir: prefer the repo's docs/pmu, else the bundled package's docs/pmu
const candidates = [resolve(HERE, '..', '..', 'docs', 'pmu'), resolve(HERE, '..', '..', '..', 'docs', 'pmu')];
let serveDir = candidates.find((d) => existsSync(resolve(d, 'attest-demo-ux.html')));
// only build SYNCHRONOUSLY when there is nothing to open yet — otherwise we open the last build instantly
// and rebuild in the BACKGROUND (below), so the browser pops right away and refreshes into the fresh pages.
if (!serveDir) {
  console.log('▸ no pages yet — building once (first run) …');
  spawnSync(process.execPath, BUILD_ARGS, { cwd: BUILD_CWD, stdio: 'inherit' });
  serveDir = candidates.find((d) => existsSync(resolve(d, 'attest-demo-ux.html')));
  if (!serveDir) { console.error('✗ build failed — attest-demo-ux.html not found.'); process.exit(1); }
}

if (argv.includes('--golden') && existsSync(resolve(serveDir, 'golden-setup.json'))) {
  copyFileSync(resolve(serveDir, 'golden-setup.json'), resolve(serveDir, 'attest-flight-tape.json'));
  console.log('✓ golden run seeded → faithful (IN_LANE) · sledgehammer (OFF_DOMAIN)');
}

const SCRATCH = resolve(serveDir, '..', '..');                 // scratch, outside serveDir
const portFile = resolve(SCRATCH, '.attest-serve.port');
const pidFile = resolve(SCRATCH, '.attest-serve.pid');
const PORT = Number(process.env.THETACOG_ATTEST_PORT || 7315); // fixed → the URL is known before the bind
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SINGLE-RUNNER: replace any prior attest-serve WE started, by its RECORDED PID. Never lsof/pgrep by port or
// name (a port has many client sockets; a filename can match a git commit shell — both hard rules). Kill →
// wait for it to actually exit → the fixed port is free for the fresh bind.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (existsSync(pidFile)) {
  const prior = Number(readFileSync(pidFile, 'utf8').trim());
  if (prior && alive(prior)) {
    try { process.kill(prior, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 40 && alive(prior); i++) await sleep(50);   // ≤2s for a clean exit
    console.log(`  ↻ replaced prior attest-serve (pid ${prior})`);
  }
}
try { if (existsSync(portFile)) rmSync(portFile); } catch { /* */ }  // drop stale port so the poll can't read it

const child = spawn(process.execPath, [resolve(HERE, 'attest-serve.mjs'), serveDir, portFile, String(PORT), pidFile], { detached: true, stdio: 'ignore' });
child.unref();

// the port is KNOWN (fixed) — just confirm the bind, then open. Fast, because we just freed the port.
let ready = false;
for (let i = 0; i < 60; i++) { if (existsSync(portFile)) { const p = readFileSync(portFile, 'utf8').trim(); if (p === String(PORT)) { ready = true; break; } if (p === 'ERR') break; } await sleep(50); }

const base = ready ? `http://localhost:${PORT}` : `file://${serveDir}`;
// OPEN both pages NOW — the whole point of this command. Cross-platform opener; the UX page first (the
// instrument), the report second. spawnSync so it fires before the process exits.
const OPENER = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'cmd' : 'xdg-open');
const openArgs = (u) => process.platform === 'win32' ? ['/c', 'start', '', u] : [u];
const open = (u) => { try { const r = spawnSync(OPENER, openArgs(u), { stdio: 'ignore' }); return r.status === 0; } catch { return false; } };
// --no-open (operator 2026-07-18: "instead of opening new pages, running it should auto-refresh the
// page in .5s"): serve/replace the server but DON'T spawn a browser tab — the already-open page's
// 0.5s poll picks up tape changes AND page-code changes (via /page-version → location.reload). This
// is the dev loop: run → the open page refreshes itself, no tab pile-up.
const noOpen = argv.includes('--no-open');
const okUx = noOpen ? false : open(`${base}/attest-demo-ux.html`);
if (!noOpen) open(`${base}/attest-demo-report.html`);

console.log(`\n  🔒 instrument  ${base}/attest-demo-ux.html   ${noOpen ? '(serving — the open tab auto-refreshes in ≤0.5s)' : (okUx ? '(opening…)' : '')}`);
console.log(`  📄 red-pill    ${base}/attest-demo-report.html`);
console.log(`  🖲  perturb     npx thetacog-mcp perturb --scenario sledgehammer   (the page updates on the next poll)`);
console.log(`  ${ready ? `✓ serving on :${PORT} (127.0.0.1 only, Rust /render live, replaces prior run, auto-exits 30 min)` : '⚠ file:// fallback — WebCrypto uses the pure-JS hash; no live /render'}`);
if (!okUx && ready) console.log(`  ↑ if no tab opened, paste the instrument URL above into your browser.`);

// BACKGROUND REBUILD (fresh pages) unless --open-only — detached so the tab opens INSTANTLY above; the
// no-store server serves the fresh build on refresh. "Run the dev server too" without delaying the open.
if (!argv.includes('--open-only')) {
  const b = spawn(process.execPath, BUILD_ARGS, { cwd: BUILD_CWD, detached: true, stdio: 'ignore' });
  b.unref();
  console.log(`  ▸ rebuilding fresh pages in the background — refresh the tab in ~15s for the latest.`);
}
console.log('');
