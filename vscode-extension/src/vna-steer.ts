// packages/intentguard-vscode/src/vna-steer.ts — /steer, in the IDE.
//
// The skill runs six commands in order and then opens a file. Doing that by hand is six things to
// remember, which is the same tree-by-tree reading the page exists to replace — so this is one
// command that runs the same six and shows the same page, beside the code.
//
// IT OWNS NO COMPUTATION. Every number on the page is written by a script in scripts/vna/; this
// module spawns them in the skill's own order and renders the HTML they produced. Recomputing any
// of it in TypeScript would fork the receipt, and a forked receipt is a second answer to a question
// that must have exactly one.
//
// THE CHIP WALK RUNS FIRST AND IS NAMED WHILE IT RUNS. cockpit.mjs is the sensor that goes through
// pmu-onchip, and the operator's question — "it doesn't look like you're running the rust pipeline
// at all" — was answerable only by reading source. A progress step that names the walk, and a page
// that then shows its engine, its milliseconds and its three panels, answers it by being looked at.
//
// THE PAGE OPENS IN THE SIDE PANEL, never an editor column — see showPage.
//
// NOTHING HERE GATES. A sensor that fails does not stop the run: the page renders "not run — <cmd>"
// where that receipt would have been, which is the honest reading, and the failures are reported
// afterwards. A cockpit that blocked on a red sensor would be the wall this whole lane refuses.
//
// LLM-FREE: nothing in this file calls a model.
import * as vscode from 'vscode';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { describeFailure } from './status';
import { pointAtActive } from './vna-tail';
import { copyOut } from './vna-view';
import { insideRepo, rowLine } from './open-doc';   // C109e: the pure half of vna.openFile and vna.viewUnit(label), guarded under tsx
import { entitlementEnv, bearerEnv } from './auth-manager';   // C75: the entitlement CLAIMS ride the environment into every repaint · C102c: the bearer for the backup POST
import { doorCommand, docOf } from './commands';
import { engineSecretEnv, refreshEngineStatus, engineKeyRowsEnv, hostEnvForChild } from './vna-engines';   // C166: the SecretStorage keys ride the runner's child env, nowhere else   // C239a: the strip (no CLAUDECODE / CLAUDE_*) lives in one place, shared with the 💬 chat's /steer door   // C179: fp8 rows for the runner-card sub-pill, never the keys   // C103f: the card is a link — every open-document command resolves its paths from the ONE table   // C94b: THE ONE COMMAND TABLE — node scripts/vna/<x>.mjs at home, npx thetacog-mcp <door> anywhere else

// The skill's step 1, in the skill's order: the chip walk first, then the sensors that read git and
// receipts, then the renderer. Kept as data so the order is readable rather than buried in control
// flow, and so a guard can compare it against the skill's own table.
const SENSORS: Array<{ script: string; label: string }> = [
    { script: 'cockpit.mjs', label: 'the ballistic walk on the chip (rust)' },
    { script: 'aperture-receipt.mjs', label: 'the aperture receipt — S_in · F_in · κ · ω off the walk receipt (C115)' },
    { script: 'story.mjs', label: 'the shape, its movement, its meaning' },
    { script: 'alignment-map.mjs', label: 'nine rooms vs declared poles' },
    { script: 'competence-pixel.mjs', label: 'the operator’s shape' },
    { script: 'parametric-trigger.mjs', label: 'the trigger predicate + backtest' },
];
const RENDER = 'steer-ui.mjs';
const PAGE = path.join('docs', 'specs', 'vna', 'steer', 'latest.html');

let running = false;
let queued = false;

