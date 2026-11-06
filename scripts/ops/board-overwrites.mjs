#!/usr/bin/env node
// scripts/ops/board-overwrites.mjs — C1035: AN OVERWRITTEN CELL IS A DISPATCH.
// Operator 2026-10-19, verbatim: "the ability to detect when I just override a cell that means I'm putting a dispatch into a
// particular comment for a particular room for example, something like that this is impact actually a huge issue because if
// we've been running the steers on sludge because I haven't been expecting all of them".
//
// A board cell the board DERIVED (a head, a WHAT IT NEEDS, a priority, a project — any header that is not "(fill)") carries a
// value no human typed. When the live sheet shows something else there on the next pull, that is not a typed answer (C1020a's
// mergeFills already pins those by their "(fill)" header) — it is an instruction to the room that owns the row, dispatched
// through bifurcate exactly once per (sheet, row, column, value), AUTHOR-GATED like a comment (C1020o): only an edit the Drive
// revision history attributes to his account dispatches; anything else is SHOWN and never run.
// STALE vs OVERWRITE: a live value equal to what the board last generated for that cell is staleness (the sheet has not been
// rewritten since the board's own derived value moved on) and is never a dispatch — board-generated.json holds that snapshot,
// overwritten each write (AXIOM 1: a cache the generator owns, never hand-edited, so overwriting it is not losing state).
// THE PIN: an EXECUTED overwrite with no answer yet is never silently reverted by the next rewrite — pinOverwrites puts his
// value back into the composed rows the same way mergeFills pins a typed "(fill)" cell, until board-overwrite-replies.ndjson
// carries a reply for that exact (sheet, row, field, value).
// THE READ GAP, same shape as C1020o: the Drive CSV export (exportGrid) that writeSheet reads carries no author — only Drive
// API v3 revisions.list does, and knowing WHO last touched a cell (not just the whole file) needs a per-cell diff this
// machine's rclone scope has not been asked to do yet. `pull` is UNMEASURED until that reader exists; the pure functions below
// are the mechanism and are exercised directly by the guard.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHeaderRow } from './board-layout.mjs';
import { OPERATOR_EMAILS, roomFor, bifurcate, rcloneToken } from './board-comments.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = 'data/vna/board-overwrites.ndjson';
export const REPLIES = 'data/vna/board-overwrite-replies.ndjson';
export const GENERATED = 'data/vna/board-generated.json';

const s = (v) => String(v ?? '').trim();
const isFill = (h) => /\(fill\)\s*$/.test(s(h));
const readNd = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// Every non-"(fill)" cell a grid carries, keyed "<row id>\u0000<header text>" — the board's own derived columns, never ID.
export function derivedCells(rows) {
  const out = new Map(); let head = null;
  for (const r of rows) {
    if (isHeaderRow(r)) { head = r; continue; }
    if (!head || !Array.isArray(r) || !s(r[0])) continue;
    head.forEach((h, c) => { if (s(h) && !isFill(h) && !/^ID\b/i.test(s(h))) out.set(`${s(r[0])}\u0000${s(h)}`, s(r[c])); });
  }
  return out;
}

// The board's own cache of what it last wrote, read off GENERATED — overwritten whole each successful write, so this is the
// generator's bookkeeping, never a place his edits live (FILE MANAGEMENT / state-in-a-generated-file).
export function readGenerated(sheet, { file = resolve(REPO, GENERATED) } = {}) {
  if (!existsSync(file)) return new Map();
  let all = {}; try { all = JSON.parse(readFileSync(file, 'utf8')); } catch { return new Map(); }
  return new Map(Object.entries(all[sheet] || {}));
}
export function writeGenerated(sheet, cells, { file = resolve(REPO, GENERATED) } = {}) {
  let all = {}; if (existsSync(file)) { try { all = JSON.parse(readFileSync(file, 'utf8')); } catch { /* start fresh */ } }
  all[sheet] = Object.fromEntries(cells instanceof Map ? cells : Object.entries(cells));
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}

// A cell is an overwrite when the live value is neither what the board would generate now NOR what it generated last time —
// a value the board never produced, sitting on a column it derives. previous is readGenerated(sheet)'s Map; omit it only in a
// test that has no history to compare against (then any mismatch with the fresh composed value counts).
export function detectOverwrites(composed, live, { sheet, previous = new Map() } = {}) {
  const now = derivedCells(composed); const current = derivedCells(live); const out = [];
  for (const [k, hisValue] of current) {
    if (!hisValue) continue;
    const generatedValue = now.get(k); if (generatedValue === undefined) continue;
    if (hisValue === generatedValue) continue;
    const lastGenerated = previous.has(k) ? previous.get(k) : generatedValue;
    if (hisValue === lastGenerated) continue;
    const [row, field] = k.split('\u0000');
    out.push({ sheet, row, field, generatedValue, hisValue });
  }
  return out;
}

// Takes either a fresh candidate ({ hisValue }) or a ledger row read back off disk ({ value }) — same identity either way.
export const overwriteKey = (o) => `${o.sheet}\u0000${o.row}\u0000${o.field}\u0000${o.hisValue ?? o.value}`;

// Who may dispatch from an overwrite. Identity is the Drive revision's last-modifying account, never a displayed name — the
// same gate C1020o puts on a comment's author, applied to a cell edit instead of a comment.
export function overwriteVerdict(user) {
  const a = user || {};
  if (a.me === true) return { execute: true, why: 'revision author.me' };
  const email = s(a.emailAddress).toLowerCase();
  if (email && OPERATOR_EMAILS.includes(email)) return { execute: true, why: `revision author ${email}` };
  if (email) return { execute: false, why: `revision author ${email} is not the operator — shown, never executed` };
  return { execute: false, why: 'revision author not verifiable (no email on the revision) — shown, never executed' };
}

