// packages/thetacog-mcp-vscode/src/vna-chat.ts — C167 💬 STEER CHAT (was Local Ideation (Qwen / Goose) until C201a: the name is the function, never the vendor): the sidebar chat to the local engine
// (unit 2 of docs/specs/vna/SPEC-MULTI-ENGINE.md, basin Tactics.Signal × Ops.Loop B3,C2).
//
// A WEBVIEW VIEW IN THE THETACOG CONTAINER, UNDER THE STEER PAGE — never an editor tab, so it never takes a column or the editor's focus;
// vna.openChat reveals it with preserveFocus. retainContextWhenHidden keeps the page (and so the conversation, which lives ONLY in the
// page's memory — media/chat.js) alive while the view is collapsed.
//
// THE HOST IS A RELAY. Each turn the page posts its whole history; this file hands it to media/chat-core.js streamChat (async
// fetch to http://localhost:11434, or the OLLAMA_HOST the ⚙️ Engines pill stored in SecretStorage), posts each token back, and
// drops the array from ITS OWN memory. No globalState for messages, no runner, no tape: the only thing remembered here across
// restarts is the tag the user PICKED (a selection) and, since C167h, the transcript itself — appendChatTurn/readChatHistory
// (vna-chat-inline.ts) write and read the ONE shared file, .thetacog/chat/session.ndjson, so this pop-out view and the steer
// page's inline form show the same history whichever is opened, and 🧹 Clear now empties that file too. The engine is called
// only on the page's `send` — the user's press is the explicit ask.
// 📋 Copy goes through copyOut (vna-view.ts), the one clipboard door: stamped, so an armed auto-paste never folds a copied answer back in.
//
// THE ONE CORE. media/chat-core.js is the same file the page, scripts/vna/chat-bridge.mjs (the steer page's 🟢/🔴 probe) and the
// guards load — tests/vna/c167-local-chat-webview-the-sidebar-chat.test.mjs runs it against a fake ollama server.
import * as vscode from 'vscode';
import * as path from 'path';
import { writeFileSync, mkdirSync } from 'fs';   // the probe receipt only (core.probeReceipt — a whitelist, never a message): the steer page's 💬 pill reads the tag picked here
import { copyOut } from './vna-view';   // the ONE clipboard door: it stamps the copy so auto-paste never folds it back in (only 🌳 Fold to Tree moves chat text)
import { appendChatTurn, readChatHistory, clearChatHistory, steerLineOf, runSteerVerb, workersLineOf, runWorkersVerb, runKeepVerb, appendChatCot, buildCapabilities, actOnModelReply, chatContextFor, hostAnswerKind, writeCapabilities, TOOL_REFUSAL, STEER_VERB_LIST, HELP_RE, loadHouseMenu, loadHouseMenuText, runHouseDoor, typedDoorIdOf, routeHouseAsk, routedDoorHead } from './vna-chat-inline';
import { resolverStatus, setSubagentModel, setSubagentHands, claudeKeyRow, thinkingLabels } from './vna-engines';   // C201 — the 🤖 subagent dropdown reads/writes through the resolver's ONE writer, never a second one   // C167h — the shared transcript both surfaces read/write, so pop-out ↔ inline and a reload show the same history   // C205(a) — claude -p's own key-held fingerprint

const VIEW_ID = 'thetacog.chat';
const MODEL_KEY = 'vna.chat.model';            // the picked tag — a selection
const OLLAMA_SLOT = 'vna.engine.OLLAMA_HOST';   // C166's SecretStorage slot, read-only here
const WAIT_MS = Number(process.env.VNA_CHAT_TIMEOUT_MS) || 15000;   // C224 — the same 15 s first-token bar the inline form uses (C167i)
const DOORS = new Set(['vna.clipIngest', 'vna.ingestGoal']);   // the only commands a chat message may hand text to

let ctx: vscode.ExtensionContext | null = null;
let core: any = null;
let view: vscode.WebviewView | undefined;
const inflight = new Map<number, AbortController>();

