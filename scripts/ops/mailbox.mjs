#!/usr/bin/env node
// scripts/ops/mailbox.mjs — C1042 THE MAILBOX: the control surface on top. One sheet, two queues. IN holds only the decisions that are
// CLEAR; OUT holds the ones he resolved and what happened since. Everything else is a feeder below the surface, counted, never listed.
// Operator 2026-10-20, verbatim: "the most ready decision ready for decision the clearest decision … they can be commented on … then we
// use the mailbox pattern to move it out of the queue once it's resolved to a resolved queue" · "attention is hierarchical attention is
// what we're optimizing for here. That's why clarity is everything … don't show anything in the mailboxes that … is sludge. Only the
// clarity bubble to the surface … the highest leverage decisions … at the top and all the other aspects line like iron filings in the
// magnetic field … tell me where to look to evaluate progress".
//
// LLM-FREE. A ticket is an open decision (data/vna/board-decisions.json, not yet answered) or an open spec row whose plain head says it
// needs him (YOUR-ACT · NEEDS-OPERATOR); a room's plain rewrite in data/vna/mailbox-tickets.json overrides both. CLARITY is five checks:
//   ASK        it names what to decide (a decision's ask; a row's FROM YOU)
//   PLAIN      one question in plain words: no '·' fragments, no unexplained capitals, no house shorthand
//   RECOMMEND  our answer is on it (a decision's guess; a row's written recommendation — its NOW is state, never advice)
//   DONE WHEN  it says how we will know it is settled
//   UNBLOCKED  nothing it waits on is still open
// Only 5 of 5 surfaces in IN. RANK inside IN: LEVERAGE (open rows that wait on it) first, then gzip-NCD to the snowball (the work in
// flight, .thetacog/vna-snowball-sidecar.json) — nearer rises. A ticket missing a check stays below the surface; the line under IN counts
// what is missing so the rooms know what to refine. An answer (board-watch → data/vna/board-decision-answers.ndjson) moves it to OUT.
// PROGRESS: every write appends { at, in, below, out, missing } to data/vna/mailbox-progress.ndjson — the one place to read whether the
// surface is getting clearer (IN up, below down, OUT growing).
//   node scripts/ops/mailbox.mjs            print the sheet
//   node scripts/ops/mailbox.mjs --write    write it to Drive (its own sheet, first in the index) and append the progress row
//   node scripts/ops/mailbox.mjs --json <out>   write L0 (ALARM rows) + L1 (≤3 READY rows) to <out> — the one receipt the IDE
//                                                sidebar paints (C1061); never a second reading of the tickets.
// Port row C1042r: ranking DECIDES what reaches him — prototype here, port to the crate once the checks settle (CLAUDE.md MAXIMISE RUST).
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tMinus, compareRank, loadMilestones } from './board-rank.mjs';
import { appendCells } from './board-answers.mjs';
import { RPM_HEAD, RPM_RULES, rpmRows, resultLine, actionLine } from './mailbox-rpm.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readNd = (p) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n).replace(/\s+\S*$/, ''); return (c || t.slice(0, n)) + '…'; };
export const PROGRESS = 'data/vna/mailbox-progress.ndjson';
// C1042b (operator 2026-10-20: "the mailbox needs to reference which terminal app and which session in that app this work is being done
// and or should be done … all the important information needs to be there and none of the information you don't need"): WHERE is the
// app, then the session; DONE WHEN leaves the view (detail, not signal — it stays on the record).
// C1042f (operator 2026-10-20: 'a very long inbox … as long as it's clear even with colors showing which of the ones are ready … tell me where
// they are so I can see that they are being formulated'): every ticket is listed; READY? colours it (green READY · grey FORMULATING).
// bf-6566 (operator 2026-10-20: "re-prioritize the mailbox with your horizons in mind ... why are we doing it? The purpose ... the result how
// we know ... the massive action, which includes your recommendations ... rewrite the rules for it"): IN is RPM, ranked by the Horizons. The
// columns and the rules live in mailbox-rpm.mjs; WHERE rides at the end of MASSIVE ACTION and the spec link on RESULT (C1042b, C1042j).
export const IN_HEAD = RPM_HEAD;
export const OUT_HEAD = ['ID', 'WHAT YOU DECIDED', 'WHEN', 'WHERE IT WAS DONE (app · session)', 'WHAT HAPPENED SINCE'];
// C1042a: the rules for a sheet live IN the sheet (operator 2026-10-20: 'the rules for how to fill out the spreadsheet is in the spreadsheet …
// even if the cells … the text needs to be there so the next agent remembers what to do … a very small text full of the rules'). A grey
// block at the foot, one rule per row; the layout paints a RULES block small and grey.
export const RULES_LABEL = 'RULES — how this sheet works';
// C1042h (operator 2026-10-20, beside the rules: "need more grip on these rules … format to clip - long rule sets are ok if numbered"): each
// rule is a numbered row with an id and his YOUR NOTE cell, so a note beside a rule carries across rewrites by id and is acknowledged
// like any ticket. The text column clips (one line a rule); the acknowledgement says where his note ended up.
// C1042l (operator 2026-10-20: "the rules have to be linked to other spreadsheets … indications of where the information flows … the spreadsheets
// themselves point away for where what to do"): each rule names the sheet its flow goes to, as a live link (sheetUrl(name) off board-drive.json).
export const RULES_HEAD = ['RULE', 'HOW THIS SHEET WORKS', 'FLOWS TO', 'YOUR NOTE (fill)'];
export const flowCell = (flow, sheetUrl = () => null) => { if (!flow) return '—'; const u = sheetUrl(flow.sheet); return u ? `=HYPERLINK("${u}","${flow.sheet} — ${String(flow.why).replace(/"/g, "'")}")` : `${flow.sheet} — ${flow.why}`; };
export const rulesPanel = (rules, acks = new Map(), sheetUrl = () => null) => [[], [RULES_LABEL, ''], RULES_HEAD, ...rules.map((r) => [r.id, r.text, flowCell(r.flow, sheetUrl), ackText({ ack: acks.get(r.id) })])];
export const IN_RULES = RPM_RULES;   // R1–R5, one source: scripts/ops/mailbox-rpm.mjs (they replaced IN-R1…IN-R7)
export const OUT_RULES = [
  { id: 'OUT-R1', text: '1. Every decision you took, newest first, with where it was done and what happened since (the commits naming it).', flow: { sheet: 'Spec', why: 'the row each decision moved' } },
  { id: 'OUT-R2', text: '2. A WAITING FOR is not a decision: it stays off this sheet and is counted under Mailbox IN.', flow: { sheet: 'Mailbox IN', why: 'where waits are counted' } },
  { id: 'OUT-R3', text: '3. Nothing here asks you anything. Built by scripts/ops/mailbox.mjs.', flow: { sheet: 'Mailbox IN', why: 'where questions are asked' } },
];

