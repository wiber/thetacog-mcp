// scripts/vna/ndjson-tail.mjs — bounded readers for append-only ndjson: the count, the rows past a watermark, the newest
// row matching a predicate. Nothing here reads a file whole when the answer lives at its tail.
//
// WHY (2026-09-20, --cpu-prof of one PostToolUse hook, 5 s at load 50): the amendments ledger (5.7 MB, 970 rows) was
// readFileSync + split + JSON.parse'd TWICE per tool call — once in steer-hook step 3, once in readLose — to find the
// three newest rows of one source; and clearDecisionFor parsed the whole 32 MB email-sent.ndjson to answer whether ONE
// resendId is on it. Twelve sessions, every tool call. The same shape the walk tape had (steer-hook-tape.mjs, 396 MB read
// whole); this is that fix generalised, with the count made incremental.
//
// THREE DOORS:
//   lineCount(path, {cursorPath})  — non-empty lines, exactly as split('\n').filter(Boolean) counts them. A sidecar cursor
//                                    {size, lines, open} makes it incremental: bytes read = bytes appended since the cursor;
//                                    a shorter file than the cursor (truncated, rewritten) recounts from zero.
//   ledgerTail(path, {afterIndex, source, alsoVia, cursorPath}) — the rows with index > afterIndex (and source — or a via in alsoVia — when given), ascending,
//                                    each with its absolute index `_i`; read BACKWARDS in TAIL_CHUNK slices and stopped at the
//                                    watermark. afterIndex ≥ lines-1 reads nothing at all.
//   lastRowWhere(path, pred, {hint}) — the newest row satisfying pred, from the tail, first hit wins; with `hint` only lines
//                                    carrying that substring are parsed (an absent id is a byte search, not N parses).
// `stats` ({bytesRead, chunks, parsed}) on every door is what the guard measures. Never throws: a missing file is 0 / [] / null.
// @guard tests/vna/ndjson-tail.test.mjs
import { openSync, readSync, closeSync, fstatSync, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';   // scanLines: a multi-byte character cut by a chunk edge is held until its last byte arrives

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// the cursor lives beside no ledger (docs/ is tracked) — under .thetacog/ndjson-cursor, named by the ledger's absolute path, so
// two ledgers never share a count; a ledger under the OS temp dir (every test fixture) gets its cursor under the temp dir too,
// so a suite run leaves nothing in the live .thetacog
export const cursorFor = (path) => { const abs = resolve(path); const base = abs.startsWith(resolve(tmpdir())) ? resolve(tmpdir(), 'vna-ndjson-cursor') : resolve(REPO, '.thetacog/ndjson-cursor'); return resolve(base, `${basename(abs)}-${createHash('sha256').update(abs).digest('hex').slice(0, 10)}.json`); };

export const TAIL_CHUNK = 1 << 20;   // 1 MiB — the newest rows of a 5 MB ledger are found in one read
const NL = 10;
const HASH_WINDOW = 4096;   // C335a — the prefix window hashed under a cursor's `size` marker

// count non-empty lines in buf, continuing from `open` (a non-empty line in progress at buf's start); returns { lines, open }
function countNonEmpty(buf, open) {
  let lines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === NL) { if (open) { lines += 1; open = false; } }
    else open = true;
  }
  return { lines, open };
}

// VERIFY side: sha256 of exactly `len` bytes ending at byte offset `atSize`, read fresh from `fd` at an explicit
// position (never the file's current cursor, so a caller mid-loop-read is undisturbed). This is the one extra read
// the fix costs — paid only when a cursor claims a size that grew, never on a cold read (no cursor yet) or an
// unchanged file (nothing to verify).
function hashWindowVerify(fd, atSize, len, stats) {
  const start = Math.max(0, atSize - len);
  const n = atSize - start;
  if (n <= 0) return createHash('sha256').update('').digest('hex');
  const buf = Buffer.alloc(n);
  readSync(fd, buf, 0, n, start);
  if (stats) { stats.bytesRead += buf.length; stats.chunks += 1; }
  return createHash('sha256').update(buf).digest('hex');
}

