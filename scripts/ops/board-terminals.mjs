#!/usr/bin/env node
// scripts/ops/board-terminals.mjs — C1041e THE TERMINALS SHEET: its own spreadsheet, one COLUMN per terminal APP (Rio, WezTerm,
// iTerm, Kitty, Terminal, VS Code, Cursor, Alacritty), the sessions inside each app stacked newest first, each in a seven-row box (C1052 added KEPT?).
// Operator 2026-10-20, verbatim: "columns for every single terminal that we use and Rose for the past present in future and different
// kinds of comments … when something changes there I want to be executed and updated" · "we were probably better off doing individual
// spreadsheets for this" · "the columns be the actual terminal apps R01 is Rio and then you can name the session separately … treat all
// the sessions inside of one terminal as the box that they're in" · "it's not just how many commits … optimize explainability
// readability … scanability it has to give the signal without having to dive deep into it … the load-bearing has to be upfront".
//
// LLM-FREE. The app is read off the live process (session-focus.mjs terminalOf: __CFBundleIdentifier, the app that spawned it); a
// closed session has no process, so its app is DESIGNATED by its name prefix (ro → Rio, wo → WezTerm) and marked so. Each box:
//   SESSION   name · id8 — the one-glyph status: ● working · ◆ waiting on you (its last line asks you) · ○ at rest · ✕ closed
//   ON        his last real ask (relays, hook feedback, system text dropped), cut at a whole word
//   DID       its latest commit in plain words (type(scope): and row ids stripped), +N more
//   NEXT      what it says comes next, its own words
//   YOU (fill)          his instruction; board-watch hands it to THIS session and writes back
//   YOUR LAST           what happened to his last cell: handed off → commits since
//   SUMMARY             C1060: one line, DID and NEXT read off the record together — what it did and what it owes, no model
//   node scripts/ops/board-terminals.mjs            print the sheet
//   node scripts/ops/board-terminals.mjs --write    write it to Drive (created in the board folder once; id in board-drive.json sheets)
// Port row: presentation off records — stays node (CLAUDE.md MAXIMISE RUST: transport/orchestration).
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readNd = (p) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
// C1052: KEPT? is the prior meeting's note — the session's last NEXT before this one, held against git (board-promises.mjs).
export const BOX = ['SESSION', 'ON', 'KEPT?', 'DID', 'NEXT', 'YOU (fill)', 'YOUR LAST', 'SUMMARY'];
export const SLOTS = 3;
// Prefix → app, the same table session-focus.mjs names rooms by (longest first, so `cu` is never read as `c`).
const PREFIX_APP = [['vs', 'VS Code'], ['cu', 'Cursor'], ['i', 'iTerm'], ['k', 'Kitty'], ['t', 'Terminal'], ['r', 'Rio'], ['w', 'WezTerm'], ['a', 'Alacritty'], ['c', 'Cursor'], ['v', 'VS Code']];

// A whole-word cut: never a broken word, an ellipsis only when something was cut.
export const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n).replace(/\s+\S*$/, ''); return (c || t.slice(0, n)) + '…'; };
export function appOf(s) {
  if (s.live && s.terminal) return { app: s.terminal, designated: false };
  const n = String(s.liveName || s.title || '').toLowerCase();
  for (const [p, app] of PREFIX_APP) if (new RegExp(`^${p}[a-z]{0,2}\\d`).test(n)) return { app, designated: true };
  return { app: 'Unplaced', designated: true };
}
// His own words only: a relay from another session, hook feedback, a system or tool line is not what he asked.
export const isHisAsk = (t) => !!t && !/^\s*(Another Claude session sent a message|Stop hook feedback|<|\[|Caveat:|Error:)/.test(t);
// A commit subject in plain words: "feat(board): C1041e the Terminals tab — a column…" → "the Terminals tab".
export const plainSubject = (s) => String(s || '').replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/^(C\d+[a-z0-9.]*\s*[—:-]?\s*)+/i, '').split(/\s+—\s+/)[0];

export function statusOf(s, next) {
  if (!s.live) return '✕ closed';
  if (s.status === 'working' || s.status === 'busy') return '● working';
  if (/\?\s*$/.test(String(next || '').trim())) return '◆ waiting on you';
  return `○ at rest ${s.minutesAgo < 60 ? `${s.minutesAgo} min` : `${Math.round(s.minutesAgo / 60)} h`}`;
}

