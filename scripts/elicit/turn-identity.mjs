#!/usr/bin/env node
// Turn identity and the canonical tape.
//
// gemSkill.txt, missing-item #2: "Gemini's DOM gives no durable ids, so mint turn_hash
// from thread + text + position at first sight, or the first DOM change refires your
// entire backfill as new work."
//
// WHY POSITION IS THE WRONG THIRD TERM, AND WHAT REPLACES IT.
// The obvious reading — hash(thread, text, index-in-thread) — is stable only while no
// turn is ever inserted above. Gemini re-renders, lazily loads older history, and drops
// the tab URL; the first backfill that reveals ten earlier turns shifts every index by
// ten and re-mints the whole thread as new work, which is exactly the failure the item
// names. Position is a proxy for "which of the identical ones is this", and that
// question is the construct.
//
// So the third term is the OCCURRENCE INDEX: among turns in this thread whose normalised
// text is byte-equal, which one is this. "ok" said four times yields occurrences 0..3,
// and those stay 0..3 no matter what loads above them. Identity survives re-render, lazy
// history and reorder, and two genuinely identical utterances stay distinguishable —
// which a plain content hash would collapse into one.
//
// MINTED ONCE. The tape is the registry: seeing a turn again returns the hash it was
// first given. That is what "at first sight" buys — re-identification, not re-minting.
//
// THE TAPE. Append-only is not enough, because append-only says nothing about edits to
// lines already written. Each row carries `prev`, the link hash of the row before it, so
// an edited or deleted line breaks the chain at a computable point. Under AXIOM 1 that
// is the difference between a log — an emission from inside the boundary — and a record.
//
// CLI:
//   node scripts/elicit/turn-identity.mjs --verify         # walk the chain, report breaks
//   node scripts/elicit/turn-identity.mjs --cursor <thread>  # the cursor (a hash, never a time)
//   node scripts/elicit/turn-identity.mjs                   # stats

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';   // THE ONE resolver — honours PMU_BINARY, one canonical search (spec v2 Task 2)
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// THE IMMUTABLE TAPE IS THE THETACOG. Operator, 2026-08-28: "this is the same for autonomous
// bots as for this usecase, which is why the encircled panels should prove to hold their own
// here." The first version of this file wrote .thetacog/elicit/tape.ndjson — a second tape
// beside the one that already exists, with its own chain and its own rules.
//
// That is a fork, and the tape contract bans forks for the same reason the analytic walk is
// banned: the running structure exists. A tape session is .thetacog/tape-sessions/<slug>/ and
// it already carries session.json, an ingest cursor, and the ndjson ledgers the rest of the
// machinery reads. Gemini turns are one more session in it, not a parallel universe.
//
// The consequence that makes this worth doing rather than tidy: a turn seated in the thetacog
// gets placed and panelled by the SAME instrument that places a commit. One receipt shape for
// both halves of the loop, which is exactly what "promise versus delivery" needs.
export const TAPE_SESSION = process.env.ELICIT_TAPE_SESSION ||
  resolve(HERE, '../../.thetacog/tape-sessions/gemini-web');
export const TAPE = process.env.ELICIT_TAPE_FILE || resolve(TAPE_SESSION, 'turns.ndjson');

/**
 * A tape session declares itself: slug, the sources it was built from, and the cursor it
 * resumed at. Without session.json the directory is a folder of ndjson that nothing else in
 * the tape machinery will recognise as a session.
 */
export function ensureSession(dir = TAPE_SESSION, { sources = [] } = {}) {
  mkdirSync(dir, { recursive: true });
  const f = resolve(dir, 'session.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const session = {
    version: 1,
    slug: 'gemini-web',
    sources,
    lane: 'gemini-web-scrape',
    note: 'Turns dictated into the Gemini web app, minted at first sight. Verbatim text lives '
        + 'here and is gitignored; anything published carries the hash only.',
  };
  writeFileSync(f, JSON.stringify(session, null, 2) + '\n');
  return session;
}

// Normalisation decides what "the same turn" means. Whitespace and case are render
// artifacts; the words are the turn. Anything more aggressive — stripping punctuation,
// stemming — would merge turns the operator meant as distinct.
export const normalise = (text) =>
  String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const h16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const idOf = (thread, occurrence, text) => `${thread} :: ${occurrence} :: ${normalise(text)}`;

