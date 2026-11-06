// scripts/rewrite/tracks.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE PARALLEL GENERATION MATRIX — the four tracks under test.
//
//   A  local            qwen2.5:7b, no guidance          (the raw local baseline)
//   B  local+tesseract  qwen2.5:7b + semantic fence       (does the fence help a small model?)
//   C  cloud            claude -p, no guidance            (the raw capable baseline)
//   D  cloud+tesseract  claude -p + semantic fence        (does the fence help a strong model?)
//
// All four fire CONCURRENTLY for a flagged sentence. The prompt is byte-identical
// across A/B and C/D except for the injected fence — that is the whole point. If
// the prompts differed in any other way the win-rate would measure prompt quality
// instead of Tesseract, and the experiment would be worthless.
//
// EVERY candidate — guided or not — is measured by Tesseract afterward. Guidance
// and measurement are deliberately separate: the unguided tracks are scored by the
// same ruler so "did the fence actually change the outcome" is answerable.
// ════════════════════════════════════════════════════════════════════════════

import { local, cloud, extractJson } from './llm.mjs';
import { timeoutFor } from './models.mjs';
import * as tess from './tesseract.mjs';
import { spliceRange } from './chunker.mjs';
import { slopDelta } from './slop.mjs';
import { readabilityDelta } from './readability.mjs';

// Colours follow the spec's attribution key: Blue = Local, Gold = Local+Tesseract,
// Magenta = Cloud, Amber = Cloud+Tesseract, Grey = Manual. They are the same
// colours used by the in-line badges, the right-margin heatmap, and the
// scoreboard, so a glance at any of the three reads the same way.
export const TRACKS = [
  { id: 'A', key: 'local',            label: 'Local',        engine: 'local', tesseract: false, color: '#4fc3f7' },
  { id: 'B', key: 'local+tesseract',  label: 'Local + Tess', engine: 'local', tesseract: true,  color: '#ffd166' },
  { id: 'C', key: 'cloud',            label: 'Cloud',        engine: 'cloud', tesseract: false, color: '#e879f9' },
  { id: 'D', key: 'cloud+tesseract',  label: 'Cloud + Tess', engine: 'cloud', tesseract: true,  color: '#fb923c' },
];
export const MANUAL_COLOR = '#8b98a5';
export const ORIGINAL_COLOR = '#5c6773';

export const TRACK_BY_ID = new Map(TRACKS.map((t) => [t.id, t]));

/**
 * The shared rewrite prompt. `fence` is the ONLY variable between a track and its
 * un-guided twin.
 */
function buildRewritePrompt({ sentence, paragraph, before, after, monologue, defect, fence, direction, n = 4 }) {
  return `${direction ? `── THE WRITER'S DIRECTION — THIS OVERRIDES EVERYTHING BELOW ──
${direction}

The sentence below is not merely awkward; the writer has told you what it must
actually DO. Do not smooth the existing phrasing — that is the failure mode here.
Rebuild the sentence around the direction, even if that means replacing the claim's
framing entirely. A rewrite that reads beautifully and ignores this is wrong.

` : ''}You are rewriting ONE sentence inside a book passage. The book is
"Tesseract Physics — Fire Together, Ground Together". The prose is dense,
declarative, and technical. It is NOT corporate copy and must never drift toward it.

── WHY THIS SENTENCE IS FLAGGED ──
A reader read this passage cold and their comprehension broke here.
Their actual inner monologue at this sentence:
  "${monologue}"
Diagnosed failure: ${defect}

Your rewrite succeeds if and only if that monologue would no longer happen —
the reader follows it on the first pass, at speed, without re-reading.

── THE PASSAGE (context — do not rewrite these) ──
${before ? `[preceding]\n${before}\n` : ''}
[the paragraph containing the target]
${paragraph}
${after ? `\n[following]\n${after}` : ''}

── THE SENTENCE TO REWRITE (this exact string, nothing else) ──
${sentence}
${fence ? `\n${fence}\n` : ''}
── HARD CONSTRAINTS ──
1. Preserve the CLAIM exactly. You are fixing how it reads, never what it asserts.
   If you find yourself softening, hedging, or generalizing the claim, stop and start over.
2. Output a replacement for the sentence ONLY. It must drop in where the original
   sits and leave the paragraph grammatical and continuous.
3. No em-dash pileups, no "In other words", no "What this means is", no
   "It's important to note". Those are the slop this book is written against.
4. Keep the author's register: cold, final, unapologetic, mechanism named precisely.
5. Do not add a citation, a hedge, or a transition the original did not have.
6. Match the original's approximate length. A fix that triples the length is not a fix.

Produce ${n} genuinely DIFFERENT rewrites — different strategies, not three
paraphrases of one idea (e.g. one that defines the hard term inline, one that
splits the load across two clauses, one that reorders so the subject lands first).

For each, give a one-line motivation stating WHICH part of the reader's monologue
it kills. Not "clearer and more concise" — name the specific confusion resolved.

Return ONLY valid JSON, no prose around it:
{"rewrites":[{"text":"<the replacement sentence>","motivation":"<what confusion this kills>"}]}`;
}

