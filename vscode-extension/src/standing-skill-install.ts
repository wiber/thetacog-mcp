// packages/thetacog-mcp-vscode/src/standing-skill-install.ts — C1010 THE /STANDING-ANSWERS SKILL
// SHIPS WITH THE EXTENSION (operator 2026-10-18: "or a skill to update the standing answers in
// cc"). The vsix carries the bundled skill (skills/standing-answers/SKILL.md, generated from this
// repo's .claude/skills/standing-answers/SKILL.md by scripts/backup/emit-standing-answers-skill.mjs
// — one source, the copy rewritten to read the ten from the installed extension's own
// out/standing-questions.json and to save through the installed extension's own
// out/standing-answers.js, never a thetadrivencoach script). This module holds no vscode import on
// purpose — node --test runs it directly — so a reader can prove the install logic never
// overwrites a foreign file without spinning up a host.
//
// AXIOM 1 (record conservation): a file this install did not write is never evicted silently —
// writeFileSync only ever lands on an absent path or one byte-identical to what it would write.
// @guard tests/vna/c1010-the-standing-answers-skill-ships-with.test.mjs
import { promises as fs } from 'fs';
import * as path from 'path';

export const SKILL_RELATIVE_PATH = path.join('.claude', 'skills', 'standing-answers', 'SKILL.md');

export type InstallResult =
    | { action: 'wrote'; path: string }
    | { action: 'already-current'; path: string }
    | { action: 'refused'; path: string; reason: string };

/**
 * Write the bundled skill at `bundledSkillPath` into `workspaceRoot`/.claude/skills/standing-answers/SKILL.md.
 * Never overwrites a DIFFERENT existing file there — reports 'refused' and names the path instead.
 */
export async function installStandingSkill(workspaceRoot: string, bundledSkillPath: string): Promise<InstallResult> {
    const bundled = await fs.readFile(bundledSkillPath, 'utf8');
    const target = path.join(workspaceRoot, SKILL_RELATIVE_PATH);
    let existing: string | null = null;
    try { existing = await fs.readFile(target, 'utf8'); }
    catch { existing = null; }

    if (existing === null) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bundled);
        return { action: 'wrote', path: target };
    }
    if (existing === bundled) { return { action: 'already-current', path: target }; }
    return { action: 'refused', path: target, reason: `a different ${SKILL_RELATIVE_PATH} already exists at ${target} — not overwritten` };
}
