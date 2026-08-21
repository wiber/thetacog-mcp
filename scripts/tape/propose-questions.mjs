// packages/thetacog-mcp/scripts/tape/propose-questions.mjs — WHERE THE CANDIDATES COME FROM.
//
// Operator: "output the constraining questions here in the chat too so we can see if they improve."
//
// They could not improve. next-question.mjs ranked a HARDCODED list of three questions written by
// hand in an earlier session, one of which had already been rejected out loud. A ranker over a
// frozen set is not a question generator; ranking a bad set optimally still hands you a bad
// question. Fixing the metric (spread was deciding it, see 6619d90a4) made the ordering honest and
// left the set stale.
//
// So the candidates are now GENERATED from the current mass — the locked coordinates plus the most
// recent turns — and then ranked by the same LLM-free displacement-field metric. Sonnet proposes,
// the chip disposes, exactly as in sharpen-rules.mjs. Proposals fan out with Promise.all; never a
// sequential await-loop over a model call.
//
// WHAT MAKES A GOOD CANDIDATE, given to the model as the brief, because it is measurable:
// a question whose answers are phrased in the PROJECT'S OWN vocabulary reorganizes the locked body
// (each rule pulled its own way); one phrased in a corner vocabulary reads the same against
// everything and collapses the body onto a single cell, which the metric disqualifies outright. That
// was measured, not assumed — and it is why the model is told to write answers as full rules in the
// project's terms rather than as short labels.
//
// THREE THINGS THE METRIC CANNOT CHECK, so the brief must (operator, 2026-08-21: "the question
// proves that the build was understood, is closing the bisected space... the answer needs to
// explain the tradeoffs always"):
//   · 21-QUESTIONS. The locked rules are the answers already given; the brief makes the model
//     condition on them — never ask what they already settle, halve what remains. The ranker can
//     tell a formality from a cut, but only AFTER paying five placements per candidate; a proposer
//     that reasons about the game state stops wasting those runs on already-answered turns.
//   · PROOF OF READING. A question that could be asked of any project is a failure even when it
//     bisects; the brief demands the actual mechanism at stake, by name. This is the same force as
//     constraint 2, stated at the question level instead of the answer level.
//   · THE TRADEOFF. Each answer carries a "tradeoff" field — what picking it costs — because the
//     operator chooses BETWEEN costs, and a rule with no stated cost reads as free. The field is
//     DATA: normalized below, carried through next-question.mjs's answer map, rendered in the
//     cockpit beside the answer. It is never folded into the placed text — the sensor was
//     calibrated over rule text alone.
//
//   node packages/thetacog-mcp/scripts/tape/propose-questions.mjs --slug gddadwill [--n 5] [--keep]
//
// --keep also appends the ranking to questions.ndjson, which is what /api/question serves.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sonnetJson } from './sonnet.mjs';
import { chooseMeaningful } from './choose-meaningful.mjs';

// One stamp per process, so every candidate in a run shares it and no two runs collide.
// Compact and readable in a ledger: 0821T1456 rather than an opaque hash.
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/^\d{4}/, "").slice(0, 9);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const ANGLES = [
  'the boundary of the thing — what is inside this project and what is explicitly not',
  'the unit of work — what counts as one of the things this system produces',
  'who or what is the authority when two parts disagree',
  'what happens at the failure edge that has not been decided yet',
  'which of two already-locked rules would have to give way if they ever conflicted',
];

