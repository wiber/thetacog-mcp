// scripts/vna/steer-rules.mjs — C236 THE STEER CONTROLLER'S DECISIONS, AS PURE FUNCTIONS THE LIVE CODE CALLS.
//
// THE CRYSTAL's method (spec §7, data/formal/harness-properties.json): a rule is extracted as a pure function, its finite domain
// is enumerated exhaustively, and one verdict is written per property. The rule the walk RUNS must be the function the harness
// ENUMERATES — never a second copy (tests/formal/harness-properties.test.mjs, "no second copy"). So every decision here is
// imported by the file that used to carry it inline, and scripts/vna/steer-crystal.mjs enumerates exactly these exports:
//   attemptVerdict   steer-until.mjs   (d) the verdict after one dispatch's result — TICKED / retry / STUCK after MAX_ATTEMPTS
//   dispatchable     steer-until.mjs   (b) which open rows may fill a slot — CLEAR and not stuck / deferred / planned / running
//   tickDecision     spec-check.mjs    the tick — earned only by a guard that ran GREEN as it stands in HEAD (C178a)
//   headNamesRow     steer-runner.mjs  the conventional-commit head names the row (scope, or the text opens with it)
//   attributeFrom    steer-runner.mjs  C186x — the worker's commit is credited by its dispatch nonce or a scope-head, never a mention
// No fs, no git, no child processes: a file that imports this imports nothing else.
//
// PORT ROW: C236-rust — these DECIDE (a verdict, a credit, a tick), so under MAXIMISE RUST they move into the crate beside
// harness.rs once this node enumeration has been green in use; steer-crystal.mjs's checker is the acceptance the port keeps.
// @guard tests/vna/c236-the-steer-controller-is-in-the-crystal.test.mjs
import { CLEAR } from './spec-clarity.mjs';

export const MAX_ATTEMPTS = 2;   // the dispatch and ONE retry carrying the halt reason (C186 (d))

/** (d): after a dispatch's result lands. `prev` is the row's earlier attempt reasons; a new array is returned, never mutated. */
export function attemptVerdict({ ticked = false, halted = false, reason = null, prev = [], maxAttempts = MAX_ATTEMPTS } = {}) {
  if (ticked) return { verdict: `TICKED${prev.length ? ' on retry' : ''}`, attempts: prev.slice(), stuck: false, why: null };
  const why = halted ? `HALT — ${reason}` : 'green but the row is still open (not ticked)';
  const attempts = [...prev, why];
  if (attempts.length >= maxAttempts) return { verdict: `STUCK after ${attempts.length} — ${why}`, attempts, stuck: true, why };
  return { verdict: `${why} · retry next`, attempts, stuck: false, why };
}

/** (b): a row may fill a slot only when it is open, CLEAR, and held by nothing — a YOUR-ACT or NEEDS-OPERATOR row never can. */
export function dispatchable(row, { ticked = false, stuck = false, deferred = false, planned = false, running = false } = {}) {
  return !ticked && !!row && row.class === CLEAR && !stuck && !deferred && !planned && !running;
}

/** the tick (spec-check.mjs toggle): untick is always allowed; a tick needs a named guard that RAN and came back green. */
export function tickDecision({ done = false, guard = null, state = null } = {}) {
  if (done) return { action: 'untick', code: null };
  if (!guard) return { action: 'refuse', code: 'no-guard' };
  if (state == null) return { action: 'run-guard', code: null };   // the guard has not been run at HEAD — never a tick
  if (state === 'not-committed') return { action: 'refuse', code: 'not-committed' };
  if (state !== 'green') return { action: 'refuse', code: 'not-green' };
  return { action: 'tick', code: null };
}

// C267 (U4) — A FOLLOW-UP BINDS TO ITS ROW; A ROW WITH NO CONTENT NEVER REACHES A WORKER (operator 2026-09-25, verbatim: "When an
// edit is underway, the session enters an Active Unit State. If you type \"make that edit\" or \"decrease it more,\" the input binds
// to the active row rather than declaring a new row"). The incident: C258 → "make that edit" (C259) → "finish it" (C261), three rows,
// the last two with nothing a worker could act on; C261's worker read "FINISH IT" and thought past the watchdog. CONTENT is what is
// left after the words that only point (pronouns) or only say "act" (do, make, finish, fix, edit, continue …) are removed.
const POINTERS = new Set(['it', 'that', 'this', 'these', 'those', 'them', 'there', 'same']);
const HOLLOW = new Set([...POINTERS, 'a', 'an', 'the', 'and', 'or', 'but', 'so', 'then', 'now', 'just', 'please', 'ok', 'okay', 'yes', 'go', 'on', 'ahead', 'again', 'more', 'less', 'bit', 'too', 'also', 'still',
  'do', 'did', 'done', 'make', 'made', 'finish', 'finished', 'complete', 'fix', 'edit', 'change', 'try', 'retry', 'continue', 'run', 'ship', 'land', 'keep', 'going', 'thing', 'that\'s', 'it\'s', 'can', 'you', 'we', 'let\'s', 'lets', 'to', 'of', 'with', 'for', 'up', 'out', 'all', 'way']);
