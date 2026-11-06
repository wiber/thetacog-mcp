#!/usr/bin/env node
// scripts/pmu/atomic-write.mjs — WRITE-TO-TEMP-THEN-RENAME, the one place this pattern lives.
//
// INCIDENT (2026-09-17): data/pmu/lens-c1-adjudication.json was found truncated mid-write —
// 12,369,920 bytes, `JSON.parse` throwing "Unterminated string" — while FOUR separate writers
// (harvest-agent.mjs, hunt-pool.mjs, reef-demand.mjs, reef-miner.mjs) each called plain
// `writeFileSync(PATH, JSON.stringify(adj, null, 1))` directly on this 12-16MB shared file. A
// single `writeFileSync` on a buffer this large is not guaranteed atomic — it can issue several
// underlying write() syscalls, and a process interrupted between them (a timeout, an overlapping
// concurrent run, a kill) leaves a partial file on disk. Ten tests read this file with no fallback
// for a truncated parse, so a partial write there is a ten-test outage, not a one-writer bug.
//
// THE FIX, in one place: write the full content to a uniquely-named temp file IN THE SAME
// DIRECTORY (a cross-filesystem rename is not atomic; renameSync within one directory is), then
// renameSync() it over the target. A reader can only ever see the OLD complete file or the NEW
// complete file — never a partial one — because rename is a single atomic directory-entry swap.
// This mirrors the pattern scripts/pmu/pipeline-state.mjs, knock-on.mjs and corpus-ingest.mjs
// already use for their own files; this module is the one place a NEW writer should reach for it
// instead of re-deriving the same three lines a fifth time.
//
// Usage:
//   import { writeJSONAtomic } from './atomic-write.mjs';
//   writeJSONAtomic(ADJ_PATH, adj, { indent: 1 });   // indent matches JSON.stringify's 3rd arg
//   writeTextAtomic(path, text);                       // a pre-serialized payload (a git blob), same primitive
//   readJSONStrict(path, { absent: { rows: [] } });    // the parse door: absent → default, torn → REFUSED with the byte offset
//
// Guard: tests/pmu-simulator/lens-c1-adjudication-atomic-write.test.mjs

