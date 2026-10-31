// scripts/ops/board-priority.mjs — C1020ab: EVERY ROW ON EVERY BOARD SURFACE IS RANKED AND RATED 0–9 FOR PRIORITY, AND C1020aa: A
// SPEC ROW SHOWS ITS PLAIN HEAD (done when · now · from you · waits on) BEFORE THE RAW ROW. Operator 2026-10-19, verbatim: "all surfaces
// all cells must be 1) ranked by priority and 0-9 rated for priority - and 2 written so I can undersand them".
//
// A post-pass over the composed tabs (board.mjs allTabs): each table block gets two columns after its id, PRIORITY 0–9 and WHY THIS
// PRIORITY, and its rows sort highest first (stable, so the tab's own order breaks ties). LLM-FREE: every rating is read off the record.
//   Spec rows (Questions, every project's OPEN ROWS): 9 a ticked row whose guard regressed (data/vna/regressed-culprits.json) · 8 his
//   answer is on the ledger and the row is still open · 7 his decision or his act · 6 needs his answer · 5 dispatchable (CLEAR) or an
//   asks-ledger question · 4 a live WIP claim names it · 3 waiting on child rows · 0 closed. +1 when the row names a date in the next 7
//   days (a deadline); newest row id first inside a rating.
//   Other surfaces: recency of their own last edit or send, open basins, enforcement kind, owned questions (each tab's rule is in RULES).
//   A tab whose order IS its content (Overview, Week, Month, Tesseract map) is left as it is: EXCLUDED names it, with the reason.
// HIS GRADE OVERRIDES: the newest GRADE 0–9 he typed for that tab and id (data/vna/board-answers.ndjson, pulled by board-answers.mjs)
// replaces the derived rating, and WHY THIS PRIORITY says so and keeps the derived one beside it.
// Port row: C1020ab is transport over records the board already reads (CLAUDE.md MAXIMISE RUST: the board stays node).
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reachOf } from '../vna/steerone.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PRIORITY_COL = 'PRIORITY 0–9';
export const WHY_COL = 'WHY THIS PRIORITY';
export const HEAD_COLS = ['DONE WHEN', 'NOW', 'FROM YOU', 'WAITS ON'];
// C1067: every spec row's own door — the extension's URI handler (extension.ts registerUriHandler, ?cell=<Cn>) focuses
// that row in the sidebar. One column, built from the row's own id, never typed by hand.
export const OPEN_STEER_COL = 'OPEN IN STEER';
export const steerDoorUri = (id) => `vscode://thetadriven.thetacog-mcp/cell?cell=${encodeURIComponent(id)}`;
export const steerLink = (id) => `=HYPERLINK("${steerDoorUri(id)}","Open in Steer")`;
export const HEADS = 'data/vna/board-heads.ndjson';
export const EXCLUDED = { Overview: 'the counts and the how-to, not a list', Week: 'a calendar: time is the order', Month: 'a calendar: time is the order', 'Tesseract map': 'a 12×12 grid: position is the content', Lattice: 'a 12×12 grid: position is the content (C1026)', TOP: 'already ranked and capped at 10 by decisionReady, never re-sorted (C1030)' };
// A tab whose ORDER is the ask: each row still gets its PRIORITY and WHY, but the rows stay where the composer put them.
// Newsletter: operator 2026-10-19, "sort by date and renders" — a date block newest first, then a block by human renders; the
// age-bucket priority would re-sort the renders block by send age.
export const KEEP_ORDER = { Newsletter: 'the operator asked for date order and a renders order (2026-10-19); priority is shown, never re-sorts' };
const readNd = (p) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const num = (id) => Number((String(id).match(/\d+/) || [0])[0]);
const SPEC_ID = /^C\d+[a-z]?\d*$/;
export const textSha = (t) => createHash('sha1').update(String(t || '').trim()).digest('hex').slice(0, 12);

const daysAgo = (d, today) => { const t = Date.parse(String(d || '').slice(0, 10)); return Number.isFinite(t) ? Math.floor((Date.parse(today) - t) / 864e5) : null; };
const byAge = (d, today, steps, what) => { const n = daysAgo(d, today); if (n === null) return { p: 1, why: `no ${what} on the record` };
  for (const [max, p] of steps) if (n <= max) return { p, why: `${what} ${n} day(s) ago` }; return { p: 1, why: `${what} ${n} days ago` }; };
