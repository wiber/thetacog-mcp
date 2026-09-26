// C309a — THE BUYER'S OPERATIONAL VECTOR, IN ONE PLACE (operator 2026-09-25: "supercede this in the code").
// A seismograph, not a blowout preventer: it measures where the execution landed against the spec and never
// pretends to judge whether the work was good. Every surface that shows a buyer any of this byte-matches this
// module (ONE RULE LIVES IN ONE PLACE) — the extension README, buyer-monologue.mjs, anything that follows.
//
// The grades are the operator's reading after the conversation, dated, not a measurement this module makes.
// NET_GRADE is DECLARED: the twelve grades below average 72 (MEAN_OF_TWELVE), and the Confidence metric itself
// forbids folding them into one blended number, so nothing re-derives 67 from them or 72 into a headline.

export const RPM_DATE = '2026-09-25';
export const NET_GRADE = Object.freeze({ value: 67, source: 'declared by the operator, 2026-09-25 — not derived from the twelve grades' });

// I. THE INPUT — the six needs of the shipper, canonical order.
export const SIX_NEEDS = Object.freeze([
  { need: 'Connection', title: 'Grip on the Map', grade: 74,
    means: 'You get a verifiable map showing where the commit landed against your frozen spec.',
    reality: 'It does not cure the oracle problem. You (the human) stay the oracle. The tool places the commit; it does not certify that the spec itself was safe or "good."' },
  { need: 'Contribution', title: 'The Tape and the Stamp', grade: 81,
    means: 'The free tier gives you a local tape you can run yourself. The paid tier gives you a cryptographic stamp that someone else can read.',
    reality: 'The value dies the moment you confuse the stamp for the measurement.' },
  { need: 'Growth', title: 'The Speed Vector', grade: 62,
    means: 'You gain execution speed. By cold-booting your next agent from a specific Merkle row rather than making it read the entire chat river, you shrink the context window.',
    reality: 'Market dominance is unproven (0 marketplace installs). You are adopting this for the context-window efficiency and the local map, not because an underwriter is currently begging for it.' },
  { need: 'Uncertainty', title: 'Honest Failure States', grade: 91,
    means: 'You are buying a Richter scale, not a concrete bunker.',
    reality: "The system protects you by failing honestly. It will return UNMEASURED, UNDECLARED, or REFUSED. It names Rice's theorem directly. The uncertainty is isolated and labeled, which is exactly why the tool works." },
  { need: 'Certainty', title: 'The Byte Match', grade: 71,
    means: 'If the binary is present, the same bytes in yield the same cell and variance (σ) out.',
    reality: 'Certainty is strictly limited to the hash. It will not halt a bad agent. It paints the reality; it does not steer the car.' },
  { need: 'Significance', title: 'Holding the Bag', grade: 58,
    means: 'This is only significant to you if your name is on the deliverable when the agent is wrong, and you cannot disclaim the liability.',
    reality: 'Foundation models shifted the liability downstream to you. You are buying the check, not the bag.' },
].map(Object.freeze));
// Certainty's reality once read "it will not parse whether the HEAD commit was the work you meant or just a
// chore(commit-page) update". C309b made the walk and the sign door take the last AUTHORED commit, so that
// sentence became false the day this module landed; the limit that is still true (the hash, not the halt) stays.

// II. THE RESULT — the one-bit payload, and how you know you have internal grip.
export const PAYLOAD = 'The same match that maps your spec-to-landing allows your next agent to read a specific cell instead of drowning in the river. You remain the oracle. The paid stamp is optional.';
export const GRIP_TEST = Object.freeze({
  sentence: 'You know you have internal grip when your deployment conversations no longer contain the phrases "safe AI," "alignment," or "no one insures this."',
  phrases: Object.freeze(['safe AI', 'alignment', 'no one insures this']),
});