function root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// `env` names WHO ran it for the scripts that keep an insertion ledger (spec-tree.mjs reads VNA_BY): the
// tree JSON itself must not carry a runner, so the button's identity rides in the environment.
// the last JSON object line of a child's output — '' when there is none, so JSON.parse throws and the caller says why (never the
// last line: that is '' when a child is killed, and '' is not nullish — extension-view guard 19)
const lastJsonLine = (out: string): string => out.split('\n').filter((l) => l.trim().startsWith('{')).pop() || '';
// THE ONE SPAWN (C94b). `script` is a scripts/vna basename; the table resolves it — `node scripts/vna/<script>` at home,
// `npx thetacog-mcp <door>` in a stranger's repo, or NOT RUNNABLE (no door yet) — and then nothing is spawned: the result is
// the table's own `not run — <reason>` line, which is what the page prints where that receipt would have been.
function run(cwd: string, script: string, args: string[] = [], env: Record<string, string> = {}): Promise<{ ok: boolean; out: string }> {
    const c = doorCommand(cwd, `scripts/vna/${script}`, args);
    if (!c.runnable) { return Promise.resolve({ ok: false, out: c.display }); }
    return new Promise((resolve) => {
        execFile(c.file, c.args,
            { cwd, timeout: 180000, maxBuffer: 1 << 26, env: { ...process.env, ...entitlementEnv(), ...engineKeyRowsEnv(), ...env } },   // C179: VNA_ENGINE_KEY_ROWS rides every render spawn, fp8 only, never a key
            (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
    });
}

// SHOWING THE PAGE = FOCUSING THE SIDE PANEL. The page is rendered by VnaViewProvider (vna-view.ts),
// which watches the file steer-ui.mjs writes and re-reads it; this module never creates a
// WebviewPanel. An editor-column page (ViewColumn.Beside, until 0.3.1) split the code and took the
// active editor away from the .txt the loop follows — the page was stealing the surface it steers.
async function showPage(cwd: string, why?: string): Promise<boolean> {
    try { await fs.access(path.join(cwd, PAGE)); }
    catch {
        // "I could not look" is a different claim from "I looked and saw nothing", and the
        // difference is the whole point of the instrument. Say which one this is.
        vscode.window.showErrorMessage(`ThetaCog Steer: no page at ${PAGE} — ${why ?? 'run Steer: Run the Loop to produce one'}`);
        return false;
    }
    await vscode.commands.executeCommand('thetacog.steer.focus');
    return true;
}

async function steer(context: vscode.ExtensionContext) {
    const cwd = root();
    if (!cwd) { vscode.window.showErrorMessage('ThetaCog Steer: no workspace folder open.'); return; }
    if (running) { queued = true; return; }
    running = true;

    // The file open is the steer file. If a .txt is active, the pointer moves to it BEFORE the
    // sensors run, so the tail watcher and the Claude hook are already following the file the page
    // is about to open beside.
    await pointAtActive(cwd);

    const failed: string[] = [];
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'ThetaCog Steer', cancellable: false },
            async (p) => {
                const step = 100 / (SENSORS.length + 1);
                for (const s of SENSORS) {
                    p.report({ message: `${s.script} — ${s.label}` });
                    const r = await run(cwd, s.script, s.script === 'cockpit.mjs' ? ['--no-open'] : []);
                    // A failed sensor is recorded and stepped over. Its receipt stays absent, and an
                    // absent receipt renders as its command — never as a zero.
                    // `?? 'failed'` never fires here: ''.split('\n').pop() is '', which is not nullish,
                    // so a silent child produced "cockpit.mjs: " and nothing else. describeFailure
                    // is the one place that knows what to say about silence.
                    if (!r.ok) { failed.push(`${s.script}: ${describeFailure(r.out)}`); }
                    p.report({ increment: step });
                }
                p.report({ message: 'steer-ui.mjs — the map and the spec on one page' });
                const r = await run(cwd, RENDER, ['--no-open']);
                if (!r.ok) { failed.push(`${RENDER}: ${describeFailure(r.out)}`); }
                p.report({ increment: step });
            });

        const shown = await showPage(cwd, failed[0]);
        if (!shown) { return; }

        if (failed.length) {
            vscode.window.showWarningMessage(
                `ThetaCog Steer: ${failed.length} sensor(s) did not run — the page shows their command instead of a number. ${failed[0]}`);
        }
    } finally {
        running = false;
    }
    if (queued) { queued = false; await steer(context); }
}

// ── THE EARNED TICK (C26, §15.5) ────────────────────────────────────────────
// A text input for the id, never a menu of what to do: a picker would rank the items for him, which
// is the instrument choosing the work. The flip itself is delegated to spec-check.mjs, which runs
// the acceptance named on the item's own line and refuses by naming the failing test — the
// extension neither runs the test nor edits the markdown, so there is exactly one place where a
// tick can be earned.
async function toggleCheck(cwd: string) {
    const id = await vscode.window.showInputBox({
        title: 'Steer: tick a checklist item',
        prompt: 'Item id (e.g. C17). Its acceptance runs first; a red one refuses and changes nothing.',
        validateInput: (v) => (/^[A-Za-z]+\d+$/.test(v.trim()) ? null : 'an item id, like C17'),
    });
    if (!id) { return; }
    const res = await run(cwd, 'spec-check.mjs', ['toggle', '--item', id.trim()]);
    const line = res.out.trim().split('\n')[0] || (res.ok ? 'done' : describeFailure(res.out));
    if (res.ok) { vscode.window.showInformationMessage(`Steer: ${line}`); }
    else { vscode.window.showWarningMessage(`Steer: ${line}`); }
}

// ── PER-SECTION REFRESH ─────────────────────────────────────────────────────
// One button per section rather than one for the page. The sections cost wildly different amounts —
// the chip walk is a real walk, the spec is a file read — and a single refresh makes the cheap ones
// hostage to the expensive one, which is how a refresh button stops being pressed.
//
// Each runs ONE script and nothing else. The panel then re-reads the receipt through its own
// watcher, so the button and a terminal run land in the same place by the same route.
const SECTION: Record<string, { script: string; args: string[]; label: string }> = {
    cockpit:  { script: 'cockpit.mjs',  args: ['--no-open'], label: 'the ballistic walk on the chip' },
    envelope: { script: 'envelope.mjs', args: [], label: 'both arms' },
    spec:     { script: 'steer-ui.mjs', args: ['--no-open'], label: 'the spec and the page' },
    net:      { script: 'mesh.mjs',     args: [], label: 'the net — strands, holes and mesh size' },
    // the typed Merkle tree over the steer file's ledger rows: sha256 per node, one root, timed revisions
    spectree: { script: 'spec-tree.mjs', args: [], label: 'the spec tree — merkle root over the amendments' },
};

