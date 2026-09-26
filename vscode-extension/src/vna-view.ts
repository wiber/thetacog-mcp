// packages/thetacog-mcp-vscode/src/vna-view.ts — THE SURFACE, in the activity bar.
//
// Operator, GoalNegSp.txt: the IDE side holds "the map or even the map of maps … and the
// specification that's being generated and checked off … and you could copy the current state of the
// specification … back into the large language model". An editor TAB is the wrong shape for that: a
// tab competes with your code for the same space and closes when you are done reading. This is a
// side panel — it sits beside the work, all day, and answers "where am I" without being opened.
//
// IT COMPUTES NOTHING AND SPAWNS NOTHING. It reads three receipts and the spec markdown, renders
// them, and turns every button into `vscode.commands.executeCommand`. The commands do the work; this
// only ever shows what the last run wrote. A second computation here would let the panel and the CLI
// disagree about one commit, and once two surfaces disagree neither is trustworthy.
//
// AND IT REFRESHES BY WATCHING THE RECEIPTS, not by polling and not by re-running. A walk run in a
// terminal updates this panel, because both are reading the same file.
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { doorCommand } from './commands';   // C94b: the fallback view's not-run lines name the command a STRANGER can run — the table decides which
import { PAGE_STATE_SHIM } from './page-state-shim';   // C203 (2): setState merges · scroll and half-typed inputs survive a repaint
import { handleChatInline, cancelChatInline, readChatHistory, clearChatHistory } from './vna-chat-inline';   // C167g: the 💬 pill's inline form — routed here, done there

// AGE IS THE FIRST THING A READER NEEDS AND THE LAST THING A PANEL USUALLY SHOWS. A number with no
// timestamp beside it reads as current, so a panel showing a two-day-old walk beside today's code is
// not stale — it is WRONG, and silently. Every section carries how long ago its receipt was written
// and, for the per-commit ones, whether HEAD has moved since. "3 commits behind" is the honest
// staleness measure for a per-commit receipt; a clock alone cannot say that.
function ago(iso?: string): string {
    if (!iso) { return 'never'; }
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) { return 'unknown'; }
    if (ms < 45_000) { return 'just now'; }
    if (ms < 3_600_000) { return `${Math.round(ms / 60_000)}m ago`; }
    if (ms < 86_400_000) { return `${Math.round(ms / 3_600_000)}h ago`; }
    return `${Math.round(ms / 86_400_000)}d ago`;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

type Panel = { id: string; title: string; png: string | null; rings: number; note: string | null;
    counts: { green: number; amber: number; red: number; offPct?: number; dispersionPct?: number } | null };
type Cockpit = { commit?: string; engine?: string; pipelineMs?: number; agreementPct?: number;
    generatedAt?: string; panels?: Panel[]; delta?: { offPct?: number; red?: number; refused?: boolean; refusal?: string } | null };
// THE NET, read from the same receipt the page reads. The panel's job is to TRANSLATE: a coordinate
// says where mass landed and nothing about what took it there, so the holes arrive with the room
// that was declared, the room the work landed in, both horizons, and the words that carried it.
type Hole = { coord?: string; name?: string; n?: number; nearest?: { id?: string; d?: number } | null };
type Net = { meshSize?: number | null; fence?: number; caught?: number; water?: number; coveragePct?: number | null;
    strands?: number; floor?: number; thin?: Array<{ id: string }>; holes?: Hole[]; slack?: unknown[];
    verdict?: string; horizon?: { sentence?: string } };

type Arm = { coord?: string; name?: string; n?: number; totalUndeclared?: number; repeated?: boolean; commits?: string[] };
type Envelope = { at?: string; pull?: number; fence?: number; limit?: number; floor?: number;
    moveWork?: Arm | null; moveDecl?: Arm | null; abstained?: Array<{ id: string; margin?: number }> };

// THE STEER PAGE LIVES HERE, NOT IN AN EDITOR COLUMN (operator, 2026-09-17: "stop splitting the code
// panel when it opens … it should open as a side panel not a html file side by side with editor
// files"). The loop depends on the .txt being the ACTIVE editor — the pointer follows it, the tail
// watcher follows the pointer — so a steer page that takes an editor column steals the very surface
// it steers. When steer-ui.mjs has written a page it is rendered in this view, byte-for-byte with the
// copy shim appended; when it has not, the receipt summary below renders instead and says so.
const STEER_PAGE = path.join('docs', 'specs', 'vna', 'steer', 'latest.html');

