// packages/thetacog-mcp-vscode/src/vna-engine-lifecycle.ts — C167e: ⏵ Boot / ⏹ Halt THE LOCAL ENGINE ITSELF, from the 💬 Local
// Ideation pill. The name stays "Local Ideation" (operator: "ideation is not a bad name").
//
// NEVER A BARE KILL. com.thetacog.ollama is KeepAlive=true — a SIGTERM'd server respawns in 10 s (the duplicate-respawn trap
// scripts/cog/llm-pause-enforce.sh already names). BOOT is `launchctl enable` (undoes llm-pause-enforce.sh's own `bootout`,
// which also disables the job so a bare bootstrap would be refused) then `launchctl bootstrap` against the ONE plist that
// already exists (scripts/launchd/com.thetacog.ollama.plist: OLLAMA_MAX_LOADED_MODELS=1, OLLAMA_NUM_PARALLEL=1, logs to
// .thetacog/cache/ollama-serve.log). HALT is `launchctl bootout` — never SIGTERM, never `ollama stop <model>` (that evicts one
// model, not the server). No second `ollama serve` is ever spawned beside the plist.
//
// THE CLICK IS THE EXPLICIT ASK (operator 2026-09-23, on bringing it up by hand: "it should be online not offline"). Every
// boot/halt appends one row to .thetacog/engine-lifecycle.ndjson: {at, verb, by, override, ok, ms}.
//
// A KNOWN RACE, NAMED HERE RATHER THAN FIXED (found while building this, reported instead of patched — the operator's own
// instruction: llm-pause.mjs is a separate row): scripts/cog/llm-pause-enforce.sh runs on its own scheduled beat with its own
// env, so a Boot click's LLM_ACTIVE_OK only covers THIS process, not that one — if the operator is still inside the 45-minute
// active-session window when the next beat fires, the enforcer's `_gate_daemon` will `bootout` the very engine this file just
// booted, with no record that a human asked for it. This file does not touch llm-pause.mjs or its enforcer.
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { appendFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';

const LABEL = 'com.thetacog.ollama';
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = () => `gui/${typeof process.getuid === 'function' ? process.getuid() : 0}`;

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
    return new Promise((res) => execFile(cmd, args, { timeout: 15000 }, (err, so, se) => res({ ok: !err, out: ((so || '') + (se || '')).trim().slice(0, 300) })));
}

function logRow(cwd: string | undefined, row: Record<string, unknown>): void {
    if (!cwd) { return; }
    try {
        const p = path.join(cwd, '.thetacog', 'engine-lifecycle.ndjson');
        mkdirSync(path.dirname(p), { recursive: true });
        appendFileSync(p, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
    } catch { /* the click still ran the launchctl commands — a missing workspace never blocks the boot/halt itself */ }
}

// C2300 — LOCAL MODELS ARE AN EXPERIMENTAL FEATURE, OFF BY DEFAULT (operator 2026-11-03: "It's an experimental feature using local LLMs.
// We don't need it for anything" · "disable all of those surfaces so that they don't cause this kind of issue ever again"). The one
// reader every local-model surface in this extension asks: the 💬 chat's model call, ⏵ Boot, and the local-engine pick.
export function localModelsEnabled(): boolean {
    return vscode.workspace.getConfiguration('thetacog').get<boolean>('experimental.localModels', false) === true;
}
export const LOCAL_MODELS_OFF = 'Local models are an experimental feature and are off. To use one, turn on "ThetaCog › Experimental: Local Models" in Settings; nothing here loads a model until you do.';

// C2300: the allow window the tick's enforcer reads (scripts/cog/llm-pause.mjs localAllowed); hours 0 closes it
function allowWindow(cwd: string | undefined, hours: number): void {
    if (!cwd) return;
    const p = path.join(cwd, '.thetacog', 'llm-allow');
    try {
        if (hours <= 0) { if (existsSync(p)) unlinkSync(p); return; }
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, JSON.stringify({ until: new Date(Date.now() + hours * 3600e3).toISOString(), by: 'ide:boot', at: new Date().toISOString() }) + '\n');
    } catch { /* the boot still runs; without the window the next tick unloads it, which is the safe direction */ }
}

