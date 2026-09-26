// packages/intentguard-vscode/src/vna-cockpit.ts — THE VNA SEMANTIC COCKPIT, in the IDE.
//
// GoalNegSp.txt, the operator: the IDE holds "the map or even the map of maps … the specification
// that's being generated and checked off … you could even have three panels one intent one reality
// and one intent reality Delta … and you could copy the current state of the specification … back
// into the large language model".
//
// So: the panels and the checkbox spec live HERE, in the editor, and one command puts the distilled
// state on the clipboard for the chat on the right. This module OWNS none of the computation — it
// shells out to scripts/vna/cockpit.mjs, which is the running code, and renders what comes back.
// Duplicating any of the pipeline in TypeScript would fork the receipt, and a forked receipt is a
// second answer to a question that is supposed to have exactly one.
//
// LLM-FREE: nothing in this file calls a model. The page it renders is a pure function of a commit.
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { renderEnvelopeHtml, cardText, EnvelopeCycle, EnvelopeView } from './vna-envelope-render';
import { statusBusy, statusError, statusFromReceipt, describeFailure } from './status';
import type { VnaViewProvider } from './vna-view';
import { copyOut } from './vna-view';
import { doorCommand } from './commands';   // C94b: THE ONE COMMAND TABLE — node <script> at home, npx thetacog-mcp <door> away

// THE ONE SURFACE. extension.ts hands the activity-bar view in once; every page this module renders
// — the cockpit, the envelope, the preview — is shown THERE. No createWebviewPanel, no ViewColumn:
// an editor-column webview split the code (operator, 2026-09-17, twice) and C32 already said the
// instrument is a side panel, never a tab. Guard: tests/vna/steer-ui-door.test.mjs.
let surface: VnaViewProvider | undefined;
export function setSurface(v: VnaViewProvider) { surface = v; }
function needSurface(what: string): VnaViewProvider | undefined {
    if (!surface) { vscode.window.showErrorMessage(`Steer ${what}: the ThetaCog surface is not registered.`); }
    return surface;
}

// C94b: the scripts are named here and RESOLVED by the one table (./commands) — node <script> at home, npx thetacog-mcp <door> away
const COCKPIT = 'scripts/vna/cockpit.mjs';
const LATEST = path.join('docs', 'specs', 'vna', 'turns', 'latest.html');
const PAYLOAD = path.join('docs', 'specs', 'vna', 'COCKPIT-PAYLOAD.txt');
const ENVELOPE = 'scripts/vna/envelope.mjs';

let cockpitShown = false;   // for refreshOnSave: never wake a page that is not up