export class VnaViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'thetacog.steer';
    private view?: vscode.WebviewView;
    // A page another command asked this surface to show (the cockpit, the envelope, the preview),
    // with the handler for the messages that page posts. While one is up, the steer-page watcher
    // does not repaint over it; the strip's "← steer" clears it. ONE SURFACE (operator, 2026-09-17:
    // "remove the panel splitting call" — every editor-column webview is gone; C32 said it first).
    private custom?: { html: string; onMessage?: (m: Record<string, unknown>) => Promise<void> | void };
    // C167g: the inline chat form's steer-verb spawn and local-model fetch need context.secrets/.globalState and the
    // extension path (for chat-core.js) — handleChatInline lives in its own file (vna-chat-inline.ts), this class only routes to it
    constructor(private readonly cwd: string | undefined, private readonly context: vscode.ExtensionContext) {}

    // Show a rendered page IN THE SIDEBAR. `html` is the page as a script wrote it; the CSP and the
    // clipboard shim are added here, the same way the steer page gets them. Focusing the view is a
    // command, so a CLI door and a palette command reach the same surface by the same route.
    async showHtml(html: string, onMessage?: (m: Record<string, unknown>) => Promise<void> | void): Promise<void> {
        this.custom = { html, onMessage };
        await vscode.commands.executeCommand('thetacog.steer.focus');
        if (this.view) { this.view.webview.html = bridge(html, this.view.webview.cspSource, backStrip()); }
        // else: resolveWebviewView runs after the focus and paints this.custom itself
    }
    // The steer page again (the watcher's refresh, or the strip's "← steer").
    async showSteer(): Promise<void> { this.custom = undefined; await this.refresh(); }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage(async (m: { cmd?: string; type?: string; text?: string }) => {
            // The page's copy button posts {type:'copy'}; the clipboard is the one thing a webview
            // cannot reach itself. Everything else is a COMMAND: nothing is executed here, so the panel
            // can gain a button without gaining a capability, and the palette and the panel never drift.
            if (m?.type === 'back') { await this.showSteer(); return; }
            if (m?.type === 'copy' && typeof m.text === 'string') {
                await copyOut(this.cwd, m.text, 'ide:page-copy');
                vscode.window.setStatusBarMessage('📋 copied — paste into the chat', 3000);
                return;
            }
            // C167g: the 💬 Local Ideation pill's inline form — no second registered command, so the "is not registered in
            // this window" toast a stale-installed-extension can hit on the branch below cannot recur for this one door;
            // the actual work (spawn a steer.mjs verb, or stream a chat token) lives in its own file, this only routes to it
            if (m?.type === 'chatInline' && typeof m.text === 'string') { await handleChatInline(view.webview, m.text, this.cwd, this.context); return; }
            if (m?.type === 'chatInlineCancel') { cancelChatInline(); return; }   // C167i: ⏹ cancel after the 15s no-reply state
            // C167h — SKEW-SAFE DOORS + PERSISTENCE (operator hit "vna.openChat is not registered" on ⧉ Pop out: "no
            // persistence? does it even execute?"). On the page's own 'ready' (posted once on load), the host answers with
            // exactly what THIS running window actually registered (vscode.commands.getCommands, filtered to vna.*) and its
            // own version, so a stale window dims the buttons it cannot honour instead of toasting when clicked; and with the
            // shared chat transcript (.thetacog/chat/session.ndjson, C167h), so the inline form and the dedicated pop-out
            // view — reloaded, or opened after the other — start from the same history rather than an empty one.
            if (m?.type === 'ready') {
                const commands = (await vscode.commands.getCommands(true)).filter((c) => c.startsWith('vna.'));
                const installed = this.context.extension.packageJSON.version as string;
                let source = installed;
                if (this.cwd) { try { source = JSON.parse(await fs.readFile(path.join(this.cwd, 'packages/thetacog-mcp-vscode/package.json'), 'utf8')).version || installed; } catch { /* away from home, or the repo package.json moved — installed stands in for source too */ } }
                void view.webview.postMessage({ type: 'commandsInfo', commands, installed, source });
                void view.webview.postMessage({ type: 'chatHistory', turns: readChatHistory(this.cwd) });
                return;
            }
            if (m?.type === 'chatClear') { clearChatHistory(this.cwd); return; }   // the dedicated view's 🧹 Clear now empties the shared file too
            // a custom page's own messages (pick an arm, cycle) go to the command that showed it
            if (this.custom?.onMessage && !m?.cmd) { await this.custom.onMessage(m as Record<string, unknown>); return; }
            if (!m?.cmd) { return; }
            try { await (typeof m.text === 'string' ? vscode.commands.executeCommand(m.cmd, m.text) : vscode.commands.executeCommand(m.cmd)); }   // C161: the sidebar's paste box hands its text to the command
            catch (e) {
                // "command not found" here means the window is running an older build of this extension —
                // the button exists, the handler does not. Say that, never nothing.
                vscode.window.showWarningMessage(`ThetaCog: ${m.cmd} is not registered in this window — Developer: Reload Window to pick up the installed build (${String((e as Error)?.message || e).slice(0, 80)})`);
            }
            setTimeout(() => void this.refresh(), 1200);
        });
        void this.refresh();
    }

    // The page the last run produced, or undefined. Read, never re-rendered: reading a page a second
    // time must not cost a chip walk.
    private async steerPage(): Promise<string | undefined> {
        if (!this.cwd) { return undefined; }
        try { return await fs.readFile(path.join(this.cwd, STEER_PAGE), 'utf8'); } catch { return undefined; }
    }

    // The clipboard daemon's switch is the FILE .thetacog/vna-clip.armed (clip-watch.mjs arm|disarm). The
    // button reads that same file, so the label and the daemon cannot disagree; nothing is inferred.
    private async clipArmed(): Promise<boolean | null> {
        if (!this.cwd) { return null; }
        try { await fs.access(path.join(this.cwd, '.thetacog', 'vna-clip.armed')); return true; } catch { return false; }
    }

    private async readJson<T>(rel: string): Promise<T | null> {
        if (!this.cwd) { return null; }
        try { return JSON.parse(await fs.readFile(path.join(this.cwd, rel), 'utf8')) as T; } catch { return null; }
    }

    async refresh(): Promise<void> {
        if (!this.view) { return; }
        // a page a command put here stays until "← steer"; a receipt landing must not yank it away
        if (this.custom) { this.view.webview.html = bridge(this.custom.html, this.view.webview.cspSource, backStrip()); return; }
        const page = await this.steerPage();
        // THE PAGE OWNS ITS STRIP (2026-09-17): steer-ui.mjs paints the buttons and the auto-paste checkbox
        // from the same receipts as the rest of the page, in the same render, so they cannot disagree and a
        // strip change needs no window reload. The host adds nothing above the steer page.
        if (page) { this.view.webview.html = bridge(page, this.view.webview.cspSource); return; }
        const cock = await this.readJson<Cockpit>('data/vna/cockpit.json');
        const env = await this.readJson<Envelope>('data/vna/envelope.json');
        const net = await this.readJson<Net>('data/vna/mesh.json');
        let spec = '', specAt: string | undefined;
        if (this.cwd) {
            const p = path.join(this.cwd, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
            try { spec = await fs.readFile(p, 'utf8'); specAt = (await fs.stat(p)).mtime.toISOString(); } catch { spec = ''; }
        }
        // HOW FAR BEHIND, asked of git rather than inferred from a clock. A receipt written two
        // minutes ago against a commit five commits back is fresher by the clock and staler by the
        // only measure that matters.
        let behind: number | null = null;
        if (this.cwd && cock?.commit) {
            try {
                const out = execFileSync('git', ['rev-list', '--count', `${cock.commit}..HEAD`],
                    { cwd: this.cwd, encoding: 'utf8', timeout: 5000 }).trim();
                behind = Number(out) || 0;
            } catch { behind = null; }
        }
        const cmd = (script: string) => doorCommand(this.cwd, script).display;
        this.view.webview.html = render(cock, env, spec, behind, specAt, net, cmd);
    }
}

