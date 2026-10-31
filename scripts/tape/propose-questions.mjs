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
//   · PROOF OF READING — AND IT LIVES IN THE ANSWERS, NOT THE QUESTION (see THE SANDBAG below).
//     A question that could have been asked of any project is still a failure, but it proves the
//     build was understood by naming the TRADEOFF this build actually faces, not by naming a file.
//     The vocabulary obligation (constraint 2) binds the ANSWERS — the only text that is placed.
//   · THE TRADEOFF. Each answer carries a "tradeoff" field — what picking it costs — because the
//     operator chooses BETWEEN costs, and a rule with no stated cost reads as free. The field is
//     DATA: normalized below, carried through next-question.mjs's answer map, rendered in the
//     cockpit beside the answer. It is never folded into the placed text — the sensor was
//     calibrated over rule text alone.
//
// THE SANDBAG — WHY THE BRIEF CHANGED (2026-08-22).
//
// The minted questions drifted DOWNWARD into technical specification: "LRU or LFU for cache
// eviction?", "which flag defaults to what". That defeats the instrument twice. A technical spec is
// an IMPLEMENTATION of an intent, so a tape that captures only the spec never captures the why — and
// the system can then never measure whether the why survived, which is the entire product. It also
// turns the operator into a human compiler: they are here to make the design tradeoffs the machine
// cannot make, not to name the caching layer.
//
// THE MECHANISM, verified in the source rather than hypothesised: next-question.mjs's
// scoreQuestion() bundles ONLY the answer's `rule` text with the locked coordinates and places THAT
// on the lattice. THE QUESTION TEXT IS NEVER PLACED AND NEVER MEASURED. Meanwhile this brief was
// ordering the question to "name the actual mechanism at stake — a specific artifact, file, step, or
// term of art". So it demanded technology in the one field where naming it buys ZERO measurement and
// costs the whole steering value of the turn. The proof-of-reading obligation therefore MOVES to the
// answers, which are what gets placed and measured; the question is freed to be the upstream fork.
//
// THE LADDER — the operator's calibration triple, now IN the brief, because a model follows a worked
// example far better than a rule:
//   VIBE CHECK  "What should our data strategy feel like?" — useless, constrains nothing.
//   SANDBAG     "Do we use LRU or LFU for cache eviction policy?" — hyper-specific, skips the intent.
//   UPSTREAM    "When the system is under heavy load, do we prioritize guaranteeing the user sees
//               ground-truth data (blocking the UI for 2 seconds), or do we prioritize immediate
//               kinetic response (serving data that might be 5 minutes stale)?" — a clean XOR,
//               highly constraining, entirely non-technical, a pure tradeoff of values. Once THAT is
//               answered, subagents can DERIVE Redis-vs-Postgres and LRU-vs-LFU. That is the point.
//
// WHAT THIS FILE DOES NOT CLAIM. A prompt enforces nothing; the ranker disposes. The mechanical kill
// for the sandbag belongs in next-question.mjs — a leaf execution answer places on a low-reach cell
// (unowned technical mass sits around C,B1 (Operations × Tactics.Speed)) and a reach-weighted score
// drives it toward zero. Nothing in THIS file measures anything, and this brief must never be read
// as the guard. It only stops the generator spending placements on questions the ranker will bin.
//
//   node packages/thetacog-mcp/scripts/tape/propose-questions.mjs --slug gddadwill [--n 5] [--keep]
//
// --keep also appends the ranking to questions.ndjson, which is what /api/question serves.

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sonnetJson } from './sonnet.mjs';
// THE MINTING BRIEF LIVES IN A SIDECAR, NOT IN THIS FILE. See minting-brief.mjs for why, and for
// the refusal: no sidecar, no mint.
import { loadMintingBrief, composeMintingPrompt } from './minting-brief.mjs';
// The readability floor — measured, LLM-free; see question-quality.mjs for the three axes
// and for why it gates rather than ranks.
import { readabilityOf } from './question-quality.mjs';
// The corpus lookup — attached to the ask at mint time so the glass never pays for it.
import { priorArt } from './prior-art.mjs';
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
function proposeOne(context, angle, i, brief) {
  // THE BRIEF IS AN ARGUMENT, NOT A LITERAL. It arrives from the sidecar the operator edits on the
  // cockpit glass (data/tape/minting-brief.md + minting-filter.<slug>.md) and is composed by the
  // ONE composition function both this generator and /api/minting-brief call, so the prompt shown
  // on the page is the prompt that is sent. A caller that reaches this line without a loaded brief
  // is a bug: main() refuses to start without one.
  const prompt = composeMintingPrompt({ context, angle, general: brief.general, filter: brief.filter, examples: brief.examples });

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

  // ── REFUSE TO MINT WITHOUT THE BRIEF ────────────────────────────────────────────────────────
  // Same discipline as emit-spec.mjs refusing to write an empty SPEC.md: a generator that silently
  // fell back to a built-in brief would mint questions from text the operator cannot see, while the
  // glass showed them a document that had no effect. Refusing is the only outcome that keeps
  // "no brief" and "this brief" distinguishable. Checked BEFORE the minutes-long context build, so
  // a missing sidecar costs a second rather than a walk.
  const brief = loadMintingBrief(slug);
  if (!brief.ok) { console.error(`✗ ${brief.reason}`); process.exit(2); }
  console.log(`  brief: ${brief.generalPath.replace(`${REPO}/`, '')} + ${brief.filterPath.replace(`${REPO}/`, '')}${brief.filterIsDefault ? '  ⚠ NO PROJECT FILTER — using the default' : ''}`);
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

  // ── --print-prompt · THE ROUND TRIP, PROVEN WITHOUT A MODEL ─────────────────────────────────
  // CLAUDE.md line 201, which predates the cockpit spec and outranks it: "a control that looks live
  // but is not plumbed into the computation it claims to steer is fabrication wearing a UI." The
  // cockpit now renders the brief in an editable textarea. That textarea asserts control, so the
  // control has to be demonstrable — and a guard that checks a textarea exists proves nothing at all.
  //
  // This flag composes the REAL prompt — real locked body, real selected turns, real gap counts, the
  // real brief loaded from the sidecar — and prints it instead of sending it. So a test can edit the
  // brief, run the actual generator, and read the actual bytes that would have gone to the model.
  //
  // WHAT IT PROVES AND WHAT IT DOES NOT. It proves the causal step: the operator's edit reaches the
  // text the minter sends. It does NOT prove the model then returns a different question — that hop
  // is a model output, non-deterministic, minutes long, and unguardable by a test that has to stay
  // green on every commit. Guarding the last observable link before the model is the strongest
  // deterministic claim available here, and pretending otherwise would be the fabrication this flag
  // exists to rule out.
  if (process.argv.includes('--print-prompt')) {
    // STDOUT MUST BE BLOCKING BEFORE process.exit() OR A LARGE PAYLOAD TRUNCATES AT ~8188 BYTES
    // THROUGH A PIPE. This repo already paid for that lesson once (emit-spec.mjs's CLI carries the
    // same two lines and the same note) and it bit again here: the prompt is ~50KB, it printed
    // perfectly to a redirected file and arrived clipped mid-context through execFileSync, so the
    // guard failed on an assertion that was actually true. A truncated prompt is worse than no
    // prompt — it looks like a reading.
    try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
    const angleIdx = Math.max(0, Math.min(ANGLES.length - 1, parseInt(arg('--angle', '0'), 10) || 0));
    console.log('───── PROMPT AS SENT (angle ' + angleIdx + ') ─────');
    console.log(composeMintingPrompt({ context, angle: ANGLES[angleIdx], general: brief.general, filter: brief.filter, examples: brief.examples }));
    process.exit(0);
  }

  console.log(`\n  PROPOSING ${n} candidates from ${locked.length} locked rules + ${turns.length} turns`);
  console.log(`  evidence: ${evidenceNote}\n`);
  const results = await Promise.all(ANGLES.slice(0, n).map((a, i) => proposeOne(context, a, i, brief)));
  const proposedRaw = results.filter((r) => r.ok).map((r) => r.q);
  const proposalFailures = results.filter((r) => !r.ok).map((r) => r.reason);

  // ── THE READABILITY GATE (2026-08-24) ────────────────────────────────────────────────────────
  // The brief ASKS for zero translation and a question sayable in a breath. Asking is what we had,
  // and the measured result of asking was 1 of 22 live questions clean. So the meter runs BEFORE
  // the ranker and drops what a human cannot read: a beautifully constraining question nobody can
  // answer costs the operator a turn and produces nothing.
  //
  // IT GATES, IT DOES NOT RANK. Readability is a floor, not a score — a legible formality still
  // has to die at the ranker. Blending the two is how SPREAD drowned REDUCTION in v2, and the two
  // measures answer different questions (question-quality.mjs states the contract).
  //
  // THE FLOOR IS SURVIVABLE ON PURPOSE. If every candidate fails, the gate reports and passes them
  // through rather than starving the run — a barren turn teaches the operator nothing, and named
  // failures on the glass beat an empty page. Same never-block discipline as the rest of this
  // pipeline.
  const priorAsked = (() => {
    try {
      const p = resolve(SESSIONS, slug, 'questions.ndjson');
      if (!existsSync(p)) return [];
      return [...new Set(readFileSync(p, 'utf8').trim().split('\n')
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((r) => r && r.ask && r.ask.question).map((r) => r.ask.question))];
    } catch { return []; }
  })();
  const reads = proposedRaw.map((q) => ({ q, r: readabilityOf(q.question ?? '', priorAsked) }));
  const legible = reads.filter((x) => x.r.clean).map((x) => x.q);
  const illegible = reads.filter((x) => !x.r.clean);
  for (const { q, r } of illegible) {
    console.log(`  \u2717 unreadable \u2014 ${String(q.question ?? '').slice(0, 70)}\u2026`);
    for (const f of r.fails) console.log(`      \u00b7 ${f}`);
  }
  const proposed = legible.length ? legible : proposedRaw;
  if (!legible.length && proposedRaw.length) {
    console.log(`  \u26a0 EVERY candidate failed the readability floor (${proposedRaw.length}) \u2014 passing them through rather than starving the turn.`);
    proposalFailures.push(`readability floor: 0/${proposedRaw.length} candidates legible`);
  } else if (illegible.length) {
    console.log(`  readability gate: ${legible.length}/${proposedRaw.length} legible, ${illegible.length} dropped\n`);
  }

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

  // ── PRIOR ART, ATTACHED AT MINT TIME (2026-08-24) ───────────────────────────────────────────
  // The corpus lookup costs a few hundred ms — nothing here, everything on a page load. So it runs
  // ONCE, offline, where the question is chosen, and rides in the record. The glass then shows the
  // operator his own prior words on this question for free, which is the only place the cost could
  // never be paid at request time (CLAUDE.md: no model and no unbounded call on the interactive path
  // — this is neither, but the same discipline about WHERE work happens applies).
  //
  // EVIDENCE, NOT A VERDICT. prior-art's own measurement says the score ranks but cannot classify
  // settled from open (the ranges invert), so this attaches passages and never filters the ask.
  // Best-effort by construction: no corpus, or a failed query, leaves the field null rather than
  // failing the mint — a missing corpus must not cost the operator a question.
  let priorArtHits = null;
  if (ask && ask.question) {
    try {
      const pa = priorArt(ask.question, { limit: 3 });
      priorArtHits = pa.ok
        ? { ok: true, searched: pa.searched, hits: pa.hits, note: 'your own prior words on these terms — ranked, not judged' }
        : { ok: false, reason: pa.reason };
      if (pa.ok && pa.hits.length) {
        console.log(`  prior art: ${pa.hits.length} earlier turn(s) on ${pa.searched.slice(0, 3).join(', ')} — nearest ncd ${pa.hits[0].ncd}`);
      }
    } catch (e) {
      priorArtHits = { ok: false, reason: `prior-art lookup failed: ${String(e.message).slice(0, 120)}` };
    }
  }
  if (ask && priorArtHits) ask.priorArt = priorArtHits;
  const record = buildRecord({ lockedCount: locked.length, ranked, ask: ask || null, proposalFailures, repaired });
  // carried so the glass can say WHO chose and why — absent chosenBy reads as the old behaviour
  record.chosenBy = chosen.chosenBy;
  record.chooseWhy = chosen.why;
  record.chooseReason = chosen.reason;
  record.shortlist = chosen.shortlist;
  console.log(ask ? `  ASK THIS ONE: ${ask.id} — ${ask.question}\n` : `  NOTHING RANKABLE — ${record.why}\n`);
  writeRecord(record);
}