const host = async (): Promise<string> => ((ctx && await ctx.secrets.get(OLLAMA_SLOT)) || core.DEFAULT_HOST);
const requested = (): string => (ctx && ctx.globalState.get<string>(MODEL_KEY)) || vscode.workspace.getConfiguration('vna').get<string>('chat.model') || core.FALLBACK_MODEL;
const post = (m: Record<string, unknown>) => { void view?.webview.postMessage(m); };

async function sendProbe(): Promise<void> {
    // C298 (2) — the page's host-only words come FROM the host, never a second copy on the page: the steer verbs (STEER_VERBS) and
    // the help words (HELP_RE), posted before the probe's network wait so the first keystroke already routes by the one list
    post({ type: 'hostRules', steerVerbs: [...STEER_VERB_LIST], help: { source: HELP_RE.source, flags: HELP_RE.flags } });
    const p = await core.probe({ host: await host() });
    const s = await resolverStatus();   // C201: the subagent tag + which engine dispatches, off runner-resolver.mjs status --json
    const keyRow = await claudeKeyRow();   // C205(a): claude -p shows its own key state — held (fp8) or "no key" — never blocked on it
    post({ type: 'probe', probe: p, requested: requested(), sub: s ? { model: s.subagentModel || null, fallback: (s.localRoles && s.localRoles.subagent) || null, engine: s.name || s.preset || null, local: s.local, keyRow, claudeModel: s.claudeModel || null, claudeModels: s.claudeModels || null, thinking: thinkingLabels([...(p.models || []), requested(), s.subagentModel, s.localRoles && s.localRoles.subagent], s.thinkingRules) } : null });   // C285: each tag's label, off the resolver's one table
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (cwd) { try { mkdirSync(path.join(cwd, '.thetacog'), { recursive: true }); writeFileSync(path.join(cwd, '.thetacog', 'chat-probe.json'), JSON.stringify(core.probeReceipt(p, requested())) + '\n'); } catch { /* the pill reads the last receipt or says not probed */ } }
    // C167h PERSISTENCE — the shared transcript, read on every open/reload/refresh so this pop-out view shows the same
    // history the inline form does (and vice-versa): the two surfaces are windows onto one file, never two memories
    post({ type: 'chatHistory', turns: readChatHistory(cwd) });
}

// C250 — the engines pill: what Ollama holds for both roles (workers.mjs engines — GET /api/ps, the bytes and the context each model
// was loaded with) and the ⏹ End all door behind the + (workers.mjs end-all — C293: endAllLocal, every local-LLM process, then keep_alive 0 per model)
async function sendEngines(cwd: string | undefined): Promise<void> {
    const s = await resolverStatus();
    const sub = (s && (s.subagentModel || (s.localRoles && s.localRoles.subagent))) || '';
    const r = await runWorkersVerb(cwd, ['engines', '--json', '--chat', requested(), ...(sub ? ['--sub', String(sub)] : [])]);
    let j: any = null; try { j = JSON.parse(r.out); } catch { /* a non-JSON answer is shown as text */ }
    post({ type: 'engines', ok: !!j, face: j ? j.face : 'engines UNMEASURED', lines: j ? j.lines : [r.out.trim().slice(0, 300)], roles: j ? j.roles || null : null, running: j ? j.running || 0 : 0 });
    // C277 — the ↻ box reads the keep file + the one readout, so a reload keeps the tick and the face shows landed/dispatched
    const k = await runKeepVerb(cwd, ['status', '--json']); let kj: any = null; try { kj = JSON.parse(k.out); } catch { /* shown as unread */ }
    post({ type: 'keep', on: !!(kj && kj.on), face: kj ? kj.face : '↻ unread', alive: !!(kj && kj.daemon_alive) });
}