// The strip above a page another command showed here: one way back to the steer page.
const backStrip = () => `<div style="position:sticky;top:0;z-index:9;display:flex;gap:6px;padding:6px 8px;background:#0b0e13;border-bottom:1px solid #1a2230;font:11px ui-monospace,monospace">
<button onclick="_vs.postMessage({type:'back'})" style="cursor:pointer">← steer — the map and the spec</button>
</div>`;

// THE STRIP ABOVE THE PAGE — three rows, one per reason you come to this panel (operator 2026-09-17:
// "how do we increase the usability of the labeling of the buttons - and what you go to the left panel
// to do"): SEE where the work landed · DECIDE which arm · FEED the spec. Every button is a COMMAND the
// palette also has; the label is the verb, the tail is what it costs or what it reads. The clipboard
// button is a TOGGLE whose state is the daemon's own switch file, so it can never say "armed" when the
// daemon is not reading the clipboard. Buttons for commands an older build lacks warn on click (above).
const B = (cmd: string, label: string, title: string, style = '') =>
    `<button onclick="_go('${cmd}')" title="${title}" style="cursor:pointer;${style}">${label}</button>`;
const toolbar = (clipArmed: boolean | null = null) => {
    // THE AUTO-PASTE CHECKBOX (operator: "add the auto paste button to the left panel as a auto paste
    // radio or checkbox"). Checked = the daemon's switch file exists. Ticking posts vna.clipArm, unticking
    // vna.clipDisarm; the label reads the state back from the file on the next repaint, never from the box.
    const clip = clipArmed === null
        ? `<label title="no workspace folder; cannot read .thetacog/vna-clip.armed"><input type="checkbox" disabled> auto-paste: unknown</label>`
        : `<label title="${clipArmed ? 'every copy (⌘C) appends to the steer file with a <!-- clip --> marker; untick to stop reading the clipboard' : 'tick: every copy (⌘C) appends to the steer file, no paste; exports and secrets are never appended'}" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:1px 6px;border:1px solid ${clipArmed ? '#2f8f4e' : '#2a3442'};border-radius:3px"><input type="checkbox" ${clipArmed ? 'checked' : ''} onchange="_go(this.checked ? 'vna.clipArm' : 'vna.clipDisarm')" style="margin:0"> ${clipArmed ? '🟢 auto-paste ON → txt' : '⚪ auto-paste off'}</label>`;
    const row = (name: string, inner: string) =>
        `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span style="min-width:52px;color:#7f8ea3;letter-spacing:.06em">${name}</span>${inner}</div>`;
    return `<div style="position:sticky;top:0;z-index:9;display:flex;flex-direction:column;gap:4px;padding:6px 8px;background:#0b0e13;border-bottom:1px solid #1a2230;font:11px ui-monospace,monospace">
${row('SEE', `<button onclick="_vs.postMessage({type:'back'})" title="re-read the page as last rendered — no walk, no run" style="cursor:pointer">⟳ Re-read</button>` + B('vna.steer', '⚡ Walk the chip', 'run every sensor (cockpit ≈2 s), re-render this page') + B('vna.preview', '👁 Preview the tree', 'where would the working tree land if committed now? — not a receipt') + B('vna.openSpec', '📜 Open the spec', 'SPEC-VNA-COCKPIT.md in the editor'))}
${row('DECIDE', B('vna.cycle', '⇄ Both arms — pick one', 'move the work, or move the declaration; the pick is recorded, never inferred') + B('vna.copyPayload', '📋 Export for chat', 'copy cockpit + spec state to the clipboard for Gemini / Claude'))}
${row('FEED', clip + B('vna.steerThisFile', '📄 Follow this .txt', 'point the tail watcher + the Claude hook at the active .txt') + B('vna.checkTail', '⤓ Check the tail', 'turn new appends into amendment rows now') + B('vna.pasteToTree', '🌳 Fold rows → tree', 'arm the clipboard if needed, fold every new row into the Merkle spec tree, re-render'))}
</div>`;
};