// Every proposal resolves to { ok:true, q } or { ok:false, reason } — NEVER a silent null. The
// 2026-08-20 barren runs were undiagnosable precisely because failures went to stderr of a detached
// background process and the record carried no trace of them; the ledger must hold the reasons.
function proposeOne(context, angle, i) {
  const prompt = [
    'Here is the current specification of a project, as a set of locked rules, plus recent working notes.',
    '',
    context,
    '',
    `Propose exactly ONE question about this project that is still genuinely undecided, approached from this angle: ${angle}`,
    '',
    'THIS IS A GAME OF 21 QUESTIONS AND THE LOCKED RULES ARE THE ANSWERS ALREADY GIVEN. You are not',
    'asking a fresh question into a vacuum; you are asking the NEXT question, conditioned on every',
    'answer above. Two obligations follow:',
    '',
    '  · NEVER ASK WHAT YOU CAN ALREADY INFER. A good 21-questions player never spends a turn on',
    '    something the previous answers jointly settle or make obvious. Before writing, work out what',
    '    the locked rules above already imply, and ask PAST it. A question the rules already answer',
    '    will read as a formality because it is one.',
    '  · HALVE WHAT REMAINS. Name to yourself the largest region of design space still genuinely open',
    '    GIVEN the rules above, and write the question that cuts that remaining region in two. A',
    '    question you could have asked before reading the rules has ignored the game state and will',
    '    lose to one conditioned on it.',
    '',
    'AND THE QUESTION MUST PROVE THE BUILD WAS UNDERSTOOD. Its text must name the actual mechanism at',
    'stake — a specific artifact, file, step, or term of art that the rules or notes above use — so a',
    'reader thinks "whoever wrote this has read the code". A question that could be asked of any',
    'software project is a failure here no matter how cleanly it bisects; it also fails constraint 2',
    'below mechanically, because vocabulary foreign to the locked rules reads the same against every',
    'one of them.',
    '',
    'THE BAR, BEFORE ANY OF THE MEASURED CONSTRAINTS. A winning question BISECTS A POSSIBILITY SPACE',
    'with a single stroke. Not "raises a topic", not "surfaces a tension" — CUTS, so that after the',
    'answer an entire branch of the architecture is gone and cannot come back without reopening this',
    'decision. Everything below is how that gets measured; this is the thing being measured.',
    '',
    'Four tests, and a candidate that fails ANY of them is not a question, it is a prompt for prose:',
    '',
    '  · MUTUALLY EXCLUSIVE. Both answers cannot hold. If a reasonable person could adopt both and',
    '    feel no contradiction, you have written two features, not two answers.',
    '  · JOINTLY EXHAUSTIVE OVER THE LIVE SPACE. If you can name a third position that is neither of',
    '    your two, you have not bisected — you have carved a slice off the edge and left the middle',
    '    undecided. Name the third answer to yourself first; if it exists, rewrite the pair.',
    '  · BOTH BRANCHES DEFENSIBLE. If one answer is obviously correct, this is not a decision, it is',
    '    documentation of something already settled, and it will read as a FORMALITY because it IS',
    '    one. The losing branch must be something a competent person would argue for.',
    '  · THE LOSER IS GENUINELY LOST. After the answer, work that was permitted must become',
    '    forbidden. A question whose answers both leave every current file valid has changed nothing.',
    '',
    'Aim ABOVE this bar, not at it. The best question in the set is the one the operator cannot answer',
    'without stopping to think — because both branches are live, and choosing costs something.',
    '',
    'WHAT MAKES A QUESTION HIGH-LEVERAGE HERE. These four are not style advice — each one was MEASURED',
    'on this tape, and the ranker that scores your proposal enforces the first three mechanically.',
    '',
    '1. IT MUST REORGANIZE, NOT TRANSLATE. Your two answers get folded into the body of locked rules and',
    '   every rule is re-placed on the lattice. If all of them shift the same direction by the same',
    '   amount, that is your text dragging the bundle, not the project reorganizing — measured: one',
    '   rejected candidate moved all 8 coordinates by exactly 3 in one direction and scored zero. What',
    '   counts is how far each coordinate departs from that shared movement.',
    '',
    '2. WRITE IT IN THIS PROJECT\'S OWN VOCABULARY. Backwards from the obvious, and measured: the',
    '   surviving candidate had the LONGEST answers and disturbed the body LEAST, because it used the',
    '   nouns above — graduate, coordinate, tape, lock, receipt. A candidate phrased in a corner',
    '   vocabulary ("halt or auto-redispatch?") reads identically against every rule and is discarded.',
    '',
    '3. IT MUST NOT COLLAPSE THE BODY. If an answer makes the locked rules pile onto fewer distinct',
    '   cells than the sensor\'s own noise floor allows, that answer is swamping the reading rather than',
    '   informing it, and the whole question is thrown out. Long generic answers do this; specific ones',
    '   in the project\'s terms do not.',
    '',
    '4. IT MUST BE RETIRABLE — the property that decides whether this was a question at all. A question',
    '   retires when a coordinate locked later says substantially the same thing as one of its answers',
    '   (gzip-NCD at or below 0.52). So each answer must be a rule a future decision could MEASURABLY',
    '   satisfy. If no possible future coordinate could match your answer, you have written a wish with',
    '   a question mark and the loop can never close on it.',
    '',
    '5. IT MUST BE OPERABLE AT A GLANCE — and this one exists because the other four fight it.',
    '   Rule 2 rewards long answers in the project\'s vocabulary (measured: the survivor had the',
    '   LONGEST answers), so proposals drift toward 400-character rules. Those score well and are',
    '   miserable to steer with: the operator reads them in a small box, mid-flow, and has to hold the',
    '   whole clause in their head before they can correct one word of it.',
    '',
    '   So do BOTH, in this order, and do not trade one for the other:',
    '     · the FIRST SENTENCE of each answer is the whole rule in plain terms, complete on its own,',
    '       under about 20 words. A person must be able to act on that sentence alone.',
    '     · everything the measurement needs — the precise boundary, the exception, the project nouns —',
    '       follows in the sentences after it. Mass is preserved; it just stops being in the way.',
    '   The QUESTION follows the same shape: its first clause names the decision, any qualifying',
    '   detail comes after. A question the operator has to re-read is a question they will skip.',
    '',
    'Concretely, prefer a question that forces a VERIFIABLE PREDICATE — who acts, the exact boundary',
    'they may not cross, and what happens at the line — over one that invites a description of intent.',
    '"What is the exact execution boundary that separates authorized action from drift?" is answerable',
    'and retirable. "What is this system for?" is neither.',
    '',
    'A question about an operational detail (what happens on a retry, which flag defaults to what)',
    'constrains almost nothing and is worthless here.',
    '',
    'Give it exactly TWO possible answers. Write each answer as a FULL RULE in the project\'s own',
    'vocabulary — the same nouns the locked rules above use — one or two sentences, stating what must',
    'or must not be the case. Do not write short labels; a two-word answer cannot be measured.',
    '',
    'THE THREE FIELDS ARE THREE DIFFERENT KINDS OF SENTENCE. The operator edits all three, side by',
    'side, so any two that say the same thing in different words waste one of the three boxes. They',
    'were measured saying the same thing: gzip-NCD between the answer and the steer read 0.000,',
    'because the steer box was pre-filled with a byte-copy of the answer. Make them orthogonal BY',
    'KIND, not by rewording:',
    '',
    '  question  — WHAT IS UNDECIDED. Interrogative. Names the fork and nothing else. It is recorded',
    '              as the coordinate\'s provenance, so it must read as the state of the open problem.',
    '  rule      — WHICH SIDE, AS LAW. Declarative, general, in the project\'s vocabulary, phrased so a',
    '              future coordinate could measurably satisfy it. This is the ANSWER.',
    '  steer     — WHAT TO DO NOW. Imperative, specific to the current state of THIS project, and it',
    '              must name what becomes FORBIDDEN. This is the text that gets locked as a coordinate',
    '              and dispatched to an agent, so it has to be actionable by someone who reads only it.',
    '',
    'The test: if the steer is the rule with the verb changed, you have written one sentence twice.',
    'The rule says what is true from now on; the steer says what to change today and what to stop',
    'doing. A rule can be timeless. A steer cannot — it names the first thing that has to move.',
    '',
    'EVERY ANSWER MUST STATE ITS TRADEOFF. The operator chooses between the two answers by comparing',
    'costs, so each answer carries a "tradeoff" field: one sentence naming what picking THIS answer',
    'COSTS — what becomes harder, slower, or forbidden once it is the locked rule — in the project\'s',
    'own nouns. A tradeoff that is generic ("less flexibility"), empty, or a restatement of the other',
    'answer\'s rule has not named a cost. If you cannot name a real cost for one side, that side is',
    'not defensible and the pair fails the BOTH BRANCHES DEFENSIBLE test above — rewrite the pair.',
    '',
    'Output STRICT JSON and nothing else:',
    '{"id":"Q-XXXX","question":"...","answers":[{"label":"one-word","rule":"...","tradeoff":"...","steer":"..."},{"label":"one-word","rule":"...","tradeoff":"...","steer":"..."}]}',
  ].join('\n');

  return sonnetJson(prompt, `proposal ${i} (${angle.slice(0, 40)}…)`).then((r) => {
    if (!r.ok) { console.error(`  ✗ ${r.reason}`); return r; }
    const q = r.value;
    if (!q.question || !Array.isArray(q.answers) || q.answers.length < 2) {
      const reason = `proposal ${i} parsed but is not a question with >=2 answers`;
      console.error(`  ✗ ${reason}`);
      return { ok: false, reason };
    }
    // The tradeoff travels as DATA, never re-derived downstream: normalized here, carried through
    // scoreQuestion's answer map (next-question.mjs), rendered beside each answer in the cockpit.
    // A missing tradeoff becomes null rather than killing the proposal — the 2026-08-20 barren runs
    // are why a whole question is never discarded for a fixable field — and the cockpit shows the
    // absence honestly instead of papering over it.
    // steer normalizes beside tradeoff and for the same reason: a missing one must never kill an
    // otherwise-good proposal (the 2026-08-20 barren runs), and the page states the absence rather
    // than silently falling back to the rule, which is how the two boxes became one text.
    q.answers = q.answers.map((a) => ({ ...a, tradeoff: String(a.tradeoff ?? '').trim() || null, steer: String(a.steer ?? '').trim() || null }));
    // ── AN ID MUST IDENTIFY THE QUESTION, NOT ITS SEAT IN THE RUN ───────────────────────────
    // This was Q-GEN${i+1}, so every run re-minted Q-GEN1..Q-GEN4. Retirement is recorded BY ASK ID
    // and /api/question skips any ranking whose ask.id is on the retired list — so the moment
    // Q-GEN2 was retired, EVERY FUTURE Q-GEN2 was born retired and silently skipped, whatever it
    // actually asked.
    //
    // Measured 2026-08-21: a fresh, model-chosen question ("Does the unit of work sit at
    // commit-grain or dispatch-grain…", shortlist 2, with a stated reason) landed as Q-GEN2 and the
    // cockpit served the PREVIOUS run's question instead. The good question existed, was ranked, was
    // chosen, and was unreachable — the operator saw a stale deck and had no way to tell why.
    //
    // The id now carries the run's timestamp, so it is unique across runs and still readable. Old
    // retirements keep applying to the exact questions they retired, which is what they always meant.
    q.id = `Q-GEN${i + 1}-${runStamp}`;
    q.angle = angle;
    return { ok: true, q };
  });
}