async function onMessage(m: any): Promise<void> {
    if (!m || !ctx) { return; }
    if (m.type === 'ready' || m.type === 'probe') { await sendProbe(); await sendEngines(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath); return; }
    if (m.type === 'engines') { await sendEngines(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath); return; }
    if (m.type === 'keepRunning') { const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; const r = await runKeepVerb(cwd, [m.on ? 'on' : 'off', '--by', 'ui-checkbox']); post({ type: 'keepDone', ok: r.ok, text: r.out.trim() }); await sendEngines(cwd); return; }   // C277
    if (m.type === 'endAll') {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        for (const c of inflight.values()) { c.abort(); } inflight.clear();   // a streaming chat would reload its model the moment it was unloaded
        const s = await resolverStatus(); const sub = (s && (s.subagentModel || (s.localRoles && s.localRoles.subagent))) || '';   // C250h — the selected tags, the same ones the pill reads
        const r = await runWorkersVerb(cwd, ['end-all', '--chat', requested(), ...(sub ? ['--sub', String(sub)] : [])]);
        post({ type: 'endAllDone', ok: r.ok, text: r.out.trim() });
        await sendEngines(cwd); await sendProbe(); return;
    }
    if (m.type === 'model' && typeof m.model === 'string') { await ctx.globalState.update(MODEL_KEY, m.model); await sendProbe(); return; }
    // C205 — the 🤖 dropdown's door: claude -p → claude-code-headless, a local tag → goose-local + that tag (one writer, runner-resolver.mjs)
    if (m.type === 'subHands' && typeof m.value === 'string') { const r = await setSubagentHands(m.value); if (!r.ok) { vscode.window.showWarningMessage(`🤖 subagent hands refused — ${r.why}`); } await sendProbe(); return; }
    if (m.type === 'subModel' && typeof m.tag === 'string') { const r = await setSubagentModel(m.tag); if (!r.ok) { vscode.window.showWarningMessage(`🤖 subagent model refused — ${r.why}`); } await sendProbe(); return; }
    if (m.type === 'stop') { inflight.get(Number(m.id))?.abort(); return; }
    if (m.type === 'copy' && typeof m.text === 'string') { await copyOut(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, m.text, 'ide:chat-copy'); vscode.window.setStatusBarMessage('📋 copied from 💬 Steer chat', 3000); return; }
    // C167h: 🧹 Clear now empties the shared file too, not only this view's own memory — the inline form must not still show
    // a transcript the operator just cleared here (this WIDENS the original "posts nothing to the host" contract on purpose)
    if (m.type === 'clear') { clearChatHistory(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath); return; }
    if (m.type === 'send' && Array.isArray(m.messages)) {
        const id = Number(m.id); const ctl = new AbortController(); inflight.set(id, ctl);
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const userTurn = m.messages[m.messages.length - 1]; if (userTurn && userTurn.role === 'user') { appendChatTurn(cwd, 'user', String(userTurn.content || '')); }
        // C201 (operator: "where is steer?") — `/steer <verb>` or a bare steer verb runs steer.mjs on the host and streams it here,
        // the same route the steer page's inline form takes; it never goes to the model, which can only talk about /steer
        // C210: `/steer <any text>` too — the /steer door itself (declare · goal · dispatch), not only the named verbs
        // C224 — `/workers` lists the running /steer workers, `/end <n|row|all>` ends them; host-run, never the model
        const wl = userTurn && userTurn.role === 'user' ? workersLineOf(String(userTurn.content || '')) : null;
        if (wl) {
            const t0 = Date.now(); const r = await runWorkersVerb(cwd, wl);
            inflight.delete(id); appendChatTurn(cwd, 'assistant', r.out);
            post({ type: 'done', id, ok: r.ok, text: r.out, error: r.ok ? undefined : r.out.split('\n')[0], steer: 'workers', ms: Date.now() - t0 });
            return;
        }
        const line = userTurn && userTurn.role === 'user' ? steerLineOf(String(userTurn.content || '')) : null;
        const verb = line ? line[0] : null;
        if (line && verb) {
            const t0 = Date.now(); const r = await runSteerVerb(cwd, verb, (s) => post({ type: 'token', id, t: s }), line.slice(1), ctl.signal);   // C217: ⏹ reaches the child
            inflight.delete(id); if (r.out) { appendChatTurn(cwd, 'assistant', r.out); }
            post({ type: 'done', id, ok: r.ok, text: r.out || r.error || '', error: r.error, steer: verb, ms: Date.now() - t0 });
            return;
        }
        // C298 (1) — `help` is answered by the host and a tool-shaped ask is refused, BEFORE the model — the same rule
        // handleChatInline asks (hostAnswerKind, one place). Asked only here, after the /workers and /steer routes, so a typed
        // `/steer write the missing test file` stays the /steer door and is never refused as a tool ask.
        const hostKind = userTurn && userTurn.role === 'user' ? hostAnswerKind(String(userTurn.content || '')) : null;
        // C320 — a door ask runs its sh on the host before the tool refusal and before the model ever sees it; the route is
        // house-menu.mjs's routeChat (one place). Measured live 2026-09-25: without this, gemma2:2b answered "I can't run commands".
        const routed = userTurn && userTurn.role === 'user' && hostKind !== 'help' && hostKind !== 'menu' ? await routeHouseAsk(cwd, String(userTurn.content || '')) : null;
        if (routed && routed.kind === 'door') {
            const t0 = Date.now(); const head = routedDoorHead(routed.entry); post({ type: 'token', id, t: head });
            const r = await runHouseDoor(cwd, routed.entry.id, [routed.entry], (t) => post({ type: 'token', id, t }), ctl.signal);
            inflight.delete(id); appendChatTurn(cwd, 'assistant', head + r.out);
            post({ type: 'done', id, ok: r.ok, text: head + r.out, error: r.ok ? undefined : 'door failed', steer: 'door', ms: Date.now() - t0 });
            return;
        }
        if (hostKind === 'help') {
            const t0 = Date.now(); const w = await writeCapabilities(cwd);
            inflight.delete(id); appendChatTurn(cwd, 'assistant', w.text);
            post({ type: 'done', id, ok: true, text: w.text, steer: 'help', hint: w.capPath ? `opened ${w.capPath}` : 'no workspace — printed here only', ms: Date.now() - t0 });
            return;
        }
        if (hostKind === 'refuse') {
            inflight.delete(id); appendChatTurn(cwd, 'assistant', TOOL_REFUSAL);
            post({ type: 'done', id, ok: false, text: '', error: TOOL_REFUSAL, steer: 'refuse', ms: 0 });
            return;
        }
        // C314 — the sidebar chat is the one the operator types into: a capability ask ("show me a list of your skills /
        // reports you can do", /menu, …) is answered from the DERIVED house menu with ZERO model calls, and a typed
        // `door <id>` runs a READ entry (or hands an OUTWARD one back) — the same two branches handleChatInline takes.
        if (hostKind === 'menu') {
            const t0 = Date.now(); const menuText = await loadHouseMenuText(cwd);
            inflight.delete(id); appendChatTurn(cwd, 'assistant', menuText);
            post({ type: 'done', id, ok: true, text: menuText, steer: 'menu', hint: 'type `door <id>` to run a READ entry', ms: Date.now() - t0 });
            return;
        }
        const typedDoorId = userTurn && userTurn.role === 'user' ? typedDoorIdOf(String(userTurn.content || '').trim()) : null;
        if (typedDoorId) {
            const t0 = Date.now(); const menu = await loadHouseMenu(cwd);
            const r = await runHouseDoor(cwd, typedDoorId, menu, (t) => post({ type: 'token', id, t }), ctl.signal);
            inflight.delete(id); if (r.out) { appendChatTurn(cwd, 'assistant', r.out); }
            post({ type: 'done', id, ok: r.ok, text: r.out || '', error: r.refused ? 'refused' : (r.ok ? undefined : 'door failed'), steer: 'door', ms: Date.now() - t0 });
            return;
        }
        // the model is told what this chat can do (the same list `help` prints), so it never invents a /steer it cannot run
        // C201 (3): and it is told the STEER STATE — the active leaf's contract, the open rows, /steer status — read off the record this
        // turn by chat-context.mjs, which also writes the turn to the walk tape (source chat, the leaf id, the context sha)
        const tree = await chatContextFor(cwd, String(m.model || ''), String(userTurn && userTurn.content || ''));
        const sys = { role: 'system', content: `${await buildCapabilities(cwd)}\n\n${tree.context}` };
        m.messages = [sys, ...m.messages.filter((x: any) => x && x.role !== 'system')];
        // C224 — a send with no first token after WAIT_MS is usually queued behind a /steer worker on the same model server:
        // say so, with the numbered list and the /end line, instead of an empty bubble (the operator's screenshot, 2026-09-23)
        let firstToken = false;
        const waitTimer = setTimeout(() => { if (firstToken) { return; } void runWorkersVerb(cwd, ['list']).then((t) => { if (firstToken || !t.ok || /^no \/steer workers/.test(t.out)) { return; } post({ type: 'waiting', id, text: `no reply after ${WAIT_MS / 1000} s — the model server is shared with:\n${t.out.trim()}` }); }); }, WAIT_MS);
        // C263 (U0) — the same fit the inline chat runs: the model's window read off /api/show, the middle cut, the trim on screen
        const hostUrl = await host();
        const fit = core.fitMessages(m.messages, await core.contextLength({ host: hostUrl, model: String(m.model || '') }));
        const fitLine = core.fitNote(fit, String(m.model || ''));
        if (fitLine) { post({ type: 'waiting', id, text: fitLine }); }
        const r = await core.streamChat({ host: hostUrl, model: String(m.model || ''), messages: fit.messages, options: { num_ctx: fit.num_ctx }, signal: ctl.signal, onToken: (t: string) => { firstToken = true; post({ type: 'token', id, t }); } });
        clearTimeout(waitTimer);
        appendChatCot(cwd, { surface: 'ide:chat', model: String(m.model || ''), prompt: String(userTurn && userTurn.content || ''), thinking: r.thinking || '', reply: r.text || '', ms: r.ms, tokens: r.tokens, ok: r.ok, error: r.error });   // C246 — the CoT, readable from Claude Code (scripts/vna/steerchat.mjs cot)
        if (r.text) { appendChatTurn(cwd, 'assistant', r.text); }   // persisted on a stop/error too, if partial text streamed before it
        // C207 — a fenced `/steer <verb>` in the reply is an ACTION: recorded on the tape (source chat-model), then run on the same
        // route a typed verb takes (actOnModelReply → runSteerVerb); its output is its own transcript turn, opened with ▶ ran by <model>
        // C217 — the turn's controller stays registered through that run, so ⏹ (stop → ctl.abort) ends the child the model started
        const act = await actOnModelReply(cwd, String(m.model || ''), r.text || '', (t: string) => post({ type: 'token', id, t }), ctl.signal);
        inflight.delete(id);
        if (act.acted) { if (act.out) { appendChatTurn(cwd, 'assistant', act.out); } post({ type: 'done', id, ...r, ok: act.ok, steer: act.verb, ranBy: String(m.model || ''), error: act.error }); return; }
        post({ type: 'done', id, ...r });
        return;
    }
    if (typeof m.cmd === 'string' && DOORS.has(m.cmd) && typeof m.text === 'string') {
        try { await vscode.commands.executeCommand(m.cmd, m.text); }
        catch (e) { vscode.window.showWarningMessage(`💬 ${m.cmd} is not registered in this window — Reload Window (${String((e as Error)?.message || e).slice(0, 80)})`); }
    }
}

