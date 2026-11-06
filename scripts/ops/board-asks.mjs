#!/usr/bin/env node
// scripts/ops/board-asks.mjs — C2322 THE /sheet SKILL'S SHEET: one row per ask, dense enough that the eye reads it at once.
// (chair decomposition 2026-11-05 of the operator's words "/steer infer all the features we need to bundle here. So what do
// we really need to ship with this for the /dir command to be as compelling as possible? We alrea", not on the tape: "Spec
// adherence ships inside the npm package, and the sheets are how a stranger sees it. — Bundle the Google Sheets integration
// as skills in the package: /board, /tend and /project, plus a new /sheet skill that, after the person signs into Google
// once, creates a sheet for a steer run that itemises every ask of that run and of the extension in general, one row per
// ask with its plain head, verbatim span, guard, state, commit and Merkle leaf, at maximum density so the eye reads it at
// once, and an option to write the spec Merkle tree as a sheet.")
//
// ONE LAYOUT, THE OPERATOR'S (operator 2026-11-05: "find and fix all the half finished parts"). This sheet and the Steer · Compiled
// sheet's Asks tab used to be two layouts; now every row is a spec row turned into an ask (specAsk) and the grid is
// board-steer.mjs composeAsksTab — the same TITLE · DESCRIPTION · one header (ROW_HEAD: COMMENT (fill) second, LEAF last) the operator
// reads, so what npm ships is what he sees. THIS RUN (today's dated rows, or --rows) comes first, PROJECT = "THIS RUN (…)", then
// every other top-level row the spec has carried, PROJECT = "EVERY ASK OF THE EXTENSION" — one tab, one header, each id once (the
// writer keys his cells by id, so a row listed twice would carry one comment into two rows). Every cell is read off the spec, git
// and the tree — never typed: HEAD (plain) · ASK (verbatim) = the row's own quoted words · STATE ✓ done / ☐ open with the guard's
// state · COMMITS the sha that ticked it · GUARD · LEAF (the same 10-hex the Tree and Project sheets print). A Sheets comment is
// anchored on the row's ID cell (board-comments.mjs anchoredRow reads the id off the quoted cell) or typed into COMMENT (fill).
//
//   node scripts/ops/board-asks.mjs --print [--rows C1,C2] [--date YYYY-MM-DD]     the first rows to stdout
//   node scripts/ops/board-asks.mjs [--rows C1,C2] [--date YYYY-MM-DD]             write the sheet "Asks" (created on first run)
//   node scripts/ops/board-asks.mjs --tree [...]                                   the option: hand off to board-tree.mjs, unchanged
//
// @guard tests/vna/c2322-spec-adherence-ships-inside-the-npm.test.mjs
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as L from '../vna/asks-ledger.mjs';
import { leafIndex, holderIndex } from './board-project.mjs';
import { composeAsksTab, ROW_HEAD } from './board-steer.mjs';   // THE ONE ASKS LAYOUT

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SHEET = 'Asks';
export const TITLE = '05 · ASKS — this run first, then every ask the extension has ever carried; one row per ask';
export const HEAD = ROW_HEAD;   // the one header, board-steer.mjs's
export const DESC = 'One row per ask of this steer run first, then every other ask the extension has carried, in the Steer · Compiled layout, each cell read off the spec, git and the spec tree; comment on the ID cell or type in COMMENT (fill).';
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1) + '…'; };

// COMMENTS IN CONTEXT (C2323): the anchor is the row's ID cell — never blank, it IS the id board-comments.mjs anchoredRow() greps
// a comment's quotedFileContent for. The old placeholder cell ("↳ comment on <id> here") sat in an unfilled COMMENT column the writer
// could not tell from his typing; the one layout's COMMENT (fill) is his, blank until he types.
export function commentCell(id) { return String(id); }

// the row's own words, never a paraphrase: the fullest *"…"* span on the line — the chair-decomposition's "not on the
// tape" quote sits last when both the operator's own words and the fuller decomposed span are quoted (QUOTE EXACT OR
// PARAPHRASE); a row with one quote only still reads it the same way.
export function extractSpan(line) {
  const all = [...String(line || '').matchAll(/\*"(.*?)"\*/gs)].map((m) => m[1]);
  return all.length ? all[all.length - 1] : '';
}