const wordsOf = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
export const contentWords = (t) => wordsOf(t).filter((w) => !HOLLOW.has(w));
/** an ask that only points back: an anaphor, at most 6 words, at most 2 content words ("make that edit", "finish it", "decrease it more") */
export function isFollowUp(ask) { const w = wordsOf(ask); return w.length > 0 && w.length <= 6 && w.some((x) => POINTERS.has(x)) && contentWords(ask).length <= 2; }
/** an ask with nothing to act on — refused at dispatch with this reason */
export const EMPTY_ROW = 'no content — the ask is only a pointer and a verb ("finish it"); bind it to the row it means, or say what to change';
export const isEmptyAsk = (ask) => contentWords(ask).length === 0;

// C276 (U13) — A RETRY CHANGES THE BRIEF, ONE DIAL (operator 2026-09-25 goal, verbatim: "if it gets stuck restarted with a slightly
// different improved prompt"). The halt reason always rides the retry (C186); on top of it EXACTLY ONE dial moves, from this fixed set:
//   window+50   the code slot's window grows 40 → 90 lines (the worker may have edited outside the 40 it saw)
//   narrow      the window shrinks to 20 lines and the other candidates are dropped (a smaller prefill, one place to look)
//   no-helpers  the own-files diffs and the other candidates are dropped (only statuses stay)
// The DEFAULT choice is a fixed rotation over the retries already on the ledger (retryDial) — a sweep, so every dial is sampled and
// every retry is an A/B pair on the record. A model may pick instead (C278) only while it beats this rotation.
export const DIALS = Object.freeze(['window+50', 'narrow', 'no-helpers']);
export const retryDial = (retriesSoFar = 0) => DIALS[((Number(retriesSoFar) || 0) % DIALS.length + DIALS.length) % DIALS.length];
export function dialShape(dial) {
  if (dial === 'window+50') return { window: 90, helpers: true, diffs: true };
  if (dial === 'narrow') return { window: 20, helpers: false, diffs: true };
  if (dial === 'no-helpers') return { window: 40, helpers: false, diffs: false };
  return { window: 40, helpers: true, diffs: true };
}

// C283 — A GREEN THAT PROVES NOTHING IS A LEAK (operator 2026-09-25, verbatim: "The loop's checker (spec-check.mjs) must reject
// declaration-only guards. test.todo or skipped tests evaluate as red."). node --test exits 0 when every failing test is marked
// TODO (C167b's parked cases read "not ok … # TODO" and still exit 0) and when a file declares no test at all. Read off the TAP
// summary the run printed — the counts node itself wrote — never off the source's words.
export function hollowReason(tap) {
  const t = String(tap || ''); const n = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(t) || [])[1] ?? NaN);
  if (!/^# tests \d+/m.test(t)) return 'no TAP summary — the guard printed no test counts';
  // a file with no test() still reports one passing subtest, NAMED BY ITS OWN PATH — so a subtest count is not a test count
  const named = [...t.matchAll(/^\s*# Subtest: (.+)$/gm)].map((m) => m[1].trim()).filter((x) => !/^\/.*\.[cm]?js$/.test(x));
  if (n('tests') === 0 || !named.length) return 'declares no test (node counts a file with no test() as one passing test named by its path)';
  if (n('todo') > 0) return `${n('todo')} test(s) marked TODO — a parked case exits 0 whatever it asserts`;
  if (n('skipped') > 0) return `${n('skipped')} test(s) skipped`;
  if (n('pass') === 0) return 'no test passed';
  return null;
}

/** the conventional-commit head `<type>(<scope>)!?: <text>` names the row when the scope carries it or <text> opens with it */
export function headNamesRow(subject, label) {
  const m = /^[a-z]+(?:\(([^)]*)\))?!?:\s*(.*)$/i.exec(String(subject || '')); if (!m || !label) return false;
  return (m[1] != null && new RegExp(`\\b${label}\\b`).test(m[1])) || new RegExp(`^${label}\\b`).test(m[2]);
}

export const isChore = (subject) => /^chore\(commit-page\):/.test(String(subject || ''));

/**
 * C186x attribution over a listed range (newest first): [{ sha, subject, trailers: [nonce…] }]. `touchesTest(c)` says whether the
 * commit changes a file under tests/ (the guard-carrying one is preferred within a rule). Credited rules are exactly
 * 'nonce-trailer' and 'scope-head'; everything else is 'unattributed' when a label was asked for, or the pre-C186x names when not.
 */
export function attributeFrom(list, { label = null, nonce = null, touchesTest = (c) => !!c.touchesTest, head1 = null } = {}) {
  const work = list.filter((c) => !isChore(c.subject));
  const pick = (cands, rule) => { const c = cands.find(touchesTest) || cands[0]; return c ? { sha: c.sha, rule } : null; };
  const byNonce = nonce ? work.filter((c) => (c.trailers || []).includes(String(nonce))) : [];
  const byHead = label ? work.filter((c) => headNamesRow(c.subject, label)) : [];
  if (byNonce.length) return pick(byNonce, 'nonce-trailer');
  if (byHead.length) return pick(byHead, 'scope-head');
  const t = work.find(touchesTest); if (t) return { sha: t.sha, rule: label ? 'unattributed' : 'newest-test' };
  const n = work[0] || list[0]; return { sha: n ? n.sha : head1, rule: label ? 'unattributed' : 'newest' };
}
export const CREDITED_RULES = Object.freeze(['nonce-trailer', 'scope-head']);
