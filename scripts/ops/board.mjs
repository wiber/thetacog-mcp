#!/usr/bin/env node
// scripts/ops/board.mjs — C1020: THE THETACOG BOARD — one sheet, every session, every surface, the open questions, the reports.
// Operator 2026-10-19, verbatim: "make a google sheet with current state of all sessions as a central board for thetacog with open
// summariesed questions and the place to put reports on" · "all surfaces include - book, spec sheet for the extension, everything
// gets a project pagfe" · "we can two way read it - done right and sorted we can use it alongside the panels for steering" ·
// "fill in all the gaps implied by the repo".
//
// PUSH (default): composes the board off the record and writes out/board/thetacog-board.xlsx (gitignored; uploaded to Drive, which
// converts it into a Google Sheet). Nothing is typed by hand: the project list is the fixed surfaces plus every packages/* with a
// package.json; each project's owner room is the longest owned-glob match in data/room-surfaces.json; its version, spec sheet and
// live link come off its package.json / README; its open rows, questions, commits and live claims come off the spec trees, git and
// scripts/ops/wip.mjs. Every row carries a stable id (a row id, Q-<hash of the ask>, R-<nnn>, S-<name>) so a pull can join an answer back.
// PULL (--pull <xlsx>): reads an .xlsx exported from the sheet and appends every filled ANSWER / report / session cell to
// data/vna/board-answers.ndjson (append-only, one row per cell, with the id it answers). LLM-FREE in both directions.
//
//   node scripts/ops/board.mjs [--sessions <listagents.txt>]   push: write the xlsx + print the counts
//   node scripts/ops/board.mjs --json                          the board model as JSON (what the guard reads)
//   node scripts/ops/board.mjs --pull <exported.xlsx>          append the sheet's filled cells to the answers ledger
//   --drive                    push: after writing, upload with rclone into <remote>:ThetaCog/ as a converted Google Sheet
//   --pull-drive               pull: export that Google Sheet back to xlsx with rclone and run --pull on it (the two-way read)
//                              remote = $BOARD_REMOTE or "gdrive" (one-time: rclone config create gdrive drive scope=drive)
//   --csv <dir>                also write each tab as <dir>/<tab>.csv (Drive converts a CSV upload into a native Google Sheet,
//                              text only, so no binary passes through a connector; the Drive door reads it back as CSV the same way)
//   --calendar <events.json>   optional: a Google Calendar list_events result, read as FIXED BLOCKERS only (C1032). The Week tab
//                              (half-hour slots, 07:00–22:30, next 7 days) and the Month tab (31 days) compose without it, as a PLAN:
//                              the room theme by hour plus the open commitments off the record (scripts/ops/board-plan.mjs). Operator
//                              2026-10-19: "if I want to see the calander events use gcal, if I want to plan the week thats the spreadsheet".
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, appendFileSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { classifySpec } from '../vna/spec-clarity.mjs';
import { surfaceTabs, SURFACE_TABS } from './board-surfaces.mjs';
import { newsletterRows, NEWSLETTER_TAB, refreshSendReport } from './board-newsletter.mjs';   // C1020j
import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';
import { rankTabs, loadContext } from './board-priority.mjs';   // C1020ab
import { planFrom, planTabs, owedReplies, ledgerAsks } from './board-plan.mjs';   // C1032 — Week/Month are a plan, never a calendar copy
import { possibilities } from './board-overview.mjs';   // C1033
import { LATTICE_TAB, bandOf, latticeRows, UNMEASURED } from './board-lattice.mjs';   // C1026
import { topRows, HEAD as TOP_HEAD, rowCells as topRowCells } from './board-top.mjs';   // C1030
export const liveDecision = (d) => !d.done && d.class !== 'ROOM-WORK';   // C1034: `status` is the board's own state column

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GH = 'https://github.com/wiber/thetadrivencoach/blob/main/';
export const SPECS = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'];
export const ANSWERS = 'data/vna/board-answers.ndjson';
export const TABS = { overview: 'Overview', week: 'Week', month: 'Month', sessions: 'Sessions', top: 'TOP', questions: 'Questions', lattice: LATTICE_TAB, reports: 'Reports' };
// No row cap and no headline clip on a project tab (operator 2026-10-19, verbatim: "dont write and 282 older pages - we can fit all
// of them"). A Sheets cell holds 50,000 characters; FULL_CAP stays under it.
const FULL_CAP = 45000;
const specLines = new Map(); const fullRow = (r) => { if (!r.spec || !r.line) return ''; if (!specLines.has(r.spec)) { try { specLines.set(r.spec, readFileSync(resolve(REPO, r.spec), 'utf8').split('\n')); } catch { specLines.set(r.spec, []); } } return clip(specLines.get(r.spec)[r.line - 1] || '', FULL_CAP); };
const BLANK_REPORTS = 25;

