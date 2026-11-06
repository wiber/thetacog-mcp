// packages/thetacog-mcp-vscode/src/intentguardCommands.ts — C470 THE VSIX CARRIES THE CARD: the two
// IntentGuard commands, wired thin over ./intentguard/nativeAddon.ts. No child process, no model — the
// same napi walk src/lib/intentguard/door.mjs runs on the server, in-process, on the developer's own
// machine. All computation (the card format, the signature) is OWNED by the Rust addon; this file only
// resolves it, reads the selection/editor, and shows what came back.
//
// "IntentGuard: Card for Selection" cards the selection (or the whole active file when nothing is
// selected) as plain TEXT — no committed spec is attached here (that is the server-side `spec` lane,
// out of scope for this command: it needs a resolvable git ref this editor may not have). The card and
// its payload sha256 (the same slice src/lib/intentguard/door.mjs signs over) open beside the editor.
//
// "IntentGuard: Check a Production Card" takes a receipt — pasted from the clipboard, opened from a
// file, or fetched by sha from https://thetadriven.com/api/intentguard?sha=<sha> — and runs `verify()`
// on it OFFLINE (the signature check needs no network once the bytes are in hand). When the developer
// also supplies the original text (their current selection/file), it recomputes `card(text)` locally and
// says whether the payload bytes match — the auditor's whole check, on the auditor's own machine.
//
// LLM-FREE: nothing in this file calls a model. A missing or unloadable addon is reported as UNMEASURED
// and the command stops — never a JS reimplementation of the walk.
import * as vscode from 'vscode';
import { loadNativeAddon, payloadSha256 } from './intentguard/nativeAddon';

const PRODUCTION_CARD_URL = (sha: string) => `https://thetadriven.com/api/intentguard?sha=${sha}`;

function toBuffer(x: unknown): Buffer {
    if (Buffer.isBuffer(x)) return x;
    if (x instanceof Uint8Array) return Buffer.from(x);
    return Buffer.from(String(x), 'utf8');
}

async function cardForSelection(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { void vscode.window.showWarningMessage('IntentGuard: no active editor.'); return; }
    const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    if (!text) { void vscode.window.showWarningMessage('IntentGuard: nothing to card — empty selection and empty file.'); return; }

    const { addon, reason } = loadNativeAddon(context.extensionPath);
    if (!addon || typeof addon.card !== 'function') {
        void vscode.window.showWarningMessage(`IntentGuard: UNMEASURED — ${reason || 'no native addon'}`);
        return;
    }
    let raw: unknown;
    try { raw = await addon.card(text); } catch (e: any) {
        void vscode.window.showErrorMessage(`IntentGuard: the walk refused — ${e && e.message ? e.message : e}`);
        return;
    }
    const card = toBuffer(raw);
    const sha = payloadSha256(card);
    const source = editor.selection.isEmpty ? 'the whole active file' : 'the selection';
    const body = [
        card.toString('utf8').replace(/\n$/, ''),
        '',
        `// sha256 (payload line): ${sha}`,
        `// text only — carded from ${source}; no committed spec was attached (the server's { spec } lane needs a resolvable git ref)`,
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({ content: body, language: 'json' });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

type ReceiptSource = { receipt: Buffer; how: string } | null;

async function pickReceiptSource(): Promise<ReceiptSource> {
    const choice = await vscode.window.showQuickPick(
        [
            { label: '$(clippy) Paste from clipboard', id: 'clipboard' },
            { label: '$(file) Open a receipt file', id: 'file' },
            { label: '$(cloud-download) Fetch by sha from thetadriven.com', id: 'sha' },
        ],
        { title: 'IntentGuard: Check a Production Card — where is the receipt?' },
    );
    if (!choice) return null;
    if (choice.id === 'clipboard') {
        const text = await vscode.env.clipboard.readText();
        if (!text) { void vscode.window.showWarningMessage('IntentGuard: clipboard is empty.'); return null; }
        return { receipt: Buffer.from(text, 'utf8'), how: 'pasted from the clipboard' };
    }
    if (choice.id === 'file') {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, title: 'Open a receipt' });
        if (!picked || !picked[0]) return null;
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        return { receipt: Buffer.from(bytes), how: `read from ${picked[0].fsPath}` };
    }
    const sha = await vscode.window.showInputBox({ title: 'IntentGuard: card sha256', prompt: 'The 64-hex sha the door returned (x-intentguard-card-sha256 / the /api/intentguard?sha= link)', validateInput: (v) => (/^[0-9a-f]{64}$/.test(v.trim()) ? undefined : 'must be 64 lowercase hex characters') });
    if (!sha) return null;
    const url = PRODUCTION_CARD_URL(sha.trim());
    try {
        const res = await fetch(url);
        if (!res.ok) { void vscode.window.showErrorMessage(`IntentGuard: GET ${url} → ${res.status}`); return null; }
        const bytes = Buffer.from(await res.arrayBuffer());
        return { receipt: bytes, how: `fetched from ${url}` };
    } catch (e: any) {
        void vscode.window.showErrorMessage(`IntentGuard: GET ${url} failed — ${e && e.message ? e.message : e}`);
        return null;
    }
}

