#!/usr/bin/env node
// scripts/pmu/attest-loop.mjs — C1378: THE LOOP IS THE DEMO, NO RULEBOOK IS LONG ENOUGH.
//
// One door runs flag → clear → seat → re-run on a correct case worded a way the rulebook never saw:
//   RUN 1  the work is placed against the rulebook — the reef's shelves, scored by the same stemmed-overlap scorer
//          prompt-lens.mjs's pickWorkTemplate uses (rankTemplates in ./knock-on.mjs). No shelf reaches the miss gate
//          and nothing sits under the spec's lane → FLAGGED.
//   CLEAR  a person reads the case and clears it. `--clear` stands in for that person here (non-interactive); without it
//          the door stops after RUN 1 and says so (exit 2). The clearing is a human act, never the loop's.
//   SEAT   ./knock-on.mjs seats ONE child shelf from the miss — prompt = the work that missed, payload = the spec it was
//          cleared against, parent = the spec's lane — and appends its own receipt row. The parent vocabulary is
//          byte-untouched (vocab_sha_before == vocab_sha_after on the row). knock-on's fresh-lens verification is skipped
//          on purpose (it would read the LIVE reef, not this copy); RUN 2 below is the verification, off the copy itself.
//   RUN 2  the same work, placed again: the child shelf is the top catch, above the miss gate, under the lane → IN LANE.
//   REPLAY each run recomputes one digest over the spec text, the spec's gzip-NCD home cell (src/lib/pmu/compress.mjs, the
//          gate's own witness; UNMEASURED under the package's floor) and the work's bytes. It is printed for both runs and
//          compared: byte-identical, because the instrument and the inputs never moved. The RECORD grew by one shelf.
//
// A DEMO NEVER WRITES SHIPPED DATA. The rulebook it reads and grows is a user-local copy, created on first run from the
// shipped reef: <cwd>/.thetacog/attest-loop/reef.json (+ knock-on.ndjson, orphans.ndjson, backups/). data/pmu/lens-reef.json
// and data/pmu/knock-on-convergence.ndjson — in the repo or in the package — are never opened for writing here. `--fresh`
// recreates the copy from the shipped reef; `--dir <dir>` moves the whole local set.
//
// Usage:
//   node scripts/pmu/attest-loop.mjs                   # RUN 1 only: flag, then stop and ask for --clear (exit 2)
//   node scripts/pmu/attest-loop.mjs --clear           # the whole loop (exit 0 when RUN 2 lands in lane and the digests agree)
//   npx thetacog-mcp attest-demo --loop [--clear]      # the same door through attest-demo
//   flags: --intent "<text|file>" --work "<text|file>" --fresh --json --dir <dir>
// Built-in case: the sledgehammer scenario's intent (./attest-scenarios.mjs) and reality 4 of
// docs/pmu/reports/2026-10-28-surgery-rewording-walk-vs-ncd.md — a correct surgery, reworded (verbatim from the transcript
// that report cites). Measured on the shipped reef (218 shelves, 2026-10-28): RUN 1 top catch scores 2 (gate 3); the seat
// locks in 8 iterations, NCD 0.8776 → 0.5548, score 26, margin 24; RUN 2 lands in lane.
//
// LLM-free end to end. SUFFICIENT FOR: where this wording lands among the shelves, before and after the record grew.
// NOT SUFFICIENT FOR: whether the surgery was correct — the person decided that (Rice); this is placement, not truth.
// Guard: tests/vna/c1378-the-loop-is-the-demo-no.test.mjs.

import { readFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runKnockOn, rankTemplates, MISS_MAX_SCORE } from './knock-on.mjs';
import { buildFreeformSpec, resolveFreeformInput } from './attest-demo-freeform.mjs';
import { compress } from '../../src/lib/pmu/compress.mjs';
import { SCENARIOS } from './attest-scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const SHIPPED_REEF = resolve(REPO, 'data/pmu/lens-reef.json');
const AXIS_LIB = resolve(REPO, 'docs/architecture/axis-library-v1.json');
export const REPORT = 'docs/pmu/reports/2026-10-28-surgery-rewording-walk-vs-ncd.md';