/**
 * Run ONE track for a flagged finding.
 * Never throws — a failed track reports {ok:false} and the card renders without it.
 */
export async function runTrack(track, ctx) {
  const t0 = Date.now();
  const { finding, paragraph, beforeText, afterText, repoRoot, raw, nPerTrack = 4, direction = '', modelId } = ctx;

  let fence = '';
  let placement = null;
  if (track.tesseract) {
    const g = await tess.guidanceBlock(paragraph.text, { repoRoot });
    if (g.available) {
      fence = g.block;
      placement = g.placement;
    } else {
      // Tesseract unavailable: report honestly rather than silently running
      // this as an unguided track and polluting the A/B.
      return {
        trackId: track.id,
        track: track.key,
        ok: false,
        skipped: true,                 // NOT a timeout. The distinction is the whole point.
        error: `tesseract unavailable — track skipped to keep the A/B honest: ${g.reason || 'no reason reported'}`,
        reason: g.reason || null,
        ms: Date.now() - t0,
        candidates: [],
      };
    }
  }

  const prompt = buildRewritePrompt({
    sentence: finding.text,
    paragraph: paragraph.text,
    before: beforeText,
    after: afterText,
    monologue: finding.monologue,
    defect: finding.defect,
    fence,
    direction,
    n: nPerTrack,
  });

  // TIMEOUT AUTHORITY IS models.mjs, NOT llm.mjs's fallback (fixed 2026-08-12).
  //
  // These two calls used to pass no timeout, so they silently took llm.mjs's defaults — 45s local,
  // 180s cloud — while models.mjs budgets 120s local, 420s opus, 300s sonnet. The generous budget
  // was unreachable from the only path that matters, and every track sat on the wrong ceiling:
  //
  //   A local        75% ok, avg 36.4s   ← brushing a 45s ceiling
  //   B local+tess   17% ok, avg 38.0s   ← same ceiling, bigger prompt, so mostly over it
  //   C cloud         0% ok, avg 210.0s  ← a 180s ceiling it could never clear
  //   D cloud+tess    0% ok, avg 157.0s  ← same
  //
  // The A/B this whole branch exists to run was therefore not measuring the fence. It was measuring
  // which arm had the shorter prompt, because the fenced twin pays its extra tokens straight into a
  // budget that was 2.7x too tight. One rule (how long a model may take) had two homes; this is the
  // one that loses. See docs/architecture/one-rule-one-place notes in CLAUDE.md.
  const timeout = timeoutFor(modelId || `${track.engine}:`);
  const res = track.engine === 'local'
    ? await local(prompt, { json: true, temperature: 0.8, timeout })
    : await cloud(prompt, { cwd: repoRoot, timeout });

  if (!res.ok) {
    return { trackId: track.id, track: track.key, ok: false, error: res.error, ms: Date.now() - t0, candidates: [] };
  }

  const parsed = extractJson(res.text);
  let rewrites = Array.isArray(parsed?.rewrites) ? parsed.rewrites : [];
  // Some models return a bare array, or a single object.
  if (!rewrites.length && Array.isArray(parsed)) rewrites = parsed;
  if (!rewrites.length && parsed?.text) rewrites = [parsed];

  const candidates = [];
  for (const r of rewrites) {
    const text = String(r?.text || '').trim();
    if (!text || text === finding.text) continue;
    candidates.push({
      text,
      motivation: String(r?.motivation || '').trim(),
      trackId: track.id,
      track: track.key,
      engine: track.engine,
      guided: track.tesseract,
    });
  }

  return {
    trackId: track.id,
    track: track.key,
    ok: true,
    ms: Date.now() - t0,
    model: res.model,
    costUsd: res.costUsd ?? null,
    placement: placement ? { coords: placement.coords, sigma: placement.sigma, apertureRatio: placement.apertureRatio, apertureMismatch: placement.apertureMismatch, sensor: placement.sensor, cells: placement.cells } : null,
    candidates,
  };
}