async function runSection(key: string) {
    const cwd = root(); if (!cwd) { return; }
    const s = SECTION[key];
    if (!s) { vscode.window.showWarningMessage(`Steer: no section "${key}"`); return; }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Steer · ${s.label}` },
        async () => {
            const r = await run(cwd, s.script, s.args, key === 'spectree' ? { VNA_BY: 'ide:refresh' } : {});
            // A refresh that failed must say so. Silently leaving the old numbers on screen after a
            // button press is the worst of both: it looks refreshed and it is not.
            if (!r.ok) { vscode.window.showWarningMessage(`Steer ${s.script}: ${describeFailure(r.out)}`); }
        });
}

// ── PASTE → TREE (operator 2026-09-17: "add the auto paste to the merkle tree subdivision logic as a
// button to the side panel"). One button, three scripts in a fixed order, nothing computed here:
//   1. clip-watch.mjs arm   — the clipboard daemon's consent flag (idempotent: arming an armed one is a no-op)
//   2. spec-tree.mjs        — fold every amendment row not yet ingested into the Merkle tree
//   3. steer-ui.mjs         — repaint the page the view renders
// then focus the view; its watcher re-reads latest.html. A failed step is reported and the chain goes
// on — an unarmed clipboard must not stop the rows already in the ledger from reaching the tree.
async function pasteToTree() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const failed: string[] = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Steer · paste → tree' }, async (p) => {
        p.report({ message: 'clip-watch.mjs arm' });
        const a = await run(cwd, 'clip-watch.mjs', ['arm']);
        if (!a.ok) { failed.push(`clip-watch.mjs: ${describeFailure(a.out)}`); }
        p.report({ message: 'spec-tree.mjs — folding new rows into the tree' });
        const t = await run(cwd, 'spec-tree.mjs', [], { VNA_BY: 'ide:pasteToTree' });
        if (!t.ok) { failed.push(`spec-tree.mjs: ${describeFailure(t.out)}`); }
        p.report({ message: 'steer-ui.mjs — repaint' });
        const u = await run(cwd, RENDER, ['--no-open']);
        if (!u.ok) { failed.push(`${RENDER}: ${describeFailure(u.out)}`); }
    });
    await vscode.commands.executeCommand('thetacog.steer.focus');
    if (failed.length) { vscode.window.showWarningMessage(`Steer paste → tree: ${failed.join(' · ')}`); }
}

// ── C51 THE CLEAR ACTUATOR (operator 2026-09-17: "clearing often should be low or no cost with this setup … not
// just by habit"). ONE CLICK, NEVER UNATTENDED: the gauge (scripts/vna/clear-gauge.mjs, painted in the spec-tree
// head) says FREE / OVERDUE / FOLD-FIRST from two byte counts; this command only sends the keystrokes. It reads the
// gauge receipt first and REFUSES under FOLD-FIRST — a clear then would lose bytes the tree has not folded — and it
// never fires on a timer or a threshold. The next Claude turn re-seeds from the spec (T8 snowball).
async function clearClaudeTerminal(why = ''): Promise<boolean> {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return false; }
    let state = 'unmeasured', line = '';
    try { const g = JSON.parse(await fs.readFile(path.join(cwd, '.thetacog', 'vna-clear-gauge.json'), 'utf8')); state = String(g.state || 'unmeasured'); line = String(g.line || ''); } catch { /* no receipt yet — the hook writes one per turn */ }
    if (state === 'FOLD-FIRST') { vscode.window.showWarningMessage(`Steer: not cleared — ${line || 'unfolded bytes on the tape'}. Fold rows → tree first.`); return false; }
    const term = vscode.window.activeTerminal;
    if (!term) { vscode.window.showWarningMessage('Steer: no active terminal — click into the Claude terminal, then ⚡ /clear.'); return false; }
    term.sendText('/clear', true);
    vscode.window.setStatusBarMessage(`Steer: /clear sent to "${term.name}" · ${state}${why ? ` · ${why}` : ''} · the next turn re-seeds from the spec`, 8000);
    return true;
}

// ── C91c THE EVICTION (goal 15, unit 3). C51's actuator stays ONE CLICK, NEVER UNATTENDED — or the goal's own close: three
// receipts, never a timer or a threshold. The hook writes .thetacog/vna-clear-decision.json beside the gauge every turn
// (goal.mjs clearDecisionFor → clear-gauge.mjs clearDecision: the goal row on the tape, the send log carrying the report's
// resendId, the gauge FREE or OVERDUE). This host READS the verdict and computes nothing; on CLEAR it calls the SAME
// clearClaudeTerminal() the button calls — the FOLD-FIRST refusal inside it is unchanged — ONCE per goal_sha, latched in
// workspaceState so a re-written receipt never clears the chair twice for one goal. HOLD does nothing.
type ClearDecision = { verdict?: string; goal_sha?: string | null; missing?: string | null; line?: string; report_resend_id?: string | null };
async function evictOnGoalClose(context: vscode.ExtensionContext): Promise<void> {
    const cwd = root(); if (!cwd) { return; }
    let d: ClearDecision | null = null;
    try { d = JSON.parse(await fs.readFile(path.join(cwd, '.thetacog', 'vna-clear-decision.json'), 'utf8')); } catch { return; }
    if (!d || d.verdict !== 'CLEAR') { return; }
    const sha = String(d.goal_sha || ''); if (!sha) { return; }
    if (context.workspaceState.get<string>('vna.evictedGoalSha') === sha) { return; }   // the latch: once per goal_sha
    await context.workspaceState.update('vna.evictedGoalSha', sha);
    const sent = await clearClaudeTerminal(`goal ${sha.slice(0, 12)} closed · report ${d.report_resend_id || '?'} sent`);
    if (!sent) { vscode.window.setStatusBarMessage(`Steer: goal ${sha.slice(0, 12)} closed — the chair was not cleared (see the warning); ⚡ /clear by hand`, 8000); }
}

// ── C68 THE RUN ROW (operator 2026-09-18: "copy that goal … to run it inside of Claude … completely obvious what the order
// of execution should be"). Three commands, no computation here: the runner is scripts/vna/steer-runner.mjs and the goal
// text is goal.mjs copy. The runner streams into ITS OWN output channel (never the chat terminal — a worker typed into the
// operator's Claude terminal would be the context leak this whole goal removes) and is spawned detached so abort can kill
// the whole process group (the runner forwards SIGTERM to its worker and writes the abort to .thetacog/runner.ndjson).
// The strip's status is painted by steer-ui.mjs from that ndjson; this module keeps only the live child handle.
let runnerChild: ChildProcess | null = null;
let runnerOut: vscode.OutputChannel | null = null;
async function runGoalHeadless() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    if (runnerChild && runnerChild.exitCode === null) { vscode.window.showWarningMessage('Steer: the runner is already running — 🛑 abort first.'); return; }
    let left = 1; try { const st = JSON.parse(lastJsonLine((await run(cwd, 'goal.mjs', ['status', '--json'])).out)); if (st && st.left) { left = st.left; } } catch { /* one unit */ }
    runnerOut ??= vscode.window.createOutputChannel('ThetaCog · runner');
    runnerOut.show(true);
    const rc = doorCommand(cwd, 'scripts/vna/steer-runner.mjs', ['--max-units', String(left)]);
    runnerOut.appendLine(`[${new Date().toISOString()}] ${rc.display}`);
    if (!rc.runnable) { vscode.window.showWarningMessage(`Steer runner: ${rc.display}`); return; }   // C94b: away from home, no path of ours is spawned
    const env: Record<string, string> = hostEnvForChild();   // C239a: the one strip — the same base the 💬 chat's /steer door spawns on (runnerEnv)
    Object.assign(env, await engineSecretEnv());   // C166: the ⚙️ Engines & Keys keys, from SecretStorage into this child's env only
    const child = spawn(rc.file, rc.args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    runnerChild = child;
    child.stdout?.on('data', (d) => runnerOut?.append(String(d)));
    child.stderr?.on('data', (d) => runnerOut?.append(String(d)));
    child.on('close', (code) => {
        runnerOut?.appendLine(`[${new Date().toISOString()}] runner exited ${code}`);
        if (code === 0) { vscode.window.setStatusBarMessage('Steer runner: done — every gate read true', 8000); }
        else { vscode.window.showWarningMessage(`Steer runner: exit ${code} — see "ThetaCog · runner" output; the reason is on .thetacog/runner.ndjson`); }
        void run(cwd, 'steer-ui.mjs', ['--no-open']);   // repaint the strip's status from the ndjson
        void refreshEngineStatus();   // C166: the cost on the status bar is the rows this run just wrote
    });
    vscode.window.setStatusBarMessage(`Steer runner: dispatching ${left} unit${left === 1 ? '' : 's'} headless`, 6000);
    setTimeout(() => void run(cwd, 'steer-ui.mjs', ['--no-open']), 1500);
}
async function laneAction(which: 'amend' | 'revert') {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const r = await run(cwd, 'lane-actions.mjs', [which, '--json']);
    let j: any = null; try { j = JSON.parse(lastJsonLine(r.out)); } catch { /* the message below carries the raw output */ }
    if (!j || !j.ok) { vscode.window.showWarningMessage(`Steer ${which}: ${(j && j.why) || r.out.slice(0, 200)}`); return; }
    vscode.window.setStatusBarMessage(which === 'amend' ? `Steer: basin ${j.label} amended on the ledger — run again` : `Steer: ${(j.paths || []).length} drifted path(s) restored — run again`, 8000);
    void run(cwd, 'steer-ui.mjs', ['--no-open']);
    await runGoalHeadless();
}
async function abortGoal() {
    const c = runnerChild;
    if (!c || c.exitCode !== null || !c.pid) { vscode.window.showInformationMessage('Steer: no runner is active.'); return; }
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* already gone */ } }
    runnerOut?.appendLine(`[${new Date().toISOString()}] 🛑 abort — SIGTERM to the runner's process group`);
    vscode.window.setStatusBarMessage('Steer runner: abort sent', 5000);
}
async function copyGoal() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const r = await run(cwd, 'goal.mjs', ['copy']);
    if (!r.ok) { vscode.window.showWarningMessage(`Steer goal.mjs copy: ${describeFailure(r.out)}`); return; }
    await copyOut(cwd, r.out.trim(), 'ide:copy-goal');
    vscode.window.setStatusBarMessage('📋 the goal, in execution order — paste it into a fresh Claude or read the runner command off it', 6000);
}

