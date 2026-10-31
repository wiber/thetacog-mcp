// scripts/ops/sheet-legibility.mjs — THE ONE PLACE THE SHEET LEGIBILITY RULES LIVE (operator 2026-10-22, verbatim: "we have rules for ths
// sheets to make them more legible - we need a central point for them, so all of them become as useful as possible, make it clear fast,
// scrolling for more context - start with bryan and marithas sheets").
//
// Before this file the rules sat in five places: board-lens.mjs FORMAT_RULES (F1–F9), sheet-tabs.mjs (S1–S5), board-layout.mjs (widths,
// frozen header), board-requirements.mjs (the share head and the comment lifecycle) and memory. Each sheet obeyed the ones its writer
// happened to import. Here they are stated once; every Rules tab prints them from this list (sheet-tabs.mjs, board-lens.mjs), and
// legibilityOf() measures the two that a header alone decides.
//
// THE PRINCIPLE: clear fast, scroll for context. The first screen tells a reader what each row is and whether it needs them; to the
// right is why, to the bottom is what matters less. Measured with the board's own widths (board-layout.mjs kindOf, SCREEN_PX), never
// guessed. LLM-free. Port row: presentation over records the board already holds — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { kindOf, SCREEN_PX, isHeaderRow } from './board-layout.mjs';

export const LEGIBILITY_RULES = [
  ['G1', 'CLEAR FAST: the first screen, with no sideways scroll, shows what each row is and whether it needs you.'],
  ['G2', 'SCROLL FOR CONTEXT: to the right is why and the detail; further down is what matters less. Answer first, context after.'],
  ['G3', 'THE TOP IS NOW: rows rank by priority, highest first; what is done or waiting sinks.'],
  ['G4', 'ONE THING PER CELL: short cells; only the one reading column stacks lines.'],
  ['G5', 'THE HEADER, THE ROW NAME AND YOUR COMMENT STAY FROZEN, so a scrolled cell still says which row it is and you can type as you scroll.'],
  ['G6', 'YOUR COMMENT IS THE SECOND COLUMN, beside the row name, marked (fill) and tinted. We never type in it; we answer beside it.'],
  ['G7', 'NOTHING INVENTED: a fact the record does not hold reads UNMEASURED.'],
  ['G8', 'KEEP A STRUCTURE THAT WORKS: a layout changes only on his words, and the change is made here first.'],
];

// THE NIGHT HOLD (operator 2026-10-22, /tend, from "The Man Nobody Can Provoke": Lincoln's unsent letter to Meade, 14 July 1863 —
// "lets write these rules into the dm sheets … and lets make sure we apply consistency rules consistently"). The watch hands a typed
// cell on within five minutes; nothing between his hand and the room held a word written hot. HOLD is that envelope. What was kept
// from the paste and what was not: the hold is his word, never a detector (a 20 % burn swing is a proxy for heat, not heat); it never
// releases itself on a timer (Lincoln decided, the clock did not); and a purge never leaves the record (AXIOM 1, evict or retain —
// DROP closes it with the why). The word is parsed in board-cell-words.mjs; board-watch.mjs, inbox-unworked.mjs and board-lens.mjs
// --act all pass it by. Printed on every internal Rules tab; never on a share sheet, where the watch hands nothing on anyway.
export const HOLD_RULES = [
  ['H1', 'THE NIGHT HOLD: start a cell with HOLD and nothing leaves it. The watch records it and hands it to nobody until you take HOLD off (it then goes on as typed) or write DROP. Held words stay on the record either way.'],
  ['H2', 'HOLD WHAT YOU WROTE HOT: a reply to a message that stung, a number moved the hour a bad invoice landed. Type it, HOLD it, read it after a night.'],
  ['H3', 'READ IT IN THREE PARTS: what happened · what you think it means · what you want done. The middle part is the one in dispute; send on what happened and ask about the rest.'],
  ['H4', 'HOLD IS NOT AVOID: a held reply to a person opens on what they gave and names when you will talk. It schedules the talk; it never skips it.'],
];

// The columns that say whether a row needs the reader: a status, an ask, a decision, a gate. One of them must sit on the first screen (G1).
export const NEEDS_YOU = /^(STATUS|WHAT WE ASK|AT ≥80 % WE DO|THE QUESTION|READY\?|FROM YOU|DONE WHEN|NOW|NEXT MOVE)\b/i;
export const NAMES_ROW = /^(TOPIC|WHAT IT IS|REQUIREMENT|HEADLINE|THE QUESTION|TITLE|NAME)\b/i;
export const COMMENT = /^(YOUR )?(COMMENT|NOTE) \(fill\)\s*$/i;   // NOTE (fill) is the comment column on the Horizons, Plan, Pillars and Finance sheets