// sessions: session-focus records · next: Map id8 → its own last words · did: Map id8 → { n, subject } · mail: board-mailbox rows ·
// commitsAfter(id8, at) → count. Returns the sheet as rows.
export function terminalsSheet({ sessions, next = new Map(), did = new Map(), kept = new Map(), mail = [], commitsAfter = () => 0, slots = SLOTS }) {
  const byApp = new Map();
  for (const s of sessions) { const a = appOf(s); (byApp.get(a.app) || byApp.set(a.app, []).get(a.app)).push({ ...s, designated: a.designated }); }
  const apps = [...byApp.entries()].map(([app, ss]) => [app, ss.sort((x, y) => String(y.lastActive).localeCompare(String(x.lastActive)))])
    .sort((x, y) => String(y[1][0].lastActive).localeCompare(String(x[1][0].lastActive)));
  const rows = [['', ...apps.map(([app, ss]) => `${app} — ${ss.filter((s) => s.live).length} live`)]];
  for (let k = 0; k < slots; k++) {
    const cell = (label) => apps.map(([, ss]) => { const s = ss[k]; if (!s) return ''; const id8 = s.id.slice(0, 8); const nx = next.get(id8) || '';
      if (label === 'SESSION') return `${s.liveName || s.title || 'unnamed'} · ${id8} — ${statusOf(s, nx)}${s.designated && s.live === false ? ' · app by name' : ''}`;
      if (label === 'ON') { const a = (Array.isArray(s.last) ? s.last : []).filter(isHisAsk).slice(-1)[0] || (isHisAsk(s.first) ? s.first : ''); return a ? cut(a, 110) : '—'; }
      if (label === 'DID') { const d = did.get(id8); return d ? `${cut(plainSubject(d.subject), 90)}${d.n > 1 ? ` (+${d.n - 1} more)` : ''}` : 'no commit'; }
      if (label === 'NEXT') return nx ? cut(nx, 110) : '—';
      if (label === 'KEPT?') return kept.get(id8) || '—';
      if (label === 'YOU (fill)') return '';
      if (label === 'SUMMARY') { const d = did.get(id8); return `did: ${d ? cut(plainSubject(d.subject), 60) : 'no commit'} · owes: ${nx ? cut(nx, 60) : 'nothing stated'}`; }
      const m = mail.filter((x) => x.tab === 'Terminals' && x.id === id8).slice(-1)[0];
      if (!m) return '—'; const n = commitsAfter(id8, m.at);
      return `"${cut(m.value, 50)}" → ${m.ok === false ? 'hand-off failed' : `handed off ${String(m.at).slice(11, 16)}`} · ${n ? `${n} commit(s) since` : 'nothing yet'}`; });
    for (const label of BOX) rows.push([`${k + 1} · ${label}`, ...cell(label)]);
  }
  rows.push([], ['', '● working · ◆ waiting on you · ○ at rest · ✕ closed — newest session on top in each app · type in a YOU row; within 5 min it is handed to that session and YOUR LAST shows what happened']);
  return rows;
}

// The reader: a non-empty "k · YOU (fill)" cell belongs to the session named in the "k · SESSION" cell of its column.
export function filledFromColumns(tab, rows) {
  const out = [];
  rows.forEach((r, ri) => {
    const m = /^(\d+) · YOU \(fill\)$/.exec(String((r || [])[0] || '')); if (!m) return;
    const sr = rows.find((x) => x && x[0] === `${m[1]} · SESSION`) || [];
    for (let ci = 1; ci < r.length; ci++) {
      const v = String(r[ci] ?? '').trim(); if (!v) continue;
      const s = /^(\S+) · ([0-9a-f]{8}) —/.exec(String(sr[ci] || '')); if (!s) continue;
      out.push({ tab, id: s[2], field: 'INSTRUCTION', value: v, terminal: s[1] });
    }
  });
  return out;
}
// A rewrite carries a typed cell to wherever that session's YOU row now sits, until the mailbox shows the hand-off.
export function carryColumnFills(rows, live, handed) {
  for (const c of filledFromColumns('Terminals', live)) {
    if (handed.has(`${c.id}|${c.field}|${c.value}`)) continue;
    let placed = false;
    rows.forEach((r) => { const m = /^(\d+) · SESSION$/.exec(String((r || [])[0] || '')); if (!m) return;
      r.forEach((v, ci) => { if (ci && String(v).includes(` · ${c.id} —`)) { const yr = rows.find((x) => x && x[0] === `${m[1]} · YOU (fill)`); if (yr) { yr[ci] = c.value; placed = true; } } }); });
    if (!placed) rows.push([`(kept for ${c.terminal} · ${c.id})`, c.value]);
  }
  return rows;
}

