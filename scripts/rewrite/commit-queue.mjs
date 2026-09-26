// scripts/rewrite/commit-queue.mjs — COMMITTING IS A BACKGROUND JOB, AND IT BATCHES.
//
// WHY (operator, 2026-08-12: "the comitting should be a backround process batched?" and, about the
// five edits that had just landed, "committed that unclear if it worked").
//
// accept() used to await `git add` + `git commit` + `rev-parse` inline. On a repo this size, with
// post-commit hooks that fan out receipts and email, that is seconds of dead time in the middle of a
// decision — and worse, it is seconds during which the writer cannot tell whether anything happened.
// The measured cost of a decision in this ledger is 57 minutes; none of it should be spent watching
// git. The write to the FILE is the irreversible part and stays synchronous. The commit is
// bookkeeping, and bookkeeping can be late.
//
// BATCHING. Five edits to chapter-08 in fifteen minutes produced five commits, each firing the whole
// post-commit pipeline. Grouped, that is one commit whose message names all five edits — better for
// the pipeline, better for `git log`, and identical in content. The queue groups by FILE, because a
// commit that spans two files is a commit whose message cannot honestly describe either.
//
// HONESTY ABOUT LATENCY. A queued edit is reported as `queued`, then `committed <sha>` when it lands,
// and `failed <reason>` if git refuses. The UI shows the depth. What must never happen is the state
// this replaced: silence, and a writer guessing.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const QUEUE_NAME = 'commit-queue.ndjson';

const readLines = (p) => {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};

/** Append one pending edit. Called from accept(), which has already written the file. */
export function enqueue(cacheDir, entry) {
  const p = path.join(cacheDir, QUEUE_NAME);
  fs.mkdirSync(cacheDir, { recursive: true });
  const row = { ts: new Date().toISOString(), state: 'queued', ...entry };
  fs.appendFileSync(p, JSON.stringify(row) + '\n');
  return row;
}

export function pending(cacheDir) {
  return readLines(path.join(cacheDir, QUEUE_NAME)).filter((r) => r.state === 'queued');
}

/** What the UI shows: how many are waiting, and what happened to the last one. */
export function queueStatus(cacheDir) {
  const rows = readLines(path.join(cacheDir, QUEUE_NAME));
  const wait = rows.filter((r) => r.state === 'queued');
  const done = rows.filter((r) => r.state !== 'queued');
  const last = done[done.length - 1] || null;
  return {
    pending: wait.length,
    oldestPendingTs: wait[0]?.ts || null,
    lastSha: last?.sha || null,
    lastState: last?.state || null,
    lastError: last?.error || null,
  };
}

function rewrite(cacheDir, rows) {
  fs.writeFileSync(path.join(cacheDir, QUEUE_NAME), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

/**
 * Commit everything queued for ONE file as a single commit. Returns {sha, n} or {error}.
 *
 * @param {object} o
 * @param {string} o.cacheDir   where the queue lives
 * @param {string} o.repoRoot   git root
 * @param {number} [o.minAgeMs] wait this long before committing, so a burst of edits rides together
 * @param {number} [o.maxBatch] never group more than this many into one message
 */
export async function drain({ cacheDir, repoRoot, minAgeMs = 12_000, maxBatch = 12, log = () => {} } = {}) {
  const all = readLines(path.join(cacheDir, QUEUE_NAME));
  const wait = all.filter((r) => r.state === 'queued');
  if (!wait.length) return { idle: true };

  // one file per commit; take the file whose oldest edit has been waiting longest.
  const byFile = new Map();
  for (const r of wait) { if (!byFile.has(r.relFile)) byFile.set(r.relFile, []); byFile.get(r.relFile).push(r); }
  const [relFile, rows] = [...byFile.entries()].sort((a, b) => new Date(a[1][0].ts) - new Date(b[1][0].ts))[0];

  // BURST WINDOW. A writer committing three sentences in a row means one commit, not three — so wait
  // for the burst to settle. A full batch goes immediately; there is nothing to gain by holding it.
  const age = Date.now() - new Date(rows[0].ts).getTime();
  if (age < minAgeMs && rows.length < maxBatch) return { waiting: rows.length, ageMs: age };

  const batch = rows.slice(0, maxBatch);
  const base = path.basename(relFile, path.extname(relFile));
  const lines = batch.map((r) => r.line).filter(Boolean);
  const tracks = [...new Set(batch.map((r) => r.winner).filter(Boolean))];

  const subject = batch.length === 1
    ? `rewrite(${base}): L${batch[0].line} via track ${batch[0].winner}`
    : `rewrite(${base}): ${batch.length} edits · L${lines.join(', L')} via ${tracks.join(',')}`;

  const body = batch.map((r) => [
    `── L${r.line} · track ${r.winner}${r.via ? ` · via ${r.via}` : ''}`,
    r.monologue ? `Reader-Monologue: ${r.monologue}` : null,
    r.defect ? `Defect: ${r.defect} (comprehension ${r.score}/100)` : null,
    r.drift || 'Tesseract-Drift: unmeasured',
    r.lattice || null,
    r.offered ? `Offered: ${r.offered}` : null,
    '',
    `was: ${r.was}`,
    `now: ${r.now}`,
  ].filter(Boolean).join('\n')).join('\n\n');

  try {
    await execFileAsync('git', ['add', '--', relFile], { cwd: repoRoot });
    // Nothing staged (the file was reverted, or an earlier drain already took it) is not an error.
    const { stdout: staged } = await execFileAsync('git', ['diff', '--cached', '--name-only', '--', relFile], { cwd: repoRoot });
    if (!staged.trim()) {
      const done = all.map((r) => (batch.includes(r) ? { ...r, state: 'nothing-to-commit' } : r));
      rewrite(cacheDir, done);
      log(`   commit queue: nothing staged for ${relFile} — ${batch.length} edit(s) marked resolved`);
      return { nothingToCommit: batch.length };
    }
    await execFileAsync('git', ['commit', '-m', subject, '-m', body, '--', relFile], { cwd: repoRoot });
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
    const sha = stdout.trim();
    const done = all.map((r) => (batch.includes(r) ? { ...r, state: 'committed', sha } : r));
    rewrite(cacheDir, done);
    log(`   commit queue: ${batch.length} edit(s) → ${sha}`);
    return { sha, n: batch.length, relFile };
  } catch (e) {
    const error = String(e?.stderr || e?.message || e).slice(0, 300);
    // A failed commit must not spin forever: mark it failed, keep the edit on disk, tell the writer.
    const done = all.map((r) => (batch.includes(r) ? { ...r, state: 'failed', error } : r));
    rewrite(cacheDir, done);
    log(`   commit queue: FAILED — ${error}`);
    return { error, n: batch.length };
  }
}
