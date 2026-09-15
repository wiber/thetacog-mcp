// packages/thetacog-mcp/scripts/tape/harvest.mjs — PULL THE LAST X HOURS OF CLAUDE TRANSCRIPTS INTO A TAPE.
//
// Operator, 2026-08-20: "it has to have the claude transcripts copy to memory last x hours as a feature as well."
//
// The GDDadwill lane answers "here is a document, walk it". This answers the other half: "here is
// what I have actually been doing since this morning, walk THAT" — the session's own working memory,
// harvested on demand, so a tape can be built out of the last six hours of real work rather than out
// of a file somebody remembered to save.
//
// ── LANE B, AND WHY THERE IS NO JS READER HERE ────────────────────────────────────────────────
// A Claude Code transcript is heterogeneous NDJSON where single lines reach multi-MB (embedded
// tool_result dumps) and single files reach 40MB+. The Rust walker ALREADY reads them, incrementally,
// frame-shaped, with a replayable byte cursor:
//     pmu-onchip --ingest-transcript --path <file.jsonl> --offset <N> --json
//   → { firstUserPrompt, intentThinking[], reality[], lineCount, newOffset, userPrompts[] }
// (userPrompts[] added 2026-08-20 — ALL qualifying operator prompts, additive alongside the four
// original fields which keep their exact prior shape/values; see transcript.rs all_user_prompts().)
// It already splits a transcript into INTENT and REALITY claims — precisely the split the tape needs —
// and its own header names its acceptance gate (bit-identical to the Node reference in
// scripts/pmu/resident-watch.mjs). MEASURED on this machine: 41,951,239 bytes → 12,939 lines → 927
// reality claims in 0.30s; a 200KB incremental tail in 0.02s. ~140 MB/s.
//
// TAPE-CONTRACT.md therefore BANS a JS transcript reader in /tape, for the same reason the analytic
// walk is banned: the running code exists and it is on the metal. This file shells out. It does not
// parse JSONL itself, ever.
//
// ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────────────────────────
// It does not summarize, score, or judge. It copies + segments + records provenance. Atom extraction
// is the atomizer's job (one turn per model call) and placement is physics.mjs's — both downstream,
// both unchanged by where the text came from.
//
//   node packages/thetacog-mcp/scripts/tape/harvest.mjs --hours 6 [--slug <name>] [--project <dir>]
//                                                        [--max-files N] [--dry-run] [--json]

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

// The Rust binary — the ONLY reader of .jsonl in this pipeline.
const BINARIES = [
  resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip'),
  resolve(PKG, 'pmu-rust/target/release/pmu-onchip'),
];
export function findBinary() {
  for (const b of BINARIES) if (existsSync(b)) return b;
  return null;
}

/** The Claude project transcript dir for a repo path (Claude dashes the absolute path). */
export function projectDir(repoPath = REPO) {
  return join(homedir(), '.claude', 'projects', String(repoPath).replace(/\//g, '-'));
}

/** Transcripts touched within the window, newest first. Pure filesystem — no parsing. */
export function recentTranscripts(dir, hours, { maxFiles = 0 } = {}) {
  if (!existsSync(dir)) return { dir, files: [], reason: `no transcript dir at ${dir}` };
  const cutoff = Date.now() - hours * 3600 * 1000;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => { const p = join(dir, f); const s = statSync(p); return { path: p, mtime: s.mtimeMs, bytes: s.size }; })
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);
  return { dir, files: maxFiles > 0 ? files.slice(0, maxFiles) : files, reason: null };
}

