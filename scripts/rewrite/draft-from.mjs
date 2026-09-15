#!/usr/bin/env node
// scripts/rewrite/draft-from.mjs — POINT IT AT ANYTHING, GET DRAFT ONE.
//
// WHY (operator, 2026-08-12): "the skill should bash open the gui with a text file we make with draft
// one loaded when you point it at anything (and let us continue inspecting in the chat)".
//
// The console could only ever open a document that already existed, which meant it was useless for the
// thing the ledger says it is actually good at: short, high-stakes messages that do not exist yet. The
// one file that ever reached 100% scanned with commits was a 7-paragraph message to a named human.
// You cannot open a message you have not written.
//
// So: give it a source — a PDF of a thread, a transcript, notes, a URL you already saved, a directory
// of drafts, or nothing but a brief — and it writes draft one to a file the console can open. The
// draft is deliberately ROUGH AND COMPLETE rather than polished and partial, because the instrument
// downstream measures where a reader falls off, and it cannot measure a gap.
//
//   node draft-from.mjs --brief "reply to Adam: the two points for Paul" --source thread.pdf
//   node draft-from.mjs --brief "cold open for the insurability post" --model cloud:opus
//   cat notes.txt | node draft-from.mjs --brief "turn these into a message" --source -
//
// SOURCES it can read by itself: .txt .md .mdx .html .json (raw), .pdf (via pdftotext), .rtf/.doc
// (via textutil), a directory (concatenates the text files inside), or stdin. Anything else, hand it
// text — an agent reading a screenshot or a webpage can pipe the extract in, which is the intended
// division of labour: the harness reads exotic things, this writes the draft.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runModel, DEFAULT_MODEL_ID } from './models.mjs';

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

const BRIEF = arg('--brief', '') || arg('-b', '');
const SOURCE = arg('--source', '') || arg('-s', '');
const MODEL = arg('--model', process.env.REWRITE_DRAFT_MODEL || 'cloud:sonnet');
const KIND = arg('--kind', '');           // message | post | deck | note — shapes the instruction
const OUT = arg('--out', '');
const WORDS = Number(arg('--words', 0)) || null;
// WHO IS WRITING TO WHOM. A messy source — a screenshot thread, a call transcript — usually contains a
// message that is OWED, and the person who owes it is often not the person holding the keyboard. The
// Adam thread is the case that forced this: two people drafting a message that a THIRD person sends,
// in that third person's voice, to a fourth. Draft one in the wrong voice is not a rough draft, it is
// the wrong document, and no amount of downstream editing turns one into the other.
const FROM_WHO = arg('--from-who', '');  // the sender the draft must sound like
const TO_WHO = arg('--to', '');          // the named recipient
const VOICE = arg('--voice', '');        // what constrains that sender's register

if (!BRIEF && !SOURCE) {
  console.error('usage: draft-from.mjs --brief "<what this should be>" [--source <file|dir|->] [--model cloud:opus] [--kind message|post|note] [--out <path>]');
  process.exit(1);
}

const clip = (s, n) => String(s || '').slice(0, n);

