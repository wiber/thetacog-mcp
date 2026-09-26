// scripts/vna/intent-rows.mjs — C311: THE INTENT PANEL READS THE ROWS THE COMMIT SERVES, NOT A
// DENSE WINDOW OF THE WHOLE SPEC.
//
// THE DEFECT (measured by the chair, cad904b9a): `itemizedSpec()` in cockpit.mjs was written for "a
// few KB of pure claim" and the spec has grown to ~1 MB / 674 items. The aperture cuts that to 1.4%
// and `pickWindow` keeps the densest window of whatever survives the cut — on cad904b9a (a
// walking-prompt commit touching src/lib/llm/ask-prompt.mjs) the window that won was C84g C46 C47 C85
// C85a, five rows the commit never named and never touched. The red band on the INTENT panel was
// those five rows' own self-dispersion, not the commit's declaration — a length artifact wearing the
// receipt's clothes.
//
// THE FIX. Read the rows the commit actually SERVES, first rule that yields rows wins:
//   1. message  — the C-ids the commit message names, in the order named (only ones that exist as rows)
//   2. paths    — rows whose declared `paths:` glob covers a changed file (declared-reading.mjs coveredBy)
//   3. goal     — the /goal in force's OPEN units' labels
//   4. window   — nothing matched; the old whole-spec itemized text, LABELLED as the fallback it is —
//                 never silently substituted for a real reading.
//
// PURE OVER ITS ARGUMENTS — no fs, no git, no clock. The caller (cockpit.mjs) reads the spec file, the
// commit message, the changed paths and the /goal's unit list; this module only decides which rows
// answer. That is what makes it testable without running the top-level walk.
//
// C311 → Rust port pending (decides a placement — MAXIMISE RUST rule; prototyped here first).
import { declaredRows, coveredBy } from '../../src/lib/pmu/declared-reading.mjs';
import { parseChecklist, parseOpenQuestions } from './spec-render.mjs';

const MSG_ID_RE = /\bC\d{1,4}[a-z]?\b/g;

/** the whole-spec itemized text — byte-for-byte the same formula cockpit.mjs's itemizedSpec() used
 *  before this row: every checklist line, every ##/### heading, every open question. This is the
 *  LABELLED FALLBACK (rule 'window'), never the default. */
export function windowFallbackText(specMd) {
  const md = String(specMd || '');
  const items = parseChecklist(md).map((i) => i.id + ' ' + i.text);
  const heads = md.split('\n').filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+ /, ''));
  const qs = parseOpenQuestions(md).map((q) => q.id + ' ' + q.text);
  return [...heads, ...items, ...qs].join('\n');
}

/**
 * intentRowsFor({ message, changedFiles, specMd, goalUnits }) → { rule, ids, text }
 *   message      — the commit message (or the drafted preview message)
 *   changedFiles — the paths this commit (or the preview's tree diff) touched
 *   specMd       — the raw SPEC-VNA-COCKPIT.md text
 *   goalUnits    — goalStatus().units shape: [{ done, labels: [id...], open: [id...] }, ...] or []
 *
 * `text` for rules message/paths/goal is each chosen row's full itemized line — `id + ' ' + text`,
 * the same format itemizedSpec() always used — joined one per line, so the intent corpus stays "a few
 * KB of pure claim" no matter how large the spec has grown. `text` for rule 'window' is the labelled
 * whole-spec fallback; `ids` is empty because nothing was matched, not because nothing exists.
 */
export function intentRowsFor({ message = '', changedFiles = [], specMd = '', goalUnits = [] } = {}) {
  const rows = declaredRows(specMd);
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  const itemized = (ids) => ids.map((id) => byLabel.get(id).text).join('\n');

  // RULE 1 — the C-ids the commit message names, first-seen order, only ones that exist as rows.
  const seen = new Set();
  const named = [];
  for (const m of String(message || '').match(MSG_ID_RE) || []) {
    if (byLabel.has(m) && !seen.has(m)) { seen.add(m); named.push(m); }
  }
  if (named.length) return { rule: 'message', ids: named, text: itemized(named) };

  // RULE 2 — rows whose declared paths cover a changed file (order: as coveredBy first hits them).
  if (rows.length && changedFiles?.length) {
    const { byRow } = coveredBy(changedFiles, rows);
    const ids = [...byRow.keys()];
    if (ids.length) return { rule: 'paths', ids, text: itemized(ids) };
  }

  // RULE 3 — the /goal in force's OPEN units. An open unit's still-open labels stand for it; if every
  // label already ticked in the spec but the unit is not yet marked done (an 'unknown' label), fall
  // back to the unit's full label list rather than reporting an open unit with zero rows.
  const goalIds = [];
  const goalSeen = new Set();
  for (const u of goalUnits || []) {
    if (u.done) continue;
    const labels = (u.open && u.open.length) ? u.open : (u.labels || []);
    for (const id of labels) {
      if (byLabel.has(id) && !goalSeen.has(id)) { goalSeen.add(id); goalIds.push(id); }
    }
  }
  if (goalIds.length) return { rule: 'goal', ids: goalIds, text: itemized(goalIds) };

  // RULE 4 — nothing matched. The old whole-spec window, LABELLED as the fallback it is.
  return { rule: 'window', ids: [], text: windowFallbackText(specMd) };
}
