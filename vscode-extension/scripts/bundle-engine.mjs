#!/usr/bin/env node
// packages/thetacog-mcp-vscode/scripts/bundle-engine.mjs — THE VSIX CARRIES ITS ENGINE (operator 2026-10-20: "package the npm
// package inside the vsx … obviously - and test that you dont need to install anything extra … bump vsx when you are sure it
// ships with all deps").
//
// The incident: a stranger's clean install got a sidebar of ten "not run" lines. The extension spawned `npx thetacog-mcp <door>`
// for every panel, and npm `latest` was 2.55.0 from 2026-09-30. Their Claude had to find, vet and globally install a 147 MB
// package by hand. Now the engine rides inside the vsix at engine/:
//   1. `npm pack` packages/thetacog-mcp — its prepack bundles the scripts and runs the cold-start check, the same tarball npm gets
//   2. extract it to engine/ (the old engine/ is removed first)
//   3. prune pmu-rust/target to the one release binary the walk runs: the rest is cargo's build cache (~197 MB of .rlib and .o)
//   4. `npm install --omit=dev --omit=optional --ignore-scripts` inside engine/, so its runtime deps ship beside it
// Runs from `vscode:prepublish`, so every `vsce package` and `vsce publish` (release.mjs too) carries a fresh engine.
// @guard tests/vna/vsix-carries-its-engine.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_SRC = resolve(HERE, '..', 'thetacog-mcp');
const OUT = join(HERE, 'engine');
const KEEP_BINARIES = ['pmu-onchip'];

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} (exit ${r.status}): ${String(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
};
const du = (p) => { let n = 0; for (const e of readdirSync(p, { withFileTypes: true })) { const f = join(p, e.name); n += e.isDirectory() ? du(f) : statSync(f).size; } return n; };

export function pruneTarget(engineDir) {
  const target = join(engineDir, 'pmu-rust', 'target');
  if (!existsSync(target)) return 0;
  const before = du(target);
  const keep = KEEP_BINARIES.map((b) => join(target, 'release', b)).filter(existsSync);
  const stash = mkdtempSync(join(tmpdir(), 'engine-bin-'));
  for (const k of keep) renameSync(k, join(stash, k.split('/').pop()));
  rmSync(target, { recursive: true, force: true });
  if (keep.length) {
    run('mkdir', ['-p', join(target, 'release')]);
    for (const k of keep) renameSync(join(stash, k.split('/').pop()), k);
  }
  rmSync(stash, { recursive: true, force: true });
  return before - (existsSync(target) ? du(target) : 0);
}

export function bundleEngine({ log = console.log } = {}) {
  const { version } = JSON.parse(readFileSync(join(ENGINE_SRC, 'package.json'), 'utf8'));
  const tmp = mkdtempSync(join(tmpdir(), 'engine-pack-'));
  try {
    log(`· engine: npm pack thetacog-mcp@${version} (prepack bundles the scripts and runs the cold-start check)…`);
    const out = run('npm', ['pack', '--pack-destination', tmp, '--silent'], ENGINE_SRC).trim().split('\n').pop();
    const tgz = join(tmp, out);
    if (!existsSync(tgz)) throw new Error(`npm pack wrote no tarball (${out})`);
    run('tar', ['-xzf', tgz, '-C', tmp]);
    rmSync(OUT, { recursive: true, force: true });
    renameSync(join(tmp, 'package'), OUT);
    const freed = pruneTarget(OUT);
    log(`· engine: pruned ${(freed / 1e6).toFixed(1)} MB of cargo build cache, kept ${KEEP_BINARIES.join(', ')}`);
    // C1380: the engine tarball BUNDLES intentguard (package.json bundleDependencies), so the walk engine needs no registry
    // fetch. npm reify re-resolves a root bundled dependency from the registry all the same when no lockfile names it
    // (arborist retires node_modules/<bundled> and asks for name@version; measured 2026-10-29: intentguard@2.1.0 read
    // notarget until the ship publishes it). A bundled copy is the tarball's, never the registry's: it steps aside for the
    // install of the other runtime deps and comes back over whatever the registry handed out.
    const bundled = (JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8')).bundleDependencies || [])
      .filter((name) => existsSync(join(OUT, 'node_modules', name)));
    const aside = join(tmp, 'bundled');
    for (const name of bundled) { mkdirSync(dirname(join(aside, name)), { recursive: true }); renameSync(join(OUT, 'node_modules', name), join(aside, name)); }
    run('npm', ['install', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], OUT);
    for (const name of bundled) { rmSync(join(OUT, 'node_modules', name), { recursive: true, force: true }); renameSync(join(aside, name), join(OUT, 'node_modules', name)); }
    if (bundled.length) log(`· engine: kept the tarball's bundled ${bundled.join(', ')} over the registry's copy`);
    writeFileSync(join(OUT, '.bundled.json'), JSON.stringify({ version, bundledAt: new Date().toISOString() }) + '\n');
    log(`✓ engine: thetacog-mcp@${version} at engine/ (${(du(OUT) / 1e6).toFixed(1)} MB with its node_modules)`);
    return { version, dir: OUT };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { bundleEngine(); } catch (e) { console.error(`✗ bundle-engine: ${e.message}`); process.exit(1); }
}
