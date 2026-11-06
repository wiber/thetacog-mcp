// packages/thetacog-mcp-vscode/src/vna-hud.ts — C749 🎯 STEER HUD host: NODE IS TRANSPORT ONLY. A third webview view in the thetacog
// container, registered from extension.ts the way vna-chat.ts is (its own try/catch, retainContextWhenHidden, CSP like vna-chat.ts html()).
// The host spawns `pmu-onchip --hud-serve --config data/vna/hud-config.json` ONCE PER WORKSPACE (a Map keyed by cwd), through the same
// binary resolver src/lib/pmu/walk-door.mjs uses (pmu-binary.mjs resolvePmuBinary, never a second path), streams every text change of the
// chosen source into it as {op:'text'} events (an fs.watch tail: the steer file, or .thetacog/audio/stream.txt filtered by the leading mark),
// and relays every stdout line to the page unchanged as {type:'serve', event}. The page posts user events; the host forwards them to the
// server's stdin with the page's `by`. The window, the debounce, the fold, the colours, the queue, the archetype, the freeze gate and the
// health lines are the server's (C748); this file decides none of them. A placement is re-runnable from the commit (Grip).
// Sources: 📋 paste (the steer file the pointer .thetacog/vna-steer-file.json names, read the way scripts/vna/clip-watch.mjs reads it),
// 🎙️ external and 🔈 internal (.thetacog/audio/stream.txt filtered by the mark the config's `sources` names), ⌨️ all (unfiltered).
// THE ONLY EXIT is vna.clipIngest with the server's frozen text — never a voice trigger (the asymmetric safety gate, which the server holds).
// UNMEASURED beats a guessed number: an absent file reads "not run — ...".
import * as vscode from 'vscode';
import * as path from 'path';
import { watch, readFileSync, openSync, readSync, closeSync, statSync, FSWatcher } from 'fs';
import { execFile, spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { appendChatTurn, chatContextFor } from './vna-chat-inline';
import { doorCommand } from './commands';   // C94b.4: every child the HUD starts goes through the door table — node at home, npx away, `not run — <why>` when there is no door
import { copyOut } from './vna-view';   // 2026-10-13: the draft's copy uses the sidebar's one copy door, never a second clipboard write   // C742 the existing steer chat route, never a second client

const VIEW_ID = 'thetacog.hud';
/** C94b.4 THE HUD'S ONE SPAWN DOOR: a node door the host names by its absolute path in this workspace, run through doorCommand — at home the
 *  same `node scripts/vna/<x>.mjs`, in a stranger's repo `npx thetacog-mcp <door>`, and with no door a callback carrying `not run — <why>`
 *  (never a spawn of a path that exists only in this tree). */
type DoorCb = (err: Error | null, stdout: string, stderr: string) => void;
function nodeDoor(cwd: string | undefined, script: string, args: string[], opts: any, cb?: DoorCb): ChildProcess | null {
    const rel = cwd ? path.relative(cwd, script) : script;
    const c = doorCommand(cwd, rel, args);
    if (!c.runnable) { const e = Object.assign(new Error(c.display), { code: 'NOT_RUN' }); setImmediate(() => cb && cb(e, c.display, '')); return null; }
    return execFile(c.file, c.args, opts, (err, stdout, stderr) => cb && cb(err, String(stdout || ''), String(stderr || '')));
}
const READINGS = 'scripts/vna/hud-readings.mjs';   // C770 the ONE writer of data/vna/hud-readings.ndjson; the host only hands it a row on stdin
const SNOWBALL = 'scripts/vna/hud-snowball.mjs';   // C743 the ledger door; spawned straight with node, so it needs no npx door of its own
const CONTEXT_DOOR = 'scripts/vna/hud-context.mjs';   // 2026-10-15 the context pool: every record (transcripts, chat, scratch, paste, speech, commits) the cells draw words from
const ASK = 'scripts/vna/hud-ask.mjs';   // 2026-10-13 the door to claude -p and to the latest steer; the host spawns only the server itself
const CONFIG = path.join('data', 'vna', 'hud-config.json');
// C751 every execFile below carries timeout: 10000 (killed with SIGKILL); only the resident server has none
const CONFIG_WAIT_MS = 5000;      // C751 how long a caller waits for the server's config event before reading it as UNMEASURED
const TAIL_BYTES = 65536;   // how much of a long file seeds the server's window on the first read
const SOURCES = ['paste', 'external', 'internal', 'all'];
let ctx: vscode.ExtensionContext | null = null;
let chatCore: any = null;   // media/chat-core.js — the one relay client vna-chat.ts holds
const MODEL_KEY = 'vna.chat.model';
const OLLAMA_SLOT = 'vna.engine.OLLAMA_HOST';
let view: vscode.WebviewView | undefined;
let watcher: FSWatcher | undefined;
let source = 'paste';
let offset = 0;   // how far into the watched file the server has been fed

const root = (): string | undefined => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
const post = (m: Record<string, unknown>) => { void view?.webview.postMessage(m); };

/** one resident `pmu-onchip --hud-serve` per workspace */
type Server = { proc: ChildProcess; cwd: string; buf: string; askLine: string; config: Promise<any>; gotConfig: (c: any) => void };
const servers = new Map<string, Promise<Server | null>>();   // the Map is keyed by cwd and filled before the first await, so two callers for one workspace share ONE spawn
const restarted = new Set<string>();   // C751 the workspaces whose server has already been restarted once; a second exit is not restarted again
/** the server's config event, or {} (UNMEASURED) when it does not answer within CONFIG_WAIT_MS: a caller never waits on a child forever */
const configOf = (s: Server): Promise<any> => Promise.race([s.config, new Promise<any>((res) => setTimeout(() => res({}), CONFIG_WAIT_MS))]);
// The extension host is compiled TS (commonjs) and cannot import an .mjs statically: the same `new Function('u','return import(u)')` dynamic
// import the C740 wiring used for cursorFor, chosen over spawning `node -e` because the resolver and the tape signer are then called in
// process, once, by the very functions src/lib/pmu/walk-door.mjs itself uses.
const dyn = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
const pmuModule = async (cwd: string, file: string): Promise<any | null> => {
    const p = path.join(cwd, 'src', 'lib', 'pmu', file);
    try { return existsSync(p) ? await dyn(pathToFileURL(p).href) : null; } catch { return null; }
};
// C760 (HUD H4): the controls shelf below the grid (file selection, the take-all-audio checkbox, the health readout) is painted with
// the SAME pill and row components the "Steer — Where The Work Landed" sidebar page uses — scripts/vna/steer-ui.mjs, one shared
// module, never a second hand-rolled `<div class="regbar">` copy. Loaded the one way this file already loads any .mjs (pmuModule's
// dyn + pathToFileURL), never a static import (the extension host is compiled commonjs; steer-ui.mjs is ESM).
const steerUiModule = async (cwd: string): Promise<any | null> => {
    const p = path.join(cwd, 'scripts', 'vna', 'steer-ui.mjs');
    try { return existsSync(p) ? await dyn(pathToFileURL(p).href) : null; } catch { return null; }
};

/** the config's `sources` rows ({name, device, mark}) as the server holds them: the mark leads a stream.txt line, never matched inside it */
async function markOf(cwd: string, name: string): Promise<string | null> {
    const s = await serverFor(cwd); if (!s) { return null; }
    const c = await configOf(s); const row = (c && Array.isArray(c.sources) ? c.sources : []).find((x: any) => x && x.name === name);
    return row && row.mark ? String(row.mark) : null;
}

/** spawns the server once for this workspace; resolves null (and tells the page why) when there is no binary to run */
function serverFor(cwd: string): Promise<Server | null> {
    const had = servers.get(cwd); if (had) { return had; }
    const p = (async (): Promise<Server | null> => {
        const mod = await pmuModule(cwd, 'pmu-binary.mjs');
        if (!mod) { post({ type: 'serve', event: { kind: 'error', why: 'not run — no src/lib/pmu/pmu-binary.mjs in this workspace (away from home the C741 hudReading door is the engine)' } }); return null; }
        const bin: string = mod.resolvePmuBinary(cwd);
        if (!bin || !existsSync(bin)) { post({ type: 'serve', event: { kind: 'error', why: `UNMEASURED: no pmu-onchip binary at ${bin}` } }); return null; }
        const proc = spawn(bin, ['--hud-serve', '--config', path.join(cwd, CONFIG), '--repo', cwd], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        let gotConfig: (c: any) => void = () => undefined;
        const config = new Promise<any>((res) => { gotConfig = res; });
        const s: Server = { proc, cwd, buf: '', askLine: '', config, gotConfig };
        proc.stdout!.on('data', (d: Buffer) => { s.buf += d.toString('utf8'); let i: number; while ((i = s.buf.indexOf('\n')) >= 0) { const line = s.buf.slice(0, i); s.buf = s.buf.slice(i + 1); void relay(s, line); } });
        proc.stdin!.on('error', () => undefined);   // a dead server surfaces as its exit event
        proc.on('error', (e) => { servers.delete(cwd); s.gotConfig({}); post({ type: 'serverExit', code: null, restarted: false, why: `UNMEASURED: the server did not start (${String((e as Error)?.message || e).slice(0, 120)})` }); });
        proc.on('exit', (code, signal) => { servers.delete(cwd); s.gotConfig({}); onServerExit(cwd, code, signal); });
        put(s, { op: 'config' });
        return s;
    })();
    servers.set(cwd, p);
    return p;
}
/** C751 the server exited: restart it ONCE per workspace and post {type:'serverExit', code, restarted, why} so the page says what happened */
function onServerExit(cwd: string, code: number | null, signal: NodeJS.Signals | null): void {
    const how = signal ? `signal ${signal}` : `code ${code}`;
    if (restarted.has(cwd)) { post({ type: 'serverExit', code, restarted: false, why: `the hud server exited (${how}) a second time: not restarted again, reload the window` }); return; }
    restarted.add(cwd);
    post({ type: 'serverExit', code, restarted: true, why: `the hud server exited (${how}): restarted once` });
    void serverFor(cwd).then(async (s) => { if (s) { offset = 0; sendContext(); await feed(); sendHealth(false); } });
}
const put = (s: Server, o: Record<string, unknown>) => { try { s.proc.stdin!.write(JSON.stringify(o) + '\n'); } catch { /* the exit event reports it */ } };
async function send(o: Record<string, unknown>): Promise<void> { const cwd = root(); const s = cwd ? await serverFor(cwd) : null; if (s) { put(s, o); } }

/** every stdout line goes to the page unchanged; the host only acts on the events that leave the machine (frozen, reading's tape row) */
async function relay(s: Server, line: string): Promise<void> {
    let ev: any; try { ev = JSON.parse(line); } catch { return; }   // a startup banner is not an event
    if (ev && ev.kind === 'grid') { lastGridEv = ev; }   // 2026-10-13: the collapse reads the cell the operator clicked off the last grid painted
    post({ type: 'serve', event: ev });
    if (ev.kind === 'config') { s.gotConfig(ev); }
    else if (ev.kind === 'grid') { s.askLine = String(ev.ask_line || ''); }
    else if (ev.kind === 'reading') { await tapeRow(s.cwd, ev); put(s, { op: 'health' }); }
    else if (ev.kind === 'frozen') { await onFrozen(s.cwd, ev); }
}

/** the server prints the reading; node signs and appends the tape row through the ONE signer, walk-door.mjs recordWalk */
async function tapeRow(cwd: string, ev: any): Promise<void> {
    const mod = await pmuModule(cwd, 'walk-door.mjs');
    if (!mod || typeof mod.recordWalk !== 'function') { return; }
    try { mod.recordWalk(ev.result, { source: 'hud', ref: 'hud', text_sha: ev.text_sha, text_chars: null, usedChars: null, ms: ev.walk && ev.walk.ms, err: ev.walk && ev.walk.ok === false ? ev.walk.why : null }); } catch { /* the tape is best-effort; the reading already reached the page */ }
}

/** the file the chosen source reads, or why there is none */
function chosen(cwd: string): { file: string | null; why: string } {
    if (source !== 'paste') { return { file: path.join(cwd, '.thetacog', 'audio', 'stream.txt'), why: 'not run — arm the mic' }; }
    try {
        const p = JSON.parse(readFileSync(process.env.VNA_STEER_FILE || path.join(cwd, '.thetacog', 'vna-steer-file.json'), 'utf8'));
        return p && p.source ? { file: path.resolve(cwd, p.source), why: '' } : { file: null, why: 'not run — no steer file pointer' };
    } catch { return { file: null, why: 'not run — no steer file pointer' }; }
}

/** C740 the watcher's cursor offset for this txt, read through the exported cursorFor(txt) of steer-file-clear.mjs (an ES module: import() it by file URL); null = UNMEASURED */
async function processedBytesFor(cwd: string, txt: string): Promise<number | null> {
    try {
        const script = path.join(cwd, 'scripts', 'vna', 'steer-file-clear.mjs');
        if (!existsSync(script)) { return null; }
        const mod = await dyn(pathToFileURL(script).href);
        const cur = JSON.parse(readFileSync(mod.cursorFor(txt), 'utf8'));
        return typeof cur.offset === 'number' && cur.offset > 0 ? cur.offset : null;
    } catch { return null; }
}

/** the register pane (the steer file's tail, the dump of a mic source): a display of the file, sized by the server's window_words */
async function sendLines(): Promise<void> {
    const cwd = root(); if (!cwd) { post({ type: 'lines', source, lines: [], note: 'not run — no workspace' }); return; }
    const c = chosen(cwd);
    let text: string | null = null;
    try { if (c.file) { text = readFileSync(c.file, 'utf8'); } } catch { /* absent reads as the note below */ }
    if (text === null) { post({ type: 'lines', source, lines: [], note: c.why || 'not run — file absent' }); return; }
    const srv = await serverFor(cwd); const last = srv ? Number((await configOf(srv)).window_words) || 0 : 0;
    if (source === 'paste' && c.file) {   // the register keeps blank lines so the page can place the rule at an exact byte offset
        const all = text.split('\n'); if (all[all.length - 1] === '') { all.pop(); }
        const tail = all.slice(-last);
        const tailStart = Buffer.byteLength(all.slice(0, all.length - tail.length).map((l) => l + '\n').join(''), 'utf8');
        post({ type: 'lines', source, lines: tail, note: '', tailStart, processedBytes: await processedBytesFor(cwd, c.file) });
        return;
    }
    let lines = text.split('\n').filter((l) => l.length > 0);
    const mark = await markOf(cwd, source); if (mark) { lines = lines.filter((l) => l.trimStart().startsWith(mark)); }
    post({ type: 'lines', source, lines: lines.slice(-last), note: '' });
}

/** the text a chunk of the watched file feeds the server: the lines the source keeps, the mark that led them cut off */
async function chunkOf(cwd: string, raw: string): Promise<string> {
    const mark = await markOf(cwd, source); if (!mark) { return raw; }
    return raw.split('\n').map((l) => l.trimStart()).filter((l) => l.startsWith(mark)).map((l) => l.slice(mark.length).trim()).join('\n');
}

/** every text change of the chosen file is an event: the new bytes after `offset` append, a file that shrank is read again whole */
async function feed(): Promise<void> {
    const cwd = root(); const c = cwd ? chosen(cwd) : { file: null, why: '' }; if (!cwd || !c.file) { return; }
    let size = 0; try { size = statSync(c.file).size; } catch { return; }
    const whole = size < offset; if (whole) { offset = 0; }
    if (size === offset) { return; }
    const first = offset === 0; if (first && size > TAIL_BYTES) { offset = size - TAIL_BYTES; }   // the first read seeds the window from the file's tail only
    const fd = openSync(c.file, 'r'); const buf = Buffer.alloc(size - offset);
    try { readSync(fd, buf, 0, buf.length, offset); } finally { closeSync(fd); }
    offset = size;
    const text = await chunkOf(cwd, buf.toString('utf8'));
    if (text.trim()) { await send(first || whole ? { op: 'text', text, source } : { op: 'text', append: text, source }); }
}

/** C743 runs the ledger door; resolves its first stdout line (JSON) or the why it did not run. cwd is the workspace, never a guess. */
function snowDoor(cwd: string, args: string[], stdin?: string, door: string = SNOWBALL): Promise<{ ok: boolean; line: string; json: any }> {
    const script = path.join(cwd, door);
    if (!existsSync(script)) { return Promise.resolve({ ok: false, line: `not run — ${door} is not in this workspace`, json: null }); }
    return new Promise((resolve) => {
        const child = nodeDoor(cwd, script, [...args], { cwd, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
            const line = (String(stdout || '').split('\n').find((l) => l.trim()) || String(stderr || '').split('\n').find((l) => l.trim()) || 'the door printed nothing').trim();
            let json: any = null; try { json = JSON.parse(line); } catch { /* shown as printed */ }
            resolve({ ok: !err && !(json && json.ok === false), line, json });
        });
        if (stdin !== undefined) { child?.stdin?.end(stdin); }
    });
}
let syncing = false;
/** asks the server for the health strip now, then (once per cycle) runs `hud-snowball.mjs sync --json` and asks again so dispatched:true shows once the runner ledger carries the row */
function sendHealth(sync = true): void {
    const cwd = root(); if (!cwd) { return; }
    void send({ op: 'health' });
    if (!sync || syncing || !existsSync(path.join(cwd, '.thetacog', 'hud-snowballs.ndjson'))) { return; }
    syncing = true;
    void snowDoor(cwd, ['sync', '--json']).then(() => { syncing = false; sendHealth(false); });
}

/** the server said `frozen`: the text goes to the one exit (vna.clipIngest), the server's row goes to the ledger door unchanged */
async function onFrozen(cwd: string, ev: any): Promise<void> {
    if (typeof ev.text !== 'string' || !ev.text) { return; }
    if (!(await ingest(ev.text))) { return; }
    const r = await snowDoor(cwd, ['freeze', '--json'], JSON.stringify({ row: ev.row, text: ev.text }));
    if (r.ok && r.json) { post({ type: 'snowball', row: r.json }); sendHealth(); }
    else { post({ type: 'snowStatus', text: `snowball ledger: ${r.line}` }); }
}

// 2026-10-13 (operator: "two registers at least, the paste mass, the speech mass, whatever else, and the latest steer"): the speech register
// is watched on its own, whatever the dropdown streams into the walk, and the latest /steer is read off the operator's interactive tape
let contextTimer: NodeJS.Timeout | undefined;
/** 2026-10-15 (operator: "make sure this runs on all context we have available, transcripts too"): the context door composes every record
 *  into one pool and the server draws the cell words from the window AND that pool; the host carries the text and decides nothing */
function sendContext(): void {
    const cwd = root(); if (!cwd) { return; }
    const script = path.join(cwd, CONTEXT_DOOR); if (!existsSync(script)) { return; }
    nodeDoor(cwd, script, ['--json'], { cwd, timeout: 20000, maxBuffer: 8 << 20 }, (err, out) => {
        if (err) { post({ type: 'serve', event: { kind: 'error', why: 'UNMEASURED: the context pool could not be read (' + String(err.message || err).slice(0, 120) + ')' } }); return; }
        let j: any = null; try { j = JSON.parse(String(out || '').trim().split('\n').pop() || 'null'); } catch { /* reported below */ }
        if (!j || typeof j.text !== 'string') { return; }
        void send({ op: 'context', text: j.text, sources: j.sources || null });
    });
}
let speechWatcher: FSWatcher | undefined; let latestTimer: NodeJS.Timeout | undefined; let audioTimer: NodeJS.Timeout | undefined; let speechPoll: NodeJS.Timeout | undefined; let speechSeen = -1;
let healthTimer: ReturnType<typeof setInterval> | undefined;
// 2026-10-13 (operator: "the cursor did not move, do we need a checkbox or auto paint when its open?"): no checkbox — the register paints itself while
// the view is open. fs.watch alone can miss an append on macOS, so a 2 s stat of the file's mtime repaints whenever it moved (a stat, never a read).
function pollSpeech(): void { const cwd = root(); if (!cwd) { return; } try { const m = statSync(path.join(cwd, STREAM_REL)).mtimeMs; if (m !== speechSeen) { speechSeen = m; sendSpeech(); snapSpeech(); } } catch { /* no stream yet */ } }
/** 2026-10-13 (operator: "the audio is broken.. has not moved since yesterday … we need health metrics for those there"): the audio basin's own
 *  status door, read every 20 s and posted as it is — armed, alive, pid, words a minute, chunks, error. The page shows a dead daemon as dead. */
function sendAudioHealth(): void {
    const cwd = root(); if (!cwd) { return; }
    const script = path.join(cwd, 'scripts/vna/audio-basin.mjs');
    nodeDoor(cwd, script, ['status', '--json'], { cwd, timeout: 15000, maxBuffer: 4 << 20 }, (err, out) => {
        let j: any = null; try { j = JSON.parse(String(out || '')); } catch { /* unreadable */ }
        if (err || !j) { post({ type: 'audioHealth', ok: false, why: err ? String(err.message || err).slice(0, 120) : 'the status door printed no JSON' }); return; }
        post({ type: 'audioHealth', ok: true, armed: !!j.armed, alive: !!j.alive, pid: j.pid ?? null, perMin: j.perMin ?? null, wordsPerMin: j.wordsPerMin ?? null, chunks: j.chunks ?? null, error: j.error ?? null });
        // C233r: armed but dead (a reboot kills the detached daemon, the armed file survives) → the basin's own `ensure` respawns it,
        // from inside the IDE that holds the mic grant; ensure backs off 300 s itself, so a daemon that dies at once is never looped
        if (j.armed && !j.alive) { nodeDoor(cwd, script, ['ensure'], { cwd, timeout: 15000 }, () => { /* the next 20 s read shows LIVE or the backoff */ }); }
    });
}
/** C1015 REFINE READS THE RECORD: the draft plus the speech since the last copy (read without moving the mark) go to hud-ask.mjs refine,
 *  which finds the files the draft names and keeps only the dictation that bears on it; haiku writes the steer (fast), the draft box gets it. */
function refine(draft: string): void {
    const cwd = root(); if (!cwd) { return; }
    post({ type: 'collapseStart', pair: 'your draft + the record', words: [] });
    const { said } = saidSinceMark();
    const script = path.join(cwd, ASK);
    const p = nodeDoor(cwd, script, ['refine'], { cwd, timeout: 120000, maxBuffer: 4 << 20 }, (err, out) => {
        const text = String(out || '');
        post({ type: 'askDone', ok: !err && !!text.trim(), text, why: err ? String(err.message || err).slice(0, 160) : '' });
        if (text) { appendChatTurn(cwd, 'assistant', text); }
    });
    p?.stdin?.end(JSON.stringify({ draft, said }));
}
/** C1014b THE MODEL WORDS: one call in flight at most, and a new call only for a grid whose words changed (the door caches by bytes too). */
let rewordBusy = false; let rewordSig = '';
function reword(cells: unknown[], sig: string): void {
    const cwd = root(); if (!cwd || rewordBusy || sig === rewordSig) { return; }
    rewordBusy = true; rewordSig = sig;
    const script = path.join(cwd, ASK);
    const p = nodeDoor(cwd, script, ['reword'], { cwd, timeout: 120000, maxBuffer: 1 << 20 }, (err, out) => {
        rewordBusy = false;
        let j: any = null; try { j = JSON.parse(String(out || '')); } catch { /* unreadable */ }
        if (err || !j || !j.ok) { rewordSig = ''; post({ type: 'reworded', ok: false, sig, cells: [], why: j && j.why ? j.why : String((err && err.message) || 'the reword door printed no JSON').slice(0, 140) }); return; }
        post({ type: 'reworded', ok: true, sig, cells: j.cells, cached: !!j.cached });
    });
    p?.stdin?.end(JSON.stringify({ cells }));
}
/** C1014a (operator 2026-10-19: "a way to restart the transcribe"): the basin's own restart verb, then a fresh health read. */
function audioRestart(): void {
    const cwd = root(); if (!cwd) { return; }
    const script = path.join(cwd, 'scripts/vna/audio-basin.mjs');
    nodeDoor(cwd, script, ['restart'], { cwd, timeout: 20000 }, (err, out) => {
        post({ type: 'audioRestarted', ok: !err, line: String(out || (err && err.message) || '').trim().split('\n')[0].slice(0, 160) });
        setTimeout(sendAudioHealth, 4000);
    });
}
function sendSpeech(): void {
    const cwd = root(); if (!cwd) { return; }
    const abs = path.join(cwd, STREAM_REL);
    let mtime = 0; try { mtime = statSync(abs).mtimeMs; } catch { post({ type: 'speech', text: '', note: `no ${STREAM_REL} yet — arm 🎙️ audio to transcribe` }); return; }
    post({ type: 'speech', text: tailOf(abs, 6000), mtime });
}
function sendLatestSteer(): void {
    const cwd = root(); if (!cwd) { return; }
    const script = path.join(cwd, ASK);
    nodeDoor(cwd, script, ['latest'], { cwd, timeout: 20000, maxBuffer: 8 << 20 }, (err, out) => {
        if (err) { post({ type: 'latestSteer', text: '', note: 'the tape could not be read: ' + String(err.message || err).slice(0, 120) }); return; }
        let s = ''; try { s = JSON.parse(String(out || '""')); } catch { /* an empty read */ }
        post({ type: 'latestSteer', text: String(s).replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim() });
    });
}
async function rewatch(): Promise<void> {
    speechWatcher?.close(); speechWatcher = undefined;
    { const cwd0 = root(); if (cwd0) { try { speechWatcher = watch(path.join(cwd0, STREAM_REL), () => sendSpeech()); } catch { /* no stream yet: the next ready retries */ } } }
    sendSpeech(); sendLatestSteer(); sendAudioHealth(); sendScratch();
    { const c0 = root(); if (c0 && copyMark < 0) { try { copyMark = statSync(path.join(c0, STREAM_REL)).size; } catch { /* no stream yet */ } } }
    if (!audioTimer) { audioTimer = setInterval(sendAudioHealth, 20000); }
    if (!speechPoll) { speechPoll = setInterval(pollSpeech, 2000); }
    if (!latestTimer) { latestTimer = setInterval(sendLatestSteer, 60000); }
    if (!contextTimer) { contextTimer = setInterval(sendContext, 30000); }
    // the health strip is asked for on a timer too (2026-10-13: the card read "health 383 s ago" while idle): no event, still a fresh reading
    if (!healthTimer) { healthTimer = setInterval(() => sendHealth(false), 60000); }
    watcher?.close(); watcher = undefined;
    const cwd = root(); const c = cwd ? chosen(cwd) : { file: null, why: '' };
    if (!cwd) { await sendLines(); return; }
    await serverFor(cwd);
    sendContext();
    offset = 0;   // the new source's tail is the window's first text: read whole once, then follow
    if (c.file) { try { watcher = watch(c.file, () => { void feed(); void sendLines(); sendHealth(); }); } catch { /* the file is not there yet: the next source change retries */ } }
    await feed(); await sendLines(); sendHealth();
    const last = await snowDoor(cwd, ['list', '--json']);   // the 🚀 button's target survives a reload of the view
    const rows = last.json && Array.isArray(last.json.rows) ? last.json.rows : [];
    if (rows.length) { post({ type: 'snowball', row: rows[rows.length - 1] }); }
}

/**
 * C742 THE LLM DOOR. The page posts {type:'ask', text}; this hands the text to the same relay 💬 Steer chat uses (chat-core
 * streamChat, the OLLAMA_HOST slot, the picked model), with chatContextFor plus the server's last ask_line as the system message, streams
 * askToken/askDone back, and records both turns on the shared transcript. The receipt path stays LLM-free: nothing here posts a
 * reading, a colour or a freeze, and the reply is text for the page's reply pane only.
 */
let lastGridEv: any = null;
/** the tail of a file, at most n bytes, decoded; '' when it cannot be read (a bounded read, never the whole file) */
function tailOf(abs: string, n: number): string {
    try { const sz = statSync(abs).size; const fd = openSync(abs, 'r'); const len = Math.min(n, sz); const b = Buffer.alloc(len); readSync(fd, b, 0, len, sz - len); closeSync(fd); return b.toString('utf8'); } catch { return ''; }
}
/** 2026-10-13 THE COLLAPSE (operator: "when the user click a 3 x 3 it … interprets the current register of dictated contents out of the
 *  perspective by the intersection's meaning … and the three words … and feeds everything that it has … to be steer … based on the prior
 *  dictation and the other snowballs that have run … When you click the grid collapses and its ability to make sense while doing that is
 *  sort of a proof"). One prompt, composed here from records already on disk and the grid already painted; the model writes the steer,
 *  the page puts it in the draft box for the operator to copy. The receipt path stays LLM-free: nothing the model says changes a cell. */
export function collapsePrompt(cell: any, register: string, snowballs: any[], draft: string): string {
    const pair = String(cell && cell.why || '').split(' · ')[0] || 'this cell';
    const words = cell ? [cell.strategy, cell.tactics, cell.operations].filter(Boolean).join(' · ') : '';
    const snow = snowballs.map((r) => `- ${String(r.at || '').slice(11, 19)} ${r.dispatched ? 'dispatched' : 'frozen'} · ${String(r.text || r.archetype || r.text_sha || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') || '- none yet';
    return `Collapse my dictation into the next /steer, read from the ${pair} intersection — the words it heard there: ${words || 'none yet'}.\n\n`
        + `WHAT I HAVE SAID (the register, newest last):\n${register.trim() || '(nothing yet)'}\n\n`
        + `THE SNOWBALLS THAT RAN (newest last):\n${snow}\n\n`
        + `THE LIVE DRAFT:\n${draft.trim() || '(empty)'}\n\n`
        + 'Write the /steer I am reaching for. Keep my words; order the asks by what this intersection says matters most; name anything I left ambiguous in one line. End with the steer alone, starting with /steer.';
}
/** 2026-10-13 (the operator's paste: "Ask about the grid" came back "I can't see a grid"): claude -p runs in an empty temp dir and knew nothing of
 *  the HUD, so every HUD ask now carries the grid as the server painted it — each cell's tier pair, its three words, its colour */
export function gridBriefOf(slots: any[]): string {
    const cells = (Array.isArray(slots) ? slots : []).map((c: any) => (c ? `- ${String(c.why || '').split(' · ')[0] || 'a cell'}: ${[c.strategy, c.tactics, c.operations].filter(Boolean).join(' · ')}${c.colour ? ` (${c.colour})` : ''}` : null)).filter(Boolean);
    return cells.length ? `THE HUD GRID (3×3 of strategy / tactics / operations intersections; three words each, the ones the operator's recent words point at hardest there):\n${cells.join('\n')}` : 'THE HUD GRID: empty — no words placed yet.';
}
const gridBrief = (): string => gridBriefOf(lastGridEv && lastGridEv.slots);
const gridWords = (): string[] => (lastGridEv && Array.isArray(lastGridEv.slots) ? lastGridEv.slots : []).flatMap((c: any) => (c ? [c.strategy, c.tactics, c.operations] : [])).filter(Boolean).map(String);
/** 2026-10-13 ✍️ WRITE THE STEER (operator: "we need the llm to write the steer guessing next questions based on cc transcripts and recent
 *  semantic mass in dictations / pastes … steers cannot be ncd written"): the door composes the seed off the records (the scratch first) and
 *  the model writes the steer; the 3×3 words ride as hints. The local engine gets the same seed through the steer chat's model. */
async function writeSteer(m: any): Promise<void> {
    const cwd = root(); if (!cwd) { return; }
    post({ type: 'collapseStart', pair: 'the record', words: [] });
    if (viaClaude(m.engine)) { const out = await askClaude(JSON.stringify({ words: gridWords() }), 'steer', m.engine); const at = out.lastIndexOf('/steer'); if (at >= 0) { rankPreview(out.slice(at).trim()); } return; }
    const script = path.join(cwd, ASK);
    const seed = await new Promise<string>((done) => { nodeDoor(cwd, script, ['seed', '--words', gridWords().join(',')], { cwd, timeout: 60000, maxBuffer: 16 << 20 }, (err, out) => done(err ? '' : String(out || ''))); });
    if (!seed) { post({ type: 'askDone', ok: false, text: '', why: 'the seed door printed nothing' }); return; }
    await ask({ text: seed, engine: 'local' });
}
/** 2026-10-13 🧲 THE SCRATCH (operator: "a preprocessor scratchpad where we keep relevant semantics we snap up (associative register under next
 *  steer, you can write to it, dictation auto fills it, clear anytime"): new speech goes to the snap door, which appends every sentence that
 *  carries one of the grid's words; the operator's edits and 🧹 go to the same door. The steer writer reads the scratch first. */
const SCRATCH_REL = '.thetacog/hud-scratch.txt';
let scratchOffset = -1;
function sendScratch(): void { const cwd = root(); if (!cwd) { return; } post({ type: 'scratch', text: tailOf(path.join(cwd, SCRATCH_REL), 8000) }); }
function snapSpeech(): void {
    const cwd = root(); if (!cwd) { return; }
    let size = 0; try { size = statSync(path.join(cwd, STREAM_REL)).size; } catch { return; }
    if (scratchOffset < 0 || size < scratchOffset) { scratchOffset = size; return; }   // the first look is the past, never snapped
    if (size === scratchOffset) { return; }
    const fresh = tailOf(path.join(cwd, STREAM_REL), Math.min(size - scratchOffset, 64000)); scratchOffset = size;
    const script = path.join(cwd, ASK);
    const p = nodeDoor(cwd, script, ['snap'], { cwd, timeout: 20000, maxBuffer: 4 << 20 }, (err, out) => {
        let add: string[] = []; try { add = JSON.parse(String(out || '[]')); } catch { /* none */ }
        if (!err && add.length) { post({ type: 'snapped', lines: add }); sendScratch(); }
    });
    p?.stdin?.end(JSON.stringify({ text: fresh, words: gridWords() }));
}
function saveScratch(text: string): void {
    const cwd = root(); if (!cwd) { return; }
    const script = path.join(cwd, ASK);
    const p = nodeDoor(cwd, script, ['scratch-save'], { cwd, timeout: 20000 }, () => sendScratch());
    p?.stdin?.end(text);
}
let copyMark = -1;
/** the steer plus every line heard since the last copy (or since the HUD opened), timestamps cut — what was said in the vicinity of the steer
 *  rides into it; the mark moves on, so a line is appended once */
export function saidSince(fresh: string): string {
    return fresh.split('\n').map((l) => l.replace(/^\s*\[[^\]]*\]\s*/, '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
/** 2026-10-13 (operator: "or associatively appended?"): the append door keeps only the dictated sentences the steer does not already carry */
/** what was dictated since the last copy (or since the HUD opened), read without moving the mark — the ranking preview and the copy read the same span */
function saidSinceMark(): { said: string; size: number } {
    const cwd = root(); if (!cwd) { return { said: '', size: -1 }; }
    let size = 0; try { size = statSync(path.join(cwd, STREAM_REL)).size; } catch { return { said: '', size: -1 }; }
    const from = copyMark < 0 || copyMark > size ? size : copyMark;
    return { said: from < size ? saidSince(tailOf(path.join(cwd, STREAM_REL), Math.min(size - from, 64000))) : '', size };
}
/** 2026-10-13 (operator: "Show me the ranking in the expanded pill before I copy"): the rank door over the steer in the box and the span since
 *  the last copy; the page paints it in the 📋 pill — ✓ kept (rides in on copy), · carried (the steer holds it), ✗ ambient (never rides in) */
function rankPreview(steer: string): void {
    const cwd = root(); if (!cwd) { return; }
    const { said } = saidSinceMark();
    if (!said || !steer.trim()) { post({ type: 'assocRank', rows: [], why: !said ? 'nothing dictated since the last copy' : 'the steer box is empty' }); return; }
    const script = path.join(cwd, ASK);
    const p = nodeDoor(cwd, script, ['rank'], { cwd, timeout: 20000, maxBuffer: 4 << 20 }, (err, out) => {
        let rows: any[] = []; try { rows = JSON.parse(String(out || '[]')); } catch { /* unreadable */ }
        post({ type: 'assocRank', rows: err ? [] : rows, why: err ? 'the rank door failed: ' + String(err.message || err).slice(0, 100) : '' });
    });
    p?.stdin?.end(JSON.stringify({ steer, said }));
}
function withSaidSince(steer: string): Promise<{ text: string; note: string }> {
    const plain = { text: steer, note: '' };
    const cwd = root(); if (!cwd) { return Promise.resolve(plain); }
    const { said, size } = saidSinceMark(); if (size < 0) { return Promise.resolve(plain); }
    copyMark = size;
    if (!said) { return Promise.resolve(plain); }
    const script = path.join(cwd, ASK);
    return new Promise((done) => {
        const p = nodeDoor(cwd, script, ['append'], { cwd, timeout: 20000, maxBuffer: 4 << 20 }, (err, out) => {
            let j: any = null; try { j = JSON.parse(String(out || '')); } catch { /* unreadable */ }
            if (err || !j || typeof j.text !== 'string') { done(plain); return; }   // the door failed: the steer alone, never a raw dump
            done({ text: j.text, note: `+${j.kept} dictated · ${j.carried} already in the steer · ${j.ambient || 0} ambient left out${j.dropped ? ` · ${j.dropped} less associated left out` : ''}` });
        });
        p?.stdin?.end(JSON.stringify({ steer, said }));
    });
}
async function collapse(m: any): Promise<void> {
    const cwd = root(); if (!cwd || !Number.isInteger(m.n)) { return; }
    const cell = lastGridEv && Array.isArray(lastGridEv.slots) ? lastGridEv.slots[m.n] : null;
    if (!cell) { post({ type: 'snowStatus', text: 'collapse: that cell holds no words yet' }); return; }
    const rel = steerRel(cwd); const register = rel ? tailOf(path.join(cwd, rel), 2400) : '';
    const snowRows = tailOf(path.join(cwd, '.thetacog', 'hud-snowballs.ndjson'), 16000).split('\n').filter(Boolean).slice(-5).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    post({ type: 'collapseStart', pair: String(cell.why || '').split(' · ')[0], words: [cell.strategy, cell.tactics, cell.operations] });
    await ask({ text: collapsePrompt(cell, register, snowRows, String(m.draft || '')), engine: m.engine });
}
/** 2026-10-13 (operator: "the controls for writing the steer (with different calls? claude -p is best..)"): the steer calls — Refine, the click
 *  collapse, Ask about the grid — go to `claude -p` by default (every CLAUDE_* variable stripped, the runner's own rule, or the child hangs on
 *  the parent's session) or to the local model the steer chat picks. A model's words land in the reply and the draft box, never in a cell. */
const MODEL_OF: Record<string, string[]> = { claude: [], haiku: ['--model', 'haiku'] };   // 2026-10-13 (operator: "use haiky as an option why not")
const viaClaude = (engine: unknown): boolean => typeof engine === 'string' && Object.prototype.hasOwnProperty.call(MODEL_OF, engine);
function askClaude(text: string, verb = 'claude', engine = 'claude'): Promise<string> {
    return new Promise((done) => {
        const cwd = root() || undefined; if (!cwd) { post({ type: 'askDone', ok: false, text: '', why: 'no workspace' }); done(''); return; }
        const script = path.join(cwd, ASK);
        let out = '', settled = false;
        const finish = (ok: boolean, why = '') => { if (settled) { return; } settled = true; post({ type: 'askDone', ok, text: out, why }); if (out) { appendChatTurn(cwd, 'assistant', out); } done(ok ? out : ''); };
        const p = nodeDoor(cwd, script, [verb, ...(MODEL_OF[engine] || [])], { cwd, timeout: 240000, maxBuffer: 16 << 20 }, (err) => { finish(!err && !!out.trim(), err ? String(err.message || err).slice(0, 160) : ''); });
        p?.stdout?.on('data', (b: Buffer | string) => { const s = String(b); out += s; post({ type: 'askToken', t: s }); });
        appendChatTurn(cwd, 'hud', verb === 'steer' ? '(the steer seed, composed by hud-ask.mjs steer)' : text);   // a HUD-composed prompt is the HUD's, never the operator's words
        p?.stdin?.end(text);
    });
}

async function ask(m: any): Promise<void> {
    if (viaClaude(m.engine)) { const text = String(m.text || '').trim(); if (text) { await askClaude(`${gridBrief()}\n\n${text}`, 'claude', m.engine); } return; }
    const text = String(m.text || '').trim(); if (!text) { return; }
    const cwd = root(); const srv = cwd ? await serverFor(cwd) : null;
    const model: string = (ctx && ctx.globalState.get<string>(MODEL_KEY)) || vscode.workspace.getConfiguration('vna').get<string>('chat.model') || chatCore.FALLBACK_MODEL;
    const hostUrl: string = (ctx && await ctx.secrets.get(OLLAMA_SLOT)) || chatCore.DEFAULT_HOST;
    appendChatTurn(cwd, 'hud', text);   // a HUD-composed prompt is the HUD's, never the operator's words
    try {
        const tree = await chatContextFor(cwd, model, text);
        const sys = { role: 'system', content: `${tree.context}\n${srv ? srv.askLine : ''}` };
        const fit = chatCore.fitMessages([sys, { role: 'user', content: text }], await chatCore.contextLength({ host: hostUrl, model }));
        const r = await chatCore.streamChat({ host: hostUrl, model, messages: fit.messages, options: { num_ctx: fit.num_ctx }, onToken: (t: string) => post({ type: 'askToken', t }) });
        if (r.text) { appendChatTurn(cwd, 'assistant', r.text); }
        post({ type: 'askDone', ok: !!r.ok, text: r.text || '' });
    } catch (e) { post({ type: 'askDone', ok: false, text: '' }); }
}

async function onMessage(m: any): Promise<void> {
    if (!m || typeof m.type !== 'string') { return; }
    if (m.type === 'ready') { await rewatch(); return; }
    if (m.type === 'config') { await send({ op: 'config' }); return; }
    if (m.type === 'health') { sendHealth(); return; }
    if (m.type === 'audioRestart') { audioRestart(); return; }
    if (m.type === 'refine' && typeof m.draft === 'string' && m.draft.trim()) { refine(m.draft); return; }   // C1015: the refine door reads the record
    if (m.type === 'reword' && Array.isArray(m.cells)) { reword(m.cells, String(m.sig || '')); return; }   // C1014b: only while the 🧠 box is ticked   // C1014a: a click only (the page posts it from the button's handler)
    if (m.type === 'source' && typeof m.source === 'string' && SOURCES.includes(m.source)) { source = m.source; await rewatch(); return; }
    if (m.type === 'ask') { await ask(m); return; }
    if (m.type === 'collapse') { await collapse(m); return; }
    if (m.type === 'writeSteer') { await writeSteer(m); return; }
    if (m.type === 'rankAssoc' && typeof m.steer === 'string') { rankPreview(m.steer); return; }
    if (m.type === 'scratchSave' && typeof m.text === 'string') { saveScratch(m.text); return; }
    // 2026-10-13: the draft's 📋 copy, through the sidebar's one copy door (stamped so the clipboard daemon never re-appends it, ledgered outbound)
    if (m.type === 'copyDraft' && typeof m.text === 'string' && m.text.trim()) { const said = await withSaidSince(m.text); const text = said.text; await copyOut(root() || undefined, text, 'ide:hud 📋 copy to /steer'); vscode.window.setStatusBarMessage(`📋 the /steer is on the clipboard${said.note ? ' · ' + said.note : ''} — paste it into the chat`, 4000); post({ type: 'copied', note: said.note }); setTimeout(sendLatestSteer, 30000); return; }
    // H5: a pill's ↗ opens the file it feeds through vna.openFile (its repo guard refuses a path outside the tree)
    if (m.type === 'open' && typeof m.id === 'string') { const p = PILLS.find((x) => x.id === m.id); const rel = p ? pillFile(root(), p) : null; if (rel) { await pillDoor('vna.openFile', rel); } return; }
    // the pills' checkboxes run the same commands the sidebar's do, allowlisted, then repaint the states off the marker files
    if (m.type === 'pill' && typeof m.cmd === 'string' && (PILL_CMDS as readonly string[]).includes(m.cmd)) { await pillDoor(m.cmd); post({ type: 'pills', state: pillsState(root()) }); return; }
    if (m.type === 'pills') { post({ type: 'pills', state: pillsState(root()) }); return; }
    // the page's user events go straight to the server's stdin with the page's `by`; the asymmetric gate is the server's
    if (m.type === 'select' && Number.isInteger(m.n)) { await send({ op: 'select', n: m.n, by: String(m.by || '') }); return; }
    if (m.type === 'defend' && Number.isInteger(m.n)) { await send({ op: 'defend', n: m.n, sentence: String(m.sentence || '') }); return; }
    // C770 the page's select latency: key|click only, handed to the one writer (hud-readings.mjs append) on stdin; the host appends nothing itself
    if (m.type === 'readings') {
        const cwd = root(); if (!cwd || (m.by !== 'key' && m.by !== 'click') || !Number.isFinite(m.select_latency_ms)) { return; }
        void snowDoor(cwd, ['append'], JSON.stringify({ select_latency_ms: m.select_latency_ms, from_event: String(m.from_event || ''), by: m.by }), READINGS); return;
    }
    if (m.type === 'freeze') { await send({ op: 'freeze', by: String(m.by || '') }); return; }
    // C743 🚀: the host's gate, the twin of the page's. Only by 'click' or 'key' passes; a voice-shaped message (any other or no by) is refused before any spawn.
    if (m.type === 'dispatch') {
        if (m.by !== 'click' && m.by !== 'key') { post({ type: 'serve', event: { kind: 'refused', why: `REFUSED: origin "${m.by || 'none'}" is not key|click — a voice-shaped message never dispatches` } }); return; }
        const cwd = root(); if (!cwd || typeof m.text_sha !== 'string' || !/^[0-9a-f]{12,64}$/.test(m.text_sha)) { post({ type: 'snowStatus', text: 'dispatch: no such snowball' }); return; }
        const r = await snowDoor(cwd, ['dispatch', m.text_sha, '--by', m.by, '--json']);
        const line = r.json && r.json.spawned ? `dispatched ${m.text_sha.slice(0, 8)} through the detached steer door` : (r.json && r.json.reason) || r.line;
        post({ type: 'snowStatus', text: line });
        if (r.ok) { vscode.window.showInformationMessage(`🚀 ${line}`); } else { vscode.window.showWarningMessage(`🚀 ${line}`); }
        sendHealth(); return;
    }
    // C740 the register: a typed line goes to the ONE writer (clip-ingest.mjs --stdin under its own --by) via vna.clipIngest, never appended from here
    if (m.type === 'append' && typeof m.text === 'string' && m.text.trim()) {
        if (await ingest(m.text.trim())) { post({ type: 'registerStatus', text: 'appended 1 line through the clip door' }); }
        void sendLines(); return;
    }
    // C740 🧹: only the click clears. A message without by:'click' (a voice-shaped one) is refused before any spawn.
    if (m.type === 'clearProcessed') {
        if (m.by !== 'click') { post({ type: 'registerStatus', text: 'REFUSED: clearing needs the 🧹 click — a voice-shaped message never clears' }); return; }
        await clearProcessed(); return;
    }
}

/** the one exit for text bound for the steer file: vna.clipIngest (C98e), whose door is clip-ingest.mjs --stdin */
async function ingest(text: string): Promise<boolean> {
    try { await vscode.commands.executeCommand('vna.clipIngest', text); return true; }
    catch (e) { vscode.window.showWarningMessage(`🎯 vna.clipIngest is not registered in this window — Reload Window (${String((e as Error)?.message || e).slice(0, 80)})`); return false; }
}

/** C740 spawns the existing clear door; its own first line (the receipt or the refusal with its why) is the status and the toast */
function clearProcessed(): Promise<void> {
    const cwd = root(); const script = cwd ? path.join(cwd, 'scripts', 'vna', 'steer-file-clear.mjs') : '';
    if (!cwd || !existsSync(script)) { post({ type: 'registerStatus', text: 'not run — scripts/vna/steer-file-clear.mjs is not in this workspace' }); return Promise.resolve(); }
    return new Promise<void>((resolve) => {
        nodeDoor(cwd, script, ['--json'], { cwd, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1 << 20 }, (_err, stdout, stderr) => {
            const first = (String(stdout || '').split('\n').find((l) => l.trim()) || String(stderr || '').split('\n').find((l) => l.trim()) || 'the door printed nothing').trim();
            let line = first, ok = false;
            try { const j = JSON.parse(first); ok = j.status === 'cleared'; line = ok ? `cleared ${j.row && j.row.cleared ? j.row.cleared.bytes : '?'}B from the top, kept ${j.keptBytes}B` : `NOT ADMISSIBLE: ${j.reason || first}`; } catch { /* show the line as printed */ }
            post({ type: 'registerStatus', text: line });
            if (ok) { vscode.window.showInformationMessage(`🧹 ${line}`); } else { vscode.window.showWarningMessage(`🧹 ${line}`); }
            void sendLines(); resolve();
        });
    });
}

class HudViewProvider implements vscode.WebviewViewProvider {
    async resolveWebviewView(v: vscode.WebviewView): Promise<void> {
        view = v;
        const media = vscode.Uri.joinPath(ctx!.extensionUri, 'media');
        v.webview.options = { enableScripts: true, localResourceRoots: [media] };
        v.webview.html = await html(v.webview, media);
        v.webview.onDidReceiveMessage((m) => void onMessage(m));
        v.onDidDispose(() => { view = undefined; watcher?.close(); watcher = undefined; speechWatcher?.close(); speechWatcher = undefined; if (latestTimer) { clearInterval(latestTimer); latestTimer = undefined; } if (audioTimer) { clearInterval(audioTimer); audioTimer = undefined; } if (speechPoll) { clearInterval(speechPoll); speechPoll = undefined; } if (healthTimer) { clearInterval(healthTimer); healthTimer = undefined; } });
    }
}

export function registerVnaHud(context: vscode.ExtensionContext): void {
    ctx = context;
    chatCore = require(path.join(context.extensionPath, 'media', 'chat-core.js'));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, new HudViewProvider(), { webviewOptions: { retainContextWhenHidden: true } }));
}

/** H4/H5/H6 (operator 2026-10-12): the controls below the grid wear the "Steer — Where The Work Landed" sidebar's own markup —
 * its pillBox card and its `sb chk` checkbox pills, styled by its PAGE_CSS, both read live off scripts/vna/steer-ui.mjs (one module,
 * never a second hand-rolled copy). Each checkbox pill carries a ↗ door to the file it feeds (H5) and its one-line why (H6). No inline
 * handlers: the HUD's CSP is nonce-only, so media/hud.js wires every id here. mod null (away from home) paints the bare controls —
 * UNMEASURED reuse, never a crash. The pill STATES are three marker files the host reads by existence, deciding nothing. */
export const STREAM_REL = '.thetacog/audio/stream.txt';
export const PILLS = [
    { id: 'clip', name: 'auto-paste', on: '.thetacog/vna-clip.armed', arm: 'vna.clipArm', disarm: 'vna.clipDisarm', file: 'steer', why: 'What you paste or type lands in the steer txt and is walked.' },
    { id: 'audio', name: 'audio', on: '.thetacog/audio/armed', arm: 'vna.audioArm', disarm: 'vna.audioDisarm', file: '.thetacog/audio/stream.txt', why: 'Everything heard is transcribed into .thetacog/audio/stream.txt and walked.' },
    { id: 'build', name: 'auto-build', on: '.thetacog/audio/autobuild', arm: 'vna.audioAutobuildOn', disarm: 'vna.audioAutobuildOff', file: 'docs/specs/vna/SPEC-VNA-COCKPIT.md', why: 'The steer dispatches CLEAR rows from what was heard, each to a turn-capped worker, and ticks only on a green guard.' },
] as const;
export const PILL_CMDS = PILLS.flatMap((p) => [p.arm, p.disarm]);
/** the HUD's second door, and its only other one: a CLICK on a pill runs one of the six arm/disarm commands or vna.openFile (H5), nothing
 * else — never a worker, a goal or a send, and never from a heard word (the page posts these only from click handlers). */
export const PILL_DOOR = [...PILL_CMDS, 'vna.openFile'] as const;
function pillDoor(cmd: string, arg?: string): Thenable<unknown> | undefined {
    if (!(PILL_DOOR as readonly string[]).includes(cmd)) { return undefined; }
    return vscode.commands.executeCommand(cmd, ...(arg ? [arg] : []));
}
function steerRel(cwd: string): string | null {
    try { const p = JSON.parse(readFileSync(path.join(cwd, '.thetacog', 'vna-steer-file.json'), 'utf8')); return p && typeof p.source === 'string' ? p.source : null; } catch { return null; }
}
function pillFile(cwd: string | null | undefined, p: typeof PILLS[number]): string | null { return p.file === 'steer' ? (cwd ? steerRel(cwd) : null) : p.file; }
function pillsState(cwd: string | null | undefined): Record<string, { on: boolean; file: string | null }> {
    const out: Record<string, { on: boolean; file: string | null }> = {};
    for (const p of PILLS) { out[p.id] = { on: !!cwd && existsSync(path.join(cwd, p.on)), file: pillFile(cwd, p) }; }
    return out;
}
function controlsShelf(mod: any, cwd: string | null | undefined): { srcCard: string; pillsCard: string; healthCard: string; snowCard: string } {
    const st = pillsState(cwd);
    // H7 (operator 2026-10-12: "stream .txt needs to be one of the dropdown, as with the steer txt"): each option names the txt it streams
    const steer = cwd ? steerRel(cwd) : null;
    const sourceSelect = `<select id="source" title="which txt streams into the window">`
        + `<option value="paste" title="${steer || 'no steer file pointer'}">📋 ${steer ? path.basename(steer) : 'steer txt'} — steer txt</option>`
        + `<option value="all" title="${STREAM_REL}">🎙️ stream.txt — all audio</option>`
        + `<option value="external" title="${STREAM_REL}, external mic lines">🎙️ stream.txt — external mic</option>`
        + `<option value="internal" title="${STREAM_REL}, internal (loopback) lines">🔈 stream.txt — internal mic</option></select>`;
    const pill = (p: typeof PILLS[number]) => `<label class="sb chk${st[p.id].on ? ' on' : ''}" title="${p.why}"><input type="checkbox" id="cb-${p.id}"${st[p.id].on ? ' checked' : ''}> ${p.name}</label>`
        + `<button class="mini open" id="op-${p.id}" title="open ${st[p.id].file || 'its file'}"${st[p.id].file ? '' : ' disabled'}>↗</button>`;
    const whys = PILLS.map((p) => `<div class="why" id="why-${p.id}"><b>${p.name}</b> — ${p.why}</div>`).join('');
    // the pictures first (hud-core healthViz off the event's numbers), the server's composed lines under them
    const healthPre = `<div id="hviz" class="hviz"></div><pre id="hvizline" class="health hvizline"></pre><pre id="health" class="health"></pre>`;
    // H14 (operator 2026-10-12: "the worm/snowball needs to go somewhere"): the frozen snowball gets its own card, with the one 🚀 door that
    // dispatches it; the page writes only what the host's {type:'snowball'} / the server's `frozen` event said, never a snowball of its own
    const snowFace = `<button class="action lbl" type="button" title="the frozen snowball and its one dispatch door">❄ Snowball</button> · <span id="snowline" class="measure">none frozen yet — Enter freezes the grid</span>`;
    const snowBtn = `<button id="dispatch" class="hudbtn" title="dispatch the last frozen snowball through the detached steer door (Ctrl+Enter does the same)">🚀 Send to /steer</button>`;
    const snowUnder = `<div class="why">Enter freezes what the grid heard into a snowball (one row on .thetacog/hud-snowballs.ndjson) · 🚀 or Ctrl+Enter hands that snowball to /steer, which turns it into spec rows and turn-capped workers · a heard word never sends</div>`;
    // H15 ("below we need realtime — did we get stuck again?"): the health header carries the age of the last line the server sent, ticking
    const healthFace = '<button class="action lbl" type="button" title="the lines the server composes: WALK, L1 BOUNDARY, SNOWBALLS, TRACES, OPTIMISATION (every floor and ratchet, and each hook over its floor), and their pictures">🩺 Health</button> · <span id="hage" class="age measure">waiting for the server</span>';
    if (!mod || typeof mod.pillBox !== 'function') {
        return { srcCard: sourceSelect, pillsCard: `<div class="pills">${PILLS.map(pill).join(' ')}</div>${whys}`, healthCard: `<div>${healthFace}</div>${healthPre}`, snowCard: `<div>${snowFace} ${snowBtn}</div>` };
    }
    // 2026-10-13 (operator: "these break it - they dont have their comment under the expanded plus as above"): the face carries the action and its
    // metrics; the help and the detail live in the + drawer, as every other card on the page does
    const srcFace = `<button class="action lbl" type="button" title="which txt streams into the grid's window">🗂 Source</button> · ${sourceSelect}`;
    const srcHelp = `<div class="why">The grid walks one txt at a time: the steer txt (what you paste or type) or stream.txt (what the mic heard — all, external or internal). The 🎙️ Speech and 📋 Paste cards show both registers whichever one is walked.</div>`;
    return {
        srcCard: mod.pillBox('c-src', 'hudsrc', srcFace, { plusTitle: 'file selection — which source streams into the window', inner: srcHelp }),
        pillsCard: mod.pillBox('c-pills', 'hudpills', PILLS.map(pill).join(' '), { plusTitle: 'what each checkbox is for', inner: whys }),
        healthCard: mod.pillBox('c-health', 'hudhealth', healthFace, { plusTitle: 'the lines the server composes: WALK, L1 BOUNDARY, SNOWBALLS, TRACES, OPTIMISATION (every floor and ratchet, and each hook over its floor)', inner: healthPre }),
        snowCard: mod.pillBox('c-snow', 'hudsnow', `${snowFace} ${snowBtn}`, { plusTitle: 'the frozen snowball and its one dispatch door', inner: snowUnder }),
    };
}

async function html(w: vscode.Webview, media: vscode.Uri): Promise<string> {
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const cwd = root();
    const mod = cwd ? await steerUiModule(cwd) : null;
    return pageHtml({ cspSource: w.cspSource, uri: (f) => w.asWebviewUri(vscode.Uri.joinPath(media, f)).toString(), nonce, mod, cwd });
}
/** the HUD page itself, a pure function of its inputs (2026-10-13): the host passes the webview's csp source and uri mapper; a guard
 *  renders the SAME markup in headless Chromium at sidebar widths and reads the layout off the rendered page, never off a copy */
export function pageHtml({ cspSource, uri, nonce, mod, cwd }: { cspSource: string; uri: (f: string) => string; nonce: string; mod: any; cwd: string | null | undefined }): string {
    const u = uri;
    const { srcCard, pillsCard, healthCard, snowCard } = controlsShelf(mod, cwd);
    // 2026-10-13 (operator: "enforce the design language everywhere - the plus active buttons then metrics, expand to see the txt file being
    // written … scroll horizontally if long"): every HUD section is the main window's own pillBox — the + at the left, the bold action pill,
    // then · its live metrics on one line that scrolls sideways when long; the + opens the drawer (the txt being written, the controls).
    // 2026-10-13 (operator: "auto close all fields in hud by default"): every section starts closed — its face line (the action pill and its live
    // metrics) is the reading; the + opens the detail. Away from home (no steer-ui module) a plain <details> carries the same parts.
    const sec = (id: string, label: string, title: string, inner: string, open: boolean, cls = '', action = ''): string => {
        const face = `<button class="action lbl" type="button"${action ? ` id="${action}"` : ''} title="${title}">${label}</button> · <span class="measure" id="sum-${id}"></span>`;
        if (mod && typeof mod.pillBox === 'function') {
            const h: string = mod.pillBox(`c-${id} hudpill${cls ? ' ' + cls : ''}`, `hud${id}`, face, { inner, plusTitle: title });
            return open ? h.replace(`<details class="plus" id="plus-hud${id}">`, `<details class="plus" id="plus-hud${id}" open>`) : h;
        }
        return `<details class="hudsec ${cls}" id="sec-${id}"${open ? ' open' : ''}><summary title="${title}">${face}</summary>${inner}</details>`;
    };
    const pageCss = mod && typeof mod.PAGE_CSS === 'string' ? mod.PAGE_CSS : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
${pageCss ? `<style nonce="${nonce}">${pageCss}</style>` : ''}
<link rel="stylesheet" href="${u('hud.css')}"></head>
<body class="hudview">
  <!-- the legend frame (operator 2026-10-13: "the 3x3 needs to be strategy tactics operations axes intersections (dont write it in the cells,
       write in the legend)"): the columns across the top, the rows down the side, each cell the row tier × the column tier -->
  <div class="gridframe">
  <div class="corner" title="each cell is its row tier × its column tier"></div>
  <div id="axes" class="axes" title="the columns: the three tiers"><span>A · Strategy</span><span>B · Tactics</span><span>C · Operations</span></div>
  <div class="rowaxes" title="the rows: the same three tiers"><span>A · Strategy</span><span>B · Tactics</span><span>C · Operations</span></div>
  <div id="grid" class="hudgrid"></div>
  </div>
  <!-- 2026-10-13 (operator: "the most important health sign is a realtime ticker of transcribed text right under the 3x3 with interjected emojis
       for eye catching - we need a horizontal feed that includes all actions including individual words transcribed"): one line, newest at the
       right edge, against the grid itself (above the legend: "right under the 3x3"), every heard word as it lands and an emoji for every action between them -->
  <div id="feed" class="feed" title="the live feed: every word transcribed as it lands, and every action between them — 🎙️ an utterance · 📋 a pasted line · 🚶 a walk landed · 🐛 a worm landed · ❄ a snowball frozen · 🚀 sent · ⤵ a cell collapsed · ✓ a steer written · 🟢/🔴 the mic"></div>
  <div class="facerow"><div id="face" class="hudface"></div><label class="modelwords" title="C1014b: when ticked, ONE claude -p (haiku) call reads each cell's measured words and the lines of your record that carry them, and paints three words per cell as a question you can answer aloud. Marked 🧠, never the cell's colour, never a receipt; the measured words stay on hover. Cached: an unchanged grid costs nothing."><input type="checkbox" id="modelwords"> 🧠 model words</label></div>
  <div id="note" class="note"></div>
  <input id="defence" class="defence" hidden placeholder="one sentence defending this red cell, Enter to keep it">
  <!-- 2026-10-13 (operator: "next steer obviously has to be in position 1"): the draft is the first section under the grid -->
  ${sec('draft', '📋 Copy /steer', 'copy the next /steer with everything you said since it was written appended (2026-10-13: "everything said in the vicinity of the steer should be pounded into the steer when you copy it"); the + opens the steer, ✍️ Write and the 🧲 scratch', `<div id="draftbox" class="hudbox draftbox">
    <div class="row"><span id="draftstate" class="dim"></span></div>
    <div class="row"><label class="dim" for="engine">write with</label><select id="engine" class="engine" title="which model writes the steer when you Refine, collapse a cell or Ask: claude -p is the strongest; the local model is the steer chat's"><option value="claude">claude -p</option><option value="haiku">claude -p · haiku (fast)</option><option value="local">local model</option></select></div>
    <textarea id="draft" class="draft" spellcheck="false" placeholder="✍️ Write the steer — the model reads your scratch, the conversation and what you said, and writes it here; or type your own" title="the next /steer, written by the model from the record (✍️) or by you. Edit freely; your edit holds."></textarea>
    <div id="heard" class="heard dim" title="what the 3×3 heard you lean on — the hints the writer gets, never the steer itself"></div>
    <div class="row"><button id="write" class="hudbtn primary" title="the model writes the next /steer: your scratch first, then your recent prompts, the steers you sent, what you said and pasted, the latest commits — and folds in the questions you are likely to ask next">✍️ Write the steer</button><button id="refine" class="hudbtn" title="ask the model to refine this draft before you send it — your words stay, the ask sharpens; the reply lands below and never changes the draft">🤖 Refine this steer</button><button id="ask" class="hudbtn" title="ask the model about this grid — the reply lands below and never changes a cell">Ask about the grid</button></div>
    <div class="dhead"><b>🔗 Rides in on copy</b> <span class="dim">· what you said since the last copy, ranked by NCD association with the steer: ✓ rides in · · already in the steer · ✗ ambient, never rides in</span> <button id="rerank" class="hudbtn" title="rank again against the steer in the box">↻</button></div>
    <ol id="assoc" class="assoc"></ol>
    <div class="dhead"><b>🧲 Scratch</b> <span class="dim">· the snippets the steer is built from: dictation fills it with every sentence carrying a 3×3 word; type your own; clear anytime</span> <button id="scratchclear" class="hudbtn danger" title="empty the scratch">🧹 Clear</button></div>
    <textarea id="scratch" class="scratch" spellcheck="false" placeholder="speak — sentences that carry the grid's words land here; or type what the next steer must hold"></textarea>
    <div id="reply" class="reply"></div>
    <div class="dhead"><b>snowballs firing</b> <span class="dim">· every collapse, freeze and dispatch, newest last</span></div>
    <pre id="snowlog" class="snowlog"></pre></div>`, false, '', 'copydraft')}
  ${sec('tickers', '🐛 Snowball tickers', 'one row per process of the ballistic snowball (the walk, then each worm ring); a row that stops moving is a process that stopped landing', '<div id="tickers" class="tickers"></div>', false)}
  ${sec('readout', '📊 Counts', 'the server counts: the walk, the seed fit (gzip-NCD gain), the L1 receipt, snowballs, worms, the colours per row', '<pre id="readout" class="readout"></pre>', false)}
  ${sec('latest', '📜 Latest steer sent', 'the last /steer you sent, read off your own interactive sessions', '<pre id="latest" class="latest"></pre>', false)}
  ${sec('speech', '🎙️ Speech', 'everything heard, transcribed into .thetacog/audio/stream.txt — the cursor is the live edge of the file being written', '<div id="audiohealth" class="audiohealth"></div><div class="row"><button id="rearm" class="hudbtn" hidden title="the mic is armed but its daemon is not running — re-arm it through the audio door (the same as the audio pill)">↻ Re-arm the mic</button><button id="restartmic" class="hudbtn" hidden title="stop the daemon, its whisper server and its mic segmenter, and start one fresh — for a mic that is live but deaf (scripts/vna/audio-basin.mjs restart; never arms the mic)">↻ Restart transcribe</button></div><pre id="speech" class="speech"><span id="speechtext"></span><span class="caret">▌</span></pre>', false)}
  ${sec('paste', '📋 Paste', 'the steer file, as it streams in: what you paste or type, walked — the cursor is the live edge; type a line and Enter appends it', `<div id="dictbox" class="hudbox dictbox">
    <main id="dump" class="dump" hidden></main>
    <textarea id="register" class="register" spellcheck="false" title="the register: the steer file's tail. Type a line, Enter appends it through the clip door"></textarea>
    <div id="regbar" class="regbar"><button id="append" class="hudbtn" title="append the typed line to the steer file (Enter does the same)">⏎ Append</button><button id="clear" class="hudbtn danger" title="clear the processed part of the steer file, from above — the evicted bytes go to the append-only archive first">🧹 Clear processed</button><span id="wm" class="wm"></span></div>
    <div id="regstatus" class="regstatus"></div></div>`, false)}
  <div class="hint">keys 1-9 or a click select a cell · Enter freezes the grid into a snowball · Ctrl+Enter sends it to /steer</div>
  ${srcCard}
  ${snowCard}
  ${pillsCard}
  ${healthCard}
  <script nonce="${nonce}" src="${u('hud-core.js')}"></script>
  <script nonce="${nonce}" src="${u('hud.js')}"></script>
</body></html>`;
}
