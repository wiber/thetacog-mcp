// packages/thetacog-mcp-vscode/src/vna-project-sheets.ts — C2170c: 📋 Steer: Write the Project Sheets. One command spawns the project-sheet
// door (scripts/ops/board-project.mjs, `npx thetacog-mcp project-sheet` away from home, resolved by commands.ts doorCommand like every
// other child) and prints its lines to an output channel, offering each sheet link it printed. Computes nothing; the door owns the sheet.
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { doorCommand } from './commands';

function root(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }

export function registerVnaProjectSheets(context: vscode.ExtensionContext) {
    const out = vscode.window.createOutputChannel('Steer · Project Sheets');
    context.subscriptions.push(out, vscode.commands.registerCommand('vna.projectSheets', async () => {
        const cwd = root(); if (!cwd) { return; }
        const cmd = doorCommand(cwd, 'scripts/ops/board-project.mjs', ['--all']);
        out.show(true); out.appendLine(`$ ${cmd.display}`);
        if (!cmd.runnable) { out.appendLine(cmd.display); return; }
        let text = '';
        await new Promise<void>((done) => {
            const p = spawn(cmd.file, cmd.args, { cwd, env: { ...process.env, VNA_REPO: cwd } });
            p.stdout.on('data', (b) => { const s = String(b); text += s; out.append(s); });
            p.stderr.on('data', (b) => out.append(String(b)));
            p.on('close', () => done()); p.on('error', (e) => { out.appendLine(`not run — ${e.message}`); done(); });
        });
        const links = [...text.matchAll(/✓ ([^:]+):[^\n]*?(https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit)/g)];
        if (!links.length) { return; }
        const pick = await vscode.window.showInformationMessage(`Project sheets written: ${links.map((l) => l[1]).join(' · ')}`, ...links.map((l) => `Open ${l[1]}`));
        const hit = links.find((l) => pick === `Open ${l[1]}`);
        if (hit) { await vscode.env.openExternal(vscode.Uri.parse(hit[2])); }
    }));
}
