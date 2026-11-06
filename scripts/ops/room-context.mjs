#!/usr/bin/env node
// scripts/ops/room-context.mjs — THE OVERVIEW EFFECT: what is in context in each of the 9
// terminals/rooms RIGHT NOW, WHAT CAN BE CONTINUED THERE, plus per-room activity metrics,
// extracted from the Claude Code session transcripts.
//
// TWO HALVES, AND ONLY ONE OF THEM IS LLM-FREE. Extraction — which turns ran where, the counts,
// the bars, the continuation points, the routed queues — is deterministic and stays that way.
// INTERPRETATION — the NAME of each strand and the sentence saying what is going on — is a
// reading, and a reading is not something extraction can produce (operator 2026-08-24: "I asked
// not for quotes but summaries labeled named descriptions of what is going on ... the format is
// nice, but there is no interpretation"). annotateOverview() adds that half through
// thread-name.mjs (local qwen, off the receipt path, off the interactive path); the footer says
// which half you are reading and degrades to the raw ask when no reading was obtained.
//
// WHAT CONTINUES WHERE (operator 2026-08-07): the overview answered "where is the context"
// but not "what can I pick up here". Each room now carries a deterministic ▶ CONTINUE HERE
// list, subdivided from three orthogonal sources and never from a model:
//   ↩ continue  — the LAST user turn of each transcript session in that room (where it stopped)
//   ⇄ queued    — human-authored pending bifurcations routed TO that room (the signed ledger)
//   ⏰ scheduled — pending self-prompts owned by that room, soonest due first
// Auto commit-QC delegations are COUNTED, never listed (thousands of them would bury the rest).
//
// WHY (operator 2026-08-06): "I often drift from the intent in a terminal and work on things
// that are not associated with the theme of the room, which is fine — we need to add WHAT IS
// WHERE ... the main reason is to jump back into the right room easier instead of starting in
// a different room than where the context is." Drift is not judged here (that would be a model
// call); the room's declared THEME and its LIVE CONTEXT are shown side by side so the operator
// reads the drift at a glance and re-enters where the context actually lives.
//
// Consumers:
//   · prompt-digest.mjs — appends renderOverviewHtml() to every digest email body
//   · .workflow/rooms/<terminal>-<room>.html — injectIntoRoomPages() maintains a
//     <!-- ROOM-OVERVIEW:START/END --> block on each of the 9 pages (idempotent)
//   · .thetacog/cache/room-overview.{json,html} — standalone artifacts for room.sh / next
//
// CLI:
//   node scripts/ops/room-context.mjs --dry      # print the per-room summary, write nothing
//   node scripts/ops/room-context.mjs --inject   # write json+html and refresh all 9 room pages
//
// Guard: tests/ops/room-context.test.mjs (shape · attribution · idempotent injection · wiring)

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { extractTurns, PROJECT_DIR } from './prompt-digest.mjs';
import { nameItems, namingSummary, MODEL as NAME_MODEL } from './thread-name.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ── rooms: the canonical 9, from data/rooms.json (single source of truth — never inline copies)
export function loadRooms(repo = REPO) {
  const j = JSON.parse(readFileSync(join(repo, 'data', 'rooms.json'), 'utf8'));
  return j.rooms || j;
}

// ── roomOf: terminal label from the lens receipt ("🎤 voice (Apple_Terminal)") → room key.
// Matches on the room KEY as a word, falling back to the room emoji. Null when unattributable.
export function roomOf(terminalLabel, rooms) {
  const s = String(terminalLabel || '').toLowerCase();
  if (!s || s.includes('unknown terminal')) return null;
  for (const key of Object.keys(rooms)) {
    if (new RegExp(`\\b${key}\\b`).test(s)) return key;
  }
  for (const [key, r] of Object.entries(rooms)) {
    if (r.emoji && terminalLabel.includes(r.emoji)) return key;
  }
  return null;
}

