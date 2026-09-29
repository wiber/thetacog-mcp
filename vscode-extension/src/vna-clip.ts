// packages/thetacog-mcp-vscode/src/vna-clip.ts — arm / disarm the clipboard → steer-file daemon (C35).
//
// Two commands, each of which spawns scripts/vna/clip-watch.mjs with one word. The extension never
// reads the clipboard and never writes the steer file: the daemon is the one reader and the one
// writer, and the flag file it checks is the only state. Same pattern as vna-steer.ts — IT OWNS NO
// COMPUTATION; the script's first output line is shown back verbatim.
//
// LLM-FREE: nothing in this file calls a model.
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { describeFailure } from './status';
import { doorCommand } from './commands';   // C94b: THE ONE COMMAND TABLE — node <script> at home, npx thetacog-mcp <door> away

const SCRIPT = 'scripts/vna/clip-watch.mjs';
const INGEST = 'scripts/vna/clip-ingest.mjs';   // C98e: the one-shot door — the script reads the clipboard, lands it, folds, and reports

function root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function clip(word: 'arm' | 'disarm'): Promise<{ ok: boolean; out: string }> {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer clipboard: no workspace folder open.'); return Promise.resolve({ ok: false, out: '' }); }
    const c = doorCommand(cwd, SCRIPT, [word]);
    if (!c.runnable) { return Promise.resolve({ ok: false, out: c.display }); }
    return new Promise((resolve) => {
        execFile(c.file, c.args, { cwd, timeout: 10000, maxBuffer: 1 << 20 },
            (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
    });
}

async function setArmed(word: 'arm' | 'disarm') {
    const r = await clip(word);
    const line = r.out.trim().split('\n')[0] || (r.ok ? word : describeFailure(r.out));
    if (r.ok) { vscode.window.showInformationMessage(`Steer: ${line}`); }
    else { vscode.window.showWarningMessage(`Steer clipboard: ${line}`); }
}

// ── C98e THE ONE-SHOT DOOR: ⤵ Ingest Clipboard ────────────────────────────────────────────────────────────────────
// One click: clip-ingest.mjs reads the clipboard itself (the extension still reads no clipboard), lands it on the steer file
// under the daemon's clip stamp, records the ledger row, runs the fold INLINE and prints the fold's own return as one JSON
// line — N new · M attached · R RELEASED, each released ask by headline · basin · d. The page repaints and the bridge card
// prints the same line off the receipt row the script wrote. A refusal (secret · our own export · a path · already on the
// file) is the script's own words. The arm/disarm watcher above is untouched.
type Ingest = { ok: boolean; why?: string; line?: string; added?: number; attached?: number; released?: number; releasedAsks?: Array<{ headline: string; basin: string; d: number | null }> };
// C167b: 📋→🌳 Fold to Tree in 💬 Local Ideation hands ONE answer's text here — it goes to the same door on stdin (--stdin), under
// its own --by, so the chat never writes the clipboard and the fold is the only path a chat message takes into the tree.
async function clipIngest(text?: string) {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer clipboard: no workspace folder open.'); return; }
    const given = typeof text === 'string';
    const c = doorCommand(cwd, INGEST, given ? ['--stdin', '--json', '--by', 'ide:chatFold'] : ['--clip', '--json', '--by', 'ide:clipIngest']);
    const r = !c.runnable ? { ok: false, out: c.display } : await new Promise<{ ok: boolean; out: string }>((resolve) => {
        const child = execFile(c.file, c.args, { cwd, timeout: 180000, maxBuffer: 1 << 26 },
            (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
        if (given) { child.stdin?.end(text); }
    });
    let j: Ingest | null = null;
    try { j = JSON.parse(r.out.split('\n').filter((l) => l.trim().startsWith('{')).pop() || ''); } catch { j = null; }
    if (!j) { vscode.window.showWarningMessage(`Steer ingest: the door printed no receipt — ${describeFailure(r.out)}`); return; }
    if (!j.ok) { vscode.window.showWarningMessage(`Steer ingest refused: ${j.why}`); return; }
    const asks = (j.releasedAsks || []).map((a) => `${a.basin} d ${a.d ?? '—'} · ${a.headline}`).join('  |  ');
    vscode.window.showInformationMessage(`Steer ingest: ${j.line}${asks ? ' — RELEASED: ' + asks : ''}`);
    await vscode.commands.executeCommand('vna.refreshPage');
}

// ── C233 🎙️ THE AUDIO BASIN — arm / disarm / open. Same pattern as the clipboard: the extension spawns
// scripts/vna/audio-basin.mjs with one word and shows its first line; it never touches the mic or the txt itself.
const AUDIO = 'scripts/vna/audio-basin.mjs';
async function audio(word: 'arm' | 'disarm' | 'autobuild on' | 'autobuild off') {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer audio: no workspace folder open.'); return; }
    const c = doorCommand(cwd, AUDIO, word.split(' '));
    const r = !c.runnable ? { ok: false, out: c.display } : await new Promise<{ ok: boolean; out: string }>((resolve) => {
        execFile(c.file, c.args, { cwd, timeout: 10000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
    });
    const line = r.out.trim().split('\n')[0] || (r.ok ? word : describeFailure(r.out));
    if (r.ok) { vscode.window.showInformationMessage(`Steer: ${line}`); } else { vscode.window.showWarningMessage(`Steer audio: ${line}`); }
    await vscode.commands.executeCommand('vna.refreshPage');
}
async function audioOpen() {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer audio: no workspace folder open.'); return; }
    const uri = vscode.Uri.joinPath(vscode.Uri.file(cwd), '.thetacog', 'audio', 'stream.txt');
    try { await vscode.workspace.fs.stat(uri); } catch { await vscode.workspace.fs.writeFile(uri, new Uint8Array()); }   // an absent txt opens empty, never an error
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
}

export function registerVnaClip(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.clipArm', () => setArmed('arm')),
        vscode.commands.registerCommand('vna.clipDisarm', () => setArmed('disarm')),
        vscode.commands.registerCommand('vna.audioArm', () => audio('arm')),   // C233
        vscode.commands.registerCommand('vna.audioDisarm', () => audio('disarm')),
        vscode.commands.registerCommand('vna.audioOpen', () => audioOpen()),
        vscode.commands.registerCommand('vna.audioAutobuildOn', () => audio('autobuild on')),   // C233b
        vscode.commands.registerCommand('vna.audioAutobuildOff', () => audio('autobuild off')),
        vscode.commands.registerCommand('vna.clipIngest', (text?: unknown) => clipIngest(typeof text === 'string' ? text : undefined)),   // C98e
    );
}
