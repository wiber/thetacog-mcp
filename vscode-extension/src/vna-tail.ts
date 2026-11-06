// packages/intentguard-vscode/src/vna-tail.ts — THE TAIL TURN (C24, spec §18.2).
//
// THE TWO IMPERATIVE LEVELS, which is the whole reason this file is shaped the way it is.
// GoalNegSp.txt, the operator: pasting into the chat is "a direct amount to do something"; appending
// to the long text file "has a different meaning" — it is context to be mined for corrections. So an
// append is a SPEC AMENDMENT and never a command, and this module's entire job is to make one
// impossible to MISS while remaining incapable of acting on it.
//
// WHAT IT DOES, and this list is exhaustive by design: spawns the watcher; on exit 10 opens a
// READ-ONLY virtual document titled "SPEC AMENDMENT — … — not a command"; pipes the watcher's JSON
// into amend-ledger.mjs so the bytes are retained (the source txt is untracked — without the ledger
// a rewrite makes the amendment unpurchasable, AXIOM 1 W4).
//
// WHAT IT MUST NEVER DO: parse the tail for instructions, run anything mentioned in it, edit
// SPEC-VNA-COCKPIT.md, tick a checklist item because of it, spawn a model to summarise it, or put it
// on the clipboard unasked. Folding an amendment into the spec is an editorial act with a human
// author; the watcher only makes it impossible to miss.
//
// IT WRITES NOTHING ITSELF (§15.7). The ledger has exactly one writer and it is a script.
//
// THE FILE OPEN IS THE STEER FILE (2026-09-17). The txt is no longer a constant: when a .txt becomes
// the active editor this module spawns steer-file.mjs (the pointer's one writer) and every reader —
// the watcher here with --follow, and the UserPromptSubmit hook steer-hook.mjs on the Claude side —
// follows the same pointer. So a paste into the file open is DETECTED here, RETAINED in the ledger,
// and SURFACED into the next Claude turn without being pasted a second time. The hook leaves a
// surfacing receipt; this module reads it and says "seen by Claude at HH:MM" beside the amendment.
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { doorCommand } from './commands';   // C94b: THE ONE COMMAND TABLE — node <script> at home, npx thetacog-mcp <door> away, or not runnable with the reason

const WATCH = 'scripts/vna/txt-tail-watch.mjs';
const LEDGER = 'scripts/vna/amend-ledger.mjs';
const POINT = 'scripts/vna/steer-file.mjs';
const DEFAULT_TXT = 'docs/05-content/blog/scratchpad/GoalNegSp.txt';
const POINTER = path.join('.thetacog', 'vna-steer-file.json');
const SURFACED = path.join('.thetacog', 'vna-steer-surfaced.ndjson');
const SCHEME = 'vna-amendment';

let timer: NodeJS.Timeout | undefined;
let running = false;

function root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// The virtual document's body lives here, keyed by URI. A read-only provider rather than a real file
// because an amendment is not a document the operator asked to have on disk, and a writable buffer
// would invite editing the amendment instead of folding it into the spec.
const bodies = new Map<string, string>();

type Tail = { status: string; source?: string; bytes: number; offsetFrom: number; offsetTo: number; sha256: string; text: string; reason?: string };

function runWatcher(cwd: string): Promise<{ code: number; json?: Tail; raw: string }> {
    const c = doorCommand(cwd, WATCH, ['--follow', '--json']);
    if (!c.runnable) { return Promise.resolve({ code: 1, raw: c.display }); }
    return new Promise((resolve) => {
        execFile(c.file, c.args, { cwd, timeout: 30000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
            const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number ?? 1) : 0;
            const raw = (stdout || '') + (stderr || '');
            let json: Tail | undefined;
            // Parse the object the script printed; never reconstruct one from the prose. If it is not
            // the shape the emitter prints, report that rather than guessing at a byte count.
            try { json = JSON.parse((stdout || '').trim()); } catch { json = undefined; }
            resolve({ code: typeof code === 'number' ? code : 1, json, raw });
        });
    });
}

