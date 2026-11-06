// scripts/ops/rooms-clarity.mjs — THE CLARITY OF ONE ROOMS ROW, read off the record with no model. Operator 2026-11-05, on the Rooms sheet:
// "They vary in quality. A lot of the high priority ones are low quality. A lot of the other ones should have just been done. I guess that's
// a clarity. So maybe we need another category or column". The grade (cuo1's itemisation, docs/specs/vna/rooms-clarity-2026-11-05.txt),
// one point each unless named: his words are on the row (2) · its guard exists on disk (1) · its text is not build notes or a paste
// chunk (1) · its plain head says a worker can build it — FROM YOU: nothing (1). CLEAR 4+ · PARTIAL 2–3 · MURKY 0–1.
// A MURKY row never shows at PRIORITY 7+ (board-priority.mjs RULES.Rooms): it goes back to its room for a rewrite in his words first,
// the C1030 rule — an unready row is sent back, never shown.
// Port row: presentation over records the board already reads — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
export const CLEAR_AT = 4;
export const PARTIAL_AT = 2;
export const MURKY_CAP = 6;
// a row whose text opens on its build or declare stamp, or is a pasted chunk (a P-<date>- slug, or released from a pending paste)
export const BUILD_NOTES = /^\s*\(?(?:built|declared|released)\b|^\s*P-\d{4}-\d\d-\d\d-|\bfrom pending P\d+/i;
export function clarityOf({ span = null, guard = null, body = '', head = null } = {}, { exists = () => false } = {}) {
  let pts = 0; const why = [];
  // each missing point is said as what is left to FINISH (operator 2026-11-05: "clarity/finish may be needed to be a column")
  if (span) pts += 2; else why.push('needs your words');
  if (guard && exists(guard)) pts += 1; else why.push('needs a guard');
  if (String(body).trim() && !BUILD_NOTES.test(String(body))) pts += 1; else why.push('text is build notes');
  const fy = head && head.head ? String(head.head.from_you || '').trim() : '';
  if (/^nothing\b/i.test(fy)) pts += 1; else why.push(fy ? 'needs your answer' : 'needs a plain head');
  const grade = pts >= CLEAR_AT ? 'CLEAR' : pts >= PARTIAL_AT ? 'PARTIAL' : 'MURKY';
  return { pts, grade, why: why.length ? why.join(' · ') : 'ready' };
}
export const CLARITY_COL = 'CLARITY / FINISH';
export const clarityCell = (c) => `${c.grade} · ${c.why}`;
export const isMurky = (cell) => /^MURKY\b/.test(String(cell || ''));
