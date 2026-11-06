// packages/thetacog-mcp-vscode/src/vna-rewrite.ts — C2173: ✍️ Steer: Rewrite This File (anti-slop pass). One command spawns the rewrite
// door (scripts/rewrite/suite.mjs, `npx thetacog-mcp rewrite` away from home, resolved by commands.ts doorCommand like every other child)
// on the active file with the cloud tracks, dry-run, and offers the HTML report it wrote. Computes nothing; the door owns the report.
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { doorCommand } from './commands';

function root(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }

export function registerVnaRewrite(context: vscode.ExtensionContext) {
    const out = vscode.window.createOutputChannel('Steer · Rewrite');
    context.subscriptions.push(out, vscode.commands.registerCommand('vna.rewriteThisFile', async () => {
        const cwd = root(); const doc = vscode.window.activeTextEditor?.document;
        if (!cwd || !doc || doc.isUntitled) { vscode.window.showInformationMessage('Rewrite: open the file to check first.'); return; }
        if (doc.isDirty) { await doc.save(); }
        const cmd = doorCommand(cwd, 'scripts/rewrite/suite.mjs', ['--file', doc.uri.fsPath, '--tracks', 'C,D', '--limit', '10']);
        out.show(true); out.appendLine(`$ ${cmd.display}`);
        if (!cmd.runnable) { out.appendLine(cmd.display); return; }
        let text = '';
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Rewrite: reading ${path.basename(doc.uri.fsPath)}…` }, () => new Promise<void>((done) => {
            const p = spawn(cmd.file, cmd.args, { cwd, env: { ...process.env, VNA_REPO: cwd } });
            const take = (b: Buffer) => { const s = String(b); text += s; out.append(s); };
            p.stdout.on('data', take); p.stderr.on('data', take);
            p.on('close', () => done()); p.on('error', (e) => { out.appendLine(`not run — ${e.message}`); done(); });
        }));
        const rel = text.match(/report → (\S+\.html)/)?.[1];
        if (!rel) { return; }
        const report = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
        const pick = await vscode.window.showInformationMessage(`Rewrite report written: ${path.basename(report)}`, 'Open report');
        if (pick) { await vscode.env.openExternal(vscode.Uri.file(report)); }
    }));
}
