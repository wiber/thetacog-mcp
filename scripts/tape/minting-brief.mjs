// packages/thetacog-mcp/scripts/tape/minting-brief.mjs — THE MINTING BRIEF, AS A SIDECAR.
//
// THE PROBLEM THIS SOLVES. The single most load-bearing artifact in this product is the prompt that
// mints the question, and until now it was a string literal inside propose-questions.mjs — a file
// nobody opens, invisible on the glass, uneditable without a code change. The operator was steering
// a loop whose steering wheel was in another room.
//
// THE TWO LEVELS, and they are genuinely different kinds of text:
//   · GENERAL  (data/tape/minting-brief.md)          — the standing brief. It applies to EVERY
//     project and encodes what a good question is at all: the 21-questions framing, the ladder, the
//     four bisection tests, the split between question and answers. It changes rarely.
//   · FILTER   (data/tape/minting-filter.<slug>.md)  — the specific filter for the focus currently
//     under test. It is what makes the question about THIS work rather than about questions in
//     general, and it is expected to change every few turns. Falls back to
//     data/tape/minting-filter.default.md, which says out loud that no filter has been written.
//
// IT IS AN OPTIMISM TARGET, NOT A RUN. The brief states what a good question WOULD be. It asserts
// nothing about whether the question currently on the glass is good — that is the ranker's job, and
// the ranker is LLM-free and measures something else entirely. Anywhere this text is rendered it
// must be labelled as the target, never as a verdict. Same sufficiency-contract discipline the PMU
// receipt already uses: a stated intent and a measured reality are two different objects and merging
// them is how a receipt starts lying.
//
// WHY A SIDECAR AND NOT A WRITE-BACK INTO THE .mjs SOURCE. The spec's open question #1 asked for
// both. A write-back into source means the glass edits executable code at runtime — a syntax error
// typed into a textarea takes the generator down, and every edit is a diff against a JS string array
// where a stray apostrophe changes the program. The sidecar is plain text with no escaping, it
// diffs as prose, and the worst an edit can do is produce a worse question.
//
// THE REFUSAL. If the general brief is missing or blank, or no filter can be resolved, EVERY entry
// point here returns ok:false and propose-questions.mjs exits non-zero rather than minting. This is
// the emit-spec.mjs discipline: reporting NO specification is a different claim from reporting an
// empty one, and only a refusal preserves the distinction. A generator that silently fell back to a
// hardcoded brief would mint questions the operator believes came from the text on their screen.
//
// ONE DOOR. propose-questions.mjs (the real mint) and the cockpit's /api/minting-brief (the render
// and the edit) both compose through composeMintingPrompt() here. A second composition would let
// the page show a prompt the generator does not use, which is the exact failure the whole sidecar
// exists to end.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The worked examples are computed here so the generator and the glass compose the SAME document.
import { briefExamples } from './question-quality.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..', '..');

// TAPE_BRIEF_DIR exists for tests, which must never write into the operator's live brief.
const BRIEF_DIR = process.env.TAPE_BRIEF_DIR || resolve(REPO, 'data', 'tape');

export const GENERAL_FILE = 'minting-brief.md';
export const DEFAULT_FILTER_FILE = 'minting-filter.default.md';

export function briefDir() { return BRIEF_DIR; }
export function generalPath() { return resolve(BRIEF_DIR, GENERAL_FILE); }
export function defaultFilterPath() { return resolve(BRIEF_DIR, DEFAULT_FILTER_FILE); }
/** A slug maps to exactly one filter file; the default is the fallback, never a merge. */
export function filterPathFor(slug) {
  const safe = String(slug || '').replace(/[^A-Za-z0-9._-]/g, '-');
  return safe ? resolve(BRIEF_DIR, `minting-filter.${safe}.md`) : defaultFilterPath();
}

function readOrNull(p) {
  try { const s = readFileSync(p, 'utf8'); return s.trim() ? s : null; } catch { return null; }
}

/**
 * Load the two halves for a slug.
 * @returns {{ok:true, general:string, filter:string, generalPath:string, filterPath:string,
 *            filterIsDefault:boolean} | {ok:false, reason:string, missing:string[]}}
 */
