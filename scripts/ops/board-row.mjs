#!/usr/bin/env node
// scripts/ops/board-row.mjs — C1039: ONE ROW SCHEMA FOR EVERY BOARD LIST, DEFINED ONCE. Operator 2026-10-19, verbatim: "we need a more
// uniform way to show those lists … only has the important information for the human operator" · "don't sort it by priority alone
// sorted by eligibility … most ready to be fired or decided on" · "write this as the /steer and run it untill design maximises org
// skills and useful additively".
//
// Every list on the board leads with the same seven columns, then keeps the tab's own columns to the right (additive: a tab adds
// columns, never replaces these). STATE is read off the record with no model (C1038): ELIGIBLE fires now, SUSPENDED names the one
// predicate holding it, DISPATCHED went to a room, SEALED is closed. Sort: state, priority, target date, rows it unlocks.
// Port row: C1039r — the gate rules decide, so they move into the crate once the board's lists stop changing shape (MAXIMISE RUST).

import { compareRank, tMinus, loadMilestones } from './board-rank.mjs';
export const SHARED = ['ID', 'ENTITY', 'TARGET DATE', 'STATE', 'SUSPENDED BY', 'DISPATCH VECTOR', 'PRIORITY 0–9'];
export const STATE_RANK = { ELIGIBLE: 0, SUSPENDED: 1, DISPATCHED: 2, SEALED: 3 };
// A non-(fill) column that carries a model's guess or a question in prose is sludge on a phone (C1040).
export const SLUDGE_HEAD = /GUESS|ON YOUR MIND|THE QUESTION/i;

export const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const nothing = (s) => !s || /^nothing\b/i.test(String(s).trim());

// "X? (A) … (B) …" → options one per entry: ["A: …", "B: …"].
export function splitAsk(ask) {
  const parts = String(ask || '').split(/\s*\(([A-D])\)\s*/);
  const q = parts[0].replace(/\s*Answer [A-D](?: or [A-D])+\.?\s*$/i, '').trim();
  const opts = []; for (let i = 1; i < parts.length; i += 2) opts.push(`${parts[i]}: ${parts[i + 1].replace(/\s*Answer [A-D](?: or [A-D])+\.?\s*$/i, '').trim()}`);
  return { q, opts };
}

// The gate of one decision: an explicit state on the decision wins; then his answer (an answer is DISPATCHED to the owner room,
// "WAITING FOR: X" is his own suspension); then the head's "waits on" segment; then its fork; then its class.
export function decisionGate(d, answer) {
  const segs = String(d.head || '').split(/\s+·\s+/); const owner = d.owner || 'unowned';
  if (d.state) return { state: d.state, by: d.suspended_by || '', vector: d.dispatch || '' };
  if (answer != null) {
    const w = String(answer).match(/^\s*WAITING FOR:?\s*(.+)$/i);
    if (w) return { state: 'SUSPENDED', by: `External: ${clip(w[1], 80)}`, vector: `${owner} fires it when that lands` };
    return { state: 'DISPATCHED', by: '', vector: `answered "${clip(answer, 40)}" → ${owner}` };
  }
  const wait = segs.find((x) => /^waits on\b/i.test(x));
  if (wait) return { state: 'SUSPENDED', by: `External: ${clip(wait.replace(/^waits on\s*/i, ''), 80)}`, vector: `${owner} fires it when that lands` };
  const { opts } = splitAsk(d.head || d.ask);
  if (opts.length) return { state: 'SUSPENDED', by: `Operator gate: ${opts.map((o) => `(${o[0]}) ${clip(o.slice(3).replace(/\s*·\s*$/, '').split(/:\s/)[0], 40)}`).join(' vs ')}`, vector: `type ${opts.map((o) => o[0]).join(' or ')} in YOUR COMMENT → ${owner}` };
  if (d.class === 'YOUR-ACT') return { state: 'ELIGIBLE', by: '', vector: clip(segs[1] || d.ask, 80) };
  return { state: 'SUSPENDED', by: `Operator input: ${clip(segs[1] || d.ask, 60)}`, vector: `type it in YOUR COMMENT → ${owner}` };
}

