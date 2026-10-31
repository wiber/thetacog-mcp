// scripts/ops/board-overview.mjs — C1033: THE OVERVIEW OPENS ON THIS WEEK'S POSSIBILITIES, EACH WITH ITS SOURCE, NEVER COUNTS.
// Operator 2026-10-19 (relayed by wo12), verbatim: "we are misusing the surfaces - if I want to see the calander events use gcal, if
// I want to plan the week thats the spreadsheet - wrong altitude if we just copy the evetns (visitation for example is obviously
// wrong) tie it to the transcripts and emails and whatsapp events - paint it with possibilities we want to do - create overviw".
//
// A POSSIBILITY is one thing we could do this week, in plain words, with the record it came from beside it:
//   a spec row        — its plain head (C1027, data/vna/board-heads.ndjson), source = the spec file:line. A row with no written head
//                       is not shown in words it was never given; the block counts how many wait for one.
//   a decision        — data/vna/board-decisions.json, source = the decision id.
//   an open commitment — data/vna/open-commitments.ndjson (network's ledger: email awaiting reply, WhatsApp unanswered, a dated
//                       transcript promise), each row carrying its own source. Absent ledger → one UNMEASURED line naming it.
// The calendar is never a source (memory: visitation events are not plans): an item whose source is a calendar event is dropped.
// Rank is the board's one priority (board-priority.mjs specPriority): a decision reads as DECISION; an open commitment is his owed
// act, so it reads as YOUR-ACT. This file rates nothing of its own. LLM-FREE.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specPriority, loadContext } from './board-priority.mjs';
import { ranked } from './plain-heads.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const COMMITMENTS = 'data/vna/open-commitments.ndjson';
export const POSSIBILITIES_HEAD = "THIS WEEK'S POSSIBILITIES — what we could do, ranked, each with the record it came from";
const readNd = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const isCalendar = (src) => /calendar|gcal|\bevent\b/i.test(String(src || ''));
const plain = (h) => String(h.done_when || '').replace(/^Done when\s+/i, '').replace(/\.$/, '');

export function possibilities({ ctx = loadContext(), rows = ranked({ ctx }), decisions = null, commitments, top = 12 } = {}) {
  const decs = decisions ?? (() => { try { return JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-decisions.json'), 'utf8')).decisions || []; } catch { return []; } })();
  const cm = commitments !== undefined ? commitments : (existsSync(resolve(REPO, COMMITMENTS)) ? readNd(resolve(REPO, COMMITMENTS)) : null);   // null = the ledger is absent
  const items = []; let unwritten = 0;
  for (const r of rows) {
    const h = ctx.heads.get(r.id);
    if (!h || !h.head) { unwritten++; continue; }
    items.push({ p: r.priority, what: plain(h.head), you: h.head.from_you, source: `spec row ${r.id}` });
  }
  for (const d of decs) items.push({ p: specPriority({ ID: d.id, CLASS: 'DECISION' }, ctx).p, what: `decide: ${d.ask || d.id}`, you: 'your answer', source: `decision ${d.id}` });
  for (const c of cm || []) {
    if (!c.source || isCalendar(c.source)) continue;   // no source, or a calendar event: never a possibility
    items.push({ p: specPriority({ ID: c.id || '', CLASS: 'YOUR-ACT' }, ctx).p, what: c.what || c.text || '', you: c.you || 'your act', source: c.source });
  }
  // What needs him comes first (a decision, an owed act, a row whose head names his act), then what the rooms will do; inside each,
  // the one priority. A possibility he only watches is never ranked above one he can move.
  const needsYou = (x) => !/^nothing\b/i.test(String(x.you || '').trim());
  const shown = items.filter((x) => x.what).sort((a, b) => needsYou(b) - needsYou(a) || b.p - a.p).slice(0, top);
  const rowsOut = [[POSSIBILITIES_HEAD], ['PRIORITY', 'WHAT WE COULD DO', 'FROM YOU', 'SOURCE'], ...shown.map((x) => [String(x.p), x.what, x.you, x.source])];
  if (cm == null) rowsOut.push(['', `UNMEASURED — no ${COMMITMENTS} yet (network's ledger of owed emails, unanswered WhatsApp and dated transcript promises)`, '', '']);
  if (unwritten) rowsOut.push(['', `${unwritten} open spec rows wait for their plain head (node scripts/ops/plain-heads.mjs sample, on your ask)`, '', '']);
  return rowsOut;
}
