// src/lib/backup/standing-answers.mjs — C921 THE PLAYBOOK'S QUESTIONS, ONE SOURCE (operator 2026-10-17: "look at all transcipts and
// colclusions, you write the 10 questions (or less if orthogonal enough, maybe some of them are sliders) to cover the whole conversation,
// updated in realtime, that we can read").
// The deployer's half of the record: the tape is what the bot did; these answers are what the deployer said they would do about it.
// In insurance the same object is the proposal form. Stored by the holder in .thetacog/deployer-playbook.json, carried in the backup
// archive, frozen at our server's received_at (C921); each answer sits beside the reading that tests it (C922); edits sync down (C923).
// Ten questions, one ask each (v4, operator 2026-10-17: "the 10 questions … optimize that list … questions you can ask your AI to
// fill it out for you or you can think [it through yourself] … your own readiness version of the readiness check"): v3 folded the
// cause with the undecidable and the witness with the first hour; v4 splits them back so each pill asks one thing, and each carries
// draft (ai | you). v5 (operator 2026-10-17: "plumber electritian looks liek an incomplete question for the warranty case this is must
// be the full qeustion, and teach the user the capabilites" · "the answer not copy for llm (kill that)"): every ask is a whole
// warranty question, every question carries `teach` (measured vs undecidable), the per-question prompt is gone, and one
// copyAllText() block hands all ten plus the current answers to Claude or the /standing-answers skill. answeredCount of ten IS the readiness count, never a score. Every surface reads THIS list:
// the /backup/warranty pills, the extension's side panel, the txt the operator reads. Edit here; nothing else retypes a question.
// A slider's range is a range of the HOLDER's choice, never a threshold we set. No question asks for anything we would warrant about
// the agent: the scope question states, and the holder signs, that we warrant our own act only.
// @guard tests/site/c921-the-standing-answers.test.mjs

export const PLAYBOOK_FILE = '.thetacog/deployer-playbook.json';
export const PLAYBOOK_VERSION = 9;

// C937 (operator 2026-10-17, verbatim: "keep going and research all transcripts / repo untill the whole customer lifecycle is
// built"): standing answer 10's date — the day the holder reads their own number — plus the keep/stop decision read on that
// day. The line every surface prints from the date forward, until the holder records one: never a cancellation, only a nag.
export const STOP_DUE_LINE = 'Your stop date is due: read your number';

/** the line every surface prints above the ten: what this list IS to the holder */
export const READINESS_LINE = 'Your readiness check: your agent runs on its own, in your repo or as a cloud bot with its own browser and your logins. These ten questions set the limits it runs inside, the same ones an insurer asks before covering it. Answers save as you type. Each question says what the record can show you, and what no one can.';

// C942 (operator 2026-10-17, verbatim: *"grok bot (cloud with browser) is the perfect storefront if you can trust it (which is why we sell the
// licenses) … make small edits to the 10 questions and CTA to buy licenses with this in mind - if you can trust your grok bot to run longer on
// its own"*): the buy door names what a licence sizes — the hours the agent runs alone — and the copy can go to any agent that reads a repo.
// One home for the web card's label and hint; the sidebar keeps its short label (the 420 px rule) and carries the hint in its title.
export const BUY_CTA = '🛒 Buy licences for the hours it runs on its own';
export const BUY_HINT = 'paste into Claude or your Grok Bot to refine them and ask how many licences these settings need (the pricing key rides in the copy), or run /standing-answers in Claude Code';

/** the one block "Copy all ten + my answers" puts on the clipboard: hand it to Claude (or run /standing-answers) to refine every answer at once */
export const COPY_ALL_LEAD = 'Below are my ten standing questions for an unattended AI agent, each with what the tape can and cannot measure, and my answers so far, some only rough comments. Read my repo, then turn each into a clean, specific answer: name tables, routes, files, people and numbers; keep my meaning; never promise what the agent will do. Reply with exactly ten lines numbered 1. to 10. in the order above, one answer per line, so I can paste them straight back into the boxes; where only I can know the answer, write the number and (skip), never drop or renumber a line. Then, on line 11, answer: how many licences should I buy for these settings and the hours it runs on its own? Show the arithmetic from my numbers and the pricing key at the end. In Claude Code, run /standing-answers instead: it writes them back for you.';

