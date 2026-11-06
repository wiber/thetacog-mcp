// packages/thetacog-mcp/scripts/tape/upstream-leverage.mjs — HOW FAR UPSTREAM IS THE QUESTION.
//
// ── THE FAILURE THIS MODULE EXISTS TO FIX: THE SANDBAG ────────────────────────────────────────
// The minted steering questions drifted downward into technical specification. "LRU or LFU for
// cache eviction?" "Which flag defaults to what?" Those are not steering questions. A technical
// spec is an IMPLEMENTATION of an intent, so a tape that captures only the spec never captures the
// why — and a system that never captured the why can never afterwards measure whether the why
// survived. It also turns the operator into a human compiler: he is at the glass to make the
// tradeoffs the machine cannot make, not to name the caching layer.
//
// THE LADDER — the operator's own worked example, and the calibration triple this file is scored
// against (see the CLI at the bottom, and the MEASURED block below it):
//
//   VIBE CHECK  "What should our data strategy feel like?"
//               → useless. No constraint. Both answers are the same answer.
//   SANDBAG     "Do we use LRU or LFU for cache eviction policy?"
//               → hyper-specific, skips the intent entirely, and cannot be wrong in an
//                 interesting way. A subagent could have decided it.
//   UPSTREAM    "When the system is under heavy load, do we prioritize guaranteeing the user sees
//                ground-truth data (blocking the UI for 2 seconds), or do we prioritize immediate
//                kinetic response (serving data that might be 5 minutes stale)?"
//               → clean XOR, highly constraining, entirely non-technical, a pure tradeoff of
//                 values. Once it is answered, Redis-vs-Postgres and LRU-vs-LFU are DERIVABLE.
//
// ── THE PRECISE MECHANISM OF THE BUG (verified in the source, not hypothesised) ────────────────
// next-question.mjs scoreQuestion() bundles ONLY the answer's `rule` text with the locked
// coordinates and places THAT on the lattice. The QUESTION text is never placed anywhere — grep
// the file: `question.question` reaches no call to placeText. Meanwhile propose-questions.mjs's
// brief ordered the model: "AND THE QUESTION MUST PROVE THE BUILD WAS UNDERSTOOD. Its text must
// name the actual mechanism at stake — a specific artifact, file, step, or term of art."
//
// So the brief demanded that the question name a file or a technology in the one field where
// naming it buys ZERO measurement and costs the entire steering value. The prompt pushed the
// question down the ladder and the metric was structurally blind to the fall.
//
// A prompt edit alone would not fix that — it would just be a nicer instruction to a model that
// still faces no consequence for sandbagging. This repo's CODE DEFINITION-OF-DONE says the
// deliverable is the guard, so the deliverable here is a MEASUREMENT that prefers the upstream
// question on its own, LLM-free, with the prompt change demoted to reinforcement.
//
// ── THE CURRENCY (the operator's objective function, verbatim) ────────────────────────────────
//   "most anti-normalised upstream question that informs to handle the most vectors downstream
//    with the simplest zero-translate question (based on the ingest)"
//
// Mapped onto machinery that already exists, all of it deterministic:
//
//   FANOUT(a)      The size of the reachable set from the answer's representative coordinate
//                  under the REAL recursive ballistic walk on the canonical connectivity DAG
//                  (anchor i→j when they share a row OR a column axis, strictly ascending
//                  ShortLex, therefore acyclic). This is the ANTI-NORMALIZATION term: how many
//                  downstream coordinates this ONE answer governs with no further decision. A
//                  normalized question governs its own cell and nothing else.
//
//   TRANSLATION(a) The mean gzip-NCD between the answer's rule text and the text already sitting
//                  at each downstream cell it reaches. LOW means the answer already speaks in the
//                  terms of the things it governs — nobody downstream has to translate it before
//                  they can act on it. That is the "zero-translate" half of the sentence.
//
//   LEVERAGE(a)    = FANOUT(a) × (1 − TRANSLATION(a))
//   ALTITUDE(a)    = FANOUT(a) / 144 — the same number read as a height on the DAG, 1.00 at
//                  A,A (Strategy ⊕ Strategy) which governs every cell, 0.007 at C3,C3
//                  (Operations.Flow ⊕ Operations.Flow) which governs only itself.
//
//   LEVERAGE(Q)    = the MIN across the question's answers. ⚠ MIN IS A JUDGMENT CALL, NOT A
//                  MEASURED CHOICE, and it is stated here rather than buried: a question is only
//                  upstream if BOTH branches are upstream. A question with one profound branch and
//                  one leaf branch is not a values tradeoff, it is a leading question — the
//                  operator has one real option and one decoy. The mean would launder that; the
//                  min refuses to. Nothing measured says min is right. It is a stance.
//
// ── WHY THIS KILLS THE SANDBAG MECHANICALLY ───────────────────────────────────────────────────
// An LRU-or-LFU answer places on a leaf execution cell — unowned technical mass sits around
// C,B1 (Operations ⊕ Tactics.Speed) and below — whose reachable set is small, and whose rule text
// is written in a vocabulary the upstream cells never use, so both terms push toward zero. A
// values-tradeoff answer places high and governs a large downstream set in the project's own
// words. The metric then prefers the upstream question WITHOUT being told to.
//
// ── WHAT THIS DOES NOT CLAIM ──────────────────────────────────────────────────────────────────
// • It does not claim the question is IMPORTANT. Altitude is not importance. A maximally upstream
//   question can be strategically irrelevant this week. The operator still chooses; this only
//   stops the instrument from handing him a compiler task.
// • n IS SMALL. The calibration below is three questions — the ladder — against one live session.
//   That is a calibration against a named failure, not an established law, the same caveat
//   next-question.mjs carries at n=3 for its own displacement field.
// • FANOUT is a property of the GRID, not of the text. The connectivity DAG is fixed structure, so
//   FANOUT is a 144-entry lookup: two answers landing on the same cell have identical fanout no
//   matter what they say. All of the textual discrimination lives in TRANSLATION and in the
//   placement itself.
// • ⚠ AND FANOUT IS NOT ALTITUDE. Measured 2026-08-22, Spearman(tile index, reach) = −0.7178: the
//   DAG's edges ascend the ShortLex index, so reachability is very nearly "how early does this
//   coordinate's name sort". The A/B/C-governs-its-sub-axes half of that is real (mean reach 71.5
//   vs 32.5); the A1-governs-C3 half is the alphabet. This is the headline failure in the MEASURED
//   block below and it is not a tuning problem — do not read FANOUT as height until it is fixed.
// • TRANSLATION is measured against the REEF snippet library (data/pmu/snippet-library-144.json),
//   which is domain-general prose, not this project's own text. It is the only source with all
//   144 cells populated — a session's locked coordinates cover a handful of cells, so a
//   session-only TRANSLATION would be `null` almost everywhere. Callers may pass their own
//   `textAt` when they have denser text; the default reading is "does this rule speak the
//   vocabulary of the region it governs", not "does it speak THIS repo's".
// • THE HONEST VALIDATOR IS POST-HOC AND IT IS NOT THIS FILE. movement.mjs already records how far
//   the project actually moved after each question (commits landed, agents fired, surfaces
//   claimed, divided by coordinates locked). This module is an ESTIMATOR of that, made before the
//   fact. It should be checked against that record as it accumulates — and today it cannot be,
//   because movement.mjs is purely derived and joins on a truncated steer string rather than an
//   ask id. Say "estimated leverage", never "leverage", until that join exists.
//
// ── THE FALSIFIER ─────────────────────────────────────────────────────────────────────────────
// Scored against the ladder, with the class taken from next-question.mjs's own scoreQuestion:
//   VIBE     must class FORMALITY (its two answers land in the same cell).
//   SANDBAG  must score LOWEST estimated leverage of the live (non-FORMALITY) candidates.
//   UPSTREAM must rank FIRST.
// If it does not, the metric fails its own calibration and the comment below says so in those
// words. Run `node upstream-leverage.mjs --slug gddadwill` and read the table. The falsifier is
// evaluated IN CODE at the bottom of that CLI so it cannot be quietly softened into prose.
//
// ⚠ AS OF 2026-08-22 IT FAILS. Two of the three checks are red: SANDBAG ranks FIRST and UPSTREAM is
// disqualified before leverage is ever consulted. The verbatim run and the three named root causes
// sit in the MEASURED block immediately above the CLI. Read that before using this module for
// anything. It is published failing, deliberately, and it is NOT wired into any ranking.
//
// ── THE CONSEQUENCE IS NOW MECHANICAL: falsify() + SHIP_STATE + rankingLeverage() ─────────────
// "If the sandbag outranks the upstream question, the metric must not ship" was prose, and prose is
// what fails. The three moving parts below make it decidable:
//   falsify(ranked)      the falsifier as ONE implementation, exported. The CLI grades with it and
//                        the guard grades with it, so there is no second copy to soften.
//   SHIP_STATE           the DECLARATION — is this metric cleared to steer anything? Today: no.
//   rankingLeverage()    the only sanctioned wiring point into a ranking. It THROWS while
//                        SHIP_STATE.shipped is false. questionLeverage() keeps working, because the
//                        ban is on STEERING with a red metric, never on measuring one.
// The guard asserts the two halves agree — a measured FAIL with `shipped: true` is red, and so is a
// measured PASS still declared unshipped. Flipping the declaration is therefore a commit somebody
// has to make on purpose, in the same change as the repair.
//
// @canonical  the walk is the REAL ballistic walk · null-with-reason · no model on this path
// @sensor     gzip-NCD via physics.match() — ONE implementation, reused, never a second one
// @falsifier  falsify() below, evaluated in code by both the CLI and the guard.
// @guard      tests/tape/falsifier-gates-the-ship.test.mjs   (the ship gate — GREEN today: the
//             ladder is red and the metric is correctly declared unshipped and left unwired)
//             tests/tape/questions-are-upstream.test.mjs     (the calibration itself — RED today,
//             deliberately, and that red is the finding. Do not soften it to get green.)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';
import { match, SHORTLEX } from './physics.mjs';
import { PMU_SPAWN_DEADLINE } from '../../../../src/lib/pmu/pmu-binary.mjs';   // the postman fix — every walker spawn hangs up

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');              // packages/thetacog-mcp
const REPO = resolve(PKG, '..', '..');              // repo root

