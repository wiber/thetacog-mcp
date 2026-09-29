// packages/thetacog-mcp/scripts/tape/next-question.mjs — WHICH QUESTION NARROWS THE CONE MOST.
//
// Operator, 2026-08-20, naming the objective function:
//   "the next coordinate is the question that answers what the best next step was... at the right
//    altitude... what is the condition that narrows the cone the most... it's probably some
//    mathematical way to describe that particular action. You can see it being done by people who
//    have good grip in the zone they're working in — they understand how to constrain the degree of
//    freedom in the right direction."
//
// ── THE INSIGHT, STATED PLAINLY ───────────────────────────────────────────────────────────────
// The best next question is NOT the most important one. It is the most CONSTRAINING one — the one
// whose answer removes the most degrees of freedom. Someone with grip does not ask what matters most;
// they ask what collapses the space fastest, because they can feel which unanswered thing is holding
// every other decision hostage. That feeling has a computable form, and this file is it.
//
// ── THE MATH ──────────────────────────────────────────────────────────────────────────────────
// A question Q has plausible answers A = {a1..an}. Each answer, if given, would lock a coordinate.
// Place every answer on the 144 lattice with the real walk. Then:
//
//   SPREAD(Q)    = mean pairwise Chebyshev distance between the answers' placements.
//                  If every answer lands in the SAME cell, the question carries no information —
//                  it is a formality, not a question. This is the term that kills "halt or auto?".
//
//   REDUCTION(Q) = width(cone) − E[width(cone ∪ {answer})], expectation over answers assumed
//                  equiprobable (we have no prior; assuming one would be inventing a belief).
//                  A coordinate that lands ON the centre tightens; one that lands far widens.
//
//   SCORE(Q)     = SPREAD(Q) × max(0, REDUCTION(Q) + ε)   — a question must BOTH discriminate
//                  between its answers AND tighten the cone. High spread with no reduction is a
//                  question that scatters; high reduction with no spread is a question already answered.
//
// WHAT THIS DOES NOT CLAIM. It ranks questions by how much they constrain the SEMANTIC SPACE, not by
// how much they matter to the business. A question can be maximally constraining and strategically
// trivial. The operator still chooses; this only stops the asking of formalities, which is the
// failure mode it was built for — two questions were asked by intuition before this existed, and the
// first of them ("halt or auto-redispatch?") is the worked example of a formality below.
//
// @guard tests/tape/next-question-ranks-by-constraint.test.mjs

import { resolve, dirname } from 'node:path';
import { chooseMeaningful } from "./choose-meaningful.mjs";
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..");
const SESSIONS_DIR = process.env.TAPE_SESSIONS_DIR || resolve(REPO, ".thetacog/tape-sessions");

const SHORTLEX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const IDX = Object.fromEntries(SHORTLEX.map((s, i) => [s, i]));
const NAMES = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund', B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
export const label = (c) => (c ? `${c} (${NAMES[String(c).split(',')[0]] || '?'} ⊕ ${NAMES[String(c).split(',')[1]] || '?'})` : 'UNMEASURED');

export function chebyshev(a, b) {
  if (!a || !b) return null;
  const [ar, ak] = String(a).split(','), [br, bk] = String(b).split(',');
  if (![ar, ak, br, bk].every((s) => Number.isInteger(IDX[s]))) return null;
  return Math.max(Math.abs(IDX[ar] - IDX[br]), Math.abs(IDX[ak] - IDX[bk]));
}

/** Cone width = mean distance from the medoid. Duplicated deliberately? No — imported. */
async function coneOf(coords) {
  const { cone } = await import(resolve(HERE, 'coordinates.mjs'));
  return cone(coords);
}

/** SPREAD — how differently the answers land. Zero spread = the question is a formality. */
export function spread(coords) {
  const cs = (coords || []).filter(Boolean);
  if (cs.length < 2) return { spread: 0, pairs: 0, reason: 'fewer than two placeable answers — not a question' };
  let sum = 0, n = 0;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const d = chebyshev(cs[i], cs[j]);
      if (d !== null) { sum += d; n++; }
    }
  }
  return { spread: n ? +(sum / n).toFixed(3) : 0, pairs: n, reason: null };
}

