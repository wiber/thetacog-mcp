#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/question-quality.mjs
//
// THE READABILITY METER — three decidable axes on a minted question, LLM-free.
//
// ── THE SUFFICIENCY CONTRACT, because three different things measure three different properties
//    and blending them is how you get a number that means nothing:
//
//   next-question.mjs   measures CONSTRAINT — how much of the semantic space an answer closes.
//                       Says so itself: "ranks by how much they constrain the SEMANTIC SPACE, not
//                       by how much they matter to the business."
//   THIS FILE           measures READABILITY — can a human answer it without translating, in a
//                       breath, and is it different from what was already asked.
//   THE OPERATOR        measures WORTH. Neither file attempts this and neither should.
//
//   WHAT THIS IS SUFFICIENT FOR: rejecting a question a human cannot read or has seen before.
//   WHAT IT IS NOT SUFFICIENT FOR: telling you a readable question is a good one. A perfectly
//   legible formality still scores 100 here. That is the ranker's job, and the operator's.
//
// The operator's targets, 2026-08-24: "zero translation for the human... they need to be good
// questions but they also need to be easy to answer and cut off as much of the space as possible
// — in fact maybe not as much as possible, it's to move this spec and the work as far as possible."
// The last clause is why CONSTRAINT is not the whole objective and why this file exists beside it
// rather than inside it.
//
// @guard tests/tape/question-quality.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');

// ── AXIS 1 · TRANSLATION LOAD ────────────────────────────────────────────────────────────────
// Every INVENTED term in the question is a word the reader must translate before answering.
//
// A MODELLING ERROR CORRECTED HERE, because the obvious source is the wrong one: the first version
// measured against data/voice/glossary.json, and that list exists for a different purpose — it is
// the set of words VOICE-TO-TEXT MANGLES, not the set a stranger cannot parse. It contains "repo",
// "SQLite", "Vercel". Measuring against it scored the operator's own best question ("Is the cockpit
// a private instrument for this repo…") at translation load 1, on the word "repo", which every
// engineer alive knows. Words a transcriber gets wrong and words a reader cannot parse are two
// different sets that happen to overlap.
//
// So the list is REPO-INVENTED VOCABULARY only: terms that carry a meaning we assigned, which a
// competent outsider cannot infer from ordinary usage. General technical words are not jargon here
// no matter how specialised — the test is "did we redefine it", not "is it technical".
const INVENTED = [
  // lattice + tape vocabulary — meanings this repo assigned
  'coordinate', 'coordinates', 'locked', 'lock', 'cone', 'placement', 'lattice', 'reef',
  'taskmaster', 'aperture', 'graduated', 'graduate', 'in-lane', 'off-lane', 'shortlex',
  'shortrank', 'tesseract', 'bifurcate', 'atom', 'atoms', 'tape', 'walk', 'drift',
  'encircled', 'triptych', 'ply', 'plies', 'knock-on', 'pixel',
  // deliberately NOT here: repo, commit, dispatch, spec, panel, receipt, sigma, lane, agent.
  // Each is either ordinary engineering usage or self-evident in context. Adding them would make
  // every question fail and the measure would stop discriminating, which is the same as not
  // measuring. If one of these turns out to genuinely block a reader, move it up WITH the evidence.
];
export function translationLoad(question) {
  const vocab = [...new Set(INVENTED.map((s) => s.toLowerCase()))];
  const q = ` ${String(question).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')} `;
  const hits = vocab.filter((t) => q.includes(` ${t} `));
  // Count, not ratio: one unexplained term is one translation the reader performs, and a longer
  // question does not earn the right to more of them.
  return { count: hits.length, terms: hits, zeroTranslation: hits.length === 0 };
}