// The fixed surfaces: the ones that are not a package. Paths are prefixes; the first is the project's home.
export const SURFACES = [
  { name: 'Book — Tesseract Physics', paths: ['books/tesseract/', 'public/book/'], spec: 'books/STATUS-AND-NEXT-STEPS.md', live: 'https://thetadriven.com/book' },
  { name: 'Steer cockpit (VNA)', paths: ['scripts/vna/', 'docs/specs/vna/', '.claude/skills/steer/'], spec: 'docs/specs/vna/SPEC-VNA-COCKPIT.md', live: '' },
  { name: 'Steer on cloud (C1018–C1019)', paths: ['docs/specs/vna/SPEC-CLOUD-STEER.md', 'docs/specs/vna/cloud-checks/', 'scripts/vna/steer-cloud-check.mjs', 'scripts/vna/latest-spec.mjs'], spec: 'docs/specs/vna/SPEC-CLOUD-STEER.md', live: '' },
  { name: 'Walker — pmu-onchip (Rust)', paths: ['.thetacog/pmu/', 'scripts/pmu/', 'src/lib/pmu/'], spec: 'docs/architecture/claude-rules/axioms-and-method.md', live: '' },
  { name: 'Website', paths: ['src/app/', 'src/components/', 'public/'], spec: 'docs/architecture/claude-rules/doors-and-surfaces.md', live: 'https://thetadriven.com' },
  { name: 'Backup + warranty pages', paths: ['src/app/backup/', 'src/lib/backup/', 'src/app/api/backup/'], spec: 'docs/specs/vna/BACKUP-POSITIONING-FORMAL-METHODS.md', live: 'https://thetadriven.com/backup' },
  { name: 'Blog', paths: ['src/content/blog/', 'scripts/blog/'], spec: 'docs/05-content/blog/mdx-cook-format.md', live: 'https://thetadriven.com/blog' },
  { name: 'Comms + book club', paths: ['docs/comms/', 'scripts/comms/', 'scripts/bookclub/'], spec: 'docs/architecture/claude-rules/voice-and-pitch.md', live: '' },
  { name: 'Outreach', paths: ['docs/outreach/', 'scripts/outreach/'], spec: 'docs/ops/email-iterations/sovereign-outreach-spec.html', live: '' },
  { name: 'Decks', paths: ['docs/decks/'], spec: '.claude/commands/deck.md', live: '' },
  { name: 'Strategy', paths: ['docs/strategy/'], spec: 'docs/strategy/', live: '' },
  { name: 'Patent + legal', paths: ['docs/legal/', 'docs/01-business/patents/'], spec: 'docs/legal/', live: '' },
];

const sh = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const ghLink = (p) => (p && existsSync(resolve(REPO, p)) ? GH + p.replace(/\/$/, '') : '');

// Every package with a package.json is a project; its version, spec sheet and live link are read off it, never typed.
export function packageProjects() {
  const out = [];
  for (const d of readdirSync(resolve(REPO, 'packages')).sort()) {
    const pj = resolve(REPO, 'packages', d, 'package.json');
    if (!existsSync(pj)) continue;
    let j = {}; try { j = JSON.parse(readFileSync(pj, 'utf8')); } catch { continue; }
    const isExt = !!(j.engines && j.engines.vscode);
    const live = isExt && j.publisher ? `https://marketplace.visualstudio.com/items?itemName=${j.publisher}.${j.name}`
      : j.private === false || (j.private === undefined && j.version && !isExt && j.publishConfig) ? `https://www.npmjs.com/package/${j.name}` : (j.homepage || '');
    const readme = existsSync(resolve(REPO, 'packages', d, 'README.md')) ? `packages/${d}/README.md` : '';
    out.push({ name: `${isExt ? 'VS Code extension' : 'Package'} — ${j.name}`, paths: [`packages/${d}/`], spec: readme, live, version: j.version || '', pkg: j.name });
  }
  return out;
}

function globToRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')); }
// Owner room: the room whose owned glob covers the project's home path, or sits inside it (voice owns books/tesseract/chapters/*.md,
// so voice owns the book), longest literal prefix first. An unowned project says so: that is a gap in data/room-surfaces.json, named.
export function ownerOf(path, rooms) {
  let best = null; let len = -1;
  for (const [room, v] of Object.entries(rooms)) for (const g of v.owned || []) {
    const lit = g.split('*')[0];
    if ((path.startsWith(lit) || lit.startsWith(path) || globToRe(g).test(path)) && lit.length > len) { best = `${v.emoji || ''} ${room}`.trim(); len = lit.length; }
  }
  return best || `unowned — no room in data/room-surfaces.json owns ${path}`;
}

export function liveClaims() {
  const out = [];
  for (const l of sh(process.execPath, ['scripts/ops/wip.mjs', 'list']).split('\n')) {
    const m = l.match(/^✋ LIVE\s+(\S+) — (\S+) \(pid (\d+), ([^)]+)\) — (.*)$/);
    if (m) out.push({ path: m[1], session: m[2], pid: m[3], at: m[4], note: m[5] });
  }
  return out;
}

