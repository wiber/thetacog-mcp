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
import { ATTEST_DEMO_TERMINAL_NAME, ATTEST_DEMO_TEXT, ATTEST_DEMO_TOOLTIP, attestDemoTerminalLine } from './attest-demo';

let item: vscode.StatusBarItem | undefined;

// C647k — THE STATUS BAR SPEAKS ONLY IN TEMPLATES (operator 2026-10-05, verbatim: "lets make sure we use templates in the vsx right? all
// are vars from runs / sql /rust never just generated"). Every figure the item paints — the commit, off-lane %, red, the walk's
// engine, pipeline ms and agreement, the token meter, the last prompt's coordinate and lane counts, a child's exit code — is a SLOT in
// a fixed template below, and every slot names the receipt field that fills it. The template text carries no figure of its own. An
// absent slot never paints a default ('—', '?', a zero): the clause becomes `UNMEASURED — <the command that writes it>`.
// The templates live HERE, in the surface's own module, because the bar's guards load this one file (transpiled) with a stubbed
// vscode; the steer page's top section has its own module (scripts/vna/steer-header-templates.mjs). Guard:
// tests/vna/c647k-the-vsix-speaks-only-in-templates.test.mjs — it paints the bar over a fixture receipt set, diffs every figure on
// the item against the slots lastFills() reports, and moves each source field to see the figure move with it.
type Slot = { from: string; cmd: string; fmt?: (v: any) => string };
type Template = { text: string; slots: Record<string, Slot> };
const COCKPIT_CMD = 'node scripts/vna/cockpit.mjs';
const METER_CMD = 'node scripts/vna/clear-gauge.mjs';
const LENS_CMD = 'node scripts/vna/steer-hook.mjs';
const kTok = (n: number): string => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const count = (a: unknown): number | null => (Array.isArray(a) ? a.length : null);
export const STATUS_TEMPLATES: Record<string, Template> = {
    commit: { text: '{commit}', slots: { commit: { from: 'data/vna/cockpit.json:commit', cmd: COCKPIT_CMD } } },
    offLane: { text: 'off-lane {offPct}%', slots: { offPct: { from: 'data/vna/cockpit.json:delta.offPct', cmd: COCKPIT_CMD } } },
    engine: { text: '{engine}', slots: { engine: { from: 'data/vna/cockpit.json:engine', cmd: COCKPIT_CMD } } },
    pipeline: { text: '{ms}ms', slots: { ms: { from: 'data/vna/cockpit.json:pipelineMs', cmd: COCKPIT_CMD } } },
    agreement: { text: 'walk agreement {pct}%', slots: { pct: { from: 'data/vna/cockpit.json:agreementPct', cmd: COCKPIT_CMD } } },
    deltaTip: { text: 'Δ off-lane {offPct}% · red {red}', slots: {
        offPct: { from: 'data/vna/cockpit.json:delta.offPct', cmd: COCKPIT_CMD }, red: { from: 'data/vna/cockpit.json:delta.red', cmd: COCKPIT_CMD } } },
    refused: { text: 'Δ refused: {refusal}', slots: { refusal: { from: 'data/vna/cockpit.json:delta.refusal', cmd: COCKPIT_CMD } } },
    meterText: { text: '⛽ {tokens} tok not re-sent', slots: { tokens: { from: '.thetacog/vna-token-meter.json:saved.tokens', cmd: METER_CMD, fmt: kTok } } },
    meterTip: { text: '⛽ **{tokens} input tokens not re-sent** · sessions cleared free: {sessions}', slots: {
        tokens: { from: '.thetacog/vna-token-meter.json:saved.tokens', cmd: METER_CMD, fmt: kTok }, sessions: { from: '.thetacog/vna-token-meter.json:saved.sessions', cmd: METER_CMD } } },
    meterLine: { text: '{line}', slots: { line: { from: '.thetacog/vna-token-meter.json:line', cmd: METER_CMD } } },
    goalsLine: { text: '**{line}**', slots: { line: { from: '.thetacog/vna-token-meter.json:goals.line', cmd: METER_CMD } } },
    goals: { text: '**{closed} goals closed · {tokens} tokens not re-sent**', slots: {
        closed: { from: '.thetacog/vna-token-meter.json:goals.closed', cmd: METER_CMD }, tokens: { from: '.thetacog/vna-token-meter.json:goals.tokens', cmd: METER_CMD, fmt: kTok } } },
    prompt: { text: '{coord} {hat}', slots: {
        coord: { from: '.thetacog/lens-encircled/latest.json:coord', cmd: LENS_CMD }, hat: { from: '.thetacog/lens-encircled/latest.json:hat', cmd: LENS_CMD } } },
    inLane: { text: '{n}', slots: { n: { from: '.thetacog/lens-encircled/latest.json:inLane.length', cmd: LENS_CMD, fmt: (a) => String(count(a)) } } },
    outLane: { text: '{n}', slots: { n: { from: '.thetacog/lens-encircled/latest.json:outOfLane.length', cmd: LENS_CMD, fmt: (a) => String(count(a)) } } },
    promptDomain: { text: 'domain {domain}', slots: { domain: { from: '.thetacog/lens-encircled/latest.json:domain', cmd: LENS_CMD } } },
    promptOff: { text: 'off-lane {offPct}%', slots: { offPct: { from: '.thetacog/lens-encircled/latest.json:offPct', cmd: LENS_CMD } } },
    promptAt: { text: '{at}', slots: { at: { from: '.thetacog/lens-encircled/latest.json:at', cmd: LENS_CMD } } },
    // C663: the landing a person is handed, read from src/landing-address.ts (the one constant the site imports too) and handed in by
    // extension.ts through setLanding(), so this file keeps no import the bar's guards would have to stub. No figure: a link.
    landing: { text: '[see the curve first]({url})', slots: { url: { from: 'packages/thetacog-mcp-vscode/src/landing-address.ts:CURVE_LANDING', cmd: 'setLanding(CURVE_LANDING) in extension.ts' } } },
    exitCode: { text: 'the process exited {code} and printed nothing (killed, or a reload interrupted it)', slots: {
        code: { from: 'the child process exit code (the run that failed)', cmd: 'Steer: Run the Loop' } } },
};
export type Filled = { id: string; text: string; unmeasured: boolean; slots: Array<{ slot: string; from: string; value: string }> };
const absent = (v: unknown): boolean => v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
let FILLS: Filled[] = [];
// The fills behind the item's last paint — the guard's record of which receipt field put which figure on the bar.
export function lastFills(): Filled[] { return FILLS.slice(); }
export function fillStatus(id: string, values: Record<string, unknown>): Filled {
    const t = STATUS_TEMPLATES[id];
    const missing = Object.keys(t.slots).find((k) => absent(values[k]));
    let f: Filled;
    if (missing) { f = { id, text: `UNMEASURED — ${t.slots[missing].cmd}`, unmeasured: true, slots: [] }; }
    else {
        const slots: Filled['slots'] = [];
        const text = t.text.replace(/\{(\w+)\}/g, (_m, k: string) => {
            const sl = t.slots[k]; const value = String(sl.fmt ? sl.fmt(values[k]) : values[k]);
            slots.push({ slot: `${id}.${k}`, from: sl.from, value }); return value;
        });
        f = { id, text, unmeasured: false, slots };
    }
    FILLS.push(f);
    return f;
}
const F = (id: string, values: Record<string, unknown>): string => fillStatus(id, values).text;

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
    if (code != null) { return F('exitCode', { code }); }
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
// C635a — THE BUY DOOR FROM SECOND ZERO. The door used to paint only once the meter had saved.tokens and saved.sessions,
// a file a fresh install never has, so an installer saw no way to buy at all. With no meter the item now says
// "not yet measuring" (never a clean zero) and the tooltip carries the same vna.connect door plus a buy URL tagged
// ref=ext-statusbar, so the server-side page log attributes the visit. A link the reader clicks, never a request
// this host sends: no telemetry, no phone-home (that is the operator's call, not this row's).
export const BUY_URL = 'https://thetadriven.com/pricing?ref=ext-statusbar';
// C663: the landing address is set once, at activation, from landing-address.ts; unset (a guard that loads this file alone), the clause is absent, never a typed URL
let LANDING: string | null = null;
export function setLanding(url: string): void { LANDING = url || null; }
const buyDoor = (): string => `The measurement is free — if it pays for itself, buy licences: [Connect / Buy credits](command:vna.connect) · [pricing](${BUY_URL})${LANDING ? ` · ${F('landing', { url: LANDING })}` : ''}`;
const hasMeter = (m: Meter | null): boolean => !!(m && m.saved && typeof m.saved.tokens === 'number' && m.saved.sessions);
function meterText(m: Meter | null): string {
    if (!m || !m.saved || !hasMeter(m)) { return " · ⛽ not yet measuring"; }
    return ` · ${F('meterText', { tokens: m.saved.tokens })}`;
}
function meterTooltip(m: Meter | null): string {
    if (!m || !m.saved || !hasMeter(m)) { return `\n\n⛽ **Not yet measuring** — the token meter starts on the first session a /clear replaces.\n\n${buyDoor()}`; }
    // C91e: the same figure per GOAL, read off the receipt's goals block — `N goals closed · M tokens not re-sent`; zero closed paints nothing
    const goals = m.goals && typeof m.goals.closed === 'number' && m.goals.closed > 0
        ? `\n\n${m.goals.line ? F('goalsLine', { line: m.goals.line }) : F('goals', { closed: m.goals.closed, tokens: m.goals.tokens })}` : '';
    return `\n\n${F('meterTip', { tokens: m.saved.tokens, sessions: m.saved.sessions })}${m.line ? ` · ${F('meterLine', { line: m.line })}` : ''}${goals}\n\n${buyDoor()}`;
}

