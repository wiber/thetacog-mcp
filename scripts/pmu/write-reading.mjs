#!/usr/bin/env node
// scripts/pmu/write-reading.mjs — THE ONE DOOR A READING LEAVES THROUGH (house rule 11: a reading names its engine).
//
// WHY THIS DOOR EXISTS. The JS tape reader and the crate once disagreed by 1,839 rows on every daily rate, and the
// disagreement went unnoticed for as long as it did because NEITHER reading said which engine had answered it — two
// files, two numbers, and nothing on either file to say "this one is the crate, that one is the JS oracle". The rule
// that came out of it is simple: every kr*.json under data/pmu/ carries a top-level `engine` string, and a reading
// with no engine is not written at all. On the night of 2026-09-17 five readers were patched by hand with
// `JSON.stringify({ engine: 'js', ...out }, null, 1)` — five copies of one rule, which is exactly how the sixth
// reader forgets it. This module is the one place the rule lives; every reader routes its write through it.
//
// WHAT 'rust-*' MEANS. 'rust-<name>' is reserved for an object the pmu-onchip binary itself produced (its own
// `engine` field echoed back: rust-vol, rust-envelope, rust-aperture-read, rust-steering-read, rust-job-units-read,
// rust-action). A JS driver that ASSEMBLES a file — even one that embeds a crate reading inside it — stamps 'js'
// unless the top-level engine it names is the one the crate named. 'js-fallback' is the JS oracle answering because
// the binary could not (no binary, a bad exit, a mis-named engine); the reader records why beside it.
//
// The write is atomic — the same temp-in-same-dir-then-rename that ./atomic-write.mjs does, restated here only because
// writeJSONAtomic serialises for you and drops the trailing newline these files carry — so a reader can only ever see
// the old complete reading or the new one. Indent is 1, the house convention for these files, plus that newline.
//
// Usage:
//   import { writeReading } from './write-reading.mjs';
//   writeReading(resolve(REPO, 'data/pmu/kr31-rct.json'), out, 'js');
//   writeReading(resolve(REPO, 'data/pmu/kr43-no-arbitrage.json'), out, out.engine);   // engine the crate named
//
// Guards: tests/formal/reading-names-its-engine.test.mjs (the files) · tests/formal/reading-writer-door.test.mjs (the writers).

import { writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const ENGINE_RE = /^(rust-[a-z0-9-]+|js|js-fallback)$/;

/**
 * Write `{ engine, ...obj }` to `absPath` — engine first, indent 1, trailing newline, atomic.
 * Throws before touching the disk when `engine` is not a string the house recognises, or when `obj` already names a
 * DIFFERENT engine (a reading may not say two things about who answered it).
 */
export function writeReading(absPath, obj, engine) {
  if (typeof engine !== 'string' || !ENGINE_RE.test(engine)) {
    throw new Error(
      'writeReading refused ' + absPath + ': a reading names its engine (house rule 11) — the third argument must be a ' +
      'string matching ' + String(ENGINE_RE) + " ('rust-<name>' only for an object the pmu-onchip binary produced, 'js' for a " +
      "JS read, 'js-fallback' for the JS oracle standing in for a missing binary); got " + JSON.stringify(engine));
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('writeReading refused ' + absPath + ': a reading is a plain object, got ' + (Array.isArray(obj) ? 'an array' : typeof obj));
  }
  if (typeof obj.engine === 'string' && obj.engine !== engine) {
    throw new Error('writeReading refused ' + absPath + ': the object names engine ' + JSON.stringify(obj.engine) + ' but the caller says ' + JSON.stringify(engine) + ' — one reading, one engine');
  }
  const body = JSON.stringify({ engine, ...obj }, null, 1) + '\n';
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, absPath);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
  return absPath;
}
