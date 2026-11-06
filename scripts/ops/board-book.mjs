#!/usr/bin/env node
// scripts/ops/board-book.mjs — THE ONE CANONICAL VIEW: one spreadsheet, Decide first, every other view a tab that feeds it.
// Operator 2026-10-19, verbatim: "one decision matrix that I can look at … the point is to create one canonical view that we can use
// properly that means as to be free … legible and then be clear decision with a comment next to it about upcoming tasks and then we
// can populate the other views … They have to be prioritized. They have to be obvious they have to make sense. They have to be a
// reminder of what's already on my mind … have the sheets feed into each other with named rangers".
//
// Why one file: the board was eighteen spreadsheets, and separate files cannot feed each other (a named range and a formula reach
// only inside their own spreadsheet). This book is ONE spreadsheet with tabs:
//   Decide    — at most 15 rows, a state machine (C1038): STATE (ELIGIBLE · SUSPENDED · DISPATCHED), the one predicate SUSPENDED BY,
//               the DISPATCH VECTOR that fires, PRIORITY; eligible first. No guess, no question prose. His comment cell beside each.
//   Mailbox   — the display tape: every cell he typed, where it went, the commits since, the row's done-when beside its state.
//   Now       — every terminal: prior · present · future (board-now.mjs).
//   Tasks     — every open task, grouped by project (board-sheets-write.mjs projectsSheet).
//   Map       — the 12×12: open tasks per row × column of the lattice, the 12 canonicals named on both axes, a heat scale.
//   Tiles     — every tile with open work: its name, hat, the tasks landing there, its full semantic dump.
//   Questions — every open question (board.mjs).
// Named ranges (xlsx definedNames, kept by Google's conversion): Decide, Now, Tasks, Map, Tiles, Questions over each table, Tasks_Priority over
// the priority column; Decide's closing line counts off Tasks by formula, so the views feed the top.
// His COMMENT / CHANGE IT cells are carried across every rewrite by (tab, row id, header). LLM-FREE; runs on his ask and on rest.
//
//   node scripts/ops/board-book.mjs --print     the Decide tab to stdout (--tab Map for another)
//   node scripts/ops/board-book.mjs             write the book (created in the board folder on first run, id in board-drive.json)
// Port row: transport over records the board already composes — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { styledSheetXml, XLSX_STYLES, layoutFor } from './board-layout.mjs';
import { withRulesRow, rulesOffset } from './board-rules-row.mjs';
import { mergeFills, fillsOf, projectsSheet } from './board-sheets-write.mjs';
import { fullName } from '../../src/lib/pmu/declared-reading.mjs';
import { cellWords, rowsFromRecord, wordLine } from '../vna/cell-words.mjs';

