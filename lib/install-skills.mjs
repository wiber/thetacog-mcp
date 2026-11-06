#!/usr/bin/env node
// Copies the bundled /steer and /tend skills into an installing repo's .claude/skills/,
// so `npm install thetacog-mcp` alone places a working dispatch door — no manual copy,
// no Replit-specific glue. C1113, operator 2026-10-21: "if it can run npm, it should run
// /steer (package the skills inside npm thetacog-mcp. and lets go from there".
// C1220 (2026-10-22): the write goes through src/lib/agent-hosts.mjs fixSlots, the one slot writer the doctor uses — an earlier copy of
// OUR skill is kept under .thetacog/doctor/replaced/ before it is replaced, and someone else's SKILL.md at that path is never overwritten
// (this used copyFileSync over whatever stood there: AXIOM 1, a record evicted with nothing kept).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledSkills, fixSlots, readSlots } from '../src/lib/agent-hosts.mjs';

export const SKILL_NAMES = ['steer', 'tend', 'rewrite', 'licence', 'licence-admin', 'doctor'];   // C2173: /rewrite (the anti-slop pass) lands wherever /steer lands · C2305: /licence and /licence-admin (its operator side) · C2312: /doctor (check this install, write the handoff)
// C1373 (2026-10-28): a cold evaluator ran `attest-demo` in a scratch dir and found postinstall
// quietly writing .claude/skills into THAT dir with no name and no way out — graded as a trust
// cost ("running it inside a repo will quietly add skills to that repo"). THETACOG_NO_SKILLS=1
// skips every write here; postinstall.js prints the opt-out line and, when it does write, the
// absolute path of every file it wrote (never a silent copy).
export const NO_SKILLS_ENV = 'THETACOG_NO_SKILLS';
// where each shipped skill is synced from in the monorepo (scripts/sync-skills.mjs, at prepack). /steer is the STRANGER-SAFE copy the vsix
// ships — every command a door (`npx thetacog-mcp <door>`), never a path on one machine (operator 2026-10-22: "yes, npm ships the stranger
// version too"); the home .claude/skills/steer is written for this repo's own command table and misleads anywhere else.
export const SKILL_SOURCES = Object.freeze({
  steer: 'packages/thetacog-mcp-vscode/skills/steer/SKILL.md',
  // C1374 (2026-10-28): 73c2bb3a50 shipped skills/steer-every beside /steer (the vsix's stranger-safe copy, byte-identical) but never
  // registered its source here, so sync-skills could not resync it and c1220 read a bundled skill with no source. SKILL_NAMES is
  // unchanged on purpose: npm postinstall still writes only /steer and /tend into an installing repo; the vsix writes /steer-every
  // itself (COMPANION_SKILLS in packages/thetacog-mcp-vscode/src/steer-skill-install.ts).
  'steer-every': 'packages/thetacog-mcp-vscode/skills/steer-every/SKILL.md',
  tend: '.claude/skills/tend/SKILL.md',
  project: '.claude/skills/project/SKILL.md',   // C2170c: the project sheets skill ships beside /steer and /tend
  // C2322: /board (every other sheet door) and /sheet (the one-sign-in ask sheet + the tree-as-a-sheet option) ship
  // beside /tend and /project — the Google Sheets integration is bundled as skills inside the npm package.
  board: '.claude/skills/board/SKILL.md',
  sheet: '.claude/skills/sheet/SKILL.md',
  // C2173: the STRANGER-SAFE /rewrite (every command the `npx thetacog-mcp rewrite` door, cloud tracks by default, dry-run); the home
  // .claude/skills/rewrite drives scripts/rewrite.sh and the dev server, which exist only in this repo
  rewrite: 'packages/thetacog-mcp-vscode/skills/rewrite/SKILL.md',
  // C2305: /licence — connect, buy, paste, status, sign and countersign, every command an npx door (the vsix's 🔑 pills, in the CLI)
  licence: 'packages/thetacog-mcp-vscode/skills/licence/SKILL.md',
  // C2305: /licence-admin — the OPERATOR side (grant · issue-key · revoke-key · keyring · claim-links · the funnels), every command an npx
  // door that refuses in one line without the operator's keys (lib/door-needs.mjs)
  'licence-admin': 'packages/thetacog-mcp-vscode/skills/licence-admin/SKILL.md',
  // C2312: /doctor — `npx thetacog-mcp doctor`, every command an npx door, the same check the extension's 🩺 button runs
  doctor: 'packages/thetacog-mcp-vscode/skills/doctor/SKILL.md',
});
/** the engine's own monorepo: its .claude/skills are the SOURCE the package copies, never a slot to write */
export const isEngineHome = (root) => fs.existsSync(path.join(root, 'packages', 'thetacog-mcp', 'package.json'));

/** the names now current in the target's .claude/skills (written now or already there); `refused` names a foreign file left
 * alone; `wrote` names the absolute paths actually written THIS call (missing or ours-old slots) — the disclosure line in
 * postinstall.js reads this, never a guess. `THETACOG_NO_SKILLS=1` short-circuits before any write or read of the target. */
export function installSkills({ packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), targetRoot }) {
  if (process.env[NO_SKILLS_ENV] === '1') return Object.assign([], { refused: [], wrote: [], skipped: true });
  const skills = bundledSkills(packageDir).filter((s) => SKILL_NAMES.includes(s.name));
  if (isEngineHome(targetRoot)) return Object.assign([], { refused: [], wrote: [], engineHome: true });
  const written = fixSlots(targetRoot, skills, { hosts: ['claude-code'] });
  const slots = readSlots(targetRoot, skills).filter((s) => s.host === 'claude-code');
  const installed = slots.filter((s) => s.state === 'current').map((s) => s.skill);
  const refused = slots.filter((s) => s.state === 'foreign').map((s) => s.path);
  const wrote = written.filter((s) => s.host === 'claude-code').map((s) => path.join(targetRoot, s.path));
  return Object.assign(installed, { refused, wrote });
}
