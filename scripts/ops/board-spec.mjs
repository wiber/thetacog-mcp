#!/usr/bin/env node
// scripts/ops/board-spec.mjs — C1042j THE SPEC IN THE SHEET: every spec row, open and ticked, in tree order with its plain head, so a SPEC
// link on the board lands on a row of the board and never on GitHub. Operator 2026-10-20, verbatim: "Instead of linking to [GitHub], I put
// comments to summarize these specification pages in spreadsheets that includes the [whole] tree. It should all be in the spreadsheet."
//
// LLM-FREE. Rows: board.mjs specRows() (open) + tickedRows() (ticked), the plain head per id off data/vna/board-heads.ndjson (newest wins).
// Tree: a family is the numeric id (C1042); the root first, then its children (C1042a…) marked ↳. Families newest first. His YOUR NOTE
// cells carry across rewrites by id (writeSheet keeps typed fills) and board-watch pulls them back (the sheet sits in board-drive.json).
//   node scripts/ops/board-spec.mjs --print     the rows to stdout
//   node scripts/ops/board-spec.mjs             write the sheet (created in the board folder on first run)
// Port row: transport over the spec reader — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n).replace(/\s+\S*$/, ''); return (c || t.slice(0, n)) + '…'; };
export const SHEET = 'Spec';
export const TITLE = '04 · SPEC — every spec row, open and ticked, in tree order';
export const HEAD = ['ID', 'WHAT IT IS', 'STATUS', 'DONE WHEN', 'NOW', 'FROM YOU', 'WAITS ON', 'GUARD', 'YOUR NOTE (fill)'];
export const FIRST_ROW = 4;   // C1057: row 1 the rules (writeSheet puts them in), row 2 the title line, row 3 the header, rows from 4 the spec

const family = (id) => Number((String(id).match(/^C(\d+)/) || [])[1] || 0);
const suffix = (id) => String(id).replace(/^C\d+/, '');
// open: [{ id, headline, guard, line, spec }] · ticked: Map(id → { id, headline, guard }) · heads: Map(id → head)
export function specGrid({ open = [], ticked = new Map(), heads = new Map() }) {
  const byId = new Map();
  for (const r of ticked.values()) byId.set(r.id, { ...r, status: 'DONE' });
  for (const r of open) byId.set(r.id, { ...r, status: 'OPEN' });
  const rows = [...byId.values()].sort((a, b) => family(b.id) - family(a.id) || (suffix(a.id) === '' ? -1 : suffix(b.id) === '' ? 1 : suffix(a.id).localeCompare(suffix(b.id), 'en', { numeric: true })));
  const open1 = rows.filter((r) => r.status === 'OPEN').length;
  const grid = [[TITLE, `${open1} open · ${rows.length - open1} done · newest family first · type in YOUR NOTE and the next pass acknowledges it`], HEAD];
  const rowOf = new Map();
  for (const r of rows) {
    const h = heads.get(r.id) || {};
    rowOf.set(r.id, FIRST_ROW + grid.length - 2);
    grid.push([r.id, `${suffix(r.id) ? '↳ ' : ''}${clip(r.headline, 160)}`, r.status, clip(h.done_when, 140), clip(h.now, 140), clip(h.from_you, 120), clip(h.waits_on, 80), r.guard || '', '']);
  }
  return { grid, rowOf };
}

export async function compose() {
  const b = await import('./board.mjs');
  const heads = new Map();
  if (existsSync(resolve(REPO, 'data/vna/board-heads.ndjson'))) for (const l of readFileSync(resolve(REPO, 'data/vna/board-heads.ndjson'), 'utf8').split('\n')) { try { const r = JSON.parse(l); if (r && r.id && r.head) heads.set(r.id, r.head); } catch {} }
  return specGrid({ open: b.specRows(), ticked: b.tickedRows(), heads });
}
// The link a board cell uses for a spec row: its row on this sheet, never GitHub. null when the sheet is not made yet.
// C1042n: the link jumps to the row's cell — the tab's live gid (board-drive.json gids, read after each write), never an assumed 0.
export const cellUrl = (sid, gid, row) => (sid && row ? `https://docs.google.com/spreadsheets/d/${sid}/edit${gid ? `#gid=${gid}&range=A${row}` : ''}` : null);
export function sheetLink(id, rowOf) {
  let d = {}; try { d = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')); } catch { d = {}; }
  return cellUrl((d.sheets || {})[SHEET], (d.gids || {})[SHEET], rowOf && rowOf.get(id));
}

export async function writeSpec(token, grid) {
  const { writeSheet } = await import('./board-sheets-write.mjs');
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8')); const id = j.sheets[SHEET];
  return id ? writeSheet(token, id, grid, { name: SHEET }) : { refused: true, why: 'no Spec sheet yet — run board-spec.mjs once' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { grid } = await compose();
  if (grid.length <= 2) { console.log('✗ refused — no spec rows read; an empty Spec sheet would claim the spec is empty'); process.exit(1); }
  if (process.argv.includes('--print')) { for (const r of grid) console.log(r.slice(0, 4).map((c) => clip(c, 70)).join(' │ ')); process.exit(0); }
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = rcloneToken(); if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.sheets[SHEET];
  if (!id) {
    const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: TITLE, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    if (!r.id) { console.log(`✗ create failed: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); }
    id = r.id; j.sheets = { [SHEET]: id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  const r = await writeSheet(t.token, id, grid, { name: SHEET });
  console.log(r.refused ? `✗ refused — ${r.why}` : `✓ ${SHEET}: ${r.newRows} rows · ${r.keptFills} typed cell(s) kept · read back ${r.readBackRows}/${r.expectRows} · https://docs.google.com/spreadsheets/d/${id}/edit`);
  process.exit(r.refused ? 1 : 0);
}
