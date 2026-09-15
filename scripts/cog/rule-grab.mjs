#!/usr/bin/env node
// scripts/cog/rule-grab.mjs
//
// QWEN IS A GRABBER, NOT A WRITER — RETRIEVE THE RESOLVED RULE, QUOTE IT, SUMMARIZE IT.
//
// THE FAILURE THIS ENDS. Operator, 2026-09-07 (gemini-web:d69ba46b48e995e3, turn 61), on the
// subpar paragraphs coming out of the local model: "qwen isn't a great writer... why are we
// having subpar paragraphs if qwen is writing and clipping paragraphs from the repo? It's not
// writing to be able to write actual paragraphs. It's supposed to be grabbing rules that we
// resolved in other places or summarize things. Summarizing is something qwen should be really
// good at IF IT CAN FIND THEM and it can use grabber search or the Gzip itself to do that."
//
// The diagnosis is a retrieval failure wearing a writing failure's clothes. A 7B model asked to
// produce a paragraph about a rule it was never handed will produce the maximum-likelihood
// completion — which is, by construction, the population average (AXIOM 1's W6: regression to the
// mean is what an insufficient projection reconstructs). Give it the actual resolved sentence and
// the job collapses to quote-and-compress, which is the one thing a small model is genuinely good
// at. So this file is two halves and neither works alone:
//
//   1. THE GRABBER (LLM-FREE, deterministic) — find the span in the resolved-rule corpus that
//      answers the question, with file:line provenance, using gzip-NCD as the operator asked.
//   2. THE VERIFIER (LLM-FREE, deterministic) — after qwen answers, check every quote it returned
//      is ACTUALLY PRESENT in the span it was handed. A quote that is not in the source was
//      written, not grabbed, and it is rejected rather than printed.
//
// WITHOUT (2) THIS IS A STYLE INSTRUCTION AND STYLE INSTRUCTIONS DO NOT BIND A 7B MODEL. "Quote,
// don't write" in a prompt is a request; substring-presence in the retrieved source is a decidable
// fact. That is the whole reason the verifier exists and why it, not the prompt, is the deliverable.
//
// THE COMPLEMENT TO rules-for.mjs, AND CLAUDE.md ALREADY NAMED THIS GAP. rules-for.mjs answers
// "what rules name the PATHS I am touching" and is structurally blind to judgment rules, because
// "every judgment rule in this file names no path" (CLAUDE.md, A DELETION IS NOT A FIX). This
// answers the other question — "what did we already RESOLVE about this KIND of thing" — keyed on
// content, not on filename. Two retrievals, two questions; neither subsumes the other.
//
// SUFFICIENCY CONTRACT, because this tool is a projection and must say what it is not sufficient for.
//   SUFFICIENT FOR: locating a resolved rule that exists in the corpus and proving a model's quote
//                   of it is verbatim. Both halves are re-runnable and carry no model.
//   NOT SUFFICIENT FOR: whether the rule found is the RIGHT rule for your situation (that is the
//                   judgement the rule exists to make), and not for a rule that was resolved only
//                   in a chat transcript and never written into the corpus — an absence is
//                   invisible to every check that inspects the things that are present.
//
//   node scripts/cog/rule-grab.mjs --query "can I delete shipped copy to fix a framing defect"
//   node scripts/cog/rule-grab.mjs --query "..." --context-file draft.md --json
//   node scripts/cog/rule-grab.mjs --query "..." --qwen            # grab → qwen extracts → verified
//
// LANE: default is retrieval only and carries NO model. --qwen is opt-in and is the offline/
// by-request lane (qwen stays banned from the blocking interactive path). Output is STORY, never
// receipt — nothing here may enter the deterministic receipt path.
//
// @guard tests/cog/rule-grab.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, relative } from 'node:path';

const REPO = resolve(new URL('../..', import.meta.url).pathname);

