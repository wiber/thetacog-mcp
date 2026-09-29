// packages/thetacog-mcp-vscode/src/vna-engines.ts — C166 ⚙️ ENGINE & KEYS (unit 1 of docs/specs/vna/SPEC-MULTI-ENGINE.md).
// C198 (operator 2026-09-23): named "Engine & Keys" — "because some of them are local and dont need keys" — and the page carries the
// LOCAL MODELS convention (runner-resolver.mjs LOCAL_ROLES): gemma for the control chat, qwen for a local subagent, both settable here.
// The chat tag is written by vna-chat.ts's own vna.setChatModel (its key, its writer); the subagent tag by the resolver's `set`.
//
// ONE PANEL, TWO STORES, AND THEY NEVER MIX. The ENGINE the headless runner spawns is a selection — not a secret — and has one
// writer, scripts/vna/runner-resolver.mjs `set` (it refuses a template that carries a key and drops every field it does not own).
// The KEYS live in context.secrets and nowhere else: no settings.json, no .env, no file, no globalState, no argv (argv is visible
// to every process on the host), no runner.ndjson row, no tape. They reach a worker one way — engineSecretEnv() merged into the
// runner's child env at spawn (vna-steer.ts runGoalHeadless). The webview is handed each key's PRESENCE, never its value.
//
// THE PRESET TABLE IS runner-resolver.mjs's. PRESETS below is its mirror for a panel that must paint away from home (no npx door
// yet); tests/vna/c166-engines-pill-secretstorage-and-sub-agent.test.mjs diffs the two, so a preset added on one side is red.
//
// THE STATUS BAR prints the resolver's own line — `[Runner: goose/qwen2.5-coder:3b · Local $0.00]` — never a sum computed here.
//
// LLM-FREE: nothing in this file calls a model.
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as http from 'http';
import { join } from 'path';
import { doorCommand } from './commands';
import { setRunnerStatus } from './status';   // the one owner of the status bar
import { ENGINE_KEYS_LABEL, ENGINE_KEYS_LABEL_HTML } from './door-labels';   // C243: the ONE name of this door, generated from scripts/vna/door-labels.mjs — the pill reads the same constant
import { loadEntitlement, ingestEntitlement } from './auth-manager';   // C182d: the ONE licence door — this page adds a paste box, never a second path
import { splitLicences } from './licence-list';
import { ENGINE_KEY_ROWS, buildEngineKeyRows, lastSetAt, type EngineKeyRow } from './engine-key-rows';   // C179: the runner-card sub-pill's rows · C245: setAt off the C179a ledger
import { readFileSync } from 'fs';   // C245: the audit ledger is read, never written, here
import { auditRow, appendAuditRow, isReset, AUDIT_FILE } from './engine-key-audit';   // C179a: every set/clear/reset is a row, never the key

const RESOLVER = 'scripts/vna/runner-resolver.mjs';
export const PRESETS: ReadonlyArray<{ id: string; title: string; template: string | null; engine: string; local: boolean | null }> = [
    { id: 'claude-code-headless', title: 'Claude Code (headless)', template: 'claude -p "{prompt}" --dangerously-skip-permissions --output-format json', engine: 'claude/claude -p', local: false },
    { id: 'goose-local', title: 'Goose (local Ollama: qwen2.5-coder:3b)', template: 'GOOSE_PROVIDER=ollama GOOSE_MODEL=qwen2.5-coder:3b GOOSE_MODE=auto goose run --no-session --text "{prompt}"', engine: 'goose/qwen2.5-coder:3b', local: true },
    { id: 'ollama-local', title: 'Ollama (qwen2.5-coder:3b)', template: 'ollama run qwen2.5-coder:3b "{prompt}"', engine: 'ollama/qwen2.5-coder:3b', local: true },
    { id: 'custom-command', title: 'Custom command', template: null, engine: 'custom', local: null },
];
export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_HOST', 'CUSTOM_BEARER_TOKEN'] as const;
type SecretName = typeof SECRET_NAMES[number];
const LABEL: Record<SecretName, string> = { ANTHROPIC_API_KEY: 'Anthropic', OPENROUTER_API_KEY: 'OpenRouter', OLLAMA_HOST: 'Ollama URL', CUSTOM_BEARER_TOKEN: 'Custom bearer' };
const slot = (n: SecretName) => `vna.engine.${n}`;   // the SecretStorage key — the value is never anywhere else

let ctx: vscode.ExtensionContext | null = null;
let panel: vscode.WebviewPanel | undefined;

