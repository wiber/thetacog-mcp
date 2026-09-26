#!/usr/bin/env node
// scripts/vna/audio-basin.mjs — C233 THE AUDIO STREAM IS A BASIN (operator 2026-09-24, verbatim: "We absolutely need to add a
// streaming basin with that picks up all audio and transcribe it instantly and put it into a text file and slots that into as
// well." · 2026-09-25: "transcribe and add to a txt file and slot it into the merkle tree and spec at timed intervals").
//
// THE PIPE, one writer per stage, nothing here a second copy of a door that already exists:
//   mic ──ffmpeg segment (chunkS)──► .thetacog/audio/seg/*.wav ──whisper-server (resident, Silero VAD)──► one line per utterance,
//   timestamped, appended to .thetacog/audio/stream.txt (append-only) ──every ingestEveryS──► the batch goes through the ONE
//   clip door (clip-ingest.mjs --stdin --by audio: steer file → tail → amend-ledger → the fold), so a spoken ask slots into
//   the tree exactly like a pasted one.
// Local only: capture, VAD and transcription run on this machine; a chunk's wav is deleted the moment it is transcribed.
// The raw stream (everyone the mic hears) stays in the gitignored .thetacog/audio/; only the batches the fold admits reach
// the steer file, the same as a clip. The mic grant is the operator's act (TCC) — the checkbox is the consent.
//
// THE FALSIFIER (the row's own): an utterance in stream.txt that never reaches amendments.ndjson, or one that reaches it twice.
// Each utterance enters the batch as `🎙️ HH:MM:SS <text>`; a batch the door refuses for being short is CARRIED to the next
// interval, any other refusal is recorded as junk WITH ITS WHY (C234: placed or named junk, never silently dropped).
//
// THE VARIABLES ARE MEASURED, NEVER GUESSED: `optimise` sweeps model × chunk length on a spoken reference (macOS `say`, known
// text → WER), then threads and the VAD threshold on the winner, and writes data/vna/audio-basin-config.json (generated —
// edit the sweep, never the file). The ingest interval is re-derived from the daemon's own measured fold time.
//
//   node scripts/vna/audio-basin.mjs arm | disarm | status [--json] | optimise [--quick] | --daemon
// LLM-FREE in every verdict: whisper is a transcriber, not a judge — nothing here grades, places or decides with a model.
// @guard tests/vna/c233-the-audio-stream-is-a-basin.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir, loadavg, cpus } from 'node:os';
import { MIN_CHARS } from './clip-watch.mjs';   // the door's own floor — the carry decision reads the number, never the refusal's wording

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIR = process.env.VNA_AUDIO_DIR || resolve(REPO, '.thetacog/audio');
export const P = {
  stream: join(DIR, 'stream.txt'), armed: join(DIR, 'armed'), utter: join(DIR, 'utterances.ndjson'), slots: join(DIR, 'slots.ndjson'),
  chunks: join(DIR, 'chunks.ndjson'), state: join(DIR, 'daemon.json'), seg: join(DIR, 'seg'), log: join(DIR, 'daemon.log'),
  autobuild: join(DIR, 'autobuild'), builds: join(DIR, 'builds.ndjson'), buildLog: join(DIR, 'builds.log'),   // C233b
};
export const CONFIG = process.env.VNA_AUDIO_CONFIG || resolve(REPO, 'data/vna/audio-basin-config.json');
export const ROOTS = process.env.VNA_TREE_ROOTS || resolve(REPO, 'data/vna/spec-tree-roots.ndjson');
export const AMEND = process.env.VNA_AMEND_LEDGER || resolve(REPO, 'docs/specs/vna/amendments.ndjson');
const MODELS = process.env.VNA_WHISPER_DIR || join(homedir(), '.cache/whisper');
// vadPadMs 200 (measured 2026-09-26): at whisper's 30 ms default the VAD clipped the first phoneme — "Steer. Split …" came back
// "ear. Lit …" — and the spoken cue was recognised 12 of 15 (3 voices × 5 phrases); 200 ms → 15 of 15, 400 ms → 15 of 15, with
// silence → 0 segments and pink noise → no text at every setting. 200 is the smallest pad that kept every cue.
export const DEFAULTS = { model: 'large-v3-turbo', chunkS: 10, ingestEveryS: 60, vadThreshold: 0.5, vadPadMs: 200, threads: 4, port: 7391, device: ':default', source: 'defaults — `optimise` has not run' };
export const WINDOW_MS = 30 * 60 * 1000;
export const SHORT_CARRY_MS = 10 * 60 * 1000;   // a short batch rides forward this long, then is named junk ("too short")
const MARK = '🎙️';

export const loadConfig = (p = CONFIG) => { try { return { ...DEFAULTS, ...JSON.parse(readFileSync(p, 'utf8')) }; } catch { return { ...DEFAULTS }; } };
const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const hms = (iso) => new Date(iso).toISOString().slice(11, 19);
export const batchLine = (u) => `${MARK} ${hms(u.at)} ${u.text}`;
export const readNd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const nd = (p, row) => { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(row) + '\n'); };
/** the last `bytes` of a file, split into whole lines (the first partial line dropped) — a 2 MB log is never read whole */
export function tailLines(p, bytes = 1 << 20) {
  let fd; try { fd = openSync(p, 'r'); } catch { return []; }
  try { const size = fstatSync(fd).size; const n = Math.min(size, bytes); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n);
    const lines = buf.toString('utf8').split('\n'); if (n < size) lines.shift(); return lines.filter(Boolean); } finally { closeSync(fd); }
}

