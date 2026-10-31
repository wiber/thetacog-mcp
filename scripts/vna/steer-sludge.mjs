// scripts/vna/steer-sludge.mjs — C1036 NO STEER RUNS ON SLUDGE: steer-runner.mjs calls sludgeReason() on the row's own raw
// spec line, right beside the row it is about to dispatch (the same line C270's witness reads), before any worker wakes.
// A row with no plain head (C1027, scripts/ops/plain-heads.mjs), a head left behind by an edited row (its textSha moved —
// STALE), an UNCLEAR head, or a head whose cold reader disagreed with FROM YOU never reaches a worker: steer-runner.mjs
// halts instead (kind: 'sludge' on the runner ledger), the row stays open, and the loop's existing retry/STUCK path names
// it — no second "needs-you" bucket to keep in step with that one.
//
// Pure: every function takes the heads map (board-priority.mjs loadContext().heads) and the row's RAW markdown line — the
// same line textSha was taken over when the head was written (plain-heads.mjs ranked()'s `line`, never spec-clarity.mjs's
// `.text`, which has already dropped the checkbox and id that line hashes).
//
//   node --test tests/vna/c1036-no-steer-on-sludge.test.mjs
// @guard tests/vna/c1036-no-steer-on-sludge.test.mjs
import { textSha } from '../ops/board-priority.mjs';

// null when the row's head clears it to dispatch; else the reason steer-runner.mjs halts instead of waking a worker.
export function sludgeReason(id, specLine, heads) {
  const h = heads instanceof Map ? heads.get(id) : null;
  if (!h) return 'no plain head written for it yet (C1027)';
  if (specLine && h.textSha && h.textSha !== textSha(specLine)) return 'the row changed since its head was written (STALE)';
  if (h.unclear) return `UNCLEAR — ${h.unclear}`;
  if (!h.head) return 'no plain head written for it yet (C1027)';
  if (h.check && h.check.pass === false) return "the cold reader's guess at the owner's act disagreed with FROM YOU";
  return null;
}

// the brief's opening block, DONE WHEN · NOW · FROM YOU · WAITS ON, before the raw row — '' when the row carries no
// written head for its current text (dispatchBrief then opens with the row exactly as it did before this row existed).
export function headOpening(id, specLine, heads) {
  const h = heads instanceof Map ? heads.get(id) : null;
  if (!h || !h.head || (specLine && h.textSha && h.textSha !== textSha(specLine))) return '';
  const hd = h.head;
  return [`DONE WHEN: ${hd.done_when}`, `NOW: ${hd.now}`, `FROM YOU: ${hd.from_you}`, `WAITS ON: ${hd.waits_on}`, '', ''].join('\n');
}

// C1215 — A SNAG SAYS WHAT IT DISAGREED ABOUT (operator 2026-10-23: "the point of writing out progress here one at a time is to
// highight the snags, like what the thing disagreed about?"). A sludge halt used to print only "its room rewrites the head", so the
// disagreement sat unread in data/vna/board-heads.ndjson. snagLine() reads the stored head and returns the one line a person can
// answer: what the head says he owes, what the cold reader says he must do, and the question that settles it. null when the row is
// not a sludge halt. Pure: the same heads map sludgeReason() takes.
export function snagLine(id, specLine, heads) {
  const why = sludgeReason(id, specLine, heads); if (!why) return null;
  const h = heads instanceof Map ? heads.get(id) : null;
  if (!h) return `${id} · no plain head yet — node scripts/ops/plain-heads.mjs backfill --ids ${id}`;
  if (/STALE/.test(why)) return `${id} · the row changed since its head was written — node scripts/ops/plain-heads.mjs backfill --ids ${id}`;
  if (h.unclear || !h.head) return `${id} · the row never says what closes it — the reader: "${String(h.unclear || 'no head').slice(0, 220)}" · QUESTION: what closes ${id}?`;
  const must = h.check?.reader?.owner_must || 'UNMEASURED — the reader left no words';
  return `${id} · the head says you owe "${h.head.from_you}" · the cold reader says you must "${String(must).slice(0, 220)}" · QUESTION: is that yours? yes → it becomes your act on the row · no → say so and an agent builds it`;
}
