// scripts/lib/six-percentages.mjs — THE SIX PERCENTAGES AS MEASUREMENTS, RATCHETED.
//
// Operator 2026-09-12: "Build this into roles and hats and ratchet applying them … make better ones
// sorted into the six percentages … tripwires to check; brevity is one." Source spec: the 24-rule
// "Six Percentages Operational Test Suite" (L27–L40, S12–S21). What survived triage here is every
// rule whose CONSTRUCT can be computed from the artifact's own text — never a token standing in for
// it (CLAUDE.md, THE PROXY IS NOT THE THING). Judgment rules (S12 concrete-first, S15 floating
// metaphor, S17 independent arithmetic, S21 closed circuit, L37 lab parroting) are HAT lines in
// docs/architecture/claude-rules/six-percentages.md and are REPORTED here where a count exists,
// never failed on.
//
// THE RATCHET (the /shoot-ratchet shape): every check has a direction and an ideal. The FLOOR is the
// best value an artifact of that class has actually reached (data/six-percentages-floors.json). A
// check FAILS only when the artifact is WORSE than the floor. `--ratchet` raises the floor when the
// artifact beats it; a floor never falls. Nothing goes red on the day a check is born; anything that
// regresses after does. Ideal is frozen in code; floor moves; the gap between them is the to-do.
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export const TEXT = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&rsquo;/g, '’').replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const sentences = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z"“])/).map((x) => x.trim()).filter((x) => words(x) >= 3);
const count = (s, re) => (s.match(re) || []).length;

// THE DETERMINISM TRIGGER, as a construct: the sentence the reader will hear THIS WEEK that names
// "deterministic", sitting before the quote it arms them against. Three guards used to find it by the
// token "going to try to" — one wording of it — and froze that wording; the operator rewrote it on
// 2026-09-13 ("Your strongest engineer will defend your AI this week by calling it deterministic").
// One regex, exported, so L21, L22 and the callback-box lock cannot drift apart.
export const TRIGGER_RE = /this week[^.!?]{0,140}deterministic/i;

// THE BOOK KICKER, as a construct: the section label the renderer prints from the pin's own
// `chapter` field, "<label>: <title>". It is NOT always "Chapter <arabic>". Measured over the
// extractor's whole corpus on 2026-09-22 (`pick-passage.mjs --top 500`): 43 distinct labels under
// six heads — Chapter <n|i>, Appendix <A–Z>, Preface, Conclusion, Interlude, About the Author.
// WHY IT IS EXPORTED, and this is the whole lesson. The same construct was written out by hand in
// THREE places and they drifted apart, each one stopping at whatever the corpus happened to hold
// the day it was typed: the litmus had `Chapter (\d+|[ivxIVX]+): ` (widened once, 2026-09-21, when
// "Chapter i: The Ship" read as "no chapter kicker — the exhibit is missing"), regions() had the
// narrower `Chapter \d+: ` and was never widened at all, and render-email's seam() had a third
// spelling. On 2026-09-22 a Preface pin went red on L25/L26 and — silently, because L38 and S19
// only report — regions() returned an EMPTY exhibit, so L38's brevity ratio printed "5839 / 0" and
// nobody could have read that as a defect. A token for the construct passes until the day it does
// not. One regex, exported, exactly as TRIGGER_RE above. Guard: tests/comms/book-kicker-is-one-construct.test.mjs.
// SECTION_HEAD is the head alone — the label without the ": " that makes it a kicker. Every other
// spelling is COMPOSED from it, so widening the book (a new Appendix, a second roman chapter) is one
// edit here and not a hunt through four files that each stopped at a different day's corpus.
export const SECTION_HEAD = String.raw`Chapter (?:\d+|[ivxIVX]+)|Appendix(?: [A-Z])?|Preface|Conclusion|Interlude|About the Author`;
export const BOOK_KICKER = new RegExp(`(${SECTION_HEAD}): `);

// ── the newsletter's regions, by the kickers the layout already has (never by offset) ──
export function regions(text) {
  const mast = text.search(/Daily Book Club · \d{4}-\d{2}-\d{2}/);
  const chapter = text.search(BOOK_KICKER);
  const inter = text.indexOf('Intermission');
  const verdict = text.indexOf('The verdict');
  const precedent = text.indexOf('Every time a new measurement appeared');
  return {
    razor: text.slice(mast >= 0 ? mast : 0, chapter > 0 ? chapter : undefined),
    exhibit: chapter > 0 && inter > chapter ? text.slice(chapter, inter) : '',
    verdictBlock: verdict > 0 ? text.slice(verdict, precedent > verdict ? precedent : undefined) : '',
    close: text.slice(Math.floor(text.length * 0.85)),
    chapterAt: chapter,
  };
}