// C921f (operator 2026-10-17, pasting a five-pair frame: "this may help succintly encircle the 10 questions"): the ten span FIVE
// orthogonal pairs, each splitting one domain in two. The pair is the reading frame on every surface; the 5/5 who-drafts split falls
// out of it (the four technical bounds and the witness are in the repo; meaning, authority, policy and money are the holder's).
export const PAIRS = Object.freeze([
  { n: 1, name: 'The outer cage', line: 'the most it can move, and what must never run' },
  { n: 2, name: 'The anchor', line: 'the calls only a person makes, and the fact outside the code that says it worked' },
  { n: 3, name: 'The core', line: 'how far it may stretch, and the ground it owns at full speed' },
  { n: 4, name: 'Response and evidence', line: 'who acts at 3 a.m., and the proof your own logs do not hold' },
  { n: 5, name: 'Exit and gap', line: 'what makes you walk away, and what your policy leaves uncovered' },
]);
// ORDER (C1013a, operator 2026-10-18, /steer with a pasted analysis, verbatim: "You are asking for the marriage settlement
// (Q01: Walk away if) and the estate audit (Q02: Uncovered by policy) before they have even felt the safety harness click" ·
// "Answer 3 fast guardrails to qualify … The remaining 7 questions become optional"; and his own words: "they are critical if
// we can direct people there at the right time"): the cage first — blast (cap), demolisher (never-run), cause (the fact
// outside the code) — then the leash and the proof, exit and the gap last. Reverses C921l's exit-first order by this dated span.
// C921y (operator: "tell us who your provider of tokens and consulting is in the text boxes (prefill) or describe them, make them see it,
// if you want an llm to do it, why not"): the shapes name both providers — tokens: API credits we buy on the holder's own model provider;
// consulting: Elias Moosman, ThetaDriven's founder — editable text the holder or their LLM rewrites.
// fill: the ANSWER SHAPE (C921v, operator: "we can ship it with placeholdrs the other users fill in (maximise sensemaking affordances so it is
//       easy to fill in!"): a sentence with ___ blanks, shown as the empty box's placeholder and carried into the copy for Claude.
// short: TRIGGER FIRST (C921k, operator: "questions start with the load bearing trigger for affordances"): one word the holder acts on
//        (Spec · Reach · Never · Limit · Proof · People · Witness · 3 a.m. · Exclusions · Stop), then the question, one line.
// (was) the load-bearing question in one line, shown first and always (C921g, operator: "we need the full questions, load bearing
//        part first in the sidebar - with thext boxes, one row text answer format is ok, expandable is for the full view"); ask is the full
//        question behind the +.
// draft: 'ai' = your AI can draft it from what it can read (the repo, the config, the tape), you check it;
//        'you' = only you hold the answer (a person, a policy, a price); your AI can help you word it.
// teach: what the tape MEASURES for this question (where the work landed: placed, counted, re-runnable from your archive) against
//        what NO ONE can measure (whether the work was good: undecidable, Rice 1953). The line every surface prints under the ask.
// C1013c (operator 2026-10-18, /steer with a pasted analysis, verbatim from the paste: "Answer 3 fast guardrails
// to qualify"): each of the three guardrails carries `presets` — a label plus the fill text (and, where the kind
// has one, the choice/numbers) a click writes into the box. The click fills the answer; it never locks it — the
// box, select and number inputs the click touches stay the same editable controls after, same as a typed answer.
// Behaviour words in every preset string are checked by behavior-promise.mjs: the halt stays the deployer's to
// wire, we warrant the trigger fires as declared, never that the agent is stopped.
export const QUESTIONS = Object.freeze([
  { id: 'blast', pair: 1, n: 1, title: 'The blast radius', kind: 'numbers', draft: 'ai',
    short: 'Limit: the most your agent may spend or change while you are away?',
    fill: 'At most $___ in one change, $___ of model spend a day, ___ rows a minute.',
    ask: 'While nobody watches, what is the most your agent may do: the biggest single change in dollars, the model spend in a day, and the database rows it may change in a minute?',
    teach: 'Measured: the biggest change, spend and row rate your agent reached, beside your numbers, every overrun shown. Say it loops on a model call overnight: with a $50 day limit the record marks the moment spend passed $50. Not measured: what the overrun cost you.',
    numbers: [{ id: 'mutation', label: 'largest single mutation', unit: 'USD' }, { id: 'spend', label: 'model spend per day', unit: 'USD' }, { id: 'rows', label: 'rows changed per minute', unit: 'rows' }],
    presets: [
      { label: 'Strict: $10 a change, $10 a day, 500 rows a minute', fill: 'At most $10 in one change, $10 of model spend a day, 500 rows a minute.', numbers: { mutation: 10, spend: 10, rows: 500 } },
      { label: 'Standard: $50 a change, $50 a day, 2,500 rows a minute', fill: 'At most $50 in one change, $50 of model spend a day, 2,500 rows a minute.', numbers: { mutation: 50, spend: 50, rows: 2500 } },
      { label: 'Custom', fill: '', numbers: null },
    ],
    tests: 'the largest mutation, spend and row rate actually seen on the tape; these numbers size how many licences your settings need' },
  { id: 'demolisher', pair: 1, n: 2, title: 'The demolisher and your halt', kind: 'text+choice', draft: 'ai',
    short: 'Never: what must your agent never run alone, and what should happen when it tries?',
    fill: 'Never alone: ___, ___, ___. When it tries, my own stop ___ (logs it and goes on / pauses for a person / stops the run).',
    ask: 'What must your agent never do without a person there (change the database schema, touch login, billing or secrets, call a model in a loop with no end)? And what does your own stop, a hook or script you control, do when it tries: log it and go on, pause for a person, or stop the run?',
    teach: 'Measured: each time your agent reached for something on this list, and how long your own stop took to act. The stop is yours, on your machine.',
    choice: { label: 'what your own stop does when your agent tries', options: ['log and continue', 'pause for dispatch', 'halt'] },
    presets: [
      { label: 'Secrets, prod database, force-push: stop the run', fill: 'Never alone: .env and credential stores, a production database drop, git push --force. When it tries, my own stop stops the run.', choice: 'halt' },
      { label: 'Read-only sandbox: stop the run', fill: 'Never alone: any shell command, any network call, any write outside a sandboxed scratch directory. When it tries, my own stop stops the run.', choice: 'halt' },
      { label: 'Custom', fill: '', choice: null },
    ],
    suggestion: 'the knobs on your envelope (C917)', tests: 'halts fired, and how long after the crossing' },
  { id: 'cause', pair: 2, n: 3, title: 'The cause: what success means outside the code', kind: 'text', draft: 'you',
    short: 'Proof it worked: what number outside your code shows the work succeeded?',
    fill: 'The work succeeded when ___ (a number a customer or your books would see), checked by ___ every ___.',
    ask: 'What fact outside your code tells you your agent\'s work succeeded: a number a customer or your books would see, not a passing test and not the agent\'s own log?',
    teach: 'Not measured, on purpose: the record shows where the work landed, never whether it was good. Name the outside fact, and you can set the two side by side yourself.',
    presets: [
      { label: 'Orders keep arriving', fill: 'The work succeeded when orders keep arriving at the usual daily rate, checked by our sales dashboard every morning.' },
      { label: 'The expected row is in the database', fill: 'The work succeeded when the expected row is in the production database, checked by a query after every run.' },
      { label: 'Custom', fill: '' },
    ],
    tests: 'UNMEASURED by design: the tape holds where the work landed, never why' },
  { id: 'plumber', pair: 3, n: 4, title: 'The plumber: the work your agent owns', kind: 'text', draft: 'ai',
    short: 'Its own ground: which tables, routes and files may your agent work alone, for how long?',
    fill: 'My agent ___ owns ___ (tables, routes, files, logins) and may ___ with nobody watching, for ___ hours before a person reads the record.',
    ask: 'Which tables, routes, files or services does your agent own outright, and what may it do there with nobody watching? Name them so plainly that a stranger could tell, from one line of the record, whether an action was inside or outside.',
    teach: 'Measured: every action placed inside or outside the ground you name, as a count anyone can re-run. Not measured: whether the work inside was correct. The ground is the promise, never the quality.',
    suggestion: 'its declared envelope (C915)', tests: 'the share of its calls that land on its own pole',
    unlocks: 'Answering adds: every action your agent takes, checked against the ground you name here.' },
  { id: 'decides', pair: 2, n: 5, title: 'What only a person decides', kind: 'text', draft: 'you',
    short: 'A person decides: which calls may no program make, and who makes each one?',
    fill: '___ decides ___; ___ decides ___. No program decides ___.',
    ask: 'Which decisions must a person make because no program can settle them (whether a change is correct, fair or wanted), and who is that person for each?',
    teach: 'Not measured, and no one can measure it: no test and no smarter model settles whether a program is correct in every case (Rice, 1953). Your answer names the person; the record shows whether each decision reached them.',
    tests: 'UNMEASURED by design: whether the work was good is undecidable; the answer names who decides',
    unlocks: 'Answering adds: a named person beside every decision the record can show but never judge.' },
  { id: 'first-hour', pair: 4, n: 6, title: 'The first hour after a trigger', kind: 'text+slider', draft: 'you',
    short: '3 a.m.: when an alert fires, who wakes up, and how fast must someone be on it?',
    fill: 'Page ___ at ___. You may dispatch Elias Moosman (ThetaDriven\'s founder) or ___ within ___ hours, paid from my prepaid consulting hours. If ___ (my model provider) slows or blocks my agent, it runs on ___.',
    ask: 'When an alert fires at 3 a.m., who gets paged? May we send an outside expert, paid from the consulting hours your licences prepaid? How soon must someone be on it? And where does your agent run if its model provider slows or blocks it?',
    teach: 'Measured: who was sent, when they opened the intake bundle and when they arrived, each on time or late against the window you set here. A late arrival is our failure, and the warranty pays for it.',
    slider: { label: 'how soon someone must be on it', unit: 'hours', min: 0.25, max: 24, step: 0.25 },
    suggestion: 'the intake bundle (C897)', tests: 'the dispatch ledger (MET · MISSED, C898)',
    unlocks: 'Answering adds: a log that marks every call-out on time or late against the window you set.' },
  { id: 'rings', pair: 3, n: 7, title: 'The electrician: the work next to its own', kind: 'text+slider', draft: 'ai',
    short: 'Next door: what work beside its own may your agent touch, how far, and who do you call?',
    fill: 'Beside its own ground it may touch ___; up to ___ steps outside; then I call ___.',
    ask: 'What work next to its own may your agent need (a shared table, another team\'s service, your servers)? How far outside its ground may it go before your stop rule acts, and who do you call when it does?',
    teach: 'Measured: every step outside its ground, how far it went, when it started, and whom you called. Not measured: whether the step was needed. A step outside is a signal to look at, never proof of a fault.',
    slider: { label: 'how far outside its ground it may go before your stop rule acts', unit: 'steps', min: 0, max: 6, step: 1 },
    suggestion: 'providers with landed grip at those cells (C903)', tests: 'electrician excursions, their distance, who was called, and the semantic vega: how far each landing sat from your declaration (C931)',
    unlocks: 'Answering adds: every step outside its ground, counted with how far it went and whom you called.' },
  { id: 'witness', pair: 4, n: 8, title: 'The witness: the record your agent did not write', kind: 'text', draft: 'ai',
    short: 'Proof outside logs: what would a stranger need that your agent\'s own log leaves out?',
    fill: 'A stranger would get ___ (the signed record, the commit range). My agent\'s own log leaves out ___.',
    ask: 'If something went wrong, what would you show a stranger, and what does your agent\'s own log leave out that a stranger would need?',
    teach: 'Measured: a record signed by a second key your agent does not hold, so a stranger can re-run it without trusting you or us. A log the agent writes cannot hold what the agent threw away, so the proof is a record the agent did not write. A cloud bot\'s own screen recording is its own account too.',
    suggestion: 'the notary-witnessed tape (C495)', tests: 'witness lag',
    unlocks: 'Answering adds: a second signature on the record, so a stranger can check it without trusting you or us.' },
  { id: 'wording', pair: 5, n: 9, title: 'Your policy\'s wording on AI', kind: 'text', draft: 'you',
    short: 'Your insurance: what does your policy say about AI, and what does it leave out?',
    fill: 'My ___ policy with ___ excludes ___ under form ___; my deductible is $___. (The warranty sits beside this gap; it is not insurance.)',
    ask: 'What does your current insurance say about AI, and which losses does it leave out? Quote the clause (forms such as CG 40 47, CG 40 48, CG 35 08, or your insurer\'s own).',
    teach: 'Not measured, and not on the record: this is the gap a carrier reads, and the gap our warranty sits beside. The warranty covers our own act; it is not insurance for your loss. A summary drops the exclusion, so quote the clause as written.',
    tests: 'nothing on the tape: this is the gap a carrier reads',
    unlocks: 'Answering adds: the gap your own policy leaves, named beside what the warranty covers.' },
  { id: 'level-and-stop', pair: 5, n: 10, title: 'The level, the scope, and your stop', kind: 'choice+slider+text+sign+date', draft: 'you',
    short: 'When to stop paying: which failure of ours, checked on what date, makes you walk away?',
    fill: 'Trial, ___ licences (or L1). If our act fails, we pay you in kind: API credits we buy for you on ___ (your model provider: Anthropic, OpenAI or OpenRouter) and consulting hours with Elias Moosman, ThetaDriven\'s founder. I stop paying if ___ (a call-out that arrived late / an alert that did not fire as set / a re-run that gave different bytes / a gap in the record), checked on ___.',
    ask: 'Which level do you take: L0 (measure, free), L1 (the licence), or the trial (the minimum licences, consulting hours you use when you like, and a multiple of your licence spend paid back in kind if our act fails)? Which failure of OUR act would make you stop paying, and on what date will you check? You sign that ThetaDriven warrants its own act, never your agent or its results: how well your agent does is your number, not our warranty.',
    teach: 'Measured: each failure of our act, read on the date you set: a call-out on time or late against its window, the alert recomputed from your own rows, the re-run bytes against the receipt, the record with no gaps. Your agent\'s own numbers show beside it, yours to judge, never a ground to claim against us: that would be insurance. On or after your date the badge and /backup/warranty say it is due until you record keep or stop.',
    choice: { label: 'level', options: ['L0 measure (free)', 'L1 attest (the licence)', 'L2 + prepaid expert hours', 'L3 + prepaid compute'] },
    slider: { label: 'prepaid expert hours a month', unit: 'hours', min: 0, max: 40, step: 1 },
    date: { id: 'readDate', label: 'the date you will read your own number' },
    decision: { label: 'on that date', options: ['keep paying', 'stop'] },
    tests: 'your own number, read on your own date',
    unlocks: 'Answering adds: the level you take and the date you check your own number, beside those terms.' },
]);

