// packages/thetacog-mcp-vscode/src/vna-steer-skill.ts — the command half of the bundled /steer
// skill: "Steer: Add /steer to Claude Code" writes the bundled, stranger-safe copy
// (skills/steer/SKILL.md, beside this extension's own code) into the open workspace's own
// .claude/skills/steer/SKILL.md. The install logic itself lives in steer-skill-install.ts with no
// vscode import, so a reader proves the refuse-on-foreign-file rule with node --test, not by
// driving a host. Same pattern as vna-standing-skill.ts (C1010) — never a second one.
//
// LLM-FREE: nothing here calls a model.
import * as vscode from 'vscode';
import * as path from 'path';
import { installSteerSkill, steerSkillState, STEER_SKILL_RELATIVE_PATH, COMPANION_SKILLS, installCompanionSkill } from './steer-skill-install';

export function registerVnaSteerSkill(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('vna.addSteerSkill', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { void vscode.window.showWarningMessage('Steer: UNMEASURED — no workspace folder open'); return; }
        const bundled = path.join(context.extensionPath, 'skills', 'steer', 'SKILL.md');
        const result = await installSteerSkill(root, bundled);
        // the companions (/steer-every) ride with /steer: written beside it, never over a file that is not ours as bundled
        for (const name of COMPANION_SKILLS) {
            const c = await installCompanionSkill(root, context.extensionPath, name).catch((e) => ({ action: 'refused' as const, path: name, reason: String(e) }));
            if (c.action === 'refused') { void vscode.window.showWarningMessage(`Steer: /${name} — ${c.reason}`); }
        }
        if (result.action === 'wrote') { void vscode.window.showInformationMessage(`Steer: wrote ${STEER_SKILL_RELATIVE_PATH} — ask Claude Code "/steer"`); return; }
        if (result.action === 'already-current') { void vscode.window.showInformationMessage(`Steer: ${STEER_SKILL_RELATIVE_PATH} already carries this skill`); return; }
        void vscode.window.showWarningMessage(`Steer: ${result.reason}`);
    }));

    // C1220 (operator 2026-10-22: "How do we guarantee that the skill gets registered in Claude Code when you install the VSX"): installing
    // the vsix runs no npm postinstall, so on activation the extension reads the slot and, when no /steer stands there, offers the one
    // click that writes it — once per workspace. A file already there (ours or not) is never touched; `npx thetacog-mcp doctor
    // --skills-only` reads every agent's slot.
    void (async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root || context.workspaceState.get('vna.steerSkillOffered')) { return; }
        const state = await steerSkillState(root, path.join(context.extensionPath, 'skills', 'steer', 'SKILL.md')).catch(() => null);
        if (state !== 'missing') { return; }
        await context.workspaceState.update('vna.steerSkillOffered', new Date().toISOString());
        const pick = await vscode.window.showInformationMessage(`Steer: Claude Code has no /steer in this repo — write ${STEER_SKILL_RELATIVE_PATH}?`, 'Add /steer', 'Not here');
        if (pick === 'Add /steer') { await vscode.commands.executeCommand('vna.addSteerSkill'); }
    })();
}