// The 12 canonicals by their own names: "A1" → "A1 · Law", "B" → "B · Tactics" (src/lib/pmu/declared-reading.mjs fullName).
export const canonLabel = (c) => { const n = String(fullName(`${c},${c}`) || '').split(/\s*×\s*/)[0].split('.').pop(); return n ? `${c} · ${n}` : c; };
// MAP: where the open tasks sit on the 12×12 — the board's own count grid (board-surfaces Tesseract map), axes named, a heat scale.
// C1044: beside the counts, the same 12×12 as words — each cell's state named off the rows the walk placed there (scripts/vna/cell-words.mjs),
// UNMEASURED where nothing is placed. `words` is that Map (pixel → entry); without it the block says UNMEASURED once, never a blank grid.
export function mapTab(grid, words = null) {
  if (!grid || !grid.length) return [['ID', 'UNMEASURED — the Tesseract map tab did not compose']];
  const head = ['ID', ...grid[0].slice(1, 13).map(canonLabel), ...grid[0].slice(13)];
  const order = grid.slice(1, 13).map((r) => r[0]);
  const wordsBlock = words && words.size
    ? [['WHAT IS GOING ON · row ↓ × col →', ...grid[0].slice(1, 13).map(canonLabel)], ...order.map((r) => [canonLabel(r), ...grid[0].slice(1, 13).map((c) => wordLine(words.get(`${r},${c}`), 3))])]
    : [['WHAT IS GOING ON', 'UNMEASURED — the cell words did not compose (scripts/vna/cell-words.mjs)']];
  return [head, ...grid.slice(1, 13).map((r) => [canonLabel(r[0]), ...r.slice(1, 13).map((v) => Number(v) || 0), ...r.slice(13)]), [], ['', 'each cell: how many open spec rows land on that row × column of the lattice · the Tiles tab lists them'],
    [], ...wordsBlock, ['', 'each cell: the words its own placed rows share most and the rest of the tree uses least · open rows, else ticked · UNMEASURED = no row placed there']];
}
// TILES: one row per tile with open work, busiest first — the tile's name, its hat, the rows landing there, its semantic dump.
export const TILES_HEAD = ['ID', 'OPEN HERE', 'TILE', 'HAT', 'WHAT IS GOING ON (words off the rows placed here)', 'TASKS LANDING HERE', 'WHAT THE TILE IS', 'COMMENT (fill)'];
export function tilesTab(t, words = new Map()) {
  if (!t || !t.length) return [['ID', 'UNMEASURED — the Tesseract tab did not compose']];
  const h = t[0]; const at = (r, k) => r[h.indexOf(k)] ?? '';
  const rows = t.slice(1).filter((r) => r && /^T-/.test(String(r[0])) && Number(String(at(r, 'BASINS HERE (open / all)')).split('/')[0]) > 0)
    .map((r) => { const c = String(at(r, 'COORDINATE')); const [a, b] = c.split(','); return [c, Number(String(at(r, 'BASINS HERE (open / all)')).split('/')[0]) || 0, `${canonLabel(a)} × ${canonLabel(b)}`, at(r, 'HAT'), wordLine(words.get(c)), at(r, 'SPEC ROWS LANDING HERE'), at(r, 'THE TILE (full semantic dump)'), '']; })
    .sort((x, y) => y[1] - x[1]);
  return [TILES_HEAD, ...rows];
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// C1038 → C1039: the Decide tab is a state machine, and its schema is the one every list shares (scripts/ops/board-row.mjs). No guess
// column, no question prose; STATE · SUSPENDED BY · DISPATCH VECTOR · PRIORITY, eligible first.
import { SHARED, STATE_RANK, splitAsk, decisionGate, rowGate, askGate, terminalGate, sharedRow, sortShared, project, clip, plainCase, genericName, dateOf, nameWaits } from './board-row.mjs';
export { STATE_RANK, splitAsk, decisionGate, rowGate };
export const DECIDE_HEAD = [...SHARED, 'YOUR COMMENT (fill)'];
const readNd = (p) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// The rows that wait on an id: every open task whose WAITS ON names it.
const unlocks = (id, tasks) => tasks.filter((t) => new RegExp(`\\b${id}\\b`).test(String(t[6] || ''))).map((t) => t[0]);

// A ticked spec row is SEALED and leaves the view, even while its decision entry still stands (C1023/C1024 sat here ticked).
// Sort strictly: STATE (eligible first) → PRIORITY (high first) → TARGET DATE (soonest first, none last) → how many rows wait on it.
export function decideRows({ decisions, answers = new Map(), tasks, possibilities = [], heads = new Map(), sealed = new Set(), ranked = new Map(), top = 15 }) {
  const out = [];
  for (const d of decisions.filter((x) => !sealed.has(x.id))) {
    const topic = String(d.head || splitAsk(d.ask).q).split(/\s+·\s+/)[0];
    out.push(sharedRow({ id: d.id, entity: `${topic} (${d.owner || 'unowned'})`, target: d.target || (ranked.get(d.id) || {}).target, gate: decisionGate(d, answers.get(d.id)), priority: Number(d.priority) || (ranked.get(d.id) || {}).p || 7, extras: [''] }));
  }
  const seen = new Set(decisions.map((d) => d.id));
  for (const p of possibilities) {
    if (seen.has(p.id) || sealed.has(p.id) || /^decision\b/.test(String(p.source))) continue;
    const h = (heads.get(p.id) || {}).head || {};
    // C1039i (three Decide readings, 2026-10-20: "ENTITY text is truncated mid-sentence"): a spec row is named by the Tasks tab's
    // short name (WHAT IT IS, first clause), never its done-when sentence cut at 70.
    const tn = (tasks.find((t) => t[0] === p.id) || [])[2];
    const name = String(tn || p.what || p.id).replace(/^\(built [^)]*\)\s*/, '').replace(/^Your-act:\s*/i, '').split(/\s+—\s+|\.\s+|:\s+/)[0];
    const short = name.length <= 60 ? name : name.slice(0, 60).replace(/\s+\S*$/, '');   // whole words, never a broken one
    out.push(sharedRow({ id: p.id, entity: short, target: p.target || (ranked.get(p.id) || {}).target, gate: rowGate({ id: p.id, you: h.from_you ?? p.fromYou, waits: h.waits_on }), priority: (ranked.get(p.id) || {}).p ?? (Number(p.priority) || 0), extras: [''] }));
  }
  return sortShared(out, (id) => unlocks(id, tasks).length).slice(0, top);

}