// sonnetJson now lives in sonnet.mjs — extracted the moment choose-meaningful.mjs needed it too.
// Two copies of an env-stripping spawn with a hand-rolled JSON extractor is the shape that drifts.

// ── THE REPAIR ROUND — the gate's verdict fed back as a work order, once ──────────────────────
// MEASURED 2026-08-20 (the 23:32Z run): 4/4 proposals parsed and ranked, and every question was
// disqualified by ONE answer reading below the zero-information floor (surface-out 2, atom 2,
// coordinate 2, merge/split 3 — floor 4). The other answer of three of those questions read 4–5:
// rankable. The questions were not bad; single answers were phrased in corner vocabulary, which is
// exactly the failure the metric's own theory names. So instead of discarding the question — and
// with it the whole run — the collapsing answers are rewritten ONCE, in the project's vocabulary,
// with the measured reading in the brief. One round, bounded, parallel; if the repair also reads
// below the floor, the question dies for real and the record says so with numbers.
function repairAnswer(context, question, answer, reading) {
  const prompt = [
    'Here are the locked rules of a project:',
    '',
    context,
    '',
    `A candidate spec question — "${question.question}" — has an answer that failed a measurement.`,
    `The answer labelled "${answer.label}" currently reads: ${answer.rule}`,
    '',
    `The failure, measured: bundled with the locked rules, this answer text made the ${reading.n ?? 'locked'}`,
    `coordinates read as only ${reading.distinct} distinct lattice cell(s); a zero-information control reads`,
    `at least ${reading.floor}. That means the wording is swamping the sensor — it is phrased in vocabulary`,
    'foreign to the rules above, so it pulls every rule the same way instead of each rule its own way.',
    '',
    'Rewrite ONLY this answer. Keep its MEANING and its side of the question exactly; change the wording',
    'to reuse the concrete nouns the locked rules themselves use (their file names, artifact names, and',
    'terms of art). One or two sentences, a full rule stating what must or must not be the case.',
    '',
    'Output STRICT JSON and nothing else:',
    `{"label":"${answer.label}","rule":"..."}`,
  ].join('\n');
  return sonnetJson(prompt, `repair of ${question.id}/${answer.label}`);
}

