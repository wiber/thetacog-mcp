// src/doctor.ts — 🩺 the doctor button in the Steer sidebar's title bar (operator 2026-10-22: "include a button … in the left side
// bar of the VSX that uses your local LM to run a diagnostic and make sure everything works properly … something to drop into
// Claude Code or Codex or Grok … to wire up the remaining parts").
//
// The button runs the package's own bin/doctor.mjs (the npm door `npx thetacog-mcp doctor`) through the same three places every
// door resolves to: the repo's source at home, the engine the vsix carries away from home, npx when neither is present. The
// doctor's checks are programs with no model in them; a local model (Ollama / LM Studio), when one answers, adds a labelled
// note. The result opens as .thetacog/doctor/handoff.md in an editor tab, ready to paste into any coding agent.
// @guard tests/vna/doctor-door.test.mjs
import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { isHome, bundledEngine, PACKAGE } from './commands';

export const DOCTOR_COMMAND_ID = 'vna.doctor';
export const DOCTOR_HOME_SCRIPT = 'packages/thetacog-mcp/bin/doctor.mjs';
export const HANDOFF_REL = path.join('.thetacog', 'doctor', 'handoff.md');

/** what the button spawns: pure, so the guard can call it without vscode */
export function doctorCommand(root: string | undefined, engine: { server: string; node: string } | null, home: boolean, platform: string = process.platform): { file: string; args: string[] } {
    if (home) { return { file: 'node', args: [DOCTOR_HOME_SCRIPT] }; }
    if (engine) { return { file: engine.node, args: [path.join(path.dirname(engine.server), 'bin', 'doctor.mjs')] }; }
    return { file: platform === 'win32' ? 'npx.cmd' : 'npx', args: [PACKAGE, 'doctor'] };
}

export function initDoctor(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand('vna.doctor', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { vscode.window.showWarningMessage('Doctor: open a folder first — the handoff file is written into the repo you are working in.'); return; }
        const cmd = doctorCommand(root, bundledEngine(), isHome(root));
        const summary = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '🩺 ThetaCog doctor — checking runtime, addon, walk binary, demo, MCP server…' },
            () => new Promise<string>((resolve) => {
                execFile(cmd.file, cmd.args, { cwd: root, timeout: 600000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
                    const out = String(stdout || '').trim();
                    resolve(out || String(stderr || err?.message || 'the doctor printed nothing').trim());
                });
            }));
        const handoff = vscode.Uri.file(path.join(root, HANDOFF_REL));
        try {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(handoff), { preview: false });
        } catch {
            vscode.window.showErrorMessage(`Doctor: no handoff was written. Output: ${summary.slice(0, 400)}`);
            return;
        }
        const last = summary.split('\n').filter(Boolean).pop() || '';
        const failed = /FAILED/.test(last);
        const pick = await (failed ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(
            `Doctor: ${last.replace(/ · handoff.*$/, '')}. The handoff is open — paste it into Claude Code, Codex or Grok to wire the rest.`, 'Show output');
        if (pick === 'Show output') {
            const ch = vscode.window.createOutputChannel('ThetaCog doctor');
            ch.replace(summary); ch.show(true);
        }
    }));
}
