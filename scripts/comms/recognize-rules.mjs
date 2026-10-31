// scripts/comms/recognize-rules.mjs — C1313a THE ONE PLACE THE /recognize PROMPT AND RULE SET LIVE. Operator 2026-10-25, verbatim: *"the
// skill should auto update a sheet with the research results, move to logs etc, write out the full prompt / rule set"*. Pure data, no
// imports: recognize.mjs builds the prompt file from it, board-rules-row.mjs puts the rules on row 1 and the Rules tab of the sheet, and
// the skill points here. Edit a rule here and every surface moves with it (CLAUDE.md: one rule lives in one place).
// @guard tests/comms/c1313-recognize.test.mjs

// OUR SENTENCES — the intents the walk reads their words against. Quoted from the rules, never paraphrased (CLAUDE.md AXIOM 1 paired
// sentence; voice-and-pitch.md the cause-blind count and the insurability line).
export const OURS = [
  { id: 'rice-dpi-record', text: 'Whether it was good is undecidable (Rice, 1953). What it actually did cannot be reconstructed from its own account (the data processing inequality). The only remaining move is to read a record the actor did not write.' },
  { id: 'cause-blind-count', text: 'A hidden trigger, a prompt injection, a hallucination and a vendor token bias all produce the same boundary crossing and the same tick, so you never have to win the attribution argument to count the event.' },
  { id: 'semantic-not-insurable', text: "If it's debatable it's semantic, and semantic isn't insurable, because no underwriter writes a policy whose trigger is settled by argument." },
];

export const RULES = [
  ['R1', 'A quote is a lead until its fetched source holds the words, every "..." segment in order. A paraphrase is replaced by the real words copied from the source, never typed.'],
  ['R2', 'The strong judge sets the rank (operator 2026-10-25: "rank by the strong, then the surprise of how the rust agrees or not"); unjudged rows follow by σ. The walk reads the highest σ over our three sentences as its own order, and SURPRISE (walk rank minus judge rank) is the second ranked list. NEAR is σ ≥ 2 with off-lane ≤ 25 %; WEAK is σ > 0; NO FIT is at or below the null. Off-lane % alone never ranks (a bakery blurb read 13 %).'],
  ['R3', 'Harvest anyone who CREATES THE DEMAND (operator 2026-10-25: "what makes them the perfect opportunities ... they\'ve created a demand. They\'ve created a white space so maybe they agreed with us. Maybe they don\'t"): a person who names an unmet need around verifying, auditing, insuring or trusting what an agent actually did — agreeing, disagreeing, fatalist or adjacent. Capture the white-space sentence in their words.'],
  ['R4', 'The read-back order: their exact words; the one thing in them we recognize, in their field\'s terms; the step their sentence points at and has not taken (a record the actor did not write, read at the boundary); a check they run themselves; one ask.'],
  ['R5', 'Never containment, prevent, guarantee, or a gate that stops the agent as ours. We make the crossing countable: detected, placed, priced, dispatched. The halt is theirs to wire.'],
  ['R6', '"Hardware" means an address in a finite lattice. Never metal, enclave, silicon or a raw counter as our claim.'],
  ['R7', 'Need-to-know: no patent or filing status, ever. The mechanism is shown and they draw the line.'],
  ['R8', 'The security role is never named as the buyer. Underwriting is the money side; the researcher is the recognition side.'],
  ['R9', 'Nothing is sent from here. A draft is armed only by moving it to approved/ through the comms pipeline (≥ 95 per need); an address comes only from /prospect (MX first, stamped INFERRED).'],
  ['R10', 'The ledger is append-only. A finished row (replied, dead, rejected) moves to the Log tab with its reason and is never deleted. Every ledger write refreshes this sheet.'],
  ['R11', 'The search is a loop, the model harvests and the walk ranks: every NEAR row seeds the next round with its associates (co-authors, co-speakers, panel mates, who they cite and who cites them) and with what that person is saying now (their last 90 days). A round is judged by its NEAR yield (recognize.mjs yield), never by how many names it found.'],
  ['R12', 'Two graders, never mixed: the strong model judge (thorough, Opus pinned, one batched call per pass) sets the order, and the walk\'s σ (fast, LLM-free) is its own order beside it. The judge never alters σ. Every pass appends their agreement (rank correlation, top-k overlap, the named disagreements, time per row) so whether the fast match holds or degrades is a measured series.'],
  ['R13', 'Opportunity ranks first: the judge scores DEMAND (how sharply their words name a need we fill, 0–100) and names the WHITE SPACE in one sentence; the order is demand, then fit, then σ. Agreement is not the measure — a fatalist who declares verification impossible can open more space than an ally.'],
];