// ── AXIS 2 · ANSWERABILITY ───────────────────────────────────────────────────────────────────
// The observed failure in the live set is FRONT-LOADING: "When A and B and C, is it X or Y?" The
// reader must hold three conditions before the question arrives. The good ones in the same set are
// bare: "Is the cockpit a private instrument, or a product other people run on theirs?"
const SUBORDINATORS = /\b(when|if|where|after|once|while|whenever|given that|assuming|in the case)\b/gi;
export function answerability(question) {
  const q = String(question).trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  const conditions = (q.match(SUBORDINATORS) || []).length;
  // The preamble is everything before the first comma that precedes the interrogative — the load
  // the reader carries before they know what is being asked.
  const m = q.match(/^(.*?),\s*(?=(is|does|do|should|which|what|who|are|can|will)\b)/i);
  const preambleWords = m ? m[1].split(/\s+/).filter(Boolean).length : 0;
  // A genuine either/or is what makes the answer sayable AND makes SPREAD non-zero downstream.
  const hasChoice = /\b(or)\b/i.test(q) || /\bwhich one\b/i.test(q);
  return {
    words, conditions, preambleWords, hasChoice,
    // Thresholds are stated, not tuned: a question you cannot say in one breath is over ~28 words;
    // more than one condition is a compound question wearing one question mark; a preamble longer
    // than the question is the front-loading failure named above.
    breathable: words <= 28,
    single: conditions <= 1,
    frontLoaded: preambleWords > 12,
  };
}

// ── AXIS 3 · DISTINCTNESS ────────────────────────────────────────────────────────────────────
// gzip-NCD is the canonical sensor in this repo (never SimHash). Two of the 23 live questions are
// near-duplicates of each other; a meter that cannot see that is not measuring the live failure.
const gz = (s) => gzipSync(Buffer.from(s, 'utf8')).length;
export function ncd(a, b) {
  const [ca, cb, cab] = [gz(a), gz(b), gz(a + b)];
  return (cab - Math.min(ca, cb)) / Math.max(ca, cb);
}
export function distinctness(question, priors = []) {
  if (!priors.length) return { nearest: null, ncd: null, distinct: true };
  let best = { q: null, d: Infinity };
  for (const p of priors) {
    if (!p || p === question) continue;
    const d = ncd(question, p);
    if (d < best.d) best = { q: p, d };
  }
  return {
    nearest: best.q, ncd: best.d === Infinity ? null : +best.d.toFixed(4),
    // CALIBRATED, NOT GUESSED — and the first number here WAS a guess, which the data killed.
    // 0.34 was picked by eye and let the live duplicate through at 0.4913. Measured across all
    // 231 pairs of the gddadwill session: the six tightest pairs are genuinely redundant questions
    // (0.4255 unit-of-work vs one-turn · 0.4913 the two taskmaster pairs · 0.5106, 0.5541, 0.5543,
    // 0.5665), and the bulk of the distribution sits well above them — p05 0.6067, median 0.7052,
    // p90 0.7562. 0.57 is the floor of that empty band: it catches all six and nothing else.
    // ITS LIMIT, stated because one session is thin evidence: this is calibrated on 231 pairs from
    // ONE session. The guard pins the observed values so a second session can recheck rather than
    // inherit; if a future set separates elsewhere, move the number and update the guard together.
    distinct: best.d === Infinity ? true : best.d > 0.57,
  };
}

// ── THE COMBINED READ, reported as three axes and never as one blended number ────────────────
export function readabilityOf(question, priors = []) {
  const t = translationLoad(question);
  const a = answerability(question);
  const d = distinctness(question, priors);
  const fails = [];
  if (!t.zeroTranslation) fails.push(`translation: ${t.count} repo term(s) — ${t.terms.join(', ')}`);
  if (!a.breathable) fails.push(`length: ${a.words} words (max 28)`);
  if (!a.single) fails.push(`compound: ${a.conditions} conditions in one question`);
  if (a.frontLoaded) fails.push(`front-loaded: ${a.preambleWords} words before the question arrives`);
  if (!a.hasChoice) fails.push('no either/or — nothing to trade off, and SPREAD will be zero');
  if (!d.distinct) fails.push(`near-duplicate of an earlier question (ncd ${d.ncd})`);
  return { question, translation: t, answerability: a, distinctness: d, fails, clean: fails.length === 0 };
}