// The page's copy button calls document.execCommand('copy'), which is unreliable inside a webview.
// The shim is APPENDED, not prepended: two script blocks each declaring `function cp` resolve to
// whichever ran last, so a shim injected ahead of the page is overwritten by the page's own copy of
// cp() and the button silently does nothing. Appending also leaves the generated file untouched, so
// the same HTML stays correct opened in a normal browser — one artifact, two readers.
// COPY OUT — the one door for putting text on the clipboard (operator, 2026-09-17: the "📋 Export for
// chat" payload came straight back in through the clipboard daemon as 30 KB of new "mass"). The text
// goes out STAMPED on its first line, and its sha goes to .thetacog/vna-clip-outbound.ndjson; the
// daemon refuses either. Nothing else in this extension calls vscode.env.clipboard.writeText.
export async function copyOut(cwd: string | undefined, text: string, by: string): Promise<string> {
    const at = new Date().toISOString();
    const stamped = `<!-- thetacog:export · ${at} · a read-out of the record, not mass — the clipboard daemon never appends this -->\n${text}`;
    if (cwd) {
        try {
            const dir = path.join(cwd, '.thetacog'); mkdirSync(dir, { recursive: true });
            const row = { at, sha256: crypto.createHash('sha256').update(stamped).digest('hex'), bytes: Buffer.byteLength(stamped), by };
            appendFileSync(path.join(dir, 'vna-clip-outbound.ndjson'), JSON.stringify(row) + '\n');
        } catch (e) { console.error('copyOut: outbound ledger not written —', (e as Error).message); }
    }
    await vscode.env.clipboard.writeText(stamped);
    return stamped;
}

