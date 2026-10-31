#!/usr/bin/env node
// scripts/ops/board-sheets-write.mjs — C1020a: THE BOARD IS EDITED IN PLACE, NEVER RE-UPLOADED. Operator 2026-10-19, verbatim:
// "Can't you use Google Drive spreadsheet as in just edit it directly with an APR you need to sell my cell instead of having to redo
// the whole sheet to Edit".
//
// For each live sheet in data/vna/board-drive.json whose name is a composed board tab: read the live grid, keep every typed (fill)
// cell by its row id and header, write the freshly composed tab (priority, plain head, every row — no Drive-connector slice) into the
// SAME spreadsheet, put his cells back where their id now sits, then lay it out (board-layout.mjs). His cells go to the answers ledger
// first (board-answers.mjs appendCells) so the record holds them before any write. A typed cell whose id is gone from the new tab is
// NOT dropped: the sheet is refused and the orphan printed (AXIOM 1 — evict or retain, never free). Runs on his ask only.
//
//   node scripts/ops/board-sheets-write.mjs --dry              what would change per sheet, no write (still needs the token to read)
//   node scripts/ops/board-sheets-write.mjs [--only <name>]    write + lay out
// A sheet with no composed tab (START HERE, Decisions) is left as it is, never blanked. Week/Month compose as a plan off the
// record with no calendar input (C1032), so they are written every run.
// TRANSPORT: the Drive API, not the Sheets API — rclone's own Google project has the Sheets API off (403). The live grid is read as
// a CSV export; the new one goes up as a styled xlsx (board-layout.mjs styledSheetXml) converted into the SAME file id (same link).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHeaderRow, styledSheetXml, XLSX_STYLES, layoutFor } from './board-layout.mjs';
import { parseCsv } from './board-sheets-format.mjs';
import { rcloneToken } from './board-comments.mjs';
import { appendCells } from './board-answers.mjs';
import { withRulesRow } from './board-rules-row.mjs';
import { commentSecond, commentMirror } from './sheet-legibility.mjs';
import { derivedCells, openOverwrites, pinOverwrites, writeGenerated, readGenerated } from './board-overwrites.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const isFill = (h) => /\(fill\)\s*$/.test(String(h ?? ''));
const s = (v) => String(v ?? '').trim();

// Every typed (fill) cell in a grid, keyed by its row id and its header text.
export function fillsOf(rows) {
  const out = []; let head = null;
  for (const r of rows) {
    if (isHeaderRow(r)) { head = r; continue; }
    if (!head || !Array.isArray(r) || !s(r[0])) continue;
    head.forEach((h, c) => { if (isFill(h) && s(r[c])) out.push({ id: s(r[0]), field: s(h), value: s(r[c]) }); });
  }
  return out;
}

// The composed rows with his cells put back by (id, header). Returns the merged rows and the cells that found no row.
// C1042e — THE ACKNOWLEDGEMENT TAKES HIS CELL (operator 2026-10-20: 'rewrite my ad that basically say acknowledged, and then what you did in
// the same cell as I wrote it'). acked: id → the note it answers. A composed cell starting with ACK replaces his live cell when the live
// value is that note (or an older acknowledgement); a NEW note he types wins. An acknowledged note whose row left the tab is not an orphan.
export const ACK = '✓ ACKNOWLEDGED';
export const isAck = (v) => /^✓ (ACKNOWLEDGED|DONE)\b/.test(String(v ?? ''));
// SHARE SHEETS (operator 2026-10-20: "when it has been integrated ... they get deleted"): cleared holds `id\u0000field` keys whose comment was
// integrated; the ledger (data/vna/share-comments.ndjson) retains the words, so the cell is evicted from the sheet, never from the record.
export function mergeFills(composed, live, { acked = new Map(), cleared = new Map() } = {}) {
  const want = new Map(fillsOf(live).map((f) => [`${f.id}\u0000${f.field}`, f]));
  const rows = composed.map((r) => (Array.isArray(r) ? [...r] : []));
  let head = null;
  for (const r of rows) {
    if (isHeaderRow(r)) { head = r; continue; }
    if (!head || !s(r[0])) continue;
    head.forEach((h, c) => { const k = `${s(r[0])}\u0000${s(h)}`; if (isFill(h) && want.has(k)) { const v = want.get(k).value; if (cleared.has(k) && (isAck(v) || v === cleared.get(k))) { want.delete(k); return; } const ours = isAck(r[c]) && (v === acked.get(s(r[0])) || isAck(v)); while (r.length <= c) r.push(''); if (!ours) r[c] = v; want.delete(k); } });
  }
  return { rows, orphans: [...want.values()].filter((f) => !isAck(f.value) && acked.get(f.id) !== f.value && cleared.get(`${f.id}\u0000${f.field}`) !== f.value) };
}

