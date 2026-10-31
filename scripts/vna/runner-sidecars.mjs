#!/usr/bin/env node
// scripts/vna/runner-sidecars.mjs — ONE APPEND-ONLY DAY TAPE INSTEAD OF A LOOSE FILE PER DISPATCH SIDECAR.
//
// Operator 2026-10-18: "fix whatever caused the 900 or so files" / standing ask 2026-10-15: "they need to be editing
// tapes, not generating thousands of new files". The runner (steer-runner.mjs) and the chat door
// (brief-predicts-commit.mjs stampChatBrief) each wrote one small file per dispatch per sidecar kind
// (<n>-<label>.round.ndjson, .round-named.json, .drift-note.txt, .c612i.json, .c612i.bound.ndjson, .snowball.txt) —
// ~540 of them sitting untracked, ~690 more swept into git by accident on bulk "commit the pending state" days. They
// ARE records (.thetacog/runner.ndjson rows point at them by path + sha256 — brief-predicts-commit.mjs
// stampChatBrief), so AXIOM 1 forbids gitignoring them away or deleting one with no tape row to replace it. This
// module gives every caller ONE home instead: <dir>/sidecars-<YYYY-MM-DD>.ndjson, one row per sidecar =
// {name, at, sha256, body}. Text, not gzip — git stores an append as a small delta, never a whole-file rewrite.
//
// WHAT STAYS A LOOSE FILE (deliberately, never routed through this module):
//   - round.ndjson / c612i.json / c612i.bound.ndjson / c612i.*.lock / c612i.pending WHILE A ROUND IS LIVE — C612g/
//     C612i's return-reading.mjs hook appends and rewrites these from a FRESH SUBPROCESS on every Edit/Write/
//     MultiEdit/NotebookEdit the worker makes, single-flight-locked, inside a measured ~150 ms hook budget. Routing
//     that hot path through a day-tape (a scan for "does this name already exist" before every write) would blow
//     the budget and risk the live hook every concurrent session on this shared tree depends on. These five are
//     folded onto the tape EXACTLY ONCE, by closeDispatchSidecars below, after the round is over (the worker has
//     exited and the verdict is recorded) — never mid-round.
//   - <n>-<label>.snowball.txt WHILE THE WORKER IS RUNNING, for a non-default (goose-local / qwen-local) engine: the
//     worker is an EXTERNAL BINARY invoked by a shell command that names this exact path (steer-runner.mjs
//     enginePlan → resolveEngineCommand); it must exist as a real file for that process to read. Folded onto the
//     tape (and removed) by the SAME closeDispatchSidecars call, once the worker has exited.
//   - leaf-<label>.json — a CURRENT-STATE pin (steer-runner.mjs leafPin), rewritten in place per dispatch of that
//     label and read by a DIFFERENT process (the spawned worker, via VNA_ACTIVE_LEAF) that needs the exact path, not
//     a tape row. leaf-<label>.forecast.json was already folded into one append log per runner dir (C806,
//     brief-forecast.mjs forecastPath → forecasts.ndjson) before this module existed — nothing left to do there.
//
// writeSidecar refuses to overwrite an existing name with DIFFERENT bytes — the 0444 never-overwrite semantics a
// loose snowball.txt used to carry by filesystem permission, now carried by the module instead. The SAME bytes
// written twice (a retried fold, an idempotent re-run) is a no-op, never a second row.
//
// @guard tests/vna/runner-sidecars-are-tapes.test.mjs
import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const TAPE_RE = /^sidecars-(\d{4}-\d{2}-\d{2})\.ndjson$/;
export const sha256Hex = (s) => createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');
export const tapePath = ({ dir, date = new Date() }) => join(dir, `sidecars-${date.toISOString().slice(0, 10)}.ndjson`);

/** Every sidecar tape in dir, newest day first (the read order — a recent row is almost always what a caller wants). */
function tapeFiles(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((f) => TAPE_RE.test(f)); } catch { return []; }
  return names.sort().reverse().map((f) => join(dir, f));
}