export const STATES = ['UNVERIFIED', 'VERBATIM', 'PARAPHRASE', 'SENT', 'REPLIED', 'DEAD', 'REJECTED'];
export const TERMINAL = new Set(['REPLIED', 'DEAD', 'REJECTED']);   // these leave the main grid for the Log tab

// The research prompt a harvest run is given (a subagent, a claude -p shell, or a person). Its output is the ingest file.
export const HARVEST_PROMPT = `You are harvesting the shortest translation distance: named people who have ALREADY written our sentence in their own field's words, so nobody has to argue them into the premise.

Find people who CREATE THE DEMAND: researchers, security architects, systems engineers, policy people, insurers and underwriters who, in a talk, paper, post, podcast or interview, name an unmet need around verifying, auditing, insuring or trusting what an AI agent actually did. Every stance counts — they may agree with us, disagree, declare it impossible, or be one field over. Examples of the white space:
  - "we have no way to verify" / "no one can audit" / "we can't insure this" / "verification is the bottleneck";
  - Rice's theorem or the halting problem used to say a filter or an LLM judge cannot decide safety;
  - attestation that must not ask the workload whether it behaved; a record that has to come from outside;
  - a payout or trigger that should rest on a verifiable event, not an argument.
For each, copy the white-space sentence itself — the line where they name the need.

For every candidate: fetch the primary source (talk page, transcript, paper, article). Copy the words exactly from the fetched text; never type a quote from memory or from a summary. Save the fetched text to <outdir>/<n>.txt with the URL on line 1. When a lead you were given turns out paraphrased, copy the real sentence(s) into "real".

Write <outdir>/results.json:
{ "quotes": [ { "who": "First Last", "role": "…", "org": "…", "quote": "the words as you found them, with ... between non-adjacent segments", "url": "https://…", "at": "mm:ss or section", "source_file": "<outdir>/<n>.txt", "real": "only when the lead was a paraphrase" } ] }

Fields beyond those: "said" (the date the words were said or published, YYYY-MM-DD), "kind" (cold | associate | now), "seed_of" (the ledger id of the NEAR row that led you here, for associate and now). Put "round": <n> at the top level of results.json.

Then run: node scripts/comms/recognize.mjs ingest <outdir>/results.json
It adds each quote, verifies it against its source file, re-ranks by σ on the one walk and rewrites the sheet. A quote whose words are not in its source stays UNVERIFIED and carries no message.`;

// The next round's brief, built from the ledger by recognize.mjs next: the NEAR rows are the seeds.
export const NEXT_ROUND = (seeds, round) => `ROUND ${round} — the seeds are the people whose words landed NEAR ours on the walk. For each seed:
  (a) ASSOCIATES: find their co-authors, co-speakers, panel mates, the people they cite and the people who cite them, and test each for the same sentence (kind "associate", seed_of = the seed's id);
  (b) NOW: find what the seed has said in the last 90 days (posts, talks, papers, interviews); a fresher quote on the same thread is the hook for the read-back (kind "now", seed_of = the seed's id).
Seeds:
${seeds.map((s) => `  - ${s.id} · ${s.who}${s.org ? ` (${s.org})` : ''} · σ ${s.sigma} · their words: "${String(s.words || s.quote).slice(0, 160)}"`).join('\n') || '  (none NEAR yet — run a cold round with the harvest prompt)'}
Follow the harvest prompt for fetching, saving and the results.json shape, with "round": ${round}.`;

