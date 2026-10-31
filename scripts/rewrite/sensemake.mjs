// scripts/rewrite/sensemake.mjs — ASK ONE MODEL TO IMPROVE THE SENSEMAKING OF WHAT IS IN THE BOX.
//
// The intent (operator 2026-08-12): "a button for each llm type, to rewrite to improve the sensemaking
// of what is in the editable … with checkboxes for context to include, default to the text before and
// after, add multiple choice ones, and the metrics (and the full tesseract? that would force us to see
// if the tesseract and the encircled pngs are correct)".
//
// That last clause is the design constraint, not a nice-to-have. When the TESSERACT context is on, the
// model is handed the SAME measurement the panel draws — the aperture the walk chose, the in-lane /
// bleed / drift counts, the coordinates the encircled regions sit on. So the suggestions and the
// picture are downstream of one number set. If the panel is lying, the suggestions read as nonsense
// against it, and the operator sees the disagreement instead of trusting a pretty grid. The instrument
// checks itself by being quoted.
//
// CONTEXT IS EXPLICIT AND OFF BY DEFAULT except before/after. Every flag that is ON is named in the
// returned meta, because "which context produced this suggestion" is the A/B question — an unlabelled
// suggestion is an uncountable one.

import { runModel } from './models.mjs';
import { extractJson } from './llm.mjs';

export const DEFAULT_CONTEXT = { before: true, after: true, metrics: false, tesseract: false, monologue: false };

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// SMALL MODELS ECHO THE TEMPLATE. llama3.2:1b returns "<the rewritten sentence> Actual text…" often
// enough that it would put literal angle-bracket placeholders into the author's prose. Strip the echo
// rather than dropping the option — the sentence after it is usually fine, and a model that needs this
// is exactly the one worth keeping in the A/B. Shared by the JSON path and the salvage path below.
const stripEcho = (t) => String(t || '')
  .replace(/^\s*<\s*(the\s+)?rewritten\s+sentence\s*>\s*/i, '')
  .replace(/^\s*(rewrite|option|alternative)\s*\d*\s*[:\-—]\s*/i, '')
  .trim();

/**
 * Build the prompt. Kept separate so the CLI can print exactly what was asked — a prompt you cannot
 * read is a measurement you cannot repeat.
 */
