#!/usr/bin/env node
// scripts/ops/sheet-hats.mjs — C1176: THE HAT AND THE RULES FILE THAT BIND EACH BOARD SHEET, ONE TABLE.
//
// (tend: sheet=Hats row=hats-to-sheets → H-01) EVERY SHEET NAMES ITS RULES AND ITS HAT: every internal
// sheet is a door into the same board, built by a writer script under scripts/ops/ (the Grid, C1) and
// read every 5 minutes by the board watch loop (the Loop, C2 — sheet-tabs.mjs's own S4 line). One hat
// for the whole mechanism — scripts/pmu/shortlex-names.mjs names the pair Gridkeeper×Loopkeeper — never
// invented per sheet, because the contract that asked for this named that exact pair as its own example.
//
// THE RULES FILE is derived, not typed: rules-for.mjs already proves every scripts/ops/ writer is bound
// by CLAUDE.md (matched on the directory prefix); this picks the first CLAUDE.md section its own
// writers actually hit, so the line names the SPECIFIC section rather than just the filename.
//
// WIRING NOTE (2026-10-21): sheet-tabs.mjs's rulesRows() is where the S6 line belongs, beside S1-S5,
// and board-rules-row.mjs is where BOARD_HAT would sit beside SHEET_RULES — both carried a LIVE WIP
// claim from another session when this landed (checked: node scripts/ops/wip.mjs check
// scripts/ops/sheet-tabs.mjs scripts/ops/board-rules-row.mjs). This module is wired into the one sheet
// this session does hold, board-surfaces.mjs's Hats tab, and drops into the other two the moment their
// claims release — docs/specs/vna/asks/c1176-sheet-tabs-wip-blocked.md names the rest.
//
// @guard tests/vna/c1176-tend-sheet-hats-row-hats-to.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesFor } from './rules-for.mjs';
import { isLens, isShare, writersOf } from './sheet-tabs.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => { try { return readFileSync(resolve(REPO, p), 'utf8'); } catch { return null; } };

// THE HAT — one pair for the whole board (named by the contract itself), never assigned per sheet.
export const BOARD_HAT = { coord: 'C1,C2', name: 'Gridkeeper×Loopkeeper' };

// EVERY SHEET THE BOARD'S WATCH LOOP ACTUALLY READS — lens and share sheets excluded, same filter
// sheet-tabs.mjs applies before it writes a Rules tab, read here rather than re-typed.
export function internalSheetNames() {
  const raw = read('data/vna/board-drive.json');
  if (!raw) return [];
  const sheets = JSON.parse(raw).sheets || {};
  return Object.keys(sheets).filter((n) => !isLens(n) && !isShare(n));
}

// the claude-rules file (and its specific section) that binds a sheet, read off its own writers —
// scripts/ops/rules-for.mjs is the one source for "what binds this path", never re-derived here.
export function rulesFileFor(writers = []) {
  const paths = writers.map((w) => `scripts/ops/${w}`);
  const claude = paths.length ? rulesFor(paths).claude : [];
  return claude.length ? `CLAUDE.md § ${claude[0].title}` : 'UNMEASURED — no writer script matched a CLAUDE.md section yet';
}

export function hatAndRulesLine(name, writers = writersOf(name)) {
  return `HAT: ${BOARD_HAT.name} [${BOARD_HAT.coord}] reads this sheet (scripts/pmu/shortlex-names.mjs, the board watch loop) · RULES FILE: ${rulesFileFor(writers)} (scripts/ops/rules-for.mjs, from this sheet's own writers)`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const n of internalSheetNames()) console.log(`${n.padEnd(24)} │ ${hatAndRulesLine(n)}`);
}
