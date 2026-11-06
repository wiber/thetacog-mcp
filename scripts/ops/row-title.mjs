// scripts/ops/row-title.mjs — EVERY ROW ID TRAVELS WITH A TITLE. Operator 2026-11-05, verbatim: "never just show the steer number,
// always summarise into a reasonable title - as well in the sheet? or does that require a batch run, are we using ncd / etc to snip out of
// the transcript? it should help to put the title as useful context".
//
// ONE READER, never a second computation: every surface that prints a row id (the Steer · Compiled sheet and its tabs, the /sheet Asks
// sheet, steer.mjs's verify TICKED/STUCK lines and its close line, the asks ledger, the steer-compile txt's STEER block) asks this file
// for `C#### · <title>`.
//   (1) THE MODEL TITLE: the fifth field of the plain head (plain-heads.mjs WRITE, the same one Sonnet call, no extra model call), kept
//       only when the head is WRITTEN, passed the no-invention check, and was written off the row's current text (open or ticked form).
//   (2) THE FALLBACK, deterministic and LLM-free: strip the shared preamble (a chair decomposition's "… EACH ITEM ITS OWN ROW — ", a lead
//       clause siblings share before " — ", a research meta-spec's "(…§n): ", a leading "(tend: …)" tag), drop the trailing operator/chair
//       span, take the first clause, at most 8 words, never ending on a preposition, sentence case. A title is never blank.
// Port row: none of its own — a printed label over text the board already reads; it moves with the board composers when they port (MAXIMISE RUST).
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const HEADS_LEDGER = 'data/vna/board-heads.ndjson';
export const TITLE_SPECS = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'];
export const TITLE_MAX_WORDS = 8;
export const TITLE_MIN_WORDS = 3;
const sha = (t) => createHash('sha1').update(String(t || '').trim()).digest('hex').slice(0, 12);   // = board-priority.mjs textSha
const ID_RE = /^\s*-\s*\[[ xX]\]\s*(C\d+[a-z]?\d*)\b/;

