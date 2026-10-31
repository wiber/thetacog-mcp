// packages/thetacog-mcp-vscode/src/steer-skill-install.ts — SHIP /STEER AS A CLAUDE CODE SKILL
// (a stranger typed /steer in Claude Code and got "Unknown command: /steer"; their Claude then
// wrote its OWN ~/.claude/skills/steer/SKILL.md — never ours, and uninformed by what this
// extension can actually run away from home). The home skill at .claude/skills/steer/SKILL.md is
// written for the extension's own development repo (its own command table, its own spec file) and
// is useless — or misleading — pasted into a stranger's workspace. This module installs the
// STRANGER-SAFE copy bundled with the extension (skills/steer/SKILL.md, every command a door —
// `npx thetacog-mcp <door>` — never a path that exists on one machine only) into the open
// workspace's own .claude/skills/steer/SKILL.md — the same refuse-on-foreign-file contract as
// installStandingSkill (standing-skill-install.ts, C1010), never a second rule.
//
// AXIOM 1 (record conservation): a file this install did not write is never evicted silently —
// writeFileSync only ever lands on an absent path or one byte-identical to what it would write.
// @guard tests/vna/c1013f-steer-skill-ships-with.test.mjs
import { promises as fs } from 'fs';
import * as path from 'path';

export const STEER_SKILL_RELATIVE_PATH = path.join('.claude', 'skills', 'steer', 'SKILL.md');

/** the bundled skills that ride with /steer, each written beside it by the same refuse-on-foreign-file rule (steer-every: 2026-10-28) */
export const COMPANION_SKILLS: readonly string[] = Object.freeze(['steer-every']);

/** Write one bundled companion skill (skills/<name>/SKILL.md) into `workspaceRoot`/.claude/skills/<name>/SKILL.md — never over a different file. */
export async function installCompanionSkill(workspaceRoot: string, extensionPath: string, name: string): Promise<SteerSkillInstallResult> {
    const bundled = await fs.readFile(path.join(extensionPath, 'skills', name, 'SKILL.md'), 'utf8');
    const target = path.join(workspaceRoot, '.claude', 'skills', name, 'SKILL.md');
    let existing: string | null = null;
    try { existing = await fs.readFile(target, 'utf8'); } catch { existing = null; }
    if (existing === null) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bundled); return { action: 'wrote', path: target }; }
    if (existing === bundled) { return { action: 'already-current', path: target }; }
    return { action: 'refused', path: target, reason: `a different .claude/skills/${name}/SKILL.md already exists at ${target} — not overwritten` };
}

export type SteerSkillInstallResult =
    | { action: 'wrote'; path: string }
    | { action: 'already-current'; path: string }
    | { action: 'refused'; path: string; reason: string };

/**
 * Write the bundled skill at `bundledSkillPath` into `workspaceRoot`/.claude/skills/steer/SKILL.md.
 * Never overwrites a DIFFERENT existing file there — reports 'refused' and names the path instead.
 */
export async function installSteerSkill(workspaceRoot: string, bundledSkillPath: string): Promise<SteerSkillInstallResult> {
    const bundled = await fs.readFile(bundledSkillPath, 'utf8');
    const target = path.join(workspaceRoot, STEER_SKILL_RELATIVE_PATH);
    let existing: string | null = null;
    try { existing = await fs.readFile(target, 'utf8'); }
    catch { existing = null; }

    if (existing === null) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bundled);
        return { action: 'wrote', path: target };
    }
    if (existing === bundled) { return { action: 'already-current', path: target }; }
    return { action: 'refused', path: target, reason: `a different ${STEER_SKILL_RELATIVE_PATH} already exists at ${target} — not overwritten` };
}

/**
 * C1220 — read-only: is /steer registered for Claude Code in this workspace? 'missing' (no file), 'current' (byte-identical to the
 * bundled copy) or 'differs' (a file stands there and is not ours as bundled — never touched). The activation check reads this and
 * offers the install once; the write itself stays a click.
 */
export async function steerSkillState(workspaceRoot: string, bundledSkillPath: string): Promise<'missing' | 'current' | 'differs'> {
    const target = path.join(workspaceRoot, STEER_SKILL_RELATIVE_PATH);
    let existing: string | null = null;
    try { existing = await fs.readFile(target, 'utf8'); } catch { return 'missing'; }
    const bundled = await fs.readFile(bundledSkillPath, 'utf8');
    return existing === bundled ? 'current' : 'differs';
}
