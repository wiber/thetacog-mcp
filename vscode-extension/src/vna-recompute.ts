// vna-recompute.ts — 🔁 RECOMPUTE THIS RECEIPT: THE RECOMPUTE DOOR (C241, steered off the C240b milestone→goal map, operator
// 2026-09-24). One command a stranger runs on an aperture receipt someone handed them. The host spawns scripts/vna/recompute-receipt.mjs
// through the door table (node at home, `npx thetacog-mcp recompute-receipt` away — C94b) and OWNS NO COMPUTATION: the door re-derives
// the receipt's tuple from the immutable commit with the code that made the receipt (aperture-receipt.mjs omegaOf, aperture.mjs
// matchAperture on the engine the receipt names, git at the commit) and answers match / MISMATCH / UNMEASURED with both hashes
// and ONE pasteable line — the line docs/receipts/third-party-recompute.md is made of (docs/receipts/README.md).
//
// WHICH RECEIPT: the active editor when it is the 🔍 aperture document (steer://aperture/receipt.json → the workspace's
// data/vna/aperture-receipt.json) or a .json file that parses as a receipt (omega + recipe — a receipt someone handed you, opened in
// the editor); otherwise the workspace's own receipt. The result opens beside the editor as a markdown document whose first line is
// the pasteable line, and a toast carries the verdict with one button that copies the line. A spawn that fails, a door that is not
// runnable here, or output that is not the door's JSON is reported as UNMEASURED with the reason — never a silent nothing and never
// "match". The extension never writes docs/receipts/third-party-recompute.md: that file is a third party's record.
//
// LLM-FREE: nothing here calls a model.
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { doorCommand } from './commands';   // C94b: the one command table — every child this host spawns is resolved there
import { APERTURE_SCHEME } from './vna-aperture';
import { copyOut } from './vna-view';   // C32: every export goes through the one stamped clipboard door

export const RECOMPUTE_SCRIPT = 'scripts/vna/recompute-receipt.mjs';
export const THIRD_PARTY_FILE = 'docs/receipts/third-party-recompute.md';
const RECEIPT_REL = path.join('data', 'vna', 'aperture-receipt.json');

type Result = { verdict: 'match' | 'MISMATCH' | 'UNMEASURED'; reason: string; line: string; expected_omega?: string; recomputed_omega?: string | null; commit?: string | null; legs?: Record<string, unknown> };

/** the receipt the command runs on — the active receipt document, a receipt file in the editor, or the workspace's own */
export function pickReceipt(active: vscode.TextDocument | undefined, root: string | undefined): { file: string; how: string } | null {
    if (active && active.uri.scheme === APERTURE_SCHEME && root) { return { file: path.join(root, RECEIPT_REL), how: 'the 🔍 aperture document' }; }
    if (active && active.uri.scheme === 'file' && active.fileName.endsWith('.json')) {
        try { const j = JSON.parse(active.getText()); if (j && typeof j.omega === 'string' && typeof j.recipe === 'string') { return { file: active.fileName, how: 'the receipt open in the editor' }; } } catch { /* not a receipt */ }
    }
    if (root) { return { file: path.join(root, RECEIPT_REL), how: 'this workspace\'s receipt' }; }
    return null;
}

/** the door's JSON out of its stdout (it prints the JSON, then the line) — null when the output is not the door's */
export function parseDoorOutput(out: string): Result | null {
    const end = out.lastIndexOf('\n}');
    if (end < 0) { return null; }
    try { const j = JSON.parse(out.slice(0, end + 2)); return j && typeof j.verdict === 'string' && typeof j.line === 'string' ? j as Result : null; } catch { return null; }
}

/** the document opened beside the editor: the line first, then what each leg measured, then where the line goes */
export function resultDocument(r: Result, cmd: string): string {
    const legs = r.legs ? Object.entries(r.legs).map(([k, v]) => `- ${k}: ${v == null ? 'not reached' : JSON.stringify(v)}`).join('\n') : '- (no legs — the door did not run)';
    return [r.line, '', `verdict: ${r.verdict}${r.verdict === 'match' ? '' : ` — ${r.reason}`}`, `command: ${cmd}`, '', 'legs (each re-derived from the immutable commit with the code that made the receipt):', legs, '',
        `Paste the first line into ${THIRD_PARTY_FILE} in your own checkout and open a pull request — docs/receipts/README.md has the steps.`,
        'What the line is sufficient for: that the bytes the chip was fed came from that commit under that aperture, re-derived on a machine the author does not control. Not for whether the walk was right (Rice) — no receipt claims that.', ''].join('\n');
}

export function registerVnaRecompute(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('vna.recomputeReceipt', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const picked = pickReceipt(vscode.window.activeTextEditor?.document, root);
        if (!picked) { void vscode.window.showWarningMessage('Steer: UNMEASURED — no workspace folder and no receipt open in the editor; open a receipt .json or a repository'); return; }
        const c = doorCommand(root, RECOMPUTE_SCRIPT, ['--receipt', picked.file, '--json']);
        if (!c.runnable) { void vscode.window.showWarningMessage(`Steer: UNMEASURED — ${c.display}`); return; }
        vscode.window.setStatusBarMessage(`Steer: recomputing ${picked.how} from its commit…`, 15000);
        const r = await new Promise<Result>((res) => {
            execFile(c.file, c.args, { cwd: root, timeout: 120000, maxBuffer: 1 << 24, env: { ...process.env, ...(root ? { VNA_REPO: root } : {}) } }, (err, out, stderr) => {
                const parsed = parseDoorOutput(String(out || ''));
                if (parsed) { res(parsed); return; }   // exit 1 (MISMATCH) and 2 (UNMEASURED) still print the JSON — the verdict is the door's, not the exit code's
                const why = (String(stderr || '') || (err ? err.message : '') || 'the door printed no result').split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 240);
                res({ verdict: 'UNMEASURED', reason: `${c.display} — ${why}`, line: `RECOMPUTE · UNMEASURED — ${why}`, recomputed_omega: null });
            });
        });
        const doc = await vscode.workspace.openTextDocument({ content: resultDocument(r, c.display), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });
        const msg = r.verdict === 'match' ? `Steer: match — recomputed ω equals the receipt's (${(r.recomputed_omega || '').slice(0, 12)}…)` : `Steer: ${r.verdict} — ${r.reason}`;
        const show = r.verdict === 'match' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
        const pick = await show(msg, 'Copy the line');
        if (pick === 'Copy the line') { await copyOut(root, r.line, 'ide:recompute');   // C280/C32: the ONE clipboard door — stamped, so the clipboard daemon never folds it back in
            vscode.window.setStatusBarMessage(`Steer: the RECOMPUTE line is on the clipboard — paste it into ${THIRD_PARTY_FILE}`, 6000); }
    }));
}