// C1042h: one writer for acknowledgements — a ticket's ack, or a rule's (rules[] in the same file). Called by the watch on read, by a room when done.
export const TICKETS = 'data/vna/mailbox-tickets.json';
export const MAX_READY = 6;   // operator 2026-10-21: "For only three ready ones we can aim for more than three" (was 3, set 2026-10-20)
export function recordAck(id, ack) {
  const f = resolve(REPO, TICKETS); const j = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { tickets: [] };
  const at = new Date().toISOString(); const t = (j.tickets || []).find((x) => x.id === id);
  if (t) t.ack = { ...ack, at }; else { j.rules = (j.rules || []).filter((x) => x.id !== id).concat([{ id, ack: { ...ack, at } }]); }
  writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
// C1042i (operator 2026-10-20: "acknowledge … is the middle step where's the end step? Why didn't you finish?"): the end step is read off the
// record, never left to a room remembering to write back. A 'working' ack names its hand-off (bf-N); when room-bifurcations.json shows that
// hand-off executed, the ack turns DONE with what the room ran and its commit. Pure: (tickets+rules, executed[]) → the transitions.
export function closeFromHandoffs(items, executed, sinceOf = () => '') {
  const ex = new Map((executed || []).filter((e) => e && e.id).map((e) => [e.id, e])); const out = [];
  for (const t of items || []) {
    if (!t.ack || t.ack.stage !== 'working') continue;
    // The hand-off is named in the ack (bf-N), or — when a room rewrote the ack text — it is the newest executed hand-off whose action opens
    // on this id, created after he typed (sinceOf: the dispatch time off board-mailbox.ndjson).
    let bf = (String(t.ack.did || '').match(/\bbf-\d+\b/) || [])[0]; let e = bf && ex.get(bf);
    if (!e) { const since = sinceOf(t.id) || ''; const heads = (x) => { const a = String(x.action || ''); return a.startsWith(t.id) && /^[\s(]/.test(a.slice(t.id.length)); }; e = [...ex.values()].filter((x) => heads(x) && String(x.created_at || '') >= since).pop(); bf = e && e.id; }
    if (!e) continue;
    out.push({ id: t.id, ack: { note: t.ack.note, stage: 'done', did: `done in ${e.executed_in || e.to_room || 'its room'} (${bf}): ${clip(e.ran || e.action, 160)}${e.run_commit ? ` — commit ${String(e.run_commit).slice(0, 10)}` : ''}` } });
  }
  return out;
}
export function closeFromRecord() {
  const f = resolve(REPO, TICKETS); if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, 'utf8')); let executed = [];
  try { executed = JSON.parse(readFileSync(resolve(REPO, 'data/room-bifurcations.json'), 'utf8')).executed || []; } catch { executed = []; }
  const sent = readNd('data/vna/board-mailbox.ndjson'); const sinceOf = (id) => (sent.filter((r) => r.id === id).map((r) => r.at).sort()[0] || '');
  const done = closeFromHandoffs([...(j.tickets || []), ...(j.rules || [])], executed, sinceOf);
  for (const d of done) recordAck(d.id, d.ack);
  return done;
}
const C = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
export const ncd = (x, y) => { if (!x || !y) return 1; const a = C(x), b = C(y); return (C(`${x}\n${y}`) - Math.min(a, b)) / Math.max(a, b); };

