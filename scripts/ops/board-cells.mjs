#!/usr/bin/env node
// scripts/ops/board-cells.mjs — the Mac half of CELL-BY-CELL writes (operator 2026-10-20: "turn on cell by cell that is critical").
// cellOps(live, composed) diffs the live sheet against what we would write, row by ID: a changed DERIVED cell becomes one
// compare-and-set op {r, c, was, now}; a row we have and the sheet lacks is appended; a "(fill)" cell is never touched (it is his or
// theirs); a row the sheet has and we dropped is left in place and named (AXIOM 1 — never deleted from the sheet silently).
// writeCells posts them to the Apps Script web app (scripts/ops/board-cell-writer.gs, BOARD_CELLS_URL + BOARD_CELLS_SECRET in
// .env.local); the web app writes a cell only if it still holds `was`, so his concurrent typing comes back as a conflict.
// Transport + a pure diff: stays node (CLAUDE.md MAXIMISE RUST — what stays node).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const s = (v) => String(v ?? '');
const isFill = (h) => /\(fill\)\s*$/.test(s(h).trim());
const headIdx = (g) => g.findIndex((r) => Array.isArray(r) && s(r[0]).trim() === 'ID');

export function cellOps(live, composed) {
  const lh = headIdx(live), ch = headIdx(composed);
  if (lh < 0 || ch < 0) return { ops: [], append: [], dropped: [], why: 'no ID header row on one side' };
  const lhead = live[lh].map((h) => s(h).trim()), chead = composed[ch].map((h) => s(h).trim());
  const ops = [];
  chead.forEach((h, c) => { if (s(lhead[c]) !== h) ops.push({ r: lh + 1, c: c + 1, was: s(live[lh][c]), now: h }); });
  const liveRow = new Map(); for (let i = lh + 1; i < live.length; i++) { const id = s(live[i][0]).trim(); if (id) liveRow.set(id, i); }
  const append = []; const seen = new Set();
  for (let i = ch + 1; i < composed.length; i++) {
    const row = composed[i]; const id = s(row[0]).trim(); if (!id) continue; seen.add(id);
    const li = liveRow.get(id);
    if (li === undefined) { append.push(row.map((v, c) => (isFill(chead[c]) ? '' : s(v)))); continue; }
    chead.forEach((h, c) => { if (!h || isFill(h)) return; const was = s(live[li][c]); const now = s(row[c]); if (was !== now) ops.push({ r: li + 1, c: c + 1, was, now }); });
  }
  const dropped = [...liveRow.keys()].filter((id) => !seen.has(id));
  return { ops, append, dropped };
}

// ALWAYS CELL BY CELL (operator 2026-10-21, verbatim: "If you're right to individual cells that should not be an issue ... Make sure you
// always do it that way"). planGrid diffs the target grid against the live one POSITION BY POSITION, so a re-rank or a column change is
// a set of compare-and-set cell writes, never a file swap. The target is the composed grid with his typed cells already placed by
// (id, header) (writeSheet's mergeFills), so his words move with their row. Rows past the target's end are blanked cell by cell; the
// caller has refused first if any of them held a typed cell (mergeFills orphans).
// C1074e — FORMULAS ARE COMPARED AS FORMULAS. formulas: the live sheet's formula grid (version-2 writer's read), "" where a cell holds a
// value. A cell whose live formula equals the target formula sends nothing; a changed cell carries `was` as the writer will compare it:
// the formula when the cell holds one, else the display.
export function planGrid(live, target, { formulas = null } = {}) {
  const ops = []; const n = Math.max(live.length, target.length);
  for (let r = 0; r < n; r++) {
    const L = live[r] || [], T = target[r] || [], F = (formulas && formulas[r]) || []; const w = Math.max(L.length, T.length);
    for (let c = 0; c < w; c++) { const f = s(F[c]); const was = f || s(L[c]); const now = s(T[c]); if (was !== now) ops.push({ r: r + 1, c: c + 1, was, now }); }
  }
  return { ops, append: [], dropped: [] };
}
// A grid carries a formula when any cell is one. A version-1 writer (display compare, one phase) cannot rewrite such a grid safely.
export const hasFormulas = (grid) => grid.some((row) => (row || []).some((v) => /^=/.test(s(v))));
export const WRITER_VERSION_NEEDED_FOR_FORMULAS = 2;
export const WRITER_VERSION_NEEDED_FOR_FORMAT = 3;   // the format op (board-layout formatSpec): layout with no value written