// C1103 (Requirements R-00, done-when part 1 — "every Decide row carries a recommendation"): DISPATCH VECTOR is Decide's
// recommendation column (sharedRow always fills it, '—' on a sealed footer row only); a real row with it blank names itself.
export function decideMissingRecommendations(tabs) {
  const decide = (tabs || []).find(([n]) => n === 'Decide');
  if (!decide) return ['Decide tab did not compose'];
  const [head, ...rows] = decide[1]; const vi = head.indexOf('DISPATCH VECTOR');
  return rows.filter((r) => r && r.length > 1 && String(r[0] || '').trim() && !String(r[0]).startsWith('=')).filter((r) => !String(r[vi] ?? '').trim()).map((r) => r[0]);
}

// MAILBOX — THE DISPLAY TAPE: every cell he typed, where it went, how, and what happened since. Operator 2026-10-19, verbatim: "the
// mailbox pattern is definitely something we need. Expressed as a spreadsheet … leave the state of different project executions in
// there … track adherence to the spec on a side-by-side place and build the … display tape … the link to the comment that was
// generated by a bunch of actions". One row per hand-off (data/vna/board-mailbox.ndjson), newest first, built through board-row.mjs
// (sharedRow + sortShared) so it leads with the shared seven, his own columns to the right (C1041 — the 2026-10-20 cold read graded
// this tab 3: "every row reads done and nothing shows what still waits"). STATE off the record, no model: a ticked row is SEALED and
// leaves the list; commits since name it and the row is still open → DISPATCHED; no commits yet → SUSPENDED by the room that has not
// picked it up; a hand-off that failed outright → ELIGIBLE, re-send. PRIORITY is the row's own derived priority off the Questions
// tab, else 5.
export const MAILBOX_HEAD = [...SHARED, 'WHEN', 'YOUR CELL', 'WHAT HAPPENED SINCE (commits naming it)', 'DONE WHEN (the row)', 'COMMENT (fill)'];
export function mailboxTab({ mail, bfs = new Map(), commitsSince = () => [], rowState = () => '', doneWhen = () => '', priorityOf = () => 5, topicOf = (id) => id }) {
  const real = (m) => /^\S{1,80}$/.test(String(m.id || '')) && !/\(fill\)\s*$/.test(String(m.value || ''));   // board-watch isRealCell: a label row is never his cell
  const rows = [];
  for (const m of mail.filter(real).slice().reverse()) {
    if (rowState(m.id) === 'ticked') continue;   // SEALED — the row behind this hand-off closed; it leaves the list
    const b = m.bf ? bfs.get(m.bf) : null; const cs = commitsSince(m.id, m.at); const room = (b && b.to_room) || m.room || 'its room';
    const gate = m.ok === false ? { state: 'ELIGIBLE', by: '', vector: `re-send to ${room}` }
      : cs.length ? { state: 'DISPATCHED', by: '', vector: `${cs.length} commit(s) since — ${room}` }
      : /^\s*WAITING FOR:?\s*/i.test(String(m.value || '')) ? { state: 'SUSPENDED', by: `External: ${clip(String(m.value).replace(/^\s*WAITING FOR:?\s*/i, ''), 80)}`, vector: `${room} fires it when that lands` }   // C1039g: his own WAITING FOR names the wait
      : { state: 'SUSPENDED', by: `Room: ${room} has not picked it up`, vector: `/steer ${m.id}` };
    const dw = doneWhen(m.id);
    // C1041b (cold read 2026-10-20: '"A ($6M cap, raise $500k)" isn't an entity'): ENTITY is what the row IS, then what he wrote.
    rows.push(sharedRow({ id: m.hash, entity: `${topicOf(m.id)} — you wrote "${clip(m.value, 40)}"`, target: dateOf(dw), gate, priority: priorityOf(m.id),
      extras: [String(m.at || '').replace('T', ' ').slice(0, 16), `${m.tab} · ${m.id} · ${m.field}`, cs.length ? cs.slice(0, 4).join(' · ') : 'nothing yet', clip(dw, 300) || '—', ''] }));
  }
  return [MAILBOX_HEAD, ...sortShared(rows)];
}

