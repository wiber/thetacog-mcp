#!/usr/bin/env node
// scripts/vna/workers.mjs — C224 THE CHAT LISTS THE RUNNING /steer WORKERS AND ENDS THEM BY NUMBER (operator 2026-09-23, on a
// screenshot of the 💬 Steer chat sitting on an empty gemma2:2b bubble while two goose/qwen3:8b workers held the one Ollama server,
// verbatim: *"list them somehow in the chat so they can be ended?"*).
//
// THE READING IS THE PROCESS TABLE, never a ledger: a steer-runner.mjs process with --label <row> IS a running worker, and its
// descendants (goose, claude -p, node) are what it spent. A runner row in runner.ndjson says what was DISPATCHED; only `ps` says
// what is still RUNNING — the chat's question is the second one.
//
//   node scripts/vna/workers.mjs list [--json]        numbered: 1 · C91 · goose/qwen3:8b · 13m · pids 26178 → 32653
//   node scripts/vna/workers.mjs end <n|label>        SIGTERM the runner and every descendant; a row per end on workers-ended.ndjson
//   node scripts/vna/workers.mjs end all | end-all    C293: END ALL ENDS EVERY LOCAL LLM — endAllLocal below: every local-LLM process by pid,
//                                                     every model /api/ps holds, a heavy lock whose holder it ended
//   node scripts/vna/workers.mjs engines [--chat <tag>] [--sub <tag>] [--json]   C250: what Ollama holds in memory (GET /api/ps) + the workers
//   node scripts/vna/workers.mjs end-all [--chat <tag>] [--sub <tag>] [--json]   C250 (+C250h: a selected gemma/qwen → every client of the server ends too): C293 widened it: every local-LLM process (endAllLocal), THEN unload every model
//                                                     Ollama holds (keep_alive 0) — the memory comes back, the server stays up (the chat
//                                                     stays Online and reloads a model on its next Send)
//
// SCOPE OF `end`: only a pid that IS a steer-runner.mjs process, or a descendant of one, is ever signalled — a number, a label or
// `all` resolves against the fresh list, never against a pid the caller typed, so this door cannot kill anything else on the machine.
import { execFileSync } from 'node:child_process';
import { traceFor, STALL_MS } from './worker-trace.mjs';   // C227: each worker's last tool call and a stall flag, off its own log
import { appendFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync, unlinkSync } from 'node:fs';
import { heavyHolder, HEAVY_LOCK } from './heavy-lock.mjs';   // C293: End all releases a heavy lock whose holder it ended
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');   // C297: bundled, the caller's repo (server.js sets VNA_REPO)
const RUNNER_TAPE = process.env.VNA_RUNNER_TAPE || resolve(REPO, '.thetacog', 'runner.ndjson');
const ENDED_TAPE = process.env.VNA_WORKERS_ENDED || resolve(REPO, '.thetacog', 'workers-ended.ndjson');
const RUNNER_RE = /(^|\/)steer-runner\.mjs(\s|$)/;

/** `ps -Ao pid,ppid,etime,command` text → rows */
export function parsePs(text) {
    return String(text || '').split('\n').slice(1).map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean)
        .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), etime: m[3], command: m[4] }));
}

/** ps etime ([[dd-]hh:]mm:ss) → a short age: 45s · 13m · 2h05 · 3d */
export function age(etime) {
    const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(etime || ''));
    if (!m) { return String(etime || '?'); }
    const [d, h, mi, s] = [Number(m[1] || 0), Number(m[2] || 0), Number(m[3]), Number(m[4])];
    if (d) { return `${d}d`; }
    if (h) { return `${h}h${String(mi).padStart(2, '0')}`; }
    return mi ? `${mi}m` : `${s}s`;
}