/** Every parsed row in one tape file; a corrupt line is skipped, never thrown (AXIOM 1: the other rows are still the record). */
function* rowsOf(file) {
  let text = ''; try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object') yield r; } catch { /* skip */ }
  }
}

/** Every row across every tape in dir carrying this exact name, in write order (oldest tape day first). */
function rowsFor(dir, name) {
  const out = [];
  for (const f of [...tapeFiles(dir)].reverse()) for (const r of rowsOf(f)) if (r.name === name) out.push(r);
  return out;
}

/**
 * writeSidecar — append ONE row {name, at, sha256, body} to the tape in `dir`. Refuses to overwrite an existing
 * name whose last row carries DIFFERENT bytes (throws); the same bytes written again is a no-op (duplicate: true,
 * no new row — an idempotent retry of a fold or a dispatch never doubles the tape). `at` (an ISO instant) names the
 * row's own timestamp and, by default, which day's tape file it lands on — the backfill passes the loose file's own
 * mtime here so a year-old sidecar lands on that day's tape, never today's.
 */
export function writeSidecar({ dir, name, body, at = null }) {
  if (!dir || !name) throw new Error('writeSidecar needs { dir, name, body }');
  const text = body == null ? '' : String(body);
  const sha = sha256Hex(text);
  const prior = rowsFor(dir, name);
  if (prior.length) {
    const last = prior[prior.length - 1];
    if (last.sha256 === sha) return { tape: null, sha256: sha, at: last.at, duplicate: true };
    throw new Error(`writeSidecar refuses to overwrite "${name}" — the tape already carries it with different bytes (sha256 ${last.sha256} ≠ ${sha})`);
  }
  mkdirSync(dir, { recursive: true });
  const atIso = at || new Date().toISOString();
  const tape = tapePath({ dir, date: new Date(atIso) });
  appendFileSync(tape, `${JSON.stringify({ name, at: atIso, sha256: sha, body: text })}\n`);
  return { tape, sha256: sha, at: atIso, duplicate: false };
}

/**
 * readSidecar — the body recorded for `name`: the tape row if one exists, else (THE DRAIN FALLBACK, for a sidecar
 * not yet folded, or written before this module existed) the still-loose file at <dir>/<name>, else null.
 */
export function readSidecar({ dir, name }) {
  const rows = rowsFor(dir, name);
  if (rows.length) return rows[rows.length - 1].body;
  const loose = join(dir, name);
  try { if (existsSync(loose)) return readFileSync(loose, 'utf8'); } catch { /* fall through to null */ }
  return null;
}

/** The sha256 the tape (or, in the drain, the loose file) carries for `name` — null when neither has it. */
export function sidecarSha256({ dir, name }) {
  const rows = rowsFor(dir, name);
  if (rows.length) return rows[rows.length - 1].sha256;
  const loose = join(dir, name);
  try { return existsSync(loose) ? sha256Hex(readFileSync(loose, 'utf8')) : null; } catch { return null; }
}

/** The ISO timestamp the tape recorded for `name` (the fold's `at`, not the original write's) — null when the name is not on the tape. */
export function sidecarAt({ dir, name }) {
  const rows = rowsFor(dir, name);
  return rows.length ? rows[rows.length - 1].at : null;
}

/** listSidecars — every distinct name on the tape, merged with any name still loose on disk (the drain), optionally
 *  narrowed to names starting with `prefix`. Sorted. This is the directory listing a caller used to get from
 *  readdirSync(dir).filter(...) before a fold could make the file disappear from disk. */
export function listSidecars({ dir, prefix = '' } = {}) {
  const names = new Set();
  for (const f of tapeFiles(dir)) for (const r of rowsOf(f)) if (typeof r.name === 'string') names.add(r.name);
  try { for (const ent of readdirSync(dir, { withFileTypes: true })) if (ent.isFile() && !TAPE_RE.test(ent.name)) names.add(ent.name); } catch { /* dir absent */ }
  return [...names].filter((n) => n.startsWith(prefix)).sort();
}

