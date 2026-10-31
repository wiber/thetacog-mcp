// scripts/ops/board-layout.mjs — THE BOARD LAYOUT: one rule for every column on every tab, keyed off the header's own name.
// Operator 2026-10-19, verbatim: "go through all the drive shets and organize them, cell widths wrap and make the specs make sense -
// reacon about what the human user would need for the sheet to be useful (almost all are pointlessly entropy only low signal now".
//
// The board carries two readers in one grid. HE reads to decide (what is it, how urgent, what does it need from me, where do I type).
// THE MACHINE reads to join (a row id, a spec:line, a walk coordinate, a tile snippet, a sha, a path). Both stay in the sheet — the
// pull joins his cells back by id and the walk coordinate is the receipt of placement — but only his columns are open to the eye.
// Every machine column is grouped and COLLAPSED (one click on the + above it opens it), never deleted, so a CSV export still carries it.
//
// Why the board read as entropy: the columns were chosen by what was cheap to count off the record, not by what he decides with.
// The TILE column is the clearest case: it prints the 144-tile library's stock sentence at the walked coordinate ("Latency is the
// price of a missed beat.") — the walk (gzip-NCD over the lattice) needs only the coordinate; the sentence beside it is the anchor's
// seed text, which is SUFFICIENT FOR "which tile did it land on" and NOT for "what is this question" (AXIOM 1, W6).
//
// LLM-FREE. Pure functions here; scripts/ops/board-sheets-format.mjs applies them in place to the live sheets (same links).
// Port row: transport/presentation over records the board already holds — stays node (CLAUDE.md MAXIMISE RUST: what stays node).