/**
 * Measure a candidate on THREE independent rulers. Applied to every candidate
 * regardless of track — same rulers for all four, which is the only way the A/B
 * means anything.
 *
 *   slop        deterministic, LLM-free. The one that can actually reject:
 *               a rewrite that buys clarity with filler is not a fix.
 *   readability Flesch-Kincaid + entropy. Familiar, limited, useful as a check
 *               that a "fix" did not just triple the length.
 *   drift       Tesseract displacement. Reports how far the passage moved.
 *               Deliberately NOT a quality gate — see tesseract.mjs for the
 *               calibration showing it cannot separate a good rewrite from
 *               nonsense at this scale.
 */
export async function measureCandidate(candidate, { paragraph, finding, originalPlacement }) {
  const slopD = slopDelta(finding.text, candidate.text);
  const readD = readabilityDelta(finding.text, candidate.text);

  let drift = null;
  if (originalPlacement) {
    // Offsets are absolute into `raw`; rebase them onto the paragraph string.
    const relStart = finding.start - paragraph.start;
    const relEnd = finding.end - paragraph.start;
    try {
      const mutated = spliceRange(paragraph.text, relStart, relEnd, candidate.text);
      drift = await tess.drift(originalPlacement, mutated);
    } catch { drift = null; }
  }

  // ── THE DILUTION GATE ────────────────────────────────────────────────
  // "Clarity achieved through dilution" is the failure this tool exists to
  // refuse. A model can always make a sentence *feel* easier by unpacking it into
  // twice the words, and Flesch-Kincaid rewards exactly that — shorter sentences,
  // fewer syllables per word, a better score, and a page that now takes longer to
  // read and says less per line. So length is checked against what was gained: a
  // candidate that inflates substantially while adding no new information and no
  // slop reduction is marked DILUTED and shown as rejected rather than offered as
  // a fix. It is not deleted — the writer can still take it — but it never sits
  // unlabelled next to a real improvement.
  const wordsBefore = readD.before?.words || 0;
  const wordsAfter = readD.after?.words || 0;
  const growth = wordsBefore ? wordsAfter / wordsBefore : 1;
  // 1.45, not 1.6: a candidate measured at ×1.59 — "is, in essence, a situation
  // that tends to arise when complex systems undergo evolutionary change over
  // extended periods of time" — slipped under a 1.6 bar while being textbook
  // dilution. Adding slop growth as a second trigger catches the same shape even
  // when the length gain is modest.
  const cleanedSlop = (slopD?.delta ?? 0) < -0.5;
  const addedSlop = (slopD?.delta ?? 0) > 0.5;
  const diluted = (growth >= 1.45 && !cleanedSlop) || (growth >= 1.15 && addedSlop);

  // ── SLOP-TO-MASS RATIO ────────────────────────────────────────────────
  // Slop occupies bytes and lights no new ground. A candidate that adds
  // characters without adding lattice cells is filler by construction, and this
  // states it as a ratio instead of a hunch: characters per occupied cell.
  //
  // Chosen as the first study metric on the card because it needs only ONE arm.
  // The cross-arm deflection (C vs D on the same sentence) is the sharper
  // measurement, but it requires both arms to have produced for that sentence —
  // and the balance data shows they frequently do not. A metric that is often
  // absent cannot anchor a panel.
  //
  // Deliberately NOT a quality verdict: dense prose legitimately packs many
  // characters into few cells. It is a comparison BETWEEN candidates for the same
  // sentence, where the original is the baseline.
  let massRatio = null;
  if (drift?.coords?.length) {
    massRatio = +(candidate.text.length / drift.coords.length).toFixed(1);
  }

  return {
    ...candidate,
    drift,
    slop: slopD,
    readability: readD,
    growth: +growth.toFixed(2),
    massRatio,                    // chars per occupied lattice cell
    cells: drift?.coords?.length ?? null,
    diluted,
    dilutionNote: diluted
      ? `${Math.round((growth - 1) * 100)}% longer without removing slop — clarity through dilution`
      : null,
  };
}

