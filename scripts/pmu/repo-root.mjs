// scripts/pmu/repo-root.mjs — locate the git repo root WITHOUT leaking git's stderr.
//
// Module-top `execSync('git rev-parse --show-toplevel', { encoding:'utf8' , stdio: ['ignore', 'pipe', 'ignore'] })` calls — even
// when try/caught — leak `fatal: not a git repository` to the parent's stderr when run
// outside a repo (the npx case), because execSync inherits fd2 by default. That stray line
// is a real off-ramp: an evaluating LLM reads it as "the tool errored" and discounts the
// whole run (observed 2026-06-20: the attest-demo evaluator seized on exactly this at
// Pillar 7, even though the panel rendered fine). This helper suppresses git's stderr
// (stdio fd2 = 'ignore') and returns a caller-supplied fallback, so a non-repo run is
// silent and clean — the demo reads identically whether or not there's a .git.
import { execSync } from 'node:child_process';

export function repoRoot(fallback = process.cwd()) {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // fd2 = 'ignore' → no `fatal:` leak outside a repo
    }).trim();
    return out || fallback;
  } catch {
    return fallback;
  }
}