// THE RESOLVED-RULE CORPUS: places where an argument was SETTLED, not where it was had. CLAUDE.md
// (the hard rules and axioms), the anti-rules ledger (each AR with the incident that made it), and
// the posture spec (the register decisions). Extend with --corpus <path>; a missing default file is
// skipped rather than fatal, so a fresh clone still runs.
const DEFAULT_CORPUS = [
  'CLAUDE.md',
  'docs/architecture/anti-rules-ledger.md',
  'docs/architecture/narrow-channel-posture-spec.md',
];

// ── gzip-NCD, the operator's named sensor ────────────────────────────────────────────────────
const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
export function ncd(a, b) {
  const A = String(a), B = String(b);
  if (!A || !B) return 1;
  const ga = gz(A), gb = gz(B), gab = gz(A + '\n' + B);
  const mx = Math.max(ga, gb);
  return mx ? (gab - Math.min(ga, gb)) / mx : 1;
}

// THE APERTURE. META-BULK's measured law: gzip-NCD only measures MEANING when the two sides are the
// same size-order; below that it measures LENGTH. Two numbers follow from it and both are reported
// rather than assumed.
//
// MIN_EYE is the gzip floor. A deflate stream carries a fixed header and a cold dictionary, so for
// inputs under a couple of hundred bytes gz() is dominated by that overhead and NCD stops tracking
// content at all. 240 is the floor this repo already works against.
//
// MAX_EYE bounds the window so a fat context does not swallow a whole 4000-char section and report
// the section rather than the sentence — the point is to hand qwen a SPAN it can quote, not a wall.
export const MIN_EYE = 240;
export const MAX_EYE = 1400;

/**
 * Cut the eye to the query side's own mass. The window slid across each rule block is exactly the
 * size of the query side, so both sides of every comparison carry equal mass and equal density —
 * and, decisively, a thin query is matched against a THIN SPAN rather than against a fat block.
 * That is the size-match META-BULK demands, obtained by moving the eye instead of by padding.
 *
 * WHEN THE QUERY IS UNDER THE FLOOR THE APERTURE IS NOT MATCHED AND THIS SAYS SO. A bare six-word
 * question cannot be bulked honestly — repeating it to reach the floor manufactures redundancy the
 * question does not have, which is fabrication wearing a statistic. So the window is clamped to the
 * floor, the ranking is still fair (every candidate is scored against the same query side, so the
 * comparison is like-for-like), and `matched:false` is returned so no caller reads the absolute NCD
 * as a similarity. Pass --context-file to give the query real mass and the aperture closes properly.
 */
export function aperture(querySideLength) {
  const eye = Math.max(MIN_EYE, Math.min(MAX_EYE, querySideLength));
  return {
    eye,
    matched: querySideLength >= MIN_EYE && querySideLength <= MAX_EYE,
    reason: querySideLength < MIN_EYE
      ? `query side ${querySideLength}ch is under the ${MIN_EYE}ch gzip floor — window clamped to the floor; ranking is comparable across candidates but the absolute NCD is not a similarity. Add --context-file for a matched aperture.`
      : querySideLength > MAX_EYE
        ? `query side ${querySideLength}ch exceeds the ${MAX_EYE}ch span cap — window capped so the hit is a quotable span, not a whole section.`
        : `query side and window both ${eye}ch — matched mass and density on both sides.`,
  };
}

// ── the lexical sensor: kills gzip length-noise, deterministically ───────────────────────────
const STOP = new Set(('the a an and or but if then than that this these those is are was were be been being of to in on at by for with from as it its into about over under not no nor do does did done can could should would will shall may might must have has had what which who whom whose when where why how all any both each few more most other some such only own same so too very just also'.split(' ')));
export function tokens(s) {
  return [...new Set(String(s).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [])].filter((t) => !STOP.has(t));
}

