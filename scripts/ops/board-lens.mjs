#!/usr/bin/env node
// scripts/ops/board-lens.mjs — ONE FOCUS SHEET PER PERSON IN OUR ORBIT: a recognition ledger, not a CRM (operator 2026-10-20, verbatim:
// "one spreadsheet per person that we can share with them with the common section that they can write whatever they want ... It's RPMs
// for them" · "/tend this and any other people we can think of for the pov interests weather we're talking yet or no" · "Correct with
// repo in mind").
//
// TWO DECISIONS, NEVER ONE (operator 2026-10-20, verbatim: "The 80% gate is not for sharing that's based on other things it's for just
// executing the comments as well that includes sending emails. Whatever else we wanna do when we feel we understand it send an email and
// do whatever it comes naturally"):
//   SHARE (person.share.state yes | not yet | never, with why) — the other things: are we talking now, is every share row need-to-know
//     clean, does the sheet help them. Sharing the file stays his act; the writer only puts it in the board folder.
//   ACT (ACT_GATE = 0.8) — per focus item and per comment: understood ≥ 80 % → we execute what `does` names (file the /steer row, arm
//     the email through the comms pipeline, which still blocks below a 95 grade per need). Below 80 % → we ask the item's question.
// TWO FILES PER PERSON, ONE SOURCE (F8): the workbench `Lens · <name> (internal)` (every column, the act gate shown) and `For · <name>`
// for everyone (items not marked private, two monologues, the action, the result, the steps, our certainty). Share state marks the For
// sheet a DRAFT until it is yes; sharing the file stays his act. One file cannot flip between the two: the writer leaves old rows in place.
//
// Source: docs/specs/vna/lens/<slug>.json — person (name · role · interest · where_they_are · where_we_are · last_call · share) ·
//   needs {co,cn,gr,uc,ce,si: [theirs, ours]} (mailbox-rpm.mjs NEEDS order) · items (≥3: id · need · horizon · topic · hear · say ·
//   action · result · question · share · understood 0–1 · does · status · source).
//   items[].why {co,cn,gr,uc,ce,si: [theirs, ours]} and items[].massive [steps] (the RPM format, operator 2026-10-20) replace need + action.
//   node scripts/ops/board-lens.mjs --list               every person, the share state, both sheets
//   node scripts/ops/board-lens.mjs --print <slug> [--share]
//   node scripts/ops/board-lens.mjs --act                the act queue: items ≥ 80 % with what we do + comments typed on lens sheets
//   node scripts/ops/board-lens.mjs --act done <slug> <item|cell> "<what we did>"   record it (data/vna/lens-act.ndjson) [--commit <sha>]
//   node scripts/ops/board-lens.mjs --tabs [--only <slug>]    write every lens sheet's Rules tab (general + theirs) and Log tab (the act ledger)
//   node scripts/ops/board-requirements.mjs --spec lens-<slug> | share-<slug>       write a sheet (cell by cell)
// LLM-free. Port row: transport over hand-kept files + one threshold → stays node until the gate grows (CLAUDE.md MAXIMISE RUST).
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEEDS } from './mailbox-rpm.mjs';
import { LEGIBILITY_RULES, HOLD_RULES } from './sheet-legibility.mjs';
import { parseCellWord } from './board-cell-words.mjs';
import { STOPS_AGENT, KEEP_IN_LANE } from '../voice/behavior-promise.mjs';
import { countDeterminismMisuse } from '../lib/grip-word.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LENS_DIR = 'docs/specs/vna/lens';
export const ACT_GATE = 0.8;