// the row's body: no checkbox, id, guard clause, leading bookkeeping parentheticals, or trailing operator/chair span
export function rowBody(line) {
  let t = String(line || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^-\s*\[[ xX]\]\s*C\d+[a-z]?\d*\s*/, '').replace(/^C\d+[a-z]?\d*\s*[—–·:-]\s*/, '');
  for (;;) {   // leading tags, in any order: (guard: `…`) (tend: …) (declared as …)
    const n = t.replace(/^\(guard:\s*`[^`]*`\)\s*/i, '').replace(/^\((?:tend|declared as)\b[^)]*\)\s*/i, '');
    if (n === t) break; t = n;
  }
  t = t.replace(/^[—–·:-]+\s*/, '').replace(/\(guard:\s*`[^`]*`\)\s*/gi, '');
  return stripTrailingSpan(t).trim();
}
// the trailing operator/chair span — "(operator …, verbatim: *"…"*)" or "(chair decomposition … not on the tape: *"…"*)" — is the
// one such parenthesis whose close is the line's own last character. An inline "(OPERATOR 2026-11-05):" closes early, so it stays.
// Quoted spans (*"…"*) are skipped while counting, so a "(" inside his words never unbalances the count.
export function stripTrailingSpan(t) {
  const s = String(t || '');
  for (const m of s.matchAll(/\s*\((?:operator|chair decomposition)\b/gi)) {
    let depth = 0; let k = m.index + m[0].length - 1; let end = -1;
    for (; k < s.length; k++) {
      if (s[k] === '*' && s[k + 1] === '"') { const q = s.indexOf('"*', k + 2); if (q > 0) { k = q + 1; continue; } }
      if (s[k] === '(') depth++; else if (s[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end >= 0 && /^[\s.]*$/.test(s.slice(end + 1))) return s.slice(0, m.index);
  }
  return s;
}
// the lead clause before the first " — " (the part siblings of one decomposition share)
export const leadOf = (body) => { const m = /\s[—–]\s/.exec(body); return m ? body.slice(0, m.index).trim() : null; };
// lead clauses two or more rows share — computed once over the spec text, so "PACKAGE EVERYTHING … — X" and "… — Y" each read their own X, Y
export function sharedLeads(specText = '') {
  const n = new Map();
  for (const l of String(specText).split('\n')) { if (!ID_RE.test(l)) continue; const k = leadOf(rowBody(l)); if (k && k.length >= 12) n.set(k.toLowerCase(), (n.get(k.toLowerCase()) || 0) + 1); }
  return new Set([...n].filter(([, c]) => c >= 2).map(([k]) => k));
}
const PREAMBLES = [
  /^chair decomposition\b[\s\S]*?\beach item its own row\s*[—–]\s*/i,
  /^build and ratchet the implied ones too\b[^—–]*[—–]\s*/i,
  /^research meta-spec\b[^:]*?\)\s*(?:,\s*operator:\s*"[^"]*"\s*)?:\s*/i,
];
export function stripPreamble(body, shared = new Set()) {
  let t = String(body || '').trim();
  for (const re of PREAMBLES) { const n = t.replace(re, ''); if (n !== t && n.trim()) { t = n.trim(); break; } }
  const lead = leadOf(t); if (lead && shared.has(lead.toLowerCase())) { const rest = t.slice(t.indexOf(lead) + lead.length).replace(/^\s*[—–]\s*/, '').trim(); if (rest) t = rest; }
  return t;
}
const TAIL_STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'as', 'into', 'onto', 'that', 'its', 'their', 'his', 'is', 'are', 'be', 'so', 'than', 'then', 'via', 'per', 'every', 'each', 'when', 'which', 'who', 'it', 'not']);
export function sentenceCase(s) {
  const t = String(s || '').toLowerCase().replace(/\bc(\d+[a-z]?\d*)\b/g, (m, x) => `C${x.toUpperCase().replace(/[A-Z]$/, (c) => c.toLowerCase())}`);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
// the first clause of the body, 3–8 words, never ending on a stop word — the fallback a surface prints when no model title exists
export function fallbackTitle(text, { shared = new Set(), max = TITLE_MAX_WORDS } = {}) {
  const body = stripPreamble(rowBody(text), shared);
  const plain = body.replace(/\*?"[^"]*"\*?/g, ' ').replace(/(?:^|\s)(?:~?\/)?[\w.~-]+(?:\/[\w.~-]+)+\/?(?=[\s,;:.]|$)|\b[\w-]+\.(?:json|html?|mjs|js|ts|md|txt|ndjson|rs|sh)\b/g, ' ').replace(/\([^()]*\)/g, ' ').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim() || body;
  const clauses = plain.split(/(?<=[.!?;:])\s+|\s+[—–]\s+|,\s+/).map((c) => c.replace(/[.!?;:,]+$/, '').trim()).filter(Boolean);
  let words = []; for (const c of clauses) { words.push(...c.split(' ').filter(Boolean)); if (words.length >= TITLE_MIN_WORDS) break; }
  words = words.slice(0, max);
  while (words.length > 1 && TAIL_STOP.has(words[words.length - 1].toLowerCase().replace(/[^a-z']/g, ''))) words.pop();
  const t = sentenceCase(words.join(' ').replace(/[\s,;:—–-]+$/, ''));
  if (t) return t;
  const raw = String(text || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, max).join(' ');
  return sentenceCase(raw) || 'Untitled row — the row carries no words';
}
// the model title, only when the head was written off this row's text (the open or the ticked form of the line) and kept clean
export function modelTitle(h, line = null) {
  if (!h || h.verdict !== 'WRITTEN' || !h.head || (h.inventions && h.inventions.length)) return null;
  const t = String(h.head.title || '').replace(/\s+/g, ' ').trim(); if (!t) return null;
  if (line && h.textSha) { const open = String(line).replace(/^(\s*-\s*)\[[xX]\]/, '$1[ ]'); const done = String(line).replace(/^(\s*-\s*)\[ \]/, '$1[x]');
    if (![sha(line), sha(open), sha(done)].includes(h.textSha)) return null; }
  return t;
}
// SIBLINGS NEVER SHARE A TITLE (operator 2026-11-05, the reason titles exist: every decomposition head read the same). The writer sees one
// row, never its siblings, so it can still name the preamble they share (measured on the first backfill: C2389, C2390 and C2394 all came
// back "Steer finds what can run in parallel"). Rows grouped by their shared preamble; a model title two of them carry is dropped for
// both, and each reads its own fallback, which starts after the preamble.
export const familyOf = (line, shared = new Set()) => { const b = rowBody(line); const s = stripPreamble(b, shared); return s === b ? null : b.slice(0, b.length - s.length).trim().toLowerCase(); };
export function siblingCollisions(lines, heads, shared = new Set()) {
  const by = new Map();
  for (const [id, line] of lines) { const f = familyOf(line, shared); const t = f && modelTitle(heads.get(id), line); if (!t) continue; const k = `${f}\u0000${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`; if (!by.has(k)) by.set(k, []); by.get(k).push(id); }
  return new Set([...by.values()].filter((ids) => ids.length > 1).flat());
}
// THE ONE READER. heads: Map(id → newest head row); line: the row's spec line (fallback text and the staleness check); shared: sharedLeads;
// collided: the ids whose model title a sibling also carries (siblingCollisions)
export function titleFor(id, { heads = new Map(), line = '', shared = new Set(), collided = new Set() } = {}) {
  const m = collided.has(id) ? null : modelTitle(heads.get(id), line || null);
  if (m) return { title: m, source: 'model' };
  return { title: fallbackTitle(line || id, { shared }), source: 'fallback' };
}
// a colon never rides in a title: verify lines read "STUCK C#### · <title>: <reason>" and parsers split on the first colon
export const idTitle = (id, title) => `${id} · ${String(title).replace(/\s*:\s*/g, ' — ')}`;

// THE LIVE INDEX: the heads ledger and the spec read once per process (re-read when either file's mtime moves)
const readNd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
let LIVE = null;
const mtimeKey = (paths) => paths.map((p) => { try { return statSync(p).mtimeMs; } catch { return 0; } }).join(':');
export function liveIndex({ repo = REPO, headsPath = null, specs = null } = {}) {
  const hp = headsPath || resolve(repo, HEADS_LEDGER); const sp = (specs || TITLE_SPECS).map((p) => resolve(repo, p));
  const key = `${hp}|${sp.join('|')}|${mtimeKey([hp, ...sp])}`;
  if (LIVE && LIVE.key === key) return LIVE;
  const heads = new Map(); for (const h of readNd(hp)) if (h && h.id) heads.set(h.id, h);
  const lines = new Map(); let text = '';
  for (const p of sp) { let t = ''; try { t = readFileSync(p, 'utf8'); } catch { continue; } text += t + '\n'; for (const l of t.split('\n')) { const m = ID_RE.exec(l); if (m && !lines.has(m[1])) lines.set(m[1], l); } }
  const shared = sharedLeads(text);
  LIVE = { key, heads, lines, shared, collided: siblingCollisions(lines, heads, shared) };
  return LIVE;
}
// titleOf('C2345') → 'One spreadsheet per product or epoch' — the model title, else the fallback over the spec line, else over `text`
// A compiled ask carries its own text; when the spec row under the same id is a DIFFERENT row (a compile reserves an id the declare
// later renumbers), the ask's own text is titled and the other row's head is never borrowed.
const sameRow = (line, text) => { const k = (s) => rowBody(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40); return !text || !line || k(line).includes(k(text).slice(0, 30)) || k(text).includes(k(line).slice(0, 30)); };
export function titleOf(id, { text = '', index = null, ...o } = {}) {
  const ix = index || liveIndex(o);
  const spec = ix.lines.get(id) || '';
  if (spec && sameRow(spec, text)) return titleFor(id, { heads: ix.heads, line: spec, shared: ix.shared, collided: ix.collided || new Set() }).title;
  return fallbackTitle(text || spec || id, { shared: ix.shared });
}
// `C2345 · One spreadsheet per product or epoch`; a non-id label passes through unchanged
export function labelOf(id, o = {}) { return /^C\d+[a-z]?\d*$/.test(String(id)) ? idTitle(id, titleOf(id, o)) : String(id); }
// every bare row id in a line of prose gets its title once, in place: "TICKED C2345 —" → "TICKED C2345 · One spreadsheet … —"
export function titleIds(line, o = {}) {
  const seen = new Set();
  return String(line).replace(/\b(C\d{2,5}[a-z]?\d*)\b(?! ·)/g, (m, id) => { if (seen.has(id)) return m; seen.add(id); return labelOf(id, o); });
}