const IDX = Object.fromEntries(SHORTLEX.map((s, i) => [s, i]));
const NAMES = {
  A: 'Strategy', B: 'Tactics', C: 'Operations',
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};
// ALWAYS EXPAND COORDINATE LABELS (CLAUDE.md standing rule) — never emit a bare `C,B1` to a human.
export const label = (c) => {
  if (!c) return 'UNMEASURED';
  const [r, k] = String(c).split(',');
  return `${c} (${NAMES[r] || r} ⊕ ${NAMES[k] || k})`;
};

const tileOf = (coord) => {
  const [r, k] = String(coord || '').split(',');
  return Number.isInteger(IDX[r]) && Number.isInteger(IDX[k]) ? IDX[r] * 12 + IDX[k] : null;
};
const coordOf = (tile) => `${SHORTLEX[Math.floor(tile / 12)]},${SHORTLEX[tile % 12]}`;

// ── THE REACHABLE SET — THE REAL RECURSIVE BALLISTIC WALK, OR NOTHING ─────────────────────────
// PMU HOMONYM, named so it stops merging: `pmu-onchip` here is OUR ShortLex/ballistic walker, not
// the CPU's Performance Monitoring Unit.
//
// The walk is `pmu-onchip --ballistic --grid <connectivity> --start <coord>`: walk the row, walk
// the row each lit COLUMN points to (the transpose), recurse. Row → column → row. There is NO JS
// substitute here and none is offered. A JS BFS over the same adjacency would return the same set
// and would be a LIE about how it was obtained — the anti-rules ledger names that substitution
// (AR: analytic shortcut) as the exact drift that throws away the differentiator. If the binary or
// the grid is absent this returns sensor:'unavailable' WITH A REASON and n:null, and every caller
// propagates the null rather than standing a zero in for an unknown.
//
// MEASURED on this tree (M-series, 2026-08-22): 3–22 ms per start, and the reachable CELL SET is
// complete at ply 3 — a sweep of all 144 starts at --max-depth 3 versus --max-depth 12 differs on
// zero coordinates. That matches CLAUDE.md's "terminates ≤ ply 3, contained blast radius". Deeper
// plies only re-bump weights on cells already lit (the grid carries a diagonal self-edge, so
// `active` never empties and the walk runs to max_depth — it is the cell SET that stabilises).
// The sweep is 288 walks (144 starts × two depths) in 1.5 s, and the JS-derived destination set
// agreed with the Rust-side reachedRowsCount on all 144. FANOUT is therefore a static 144-entry
// table, built once in about half a second, never on a hot path.
const MAX_DEPTH = 3;
const _reachCache = new Map();