// ── what counts as an utterance — pure ───────────────────────────────────────────────────────────────────────────────────
// whisper marks non-speech in brackets ([BLANK_AUDIO], (music), *typing*); a segment that is ONLY that is not an utterance.
export function cleanText(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^[\[\(\*][^\]\)\*]*[\]\)\*]\.?$/.test(s)) return '';
  return s;
}
/** verbose_json segments → utterances, each stamped at chunkStart + its own offset */
export function utterancesOf(json, chunkStartMs) {
  const segs = Array.isArray(json && json.segments) ? json.segments : [];
  const out = [];
  for (const s of segs) {
    const text = cleanText(s.text); if (!text) continue;
    const at = new Date(chunkStartMs + Math.round((Number(s.start) || 0) * 1000)).toISOString();
    const endAt = new Date(chunkStartMs + Math.round((Number(s.end) || 0) * 1000)).toISOString();
    out.push({ at, endAt, text, id: sha12(`${at}|${text}`) });
  }
  return out;
}

// ── the ledger check — the falsifier, as a function the guard and the pill both read ─────────────────────────────────────
/** for each utterance: how many amendments rows carry its batch line (0 = never reached, 2+ = reached twice) */
export function reachCounts(utts, amendRows) {
  const texts = amendRows.map((r) => String(r.text || ''));
  return utts.map((u) => { const line = batchLine(u); let n = 0; for (const t of texts) if (t.includes(line)) n++; return { id: u.id, n }; });
}

// ── the batch decision — pure ────────────────────────────────────────────────────────────────────────────────────────────
/** which utterances are still owed a slot: not in any slots row as slotted or junk */
export function pending(utts, slots) {
  const done = new Set(); for (const s of slots) if (s.ok || s.junk) for (const id of s.ids || []) done.add(id);
  return utts.filter((u) => !done.has(u.id));
}
/** the door's refusal → carry (the batch is under the door's floor and still young) or junk (with the why). SHORT IS MEASURED:
 *  the batch's own trimmed length against MIN_CHARS — a regex over the refusal's prose ("below floor — …") missed it once. */
export function refusalClass(why, oldestAtMs, now = Date.now(), textLen = Infinity) {
  const short = textLen < MIN_CHARS;
  if (short && now - oldestAtMs < SHORT_CARRY_MS) return 'carry';
  return short ? 'junk:too short' : `junk:${String(why || 'refused').slice(0, 120)}`;
}

// ── the stats the pill paints — pure over the receipts ──────────────────────────────────────────────────────────────────
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
export const SPARK = '▁▂▃▄▅▆▇█';
export function spark(bins) { const m = Math.max(...bins, 0); return bins.map((v) => (m ? SPARK[Math.min(7, Math.round((v / m) * 7))] : '▁')).join(''); }
export function audioStats({ utts = [], slots = [], chunks = [], roots = [], amend = [], builds = [], autobuild = false, state = null, armed = false, now = Date.now(), cfg = DEFAULTS } = {}) {
  const since = now - WINDOW_MS; const inWin = (iso) => { const t = Date.parse(iso); return t >= since && t <= now + 60000; };
  const u30 = utts.filter((u) => inWin(u.at)); const c30 = chunks.filter((c) => inWin(c.at)); const s30 = slots.filter((s) => inWin(s.at));
  const words = u30.reduce((n, u) => n + u.text.split(/\s+/).filter(Boolean).length, 0);
  const bins = Array(30).fill(0); for (const u of u30) { const k = Math.floor((Date.parse(u.at) - since) / 60000); if (k >= 0 && k < 30) bins[k]++; }
  const speech = c30.filter((c) => c.utterances > 0).length;
  const r30 = roots.filter((r) => inWin(r.at));
  const nodesAdded = r30.reduce((n, r) => n + (Array.isArray(r.nodesAdded) ? r.nodesAdded.length : 0), 0);
  const specAdded = [...new Set(r30.flatMap((r) => (Array.isArray(r.nodesAdded) ? r.nodesAdded : []).filter((id) => /^n_spec_/.test(id))))];
  const revs = r30.length ? (r30[r30.length - 1].revisions ?? null) - (r30[0].revisions ?? 0) : 0;
  const a30 = amend.filter((a) => inWin(a.at));
  const reach = reachCounts(u30, amend);
  const owed = pending(utts, slots);
  const alive = !!(state && state.pid && pidAlive(state.pid));
  return {
    armed, alive, pid: state && state.pid || null, model: cfg.model, chunkS: cfg.chunkS, ingestEveryS: cfg.ingestEveryS, error: state && state.error || null,
    window: '30 min',
    utterances: u30.length, words, perMin: +(u30.length / 30).toFixed(2), wordsPerMin: +(words / 30).toFixed(1), spark: spark(bins),
    chunks: c30.length, speechChunks: speech, transcribeMs: median(c30.map((c) => c.ms).filter((x) => x != null)),
    rtf: median(c30.filter((c) => c.ms != null && c.audioS).map((c) => c.ms / 1000 / c.audioS)),
    lagMs: median(u30.map((u) => u.lagMs).filter((x) => x != null)),
    slotted: s30.filter((s) => s.ok).length, junk: s30.filter((s) => s.junk).length, carried: s30.filter((s) => s.carry).length,
    slotLagMs: median(s30.filter((x) => x.ok).flatMap((x) => (x.ids || []).map((id) => { const u = utts.find((v) => v.id === id); return u ? Date.parse(x.at) + (x.ms || 0) - Date.parse(u.at) : null; })).filter((v) => v != null)),
    pending: owed.length, lastSlot: slots.length ? slots[slots.length - 1] : null, foldMs: median(slots.filter((s) => s.ok && s.ms).map((s) => s.ms)),
    reachedOnce: reach.filter((r) => r.n === 1).length, reachedTwice: reach.filter((r) => r.n > 1).length,
    ...(() => { const b = builds.filter((x) => inWin(x.at)); return { autobuild, builtParts: b.length, builtAdmissible: b.filter((x) => x.admissible).length, builtAddressed: b.filter((x) => x.addressed).length, builtDispatched: b.filter((x) => x.dispatched).length, builtBusy: b.filter((x) => x.busy).length }; })(),
    roots: r30.length, nodesAdded, specAdded, revisions: revs, root: roots.length ? String(roots[roots.length - 1].root || '').slice(0, 8) : null,
    ledgerRows: a30.length, ledgerBytes: a30.reduce((n, a) => n + (a.bytes || 0), 0), ledgerAudio: a30.filter((a) => String(a.text || '').includes(MARK)).length,
  };
}
export function pidAlive(pid) { try { process.kill(Number(pid), 0); return true; } catch { return false; } }
export function readAll({ now = Date.now() } = {}) {
  const cfg = loadConfig(); let state = null; try { state = JSON.parse(readFileSync(P.state, 'utf8')); } catch {}
  const roots = tailLines(ROOTS, 1 << 20).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const amend = tailLines(AMEND, 4 << 20).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return audioStats({ utts: readNd(P.utter), slots: readNd(P.slots), chunks: readNd(P.chunks), roots, amend, builds: readNd(P.builds), autobuild: existsSync(P.autobuild), state, armed: existsSync(P.armed), now, cfg });
}
/** one line — the pill's face and `status`; every term read, UNMEASURED when absent */
export function statusLine(s) {
  const st = !s.armed ? '⚪ off' : s.alive ? '🎙️ LIVE' : s.error ? `❌ ${s.error}` : '🟡 armed, daemon not running';
  const f = (v, u = '') => (v == null ? 'UNMEASURED' : `${v}${u}`);
  return `${st} · ${s.perMin}/min (${s.wordsPerMin} words/min) ${s.spark} · heard ${s.speechChunks}/${s.chunks} chunks · transcribe ${f(s.transcribeMs, ' ms')} · lag ${s.lagMs == null ? 'UNMEASURED' : (s.lagMs / 1000).toFixed(1) + ' s'} · in tree after ${s.slotLagMs == null ? 'UNMEASURED' : Math.round(s.slotLagMs / 1000) + ' s'} · slotted ${s.slotted} · junk ${s.junk} · owed ${s.pending} · 🌳 ${s.roots} roots +${s.nodesAdded} nodes · spec +${s.specAdded.length} · ledger ${s.ledgerRows} rows (${s.ledgerAudio} 🎙️) · last 30 min`;
}

