#!/usr/bin/env node
// scripts/vna/sidebar-tail.mjs — C647e THE SIDEBAR DRAWS THE SAME TAIL, LIVE, OFF YOUR OWN CLAUDE CODE TRANSCRIPTS (operator
// 2026-10-04, verbatim: "add the means for token count and fat tail graphs to the /backup pages (and left sidebar) it needs to be
// a live graph" · "look at cc").
//
// WHAT IT IS: C638's loss-run reader kept warm. The same functions read the same files in the same order (transcriptFiles →
// sessionOf → foldRows, one call per message.id, tickActual), so the survival curve this draws IS loss-run's curve over the
// same transcripts — lossReading, then loss-run's lossSvg (token-tail.mjs's survivalSvg, C647c's one function), never a second painter. The token
// count per day is token-tail.mjs's tokensPerDay over the same calls, each call dated by its own row's timestamp (UTC day).
// LIVE: --watch keeps the state in memory, watches ~/.claude/projects, and on a transcript append reads ONLY the new bytes of
// that file (its byte offset is kept), folds them with the same seen set, and rewrites the receipt. The receipt is on
// steer-ui.mjs's RECEIPT_PATHS, so the extension's receipt watcher repaints the sidebar, and the page morphs in place (C564).
// One watcher per machine: a pid file beside the receipt; a second --watch exits while the first lives.
// SENDS NOTHING: imports fs, path, os and three readers that import no transport; the guard runs it with every socket door
// stubbed to throw.
// Known difference from a cold re-read, named so it is not mistaken for drift: a message.id that first appears in a file
// appended LATER is credited to the session that showed it first in time; a cold loss-run credits it to the file that sorts
// first. Totals and per-day sums are unchanged; a restart of the watcher re-reads cold and agrees with loss-run exactly.
// Not sufficient for: whether the work in any task was good (Rice), or why a task was big (a session mixes many asks).
// Port row: none — a reader that decides nothing; the mass it holds is the seen set of message ids (one string per call).
// @guard tests/vna/c647e-sidebar-live-tail.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { transcriptFiles, sessionOf, foldRows, lossReading, lossSvg, TICK_UNIT } from './loss-run.mjs';
import { usageOf, callKeyOf, tickActual } from './steer-ab-rules.mjs';
import { tokensPerDay, tokensWord, LIVE_REFRESH_MS } from '../../src/lib/backup/token-tail.mjs';
import { pillRow } from './metric-pill.mjs';

export const RECEIPT_REL = '.thetacog/cache/sidebar-tail.json';
export const X_LABEL = 'tokens in one task — one Claude Code session (log)';
export const DOOR = 'npx thetacog-mcp sidebar-tail';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const defaultRoot = () => process.env.SIDEBAR_TAIL_ROOT || process.env.LOSS_RUN_ROOT || path.join(os.homedir(), '.claude', 'projects');
export const receiptPath = (repo = process.env.VNA_REPO || path.resolve(HERE, '..', '..')) => process.env.VNA_SIDEBAR_TAIL || path.join(repo, RECEIPT_REL);

/** a fresh state over root: session ticks (loss-run's), day ticks, the one seen set, and a byte offset per file */
export function newState(root) { return { root, ticks: new Map(), dayTicks: new Map(), seen: new Set(), offsets: new Map() }; }

const dayOf = (row) => { const t = row && row.timestamp; return typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null; };

/** fold ONE row: foldRows into the session tick (loss-run's own fold), and — when it was a new call — into its day */
export function foldRow(S, file, row) {
  const s = sessionOf(S.root, file); const before = S.seen.size;
  foldRows([row], s, S.ticks, S.seen);
  const u = usageOf(row); if (!u) return;
  if (callKeyOf(row) && S.seen.size === before) return;   // a repeated message.id: loss-run skipped it, so does the day
  const day = dayOf(row); if (!day) return;
  const label = (S.ticks.get(s) && S.ticks.get(s).label) || 'PLAIN';
  foldRows([row], `${day}\t${label}`, S.dayTicks, new Set());
}

