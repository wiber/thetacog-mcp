#!/usr/bin/env node
// scripts/ops/board-views.mjs — C1037: EVERY VIEW IS WRITTEN AND GRADED FROM HIS CHAIR. Operator 2026-10-19, verbatim: "every view
// needs to be written and graded from the operator perspective to maximize sense making and overview and cognitive hierarchy the
// usability of the page and that could be that they're all very similar they might just be lists other than the two day 2-D views
// of what's in the rooms right now".
//
// Three things live here, once:
//   VIEWS       each tab of the book (board-book.mjs) and the one question it answers for him, in plain words. Declared here and shown
//               on the Views tab, never as a question row on top of a tab: mergeFills and board-watch read row 1 as the header.
//   GRADES      data/vna/board-view-grades.ndjson, append-only: one row per cold reading {at, tab, grade, lacks, room, reader}. The
//               latest reading per tab is the grade in force; the first rows are the 2026-10-20 sonnet readings (C1039b baseline).
//   ROOMS       the 2-D view: the nine rooms of data/room-surfaces.json × what each holds right now — live claim, last commit, what
//               it owes him, next action — one cell each, read off the record with no model.
//
//   node scripts/ops/board-book.mjs --grade-views [Tab ...]   cold-read each tab (claude -p sonnet, in parallel), append the readings
//   node scripts/ops/board-book.mjs --check-views              print every finding (no question · no grade · under 6 with no gap)
//   (the CLI lives in board-book.mjs: this module is imported by composeBook, and a CLI here importing the book back would deadlock)
// Port row: none — this decides nothing the crate holds; the grade is a reader's, the rooms view is transport off the record.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { clip } from './board-row.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const GRADES = 'data/vna/board-view-grades.ndjson';
export const PASS = 6;

// The question each view answers for him. A tab the book composes and this table does not name fails the guard.
export const VIEWS = {
  Decide: 'What must I decide or do today, most ready first?',
  Mailbox: 'What did I type into a cell, where did it go, and what has happened since?',
  Now: 'Which terminal is on what right now, and which one can take a row?',
  Rooms: 'What is each of the nine rooms holding right now, and what does it owe me?',
  Tasks: 'What is every open task, which is ready to build, and what is each waiting on?',
  Map: 'Where on the 12×12 does the open work land?',
  Tiles: 'What does each tile of the lattice mean, and what work lands on it?',
  Questions: 'What is every open question for me, ranked, and what answers it?',
  Views: 'What does each tab answer for me, and how well does it answer it?',
};

const readNd = (p) => { const f = resolve(REPO, p); if (!existsSync(f)) return []; return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); };
export function latestGrades(rows = readNd(GRADES)) { const m = new Map(); for (const r of rows) if (r && r.tab) m.set(r.tab, r); return m; }

// ── the 2-D view: nine rooms × what each holds ──
export const roomKey = (owner) => String(owner || '').trim().split(/\s+/).pop().toLowerCase();
export const ROOMS_HEAD = ['ID', 'LIVE CLAIM', 'LAST COMMIT', 'OWES YOU', 'NEXT ACTION', 'COMMENT (fill)'];

// rooms: {name: {emoji}} · claims: [{room, path, note, at}] · commits: [{room, sha, date, subject}] newest first ·
// tasks: [{room, id, entity, state, by, vector, priority}] in the shared sort order.
export function roomsTab({ rooms, claims = [], commits = [], tasks = [] }) {
  const rows = Object.entries(rooms).map(([name, v]) => {
    const c = claims.filter((x) => x.room === name); const last = commits.find((x) => x.room === name);
    const mine = tasks.filter((t) => t.room === name);
    const owes = mine.filter((t) => t.state === 'SUSPENDED' && /^Operator (act|input)/.test(t.by));
    const next = mine.find((t) => t.state === 'ELIGIBLE');
    return [`${v.emoji || ''} ${name}`.trim(),
      c.length ? `${c.length} path(s) · ${clip(c[0].note, 70)} (${clip(c[0].path, 50)})` : 'no live claim',
      last ? `${last.date} ${last.sha} ${clip(last.subject, 80)}` : 'none of the last 600 commits is this room\'s',
      owes.length ? `${owes.length} · top: ${owes[0].id} ${clip(owes[0].by, 80)}` : 'nothing',
      next ? `${next.vector} — ${clip(next.entity, 60)}` : `nothing eligible · ${mine.length} of its rows on the Tasks list wait`, ''];
  });
  return [ROOMS_HEAD, ...rows];
}