/** the runner processes, each with its descendants and the engine the worker child runs on */
export function workersFrom(rows, dispatched = {}) {
    const kids = new Map();
    for (const r of rows) { if (!kids.has(r.ppid)) { kids.set(r.ppid, []); } kids.get(r.ppid).push(r); }
    const runners = rows.filter((r) => /^\S*node\s/.test(r.command) && RUNNER_RE.test(r.command.split(/\s+--/)[0]));
    const runnerPids = new Set(runners.map((r) => r.pid));
    // a runner spawned by another runner is part of that one's tree, not its own worker
    const tops = runners.filter((r) => { let p = rows.find((x) => x.pid === r.ppid); while (p) { if (runnerPids.has(p.pid)) { return false; } p = rows.find((x) => x.pid === p.ppid); } return true; });
    return tops.map((r) => {
        const desc = []; const q = [...(kids.get(r.pid) || [])];
        while (q.length) { const c = q.shift(); desc.push(c); q.push(...(kids.get(c.pid) || [])); }
        const label = (/--label\s+(\S+)/.exec(r.command) || [])[1] || null;
        const child = desc.find((c) => /(^|\/)(goose|claude|codex|aider)(\s|$)/.test(c.command)) || desc[0] || null;
        const tool = child ? basename(child.command.split(/\s+/)[0]) : null;
        const engine = (label && dispatched[label]) || tool || 'no child yet';
        const retry = (/--retry-reason\s+(.+?)(\s--\w|$)/.exec(r.command) || [])[1] || null;
        return { label, engine, age: age(r.etime), pid: r.pid, pids: [r.pid, ...desc.map((c) => c.pid)], child: child ? { pid: child.pid, tool } : null, retry };
    }).map((w, i) => ({ n: i + 1, ...w }));
}

/** the engine each label was last dispatched on, read off the runner tape's tail (bounded — the tape is never read whole) */
function dispatchedEngines() {
    const out = {};
    try {
        const fd = openSync(RUNNER_TAPE, 'r'); const size = fstatSync(fd).size; const n = Math.min(size, 512 * 1024);
        const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n); closeSync(fd);
        for (const l of buf.toString('utf8').split('\n')) { if (!l.includes('"kind":"dispatch"')) { continue; } try { const j = JSON.parse(l); if (j.label && j.engine) { out[j.label] = j.engine; } } catch { /* a torn first line */ } }
    } catch { /* no tape — the child's tool name stands */ }
    return out;
}