const SALT = /\b(it is (important|crucial) to (note|remember)|delicate dance|double-edged sword|rich tapestry|a testament to|at the intersection of|in today's (fast-paced|rapidly evolving)|navigating the (complex|ever-changing)|it'?s worth noting|game-?changer|paradigm shift)\b/gi;
// A STAPLE THE PROSE IS REFUSING IS NOT THE PROSE USING IT (2026-09-22). L36 fired on "paradigm
// shift" inside the book's own line — "That's NOT a paradigm shift pitch -- that's my last ten
// years" — which is the passage rejecting the staple, the opposite of the construct. Counting the
// string is the token standing in for the construct. Narrowed with the SAME negation window L33
// and S18 already use in this file (unrejectedEvals / unnegatedRice), never by tuning a threshold:
// a staple negated within the 80 chars before it is not counted. Seen red first — an un-negated
// "paradigm shift" still fails. Guard: tests/comms/salt-counts-use-not-refusal.test.mjs.
// 'in this email' alone matched the confirmed closer "The physics is not in this email" (pass 1, 2026-09-12) — the
// announcement construct is the phrase FOLLOWED by a subject about to do something: "in this email, we…".
const ANNOUNCE = /\b(below,? we|here is why|here's why|consider the following|in this (edition|issue|email|post),? (we|i|you)\b|today we (explore|look at|examine)|let'?s (break|dive|unpack)|without further ado|read on to)\b/gi;
const CONTEMPLATE = /(?:^|[.!?]\s+)(reflect|consider|understand|agree|believe|imagine|appreciate)\b/gi;
const EXECUTE = /\b(run|recompute|verify|fork|buy|send|reply|paste|open)\b/gi;
const LINE_ITEM = /\b(underwriter|insurer|General Counsel|audit committee|D&O|E&O|EU AI Act|personally liable|liable|logbook|premium|exclusion)\b/gi;
const BARE_CITE = /\b(studies show|research shows|scientists (say|found)|neuroscientists (found|say)|experts agree|it has been shown)\b/gi;
const PREFERENCE = /\b(acceptable drift|safe threshold|safety target|acceptable level of|tolerable drift)\b/gi;
const INTERNAL_EVAL = /\b(better guardrails|rigorous evals?|constitutional alignment|RLHF|red[- ]teaming alone)\b/gi;
const REJECT = /\b(cannot|can't|not|never|inside the boundary|self-authored|its own account|second (entry|ledger)|undecidable)\b/i;
const RICE = /\b(bug-free|provably safe|perfect(ly)? safe|guaranteed safe|cannot fail|zero risk)\b/gi;
const NEGATE = /\b(not|never|nobody|no one|undecidable|cannot|isn't|don't|do not|we have never)\b/i;
const MORAL = /\b(bad actors|malicious intent|trustworthy AI|responsible (deployment|AI)|AI safety culture)\b/gi;
const LAB = /\b(Frontier Model Forum|Responsible Scaling Policy|\bRSP\b|METR)\b/g;
// the assertion has a negative form too — "written afterwards, by the thing they are about" IS the second-entry
// claim (the record is authored by its subject, therefore not a witness); pass 1 missed it.
const SECOND_ENTRY = /(second (ledger|entry)|unauthored|out-of-band|did not (write|author)|does not get to write|actor did not|not produced by|record .{0,40}did not|(written|produced) .{0,40}by the thing (they are|it is) about)/i;
const LOGBOOK = /\b(npx thetacog-mcp|receipt|recompute|register|logbook)\b/i;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE / FIRST-TOUCH KIND (C242a, 2026-09-24). The operator pasted a Gemini read of the
// nominate invite v4 against TEST v3 (steer.txt 2026-09-24 10:35): Power 35 · Impact 45 ·
// Confidence 50 · Antiregression 20 · Antinormalisation 25 · Sufficiency 40. Every check above
// this line scored v4 and v3 the same on those six, because none of them computes what the read
// named: a MENU of competing calls to action, an install/run ask in a first touch, a "forward it to
// your engineer" escape hatch, an index in front of the close, and the six needs landing out of
// order. Each construct below COMPUTES the thing (parses anchors and buttons from the HTML, parses
// sentence-initial imperatives from the text, locates each need's beat), never a word standing in
// for it. Seen red on v4 (09978f8fa6), green on v3 (41297fcbf0 tester-invite) and on the repaired
// v5 (fd47f27878). Guard: tests/vna/c242a-the-dozen-see-the-regression.test.mjs.
//
// THE FRAMING RULE (operator 2026-09-24, verbatim: "so its not that including it is bad it is the
// framing" · "lead with the clear cta, the rest is reference material, never a cta"). A link is a
// call to action only when it is FRAMED as one — a styled button, or a label that is itself an
// imperative ("Flag them the same way"). A link with a noun label ("Pricing", "The VS Code
// extension") is reference, and reference placed after the close passes. So nothing here counts
// links as such; it counts asks, and it counts links that sit in front of the close.

// A call to action, as a construct: an imperative addressed to the reader. Sentence-initial, after
// an optional short colon label ("In a terminal: run …"), an optional conditional ("If yes, reply"),
// and an optional softener ("just reply"). "Reply-all reaches all three of us" is a statement — the
// (?!-) keeps the compound out. "hit reply" is the reply. The verb list is the operator's own
// (install / run / forward / start / click) plus the product's ordinary asks.
const ACTION_VERBS = ['reply', 'install', 'run', 'paste', 'forward', 'click', 'start', 'open', 'buy', 'send', 'fork', 'flag', 'read', 'sign', 'download', 'try', 'use', 'pick', 'join', 'subscribe', 'visit', 'book', 'share', 'pass', 'hit', 'tap', 'press'];
const ASK_RE = new RegExp(`^(?:[A-Za-z'’ ]{2,28}:\\s*)?(?:if [^,]{1,40},\\s*)?(?:just |please |then |or |and |simply )?(${ACTION_VERBS.join('|')})\\b(?!-)(?:\\s+(reply))?`, 'i');
const HOMEWORK = new Set(['install', 'run', 'paste', 'download', 'fork']);            // technical homework in a first touch
const HANDOFF = new Set(['forward', 'send', 'share', 'pass', 'flag']);               // verbs that can route the act to someone else
const THIRD_PARTY = /\b(engineer|team|colleague|lead|someone|cto|developer|them|a friend|your (people|staff))\b/i;
const FOOTER_HREF = /unsubscribe|^mailto:/i;                                         // the RFC 8058 door and the signature are not the pitch's CTA

/** Sentences with their word offsets, on the lib's own splitter. */
function sentenceSpans(text) {
  const out = []; let at = 0;
  for (const s of sentences(text)) { const n = words(s); out.push({ text: s, word: at, words: n }); at += n; }
  return out;
}

/** ctaCensus(text, html): every call to action with its kind, action key and word position. */
export function ctaCensus(text, html = '') {
  const spans = sentenceSpans(text);
  const total = words(text);
  const cta = [];
  for (const [i, s] of spans.entries()) {
    const m = ASK_RE.exec(s.text);
    if (!m) continue;
    const verb = m[1].toLowerCase();
    const key = verb === 'hit' && m[2] ? 'reply' : verb;
    if (verb === 'hit' && !m[2]) continue;
    cta.push({ kind: 'ask', key, verb: key, word: s.word, sentence: i, text: s.text.slice(0, 80) });
  }
  const labelledVerb = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1]; if (FOOTER_HREF.test(href)) continue;
    const label = TEXT(m[2]);
    const first = (label.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
    const styled = /display:inline-block/.test(m[0]);
    const imperative = ACTION_VERBS.includes(first);
    if (!styled && !imperative) continue;                                         // a noun-labelled link is reference
    const word = words(TEXT(html.slice(0, m.index)));
    const key = imperative ? first : `button:${href}`;
    if (imperative) labelledVerb.add(first);
    cta.push({ kind: styled ? 'button' : 'link', key, verb: imperative ? first : null, href, word, label });
  }
  // an ask whose verb is the button's own label ("Start my briefing →" read as a sentence) is that button, once
  const rows = cta.filter((c) => !(c.kind === 'ask' && labelledVerb.has(c.verb))).sort((a, b) => a.word - b.word);
  const distinct = [...new Set(rows.map((c) => c.key))];
  return { rows, distinct, total, spans };
}