// ── THE DISPLACEMENT FIELD — WHAT SPREAD COULD NOT SEE ────────────────────────────────────────
// MEASURED 2026-08-20 after the operator rejected this file's own top pick: "the kind of active
// question is incorrect as of now — how can that be the question that closes most of the degrees of
// uncertainty?" He was right, and the file had already written down its own falsification: "If this
// metric is sound, Q-HALT must score LOWEST. That is the test." Q-HALT ranked FIRST.
//
// The mechanism: all three candidates scored 0 and classed WIDENING, so the sort fell through to its
// last tiebreak — raw SPREAD — and Q-HALT won on spread=3. Spread is the distance between the two
// ANSWERS. That is not what the operator asked for. His words: "you find the right kind of question
// by how far you can MOVE based on it." Not how far the answers sit from each other — how far the
// REST OF THE PROJECT moves when you pick one.
//
// So: re-place every locked coordinate with the answer bundled into its context, and read the field
// of displacements. The first attempt at this failed too, and the failure is instructive:
//
//   Q-UNIT moved all 8 coordinates by exactly 3, in exactly the same direction (C3,C1 → B3,C1).
//
// That is not the project reorganizing. That is the appended answer text DRAGGING every bundle the
// same way — a translation, an artifact of bundling, and averaging it produced leverage 2.667 for
// Q-UNIT and 2.667 for Q-HALT: no separation at all. So the field is split into two parts and only
// one of them is signal:
//
//   TRANSLATION      the modal displacement vector, shared by every coordinate. Discarded.
//   REORGANIZATION   mean distance of each coordinate's displacement from that modal one. THE SCORE.
//                    Zero means the answer moved everything identically and rearranged nothing.
//
// And one thing that is a GATE rather than a score:
//
//   COLLAPSE         the count of distinct cells the locked body occupies under an answer. If it
//                    drops below baseline, the answer text has SWAMPED the sensor — every coordinate
//                    now reads as the same cell, which is the META-BULK failure (mass overwhelming
//                    meaning), not a project that agrees. A question with a collapsing answer is
//                    DISQUALIFIED, because its readings are an artifact and cannot be ranked.
//
// The measurement over the 9 live coordinates, which is the calibration this file demanded:
//
//   Q-HALT   halt→1/3 cells ⚠COLLAPSE   auto→4/3   reorg 1.222   DISQUALIFIED
//   Q-UNIT   steer→2/3 ⚠COLLAPSE        dispatch→1/3 ⚠COLLAPSE   reorg 0.611   DISQUALIFIED
//   Q-WHO    private→3/3                product→3/3              reorg 1.055   SURVIVES → ask this
//
// Q-HALT scores last. The metric now passes the test it wrote for itself.
//
// WHY IT SEPARATES, since the obvious explanation is wrong: it is NOT answer length (Q-WHO has the
// LONGEST answers and collapses least, which is backwards from "long text swamps"). Q-WHO's answers
// are written in the project's own vocabulary — graduate, coordinate, CLAUDE.md, tape, repo — so they
// pull each locked rule DIFFERENTLY. Q-HALT's live in a corner vocabulary that reads the same against
// everything, so every bundle lands on one cell. A load-bearing question is phrased in the project's
// own terms; a formality is phrased in a corner's terms. That is the degrees-of-freedom criterion,
// and it is measurable without a model.
//
// ⚠ n = 3 QUESTIONS. This is a calibration against one rejection, not an established law. The honest
// validator is post-hoc: movement.mjs already records how far the project actually moved after each
// question, and this estimator should be checked against that record as it accumulates.
export function displacementField(baseCells, answerCells) {
  const v = [];
  for (let i = 0; i < baseCells.length; i++) {
    const a = baseCells[i], b = answerCells[i];
    if (!a || !b) continue;
    const [ar, ak] = String(a).split(','), [br, bk] = String(b).split(',');
    if (![ar, ak, br, bk].every((x) => Number.isInteger(IDX[x]))) continue;
    v.push([IDX[br] - IDX[ar], IDX[bk] - IDX[ak]]);
  }
  if (!v.length) return { translation: null, reorganization: null, distinct: 0, reason: 'no coordinate placed under both readings' };
  const tally = {};
  for (const d of v) { const k = d.join(','); tally[k] = (tally[k] || 0) + 1; }
  const translation = Object.entries(tally).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0].split(',').map(Number);
  const reorganization = +(v.reduce((s2, d) => s2 + Math.max(Math.abs(d[0] - translation[0]), Math.abs(d[1] - translation[1])), 0) / v.length).toFixed(3);
  return {
    translation, reorganization,
    distinct: new Set(answerCells.filter(Boolean)).size,
    n: v.length, reason: null,
  };
}