/** The identity of a turn: its thread, its normalised text, and which occurrence it is. */
export function mintTurnHash({ thread, text, occurrence = 0 }) {
  return h16(idOf(thread, occurrence, text));
}

export function readTape(file = TAPE) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

/** A row's link hash, over its content and its predecessor. */
const linkHash = (row) => h16(JSON.stringify(
  [row.prev, row.turn_hash, row.thread, row.seen_at, row.text, row.source]));

/**
 * Record turns, first sight wins. Returns { minted, seen } — `seen` are turns already on
 * the tape, handed back with the hash they were originally given rather than a new one.
 */
export function recordTurns(turns, { file = TAPE, now = () => new Date().toISOString() } = {}) {
  const tape = readTape(file);
  const known = new Map();       // identity -> turn_hash
  const occupied = new Map();    // thread+text -> highest occurrence already on tape
  for (const r of tape) {
    const occ = r.occurrence ?? 0;
    known.set(idOf(r.thread, occ, r.text), r.turn_hash);
    const k = `${r.thread} :: ${normalise(r.text)}`;
    occupied.set(k, Math.max(occupied.get(k) ?? -1, occ));
  }

  const minted = [];
  const seen = [];
  const usedInBatch = new Map();  // thread+text -> next occurrence to try in this batch
  let prev = tape.length ? linkHash(tape[tape.length - 1]) : 'genesis';
  const lines = [];

  for (const t of turns) {
    const k = `${t.thread} :: ${normalise(t.text)}`;
    // Which occurrence is this? Start at 0 and walk up past the ones already claimed,
    // so a re-presented thread re-identifies in order and a genuinely repeated
    // utterance lands on the next free index.
    let occ = usedInBatch.get(k) ?? 0;
    const identity = idOf(t.thread, occ, t.text);

    if (known.has(identity)) {
      seen.push({ ...t, turn_hash: known.get(identity), occurrence: occ });
      usedInBatch.set(k, occ + 1);
      continue;
    }

    // Not known at this occurrence. If the tape already holds occurrences of this text,
    // this is a genuine repeat and takes the next free index above them.
    if (occupied.has(k)) occ = Math.max(occ, occupied.get(k) + 1);

    const turn_hash = mintTurnHash({ thread: t.thread, text: t.text, occurrence: occ });
    const row = {
      turn_hash,
      thread: t.thread,
      // TWO TIMES, AND THEY ARE NOT THE SAME CLAIM.
      //
      // seen_at is the SCRAPE HEADER's scrapedAt — when the CONVERSATION was last read. Every
      // turn in one file carries the same value: measured 2026-08-28, 120 turns across 3
      // threads had exactly 3 distinct seen_at values, one per thread. Gemini's DOM carries no
      // per-turn timestamp, so this is the only time the scrape can supply and it can never
      // order turns within a conversation.
      //
      // first_seen_at is when THIS turn reached the tape. First-sight-wins makes it stable —
      // a turn is minted once and its mint time never moves — and it is unique per turn, so it
      // is the only signal that can give accretion an inter-turn interval. gemSkill lists that
      // interval as accretion's governing gauge with "no data"; the reason was structural, not
      // an unrun measurement, and this is what makes it measurable from here on.
      //
      // OUTSIDE THE CHAIN HASH by construction: linkHash covers
      // [prev, turn_hash, thread, seen_at, text, source]. Adding a field to the row must not
      // re-link 120 existing rows, and a guard asserts the chain still verifies.
      seen_at: t.seen_at || now(),
      first_seen_at: now(),
      role: t.role || null,
      text: t.text,
      source: t.source || 'gemini-web',
      occurrence: occ,
      prev,
    };
    prev = linkHash(row);
    lines.push(JSON.stringify(row));
    minted.push(row);
    known.set(idOf(t.thread, occ, t.text), turn_hash);
    occupied.set(k, occ);
    usedInBatch.set(k, occ + 1);
  }

  if (lines.length) {
    mkdirSync(dirname(file), { recursive: true });
    // Declare the session on first write, so the directory is a tape session rather than a
    // folder of ndjson the rest of the machinery cannot see.
    if (dirname(file) === TAPE_SESSION) ensureSession();
    appendFileSync(file, lines.join('\n') + '\n');
  }
  return { minted, seen };
}

