#!/usr/bin/env node
// scripts/ops/board-rules-row.mjs — C1057 ROW 1 IS THE RULES, ON EVERY SHEET. Operator 2026-10-20, verbatim: "the rules for example they
// should probably be in row one … so that we can understand how to tell the agents now and later after it's been done to, so they
// remember what to do". One source for every sheet's row 1, put in at the two write doors (board-sheets-write.mjs writeSheet and
// board-book.mjs bookXlsx), so no composer carries its own copy (CLAUDE.md: one rule lives in one place). A sheet whose composer
// already opens on RULES (the monologue) is left as it is. The rule cell never ends in "(fill)": the readers find the header by that.
// LLM-free, presentation only — stays node.
//   node scripts/ops/board-rules-row.mjs     print every sheet's row 1
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPM_RULES } from './mailbox-rpm.mjs';
import { SHEET_RULE_LINE as RECOGNIZE_RULES } from '../comms/recognize-rules.mjs';

export const RULES_ID = 'RULES';
// Each line: what the sheet answers (the monologue step), then the numbered rules an agent obeys before it writes here.
export const SHEET_RULES = {
  // C1313a: the /recognize sheet's rules come from their one source (scripts/comms/recognize-rules.mjs), never retyped here.
  'Recognize · Shortest distance': RECOGNIZE_RULES,
  // bf-6566: Mailbox IN's rules are the RPM rules, read from their one source (scripts/ops/mailbox-rpm.mjs), never retyped here.
  'Mailbox IN': `M1 + M5 · a red ALARM row (a cell of yours that was not delivered) sits above everything · ${RPM_RULES.map((r) => r.text.replace(/\.$/, '')).join(' · ')}`,
  'Mailbox OUT': 'M6 · R1 every decision you took, newest first, with where it was done and the commits since · R2 nothing here asks you anything · R3 a failed hand-off never lands here (it stays an ALARM on Mailbox IN)',
  Terminals: 'M7 · R1 PROMISED is the session\'s last NEXT, frozen when it came to rest · R2 KEPT? is read off git (a commit by that session after the promise), never off its prose · R3 one line per cell, at most 120 characters · R4 you type in a YOU row; within 5 min it is handed to that session and YOUR LAST shows the hand-off and the commits since',
  Spec: 'M3 + M4 · R1 every row sits on one cell of the 12×12 (its coordinate) · R2 DONE only when its guard ran green and a commit ticked it · R3 a sub-row (↳) belongs to its parent family; no orphaned sub-task · R4 his words are quoted verbatim in the row',
  Promises: 'M2 · R1 every promise names who, what, by when and its source line · R2 late first · R3 kept means a commit landed after it (git), never a session saying so',
  Health: 'M8 · R1 each stage of your edit (typed → detected → handed → picked up → done) is timed off the record, median [min, max] n · R2 a stage over its bar reads OVER · R3 the PROBE cell is planted by scripts/ops/board-clock.mjs --plant and never reaches a room',
  Decide:'M5 · R1 eligible first, then priority, then date · R2 a ticked spec row is sealed and leaves · R3 type in YOUR COMMENT; every rewrite keeps it',
  Mailbox: 'M6 · R1 every cell you typed, where it went and what happened since · R2 a sealed row leaves the list',
  Now: 'M7 · R1 one row per terminal holding work: prior · present · future · R2 idle and closed sessions are counted at the foot, never listed',
  Rooms: 'M3 · R1 nine rooms × what each holds, off the shared Tasks rows',
  Tasks: 'M4 · R1 every open spec row, grouped by project · R2 PRIORITY 0–9 is derived; you never fill it',
  Map: 'M3 · R1 counts: open spec rows per row × column of the 12×12 · R2 the words block names what is placed in each cell; UNMEASURED where nothing is',
  Meaning: 'M3 · R1 every cell of the 12×12 is one sentence: its words, then the plain head of the highest-priority row the walk placed there · R2 every cell names the rows it was read from, or reads UNMEASURED · R3 rewritten on the board\'s rest, no model; nothing here is typed in',
  Tiles: 'M3 · R1 every tile with open work, busiest first, with its words and the rows landing there',
  Questions: 'M5 · R1 every open question, with its derived priority and why',
  Views: 'R1 each tab, the question it answers and its grade',
};
export const rulesLine = (name) => (SHEET_RULES[name] ? `${SHEET_RULES[name]} · built from the record by the board scripts, no model · one source: scripts/ops/board-rules-row.mjs` : null);
// The rows with row 1 the rules — unchanged when the sheet has no rules here or already opens on RULES.
export function withRulesRow(name, rows) {
  const line = rulesLine(name); if (!line || (rows[0] && rows[0][0] === RULES_ID)) return rows;
  return [[RULES_ID, line], ...rows];
}
// How many rows the rules push the composed table down — 1 when withRulesRow added one, else 0.
export const rulesOffset = (rows) => (rows && rows[0] && rows[0][0] === RULES_ID ? 1 : 0);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) for (const n of Object.keys(SHEET_RULES)) console.log(`${n.padEnd(12)} │ ${rulesLine(n)}`);
