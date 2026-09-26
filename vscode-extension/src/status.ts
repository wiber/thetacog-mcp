// packages/thetacog-mcp-vscode/src/status.ts — ONE status item, owned in one place.
//
// There were two. The cockpit module created its own (`$(circuit-board) VNA`) and the host created
// another for the walk receipt, so the bar carried the word VNA twice and, on a failure, a third
// state that contradicted the second: "VNA failed" beside "fa2fda75c · off-lane 1%". Both were
// telling the truth about different moments, which is exactly how a reader learns to ignore a status
// bar. One item, one current claim.
//
// IT READS A RECEIPT AND NEVER COMPUTES A PLACEMENT. The idle text comes from data/vna/cockpit.json;
// when there is none it says so rather than showing a clean-looking zero.
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';

let item: vscode.StatusBarItem | undefined;

export function initStatus(context: vscode.ExtensionContext): vscode.StatusBarItem {
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.command = 'vna.steer';
    context.subscriptions.push(item);
    return item;
}

// C166 — THE RUNNER'S ENGINE, a second claim on its own item, owned HERE so this file stays the one owner of the bar. It says which
// worker the headless runner spawns and what it spends — `[Runner: goose/qwen2.5-coder:3b · Local $0.00]` — text computed by
// scripts/vna/runner-resolver.mjs and handed in by vna-engines.ts; it never restates a placement, so it cannot contradict the item above.
let runnerItem: vscode.StatusBarItem | undefined;
export function setRunnerStatus(context: vscode.ExtensionContext, text: string, tooltip: string, command = 'vna.openEnginesConfig'): void {
    if (!runnerItem) { runnerItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50); context.subscriptions.push(runnerItem); }
    runnerItem.text = text; runnerItem.tooltip = tooltip; runnerItem.command = command; runnerItem.show();
}

export function statusBusy(what: string): void {
    if (!item) { return; }
    item.text = `$(sync~spin) Steer · ${what}`;
    item.tooltip = 'A walk is running. It writes shared cache, so runs are single-flight.';
    item.backgroundColor = undefined;
    item.show();
}

// A FAILURE MUST SAY WHAT FAILED. The first version formatted the child's last output line, which is
// the empty string when the process produced none — and the operator got a notification reading
// "VNA cockpit failed:" with nothing after the colon. An error with no content is worse than no
// error: it reports that something broke and withholds the one thing that would let you act.
export function describeFailure(out: string, code?: number | null): string {
    const line = (out || '').trim().split('\n').filter(Boolean).pop();
    if (line) { return line.slice(0, 300); }
    if (code != null) { return `the process exited ${code} and printed nothing (killed, or a reload interrupted it)`; }
    return 'the process printed nothing at all — it was killed, or the window reloaded mid-run';
}

export function statusError(what: string): void {
    if (!item) { return; }
    item.text = `$(error) Steer — ${what.slice(0, 40)}`;
    item.tooltip = what;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.show();
}

// C82e — THE TOKEN METER on the status bar: the hook writes .thetacog/vna-token-meter.json (clear-gauge.mjs tokenMeter());
// this host READS it and computes nothing — no ratio, no bytes, the figure arrives computed. The door under it is C75's
// Connect / Buy credits: the measurement is free; if it paid for itself, buy licences. Never a dollar (KR40).
type Meter = { saved?: { tokens?: number; sessions?: number }; live?: { state?: string; tokensPerTurn?: number }; goals?: { closed?: number; tokens?: number; line?: string }; line?: string };
async function readMeter(cwd: string): Promise<Meter | null> {
    try { return JSON.parse(await fs.readFile(path.join(cwd, '.thetacog', 'vna-token-meter.json'), 'utf8')); } catch { return null; }
}
const kTok = (n: number): string => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
function meterText(m: Meter | null): string {
    if (!m || !m.saved || typeof m.saved.tokens !== 'number' || !m.saved.sessions) { return ''; }
    return ` · ⛽ ${kTok(m.saved.tokens)} tok not re-sent`;
}
function meterTooltip(m: Meter | null): string {
    if (!m || !m.saved || !m.saved.sessions) { return ''; }
    // C91e: the same figure per GOAL, read off the receipt's goals block — `N goals closed · M tokens not re-sent`; zero closed paints nothing
    const goals = m.goals && typeof m.goals.closed === 'number' && m.goals.closed > 0 ? `\n\n🎯 **${m.goals.line || `${m.goals.closed} goals closed · ${kTok(m.goals.tokens || 0)} tokens not re-sent`}**` : '';
    return `\n\n⛽ **${kTok(m.saved.tokens || 0)} input tokens not re-sent** over ${m.saved.sessions} session${m.saved.sessions === 1 ? '' : 's'} cleared free · ${m.line || ''}${goals}\n\nThe measurement is free — if it paid for itself, buy licences: [Connect / Buy credits](command:vna.connect)`;
}

