#!/usr/bin/env node
// scripts/vna/prompt-diagnose.mjs — C1228: PROMPT MASTER'S CREDIT-KILLING PATTERNS, RUN LLM-FREE AND HOOKED TO THE HOUSE RULES.
// (operator 2026-10-22, verbatim: "How can we modify it with the rules and hats to hook into what they did in order to make it work
// better with the rules in hat … See if you can use it to rethink the outreach references, the messaging, and how we make sense out
// of the/10 skill and then tell me how successful this was.")
//
// SOURCE: github.com/nidhinjs/prompt-master @49b3a72 (MIT), references/patterns.md — 37 patterns, each a bad prompt and its fix, and
// SKILL.md's Diagnostic Checklist. Prompt Master applies them as a model's silent judgment. Here the patterns that read TRUE on a raw ask
// (the calibration below) are LLM-free tests, and each cites the house rule that already forbids what it catches, so a finding lands on a
// rule this repo enforces, never on taste. What it is sufficient for (AXIOM 1 W6): "does this ask trip a pattern that sends a worker in
// blind?" — re-runnable, same bytes same findings. Not sufficient for "is the ask good?": a clean ask can still aim at the wrong thing.
// Patterns only a reader can judge (16 domain perspective, 17 vague aesthetics, 26 audit contract, 29 contradicting prior work) are listed
// as JUDGMENT and never scored; image, video and tool-template patterns (18, 19, 24) do not apply to a dictation.
//
// THE CALIBRATION, WHICH SET THE SCOPE (2026-10-22, every finding read by hand against its file):
//   SKILLS + OUTREACH REFERENCES — 12 prompts (/tend /steer /dm /reply /prospect /chan /connect-thanks-loop /bump, docs/outreach/_README,
//     the three _template files) gave 35 findings; 4 were real (11%). The other 31 were elements the prompts DO carry in house words:
//     "stop — this is the wrong room", "one person per turn", "repeat until all three ≥ 95", "No MX means no guess". A presence test that
//     wrong nine times in ten is an ignored advisory (CLAUDE.md: false positives are the failure mode of the fix), so the skill and
//     outreach kinds are WITHDRAWN here, not tuned until they look right. The four real ones were fixed or named by hand.
//   RAW ASKS — 867 verbatim operator spans in SPEC-VNA-COCKPIT.md. PM06 fired on 5 (4 real: "finish it", "do it all, use steer" ×2,
//     "finish everything I've asked for"; 1 false: "the whole thing (but we break it into parts…)"). PM07 fired on 14; of the 12 read, 11
//     were real ("ship this", "make that edit", "make this true"). PM03 and PM23 fired on 858 — a dictation almost never names a test or a
//     file, and the compiler fills both (the proposed guard, the basin), so they are not findings at this kind.
//   PM02 (added after the compiler held the operator's own five-question paragraph as one ask, 2026-10-22): fired on 1 of 868 spans,
//     and it was real (three questions in one span). A line stays ONE ask (steer.mjs C624, after a 17-row shatter), so PM02 NAMES the
//     jobs it found and leaves the split to him in the txt; it never splits.
//   So this file scores ONE kind, the raw ask, with the patterns that read true there; scripts/vna/steer-compile.mjs runs it per ask.
//
// DECLINED, with the house rule that overrides the pattern's fix:
//   SKILL "ask up to 3 clarifying questions"  → NEVER FORK (CLAUDE.md): the record answers it; an ask is the irreversible only
//   SKILL "prefer positive instructions over prohibitions" → steergoal's NEGATIVE CONSTRAINTS (C294): a rule is a line not to cross
//
//   node scripts/vna/prompt-diagnose.mjs "<raw ask>" [--json]
// @guard tests/vna/c1228-prompt-diagnose.test.mjs
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// p: the patterns.md number · bad(ask): the ask trips it · rule: the house rule that forbids it · fix: patterns.md's fixed example, abridged
// a separate job inside one line: a sentence of ≥4 words that is a question, or opens on an imperative / "can we" / "lets"
const JOB = /^(?:can|could|should|would|how|what|why|is|are|do|does|did|see if|lets?|let's|make|add|fix|build|write|run|use|tell|show|set|ship|update|remove|check|create|put|move|rethink|find)\b/i;
export const jobsOf = (t) => String(t).split(/(?<=[.?!])\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 4 && (/\?$/.test(x) || JOB.test(x)));
export const PATTERNS = [
  { id: 'PM02', p: 2, name: 'one job per line', rule: 'SPLIT-THE-ASK + DELEGATE-TO-SUBTASKS (CLAUDE.md): a line holding several finish lines is several rows',
    bad: (t) => jobsOf(t).length >= 3, fix: 'one line per job in the STEER block; C624 keeps a line whole, so the split is his' },
  { id: 'PM04', p: 4, name: 'not over-permissive', rule: 'THE AUTONOMY LEVEL IS THE RATCHET (CLAUDE.md): outbound, publishes, secrets, money, legal stay deny-first',
    bad: (t) => /\b(whatever it takes|do (anything|everything)|no limits|any means)\b/i.test(t), fix: 'an allowed list + a forbidden list' },
  { id: 'PM05', p: 5, name: 'fault, not feeling', rule: 'SELF-IMPROVING FIRES (CLAUDE.md): diagnose the root, name the failing thing',
    bad: (t) => /\b(totally|completely) (broken|wrong)|\bfix everything\b|\bit'?s (all )?(a mess|broken)\b/i.test(t), fix: '"Throws TypeError on line 43 when user is null"' },
  { id: 'PM06', p: 6, name: 'not the whole thing', rule: 'DELEGATE-TO-SUBTASKS (CLAUDE.md): decompose every multi-part ask before executing',
    bad: (t) => /\b(the )?(whole|entire) (thing|app|product|site|system|codebase)\b(?![^.]{0,40}\bbreak (it|this) into\b)|\bfinish (it|everything)\b|\bdo (it )?all\b/i.test(t), fix: 'Prompt 1 scaffold · Prompt 2 core · Prompt 3 polish' },
  { id: 'PM07', p: 7, name: 'no implicit reference', rule: 'O(1) REFERENCE (voice-and-pitch.md): name the noun, never a pronoun whose referent is out of reach',
    bad: (t) => /\b(the (other )?thing (we|i) (discussed|said|talked about)|as (we )?discussed|like before|the same as last time|finish it|do (it|that|this) again)\b/i.test(t) || (/^\s*(do|fix|finish|ship|make) (it|that|this)\b/i.test(t) && !/^\s*\w+ (it|that|this)\b[^:]{0,60}:/i.test(t)), fix: 'restate the full task' },
  { id: 'PM27', p: 27, name: 'no hidden-reasoning request', rule: 'THE RECEIPT IS LLM-FREE (CLAUDE.md): ask for the rationale and the check, never the trace',
    bad: (t) => /\b(chain[- ]of[- ]thought|think step by step|show (me )?your (full )?reasoning|reasoning trace)\b/i.test(t), fix: 'a concise rationale, evidence and checks' },
];
export const JUDGMENT = [
  { p: 16, name: 'domain perspective', why: 'the hat supplies it (the snowball sidecar); whether it CHANGES the result is the reader\'s call' },
  { p: 17, name: 'vague aesthetics', why: 'the six percentages and style-check grade prose; a presence test cannot tell "professional" used well' },
  { p: 26, name: 'audit contract', why: 'the ratchet readout\'s "Break it:" line is the house form; whether a falsifier bites is judgment' },
  { p: 29, name: 'contradicting prior work', why: 'the near rows and the regressed-tick list surface it; the contradiction itself is read, not matched' },
];
export const DECLINED = [
  { what: 'ask up to 3 clarifying questions before writing', rule: 'NEVER FORK (CLAUDE.md): compute the answer off the record; a question is for the irreversible only' },
  { what: 'prefer positive instructions over prohibitions', rule: 'NEGATIVE CONSTRAINTS (steergoal C294): a rule is carried as the line not to cross' },
];

// one raw ask → the patterns it trips. Pure: no fs, no clock. A finding is a pattern the ask TRIPS; an empty list is a clean ask.
export function diagnose(ask) {
  const t = String(ask || '');
  return PATTERNS.filter((P) => P.bad(t)).map((P) => ({ id: P.id, p: P.p, name: P.name, rule: P.rule, fix: P.fix, ...(P.id === 'PM02' ? { jobs: jobsOf(t) } : {}) }));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const text = a.filter((x) => !x.startsWith('--')).join(' ');
  if (!text.trim()) { console.error('usage: prompt-diagnose.mjs "<raw ask>" [--json]'); process.exit(2); }
  const f = diagnose(text);
  if (a.includes('--json')) console.log(JSON.stringify(f));
  else console.log(f.length ? f.map((x) => `✗ ${x.id} ${x.name} — ${x.rule} · fix: ${x.fix}`).join('\n') : 'clean — no Prompt Master pattern trips on this ask');
}