// C1042e: our reply, written into the cell he typed in — acknowledged, what he wrote, what was done.
// C1042h: two stages — read and handed off (working), then done.
export const ackText = (t) => (t.ack ? `${t.ack.stage === 'working' ? '✓ ACKNOWLEDGED — working on it' : t.ack.stage === 'done' ? '✓ DONE' : '✓ ACKNOWLEDGED'} — you wrote: "${clip(t.ack.note, 90)}" → ${t.ack.did}` : '');
export const asksHim = (s) => !!String(s || '').trim() && !/^(nothing|none|no(thing)? from you|—|-|n\/a)\b/i.test(String(s).trim());
// PLAIN (C1042a, after C1023 failed him: 'a second SKU and buy door … allocation view paid — I have no idea what that means'): the ask is
// one question in plain words. A head built of '·' fragments, an unexplained capitalised abbreviation (SKU), or house shorthand fails.
const KNOWN_CAPS = new Set(['A', 'B', 'C', 'AI', 'OK', 'US', 'IP', 'LLC', 'CPA', 'GPU', 'API', 'PDF', 'URL', 'VS', 'IRS', 'EU', 'UK', 'CEO', 'CTO']);
const SHORTHAND = /\b(buy door|two[- ]doors|allocation view|SKU|stand-in|the walk|the tape|the reef|aperture|snowball|lattice)\b/i;
export function isPlain(s) {
  const t = String(s || '').trim();
  if (!t || t.includes(' · ') || t.length > 240 || SHORTHAND.test(t)) return false;
  return !(t.match(/\b[A-Z]{2,6}\b/g) || []).some((w) => !KNOWN_CAPS.has(w));
}
export function clarityOf(t, isOpen = () => false) {
  const waits = String(t.waits || '').match(/\bC\d+[a-z0-9]*\b/g) || [];
  const checks = { ask: asksHim(t.ask), plain: isPlain(t.ask), recommend: !!String(t.recommend || '').trim(), done: !!String(t.done || '').trim(), unblocked: !waits.some(isOpen) };
  return { score: Object.values(checks).filter(Boolean).length, missing: Object.keys(checks).filter((k) => !checks[k]) };
}

