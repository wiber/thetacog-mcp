// scripts/vna/row-rewrite.mjs — C378: A WORKER REWRITES ITS OWN ROW, THE OPERATOR'S QUOTE NEVER MOVES.
// Chair decomposition 2026-09-28 of the operator's words *"I hope the sub agents also beef up and rewrite their own
// Merry goals, edit version to it based on their new updated understanding of what billing from"* (not on the tape):
// "Sub-agents beef up and rewrite their own Merkle goal row: each worker appends a new version of its row based on
// its updated understanding of what it is building, keeping the operator's verbatim span intact."
//
// A row's text already becomes a Merkle VERSION the moment its hash changes under fold (spec-tree.mjs basins(), C109f:
// the prior text is archived to n.revisions with origin 'hand', the id and place never move). That fold does not care
// WHO edited SPEC-VNA-COCKPIT.md — a worker's write lands exactly the way a human's does. What was missing is the
// refusal: a row's own text usually CARRIES the operator's `*"…"*` span as its warrant (the row exists because of
// that quote), and a worker rewriting the surrounding words to match what it actually built can silently rewrite the
// quote too — at which point the row is no longer answerable to the operator's own sentence, only to the worker's
// paraphrase of it. Pure, no side effects: the CLI writer lives in spec-check.mjs's `rewrite` command.
export const VERBATIM_RE = /\*"[^"]*"\*/g;
export function verbatimSpans(text) {
  return [...String(text || '').matchAll(VERBATIM_RE)].map((m) => m[0]);
}
// Every `*"…"*` span the ORIGINAL row carries must ride into the PROPOSED text byte-for-byte. A row with no span
// (nothing operator-quoted on it yet) has nothing to protect, so any proposed text is accepted.
export function rewriteRow(originalText, proposedText) {
  const spans = verbatimSpans(originalText);
  const missing = spans.filter((s) => !String(proposedText || '').includes(s));
  if (missing.length) return { ok: false, why: `the operator's verbatim span would be dropped: ${missing[0]}`, missing };
  return { ok: true, text: String(proposedText || '').replace(/\s+/g, ' ').trim() };
}