// C1039: the three lists that predate the shared schema, re-projected onto it — the tab's own builder is untouched (additive), the
// shared seven lead, redundant and sludge columns drop, his (fill) cells keep their exact header.
const firstOf = (t) => String(t || '').replace(/^\(built [^)]*\)\s*/, '').replace(/^Your-act:\s*/i, '').split(/\s+—\s+|\.\s+|:\s+/)[0].slice(0, 60);   // C1039g: the first clause, at most 60 — a label, never a paragraph
const entityOfRow = (at, r, whatById = new Map()) => { for (const c of [at('WHAT IT IS'), whatById.get(r && r[0]), at('THE QUESTION (the row, summarised)'), at('NOW'), at('DONE WHEN')]) { const e = plainCase(firstOf(c)); if (e && !genericName(e)) return e; } return '—'; };
export function questionsProjected(table, { dById = new Map(), answers = new Map(), tasks = [] } = {}) {
  const whatById = new Map(tasks.map((t) => [t[0], t[2]]));
  return project(table, { drop: ['DONE WHEN'],
    gateOf: (at, r) => { const id = r[0]; const cls = at('CLASS');
      if (dById.has(id)) return decisionGate(dById.get(id), answers.get(id));
      if (/^ANSWERED/i.test(at('STATUS'))) return { state: 'DISPATCHED', by: '', vector: `answered → ${at('OWNER') || 'its room'}` };
      if (cls === 'ASKS LEDGER') return askGate(at('THE QUESTION (the row, summarised)'));
      return rowGate({ id, you: at('FROM YOU'), waits: at('WAITS ON'), cls, why: at('WHY THIS PRIORITY'), needs: ((w) => (!w || /^"?(is )?the operator'?s act"?$/i.test(w) ? at('NOW') : w))(String(at('WHAT IT NEEDS')).replace(/^the row hands an act to the operator:\s*/i, '').trim()) }); },
    entityOf: (at, r) => (dById.has(r[0]) ? `${String(dById.get(r[0]).head || '').split(/\s+·\s+/)[0]} (${dById.get(r[0]).owner || 'unowned'})` : entityOfRow(at, r, whatById)),
    unlocks: (id) => unlocks(id, tasks).length });
}
export function tasksProjected(table, tasks = []) {
  return project(table, { groupCol: 'PROJECT', drop: ['THE ROW (full text)', 'WHAT IT IS'],   // C1039b: ENTITY is WHAT IT IS, once
    gateOf: (at, r) => rowGate({ id: r[0], you: at('FROM YOU'), waits: at('WAITS ON'), cls: at('CLASS'), needs: at('NOW'), why: at('WHY (derived)') }),
    entityOf: entityOfRow, unlocks: (id) => unlocks(id, tasks).length });
}
// Now: a terminal at rest takes a message (ELIGIBLE), a closed one is SEALED; its priority is the highest of the spec rows it holds.
// C1039b (cold read 2026-10-20: "19 of 23 rows … idle"): a terminal at rest holding nothing, or a closed one, is not a row to fire;
// it leaves the list and is counted in one line at the foot.
export function nowTab(table, tPrio = new Map()) {
  const P = project(table, { drop: ['STATE'],
    gateOf: (at) => terminalGate(at('STATE'), at('TERMINAL'), String(at('SPEC ROWS') || '').split(/\s+/).filter((id) => tPrio.has(id)).sort((a, b) => tPrio.get(b) - tPrio.get(a))[0] || null),
    entityOf: (at) => `${at('TERMINAL')} · ${String(at('PROJECTS') || '—').split(' · ').slice(0, 2).join(' · ')}`,
    priorityOf: (at) => Math.max(0, ...String(at('SPEC ROWS') || '').split(/\s+/).map((id) => tPrio.get(id) || 0)),
    targetOf: () => '—' });
  const keep = P.slice(1).filter((r) => r[3] !== 'SEALED' && !/^idle\b/.test(String(r[5])));
  const idle = P.slice(1).filter((r) => /^idle\b/.test(String(r[5]))).length; const closed = P.slice(1).filter((r) => r[3] === 'SEALED').length;
  return [P[0], ...keep, [], ['', `${idle} terminal(s) at rest holding nothing · ${closed} closed session(s) — off this list`]];
}