/**
 * ONE TRACK, ONE CARD — the unit the stack is built from.
 *
 * The stack is populated by four INDEPENDENT producers running in parallel, and
 * each card carries exactly one track's proposal for one sentence. The earlier
 * design fanned a single sentence out to all four tracks and merged them into one
 * card; that made the four engines move in lockstep at the speed of the slowest,
 * so one timing-out cloud call held up the whole card and the stack sat at zero.
 *
 * Independent producers mean a fast track keeps filling the stack while a slow one
 * is still thinking, and the win-rate falls out naturally: each card is attributable
 * to the process that made it, and the writer accepting or skipping it IS the vote.
 */
export async function runTrackCard(track, ctx) {
  // Placement and the governing rule set are independent reads; fetch together so
  // the card can show "where this sits" and "what governs it" side by side.
  const [originalPlacement, rules] = await Promise.all([
    tess.place(ctx.paragraph.text),
    tess.activeRules(ctx.paragraph.text).catch(() => null),
  ]);
  const result = await runTrack(track, ctx);
  if (!result.ok || !result.candidates.length) return { ...result, candidates: [], originalPlacement: null };

  const measured = await Promise.all(
    result.candidates.map((c) =>
      measureCandidate(c, { paragraph: ctx.paragraph, finding: ctx.finding, originalPlacement })
        .catch(() => ({ ...c, drift: null, slop: null, readability: null })),
    ),
  );

  return {
    ...result,
    candidates: measured,
    originalPlacement: originalPlacement && !originalPlacement.error ? {
      coords: originalPlacement.coords, sigma: originalPlacement.sigma, cells: originalPlacement.cells,
      sensor: originalPlacement.sensor, apertureRatio: originalPlacement.apertureRatio,
      apertureMismatch: originalPlacement.apertureMismatch, fillPct: originalPlacement.fillPct,
      rules,
    } : null,
  };
}

/**
 * Fire all enabled tracks in parallel, then measure every candidate in parallel.
 * Returns the full option set for one card, with the ORIGINAL always included as
 * the baseline option — the spec is explicit that "keep it" must be a first-class
 * choice, otherwise the tool coerces edits it hasn't earned.
 */
export async function runMatrix(ctx, enabledTrackIds = ['A', 'B', 'C', 'D']) {
  const active = TRACKS.filter((t) => enabledTrackIds.includes(t.id));

  // The original paragraph's placement — the reference every candidate is measured against.
  const originalPlacement = await tess.place(ctx.paragraph.text);

  const results = await Promise.all(active.map((t) => runTrack(t, ctx).catch((e) => ({
    trackId: t.id, track: t.key, ok: false, error: String(e?.message || e), candidates: [], ms: 0,
  }))));

  const flat = results.flatMap((r) => r.candidates);
  const measured = await Promise.all(
    flat.map((c) => measureCandidate(c, { paragraph: ctx.paragraph, finding: ctx.finding, originalPlacement })
      .catch(() => ({ ...c, drift: null }))),
  );

  // De-duplicate identical rewrites across tracks, but remember WHO proposed them —
  // convergence between an unguided and a guided track is itself a finding.
  const byText = new Map();
  for (const c of measured) {
    const key = c.text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (byText.has(key)) {
      byText.get(key).alsoFrom.push(c.trackId);
    } else {
      byText.set(key, { ...c, alsoFrom: [] });
    }
  }

  return {
    trackResults: results.map(({ candidates, ...meta }) => ({ ...meta, produced: candidates.length })),
    originalPlacement: originalPlacement && !originalPlacement.error ? {
      coords: originalPlacement.coords,
      sigma: originalPlacement.sigma,
      cells: originalPlacement.cells,
      sensor: originalPlacement.sensor,
      apertureRatio: originalPlacement.apertureRatio,
      apertureMismatch: originalPlacement.apertureMismatch,
      fillPct: originalPlacement.fillPct,
    } : null,
    candidates: [...byText.values()],
  };
}