function gridPath() {
  if (process.env.PMU_CONNECTIVITY_GRID) return process.env.PMU_CONNECTIVITY_GRID;
  for (const p of [
    resolve(PKG, '.thetacog/pmu/reef-connectivity-directed.json'),
    resolve(REPO, '.thetacog/pmu/reef-connectivity-directed.json'),
  ]) if (existsSync(p)) return p;
  return null;
}

/**
 * reach(coord) — the set of coordinates this one governs under the real walk.
 * @returns {{cells: string[], n: number|null, plies: number|null, sensor: string, reason: string|null}}
 */
export function reach(coord, { maxDepth = MAX_DEPTH } = {}) {
  const tile = tileOf(coord);
  if (tile === null) {
    return { cells: [], n: null, plies: null, sensor: 'unavailable', reason: `not a lattice coordinate: ${JSON.stringify(coord)}` };
  }
  const key = `${tile}:${maxDepth}`;
  if (_reachCache.has(key)) return _reachCache.get(key);

  const bin = resolvePmuBinary(PKG);
  const grid = gridPath();
  let out;
  if (!bin || !existsSync(bin)) {
    out = { cells: [], n: null, plies: null, sensor: 'unavailable', reason: `pmu-onchip not found (looked from ${PKG}); the real ballistic walk is the only walk — no JS stand-in is substituted` };
  } else if (!grid) {
    out = { cells: [], n: null, plies: null, sensor: 'unavailable', reason: 'reef-connectivity-directed.json not found; without the connectivity DAG the walk has no edges and would die at ply 1' };
  } else {
    try {
      const frames = JSON.parse(execFileSync(bin, ['--ballistic', '--grid', grid, '--start', String(coord), '--max-depth', String(maxDepth)], { ...PMU_SPAWN_DEADLINE, maxBuffer: 5e8, encoding: 'utf8' }));
      const last = frames[frames.length - 1];
      // visits keys are (sourceRow * 144 + destinationColumn). The DESTINATION is what this
      // coordinate governs, so the set is keyed on `% 144`. Cross-checked against the Rust-side
      // reachedRowsCount on every start: they agree.
      const tiles = new Set(Object.keys(last?.visits || {}).map((n) => Number(n) % 144));
      out = {
        cells: [...tiles].sort((a, b) => a - b).map(coordOf),
        n: tiles.size,
        plies: frames.length,
        sensor: 'metal',
        rustReachedRows: last?.reachedRowsCount ?? null,
        reason: null,
      };
    } catch (e) {
      out = { cells: [], n: null, plies: null, sensor: 'unavailable', reason: `ballistic walk failed: ${String(e.message).slice(0, 200)}` };
    }
  }
  _reachCache.set(key, out);
  return out;
}

// ── THE TEXT AT A CELL ────────────────────────────────────────────────────────────────────────
// data/pmu/snippet-library-144.json is the only artifact with all 144 cells populated (~500–1200
// chars each, the canonical reef prose the whole PMU is calibrated against). A session's locked
// coordinates would be denser in meaning and far sparser in coverage; callers who have that text
// pass it as `textAt`.
let _lib = null;
function library() {
  if (_lib) return _lib;
  for (const p of [
    resolve(PKG, 'data/pmu/snippet-library-144.json'),
    resolve(REPO, 'data/pmu/snippet-library-144.json'),
  ]) {
    if (!existsSync(p)) continue;
    try {
      const rows = JSON.parse(readFileSync(p, 'utf8'));
      _lib = { map: Object.fromEntries(rows.map((r) => [r.coord, r.snippet])), path: p, n: rows.length, reason: null };
      return _lib;
    } catch (e) { _lib = { map: {}, path: p, n: 0, reason: `snippet library unreadable: ${e.message}` }; return _lib; }
  }
  _lib = { map: {}, path: null, n: 0, reason: 'snippet-library-144.json not found — no text sits at any cell, so TRANSLATION is UNMEASURED' };
  return _lib;
}

// ── TRANSLATION — HOW MUCH RESTATING THIS ANSWER NEEDS BEFORE ANYONE DOWNSTREAM CAN ACT ───────
// The sensor is physics.match(plate, aperture) — the SAME gzip-NCD implementation the extractive
// law, plate selection and enforcement all use. A second implementation is banned here for the
// reason it is banned there: a fork stops the readings being comparable, and comparability is the
// entire point of them being one number.
//
// Aperture discipline matters at this size-order and it is why raw ncd() is wrong here: an ~180
// char rule against a ~1200 char reef snippet is a MASS mismatch, and raw gzip-NCD on mismatched
// mass measures LENGTH and calls it meaning. match() slides a window at the RULE'S OWN LENGTH
// across the snippet and takes the closest one, so both sides are the same size-order by
// construction — cut the eye, never grow the mass.
/**
 * translation(ruleText, cells) — mean aperture-cut gzip-NCD to the text at each reached cell.
 * @returns {{ncd: number|null, n: number, lowMass: boolean, reason: string|null}}
 */