class ChatViewProvider implements vscode.WebviewViewProvider {
    resolveWebviewView(v: vscode.WebviewView): void {
        view = v;
        const media = vscode.Uri.joinPath(ctx!.extensionUri, 'media');
        v.webview.options = { enableScripts: true, localResourceRoots: [media] };
        v.webview.html = html(v.webview, media);
        v.webview.onDidReceiveMessage((m) => void onMessage(m));
        v.onDidDispose(() => { view = undefined; for (const c of inflight.values()) { c.abort(); } inflight.clear(); });
    }
}

/** 💬 from the steer page's pill: reveal the view without taking the editor's focus */
async function openChat(): Promise<void> {
    if (view) { view.show(true); return; }
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);                 // first open resolves the view (this focuses it)…
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');   // …so hand the focus straight back to the editor
}

export function registerVnaChat(context: vscode.ExtensionContext): void {
    ctx = context;
    core = require(path.join(context.extensionPath, 'media', 'chat-core.js'));
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(VIEW_ID, new ChatViewProvider(), { webviewOptions: { retainContextWhenHidden: true } }),
        vscode.commands.registerCommand('vna.openChat', () => openChat()),
        // C198 — ⚙️ Engine & Keys sets the control-chat tag through THIS file's own key (the one writer of MODEL_KEY; vna-engines.ts
        // writes no state of its own), and reads what the chat will ask for — the picked tag, the setting, or core.FALLBACK_MODEL (gemma)
        vscode.commands.registerCommand('vna.getChatModel', () => ({ requested: requested(), fallback: core.FALLBACK_MODEL })),
        vscode.commands.registerCommand('vna.setChatModel', async (tag: unknown) => {
            const t = String(tag || '').trim(); if (!t) { return { ok: false, why: 'empty tag' }; }
            await context.globalState.update(MODEL_KEY, t); if (view) { await sendProbe(); }
            return { ok: true, requested: t };
        }));
}