export function buildPrompt({ draft, card, window: win, panels, context = DEFAULT_CONTEXT, n = 4, picked, steer }) {
  const ctx = { ...DEFAULT_CONTEXT, ...context };
  const parts = [];

  parts.push(`You are improving the SENSEMAKING of one sentence in a longer piece of prose.`);
  parts.push(`Sensemaking means: a reader understands what is meant on the first pass, without re-reading and without having to guess what the sentence is doing there. You are NOT making it prettier, shorter, or more energetic. You are making it land.`);

  parts.push(`\n## THE SENTENCE (this is what you rewrite)\n${clip(draft, 1200)}`);

  // REROLLING ON AN EDITED DRAFT (operator 2026-08-12: "rerolling with the context in the editable").
  // Every press of a model button rewrites WHAT IS IN THE BOX, not the sentence as originally flagged.
  // Once the author has edited, the box is the intent and the original is only history — so the
  // original is shown as a floor, not a target: whatever the author already fixed must stay fixed.
  const original = String(card?.finding?.text || '').trim();
  if (original && original !== String(draft).trim()) {
    parts.push(`\n## WHAT IT SAID BEFORE THE AUTHOR EDITED IT\n${clip(original, 800)}\nThe author has already moved away from this. Do NOT revert toward it — treat their edit as the direction of travel and improve on it.`);
  }

  // before/after are DERIVED from the aperture window, never passed in pre-sliced: the window and the
  // sentence offsets are the same pair the panel measures, so the model reads exactly the span the
  // instrument read. A caller-shaped {before, after} would be free to drift from it.
  const sw = win?.sentenceInWindow;
  const before = win?.text && sw ? win.text.slice(0, sw.start) : '';
  const after = win?.text && sw ? win.text.slice(sw.end) : '';
  if (ctx.before && before.trim()) parts.push(`\n## WHAT COMES BEFORE\n${clip(before, 1500)}`);
  if (ctx.after && after.trim()) parts.push(`\n## WHAT COMES AFTER\n${clip(after, 1500)}`);

  if (ctx.monologue && card?.finding?.monologue) {
    parts.push(`\n## WHAT THE READER THOUGHT WHEN THEY HIT IT\n"${clip(card.finding.monologue, 500)}"\nThis is the comprehension break you are fixing. If your rewrite does not answer this thought, it has not worked.`);
  }

  if (ctx.metrics && card?.finding) {
    const f = card.finding;
    const bits = [];
    if (f.score != null) bits.push(`comprehension ${f.score}/100`);
    if (f.baseline != null && f.dip != null) bits.push(`baseline ${f.baseline}, dip ${f.dip}`);
    if (f.coldness != null) bits.push(`coldness ${f.coldness}`);
    if (f.defect && f.defect !== 'none') bits.push(`defect: ${clip(f.defect, 120)}`);
    if (f.globalBaseline != null) bits.push(`piece baseline ${f.globalBaseline}`);
    if (bits.length) parts.push(`\n## THE MEASUREMENTS ON THIS SENTENCE\n${bits.join(' · ')}\nThe dip is the drop from the surrounding baseline — that gap is what you are closing.`);
  }

  if (ctx.tesseract && panels && !panels.error) {
    // THE INSTRUMENT, QUOTED. Same numbers the encircled panel is drawn from.
    const ap = panels.aperture;
    const lines = [];
    if (ap) lines.push(`aperture: the walk entered at ${ap.actor} (actor) acting on ${ap.patient} (patient), grip ${ap.grip}`);
    lines.push(`placement: ${panels.green} cells in-lane · ${panels.amber} adjacent bleed · ${panels.red} orthogonal drift (${panels.offPct}% off-lane)`);
    if (panels.matchSigma != null) lines.push(`intent↔reality shape match σ ${panels.matchSigma}`);
    const regs = (panels.regions || []).slice(0, 6).map((r) => r.name || r.coord).filter(Boolean);
    if (regs.length) lines.push(`the encircled regions sit on: ${regs.join(' · ')}`);
    lines.push(`walk: ${panels.walkMode || 'unknown'}`);
    parts.push(`\n## WHERE THIS PASSAGE SITS ON THE LATTICE (the Tesseract reading the panel is drawn from)\n${lines.join('\n')}\nA rewrite that improves sensemaking should not fling the passage off its lane — it should say the same thing more clearly, from the same place. Treat a large off-lane number as a warning that the passage is already drifting from its neighbours.`);
  }

  // STEER (operator 2026-08-12: "if you pick an option and comment on what is wrong, the rewrite or
  // reroll should use the subagent chosen to rewrite the box"). The author has picked one candidate and
  // said what is wrong with it. That critique is the most specific instruction in the whole prompt —
  // it beats the generic sensemaking brief, because it is about THIS sentence and comes from the person
  // whose voice it has to be in. So it goes last and it is named as binding.
  if (steer && String(steer).trim()) {
    parts.push(`\n## THE CANDIDATE THE AUTHOR PICKED${picked ? `\n${clip(picked, 900)}` : ''}`);
    parts.push(`\n## WHAT THE AUTHOR SAYS IS WRONG WITH IT — FIX EXACTLY THIS\n"${clip(steer, 600)}"\nThis is the binding instruction. If any other guidance above conflicts with it, this wins. Do not fix things they did not complain about, and do not drift back toward earlier candidates.`);
  }

  parts.push(`\n## WHAT TO RETURN
Exactly ${n} alternatives, genuinely different from each other — not four rewordings of one idea. Each must be a drop-in replacement for THE SENTENCE: same role in the paragraph, same claim, better landing. Keep the author's voice; do not add hedges, do not add throat-clearing, do not start with "In other words".

Return ONLY JSON, no prose around it:
{"options":[{"text":"<the rewritten sentence>","why":"<8 words on what this one fixes>"}]}`);

  return parts.join('\n');
}

