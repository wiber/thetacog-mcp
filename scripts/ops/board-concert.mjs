#!/usr/bin/env node
// scripts/ops/board-concert.mjs — bf-6534 00 · START HERE: every sheet in data/vna/board-drive.json, one row each, with the one question
// it answers, its link, its last write and its open count. Operator 2026-10-20, verbatim: "add all the sheets to the overview - lets make
// them work in concert - how? 12x12 and the year overview, days, weeks, fill in the gaps and predict - so we can scan and follow up on
// our timelines".
//
// WHERE EACH CELL COMES FROM (LLM-free): the sheet list is board-drive.json's `sheets` (the one address book); the question is
// SHEET_QUESTIONS below (hand-kept, one line per sheet; a sheet missing here reads UNMEASURED, never a filler); LAST WRITE is the Drive
// file's modifiedTime; OPEN COUNT is read off the sheet's own exported grid (openCount). A file in the board folder that board-drive.json
// does not name is listed at the foot, so the index never hides a sheet.
//   node scripts/ops/board-requirements.mjs --spec start [--print]     the one writer (cell mode once board-cell-writer.gs is deployed)
// Transport over records — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHeaderRow } from './board-layout.mjs';
import { lensSpecs } from './board-lens.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const START_HEAD = ['ID', 'SHEET', 'THE ONE QUESTION IT ANSWERS', 'LINK', 'LAST WRITE (UTC)', 'OPEN COUNT', 'NOTE (fill)'];
export const UNMEASURED = 'UNMEASURED';
// One question per sheet. The order here is the order on START HERE: the concert first (when, what, where), then the rest.
export const SHEET_QUESTIONS = {
  'START HERE': 'Which sheet answers my question, and how fresh is it?',
  'Steer · Compiled': 'Which compiled /steer asks are the most ready to dispatch, and what does each still lack?',
  'Signals · Pipeline': 'What did each session measure about the pipeline, the Rust walk, the flat NCD, the door, the machine, the package and the called shot, and which measurement is still owed?',
  Today: 'What is at the top of every list today, and which Horizon does each item move?',
  'Funnel · Sequence': 'What does a prospect decide at each step from first touch to provider, and where does the record measure it?',
  'Funnel · Surfaces': 'Where does a person meet us, which step does each place serve, and what does it end on?',
  Year: 'What happens on each day of the next twelve months, and where is today?',
  Metrics: 'What do the variables you balance say about sales, agent-years, cash and the aims, and how far apart are our guess, the explained limit and what was actually bought?',
  Demand: 'What creates demand for the warranty: the story, the levers across the horizons, the targets and the dated actions?',
  Calendar: 'What is dated on each day of the next twelve months (milestones, events, posts), and where should the numbers be by then?',
  '180 days': 'What lands in each week of the next year, and what is predicted where nothing is dated yet?',
  Meaning: 'What does each of the 144 intersections mean right now, and which weeks do its rows land in?',
  Priorities: 'What matters now, clearest first?',
  Horizons: 'What is the aim at each horizon, today to a thousand years, and what is the first step today?',
  Pillars: 'What do our readers already believe, and what does the vision stand on it for?',
  'Horizons · log': 'What did each of your notes on the Horizons change, before and after, and which commit did it?',
  'Mailbox IN': 'What is waiting on my answer?',
  'Mailbox OUT': 'What did I decide, and what happened since?',
  Promises: 'Who promised what, by when, and was it kept?',
  'Share · K4': 'What will K4 want to know before the 23 Oct call?',
  'Share · redacted name': 'What will Bryan want to know for the 23 Oct call and after?',
  'Share · Agenda · 23 Oct': 'What is on the agenda for the 23 Oct call with K4, Greg and Bryan?',
  Finance: 'What does the budget, P&L and balance sheet look like, and which numbers are guesses?',
  'Business Plan': 'What is the plan, row by row, and how clear is each row?',
  Spec: 'What is every open spec row, where does it sit on the 12×12, and is its guard green?',
  'Steer extension spec': 'What must the Steer extension do, clearest first?',
  Requirements: 'What must the board itself do, clearest first?',
  'The monologue': 'What does the board say, step by step, when I open it?',
  Now: 'What is each terminal working on right now?',
  Terminals: 'What did each session promise, and did a commit keep it?',
  Decisions: 'Which decisions are open, and what is recommended?',
  Overview: 'What is possible this week, and how many rows sit in each project?',
  Questions: 'Which spec questions need my answer or my act?',
  Projects: 'Which projects are live, who owns them, and how many rows are open?',
  Week: 'What is the plan for this week, slot by slot?',
  Month: 'What is the plan for this month?',
  Sessions: 'Which sessions are running, and what is each on?',
  Reports: 'Which reports were filed, and where do they live?',
  Rooms: 'What does each of the nine rooms hold?',
  Testers: 'Who is testing, and how far did each get?',
  Hats: 'Which hat reads which surface, and how is each graded?',
  Rules: 'Which rules bind, and which guard enforces each?',
  People: 'Who is in the network, newest first?',
  'Site pages': 'Which site pages exist, and what should change on each?',
  'Blog posts': 'Which posts are live, and what should change on each?',
  Newsletter: 'Which editions went out, and who read them?',
  Health: 'How long does each stage of my edit take to reach its room?',
  // The eight sheets added after this list (2026-10-21/22), each question read off its own spec title in board-requirements.mjs.
  Strategy: 'What are the live directions, the forest and the trees, one row each?',
  Weeks: 'What lands in each week of the next three years, read off the other sheets?',
  Outbox: 'What am I most likely to send next, and what needs my sign-off?',
  'Messages · DM + WhatsApp': 'What came in, why reply, and what is the draft to paste?',
  'Posts · LinkedIn': 'Which posts are dated, what is the text to paste, and is each draft ready?',
  Investors: 'Which investors are fastest to a first cheque, and what is the proof for and against each?',
  'Network · LinkedIn': 'Who is every LinkedIn connection, ranked, and where does each one fit?',
  'Network · X': 'Who is every X follower, ranked, and where does each one fit?',
  // The called shot (board-requirements.mjs CALLED_SHOT): one sheet per aspect of the build, its questions as columns.
  'Called Shot · The Picture': 'Where does each aspect of the called-shot build stand today, what is the next move, and what is mine to decide?',
  'Called Shot · Reward signal': 'Which field of the walk\'s reading can pay a model, and what has each one measured?',
  'Called Shot · Training ladder': 'What does each training rung cost, and what evidence does it buy?',
  'Called Shot · Activations': 'Does a model with open activations carry the called lane as a direction, model by model and experiment by experiment?',
  'Called Shot · Financial layer': 'Who pays for spec adherence as a financial activity, and what has each buyer been asked?',
  'Called Shot · Prior art': 'Who is closest to the called shot, how fast are they converging, and what is the tell?',
  'Called Shot · Risks': 'How can the reward be gamed or misread, and which cheats are caught today?',
  'Called Shot · Protected layer': 'Which side of the MIT line does each component sit on, and what must counsel answer?',
  'Called Shot · Spine': 'What stage is the trial at, what null does each stage reject, and which Horizon does each stage serve?',
};
// The focus sheets (board-lens.mjs) declare their own question, one per sheet, derived from the lens file — never hand-typed here.
for (const S of Object.values(lensSpecs())) if (!SHEET_QUESTIONS[S.sheet]) SHEET_QUESTIONS[S.sheet] = S.question;
const s = (v) => String(v ?? '').trim();
const isFill = (h) => /\(fill\)\s*$/.test(s(h));
const DONE = /\b(ticked|done|built|kept|closed|sealed|shipped|sent|answered)\b|^✓/i;