/**
 * TWO SENSORS, EACH USED WHERE IT IS VALID, AND THE VERDICT SAYS WHICH ONE DECIDED.
 *
 * THIS IS A CORRECTION MADE AGAINST A MEASUREMENT, NOT A TUNE. The first version of this file
 * ranked purely by gzip-NCD and was driven against the real corpus. Two queries, two failures, both
 * the same shape: "can I delete shipped copy to fix a framing defect" put a one-line URL comment
 * (sharing only the word "copy") ABOVE the A DELETION IS NOT A FIX rule that shares framing, defect
 * and shipped; and "should the panel be rendered from the working tree or the commit" did not
 * return the immutable-commit rule at all, losing to two blocks whose only overlap was "commit".
 *
 * The cause is written in this repo's own canon and I violated it before reading it: META-BULK —
 * "gzip-NCD only measures MEANING when the two texts are the same size-order... short-vs-anything =
 * length noise." A thin query clamped up to the gzip floor is precisely that case, and under it a
 * short line wins on compressibility rather than on content. So NCD must not do the RANKING when
 * the aperture is unmatched — the instrument is being read outside its range.
 *
 * IDF IS WHY "commit" LOSES TO "framing". A token shared by most of the corpus carries almost no
 * information about which rule you want; a token that appears in three blocks carries a great deal.
 * Weighting the overlap by log(N/df) is the standard statement of that and it is the whole fix —
 * "commit" appears nearly everywhere here, so it stops deciding, and "defect" starts.
 *
 * NCD IS NOT DISCARDED, IT IS MOVED TO WHERE IT WORKS: it still picks the best WINDOW inside the
 * winning block (a within-block comparison, where every candidate window is the same size — a
 * genuinely matched aperture), and it still does the ranking outright when the caller supplies
 * enough context to put the query side above the floor. Both facts are reported as `sensor`.
 */
export function idf(blocks) {
  const df = new Map();
  for (const b of blocks) for (const t of tokens(b.text)) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(1, blocks.length);
  return (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1));
}