const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
function resolver(args: string[]): Promise<{ ok: boolean; out: string; runnable: boolean }> {
    const cwd = root(); const c = doorCommand(cwd, RESOLVER, args);
    if (!cwd || !c.runnable) { return Promise.resolve({ ok: false, out: c.display, runnable: false }); }
    return new Promise((res) => execFile(c.file, c.args, { cwd, timeout: 10000, maxBuffer: 1 << 20 }, (err, so, se) => res({ ok: !err, out: (so || '') + (se || ''), runnable: true })));
}
const lastJson = (out: string): any => { try { return JSON.parse(out.split('\n').filter((l) => l.trim().startsWith('{')).pop() || ''); } catch { return null; } };
// C179a: the audit ndjson lives under this workspace's .thetacog/ — the repo's own convention for a receipt (never a secret)
const auditFile = () => join(root() || '.', AUDIT_FILE);

/**
 * the keys, for the runner's child env ONLY. C166a: every SECRET_NAMES slot is written
 * (the pill's value, or '' to blank a shell-inherited one) and VNA_ENGINE_KEYS names the ones that came from SecretStorage — the runner's
 * keyedEnv() drops any key not named there, so a sub-agent never runs on the operator's shell key.
 */
export async function engineSecretEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = {}; const from: string[] = [];
    for (const n of SECRET_NAMES) { const v = ctx ? await ctx.secrets.get(slot(n)) : undefined; env[n] = v || ''; if (v) { from.push(n); } }
    env.VNA_ENGINE_KEYS = from.join(',');
    return env;
}
// C239a — EVERY RUNNER DOOR CARRIES THE KEYS, NOT ONLY ⚡ RUN HEADLESS. Measured 2026-09-24 off .thetacog/runner.ndjson: 103 of 103
// claude-code-headless worker rows in 36 h read key_source "none" — engineSecretEnv() was merged into ONE spawn (vna-steer.ts
// runGoalHeadless) while the 💬 Steer chat's /steer verbs (vna-chat-inline.ts, the door the operator actually types into) spawned
// steer.mjs with { cwd } alone, so steer-runner's keyedEnv() never saw the key that had just been set. hostEnvForChild() is the one
// strip (a worker spawned from inside a Claude Code session must never read as a nested one); runnerEnv() is the one door a runner
// child's env comes through — read fresh at spawn, never cached at activation, so a Set on this page reaches the next dispatch.
export function hostEnvForChild(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) { if (v !== undefined && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_')) { env[k] = v; } }
    return env;
}
export async function runnerEnv(): Promise<Record<string, string>> {
    const env = hostEnvForChild();
    Object.assign(env, await engineSecretEnv());
    return env;
}

type Status = { line: string; preset: string; template: string; name: string; local: boolean | null; source?: string; subagentModel?: string; claudeModel?: string; claudeModels?: string[]; localRoles?: { chat: string; subagent: string }; thinkingRules?: ReadonlyArray<{ re: string; label: string }> };
// C285 — THE DROPDOWNS SAY WHICH MODELS THINK, FROM THE RESOLVER'S ONE TABLE. `status --json` carries runner-resolver.mjs
// THINKING_RULES as `thinkingRules`; this applies them (first match wins, the same loop as the resolver's thinkingOf) to the tags a
// dropdown is about to show. It holds no table of its own — with no rules (the resolver did not answer) every tag reads 'unknown'.
export function thinkingLabels(tags: ReadonlyArray<string | null | undefined>, rules: Status['thinkingRules'] | null | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const tag of tags) {
        if (!tag) { continue; }
        const t = String(tag).trim().toLowerCase().replace(/^.*\//, '');
        const hit = (rules || []).find((r) => { try { return new RegExp(r.re, 'i').test(t); } catch { return false; } });
        out[String(tag)] = hit ? hit.label : 'unknown';
    }
    return out;
}
async function readStatus(): Promise<Status | null> { const r = await resolver(['status', '--json']); return r.ok ? lastJson(r.out) : null; }
/** C201 — the 💬 chat view's 🤖 subagent dropdown reads the same status and writes through the same `set --subagent-model` door as this page */
export const resolverStatus = readStatus;
// C205(a) — the 🤖 subagent dropdown's `claude -p` option shows whether ITS key is held, read fresh off SecretStorage
// (never the cache the ⚙️ page repaints on, which can lag a change made from elsewhere): a one-way fp8 (never the key
// itself) or null when unset. Local tags need no key, so this is asked only for claude/claude -p.
export async function claudeKeyRow(): Promise<EngineKeyRow | null> {
    if (!ctx) { return null; }
    const v = await ctx.secrets.get(slot('ANTHROPIC_API_KEY'));
    return buildEngineKeyRows({ ANTHROPIC_API_KEY: v }).find((r) => r.engine === 'claude/claude -p') || null;
}
export async function setSubagentModel(tag: string): Promise<{ ok: boolean; subagentModel?: string; why?: string }> {
    const r = await resolver(['set', '--subagent-model', String(tag || ''), '--json']); const j = lastJson(r.out);
    return j && j.ok ? { ok: true, subagentModel: j.subagentModel } : { ok: false, why: (j && j.why) || r.out.trim().slice(0, 160) };
}

// C179 — THE 🔑 API KEY SUB-PILL IN THE ⚡ RUNNER CARD IS A FACE OF C166'S ONE KEY STORE, NEVER A SECOND ONE (operator-accepted
// assumption). One row per engine steer-ui.mjs's own SEAMS array (and runner-resolver.mjs's PRESETS) names as a thing the
// runner CAN dispatch — never the value, never the key's own fp8 as a secret: `fp8` is sha256(the SecretStorage value).slice(0,8),
// a one-way, non-secret fingerprint (engine-key-rows.ts, pure — the guard transpiles and runs it directly). Cached here the same
// way entitlementEnv() caches claims (a plain render process cannot read SecretStorage itself) and refreshed on every status
// read + every secret change, so a sync read never blocks the render.
let engineKeyRowsCache: EngineKeyRow[] = ENGINE_KEY_ROWS.map((r) => ({ engine: r.engine, built: r.built, held: false, fp8: null, line: r.built ? 'no key' : 'UNMEASURED — not built', setAt: null }));
async function refreshEngineKeyRows(): Promise<void> {
    if (!ctx) { return; }
    const held: Record<string, string | undefined> = {};
    for (const n of SECRET_NAMES) { held[n] = await ctx.secrets.get(slot(n)); }
    // C245: when each key was set — the C179a audit ledger this file appends to (a receipt, never the key); absent → no setAt
    let ledger = ''; try { ledger = readFileSync(auditFile(), 'utf8'); } catch { ledger = ''; }
    engineKeyRowsCache = buildEngineKeyRows(held, lastSetAt(ledger));
}
/** the sync door every render spawn merges into its env (vna-steer.ts `run()`, beside entitlementEnv()) — VNA_ENGINE_KEY_ROWS
 * carries only { engine, built, held, fp8, line } rows: fp8 is a one-way hash, never the key. */
export function engineKeyRowsEnv(): Record<string, string> { return { VNA_ENGINE_KEY_ROWS: JSON.stringify(engineKeyRowsCache) }; }
export function readEngineKeyRowsCache(): EngineKeyRow[] { return engineKeyRowsCache; }   // the guard's door — never used by a render

export async function refreshEngineStatus(): Promise<void> {
    if (!ctx) { return; }
    // C245: the rows FIRST — SecretStorage answers in ms; readStatus spawns runner-resolver.mjs (hundreds of ms). With the order
    // reversed, a render that spawned in that window (a prompt hook right after a reload) painted the boot cache — "no key" — while
    // the key sat in SecretStorage (operator 2026-09-24: "I cant see that its updated with the right keys").
    await refreshEngineKeyRows();   // C179: repaint the sub-pill's rows in step with the status bar
    const s = await readStatus();
    setRunnerStatus(ctx, s ? `$(server-process) ${s.line}` : '$(server-process) [Runner: UNMEASURED]',
        s ? `${ENGINE_KEYS_LABEL} — the headless runner spawns: ${s.template}\nclick to pick the engine or set a key (SecretStorage)` : 'runner-resolver.mjs did not answer (no npx door away from home yet) — click to set keys');
}

async function state() {
    const s = await readStatus();
    const has: Record<string, boolean> = {};
    for (const n of SECRET_NAMES) { has[n] = !!(ctx && await ctx.secrets.get(slot(n))); }
    // C182d: this machine's claim, as the one door reads it (fingerprint · credits) — never the licence itself
    const c = ctx ? await loadEntitlement(ctx).catch(() => null) : null;
    const licence = c ? { fp: String(c.pubkey_fingerprint || '').slice(0, 8), credits: c.credits } : null;
    // C198: the two local roles — what the chat will ask for (vna-chat.ts's own reading) and the subagent tag (the resolver's), plus
    // the installed tags from the same 1,500 ms /api/tags probe the Test button runs, so a pick is never a tag that is not on disk
    const chat: any = await vscode.commands.executeCommand('vna.getChatModel').then((x) => x, () => null);
    const host = (ctx && await ctx.secrets.get(slot('OLLAMA_HOST'))) || 'http://localhost:11434';
    const installed: string[] | null = await getJson(`${host.replace(/\/$/, '')}/api/tags`, 1500).then((j: any) => (j && j.models || []).map((x: any) => String(x.name)).filter((n: string) => !/embed/i.test(n)), () => null);
    const models = { chat: chat && chat.requested || null, subagent: s && s.subagentModel || null, roles: s && s.localRoles || null, installed,
        thinking: thinkingLabels([...(installed || []), chat && chat.requested, s && s.subagentModel, s && s.localRoles && s.localRoles.chat, s && s.localRoles && s.localRoles.subagent], s && s.thinkingRules) };   // C285
    return { status: s, has, presets: PRESETS, licence, models };
}

// THE ONE WRITER'S DOOR, CALLABLE FROM OUTSIDE THIS WEBVIEW (C167f — the 💬 Local Ideation pill's checkbox on the steer page is a
// DIFFERENT webview and cannot reach this panel's onMessage; it goes through this door instead, which runs the exact same
// resolver(['set', '--preset', ...]) call the Engines page's own 'select' branch runs). Never a second writer — runner-resolver.mjs
// `set` stays the one place a preset is written; this is a thin, reusable call to it.
// C201a — THE HANDS DROPDOWN'S ONE DOOR: the 💬 pill's `subagent hands` <select> posts vna.setSubagentHands with its value; `claude -p`
// is the claude-code-headless preset, any other value is a local tag → goose-local + the resolver's subagent tag (C198's one writer).
// This REPLACES the C167f checkbox (vna.useLocalEngine / vna.useClaudeEngine stay registered for the palette): picking a local
// engine IS the choice, there is no second toggle to disagree with it.
export async function setSubagentHands(value: string): Promise<{ ok: boolean; preset?: string; subagentModel?: string; why?: string }> {
    const v = String(value || '').trim();
    if (!v) { return { ok: false, why: 'empty' }; }
    // C215 — 'claude -p · sonnet|opus|haiku' pins the worker's --model; bare 'claude -p' keeps the stored pin
    const cm = /^claude -p · ([a-z0-9.-]+)$/.exec(v);
    if (v === 'claude -p' || cm) {
        const r = await resolver(['set', '--preset', 'claude-code-headless', ...(cm ? ['--claude-model', cm[1]] : []), '--json']); const j = lastJson(r.out);
        return j && j.ok ? { ok: true, preset: j.preset } : { ok: false, why: (j && j.why) || r.out.trim().slice(0, 160) };
    }
    const p = await setPreset('goose-local'); if (!p.ok) { return p; }
    const m = await setSubagentModel(v); if (!m.ok) { vscode.window.showWarningMessage(`🤖 subagent hands refused — ${m.why}`); return m; }
    return { ok: true, preset: p.preset, subagentModel: m.subagentModel };
}
export async function setPreset(preset: string, template?: string): Promise<{ ok: boolean; preset?: string; why?: string }> {
    const args = ['set', '--preset', preset, '--json', ...(preset === 'custom-command' ? ['--template', String(template || '')] : [])];
    const r = await resolver(args); const j = lastJson(r.out);
    await refreshEngineStatus(); void vscode.commands.executeCommand('vna.refreshPage');
    if (panel) { void panel.webview.postMessage({ type: 'state', ...(await state()), note: j && j.ok ? `engine → ${j.preset}` : `refused — ${(j && j.why) || r.out.trim().slice(0, 160)}`, bad: !(j && j.ok) }); }
    return j && j.ok ? { ok: true, preset: j.preset } : { ok: false, why: (j && j.why) || r.out.trim().slice(0, 160) };
}

async function onMessage(m: any) {
    if (!ctx || !m || typeof m.type !== 'string') { return; }
    const post = async (extra: Record<string, unknown> = {}) => panel?.webview.postMessage({ type: 'state', ...(await state()), ...extra });
    if (m.type === 'ready') { await post(); return; }
    if (m.type === 'select') {
        await setPreset(String(m.preset), String(m.template || ''));
        return;
    }
    if (m.type === 'setChatModel') {   // C198: through vna-chat.ts's own writer, never a second one
        const r: any = await vscode.commands.executeCommand('vna.setChatModel', String(m.tag || '')).then((x) => x, (e) => ({ ok: false, why: String(e) }));
        await post({ note: r && r.ok ? `control chat → ${r.requested}` : `refused — ${(r && r.why) || 'the chat is not registered in this window'}`, bad: !(r && r.ok) }); return;
    }
    if (m.type === 'setSubagentModel') {   // C198: the resolver's one writer, keeping the engine
        const r = await resolver(['set', '--subagent-model', String(m.tag || ''), '--json']); const j = lastJson(r.out);
        await refreshEngineStatus(); void vscode.commands.executeCommand('vna.refreshPage');
        await post({ note: j && j.ok ? `local subagent → ${j.subagentModel}` : `refused — ${(j && j.why) || r.out.trim().slice(0, 160)}`, bad: !(j && j.ok) }); return;
    }
    if (m.type === 'ingestLicences') {
        // C182d: one paste, one or many — split by the pure parser, each token through ingestEntitlement SERIALLY (the machine
        // store is written per token; parallel claims would race it), one verdict line per token. The token never comes back.
        const { tokens, junk } = splitLicences(String(m.text || ''));
        if (!tokens.length) { await post({ note: `no licence found in the paste${junk ? ` (${junk} piece${junk === 1 ? '' : 's'} were not licences)` : ''}`, bad: true }); return; }
        const verdicts: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const r = await ingestEntitlement(ctx, tokens[i], 'manual');
            verdicts.push(r.verified && r.claims ? `✓ ${i + 1}/${tokens.length} · 🔑 ${String(r.claims.pubkey_fingerprint).slice(0, 8)} · ${r.claims.credits} cr` : `✗ ${i + 1}/${tokens.length} · ${r.reason || 'refused'}`);
            await post({ verdicts, note: `claiming ${i + 1} of ${tokens.length}…` });
        }
        const ok = verdicts.filter((v) => v.startsWith('✓')).length;
        await post({ verdicts, note: `${ok} of ${tokens.length} licence${tokens.length === 1 ? '' : 's'} accepted${junk ? ` · ${junk} piece${junk === 1 ? '' : 's'} ignored (not a licence)` : ''}`, bad: ok < tokens.length });
        return;
    }
    const name = SECRET_NAMES.find((n) => n === m.name); if (!name) { return; }
    // C179a — THE /steer WORKER KEY IS A RESETTABLE DEFAULT THAT ACCEPTS ANY KEY: pasting any well-formed key replaces the
    // one slot per engine steer-runner.mjs injects into every worker's env (engineSecretEnv → vna-steer.ts runGoalHeadless);
    // typing/pasting the literal word `reset` restores the machine's own session auth (no key injected — clearSecret's path,
    // never a literal key "reset" stored). Every change is a row (engine · fp8 of the key · at), never the key, so which key
    // paid for which worker is recomputable (audit(), engine-key-audit.ts — a receipt under .thetacog/, never the repo, the
    // tape or a log carrying the value).
    if (m.type === 'setSecret') {
        const v = String(m.value || '').trim(); if (!v) { await post({ note: `${LABEL[name]}: empty — nothing stored`, bad: true }); return; }
        // C239 — every key change repaints the SIDEBAR too (vna.refreshPage), not only the status bar and this page: the 🔑 Engine
        // keys pill is painted from VNA_ENGINE_KEY_ROWS at render time, so a Set with no repaint left it reading "set or check keys"
        // while the key sat in SecretStorage (operator 2026-09-24: "I saved it here, but it did not work"). Same pair setPreset runs.
        if (isReset(v)) {
            await ctx.secrets.delete(slot(name));
            appendAuditRow(auditRow(name, null, 'reset'), auditFile());
            await refreshEngineStatus(); void vscode.commands.executeCommand('vna.refreshPage');
            await post({ note: `${LABEL[name]} reset — the machine's own session auth is used, no key injected` }); return;
        }
        await ctx.secrets.store(slot(name), v);
        appendAuditRow(auditRow(name, v, 'set'), auditFile());
        await refreshEngineStatus(); void vscode.commands.executeCommand('vna.refreshPage');
        await post({ note: `${LABEL[name]} stored in SecretStorage` }); return;
    }
    if (m.type === 'clearSecret') {
        await ctx.secrets.delete(slot(name));
        appendAuditRow(auditRow(name, null, 'clear'), auditFile());
        await refreshEngineStatus(); void vscode.commands.executeCommand('vna.refreshPage');
        await post({ note: `${LABEL[name]} removed from SecretStorage` }); return;
    }
    if (m.type === 'testOllama') {
        const host = (await ctx.secrets.get(slot('OLLAMA_HOST'))) || 'http://localhost:11434';
        const t0 = Date.now(); let note = '', bad = false;
        try {
            const j: any = await getJson(`${host.replace(/\/$/, '')}/api/tags`, 1500); const models = (j && j.models || []).map((x: any) => x.name);
            note = `🟢 Online (${new URL(host).port || host}) · ${models.length} model${models.length === 1 ? '' : 's'} · ${Date.now() - t0} ms${models.length ? ` · ${models.slice(0, 4).join(', ')}` : ''}`;
        } catch (e) { bad = true; note = `🔴 Engine Unreachable · ${host} did not answer in 1,500 ms · Check: ollama serve`; }
        await post({ note, bad }); return;
    }
}

