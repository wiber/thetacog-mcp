// packages/thetacog-mcp-vscode/src/vna-chat-inline.ts — C167g THE CHAT IS AN INLINE FORM IN THE STEER PAGE ITSELF, NEVER A
// SECOND WINDOW (operator 2026-09-23, verbatim: "it should just be a web form style chat box alternate way to inspect / run /
// control the steer not opening a new window (pop out maybe)"). Measured the same night: the pill posted vna.openChat, the
// installed extension was 0.3.34 while the source was 0.3.35, and the window said "vna.openChat is not registered" — a
// version-mismatch toast a SECOND registered command can always hit again. The inline form needs no new command at all: it
// rides the steer sidebar's OWN webview message channel (vna-view.ts's onDidReceiveMessage, already wired, already installed),
// posting {type:'chatInline', text} and reading {type:'chatInlineStage'|'chatInlineToken'|'chatInlineDone'} back — the same
// shape every existing pill's `go(cmd)` relay already proves works in this exact window.
//
// C167i EVERY SEND SHOWS ITS STATE UNTIL IT ENDS — NEVER A SILENT DOT (operator 2026-09-23, verbatim: "add another to make
// sure we get visual feedback here, not just it flips off screen"). Seen live: 'what can you do?' produced a lone '·' forever
// while the status line read 'qwen2.5-coder:3b not installed' — the send went to a model not on disk and the failure never
// reached the page. Fixed two ways: (1) the model fallback (chat-core.js resolveModel, C167e) now runs BEFORE the send, never
// after, so a missing preset tag resolves to an installed one first; (2) a 'chatInlineStage' message names every phase a send
// passes through — sending → streaming → done/error/timeout — with enough in each payload (model, tok, tps, ms, error) that
// the page never has nothing to show. No auto-cancel at 15 s — the state just says so and offers the door; the user decides.
//
// TWO ROUTES, ONE LINE OF TEXT: a line whose first word is a steer.mjs subcommand (status · next · run · asks · close · plan)
// spawns `node scripts/vna/steer.mjs <verb>` through the SAME npx-away-from-home door every other spawn in this extension uses
// (doorCommand, commands.ts) and streams its stdout/stderr back chunk by chunk as it arrives — never buffered whole, so a long
// `run` is visible while it works, the same promise C168c makes for the runner card. Any other line goes to the picked local
// model, through media/chat-core.js's streamChat — the ONE core vna-chat.ts's own webview, chat-bridge.mjs's probe and the
// guards all load — reused here via require(), never re-implemented. The steer sidebar's CSP does not allow it to fetch
// localhost itself (unlike the dedicated chat VIEW, whose CSP explicitly permits it); this file makes that call on the
// EXTENSION HOST instead (global fetch, Node 18+) and forwards tokens over postMessage, so the form never needs a wider CSP.
//
// LLM-FREE EXCEPT THE EXPLICIT ASK: exactly like vna-chat.ts, streamChat runs only when this function is called, which only
// happens on the page's send — never on a timer, never in the background.
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { doorCommand } from './commands';

// C239a — THE RUNNER ENV DOOR IS INJECTED, NEVER IMPORTED. Every steer.mjs door below spawns on runnerEnvDoor() — the ⚙️ Engine &
// Keys keys ride it, never `{ cwd }` alone (measured 2026-09-24: 103/103 claude workers dispatched from the chat had key_source
// "none"). vna-engines.ts owns runnerEnv() but needs `vscode` at runtime (SecretStorage), and THIS module is loaded compiled, in
// plain node, by the thirteen guards that drive the chat host's handler (c167h … c224) with no vscode on the path — a static
// import broke every one of them at require time. So extension.ts wires runnerEnv() in at activation (setRunnerEnvDoor), and
// unwired — a guard's process — the door is this host's own env, exactly what the spawn inherited before C239a.
export type RunnerEnvDoor = () => Promise<Record<string, string>>;
const inheritedEnv: RunnerEnvDoor = async () => { const env: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) { if (v !== undefined) { env[k] = v; } } return env; };
let runnerEnvDoor: RunnerEnvDoor = inheritedEnv;
export function setRunnerEnvDoor(door: RunnerEnvDoor | null): void { runnerEnvDoor = door || inheritedEnv; }

