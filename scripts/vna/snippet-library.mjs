// scripts/vna/snippet-library.mjs — C1016d THE LATTICE LIBRARY IS THE PACKAGE'S OWN (2026-10-19). data/pmu/snippet-library-144.json is the
// 144-cell lattice the walk places on; it ships inside thetacog-mcp. envelope.mjs and legend.mjs resolved it from VNA_REPO — the CALLER's
// repo when `npx thetacog-mcp <door>` runs in a stranger's tree — so away from home the envelope read ENOENT (measured in a linux/amd64
// node:20 container, the Replit shape). One resolution, named once: VNA_SNIPPET_LIBRARY, else the caller's copy when it has one (this
// repo at home), else the copy beside this script.
// Sufficient for: which library file a reader opens. Not for: whether the library is the right lattice for that repo (it is the one we ship).
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIB_REL = 'data/pmu/snippet-library-144.json';
const OWN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function snippetLibraryPath({ env = process.env, exists = existsSync } = {}) {
  if (env.VNA_SNIPPET_LIBRARY) return env.VNA_SNIPPET_LIBRARY;
  const caller = env.VNA_REPO ? resolve(env.VNA_REPO, LIB_REL) : null;
  return caller && exists(caller) ? caller : resolve(OWN, LIB_REL);
}