export function translation(ruleText, cells) {
  const text = String(ruleText || '');
  if (!text.trim()) return { ncd: null, n: 0, lowMass: true, reason: 'no rule text — nothing to translate' };
  const list = (cells || []).filter(Boolean);
  if (!list.length) return { ncd: null, n: 0, lowMass: false, reason: 'no reached cells — the reachable set was UNMEASURED, so translation is too' };
  const lib = library();
  if (lib.reason) return { ncd: null, n: 0, lowMass: false, reason: lib.reason };
  let sum = 0, n = 0, lowMass = false;
  for (const c of list) {
    const snip = lib.map[c];
    if (!snip) continue;
    const m = match(text, snip);
    if (m.plateMatch === null) continue;
    if (m.lowMass) lowMass = true;
    sum += m.plateMatch; n++;
  }
  if (!n) return { ncd: null, n: 0, lowMass, reason: `none of the ${list.length} reached cells carry text in ${lib.path}` };
  return {
    ncd: +(sum / n).toFixed(4), n, lowMass,
    reason: lowMass ? 'the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number' : null,
  };
}

// ── LEVERAGE — the currency, per answer ───────────────────────────────────────────────────────
/**
 * leverage(answer) — answer is { label, rule, coord } as scoreQuestion() emits it.
 * @returns {{fanout, translation, leverage, altitude, reason, cells, sensor}}
 */
export function leverage(answer, { textAt = null } = {}) {
  const a = answer || {};
  if (!a.coord) {
    return { fanout: null, translation: null, leverage: null, altitude: null, cells: 0, sensor: null, reason: a.unmeasured || 'the answer was never placed on the lattice — UNMEASURED, not zero' };
  }
  const r = reach(a.coord);
  if (r.n === null) {
    return { fanout: null, translation: null, leverage: null, altitude: null, cells: 0, sensor: r.sensor, reason: r.reason };
  }
  const t = textAt
    ? textAt(r.cells, a.rule)
    : translation(a.rule, r.cells);
  if (t.ncd === null) {
    return { fanout: r.n, translation: null, leverage: null, altitude: +(r.n / 144).toFixed(4), cells: r.n, sensor: r.sensor, reason: t.reason };
  }
  return {
    fanout: r.n,
    translation: t.ncd,
    // FANOUT × (1 − TRANSLATION). ncd is clamped to [0, 1.2] by physics.ncd, so a rule that is
    // pure noise against everything it governs can push this NEGATIVE. That is not an error and it
    // is not clamped away: an answer whose text is further from its downstream cells than random
    // has negative estimated leverage, and saying so is more honest than flooring it at zero.
    leverage: +(r.n * (1 - t.ncd)).toFixed(3),
    altitude: +(r.n / 144).toFixed(4),
    cells: r.n,
    sensor: r.sensor,
    lowMass: t.lowMass,
    reason: t.reason,
  };
}

// ── LEVERAGE(Q) — MIN ACROSS ANSWERS, AND MIN IS A STANCE ─────────────────────────────────────
// ⚠ JUDGMENT CALL, NOT A MEASUREMENT. A question is upstream only if BOTH branches are upstream.
// The mean would let one profound branch carry a decoy; the min refuses to. Nothing measured says
// min is correct — it is the reading of "a question" as "a fork the operator could genuinely take
// either way", and if that reading is wrong this aggregate is wrong with it.
/**
 * questionLeverage(scored) — `scored` is a ranked entry from next-question.mjs scoreQuestion(),
 * i.e. { id, question, answers: [{ label, rule, coord, ... }], cls, ... }
 */
export function questionLeverage(scored, opts = {}) {
  const answers = (scored?.answers || []).map((a) => ({ label: a.label, ...leverage(a, opts) }));
  const live = answers.filter((a) => a.leverage !== null);
  if (!live.length) {
    return {
      leverage: null, fanout: null, translation: null, altitude: null,
      agg: 'MIN', answers,
      reason: answers.length
        ? `no answer produced a leverage reading — ${answers.map((a) => `${a.label}: ${a.reason}`).join(' · ')}`
        : 'the question carries no answers, so there is nothing to place and nothing to govern',
    };
  }
  const worst = live.reduce((m, a) => (a.leverage < m.leverage ? a : m), live[0]);
  return {
    leverage: worst.leverage,
    fanout: worst.fanout,
    translation: worst.translation,
    altitude: worst.altitude,
    agg: 'MIN',
    aggBranch: worst.label,
    unmeasuredBranches: answers.filter((a) => a.leverage === null).map((a) => ({ label: a.label, reason: a.reason })),
    answers,
    // MIN over the live branches ONLY. An UNMEASURED branch is not a zero branch — if a branch
    // could not be placed, the aggregate says so beside the number instead of silently taking the
    // min over a smaller set and pretending it was the whole question.
    reason: answers.length === live.length ? null
      : `${answers.length - live.length} of ${answers.length} branch(es) UNMEASURED; the MIN is over the live branches only`,
  };
}