export function listWorkers() {
    const ps = execFileSync('ps', ['-Ao', 'pid,ppid,etime,command'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return withTrace(workersFrom(parsePs(ps).filter((r) => r.pid !== process.pid), dispatchedEngines()));
}

/** C227 — each worker gains { last_tool_call, n_calls, quiet_ms, stalled } read off its newest runner log; a worker whose log has
 *  not grown for STALL_MS is STALLED (flagged, never ended — /end is the operator's act). Pure given the log dir and the clock. */
export function withTrace(ws, { logDir = resolve(REPO, '.thetacog', 'runner'), now = Date.now(), stallMs = STALL_MS } = {}) {
    return ws.map((w) => {
        const t = w.label ? traceFor(w.label, { logDir }) : null;
        if (!t) { return { ...w, last_tool_call: null, n_calls: null, quiet_ms: null, stalled: null }; }
        const quiet = Math.max(0, now - t.mtimeMs);
        return { ...w, last_tool_call: t.trace.last_tool_call, n_calls: t.trace.calls.length, quiet_ms: quiet, stalled: quiet > stallMs };
    });
}

export function formatList(ws) {
    if (!ws.length) { return 'no /steer workers running — the model server is not held by a worker'; }
    return [
        `${ws.length} /steer worker${ws.length === 1 ? '' : 's'} running:`,
        ...ws.map((w) => `  ${w.n} · ${w.label || '(no label)'} · ${w.engine} · ${w.age} · pids ${w.pids.join(' → ')}${w.retry ? ` · retry after: ${w.retry.slice(0, 80)}` : ''}${w.n_calls != null ? `\n      ${w.stalled ? 'STALLED · ' : ''}${w.n_calls} call${w.n_calls === 1 ? '' : 's'} · last ${w.last_tool_call ? w.last_tool_call.slice(0, 90) : '—'} · log quiet ${Math.round(w.quiet_ms / 60000)}m` : ''}`),
        `end one: /end ${ws[0].n}  ·  by row: /end ${ws[0].label || ws[0].n}  ·  every one: /end all`,
    ].join('\n');
}

/** resolve <n|label|all> against a FRESH list, SIGTERM each chosen tree leaf-first, one row per end */
export function endWorkers(which) {
    const ws = listWorkers(); const w = String(which || '').trim();
    if (!w) { return { ok: false, text: `say which: /end <n|row|all>\n${formatList(ws)}`, ended: [] }; }
    const chosen = /^all$/i.test(w) ? ws : ws.filter((x) => String(x.n) === w || (x.label && x.label.toLowerCase() === w.toLowerCase()));
    if (!chosen.length) { return { ok: false, text: `no running worker matches "${w}"\n${formatList(ws)}`, ended: [] }; }
    const lines = [];
    for (const x of chosen) {
        const signalled = [];
        for (const pid of [...x.pids].reverse()) { try { process.kill(pid, 'SIGTERM'); signalled.push(pid); } catch { /* already gone */ } }
        try { mkdirSync(dirname(ENDED_TAPE), { recursive: true }); appendFileSync(ENDED_TAPE, JSON.stringify({ at: new Date().toISOString(), kind: 'worker-ended', label: x.label, engine: x.engine, age: x.age, pids: x.pids, signalled, by: process.env.VNA_WORKERS_BY || 'cli' }) + '\n'); } catch { /* the chat still says what ended */ }
        lines.push(`⏹ ended ${x.label || `#${x.n}`} (${x.engine}, ${x.age}) — SIGTERM to ${signalled.join(', ') || 'nothing, already gone'}`);
    }
    return { ok: true, text: lines.join('\n'), ended: chosen.map((x) => x.label) };
}

// ── C250 THE ENGINES PILL AND ITS END-ALL (operator 2026-09-24, on the 💬 Steer chat, verbatim: *"add a kill all running ollama and
// gemmas button, and show status and memory footprint for both as expandable pill"*). The reading is Ollama's own GET /api/ps: which
// models are loaded, the bytes each holds (size, size_vram), the context window it was loaded with, and when it unloads by itself.
// END-ALL never pattern-kills a process name: the workers go through the scoped endWorkers('all') (a steer-runner.mjs tree only — so
// no other room's steer.mjs and no chair is touched), and the models are unloaded through Ollama's own door (keep_alive 0), which
// frees the memory without killing the server. Workers are ended FIRST: a live worker's next request would load the model straight back.
export const OLLAMA_HOST = () => process.env.VNA_OLLAMA_HOST || 'http://127.0.0.1:11434';
const gb = (b) => (Number.isFinite(b) ? `${(b / 1e9).toFixed(1)} GB` : '?');

/** GET /api/ps within a ceiling → { online, models: [{ name, size, size_vram, context_length, expires_at }], error } — offline is a reading */
export async function loadedModels({ host = OLLAMA_HOST(), fetchFn = globalThis.fetch, ms = 1500 } = {}) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetchFn(`${host}/api/ps`, { signal: ctl.signal });
        if (!r.ok) { return { online: false, models: [], error: `GET /api/ps → ${r.status}` }; }
        const j = await r.json();
        return { online: true, models: (j.models || []).map((m) => ({ name: m.name || m.model, size: m.size, size_vram: m.size_vram, context_length: m.context_length ?? null, expires_at: m.expires_at || null })), error: null };
    } catch (e) { return { online: false, models: [], error: ctl.signal.aborted ? `no answer in ${ms} ms` : String(e && e.message || e) }; }
    finally { clearTimeout(t); }
}

/** the pill's reading: one line per role (chat · workers) and every other loaded model; a role whose model is not loaded says so */
export function formatEngines(ps, { chat = null, sub = null, workers = [] } = {}) {
    if (!ps || !ps.online) { return { face: `🔴 Ollama not answering${ps && ps.error ? ` — ${ps.error}` : ''}`, lines: [], total: 0 }; }
    const by = new Map(ps.models.map((m) => [m.name, m]));
    const one = (role, tag) => { if (!tag) { return `${role} — no model picked`; } const m = by.get(tag) || by.get(`${tag}:latest`);
        return m ? `${role} ${tag} · ${gb(m.size)}${m.size_vram ? ` (${gb(m.size_vram)} on GPU)` : ''} · context ${m.context_length ?? '?'}` : `${role} ${tag} · not loaded · 0 GB`; };
    const named = new Set([chat, sub, chat && `${chat}:latest`, sub && `${sub}:latest`].filter(Boolean));
    const others = ps.models.filter((m) => !named.has(m.name)).map((m) => `also loaded ${m.name} · ${gb(m.size)} · context ${m.context_length ?? '?'}`);
    const total = ps.models.reduce((a, m) => a + (m.size || 0), 0);
    const w = workers.length ? `🤖 ${workers.length} /steer worker${workers.length === 1 ? '' : 's'} running (${workers.map((x) => x.label || `#${x.n}`).join(', ')})` : '🤖 no /steer workers running';
    // C250f (operator 2026-09-24: "need to see all stats for both models with the … online and stats here") — the FACE carries both
    // roles' stats beside Online, short; the lines behind the + keep the long form
    const chip = (icon, tag) => { if (!tag) { return `${icon} —`; } const m = by.get(tag) || by.get(`${tag}:latest`);
        return m ? `${icon} ${tag} ${gb(m.size)} · ctx ${m.context_length != null ? `${Math.round(m.context_length / 1024)}k` : '?'}` : `${icon} ${tag} idle · 0 GB`; };
    const busy = workers.length ? ` · 🤖×${workers.length} running` : '';
    // C250g — the same reading as data, so the view paints green model names with their stats and no "Online" words
    const role = (key, tag) => { const m = tag ? (by.get(tag) || by.get(`${tag}:latest`)) : null; return { role: key, tag: tag || null, loaded: !!m, gb: m ? +(m.size / 1e9).toFixed(1) : 0, ctx_k: m && m.context_length != null ? Math.round(m.context_length / 1024) : null }; };
    return { roles: [role('chat', chat), role('workers', sub)], running: workers.length, others: others.length, face: `${chip('💬', chat)} · ${chip('🤖', sub)}${others.length ? ` · +${others.length} more loaded` : ''}${busy}`, lines: [one('💬 chat', chat), one('🤖 workers', sub), ...others, w], total };
}

/** C256 — unload ONE model through Ollama's own door (keep_alive 0) and write the row; the chat model is never named here, only the
 *  worker's. Never throws: offline / refused is { ok:false, why } so a watchdog that fires still halts the dispatch. */
export async function unloadModel({ model, host = OLLAMA_HOST(), fetchFn = globalThis.fetch, by = 'c256-watchdog', tape = ENDED_TAPE } = {}) {
    if (!model) return { ok: false, model: null, why: 'no model named' };
    try {
        const r = await fetchFn(`${host}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) });
        if (!r.ok) throw new Error(`→ ${r.status}`);
        try { mkdirSync(dirname(tape), { recursive: true }); appendFileSync(tape, JSON.stringify({ at: new Date().toISOString(), kind: 'model-unloaded', model, bytes: null, by }) + '\n'); } catch { /* the result still says it */ }
        return { ok: true, model, why: null };
    } catch (e) { return { ok: false, model, why: String(e && e.message || e).slice(0, 160) }; }
}

// ── C250h END ALL ENDS EVERY INSTANCE OF A SELECTED GEMMA OR QWEN (operator 2026-09-24, verbatim: *"and end all should be all
// instances of gemma or qwen if they are selected"*). endWorkers('all') reaches steer-runner trees only; a goose run started by a
// hook, an `ollama run <tag>`, a grader streaming to the server — each kept driving the model and loaded it straight back after
// the unload. The construct is not a process NAME (and macOS hides a process's env from ps, so GOOSE_MODEL is unreadable): it is
// an open TCP connection to the Ollama server — whatever drives a local model is a client of that socket. When a selected role's
// tag is a gemma or qwen, every client of the server is ended (SIGTERM), except the server itself (the LISTEN pid) and this
// process's own ancestors (the chair, the extension host whose streaming chat it already aborted). A selection that is neither
// gemma nor qwen (claude, a cloud tag) keeps C250's scope: workers, then unload.
export const LOCAL_FAMILY = /^(gemma|qwen)/i;
export const selectedLocal = (tags) => [...new Set((tags || []).filter(Boolean).map(String))].filter((t) => LOCAL_FAMILY.test(t));
/** pure: `lsof -F pcn` output → the client pids of the server on `port` (the remote end is :port), minus listeners and excluded pids */
export function ollamaClientsFrom(lsofF, { port = 11434, listeners = [], exclude = [] } = {}) {
    const out = new Map(); let pid = null, cmd = '';
    for (const l of String(lsofF || '').split('\n')) {
        if (l[0] === 'p') { pid = Number(l.slice(1)); cmd = ''; }
        else if (l[0] === 'c') { cmd = l.slice(1); }
        else if (l[0] === 'n' && pid && new RegExp(`->[^\\s]*:${port}$`).test(l.slice(1))) { out.set(pid, cmd); }
    }
    const skip = new Set([...listeners, ...exclude].map(Number));
    return [...out].filter(([p]) => !skip.has(p)).map(([p, c]) => ({ pid: p, command: c }));
}
function ancestors(pid = process.pid) {
    const chain = [pid];
    for (let i = 0, cur = pid; i < 64; i++) {
        let pp; try { pp = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(cur)], { encoding: 'utf8' }).trim()); } catch { break; }
        if (!pp || pp <= 1 || chain.includes(pp)) break; chain.push(pp); cur = pp;
    }
    return chain;
}
export function ollamaClients({ host = OLLAMA_HOST(), exclude = ancestors() } = {}) {
    const port = Number(new URL(host).port || 11434);
    const run = (args) => { try { return execFileSync('lsof', args, { encoding: 'utf8', maxBuffer: 8 << 20 }); } catch (e) { return String(e.stdout || ''); } };
    const listeners = run(['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).split('\n').filter(Boolean).map(Number);
    return ollamaClientsFrom(run(['-nP', '-a', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpcn']), { port, listeners, exclude });
}
// C256b — IS THE MODEL GENERATING FOR THIS WORKER? The watchdog reads the worker's stdout, and goose prints nothing while qwen3
// thinks: the C235 bench measured a first turn of 175–245 s median at 16k (1,300–1,800 generated tokens), against a 180 s limit.
// Two host facts, no model: a pid in the worker's process GROUP holds a connection to the Ollama server (ollamaClients, the same
// lsof reading C250h ends), AND an `ollama runner` process is burning CPU. Both → it is thinking, not hung.
// THE FLOOR IS MEASURED, NOT GUESSED (2026-09-25, M5, qwen3:8b through goose, one live replay trial sampled every 3 s): the runner
// reads 0.0 % idle-but-loaded and during the GPU prefill, then 5.7–7.8 % for the whole generation — the work is on Metal, the CPU
// share is the sampling thread. The first floor (20 %) could never fire here: every C265 trial read 'runner cpu 0–7 % under 20 %' and
// the watchdog ended qwen mid-thought at 210 s while ollama's log shows the request completing 2–3.5 min in. 2 % sits between the two.
export const RUNNER_CPU_FLOOR = Number(process.env.VNA_RUNNER_CPU_FLOOR || 2);
/** pure: `ps -Ao pid=,pgid=,%cpu=,command=` text → { group: pids whose pgid is pgid, cpu: the busiest ollama runner's %cpu } */
export function readPs(psText, pgid) {
    const group = []; let cpu = 0;
    for (const l of String(psText || '').split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(l); if (!m) continue;
        if (Number(m[2]) === Number(pgid)) group.push(Number(m[1]));
        if (/\bollama runner\b/.test(m[4])) cpu = Math.max(cpu, Number(m[3]));
    }
    return { group, cpu };
}
export function generatingFor(pgid, { ps = () => execFileSync('ps', ['-Ao', 'pid=,pgid=,%cpu=,command='], { encoding: 'utf8', maxBuffer: 32 << 20 }), clients = () => ollamaClients({ exclude: [] }), floor = RUNNER_CPU_FLOOR } = {}) {
    let r; try { r = readPs(ps(), pgid); } catch { return { generating: false, why: 'ps unreadable' }; }
    let cl = []; try { cl = clients(); } catch { /* unreadable → not generating */ }
    const mine = cl.filter((c) => r.group.includes(c.pid)).map((c) => c.pid);
    const generating = mine.length > 0 && r.cpu >= floor;
    return { generating, client_pids: mine, runner_cpu: r.cpu, why: generating ? null : (!mine.length ? 'no pid of the worker is connected to the model server' : `runner cpu ${r.cpu}% under ${floor}%`) };
}

/** SIGTERM every client of the server; one row each. Injected: clients, kill */
export function endModelClients(tags, { clients = () => ollamaClients(), kill = (pid) => process.kill(pid, 'SIGTERM') } = {}) {
    const sel = selectedLocal(tags);
    if (!sel.length) return { selected: [], ended: [], lines: [] };
    const ended = []; const lines = [];
    for (const c of clients()) {
        try { kill(c.pid); ended.push(c); lines.push(`⏹ ended ${c.command || 'pid'} ${c.pid} — a client of the model server while ${sel.join(' · ')} is selected`); }
        catch { continue; }
        try { mkdirSync(dirname(ENDED_TAPE), { recursive: true }); appendFileSync(ENDED_TAPE, JSON.stringify({ at: new Date().toISOString(), kind: 'client-ended', pid: c.pid, command: c.command, selected: sel, by: process.env.VNA_WORKERS_BY || 'cli' }) + '\n'); } catch { /* the line says it */ }
    }
    if (!ended.length) lines.push(`no other client was driving ${sel.join(' · ')}`);
    return { selected: sel, ended, lines };
}

// ── C293 ⏹ END ALL ENDS EVERY LOCAL LLM (operator 2026-09-25, verbatim: *"make end all qwen reakllky end all local llm"*). Measured
// the same morning: End all printed "no /steer workers were running" and unloaded two models while replay-bench.mjs pid 94832 and
// its `goose run` worker kept running and would have loaded qwen3:8b straight back — endWorkers('all') only ever saw steer-runner
// trees. THE CONSTRUCT IS THE ARGV, never a substring of the command line: a node process whose SCRIPT (argv[1], node flags skipped)
// is a named local-LLM driver, `goose run`, `ollama run`, a shell running llm-prompt.sh — so `grep replay-bench`, an editor with the
// file open, `goose session` and `less region-narrative.mjs` never match. Each matched root's descendants end with it (a bench's goose
// child, a runner's claude -p worker — the C224 scope, as today). NEVER ended: `ollama serve` and `ollama runner` (the unload frees
// those), the VS Code / Cursor extension host, a claude that is not under a /steer runner, and this process with every ancestor.
// Known limit: ps prints argv joined by spaces, so a script path containing a space is split — such a driver would be missed, and the
// re-list after the sweep is what would name it (survivors), never a guess.
const NODE_DRIVERS = new Map([['replay-bench.mjs', 'replay-bench.mjs'], ['brief-bench.mjs', 'brief-bench.mjs'], ['region-narrative.mjs', 'region-narrative.mjs'], ['steer-runner.mjs', '/steer worker'], ['dual-llm-runner.mjs', 'ghost-read']]);
const GHOST_READ_RE = /^ghost-read[\w-]*\.mjs$/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const base = (s) => basename(String(s || ''));
/** pure: `ps -Ao pid=,ppid=,command=` text → [{ pid, ppid, command, argv }] */
export function parsePidTable(text) {
    return String(text || '').split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
        .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3], argv: m[3].trim().split(/\s+/) }));
}
/** pure: what local-LLM driver this row IS, off its argv — or null */
export function localDriverOf(row) {
    const a = row.argv || []; const a0 = base(a[0]);
    if (/^node(\d+)?$/.test(a0)) {
        const script = a.slice(1).find((t) => !t.startsWith('-')); const s = base(script);
        if (NODE_DRIVERS.has(s)) { const label = s === 'steer-runner.mjs' ? (/--label\s+(\S+)/.exec(row.command) || [])[1] : null; return label ? `/steer worker ${label}` : NODE_DRIVERS.get(s); }
        if (GHOST_READ_RE.test(s)) { return s; }
        return null;
    }
    if (a0 === 'goose' && a[1] === 'run') { return 'goose run'; }
    if (a0 === 'ollama' && a[1] === 'run') { return `ollama run${a[2] ? ` ${a[2]}` : ''}`; }
    if (a0 === 'llm-prompt.sh') { return 'llm-prompt.sh'; }
    if (SHELLS.has(a0) && base(a.slice(1).find((t) => !t.startsWith('-'))) === 'llm-prompt.sh') { return 'llm-prompt.sh'; }
    return null;
}
/** pure: never a target — the model server, its runners, the IDE's extension host, a claude session */
export function protectedRow(row) {
    const a = row.argv || []; const a0 = base(a[0]);
    if (a0 === 'ollama' && (a[1] === 'serve' || a[1] === 'runner')) { return true; }
    if (/Code Helper|Cursor Helper|extensionHost|Electron|Visual Studio Code|\/Cursor\.app\//.test(row.command)) { return true; }
    if (a0 === 'claude') { return true; }
    return false;
}
const alivePid = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psText = () => execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 << 20 });

/** pure over a table: the targets — each driver root and its descendants, minus the protected and this process's own chain */
export function localTargets(rows, { self = process.pid } = {}) {
    const byPid = new Map(rows.map((r) => [r.pid, r])); const kids = new Map();
    for (const r of rows) { if (!kids.has(r.ppid)) { kids.set(r.ppid, []); } kids.get(r.ppid).push(r); }
    const chain = new Set([self]); for (let p = byPid.get(self), i = 0; p && i < 64; p = byPid.get(p.ppid), i++) { chain.add(p.ppid); }
    const out = new Map();
    for (const r of rows) {
        if (chain.has(r.pid) || protectedRow(r)) { continue; }
        const what = localDriverOf(r); if (!what) { continue; }
        if (!out.has(r.pid)) { out.set(r.pid, { pid: r.pid, what }); }
        const underRunner = what.startsWith('/steer worker');
        const q = [...(kids.get(r.pid) || [])];
        while (q.length) {
            const c = q.shift(); q.push(...(kids.get(c.pid) || []));
            if (chain.has(c.pid) || out.has(c.pid)) { continue; }
            if (protectedRow(c) && !(underRunner && base(c.argv[0]) === 'claude')) { continue; }   // a runner's claude -p IS the worker (C224)
            out.set(c.pid, { pid: c.pid, what: localDriverOf(c) || `${base(c.argv[0])} (child of ${what} pid ${r.pid})` });
        }
    }
    return [...out.values()];
}

/** ⏹ C293 — end every local-LLM process by pid (SIGTERM, then SIGKILL after graceMs), then unload EVERY model /api/ps reports,
 *  then release a heavy lock whose holder was ended or is dead. `between` runs after the processes end and before the unload
 *  (endAll's C250h client sweep). Returns { ended:[{pid,what}], unloaded:[{name,gb}], heavy_released, survivors:[], lines, online }.
 *  survivors: a driver the re-list still shows, or a model /api/ps still reports after the unload — the falsifier, named. */
export async function endAllLocal({ ps = psText, kill = (pid, sig) => process.kill(pid, sig), alive = alivePid, fetchFn = globalThis.fetch, host = OLLAMA_HOST(),
    heavyLockPath = HEAVY_LOCK(), self = process.pid, graceMs = 1500, settleMs = 1000, between = null, tape = process.env.VNA_WORKERS_ENDED || ENDED_TAPE, by = process.env.VNA_WORKERS_BY || 'cli' } = {}) {
    const lines = []; const row = (o) => { try { mkdirSync(dirname(tape), { recursive: true }); appendFileSync(tape, JSON.stringify({ at: new Date().toISOString(), ...o, by }) + '\n'); } catch { /* the line says it */ } };
    const holder = heavyHolder({ path: heavyLockPath });
    let table = []; try { table = parsePidTable(ps()); } catch (e) { lines.push(`⚠ process table unreadable — ${String(e && e.message || e)}`); }
    const targets = localTargets(table, { self });
    const ended = [];
    for (const t of [...targets].reverse()) {   // leaf-first: a child dies before its parent can respawn it
        try { kill(t.pid, 'SIGTERM'); ended.push(t); } catch { /* already gone */ }
    }
    for (let waited = 0; waited < graceMs && ended.some((t) => alive(t.pid)); waited += 50) { await sleep(50); }
    const killed = new Set();
    for (const t of ended) { if (alive(t.pid)) { try { kill(t.pid, 'SIGKILL'); killed.add(t.pid); } catch { /* gone in between */ } } }
    if (killed.size) { await sleep(Math.min(200, graceMs)); }
    for (const t of ended) { lines.push(`⏹ ended ${t.what} pid ${t.pid}${killed.has(t.pid) ? ' (SIGKILL — it ignored SIGTERM)' : ''}`); row({ kind: 'local-llm-ended', pid: t.pid, what: t.what, signal: killed.has(t.pid) ? 'SIGKILL' : 'SIGTERM' }); }
    if (!ended.length) { lines.push('no local-LLM process was running'); }
    if (between) { try { const b = await between(); if (b && b.lines) { lines.push(...b.lines); } } catch (e) { lines.push(`⚠ ${String(e && e.message || e)}`); } }
    // the unload: every model the server holds, through its own door (keep_alive 0) — the server stays up
    const unloaded = []; const survivors = [];
    const before = await loadedModels({ host, fetchFn });
    if (!before.online) { lines.push(`Ollama not answering — nothing to unload (${before.error})`); }
    for (const m of before.models) {
        try {
            const r = await fetchFn(`${host}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.name, keep_alive: 0 }) });
            if (!r.ok) { throw new Error(`→ ${r.status}`); }
            unloaded.push({ name: m.name, gb: Number.isFinite(m.size) ? +(m.size / 1e9).toFixed(1) : null }); lines.push(`⏏ unloaded ${m.name} — ${gb(m.size)} freed`);
            row({ kind: 'model-unloaded', model: m.name, bytes: m.size ?? null });
        } catch (e) { lines.push(`⚠ ${m.name} not unloaded — ${String(e && e.message || e)}`); }
    }
    if (before.online && !before.models.length) { lines.push('no model was loaded — Ollama held no memory'); }
    // the heavy lock: released when its holder was ended here or is already dead; a live holder that was not ended keeps it
    let heavy_released = false;
    if (holder && Number.isFinite(Number(holder.pid))) {
        const hp = Number(holder.pid); const endedHere = ended.some((t) => t.pid === hp);
        const cur = heavyHolder({ path: heavyLockPath });
        if (cur && Number(cur.pid) === hp && (endedHere || !alive(hp))) { try { unlinkSync(heavyLockPath); heavy_released = true; } catch { /* gone in between */ } }
        else if (!cur && endedHere) { heavy_released = true; }   // its holder released it on the way out
        if (heavy_released) { lines.push(`🔓 heavy lock released — holder ${holder.job || '?'} pid ${hp} ${endedHere ? 'ended' : 'was dead'}`); row({ kind: 'heavy-released', pid: hp, job: holder.job || null }); }
    }
    // the falsifier, read again: a driver the re-list still shows, a model the server still holds
    let after = []; try { after = localTargets(parsePidTable(ps()), { self }); } catch { /* unreadable → the ended list stands */ }
    for (const t of after) { survivors.push({ pid: t.pid, what: t.what }); lines.push(`⚠ still running: ${t.what} pid ${t.pid}`); }
    if (before.online && before.models.length) {
        let left = [];
        for (let waited = 0; ; waited += 250) { const p = await loadedModels({ host, fetchFn }); left = p.online ? p.models : []; if (!left.length || waited >= settleMs) { break; } await sleep(250); }
        for (const m of left) { survivors.push({ model: m.name }); lines.push(`⚠ still loaded: ${m.name}`); }
    }
    return { ended, unloaded, heavy_released, survivors, lines, online: before.online };
}