type Receipt = { commit?: string; engine?: string; pipelineMs?: number; agreementPct?: number;
    delta?: { offPct?: number; red?: number; refused?: boolean; refusal?: string } | null };

export async function statusFromReceipt(cwd: string | undefined): Promise<void> {
    if (!item) { return; }
    FILLS = [];
    if (!vscode.workspace.getConfiguration('vna').get('showStatusBar', true)) { item.hide(); return; }
    if (!cwd) { item.hide(); return; }
    let r: Receipt | null = null;
    try { r = JSON.parse(await fs.readFile(path.join(cwd, 'data', 'vna', 'cockpit.json'), 'utf8')); }
    catch { r = null; }
    item.backgroundColor = undefined;
    if (!r) {
        // NOT RUN IS NOT ZERO. "I did not look" and "I looked and saw nothing" are different claims,
        // and only one of them is safe to act on.
        const fresh = await readMeter(cwd);
        item.text = '$(circuit-board) Steer — not run' + meterText(fresh);
        const freshTip = new vscode.MarkdownString('No walk receipt in this workspace. Click to run Steer: Run the Loop.' + meterTooltip(fresh));
        freshTip.isTrusted = { enabledCommands: ['vna.connect'] };
        item.tooltip = freshTip;
        item.show();
        return;
    }
    const off = r.delta?.refused ? null : r.delta?.offPct;
    const meter = await readMeter(cwd);
    const commit = F('commit', { commit: r.commit });
    item.text = `$(circuit-board) ${commit} · ${F('offLane', { offPct: off })}${meterText(meter)}`;
    const tip = new vscode.MarkdownString(
        `**Where the last walked commit landed**\n\n` +
        `commit \`${commit}\` · ${F('engine', { engine: r.engine })} · ${F('pipeline', { ms: r.pipelineMs })}\n\n` +
        `${F('agreement', { pct: r.agreementPct })}\n\n` +
        (r.delta?.refused ? `${F('refused', { refusal: r.delta.refusal })}\n\n` : `${F('deltaTip', { offPct: off, red: r.delta?.red })}\n\n`) +
        `Only the Δ panel means drift. Click to re-run Steer: Run the Loop.` + meterTooltip(meter));
    tip.isTrusted = { enabledCommands: ['vna.connect'] };
    item.tooltip = tip;
    item.show();
}