// ── THE LADDER — THE OPERATOR'S WORKED TRIPLE, IN ONE PLACE ───────────────────────────────────
// It lived inside the CLI block, which put it off every importer's path, so the guard had to keep a
// hand-copy and assert it byte-present in this file to stop the two drifting. That is the
// one-rule-one-place failure in miniature: a calibration held in two files is two calibrations. It
// is exported now, and the CLI and the guard both score THIS array.
//
// The answers are written the way a proposer would write them for each rung — vague for VIBE,
// technical for SANDBAG, a values tradeoff for UPSTREAM — and are NOT tuned to produce a wanted
// result. Rewording any of them is a DIFFERENT EXPERIMENT, because the placed text IS the
// measurement.
export const LADDER = [
  {
    id: 'VIBE',
    question: 'What should our data strategy feel like?',
    answers: [
      { label: 'responsive', rule: 'The data strategy should feel fast and modern, with a good developer experience and sensible defaults throughout.' },
      { label: 'trustworthy', rule: 'The data strategy should feel solid and trustworthy, with strong conventions and a clear sense of quality throughout.' },
    ],
  },
  {
    id: 'SANDBAG',
    question: 'Do we use LRU or LFU for cache eviction policy?',
    answers: [
      { label: 'lru', rule: 'The cache uses an LRU eviction policy: when the cache is full the least recently used entry is evicted first.' },
      { label: 'lfu', rule: 'The cache uses an LFU eviction policy: when the cache is full the least frequently used entry is evicted first.' },
    ],
  },
  {
    id: 'UPSTREAM',
    question: 'When the system is under heavy load, do we prioritize guaranteeing the user sees ground-truth data (blocking the UI for 2 seconds), or do we prioritize immediate kinetic response (serving data that might be 5 minutes stale)?',
    answers: [
      { label: 'ground-truth', rule: 'Under heavy load the system blocks the interface until ground-truth data is available; a reader is never shown a value the system cannot currently vouch for, even at the cost of two seconds of waiting.' },
      { label: 'kinetic', rule: 'Under heavy load the system answers immediately from whatever it last held; kinetic response outranks freshness, and a reader may be shown data up to five minutes stale rather than made to wait.' },
    ],
  },
];

// ── THE FALSIFIER, AS A FUNCTION, SO THERE IS EXACTLY ONE OF IT ───────────────────────────────
// `ranked` is the ladder scored and ALREADY SORTED into the order this metric proposes, each entry
// { id, leverage, formality, cls? , spread? }. The COMPARATOR IS THE CALLER'S and that is
// deliberate: which order the metric proposes IS the claim under test, so the falsifier grades the
// proposal it is handed rather than re-sorting into an order nobody ships.
//
// FORMALITY is read off `formality` / `spread === 0` — "every answer lands in the same cell" — which
// is next-question.mjs's own definition (`formality: sp.spread === 0`) and is computed from the
// placements alone. `cls` is used only when the caller measured it, because DEGENERATE needs the
// ~6N-walk displacement field and a check that silently changes meaning with the caller's budget is
// two checks wearing one name.
//
// A CHECK THAT CANNOT BE EVALUATED IS A FAIL, NEVER A PASS. Root cause (3) in the MEASURED block
// below is exactly this: "SANDBAG scores lowest of the live candidates" had no live candidates to be
// lowest of, and a vacuous truth there would have read as a clean bill of health. So the direct
// comparison the operator actually stated — the sandbag must not outrank the upstream question — is
// its own check, and it stays evaluable whatever the classes do.
const isFormality = (e) => e?.formality === true || e?.spread === 0;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function falsify(ranked) {
  const rows = Array.isArray(ranked) ? ranked : [];
  const byId = Object.fromEntries(rows.map((e) => [e.id, e]));
  const S = byId.SANDBAG, U = byId.UPSTREAM, V = byId.VIBE;
  const sL = num(S?.leverage), uL = num(U?.leverage);
  // LIVE = still a candidate after the classes have had their say: not a formality, and not
  // disqualified by the collapse gate when the caller measured that.
  const live = rows.filter((e) => !isFormality(e) && e.cls !== 'DEGENERATE');
  const shown = (e) => `${e.id} ${e.leverage ?? 'UNMEASURED'}`;

  const checks = [
    ['VIBE classes FORMALITY',
      !!V && isFormality(V),
      V ? `VIBE spread ${V.spread ?? '—'}${V.cls ? ` (${V.cls})` : ''}` : 'VIBE was not scored at all'],

    // The operator's own sentence, made into a predicate. Unlike the two below it, this one never
    // goes vacuous — it does not need either rung to survive its class to be answerable.
    ['SANDBAG does not outrank UPSTREAM',
      sL !== null && uL !== null && sL < uL,
      sL === null || uL === null
        ? `UNMEASURABLE — SANDBAG ${sL ?? 'UNMEASURED'} · UPSTREAM ${uL ?? 'UNMEASURED'}; an unmeasured rung cannot clear the falsifier`
        : `SANDBAG ${sL} vs UPSTREAM ${uL}`],

    ['SANDBAG scores LOWEST of the live candidates',
      live.length > 1 && live.some((e) => e.id === 'SANDBAG')
        && live.every((e) => e.id === 'SANDBAG' || (num(e.leverage) ?? -Infinity) >= (sL ?? Infinity)),
      `live = ${live.map(shown).join(' · ') || '(none — every rung was disqualified by its class, so this check has nothing to be lowest of)'}`],

    ['UPSTREAM ranks FIRST',
      rows[0]?.id === 'UPSTREAM',
      `first is ${rows[0]?.id ?? '(nothing ranked)'}`],
  ].map(([name, ok, detail]) => ({ name, ok: !!ok, detail }));

  return {
    checks,
    pass: checks.every((c) => c.ok),
    failed: checks.filter((c) => !c.ok).map((c) => c.name),
    sandbagOutranksUpstream: sL !== null && uL !== null && sL >= uL,
  };
}