// the Ollama probe — node http, 1,500 ms, never blocks the host; any error or timeout is the 🔴 line
function getJson(url: string, ms: number): Promise<any> {
    return new Promise((res, rej) => {
        const req = http.get(url, { timeout: ms }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { res(JSON.parse(b)); } catch (err) { rej(err); } }); });
        req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', rej);
    });
}

function open() {
    if (!ctx) { return; }
    if (panel) { panel.reveal(); return; }
    panel = vscode.window.createWebviewPanel('vna.engines', ENGINE_KEYS_LABEL, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: false });
    panel.webview.html = html(panel.webview.cspSource);
    panel.webview.onDidReceiveMessage((m) => void onMessage(m));
    panel.onDidDispose(() => { panel = undefined; });
}

export function registerVnaEngines(context: vscode.ExtensionContext) {
    ctx = context;
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.openEnginesConfig', () => open()),
        // C167f: the 💬 Local Ideation pill's checkbox — checked/unchecked, the same two-command idiom auto-paste's toggle uses
        // (vna.clipArm/vna.clipDisarm), through the one resolver door above; goose-local is the only LOCAL preset the runner will
        // dispatch on once C168e/C168g land (ollama-local stays chat-only per C168g — never offered here)
        vscode.commands.registerCommand('vna.useLocalEngine', () => setPreset('goose-local')),
        vscode.commands.registerCommand('vna.useClaudeEngine', () => setPreset('claude-code-headless')),
        vscode.commands.registerCommand('vna.setSubagentHands', (v: unknown) => setSubagentHands(String(v || ''))),   // C201a: the 💬 pill's hands dropdown
        context.secrets.onDidChange((e) => { if (e.key.startsWith('vna.engine.')) { void refreshEngineStatus(); } }));
    void refreshEngineStatus();
}