/** Read ONE transcript through the Rust ingest, from a byte offset. Never parses JSONL in JS. */
export function ingestOne(binary, path, offset = 0) {
  const t0 = Date.now();
  let raw;
  try {
    raw = execFileSync(binary, ['--ingest-transcript', '--path', path, '--offset', String(offset), '--json'],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, reason: `rust ingest failed: ${String(e.message).slice(0, 200)}` };
  }
  let j;
  try { j = JSON.parse(raw); } catch { return { ok: false, reason: 'rust ingest returned unparseable json' }; }
  return {
    ok: true, ms: Date.now() - t0,
    firstUserPrompt: j.firstUserPrompt || '',
    intent: Array.isArray(j.intentThinking) ? j.intentThinking : [],
    // userPrompts is the FIX (2026-08-20): the Rust ingest now returns EVERY qualifying operator
    // prompt in the transcript, not just the first — see .thetacog/pmu/src/transcript.rs
    // all_user_prompts(). Falls back to [firstUserPrompt] for a binary built before the fix
    // landed, so an unbuilt/stale binary degrades to the old behaviour instead of losing intent.
    userPrompts: Array.isArray(j.userPrompts) ? j.userPrompts : (j.firstUserPrompt ? [j.firstUserPrompt] : []),
    reality: Array.isArray(j.reality) ? j.reality : [],
    lineCount: j.lineCount ?? null,
    newOffset: j.newOffset ?? offset,
  };
}

