// scripts/ops/board-surfaces.mjs — C1020d: the board's second layer — rooms, people, the business plan, rules, hats, testers, every
// blog post and every site page, each a tab whose rows carry a stable id and the operator's fill columns (GRADE 0–9 · COMMENT · EDIT ·
// INSTRUCTION). Operator 2026-10-19, verbatim (the /goal): "Add sections for the state of all current outreach people and go to market.
// The business plan is another tab … tie it to the rooms as well … I can grade it based on 09 or whatever with the comments that you can
// use to update the rules, the tester, acts rules, and hats need to be added to the spreadsheet as well … convert all the projects we have
// including the last edits for all blog posts, for example, and all pages on the site so we can step through cells".
//
// Every column is read off the repo, never typed: rooms from data/room-surfaces.json + openclaw/data/thematic-schedule.json; people from
// data/rooms-people.json + every live book club member, full address and phone (operator 2026-10-19), joined to .thetacog/email-sent.ndjson for the last
// send; the business plan from the newest docs/strategy/*business-plan*.txt; rules from the headings of CLAUDE.md and
// docs/architecture/claude-rules/*.md; hats from scripts/pmu/shortlex-names.mjs (the 12 role-nouns) and data/pmu/lens-reef.json (the
// domains); testers from scripts/vna/backup-trials.mjs TRIALS; blog posts and pages from the tree with their last commit from one git log.
// LLM-FREE. A source that is missing yields a tab that says so in its first row, never an empty tab.
import { socialTabs } from './board-social.mjs';
import { loadLeadQuality, lqCells, LQ_COLS } from './board-lead-quality.mjs';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HATS, hatName } from '../pmu/shortlex-names.mjs';
import { compose, SPECS } from './board-requirements.mjs';   // C1073: the Business Plan grid, one layout for both writers
import { BOARD_HAT, internalSheetNames } from './sheet-hats.mjs';   // C1176: the hat the Hats sheet's reverse list names
import { liveIndex, titleOf, rowBody, fallbackTitle } from './row-title.mjs';   // C2615: each question's plain TITLE and its FULLTEXT, off the one title door
import { gzipSync } from 'node:zlib';
import { clarityOf, clarityCell, CLARITY_COL } from './rooms-clarity.mjs';   // the Rooms CLARITY / FINISH cell, no model
import { specHistory as projectHistory } from './board-project.mjs';   // the commit that declared each row, one cached git pass

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GH = 'https://github.com/wiber/thetadrivencoach/blob/main/';
const SITE = 'https://thetadriven.com';
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const read = (p) => { try { return readFileSync(resolve(REPO, p), 'utf8'); } catch { return null; } };
const sh = (args) => { try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
export const GRADE = ['GRADE 0–9 (fill)', 'COMMENT (fill)'];
export const SURFACE_TABS = { rooms: 'Rooms', people: 'People', plan: 'Business Plan', rules: 'Rules', hats: 'Hats', testers: 'Testers', blog: 'Blog posts', pages: 'Site pages', tesseract: 'Tesseract', tesseractMap: 'Tesseract map', snowball: 'Snowball', linkedin: 'LinkedIn', x: 'X followers' };
const missing = (what) => [[`UNMEASURED — ${what}`]];

// One git pass: the newest commit that touched each file under the given roots.
export function lastCommits(roots) {
  const out = new Map(); let cur = null;
  for (const l of sh(['log', '--format=@@%h\t%ad\t%s', '--date=short', '--name-only', '--', ...roots]).split('\n')) {
    if (l.startsWith('@@')) { const [h, d, ...s] = l.slice(2).split('\t'); cur = { sha: h, date: d, subject: s.join('\t') }; }
    else if (l && cur && !out.has(l)) out.set(l, cur);
  }
  return out;
}

// C2615 (operator 2026-11-05: "convert this sheet to ID comment priority room title fulltext (reorder and put all the questions there
// directly …)"): ONE ROW PER OPEN QUESTION, never one row per room with a count. The rank pass puts PRIORITY after ID and orders the rows by
// the crux rank (board-priority.mjs RULES.Rooms → specPriority, C2434); the writer moves COMMENT (fill) to column B (commentSecond). So the
// sheet reads ID · COMMENT · PRIORITY · ROOM · TITLE · FULLTEXT, then the room's own columns, then the machine columns (CLASS, COORDINATE,
// WHERE — board-layout.mjs collapses them). Every cell is read off the record: the question list buildBoard already makes (board.mjs), the
// title door (row-title.mjs) and data/room-surfaces.json.
// C2615b (operator 2026-11-05, reading the first write: "is the full text legible to an LLM because it's not legible to a human … you said
// tokenizer left panel … sidebar mounts … that's not the words I used. So it looks like sludge"): FULLTEXT is HIS words — the verbatim span the
// row quotes — never its build notes; TITLE is the row's plain head (C1027, board-heads.ndjson); the build notes ride in THE ROW (full text),
// a collapsed machine column; NEAR names the nearest open rows by the gzip-NCD spec-tree.mjs ncd() computes. No model writes a cell here.
export const ROOMS_HEAD = ['ID', CLARITY_COL, 'ROOM', 'TITLE', 'FULLTEXT', 'NEAR', 'PERSONA', 'THEME HOURS (schedule tz)', 'PROJECT', 'CLASS', 'COORDINATE', 'WHERE', 'THE ROW (full text)', ...GRADE];
export const NO_SPAN = 'no words of yours on this row';
// his words on a spec line, in the order they are worth: what he said (operator's words · verbatim), then the chair's own text when no
// word of his was on the tape, then an inline "(OPERATOR <date>: …)" clause. null when the row quotes nobody.
export function hisSpan(line) {
  const t = String(line || '');
  for (const re of [/operator(?:'|’)s words[^*]{0,40}\*"([\s\S]+?)"\*/i, /\(operator\b[^*()]{0,80}\*"([\s\S]+?)"\*/i, /not on the tape:\s*\*"([\s\S]+?)"\*/i, /\(OPERATOR \d{4}-\d\d-\d\d[^:]{0,40}:\s*([^)]{12,})\)/]) {
    const m = re.exec(t); if (m && m[1].trim()) return m[1].replace(/\s+/g, ' ').trim();
  }
  return null;
}
// the same distance as spec-tree.mjs ncd() (gzip level 9, joined by a newline), with each text's own size memoised
export function nearOf(id, text, pool, { k = 3, sizes = new Map() } = {}) {
  const gz = (x) => gzipSync(Buffer.from(x, 'utf8'), { level: 9 }).length;
  const size = (x) => { if (!sizes.has(x)) sizes.set(x, gz(x)); return sizes.get(x); };
  const ca = size(text);
  return pool.filter((p) => p.id !== id && p.text).map((p) => { const cb = size(p.text); const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca]; return { id: p.id, title: p.title, d: hi === 0 ? 0 : (gz(text + '\n' + p.text) - lo) / hi }; })
    .sort((x, y) => x.d - y.d).slice(0, k);
}
// the room that declared a row: the Originating-Terminal of the commit that added it (board-project.mjs specHistory, the 30-day window),
// read for every id at once in one git call; outside the window it is null and the cell says so
export function declaredRooms(ids) {
  const out = new Map(); let decl = new Map();
  try { decl = projectHistory().declared; } catch { return out; }
  const want = [...new Set(ids.map((id) => decl.get(id)).filter(Boolean).map((c) => c.sha))]; if (!want.length) return out;
  const room = new Map(); for (const l of sh(['show', '-s', '--format=%h%x09%(trailers:key=Originating-Terminal,valueonly,separator=;)', ...want]).split('\n')) { const [h, t] = l.split('\t'); if (h) room.set(h, String(t || '').trim()); }
  for (const id of ids) { const c = decl.get(id); if (c) out.set(id, room.get(c.sha) ? `${room.get(c.sha)} (${c.sha})` : `commit ${c.sha}`); }
  return out;
}
export function roomsTab({ questions = [] } = {}, { index = null, declaredBy = null, pool = null, exists = (p) => existsSync(resolve(REPO, p)) } = {}) {
  if (!declaredBy) { const m = declaredRooms(questions.map((q) => q.id)); declaredBy = (id) => m.get(id) || null; }
  const rs = JSON.parse(read('data/room-surfaces.json') || '{"rooms":{}}').rooms;
  const sched = JSON.parse(read('openclaw/data/thematic-schedule.json') || '{}');
  const hours = {}; for (const v of Object.values(sched.metadata?.categories || {})) for (const [r, x] of Object.entries(v.rooms || {})) hours[r] = `${x.code} ${x.namespace} · ${x.hours}`;
  const ix = index || liveIndex();
  const plainHead = (id) => { const h = ix.heads.get(id); return h && h.head && h.head.title ? String(h.head.title) : null; };
  const textOf = (id, line) => hisSpan(line) || rowBody(line).slice(0, 600);
  // NEAR draws from every open row on the spec, each compared by the same text it would show (his words, else its body)
  const open = pool || [...ix.lines].filter(([, l]) => /^\s*- \[ \]/.test(l)).map(([id, l]) => ({ id, title: plainHead(id) || fallbackTitle(hisSpan(l) || rowBody(l), { shared: ix.shared }), text: textOf(id, l) }));
  const sizes = new Map();
  const rows = [ROOMS_HEAD];   // no PRIORITY (fill): the rank pass guesses it, his GRADE overrides (operator 2026-10-19: "never ask me to prioritize - guess and I will edit")
  for (const q of questions) {
    const room = Object.keys(rs).find((r) => String(q.owner || '').split(/\s+/).pop() === r) || null; const v = room ? rs[room] : {};
    const line = ix.lines.get(q.id) || ''; const span = hisSpan(line); const body = (line ? rowBody(line) : '') || q.question || '';
    const by = declaredBy(q.id);
    const full = span || `${NO_SPAN} — ${by ? `declared by ${by}` : 'declared before the 30-day git window'}`;
    const title = plainHead(q.id) || fallbackTitle(span || body.replace(/^(?:\((?:built|declared|released|ticked)\b[^)]*\)[\s:;—-]*)+/i, '') || body, { shared: ix.shared });
    const near = nearOf(q.id, textOf(q.id, line) || body, open, { sizes }).map((n) => `${n.id} · ${n.title} (${n.d.toFixed(2)})`).join('\n');
    const clarity = clarityCell(clarityOf({ span, guard: q.guard || ((/\(guard: `([^`]+)`/.exec(line) || [])[1]) || null, body, head: ix.heads.get(q.id) || null }, { exists }));
    rows.push([q.id, clarity, q.owner || 'unowned', title, full, near, v.persona || '', (room && hours[room]) || '', q.project || '', q.class || '', v.coordinate || '', q.where || '', body, '', '']);
  }
  return rows;
}

// People: one row per person (deduplicated on the real address, which never leaves this machine; the id is a hash of it, the
// sheet carries the obscured form). State is read off the send ledger, split in two: the book club newsletter, and every direct send.
// Current outreach = the newest DIRECT send first; a person only ever reached by the newsletter sorts after them.
const isNewsletter = (r) => /book club/i.test(r.subject || '') || /bookclub/i.test(r.from || '');
// EVERY BOOK CLUB MEMBER, WITH EMAIL AND PHONE (operator 2026-10-19, verbatim: "not complete- all active book club members for example
// need to be here, phone numbers must be in the sheet"). Was: room-tagged people only, capped at 300, address obscured. Now the union of
// data/rooms-people.json and the live audience (scripts/bookclub/audience.mjs --meta, the same list the daily send uses, unsubscribes
// already subtracted), uncapped, with the full address and every phone the machine holds: macOS Contacts (data/contacts/contacts.sqlite,
// joined by email, then by a full name of two or more words) and WhatsApp one-to-one chats (the ChatStorage snapshot, joined by full
// name). The source of each phone sits beside it, so a name-join can be checked. The board lives in his own Drive, never on a public page.
const sqliteJson = (db, sql) => { try { return JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', db, sql], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }) || '[]'); } catch { return []; } };
const normName = (n) => String(n || '').replace(/[\u200e\u202a\u202c]/g, '').toLowerCase().replace(/[^a-z\u00c0-\u024f ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function phoneBook() {
  const byEmail = new Map(); const byName = new Map();
  const add = (m, k, ph, src) => { if (!k || !ph) return; const e = m.get(k) || []; if (!e.some((x) => x.ph === ph)) e.push({ ph, src }); m.set(k, e); };
  const cdb = resolve(REPO, 'data/contacts/contacts.sqlite');
  if (existsSync(cdb)) {
    for (const r of sqliteJson(cdb, 'select e.email as email, p.phone as phone from contact_emails e join contact_phones p on p.contact_id = e.contact_id')) add(byEmail, String(r.email).toLowerCase(), r.phone, 'contacts · email');
    for (const r of sqliteJson(cdb, 'select c.name as name, p.phone as phone from contacts c join contact_phones p on p.contact_id = c.id')) { const n = normName(r.name); if (n.split(' ').length >= 2) add(byName, n, r.phone, 'contacts · name'); }
  }
  const snap = resolve(REPO, '.thetacog/cache/whatsapp-snapshot/ChatStorage.sqlite');
  const live = resolve(process.env.HOME || '', 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite');
  const wa = existsSync(snap) ? snap : (existsSync(live) ? live : null);
  if (wa) for (const r of sqliteJson(wa, "select ZCONTACTJID as jid, ZPARTNERNAME as name from ZWACHATSESSION where ZCONTACTJID like '%s.whatsapp.net'")) {
    const n = normName(r.name); const ph = '+' + String(r.jid).split('@')[0];
    if (n.split(' ').length >= 2 && ph.length > 6) add(byName, n, ph, 'whatsapp · name');
  }
  return { byEmail, byName };
}
export function bookClubMembers() {
  try { return JSON.parse(execFileSync('node', [resolve(REPO, 'scripts/bookclub/audience.mjs'), '--meta'], { cwd: REPO, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
}
export function peopleTab({ members = bookClubMembers(), phones = phoneBook() } = {}) {
  const j = JSON.parse(read('data/rooms-people.json') || '{"rooms":{}}');
  const sent = new Map();
  for (const l of (read('.thetacog/email-sent.ndjson') || '').split('\n')) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const nl = isNewsletter(r);
    for (const to of [].concat(r.to || [])) {
      const k = String(to).toLowerCase(); const e = sent.get(k) || { news: 0, direct: 0, ts: '', subject: '' };
      if (nl) e.news++; else { e.direct++; if ((r.ts || '') > e.ts) { e.ts = r.ts || ''; e.subject = r.subject || ''; } }
      sent.set(k, e);
    }
  }
  const people = new Map();
  const get = (k) => people.get(k) || { rooms: new Set(), name: '', rank: 0, club: '' };
  for (const [room, list] of Object.entries(j.rooms || {})) for (const p of list || []) {
    const k = String(p.email || '').toLowerCase(); if (!k) continue;
    const e = get(k); e.rooms.add(room); if (p.name && !e.name) e.name = p.name; e.rank = Math.max(e.rank, Number(p.importance_rank) || 0); people.set(k, e);
  }
  for (const m of members || []) {
    const k = String(m.email || '').toLowerCase(); if (!k) continue;
    const e = get(k); if (m.name && !e.name) e.name = m.name; e.club = m.trial ? 'member · trial' : 'member'; people.set(k, e);
  }
  const rows = [...people.entries()].map(([k, e]) => {
    const s = sent.get(k) || { news: 0, direct: 0, ts: '', subject: '' };
    const ph = phones.byEmail.get(k) || phones.byName.get(normName(e.name)) || [];
    return { id: `P-${createHash('sha1').update(k).digest('hex').slice(0, 8)}`, rooms: [...e.rooms].join(' · '), name: e.name, email: k, phone: ph.map((x) => x.ph).join(' · '), psrc: [...new Set(ph.map((x) => x.src))].join(' · '), club: e.club, rank: e.rank, news: s.news, direct: s.direct, last: s.ts.slice(0, 10), subject: clip(s.subject, 70) };
  });
  rows.sort((a, b) => b.last.localeCompare(a.last) || b.rank - a.rank || b.news - a.news || a.email.localeCompare(b.email));
  const head = ['ID', 'ROOMS', 'NAME', 'EMAIL', 'PHONE', 'PHONE FROM', 'BOOK CLUB', 'IMPORTANCE', 'DIRECT EMAILS', 'BOOK CLUB SENDS', ...LQ_COLS, 'LAST DIRECT', 'LAST DIRECT SUBJECT', 'STATE (fill)', 'NEXT STEP (fill)', ...GRADE];
  const lq = loadLeadQuality();   // the render read (board-lead-quality.mjs refresh); absent → UNMEASURED cells, never zeros
  const note = members ? [] : [['UNMEASURED — scripts/bookclub/audience.mjs --meta did not run; book club members are missing from this tab']];
  return [head, ...note, ...rows.map((r) => [r.id, r.rooms, r.name, r.email, r.phone, r.psrc, r.club, r.rank, r.direct, r.news, ...lqCells(r.email, lq), r.last, r.subject, '', '', '', ''])];
}

// C1073: the plan's spine is docs/specs/vna/business-plan.json (walked backwards from the Horizons); the newest business-plan txt is
// the fallback when the json is absent. One source for this tab and the Business Plan sheet (board-requirements.mjs --spec plan).
export const PLAN_JSON = 'docs/specs/vna/business-plan.json';
export function planTab() {
  const pj = read(PLAN_JSON);
  // the same grid the Business Plan sheet's own writer emits, so the two doors never fight over one sheet's layout
  if (pj) return compose({ rows: JSON.parse(pj).rows, head: SPECS.plan.head, cols: SPECS.plan.cols });
  const dir = resolve(REPO, 'docs/strategy');
  const f = existsSync(dir) ? readdirSync(dir).filter((n) => /business-plan.*\.txt$/.test(n)).sort().pop() : null;
  if (!f) return missing('no docs/strategy/*business-plan*.txt');
  const lines = read(`docs/strategy/${f}`).split('\n');
  const rows = [['ID', 'SECTION', 'LINE', 'WHAT IT SAYS', 'YOUR EDIT (fill)', ...GRADE]];
  // A paragraph is one row: consecutive non-blank lines join; a short all-caps or # line names the section it opens.
  let sec = ''; let n = 0; let buf = []; let at = 0;
  const flush = () => { if (!buf.length) return; n++; rows.push([`BP-${n}`, clip(sec, 60), `${f}:${at}`, clip(buf.join(' '), 400), '', '', '']); buf = []; };
  lines.forEach((l, i) => {
    const t = l.trim();
    if (!t) { flush(); return; }
    if (/^(#+ |[A-Z0-9][A-Z0-9 ,.'&—:–()/-]{6,}$|═|──)/.test(t) && t.length < 120) { flush(); sec = t.replace(/^#+\s*/, '').replace(/[═─]/g, '').trim() || sec; return; }
    if (!buf.length) at = i + 1; buf.push(t);
  });
  flush();
  return rows;
}

// FULL TEXT, ONE ROW PER STATEMENT (operator 2026-10-19, verbatim: "write out the full rule content/hat content in the sheet - we
// need to be able to comment on things next to them" · on RU-voice-and-pitch-236: "this seems too short for a sensible role"). Each
// heading is one row (its enforcement beside it), then every top-level bullet or paragraph under it is its own row, full text, with its
// own GRADE and COMMENT cells. An indented sub-bullet rides with its parent. The id is the file + the line the statement starts on.
const CELL_MAX = 45000; // a Google Sheets cell holds 50,000 characters
const full = (s) => { const t = String(s ?? '').replace(/[ \t]+/g, ' ').trim(); return t.length > CELL_MAX ? `${t.slice(0, CELL_MAX - 1)}…` : t; };
export function ruleStatements(text) {
  const lines = String(text || '').split('\n'); const out = []; let sec = null; let cur = null; let fence = false;
  const close = () => { if (cur) { (sec ? sec.items : out).push(cur); cur = null; } };
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && l.match(/^(#{2,4})\s+(.+)$/);
    if (h) { close(); sec = { line: i + 1, heading: h[2].trim(), items: [] }; out.push(sec); return; }
    if (!l.trim()) { if (!fence) close(); else if (cur) cur.text += '\n'; return; }
    const top = !fence && /^(- |\* |\d+\. )/.test(l);
    if (top || !cur) { close(); cur = { line: i + 1, text: l }; } else cur.text += '\n' + l;
  });
  close();
  return out.filter((x) => x.heading);
}
// ONE ID NAMES ONE ROW, FOREVER (board skill hard rule). The id was RU-<file>-<line>: every CLAUDE.md edit renamed the rows below it,
// and on 2026-10-24 a one-column change stranded 375 cells on renamed rows. A rule's id is its file + heading; a statement's is its
// rule's id + its own text (an ordinal tells two equal lines apart, e.g. "---"). The line stays in WHERE, where it belongs.
export const ruleId = (short, text) => `RU-${short ? `${short}-` : ''}${createHash('sha1').update(String(text).trim()).digest('hex').slice(0, 8)}`;
export function rulesTab() {
  const files = ['CLAUDE.md', ...(existsSync(resolve(REPO, 'docs/architecture/claude-rules')) ? readdirSync(resolve(REPO, 'docs/architecture/claude-rules')).filter((n) => n.endsWith('.md') && !n.startsWith('_')).map((n) => `docs/architecture/claude-rules/${n}`) : [])];
  const rows = [['ID', 'WHERE (file:line)', 'KIND', 'RULE · STATEMENT (full text)', 'ENFORCEMENT', ...GRADE, 'EDIT (fill)']];
  for (const f of files) {
    const short = f.split('/').pop().replace('.md', ''); const where = f.replace('docs/architecture/claude-rules/', 'claude-rules/');
    for (const sec of ruleStatements(read(f) || '')) {
      const body = sec.items.map((x) => x.text).join('\n');
      const enf = (body.match(/ENFORCEMENT[^:]*:\*{0,2}\s*([^\n]+)/) || [])[1] || '';
      const rid = ruleId(short, sec.heading); const seen = new Map();
      rows.push([rid, `${where}:${sec.line}`, 'RULE', full(sec.heading.replace(/[*`]/g, '')), full(enf.replace(/[*`]/g, '')), '', '', '']);
      for (const it of sec.items) { const k = ruleId('', it.text).slice(3); const n = (seen.get(k) || 0) + 1; seen.set(k, n);
        rows.push([`${rid}.${k}${n > 1 ? `-${n}` : ''}`, `${where}:${it.line}`, '  statement', full(it.text), '', '', '', '']); }
    }
  }
  return rows;
}

// C1176: THE REVERSE LIST — per hat, the sheets it reads. The board's own hat (Gridkeeper×Loopkeeper,
// C1,C2 — scripts/ops/sheet-hats.mjs's BOARD_HAT) is where that list lives, named on the C1 and C2 axis
// rows; this is the reverse of the line sheet-tabs.mjs's Rules tab S6 carries on every sheet it reads.
export function hatsTab() {
  const rows = [['ID', 'KIND', 'NAME', 'COORDINATE', 'WHAT IT IS · STATEMENT (full text)', 'RULES · EVIDENCE FROM THE CORPUS', 'SHEETS IT READS (C1176, reverse of each sheet\'s own Rules S6)', ...GRADE, 'EDIT (fill)']];
  const sheets = internalSheetNames();
  for (const [axis, role] of Object.entries(HATS.roles)) {
    const reads = (axis === BOARD_HAT.coord.split(',')[0] || axis === BOARD_HAT.coord.split(',')[1]) ? full(sheets.join(' · ')) : '';
    rows.push([`H-${axis}`, 'axis hat', `${HATS.emoji[axis] || ''} ${role}`.trim(), axis, 'the role this axis puts you in (scripts/pmu/shortlex-names.mjs)', '', reads, '', '', '']);
  }
  const reef = JSON.parse(read('data/pmu/lens-reef.json') || '{"domains":[]}');
  for (const d of reef.domains || []) {
    rows.push([`H-${d.domain}`, 'lens domain', `${d.domain} · ${hatName(d.coord)}`, d.coord, full(d.template), (d.rules || []).length, '', '', '', '']);
    const ev = d.derived_statements && typeof d.derived_statements === 'object' ? d.derived_statements : {};
    (d.rules || []).forEach((r, i) => { const t = typeof r === 'string' ? r : JSON.stringify(r); rows.push([`H-${d.domain}-r${i + 1}`, '  hat rule', (d.rule_names || [])[i] || '', d.coord, full(t), full((ev[t] || []).join(' ¶ ')), '', '', '', '']); });
  }
  return rows;
}

// THE TESSERACT — the full semantic dump, one row per tile (operator 2026-10-19, verbatim: "thetacog tesseract snowball also!" · "need
// the full semantic dump from the tesseract in spreadsheet too"). Each of the 144 cells carries its whole snippet from the tile library
// (the same data/pmu/snippet-library-144.json C1020f reads, uncut here), its hat, and the spec basins whose walk lands there
// (data/vna/tesseract-state.json). The map tab is the same 144 as a 12×12 grid of basin counts: a 2D color map once formatted.
export function tesseractTab() {
  const lib = JSON.parse(read('data/pmu/snippet-library-144.json') || 'null');
  if (!Array.isArray(lib)) return missing('data/pmu/snippet-library-144.json did not load');
  const st = JSON.parse(read('data/vna/tesseract-state.json') || '{"nodes":[]}');
  const by = {}; for (const n of st.nodes || []) { if (!n.pixel) continue; (by[n.pixel] ||= []).push(n); }
  const rows = [['ID', 'COORDINATE', 'HAT', 'BASINS HERE (open / all)', 'SPEC ROWS LANDING HERE', 'THE TILE (full semantic dump)', ...GRADE, 'EDIT (fill)']];
  for (const t of lib) {
    const ns = by[t.coord] || []; const open = ns.filter((n) => !n.done);
    rows.push([`T-${t.coord}`, t.coord, t.hat || hatName(t.coord), `${open.length} / ${ns.length}`, full(ns.map((n) => (n.done ? '' : '○ ') + n.label).join(' · ')), full(t.snippet), '', '', '']);
  }
  rows.push([`T-sha`, 'tesseract', st.tesseract_sha || '', `${(st.counts || {}).basins || 0} basins`, `root ${st.root || ''}`, `at ${st.at || ''}`, '', '', '']);
  return rows;
}
export function tesseractMapTab() {
  const st = JSON.parse(read('data/vna/tesseract-state.json') || 'null');
  if (!st || !st.lattice) return missing('data/vna/tesseract-state.json did not load');
  const order = st.lattice.order; const count = {};
  for (const n of st.nodes || []) if (n.pixel && !n.done) count[n.pixel] = (count[n.pixel] || 0) + 1;
  return [['OPEN BASINS · row ↓ × col →', ...order, 'COMMENT ON THIS ROW (fill)'], ...order.map((r) => [r, ...order.map((c) => count[`${r},${c}`] || 0), ''])];
}

// THE SNOWBALL — what the turn hook is serving right now, one line per row (.thetacog/vna-snowball-sidecar.json).
export function snowballTab() {
  const sc = JSON.parse(read('.thetacog/vna-snowball-sidecar.json') || 'null');
  if (!sc) return missing('.thetacog/vna-snowball-sidecar.json is not on this machine');
  return [['ID', 'LEAF', 'LINE (full text)', ...GRADE, 'EDIT (fill)'],
    ...(sc.lines || []).map((l, i) => [`SB-${sc.leafLabel}-${i + 1}`, sc.leafLabel, full(l), '', '', '']),
    [`SB-seed`, sc.leafLabel, full(`anchor ${sc.anchor} · stage ${(sc.seed || {}).stage || ''} · at ${sc.at} · ${sc.ms} ms`), '', '', '']];
}

export async function testersTab() {
  let T = [];
  try { T = (await import('../vna/backup-trials.mjs')).TRIALS || []; } catch { return missing('scripts/vna/backup-trials.mjs did not load'); }
  return [['ID', 'WHO', 'SIDE', 'PAGES', 'THE PERSON', 'THEIR JOB', ...GRADE, 'EDIT (fill)'],
    ...T.map((t) => [t.id, t.who, t.side, (t.path || []).join(' · '), clip(t.person, 200), clip(t.job, 160), '', '', ''])];
}

function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); const s = statSync(p); if (s.isDirectory()) walk(p, test, out); else if (test(p)) out.push(p); }
  return out;
}

export function blogTab(lc) {
  const files = walk(resolve(REPO, 'src/content/blog'), (p) => /\.mdx?$/.test(p)).map((p) => p.slice(REPO.length + 1));
  const rows = files.map((f) => {
    const fm = (read(f) || '').split('\n---')[0];
    const title = ((fm.match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || '').trim();
    const date = ((fm.match(/^date:\s*["']?([0-9-]+)/m) || [])[1] || '');
    const slug = f.split('/').pop().replace(/\.mdx?$/, '');
    const c = lc.get(f) || { date: '', sha: '', subject: '' };
    // The id is the slug, so the live page is thetadriven.com/blog/<id without B->; the title only when it says more than the slug.
    const t = clip(title, 60); return [`B-${slug}`, t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug.replace(/^\d{4}-\d{2}-\d{2}-/, '') ? '' : t, c.date, c.sha, clip(c.subject, 50), '', '', ''];
  }).sort((a, b) => String(b[2]).localeCompare(String(a[2])));
  return [['ID (thetadriven.com/blog/ + id after B-)', 'TITLE', 'LAST EDIT', 'COMMIT', 'LAST EDIT SUBJECT', 'INSTRUCTION (fill)', ...GRADE], ...rows];
}

// Only the extensions Next serves as a route: no pageExtensions in next.config means tsx|ts|jsx|js. src/app/faq held page.tsx AND a
// dead page.mdx (2026-10-24), the tab listed /faq twice under one id, and the id-keyed write ledger could not tell the two rows apart.
export const PAGE_FILE = /\/page\.(tsx|ts|jsx|js)$/;
export function pagesTab(lc) {
  const files = walk(resolve(REPO, 'src/app'), (p) => PAGE_FILE.test(p)).map((p) => p.slice(REPO.length + 1));
  const rows = files.map((f) => {
    const route = '/' + f.replace(/^src\/app\/?/, '').replace(/\/?page\.\w+$/, '').split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/');
    const c = lc.get(f) || { date: '', sha: '', subject: '' };
    const dynamic = /\[/.test(route);
    return [`PG-${route}`, dynamic ? `${route} (dynamic)` : route, c.date, c.sha, clip(c.subject, 50), '', '', ''];
  }).sort((a, b) => String(b[2]).localeCompare(String(a[2])));
  return [['ID', 'ROUTE (live at thetadriven.com + route)', 'LAST EDIT', 'COMMIT', 'LAST EDIT SUBJECT', 'INSTRUCTION (fill)', ...GRADE], ...rows];
}

export async function surfaceTabs(b) {
  const lc = lastCommits(['src/content/blog', 'src/app']);
  const people = peopleTab(); const social = socialTabs({ people });   // C1020z: LinkedIn + X joined to the same People rows
  return [
    [SURFACE_TABS.rooms, roomsTab(b)], [SURFACE_TABS.people, people], [SURFACE_TABS.plan, planTab()],
    [SURFACE_TABS.rules, rulesTab()], [SURFACE_TABS.hats, hatsTab()], [SURFACE_TABS.testers, await testersTab()],
    [SURFACE_TABS.blog, blogTab(lc)], [SURFACE_TABS.pages, pagesTab(lc)],
    [SURFACE_TABS.tesseract, tesseractTab()], [SURFACE_TABS.tesseractMap, tesseractMapTab()], [SURFACE_TABS.snowball, snowballTab()],
    [SURFACE_TABS.linkedin, social.li], [SURFACE_TABS.x, social.x],
  ];
}