// ── C103f THE CARD IS A LINK (operator 2026-09-20: "when you click it, you open the document — the text file it was appended to,
// the markdown file for the specification, the logs for the tape"). ONE handler for every open-document command: the paths come
// from DOCS (commands.ts, mirrored in door-cmd.mjs); a text document opens as the file — editable, the fold reads the hand-edited
// spec on the next turn; the walk's page opens through the cockpit webview (vna.openCockpit, already built); an absent receipt
// says `not run — <command>` in the row's own words, never a blank editor. The steer file's path is read off its pointer.
async function openDoc(cmd: string) {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const doc = docOf(cmd); if (!doc) { vscode.window.showWarningMessage(`Steer: ${cmd} names no document in the command table`); return; }
    const paths = [...doc.paths];
    if (cmd === 'vna.openBridge') {   // the steer file: the pointer names the .txt the loop follows; the pointer itself is not the document
        try { const ptr = JSON.parse(await fs.readFile(path.join(cwd, '.thetacog', 'vna-steer-file.json'), 'utf8')) as { source?: string }; if (ptr.source) { paths[0] = ptr.source; } } catch { /* no pointer yet — the not-run line below says so */ }
    }
    let opened = 0;
    for (const rel of paths) {
        const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
        const there = await fs.access(abs).then(() => true, () => false);
        if (!there) { continue; }
        if (doc.page && rel === doc.page) { await vscode.commands.executeCommand('vna.openCockpit'); opened++; continue; }   // the rendered page, in the webview
        const d = await vscode.workspace.openTextDocument(abs);
        await vscode.window.showTextDocument(d, { preview: false });   // the editor the user is in; the steer page itself never names a column (SMOKE)
        opened++;
    }
    if (!opened) {   // the row's own not-run line; a `node scripts/…` command is resolved through the table (npx away from home), a plain reason is printed as is
        const nr = doc.notRun && /^node scripts\//.test(doc.notRun) ? doorCommand(cwd, doc.notRun.split(' ')[1], doc.notRun.split(' ').slice(2)).display : doc.notRun;
        vscode.window.showWarningMessage(`Steer ${doc.label}: ${nr ? `not run — ${nr}` : 'not on disk'} (${doc.paths.join(' · ')})`); return;
    }
    vscode.window.setStatusBarMessage(`${doc.label} — ${paths.join(' · ')} · edit it if you like; the fold reads the file on the next turn`, 6000);
}
// ── C71 THE BACKUP AND THE LICENCE DOOR (operator 2026-09-18: "you just hit a link, you log into our site, you back up the
// tape, and you buy the licence right there — and that's something you can do from the extension"). DENY-FIRST: the tape is
// the operator's record and sending it anywhere is an outbound publish, so the extension COMPOSES and the human ARMS. This
// command runs scripts/vna/backup.mjs (one content-addressed archive under .thetacog/backup/<sha>.tar.gz + its manifest —
// the script owns the bytes, nothing is bundled in TypeScript), shows what was bundled, and on the operator's click opens
// https://thetadriven.com/backup?manifest=<sha> in the browser. Login, upload and the licence purchase happen on the site.
// No fetch, no credential, no upload lives here.
// ── C89b THE FIVE DOORS BEHIND THE NEW BUTTONS ───────────────────────────────────────────────────────────────────────
// 📄 View Unit Contract — open the current unit's spec row (its invariants, acceptance, guard path) in the editor.
// C98d — the unit's row is read ONCE for both doors: its label from goal.mjs status (the record), its line in the spec, and the
// guard path the row itself names in (guard: `…`) — never a path typed here. (The escape string in the row regex was a
// corrupted sed artefact until C98d; the row was found only when the label carried no regex metacharacter.)
const SPEC_MD = path.join('docs', 'specs', 'vna', 'SPEC-VNA-COCKPIT.md');
// C109e — a row id clicked on the page (vna.viewUnit takes the label) opens THAT row; with no label the /goal's current unit, as before
async function currentUnitRow(cwd: string, want: string | null = null): Promise<{ label: string | null; specPath: string; line: number; guard: string | null }> {
    let label: string | null = want && /^C\d+[a-z]?$/.test(want) ? want : null;
    if (!label) {
        const r = await run(cwd, 'goal.mjs', ['status', '--json']);
        try { const j = JSON.parse(lastJsonLine(r.out)); label = j && j.current && j.current.labels && j.current.labels[0] ? String(j.current.labels[0]) : null; } catch { /* no goal */ }
    }
    const specPath = path.join(cwd, SPEC_MD);
    const text = await fs.readFile(specPath, 'utf8').catch(() => '');
    const lines = text.split('\n');
    const line = rowLine(text, label);   // any indent — rows under a parent sit two spaces in
    const m = line >= 0 ? /\(guard:\s*`([^`]+)`/.exec(lines[line]) : null;
    return { label, specPath, line, guard: m ? m[1].trim() : null };
}
async function viewUnit(want?: unknown) {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const { label, specPath, line: at } = await currentUnitRow(cwd, typeof want === 'string' ? want : null);
    const doc = await vscode.workspace.openTextDocument(specPath);
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    if (at >= 0) { const pos = new vscode.Position(at, 0); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop); }
    vscode.window.setStatusBarMessage(label ? `📄 ${label} — the row, its invariants and its guard` : '📄 no /goal on the record — the spec opened at the top', 5000);
}
// C109e — vna.openFile: a receipt path the page names (data/vna/* · docs/specs/vna/* · .thetacog/*) opens in the editor; the
// path is data off a rendered page, so insideRepo refuses anything that does not resolve under the workspace, and a path
// not on disk says so in the page's own words (not on disk — <path>) rather than opening an empty buffer.
async function openFile(rel?: unknown) {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const abs = insideRepo(cwd, rel);
    if (!abs) { vscode.window.showWarningMessage(`Steer: refused — ${String(rel ?? '').slice(0, 120) || '(empty)'} is not a path inside this repo`); return; }
    const there = await fs.access(abs).then(() => true, () => false);
    if (!there) { vscode.window.showWarningMessage(`Steer: not on disk — ${String(rel)} · the page names it, the file is not there yet`); return; }
    const doc = await vscode.workspace.openTextDocument(abs);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.setStatusBarMessage(`📎 ${String(rel)} — the receipt behind the number; edit it if you like, the fold reads the file on the next turn`, 6000);
}
// 🧪 Open Red Witness (C98d) — the unit's guard, the file its row names, opened in the editor; absent → `not on disk — <path>`,
// the same words card 1 paints. The card inspects; it never copies the goal.
async function openGuard() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const { label, guard } = await currentUnitRow(cwd);
    if (!label) { vscode.window.showWarningMessage('Steer: no /goal on the record — install one (📥 Ingest Refined Goal), then this opens the unit\'s guard.'); return; }
    if (!guard) { vscode.window.showWarningMessage(`Steer: row ${label} names no guard — add (guard: \`tests/…\`) to its spec row; the witness must fail red before code lands.`); return; }
    const abs = path.join(cwd, guard);
    const there = await fs.access(abs).then(() => true, () => false);
    if (!there) { vscode.window.showWarningMessage(`Steer ${label}: not on disk — ${guard} · the row names it, the file is not there yet; write it first and see it red.`); return; }
    const doc = await vscode.workspace.openTextDocument(abs);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.setStatusBarMessage(`🧪 ${label} — ${guard} · node --test ${guard}`, 6000);
}
// 🔍 Inspect Halt Reason — the halt row runner.ndjson wrote, in the file's own words, plus the worker's output channel.
async function inspectHalt() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const raw = await fs.readFile(path.join(cwd, '.thetacog', 'runner.ndjson'), 'utf8').catch(() => '');
    const rows = raw.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<{ kind: string; reason?: string; label?: string; at?: string }>;
    const halt = [...rows].reverse().find((r) => r.kind === 'halt');
    runnerOut ??= vscode.window.createOutputChannel('ThetaCog · runner');
    runnerOut.show(true);
    if (!halt) { vscode.window.showInformationMessage('Steer: no halt row on runner.ndjson — the last run did not halt.'); return; }
    runnerOut.appendLine(`── halt · ${halt.at || ''} · ${halt.label || ''} · ${halt.reason || ''}`);
    const pick = await vscode.window.showWarningMessage(`HALTED · ${halt.label || ''} — ${halt.reason || 'no reason recorded'}`, 'Copy the reason', 'Retry Unit');
    if (pick === 'Copy the reason') { await copyOut(cwd, `${halt.label || ''} HALTED — ${halt.reason || ''}`, 'ide:halt-reason'); }
    else if (pick === 'Retry Unit') { await runGoalHeadless(); }
}
// ☁️ Sync tape — C74's tape-sync with the bearer by environment (entitlementEnv), then repaint.
async function syncTape() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Steer: sending the signed rows the notary has not seen…' }, () => run(cwd, 'tape-sync.mjs', ['sync']));
    if (!r.ok) { vscode.window.showWarningMessage(`Steer tape-sync: ${describeFailure(r.out)}`); return; }
    vscode.window.setStatusBarMessage(`☁️ ${r.out.split('\n').filter(Boolean).pop() || 'synced'}`, 8000);
    await vscode.commands.executeCommand('vna.refreshPage');
}
// 📥 Ingest Refined Goal — the clipboard through goal.mjs import --validate --install: the gate refuses or installs, and says which.
// C167: ⚡ Run as Goal in 💬 Local Ideation hands one answer's text here instead of the clipboard — the same gate either way.
async function ingestGoal(given?: string) {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const text = typeof given === 'string' ? given : ((await vscode.env.clipboard.readText()) || '');
    if (!text.trim()) { vscode.window.showWarningMessage('Steer: the clipboard is empty — copy the refined /goal first.'); return; }
    const dir = path.join(cwd, '.thetacog'); await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'goal-from-clipboard.md'); await fs.writeFile(file, text);
    const r = await run(cwd, 'goal.mjs', ['import', '--validate', file, '--install']);
    const last = r.out.trim().split('\n').filter(Boolean);
    if (!r.ok || !/ACCEPTED/.test(r.out)) { vscode.window.showWarningMessage(`Steer goal gate refused: ${describeFailure(r.out)}`); return; }
    vscode.window.showInformationMessage(`Steer: ${last[0] || 'goal installed'} — card 1 shows unit 1`);
    await vscode.commands.executeCommand('vna.refreshPage');
}
// 📋 Copy Run Summary — one line for the team, every term from a receipt (scripts/vna/run-summary.mjs). C133: the LAST stdout
// line is composeLine() — "Verified by ThetaCog: <off-lane>% off-lane (Δ <rings>) · <n> files walked (<kB>) · <sha12> · Time on
// Target <secured|UNSIGNED|UNMEASURED> · <manifesto>" — self-explaining pasted into GitHub or Slack; UNMEASURED per absent receipt.
async function copyRunSummary() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const r = await run(cwd, 'run-summary.mjs', []);
    if (!r.ok) { vscode.window.showWarningMessage(`Steer run-summary: ${describeFailure(r.out)}`); return; }
    const line = r.out.trim().split('\n').filter(Boolean).pop() || '';
    await copyOut(cwd, line, 'ide:run-summary');
    vscode.window.setStatusBarMessage(`📋 ${line}`, 8000);
}