export function bridge(html: string, cspSource: string, strip = ''): string {
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">`;
    const shim = `
<script>
// C79a: the page's open-state script acquires the API first (it runs before this shim) and parks it on window.__vs;
// acquireVsCodeApi() throws on a second call, so reuse it here.
const _vs = (typeof window.__vs !== 'undefined' && window.__vs) ? window.__vs : acquireVsCodeApi();
function _go(cmd, text) { _vs.postMessage(text == null ? { cmd } : { cmd, text }); }
function cp(id, btn, label) {
  const el = document.getElementById(id || 'pay');
  _vs.postMessage({ type: 'copy', text: el ? el.value : '', which: id || 'pay' });
  const b = btn || document.querySelector('.card button');
  if (b) { const was = label || b.textContent; b.textContent = '✅ copied'; setTimeout(() => b.textContent = was, 1400); }
}
${PAGE_STATE_SHIM}
</script>`;
    return csp + strip + html + shim;
}

// A receipt that has not been run renders as the command that produces it. Absence and
// measured-nothing are opposite claims and this panel must never make the first look like the second.
const notRun = (cmd: string, label: string) =>
    `<div class="miss">${esc(label)} — not run<br><code>${esc(cmd)}</code></div>`;

// One header shape for every section: what it is, how old it is, and a control that refreshes ONLY
// it. Per-section rather than one global refresh because the sections cost wildly different amounts
// — the chip walk is a real walk, the spec is a file read — and a single button makes the cheap ones
// hostage to the expensive one.
function head(title: string, age: string, cmd?: string, behind?: string): string {
    return `<h3><span>${esc(title)}</span><span class="age">${esc(age)}${behind ? ` · <b class="warn">${esc(behind)}</b>` : ''}${
        cmd ? ` <button class="mini" title="refresh this section" onclick="go('${esc(cmd)}')">⟳</button>` : ''}</span></h3>`;
}