/** read file from its kept offset to the last complete line; returns rows folded. A file that shrank re-reads cold (reset). */
export function readNew(S, file, { atEof = true } = {}) {
  let size; try { size = fs.statSync(file).size; } catch { return 0; }
  const off = S.offsets.get(file) || 0;
  if (size < off) return -1;
  if (size === off) return 0;
  const fd = fs.openSync(file, 'r'); let pos = off, carry = Buffer.alloc(0), rows = 0; const CH = 4 << 20; const buf = Buffer.allocUnsafe(CH);
  const line = (b) => { const t = b.toString('utf8'); if (!t.trim()) return; let r; try { r = JSON.parse(t); } catch { return; } foldRow(S, file, r); rows++; };
  try {
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CH, size - pos), pos); if (n <= 0) break; pos += n;
      let chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : Buffer.from(buf.subarray(0, n)); let start = 0, i;
      while ((i = chunk.indexOf(10, start)) !== -1) { line(chunk.subarray(start, i)); start = i + 1; }
      carry = chunk.subarray(start);
    }
  } finally { fs.closeSync(fd); }
  let consumed = pos - carry.length;
  // a last line with no newline: readline (loss-run) reads it at EOF, so a whole one is folded here too; a torn one waits
  if (atEof && carry.length) { const t = carry.toString('utf8'); try { const r = JSON.parse(t); foldRow(S, file, r); rows++; consumed = pos; } catch { /* torn — the next append completes it */ } }
  S.offsets.set(file, consumed);
  return rows;
}

/** the cold read: every transcript under root, in loss-run's order */
export function loadAll(root) { const S = newState(root); for (const f of transcriptFiles(root)) readNew(S, f); return S; }

/** the reading the sidebar paints: lossReading over the session ticks (loss-run's), tokensPerDay over the day ticks */
export function readingOf(S, now = new Date()) {
  const ticks = [...S.ticks.values()].filter((t) => t.calls > 0).map((t) => ({ ...t, label: t.label || 'PLAIN', actual: tickActual(t) }));
  const days = [...S.dayTicks.values()].filter((t) => t.calls > 0).map((t) => { const [day, label] = t.session.split('\t'); return { day, label, actual: tickActual(t) }; });
  return { at: now.toISOString(), unit: TICK_UNIT, files: S.offsets.size, calls: S.seen.size, reading: lossReading(ticks), per_day: tokensPerDay(days), sent: 'nothing — read on this machine' };
}

/** the curve: loss-run's own lossSvg (token-tail.mjs's survivalSvg) over the reading — the same bytes, with the x axis's words naming the
 *  point a task (C650's word; here one task = one session). Only that one <text> is re-worded; every point and frame stays lossSvg's. */
export const CLI_X_LABEL = '>tokens in one unit of agent work (log)</text>';
export function tailSvg(R) { return lossSvg(R).replace(CLI_X_LABEL, `>${X_LABEL}</text>`); }

const M = (v) => Math.round((v / 1e6) * 10) / 10;
const BANK_RECEIPT = `read off <code>${RECEIPT_REL}</code>, written by <code>${DOOR} --watch</code> from <code>~/.claude/projects</code> on this machine`;
/** the sidebar section: two C647d pills (closed = the number, n and its own series) and the curve beneath — pillRow only */
export function sidebarTailHtml(T) {
  const R = T && T.reading; const days = (T && T.per_day) || [];
  const un = !R ? `not read yet — run ${DOOR} --watch` : R.status !== 'MEASURED' ? R.reason : null;
  const sizes = R && R.status === 'MEASURED' ? [...R.survival.plain, ...R.survival.steer].sort((a, b) => a - b) : [];
  const last = days.length ? days[days.length - 1] : null;
  const pills = [
    { id: 'cc-tokens-day', label: 'Your Claude Code tokens, latest day', value: last ? M(last.steer + last.plain) : null, unit: last ? `M tokens on ${last.day} (UTC)` : '', why: last ? '' : (T ? 'no dated calls yet' : `not read yet — run ${DOOR} --watch`),
      n: days.length, series: days.map((d) => M(d.steer + d.plain)),
      read: { left: `The tokens your own sessions used each day (input + cache writes + cache reads), one point per day, newest last; ${BANK_RECEIPT}.`, right: 'The same count a carrier would recompute from the transcripts: one call per message id, summed per UTC day. Run loss-run on the same folder and the totals agree.' },
      notFor: { left: 'Whether a day\'s work was good, or what it cost in money (prices differ by model and plan).', right: 'A rate for any future day — a day is where calls fell, never an average.' },
      mitigation: { left: 'Declare the scope before a long task (/steer), so a heavy day is placed against what was asked.', right: 'Ask for the per-task curve beside it: a day is many tasks, and the tail lives in the tasks.' } },
    { id: 'cc-worst-task', label: 'Your largest task', value: sizes.length ? M(sizes[sizes.length - 1]) : null, unit: 'M tokens in one task (a session)', why: un || '',
      n: sizes.length, series: sizes.map(M),
      read: { left: `Every task you ran, smallest to largest; the last point is the largest one. ${R && R.status === 'MEASURED' ? `The worst 5 % of your tasks carry ${(R.worst5_share * 100).toFixed(0)} % of all your tokens.` : ''} The curve below is the same tasks as a survival curve: the share of tasks larger than x. ${BANK_RECEIPT}.`, right: 'The survival curve P(task > x), log-log, the loss-run chart over the holder\'s own transcripts; a straight run on the right is the fat tail.' },
      notFor: { left: 'Why a task was big — a session mixes many asks.', right: 'That declaring a scope caused any difference between the two lines (sessions choose their arm), or the size of any future task.' },
      mitigation: { left: 'Split the largest tasks; a task that crossed the line you would have stopped at is the one to declare first.', right: `Recompute it: <code>${DOOR.replace('sidebar-tail', 'loss-run')}</code> on the same folder draws the same curve.` } },
  ];
  const curve = R && R.status === 'MEASURED' && sizes.length ? `<figure class="cc-tail" style="margin:6px 0 0;max-width:100%">${tailSvg(R)}<figcaption class="dim">${T.files} transcript files · ${T.calls} calls, one per message id · read ${T.at.slice(0, 19).replace('T', ' ')} UTC · sent nothing</figcaption></figure>` : '';
  return `<div class="cc-tail-block" data-c647e="sidebar-tail"><div class="dim" style="font-size:11px;letter-spacing:.12em;margin:8px 0 2px">YOUR CLAUDE CODE TOKENS · LIVE</div>${pillRow(pills, { css: true })}${curve}</div>`;
}