// ── corpus loading: blocks, with the line each one starts on ─────────────────────────────────
export function blocksOf(text, file) {
  const lines = String(text).split('\n');
  const out = [];
  let start = 0;
  const push = (end) => {
    if (end <= start) return;
    const body = lines.slice(start, end).join('\n');
    if (body.trim().length >= 80) out.push({ file, line: start + 1, title: lines[start].replace(/^#+\s*/, '').trim(), text: body });
  };
  for (let i = 1; i < lines.length; i++) {
    if (/^#{1,4}\s+\S/.test(lines[i])) { push(i); start = i; }
  }
  push(lines.length);
  return out;
}

export function loadCorpus(paths = DEFAULT_CORPUS, repo = REPO) {
  const blocks = [];
  for (const p of paths) {
    const abs = p.startsWith('/') ? p : resolve(repo, p);
    if (!existsSync(abs)) continue;
    blocks.push(...blocksOf(readFileSync(abs, 'utf8'), relative(repo, abs)));
  }
  return blocks;
}

/** Snap a char window out to line boundaries so the grabbed span is quotable, never mid-word. */
function snap(text, from, to) {
  let a = text.lastIndexOf('\n', from);
  a = a < 0 ? 0 : a + 1;
  let b = text.indexOf('\n', to);
  if (b < 0) b = text.length;
  return { from: a, to: b, span: text.slice(a, b).trim() };
}

/**
 * THE GRAB. Slide the matched eye across every block; the best-scoring window in each block is that
 * block's span. Ranking is by gzip-NCD (the operator's named sensor); the lexical gate is a
 * deterministic sanity check on top of it, never a substitute for it.
 *
 * The gate is what stops a length-artifact from being reported as a hit. If NOTHING in the corpus
 * shares a content token with the query, that is reported (`lexicallySupported:false`) rather than
 * papered over — "I looked and found nothing that matches" and "here is my best guess" are
 * different claims and this repo has paid for collapsing them.
 */
export function grab(query, { context = '', corpus = null, cap = 4, repo = REPO, paths = DEFAULT_CORPUS } = {}) {
  const t0 = Date.now();
  const Q = String(query || '').trim();
  if (Q.length < 3) return { ok: true, query: Q, hits: [], aperture: aperture(0), lexicallySupported: false, note: 'empty/too-short query — nothing to grab', ms: Date.now() - t0 };

  const querySide = context ? `${Q}\n${context}` : Q;
  const ap = aperture(querySide.length);
  const qTok = new Set(tokens(Q));
  const blocks = corpus || loadCorpus(paths, repo);
  const weight = idf(blocks);

  // The sensor that RANKS is chosen by the aperture, and it is named in the result.
  const sensor = ap.matched ? 'gzip-ncd' : 'idf-overlap';

  // THE WINDOW IS SCORED THE SAME WAY THE BLOCK IS RANKED, AND THAT IS NOT A DETAIL.
  // The first version scored blocks lexically and then let NCD choose the window inside the winner.
  // Driven against the real corpus it produced a hit ranked #2 on shared vocabulary whose PRINTED
  // SPAN contained none of that vocabulary — the tool handed over a passage that was not the reason
  // the block won. A retrieval whose provenance and whose evidence disagree is worse than no hit,
  // because it looks like an answer. Ranking and span now come from one score, so the span you are
  // told to quote is always the span that earned the rank.
  const stride = Math.max(40, Math.floor(ap.eye / 3));
  const scored = [];
  for (const b of blocks) {
    let best = null;
    for (let i = 0; i < Math.max(1, b.text.length - 1); i += stride) {
      const win = b.text.slice(i, i + ap.eye);
      if (win.trim().length < 40) continue;
      const overlap = tokens(win).filter((t) => qTok.has(t));
      const lex = overlap.reduce((s, t) => s + weight(t), 0);
      const nc = ncd(querySide, win);
      const better = !best || (sensor === 'gzip-ncd'
        ? (nc < best.nc || (nc === best.nc && lex > best.lex))
        : (lex > best.lex || (lex === best.lex && nc < best.nc)));
      if (better) best = { nc, lex, at: i, overlap };
      if (i + ap.eye >= b.text.length) break;
    }
    if (!best) continue;
    const s = snap(b.text, best.at, Math.min(b.text.length, best.at + ap.eye));
    const lineOffset = b.text.slice(0, s.from).split('\n').length - 1;
    scored.push({
      file: b.file, line: b.line + lineOffset, title: b.title,
      ncd: +best.nc.toFixed(4), lex: +best.lex.toFixed(3),
      overlap: best.overlap.sort((a, c) => weight(c) - weight(a)), span: s.span,
    });
  }

  const gated = scored.filter((h) => h.overlap.length > 0);
  const lexicallySupported = gated.length > 0;
  const pool = lexicallySupported ? gated : scored;
  // Rank by the valid sensor; the other one breaks ties, so neither signal is thrown away.
  const ranked = pool.sort((a, b) => (sensor === 'gzip-ncd'
    ? (a.ncd - b.ncd) || (b.lex - a.lex)
    : (b.lex - a.lex) || (a.ncd - b.ncd))).slice(0, cap);

  return {
    ok: true, query: Q, aperture: ap, sensor, lexicallySupported,
    blocks: blocks.length, hits: ranked, ms: Date.now() - t0,
    note: !lexicallySupported
      ? 'NO span in the corpus shares a content word with this query — these are unsupported guesses. The rule you want may never have been written down.'
      : sensor === 'gzip-ncd'
        ? `${ranked.length} span(s) ranked by gzip-NCD at a matched aperture, tie-broken on IDF overlap`
        : `${ranked.length} span(s) ranked by IDF-weighted overlap (the query side is under the gzip floor, where NCD measures length rather than meaning); gzip-NCD chose the span inside each block`,
  };
}

// ── the extraction contract handed to qwen ───────────────────────────────────────────────────
// The shape is machine-checkable on purpose: one line per field, numbered to the source it came
// from, with an explicit abstention token so "this source does not answer it" is expressible. A
// model with no way to say nothing will invent something.
export const ABSTAIN = '—';

export function buildExtractPrompt(query, hits) {
  const sources = hits.map((h, i) => `── SOURCE ${i + 1} · ${h.file}:${h.line} · ${h.title} ──\n${h.span}`).join('\n\n');
  return `${sources}

── TASK ──
QUESTION: ${query}

You are a GRABBER, not a writer. Do not compose prose. Do not explain. Do not merge sources.

For EACH source above, output exactly two lines, nothing else:

[n] QUOTE: <one contiguous passage COPIED CHARACTER-FOR-CHARACTER from SOURCE n — at least 8 words, and it must appear in that source exactly as you write it>
[n] GIST: <one sentence of your own, 25 words or fewer, saying what that quote decides>

If SOURCE n does not answer the QUESTION, output:
[n] QUOTE: ${ABSTAIN}
[n] GIST: ${ABSTAIN}

Abstaining is correct and costs nothing. Inventing a quote is the one failure that matters: every
QUOTE line is checked against its source automatically, and anything you did not copy is discarded.
Output the numbered lines and nothing before or after them.`;
}

// ── the verifier: the deliverable ────────────────────────────────────────────────────────────
// NORMALIZATION IS DELIBERATE AND BOUNDED. Case, punctuation and whitespace are normalized away
// before the substring test, because a model that re-typesets an em-dash or unwraps a line break is
// still GRABBING — flagging that as invention is a false positive, and a noisy verifier is an
// ignored verifier. Word order and word choice are NOT normalized, so a paraphrase never passes.
export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A short fragment is a substring of almost anything, so a 3-word "quote" would verify trivially
// while proving nothing. Below this length the verdict is `unverifiable`, never `grabbed`.
export const MIN_QUOTE_WORDS = 8;

export function parseExtraction(text) {
  const items = new Map();
  const stray = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[?(\d+)\]?\s*(QUOTE|GIST)\s*:\s*(.*)$/i);
    if (!m) { stray.push(line); continue; }
    const n = Number(m[1]);
    if (!items.has(n)) items.set(n, { n });
    items.get(n)[m[2].toLowerCase()] = m[3].trim();
  }
  return { items: [...items.values()].sort((a, b) => a.n - b.n), stray };
}

/**
 * Did the model GRAB, or did it WRITE? Decidable, LLM-free, and the reason this file exists.
 * Every quote is checked for presence in the source it was numbered against — not in any source,
 * because attributing a real sentence to the wrong rule is its own defect.
 */
export function verifyExtraction(response, hits) {
  const { items, stray } = parseExtraction(response);
  const results = items.map((it) => {
    const src = hits[it.n - 1];
    const quote = (it.quote || '').trim();
    const base = { n: it.n, quote, gist: (it.gist || '').trim(), source: src ? `${src.file}:${src.line}` : null };
    if (!src) return { ...base, verdict: 'no-such-source' };
    if (!quote || quote === ABSTAIN) return { ...base, verdict: 'abstained' };
    const nq = norm(quote);
    if (nq.split(' ').filter(Boolean).length < MIN_QUOTE_WORDS) return { ...base, verdict: 'unverifiable' };
    return { ...base, verdict: norm(src.span).includes(nq) ? 'grabbed' : 'invented' };
  });
  const count = (v) => results.filter((r) => r.verdict === v).length;
  return {
    results,
    stray: stray.filter((s) => s.length > 24),   // a stray token is noise; a stray SENTENCE is prose
    grabbed: count('grabbed'), invented: count('invented'),
    abstained: count('abstained'), unverifiable: count('unverifiable'),
    ok: count('invented') === 0 && count('no-such-source') === 0,
  };
}

// ── qwen leg (opt-in) ────────────────────────────────────────────────────────────────────────
const OLLAMA = process.env.OLLAMA_HOST_URL || 'http://localhost:11434';

async function askQwen(prompt, model) {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const names = (await r.json()).models.map((m) => m.name);
    if (!names.some((n) => n.startsWith(model.split(':')[0]))) {
      throw new Error(`model '${model}' not present (have: ${names.join(', ')}) — ollama pull ${model}`);
    }
  } catch (e) {
    // "I did not run" and "I ran and produced this" stay different claims.
    const err = new Error(`ollama unreachable or model missing at ${OLLAMA}: ${e.message}. NOTHING WAS RUN.`);
    err.code = 3;
    throw err;
  }
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model, prompt, stream: false, options: { num_ctx: 8192, temperature: 0 } }),
    signal: AbortSignal.timeout(300000),
  });
  return ((await r.json()).response || '').trim();
}

