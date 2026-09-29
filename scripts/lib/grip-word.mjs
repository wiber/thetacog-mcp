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

// Operator, 2026-09-29: "its not that we say the term fewer times, its that whenever we say it, we use it to poke
// fun at people who think that their code is deterministic." A word that OPENS a quote ("deterministic") is someone
// else's claim held up — mentioned, not used. The public floor counts USES only; the payload (ZERO_FILES) still
// counts every mention, because a session learns its words from that text whatever the quote marks say.
// A word right after "/" is a path segment (data/determinism-floor.json, which the sidebar's generated README section
// quotes when it walks a commit that touched it) — a filename, not a claim.
const QUOTE_OPEN = /["\u201C/]$/;

/** Count uses of the word: every mention except one that opens a double quote or is a path segment. */
export function countDeterminismUse(text) {
  const s = String(text ?? '');
  let n = 0;
  for (const m of s.matchAll(DETERMINISM_RE)) if (!QUOTE_OPEN.test(s.slice(Math.max(0, m.index - 1), m.index))) n++;
  return n;
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

// ── C336c THE CODE-ONLY TARGET CARRIES A LEDGER — data/determinism-floor.json has a floor and a guard (the test above) but
// no writer: the floor was pinned by hand on 2026-09-25 and nothing appends a reading against it. measureFloors runs the
// SAME arithmetic the guard's "public copy: the count only falls" test uses (git ls-files per FLOOR_SCOPES, summed
// countDeterminism per file) so the recorded reading and the guard can never silently diverge. n = tracked files scanned
// across every scope (never a typed constant); violations = scopes whose count exceeds its own floor.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { appendRatchetRow } from './ratchet-row.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER_PATH = resolve(REPO, 'data/determinism-ratchet.ndjson');

/** the mentions-per-scope reading, and how many scopes sit over their own floor */
export function measureFloors(repo = REPO) {
  const { floors } = JSON.parse(readFileSync(resolve(repo, 'data/determinism-floor.json'), 'utf8'));
  const counts = {};
  let filesScanned = 0;
  let violations = 0;
  for (const [scope, paths] of Object.entries(FLOOR_SCOPES)) {
    const files = execFileSync('git', ['ls-files', '--', ...paths], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);
    filesScanned += files.length;
    let n = 0;
    for (const f of files) { try { n += countDeterminismUse(readFileSync(resolve(repo, f), 'utf8')); } catch { /* not on disk in this checkout */ } }
    counts[scope] = n;
    if (n > (floors[scope] ?? 0)) violations++;
  }
  return { counts, filesScanned, violations, floors };
}

/** appends one ratchet row beside the floor file (ledgerFor's stem match) so the census stops reading this target as UNMEASURED */
export function recordFloors(repo = REPO) {
  const { counts, filesScanned, violations } = measureFloors(repo);
  return appendRatchetRow(LEDGER_PATH, {
    n: filesScanned, violations, counts,
    note: 'grip-word mentions per public FLOOR_SCOPES, against data/determinism-floor.json; the floor may only fall',
  });
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN && process.argv.includes('--record')) {
  const r = recordFloors();
  console.log(`determinism ratchet recorded: n=${r.n} violations=${r.violations}`);
}
