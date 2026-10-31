#!/usr/bin/env node
// C170a leg 1 — ONE FOLD WRITER, AND A WATERMARK THAT COSTS A FEW HUNDRED BYTES TO READ.
//
// THE INCIDENT (2026-09-22, audit): dispatchFold treated a fold alive past 30 min as "hung" and started a SECOND fold on
// top of it — two writers on data/vna/spec-tree.json for 35+ min, until the chair SIGTERMed the older pid 48140 by hand.
// The fold was not hung: a 2.96 MB tape row ran one fold over 33 min. And the runner's gate-5 fold (execFileSync of the
// same argv) never looked at the lock at all, so it was a third possible writer. Separately the hook JSON.parsed the
// 57 MB tree on every turn to read ONE integer (the watermark), and clear-gauge's readLose did the same again.
//
// THE CONTRACT this file holds, one place:
//   · a LIVE fold (alive pid that IS a spec-tree fold) holds the lock at ANY age — it is never overtaken, never doubled;
//   · a fold past FOLD_BUDGET_MS is REPORTED (one `over-budget` receipt row per pid), not replaced;
//   · a DEAD pid — or a live pid that is not a fold (pid reuse) — is a stale lock and is reclaimed, receipted;
//   · the fold itself CLAIMS the lock before it writes (claimFoldLock), so every spawn site — the hook, the runner's gate 5,
//     a hand run — is one writer, not only the ones that went through dispatchFold;
//   · the watermark lives in a sidecar (<tree>.watermark.json) that writeTree lands beside the tree; readers never parse
//     the tree to learn it.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync, openSync, closeSync, writeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');

export const FOLD_LOCK = process.env.VNA_FOLD_LOCK || resolve(REPO, '.thetacog/vna-fold.lock');
export const FOLD_RECEIPT = process.env.VNA_FOLD_RECEIPT || resolve(REPO, '.thetacog/vna-fold-dispatch.ndjson');
// the budget is a REPORTING threshold, never an overtake threshold (C170a leg 1)
export const FOLD_BUDGET_MS = Number(process.env.VNA_FOLD_BUDGET_MS || process.env.VNA_FOLD_HUNG_MS) || 30 * 60000;
const LIVE_TREE = resolve(REPO, 'data/vna/spec-tree.json');
// the live tree folds under the one lock the hook dispatches against; a fixture tree gets its own sibling lock
export const foldLockFor = (treePath) => resolve(treePath) === LIVE_TREE ? FOLD_LOCK : String(treePath).replace(/\.json$/, '') + '.fold.lock';

const alive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// pid reuse: an alive pid is a fold only when its command line runs spec-tree.mjs. One `ps`, bounded, only on the rare paths.
export function pidIsFold(pid) {
  try { return /spec-tree\.mjs/.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 })); } catch { return false; }
}
const readLock = (lock) => { try { return JSON.parse(readFileSync(lock, 'utf8')); } catch { return null; } };
const receiptRow = (receipt, row) => { try { mkdirSync(dirname(receipt), { recursive: true }); appendFileSync(receipt, JSON.stringify(row) + '\n'); } catch {} };

// The lock's state, read-only. `isFold` is injectable so a guard can stand a live non-fold pid in for a fold.
export function foldLockState(lock = FOLD_LOCK, { now = Date.now(), budgetMs = FOLD_BUDGET_MS, isFold = pidIsFold, self = process.pid } = {}) {
  const l = readLock(lock);
  if (!l) return { state: 'free', lock: null };
  if (l.pid === self) return { state: 'mine', lock: l };
  const ageMs = Math.max(0, now - (Date.parse(l.at) || 0));
  if (!alive(l.pid)) return { state: 'stale', why: 'dead pid', pid: l.pid, ageMs, lock: l };
  // a live pid past the budget: prove it is still a fold before treating it as one (a reused pid is a stale lock)
  if (ageMs >= budgetMs && !isFold(l.pid)) return { state: 'stale', why: 'pid alive but not a fold (reused)', pid: l.pid, ageMs, lock: l };
  return { state: ageMs >= budgetMs ? 'over-budget' : 'live', pid: l.pid, ageMs, lock: l };
}