// tickets: [{ id, ask, recommend, done, waits, text }] · leverage(id) → n · snowball: text · isOpen(id) → bool
// C1056 — LEVEL 0, IS ANYTHING BURNING: a cell of his whose hand-off failed (board-mailbox.ndjson ok:false, never ok since) is an ALARM.
// It never reads as answered and never moves to OUT; it sits above every decision with its reason until a retry lands it.
// bf-6566 — AN ECHO OF OUR OWN QUESTION IS NEVER HIS NOTE: a YOUR NOTE cell that holds a decision's head word for word was written by a
// machine pass, not by him; the write clears it (board-sheets-write.mjs mergeFills cleared), so it never rides across the column change.
export const echoCleared = (decisions) => new Map((decisions || []).filter((d) => d && d.id && String(d.head || '').trim()).map((d) => [`${d.id}\u0000YOUR NOTE (fill)`, String(d.head).trim()]));
export function brokenHandOffs(ledger) {
  const by = new Map(); for (const r of ledger || []) { if (!r || !r.hash) continue; const e = by.get(r.hash) || { ok: false, tries: 0 }; e.ok = e.ok || r.ok !== false; e.tries++; e.row = r; by.set(r.hash, e); }
  return [...by.values()].filter((e) => !e.ok).map((e) => ({ id: e.row.id, tab: e.row.tab, value: e.row.value, at: e.row.at, room: e.row.room, why: e.row.why || 'exit non-zero (reason not recorded before C1056)', tries: e.tries }));
}
export function mailbox({ sheetUrl = () => null, tickets, resolved = [], broken = [], milestones = loadMilestones(), today = new Date().toISOString().slice(0, 10), leverage = () => 0, snowball = '', isOpen = () => false, happened = () => 'nothing yet', whereOf = () => 'unassigned', doneWhere = () => '—', ruleAcks = new Map(), cosReceipt = '', horizons = new Map() }) {
  // C1042i: a DONE ticket has finished its loop — it leaves IN and is listed in OUT with what he wrote and what was done.
  // C1042k (operator 2026-10-20: "still acknowledged comments in the mailbox … should've been moved out by now … if it requires a version two, you
  // can reference it with a ABCD"): an ack with nothing running (no 'working' stage) is a reply already given — it moves out too. A follow-up
  // is a NEW ticket with the next letter (C1012a → C1012b), never the old row held open.
  const brokenIds = new Set(broken.map((b) => b.id));
  const finished = tickets.filter((t) => t.ack && !['working', 'failed'].includes(t.ack.stage) && !brokenIds.has(t.id)); tickets = tickets.filter((t) => !finished.includes(t));
  resolved = resolved.concat(finished.filter((t) => !resolved.some((r) => r.id === t.id)).map((t) => ({ id: t.id, at: t.ack.at || '', answer: `you wrote: "${clip(t.ack.note, 60)}" → ${t.ack.did}` })))
    .sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
  // C1053 — DECISION OR PROJECT (monologue M4): IN holds only items with one answer. A ticket a room marks kind:'project' (more than one
  // step, no single answer — the London invite list) leaves IN once it has an owner and a next step; it lives as a spec row on Projects.
  // A project missing either stays here, grey, until it is shaped. The agent classifies; the sheet moves.
  const shaped = (t) => t.kind === 'project' && String(t.owner || '').trim() && String(t.next || '').trim();
  const projects = tickets.filter(shaped); tickets = tickets.filter((t) => !shaped(t));
  const scored = tickets.map((t) => { const c = clarityOf(t, isOpen); if (t.kind === 'project') { c.score = Math.min(c.score, 4); c.missing = [...c.missing, 'project']; } const tm = tMinus(t.id, { milestones, today }); return { ...t, ...c, lev: leverage(t.id), near: ncd(t.text || t.ask, snowball), tm, days: tm ? tm.days : (t.due ? Math.max(0, Math.round((Date.parse(t.due) - Date.parse(today)) / 864e5)) : null) }; });
  // C1042e: a row dated today outranks the rest (operator: 'Jayne call is today, but is that the priority for today'), then leverage, then NCD.
  // C1053: at most MAX_READY green rows — a fourth clear decision waits below as NEXT UP, so the top is three single answers.
  const R = (t) => ({ id: t.id, days: t.days, unlocks: t.lev, near: t.near });   // C1048 + C1050: one ranking — T-minus, then what it unblocks, then nearness
  const clearAll = scored.filter((t) => t.score === 5).sort((a, b) => compareRank(R(a), R(b)));
  const clear = clearAll.slice(0, MAX_READY); const nextUp = clearAll.slice(MAX_READY);
  const below = scored.filter((t) => t.score < 5);
  // A WAITING FOR answer is a wait on someone else, not a resolution: it leaves OUT and is counted below the surface.
  const waiting = resolved.filter((r) => /^\s*WAITING FOR/i.test(String(r.answer || ''))); resolved = resolved.filter((r) => !waiting.includes(r));
  const miss = {}; for (const t of below) for (const m of t.missing) miss[m] = (miss[m] || 0) + 1;
  // C1042j: the spec link lands on the spec row's line of the board's Spec sheet (t.spec.sheet) — on the RESULT cell since bf-6566.
  const formulating = below.slice().sort((a, b) => b.score - a.score || compareRank(R(a), R(b)));
  // bf-6566 — IN IS RPM, RANKED BY THE HORIZONS: every ticket, in rpmRows' order (nearest horizon first, sludge last). The clarity scoring
  // above still picks the ≤MAX_READY rows the IDE sidebar paints (l0l1); the sheet's order is the Horizons'.
  const byId = new Map(scored.map((t) => [t.id, t]));
  const rpm = rpmRows(scored.map((t) => ({ id: t.id, horizon: t.horizon, why: t.why, them: t.them, needs: t.needs, result: t.result || t.done, action: t.action || t.recommend })));
  const hzCell = (h) => { const z = horizons.get(h); const label = z ? `${h} · ${z.hz}${z.date ? ` (by ${z.date})` : ''}` : h; const u = sheetUrl('Horizons'); return u ? `=HYPERLINK("${u}","${label.replace(/"/g, "'")}")` : label; };
  const resultCell = (t, text) => (t.spec && text ? `=HYPERLINK("${t.spec.sheet || t.spec.url}","${clip(text, 240).replace(/"/g, "'")} (${t.id})")` : clip(text, 240) || '—');
  const actionCell = (t, text) => { const w = whereOf(t); return `${clip(text, 320) || 'needs our recommendation'}${w && w !== 'unassigned' && !/no session open$/.test(w) ? ` · where: ${w}` : ''}`; };
  const sludgeN = rpm.filter((r) => r.sludge).length;
  const inRows = [
    // C1058: the Chief of Staff's receipt (board-cos.mjs, read off its own ledger — never invented here) rides on this same status
    // line, so a glance at Mailbox IN shows both what the surface holds and what the last pass did about it.
    ['MAILBOX IN', `${broken.length} BROKEN HAND-OFF(S) · ranked by the Horizons, nearest first · ${rpm.length - sludgeN} on a horizon · ${sludgeN} sludge (no horizon, listed last)${waiting.length ? ` · ${waiting.length} waiting on someone else` : ''}${projects.length ? ` · ${projects.length} project(s) moved to Projects: ${projects.map((p) => `${p.id} (${p.owner}, next: ${clip(p.next, 50)})`).join('; ')}` : ''} · the top ${MAX_READY} are the ones to answer now${cosReceipt ? ` · ${cosReceipt}` : ''}`],
    IN_HEAD,
    ...broken.map((b) => [b.id, 'ALARM', `your cell on ${b.tab} was NOT delivered: "${clip(b.value, 110)}"`, `${b.tries} try(s) to ${b.room} failed: ${clip(b.why, 120)}`, `the watch retries it each pass · where: ${b.room || '—'}`, '', '']),
    ...rpm.map((r) => { const t = byId.get(r.id); return [r.id, r.sludge ? (r.horizon ? `SLUDGE — ${hzCell(r.horizon).replace(/^=.*$/, r.horizon)} lacks ${r.missing.join(' · ')}` : 'SLUDGE — names no horizon') : hzCell(r.horizon), r.sludge ? `no purpose named yet — the ask: ${clip(t.ask, 140) || '—'}` : r.why, resultCell(t, resultLine(r.result, r.horizon, horizons.get(r.horizon))), actionCell(t, actionLine(r.action, t.rides, r.horizon, horizons.get(r.horizon))), ackText(t), '']; }),
    ...rulesPanel(IN_RULES, ruleAcks, sheetUrl),
  ];
  const outRows = [
    ['OUT — what you decided', `${resolved.length} decided · newest first`],
    OUT_HEAD,
    ...resolved.slice().reverse().map((r) => [r.id, clip(r.answer, 140), String(r.at || '').replace('T', ' ').slice(0, 16), doneWhere(r), happened(r)]),
    ...rulesPanel(OUT_RULES, ruleAcks, sheetUrl),
  ];
  // C1058: the raw scored tickets, for the Chief of Staff pass to read directly (never a re-derive off the printed rows).
  return { inRows, outRows, rows: inRows, projects, scored: { broken, clear, nextUp, formulating, projects }, counts: { broken: broken.length, projects: projects.length, nextUp: nextUp.length, in: clear.length, below: below.length, waiting: waiting.length, out: resolved.length, missing: miss } };
}

