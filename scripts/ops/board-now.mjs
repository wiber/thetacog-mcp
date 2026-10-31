#!/usr/bin/env node
// scripts/ops/board-now.mjs — THE NOW SHEET: one grid, one row per terminal, rewritten each time a terminal goes to rest.
// Operator 2026-10-19, verbatim: "we need a single sheet with a grid we update when a terminal goes to rest made to make sense of the
// current state for me" · "all terminals, prior, present, future, comment" · "spec rows, projects,".
//
// A row per terminal (every named session, and every session that committed, in the last --days, default 3), working ones first:
//   TERMINAL · STATE · PROJECTS (what its commits touched) · SPEC ROWS (the row ids in its commits and live claims)
//   PRIOR   — what it did: its commits, newest first (.thetacog/commit-session.ndjson joins sha → session)
//   PRESENT — what it holds and what it was last asked: its live WIP claims, your last words to it
//   FUTURE  — what it says comes next: the sentences of its last reply that name what is left, waiting or next (its own words)
//   COMMENT (fill) — yours; carried across every rewrite by the terminal id (board-sheets-write.mjs mergeFills).
// PRIOR, SPEC ROWS, PROJECTS and the claims are read off the record; PRESENT's ask is your own text; FUTURE is the terminal's own
// account, labelled as such (AXIOM 1 W: a process's account of itself is not a receipt — the commits beside it are).
//
//   node scripts/ops/board-now.mjs --print           the grid to stdout, no network
//   node scripts/ops/board-now.mjs                   write the Now sheet (creates it in the board folder on first run)
//   node scripts/ops/board-now.mjs --rest <session>  the Stop-hook door: ledger the rest, then one debounced write (≥ 60 s apart)
// Port row: transport over records (transcripts, git, ledgers) — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TRANSCRIPTS = join(homedir(), '.claude/projects/-Users-thetacoach-GitHub-thetadrivencoach');
export const NOW_HEAD = ['ID', 'TERMINAL', 'STATE', 'PROJECTS', 'SPEC ROWS', 'PRIOR — what it did', 'PRESENT — what it holds and was asked', 'FUTURE — what it says comes next (its own words)', 'COMMENT (fill)'];
const RESTS = 'out/board/now-rests.ndjson';
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const hhmm = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function tail(file, bytes = 1 << 20) {
  const size = statSync(file).size; const n = Math.min(size, bytes); const buf = Buffer.alloc(n);
  const fd = openSync(file, 'r'); readSync(fd, buf, 0, n, size - n); closeSync(fd);
  return buf.toString('utf8').split('\n').slice(size > n ? 1 : 0).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const textOf = (m) => { const c = m && m.content; if (typeof c === 'string') return c; return Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : ''; };
// His words: a user turn that is typed text, not a tool result, a hook's context, or a command echo.
export const isHisText = (t) => !!t && !/^\s*</.test(t) && !/^\[(SYSTEM|Request interrupted)/.test(t) && !/^Caveat:/.test(t);
// The sentences of a reply that name what is left: the terminal's own forward-looking account.
const FORWARD = /\b(next|left|still|waits?|waiting|remain|pending|unbuilt|not (yet|built)|blocked|once|after that|will|to do|todo|open)\b/i;
export function futureOf(reply) {
  const sents = String(reply || '').replace(/\*\*/g, '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/^[-*•\s]+/, '').trim()).filter((x) => x.length > 12);
  const fwd = sents.filter((x) => FORWARD.test(x));
  return clip((fwd.length ? fwd.slice(-3) : sents.slice(-1)).join(' · '), 600);
}

export function sessions({ days = 3, now = Date.now(), dir = TRANSCRIPTS, committed = new Set() } = {}) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    const p = join(dir, f); const st = statSync(p); if (now - st.mtimeMs > days * 864e5) continue;
    const id = f.replace(/\.jsonl$/, ''); const rows = tail(p);
    let name = ''; let ask = ''; let reply = ''; let lastType = '';
    for (const r of rows) {
      if (r.type === 'custom-title' && r.customTitle) name = r.customTitle;
      if (r.agentName && !name) name = r.agentName;
      if (r.type === 'user' && !r.isMeta) { const t = textOf(r.message); if (isHisText(t)) ask = t; }
      if (r.type === 'assistant') { const t = textOf(r.message); if (t.trim()) reply = t; }
      if (r.type === 'user' || r.type === 'assistant') lastType = r.type;
    }
    if (!name && !committed.has(id)) continue;   // a headless run with nothing on the record is not a terminal he steers
    const age = now - st.mtimeMs;
    const state = age < 120e3 && lastType !== 'assistant' ? 'WORKING' : age < 6 * 3600e3 ? `AT REST since ${hhmm(st.mtimeMs)}` : `PRIOR — last seen ${hhmm(st.mtimeMs)}`;
    out.push({ id, name: name || `(unnamed ${id.slice(0, 6)})`, mtime: st.mtimeMs, state, ask, reply });
  }
  return out;
}

export function commitsBySession({ ledger = resolve(REPO, '.thetacog/commit-session.ndjson'), since = Date.now() - 3 * 864e5 } = {}) {
  const m = new Map();
  if (!existsSync(ledger)) return m;
  for (const l of readFileSync(ledger, 'utf8').split('\n')) { let r; try { r = JSON.parse(l); } catch { continue; } if (!r || !r.session || Date.parse(r.ts) < since) continue; (m.get(r.session) || m.set(r.session, []).get(r.session)).push(r.sha); }
  return m;
}

export function compose({ days = 3 } = {}) {
  const bySess = commitsBySession({ since: Date.now() - days * 864e5 });
  const all = [...new Set([...bySess.values()].flat())];
  const info = new Map();
  if (all.length) {
    const log = sh('git', ['log', '--no-walk=unsorted', '--name-only', '--format=@@%H\t%ad\t%s', '--date=format-local:%a %H:%M', ...all]);
    let cur = null;
    for (const l of log.split('\n')) { if (l.startsWith('@@')) { const [h, d, ...s] = l.slice(2).split('\t'); cur = { sha: h, date: d, subject: s.join('\t'), files: [] }; info.set(h, cur); } else if (l.trim() && cur) cur.files.push(l.trim()); }
  }
  let projects = [];
  try { projects = JSON.parse(sh(process.execPath, ['-e', "import('./scripts/ops/board.mjs').then(m=>console.log(JSON.stringify([...m.SURFACES,...m.packageProjects()].map(p=>({name:p.name,paths:p.paths})))))"]) || '[]'); } catch { projects = []; }
  const projectOf = (f) => { let best = null; let len = -1; for (const p of projects) for (const pre of p.paths) if (f.startsWith(pre) && pre.length > len) { best = p.name; len = pre.length; } return best; };
  const claims = sh(process.execPath, ['scripts/ops/wip.mjs', 'list']).split('\n').map((l) => l.match(/^✋ LIVE\s+(\S+) — (\S+) \(pid \d+, [^)]+\) — (.*)$/)).filter(Boolean).map((m) => ({ path: m[1], session: m[2], note: m[3] }));
  const S = sessions({ days, committed: new Set(bySess.keys()) });
  const ids = (t) => [...new Set(String(t).match(/\bC\d{2,4}[a-z]?\d*\b/g) || [])];
  const rows = S.map((s) => {
    const cs = (bySess.get(s.id) || []).map((h) => info.get(h)).filter(Boolean).reverse();
    const mine = claims.filter((c) => c.session === s.id || s.id.startsWith(c.session));
    const proj = new Map(); for (const c of cs) for (const f of c.files) { const p = projectOf(f); if (p) proj.set(p, (proj.get(p) || 0) + 1); }
    const prior = cs.length ? `${cs.length} commit(s): ${cs.slice(0, 4).map((c) => `${c.date} — ${c.subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '')}`).join(' · ')}` : 'no commit on the record';
    const holds = mine.length ? `holds ${mine.length} path(s): ${clip([...new Set(mine.map((c) => c.note))].join(' · '), 200)}` : 'holds nothing';
    const present = `${holds}${s.ask ? ` · you last asked: "${clip(s.ask, 300)}"` : ''}`;
    return { working: s.state === 'WORKING', mtime: s.mtime, row: [s.id.slice(0, 8), s.name, s.state, [...proj].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p).join(' · ') || '—',
      ids([...cs.map((c) => c.subject), ...mine.map((c) => c.note)].join(' ')).slice(0, 12).join(' ') || '—', clip(prior, 900), present, s.reply ? futureOf(s.reply) : 'UNMEASURED — no reply on the record', ''] };
  }).sort((a, b) => Number(b.working) - Number(a.working) || b.mtime - a.mtime).map((x) => x.row);
  return [NOW_HEAD, ...rows, [], [`rewritten ${new Date().toLocaleString('en-GB')} by node scripts/ops/board-now.mjs — on every terminal's rest · ${rows.length} terminal(s) seen in the last ${days} day(s) · PRIOR, PROJECTS, SPEC ROWS read off git + the commit-session ledger; FUTURE is the terminal's own words`]];
}

