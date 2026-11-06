#!/usr/bin/env node
// scripts/ops/mailbox-rpm.mjs — THE MAILBOX AS RPM, RANKED BY THE HORIZONS (operator 2026-10-20, verbatim: "re-prioritize the mailbox
// with your horizons in mind ... rethink it as why are we doing it? The purpose which can be inspired by RPM and then the result how we
// know and then the massive action, which includes your recommendations ... rewrite the rules for it ... that might mean we have to redo
// the whole thing ... definitely use it to link to the spreadsheet").
// Every open decision in data/vna/board-decisions.json carries: horizon (H-01 … H-10, docs/specs/vna/horizons.json) · why (the purpose)
// · result (how we know it is settled) · action (the massive action, our recommendation first). RANK: the nearest horizon first (H-01 is
// today), then id. A decision that names no horizon is SLUDGE: it is listed last, by name, never hidden.
// THE RULES — Mailbox IN's rules since bf-6566 (they replaced IN-R1…IN-R7); mailbox.mjs prints RPM_RULES as the sheet's rules panel and
// board-rules-row.mjs builds the sheet's row 1 from them, so they live here and nowhere else:
//   R1 WHY first: every row names the horizon it serves and the purpose in one line; a row that cannot is sludge, listed last.
//      Operator 2026-10-21, verbatim: "Expressed as theirs and ours addressing cannonical six human needs 1) co: (theirs and ours
//      connection) 2) cn: (contributions theirs and ours) 3) gr: (growth) uc: (undertainty) ce: cetrainty, si: significance". Each
//      decision names who THEIRS is (`them`) and carries `needs` {co,cn,gr,uc,ce,si: [theirs, ours]}; a missing need is sludge too.
//   R2 RESULT: one checkable fact that says it is settled.
//   R3 MASSIVE ACTION: our recommendation first, then the steps; the answer cell is his.
//   R4 RANK by the nearest horizon, never by when it was filed; the Horizons sheet is what re-ranks the mailbox.
//   R5 the top three rows are the ones to answer now; an answered decision moves to Mailbox OUT with what happened.
// LLM-free; prints a plain table for plan-consistency.sh. Port row: decides an order → C1042r (the mailbox ranker) in the crate.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RPM_HEAD = ['ID', 'HORIZON', 'WHY (the purpose)', 'RESULT (how we know)', 'MASSIVE ACTION (our recommendation first, then the steps)', 'YOUR ANSWER (fill)', 'YOUR NOTE (fill)'];
export const RPM_RULES = [
  { id: 'R1', text: 'R1 WHY first: every row names the horizon it serves and its purpose in one line, then the six needs in order, theirs then ours — co: the grip, upstream of the other five needs and of understanding itself, the thing they recognize before anything else can land · ours: the dots it connects · cn: the contribution it lets them make · ours: what we have to say and they have to hear · gr growth · uc uncertainty · ce certainty · si significance (always theirs first). A row\'s co names the demand, never an account or credential detail. A row that cannot is sludge, listed last. (operator 2026-10-21, verbatim: "connection is first because its grip, upsteam of everthing else like understanding, saying their anthrpoic account is not meanint bearing, lets update the rules to actually speak to the demand")', flow: { sheet: 'Horizons', why: 'the horizon each row serves' } },
  { id: 'R2', text: 'R2 RESULT: one checkable fact that says it is settled, tied to the horizon it moves — the horizon\'s HOW WE WOULD KNOW sits beside it, so a settled row shows which aim it pushed.', flow: { sheet: 'Spec', why: 'the row whose guard checks the fact' } },
  { id: 'R3', text: 'R3 MASSIVE ACTION: our recommendation first, then the steps; the answer cell is his.', flow: { sheet: 'Decisions', why: 'where his answer lands' } },
  { id: 'R4', text: 'R4 RANK by the nearest horizon, never by when it was filed; the Horizons sheet is what re-ranks the mailbox.', flow: { sheet: 'Horizons', why: 'move a horizon and the mailbox re-ranks' } },
  { id: 'R5', text: 'R5 the top three rows are the ones to answer now; an answered decision moves to Mailbox OUT with what happened.', flow: { sheet: 'Mailbox OUT', why: 'where an answered decision goes' } },
];
// R1's six needs, canonical order (Connection → Significance; CLAUDE.md THE COMMUNICATION DESIGN RULE). Theirs first, always.
export const NEEDS = ['co', 'cn', 'gr', 'uc', 'ce', 'si'];
export const missingNeeds = (d) => NEEDS.filter((k) => !(d.needs && Array.isArray(d.needs[k]) && String(d.needs[k][0] || '').trim() && String(d.needs[k][1] || '').trim()));
export function whyCell(d) {
  if (missingNeeds(d).length) return d.why || '';
  return [`${d.why}${d.them ? ` — theirs: ${d.them}` : ''}`, ...NEEDS.map((k) => `${k}: theirs ${d.needs[k][0]} · ours ${d.needs[k][1]}`)].join('\n');
}
// R2 (operator 2026-10-21: "tie them to horizons to make the result more legible too"): the fact, then the horizon it moves and how
// that horizon is known — read off horizons.json, never retyped.
export const resultLine = (result, h, hz) => (result && h && hz && hz.know ? `${result} → moves ${h}: ${hz.know}` : result || '');
// R3 + the walk (operator 2026-10-21: "use the wire exploration to write the recommendation on the massive action as well ... make it
// very clear to steer the selection"): the recommendation, then the open rows the walk finds it rides on, then the horizon it serves.
// The lead is the horizon's FIRST STEP TODAY (horizons.json); a walk ride is named only where it clears the margin floor (horizon-walk.mjs
// RIDE_FLOOR) — measured 2026-10-21: 6 of 31 rows clear it, so most cells name the lead alone, never a padded near-miss.
export const actionLine = (action, rides, h, hz) => [action || 'needs our recommendation', rides && rides.length ? `rides on ${rides.join(' · ')}` : '', h ? `serves ${h}${hz && hz.step ? `, whose lead today: ${String(hz.step).slice(0, 110)}` : ''}` : ''].filter(Boolean).join(' → ');
export const hzRank = (h) => { const m = String(h || '').match(/^H-(\d{2})$/); return m ? Number(m[1]) : 99; };
// C1165: an id already answered (data/vna/board-decision-answers.ndjson, the one ledger that marks a decision settled) never ranks as
// open, no matter what its own `done` field says or doesn't — a decision's prose ("already answered", "Answered go") is not the record.
export function rpmRows(decisions, answered = new Set()) {
  return decisions.filter((d) => !d.done && !answered.has(d.id)).map((d) => { const miss = missingNeeds(d); return { id: d.id, horizon: d.horizon || '', why: whyCell(d), result: d.result || '', action: d.action || d.guess || '', missing: miss, sludge: !d.horizon || miss.length > 0 }; })
    .sort((a, b) => hzRank(a.horizon) - hzRank(b.horizon) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  // bf-7094 (operator 2026-10-22 on C1017e: "replit is a very small issue, why did we elevate these?"): the tiebreak inside one horizon
  // was a string compare, so 'C1017d' sorted ahead of 'C244' and 'C99' and two Replit rows took R5's answer-now slots. Numeric now.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const answers = readFileSync(resolve(REPO, 'data/vna/board-decision-answers.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const answered = new Set(answers.map((a) => a.id));
  const rows = rpmRows(JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-decisions.json'), 'utf8')).decisions || [], answered);
  for (const r of rows) console.log(`  ${r.sludge ? '·' : '▸'} ${r.horizon || 'SLUDGE'} ${r.id}${r.sludge ? ' — names no horizon' : `\n      WHY ${r.why}\n      RESULT ${r.result}\n      ACTION ${r.action}`}`);
  const s = rows.filter((r) => r.sludge).length; console.log(`  ${rows.length} open · ${rows.length - s} on a horizon · ${s} sludge`);
  console.log(`  MAILBOX LOG — ${answers.length} answered:`);
  for (const a of answers) console.log(`    ✓ ${a.id} → ${a.answer} (${String(a.at || '').slice(0, 10)}, ${a.owner || '—'})`);
  process.exit(s ? 1 : 0);
}