// The gate of a spec row or owed act, read off its plain head and class: WAITS ON names the suspension; NEEDS-OPERATOR names what it
// needs; FROM YOU "nothing" means a room fires it now; a send/arm/reply in his words is itself the armed action; any other act of
// his is the gate in front of the room's run.
export function rowGate({ id, you, waits, cls = '', needs = '', why = '' }) {
  // C1039f (cold read 2026-10-20 of Tasks: C78a's red guard hid in the WHY sentence): a tick whose guard went red is ready for a room,
  // and its command says so, with the commit that turned it red.
  const red = String(why || '').match(/^regressed: its guard went red after the tick \((\w+)\)/);
  if (red && nothing(waits) && nothing(you) && cls !== 'NEEDS-OPERATOR' && cls !== 'YOUR-ACT') return { state: 'ELIGIBLE', by: '', vector: `/steer ${id} — guard red since ${red[1]}` };
  if (!nothing(waits)) return { state: 'SUSPENDED', by: `Waits on: ${clip(waits, 80)}`, vector: `/steer ${id}` };
  if (cls === 'NEEDS-OPERATOR' && nothing(you)) return { state: 'SUSPENDED', by: `Operator input: ${clip(needs || 'the row names no need', 140)}`, vector: `type it in COMMENT → /steer ${id}` };
  if (cls === 'YOUR-ACT' && nothing(you)) return { state: 'SUSPENDED', by: `Operator act: ${clip(needs || 'the row names his act and no step yet', 140)}`, vector: `/steer ${id} after it` };
  if (nothing(you)) return { state: 'ELIGIBLE', by: '', vector: `/steer ${id} (a room builds it)` };
  if (/^(send|arm|reply)\b/i.test(String(you).trim())) return { state: 'ELIGIBLE', by: '', vector: clip(you, 80) };
  return { state: 'SUSPENDED', by: `Operator act: ${clip(you, 140)}`, vector: `/steer ${id} after it` };
}

// An asks-ledger question: a STUCK row names its halt; "needs you" names the missing piece.
export function askGate(text) {
  const t = String(text || '');
  const s = t.match(/is STUCK after \d+ dispatch(?:es)? — (.+)$/); if (s) return { state: 'SUSPENDED', by: `Stuck: ${clip(s[1], 80)}`, vector: 'answer in COMMENT → the room re-fires it' };
  const n = t.match(/needs you — (.+)$/); if (n) return { state: 'SUSPENDED', by: `Operator input: ${clip(n[1], 80)}`, vector: 'answer in COMMENT → the room re-fires it' };
  return { state: 'SUSPENDED', by: `Operator input: ${clip(t, 80)}`, vector: 'answer in COMMENT → the asks ledger' };
}

// A terminal's state off the Now tab: at rest takes a message now; working holds a dispatch; prior is closed.
export function terminalGate(stateCell, terminal, topRow = null) {
  const s = String(stateCell || '');
  if (/^AT REST/i.test(s)) return { state: 'ELIGIBLE', by: '', vector: topRow ? `/steer ${topRow} in ${terminal}` : `idle — give ${terminal} a row in COMMENT` };
  if (/^PRIOR/i.test(s)) return { state: 'SEALED', by: '', vector: '—' };
  if (/^(WORKING|LIVE|RUNNING|BUSY)/i.test(s)) return { state: 'DISPATCHED', by: '', vector: `${terminal} is on it` };
  return { state: 'SUSPENDED', by: `Terminal: ${clip(s || 'state unread', 60)}`, vector: `type in COMMENT → ${terminal}` };
}

