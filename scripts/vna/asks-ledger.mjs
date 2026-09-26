#!/usr/bin/env node
// scripts/vna/asks-ledger.mjs — C185 THE ASKS LEDGER: /steer ITEMISES WHAT IT COULD NOT FOLD, AND OPENS IT.
// (operator 2026-09-23, verbatim: "bash open a txt with the done and not done items - itemise all my asks - wire
// that into steer by the way, when diminishing returns, or you are not able to fold in asks (dont just not do
// them, itemise the unclear items that need to be refined, questions that need answers from here or subatents,
// bash open the assumptiomns, reqs that are unclear, asks open etc").
//
// A PURE COMPOSER over four inputs — the spec file, git, the runner ndjson tail, and chair-supplied `--note` lines —
// never a second registry and never a model in the path. Reference instance (hand-written, this row's first case):
// docs/specs/vna/asks/2026-09-23-asks-ledger.txt — match its sections and tone.
//
// DERIVED (computed, never passed in):
//   DONE     — a row ticked in the spec, with the commit sha that did it (runner.ndjson's verdict row first, since
//              a runner-driven tick carries its own sha; falls back to `git log` for a commit whose subject names
//              the row id). A ticked row with no commit found either way says so — never a fabricated sha.
//   NOT DONE — an open row in scope, with its guard's state read off disk and git: `not written` (guard file exists
//              nowhere), `on disk` (exists, not yet in HEAD), `in HEAD` (committed). The fourth state the row
//              describes, `green`, would mean actually RUNNING the guard — deliberately NOT done here: this
//              composer runs on a shared tree mid-session (WIP-CLAIMS), and spawning an arbitrary test file as a
//              side effect of writing a report is exactly the kind of proxy action AXIOM 1 / the-proxy-is-not-the-
//              thing warns against. `in HEAD` is the ceiling this script asserts on its own authority.
//
// PROSE (passed in by the chair, printed under their own heading, never mixed into a derived section):
//   --note "<SECTION>: <line>"   SECTION one of: YOUR ACTS · QUESTIONS · UNCLEAR · ASSUMPTIONS · CORRECTIONS
//                                  (aliases: QUESTIONS -> "QUESTIONS THAT NEED YOUR ANSWER", UNCLEAR -> "UNCLEAR
//                                  REQUIREMENTS", ASSUMPTIONS -> "ASSUMPTIONS I ACTED ON"). An unrecognised section
//                                  refuses loudly — a note that lands under the wrong heading, or silently nowhere,
//                                  is the exact failure this file exists to prevent.
//
// SCOPE: --rows C1,C2,... or, by default, every top-level row whose verbatim quote is dated today (--date to override,
// mainly for tests). A row with no date in its own line (predates this convention) is only ever reached by --rows.
//
// WRITES docs/specs/vna/asks/<YYYY-MM-DD>-asks-ledger.txt — a second run the same day writes -2, -3, … and NEVER
// overwrites (AXIOM 1: evict or retain, never silently discard a prior ledger). Prints the path; --open bash-opens
// it on darwin.
//
//   node scripts/vna/asks-ledger.mjs [--rows C1,C2] [--date YYYY-MM-DD] [--note "SECTION: line"]... [--open] [--json]
//
// @guard tests/vna/c185-steer-writes-and-opens-the-asks-ledger.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tailRows } from './walk-tape-read.mjs';
import { WITHDRAWN } from './spec-clarity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const ASKS_DIR = process.env.VNA_ASKS_DIR || resolve(REPO, 'docs/specs/vna/asks');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const GOAL_CLI = resolve(HERE, 'goal.mjs');