/** the receipt on disk, or null */
export function readTailReceipt(file = receiptPath()) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const writeAtomic = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

/**
 * liveTail(root, { onReading, debounceMs, minIntervalMs }) — the cold read, then fs.watch over root: an appended or new *.jsonl
 * is read from its kept offset and onReading(reading) fires again. Returns { state, close, ready }.
 */
export function liveTail(root, { onReading = () => {}, debounceMs = 1000, minIntervalMs = LIVE_REFRESH_MS, pollMs = 30_000 } = {}) {
  let S = loadAll(root); const dirty = new Set(); let timer = null, lastEmit = 0, closed = false;
  const emit = () => { lastEmit = Date.now(); onReading(readingOf(S)); };
  const flush = () => {
    timer = null; if (closed) return;
    const wait = minIntervalMs - (Date.now() - lastEmit); if (wait > 0) { timer = setTimeout(flush, wait); return; }
    let moved = 0;
    for (const f of [...dirty]) { dirty.delete(f); const r = readNew(S, f); if (r === -1) { S = loadAll(root); moved++; break; } moved += r; }
    if (moved) emit();
  };
  const touch = (f) => { dirty.add(f); if (!timer) timer = setTimeout(flush, debounceMs); };
  let w = null;
  try { w = fs.watch(root, { recursive: true }, (_e, name) => { if (name && String(name).endsWith('.jsonl')) touch(path.join(root, String(name))); }); } catch { w = null; }
  // the safety net where recursive watch is missing or drops an event: a size sweep (stat only, no read) every pollMs
  const poll = setInterval(() => { for (const f of transcriptFiles(root)) { let sz; try { sz = fs.statSync(f).size; } catch { continue; } if (sz !== (S.offsets.get(f) || 0)) touch(f); } }, pollMs); poll.unref?.();
  emit();
  return { get state() { return S; }, close() { closed = true; if (timer) clearTimeout(timer); clearInterval(poll); if (w) w.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const root = opt('--root') || defaultRoot(); const out = opt('--receipt') || receiptPath();
  const write = (T) => writeAtomic(out, JSON.stringify(T) + '\n');
  if (args.includes('--watch')) {
    const pidFile = `${out}.pid`;
    try { const pid = Number(fs.readFileSync(pidFile, 'utf8')); if (pid && pid !== process.pid) { process.kill(pid, 0); console.log(`sidebar-tail: watcher pid ${pid} already holds ${out}`); process.exit(0); } } catch { /* none, or dead — ours */ }
    fs.mkdirSync(path.dirname(pidFile), { recursive: true }); fs.writeFileSync(pidFile, String(process.pid));
    const ms = Number(opt('--min-interval-ms')); const db = Number(opt('--debounce-ms'));
    const L = liveTail(root, { onReading: write, minIntervalMs: Number.isFinite(ms) ? ms : LIVE_REFRESH_MS, debounceMs: Number.isFinite(db) ? db : 1000 });
    const stop = () => { L.close(); try { if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.unlinkSync(pidFile); } catch { /* gone */ } process.exit(0); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  } else {
    const T = readingOf(loadAll(root)); write(T);
    const R = T.reading;
    console.log(R.status === 'MEASURED' ? `sidebar tail · n ${R.n} tasks · worst ${tokensWord(R.worst)} · worst 5% carry ${(R.worst5_share * 100).toFixed(0)}% · ${T.per_day.length} days · read locally, nothing sent → ${out}` : `sidebar tail · UNMEASURED — ${R.reason} → ${out}`);
  }
}
