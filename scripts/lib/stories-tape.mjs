#!/usr/bin/env node
// scripts/lib/stories-tape.mjs — THE ONE TAPE for intervention stories.
//
// data/interventions/stories/<sha>.json used to mint ONE TRACKED FILE PER COMMIT — 4,875 files,
// 25 MB, growing by one file forever (operator 2026-10-15: "the artifacts building many files in
// git need to be fixed — they need to be editing tapes ... not generating thousands of new
// files"). Replaced by ONE append-only tape, data/interventions/stories.ndjson: one JSON object
// per line, each row the same story shape plus its `sha`.
//
// AXIOM 1 (evict-or-retain, never free): this RETAINS every record. A sha written twice (e.g.
// probe-verify adding `outcome`, or build-intervention-prompt adding `ask`) gets a SECOND row —
// the update — appended after the first. Nothing ever rewrites or deletes a prior line; "the
// latest row for a sha wins" is resolved at READ time, by folding, never by mutating a line.
//
// API:
//   appendStory(story)  — append one row (throws if story.sha is missing)
//   readStories()       — every sha, LATEST row only, ordered by when it was last touched
//   storyFor(sha)        — one story, exact sha match else a prefix match (every writer mints a
//                          9-char short sha; a caller may hold the full 40-char sha, either way)
//   countForDay(day)     — count of distinct shas whose latest row has that `day`
//
// CLI (for bash callers — intervention-fire.sh):
//   node scripts/lib/stories-tape.mjs append '<json>'   # or append @path/to/file.json
//   node scripts/lib/stories-tape.mjs get <sha>          # prints the latest row's JSON, or nothing
//   node scripts/lib/stories-tape.mjs count-day <YYYY-MM-DD>
//
// Guard: tests/interventions/stories-are-one-tape.test.mjs — no file may exist under
// data/interventions/stories/, and no script/src file may write a path matching that pattern.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TAPE = process.env.STORIES_TAPE || resolve(REPO, 'data/interventions/stories.ndjson');

/** Append one story row. Never rewrites a prior line — AXIOM 1: evict-or-retain, this retains. */
export function appendStory(story, tape = TAPE) {
  if (!story || !story.sha) throw new Error('appendStory: story.sha is required');
  mkdirSync(dirname(tape), { recursive: true });
  appendFileSync(tape, JSON.stringify(story) + '\n');
  return story;
}

/** Read the whole tape — a line scan over one file, fine at this size (checked: a few MB, not
 *  thousands of file-handle opens). Folds to the LATEST row per sha, in last-touched order: a
 *  JS Map re-set moves a key to the end of its insertion order, so re-setting on every later
 *  row IS the reorder-to-latest this needs. */
export function readStories(tape = TAPE) {
  if (!existsSync(tape)) return [];
  const text = readFileSync(tape, 'utf8');
  if (!text) return [];
  const bySha = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }   // a half-written line is not a blocker
    if (!row || !row.sha) continue;
    bySha.delete(row.sha);
    bySha.set(row.sha, row);
  }
  return [...bySha.values()];
}

/** One story by sha. Exact match first, else a prefix match either direction (9-char short sha
 *  vs a caller's full 40-char sha). Latest row wins. */
export function storyFor(sha, tape = TAPE) {
  if (!sha) return null;
  const rows = readStories(tape);
  return rows.find((s) => s.sha === sha)
    || rows.find((s) => String(s.sha).startsWith(sha) || String(sha).startsWith(s.sha))
    || null;
}

/** Count of distinct shas (latest row) whose `day` field matches — the daily LLM-fire cap. */
export function countForDay(day, tape = TAPE) {
  return readStories(tape).filter((s) => s.day === day).length;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const cmd = process.argv[2];
  if (cmd === 'append') {
    const raw = process.argv[3] || '';
    const json = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw;
    const story = JSON.parse(json);
    appendStory(story);
    console.log(story.sha);
  } else if (cmd === 'get') {
    const s = storyFor(process.argv[3]);
    if (s) console.log(JSON.stringify(s));
  } else if (cmd === 'count-day') {
    console.log(countForDay(process.argv[3]));
  } else {
    console.error('usage: stories-tape.mjs append <json|@file> | get <sha> | count-day <YYYY-MM-DD>');
    process.exit(2);
  }
}
