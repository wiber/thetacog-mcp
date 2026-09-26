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
//
// Guard: tests/pmu-simulator/lens-c1-adjudication-atomic-write.test.mjs

import { writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Serialize `data` as JSON and write it to `path` atomically: temp-in-same-dir, then rename.
 * `indent` matches JSON.stringify's third argument (default 2, matching most callers here).
 * On any failure the temp file is cleaned up and the error re-thrown — the target is left
 * untouched (old content or absent), never partially written.
 */
export function writeJSONAtomic(path, data, { indent = 2 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, indent));
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
}