async function checkProductionCard(context: vscode.ExtensionContext): Promise<void> {
    const { addon, reason } = loadNativeAddon(context.extensionPath);
    if (!addon || typeof addon.verify !== 'function') {
        void vscode.window.showWarningMessage(`IntentGuard: UNMEASURED — ${reason || 'no native addon'}`);
        return;
    }
    const src = await pickReceiptSource();
    if (!src) return;

    let verdict: { ok: boolean; payloadBytes?: number; pubkeyB64?: string; reason?: string };
    try { verdict = addon.verify(src.receipt); } catch (e: any) {
        void vscode.window.showErrorMessage(`IntentGuard: verify() threw — ${e && e.message ? e.message : e}`);
        return;
    }
    const lines = [
        `signature: ${verdict.ok ? 'VALID' : `INVALID — ${verdict.reason || 'unspecified'}`}`,
        verdict.ok ? `signer pubkey (base64): ${verdict.pubkeyB64}` : '',
        verdict.ok ? `payload bytes: ${verdict.payloadBytes}` : '',
        `receipt: ${src.how}`,
    ].filter(Boolean);

    // Recompute is opt-in: only when the auditor hands over the ORIGINAL text does re-running the walk
    // and comparing payload bytes mean anything — a verify() alone never implies the content was right.
    const recompute = await vscode.window.showQuickPick(
        [
            { label: '$(check) Recompute from the active editor (selection, or whole file)', id: 'editor' },
            { label: '$(circle-slash) Skip — signature check only', id: 'skip' },
        ],
        { title: 'IntentGuard: recompute card(text) locally and compare payload bytes?' },
    );
    if (recompute?.id === 'editor') {
        const editor = vscode.window.activeTextEditor;
        const text = editor && (editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection));
        if (!editor || !text) {
            lines.push('recompute: UNMEASURED — no active editor / empty text to recompute from');
        } else if (typeof addon.card !== 'function') {
            lines.push('recompute: UNMEASURED — addon has no card()');
        } else {
            try {
                const recomputed = toBuffer(await addon.card(text));
                const receiptPayload = (() => {
                    const nl = src.receipt.indexOf(0x0a);
                    return nl < 0 ? src.receipt : src.receipt.subarray(0, nl);
                })();
                const matches = Buffer.compare(recomputed, receiptPayload) === 0;
                lines.push(`recompute: payload bytes ${matches ? 'MATCH' : 'DO NOT MATCH'} card(text) over the active editor's text`);
                lines.push(`recomputed sha256: ${payloadSha256(recomputed)}`);
                lines.push(`receipt sha256:    ${payloadSha256(src.receipt)}`);
            } catch (e: any) {
                lines.push(`recompute: UNMEASURED — the walk refused: ${e && e.message ? e.message : e}`);
            }
        }
    }

    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n') + '\n', language: 'plaintext' });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

// C106f.3: every contributed command id keeps the vna. prefix (the bound-doors freeze) — "IntentGuard" stays
// findable by the palette's own text search over the TITLE, which is where C118.3 requires "Steer: " instead.
export function registerIntentGuardCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.intentguardCardForSelection', () => void cardForSelection(context)),
        vscode.commands.registerCommand('vna.intentguardCheckProductionCard', () => void checkProductionCard(context)),
    );
}