// C1197 THE RELAYOUT — A SHEET CHANGES ITS COLUMNS IN PLACE, NEVER RECREATED (wo12 for the operator's day plan 2026-10-22: "Any cell that
// she, or anyone besides our writer, typed in the old columns (comments, notes) moves into YOUR COMMENT on its row, or onto the sheet's
// Log tab if its row is gone. A trailing column is blanked only when its last-written value matches what our writer wrote"). planGrid
// blanks every cell past the new grid; these three decide which of those cells are ours to blank and carry the rest to safety first.
// AXIOM 1: a typed cell is retained (moved), never freed. Guard: tests/vna/c1197-tend-sheet-for-maritha-row-layout.test.mjs.
export const COMMENT_FIELD = 'YOUR COMMENT (fill)';
const headAt = (g) => { const i = g.findIndex(isHeaderRow); return i < 0 ? null : { i, head: g[i].map((h) => s(h)) }; };
// A first cell that opens a table the cell writer reads: ID (every board sheet) or # (the reader layout, board-lens F9).
export const hasIdHeader = (g) => g.some((r) => Array.isArray(r) && ['ID', '#'].includes(String(r[0] ?? '').trim()));
// The live cells the new layout drops (a column it no longer has, or a row whose id is gone) that are NOT what our writer last wrote:
// a (fill) cell is always someone's; a derived cell is ours only when the generated ledger holds exactly its value. → comment | log.
export function relayoutMoves(live, composed, generated = new Map()) {
  const L = headAt(live), C = headAt(composed); if (!L || !C) return [];
  const fields = new Set(C.head.filter(Boolean)); const ids = new Set(composed.slice(C.i + 1).map((r) => s((r || [])[0])).filter(Boolean));
  const moves = [];
  for (let r = L.i + 1; r < live.length; r++) {
    const row = live[r] || []; const id = s(row[0]); const rowKept = Boolean(id) && ids.has(id);
    L.head.forEach((h, c) => {
      const v = s(row[c]); if (!v || (c === 0 && id)) return;            // an empty cell, or the row's own id (ours by construction)
      if (rowKept && h && fields.has(h)) return;                         // stays in a column the new layout keeps (mergeFills / the edit check)
      if (!isFill(h) && id && generated.get(`${id}\u0000${h}`) === v) return;
      // C1221b: a cell WE wrote as a formula exports its displayed output (a value, or #ERROR! until it parses), never the formula, so
      // its display never equals the ledger's text; the ledger saying a formula is ours there is the proof it was never typed (editedDerived's rule)
      if (!isFill(h) && id && /^=/.test(s(generated.get(`${id}\u0000${h}`)))) return;   // what we last wrote: ours to blank
      moves.push({ id: id || `row ${r + 1}`, field: h || `column ${c + 1}`, value: v, to: rowKept ? 'comment' : 'log' });
    });
  }
  return moves;
}
// The composed rows with each 'comment' move appended to YOUR COMMENT on its row, labelled with the column it came from. Idempotent.
export function applyMoves(rows, moves) {
  const out = rows.map((r) => (Array.isArray(r) ? [...r] : r)); const C = headAt(out); if (!C) return out;
  const col = C.head.indexOf(COMMENT_FIELD); if (col < 0) return out;
  for (const m of moves.filter((x) => x.to === 'comment')) {
    const r = out.findIndex((x, i) => i > C.i && Array.isArray(x) && s(x[0]) === m.id); if (r < 0) continue;
    const line = `[from ${m.field.replace(/ \(fill\)$/, '')}] ${m.value}`; const have = s(out[r][col]);
    if (!have.includes(m.value)) out[r][col] = have ? `${have}\n${line}` : line;
  }
  return out;
}
// The refusal (and the guard): every live cell a position-by-position plan would blank that is not ours and whose words are not
// carried — into a target cell, or onto the Log (logged). Empty = safe to write.
export function blankedTyped(live, target, generated = new Map(), { logged = [], formulas = null } = {}) {
  // C1221b: the live sheet's own formula text, when the writer read it — a cell whose formula is one we wrote for that row is ours, even
  // where two columns share an empty header and their ledger keys collide
  const oursById = new Map(); for (const [k, g] of generated) if (/^=/.test(s(g))) { const id = k.split('\u0000')[0]; if (!oursById.has(id)) oursById.set(id, new Set()); oursById.get(id).add(s(g)); }
  const L = headAt(live); if (!L) return [];
  const carried = [...target.flat().map((v) => s(v)), ...logged.map((m) => s(m.value))];
  const out = [];
  // C1385: a cell sits under the NEAREST header row above it — the key derivedCells recorded it by. On a two-block sheet (a TOP block
  // headed 'ID · TOP', then the data block headed 'ID') the first header is the TOP block's, and keying the data rows by it never
  // found our own ledger entry: the first rewrite of Signals · Pipeline was refused on 17 of its own cells (2026-10-29).
  let head = L.head;
  for (let r = L.i + 1; r < live.length; r++) {
    const row = live[r] || []; const id = s(row[0]);
    if (isHeaderRow(row)) head = row.map((h) => s(h));
    row.forEach((raw, c) => {
      const v = s(raw); if (!v || s((target[r] || [])[c]) === v) return;   // empty, or unchanged by the plan (blanked OR overwritten both count)
      const h = head[c] || ''; if (c === 0 && id) return;
      if (!isFill(h) && id && generated.get(`${id}\u0000${h}`) === v) return;
      if (!isFill(h) && id && /^=/.test(s(generated.get(`${id}\u0000${h}`)))) return;   // C1221b: our formula's display, never typed (see relayoutMoves)
      const f = formulas ? s((formulas[r] || [])[c]) : ''; if (!isFill(h) && id && /^=/.test(f) && oursById.get(id)?.has(f)) return;
      if (!isFill(h) && AUTO_STAMP_FIELD.test(h)) return;   // C1172: a LAST WRITE stamp is ours, re-read every compose, never typed (START HERE refused the G6 move on it)
      if (carried.some((t) => t.includes(v))) return;
      out.push({ r: r + 1, c: c + 1, id: id || `row ${r + 1}`, field: h, value: v });
    });
  }
  return out;
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// rclone's sign-in shares one Google project with every rclone user, so a per-minute quota 403/429 is routine: wait and retry.
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(token, url, opt = {}, tries = 6) {
  const res = await fetch(url, { ...opt, headers: { authorization: `Bearer ${token}`, ...(opt.headers || {}) } });
  if ((res.status === 429 || res.status === 403) && tries > 1) { const j = await res.clone().json().catch(() => ({})); if (res.status === 429 || /quota|rate/i.test(j.error?.message || '')) { await nap(30_000); return call(token, url, opt, tries - 1); } }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`${res.status} ${j.error?.message || ''}`.trim()); }
  return res;
}
// The live grid: the sheet exported as CSV by the Drive API (a board sheet holds one tab).
// C1042d — HIS WIDTHS SURVIVE A REWRITE. We remember the widths we wrote (out/board/widths/<id>.json); before the next write we read the
// live sheet's widths (xlsx export, <cols>); a column whose live width moved more than 14 px from ours was set by him, and is kept.
export const WIDTH_TOL_PX = 14;
export function hisWidths(livePx = [], ourPx = []) { return livePx.map((p, i) => (Number.isFinite(p) && Number.isFinite(ourPx[i]) && Math.abs(p - ourPx[i]) > WIDTH_TOL_PX ? p : undefined)); }
export function colsPx(sheetXml) { const out = []; for (const m of String(sheetXml).matchAll(/<col\b[^>]*\bmin="(\d+)"[^>]*\bmax="(\d+)"[^>]*\bwidth="([\d.]+)"/g)) for (let c = Number(m[1]); c <= Number(m[2]) && c <= 200; c++) out[c - 1] = Math.round(Number(m[3]) * 7); return out; }
async function liveWidths(token, id) {
  try { const f = join(tmpdir(), `w-${id}.xlsx`); writeFileSync(f, Buffer.from(await (await call(token, `${DRIVE}/${id}/export?mimeType=${encodeURIComponent(XLSX)}`)).arrayBuffer()));
    const xml = execFileSync('unzip', ['-p', f, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8', maxBuffer: 64 << 20 }); rmSync(f, { force: true }); return colsPx(xml); } catch { return []; }
}
export async function exportGrid(token, id) { return parseCsv(await (await call(token, `${DRIVE}/${id}/export?mimeType=text/csv`)).text()); }
// One styled single-tab xlsx, zipped with the system zip (the same writer board.mjs uses).
export function styledXlsx(rows, out, tab = 'Sheet1', { keepPx = [], look = {} } = {}) {
  const dir = join(tmpdir(), `board-sheet-${process.pid}-${Date.now()}`);
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  w('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  w('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  w('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${tab.replace(/[&<>"]/g, '')}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  w('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  w('xl/styles.xml', XLSX_STYLES);
  w('xl/worksheets/sheet1.xml', styledSheetXml(rows, { keepPx, ...look }));
  if (existsSync(out)) rmSync(out);
  const z = spawnSync('zip', ['-q', '-9', '-X', '-r', out, '.'], { cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  if (z.status !== 0) throw new Error('zip failed');
  return out;
}

// C1172: a column WE populate from another file's own metadata (a sheet's Drive modifiedTime, read fresh every compose)
// drifts every pass purely because OUR writes to the other sheets move it forward — never because he typed into it. The
// START HERE sheet's "LAST WRITE (UTC)" column is exactly this: its live value and its freshly-composed value differ on
// every pass that writes any OTHER sheet first, and a racing writer's generated-ledger entry (C1087's shared-file read
// before write) can go stale faster than this column does, so it is excluded from the edit check, never compared at all.
const AUTO_STAMP_FIELD = /^LAST WRITE\b/i;
// The derived cells a person changed on the live sheet since our last write (live ≠ last generated, and ≠ what we compose now).
// Sheets renders a written ISO date in its own locale ("2026-10-20" reads back as "Oct 20, 2026"). That is the sheet's display,
// never an edit: on 2026-10-29 ten BY cells on the Business Plan refused a write as "edited" for this alone.
export function sameDay(shown, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim()); if (!m) return false;
  const d = new Date(String(shown ?? '')); if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === +m[1] && d.getMonth() + 1 === +m[2] && d.getDate() === +m[3];
}
export function editedDerived(live, generated, composed) {
  if (!generated || !generated.size) return [];
  const now = derivedCells(composed); const out = [];
  for (const [k, v] of derivedCells(live)) { if (!generated.has(k)) continue; const [, field] = k.split('\u0000'); if (AUTO_STAMP_FIELD.test(field)) continue;
    const g = generated.get(k); if (/^=/.test(String(g)) || /^=/.test(String(now.get(k) ?? ''))) continue;   // a formula cell exports its displayed text, never the formula
    if (v !== g && v !== now.get(k) && !sameDay(v, g) && !sameDay(v, now.get(k))) { const [id, f] = k.split('\u0000'); out.push({ id, field: f, value: v, was: g }); } }
  return out;
}
// C1087: the generated ledger after a write — a composed cell is recorded when the sheet reads it back; a cell the sheet shows otherwise
// (another writer landed after us, or he typed in the gap) keeps its previous record, so neither is ever mistaken for ours.
// A refusal over edited derived cells is lifted only for the cells named on the command line ("K-04·WHY IT MATTERS"), and only
// when the refusal holds no other cell: an edit nobody named still stops the write (2026-10-23, a stray paste on Share · K4).
export function namedOverwrite(edits, named) { const want = new Set(named); return edits.length > 0 && edits.every((e) => want.has(`${e.id}·${e.field}`)); }
export function confirmedGenerated(composed, readBack, prev = new Map()) {
  const out = new Map();
  for (const [k, v] of composed) { if (readBack.get(k) === v || /^=/.test(String(v))) out.set(k, v); else if (prev.has(k)) out.set(k, prev.get(k)); }
  return out;
}
// No whole-file rewrite of a sheet that has its header (operator 2026-10-21: "Make sure you always do it that way" — cell by cell). The
// old FRESH mode (2026-10-20) is gone: a re-rank or a column change goes through planGrid, position by position, compare-and-set.
// C1057: row 1 is the sheet's rules, from the one source · G6: the comment column second on every header block, and read back in the
// last column by formula (sheet-legibility.mjs).
export const prepareComposed = (name, composed) => commentMirror(commentSecond(withRulesRow(name, composed)));
// The cell path's read-only refusals, one place for the live write and --dry. R: the writer's own read (fetched here when not passed).
// Returns the refusal reason, or null when the plan may be written; null too when the sheet takes the xlsx path (no writer, no header).
export async function cellPathRefusal(id, live, rows, gen, logMoves, R = null, named = [], name = '') {
  const { writeCells, cellsConfig, hasFormulas, WRITER_VERSION_NEEDED_FOR_FORMULAS } = await import('./board-cells.mjs');
  if (!(cellsConfig().url && hasIdHeader(live))) return null;
  R = R || await writeCells(id, { read: true });
  if (R.error || R.off) return `cell writer read: ${R.error || R.why}`;
  if (hasFormulas(rows) && !((R.version || 1) >= WRITER_VERSION_NEEDED_FOR_FORMULAS && R.formulas)) return `this sheet carries formulas and the deployed cell writer is version ${R.version || 1} (it compares displays and writes in one phase, which half-writes a formula grid). Paste scripts/ops/board-cell-writer.gs into the Apps Script project and Deploy → Manage deployments → edit → New version (same URL), then re-run`;
  // C1197: nothing typed is blanked — every cell the plan would empty is ours (the ledger), carried into a target cell, or logged.
  const own = await ownSheetRules(name, live);   // our own sheet-rules lines, byte for byte, are never his
  const lost = blankedTyped(R.values || live, rows, gen, { logged: logMoves, formulas: R.formulas || null }).filter((x) => own.get(x.id) !== x.value);
  if (namedOverwrite(lost, named)) return null;   // every blanked cell was named on the command line, and nothing else
  return lost.length ? `${lost.length} typed cell(s) would be blanked: ${lost.slice(0, 3).map((x) => `${x.id}·${x.field}`).join(', ')}` : null;
}
// The sheet named Rules has its main tab named Rules, so sheet-tabs.mjs once appended its S/G/H lines into the board's own grid
// (2026-10-24). Row S3 carries "(fill)", reads as a header, and every line after it read as a typed cell with no row: 14 of our own
// sentences refused the sheet. A stranded line is ours only when it equals, byte for byte, the line rulesRows writes for that id.
export async function ownSheetRules(name, live) {
  const { rulesRows, writersOf, RULES_HEAD } = await import('./sheet-tabs.mjs');
  const head = live.find((r) => Array.isArray(r) && String(r[0] ?? '').trim() === 'ID') || [];
  const rows = rulesRows(name, { writers: writersOf(name), fills: head.filter((h) => /\(fill\)\s*$/.test(String(h))).map(String) });
  const own = new Map(rows.map((r) => [String(r[0]).trim(), String(r[1] ?? '')]));
  own.set('RULE', RULES_HEAD[1]); return own;   // the block's own header row; its fill-named third cell reads as a header, never a value
}
export async function writeSheet(token, id, composed, { name, dry = false, acked = new Map(), cleared = new Map(), overwriteEdits = false, named = [], look = {} } = {}) {
  // look: { styleAt, rules } for a sheet with its own cell styles (the Calendar: weekend borders, a tint per item kind) — first write only.
  composed = prepareComposed(name, composed);
  let live = await exportGrid(token, id);
  // C1197: a LAYOUT CHANGE (the live header row differs from the composed one) carries every typed cell the new layout drops to safety
  // first (relayoutMoves): into YOUR COMMENT on its row, or the Log tab. Those cells are moved, so they neither refuse the write nor
  // get blanked. A sheet whose header is unchanged keeps the refusal below exactly as before.
  const Lh = headAt(live), Ch = headAt(composed); const gen = readGenerated(name);
  const relayout = Boolean(Lh && Ch && Lh.head.join('\u0001') !== Ch.head.join('\u0001'));
  const ownRules = await ownSheetRules(name, live);   // a sheet-rules line sheet-tabs.mjs wrote into this grid is ours, byte for byte
  const moves = (relayout ? relayoutMoves(live, composed, gen) : []).filter((m) => ownRules.get(m.id) !== m.value); const moved = new Set(moves.map((m) => `${m.id}\u0000${m.field}`));
  const logMoves = moves.filter((m) => m.to === 'log');
  // A DERIVED cell whose live value differs from what we last wrote AND from what we are about to write is someone's edit
  // (operator 2026-10-20: his B-01 edit at rev 8 was overwritten by our rev 9 six seconds later). Refuse, name the cells, write nothing.
  const theirs = editedDerived(live, gen, composed).filter((e) => !moved.has(`${e.id}\u0000${e.field}`));
  if (theirs.length && !overwriteEdits && !namedOverwrite(theirs, named)) return { name, refused: true, edits: theirs, why: `${theirs.length} derived cell(s) were edited on the sheet since our last write — fold them into the source first: ${theirs.slice(0, 3).map((e) => `${e.id}·${e.field}`).join(', ')}` };
  const { rows: merged, orphans } = mergeFills(composed, live, { acked, cleared });
  const typed = fillsOf(live).length; const kept = typed - orphans.length;
  const stray = orphans.filter((o) => !moved.has(`${o.id}\u0000${o.field}`) && ownRules.get(o.id) !== o.value);   // C1197: a moved cell is carried, not orphaned
  if (stray.length) return { name, refused: true, why: `${stray.length} typed cell(s) have no row in the new tab: ${stray.slice(0, 3).map((o) => `${o.id}·${o.field}`).join(', ')}` };
  // C1035: an overwritten derived cell is a dispatch to the room, and the room's answer — not this rewrite — lifts it; an
  // EXECUTED overwrite with no reply yet is pinned back in, the same way mergeFills pinned a typed "(fill)" cell above.
  const { rows: pinnedRows, pinned } = pinOverwrites(merged, openOverwrites({ sheet: name }));
  const rows = applyMoves(pinnedRows, moves);   // C1197: typed cells from dropped columns, onto YOUR COMMENT on their row
  const res = { name, liveRows: live.length, newRows: rows.length, cols: Math.max(1, ...rows.map((r) => r.length)), keptFills: kept, pinnedOverwrites: pinned,
    ...(relayout ? { relayout: true, movedToComment: moves.length - logMoves.length, movedToLog: logMoves.length, moves } : {}) };
  // --dry runs every read-only refusal the cell path runs (2026-10-24: the dry run returned here, before the writer read and the
  // blanked-typed check, so four tabs read clean dry and were refused live). It writes nothing: no ledger row, no cell, no format.
  if (dry) { const why = await cellPathRefusal(id, live, rows, gen, logMoves, null, named, name); return why ? { ...res, refused: true, why } : res; }
  // C1042m: a cell recorded here is tagged via:'writer' — the watch still owes it a hand-off (a rewrite must never swallow his answer).
  appendCells(fillsOf(live).filter((f) => ownRules.get(f.id) !== f.value).map((f) => ({ tab: name, id: f.id, field: f.field.replace(/ \(fill\)$/, ''), value: f.value, via: 'writer' })));
  // CELL BY CELL (operator 2026-10-20: "turn on cell by cell that is critical"): once the Apps Script cell writer is deployed, a sheet
  // that already has its header is written one compare-and-set cell at a time — never a whole-file swap under his cursor. The xlsx
  // path below stays only for a sheet's first write (layout) or when the cell writer is not deployed.
  const { planGrid, writeCells, appendLogTab, cellsConfig, hasFormulas, WRITER_VERSION_NEEDED_FOR_FORMULAS, WRITER_VERSION_NEEDED_FOR_FORMAT } = await import('./board-cells.mjs');
  if (cellsConfig().url && hasIdHeader(live)) {
    // C1074e: read the live sheet through the writer itself (displays + formulas), so `was` is what the writer will compare. A formula
    // grid needs the two-phase, formula-comparing writer: refuse rather than half-write it.
    const R = await writeCells(id, { read: true });
    const why = await cellPathRefusal(id, live, rows, gen, logMoves, R, named, name); if (why) return { ...res, refused: true, why };
    if (logMoves.length) {   // retain before evict: the Log tab holds the words before the cell that held them is blanked
      const { LOG_TAB, LOG_HEAD } = await import('./notes-to-log.mjs'); const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const lg = await appendLogTab(id, LOG_TAB, LOG_HEAD, logMoves.map((m, k) => [`R-${at.replace(/\D/g, '')}-${k + 1}`, at, m.id, m.field, m.value, 'moved here when this sheet changed its columns; nothing was deleted', '']));
      if (lg.error || lg.off) return { ...res, refused: true, why: `Log tab: ${lg.error || lg.why} — nothing blanked` };
    }
    const d = planGrid(R.values || live, rows, { formulas: R.formulas || null });
    const w = (d.ops.length || d.append.length) ? await writeCells(id, d) : { applied: 0, conflicts: [], appended: 0 };
    if (w.error || w.off) return { ...res, refused: true, why: `cell writer: ${w.error || w.why}` };
    // C1087: what we "last wrote" is recorded only where the sheet reads it back. Two overlapping writers (an older composer and a newer
    // one) once left this ledger holding the older grid while the sheet held the newer, and the next run refused 8 echo cells as his edits.
    const prev = readGenerated(name), echo = derivedCells(await exportGrid(token, id));
    writeGenerated(name, confirmedGenerated(derivedCells(composed), echo, prev));
    // The layout rides with every cell write: the values went cell by cell, the format goes as one value-free op (writer v3). An older
    // writer leaves the layout as it was and says which step brings the format op, never a whole-file swap to get it.
    // C1042d on the cell path too (operator 2026-10-22: "I keep updating the widths"): the format op set every width on every write, so a
    // column he dragged was undone by the next pass. His widths are read off the live sheet and kept, exactly as the xlsx path keeps them.
    const { formatSpec } = await import('./board-layout.mjs');
    const wf = join(REPO, 'out/board/widths', `${id}.json`); const ours = existsSync(wf) ? JSON.parse(readFileSync(wf, 'utf8')) : [];
    const keepPx = ours.length ? hisWidths(await liveWidths(token, id), ours) : [];
    const fmt = (R.version || 1) >= WRITER_VERSION_NEEDED_FOR_FORMAT ? await writeCells(id, { format: formatSpec(rows, { keepPx }) })
      : { pending: `layout not applied: the deployed cell writer is version ${R.version || 1}, the format op needs ${WRITER_VERSION_NEEDED_FOR_FORMAT} — paste scripts/ops/board-cell-writer.gs into the Apps Script project, Deploy → Manage deployments → edit → New version (same URL)` };
    res.format = fmt.formatted ? 'applied' : fmt.pending || `refused: ${fmt.error || fmt.why}`;
    if (fmt.formatted) { mkdirSync(dirname(wf), { recursive: true }); writeFileSync(wf, JSON.stringify(formatSpec(rows, { keepPx }).cols.map((c) => c.px))); res.keptWidths = keepPx.filter(Number.isFinite).length; }
    const back = await exportGrid(token, id);
    return { ...res, mode: 'cells', applied: w.applied, appended: w.appended, conflicts: w.conflicts, dropped: d.dropped, readBackRows: back.filter((r) => r.some((v) => String(v).trim())).length, readBackFills: fillsOf(back).length, expectRows: rows.filter((r) => (r || []).some((v) => String(v ?? '').trim())).length };
  }
  writeGenerated(name, derivedCells(composed));
  const wf = join(REPO, 'out/board/widths', `${id}.json`); const ours = existsSync(wf) ? JSON.parse(readFileSync(wf, 'utf8')) : [];
  const keepPx = ours.length ? hisWidths(await liveWidths(token, id), ours) : [];
  const file = styledXlsx(rows, join(tmpdir(), `board-${id}.xlsx`), name.slice(0, 31), { keepPx, look });
  mkdirSync(dirname(wf), { recursive: true }); writeFileSync(wf, JSON.stringify(layoutFor(rows).map((l, i) => (Number.isFinite(keepPx[i]) ? keepPx[i] : l.px))));
  res.keptWidths = keepPx.filter(Number.isFinite).length;
  // Same file id, same link: the Drive API converts the xlsx into the existing Google Sheet (a new revision; the old stays in history).
  await call(token, `${UPLOAD}/${id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'content-type': XLSX }, body: readFileSync(file) });
  rmSync(file, { force: true });
  const back = await exportGrid(token, id);
  res.readBackRows = back.filter((r) => r.some((v) => String(v).trim())).length; res.readBackFills = fillsOf(back).length;
  res.expectRows = rows.filter((r) => (r || []).some((v) => String(v ?? '').trim())).length;
  // C1042n: the xlsx upload gives the tab a NEW gid on every write (511570536 → 965373014, 2026-10-20), so a link that jumps to a cell
  // (#gid=…&range=A46) is read off the sheet after the upload and kept in board-drive.json gids, never assumed 0.
  try { const h = await (await call(token, `https://docs.google.com/spreadsheets/d/${id}/htmlview`)).text(); const g = (h.match(/gid: "(\d+)"/) || [])[1];
    if (g) { const f = join(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8')); j.gids = { ...(j.gids || {}), [name]: g }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); res.gid = g; } } catch {}
  return res;
}

// THE PROJECTS SHEET CARRIES THE TASKS. Operator 2026-10-19, verbatim: "we need tasks on projects we are missing the legibility todos
// redability somehow" · "terrible design.." (a screenshot: two tables stacked in one grid, so every column was sized for one and
// wrong for the other) · "never ask me to prioritize - guess and I will edit".
// ONE TABLE: each project is a bold banner line (name · owner · open count · our priority guess), its open tasks under it, the
// busiest project first; a project with no open task is one name in the closing line, never a row of zeros. Per task: the plain head
// first, WHAT IT IS (the headline with its builder noise stripped) when no head is written yet, our priority guess beside a cell to
// change it, the machine columns last so they collapse as one run.
export const TASK_HEAD = ['ID', 'PRIORITY 0–9', 'WHAT IT IS', 'DONE WHEN', 'NOW', 'FROM YOU', 'WAITS ON', 'CHANGE IT 0–9 (fill)', 'NOTE (fill)', 'WHY (derived)', 'CLASS', 'GUARD', 'THE ROW (full text)', 'WHERE'];
// The headline as a person reads it: no PARKED prefix, no code, no paths, no parentheticals, no shouting.
const ACRONYMS = new Set(['CTA', 'VNA', 'PMU', 'HTML', 'JSON', 'MCP', 'SAFE', 'README', 'URL', 'API', 'CLAUDE', 'NCD', 'QC', 'OG', 'LLM', 'XLSX', 'CSV', 'IDE', 'UI']);
export function plainWhat(h) {
  let t = String(h || '').replace(/^PARKED UNTIL[^—]*—\s*/i, '').replace(/`[^`]*`/g, '').replace(/\([^()]*\)/g, '').replace(/\S+\/\S+/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\((declared|built)[^—]*—\s*/i, '');
  // No shouting: every all-caps word is lowered unless it is an acronym; each sentence opens on a capital.
  t = t.replace(/\b[A-Z][A-Z'-]+\b|\bA\b/g, (w) => (ACRONYMS.has(w) ? w : w.toLowerCase())).replace(/(^|[.!?:]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  t = t.replace(/^[—:,\s-]+/, '');
  const two = (t.match(/[^.!?]+[.!?]+/g) || [t]).slice(0, 2).map((x) => x.trim()).join(' ') || t;
  return two.length > 240 ? `${two.slice(0, 239)}…` : two;
}
export function projectsSheet(summary, tabs, projects) {
  const groups = [];
  for (const p of projects) {
    const rows = tabs.get(p.tab) || []; const hi = rows.findIndex((r) => r && r[0] === 'OPEN ROWS'); const tasks = [];
    if (hi >= 0) { const h = rows[hi]; for (const r of rows.slice(hi + 1)) { if (!r || !r.length || !s(r[0])) break;
      const at = (k) => r[h.indexOf(k)] ?? ''; const done = String(at('DONE WHEN'));
      const unwritten = /^(UNWRITTEN|STALE|UNCLEAR)/.test(done);
      tasks.push([r[0], at('PRIORITY 0–9'), plainWhat(String(at('THE ROW (full text)') || at('HEADLINE')).replace(/^\s*- \[[ x]\] C\d+[a-z]?\d*\s*/, '').replace(/^\(guard: [^)]*\)\s*/, '').replace(/[*]/g, '')), unwritten ? (done.startsWith('UNCLEAR') ? done : 'plain head not written yet') : done, unwritten ? '' : at('NOW'), unwritten ? '' : at('FROM YOU'), unwritten ? '' : at('WAITS ON'), '', '', at('WHY THIS PRIORITY'), at('CLASS'), at('GUARD'), at('THE ROW (full text)'), at('WHERE')]); } }
    const n = (id) => Number((String(id).match(/\d+/) || [0])[0]);
    tasks.sort((x, y) => (Number(y[1]) || 0) - (Number(x[1]) || 0) || n(y[0]) - n(x[0]));
    const sum = summary.find((r) => r[0] === p.name) || []; const owner = sum[1] || '';
    groups.push({ name: p.name, owner, top: tasks.length ? Math.max(...tasks.map((t) => Number(t[1]) || 0)) : -1, tasks });
  }
  const live = groups.filter((g) => g.tasks.length).sort((x, y) => y.top - x.top || y.tasks.length - x.tasks.length);
  const quiet = groups.filter((g) => !g.tasks.length).map((g) => g.name.replace(/^(Package|VS Code extension) — /, ''));
  const out = [TASK_HEAD];
  for (const g of live) { out.push([`${g.name}  ·  ${g.owner || 'no owner room'}  ·  ${g.tasks.length} open  ·  our priority guess ${g.top}`]); out.push(...g.tasks); }
  out.push([], [`No open task: ${quiet.join(' · ')}`]);
  return out;
}
// A derived sheet whose input this run does not have is left as it is, never shrunk to what an empty input composes.
export const NEEDS_INPUT = { Sessions: '--sessions <ListAgents.txt> (without it the tab composes empty)' };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const only = a.includes('--only') ? a[a.indexOf('--only') + 1] : null; const dry = a.includes('--dry');
  // --overwrite "<id>·<field>" (repeatable, with --only): lifts a refusal made wholly of the named cells; any unnamed cell still stops it
  const named = a.flatMap((x, i) => (x === '--overwrite' ? [a[i + 1]] : []));
  if (named.length && !only) { console.log('--overwrite needs --only <sheet>: a named cell belongs to one sheet'); process.exit(2); }
  const t = rcloneToken();
  if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const board = await import('./board.mjs');
  const ow = await (await import('./board-plan.mjs')).owedReplies();
  // --sessions <ListAgents.txt>: the Sessions tab composes from it, exactly as board.mjs does; without it the tab is left as it is
  const sessionsFile = a.includes('--sessions') ? a[a.indexOf('--sessions') + 1] : null;
  const b = board.buildBoard({ place: true, owed: ow.owed, owedNote: ow.note, sessionsText: sessionsFile ? readFileSync(resolve(sessionsFile), 'utf8') : '' });
  const T = new Map(await board.allTabs(b));
  T.set('Projects', projectsSheet(board.projectsRows(b), T, b.projects.map((p) => ({ name: p.name, tab: board.tabName(p) }))));
  for (const k of Object.keys(NEEDS_INPUT)) if (!(k === 'Sessions' && sessionsFile)) T.delete(k);
  const sheets = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets;
  let bad = 0;
  for (const [name, id] of Object.entries(sheets)) {
    if (only && name !== only) continue;
    try {
      if (T.has(name)) { const r = await writeSheet(t.token, id, T.get(name), { name, dry, named });
        if (r.refused) { bad++; console.log(`✗ ${name}: REFUSED — ${r.why}`); continue; }
        console.log(`${dry ? '·' : '✓'} ${name}: ${r.liveRows} → ${r.newRows} rows × ${r.cols} cols · ${r.keptFills} typed cell(s) kept${dry ? '' : ` · read back ${r.readBackRows} rows, ${r.readBackFills} typed`}${r.format ? ` · layout ${r.format}` : ''}`);
        if (!dry && (r.readBackFills !== r.keptFills || r.readBackRows !== r.expectRows)) { bad++; console.log(`  ✗ ${name}: read back ${r.readBackRows}/${r.expectRows} rows, ${r.readBackFills}/${r.keptFills} typed cells`); }
      } else console.log(`· ${name}: ${NEEDS_INPUT[name] ? `needs ${NEEDS_INPUT[name]} — left as it is` : 'no composed tab of that name — left as it is'}`);
    } catch (e) { bad++; console.log(`✗ ${name}: ${e.message}`); }
  }
  process.exit(bad ? 1 : 0);
}
