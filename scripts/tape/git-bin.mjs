// apps/cockpit/src/lib/server/repo-git.js — GIT, RESOLVED ABSOLUTELY AND FAILING OUT LOUD.
//
// ── THE MEASUREMENT ───────────────────────────────────────────────────────────────────────────
// The operator reported the canonical panel "hilariously stuck on one single png" and the page
// "flashed, then reverted to the bad state", through three fixes that each addressed a real cause
// and changed nothing he could see. The reason none of them landed: the bug was not in the page.
//
//   dev server PID 31603 · PATH=
//     apps/cockpit/node_modules/.bin:apps/node_modules/.bin:node_modules/.bin:…:/
//
// /usr/bin is NOT on it. Every `execFileSync('git', …)` in every server route throws ENOENT, and
// every one of them catches and falls back silently. git works perfectly from a shell, which is why
// this survived being looked for: the failure only exists inside the server process.
//
// npm/npx builds PATH by PREPENDING each node_modules/.bin to whatever PATH it inherits. Inherit an
// empty PATH — a launchd job, a hook, an `env -i` — and you get exactly the chain above: real, and
// containing no system directories at all.
//
// ── WHY RESOLVING THE BINARY IS THE FIX AND "FIX THE LAUNCHER" IS NOT ─────────────────────────
// Repairing whatever started this particular server helps until the next thing starts it a different
// way. Resolving the binary is inside the code's own control and cannot regress when someone
// restarts the dev server from a cron entry, a hook, or an editor. The launcher is worth fixing too,
// but it is not what makes this class of bug impossible.
//
// ── AND IT MUST BE LOUD ───────────────────────────────────────────────────────────────────────
// The old call sites all did `try { git } catch { /* no git */ }` and carried on. A silent fallback
// is how a wrong answer reaches the glass wearing the same clothes as a right one. reason() names
// the failure so a caller can put it on the page instead of quietly serving something plausible.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// ── THE ACTUAL ROOT CAUSE, AND WHY A PATH ALONE DOES NOT FIX IT ───────────────────────────────
// /usr/bin/git on macOS is not git. It is an xcrun shim that resolves a toolchain at run time, and
// with this machine's Xcode licence unaccepted it answers EVERY invocation with:
//
//   You have not agreed to the Xcode license agreements.
//
// Bisected 2026-08-21, one variable at a time:
//
//   env -i HOME=…                 /usr/bin/git --version  ->  licence error
//   env -i PATH=/usr/bin:/bin     /usr/bin/git --version  ->  licence error
//   env -i DEVELOPER_DIR=/Library/Developer/CommandLineTools  ->  git version 2.50.1  ✓
//
// DEVELOPER_DIR is the whole difference: point the shim at the Command Line Tools and it never
// consults the unlicensed Xcode.app. An interactive shell here has it exported, which is exactly why
// this was invisible — git works perfectly for a human and fails for every server route.
//
// This is also the outage +page.server.js's fallback comment attributes to 2026-08-20. It was never
// resolved; it was worked around in one of the two readers, and the other one has been serving an
// arbitrary answer ever since.
//
// Setting it here fixes git for the server without sudo, without touching machine state, and without
// depending on how the dev server was launched.
const DEVELOPER_DIRS = ['/Library/Developer/CommandLineTools', '/Applications/Xcode.app/Contents/Developer'];
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin';

/** An environment git can actually run in, whatever this process was handed. */
function gitEnv() {
  const env = { ...process.env };
  if (!env.DEVELOPER_DIR) {
    const d = DEVELOPER_DIRS.find((x) => existsSync(x));
    if (d) env.DEVELOPER_DIR = d;
  }
  // APPEND rather than replace: a deliberately-configured PATH keeps priority, and a stripped one
  // (npm hands down node_modules/.bin chains with no system dirs at all) gains the floor it needs.
  env.PATH = env.PATH ? `${env.PATH}:${SYSTEM_PATH}` : SYSTEM_PATH;
  return env;
}