function render(cock: Cockpit | null, env: Envelope | null, specMd: string, behind: number | null, specAt?: string, net?: Net | null, cmd: (script: string) => string = (s) => `node ${s}`): string {
    const items = specMd.split('\n').map((l) => l.trim()).filter((l) => /^-\s*\[[ xX]\]/.test(l));
    const done = items.filter((l) => /^-\s*\[[xX]\]/.test(l));
    const open = items.filter((l) => /^-\s*\[ \]/.test(l))
        .map((l) => /^-\s*\[ \]\s*(\S+)\s+(.*)$/.exec(l))
        .filter(Boolean)
        .map((m) => `<li><b>${esc(m![1])}</b> ${esc(m![2].replace(/`/g, '').slice(0, 110))}</li>`).join('');

    const panels = !cock ? notRun(cmd('scripts/vna/cockpit.mjs'), 'the chip walk')
        : `<div class="panels">${(cock.panels || []).map((p) => `
            <figure>${p.png ? `<img src="${esc(p.png)}" alt="${esc(p.title)}">` : `<div class="norender">${esc(p.note || 'not rendered')}</div>`}
            <figcaption>${esc(p.id)} · ${p.rings} rings</figcaption></figure>`).join('')}</div>
           <div class="k">${esc(cock.engine)} · <b>${esc(cock.commit)}</b> · ${cock.pipelineMs}ms · agreement ${cock.agreementPct}%${
             cock.delta && !cock.delta.refused ? ` · Δ off-lane <b>${cock.delta.offPct}%</b> · red ${cock.delta.red}` : ' · Δ unmeasured'}</div>
           <div class="k dim">Only the Δ panel means drift. The other two mean that corpus is dispersed about its own centre.</div>`;

    const armBlock = (title: string, a: Arm | null | undefined, why: (x: Arm) => string) =>
        `<div class="arm"><h4>${esc(title)}</h4>${a
            ? `<div class="coord">${esc(a.name || a.coord)}</div><div class="k dim">${esc(why(a))}</div>`
            : '<div class="k dim">nothing on this arm — stated, not dropped</div>'}</div>`;
    const arms = !env ? notRun(cmd('scripts/vna/envelope.mjs'), 'both arms')
        : `${armBlock('MOVE THE WORK', env.moveWork, () => 'aim the next commit here')}
           ${armBlock('MOVE THE DECLARATION', env.moveDecl, (a) => `${a.n} commit${a.n === 1 ? '' : 's'} landed here${a.repeated ? ', repeatedly' : ''} of ${a.totalUndeclared} undeclared`)}
           <div class="k">pull <b>${esc(env.pull)}</b> · window ${esc(env.limit)} commits${
             (env.abstained || []).length ? ` · <span class="warn">${(env.abstained || []).length} abstained below the floor ${esc(env.floor)}</span>` : ''}</div>
           ${(env.abstained || []).length ? `<div class="k dim">The placer refused those: a confident wrong placement measured worse than chance. No buttons on them.</div>` : ''}`;

    return `<!doctype html><meta charset="utf-8">
<style>
.verdict{font-size:12.5px;line-height:1.5;margin:2px 0 6px}
.warn{color:var(--vscode-editorWarning-foreground)}
body{font:12.5px/1.55 var(--vscode-font-family);color:var(--vscode-foreground);padding:10px 12px 30px;margin:0}
h3{font-size:10.5px;text-transform:uppercase;letter-spacing:.11em;color:var(--vscode-textLink-foreground);margin:18px 0 7px;padding-bottom:5px;border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.age{font-size:9.5px;letter-spacing:0;text-transform:none;color:var(--vscode-descriptionForeground);white-space:nowrap}
button.mini{width:auto;display:inline-block;padding:1px 5px;margin:0 0 0 4px;background:transparent;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-panel-border);border-radius:3px;font-size:10px;line-height:1.4}
button.mini:hover{color:var(--vscode-foreground)}
h3:first-child{margin-top:0}
h4{font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px;color:var(--vscode-descriptionForeground)}
button{width:100%;text-align:left;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:4px;padding:6px 9px;margin:3px 0;font:inherit;cursor:pointer}
button.alt{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:hover{opacity:.9}
.panels{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
.panels img{width:100%;image-rendering:pixelated;border-radius:3px;display:block}
figure{margin:0}figcaption{font-size:9.5px;color:var(--vscode-descriptionForeground);text-align:center;margin-top:3px}
.norender{font-size:9px;padding:14px 3px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-panel-border);border-radius:3px}
.k{font-size:11.5px;margin-top:7px}
.dim{color:var(--vscode-descriptionForeground)}
.warn{color:var(--vscode-editorWarning-foreground)}
.miss{font-size:11.5px;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-panel-border);border-radius:4px;padding:9px}
.arm{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:7px 9px;margin-bottom:6px}
.coord{font-weight:700;color:var(--vscode-textLink-foreground);font-size:12px}
.bar{height:5px;background:var(--vscode-panel-border);border-radius:3px;overflow:hidden;margin:6px 0}
.bar i{display:block;height:100%;background:var(--vscode-textLink-foreground);width:${items.length ? Math.round((100 * done.length) / items.length) : 0}%}
ul{list-style:none;padding:0;margin:6px 0 0;max-height:190px;overflow:auto}
li{padding:3px 0;border-bottom:1px solid var(--vscode-panel-border);font-size:11.5px}
code{font-size:11px}
</style>

