#!/usr/bin/env node
// scripts/ops/board-requirements.mjs — THE BOARD'S REQUIREMENTS AS ITS OWN SPREADSHEET: every rule, requirement, use case, operation and
// research outcome for the board, ranked by how clear it is, clearest first. Operator 2026-10-20, verbatim: "write them up as one
// spreadsheet that can be edited. That's the place to start all the rules or the requirements all the use cases everything ... rank it
// by how understandable legible explainable easy to read and easy to understand they are ... the top ones have to be completely clear
// ... probably need more than one column for the description" · "all the you came here because you were looking for X and I was
// organized as why".
//
// Source: docs/specs/vna/board-requirements.json (hand-kept; his words per row with session and time). STATUS for a row that names a
// spec row is re-read off the spec on every write (open / ticked), so the sheet never claims built for an open row. His CLARITY and
// COMMENT cells are carried across rewrites by row id and pulled back by board-watch (the sheet sits in board-drive.json sheets).
//   node scripts/ops/board-requirements.mjs --print     the rows to stdout
//   node scripts/ops/board-requirements.mjs             write the sheet (created in the board folder on first run)
// Port row: transport over a hand-kept file — stays node (CLAUDE.md MAXIMISE RUST: what stays node).
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { horizonCoords } from './horizon-walk.mjs';
import { steerLink } from './board-priority.mjs';
import { lensSpecs, lensRows, loadLens } from './board-lens.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEAD as HEAD_TODAY } from './today-tops.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = 'docs/specs/vna/board-requirements.json';
// C1041f: two specs, one writer, one layout — the board (spreadsheet as control surface) and the Steer extension. --spec picks one.
export const SHARE_HEAD = ['ID', 'PRIORITY 0–9 (our guess)', 'TOPIC', 'THE QUESTION', 'OUR ANSWER — WHAT IT SAYS', 'PROOF / REFERENCE', 'WHY IT MATTERS', 'STATUS', 'YOUR COMMENT (fill)', 'ELIAS REPLIES (fill)'];
// PROOF / REFERENCE (operator 2026-10-23: "make the links clearer (their own column maybe?) for proof / references one per row"): one source per row, a link or a line of text.
export const SHARE_COLS = ['id', 'clarity', 'topic', 'q', 'a', 'proof', 'why', 'status'];
// THE COMMENT LIFECYCLE on a share sheet (operator 2026-10-20): they type → we write "✓ ACKNOWLEDGED · <what we did>" into the same
// cell → once the comment is integrated into the row, the cell is cleared. Every step is a row here first (AXIOM 1: the words are
// retained in the ledger, evicted only from the sheet).
export const SHARE_LEDGER = 'data/vna/share-comments.ndjson';
export const THEIR = 'YOUR COMMENT (fill)';
export function shareState(lines, spec) {
  const st = new Map();
  for (const l of lines) { if (l.spec !== spec) continue; st.set(l.id + '\u0000' + (l.field || THEIR), l); }
  return st;   // key → the latest {state: 'acked'|'integrated', value, note}
}
// C1122 (tend: sheet=Mailbox row=C240d, his note "share with them when we are sure it passes 80%"): every
// share sheet carries ITS OWN recognition grade — read off the CLARITY column already on each row, never a
// separate typed-in number — and sharing it is offered to the operator only once that grade reaches 80 %.
// Sharing the file stays his act below AND above the gate; the gate decides whether we OFFER it, never
// whether the sheet gets written (the workbench still needs the board folder copy to review).
export const SHARE_GATE = 0.8;
export function recognitionGrade(rows) {
  const cs = (rows || []).map((r) => Number(r.clarity)).filter((n) => Number.isFinite(n));
  if (!cs.length) return 0;
  return cs.reduce((s, n) => s + n, 0) / cs.length / 9;
}
export const shareOffered = (grade) => grade >= SHARE_GATE;
export function gradeRow(head, grade) {
  const pct = Math.round(grade * 100);
  const row = new Array(head.length).fill('');
  row[0] = 'G0'; row[2] = 'Recognition grade'; row[3] = 'Is this sheet ready to offer for sharing?';
  row[4] = `${pct}%`;
  row[5] = `read off this sheet's own CLARITY column — never typed in`;
  row[6] = shareOffered(grade) ? 'OFFERED TO SHARE (his act)' : `NOT OFFERED — below ${Math.round(SHARE_GATE * 100)} %`;
  return row;
}
// C1234: the first-principle row under the header — WHY in the id column, the lead in STANDS ON (or the third column), the rest blank.
export function leadRow(head, lead) { const at = Math.max(head.findIndex((h) => String(h).startsWith('STANDS ON')), 2); return head.map((h, i) => (i === 0 ? 'WHY' : i === 1 ? 'the whole sheet' : i === at ? lead : '')); }
// The called shot, one sheet per aspect of the build (operator 2026-10-24: "when clear enough write the briefs as a /tend sheet documents -
// all questions as columns for the different aspects of the build - business plan is not the right word"). Each source is hand-kept
// under docs/specs/vna/called-shot/: COLUMNS = that angle's questions (docs/research/called-shot-rl/angles/), ROWS = what they are asked
// of, each cell MEASURED with its path or UNMEASURED with the measurement that settles it. Internal, the licensed side of the line (C1296):
// never a share sheet. The Picture registers last so a --pass writes it after the rest and its WHERE column links them.
// SPINE (operator 2026-10-24, verbatim: "/tend this in the sheets so we have a spine to work through.."): one stage-of-the-trial
// sheet, no `angle` (its columns are the stages themselves, not one angle file's questions), so the per-question test skips it while
// the registry, house-rule and WHERE-link checks still apply to it like any other aspect.
// Guard: tests/research/called-shot-sheets.test.mjs.
export const CALLED_SHOT = [
  { key: 'called-shot-picture', file: '00-picture', aspect: 'The Picture', title: 'the build on one screen, one row per aspect' },
  { key: 'called-shot-reward', file: '01-reward-signal', aspect: 'Reward signal', angle: 'docs/research/called-shot-rl/angles/01-reward-signal.md', title: 'every question about the reward, asked of each field' },
  { key: 'called-shot-ladder', file: '02-training-ladder', aspect: 'Training ladder', angle: 'docs/research/called-shot-rl/angles/02-training-ladder.md', title: 'every question about training, asked of each rung' },
  { key: 'called-shot-activations', file: '03-activations', aspect: 'Activations', angle: 'docs/research/called-shot-rl/angles/03-activations.md', title: 'every question about the network, asked of each model and experiment' },
  { key: 'called-shot-financial', file: '04-financial-layer', aspect: 'Financial layer', angle: 'docs/research/called-shot-rl/angles/04-financial-layer.md', title: 'every question about who pays, asked of each buyer' },
  { key: 'called-shot-prior-art', file: '05-prior-art', aspect: 'Prior art', angle: 'docs/research/called-shot-rl/angles/05-prior-art-convergence.md', title: 'every question about convergence, asked of each named work' },
  { key: 'called-shot-risks', file: '06-risks', aspect: 'Risks', angle: 'docs/research/called-shot-rl/angles/06-risks-falsifiers.md', title: 'every question about gaming and failure, asked of each cheat and risk' },
  { key: 'called-shot-protected', file: '07-protected-layer', aspect: 'Protected layer', angle: 'docs/research/called-shot-rl/angles/07-protected-layer.md', title: 'every question about the line, asked of each component' },
  { key: 'called-shot-spine', file: '08-spine', aspect: 'Spine', title: 'one row per stage of the trial, in the order the work walks' },
  // C1355 (operator 2026-10-27: "make a sheet with the results of the steer comparisons … my comments are the exectution go no go on each"):
  // the local-hands sheet, no angle like the spine, so the per-question test skips it and the registry checks still apply.
  { key: 'called-shot-local-hands', file: '09-local-hands', aspect: 'Local hands', title: 'one row per steer intervention, ranked, with go / no-go' },
];
function calledShotSpecs() {
  const out = {};
  for (const c of [...CALLED_SHOT.slice(1), CALLED_SHOT[0]]) {
    const src = `docs/specs/vna/called-shot/${c.file}.json`;
    let j; try { j = JSON.parse(readFileSync(resolve(REPO, src), 'utf8')); } catch { continue; }   // a missing source is the guard's red, never a crash of every board door
    out[c.key] = { src, sheet: `Called Shot · ${c.aspect}`, title: `05 · CALLED SHOT · ${c.aspect.toUpperCase()} — ${c.title}`, head: j.head, cols: j.cols };
  }
  return out;
}
export const SPECS = {
  // Horizons · log: before → after per note, his words verbatim, append-only (operator 2026-10-20 "like a chain log").
  horizonsLog: { src: 'docs/specs/vna/horizons-log.json', sheet: 'Horizons · log', title: '00 · HORIZONS · LOG — your notes, before and after, what we did', head: ['ID', 'WHEN', 'ROW', 'YOUR NOTE', 'BEFORE', 'AFTER', 'WHAT WE DID', 'COMMIT', 'COMMENT (fill)'], cols: ['id', 'when', 'row', 'note', 'before', 'after', 'did', 'commit'] },
  // The horizons, log scale from today to 1000 years (operator 2026-10-20): aims to the limit, the pillar each leans on; private.
  // C1073: the business plan, walked backwards from the Horizons (operator 2026-10-20: "rewrite the business plan from the hyperstition
  // of the horizons document again on spreadsheets"); one source, also read by board-surfaces.mjs planTab. Private: aims never reach a share sheet.
  // Business Plan v2 (operator 2026-10-29): the plan as the answers to the category questions, each with a carrot and a stick; finance last.
  plan2: { src: 'docs/specs/vna/business-plan-v2.json', sheet: 'Business Plan v2', title: '00 · BUSINESS PLAN v2 — the questions a category answers: the deadlock, the unlocked action, the gateway; finance last', head: ['ID', 'PART', 'THE QUESTION', 'THE DEFAULT DEADLOCK (where it halts today)', 'THE UNLOCKED ACTION (what becomes permissible)', 'THE GATEWAY (the boundary that reads the receipt · when)', 'OUR ANSWER', 'FIRST MOVE · BY', 'HOW WE WOULD KNOW', 'FEEDS', 'MEASUREMENT STATE', 'NOTE (fill)'], cols: ['id', 'part', 'question', 'deadlock', 'unlocked', 'gateway', 'answer', 'first', 'know', 'feeds', 'state'] },
  plan: { src: 'docs/specs/vna/business-plan.json', sheet: 'Business Plan', title: '00 · BUSINESS PLAN — walked backwards from 1000 years to today', head: ['ID', 'HORIZON', 'BY', 'THE BUSINESS AT THIS HORIZON', 'WHAT WE ARE THINKING', 'WHAT IT FORCES ON THE ROW BELOW', 'THE MONEY', 'WHAT IT COSTS (finance.json)', 'ON THE RECORD TODAY', 'HOW WE WOULD KNOW', 'STANDS ON · CAUSES', 'NOTE (fill)'], cols: ['id', 'hz', 'date', 'biz', 'pillar', 'forces', 'money', 'cost', 'today', 'know', 'serves'] },
  horizons: { src: 'docs/specs/vna/horizons.json', sheet: 'Horizons', title: '00 · HORIZONS — the hyperstition, what the far future dictates backwards to today', head: ['ID', 'HORIZON', 'BY', 'STANDS ON', 'AIM — TO THE LIMIT', 'THE PILLAR THEY ALREADY BELIEVE', 'FIRST STEP TODAY', 'HOW WE WOULD KNOW', 'CAUSES', 'RIDES ON · COORDINATES', 'OPEN IN STEER', 'NOTE (fill)'], cols: ['id', 'hz', 'date', 'stands', 'aim', 'pillar', 'step', 'know', 'causes', 'coords', 'open'], enrich: 'horizons', lead: true },
  // bf-6540: the pillars our readers already believe, each as the ground the vision stands on (co-opt, never indict); PILLAR is the
  // Horizons PILLAR cell verbatim and HORIZON names its H-row (guard: tests/ops/pillars-sheet.test.mjs). Social, brand and story draw here.
  pillars: { src: 'docs/specs/vna/pillars.json', sheet: 'Pillars', title: '00 · PILLARS — what our readers already believe, and what the vision stands on it for', head: ['ID', 'THE PILLAR THEY ALREADY BELIEVE', 'STRAND', 'WHO STANDS ON IT TODAY', 'WHAT IT GOT RIGHT — AGREE FIRST', 'WHAT THE VISION STANDS ON IT FOR', 'THE LINE (social · brand · story)', 'THE CHECK THEY RUN', 'NEVER SAY (the indictment)', 'HORIZON (Horizons sheet)', 'NOTE (fill)'], cols: ['id', 'pillar', 'strand', 'who', 'right', 'stands', 'line', 'check', 'never', 'hz'] },
  // The search plan, walked backwards from what people type (operator 2026-10-27: "make a seo plan - think backwards from what people are
  // searching for - make a /tend sheet plan"). Source: the 2026-10-27 AI-Overview audit; guard tests/ops/seo-plan-sheet.test.mjs.
  seo: { src: 'docs/specs/vna/seo-plan.json', sheet: 'Search · Backwards', title: '01 · SEARCH · BACKWARDS — what they type, what the engine says today, the page and the one line that turns the NO into a YES', head: ['ID', 'THE SEARCH (what they type)', 'WHO TYPES IT', 'WHAT THE ENGINE SAYS TODAY (2026-10-27 audit, verbatim)', 'THE PAGE THAT ANSWERS IT', 'THE ONE LINE IT MUST CARRY', 'THE PROOF THEY RUN', 'THE MECHANISM', 'HORIZON', 'STATUS (off the record)', 'NOTE (fill)'], cols: ['id', 'query', 'who', 'today', 'page', 'line', 'proof', 'mech', 'hz', 'status'], lead: true },
  // The warranty circuit (operator 2026-10-29: "use /tend first catalouge this whole pipeline vision, in a sheet, then lets figure out where
  // to use it"): the four-node circuit pasted 2026-10-30T01:07Z, one row per claim against the record, the line we say beside the paste's.
  // Guard tests/ops/warranty-circuit-sheet.test.mjs. Internal: aims and the invented figures never reach a share sheet.
  circuit: { src: 'docs/specs/vna/warranty-circuit.json', sheet: 'Circuit · Warranty', title: '03 · CIRCUIT · WARRANTY — specialist, deployer, trigger, carrier: every claim against the record, the line we say, where we use it', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/warranty-circuit.json'), 'utf8')); return { head: j.head, cols: j.cols }; })(), lead: true },
  board: { src: SRC, sheet: 'Requirements', title: '02 · BOARD REQUIREMENTS — what the board must do, clearest first' },
  priorities: { src: 'docs/specs/vna/priorities.json', sheet: 'Priorities', title: '00 · PRIORITIES — what matters now, clearest first' },
  // Shared sheets (operator 2026-10-20): one per counterparty, his and their comment cells side by side; need-to-know rows only.
  // `grade: true` (C1122): a clarity-column Q&A sheet carries its own recognition grade and is OFFERED to share only at ≥80 % — the
  // lens share-<slug> sheets below gate on person.share.state instead (a decision he already made), so they do not carry `grade`.
  k4: { share: true, grade: true, src: 'docs/specs/vna/share-k4.json', sheet: 'Share · K4', title: 'ThetaDriven × K4 — after the 23 Oct call: grade the pitch, answers for members, London and 17 Nov', head: SHARE_HEAD, cols: SHARE_COLS },
  bryan: { share: true, grade: true, src: 'docs/specs/vna/share-bryan.json', sheet: 'Share · redacted name', title: 'ThetaDriven × redacted name — the 23 Oct call and what follows', head: SHARE_HEAD, cols: SHARE_COLS },
  // C1121: the 23 Oct agenda pulled out of K-01/B-01/GH-4 into its own sheet, cited back to each (one rule, one place); linked from
  // the For · Greg Hill and For · redacted name sheets (board-lens.mjs person.rules), never duplicated into either again.
  agendaK4: { share: true, grade: true, src: 'docs/specs/vna/agenda-2026-10-23.json', sheet: 'Share · Agenda · 23 Oct', title: 'ThetaDriven × K4 — the agenda for the 23 Oct call, Greg and Bryan', head: SHARE_HEAD, cols: SHARE_COLS },
  // The 180-day overview (operator 2026-10-20): one row per week, built by board-180.mjs, his pencil-ins carried by week id.
  // Budget · P&L · balance sheet (operator 2026-10-20), every figure marked by how it is known; private.
  finance: { src: 'docs/specs/vna/finance.json', sheet: 'Finance', title: '00 · FINANCE — budget, P&L, balance sheet (estimates marked)', head: ['ID', 'SECTION', 'LINE', 'AMOUNT $K', 'BASIS', 'HOW IT IS KNOWN', 'YOUR NUMBER (fill)', 'NOTE (fill)'], cols: ['id', 'sec', 'line', 'amt', 'basis', 'conf'] },
  // Investor map (operator 2026-10-22: "fill a sheet with investor names, rank them and do the two sided six needs with proof points"); private.
  // Called Shot (2026-10-24): the training layer, columns are the questions (operator: "write the briefs as a /tend sheet documents - all questions as columns for the different aspects of the build"). Private; never a share sheet. Sources hand-kept; rendered locally by scripts/research/called-shot-sheets-md.mjs.
  calledShotBuild: { src: 'docs/specs/vna/called-shot-build.json', sheet: 'Called Shot · Build', title: '03 · CALLED SHOT · BUILD — the reward on the walk, area by area, every question a column', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/called-shot-build.json'), 'utf8')); return { head: j.head, cols: j.cols }; })() },
  calledShotMap: { src: 'docs/specs/vna/called-shot-map.json', sheet: 'Called Shot · Map', title: '03 · CALLED SHOT · MAP — walked backwards from ten years to today: the strongest formulation, the tight formula, where we land, what each step needs', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/called-shot-map.json'), 'utf8')); return { head: j.head, cols: j.cols }; })() },
  // Patent · Filing plan (2026-10-24): what is filed through Patent Center, each row on its root claim; private, never quoted outward (NEED-TO-KNOW).
  patentFilingPlan: { src: 'docs/specs/vna/patent-filing-plan.json', sheet: 'Patent · Filing plan', title: '03 · PATENT · FILING PLAN — what we file, which root claim it hangs on, why it cannot be infringed alone', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/patent-filing-plan.json'), 'utf8')); return { head: j.head, cols: j.cols }; })() },
  calledShotHypotheses: { src: 'docs/specs/vna/called-shot-hypotheses.json', sheet: 'Called Shot · Hypotheses', title: '05 · HYPOTHESES · THE RATCHET — every claim in plain words, its null, what it costs to find out, how close it is', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/called-shot-hypotheses.json'), 'utf8')); return { head: j.head, cols: j.cols }; })() },
  calledShotFunding: { src: 'docs/specs/vna/called-shot-funding.json', sheet: 'Called Shot · Funding', title: '03 · CALLED SHOT · FUNDING — who funds the training layer, what each needs to see, the first step this week', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/called-shot-funding.json'), 'utf8')); return { head: j.head, cols: j.cols }; })() },
  investors: { src: 'docs/specs/vna/investors.json', sheet: 'Investors', title: '00 · INVESTORS — ranked by speed to first cheque, two-sided six needs, proof for and against', ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/investors.json'), 'utf8')); return { head: j.head, cols: j.cols }; })() },
  // bf-6534: the year view (Y- rows) above the weeks, dated rows pulled from Priorities, K4, Bryan and the spec T-minus, gaps PREDICTED.
  days180: { src: 'docs/specs/vna/days180-events.json', sheet: '180 days', title: '00 · 180 DAYS — weeks, travel, benchmarks, posts', build: './board-180.mjs' },
  // C1102 · C1147: three years, one cell per week, twelve quarter columns; every line read off the other sheets (board-weeks.mjs).
  weeks: { src: 'docs/specs/vna/days180-events.json', sheet: 'Weeks', title: '00 · WEEKS — what every sheet has already committed to, so a gap on the runway shows', build: './board-weeks.mjs' },
  // bf-6534: the year on one screen (board-year.mjs, built by the builder room in bd2e3d37bc), one cell per day, 12 month columns.
  year: { src: 'docs/specs/vna/days180-events.json', sheet: 'Year', title: '00 · YEAR — the Weeks sheet read down to a single day, so none surprises', build: './board-year.mjs' },
  // C1195 (tend: sheet=Strategy row=ST-00 → H-02): one row per live direction, every cell read off
  // horizons.json and days180-events.json (board-forest.mjs), never hand-typed.
  strategy: { src: 'docs/specs/vna/days180-events.json', sheet: 'Strategy', title: '00 · STRATEGY — the forest and the trees, every live direction held at once', build: './board-forest.mjs', buildFn: 'composeStrategy' },
  // bf-6534: 00 · START HERE — every sheet in board-drive.json with its one question, link, last write and open count.
  start: { src: 'data/vna/board-drive.json', sheet: 'START HERE', title: '00 · START HERE', build: './board-concert.mjs' },
  // One sheet per kind of outbound words (operator 2026-10-21: "dates planned LinkedIn, one sheet per kind ( put them there grab text and
  // then we mailbox prio them"): the text to paste is read out of each draft file by board-outbound.mjs, never typed into the sheet source.
  // C1264 (cloud1) wrote a second Posts · Magic writer on a rows schema; main keeps the posts-magic entry below (C1265/C1267 guards). The stencil rows wait on the LinkedIn room (merge 2026-10-24).
  // C1264b: the April post line by line beside the three stencil posts — rows written by scripts/comms/stencil.sh lines off the drafts; job/record/rule hand-kept in the json's hand block.
  aprilLines: { src: 'docs/specs/vna/posts-april-lines.json', sheet: 'Posts · April line by line', title: '01 · POSTS · APRIL LINE BY LINE — the post that drew 8,100, every line, why it worked, and the same line in each October post', // one column per stencil draft, read off the source's drafts list (never hand-listed here, so a new post is a new column)
    ...(() => { const j = JSON.parse(readFileSync(resolve(REPO, 'docs/specs/vna/posts-april-lines.json'), 'utf8')); const W = { 'LI-1026': 'notified', 'LI-1027': 'excluded', 'LI-1030': 'inspected', 'LI-CS1': 'called · notebook 1', 'LI-CS2': 'sovereign · notebook 2', 'LI-CS3': 'insurable · notebook 3' }; const ids = (j.drafts || []).map((d) => d.id);
      return { head: ['ID', 'COMMENT (fill)', 'SEAT', 'THE APRIL LINE', 'THE JOB — why it worked', 'THE RECORD — what the thread did', 'THE OCTOBER RULE', ...ids.map((i) => W[i] ? `${i} · ${W[i]}` : i), 'STENCIL'], cols: ['id', 'seat', 'april', 'job', 'record', 'rule', ...ids, 'stencil'] }; })() },
  linkedin: { src: 'docs/specs/vna/posts-linkedin.json', sheet: 'Posts · LinkedIn', title: '01 · POSTS · LINKEDIN — dated, the text to paste, status off the draft', build: './board-outbound.mjs', buildFn: 'composePosts' },
  // C1249: one row per LinkedIn post that carries a .v2-sequence.md sibling — the authority, the word, the inside failure
  // (button 6), the substrate (button 8, the litany) and the check (button 10), read off that file's own numbered list.
  'posts-formula': { src: 'docs/specs/vna/posts-linkedin.json', sheet: 'Posts · Formula', title: '01 · POSTS · FORMULA — the authority, the word, the inside failure, the substrate, the check, which of the 14 buttons are present', build: './board-outbound.mjs', buildFn: 'composePostsFormula' },
  // /tend 2026-10-23: every queued post rewritten on the facets that carried the April EU AI Act post (~8,100 impressions),
  // one column per facet, plus the infographic path per post. Source posts-magic.json; guard tests/ops/posts-magic-tab.test.mjs.
  'posts-magic': { src: 'docs/specs/vna/posts-magic.json', sheet: 'Posts · Magic', title: '01 · POSTS · MAGIC — the April facets in sequence, overshot for now, every post rewritten on them', build: './board-posts-magic.mjs', buildFn: 'composePostsMagic' },
  messages: { src: 'docs/specs/vna/messages-dm.json', sheet: 'Messages · DM + WhatsApp', title: '01 · MESSAGES · DM + WHATSAPP — what came in, why reply, the draft to paste', build: './board-outbound.mjs', buildFn: 'composeMessages' },
  // C1189 (tend: sheet=Outbox row=OUT-00 → H-03): the consolidated most-likely-to-send sheet, pulled
  // from messages-dm.json, posts-linkedin.json, every actable lens item, the admin dated steps on
  // days180-events.json, and the rows already built ahead of it (C1190/C1191/C1193/C1196) — never
  // hand-kept, so 'src' below is documentation only (outbox.mjs header; S.src is unread when S.build is set).
  outbox: { src: 'docs/specs/vna/outbox.json', sheet: 'Outbox', title: '01 · OUTBOX — most likely to send, sign off here', build: './outbox.mjs', buildFn: 'composeOutbox' },
  // The network sheets (operator 2026-10-22: "make a sheet for x and for linkedin connections and research / rank their relevance … all
  // should be in there though, with commentary on where they fit"): every person, ranked, through social-pipeline.mjs's named steps; the
  // rows live in out/board/social (gitignored) and never in a tracked file. Private.
  'network-li': { src: 'out/board/social/5-ranked.json', sheet: 'Network · LinkedIn', title: '01 · NETWORK · LINKEDIN — every connection, ranked, where each one fits', build: './social-pipeline.mjs', buildFn: 'composeLinkedIn' },
  'network-x': { src: 'out/board/social/5-ranked.json', sheet: 'Network · X', title: '01 · NETWORK · X — every follower, ranked, where each one fits', build: './social-pipeline.mjs', buildFn: 'composeX' },
  // C1214 TODAY: the top of every list, formulated toward Horizons H-01→H-03 (operator 2026-10-22, "a sheet for this in addition to the txt").
  today: { src: 'docs/specs/vna/plan-flow.txt', sheet: 'Today', title: '00 · TODAY — the top of every list, each a part toward the Horizons', head: HEAD_TODAY, build: './today-tops.mjs' },
  // The funnel as a decision sequence (operator 2026-10-22: "map out every single surface … a touch sequence from first touch to last
  // touch … short monologues of what the perfect customer thinks at each point"): one source, two sheets, rows in step order (board-funnel.mjs).
  funnel: { src: 'docs/specs/vna/funnel.json', sheet: 'Funnel · Sequence', title: '01 · FUNNEL · SEQUENCE — first touch to provider, what they decide at each step', build: './board-funnel.mjs', buildFn: 'composeFunnel' },
  'funnel-surfaces': { src: 'docs/specs/vna/funnel.json', sheet: 'Funnel · Surfaces', title: '01 · FUNNEL · SURFACES — every place a person meets us, and the step it serves', build: './board-funnel.mjs', buildFn: 'composeSurfaces' },
  // C1221b — every compiled /steer ask on the board, the top ten skimmed by live formulas off the rows below (board-steer.mjs)
  // C1310 (operator 2026-10-24: "Track them all and lets reason backwards from how close we are - formal and simolified null hypothesis"):
  // every claim at its null, closest first; Spine rows read live, HOW CLOSE computed (scripts/ops/board-nulls.mjs). Internal, never shared.
  nulls: { src: 'docs/specs/vna/nulls.json', sheet: 'Nulls', title: '05 · NULLS — every claim at its null, closest first, read backwards to the horizon', build: './board-nulls.mjs', buildFn: 'composeNulls' },
  'steer-compiled': { src: 'data/vna/steer-compiled.json', sheet: 'Steer · Compiled', title: '01 · STEER · COMPILED — every compiled /steer ask, scored on the six percentages, so the next ten minutes starts on the best one', build: './board-steer.mjs', buildFn: 'composeSteerSheet' },
  // C1385 (/tend 2026-10-28, operator: "report all signals we can measure and learn from in this session to a spreadsheet - for how the
  // pipeline and rust etc"): every signal a session measured or could measure about the pipeline, the Rust walk, the flat NCD, the steer
  // door, the workflow, the machine, the network, the package state and the called shot — one standing sheet, sourced from every
  // data/vna/signals/<date>-<session>.json (newest first; the folder is the src, so a new session is a new file, never a rewrite), each
  // row with its source, instrument, what it teaches, its spec row and horizon; UNMEASURED rows float to TOP (board-signals.mjs). Internal.
  signals: { src: 'data/vna/signals/', sheet: 'Signals · Pipeline', title: '05 · SIGNALS · PIPELINE — every signal measured or owed about the pipeline, the Rust walk, the flat NCD, the door, the machine, the network, the package and the called shot', build: './board-signals.mjs', buildFn: 'composeSignalsSheet' },
  // C1388: the claims spine (docs/specs/vna/claims-spine.json, hand-kept, committed 38d363286a) — why proven code keeps not
  // running, the registry/guard/lens-injection/cold-run prevention rows, the edge cases, the before/after on the tripwire
  // claim. Ranked by its own 'priority' field (sortByClarity falls back to it), M0 first by priority then id. Internal, never a share sheet.
  // GTM · Spec (operator 2026-10-30): the go-to-market as a spec, every step a row in the tree, titles read live (board-gtm.mjs).
  gtm: { src: 'docs/specs/vna/gtm-spec.json', sheet: 'GTM · Spec', title: '00 · GTM · SPEC — frame, the technical floor a hostile reviewer runs first, the motions ranked by readiness, what we retired', build: './board-gtm.mjs', buildFn: 'composeGtm', lead: true },
  'claims-spine': { src: 'docs/specs/vna/claims-spine.json', sheet: 'Claims · Spine', title: '03 · CLAIMS · SPINE — why proven code keeps not running: the registry plan, the edge cases, before/after on the tripwire claim', head: ['ID', 'PRIORITY 0–9', 'TOPIC', 'THE QUESTION', 'OUR ANSWER', 'PROOF / REFERENCE', 'WHY IT MATTERS', 'STATUS', 'YOUR COMMENT (fill)'], cols: ['id', 'priority', 'topic', 'q', 'a', 'proof', 'why', 'status'] },
  steer: { src: 'docs/specs/vna/steer-extension-requirements.json', sheet: 'Steer extension spec', title: '03 · STEER EXTENSION REQUIREMENTS — what the extension must do, clearest first' },
  // The grip sequence (operator 2026-10-23: "lets make a sheet of what has to happen before other things sequence (with curated list of
  // people)"): one row per gate in the order the record forces, WAITS ON and UNLOCKS naming each other. People are named, so the rows
  // live in out/board (gitignored), never in a tracked file. Private.
  'grip-seq': { src: 'out/board/grip-sequence.json', sheet: 'Grip · Sequence', title: '01 · GRIP · SEQUENCE — what has to happen before what, and who', head: ['ID', 'YOUR CALL (fill)', 'GATE', 'WAITS ON', 'UNLOCKS', 'PEOPLE', 'CHANNEL', 'BY WHEN', 'STATE (read off the record)', 'VALUE (grip map, ASSUMPTION)', 'PROOF'], cols: ['id', 'gate', 'waits', 'unlocks', 'people', 'channel', 'by', 'state', 'value', 'proof'] },
  // The writer sheet (operator 2026-10-23: "the writer sheet needs it - to be commented line by line - and the notebook infographic bash
  // opened (linked)"): the next post, one row per line read out of its draft by writer-post.mjs, a comment cell on every line. Private.
  writer: { src: 'out/board/writer-post.json', sheet: 'Writer · next post', title: '01 · WRITER · NEXT POST — every line of the post, comment line by line, the image linked on top', head: ['ID', 'YOUR COMMENT (fill)', 'SECTION', 'THE LINE', 'WORDS', 'HOUSE-STYLE HITS (style-check.mjs)'], cols: ['id', 'section', 'line', 'words', 'hits'] },
  // One focus sheet per person in our orbit (board-lens.mjs): --spec lens-<slug>; the 80 % gate picks share-ready or internal.
  ...lensSpecs(),
  ...calledShotSpecs(),
};
export const REQ_HEAD = ['ID', 'CLARITY 0–9 (our guess)', 'REQUIREMENT', 'YOU COME HERE FOR', 'IT IS ORGANIZED AS', 'DONE WHEN', 'STATUS', 'KIND', 'YOUR WORDS', 'CHANGE CLARITY 0–9 (fill)', 'COMMENT (fill)', 'WHERE IT LIVES', 'SOURCE'];

// A row naming a spec row reads its live state: a BUILT claim on an open row is shown as such, never trusted.
export function liveStatus(r, specTxt) {
  if (!r.spec) return r.status;
  const esc = r.spec.replace(/[^\w]/g, '');
  const m = specTxt.match(new RegExp(`^\\s*- \\[([ x])\\] ${esc}\\b`, 'm'));
  if (!m) return `${r.status} · ${r.spec} not found in the spec`;
  return `${r.status} · ${r.spec} ${m[1] === 'x' ? 'ticked' : 'open'}`;
}
// C1243: the one clarity sort every sheet floats its clearest line by, clearest first, id as the tie-break —
// named and exported so today-tops.mjs ranks its own parts on the same scale (clarityOf) instead of a second rule.
// claims-spine (C1388): its source names the same 0–9 scale 'priority' (what the row costs if it slips), never 'clarity'
// (how legible it reads) — same number line, so the one sort falls back to it rather than a second sort function.
export function sortByClarity(rows) { return rows.slice().sort((a, b) => (b.clarity ?? b.priority) - (a.clarity ?? a.priority) || String(a.id ?? '').localeCompare(String(b.id ?? ''))); }
export function compose({ rows, specTxt = '', head, cols, acks = new Map() }) {
  const sorted = sortByClarity(rows);
  // G6 (sheet-legibility.mjs): a (fill) column may sit anywhere, the comment second so it is frozen beside the row name. The written
  // columns take cols in order; each (fill) header gets its acknowledgement or nothing. Fills all at the end reads as before.
  const isFillH = (h) => /\(fill\)\s*$/.test(String(h));
  if (head) return [head, ...sorted.map((r) => { let k = 0; return head.map((h) => { if (!isFillH(h)) { const key = cols[k++]; return key === undefined ? '' : (r[key] ?? ''); } const a = acks.get(r.id + '\u0000' + h); return a && a.state === 'acked' ? `✓ ACKNOWLEDGED · ${a.note}` : ''; }); })];
  return [REQ_HEAD, ...sorted.map((r) => [r.id, r.clarity, r.req, r.for, r.organized, r.done, liveStatus(r, specTxt), r.kind, r.words || '—', '', '', r.where || '', r.source || ''])];
}
// C1020a: the Horizons rows carry their rides and pixels off the walk receipt (horizon-walk.mjs owns the reading; this only reads it).
const readJson = (p) => { try { return JSON.parse(readFileSync(resolve(REPO, p), 'utf8')); } catch { return null; } };
const mtime = (p) => { try { return statSync(resolve(REPO, p)).mtimeMs; } catch { return 0; } };
function enrichHorizons(rows, src) { return horizonCoords(rows, { walk: readJson('data/vna/horizon-walk.json'), tree: readJson('data/vna/spec-tree.json'), steerLink, srcMtime: mtime(src), walkMtime: mtime('data/vna/horizon-walk.json') }); }
const readLedger = () => { try { return readFileSync(resolve(REPO, SHARE_LEDGER), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
// C1235: H-00 is the sheet's own RULES row, read for its NCD/hub exclusion in horizon-walk.json and for its PROVED/UNPROVED
// check in horizon-walk.mjs's KNOW_CHECKS — both read horizons.json directly and never go through this composed grid. Its
// clarity (200) outranks every aim, so left in the sorted grid it always lands row 1: process sitting above the principle
// on the first screen a person opens. Dropped here, after enrichHorizons so the walk still sees it as a node to exclude,
// never before — scripts/ops/sheet-tabs.mjs carries its R1–R5 to the Horizons sheet's own Rules tab instead.
const load = (src = SRC, S = {}, acks = new Map()) => {
  let rows = S.lens ? lensRows(loadLens(S.lens), { share: S.lensShare }) : JSON.parse(readFileSync(resolve(REPO, src), 'utf8')).rows;
  if (S.enrich === 'horizons') { rows = enrichHorizons(rows, src); rows = rows.filter((r) => r.id !== 'H-00'); }
  const specTxt = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-CLOUD-STEER.md'].map((p) => { try { return readFileSync(resolve(REPO, p), 'utf8'); } catch { return ''; } }).join('\n');
  const grid = compose({ rows, specTxt, head: S.head, cols: S.cols, acks });
  if (S.grade) grid.splice(1, 0, gradeRow(S.head, recognitionGrade(rows)));   // C1122: the grade rides IN the sheet, row 1, never a side note
  if (S.lead) { const lead = JSON.parse(readFileSync(resolve(REPO, src), 'utf8'))._lead; if (lead) grid.splice(1, 0, leadRow(S.head, lead)); }   // C1234: the sheet opens on its first principle, read from the source's _lead (one place)
  return grid;
};

// C1172: START HERE's own "LAST WRITE (UTC)" column reads every OTHER sheet's Drive modifiedTime, so composing it before
// the others write in the same pass shows stamps about to go stale the moment those writes land. passOrder puts every other
// spec first and 'start' last, so its one compose reads modifiedTime already moved by this pass, not a minute behind it.
export function passOrder(keys) { return [...keys.filter((k) => k !== 'start'), 'start']; }
export async function runPass() {
  const { execFileSync } = await import('node:child_process');
  let bad = 0;
  for (const key of passOrder(Object.keys(SPECS))) {
    try { console.log(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--spec', key], { encoding: 'utf8' }).trim()); }
    catch (e) { bad++; console.log(`✗ ${key}: ${String(e.stdout || e.message).trim().slice(0, 200)}`); }
  }
  process.exit(bad ? 1 : 0);
}

// The command runs inside main(), never as top-level await: board-180 → board.mjs → board-surfaces imports this module back, and a
// module still awaiting at top level deadlocks that cycle (node exit 13, the 180-day sheet unwritten from C1073 to /tend 2026-10-21).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) { if (process.argv.includes('--pass')) await runPass(); else main().catch((e) => { console.error(e); process.exit(1); }); }
async function main() {
  const a = process.argv.slice(2);
  const S = SPECS[a.includes('--spec') ? a[a.indexOf('--spec') + 1] : 'board']; if (!S) { console.log(`✗ --spec is one of: ${Object.keys(SPECS).join(', ')}`); process.exit(2); }
  const key = a.includes('--spec') ? a[a.indexOf('--spec') + 1] : 'board';
  const acks = S.head ? shareState(readLedger(), key) : new Map();
  // ack <id> "<what we did>" · integrate <id> — read the live cell, record it, then rewrite (share sheets only)
  const verb = ['ack', 'integrate'].find((v) => a[0] === v);
  if (verb && !S.head) { console.log('✗ ack/integrate apply to share sheets only (--spec k4 | bryan | lens-<slug>)'); process.exit(2); }
  const grid0 = S.build ? await (await import(S.build))[S.buildFn || 'compose']() : load(S.src, S, acks);
  if (a.includes('--print') && !verb) { for (const r of grid0) console.log(r.slice(0, 7).map((c) => String(c).slice(0, 90)).join(' │ ')); process.exit(0); }
  const { rcloneToken } = await import('./board-comments.mjs');
  const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = rcloneToken(); if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.sheets[S.sheet];
  if (!id) {
    const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: S.title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    if (!r.id) { console.log(`✗ create failed: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); }
    id = r.id; j.sheets = { [S.sheet]: id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  if (verb) {
    const { exportGrid, fillsOf } = await import('./board-sheets-write.mjs');
    const rid = a[1]; const f = fillsOf(await exportGrid(t.token, id)).find((x) => x.id === rid && x.field === THEIR);
    if (!f) { console.log(`✗ no comment in ${rid} · ${THEIR}`); process.exit(1); }
    if (verb === 'integrate' && !f.value.startsWith('✓ ')) { console.log(`✗ ${rid} holds a comment not yet acknowledged — ack it first, so a new note is never cleared unread`); process.exit(1); }
    const prev = acks.get(rid + '\u0000' + THEIR);
    const value = f.value.startsWith('✓ ') && prev ? prev.value : f.value;   // integrating an acked cell: the words are the ones acked
    const row = { ts: new Date().toISOString(), spec: key, sheet: S.sheet, id: rid, field: THEIR, value, state: verb === 'ack' ? 'acked' : 'integrated', note: verb === 'ack' ? (a[2] || 'read, and we are on it') : (a[2] || '') };
    const { appendFileSync } = await import('node:fs'); appendFileSync(resolve(REPO, SHARE_LEDGER), JSON.stringify(row) + '\n');
    acks.set(rid + '\u0000' + THEIR, row);
  }
  const grid = linkSheetNames(S.build ? grid0 : load(S.src, S, acks), j.sheets, { share: S.share });
  const acked = new Map([...acks.values()].filter((x) => x.state === 'acked').map((x) => [x.id, x.value]));
  const cleared = new Map([...acks.values()].filter((x) => x.state === 'integrated').map((x) => [x.id + '\u0000' + x.field, x.value]));
  const named = a.flatMap((x, i) => (x === "--overwrite-cell" ? [a[i + 1]] : []));
  let r = await writeSheet(t.token, id, grid, { name: S.sheet, acked, cleared });
  if (r.refused && r.edits && named.length) {
    const { namedOverwrite } = await import("./board-sheets-write.mjs");
    if (namedOverwrite(r.edits, named)) { console.log(`↺ overwriting the named cell(s) only: ${named.join(", ")}`); r = await writeSheet(t.token, id, grid, { name: S.sheet, acked, cleared, overwriteEdits: true }); }
  }   // always cell by cell (planGrid), a header change included
  // C1122: the grade is read off the same rows the sheet was built from, never re-derived from the written grid.
  let grade = '';
  if (S.grade) { const g = recognitionGrade(JSON.parse(readFileSync(resolve(REPO, S.src), 'utf8')).rows); grade = ` · recognition ${Math.round(g * 100)}% — ${shareOffered(g) ? 'OFFERED to share (his act)' : `NOT offered to share, below ${Math.round(SHARE_GATE * 100)}%`}`; }
  console.log(r.refused ? `✗ refused — ${r.why}` : r.mode === 'cells' ? `✓ ${S.sheet} (cell by cell): ${r.applied} cell(s) written · ${r.appended} row(s) appended · ${r.conflicts.length} conflict(s) left as he typed them${r.dropped.length ? ` · ${r.dropped.length} row(s) no longer in the source, left in place: ${r.dropped.join(', ')}` : ''} · layout ${r.format || "UNMEASURED"} · https://docs.google.com/spreadsheets/d/${id}/edit${grade}` : `✓ ${S.sheet}: ${r.newRows} rows · ${r.keptFills} typed cell(s) kept · read back ${r.readBackRows}/${r.expectRows} · https://docs.google.com/spreadsheets/d/${id}/edit${grade}`);
  process.exit(r.refused ? 1 : 0);
}

// Operator 2026-10-23: "always include the links to relevant sheets for my and the agents to follow". A WHERE or PROOF cell that
// names an internal sheet carries that sheet's link, read off board-drive.json at write time (never hand-typed, so a moved sheet
// never leaves a dead link). Share sheets are skipped: a counterparty never receives a link to an internal sheet (need-to-know).
export function linkSheetNames(grid, sheets = {}, { share = false } = {}) {
  if (share || !Array.isArray(grid) || !grid.length) return grid;
  const head = grid[0] ?? []; const cols = head.map((h, i) => (/^(WHERE|PROOF)/i.test(String(h)) ? i : -1)).filter((i) => i >= 0);
  if (!cols.length) return grid;
  const names = Object.keys(sheets).filter((n) => n.length > 4 && !/^(Share|For) · /.test(n)).sort((a, b) => b.length - a.length);
  const url = (n) => `https://docs.google.com/spreadsheets/d/${sheets[n]}/edit`;
  return grid.map((row, r) => (r === 0 ? row : row.map((v, c) => {
    if (!cols.includes(c) || typeof v !== 'string' || v.includes('docs.google.com/spreadsheets')) return v;
    const hit = names.filter((n) => v.includes(n)); if (!hit.length) return v;
    const seen = []; for (const n of hit) if (!seen.some((s) => s.includes(n))) seen.push(n);
    return `${v} · ${seen.map((n) => `${n}: ${url(n)}`).join(' · ')}`;
  })));
}