// The pointer is READ here and WRITTEN only by steer-file.mjs. Reading a 100-byte JSON is not
// computing; writing it from two places would be two answers to "which file is open".
async function followed(cwd: string): Promise<string> {
    try { return JSON.parse(await fs.readFile(path.join(cwd, POINTER), 'utf8')).source || DEFAULT_TXT; }
    catch { return DEFAULT_TXT; }
}

function isSteerable(doc: vscode.TextDocument | undefined, cwd: string): string | undefined {
    if (!doc || doc.uri.scheme !== 'file' || !doc.fileName.endsWith('.txt')) { return undefined; }
    const rel = path.relative(cwd, doc.fileName);
    return rel.startsWith('..') || path.isAbsolute(rel) ? undefined : rel;
}

let pointed: string | undefined;
export async function pointAt(cwd: string, rel: string): Promise<boolean> {
    if (pointed === rel) { return true; }
    const c = doorCommand(cwd, POINT, ['set', rel]);
    const ok = !c.runnable ? false : await new Promise<boolean>((resolve) => {
        execFile(c.file, c.args, { cwd, timeout: 10000, env: { ...process.env, VNA_STEER_BY: 'ide' } },
            (err) => resolve(!err));
    });
    if (ok) { pointed = rel; vscode.window.setStatusBarMessage(`Steer file → ${path.basename(rel)}`, 2500); }
    return ok;
}

// Point at whatever .txt is active. Called on editor change and by VNA: Steer, so the panel that
// opens beside the file is about that file.
export async function pointAtActive(cwd: string): Promise<string | undefined> {
    const rel = isSteerable(vscode.window.activeTextEditor?.document, cwd);
    if (rel && await pointAt(cwd, rel)) { return rel; }
    return undefined;
}

// "seen by Claude": the last surfacing receipt for this source, if any. The hook writes it; this
// reads it. Absent is "not yet surfaced", which is a different claim from "surfaced and ignored".
// The receipt also carries WHERE the amendment landed on the one walk (pixel · sensor), written by the
// hook from the tape row — read here, never recomputed.
async function lastSeen(cwd: string, source: string): Promise<{ at: string; where?: string } | undefined> {
    try {
        const rows = (await fs.readFile(path.join(cwd, SURFACED), 'utf8')).trim().split('\n');
        for (let i = rows.length - 1; i >= 0; i--) {
            try {
                const r = JSON.parse(rows[i]);
                if (r.source !== source) { continue; }
                const p = r.placed ? (Object.values(r.placed) as Array<{ pixel?: string; sensor?: string; d_last_commit?: number }>).pop() : undefined;
                const where = p ? (p.pixel ? `landed ${p.pixel} (${p.sensor}${p.d_last_commit != null ? `, ${p.d_last_commit} blocks from the last commit` : ''})` : 'unplaced') : undefined;
                return { at: r.at, where };
            } catch { /* skip a torn row */ }
        }
    } catch { /* no receipts yet */ }
    return undefined;
}

function record(cwd: string, tail: Tail): Promise<string> {
    const c = doorCommand(cwd, LEDGER, ['append']);
    if (!c.runnable) { return Promise.resolve(c.display); }
    return new Promise((resolve) => {
        const child = execFile(c.file, c.args, { cwd, timeout: 30000 },
            (err, stdout, stderr) => resolve(err ? `ledger failed: ${(stderr || '').trim()}` : (stdout || '').trim()));
        child.stdin?.end(JSON.stringify(tail));
    });
}