// THE THOROUGH GRADER (C1313c). One batched call grades every live row against our sentences; the walk never sees this and the
// judge never sees σ, so the two readings stay independent and their agreement means something.
export const JUDGE_MODEL = 'opus';
export const JUDGE_PROMPT = (rows, ours) => `You grade translation distance: how far a person's own published words are from our sentences, i.e. how many steps of argument it would take for them to agree with ours. You do not see any other grader's score. Grade each row independently.

OUR SENTENCES:
${ours.map((o) => `  [${o.id}] ${o.text}`).join('\n')}

For each row, return:
  score 0-100 — FIT: 100 = their words already state one of ours in their field's terms; 70 = one step away (they hold the premise, not yet the conclusion); 40 = adjacent field, two or more steps; 10 = shares vocabulary only; 0 = unrelated.
  demand 0-100 — DEMAND: how sharply their words name an unmet need that our sentences fill, whether or not they agree with us (100 = they name the exact gap and say it is unsolved; 50 = they gesture at it; 0 = no need named). A fatalist who says it cannot be verified can score high.
  white_space — the need they name, in one sentence, in their own terms.
  stance — agrees | disagrees | fatalist | adjacent.
  steps — integer, the number of argument steps from their words to the nearest of ours.
  recognizes — the id of our nearest sentence, or "none".
  why — one sentence naming what in THEIR words carries the match, or what is missing.

ROWS:
${rows.map((r) => `  {"id": "${r.id}", "who": ${JSON.stringify(r.who)}, "words": ${JSON.stringify(r.words || r.quote)}}`).join('\n')}

Answer with ONLY a JSON array, one object per row, in this shape: [{"id": "...", "score": 0, "demand": 0, "white_space": "...", "stance": "...", "steps": 0, "recognizes": "...", "why": "..."}]`;

// THE TINY MODEL CALLS THE RANKING (C1344). Operator 2026-10-26, verbatim: "Can the small model be used to call shots on ranking?"
// The local model predicts the strong judge's demand order and each row's band BEFORE the strong judge's answer for the same batch
// is called or read — the prediction lands first, so the strong judge can never leak back into it.
export const SHOT_RANK_PROMPT = (rows) => `You predict how a thorough grader will rank these rows by DEMAND — how sharply each person's words name an unmet need around verifying, auditing, insuring or trusting what an AI agent actually did. You have not seen the thorough grader's answer yet; call your own shot.

ROWS:
${rows.map((r) => `  {"id": "${r.id}", "who": ${JSON.stringify(r.who)}, "words": ${JSON.stringify(r.words || r.quote)}}`).join('\n')}

Order every row from highest predicted demand to lowest, and name each row's predicted band: HIGH (demand 70 or over), MED (40-69), LOW (under 40).
Answer with ONLY a JSON array, highest predicted demand first: [{"id": "...", "band": "HIGH|MED|LOW"}]`;

