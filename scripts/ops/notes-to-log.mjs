#!/usr/bin/env node
// scripts/ops/notes-to-log.mjs — THE MOVE IS THE RECEIPT (operator 2026-10-21, verbatim: "always clear my notes when they've been there
// acknowledged and the act ... and move them to the log on the same sheet that way it's like the Movement is the receipt ... It shows
// that you saw it").
// A typed cell of his leaves the sheet only when (1) it was acknowledged and (2) a commit acted on it. The order is fixed:
//   1. the ledger row first (data/vna/notes-moved.ndjson: sheet, id, field, his words verbatim, what we did, the commit) — AXIOM 1, the words
//      are retained before they are evicted from the cell;
//   2. the Log tab in the SAME file gets the row (append-only, never rewritten);
//   3. the cell is cleared compare-and-set: if he has typed something new since, the clear is a conflict and his new words stay.
// A commit that does not exist refuses the move. The rebuild never re-carries a moved cell (movedKeys).
// Usage: node scripts/ops/notes-to-log.mjs --sheet "Mailbox IN" <id> "<field>" <commit> "<what we did>" [--dry]
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = 'data/vna/notes-moved.ndjson';
export const LOG_TAB = 'Log';
export const LOG_HEAD = ['ID', 'WHEN', 'ROW', 'FIELD', 'YOUR WORDS', 'WHAT WE DID', 'COMMIT'];
export const moveId = (sheet, id, field, value) => 'M-' + createHash('sha256').update(`${sheet}\u0000${id}\u0000${field}\u0000${value}`).digest('hex').slice(0, 10);
export const norm = (f) => String(f || '').replace(/ \(fill\)$/, '').trim();
export function movedKeys(lines) { const s = new Set(); for (const l of lines) s.add(`${l.sheet}\u0000${l.id}\u0000${norm(l.field)}\u0000${String(l.value).trim()}`); return s; }
export const readMoved = () => { try { return readFileSync(resolve(REPO, LEDGER), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
// The move, pure: find the cell, refuse what is not his to move, return the ledger row, the log row and the clear op.
export function planMove(live, { sheet, id, field, commit, did, commitExists = () => true, at = new Date().toISOString() }) {
  const h = live.findIndex((r) => String((r || [])[0] ?? '').trim() === 'ID'); if (h < 0) return { refused: 'no ID header on the sheet' };
  const c = live[h].findIndex((x) => norm(x) === norm(field)); if (c < 0) return { refused: `no column ${field}` };
  if (!/\(fill\)\s*$/.test(String(live[h][c]))) return { refused: `${field} is not a (fill) cell — only his cells move` };
  const r = live.findIndex((x, i) => i > h && String((x || [])[0] ?? '').trim() === id); if (r < 0) return { refused: `no row ${id}` };
  const value = String(live[r][c] ?? '').trim(); if (!value) return { refused: `${id} · ${field} is already empty` };
  if (/^✓ /.test(value)) return { refused: `${id} · ${field} holds our acknowledgement, not his words` };
  if (!commit || !commitExists(commit)) return { refused: `commit ${commit || '(none)'} not in git — a move needs the act on record` };
  const mid = moveId(sheet, id, norm(field), value);
  return { ledger: { at, sheet, id, field: norm(field), value, did, commit, move: mid }, log: [mid, at.slice(0, 16).replace('T', ' '), id, norm(field), value, did, commit], op: { r: r + 1, c: c + 1, was: value, now: '' } };
}
// LOG-ONLY (2026-10-21: his Horizons notes for H-06/H-07/H-08 were cleared by a rewrite before any commit acted on them, and the Log tab
// stayed empty — his words left the sheet with no receipt). When the cell is already empty, the words come from the hand-off ledger
// (they were retained before eviction, AXIOM 1) and the Log row is still written: the receipt, with no clear.
export function planLogOnly({ sheet, id, field, value, commit, did, commitExists = () => true, at = new Date().toISOString() }) {
  const v = String(value ?? '').trim(); if (!v) return { refused: 'no words to log' };
  if (!commit || !commitExists(commit)) return { refused: `commit ${commit || '(none)'} not in git — a move needs the act on record` };
  const mid = moveId(sheet, id, norm(field), v);
  return { ledger: { at, sheet, id, field: norm(field), value: v, did, commit, move: mid, cleared_before: true }, log: [mid, at.slice(0, 16).replace('T', ' '), id, norm(field), v, did, commit] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const dry = a.includes('--dry'); const sheet = a[a.indexOf('--sheet') + 1];
  const rest = a.filter((x, i) => x !== '--dry' && x !== '--sheet' && a[i - 1] !== '--sheet' && x !== '--words' && a[i - 1] !== '--words');
  const [id, field, commit, did] = rest;
  const fileId = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets[sheet];
  if (!fileId || !id || !field || !did) { console.log('usage: notes-to-log.mjs --sheet "<sheet>" <id> "<field>" <commit> "<what we did>" [--dry]'); process.exit(2); }
  const { writeCells, appendLogTab } = await import('./board-cells.mjs');
  const live = await writeCells(fileId, { read: true }); if (live.error || live.off) { console.log(`✗ read — ${live.error || live.why}`); process.exit(1); }
  const commitExists = (sha) => { try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO, stdio: 'ignore' }); return true; } catch { return false; } };
  const words = a.includes('--words') ? a[a.indexOf('--words') + 1] : null;   // the ledger's verbatim words, for a cell already cleared
  let p = planMove(live.values || [], { sheet, id, field, commit, did, commitExists });
  if (p.refused && /already empty|no row/.test(p.refused) && words) { p = planLogOnly({ sheet, id, field, value: words, commit, did, commitExists }); if (!p.refused) { appendFileSync(resolve(REPO, LEDGER), JSON.stringify(p.ledger) + '\n'); const l = await appendLogTab(fileId, LOG_TAB, LOG_HEAD, [p.log]); console.log(l.error ? `✗ log tab — ${l.error} (ledger row kept)` : `✓ ${id} · ${p.ledger.field} logged to ${LOG_TAB} (${commit}) — the cell was already cleared`); process.exit(l.error ? 1 : 0); } }
  if (p.refused) { console.log(`✗ ${id}: ${p.refused}`); process.exit(1); }
  if (dry) { console.log(`  would move ${id} · ${p.ledger.field}: "${p.ledger.value.slice(0, 80)}" → ${LOG_TAB} (${commit})`); process.exit(0); }
  appendFileSync(resolve(REPO, LEDGER), JSON.stringify(p.ledger) + '\n');
  const l = await appendLogTab(fileId, LOG_TAB, LOG_HEAD, [p.log]);
  if (l.error) { console.log(`✗ log tab — ${l.error} (ledger row kept; the cell is NOT cleared)`); process.exit(1); }
  const w = await writeCells(fileId, { ops: [p.op] });
  console.log((w.conflicts || []).length ? `⚠ ${id}: logged, but the cell changed since the read — your new words stay` : `✓ ${id} · ${p.ledger.field} moved to ${LOG_TAB} (${commit})`);
}
