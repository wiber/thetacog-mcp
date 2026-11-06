#!/usr/bin/env node
// scripts/vna/steer-every.mjs — the node door for steer-every.sh (server.js spawns every door with node, so the bash loop gets a
// node entry). Transport only: it decides nothing, it hands its args to the .sh beside it.
//   npx thetacog-mcp steer-every <steer-file> [--every-min 5] [--max-rest-min 20] [--runs 12] [--budget-usd 7.50] [--ceiling 0.75]
//   … --detach   starts the loop in the background (survives the shell that started it) and prints its pid and log path.
// The caller's repo is VNA_REPO (server.js sets it to the caller's cwd); the scripts run from wherever this file was installed.
// Guard: tests/vna/steer-every-packaged.test.mjs
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = join(dirname(fileURLToPath(import.meta.url)), 'steer-every.sh');
const args = process.argv.slice(2);
const detach = args.includes('--detach');
const rest = args.filter((a) => a !== '--detach');
const env = { ...process.env, VNA_REPO: process.env.VNA_REPO || process.cwd() };
if (rest[0] && !rest[0].startsWith('-')) rest[0] = resolve(env.VNA_REPO, rest[0]);
if (detach) {
  const child = spawn('bash', [SH, ...rest], { detached: true, stdio: 'ignore', env, cwd: env.VNA_REPO });
  child.unref();
  console.log(`steer-every: started pid ${child.pid} · log ${rest[0] ? rest[0] + '.runs.log' : 'UNMEASURED — no steer file named'}`);
} else {
  const r = spawnSync('bash', [SH, ...rest], { stdio: 'inherit', env, cwd: env.VNA_REPO });
  process.exit(r.status ?? 1);
}