export function harvest({ hours = 6, slug = null, project = REPO, maxFiles = 0, dryRun = false } = {}) {
  const binary = findBinary();
  if (!binary) {
    return { ok: false, reason: 'pmu-onchip not built — the Rust ingest is the only sanctioned .jsonl reader, so harvesting is UNMEASURED rather than falling back to a JS parser' };
  }
  const dir = projectDir(project);
  const { files, reason } = recentTranscripts(dir, hours, { maxFiles });
  if (reason) return { ok: false, reason };
  if (!files.length) return { ok: true, slug: null, files: [], turns: 0, note: `no transcripts touched in the last ${hours}h under ${dir}` };

  const theSlug = slug || `harvest-${hours}h`;
  const sdir = resolve(SESSIONS, theSlug);
  const sessionFile = resolve(sdir, 'session.json');
  // INCREMENTAL BY CONSTRUCTION: an existing session keeps its per-source cursor, so re-harvesting
  // extends the tape instead of re-walking what it already placed.
  const prior = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, 'utf8')) : null;
  const cursors = { ...(prior?.ingest_cursor || {}) };

  const turns = [];
  const perFile = [];
  let totalMs = 0;
  for (const f of files) {
    const from = cursors[f.path] || 0;
    if (from >= f.bytes) { perFile.push({ path: f.path, skipped: 'no new bytes since last harvest', from }); continue; }
    const r = ingestOne(binary, f.path, from);
    if (!r.ok) { perFile.push({ path: f.path, error: r.reason }); continue; }
    totalMs += r.ms;
    cursors[f.path] = r.newOffset;

    const sid = basename(f.path, '.jsonl');
    // INTENT side feeds extraction. REALITY side is held for enforcement — different measurements,
    // and the contract forbids conflating them. Both are captured, each tagged with its side, so a
    // downstream consumer can never pick up one thinking it is the other.
    //
    // FIXED 2026-08-20 (was: only firstUserPrompt, ONE per file, starved the intent side against
    // hundreds of reality claims). `--ingest-transcript` now returns `userPrompts[]` — EVERY
    // qualifying operator prompt in the transcript, in order — additively, alongside the unchanged
    // firstUserPrompt/intentThinking/reality/lineCount/newOffset (see transcript.rs
    // all_user_prompts()). This stays the single bit-identical Rust reader; no JS parser was added,
    // per TAPE-CONTRACT.md's ban on a second .jsonl reader.
    r.intent.forEach((t, i) => turns.push({
      index: turns.length, role: 'operator', source: f.path, sessionId: sid,
      startLine: i + 1, endLine: i + 1, text: String(t), side: 'intent',
    }));
    r.userPrompts.forEach((t, i) => turns.push({
      index: turns.length, role: 'operator', source: f.path, sessionId: sid,
      startLine: 0, endLine: 0, text: String(t), side: 'intent', firstPrompt: i === 0,
    }));
    r.reality.forEach((t, i) => {
      const text = String(t);
      if (text.trim().length < 120) return;   // below the aperture floor — no mass to place
      turns.push({
        index: turns.length, role: 'assistant', source: f.path, sessionId: sid,
        startLine: i + 1, endLine: i + 1, text, side: 'reality',
      });
    });
    perFile.push({
      path: f.path, sessionId: sid, from, to: r.newOffset,
      bytes: r.newOffset - from, lines: r.lineCount,
      intentClaims: r.intent.length + r.userPrompts.length, realityClaims: r.reality.length, ms: r.ms,
    });
  }

  if (dryRun) return { ok: true, dryRun: true, slug: theSlug, dir, files: perFile, turns: turns.length, ms: totalMs };

  mkdirSync(sdir, { recursive: true });
  const session = {
    version: 1, slug: theSlug,
    sources: files.map((f) => f.path),
    createdAt: prior?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cursor: 0, totalTurns: turns.length, totalLines: perFile.reduce((a, p) => a + (p.lines || 0), 0),
    home: prior?.home || { coord: null, reason: 'no atoms placed yet' },
    stats: prior?.stats || { atoms: 0, picked: 0, dropped: 0, decided: 0, dispatched: 0, done: 0, contradictions: 0 },
    paused: false, steering: prior?.steering || [],
    ingest_cursor: cursors,
    ingest: { lane: 'B (rust --ingest-transcript)', binary, hours, harvestedAt: new Date().toISOString() },
    extraction: 'not yet run — turns harvested, atoms pending',
    // intentStarved REMOVED 2026-08-20 — the reader limitation it named ("only firstUserPrompt per
    // file, intentThinking empty") is fixed: `--ingest-transcript` now returns userPrompts[], every
    // qualifying operator prompt, not just the first (transcript.rs all_user_prompts()). MEASURED
    // on this repo's own 8-transcript/6h sample: intent turns went 8 → 53 against reality holding at
    // ~260-270, i.e. exposure went from ~3% to ~20% of reality's volume. `sides` below is left as a
    // plain measurement — reality still outweighs intent because an assistant naturally emits far
    // more text per turn than an operator types, which is conversation shape, not a reader defect,
    // so no flag claims starvation on its behalf.
    sides: { intent: turns.filter((t) => t.side === 'intent').length, reality: turns.filter((t) => t.side === 'reality').length },
  };
  writeFileSync(sessionFile, JSON.stringify(session, null, 2) + '\n');
  writeFileSync(resolve(sdir, 'turns.json'), JSON.stringify(turns, null, 2) + '\n');
  for (const f of ['specs.ndjson', 'decisions.ndjson', 'dispatches.ndjson', 'vega-series.ndjson']) {
    if (!existsSync(resolve(sdir, f))) writeFileSync(resolve(sdir, f), '');
  }
  appendFileSync(resolve(sdir, 'harvest-log.ndjson'),
    JSON.stringify({ ts: new Date().toISOString(), hours, files: perFile.length, turns: turns.length, ms: totalMs }) + '\n');

  return { ok: true, slug: theSlug, dir: sdir, files: perFile, turns: turns.length, ms: totalMs, sources: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const out = harvest({
    hours: parseFloat(arg('--hours', '6')) || 6,
    slug: arg('--slug', null),
    project: arg('--project', REPO),
    maxFiles: parseInt(arg('--max-files', '0'), 10) || 0,
    dryRun: process.argv.includes('--dry-run'),
  });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 2); }
  if (!out.ok) { console.error('✗ ' + out.reason); process.exit(2); }
  if (out.note) { console.log(out.note); process.exit(0); }
  const live = out.files.filter((f) => !f.skipped && !f.error);
  console.log(`\n  harvest · ${out.slug}${out.dryRun ? '  (dry run)' : ''}`);
  console.log(`  ${live.length} transcript(s) read · ${out.turns} intent turns · ${out.ms}ms  (lane B — rust --ingest-transcript)`);
  for (const f of live.slice(0, 12)) {
    console.log(`    ${String(f.sessionId || '').slice(0, 8)}  ${String(f.lines ?? '?').padStart(6)} lines  ${String(f.intentClaims).padStart(4)} intent  ${String(f.realityClaims).padStart(4)} reality  ${String(f.ms).padStart(4)}ms`);
  }
  const skipped = out.files.filter((f) => f.skipped).length;
  const errored = out.files.filter((f) => f.error);
  if (skipped) console.log(`    ${skipped} unchanged since last harvest (cursor held — incremental, not re-walked)`);
  for (const e of errored) console.log(`    ✗ ${basename(e.path)}: ${e.error}`);
  console.log(`\n  next:  node packages/thetacog-mcp/scripts/tape/cli.mjs status ${out.slug}\n`);
}