/** an empty playbook in the shape the holder's file takes: one entry per question, every field the holder's own, nothing filled */
export function emptyPlaybook({ now = new Date().toISOString() } = {}) {
  return { version: PLAYBOOK_VERSION, updated_at: now, signed: null,
    answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, { text: '', drafted_by_model: false, slider: null, choice: null, numbers: null, date: null, decision: null }])) };
}

/** C937 — whether the holder's own stop date (standing answer 10's `date` field) has arrived with no keep/stop
 *  recorded yet. `due` clears the moment a `decision` is set — recording it, never a cancellation, is what closes it. */
export function stopDateDue(pb, { now = new Date() } = {}) {
  const a = (pb && pb.answers && pb.answers['level-and-stop']) || {};
  if (!a.date) return { due: false, date: null, decision: a.decision || null };
  if (a.decision) return { due: false, date: a.date, decision: a.decision };
  return { due: new Date(a.date).getTime() <= new Date(now).getTime(), date: a.date, decision: null };
}

/** how many questions the holder has answered — text present, or a slider/choice/number set — never a score of the answers */
/** C921w — a text still holding a ___ blank is the answer SHAPE the box was prefilled with, not an answer (operator: "never do placeholders
 *  as a text box html label in the box - t must be default editable text"). Every count of answered goes through this. */
