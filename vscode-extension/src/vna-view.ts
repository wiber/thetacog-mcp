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
import { ATTEST_DEMO_COMMAND_ID } from './attest-demo';   // C1012g: the welcome's one check, three minutes, a number about the reader's own build
import { PAGE_STATE_SHIM } from './page-state-shim';
import { WebviewDoor, PAGE_PATCH_SCRIPT, PATCH_FAILED_TYPE, steerFit, type SteerRead } from './webview-patch';   // C647m: a page read mid-write is held, never painted   // C564: one live document — identical page skips, a changed steer page is morphed in place   // C203 (2): setState merges · scroll and half-typed inputs survive a repaint
import { handleChatInline, cancelChatInline, readChatHistory, clearChatHistory } from './vna-chat-inline';   // C167g: the 💬 pill's inline form — routed here, done there
import { renderKnobSweep, type KnobRow, type KnobFloor } from './vna-knob-sweep';   // C709c: the sweep's own graphs, beside the panels — no second computation here
import { QUESTIONS as STANDING_QUESTIONS, READINESS_LINE as STANDING_READINESS_LINE, PLAYBOOK_FILE as STANDING_PLAYBOOK_FILE,
    readiness as standingReadiness, readPlaybook as readStandingPlaybook, savePlaybookAnswer as saveStandingAnswer,
    emptyPlaybook as emptyStandingPlaybook, copyAllText as standingCopyAllText, PAIRS as STANDING_PAIRS, PARTS as STANDING_PARTS, parseCleanedAnswers as parseStandingAnswers,
    READINGS as STANDING_READINGS, stopDue as standingStopDue, STOP_DUE_LINE,
    type Playbook as StandingPlaybook, type Answer as StandingAnswer, type Question } from './standing-answers';   // C930: the bundled UNMEASURED-with-why beside each question   // C937: the holder's own stop date