export function cellsConfig() {
  const env = existsSync(resolve(REPO, '.env.local')) ? readFileSync(resolve(REPO, '.env.local'), 'utf8') : '';
  const get = (k) => process.env[k] || (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
  return { url: get('BOARD_CELLS_URL'), secret: get('BOARD_CELLS_SECRET') };
}
// One web-app call runs one getValue + setValue per op under the script lock, inside Apps Script's six-minute cap. The People sheet's
// re-rank (two rows in at the top, every row below shifts) planned 25,953 ops in one 1.3 MB POST: the run died at the cap, the socket
// read "fetch failed", and the lock it held timed out the Projects and Reports writes behind it (2026-10-24). A plan over OPS_PER_CALL
// goes in bounded calls; every op is still compare-and-set, so a split plan means the same thing per cell. Formulas split safely too: the
// writer compares a formula cell by its formula text, never its display (board-cell-writer.gs phase 1), so no earlier call moves what a
// later one compares (the C1074e half-write was a display compare).
export const OPS_PER_CALL = 1500;
// SHEETS REPARSES A STRING THAT LOOKS LIKE A NUMBER (2026-10-24). setValue("0553007172") stored 553007172, a phone with its zero gone;
// commit 17484254e9 became 1.75E+16; a ratio lost its digits. The xlsx path wrote text cells and never did this; the cell path did on
// every value. A leading apostrophe stores the string as text and displays it unchanged, so the read-back equals what we sent. A plain
// integer (no leading zero, at most 15 digits) displays as itself and stays a number; a bare ISO date displays as itself too.
const NUMERICISH = /^[+\-]?[\d$€£.,%/:eE\s]+$/;
export function textSafe(v) {
  if (typeof v !== 'string' || v === '' || v.startsWith('=')) return v;
  if (v.startsWith("'")) return `'${v}`;
  if (/^\d{4}-\d\d-\d\d[T ]\d/.test(v)) return `'${v}`;   // an ISO date-time is reparsed (2026-10-24T02:09 read back as 2026-10-24 2:09)
  if (/^-?(0|[1-9]\d{0,14})$/.test(v) || /^\d{4}-\d\d-\d\d$/.test(v)) return v;
  return NUMERICISH.test(v) && /\d/.test(v) ? `'${v}` : v;
}
export async function writeCells(fileId, opts = {}, post = postCells) {
  const { ops = [], append = [] } = opts;
  if (ops.length <= OPS_PER_CALL) return post(fileId, opts);
  const out = { applied: 0, appended: 0, conflicts: [], calls: 0 };
  for (let i = 0; i < ops.length; i += OPS_PER_CALL) {
    const last = i + OPS_PER_CALL >= ops.length;
    const w = await post(fileId, { ...opts, ops: ops.slice(i, i + OPS_PER_CALL), append: last ? append : [] }); out.calls++;
    if (w.error || w.off) return { ...out, ...w, why: w.why, error: w.error && `${w.error} (call ${out.calls}, ${out.applied} op(s) already applied)` };
    out.applied += w.applied || 0; out.appended += w.appended || 0; out.conflicts.push(...(w.conflicts || []));
  }
  return out;
}
async function postCells(fileId, { ops = [], append = [], tab, read = false, format = null } = {}) {
  const { url, secret } = cellsConfig();
  if (!url || !secret) return { off: true, why: 'BOARD_CELLS_URL / BOARD_CELLS_SECRET not set in .env.local — deploy scripts/ops/board-cell-writer.gs' };
  const t0 = Date.now(); let r, t;   // a dropped socket comes back as an error with its cause and duration, never a bare throw
  try { r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ secret, fileId, ops: ops.map((o) => ({ ...o, now: textSafe(o.now) })), append: append.map((r) => r.map(textSafe)), tab, read, format }) }); t = await r.text(); }
  catch (e) { return { error: `network — ${e.cause?.code || e.cause?.message || e.message} after ${Math.round((Date.now() - t0) / 1000)} s (${ops.length} op(s))` }; } try { return JSON.parse(t); } catch { return { error: `not JSON from the web app (${r.status}): ${t.slice(0, 160)}` }; }
}

// A log tab inside a sheet's own file: read the tab, append only the rows whose ID it lacks (append-only, never rewritten).
export async function appendLogTab(fileId, tab, head, rows) {
  const r = await writeCells(fileId, { tab, read: true });
  if (r.error || r.off) return r;
  const have = new Set((r.values || []).map((x) => String(x[0] ?? '').trim()));
  const append = [...(have.has('ID') ? [] : [head]), ...rows.filter((x) => !have.has(String(x[0]).trim()))];
  return append.length ? writeCells(fileId, { tab, append }) : { applied: 0, appended: 0, conflicts: [] };
}