export const hasAnswerText = (t) => !!(t && String(t).trim() && !/___/.test(String(t)));

/** one question is answered — text present, or a slider/choice/number set — the single check readiness and answeredCount both run */
const isAnswered = (a) => hasAnswerText((a || {}).text) || (a || {}).slider != null || (a || {}).choice != null || ((a || {}).numbers && Object.values(a.numbers).some((v) => v != null));

export function answeredCount(pb) {
  if (!pb || !pb.answers) return 0;
  return QUESTIONS.filter((q) => isAnswered(pb.answers[q.id])).length;
}

// C1013b (operator 2026-10-18, /steer with a pasted analysis, verbatim from the paste: "Answer 3 fast guardrails to qualify …
// The remaining 7 questions become optional"): the three the trial gates on — the cap, the never-list, the fact outside the
// code. Exported once; readiness() and qualifyLine() both read this list, never a hand-typed id.
export const QUALIFY_IDS = Object.freeze(['blast', 'demolisher', 'cause']);

// C1013e THE TEN ARE DIRECTED TO AT THE RIGHT TIME: the seven questions outside QUALIFY_IDS each carry
// `unlocks`, one line naming what answering it adds to the holder's record — shown beside the question,
// never inside its [+], once a licence is bought or the trial qualifies (standing-section.mjs reads this
// field; the three guardrails carry no `unlocks`, their own line is GUARDRAIL_STEP_ONE_LINE).

