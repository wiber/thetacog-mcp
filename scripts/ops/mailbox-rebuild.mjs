#!/usr/bin/env node
// scripts/ops/mailbox-rebuild.mjs — ONE CLEAN REWRITE OF MAILBOX IN, RULES ON THEIR OWN TAB (operator 2026-10-20: "apply my edits ... it's
// pretty heavy-handed edit so let's do it" · "Move the rules to another tab" · "Same sheet point to them").
// The RPM layout (bf-6566) went cell by cell, so old cells sat under new headers. This writes the whole file once (writeSheet fresh):
//   · the main tab = mailbox.mjs compose()'s rows above the rules panel, plus one line pointing to the Rules tab;
//   · his typed cells are carried only when the hand-off ledger (data/vna/board-mailbox.ndjson, tab Mailbox IN, delivered) holds that exact
//     value for that row — anything else under a fill header is machine text from the old layout and is dropped;
//   · the rules panel goes to a "Rules" tab in the same file, through the cell writer (a tab survives later cell-by-cell writes).
//   node scripts/ops/mailbox-rebuild.mjs [--dry]
import { readFileSync } from 'node:fs';
import { movedKeys, readMoved, norm } from './notes-to-log.mjs';
import { derivedCells, writeGenerated } from './board-overwrites.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const nd = (p) => readFileSync(resolve(REPO, p), 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
export function splitRules(rows) {
  const i = rows.findIndex((r) => /^RULES\b/.test(String((r || [])[0] || '')));
  if (i < 0) return { main: rows, rules: [] };
  return { main: [...rows.slice(0, i).filter((r, k, a) => !(k === a.length - 1 && !(r || []).some((v) => String(v ?? '').trim()))), ['RULES →', 'How this sheet works is on the Rules tab of this file (R1–R7): why first, the result, the massive action, ranked by the Horizons.']], rules: rows.slice(i) };
}
// MACHINE ECHO: text the old layout wrote that the watch then handed off as his (2026-10-21: 29 such hand-offs) — a session label,
// "unassigned", or a spec title closing on its row id. Never carried, whatever the ledger says.
export const isMachineEcho = (v) => /^unassigned$/i.test(v) || /^(VS Code|WezTerm|Kitty|iTerm|Cursor|Terminal)\b.*·/.test(v) || /\((C\d+[a-z0-9]*)\)\s*$/.test(v) || /^operator — no session open$/.test(v);
export function hisCells(ledger) {
  const m = new Map(); for (const r of ledger) if (r.tab === 'Mailbox IN' && r.ok !== false && r.id && r.value) m.set(`${r.id}\u0000${String(r.field || '').replace(/ \(fill\)$/, '')}`, String(r.value).trim());
  // A cell moved to the Log (notes-to-log.mjs) is never carried back by a rewrite.
  const moved = movedKeys(readMoved());
  return (f) => !isMachineEcho(f.value) && !moved.has(`Mailbox IN\u0000${f.id}\u0000${norm(f.field)}\u0000${String(f.value).trim()}`) && m.get(`${f.id}\u0000${f.field.replace(/ \(fill\)$/, '')}`) === f.value;
}
// C1303: --cells writes straight to the sheet with its own writer, never through board-sheets-write.mjs's writeSheet — so the
// writeGenerated call that writer makes after every successful write never fires here. board-generated.json then keeps whatever
// an older write recorded (once "needs our recommendation") while the live sheet holds the text this pass just wrote; the next
// plain `mailbox.mjs --write` reads that gap as 16 of our own actionLine cells edited since, and refuses. The cell write records
// its own snapshot, same as board-sheets-write.mjs's xlsx path (`writeGenerated(name, derivedCells(composed))`) — only on an
// actual write (dry, or a read/write error, records nothing: AXIOM 1, never a cache entry for a write that did not land).
export function recordGenerated(main, ok, opts) { if (ok) writeGenerated('Mailbox IN', derivedCells(main), opts); }
// --cells (2026-10-21, the R1 six-needs pass): same layout, new words — write only the cells that changed, compare-and-set, so a
// cell he is typing in comes back a conflict instead of being overwritten. The Rules tab has no ID header: its rows match on the
// first cell (R1 … R7); a rule row the tab lacks is appended, never a second copy of one it has.
export function byFirstCell(live, rows) {
  const at = new Map(); (live || []).forEach((r, i) => { const k = String((r || [])[0] ?? '').trim(); if (k && !at.has(k)) at.set(k, i); });
  const ops = [], append = [];
  for (const row of rows) { const k = String(row[0] ?? '').trim(); if (!k) continue; const i = at.get(k);
    if (i === undefined) { append.push(row.map((v) => String(v ?? ''))); continue; }
    row.forEach((v, c) => { const was = String((live[i] || [])[c] ?? ''); const now = String(v ?? ''); if (was !== now) ops.push({ r: i + 1, c: c + 1, was, now }); }); }
  return { ops, append };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--cells')) {
  const dry = process.argv.includes('--dry');
  const { compose } = await import('./mailbox.mjs'); const c = await compose();
  const { main, rules } = splitRules(c.inRows);
  const id = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets['Mailbox IN'];
  const { writeCells, cellOps } = await import('./board-cells.mjs');
  const liveMain = await writeCells(id, { read: true }); const liveRules = await writeCells(id, { tab: 'Rules', read: true });
  if (liveMain.error || liveRules.error) { console.log(`✗ read failed — ${liveMain.error || liveRules.error}`); process.exit(1); }
  const m = cellOps(liveMain.values || [], main); const r = byFirstCell(liveRules.values || [], rules);
  const lh = (liveMain.values || []).findIndex((x) => String(x[0] ?? '').trim() === 'ID'); const ch = main.findIndex((x) => String((x || [])[0] ?? '').trim() === 'ID');
  if (lh > 0 && ch > 0) m.ops.push(...byFirstCell(liveMain.values.slice(0, lh), main.slice(0, ch)).ops);
  console.log(`  Mailbox IN: ${m.ops.length} cell(s) differ · ${m.append.length} row(s) new · Rules: ${r.ops.length} cell(s) differ · ${r.append.length} row(s) new${dry ? ' (dry)' : ''}`);
  if (!dry) {
    const w1 = await writeCells(id, { ops: m.ops, append: m.append }); const w2 = await writeCells(id, { tab: 'Rules', ops: r.ops, append: r.append });
    recordGenerated(main, !w1.error);
    const n = (w) => `${w.applied ?? 0} written · ${(w.conflicts || []).length} conflict(s) left as typed${w.error ? ` · ✗ ${w.error}` : ''}`;
    console.log(`✓ Mailbox IN ${n(w1)} · Rules ${n(w2)}`);
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes('--dry');
  const { compose } = await import('./mailbox.mjs'); const c = await compose();
  const { main, rules } = splitRules(c.inRows);
  const keep = hisCells(nd('data/vna/board-mailbox.ndjson'));
  const id = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets['Mailbox IN'];
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs'); const { writeCells } = await import('./board-cells.mjs');
  const t = rcloneToken();
  const r = await writeSheet(t.token, id, main, { name: 'Mailbox IN', dry });   // cell by cell (planGrid); his cells placed by mergeFills
  console.log(r.refused ? `✗ refused — ${r.why}` : `✓ Mailbox IN cell by cell: ${r.applied ?? 0} written · ${(r.conflicts || []).length} conflict(s) left as typed · ${r.keptFills} of his cells carried${dry ? ' (dry)' : ''}`);
  if (!dry && !r.refused && rules.length) { const w = await writeCells(id, { tab: 'Rules', append: rules.map((x) => x.map((v) => String(v ?? ''))) }); console.log(`✓ Rules tab: ${w.appended || 0} rows${w.error ? ` · ✗ ${w.error}` : ''}`); }
}