// III. THE EXECUTION METRICS — split, never blended.
export const METRICS = Object.freeze([
  { metric: 'Predictive Power', grade: 68, reading: 'We can predict that aiSure sells a subjective KPI, while Steer sells a mechanical placement. The difference is real, but the conversion to insurance is currently a pitch, not a book of business.' },
  { metric: 'Impact', grade: 55, reading: "The code and the walk path exist locally. Total impact is measured entirely by receipts placed in other people's repositories, which is currently unproven." },
  { metric: 'Confidence', grade: 77, reading: 'High confidence on the mechanism. Medium on the token percentages. Low on immediate insurance conversion. We split these explicitly so we do not lie with a single blended number.' },
  { metric: 'Anti-Regression', grade: 84, reading: 'The structural floor holds: "where" does not equal "good," there is no statistical model in the receipt path, and the local measure is free. We actively correct copy that slips into empty promises (e.g., claiming "insurable today" when no policy exists).' },
  { metric: 'Anti-Stagnation', grade: 72, reading: 'The VS Code extension is alive and shipping (0.3.19–0.3.33 in days). The code moves.' },
  { metric: 'Sufficiency', grade: 70, reading: 'The free tool is entirely sufficient to install and walk one commit today. It is strictly insufficient to justify buying the $20 ledger unless a named outsider has specifically asked you for a recomputable tape.' },
].map(Object.freeze));

export const MEAN_OF_TWELVE = Math.round([...SIX_NEEDS, ...METRICS].reduce((s, r) => s + r.grade, 0) / 12);

// IV. THE MARKET SEAT — the promise kept, the promise refused.
export const MARKET_SEAT = 'You sit in the brutal, thin strip of reality between agents that ship and people who cannot disclaim liability. Competitors sell speed wrapped in a story. Audit tools sell paper chains.';
export const WHAT_STEER_SELLS = 'Steer sells a placement of a commit against a frozen spec, and a cockpit that boots the next worker from that spec.';
export const PROMISE_KEPT = 'I will show exactly where this commit sat relative to the spec you declared, without ever asking a statistical model to grade it.';
export const PROMISE_REFUSED = 'This does not make the work insurable, good, or cheap. Cheap is a byproduct. Good is your job as the oracle. Insurable is a decision made by a later buyer.';
export const STAMP_IS_OPTIONAL = 'The paid stamp is optional: buy it only when a named person outside your company will recompute it.';

// V. MASSIVE ACTION — the twelve-state buyer's monologue. `answer` says who can answer it:
// 'repo' = decidable off the repository (buyer-monologue.mjs reads it), 'yours' = only the buyer holds it,
// 'branch' = the fork the answers above select, 'stop' = always printed.
export const MONOLOGUE = Object.freeze([
  { n: 1, answer: 'yours', q: 'Is my name on the deliverable when the autonomous agent is wrong?' },
  { n: 2, answer: 'yours', q: "Am I currently using the model's own self-generated summary as my audit?" },
  { n: 3, answer: 'repo', q: 'Do I have a hard spec frozen before the run, or am I just relying on a chat history?' },
  { n: 4, answer: 'yours', q: 'Can I place this specific commit on that spec without asking a model if it was "good"?' },
  { n: 5, answer: 'repo', q: 'Did the walk command use the actual commit I meant, or just the hook that published the page?' },
  { n: 6, answer: 'repo', q: 'Did the telemetry return PLACED, UNMEASURED, UNDECLARED, or REFUSED?' },
  { n: 7, answer: 'yours', q: 'Is my execution window now smaller because my next worker boots from the isolated row, not the entire river?' },
  { n: 8, answer: 'yours', q: 'Am I currently just shipping code, or am I being asked to sign for the liability?' },
  { n: 9, answer: 'branch', q: 'If I am just shipping: I will install Steer for free, point it at one repo, and walk one authored commit today to find the floor.' },
  { n: 10, answer: 'branch', q: 'If I am signing: I will only pay for the ledger stamp if a named person outside my company will actually recompute it.' },
  { n: 11, answer: 'branch', q: 'If I am not ready for the ledger: What specific external demand would have to be true for me to say yes?' },
  { n: 12, answer: 'stop', q: "Stop. I will not read the book, I will not wait for Munich Re, and I will not pretend Rice's theorem doesn't apply to my logs. I will measure the commit." },
].map(Object.freeze));
export const MONOLOGUE_GATE = 'If the buyer cannot pass step 10, they do not pay.';

