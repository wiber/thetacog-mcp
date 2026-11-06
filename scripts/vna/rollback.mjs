// scripts/vna/rollback.mjs — C274 (U11) THE LOOP LEAVES THE TREE AS IT FOUND IT. Operator 2026-09-25, verbatim: "If a dispatch does
// not end in a passing Red Witness commit, the host must execute a surgical rollback on only the target files specified in the brief"
// — bounded by the shared-tree rule (nine rooms and a dozen daemons write this tree while a worker runs):
//   SCOPE      only the brief's TARGETS (the row's guard + the files it names + the code slot's file) — never the whole tree; a daemon
//              file that appeared during the dispatch is not the worker's and is never touched
//   RESTORE    a target that was CLEAN at dispatch and is dirty after: tracked → `git restore --staged --worktree --source=HEAD`;
//              untracked (the worker created it) → removed. A target dirty BEFORE dispatch is someone's work — left alone.
//   CLAIMS     a target with a live foreign WIP claim is skipped and named (scripts/ops/wip.mjs check)
//   SCAFFOLD   the guard the host wrote for this dispatch (C270) is removed only if it is still untracked
//   COMMITS    a commit carrying THIS dispatch's Steer-Dispatch trailer that did not land is `git revert`ed — additive, never a reset
//   NEVER      git stash · git reset · git checkout -- <dir> · a path outside the targets
// Every action is returned for the halt row; nothing is silent.
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (repo, ...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return null; } };
const statusOf = (repo, p) => (git(repo, 'status', '--porcelain', '--untracked-files=all', '--', p) || '').trim();
const tracked = (repo, p) => git(repo, 'ls-files', '--error-unmatch', '--', p) !== null;

/** at dispatch: HEAD and each target's porcelain status ('' = clean) */
export function snapshot({ repo, targets }) {
  const paths = [...new Set((targets || []).filter(Boolean))];
  return { head0: (git(repo, 'rev-parse', 'HEAD') || '').trim(), paths, st: Object.fromEntries(paths.map((p) => [p, statusOf(repo, p)])) };
}

export async function defaultForeign(paths) { try { const w = await import('../ops/wip.mjs'); return w.check(paths).foreign.map((c) => c.path || c.paths || c); } catch { return []; } }

/** after a dispatch that did not land → { reverted, restored, removed, skipped, scaffold } */
export async function rollback({ repo, snap, nonce = null, scaffolded = null, foreign = defaultForeign }) {
  const out = { reverted: [], revert_failed: [], restored: [], removed: [], skipped: [], scaffold: null };
  // 1. this dispatch's own commits (the trailer is the proof of authorship), newest first
  if (nonce && snap.head0) {
    const shas = (git(repo, 'log', '--format=%H', `--grep=Steer-Dispatch: ${nonce}`, `${snap.head0}..HEAD`) || '').split('\n').filter(Boolean);
    for (const s of shas) {
      if (git(repo, 'revert', '--no-edit', s) !== null) out.reverted.push(s.slice(0, 10));
      else { git(repo, 'revert', '--abort'); out.revert_failed.push(s.slice(0, 10)); }
    }
  }
  // 2. targets clean at dispatch, dirty now
  const dirtied = snap.paths.filter((p) => snap.st[p] === '' && statusOf(repo, p) !== '');
  const held = new Set(dirtied.length ? await foreign(dirtied) : []);
  for (const p of dirtied) {
    if (held.has(p)) { out.skipped.push(`${p} (live foreign WIP claim)`); continue; }
    if (tracked(repo, p)) { if (git(repo, 'restore', '--staged', '--worktree', '--source=HEAD', '--', p) !== null) out.restored.push(p); else out.skipped.push(`${p} (restore failed)`); }
    else if (existsSync(resolve(repo, p))) { rmSync(resolve(repo, p), { force: true }); out.removed.push(p); }
  }
  // 3. the host-written guard, if it never got committed
  if (scaffolded && !tracked(repo, scaffolded) && existsSync(resolve(repo, scaffolded))) { rmSync(resolve(repo, scaffolded), { force: true }); out.scaffold = scaffolded; }
  return out;
}
export const rollbackLine = (r) => { const bits = [r.reverted.length && `reverted ${r.reverted.join(',')}`, r.restored.length && `restored ${r.restored.join(',')}`, r.removed.length && `removed ${r.removed.join(',')}`, r.scaffold && `removed the host's guard ${r.scaffold}`, r.skipped.length && `left ${r.skipped.join(', ')}`].filter(Boolean); return bits.length ? `rolled back: ${bits.join(' · ')}` : 'rollback: nothing of the worker\'s left in the tree'; };
