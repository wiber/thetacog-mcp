// packages/thetacog-mcp-vscode/src/vna-standing-skill.ts — C1010 the command half of the bundled
// /standing-answers skill: "Steer: Add /standing-answers to Claude Code" writes the bundled copy
// (skills/standing-answers/SKILL.md, beside this extension's own code) into the open workspace's
// .claude/skills/standing-answers/SKILL.md. The install logic itself lives in
// standing-skill-install.ts with no vscode import, so a reader proves the refuse-on-foreign-file
// rule with node --test, not by driving a host.
//
// LLM-FREE: nothing here calls a model.
import * as vscode from 'vscode';
import * as path from 'path';
import { installStandingSkill, SKILL_RELATIVE_PATH } from './standing-skill-install';

export function registerVnaStandingSkill(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('vna.addStandingAnswersSkill', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { void vscode.window.showWarningMessage('Steer: UNMEASURED — no workspace folder open'); return; }
        const bundled = path.join(context.extensionPath, 'skills', 'standing-answers', 'SKILL.md');
        const result = await installStandingSkill(root, bundled);
        if (result.action === 'wrote') { void vscode.window.showInformationMessage(`Steer: wrote ${SKILL_RELATIVE_PATH} — ask Claude Code "/standing-answers"`); return; }
        if (result.action === 'already-current') { void vscode.window.showInformationMessage(`Steer: ${SKILL_RELATIVE_PATH} already carries this skill`); return; }
        void vscode.window.showWarningMessage(`Steer: ${result.reason}`);
    }));
}