// ── whisper-server, resident ────────────────────────────────────────────────────────────────────────────────────────────
export function serverArgs(cfg) {
  const a = ['-m', join(MODELS, `ggml-${cfg.model}.bin`), '--host', '127.0.0.1', '--port', String(cfg.port), '-t', String(cfg.threads)];
  const vad = join(MODELS, 'ggml-silero-v5.1.2.bin');
  if (existsSync(vad)) a.push('--vad', '-vm', vad, '-vt', String(cfg.vadThreshold), '-vp', String(cfg.vadPadMs ?? DEFAULTS.vadPadMs));
  return a;
}
async function waitUp(port, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch {} await sleep(250); } return false; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// SRT, NEVER verbose_json (measured 2026-09-26): whisper-server with --vad SEGFAULTS building a verbose_json reply for a chunk the
// VAD empties (a null C string into nlohmann::json — two crash reports, 20:11 and 20:23; reproduced: silence + verbose_json →
// server DEAD; text · json · srt · vtt all survive). A quiet room killed the server and the daemon deleted 39 chunks behind it.
// srt keeps the per-segment timestamps an utterance needs and survives the empty reply.
export function parseSrt(txt) {
  const toS = (t) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; };
  const segments = [];
  for (const block of String(txt || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== ''); const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue; const [a, b] = lines[i].split('-->'); const text = lines.slice(i + 1).join(' ').trim();
    if (text) segments.push({ start: toS(a), end: toS(b), text });
  }
  return { segments };
}
export async function transcribe(wavPath, port) {
  const fd = new FormData(); fd.append('file', new Blob([readFileSync(wavPath)]), 'chunk.wav'); fd.append('response_format', 'srt');
  const t0 = Date.now(); const r = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd });
  const json = parseSrt(await r.text()); return { json, ms: Date.now() - t0 };
}
export const MAX_CHUNK_TRIES = 3;
const audioSeconds = (p) => { try { return (statSync(p).size - 44) / 32000; } catch { return null; } };   // 16 kHz mono s16le

// ── the slot: the batch through the ONE clip door ───────────────────────────────────────────────────────────────────────
export function slot({ now = Date.now(), door = defaultDoor } = {}) {
  const owed = pending(readNd(P.utter), readNd(P.slots)); if (!owed.length) return null;
  const text = owed.map(batchLine).join('\n'); const t0 = Date.now();
  return slotRow(owed, text, door(text), Date.now() - t0, now);
}
/** THE DAEMON'S SLOT RUNS BESIDE THE DRAIN, never in front of it — measured 2026-09-25: a synchronous fold took 20–28 s and
 *  held every chunk behind it. Same row, same door (clip-ingest --stdin --by audio), spawned instead of spawnSync'd. */