// Each (sheet, row, field, value) is decided once. revisionAuthor is the Drive account that made the live sheet's latest
// revision (null when unread — then every candidate is SHOWN, never executed, same as C1020o's bare display name).
export function ingest(overwrites, { ledger = resolve(REPO, LEDGER), owners = {}, dispatch = bifurcate, revisionAuthor = null, dry = false, at = new Date().toISOString() } = {}) {
  const seen = new Set(readNd(ledger).map(overwriteKey));
  const out = [];
  for (const o of overwrites || []) {
    const k = overwriteKey(o); if (seen.has(k)) continue;
    const v = overwriteVerdict(revisionAuthor);
    const room = roomFor(o.row, { owners });
    const rec = { at, sheet: o.sheet, row: o.row, field: o.field, generated: o.generatedValue, value: o.hisValue, room, verdict: v.execute ? 'EXECUTED' : 'SHOWN', why: v.why };
    if (v.execute && !dry) {
      const d = dispatch({ room, action: `/steer ${o.field} on ${o.row} → ${o.hisValue}`, context: `the operator overwrote the derived cell "${o.field}" on row ${o.row} (sheet "${o.sheet}"), replacing "${o.generatedValue}" with "${o.hisValue}" (C1035); reply so the pin can lift` });
      rec.bf = d.bf || null; rec.dispatch = d.ok ? 'queued' : `not queued — ${d.why}`;
    }
    if (!dry) appendFileSync(ledger, `${JSON.stringify(rec)}\n`);
    seen.add(k); out.push(rec);
  }
  return out;
}

// A reply closes the pin: the room answered (sheet, row, field, value) and the next rewrite may let the composed value back in.
export function answer(o, { replies = resolve(REPO, REPLIES), at = new Date().toISOString() } = {}) {
  appendFileSync(replies, `${JSON.stringify({ at, sheet: o.sheet, row: o.row, field: o.field, value: o.value })}\n`);
}

// Every EXECUTED overwrite with no reply yet, on the named sheet, keyed "<row>\u0000<field>" -> his value — the row carries
// it until the room answers (C1020a's "never dropped" applied to a dispatch instead of a typed cell). Keyed without the
// sheet so pinOverwrites can match it straight against a single sheet's own rows.
export function openOverwrites({ sheet, ledger = resolve(REPO, LEDGER), replies = resolve(REPO, REPLIES) } = {}) {
  const answered = new Set(readNd(replies).map((r) => `${r.sheet}\u0000${r.row}\u0000${r.field}\u0000${r.value}`));
  const out = new Map();
  for (const r of readNd(ledger)) {
    if (r.verdict !== 'EXECUTED' || (sheet && r.sheet !== sheet)) continue;
    const full = `${r.sheet}\u0000${r.row}\u0000${r.field}\u0000${r.value}`;
    if (answered.has(full)) continue;
    out.set(`${r.row}\u0000${r.field}`, r.value);
  }
  return out;
}

// Put every open overwrite back into the composed rows, the same way mergeFills pins a typed "(fill)" cell — called AFTER
// mergeFills so a pinned dispatch cell is never silently reverted by this rewrite.
export function pinOverwrites(rows, open) {
  if (!open || !open.size) return { rows, pinned: 0 };
  const out = rows.map((r) => (Array.isArray(r) ? [...r] : r)); let head = null; let pinned = 0;
  for (const r of out) {
    if (isHeaderRow(r)) { head = r; continue; }
    if (!head || !s(r[0])) continue;
    head.forEach((h, c) => { const k = `${r[0]}\u0000${s(h)}`; if (open.has(k)) { while (r.length <= c) r.push(''); r[c] = open.get(k); pinned++; } });
  }
  return { rows: out, pinned };
}

export async function fetchLatestRevision(fileId, token, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,lastModifyingUser)&pageSize=1000`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return { why: `Drive API ${res.status} on revisions.list` };
  const revs = (await res.json()).revisions || [];
  return revs.length ? { user: revs[revs.length - 1].lastModifyingUser || {} } : { why: 'no revisions returned' };
}

const boardSheets = () => { const f = resolve(REPO, 'data/vna/board-drive.json'); return existsSync(f) ? Object.entries(JSON.parse(readFileSync(f, 'utf8')).sheets || {}) : []; };
const ownersMap = () => { const o = {}; const df = resolve(REPO, 'data/vna/board-decisions.json'); if (existsSync(df)) for (const d of JSON.parse(readFileSync(df, 'utf8')).decisions || []) o[d.id] = d.owner; return o; };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'pull' || cmd === undefined) {
    const t = rcloneToken();
    if (!t.token) { console.log(`overwrites pull: UNMEASURED — ${t.why}`); process.exit(0); }
    const board = await import('./board.mjs');
    const b = board.buildBoard({ place: true });
    const T = new Map(await board.allTabs(b));
    const { exportGrid } = await import('./board-sheets-write.mjs');
    const owners = ownersMap(); let n = 0; let ex = 0;
    for (const [name, id] of boardSheets()) {
      if (!T.has(name)) continue;
      const live = await exportGrid(t.token, id);
      const rev = await fetchLatestRevision(id, t.token);
      if (rev.why) { console.log(`overwrites pull · ${name}: revision UNMEASURED — ${rev.why}`); continue; }
      const found = detectOverwrites(T.get(name), live, { sheet: name, previous: readGenerated(name) });
      const out = ingest(found, { owners, revisionAuthor: rev.user });
      n += out.length; ex += out.filter((r) => r.verdict === 'EXECUTED').length;
    }
    console.log(`overwrites pull · ${n} new · ${ex} executed`);
    process.exit(0);
  }
  console.error('usage: board-overwrites.mjs pull');
  process.exit(2);
}
