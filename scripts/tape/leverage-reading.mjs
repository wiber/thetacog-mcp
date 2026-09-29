// packages/thetacog-mcp/scripts/tape/leverage-reading.mjs — THE DISPLAY DOOR FOR THE UPSTREAM
// LEVERAGE READING. IT READS A RECORD. IT NEVER RUNS A WALK.
//
// ── THE FAILURE THIS EXISTS INSIDE OF ─────────────────────────────────────────────────────────
// Minted questions drifted downward into technical specification — "LRU or LFU for cache eviction?",
// "which flag defaults to what". A spec question is an IMPLEMENTATION of an intent, so a tape that
// captures only the spec never captures the why, and can therefore never measure whether the why
// survived. It also turns the operator into a human compiler: they are in the chair to make the
// tradeoff a machine cannot make, not to name the caching layer.
//
// The metric that separates the two is LEVERAGE = FANOUT × (1 − TRANSLATION), computed on the REAL
// recursive ballistic walk over the canonical connectivity DAG:
//   FANOUT      how many of the 144 coordinates the answer's cell actually governs downstream
//   TRANSLATION mean gzip-NCD between the answer's rule text and the text already sitting at each
//               cell it reaches — low means the answer already speaks in the terms of what it
//               governs (zero-translate)
// and the question-level reading is the MIN across its answers, never the mean: a question is only
// upstream if BOTH branches are upstream. That choice is a JUDGMENT CALL, stated here rather than
// buried — it has not been calibrated against a corpus of questions, and the mean would let one
// values-branch carry one spec-branch.
//
// ── WHY THIS FILE IS A READER AND NOT A CALCULATOR ────────────────────────────────────────────
// The walk is minutes long against a locked body (next-question.mjs: "PERSIST THE RANKING. THE PAGE
// MUST NEVER RUN THIS WALK."), and a page that pays for it by falling back to a cheap approximation
// is showing a DIFFERENT metric than the one that was calibrated — which is how this project's last
// three measurement failures happened. So the expensive half runs offline (upstream-leverage.mjs,
// called from propose-questions.mjs) and PERSISTS its verdict into questions.ndjson; every surface
// here reads that record and renders it WITH its timestamp, so a stale reading is visibly stale.
//
// This module deliberately does NOT import upstream-leverage.mjs. Two reasons, both load-bearing:
//   (1) it is imported by the cockpit's SSR routes, and the cockpit's standing lesson is that engine
//       modules must never enter Vite's module graph ("Cannot find module unified-drift.mjs"); a
//       calculator reachable from a page load is a walk waiting to be run on a page load.
//   (2) tolerating the computing module's absence is then structural rather than a try/catch: if
//       nothing has ever computed a reading, every surface says so in the same words.
// It has ZERO imports for that reason. Keep it that way.
//
// ── THE CONTRACT IT READS (tolerant, because the writer is being built in parallel) ───────────
//   ask.answers[i].fanout       number — reachable-set size from that answer's representative cell
//   ask.answers[i].translation  number — mean gzip-NCD distance to the text at the cells it reaches
//   ask.answers[i].leverage     number — fanout × (1 − translation)
//   ask.leverage                number, or { value|aggregate, altitude, reason } — question-level
//   ask.altitude                'UPSTREAM' | 'DOWNSTREAM', or { class, reason }
// A missing key is never a zero. It is an `unmeasured` string that names WHICH file would have held
// the number and WHICH command produces it.
//
// ALTITUDE IS READ, NEVER CLASSIFIED HERE. The threshold that separates a design tradeoff from a
// spec question is owned by upstream-leverage.mjs and persisted with the ranking. If this file grew
// its own threshold there would be two answers to "is this question upstream?", which is exactly the
// two-doors failure the retirement check already cost this repo once (0.62 here, 0.52 there).
//
// LLM-FREE and side-effect-free by construction: pure arithmetic over a record that is already on
// disk. @guard tests/tape/leverage-on-the-glass.test.mjs

/** The aggregation choice, in one place, so the page and the JSON say the same sentence. */
export const AGGREGATE_BASIS =
  'MIN across the answers — a question is only upstream if BOTH branches are (judgment call, not a measured one)';

const CMD = (slug) =>
  `node packages/thetacog-mcp/scripts/tape/propose-questions.mjs --slug ${slug || '<slug>'} --n 4 --keep`;

/** A finite number, or null. A numeric string counts; anything else does not silently become 0. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const round = (v, d = 3) => (v === null ? null : +v.toFixed(d));

/** Plain words for the altitude verdict — the operator reads a sentence, not a class name. */
export function altitudeWords(cls, reason = null) {
  const c = cls ? String(cls).toUpperCase() : null;
  if (c === 'UPSTREAM') {
    return `UPSTREAM — a design tradeoff. Answering it constrains a large downstream set, and the spec questions beneath it can be derived rather than asked.${reason ? ' ' + reason : ''}`;
  }
  if (c === 'DOWNSTREAM') {
    return `DOWNSTREAM — a spec question. It names an implementation choice that an upstream tradeoff would have derived, so answering it spends the operator on work a subagent could have done.${reason ? ' ' + reason : ''}`;
  }
  return null;
}