async function sheetId(token) {
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  if (j.sheets.Now) return j.sheets.Now;
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '0 · Now — every terminal, prior · present · future', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) });
  const r = await res.json(); if (!r.id) throw new Error(`create failed: ${JSON.stringify(r).slice(0, 200)}`);
  j.sheets = { Now: r.id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  return r.id;
}

export async function writeNow() {
  const { rcloneToken } = await import('./board-comments.mjs');
  const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = rcloneToken(); if (!t.token) return { ok: false, why: t.why };
  const id = await sheetId(t.token);
  const r = await writeSheet(t.token, id, compose(), { name: 'Now' });
  return { ok: !r.refused, id, ...r };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.includes('--print')) { for (const r of compose()) console.log(r.map((c) => clip(c, 140)).join(' │ ')); process.exit(0); }
  if (a.includes('--rest')) {
    // The Stop-hook door: ledger the rest, then at most one write a minute. A rest inside the window leaves a pending mark; the one
    // sleeper already waiting writes after the window with the freshest state, so the last rest is never lost.
    mkdirSync(resolve(REPO, 'out/board'), { recursive: true });
    appendFileSync(resolve(REPO, RESTS), JSON.stringify({ at: new Date().toISOString(), session: a[a.indexOf('--rest') + 1] || '' }) + '\n');
    const lock = resolve(REPO, 'out/board/now.lock'); const last = resolve(REPO, 'out/board/now.last');
    if (existsSync(lock)) { const pid = Number(readFileSync(lock, 'utf8')); try { process.kill(pid, 0); process.exit(0); } catch { /* stale lock: take it */ } }
    writeFileSync(lock, String(process.pid));
    const since = existsSync(last) ? Date.now() - Number(readFileSync(last, 'utf8')) : Infinity;
    if (since < 60e3) await new Promise((r) => setTimeout(r, 60e3 - since));
    // The one canonical view rides the same rest: the book (Decide · Now · Tasks · Questions) is rewritten after the Now sheet.
    try { const r = await writeNow(); try { await (await import('./board-book.mjs')).writeBook(); } catch { /* the Now sheet still landed */ } writeFileSync(last, String(Date.now())); appendFileSync(resolve(REPO, RESTS), JSON.stringify({ at: new Date().toISOString(), wrote: r.ok, rows: r.newRows, why: r.why || r.refused || null }) + '\n'); }
    finally { try { writeFileSync(lock, ''); } catch { /* ignore */ } }
    process.exit(0);
  }
  const r = await writeNow();
  console.log(r.ok ? `✓ Now: ${r.newRows} rows · ${r.keptFills} comment(s) kept · read back ${r.readBackRows}/${r.expectRows} rows · https://docs.google.com/spreadsheets/d/${r.id}/edit` : `✗ Now: ${r.why || 'refused'}`);
  process.exit(r.ok ? 0 : 1);
}