export function slotAsync({ now = Date.now() } = {}) {
  const owed = pending(readNd(P.utter), readNd(P.slots)); if (!owed.length) return Promise.resolve(null);
  const text = owed.map(batchLine).join('\n'); const t0 = Date.now();
  return new Promise((res) => {
    const c = spawn(process.execPath, [resolve(REPO, 'scripts/vna/clip-ingest.mjs'), '--stdin', '--json', '--by', 'audio'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    c.on('close', (code) => { const j = out.split('\n').filter((l) => l.trim().startsWith('{')).pop(); let r;
      try { r = JSON.parse(j); } catch { r = { ok: false, why: `the door printed no receipt (exit ${code}) — ${err.trim().slice(0, 160)}` }; }
      res(slotRow(owed, text, r, Date.now() - t0, now)); });
    c.stdin.end(text);
  });
}
function slotRow(owed, text, r, ms, now) {
  const ids = owed.map((u) => u.id); const at = new Date(now).toISOString();
  if (r.ok) { const row = { at, ids, ok: true, ms, line: r.line || null, root: r.root ? String(r.root).slice(0, 12) : null, bytes: Buffer.byteLength(text) }; nd(P.slots, row); return row; }
  const cls = refusalClass(r.why, Date.parse(owed[0].at), now, text.trim().length);
  const row = cls === 'carry' ? { at, ids, carry: true, why: r.why, ms } : { at, ids, junk: cls.slice(5), why: r.why, ms };
  nd(P.slots, row); return row;
}
function defaultDoor(text) {
  const r = spawnSync(process.execPath, [resolve(REPO, 'scripts/vna/clip-ingest.mjs'), '--stdin', '--json', '--by', 'audio'], { cwd: REPO, input: text, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  const j = (r.stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).pop();
  try { return JSON.parse(j); } catch { return { ok: false, why: `the door printed no receipt (exit ${r.status}) — ${(r.stderr || '').trim().slice(0, 160)}` }; }
}

// ── C233b 🔨 AUTO-BUILD THE ADMISSIBLE PARTS (operator 2026-09-26, verbatim: "we may neednother check box for auto build the
// admissable parts of what it hears..") ─────────────────────────────────────────────────────────────────────────────────────
// A slotted batch is split at pauses into PARTS; each part is walked by the one Rust walk (lensWalk) and only a part the walk's
// own seed null test ADMITS (sensor 'metal') is handed to steer.mjs as a dictation — the same door /steer uses: text → rows →
// dispatch of THOSE rows only (C110d), bounded here to --max-cycles 2 and a $20 ceiling. Every part gets a receipt row,
// admitted or not; a steer loop already running is 'busy' (named, never dropped silently).
// MEASURED before building (2026-09-26): the operator's nonsense test — 11 audio batches — admitted 0 of 11, a shuffled control
// 0 of 1; three real spec rows admitted 1 of 3. So the box is safe on chatter and rarely fires; it is OFF until ticked.
// ADMISSIBLE IS NOT ADDRESSED (measured the same day, replaying the nonsense run PART by part with the box off): 8 of 32 chatter
// parts passed the walk's null test ("I'm probably going to stay here because I like it") — whole batches passed 0 of 11, short
// parts clear it far more easily. Admissibility answers WHERE speech lands, never WHETHER anyone asked for a build (W6: sufficient
// for the placement question, not the intent one). So a part dispatches only when it is ADDRESSED — it opens with the spoken cue
// "steer" or "build" (the voice twin of typing /steer) — AND admissible. The cue is stripped before the text goes to /steer.
export const ADDRESS_RE = /^\s*(?:(?:ok(?:ay)?|so|right)[,.]?\s+)?(steer|build)\b[\s,.:;!-]*/i;
export const addressed = (text) => ADDRESS_RE.test(String(text || ''));
export const stripCue = (text) => String(text || '').replace(ADDRESS_RE, '').trim();
export const PART_GAP_MS = 2000, PART_MIN_CHARS = 60, BUILD_MAX_CYCLES = 2, BUILD_CEILING_USD = 20;
/** utterances → parts: consecutive utterances joined while the silence between them is ≤ gapMs; parts under minChars dropped */
export function parts(utts, { gapMs = PART_GAP_MS, minChars = PART_MIN_CHARS } = {}) {
  const sorted = [...utts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); const out = []; let cur = null;
  for (const u of sorted) {
    const gap = cur ? Date.parse(u.at) - Date.parse(cur.endAt || cur.at) : Infinity;
    if (cur && gap <= gapMs) { cur.text += ' ' + u.text; cur.endAt = u.endAt || u.at; cur.ids.push(u.id); }
    else { if (cur) out.push(cur); cur = { at: u.at, endAt: u.endAt || u.at, text: u.text, ids: [u.id] }; }
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.text.length >= minChars);
}
/** the dispatch argv — bounded, never the whole spec */
export const buildArgv = (text) => [resolve(REPO, 'scripts/vna/steer.mjs'), text, '--max-cycles', String(BUILD_MAX_CYCLES), '--ceiling', String(BUILD_CEILING_USD)];
/** walk each part of one slot's utterances; dispatch the admitted ones. walk / dispatch / busy are injectable (the guard feeds them) */
export async function buildSlot(slotRow, { walk = null, dispatch = null, busy = null, now = Date.now() } = {}) {
  if (!slotRow || !slotRow.ok) return [];
  const want = new Set(slotRow.ids || []); const us = readNd(P.utter).filter((u) => want.has(u.id));
  const W = walk || (await import('../../src/lib/pmu/walk-door.mjs')).lensWalk;
  const isBusy = busy || (() => { try { const r = spawnSync(process.execPath, [resolve(REPO, 'scripts/vna/steer-lock.mjs'), 'status'], { cwd: REPO, encoding: 'utf8', timeout: 5000 }); return !/free/.test(r.stdout || ''); } catch { return false; } });
  const D = dispatch || ((text) => { const out = openSync(P.buildLog, 'a'); const c = spawn(process.execPath, buildArgv(text), { cwd: REPO, detached: true, stdio: ['ignore', out, out] }); c.unref(); return c.pid; });
  const rows = [];
  for (const p of parts(us)) {
    let r = {}; try { r = (W(p.text, { source: 'audio', ref: `audio:${p.ids[0]}`, digest: p.text.length > 800 ? 'strided' : 'head', timeoutMs: 4000 }) || {}).row || {}; } catch (e) { r = { sensor: 'unmeasured', err: String(e.message || e).slice(0, 80) }; }
    const row = { at: new Date(now).toISOString(), slot: slotRow.at, ids: p.ids, chars: p.text.length, head: p.text.slice(0, 96), pixel: r.pixel || null, z: r.fit?.z ?? null, gain: r.fit?.gain ?? null, admissible: !!r.admissible, addressed: addressed(p.text) };
    // THE CUE IS THE INTENT, THE WALK IS THE PLACEMENT (2026-09-26): requiring both held back 2 of 3 real spec rows (C233, C318 read
    // not admissible) — a spoken "steer …" would usually do nothing. Typed /steer has no admissibility gate; spoken matches it.
    // The walk still runs for every part and its reading rides on the receipt; the cue alone decides the dispatch.
    if (!row.addressed) { if (row.admissible) row.held = 'not addressed — say "steer …" or "build …" to dispatch'; }
    else { if (!existsSync(P.autobuild)) row.held = 'auto-build off'; else if (isBusy()) row.busy = 'a steer loop is already running'; else row.dispatched = D(stripCue(p.text)); }
    nd(P.builds, row); rows.push(row);
  }
  return rows;
}

// ── the daemon ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function daemon() {
  const cfg = loadConfig(); mkdirSync(P.seg, { recursive: true });
  for (const f of readdirSync(P.seg)) try { unlinkSync(join(P.seg, f)); } catch {}
  const write = (extra) => writeFileSync(P.state, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), model: cfg.model, chunkS: cfg.chunkS, ...extra }) + '\n');
  write({ phase: 'starting' });
  // THE SERVER IS SUPERVISED: a dead server is restarted and the chunk kept for a retry, never deleted behind a failed transcription
  let server = spawn('whisper-server', serverArgs(cfg), { stdio: 'ignore' }); let restarts = 0;
  if (!(await waitUp(cfg.port))) { write({ error: 'whisper-server did not start' }); server.kill(); process.exit(1); }
  const revive = async () => { try { server.kill(); } catch {} server = spawn('whisper-server', serverArgs(cfg), { stdio: 'ignore' }); restarts++; const up = await waitUp(cfg.port); write({ phase: 'live', server: server.pid, restarts, ...(up ? {} : { error: 'whisper-server did not restart' }) }); return up; };
  const tries = new Map();
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', cfg.device, '-ar', '16000', '-ac', '1',
    '-f', 'segment', '-segment_time', String(cfg.chunkS), '-reset_timestamps', '1', join(P.seg, 'seg-%06d.wav')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let ffErr = ''; ff.stderr.on('data', (d) => { ffErr = (ffErr + d).slice(-400); });
  let ffDead = false; ff.on('exit', (code) => { ffDead = true; write({ error: `mic capture stopped (ffmpeg exit ${code}) ${ffErr.trim().slice(0, 160)}` }); });
  const stop = () => { try { ff.kill('SIGINT'); } catch {} try { server.kill(); } catch {} };
  process.on('SIGTERM', () => { stop(); process.exit(0); }); process.on('SIGINT', () => { stop(); process.exit(0); });
  write({ phase: 'live', server: server.pid, ffmpeg: ff.pid, restarts });
  let lastSlot = Date.now(); let inflight = null;
  const drain = async (all) => {
    const files = readdirSync(P.seg).filter((f) => f.endsWith('.wav')).sort(); const done = all ? files : files.slice(0, -1);   // the newest is still being written
    for (const f of done) {
      const p = join(P.seg, f); const endMs = statSync(p).mtimeMs; const aS = audioSeconds(p); const startMs = endMs - (aS || cfg.chunkS) * 1000;
      let res; try { res = await transcribe(p, cfg.port); } catch (e) {
        const n = (tries.get(f) || 0) + 1; tries.set(f, n); const gaveUp = n >= MAX_CHUNK_TRIES;
        nd(P.chunks, { at: new Date(endMs).toISOString(), error: String(e.message || e).slice(0, 120), try: n, ...(gaveUp ? { dropped: true } : { kept: true }) });
        if (gaveUp) { try { unlinkSync(p); } catch {} tries.delete(f); } else { await revive(); }
        break;   // the next loop retries this chunk first, in order
      }
      tries.delete(f);
      try { unlinkSync(p); } catch {}   // local only: the audio never outlives its transcription
      const us = utterancesOf(res.json, startMs); const now = Date.now();
      for (const u of us) { u.lagMs = now - Date.parse(u.endAt); appendFileSync(P.stream, `[${u.at}] ${u.text}\n`); nd(P.utter, u); }
      nd(P.chunks, { at: new Date(endMs).toISOString(), audioS: aS, ms: res.ms, utterances: us.length });
    }
  };
  while (existsSync(P.armed) && !ffDead) {
    await drain(false);
    // the interval re-derives itself from the daemon's own folds every decision (the config value is only the seed)
    const every = ingestInterval(readNd(P.slots)).ingestEveryS ?? cfg.ingestEveryS;
    if (!inflight && Date.now() - lastSlot >= every * 1000) {
      lastSlot = Date.now();
      inflight = slotAsync().then((row) => {   // C233b: the walk + dispatch run in their own process, never in front of the drain
        if (row && row.ok && existsSync(P.autobuild)) { const c = spawn(process.execPath, [fileURLToPath(import.meta.url), 'build', row.at], { cwd: REPO, detached: true, stdio: 'ignore' }); c.unref(); }
      }).catch((e) => write({ phase: 'live', error: `slot: ${e.message}` })).finally(() => { inflight = null; });
    }
    await sleep(500);
  }
  try { ff.kill('SIGINT'); } catch {} await sleep(800); await drain(true); if (inflight) await inflight; try { await slotAsync(); } catch {}
  try { server.kill(); } catch {} write({ phase: 'stopped', pid: null }); process.exit(0);
}