export async function composeBook() {
  const board = await import('./board.mjs');
  const b = board.buildBoard({ place: false });
  const T = new Map(await board.allTabs(b));
  const tasksTab = projectsSheet(board.projectsRows(b), T, b.projects.map((p) => ({ name: p.name, tab: board.tabName(p) })));
  const tasks = tasksTab.filter((r) => /^C\d/.test(String(r[0] || '')));
  let poss = [];
  try { const ov = await import('./board-overview.mjs'); const P = ov.possibilities(); const h = P.findIndex((r) => r[0] === 'PRIORITY');
    poss = (h >= 0 ? P.slice(h + 1) : []).filter((r) => r && r.length >= 4 && r[0] !== '').map((r) => ({ priority: r[0], what: r[1], fromYou: r[2], source: r[3], id: (String(r[3]).match(/\b(C\d+[a-z]?\d*|D-[\w-]+)\b/) || [])[1] || r[3] })); } catch { poss = []; }
  const df = resolve(REPO, 'data/vna/board-decisions.json');
  const decisions = existsSync(df) ? board.activeDecisions(JSON.parse(readFileSync(df, 'utf8')).decisions || []) : [];
  const answers = new Map(readNd('data/vna/board-decision-answers.ndjson').map((a) => [a.id, a.answer]));
  const heads = new Map(readNd('data/vna/board-heads.ndjson').map((h) => [h.id, h]));
  // C1039b (cold read 2026-10-20: "PRIORITY reads 7 on every single row"): the Questions tab carries the one derived priority and the
  // deadline per id; Decide reads them there so it ranks inside a state.
  const Qt = T.get('Questions') || []; const qh = Qt[0] || []; const qp = qh.indexOf('PRIORITY 0–9'); const qw = qh.indexOf('WHY THIS PRIORITY');
  const ranked = new Map(Qt.slice(1).filter((r) => r && r[0]).map((r) => [r[0], { p: Number(r[qp]), target: (String(r[qw] || '').match(/deadline (\d{4}-\d\d-\d\d)/) || [])[1] }]).filter(([, v]) => Number.isFinite(v.p)));
  const rows = decideRows({ decisions, answers, tasks, possibilities: poss, heads, sealed: new Set(board.tickedRows().keys()), ranked });
  const decide = [DECIDE_HEAD, ...rows, [],
    ['', '', '', `=CONCATENATE(COUNTIF(Tasks_Priority,">=7")," tasks at priority 7+ · ",COUNTA(Tasks_Priority)," open in all · see the Tasks tab")`],
    ['', '', '', `rewritten ${new Date().toLocaleString('en-GB')} · ranked ELIGIBLE → SUSPENDED → DISPATCHED, then priority, then date · type in YOUR COMMENT; every rewrite keeps it`]];
  const { compose } = await import('./board-now.mjs');
  const { execFileSync } = await import('node:child_process');
  const bfJ = existsSync(resolve(REPO, 'data/room-bifurcations.json')) ? JSON.parse(readFileSync(resolve(REPO, 'data/room-bifurcations.json'), 'utf8')).bifurcations || [] : [];
  const specTxt = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'].map((p) => { try { return readFileSync(resolve(REPO, p), 'utf8'); } catch { return ''; } }).join('\n');
  const mailbox = mailboxTab({ mail: readNd('data/vna/board-mailbox.ndjson'), bfs: new Map(bfJ.map((b) => [b.id, b])),
    commitsSince: (id, at) => { try { return execFileSync('git', ['log', `--since=${at}`, '--fixed-strings', `--grep=${id}`, '--format=%h %s'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).filter((l) => !/^\w+ chore\(commit-page\)/.test(l)).map((l) => clip(l, 120)); } catch { return []; } },
    rowState: (id) => { const esc = id.split('').map((ch) => (/[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch)).join(''); const m = specTxt.match(new RegExp(`^\\s*- \\[([ x])\\] ${esc}\\b`, 'm')); return m ? (m[1] === 'x' ? 'ticked' : 'open') : (decisions.some((d) => d.id === id) ? 'decision — answered' : ''); },
    doneWhen: (id) => (heads.get(id) && heads.get(id).head ? heads.get(id).head.done_when : ''),
    priorityOf: (id) => (ranked.get(id) || {}).p ?? 5,
    topicOf: (id) => { const d = decisions.find((x) => x.id === id); if (d) return String(d.head || splitAsk(d.ask).q).split(/\s+·\s+/)[0]; const t = tasks.find((x) => x[0] === id); return t ? `${id} · ${clip(String(t[2]).split(/\s+—\s+/)[0], 50)}` : id; } });
  const dById = new Map(decisions.map((d) => [d.id, d])); const tPrio = new Map(tasks.map((t) => [t[0], Number(t[1]) || 0]));
  // C1037: the 2-D view (nine rooms × what each holds) off the shared Tasks rows, and the Views tab naming each tab's question and grade.
  const tasksP = tasksProjected(tasksTab, tasks); const pCol = tasksP[0].indexOf('PROJECT');
  const { roomsTab, roomsFromRecord, viewsTab } = await import('./board-views.mjs');
  const rooms = roomsTab(roomsFromRecord({ claims: b.claims || [], projects: b.projects, ownerOf: board.ownerOf,
    tasks: tasksP.slice(1).filter((r) => /^C\d/.test(String(r[0] || ''))).map((r) => ({ id: r[0], entity: r[1], state: r[3], by: r[4], vector: r[5], priority: r[6], project: r[pCol] })) }));
  const nowRows = compose();
  let cw = null; try { cw = cellWords(rowsFromRecord()); } catch { cw = null; }
  const book = [['Decide', decide], ['Mailbox', mailbox], ['Now', nowTab(nowRows, tPrio)], ['Rooms', rooms], ['Tasks', tasksP], ['Map', mapTab(T.get('Tesseract map'), cw)], ['Tiles', tilesTab(T.get('Tesseract'), cw || new Map())], ['Questions', questionsProjected(T.get('Questions'), { dById, answers, tasks })]];
  // C1039j: every Waits on: id gets its short name off its own spec line (open or ticked)
  const nameOf = (id) => { const m = specTxt.match(new RegExp(`^\\s*- \\[([ x])\\] ${id}\\b(.*)$`, 'm')); if (!m) return null;
    const n = plainCase(String(m[2]).replace(/^\s*\(guard: [^)]*\)\s*/, '').replace(/[*`]/g, '').replace(/^\(built [^)]*\)\s*/, '').split(/\s+—\s+|\.\s+|:\s+/)[0].trim());
    return { ticked: m[1] === 'x', name: n.length <= 50 ? n : n.slice(0, 50).replace(/\s+\S*$/, '') }; };
  for (const tab of book) tab[1] = nameWaits(tab[1], nameOf);
  return [...book, ['Views', viewsTab([...book.map(([n]) => n), 'Views'])]];
}

// A1 reference of a whole table: rows 1..n, columns A..last.
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export function definedNames(tabs) {
  const out = [];
  for (const [name, rows] of tabs) {
    const n = rows.filter((r) => r && r.length).length ? rows.length : 1; const w = Math.max(1, ...rows.map((r) => (r || []).length));
    out.push([name, `'${name}'!$A$1:$${colName(w - 1)}$${n}`]);
    if (name === 'Tasks') { const o = rulesOffset(rows); const pc = rows[o].indexOf('PRIORITY 0–9'); if (pc >= 0) out.push(['Tasks_Priority', `'Tasks'!$${colName(pc)}$${o + 2}:$${colName(pc)}$${n}`]); }
  }
  return out;
}

export function bookXlsx(tabs, out) {
  tabs = tabs.map(([n, r]) => [n, withRulesRow(n, r)]);   // C1057: row 1 of every tab is its rules
  const dir = join(tmpdir(), `board-book-${process.pid}-${Date.now()}`);
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  w('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  w('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  w('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs.map(([n], i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${definedNames(tabs).map(([n, ref]) => `<definedName name="${n}">${x(ref)}</definedName>`).join('')}</definedNames></workbook>`);
  w('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tabs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  w('xl/styles.xml', XLSX_STYLES);
  tabs.forEach(([name, rows], i) => w(`xl/worksheets/sheet${i + 1}.xml`, styledSheetXml(rows, { colorScale: name === 'Map' ? (rulesOffset(rows) ? 'B3:M14' : 'B2:M13') : null })));
  if (existsSync(out)) rmSync(out);
  const z = spawnSync('zip', ['-q', '-9', '-X', '-r', out, '.'], { cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  if (z.status !== 0) throw new Error('zip failed');
  return out;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// C1039d (2026-10-20: two book writes died on `TypeError: fetch failed` — connect ETIMEDOUT to Google — because only a 429/403 was
// retried): a connection that never opened is retried like a rate limit, after a shorter wait, then thrown with its cause named.
export const NET_WAIT_MS = Number(process.env.BOARD_NET_WAIT_MS) || 10e3;
export async function call(token, url, opt = {}, tries = 6) {
  let res;
  try { res = await fetch(url, { ...opt, headers: { authorization: `Bearer ${token}`, ...(opt.headers || {}) } }); }
  catch (e) { if (tries > 1) { await new Promise((r) => setTimeout(r, NET_WAIT_MS)); return call(token, url, opt, tries - 1); } throw new Error(`network: ${e.cause?.code || e.message} after 6 tries — ${url.split('?')[0]}`); }
  if ((res.status === 429 || res.status === 403) && tries > 1) { const j = await res.clone().json().catch(() => ({})); if (res.status === 429 || /quota|rate/i.test(j.error?.message || '')) { await new Promise((r) => setTimeout(r, 30e3)); return call(token, url, opt, tries - 1); } }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`${res.status} ${j.error?.message || ''}`.trim()); }
  return res;
}

export async function writeBook() {
  const { rcloneToken } = await import('./board-comments.mjs');
  const { appendCells } = await import('./board-answers.mjs');
  const board = await import('./board.mjs');
  const t = rcloneToken(); if (!t.token) return { ok: false, why: t.why };
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.book;
  if (!id) {
    const r = await (await call(t.token, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '00 · DECIDE — the one view (Decide · Now · Tasks · Questions)', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    id = r.id; j.book = id; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  // His cells first: export the live book whole (xlsx keeps every tab), carry them by (tab, id, header), ledger them.
  const live = join(tmpdir(), `book-live-${id}.xlsx`);
  writeFileSync(live, Buffer.from(await (await call(t.token, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(XLSX)}`)).arrayBuffer()));
  const liveTabs = board.readXlsx(live); rmSync(live, { force: true });
  const tabs = await composeBook(); const kept = []; const orphans = [];
  const merged = tabs.map(([name, rows]) => { const L = liveTabs[name] || []; const m = mergeFills(rows, L); for (const o of m.orphans) orphans.push(`${name}·${o.id}·${o.field}`);
    for (const c of fillsOf(L)) kept.push({ tab: name, id: c.id, field: c.field.replace(/ \(fill\)$/, ''), value: c.value }); return [name, m.rows]; });
  if (kept.length) appendCells(kept);
  // A comment whose row left the top is not dropped: it rides at the foot of its tab, named, until he clears it.
  for (const o of orphans) { const [tab, rid, field] = o.split('·'); const tabRows = merged.find(([n]) => n === tab)[1]; tabRows.push([`(was ${rid})`, '', '', `your ${field} on ${rid}, kept — the row left this view`, '', '', '', (liveTabs[tab] && fillsOf(liveTabs[tab]).find((c) => c.id === rid && c.field === field) || {}).value || '']); }
  const out = bookXlsx(merged, join(tmpdir(), `board-book-${id}.xlsx`));
  await call(t.token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'content-type': XLSX }, body: readFileSync(out) });
  rmSync(out, { force: true });
  return { ok: true, id, tabs: merged.map(([n, r]) => `${n} ${r.length}`), kept: kept.length, orphans: orphans.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.includes('--grade-views') || a.includes('--check-views')) {   // C1037
    const V = await import('./board-views.mjs'); const tabs = await composeBook();
    if (a.includes('--grade-views')) { for (const l of await V.gradeViews(tabs, a.filter((x) => !x.startsWith('--')))) console.log(l); process.exit(0); }
    const f = V.viewFindings(tabs, V.latestGrades(), Object.keys(JSON.parse(readFileSync(resolve(REPO, 'data/room-surfaces.json'), 'utf8')).rooms));
    console.log(f.length ? f.join('\n') : `✓ ${tabs.length} views declared and graded`); process.exit(f.length ? 1 : 0);
  }
  if (a.includes('--print')) { const tabs = await composeBook(); const want = a.includes('--tab') ? a[a.indexOf('--tab') + 1] : 'Decide'; for (const r of (tabs.find(([n]) => n === want) || tabs[0])[1]) console.log(r.map((c) => clip(c, 120)).join(' │ ')); console.log(definedNames(tabs).map(([n, r]) => `${n}=${r}`).join('  ')); process.exit(0); }
  const r = await writeBook();
  console.log(r.ok ? `✓ book: ${r.tabs.join(' · ')} · ${r.kept} comment(s) kept · ${r.orphans} carried to the foot · https://docs.google.com/spreadsheets/d/${r.id}/edit` : `✗ book: ${r.why}`);
  process.exit(r.ok ? 0 : 1);
}