// ── THE NULL FLOOR — WHERE THE COLLAPSE GATE'S BOUNDARY ACTUALLY IS ───────────────────────────
// MEASURED 2026-08-20, after the gate went structurally unsatisfiable and froze the loop. At 13
// locked coordinates (context 2215 chars, answers ~180), EVERY answer of EVERY candidate read
// "collapse" under the strict `distinct < baseDistinct` gate — including Q-WHO's own answers, the
// question this file's calibration says must survive, and including the exact answer the operator
// locked as COORD-010. A re-rank ran after each lock and produced nothing, forever, BY CONSTRUCTION.
//
// The boundary was then measured with a proper negative control: insert an ALREADY-LOCKED rule as
// the "answer". It is verbatim inside the context already, so it adds ZERO information — whatever
// distinct-drop it causes is the bundling artifact, not semantic swamping. Over all 13 controls:
//
//   base 6 · null distribution {4,4,7,4,5,6,5,5,4,5,5,5,6} · min 4 · max 7 · mean 5.0
//   genuine swamp control (repetitive corner vocabulary, answer-sized): 1
//
// Two facts fall out. (1) A zero-information prefix can RAISE distinct above base (7 > 6) — so a
// one-or-two cell move in either direction is sensor noise, and a gate that reads it as swamping is
// measuring its own bundling. (2) The artifact band and the swamp band do not overlap: no
// zero-information control ever read below 4, and the true swamp read 1. The gate therefore sits at
// the MINIMUM of the measured null distribution — self-calibrating, so it scales with body size and
// context mass automatically instead of hardcoding a boundary that was only true at n=9.
//
// Re-scored against the floor, the calibration set keeps its ordering at 13 coordinates: Q-WHO
// (5,4) survives, Q-HALT dies on "auto" reading 1. The gate is back to doing its actual job —
// catching sensor artifacts — instead of vetoing every question that dares to carry mass.
//
// CONTROLS = 5 evenly-spaced locked rules (deterministic pick), not all N: the full-null run is
// N×N placements (~169 at n=13, minutes); 5 controls reached the same min on the measured body.
export async function measureBody(lockedCoords, { placeText, representativeCoord }) {
  const lockedRules = (lockedCoords || []).map((c) => c.rule).filter(Boolean);
  const context = lockedRules.join('\n');
  const cellsFor = async (prefix) => {
    const out = [];
    for (const r of lockedRules) {
      const pl = await placeText(prefix ? `${context}\n${prefix}\n${r}` : `${context}\n${r}`);
      out.push(pl.available ? representativeCoord(pl.coords) : null);
    }
    return out;
  };
  if (!lockedRules.length) return { lockedRules, baseCells: [], baseDistinct: 0, nullDistincts: [], floor: 0, cellsFor };
  const baseCells = await cellsFor(null);
  const baseDistinct = new Set(baseCells.filter(Boolean)).size;
  const K = Math.min(5, lockedRules.length);
  const idxs = [...new Set(Array.from({ length: K }, (_, i) => Math.round(i * (lockedRules.length - 1) / Math.max(1, K - 1))))];
  const nullDistincts = [];
  for (const i of idxs) {
    const cells = await cellsFor(lockedRules[i]);
    nullDistincts.push(new Set(cells.filter(Boolean)).size);
  }
  const floor = nullDistincts.length ? Math.min(...nullDistincts) : baseDistinct;
  return { lockedRules, baseCells, baseDistinct, nullDistincts, floor, cellsFor };
}

