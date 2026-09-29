#!/usr/bin/env node
// scripts/ops/wip.mjs — work-in-progress claims, so parallel sessions stop destroying each
// other's uncommitted edits on the one shared tree.
// ==========================================================================================
// THE INCIDENT (2026-08-29, operator: "You seem to be overwriting the other agent's work —
// figure out how to... make a work-in-progress files maybe"): two live sessions worked
// scripts/elicit/ simultaneously. One session's sweep reset the other's files to HEAD
// mid-edit — an uncommitted Exchanges section died once and was re-applied from context —
// and minutes later a STALE copy of a test file sat staged, one commit away from silently
// reverting work already pushed. Nine rooms share this tree by design (DELEGATION NEVER
// GIT-BRANCHES); the missing piece was a way to SAY "these paths are mine right now" that
// another process can CHECK before it restores, checks out, stages, or overwrites.
//
// THE PROTOCOL, three verbs and a liveness rule:
//   claim    node scripts/ops/wip.mjs claim <path...> [--note "..."]     before sustained edits
//   check    node scripts/ops/wip.mjs check <path...>                    exits 1 + lists FOREIGN
//            live claims; run it before any git restore/checkout/sweep over paths you did not
//            just edit — and never sweep a directory, name the paths
//   release  node scripts/ops/wip.mjs release <path...> | --all-mine     after commit
//   list     node scripts/ops/wip.mjs list                               everything held, by whom
//
// LIVENESS, not trust: a claim carries its pid, and a dead pid makes the claim STALE and
// reclaimable — the same lesson as the pulse tick's lock, including the recycled-pid half:
// kill -0 succeeding on a recycled pid is not liveness, so the process's command line must
// still look like a claude/node session. A crashed session never wedges a path shut.
//
// ADVISORY BY DESIGN. This cannot stop a process that does not ask — nothing on one tree can —
// but hooks/pre-commit runs `check` over the staged paths WARN-ONLY on every commit, so
// committing over a peer's live claim is at least never silent. The claim dir is gitignored
// state, one file per path, so claims never collide with each other in git.
//
// Guard: tests/ops/wip-claims.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const WIP_DIR = process.env.WIP_CLAIM_DIR || join(REPO, '.thetacog', 'wip-claims');

const safe = (p) => String(p).replace(/^\.\//, '').replace(/[^A-Za-z0-9._-]/g, '__');
const claimFile = (p, dir = WIP_DIR) => join(dir, safe(p) + '.json');

export function pidLooksLikeSession(pid, { psRead = defaultPs } = {}) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  const cmd = psRead(pid);
  if (!cmd) return false;                    // dead, or unreadable — either way not a live hold
  return /claude|node/i.test(cmd);           // recycled-pid guard: the command must still be ours
}
function defaultPs(pid) {
  try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

export function readClaim(path, dir = WIP_DIR) {
  try { return JSON.parse(readFileSync(claimFile(path, dir), 'utf8')); } catch { return null; }
}

// THE PID IS THE SESSION'S, NEVER THE CLI'S — caught by dogfooding the first claim: this
// script runs, records process.pid, and exits, so every claim was born stale (its recorder
// died with the command). CLAUDE_PID is the long-lived claude process the harness exports;
// ppid is the fallback for non-Claude callers; own pid is last resort and self-documents as
// short-lived.
const SESSION_PID = Number(process.env.CLAUDE_PID) || process.ppid || process.pid;

export function claim(paths, { session = process.env.CLAUDE_CODE_SESSION_ID || `pid-${SESSION_PID}`,
                               pid = SESSION_PID, note = '', dir = WIP_DIR, psRead = defaultPs } = {}) {
  mkdirSync(dir, { recursive: true });
  const results = [];
  for (const p of paths) {
    const existing = readClaim(p, dir);
    if (existing && existing.session !== session && pidLooksLikeSession(existing.pid, { psRead })) {
      results.push({ path: p, ok: false, heldBy: existing });
      continue;                              // a live foreign claim is never overwritten
    }
    writeFileSync(claimFile(p, dir), JSON.stringify({
      path: p, session, pid, note, ts: new Date().toISOString(),
    }) + '\n');
    results.push({ path: p, ok: true });
  }
  return results;
}

/** Foreign LIVE claims over the given paths. Stale (dead-pid) claims are reported separately
 *  and never block — a crashed session must not wedge a path shut. */
export function check(paths, { session = process.env.CLAUDE_CODE_SESSION_ID || `pid-${SESSION_PID}`,
                               dir = WIP_DIR, psRead = defaultPs } = {}) {
  const foreign = [], stale = [];
  for (const p of paths) {
    const c = readClaim(p, dir);
    if (!c || c.session === session) continue;
    (pidLooksLikeSession(c.pid, { psRead }) ? foreign : stale).push(c);
  }
  return { ok: foreign.length === 0, foreign, stale };
}

export function release(paths, { dir = WIP_DIR } = {}) {
  let n = 0;
  for (const p of paths) { try { unlinkSync(claimFile(p, dir)); n += 1; } catch {} }
  return n;
}

export function listClaims({ dir = WIP_DIR, psRead = defaultPs } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return { ...c, live: pidLooksLikeSession(c.pid, { psRead }) };
    } catch { return null; }
  }).filter(Boolean);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const [cmd, ...rest] = process.argv.slice(2);
  const noteIdx = rest.indexOf('--note');
  const note = noteIdx > -1 ? rest[noteIdx + 1] : '';
  const paths = rest.filter((a, i) => !a.startsWith('--') && (noteIdx === -1 || i !== noteIdx + 1));
  if (cmd === 'claim') {
    const rs = claim(paths, { note });
    for (const r of rs) console.log(r.ok ? `✋ claimed ${r.path}`
      : `✗ ${r.path} HELD by ${r.heldBy.session} (pid ${r.heldBy.pid}, since ${r.heldBy.ts}${r.heldBy.note ? ` — ${r.heldBy.note}` : ''})`);
    process.exit(rs.every((r) => r.ok) ? 0 : 1);
  } else if (cmd === 'check') {
    const v = check(paths);
    for (const c of v.foreign) console.log(`✗ ${c.path} — LIVE claim by ${c.session} (pid ${c.pid}, since ${c.ts}${c.note ? ` — ${c.note}` : ''})`);
    for (const c of v.stale) console.log(`· ${c.path} — stale claim by ${c.session} (pid ${c.pid} dead) — reclaimable`);
    if (v.ok && !v.stale.length && paths.length) console.log('clear — no foreign claims');
    process.exit(v.ok ? 0 : 1);
  } else if (cmd === 'release') {
    if (rest.includes('--all-mine')) {
      const mine = listClaims().filter((c) => c.session === (process.env.CLAUDE_CODE_SESSION_ID || `pid-${process.pid}`));
      console.log(`released ${release(mine.map((c) => c.path))} claim(s)`);
    } else console.log(`released ${release(paths)} claim(s)`);
  } else if (cmd === 'list') {
    const all = listClaims();
    if (!all.length) console.log('no claims held');
    for (const c of all) console.log(`${c.live ? '✋ LIVE ' : '· stale'} ${c.path} — ${c.session} (pid ${c.pid}, ${c.ts})${c.note ? ` — ${c.note}` : ''}`);
  } else {
    console.log('usage: wip.mjs claim|check|release|list <paths...> [--note "..."] [--all-mine]');
    process.exit(2);
  }
}