// A heading shouted in capitals reads as a sentence; a generic heading ("YOUR ACT") is no name at all.
export const plainCase = (t) => { const x = String(t || '').trim(); return /[a-z]/.test(x) ? x : x.charAt(0) + x.slice(1).toLowerCase(); };
export const genericName = (t) => /^(your act|the operator's act|operator act|question|ask).?$/i.test(String(t || '').trim());
export const dateOf = (s) => (String(s || '').match(/\b(\d{4}-\d\d-\d\d)\b/) || [])[1] || '—';
const dateKey = (d) => (/^\d{4}-\d\d-\d\d$/.test(d) ? d : '9999');

// One shared row: the seven columns, then the tab's extras. A blank priority is never written; the caller's derived one is.
// C1039e (cold read 2026-10-20 of Decide and Mailbox: "he cannot tell 'needs me' from 'needs someone else' at a glance"): a gate
// whose label names him (Operator gate · act · input) is marked YOU and sorts first among the suspended; every other gate names
// someone else (External · Waits on · Room · Stuck · Terminal) and stays unmarked.
export const YOU = 'YOU · ';
// C1039h: a WAIT · marker on the other side (C1039g) moved the Decide median from 6 to 5 over three readings each — taken out; a
// layout change stays only when the median rises.
export const isYours = (by) => /^Operator (gate|act|input):/.test(String(by || ''));
export function sharedRow({ id, entity, target = '—', gate, priority, extras = [] }) {
  const p = Number(priority); if (!Number.isFinite(p)) throw new Error(`C1039: ${id} has no priority — the board writes a derived one, never a blank`);
  return [id, clip(entity, 90), target || '—', gate.state, gate.state === 'SUSPENDED' ? (isYours(gate.by) ? YOU + gate.by : (gate.by || 'UNMEASURED — the gate did not name itself')) : '', gate.vector || '—', Math.max(0, Math.min(9, Math.round(p))), ...extras];
}

export function sortShared(rows, unlocks = () => 0) {
  const mine = (r) => (String(r[4]).startsWith(YOU) ? 0 : 1);
  // C1050 — ONE RANKING EVERYWHERE: inside a state, the same comparator Mailbox IN uses (board-rank.mjs compareRank): days to the row's
  // milestone (else its TARGET DATE; none → NO DATE, last), then what it unblocks, then priority (higher first) as the nearness key.
  const today = new Date().toISOString().slice(0, 10); const ms = loadMilestones();
  const key = (r) => { const t = tMinus(r[0], { milestones: ms, today }); const d = dateKey(r[2]); return { id: r[0], days: t ? t.days : d === '9999' ? null : Math.round((Date.parse(d) - Date.parse(today)) / 864e5), unlocks: unlocks(r[0]), near: (9 - (Number(r[6]) || 0)) / 9 }; };
  return rows.slice().sort((a, b) => STATE_RANK[a[3]] - STATE_RANK[b[3]] || mine(a) - mine(b) || compareRank(key(a), key(b)));
}

// Re-project a tab that already exists (head + rows) onto the shared schema, additively: the shared seven first, then every column of
// the tab that is not redundant with them and not sludge, (fill) columns kept by their exact header so his cells carry across.
// `gateOf(at, row)` and `entityOf(at, row)` read the tab's own cells through `at(header)`.
export function project(table, { gateOf, entityOf, priorityOf = (at) => at('PRIORITY 0–9'), targetOf = (at) => dateOf(at('WHY THIS PRIORITY') || at('WHY (derived)')), drop = [], isRow = (r) => r && r.length > 1 && String(r[0] || '').trim() !== '', groupCol = null, unlocks } = {}) {
  if (!table || !table.length) return [[...SHARED, 'UNMEASURED — this tab did not compose']];
  const head = table[0]; const fill = (h) => /\(fill\)\s*$/.test(h);
  const redundant = new Set(['ID', 'PRIORITY 0–9', 'FROM YOU', 'WAITS ON', ...drop]);
  const keep = head.map((h, i) => [h, i]).filter(([h]) => fill(h) || (!redundant.has(h) && !SLUDGE_HEAD.test(h)));
  const extrasHead = [...(groupCol ? [groupCol] : []), ...keep.map(([h]) => h)];
  let group = ''; const out = [];
  for (const r of table.slice(1)) {
    if (groupCol && r && r.filter((c) => String(c ?? '').trim() !== '').length === 1 && String(r[0] || '').trim()) { group = String(r[0]).split(' · ')[0]; continue; }
    if (!isRow(r)) continue;
    const at = (h) => { const i = head.indexOf(h); return i >= 0 ? r[i] ?? '' : ''; };
    const gate = gateOf(at, r);
    out.push(sharedRow({ id: r[0], entity: entityOf(at, r), target: targetOf(at, r), gate, priority: priorityOf(at, r), extras: [...(groupCol ? [group] : []), ...keep.map(([, i]) => r[i] ?? '')] }));
  }
  // C1039b (cold read 2026-10-20: "every row repeats the same … boilerplate across six columns"): a column whose rows hold at most one
  // distinct value tells him nothing; it drops. His (fill) columns always stay.
  const n = SHARED.length; const live = extrasHead.map((h, j) => /\(fill\)\s*$/.test(h) || new Set(out.map((r) => String(r[n + j] ?? '').trim()).filter(Boolean)).size > 1);
  return [[...SHARED, ...extrasHead.filter((_, j) => live[j])], ...sortShared(out, unlocks).map((r) => [...r.slice(0, n), ...r.slice(n).filter((_, j) => live[j])])];
}

// C1040: every finding of sludge across a composed book — a non-(fill) header carrying a guess or a question in prose, a blank
// PRIORITY on a shared-schema tab, a SUSPENDED row whose gate names nothing. Empty array = clean.
export function sludgeFindings(tabs) {
  const out = [];
  for (const [name, rows] of tabs) {
    const head = (rows && rows[0]) || [];
    for (const h of head) if (!/\(fill\)\s*$/.test(String(h)) && SLUDGE_HEAD.test(String(h))) out.push(`${name}: column "${h}" carries a guess or a question in prose`);
    const p = head.indexOf('PRIORITY 0–9'); const st = head.indexOf('STATE'); const by = head.indexOf('SUSPENDED BY');
    if (!SHARED.every((c, i) => head[i] === c)) continue;   // a non-list tab (Map, Tiles) answers to the header rule only — Mailbox now leads with SHARED too (C1041)
    for (const r of rows.slice(1)) {
      if (!r || !String(r[0] ?? '').trim() || String(r[0]).startsWith('=') || !(r[st] in STATE_RANK)) continue;   // footer and formula lines
      if (r[p] === '' || r[p] == null || !Number.isInteger(Number(r[p]))) out.push(`${name}: ${r[0]} has a blank priority`);
      if (r[st] === 'SUSPENDED' && !String(r[by] ?? '').trim()) out.push(`${name}: ${r[0]} is SUSPENDED and names no gate`);
    }
  }
  return out;
}

// C1039j (three Decide readings, 2026-10-20: "Waits on: C510 — that ID isn't resolved to a name or reason anywhere in this view"):
// every row id inside a "Waits on:" gate gains its short name, read off its own spec line (open or ticked); a ticked one reads
// "done", which tells him the wait itself is stale. `nameOf(id)` returns { name, ticked } or null; ids it cannot find stay bare.
export function nameWaits(rows, nameOf) {
  if (!rows || !rows.length || !SHARED.every((c, i) => rows[0][i] === c)) return rows;
  // A wait whose every named row is ticked is no wait: the row is ELIGIBLE and re-sorts among the ready (C635f sat on a done C510).
  let moved = false;
  const out = rows.map((r, i) => {
    if (!i || !r || !/^Waits on: /.test(String(r[4] || ''))) return r;
    const ids = String(r[4]).match(/\bC\d+[a-z]?\d*\b/g) || []; const found = ids.map(nameOf);
    if (ids.length && found.every((n) => n && n.ticked)) { moved = true; return [...r.slice(0, 3), 'ELIGIBLE', '', `/steer ${r[0]} (${ids.join(', ')} done)`, ...r.slice(6)]; }
    const by = String(r[4]).replace(/\b(C\d+[a-z]?\d*)\b(?! \()/g, (id) => { const n = nameOf(id); return n ? `${id} (${n.ticked ? 'done' : n.name})` : id; });
    return [...r.slice(0, 4), by, ...r.slice(5)];
  });
  if (!moved) return out;
  const data = out.slice(1).filter((r) => r && r[3] in STATE_RANK); const rest = out.slice(1).filter((r) => !(r && r[3] in STATE_RANK));
  return [out[0], ...sortShared(data), ...rest];
}
