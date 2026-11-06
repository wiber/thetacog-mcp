#!/usr/bin/env node
// scripts/delegation/qc-flush.mjs — THE QC EMITTER COMMITS ITS OWN ROWS. commit-triptych.mjs writes one "QC:" bifurcation per
// confidently-routed commit (bifurcate appends to data/room-bifurcations.json and, by its own design, never commits). Nothing
// committed them: wo1 measured ~110 such rows uncommitted on 2026-10-19 beside wo1's own rows, and asked that each writer commit
// its own rows, one commit per writer, never a bundled sweep.
//
// So the writer flushes itself: every uncommitted row whose action starts "QC:" — and no other writer's row — lands in ONE commit
// through commit-rows' private-index door (HEAD's store + only these bf ids; CAS on HEAD; hooks run; shared index realigned). The
// flush is debounced to one commit per window (default 30 min) so the log does not double with a QC commit per source commit, and a
// flush commit earns no QC row of its own (shouldWriteQC), so the flush can never feed itself.
//
//   node scripts/delegation/qc-flush.mjs [--now] [--json] [--repo <dir>] [--window-min 30]
//
// @guard tests/delegation/qc-flush-commits-its-own-rows.test.mjs
import { existsSync, statSync, writeFileSync, mkdirSync, rmdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitRows, uncommittedBifurcations } from '../ops/commit-rows.mjs';

export const QC_FLUSH_SUBJECT = 'chore(delegation-qc):';
export const isQcRow = (b) => /^QC:/.test(String(b.action || ''));

// the triptych's one gate for writing a QC row — its three original conditions, plus: never for a flush commit
export function shouldWriteQC({ fr, tr, routeConfident, emailOrPublish, subject = '' }) {
  if (String(subject).startsWith(QC_FLUSH_SUBJECT)) return false;
  return !!(tr && fr && tr !== fr && routeConfident && emailOrPublish);
}

// THE TAIL ALWAYS LANDS (wo1 2026-10-19, bf-6381): bf-6359 was written seconds after a flush, its follow-up flush was held by the
// window, and nothing came back for it — the last row of a burst waited for some later commit to write another QC row. A held flush
// now schedules ONE detached trailing flush for the end of its window (a marker holding its due time stops a pile of sleepers).
export function qcFlush({ repo, now = false, windowMin = 30, trail = true, file = 'data/room-bifurcations.json' } = {}) {
  const stamp = join(repo, '.thetacog', 'cache', 'qc-flush.last');
  const due = join(repo, '.thetacog', 'cache', 'qc-flush.trailing');
  const left = existsSync(stamp) ? windowMin * 60_000 - (Date.now() - statSync(stamp).mtimeMs) : 0;
  if (!now && left > 0) {
    let scheduled = false;
    const pending = existsSync(due) && Number(readFileSync(due, 'utf8')) > Date.now() - 60_000;
    if (trail && !pending) {
      mkdirSync(dirname(due), { recursive: true }); writeFileSync(due, String(Date.now() + left));
      spawn(process.execPath, [fileURLToPath(import.meta.url), '--repo', repo, '--sleep-ms', String(Math.ceil(left) + 250), '--window-min', String(windowMin)], { detached: true, stdio: 'ignore' }).unref();
      scheduled = true;
    }
    return { committed: false, why: `held — last flush under ${windowMin} min ago`, scheduled };
  }
  const lock = join(repo, '.thetacog', 'cache', 'qc-flush.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); } catch { return { committed: false, why: 'held — another flush is running' }; }
  try {
    const ids = uncommittedBifurcations({ repo, file, match: isQcRow });
    if (!ids.length) return { committed: false, why: 'no uncommitted QC rows' };
    const message = [
      `${QC_FLUSH_SUBJECT} commit ${ids.length} QC row${ids.length === 1 ? '' : 's'} the triptych wrote (${ids[0]}${ids.length > 1 ? ` … ${ids[ids.length - 1]}` : ''})`,
      '',
      'The QC emitter (commit-triptych.mjs → bifurcate "QC:") commits its own rows through commit-rows --bf: HEAD\'s store plus',
      'only these ids. Every other writer\'s uncommitted row stays in the tree for its own commit.',
      '',
      `Rows: ${ids.join(' ')}`,
      '',
      'Originating-Terminal: 🤖 qc-flush',
      'Story: The QC writer lands what it wrote, so the shared bifurcation store never carries a backlog another commit sweeps.',
    ].join('\n');
    const r = commitRows({ repo, file, bf: ids, message });
    writeFileSync(stamp, new Date().toISOString() + '\n');
    return { ...r, ids };
  } finally { try { rmdirSync(lock); } catch { /* gone */ } }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const repo = resolve(arg('--repo') || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const sleepMs = Number(arg('--sleep-ms') || 0);
  if (sleepMs > 0) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs); rmSync(join(repo, '.thetacog', 'cache', 'qc-flush.trailing'), { force: true }); }
  const out = qcFlush({ repo, now: argv.includes('--now'), trail: !argv.includes('--no-trail') && !sleepMs, windowMin: Number(arg('--window-min') || 30) });
  console.log(argv.includes('--json') ? JSON.stringify(out) : (out.committed ? `qc-flush: committed ${out.ids.length} QC rows as ${out.sha}` : `qc-flush: ${out.why}`));
}