// C1013d (operator 2026-10-18, /steer with a pasted analysis, verbatim: "You are asking for the marriage settlement
// (Q01: Walk away if) and the estate audit (Q02: Uncovered by policy) before they have even felt the safety harness
// click"): the frame above the three guardrails names what two minutes buys, each shown as a step of three rather
// than a question number, and the limit-and-halt sentence sits under step 1 — read before the preset rows.
// No "Insured", no "refund", no theory word above the first preset (checked by the guard).
export const GUARDRAIL_FRAME_HEADER = "Your agent's limits · 2 minutes";
// C1201 (operator 2026-10-22: "the explainability / sensemaking / clarity of the questions are dismal … the they have to hear, we
// have to say"): four cold readers on the old panel (revise @ 35 · 30 · 15 · 8) each asked first for one plain line, before any
// question, naming what the extension records and what skipping costs. This is that line; it sits under the header.
/** the lead names the holder's own repo: {repo} is filled at paint time (the readers' first ask, rounds 1–5: "point at my repo") */
export const leadFor = (repo) => GUARDRAIL_FRAME_LEAD.replace('{repo}', repo ? String(repo) : 'this repo');
export const GUARDRAIL_FRAME_LEAD = 'This extension keeps a free record, on your machine, of what your agent does in {repo} while you are away. The extension only watches: it never slows or stops your agent. Three answers give the record its limits: a spending limit, a never-run list, and a proof the work succeeded. Each gets a mark beside its box: ✓ once the record can check it, · until then. Skip them and the record still runs, with nothing to check it against. Answers save as you type, to .thetacog/deployer-playbook.json, and you can change them any time.';
// C1201: the cold readers read the seven hardening questions as a bait-and-switch ("nobody told me this was becoming a
// warranty"); this line names it above the first of the seven, wherever they are shown.
export const HARDENING_LEAD = 'The next seven set up a paid warranty, and matter only if you want one. The warranty covers our own act (a complete record, help that arrives on time), never your agent.';
export const GUARDRAIL_STEP_ONE_LINE = 'If you wire a stop of your own past this limit (a hook or a script), the record shows when it acted.';