import { renameSync, unlinkSync, mkdirSync, readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

// ── THE READ SIDE (C1390, 2026-10-28) ──────────────────────────────────────────────────────────
// INCIDENT: data/pmu/lens-c1-adjudication.json sat at 12,304,384 bytes (3004 pages, a byte-prefix
// of its own committed blob, cut after row 9,463 of 12,622) from 2026-10-13 to 2026-10-28. Every
// reader did one of two wrong things: harvest-agent.mjs:67 and reef-miner.mjs:227 crashed with
// "SyntaxError ... at position 12149608" (a CHAR position, not a byte offset — the text is
// multibyte), 22 nightly ticks in a row, admitting nothing; tesseract-progress.mjs, reef-demand's
// dedupe set, tape-overwatch and immune-ratchet swallowed the parse error and carried on with an
// empty default — rank 0, pending 0, no ledger — as if the file were absent. A refusal and an
// absence must never read the same (AXIOM 1 W5: the gap is a countable displacement, named).
//
// readJSONStrict is the one parse door for a shared JSON ledger: ABSENT returns the caller's
// absent-default (or throws LEDGER_ABSENT when none is given); UNPARSEABLE always throws
// LEDGER_UNPARSEABLE with the BYTE offset of the break, the bytes on disk, and the count of
// complete indent-1 rows before it — enough to restore from git without re-deriving anything.
// readLedgerOrExit is the admission stages' door: the refusal is one line on stderr, exit 2,
// never a stack trace and never a silent default, so the nightly log records REFUSED with a reason.
// Guard: tests/vna/c1390-the-overnight-admission-loop-crashed-on.test.mjs

const NO_DEFAULT = Symbol('no-default');

export function readJSONStrict(path, { absent = NO_DEFAULT } = {}) {
  if (!existsSync(path)) {
    if (absent !== NO_DEFAULT) return absent;
    const e = new Error(`REFUSED: ${path} is absent`); e.code = 'LEDGER_ABSENT'; e.path = path; throw e;
  }
  const buf = readFileSync(path);
  const text = buf.toString('utf8');
  try { return JSON.parse(text); } catch (err) {
    const pos = parseInt((String(err.message).match(/position (\d+)/) || [])[1], 10);
    const failChar = Number.isFinite(pos) ? pos : text.length;
    const failByte = Buffer.byteLength(text.slice(0, failChar), 'utf8');
    // complete indent-1 rows[] entries before the break — the recoverable prefix, counted not guessed
    let completeRows = null;
    const cut = text.lastIndexOf('\n  },\n  {');
    if (cut > 0) { try { completeRows = (JSON.parse(text.slice(0, cut) + '\n  }\n ]\n}').rows || []).length; } catch { completeRows = null; } }
    const atEnd = failByte >= buf.length;
    const e = new Error(
      `REFUSED: ${path} is not parseable JSON — ${buf.length} bytes on disk, parse fails at char ${failChar} = byte ${failByte}` +
      (atEnd ? ' (the end of the file: a truncated write)' : '') +
      `; ${completeRows == null ? 'unknown' : completeRows} complete rows before the break. ` +
      `Not a fallback, not rank 0: restore it from the last parseable commit (git log --format=%h -- <path>; git show <sha>:<path>). [${String(err.message).slice(0, 90)}]`);
    e.code = 'LEDGER_UNPARSEABLE'; e.path = path; e.bytes = buf.length; e.failChar = failChar; e.failByte = failByte; e.completeRows = completeRows; e.cause = err;
    throw e;
  }
}

/** The admission stages' door: one REFUSED line naming the byte offset, exit 2 — never a stack trace, never a default. */
export function readLedgerOrExit(path, { stage = 'reader', absent = NO_DEFAULT } = {}) {
  try { return readJSONStrict(path, { absent }); } catch (err) {
    if (err.code !== 'LEDGER_UNPARSEABLE' && err.code !== 'LEDGER_ABSENT') throw err;
    console.error(`${stage}: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Serialize `data` as JSON and write it to `path` atomically: temp-in-same-dir, then rename.
 * `indent` matches JSON.stringify's third argument (default 2, matching most callers here).
 * On any failure the temp file is cleaned up and the error re-thrown — the target is left
 * untouched (old content or absent), never partially written.
 */
// C1390 (2026-10-28): DURABLE BEFORE VISIBLE. The 2026-10-13 truncation was a 3004-page byte-prefix of
// the ledger's own blob — a sequential write that stopped at a page boundary. Every JSON writer was
// already tmp+rename, which rules out a torn target from a killed writer; what tmp+rename alone does
// NOT rule out is a rename that reaches the directory before the tmp file's data reaches the disk
// (no fsync: the kernel is free to journal the directory swap first). So the payload is written through
// one fd, fsynced, closed, and only then renamed over the target. fsync on macOS pushes to the drive
// (F_FULLFSYNC, the platter guarantee, is not reachable from Node); that is stated, not overclaimed.
// writeTextAtomic is the same primitive for a pre-serialized payload (harvest-accept's revert-by-restore
// wrote a 16 MB git blob with a raw writeFileSync — the one non-atomic writer of the ledger left).
function writeBytesAtomic(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let fd = null;
  try {
    fd = openSync(tmp, 'w');
    let off = 0;
    while (off < payload.length) off += writeSync(fd, payload, off, payload.length - off);
    fsyncSync(fd);
    closeSync(fd); fd = null;
    renameSync(tmp, path);
  } catch (err) {
    if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
}

export function writeJSONAtomic(path, data, { indent = 2 } = {}) {
  const text = JSON.stringify(data, null, indent);
  if (typeof text !== 'string') throw new TypeError(`writeJSONAtomic: ${path} — JSON.stringify produced no text (undefined/function/symbol input)`);
  writeBytesAtomic(path, Buffer.from(text, 'utf8'));
}

/** Write an already-serialized text payload atomically (tmp in the same dir, fsync, rename). Refuses a non-string. */
export function writeTextAtomic(path, text) {
  if (typeof text !== 'string') throw new TypeError(`writeTextAtomic: ${path} — payload must be a string, got ${typeof text}`);
  writeBytesAtomic(path, Buffer.from(text, 'utf8'));
}