export async function bootEngine(cwd: string | undefined): Promise<{ ok: boolean; out: string }> {
    const t0 = Date.now();
    if (!localModelsEnabled()) { logRow(cwd, { verb: 'boot', by: 'ide:pill', ok: false, refused: 'experimental.localModels off' }); return { ok: false, out: LOCAL_MODELS_OFF }; }
    await run('launchctl', ['enable', `${domain()}/${LABEL}`]);
    const r = await run('launchctl', ['bootstrap', domain(), plistPath()]);
    // C2300 (operator 2026-11-03: "It has to only spin up if we allow it to"): local models are off by default, so the Boot click is
    // the allow — it opens a two-hour window the tick's enforcer honours (.thetacog/llm-allow) and starts the server, which no longer
    // starts at load or keeps itself alive (RunAtLoad/KeepAlive false in com.thetacog.ollama.plist).
    allowWindow(cwd, 2);
    const k = await run('launchctl', ['kickstart', `${domain()}/${LABEL}`]);
    logRow(cwd, { verb: 'boot', by: 'ide:pill', override: 'llm-allow 2h', ok: r.ok || k.ok, ms: Date.now() - t0, out: r.out || k.out });
    return { ok: r.ok || k.ok, out: r.out || k.out };
}

export async function haltEngine(cwd: string | undefined): Promise<{ ok: boolean; out: string }> {
    const t0 = Date.now();
    const r = await run('launchctl', ['bootout', `${domain()}/${LABEL}`]);
    allowWindow(cwd, 0);   // C2300: Halt closes the allow window, so nothing automatic brings it back
    logRow(cwd, { verb: 'halt', by: 'ide:pill', ok: r.ok, ms: Date.now() - t0, out: r.out });
    return r;
}

// C2300a — FORCE UNLOAD EVERY RESIDENT MODEL, NOW (operator 2026-11-05, verbatim: "a way to force unload local llms (all of
// them) with a checkbox or something"). Reuses the one unload path llm-pause.mjs/llm-pause-enforce.sh already carry (C2300):
// `node scripts/cog/llm-pause.mjs --unload-all` closes the allow window, then force-evicts every model `ollama ps` (or
// `/api/ps`) reports, boots the agent out, and sweeps a stray `ollama runner` process — unconditionally, even past an open
// allow window or an admitted bench (C2300a's --force on llm-pause-enforce.sh). It never LOADS a model. Called directly off
// the workspace path, never through doorCommand/DOORS: this is the operator's own machine, not a published npx door — adding
// one would mean syncing three more tables (commands.ts/server.js/door-cmd.mjs) for a button that is never used away from home.
export async function unloadAllNow(cwd: string | undefined): Promise<{ ok: boolean; out: string }> {
    if (!cwd) { return { ok: false, out: 'no workspace open — unload-all needs the repo folder' }; }
    const script = path.join(cwd, 'scripts', 'cog', 'llm-pause.mjs');
    if (!existsSync(script)) { return { ok: false, out: 'scripts/cog/llm-pause.mjs not found in this workspace' }; }
    const t0 = Date.now();
    const r = await run('node', [script, '--unload-all']);
    logRow(cwd, { verb: 'unload-all', by: 'ide:pill', ok: r.ok, ms: Date.now() - t0, out: r.out });
    return r;
}

export function registerVnaEngineLifecycle(context: vscode.ExtensionContext, cwd: string | undefined): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.engineBoot', async () => { const r = await bootEngine(cwd); void vscode.commands.executeCommand('vna.refreshPage'); if (!r.ok) { vscode.window.showWarningMessage(`⏵ Boot: ${r.out || 'refused'}`); } }),
        vscode.commands.registerCommand('vna.engineHalt', async () => { const r = await haltEngine(cwd); void vscode.commands.executeCommand('vna.refreshPage'); if (!r.ok) { vscode.window.showWarningMessage(`⏹ Halt: ${r.out || 'refused'}`); } }),
        // C2300a — the command: an explicit, bounded, one-shot "force unload ALL of them now" — runnable any time, boot or no boot.
        vscode.commands.registerCommand('vna.unloadAllLocalModels', async () => {
            const r = await unloadAllNow(cwd); void vscode.commands.executeCommand('vna.refreshPage');
            const last = (r.out || '').trim().split('\n').pop() || (r.ok ? 'done' : 'failed');
            if (!r.ok) { vscode.window.showWarningMessage(`⏹ Unload all local models: ${last}`); } else { vscode.window.showInformationMessage(`⏹ Unload all local models — ${last}`); }
        }),
        // C2300a — THE CHECKBOX IS THE OTHER DOOR: unticking "ThetaCog › Experimental: Local Models" force-unloads everything
        // right then, rather than only blocking the next load. Idempotent and cheap (see llm-pause-enforce.sh), so an extra
        // fire from VS Code re-saving an unchanged value costs nothing. Never fires on turning it ON — that only opens the door.
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration('thetacog.experimental.localModels')) { return; }
            if (!localModelsEnabled()) { void unloadAllNow(cwd); }
        }));
}