// THE MIRROR (operator 2026-10-22: "can = point to col 2 from the last row" · "do it for all sheets"): every header block with its
// comment in B gets one last column whose cells read B back, so a reader scrolled to the far right still sees the comment. The
// formula is the same in every row (ROW() picks the row), so a re-rank never rewrites it, and a formula cell is never read as his edit
// (board-sheets-write.mjs editedDerived). The header carries no "(fill)": nobody types there.
export const MIRROR_HEAD = 'COMMENT (from col B)';
export const MIRROR_FORMULA = '=INDEX(B:B,ROW())';
export function commentMirror(grid) {
  let on = false, width = 0;
  return (grid || []).map((row) => {
    if (!Array.isArray(row)) return row;
    if (isHeaderRow(row)) {
      const base = row[row.length - 1] === MIRROR_HEAD ? row.slice(0, -1) : row;
      on = COMMENT.test(String(base[1] ?? '')); width = base.length;
      return on ? [...base, MIRROR_HEAD] : row;
    }
    if (!on) return row;
    const cells = [...row.slice(0, width), ...Array.from({ length: Math.max(0, width - row.length) }, () => '')];
    return String(row[0] ?? '').trim() ? [...cells, MIRROR_FORMULA] : [...cells, ''];
  });
}

/** The comment column of one header: the first COMMENT (fill) or NOTE (fill); -1 when the header has none. */
export const commentAt = (head) => (head || []).findIndex((h) => COMMENT.test(String(h ?? '')));

// G6 FOR EVERY SHEET, IN ONE PLACE (operator 2026-10-22, /tend: "update all sheets to put the comment column as the second column on all
// sheets - small is fine, we can freeze the col and scroll while typing"). Every header block in a composed grid has its comment column
// moved to second place, and every row under that header is permuted the same way, so a cell keeps its header. The writer keys typed
// cells by (row id, header), so his words ride along with the move (board-sheets-write.mjs mergeFills, C1197 relayout). Rows above the
// first header (the rules row) and a block with no comment column are left exactly as composed.
export function commentSecond(grid) {
  let perm = null;
  return (grid || []).map((row) => {
    if (!Array.isArray(row)) return row;
    if (isHeaderRow(row)) {
      const c = commentAt(row);
      perm = c > 1 ? [0, c, ...row.map((_, i) => i).filter((i) => i !== 0 && i !== c)] : null;
    }
    if (!perm) return row;
    const width = Math.max(row.length, perm.length);
    const full = [...perm, ...Array.from({ length: Math.max(0, width - perm.length) }, (_, k) => perm.length + k)];
    return full.map((i) => row[i] ?? '');
  });
}
const isFill = (h) => /\(fill\)\s*$/.test(String(h));

/** The left edge, in board pixels, of every column — the widths board-layout.mjs gives each header kind. */
export function edges(head) {
  let x = 0; return head.map((h) => { const at = x; x += kindOf(h).px; return at; });
}

/** Measure G1 and G6 off a header. Returns the breaks, each one sentence a person can act on; [] is legible. */
export function legibilityOf(head, { screenPx = SCREEN_PX } = {}) {
  const out = []; const at = edges(head);
  const onScreen = (re) => head.some((h, i) => re.test(String(h)) && at[i] + kindOf(h).px <= screenPx);
  if (!onScreen(NAMES_ROW)) out.push(`G1: no column naming the row (${NAMES_ROW.source}) ends inside the first ${screenPx} px`);
  if (!onScreen(NEEDS_YOU)) {
    const i = head.findIndex((h) => NEEDS_YOU.test(String(h)));
    out.push(i < 0 ? 'G1: no column says whether a row needs the reader' : `G1: "${head[i]}" starts at ${at[i]} px, past the first screen (${screenPx} px)`);
  }
  // G6, operator 2026-10-22: "the comment row may be the 2nd so it can be frozen as you scroll ... the right way to do it for all sheets".
  const c = head.findIndex((h) => COMMENT.test(String(h)));
  if (c < 0) out.push('G6: no COMMENT (fill) or NOTE (fill) column for the reader to type in');
  else if (c !== 1) out.push(`G6: the comment column is column ${c + 1}; it goes second, frozen beside the row name`);
  return out;
}
