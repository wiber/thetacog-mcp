// scripts/vna/notary-queue.mjs — C85c THE OFFLINE QUEUE (goal 12 unit 4, 2026-09-18). The queue's ONE door.
// .thetacog/notary-queue.ndjson (VNA_NOTARY_QUEUE) is APPEND-ONLY: every row is a full state for one car_sha, and the state of a
// car_sha is its NEWEST row. Nothing here rewrites, truncates or deletes — a drained CAR is a new row with drained_at, and the
// file only grows (C85 invariant 3; W5: a gap would itself be a countable displacement).
//   queued   { car_sha, seq, pubkey, queued_at, attempts, last_error }             — a sync that could not reach the gateway
//   attempt  { …same, attempts: n+1, last_error }                                 — a drain that could not land it
//   drained  { car_sha, seq, pubkey, queued_at, attempts, drained_at, sequence_height, replay }
// The hook's fast path reads it (queueState → pending count, last attempt) and dispatchDrain spawns `tape-sync.mjs drain`
// DETACHED (never inline — hook-never-blocks), with a back-off gap so a dead endpoint is not re-hit on every prompt.
// @guard tests/vna/c85-offline-queue.test.mjs
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const QUEUE_FILE = process.env.VNA_NOTARY_QUEUE || resolve(REPO, '.thetacog/notary-queue.ndjson');
export const DRAIN_GAP_MS = Number(process.env.VNA_NOTARY_DRAIN_GAP_MS ?? 60_000);
// what counts as "cannot reach the gateway": a connection that never happened, a name that does not resolve, a timeout, or a
// 5xx from whatever sits in front. A cut mid-batch (UND_ERR_SOCKET / ECONNRESET) is NOT a partition — C74's cursor rule
// re-offers those CARs as free replays on the next run — and a 503 carrying the gateway's own `why` is a refusal, said, never queued.
const PARTITION_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);
export function isPartition({ transport, code, status, body } = {}) {
  if (transport) return PARTITION_CODES.has(code) || code === 'TimeoutError' || code === 'AbortError';
  if (typeof status === 'number' && status >= 500) return !(status === 503 && body && typeof body.why === 'string');
  return false;
}

export function readQueue(file = QUEUE_FILE) { try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && typeof r.car_sha === 'string'); } catch { return []; } }
// the projection: one state per car_sha (newest row wins); pending = not drained, in seq order
export function queueState(file = QUEUE_FILE) {
  const rows = readQueue(file); const last = new Map(); let lastAttemptAt = null;
  for (const r of rows) { last.set(r.car_sha, r); const t = Date.parse(r.drained_at || r.attempted_at || r.queued_at); if (Number.isFinite(t) && (lastAttemptAt == null || t > lastAttemptAt)) lastAttemptAt = t; }
  const states = [...last.values()];
  const pending = states.filter((r) => !r.drained_at).sort((a, b) => (a.seq - b.seq) || String(a.pubkey).localeCompare(String(b.pubkey)));
  return { rows: rows.length, pending, drained: states.length - pending.length, lastAttemptAt };
}
const append = (file, lines) => { if (!lines.length) return 0; mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, lines.map((r) => JSON.stringify(r)).join('\n') + '\n'); return lines.length; };

// a sync that could not reach the gateway: every CAR above the cursor becomes a queued row; one already pending gets an attempt row
export function enqueue(file, cars, { why, now = () => new Date().toISOString() } = {}) {
  const st = queueState(file); const pend = new Map(st.pending.map((r) => [r.car_sha, r])); const at = now();
  return append(file, cars.map((c) => { const p = pend.get(c.car_sha); return p ? { ...p, attempts: (p.attempts || 0) + 1, attempted_at: at, last_error: String(why).slice(0, 200) } : { car_sha: c.car_sha, seq: c.seq, pubkey: c.pubkey, queued_at: at, attempts: 0, last_error: String(why).slice(0, 200) }; }));
}
// a drain that could not land these rows (still pending, one more attempt, the reason)
export function markAttempt(file, pendingRows, why, now = () => new Date().toISOString()) { const at = now(); return append(file, pendingRows.map((p) => ({ ...p, attempts: (p.attempts || 0) + 1, attempted_at: at, last_error: String(why).slice(0, 200) }))); }
// a 200 for these rows — witnessed now, or already witnessed (replay): drained, never deleted
export function markDrained(file, pendingRows, receipts, now = () => new Date().toISOString()) { const at = now(); return append(file, pendingRows.map((p, i) => ({ ...p, drained_at: at, sequence_height: receipts[i] ? receipts[i].sequence_height : null, replay: !!(receipts[i] && receipts[i].replay) }))); }

// the hook's door: read the queue (fast), spawn the drain DETACHED when something is pending and the gap has passed
export function dispatchDrain({ queueFile = QUEUE_FILE, spawnFn = spawn, now = () => Date.now(), minGapMs = DRAIN_GAP_MS, lastAttemptAt = null, repo = REPO, env = process.env } = {}) {
  if (!existsSync(queueFile)) return { dispatched: false, why: 'no queue', pending: 0 };
  const st = queueState(queueFile); if (!st.pending.length) return { dispatched: false, why: 'empty', pending: 0 };
  const last = typeof lastAttemptAt === 'function' ? lastAttemptAt(st) : (lastAttemptAt ?? st.lastAttemptAt);
  if (Number.isFinite(last) && minGapMs > 0 && now() - last < minGapMs) return { dispatched: false, why: `backoff: last attempt ${Math.round((now() - last) / 1000)}s ago, gap ${Math.round(minGapMs / 1000)}s`, pending: st.pending.length };
  try {
    const c = spawnFn('node', [resolve(repo, 'scripts/vna/tape-sync.mjs'), 'drain'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...env, VNA_NOTARY_QUEUE: queueFile, VNA_BY: 'hook:drain' } });
    if (c && c.unref) c.unref();
    return { dispatched: true, pid: c && c.pid, pending: st.pending.length };
  } catch (e) { return { dispatched: false, why: String(e && e.message || e).slice(0, 80), pending: st.pending.length }; }
}