type Receipt = { commit?: string; engine?: string; pipelineMs?: number; agreementPct?: number;
    delta?: { offPct?: number; red?: number; refused?: boolean; refusal?: string } | null };

export async function statusFromReceipt(cwd: string | undefined): Promise<void> {
    if (!item) { return; }
    if (!vscode.workspace.getConfiguration('vna').get('showStatusBar', true)) { item.hide(); return; }
    if (!cwd) { item.hide(); return; }
    let r: Receipt | null = null;
    try { r = JSON.parse(await fs.readFile(path.join(cwd, 'data', 'vna', 'cockpit.json'), 'utf8')); }
    catch { r = null; }
    item.backgroundColor = undefined;
    if (!r) {
        // NOT RUN IS NOT ZERO. "I did not look" and "I looked and saw nothing" are different claims,
        // and only one of them is safe to act on.
        item.text = '$(circuit-board) Steer — not run';
        item.tooltip = 'No walk receipt in this workspace. Click to run Steer: Run the Loop.';
        item.show();
        return;
    }
    const off = r.delta?.refused ? null : r.delta?.offPct;
    const meter = await readMeter(cwd);
    item.text = `$(circuit-board) ${r.commit ?? '—'} · ${off == null ? 'Δ unmeasured' : `off-lane ${off}%`}${meterText(meter)}`;
    const tip = new vscode.MarkdownString(
        `**Where the last walked commit landed**\n\n` +
        `commit \`${r.commit ?? '—'}\` · ${r.engine ?? 'engine unreported'} · ${r.pipelineMs ?? '—'}ms\n\n` +
        `walk agreement ${r.agreementPct ?? '—'}%\n\n` +
        (r.delta?.refused ? `Δ refused: ${r.delta.refusal ?? 'not rendered'}\n\n` : `Δ off-lane ${off}% · red ${r.delta?.red ?? '—'}\n\n`) +
        `Only the Δ panel means drift. Click to re-run Steer: Run the Loop.` + meterTooltip(meter));
    tip.isTrusted = { enabledCommands: ['vna.connect'] };
    item.tooltip = tip;
    item.show();
}

// C23 — the status bar carries the LAST PROMPT's pixel · hat · in/out, read off .thetacog/lens-encircled/latest.json.
// UNMEASURED when the walk refused; untouched when there is no receipt (the cockpit text stays).
export async function statusFromPrompt(cwd: string | undefined): Promise<void> {
    if (!item || !cwd) { return; }
    let j: any = null;
    try { j = JSON.parse(await fs.readFile(path.join(cwd, '.thetacog', 'lens-encircled', 'latest.json'), 'utf8')); } catch { return; }
    const inL = (j.inLane || []).length, outL = (j.outOfLane || []).length;
    if (!j.coord || j.unmeasured || j.refused) { item.text = '$(circuit-board) Steer · prompt UNMEASURED'; item.tooltip = 'The last prompt\'s lens walk refused or was unmeasured — see the LAST PROMPT tile.'; item.show(); return; }
    item.text = `$(circuit-board) Steer · ${j.coord} ${j.hat || ''} · in ${inL} / out ${outL}`;
    item.tooltip = `Last prompt: ${j.coord} ${j.hat || ''} · domain ${j.domain || '—'} · off-lane ${j.offPct ?? '—'}% · ${j.at || ''}`;
    item.show();
}