// C348 — ONE status-bar item that opens a terminal running `npx thetacog-mcp attest-demo`, the same ten-second,
// no-install command the OSS README and every outreach point strangers at (scripts/pmu/attest-demo.mjs). It is a
// DEMONSTRATION door, not a receipt reader — it computes nothing and reuses one named terminal rather than
// spawning a fresh one per click, so a reader who clicks twice sees one running process, not two.
// The words and the terminal line live in ./attest-demo (pure, no vscode import) so the guard can call them.
export function initAttestDemo(context: vscode.ExtensionContext): vscode.StatusBarItem {
    const attestItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    attestItem.text = ATTEST_DEMO_TEXT;
    attestItem.tooltip = ATTEST_DEMO_TOOLTIP;
    attestItem.command = 'vna.attestDemo';   // a literal on purpose: wiring.test.mjs reads command ids as quoted literals; the C348 guard checks it equals ATTEST_DEMO_COMMAND_ID
    attestItem.show();
    context.subscriptions.push(attestItem);
    context.subscriptions.push(vscode.commands.registerCommand('vna.attestDemo', () => {
        const existing = vscode.window.terminals.find((t) => t.name === ATTEST_DEMO_TERMINAL_NAME);
        const term = existing ?? vscode.window.createTerminal(ATTEST_DEMO_TERMINAL_NAME);
        term.show();
        term.sendText(attestDemoTerminalLine());
    }));
    // C667b RENDER THIS COMMIT'S PANEL — the button lives where the Rust walk runs (here, never a public browser): one commit at a
    // time through scripts/vna/panel-render-one.mjs (the render slot, the commit-render lane, the alarm; signed retro).
    context.subscriptions.push(vscode.commands.registerCommand('vna.renderPanel', async () => {
        const sha = (await vscode.window.showInputBox({ prompt: 'Commit sha to render the encircled panel for (7–40 hex)', validateInput: (v) => (/^[0-9a-fA-F]{7,40}$/.test(v.trim()) ? null : 'a commit sha, 7–40 hex') }))?.trim().toLowerCase();
        if (!sha) { return; }
        const term = vscode.window.terminals.find((t) => t.name === 'Steer: render panel') ?? vscode.window.createTerminal('Steer: render panel');
        term.show();
        term.sendText(`node scripts/vna/panel-render-one.mjs --sha ${sha}`);
    }));
    return attestItem;
}