// C1061 — THE EXTENSION SHOWS L0 + L1: the Steer sidebar paints only what this function hands it, read straight off
// mailbox()'s own m.scored (never a second clarity/ranking pass of its own). L0 is the alarm line (a broken hand-off);
// L1 is the ≤MAX_READY green rows, the same ones Mailbox IN prints. PATH: scripts/vna/steer-ui.mjs reads the JSON this
// writes (--json below); packages/thetacog-mcp-vscode/src/vna-steer.ts only shows the page steer-ui.mjs wrote.
export function l0l1(m) {
  const s = m.scored || { broken: [], clear: [] };
  return {
    broken: (s.broken || []).map((b) => ({ id: b.id, tab: b.tab, why: `your cell on ${b.tab} was NOT delivered — ${b.tries} try(s) failed: ${clip(b.why, 140)}` })),
    ready: (s.clear || []).map((t) => ({ id: t.id, ask: clip(t.ask, 160), recommend: clip(t.recommend, 160), where: t.where })),
  };
}
// A spoken answer lands in the SAME hand-off ledger a typed cell does (data/vna/board-answers.ndjson, board-answers.mjs
// appendCells) — never a sidecar of its own. The watch's next pass reads it, routes it, and writes ✓ ACKNOWLEDGED into
// the row exactly as it would for a typed cell; this function never touches mailbox-tickets.json directly.
export function landMailboxAnswer({ id, value, at = new Date().toISOString(), ledger } = {}) {
  return appendCells([{ tab: 'Mailbox IN', id, field: 'YOUR ANSWER', value }], { at, ...(ledger ? { ledger } : {}) })[0] || null;
}

