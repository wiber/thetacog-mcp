// C826f — THE FILE CENSUS: which folders gave birth to files in the last 24 h, read off the disk, never from memory.
// 2026-10-15 the repo held ~500 k files nobody counted: parent-tree 63 k (a lost sparse cone), cache 99 k loose logs,
// pipeline stages 210 k (123 GB), cockpit turns 27 k (74 GB). Each pile grew for weeks because no reading named it, and
// every one was a generator writing a new file per run instead of appending to a tape. This walk counts births (macOS
// birth time, `find -Btime`) per folder, ledgers the top spawners, and flags any folder past SPAWN_LIMIT a day, so the
// next per-run generator is named within the hour on the /mem CONTROL line instead of at 100 GB. It runs detached and
// niced from the /mem tick at most once an hour (15 s of mostly kernel time on the 2026-10-15 tree).
import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEDGER = resolve(REPO, '.thetacog/file-census.ndjson');
export const SPAWN_LIMIT = 500;          // births per folder per 24 h before the folder is flagged
export const EVERY_MS = 3600 * 1000;
const PRUNE = ['.git', 'node_modules', 'target'];

/** Group born paths by folder (the file's parent dir, relative to the repo). */
export function census(paths, { limit = SPAWN_LIMIT, top = 12 } = {}) {
  const by = new Map();
  for (const p of paths) { const d = dirname(p.replace(/^\.\//, '')); by.set(d, (by.get(d) || 0) + 1); }
  const rows = [...by].sort((a, b) => b[1] - a[1]);
  return { born: paths.length, folders: by.size, top: rows.slice(0, top).map(([dir, n]) => ({ dir, n })), flagged: rows.filter(([, n]) => n >= limit).map(([dir, n]) => ({ dir, n })) };
}

export function walk({ repo = REPO } = {}) {
  const args = ['.', '('];
  PRUNE.forEach((n, i) => { if (i) args.push('-o'); args.push('-name', n); });
  args.push(')', '-prune', '-o', '-type', 'f', '-Btime', '-1d', '-print');
  const r = spawnSync('find', args, { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0 && !r.stdout) return null;
  return r.stdout.split('\n').filter(Boolean);
}

export function last({ ledger = LEDGER } = {}) {
  try { const l = readFileSync(ledger, 'utf8').trim().split('\n'); return JSON.parse(l[l.length - 1]); } catch { return null; }
}

export function due({ ledger = LEDGER, now = Date.now() } = {}) {
  const l = last({ ledger }); return !l || now - Date.parse(l.ts) >= EVERY_MS;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const t0 = Date.now(); const paths = walk();
  if (!paths) { console.error('census UNMEASURED: find failed'); process.exit(1); }
  const row = { ts: new Date().toISOString(), ms: Date.now() - t0, ...census(paths) };
  mkdirSync(dirname(LEDGER), { recursive: true }); appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row, null, process.argv.includes('--json') ? 0 : 2));
}
