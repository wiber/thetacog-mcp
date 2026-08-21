// scripts/rewrite/slop.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE SLOP DETECTOR — the actual point of the whole system.
//
// The operator's thesis, stated plainly: the watermark is a red herring. The real
// danger is not that text is machine-written; it is that text is SLOP — prose that
// occupies space without carrying a claim. Watermarking tags the slop instead of
// removing it. This module removes it.
//
// DETERMINISTIC AND LLM-FREE, ON PURPOSE. Asking a model "is this slop?" is asking
// the slop generator to police itself, and it answers with more slop. Every check
// here is a pattern match a human can read, argue with, and re-run to the same
// answer. That is what makes it usable as a test-suite assertion rather than an
// opinion.
//
// It runs in three places, which is what makes it load-bearing rather than decorative:
//   • on the SOURCE, feeding the card queue (slop is flagged even when the reader
//     model followed it fine — comprehensible slop is still slop)
//   • on every CANDIDATE, so a rewrite that fixes clarity by adding filler is
//     caught and penalized instead of quietly winning
//   • in the BATCH SUITE, as a document-level score that must go down over time
// ════════════════════════════════════════════════════════════════════════════

// ── The hedge/filler lexicon. Each entry: [pattern, weight, why] ──────────────
// Weights are severity, not frequency. A single "it's important to note" is worse
// than a single "very" because it announces the sentence instead of making it.
const PATTERNS = [
  // Narrator-voice meta — the book's own VOICE-RULES ban these outright.
  [/\bin other words\b/gi, 6, 'narrator-voice meta — say it once, correctly'],
  [/\bwhat this means is\b/gi, 6, 'narrator-voice meta'],
  [/\bthe point is\b/gi, 5, 'narrator-voice meta'],
  [/\bit'?s important to note\b/gi, 8, 'announces importance instead of demonstrating it'],
  [/\bit(?:'| i)s worth noting\b/gi, 7, 'announces importance instead of demonstrating it'],
  [/\bneedless to say\b/gi, 7, 'if needless, cut it'],
  [/\bthis (?:book|chapter|section|post) (?:argues|shows|demonstrates|explores)\b/gi, 7, 'meta about the text instead of the claim'],
  [/\bas (?:we|I) (?:discussed|mentioned|noted) (?:above|earlier|previously)\b/gi, 4, 'back-reference filler'],

  // Corporate abstraction — words that sound like meaning and are not.
  [/\bleverage(?:s|d|ing)?\b/gi, 4, 'corporate abstraction — name the actual mechanism'],
  [/\bsynerg(?:y|ies|istic)\b/gi, 6, 'corporate abstraction'],
  [/\bholistic(?:ally)?\b/gi, 5, 'corporate abstraction'],
  [/\bbest[- ]in[- ]class\b/gi, 6, 'marketing filler'],
  [/\bcutting[- ]edge\b/gi, 5, 'marketing filler'],
  [/\bstate[- ]of[- ]the[- ]art\b/gi, 4, 'marketing filler'],
  [/\bseamless(?:ly)?\b/gi, 5, 'marketing filler'],
  [/\brobust(?:ness)?\b/gi, 3, 'vague quality word — name the property'],
  [/\bpowerful\b/gi, 3, 'vague quality word'],
  [/\bgame[- ]chang(?:er|ing)\b/gi, 6, 'marketing filler'],
  [/\bunlock(?:s|ing)? (?:the )?(?:potential|value|power)\b/gi, 6, 'marketing filler'],
  [/\bdeep dive\b/gi, 4, 'corporate idiom'],
  [/\bmoving forward\b/gi, 4, 'corporate idiom'],
  [/\bat the end of the day\b/gi, 5, 'corporate idiom'],
  [/\bparadigm shift\b/gi, 5, 'corporate abstraction'],

  // Hedges — the book's register forbids pulling the punch.
  [/\b(?:might|may|could) potentially\b/gi, 6, 'double hedge'],
  [/\bsomewhat\b/gi, 3, 'hedge'],
  [/\brelatively speaking\b/gi, 4, 'hedge'],
  [/\bin some (?:sense|ways)\b/gi, 4, 'hedge'],
  [/\barguably\b/gi, 4, 'hedge — assert it or drop it'],
  [/\bgenerally speaking\b/gi, 4, 'hedge'],
  [/\bto some extent\b/gi, 4, 'hedge'],
  [/\bfairly\s+(?:clear|obvious|simple|straightforward)\b/gi, 4, 'hedge'],
  // Padding phrases that inflate a sentence without adding a claim — the exact
  // material a model reaches for when asked to make something "clearer".
  [/\bin essence\b/gi, 5, 'padding — the sentence should already be the essence'],
  [/\btends? to\b/gi, 3, 'hedge'],
  [/\bnotably\b/gi, 3, 'filler intensifier'],
  [/\ba situation (?:that|in which)\b/gi, 5, 'padding — name the situation'],
  [/\bover extended periods of time\b/gi, 5, 'padding for "over time"'],
  [/\bundergo(?:es|ing)?\b/gi, 3, 'nominalisation — prefer the verb'],
  [/\bwith precision\b/gi, 3, 'padding'],
  [/\bit is (?:often )?the case that\b/gi, 6, 'padding'],
  [/\bthere (?:is|are) a (?:number|variety) of\b/gi, 5, 'padding — count them or cut it'],
  [/\bserves? to\b/gi, 4, 'padding — use the verb directly'],
  [/\bin order to\b/gi, 2, 'padding for "to"'],
  [/\bdue to the fact that\b/gi, 6, 'padding for "because"'],
  [/\bat this point in time\b/gi, 6, 'padding for "now"'],

  // Intensifiers that weaken.
  [/\bvery\b/gi, 2, 'intensifier — pick a stronger word'],
  [/\breally\b/gi, 2, 'intensifier'],
  [/\bquite\b/gi, 2, 'intensifier'],
  [/\bactually\b/gi, 2, 'filler intensifier'],
  [/\bbasically\b/gi, 3, 'filler intensifier'],
  [/\bessentially\b/gi, 3, 'filler intensifier'],
  [/\bsimply put\b/gi, 4, 'filler'],

  // LLM tells — the specific cadence of generated prose.
  [/\bit(?:'| i)s not just .{2,40}[,;] it(?:'| i)s\b/gi, 7, 'the "not just X, it\'s Y" LLM cadence'],
  [/\bnot only .{2,40} but also\b/gi, 5, 'the "not only/but also" LLM cadence'],
  [/\bthink of it (?:like|as)\b/gi, 4, 'explainer cadence'],
  [/\bimagine (?:a|an|that|if)\b/gi, 3, 'explainer cadence'],
  [/\bin (?:today|todays|today's) (?:world|landscape|environment)\b/gi, 8, 'the canonical LLM opener'],
  [/\bever[- ]evolving\b/gi, 7, 'the canonical LLM adjective'],
  [/\bdelve[sd]? into\b/gi, 8, 'the canonical LLM verb'],
  [/\btapestry\b/gi, 7, 'the canonical LLM metaphor'],
  [/\brealm of\b/gi, 5, 'LLM idiom'],
  [/\bnavigat(?:e|ing) the (?:complex|complexities|landscape)\b/gi, 7, 'LLM idiom'],
  [/\bplays? a (?:crucial|vital|key|significant) role\b/gi, 6, 'LLM idiom'],
  [/\bit(?:'| i)s (?:crucial|essential|vital) to (?:understand|recognize|note)\b/gi, 7, 'LLM idiom'],
  [/\bfoster(?:s|ing)? a\b/gi, 4, 'LLM verb'],
  [/\bunderscore[sd]?\b/gi, 4, 'LLM verb'],
  [/\bmyriad\b/gi, 4, 'LLM word'],
  [/\bleveraging the power of\b/gi, 8, 'peak corporate slop'],
];

// Structural smells that need counting, not matching.
function structural(text) {
  const hits = [];
  const s = String(text || '');

  const emDashes = (s.match(/—/g) || []).length;
  if (emDashes >= 3) {
    hits.push({ kind: 'em-dash pileup', weight: 3 * (emDashes - 2), why: `${emDashes} em-dashes in one passage — the rhythm collapses`, count: emDashes });
  }

  // Triads: "X, Y, and Z" repeated is the signature LLM list rhythm.
  const triads = (s.match(/\b\w+, \w+,? and \w+\b/g) || []).length;
  if (triads >= 2) {
    hits.push({ kind: 'triad rhythm', weight: 3 * triads, why: `${triads} rule-of-three lists — mechanical cadence`, count: triads });
  }

  // Sentences that open the same way twice running.
  const sentences = s.split(/[.!?…]+\s+/).filter((x) => x.trim().length > 10);
  const openers = sentences.map((x) => x.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase());
  let repeats = 0;
  for (let i = 1; i < openers.length; i++) if (openers[i] && openers[i] === openers[i - 1]) repeats++;
  if (repeats) hits.push({ kind: 'repeated opener', weight: 4 * repeats, why: 'consecutive sentences open identically', count: repeats });

  return hits;
}

/**
 * Score a passage for slop.
 * @returns {{score:number, density:number, hits:Array, verdict:string}}
 *   score   — raw weighted sum (unbounded)
 *   density — score per 100 words, the comparable figure
 *   verdict — CLEAN | TRACE | SLOP | HEAVY-SLOP
 */
export function slopScore(text) {
  const s = String(text || '');
  const words = (s.match(/[A-Za-z0-9'’-]+/g) || []).length;
  const hits = [];

  for (const [re, weight, why] of PATTERNS) {
    const matches = s.match(re);
    if (!matches?.length) continue;
    hits.push({
      kind: matches[0].toLowerCase().trim(),
      weight: weight * matches.length,
      why,
      count: matches.length,
    });
  }
  hits.push(...structural(s));

  const score = hits.reduce((a, h) => a + h.weight, 0);
  const density = words ? +(score / words * 100).toFixed(2) : 0;

  let verdict = 'CLEAN';
  if (density >= 12) verdict = 'HEAVY-SLOP';
  else if (density >= 5) verdict = 'SLOP';
  else if (density > 0) verdict = 'TRACE';

  return {
    score,
    density,
    words,
    verdict,
    hits: hits.sort((a, b) => b.weight - a.weight).slice(0, 12),
  };
}

/**
 * Compare a candidate against the original. A rewrite that ADDS slop is rejected
 * regardless of how much clearer it reads — clarity bought with filler is the
 * exact trade this tool exists to refuse.
 */
export function slopDelta(original, candidate) {
  const b = slopScore(original);
  const a = slopScore(candidate);
  const delta = +(a.density - b.density).toFixed(2);
  return {
    before: b,
    after: a,
    delta,
    addedSlop: delta > 0.5,
    cleaned: delta < -0.5,
    introduced: a.hits.filter((h) => !b.hits.some((x) => x.kind === h.kind)).map((h) => h.kind),
  };
}

/**
 * Document-level sweep — used by the batch suite. Returns the worst offenders so
 * the suite report can point at them directly.
 */
export function sweepDocument(paragraphs) {
  const rows = paragraphs.map((p) => {
    const r = slopScore(p.text);
    return {
      paragraphIndex: p.index,
      startLine: p.startLine,
      endLine: p.endLine,
      density: r.density,
      score: r.score,
      verdict: r.verdict,
      topHits: r.hits.slice(0, 3),
    };
  });

  const totalWords = paragraphs.reduce((a, p) => a + (p.text.match(/[A-Za-z0-9'’-]+/g) || []).length, 0);
  const totalScore = rows.reduce((a, r) => a + r.score, 0);

  return {
    documentDensity: totalWords ? +(totalScore / totalWords * 100).toFixed(2) : 0,
    totalScore,
    totalWords,
    paragraphs: rows,
    worst: [...rows].sort((a, b) => b.density - a.density).filter((r) => r.score > 0).slice(0, 20),
    cleanPct: rows.length ? +(rows.filter((r) => r.verdict === 'CLEAN').length / rows.length * 100).toFixed(1) : 100,
  };
}

export { PATTERNS };