/**
 * Score ONE candidate question against the current cone.
 * question: { id, question, answers: [{ label, rule }] }  — `rule` is the coordinate that answer would lock.
 * `body` is the (expensive) measureBody() result; pass it when scoring several questions so the
 * base placement and the null floor are computed ONCE, not once per question.
 */
export async function scoreQuestion(question, lockedCoords, { placeText, representativeCoord }, body = null) {
  // ⚠ PLACE THE ANSWER BUNDLED WITH THE LOCKED COORDINATES, NEVER IN ISOLATION.
  //
  // MEASURED 2026-08-20, and this is the third time the same principle has paid:
  //   ISOLATED:  private → C,B1   product → C,B1   ← IDENTICAL. Zero discrimination.
  //   BUNDLED:   private → B3,B2  product → B3,C2  ← different cells.
  // Two ~180-char imperative sentences about the same project are the same size-order and the same
  // register, so gzip-NCD places them in the same neighbourhood no matter what they SAY. The signal
  // is not in the sentence; it is in how the sentence PULLS an existing body of context. The first
  // version of this file placed answers alone and consequently ranked Q-HALT — the question the
  // operator had explicitly rejected as a formality — as the best question in the set. That was the
  // metric failing its own calibration, and it failed because the sensor beneath it was blind.
  //
  // Same lesson as extraction fidelity (cut the eye, don't grow the mass) and plate selection (a
  // keyword bag scores identically against opposite passages): MEASURE AGAINST MATCHED CONTEXT.
  const context = (lockedCoords || []).map((c) => c.rule).filter(Boolean).join('\n');
  const placed = [];
  for (const a of question.answers || []) {
    const bundled = context ? `${context}\n${a.rule}` : a.rule;
    const p = await placeText(bundled);
    placed.push({
      ...a,
      coord: p.available ? representativeCoord(p.coords) : null,
      sigma: p.sigma ?? null,
      sensor: p.sensor ?? null,
      bundledWith: context ? `${lockedCoords.length} locked coordinate(s), ${context.length} chars` : 'nothing — no coordinates locked yet, so this reading is ISOLATED and cannot discriminate',
      unmeasured: p.available ? null : p.reason,
    });
  }
  const coords = placed.map((p) => p.coord).filter(Boolean);
  const sp = spread(coords);

  // THE DISPLACEMENT FIELD. Re-place every locked coordinate with each answer folded into context,
  // and read how the BODY moves — not how the answers sit apart. See the long note above.
  const B = body ?? await measureBody(lockedCoords, { placeText, representativeCoord });
  const { lockedRules, baseCells, baseDistinct, nullDistincts, floor, cellsFor } = B;
  for (const pa of placed) {
    pa.field = lockedRules.length
      ? displacementField(baseCells, await cellsFor(pa.rule))
      : { translation: null, reorganization: null, distinct: 0, n: 0, reason: 'no coordinates locked yet — the body cannot be displaced, so this question is UNMEASURED for reorganization' };
    // COLLAPSE = below the MEASURED zero-information floor, never below the raw base count.
    // `distinct < baseDistinct` was the strict form and it froze the loop: at 13 coordinates every
    // answer — including the one the operator had already locked — read as "collapse", because a
    // zero-information control drops 0–2 cells from bundling alone. See the measureBody() note.
    pa.collapses = pa.field.n > 0 && pa.field.distinct < floor;
  }
  const measurable = placed.filter((pa) => pa.field?.reorganization !== null);
  const reorganization = measurable.length
    ? +(measurable.reduce((a3, pa) => a3 + pa.field.reorganization, 0) / measurable.length).toFixed(3)
    : null;
  const collapsing = placed.filter((pa) => pa.collapses).map((pa) => pa.label);

  const before = await coneOf(lockedCoords);
  const widthBefore = before.width;

  // E[width after], answers assumed EQUIPROBABLE — we have no prior over the operator's answer and
  // inventing one would be inventing a belief about a person. Stated, not hidden.
  const afters = [];
  for (const p of placed) {
    if (!p.coord) continue;
    const c = await coneOf([...lockedCoords, { id: `HYP-${p.label}`, coord: p.coord, rule: p.rule }]);
    afters.push({ answer: p.label, coord: p.coord, widthAfter: c.width });
  }
  const expectedAfter = afters.length ? afters.reduce((a, b) => a + (b.widthAfter ?? 0), 0) / afters.length : null;
  const reduction = widthBefore !== null && expectedAfter !== null ? +(widthBefore - expectedAfter).toFixed(3) : null;

  // SCORING, CORRECTED after the first version failed its calibration a SECOND time.
  //
  // v1 placed answers in isolation (blind sensor) and ranked the rejected question first.
  // v2 fixed the sensor but scored `spread × (reduction + ε)`, and ε=0.25 let SPREAD drown REDUCTION —
  // so a question that WIDENS the cone by a lot still beat the only question that narrowed it. That
  // is not what was asked for. The operator's words are "the condition that NARROWS the cone the
  // most", so narrowing is not a tie-breaker, it is the objective.
  //
  // A question therefore lands in one of three classes and they do not compete on one number:
  //   FORMALITY  spread ≈ 0 — every answer lands in the same cell, the answer cannot change anything
  //   NARROWING  reduction > 0 — ranked by spread × reduction; THIS is the question to ask
  //   WIDENING   reduction ≤ 0 — a real question, but it opens the cone; a large steer, asked
  //              deliberately when the project SHOULD expand, never as "the next question"
  // Ranking sorts NARROWING above WIDENING above FORMALITY, never blending the classes into one
  // score — the same discipline momentum.mjs uses when it refuses to average testimony with authored.
  // v3 — SPREAD IS NO LONGER A TIEBREAK. That is what put the rejected question on top: every
  // candidate classed WIDENING with score 0, the sort fell through to spread, and the narrowest
  // question in the set won on the distance between its own two answers. REORGANIZATION replaces it.
  const NARROW_EPS = 1e-6;
  const cls = collapsing.length ? 'DEGENERATE'
    : sp.spread === 0 ? 'FORMALITY'
      : reduction !== null && reduction > NARROW_EPS ? 'NARROWING'
        : 'WIDENING';
  // Reorganization is the score in EVERY live class, so a widening project (which is the correct
  // reading early — you cannot narrow what has not formed) still gets a real ordering instead of
  // falling through to a distance that means nothing.
  const score = cls === 'DEGENERATE' || cls === 'FORMALITY' ? 0
    : cls === 'NARROWING' ? +((reorganization ?? 0) * (1 + reduction)).toFixed(4)
      : +(reorganization ?? 0).toFixed(4);
  const rank = cls === 'NARROWING' ? 3 : cls === 'WIDENING' ? 2 : cls === 'FORMALITY' ? 1 : 0;

  return {
    id: question.id, question: question.question,
    // CARRY THE RULE TEXT. The ranking dropped it, so the cockpit could only pre-fill the steer with
    // a coordinate LABEL — "B3,C1 (Tactics.Signal ⊕ Operations.Grid)" — which is meaningless as a
    // steer. The answer IS its rule; a coordinate is where the rule landed, not what it says.
    // The TRADEOFF rides along the same way — proposed with the answer (propose-questions.mjs),
    // shown beside it in the cockpit — but it is deliberately NOT part of the bundled text that
    // gets placed above: the sensor was calibrated over rule text, and folding decision-support
    // prose into the measurement would change every reading this file's notes cite.
    answers: placed.map((p) => ({ label: p.label, rule: p.rule, tradeoff: p.tradeoff ?? null, steer: p.steer ?? null, coord: p.coord, coordLabel: label(p.coord), sigma: p.sigma, sensor: p.sensor, unmeasured: p.unmeasured })),
    spread: sp.spread, spreadReason: sp.reason,
    reorganization, baseDistinct, nullFloor: floor, nullDistincts, collapsing,
    fields: placed.map((pa) => ({ label: pa.label, ...pa.field, collapses: pa.collapses })),
    widthBefore, expectedAfter: expectedAfter === null ? null : +expectedAfter.toFixed(3), reduction,
    score, cls, rank,
    formality: sp.spread === 0,
    verdict: cls === 'DEGENERATE'
      ? `DEGENERATE — the "${collapsing.join('/')}" answer(s) read the ${lockedRules.length} locked coordinates as only ${Math.min(...placed.filter((x) => x.collapses).map((x) => x.field.distinct))} distinct cell(s); the measured zero-information floor is ${floor} of ${baseDistinct} (a locked rule re-inserted as the answer reads ${nullDistincts.join('/')}). Text below that floor swamps the sensor instead of informing it — rewrite those answers in the locked rules' own vocabulary to make this question rankable`
      : cls === 'FORMALITY'
        ? 'FORMALITY — every answer lands in the same cell; the answer cannot change the shape of the project'
        : cls === 'WIDENING'
          ? `WIDENS the cone, but REORGANIZES the locked body by ${reorganization} — early projects widen, and this is the ordering that matters while they do`
          : `NARROWS — the answers land apart, the cone tightens, and the locked body reorganizes by ${reorganization}; this is the next question`,
  };
}