// 🔗 Backup (C102c, operator: "it has to be a post from the extension that posts to our site … we have a bucket set up for that").
// ONE door: backup.mjs --upload bundles the tape + proofs under .thetacog/backup/ and POSTs the archive to /api/backup/upload with
// the entitlement as the bearer (NOTARY_BEARER by environment, never argv); the site answers the receipt and the manifest URL,
// which is printed on the card. No save dialog, no path shown, nothing written outside .thetacog/. Without a key the door says
// so and points at the 💳 (C102a) — the upload is receipted to an account.
async function backupTape() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const bearer = await bearerEnv();
    if (!bearer.NOTARY_BEARER) { vscode.window.showWarningMessage('Steer backup: no key in this window yet — 💳 Fund Autonomy Ledger first; the backup is receipted to your account.'); return; }
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Steer: bundling the tape and posting it to thetadriven.com…' },
        () => run(cwd, 'backup.mjs', ['--upload', '--json'], bearer));
    let u: { ok: boolean; sha: string | null; url: string | null; why?: string; replay?: boolean; bytes?: number; countersigned_at?: string; at_source?: string };
    try { u = JSON.parse(lastJsonLine(r.out)); if (!u || typeof u.ok !== 'boolean') { throw new Error('no result'); } }
    catch { vscode.window.showWarningMessage(`Steer backup.mjs printed no result: ${describeFailure(r.out)}`); return; }
    if (!u.ok) { vscode.window.showWarningMessage(`Steer backup: not posted — ${u.why || describeFailure(r.out)}`); return; }
    // C135 — the exact instant of the lock, off the receipt (countersigned_at · at_source: server | header | local), flashed once
    // as a message and held 8 s on the status bar. A fact off the receipt; nothing here promises what the lock does.
    const line = `🔗 countersigned ${u.countersigned_at || 'at UNMEASURED'}${u.at_source && u.at_source !== 'server' ? ` (${u.at_source} clock)` : ''} · posted ${(u.sha || '').slice(0, 12)} · ${((u.bytes || 0) / 1048576).toFixed(1)} MB${u.replay ? ' · already held' : ''} · ${u.url}`;
    vscode.window.setStatusBarMessage(line, 8000);
    void vscode.window.showInformationMessage(line);
    await vscode.commands.executeCommand('vna.refreshPage');   // the card reads the upload receipt (backupCardLine) on the repaint
}