// Report a fold over its budget ONCE per pid (the mark rides the lock file), never by starting another.
export function reportOverBudget(st, { lock = FOLD_LOCK, receipt = FOLD_RECEIPT, now = Date.now(), by = 'dispatch' } = {}) {
  if (!st || st.state !== 'over-budget' || st.lock.overBudgetReportedAt) return false;
  receiptRow(receipt, { at: new Date(now).toISOString(), kind: 'over-budget', pid: st.pid, ageS: Math.round(st.ageMs / 1000), budgetS: Math.round(FOLD_BUDGET_MS / 1000), by, action: 'reported, not doubled' });
  try { writeFileSync(lock, JSON.stringify({ ...st.lock, overBudgetReportedAt: new Date(now).toISOString() })); } catch {}
  return true;
}

// The fold's own claim: exclusive create, a stale lock unlinked first, a live foreign fold waited on (bounded) and then refused.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function claimFoldLock(lock = FOLD_LOCK, { waitMs = 0, pollMs = 500, receipt = FOLD_RECEIPT, isFold = pidIsFold, by = 'fold', now = () => Date.now() } = {}) {
  const t0 = now(); let reclaimed = null;
  for (;;) {
    const st = foldLockState(lock, { now: now(), isFold });
    if (st.state === 'mine') return { ok: true, pid: process.pid, dispatched: true };   // dispatchFold wrote our pid before we ran
    if (st.state === 'stale') { reclaimed = st.pid; try { unlinkSync(lock); } catch {} }
    if (st.state === 'free' || st.state === 'stale') {
      try {
        mkdirSync(dirname(lock), { recursive: true });
        const fd = openSync(lock, 'wx'); writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString(), by })); closeSync(fd);
        if (reclaimed != null) receiptRow(receipt, { at: new Date(now()).toISOString(), kind: 'reclaimed', pid: process.pid, reclaimed, by });
        return { ok: true, pid: process.pid, reclaimed };
      } catch { continue; }   // another claimant won the create between our read and our open — read again
    }
    if (st.state === 'over-budget') reportOverBudget(st, { lock, receipt, now: now(), by });
    if (now() - t0 >= waitMs) {
      receiptRow(receipt, { at: new Date(now()).toISOString(), kind: 'refused-held', pid: process.pid, heldBy: st.pid, heldS: Math.round(st.ageMs / 1000), by });
      return { ok: false, heldBy: st.pid, ageMs: st.ageMs, why: `fold held by live pid ${st.pid} (${Math.round(st.ageMs / 1000)} s) — one writer; not doubled` };
    }
    sleepSync(Math.min(pollMs, Math.max(1, waitMs - (now() - t0))));
  }
}
export function releaseFoldLock(lock = FOLD_LOCK) { const l = readLock(lock); if (l && l.pid === process.pid) { try { unlinkSync(lock); } catch {} } }

// ── THE WATERMARK SIDECAR ───────────────────────────────────────────────────────────────────────
export const watermarkPath = (treePath) => String(treePath).replace(/\.json$/, '') + '.watermark.json';
// deterministic (no timestamp) so an unchanged tree leaves the sidecar byte-identical
// `scanned` (2026-09-23 memory storm): the last GLOBAL ledger index the fold read through. `watermark` is the last row of the
// tree's OWN source, so rows other sources append (transcript:*) sit past it forever — the gate read "7 behind" on every turn,
// dispatched a 2–3.5 GB fold every 20–60 s that could never catch up, and the machine ran out of memory. Every source row
// ≤ scanned is in the tree, so the gate measures behind from max(watermark, scanned).
export const watermarkOf = (tree, scanned = null) => ({
  watermark: Number.isInteger(tree && tree.watermark) ? tree.watermark : -1,
  ...(Number.isInteger(scanned) ? { scanned } : {}),
  root: (tree && tree.root) || null,
  source: (tree && tree.source) || null,
  ingested: tree && Array.isArray(tree.ingested) ? tree.ingested.length : 0,
  nodes: tree && tree.nodes ? Object.keys(tree.nodes).length : 0,
  rootGzip: tree && tree.nodes && tree.nodes.root && tree.nodes.root.mass ? (tree.nodes.root.mass.gzip || 0) : 0,
});
export const watermarkJson = (tree, scanned = null) => JSON.stringify(watermarkOf(tree, scanned)) + '\n';
// the index the gate measures "behind" from — a sidecar written before `scanned` existed falls back to the watermark
export const foldedThrough = (w) => (w ? Math.max(w.watermark, Number.isInteger(w.scanned) ? w.scanned : -1) : -1);
// null when there is no sidecar — the caller decides (dispatchFold: behind, fold it; never a parse of the tree)
export function readWatermark(treePath) { try { const w = JSON.parse(readFileSync(watermarkPath(treePath), 'utf8')); return Number.isInteger(w.watermark) ? w : null; } catch { return null; } }
