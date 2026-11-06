// scripts/ops/board-plan.mjs — C1032: THE WEEK AND MONTH SHEETS ARE A PLAN, NOT A CALENDAR COPY (bf-6401, from laboratory).
// Operator 2026-10-19, verbatim: "we are misusing the surfaces - if I want to see the calander events use gcal, if I want to plan
// the week thats the spreadsheet - wrong altitude if we just copy the evetns (visitation for example is obviously wrong) tie it to
// the transcripts and emails and whatsapp events - paint it with possibilities we want to do".
//
// What composes a slot, in this order of authority:
//   (a) the room theme by hour (openclaw/data/thematic-schedule.json) — the column beside every slot;
//   (b) the open commitments read off the record, placed as POSSIBILITIES, each cell naming its source:
//       spec rows carrying a future date · your acts and your answers on the spec · transcript asks (docs/specs/vna/asks/ ledgers)
//       · threads owed a reply on email, WhatsApp and iMessage (scripts/chat/followup-brief.mjs, the two-timestamp ranker);
//   (c) calendar events only as FIXED blockers: the slot reads "fixed (calendar)" and never carries the event's title, and a
//       visitation-type event is dropped before it can block anything (memory feedback_visitation-events-are-not-plans).
// LLM-free and deterministic: same record + same day → same plan. Port row: C1032 (placement decides, so it moves to the crate
// beside the walk once the shape holds; MAXIMISE RUST).
import { resolve, dirname, join } from 'node:path';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXED = 'fixed (calendar)';
// "Visitation!!!!", "Teddys Time!" and the Teddy pickup blocks: record, never a plan, never a blocker.
export const VISITATION = /visitation|teddy/i;
export const SLOT_FROM = 7 * 60; export const SLOT_TO = 23 * 60; export const SLOT = 30;
export const PER_DAY = 10;   // a plan the eye can hold; the rest goes to UNPLACED with its source, never dropped
// A kind with more rows than a week holds fills its quota and the rest waits in UNPLACED, so 80 spec answers never bury the
// eight people waiting on a reply. Unlisted kinds have no quota beyond PER_DAY.
export const WEEK_QUOTA = { answer: 14, ask: 14 };
export const PARKED = /^\s*\(?PARKED UNTIL/i;   // a parked row waits on a named event; it is not a possibility this week
const OWED_MAX_DAYS = 21;    // a debt older than three weeks is a COLD-list job (followup-brief), not this week's plan
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The days of the plan in the plan's own time zone (the calendar's when it is known, else the schedule's; never this machine's).
export function planDays(tz, now = new Date(), n = 31) {
  const q = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  const t0 = Date.UTC(Number(q.year), Number(q.month) - 1, Number(q.day));
  return Array.from({ length: n }, (_, i) => { const d = new Date(t0 + i * 864e5); return { day: d.toISOString().slice(0, 10), wd: d.toUTCString().slice(0, 3) }; });
}

// The room whose theme holds a minute of the day.
export function roomAt(min, schedule) {
  for (const r of schedule) { const [a, b] = r.hours.split('-').map((h) => { const [H, M] = h.split(':').map(Number); return H * 60 + M; }); if (min >= a && min < (b === 0 ? 1440 : b)) return r.room; }
  return '';
}

// (b) the possibilities, off the board model and the owed-reply ranker. Every item: { id, text, room, source, due? }.
export function possibilities(b, { owed = [], days }) {
  const first = days[0].day; const last = days[days.length - 1].day;
  const out = [];
  for (const p of b.projects || []) for (const r of p.rows || []) {
    const due = (String(r.headline || '').match(/\b20\d\d-\d\d-\d\d\b/g) || []).filter((d) => d >= first && d <= last).sort()[0];
    if (due && !PARKED.test(r.headline)) out.push({ id: r.id, kind: 'dated', text: r.headline, room: p.owner, due, source: `spec ${r.id} · ${r.spec}:${r.line}` });
  }
  for (const q of b.questions || []) if (!PARKED.test(q.question) && !out.some((x) => x.id === q.id)) out.push({ id: q.id, kind: q.class === 'YOUR-ACT' ? 'act' : 'answer', text: q.question, room: q.owner, source: `spec ${q.id} · ${q.where}` });
  for (const q of [...(b.ledgerQuestions || []), ...(b.ledgerAsks || [])]) if (!out.some((x) => x.id === q.id)) out.push({ id: q.id, kind: 'ask', text: q.text, room: 'architect', source: `transcript ask · ${q.source}` });
  for (const o of owed) {
    if (o.is_group || /^\W*WhatsApp\W*$/.test(String(o.name || ''))) continue;   // the WhatsApp system chat is nobody
    const live = o.state === 'OWED' ? o.daysIn != null && o.daysIn <= OWED_MAX_DAYS : o.state === 'WAITING' && o.daysOut != null && o.daysOut <= OWED_MAX_DAYS + 7;
    if (live) out.push({ id: `T-${o.thread_id}`, kind: o.state === 'OWED' ? 'reply' : 'chase', text: `${o.state === 'OWED' ? 'Reply to' : 'Follow up'} ${o.name} — ${o.why}`, room: 'voice', source: `${o.channel} · ${o.state.toLowerCase()} · thread ${o.thread_id}` });
  }
  const order = { dated: 0, reply: 1, act: 2, chase: 3, answer: 4, ask: 5 };
  return out.sort((x, y) => order[x.kind] - order[y.kind] || String(x.due || '').localeCompare(String(y.due || '')));
}