// ── THE FEEDBACK LOOP — the brief learns from its own rejected output ────────────────────────
// THE FINDING THAT MOTIVATES THIS: the brief ALREADY asks for every property the meter measures —
// sufficiency, zero translation, sayable in a breath, name the tradeoff. It asks well, in careful
// prose. And its output is 1 clean in 22. More prose will not close that gap, because the gap is
// not a missing instruction; a model that has been told the rule and breaks it anyway needs a
// LABELLED EXAMPLE, not a better sentence.
//
// So the examples are generated from the model's OWN last output, labelled by the meter with the
// named reason each one failed. That is the only labelled data that exists — the operator has not
// graded anything — and it is honest data: the accepted example is the question he singled out as
// good, and the rejected ones are rejected by a decidable measure rather than by taste.
//
// WHAT THIS IS SUFFICIENT FOR: showing the model the shape of a question that clears the floor.
// WHAT IT IS NOT: evidence that clearing the floor makes a question worth asking. A legible
// formality is still a formality, and the ranker is what kills it.
export function briefExamples(questions) {
  const uniq = [...new Set(questions)].filter(Boolean);
  const scored = uniq.map((q, i) => ({ q, r: readabilityOf(q, uniq.slice(0, i)) }));
  const accepted = scored.filter((x) => x.r.clean).map((x) => x.q);
  // Worst first, so the model sees the most instructive failures rather than the marginal ones.
  const rejected = scored.filter((x) => !x.r.clean)
    .sort((a, b) => b.r.fails.length - a.r.fails.length).slice(0, 4);
  const out = [
    'WORKED EXAMPLES FROM YOUR OWN LAST RUN. These are real questions this brief produced, labelled',
    'by a deterministic readability measure. They are here because the rules above were already',
    'stated when these were minted, and stating them again would change nothing.',
    '',
  ];
  if (accepted.length) {
    out.push('ACCEPTED — clears every axis:', ...accepted.map((q) => `  ✓ ${q}`), '');
  }
  if (rejected.length) {
    out.push('REJECTED — with the measured reason, which is what you must avoid:');
    for (const { q, r } of rejected) {
      out.push(`  ✗ ${q}`);
      for (const f of r.fails) out.push(`      · ${f}`);
    }
    out.push('');
  }
  out.push('The single most common failure is FRONT-LOADING: stacking conditions before the question',
           'arrives, so the reader carries three clauses before they know what is being asked. The',
           'accepted example asks immediately and offers the tradeoff in the same breath.');
  return out.join('\n');
}

// ── CLI: measure the live set, so the claim is a measurement and not an assertion ────────────
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const slug = process.argv[process.argv.indexOf('--slug') + 1] || 'gddadwill';
  const p = resolve(REPO, `.thetacog/tape-sessions/${slug}/questions.ndjson`);
  if (!existsSync(p)) { process.stderr.write(`no questions.ndjson for ${slug}\n`); process.exit(2); }
  const asks = readFileSync(p, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.ask && r.ask.question).map((r) => r.ask.question);
  const uniq = [...new Set(asks)];
  let clean = 0;
  uniq.forEach((q, i) => {
    const r = readabilityOf(q, uniq.slice(0, i));
    if (r.clean) clean++;
    process.stdout.write(`${r.clean ? '✓' : '✗'} ${q.slice(0, 88)}${q.length > 88 ? '…' : ''}\n`);
    for (const f of r.fails) process.stdout.write(`    · ${f}\n`);
  });
  if (process.argv.includes('--examples')) {
    process.stdout.write('\n' + briefExamples(uniq) + '\n');
    process.exit(0);
  }
  process.stdout.write(`\n${clean}/${uniq.length} questions clean on all three axes.\n`);
  process.stdout.write('This measures READABILITY only. Whether any of them is worth asking is the ranker\'s question and the operator\'s.\n');
}