// C167h PERSISTENCE — the conversation survives pop-out ↔ inline and a window reload (operator: "no persistence? does it
// even execute?"). ONE shared file, .thetacog/chat/session.ndjson, one row per turn {role, content, at} — written by BOTH
// surfaces (this file's handleChatInline for the inline form, vna-chat.ts's onMessage 'send'/'clear' for the dedicated
// view) and read by both on their own 'ready', so opening either one after the other shows the same transcript. The tree
// never reads this file unless a message is explicitly 🌳 Fold to Tree'd (clipIngest) — an ordinary turn is not spec mass.
// THE LIVE SESSION FILE HAS ITS OWN ISOLATION DOOR, LIKE EVERY OTHER LIVE-STATE FILE IN THIS EXTENSION
// (tests/vna/_hermetic.mjs pins ~20 of them — VNA_STEER_METRICS, VNA_CHAT_PROBE, VNA_ENGINE_JSON, …). Before this,
// sessionPath derived PURELY from `cwd`, so any caller that ever hands this function a `cwd` other than its own
// fixture directory (a mismatched fixture-vs-cwd argument, a debug script, a future bug) writes straight into the
// OPERATOR'S REAL .thetacog/chat/session.ndjson — seen: rows 14 and 16 of the real file were an envelope.mjs ENOENT
// stack trace naming a c201a-* temp fixture path, appended as if it were the assistant's answer. VNA_CHAT_SESSION
// wins over `cwd` when set, exactly like every other override in _hermetic.mjs, so a test process is isolated even
// when the `cwd` it was handed is wrong.
function sessionPath(cwd: string | undefined): string | null {
    if (process.env.VNA_CHAT_SESSION) { return process.env.VNA_CHAT_SESSION; }
    return cwd ? path.join(cwd, '.thetacog', 'chat', 'session.ndjson') : null;
}
export function appendChatTurn(cwd: string | undefined, role: 'user' | 'assistant', content: string): void {
    const p = sessionPath(cwd); if (!p) { return; }
    try { mkdirSync(path.dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ role, content, at: new Date().toISOString() }) + '\n'); } catch { /* the turn still reached the model/page — persistence is additive, never a gate on the send itself */ }
}
export function readChatHistory(cwd: string | undefined): Array<{ role: string; content: string; at: string }> {
    const p = sessionPath(cwd); if (!p || !existsSync(p)) { return []; }
    try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
// C246 — THE CHAIN OF THOUGHT IS KEPT BESIDE THE REPLY, INSPECTABLE FROM CLAUDE CODE (operator 2026-09-23, verbatim: *"Make it /steerchat and make the cot
// inspected from here"*): every model turn on either chat surface appends {at, surface, model, prompt, thinking, reply, ms, tokens}
// to .thetacog/chat/cot.ndjson — append-only, one row per turn, VNA_CHAT_COT isolating a guard's process like VNA_CHAT_SESSION.
// scripts/vna/steerchat.mjs cot reads it; the answer the page shows never carries the thinking.
export function cotPath(cwd: string | undefined): string | null {
    if (process.env.VNA_CHAT_COT) { return process.env.VNA_CHAT_COT; }
    return cwd ? path.join(cwd, '.thetacog', 'chat', 'cot.ndjson') : null;
}
export function appendChatCot(cwd: string | undefined, row: { surface: string; model: string; prompt: string; thinking?: string; reply?: string; ms?: number; tokens?: number; ok?: boolean; error?: string | null }): void {
    const p = cotPath(cwd); if (!p) { return; }
    try { mkdirSync(path.dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n'); } catch { /* the turn still answered — the CoT log is additive */ }
}
export function clearChatHistory(cwd: string | undefined): void {
    const p = sessionPath(cwd); if (!p) { return; }
    try { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, ''); } catch { /* the webview's own memory still cleared */ }
}

const STEER_VERBS = new Set(['status', 'next', 'run', 'until', 'asks', 'close', 'plan', 'loop']);   // C277: loop on|off|status   // steer.mjs's own subcommands, named in the spec row (C201a adds until; plan = until --dry-run, $0)
/** C298 (2) — the ONE verb list, as an array: the host posts it to the chat page (vna-chat.ts 'hostRules'), so the page's bare-verb test
 *  and this set can never disagree again (media/chat.js carried its own regex without `loop` until C298). */
export const STEER_VERB_LIST: readonly string[] = Object.freeze([...STEER_VERBS]);
/** C201 — the steer verb a chat line names, if any: `status` or `/steer status` (the operator types the slash form) → 'status'; else null. One reader for both chat surfaces. */
export function steerVerbOf(text: string): string | null {
    const w = String(text || '').trim().replace(/^\/steer\b\s*/i, '').split(/\s+/)[0].toLowerCase();
    if (STEER_VERBS.has(w)) { return w; }
    return /^\/steer\s*$/i.test(String(text || '').trim()) ? 'status' : null;
}
/**
 * C210 — the whole /steer line a chat message names, as steer.mjs argv, or null (operator 2026-09-23: "/steer should work", on
 * `/steer research where we are` getting no answer — "research" is not a verb, so it fell through to the model). A bare `/steer` is
 * status; `/steer <verb> …` or a bare verb is that verb; ANY other `/steer <text>` is the /steer door itself — steer.mjs "<text>",
 * which declares the asks as rows, sets the goal and dispatches, printing its driver and spend ceiling first (C110). Typed by the
 * operator only: a MODEL's fenced line stays on modelVerbOf, which accepts named verbs and never free text.
 */
export function steerLineOf(text: string): string[] | null {
    const t = String(text || '').trim();
    const v = steerVerbOf(t); if (v) { return [v, ...t.replace(/^\/steer\b\s*/i, '').split(/\s+/).filter(Boolean).slice(1)]; }
    const m = /^\/steer\s+([\s\S]+)$/i.exec(t);
    return m ? [m[1].trim()] : null;
}
/** C201 — spawn steer.mjs <verb> through the one npx/node door and stream it; the chat view's route onto the same command the inline form runs */
// C217 — ⏹ STOPS A /steer RUN: `signal` is the chat's own AbortController for this turn; aborting it sends SIGTERM to the child,
// so the turn ends, `done` posts and Send comes back (operator 2026-09-23: "cant send to break, or stop the process the button si frozen").
export const STOP_LINE = "\n⏹ stopped — the /steer run was ended from the chat; nothing it had not already written is kept";
export function runSteerVerb(cwd: string | undefined, verb: string, onText: (t: string) => void, args: string[] = [], signal?: AbortSignal): Promise<{ ok: boolean; out: string; error?: string }> {
    return new Promise((res) => {
        if (!cwd) { res({ ok: false, out: '', error: 'no workspace open — /steer needs a folder' }); return; }
        const c = doorCommand(cwd, 'scripts/vna/steer.mjs', [verb, ...args]);
        if (!c.runnable) { res({ ok: false, out: '', error: c.display }); return; }
        // C239a — the runner env, read fresh at spawn: this host's env minus the Claude Code markers plus the ⚙️ Engine & Keys keys
        // (engineSecretEnv). Measured 2026-09-24: 103/103 claude workers dispatched through this door had key_source "none" — it spawned
        // with { cwd } alone, so steer-runner's keyedEnv() never saw the key the operator had just set. Same door as ⚡ Run Headless.
        void runnerEnvDoor().then((env) => {
            let out = '';
            const child = spawn(c.file, c.args, { cwd, env: { ...env, VNA_STEER_OWNER: 'chat', VNA_KEEP_AUTO: '1' } });   // C277: an ask from the chat ticks ↻
            let stopped = false;
            const stop = () => { stopped = true; try { child.kill('SIGTERM'); } catch { /* already gone */ } };
            if (signal) { if (signal.aborted) { stop(); } else { signal.addEventListener('abort', stop, { once: true }); } }
            child.stdout.on('data', (d) => { const s = d.toString(); out += s; onText(s); });
            child.stderr.on('data', (d) => { const s = d.toString(); out += s; onText(s); });
            child.on('error', (e) => res({ ok: false, out, error: String(e.message || e) }));
            child.on('close', (code) => { if (signal) { signal.removeEventListener('abort', stop); } res({ ok: code === 0 && !stopped, out: stopped ? out + STOP_LINE : out, error: stopped ? 'stopped' : code === 0 ? undefined : `exit ${code}` }); });
        }, (e) => res({ ok: false, out: '', error: `runner env: ${String((e as Error).message || e)}` }));
    });
}
/**
 * C224 — `/workers` lists the running /steer workers, numbered; `/end <n|row|all>` ends them (operator 2026-09-23: "list them
 * somehow in the chat so they can be ended?", after gemma sat on an empty bubble behind two goose/qwen3:8b workers). Typed by the
 * operator only, host-run through scripts/vna/workers.mjs — never the model, and never a pid the line names: end resolves a number,
 * a row label or `all` against a fresh process list, so it can only signal a steer-runner and its own descendants.
 */
export function workersLineOf(text: string): string[] | null {
    const t = String(text || '').trim();
    if (/^\/workers$/i.test(t)) { return ['list']; }
    const m = /^\/end(?:\s+(\S+))?$/i.exec(t);
    return m ? ['end', ...(m[1] ? [m[1]] : [])] : null;
}
export function runWorkersVerb(cwd: string | undefined, argv: string[]): Promise<{ ok: boolean; out: string }> {
    return new Promise((res) => {
        if (!cwd) { res({ ok: false, out: 'no workspace open — /workers needs a folder' }); return; }
        const c = doorCommand(cwd, 'scripts/vna/workers.mjs', argv);
        if (!c.runnable) { res({ ok: false, out: c.display }); return; }
        execFile(c.file, c.args, { cwd, timeout: 10000, env: { ...process.env, VNA_WORKERS_BY: 'ide:chat' } }, (err, so, se) => res({ ok: !err, out: String(so || '') + String(se || '') }));
    });
}
/** C277 — the ↻ box's host door: scripts/vna/keep-running.mjs on|off|status, through the same npx/node door as /workers */
export function runKeepVerb(cwd: string | undefined, argv: string[]): Promise<{ ok: boolean; out: string }> {
    return new Promise((res) => {
        if (!cwd) { res({ ok: false, out: 'no workspace open' }); return; }
        const c = doorCommand(cwd, 'scripts/vna/keep-running.mjs', argv);
        if (!c.runnable) { res({ ok: false, out: c.display }); return; }
        execFile(c.file, c.args, { cwd, timeout: 15000, env: { ...process.env, VNA_STEER_OWNER: 'ui-checkbox' } }, (err, so, se) => res({ ok: !err, out: String(so || '') + String(se || '') }));
    });
}
// C207 THE CONTROL MODEL CALLS /steer ITSELF, AND ANSWERS FOR IT (operator 2026-09-23, verbatim: "the air control loop from
// first controller from Gemma whatever through the extension needs to be able to call the terminal command so actually execute
// the sub agents as well. They need to be responsible."). An ACTION is exactly ONE fenced block whose whole content is one line
// `/steer <verb> [args]` — a verb mentioned in prose, or a bare unfenced `/steer status`, is talk, never an action. The host
// runs the fenced verb through the SAME route a typed verb takes (runSteerVerb → steer.mjs, C201a (4)), so `run` and `until`
// print their driver and spend ceiling before anything is dispatched exactly as they do for a human. RESPONSIBLE: before the
// verb runs, a walk-tape row (source chat-model · model tag · verb · args · the reply's sha) is written through the one door
// (scripts/vna/chat-model-verb.mjs → lensWalk), and the streamed output opens with "▶ ran by <model>" so a reader sees who fired it.
export const PAID_VERBS = new Set(['run', 'until']);
const FENCE_RE = /```[a-z]*\s*\n([\s\S]*?)\n?```/gi;
export function modelVerbOf(reply: string): { verb: string; args: string[]; line: string } | null {
    const text = String(reply || ''); let m: RegExpExecArray | null; FENCE_RE.lastIndex = 0;
    while ((m = FENCE_RE.exec(text))) {
        const body = m[1].trim(); if (!body || /\n/.test(body)) { continue; }   // one line, or it is not an action
        const line = body.replace(/^\$\s*/, '');
        if (!/^\/steer\b/i.test(line)) { continue; }
        const parts = line.replace(/^\/steer\b\s*/i, '').split(/\s+/).filter(Boolean);
        const verb = (parts[0] || 'status').toLowerCase();
        if (!STEER_VERBS.has(verb)) { continue; }
        return { verb, args: parts.slice(1), line: `/steer ${[verb, ...parts.slice(1)].join(' ')}` };
    }
    return null;
}
/** the tape row, written BEFORE the verb runs, through the one door; never throws — a failed write is returned as its own why */
export function recordModelVerb(cwd: string | undefined, model: string, verb: string, args: string[], reply: string): Promise<{ ok: boolean; row: Record<string, unknown> | null; why?: string }> {
    return new Promise((res) => {
        if (!cwd) { res({ ok: false, row: null, why: 'no workspace' }); return; }
        const c = doorCommand(cwd, 'scripts/vna/chat-model-verb.mjs', ['--model', model, '--verb', verb, '--args', JSON.stringify(args)]);
        if (!c.runnable) { res({ ok: false, row: null, why: c.display }); return; }
        let out = '';
        try {
            const child = spawn(c.file, c.args, { cwd });
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.on('error', (e) => res({ ok: false, row: null, why: String(e.message || e) }));
            child.on('close', (code) => { let row: Record<string, unknown> | null = null; try { row = JSON.parse(out.trim().split('\n').pop() || 'null'); } catch { row = null; } res({ ok: code === 0 && !!row && !!(row as any).ok, row, why: code === 0 ? undefined : `exit ${code}` }); });
            child.stdin.end(reply);
        } catch (e) { res({ ok: false, row: null, why: String((e as Error).message || e) }); }
    });
}
/**
 * C201 (3) THE CHAT IS WIRED TO THE TREE — the steer state a chat turn is composed with, and the tape row the turn writes, through
 * one relay (scripts/vna/chat-context.mjs: the snowball sidecar for the active leaf, its contract row, the open rows, `steer.mjs
 * status`; the row goes through lensWalk with source `chat`, the leaf id and the context's sha). Never throws: no workspace, no
 * door, or a failed spawn returns an empty context and its why — the turn still reaches the model, the gap is said in the system line.
 */
export function chatContextFor(cwd: string | undefined, model: string, prompt: string): Promise<{ ok: boolean; context: string; leaf: string | null; context_sha: string | null; row: Record<string, unknown> | null; why?: string }> {
    const none = (why: string) => ({ ok: false, context: `THE STEER STATE could not be read this turn (${why}) — say so rather than guess.`, leaf: null, context_sha: null, row: null, why });
    return new Promise((res) => {
        if (!cwd) { res(none('no workspace open')); return; }
        const c = doorCommand(cwd, 'scripts/vna/chat-context.mjs', ['--model', model]);
        if (!c.runnable) { res(none(c.display)); return; }
        let out = '';
        try {
            const child = spawn(c.file, c.args, { cwd });
            const kill = setTimeout(() => child.kill(), 15000);
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.on('error', (e) => { clearTimeout(kill); res(none(String(e.message || e))); });
            child.on('close', (code) => {
                clearTimeout(kill);
                let j: any = null; try { j = JSON.parse(out.trim().split('\n').pop() || 'null'); } catch { j = null; }
                if (!j || !j.ok) { res(none(code === 0 ? 'the relay printed no JSON' : `exit ${code}`)); return; }
                res({ ok: true, context: String(j.context || ''), leaf: j.leaf || null, context_sha: j.context_sha || null, row: j.row || null, why: j.why || undefined });
            });
            child.stdin.end(String(prompt || ''));
        } catch (e) { res(none(String((e as Error).message || e))); }
    });
}
/** C207 — act on a finished model reply: parse the one fenced verb, record it, run it on the typed-verb route. Returns acted:false (and runs nothing) when the reply carries no fenced verb.
 *  C217 — `signal` is the turn's own AbortController: ⏹ aborts it, runSteerVerb SIGTERMs the child the model started, and the turn ends. Before this the
 *  signal stopped at the model stream — a `/steer until` a model fired ran on after ⏹ exactly as a typed one had before C217. */
export async function actOnModelReply(cwd: string | undefined, model: string, reply: string, onText: (t: string) => void, signal?: AbortSignal): Promise<{ acted: false } | { acted: true; verb: string; args: string[]; line: string; ok: boolean; out: string; error?: string; row: Record<string, unknown> | null; rowWhy?: string }> {
    const mv = modelVerbOf(reply); if (!mv) { return { acted: false }; }
    if (signal && signal.aborted) { return { acted: true, verb: mv.verb, args: mv.args, line: mv.line, ok: false, out: '⏹ stopped before the run started', error: 'stopped', row: null, rowWhy: 'stopped before the tape row' }; }
    const rec = await recordModelVerb(cwd, model, mv.verb, mv.args, reply);
    const head = `\n▶ ran by ${model} · ${mv.line}${PAID_VERBS.has(mv.verb) ? ' · PAID — the plan and spend ceiling print first' : ''}${rec.ok ? '' : ` · tape row NOT written (${rec.why || 'unknown'})`}\n`;
    onText(head);
    const r = await runSteerVerb(cwd, mv.verb, onText, mv.args, signal);
    return { acted: true, verb: mv.verb, args: mv.args, line: mv.line, ok: r.ok, out: head + r.out, error: r.error, row: rec.row, rowWhy: rec.why };
}
const OLLAMA_SLOT = 'vna.engine.OLLAMA_HOST';   // C166's SecretStorage slot — read-only here, the same slot vna-chat.ts reads
const MODEL_KEY = 'vna.chat.model';             // the tag C167e's chat view last picked — reused, never a second selection
// C167i — "a send with no first token in 15 s"; overridable so the guard's hang scenario does not wait 15 real seconds
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.VNA_CHAT_TIMEOUT_MS) || 15000;
// C167j (operator: "asked it to bash open a txt file of what it can do, gues it cannot do that?") — a bare /api/chat model is
// text only: no shell, no files, no edits. 'help' is HOST-handled, never sent to the model, so it always answers correctly.
export const HELP_RE = /^(help|what can you do\??|capabilities)$/i;
// a bounded, named heuristic (never a claim of true intent-detection) — the operator's own example ("bash open a txt file")
// is exactly an action-verb + a file/shell noun; a chat-mode ask shaped like that is refused BEFORE it reaches the model,
// which cannot act on it anyway and would otherwise improvise a promise it cannot keep
export const TOOL_ASK_RE = /\b(bash|open|run|execute|shell|edit|save|write|create|delete|move|rename|install|pull)\b[^.?!\n]{0,40}\b(file|files|txt|script|shell|terminal|folder|directory|disk|repo)\b/i;
export const TOOL_REFUSAL = "chat mode has no tools — try: help · or pick a local tag under 'subagent hands' for a goose worker";
// C314 addendum (2026-09-25) — "what can you do" MUST answer without a model call: measured live, gemma2:2b answered
// "I'm a text model, no tools" to "show me a list of your skills / reports you can do" and to "can you run sh / skills",
// even though the STEER VERBS line was already in its own system context — a 2B model does not reliably use context it
// was not asked to restate verbatim. So a capability ask is intercepted the same way `help` already is (C298), and
// answered from the DERIVED menu (scripts/vna/house-menu.mjs), never the model. Kept as a full-sentence-shape match
// (never a bare .includes) so "the menu bar is broken" — which merely CONTAINS the token "menu" — does not fire; that
// is the token-vs-construct trap CLAUDE.md names. Mirrors house-menu.mjs's own MENU_ASK_RE byte-for-byte (that copy is
// the one a pure-node test drives without vscode; this one is what the extension host actually asks).
const MENU_WORD = '(?:menu|skills|reports|commands)';
export const MENU_ASK_RE = new RegExp(
    '^(?:' + [
        '/menu',
        MENU_WORD,
        'what can you (?:do|run)',
        `what ${MENU_WORD} can you (?:do|run)`,
        `list (?:your |the )?(?:/\\s*)?${MENU_WORD}(?:\\s*/\\s*${MENU_WORD})?(?:\\s+you can (?:do|run|use))?`,   // C320
        `(?:show|give) me (?:a |the )?list of (?:your |the )?${MENU_WORD}(?:\\s*/\\s*${MENU_WORD})?(?:\\s+you can (?:do|run))?`,
        `can you run [a-z /]*${MENU_WORD}`,
    ].join('|') + ')(?:[.?!]*$|\\s*[,;])', 'i',   // C320: may run on past a comma
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any = null;
function loadCore(extensionPath: string) { if (!core) { core = require(path.join(extensionPath, 'media', 'chat-core.js')); } return core; }

// C167i.4 ⏹ cancel — one in-flight request at a time (the inline form's own UI sends one at a time); the page's cancel
// button posts {type:'chatInlineCancel'} with no payload, so there is exactly one controller to abort
let inflight: AbortController | null = null;

export function cancelChatInline(): void { if (inflight) { inflight.abort(); inflight = null; } }

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ ok: boolean; out: string }> {
    return new Promise((res) => execFile(cmd, args, { cwd: opts.cwd, timeout: 8000 }, (err, so, se) => res({ ok: !err, out: (so || '') + (se || '') })));
}

/**
 * C167j — what this chat can and cannot do, read off the record (never typed by hand each time): the resolver's own status
 * line names the engine, the model in use and the preset (the checkbox state); the CANNOT-do list is fixed, since a bare
 * /api/chat model never gains tools no matter what is installed. Returned as plain text — written to disk, shown to the
 * model as its system line, and printed in the box, all from this one function so the three never drift apart.
 */
export async function buildCapabilities(cwd: string | undefined): Promise<string> {
    let engineLine = '[Runner: UNMEASURED]'; let preset = 'UNMEASURED';
    // C297 — through the one command table like every other spawn: in a foreign repo this is `npx thetacog-mcp runner-resolver`,
    // never a bare `node scripts/vna/…` that exists only in this tree and read UNMEASURED there
    const rc = cwd ? doorCommand(cwd, 'scripts/vna/runner-resolver.mjs', ['status', '--json']) : null;
    if (cwd && rc && rc.runnable) {
        const r = await run(rc.file, rc.args, { cwd });
        try { const j = JSON.parse((r.out.split('\n').filter((l) => l.trim().startsWith('{')).pop()) || '{}'); if (j.line) { engineLine = j.line; } if (j.preset) { preset = j.preset; } } catch { /* UNMEASURED stands */ }
    }
    return [
        'ThetaCog Steer chat — what this chat can and cannot do',
        '',
        `STEER VERBS (host-run, streamed into this box): ${[...STEER_VERBS].join(' · ')} — run and until print the driver and the spend ceiling before they start; plan is until --dry-run ($0, no row, no worker)`,
        'WORKERS (host-run, typed by the operator): /workers lists the running /steer workers, numbered · /end <n|row|all> ends them — a worker on the local model server makes this chat wait behind it',
        '/menu (or "skills", "reports", "commands", "list your skills") — the full derived list of every skill and door, host-printed, zero model calls. A READ entry runs on `door <id>`; everything else hands back the exact command/slash.',
        `ENGINE IN USE: ${engineLine}`,
        `SUBAGENT PRESET (the 'subagent hands' dropdown): ${preset} — a local tag = goose-local, claude -p = claude-code-headless`,
        '',
        'TO ACT (C207): reply with exactly ONE fenced code block whose only line is `/steer <verb> [args]` — the host runs it on the same route a typed verb takes, writes a tape row naming you (source chat-model), and shows "▶ ran by <model>" above the output. run and until are PAID and print their plan and spend ceiling first. A verb outside a fence is talk, never an action.',
        'CHAT MODE CANNOT: open a file, run a shell command, or edit code. A bare /api/chat reply is text only — the fenced /steer line above is the one exception, and the host runs it, not you.',
        'WHERE THAT LIVES INSTEAD:',
        ' · pick a local tag under "subagent hands" (the 💬 pill, or ⚙️ Engine & Keys) — dispatches through goose, which has shell + edit tools (C168g)',
        ' · ⚡ Run Headless — the full worker, whichever engine is picked',
        '',
        'A reply here never claims to have opened, run, or edited anything — it could not have.',
        'WHAT YOU CAN SEE: the steer state below (goal, active leaf and its contract, open rows, /steer status) is read off the repo and pasted here every turn — answer from it; never ask the operator to paste the spec.',
    ].join('\n');
}

/**
 * C298 (1) THE HOST ANSWERS BEFORE THE MODEL, ON EVERY CHAT SURFACE — one rule, one place. `help` (HELP_RE) is answered from
 * buildCapabilities and a tool-shaped ask (TOOL_ASK_RE) is refused with TOOL_REFUSAL, never sent to a model that cannot act on it.
 * Until C298 only handleChatInline asked these, and C201b moved the live chat to vna-chat.ts, which sent both to the model.
 * Both surfaces call THIS function; the caller asks it only for a line that would otherwise reach the model (a typed /steer
 * line such as `/steer write the missing test file` is the /steer door, never a refused tool ask).
 */
export function hostAnswerKind(text: string): 'help' | 'menu' | 'refuse' | null {
    const t = String(text || '').trim();
    // HELP_RE first — it already owns 'help' / 'what can you do(?)' / 'capabilities' (C167j, C298: those three print
    // buildCapabilities' text, done.steer === 'help', and a guard pins it) — MENU_ASK_RE's own 'what can you do'
    // alternative only ever fires for phrasings HELP_RE does not own ('what can you run', 'skills', 'list your skills', …).
    if (HELP_RE.test(t)) { return 'help'; }
    if (MENU_ASK_RE.test(t)) { return 'menu'; }   // C314 — also checked before a tool-ask refusal or the model
    if (TOOL_ASK_RE.test(t)) { return 'refuse'; }
    return null;
}
/** C298 (1) — the help answer: the capabilities text, written to .thetacog/chat/capabilities.txt and opened (darwin, never under a guard) */
export async function writeCapabilities(cwd: string | undefined): Promise<{ text: string; capPath: string | null }> {
    const text = await buildCapabilities(cwd);
    let capPath: string | null = null;
    if (cwd) {
        capPath = path.join(cwd, '.thetacog', 'chat', 'capabilities.txt');
        try { mkdirSync(path.dirname(capPath), { recursive: true }); writeFileSync(capPath, text); } catch { capPath = null; }
    }
    // VNA_CHAT_NO_OPEN=1 — a guard's own process, never a real window: the file write and the box's printed text are
    // the actual answer, `open` is a courtesy on top of it and must never fire from an automated test run
    if (capPath && process.platform === 'darwin' && process.env.VNA_CHAT_NO_OPEN !== '1') { try { execFile('open', [capPath]); } catch { /* the box still printed the text — opening is a courtesy, not the answer */ } }
    return { text, capPath };
}

// ── C314 THE CHAT KNOWS THE HOUSE — a derived menu of every skill and every door, never a hand list ──────────────
// scripts/vna/house-menu.mjs derives the menu from THIS repo's own .claude/skills/*/SKILL.md plus its own declared
// door table (operator 2026-09-25: "if it gets context with a menu of all available skills inherited .."). It is a
// property of this exact repo (there is no .claude/skills to derive away from home), so it is spawned by a plain
// node path, never through the DOORS table (doorCommand) — a foreign-repo door for it is out of scope here.
export type HouseMenuEntry = { id: string; kind: string; name: string; description: string; triggers: string[]; command: string; class: 'READ' | 'OUTWARD'; opens: string[]; paid?: boolean };
function houseMenuScript(cwd: string): string { return path.join(cwd, 'scripts', 'vna', 'house-menu.mjs'); }
/** the whole menu, as JSON, fresh every call — never cached, so a skill added mid-session is on the very next turn */
export function loadHouseMenu(cwd: string | undefined): Promise<HouseMenuEntry[]> {
    return new Promise((res) => {
        if (!cwd || !existsSync(houseMenuScript(cwd))) { res([]); return; }
        execFile(process.execPath, [houseMenuScript(cwd), '--json'], { cwd, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, so) => {
            if (err) { res([]); return; }
            try { const j = JSON.parse(String(so || '[]')); res(Array.isArray(j) ? j : []); } catch { res([]); }
        });
    });
}
/** the ready-formatted answer to a menu ask (READ, then OUTWARD, then the steer verbs) — house-menu.mjs's own text, never rebuilt here */
export function loadHouseMenuText(cwd: string | undefined): Promise<string> {
    return new Promise((res) => {
        if (!cwd || !existsSync(houseMenuScript(cwd))) { res('HOUSE MENU unavailable — no workspace open.'); return; }
        execFile(process.execPath, [houseMenuScript(cwd), '--text'], { cwd, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, so) => {
            res(err ? `HOUSE MENU unavailable (${String((err as Error).message || err)})` : String(so || ''));
        });
    });
}
/**
 * C320 THE HOST ROUTES BEFORE THE MODEL — house-menu.mjs's routeChat, asked through its --route CLI (the one place the
 * route lives; never re-derived here). { kind:'menu' } | { kind:'door', entry } | null — null means the model answers.
 * Measured live 2026-09-25: C314's routeAsk existed and neither surface called it, so "how many visitors … iamfim.com"
 * reached gemma2:2b, which said it cannot run commands. The entry comes back with the ask's window already applied.
 */
export function routeHouseAsk(cwd: string | undefined, text: string): Promise<{ kind: 'menu' } | { kind: 'door'; entry: HouseMenuEntry } | null> {
    return new Promise((res) => {
        if (!cwd || !existsSync(houseMenuScript(cwd))) { res(null); return; }
        execFile(process.execPath, [houseMenuScript(cwd), '--route', String(text || '')], { cwd, timeout: 8000, maxBuffer: 1024 * 1024 }, (err, so) => {
            if (err) { res(null); return; }
            try { const j = JSON.parse(String(so || 'null')); res(j && (j.kind === 'menu' || (j.kind === 'door' && j.entry)) ? j : null); } catch { res(null); }
        });
    });
}
/** the header a routed door prints first, so the box says which sh ran and that no model chose it */
export function routedDoorHead(entry: HouseMenuEntry): string { return `▶ door ${entry.id} · routed by the host, no model\n$ ${entry.command}\n`; }
/** the operator's own `door <id>` line, typed directly — C314: "the operator can also type door <id> directly" */
export function typedDoorIdOf(text: string): string | null {
    const m = /^door\s+([a-z0-9][\w-]*)$/i.exec(String(text || '').trim());
    return m ? m[1].toLowerCase() : null;
}
/** the model's own `door <id>` line — a fenced block whose one line is `door <id>`, the same one-fenced-line shape as modelVerbOf */
export function modelDoorLineOf(reply: string): { id: string; line: string } | null {
    const text = String(reply || ''); let m: RegExpExecArray | null; FENCE_RE.lastIndex = 0;
    while ((m = FENCE_RE.exec(text))) {
        const body = m[1].trim(); if (!body || /\n/.test(body)) { continue; }
        const dm = /^door\s+([a-z0-9][\w-]*)$/i.exec(body.replace(/^\$\s*/, ''));
        if (dm) { return { id: dm[1].toLowerCase(), line: `door ${dm[1].toLowerCase()}` }; }
    }
    return null;
}
/**
 * Run (READ) or hand back (OUTWARD, or a skill) one menu entry. An id not on the menu is a REFUSAL, never a guess.
 * An OUTWARD entry or a skill is NEVER spawned — the exact command/slash is printed and that is the whole answer,
 * exactly like a skill hand-back. Only a READ entry reaches `spawn`, on the runner env door like every other spawn
 * in this file (C239a), so the ⚙️ Engine & Keys keys ride it; `opens` fires on a clean exit, same VNA_CHAT_NO_OPEN
 * guard as writeCapabilities. `entry.command` may chain `&&` (the iamfim flow: sync, then two renders) — one shell.
 */
export function runHouseDoor(cwd: string | undefined, id: string, menu: HouseMenuEntry[], onText: (t: string) => void, signal?: AbortSignal): Promise<{ ok: boolean; out: string; refused?: boolean; entry: HouseMenuEntry | null }> {
    return new Promise((res) => {
        const entry = menu.find((e) => e.id === id) || null;
        if (!entry) { const out = `refused — no menu entry '${id}'`; onText(out); res({ ok: false, out, refused: true, entry: null }); return; }
        if (entry.class !== 'READ') {
            // never spawned — the hand-back IS the answer, streamed exactly like a READ door's own stdout so the box
            // never falls silent on an OUTWARD entry (T5b's own failure before this line: only the header arrived)
            const out = `↪ ${entry.id} is ${entry.class} (${entry.kind}) — never run here. Run this yourself:\n  ${entry.command}`;
            onText(out); res({ ok: true, out, entry });
            return;
        }
        if (!cwd) { const out = 'no workspace open — this door needs a folder'; onText(out); res({ ok: false, out, entry }); return; }
        void runnerEnvDoor().then((env) => {
            const child = spawn('/bin/sh', ['-c', entry.command], { cwd, env });
            let out = ''; let stopped = false;
            const stop = () => { stopped = true; try { child.kill('SIGTERM'); } catch { /* already gone */ } };
            if (signal) { if (signal.aborted) { stop(); } else { signal.addEventListener('abort', stop, { once: true }); } }
            child.stdout.on('data', (d) => { const s = d.toString(); out += s; onText(s); });
            child.stderr.on('data', (d) => { const s = d.toString(); out += s; onText(s); });
            child.on('error', (e) => res({ ok: false, out: out + String(e.message || e), entry }));
            child.on('close', (code) => {
                if (signal) { signal.removeEventListener('abort', stop); }
                const ok = code === 0 && !stopped;
                if (ok && process.platform === 'darwin' && process.env.VNA_CHAT_NO_OPEN !== '1') {
                    for (const p of entry.opens || []) { try { execFile('open', [path.join(cwd, p)]); } catch { /* the printed summary is still the answer */ } }
                }
                res({ ok, out: stopped ? out + STOP_LINE : out, entry });
            });
        }, () => res({ ok: false, out: 'runner env unavailable', entry }));
    });
}
/** the model's `door <id>` line, acted on: recorded on the tape FIRST (recordModelVerb, verb `door:<id>` — the same
 *  relay chat-model-verb.mjs already writes steer verbs through), then run/handed-back through runHouseDoor.
 *  `{acted:false}` when the reply named no door line at all — an OUTWARD/skill entry is never spawned even when named. */
export async function actOnModelDoor(cwd: string | undefined, model: string, reply: string, menu: HouseMenuEntry[], onText: (t: string) => void, signal?: AbortSignal): Promise<{ acted: false } | { acted: true; id: string; ok: boolean; out: string; row: Record<string, unknown> | null; rowWhy?: string }> {
    const dl = modelDoorLineOf(reply); if (!dl) { return { acted: false }; }
    const rec = await recordModelVerb(cwd, model, `door:${dl.id}`, [], reply);
    const head = `\n▶ door ${dl.id} · named by ${model}${rec.ok ? '' : ` · tape row NOT written (${rec.why || 'unknown'})`}\n`;
    onText(head);
    const r = await runHouseDoor(cwd, dl.id, menu, onText, signal);
    return { acted: true, id: dl.id, ok: r.ok, out: head + r.out, row: rec.row, rowWhy: rec.why };
}

/**
 * text → staged messages on webview: {type:'chatInlineStage', stage:'sending'|'streaming'|'timeout', ...} while it runs, each
 * token as {type:'chatInlineToken', text}, ending {type:'chatInlineDone', ok, model?, tokens?, tps?, ms?, error?, hint?}.
 * Never throws — every failure (no workspace, no npx door, offline engine, engine error, cancelled) is a staged message plus a
 * not-ok done, never a silent hang.
 */
export async function handleChatInline(webview: vscode.Webview, text: string, cwd: string | undefined, context: vscode.ExtensionContext): Promise<void> {
    const post = (m: Record<string, unknown>) => { void webview.postMessage(m); };
    const trimmed = String(text || '').trim();
    if (!trimmed) { post({ type: 'chatInlineDone', ok: false, error: 'empty' }); return; }
    appendChatTurn(cwd, 'user', trimmed);   // C167h — persisted once, regardless of which of the four routes answers it
    const verb = steerVerbOf(trimmed) || trimmed.split(/\s+/)[0].toLowerCase();   // C201: `/steer status` routes like `status`
    const t0 = Date.now();
    const hostKind = hostAnswerKind(trimmed);   // C298 (1): the one host-answer rule, shared with the sidebar chat (vna-chat.ts)
    if (hostKind === 'help') {
        post({ type: 'chatInlineStage', stage: 'sending', text: 'writing capabilities.txt', at: new Date(t0).toISOString() });
        const { text: capText, capPath } = await writeCapabilities(cwd);
        post({ type: 'chatInlineToken', text: capText });
        appendChatTurn(cwd, 'assistant', capText);
        post({ type: 'chatInlineDone', ok: true, ms: Date.now() - t0, hint: capPath ? `opened ${capPath}` : 'no workspace — printed here only' });
        return;
    }
    // C320 — a door ask runs its sh here, before the tool refusal and before any model (routeChat, house-menu.mjs)
    const routed = hostKind === 'menu' ? null : await routeHouseAsk(cwd, trimmed);
    if (routed && routed.kind === 'door') {
        post({ type: 'chatInlineStage', stage: 'sending', text: `door ${routed.entry.id}`, at: new Date(t0).toISOString() });
        const head = routedDoorHead(routed.entry); post({ type: 'chatInlineToken', text: head });
        const ctl = new AbortController(); inflight = ctl;
        const r = await runHouseDoor(cwd, routed.entry.id, [routed.entry], (t) => post({ type: 'chatInlineToken', text: t }), ctl.signal);
        if (inflight === ctl) { inflight = null; }
        appendChatTurn(cwd, 'assistant', head + r.out);
        post({ type: 'chatInlineDone', ok: r.ok, ms: Date.now() - t0, error: r.ok ? undefined : 'door failed' });
        return;
    }
    if (hostKind === 'refuse') {
        post({ type: 'chatInlineStage', stage: 'sending', text: 'checking…', at: new Date(t0).toISOString() });
        post({ type: 'chatInlineDone', ok: false, error: TOOL_REFUSAL, ms: Date.now() - t0 });
        return;
    }
    // C314 — a capability ask (menu, skills, reports, commands, "list your skills", …) is answered from the derived
    // house menu, ZERO model calls, exactly like `help` above — never sent to a 2B model that ignores its own context
    if (hostKind === 'menu') {
        post({ type: 'chatInlineStage', stage: 'sending', text: 'reading the house menu', at: new Date(t0).toISOString() });
        const menuText = await loadHouseMenuText(cwd);
        post({ type: 'chatInlineToken', text: menuText });
        appendChatTurn(cwd, 'assistant', menuText);
        post({ type: 'chatInlineDone', ok: true, ms: Date.now() - t0, hint: 'reply or type `door <id>` to run a READ entry' });
        return;
    }
    // C314 — the operator's own `door <id>` line, run/handed-back exactly like a model-issued one (no tape row: this
    // is the same treatment a typed steer verb gets versus a model-issued one, which alone is recorded)
    const typedDoorId = typedDoorIdOf(trimmed);
    if (typedDoorId) {
        post({ type: 'chatInlineStage', stage: 'sending', text: `door ${typedDoorId}`, at: new Date(t0).toISOString() });
        if (!cwd) { post({ type: 'chatInlineToken', text: 'no workspace open — a door needs a folder' }); post({ type: 'chatInlineDone', ok: false, error: 'no workspace', hint: 'open a folder first' }); return; }
        const menu = await loadHouseMenu(cwd);
        const ctl = new AbortController(); inflight = ctl;
        const r = await runHouseDoor(cwd, typedDoorId, menu, (t) => post({ type: 'chatInlineToken', text: t }), ctl.signal);
        if (inflight === ctl) { inflight = null; }
        // no separate post(r.out) here — runHouseDoor already streamed everything through onText (a READ door's own
        // stdout, or the OUTWARD/refusal message), exactly like runSteerVerb; r.out is only for the persisted transcript
        appendChatTurn(cwd, 'assistant', r.out);
        post({ type: 'chatInlineDone', ok: r.ok, ms: Date.now() - t0, error: r.refused ? 'refused' : (r.ok ? undefined : 'door failed') });
        return;
    }
    const wl = workersLineOf(trimmed);   // C224 — /workers · /end, on the same host door as the pop-out chat
    if (wl) {
        post({ type: 'chatInlineStage', stage: 'sending', text: `workers.mjs ${wl.join(' ')}`, at: new Date(t0).toISOString() });
        const r = await runWorkersVerb(cwd, wl); post({ type: 'chatInlineToken', text: r.out }); appendChatTurn(cwd, 'assistant', r.out);
        post({ type: 'chatInlineDone', ok: r.ok, ms: Date.now() - t0 });
        return;
    }
    if (STEER_VERBS.has(verb)) {
        post({ type: 'chatInlineStage', stage: 'sending', text: `running steer.mjs ${verb}`, at: new Date(t0).toISOString() });
        if (!cwd) { post({ type: 'chatInlineToken', text: 'no workspace open — /steer needs a folder' }); post({ type: 'chatInlineDone', ok: false, error: 'no workspace', hint: 'open a folder first' }); return; }
        // C217 — the typed verb runs on the ONE route (runSteerVerb: doorCommand → spawn on runnerEnvDoor, C239a) with this turn's
        // controller, so ⏹ (cancelChatInline) SIGTERMs the child. Before this the branch spawned steer.mjs itself, with no signal —
        // the child the operator started here outlived ⏹, `done` never posted and Send stayed disabled.
        const ctl = new AbortController(); inflight = ctl;
        const r = await runSteerVerb(cwd, verb, (t) => post({ type: 'chatInlineToken', text: t }), [], ctl.signal);
        if (inflight === ctl) { inflight = null; }
        if (r.error === 'stopped') { post({ type: 'chatInlineToken', text: STOP_LINE }); }   // the page sees the same stop line the transcript keeps
        if (r.out) { appendChatTurn(cwd, 'assistant', r.out); } else if (r.error) { post({ type: 'chatInlineToken', text: r.error }); }
        post({ type: 'chatInlineDone', ok: r.ok, ms: Date.now() - t0, error: r.error === 'stopped' ? 'cancelled' : r.error });
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = loadCore(context.extensionPath);
    const host = (await context.secrets.get(OLLAMA_SLOT)) || c.DEFAULT_HOST;
    const requested = context.globalState.get<string>(MODEL_KEY) || c.FALLBACK_MODEL;
    const p = await c.probe({ host });
    if (!p.online) { post({ type: 'chatInlineDone', ok: false, error: `${c.OFFLINE_LINE} · ${host}`, hint: '⏵ Boot' }); return; }
    // C167i: resolve the model (with C167e's fallback to the first installed PREFERRED_MODELS tag) BEFORE the send, never after
    const picked = c.resolveModel(requested, p.models);
    if (!picked.model) { post({ type: 'chatInlineDone', ok: false, error: picked.why, hint: `ollama pull ${picked.requested}` }); return; }
    const usingNote = picked.usedFallback ? ` — requested ${picked.requested} not installed` : '';
    post({ type: 'chatInlineStage', stage: 'sending', text: `sending to ${picked.model}${usingNote}`, model: picked.model, at: new Date(t0).toISOString() });
    const ctl = new AbortController(); inflight = ctl;
    let firstTokenAt: number | null = null; let sawTimeout = false;
    const watchdog = setTimeout(() => { if (firstTokenAt == null) { sawTimeout = true; post({ type: 'chatInlineStage', stage: 'timeout', text: `no reply after ${FIRST_TOKEN_TIMEOUT_MS / 1000} s · still waiting`, model: picked.model }); } }, FIRST_TOKEN_TIMEOUT_MS);
    let tok = 0;
    // C167j: the model is told the same capabilities list this file writes to disk on 'help' — as its system line, so a
    // reply never claims an action (opening a file, running a command) that only the host, never a bare /api/chat, can take
    const tree = await chatContextFor(cwd, picked.model, trimmed);   // C201 (3): the steer state, and the turn's tape row
    const sys = `${await buildCapabilities(cwd)}\n\n${tree.context}`;
    // C263 (U0) — fit the turn to the model's own window (read off /api/show), cut from the middle, and say so on the status line
    const fit = c.fitMessages([{ role: 'system', content: sys }, { role: 'user', content: trimmed }], await c.contextLength({ host, model: picked.model }));
    const fitLine = c.fitNote(fit, picked.model);
    if (fitLine) { post({ type: 'chatInlineStage', stage: 'sending', text: `sending to ${picked.model} · ${fitLine}`, model: picked.model, at: new Date().toISOString() }); }
    const r = await c.streamChat({
        host, model: picked.model, signal: ctl.signal, messages: fit.messages, options: { num_ctx: fit.num_ctx },
        onToken: (t: string) => {
            if (firstTokenAt == null) { firstTokenAt = Date.now(); post({ type: 'chatInlineStage', stage: 'streaming', text: 'streaming', model: picked.model, at: new Date(firstTokenAt).toISOString() }); }
            tok++; post({ type: 'chatInlineToken', text: t, tok });
        },
    });
    clearTimeout(watchdog);
    appendChatCot(cwd, { surface: 'ide:inline', model: picked.model, prompt: trimmed, thinking: r.thinking || '', reply: r.text || '', ms: r.ms, tokens: r.tokens, ok: r.ok, error: r.error });   // C246
    void sawTimeout;   // the timeout stage already painted; done() below carries the final verdict either way
    if (!r.ok) { if (inflight === ctl) { inflight = null; } post({ type: 'chatInlineDone', ok: false, error: r.error === 'stopped' ? 'cancelled' : r.error, model: picked.model, ms: r.ms }); return; }
    if (r.text) { appendChatTurn(cwd, 'assistant', r.text); }
    // C207 — a fenced `/steer <verb>` in the reply is an ACTION: recorded on the tape, then run on the typed-verb route; its output is its own transcript turn
    // C217 — the turn's controller stays in flight through the run the model started, so ⏹ reaches that child too
    const act = await actOnModelReply(cwd, picked.model, r.text || '', (t) => post({ type: 'chatInlineToken', text: t }), ctl.signal);
    if (act.acted) {
        if (inflight === ctl) { inflight = null; }
        if (act.out) { appendChatTurn(cwd, 'assistant', act.out); }
        post({ type: 'chatInlineDone', ok: act.ok, model: picked.model, tokens: r.tokens, tps: r.tps, ms: r.ms, steer: act.verb, ranBy: picked.model, error: act.error === 'stopped' ? 'cancelled' : act.error });
        return;
    }
    // C314 — a fenced `door <id>` in the reply is the model's other way to act: recorded on the tape (verb `door:<id>`),
    // then run (READ) or handed back (OUTWARD/skill) through runHouseDoor — an id off the menu is a refusal, never a guess
    const menu = await loadHouseMenu(cwd);
    const doorAct = await actOnModelDoor(cwd, picked.model, r.text || '', menu, (t) => post({ type: 'chatInlineToken', text: t }), ctl.signal);
    if (inflight === ctl) { inflight = null; }
    if (doorAct.acted) {
        if (doorAct.out) { appendChatTurn(cwd, 'assistant', doorAct.out); }
        post({ type: 'chatInlineDone', ok: doorAct.ok, model: picked.model, tokens: r.tokens, tps: r.tps, ms: r.ms, door: doorAct.id, ranBy: picked.model, error: doorAct.ok ? undefined : 'refused' });
        return;
    }
    post({ type: 'chatInlineDone', ok: true, model: picked.model, tokens: r.tokens, tps: r.tps, ms: r.ms });
}
