// scripts/rewrite/diagnose.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE DIAGNOSTIC ENGINE — the reader's internal monologue as a defect detector.
//
// The insight this whole system rests on: do not ask a model "is this sentence
// bad?" — that produces flattery and generic advice. Ask it to BE the reader and
// report what it is actually thinking as it goes. When the monologue turns cold
// ("wait, what is a ballistic walk?"), that is the defect, located exactly.
//
// The split is inherited from scripts/cog/ollama-monologue.mjs and is load-bearing:
// the local model produces the REALITY monologue and is never shown the author's
// intent — a real reader does not have it. It reports comprehension, not quality.
//
// SLIDING WINDOW (the spec's chunking answer): the model reads target ± 1
// paragraph but is instructed to SCORE ONLY the target. One sentence alone has no
// context and the monologue is meaningless; a whole chapter and the monologue
// generalizes into mush. Three paragraphs is the size where the reader still has
// a continuous thread but the scoring stays local.
// ════════════════════════════════════════════════════════════════════════════

import { local, cloud, extractJson } from './llm.mjs';
import { contextWindow } from './chunker.mjs';

// ── WHICH ENGINE READS? (measured on this machine, 2026-08-11) ──────────────
//   local  qwen2.5:7b — a bare 2-token call costs 27s; a full diagnose exceeded
//          the 120s timeout and returned nothing. Unusable as the scanner here.
//   cloud  claude -p from a neutral cwd — 34s and markedly better monologues.
//
// The scanner defaults to CLOUD for that reason. This does NOT reintroduce the
// watermark the whole tool exists to scrub: diagnosis only *reads* and emits a
// score plus a monologue, none of which reaches the manuscript. The rewrites are
// what get published, and the local tracks (A/B) still generate those. Set
// REWRITE_DIAGNOSE_ENGINE=local for a fully offline scan on faster hardware.
export const DIAGNOSE_ENGINE = process.env.REWRITE_DIAGNOSE_ENGINE || 'cloud';

export const DEFAULT_PERSONA =
  'Budget Writer — the person who signs the check; technical-fluent (reads patents, respects physics) but allergic to brand cosmology without a procurement line. Busy. Skims when bored, and does not pretend to understand things they do not.';

/**
 * Build the diagnostic prompt for ONE window.
 * The model is explicitly forbidden from praising, summarizing, or editing —
 * every one of those is a failure mode that ruins the signal.
 */
function buildPrompt({ win, persona, primer }) {
  const ctxBefore = win.before.map((p) => p.text).join('\n\n');
  const ctxAfter = win.after.map((p) => p.text).join('\n\n');

  const numbered = win.target.sentences
    .map((s, i) => `[S${i}] ${s.text}`)
    .join('\n');

  return `You are role-playing a READER, not an editor. You have never seen this text before.

WHO YOU ARE:
${persona}
${primer ? `\nWHAT YOU ALREADY KNOW WALKING IN (do not treat this as part of the text):\n${primer}\n` : ''}
You are reading a book. Here is the passage BEFORE the part we care about (for flow only — do NOT score it):
"""
${ctxBefore || '(this is the opening — nothing precedes it)'}
"""

Here is the passage AFTER (for flow only — do NOT score it):
"""
${ctxAfter || '(nothing follows — this is the end)'}
"""

NOW — the paragraph you must actually evaluate, split into numbered sentences:
"""
${numbered}
"""

YOUR JOB — for EACH numbered sentence, report the honest thought in your head the
moment you finish reading it. Not what an editor would say. What YOU are thinking.

Then rate how well you FOLLOWED it, 0-100:
  100 = perfectly clear, you know exactly what was meant and why it matters
   70 = you got it but had to work
   40 = you think you got it but you are guessing
    0 = you have no idea what this means, or you read it twice and gave up

HARD RULES:
- Do NOT praise. Do NOT suggest rewrites. Do NOT summarize the passage.
- If a sentence is clear, say so briefly and score it high. Most sentences are fine.
- Only score low when your comprehension ACTUALLY broke — an undefined
  load-bearing term, a sentence you had to re-read, a claim that does not follow,
  or corporate slop that says nothing.
- "reads a bit long" is NOT a defect if you understood it. Score on comprehension.

Return ONLY valid JSON, no prose around it:
{"sentences":[{"i":0,"monologue":"<your actual thought, first person, one or two sentences>","score":<0-100>,"defect":"<one of: none|undefined-term|reread|non-sequitur|slop|ambiguous>"}]}`;
}

/**
 * Diagnose one paragraph (with its context window). Returns per-sentence
 * monologue + comprehension score. Never throws — a failed scan yields null so
 * the scanner can move on rather than stalling the queue.
 */