const bucket = (n, steps, what) => { for (const [min, p] of steps) if (n >= min) return { p, tie: n, why: `${n} ${what}` }; return { p: 1, tie: n, why: `${n} ${what}` }; };

// A date named in the row's own text, 0–7 days out from today: the deadline reach.
export function nearDeadline(text, today) {
  for (const d of String(text || '').match(/\b20\d\d-\d\d-\d\d\b/g) || []) { const n = daysAgo(d, today); if (n !== null && n <= 0 && n >= -7) return d; }
  return null;
}

export function specPriority(r, ctx) {
  const id = r.ID || r['OPEN ROWS']; const cls = String(r.CLASS || ''); const status = String(r.STATUS || '');
  let x;
  if (ctx.regressed.has(id)) x = { p: 9, why: `regressed: its guard went red after the tick (${ctx.regressed.get(id)})` };
  else if (cls === 'CLOSED' || status.startsWith('TICKED')) x = { p: 0, why: 'closed — kept for its receipt' };
  else if (ctx.answered.has(id) || status.startsWith('ANSWERED')) x = { p: 8, why: 'your answer is on the ledger and the row is still open' };
  else if (cls === 'DECISION') x = { p: 7, why: 'waiting on your decision' };
  else if (cls === 'YOUR-ACT') x = { p: 7, why: 'waiting on your act' };
  else if (cls === 'NEEDS-OPERATOR') x = { p: 6, why: 'needs your answer before a room can build it' };
  else if (ctx.running.has(id)) x = { p: 4, why: 'a room is on it now (live WIP claim)' };
  else if (cls === 'CLEAR') x = { p: 5, why: 'clear — a room can build it now' };
  else if (cls === 'ASKS LEDGER') x = { p: 5, why: 'an open question from the asks ledger' };
  else if (cls === 'WAITING-ON-CHILDREN') x = { p: 3, why: 'waiting on its child rows' };
  else x = { p: 2, why: `class ${cls || 'unknown'}` };
  const n = (ctx.reach && ctx.reach.get(id)) || 0;
  if (n >= REACH_LIFT && x.p > 0 && x.p < 8) x = { p: x.p + 1, why: `${x.why} · ${n} open rows wait on it` };
  const dl = x.p > 0 && x.p < 9 && nearDeadline(Object.values(r).join(' '), ctx.today);
  if (dl) x = { p: x.p + 1, why: `${x.why} · deadline ${dl}` };
  return { ...x, tie: SPEC_ID.test(id) ? num(id) : 0 };
}

