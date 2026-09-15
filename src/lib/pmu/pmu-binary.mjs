// src/lib/pmu/pmu-binary.mjs — THE ONE canonical pmu-onchip resolver (operator 2026-07-16).
// =============================================================================
// "one rust pipeline called in different situations." The walk is spawned from several places —
// the commit gate (spec-deliver-walk), the chat/lens path (prompt-lens → unified-drift), the blog
// panel renderer, grip-microscope, attest-demo — and each used to resolve the binary relative to
// its own repo root. So a pipeline invoked from a different cwd, from the published package, or
// right after a rebuild would silently miss the binary and degrade to the gzip fallback (the sparse
// panel / the wrong placement). This resolver ends that: every caller resolves through here, and it
// searches the same canonical set of locations no matter who called it.
//
// The PMU_BINARY env override is still absolute — it wins even when it points at a nonexistent path,
// because a guard uses exactly that to FORCE the fallback (tests/…). Only when PMU_BINARY is unset do
// we search. First existing wins; if none exist we return the primary path so the caller's own
// existsSync check trips the honest, marked gzip-fallback rather than crashing.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

let _cached = null;

export function resolvePmuBinary(repoRoot) {
  if (process.env.PMU_BINARY) return process.env.PMU_BINARY;   // explicit override / force-absent guard
  if (_cached && existsSync(_cached)) return _cached;
  const REL = '.thetacog/pmu/target/release/pmu-onchip';
  const HOME = homedir();
  const candidates = [
    repoRoot ? resolve(repoRoot, REL) : null,                 // the caller's own repo (primary)
    resolve(HOME, REL),                                       // the shared per-user build
    resolve(HOME, 'GitHub/thetacog-mcp/pmu-rust/target/release/pmu-onchip'),
    resolve(HOME, 'GitHub/thetacog-mcp', REL),
    resolve(HOME, 'github/thetacog-mcp/pmu-rust/target/release/pmu-onchip'),
    resolve(HOME, 'GitHub/thetadrivencoach', REL),
  ].filter(Boolean);
  for (const c of candidates) { try { if (existsSync(c)) { _cached = c; return c; } } catch { /* keep looking */ } }
  return candidates[0];   // absent everywhere → return primary so the caller trips its honest fallback
}