import { pullStandingAnswers, pushStandingAnswers } from './standing-sync';   // C923: the account copy, pulled on open, pushed after a save
import { bearerEnv } from './auth-manager';
import { LANDING_ORIGIN } from './landing-address';   // C921: the holder's own readiness check, read/written beside the work

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
    // C1009: post the focus message to the steer page; sent twice so a view resolved by the focus command, still painting, catches it.
    public focusFirstStanding(): void {
        const post = () => { void this.view?.webview.postMessage({ type: 'focus-first-standing' }); };
        post(); setTimeout(post, 600); setTimeout(post, 1800);
    }
    // A page another command asked this surface to show (the cockpit, the envelope, the preview),
    // with the handler for the messages that page posts. While one is up, the steer-page watcher
    // does not repaint over it; the strip's "← steer" clears it. ONE SURFACE (operator, 2026-09-17:
    // "remove the panel splitting call" — every editor-column webview is gone; C32 said it first).
    private custom?: { html: string; onMessage?: (m: Record<string, unknown>) => Promise<void> | void };
    // C921: the activity-bar badge tracks the holder's open standing answers — one watcher, created once,
    // disposed with the extension (never a second watcher on a second resolve).
    private standingWatcher?: vscode.FileSystemWatcher;
    // C1009: how many standing answers are open — opening the sidebar while any is open lands on the first empty box
    private openStanding = 0;
    private standingPushTimer?: ReturnType<typeof setTimeout>;
    // C923: the answers sync back down. Pull once when the panel opens (the server face wins only when newer, and the
    // local answers it replaces go onto revisions, never dropped); push 2 s after the last save. No licence on this
    // machine → nothing leaves it, the json file stays the holder's alone. A refused sync is silent: the local file
    // is the record, the account copy is the mirror.
    private async syncStanding(dir: 'pull' | 'push'): Promise<void> {
        if (!this.cwd) { return; }
        const bearer = (await bearerEnv()).NOTARY_BEARER;
        if (!bearer) { return; }
        try {
            if (dir === 'pull') { const r = await pullStandingAnswers(this.cwd, bearer, LANDING_ORIGIN); if (r.status === 'pulled') { await this.updateStandingBadge(); } }
            else { await pushStandingAnswers(this.cwd, bearer, LANDING_ORIGIN); }
        } catch { /* the local file is the record */ }
    }
    // C167g: the inline chat form's steer-verb spawn and local-model fetch need context.secrets/.globalState and the
    // extension path (for chat-core.js) — handleChatInline lives in its own file (vna-chat-inline.ts), this class only routes to it
    constructor(private readonly cwd: string | undefined, private readonly context: vscode.ExtensionContext) {}

    // C1013e: THE SAME SIGNAL THE STEER PAGE ITSELF GATES THE TEN ON — read off the one receipt the
    // chip walk writes (data/vna/cockpit.json), the same file `render()`'s `cold` check below reads and
    // steer-ui.mjs's `hasRun: !!cock` reads. Never a second rule: a cold install (no walk ever run) has
    // ten empty boxes by construction, and that is not an open answer to nag about or auto-focus into.
    private async hasRunOnRecord(): Promise<boolean> {
        return (await this.readJson<Cockpit>('data/vna/cockpit.json')) !== null;
    }
    // THE ALERT (operator, verbatim: "It is the manual for how to use so we need an alert in the
    // sidebar or highlight tastefully so we get the response"). A badge is quiet — a number pinned to
    // the activity-bar icon, no toast, no modal — and it clears itself the moment all ten are answered,
    // never a permanent nag. Recomputed on load, on every save, and off the watcher below.
    private async updateStandingBadge(): Promise<void> {
        if (!this.view) { return; }
        // C1013e: no run on record → nothing of the ten is a "question to answer" yet (the steer page
        // itself paints none of them cold) — never badge it, never auto-focus into it.
        if (!(await this.hasRunOnRecord())) { this.openStanding = 0; this.view.badge = undefined; return; }
        const pb = this.cwd ? await readStandingPlaybook(this.cwd) : emptyStandingPlaybook();
        const r = standingReadiness(pb);
        const open = r.of - r.answered;
        this.openStanding = open;
        // C937: the holder's own stop date (standing answer 10) overrides the open-count badge the moment it is
        // due — even at ten of ten, nothing is cancelled until a keep or a stop is recorded in that same answer.
        const due = standingStopDue(pb);
        if (due.due) { this.view.badge = { value: open > 0 ? open : 1, tooltip: `${STOP_DUE_LINE} (set for ${due.date})` }; }
        else if (open > 0) { this.view.badge = { value: open, tooltip: `${open} of ${r.of} standing answers open — open the sidebar to land on the next empty one` }; }
        else { this.view.badge = undefined; }   // ten of ten and no stop date due: clear it — a badge that never clears is a permanent nag
    }
    // C564: every paint goes through this door, never a bare `webview.html =` — a fresh document per receipt was the flicker
    private readonly door = new WebviewDoor(() => this.view?.webview);

    // Show a rendered page IN THE SIDEBAR. `html` is the page as a script wrote it; the CSP and the
    // clipboard shim are added here, the same way the steer page gets them. Focusing the view is a
    // command, so a CLI door and a palette command reach the same surface by the same route.
    async showHtml(html: string, onMessage?: (m: Record<string, unknown>) => Promise<void> | void): Promise<void> {
        this.custom = { html, onMessage };
        await vscode.commands.executeCommand('thetacog.steer.focus');
        if (this.view) { const csp = this.view.webview.cspSource; this.door.show('custom', html, (h) => bridge(h, csp, backStrip())); }
        // else: resolveWebviewView runs after the focus and paints this.custom itself
    }
    // The steer page again (the watcher's refresh, or the strip's "← steer").
    async showSteer(): Promise<void> { this.custom = undefined; await this.refresh(); }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        // C921: one watcher, created once, for the holder's own playbook — recomputes the badge the
        // moment the file changes, whether that save came from this panel or an edit made elsewhere.
        if (this.cwd && !this.standingWatcher) {
            this.standingWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.cwd), STANDING_PLAYBOOK_FILE));
            const onPlaybookChange = () => { void this.updateStandingBadge(); };
            this.standingWatcher.onDidChange(onPlaybookChange);
            this.standingWatcher.onDidCreate(onPlaybookChange);
            this.standingWatcher.onDidDelete(onPlaybookChange);
            this.context.subscriptions.push(this.standingWatcher);
        }
        void this.updateStandingBadge().then(() => { if (this.openStanding > 0 && !this.custom) { this.focusFirstStanding(); } });
        void this.syncStanding('pull');
        // C1009: the badge is the door — every time the sidebar comes into view with an answer still open, the cursor lands
        // in the first empty box (operator 2026-10-18, pointing at the badge: "here for example").
        view.onDidChangeVisibility(() => { if (view.visible && this.openStanding > 0 && !this.custom) { this.focusFirstStanding(); } });
        view.webview.onDidReceiveMessage(async (m: { cmd?: string; type?: string; text?: string; id?: string; patch?: Partial<StandingAnswer> }) => {
            // C921: the pill's auto-save and the "copy prompt for your AI" button. The playbook write
            // lives in standing-answers.ts (one source for the read/write, same as the questions
            // themselves); this only routes the message and recomputes the badge after.
            // C929: the one external page this section opens — the lifecycle checklist on the site. A fixed address, never a URL
            // the page posts, so the panel gains a link without gaining a way to open anything.
            // C921d: one copy, the whole playbook as saved on disk, the same block the web copies (copyAllText, guard-held equal)
            if (m?.type === 'standingCopyAll') { const pb = this.cwd ? await readStandingPlaybook(this.cwd) : emptyStandingPlaybook(); await copyOut(this.cwd, standingCopyAllText(pb), 'ide:standing-copy-all'); vscode.window.setStatusBarMessage('📋 all ten + your answers copied', 3000); return; }
            // C921j: the paste-back — Claude's ten numbered lines from the clipboard into the boxes, through the same save as Enter
            if (m?.type === 'standingPasteBack') {
                if (!this.cwd) { return; }
                const got = parseStandingAnswers(await vscode.env.clipboard.readText());
                const ids = Object.keys(got);
                if (!ids.length) { vscode.window.setStatusBarMessage('📥 nothing to paste — the clipboard holds no lines numbered 1. to 10.', 4000); return; }
                for (const id of ids) { await saveStandingAnswer(this.cwd, id, { text: got[id], drafted_by_model: true }); }
                await this.updateStandingBadge(); this.door.invalidate(); await this.refresh();
                vscode.window.setStatusBarMessage(`📥 ${ids.length} answer${ids.length === 1 ? '' : 's'} pasted into the boxes`, 4000); return;
            }
            // C921q: the demand door — checkout tagged from=standing-answers, so a click is counted where the order lands
            // C939b: the trial door — checkout with the trial's floor filled in, counted as src=standing-trial
            if (m?.type === 'standingTrial') { const u = Number((m as { units?: unknown }).units); const units = Number.isInteger(u) && u >= 1 && u <= 100000 ? u : 1; await vscode.env.openExternal(vscode.Uri.parse(`${LANDING_ORIGIN}/notarise?btn=fund&src=standing-trial&units=${units}`)); return; }
            if (m?.type === 'standingBuy') { await vscode.env.openExternal(vscode.Uri.parse(`${LANDING_ORIGIN}/notarise?btn=fund&src=standing-answers`)); return; }
            if (m?.type === 'standingWeb') { await vscode.env.openExternal(vscode.Uri.parse(`${LANDING_ORIGIN}/backup/warranty#standing`)); return; }   // C921c: ↗ on the 📝 sub-pill, a fixed address
            if (m?.type === 'standingLifecycle') { await vscode.env.openExternal(vscode.Uri.parse(`${LANDING_ORIGIN}/backup/lifecycle`)); return; }
            if (m?.type === 'standingSave' && typeof m.id === 'string') {
                if (this.cwd) {
                    await saveStandingAnswer(this.cwd, m.id, m.patch || {}); await this.updateStandingBadge();
                    if (this.standingPushTimer) { clearTimeout(this.standingPushTimer); }
                    this.standingPushTimer = setTimeout(() => { void this.syncStanding('push'); }, 2000);
                }
                return;
            }
            // The page's copy button posts {type:'copy'}; the clipboard is the one thing a webview
            // cannot reach itself. Everything else is a COMMAND: nothing is executed here, so the panel
            // can gain a button without gaining a capability, and the palette and the panel never drift.
            if (m?.type === 'back') { await this.showSteer(); return; }
            // C564: the page could not morph the posted page (no .wrap on one side) — the next paint is a fresh document
            if (m?.type === PATCH_FAILED_TYPE) { this.door.invalidate(); await this.refresh(); return; }
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
                const beta = vscode.workspace.getConfiguration('thetacog').get<boolean>('betaSurfaces', false);   // ticks the β checkbox (2026-10-15)
                void view.webview.postMessage({ type: 'commandsInfo', commands, installed, source, beta });
                void view.webview.postMessage({ type: 'chatHistory', turns: readChatHistory(this.cwd) });
                return;
            }
            if (m?.type === 'chatClear') { clearChatHistory(this.cwd); return; }   // the dedicated view's 🧹 Clear now empties the shared file too
            // a custom page's own messages (pick an arm, cycle) go to the command that showed it
            if (this.custom?.onMessage && !m?.cmd) { await this.custom.onMessage(m as Record<string, unknown>); return; }
            if (!m?.cmd) { return; }
            // 0.3.60: the page may only run this extension's own commands. Every button it paints is a vna.* id (Reload Window goes
            // through vna.reloadWindow), so a command id outside vna.* is not ours to run: a page rendered from repo-controlled text
            // must never reach an arbitrary registered command. Guard: tests/vna/c422-extension-hardening.test.mjs.
            if (typeof m.cmd !== 'string' || !m.cmd.startsWith('vna.')) { return; }
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
    // time must not cost a chip walk. C647m: the read carries the file's size SETTLED across it (stat before and after agree),
    // -1 when the writer moved the file under the read — paintSteer() holds such a read instead of painting a torn page.
    private async steerPage(): Promise<SteerRead> {
        if (!this.cwd) { return undefined; }
        const p = path.join(this.cwd, STEER_PAGE);
        try {
            const a = await fs.stat(p); const page = await fs.readFile(p, 'utf8'); const b = await fs.stat(p);
            return { page, size: a.size === b.size && a.mtimeMs === b.mtimeMs ? b.size : -1 };
        } catch { return undefined; }
    }
    private paintSeq = 0;   // C647m: a refresh whose read finished after a later refresh began paints nothing — never an older page over a newer

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
    // C709c: the sweep's ledger — one row per cell, newline-delimited. Read as-is; a row this parser
    // cannot JSON.parse is dropped (a half-written append mid-write), never papered over as a zero.
    private async readNdjson<T>(rel: string): Promise<T[]> {
        if (!this.cwd) { return []; }
        try {
            const text = await fs.readFile(path.join(this.cwd, rel), 'utf8');
            return text.split('\n').map((l) => l.trim()).filter(Boolean)
                .map((l) => { try { return JSON.parse(l) as T; } catch { return null; } }).filter((r): r is T => r !== null);
        } catch { return []; }
    }

    async refresh(): Promise<void> {
        if (!this.view) { return; }
        // a page a command put here stays until "← steer"; a receipt landing must not yank it away
        const csp = this.view.webview.cspSource;
        if (this.custom) { this.door.show('custom', this.custom.html, (h) => bridge(h, csp, backStrip())); return; }
        const seq = ++this.paintSeq;
        const read = await this.steerPage();
        if (seq !== this.paintSeq || !this.view) { return; }
        // THE PAGE OWNS ITS STRIP (2026-09-17): steer-ui.mjs paints the buttons and the auto-paste checkbox
        // from the same receipts as the rest of the page, in the same render, so they cannot disagree and a
        // strip change needs no window reload. The host adds nothing above the steer page.
        // C647m: whole page → the door; a read mid-write while the steer page is live → held (the next change event brings it whole)
        const fit = steerFit(this.door, read);   // the same decision paintSteer() makes, spelled out so the door call stays visible here
        if (fit === 'hold') { return; }
        if (fit === 'paint') {
            const pb: StandingPlaybook = this.cwd ? await readStandingPlaybook(this.cwd) : emptyStandingPlaybook();
            this.door.show('steer', read!.page, (h) => bridge(h, csp, /data-rendered="page"/.test(h) ? '' : standingSection(pb)));   // C921o: a page that renders the ten itself gets no injected copy   // C921b: the ten ride on the steer page too
            return;
        }
        const cock = await this.readJson<Cockpit>('data/vna/cockpit.json');
        const env = await this.readJson<Envelope>('data/vna/envelope.json');
        const net = await this.readJson<Net>('data/vna/mesh.json');
        // C709c: the ONLY two sources for the sweep graphs — the ledger C709b appends and the floor it
        // holds. No third source, and nothing here recomputes admissible/null/z; renderKnobSweep only lays out what these name.
        const knobRows = await this.readNdjson<KnobRow>('.thetacog/walk-knob-sweep.ndjson');
        const knobFloor = await this.readJson<KnobFloor>('data/vna/walk-knob-floor.json');
        // C921: the holder's own ten — read beside everything else this panel reads, never computed here
        const standingPb: StandingPlaybook = this.cwd ? await readStandingPlaybook(this.cwd) : emptyStandingPlaybook();
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
        this.door.show('fallback', render(cock, env, spec, behind, specAt, net, cmd, knobRows, knobFloor, standingPb, (this.context.extension.packageJSON.version as string) || null), (h) => h);
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
${PAGE_PATCH_SCRIPT}
</script>`;
    return csp + strip + html + shim;
}

// A receipt that has not been run renders as the command that produces it. Absence and
// measured-nothing are opposite claims and this panel must never make the first look like the second.
const notRun = (cmd: string, label: string) =>
    `<div class="miss">${esc(label)} — not run<br><code>${esc(cmd)}</code></div>`;

// C1012g — THE SIDEBAR'S FIRST PAINT WELCOMES A COLD INSTALL. With no receipt on record this panel's
// only words were operator jargon ("the net — not run", "the chip walk — not run") — the exact sidebar
// a stranger meets first (ladder R7: docs/strategy/2026-10-18-the-ladder-to-buy.txt, "Today: the
// sidebar's first paint is operator jargon … with no welcome"). These four lines are the ladder's R1
// (what it does), R2 (where it runs), R3 (one check in their hands) and R6 (the price), in that order,
// shown ONLY while nothing has run — the operator sections below still own every receipt after.
// STEER_LEAD and WHERE_IT_RUNS mirror scripts/vna/public-surface-register.mjs byte-for-byte; this
// package's tsconfig rootDir is "src" and cannot import across ../../../scripts, so a guard checks the
// two copies stay equal rather than sharing an import.
const WELCOME_STEER_LEAD = 'Use /steer in Claude Code to cap recursive agent loops, slash API token burn, and keep autonomous coding on your plan.';
const WELCOME_WHERE_IT_RUNS = 'Runs in VS Code or Cursor on your own computer, beside Claude Code. App in Replit, Lovable or Bolt? Push it to GitHub first, or book an hour and we set it up with you.';
// WELCOME_PRICE is priceOnListing() as the README renders it (src/lib/auth/notary-seat-checkout.mjs, the money read off
// data/vna/notary-price.json): the extension runs in the buyer's workspace, where that receipt does not exist, so it
// carries the rendered line and a guard turns red the day the price moves (C1012g.price).
const WELCOME_PRICE = 'The install and the measurement are free and open-source (MIT); only the financialization/attestation layer is licensed. $20 = one agent-year.';
// The two ways to use the claim an agent-year carries (agent-years.json A7–A12), byte-identical with SIDEBAR_TWO_WAYS in
// src/lib/licence-buys.mjs — the buy page and the sidebar say it once, the same way (operator 2026-10-21: "It should also be tied into
// the sidebar"). Guard: tests/vna/c698-what-the-licence-is-for-at.test.mjs.
const WELCOME_TWO_WAYS = 'Every agent-year carries a claim you choose how to use. Leave it uncalled to prove you never need it, or go for the miracle and call it when our receipt was wrong. It pays only on our miss, in agent-years and hands-on help, never cash.';
// C1448 — how a holder calls in a claim, byte-identical with SIDEBAR_CALL_IN in src/lib/licence-buys.mjs (one sentence, two copies,
// one guard: tests/vna/c1448-call-in-a-claim.test.mjs). No phone number here: the direct line renders only for holders on the site.
const WELCOME_CALL_IN = 'Set it up first: doctor check passed, spec declared before the run, cover converted, first receipt read. Then a claim, when our receipt was wrong, draws down your cover for hands-on help from Elias, up to 4 hours a claim. How: thetadriven.com/warranty. Never cash.';
// C1065 — THE FALLBACK PAGE NAMES ITS BUILD. With no /steer page on record the sidebar paints render() below, and
// only the steer page (steer-ui.mjs topFacts) carried "ext <version>" — so a cold install showed the ten questions and
// no version at all (redacted name's call, 2026-10-20: "it didn't have the version name at the top"). The version is the
// RUNNING extension's own packageJSON, the one fact a "did Reload pick up the new build?" question needs.
const buildLine = (ext: string | null): string => `<div class="k dim" title="the build this window is running — after installing a new vsix, Developer: Reload Window and this number changes">ThetaCog · ext ${esc(ext || 'build not reported')}</div>`;
const welcome = (): string => `<div class="welcome">
<p>${esc(WELCOME_STEER_LEAD)}</p>
<p>${esc(WELCOME_WHERE_IT_RUNS)}</p>
<button class="alt" onclick="go('${esc(ATTEST_DEMO_COMMAND_ID)}')">🔏 One check, three minutes — a number about your own build</button>
<p class="k dim">${esc(WELCOME_PRICE)}</p>
<p class="k dim">${esc(WELCOME_TWO_WAYS)}</p>
<p class="k dim">${esc(WELCOME_CALL_IN)} <button class="mini" onclick="go('vna.callInClaim')">How claims work</button></p>
</div>`;

// One header shape for every section: what it is, how old it is, and a control that refreshes ONLY
// it. Per-section rather than one global refresh because the sections cost wildly different amounts
// — the chip walk is a real walk, the spec is a file read — and a single button makes the cheap ones
// hostage to the expensive one.
function head(title: string, age: string, cmd?: string, behind?: string): string {
    return `<h3><span>${esc(title)}</span><span class="age">${esc(age)}${behind ? ` · <b class="warn">${esc(behind)}</b>` : ''}${
        cmd ? ` <button class="mini" title="refresh this section" onclick="go('${esc(cmd)}')">⟳</button>` : ''}</span></h3>`;
}

function render(cock: Cockpit | null, env: Envelope | null, specMd: string, behind: number | null, specAt?: string, net?: Net | null, cmd: (script: string) => string = (s) => `node ${s}`, knobRows: KnobRow[] | null = null, knobFloor: KnobFloor = null, standingPb?: StandingPlaybook, ext: string | null = null): string {
    // C1012g: no run on record — cold install, nobody's /steer has written cockpit/envelope/mesh yet.
    const cold = !cock && !env && !net;
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

    // C709c: the sweep beside the panels — read-only off C709b's own ledger and floor, no second scoring.
    const knobSection = !knobRows || !knobRows.length
        ? notRun(cmd('scripts/pmu/walk-knob-sweep.mjs'), 'the walk-knob sweep')
        : renderKnobSweep(knobRows, knobFloor);

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
.knobgrid{display:flex;flex-wrap:wrap;gap:6px}
.knobchart{border:1px solid var(--vscode-panel-border);border-radius:3px;padding:3px}
.knobchart svg{display:block;width:100%;height:auto}
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
.welcome{border:1px solid var(--vscode-focusBorder);border-radius:5px;padding:9px 11px;margin-bottom:14px}
.welcome p{margin:0 0 7px;font-size:12px;line-height:1.5}
.welcome p:last-child{margin-bottom:0}
</style>

${buildLine(ext)}
${cold ? welcome() : ''}
${head('Your standing answers', '', undefined)}
${standingSection(standingPb || emptyStandingPlaybook(), false)}

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

${head('The walk-knob sweep · the floor only rises', ago(knobFloor?.at))}
${knobSection}

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

// C921b: the section is SELF-CONTAINED (its own style, markup and script) so it rides on whichever page the sidebar paints. The
// sidebar normally paints the steer page steer-ui.mjs writes; the section lived only in the fallback page, so with a steer page on
// disk (always, in a working repo) nobody ever saw it. The steer paint now passes it as the bridge strip, above the page.
const STANDING_CSS = `.sa-wrap{margin-bottom:6px;transition:padding .15s,border-color .15s}
.sa-wrap.sa-open{border-left:2px solid var(--vscode-focusBorder);padding-left:8px}
.sa-readiness{font-size:11.5px;font-weight:600}
.sa-lede{font-size:10.5px;color:var(--vscode-descriptionForeground);margin:2px 0 8px}
.sa-pill{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:4px 7px;margin:4px 0}
.sa-pill summary{list-style:none;cursor:pointer;font-size:11.5px;display:flex;align-items:baseline;gap:6px}
.sa-pill summary::-webkit-details-marker{display:none}
.sa-pill summary::before{content:'+ ';color:var(--vscode-descriptionForeground)}
.sa-pill[open] summary::before{content:'\\2212 '}
.sa-tag{margin-left:auto;font-size:9px;text-transform:uppercase;letter-spacing:.05em;padding:1px 5px;border-radius:3px;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-panel-border);white-space:nowrap}
.sa-tag.ai{color:var(--vscode-textLink-foreground);border-color:var(--vscode-textLink-foreground)}
  .sa-q{border-bottom:1px solid var(--vscode-panel-border);padding:5px 0}
  .sa-short{font-size:11.5px;font-weight:600;display:flex;gap:6px;align-items:baseline}
  .sa-wrap{max-width:100%;min-width:0;overflow-wrap:anywhere}
  .sa-wrap div,.sa-wrap span,.sa-wrap label,.sa-wrap summary{white-space:normal}
  .sa-ui{display:flex;align-items:center;gap:6px;margin-top:3px;width:100%}
  /* C921j: the section lives inside a flex row (the 📝 pill face), which sizes a child to its content — bound it to the sidebar */
  .c-standing>.c3l.face{flex-wrap:wrap}
  .mrb .card3.pill.nested.c-readiness>.c3l.face,.c-readiness>.c3l.face{width:auto;flex-wrap:wrap;white-space:normal}   /* C1218: the 🧾 Record readiness face wraps the same way */
  #plus-standing{min-width:0}
  #plus-standing[open]{flex:1 1 100%}
  #plus-standing>.mrb,#sa-slot{width:100%;min-width:0}
  #sa-wrap{display:block;box-sizing:border-box;width:100%;max-width:100%}
  #sa-wrap .sa-more>summary.sa-short{text-transform:none;letter-spacing:normal;white-space:normal;font-size:11.5px;font-weight:600;padding:0;margin:0;border:0;background:none}
  .sa-line{flex:1;min-width:0;width:100%;font:inherit;font-size:11.5px;background:var(--vscode-input-background,#1e1e1e);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#3c3c3c));border-radius:3px;padding:3px 5px}
  .sa-wrap input[type=number],.sa-wrap select{background:var(--vscode-input-background,#1e1e1e);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#3c3c3c));border-radius:3px;padding:2px 4px}
  .sa-saved{font-size:10.5px;color:var(--vscode-testing-iconPassed,#3fb950);white-space:nowrap}
  .sa-saved:empty{display:none}
  .sa-q:not(.sa-done) .sa-line{border-color:var(--vscode-focusBorder)}
  .sa-more summary{font-size:10.5px;color:var(--vscode-descriptionForeground);cursor:pointer;list-style:none;margin-top:2px}
  .sa-more summary::-webkit-details-marker{display:none}
  .sa-title{font-size:10.5px;font-weight:600;margin-top:4px}
  #sa-wrap textarea{position:static;left:auto}
  #sa-wrap .sa-q{border:0;padding:2px 0}
  #sa-wrap .sa-q.sa-newpair{margin-top:7px;border-top:1px solid var(--vscode-panel-border,#333);padding-top:6px}
  #sa-wrap .sa-row{display:grid;grid-template-columns:15.6em 24px minmax(0,1fr) 1em;gap:5px;align-items:start}
  #sa-wrap .sa-stem{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0;line-height:24px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-textLink-foreground,#4ec9b0)}
  #sa-wrap .sa-q:not(.sa-done) .sa-stem{color:var(--vscode-foreground,#ddd)}
  #sa-wrap .sa-chip{font-size:12px;line-height:24px;text-align:center;cursor:help;color:var(--vscode-descriptionForeground,#888)}
  #sa-wrap .sa-chip[data-status=MEASURED]{color:var(--vscode-testing-iconPassed,#3fb950)}
  #sa-wrap .sa-tools{display:flex;gap:6px;align-items:center;margin:4px 0 6px;font-size:10.5px}
  #sa-wrap .sa-tools button.mini{width:auto;padding:3px 8px;font-size:10.5px}
  #sa-wrap .sa-n{opacity:.55;font-weight:400}
  #sa-wrap .sa-due{font-size:11.5px;font-weight:700;color:var(--vscode-editorWarning-foreground,#d7ba7d);margin:2px 0 4px}
  #sa-wrap .sa-field input[type=date]{background:var(--vscode-input-background,#1e1e1e);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#3c3c3c));border-radius:3px;padding:2px 4px}
  #sa-wrap .sa-sub{font-size:11.5px;font-weight:600;margin:2px 0 3px}
  #sa-wrap .sa-full{margin:3px 0 4px 2px;padding-left:8px;border-left:2px solid var(--vscode-panel-border,#333)}
  #sa-wrap .sa-saved:not(:empty){display:block;font-size:10px;text-align:right}
  #sa-wrap button.sa-tog{flex:0 0 24px;width:24px;height:24px;padding:0;font-weight:700;line-height:1;align-self:flex-start;border-radius:4px}
  #sa-wrap .sa-ui{align-items:flex-start}
  #sa-wrap textarea.sa-line{width:100%;box-sizing:border-box;min-width:0;line-height:16px;padding:3px 5px;resize:none;overflow:hidden;white-space:pre;max-height:calc(1lh + 8px);field-sizing:fixed}
  #sa-wrap .sa-q.sa-open textarea.sa-line{white-space:break-spaces;field-sizing:content;max-height:none;min-height:4lh;overflow:auto;border-color:var(--vscode-focusBorder,#0e639c)}
  #sa-wrap .sa-q.sa-open textarea.sa-line{grid-column:1 / -1;grid-row:2}
  #sa-wrap .sa-chip{grid-column:4;grid-row:1}
  .sa-trig{color:var(--vscode-textLink-foreground,#4ec9b0)}
  .sa-full{margin-top:4px}
  .sa-full[hidden]{display:none}
  .sa-line[hidden]{display:none}
  .sa-para{width:100%;box-sizing:border-box;font:inherit;font-size:11.5px;background:var(--vscode-input-background,#1e1e1e);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-focusBorder,#0e639c);border-radius:3px;padding:4px 6px;resize:vertical;margin-bottom:4px}
  .sa-more>summary.sa-short{display:flex;align-items:baseline;gap:6px;list-style:none;cursor:pointer}
  .sa-more>summary.sa-short::-webkit-details-marker{display:none}
  .sa-qtext{flex:1;min-width:0}
  .sa-part{font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-textLink-foreground,#4ec9b0);white-space:nowrap}
  .sa-plus{font-weight:700;color:var(--vscode-descriptionForeground,#888)}
  .sa-more[open] .sa-plus{transform:rotate(45deg)}
  .sa-pair{font-size:11px;font-weight:600;margin:9px 0 2px}
  .sa-teach{font-size:10.5px;color:var(--vscode-descriptionForeground);margin:2px 0 5px;font-style:italic}
  .sa-reading{font-size:10.5px;color:var(--vscode-descriptionForeground);margin:2px 0}
  .sa-reading[data-status="MEASURED"]{color:var(--vscode-testing-iconPassed,#3fb950)}
  .sa-contradiction{font-size:10.5px;color:var(--vscode-editorWarning-foreground,#cca700);margin:2px 0}
.sa-ask{font-size:11px;margin:5px 0;color:var(--vscode-foreground)}
.sa-text{width:100%;min-height:50px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-panel-border);border-radius:3px;font:inherit;padding:4px 6px;box-sizing:border-box;resize:vertical;margin-top:4px}
.sa-field{margin-top:5px;font-size:10.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--vscode-descriptionForeground)}
.sa-field select,.sa-field input[type=number]{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-panel-border);border-radius:3px;font:inherit;padding:1px 4px}
.sa-draft{display:flex;align-items:center;gap:5px;font-size:10.5px;margin-top:5px;color:var(--vscode-descriptionForeground)}
.sa-sliderval{font-size:10.5px;min-width:2.4em;text-align:right;color:var(--vscode-descriptionForeground)}`;
function standingSection(pb: StandingPlaybook, title = true): string {
    return `<style id="sa-style">${STANDING_CSS}
.sa-head{font-size:12px;font-weight:700;margin:8px 0 4px;letter-spacing:.02em}</style>
${title ? '<div class="sa-head">Your standing answers</div>' : ''}
${renderStandingAnswers(pb)}
<script>
// C921c: the ten live INSIDE the 💳 Fund Autonomy Ledger's + (the 📝 sub-pill's #sa-slot). The section arrives above the page; this
// moves it into the slot, and keeps it there across patches (a patch rebuilds .wrap, so a fresh empty slot gets the same node back,
// typed text intact). No slot on the page (an older steer page, the fallback) → it stays where it arrived, still visible.
// C921n: a repaint MORPHS the steer page in place and drops anything the fresh page does not carry — the section's own <style>
// went with it, so the page's rule parked every textarea off-screen and the boxes vanished (operator screenshot, 0.3.96). The style
// is kept by reference and put back after every patch, the same way the section node is.
(function(){ var node = document.getElementById('sa-wrap'); var head = document.querySelector('.sa-head'); var st = document.getElementById('sa-style'); if (st) (document.head || document.documentElement).appendChild(st);
  function place(){ if (st && !st.isConnected) (document.head || document.documentElement).appendChild(st); var slot = document.getElementById('sa-slot'); if (!node || !slot || slot.contains(node)) return; slot.appendChild(node); if (head) head.style.display = 'none'; }
  place(); new MutationObserver(place).observe(document.body, { childList: true, subtree: true }); })();
// the panel's API handle, resolved at event time: the steer page parks it on window.__vs, the bridge shim holds _vs, the
// fallback page holds vs — never a second acquireVsCodeApi(), which throws
function saApi(){ return (typeof window.__vs !== 'undefined' && window.__vs) || (typeof _vs !== 'undefined' ? _vs : vs); }
// C921: the ten standing answers live-recompute in the page itself — no round trip needed to know
// the readiness line changed, so typing never waits on the extension host. The network postMessage
// is debounced (saDebounce) and only ever carries the one question's patch; the save itself (and the
// activity-bar badge) happens over there, in standing-answers.ts.
let SA_ANSWERS = ${JSON.stringify(pb.answers || {})};
const SA_QUESTIONS = ${JSON.stringify(STANDING_QUESTIONS.map((q) => ({ id: q.id, draft: q.draft })))};
function saAnswered(a){ if(!a) return false; return !!(a.text && a.text.trim()) || a.slider!=null || a.choice!=null || !!(a.numbers && Object.values(a.numbers).some((v)=>v!=null)); }
function saRecompute(){
  let answered = 0, aiCanDraft = 0, onlyYou = 0;
  for (const q of SA_QUESTIONS) { const ok = saAnswered(SA_ANSWERS[q.id]); if (ok) answered++; else if (q.draft === 'ai') aiCanDraft++; else onlyYou++;
    const row = document.querySelector('.sa-q[data-question="' + q.id + '"]'); if (row) row.classList.toggle('sa-done', ok); }
  const line = document.getElementById('sa-readiness-line');
  if (line) line.textContent = 'Readiness: ' + answered + ' of ' + SA_QUESTIONS.length + ' answered · your AI can still draft: ' + aiCanDraft + ' · only you: ' + onlyYou;
  const wrap = document.getElementById('sa-wrap');
  if (wrap) wrap.classList.toggle('sa-open', answered < SA_QUESTIONS.length);
}
let saTimers = {};
function saPatch(id, patch){ saApi().postMessage({ type: 'standingSave', id: id, patch: patch }); }
function saToggle(id){
  const row = document.querySelector('.sa-q[data-question="' + id + '"]'), full = document.getElementById('sa-full-' + id), box = document.getElementById('sa-line-' + id);
  if (!row || !full || !box) return;
  const opening = !row.classList.contains('sa-open');
  row.classList.toggle('sa-open', opening); full.hidden = !opening;
  const btn = row.querySelector('.sa-tog'); if (btn) btn.textContent = opening ? '−' : '+';
  box.focus();
}
function saKey(e, id, el){
  const open = el.closest('.sa-q').classList.contains('sa-open');
  if (e.key === 'Enter' && (!open || e.metaKey || e.ctrlKey)) { e.preventDefault(); saSaveLine(id, el); }
}
function saSaveLine(id, el){
  const value = el.value;
  SA_ANSWERS[id] = Object.assign({}, SA_ANSWERS[id] || {}, { text: value });
  saRecompute(); saPatch(id, { text: value });
  const t = document.getElementById('sa-saved-' + id); if (t) { t.textContent = '✓ saved'; setTimeout(function(){ t.textContent = ''; }, 1600); }
}
function saDebounce(id, value){
  SA_ANSWERS[id] = Object.assign({}, SA_ANSWERS[id] || {}, { text: value });
  saRecompute();
  clearTimeout(saTimers[id]);
  saTimers[id] = setTimeout(function(){ saPatch(id, { text: value }); }, 500);
}
function saSlider(id, value){ SA_ANSWERS[id] = Object.assign({}, SA_ANSWERS[id] || {}, { slider: Number(value) }); saRecompute(); saPatch(id, { slider: Number(value) }); }
function saChoice(id, value){ SA_ANSWERS[id] = Object.assign({}, SA_ANSWERS[id] || {}, { choice: value }); saRecompute(); saPatch(id, { choice: value }); }
function saDraft(id, checked){ SA_ANSWERS[id] = Object.assign({}, SA_ANSWERS[id] || {}, { drafted_by_model: checked }); saRecompute(); saPatch(id, { drafted_by_model: checked }); }
function saNumber(id, numId, value){
  const n = Object.assign({}, (SA_ANSWERS[id] && SA_ANSWERS[id].numbers) || {});
  n[numId] = value === '' ? null : Number(value);
  SA_ANSWERS[id] = Object.assign({}, SA_ANSWERS[id] || {}, { numbers: n });
  saRecompute();
  saPatch(id, { numbers: n });
}
saRecompute();
</script>`;
}

// C921: the ten standing answers, rendered near the top of the panel — a live readiness line, the
// source's own lede (READINESS_LINE), and ten collapsed pills. Reads QUESTIONS and READINESS_LINE
// from standing-answers.ts, which bundles them byte-for-byte from the one source
// (src/lib/backup/standing-answers.mjs) — nothing here retypes a question.
function renderStandingAnswers(pb: StandingPlaybook): string {
    const r = standingReadiness(pb);
    const open = r.of - r.answered;
    const pill = (q: Question): string => {
        const a: Partial<StandingAnswer> = pb.answers[q.id] || {};
        const tag = q.draft === 'ai' ? 'your AI can draft' : 'only you';
        const slider = q.slider ? `<div class="sa-field"><label>${esc(q.slider.label)} (${esc(q.slider.unit)})</label>
            <input type="range" min="${q.slider.min}" max="${q.slider.max}" step="${q.slider.step}" value="${a.slider ?? q.slider.min}" oninput="saSlider('${q.id}', this.value); this.nextElementSibling.textContent=this.value">
            <span class="sa-sliderval">${a.slider ?? q.slider.min}</span></div>` : '';
        const choice = q.choice ? `<div class="sa-field"><label>${esc(q.choice.label)}</label>
            <select onchange="saChoice('${q.id}', this.value)">${['', ...q.choice.options].map((o) => `<option value="${esc(o)}" ${a.choice === o ? 'selected' : ''}>${esc(o || '— choose —')}</option>`).join('')}</select></div>` : '';
        const numbers = q.numbers ? `<div class="sa-field">${q.numbers.map((n) => `<label>${esc(n.label)} (${esc(n.unit)})
            <input type="number" value="${a.numbers?.[n.id] ?? ''}" oninput="saNumber('${q.id}','${n.id}', this.value)" style="width:70px"></label>`).join('')}</div>` : '';
        // C921g (operator: "we need the full questions, load bearing part first in the sidebar - with thext boxes, one row text answer
        // format is ok, expandable is for the full view"): the short question and its one-row box are always shown; the + opens the
        // full question, what the tape measures, who drafted it, and the slider/choice/number controls.
        // C921h (operator: "after the question show the ui first, text input or slider" · "next row" · "one line text entry boxes you can
        // drop text into and hit enter to save it"): row 1 the question, row 2 its controls (a one-line input that saves on Enter or when
        // you leave it, then the slider / choice / numbers this question has); the + keeps the full question, its teach line, drafted-by-AI.
        // C921j (operator: "the full question on same row" · "infinite widhth single text box" · "the pmulber is your spec" · "relveal so they
        // can recognize the full stack science" · "dont say drafted by my ai"): row 1 is ONE line — the question, the part of the stack it
        // sets, and the + that unfolds the full question and what the tape measures; row 2 a full-width input (Enter saves); then controls.
        // C921k (operator: "questions start with the load bearing trigger for affordances … expand button before the text box, then
        // infinite (long) single row text entry, until you expand then it turns into paragraph with the rest of the questions"): row 1
        // the question, its trigger word in bold; row 2 [+] then one long single-row input (Enter saves). Expanded: the input becomes a
        // paragraph box with the same answer, and the full question, what the tape measures, the reading and the controls come under it.
        const ci = q.short.indexOf(':');
        const stem = ci > 0 ? q.short.slice(0, ci) : q.title;
        const sub = ci > 0 ? q.short.slice(ci + 1).trim() : q.short;
        const val = esc(a.text ?? '');
        // C921m (operator paste: "01 · WALK AWAY IF [+] [ answer… ] ✓ LIVE" — trigger stem, expand button, infinite single row, live tape
        // receipt): the stem is the start of a sentence the answer completes; the chip is the C930 reading, short, its whole text on hover.
        const rd = STANDING_READINGS[q.id];
        const chip = !rd ? '' : rd.status === 'MEASURED' ? '✓' : '·';   // the icon on the row; the whole reading on hover and under the +
        const chipTitle = !rd ? '' : rd.status === 'MEASURED' ? String(rd.why || '') : `UNMEASURED — ${rd.why || ''}`;
        return `<div class="sa-q${a.text && a.text.trim() ? ' sa-done' : ''}${q.n > 1 && STANDING_QUESTIONS[q.n - 2] && STANDING_QUESTIONS[q.n - 2].pair !== q.pair ? ' sa-newpair' : ''}" data-question="${q.id}">
<div class="sa-row"><span class="sa-stem" title="${esc(q.short)}"><span class="sa-n">${String(q.n).padStart(2, '0')}</span> ${esc(stem)}</span><button class="sa-tog" title="the full question, what the tape measures, the controls — and a paragraph box" onclick="saToggle('${q.id}')">+</button><textarea class="sa-line" id="sa-line-${q.id}" rows="1" placeholder="${esc(sub)}" onkeydown="saKey(event,'${q.id}',this)" onchange="saSaveLine('${q.id}',this)">${val}</textarea><span class="sa-chip" data-status="${rd ? esc(rd.status) : ''}" title="${esc(chipTitle)}">${esc(chip)}</span></div>
<span class="sa-saved" id="sa-saved-${q.id}"></span>
<div class="sa-full" id="sa-full-${q.id}" hidden>
<div class="sa-sub">${esc(q.short)}</div>
<div class="sa-ask">${esc(q.ask)}</div>
<div class="sa-teach">${esc(q.teach)}</div>
${rd ? `<div class="sa-reading" data-status="${esc(rd.status)}">Tested against the tape: ${esc(chipTitle)}</div>` : ''}
${slider}${choice}${numbers}${q.date ? `<div class="sa-field"><label>${esc(q.date.label)}</label><input type="date" value="${esc(a.date ?? '')}" onchange="saPatch('${q.id}', { date: this.value || null })"></div>` : ''}${q.decision ? `<div class="sa-field"><label>${esc(q.decision.label)}</label><select onchange="saPatch('${q.id}', { decision: this.value || null })">${['', ...q.decision.options].map((o) => `<option value="${esc(o)}" ${a.decision === o ? 'selected' : ''}>${esc(o || '— not yet —')}</option>`).join('')}</select></div>` : ''}
</div>
</div>`;
    };
    return `<div id="sa-wrap" class="sa-wrap${open > 0 ? ' sa-open' : ''}">
${(() => { const d = standingStopDue(pb); return d.due ? `<div class="sa-due">⏰ ${esc(STOP_DUE_LINE)} (set for ${esc(String(d.date))}) — open 01 and record keep or stop</div>` : ''; })()}
<div id="sa-readiness-line" class="sa-readiness">Readiness: ${r.answered} of ${r.of} answered · your AI can still draft: ${r.aiCanDraft.length} · only you: ${r.onlyYou.length}</div>
<div class="sa-tools" title="${esc(STANDING_READINESS_LINE)}"><button class="mini" title="write your rough comments in the boxes, then copy all ten (questions, what the tape measures, your answers) into Claude" onclick="saApi().postMessage({ type: 'standingCopyAll' })">📋 Copy all ten</button><button class="mini" title="paste Claude's ten numbered lines back into the boxes (or run /standing-answers in Claude Code, which writes them for you)" onclick="saApi().postMessage({ type: 'standingPasteBack' })">📥 Paste answers</button><a href="#" onclick="saApi().postMessage({ type: 'standingLifecycle' }); return false;">every step →</a></div>
${STANDING_QUESTIONS.map(pill).join('')}
</div>`;
}