// The rule per tab: [is this the header row of a rankable block, how a row is rated].
const isHeader = (row) => Array.isArray(row) && row.length > 1 && (row[0] === 'ID' || row[0] === 'OPEN ROWS' || row[0] === 'ROOM' || row[0] === 'EDITION' || /^ID \(/.test(String(row[0])));
export const RULES = {
  Questions: specPriority,
  Sessions: (r) => (/run|active|live/i.test(String(r.STATUS || '')) ? { p: 6, why: `session ${r.STATUS}` } : { p: 2, why: `session ${r.STATUS || 'status unknown'}` }),
  Reports: (r, c) => (r.DATE ? byAge(r.DATE, c.today, [[1, 6], [7, 4], [30, 2]], 'filed') : { p: 0, why: 'a blank row for your next report' }),
  Rooms: (r) => bucket(Number(r['QUESTIONS OWNED']) || 0, [[10, 8], [4, 6], [1, 5]], 'question(s) waiting in this room'),
  People: (r, c) => { const d = r['LAST DIRECT']; if (d) return byAge(d, c.today, [[7, 7], [30, 5], [90, 3]], 'last direct email');
    return /member/.test(String(r['BOOK CLUB'] || '')) ? { p: 3, why: 'book club member, no direct email yet' } : { p: 1, why: 'no send on the record' }; },
  'Business Plan': () => ({ p: 3, why: 'no signal on the record beyond its order — your grade sets it' }),
  Rules: (r) => (/judgment/i.test(String(r.ENFORCEMENT || '')) ? { p: 6, why: 'enforced by judgment only — nothing else catches it' } : r.ENFORCEMENT ? { p: 4, why: 'a guard enforces it' } : { p: 3, why: 'no enforcement line' }),
  Hats: (r) => (r.KIND === 'lens domain' ? bucket(Number(r['RULES · EVIDENCE FROM THE CORPUS']) || 0, [[10, 5], [1, 4]], 'rule(s) under this hat') : { p: 2, why: 'an axis hat — fixed by the lattice' }),
  Testers: () => ({ p: 4, why: 'no signal on the record yet — your grade sets it' }),
  'Blog posts': (r, c) => byAge(r['LAST EDIT'], c.today, [[2, 6], [7, 5], [30, 3]], 'last edit'),
  'Site pages': (r, c) => byAge(r['LAST EDIT'], c.today, [[2, 6], [7, 5], [30, 3]], 'last edit'),
  Tesseract: (r) => bucket(Number(String(r['BASINS HERE (open / all)'] || '0').split('/')[0]) || 0, [[5, 7], [2, 5], [1, 4]], 'open spec basin(s) land on this tile'),
  Snowball: () => ({ p: 4, why: 'what the turn hook is serving now' }),
  Newsletter: (r, c) => byAge(r['SENT (UTC)'], c.today, [[2, 6], [7, 4], [30, 2]], 'sent'),
};
const ruleFor = (name, rows) => RULES[name] || (rows.some((r) => r && r[0] === 'OPEN ROWS') ? specPriority : null);
// Rules and Hats are trees: a KIND that starts with two spaces rides with the row above it, so a group moves whole.
const isChild = (row, h) => { const k = h.indexOf('KIND'); return k >= 0 && /^ {2}/.test(String(row[k] || '')); };

// C1039c (cold read 2026-10-20 of the Tasks tab: "PRIORITY is flat at 5 or 9 for nearly every row, so it carries no ranking"): the
// open rows other open rows cite, by /steerone's crux reach (steerone.mjs reachOf, C596d) — one count, never a second one.
export const REACH_SPECS = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'];
export const REACH_LIFT = 3;   // a row three or more open rows cite is a knot: one point up, never past 8 (9 stays the regression's)
export function openReach(specs = REACH_SPECS) {
  const rows = [];
  for (const p of specs) { let t = ''; try { t = readFileSync(resolve(REPO, p), 'utf8'); } catch { continue; }
    for (const l of t.split('\n')) { const m = l.match(/^\s*- \[ \] (C\d+[a-z]?\d*)\b/); if (m) rows.push({ id: m[1], text: l, guard: (l.match(/\(guard: `([^`]+)`/) || [])[1] }); } }
  return new Map([...reachOf(rows)].map(([id, by]) => [id, by.length]));
}
export function loadContext({ today = new Date().toISOString().slice(0, 10), answers = readNd('data/vna/board-answers.ndjson'), regressed = null, claims = [], heads = readNd(HEADS), reach = null } = {}) {
  let reg = regressed;
  if (!reg) { try { reg = Object.fromEntries(Object.entries(JSON.parse(readFileSync(resolve(REPO, 'data/vna/regressed-culprits.json'), 'utf8')).rows || {}).filter(([, v]) => v.verdict === 'CULPRIT' || v.verdict === 'RED-AT-TICK').map(([k, v]) => [k, v.culprit || v.tick || ''])); } catch { reg = {}; } }
  const grades = new Map(); const answered = new Set();
  for (const a of answers) {
    if (/^GRADE/.test(String(a.field || ''))) { const g = Number(String(a.value).trim()); if (Number.isInteger(g) && g >= 0 && g <= 9) grades.set(`${a.tab}\u0000${a.id}`, { g, at: a.at || '' }); }
    if (a.field === 'ANSWER' && a.value) answered.add(a.id);
  }
  const running = new Set(); for (const c of claims) for (const id of String(c.note || '').match(/\bC\d{2,4}[a-z]?\d*\b/g) || []) running.add(id);
  const headBy = new Map(); for (const h of heads) if (h && h.id) headBy.set(h.id, h);   // append-only: the newest row for an id wins
  return { today, regressed: new Map(Object.entries(reg)), grades, answered, running, heads: headBy, reach: reach || openReach() };
}

// The head cells for one spec row, read off the heads ledger: UNWRITTEN when none, STALE when the row changed since, UNCLEAR when the
// writer could not write it from the row alone (C1020aa: the gap is marked, never filled).
// A decision or an asks-ledger question is already a plain ask: its question column IS the head, so it never reads UNWRITTEN.
export const ASK_CLASSES = new Set(['DECISION', 'ASKS LEDGER']);
export function headCells(id, rowText, heads, cls = '') {
  const h = heads.get(id);
  if (!h && ASK_CLASSES.has(cls)) return ['— the question is the head', '', '', ''];
  if (!h) return ['UNWRITTEN', '', '', ''];
  if (rowText && h.textSha && h.textSha !== textSha(rowText)) return [`STALE — the row changed since its head was written (${String(h.at || '').slice(0, 10)})`, '', '', ''];
  if (h.unclear) return [`UNCLEAR — ${h.unclear}`, '', '', ''];
  const failed = h.check && h.check.pass === false ? ' ⚠ cold read failed' : '';
  return [`${h.head.done_when}${failed}`, h.head.now, h.head.from_you, h.head.waits_on];
}

// The row's own spec line, read at the WHERE the tab already carries (spec:line): the text a head was written off and is hashed against.
const lines = new Map();
export function lineAt(where) {
  const m = String(where || '').match(/^(.+\.md):(\d+)$/); if (!m) return '';
  if (!lines.has(m[1])) { try { lines.set(m[1], readFileSync(resolve(REPO, m[1]), 'utf8').split('\n')); } catch { lines.set(m[1], []); } }
  return lines.get(m[1])[Number(m[2]) - 1] || '';
}

export function rankTab(name, rows, ctx) {
  if (EXCLUDED[name]) return { rows, ranked: 0, excluded: EXCLUDED[name] };
  const rule = ruleFor(name, rows);
  if (!rule) return { rows, ranked: 0, excluded: 'no priority rule for this tab' };
  const out = []; let ranked = 0; let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!isHeader(row)) { out.push(row); i++; continue; }
    const spec = rule === specPriority;
    const whereCol = spec ? row.indexOf('WHERE') : -1;
    out.push([row[0], PRIORITY_COL, WHY_COL, ...(spec ? [...HEAD_COLS, OPEN_STEER_COL] : []), ...row.slice(1)]);
    let j = i + 1; const groups = [];
    while (j < rows.length && Array.isArray(rows[j]) && rows[j].length && !isHeader(rows[j])) {
      const r = rows[j];
      if (groups.length && isChild(r, row)) groups[groups.length - 1].kids.push(r); else groups.push({ r, kids: [] });
      j++;
    }
    for (const g of groups) {
      const rec = Object.fromEntries(row.map((h, k) => [h, g.r[k]]));
      let x = rule(rec, ctx); const gr = ctx.grades.get(`${name}\u0000${g.r[0]}`);
      if (gr) x = { ...x, p: gr.g, why: `your grade ${gr.g} (${String(gr.at).slice(0, 10)}) · derived ${x.p}: ${x.why}` };
      g.p = x.p; g.tie = x.tie || 0; g.why = x.why;
    }
    groups.forEach((g, k) => { g.k = k; });
    if (!KEEP_ORDER[name]) groups.sort((a, b) => b.p - a.p || b.tie - a.tie || a.k - b.k);
    for (const g of groups) {
      const hc = spec ? headCells(String(g.r[0]), whereCol >= 0 ? lineAt(g.r[whereCol]) : '', ctx.heads, String(g.r[row.indexOf('CLASS')] ?? '')) : [];
      out.push([g.r[0], g.p, g.why, ...(spec ? [...hc, steerLink(String(g.r[0]))] : []), ...g.r.slice(1)]); ranked++;
      for (const kid of g.kids) out.push([kid[0], g.p, '↑ rides with its heading', ...(spec ? ['', '', '', '', steerLink(String(kid[0]))] : []), ...kid.slice(1)]);
    }
    i = j;
  }
  return { rows: out, ranked };
}

export function rankTabs(T, ctx = loadContext()) {
  const report = [];
  const out = T.map(([name, rows]) => { const r = rankTab(name, rows, ctx); report.push({ tab: name, ranked: r.ranked, excluded: r.excluded || null }); return [name, r.rows]; });
  return { tabs: out, report };
}
