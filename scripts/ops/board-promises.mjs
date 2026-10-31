#!/usr/bin/env node
// scripts/ops/board-promises.mjs — C1052 THE PROMISES LEDGER (monologue M2 "Who promised me what, and is it late?"). Operator 2026-10-20,
// verbatim: "I just keep better notes of the meetings … they can't forget what they promised to do in the last meeting". The ratchet is
// the prior meeting's note held against the present: T_prev.PROMISED beside T_now.DELIVERED, read off records the promiser did not write.
//
// LLM-FREE. Two sources today, each promise one row with its source line and a due time:
//   ROOM      a hand-off from his cell (room-bifurcations.json, from_room operator) — the room promised to do it. Kept = executed with a
//             run_commit; working = picked up; else open. Due = made + 24 h (no hand-off names a date yet; stated, one word vetoes it).
//   SESSION   a terminal session's NEXT, the words it says come next. Each new NEXT is appended to data/vna/board-promises.ndjson when the
//             Terminals sheet is composed. Kept = a commit by that session after the promise (.thetacog/commit-session.ndjson — git's
//             record, never the session's prose). Dropped = a newer NEXT replaced it before any commit. Due = made + 4 h.
//   PERSON    (C1052a) a promise a person made, or we made to them, in a meeting note, a mail or a WhatsApp line. An agent reads the note
//             (meaning) and appends one row to data/vna/board-promises-people.ndjson with the source line VERBATIM and a due date; a row
//             missing either is refused and counted, never listed. A later row with the same id and state KEPT or DROPPED closes it, with
//             its evidence; otherwise past its due date it reads LATE. node scripts/ops/board-promises.mjs add '<json>' is the one writer.
// What KEPT is sufficient for: the promiser delivered a commit (or an executed hand-off) after promising. NOT sufficient for: that the
// commit is the promised thing — that is an agent's reading, never this file's. Nothing here blocks a session; the row shows the delta.
// Promises older than WINDOW_DAYS and never kept are counted in the title line, not listed, so the live ones stay readable.
//   node scripts/ops/board-promises.mjs --print    the sheet to stdout
//   node scripts/ops/board-promises.mjs            write the Promises sheet (created in the board folder on first run)
// Port row: a reader over three ledgers that DECIDES kept/late — C1052r (port the state rule into the crate beside the walk) once green.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = 'data/vna/board-promises.ndjson';
export const SHEET = 'Promises';
export const TITLE = '02 · PROMISES — who promised what, by when, kept or late';
export const HEAD = ['STATE', 'WHO', 'WHAT THEY PROMISED', 'MADE', 'DUE', 'DELIVERED', 'SOURCE', 'YOUR NOTE (fill)'];
export const DUE_H = { room: 24, session: 4 };
export const WINDOW_DAYS = 14;
const H = 36e5;
const readNd = (p) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n).replace(/\s+\S*$/, ''); return (c || t.slice(0, n)) + '…'; };
export const hashOf = (s) => createHash('sha256').update(String(s).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
const iso = (ms) => new Date(ms).toISOString();

// SESSION source: the new promises in this pass — a NEXT whose words differ from that session's last recorded one.
export function newPromises(prior, next, at) {
  const last = new Map(); for (const p of prior) last.set(p.id8, p.hash);
  const out = [];
  for (const [id8, text] of next) { const t = String(text || '').trim(); if (!t || t === '—') continue; const h = hashOf(t); if (last.get(id8) !== h) out.push({ id8, text: t, hash: h, at }); }
  return out;
}
// A session's words while it works are thinking aloud; the words it ends a turn on are the promise. Only an at-rest session's NEXT is recorded.
export const atRest = (sessions, next) => new Map(sessions.filter((x) => x.live && !(x.status === 'working' || x.status === 'busy')).map((x) => x.id.slice(0, 8)).filter((k) => next.has(k)).map((k) => [k, next.get(k)]));
export function recordPromises(next, at = iso(Date.now())) {
  const add = newPromises(readNd(LEDGER), next, at);
  if (add.length) appendFileSync(resolve(REPO, LEDGER), add.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return add;
}

// The state of one session promise: commits = [{ session, ts, sha }], later = the next promise by the same session (or null).
export function sessionState(p, commits, later, now) {
  const made = Date.parse(p.at); const due = made + DUE_H.session * H;
  const c = commits.filter((x) => String(x.session || '').startsWith(p.id8) && Date.parse(x.ts) > made && (!later || Date.parse(x.ts) <= Date.parse(later.at)))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
  if (c) return { state: 'KEPT', delivered: `${c.sha.slice(0, 10)} · ${c.ts.slice(5, 16).replace('T', ' ')}`, due };
  if (later) return { state: 'DROPPED', delivered: `replaced ${later.at.slice(5, 16).replace('T', ' ')} with no commit`, due };
  return { state: now > due ? 'LATE' : 'OPEN', delivered: 'no commit yet', due };
}
// The state of one room hand-off: precedence executed > picked_up > bifurcations, by id.
export function roomState(b, now) {
  const made = Date.parse(b.created_at); const due = made + DUE_H.room * H;
  if (b._list === 'executed' && b.run_commit) return { state: 'KEPT', delivered: `${String(b.run_commit).slice(0, 10)} · ${clip(b.ran, 70)}`, due };
  if (b._list === 'executed') return { state: 'KEPT', delivered: clip(b.ran || 'executed, no commit named', 80), due };
  if (b.status === 'stuck') return { state: 'LATE', delivered: 'stuck', due };
  if (b._list === 'picked_up') return { state: now > due ? 'LATE' : 'WORKING', delivered: `picked up ${String(b.picked_up_at || '').slice(5, 16).replace('T', ' ')}`, due };
  return { state: now > due ? 'LATE' : 'OPEN', delivered: 'not picked up', due };
}
// C1052a — PERSON promises. p: { at, id, who, what, due 'YYYY-MM-DD', source: meeting|mail|whatsapp, source_ref, source_line, to? }
export const PEOPLE = 'data/vna/board-promises-people.ndjson';
export const PERSON_SOURCES = ['meeting', 'mail', 'whatsapp'];
export function personRowProblem(p) {
  if (!p || !p.id || !p.who || !p.what) return 'needs id, who and what';
  if (!PERSON_SOURCES.includes(p.source)) return `source must be one of ${PERSON_SOURCES.join(', ')}`;
  if (!String(p.source_line || '').trim()) return 'needs the source line, verbatim';
  if (!String(p.source_ref || '').trim()) return 'needs the source ref (file path, message id or chat + date)';
  if (!/^\d{4}-\d\d-\d\d$/.test(String(p.due || ''))) return 'needs a due date YYYY-MM-DD';
  return null;
}
// rows: the people ledger in order → [{ p, state, delivered, due }] for each promise id, plus how many rows were refused.
export function personStates(rows, now = Date.now()) {
  const made = new Map(); const close = new Map(); let refused = 0;
  for (const r of rows) { if (r.state) { if (made.has(r.id)) close.set(r.id, r); continue; } if (personRowProblem(r)) { refused++; continue; } if (!made.has(r.id)) made.set(r.id, r); }
  const out = [...made.values()].map((p) => { const due = Date.parse(`${p.due}T23:59:59Z`); const c = close.get(p.id);
    if (c) return { p, state: c.state === 'KEPT' ? 'KEPT' : 'DROPPED', delivered: clip(c.evidence || c.state, 100), due };
    return { p, state: now > due ? 'LATE' : 'OPEN', delivered: 'not yet', due }; });
  return { out, refused };
}
const RANK = { LATE: 0, DROPPED: 1, OPEN: 2, WORKING: 3, KEPT: 4 };

// rows: [{ state, who, what, made, due, delivered, source }] → late first, then by due (soonest first); kept last, newest kept first.
export function promisesGrid(rows, { expired = 0, now = Date.now() } = {}) {
  const live = rows;   // compose() holds the window; older unkept promises arrive counted as expired
  const sorted = [...live].sort((a, b) => RANK[a.state] - RANK[b.state] || (a.state === 'KEPT' ? b.made - a.made : a.due - b.due));
  const by = new Map(); for (const r of live) { const k = by.get(r.who) || { made: 0, kept: 0 }; k.made++; if (r.state === 'KEPT') k.kept++; by.set(r.who, k); }
  const say = [...by.entries()].sort((a, b) => b[1].made - a[1].made).slice(0, 8).map(([w, k]) => `${w} ${k.kept}/${k.made}`).join(' · ');
  const n = (s) => live.filter((r) => r.state === s).length;
  const grid = [[TITLE, `${n('LATE')} late · ${n('DROPPED')} dropped · ${n('OPEN') + n('WORKING')} open · ${n('KEPT')} kept (last ${WINDOW_DAYS} days) · ${expired} older never kept · kept/made: ${say}`], HEAD];
  const t = (ms) => iso(ms).slice(5, 16).replace('T', ' ');
  for (const r of sorted) grid.push([r.state, r.who, clip(r.what, 160), t(r.made), t(r.due), clip(r.delivered, 100), r.source, '']);
  return grid;
}

// A post-commit QC hand-off is the machine checking itself, not a promise made to him: it stays on its own queue.
export const isQc = (b) => /^QC:/.test(String(b.action || ''));
export function compose(now = Date.now()) {
  const rows = []; let expired = 0;
  let bf = {}; try { bf = JSON.parse(readFileSync(resolve(REPO, 'data/room-bifurcations.json'), 'utf8')); } catch { bf = {}; }
  const byId = new Map();
  for (const k of ['bifurcations', 'picked_up', 'executed']) for (const b of bf[k] || []) if (b && b.from_room === 'operator' && !isQc(b)) byId.set(b.id, { ...b, _list: k });
  for (const b of byId.values()) {
    const s = roomState(b, now); const made = Date.parse(b.created_at);
    if (now - made > WINDOW_DAYS * 864e5) { if (s.state !== 'KEPT') expired++; continue; }
    rows.push({ ...s, who: `room ${b.to_room}`, what: String(b.action || '').replace(/^His board cell — /, ''), made, source: `room-bifurcations.json ${b.id}` });
  }
  // C1052a: promises people made in meetings and messages, beside the rooms' and the sessions'.
  const P = personStates(readNd(PEOPLE), now); expired += 0;
  for (const x of P.out) rows.push({ state: x.state, due: x.due, delivered: x.delivered, who: x.p.who, what: x.p.what, made: Date.parse(x.p.at), source: `${x.p.source} · ${x.p.source_ref} · "${clip(x.p.source_line, 80)}"` });
  const commits = readNd('.thetacog/commit-session.ndjson'); const ps = readNd(LEDGER);
  ps.forEach((p, i) => {
    const later = ps.slice(i + 1).find((q) => q.id8 === p.id8) || null; const s = sessionState(p, commits, later, now); const made = Date.parse(p.at);
    if (now - made > WINDOW_DAYS * 864e5) { if (s.state !== 'KEPT') expired++; return; }
    rows.push({ ...s, who: `session ${p.id8}`, what: p.text, made, source: `${LEDGER} ${p.hash}` });
  });
  return { rows, expired, refused: P.refused, grid: promisesGrid(rows, { expired, now }) };
}
// The one-line ratchet a Terminals box shows: the session's last promise before its current NEXT, and what happened to it.
export function lastPromiseLine(id8, now = Date.now()) {
  const ps = readNd(LEDGER).filter((p) => p.id8 === id8); if (ps.length < 2) return ps.length ? `first note ${ps[0].at.slice(11, 16)} — nothing to hold it against yet` : '—';
  const p = ps.at(-2); const s = sessionState(p, readNd('.thetacog/commit-session.ndjson'), ps.at(-1), now);
  const mark = { KEPT: '✓ kept', DROPPED: '✗ dropped', LATE: '✗ late', OPEN: '… open' }[s.state];
  return `${mark} — "${clip(p.text, 60)}" (${p.at.slice(11, 16)}) → ${s.delivered}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // C1052a: the one writer for a person's promise — refuses a row without its verbatim source line or due date.
  if (process.argv[2] === 'add') { const p = { at: new Date().toISOString(), ...JSON.parse(process.argv[3] || '{}') }; const why = p.state ? null : personRowProblem(p);
    if (why) { console.log(`✗ refused — ${why}`); process.exit(1); } appendFileSync(resolve(REPO, PEOPLE), JSON.stringify(p) + '\n'); console.log(`✓ ${p.state || 'promise'} ${p.id} — ${p.who}`); process.exit(0); }
  const { grid } = compose();
  if (process.argv.includes('--print')) { for (const r of grid) console.log(r.slice(0, 6).map((c) => clip(c, 60)).join(' │ ')); process.exit(0); }
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = rcloneToken(); if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.sheets[SHEET];
  if (!id) {
    const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: TITLE, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    if (!r.id) { console.log(`✗ create failed: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); }
    id = r.id; j.sheets = { [SHEET]: id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  const r = await writeSheet(t.token, id, grid, { name: SHEET });
  console.log(r.refused ? `✗ refused — ${r.why}` : `✓ ${SHEET}: ${r.newRows} rows · ${r.keptFills} typed cell(s) kept · https://docs.google.com/spreadsheets/d/${id}/edit`);
  process.exit(r.refused ? 1 : 0);
}