// THE TINY MODEL CALLS THE DISTANCE (C1345). Operator 2026-10-26, verbatim: "Can it be used to call shots on distance?" The local
// model predicts, BEFORE the walk ever runs on these rows, how near each one lands: its band (NEAR or FAR), which of our three
// sentences it lands nearest (one in three by chance), and the argument steps between the two — call your own shot before the
// walk or the strong judge can leak into it.
export const SHOT_DISTANCE_PROMPT = (rows, ours) => `You predict how near each person's own words land to ours, before any grader has measured it. You have not seen the walk's reading or the thorough grader's steps; call your own shot.

OUR SENTENCES:
${ours.map((o) => `  ${o.id}: "${o.text}"`).join('\n')}

ROWS:
${rows.map((r) => `  {"id": "${r.id}", "who": ${JSON.stringify(r.who)}, "words": ${JSON.stringify(r.words || r.quote)}}`).join('\n')}

For each row, predict: band — NEAR (one argument step or fewer from one of our sentences) or FAR (two steps or more); sentence — the id of the ONE of our sentences it lands nearest; steps — your best integer guess of the number of argument steps from their words to that sentence.
Answer with ONLY a JSON array: [{"id": "...", "band": "NEAR|FAR", "sentence": "...", "steps": 0}]`;

// THE REFINE JUDGE (C1325). One row, one call: how well a read-back draft holds their words as fidelity and quality, never how near the
// draft sits to our sentences (that is the walk's job, with the roles reversed from JUDGE_PROMPT — their words are the intent here).
export const REFINE_JUDGE_PROMPT = (id, who, words, draft) => `You grade one read-back draft for fidelity and quality. You do not see the walk's score. Grade this one row only.

THEIR WORDS (the row's intent — the draft must quote them, never paraphrase):
  ${JSON.stringify(words)}

THE DRAFT (sent to ${who}):
${draft}

Return ONLY a JSON array with one object:
  score 0-100 — 100 = quotes their words verbatim, recognizes the right thing in their own terms, one clean ask, no overreach; 70 = close but loose on one count; 40 = the right idea, wrong words or framing; 0 = misquotes them or oversells.
  why — one sentence naming what holds the score up or down.

Answer with ONLY: [{"id": "${id}", "score": 0, "why": "..."}]`;

export const READBACK_PROMPT = `Write the read-back for one VERIFIED row, under the --- rule of its draft frame (node scripts/comms/recognize.mjs draft <id>).

Steelman first: the person has already paid the whole cost of the argument. Agree with their sentence at full strength, in their terms, and never tell them they are wrong about any of it.
Then, in this order, one short paragraph each:
  1. Their words, quoted exactly, and the one thing in them we recognize.
  2. What their sentence lets them do next that it does not yet do: read a record the agent did not write, counted at the boundary. Their sentence closes the decision (Rice); the second half is recovery (an account produced by the process cannot contain what it displaced).
  3. A check they run themselves on their own machine; the data never leaves it.
  4. One ask, one question mark.
Then: node scripts/comms/recognize.mjs check <id>. It refuses a misquote, a banned promise, or more than one ask.`;

// The sheet's row-1 line (board-rules-row.mjs SHEET_RULES): what it answers, then the numbered rules.
export const SHEET_RULE_LINE = `who already wrote our sentence, nearest by σ first · ${RULES.map(([k, t]) => `${k} ${t.split('. ')[0].replace(/\.$/, '')}`).join(' · ')}`;

export function promptFile() {
  return [
    '/recognize — THE FULL PROMPT AND RULE SET (generated from scripts/comms/recognize-rules.mjs; edit there, never here)',
    '', '== THE RULES ==', ...RULES.map(([k, t]) => `${k}  ${t}`),
    '', '== OUR SENTENCES (the intents the walk reads their words against) ==', ...OURS.map((o) => `${o.id}: ${o.text}`),
    '', '== THE HARVEST PROMPT ==', HARVEST_PROMPT,
    '', '== THE NEXT ROUND (generated per round: node scripts/comms/recognize.mjs next) ==', NEXT_ROUND([], 'n'),
    '', `== THE JUDGE PROMPT (model ${JUDGE_MODEL}, one batched call: node scripts/comms/recognize.mjs judge) ==`, JUDGE_PROMPT([{ id: '<id>', who: '<who>', quote: '<their words>' }], OURS),
    '', '== THE READ-BACK PROMPT ==', READBACK_PROMPT, '',
  ].join('\n');
}