// ── the page. Keys are typed into password fields; the 👁 toggles the field's type locally and is never a round-trip. A stored
// key is shown as "stored" — no prefix, no last four. Set clears the field the moment it posts.
function html(csp: string): string {
    const nonce = Math.random().toString(36).slice(2);
    const rows = SECRET_NAMES.map((n) => `
      <div class="key" data-name="${n}">
        <label>${LABEL[n]}<small>${n}</small></label>
        <div class="field"><input type="password" autocomplete="off" spellcheck="false" placeholder="${n === 'OLLAMA_HOST' ? 'http://localhost:11434' : '••••••••••••••••••••••••'}"><button class="eye" title="show / hide what you typed">👁</button></div>
        <button class="set">Set</button><button class="clear ghost" title="remove from SecretStorage">✕</button>${n === 'OLLAMA_HOST' ? '<button class="test ghost">Test</button>' : ''}
        <span class="has"></span>
      </div>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { --bg: var(--vscode-editor-background); --fg: var(--vscode-foreground); --dim: var(--vscode-descriptionForeground); --line: var(--vscode-panel-border, #2a3442); --acc: var(--vscode-focusBorder, #3b82f6); --ok: #2f8f4e; --bad: #c0392b; }
  body { font: 13px/1.5 var(--vscode-font-family); color: var(--fg); background: var(--bg); max-width: 760px; margin: 0 auto; padding: 22px 26px 40px; }
  h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: .2px; } .sub { color: var(--dim); margin: 0 0 18px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--dim); margin: 22px 0 8px; font-weight: 600; }
  .now { display: inline-block; padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 8px; }
  .preset { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: border-color .12s, background .12s; }
  .preset:hover { border-color: var(--acc); } .preset.on { border-color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, transparent); }
  .preset b { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
  .tag { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); }
  .tag.local { color: var(--ok); border-color: var(--ok); } .tag.api { color: #d4a72c; border-color: #d4a72c; }
  code, .tpl { font-family: var(--vscode-editor-font-family); font-size: 11.5px; color: var(--dim); word-break: break-all; }
  .custom { margin-top: 8px; display: none; } .custom.show { display: flex; gap: 6px; }
  input { flex: 1; min-width: 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 5px; padding: 5px 8px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  input:focus { outline: 1px solid var(--acc); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 5px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--line); } button.ghost:hover { border-color: var(--acc); }
  .key { display: grid; grid-template-columns: 130px 1fr auto auto auto auto; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); }
  .key label { font-weight: 600; } .key small { display: block; font-weight: 400; color: var(--dim); font-size: 10px; font-family: var(--vscode-editor-font-family); }
  .field { display: flex; position: relative; } .field input { padding-right: 32px; }
  .eye { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); background: transparent; color: var(--dim); padding: 2px 6px; }
  .has { font-size: 11px; color: var(--dim); white-space: nowrap; } .has.on { color: var(--ok); }
  .note { margin-top: 14px; min-height: 18px; font-size: 12px; } .note.bad { color: var(--bad); } .note.ok { color: var(--ok); }
  textarea { width: 100%; box-sizing: border-box; margin-top: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 5px; padding: 6px 8px; font-family: var(--vscode-editor-font-family); font-size: 11.5px; resize: vertical; }
  .licrow { display: flex; gap: 10px; align-items: center; margin-top: 6px; } .dim { color: var(--dim); font-size: 11.5px; }
  .verdicts { list-style: none; padding: 0; margin: 8px 0 0; font-family: var(--vscode-editor-font-family); font-size: 11.5px; } .verdicts li.bad { color: var(--bad); } .verdicts li.ok { color: var(--ok); }
  .role { display: grid; grid-template-columns: 160px 1fr auto; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); }
  .role label { font-weight: 600; } .role small { display: block; font-weight: 400; color: var(--dim); font-size: 10px; }
  select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 5px; padding: 4px 6px; font-size: 12px; }
  .rule { margin-top: 20px; color: var(--dim); font-size: 11.5px; border-left: 2px solid var(--line); padding-left: 10px; }
</style></head><body>
  <h1>${ENGINE_KEYS_LABEL_HTML}</h1>
  <p class="sub">Which worker the headless runner spawns for each open unit, the local models the chat and a local subagent use, the keys a cloud engine runs on, and the licences that pay for its attestations. Local engines need no key.</p>
  <span class="now" id="now">[Runner: …]</span>
  <h2>Engine</h2>
  <div class="presets" id="presets"></div>
  <div class="custom" id="custom"><input id="tpl" placeholder='openrouter-runner --model deepseek/v3 --input {snowball}'><button id="saveTpl">Use</button></div>
  <h2>Local models · no key needed</h2>
  <div class="roles">
    <div class="role"><label>Control chat<small>💬 Steer chat · default <span id="chatDef">gemma</span></small></label><select id="chatModel"></select><button id="chatSet">Use</button></div>
    <div class="role"><label>Local subagent<small>goose-local · ollama-local · default <span id="subDef">qwen</span></small></label><select id="subModel"></select><button id="subSet">Use</button></div>
  </div>
  <h2>Licence · credits</h2>
  <div class="lic"><span class="now" id="lic">🔑 …</span></div>
  <textarea id="licPaste" rows="3" spellcheck="false" autocomplete="off" placeholder="paste one licence or many — a list from the email, one per line, commas fine, a vscode://…/auth?entitlement=… link works too"></textarea>
  <div class="licrow"><button id="licGo">Claim to this machine</button><span class="dim" id="licCount"></span></div>
  <ul class="verdicts" id="verdicts"></ul>
  <p class="rule">Each licence is verified and claimed through the same door as the 🔑 sub-pill (C173a). Credits from every claimed licence add up on the server under this machine. Until C182a this machine keeps the most recent licence as its bearer; the others' credits still count.</p>
  <h2>Keys · SecretStorage</h2>
  <div id="keys">${rows}</div>
  <div class="note" id="note"></div>
  <p class="rule">Keys are stored by VS Code's SecretStorage (the OS keychain) and handed to the worker through its environment at spawn. They are never written to settings.json, .env, a tracked file, runner.ndjson or the flight tape — and this page is told only whether each one is set. A template needs <code>{snowball}</code> or <code>{prompt}</code>: the worker is handed the contract, never this session's context.</p>
<script nonce="${nonce}">
  const vs = acquireVsCodeApi(); const $ = (s, r = document) => r.querySelector(s);
  let S = null;
  const say = (t, bad) => { const n = $('#note'); n.textContent = t || ''; n.className = 'note ' + (t ? (bad ? 'bad' : 'ok') : ''); };
  function paint() {
    const cur = S.status ? S.status.preset : 'claude-code-headless';
    $('#now').textContent = S.status ? S.status.line : '[Runner: UNMEASURED — runner-resolver.mjs not runnable here]';
    // C168g — a dispatch engine must be an agent that can commit; ollama-local is a bare model (no tools, can never move
    // HEAD) and stays the chat engine only — never offered as a pick on this, the DISPATCH engine picker.
    const dispatchable = S.presets.filter(p => p.id !== 'ollama-local');
    $('#presets').innerHTML = dispatchable.map(p => '<div class="preset' + (p.id === cur ? ' on' : '') + '" data-id="' + p.id + '"><b>' + p.title + ' <span class="tag ' + (p.local === true ? 'local">Local $0.00' : p.local === false ? 'api">API' : '">Custom') + '</span></b><div class="tpl"></div></div>').join('');
    [...document.querySelectorAll('.preset')].forEach((el, i) => { const p = dispatchable[i]; el.querySelector('.tpl').textContent = p.template || (cur === 'custom-command' && S.status ? S.status.template : 'your command, with {snowball} or {prompt}'); el.onclick = () => pick(p.id); });
    $('#custom').classList.toggle('show', cur === 'custom-command');
    if (cur === 'custom-command' && S.status && !$('#tpl').value) $('#tpl').value = S.status.template || '';
    const M = S.models || {}; const R = M.roles || { chat: 'gemma2:2b', subagent: 'qwen2.5-coder:3b' };
    $('#chatDef').textContent = R.chat; $('#subDef').textContent = R.subagent;
    const fill = (sel, cur, def) => { const tags = [...new Set([...(M.installed || []), cur, def].filter(Boolean))]; sel.innerHTML = ''; for (const t of tags) { const o = document.createElement('option'); o.value = t; o.textContent = t + (M.thinking && M.thinking[t] ? ' · ' + M.thinking[t] : '') + (M.installed && !M.installed.includes(t) ? ' — not installed' : '') + (t === def ? ' · default' : ''); if (t === cur) o.selected = true; sel.appendChild(o); } };
    fill($('#chatModel'), M.chat || R.chat, R.chat); fill($('#subModel'), M.subagent || R.subagent, R.subagent);
    $('#lic').textContent = S.licence ? '🔑 Licence · ' + S.licence.fp + ' claimed · ' + S.licence.credits + ' cr' : '🔑 no licence on this machine yet';
    for (const k of document.querySelectorAll('.key')) { const on = !!S.has[k.dataset.name]; const h = $('.has', k); h.textContent = on ? '● stored' : '○ not set'; h.className = 'has' + (on ? ' on' : ''); }
  }
  function pick(id) { if (id === 'custom-command') { $('#custom').classList.add('show'); $('#tpl').focus(); if (!$('#tpl').value) return; } vs.postMessage({ type: 'select', preset: id, template: $('#tpl').value }); }
  $('#chatSet').onclick = () => vs.postMessage({ type: 'setChatModel', tag: $('#chatModel').value });
  $('#subSet').onclick = () => vs.postMessage({ type: 'setSubagentModel', tag: $('#subModel').value });
  $('#saveTpl').onclick = () => vs.postMessage({ type: 'select', preset: 'custom-command', template: $('#tpl').value });
  for (const k of document.querySelectorAll('.key')) {
    const inp = $('input', k), name = k.dataset.name;
    $('.eye', k).onclick = () => { inp.type = inp.type === 'password' ? 'text' : 'password'; };
    const set = () => { vs.postMessage({ type: 'setSecret', name, value: inp.value }); inp.value = ''; inp.type = 'password'; };
    $('.set', k).onclick = set; inp.onkeydown = (e) => { if (e.key === 'Enter') set(); };
    $('.clear', k).onclick = () => vs.postMessage({ type: 'clearSecret', name });
    const t = $('.test', k); if (t) t.onclick = () => { say('testing…'); vs.postMessage({ type: 'testOllama' }); };
  }
  const countLic = () => { const n = ($('#licPaste').value.match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) || []).length; $('#licCount').textContent = n ? n + ' licence' + (n === 1 ? '' : 's') + ' in the paste' : ''; };
  $('#licPaste').oninput = countLic;
  $('#licGo').onclick = () => { const text = $('#licPaste').value; if (!text.trim()) return; $('#licPaste').value = ''; countLic(); say('claiming…'); vs.postMessage({ type: 'ingestLicences', text }); };
  window.addEventListener('message', (e) => { const m = e.data; if (m.type !== 'state') return; S = m; paint(); if (m.verdicts) $('#verdicts').innerHTML = m.verdicts.map(v => '<li class="' + (v.startsWith('✓') ? 'ok' : 'bad') + '"></li>').join(''), [...document.querySelectorAll('#verdicts li')].forEach((li, i) => { li.textContent = m.verdicts[i]; }); if (m.note) say(m.note, m.bad); });
  vs.postMessage({ type: 'ready' });
</script></body></html>`;
}