// the spec: the shipped sledgehammer scenario's intent, never retyped here
export const BUILT_IN_INTENT = SCENARIOS.find((s) => s.key === 'sledgehammer').intent;
// the work: reality 4 of the report above — a correct surgery, worded differently from the intent
export const BUILT_IN_WORK = 'The team took out the gallbladder through small keyhole incisions, placing each port carefully, handling tissue gently, dissecting the cystic duct precisely, and confirming before closing that drainage was working and all bleeding had stopped.';

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const sha12 = (s) => sha256(s).slice(0, 12);
const fileSha16 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const head = (s, n = 72) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const countRows = (p) => { try { const b = readFileSync(p, 'utf8'); let n = 0; for (let i = 0; i < b.length; i++) if (b[i] === '\n') n++; return n; } catch { return 0; } };

/** The lane is the spec, declared before the work ran: named by the spec text's own hash. */
export const laneOf = (intent) => `spec:${sha12(intent)}`;
/** The shelf knock-on seats for a cleared wording: named by that wording's hash (idempotent per case). */
export const shelfNameFor = (work) => `cleared-${sha12(work)}`;

export function loopPaths(cwd = process.cwd(), dir = null) {
  const base = dir ? resolve(cwd, dir) : resolve(cwd, '.thetacog', 'attest-loop');
  return { base, reef: join(base, 'reef.json'), receipt: join(base, 'knock-on.ndjson'), orphans: join(base, 'orphans.ndjson'), backups: join(base, 'backups') };
}

/** The user-local rulebook: a copy of the shipped reef, made once (or again on --fresh). The shipped file is only read. */
export function ensureLocalRulebook(paths, { fresh = false, shipped = SHIPPED_REEF } = {}) {
  mkdirSync(paths.base, { recursive: true });
  const existed = existsSync(paths.reef);
  if (!existed || fresh) copyFileSync(shipped, paths.reef);
  const shelves = (JSON.parse(readFileSync(paths.reef, 'utf8')).templates || []).length;
  return { created: !existed || fresh, shipped, shelves };
}

/** Where the work lands among the rulebook's shelves, read fresh off the file every call. */
export function placeAgainstRulebook(work, reefPath, lane) {
  const reef = JSON.parse(readFileSync(reefPath, 'utf8'));
  const templates = Array.isArray(reef.templates) ? reef.templates : [];
  const ranked = rankTemplates(work, templates);
  const top = ranked[0] || null;
  const tpl = top ? templates.find((t) => t.name === top.name) : null;
  const score = top?.n || 0;
  const margin = score - (ranked[1]?.n || 0);
  const underLane = !!tpl && tpl.parent === lane;
  let verdict, reason;
  if (!top || score <= MISS_MAX_SCORE) {
    verdict = 'flagged';
    reason = top
      ? `miss: the top catch "${top.name}" scores ${score}, at or under the miss gate (${MISS_MAX_SCORE}); no shelf in the rulebook was written for this wording`
      : 'miss: the rulebook has no shelves';
  } else if (underLane) {
    verdict = 'in-lane';
    reason = `shelf "${top.name}" sits under ${lane}, scores ${score}, ${margin} over the runner-up${tpl.seated ? ` (seated ${tpl.seated})` : ''}`;
  } else {
    verdict = 'flagged';
    reason = `off-lane: the top catch "${top.name}" scores ${score} but sits ${tpl.parent ? `under ${tpl.parent}` : 'under no lane'}, not ${lane}`;
  }
  return { verdict, reason, top: top?.name || null, score, margin, underLane, shelves: templates.length, reef_sha: fileSha16(reefPath) };
}

/** The spec compiled by the gate's own witness — a real recompute each run; abstains under the package's floor. */
export function compileSpec(intent) {
  const axisLib = JSON.parse(readFileSync(AXIS_LIB, 'utf8'));
  return buildFreeformSpec(intent, axisLib, compress);
}

/** The REPLAY digest: spec text · its gzip-NCD home cell (or UNMEASURED) · the work's bytes. Never the rulebook, never a receipt. */
export function replayDigest(intent, work, spec) {
  return sha12(`${intent}|${spec.abstain ? 'UNMEASURED' : spec.homeRank}|${sha256(work)}`);
}

