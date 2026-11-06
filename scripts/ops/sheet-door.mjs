#!/usr/bin/env node
// scripts/ops/sheet-door.mjs — ONE NODE DOOR: resolve a sheet title against data/vna/board-drive.json and read its live grid.
// The one reader the command line (`npx thetacog-mcp sheet-read "<title>"`) and the data room
// (src/app/api/dataroom/sheet/route.ts) both call — never a second reader for the same sheet (CLAUDE.md: a rule stated once
// lives in one place). (C2221, chair decomposition of the operator's words, not on the tape: "We need a setup actions in node
// that reads from the different sheets and allows us to use this here command line as well as the data room.")
// Transport only — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Read one sheet by its data/vna/board-drive.json title. Returns `{ ok: true, title, id, grid }` or `{ ok: false, title, why }`
 * where `why` always starts "UNMEASURED —" — never a thrown error and never an empty grid passed off as a read one, whether
 * the title is unknown, no rclone token holds, or the export call itself fails.
 */
export async function readBoardSheet(title, { repo = REPO, rcloneRun, exportGridImpl } = {}) {
  const f = resolve(repo, 'data/vna/board-drive.json');
  let j;
  try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { return { ok: false, title, why: `UNMEASURED — no ${f}` }; }
  const id = j.sheets?.[title];
  if (!id) return { ok: false, title, why: `UNMEASURED — "${title}" is not in data/vna/board-drive.json` };
  const { rcloneToken } = await import('./board-comments.mjs');
  const t = rcloneRun ? rcloneToken({ run: rcloneRun }) : rcloneToken();
  if (!t.token) return { ok: false, title, id, why: `UNMEASURED — ${t.why}` };
  const exportGrid = exportGridImpl || (await import('./board-sheets-write.mjs')).exportGrid;
  try { return { ok: true, title, id, grid: await exportGrid(t.token, id) }; }
  catch (e) { return { ok: false, title, id, why: `UNMEASURED — export failed: ${String(e.message).slice(0, 80)}` }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const title = process.argv[2];
  if (!title) { console.log('usage: node scripts/ops/sheet-door.mjs "<sheet title>"'); process.exit(1); }
  const r = await readBoardSheet(title);
  console.log(r.ok ? r.grid.map((row) => row.join(' │ ')).join('\n') : r.why);
}