function html(w: vscode.Webview, media: vscode.Uri): string {
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const u = (f: string) => w.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${u('chat.css')}"></head>
<body class="chatview">
  <header class="bar">
    <div class="card3 pill" id="enginesPill"><div class="c3l face"><details class="plus" id="engines"><summary title="the local engines — which engine the /steer workers run on, what Ollama holds in memory for the 💬 chat model and the 🤖 worker model (GET /api/ps), ↻ to re-read">+</summary></details><label class="keep" title="C277 ↻ keep /steer running — ticked, the host runs steer until, pass after pass (it pauses when no CLEAR row is left, when memory is low, or when another owner holds the loop); unticked, the pass finishes its row and no new one starts. ⏹ End all stays the kill. An ask sent from this chat ticks it."><input type="checkbox" id="keepRunning"><span id="keepFace">↻</span></label><button id="endAll" class="action kill" title="workers.mjs end-all (C293) — ends every local-LLM process by pid: /steer workers, replay-bench / brief-bench and their goose children, any goose run, llm-prompt.sh, ghost-read, region-narrative, ollama run (SIGTERM, then SIGKILL); then unloads every model Ollama holds (keep_alive 0) and releases a heavy lock whose holder it ended. Never the ollama server, an editor, claude or this IDE. The chat reloads a model on its next Send.">⏹ End all</button><span class="reading"><span class="status off" id="status"></span><span class="eface" id="engineFace"></span></span></div>
      <div class="epanel" id="enginePanel" hidden><div class="howto" id="howTo"><b>What you can type</b><div>ask anything — answered from the steer state it is handed</div><div><code>/steer &lt;what to finish&gt;</code> declares it and runs it</div><div><code>/steer status</code> · <code>plan</code> · <code>next</code> · <code>asks</code> — the loop's receipts, no model</div><div><code>/workers</code> lists the running workers · <code>/end &lt;n|row|all&gt;</code> ends them</div><div><code>/probe</code> re-reads the engine · <code>/clear</code> empties this chat</div></div><div class="subnote" id="subNote"></div><div class="elines" id="engineLines">reading…</div><div class="eacts"><button id="engineRefresh" class="ghost" title="read GET /api/ps again — it also re-reads every 15 s while the + is open, after each chat reply, after ⏹ End all, and on /probe">↻ Refresh</button></div><div class="eout" id="endOut"></div></div></div>
    <div class="models">
      <label class="pick" title="💬 chat — the model this chat talks to, answering from the steer state it is handed each turn; the installed tags (GET /api/tags), default gemma (runner-resolver.mjs LOCAL_ROLES.chat)">💬<span class="job" title="C262 — this model's job: it answers you here, from the steer state; it never edits a file">answers</span><select id="model"></select></label>
      <label class="pick" id="subPick" title="🤖 /steer subagents — the model a LOCAL worker runs on (goose-local) — runner-resolver.mjs set --subagent-model; default UNMEASURED until the first probe reads runner-resolver.mjs LOCAL_ROLES.subagent. A cloud engine (claude -p) ignores it — the line below says which engine dispatches">🤖<span class="job" title="C262 — this model's job: a /steer worker runs on it and makes the edit">edits</span><select id="subModel"></select></label>
    </div>
  </header>
  <main id="log" class="log"></main>
  <footer class="compose">
    <textarea id="input" rows="3" placeholder="ask anything — the + above shows what you can type"></textarea>
    <div class="acts"><button id="send">↵ Send</button><button id="stop" class="ghost">⏹</button></div>
  </footer>
  <script nonce="${nonce}" src="${u('chat-core.js')}"></script>
  <script nonce="${nonce}" src="${u('chat.js')}"></script>
</body></html>`;
}