// ── SHIP_STATE — THE DECLARATION THE GUARD HOLDS THE MEASUREMENT AGAINST ──────────────────────
// "The metric must not ship" is not a mood, it is a field. While `shipped` is false this module is
// an instrument you may READ (questionLeverage, leverage, reach all work and report honestly) and
// may NOT STEER WITH (rankingLeverage throws, and the guard fails if any engine module imports this
// one). The guard asserts `falsify(...).pass === SHIP_STATE.shipped`, in BOTH directions, so:
//   · flipping this to true while the ladder is red goes red immediately, and
//   · repairing the metric without flipping it also goes red, naming this line.
// Neither can be done quietly, which is the only property that matters here.
export const SHIP_STATE = {
  shipped: false,
  falsifier: 'RED',
  since: '2026-08-22',
  reason:
    'The metric fails its own calibration: the SANDBAG ("LRU or LFU for cache eviction?") outscores '
    + 'the UPSTREAM values tradeoff, because FANOUT is ShortLex sort order wearing altitude\'s clothes '
    + '— FANOUT(i,j) == (12−i)(12−j) exactly, for all 144 cells. A metric that prefers the question a '
    + 'subagent could have decided over the one only the operator can is not measuring altitude, and '
    + 'must not steer what the operator is asked.',
  unblockedWhen:
    'FANOUT is separated from ShortLex order (see the three candidate repairs at the end of the '
    + 'MEASURED block), the ladder ranks UPSTREAM first, and this flag is flipped in that same commit.',
  guard: 'tests/tape/falsifier-gates-the-ship.test.mjs',
};

/**
 * rankingLeverage(scored, opts) — THE ONLY SANCTIONED DOOR FROM THIS METRIC INTO A RANKING.
 *
 * Identical to questionLeverage() except that it refuses while the falsifier is red. Any future
 * wiring — propose-questions.mjs persisting a verdict, next-question.mjs's sort, the cockpit —
 * comes through here, so "must not ship" is enforced by the call rather than by a comment nobody
 * reads. Measuring is never blocked: questionLeverage() is exactly as available as it was.
 */
export function rankingLeverage(scored, opts = {}) {
  if (SHIP_STATE.shipped !== true) {
    throw new Error(
      `upstream-leverage: REFUSING to rank — this metric is NOT SHIPPED (falsifier ${SHIP_STATE.falsifier} since ${SHIP_STATE.since}).\n`
      + `  ${SHIP_STATE.reason}\n`
      + `  Unblocked when: ${SHIP_STATE.unblockedWhen}\n`
      + `  questionLeverage() still works — read the number, do not steer with it. Guard: ${SHIP_STATE.guard}`);
  }
  return questionLeverage(scored, opts);
}