/** The cursor is the thread's last turn_hash. Never a timestamp. */
export function cursorFor(thread, file = TAPE) {
  const rows = readTape(file).filter((r) => r.thread === thread);
  return rows.length ? rows[rows.length - 1].turn_hash : null;
}

/**
 * Everything after the cursor. An unknown cursor returns the WHOLE thread rather than
 * nothing: a cursor we cannot place is a cursor we cannot trust, and re-reading a thread
 * costs a cheap pass while silently returning zero turns loses work with no signal.
 */
export function turnsSince(thread, cursor, file = TAPE) {
  const rows = readTape(file).filter((r) => r.thread === thread);
  if (!cursor) return rows;
  const at = rows.findIndex((r) => r.turn_hash === cursor);
  return at < 0 ? rows : rows.slice(at + 1);
}

/** Walk the chain. Returns the first break, or ok when the record is intact. */
export function verifyChain(file = TAPE) {
  const rows = readTape(file);
  let prev = 'genesis';
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].prev !== prev) {
      return { ok: false, atLine: i + 1, turn_hash: rows[i].turn_hash,
               expected: prev, found: rows[i].prev };
    }
    prev = linkHash(rows[i]);
  }
  return { ok: true, rows: rows.length };
}

if (process.argv[1] && process.argv[1].endsWith('turn-identity.mjs')) {
  // A FLAG IS NEVER A VALUE. `--ingest --full` used to set the directory to "--full", which
  // does not exist, and ingestScrapedFiles returned zeros with exit 0 — so --full silently
  // scanned nothing and reported success on every run since it was added.
  const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    if (i < 0) return null;
    const v = process.argv[i + 1];
    return (v && !v.startsWith('--')) ? v : null;
  };
  if (process.argv.includes('--verify')) {
    const v = verifyChain();
    console.log(v.ok
      ? `chain intact — ${v.rows} turn(s)`
      : `CHAIN BROKEN at line ${v.atLine} (${v.turn_hash}): expected prev ${v.expected}, found ${v.found}`);
    process.exit(v.ok ? 0 : 1);
  } else if (process.argv.includes('--ingest')) {
    const dir = arg('--ingest') || resolve(HERE, '../../data/transcripts/gemini-web');
    const r = ingestScrapedFiles(dir, { stream: !process.argv.includes('--full') });
    console.log(`${r.files} file(s) · ${r.minted.length} new turn(s) · ${r.seen} already known`);
    // The new turns ARE the food. Printing them as ndjson lets a caller pipe them straight
    // into spec accretion without re-reading the tape or knowing where it lives.
    if (process.argv.includes('--emit')) for (const t of r.minted) console.log(JSON.stringify(t));
    const v = verifyChain();
    console.log(v.ok ? `chain intact — ${v.rows} turn(s)` : `CHAIN BROKEN at line ${v.atLine}`);
  } else if (arg('--cursor')) {
    console.log(cursorFor(arg('--cursor')) || '(no turns on that thread)');
  } else {
    const rows = readTape();
    const threads = [...new Set(rows.map((r) => r.thread))];
    const v = verifyChain();
    console.log(`${rows.length} turn(s) across ${threads.length} thread(s) · chain ${v.ok ? 'intact' : 'BROKEN'}`);
    for (const t of threads) console.log(`  ${t} -> cursor ${cursorFor(t)}`);
  }
}

/**
 * THE PRODUCER. A tape with no writer is a data structure, not a record.
 *
 * Reads the scraped JSONL — which is the durable artifact; sqlite is the derived index —
 * and mints each turn onto the tape at first sight. Re-running is free and idempotent:
 * every turn already seen comes back with the hash it was first given, so this can be
 * called on every scrape without re-presenting the backlog as new work.
 */

/**
 * The one door to the gemini-web dialect. Shells out to the on-chip reader rather than
 * re-implementing the shape — TAPE-CONTRACT Lane B: a .jsonl MUST go through pmu-onchip and
 * MUST NOT grow a second JS reader.
 *
 * Throws on refusal. That is the point: a dialect change must stop the ingest, not shorten it.
 */
export function readGeminiWeb(path) {
  const bin = resolvePmuBinary(resolve(HERE, '../..'));
  try {
    return JSON.parse(execFileSync(bin, ['--read-gemini-web', '--path', path],
      { encoding: 'utf8', maxBuffer: 1 << 28 }));
  } catch (e) {
    // stderr carries the refusal with the offending line number; surface it rather than the
    // generic "Command failed", which is the shape that gets read as "nothing there".
    const why = (e.stderr && String(e.stderr).trim()) || e.message;
    throw new Error(`gemini-web read refused: ${why}`);
  }
}