// Ordered by how likely each is to be the real git on a developer machine. The bare name goes FIRST
// so a correctly-configured environment keeps using whatever it resolves — this adds a floor, it
// does not override a working setup.
// ── PREFER THE REAL BINARY. /usr/bin/git IS NOT GIT. ──────────────────────────────────────────
// /usr/bin/git is a 118,928-byte STUB that forwards to whatever toolchain xcode-select points at,
// and refuses to forward at all until that toolchain's licence has been accepted — for every
// subcommand, `git status` included. The actual git is 7,604,272 bytes and sits inside the
// toolchain. Measured on this machine:
//
//   env -i /usr/bin/git --version                                  -> licence error
//   env -i /Library/Developer/CommandLineTools/usr/bin/git --version -> git version 2.50.1  ✓
//
// The real binary needs NO environment at all — not DEVELOPER_DIR, not PATH, nothing. So the robust
// fix is not to satisfy the stub's licence check, it is to skip the stub. This also makes the app
// immune to the next licence prompt: installing Xcode.app repoints xcode-select at a DIFFERENT
// toolchain with its OWN unaccepted licence, which would re-break every bare 'git' call the same way.
//
// Ordered real-binaries-first, stub last. The stub stays on the list because on a machine where the
// licence IS accepted it works fine, and it is the right answer if the toolchain paths ever move.
const CANDIDATES = [
  '/Library/Developer/CommandLineTools/usr/bin/git',
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
  '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
  'git',
  '/usr/bin/git',
];

let _bin;
let _reason = null;

/** The git binary this process can actually execute, or null with reason() explaining. */
export function gitBin() {
  if (_bin !== undefined) return _bin;
  for (const c of CANDIDATES) {
    if (c.includes('/') && !existsSync(c)) continue;
    try {
      execFileSync(c, ['--version'], { encoding: 'utf8', timeout: 5000, env: gitEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
      _bin = c;
      return _bin;
    } catch { /* try the next candidate */ }
  }
  _bin = null;
  _reason = `git is not executable from this server process (tried ${CANDIDATES.join(', ')}). ` +
    `On macOS the usual cause is the xcrun shim with an unaccepted Xcode licence and no DEVELOPER_DIR ` +
    `— check: env -i DEVELOPER_DIR=/Library/Developer/CommandLineTools /usr/bin/git --version. ` +
    `PATH=${String(process.env.PATH || '').slice(0, 160)}`;
  return _bin;
}

/** Why git is unavailable, or null when it is available. Put this on the page — never swallow it. */
export function gitUnavailableReason() {
  gitBin();
  return _reason;
}

/**
 * Run git. Returns { ok, out, reason } and NEVER throws — but an unavailable git is reported as
 * ok:false with a reason, not as an empty result that reads like "no commits".
 */
export function git(args, opts = {}) {
  const bin = gitBin();
  if (!bin) return { ok: false, out: '', reason: gitUnavailableReason() };
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 8e6, env: gitEnv(), ...opts });
    return { ok: true, out: String(out), reason: null };
  } catch (e) {
    // status is carried because a NON-ZERO EXIT IS AN ANSWER. `rev-parse --verify` exiting 1 means
    // git looked and says that is not a commit; a spawn failure means git never looked. Collapsing
    // them turns "rejected" into "unknown" and lets a fabricated sha through.
    return { ok: false, out: '', status: e?.status ?? null, reason: `git ${args[0]} failed: ${String(e.message).slice(0, 200)}` };
  }
}

/** Recent short SHAs, newest first. Empty array WITH a reason when git cannot run. */
export function recentShas(repo, n = 40) {
  const r = git(['log', '--format=%h', `-${n}`], { cwd: repo });
  return { shas: r.ok ? r.out.split('\n').filter(Boolean) : [], reason: r.reason };
}
