// src/lib/backup/suggestion-box.mjs — C544 THE SUGGESTION BOX (operator 2026-10-01, verbatim: "something joicy like a
// autocomplete suggestion box.. drop a suggestion"). The pure half of the combobox inside the C540 underwriting terminal:
//   KINDS      the suggestions, filed by KIND — ThetaDriven warranty · insurer · broker · warrantor · captive · audit
//              committee / general counsel. Each kind points at a counterparties.json slot (by its desk) or, when the list has
//              no slot for it (captive), at the unlisted request with the kind's own words. No real carrier or broker is ever
//              pre-filled here: a name reaches the record only when the visitor types it.
//   filter     typing filters the kinds; any other text the visitor types (a carrier name, a domain, an email) becomes the
//              last option, "drop a suggestion", recorded as an unlisted-counterparty request in the visitor's own words.
//   keys       ↑ / ↓ / Enter / Esc as a pure step, so the keyboard contract is computed, not read off a handler's source.
//   slip       the intake slip shown after recording: manifest, rows by domain (adherence-tabs tabFields — the numbers the tab
//              card prints), rung counts off the tick record, the time the record answered, the notice and Rice, plainly.
// Every number is read off the backup; an absent one is UNMEASURED with its reason, never 0.
// SUFFICIENT FOR: what the visitor asked for and what the record held when they asked. NOT SUFFICIENT FOR: any cover, any
// price, or whether the work was good (Rice). Port row: none — string assembly and a cursor, no placement and no mass.
// @guard tests/vna/c544-something-joicy-like-a-autocomplete-suggestion.test.mjs
import { tabFields } from './adherence-tabs.mjs';

export const UNLISTED = 'unlisted';
export const SUGGESTION_MAX = 160;
export const NOTICE = 'A request for terms, not coverage: nothing is bound until both sides sign.';
export const RICE = 'Whether the output was good is undecidable (Rice, 1953). What is warranted when bound is the declared-scope deviation the tape DETECTS.';

const BASE = [
  { kind: 'warranty', label: 'ThetaDriven warranty', desk: 'warranty', words: ['thetadriven', 'warranty', 'us'] },
  { kind: 'insurer', label: 'An insurer', desk: 'insurer', words: ['insurer', 'insurance', 'carrier', 'cover'] },
  { kind: 'broker', label: 'A broker', desk: 'broker', words: ['broker', 'placement'] },
  { kind: 'warrantor', label: 'A warrantor', desk: 'warrantor', words: ['warrantor', 'warranty provider'] },
  { kind: 'captive', label: 'A captive', desk: null, words: ['captive', 'self-insure'] },
  { kind: 'audit', label: 'Your audit committee / general counsel', desk: null, words: ['audit', 'committee', 'general counsel', 'counsel', 'legal', 'gc'] },
];

/** the kinds, each bound to the first counterparties.json entry on its desk; no slot → the unlisted request in the kind's words */
export function suggestionKinds(list) {
  const rows = Array.isArray(list) ? list : [];
  return BASE.map((k) => {
    if (k.kind === 'audit') return { ...k, counterparty: null, action: 'binder' };
    const slot = k.desk ? rows.find((c) => c && c.desk === k.desk) : null;
    return slot ? { ...k, counterparty: slot.id, action: 'record' } : { ...k, counterparty: UNLISTED, text: k.label.toLowerCase(), action: 'record' };
  });
}

/** the visitor's words as stored: control characters out, whitespace collapsed, capped at SUGGESTION_MAX; '' when nothing is left */
export function cleanSuggestion(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SUGGESTION_MAX);
}

/** typing filters the kinds; any non-empty text that is not exactly a kind's label is offered last as "drop a suggestion" */
export function filterSuggestions(kinds, query) {
  const q = cleanSuggestion(query).toLowerCase();
  const hit = (k) => !q || k.kind.includes(q) || k.label.toLowerCase().includes(q) || k.words.some((w) => w.includes(q) || (q.length > 2 && q.includes(w)));
  const out = kinds.filter(hit);
  if (q && !kinds.some((k) => k.label.toLowerCase() === q)) {
    const text = cleanSuggestion(query);
    out.push({ kind: 'drop', label: `Drop a suggestion: "${text}"`, counterparty: UNLISTED, text, action: 'record', words: [] });
  }
  return out;
}

/** one keyboard step over n options: ↑/↓ move (wrapping) and open, Enter picks the active one, Esc closes */
export function comboKey(state, key, n) {
  const s = { active: state.active ?? -1, open: !!state.open };
  if (key === 'ArrowDown') return { active: n ? (s.active + 1) % n : -1, open: true, pick: null };
  if (key === 'ArrowUp') return { active: n ? (s.active <= 0 ? n - 1 : s.active - 1) : -1, open: true, pick: null };
  if (key === 'Enter') return { active: s.active, open: false, pick: s.open && s.active >= 0 && s.active < n ? s.active : null };
  if (key === 'Escape') return { active: -1, open: false, pick: null };
  return { ...s, pick: null };
}

const fieldText = (fields, key, missing) => {
  const f = fields.find((x) => x.key === key);
  if (!f) return `UNMEASURED — ${missing}`;
  return f.status === 'MEASURED' ? String(f.value) : `UNMEASURED — ${f.why}`;
};

/**
 * The intake slip, before recording (recorded_at and words null) — the terminal computes it off the backup and hands it down.
 * @param {{ manifest: string, tapes?: { points: any[] } | null, ticks?: any[] | null }} a
 */
export function intakeSlip({ manifest, tapes, ticks }) {
  const noTape = 'no backed-up tape was read for this manifest';
  const rows = ['coding', 'deployed'].map((tab) => {
    const fields = tapes ? tabFields(tapes, tab) : [];
    return { domain: tab.toUpperCase(), rows: fieldText(fields, 'rows', noTape), in_lane: fieldText(fields, 'in_lane', noTape), off_lane: fieldText(fields, 'off_lane', noTape) };
  });
  const ts = Array.isArray(ticks) ? ticks.filter((t) => t && t.rungs) : [];
  const rungs = ['rung1', 'rung2', 'rung3'].map((r) => {
    const with_ = ts.filter((t) => t.rungs[r]);
    return { rung: r, text: with_.length ? `${with_.length} ticks, ${with_.filter((t) => t.rungs[r].crossed).length} crossed` : `UNMEASURED — ${Array.isArray(ticks) && ticks.length ? `no tick on the backed-up record carries ${r}` : 'this archive carries no tick record'}` };
  });
  return { manifest: String(manifest || ''), rows, rungs, recorded_at: null, words: null, notice: NOTICE, rice: RICE };
}

/** the slip once the record answered: the row's own time and the visitor's own words, as stored */
export function recordedSlip(slip, row) {
  return { ...slip, recorded_at: row && row.at ? String(row.at) : null, words: row && row.suggestion ? String(row.suggestion) : null, counterparty: row ? row.counterparty : null };
}