// ── scope: every top-level row (never a sub-row) with its tick state, guard path and declared date ─────────────
const ROW_RE = /^-\s*\[([ xX])\]\s*(C\d+[a-z]?)\b.*$/;
export function allTopLevelRows(specText) {
  const out = [];
  for (const line of String(specText || '').split('\n')) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const guardMatch = /guard:\s*`([^`]+)`/.exec(line);
    const dateMatch = /\(operator\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    out.push({ id: m[2], ticked: m[1].toLowerCase() === 'x', line, guard: guardMatch ? guardMatch[1] : null, date: dateMatch ? dateMatch[1] : null });
  }
  return out;
}
export function scopeRows(specText, { rows = null, date = null } = {}) {
  const all = allTopLevelRows(specText);
  if (rows && rows.length) { const want = new Set(rows); return all.filter((r) => want.has(r.id)); }
  const d = date || new Date().toISOString().slice(0, 10);
  return all.filter((r) => r.date === d);
}
// the human ask, stripped of the checkbox/id, the guard clause and the trailing (operator ..., verbatim: "...") span
export function headline(line) {
  return String(line)
    .replace(/^-\s*\[[ xX]\]\s*C\d+[a-z]?\s*/, '')
    .replace(/\(guard:[^)]*\)\s*/, '')
    .replace(/\s*\(operator[^)]*\)\s*$/, '')
    .trim();
}

// ── DONE: the commit sha, read from git — never from prose ──────────────────────────────────────────────────────
const ndjson = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
// a verdict row the runner itself appended (steer-runner.mjs / the c110 stub shape: {kind:'verdict', ok, label, sha})
// carries the sha that did the work directly — read it before ever falling back to a git-log text search
export function runnerCommitForRow(rowId, runnerNdjsonPath = RUNNER_NDJSON) {
  if (!existsSync(runnerNdjsonPath)) return null;
  let rows;
  try {
    const { size } = statSync(runnerNdjsonPath);
    rows = size > 8 * 1024 * 1024 ? tailRows(runnerNdjsonPath, 8 * 1024 * 1024) : ndjson(runnerNdjsonPath);
  } catch { return null; }
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.kind === 'verdict' && r.ok && r.sha && (r.label === rowId || (Array.isArray(r.labels) && r.labels.includes(rowId)))) {
      return { sha: String(r.sha).slice(0, 10), source: 'runner.ndjson' };
    }
  }
  return null;
}
export function gitCommitForRow(rowId, { repo = REPO } = {}) {
  let out; try { out = execFileSync('git', ['log', '--format=%H\t%s', '-n', '2000'], { cwd: repo, encoding: 'utf8' }); } catch { return null; }
  const re = new RegExp(`\\b${rowId}\\b`);
  for (const line of out.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t'); if (tab < 0) continue;
    const sha = line.slice(0, tab), subject = line.slice(tab + 1);
    if (re.test(subject)) return { sha: sha.slice(0, 10), subject, source: 'git log' };
  }
  return null;
}
export function commitForRow(rowId, { repo = REPO, runnerNdjsonPath = RUNNER_NDJSON } = {}) {
  return runnerCommitForRow(rowId, runnerNdjsonPath) || gitCommitForRow(rowId, { repo });
}

// ── NOT DONE: the guard's state — not written / on disk / in HEAD (never `green`: see file header) ─────────────
export function guardState(guardPath, { repo = REPO } = {}) {
  if (!guardPath) return 'no guard declared';
  let inHead = false;
  try { execFileSync('git', ['cat-file', '-e', `HEAD:${guardPath}`], { cwd: repo, stdio: 'pipe' }); inHead = true; } catch {}
  if (inHead) return 'in HEAD';
  const onDisk = existsSync(resolve(repo, guardPath));
  return onDisk ? 'on disk' : 'not written';
}

// ── prose sections: chair-supplied --note "SECTION: line", each landing under its own heading only ─────────────
export const SECTIONS = ['DONE', 'NOT DONE', 'YOUR ACTS', 'QUESTIONS THAT NEED YOUR ANSWER', 'UNCLEAR REQUIREMENTS', 'ASSUMPTIONS I ACTED ON', 'CORRECTIONS'];
const NOTE_SECTIONS = ['YOUR ACTS', 'QUESTIONS THAT NEED YOUR ANSWER', 'UNCLEAR REQUIREMENTS', 'ASSUMPTIONS I ACTED ON', 'CORRECTIONS'];
const ALIASES = {
  'ACTS': 'YOUR ACTS', 'YOUR ACTS': 'YOUR ACTS',
  'QUESTIONS': 'QUESTIONS THAT NEED YOUR ANSWER', 'QUESTIONS THAT NEED YOUR ANSWER': 'QUESTIONS THAT NEED YOUR ANSWER',
  'UNCLEAR': 'UNCLEAR REQUIREMENTS', 'UNCLEAR REQUIREMENTS': 'UNCLEAR REQUIREMENTS',
  'ASSUMPTIONS': 'ASSUMPTIONS I ACTED ON', 'ASSUMPTIONS I ACTED ON': 'ASSUMPTIONS I ACTED ON',
  'CORRECTIONS': 'CORRECTIONS',
};
export function parseNote(raw) {
  const s = String(raw || '');
  const i = s.indexOf(':');
  if (i < 0) throw new Error(`asks-ledger: --note "${raw}" must be "<SECTION>: <line>" (SECTION one of ${NOTE_SECTIONS.join(', ')})`);
  const key = s.slice(0, i).trim().toUpperCase();
  const text = s.slice(i + 1).trim();
  const section = ALIASES[key];
  if (!section) throw new Error(`asks-ledger: --note section "${key}" is not one of ${NOTE_SECTIONS.join(', ')}`);
  if (!text) throw new Error(`asks-ledger: --note "${raw}" has no text after the section`);
  return { section, text };
}

function sectionHeader(title) {
  const prefix = `═══ ${title} `;
  const width = 84;
  return prefix + '═'.repeat(Math.max(3, width - prefix.length));
}

// ── the composer: LLM-free, every derived line traced to a receipt, every prose line traced to a --note ────────
export function composeLedger({ specText, repo = REPO, date = null, rows = null, notes = [], runnerNdjsonPath = RUNNER_NDJSON, goalStatus = null } = {}) {
  const d = date || new Date().toISOString().slice(0, 10);
  const scoped = scopeRows(specText, { rows, date: d });
  const doneRows = scoped.filter((r) => r.ticked);
  // a row that declares itself WITHDRAWN is kept in the spec (the id is never reissued) and is neither done nor open — the same
  // marker spec-clarity reads, imported, never a second regex (C186.12)
  const openRows = scoped.filter((r) => !r.ticked && !WITHDRAWN.test(r.line.replace(/^-\s*\[.\]\s*C\d+[a-z]?\s*/, '')));

  const bySection = Object.fromEntries(NOTE_SECTIONS.map((s) => [s, []]));
  for (const raw of notes) { const { section, text } = parseNote(raw); bySection[section].push(text); }

  const L = [];
  L.push(`ASKS LEDGER — ${d} session — every ask, its state, and what is unclear`);
  L.push(`Written ${d}. Source of truth for ids: docs/specs/vna/SPEC-VNA-COCKPIT.md. Every "done" below cites a commit.`);
  if (goalStatus && goalStatus.turns) L.push(`Goal: turn ${goalStatus.turns.used + 1} of ${goalStatus.turns.min}–${goalStatus.turns.max}${goalStatus.turns.over ? ' — OVER BUDGET' : ''} · done ${goalStatus.done} · left ${goalStatus.left}`);
  L.push('');

  L.push(sectionHeader('DONE (commit on main)'), '');
  if (!doneRows.length) L.push(' (none in scope)');
  doneRows.forEach((r, i) => {
    const hit = commitForRow(r.id, { repo, runnerNdjsonPath });
    L.push(` ${i + 1}. ${r.id} — ${headline(r.line)}    ${hit ? hit.sha : 'sha: not found in git'}`);
  });
  L.push('');

  L.push(sectionHeader('NOT DONE — declared, not built'), '');
  if (!openRows.length) L.push(' (none in scope)');
  openRows.forEach((r, i) => {
    L.push(` ${i + 1}. ${r.id} — ${headline(r.line)}    guard: ${guardState(r.guard, { repo })}`);
  });
  L.push('');

  L.push(sectionHeader('YOUR ACTS'), '');
  L.push(...(bySection['YOUR ACTS'].length ? bySection['YOUR ACTS'].map((t) => ` • ${t}`) : [' (none)']));
  L.push('');

  L.push(sectionHeader('QUESTIONS THAT NEED YOUR ANSWER'), '');
  L.push(...(bySection['QUESTIONS THAT NEED YOUR ANSWER'].length ? bySection['QUESTIONS THAT NEED YOUR ANSWER'].map((t, i) => ` Q${i + 1}. ${t}`) : [' (none)']));
  L.push('');

  L.push(sectionHeader('UNCLEAR REQUIREMENTS'), '');
  L.push(...(bySection['UNCLEAR REQUIREMENTS'].length ? bySection['UNCLEAR REQUIREMENTS'].map((t, i) => ` R${i + 1}. ${t}`) : [' (none)']));
  L.push('');

  L.push(sectionHeader('ASSUMPTIONS I ACTED ON'), '');
  L.push(...(bySection['ASSUMPTIONS I ACTED ON'].length ? bySection['ASSUMPTIONS I ACTED ON'].map((t) => ` • ${t}`) : [' (none)']));
  L.push('');

  L.push(sectionHeader('CORRECTIONS'), '');
  L.push(...(bySection['CORRECTIONS'].length ? bySection['CORRECTIONS'].map((t) => ` • ${t}`) : [' (none)']));
  L.push('');

  return L.join('\n');
}

// ── write: never overwrite a same-day ledger — -2, -3, … (AXIOM 1: evict or retain, never silently discard) ────
export function ledgerPath({ dir = ASKS_DIR, date } = {}) {
  const base = resolve(dir, `${date}-asks-ledger.txt`);
  if (!existsSync(base)) return base;
  let n = 2;
  while (existsSync(resolve(dir, `${date}-asks-ledger-${n}.txt`))) n++;
  return resolve(dir, `${date}-asks-ledger-${n}.txt`);
}
export function writeLedger({ dir = ASKS_DIR, date, text } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = ledgerPath({ dir, date });
  writeFileSync(path, text);
  return path;
}

function goalStatusJson({ repo = REPO } = {}) {
  try { const out = execFileSync('node', [GOAL_CLI, 'status', '--json'], { cwd: repo, encoding: 'utf8' }); const line = out.trim().split('\n').pop(); return JSON.parse(line); }
  catch { return null; }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const rowsArg = arg('--rows');
  const rows = rowsArg ? rowsArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const notes = []; for (let i = 0; i < argv.length; i++) if (argv[i] === '--note') notes.push(argv[i + 1]);
  const date = arg('--date') || new Date().toISOString().slice(0, 10);
  const asJson = argv.includes('--json');
  const doOpen = argv.includes('--open');

  let specText; try { specText = readFileSync(SPEC_MD, 'utf8'); } catch (e) { console.error(`asks-ledger: cannot read spec at ${SPEC_MD} — ${e.message}`); process.exit(2); }
  let text;
  try { text = composeLedger({ specText, repo: REPO, date, rows, notes, runnerNdjsonPath: RUNNER_NDJSON, goalStatus: goalStatusJson({ repo: REPO }) }); }
  catch (e) { console.error(e.message); process.exit(2); }
  const path = writeLedger({ dir: ASKS_DIR, date, text });
  let opened = false;
  // VNA_ASKS_NO_OPEN=1 is a test-only seam: the guard suite spawns this CLI for real (never re-derives its output
  // by hand) and must not pop a GUI window on every run; the real /steer wiring never sets it, so --open still
  // bash-opens the ledger in normal use.
  if (doOpen && process.platform === 'darwin' && process.env.VNA_ASKS_NO_OPEN !== '1') { try { execFileSync('open', [path]); opened = true; } catch {} }
  if (asJson) console.log(JSON.stringify({ path, opened, date, rows: rows || 'today' }));
  else console.log(path);
  process.exit(0);
}
