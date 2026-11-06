#!/usr/bin/env node
// scripts/ops/board-steer.mjs — C1221b: THE COMPILED STEER ON THE BOARD (operator 2026-10-22, verbatim: "dont forget the /tend
// integration, we want to /steer with the flowchart pipe data across with real google sheet formulas to skim off the top").
// ONE HEADER PER TAB (operator 2026-11-05, verbatim: "Obviously, there's only one set of columns per sheet. You need to have two tabs if
// you're going to do this. … we need titles and everything else to be able to understand in the beginning, and a comment row as well" ·
// "Every steer is a project. Or a sub-project that's taxonomically part of the larger graph of projects … And what commit it's related to,
// it gets you the tape"). The sheet used to stack a TOP block (rows 1–11) over the ROWS block (header row 13) on one tab. Now three tabs,
// each opening with a TITLE row and a one-sentence DESCRIPTION row above its one header:
//   Steer · Compiled (the main tab, the Asks)  one row per open compiled ask: his COMMENT (fill) second, then its project, the provenance
//          that makes it reverse-discernible to the tape (WHEN ISO · TRANSCRIPT · AGENT · TAPE ROW · STEER FILE · RUN LOG · SPEC), its
//          state, the commits that named it and their commit tape, the guard, the files. Written by the one cell-by-cell writer
//          (board-sheets-write.mjs writeSheet). Its tab keeps the sheet's name: the xlsx first write named it, and renaming a tab needs
//          the Sheets API (disabled on the rclone project) or a cell-writer redeploy — the title row says ASKS instead.
//   Top 10  ten rows skimmed LIVE by formula off the main tab, highest SCORE first. One scalar formula per cell (=INDEX(SORT(FILTER(…)))),
//          never a spilling QUERY, never IMPORTRANGE: a cross-tab reference inside this spreadsheet. Column 2 mirrors his comment.
//   Projects  one row per steer (the project is the steer txt; P-<date>-<slug>, derived from its name), its parent in the larger graph
//          (the project sheets that hold its rows, board-project.mjs holderIndex, else the ones that hold its near rows, else UNPLACED).
// The two named tabs are written compare-and-set through the same Apps Script cell writer (board-cells.mjs writeCells({ tab })), the way
// sheet-tabs.mjs writes every Rules tab. Never recreated, never trashed.
//   node scripts/ops/board-steer.mjs --print          every tab, first rows
//   node scripts/ops/board-steer.mjs --dry            every refusal the live write would run, nothing written
//   node scripts/ops/board-steer.mjs                  the live write: main tab, then Top 10, then Projects
// @guard tests/ops/c1221b-the-compiled-steer-on-the-board.test.mjs · tests/ops/steer-compiled-two-tabs.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { projectTitleOf } from '../vna/steer-compile.mjs';   // one title rule, the compile's own
import { DEFAULT_TURN_CAP as TURN_CAP } from '../vna/door-metrics.mjs';   // the runner's one recorded default (Mission tab)
import { withHoldsColumn, holdsByLabel } from '../vna/worker-holds.mjs';   // C2342: the run tab's HOLDS column — the files each row's worker holds
import { titleOf as titleOfLive } from './row-title.mjs';   // THE ONE TITLE READER (operator 2026-11-05: "never just show the steer number")

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STEER_SRC = 'data/vna/steer-compiled.json';
export const MAIN_TAB = 'Steer · Compiled';   // the sheet's first tab, named by its first (xlsx) write; = SPECS['steer-compiled'].sheet
export const TOP_TAB = 'Top 10';
export const PROJECTS_TAB = 'Projects';
// THE METAS GET THEIR OWN TABS (operator 2026-11-05, verbatim: "you never do two columns in one tab, new tab for all the relevant metas like
// rules and hats, files, etc" · "a sheet per epoch/product and tabs for runs? dated in title" · "parameters for the missions can be set for
// degrees of freedom, sensitivity etc? and saved to the sheet"). Each is one header, a title and a description above it.
export const RULES_TAB = 'Rules · per ask';   // 'Rules' is taken: sheet-tabs.mjs writes every sheet's own S/G/H Rules tab
export const HATS_TAB = 'Hats';
export const FILES_TAB = 'Files';
export const MISSION_TAB = 'Mission';
export const runTabName = (project, title) => { const d = (String(project).match(/\d{4}-\d\d-\d\d/) || ['undated'])[0]; return `Run ${d} · ${String(title || project).replace(/[\[\]*?/\\:']/g, '')}`.slice(0, 90).trim(); };
// COMMENT (fill) SECOND, the house layout the writer applies to every header block (board-sheets-write.mjs prepareComposed: G6, then a
// mirror column last). Composed in that order already, the reshape is a no-op and every Top 10 formula's column number points where it reads.
// TITLE third, the first column after his comment: G6 keeps COMMENT (fill) second on every sheet (sheet-legibility.mjs commentSecond and
// its col-B mirror), so the id is read with its title one column over — never a bare number (operator 2026-11-05).
export const ROW_HEAD = ['ID', 'COMMENT (fill)', 'TITLE', 'PROJECT', 'PROJECT TITLE', 'PARENT', 'HEAD (draft — rewrite it)', 'ASK (verbatim)', 'WHEN (ISO)', 'TRANSCRIPT', 'AGENT', 'TAPE ROW (span)', 'STEER FILE', 'STATE', 'COMMITS', 'COMMIT TAPE', 'GUARD', 'FILES',
  'ACT', 'BASIN', 'NEAR (already asked)', 'SCORE (of 6)', 'EMPTY SLOTS', 'RUN LOG', 'SPEC', 'LEAF'];