// OPEN COUNT off a sheet's own grid: the header row is the first one the layout reads as a header (board-layout.mjs isHeaderRow); the status column is the first header naming
// STATUS, READY, KEPT or STATE. A row with an id whose status cell does not read done is open. A sheet with no status column reports
// its id rows and says so — a count of rows is never presented as a count of open rows.
export function openCount(grid) {
  const hi = (grid || []).findIndex((r) => isHeaderRow(r));
  if (hi < 0) return `${UNMEASURED} — no header row`;
  const head = grid[hi];
  const sc = head.findIndex((h) => !isFill(h) && /\b(STATUS|READY|KEPT|STATE)\b/i.test(s(h)));
  const rows = grid.slice(hi + 1).filter((r) => Array.isArray(r) && s(r[0]) && !isHeaderRow(r));
  if (sc < 0) return `${rows.length} rows · no status column`;
  const open = rows.filter((r) => !DONE.test(s(r[sc])));
  return `${open.length} open of ${rows.length}`;
}
export const slug = (name) => 'S-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// HOW THE DATA FLOWS (operator 2026-10-22, verbatim: "survey the sheet system and write the sh rules into the start here - a flow chart for
// how the data flows through the sheets - can we do this both implictly with agents and explicitly with references across the sheets?
// done right this bubbles the highest signal (lowest sludge items through the pipes in a distruibuted way"). Three blocks under the index:
//   FLOW   the chart, one line per row — the IMPLICIT pipe, the agents that carry a typed cell to its record and back out to every sheet;
//   PIPES  the EXPLICIT references, DERIVED: sheet A pipes into sheet B when A's own source record is a file B's builder reads (a grep of
//          the builder for the record's path, said as such), FROM and INTO as live links. Never hand-typed, so a new builder reading a
//          record grows its pipe on the next pass and a pipe whose builder stops reading the file disappears;
//   RULES  P1–P7 (the pipe rules, here) and the G and H lines every internal Rules tab prints (sheet-legibility.mjs, quoted, never retyped).
// Why no IMPORTRANGE: a sheet that reads another sheet's cells makes a projection the source (CLAUDE.md: state never goes in a derived
// artifact), and each pair needs a hand grant. The record is the pipe; the link is navigation.
// COLUMN B IS HIS (2026-10-22 incident): the writer moves NOTE (fill) to column B (G6, prepareComposed), and every reader keys a column off
// the FIRST header. The first live write put these blocks' text in B; the watch read 47 of our cells as his typed words and handed 45 to
// the laboratory room (bf-7122…bf-7166, retracted). So every block row is [id, '', …]: B stays empty under every block (spread below).
import { LEGIBILITY_RULES, HOLD_RULES } from './sheet-legibility.mjs';
export const FLOW_HEAD = ['ID · FLOW', 'HOW A CELL TRAVELS (the implicit pipe: the agents)'];
// The chart keeps the shape of the one he already had (docs/specs/vna/goals/2026-10-20-the-chief-of-staff-board-steer.txt §3: three
// inlets, the ledgers, sheets do mechanics · agents do meaning, the Chief of Staff pass) and adds the pipes and the forest (G8: keep a
// structure that works).
export const FLOW_ROWS = [
  ['F-01', 'THREE INLETS:  YOUR VOICE (Steer extension → /steer)  ·  YOUR CELL (any (fill) cell)  ·  THE WORLD (calendar · mail · WhatsApp · commits)'],
  ['F-02', '        │ /steer <span>            │ board-watch.mjs every 5 min, zero tokens unless a sheet changed (HOLD stops it, H1)      │ importers, mechanical'],
  ['F-03', '        ▼                          ▼                                                                                      ▼'],
  ['F-04', 'THE LEDGERS (append-only, in the repo): spec rows · board-answers · board-mailbox · promises · decisions · edits  ── the one blackboard (W1)'],
  ['F-05', '        ├──► SHEETS do mechanics: sort · count · colour · alarm · one ranking · row-1 rules · the receipt'],
  ['F-06', '        └──► AGENTS do meaning: classify · recommend · summarise · place on the 12×12 · chase a late promise'],
  ['F-07', '             an ANSWER lands on its row as your verbatim span (board-answers.mjs) · a COMMENT runs as a /steer (board-comments.mjs)'],
  ['F-08', '             a DECISION fans out: every open row whose WAITS ON names it, plus the 3 nearest under the null (board-fanout.mjs)'],
  ['F-09', '        ▼'],
  ['F-10', 'THE RECORDS change (docs/specs/vna/*.json) ──► every sheet that reads one is rewritten cell by cell  ── the PIPES block (W2)'],
  ['F-11', '        ▼'],
  ['F-12', 'THE FOREST: each sheet sits on one block of the 12×12, placed by the one Rust walk  ── the FOREST block; the trees are its rows (W4)'],
  ['F-13', '        ▼'],
  ['F-14', 'THE CHIEF OF STAFF pass: at most 10 decision-ready rows reach the TOP (options · recommendation · evidence); the rest go back (C1030, W6)'],
  ['F-15', '        ▼'],
  ['F-16', 'YOU decide in one cell ──► the room works it ──► a commit ──► your note moves to the Log tab ──► Mailbox OUT'],
  ['F-17', '        └──► the promise reads KEPT or LATE ──► back to THE LEDGERS at F-04'],
];
// WHY THIS SHAPE: the published result each part of the chart already is. Each line names the mechanism here that carries it, and an
// idea the board does not yet carry is marked OPEN with the bifurcation that holds it, never written as built.
export const WHY_HEAD = ['ID · WHY', 'WHY THIS SHAPE WORKS (the published result · what carries it here)'];
export const WHY_ROWS = [
  ['W1', 'BLACKBOARD (Erman, Hayes-Roth, Lesser & Reddy 1980, Hearsay-II; Nii 1986): specialists never call each other; they read and write one shared board, and a control step picks the best entry. Here the ledgers are the board, the rooms the specialists, the TOP the control step.'],
  ['W2', 'STIGMERGY (Grassé 1959; Heylighen 2016): agents coordinate through traces left in a shared medium, not through messages. Here a commit changes a record and every sheet reading it moves (P1).'],
  ['W3', 'DEGREE OF INTEREST (Furnas 1986, the generalized fisheye view): interest = importance minus distance from the focus. Here priority is the importance and the 12×12 gives the distance. OPEN: ranking the TOP by both is not built.'],
  ['W4', 'OVERVIEW FIRST, ZOOM AND FILTER, DETAILS ON DEMAND (Shneiderman 1996): the forest is the 12×12 count of where the sheets and rows sit; the trees are the rows in one block; the detail sits to the right (G2).'],
  ['W5', 'NEAR-DECOMPOSABILITY (Simon 1962, The Architecture of Complexity): a hierarchy holds when links inside a block are dense and links across blocks are sparse. The PIPES block names each pipe\'s two blocks, so a long crossing shows.'],
  ['W6', 'LITTLE\'S LAW AND THE WIP LIMIT (Little 1961; Anderson 2010): waiting time = work in progress ÷ throughput. The TOP holds at most 10, so what reaches you is never older than the pace you decide at.'],
  ['W7', 'INFORMATION SCENT (Pirolli & Card 1999): a reader follows the link whose label best predicts the payoff. Each sheet\'s ONE QUESTION is its scent; each link cell names the sheet it lands on.'],
];
export const FOREST_HEAD = ['ID · FOREST', 'BLOCK (12×12)', 'SHEETS THERE', 'WHICH SHEETS', 'WHAT THE BLOCK MEANS (the 144 tile)', 'HOW IT IS PLACED'];
// placed: Map sheet → { coord, tile, err } — the one Rust walk over the sheet's question (board.mjs placeItems), a COUNT map of placements,
// never a panel: a claim about where prose lands still reads the 144×144 encircled panel. Densest block first: where the forest is thick.
export function forestBlock(placed, sheets = {}, gids = {}) {
  if (!placed) return [['FOREST-00', `${UNMEASURED} — the sheets were not placed on this run`]];
  const by = new Map(); const off = [];
  for (const name of Object.keys(sheets)) { const p = placed.get(name); if (p && p.coord) { const e = by.get(p.coord) || { tile: p.tile, names: [], bands: {} }; e.names.push(name); const b = p.band || UNMEASURED; e.bands[b] = (e.bands[b] || 0) + 1; by.set(p.coord, e); } else off.push(`${name} (${(p && p.err) || 'not walked'})`); }
  const rows = [...by].sort((x, y) => y[1].names.length - x[1].names.length || x[0].localeCompare(y[0])).map(([coord, e]) => [`FOREST-${coord}`, coord, String(e.names.length),
    e.names.length === 1 ? linkTo(e.names[0], sheets, gids) : e.names.sort().join(' · '), e.tile || '', `the one Rust walk over the sheet's ONE QUESTION (placeItems) · band: ${Object.entries(e.bands).map(([b, n]) => `${n} ${b}`).join(', ')} · one line is a thin reading; the rows' own count map is the Lattice tab (board-lattice.mjs)`]);
  return off.length ? [...rows, ['FOREST-UNMEASURED', UNMEASURED, String(off.length), off.join(' · ').slice(0, 1500), '', 'the walk refused or did not run; never guessed into a block']] : rows;
}
// The walk is ~0.9 s a sheet, so a placement is kept per question text (out/ is gitignored): a changed question is walked again.
export const FOREST_CACHE = 'out/board/start-forest.json';
export async function placeSheets(names) {
  const { existsSync, writeFileSync, mkdirSync } = await import('node:fs');
  const f = resolve(REPO, FOREST_CACHE); let cache = {}; try { if (existsSync(f)) cache = JSON.parse(readFileSync(f, 'utf8')); } catch { cache = {}; }
  const todo = names.filter((n) => SHEET_QUESTIONS[n] && !(cache[SHEET_QUESTIONS[n]] && cache[SHEET_QUESTIONS[n]].coord));
  if (todo.length) {
    const { placeItems } = await import('./board.mjs');
    for (const it of placeItems(todo.map((n) => ({ id: n, text: SHEET_QUESTIONS[n] })))) cache[SHEET_QUESTIONS[it.id]] = { coord: it.coord, tile: it.coord ? it.tile : '', err: it.walkErr, band: it.band || null };
    mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(cache, null, 1));
  }
  return new Map(names.map((n) => [n, SHEET_QUESTIONS[n] ? cache[SHEET_QUESTIONS[n]] || null : { coord: null, err: 'no question declared' }]));
}
export const PIPE_HEAD = ['ID · PIPE', 'FROM SHEET (owns the record)', 'INTO SHEET (its builder reads it)', 'THROUGH THE RECORD', 'MOVED BY', 'HOW THE PIPE IS KNOWN'];
export const PIPE_RULES = [
  ['P1', 'A SHEET NEVER READS ANOTHER SHEET\'S CELLS. Data moves through the record: each sheet is rebuilt from its files, so two sheets that read one file stay in step.'],
  ['P2', 'YOUR CELL IS THE ONLY INLET. The watch reads it within 5 minutes and hands it to the room that owns the row; the room changes the record; every sheet reading that record is rewritten.'],
  ['P3', 'A DECISION FANS OUT TWICE: by name, to every open row whose WAITS ON cites it; by nearness, to the 3 open rows nearer than the median distance. Each hand-off carries the distance.'],
  ['P4', 'THE PIPE CARRIES SIGNAL, NOT SLUDGE: priority is derived, never typed; each sheet ranks highest first; a row reaches the TOP only decision-ready, and anything less goes back to its room.'],
  ['P5', 'THE MOVE IS THE RECEIPT: a note a commit acted on leaves its cell for the same sheet\'s Log tab, with the commit.'],
  ['P6', 'A LINK IS NAVIGATION, THE RECORD IS THE DATA: a FROM or INTO cell takes you up or down the pipe; it never copies a value.'],
  ['P7', 'A PIPE IS DERIVED, NEVER TYPED: the PIPES table is a grep of each builder for the record it reads. A pipe missing here is a builder that reads no shared record.'],
];
export const RULES_BLOCK_HEAD = ['ID · RULE', 'THE SHEET RULES (P: the pipes · G: every sheet reads clear · H: the night hold · S1–S5 sit on each sheet\'s own Rules tab)'];

