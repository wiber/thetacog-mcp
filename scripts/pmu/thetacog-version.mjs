// scripts/pmu/thetacog-version.mjs — C2233 THE PACKAGE VERSION, READ AT EITHER DEPTH.
// A script under scripts/pmu/ runs from two roots: the repo (the site's package.json at the root, the package under
// packages/thetacog-mcp/) and an npx install (the package IS the root). C1445 read only the repo path, so
// `npx -y thetacog-mcp@latest attest-demo` threw ENOENT on its first line in 2.58.3 and 2.59.0, the command every
// post and deck hands a stranger. The answer is the first package.json that names itself thetacog-mcp.
// Guard: tests/vna/c2233-attest-demo-runs-from-the-installed-package.test.mjs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CANDIDATES = Object.freeze(['package.json', 'packages/thetacog-mcp/package.json']);

export function thetacogMcpVersion(root) {
  for (const rel of CANDIDATES) {
    let p; try { p = JSON.parse(readFileSync(resolve(root, rel), 'utf8')); } catch { continue; }
    if (p && p.name === 'thetacog-mcp' && p.version) return p.version;
  }
  throw new Error(`no thetacog-mcp package.json under ${root} (looked at ${CANDIDATES.join(' and ')})`);
}
