// src/lib/receipt-sufficiency.mjs — C611o EVERY PUBLIC RECEIPT SAYS WHAT IT IS NOT SUFFICIENT FOR.
//
// The boundary probe, run on us (C611l PART 4 paste 1 ASK-FOR-US; C611m): a page or card that shows a receipt, a
// reading or a verdict carries ONE line naming what the receipt is sufficient for and what it is NOT. The house pair:
// where it landed is re-runnable; whether the work was good is undecidable (Rice, 1953). This module is the one place
// that line lives (ONE RULE LIVES IN ONE PLACE): the web component (src/components/receipt/SufficiencyLine.tsx), the
// SVG cards (scripts/vna/money-shot.mjs, scripts/vna/infographic-ledger.mjs) and the guard all read it from here.
//
// A surface may name its own, narrower halves (the /backup/how notary pair, a ledger's own scope); the NOT half then
// always keeps the Rice clause — a surface-specific not-half that drops it gets the house clause appended, never lost.
//
// RECEIPT_SOURCES is what makes a file a receipt-rendering surface: it LOADS a receipt (an import of a receipt module, a
// fetch of a receipt API, a file read of a receipt path) — a prose mention of a path in a comment or a <code> tag does not
// count. tests/vna/c611o-every-public-receipt-says-what-it-is-not-sufficient-for.test.mjs enumerates the surfaces with it.
//
// SUFFICIENT FOR: telling a reader which question a receipt answers and which it does not, in the same words everywhere.
// NOT SUFFICIENT FOR: whether any given receipt is right (its own guard holds that) — or whether the work was good (Rice).
// @guard tests/vna/c611o-every-public-receipt-says-what-it-is-not-sufficient-for.test.mjs

export const RECEIPT_SUFFICIENT_FOR = 'where it landed, re-runnable from the commit: same bytes, same hash';
export const RECEIPT_NOT_SUFFICIENT_FOR = 'whether the work was good, which is undecidable (Rice, 1953); nothing here claims it';
// C847 (backup trials 2026-10-14: no persona could read "Rice, 1953"): the one plain-words gloss, rendered beside every RICE_CLAUSE.
export const RICE_GLOSS = 'Rice (1953): no program can decide, in general, whether another program is correct.';
export const RICE_CLAUSE = 'whether the work was good is undecidable (Rice, 1953)';

const clean = (s) => String(s ?? '').trim().replace(/[.\s]+$/, '');

/** Both halves, never one. A blank half takes the house half; a NOT half without Rice gets the Rice clause appended. */
export function sufficiencyPair({ sufficientFor, notSufficientFor } = {}) {
  const suff = clean(sufficientFor) || RECEIPT_SUFFICIENT_FOR;
  let not = clean(notSufficientFor) || RECEIPT_NOT_SUFFICIENT_FOR;
  if (!/\bRice\b/.test(not)) not = `${not}; ${RICE_CLAUSE}`;
  return { sufficientFor: suff, notSufficientFor: not };
}

/** The one line, as plain text: "Sufficient for: … NOT sufficient for: …." */
export function sufficiencyLine(opts = {}) {
  const { sufficientFor, notSufficientFor } = sufficiencyPair(opts);
  return `Sufficient for: ${sufficientFor}. NOT sufficient for: ${notSufficientFor}.`;
}

/** Does a rendered text carry both halves of the line, with the Rice clause in the NOT half? */
export function carriesBothHalves(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const m = /Sufficient for:\s*(.+?)\s*Not sufficient for:\s*(.+)/i.exec(t);
  return !!(m && m[1].trim().length > 3 && /\bRice\b/.test(m[2]));
}

/** What makes a source file a receipt-rendering surface: a LOAD of a receipt, never a mention. */
export const RECEIPT_SOURCES = Object.freeze([
  { kind: 'import', re: /^@\/lib\/(backup|pmu)\//, why: 'a receipt or reading module (the backup readings, the L1 reading)' },
  { kind: 'import', re: /^@\/lib\/(postPanels|commitGreeks)$/, why: "a commit's encircled panel and its greeks" },
  { kind: 'import', re: /commit-receipts-index(\.json)?$/, why: 'the commit receipts index' },
  { kind: 'import', re: /(^|\/)data\/pmu\//, why: 'a sealed PMU ledger or calibration' },
  { kind: 'fetch', re: /\/api\/(receipt|pmu|backup)(\/|$|\?)/, why: 'a receipt, PMU or backup API' },
  { kind: 'read', re: /(^|\/)(data\/pmu\/|docs\/pmu\/commit-panels|\.thetacog\/lens-receipts)/, why: 'a receipt file on disk' },
]);

/** Strip comments so a path named in prose never makes a surface. One left-to-right pass: a string literal is kept whole
 *  (so '://' or '/*' inside a string is never read as a comment); a block or line comment is dropped. */
export function stripComments(src) {
  return String(src).replace(/(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (m, block, line, str) => (str !== undefined ? str : ''));
}

/** The receipt loads in one source file: [{ kind, spec, why }]. */
// C865 (2026-10-15): a COPY module is frozen strings that read no record (positioning-lines, plain-lines); loading one paints
// words, never a receipt, so it is not a receipt load. Narrowed with the argument, never tuned: the construct is "renders a receipt".
export const COPY_MODULES = /^@\/lib\/backup\/(positioning-lines|plain-lines|deployed-agent-reader-line|checkout-terms)\.mjs$/;   // C934's door line is copy too; C1259: checkout-terms is two frozen lines (C1022), reads no record
export function receiptLoads(src) {
  const code = stripComments(src);
  const out = [];
  const push = (kind, spec) => { if (kind === 'import' && COPY_MODULES.test(spec)) return; for (const s of RECEIPT_SOURCES) if (s.kind === kind && s.re.test(spec)) out.push({ kind, spec, why: s.why }); };
  for (const m of code.matchAll(/\bfrom\s*(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g)) push('import', m[2] ?? m[4]);
  for (const m of code.matchAll(/\bfetch\s*\(\s*(['"`])([^'"`]*)\1/g)) push('fetch', m[2]);
  for (const m of code.matchAll(/\b(?:readFileSync|readFile|existsSync|join|resolve)\s*\(([^\n;]*)/g))
    for (const s of m[1].matchAll(/(['"`])([^'"`]*)\1/g)) push('read', s[2]);
  return out;
}