/**
 * Normalize the persisted leverage reading on ONE ranking record's ask.
 *
 * @param ask     the `ask` object out of questions.ndjson (may be null)
 * @param opts    { askedAt, ageMinutes, slug } — the ranking's own timestamp rides along so every
 *                surface renders the reading WITH its age instead of as a timeless fact
 * @returns       { measured, answers[], aggregate, aggregateSource, aggregateBasis, altitude,
 *                  altitudeWords, computedAt, ageMinutes, unmeasured }
 *                — `unmeasured` is a sentence naming what is missing, never a 0 and never a blank.
 */
export function leverageReading(ask, { askedAt = null, ageMinutes = null, slug = null } = {}) {
  const base = {
    measured: false,
    answers: [],
    aggregate: null,
    aggregateSource: null,
    aggregateBasis: AGGREGATE_BASIS,
    altitude: null,
    altitudeWords: null,
    computedAt: askedAt,
    ageMinutes,
    unmeasured: null,
  };

  if (!ask) {
    return { ...base, unmeasured: `unmeasured — there is no ask on this ranking record, so there is nothing to have a leverage reading. Mint one with: ${CMD(slug)}` };
  }

  const rawAnswers = Array.isArray(ask.answers) ? ask.answers : [];
  const answers = rawAnswers.map((a) => {
    const fanout = num(a?.fanout);
    const translation = num(a?.translation);
    // Prefer the persisted product. Deriving it from the two parts is arithmetic on numbers that are
    // already on disk — not a second metric — and it is labelled as derived so the two are never
    // confused on the glass.
    const persisted = num(a?.leverage);
    const derived = fanout !== null && translation !== null ? fanout * (1 - translation) : null;
    const leverage = persisted !== null ? persisted : derived;
    return {
      label: a?.label ?? null,
      coord: a?.coord ?? null,
      fanout,
      translation: round(translation),
      leverage: round(leverage, 2),
      leverageSource: persisted !== null ? 'persisted' : derived !== null ? 'derived from the persisted fanout × (1 − translation)' : null,
      unmeasured: leverage !== null ? null
        : `unmeasured — no leverage reading in questions.ndjson for this answer${fanout === null && translation === null ? ' (neither fanout nor translation was persisted with the ranking)' : fanout === null ? ' (translation was persisted, fanout was not)' : ' (fanout was persisted, translation was not)'}`,
    };
  });

  const read = answers.filter((a) => a.leverage !== null);
  if (!read.length) {
    return {
      ...base,
      answers,
      unmeasured: `unmeasured — no leverage reading in questions.ndjson for this ranking (${rawAnswers.length} answer(s), none carrying fanout/translation/leverage). The walk that produces it is minutes long and runs offline, never on a page load: ${CMD(slug)}`,
    };
  }

  // THE AGGREGATE IS ONLY DEFINED WHEN EVERY BRANCH IS READ. The MIN across answers is a claim about
  // the WEAKER branch; taking it over a subset would silently promote a question whose unread branch
  // is the spec-shaped one. A partial reading is reported as partial, not as a smaller minimum.
  const persistedQ = num(typeof ask.leverage === 'object' && ask.leverage !== null
    ? (ask.leverage.value ?? ask.leverage.aggregate ?? ask.leverage.leverage)
    : ask.leverage);
  let aggregate = null, aggregateSource = null, partial = null;
  if (persistedQ !== null) {
    aggregate = round(persistedQ, 2);
    aggregateSource = 'persisted with the ranking';
  } else if (read.length === answers.length) {
    aggregate = round(Math.min(...read.map((a) => a.leverage)), 2);
    aggregateSource = `derived on read: ${AGGREGATE_BASIS}`;
  } else {
    partial = `unmeasured — only ${read.length} of ${answers.length} answer(s) carry a leverage reading, and the MIN across branches is not defined while a branch is unread`;
  }

  const altRaw = (typeof ask.altitude === 'object' && ask.altitude !== null ? ask.altitude.class : ask.altitude)
    ?? (typeof ask.leverage === 'object' && ask.leverage !== null ? ask.leverage.altitude : null);
  const altReason = (typeof ask.altitude === 'object' && ask.altitude !== null ? ask.altitude.reason : null)
    ?? (typeof ask.leverage === 'object' && ask.leverage !== null ? ask.leverage.reason : null)
    ?? null;
  const altitude = altRaw ? String(altRaw).toUpperCase() : null;
  const words = altitudeWords(altitude, altReason);

  return {
    ...base,
    measured: true,
    answers,
    aggregate,
    aggregateSource,
    altitude: words ? altitude : null,
    altitudeWords: words,
    unmeasured: [
      partial,
      words ? null : 'altitude unmeasured — this ranking carries leverage numbers but no UPSTREAM/DOWNSTREAM verdict. The threshold that separates a design tradeoff from a spec question is owned by upstream-leverage.mjs and is persisted with the ranking; this surface reads it and never re-derives it.',
    ].filter(Boolean).join(' · ') || null,
  };
}
