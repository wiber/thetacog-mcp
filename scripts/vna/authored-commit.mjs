// C309b — THE COMMIT YOU MEANT, NOT THE HOOK THAT PUBLISHED THE PAGE (the buyer's monologue, state 5).
// Every authored commit is followed by the post-commit hook's own `chore(commit-page): publish …` (one generated
// file, reality 0 bytes), so anything that reads "HEAD" reads the machine's commit. cockpit.mjs learned this on
// 2026-09-17; two extension doors kept passing HEAD literally (the cockpit panel's `--commit HEAD`, 🔏 Sign's
// `--sha HEAD`) and walked/signed the machine commit anyway. The rule lives here once; cockpit re-exports it,
// auth-flow resolves `--sha authored` through it. An explicit sha is always honoured as given.
import { execFileSync } from 'node:child_process';

export const MACHINE_COMMIT = /^chore\((commit-page|records)\)|derived-receipt sweep|\[panel-attached\]/;

// log: [{ sha, subject }] newest first — the first subject that is not the machine's. When every row is the
// machine's, the newest is returned: walking a machine commit beats walking nothing, and the receipt says which.
export function pickAuthoredCommit(log) {
  for (const row of log) if (!MACHINE_COMMIT.test(String(row.subject || ''))) return row.sha;
  return log[0]?.sha || 'HEAD';
}

export function lastAuthored(cwd = process.cwd()) {
  try {
    const out = execFileSync('git', ['log', '-n', '40', '--format=%H%x1f%s'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return pickAuthoredCommit(out.split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\x1f'); return { sha, subject }; }));
  } catch { return 'HEAD'; }
}

// `authored` is the named request; anything else (a sha, HEAD, a ref) passes through untouched.
export function resolveCommitArg(arg, cwd = process.cwd()) {
  return arg === 'authored' ? lastAuthored(cwd) : arg;
}