// C309c — THE FOUR HONEST STATES, ONE FUNCTION. Reads a walk receipt (data/vna/cockpit.json, parsed) and returns
// exactly one word with its reason. Order matters: no receipt is not a refusal, and a walk over an undeclared
// spec is not a placement even when the aperture admitted it — the intent was the commit's own message.
// C310a — BRAND → GOAL: THE WEAKEST NEED GOES FIRST (operator 2026-09-25: "use the brand to ratchet the goal and vice
// versa"). NEED_ROWS is the one map from a need to the spec rows that move it — C305<x> is always that need's own
// counter row (C310b reads it back off the spec for its guard), the C308 rows are its supporting brand rows. Never
// retype a grade here: orderByNeed reads it off SIX_NEEDS, so a re-grade of SIX_NEEDS above re-orders every goal
// the next time it runs, with nothing here to fall out of step.
export const NEED_ROWS = Object.freeze({
  Significance: Object.freeze(['C305f', 'C308j', 'C308f']),
  Growth: Object.freeze(['C305c', 'C308i', 'C308e', 'C308h']),
  Certainty: Object.freeze(['C305e']),
  Connection: Object.freeze(['C305a', 'C308c', 'C308a']),
  Contribution: Object.freeze(['C305b', 'C308g', 'C308b']),
  Uncertainty: Object.freeze(['C305d']),
});
const ROW_TO_NEED = new Map(Object.entries(NEED_ROWS).flatMap(([need, rows]) => rows.map((id) => [id, need])));
const GRADE_OF_NEED = new Map(SIX_NEEDS.map((r) => [r.need, r.grade]));

// orderByNeed(units): units is an array of objects each carrying an `id`. Returns a NEW array, units on the
// lowest-graded need first (ties broken by the unit's original position — a stable sort), each gaining
// `need: "<Name> <grade>"`; a unit on no need keeps its original relative order, placed after every need-unit.
export function orderByNeed(units) {
  const arr = Array.isArray(units) ? units : [];
  const withNeed = []; const withoutNeed = [];
  arr.forEach((u, i) => {
    const need = u && u.id != null ? ROW_TO_NEED.get(u.id) : null;
    if (need) withNeed.push({ u, i, need, grade: GRADE_OF_NEED.get(need) });
    else withoutNeed.push(u);
  });
  withNeed.sort((a, b) => (a.grade - b.grade) || (a.i - b.i));
  return [...withNeed.map(({ u, need, grade }) => ({ ...u, need: `${need} ${grade}` })), ...withoutNeed];
}

export const WALK_STATES = Object.freeze(['PLACED', 'UNMEASURED', 'UNDECLARED', 'REFUSED']);
export function walkState(receipt) {
  if (!receipt || typeof receipt !== 'object') return { state: 'UNMEASURED', why: 'no walk receipt — run the walk first' };
  if (receipt.preview) return { state: 'UNMEASURED', why: 'the receipt is a working-tree preview, not a commit' };
  if (receipt.intentFallback) return { state: 'UNDECLARED', why: String(receipt.intentFallback) };
  const ap = receipt.aperture;
  if (!ap) return { state: 'UNMEASURED', why: 'the receipt carries no aperture — the walk did not reach the chip' };
  if (ap.admissible === false) return { state: 'REFUSED', why: ap.reason ? String(ap.reason) : 'the aperture refused: the two sides were not admissible at the gzip floor' };
  if (!receipt.delta) return { state: 'UNMEASURED', why: 'the aperture admitted the walk but no Δ was painted' };
  return { state: 'PLACED', why: `commit ${receipt.commit || '?'} placed against the declared spec — where it landed, not whether it was good` };
}