// THE SIX NEEDS, IN THE ORDER THEY MUST LAND (operator 2026-09-24, verbatim: "the six needs sequnce
// is not just priority, its the order the points need to land for any cta" · "before theres
// connection, the contribution wont stick, etc" · "before theres growth, there must be a seeded
// contributeion"). The order is the repo's, read from docs/architecture/claude-rules/voice-and-pitch.md
// (lines 10 and 238) and scripts/blog/mdx-cook-check.sh (S8 line 116, C10 line 479): Connection →
// Contribution → Growth → Uncertainty → Certainty → Significance. A dependency chain, not a ranking.
export const NEED_ORDER = ['connection', 'contribution', 'growth', 'uncertainty', 'certainty', 'significance'];

// THE PER-NEED LOCATOR. The repo's only per-need locator (scripts/comms/canonical-template-check.mjs)
// reads the need's NAME in a header; an invite carries the needs as an unnamed spine, so it has
// nothing to read. This one locates each need's BEAT — the phrase family the repo's own authors
// declared for that need in this artifact class — and reports the first sentence where it lands.
// Provenance, per need (quoted so the lexicon is the declaration and not a tuning):
//   connection    — "who sent it, and because of what … in the second person" (invite-email.ts e22c65ebf9 + fd47f27878; mdx-cook-check S1)
//   contribution  — "a concrete thing SEEDED (handed over)" (operator) · "your honest read" (fd47f27878) · "tester licences on your
//                   address, no card" (tester-invite v2) · "forward it, flag someone, the free measurement, the briefing" (e22c65ebf9)
//   growth        — "agents × tasks, both compounding" (both invites) · "capacity that compounds" (canonical-axes Engine) ·
//                   "stops re-reading the whole chat every turn … most of the bill" (tester-invite v2)
//   uncertainty   — "the employee who wrote their own log; the what-if" · "the self-written log" (both invites)
//   certainty     — "the record the agent did not write; the proof; what is proven and what is not; the check" (both invites)
//   significance  — "the question lands on whoever signs for the risk: you" (fd47f27878) · "That record is yours" (tester-invite v2) ·
//                   "who the READER becomes" (voice-and-pitch.md:238)
// It is the TEXT-SIDE reading. The lattice-side reading (C242d) walks the same chunks through the
// one Rust pipeline; this export is what it compares against. Where the two disagree, the lattice wins.
const NEED_BEAT = {
  connection: (s) => /\b(you|your)\b/i.test(s) && /\b(flagged|signed (you )?up|sent you|thought of you|picked|thanks|hi |hello|because)\b/i.test(s),
  contribution: (s) => /(licences? on your address|no card|on me\b|free licences|i'?ll put|want back|honest read|in return|that'?s the ask|give away the ruler|the measurement is free|forward this|flag (them|someone)|start the briefing)/i.test(s),
  growth: (s) => /(compound|grows? (every|faster|with)|more agents|each agent takes more|scal(e|ing)\b|stops re-reading|most of the bill)/i.test(s),
  uncertainty: (s) => /(wrote (their|its) own (audit )?log|story (it|each agent|the assistant) wrote about itself|what if\b|blind spot|undecidable|the fog|nobody can really say)/i.test(s),
  certainty: (s) => /(record the (agent|assistant) (did not|didn'?t) write|signed (record|receipt|placement|ledger)|re-run|proven:|same result|fails verification|attest-demo|\bnpx\b)/i.test(s),
  significance: (s) => /(lands on whoever signs|whoever signs for the risk|why this came to you|that record is yours|yours are on me|risk is yours to manage|who you become)/i.test(s),
};

/** needLandings(text): per need, the first sentence where its beat lands — { need, sentence, word, text } or sentence -1 when it never does. */
export function needLandings(text) {
  const spans = sentenceSpans(text);
  return NEED_ORDER.map((need) => {
    const i = spans.findIndex((s) => NEED_BEAT[need](s.text));
    return i < 0 ? { need, sentence: -1, word: -1, text: '' } : { need, sentence: i, word: spans[i].word, text: spans[i].text.slice(0, 80) };
  });
}

/** The invite kind's own checks. C is the row constructor from measure(). */
function inviteChecks(text, html, C) {
  const { rows, distinct, total } = ctaCensus(text, html);
  const landings = needLandings(text);
  const first = rows[0] || null;
  const close = rows.length ? rows[rows.length - 1] : null;
  const lastNeed = Math.max(...landings.map((l) => l.word));
  const missing = landings.filter((l) => l.sentence < 0).length;
  let inversions = missing;
  for (let i = 1; i < landings.length; i++) {
    const a = landings[i - 1], b = landings[i];
    if (a.sentence >= 0 && b.sentence >= 0 && b.sentence < a.sentence) inversions++;
  }
  // THE LEAD IS THE CLOSE (operator: "lead with the clear cta"; coordinator: "every CTA sits AFTER the last need
  // lands"). Both hold at once only when the door opened early is the SAME door the email ends on: every ask
  // that precedes the last need's landing is the closing action restated, and the close itself comes after
  // the last need. Any OTHER action asked before the needs have landed is the regression.
  const closeAfterNeeds = !!close && missing === 0 && close.word >= lastNeed;
  const strangersBefore = close ? rows.filter((c) => c.word < lastNeed && c.key !== close.key).length : rows.length;
  const linksBeforeClose = close ? [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].filter((m) => !FOOTER_HREF.test(m[1]) && words(TEXT(html.slice(0, m.index))) < close.word).length
    : [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].filter((m) => !FOOTER_HREF.test(m[1])).length;
  const referenceAfter = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].filter((m) => !FOOTER_HREF.test(m[1])).length - linksBeforeClose;
  const homework = rows.filter((c) => c.kind === 'ask' && HOMEWORK.has(c.verb)).length;
  const hatches = rows.filter((c) => c.verb && HANDOFF.has(c.verb) && THIRD_PARTY.test(c.text || c.label || '')).length;
  const lead40 = text.split(/\s+/).slice(0, 40).join(' ');
  const peerInLead = NEED_BEAT.connection(lead40) ? 1 : 0;
  const landed = landings.map((l) => `${l.need.slice(0, 4)}@${l.sentence}`).join(' ');
  return [
    C('I1', 'predictive', 'one door — distinct calls to action (buttons + imperative asks + imperative-labelled links)', distinct.length, 1, 'min', 'actions', distinct.join(' · ')),
    C('I7', 'impact', 'the lead is the ask — words before the first call to action, as a fraction of the text', first ? Number((first.word / Math.max(1, total)).toFixed(2)) : 1, 0.25, 'min', 'of text', first ? `${first.word} / ${total} · ${first.key}` : 'no call to action'),
    C('I8', 'impact', 'the peer frame lands in the first 40 words (who flagged you, in the second person)', peerInLead, 1, 'max', 'present', lead40.slice(0, 70)),
    C('I2', 'confidence', 'links in front of the close (reference after the close is allowed)', linksBeforeClose, 0, 'min', 'links', close ? `close = ${close.key} @ word ${close.word}` : 'no close'),
    C('I2b', 'confidence', 'reference links after the close (report — allowed when framed as reference)', referenceAfter, 0, 'report', 'links'),
    C('I3', 'anti-regression', 'homework in a first touch — install / run / paste / download / fork asked of the reader', homework, 0, 'min', 'asks', rows.filter((c) => c.kind === 'ask' && HOMEWORK.has(c.verb)).map((c) => c.verb).join(' · ')),
    C('I6', 'anti-normalisation', 'escape hatches — an ask that routes the act to a third party (forward it to your engineer)', hatches, 0, 'min', 'asks'),
    C('I4', 'sufficiency', 'the six needs land in order (connection → contribution → growth → uncertainty → certainty → significance)', inversions, 0, 'min', 'inversions', `${landed}${missing ? ` · ${missing} never land` : ''}`),
    C('I5', 'sufficiency', 'the close is the one door, after the last need lands; every earlier ask is that same door', closeAfterNeeds && strangersBefore === 0 ? 1 : 0, 1, 'max', 'holds', close ? `close ${close.key} @ ${close.word} · last need @ ${lastNeed} · ${strangersBefore} other asks before it` : 'no close'),
  ];
}

/** The kind a path is measured as — the one map every consumer reads (C242b calls measureOutward). */
export function kindForPath(path = '') {
  const p = String(path).replace(/\\/g, '/');
  if (/invite-email\.tsx?$|\/drafts\/.*invite|\/nominate\/|first-touch/i.test(p)) return 'invite';
  if (/\.mdx?$/i.test(p) && /\/blog\//i.test(p)) return 'post';
  if (/bookclub|newsletter/i.test(p) && /\.html?$/i.test(p)) return 'newsletter';
  return 'post';
}

/** A check: { id, pct, name, value, ideal, dir ('min'|'max'), unit, detail } — dir is the direction of BETTER. */
export function measure(text, { html = '', kind = 'newsletter' } = {}) {
  const r = regions(text);
  const sents = sentences(text);
  const lens = sents.map(words);
  let flat = 0;
  for (let i = 2; i < lens.length; i++) if (Math.abs(lens[i] - lens[i - 1]) <= 3 && Math.abs(lens[i - 1] - lens[i - 2]) <= 3) flat++;
  const openerSrc = kind === 'newsletter' ? r.razor.replace(/^.*?Daily Book Club · \d{4}-\d{2}-\d{2}\s*/, '') : text;
  const opener = sentences(openerSrc)[0] || '';
  // S19 measures redundancy INSIDE a run of prose, never across the layout. Measured 2026-09-13 on the
  // ch12 "The Second Theorem" send: the passage alone gzipped at 2.40:1, the fixed spine alone at 2.44:1
  // (= the live floor), and the composite at 2.53:1 — red. The excess was cross-region: the Signal, the
  // ask and the LLM prompt restate the passage's thesis by design, and gzip counts a thesis stated in the
  // spine and paid off in the exhibit as one repetition. A composite ratio therefore goes red precisely
  // when the day's passage is ON thesis, which is the opposite of the construct (slop, filler, a passage
  // saying the same thing three ways). So: per layout region, take the worst. A post has no layout —
  // the whole text is one region. Regions shorter than 400 chars are skipped: gzip's dictionary has
  // nothing to work with and reports ~1.3:1 for any prose, which would hide a genuinely redundant exhibit
  // behind a short razor.
  const gzOf = (t) => { const b = Buffer.from(t, 'utf8'); return b.length / Math.max(1, gzipSync(b).length); };
  const gzRegions = kind === 'newsletter'
    ? [r.razor, r.exhibit, r.verdictBlock, r.close].filter((t) => t && t.length >= 400).map(gzOf)
    : [];
  const gz = gzRegions.length ? Math.max(...gzRegions) : gzOf(text);
  const buttons = kind === 'newsletter' && html ? count(html.slice(html.indexOf('The verdict') > 0 ? html.indexOf('The verdict') : 0, html.indexOf('Every time a new measurement') > 0 ? html.indexOf('Every time a new measurement') : undefined), /display:inline-block;background:#e0b040/g) : null;
  const unrejectedEvals = [...text.matchAll(INTERNAL_EVAL)].filter((m) => !REJECT.test(text.slice(m.index, m.index + 300))).length;
  const unnegatedRice = [...text.matchAll(RICE)].filter((m) => !NEGATE.test(text.slice(Math.max(0, m.index - 80), m.index))).length;
  const unnegatedSalt = [...text.matchAll(SALT)].filter((m) => !NEGATE.test(text.slice(Math.max(0, m.index - 80), m.index))).length;
  // L34: per kicker-delimited section (uppercase kickers are short ALL-CAPS-ish runs in the html; on text we split on the layout's own kickers)
  const sections = text.split(/(?=Send this to the next person|The question underneath|The long version of the blade|So here is the second ledger|Forty seconds|The verdict|Every time a new measurement|Two arguments we want broken|The summary, as a coordinate|What nobody is checking|Ask the model that already knows you|hot in the last 14 days|The Signal — who started|Send a key|We published three of our own bugs)/);
  const auditSections = sections.filter((s) => /\b(audit|logs?|oversight)\b/i.test(s));
  const noSecondEntry = auditSections.filter((s) => !SECOND_ENTRY.test(s)).length;

  const C = (id, pct, name, value, ideal, dir, unit = '', detail = '') => ({ id, pct, name, value, ideal, dir, unit, detail });
  const out = [
    // 1 · PREDICTIVE POWER
    C('L27', 'predictive', 'razor horizon — first sentence ≤22 words, no throat-clearing', words(opener) + (ANNOUNCE.test(opener) ? 100 : 0), 22, 'min', 'words', opener.slice(0, 90)),
    C('L28', 'predictive', 'structural announcements', count(text, ANNOUNCE), 0, 'min', 'phrases'),
    // L29 as specified ("three consecutive sentences within ±3 words fails") flagged deliberate anaphora ("The
    // signature is not the contract. The reconciliation is the contract.") and the book's own Pacioli passage
    // on pass 2 — the device, not the fatigue. The construct is SPREAD: sentence-length standard deviation,
    // ratcheted upward. The flat-run count stays as a report so the eye can find monotony when it is real.
    C('L29', 'predictive', 'cadence spread — sentence-length standard deviation', Number(Math.sqrt(lens.reduce((a, l) => a + (l - lens.reduce((x, y) => x + y, 0) / lens.length) ** 2, 0) / Math.max(1, lens.length)).toFixed(1)), 9, 'max', 'σ words', `${sents.length} sentences`),
    C('L29b', 'predictive', 'flat runs — 3 consecutive sentences within ±3 words (report; often the device)', flat, 0, 'report', 'runs'),
    // 2 · IMPACT
    C('L30', 'impact', 'cold handle — contemplation imperatives in the verdict', kind === 'newsletter' ? count(r.verdictBlock, CONTEMPLATE) : count(r.close, CONTEMPLATE), 0, 'min', 'verbs'),
    C('L30b', 'impact', 'cold handle — execution imperatives in the verdict', kind === 'newsletter' ? count(r.verdictBlock, EXECUTE) : count(r.close, EXECUTE), 1, 'max', 'verbs'),
    ...(buttons === null ? [] : [C('L31', 'impact', 'single door — styled buttons in the verdict', buttons, 1, 'exact', 'buttons')]),
    C('L32', 'impact', 'line-item landing — named exposure/role in razor+verdict', count(r.razor + ' ' + r.verdictBlock, LINE_ITEM), 1, 'max', 'names'),
    // 3 · CONFIDENCE
    C('S14', 'confidence', 'bare citations ("studies show")', count(text, BARE_CITE), 0, 'min', 'phrases'),
    C('S16', 'confidence', 'preference dressed as a unit ("acceptable drift")', count(text, PREFERENCE), 0, 'min', 'phrases'),
    C('S14b', 'confidence', 'dated moorings — Name + year pairs', count(text, /\b[A-Z][a-z]+(?:[ -][A-Z][a-z]+)*,? (?:\(?(?:19|20)\d\d\)?)/g), 3, 'max', 'citations'),
    // 4 · ANTI-REGRESSION
    C('L33', 'anti-regression', 'internal-eval claims left unrejected within 300 chars', unrejectedEvals, 0, 'min', 'claims'),
    // L34 is the Tactician×Counsel HAT's (the spec says so): on pass 2 both remaining hits were a QUOTED hostile
    // objection and our click-log housekeeping, while The Signal section made the second-entry argument in
    // other words. A checker cannot tell a claim from a quotation of one. Reported, never failed.
    C('L34', 'anti-regression', 'audit/log/oversight sections with no second-entry phrase (report — hat judges)', noSecondEntry, 0, 'report', 'sections', `${auditSections.length} sections mention audit/log/oversight`),
    C('S18', 'anti-regression', 'Rice — safety guarantees not negated within 80 chars', unnegatedRice, 0, 'min', 'claims'),
    C('L35', 'anti-regression', 'moralised vocabulary', count(text, MORAL), 0, 'min', 'phrases'),
    // 5 · ANTI-NORMALISATION
    C('L36', 'anti-normalisation', 'synthetic staples / hedge salt, not counting one the prose refuses', unnegatedSalt, 0, 'min', 'phrases'),
    C('S19', 'anti-normalisation', 'gzip ratio raw:compressed — worst layout region (redundancy)', Number(gz.toFixed(2)), 2.2, 'min', ':1', gzRegions.length ? `regions ${gzRegions.map((g) => g.toFixed(2)).join(' · ')}` : 'whole text'),
    C('L37', 'anti-normalisation', 'lab-initiative names (report — analysis is judgment)', count(text, LAB), 0, 'report', 'names'),
    // 6 · SUFFICIENCY
    // L38 ideal was 0.4 with dir min — on the wrong side of every floor (the S19 defect). 0.1: a porch one
    // tenth of the exhibit. RE-SEEDED 2026-09-13: the operator put the whole whether/what argument in the porch
    // ("land the whole argument before the amuse always"), so the razor region's contract changed and the
    // floors ratcheted on the pivot-only porch (0.102 lock / 0.104 live) were floors for a different region.
    ...(kind === 'newsletter' ? [C('L38', 'sufficiency', 'brevity — razor words ÷ exhibit words (the porch carries the whole whether/what argument since 2026-09-13)', r.exhibit ? Number((words(r.razor) / words(r.exhibit)).toFixed(3)) : NaN, 0.1, 'min', 'ratio', `${words(r.razor)} / ${words(r.exhibit)}`)] : []),
    C('L40', 'sufficiency', 'logbook close — a tangible receipt in the last 15%', count(r.close, LOGBOOK) > 0 ? 1 : 0, 1, 'max', 'present'),
    ...(kind === 'invite' ? inviteChecks(text, html, C) : []),
  ];
  return out;
}

/** txt parity (L39): every kicker and every URL in the HTML is in the .txt. Returns the missing ones. */
export function txtParity(html, txt) {
  const kick = [...html.matchAll(/text-transform:uppercase[^>]*>([^<]{3,70})</g)].map((m) => TEXT(m[1])).filter((k) => k.length > 3);
  const urls = [...html.matchAll(/href="(https?:\/\/[^"?#]+)/g)].map((m) => m[1]).filter((u) => !/resend|unsubscribe|track/i.test(u));
  // compare on letters+digits only — the HTML says "Tesseract Physics &middot; Daily Book Club" and the .txt keeps
  // the middots; punctuation is rendering, the words are the construct.
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const t = norm(txt);
  return { kickersMissing: kick.filter((k) => !t.includes(norm(k))), urlsMissing: [...new Set(urls)].filter((u) => !txt.includes(u)) };
}

/** Compare against floors. Returns { rows, worse } — worse = checks that regressed past the floor. */
// THE FLOOR STOPS AT THE IDEAL (2026-09-14). Measured on the first post after the per-post ratchet went live:
// the opener floor (L27, dir min) had ratcheted to 5 WORDS, the named-exposure floor (L32, dir max) to 10, the
// verdict-verb floor (L30b) to 5 — a shorter opener is "better" without limit under dir min, so the floor sanded
// past the target and the next post was red on five checks for being normal. That is regression to the mean
// committed by the loop itself, the exact failure the ratchet spec names. The ideal is the target; a value past
// it is AT ideal, not better than it; so the floor can rise to the ideal and never beyond. Applied on read
// (judge) and on write (ratchet), so floors already past the ideal are read as the ideal.
export function clampToIdeal(c, floor) {
  if (floor === null || floor === undefined || c.dir === 'report' || c.dir === 'exact') return floor;
  return c.dir === 'min' ? Math.max(floor, c.ideal) : Math.min(floor, c.ideal);
}
export function judge(checks, floors = {}) {
  const rows = checks.map((c) => {
    const f = floors[c.id];
    const better = (a, b) => c.dir === 'min' ? a < b : c.dir === 'max' ? a > b : a === c.ideal && b !== c.ideal;
    const atIdeal = c.dir === 'exact' ? c.value === c.ideal : c.dir === 'min' ? c.value <= c.ideal : c.dir === 'max' ? c.value >= c.ideal : true;
    const floor = f === undefined ? null : clampToIdeal(c, f.value);
    const worse = c.dir === 'report' ? false : floor === null ? false : (c.dir === 'exact' ? (floor === c.ideal && c.value !== c.ideal) : better(floor, c.value));
    const beats = c.dir === 'report' ? false : floor === null ? true : better(c.value, floor);
    return { ...c, floor, atIdeal, worse, beats };
  });
  return { rows, worse: rows.filter((r) => r.worse) };
}

export function ratchet(rows, floors = {}) {
  const next = { ...floors };
  for (const r of rows) if (r.dir !== 'report' && (r.floor === null || r.beats)) {
    const v = clampToIdeal(r, r.value);
    if (r.floor !== null && v === r.floor) continue;   // already at the ideal — nothing rose
    next[r.id] = { value: v, since: new Date().toISOString().slice(0, 10) };
  }
  return next;
}

/**
 * measureOutward(path, text, html = '', floorsAll = null): the one call an outward-prose commit makes (C242b).
 * Picks the kind from the path (kindForPath), measures, judges against that class's floors from
 * data/six-percentages-floors.json (or the floors handed in), and returns { kind, rows, worse, floors }.
 * `text` may be '' when `html` is given — it is then TEXT(html). Existing exports are untouched.
 */
export function measureOutward(path, text, html = '', floorsAll = null) {
  const kind = kindForPath(path);
  const body = text && text.trim() ? text : TEXT(html || '');
  let all = floorsAll;
  if (!all) {
    try { all = JSON.parse(readFileSync(new URL('../../data/six-percentages-floors.json', import.meta.url), 'utf8')); } catch { all = {}; }
  }
  const floors = all[kind] || {};
  const { rows, worse } = judge(measure(body, { html, kind }), floors);
  return { kind, rows, worse, floors };
}

export const PCT_ORDER = ['predictive', 'impact', 'confidence', 'anti-regression', 'anti-normalisation', 'sufficiency'];
export function table(rows) {
  const lines = [];
  for (const p of PCT_ORDER) {
    const rs = rows.filter((r) => r.pct === p); if (!rs.length) continue;
    lines.push(`  ── ${p.toUpperCase()}`);
    for (const r of rs) {
      const mark = r.dir === 'report' ? '·' : r.worse ? '✗' : r.atIdeal ? '✓' : '△';
      lines.push(`  ${mark} ${r.id.padEnd(5)} ${String(r.value).padStart(6)} ${r.unit.padEnd(8)} floor ${r.floor === null ? '  new' : String(r.floor).padStart(5)} · ideal ${String(r.ideal).padStart(4)} ${r.dir.padEnd(6)} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }
  return lines.join('\n');
}
