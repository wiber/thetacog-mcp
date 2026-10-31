// packages/thetacog-mcp-vscode/src/vna-version.ts — STEER: HARD REFRESH and the stale-build watch (operator 2026-10-22, verbatim:
// "bumped versions dont always appear on dev reload, why? better way? add a hard refresh to this? check for new version and
// refresh or something?"). A window keeps running the build its extension host loaded; installing a newer .vsix does not swap it.
// Every 60 s this compares the running version with the newest copy of this extension in the editor's own extensions folder.
// A newer one gets ONE notice per version with a "Restart to load" button (workbench.action.restartExtensionHost: the editors and
// terminals stay open). vna.hardRefresh does the same on demand, and repaints the panel when the running build is already newest.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const cmpVer = (a: string, b: string): number => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) { return (x[i] || 0) - (y[i] || 0); } }
    return 0;
};

/** pure: folder names in the extensions dir + this extension's id → the newest installed version, or null */
export function newestInstalled(names: string[], id: string): string | null {
    const prefix = `${id.toLowerCase()}-`;
    const v = names.filter((n) => n.toLowerCase().startsWith(prefix)).map((n) => n.slice(prefix.length)).filter((s) => /^\d+\.\d+\.\d+$/.test(s));
    return v.length ? v.sort(cmpVer).pop()! : null;
}

function check(context: vscode.ExtensionContext): { running: string; newest: string | null } {
    const running = String(context.extension.packageJSON.version);
    let names: string[] = [];
    try { names = fs.readdirSync(path.dirname(context.extensionPath)); } catch { /* unreadable dir: nothing newer is known */ }
    return { running, newest: newestInstalled(names, context.extension.id) };
}

async function restartHost() { await vscode.commands.executeCommand('workbench.action.restartExtensionHost'); }

export function registerVnaVersion(context: vscode.ExtensionContext) {
    const told = new Set<string>();
    const tick = async () => {
        const { running, newest } = check(context);
        if (!newest || cmpVer(newest, running) <= 0 || told.has(newest)) { return; }
        told.add(newest);
        const pick = await vscode.window.showInformationMessage(`Steer ${newest} is installed; this window runs ${running}.`, 'Restart to load');
        if (pick) { await restartHost(); }
    };
    const timer = setInterval(() => { void tick(); }, 60_000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
    void tick();
    context.subscriptions.push(vscode.commands.registerCommand('vna.hardRefresh', async () => {
        const { running, newest } = check(context);
        if (newest && cmpVer(newest, running) > 0) { await restartHost(); return; }
        await vscode.commands.executeCommand('vna.refreshPage');
        vscode.window.setStatusBarMessage(`Steer ${running} is the newest installed — panel repainted`, 4000);
    }));
}