// The sheets whose builder is not a board-requirements SPECS entry: the builder file and the record it owns.
export const OTHER_BUILDERS = {
  'Mailbox IN': { build: './mailbox.mjs', src: 'data/vna/mailbox-tickets.json' },
  'Mailbox OUT': { build: './mailbox.mjs', src: null },   // built in the same pass as Mailbox IN, off the same records
  Promises: { build: './board-promises.mjs', src: 'data/vna/board-promises.ndjson' },
  Metrics: { build: './board-metrics.mjs', src: 'data/vna/metrics-actuals.json' },
  Demand: { build: './board-demand.mjs', src: 'docs/specs/vna/warranty-demand.json' },
  Calendar: { build: './board-calendar.mjs', src: 'data/vna/calendar-events.json' },
  Meaning: { build: './board-meaning.mjs', src: null },
  Overview: { build: './board-overview.mjs', src: 'data/vna/open-commitments.ndjson' },
  Decisions: { build: './board-top.mjs', src: 'data/vna/board-decisions.json' },
};
const RECORD = /(?:docs\/specs\/vna|data\/vna|out\/board\/[\w-]+)\/[\w.-]+\.(?:json|ndjson)/g;
// sheet → { build, src, reads:Set } off SPECS + OTHER_BUILDERS; reads = the record paths named in the builder file, plus its own src.
// A build-only spec's src is documentation (outbox.mjs header), so it counts as owned only when the builder names it too.
export function sheetRecords(specs = {}, { readBuilder = (b) => readFileSync(resolve(REPO, 'scripts/ops', b), 'utf8') } = {}) {
  const out = new Map();
  const add = (sheet, build, src) => {
    let txt = ''; if (build) { try { txt = readBuilder(build); } catch { txt = ''; } }
    const reads = new Set(txt.match(RECORD) || []);
    const owned = src && (!build || reads.has(src) || !txt) ? src : (src && reads.has(src) ? src : null);
    if (src && !build) reads.add(src);
    const prev = out.get(sheet); if (prev) { for (const r of reads) prev.reads.add(r); return; }
    out.set(sheet, { build: build ? `scripts/ops/${build.replace('./', '')}` : 'scripts/ops/board-requirements.mjs', src: owned, reads });
  };
  for (const S of Object.values(specs)) if (S && S.sheet) add(S.sheet, S.build || null, S.src || null);
  for (const [sheet, B] of Object.entries(OTHER_BUILDERS)) if (!out.has(sheet)) add(sheet, B.build, B.src);
  return out;
}
// One pipe per RECORD, never per pair: a record owned by several sheets (days180-events.json feeds four) is one hub, not twenty edges.
// START HERE and board-drive.json are left out: the index links every sheet (navigation), and naming every record in this file is not reading it.
export const NOT_A_PIPE = new Set(['START HERE']);
export const NOT_A_RECORD = new Set(['data/vna/board-drive.json']);
// One record per person (docs/specs/vna/lens/<slug>.json) is one mechanism, so the per-person files fold into one pipe.
export const recordKey = (path) => path.replace(/^(docs\/specs\/vna\/lens\/)[\w-]+\.json$/, '$1<person>.json');
export function pipes(records, sheets = {}) {
  const by = new Map();
  for (const [name, R] of records) {
    if (NOT_A_PIPE.has(name) || !(name in sheets)) continue;
    if (R.src && !NOT_A_RECORD.has(R.src)) { const k = recordKey(R.src); const e = by.get(k) || { through: k, from: [], into: [], by: new Set() }; e.from.push(name); by.set(k, e); }
  }
  for (const [name, R] of records) {
    if (NOT_A_PIPE.has(name) || !(name in sheets)) continue;
    for (const [rec, e] of by) if ([...R.reads].some((r) => recordKey(r) === rec) && !e.from.includes(name)) { e.into.push(name); e.by.add(R.build); }
  }
  return [...by.values()].filter((e) => e.from.length + e.into.length >= 2)
    .map((e) => ({ ...e, from: e.from.sort(), into: e.into.sort(), by: [...e.by].sort() }))
    .sort((x, y) => (y.from.length + y.into.length) - (x.from.length + x.into.length) || x.through.localeCompare(y.through));
}
// [id, a, b, …] → [id, '', a, b, …]: column B is NOTE (fill) on the live sheet, never ours to write.
export const spareB = (r) => (r.length ? [r[0], '', ...r.slice(1)] : r);
const linksTo = (names, sheets, gids) => !names.length ? '— (the sheets in FROM share it)' : names.length === 1 ? linkTo(names[0], sheets, gids) : names.length > 6 ? `${names.length} sheets: ${names.slice(0, 2).join(' · ')} · …` : names.join(' · ');
const linkTo = (name, sheets, gids) => sheets[name] ? `=HYPERLINK("https://docs.google.com/spreadsheets/d/${sheets[name]}/edit${gids[name] ? `#gid=${gids[name]}` : ''}","${name.replace(/"/g, "'")}")` : name;
export function flowBlocks({ sheets = {}, gids = {}, records = null, placed = null } = {}) {
  const at = (names) => placed ? [...new Set(names.map((n) => (placed.get(n) || {}).coord || '?'))].join(' · ') : '';
  const edges = records ? pipes(records, sheets) : [];
  const pipeRows = records
    ? (edges.length ? edges.map((e, i) => [`PIPE-${String(i + 1).padStart(2, '0')}`, linksTo(e.from, sheets, gids), linksTo(e.into, sheets, gids), e.through, e.by.join(' · ') || 'board-lens.mjs (the share gate: one record, two sheets)', `${e.from.length} sheet(s) own it · ${e.into.length} builder(s) name its path${placed ? ` · on the 12×12: ${at(e.from)} → ${at(e.into) || '—'}` : ''}`])
      : [['PIPE-00', `${UNMEASURED} — no two sheets share a record the builders name`]])
    : [['PIPE-00', `${UNMEASURED} — the builders were not read`]];
  const blocks = [[], FLOW_HEAD, ...FLOW_ROWS, [], PIPE_HEAD, ...pipeRows, [], FOREST_HEAD, ...forestBlock(placed, sheets, gids), [], WHY_HEAD, ...WHY_ROWS, [], RULES_BLOCK_HEAD, ...PIPE_RULES, ...LEGIBILITY_RULES, ...HOLD_RULES];
  return blocks.map(spareB);
}
const order = (names) => [...names].sort((a, b) => { const ka = Object.keys(SHEET_QUESTIONS); const ia = ka.indexOf(a), ib = ka.indexOf(b); return (ia < 0 ? 1e3 : ia) - (ib < 0 ? 1e3 : ib) || a.localeCompare(b); });