export function ingestScrapedFiles(dir, { file = TAPE, stream = true } = {}) {
  // "I did not look" and "I looked and saw nothing" are different claims. Returning zeros for
  // a directory that is not there collapsed them, and that is how a typo'd path read as a
  // clean run.
  if (!existsSync(dir)) throw new Error(`no such transcript directory: ${dir}`);

  // THE CURSOR IS PER FILE AND IT IS A BYTE OFFSET, matching the tape contract's own
  // ingest_cursor. Re-reading every scrape from byte zero is correct and idempotent —
  // first-sight-wins makes sure of that — but it is O(corpus) on every beat, and the beat
  // is every 60 seconds. The cursor makes it O(new), which is what "streaming" means here.
  //
  // A scrape REWRITES its file rather than appending: the scraper re-renders the whole
  // conversation each time. So a file that SHRANK, or whose size is below the cursor, is
  // re-read from zero rather than trusted — a stale cursor that skips turns is a silent
  // loss, and re-reading costs one pass.
  const cursors = readCursors(file);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const minted = [];
  let seen = 0, bytes = 0;

  for (const f of files) {
    const full = resolve(dir, f);
    const size = statSync(full).size;
    const prior = stream ? (cursors[f] || 0) : 0;
    if (stream && prior && size === prior) continue;          // untouched since last look
    const from = stream && size > prior ? 0 : 0;              // always parse whole: see below
    // The file is re-parsed in full even when only the tail is new, because a scrape
    // rewrites the document and the header — which carries the only timestamp — is at the
    // top. Parsing is microseconds; the cursor's job is to skip UNCHANGED files entirely,
    // which is where the actual cost is.
    // THE DIALECT IS READ ON THE CHIP. This used to be a hand-rolled JSON.parse loop, and it
    // was the SECOND one — transcript-ingest.mjs carried another. One string, two mirrors: a
    // shape change on Google's side had to be found and fixed twice, and neither copy would
    // have reported it, because both did `try { JSON.parse } catch { continue }` and returned
    // a shorter transcript with exit 0.
    //
    // pmu-onchip --read-gemini-web REFUSES on an unrecognised line, naming it. Verified
    // bit-identical to the loop it replaced across the whole corpus (4 files, 122 turns,
    // 2026-08-28) before the loop was deleted.
    //
    // The TYPE moved to Rust; the POLICY stayed here — seen_at is the header's scrapedAt and
    // means SEEN, never SAID, and that judgement is not the parser's to make.
    const g = readGeminiWeb(full);
    const thread = `gemini-web:${g.conversationId}`;
    const seenAt = g.scrapedAt || null;
    const turns = [];
    for (const t of g.turns) {
      if (!t.text) continue;
      // ROLE IS CARRIED. The chip reader returns it and this dropped it on the floor, which
      // made the tape INSUFFICIENT for the one question it will be asked — rebuild the index
      // from the record. The index has a role column; a projection that cannot answer the
      // question a later step will ask of it is a lossy summary wearing a record's name
      // (AXIOM 1, sufficiency). Outside the chain hash for the same reason first_seen_at is:
      // linkHash covers [prev, turn_hash, thread, seen_at, text, source] and 120 rows already
      // exist. That is a stated limitation, not an oversight — role is reproducible from the
      // scrape, so a tampered role is detectable by re-reading the .jsonl.
      turns.push({ thread, text: t.text, seen_at: seenAt, source: "gemini-web",
                   role: t.role || null });
    }
    if (turns.length) {
      const r = recordTurns(turns, { file });
      minted.push(...r.minted);
      seen += r.seen.length;
    }
    cursors[f] = size;
    bytes += size;
  }
  writeCursors(cursors, file);
  return { minted, seen, files: files.length, bytes };
}

/** The cursor lives in the session, beside the tape it describes. */
function cursorPath(file) { return resolve(dirname(file), "ingest-cursor.json"); }
function readCursors(file) {
  const f = cursorPath(file);
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; }
}
function writeCursors(c, file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(cursorPath(file), JSON.stringify(c, null, 2) + "\n");
}