export const TOP_N = 10;
// [label, column in ROW_HEAD, 1-based] — read off ROW_HEAD by name, so a column added to the main tab never points a formula at the wrong one
export const TOP_COLS = [['ID', 'ID'], ['TITLE', 'TITLE'], ['PROJECT TITLE', 'PROJECT TITLE'], ['HEAD', 'HEAD (draft — rewrite it)'], ['SCORE', 'SCORE (of 6)'], ['ACT', 'ACT'], ['GUARD', 'GUARD'], ['WHEN', 'WHEN (ISO)']].map(([l, h]) => [l, ROW_HEAD.indexOf(h) + 1]);
export const TITLES = {
  [MAIN_TAB]: ['01 · STEER · COMPILED · ASKS', 'One row per open ask a /steer compiled (data/vna/steer-compiled.json, written by scripts/vna/steer-compile.mjs), with the project it belongs to, when and where it was said, the commits that built it and the tape behind them; type only in COMMENT (fill).'],
  [TOP_TAB]: ['01 · STEER · COMPILED · TOP 10', 'The ten open asks with the highest score, skimmed live by formula off the Steer · Compiled tab, so the next ten minutes start on the best one; comment on that tab, the comment shows here.'],
  [RULES_TAB]: ['01 · STEER · COMPILED · RULES PER ASK', 'One row per rule a compiled ask\'s brief carried, read off rule-grab when the steer compiled, or recomputed later over the same ask text and stamped so in WHY, so a worker\'s constraint traces to the line it came from; type only in COMMENT (fill).'],
  [HATS_TAB]: ['01 · STEER · COMPILED · HATS', 'One row per open ask: the hat it was read through and its coordinate, from the snowball sidecar the prompt hook wrote when the steer compiled or recomputed later at the ask\'s own walked coordinate and stamped so in HAT LINE, and the brief template it was cut to; type only in COMMENT (fill).'],
  [FILES_TAB]: ['01 · STEER · COMPILED · FILES', 'One row per file an open ask names or its basin holds, whether it is on disk and the last commit that touched it, read off git; type only in COMMENT (fill).'],
  [MISSION_TAB]: ['01 · STEER · COMPILED · MISSION', 'One row per open ask with the mission parameters a worker should run it under — set them in the (fill) columns, the defaults beside them are read off the runner, and no reader takes them back yet (named in READ BY).'],
  [PROJECTS_TAB]: ['01 · STEER · COMPILED · PROJECTS', 'One row per steer, which is a project: its asks open and ticked, when it was said, its steer file, and its parent among the project sheets (UNPLACED when no project sheet holds its rows); type only in COMMENT (fill).'],
};
const L = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// BOUNDED ranges: Excel's formula grammar has no open-ended $A$14:$L (parsed to #ERROR! on the first live write, 2026-10-22).
export const LAST_ROW = 1000;
const q = (tab) => `'${tab.replace(/'/g, "''")}'!`;
export function topFormula(k, col, { first, last = LAST_ROW, width = ROW_HEAD.length, scoreCol = ROW_HEAD.indexOf('SCORE (of 6)') + 1, tab = MAIN_TAB } = {}) {
  const t = q(tab); const rng = `${t}$A$${first}:$${L(width)}$${last}`;
  return `=IFERROR(INDEX(SORT(FILTER(${rng},${t}$A$${first}:$A$${last}<>""),${scoreCol},FALSE),${k},${col}),"")`;
}
export const SPEC_FILES = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'];
export function readSpecText(repo = REPO) { return SPEC_FILES.map((p) => { try { return readFileSync(resolve(repo, p), 'utf8'); } catch { return ''; } }).join('\n'); }
// C1301: ticked off the spec's own checkbox — the same regex liveStatus uses in board-requirements.mjs — so a row the spec has
// closed never rides on into the compiled grid (the Top 10 FILTER then sees open asks only, never a done one it must skim past).
export function isTicked(id, specTxt) { const esc = String(id).replace(/[^\w]/g, ''); const m = specTxt.match(new RegExp(`^\\s*- \\[([ x])\\] ${esc}\\b`, 'm')); return m ? m[1] === 'x' : false; }
// The project is the steer: its id is derived from the steer txt's own name, so an old record row (only `file`) reads the same id the
// compile now records (steer-compile.mjs projectIdOf); its title is the first ask of that txt, cut from the dictation's own words.
export const projectOf = (a) => a.project || (a.file ? `P-${basename(String(a.file), '.txt')}` : 'UNPLACED — no steer file on the record');
// COMMITS: every commit whose subject names the row id — the rule asks-ledger.mjs gitCommitForRow reads the tick by (\b<id>\b over
// `git log --format=%H %s -n 2000`), one log read for every row instead of one per row.
export function commitsIndex(ids, { repo = REPO, n = 2000 } = {}) {
  const out = new Map(); if (!ids.length) return out;
  let log = ''; try { log = execFileSync('git', ['log', '--format=%H\t%s', '-n', String(n)], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return out; }
  const res = ids.map((id) => [id, new RegExp(`\\b${String(id).replace(/[^\w]/g, '')}\\b`)]);
  for (const line of log.split('\n')) { const tab = line.indexOf('\t'); if (tab < 0) continue; const sha = line.slice(0, 10), subj = line.slice(tab + 1);
    for (const [id, re] of res) if (re.test(subj)) { if (!out.has(id)) out.set(id, []); out.get(id).push(sha); } }
  return out;
}
// COMMIT TAPE: where the commit's receipt lives — its published commit page (public/commit/<sha10>) or its committed panel
// (docs/pmu/commit-panels/<sha9>.png); neither on disk reads UNMEASURED.
export function commitTape(sha, exists = (p) => existsSync(resolve(REPO, p))) {
  const page = `public/commit/${sha.slice(0, 10)}`; if (exists(page)) return `/commit/${sha.slice(0, 10)}`;
  const panel = `docs/pmu/commit-panels/${sha.slice(0, 9)}.png`; if (exists(panel)) return panel;
  return `UNMEASURED — ${sha.slice(0, 10)} has no commit page or panel`;
}
// PARENT: the project sheets that hold the ask's own row (board-project.mjs holderIndex), else those that hold its near rows (said so),
// else UNPLACED — never a guess.
export function parentOf(a, holders = new Map()) {
  const own = holders.get(a.id); if (own) return own;
  const near = [...new Set((a.near || []).map((id) => holders.get(id)).filter(Boolean))];
  return near.length ? `${near.join(' · ')} (via near ${(a.near || []).filter((id) => holders.get(id)).join(' ')})` : 'UNPLACED';
}
// the project's title: the one the compile recorded, else the same rule (projectTitleOf) over the first ask of that steer on the record
export function projectTitles(asks = []) {
  const by = new Map(); for (const a of asks) { const p = projectOf(a); if (!by.has(p)) by.set(p, []); by.get(p).push(a); }
  const num = (x) => Number(String(x.id).replace(/\D/g, '')) || 0;
  return new Map([...by].map(([p, as]) => { const lead = [...as].sort((x, y) => num(x) - num(y))[0]; return [p, (as.find((a) => a.projectTitle) || {}).projectTitle || projectTitleOf(lead.ask)]; }));
}
// TAPE ROW: the pointer, or — for a row compiled since tapes were recorded (key present, null) — why there is none; an old row stays blank
export const TAPE_MISS = 'UNMEASURED — not on the tape when it compiled: the asked text is no verbatim span of the newest transcripts (a chair decomposition, or a prompt not yet written)';
// a chair decomposition inherits the span of the dictation it was split from (steer-compile.mjs parentSpanOf), said as a parent span
const tapeCell = (a) => (a.tape ? `${a.tape}${a.tapeRecomputed ? ` (found on the tape ${a.tapeRecomputed}, after compile)` : ''}`
  : a.tapeParent ? `parent span: ${a.tapeParent} (via ${show(a.tapeParentVia) || 'the parent dictation'}${a.tapeParentRecomputed ? `, recomputed ${a.tapeParentRecomputed}` : ''})`
    : a.tapeUnmeasured ? `UNMEASURED — ${a.tapeUnmeasured}` : 'tape' in a ? TAPE_MISS : '');
const show = (v) => (v == null ? '' : String(v));
const transcriptCell = (a) => (a.session || a.transcript ? [a.session ? `session ${a.session}` : '', show(a.transcript).replace(/^\/Users\/[^/]+/, '~')].filter(Boolean).join(' · ') : '');
const leavesLive = () => { try { return LEAF_INDEX.fn ? LEAF_INDEX.fn() : new Map(); } catch { return new Map(); } };
function liveCtx(asks) {
  return { commits: commitsIndex(asks.map((a) => a.id)), exists: (p) => existsSync(resolve(REPO, p)), turnCap: TURN_CAP, leaves: leavesLive() };
}
async function holdersLive() { try { return await (await import('./board-project.mjs')).holderIndex(); } catch { return new Map(); } }
const readRecord = () => { try { return JSON.parse(readFileSync(resolve(REPO, STEER_SRC), 'utf8')); } catch { return { asks: [] }; } };
const guardLive = (g) => { try { return execFileSync('git', ['cat-file', '-e', `HEAD:${g}`], { cwd: REPO, stdio: 'pipe' }), 'in HEAD'; } catch { return existsSync(resolve(REPO, g)) ? 'on disk' : 'not written'; } };

// ONE ROW OF THE ONE ASKS LAYOUT. A compiled ask (data/vna/steer-compiled.json) and a spec row (board-asks.mjs specAsk) are both an
// "ask" here: an ask that carries its own `commits` (the sha that ticked a spec row) or `ticked` says so; one that does not reads the
// commit index and is open. LEAF is the spec tree's 10-hex for the id (board-project.mjs leafIndex), the same index /project prints.
// titleOf: the one reader (row-title.mjs) — the row's model title, else the deterministic fallback over its own text; injectable for fixtures.
export const askTitle = (a, titleOf = titleOfLive) => titleOf(a.id, { text: show(a.titleText || a.ask || a.head) });   // titleText: a spec row's own line
export const askLabel = (a, titleOf = titleOfLive) => `${a.id} · ${askTitle(a, titleOf)}`;
export function askRow(a, { holders = new Map(), commits = new Map(), guardState = guardLive, exists, titles = new Map(), leaves = new Map(), titleOf = titleOfLive } = {}) {
  const shas = Array.isArray(a.commits) ? a.commits : commits.get(a.id) || [];
  return [a.id, '', askTitle(a, titleOf), projectOf(a), show(titles.get(projectOf(a)) || a.projectTitle), parentOf(a, holders), show(a.head), show(a.ask), show(a.when || a.at), transcriptCell(a), show(a.agent), tapeCell(a), show(a.file),
    `${a.ticked ? '✓ done' : '☐ open'} · guard ${a.guard ? guardState(a.guard) : 'none declared'}`, shas.join(' · ') || 'none yet', shas.filter((s) => /^[0-9a-f]{7,40}$/.test(s)).map((s) => commitTape(s, exists)).join(' · '), show(a.guard), (a.files || []).join(' · '),
    show(a.act), (a.basin || []).join(' · '), (a.near || []).join(' · '), show(a.score), (a.empty || []).join(' · ') || 'none', show(a.runLog), show(a.spec), show(a.leaf || leaves.get(a.id))];
}
// THE ONE ASKS LAYOUT (operator 2026-11-05: "find and fix all the half finished parts"; the npm /sheet skill's Asks sheet and this
// sheet's Asks tab had two layouts). TITLE · DESCRIPTION · ROW_HEAD · one askRow per ask, in the order handed in. Steer · Compiled's
// main tab and Run tabs and board-asks.mjs's Asks sheet (the one npm ships) all compose through it, so what a stranger's /sheet writes
// is what the operator sees. Guard: tests/ops/steer-compiled-two-tabs.test.mjs TT.15.
export function composeAsksTab(asks, { title, summary, desc, ctx = {}, titles = projectTitles(asks), empty = null } = {}) {
  const rows = asks.map((a) => askRow(a, { ...ctx, titles }));
  if (!rows.length && empty) rows.push([empty[0], '', ...empty.slice(1), ...ROW_HEAD.slice(empty.length + 1).map(() => '')].slice(0, ROW_HEAD.length));
  return [[title, typeof summary === 'function' ? summary(rows.length) : show(summary)], [desc], ROW_HEAD, ...rows];
}
// The main tab: TITLE · DESCRIPTION · the one header · one row per open ask. A sync composer (board-requirements.mjs calls it bare).
export function composeSteerSheet(j = readRecord(), specTxt = readSpecText(), ctx = null) {
  const c = ctx || liveCtx(j.asks || []);
  const [title, desc] = TITLES[MAIN_TAB]; const open = (j.asks || []).filter((a) => !isTicked(a.id, specTxt));
  return composeAsksTab(open, { title, desc, ctx: c, titles: projectTitles(j.asks || []), summary: `${open.length || 1} open ask(s) · built ${new Date().toISOString().slice(0, 16)}Z`,
    empty: ['STEER-00', 'UNMEASURED — no compiled steer on the record: node scripts/vna/steer-compile.mjs "<dictation>"'] });
}
// Top 10: anchored on the main tab's first data row AS THE WRITER LAYS IT OUT (prepareComposed may add a rules row above the title).
export function composeTop(mainPrepared, { mainTab = MAIN_TAB } = {}) {
  const { isHeaderRow } = TOP_DEPS; const first = mainPrepared.findIndex(isHeaderRow) + 2;
  const [title, desc] = TITLES[TOP_TAB];
  const head = ['ID', `COMMENT (on the ${mainTab} tab)`, ...TOP_COLS.map(([l]) => `TOP ${l}`)];
  const rows = []; const cc = ROW_HEAD.indexOf('COMMENT (fill)') + 1;
  for (let k = 1; k <= TOP_N; k++) rows.push([`TOP-${String(k).padStart(2, '0')}`, topFormula(k, cc, { first, tab: mainTab }), ...TOP_COLS.map(([, col]) => topFormula(k, col, { first, tab: mainTab }))]);
  return [[title, `reads ${mainTab} rows ${first}–${LAST_ROW} live`], [mainTab === MAIN_TAB ? desc : desc.replace(MAIN_TAB, mainTab)], head, ...rows];
}
export const PROJECT_HEAD = ['ID', 'COMMENT (fill)', 'PROJECT TITLE', 'PARENT', 'ASKS OPEN', 'ASKS TICKED', 'FIRST WHEN', 'LAST WHEN', 'STEER FILE', 'TRANSCRIPT', 'AGENT', 'ASKS (id · title)'];
export function composeProjects(j, specTxt, { holders = new Map(), titleOf = titleOfLive } = {}) {
  const titles = projectTitles(j.asks || []); const by = new Map();
  for (const a of j.asks || []) { const p = projectOf(a); if (!by.has(p)) by.set(p, []); by.get(p).push(a); }
  const rows = [...by].map(([p, as]) => {
    const sorted = [...as].sort((x, y) => (Number(String(x.id).replace(/\D/g, '')) - Number(String(y.id).replace(/\D/g, ''))));
    const when = as.map((a) => show(a.when || a.at)).filter(Boolean).sort(); const lead = sorted[0];
    const parents = [...new Set(as.map((a) => parentOf(a, holders)).filter((x) => x !== 'UNPLACED').map((x) => x.replace(/ \(via near .*\)$/, '')).flatMap((x) => x.split(' · ')))];
    const ticked = as.filter((a) => isTicked(a.id, specTxt)).length;
    return [p, '', show(titles.get(p)), parents.join(' · ') || 'UNPLACED', String(as.length - ticked), String(ticked), when[0] || '', when[when.length - 1] || '', show(lead.file), transcriptCell(lead), show(lead.agent), sorted.map((a) => askLabel(a, titleOf)).join(' ; ')];
  }).sort((x, y) => String(y[7]).localeCompare(String(x[7])));
  const [title, desc] = TITLES[PROJECTS_TAB];
  return [[title, `${rows.length} project(s)`], [desc], PROJECT_HEAD, ...(rows.length ? rows : [['P-00', '', 'UNMEASURED — no compiled steer on the record', ...PROJECT_HEAD.slice(3).map(() => '')]])];
}
const TOP_DEPS = { isHeaderRow: null, prepareComposed: null };
const LEAF_INDEX = { fn: null };
{ try { LEAF_INDEX.fn = (await import('./board-project.mjs')).leafIndex; } catch {} }
{ const [{ isHeaderRow }, { prepareComposed }] = await Promise.all([import('./board-layout.mjs'), import('./board-sheets-write.mjs')]); Object.assign(TOP_DEPS, { isHeaderRow, prepareComposed }); }
const openAsks = (j, specTxt) => (j.asks || []).filter((a) => !isTicked(a.id, specTxt));
// the ASK column of every meta tab: the id with its title, never the bare number or the draft head's preamble
const shortAsk = (a, titleOf = titleOfLive) => askLabel(a, titleOf);
const meta = (tab, head, rows, summary) => { const [title, desc] = TITLES[tab]; return [[title, summary], [desc], head, ...rows]; };
export const RULES_HEAD = ['ID', 'COMMENT (fill)', 'ASK', 'RULE', 'SOURCE FILE', 'WHY IT WAS PICKED'];
export function composeRules(j, specTxt) {
  const rows = []; let old = 0, re = 0;
  for (const a of openAsks(j, specTxt)) {
    if (!Array.isArray(a.rules)) { old++; rows.push([`${a.id}-R0`, '', shortAsk(a), `UNMEASURED — compiled before the rules were recorded${a.rulesUnmeasured ? ` · ${a.rulesUnmeasured}` : ' · not recomputed yet (node scripts/vna/steer-compile.mjs --backfill)'}`, '', '']); continue; }
    if (a.rulesRecomputed) re++;
    const stamp = (w) => (a.rulesRecomputed ? `recomputed ${a.rulesRecomputed}${w ? ` · ${w}` : ''}` : w);
    if (!a.rules.length) rows.push([`${a.id}-R0`, '', shortAsk(a), 'none claimed', '', stamp(show(a.rulesNote) || 'rule-grab returned no span')]);
    a.rules.forEach((r, k) => rows.push([`${a.id}-R${k + 1}`, '', shortAsk(a), show(r.title), show(r.at), stamp(show(r.why) || show(a.rulesNote))]));
  }
  return meta(RULES_TAB, RULES_HEAD, rows, `${rows.length} row(s) · ${re} ask(s) recomputed after compile · ${old} ask(s) still UNMEASURED`);
}
export const HATS_HEAD = ['ID', 'COMMENT (fill)', 'ASK', 'HAT', 'COORDINATE', 'HAT NAME', 'TEMPLATE', 'HAT LINE'];
export function composeHats(j, specTxt) {
  const rows = openAsks(j, specTxt).map((a) => (a.hat === undefined
    ? [a.id, '', shortAsk(a), `UNMEASURED — compiled before the hat was recorded${a.hatUnmeasured ? ` · ${a.hatUnmeasured}` : ' · not recomputed yet (node scripts/vna/steer-compile.mjs --backfill)'}`, '', '', show(a.template), '']
    : a.hat === null ? [a.id, '', shortAsk(a), 'none — no hat in the snowball sidecar when it compiled', '', '', show(a.template), '']
      : [a.id, '', shortAsk(a), show(a.hat.hat), show(a.hat.coord), show(a.hat.name), show(a.template), a.hat.recomputed ? `recomputed ${a.hat.recomputed} at the ask's own walked coordinate (not the compile-time sidecar) · ${show(a.hat.line)}` : show(a.hat.line)]));
  return meta(HATS_TAB, HATS_HEAD, rows, `${rows.length} ask(s)`);
}
export const FILES_HEAD = ['ID', 'COMMENT (fill)', 'ASK', 'PATH', 'FROM', 'ON DISK', 'LAST COMMIT TOUCHING IT'];
const lastCommitLive = (p) => { try { return execFileSync('git', ['log', '-1', '--format=%h %ad %s', '--date=short', '--', p], { cwd: REPO, encoding: 'utf8' }).trim().slice(0, 140) || 'none in git'; } catch { return 'UNMEASURED — git log failed'; } };
export function composeFiles(j, specTxt, { exists = (p) => existsSync(resolve(REPO, p)), lastCommit = lastCommitLive } = {}) {
  const rows = []; const memo = new Map(); const lc = (p) => { if (!memo.has(p)) memo.set(p, lastCommit(p)); return memo.get(p); };
  for (const a of openAsks(j, specTxt)) {
    const from = new Map(); for (const f of a.files || []) from.set(f, 'named in the ask'); for (const f of a.basin || []) if (!from.has(f)) from.set(f, 'its basin');
    if (!from.size) { rows.push([`${a.id}-F0`, '', shortAsk(a), 'none named, empty basin', '', '', '']); continue; }
    [...from].forEach(([f, why], k) => { const on = exists(f); rows.push([`${a.id}-F${k + 1}`, '', shortAsk(a), f, why, on ? 'yes' : 'no', on ? lc(f) : '']); });
  }
  return meta(FILES_TAB, FILES_HEAD, rows, `${rows.length} file row(s)`);
}
// MISSION — the parameters are HIS (fill) cells, never written by us; the defaults beside them are read off the runner (door-metrics.mjs
// DEFAULT_TURN_CAP is the one the record holds; the rest have no runner default and say so). READ BY names the follow-up: no door reads them yet.
export const MISSION_FILLS = ['DEGREES OF FREEDOM (fill)', 'SENSITIVITY (fill)', 'MAX TURNS (fill)', 'BUDGET $ (fill)', 'THREADS (fill)'];
export const MISSION_HEAD = ['ID', 'COMMENT (fill)', 'ASK', ...MISSION_FILLS, 'DEFAULT MAX TURNS', 'DEFAULTS FROM', 'READ BY'];
export const MISSION_READ_BY = 'nobody yet — follow-up: steer-runner.mjs reads this tab before a dispatch (DEGREES OF FREEDOM 0 / 1 / any = files beyond the basin it may touch · SENSITIVITY = the stop-and-ask threshold)';
export function composeMission(j, specTxt, { turnCap = null } = {}) {
  const rows = openAsks(j, specTxt).map((a) => [a.id, '', shortAsk(a), '', '', '', '', '', turnCap == null ? 'UNMEASURED' : String(turnCap),
    `${turnCap == null ? '' : 'max turns: scripts/vna/door-metrics.mjs DEFAULT_TURN_CAP · '}degrees of freedom, sensitivity, budget, threads: UNMEASURED — no runner default on record`, MISSION_READ_BY]);
  return meta(MISSION_TAB, MISSION_HEAD, rows, `${rows.length} ask(s)`);
}
// A RUN TAB, dated in its name: the newest steer's asks (or --run <P-id>) in the Asks layout; the main tab stays the all-time Asks.
export function composeRun(j, specTxt, project, ctx = {}) {
  const titles = projectTitles(j.asks || []); const title = titles.get(project) || project;
  const asks = (j.asks || []).filter((a) => projectOf(a) === project); const open = asks.filter((a) => !isTicked(a.id, specTxt));
  const name = runTabName(project, title);
  // C2342: the run tab gains HOLDS (live claims by row label, else the holds the runner last recorded); ctx.holdsByLabel in a fixture
  return { name, grid: withHoldsColumn(composeAsksTab(open, { title: `01 · STEER · ${name.toUpperCase()}`, summary: `${open.length} open of ${asks.length} ask(s) · ${project}`, ctx, titles,
    desc: `The open asks of one steer run, ${project}, in the Steer · Compiled layout, so this run reads on its own tab with its date in the name; type only in COMMENT (fill).`, empty: [`${project}-00`, 'every ask of this run is ticked'] }), ctx.holdsByLabel || holdsByLabel()) };
}
export const newestProject = (j) => { const a = [...(j.asks || [])].sort((x, y) => show(y.when || y.at).localeCompare(show(x.when || x.at)))[0]; return a ? projectOf(a) : null; };
// C2345 — ONE SPREADSHEET PER PRODUCT OR EPOCH: the Drive sheet to write, named off --product (board-drive.json has no
// per-product key until the operator makes that Drive file, so a missing one stays UNMEASURED at the CLI, never invented here).
export const sheetNameFor = (product, mainTab = MAIN_TAB) => (product ? `${mainTab} · ${product}` : mainTab);
// an epoch narrows the SAME all-time record to one window (--since), so the run tab it composes holds only that epoch's asks
export const sinceFilterAsks = (j, since) => (since ? { ...j, asks: (j.asks || []).filter((x) => show(x.when || x.at) >= since) } : j);
export function composeSteerTabs(j = readRecord(), specTxt = readSpecText(), ctx = null, { mainTab = MAIN_TAB, run = undefined } = {}) {
  const c = ctx || liveCtx(j.asks || []);
  const main = composeSteerSheet(j, specTxt, c);
  const out = { [MAIN_TAB]: main, [TOP_TAB]: composeTop(TOP_DEPS.prepareComposed(MAIN_TAB, main), { mainTab }), [PROJECTS_TAB]: composeProjects(j, specTxt, c),
    [RULES_TAB]: composeRules(j, specTxt), [HATS_TAB]: composeHats(j, specTxt), [FILES_TAB]: composeFiles(j, specTxt, c), [MISSION_TAB]: composeMission(j, specTxt, c) };
  const project = run === undefined ? newestProject(j) : run;
  if (project) { const r = composeRun(j, specTxt, project, c); out[r.name] = r.grid; }
  return out;
}
// board-requirements.mjs's bare call (the pass, --print) gets the live holders too
export async function composeSteerSheetLive() { const j = readRecord(); const c = { ...liveCtx(j.asks || []), holders: await holdersLive() }; return composeSteerSheet(j, readSpecText(), c); }

// A named tab, written compare-and-set: typed (fill) cells are kept by (id, header) — mergeFills, the main tab's own rule — and a typed cell
// whose row is gone refuses the write. A tab not there yet is listed off the xlsx export (the Sheets API is off), so --dry creates nothing.
export async function tabNames(token, id) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const { mkdtempSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'tabs-')), 's.xlsx'); writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  try { const x = execFileSync('unzip', ['-p', f, 'xl/workbook.xml'], { encoding: 'utf8' }); return [...x.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')); } catch { return null; }
}
export async function planTab(id, tab, grid, { exists = true } = {}) {
  const { writeCells, planGrid } = await import('./board-cells.mjs'); const { mergeFills } = await import('./board-sheets-write.mjs');
  if (!exists) return { tab, create: true, ops: [], append: grid.map((r) => r.map(show)) };
  const R = await writeCells(id, { tab, read: true }); if (R.error || R.off) return { tab, refused: true, why: R.error || R.why };
  const live = R.values || [];
  if (!live.some((r) => (r || []).some((v) => show(v).trim()))) return { tab, ops: [], append: grid.map((r) => r.map(show)) };
  const { rows, orphans } = mergeFills(grid, live);
  if (orphans.length) return { tab, refused: true, why: `${orphans.length} typed cell(s) have no row in the new tab: ${orphans.slice(0, 3).map((o) => `${o.id}·${o.field}`).join(', ')}` };
  return { tab, ...planGrid(live, rows, { formulas: R.formulas || null }) };
}

// THE EXTRA TABS ON THE REGULAR PASS (operator 2026-11-05: "find and fix all the half finished parts"). Top 10, Projects, Rules · per ask,
// Hats, Files, Mission and the dated Run tab were written only when this file ran by hand; the board pass (board-requirements.mjs
// --spec steer-compiled, looped by --pass) wrote the main tab alone. ONE function writes them and both doors call it after the main tab:
// it lists the real tab names (Top 10 reads the first tab by its real name), composes every tab off the same record, and writes each
// non-main tab compare-and-set (planTab → writeCells). deps are injectable so a guard runs it with no network.
export async function refreshSteerTabs(token, id, { dry = false, say = console.log, j = null, ctx = null, run = undefined, deps = {} } = {}) {
  const D = { tabNames, planTab, writeCells: null, holders: holdersLive, ...deps };
  if (!D.writeCells) D.writeCells = (await import('./board-cells.mjs')).writeCells;
  const rec = j || readRecord(); const c = ctx || { ...liveCtx(rec.asks || []), holders: await D.holders() };
  const names = await D.tabNames(token, id); if (!names) { say('✗ could not list the tabs (xlsx export failed) — no extra tab written'); return { bad: 1, tabs: [] }; }
  const tabs = composeSteerTabs(rec, readSpecText(), c, { mainTab: names[0] || MAIN_TAB, run });
  let bad = 0; const done = [];
  for (const tab of Object.keys(tabs).filter((x) => x !== MAIN_TAB)) {
    // the xlsx export caps a tab name at 31 chars (Excel's limit), so a long run tab is listed by its prefix; a live read of a missing tab
    // creates it empty and planTab then appends, so only --dry depends on this list
    const p = await D.planTab(id, tab, tabs[tab], { exists: dry ? names.some((n) => n === tab || (n.length >= 31 && tab.startsWith(n))) : true });
    if (p.refused) { say(`✗ ${tab}: refused — ${p.why}`); bad++; continue; }
    if (dry) { say(`· ${tab}: ${p.create ? 'would be created · ' : ''}${p.ops.length} cell(s) differ · ${p.append.length} row(s) to append (dry)`); done.push(tab); continue; }
    const w = await D.writeCells(id, { tab, ops: p.ops, append: p.append });
    if (w.error || w.off) { say(`✗ ${tab}: ${w.error || w.why}`); bad++; continue; }
    say(`✓ ${tab}: ${w.applied ?? 0} cell(s) written · ${w.appended ?? 0} row(s) appended · ${(w.conflicts || []).length} conflict(s) left as typed`); done.push(tab);
  }
  return { bad, tabs: done };
}
// the board pass's door (board-requirements.mjs SPECS['steer-compiled'].tabsFn): the same function, the record read live
export const refreshSteerTabsLive = (token, id, o = {}) => refreshSteerTabs(token, id, o);

// C2350 — WRITTEN CELL BY CELL AND OPENED IN THE BROWSER. Every tab above lands through the one cell writer
// (board-cells.mjs writeCells / board-sheets-write.mjs writeSheet, both compare-and-set); the sheet itself was
// printed as a URL and never opened, so the operator had to copy it by hand. openUrl is injectable (plan.mjs's
// own defaultOpenUrl pattern) so a guard never spawns a real browser.
export const defaultOpenUrl = (url) => execFileSync('open', [url]);
export function openSheetUrl(id, { openUrl = defaultOpenUrl, noOpen = process.env.VNA_BOARD_NO_OPEN === '1', platform = process.platform } = {}) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (noOpen) return { url, opened: false, why: 'VNA_BOARD_NO_OPEN=1' };
  if (platform !== 'darwin') return { url, opened: false, why: `no opener on ${platform}` };
  try { openUrl(url); return { url, opened: true, why: null }; } catch (e) { return { url, opened: false, why: `open failed: ${e.message}` }; }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const dry = a.includes('--dry');
  const arg = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  // ONE SPREADSHEET PER PRODUCT / EPOCH: --product <name> selects 'Steer · Compiled · <name>' in board-drive.json (default: Steer · Compiled);
  // --since <YYYY-MM-DD> keeps that epoch's asks only; --run <P-id> picks the run tab (default: the newest steer).
  const product = arg('--product'); const sheetName = sheetNameFor(product); const since = arg('--since');
  const j = sinceFilterAsks(readRecord(), since);
  const ctx = { ...liveCtx(j.asks || []), holders: await holdersLive() };
  let tabs = composeSteerTabs(j, readSpecText(), ctx, { run: arg('--run') || undefined });
  if (a.includes('--print')) { for (const [t, g] of Object.entries(tabs)) { console.log(`── ${t} (${g.length} rows)`); for (const r of g.slice(0, a.includes('--all') ? 1e9 : 5)) console.log(r.slice(0, 8).map((c) => show(c).slice(0, 60)).join(' │ ')); } process.exit(0); }
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs'); const { writeCells } = await import('./board-cells.mjs');
  const t = rcloneToken(); if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const id = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets[sheetName];
  if (!id) { console.log(`✗ ${sheetName} is not in data/vna/board-drive.json — UNMEASURED: no spreadsheet for this product yet; its first write is the operator's call (a new Drive file), then add it there`); process.exit(1); }
  const names = await tabNames(t.token, id); if (!names) { console.log('✗ could not list the tabs (xlsx export failed) — nothing written'); process.exit(1); }
  if (names[0] !== MAIN_TAB) tabs = composeSteerTabs(j, readSpecText(), ctx, { mainTab: names[0], run: arg('--run') || undefined });   // Top 10 reads the first tab by its real name
  const m = await writeSheet(t.token, id, tabs[MAIN_TAB], { name: sheetName, dry });
  console.log(m.refused ? `✗ ${names[0]}: refused — ${m.why}` : `${dry ? '·' : '✓'} ${names[0]} (the Asks): ${m.mode === 'cells' ? `${m.applied} cell(s) written · ${m.appended} appended` : `${m.newRows} rows${m.relayout ? ` · relayout: ${m.movedToComment} to comment · ${m.movedToLog} to Log` : ''}`}${dry ? ' (dry)' : ''}`);
  if (m.refused) process.exit(1);
  const { bad } = await refreshSteerTabs(t.token, id, { dry, j, ctx, run: arg('--run') || undefined, deps: { writeCells, tabNames: async () => names } });
  const o = dry || a.includes('--no-open') ? { url: `https://docs.google.com/spreadsheets/d/${id}/edit`, opened: false, why: dry ? 'dry run' : '--no-open' } : openSheetUrl(id);
  console.log(`${o.url}${o.opened ? ' (opened)' : ` (not opened — ${o.why})`}`);
  process.exit(bad ? 1 : 0);
}