async function main() {
  const args = process.argv.slice(2);
  const one = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const many = (f) => { const o = []; for (let i = 0; i < args.length; i++) if (args[i] === f) o.push(args[++i]); return o; };
  const has = (f) => args.includes(f);

  const query = one('--query', '') || args.filter((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')).join(' ');
  if (!query) { process.stderr.write('usage: rule-grab.mjs --query "<what did we already resolve about ...>" [--context-file f] [--corpus p]... [--cap N] [--json] [--qwen] [--strict]\n'); process.exit(2); }

  const ctxFile = one('--context-file', '');
  const context = ctxFile && existsSync(ctxFile) ? readFileSync(ctxFile, 'utf8') : '';
  const extra = many('--corpus');
  const res = grab(query, { context, cap: Number(one('--cap', 4)), paths: extra.length ? extra : DEFAULT_CORPUS });

  if (!has('--qwen')) {
    if (has('--json')) { process.stdout.write(JSON.stringify(res, null, 1) + '\n'); return; }
    process.stdout.write(`\n\x1b[1mGRABBED\x1b[0m — ${res.hits.length} span(s) from ${res.blocks} blocks in ${res.ms}ms · aperture ${res.aperture.eye}ch ${res.aperture.matched ? "MATCHED" : "UNMATCHED"} · ranked by ${res.sensor}\n`);
    process.stdout.write(`  ${res.aperture.reason}\n`);
    if (!res.lexicallySupported) process.stdout.write(`\n  \x1b[33m⚠ ${res.note}\x1b[0m\n`);
    for (const h of res.hits) {
      process.stdout.write(`\n\x1b[1m${h.file}:${h.line}\x1b[0m — ${h.title}\n  ncd ${h.ncd} · lex ${h.lex} · shared: ${h.overlap.slice(0, 6).join(', ') || '(none)'}\n`);
      for (const l of h.span.split('\n')) process.stdout.write(`    ${l}\n`);
    }
    process.stdout.write(res.hits.length ? '\nQuote these. Do not paraphrase them.\n' : '\nNothing found — the rule may never have been written into the corpus.\n');
    return;
  }

  if (!res.hits.length) { process.stderr.write('rule-grab: nothing retrieved — refusing to ask a model to fill the gap.\n'); process.exit(1); }
  const model = one('--model', 'qwen2.5:7b');
  const prompt = buildExtractPrompt(query, res.hits);
  process.stderr.write(`rule-grab: ${model} · ${res.hits.length} source(s) · ${prompt.length} chars → extracting…\n`);
  const response = await askQwen(prompt, model);
  const v = verifyExtraction(response, res.hits);

  if (has('--json')) { process.stdout.write(JSON.stringify({ ...res, model, verification: v }, null, 1) + '\n'); }
  else {
    process.stdout.write(`\n\x1b[1mVERIFIED EXTRACTION\x1b[0m — ${v.grabbed} grabbed · ${v.invented} invented · ${v.abstained} abstained · ${v.unverifiable} too-short\n`);
    for (const r of v.results.filter((r) => r.verdict === 'grabbed')) {
      process.stdout.write(`\n\x1b[32m✓\x1b[0m ${r.source}\n  “${r.quote}”\n  → ${r.gist}\n`);
    }
    for (const r of v.results.filter((r) => r.verdict === 'invented' || r.verdict === 'no-such-source')) {
      process.stdout.write(`\n\x1b[31m✗ REJECTED (${r.verdict}) — written, not grabbed; not present in ${r.source || 'any handed source'}\x1b[0m\n  “${r.quote}”\n`);
    }
    if (v.stray.length) process.stdout.write(`\n\x1b[33m⚠ ${v.stray.length} stray prose line(s) outside the contract — the model narrated instead of grabbing.\x1b[0m\n`);
  }
  if (has('--strict') && !v.ok) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { process.stderr.write(`rule-grab: ${e.message}\n`); process.exit(e.code || 1); });
}