// WHAT A LENS ITEM MUST BE (operator 2026-10-22, on a pasted model fill of the Gary Marcus For sheet: "what are the qualities we
// need - name it then lets do it" · "we need to learn how to make it scannable also"). The paste filled his two (fill) cells with
// quotes nobody said, sold an L1/L2 performance-counter trap as ours and wrote the replies as a sneer. Four qualities, one home:
// RUNG-HONEST: no rung-4 apparatus (a counter read, a cache trap, containment) as ours, no halt or keep-in-lane as our act, the
// word for chaos never describing us (AXIOM 0 · TAPE, NOT BRAKE · THE WORD NAMES THE CHAOS).
// A PARTY ON EVERY STEP: each step opens "<who>: ", so a step reads as an act someone does, never a hope.
// SCANNABLE: each cell stays under a word ceiling measured off the corpus on 2026-10-22; a ceiling only falls (G4, one thing per cell).
// SOURCED and HIS CELLS STAY HIS are the other two; the first is G7, the second G6, and neither is a field a lens item carries.
export const RUNG4_AS_OURS = /performance[- ]counter|perf[- ]counter|\bMSR\b|\bL[12](?:\/L[12])? cache|silicon boundary|hardware[- ]level trap|hardware trap|\bcontainment\b/i;
export const CELL_CEILING = { topic: 12, act: 14, hear: 21, say: 61, result: 19, step: 13, monologue: 55 };
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
export function lensItemBreaks(x) {
  const out = []; const txt = JSON.stringify({ ...x, source: undefined });
  if (RUNG4_AS_OURS.test(txt)) out.push(`rung 4 as ours: "${txt.match(RUNG4_AS_OURS)[0]}"`);
  if (STOPS_AGENT.test(txt)) out.push('the halt sold as our act');
  if (KEEP_IN_LANE.test(txt)) out.push('keep-in-lane sold as our act');
  if (countDeterminismMisuse(txt)) out.push('the word for chaos describes us');
  for (const st of x.massive || []) if (!/^[A-Za-z][\w .&'-]{0,30}: \S/.test(st)) out.push(`a step names no party: "${st}"`);
  for (const k of ['topic', 'act', 'hear', 'say', 'result']) if (words(x[k]) > CELL_CEILING[k]) out.push(`${k} over ${CELL_CEILING[k]} words`);
  for (const st of x.massive || []) if (words(st) > CELL_CEILING.step) out.push(`a step over ${CELL_CEILING.step} words`);
  for (const side of ['theirs', 'ours']) if (words(x.monologue?.[side]) > CELL_CEILING.monologue) out.push(`monologue ${side} over ${CELL_CEILING.monologue} words`);
  return out;
}
export const ACT_LEDGER = 'data/vna/lens-act.ndjson';
// A person's sheet is meant to be shared (operator 2026-10-21: "when you write never shared you that means we haven't finished yet"): people
// are yes or not yet. 'never' is kept only for a lens that is not a person we would send to (hv-consulting: a readership read on the
// household's side); a 'never' lens gets no For sheet.
export const SHARE_STATES = ['yes', 'not yet', 'never'];
export const NEED_NAME = { co: 'Connection', cn: 'Contribution', gr: 'Growth', uc: 'Uncertainty', ce: 'Certainty', si: 'Significance' };
const TAIL = ['YOUR COMMENT (fill)', 'ELIAS REPLIES (fill)'];
// EVERY ROW IS AN RPM (operator 2026-10-20, verbatim: "These are RPMs. That means that we walk through the six needs from both
// perspectives on all of them ... they're supposed to recognize themselves in the internal monologue ... they're just a few words" ·
// "Keep the what they have to hear what we have to hear though" · "It's not one need and a column it's just the abbreviated 6 needs and
// sequence" · "The rest can be for the massive action format, which is a structured thing"). WHY is the six needs in sequence, theirs
// then ours, a few words each; then HEAR and SAY; then RESULT; then MASSIVE ACTION as forward steps, ours first. Comments open everywhere.
// ONE LINE = ONE FOCUS ITEM, READ LEFT TO RIGHT, ONE THING PER CELL (operator 2026-10-20, on the phone view of the stacked cells: "I don't
// understand this set up ... every line is an action ... they have to recognize themselves first and then what is what they have to hear
// what we have to say. It's what the result looks like and then the ... massive actions which is broken up into several columns. There's
// no point splitting cells like this"). So: the six needs as six columns in their own words (recognition first) · HEAR · SAY · RESULT ·
// STEP 1–4. No card rows on the main tab: where they are, where we are, where we left
// off and their monologue sit on the Rules tab (C-lines). Operator, same night: "these I meant to be shared with them so it's not what
// they need to hear. It's what we hope you recognize" — the hear column is WHAT WE HOPE YOU RECOGNISE, written to them as "you".
// THE FORMAT RULES — written first, the code below follows them (operator 2026-10-20: "Write the rules first I guess because we have
// structures that work let's keep using them" · "you had a really good one with the abbreviation on a new line inside of the cell" ·
// "This is supposed to be shared ... you can't scan that many sideways" · "We already have a structure where we use the abbreviation and
// all the needs in one cell one for them one for us. You're redoing everything without listening to what we already did that worked").
// Each rule is checked by tests/ops/board-lens.test.mjs and printed on every lens sheet's Rules tab.
export const FORMAT_RULES = [
  ['F1', 'ONE LINE IS ONE FOCUS ITEM. The main tab carries focus items only; where you are, where we are, where we left off and the six-needs monologue live on this Rules tab.'],
  ['F2', 'ON THE WORKBENCH, TWO NEEDS CELLS, THEM THEN US. Inside each cell the six needs in sequence, each on its own line with its abbreviation: co: … / cn: … / gr: … / uc: … / ce: … / si: … — never one column per need, never one need per row.'],
  ['F3', 'THEN WHAT WE HOPE YOU RECOGNISE (written to you, as "you"), THEN WHAT WE BRING (in our voice).'],
  ['F4', 'THEN THE RESULT: one fact anyone can check.'],
  ['F5', 'THEN THE MASSIVE ACTION ACROSS COLUMNS: STEP 1 to STEP 4, ours first, one step per cell.'],
  ['F6', 'NARROW ENOUGH TO SHARE: the For sheet carries only ID · topic · your monologue · ours · what we hope you recognise · what we bring · the action · the result · the steps · our certainty · your comment · our reply.'],
  ['F8', 'TWO FILES, ONE SOURCE: the workbench (every detail, the six needs cell by cell, our sources) and the For sheet (written to you). Both are rebuilt from one lens file, so they never drift; the workbench is where we think it through, the For sheet is what we share once we are clear enough.'],
  ['F9', 'THE READER LAYOUT (his words 2026-10-22: "easy to scan and easy to read"): when a person asks for it, the For sheet is six columns — # · what it is · why it is yours · read this · what we ask · your comment. The header stays frozen; read this is the widest column and holds the pages to read, one link per line, the only cell that stacks lines.'],
  ['F7', 'KEEP A STRUCTURE THAT WORKS: before changing this layout, read the one in use and keep it; a change needs his words.'],
];
export const needsCell = (why, side) => NEEDS.map((k) => `${k}: ${String(((why || {})[k] || [])[side] || '').trim() || 'UNMEASURED'}`).join('\n');   // F2
export const STEPS = 4; const STEP_COLS = Array.from({ length: STEPS }, (_, i) => `STEP ${i + 1}`); const STEP_KEYS = Array.from({ length: STEPS }, (_, i) => `s${i + 1}`);
const NEEDS_ABBR = NEEDS.join(' · ');
// THE "FOR <NAME>" SHEET (operator 2026-10-21, verbatim: "It's not about them being internal. They should be shareable ... make a new version
// that is for them ... keep the internal as inspiration and make them consistent between them, and then the new one is much simpler and use
// monologues for them and us with what they have to agree with their recognition and what we have to say, and what the action item is but
// first ... the first result what it would look like after it's done and then several columns for the steps ... and then our certainty should
// be included as well do it for all of them" · "the six human needs aren't readable enough"). One per person, built from the same lens file
// as the workbench, so the two never drift. The six needs are read as two short monologues, never as labelled cells.
export const SHARE_LENS_HEAD = ['ID', 'TOPIC', 'YOU, IN YOUR WORDS', 'US, IN OURS', 'WHAT WE HOPE YOU RECOGNISE', 'WHAT WE BRING', 'THE ACTION', 'THE RESULT — WHEN IT IS DONE', ...STEP_COLS, 'OUR CERTAINTY', ...TAIL];   // F6
export const SHARE_LENS_COLS = ['id', 'topic', 'monoTheirs', 'monoOurs', 'hear', 'say', 'act', 'result', ...STEP_KEYS, 'understoodCell'];
// C1197 THE READER LAYOUT (operator 2026-10-22, verbatim: "if you hit the link and it goes to a web view of the spreadsheet, it should be
// easy to navigate and understand what's there so the hierarchy of the page has to be easy to scan and easy to read"). A lens whose
// person.layout is 'reader' gets a six-column For sheet in place of the sixteen above: the row number, what it is, why it is theirs (their
// monologue), the pages to read (every https link the item carries, one per line), what we ask, and their comment. board-layout.mjs
// freezes the header, wraps the text and makes READ THIS the widest column. Guard: tests/vna/c1197-tend-sheet-for-maritha-row-layout.test.mjs.
export const READER_LENS_HEAD = ['#', 'WHAT IT IS', 'WHY IT IS YOURS', 'READ THIS', 'WHAT WE ASK', 'YOUR COMMENT (fill)'];
export const READER_LENS_COLS = ['num', 'whatItIs', 'whyYours', 'readThis', 'weAsk'];
export const linksOf = (x) => [...new Set([...(Array.isArray(x.read) ? x.read : []), ...[x.say, x.act, x.result, x.hear].join(' ').match(/https:\/\/[^\s,;)]+/g) || []]
  .map((u) => String(u).replace(/[.]+$/, '')))];
// G1 (sheet-legibility.mjs, operator 2026-10-22 "make it clear fast, scrolling for more context"): the status, what we do at the gate, the
// question and how well we understand it sit on the first screen; the needs → recognition → result → steps sequence (F2–F5) follows unchanged.
export const INTERNAL_LENS_HEAD =['ID', 'PRIORITY 0–9 (our guess)', 'TOPIC', 'STATUS', 'AT ≥80 % WE DO', 'THE QUESTION FOR THEM', 'WE UNDERSTAND IT', 'HORIZON', `THEM — ${NEEDS_ABBR}`, `US — ${NEEDS_ABBR}`, 'WHAT WE HOPE THEY RECOGNISE', 'WHAT WE BRING', 'THE RESULT', ...STEP_COLS, 'ON THEIR SHEET?', 'SOURCE', ...TAIL];
export const INTERNAL_LENS_COLS = ['id', 'clarity', 'topic', 'status', 'doesCell', 'question', 'understoodCell', 'horizon', 'theirs', 'ours', 'hear', 'say', 'result', ...STEP_KEYS, 'shareCell', 'source'];

export const shareState = (p) => (SHARE_STATES.includes(p.person?.share?.state) ? p.person.share.state : 'not yet');
export const shareReady = (p) => shareState(p) === 'yes';
export const actable = (x) => Number(x.understood) >= ACT_GATE && String(x.does || '').trim() !== '';
export function loadLens(slug) { return JSON.parse(readFileSync(resolve(REPO, LENS_DIR, `${slug}.json`), 'utf8')); }
export function lensSlugs() { try { return readdirSync(resolve(REPO, LENS_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { return []; } }
export const sheetName = (p, share) => (share ? `For · ${p.person.name}` : `Lens · ${p.person.name} (internal)`);
const readNd = (p) => { try { return readFileSync(resolve(REPO, p), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
export const pct = (v) => (v === undefined || v === null || v === '' ? 'UNMEASURED' : `${Math.round(Number(v) * 100)} %`);

// The rows a sheet carries, before compose() lays them under the head. Card rows (P-*) and need rows (N-*) are priority 9 so the
// clarity sort in board-requirements compose() keeps them on top; the focus items follow, in needs order.
export function lensRows(p, { share = false } = {}) {
  const hz = (h) => Number(String(h || '').replace(/\D/g, '')) || 99;
  const items = (p.items || []).filter((x) => !share || x.private !== true).slice().sort((a, b) => hz(a.horizon) - hz(b.horizon) || (b.understood ?? 0) - (a.understood ?? 0));
  // compose() sorts by clarity desc then id — the ids carry the order (nearest horizon, best understood) as a zero-padded prefix.
  return items.map((x, i) => {
    const row = { ...x, id: `F-${String(i + 1).padStart(2, '0')}`, srcId: x.id, clarity: 8,
      understoodCell: pct(x.understood), doesCell: actable(x) ? `ACT · ${x.does}` : `ASK first · ${x.question || '—'}`, shareCell: x.private ? 'private — workbench only' : 'on their sheet', status: x.status || 'open' };
    row.theirs = needsCell(x.why, 0); row.ours = needsCell(x.why, 1);
    row.monoTheirs = String(x.monologue?.theirs || 'UNMEASURED'); row.monoOurs = String(x.monologue?.ours || 'UNMEASURED'); row.act = String(x.act || 'UNMEASURED');
    const steps = Array.isArray(x.massive) ? x.massive : [x.action || 'UNMEASURED'];
    for (let j = 0; j < STEPS; j++) row[`s${j + 1}`] = j < STEPS - 1 ? (steps[j] || '') : steps.slice(STEPS - 1).join(' · ');
    // C1197 the reader layout's cells: the topic and what we hope you recognise, the person's own monologue, the links, the ask.
    row.num = row.id; row.whatItIs = String(x.hear || x.topic || 'UNMEASURED'); row.whyYours = row.monoTheirs;
    row.readThis = linksOf(x).join('\n') || 'UNMEASURED'; row.weAsk = String(x.act || x.question || 'UNMEASURED');   // F9: only READ THIS stacks lines
    return row;
  });
}

// The spec entries board-requirements.mjs reads: `lens-<slug>` (internal, always) and `share-<slug>` (the For sheet, for every person — F8; share state marks a DRAFT; a 'never' lens has none).
export function lensSpecs() {
  const out = {};
  for (const slug of lensSlugs()) {
    let p; try { p = loadLens(slug); } catch { continue; }
    const name = p.person.name;
    out[`lens-${slug}`] = { lens: slug, lensShare: false, share: false, src: `${LENS_DIR}/${slug}.json`, sheet: sheetName(p, false),
      title: `WORKBENCH · ${name} — where we think it through`, head: INTERNAL_LENS_HEAD, cols: INTERNAL_LENS_COLS,
      question: `Where does ${name} stand, in their own six needs, and what do we do next — act at ≥ ${ACT_GATE * 100} % or ask first?` };
    if (shareState(p) !== 'never') out[`share-${slug}`] = { lens: slug, lensShare: true, share: true, src: `${LENS_DIR}/${slug}.json`, sheet: sheetName(p, true),
      title: `For ${name} — ThetaDriven`, ...(p.person.layout === 'reader' ? { head: READER_LENS_HEAD, cols: READER_LENS_COLS, layout: 'reader' } : { head: SHARE_LENS_HEAD, cols: SHARE_LENS_COLS }),
      question: `Do you recognise your own position here, and what would you change?`, draft: !shareReady(p) };
  }
  return out;
}
export const lensShareSheets = () => new Set(Object.values(lensSpecs()).filter((S) => S.lensShare).map((S) => S.sheet));


// THE RULES TAB — the general lens rules, then this person's own (operator 2026-10-20, verbatim: "these are action items. Focus items.
// The whole point is to recognition write the rules from that paste into the rules and logs tabs for each of them. The point is to
// research them and basically they should recognize themselves. That's the wind condition so that means the rules I need to fit both
// them and the General"). Every general rule is written so it reads true to the person who opens the sheet AND to us; the internal
// sheet adds the rules that are ours alone. A person's own rules (person.rules [{text, share}]) follow, share:false ones internal only.
// Sources of the general lines: the pasted "Architecture of the Recognition Lens" (2026-10-20), corrected with the repo in mind.
export const LENS_RULES = [
  ['L1', 'WHAT THIS IS: a recognition sheet, not a task list and not a CRM record. It is right when you read it and recognise your own position, said more plainly than anyone has said it. Where it is wrong, your comment fixes it.'],
  ['L2', 'EVERY LINE IS ONE FOCUS ITEM, READ LEFT TO RIGHT: first the six needs in sequence (co connection · cn contribution · gr growth · uc uncertainty · ce certainty · si significance), one cell in your words and one in ours; then what we hope you recognise and what we bring; then the result; then the massive action, one step per column.'],
  ['L3', 'THE SEQUENCE NEVER CHANGES: connection first, significance last. Nothing is asked of you before the connection is right.'],
  ['L4', 'NOT PERSUASION: each row is what is in it for you. A row that serves only us does not belong here.'],
  ['L5', 'THE QUESTION: each item ends on the best question we can ask you, so you steer us from where you sit.'],
  ['L6', 'YOUR COMMENT: write anything, on any row, or nothing. If you write nothing we fill the sheet in from our calls. We answer in ELIAS REPLIES.'],
  ['L7', `WHEN WE ACT: once we understand what you wrote well enough (${ACT_GATE * 100} %), we act on it and tell you what we did by email; below that we ask one question first. What we did is on the Log tab.`],
  ['L8', 'NEED-TO-KNOW: only what you need for the next step is here.'],
];
export const LENS_RULES_INTERNAL = [
  ['L9', 'THE WIN CONDITION is recognition: their own words back ("that is me"), never our reading of the sheet. Research first; every fact carries its source; an unknown reads UNMEASURED.'],
  ['L10', `SHARE is its own call: are we talking now, is every share row need-to-know clean, does the sheet help them. ACT is the ${ACT_GATE * 100} % gate: on a focus item or a comment we understand that well, we execute (file the /steer row, arm the email through the comms pipeline, which still blocks under 95 per need).`],
  ['L11', 'CORRECTED FROM THE PASTE, ALWAYS: never a promise about agent behaviour (the record detects, places, prices, dispatches), never patent status, never tax steps or anyone\'s error on a share sheet, never an offer he has not made.'],
];
export function lensRulesRows(p, { share = false } = {}) {
  const pr = p.person || {};
  const card = [['C1', `WHERE YOU ARE: ${pr.where_they_are || 'UNMEASURED'}`], ['C2', `WHERE WE ARE: ${pr.where_we_are || 'UNMEASURED'}`], ['C3', `WHERE WE LEFT OFF: ${pr.last_call || 'UNMEASURED'}`],
    ...NEEDS.map((k, i) => [`M${i + 1}`, `${NEED_NAME[k].toUpperCase()} — you: ${((p.needs || {})[k] || [])[0] || 'UNMEASURED'} · us: ${((p.needs || {})[k] || [])[1] || 'UNMEASURED'}`]),
    ...(share ? [] : [['C4', `THE INTEREST THEY REPRESENT: ${pr.interest || 'UNMEASURED'}`], ['C5', `SHARE: ${shareState(p)} — ${pr.share?.why || ''}`]])];
  const own = (p.person?.rules || []).filter((r) => !share || r.share === true).map((r, i) => [`Y${i + 1}`, `FOR ${p.person.name.toUpperCase()}: ${r.text}`]);
  const draft = share && !shareReady(p) ? [['D0', 'DRAFT: we are still checking that this reads true to you. Nothing here has been sent; if you are reading it, tell us where it is wrong.']] : [];
  return [['RULE', 'HOW THIS SHEET WORKS', 'YOUR NOTE (fill)'], ...draft, ...LEGIBILITY_RULES, ...FORMAT_RULES, ...card, ...LENS_RULES, ...(share ? [] : [...LENS_RULES_INTERNAL, ...HOLD_RULES]), ...own];
}
// THE LOG TAB — what we did, read off the act ledger (one row per act, with its commit when it has one), never retyped.
export function lensLogRows(slug, { done = readNd(ACT_LEDGER), share = false, p = loadLens(slug) } = {}) {
  const internal = new Set((p.items || []).filter((x) => x.private === true).map((x) => x.id));
  return done.filter((d) => d.slug === slug && (!share || !internal.has(d.ref))).map((d, i) => [`A${i + 1}`, d.ts.slice(0, 16).replace('T', ' '), d.ref, d.field || '', d.words || '', d.did || '', d.commit || '']);
}

// THE ACT QUEUE: every item at or above the gate with what we do, and every comment typed on a lens sheet (theirs or his), each tagged
// for /steer with the horizon it serves. A row already in the act ledger is done and drops out.
export function actQueue({ answers = readNd('data/vna/board-answers.ndjson'), done = readNd(ACT_LEDGER) } = {}) {
  const did = new Set(done.map((d) => `${d.slug}\u0000${d.ref}`)); const q = [];
  for (const slug of lensSlugs()) {
    const p = loadLens(slug); const sheets = new Set([sheetName(p, false), sheetName(p, true)]);
    const rows = lensRows(p);
    for (const r of rows.filter((r) => r.srcId)) {
      const tag = `(tend: sheet=${sheetName(p, false)} row=${r.id} → ${r.horizon})`;
      if (did.has(`${slug}\u0000${r.srcId}`)) continue;
      q.push({ slug, ref: r.srcId, kind: actable(r) ? 'act' : 'ask', understood: r.understood, what: actable(r) ? r.does : r.question, tag });
    }
    for (const c of answers.filter((a) => sheets.has(a.tab) && /COMMENT|REPLIES/.test(String(a.field)) && String(a.value || '').trim() && !String(a.value).startsWith('✓ ') && parseCellWord(a.value)?.kind !== 'hold')) {   // H1: a HOLD comment is acted on by nobody
      const ref = `${c.id}·${c.field}·${c.hash || ''}`; if (did.has(`${slug}\u0000${ref}`)) continue;
      q.push({ slug, ref, kind: 'comment', understood: undefined, what: `${c.tab} · ${c.id}: "${String(c.value).slice(0, 200)}" — score it; ≥ 80 % understood → act, else answer with one question`, tag: `(tend: sheet=${c.tab} row=${c.id})` });
    }
  }
  return q;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a[0] === '--print' && a[1]) {
    const p = loadLens(a[1]); const share = a.includes('--share'); const S = lensSpecs()[`${share ? 'share' : 'lens'}-${a[1]}`];
    if (!S) { console.log(`✗ no ${share ? 'share' : 'internal'} sheet for ${a[1]} (share: ${shareState(p)})`); process.exit(1); }
    console.log(S.title); console.log(S.head.join(' │ '));
    for (const r of lensRows(p, { share })) console.log(S.cols.map((k) => String(r[k] ?? '').slice(0, 70)).join(' │ '));
  } else if (a[0] === '--act' && a[1] === 'done') {
    const ci = a.indexOf('--commit'); const commit = ci > 0 ? a[ci + 1] : ''; const rest = ci > 0 ? a.slice(0, ci) : a;
    const [, , slug, ref, ...note] = rest; if (!slug || !ref) { console.log('✗ --act done <slug> <item|cell> "<what we did>"'); process.exit(2); }
    appendFileSync(resolve(REPO, ACT_LEDGER), JSON.stringify({ ts: new Date().toISOString(), slug, ref, did: note.join(' '), commit }) + '\n'); console.log(`✓ ${slug} · ${ref} recorded`);
  } else if (a[0] === '--tabs') {
    const only = a.includes('--only') ? a[a.indexOf('--only') + 1] : null;
    const { writeCells, appendLogTab } = await import('./board-cells.mjs'); const { byFirstCell } = await import('./mailbox-rebuild.mjs');
    const { LOG_TAB, LOG_HEAD } = await import('./notes-to-log.mjs');
    const drive = JSON.parse(readFileSync(resolve(REPO, 'data/vna/board-drive.json'), 'utf8')).sheets;
    for (const S of Object.values(lensSpecs())) {
      if (only && S.lens !== only) continue; const id = drive[S.sheet]; if (!id) { console.log(`  · ${S.sheet}: not in the board folder yet — write it first`); continue; }
      const p = loadLens(S.lens); const rows = lensRulesRows(p, { share: S.lensShare });
      const lr = await writeCells(id, { tab: 'Rules', read: true }); if (lr.error || lr.off) { console.log(`  ✗ ${S.sheet}: ${lr.error || lr.why}`); continue; }
      const { ops, append } = byFirstCell(lr.values || [], rows); const w = await writeCells(id, { tab: 'Rules', ops, append });
      const l = await appendLogTab(id, LOG_TAB, LOG_HEAD, lensLogRows(S.lens, { share: S.lensShare, p }));
      console.log(w.error || l.error ? `  ✗ ${S.sheet}: ${w.error || l.error}` : `  ✓ ${S.sheet}: Rules ${rows.length - 1} line(s) · Log ${lensLogRows(S.lens, { share: S.lensShare, p }).length} act(s)`);
    }
  } else if (a[0] === '--act') {
    const q = actQueue();
    for (const k of ['act', 'comment', 'ask']) { const g = q.filter((x) => x.kind === k); if (!g.length) continue;
      console.log(`\n${k === 'act' ? `ACT — understood ≥ ${ACT_GATE * 100} %` : k === 'comment' ? 'COMMENTS — score, then act or ask' : `ASK FIRST — below ${ACT_GATE * 100} %`} (${g.length})`);
      for (const x of g) console.log(`  ${x.slug} · ${x.ref} · ${pct(x.understood)} · ${x.what} ${x.tag}`); }
  } else {
    for (const slug of lensSlugs()) { const p = loadLens(slug); const n = (p.items || []).filter(actable).length;
      console.log(`${slug} · share ${shareState(p)} · ${sheetName(p, false)}${shareReady(p) ? ` + ${sheetName(p, true)}` : ''} · ${n}/${(p.items || []).length} item(s) at ≥ ${ACT_GATE * 100} %`); }
  }
}
