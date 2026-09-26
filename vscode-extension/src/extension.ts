// packages/thetacog-mcp-vscode/src/extension.ts — the host.
//
// ThetaCog MCP · ThetaDriven Inc. This extension carries the VNA instruments: the ballistic walk on
// the chip, the three encircled panels, the 144-cell lattice, the checkbox spec, and both arms of
// the drift envelope. It computes NOTHING of its own — every number comes from a script in
// scripts/vna/, which is the running code, and this host spawns them and renders what comes back.
// A second implementation in TypeScript would fork the receipt, and a forked receipt is a second
// answer to a question that must have exactly one.
//
// WHAT WAS REMOVED AND WHY IT IS NOT COMING BACK. v0.1 shipped as "IntentGuard — AI Trust Score"
// and painted a CONSTANT into the status bar: grade 'B+', score 847, and one invented
// `src/agents/booking.ts:42` drift zone, identical in every workspace and in every session, beside a
// `// TODO: Replace with actual intentguard CLI integration`. A number that never moves is a control
// wired to nothing — fabrication wearing a UI — and it sat in the same status bar as instruments
// whose entire claim is that their numbers are computed from a commit. The mock went in 0.1.x; its
// two commands and its settings go here, because a command that reports "not wired" forever is the
// same defect with better manners.
//
// THE STATUS BAR NOW READS A RECEIPT. It shows where the last walked commit landed, or it says the
// walk has not been run. It never computes the placement itself and never fills the gap with a
// pleasant default.
//
// LLM-FREE: nothing in this extension calls a model.
import * as vscode from 'vscode';
import * as path from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';   // C124: the code version is read beside out/, never from context.extension · C203: the render-owner lock
import { execFile } from 'child_process';
import { doorCommand } from './commands';   // C94b: THE ONE COMMAND TABLE — every child this host spawns is resolved there
import { makeCoalescer } from './render-coalesce';   // ONE render in flight · trailing ≥ 2 s · max-wait ceiling · skips counted (2026-09-20 render storm)
import { tryAcquire, LOCK_NAME } from './render-owner';   // C203 (3): ONE render per machine — a second IDE host repaints from the page the owner writes
import { RECEIPT_GLOB } from './receipt-globs';   // C109l: every receipt the steer page reads, GENERATED from steer-ui.mjs's RECEIPT_PATHS — never re-typed here
import { registerVnaCockpit, setSurface } from './vna-cockpit';
import { registerVnaSteer } from './vna-steer';
import { registerVnaTail } from './vna-tail';
import { registerVnaAperture } from './vna-aperture';   // C116: 🔍 View Aperture Receipt — a read-only native document on the steer scheme
import { registerVnaRecompute } from './vna-recompute';   // C241: 🔁 Recompute this receipt — the stranger's door: re-derive a receipt from its immutable commit, one pasteable line
// the repaint policy (render-coalesce.ts): trailing edge ≥ 2 s, forced at most every RENDER_MAX_WAIT_MS while the tape stays busy
const RENDER_DEBOUNCE_MS = 2000;
const RENDER_MAX_WAIT_MS = 8000;
import { registerVnaClip } from './vna-clip';
import { registerVnaEngines, engineKeyRowsEnv, runnerEnv } from './vna-engines';   // C166: ⚙️ Engines & Keys — the runner's engine + the SecretStorage keys · C239: the fp8 rows ride EVERY render door, never only vna-steer.ts's · C239a: runnerEnv is wired into the chat's steer door below
import { setRunnerEnvDoor } from './vna-chat-inline';   // C239a: the chat host's steer.mjs spawns take their env through this injected door (the module itself must stay loadable without vscode)
import { registerVnaChat } from './vna-chat';   // C167: 💬 Local Ideation — the sidebar chat to the local engine, a relay that keeps no transcript
import { registerVnaEngineLifecycle } from './vna-engine-lifecycle';   // C167e: ⏵ Boot / ⏹ Halt the local engine itself, from the pill
import { registerAuthManager, entitlementEnv, setExtensionVersion, parseAuthReturn, ingestEntitlement } from './auth-manager';
import { VnaViewProvider } from './vna-view';
import { initStatus, statusFromReceipt, statusFromPrompt } from './status';

let watcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
    // C124 — three versions. context.extension.packageJSON is what the WINDOW registered when it opened; the package.json beside
    // this out/ is what the host actually loaded. They diverge after every install until Developer: Reload Window — and a webview
    // whose id changed in between (thetacog.surface → thetacog.steer, 2026-09-20) spins forever, so the warning must come from
    // OUTSIDE the pane: a toast with the one button, and a status-bar item that stays until the reload.
    let codeVersion: string | undefined;
    try { codeVersion = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version; } catch { codeVersion = undefined; }
    const windowVersion: string | undefined = context.extension?.packageJSON?.version;
    setExtensionVersion(windowVersion, codeVersion);   // the strip's lifecycle line reads both through entitlementEnv()
    if (codeVersion && windowVersion && codeVersion !== windowVersion) {
        const stale = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
        stale.text = `$(refresh) ThetaCog: reload window (${windowVersion} → ${codeVersion})`;
        stale.tooltip = 'The window registered an older manifest than the code it is running. Developer: Reload Window re-reads it; Restart Extensions cannot.';
        stale.command = 'vna.reloadWindow';
        stale.show();
        context.subscriptions.push(stale);
        void vscode.window.showWarningMessage(`ThetaCog: this window holds manifest v${windowVersion} but runs code v${codeVersion} — Reload Window to mount it (Restart Extensions is not enough)`, 'Reload Window')
            .then(pick => { if (pick === 'Reload Window') { void vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
    }
    console.log('ThetaCog MCP (VNA) is active');

    // Each instrument registers behind its own try: one broken panel must never take the others
    // down with it, and an extension that fails to activate reports nothing at all.
    try { registerVnaCockpit(context); }
    catch (e) { console.error('VNA cockpit failed to register:', e); }

    try { registerAuthManager(context); } catch (err) { console.error('VNA auth-manager failed to register —', err); }
    try { registerVnaSteer(context); }
    catch (e) { console.error('VNA steer failed to register:', e); }

    // An append to GoalNegSp.txt is a SPEC AMENDMENT, never a command. This makes one impossible to
    // miss and retains it in a tracked ledger, and is incapable of acting on it.
    try { registerVnaTail(context); }
    catch (e) { console.error('VNA tail failed to register:', e); }

    // C116 — the aperture receipt as a read-only native document (steer://aperture/receipt.json), beside the editor
    try { registerVnaAperture(context); }
    catch (e) { console.error('VNA aperture failed to register:', e); }

    // C241 — the recompute door: re-derive a receipt from the immutable commit through scripts/vna/recompute-receipt.mjs, beside the editor
    try { registerVnaRecompute(context); }
    catch (e) { console.error('VNA recompute failed to register:', e); }

    // A copy anywhere on the machine appends to the steer file while armed (C35). Two commands that
    // flip the flag; the daemon (scripts/vna/clip-watch.mjs) is the one reader and the one writer.
    try { registerVnaClip(context); }
    catch (e) { console.error('VNA clip failed to register:', e); }

    // ONE status item, owned here. Two modules used to create their own, so the bar carried the word
    // VNA twice and, on a failure, two contradicting claims side by side — which is how a reader
    // learns to ignore a status bar.
    initStatus(context);
    try { registerVnaEngines(context); setRunnerEnvDoor(runnerEnv); } catch (e) { console.error('VNA engines failed to register:', e); }   // C239a: from here on a /steer typed into the chat spawns on the ⚙️ keys
    try { registerVnaChat(context); } catch (e) { console.error('VNA chat failed to register:', e); }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try { registerVnaEngineLifecycle(context, cwd); } catch (e) { console.error('VNA engine lifecycle failed to register:', e); }
    void statusFromReceipt(cwd);

    // THE SURFACE — a side panel in the activity bar rather than an editor tab. A tab competes with
    // the code for the same space and closes when you are done reading; this sits beside the work all
    // day and answers "where am I" without being opened.
    const view = new VnaViewProvider(cwd, context);
    setSurface(view);   // the cockpit / envelope / preview pages render HERE, never in an editor column
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(VnaViewProvider.viewType, view,
        { webviewOptions: { retainContextWhenHidden: true } }));

    // ONE DOOR, TWO SURFACES. `/steer` and `steer-ui.mjs` open the IDE when an editor is running and
    // the browser when it is not — the operator's shape, and the reason this handler exists: a CLI
    // cannot focus a view, but it can open a URI, and VS Code routes that back here.
    context.subscriptions.push(vscode.window.registerUriHandler({
        handleUri(uri: vscode.Uri) {
            // The path selects the surface; anything unrecognised focuses the panel rather than
            // failing silently, because a door that does nothing is worse than a door to the wrong room.
            // C83b — THE RETURN DOOR: the site sends the browser back here after checkout with the licence on the
            // query string. It is verified (auth-flow.mjs verify, against the site's own key) before it is ever
            // trusted — a refusal shows its reason and stores nothing; the webview never sees the token itself.
            if (uri.path === '/auth') {
                const parsed = parseAuthReturn(uri.query);
                if ('jwt' in parsed) { void ingestEntitlement(context, parsed.jwt, 'uri'); }
                else { vscode.window.showWarningMessage(`Steer: the return URI carried no licence — ${parsed.error}`); }
                return;
            }
            if (uri.path === '/cockpit') { void vscode.commands.executeCommand('vna.openCockpit'); return; }
            if (uri.path === '/preview') { void vscode.commands.executeCommand('vna.preview'); return; }
            // `/page`: the sensors ALREADY ran on the CLI side (steer-ui.mjs opens this by default when
            // the IDE is up, 2026-09-17); the view re-reads the file that was just written, so this
            // only brings the sidebar forward. Re-running here would be a second walk for one page.
            if (uri.path === '/page') { void vscode.commands.executeCommand('thetacog.steer.focus'); return; }
            void vscode.commands.executeCommand('thetacog.steer.focus');
            void vscode.commands.executeCommand('vna.steer');
        },
    }));

    // Both the bar and the panel follow the RECEIPTS, so a walk run in a terminal updates them.
    // Watching a file costs nothing; recomputing would cost a chip walk and would be a second answer
    // to the same question.
    // …and the steer PAGE: steer-ui.mjs writes it, this view renders it. The command that ran the
    // sensors only focuses the view afterwards; the page reaches it by this watcher, the same route a
    // terminal `node scripts/vna/steer-ui.mjs` takes.
    const pageWatcher = vscode.workspace.createFileSystemWatcher('**/docs/specs/vna/steer/latest.html');
    pageWatcher.onDidChange(() => void view.refresh()); pageWatcher.onDidCreate(() => void view.refresh());
    context.subscriptions.push(pageWatcher);
    // AUTO-REFRESH (operator 2026-09-17: "refresh button or auto refresh on the button"): when a row
    // lands on the amendments tape, the clipboard arms or disarms, or the spec tree changes, RE-RENDER
    // the page (steer-ui.mjs --no-open: reads receipts, paints, ≈200 ms, walks nothing) and the page
    // watcher above repaints the panel. Debounced, because a clipboard burst is many rows in a second.
    // A render that fails is logged and the last page stays — never a blank panel over a bad run.
    // THE RENDER STORM (2026-09-20, load 166–242): this debounce had no in-flight guard, so a fold storm writing the tape every
    // second stacked four steer-ui.mjs at once (one at 1.4 GB RSS). Now ONE render in flight, a trailing edge of
    // RENDER_DEBOUNCE_MS, a ceiling of RENDER_MAX_WAIT_MS so a tape that never pauses still repaints, and a timer that fires
    // mid-render is RECORDED as skipped (the plugin's own log line) and folded into one trailing render. render-coalesce.ts.
    // C203 — THE REFRESH IS ONE VISIBLE PATTERN. (1) Every request below NAMES the watcher that armed it; the coalescer joins
    // the names of one render ('runner+goal') and they reach steer-ui.mjs as VNA_RENDER_CAUSE, so the page can print its own
    // last repaint and its cause rather than the operator inferring it. (3) ONE OWNER PER MACHINE: VS Code and Cursor on the
    // same repo each ran these watchers, so every event rendered twice; a lock beside latest.html makes the second host's
    // request a no-op — it repaints from the page the owner writes (the pageWatcher above), which is all it ever needed.
    const lockPath = cwd ? path.join(cwd, 'docs', 'specs', 'vna', 'steer', LOCK_NAME) : '';
    const lockIO = {
        read: () => { try { return existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null; } catch { return null; } },
        write: (t: string) => { try { writeFileSync(lockPath, t); } catch (e) { console.warn('VNA auto-refresh: lock not written —', String(e).slice(0, 120)); } },
        remove: () => { try { unlinkSync(lockPath); } catch { /* already gone */ } },
        alive: (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } },
    };
    const pageRender = makeCoalescer({ delayMs: RENDER_DEBOUNCE_MS, maxWaitMs: RENDER_MAX_WAIT_MS, label: 'steer-ui.mjs', log: (l) => console.warn(l), run: (done, cause) => {
        const c = doorCommand(cwd, 'scripts/vna/steer-ui.mjs', ['--no-open']);   // C94b: the table — node scripts/vna/steer-ui.mjs at home, npx thetacog-mcp steer-ui away
        if (!c.runnable) { console.error('VNA auto-refresh:', c.display); done(); return; }
        const owner = tryAcquire(lockIO, { pid: process.pid, host: vscode.env.appName, cause });
        if (!owner.held) { console.warn(`Steer steer-ui.mjs: not spawned — ${owner.owner.host} (pid ${owner.owner.pid}) owns the render since ${new Date(owner.owner.start).toISOString()} · cause ${owner.owner.cause}; this host repaints from its page`); done(); return; }
        // C239: this is the door that paints the page on every receipt, prompt and the refresh button — it carried entitlementEnv() but not
        // engineKeyRowsEnv(), so the page it wrote blanked the 🔑 Engine keys pill ("set or check keys") while the key sat in SecretStorage
        execFile(c.file, c.args, { cwd, timeout: 60000, env: { ...process.env, ...entitlementEnv(), ...engineKeyRowsEnv(), VNA_RENDER_CAUSE: cause, VNA_RENDER_HOST: vscode.env.appName } },
            (err, _out, stderr) => { owner.release(); if (err) { console.error('VNA auto-refresh: steer-ui.mjs failed —', (stderr || err.message).slice(0, 200)); } done(); });
    } });
    const rerenderSoon = (cause: string) => { if (cwd) { pageRender.request(cause); } };
    // the feed watcher covers three files; the cause names the one that moved, never the glob
    const feedCause = (uri: vscode.Uri) => { const f = uri.fsPath; return f.endsWith('amendments.ndjson') ? 'amendments' : f.endsWith('vna-clip.armed') ? 'clip' : f.endsWith('spec-tree.json') ? 'spec-tree' : 'feed'; };
    // C23 — THE PROMPT TURN: the prompt-lens hook writes .thetacog/lens-encircled/latest.json on every prompt; the page's
    // fourth tile (LAST PROMPT · lens walk) and the status bar read it. The handler re-renders the page through the same
    // debounced door every feed uses and updates the status bar from the receipt — it spawns nothing of its own.
    const promptWatcher = vscode.workspace.createFileSystemWatcher('**/.thetacog/lens-encircled/latest.json');
    const onPrompt = () => { rerenderSoon('prompt'); void statusFromPrompt(cwd); };
    promptWatcher.onDidChange(onPrompt); promptWatcher.onDidCreate(onPrompt);
    context.subscriptions.push(promptWatcher);
    const feed = vscode.workspace.createFileSystemWatcher('**/{docs/specs/vna/amendments.ndjson,.thetacog/vna-clip.armed,data/vna/spec-tree.json}');
    // NOT BLIND (operator 2026-09-18: "we need a button to refresh the side panel, what else to not be blind?"): a runner
    // verdict or a goal change repaints too (the RUNNING line read stale until the next paste), and one command repaints on demand.
    const runnerWatch = vscode.workspace.createFileSystemWatcher('**/.thetacog/runner.ndjson');
    const onRunner = () => rerenderSoon('runner');
    runnerWatch.onDidChange(onRunner); runnerWatch.onDidCreate(onRunner); context.subscriptions.push(runnerWatch);
    const goalWatch = vscode.workspace.createFileSystemWatcher('**/data/vna/goal.json');
    const onGoal = () => rerenderSoon('goal');
    goalWatch.onDidChange(onGoal); goalWatch.onDidCreate(onGoal); goalWatch.onDidDelete(onGoal); context.subscriptions.push(goalWatch);
    // C109l — THE PANEL UPDATES OR SAYS IT DID NOT: the named watchers above covered eight receipts while the page read ~50, so a
    // receipt outside that set (cockpit-preview, the flight tape, credits, the notary witness, asked-vs-built, cog …) repainted only on
    // the next unrelated event. This watcher is the whole list, generated from the render's own RECEIPT_PATHS; the ones a named watcher
    // already carries are skipped so the cause stays the named one. A receipt it still misses shows as PAGE STALE on the heartbeat.
    const receiptWatch = vscode.workspace.createFileSystemWatcher(RECEIPT_GLOB);
    const NAMED = /(lens-encircled\/latest\.json|amendments\.ndjson|vna-clip\.armed|spec-tree\.json|runner\.ndjson|goal\.json)$/;
    const onReceipt = (u: vscode.Uri) => { if (!NAMED.test(u.fsPath)) { rerenderSoon(`receipt:${path.basename(u.fsPath)}`); } };
    receiptWatch.onDidChange(onReceipt); receiptWatch.onDidCreate(onReceipt); receiptWatch.onDidDelete(onReceipt); context.subscriptions.push(receiptWatch);
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.refreshPage', () => { rerenderSoon('refresh button'); vscode.window.setStatusBarMessage('Steer: repainting the side panel from receipts', 2500); }),
        vscode.commands.registerCommand('vna.reloadWindow', () => vscode.commands.executeCommand('workbench.action.reloadWindow')),
    );
    const onFeed = (u: vscode.Uri) => rerenderSoon(feedCause(u));
    feed.onDidChange(onFeed); feed.onDidCreate(onFeed); feed.onDidDelete(onFeed);
    context.subscriptions.push(feed);
    // C79d — THE PER-TURN LIVE PREVIEW: between commits the three panels show the working tree. Watch the code the developer
    // (or a worker) is writing — scripts/ · src/ · tests/ — never .thetacog, data or public, which the preview itself writes;
    // 500 ms after the LAST change run cockpit.mjs --reality tree --no-open (C25: its own receipt, never cockpit.json); the
    // page watcher repaints when steer-ui re-renders on the preview receipt. A failed preview is logged, the last one stands.
    const treeWatch = vscode.workspace.createFileSystemWatcher('**/{scripts,src,tests}/**/*.{mjs,js,ts,tsx,rs,md,json}');
    // The same rule (one place): the preview walked the working tree 500 ms after every file change and, while busy, polled
    // itself every 500 ms — under twelve sessions editing, one cockpit render was alive continuously. Same coalescer.
    const preview = makeCoalescer({ delayMs: RENDER_DEBOUNCE_MS, maxWaitMs: RENDER_MAX_WAIT_MS, label: 'cockpit.mjs --reality tree', log: (l) => console.warn(l), run: (done) => {
        const c = doorCommand(cwd, 'scripts/vna/cockpit.mjs', ['--reality', 'tree', '--no-open']);
        if (!c.runnable) { console.error('VNA live preview:', c.display); done(); return; }
        execFile(c.file, c.args, { cwd, timeout: 120000, env: { ...process.env, ...entitlementEnv(), ...engineKeyRowsEnv() } },   // C239: same rows as every other render door
            (err, _out, stderr) => { if (err) { console.error('VNA live preview: cockpit.mjs --reality tree failed —', (stderr || err.message).slice(0, 200)); } else { rerenderSoon('preview'); } done(); });
    } });
    const previewSoon = () => { if (cwd) { preview.request(); } };
    treeWatch.onDidChange(previewSoon); treeWatch.onDidCreate(previewSoon); treeWatch.onDidDelete(previewSoon);
    context.subscriptions.push(treeWatch);
    watcher = vscode.workspace.createFileSystemWatcher('**/data/vna/{cockpit,envelope}.json');
    const onChange = () => { void statusFromReceipt(cwd); void view.refresh(); };
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    context.subscriptions.push(watcher);
}