${head('Run', '', undefined)}
<button onclick="go('vna.steer')">▶ Steer — walk the chip, refresh everything</button>
<button class="alt" onclick="go('vna.preview')">◈ Preview the working tree — where would this land?</button>
<button class="alt" onclick="go('vna.cycle')">⇄ Cycle — take an arm</button>

${head('The net · is the mesh fine enough', net ? '' : 'not run', 'vna.run.net')}
${!net ? notRun(cmd('scripts/vna/mesh.mjs'), 'the net') : `
 <div class="verdict">${net.meshSize == null ? 'UNMEASURED — no placed work in the window'
   : (net.meshSize > (net.fence ?? 2)
     ? `<b class="warn">TOO WIDE</b> — the water lands <b>${esc(net.meshSize)}</b> blocks from the nearest strand, fence ${esc(net.fence)} · caught ${esc(net.caught)}/${esc(net.water)} (${esc(net.coveragePct)}%)`
     : `holding — ${esc(net.caught)}/${esc(net.water)} caught inside the fence`)}</div>
 <div class="k dim">${esc(net.horizon?.sentence || '')}</div>
 ${(net.holes || []).length ? `<ul>${(net.holes || []).slice(0, 5).map((h) => `<li><b>${esc(h.name)}</b><br><span class="k dim">${esc(h.n)} commit(s) · nearest strand ${esc(h.nearest?.id || 'none')} at ${esc(h.nearest?.d ?? '—')} blocks</span></li>`).join('')}</ul>` : ''}
 <div class="k dim" style="margin-top:6px">A = long · C = medium · B = short. A hole is where the net is too wide; a thin strand is a declaration the placer refused to stand behind (${esc((net.thin || []).length)} of them).</div>`}

${head('Copy to the chat', '', undefined)}
<button class="alt" onclick="go('vna.copyPayload')">📋 Copy all — cockpit + spec + named drift zones</button>
<button class="alt" onclick="go('vna.copyResearch')" title="C36: the active leaf, the drift zones, the open invariant boundaries, and how to answer so it lands back in the tree">🔁 Research bundle — round trip</button>
<button class="alt" onclick="go('vna.copySpec')">📋 Copy the spec state only</button>
<button class="alt" onclick="go('vna.copyCycleCard')">📋 Copy the last envelope card</button>

${head('The panels · the chip walk', ago(cock?.generatedAt), 'vna.run.cockpit', behind ? `${behind} commit${behind === 1 ? '' : 's'} behind HEAD` : undefined)}
${panels}

${head('Both arms', ago(env?.at), 'vna.run.envelope')}
${arms}

${head(`The spec — ${done.length}/${items.length}`, ago(specAt), 'vna.run.spec')}
<div class="bar"><i></i></div>
<button class="alt" onclick="go('vna.openSpec')">📄 Read the spec</button>
<button class="alt" onclick="go('vna.toggleCheck')">☑ Tick an item — runs its acceptance first</button>
${open ? `<ul>${open}</ul>` : '<div class="k dim">nothing open</div>'}

${head('The dictation', '', 'vna.checkTail')}
<button class="alt" onclick="go('vna.checkTail')">✎ Check the tail — an append is an amendment</button>
<button class="alt" onclick="go('vna.openAmendments')">🗒 The amendments ledger</button>

<div class="k dim" style="margin-top:18px">Nothing here gates. Drift is the input this reads.<br>
Where the work landed is answerable; whether it was good is not.</div>

<script>
const vs = acquireVsCodeApi();
function go(cmd){ vs.postMessage({ cmd }); }
</script>`;
}