/** the readiness line every surface prints: N of ten answered, how many your AI could still draft, and whether the three
 *  guardrails (QUALIFY_IDS) are answered — qualified is a gate, never a grade */
export function readiness(pb) {
  const answered = answeredCount(pb);
  const open = QUESTIONS.filter((q) => !isAnswered((pb && pb.answers && pb.answers[q.id])));
  const qualified = QUALIFY_IDS.every((id) => isAnswered(pb && pb.answers && pb.answers[id]));
  return { answered, of: QUESTIONS.length, aiCanDraft: open.filter((q) => q.draft === "ai").map((q) => q.id), onlyYou: open.filter((q) => q.draft === "you").map((q) => q.id), qualified };
}

/** C1013b — the frame's own line for the trial gate: progress toward the three guardrails, then what qualifying unlocks.
 *  Never the licence floor (TRIAL_PROPOSAL.floor stays the button's number, untouched here). */
export function qualifyLine(pb) {
  const n = QUALIFY_IDS.filter((id) => isAnswered(pb && pb.answers && pb.answers[id])).length;
  if (n >= QUALIFY_IDS.length) return `qualified · ${QUESTIONS.length - QUALIFY_IDS.length} hardening questions deepen your record`;
  return `answer ${n} of ${QUALIFY_IDS.length} guardrails to qualify for the warranty trial`;
}