/**
 * sheets: { name → file id } (board-drive.json); files: [{ id, name, modifiedTime }] from the board folder (or null when unread);
 * grids: Map file id → exported grid (or a string why it was not read).
 */
export function composeStartHere({ sheets = {}, gids = {}, files = null, grids = new Map(), at = new Date(), records = null, placed = null } = {}) {
  const byId = new Map((files || []).map((f) => [f.id, f]));
  const rows = order(Object.keys(sheets)).map((name) => {
    const id = sheets[name]; const f = byId.get(id); const g = grids.get(id);
    return [slug(name), name, SHEET_QUESTIONS[name] || `${UNMEASURED} — no question declared (add it to SHEET_QUESTIONS in scripts/ops/board-concert.mjs)`,
      `https://docs.google.com/spreadsheets/d/${id}/edit${gids[name] ? `#gid=${gids[name]}` : ''}`,
      f ? f.modifiedTime.slice(0, 16).replace('T', ' ') : `${UNMEASURED} — ${files ? 'not in the board folder' : 'Drive not read'}`,
      Array.isArray(g) ? openCount(g) : `${UNMEASURED} — ${g || 'grid not read'}`, ''];
  });
  const named = new Set(Object.values(sheets));
  const stray = (files || []).filter((f) => !named.has(f.id) && f.mimeType !== 'application/vnd.google-apps.folder');
  return [START_HEAD, ...rows, [],
    // The footer rows carry ids: the writer's last-written ledger keys a cell by its row id, so an id-less footer whose stamp moves
    // was read as a typed cell and refused the whole sheet (G6 pass, 2026-10-22: "1 typed cell(s) would be blanked: row 81·SHEET").
    ['S-footer', `rewritten ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${rows.length} sheets from data/vna/board-drive.json · the concert: 180 days holds the year (Y- rows) and the weeks (W- rows), Meaning links each 12×12 cell to the weeks its rows land in · no model in the path`],
    ...(stray.length ? [['S-stray', `in the board folder but not in board-drive.json (${stray.length}): ${stray.map((f) => f.name).join(' · ')}`]] : []),
    ...flowBlocks({ sheets, gids, records, placed })];
}