// The transcript asks the asks ledgers (docs/specs/vna/asks/) still hold open: the NOT DONE and YOUR ACTS bullets of the newest six.
// The QUESTIONS section is read by board.mjs ledgerQuestions(); these two sections had no reader on the board.
export function ledgerAsks(dir = resolve(REPO, 'docs/specs/vna/asks'), n = 6) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((x) => x.endsWith('.txt')).map((x) => ({ x, t: statSync(join(dir, x)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, n);
  const out = [];
  for (const { x } of files) {
    const txt = readFileSync(join(dir, x), 'utf8');
    for (const head of ['NOT DONE', 'YOUR ACTS']) {
      const sec = (txt.split(new RegExp(`═══ ${head}[^\\n]*\\n`))[1] || '').split(/\n═══ /)[0];
      for (const l of sec.split('\n').map((y) => y.trim()).filter((y) => y && !/^\(none/.test(y))) {
        const text = l.replace(/^[•\-\d.]+\s*/, ''); const id = `Q-${createHash('sha1').update(text).digest('hex').slice(0, 8)}`;
        if (!out.some((q) => q.id === id)) out.push({ id, text, source: `docs/specs/vna/asks/${x} · ${head}` });
      }
    }
  }
  return out;
}

// (c) the calendar as blockers: { day → Set(slot minute) }, visitation never, all-day events never (they hold no half-hour).
export function blockers(C) {
  const m = new Map(); let dropped = 0;
  for (const e of (C && C.events) || []) {
    if (VISITATION.test(e.title || '')) { dropped++; continue; }
    if (e.allDay) continue;
    for (let s = SLOT_FROM; s < SLOT_TO; s += SLOT) if (e.start < s + SLOT && e.end > s) { if (!m.has(e.day)) m.set(e.day, new Set()); m.get(e.day).add(s); }
  }
  return { byDay: m, dropped };
}

// The placement: each possibility in authority order to the least-loaded day on or before its due date (inside the week), then to
// the earliest free slot whose theme is its room, else the earliest free slot that day. Deterministic; no slot holds two.
export function planFrom(b, { owed = [], calendar = null, schedule = [], tz = 'America/Los_Angeles', now = new Date(), notes = [] } = {}) {
  const days = planDays(calendar?.tz || tz, now);
  const week = days.slice(0, 7);
  const items = possibilities(b, { owed, days });
  const { byDay, dropped } = blockers(calendar);
  const slots = []; for (let s = SLOT_FROM; s < SLOT_TO; s += SLOT) slots.push(s);
  const used = {}; const cell = new Map(); const load = Object.fromEntries(week.map((d) => [d.day, 0])); const unplaced = []; const placed = [];
  for (const it of items) {
    if (it.due && it.due > week[6].day) { unplaced.push({ ...it, why: `due ${it.due}, past this week — on the Month tab` }); continue; }
    if (WEEK_QUOTA[it.kind] != null && (used[it.kind] || 0) >= WEEK_QUOTA[it.kind]) { unplaced.push({ ...it, why: `past this week's quota of ${WEEK_QUOTA[it.kind]} for ${it.kind} rows` }); continue; }
    const cands = week.filter((d) => (!it.due || d.day <= it.due) && load[d.day] < PER_DAY).sort((x, y) => load[x.day] - load[y.day] || x.day.localeCompare(y.day));
    let hit = null;
    for (const d of cands) {
      const free = slots.filter((s) => !cell.has(`${d.day} ${s}`) && !(byDay.get(d.day) || new Set()).has(s) && !(d.day === week[0].day && s < nowMinute(now, calendar?.tz || tz)));
      const s = free.find((x) => roomAt(x, schedule) === it.room) ?? free[0];
      if (s != null) { hit = { day: d.day, s }; break; }
    }
    if (!hit) { unplaced.push({ ...it, why: it.due ? `no free slot on or before ${it.due}` : 'the week is full' }); continue; }
    cell.set(`${hit.day} ${hit.s}`, it); load[hit.day]++; used[it.kind] = (used[it.kind] || 0) + 1; placed.push({ ...it, day: hit.day, slot: hit.s });
  }
  return { tz: calendar?.tz || tz, days, week, slots, cell, byDay, dropped, items, placed, unplaced, notes, calendarRead: !!calendar };
}
function nowMinute(now, tz) { const q = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value])); return Number(q.hour) * 60 + Number(q.minute); }