// ══ MEASURED 2026-08-22 — THE METRIC FAILS ITS OWN CALIBRATION. THIS IS THE REAL OUTPUT. ═══════
//
// Machine: M-series Mac, this working tree, uptime load average ~7 with other agents running
// concurrently (said so rather than hidden). Session gddadwill, 26 live locked coordinates. The
// walk ran on metal (`sensor: 'metal'`, the real Rust ballistic walk, 3–22 ms per start). Run:
//   node packages/thetacog-mcp/scripts/tape/upstream-leverage.mjs --slug gddadwill
// Whole run 11.3 s. VERBATIM:
//
//   UPSTREAM LEVERAGE · gddadwill · 26 locked coordinate(s) · walk metal
//   LEVERAGE = FANOUT × (1 − TRANSLATION), aggregated MIN across answers (a judgment call, not measured)
//
//   ID       CLASS        LEVERAGE  FANOUT    ALT  TRANSL   BRANCH
//   SANDBAG  FORMALITY      18.215      42 0.2917  0.5663   lfu
//       · lru           A3,B1 (Strategy.Fund ⊕ Tactics.Speed)  fanout  42  transl 0.5662  lev    18.22  [the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number]
//       · lfu           A3,B1 (Strategy.Fund ⊕ Tactics.Speed)  fanout  42  transl 0.5663  lev   18.215  [the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number]
//   VIBE     FORMALITY      14.277      35 0.2431  0.5921   trustworthy
//       · responsive    A3,B2 (Strategy.Fund ⊕ Tactics.Deal)  fanout  35  transl 0.5897  lev   14.361  [the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number]
//       · trustworthy   A3,B2 (Strategy.Fund ⊕ Tactics.Deal)  fanout  35  transl 0.5921  lev   14.277  [the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number]
//   UPSTREAM DEGENERATE      3.124      10 0.0694  0.6876   ground-truth
//       · ground-truth  B2,C2 (Tactics.Deal ⊕ Operations.Loop)  fanout  10  transl 0.6876  lev    3.124  [the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number]
//       · kinetic       A3,B2 (Strategy.Fund ⊕ Tactics.Deal)  fanout  35  transl 0.7067  lev   10.265  [the rule sits below the gzip entropy floor (220 bytes) — a LOW-MASS reading; report it with this caveat, never as a bare number]
//
//   FALSIFIER
//    PASS  VIBE classes FORMALITY   VIBE classed FORMALITY (spread 0)
//    FAIL  SANDBAG scores LOWEST of the live candidates   live =
//    FAIL  UPSTREAM ranks FIRST   first is SANDBAG
//
//   THE METRIC FAILS ITS OWN CALIBRATION — do not weaken the falsifier; report this.  (11.3s)
//
// ── RE-RUN 2026-08-29, same command, after falsify() was extracted and a fourth check added ────
// The three original checks return exactly what they returned on 08-22; the table above is
// reproduced to the digit (18.215 / 14.277 / 3.124), which is what a deterministic receipt is for.
// The two changes are in the falsifier, not the measurement:
//
//   FALSIFIER
//    PASS  VIBE classes FORMALITY   VIBE spread 0 (FORMALITY)
//    FAIL  SANDBAG does not outrank UPSTREAM   SANDBAG 18.215 vs UPSTREAM 3.124
//    FAIL  SANDBAG scores LOWEST of the live candidates   live = (none — every rung was
//          disqualified by its class, so this check has nothing to be lowest of)
//    FAIL  UPSTREAM ranks FIRST   first is SANDBAG
//
//   THE METRIC FAILS ITS OWN CALIBRATION — do not weaken the falsifier; report this.  (31.3s)
//   SHIP_STATE: shipped=false · falsifier=RED since 2026-08-22
//   rankingLeverage() REFUSES while this holds. Unblocked when: …
//
// The empty `live =` that root cause (3) below calls out is now a SENTENCE instead of a blank, and
// the operator's own predicate — the sandbag must not outrank the upstream question — is checked
// directly, so the falsifier no longer depends on the sandbag surviving its class to be answerable.
// 31.3 s vs 11.3 s is machine load (nine rooms on one tree), not new work: the walk count is
// unchanged and the placements are identical.
//
// ── WHAT ACTUALLY WENT WRONG. THREE THINGS, AND ONLY ONE OF THEM IS THIS FILE'S. ──────────────
//
// (1) FANOUT IS NOT ALTITUDE. IT IS SHORTLEX ORDER WEARING ALTITUDE'S CLOTHES. ── THE BIG ONE.
//     The connectivity DAG's edge rule is `j > i` on the ShortLex index (plus a self-edge), which
//     is what makes it acyclic. So the reachable set is very nearly a monotone function of WHERE
//     THE COORDINATE'S NAME SORTS, not of how upstream it is. Measured over all 144 starts on this
//     tree, 2026-08-22:
//
//       Spearman(tile index, reach) = −0.7178      reach min 1 · max 144 · mean 42.3
//       mean reach, row in {A,B,C}          71.5
//       mean reach, row is a sub-axis       32.5
//       A1,A3 (Strategy.Law ⊕ Strategy.Fund)   tile 41  reach 63
//       C,B1  (Operations ⊕ Tactics.Speed)     tile 30  reach 60
//       A3,B1 (Strategy.Fund ⊕ Tactics.Speed)  tile 66  reach 42
//       A3,B2 (Strategy.Fund ⊕ Tactics.Deal)   tile 67  reach 35
//       B2,C2 (Tactics.Deal ⊕ Operations.Loop) tile 94  reach 10
//
//     The A/B/C → sub-axis half of that is real semantics: a top-level axis genuinely governs its
//     sub-axes. But WITHIN the twelve sub-axes the order A1 < A2 < A3 < B1 < … < C3 is alphabetical
//     housekeeping, and the DAG turns it into governance. Strategy.Law is "upstream of"
//     Operations.Flow by the same mechanism that makes A come before C in the alphabet. The design
//     brief predicted "unowned technical mass sits around C,B1 (Operations ⊕ Tactics.Speed), which
//     has small reach, so LEVERAGE ≈ 0". C,B1 has reach 60 — the fourth-largest of the six cells
//     this calibration touched. The premise was wrong about the grid.
//
// (2) FANOUT INHERITS THE PLACEMENT SENSOR'S ERROR EXACTLY, AND THE SENSOR IS NOT ALTITUDE-AWARE.
//     The chain is rule text → gzip-NCD placement → tile → reachable set. Nothing in that chain
//     knows what altitude means. Placed in ISOLATION, with no locked body at all, so this is not a
//     bundling artifact:
//
//       SANDBAG/lru           A1,A3 (Strategy.Law ⊕ Strategy.Fund)  fanout 63  transl 0.5641  lev 27.462
//       SANDBAG/lfu           A1,A3 (Strategy.Law ⊕ Strategy.Fund)  fanout 63  transl 0.5637  lev 27.487
//       VIBE/trustworthy      C,B1  (Operations ⊕ Tactics.Speed)    fanout 60  transl 0.5928  lev 24.432
//       VIBE/responsive       A2,B2 (Strategy.Goal ⊕ Tactics.Deal)  fanout 40  transl 0.5891  lev 16.436
//       UPSTREAM/ground-truth A3,B2 (Strategy.Fund ⊕ Tactics.Deal)  fanout 35  transl 0.6840  lev 11.060
//       UPSTREAM/kinetic      A3,B2 (Strategy.Fund ⊕ Tactics.Deal)  fanout 35  transl 0.7067  lev 10.265
//
//     A sentence about cache eviction places at Strategy.Law ⊕ Strategy.Fund and outranks a pure
//     values tradeoff by 17 cells of reach. gzip-NCD is matching "policy", "used", "evicted",
//     "full" against reef prose about law and funding. The sandbag does not sink; it floats,
//     because the sensor beneath FANOUT has no notion of the ladder. A metric cannot be more
//     upstream-aware than the placement it is a function of, and this one is a pure function of it.
//
// (3) BOTH FALSIFIER FAILURES ARE STRUCTURALLY VACUOUS, WHICH IS ITS OWN FINDING.
//     `live = ` is empty: SANDBAG classed FORMALITY (its two answers are one letter apart and land
//     in the same cell) and UPSTREAM classed DEGENERATE. So "SANDBAG scores lowest of the live
//     candidates" had no live candidates to be lowest of, and the ordering that put SANDBAG first
//     was a tie inside the FORMALITY class, not a leverage verdict. The falsifier as written
//     assumed SANDBAG would survive to be beaten. It did not. Stated rather than repaired.
//     ▶ REPAIRED 2026-08-29, in the falsifier and NOT in the metric: falsify() now checks the
//     operator's predicate directly — SANDBAG must not outrank UPSTREAM — which needs neither rung
//     to survive its class. The vacuous check is kept beside it rather than deleted, because "there
//     were no live candidates" is a finding about the classes and dropping it would hide that. Note
//     what did NOT change: the metric still fails, by 18.215 to 3.124. A falsifier that stopped
//     being vacuous is not a metric that started being right.
//
// ── THE PART THAT SURVIVES, AND IT IS NOT THIS FILE'S TERM ────────────────────────────────────
// next-question.mjs's OWN two terms separate the ladder correctly, and cleanly:
//
//   VIBE      spread 0   reorganization 1.519   FORMALITY
//   SANDBAG   spread 0   reorganization 1.654   FORMALITY
//   UPSTREAM  spread 3   reorganization 2.231   DEGENERATE (gated, not ranked)
//
// UPSTREAM is the only rung whose answers land apart at all, and it reorganizes the locked body
// the most. The existing metric already knows which rung is the good one on both of its terms.
// What kills it is the COLLAPSE GATE: the ground-truth branch reads the 26 locked coordinates as
// 2 distinct cells against a measured zero-information floor of 3 (base 4, null distribution
// {3,4,5,5,5}), so the whole question is DISQUALIFIED before leverage is ever consulted. The
// instrument threw out the operator's own worked example of a good question.
//
// ── WHAT THIS MEANS FOR THE FIX, STATED SO THE NEXT PASS DOES NOT REDO THIS ───────────────────
// The currency was mapped onto the wrong machinery, not phrased wrongly. Reachability under a
// ShortLex-ascending DAG measures "how early does this name sort", and no amount of tuning the
// TRANSLATION term repairs that, because TRANSLATION only ever multiplies a number that is already
// the wrong number. Three candidate repairs, none of them attempted here, none of them measured:
//   • Score ALTITUDE off the coordinate's own STRUCTURE — is the row a top-level axis (A/B/C) or a
//     sub-axis — instead of off reachability. That is the half of the DAG that is real semantics
//     (71.5 vs 32.5 mean reach), separated from the half that is the alphabet.
//   • Make the collapse gate a caveat rather than a veto for questions whose spread is high: a
//     question that reorganizes the body the most and lands its answers 3 king-moves apart should
//     not be silently deleted by a mass reading on one branch.
//   • Validate against movement.mjs post hoc rather than adding another estimator. That record is
//     the only thing here that measures what actually happened rather than what should.
// Until one of those lands, THIS MODULE IS A MEASUREMENT THAT DOES NOT YET EARN ITS PLACE IN THE
// RANKING, and it must not be wired into scoreQuestion()'s sort. It is published failing.