// C77 THE GOAL WRITER (operator 2026-09-18: "a dedicated text area for raw human intent … [ Copy to /goal ] overwrites the goal
// and triggers the headless runner"). MARKUP ONLY. The page posts {type:'goal-write', text} to the surface; the surface runs
// scripts/vna/goal-write.mjs --install --run and paints what it says (a refusal is a refusal — under 12 words, or off every open
// row — never a fabricated goal). Nothing here reads the tree, seeds, or ranks: that would be a second writer beside the script.
async function onCockpitMessage(cwd: string, m: Record<string, unknown>): Promise<void> {
    if (m?.type !== 'goal-write' || typeof m.text !== 'string') { return; }
    const gw = doorCommand(cwd, 'scripts/vna/goal-write.mjs', ['--intent', m.text as string, '--install', '--run', '--json']);
    if (!gw.runnable) { vscode.window.showWarningMessage(`Steer goal writer: ${gw.display}`); return; }
    const r = await new Promise<{ ok: boolean; out: string }>((res) => execFile(gw.file, gw.args,
        { cwd, timeout: 120000, maxBuffer: 1 << 24, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_'))) as NodeJS.ProcessEnv },
        (err, stdout, stderr) => res({ ok: !err, out: (stdout || '') + (stderr || '') })));
    let j: { ok?: boolean; why?: string; units?: { label: string }[]; run?: { dispatched: boolean; pid?: number; why?: string } } = {};
    const lines = r.out.split('\n').filter((l) => l.trim().startsWith('{')); try { j = JSON.parse(lines[lines.length - 1] || '{}'); } catch { /* the raw text is the message; describeFailure says it */ }
    if (!r.ok || !j.ok) { vscode.window.showWarningMessage(`Steer goal writer refused: ${j.why || describeFailure(r.out)}`); return; }
    vscode.window.showInformationMessage(`Steer: /goal installed — ${(j.units || []).map((u) => u.label).join(' ')} · ${j.run?.dispatched ? `runner dispatched (pid ${j.run.pid})` : (j.run?.why || 'not run')}`);
}
function goalWriterBlock(): string {
    return `<div class="gw" style="margin:0 0 14px;padding:10px 12px;border:1px solid #2a3442;border-radius:6px;background:#0e141c">
<div style="font-size:11px;color:#7b8794;margin-bottom:6px"><b style="color:#d8dee9">GOAL WRITER</b> · raw intent → a compiling /goal: units from the tree's open rows (label · coordinate · guard · red witness · amputation) · LLM-free · refuses under 12 words</div>
<textarea id="gw-intent" rows="3" placeholder="what should change, and where — in your own words (12+ words)" style="width:100%;font:inherit;font-size:12px;background:#0a0c10;color:#d8dee9;border:1px solid #2a3442;border-radius:4px;padding:6px;resize:vertical"></textarea>
<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button type="button" style="width:auto;padding:5px 10px;font-size:12px" onclick="(function(){var t=document.getElementById('gw-intent');_vs.postMessage({ type: 'goal-write', text: t ? t.value : '' });})()">📋→🚀 Copy to /goal</button><span id="gw-out" style="font-size:11px;color:#7b8794">writes data/vna/goal.json and starts the runner (or names the one already running)</span></div>
</div>`;
}
let running = false;
let queued = false;

function root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Run the cockpit once. SINGLE-FLIGHT, never a queue of concurrent pipelines: the walk writes
// shared cache files, so two runs racing is the scattered-cache failure this repo has already paid
// for once. A refresh requested mid-run sets a flag and re-runs exactly once at the end.
// C309b: no commit named = cockpit.mjs's own default, the last AUTHORED commit. Passing `--commit HEAD` here walked the
// hook's `chore(commit-page): publish …` (reality 0 bytes) — the buyer's state 5, "did the walk use the commit I meant".
function runCockpit(cwd: string, commit?: string): Promise<{ ok: boolean; out: string }> {
    const c = doorCommand(cwd, COCKPIT, commit ? ['--commit', commit, '--no-open'] : ['--no-open']);
    if (!c.runnable) { return Promise.resolve({ ok: false, out: c.display }); }
    return new Promise((resolve) => {
        execFile(c.file, c.args, { cwd, timeout: 120000, maxBuffer: 1 << 26 },
            (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
    });
}

// Parse the CLI's own summary rather than recomputing anything. If the shape ever changes, this
// degrades to "no counts shown" — it must never invent a number the pipeline did not print.
function parseSummary(out: string): { rings: Record<string, string>; ms?: string; commit?: string } {
    const rings: Record<string, string> = {};
    for (const m of out.matchAll(/^\s{2}(intent|reality|delta)\s+(.*)$/gm)) rings[m[1]] = m[2].trim();
    const head = /commit (\w+) · (\d+)ms/.exec(out);
    return { rings, commit: head?.[1], ms: head?.[2] };
}

// The page's copy buttons are routed through the surface's shim (vna-view.ts bridge): cp(id, btn,
// label) posts {type:'copy'} to the host, where vscode.env.clipboard actually works.

async function show(context: vscode.ExtensionContext, commit?: string) {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer cockpit: no workspace folder open.'); return; }

    if (running) { queued = true; return; }
    running = true;
    statusBusy('cockpit');

    const res = await runCockpit(cwd, commit);
    running = false;

    if (!res.ok) {
        // Say what failed, and say something even when the child said nothing. The first version
        // formatted the last output line, which is the empty string when a process is killed — the
        // operator got "VNA cockpit failed:" with nothing after the colon, which reports that
        // something broke and withholds the one thing that would let him act on it.
        const why = describeFailure(res.out);
        statusError(why);
        vscode.window.showErrorMessage(`Steer cockpit failed: ${why}`);
        return;
    }

    let html: string;
    try { html = await fs.readFile(path.join(cwd, LATEST), 'utf8'); }
    catch { vscode.window.showErrorMessage('Steer cockpit: no rendered page found.'); return; }

    const s = needSurface('cockpit'); if (!s) { return; }
    await s.showHtml(goalWriterBlock() + html, (m) => onCockpitMessage(cwd, m));   // copy is the surface's; goal-write comes back here
    cockpitShown = true;

    // The status bar's idle text is the RECEIPT's, read from disk by the one owner of that item —
    // not a second summary parsed here, which would let the bar and the panel disagree about the
    // same commit.
    await statusFromReceipt(cwd);

    if (queued) { queued = false; await show(context, commit); }
}

async function copyFile(rel: string, label: string) {
    const cwd = root(); if (!cwd) { return; }
    try {
        const t = await fs.readFile(path.join(cwd, rel), 'utf8');
        await copyOut(cwd, t, `ide:copy:${rel}`);
        vscode.window.showInformationMessage(`📋 ${label} copied (${t.length} chars) — paste into the chat on the right.`);
    } catch {
        vscode.window.showWarningMessage(`Steer: ${label} not found. Open the cockpit first to generate it.`);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// THE ATTRACTOR ENVELOPE — a CONTINUOUS surface, not a one-shot report.
//
// Operator, 2026-09-08: "You do whatever it's going to do, and then you check if you can use the
// tesseract as a signal to redirect afterwards back towards what you wanted, and run that operation
// continuously as many times as you can. That's what a cockpit does." So: run the envelope, show
// BOTH arms, let him pick, record the pick, run again. Nothing in this block gates, blocks or
// fails-closed on drift — drift is the input the envelope reads.
//
// It OWNS no computation. `scripts/vna/envelope.mjs --json` is the running emitter; this block
// spawns it, parses the one object it prints, and hands that to the pure renderer. The pick goes
// through the emitter's own `--pick` so the ledger has exactly one writer.
// ═══════════════════════════════════════════════════════════════════════════
let envRunning = false;
let envQueued = false;
let envView: EnvelopeView | undefined;   // the last rendered view — what vna.copyCycleCard copies

function runEnvelope(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
    const c = doorCommand(cwd, ENVELOPE, [...args, '--json']);
    if (!c.runnable) { return Promise.resolve({ ok: false, out: '', err: c.display }); }
    return new Promise((resolve) => {
        execFile(c.file, c.args, { cwd, timeout: 60000, maxBuffer: 1 << 24 },
            (err, stdout, stderr) => resolve({ ok: !err, out: stdout || '', err: stderr || '' }));
    });
}

// Parse the emitter's object; refuse to render anything if it is not the shape the emitter prints.
// A page rendered from a guessed shape would be a number the pipeline did not print.
function parseEnvelope(out: string): EnvelopeCycle | undefined {
    try {
        const j = JSON.parse(out.trim());
        if (!j || !('moveWork' in j) || !('moveDecl' in j) || !Array.isArray(j.abstained) || typeof j.card !== 'string') { return undefined; }
        return j as EnvelopeCycle;
    } catch { return undefined; }
}

// One cycle. SINGLE-FLIGHT like the cockpit: a second request mid-run collapses to exactly one
// re-run at the end. `pickArgs` is non-empty only when a pick is being recorded, in which case the
// emitter records it against the cycle it computes and this then runs ONCE MORE with no pick —
// that second run is the loop closing.
async function cycle(context: vscode.ExtensionContext, pickArgs: string[] = []) {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer envelope: no workspace folder open.'); return; }
    if (envRunning) {
        if (pickArgs.length) { vscode.window.setStatusBarMessage('Steer: a cycle is in flight — pick again when it lands', 3000); }
        else { envQueued = true; }
        return;
    }
    envRunning = true;
    statusBusy('cycle');

    let res = await runEnvelope(cwd, pickArgs);
    let lastPick: EnvelopeView['lastPick'] = envView?.lastPick ?? null;
    if (res.ok && pickArgs.length) {
        const picked = parseEnvelope(res.out);
        if (picked?.pick) { lastPick = { arm: picked.pick.arm, at: picked.pick.at }; }
        // the re-run: the pick is recorded, now read the net again
        res = await runEnvelope(cwd, []);
    }
    envRunning = false;

    const parsed = res.ok ? parseEnvelope(res.out) : undefined;
    if (!parsed) {
        // Say what failed rather than showing a stale card: "I did not look" and "I looked and saw
        // nothing" are different claims.
        const tail = describeFailure(res.err || res.out);
        statusError(describeFailure(res.err || res.out));
        vscode.window.showErrorMessage(`Steer envelope failed: ${tail}`);
        return;
    }

    const prev = envView;
    envView = {
        cycle: parsed,
        cycleCount: (prev?.cycleCount ?? 0) + 1,
        pulls: [...(prev?.pulls ?? []), parsed.pull],
        lastPick,
    };

    const s = needSurface('envelope'); if (!s) { return; }
    await s.showHtml(renderEnvelopeHtml(envView), async (raw) => {
            const m = raw as { type?: string; arm?: string; text?: string };
            if (m?.type === 'cycle') {
                await cycle(context);
            } else if (m?.type === 'pick' && (m.arm === 'work' || m.arm === 'declaration')) {
                // the note is optional; Esc cancels the pick, Enter with an empty box records it bare
                const note = await vscode.window.showInputBox({
                    prompt: `Recording pick: MOVE THE ${m.arm === 'work' ? 'WORK' : 'DECLARATION'} — optional note (Enter records, Esc cancels)`,
                    placeHolder: 'why this arm, in one line',
                });
                if (note === undefined) { return; }
                // HAND BACK THE ID OF THE CYCLE HE ACTUALLY LOOKED AT. The emitter recomputes the
                // cycle inside --pick, and in this repo the state genuinely can move in between:
                // post-commit hooks land `chore(commit-page)` commits unattended, and reading a
                // card plus typing a note is easily long enough for one to land. Passing the shown
                // id makes a pick against a moved-on state record as stale:true instead of passing
                // silently as a real choice. The ledger is the competence signal; a row nobody
                // actually chose is worse there than a missing row.
                const shown = envView?.cycle?.cycleId || '';
                await cycle(context, ['--pick', m.arm, '--note', note, ...(shown ? ['--shown-id', shown] : [])]);
            }
        });

    // The cycle's own numbers live on the cycle panel; the bar keeps ONE claim, the receipt's.
    await statusFromReceipt(cwd);

    if (envQueued) { envQueued = false; await cycle(context); }
}

async function copyCycleCard() {
    if (!envView) { vscode.window.showWarningMessage('Steer: no envelope card yet — run Steer: Cycle first.'); return; }
    const t = cardText(envView);
    await copyOut(root(), t, 'ide:copyCycleCard');
    vscode.window.showInformationMessage(`📋 envelope card copied (${t.length} chars) — paste into the chat on the right.`);
}

// ── THE PREVIEW (C25, §17.4) — a different question, under its own caption ──
// The cockpit answers "where did HEAD land?" over an immutable commit. The preview answers "where
// would this land if committed now?" over the mutable tree. They are never shown under one caption
// and never share a panel: a preview is explicitly not sufficient for the first question, a receipt
// explicitly not sufficient for the second, and one webview showing both would make the difference
// depend on the reader remembering which button they last pressed.
let prevRunning = false;

async function showPreview(context: vscode.ExtensionContext) {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('Steer preview: no workspace folder open.'); return; }
    if (prevRunning) { return; }
    prevRunning = true;
    try {
        const pc = doorCommand(cwd, COCKPIT, ['--reality', 'tree', '--no-open']);
        const res = !pc.runnable ? { ok: false, out: pc.display } : await new Promise<{ ok: boolean; out: string }>((resolve) => {
            execFile(pc.file, pc.args, { cwd, timeout: 120000, maxBuffer: 1 << 26 },
                (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
        });
        if (!res.ok) { vscode.window.showErrorMessage(`Steer preview failed: ${describeFailure(res.out)}`); return; }
        let html: string;
        try { html = await fs.readFile(path.join(cwd, 'docs', 'specs', 'vna', 'turns', 'preview-latest.html'), 'utf8'); }
        catch { vscode.window.showErrorMessage('Steer preview: no preview page was written.'); return; }
        const s = needSurface('preview'); if (!s) { return; }
        await s.showHtml(html);   // its own caption ("PREVIEW · not a receipt") is in the page itself
    } finally { prevRunning = false; }
}

export function registerVnaCockpit(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.openCockpit', () => show(context)),
        vscode.commands.registerCommand('vna.refreshCockpit', () => show(context)),
        vscode.commands.registerCommand('vna.copyPayload', () => copyFile(PAYLOAD, 'cockpit + spec state')),
        // C36 — the round-trip research handshake: regenerate the bundle from receipts, then copy it; the answer comes back
        // through the armed clipboard (C35) and slots into its rows (C52b). Nothing here is typed by hand.
        vscode.commands.registerCommand('vna.copyResearch', async () => {
            const cwd = root(); if (!cwd) { return; }
            const rb = doorCommand(cwd, 'scripts/vna/research-bundle.mjs', ['--json']);
            if (rb.runnable) { await new Promise<void>((res) => execFile(rb.file, rb.args, { cwd }, () => res())); }
            else { vscode.window.showWarningMessage(`Steer research bundle: ${rb.display}`); }
            await copyFile(path.join('docs', 'specs', 'vna', 'RESEARCH-BUNDLE.txt'), 'research bundle — active leaf + drift zones + open invariants + the handshake');
        }),
        vscode.commands.registerCommand('vna.copySpec', () => copyFile(path.join('docs', 'specs', 'vna', 'PAYLOAD.txt'), 'spec state')),
        vscode.commands.registerCommand('vna.preview', () => showPreview(context)),
        vscode.commands.registerCommand('vna.cycle', () => cycle(context)),
        vscode.commands.registerCommand('vna.copyCycleCard', () => copyCycleCard()),
        vscode.commands.registerCommand('vna.openSpec', async () => {
            const cwd = root(); if (!cwd) { return; }
            const doc = await vscode.workspace.openTextDocument(path.join(cwd, 'docs', 'specs', 'vna', 'SPEC-VNA-COCKPIT.md'));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }),
    );

    // AUTO-REFRESH IS OFF BY DEFAULT AND DEBOUNCED WHEN ON. The pipeline is ~200ms warm but it walks
    // the chip and writes shared cache; firing it on every keystroke would make the instrument a
    // load source rather than a read-out. The panel is a per-TURN artifact, not a live linter.
    let timer: NodeJS.Timeout | undefined;
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => {
        if (!vscode.workspace.getConfiguration('vna').get<boolean>('refreshOnSave', false)) { return; }
        if (!cockpitShown) { return; }   // never wake a page that was never shown
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(() => show(context), 1500);
    }));
}
