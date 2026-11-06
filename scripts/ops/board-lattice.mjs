#!/usr/bin/env node
// scripts/ops/board-lattice.mjs — C1026: THE LATTICE TAB — a 12×12 count map of the board's own rows,
// placed by the one Rust walk (board.mjs's placeItems, C1020f). A cell holds the COUNT of rows whose
// coordinate falls there; its dominant word comes from comparing the walk's own in_role/out_of_role
// counts for each row (in > out → "in lane", in < out → "off lane", in == out and both nonzero →
// "edge") — a comparison, never a typed sigma cutoff. A row the walk refused (no coord) never enters a
// block; it is tallied once, in the one UNMEASURED bucket, never guessed into a cell.
// This is a COUNT map of placements, not a panel — a claim about where prose lands still reads the
// 144×144 encircled panel (scripts/pmu/triptych-render.mjs), never this grid.
// Operator 2026-10-19, relayed by wo1 bf-6380, mesh_fdf3631e-f4f.
// @guard tests/ops/c1026-the-lattice-tab.test.mjs

export const LATTICE_TAB = 'Lattice';
// the 12 ShortLex labels a board coordinate's two halves are drawn from (data/pmu/snippet-library-144.json:
// every coord is "<label>,<label>" over exactly this 12-value set) — the coordinate vocabulary, not a tuned
// threshold, so pinning it here is not the thing C1026 forbids.
export const LATTICE_AXIS = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export const BAND = { IN: 'in lane', EDGE: 'edge', OFF: 'off lane' };
export const UNMEASURED = 'UNMEASURED';

/** a row's band, read off the walk's own in_role/out_of_role arrays — a count comparison, never a cutoff. */
export function bandOf(result) {
  const inA = result && Array.isArray(result.in_role) ? result.in_role : null;
  const outA = result && Array.isArray(result.out_of_role) ? result.out_of_role : null;
  if (!inA || !outA || inA.length + outA.length === 0) return null;
  return inA.length > outA.length ? BAND.IN : inA.length < outA.length ? BAND.OFF : BAND.EDGE;
}

/**
 * Groups placed items (each carrying .id, .coord, .band — the shape placeItems leaves on a row) into the
 * 12×12 lattice plus one UNMEASURED bucket. An item with no .coord (the walk refused) is NEVER folded into
 * a cell; it lands only in `unmeasured`.
 */
export function buildLattice(items) {
  const cells = new Map();
  const unmeasured = { count: 0, ids: [] };
  for (const it of items || []) {
    if (!it || !it.coord) { unmeasured.count++; if (it && it.id) unmeasured.ids.push(it.id); continue; }
    const c = cells.get(it.coord) || { coord: it.coord, count: 0, in: 0, edge: 0, off: 0, unmeasured: 0, ids: [] };
    c.count++; c.ids.push(it.id);
    if (it.band === BAND.IN) c.in++;
    else if (it.band === BAND.OFF) c.off++;
    else if (it.band === BAND.EDGE) c.edge++;
    else c.unmeasured++;
    cells.set(it.coord, c);
  }
  return { cells, unmeasured };
}

/** the one word a cell is "coloured" by — the band carrying the most rows; a tie at the top reads edge. */
export function dominantBand(cell) {
  if (!cell || cell.count === 0) return null;
  if (cell.unmeasured === cell.count) return UNMEASURED;
  const { in: i, edge: e, off: o } = cell;
  const top = Math.max(i, e, o);
  if (top === i && i > o) return BAND.IN;
  if (top === o && o > i) return BAND.OFF;
  return BAND.EDGE;
}

const cellText = (cell) => {
  if (!cell || cell.count === 0) return '';
  const mix = [cell.in && `${cell.in} in lane`, cell.edge && `${cell.edge} edge`, cell.off && `${cell.off} off lane`, cell.unmeasured && `${cell.unmeasured} band-UNMEASURED`].filter(Boolean).join(' · ');
  return `${cell.count} — ${dominantBand(cell)}${mix ? ` (${mix})` : ''}`;
};

/** the Questions tab filtered to one block (Google Sheets QUERY over its COORDINATE (the walk) column, I). */
export const questionsFilterFormula = (coord) => `=QUERY(Questions!A:Q,"select A,E,K,L where I = '${coord}'",1)`;

/** the tab, as a 2D array — row 0 is the column half of the coordinate, column 0 the row half; the last row/column is UNMEASURED. */
export function latticeRows(items) {
  const { cells, unmeasured } = buildLattice(items);
  const head = ['', ...LATTICE_AXIS, 'UNMEASURED (walk refused)'];
  const rows = [head];
  for (const a of LATTICE_AXIS) {
    const row = [a];
    for (const b of LATTICE_AXIS) row.push(cellText(cells.get(`${a},${b}`)));
    row.push('');
    rows.push(row);
  }
  const tail = new Array(LATTICE_AXIS.length + 1).fill('');
  tail.push(unmeasured.count ? `${unmeasured.count} — ${unmeasured.ids.slice(0, 20).join(', ')}${unmeasured.ids.length > 20 ? '…' : ''}` : '0');
  rows.push(tail);
  rows.push([]);
  rows.push(['EACH CELL, FILTERED', 'a cell\'s rows are the Questions-tab rows whose COORDINATE (the walk) equals the row,column pair — e.g. for row A, column A1 that is coordinate "A,A1"']);
  rows.push(['Read one block', questionsFilterFormula('A,A1')]);
  return rows;
}
