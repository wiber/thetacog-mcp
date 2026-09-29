#!/usr/bin/env node
// walk-tape-read.mjs — BOUNDED reads of an append-only ndjson tape, from the end (the walk tape, the runner tape, any ndjson that only grows).
//
// THE INCIDENT (2026-09-21, "the numbers change but the graph is flat.. that cannot happen either"): .thetacog/walk-tape.ndjson
// crossed Node's string ceiling (547,529,300 bytes > 0x1fffffe8 chars) at ~19:00; readFileSync(tape, 'utf8') threw
// "Cannot create a string longer than 0x1fffffe8 characters", the reader's try/catch turned that into [], every walk of every
// session vanished, and the complexity graph went flat while the transcript's token counts kept moving. A whole-file read of a
// tape that only grows is a bug waiting for a date; every reader of the tape reads its TAIL through this module, bounded in bytes
// and stopped by time. The tape is roughly chronological (every writer stamps ts at append), so reading backwards until a row is
// older than `since` is a complete read of the window. A torn first line (a mid-file start) is dropped, never parsed.
import { statSync, openSync, readSync, closeSync } from 'node:fs';

export const CHUNK = 8 * 1024 * 1024;            // one backwards read
export const MAX_BYTES = 512 * 1024 * 1024;      // never more than this per call — under the string ceiling by construction (chunks are parsed one at a time)

/** the last `bytes` of the file as parsed rows (the torn first line dropped) — the old underwriter-policy reader, kept as one home */
export function tailRows(abs, bytes) {
  const size = statSync(abs).size; const start = Math.max(0, size - bytes); const buf = Buffer.alloc(size - start);
  const fd = openSync(abs, 'r'); try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
  const lines = buf.toString('utf8').split('\n'); if (start > 0) lines.shift();
  return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** every row with Date.parse(row.ts) >= since, read backwards in chunks and stopped at the first row older than `since`
 *  (a chunk's rows are checked oldest-first; the window closes when a chunk's OLDEST row is older than since); `filter` keeps the
 *  rows returned small (the predicate runs on every parsed row); rows come back in tape order. `bytesRead` is reported so a
 *  caller can say how much tape the window cost; stopWhen(kept) ends the scan early (newest-match reads) and leaves complete false. */
export function tailRowsSince(abs, since, { filter = () => true, chunk = CHUNK, maxBytes = MAX_BYTES, tsOf = (r) => Date.parse(r && r.ts) || 0, stopWhen = () => false } = {}) {
  const size = statSync(abs).size; const fd = openSync(abs, 'r');
  const kept = []; let end = size, carry = '', bytesRead = 0, complete = false;
  try {
    while (end > 0 && bytesRead < maxBytes) {
      const start = Math.max(0, end - chunk); const buf = Buffer.alloc(end - start);
      readSync(fd, buf, 0, buf.length, start); bytesRead += buf.length;
      const text = buf.toString('utf8') + carry;   // the carry is the head of the previous (later) chunk's first, torn line
      const lines = text.split('\n');
      carry = start > 0 ? lines.shift() : '';   // a mid-file start tears the first line — carry it back to be completed by the next (earlier) chunk; at offset 0 it is whole
      const rows = []; for (const l of lines) { if (!l) continue; try { rows.push(JSON.parse(l)); } catch {} }
      let oldest = Infinity; for (const r of rows) { const t = tsOf(r); if (t && t < oldest) oldest = t; if (t >= since && filter(r)) kept.push(r); }
      if (oldest < since) { complete = true; break; }
      if (stopWhen(kept)) break;   // a "newest row matching" scan stops at the first chunk that has one — the window is then INCOMPLETE by design
      end = start;
    }
    if (end === 0) complete = true;
  } finally { closeSync(fd); }
  kept.sort((a, b) => tsOf(a) - tsOf(b));
  return { rows: kept, bytesRead, complete, size };
}