// ── arm / disarm ────────────────────────────────────────────────────────────────────────────────────────────────────────
function arm() {
  mkdirSync(DIR, { recursive: true }); writeFileSync(P.armed, new Date().toISOString() + '\n');
  let st = null; try { st = JSON.parse(readFileSync(P.state, 'utf8')); } catch {}
  if (st && st.pid && pidAlive(st.pid)) return `🎙️ audio basin armed — daemon already live (pid ${st.pid})`;
  const out = openSync(P.log, 'a');
  const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--daemon'], { cwd: REPO, detached: true, stdio: ['ignore', out, out] }); c.unref();
  return `🎙️ audio basin armed — mic → whisper (${loadConfig().model}) → ${P.stream.replace(REPO + '/', '')} → the fold every ${loadConfig().ingestEveryS}s (daemon pid ${c.pid})`;
}
function disarm() {
  try { unlinkSync(P.armed); } catch {}
  return '⚪ audio basin disarmed — the daemon drains its last chunk, slots it, and exits';
}

// ── optimise: the variables, measured ───────────────────────────────────────────────────────────────────────────────────
export const REFERENCE = [
  'The audio stream is a basin, and every sentence spoken near the machine should land in the spec tree like a pasted paragraph.',
  'Declare the row first, then write the guard, and only tick it in the commit that turns the guard green.',
  'A receipt is recomputed over the retained record, while a log is emitted from inside the boundary it describes.',
  'Measure the ingest rate per minute, the transcription latency, and how many roots the Merkle tree gained in the last half hour.',
  'If the fold refuses a batch for being short, carry it forward, and if it refuses for any other reason, name it as junk with the why.',
  'Nothing leaves the machine: the chunk is deleted the moment it is transcribed, and the checkbox on the pill is the consent.',
].join(' ');
export function wer(ref, hyp) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const r = norm(ref), h = norm(hyp); const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
}
/** expected seconds from an utterance ending to its line on the txt: half a chunk waiting to close + the transcription */
export const expectedLagS = (chunkS, transcribeMs) => chunkS / 2 + transcribeMs / 1000;
/** the pick: the lowest expected lag among points whose WER is within `slack` of the best WER */
export function pick(points, slack = 0.02) {
  const ok = points.filter((p) => p.wer != null); if (!ok.length) return null;
  const best = Math.min(...ok.map((p) => p.wer));
  return ok.filter((p) => p.wer <= best + slack).sort((a, b) => a.lagS - b.lagS)[0];
}
/** the slot interval, re-derived from the daemon's OWN measured folds: FOLD_FACTOR × the median fold, clamped 30–300 s.
 *  FOLD_FACTOR 2 = the fold may spend up to half the wall clock (one in flight at a time). It was 10 (a tenth) until the operator,
 *  2026-09-26, verbatim: "shorten the processing loop" — measured then: speech → tree median 160 s, of which ~140 s was waiting
 *  for the 283 s interval; 2 × the 22.5 s median fold ≈ 45 s interval → ~55 s predicted. null when no fold measured. */