export function lineCount(path, { cursorPath = undefined, stats = null } = {}) {
  if (cursorPath === undefined) cursorPath = cursorFor(path);
  let fd = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    let from = 0, lines = 0, open = false;
    if (cursorPath) {
      try {
        const c = JSON.parse(readFileSync(cursorPath, 'utf8'));
        if (c && Number.isInteger(c.size) && Number.isInteger(c.lines) && c.size <= size) {
          // C335a: `c.size <= size` alone only proves the file did not SHRINK — a rewrite that ends up the same size
          // or larger (a git checkout/restore of the tracked ledger, measured 2026-09-26: 7390 cached vs 7731 real,
          // 341 lines missed) still passes it with a wholly different prefix. Trust the cache only when nothing grew
          // (c.size === size: the loop below reads zero bytes either way) OR the bytes just under the cursor's own
          // `size` marker still hash to what was there when the cursor was written. A mismatch — or an older cursor
          // written before this field existed — recounts from zero, exactly as a shrink already does.
          if (c.size === size || (typeof c.hash4k === 'string' && Number.isInteger(c.hash4kLen) && c.hash4kLen >= 0 && hashWindowVerify(fd, c.size, c.hash4kLen, stats) === c.hash4k)) {
            from = c.size; lines = c.lines; open = !!c.open;
          }
        }
      } catch {}
    }
    let tailWindow = Buffer.alloc(0);   // WRITE side: the last ≤HASH_WINDOW bytes of what this call already read — no extra disk read to build it
    for (let pos = from; pos < size; pos += TAIL_CHUNK) {
      const buf = Buffer.alloc(Math.min(TAIL_CHUNK, size - pos));
      readSync(fd, buf, 0, buf.length, pos);
      if (stats) { stats.bytesRead += buf.length; stats.chunks += 1; }
      const c = countNonEmpty(buf, open); lines += c.lines; open = c.open;
      tailWindow = Buffer.concat([tailWindow, buf]);
      if (tailWindow.length > HASH_WINDOW) tailWindow = tailWindow.subarray(tailWindow.length - HASH_WINDOW);
    }
    const total = lines + (open ? 1 : 0);   // an unterminated last line counts, as split/filter counts it
    if (cursorPath && size !== from) {
      try {
        const hash4k = createHash('sha256').update(tailWindow).digest('hex'), hash4kLen = tailWindow.length;
        mkdirSync(dirname(cursorPath), { recursive: true });
        const tmp = `${cursorPath}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ size, lines, open, hash4k, hash4kLen, at: new Date().toISOString() }));
        renameSync(tmp, cursorPath);
      } catch {}
    }
    return { lines: total, size };
  } catch { return { lines: 0, size: 0 }; }
  finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
}

// walk the file backwards in chunks; `onLine(line, absIndex)` returns true to stop. Only called with the total line count.
function backwards(path, total, onLine, stats) {
  let fd = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    let end = size, carry = '', idx = total;   // idx = index of the NEXT line to hand out, walking down
    while (end > 0) {
      const start = Math.max(0, end - TAIL_CHUNK);
      const buf = Buffer.alloc(end - start);
      readSync(fd, buf, 0, buf.length, start);
      if (stats) { stats.bytesRead += buf.length; stats.chunks += 1; }
      const lines = (buf.toString('utf8') + carry).split('\n');
      carry = start > 0 ? lines.shift() : '';   // a line torn at the slice boundary completes in the next slice
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i]; if (!l) continue;
        idx -= 1;
        if (onLine(l, idx)) return;
      }
      end = start;
    }
  } catch { /* a vanished or unreadable file ends the walk */ }
  finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
}

// C233c: `alsoVia` admits rows of another source whose `via` is named (the audio basin writes {source:'audio:<day>', via:'audio'} —
// spoken batches that never touch the steer file, folded beside it). Default [] — every existing caller reads exactly what it read.
export function ledgerTail(path, { afterIndex = -1, source = null, alsoVia = [], cursorPath = undefined, stats = null } = {}) {
  if (!existsSync(path)) return { lines: 0, rows: [] };
  const { lines } = lineCount(path, { cursorPath, stats });
  if (afterIndex >= lines - 1) return { lines, rows: [] };   // nothing past the watermark: zero bytes of the tail
  const rows = [];
  backwards(path, lines, (l, i) => {
    if (i <= afterIndex) return true;
    try { const r = JSON.parse(l); if (stats) stats.parsed = (stats.parsed || 0) + 1; if (!source || r.source === source || (alsoVia.length && alsoVia.includes(r.via))) rows.push({ ...r, _i: i }); } catch {}
    return false;
  }, stats);
  rows.reverse();
  return { lines, rows };
}

// the newest row matching pred AND its index (split/filter(Boolean) numbering) — read backwards from the end, flat memory.
// { row: null, i: -1, lines } when nothing matches. For callers that also need "which row" (steer-ui timers / watched).
export function lastRowIndexed(path, pred, { cursorPath = undefined, stats = null } = {}) {
  if (!existsSync(path)) return { row: null, i: -1, lines: 0 };
  const { lines } = lineCount(path, { cursorPath, stats });
  let row = null, at = -1;
  backwards(path, lines, (l, i) => { try { const r = JSON.parse(l); if (pred(r)) { row = r; at = i; return true; } } catch {} return false; }, stats);
  return { row, i: at, lines };
}

export function lastRowWhere(path, pred, { hint = null, stats = null } = {}) {
  if (!existsSync(path)) return null;
  let hit = null;
  backwards(path, Number.MAX_SAFE_INTEGER, (l) => {
    if (hint && l.indexOf(hint) < 0) return false;
    try { const r = JSON.parse(l); if (stats) stats.parsed = (stats.parsed || 0) + 1; if (pred(r)) { hit = r; return true; } } catch {}
    return false;
  }, stats);
  return hit;
}

// ── C165b — SCAN A WHOLE NDJSON WITHOUT EVER HOLDING IT ──────────────────────────────────────────
// Some questions genuinely need every row (a dismissal can sit anywhere in history), so a tail read
// is the wrong shape and a `readFileSync(...).split('\n')` is the wrong COST: on the live ledger
// that is one 319 MB string plus ~1M string objects from the split, allocated ONCE PER PROMPT
// because steer-hook asks for the pending dismissals every time. Measured 2026-09-22 — it was the
// second-largest per-prompt allocation after the spec tree itself.
// Same answer, flat memory: the same chunked read lineCount already uses, one line at a time, and
// the caller keeps only what it wants. The torn line at a chunk edge is carried, exactly as
// tailRowsSince carries its own.
export function scanLines(path, onLine, { chunk = TAIL_CHUNK } = {}) {
  if (!existsSync(path)) return 0;
  let fd = null, n = 0;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    let carry = '';
    const dec = new StringDecoder('utf8');   // per-chunk buf.toString split a character across two chunks into two U+FFFD (the fold reads the ledger through here)
    for (let pos = 0; pos < size; pos += chunk) {
      const buf = Buffer.alloc(Math.min(chunk, size - pos));
      readSync(fd, buf, 0, buf.length, pos);
      const parts = (carry + dec.write(buf)).split('\n');
      carry = parts.pop();   // the last piece is torn unless this was the final chunk — the loop's end flushes it
      for (const l of parts) { if (l) { onLine(l, n); n++; } }
    }
    carry += dec.end();
    if (carry) { onLine(carry, n); n++; }
  } finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
  return n;
}