export function runOnce(label, { intent, work, lane, paths }) {
  const spec = compileSpec(intent);
  const p1 = placeAgainstRulebook(work, paths.reef, lane);
  const p2 = placeAgainstRulebook(work, paths.reef, lane);   // the same scorer, read a second time off the file
  return {
    label, ...p1,
    replay: { top: [p1.top, p2.top], score: [p1.score, p2.score], agrees: p1.top === p2.top && p1.score === p2.score },
    work_sha256: sha256(work),
    digest: replayDigest(intent, work, spec),
    spec: { homeRank: spec.homeRank, homeFamily: spec.homeFamily, abstain: spec.abstain, abstainReason: spec.abstainReason },
  };
}

/** knock-on seats the child shelf from the miss — into the local copy, receipt beside it. */
export function seatFromMiss({ intent, work, lane, paths }) {
  const name = shelfNameFor(work);
  const row = runKnockOn({
    prompt: work, payload: intent, name, parent: lane, apply: true,
    reefPath: paths.reef, historyPath: paths.receipt, orphansPath: paths.orphans, backupDir: paths.backups,
    verifyLens: false,
  });
  const last = row.steps[row.steps.length - 1];
  return {
    name, locked: row.locked, applied: row.applied, iterations: row.iterations, stop_reason: row.stop_reason,
    ncd_from: row.coherence_delta[0], ncd_to: row.coherence_delta[row.coherence_delta.length - 1],
    score: last.score, margin: last.margin,
    reef_sha_before: row.reef_sha_before, reef_sha_after: row.reef_sha_after,
    vocab_sha_before: row.vocab_sha_before ?? null, vocab_sha_after: row.vocab_sha_after ?? null,
    orphaned: !!row.orphaned, ts: row.ts,
  };
}

export function runLoop({ intent = BUILT_IN_INTENT, work = BUILT_IN_WORK, clear = false, fresh = false, cwd = process.cwd(), dir = null } = {}) {
  const paths = loopPaths(cwd, dir);
  const rulebook = ensureLocalRulebook(paths, { fresh });
  const lane = laneOf(intent);
  const builtIn = intent === BUILT_IN_INTENT && work === BUILT_IN_WORK;
  const out = { lane, built_in: builtIn, intent_head: head(intent), work_head: head(work), paths, rulebook };
  out.run1 = runOnce('RUN 1', { intent, work, lane, paths });
  if (out.run1.verdict === 'in-lane') { out.already = true; out.exit = 0; return out; }
  if (!clear) { out.stopped = 'awaiting-clear'; out.exit = 2; return out; }
  out.cleared = { by: '--clear (stands in for the person; non-interactive)', at: new Date().toISOString() };
  const rowsBefore = countRows(paths.receipt);
  out.seat = seatFromMiss({ intent, work, lane, paths });
  out.receipt = { path: paths.receipt, rows_before: rowsBefore, rows_after: countRows(paths.receipt) };
  if (!out.seat.locked || !out.seat.applied) { out.failed = 'not-seated'; out.exit = 1; return out; }
  out.run2 = runOnce('RUN 2', { intent, work, lane, paths });
  out.replay = {
    digests: [out.run1.digest, out.run2.digest],
    identical: out.run1.digest === out.run2.digest && out.run1.work_sha256 === out.run2.work_sha256,
  };
  if (out.run2.verdict !== 'in-lane') { out.failed = 'run2-not-in-lane'; out.exit = 1; return out; }
  if (!out.replay.identical) { out.failed = 'replay-differs'; out.exit = 1; return out; }
  out.exit = 0;
  return out;
}

const specLine = (s) => (s.abstain
  ? `gzip-NCD home cell UNMEASURED — ${s.abstainReason} (the gate's cell is not printed; the rulebook decides below)`
  : `gzip-NCD home cell ${s.homeRank} (family ${s.homeFamily}) — the gate's witness; the rulebook decides below`);
const replayLine = (r) => `       REPLAY  work sha256 ${r.work_sha256.slice(0, 8)} · placed ${r.replay.top[0]}:${r.replay.score[0]} · ${r.replay.top[1]}:${r.replay.score[1]}${r.replay.agrees ? '' : '  DIFFERS'} · digest ${r.digest}`;