/**
 * THE RECORD IS ALWAYS WRITTEN — a re-rank that leaves no trace is indistinguishable from a re-rank
 * that never ran, which is exactly how the cockpit served a retired question for two hours. When
 * there is no ask, `why` must be a measured, actionable sentence (counts, classes, the floor), never
 * silence. @guard tests/tape/next-question-always-produces-one.test.mjs
 */
export function buildRecord({ lockedCount, ranked = [], ask = null, proposalFailures = [], repaired = [] }) {
  const firstDeg = ranked.find((r) => r.cls === 'DEGENERATE');
  const why = ask ? null : [
    ranked.length
      ? `${ranked.length} candidate(s) ranked, none askable — ${ranked.map((r) => `${r.id}=${r.cls}`).join(' · ')}${firstDeg ? `. ${firstDeg.verdict}` : ''}`
      : 'no candidate survived proposal',
    proposalFailures.length ? `${proposalFailures.length} proposal(s) failed: ${proposalFailures.join(' · ')}` : null,
  ].filter(Boolean).join(' — ');
  return {
    ts: new Date().toISOString(), lockedCount,
    widthBefore: ranked[0]?.widthBefore ?? null,
    nullFloor: ranked[0]?.nullFloor ?? null,
    baseDistinct: ranked[0]?.baseDistinct ?? null,
    ask, ranked, generated: true,
    proposalFailures, repairedAnswers: repaired,
    why,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const n = Math.min(ANGLES.length, Math.max(1, parseInt(arg('--n', '5'), 10) || 5));
  const keep = process.argv.includes('--keep');
  const wnum = (f) => { const v = arg(f, null); const n = v == null ? null : Number(v); return Number.isFinite(n) ? n : null; };
  const wRepo = wnum('--weight-repo'), wCc = wnum('--weight-cc'), wSpec = wnum('--weight-spec');
  const weights = (wRepo != null || wCc != null || wSpec != null)
    ? { repo_code: wRepo, cc_transcripts: wCc, spec: wSpec }
    : null;

  const { liveCoordinates } = await import(resolve(HERE, 'coordinates.mjs'));
  const { loadTurns } = await import(resolve(HERE, 'decision-corpus.mjs'));

  const locked = liveCoordinates(slug).filter((c) => c.rule);
  // ── THE OPERATOR'S WEIGHTING CHOOSES THE EVIDENCE ───────────────────────────────────────────
  // This used to take loadTurns().slice(-8) — the last eight turns, blindly, by recency. That made
  // the context-balance pane a lie: the operator could set repo 75 / transcripts 10, the LLM could
  // even propose a weighting with a reason, and the next question would still be proposed from
  // whatever happened to be most recent. The operator's own words for the failure this prevents:
  // "verify the context weights didn't over-index on transcript fluff."
  //
  // So the candidate evidence is now SELECTED, through the same selectEvidence() the rest of the tape
  // uses, with the weights biasing which turns make the aperture. Weights bias SELECTION only and
  // never a measured value; that separation lives in selectEvidence() and is guarded there.
  // With no weights passed the ranking is the default one, so this is not a behaviour change for
  // anyone who has not set a weighting.
  const allTurns = loadTurns(slug);
  let turns = allTurns.slice(-8);
  let evidenceNote = 'the last 8 turns by recency (no weighting supplied)';
  if (weights) {
    try {
      const { selectEvidence } = await import(resolve(HERE, 'next-rule.mjs'));
      const sel = selectEvidence(allTurns, { weights, budgetBytes: 24000 });
      const picked = (sel.manifest || sel).filter((t) => t.selected).map((t) => allTurns[t.index]).filter(Boolean);
      if (picked.length) {
        turns = picked.slice(-8);
        evidenceNote = `${picked.length} turns selected under weights repo ${weights.repo_code ?? '-'} / cc ${weights.cc_transcripts ?? '-'} / spec ${weights.spec ?? '-'}`;
      } else {
        evidenceNote = 'weighting selected NO turns — fell back to recency rather than proposing from nothing';
      }
    } catch (e) {
      evidenceNote = `weighted selection failed (${String(e.message).slice(0, 80)}) — fell back to recency`;
    }
  }
  // ── WHAT IS STILL UNMEASURED, COMPUTED FROM THE LEDGER ──────────────────────────────────────
  // Operator: "when I open the page I expect a meaningful question answer steer for FINISHING THE
  // MEASUREMENT of the tesseract through the interface."
  //
  // The context was LOCKED RULES + RECENT NOTES and nothing else. A generator handed only those two
  // asks about whatever the rules and the chat happen to be about — which is why the served question
  // was about dispatch-failure semantics while most of the tape sat unmeasured and unasked. The gaps
  // were never in front of it.
  //
  // These are the SAME three fields sqlite-tape.mjs already computes per row for its unmeasured
  // column, recomputed here from the ledger rather than re-derived by a fresh exploration
  // (CLAUDE.md · measure, don't assert). Counts only: the generator needs to know WHERE the holes
  // are, not to be handed prose about them.
  const receiptsDir = resolve(SESSIONS, slug, 'html', 'receipts');
  const gaps = { noProvenance: 0, noSurface: 0, noPanel: 0 };
  for (const c of locked) {
    if (!c.quote && !c.steer) gaps.noProvenance++;
    if (!c.target_surface && !(c.owns || []).some((o) => o.kind === 'code')) gaps.noSurface++;
    if (!existsSync(resolve(receiptsDir, c.id + '.png'))) gaps.noPanel++;
  }
  const nLocked = locked.length || 1;
  const pct = (k) => Math.round((100 * k) / nLocked);

  const context = [
    'LOCKED RULES:',
    ...locked.map((c, i) => (i + 1) + '. ' + c.rule),
    '',
    // The measurement is the product. A decision that is locked but carries no provenance, no code
    // surface and no rendered panel is a rule that was written down, not a measurement that was
    // taken — and that difference is the whole thesis.
    'WHERE THIS TESSERACT IS STILL UNMEASURED (counted from the ledger just now):',
    '  ' + gaps.noProvenance + '/' + nLocked + ' locked coordinates (' + pct(gaps.noProvenance) + '%) carry NO recorded steer or quote — locked with no traceable origin',
    '  ' + gaps.noSurface + '/' + nLocked + ' (' + pct(gaps.noSurface) + '%) name NO code surface — nothing downstream can be measured against them',
    '  ' + gaps.noPanel + '/' + nLocked + ' (' + pct(gaps.noPanel) + '%) have NO rendered decision panel — the intent/reality pair was never read',
    '  A coordinate missing all three is a rule that was written down, not a measurement that was taken.',
    '  A question that CLOSES one of these gaps is worth more than a question that adds a new rule on top of them.',
    '',
    'RECENT WORKING NOTES:',
    ...turns.map((t) => String(t.text).slice(0, 900)),
  ].join('\n');

  console.log(`\n  PROPOSING ${n} candidates from ${locked.length} locked rules + ${turns.length} turns`);
  console.log(`  evidence: ${evidenceNote}\n`);
  const results = await Promise.all(ANGLES.slice(0, n).map((a, i) => proposeOne(context, a, i)));
  const proposed = results.filter((r) => r.ok).map((r) => r.q);
  const proposalFailures = results.filter((r) => !r.ok).map((r) => r.reason);

  const writeRecord = (rec) => {
    if (!keep) return;
    mkdirSync(resolve(SESSIONS, slug), { recursive: true });
    appendFileSync(resolve(SESSIONS, slug, 'questions.ndjson'), JSON.stringify(rec) + '\n');
    console.log(`  → appended to questions.ndjson (${rec.ask ? 'the cockpit will serve this one' : 'a barren run, recorded with its reasons'})\n`);
  };

  if (!proposed.length) {
    console.error('  no candidate survived proposal');
    // The record is written even now — a re-rank that leaves no trace looks identical to one that
    // never ran, and the fallback served a retired question for two hours because of exactly that.
    writeRecord(buildRecord({ lockedCount: locked.length, proposalFailures }));
    process.exit(2);
  }

  const { rankQuestions: rank, measureBody } = await import(resolve(HERE, 'next-question.mjs'));
  const P = await import(resolve(HERE, 'physics.mjs'));
  const body = await measureBody(locked, P);
  console.log(`  BODY — base ${body.baseDistinct} distinct cells over ${locked.length} locked rules · zero-information floor ${body.floor} (controls read ${body.nullDistincts.join('/')})\n`);
  let ranked = await rank(proposed, locked, body);

  // ONE repair round for questions killed solely by collapsing answers (see repairAnswer's note).
  const pickAsk = (rs) => rs.find((r) => r.cls !== 'DEGENERATE' && r.cls !== 'FORMALITY');
  const repaired = [];
  if (!pickAsk(ranked)) {
    const jobs = [];
    for (const r of ranked.filter((x) => x.cls === 'DEGENERATE')) {
      const original = proposed.find((q) => q.id === r.id);
      if (!original) continue;
      for (const a of r.answers.filter((x) => r.collapsing.includes(x.label))) {
        const f = (r.fields || []).find((x) => x.label === a.label) || {};
        jobs.push(repairAnswer(context, original, a, { distinct: f.distinct, floor: r.nullFloor, n: locked.length })
          .then((res2) => ({ id: r.id, label: a.label, res: res2 })));
      }
    }
    if (jobs.length) {
      console.log(`  REPAIR ROUND — rewriting ${jobs.length} collapsing answer(s) in the project's vocabulary…\n`);
      const fixes = await Promise.all(jobs);
      const toRerank = [];
      for (const q of proposed) {
        const mine = fixes.filter((f) => f.id === q.id && f.res.ok && f.res.value?.rule);
        if (!mine.length) continue;
        const q2 = { ...q, answers: q.answers.map((a) => {
          const fix = mine.find((f) => f.label === a.label);
          return fix ? { ...a, rule: String(fix.res.value.rule) } : a;
        }) };
        repaired.push(...mine.map((f) => ({ id: q.id, label: f.label, rule: String(f.res.value.rule) })));
        toRerank.push(q2);
      }
      for (const f of fixes.filter((x) => !x.res.ok)) proposalFailures.push(f.res.reason);
      if (toRerank.length) {
        const survivors = ranked.filter((r) => r.cls !== 'DEGENERATE' && r.cls !== 'FORMALITY');
        const reranked = await rank(toRerank, locked, body);
        ranked = [...reranked, ...survivors].sort((a, b) => b.rank - a.rank || b.score - a.score || b.spread - a.spread);
      }
    }
  }

  console.log(`  RANKED — cone width ${ranked[0]?.widthBefore ?? 'UNMEASURED'} over ${locked.length} locked coordinate(s)\n`);
  for (const r of ranked) {
    console.log(`  ${r.cls.padEnd(11)} score ${String(r.score).padStart(7)}  reorg ${String(r.reorganization).padStart(6)}  ${r.id}`);
    console.log(`     ${r.question}`);
    for (const a of r.answers) console.log(`       · ${String(a.label).padEnd(12)} → ${a.coordLabel}${a.tradeoff ? `  · costs: ${a.tradeoff}` : ''}`);
    console.log(`     ${r.verdict}\n`);
  }
  // ONE SELECTOR, BOTH WRITERS. next-question.mjs runs chooseMeaningful over the admissible
  // survivors; this path called pickAsk() and stopped, so a record written HERE reached the cockpit
  // with chosenBy absent and no reason — the model never got a vote on the question the operator
  // actually sees, because propose-questions is the path that --keep writes. Two writers of one
  // record, one of them skipping the chooser, is the same divergence that shipped two panel
  // selectors and two question readers.
  const chosen = await chooseMeaningful(ranked, {
    context: locked.slice(-4).map((c) => (c.coord || '?') + ' — ' + String(c.rule || '').slice(0, 110)).join(' · '),
  });
  const ask = chosen.ask || pickAsk(ranked);
  const record = buildRecord({ lockedCount: locked.length, ranked, ask: ask || null, proposalFailures, repaired });
  // carried so the glass can say WHO chose and why — absent chosenBy reads as the old behaviour
  record.chosenBy = chosen.chosenBy;
  record.chooseWhy = chosen.why;
  record.chooseReason = chosen.reason;
  record.shortlist = chosen.shortlist;
  console.log(ask ? `  ASK THIS ONE: ${ask.id} — ${ask.question}\n` : `  NOTHING RANKABLE — ${record.why}\n`);
  writeRecord(record);
}