export const planCell = (it) => `${clip(it.text, 90)} ⟨${it.source}⟩`;

// The two tabs. Headers stay what the live sheets carry, so typed (fill) cells keep their rows.
export function planTabs(P, schedule, themeAt) {
  const free = (d, s) => ((P.byDay.get(d) || new Set()).has(s) ? FIXED : '');
  const count = (k) => P.items.filter((x) => x.kind === k).length;
  const week = [
    ['TIME', 'THEME (room by hour)', ...P.week.map((d) => `${d.wd} ${d.day}`)],
    ...P.slots.map((s) => [hhmm(s), themeAt(s, schedule), ...P.week.map((d) => { const it = P.cell.get(`${d.day} ${s}`); return it ? planCell(it) : free(d.day, s); })]),
    [],
    ['UNPLACED — on the record, not in a slot this week', 'WHY', 'SOURCE'],
    ...P.unplaced.map((u) => [clip(u.text, 160), u.why, u.source]),
    [],
    [`PLAN · ${P.placed.length} placed of ${P.items.length} possibilities · ${count('dated')} dated spec rows · ${count('reply')} owed replies · ${count('chase')} chases · ${count('act')} your acts · ${count('answer')} your answers · ${count('ask')} transcript asks`],
    [`times in ${P.tz} · each cell names its source in ⟨ ⟩ · calendar ${P.calendarRead ? `read as blockers only, titles never copied, ${P.dropped} never-a-plan event(s) dropped` : 'not read this run (no --calendar): no blockers'} · themes from openclaw/data/thematic-schedule.json`],
    ...P.notes.map((n) => [n]),
    [],
    // The one typed block sits last: filledCells takes the first (fill) row as the header and reads every row under it.
    ['WEEK NOTES', 'NOTE (fill)'],
    ['FOCUS FOR THE WEEK', ''],
    ['TOP PRIORITY', ''],
  ];
  const month = [
    ['DAY', 'WEEKDAY', 'DUE THAT DAY (off the record)', 'PLACED (week plan)', 'FIXED HALF-HOURS (calendar)', 'THEME OF THE DAY (fill)', 'DEADLINE / PRIORITY (fill)'],
    ...P.days.map((d) => [d.day, d.wd, clip(P.items.filter((x) => x.due === d.day).map(planCell).join(' · '), 900), P.placed.filter((x) => x.day === d.day).length || '', (P.byDay.get(d.day) || new Set()).size || '', '', '']),
  ];
  return { week, month };
}

// The owed-reply ranker, read live. A missing spine is UNMEASURED with its reason, never an empty list presented as no debt.
export async function owedReplies() {
  try {
    const { rank } = await import('../chat/followup-brief.mjs'); const { openDb, cutoffs } = await import('../chat/messages-db.mjs');
    const db = openDb();
    // An absence in a stale mirror is a cutoff, not silence: the plan names every mirror that cannot see to now.
    const stale = cutoffs(db).filter((c) => /whatsapp|imessage|email/.test(c.source) && !c.ok).map((c) => `${c.source} sees to ${c.cutoff_ts ? new Date(c.cutoff_ts * 1000).toISOString().slice(0, 16) : '— (no feed)'}`);
    // The whole ranking, never a top-N: the ranker caps debt age at 45d, so ancient threads tie at the top and a cut drops every fresh one.
    return { owed: rank(db, { top: Infinity }), note: stale.length ? `owed replies read up to each mirror's cutoff — STALE: ${stale.join(' · ')}` : null };
  } catch (e) { return { owed: [], note: `owed replies UNMEASURED — ${clip(e && e.message || e, 100)}` }; }
}
export { REPO as PLAN_REPO };