// C23 — the status bar carries the LAST PROMPT's pixel · hat · in/out, read off .thetacog/lens-encircled/latest.json.
// UNMEASURED when the walk refused; untouched when there is no receipt (the cockpit text stays).
export async function statusFromPrompt(cwd: string | undefined): Promise<void> {
    if (!item || !cwd) { return; }
    FILLS = [];
    let j: any = null;
    try { j = JSON.parse(await fs.readFile(path.join(cwd, '.thetacog', 'lens-encircled', 'latest.json'), 'utf8')); } catch { return; }
    if (!j.coord || j.unmeasured || j.refused) { item.text = '$(circuit-board) Steer · prompt UNMEASURED'; item.tooltip = 'The last prompt\'s lens walk refused or was unmeasured — see the LAST PROMPT tile.'; item.show(); return; }
    // the hat is a label the lens names (never a figure); a lens that named none paints an empty label, not a default figure
    const p = F('prompt', { coord: j.coord, hat: j.hat ?? ' ' });
    const inL = F('inLane', { n: j.inLane }), outL = F('outLane', { n: j.outOfLane });
    item.text = `$(circuit-board) Steer · ${p} · in ${inL} / out ${outL}`;
    item.tooltip = `Last prompt: ${p} · in ${inL} / out ${outL} · ${F('promptDomain', { domain: j.domain })} · ${F('promptOff', { offPct: j.offPct })} · ${F('promptAt', { at: j.at })}`;
    item.show();
}