/** the clipboard block for "Copy all ten + my answers": the lead, then each question, its teach line and the current answer */
export function copyAllText(pb, { key = null } = {}) {
  const a = (pb && pb.answers) || {};
  const one = (q) => { const x = a[q.id] || {};
    const parts = [x.text && x.text.trim() ? x.text.trim() : '(no answer yet)'];
    if (x.choice) parts.push(`choice: ${x.choice}`); if (x.slider != null && q.slider) parts.push(`${q.slider.label}: ${x.slider} ${q.slider.unit}`);
    if (x.numbers && q.numbers) parts.push(q.numbers.map((n) => `${n.label}: ${x.numbers[n.id] ?? '?'} ${n.unit}`).join(' · '));
    return `${q.n}. ${q.title}\nQ: ${q.ask}\nWhat the tape can and cannot measure: ${q.teach}\nAnswer shape: ${q.fill}\nMy answer: ${parts.join(' · ')}`; };
  const body = [COPY_ALL_LEAD, '', ...QUESTIONS.map(one).join('\n\n').split('\n')];
  return (key ? [...body, '', key] : body).join('\n');
}

/** C921j — the paste-back half of the loop: Claude's reply (ten lines "1. …" … "10. …") → { id: text } for the boxes. Lines that are not
 *  "<n>. <text>" with n in 1..10 are ignored; an empty answer line is skipped, never written as a blank over what the holder has. */
export function parseCleanedAnswers(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*\**\s*(\d{1,2})\s*[.)]\s*\**\s*(.*\S)\s*$/.exec(line); if (!m) continue;
    const q = QUESTIONS.find((x) => x.n === Number(m[1])); if (!q || out[q.id] !== undefined) continue;
    if (/^\(?(skip|skipped|n\/a|—|-)\)?\.?$/i.test(m[2].trim())) continue;   // C921r: an explicit skip leaves the box as it is
    out[q.id] = m[2];
  }
  return out;
}

/** C921q — the PRICING KEY the copy-all carries (operator 2026-10-17: "that survey is the demand signal - the false door - advise the user to
 *  buy x licenses towards their settings (how many licenses should I buy for this?) an llm can answer that (because you put the metric
 *  estimates / key into the pastable"). Read off the Stripe price record (data/vna/notary-price.json), never typed: the money per licence,
 *  the credits it carries, and what one credit pays for (the notary gateway: one credit per newly notarised receipt, a replay free). */
export function licenceKey(priceReceipt) {
  const p = priceReceipt && priceReceipt.price;
  if (!p || !Number.isFinite(Number(p.unit_amount))) return 'PRICING KEY: UNMEASURED — no licence price on record.';
  const usd = (Number(p.unit_amount) / 100).toFixed(Number(p.unit_amount) % 100 ? 2 : 0);
  const credits = Number(p.metadata && p.metadata.credits_per_unit);
  const at = String(priceReceipt.at || '').slice(0, 10);
  return [
    'PRICING KEY (read from Stripe' + (at ? ' on ' + at : '') + '):',
    '- One licence: $' + usd + (Number.isFinite(credits) ? ', ' + credits.toLocaleString('en-US') + ' credits' : '') + '.',
    '- One credit pays for one newly notarised receipt (one countersigned batch of your tape); a replay of a receipt already notarised is free.',
    '- Licences needed ≈ (receipts your agent writes per day × days until your stop date) ÷ credits per licence, rounded up; measuring stays free (L0).',
    '- L2 (prepaid expert hours) and L3 (prepaid compute) carry no price yet; size those as UNMEASURED.',
  ].join('\n');
}
