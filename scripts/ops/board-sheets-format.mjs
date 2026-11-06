#!/usr/bin/env node
// scripts/ops/board-sheets-format.mjs — lay out every live board sheet IN PLACE (same id, same link): column widths, wrap, frozen
// header + id column, his (fill) cells tinted, priority tinted by value, machine columns grouped and collapsed. The rule is one
// function, scripts/ops/board-layout.mjs sheetRequests; this file is only the transport (read the live grid, send the batch, read back).
//
//   node scripts/ops/board-sheets-format.mjs --dry            the layout per tab off out/board/csv/*.csv, no network, no token
//   node scripts/ops/board-sheets-format.mjs                  format every sheet in data/vna/board-drive.json
//   node scripts/ops/board-sheets-format.mjs --only Questions one sheet
//
// Credential: the rclone remote's OAuth token (scope=drive covers the Sheets API). No remote → UNMEASURED with the one-time command.
// Values are never written here: layout only, so his (fill) cells are untouched. Runs on his ask only (memory: board-sync-on-ask-only).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheetRequests, layoutFor, hiddenRuns } from './board-layout.mjs';
import { rcloneToken } from './board-comments.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const summary = (name, layout) => {
  const open = layout.filter((l) => !l.hidden && l.kind !== 'blank').length; const shut = layout.filter((l) => l.hidden).length;
  return `${name}: ${layout.length} col · ${open} open · ${shut} collapsed (${hiddenRuns(layout).map(([s, e]) => `${s + 1}–${e}`).join(', ') || 'none'})`;
};

async function api(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${j.error?.message || ''}`.trim());
  return j;
}

export async function formatSheet(token, id) {
  const meta = await api(token, `${id}?fields=properties.title,sheets.properties,sheets.columnGroups`);
  const out = [];
  for (const s of meta.sheets || []) {
    const title = s.properties.title; const sheetId = s.properties.sheetId;
    const v = await api(token, `${id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}?majorDimension=ROWS`);
    const grid = v.values || [];
    const { requests, layout } = sheetRequests(sheetId, grid, { existingGroups: s.columnGroups || [] });
    await api(token, `${id}:batchUpdate`, { method: 'POST', body: { requests } });
    // Read back: the widths and the frozen panes the sheet now holds, never the request we sent.
    const back = await api(token, `${id}?fields=sheets.properties.gridProperties,sheets.columnGroups,sheets.data.columnMetadata.pixelSize&ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:A1`)}`);
    const bs = (back.sheets || [])[0] || {}; const px = (bs.data?.[0]?.columnMetadata || []).slice(0, layout.length).map((c) => c.pixelSize);
    const match = px.length === layout.length && px.every((p, i) => p === layout[i].px);
    out.push({ title: meta.properties.title, tab: title, rows: grid.length, requests: requests.length, frozen: bs.properties?.gridProperties, groups: (bs.columnGroups || []).length, widthsMatch: match, line: summary(meta.properties.title, layout) });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const only = a.includes('--only') ? a[a.indexOf('--only') + 1] : null;
  if (a.includes('--dry')) {
    const dir = resolve(REPO, 'out/board/csv');
    if (!existsSync(dir)) { console.log('UNMEASURED — no out/board/csv; run node scripts/ops/board.mjs --csv out/board/csv first'); process.exit(0); }
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.csv')).sort()) {
      const name = f.replace(/\.csv$/, ''); if (only && name !== only) continue;
      const layout = layoutFor(parseCsv(readFileSync(join(dir, f), 'utf8')));
      console.log(summary(name, layout));
      if (only) layout.forEach((l, i) => console.log(`  ${String(i + 1).padStart(2)} ${l.kind.padEnd(9)} ${String(l.px).padStart(4)}px ${l.wrap ? 'wrap' : 'clip'}${l.hidden ? ' collapsed' : ''}`));
    }
    process.exit(0);
  }
  const t = rcloneToken();
  if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const sheets = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets;
  let bad = 0;
  for (const [name, id] of Object.entries(sheets)) {
    if (only && name !== only) continue;
    try { for (const r of await formatSheet(t.token, id)) { console.log(`${r.widthsMatch ? '✓' : '✗'} ${r.line} · ${r.rows} rows · frozen ${r.frozen?.frozenRowCount || 0}/${r.frozen?.frozenColumnCount || 0} · ${r.groups} group(s)`); if (!r.widthsMatch) bad++; } }
    catch (e) { bad++; console.log(`✗ ${name}: ${e.message}`); }
  }
  process.exit(bad ? 1 : 0);
}