/** ⏹ End all (the pill and `/end all`): C293's one sweep — every local-LLM process, then (C250h) every client of a selected
 *  gemma/qwen, then every loaded model unloaded, then the heavy lock; one line per act. Injected: everything endAllLocal takes. */
export async function endAll({ selected = [], endClients = (t) => endModelClients(t), ...opts } = {}) {
    let cl = { selected: [], ended: [] };
    const r = await endAllLocal({ ...opts, between: () => { cl = endClients(selected); return cl; } });
    return { ok: r.online && r.survivors.length === 0, text: r.lines.join('\n'), ended: r.ended, clients: (cl.ended || []).map((c) => c.pid), selected: cl.selected || [],
        unloaded: r.unloaded.map((u) => u.name), heavy_released: r.heavy_released, survivors: r.survivors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [verb = 'list', ...rest] = process.argv.slice(2);
    const json = rest.includes('--json'); const arg = rest.filter((a) => a !== '--json').join(' ');
    if (verb === 'list') { const ws = listWorkers(); process.stdout.write((json ? JSON.stringify(ws) : formatList(ws)) + '\n'); }
    else if (verb === 'end' && /^all$/i.test(arg)) { const r = await endAll(); process.stdout.write((json ? JSON.stringify(r) : r.text) + '\n'); process.exit(r.ok ? 0 : 1); }   // C293: `/end all` is the one sweep, not only the worker loop
    else if (verb === 'end') { const r = endWorkers(arg); process.stdout.write((json ? JSON.stringify(r) : r.text) + '\n'); process.exit(r.ok ? 0 : 1); }
    else if (verb === 'engines') { const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; }; const ps = await loadedModels(); const f = formatEngines(ps, { chat: flag('--chat'), sub: flag('--sub'), workers: listWorkers() }); process.stdout.write((json ? JSON.stringify({ ...f, ps }) : [f.face, ...f.lines].join('\n')) + '\n'); }
    else if (verb === 'end-all') { const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; }; const r = await endAll({ selected: [flag('--chat'), flag('--sub')] }); process.stdout.write((json ? JSON.stringify(r) : r.text) + '\n'); process.exit(r.ok ? 0 : 1); }
    else { process.stderr.write('usage: workers.mjs list [--json] | end <n|row|all> [--json] | engines [--chat <tag>] [--sub <tag>] [--json] | end-all [--chat <tag>] [--sub <tag>] [--json]\n'); process.exit(2); }
}