// 🔏 Sign this tape (the free door of the three, C105/C97e): the last authored commit's row (C309b) appended to the tape under your own key — local, no
// credit, nothing leaves the machine (auth-flow.mjs sign --sha authored; the licence stamp rides only when a key with credits is held).
async function signTape() {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    const r = await run(cwd, 'auth-flow.mjs', ['sign', '--sha', 'authored', '--json']);   // C309b: the last authored commit, never the hook's chore(commit-page)
    if (!r.ok) { vscode.window.showWarningMessage(`Steer sign: ${describeFailure(r.out)}`); return; }
    let j: { line?: string; seq?: number; row_sha?: string } | null = null; try { j = JSON.parse(lastJsonLine(r.out)); } catch { j = null; }
    vscode.window.setStatusBarMessage(`🔏 ${(j && j.line) || 'the last authored commit signed onto the tape'}`, 8000);
    await vscode.commands.executeCommand('vna.refreshPage');
}

export function registerVnaSteer(context: vscode.ExtensionContext) {
    // C91c — the eviction follows the RECEIPT the hook writes, never a clock
    const decisionWatch = vscode.workspace.createFileSystemWatcher('**/.thetacog/vna-clear-decision.json');
    const onDecision = () => { void evictOnGoalClose(context); };
    decisionWatch.onDidChange(onDecision); decisionWatch.onDidCreate(onDecision);
    context.subscriptions.push(decisionWatch);
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.steer', () => steer(context)),
        vscode.commands.registerCommand('vna.run.cockpit', () => runSection('cockpit')),
        vscode.commands.registerCommand('vna.run.envelope', () => runSection('envelope')),
        vscode.commands.registerCommand('vna.run.spec', () => runSection('spec')),
        vscode.commands.registerCommand('vna.run.net', () => runSection('net')),
        vscode.commands.registerCommand('vna.run.specTree', () => runSection('spectree')),
        vscode.commands.registerCommand('vna.pasteToTree', () => pasteToTree()),
        vscode.commands.registerCommand('vna.clearClaudeTerminal', () => clearClaudeTerminal()),
        vscode.commands.registerCommand('vna.runGoal', () => runGoalHeadless()),
        vscode.commands.registerCommand('vna.abortGoal', () => abortGoal()),
        // C79e — the runner paused on drift: the developer's two inline actions, each recorded on runner.ndjson, then run again
        vscode.commands.registerCommand('vna.amendBasin', () => laneAction('amend')),
        vscode.commands.registerCommand('vna.revertDrift', () => laneAction('revert')),
        vscode.commands.registerCommand('vna.copyGoal', () => copyGoal()),
        vscode.commands.registerCommand('vna.backupTape', () => backupTape()),
        vscode.commands.registerCommand('vna.signTape', () => signTape()),   // C105 the free door — 🔏 Sign this tape
        // C89b — the buttons the copy contract added: each one a door onto a script that already exists, never a new mechanism
        vscode.commands.registerCommand('vna.viewUnit', (label?: unknown) => viewUnit(label)),   // C109e: a clicked row id opens that row
        vscode.commands.registerCommand('vna.openFile', (rel?: unknown) => openFile(rel)),   // C109e: a receipt path on the page opens the file, inside the repo only
        vscode.commands.registerCommand('vna.openGuard', () => openGuard()),   // C98d — the unit's red witness, off its own row
        // C103f — the card is a link: one handler, six doors named literally (LINK 1 reads the registrations by name); viewUnit and openSpec already exist
        vscode.commands.registerCommand('vna.openWalk', () => openDoc('vna.openWalk')),
        vscode.commands.registerCommand('vna.openCog', () => openDoc('vna.openCog')),
        vscode.commands.registerCommand('vna.openRunLog', () => openDoc('vna.openRunLog')),
        vscode.commands.registerCommand('vna.openTape', () => openDoc('vna.openTape')),
        vscode.commands.registerCommand('vna.openBridge', () => openDoc('vna.openBridge')),
        vscode.commands.registerCommand('vna.openTree', () => openDoc('vna.openTree')),
        vscode.commands.registerCommand('vna.inspectHalt', () => inspectHalt()),
        vscode.commands.registerCommand('vna.syncTape', () => syncTape()),
        vscode.commands.registerCommand('vna.ingestGoal', (text?: unknown) => ingestGoal(typeof text === 'string' ? text : undefined)),
        vscode.commands.registerCommand('vna.copyRunSummary', () => copyRunSummary()),
        vscode.commands.registerCommand('vna.toggleCheck', async () => {
            const cwd = root(); if (!cwd) { return; }
            await toggleCheck(cwd);
        }),
        vscode.commands.registerCommand('vna.openSteerPage', async () => {
            const cwd = root(); if (!cwd) { return; }
            await showPage(cwd);
        }),
    );
}
