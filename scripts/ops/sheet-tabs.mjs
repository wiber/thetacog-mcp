#!/usr/bin/env node
// scripts/ops/sheet-tabs.mjs — EVERY SHEET HAS ITS OWN RULES TAB AND ITS OWN LOG TAB, IN ONE SHAPE (operator 2026-10-21, verbatim: "all
// sheets should have their own log tab and their own rules tab and there are a bunch of different architectures, but they should all be
// easily understood and explainable").
// One shape on every Rules tab, so any sheet reads the same way — five lines, then the sheet's own numbered rules:
//   S1 WHAT THIS SHEET IS FOR · S2 WHO WRITES IT · S3 YOUR CELLS · S4 WHERE YOUR WORDS GO · S5 WHAT IT DOES NOT ANSWER
// Every line is read off the record: S1 from SHEET_QUESTIONS (board-concert.mjs, the START HERE question) or the spec title (board-requirements.mjs), else it says
// UNMEASURED — a purpose is never invented; S2 the scripts that name the sheet (a name match, said as such); S3 the live header's (fill)
// columns. The Log tab gets its header (notes-to-log.mjs LOG_HEAD), so a moved note always has a home. Share sheets are skipped: a tab
// there is read by the counterparty (need-to-know). Written compare-and-set, row matched on its first cell; a rule row never duplicates.
//   node scripts/ops/sheet-tabs.mjs [--dry] [--only "<sheet>"]
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHEET_RULES } from './board-rules-row.mjs';
import { SHEET_QUESTIONS } from './board-concert.mjs';
import { SPECS } from './board-requirements.mjs';
import { LOG_TAB, LOG_HEAD } from './notes-to-log.mjs';
import { LEGIBILITY_RULES, HOLD_RULES } from './sheet-legibility.mjs';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RULES_TAB = 'Rules';
export const RULES_HEAD = ['RULE', 'HOW THIS SHEET WORKS', 'YOUR NOTE (fill)'];
export const SHARED_LINE = /^[SGH]\d$/;   // the lines every internal Rules tab carries, whatever its own rules are
export const isShare = (name) => /^Share · /.test(name);
// A focus sheet's Rules and Log tabs are written by board-lens.mjs --tabs (the lens rules fit the person who reads it), never here.
export const isLens = (name) => /^(Lens|For) · /.test(name);
export function purposeOf(name) {
  if (SHEET_QUESTIONS[name]) return `it answers: ${SHEET_QUESTIONS[name]}`;   // board-concert.mjs, the START HERE question per sheet
  const s = Object.values(SPECS).find((x) => x.sheet === name); if (s && s.title) return s.title.replace(/^\d+ · /, '');
  return 'UNMEASURED — no purpose on record for this sheet yet; write one in YOUR NOTE and it becomes this line';
}
export function numbered(name) { const r = SHEET_RULES[name]; if (!r) return []; return r.split(' · ').slice(1).map((t, i) => [`N${i + 1}`, t]); }
// C1235: H-00's R1–R5 (docs/specs/vna/horizons.json) are the Horizons sheet's own numbered rules. They stay out of
// SHEET_RULES/numbered() on purpose — that map also feeds withRulesRow's row 1 of the MAIN tab (board-rules-row.mjs), and
// row 1 of the main tab is exactly the "process sits above the principle" the operator moved them off of. Read straight off
// H-00 here, so this Rules tab and board-requirements.mjs's exclusion of H-00 from the main grid share one source.
function horizonRules() {
  try {
    const h00 = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/horizons.json'), 'utf8')).rows.find((r) => r.id === 'H-00');
    if (!h00) return [];
    return [h00.aim, h00.stands, h00.pillar, h00.step, h00.know].filter(Boolean).map((t, i) => [`N${i + 1}`, t]);
  } catch { return []; }
}
export function rulesRows(name, { writers = [], fills = [] } = {}) {
  const flows = name === 'Horizons'
    ? 'A NOTE here is logged on the Horizons · log sheet with before and after, then cleared.'
    : `The board watch reads your typed cells every 5 minutes and hands each to the room that owns the row. Once a commit acts on it, the cell is cleared and the words move to this file's ${LOG_TAB} tab with that commit.`;
  return [RULES_HEAD,
    ['S1', `WHAT THIS SHEET IS FOR: ${purposeOf(name)}`],
    ['S2', `WHO WRITES IT: ${writers.length ? `scripts naming this sheet — ${writers.join(', ')}` : 'UNMEASURED — no script names this sheet'}. Every cell without (fill) is rewritten from the source; type only in (fill) cells.`],
    ['S3', `YOUR CELLS: ${fills.length ? fills.join(' · ') : 'none — this sheet is read-only for you'}`],
    ['S4', `WHERE YOUR WORDS GO: ${flows}`],
    ['S5', 'WHAT IT DOES NOT ANSWER: whether a row is right. The sheet shows what the record holds; the judgement stays yours.'],
    ...numbered(name), ...(name === 'Horizons' ? horizonRules() : []), ...LEGIBILITY_RULES, ...HOLD_RULES];
}
export function sameGrid(a = [], b = []) {
  const h = (g) => (g || []).find((r) => String((r || [])[0] ?? '').trim() === 'ID');
  const x = h(a), y = h(b); return Boolean(x && y && x.join('\u0001') === y.join('\u0001'));
}
export function writersOf(name, dir = resolve(REPO, 'scripts/ops')) {
  const q = `'${name}'`; return readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'sheet-tabs.mjs').filter((f) => readFileSync(resolve(dir, f), 'utf8').includes(q)).slice(0, 4);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const dry = a.includes('--dry'); const only = a.includes('--only') ? a[a.indexOf('--only') + 1] : null;
  const cells = await import('./board-cells.mjs'); const appendLogTab = cells.appendLogTab;
  const writeCells = async (...x) => { try { return await cells.writeCells(...x); } catch (e) { return { error: `network — ${e.cause?.code || e.message}` }; } }; const { byFirstCell } = await import('./mailbox-rebuild.mjs');
  const sheets = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets;
  let done = 0, skipped = 0, failed = 0;
  for (const [name, id] of Object.entries(sheets)) {
    if (only && name !== only) continue;
    if (isLens(name)) { console.log(`  · ${name}: skipped — a focus sheet; node scripts/ops/board-lens.mjs --tabs writes its Rules and Log`); skipped++; continue; }
    if (isShare(name)) { console.log(`  · ${name}: skipped — a share sheet; a new tab there is read by them`); skipped++; continue; }
    const live = await writeCells(id, { read: true }); if (live.error || live.off) { console.log(`  ✗ ${name}: ${live.error || live.why}`); failed++; continue; }
    const head = (live.values || []).find((r) => String((r || [])[0] ?? '').trim() === 'ID') || [];
    const rows = rulesRows(name, { writers: writersOf(name), fills: head.filter((h) => /\(fill\)\s*$/.test(String(h))).map(String) });
    const lr = await writeCells(id, { tab: RULES_TAB, read: true });
    // A sheet whose main tab IS named Rules (the board's Rules sheet) reads back its own grid here: the lines would land inside it and
    // strand 14 rows the writer then refused (2026-10-24). Same ID header on both reads = the same grid; skip it.
    if (sameGrid(live.values, lr.values)) { console.log(`  · ${name}: skipped — its main tab is the ${RULES_TAB} tab; the lines would land inside the board's grid`); skipped++; continue; }
    // A Rules tab that already exists (Mailbox IN's R1–R7) keeps its own header and rules; the shared lines (S, G, H) are added to it,
    // so a rule written in sheet-legibility.mjs reaches every sheet, not only the ones tabbed after it (2026-10-22: the G-lines had
    // reached no sheet tabbed before them).
    const has = (lr.values || []).some((x) => String((x || [])[0] ?? '').trim() === 'RULE');
    const { ops, append } = byFirstCell(lr.values || [], has ? rows.filter((x) => SHARED_LINE.test(x[0])) : rows);
    if (dry) { console.log(`  ${name}: Rules ${ops.length} cell(s) · ${append.length} row(s) · S1 ${rows[1][1].slice(0, 90)}`); continue; }
    const w = await writeCells(id, { tab: RULES_TAB, ops, append }); const l = await appendLogTab(id, LOG_TAB, LOG_HEAD, []);
    const bad = w.error || l.error; console.log(bad ? `  ✗ ${name}: ${bad}` : `  ✓ ${name}: Rules ${w.applied ?? 0} written · ${w.appended ?? append.length} added · Log tab ready`); bad ? failed++ : done++;
  }
  console.log(`  ${done} sheet(s) carry Rules + Log · ${skipped} share sheet(s) skipped · ${failed} failed${dry ? ' (dry)' : ''}`);
}
