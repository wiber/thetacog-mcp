#!/usr/bin/env node
// scripts/vna/foreign-recompute-log.mjs — C305b: A STRANGER'S RECOMPUTE IS COUNTED.
//
// "An `npx thetacog-mcp verify` run off this machine that matches our receipt leaves a
// countable trace; UNMEASURED (n 0) until one is observed, never estimated" (the spec row,
// verbatim). Today no server endpoint receives a stranger's verify run — `verify <url>` only
// GETs the countersigner's public key at `<origin>/api/auth/keys`; it posts nothing back, and
// that endpoint runs on the Edge runtime with no persistence to write a trace into (adding one
// would need a database migration, which is the operator's call, not this door's). So this is
// the fallback the spec row names: a LOCAL ndjson counter that the verify doors append to only
// when the caller explicitly opts in (`--report`, never automatic, never blocking a verify),
// and a reader that starts honestly at n 0 rather than pretending a channel exists that does not.
//
// Nothing here identifies a person or a machine: a row is { ts, commit_sha, verdict } and
// nothing else — no hostname, no path, no IP, no pubkey.
//
//   node scripts/vna/foreign-recompute-log.mjs [--log <path>] [--json]   (read the counter)
//
// @guard tests/vna/c305b-a-stranger-recompute-is-counted.test.mjs
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const LOG_FILE = process.env.VNA_FOREIGN_RECOMPUTE_LOG || resolve(REPO, 'data/vna/foreign-recompute.ndjson');

const isValidDate = (d) => typeof d === 'string' && !Number.isNaN(Date.parse(d));

// appendForeignRecompute — the ONLY write path. Called only when a caller explicitly passes
// --report; a verify that never opts in writes nothing, ever. Best-effort: a write failure
// (read-only fs, missing dir the mkdir cannot make, etc.) never throws and never blocks the
// verify verdict that is already printed by the time this runs.
export function appendForeignRecompute({ commitSha = null, verdict, ts = new Date().toISOString(), logFile = LOG_FILE } = {}) {
  if (!verdict) throw new Error('appendForeignRecompute: verdict is required');
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, JSON.stringify({ ts, commit_sha: commitSha ? String(commitSha).slice(0, 64) : null, verdict: String(verdict) }) + '\n', 'utf8');
    return true;
  } catch {
    return false; // never blocks the verify this rides alongside
  }
}

// countForeignRecomputes({ logFile, rows }) — `rows` (an array, for tests) stands in for the
// file when supplied. n stays 0 (UNMEASURED) until a row is actually observed on disk.
export function countForeignRecomputes({ logFile = LOG_FILE, rows = null } = {}) {
  const source = `${logFile} (appended by 'npx thetacog-mcp verify ... --report' — opt-in, never automatic)`;
  let parsed = rows;
  if (parsed == null) {
    if (!existsSync(logFile)) {
      return { measured: false, n: 0, matches: 0, mismatches: 0, firstAt: null, lastAt: null, source, label: 'UNMEASURED (n 0)', reason: `no log at ${logFile} — no off-machine recompute has reported in yet` };
    }
    let raw;
    try { raw = readFileSync(logFile, 'utf8'); } catch (e) { return { measured: false, n: 0, matches: 0, mismatches: 0, firstAt: null, lastAt: null, source, label: 'UNMEASURED (n 0)', reason: `${logFile} could not be read (${e.message})` }; }
    parsed = raw.split('\n').filter((l) => l.trim().length > 0).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  if (!parsed.length) {
    return { measured: false, n: 0, matches: 0, mismatches: 0, firstAt: null, lastAt: null, source, label: 'UNMEASURED (n 0)', reason: `${logFile} is empty — no off-machine recompute has reported in yet` };
  }
  const matches = parsed.filter((r) => r && r.verdict === 'MATCH').length;
  const mismatches = parsed.filter((r) => r && r.verdict === 'MISMATCH').length;
  const dates = parsed.map((r) => r && r.ts).filter(isValidDate).sort();
  return {
    measured: true,
    n: parsed.length,
    matches,
    mismatches,
    firstAt: dates[0] ?? null,
    lastAt: dates[dates.length - 1] ?? null,
    source,
    label: `${parsed.length} observed (${matches} match, ${mismatches} mismatch)`,
    reason: null,
  };
}

if (process.argv[1] && process.argv[1].endsWith('foreign-recompute-log.mjs')) {
  const logArg = process.argv.includes('--log') ? process.argv[process.argv.indexOf('--log') + 1] : undefined;
  const result = countForeignRecomputes(logArg ? { logFile: resolve(process.cwd(), logArg) } : {});
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(result.measured ? result.label : `UNMEASURED — ${result.reason}`);
}