function readSource(src) {
  if (!src) return '';
  if (src === '-') return fs.readFileSync(0, 'utf8');
  const p = path.resolve(src);
  if (!fs.existsSync(p)) { console.error(`✗ no such source: ${p}`); process.exit(1); }
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    return fs.readdirSync(p)
      .filter((f) => /\.(txt|md|mdx|json|html?)$/i.test(f))
      .slice(0, 20)
      .map((f) => `\n\n───── ${f} ─────\n${clip(fs.readFileSync(path.join(p, f), 'utf8'), 8000)}`)
      .join('');
  }
  const ext = path.extname(p).toLowerCase();
  if (ext === '.pdf') {
    // pdftotext -layout keeps a threaded conversation readable; without it, columns interleave.
    try { return execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
    catch (e) { console.error(`✗ pdftotext failed (${e.message}). Pipe the text in with --source - instead.`); process.exit(1); }
  }
  if (['.rtf', '.doc', '.docx', '.pages'].includes(ext)) {
    try { return execFileSync('textutil', ['-convert', 'txt', '-stdout', p], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
    catch (e) { console.error(`✗ textutil failed (${e.message}).`); process.exit(1); }
  }
  return fs.readFileSync(p, 'utf8');
}

const SHAPE = {
  message: 'a message to one named person. No preamble, no signature block beyond a name, no bullet lists — people do not send bullet lists to people they respect.',
  post: 'a blog post: a cold open that earns the next paragraph, then the argument, then the thing the reader can check for themselves.',
  note: 'a working note to yourself: the claim first, the evidence under it, the open question at the end.',
  deck: 'slide prose — one idea per block, written as sentences a human would say out loud, not fragments.',
};

const prompt = [
  'You are writing DRAFT ONE. Rough and complete beats polished and partial: a downstream reader model measures where comprehension breaks, and it cannot measure a gap. Write the whole thing, end to end.',
  (FROM_WHO || TO_WHO) ? `\n## WHO IS WRITING TO WHOM\n${FROM_WHO ? `FROM: ${FROM_WHO} — you are writing AS this person, in their voice, with their standing and their constraints. Not as an assistant, not as the person who asked for this draft.` : ''}${TO_WHO ? `\nTO: ${TO_WHO} — one named human. Write to them, not to a category of person.` : ''}${VOICE ? `\nVOICE: ${VOICE}` : ''}` : '',
  BRIEF ? `\n## THE BRIEF\n${BRIEF}` : '',
  KIND && SHAPE[KIND] ? `\n## THE SHAPE\nWrite ${SHAPE[KIND]}` : '',
  WORDS ? `\n## LENGTH\nAim for about ${WORDS} words. Not a hard limit; do not pad to reach it.` : '',
  SOURCE ? `\n## THE SOURCE MATERIAL\nEverything below is context you were given. Use what serves the brief and ignore the rest. Do not summarise it back — write the thing the brief asks for.\n\n${clip(readSource(SOURCE), 40000)}` : '',
  `\n## HOW TO WRITE IT
Plain sentences. No hedging stacks, no throat-clearing openers, no "In today's fast-paced world". Do not announce what you are about to say — say it. If you do not know something the draft needs, write the sentence with a bracketed [gap: what is missing] rather than inventing a fact or skipping the paragraph.

THE FILE WILL CONTAIN ONLY THIS MESSAGE. It is opened directly in an editor and every sentence of it is scored as if it had been sent. So:
- Write the message ITSELF, never a note about the message. "Yes, that's the whole message — two points, in this order:" is commentary; the two points are the message.
- No subject line, no "Draft:", no headers, no horizontal rules, no bracketed stage directions, no closing notes to the reader.
- No markdown formatting of any kind if this is a message to a person — no bold, no bullets, no headings.
- Start at the first word the recipient would read and stop at the last one.

Return ONLY that text. No preamble, no commentary, no code fences.`,
].filter(Boolean).join('\n');

const t0 = Date.now();
console.error(`  drafting with ${MODEL}${SOURCE ? ` from ${SOURCE}` : ''}…`);
const r = await runModel(MODEL, prompt, {});
if (!r?.ok) {
  console.error(`✗ ${MODEL} failed: ${r?.error || 'no answer'}`);
  process.exit(2);
}

let text = String(r.text || '').trim()
  .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '')   // models fence prose about a third of the time
  .trim();

// LAST-LINE DEFENCE. Even told plainly, a model will occasionally open with "Draft:" or "Subject:" or
// a horizontal rule. One of those at the top of a DM is a sentence the writer has to skip on every
// card, and one the reader model scores as prose. Strip the obvious ones rather than trusting.
text = text
  .replace(/^\s*<!--[\s\S]*?-->\s*/, '')
  .replace(/^\s*(draft(\s*one)?|subject|to|re)\s*[:\-—]\s*.*\n+/i, '')
  .replace(/^\s*[-*_]{3,}\s*\n+/, '')
  .replace(/\n+\s*[-*_]{3,}\s*$/, '')
  .trim();

if (!text) { console.error('✗ the model returned nothing usable'); process.exit(2); }

// The filename says who it is to, because a folder of drafts named after briefs is unsearchable three
// weeks later, and .txt because a message is plain text — a DM with markdown headings in it is a tell.
const nameOf = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-')[0];
const slug = (FROM_WHO || TO_WHO)
  ? [nameOf(FROM_WHO) || 'draft', TO_WHO ? `to-${nameOf(TO_WHO)}` : ''].filter(Boolean).join('-')
  : (BRIEF || path.basename(SOURCE, path.extname(SOURCE)) || 'draft')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'draft';
const stamp = new Date().toISOString().slice(0, 10);
const ext = KIND === 'message' ? 'txt' : 'md';
const out = path.resolve(OUT || path.join(process.cwd(), 'docs', '05-content', 'blog', 'scratchpad', 'drafts', `${stamp}-${slug}-draft-1.${ext}`));
fs.mkdirSync(path.dirname(out), { recursive: true });

// The provenance line is a comment so the console reads the prose, not the metadata — but it stays in
// the file, because "which model wrote draft one, from what, when" is the first question anyone asks
// of a draft six weeks later.
const prov = `draft one · ${MODEL} · ${new Date().toISOString()}${FROM_WHO ? ` · from: ${FROM_WHO}` : ''}${TO_WHO ? ` · to: ${TO_WHO}` : ''} · brief: ${clip(BRIEF, 160)}${SOURCE ? ` · source: ${SOURCE}` : ''}`;
// NO META IN THE FILE. EVER. (operator, 2026-08-12: "the /rewrite cant have meta in it, it must be a
// text file with only the dm in it".) A provenance comment is text the reader model scores, and a
// header is a sentence the writer has to mentally skip on every card. The file is exactly what would
// be sent, byte for byte; everything about the file lives in a sidecar beside it.
const header = '';
try { fs.writeFileSync(out + '.provenance', prov + '\n'); } catch {}
fs.writeFileSync(out, header + text + '\n');

console.error(`  ✓ ${(Date.now() - t0) / 1000}s · ${text.split(/\s+/).length} words`);
console.log(out);   // stdout is ONLY the path, so a launcher can consume it