// A headline with fewer than 12 letters ("," · "Then" · "PARKED UNTIL") is a pointer, not a summary: the row's own text, past its
// id and guard, is read off the spec line instead, so a reader sees what the row says.
const letters = (t) => (String(t || '').match(/[A-Za-z]/g) || []).length;
export function rowText(line) {
  return String(line || '').replace(/^\s*- \[[ x]\] C\d+[a-z]?\d*\s*/, '').replace(/^\(guard: [^)]*\)\s*/, '').replace(/[*`]/g, '');
}
export function specRows() {
  const rows = [];
  for (const s of SPECS) {
    if (!existsSync(resolve(REPO, s))) continue;
    const md = readFileSync(resolve(REPO, s), 'utf8'); const lines = md.split('\n');
    const r = classifySpec(md);
    for (const row of r.rows) rows.push({ ...row, spec: s, headline: letters(row.headline) >= 12 && !/^PARKED UNTIL( C\d+ names a)?$/.test(row.headline.trim()) ? row.headline : rowText(lines[row.line - 1]) || row.headline });
  }
  return rows;
}

// C1020r — A CHANGED DECISION IS NEVER EDITED IN PLACE: a reversal is a new entry (its own id) carrying `reverses: <id>` of
// the one it supersedes. The old entry stays on the record forever (AXIOM 1 — evict or retain, never free); the board shows
// only the live end of the chain. activeDecisions drops any id another entry names in `reverses`; reversalChain walks the
// chain forward from the oldest entry, for provenance.
export function activeDecisions(decisions) {
  const reversed = new Set(decisions.filter((d) => d.reverses).map((d) => d.reverses));
  return decisions.filter((d) => !reversed.has(d.id) && liveDecision(d));   // C1034: a done or sent-back decision is not his
}
export function reversalChain(decisions, id) {
  const chain = []; let cur = decisions.find((d) => d.id === id);
  while (cur) { chain.push(cur); cur = decisions.find((d) => d.reverses === cur.id); }
  return chain;
}

export function ledgerQuestions() {
  const dir = resolve(REPO, 'docs/specs/vna/asks');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((n) => n.endsWith('.txt')).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 5);
  const out = [];
  for (const { n } of files) {
    const txt = readFileSync(join(dir, n), 'utf8');
    const sec = (txt.split(/═══ QUESTIONS THAT NEED YOUR ANSWER[^\n]*\n/)[1] || '').split(/\n═══ /)[0];
    for (const l of sec.split('\n').map((x) => x.trim()).filter((x) => x && x !== '(none)')) { const text = l.replace(/^[•\-\d.Q]+\s*/, ''); const id = `Q-${createHash('sha1').update(text).digest('hex').slice(0, 8)}`; if (!out.some((q) => q.id === id)) out.push({ id, text, source: `docs/specs/vna/asks/${n}` }); }
  }
  return out;
}

const projectOf = (paths, projects) => {
  let best = null; let len = -1;
  for (const p of projects) for (const pre of p.paths) for (const x of paths || []) if (x.startsWith(pre) && pre.length > len) { best = p; len = pre.length; }
  return best;
};

export function sessionsFrom(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const m = l.match(/^\s{2}(.+?) \[([0-9a-f]{6})\]\s+·\s+([^·]+?)\s+·\s+(\w+)(?:\s+·\s+(.+))?$/);
    if (m) out.push({ id: `S-${m[2]}`, name: m[1], kind: m[3].trim(), status: m[4], started: (m[5] || '').trim() });
  }
  return out;
}

// THE CALENDAR: events in, local wall-clock slots out, in the calendar's own time zone (never this machine's).
export function calendarFrom(json) {
  if (!json) return null;
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const tz = j.timeZone || 'UTC';
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  const local = (iso, allDay) => { if (allDay) return { day: iso, min: 0 }; const q = parts(new Date(iso)); return { day: `${q.year}-${q.month}-${q.day}`, min: Number(q.hour) * 60 + Number(q.minute) }; };
  const events = (j.events || []).filter((e) => e.status !== 'cancelled').map((e) => {
    const allDay = !e.start?.dateTime; const a = local(e.start?.dateTime || e.start?.date, allDay); const b = local(e.end?.dateTime || e.end?.date, allDay);
    return { title: e.summary || '(no title)', day: a.day, start: a.min, end: allDay ? 24 * 60 : (b.day === a.day ? b.min : 24 * 60), allDay };
  });
  const today = parts(new Date()); const t0 = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day));
  const days = Array.from({ length: 31 }, (_, i) => { const d = new Date(t0 + i * 864e5); return { day: d.toISOString().slice(0, 10), wd: d.toUTCString().slice(0, 3) }; });
  return { tz, events, days };
}
export function themeAt(min, schedule) {
  for (const r of schedule) { const [a, b] = r.hours.split('-').map((h) => { const [H, M] = h.split(':').map(Number); return H * 60 + M; }); if (min >= a && min < (b === 0 ? 1440 : b)) return `${r.room} · ${r.ns}`; }
  return '';
}
export function scheduleTz() {
  const f = resolve(REPO, 'openclaw/data/thematic-schedule.json');
  try { return JSON.parse(readFileSync(f, 'utf8')).metadata?.timezone || 'America/Los_Angeles'; } catch { return 'America/Los_Angeles'; }
}
export function themeSchedule() {
  const f = resolve(REPO, 'openclaw/data/thematic-schedule.json');
  if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, 'utf8')); const out = [];
  for (const v of Object.values(j.metadata?.categories || {})) for (const [room, x] of Object.entries(v.rooms || {})) out.push({ room, ns: x.namespace, hours: x.hours });
  return out;
}

// C1020f — EVERY QUESTION ROW CARRIES ITS WALK COORDINATE AND THAT TILE'S SEMANTIC DUMP. Operator 2026-10-19 (relayed by wo1),
// verbatim: "Use the tesseract semantic dump to bridge to the spreadsheet". The coordinate comes off the one Rust walk (walk-door
// lensWalk, the same door the turn lens uses), never a regex of the row's nouns; the cell beside it is the snippet of the 144-tile
// library at that coordinate (data/pmu/snippet-library-144.json, the dump tile-dump-inspect.mjs reads). A refused walk prints
// UNMEASURED with the walk's own reason. Board walks go to a gitignored tape of their own, so they never braid into the turn/commit
// series. Port row: C1020f rides the Rust walk already; the board itself is transport (CLAUDE.md MAXIMISE RUST: what stays node).
export const TILE_LIB = 'data/pmu/snippet-library-144.json';
export const BOARD_WALK_TAPE = 'out/board/board-walks.ndjson';
const firstSentence = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0];
export function tileSnippets(lib = resolve(REPO, TILE_LIB)) {
  if (!existsSync(lib)) return {};
  let raw = JSON.parse(readFileSync(lib, 'utf8')); if (!Array.isArray(raw)) raw = raw.anchors || raw.nodes || [];
  return Object.fromEntries(raw.filter((a) => a && a.coord).map((a) => [a.coord, firstSentence(a.snippet || a.seed || '')]));
}
export function placeItems(items, { walk = lensWalk, tape = resolve(REPO, BOARD_WALK_TAPE), tiles = tileSnippets() } = {}) {
  mkdirSync(dirname(tape), { recursive: true });
  for (const it of items) {
    let r = null; let err = null;
    try { const w = walk(it.text, { source: 'board-row', ref: it.id, tape }); r = w.result; err = (w.row && w.row.err) || null; } catch (e) { err = String(e && e.message || e).slice(0, 80); }
    it.coord = r && r.pixel ? String(r.pixel) : null;
    it.tile = it.coord ? (tiles[it.coord] ? clip(tiles[it.coord], 200) : `UNMEASURED — no tile at ${it.coord} in ${TILE_LIB}`) : '';
    it.walkErr = it.coord ? null : (err || 'no pixel');
    it.band = it.coord ? (bandOf(r) || UNMEASURED) : null;   // C1026: the lattice's band, read off this same walk — never a second walk, never a sigma cutoff
  }
  return items;
}
export const QUESTION_HEAD = ['ID', 'CLASS', 'PROJECT', 'OWNER', 'THE QUESTION (the row, summarised)', 'WHAT IT NEEDS', 'GUARD', 'WHERE', 'COORDINATE (the walk)', 'TILE AT THAT COORDINATE', 'STATUS', 'RECEIPT', 'ANSWER (fill)', 'BY (fill)', 'YOUR EDIT OF THE QUESTION (fill)', 'GRADE 0–9 (fill)', 'COMMENT (fill)'];
const coordCell = (x) => (x.coord ? x.coord : x.walkErr ? `UNMEASURED — ${clip(x.walkErr, 80)}` : 'not placed on this run (board.mjs places on push)');

// C1020g — WHEN A ROOM CLOSES A ROW, ITS STATUS AND RECEIPT CELLS SAY SO. Operator 2026-10-19 (relayed by wo1): "so he never asks
// for status". Until cell writes exist (C1020a) the next upload carries the state: one git pass over the spec trees finds the commit
// that ticked each row, and a row the board has carried (a decision, or an id an answer was pulled for) stays on the Questions tab
// once ticked, with STATUS TICKED and the ticking sha as its RECEIPT. A decision answered off a spec reads ANSWERED with its owner.
export function tickReceipts({ specs = SPECS, since = '30.days', log = null } = {}) {
  const out = log ?? sh('git', ['log', `--since=${since}`, '--format=COMMIT\t%h\t%ad', '--date=short', '-U0', '-p', '--', ...specs]);
  const m = new Map(); let cur = null;
  for (const l of out.split('\n')) {
    if (l.startsWith('COMMIT\t')) { const [, h, d] = l.split('\t'); cur = { sha: h, date: d }; continue; }
    const t = cur && l.match(/^\+\s*- \[x\] (C\d+[a-z]?\d*)\b/);
    if (t && !m.has(t[1])) m.set(t[1], cur);   // git log is newest first: the first sighting is the latest tick
  }
  return m;
}
// classifySpec drops ticked rows, so a closed row is read off its own '- [x]' line (id, headline, where).
export function tickedRows() {
  const out = new Map();
  for (const s of SPECS) {
    if (!existsSync(resolve(REPO, s))) continue;
    readFileSync(resolve(REPO, s), 'utf8').split('\n').forEach((l, i) => { const m = l.match(/^\s*- \[x\] (C\d+[a-z]?\d*)\b/); if (m && !out.has(m[1])) out.set(m[1], { id: m[1], headline: rowText(l), guard: (l.match(/\(guard: `?([^`)]*)/) || [])[1] || '', spec: s, line: i + 1 }); });
  }
  return out;
}
const readNdIf = (p) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// C1025 — A TICKED ROW'S STATUS/RECEIPT READS FROM THE VERIFY LEDGER, NEVER A WORKER'S CLAIM. `steer.mjs verify` is the only
// door that appends a `verified:true` row to .thetacog/verify-stamps.ndjson for a label, after it re-ran the guard itself and
// `spec-check.mjs toggle` ticked the spec (steer-follow-through.mjs's stampVerify). A row whose checkbox is `[x]` with no such
// stamp (a hand-ticked box, or a tick from before this ledger existed) reads TICKED — UNVERIFIED, so it is never shown as a
// steer.mjs-confirmed close when it is not one. RECEIPT carries the sha the row's own guard, so the cell names what closed it.
export const VERIFY_STAMPS_PATH = '.thetacog/verify-stamps.ndjson';
export function verifiedTicks({ path = VERIFY_STAMPS_PATH } = {}) {
  const m = new Map();
  for (const r of readNdIf(path)) if (r && r.label && r.verified === true) m.set(r.label, r);
  return m;
}
export function stampFor(id, cls, { ticked, receipts, answered, verified }) {
  const t = receipts.get(id); const row = ticked.get(id);
  if (ticked.has(id)) {
    const base = t ? `${t.sha} ${t.date}` : 'ticked — the ticking commit is older than 30 days';
    const receipt = row && row.guard ? `${base} · ${row.guard}` : base;
    return verified.has(id) ? { status: 'TICKED', receipt } : { status: 'TICKED — UNVERIFIED (no verify-ledger stamp)', receipt };
  }
  const a = answered.get(id); if (a) return { status: `ANSWERED ${String(a.at || '').slice(0, 10)} — for ${a.owner}`, receipt: '' };
  return { status: cls === 'DECISION' ? 'OPEN — your answer' : `OPEN — ${cls}`, receipt: '' };
}

export function buildBoard({ sessionsText = '', calendarJson = null, owed = null, owedNote = null, now = new Date(), place = false, walk = lensWalk, receiptLog = null, carriedIds = null } = {}) {
  const rooms = JSON.parse(readFileSync(resolve(REPO, 'data/room-surfaces.json'), 'utf8')).rooms;
  const projects = [...SURFACES, ...packageProjects()].map((p) => ({ ...p, owner: ownerOf(p.paths[0], rooms) }));
  const rows = specRows();
  const open = rows.filter((r) => r.class !== 'TICKED');
  const claims = liveClaims();
  const head = sh('git', ['rev-parse', '--short=10', 'HEAD']).trim();
  for (const p of projects) {
    p.rows = open.filter((r) => projectOf(r.paths, projects) === p);
    p.claims = claims.filter((c) => p.paths.some((pre) => c.path.startsWith(pre)));
    p.commits = sh('git', ['log', '-8', '--since=21.days', '--format=%h\t%ad\t%s', '--date=short', '--', ...p.paths]).split('\n').filter(Boolean).map((l) => l.split('\t'));
    p.last = p.commits[0] ? `${p.commits[0][1]} ${p.commits[0][0]}` : '';
  }
  const rank = { 'YOUR-ACT': 0, 'NEEDS-OPERATOR': 1 };
  const num = (id) => Number((id.match(/\d+/) || [0])[0]);
  const questions = open.filter((r) => r.class in rank).map((r) => ({ id: r.id, class: r.class, project: (projectOf(r.paths, projects) || {}).name || '', owner: (projectOf(r.paths, projects) || {}).owner || '', question: clip(r.headline, 170), missing: clip((r.missing || []).join(' · '), 140), guard: r.guard || '', where: `${r.spec}:${r.line}` }))
    .sort((a, b) => rank[a.class] - rank[b.class] || num(b.id) - num(a.id));
  const lq = ledgerQuestions();
  const repDir = (d, k) => (existsSync(resolve(REPO, d)) ? readdirSync(resolve(REPO, d)).filter((n) => /\.(txt|md|html)$/.test(n)).map((n) => ({ kind: k, path: `${d}/${n}`, date: (n.match(/\d{4}-\d{2}-\d{2}/) || [''])[0] })) : []);
  const reports = [...repDir('docs/specs/vna/cloud-checks', 'cloud check'), ...repDir('docs/specs/vna/asks', 'asks ledger')]
    .sort((a, b) => b.date.localeCompare(a.date) || b.path.localeCompare(a.path)).slice(0, 30).map((r, i) => ({ id: `R-${String(i + 1).padStart(3, '0')}`, ...r }));
  // The operator's open decisions (data/vna/board-decisions.json, hand-maintained) sit above every spec question.
  const df = resolve(REPO, 'data/vna/board-decisions.json');
  const decisions = activeDecisions(existsSync(df) ? (JSON.parse(readFileSync(df, 'utf8')).decisions || []) : []);
  // C1020g: status + receipt for every row the board carries.
  const receipts = tickReceipts({ log: receiptLog });
  const ticked = tickedRows();
  const answered = new Map(readNdIf('data/vna/board-decision-answers.ndjson').map((a) => [a.id, a]));
  const verified = verifiedTicks();   // C1025: TICKED reads from the verify ledger, never a worker's claim
  const stamp = (id, cls) => stampFor(id, cls, { ticked, receipts, answered, verified });
  for (const d of decisions) Object.assign(d, stamp(d.id, d.class));
  for (const q of questions) Object.assign(q, stamp(q.id, q.class));
  const carried = carriedIds ? new Set(carriedIds) : new Set([...readNdIf('data/vna/board-answers.ndjson'), ...readNdIf('data/vna/board-answers-consumed.ndjson')].map((c) => c.id));
  const closed = [...carried].filter((id) => ticked.has(id) && !decisions.some((d) => d.id === id)).map((id) => ticked.get(id))
    .map((r) => ({ id: r.id, class: 'CLOSED', project: '', owner: '', question: clip(r.headline, 170), guard: r.guard, where: `${r.spec}:${r.line}`, ...stamp(r.id, 'TICKED') }));
  // C1020f: the walk coordinate + tile, on push only (the guard and --json stay walk-free unless asked).
  if (place) placeItems([...decisions.map((d) => Object.assign(d, { text: d.ask })), ...questions.map((q) => Object.assign(q, { text: q.question })), ...lq.map((q) => Object.assign(q, { text: q.text })), ...closed.map((c) => Object.assign(c, { text: c.question }))], { walk });
  return { at: new Date().toISOString(), now, head, decisions, closed, calendar: calendarFrom(calendarJson), themes: themeSchedule(), owed: owed || [], owedNote: owed ? owedNote : (owedNote || 'owed replies not read this run (buildBoard was not handed them)'), projects, questions, ledgerQuestions: lq, reports, sessions: sessionsFrom(sessionsText), claims, counts: { projects: projects.length, open: open.length, questions: questions.length, waitingOnChildren: open.filter((r) => r.class === 'WAITING-ON-CHILDREN').length, yourAct: questions.filter((q) => q.class === 'YOUR-ACT').length, needsOperator: questions.filter((q) => q.class === 'NEEDS-OPERATOR').length, claims: claims.length } };
}

// ── the tabs, as 2D arrays (row 0 of a table is its header) ──
export function tabs(b) {
  const T = [];
  T.push([TABS.overview, [
    ...possibilities(),   // C1033: the Overview opens on this week's possibilities, each with its source; the counts sit below
    [],
    ['THETACOG BOARD', `generated ${b.at.slice(0, 16)}Z at ${b.head} by node scripts/ops/board.mjs — regenerate, never hand-edit the derived columns`],
    [],
    ['HOW TO USE IT (two-way)', ''],
    ['Answer a question', 'Questions tab → type in ANSWER (and your name in BY). Pulled back with node scripts/ops/board.mjs --pull <exported.xlsx>'],
    ['File a report', 'Reports tab → a blank R- row: date, session, project, title, path or link, one-line summary'],
    ['Say what a session is on', 'Sessions tab → WORKING ON and REPORT LINK'],
    ['Where answers land', `${ANSWERS} (append-only, one row per filled cell, with the id it answers)`],
    ['Grade anything', 'GRADE 0–9 + COMMENT on Questions, Rooms, People, Business Plan, Rules, Hats, Testers, Blog, Pages — a grade under 5 with a comment becomes a correction to that rule, hat or page'],
    ...driveLinks(),
    [],
    ['COUNTS', ''],
    ['Projects', b.counts.projects], ['Open spec rows', b.counts.open], ['Questions for you', b.counts.questions], ['… your acts', b.counts.yourAct], ['… needs your answer', b.counts.needsOperator], ['Waiting on child rows (not asked)', b.counts.waitingOnChildren], ['Live WIP claims', b.counts.claims], ['Sessions listed', b.sessions.length],
    [],
    ['PROJECTS', 'owner room · version · open rows · questions · last commit · tab'],
    ...b.projects.map((p) => [p.name, [p.owner, p.version || '—', `${p.rows.length} open`, `${p.rows.filter((r) => r.class !== 'CLEAR').length} for you`, p.last || 'no commit in 21 days', tabName(p)].join(' · ')]),
  ]]);
  // C1032: the Week and Month tabs are a PLAN composed off the record; the calendar only blocks a slot, never names it.
  const P = planFrom({ ...b, ledgerAsks: b.ledgerAsks ?? ledgerAsks() }, { owed: b.owed, calendar: b.calendar, schedule: b.themes, tz: scheduleTz(), now: b.now, notes: b.owedNote ? [b.owedNote] : [] });
  const W = planTabs(P, b.themes, themeAt);
  T.push([TABS.week, W.week]);
  T.push([TABS.month, W.month]);
  T.push([TABS.sessions, [
    ['ID', 'SESSION', 'KIND', 'STATUS', 'STARTED', 'WORKING ON (fill)', 'REPORT LINK (fill)'],
    ...b.sessions.map((s) => [s.id, s.name, s.kind, s.status, s.started, '', '']),
    [],
    ['LIVE CLAIMS — local sessions holding paths (scripts/ops/wip.mjs)', '', '', '', '', '', ''],
    ['SESSION ID', 'PID', 'PATHS HELD', 'LATEST NOTE', 'LATEST AT', '', ''],
    ...Object.values(b.claims.reduce((m, c) => { const k = c.session; (m[k] ||= { s: k, pid: c.pid, n: 0, note: '', at: '' }); m[k].n++; if (c.at > m[k].at) { m[k].at = c.at; m[k].note = c.note; } return m; }, {}))
      .sort((x, y) => y.at.localeCompare(x.at)).map((x) => [x.s, x.pid, x.n, clip(x.note, 90), x.at.slice(0, 16), '', '']),
  ]]);
  // C1030: the TOP tab holds only decision-ready rows (options, a recommendation, an evidence link that resolves) — pre-ranked,
  // pre-capped at 10, never his to sort. A row missing any of these is never shown here; it stays on the Questions tab for its
  // room to find the gap.
  const topList = topRows({ decisions: b.decisions.filter(liveDecision) });
  T.push([TABS.top, [[...TOP_HEAD], ...topList.top.map(topRowCells)]]);
  T.push([TABS.questions, [
    [...QUESTION_HEAD],
    // C1034: the cell he reads is the decision's head (a topic, then the fork or one value); the context sits beside it. A decision
    // that is DONE, or sent back to its room, is not his and does not surface.
    ...b.decisions.filter(liveDecision).map((d) => [d.id, d.class, '', d.owner, d.head || clip(d.ask, 500), d.context || 'your answer, typed here', '', 'data/vna/board-decisions.json', coordCell(d), d.tile || '', d.status || '', d.receipt || '', '', '', '', '', '']),
    ...b.questions.filter((q) => !b.decisions.some((d) => d.id === q.id)).map((q) => [q.id, q.class, q.project, q.owner, q.question, q.missing, q.guard, q.where, coordCell(q), q.tile || '', q.status || '', q.receipt || '', '', '', '', '', '']),
    ...b.ledgerQuestions.map((q) => [q.id, 'ASKS LEDGER', '', '', clip(q.text, 170), '', '', q.source, coordCell(q), q.tile || '', 'OPEN — asks ledger', '', '', '', '', '', '']),
    ...(b.closed || []).map((c) => [c.id, c.class, c.project, c.owner, c.question, '', c.guard, c.where, coordCell(c), c.tile || '', c.status, c.receipt, '', '', '', '', '']),
  ]]);
  // C1026: the lattice reads the SAME rows the Questions tab just listed — the board's own rows, nothing re-walked.
  const latticeItems = [...b.decisions.filter(liveDecision), ...b.questions.filter((q) => !b.decisions.some((d) => d.id === q.id)), ...b.ledgerQuestions, ...(b.closed || [])];
  T.push([LATTICE_TAB, latticeRows(latticeItems)]);
  T.push([TABS.reports, [
    ['ID', 'DATE', 'SESSION (fill)', 'PROJECT (fill)', 'REPORT', 'PATH', 'LINK', 'SUMMARY (fill)', 'STATUS (fill)'],
    ...b.reports.map((r) => [r.id, r.date, '', '', r.kind, r.path, GH + r.path, '', '']),
    ...Array.from({ length: BLANK_REPORTS }, (_, i) => [`R-${String(b.reports.length + i + 1).padStart(3, '0')}`, '', '', '', '', '', '', '', '']),
  ]]);
  for (const p of b.projects) T.push([tabName(p), [
    [p.name, ''],
    ['Owner room', p.owner || '—'], ['Version', p.version || '—'], ['Spec sheet', ghLink(p.spec) || p.spec || '—'], ['Live', p.live || '—'],
    ['Home', p.paths.join(' · ')], ['Last commit', p.last || 'no commit in 21 days'], ['Open rows', p.rows.length], ['Live claims', p.claims.length],
    [],
    ['OPEN ROWS', 'CLASS', 'HEADLINE', 'GUARD', 'NOTE (fill)', 'THE ROW (full text)', 'WHERE'],
    ...p.rows.map((r) => [r.id, r.class, clip(r.headline, FULL_CAP), r.guard || '', '', fullRow(r), r.line ? `${r.spec}:${r.line}` : r.spec || '']),
    [],
    ['RECENT COMMITS', 'DATE', 'SUBJECT', '', ''],
    ...p.commits.map(([h, d, s]) => [h, d, clip(s, FULL_CAP), '', '']),
    [],
    ['LIVE CLAIMS', 'SESSION', 'NOTE', 'AT', ''],
    ...p.claims.map((c) => [c.path, c.session.slice(0, 8), clip(c.note, 90), c.at.slice(0, 16), '']),
  ]]);
  return T;
}

// The live Google Sheets, linked from the Overview (ids from data/vna/board-drive.json — written when a sheet is created).
export function driveLinks() {
  const f = resolve(REPO, 'data/vna/board-drive.json');
  if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, 'utf8'));
  // C1041c: the one-view book (Decide · Mailbox · Now …) heads the list; it lives under `book`, not `sheets`, and was never linked.
  const book = j.book ? [['Decide book (Decide · Mailbox · Now · Rooms · Tasks)', `=HYPERLINK("https://docs.google.com/spreadsheets/d/${j.book}/edit","open Decide book")`]] : [];
  return [[], ['THE SHEETS', ''], ...book, ...Object.entries(j.sheets || {}).map(([n, id]) => [n, `=HYPERLINK("https://docs.google.com/spreadsheets/d/${id}/edit","open ${n}")`])];
}
export const ALL_TAB_NAMES = () => [...Object.values(TABS), ...Object.values(SURFACE_TABS), NEWSLETTER_TAB, 'Projects'];
// C1020ab/C1020aa: every list on every tab ranked PRIORITY 0–9 (derived, his GRADE overrides) and every spec row given its plain head.
export async function allTabs(b, { newsletter = newsletterRows, rank = true, ctx = null } = {}) {
  const T = [...tabs(b), ...(await surfaceTabs(b)), [NEWSLETTER_TAB, newsletter()]];
  return rank ? rankTabs(T, ctx || loadContext({ claims: b.claims })).tabs : T;
}

export function tabName(p) {
  return p.name.replace(/^(VS Code extension|Package) — /, (m, k) => (k === 'Package' ? 'pkg ' : 'ext ')).replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
}

// ── a minimal xlsx writer (inline strings, a bold header style), zipped with the system zip ──
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${(r || []).map((v, ci) => (v === '' || v === null || v === undefined ? '' : typeof v === 'number'
    ? `<c r="${col(ci)}${ri + 1}"${ri === 0 ? ' s="1"' : ''}><v>${v}</v></c>`
    : `<c r="${col(ci)}${ri + 1}" t="inlineStr"${ri === 0 || (r.length > 1 && /^[A-Z][A-Z ()—/-]+$/.test(String(r[0])) && ci === 0) ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="4" width="18" customWidth="1"/><col min="5" max="5" width="70" customWidth="1"/><col min="6" max="10" width="30" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`;
}
const csvCell = (v) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const toCsv = (rows) => rows.map((r) => (r || []).map(csvCell).join(',')).join('\n') + '\n';
// One sheet that lists every project page's header fields, so the project pages fit in a single CSV upload.
export function projectsRows(b) {
  return [['PROJECT', 'OWNER ROOM', 'VERSION', 'OPEN ROWS', 'FOR YOU', 'LIVE CLAIMS', 'LAST COMMIT', 'SPEC SHEET', 'LIVE', 'HOME', 'PRIORITY (fill)', 'NOTE (fill)'],
    ...b.projects.map((p) => [p.name, p.owner, p.version || '', p.rows.length, p.rows.filter((r) => r.class !== 'CLEAR').length, p.claims.length, p.last || '', ghLink(p.spec) || p.spec || '', p.live || '', p.paths.join(' · '), '', ''])];
}
export function writeCsvs(T, b, dir) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [n, rows] of [...T.filter(([n]) => [...Object.values(TABS), ...Object.values(SURFACE_TABS), NEWSLETTER_TAB].includes(n)), ['Projects', projectsRows(b)]]) { const f = join(dir, `${n}.csv`); writeFileSync(f, toCsv(rows)); files.push(f); }
  return files;
}
export function writeXlsx(T, out) {
  const dir = join(tmpdir(), `board-${process.pid}-${Date.now()}`);
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  w('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${T.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  w('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  w('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${T.map(([n], i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  w('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${T.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${T.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  w('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
  T.forEach(([, rows], i) => w(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows)));
  mkdirSync(dirname(out), { recursive: true });
  if (existsSync(out)) rmSync(out);
  const z = spawnSync('zip', ['-q', '-9', '-X', '-r', out, '.'], { cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  if (z.status !== 0) throw new Error('zip failed — the board needs /usr/bin/zip');
  return out;
}

// ── PULL: read the exported sheet back (shared strings or inline), append every filled fill-column cell to the ledger ──
export function readXlsx(file) {
  const un = (p) => { const r = spawnSync('unzip', ['-p', file, p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? r.stdout : ''; };
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...un('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const wb = un('xl/workbook.xml'); const rels = un('xl/_rels/workbook.xml.rels');
  const out = {};
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = (rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`)) || [])[1];
    if (!target) continue;
    const xml = un(`xl/${target.replace(/^\/?xl\//, '')}`);
    const rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ci = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const t = (c[2].match(/t="(\w+)"/) || [])[1]; const inner = c[3] || '';
        const v = t === 's' ? shared[Number((inner.match(/<v>([^<]*)<\/v>/) || [])[1])] : t === 'inlineStr' ? dec([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')) : dec((inner.match(/<v>([^<]*)<\/v>/) || [, ''])[1]);
        row[ci] = v ?? '';
      }
      rows.push(row);
    }
    out[dec(m[1])] = rows;
  }
  return out;
}
export function filledCells(book) {
  const cells = [];
  for (const [tab, rows] of Object.entries(book)) {
    const hi = rows.findIndex((r) => (r || []).some((v) => /\(fill\)$/.test(String(v || ''))));
    if (hi < 0) continue;
    const header = rows[hi];
    for (const r of rows.slice(hi + 1)) {
      if (!r || !r[0]) continue;
      header.forEach((h, ci) => { if (/\(fill\)$/.test(String(h || '')) && String(r[ci] ?? '').trim()) cells.push({ tab, id: String(r[0]), field: String(h).replace(/ \(fill\)$/, ''), value: String(r[ci]).trim() }); });
    }
  }
  return cells;
}