export async function compose() {
  const { focus } = await import('./session-focus.mjs');
  const { compose: nowCompose, commitsBySession } = await import('./board-now.mjs');
  const f = focus({ hours: 48 }); const sessions = (f.sessions || f).filter((s) => s && s.id);
  const N = nowCompose(); const h = N[0]; const fi = h.indexOf('FUTURE — what it says comes next (its own words)');
  const next = new Map(N.slice(1).filter((r) => r && r[0]).map((r) => [String(r[0]), String(r[fi] || '')]));
  const bySess = commitsBySession({ since: Date.now() - 3 * 864e5 }); const did = new Map();
  for (const [sid, shas] of bySess) {
    const real = (() => { try { return execFileSync('git', ['log', '--no-walk=unsorted', '--format=%ct\t%s', ...shas], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.split('\t')).filter(([, s]) => !/^chore\((commit-page|delegation-qc)\)/.test(s)); } catch { return []; } })();
    if (real.length) { real.sort((a, b) => b[0] - a[0]); did.set(sid.slice(0, 8), { n: real.length, subject: real[0][1] }); }
  }
  const ledger = readNd('.thetacog/commit-session.ndjson');
  const P = await import('./board-promises.mjs'); P.recordPromises(P.atRest(sessions, next)); const kept = new Map(sessions.map((s) => [s.id.slice(0, 8), P.lastPromiseLine(s.id.slice(0, 8))]));
  return terminalsSheet({ sessions, next, did, kept, mail: readNd('data/vna/board-mailbox.ndjson'),
    commitsAfter: (id8, at) => ledger.filter((r) => String(r.session || '').startsWith(id8) && r.ts > at).length });
}

export async function write() {
  const { rcloneToken } = await import('./board-comments.mjs');
  const { bookXlsx } = await import('./board-book.mjs'); const { readXlsx } = await import('./board.mjs');
  const t = rcloneToken(); if (!t.token) return { ok: false, why: t.why };
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // Drive answers back-to-back uploads with 403/429 (its rate limit, measured 1 in 3 runs); wait and retry, as board-watch's call does.
  const call = async (url, opt = {}, tries = 4) => { const r = await fetch(url, { ...opt, headers: { authorization: `Bearer ${t.token}`, ...(opt.headers || {}) } });
    if ((r.status === 403 || r.status === 429) && tries > 1) { await new Promise((ok) => setTimeout(ok, 20e3)); return call(url, opt, tries - 1); }
    if (!r.ok) throw new Error(`${r.status} ${url}`); return r; };
  const df = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(df, 'utf8'));
  let id = (j.sheets || {}).Terminals;
  if (!id) {
    id = (await (await call('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Terminals — every terminal app, its sessions, your instruction cell', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json()).id;
    j.sheets = { Terminals: id, ...(j.sheets || {}) }; writeFileSync(df, JSON.stringify(j, null, 2) + '\n');
  }
  const live = join(tmpdir(), `terminals-live-${id}.xlsx`);
  // A sheet created a moment ago exports nothing readable yet: it holds no typed cell, so an empty read is the true one.
  let L = []; try { writeFileSync(live, Buffer.from(await (await call(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(XLSX)}`)).arrayBuffer())); L = Object.values(readXlsx(live))[0] || []; } catch { L = []; } rmSync(live, { force: true });
  const rows = carryColumnFills(await compose(), L, new Set(readNd('data/vna/board-mailbox.ndjson').map((m) => `${m.id}|${m.field}|${m.value}`)));
  const out = bookXlsx([['Terminals', rows]], join(tmpdir(), `terminals-${id}.xlsx`));
  await call(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'content-type': XLSX }, body: readFileSync(out) });
  rmSync(out, { force: true });
  return { ok: true, id, apps: rows[0].length - 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) { const r = await write(); console.log(r.ok ? `✓ terminals: ${r.apps} app column(s) · https://docs.google.com/spreadsheets/d/${r.id}/edit` : `✗ terminals: ${r.why}`); process.exit(r.ok ? 0 : 1); }
  for (const r of await compose()) console.log((r || []).map((v) => cut(v, 34).padEnd(34)).join(' | '));
}