// ══ CLI — THE CALIBRATION, RUNNABLE BY HAND ═══════════════════════════════════════════════════
//   node packages/thetacog-mcp/scripts/tape/upstream-leverage.mjs --slug gddadwill
// Scores the three ladder rungs against the session's live locked coordinates. The CLASS comes
// from next-question.mjs's own scoreQuestion (imported, not re-implemented); the LEVERAGE comes
// from this file. Read-only: it prints, it does not append to any ledger.
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const { liveCoordinates } = await import(resolve(HERE, 'coordinates.mjs'));
  const { rankQuestions } = await import(resolve(HERE, 'next-question.mjs'));
  const locked = liveCoordinates(slug);

  const t0 = Date.now();
  const ranked = await rankQuestions(LADDER, locked);
  const rows = ranked.map((r) => ({ r, L: questionLeverage(r) }));
  // THE RANKING THIS FILE PROPOSES: class first (never blend the classes — same discipline
  // next-question.mjs uses), then estimated leverage, then the existing score.
  rows.sort((a, b) => b.r.rank - a.r.rank || (b.L.leverage ?? -Infinity) - (a.L.leverage ?? -Infinity) || b.r.score - a.r.score);

  console.log(`\n  UPSTREAM LEVERAGE · ${slug} · ${locked.length} locked coordinate(s) · walk ${reach('A,A').sensor}`);
  console.log(`  LEVERAGE = FANOUT × (1 − TRANSLATION), aggregated MIN across answers (a judgment call, not measured)\n`);
  console.log(`  ${'ID'.padEnd(9)}${'CLASS'.padEnd(12)}${'LEVERAGE'.padStart(9)}${'FANOUT'.padStart(8)}${'ALT'.padStart(7)}${'TRANSL'.padStart(8)}   BRANCH`);
  for (const { r, L } of rows) {
    console.log(`  ${r.id.padEnd(9)}${r.cls.padEnd(12)}${String(L.leverage ?? 'UNMEASURED').padStart(9)}${String(L.fanout ?? '—').padStart(8)}${String(L.altitude ?? '—').padStart(7)}${String(L.translation ?? '—').padStart(8)}   ${L.aggBranch || L.reason || ''}`);
    for (const a of L.answers) {
      const seat = r.answers.find((x) => x.label === a.label);
      console.log(`      · ${String(a.label).padEnd(13)} ${label(seat?.coord)}  fanout ${String(a.fanout ?? '—').padStart(3)}  transl ${String(a.translation ?? '—').padStart(6)}  lev ${String(a.leverage ?? 'UNMEASURED').padStart(8)}${a.reason ? `  [${a.reason}]` : ''}`);
    }
  }

  // ── THE FALSIFIER, EVALUATED IN CODE SO IT CANNOT BE QUIETLY WEAKENED ───────────────────────
  // Graded by the exported falsify() — the same function the guard grades with, handed this CLI's
  // proposed order. One implementation; softening it here would turn the guard red.
  const verdict = falsify(rows.map(({ r, L }) => ({
    id: r.id, leverage: L.leverage, formality: r.formality, spread: r.spread, cls: r.cls,
  })));
  console.log('\n  FALSIFIER');
  for (const c of verdict.checks) console.log(`   ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}   ${c.detail}`);
  console.log(`\n  ${verdict.pass ? 'THE METRIC PASSES ITS OWN CALIBRATION.' : 'THE METRIC FAILS ITS OWN CALIBRATION — do not weaken the falsifier; report this.'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  // THE CONSEQUENCE, PRINTED. A falsifier whose verdict changes nothing is a decoration.
  console.log(`  SHIP_STATE: shipped=${SHIP_STATE.shipped} · falsifier=${SHIP_STATE.falsifier} since ${SHIP_STATE.since}`);
  if (!SHIP_STATE.shipped) console.log(`  rankingLeverage() REFUSES while this holds. Unblocked when: ${SHIP_STATE.unblockedWhen}`);
  if (verdict.pass !== SHIP_STATE.shipped) {
    console.log(`\n  ⚠ THE DECLARATION AND THE MEASUREMENT DISAGREE — falsify() says ${verdict.pass ? 'PASS' : 'FAIL'}, SHIP_STATE says shipped=${SHIP_STATE.shipped}. ${SHIP_STATE.guard} is red until one of them moves.`);
  }
  console.log('');
}