export async function diagnoseParagraph(paragraphs, targetIndex, { persona = DEFAULT_PERSONA, primer = '', model, engine = DIAGNOSE_ENGINE } = {}) {
  const win = contextWindow(paragraphs, targetIndex, 1, 1);
  if (!win.target || !win.target.sentences.length) return null;

  const prompt = buildPrompt({ win, persona, primer });
  // `usedEngine` is reported back because the right-margin heatmap draws a
  // separate scan line per engine. Assuming the requested engine ran would paint
  // a local scan line for work the cloud actually did — a lie in the one panel
  // whose whole job is showing which engine covered which part of the document.
  let usedEngine = engine;
  let res = engine === 'local'
    ? await local(prompt, { json: true, temperature: 0.4, model })
    : await cloud(prompt);

  // One fallback hop so a single dead engine degrades instead of stalling the queue.
  if (!res.ok) {
    usedEngine = engine === 'local' ? 'cloud' : 'local';
    res = engine === 'local' ? await cloud(prompt) : await local(prompt, { json: true, temperature: 0.4, model });
  }
  if (!res.ok) return { ok: false, error: res.error, paragraphIndex: targetIndex, ms: res.ms, engine: usedEngine };

  const parsed = extractJson(res.text);
  const rows = parsed?.sentences;
  if (!Array.isArray(rows)) {
    return { ok: false, error: 'no parseable sentences[] in diagnostic output', paragraphIndex: targetIndex, ms: res.ms };
  }

  const findings = [];
  for (const r of rows) {
    const i = Number(r?.i);
    const sentence = win.target.sentences[i];
    if (!sentence) continue;
    let score = Number(r?.score);
    if (!Number.isFinite(score)) score = 100;
    score = Math.max(0, Math.min(100, score));
    findings.push({
      paragraphIndex: targetIndex,
      sentenceIndex: i,
      text: sentence.text,
      start: sentence.start,
      end: sentence.end,
      monologue: String(r?.monologue || '').trim(),
      score,
      defect: String(r?.defect || 'none'),
    });
  }

  return {
    ok: true,
    paragraphIndex: targetIndex,
    startLine: win.target.startLine,
    endLine: win.target.endLine,
    findings,
    ms: res.ms,
    model: res.model,
    engine: usedEngine,
  };
}

/**
 * Rank findings into the card queue order: coldest monologue first.
 * `defect` breaks ties — an undefined load-bearing term outranks a merely long
 * sentence at the same score, because it is the failure that actually inverts
 * the reader (mdx-cook's three real defects).
 */
const DEFECT_WEIGHT = {
  'undefined-term': 12,
  'non-sequitur': 10,
  'slop': 8,
  'reread': 6,
  'ambiguous': 4,
  'none': 0,
};

/**
 * Rank by the DIP, not by an absolute threshold.
 *
 * The absolute-threshold version was wrong and it showed: on well-written prose
 * every sentence scored ≥80, nothing was ever flagged, and the queue sat empty
 * while the console said "scanning". That is the tool refusing to work precisely
 * on the writing it was built for. Worse, an absolute bar asks the reader model
 * for a calibrated global judgement, which is the one thing it cannot give — its
 * scores drift with the passage's difficulty, so 78 in dense technical prose and
 * 78 in a plain narrative mean different things.
 *
 * What IS reliable is the model's *relative* reaction inside one passage: which
 * sentence made it stumble compared to its neighbours. So the baseline is local
 * (the median of the surrounding scores) and the signal is the drop below it.
 * There is ALWAYS a worst sentence, so there is always something to work on.
 *
 * `alwaysReturn` guarantees at least one candidate per paragraph. Anything above
 * `goodEnough` relative to its baseline is still returned but marked
 * `goodEnough:true`, so the caller can skip it AND log why — the skips are data
 * about what "already good" looks like, not silence.
 */
export function rankFindings(findings, { minChars = 25, alwaysReturn = 1, goodEnoughDip = 6, goodEnoughScore = 88 } = {}) {
  const usable = findings.filter((f) => f.text.length >= minChars);
  if (!usable.length) return [];

  const scores = usable.map((f) => f.score).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)];
  // Baseline is the local median, floored so a uniformly weak passage still ranks
  // internally rather than declaring everything a catastrophe.
  const baseline = Math.max(median, 60);

  const ranked = usable
    .map((f) => {
      const dip = baseline - f.score;
      const defect = DEFECT_WEIGHT[f.defect] || 0;
      return {
        ...f,
        baseline,
        dip,
        // Dip dominates; absolute coldness and named defect break ties.
        coldness: +(dip * 2 + (100 - f.score) * 0.5 + defect).toFixed(2),
        goodEnough: dip < goodEnoughDip && f.score >= goodEnoughScore,
      };
    })
    .sort((a, b) => b.coldness - a.coldness);

  // Always hand back the worst one even when the whole paragraph reads well —
  // the caller decides whether to serve it or log it as good-enough.
  const flagged = ranked.filter((f) => !f.goodEnough);
  return flagged.length ? flagged : ranked.slice(0, alwaysReturn);
}