export function render(out) {
  const L = [];
  L.push('THE LOOP IS THE DEMO — no rulebook is long enough. flag → clear → seat → re-run, with no model in the path.');
  L.push(`  rulebook  ${out.paths.reef} — your local copy${out.rulebook.created ? ` (created now from ${out.rulebook.shipped}, ${out.rulebook.shelves} shelves)` : ` (${out.rulebook.shelves} shelves)`}. The shipped reef and its receipt file are never written.`);
  L.push(`  receipt   ${out.paths.receipt} — knock-on's own row per seat`);
  L.push(`  spec      ${out.lane} — "${out.intent_head}" (the lane, declared before the work ran)`);
  L.push(`  work      "${out.work_head}"${out.built_in ? ` — a correct case, reworded (reality 4, ${REPORT})` : ''}`);
  L.push(`  ${specLine(out.run1.spec)}`);
  L.push('');
  L.push(`RUN 1  ${out.run1.verdict === 'in-lane' ? 'IN LANE' : 'FLAGGED'} — ${out.run1.reason}${out.already ? ' — already in your local rulebook; nothing to clear. --fresh recreates the copy from the shipped reef.' : ''}`);
  L.push(replayLine(out.run1));
  if (out.already) return L;
  L.push('');
  if (out.stopped) {
    L.push('CLEAR  stopped: a person has to read this case and clear it. Re-run with --clear to stand in for them (nothing was seated; the rulebook is unchanged). exit 2');
    return L;
  }
  L.push(`CLEAR  a person reads the case and clears it — ${out.cleared.by}`);
  const s = out.seat;
  if (!s.locked || !s.applied) {
    L.push(`SEAT   knock-on could not seat shelf "${s.name}" under ${out.lane}: ${s.locked ? 'locked but not applied' : `no lock (${s.stop_reason})`} · NCD ${s.ncd_from} → ${s.ncd_to}${s.orphaned ? ` · orphaned to ${out.paths.orphans}` : ''}. exit 1`);
    return L;
  }
  L.push(`SEAT   knock-on seats shelf "${s.name}" under ${out.lane} from the miss: LOCK in ${s.iterations} iterations (${s.stop_reason}) · NCD ${s.ncd_from} → ${s.ncd_to} · score ${s.score}, margin ${s.margin}`);
  L.push(`       receipt row appended (${out.receipt.rows_before} → ${out.receipt.rows_after} rows): reef ${s.reef_sha_before} → ${s.reef_sha_after} · parent vocabulary ${s.vocab_sha_before} → ${s.vocab_sha_after}${s.vocab_sha_before === s.vocab_sha_after ? ' (untouched)' : ' ⚠ CHANGED'}`);
  L.push('');
  L.push(`RUN 2  ${out.run2.verdict === 'in-lane' ? 'IN LANE' : 'FLAGGED'} — ${out.run2.reason}`);
  L.push(replayLine(out.run2));
  L.push('');
  L.push(`REPLAY digests  ${out.replay.digests[0]} · ${out.replay.digests[1]} — ${out.replay.identical ? 'byte-identical: the instrument and the inputs never moved' : 'DIFFER — the instrument or an input moved between the runs; this is a defect, report it with both digests'}`);
  L.push('TWO VALUES      the replay is the same on both runs; the placement moved from FLAGGED to IN LANE because the record grew by one shelf a person cleared — not because the measurement changed.');
  L.push(`decided by      the stemmed-overlap shelf scorer (scripts/pmu/knock-on.mjs rankTemplates, the one prompt-lens.mjs's pickWorkTemplate uses), read off ${out.paths.reef}`);
  L.push('placement, not truth: whether the surgery was correct was the person\'s call (Rice); this proves WHERE the wording lands, before and after.');
  if (out.failed) L.push(`FAILED  ${out.failed}. exit 1`);
  return L;
}

export async function main(argv = process.argv.slice(2)) {
  const arg = (k) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  const has = (k) => argv.includes(k);
  const rd = (raw) => resolveFreeformInput(raw, { existsSyncFn: existsSync, readFileSyncFn: readFileSync });
  const out = runLoop({
    intent: arg('--intent') ? rd(arg('--intent')) : BUILT_IN_INTENT,
    work: arg('--work') ? rd(arg('--work')) : BUILT_IN_WORK,
    clear: has('--clear'), fresh: has('--fresh'), dir: arg('--dir'),
  });
  if (has('--json')) console.log(JSON.stringify(out, null, 2));
  else console.log(render(out).join('\n'));
  return out.exit;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main());
