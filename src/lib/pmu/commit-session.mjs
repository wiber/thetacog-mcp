// src/lib/pmu/commit-session.mjs — THE SESSION THAT MADE A COMMIT, RECORDED AT THE COMMIT (2026-10-08).
//
// Every commit-intent / commit-reality row on the walk tape carried `session: null`, so the meter could pair a
// commit with a prompt only by time across parallel rooms — the steer source was unstamped end to end. The room
// already rides on the row (room-key.mjs, from the Originating-Terminal trailer); the session never did, because
// walk-door read it from the walker's own env, and the walker runs detached or from the backfill, whose env is
// not the committing session's.
//
// So the session is captured where it is TRUE: hooks/post-commit runs inside the git process the session spawned,
// and appends one row {ts, sha, session} to SESSION_LEDGER before anything detaches. walk-door stamps commit rows
// from this ledger by sha. A commit made outside a session (operator shell, launchd) has no row → null. Null stays
// null; it is never guessed and never backfilled from a timestamp (prospective-only, AXIOM 1 W4). The FIRST row
// for a sha wins: a later re-run of the hook (PC_PINNED_SHA from another process) cannot overwrite who committed.
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SESSION_LEDGER = process.env.COMMIT_SESSION_LEDGER || resolve(REPO, '.thetacog/commit-session.ndjson');
const SESSION_RE = /^[A-Za-z0-9._:-]{4,128}$/;

/** the committing session's id from the hook's env, or null */
export function sessionFromEnv(env = process.env) {
  const s = env.CLAUDE_CODE_SESSION_ID || env.LENS_SESSION_ID || env.CLAUDE_SESSION_ID || '';
  return SESSION_RE.test(s) ? s : null;
}

/** append {ts, sha, session}; no-op without a sha or a well-formed session */
export function recordCommitSession(sha, session, ledger = SESSION_LEDGER) {
  if (!sha || !SESSION_RE.test(String(session || ''))) return false;
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), sha: String(sha), session: String(session) }) + '\n');
  return true;
}

/** the session that made `ref` (full or abbreviated sha), first row wins; null when unrecorded */
export function sessionFromCommit(ref, ledger = SESSION_LEDGER) {
  if (!ref || !existsSync(ledger)) return null;
  const r = String(ref);
  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row && row.sha && row.session && (row.sha.startsWith(r) || r.startsWith(row.sha))) return row.session;
  }
  return null;
}