export function loadMintingBrief(slug) {
  const gp = generalPath();
  const general = readOrNull(gp);
  const own = filterPathFor(slug);
  const dp = defaultFilterPath();
  const filterIsDefault = !readOrNull(own);
  const fp = filterIsDefault ? dp : own;
  const filter = readOrNull(fp);

  const missing = [];
  if (!general) missing.push(gp.replace(`${REPO}/`, ''));
  if (!filter) missing.push(`${own.replace(`${REPO}/`, '')} (or ${dp.replace(`${REPO}/`, '')})`);
  if (missing.length) {
    return {
      ok: false,
      missing,
      reason: [
        'THE MINTING BRIEF IS MISSING — refusing to mint.',
        `Absent or blank: ${missing.join(', ')}`,
        'The brief is the sidecar the operator edits on the glass; minting without it would produce',
        'questions from a brief nobody can see, which is the condition this file exists to end.',
        'Restore the file (it is in git) or write one, then re-run.',
      ].join('\n'),
    };
  }
  // The examples are DERIVED, never stored: regenerating them from the live corpus on every load
  // means the brief cannot drift from what the model actually produced last run. Best-effort by
  // design — a session with no question history simply gets no examples block rather than a
  // failure, because a first run has nothing to learn from yet.
  let examples = '';
  try {
    const qp = resolve(REPO, `.thetacog/tape-sessions/${slug}/questions.ndjson`);
    if (existsSync(qp)) {
      const asked = readFileSync(qp, 'utf8').trim().split('\n')
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((r) => r && r.ask && r.ask.question).map((r) => r.ask.question);
      if (asked.length) examples = briefExamples(asked);
    }
  } catch { examples = ''; }

  return {
    ok: true,
    general,
    filter,
    examples,
    generalPath: gp,
    filterPath: fp,
    filterIsDefault,
  };
}

/**
 * Write one or both halves back. Returns which files changed, so a caller can say what it did
 * rather than claiming a save it did not perform.
 * A blank body is REFUSED: an empty brief is not an edit, it is a deletion of the instrument, and
 * loadMintingBrief() would then refuse to mint on the next turn with no explanation of why.
 */
export function saveMintingBrief({ slug, general = null, filter = null }) {
  const written = [];
  if (general != null) {
    if (!String(general).trim()) return { ok: false, reason: 'the general brief cannot be saved empty — a blank brief stops the generator entirely' };
    mkdirSync(BRIEF_DIR, { recursive: true });
    writeFileSync(generalPath(), String(general).replace(/\s*$/, '') + '\n');
    written.push(generalPath().replace(`${REPO}/`, ''));
  }
  if (filter != null) {
    if (!String(filter).trim()) return { ok: false, reason: 'the project filter cannot be saved empty — write the default fallback text instead if you mean "no filter"' };
    mkdirSync(BRIEF_DIR, { recursive: true });
    // An edit to a project's filter always lands on THAT PROJECT'S file, never on the shared
    // default — otherwise one session's focus silently becomes every other session's brief.
    const target = filterPathFor(slug);
    writeFileSync(target, String(filter).replace(/\s*$/, '') + '\n');
    written.push(target.replace(`${REPO}/`, ''));
  }
  if (!written.length) return { ok: false, reason: 'nothing to save — neither half was supplied' };
  return { ok: true, written };
}

// The machine contract. It stays in CODE and is deliberately NOT editable from the glass: the
// parser in propose-questions.mjs reads exactly these fields, and an operator who reworded this
// line would break the mint in a way that looks like the model failing.
export const OUTPUT_CONTRACT = [
  'Output STRICT JSON and nothing else:',
  '{"id":"Q-XXXX","question":"...","answers":[{"label":"one-word","rule":"...","tradeoff":"...","steer":"..."},{"label":"one-word","rule":"...","tradeoff":"...","steer":"..."}]}',
];

export const CONTEXT_PLACEHOLDER = '{{CONTEXT — the locked rules and recent working notes, inserted at mint time}}';
export const ANGLE_PLACEHOLDER = '{{ANGLE — one of the five angles, inserted at mint time}}';

/**
 * THE ONE COMPOSITION. Called with the real context/angle by the generator, and with the two
 * placeholders by the cockpit so the page renders the same document that gets sent.
 */
export function composeMintingPrompt({ context, angle, general, filter, examples = '' }) {
  return [
    'Here is the current specification of a project, as a set of locked rules, plus recent working notes.',
    '',
    context,
    '',
    `Propose exactly ONE question about this project that is still genuinely undecided, approached from this angle: ${angle}`,
    '',
    general,
    '',
    filter,
    // WORKED EXAMPLES GO LAST, nearest the output contract, because that is where a model looks
    // when it is about to write. They are generated from this brief's OWN previous output and
    // labelled by a deterministic measure — see question-quality.mjs/briefExamples for why prose
    // was not the missing ingredient (the brief already stated every rule these examples break).
    ...(examples ? ['', examples] : []),
    '',
    ...OUTPUT_CONTRACT,
  ].join('\n');
}

/** The rendered document for the glass: full text, with the per-run parts named rather than faked. */
export function previewMintingPrompt(slug) {
  const b = loadMintingBrief(slug);
  if (!b.ok) return b;
  return {
    ...b,
    composed: composeMintingPrompt({
      context: CONTEXT_PLACEHOLDER,
      angle: ANGLE_PLACEHOLDER,
      general: b.general, filter: b.filter, examples: b.examples,
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const r = previewMintingPrompt(slug);
  if (!r.ok) { console.error(`✗ ${r.reason}`); process.exit(2); }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(r.composed);
}