/**
 * Ask one model for N sensemaking alternatives.
 * @returns {Promise<{ok, options, model, engine, ms, context, error?, raw?}>}
 */
export async function sensemake({ modelId, draft, card, window: win, panels, context = DEFAULT_CONTEXT, n = 4, timeout, picked, steer }) {
  const ctx = { ...DEFAULT_CONTEXT, ...context };
  const body = String(draft || '').trim();
  if (!body) return { ok: false, error: 'nothing in the box to improve', options: [] };

  const prompt = buildPrompt({ draft: body, card, window: win, panels, context: ctx, n, picked, steer });
  const t0 = Date.now();
  const r = await runModel(modelId, prompt, timeout ? { timeout } : {});
  const ms = Date.now() - t0;
  if (!r?.ok) return { ok: false, error: r?.error || 'model call failed', options: [], model: modelId, ms, context: ctx, prompt };

  const parsed = extractJson(r.text || '');
  let options = Array.isArray(parsed?.options) ? parsed.options : [];
  // SMALL MODELS ECHO THE TEMPLATE. llama3.2:1b returns "<the rewritten sentence> Actual text…" often
  // enough that it would put literal angle-bracket placeholders into the author's prose. Strip the
  // echo rather than dropping the option — the sentence after it is usually fine, and a model that
  // needs this is exactly the one worth keeping in the A/B.
  options = options
    .map((o) => ({ text: stripEcho(o?.text), why: clip(o?.why, 90) }))
    .filter((o) => o.text && o.text !== body && !/^<.*>$/.test(o.text))
    .slice(0, n);

  // SALVAGE (2026-08-12). Small local models routinely ignore "return only JSON" and answer in prose.
  // Refusing that entirely made every llama3.2:1b press dead-end on "no usable options" — the model had
  // written perfectly good sentences and the parser threw them away. So when the JSON path yields
  // nothing, take the prose: sentence-shaped lines, longer than a fragment, that are not the draft. They
  // are labelled as salvaged, because a suggestion whose provenance is fuzzy must say so.
  if (!options.length) {
    const lines = String(r.text || '')
      .split(/\n+/)
      .map((l) => stripEcho(l.replace(/^\s*[-*\d.)\]]+\s*/, '').replace(/^["'`]|["'`]$/g, '')))
      .filter((l) => l.length > 25 && l.length < 600 && /[.!?]$/.test(l) && l !== body && !/^[{[]/.test(l) && !/^(here|sure|okay|certainly)\b/i.test(l));
    if (lines.length) {
      options = [...new Set(lines)].slice(0, n).map((text) => ({ text, why: 'salvaged — model did not return JSON' }));
    }
  }

  if (!options.length) {
    // Say WHICH failure it was. "No usable options" covers three different situations and the operator
    // can only act on one of them: a model that answers in placeholders is a model to stop pressing,
    // an unparseable answer might be worth a retry, and an empty answer is usually a timeout upstream.
    const raw = String(r.text || '');
    const placeholders = /<\s*(the\s+)?(rewritten|revised|new)\s+sentence\s*>/i.test(raw);
    const error = placeholders
      ? 'this model filled the template instead of writing — it returned placeholders, not sentences'
      : raw.trim() ? 'could not read an answer out of this model\'s reply' : 'the model returned nothing';
    return { ok: false, error, options: [], model: modelId, ms, context: ctx, raw: clip(raw, 400), prompt };
  }
  return { ok: true, options, model: modelId, ms, context: ctx, prompt, steer: steer || null };
}
