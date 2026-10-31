#!/usr/bin/env node
// scripts/ops/board-cell-words.mjs — C1059 THE CELL WORDS: a word turns your cell into a dispatch, no model, the watch alone.
// docs/specs/vna/goals/2026-10-20-the-chief-of-staff-board-steer.txt section 6, operator 2026-10-20, verbatim: "can we use special
// words in the spreadsheet that I just turned it into a dispatch". The first word of a typed cell decides where it goes:
//   /steer <text>           runs a /steer on this row in its owner room
//   @<terminal> <text>      e.g. "@ko1 draft the reply" — straight to that session
//   @<room> <text>          e.g. "@network chase Meera" — to that room
//   PROJECT <owner> <next>  reclassifies the row as a project: leaves Mailbox IN, lands on the Spec (C1053)
//   LATER <date>            hides the row until that date; it returns at the top that morning
//   DROP <why>              closes it, the why on the record
//   DONE                    you did it yourself; closes it with no hand-off
//   ? <question>            asks the Chief of Staff to explain the row in the same cell; nothing is dispatched
//   WAITING FOR: <who>      suspends the row on someone else (exists; C1039g/board-book.mjs read this shape already)
//   HOLD <text>             the night hold: kept on the record, handed to nobody, until you take the word HOLD off (sheet-legibility.mjs
//                           H1–H4). Upper case only, unlike the others: "hold off on Greg" is an instruction, and a misread hold costs a day.
// Anything else is a plain answer or note — parseCellWord returns null and board-answers.mjs/board-watch.mjs keep their existing read.
// The parsed word is echoed in the acknowledgement ("✓ ACKNOWLEDGED — LATER 2026-10-27 → hidden until then"), so a misread shows at a
// glance. LLM-FREE: every match is a regex anchored on the first word; nothing here reads meaning out of the rest of the text.
export const ROOMS = ['vault', 'architect', 'performer', 'navigator', 'network', 'voice', 'builder', 'laboratory', 'operator'];

const WORDS = [
  { word: '/steer', re: /^\/steer\b\s*(.*)$/is, make: (m) => ({ kind: 'steer', text: m[1].trim() }) },
  { word: '@', re: /^@(\S+)\s+(.*)$/is, make: (m, ctx) => {
    const name = m[1]; const text = m[2].trim();
    return (ctx.rooms || ROOMS).includes(name.toLowerCase()) ? { kind: 'room', room: name.toLowerCase(), text } : { kind: 'terminal', terminal: name, text };
  } },
  { word: 'PROJECT', re: /^PROJECT\b\s+(\S+)\s+(.*)$/is, make: (m) => ({ kind: 'project', owner: m[1], next: m[2].trim() }) },
  { word: 'LATER', re: /^LATER\b\s+(\S+)\s*$/i, make: (m) => ({ kind: 'later', date: m[1] }) },
  { word: 'DROP', re: /^DROP\b\s+(.*)$/is, make: (m) => ({ kind: 'drop', why: m[1].trim() }) },
  { word: 'DONE', re: /^DONE\s*$/i, make: () => ({ kind: 'done' }) },
  { word: '?', re: /^\?\s*(.*)$/s, make: (m) => ({ kind: 'question', text: m[1].trim() }) },
  { word: 'HOLD', re: /^\[?HOLD\]?:?(?=\s|$)\s*(.*)$/s, make: (m) => ({ kind: 'hold', text: m[1].trim() }) },
  { word: 'WAITING FOR', re: /^WAITING FOR:?\s*(.+)$/is, make: (m) => ({ kind: 'waiting', who: m[1].trim() }) },
];

// The first word of a typed cell, parsed into a routing decision — or null, a plain answer/note.
export function parseCellWord(value, ctx = {}) {
  const v = String(value || '').trim();
  if (!v) return null;
  for (const w of WORDS) { const m = v.match(w.re); if (m) return { word: w.word, ...w.make(m, ctx) }; }
  return null;
}

// The named target for each kind — what the goal doc's section 6 table names, in one phrase.
export function targetOf(parsed) {
  switch (parsed.kind) {
    case 'steer': return "this row's owner room (a /steer run on it)";
    case 'room': return parsed.room;
    case 'terminal': return parsed.terminal;
    case 'project': return 'the Spec (reclassified as a project)';
    case 'later': return 'hidden until then';
    case 'drop': return 'closed';
    case 'done': return 'closed, no hand-off';
    case 'question': return 'the Chief of Staff (explained in this cell)';
    case 'waiting': return 'suspended';
    case 'hold': return 'held overnight, handed to nobody';
    default: return 'UNMEASURED';
  }
}

// Kinds that dispatch to a room/session; the rest resolve on the record with no hand-off.
export const DISPATCHES = new Set(['steer', 'room', 'terminal']);

// The acknowledgement string written back into his cell — the parsed word is always in it, so a misread shows at a glance.
export function acknowledgementFor(parsed) {
  if (!parsed) return null;
  const tgt = targetOf(parsed);
  switch (parsed.kind) {
    case 'steer': return `✓ ACKNOWLEDGED — /steer → ${tgt}: "${parsed.text}"`;
    case 'room': return `✓ ACKNOWLEDGED — @${parsed.room} → dispatched to ${tgt}: "${parsed.text}"`;
    case 'terminal': return `✓ ACKNOWLEDGED — @${parsed.terminal} → dispatched to ${tgt}: "${parsed.text}"`;
    case 'project': return `✓ ACKNOWLEDGED — PROJECT → ${tgt}, owner ${parsed.owner}, next: ${parsed.next}`;
    case 'later': return `✓ ACKNOWLEDGED — LATER ${parsed.date} → ${tgt}`;
    case 'drop': return `✓ ACKNOWLEDGED — DROP → ${tgt}: ${parsed.why}`;
    case 'done': return `✓ ACKNOWLEDGED — DONE → ${tgt}`;
    case 'question': return `✓ ACKNOWLEDGED — ? → ${tgt}: "${parsed.text}"`;
    case 'waiting': return `✓ ACKNOWLEDGED — WAITING FOR ${parsed.who} → ${tgt}`;
    case 'hold': return `✓ HELD — ${tgt}. Read it after a night: what happened, what you think it means, what you want done. Take HOLD off to send it on, or DROP it.`;
    default: return null;
  }
}

if (process.argv[1] && process.argv[1].endsWith('board-cell-words.mjs')) {
  const value = process.argv.slice(2).join(' ');
  const parsed = parseCellWord(value);
  console.log(parsed ? `${parsed.word} → ${targetOf(parsed)}\n${acknowledgementFor(parsed)}` : 'not a cell word — plain answer/note');
}