async function check(explicit: boolean) {
    const cwd = root();
    if (!cwd) { if (explicit) { vscode.window.showErrorMessage('Steer tail: no workspace folder open.'); } return; }
    if (running) { return; }
    running = true;
    try {
        const r = await runWatcher(cwd);

        // exit 2 is "I could not look" and is a different claim from "I looked and saw nothing". It
        // is surfaced on an explicit check and stays quiet on a file event, where the file plainly
        // exists or the event would not have fired.
        if (r.code === 2) {
            if (explicit) { vscode.window.showWarningMessage(`Steer tail: could not look — ${r.json?.reason ?? r.raw.trim()}`); }
            return;
        }
        if (r.code === 0) {
            if (explicit) { vscode.window.setStatusBarMessage('Steer tail: no new amendment', 3000); }
            return;
        }
        if (!r.json || !r.json.text) {
            vscode.window.showWarningMessage('Steer tail: the watcher signalled an amendment but printed no object — not shown rather than guessed at.');
            return;
        }

        const t = r.json;
        const src = t.source || await followed(cwd);
        // NO DOCUMENT (operator, 2026-09-17: "why do we need spec amendment txt files? stop that"). The
        // tail button retains the append on the tape and reports on the status bar; the reading of it
        // is the tree's, surfaced into the next Claude turn by steer-hook.mjs, and painted by the page.
        // Opening a "SPEC AMENDMENT" document here was a third copy of the same bytes, in an editor tab.
        const led = await record(cwd, t);
        if (/window\(s\) missed/.test(led)) {
            vscode.window.showWarningMessage(`Steer tail: ${led.split('\n').pop()}`);
        }
        vscode.window.setStatusBarMessage(`Steer: amendment retained (+${t.bytes}B) · not yet seen by Claude — it lands on the next prompt`, 6000);
    } finally { running = false; }
}

export function registerVnaTail(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        provideTextDocumentContent(uri) { return bodies.get(uri.toString()) ?? 'amendment no longer in memory — run Steer: Check the Tail of the Steer File'; },
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vna.checkTail', () => check(true)),
        vscode.commands.registerCommand('vna.openAmendments', async () => {
            const cwd = root(); if (!cwd) { return; }
            // The ledger is a tracked file; it opens as itself. A read-only projection of it here
            // would be a second copy of a record that already has one home.
            const doc = await vscode.workspace.openTextDocument(path.join(cwd, 'docs', 'specs', 'vna', 'amendments.ndjson'));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }),
    );

    context.subscriptions.push(vscode.commands.registerCommand('vna.steerThisFile', async () => {
        const cwd = root(); if (!cwd) { return; }
        const rel = await pointAtActive(cwd);
        if (!rel) { vscode.window.showWarningMessage('Steer: the active editor is not a .txt inside the workspace — open the dictation file first.'); return; }
        await vscode.commands.executeCommand('vna.steer');
    }));

    // Follow the editor: a .txt becoming active points the steer file at it. Not every file — code
    // is not dictation, and a pointer that jumped to every tab would surface source files as
    // amendments.
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        const cwd = root(); if (cwd) { void pointAtActive(cwd); }
    }));
    const cwd0 = root(); if (cwd0) { void pointAtActive(cwd0); }

    // 500 ms trailing debounce: dictation lands in bursts of saves, and one amendment must produce
    // one document rather than one per keystroke the editor happened to flush. The glob is every
    // .txt; the check only reports on the FOLLOWED one, because the watcher reads the pointer.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.txt');
    const fire = async (uri: vscode.Uri) => {
        const cwd = root(); if (!cwd) { return; }
        const rel = path.relative(cwd, uri.fsPath);
        if (rel !== await followed(cwd)) { return; }
        if (timer) { clearTimeout(timer); } timer = setTimeout(() => check(false), 500);
    };
    watcher.onDidChange(fire);
    watcher.onDidCreate(fire);
    context.subscriptions.push(watcher);

    // The surfacing receipt: when the hook has put an amendment into a Claude turn, say so where the
    // operator is looking. This is the third leg — detected here, retained in the ledger, seen there.
    const seen = vscode.workspace.createFileSystemWatcher(`**/${SURFACED}`);
    const onSeen = async () => {
        const cwd = root(); if (!cwd) { return; }
        const src = await followed(cwd);
        const seenAt = await lastSeen(cwd, src);
        if (seenAt) { vscode.window.setStatusBarMessage(`Steer: ${path.basename(src)} amendment seen by Claude at ${seenAt.at.slice(11, 16)}Z${seenAt.where ? ` · ${seenAt.where}` : ''}`, 8000); }
    };
    seen.onDidChange(onSeen); seen.onDidCreate(onSeen);
    context.subscriptions.push(seen);
}