// a spec row → an ask in the one layout's shape (board-steer.mjs askRow reads these keys)
export function specAsk(r, block, { repo, runnerRows, gitLog, leaves }) {
  const sha = r.ticked ? (L.commitForRow(r.id, { repo, runnerRows, gitLog }) || {}).sha || 'sha: not found in git' : null;
  return { id: r.id, titleText: r.line, project: block, projectTitle: block, head: clip(L.headline(r.line), 140), ask: clip(extractSpan(r.line), 200), guard: r.guard || '', ticked: !!r.ticked,
    commits: sha ? [sha] : [], leaf: leaves.get(r.id) || '', empty: ['not compiled — a spec row'], spec: 'docs/specs/vna/SPEC-VNA-COCKPIT.md' };
}

// specText: the spec markdown · repo: read-through to asks-ledger.mjs (one implementation, never a second git/guard
// reader) · leaves: Map(id → 10-hex), default read off data/vna/spec-tree.json via board-project.mjs's leafIndex.
// EVERY ASK OF THE EXTENSION can mean hundreds of ticked rows: the runner ledger and the git log are each read ONCE
// here and passed to every row's commitForRow, never re-read per row (a per-row read made this block unusable).
export function composeAsks({ specText, repo = REPO, date = null, rows = null, runnerNdjsonPath = L.RUNNER_NDJSON, leaves = new Map(), holders = new Map() } = {}) {
  const d = date || new Date().toISOString().slice(0, 10);
  const runRows = L.scopeRows(specText, { rows, date: d });
  const allRows = L.allTopLevelRows(specText);
  const runnerRows = L.runnerRows(runnerNdjsonPath);
  const gitLog = L.gitLogText(repo, { n: Math.max(2000, allRows.length * 2) });
  const ctx = { repo, runnerRows, gitLog, leaves };
  const run = `THIS RUN (${rows && rows.length ? rows.join(',') : d})`; const inRun = new Set(runRows.map((r) => r.id));
  const asks = [...runRows.map((r) => specAsk(r, run, ctx)), ...allRows.filter((r) => !inRun.has(r.id)).map((r) => specAsk(r, 'EVERY ASK OF THE EXTENSION', ctx))];
  return composeAsksTab(asks, { title: TITLE, desc: DESC, summary: `${runRows.length} in this run · ${allRows.length} ask(s) the extension has carried`,
    ctx: { leaves, holders, guardState: (g) => L.guardState(g, { repo }), exists: (p) => existsSync(resolve(repo, p)) } });
}

export async function compose({ date = null, rows = null } = {}) {
  const specText = readFileSync(resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'), 'utf8');
  let holders = new Map(); try { holders = await holderIndex(); } catch {}
  return composeAsks({ specText, repo: REPO, date, rows, leaves: leafIndex(), holders });
}

// the entry check compares REAL paths: macOS tmpdir() is /var/folders → /private/var/folders, so a stranger's install run through the
// symlinked path never matched import.meta.url and the script exited 0 printing nothing (C2325 T3, red on that before this line)
const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && realOr(process.argv[1]) === realOr(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  // the option: the spec Merkle tree as a sheet is board-tree.mjs's job already (C2170a) — a second composer for the
  // same tree is exactly the proxy this repo keeps finding and removing, so --tree hands off rather than re-deriving it.
  if (argv.includes('--tree')) {
    execFileSync('node', [resolve(dirname(fileURLToPath(import.meta.url)), 'board-tree.mjs'), ...argv.filter((a) => a !== '--tree')], { stdio: 'inherit' });
    process.exit(0);
  }
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const rowsArg = arg('--rows'); const rows = rowsArg ? rowsArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const date = arg('--date');
  // the sign-in check runs before the spec or board-drive.json is touched (C2325: a stranger's install carries neither)
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = argv.includes('--print') ? { token: null } : rcloneToken(); if (!argv.includes('--print') && !t.token) { console.log(`UNMEASURED — ${t.why} — sign in to Google once, then re-run`); process.exit(2); }
  const grid = await compose({ date, rows });
  if (grid.length <= 3) { console.log('✗ refused — no asks read; an empty Asks sheet would claim the extension has none'); process.exit(1); }
  if (argv.includes('--print')) { for (const r of grid.slice(0, 40)) console.log(r.map((c) => clip(c, 42)).join(' │ ')); console.log(`… ${grid.length - 2} rows`); process.exit(0); }
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.sheets[SHEET];
  if (!id) {
    const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: TITLE, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    if (!r.id) { console.log(`✗ create failed: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); }
    id = r.id; j.sheets = { [SHEET]: id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  const r = await writeSheet(t.token, id, grid, { name: SHEET });
  console.log(r.refused ? `✗ refused — ${r.why}` : `✓ ${SHEET}: ${r.mode === 'cells' ? `${r.applied} cell(s) written · ${r.appended} appended` : `${r.newRows} rows`} · https://docs.google.com/spreadsheets/d/${id}/edit`);
  process.exit(r.refused ? 1 : 0);
}