export const FOLD_FACTOR = 2;
export function ingestInterval(slots) {
  const folds = slots.filter((s) => s.ok && s.ms).map((s) => s.ms); const foldMs = median(folds);
  return { foldMs, foldN: folds.length, ingestEveryS: foldMs == null ? null : Math.max(30, Math.min(300, Math.ceil((FOLD_FACTOR * foldMs) / 1000))) };
}
function optimiseIngest() {
  const cfg = loadConfig(); const r = ingestInterval(readNd(P.slots));
  if (r.ingestEveryS == null) { console.log(`ingest interval: UNMEASURED — no fold measured yet; kept ${cfg.ingestEveryS}s`); return; }
  const out = { ...cfg, ingestEveryS: r.ingestEveryS, measured: { ...(cfg.measured || {}), foldMs: r.foldMs, foldN: r.foldN } };
  writeFileSync(CONFIG, JSON.stringify(out, null, 2) + '\n');
  console.log(`ingest interval → ${r.ingestEveryS}s (fold median ${r.foldMs} ms over ${r.foldN})`);
}
// THE INCUMBENT HOLDS UNLESS BEATEN BEYOND THE NOISE (measured 2026-09-25: two sweeps on one reference flipped threads 2 → 8
// and the VAD threshold 0.3 → 0.6, each "win" worth ~1 word of WER or < 10 % of latency — a pick on noise is not an optimisation).
export const NOISE = { latencyFrac: 0.10, werWords: 1 };
/** threads: the fastest challenger replaces the incumbent only if it is > 10 % faster */
export function pickThreads(pts, incumbent) {
  const inc = pts.find((p) => p.threads === incumbent); const best = [...pts].sort((a, b) => a.transcribeMs - b.transcribeMs)[0];
  if (!inc || !best) return best ? best.threads : incumbent;
  return best.transcribeMs < inc.transcribeMs * (1 - NOISE.latencyFrac) ? best.threads : incumbent;
}
/** VAD: only thresholds that let zero words out of pure noise; a challenger replaces the incumbent only if its WER is better by
 *  more than one word of the reference (refWords); among challengers that clear it, the LOWEST threshold (most recall) */