// Column kinds, in the order a rule is tried. First match wins. px = Google Sheets pixels.
export const KINDS = [
  // C1042f: READY? — the one colour that says whether a row can be decided now (green READY · grey FORMULATING), the same on every sheet.
  { kind: 'state', test: /^READY\?$/, px: 110, wrap: false, center: true },
  // his cells: where he types. Wide enough to write in, wrapped, tinted so "yours" is visible at a glance.
  { kind: 'fill', test: /^(GRADE 0–9|PRIORITY|BY|CHANGE IT 0–9|CHANGE CLARITY 0–9) \(fill\)\s*$/i, px: 72, wrap: true, center: true },
  { kind: 'fill', test: /\(fill\)\s*$/i, px: 180, wrap: true },
  { kind: 'priority', test: /^(PRIORITY 0–9|CLARITY 0–9 \(our guess\)|PRIORITY 0–9 \(our guess\))$/, px: 64, wrap: false, center: true },
  // what the machine joins on — collapsed under a group, kept for the pull and the receipt.
  { kind: 'machine', test: /^(WHY \(derived\)|CLASS$|COORDINATE|TILE AT|WHERE|GUARD$|RECEIPT$|HOME$|PATH$|COMMIT$|THE ROW \(full text\)|LATEST AT$|PID$|LINE$)/i, px: 140, wrap: false, hidden: true },
  // a link: clipped one line, so a long URL never makes a row tall; the cell stays clickable.
  { kind: 'link', test: /(SPEC SHEET|^LIVE$|LINK|URL)/i, px: 150, wrap: false },
  // a month column on the Calendar sheet (board-calendar.mjs): every day clips to one line, however much it holds (operator 2026-10-20:
  // "This one needs text in cells clipped" · "More text is better if clipped this is for editing and for context").
  { kind: 'month', test: /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d{4}$/, px: 140, wrap: false, clip: true },
  // C1143 a quarter column on the Weeks sheet (board-weeks.mjs): twelve of them beside the 110 px ID column fill SCREEN_PX exactly, so three
  // years sit on one screen (operator 2026-10-21: "need to cover the screen … clip … one or two lines of text only"). WEEK_PX below.
  { kind: 'week', test: /^\d{4} Q[1-4]\b/, px: 107, wrap: false, clip: true },
  // TOPIC names the row on the person sheets (sheet-legibility.mjs NAMES_ROW). It is read to decide, so the one-screen squeeze never takes it
  // to a 60 px clip (Bryan's Share sheet, 2026-10-22: "How to use this sheet" in a 55 px column, four lines tall). fixed: the width stands.
  { kind: 'prose', test: /^TOPIC$/, px: 170, wrap: true, fixed: true },
  // the row's name: short, never wrapped, always visible (frozen as the first column).
  { kind: 'id', test: /^(ID\b|OPEN ROWS$|ROOM$|EDITION$|DAY$|TIME$|RECENT COMMITS$|LIVE CLAIMS$|THETACOG BOARD$)/, px: 110, wrap: false },
  // a 12-canonical axis label ("A1 · Law"): a narrow, centred count column on the Map.
  { kind: 'short', test: /^[A-C][1-3]? · /, px: 84, wrap: true, center: true },
  // C1197 the reader layout (board-lens.mjs person.layout = 'reader'): a narrow row number, and READ THIS — the links, one per line —
  // the widest column on the sheet.
  { kind: 'id', test: /^#$/, px: 44, wrap: false, center: true },
  { kind: 'prose', test: /^READ THIS$/, px: 380, wrap: true, fixed: true },   // fixed: a column of links is not prose by word count, and fitColumns must not shrink it to the 220 px ceiling
  // what a person reads to decide: the widest, wrapped.
  { kind: 'prose', test: /(^REQUIREMENT$|^YOU COME HERE FOR|^IT IS ORGANIZED AS|^YOUR WORDS|^PRIOR|^PRESENT|^FUTURE|QUESTION|DONE WHEN|^NOW$|HEADLINE|WHAT IT (SAYS|IS)|^RULE|TITLE|SUBJECT|THE PERSON|THEIR JOB|SCHEDULE|^RULES|^NOTE$|SUMMARY|^WHAT IT IS|^WHY IT IS YOURS|^WHAT WE ASK)/i, px: 260, wrap: true },
  { kind: 'context', test: /(SPEC ROWS|TERMINAL|WHY THIS PRIORITY|FROM YOU|WAITS ON|WHAT IT NEEDS|STATUS|^OWNER|PROJECT|PERSONA|OWNED|ENFORCEMENT|NAME|WHO|THEME|EVENTS|PAGES|ADDRESS|SECTION|ROUTE|SESSION)/i, px: 150, wrap: true },
  // short facts: a class, a count, a date, a version.
  { kind: 'short', test: /(^STATE$|CLASS|KIND|SIDE|VERSION|COUNT|SENDS|EMAILS|IMPORTANCE|DATE|LAST|STARTED|WEEKDAY|TIMED|OPEN|FOR YOU|CLAIMS|^AT$|SENT|BOOK CLUB|ROOMS|\d{4}-\d{2}-\d{2})/i, px: 96, wrap: true },
];
export const DEFAULT = { kind: 'context', px: 160, wrap: true };

// A header row: the row a table block starts on. The board's tables open on an id-ish first cell, or carry a "(fill)" column.
export function isHeaderRow(row) {
  if (!Array.isArray(row) || row.filter((v) => String(v ?? '').trim()).length < 2) return false;
  const first = String(row[0] ?? '');
  return /^(ID\b|ID \(|#$|OPEN ROWS$|ROOM$|EDITION$|DAY$|TIME$|PROJECT$|RECENT COMMITS$|LIVE CLAIMS$|SESSION ID$)/.test(first) || row.some((v) => /\(fill\)\s*$/.test(String(v ?? '')));
}

// G5/G6 (sheet-legibility.mjs, operator 2026-10-22: "the comment row may be the 2nd so it can be frozen as you scroll ... thats likely the
// right way to do it for all sheets actually, you can type as you scroll"): the row name is frozen, and so is a (fill) column sitting second.
// The header may sit under the sheet's rules row (board-rules-row.mjs withRulesRow puts it in row 1), so the columns freeze whenever a
// header opens the first or second row; a key/value page freezes nothing.
export function frozenColsFor(grid) {
  const g = grid || []; const head = [g[0], g[1]].find(isHeaderRow); if (!head) return 0;
  return /\(fill\)\s*$/.test(String(head[1] ?? '')) ? 2 : 1;
}
// "small is fine" (operator 2026-10-22): the frozen comment column is narrow, so the frozen pane leaves the screen to the row.
export const COMMENT_SECOND_PX = 120;

export function kindOf(header) {
  const h = String(header ?? '').replace(/\s+/g, ' ').trim();   // a header typed across two lines ("PRIORITY \n0–9") is the same header
  if (!h) return { ...DEFAULT, kind: 'blank', px: 40, wrap: false };
  for (const k of KINDS) if (k.test.test(h)) { const { test, ...rest } = k; return rest; }
  return { ...DEFAULT };
}

// The layout for one tab: the widest rule any header row in it asks for, per column (a project tab stacks several tables in one grid,
// and column C is a HEADLINE in one block and a SUBJECT in the next). A column is hidden only when EVERY block calls it machine.
export function layoutFor(rows) {
  const heads = rows.filter(isHeaderRow);
  const width = Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  if (!heads.length) {
    // A key/value page (Overview, a project's header lines): label left, the value wide and wrapped.
    return fitColumns(Array.from({ length: width }, (_, i) => (i === 0 ? { kind: 'id', px: 240, wrap: true } : i === 1 ? { kind: 'prose', px: 720, wrap: true } : { ...DEFAULT })), rows);
  }
  const fit = fitColumns(Array.from({ length: width }, (_, c) => {
    const ks = heads.map((h) => kindOf(h[c])).filter((k) => k.kind !== 'blank');
    if (!ks.length) return { kind: 'blank', px: 40, wrap: false };
    const pick = ks.reduce((a, b) => (b.px > a.px ? b : a));
    return { ...pick, hidden: ks.every((k) => k.hidden) };
  }), rows);
  if (frozenColsFor(rows) === 2 && fit[1] && fit[1].kind === 'fill') fit[1] = { ...fit[1], px: Math.min(fit[1].px, COMMENT_SECOND_PX) };
  // THE TWO FROZEN COLUMNS (operator 2026-10-22, a screenshot of the Messages sheet: "keep this formatting for all sheets, first col is
  // wrap, seocnd clip"): the row name wraps inside its narrow frozen column, and the second column clips to one line, so a long note
  // typed there never makes the row a page tall. Every table sheet, whatever kind its headers ask for.
  // Wrap is for phrases, never a token: the first column is at least as wide as its longest single word ("B-00" broke as "B- / 00").
  if (fit[0] && !fit[0].hidden) fit[0] = { ...fit[0], wrap: true, px: Math.max(fit[0].px, Math.min(200, bodyWordPx(rows, 0))) };
  if (fit[1] && !fit[1].hidden) fit[1] = { ...fit[1], wrap: false };
  return fit;
}

// C1041g — SIZE BY CONTENT, CLIP WHAT IS NOT SUBSTANCE, FIT ONE SCREEN (board spec R-47 · R-48 · R-49; operator 2026-10-20, verbatim:
// "rules for how to color and size … something that can be done algorithm use overflow clip on everything that doesn't have the actual
// substance … minimize the size of them so that you don't have to scroll sideways all the time the whole point is to be able to get an
// overview so you can make decisions"). The header picks the KIND; the cells under it pick the WIDTH and whether it wraps.
//   SUBSTANCE = a sentence a person reads to decide: six words or more, most of them words (not ids, states, dates, paths, hashes).
//   A column whose cells are mostly not substance CLIPS to one line and is as narrow as its typical cell. A substance column wraps,
//   sized to its typical cell within [220, 420]. Then the visible columns are scaled down until they fit SCREEN_PX, never below a floor.
export const SCREEN_PX = 1400; export const CH_PX = 7; export const PAD = 16;
// C1143: the Weeks sheet math — floor((SCREEN_PX − 110 ID) / 12) = 107 px a quarter column; floor((107 − PAD) / CH_PX) = 13 characters a line.
export const WEEK_PX = Math.floor((SCREEN_PX - 110) / 12); export const WEEK_LINE_CH = Math.floor((WEEK_PX - PAD) / CH_PX);
export function isSubstance(v) {
  const words = String(v ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  const plain = words.filter((w) => /^[("'“]?[A-Za-z][A-Za-z’'-]*[)"'”,.;:?!…]*$/.test(w)).length;
  return plain / words.length >= 0.6;
}
const q = (xs, p) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
// A column is never narrower than the longest single word of its header, in bold (operator 2026-10-21, a screenshot of the Business
// Plan: "HORIZON" broke as "HORIZO / N" in a 46 px column). Wrapping is for phrases; a word split across lines reads as a typo.
export const BOLD_CH_PX = 8;
export function headWordPx(rows, c) {
  const words = rows.filter(isHeaderRow).flatMap((h) => String(h[c] ?? '').replace(/\(fill\)\s*$/i, '').split(/\s+/)).filter(Boolean);
  return words.length ? Math.max(...words.map((w) => w.length)) * BOLD_CH_PX + PAD : 0;
}
export function bodyWordPx(rows, c) {
  const words = rows.filter((r) => Array.isArray(r) && !isHeaderRow(r)).flatMap((r) => String(r[c] ?? '').split(/\s+/)).filter(Boolean);
  return words.length ? Math.max(...words.map((w) => w.length)) * CH_PX + PAD : 0;
}
export function fitColumns(layout, rows, opts = {}) {
  const fit = fitColumnsRaw(layout, rows, opts);
  return fit.map((l, c) => (l.hidden || l.kind === 'blank' ? l : { ...l, px: Math.max(l.px, headWordPx(rows, c)) }));
}
function fitColumnsRaw(layout, rows, { budget = SCREEN_PX } = {}) {
  const body = rows.filter((r) => Array.isArray(r) && !isHeaderRow(r) && r.filter((v) => String(v ?? '').trim()).length >= 2);
  const out = layout.map((l, c) => {
    if (l.kind === 'fill' || l.kind === 'blank' || l.hidden || l.kind === 'priority') return l;
    if (l.fixed) return { ...l, substance: true };   // C1197: the kind's width stands, measured or not
    const cells = body.map((r) => String(r[c] ?? '').trim()).filter(Boolean);
    if (cells.length < 2) return l;   // nothing to measure: the kind's width stands
    if (l.clip) return { ...l, wrap: false, substance: false };   // a clip kind never wraps and keeps its width, whatever its cells hold
    const sub = cells.filter(isSubstance).length / cells.length;
    const typical = q(cells.map((s) => s.length), 0.8);
    if (sub >= 0.5) return { ...l, wrap: true, px: Math.max(220, Math.min(420, Math.round(Math.sqrt(typical) * 38))), substance: true };
    return { ...l, wrap: false, px: Math.max(60, Math.min(220, typical * CH_PX + PAD)), substance: false };
  });
  // One screen: shrink the visible, non-fill columns toward their floors (clip 60, substance 200, the first column 90) until it fits.
  const vis = out.map((l, i) => ({ l, i })).filter(({ l }) => !l.hidden);
  const total = vis.reduce((s, { l }) => s + l.px, 0);
  if (total <= budget) return out;
  const floor = (l, i) => (l.fixed ? l.px : i === 0 ? 90 : l.kind === 'fill' ? l.px : l.substance || (l.substance === undefined && l.wrap) ? 200 : 60);   // an unmeasured wrapping column is read as substance
  const room = vis.reduce((s, { l, i }) => s + (l.px - floor(l, i)), 0);
  const k = room > 0 ? Math.min(1, (total - budget) / room) : 0;
  return out.map((l, i) => (l.hidden || l.kind === 'fill' ? l : { ...l, px: Math.floor(l.px - (l.px - floor(l, i)) * k) }));   // floor, never round: nine half-pixel roundings put the Terminals sheet 4 px over
}

// Contiguous runs of hidden columns: each becomes one collapsed column group (Sheets groups only adjacent columns).
export function hiddenRuns(layout) {
  const runs = []; let s = -1;
  layout.forEach((l, i) => { if (l.hidden && s < 0) s = i; if (!l.hidden && s >= 0) { runs.push([s, i]); s = -1; } });
  if (s >= 0) runs.push([s, layout.length]);
  return runs;
}

const FILL_TINT = { red: 1, green: 0.976, blue: 0.86 };     // pale yellow: his cells
const HEAD_TINT = { red: 0.91, green: 0.92, blue: 0.94 };   // pale grey: header rows
const P_TINTS = [[9, { red: 0.96, green: 0.8, blue: 0.8 }], [7, { red: 1, green: 0.9, blue: 0.8 }], [5, { red: 0.93, green: 0.96, blue: 0.9 }]];

// Sheets API batchUpdate requests for one tab. grid = the tab's values as read back from the live sheet (rows of strings).
// Idempotent: widths and formats are set, not added; existing column groups are deleted first by the caller (deleteGroups).
export function sheetRequests(sheetId, grid, { existingGroups = [] } = {}) {
  const layout = layoutFor(grid);
  const nRows = Math.max(grid.length, 1); const nCols = Math.max(layout.length, 1);
  const R = [];
  for (const g of existingGroups) R.push({ deleteDimensionGroup: { range: { sheetId, dimension: 'COLUMNS', startIndex: g.range.startIndex, endIndex: g.range.endIndex } } });
  // 1. Column widths.
  layout.forEach((l, i) => R.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: l.px }, fields: 'pixelSize' } }));
  // 2. Every cell: top-aligned, wrap per its column. The machine columns CLIP (a 45 KB full row would otherwise make a row a page tall).
  layout.forEach((l, i) => R.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: nRows, startColumnIndex: i, endColumnIndex: i + 1 },
    cell: { userEnteredFormat: { wrapStrategy: l.wrap ? 'WRAP' : 'CLIP', verticalAlignment: 'TOP', horizontalAlignment: l.center ? 'CENTER' : 'LEFT', backgroundColor: l.kind === 'fill' ? FILL_TINT : { red: 1, green: 1, blue: 1 } } },
    fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment,userEnteredFormat.backgroundColor' } }));
  // 3. Header rows: bold, grey, wrapped so a long header never widens its column.
  grid.forEach((row, r) => { if (isHeaderRow(row)) R.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
    cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEAD_TINT, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
    fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor,userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment' } }); });
  // 4. The priority cell tinted by its value, so the urgent rows show without reading a number.
  grid.forEach((row, r) => { if (isHeaderRow(row)) return; layout.forEach((l, c) => { if (l.kind !== 'priority') return; const p = Number(row[c]); if (!Number.isInteger(p)) return;
    const t = P_TINTS.find(([min]) => p >= min); if (t) R.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { backgroundColor: t[1], textFormat: { bold: p >= 7 } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold' } }); }); });
  // 5. Freeze the first header row and the id column (only when the first row IS a header: a key/value page freezes nothing).
  const headTop = isHeaderRow(grid[0]);
  R.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headTop ? 1 : 0, frozenColumnCount: frozenColsFor(grid) } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
  // 6. Machine columns: one collapsed group per contiguous run.
  for (const [s, e] of hiddenRuns(layout)) {
    R.push({ addDimensionGroup: { range: { sheetId, dimension: 'COLUMNS', startIndex: s, endIndex: e } } });
    R.push({ updateDimensionGroup: { dimensionGroup: { range: { sheetId, dimension: 'COLUMNS', startIndex: s, endIndex: e }, depth: 1, collapsed: true }, fields: 'collapsed' } });
  }
  // 7. Rows fit their wrapped text.
  R.push({ autoResizeDimensions: { dimensions: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: nRows } } });
  return { requests: R, layout };
}

// THE SAME LAYOUT FOR THE CELL WRITER (version 3, board-cell-writer.gs format op): a sheet that already has its header is written
// cell by cell, so the xlsx never carries its layout again; this spec does, and it holds no value, so his cells are never touched.
// Header rows sit TOP-aligned: bottom-aligned, the last line of a tall header slid under the freeze bar (the Business Plan, 2026-10-21).
// keepPx (C1042d): a width he set by hand on the live sheet wins here too, so the cell path stops undoing his widths on every write.
export function formatSpec(grid, { keepPx = [] } = {}) {
  const layout = layoutFor(grid).map((l, i) => (Number.isFinite(keepPx[i]) ? { ...l, px: keepPx[i] } : l)); const headTop = isHeaderRow(grid[0]);
  return { cols: layout.map((l) => ({ px: l.px, wrap: !!l.wrap, center: !!l.center, hidden: !!l.hidden, fill: l.kind === 'fill' })),
    headerRows: grid.map((r, i) => (isHeaderRow(r) ? i + 1 : 0)).filter(Boolean), rows: Math.max(grid.length, 1),
    frozenRows: headTop ? 1 : 0, frozenCols: frozenColsFor(grid), headTint: '#e8ebef', fillTint: '#fff9db' };
}

// xlsx <cols> for the same layout (Excel width ≈ px / 7), for the local workbook writer.
export function xlsxCols(rows) {
  return layoutFor(rows).map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.round(l.px / 7))}" customWidth="1"${l.hidden ? ' hidden="1" outlineLevel="1"' : ''}/>`).join('');
}

// ── THE SAME LAYOUT AS ONE STYLED XLSX — the Drive transport. rclone's sign-in rides rclone's own Google project, which has the Sheets
// API off (403 "has not been used in project 202264815644"); the Drive API on the same token replaces a sheet's content in place
// (files.update, converted), and the xlsx carries the widths, wrap, freeze, tints and collapsed columns with it.
const xesc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const hex = (c) => `FF${[c.red, c.green, c.blue].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
// cellXfs: 0 plain · 1 header · 2 wrap · 3 clip · 4 his cell · 5 his cell centred · 6–8 priority 9 / 7 / 5 · 9 centred · 10 banner · 11 READY · 12 FORMULATING
// · 13 clip with a box border (a weekend on the Calendar) · 14 clip, grey (a day the month does not have)
export const XF = { CLIP: 3, WEEKEND: 13, NODAY: 14 };
const WEEKEND_BORDER = '<border>' + ['left', 'right', 'top', 'bottom'].map((e) => `<${e} style="medium"><color rgb="FF7A869A"/></${e}>`).join('') + '<diagonal/></border>';
// dxfs: the tints a conditional rule paints a cell with, by NAME (the Calendar colours each day by the kind of item it holds; a rule
// survives every cell-by-cell rewrite, so the colour follows the text). Index = the dxfId a rule names.
export const DXF = [
  { name: 'aim', rgb: 'FFE4D7F5' }, { name: 'benchmark', rgb: 'FFD5EFD8' }, { name: 'fixed', rgb: 'FFF9D3CF' },
  { name: 'event', rgb: 'FFFFF0C2' }, { name: 'travel', rgb: 'FFD3E6F8' }, { name: 'post', rgb: 'FFD2F0EE' }, { name: 'milestone', rgb: 'FFE8EAF0' },
  { name: 'estimate', rgb: 'FFFDE9D9' },
];
export const dxfId = (name) => DXF.findIndex((d) => d.name === name);
export const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${[HEAD_TINT, FILL_TINT, ...P_TINTS.map(([, c]) => c)].map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${hex(c)}"/></patternFill></fill>`).join('')}</fills><borders count="2"><border/>${WEEKEND_BORDER}</borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="15"><xf fontId="0"><alignment vertical="top"/></xf><xf fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="0" applyAlignment="1"><alignment vertical="top" wrapText="0"/></xf><xf fontId="0" fillId="3" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="0" fillId="3" applyFill="1" applyAlignment="1"><alignment vertical="top" horizontal="center" wrapText="1"/></xf><xf fontId="1" fillId="4" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf><xf fontId="1" fillId="5" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf><xf fontId="0" fillId="6" applyFill="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf><xf fontId="0" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf><xf fontId="1" applyFont="1" applyAlignment="1"><alignment vertical="bottom" wrapText="0"/></xf><xf fontId="1" fillId="6" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf><xf fontId="0" fillId="2" applyFill="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf><xf fontId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="0"/></xf><xf fontId="0" fillId="2" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="0"/></xf></cellXfs><dxfs count="${DXF.length}">${DXF.map((d) => `<dxf><fill><patternFill patternType="solid"><bgColor rgb="${d.rgb}"/></patternFill></fill></dxf>`).join("")}</dxfs></styleSheet>`;
export function styleOf(l, header, value) {
  if (header) return 1;
  if (l.kind === 'fill') return l.center ? 5 : 4;
  if (l.center && l.kind === 'short') return 9;
  if (l.kind === 'state') return String(value) === 'READY' ? 11 : 12;   // C1042f: 11 green bold · 12 grey
  if (l.kind === 'priority') { const p = Number(value); return p >= 9 ? 6 : p >= 7 ? 7 : p >= 5 ? 8 : 9; }
  // C1041g R-48: inside a wrapping column, a cell that is not a sentence still clips to one line, so a list never makes a row tall.
  return l.wrap && (value === undefined || isSubstance(value)) ? 2 : 3;
}
// C1042d: keepPx[i] = a width HE set by hand on the live sheet; it wins over the computed width (operator 2026-10-20: 'I edit the design of
// the spreadsheet … the width so that the width fits with the contents … and it keeps getting blown out').
// styleAt(ri, ci, v) → an XF index for one cell (a weekend border, a day the month lacks), or undefined for the column rule.
// rules: [{ sqref, text, dxf }] — a containsText conditional per item kind, first match wins (stopIfTrue), so a day takes the tint of
// the first kind in the list it holds. A rule rides in the sheet, so a later cell-by-cell write re-tints the day by its new text.
export function styledSheetXml(rows, { colorScale = null, keepPx = [], styleAt = null, rules = [] } = {}) {
  const layout = layoutFor(rows).map((l, i) => (Number.isFinite(keepPx[i]) ? { ...l, px: keepPx[i], kept: true } : l)); const top = isHeaderRow(rows[0]);
  const cols = layout.map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.round(l.px / 7))}" customWidth="1" style="${l.kind === 'fill' ? (l.center ? 5 : 4) : l.wrap ? 2 : 3}"${l.hidden ? ' hidden="1" outlineLevel="1" collapsed="1"' : ''}/>`).join('');
  const body = rows.map((r, ri) => { const h = isHeaderRow(r); return `<row r="${ri + 1}">${(r || []).map((v, ci) => {
    const banner = !h && (r || []).filter((x) => String(x ?? '').trim()).length === 1 && ci === 0;
    const own = !h && styleAt ? styleAt(ri, ci, v) : undefined;
    const st = banner ? 10 : own ?? styleOf(layout[ci] || DEFAULT, h, v); const ref = `${colName(ci)}${ri + 1}`;
    if (v === '' || v === null || v === undefined) return own !== undefined ? `<c r="${ref}" s="${st}"/>` : !h && (layout[ci] || {}).kind === 'fill' && String((r || [])[0] ?? '').trim() ? `<c r="${ref}" s="${st}"/>` : '';
    if (typeof v === 'number') return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
    const m = String(v).match(/^=HYPERLINK\("([^"]+)","([^"]*)"\)$/);
    if (m) return `<c r="${ref}" s="${st}" t="str"><f>${xesc(String(v).slice(1))}</f><v>${xesc(m[2])}</v></c>`;
    if (/^=([A-Z][A-Z.]*\(|\$?[A-Z]{1,2}\$?\d)/.test(String(v))) return `<c r="${ref}" s="${st}" t="str"><f>${xesc(String(v).slice(1))}</f></c>`;   // any other formula (a function, or arithmetic over cell refs, the Metrics sheet): Sheets computes it
    return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`; }).join('')}</row>`; }).join('');
  const pane = top ? '<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryRight="0"/></sheetPr><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" outlineLevelCol="${layout.some((l) => l.hidden) ? 1 : 0}"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData>${colorScale ? `<conditionalFormatting sqref="${colorScale}"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="FFFFFFFF"/><color rgb="FFE06666"/></colorScale></cfRule></conditionalFormatting>` : ''}${rules.map((r, i) => { const tl = r.sqref.split(':')[0]; const t = xesc(r.text);
    return `<conditionalFormatting sqref="${r.sqref}"><cfRule type="containsText" dxfId="${r.dxf}" priority="${i + 1}" stopIfTrue="1" operator="containsText" text="${t}"><formula>NOT(ISERROR(SEARCH(&quot;${t}&quot;,${tl})))</formula></cfRule></conditionalFormatting>`; }).join('')}</worksheet>`;
}