export async function rankQuestions(questions, lockedCoords, body = null) {
  const P = await import(resolve(HERE, 'physics.mjs'));
  const B = body ?? await measureBody(lockedCoords, P);
  const out = [];
  for (const q of questions) out.push(await scoreQuestion(q, lockedCoords, P, B));
  return out.sort((a, b) => b.rank - a.rank || b.score - a.score || b.spread - a.spread);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const { liveCoordinates } = await import(resolve(HERE, 'coordinates.mjs'));
  const locked = liveCoordinates(slug);

  // THE CALIBRATION SET — the two questions actually asked this session, plus one control.
  // Q-HALT was asked first and the operator rejected it as "a detailed question that should not have
  // given anyone any pause". If this metric is sound, Q-HALT must score LOWEST. That is the test.
  const CANDIDATES = JSON.parse(arg('--questions', 'null')) || [
    {
      id: 'Q-HALT',
      question: 'When a dispatched agent lands off-lane, does the tape auto-redispatch or halt?',
      answers: [
        { label: 'halt', rule: 'When a dispatched commit reads off-lane the tape HALTS and waits for the operator; a WHERE reading may never trigger an automatic action.' },
        { label: 'auto', rule: 'When a dispatched commit reads off-lane the tape AUTOMATICALLY redispatches the agent with the drift reading as feedback.' },
      ],
    },
    {
      id: 'Q-WHO',
      question: 'Is the cockpit a private instrument for this repo, or a product other people run on theirs?',
      answers: [
        { label: 'private', rule: 'The cockpit is a private local instrument for one operator and one repo; coordinates graduate into this repo CLAUDE.md and the tape never leaves the machine.' },
        { label: 'product', rule: 'The cockpit is a product other people run on their own repositories; coordinates graduate into a portable artifact a fork carries, and CLAUDE.md is one consumer among several.' },
      ],
    },
    {
      id: 'Q-UNIT',
      question: 'What is one turn — one steer, one locked coordinate, or one dispatched agent?',
      answers: [
        { label: 'steer', rule: 'One turn is one operator steer, which may lock zero or many coordinates and produces exactly one commit.' },
        { label: 'coordinate', rule: 'One turn is one locked coordinate: a single rule nailed to the lattice, one commit, one panel.' },
        { label: 'dispatch', rule: 'One turn is one dispatched agent completing its round trip, measured back against the coordinate that ordered it.' },
      ],
    },
  ];

  const ranked = await rankQuestions(CANDIDATES, locked);

  // ── PERSIST THE RANKING. THE PAGE MUST NEVER RUN THIS WALK. ──────────────────────────────────
  // Scoring three questions against nine locked coordinates is 63 real ballistic placements and
  // takes minutes. A page load cannot pay that, and a page that pays it by falling back to a cheap
  // approximation would be showing a DIFFERENT metric than the one that was calibrated — which is
  // how the last two measurement failures happened. So the expensive walk runs here, in the CLI or
  // a background fire, and appends its verdict to questions.ndjson. The cockpit reads the record
  // and renders it WITH its timestamp, so a stale ranking is visibly stale rather than silently so.
  try {
    const chosen = await chooseMeaningful(ranked, {
      context: `${locked.length} coordinate(s) locked. Most recent: ` +
        locked.slice(-4).map((c) => `${c.coord || '?'} — ${String(c.rule || '').slice(0, 110)}`).join(' · '),
    });
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const dir = resolve(SESSIONS_DIR, slug);
    mkdirSync(dir, { recursive: true });
    appendFileSync(resolve(dir, "questions.ndjson"), JSON.stringify({
      ts: new Date().toISOString(),
      lockedCount: locked.length,
      widthBefore: ranked[0]?.widthBefore ?? null,
      // THE CHIP GATES; THE MODEL CHOOSES AMONG SURVIVORS. This used to be
      // `ranked.find(admissible)` — the top candidate by displacement geometry, full stop. Geometry
      // answers "does this question move the locked body"; it was never designed to answer "would a
      // person recognise this as the thing they are stuck on", and nobody was asking that. So the
      // operator kept being handed a technically-optimal question he did not care about, and kept
      // asking for this. A disqualified candidate can never be resurrected here, so the LLM-free
      // half is untouched — only the ordering of already-admissible survivors changes.
      ask: chosen.ask || null,
      chosenBy: chosen.chosenBy,
      chooseWhy: chosen.why,
      chooseReason: chosen.reason,
      shortlist: chosen.shortlist,
      ranked,
    }) + "\n");
  } catch (e) {
    console.error("  ⚠ ranking computed but NOT persisted: " + e.message);
  }
  console.log(`\n  WHICH QUESTION NARROWS THE CONE MOST · ${slug}`);
  console.log(`  cone before: width ${ranked[0]?.widthBefore ?? 'UNMEASURED'} over ${locked.length} locked coordinate(s)\n`);
  for (const r of ranked) {
    console.log(`  ${r.cls.padEnd(11)} ${String(r.score).padStart(7)}  ${r.id.padEnd(8)} reorg ${String(r.reorganization).padStart(6)}  spread ${String(r.spread).padStart(4)}  reduction ${String(r.reduction).padStart(6)}`);
    console.log(`          ${r.question}`);
    console.log(`          ${r.verdict}`);
    for (const a of r.answers) console.log(`            · ${String(a.label).padEnd(11)} → ${a.coordLabel}${a.unmeasured ? `  [${a.unmeasured}]` : ''}`);
    for (const f of r.fields || []) {
      if (f.reorganization === null) { console.log(`            ~ ${String(f.label).padEnd(11)} ${f.reason}`); continue; }
      console.log(`            ~ ${String(f.label).padEnd(11)} body occupies ${f.distinct}/${r.baseDistinct} cells (null floor ${r.nullFloor})${f.collapses ? "  ⚠ COLLAPSE — below the zero-information floor, the answer text is swamping the reading" : ""}  · translation [${f.translation.join(",")}] discarded · reorganization ${f.reorganization}`);
    }
    console.log('');
  }
  const best = ranked[0];
  const anyNarrow = ranked.some((r) => r.cls === "NARROWING");
  if (!anyNarrow) {
    console.log(`  NO QUESTION NARROWS. With ${locked.length} locked coordinate(s) the cone has no stable centre yet,`);
    console.log(`  so every new coordinate increases mean distance. This is the WIDENING PHASE and it is the`);
    console.log(`  correct reading for a project this early — you cannot narrow what has not formed. Lock more`);
    console.log(`  coordinates before asking which question narrows most.\n`);
  }
  console.log(`  ASK THIS ONE: ${best.id} — ${best.question}\n`);
}