export async function compose() {
  const board = await import('./board.mjs');
  const dj = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-decisions.json'), 'utf8'));
  const answers = readNd('data/vna/board-decision-answers.ndjson'); const answered = new Set(answers.map((a) => a.id));
  const specTxt = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'].map((p) => { try { return readFileSync(resolve(REPO, p), 'utf8'); } catch { return ''; } }).join('\n');
  const openIds = new Set([...specTxt.matchAll(/^\s*- \[ \] (C\d+[a-z0-9]*)\b/gm)].map((m) => m[1]));
  const heads = new Map(); for (const h of readNd('data/vna/board-heads.ndjson')) heads.set(h.id, h);   // last write wins
  const tickets = [];
  for (const d of board.activeDecisions(dj.decisions || [])) if (!answered.has(d.id)) tickets.push({ id: d.id, ask: d.head || d.ask, recommend: d.guess, done: (heads.get(d.id) || {}).head?.done_when || (d.ask && /Answer [A-Z]( or [A-Z])+/.test(d.ask) ? 'your answer is on the record' : ''), waits: (heads.get(d.id) || {}).head?.waits_on, text: `${d.ask} ${d.context || ''}`, horizon: d.horizon, why: d.why, them: d.them, needs: d.needs, result: d.result, action: d.action });
  // A row asks him something only when its FROM YOU names an act; 'nothing' is not his ticket and leaves the queue. Its NOW is the row's
  // state, never a recommendation: a row surfaces only once a room has written its recommendation (head.recommend), as C1030 requires.
  for (const [id, h] of heads) if (openIds.has(id) && !answered.has(id) && /^(YOUR-ACT|NEEDS-OPERATOR)$/.test(h.class || '') && asksHim(h.head?.from_you) && !tickets.some((t) => t.id === id))
    tickets.push({ id, ask: h.head?.from_you, recommend: h.head?.recommend || '', done: h.head?.done_when, waits: h.head?.waits_on, text: Object.values(h.head || {}).join(' ') });
  // C1042c: a room's plain rewrite (data/vna/mailbox-tickets.json) overrides the raw record for its id; every check still runs on it.
  const OVR = existsSync(resolve(REPO, 'data/vna/mailbox-tickets.json')) ? JSON.parse(readFileSync(resolve(REPO, 'data/vna/mailbox-tickets.json'), 'utf8')).tickets || [] : [];
  for (const o of OVR) { if (answered.has(o.id)) continue; const i = tickets.findIndex((t) => t.id === o.id); const merged = { ...(i >= 0 ? tickets[i] : { id: o.id, waits: '', text: '' }), ask: o.ask, recommend: o.recommend, done: o.done, where: o.where, spec: o.spec, ack: o.ack, due: o.due, kind: o.kind, owner: o.owner, next: o.next, text: `${o.ask} ${o.recommend}` }; if (i >= 0) tickets[i] = merged; else tickets.push(merged); }
  // R1/R2 for the action rows: data/vna/mailbox-rpm.json gives each its horizon, theirs, purpose, result and six needs; a field the
  // ticket already carries (a decision's own) wins.
  const RPM = existsSync(resolve(REPO, 'data/vna/mailbox-rpm.json')) ? JSON.parse(readFileSync(resolve(REPO, 'data/vna/mailbox-rpm.json'), 'utf8')).rows || {} : {};
  for (const t of tickets) { const x = RPM[t.id]; if (!x) continue; for (const k of ['horizon', 'them', 'why', 'result', 'needs', 'action']) if (!t[k] && x[k]) t[k] = x[k]; }
  // the walk's rides per row (data/vna/horizon-walk.json, written by horizon-walk.mjs; read, never recomputed here)
  let walkRides = new Map(); try { walkRides = new Map((JSON.parse(readFileSync(resolve(REPO, 'data/vna/horizon-walk.json'), 'utf8')).decisions || []).map((d) => [d.id, (d.rides || []).map((x) => x.id)])); } catch { walkRides = new Map(); }
  for (const t of tickets) if (walkRides.has(t.id)) t.rides = walkRides.get(t.id);
  const lev = new Map(); for (const [, h] of heads) for (const w of String(h.head?.waits_on || '').match(/\bC\d+[a-z0-9]*\b/g) || []) if (openIds.has(h.id)) lev.set(w, (lev.get(w) || 0) + 1);
  let snowball = ''; try { snowball = JSON.parse(readFileSync(resolve(REPO, '.thetacog/vna-snowball-sidecar.json'), 'utf8')).lines.join('\n'); } catch { snowball = ''; }
  // WHERE: a decision's named owner → its newest session by that name (app read off the live process, or designated by name prefix);
  // else the live session whose SPEC ROWS hold the id (the Now grid). OUT: the session that made the first commit naming the id.
  const { focus } = await import('./session-focus.mjs'); const { appOf } = await import('./board-terminals.mjs'); const { compose: nowCompose } = await import('./board-now.mjs');
  const fz = focus({ hours: 72 }); const sessions = (fz.sessions || fz).filter((x) => x && x.id);
  const N = nowCompose(); const sr = N[0].indexOf('SPEC ROWS');
  const label = (x) => `${appOf(x).app} · ${x.liveName || x.title || 'unnamed'} ${x.id.slice(0, 8)}${x.live ? '' : ' (closed)'}`;
  const byName = (n) => sessions.filter((x) => (x.liveName || x.title) === n).sort((a, b) => (b.live - a.live) || String(b.lastActive).localeCompare(String(a.lastActive)))[0];
  const holding = (id) => { const r = N.slice(1).find((row) => String(row[sr] || '').split(/\s+/).includes(id)); return r ? sessions.find((x) => x.id.startsWith(r[0])) : null; };
  const whereOf = (t) => { if (t.where) return t.where; const d = (dj.decisions || []).find((x) => x.id === t.id); const s1 = (d && d.owner && byName(d.owner)) || holding(t.id); return s1 ? label(s1) : d && d.owner ? `${d.owner} — no session open` : 'unassigned'; };
  const sessLedger = readNd('.thetacog/commit-session.ndjson');
  const doneWhere = (r) => { try { const sha = execFileSync('git', ['log', `--since=${r.at}`, '--fixed-strings', `--grep=${r.id}`, '--format=%H'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).pop(); const row = sha && sessLedger.find((l) => l.sha === sha); const s1 = row && sessions.find((x) => x.id === row.session); return s1 ? label(s1) : '—'; } catch { return '—'; } };
  try { const bs = await import('./board-spec.mjs'); const { rowOf, grid } = await bs.compose(); for (const t of tickets) { const l = bs.sheetLink(t.id, rowOf); if (l) t.spec = { ...(t.spec || { title: clip(String(grid[rowOf.get(t.id) - bs.FIRST_ROW + 2][1]).replace(/^↳ /, ''), 60) }), sheet: l }; } } catch {}
  const RJ = existsSync(resolve(REPO, TICKETS)) ? JSON.parse(readFileSync(resolve(REPO, TICKETS), 'utf8')).rules || [] : [];
  const ruleAcks = new Map(RJ.filter((r) => r.ack).map((r) => [r.id, r.ack]));
  let drive = {}; try { drive = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets || {}; } catch { drive = {}; }
  const sheetUrl = (name) => (drive[name] ? `https://docs.google.com/spreadsheets/d/${drive[name]}/edit` : null);
  // C1058: the Chief of Staff writes its own ledger (data/vna/board-cos-receipts.ndjson, board-cos.mjs) — this read never invents one.
  const cosReceipts = readNd('data/vna/board-cos-receipts.ndjson'); const cosReceipt = cosReceipts.length ? cosReceipts[cosReceipts.length - 1].receipt : '';
  // bf-6566: the Horizons rows (docs/specs/vna/horizons.json) label each HORIZON cell — H-02 · 1 week (by 2026-10-27).
  let horizons = new Map(); try { horizons = new Map((JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/horizons.json'), 'utf8')).rows || []).map((h) => [h.id, h])); } catch { horizons = new Map(); }
  return mailbox({ horizons, sheetUrl, tickets, resolved: answers, broken: brokenHandOffs(readNd('data/vna/board-mailbox.ndjson')), whereOf, doneWhere, ruleAcks, cosReceipt, leverage: (id) => lev.get(id) || 0, snowball, isOpen: (id) => openIds.has(id),
    happened: (r) => { try { const l = execFileSync('git', ['log', `--since=${r.at}`, '--fixed-strings', `--grep=${r.id}`, '--format=%h %s'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).filter((x) => !/chore\(commit-page\)/.test(x)); return l.length ? `${l.length} commit(s): ${clip(l[0].replace(/^\w+ /, ''), 80)}` : 'nothing yet'; } catch { return 'nothing yet'; } } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const closed = closeFromRecord(); for (const d of closed) console.log(`✓ DONE ${d.id} — ${d.ack.did}`);
  // C1042n: the Spec sheet is written first, so the rows and the gid the SPEC links point at are the ones on the sheet now.
  try { const { rcloneToken: rt } = await import('./board-comments.mjs'); const tk = rt(); if (tk.token && process.argv.includes('--write')) { const bs = await import('./board-spec.mjs'); const { grid } = await bs.compose(); const w = await bs.writeSpec(tk.token, grid); console.log(w.refused ? `✗ Spec refused — ${w.why}` : `✓ Spec ${w.newRows} rows · gid ${w.gid || '?'}`); } } catch (e) { console.log(`✗ Spec not written — ${e.message}`); }
  const m = await compose(); const { inRows, outRows, counts } = m;
  // C1061: the IDE sidebar's own receipt — L0 (alarms) + L1 (≤MAX_READY ready rows), read off this same compose().
  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx >= 0) { const out = resolve(REPO, process.argv[jsonIdx + 1] || 'data/vna/mailbox-l0l1.json'); writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...l0l1(m) }, null, 2) + '\n'); console.log(`✓ ${out}`); process.exit(0); }
  if (!process.argv.includes('--write')) { for (const r of [...inRows, [], ...outRows]) console.log((r || []).map((v) => clip(v, 60)).join(' │ ')); process.exit(0); }
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = rcloneToken(); if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const auth = { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' };
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  // C1042a: two spreadsheets. The first cut's single 'Mailbox' becomes 'Mailbox IN' (same file, renamed); OUT is created once.
  if (j.sheets.Mailbox && !j.sheets['Mailbox IN']) { const { Mailbox, ...rest } = j.sheets; j.sheets = { 'Mailbox IN': Mailbox, ...rest }; }
  const TITLE = { 'Mailbox IN': '000 · MAILBOX IN — the clear decisions, ready for you', 'Mailbox OUT': '001 · MAILBOX OUT — what you decided, newest first' };
  const ids = {};
  for (const name of ['Mailbox IN', 'Mailbox OUT']) {
    let id = j.sheets[name];
    if (!id) { const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: auth, body: JSON.stringify({ name: TITLE[name], mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
      if (!r.id) { console.log(`✗ create failed: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); } id = r.id; }
    else await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: TITLE[name] }) });
    j.sheets = { [name]: id, ...Object.fromEntries(Object.entries(j.sheets).filter(([k]) => k !== name)) }; ids[name] = id;
  }
  j.sheets = { 'Mailbox IN': ids['Mailbox IN'], 'Mailbox OUT': ids['Mailbox OUT'], ...Object.fromEntries(Object.entries(j.sheets).filter(([k]) => !k.startsWith('Mailbox '))) };
  writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  const OV = JSON.parse(readFileSync(resolve(REPO, 'data/vna/mailbox-tickets.json'), 'utf8')).tickets || []; const RJ2 = JSON.parse(readFileSync(resolve(REPO, 'data/vna/mailbox-tickets.json'), 'utf8')).rules || []; const acked = new Map([...OV, ...RJ2].filter((o) => o.ack).map((o) => [o.id, o.ack.note]));
  const dj2 = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-decisions.json'), 'utf8'));
  const r1 = await writeSheet(t.token, ids['Mailbox IN'], inRows, { name: 'Mailbox IN', acked, cleared: echoCleared(dj2.decisions) }); const r2 = await writeSheet(t.token, ids['Mailbox OUT'], outRows, { name: 'Mailbox OUT' });
  appendFileSync(resolve(REPO, PROGRESS), JSON.stringify({ at: new Date().toISOString(), ...counts }) + '\n');
  const r = r1.refused ? r1 : r2;
  console.log(r.refused ? `✗ refused — ${r.why}` : `✓ Mailbox IN ${counts.in} · below ${counts.below} · OUT ${counts.out} · https://docs.google.com/spreadsheets/d/${ids['Mailbox IN']}/edit · https://docs.google.com/spreadsheets/d/${ids['Mailbox OUT']}/edit`);
  process.exit(r.refused ? 1 : 0);
}