export function pickVad(pts, incumbent, refWords) {
  const clean = pts.filter((p) => p.noiseWords === 0); const inc = clean.find((p) => p.vadThreshold === incumbent);
  if (!inc) return (clean.sort((a, b) => a.wer - b.wer || a.vadThreshold - b.vadThreshold)[0] || { vadThreshold: incumbent }).vadThreshold;
  const margin = NOISE.werWords / refWords;
  const better = clean.filter((p) => p.wer < inc.wer - margin).sort((a, b) => a.wer - b.wer || a.vadThreshold - b.vadThreshold);
  return better.length ? better[0].vadThreshold : incumbent;
}
export const refWords = () => REFERENCE.split(/\s+/).filter(Boolean).length;
/** re-derive threads + VAD from the points already measured — no re-sweep */
function repick() {
  const cfg = loadConfig(); const m = cfg.measured || {};
  if (!m.threads || !m.vad) { console.log('repick: no measured sweep in the config — run optimise first'); return; }
  const threads = pickThreads(m.threads, DEFAULTS.threads); const vadThreshold = pickVad(m.vad, DEFAULTS.vadThreshold, refWords());
  writeFileSync(CONFIG, JSON.stringify({ ...cfg, threads, vadThreshold, measured: { ...m, noise: NOISE, rule: m.rule + '; threads/VAD: the default holds unless beaten beyond the noise (10 % latency / 1 word WER)' } }, null, 2) + '\n');
  console.log(`repick → ${threads} threads · VAD ${vadThreshold} (incumbents ${DEFAULTS.threads} / ${DEFAULTS.vadThreshold}; noise 10 % / 1 word of ${refWords()})`);
}
async function optimise({ quick = false, vadOnly = false } = {}) {
  const load0 = loadavg()[0] / cpus().length;
  const work = join(tmpdir(), `audio-opt-${process.pid}`); mkdirSync(work, { recursive: true });
  const aiff = join(work, 'ref.aiff'), wav = join(work, 'ref.wav'), noise = join(work, 'noise.wav');
  spawnSync('say', ['-o', aiff, REFERENCE]); spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-ar', '16000', '-ac', '1', wav]);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=10:c=pink:a=0.02', '-ar', '16000', '-ac', '1', noise]);
  const dur = audioSeconds(wav);
  const base = loadConfig(); const port = base.port + 1;
  const models = quick ? ['small.en', 'large-v3-turbo'] : ['base.en', 'small.en', 'large-v3-turbo'];
  const chunks = quick ? [5, 10, 20] : [5, 8, 10, 15, 20, 30];
  const run = async (cfg, fn) => { const s = spawn('whisper-server', serverArgs({ ...cfg, port }), { stdio: 'ignore' }); try { if (!(await waitUp(port))) return null; return await fn(); } finally { s.kill(); await sleep(400); } };
  const split = (chunkS) => { const dir = join(work, `c${chunkS}`); mkdirSync(dir, { recursive: true });
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-f', 'segment', '-segment_time', String(chunkS), '-reset_timestamps', '1', join(dir, 's-%03d.wav')]);
    return readdirSync(dir).sort().map((f) => join(dir, f)); };
  const points = vadOnly ? (base.points || []) : [];
  for (const model of (vadOnly ? [] : models)) {
    if (!existsSync(join(MODELS, `ggml-${model}.bin`))) { points.push({ model, skipped: 'model not on disk' }); continue; }
    await run({ ...base, model }, async () => {
      await transcribe(wav, port);   // warm
      for (const chunkS of chunks) {
        // WER from the first pass (temperature 0 — the text is the same every pass); latency is the MEDIAN of three passes,
        // because one pass on a loaded machine measured 2.8 s where the idle machine measures 1.2 s (2026-09-25)
        let text = ''; const segs = split(chunkS); const passMs = [];
        for (let pass = 0; pass < 3; pass++) { let ms = 0; for (const s of segs) { const r = await transcribe(s, port); ms += r.ms; if (pass === 0) text += ' ' + (r.json.segments || []).map((x) => x.text).join(' '); } passMs.push(ms); }
        const ms = median(passMs); const tMs = Math.round(ms / segs.length);
        points.push({ model, chunkS, wer: +wer(REFERENCE, text).toFixed(4), transcribeMs: tMs, lagS: +expectedLagS(chunkS, tMs).toFixed(2), rtf: +(ms / 1000 / dur).toFixed(3) });
        console.log(`  ${model.padEnd(15)} chunk ${String(chunkS).padStart(2)}s · WER ${(points.at(-1).wer * 100).toFixed(1)}% · transcribe ${tMs} ms · lag ${points.at(-1).lagS}s`);
      }
    });
  }
  // --vad-only: re-sweep the threshold on the model / chunk / threads already in force (the config's own), nothing else moves
  const win = vadOnly ? { ...(base.measured && base.measured.pick || {}), model: base.model, chunkS: base.chunkS } : pick(points);
  if (!win) { console.log('optimise: no admissible point — UNMEASURED'); return; }
  // threads, then VAD threshold, on the winner — each held only if it measures better
  const threadPts = [];
  for (const threads of vadOnly ? [] : quick ? [4, 8] : [2, 4, 6, 8]) await run({ ...base, model: win.model, threads }, async () => {
    await transcribe(wav, port); const segs = split(win.chunkS); const passMs = [];
    for (let pass = 0; pass < 3; pass++) { let ms = 0; for (const s of segs) ms += (await transcribe(s, port)).ms; passMs.push(ms); }
    threadPts.push({ threads, transcribeMs: Math.round(median(passMs) / segs.length) });
  });
  const bestT = { threads: vadOnly ? base.threads : pickThreads(threadPts, DEFAULTS.threads) };
  // VAD WER is the MEAN over four levels (0 · −15 · −25 · −32 dB) — a threshold that drops quiet speech must lose here, not
  // in the operator's room (measured 2026-09-25: 0.4–0.6 all 1.5–3.0 % down to −32 dB, i.e. no recall penalty in range)
  const LEVELS = [0, -15, -25, -32];
  const splitAt = (chunkS, db) => { const w = join(work, `ref${db}.wav`); const dir = join(work, `c${chunkS}_${-db}`); mkdirSync(dir, { recursive: true });
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-af', `volume=${db}dB`, '-ar', '16000', '-ac', '1', w]);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', w, '-f', 'segment', '-segment_time', String(chunkS), '-reset_timestamps', '1', join(dir, 's-%03d.wav')]);
    return readdirSync(dir).sort().map((f) => join(dir, f)); };
  const vadPts = [];
  for (const vadThreshold of [0.3, 0.4, 0.5, 0.6, 0.7]) await run({ ...base, model: win.model, threads: bestT.threads, vadThreshold }, async () => {
    const perLevel = [];
    for (const db of LEVELS) { let t = ''; for (const s of splitAt(win.chunkS, db)) t += ' ' + ((await transcribe(s, port)).json.segments || []).map((x) => x.text).join(' '); perLevel.push(wer(REFERENCE, t)); }
    const werMean = perLevel.reduce((a, b) => a + b, 0) / perLevel.length;
    const n = await transcribe(noise, port); const falseWords = (n.json.segments || []).map((x) => cleanText(x.text)).join(' ').split(/\s+/).filter(Boolean).length;
    vadPts.push({ vadThreshold, wer: +werMean.toFixed(4), perLevel: perLevel.map((x) => +x.toFixed(4)), levels: LEVELS, noiseWords: falseWords });
  });
  // the VAD pick: zero words out of pure noise, then the lowest WER, then the LOWEST threshold (most recall) among ties
  const vPick = { vadThreshold: pickVad(vadPts, DEFAULTS.vadThreshold, refWords()) };
  // the ingest interval: the fold must not spend more than a tenth of the wall clock — 10 × the measured median fold, clamped
  const ii = ingestInterval(readNd(P.slots)); const folds = { length: ii.foldN }; const foldMs = ii.foldMs;
  const ingestEveryS = ii.ingestEveryS == null ? base.ingestEveryS : ii.ingestEveryS;
  const cfg = { model: win.model, chunkS: win.chunkS, threads: bestT.threads, vadThreshold: vPick.vadThreshold, ingestEveryS, port: base.port, device: base.device,
    source: `generated by scripts/vna/audio-basin.mjs optimise ${new Date().toISOString()} — edit the sweep, never this file`,
    contended: Math.max(load0, loadavg()[0] / cpus().length) > 0.7, loadPerCore: [+load0.toFixed(2), +(loadavg()[0] / cpus().length).toFixed(2)],
    measured: { ...(vadOnly ? base.measured : {}), referenceS: dur ? +dur.toFixed(1) : null, pick: win, threads: vadOnly ? (base.measured && base.measured.threads) : threadPts, vad: vadPts, foldMs, foldN: folds.length, rule: 'min expected lag among WER ≤ best + 2 pts; threads and VAD: the default holds unless beaten beyond the noise (10 % latency / 1 word WER), VAD only among 0 noise words; ingest = clamp(FOLD_FACTOR × median fold, 30 s, 300 s)' },
    points };
  mkdirSync(dirname(CONFIG), { recursive: true }); writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${cfg.contended ? '⚠️ CONTENDED (load/core > 0.7) — latencies read high; re-run idle · ' : ''}optimise → ${win.model} · chunk ${win.chunkS}s · ${bestT.threads} threads · VAD ${vPick.vadThreshold} · ingest every ${ingestEveryS}s${foldMs == null ? ' (no fold measured yet — default kept)' : ` (fold median ${foldMs} ms over ${folds.length})`} · WER ${(win.wer * 100).toFixed(1)}% · lag ${win.lagS}s → ${CONFIG.replace(REPO + '/', '')}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const cmd = argv[0];
  if (cmd === '--daemon') await daemon();
  else if (cmd === 'arm') console.log(arm());
  else if (cmd === 'disarm') console.log(disarm());
  else if ((cmd === 'optimise' || cmd === 'optimize') && argv.includes('--ingest-only')) optimiseIngest();
  else if ((cmd === 'optimise' || cmd === 'optimize') && argv.includes('--repick')) repick();
  else if (cmd === 'optimise' || cmd === 'optimize') await optimise({ quick: argv.includes('--quick'), vadOnly: argv.includes('--vad-only') });
  else if (cmd === 'slot') console.log(JSON.stringify(slot()));
  else if (cmd === 'autobuild') { const on = argv[1] === 'on'; mkdirSync(DIR, { recursive: true }); if (on) writeFileSync(P.autobuild, new Date().toISOString() + '\n'); else { try { unlinkSync(P.autobuild); } catch {} }
    console.log(on ? `🔨 auto-build ON — each slotted batch is split at pauses, walked, and only parts that open with "steer …" / "build …" AND that the walk admits go to /steer (≤ ${BUILD_MAX_CYCLES} cycles, $${BUILD_CEILING_USD} each)` : '⚪ auto-build off — speech still slots into the tree; nothing is dispatched'); }
  else if (cmd === 'build') { const row = readNd(P.slots).find((r) => r.at === argv[1]) || readNd(P.slots).filter((r) => r.ok).pop(); const rows = await buildSlot(row); console.log(`build: ${rows.length} parts walked · ${rows.filter((r) => r.admissible).length} admissible · ${rows.filter((r) => r.addressed).length} addressed · ${rows.filter((r) => r.dispatched).length} dispatched`); }
  else { const s = readAll(); console.log(argv.includes('--json') ? JSON.stringify(s) : statusLine(s)); }
}