/**
 * foldAndRemove — read the loose file at <dir>/<name>, write it to the tape (dated by the file's own mtime when
 * `useMtime` is set — the backfill's case), READ IT BACK off the tape and check the bytes are byte-equal before
 * removing the loose copy (AXIOM 1: never evict a record until the replacement is verified, not merely written).
 * Never throws past the write itself (a collision — the name is already on the tape with different bytes — bubbles
 * so the caller can record it as a per-name error, never a silent loss); returns null when there is no loose file
 * to fold (already folded, or never written).
 */
export function foldAndRemove({ dir, name, useMtime = false }) {
  const p = join(dir, name);
  let text = null, at = null;
  try {
    if (!existsSync(p)) return null;
    text = readFileSync(p, 'utf8');
    if (useMtime) at = new Date(statSync(p).mtimeMs).toISOString();
  } catch { return null; }
  const w = writeSidecar({ dir, name, body: text, at });
  const back = readSidecar({ dir, name });
  if (back !== text) throw new Error(`foldAndRemove: round-trip mismatch for "${name}" — the tape row does not read back byte-equal, refusing to remove the loose file`);
  try { unlinkSync(p); } catch { /* best effort — the tape row already carries the record; a stray file is a later drain's job */ }
  return { name, sha256: w.sha256, tape: w.tape, duplicate: w.duplicate };
}

// The five runner sidecars folded at a dispatch's close (round.ndjson and the c612i.* pair stay loose WHILE the round
// runs — see the file header) — never renamed here; the stem matches round-sidecar.mjs (roundSidecarPath/
// roundNamedPath), drift-note.mjs (driftNotePath) and return-reading.mjs's own `${stem}.c612i...` build.
//
// <n>-<label>.snowball.txt is DELIBERATELY NOT folded here, even though enginePlan writes one for a non-default
// (goose-local/qwen-local) engine: tests/vna/c213-every-dispatch-proves-its-tree-and-snowball.test.mjs T6 tampers
// with that exact file AFTER run() returns to prove c213VerdictFields catches a rewritten sidecar — a real,
// deliberate use of the loose file as a durable, re-checkable artifact past the dispatch's own close. It is also not
// part of the active git-status bloat this module exists to stop (every <n>-<label>.snowball.txt already in the
// tree today is already-committed, unchanging history — the chat door's own writer, stampChatBrief in
// brief-predicts-commit.mjs, goes straight to the tape with no loose file at all, since nothing reads it as a path).
// The historical loose ones are folded once, by the backfill (scripts/ops/backfill-runner-sidecars.mjs), not here.
export const closeNames = (stem) => [`${stem}.round.ndjson`, `${stem}.round-named.json`, `${stem}.drift-note.txt`, `${stem}.c612i.json`, `${stem}.c612i.bound.ndjson`];

/**
 * closeDispatchSidecars — fold every sidecar a dispatch (label, n) left loose in `dir` onto the tape and remove the
 * loose copy. Call this ONCE, after the round is truly over (the worker has exited and the dispatch's verdict is
 * recorded) — never mid-round (see the file header for why). Never throws: a per-name failure (a name collision
 * with different bytes) is recorded in `errors`, not raised, so a sidecar fold never halts a dispatch.
 */
export function closeDispatchSidecars({ dir, label, n = null }) {
  const stem = `${n != null ? `${n}-` : ''}${label}`;
  const migrated = [], errors = [];
  for (const name of closeNames(stem)) {
    try { const r = foldAndRemove({ dir, name }); if (r) migrated.push(r); }
    catch (e) { errors.push({ name, why: String((e && e.message) || e).slice(0, 160) }); }
  }
  return { migrated, errors };
}
