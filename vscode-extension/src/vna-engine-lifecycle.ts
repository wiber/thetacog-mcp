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
import { appendFileSync, mkdirSync } from 'fs';

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

export async function bootEngine(cwd: string | undefined): Promise<{ ok: boolean; out: string }> {
    const t0 = Date.now();
    await run('launchctl', ['enable', `${domain()}/${LABEL}`]);
    const r = await run('launchctl', ['bootstrap', domain(), plistPath()]);
    logRow(cwd, { verb: 'boot', by: 'ide:pill', override: 'LLM_ACTIVE_OK', ok: r.ok, ms: Date.now() - t0, out: r.out });
    return r;
}

export async function haltEngine(cwd: string | undefined): Promise<{ ok: boolean; out: string }> {
    const t0 = Date.now();
    const r = await run('launchctl', ['bootout', `${domain()}/${LABEL}`]);
    logRow(cwd, { verb: 'halt', by: 'ide:pill', ok: r.ok, ms: Date.now() - t0, out: r.out });
    return r;
}

export function registerVnaEngineLifecycle(context: vscode.ExtensionContext, cwd: string | undefined): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.engineBoot', async () => { const r = await bootEngine(cwd); void vscode.commands.executeCommand('vna.refreshPage'); if (!r.ok) { vscode.window.showWarningMessage(`⏵ Boot: ${r.out || 'refused'}`); } }),
        vscode.commands.registerCommand('vna.engineHalt', async () => { const r = await haltEngine(cwd); void vscode.commands.executeCommand('vna.refreshPage'); if (!r.ok) { vscode.window.showWarningMessage(`⏹ Halt: ${r.out || 'refused'}`); } }));
}