// The live read: the folder listing (modifiedTime) and every sheet's grid, in parallel. No token → every live cell says UNMEASURED.
export async function compose({ at = new Date() } = {}) {
  const j = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8'));
  const { rcloneToken } = await import('./board-comments.mjs');
  const t = rcloneToken(); const grids = new Map(); let files = null;
  if (t.token) {
    const { exportGrid } = await import('./board-sheets-write.mjs');
    const q = encodeURIComponent(`"${j.folder.id}" in parents and trashed=false`);
    try { files = (await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&pageSize=500`, { headers: { authorization: `Bearer ${t.token}` } })).json()).files || null; } catch { files = null; }
    await Promise.all(Object.values(j.sheets).map(async (id) => { try { grids.set(id, await exportGrid(t.token, id)); } catch (e) { grids.set(id, `export failed: ${String(e.message).slice(0, 60)}`); } }));
  } else for (const id of Object.values(j.sheets)) grids.set(id, `no Drive token (${t.why})`);
  const { SPECS } = await import('./board-requirements.mjs');   // dynamic: board-requirements' SPECS.start builds through this file
  return composeStartHere({ sheets: j.sheets, gids: j.gids || {}, files, grids, at, records: sheetRecords(SPECS), placed: await placeSheets(Object.keys(j.sheets)) });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) for (const r of await compose()) console.log(r.map((c) => String(c).slice(0, 70)).join(' │ '));
