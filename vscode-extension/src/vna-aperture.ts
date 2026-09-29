// vna-aperture.ts — 🔍 VIEW APERTURE RECEIPT: A READ-ONLY NATIVE DOCUMENT (C116, operator 2026-09-20: "a 🔍 View Aperture
// Receipt door that opens a read-only native document (never a file list inside the webview) — the whole tuple READ off the
// receipts cockpit.mjs already writes"). C115 composes the receipt — data/vna/aperture-receipt.json, written by
// scripts/vna/aperture-receipt.mjs off the walk receipt + git at the immutable commit: the spec basins that were INTENT (S_in),
// the files with their blob shas that were REALITY (F_in), the paths the aperture excluded, κ over raw bytes, the Δ rings by
// coordinate, and ω with its recipe. This module OWNS NO COMPUTATION: it serves those bytes through a TextDocumentContentProvider
// on the `steer` scheme — a content provider is read-only by construction, so what an underwriter reads is what is on disk —
// re-read on each open, beside the editor, as json. Absent receipt → the document says not run — <command>, never an empty JSON.
//
// C241 (milestone-goals 2026-09-24, next step 1: "print the recompute command and the tuple hash at the top of the aperture
// receipt document, so a stranger's run has one line to paste"): the document opens as jsonc and its first lines are COMMENTS —
// the recompute command resolved for this workspace (node at home, npx away — C94b), ω, the commit and the aperture version. The
// receipt's own bytes follow, unchanged; a comment is visibly not the receipt, which is why it is not a key spliced into the JSON.
//
// It lives apart from vna-steer.ts on purpose: the steer PAGE never takes an editor column (extension-steer SMOKE: the steer
// module names no ViewColumn); a receipt document is not the page, and opening it beside the code is the point of the door.
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { doorCommand } from './commands';   // C94b: the one command table — the recompute line names the command a stranger can run

export const APERTURE_SCHEME = 'steer';
export const APERTURE_URI = vscode.Uri.parse('steer://aperture/receipt.json');
const APERTURE_REL = path.join('data', 'vna', 'aperture-receipt.json');
export const NOT_RUN = 'not run — node scripts/vna/aperture-receipt.mjs';
const RECOMPUTE_SCRIPT = 'scripts/vna/recompute-receipt.mjs';
// C123g — THE UNTICK IS A DOOR. A REALITY row's checkbox posts vna.apertureToggle(path); the same door
// serves tick and untick (steer-ui.mjs: "the extension decides add-or-remove by current membership"),
// so the ledger is the single source of truth, never a client-side boolean. Every row carries {path, sha,
// at}: sha names the commit the operator was looking at when they unticked it, so the ledger is dated
// against the record it acted on (AXIOM 1 W4), never a bare path with no context to audit later.
const EXCLUDE_REL = path.join('data', 'vna', 'aperture-exclude.json');
export type ApertureExcludeRow = { path: string; sha: string; at: string };

function root(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }

/** the comment lines at the top of the document (C241): the recompute command for this workspace, ω, the commit, the aperture version */
export function recomputeHeader(receipt: { omega?: unknown; commit?: unknown; aperture_version?: unknown; preview?: unknown } | null, cwd: string | undefined): string {
    const cmd = doorCommand(cwd, RECOMPUTE_SCRIPT, ['--receipt', 'data/vna/aperture-receipt.json']).display;
    const s = (v: unknown) => (typeof v === 'string' && v ? v : 'UNMEASURED');
    return [
        `// RECOMPUTE — ${cmd}   (re-derives this receipt from the immutable commit; paste the line it prints into docs/receipts/third-party-recompute.md — docs/receipts/README.md)`,
        receipt ? `// ω ${s(receipt.omega)} · commit ${s(receipt.commit)} · aperture ${s(receipt.aperture_version)}${receipt.preview ? ' · PREVIEW (no immutable commit — the recompute reads UNMEASURED)' : ''}` : '// ω UNMEASURED — no receipt on disk',
    ].join('\n') + '\n';
}

export async function apertureReceiptText(cwd: string | undefined = root()): Promise<string> {
    if (!cwd) { return 'not run — no workspace folder open\n'; }
    try {
        const raw = await fs.readFile(path.join(cwd, APERTURE_REL), 'utf8');
        try { const j = JSON.parse(raw); return recomputeHeader(j, cwd) + JSON.stringify(j, null, 2) + '\n'; }   // pretty when it parses; the bytes when it does not
        catch { return recomputeHeader(null, cwd) + raw; }
    } catch {
        return NOT_RUN + '\n(the aperture receipt is composed off data/vna/cockpit.json after a walk — 🚶 Walk HEAD first, or run the command in a terminal)\n';
    }
}

/** the exclusion ledger, or [] absent/corrupt — never throws, so a first toggle on a fresh clone still lands */
async function readExclude(cwd: string): Promise<ApertureExcludeRow[]> {
    try { const j = JSON.parse(await fs.readFile(path.join(cwd, EXCLUDE_REL), 'utf8')); return Array.isArray(j) ? j : []; }
    catch { return []; }
}

/** C123g — add-or-remove by current membership: a path already on the ledger is a re-tick (removed, on the
 * record just as the exclude was); an absent path is an untick (appended with the commit it was read against).
 * Exported so a test can exercise the toggle without an ExtensionContext or a real workspace. */
export async function toggleApertureExclude(cwd: string, target: string): Promise<ApertureExcludeRow[]> {
    const rows = await readExclude(cwd);
    const idx = rows.findIndex((r) => r && r.path === target);
    if (idx >= 0) { rows.splice(idx, 1); }   // re-ticking removes the row — never silently, the write below is the record
    else {
        let sha = 'UNMEASURED';
        try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(); } catch { /* no git / no commit yet — sha stays UNMEASURED, never faked */ }
        rows.push({ path: target, sha, at: new Date().toISOString() });
    }
    const file = path.join(cwd, EXCLUDE_REL);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(rows, null, 2) + '\n');
    return rows;
}

export function registerVnaAperture(context: vscode.ExtensionContext) {
    const changed = new vscode.EventEmitter<vscode.Uri>();
    context.subscriptions.push(changed);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(APERTURE_SCHEME, {
        onDidChange: changed.event,
        provideTextDocumentContent(uri) {
            return uri.authority === 'aperture' && uri.path === '/receipt.json' ? apertureReceiptText() : `steer: no document at ${uri.toString()}`;
        },
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vna.viewAperture', async () => {
        changed.fire(APERTURE_URI);   // re-read on each open: a fresh walk shows fresh bytes in an already-open tab too
        const doc = await vscode.workspace.openTextDocument(APERTURE_URI);
        await vscode.languages.setTextDocumentLanguage(doc, 'jsonc');   // C241: the recompute header is comment lines; jsonc is json that admits them
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });
    }));
    // C123g: the webview's REALITY-row checkbox posts this with the file's path as the payload (steer-ui.mjs
    // renderApertureRows: onchange="go('vna.apertureToggle', this.dataset.path)"). No page section reads this
    // ledger back yet beyond the receipt (C123g wires the record; a repaint of the tick state rides the next
    // 🔍 View Aperture Receipt / 🚶 walk, same as every other receipt-driven row on the page).
    context.subscriptions.push(vscode.commands.registerCommand('vna.apertureToggle', async (target?: unknown) => {
        const cwd = root();
        if (!cwd || typeof target !== 'string' || !target) { return; }
        await toggleApertureExclude(cwd, target);
        changed.fire(APERTURE_URI);   // an already-open receipt document re-reads with the ledger's new state
    }));
}