export const REMOTE = process.env.BOARD_REMOTE || 'gdrive';
export const DRIVE_PATH = 'ThetaCog/ThetaCog Board';
function rclone(args) {
  const r = spawnSync('rclone', args, { encoding: 'utf8' });
  if (r.error) return { ok: false, why: 'rclone is not installed (brew install rclone)' };
  if (r.status !== 0) return { ok: false, why: (r.stderr || '').trim().split('\n').pop() || `rclone exit ${r.status}` };
  return { ok: true, out: r.stdout };
}
export function remoteReady() {
  const r = rclone(['listremotes']);
  if (!r.ok) return r;
  return r.out.split('\n').includes(`${REMOTE}:`) ? { ok: true } : { ok: false, why: `no rclone remote "${REMOTE}:" — one-time: rclone config create ${REMOTE} drive scope=drive (opens a browser sign-in)` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const arg = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (a.includes('--pull-drive')) {
    const ready = remoteReady(); if (!ready.ok) { console.error(`UNMEASURED — ${ready.why}`); process.exit(2); }
    const tmp = resolve(REPO, 'out/board/pulled.xlsx'); mkdirSync(dirname(tmp), { recursive: true });
    const r = rclone(['copyto', `${REMOTE}:${DRIVE_PATH}.xlsx`, tmp, '--drive-export-formats', 'xlsx']);
    if (!r.ok) { console.error(`pull failed — ${r.why}`); process.exit(1); }
    a.push('--pull', tmp);
  }
  if (arg('--pull')) {
    const cells = filledCells(readXlsx(resolve(arg('--pull'))));
    const at = new Date().toISOString();
    if (cells.length) appendFileSync(resolve(REPO, ANSWERS), cells.map((c) => JSON.stringify({ at, ...c })).join('\n') + '\n');
    console.log(`pulled ${cells.length} filled cell(s) → ${ANSWERS}${cells.length ? '' : ' (nothing filled yet)'}`);
    for (const c of cells.slice(0, 20)) console.log(`  ${c.tab} · ${c.id} · ${c.field}: ${clip(c.value, 100)}`);
    process.exit(0);
  }
  const ow = await owedReplies();
  const b = buildBoard({ owed: ow.owed, owedNote: ow.note, sessionsText: arg('--sessions') ? readFileSync(resolve(arg('--sessions')), 'utf8') : '', calendarJson: arg('--calendar') ? readFileSync(resolve(arg('--calendar')), 'utf8') : null, place: !a.includes('--json') && !a.includes('--no-place') });
  // process.exit right after a large console.log truncates a piped stdout at 64 KB; write, then exit on the flush.
  if (a.includes('--json')) { process.stdout.write(JSON.stringify({ ...b, projects: b.projects.map((p) => ({ ...p, rows: p.rows.map((r) => r.id) })) }, null, 2) + '\n', () => process.exit(0)); await new Promise(() => {}); }
  // C1020j: the Newsletter tab reads the /sendperf report; re-run it (with its Supabase sync) when stale. --no-refresh reads it as it stands.
  if (!a.includes('--no-refresh')) { const r = refreshSendReport(); console.log(`newsletter: ${r.why}`); }
  const T = await allTabs(b);
  if (arg('--csv')) for (const f of writeCsvs(T, b, resolve(arg('--csv')))) console.log(`csv → ${f.replace(REPO + '/', '')} · ${statSync(f).size} bytes`);
  const out = writeXlsx(T, resolve(REPO, arg('--out') || 'out/board/thetacog-board.xlsx'));
  if (a.includes('--drive')) {
    const ready = remoteReady();
    if (!ready.ok) console.log(`drive: not uploaded — ${ready.why}`);
    else { const r = rclone(['copyto', out, `${REMOTE}:${DRIVE_PATH}.xlsx`, '--drive-import-formats', 'xlsx']); console.log(r.ok ? `drive: uploaded → ${REMOTE}:${DRIVE_PATH} (converted to a Google Sheet)` : `drive: upload failed — ${r.why}`); }
  }
  console.log(`board → ${out.replace(REPO + '/', '')} · ${statSync(out).size} bytes · ${b.counts.projects} projects · ${b.counts.open} open rows · ${b.counts.questions} questions (${b.counts.yourAct} your acts · ${b.counts.needsOperator} need your answer) · ${b.sessions.length} sessions · ${b.counts.claims} live claims · ${b.reports.length} reports + ${BLANK_REPORTS} blank`);
}
