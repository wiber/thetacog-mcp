// scripts/lib/grip-word.mjs — "determinism" names the chaos; we are Grip.
//
// Operator, 2026-09-25: "determinism means undecidable chaos, we are grip (seems impossible
// not to make that mistake) — make it impossible to make instead."
//
// Why the word is the chaos side and never ours: Rice (1953) and halting (Turing 1936) are
// theorems ABOUT deterministic machines. A deterministic agent loop is exactly where the
// undecidable lives (Lorenz 1963: fully deterministic, unpredictable past a horizon).
// What we sell is Grip: a placement at an address, recomputable from the commit —
// the same bytes give the same hash.
//
// Why it kept coming back: the words a session uses are taught by the text it is fed. The
// per-prompt payload defined AXIOM 0 as "SPATIAL POSITIONAL DETERMINISM", a guard REQUIRED
// that phrase, and knock-on.mjs seats every reply's own wording as a new lens template —
// so each use re-seeded the next. This module is the one place the substitution lives;
// every writer that turns prose into served text runs it.

export const DETERMINISM_RE = /determinis(?:m|tic(?:ally)?)/gi;

// Replacement table, most specific first. Each target says what the thing DOES.
const SUBS = [
  [/\bpositional determinism\b/gi, 'position — Grip'],
  [/\bdeterministically\b/gi, 're-runnably'],
  [/\bdeterministic\b/gi, 're-runnable'],
  [/\bdeterminism\b/gi, 'Grip'],
];

/** Rewrite our-side uses of the word into what the thing does. Pure; idempotent. */
export function regrip(text) {
  let s = String(text ?? '');
  for (const [re, to] of SUBS) s = s.replace(re, (m) => {
    if (m === m.toUpperCase()) return to.toUpperCase();
    if (m[0] === m[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
    return to;
  });
  return s;
}

/** Count mentions of the word in a string. */
export function countDeterminism(text) {
  return (String(text ?? '').match(DETERMINISM_RE) || []).length;
}

// ── the surfaces the guard reads (tests/ops/determinism-is-the-chaos.test.mjs) ──────────
// ZERO scope: the text every session is fed. FLOOR scope: public copy, where the word may
// still appear as someone else's claim held up and mocked — a count that only falls.
export const FLOOR_SCOPES = {
  blog: ['src/content/blog'],
  book: ['books/tesseract'],
  site: ['src/app'],
  readmes: ['packages/thetacog-mcp/README.md', 'packages/thetacog-mcp-vscode/README.md'],
  'voice-rules': ['docs/architecture/claude-rules/voice-and-pitch.md'],
};
export const ZERO_FILES = [
  'CLAUDE.md',
  'docs/architecture/claude-rules/axioms-and-method.md',
  'docs/architecture/claude-rules/doors-and-surfaces.md',
  'docs/architecture/claude-rules/build-and-format.md',
  'docs/architecture/claude-rules/the-ratchet-invariants.md',
  'docs/architecture/claude-rules/six-percentages.md',
  'docs/architecture/claude-rules/the-field-invariant.md',
];
// The one line allowed to carry the word in the payload is the rule that bans it.
export const RULE_MARKER = 'THE WORD NAMES THE CHAOS';

export function zeroViolations(text) {
  return String(text).split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => countDeterminism(l.text) > 0 && !l.text.includes(RULE_MARKER));
}