const snip = (t, n = 170) =>
  String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (t) =>
  String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── cleanPrompt: strip the harness scaffolding off a user turn so what remains is the
// operator's actual ask. The hook receipt, system-reminders and slash-command envelopes are
// machine text — left in, they drown the ask and every "next task" reads like the lens block.
export function cleanPrompt(text) {
  return String(text || '')
    .replace(/\n*UserPromptSubmit hook additional context:[\s\S]*$/, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, ' ')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, ' ')
    .replace(/<command-(name|message|args)>([\s\S]*?)<\/command-\1>/g, ' $2 ')
    .replace(/Caveat: The messages below[^\n]*\n?/g, ' ')
    .replace(/\[Request interrupted[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── sessionNotes: the last few turns of ONE session, most recent first, as the raw strand the
// interpretation layer reads. This is never rendered — it is the INPUT that lets thread-name.mjs
// say what is going on rather than echo a 170-character slice. A single last-prompt is often a
// correction ("nope - do this for transcripts of today") that is meaningless without the turns
// around it; three turns carry the thread.
export function sessionNotes(list, session, cap = 3) {
  const mine = list.filter(t => t.session === session).sort((a, b) => b.ts - a.ts).slice(0, cap);
  const out = [];
  for (const t of mine) {
    const ask = cleanPrompt(t.human);
    if (ask) out.push(`[asked] ${snip(ask, 420)}`);
    const said = cleanPrompt(t.claude);
    if (said) out.push(`[replied] ${snip(said, 420)}`);
  }
  return out.join('\n');
}

// A turn that carries no direction — session hygiene, not work. Never a continuation point.
const TRIVIAL = /^(\/(clear|model|compact|cost|help|resume|exit|status|config)\b.*|y|n|ok|okay|yes|no|go|go on|continue|proceed|next|push|commit|thanks|thank you|do it|yep|nope|stop|\.|\?)$/i;
export const isContinuable = (s) => s.length >= 12 && !TRIVIAL.test(s.trim());

// ── continuationPoints: THE PREDICTION, LLM-FREE. A session's LAST user turn in this room is
// where that thread stopped — so it is, deterministically, what can be continued there. One
// point per session (not per turn), freshest first, near-duplicates collapsed.
export function continuationPoints(list, cap = 3) {
  const lastBySession = new Map();
  for (const t of list) {
    const prev = lastBySession.get(t.session);
    if (!prev || t.ts > prev.ts) lastBySession.set(t.session, t);
  }
  const seen = new Set(); const out = [];
  for (const t of [...lastBySession.values()].sort((a, b) => b.ts - a.ts)) {
    const ask = cleanPrompt(t.human);
    if (!isContinuable(ask)) continue;
    const key = ask.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      session: t.session, at: new Date(t.ts).toISOString(), ask: snip(ask, 190),
      notes: sessionNotes(list, t.session),
    });
    if (out.length >= cap) break;
  }
  return out;
}

// ── machineIssued: which turns in a receipt-less bucket were ISSUED BY A PROGRAM rather than
// typed by the operator. MEASURED 2026-08-24: 331 turns in 7 days carried no room receipt and
// the overview rendered all of them as one grey footnote — but 90 of them were real operator
// asks ("can you control my imessage as well as whatsapp databases from here?"), invisible in
// an artifact whose whole job is to say where the work is.
//
// The construct, not a proxy for it (CLAUDE.md, THE PROXY IS NOT THE THING): a program's prompt
// is a TEMPLATE, and a template's tell is that the same long head appears in two or more
// DISTINCT sessions — 70 identical shoot-kit prompts, 80 identical spec prompts, 28 identical
// founder-box prompts. Grepping for "You are" would be the proxy; counting distinct sessions
// per head is the thing itself. The one shape that template-counting genuinely cannot catch is
// a dispatch fired ONCE — a room-agent subtask, unique because the room name is in it — so the
// second clause tests the other real property: a prompt that opens by assigning a role to its
// reader is a system prompt, and nobody types one into their own terminal.
// A ROLE ASSIGNMENT opens by telling its reader who they are or what they are doing —
// `You are the 🔨 builder room agent`, `You are reading ONE milestone sub-point`, `You are
// rewriting ONE sentence inside a book passage`. MEASURED 2026-08-25: the first version only
// matched the article form and let ~10 single-turn narration prompts per run through as though a
// person had typed them, which both polluted the session log and — far worse — reset the idle
// clock that decides the work session ended. The two shapes are an ARTICLE (a role noun) or a
// GERUND (a task), and requiring one of them is what keeps `you are wrong about the panel` —
// a thing the operator genuinely types — on the human side of the line.
const ROLE_ASSIGNMENT = /^\s*you are (?:(?:the|a|an)\b|\w+ing\b)/i;
// ...AND IT CARRIES THE JOB WITH IT. The opening clause alone is not the construct: "you are
// missing the point — I asked for summaries not quotes" is a gerund and a person typed it. What
// separates an assignment from a remark is that an assignment must SPECIFY the work, so it
// cannot fit in a conversational clause — the real ones run 108 to 400+ characters ("You are
// the 🔨 builder room agent (The Builder) ... executing ONE delegated subtask"), and the real
// remarks run 50 to 59. The floor is where those two populations separate, and it is the
// carries-its-task property being measured, not the length for its own sake.
const ROLE_MIN_CHARS = 80;
const TEMPLATE_MIN_CHARS = 120;
export function machineIssued(list) {
  const sessionsByHead = new Map();
  const head = (t) => cleanPrompt(t.human).slice(0, 200).toLowerCase();
  for (const t of list) {
    const h = head(t);
    if (!sessionsByHead.has(h)) sessionsByHead.set(h, new Set());
    sessionsByHead.get(h).add(t.session);
  }
  return (t) => {
    const h = head(t);
    if (ROLE_ASSIGNMENT.test(h) && h.length >= ROLE_MIN_CHARS) return true;
    return h.length >= TEMPLATE_MIN_CHARS && (sessionsByHead.get(h)?.size || 0) >= 2;
  };
}

// ── splitOffRoom: the receipt-less turns, separated. The human half earns a real card; the
// machine half is COUNTED with its top templates named, never listed turn by turn — the same
// discipline the auto commit-QC queue already gets, and for the same reason.
export function splitOffRoom(list) {
  const isMachine = machineIssued(list);
  const human = [], machine = [];
  for (const t of list) (isMachine(t) ? machine : human).push(t);
  const byHead = new Map();
  for (const t of machine) {
    const h = cleanPrompt(t.human).slice(0, 90);
    byHead.set(h, (byHead.get(h) || 0) + 1);
  }
  const templates = [...byHead.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([head, count]) => ({ head: snip(head, 70), count }));
  return { human, machine, templates };
}

// ── loadQueues: the durable work already ROUTED to a room — pending bifurcations (the signed
// delegation ledger) and pending self-prompts. Auto commit-QC asks are counted, never listed:
// there are thousands and they'd bury the human-authored ones.
export function loadQueues(repo = REPO) {
  const q = { queued: {}, scheduled: {}, autoQc: {} };
  try {
    const b = JSON.parse(readFileSync(join(repo, 'data', 'room-bifurcations.json'), 'utf8'));
    for (const x of (b.bifurcations || [])) {
      if (x.status !== 'pending' || !x.to_room) continue;
      if (/^QC:/.test(x.action || '') || /Shape-max-match delegation/.test(x.context || '')) {
        q.autoQc[x.to_room] = (q.autoQc[x.to_room] || 0) + 1; continue;
      }
      (q.queued[x.to_room] ||= []).push({
        id: x.id, from: x.from_room || '', at: x.created_at || '', ask: snip(x.action, 190),
        notes: snip(`[asked] ${x.action || ''} ${x.context || ''}`, 1200),
      });
    }
    for (const k of Object.keys(q.queued)) q.queued[k].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  } catch { /* ledger absent → honest empty, never invented */ }
  try {
    const s = JSON.parse(readFileSync(join(repo, 'data', 'self-prompts.json'), 'utf8'));
    for (const p of (s.prompts || [])) {
      if (!p.room || (p.status && p.status !== 'pending')) continue;
      (q.scheduled[p.room] ||= []).push({
        id: p.id, due: p.due_at || '', ask: snip(p.action, 190),
        notes: snip(`[asked] ${p.action || ''} ${p.context || ''}`, 1200),
      });
    }
    for (const k of Object.keys(q.scheduled)) q.scheduled[k].sort((a, b) => Date.parse(a.due || 0) - Date.parse(b.due || 0));
  } catch { /* same */ }
  return q;
}

// ── buildRoomOverview: records → per-room { theme, current context, metrics }. Pure, testable.
// Window: 7 days of turns feed the metrics; the LAST turn per room is "what is in context now".
export function buildRoomOverview(records, now = Date.now(), rooms = loadRooms(), queues = loadQueues()) {
  const turns = extractTurns(records, now - 7 * 864e5);
  const byRoom = new Map(Object.keys(rooms).map(k => [k, []]));
  const unattributed = [];
  for (const t of turns) {
    const k = roomOf(t.terminal, rooms);
    if (k) byRoom.get(k).push(t); else unattributed.push(t);
  }
  const bucket = (list) => {
    const last = list[list.length - 1] || null;
    const inWin = (h) => list.filter(t => t.ts >= now - h * 3600e3).length;
    // perDay: prompts per UTC day, oldest→today (7 slots) — the bar chart's data
    const perDay = Array.from({ length: 7 }, (_, i) => {
      const dayEnd = now - (6 - i) * 864e5;
      const dayStart = dayEnd - 864e5;
      return list.filter(t => t.ts > dayStart && t.ts <= dayEnd).length;
    });
    return {
      lastActive: last ? new Date(last.ts).toISOString() : null,
      activeNow: !!last && (now - last.ts) < 2 * 3600e3,          // touched in the last 2h
      context: last ? {
        session: last.session,
        cwd: last.cwd ? last.cwd.replace(os.homedir(), '~') : '',
        you: snip(last.human),
        claude: snip(last.claude),
        notes: sessionNotes(list, last.session),
      } : null,
      prompts24h: inWin(24),
      prompts36h: inWin(36),
      prompts7d: list.length,
      perDay,
      promptsPerDay: Math.round((list.length / 7) * 10) / 10,
      sessions36h: new Set(list.filter(t => t.ts >= now - 36 * 3600e3).map(t => t.session)).size,
    };
  };
  // unattributed stays the FULL receipt-less count (unchanged surface for existing consumers);
  // offRoom is the half a person actually typed, given the same treatment a room gets.
  const split = splitOffRoom(unattributed);
  const out = {
    generated: new Date(now).toISOString(), rooms: {}, unattributed: bucket(unattributed),
    offRoom: {
      ...bucket(split.human),
      next: { continue: continuationPoints(split.human), queued: [], scheduled: [], autoQc: 0 },
      machineTurns: split.machine.length, templates: split.templates,
    },
  };
  for (const [k, list] of byRoom) {
    const r = rooms[k] || {};
    out.rooms[k] = {
      emoji: r.emoji || '', terminal: r.terminal || '',
      theme: snip(r.blurb || r.persona || (Array.isArray(r.vector_keywords) ? r.vector_keywords.join(' ') : ''), 110),
      ...bucket(list),
      // WHAT CAN BE CONTINUED HERE — three orthogonal sources, none of them a model:
      //   continue  = where each transcript thread in this room stopped
      //   queued    = human-authored delegations the mesh routed to this room
      //   scheduled = time-released self-prompts owned by this room
      next: {
        continue: continuationPoints(list),
        queued: (queues.queued?.[k] || []).slice(0, 3),
        scheduled: (queues.scheduled?.[k] || []).slice(0, 2),
        autoQc: queues.autoQc?.[k] || 0,
      },
    };
  }
  out.nextTotals = Object.fromEntries(Object.entries(out.rooms).map(([k, r]) =>
    [k, r.next.continue.length + r.next.queued.length + r.next.scheduled.length]));
  return out;
}

// ── annotateOverview: decorate every strand in an overview with {name, why} — the ONE async,
// model-touching step. buildRoomOverview stays pure and synchronous; a caller that skips this
// gets exactly the old extraction-only artifact, which is what the honest degradation path is.
// Items are collected across all rooms and named in ONE bounded fan-out, never a per-room loop.
export async function annotateOverview(ov, opts = {}) {
  const items = []; const sinks = [];
  const add = (obj) => {
    if (!obj || !obj.notes) return;
    const id = `s${items.length}`;
    items.push({ id, notes: obj.notes });
    sinks.push([id, obj]);
  };
  for (const r of [...Object.values(ov.rooms || {}), ov.offRoom].filter(Boolean)) {
    add(r.context);
    for (const c of r.next?.continue || []) add(c);
    for (const q of r.next?.queued || []) add(q);
    for (const sp of r.next?.scheduled || []) add(sp);
  }
  const named = await nameItems(items, opts);
  for (const [id, obj] of sinks) {
    const n = named.get(id);
    if (!n) continue;
    obj.name = n.name; obj.why = n.why; obj.namedBy = n.source;
  }
  ov.naming = { model: NAME_MODEL, ...namingSummary(named, { model: NAME_MODEL }) };
  return ov;
}

const rel = (iso, now) => {
  if (!iso) return 'no activity (7d)';
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

// ── barChart: 7-day prompts-per-day as inline-block bars (Gmail-safe: no SVG, no data: URIs,
// no JS — pure divs). Today is the rightmost, darkest bar; height normalized to the room's max.
export function barChart(perDay = [], color = '#4a7c59') {
  const max = Math.max(1, ...perDay);
  const bars = perDay.map((v, i) => {
    const h = v === 0 ? 2 : Math.max(4, Math.round((v / max) * 26));
    const c = i === perDay.length - 1 ? color : `${color}99`;
    return `<td style="vertical-align:bottom;padding:0 1px"><div title="${v}" style="width:9px;height:${h}px;background:${v === 0 ? '#ddd' : c};border-radius:1px"></div></td>`;
  }).join('');
  return `<table role="presentation" style="border-collapse:collapse;display:inline-table"><tr>${bars}</tr></table>`;
}

// ── renderOverviewHtml: ONE fragment used verbatim by email body, room pages, and the
// standalone cache page. Inline styles only (Gmail-safe), no data: URIs, no external assets.
// ── renderNextHtml: the "▶ CONTINUE HERE" strip on a room card. Empty string when the room
// truly has nothing pending — an invented next step is worse than an honest blank.
export function renderNextHtml(next, now) {
  if (!next) return '';
  const rows = [];
  // body(): the named description when a reading exists, the raw ask when it does not. Never
  // both — the whole complaint was that a sliced quote is not a summary, and a quote wearing a
  // label beside it is the same artifact with more ink.
  const body = (it) => it.name && it.why
    ? `<b>${esc(it.name)}</b> — ${esc(it.why)}`
    : esc(it.ask);
  for (const c of next.continue || []) rows.push(
    `<li style="margin:3px 0"><span style="color:#1c6b3c">↩ thread</span> ${body(c)} <span style="color:#bbb">· ${esc(c.session)} · ${rel(c.at, now)}</span></li>`);
  for (const q of next.queued || []) rows.push(
    `<li style="margin:3px 0"><span style="color:#7a4bbf">⇄ ${esc(q.from || '?')}→</span> ${body(q)} <span style="color:#bbb">· ${esc(q.id)} · ${rel(q.at, now)}</span></li>`);
  for (const s of next.scheduled || []) rows.push(
    `<li style="margin:3px 0"><span style="color:#a66d00">⏰ due</span> ${body(s)} <span style="color:#bbb">· ${esc(s.id)} · ${esc(String(s.due || '').slice(0, 10))}</span></li>`);
  const qc = next.autoQc ? `<div style="color:#bbb;font-size:11px;margin-top:2px">+ ${next.autoQc} auto commit-QC ask(s) queued (not listed)</div>` : '';
  if (!rows.length) return qc || '';
  return `<div style="margin-top:8px;border-top:1px dashed #e2e5ea;padding-top:6px">
    <div style="font-size:11px;color:#888;letter-spacing:.08em">▶ CONTINUE HERE</div>
    <ul style="margin:4px 0 0;padding-left:16px;font-size:12px;line-height:1.5">${rows.join('')}</ul>${qc}</div>`;
}

export function renderOverviewHtml(ov, { title = 'WHAT IS WHERE · WHAT CONTINUES WHERE — the 9 terminals right now' } = {}) {
  const now = Date.parse(ov.generated);
  const keys = Object.keys(ov.rooms)
    .sort((a, b) => (Date.parse(ov.rooms[b].lastActive || 0) || 0) - (Date.parse(ov.rooms[a].lastActive || 0) || 0));
  const totals = keys.reduce((s, k) => s + ov.rooms[k].prompts36h, 0);
  const liveCount = keys.filter(k => ov.rooms[k].activeNow).length;
  const nextCount = (k) => { const n = ov.rooms[k].next; return n ? (n.continue?.length || 0) + (n.queued?.length || 0) + (n.scheduled?.length || 0) : 0; };
  const offNext = ov.offRoom?.next
    ? (ov.offRoom.next.continue?.length || 0) + (ov.offRoom.next.queued?.length || 0) + (ov.offRoom.next.scheduled?.length || 0) : 0;
  const nextTotal = keys.reduce((s, k) => s + nextCount(k), 0) + offNext;
  const nextRooms = keys.filter(k => nextCount(k) > 0).length + (offNext ? 1 : 0);
  const cards = keys.map(k => {
    const r = ov.rooms[k];
    const live = r.activeNow ? '🟢' : (r.lastActive ? '⚪' : '⚫');
    const accent = r.activeNow ? '#1c6b3c' : (r.lastActive ? '#8a8f98' : '#c4c8cf');
    const read = r.context && r.context.name && r.context.why
      ? `<div style="margin-top:6px;font-size:13px;line-height:1.45"><b>${esc(r.context.name)}</b></div>` +
        `<div style="font-size:12px;line-height:1.5;color:#444">${esc(r.context.why)}</div>`
      : '';
    const quote = r.context
      ? `<div style="color:#b3b8c0;font-size:11px;line-height:1.4;margin-top:${read ? '4' : '6'}px">` +
        `YOU: ${esc(snip(r.context.you, 95))} · CC: ${esc(snip(r.context.claude, 95)) || '(tool-only turn)'}</div>`
      : '';
    const ctx = r.context
      ? read + quote +
        `<div style="color:#aaa;font-size:11px;margin-top:2px">session ${esc(r.context.session)} · ${esc(r.context.cwd)} · ${rel(r.lastActive, now)}</div>`
      : `<div style="color:#aaa;font-size:12px;margin-top:6px">dark — no context in 7 days · a delegation target</div>`;
    return `<div style="border:1px solid #e2e5ea;border-left:4px solid ${accent};border-radius:6px;padding:10px 12px;margin:0 0 10px;background:#fff">
      <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
        <td style="vertical-align:top">
          <div style="font-size:15px"><b>${live} ${r.emoji} ${esc(k)}</b> <span style="color:#999;font-size:12px">· ${esc(r.terminal)}</span></div>
          <div style="color:#a66d00;font-size:11px;margin-top:2px">theme: ${esc(r.theme)}</div>
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap;width:130px">
          ${barChart(r.perDay)}<br>
          <span style="font-size:11px;color:#888">${r.prompts24h}/24h · ${r.prompts36h}/36h · ${r.promptsPerDay}/day</span>
        </td>
      </tr></table>
      ${ctx}
      ${renderNextHtml(r.next, now)}
    </div>`;
  }).join('\n');
  // OFF-ROOM (2026-08-24): work that carried no terminal receipt used to be one grey footnote.
  // Most of it IS machine chatter and stays a count — but the half a person typed gets a card,
  // because "329 turns you cannot see" is the opposite of what this artifact is for.
  const o = ov.offRoom;
  const offCard = o && o.prompts7d ? (() => {
    const read = o.context && o.context.name && o.context.why
      ? `<div style="margin-top:6px;font-size:13px;line-height:1.45"><b>${esc(o.context.name)}</b></div>` +
        `<div style="font-size:12px;line-height:1.5;color:#444">${esc(o.context.why)}</div>` : '';
    const quote = o.context
      ? `<div style="color:#b3b8c0;font-size:11px;line-height:1.4;margin-top:${read ? '4' : '6'}px">` +
        `YOU: ${esc(snip(o.context.you, 95))} · CC: ${esc(snip(o.context.claude, 95)) || '(tool-only turn)'}</div>` +
        `<div style="color:#aaa;font-size:11px;margin-top:2px">session ${esc(o.context.session)} · ${esc(o.context.cwd)} · ${rel(o.lastActive, now)}</div>`
      : '';
    const tpl = (o.templates || []).length
      ? `<div style="color:#bbb;font-size:11px;margin-top:4px">+ ${o.machineTurns} machine-issued turn(s) not listed — ` +
        (o.templates || []).map(t => `${t.count}× ${esc(t.head)}`).join(' · ') + `</div>`
      : (o.machineTurns ? `<div style="color:#bbb;font-size:11px;margin-top:4px">+ ${o.machineTurns} machine-issued turn(s) not listed</div>` : '');
    return `<div style="border:1px solid #e2e5ea;border-left:4px solid #8a8f98;border-radius:6px;padding:10px 12px;margin:0 0 10px;background:#fff">
      <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
        <td style="vertical-align:top">
          <div style="font-size:15px"><b>${o.activeNow ? '🟢' : '⚪'} 🛰️ off-room</b> <span style="color:#999;font-size:12px">· typed with no terminal receipt (mobile · web · headless)</span></div>
          <div style="color:#a66d00;font-size:11px;margin-top:2px">theme: none declared — this is where work lands when the room cannot be identified</div>
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap;width:130px">
          ${barChart(o.perDay, '#8a8f98')}<br>
          <span style="font-size:11px;color:#888">${o.prompts24h}/24h · ${o.prompts36h}/36h · ${o.promptsPerDay}/day</span>
        </td>
      </tr></table>
      ${read}${quote}${renderNextHtml(o.next, now)}${tpl}
    </div>`;
  })() : '';
  const un = '';
  return `<div data-room-overview="1" style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px">
  <h3 style="margin:18px 0 2px">🗺️ ${esc(title)}</h3>
  <p style="color:#666;font-size:12px;margin:0 0 10px">${liveCount} live · ${totals} prompts/36h across rooms · ${nextTotal} continuable item(s) across ${nextRooms} room(s) · bars = prompts/day, last 7 days (right = today) · live context vs theme, drift yours to read · generated ${esc(ov.generated)} · ${esc(ov.naming?.line || 'extraction only — no reading in this run')}.</p>
  ${cards}${offCard}${un}</div>`;
}

// ── injectIntoRoomPages: maintain the overview block on each room page, idempotently, between
// markers (replace if present, else insert before </body>, else append). Returns count injected.
export const MARK_START = '<!-- ROOM-OVERVIEW:START (generated by scripts/ops/room-context.mjs — do not hand-edit this block) -->';
export const MARK_END = '<!-- ROOM-OVERVIEW:END -->';
export function injectOverview(html, fragment) {
  const block = `${MARK_START}\n${fragment}\n${MARK_END}`;
  const re = new RegExp(`${MARK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (re.test(html)) return html.replace(re, block);
  if (html.includes('</body>')) return html.replace('</body>', `${block}\n</body>`);
  return html + '\n' + block + '\n';
}
export function injectIntoRoomPages(fragment, rooms = loadRooms(), repo = REPO) {
  let n = 0;
  for (const r of Object.values(rooms)) {
    if (!r.html_path) continue;
    const p = join(repo, r.html_path);
    if (!existsSync(p)) continue;
    writeFileSync(p, injectOverview(readFileSync(p, 'utf8'), fragment));
    n++;
  }
  return n;
}

// ── loadRecords: same shape as prompt-digest's (kept local — its loader is not exported).
export function loadRecords(dir = PROJECT_DIR) {
  const records = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    let raw; try { raw = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* partial line */ }
    }
  }
  records.sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0));
  return records;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const ov = buildRoomOverview(loadRecords());
  if (!process.argv.includes('--no-name')) {
    try { await annotateOverview(ov); } catch (e) { console.error('⚠ naming skipped:', String(e.message).slice(0, 160)); }
  }
  const frag = renderOverviewHtml(ov);
  if (dry) {
    for (const [k, r] of Object.entries(ov.rooms)) {
      const n = r.next || {};
      // the CLI line leads with a READING wherever one exists — the room's own strand first,
      // then its freshest routed item; the raw ask is the last resort, same as the cards.
      const named = [r.context, (n.continue || [])[0], (n.queued || [])[0], (n.scheduled || [])[0]].find(x => x && x.name && x.why);
      const head = named ? `${named.name} — ${named.why}` : null;
      console.log(`${r.activeNow ? '🟢' : '⚪'} ${r.emoji} ${k.padEnd(10)} ${String(r.prompts36h).padStart(3)}/36h  ${rel(r.lastActive, Date.parse(ov.generated)).padEnd(9)} ▶${(n.continue || []).length}↩ ${(n.queued || []).length}⇄ ${(n.scheduled || []).length}⏰  ${(head || (n.continue || [])[0]?.ask || (n.queued || [])[0]?.ask || '—').slice(0, 110)}`);
    }
    const o = ov.offRoom;
    if (o?.prompts7d) {
      const oh = o.context?.name ? `${o.context.name} — ${o.context.why || ''}` : (o.next?.continue?.[0]?.ask || '—');
      console.log(`${o.activeNow ? '🟢' : '⚪'} 🛰️ ${'off-room'.padEnd(10)} ${String(o.prompts36h).padStart(3)}/36h  ${rel(o.lastActive, Date.parse(ov.generated)).padEnd(9)} ▶${(o.next?.continue || []).length}↩ 0⇄ 0⏰  ${oh.slice(0, 110)}`);
      console.log(`   off-room: ${o.prompts7d} typed / ${o.machineTurns} machine-issued in 7d`);
    }
    console.log(`   naming: ${ov.naming?.line || 'extraction only'}`);
    return;
  }
  const cache = join(REPO, '.thetacog', 'cache');
  writeFileSync(join(cache, 'room-overview.json'), JSON.stringify(ov, null, 1));
  writeFileSync(join(cache, 'room-overview.html'),
    `<!doctype html><meta charset="utf-8"><title>Room overview</title><body style="max-width:900px;margin:24px auto">${frag}</body>`);
  const n = injectIntoRoomPages(frag);
  console.log(`🗺️ room-overview: json+html written · injected into ${n} room page(s)`);
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