// ownerOf comes from board.mjs through the caller: a static import here closes a cycle board-book → board-views → board.
export function roomsFromRecord({ claims, tasks, projects, ownerOf }) {
  const rooms = JSON.parse(readFileSync(resolve(REPO, 'data/room-surfaces.json'), 'utf8')).rooms;
  const names = Object.keys(rooms);
  const roomOfText = (t) => names.find((n) => new RegExp(`\\b${n}\\b`, 'i').test(String(t || ''))) || null;
  // A commit's room: its Originating-Terminal trailer names it; with no trailer, the room owning the first path it touched (generated
  // ledgers under .thetacog/ and data/ skipped, and chore(commit-page) skipped whole, so a publish never stands in for work).
  let log = ''; try { log = execFileSync('git', ['log', '-n', '600', '--name-only', '--format=@@%h%x09%cs%x09%(trailers:key=Originating-Terminal,valueonly,separator=;)%x09%s'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { log = ''; }
  const commits = log.split('@@').filter(Boolean).map((blk) => { const [line, ...files] = blk.split('\n'); const [sha, date, term, ...sub] = line.split('\t');
    const path = files.map((f) => f.trim()).find((f) => f && !/^(\.thetacog|data|docs\/pmu\/commit-panels|public\/commit)\//.test(f));
    return { room: roomOfText(term) || (path && ownerOf ? names.find((n) => n === roomKey(ownerOf(path, rooms))) : null) || null, sha, date, subject: sub.join('\t') }; })
    .filter((c) => c.room && !/^chore\(commit-page\)/.test(c.subject));
  return { rooms, claims: claims.map((c) => ({ ...c, room: roomKey(ownerOf(c.path, rooms)) })), commits, tasks: tasks.map((t) => ({ ...t, room: roomKey((projects.find((p) => p.name.trim() === String(t.project || '').trim()) || {}).owner) })) };
}

// ── the Views tab ──
export const VIEWS_HEAD = ['ID', 'ANSWERS FOR YOU', 'GRADE 0–9', 'READ ON', 'READER', 'WHAT IT LACKS', 'ROOM THAT CLOSES IT', 'COMMENT (fill)'];
export function viewsTab(names, grades = latestGrades()) {
  const rows = names.map((n) => { const g = grades.get(n) || {};
    return [n, VIEWS[n] || 'UNDECLARED — no question for this tab in board-views.mjs', Number.isInteger(g.grade) ? g.grade : 'ungraded', (g.at || '—').slice(0, 10), g.reader || '—', g.lacks || (Number.isInteger(g.grade) && g.grade >= PASS ? 'nothing named' : '—'), g.room || '—', ''];
  }).sort((a, b) => (Number.isInteger(a[2]) ? a[2] : -1) - (Number.isInteger(b[2]) ? b[2] : -1));
  return [VIEWS_HEAD, ...rows, [], ['', `a grade is a cold reader's (it sees only the tab and its question) · under ${PASS} names what the tab lacks and the room that closes it · re-read with node scripts/ops/board-views.mjs --grade`]];
}

// Every finding against C1037 across a composed book. Empty array = every view is declared, graded, and any shortfall named.
export function viewFindings(tabs, grades = latestGrades(), roomNames = null) {
  const out = [];
  for (const [name, rows] of tabs) {
    if (!VIEWS[name]) out.push(`${name}: declares no question it answers for him`);
    if (name === 'Rooms' && roomNames) {
      const ids = rows.slice(1).filter((r) => r && String(r[0] || '').trim()).map((r) => roomKey(r[0]));
      if (ids.length !== roomNames.length || !roomNames.every((n) => ids.includes(n))) out.push(`Rooms: is not the nine rooms (${ids.join(', ')})`);
      if (rows[0].join('|') !== ROOMS_HEAD.join('|')) out.push('Rooms: does not carry claim · last commit · owes you · next action');
    }
    const g = grades.get(name);
    if (!g || !Number.isInteger(g.grade) || g.grade < 0 || g.grade > 9) { out.push(`${name}: carries no grade 0–9`); continue; }
    if (g.grade < PASS && (!String(g.lacks || '').trim() || !String(g.room || '').trim())) out.push(`${name}: grade ${g.grade} under ${PASS} names no gap and no room`);
  }
  return out;
}

// ── the cold read ──
export function coldPrompt(name, rows, top = 25) {
  const csv = rows.slice(0, top + 1).map((r) => (r || []).map((c) => `"${String(c ?? '').replace(/"/g, '""').slice(0, 160)}"`).join(',')).join('\n');
  return `You are the operator of a small company, reading one tab of your own planning spreadsheet on a phone. You did not build it. The tab is called "${name}" and it exists to answer one question for you: "${VIEWS[name]}"\n\nHere are its header and top ${top} rows as CSV:\n\n${csv}\n\nGrade 0–9 how well this tab answers that question for you, at a glance, with nothing else open (0 = works against it, 9 = answered at a glance). If the grade is under ${PASS}, name in one sentence the single thing the tab lacks. Reply with JSON only, no prose: {"grade": N, "lacks": "..."}`;
}

function readOnce(name, rows) {
  return new Promise((ok) => {
    const p = spawn('claude', ['-p', '--model', 'sonnet', '--max-turns', '1'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => { const m = out.match(/\{[^{}]*"grade"[^{}]*\}/); let j = null; try { j = m && JSON.parse(m[0]); } catch { j = null; } ok(j && Number.isInteger(j.grade) ? j : null); });
    p.stdin.end(coldPrompt(name, rows));
  });
}

// Cold-read the named tabs (all when none) in parallel and append each reading. A reader that returns no grade appends nothing.
export async function gradeViews(tabs, want = []) {
  const pick = tabs.filter(([n]) => !want.length || want.includes(n)); const at = new Date().toISOString();
  const res = await Promise.all(pick.map(async ([n, rows]) => [n, await readOnce(n, rows)]));
  mkdirSync(dirname(resolve(REPO, GRADES)), { recursive: true }); const out = [];
  for (const [n, j] of res) {
    if (!j) { out.push(`✗ ${n}: the reader returned no grade — UNMEASURED, nothing appended`); continue; }
    const row = { at, tab: n, grade: j.grade, lacks: clip(j.lacks || '', 200), room: 'architect', reader: 'sonnet · claude -p · top 25 rows · board-views.mjs coldPrompt' };
    appendFileSync(resolve(REPO, GRADES), JSON.stringify(row) + '\n'); out.push(`${n} ${j.grade} · ${row.lacks}`);
  }
  return out;
}
