#!/usr/bin/env node
// scripts/vna/steer-compile.mjs — C1221: THE STEER COMPILER. A raw dictation goes in; ONE txt comes out, the steer, expanded
// before any worker reads it, and bash-opened by default so the operator rewrites it on the spot.
// (operator 2026-10-22, verbatim: "whenever you write a steer, we should be combining this to do a retrosnowball ncd associative etc
// to maximise efficasy with the rules and hats of the /steer and bash open it as a txt file (by default) - if we do it correctly it
// should be eaasy to rewrite there on the spot" · "we should stop writing the /goal but perfect writing the steer / the /steer can
// have the simple goal (go untill all /steer asks are done or similaR)").
//
// LLM-FREE AND A PURE COMPOSER: every slot is filled by the door that already owns it, imported, never copied —
//   asks        steer.mjs splitAsks (the same split the dictation door uses, so the txt's rows are the rows /steer declares)
//   retro       retro-snowball.mjs retroGrow over the spec tree's walked contract rows, walked by snowball-refresh.mjs probeWalker
//               (a scratch tape, never the live walk tape). No walker → the gzip-nearest rows by spec-tree.mjs ncd, labelled so.
//   near        the gzip-nearest spec rows to the ask (spec-tree.mjs ncd over spec-clarity.mjs parseRows), open and ticked —
//               the associative read beside the retro one: what was already asked that this ask sits next to
//   hat         the snowball sidecar the UserPromptSubmit hook wrote for this prompt (steergoal.mjs readSidecar)
//   rules       rule-grab.mjs grab() — the rules as NEGATIVE constraints, with its own "unsupported guesses" note carried
//   vocabulary  behavior-promise.mjs findBannedPromises — a banned promise in the ask is NAMED, never silently rewritten
//   act         spec-clarity.mjs IRREVOCABLE_HEADLINE / OUTBOUND_HEADLINE — the operator's act is split from the worker's
//   basin       spec-clarity.mjs namedPaths on the ask, then citedPaths of the grown rows, kept only when onDisk
//   patterns    prompt-diagnose.mjs diagnose() — Prompt Master's patterns that read true on a raw ask (PM06 the whole thing, PM07 a
//               pointer). A pointer ask also carries its likely referent: the newest open dictated row (steer.mjs activeRow, the row a
//               short follow-up resolves to), labelled a candidate, never put in his mouth
//   guard       a proposed tests/vna/c<id>-<slug>.test.mjs off steer.mjs nextTopLevelId + slugify — the red witness comes first
// The head is a DRAFT (C1027 heads are written by plain-heads.mjs, a model call); the txt says so and the operator rewrites it.
//
// THE RATCHET: each ask has five slots that can come back empty — basin · retro · near · hat · rules. Every compile appends its fill to
// .thetacog/steer-compile.ndjson; `--check` reads the median fill of the last 20 against data/vna/steer-compile-floor.json, and
// `--raise` lifts the floor to that median. The floor only rises. A fall prints the slot that went empty, never a block.
//
//   node scripts/vna/steer-compile.mjs "<dictation>" [--no-open] [--json] [--no-walk]
//   node scripts/vna/steer-compile.mjs --check | --raise
//   node scripts/vna/steer-compile.mjs --backfill        rules + hats recomputed for asks compiled before they were recorded
// @guard tests/vna/c1221-the-steer-compiler.test.mjs
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, readdirSync, openSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decomposeLine } from './decompose-count.mjs';   // C2366: the decompose line, counted never split
import { labelOf } from '../ops/row-title.mjs';   // the STEER block names each ask "C#### · <title>" (operator 2026-11-05: "never just show the steer number")
import { splitAsks, slugify, nextTopLevelId, activeRow, askSpans, pathsNamedIn, loadTape, fromPointer, FROM_RE } from './steer.mjs';
import { projectDir } from './transcript-asks.mjs';
import { diagnose } from './prompt-diagnose.mjs';   // C1228: Prompt Master's patterns that read true on a raw ask
import { SPEC_MD, guardOf, namedPaths, citedPaths, onDisk, IRREVOCABLE_HEADLINE, OUTBOUND_HEADLINE } from './spec-clarity.mjs';
import { readSidecar } from './steergoal.mjs';
import { roomKey, roomFromTerminal } from '../../src/lib/pmu/room-key.mjs';   // the one room normaliser (KR4)
import { findBannedPromises } from '../voice/behavior-promise.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const OUT_DIR = process.env.VNA_STEER_COMPILE_DIR || resolve(REPO, '.thetacog/steers');
export const LEDGER = process.env.VNA_STEER_COMPILE_LEDGER || resolve(REPO, '.thetacog/steer-compile.ndjson');
export const FLOOR = process.env.VNA_STEER_COMPILE_FLOOR || resolve(REPO, 'data/vna/steer-compile-floor.json');
// C1221b — the record the board sheet reads (scripts/ops/board-steer.mjs): every compiled ask, newest compile wins per proposed id
export const RECORD = process.env.VNA_STEER_COMPILED || resolve(REPO, 'data/vna/steer-compiled.json');
export const RECORD_CAP = 80;
export const SLOTS = ['basin', 'retro', 'near', 'hat', 'rules'];
export const RATCHET_WINDOW = 20;
// THE ONE GOAL, one sentence, carried as the steer's last line (operator 2026-10-22: "the /steer can have the simple goal")
export const SIMPLE_GOAL = 'go until every ask in this steer is ticked by the commit that built it, or named STUCK / YOUR ACT with its reason';

// C1454 — A COMPILED ID IS RESERVED, NEVER HANDED OUT TWICE. nextTopLevelId reads only the spec, and a compiled steer's rows live
// in its txt and in RECORD until a room declares them, so two compiles before a declare minted the same ids: the 2026-10-29 tend
// rows C1433–C1437 (desks, F4 silicon, the ISN forecast) were shadowed by spec rows of the same numbers and never built, and on
// 2026-10-30 a second compile re-minted C1444–C1447. The first id is now past the highest id in the spec, in RECORD, and in every
// compiled steer file (OUT_DIR, local) and goals file (docs/specs/vna/goals, tracked). Guard: tests/vna/c1454-compiled-ids-are-reserved.test.mjs.
export const GOALS_DIR = process.env.VNA_STEER_GOALS_DIR || resolve(REPO, 'docs/specs/vna/goals');
import { reservedMax, readReserved as readReservedAt } from "./reserved-ids.mjs";   // C2159: one reader, shared with steer.mjs
export { reservedMax };
export function readReserved({ dirs = [OUT_DIR, GOALS_DIR], recordPath = RECORD } = {}) { return readReservedAt({ dirs, recordPath }); }

const shq = (s) => String(s).replace(/"/g, "'");

// C1332: a short plain head a reader can say aloud — sentence case (never ALL CAPS), cut at a word
// boundary, the id prefix counted inside the 80-character cap so the whole head line stays legible.
function cutAtWord(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const i = cut.lastIndexOf(' ');
  return i > 10 ? cut.slice(0, i) : cut;
}
export function headOf(id, ask, n = 80) {
  const prefix = `C${id} — `;
  const body = cutAtWord(String(ask).replace(/\s+/g, ' ').trim(), Math.max(10, n - prefix.length));
  return `${prefix}${body.charAt(0).toUpperCase()}${body.slice(1)}`;
}

// the verbatim span, wrapped at a word boundary so no line runs past `width`, quote marks only on
// the first and last wrapped line — the span reads as one sentence split across indented lines.
export function wrapQuoted(text, width, indent) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (!lines.length) return [`${indent}""`];
  return lines.map((l, i) => `${indent}${i === 0 ? '"' : ''}${l}${i === lines.length - 1 ? '"' : ''}`);
}

// name · percent · n/d · one plain-words meaning, column-aligned — the six percentages as a table
// a reader scans down, never a run-on line (steer-compile.mjs's old line 143 named in feedback_maximise-legibility-steer-files.md).
export function pctTable(grade) {
  const rows = PCTS.map((p) => { const g = grade[p.key]; return { name: p.name, pct: g.pct == null ? 'UNMEASURED' : `${g.pct}%`, nd: `${g.n}/${g.d}`, meaning: p.meaning }; });
  const w1 = Math.max(...rows.map((r) => r.name.length));
  const w2 = Math.max(...rows.map((r) => r.pct.length));
  const w3 = Math.max(...rows.map((r) => r.nd.length));
  return rows.map((r) => `  ${r.name.padEnd(w1)} · ${r.pct.padEnd(w2)} · ${r.nd.padEnd(w3)} · ${r.meaning}`);
}

// the act boundary: an ask whose uppercase reads as an irrevocable or outbound act is the operator's, the rest is the worker's
export function actOf(ask) {
  const U = String(ask).toUpperCase();
  if (IRREVOCABLE_HEADLINE.test(U)) return { cls: 'YOUR ACT', why: 'an irrevocable act (push · publish · migration · send) — the worker drafts, the operator arms' };
  // spec-clarity's IRREVOCABLE_HEADLINE reads row headlines (GIT PUSH, NPM PUBLISH …); a raw dictation says "ship" or "deploy"
  // (CLAUDE.md PUSH ≠ DEPLOY: production deploys only when the operator says ship or deploy), so those two verbs are named here
  if (/\b(SHIP|DEPLOY)\b/.test(U)) return { cls: 'YOUR ACT', why: 'a production deploy (npm run ship) — runs only when the operator says ship or deploy in the session' };
  if (OUTBOUND_HEADLINE.test(U)) return { cls: 'YOUR ACT', why: 'outbound to a person or the public — composed as a draft, armed by the operator' };
  return { cls: 'WORKER', why: 'code, tests, docs in this repo — the worker builds it until its guard is green' };
}

// the basin: paths the ask names, then the paths the grown rows cite as existing — only what resolves on disk
export function basinOf(ask, rowTexts, { exists = (p) => onDisk(p, REPO) } = {}) {
  const out = [];
  for (const p of [...namedPaths(ask), ...rowTexts.flatMap((t) => citedPaths(t))]) if (!out.includes(p) && exists(p)) out.push(p);
  return out.slice(0, 6);
}

// the snowball: retroGrow with a walker; without one (no binary, --no-walk), the gzip-nearest rows, labelled — never silently
export async function snowballOf(ask, { tree, walk = null, k = 3 } = {}) {
  const { rowsOf, retroGrow } = await import('./retro-snowball.mjs');
  const rows = rowsOf(tree);
  if (!rows.length) return { how: 'UNMEASURED — no walked contract rows in the spec tree (npx thetacog-mcp spec-tree)', rows: [] };
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  if (walk) {
    const g = await retroGrow(tree, ask, { walk, rows });
    if (g.set && g.set.length) return { how: `retro snowball · ${g.set.length} rows · stop ${g.stop ? g.stop.why : '—'} at overlap ${g.overlap}`, rows: g.set.map((id) => byId[id]).filter(Boolean) };
    var walkWhy = g.why || (g.steps && g.steps[0] && g.steps[0].err) || 'the walk grew no rows';
  }
  const { ncd } = await import('./spec-tree.mjs');
  const a = String(ask).toLowerCase();
  const near = rows.map((r) => ({ r, d: ncd(a, r.text.toLowerCase()) })).sort((x, y) => x.d - y.d).slice(0, k);
  return { how: `gzip-nearest ${k} (retro not run — ${walk ? walkWhy : 'no walker'})`, rows: near.map((x) => ({ ...x.r, ncd: +x.d.toFixed(3) })) };
}

// the associative read: the k spec rows nearest the ask, ticked or open — ranked by rule-grab.mjs grab() over the spec rows as its
// corpus (one sensor home: gzip-NCD at a matched eye, IDF overlap under the gzip floor, the lexical gate named). A bare ncd() over
// whole rows let the shortest rows (C0, C2, C4) win every ask: at an unmatched aperture NCD measures length, not meaning.
export async function nearOf(ask, specText, { k = 3 } = {}) {
  const { parseRows } = await import('./spec-clarity.mjs'); const { grab } = await import('../cog/rule-grab.mjs');
  const rows = parseRows(specText).filter((r) => r.text.length >= 80);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const corpus = rows.map((r) => ({ file: 'spec', line: r.line, title: r.id, text: r.text }));
  const g = grab(String(ask), { corpus, cap: k, repo: REPO });
  return (g.hits || []).map((h) => ({ id: h.title, ticked: byId[h.title] ? byId[h.title].ticked : false, text: byId[h.title] ? byId[h.title].text : h.span, ncd: h.ncd, sensor: g.sensor }));
}

async function rulesOf(ask) {
  try { const { grab } = await import('../cog/rule-grab.mjs'); const r = grab(ask, { cap: 3, repo: REPO }); return { hits: r.hits || [], note: r.lexicallySupported === false ? r.note : null }; }
  catch (e) { return { hits: [], note: `rule-grab unavailable — ${String(e.message || e).slice(0, 80)}` }; }
}

// one ask → its contract. Pure over what it is handed (tree, walk, sidecar, spec text); the caller does the reads.
export async function compileAsk(ask, { id, tree, walk, sidecar, exists, specText = '' } = {}) {
  const snow = await snowballOf(ask, { tree, walk });
  const near = await nearOf(ask, specText);
  const patterns = diagnose(ask);
  let pointer = null;
  if (patterns.some((x) => x.id === 'PM06' || x.id === 'PM07')) {
    const a = activeRow(specText); const line = a ? String(specText).split('\n')[a.i] : '';
    pointer = a ? { id: a.id, text: line.replace(/^\s*-\s*\[[ xX]\]\s*/, '').replace(/\s+/g, ' ').slice(0, 160) } : { id: null, text: null };
  }
  const rules = await rulesOf(ask);
  const banned = findBannedPromises(String(ask));
  const basin = basinOf(ask, [...snow.rows, ...near].map((r) => r.text), exists ? { exists } : {});
  const slug = slugify(ask);
  const fill = { basin: basin.length > 0, retro: snow.rows.length > 0, near: near.length > 0, hat: !!(sidecar && sidecar.hat), rules: rules.hits.length > 0 };
  return { id: `C${id}`, ask, head: headOf(id, ask), slug, guard: `tests/vna/c${id}-${slug}.test.mjs`, act: actOf(ask), basin, snow, near, patterns, pointer, rules, banned, hat: sidecar && sidecar.hat ? sidecar : null, fill };
}

// THE SHAPE IS PROMPT MASTER'S TEMPLATE M ("Current Claude Task Brief", github.com/nidhinjs/prompt-master @49b3a72, MIT,
// references/templates.md), used as it ships: Objective · Context · Target State · Scope · Constraints · Acceptance Criteria ·
// Action Boundaries · Progress Evidence. Every field is filled from a door above, never by a model. Its one rule this repo does not
// take is "ask up to three clarifying questions": here an empty field prints UNMEASURED and the operator rewrites it in the txt.
export const TEMPLATE_M = 'Template M — Current Claude Task Brief (prompt-master @49b3a72, MIT)';
const neighbourGuards = (u) => u.near.filter((r) => r.ticked).map((r) => guardOf(r.text)).filter(Boolean);
export function renderSteer(units, { dictation, at, grade = null }) {
  const L = [];
  L.push(`/steer — compiled ${at} · ${units.length} ask${units.length === 1 ? '' : 's'} · rewrite anything below, then paste the STEER block after /steer`);
  L.push('', '═══ THE STEER ═══');
  for (const u of units) {
    L.push(u.head);
    L.push(`  title: ${labelOf(u.id, { text: u.ask })}`);   // an indented line: steer.mjs compiledSteerAsks reads the head and the verbatim span only
    L.push('  draft head — rewrite it');
    L.push('  verbatim:');
    for (const line of wrapQuoted(u.ask, 96, '    ')) L.push(line);
    L.push(`  act: ${u.act.cls}`);
    L.push(`  guard: \`${u.guard}\``);
    L.push('');
  }
  L.push(`GOAL: ${SIMPLE_GOAL}.`);
  if (grade) {
    L.push('', '═══ THE SIX PERCENTAGES (measured over this steer · the floor only rises: steer-compile.mjs --check) ═══');
    for (const line of pctTable(grade)) L.push(line);
  }
  for (const u of units) {
    const keep = neighbourGuards(u);
    L.push('', `─── ${u.id} · ${TEMPLATE_M} ───`);
    L.push('## Objective', `  ${u.head} — operator ${at}, verbatim: "${shq(u.ask)}"`);
    for (const x of u.patterns) {
      L.push(`  ✗ ${x.id} ${x.name} (Prompt Master #${x.p}) — ${x.rule} · fix: ${x.fix}`);
      if (x.jobs) x.jobs.forEach((j, i) => L.push(`    job ${i + 1}: ${j.slice(0, 140)}`));
    }
    if (u.pointer) L.push(u.pointer.id ? `  pointer: the ask names its object outside itself. Candidate referent, the newest open dictated row ${u.pointer.id}: ${u.pointer.text} — name it here, or a worker starts blind` : '  pointer: the ask names its object outside itself and no open dictated row is on the spec — name the object here');
    L.push('## Context (what exists now)');
    L.push(`  near — already asked, gzip-NCD via rule-grab:${u.near.length ? '' : ' UNMEASURED — no spec rows'}`);
    for (const r of u.near) L.push(`    ↳ ${r.ticked ? '[x]' : '[ ]'} ${r.id} (ncd ${r.ncd}): ${r.text.replace(/\s+/g, ' ').slice(0, 150)}`);
    L.push(`  snowball — ${u.snow.how}`);
    for (const r of u.snow.rows) L.push(`    ↳ ${r.id}${r.ncd != null ? ` (ncd ${r.ncd})` : ''}${r.pixel ? ` @ ${r.pixel}` : ''}: ${r.text.replace(/\s+/g, ' ').slice(0, 150)}`);
    L.push(`  hat — ${u.hat ? `${u.hat.hat}${u.hat.coord ? ` · ${u.hat.coord} ${u.hat.name || ''}` : ''}: "As ${u.hat.hat}: build ${u.id} until ${u.guard} is green; nothing else."` : 'UNMEASURED — no snowball sidecar for this prompt (the prompt hook writes it)'}`);
    L.push('## Target State', `  ${u.guard} exists, was seen red on the tree as it stood, and is green; ${u.id} is ticked by the commit that built it`);
    L.push('## Scope', `  - Work only in: ${u.basin.length ? u.basin.join(' · ') : 'UNMEASURED — the ask names no path on disk and the near rows cite none; name the file here'} · ${u.guard}`);
    L.push('  - Do NOT touch: a path another session holds (node scripts/ops/wip.mjs check <paths>) · generated artifacts (edit the generator)');
    L.push('## Constraints');
    for (const h of u.rules.hits) L.push(`  ✗ ${String(h.title || '').slice(0, 110)} — ${h.file}:${h.line}`);
    if (!u.rules.hits.length) L.push('  UNMEASURED — rule-grab found no rule for this ask');
    if (u.rules.note) L.push(`  (${u.rules.note.slice(0, 160)})`);
    L.push(`  vocabulary: ${u.banned.length ? u.banned.map((b) => `${b.label}: "${b.snippet}"`).join(' · ') + ' — the worker writes DETECTED · PLACED · PRICED · DISPATCHED' : 'clean against behavior-promise.mjs'}`);
    L.push('  Only make changes directly requested. One ask, one commit.');
    L.push('## Acceptance Criteria', `  - [ ] ${u.guard} fails before the change`, `  - [ ] ${u.guard} passes after it`);
    for (const g of keep) L.push(`  - [ ] ${g} stays green (the ticked neighbour)`);
    L.push(`  - [ ] node scripts/vna/steer.mjs verify ${u.id} --since <head-at-dispatch> ticks it`);
    L.push('## Action Boundaries', `  ${u.act.cls} — ${u.act.why}`, '  Stop and name it before: a push, a publish, a send, a migration, money, a deletion of work you did not write.');
    L.push('## Progress Evidence', '  The commit sha, the guard path, and the guard output. A claim with no tool result is not progress.');
    L.push(`  (empty slots: ${SLOTS.filter((s) => !u.fill[s]).join(' · ') || 'none'})`);
  }
  L.push('', '═══ DICTATION AS GIVEN ═══', String(dictation).trim(), '');
  return L.join('\n');
}

// THE SIX PERCENTAGES OF A STEER — the house order (six-percentages.mjs PCT_ORDER), each a construct a steer can carry, computed over
// the units with its numerator and denominator, or UNMEASURED on a zero denominator (never 100, never 0 — six-pct.mjs's rule).
export const PCTS = [
  { key: 'predictive', name: 'Predictive Power', construct: 'asks whose done-when is a named guard AND a basin on disk', meaning: 'a named guard tied to a file on disk', ok: (u) => !!u.guard && u.basin.length > 0 },
  { key: 'impact', name: 'Impact', construct: 'asks whose act is decided, that land on a file and name their own object (the worker can start without asking)', meaning: 'the worker can start without asking', ok: (u) => (u.act.cls === 'YOUR ACT' || u.basin.length > 0) && !u.pointer },
  { key: 'confidence', name: 'Confidence', construct: 'asks whose context came from a measured read (retro walked, or near rows lexically supported)', meaning: 'the context came from a measured read', ok: (u) => (u.snow.rows.length > 0 && /^retro snowball/.test(u.snow.how)) || (u.near.length > 0 && !u.rules.note) },
  { key: 'anti-regression', name: 'Anti-regression', construct: 'asks carrying a ticked neighbour\'s guard to keep green', meaning: 'keeps a ticked neighbour\'s guard green', ok: (u) => neighbourGuards(u).length > 0 },
  { key: 'anti-normalisation', name: 'Anti-normalisation', construct: 'asks with no banned promise reaching the worker and a hat at their coordinate (not the average voice)', meaning: 'no banned promise, a hat at its coordinate', ok: (u) => u.banned.length === 0 && !!u.hat },
  { key: 'sufficiency', name: 'Sufficiency', construct: 'slots filled across the asks (basin · retro · near · hat · rules)', meaning: 'slots filled across the asks', count: (us) => [us.reduce((a, u) => a + SLOTS.filter((s) => u.fill[s]).length, 0), us.length * SLOTS.length] },
];
// one ask's score: how many of the six it carries (sufficiency counts when no slot came back empty)
export function unitScore(u) { return PCTS.filter((p) => (p.count ? SLOTS.every((s) => u.fill[s]) : p.ok(u))).length; }
// PROVENANCE — EVERY ASK IS REVERSE-DISCERNIBLE TO THE TAPE (operator 2026-11-05, verbatim: "ask verbatim might include an exact date
// and time, on which transcript it came from, for example, or which agent created it. This is supposed to be reverse discernible back to
// the tape" · "Every steer is a project. Or a sub-project that's taxonomically part of the larger graph of projects"). No model: every field
// is read off what exists — the clock, the env the hook or the harness hands this process, the transcript file on disk, the tape steer.mjs
// stamps its rows from (the same fromPointer, so a compiled ask and its declared row cite the same tape row). A field that is not there
// reads UNMEASURED with why, never a guess. The PROJECT is the steer itself: its id is derived from the txt's own name (P-<date>-<slug>),
// so an old record row with only `file` gets the same id at read time (board-steer.mjs projectOf). Guard: tests/ops/steer-compiled-two-tabs.test.mjs.
export const projectIdOf = (path) => (path ? `P-${basename(String(path), '.txt')}` : '');
export function projectTitleOf(ask, n = 60) {
  const first = String(ask || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?;:,]+$/, '');
  const t = cutAtWord(first, n).replace(/[\s,;:—–-]+$/, ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
// THE AGENT'S ROOM when THETACOG_ROOM is unset (operator 2026-11-05: "find and fix all the half finished parts" — 21 of 21 provenance rows
// read "room UNMEASURED"). Read off what exists, in this order, each named on the cell: (1) THETACOG_ROOM; (2) the terminal the process
// runs in (room-key.mjs roomFromTerminal, the scripts/room.sh table); (3) the session's own Originating-Terminal trailers in its transcript,
// majority vote through roomKey (the convention every commit message here carries); (4) the session's lens receipts' running_in.key,
// majority vote (the map kr42-job-units.mjs sessionRoomMap reads, bounded to this one session). None → UNMEASURED with the reason.
export const ROOM_TRANSCRIPT_MAX = 64 * 1024 * 1024;
export function roomOf({ env = process.env, session = null, transcript = null, receiptsDir = resolve(REPO, '.thetacog/lens-receipts') } = {}) {
  if (env.THETACOG_ROOM) return { room: roomKey(env.THETACOG_ROOM) || env.THETACOG_ROOM, via: 'THETACOG_ROOM' };
  const { THETACOG_ROOM: _drop, ...rest } = env; const term = roomFromTerminal(rest);
  if (term) return { room: term, via: `terminal ${env.TERM_PROGRAM || 'env'}` };
  const vote = (labels) => { const v = {}; for (const l of labels) { const k = roomKey(l); if (k) v[k] = (v[k] || 0) + 1; } const e = Object.entries(v).sort((a, b) => b[1] - a[1]); return e.length ? { room: e[0][0], n: e[0][1], of: e.reduce((a, x) => a + x[1], 0) } : null; };
  const why = [];
  if (transcript && !/^UNMEASURED/.test(transcript) && existsSync(transcript)) {
    let txt = ''; try { txt = readFileSync(transcript, 'utf8'); } catch {}
    if (txt.length > ROOM_TRANSCRIPT_MAX) why.push('transcript over the read cap');
    else { const w = vote([...txt.matchAll(/Originating-Terminal: ([^\\"`\n]{1,40})/g)].map((m) => m[1]));
      if (w) return { room: w.room, via: `the session's Originating-Terminal trailers (${w.n} of ${w.of})` }; why.push('no Originating-Terminal trailer naming a room in its transcript'); }
  } else why.push('no transcript file');
  if (session) {
    const idx = join(receiptsDir, 'index.ndjson'); const ids = [];
    try { for (const l of readFileSync(idx, 'utf8').split('\n')) if (l.includes(session)) { try { const j = JSON.parse(l); if (j.session === session && j.id) ids.push(j.id); } catch {} } } catch {}
    const keys = []; for (const id of ids.slice(-200)) { try { const r = JSON.parse(readFileSync(join(receiptsDir, `${id}.json`), 'utf8')); if (r.running_in && r.running_in.key) keys.push(r.running_in.key); } catch {} }
    const w = vote(keys); if (w) return { room: w.room, via: `the session's lens receipts (${w.n} of ${w.of})` };
    why.push(ids.length ? 'its lens receipts name no room' : 'no lens receipt for the session');
  } else why.push('no session id');
  return { room: null, via: null, why: `no THETACOG_ROOM, no known terminal, ${why.join(', ')}` };
}
export const roomCell = (r) => (r.room ? `room ${r.room} (via ${r.via})` : `room UNMEASURED — ${r.why}`);
export function provenanceOf({ path, env = process.env, transcriptDir = projectDir(REPO), now = new Date() } = {}) {
  const session = env.VNA_STEER_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || null;
  let transcript = env.VNA_STEER_TRANSCRIPT || null;
  if (!transcript && session) { const f = join(transcriptDir, `${session}.jsonl`); transcript = existsSync(f) ? f : `UNMEASURED — session ${session} has no transcript file in ${transcriptDir}`; }
  if (!transcript) transcript = 'UNMEASURED — no session id in the env or the hook payload';
  const agent = [roomCell(roomOf({ env, session, transcript })), env.AI_AGENT || env.CLAUDE_CODE_ENTRYPOINT || null, `pid ${process.pid}`, `via ${env.VNA_STEER_VIA || 'steer-compile'}`].filter(Boolean).join(' · ');
  return { when: now.toISOString(), session, transcript, agent, runLog: path ? relative(REPO, String(path).replace(/\.txt$/, '.run.log')) : '', spec: relative(REPO, SPEC_MD) };
}
// one rule-grab hit → one record row (the board's Rules tab): its title, where it lives, why it was picked
export const ruleRows = (hits) => (hits || []).map((h) => ({ title: h.title || '', at: h.file ? `${h.file}:${h.line}` : (h.at || ''), why: [(h.overlap || []).slice(0, 5).join(' '), typeof h.ncd === 'number' ? `ncd ${h.ncd.toFixed(3)}` : ''].filter(Boolean).join(' · ') }));
// the hat line in the sidecar's own shape (snowball-refresh.mjs): `hat <name> [<pixel>] · <pixel> <full name>`
export const hatLineOf = (hat, coord, name) => `hat ${hat}${coord ? ` [${coord}] · ${coord}${name ? ` ${name}` : ''}` : ''}`;
export const HAT_HOW = 'the ask walked by the probe walker (snowball-refresh.mjs probeWalker, a scratch tape) → the hat at its own coordinate (spec-tree.mjs coordinateMass)';

// BACKFILL (operator 2026-11-05, looking at a Rules tab where every one of 77 rows read UNMEASURED: "lets find and fix all the half
// finished parts"). rule-grab and the hat at a coordinate are deterministic over the ask's text, so an ask compiled before either was
// recorded gets them recomputed NOW and stamped `rulesRecomputed` / `hatRecomputed` with the ISO time — never written as if they were
// read when it compiled. The hat is the ask's OWN coordinate (one walk of its text), not the snowball leaf the prompt hook seeded at
// compile time (that depended on the /goal in force then and is not recoverable); HAT_HOW says so on the row. A recompute that fails
// leaves the slot absent with `rulesUnmeasured` / `hatUnmeasured` naming why. Rows already carrying a slot are never touched.
export async function backfillRecord({ recordPath = RECORD, now = new Date(), rules = rulesOf, walk = null, hatAt = null, nameOf = null, tape = undefined, specText = undefined, receiptsDir = null, write = true } = {}) {
  let j = { asks: [] }; try { j = JSON.parse(readFileSync(recordPath, 'utf8')); } catch (e) { return { error: `no record at ${recordPath}: ${e.message}` }; }
  const iso = now.toISOString(); const t0 = Date.now(); const out = { rules: 0, hats: 0, rulesFailed: 0, hatsFailed: 0, tapes: 0, parents: 0, tapesFailed: 0, rooms: 0, roomsFailed: 0, asks: (j.asks || []).length };
  if (tape === undefined) { try { tape = loadTape(); } catch { tape = []; } }
  if (specText === undefined) specText = existsSync(SPEC_MD) ? readFileSync(SPEC_MD, 'utf8') : '';
  if (!walk) { const { probeWalker } = await import('./snowball-refresh.mjs'); walk = probeWalker(); }
  if (!hatAt) { const { coordinateMass } = await import('./spec-tree.mjs'); hatAt = coordinateMass; }
  if (!nameOf) { const { fullName } = await import('./mesh.mjs'); nameOf = fullName; }
  for (const a of j.asks || []) {
    if (!Array.isArray(a.rules)) {
      try { const r = await rules(String(a.ask || '')); a.rules = ruleRows(r.hits); a.rulesNote = r.note || null; a.rulesRecomputed = iso; delete a.rulesUnmeasured; out.rules++; }
      catch (e) { a.rulesUnmeasured = `recompute failed ${iso}: ${String(e.message || e).slice(0, 100)}`; out.rulesFailed++; }
    }
    if (a.hat === undefined) {
      let why = null;
      try {
        const w = walk(String(a.ask || ''));
        if (!w || !w.pixel) why = `the walk gave no pixel${w && w.err ? ` (${w.err})` : ''}`;
        else { const m = await hatAt(w.pixel); if (!m || !m.hat) why = `no hat indexed at ${w.pixel}`;
          else { const name = nameOf(w.pixel) || null; a.hat = { hat: m.hat, coord: w.pixel, name, leaf: null, line: hatLineOf(m.hat, w.pixel, name), recomputed: iso, how: HAT_HOW }; a.hatRecomputed = iso; delete a.hatUnmeasured; out.hats++; } }
      } catch (e) { why = String(e.message || e).slice(0, 100); }
      if (why) { a.hatUnmeasured = `recompute failed ${iso}: ${why}`; out.hatsFailed++; }
    }
    // the agent's room, derived after the fact off the session it was compiled in (never the env of this backfill process)
    if (typeof a.agent === 'string' && /^room UNMEASURED(?! —)/.test(a.agent)) {
      const r = roomOf({ env: {}, session: a.session || null, transcript: a.transcript || null, ...(receiptsDir ? { receiptsDir } : {}) });
      a.agent = a.agent.replace(/^room UNMEASURED/, r.room ? `room ${r.room} (via ${r.via}, derived ${iso})` : `room UNMEASURED — ${r.why} (checked ${iso})`); r.room ? out.rooms++ : out.roomsFailed++;
    }
    // the tape row: the verbatim ask on the tape now (stamped tapeRecomputed), else the parent dictation's span, else why neither
    if (!a.tape && !a.tapeParent) {
      const own = sessionTape(a.transcript);
      const hit = (tape.length ? fromPointer(String(a.ask || ''), tape) : null) || (own.length ? fromPointer(String(a.ask || ''), own) : null);
      const par = hit ? null : parentSpanOf(a.ask, { specText, tape }) || (own.length ? parentSpanOf(a.ask, { specText, tape: own }) : null);
      if (hit) { a.tape = hit.pointer; a.tapeRecomputed = iso; delete a.tapeUnmeasured; out.tapes++; }
      else if (par) { a.tapeParent = par.pointer; a.tapeParentVia = par.via; a.tapeParentRecomputed = iso; delete a.tapeUnmeasured; out.parents++; }
      else { a.tapeUnmeasured = `${parentMissWhy(a.ask)} (checked ${iso})`; out.tapesFailed++; }
    }
  }
  out.ms = Date.now() - t0;
  if (write) writeFileSync(recordPath, JSON.stringify(j, null, 2) + '\n');
  return out;
}
// PARENT SPAN (operator 2026-11-05: "find and fix all the half finished parts"). A chair decomposition ("Chair decomposition of the
// operator's … (C2330) — …") or a chair row that leads with his own words ("Build and ratchet the implied ones too (operator …): …") is no
// verbatim span of the tape, so fromPointer found nothing and the row read UNMEASURED. It inherits the span of the dictation it was split
// from, found the two ways the record allows, never by a guess: (1) the lead clause names its parent row "(C2330)" → that spec row's own
// `from: tape:…` pointer (the one steer.mjs stamped when it declared the parent); (2) the lead clause (before the first " — " or ": ",
// a trailing "(operator <date>)" dropped, ≥ 24 chars and ≥ 4 words) is itself verbatim on the tape → fromPointer's pointer.
// Neither → null, and the caller says UNMEASURED with the reason.
export const PARENT_MIN_CHARS = 24;
export function leadClauseOf(ask) { return String(ask || '').replace(/\s+/g, ' ').trim().split(/\s+[—–]\s+|:\s/)[0].replace(/\s*\((?:operator|chair)\b[^)]*\)\s*$/i, '').trim(); }
export function parentSpanOf(ask, { specText = '', tape = [] } = {}) {
  const lead = leadClauseOf(ask);
  const named = /\((C\d{2,5}[a-z]?)\)/.exec(lead);
  if (named) {
    const esc = named[1]; const line = String(specText).split('\n').find((l) => new RegExp(`^\\s*- \\[[ xX]\\] ${esc}\\b`).test(l));
    const f = line && FROM_RE.exec(line);
    if (f) return { pointer: f[0].slice(6), via: `parent row ${esc}'s own from: pointer` };
  }
  if (lead.length >= PARENT_MIN_CHARS && lead.split(' ').length >= 4) { const hit = fromPointer(lead, tape); if (hit) return { pointer: hit.pointer, via: 'its lead clause, verbatim on the tape' }; }
  return null;
}
// THE ASK'S OWN SESSION AS A TAPE. loadTape reads the 2 newest interactive sessions, so a backfill run an hour later no longer sees the
// session a steer compiled in (measured 2026-11-05: C2351–C2359's lead clause left the window between two runs). The record names that
// session's transcript; read alone through the same loadTape (a one-file dir, no goal files, no chat log), its rows carry the same
// tapeRowId, so a pointer found here is the pointer the live tape gave while that session was on it.
const _sessionTapes = new Map();
export function sessionTape(transcript) {
  if (!transcript || /^UNMEASURED/.test(String(transcript)) || !existsSync(transcript)) return [];
  if (_sessionTapes.has(transcript)) return _sessionTapes.get(transcript);
  let t = [];
  try { const d = mkdtempSync(join(tmpdir(), 'steer-session-tape-')); symlinkSync(transcript, join(d, basename(transcript)));
    t = loadTape({ dir: d, goalsDir: null, chatLog: join(d, 'no-chat-log.ndjson'), tapeFile: '' }); } catch { t = []; }
  _sessionTapes.set(transcript, t); return t;
}
export const parentMissWhy = (ask) => { const lead = leadClauseOf(ask); const named = /\((C\d{2,5}[a-z]?)\)/.exec(lead);
  return named ? `parent row ${named[1]} carries no from: tape pointer and the lead clause is not on the tape` : 'names no parent row and its lead clause is on neither the tape (the 2 newest interactive sessions) nor its own session\'s transcript'; };
export function recordAsks(units, { at, path, recordPath = RECORD, prov = null, tapes = [], parents = [], project = null } = {}) {
  let j = { asks: [] }; try { j = JSON.parse(readFileSync(recordPath, 'utf8')); } catch {}
  const by = new Map((j.asks || []).map((x) => [x.id, x]));
  const P = prov || provenanceOf({ path });
  const proj = project || { id: projectIdOf(path), title: projectTitleOf(units[0] && units[0].ask) };
  units.forEach((u, i) => by.set(u.id, { id: u.id, head: u.head, ask: u.ask, act: u.act.cls, guard: u.guard, basin: u.basin, near: u.near.map((r) => r.id), score: unitScore(u), patterns: u.patterns.map((x) => x.id), empty: SLOTS.filter((s) => !u.fill[s]), at, file: relative(REPO, path),
    project: proj.id, projectTitle: proj.title, ...P, tape: tapes[i] || null, ...(!tapes[i] && parents[i] ? { tapeParent: parents[i].pointer, tapeParentVia: parents[i].via } : !tapes[i] ? { tapeUnmeasured: parentMissWhy(u.ask) } : {}), files: pathsNamedIn(u.ask, REPO),
    // the rules the brief carried (rule-grab, why each was picked) and the hat it was read through — the board's Rules and Hats tabs
    rules: ruleRows(u.rules && u.rules.hits),
    rulesNote: (u.rules && u.rules.note) || null,
    hat: u.hat ? { hat: u.hat.hat || null, coord: u.hat.coord || null, name: u.hat.name || null, leaf: u.hat.leaf || null, line: u.hat.line || null } : null, template: TEMPLATE_M }));
  const asks = [...by.values()].sort((x, y) => String(y.at).localeCompare(String(x.at)) || (x.id < y.id ? -1 : 1)).slice(0, RECORD_CAP);
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ note: 'written by scripts/vna/steer-compile.mjs on every compile; read by scripts/ops/board-steer.mjs (the Steer · Compiled sheet)', asks }, null, 2) + '\n');
  return asks;
}
export function gradeSteer(units) {
  const g = {};
  for (const p of PCTS) {
    const [n, d] = p.count ? p.count(units) : [units.filter(p.ok).length, units.length];
    g[p.key] = { n, d, pct: d ? Math.round((100 * n) / d) : null };
  }
  return g;
}

export function openTxt(path) {
  if (process.env.VNA_STEER_COMPILE_NO_OPEN === '1') return { opened: false, why: 'VNA_STEER_COMPILE_NO_OPEN=1' };
  const cmd = process.env.VNA_STEER_COMPILE_OPENER || (process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null);
  if (!cmd) return { opened: false, why: `no opener on ${process.platform}` };
  try { execFileSync(cmd, [path], { stdio: 'ignore' }); return { opened: true, why: null }; } catch (e) { return { opened: false, why: `${cmd} failed: ${e.code || e.status || e.message}` }; }
}

const fillOf = (units) => units.length ? units.reduce((a, u) => a + SLOTS.filter((s) => u.fill[s]).length, 0) / (units.length * SLOTS.length) : 0;

export async function compile(dictation, { open = true, walk = undefined, tree = undefined, sidecar = undefined, specText = undefined, reserved = undefined, at = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }), exists, tape = undefined, env = process.env, transcriptDir = undefined } = {}) {
  const asks = splitAsks(dictation);
  if (!asks.length) return { path: null, units: [], why: 'empty dictation' };
  if (tree === undefined) { try { const { readTree, TREE } = await import('./spec-tree.mjs'); tree = readTree(TREE); } catch { tree = null; } }
  if (walk === undefined) { try { const { probeWalker } = await import('./snowball-refresh.mjs'); walk = probeWalker(); } catch { walk = null; } }
  if (sidecar === undefined) sidecar = readSidecar();
  const specInjected = specText !== undefined;
  if (specText === undefined) specText = existsSync(SPEC_MD) ? readFileSync(SPEC_MD, 'utf8') : '';
  // C1454: past every reserved id too; an injected spec (the guards' fixtures) keeps its own numbering unless reserved is passed
  const held = reserved !== undefined ? reserved : specInjected ? 0 : readReserved();
  const first = Math.max(nextTopLevelId(specText), held + 1);
  const units = [];
  for (let i = 0; i < asks.length; i++) units.push(await compileAsk(asks[i], { id: first + i, tree, walk, sidecar, exists, specText }));
  const grade = gradeSteer(units);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${at}-${slugify(asks[0])}.txt`);
  writeFileSync(path, renderSteer(units, { dictation, at, grade }));
  const fill = +fillOf(units).toFixed(3);
  const pcts = Object.fromEntries(PCTS.map((p) => [p.key, grade[p.key].pct]));
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), asks: units.length, fill, pcts, empty: units.flatMap((u) => SLOTS.filter((s) => !u.fill[s]).map((s) => `${u.id}:${s}`)), path: relative(REPO, path) }) + '\n');
  // the tape row each ask was cut from (steer.mjs askSpans + fromPointer, the pointer its declared rows carry); a test passes its own tape
  if (tape === undefined) { try { tape = TESTING() ? [] : loadTape(); } catch { tape = []; } }
  const spans = askSpans(dictation); const tapes = units.map((u, i) => { const hit = tape.length ? fromPointer(spans[i] ?? u.ask, tape) : null; return hit ? hit.pointer : null; });
  const parents = units.map((u, i) => (tapes[i] ? null : parentSpanOf(u.ask, { specText, tape })));
  recordAsks(units, { at, path, prov: provenanceOf({ path, env, ...(transcriptDir ? { transcriptDir } : {}) }), tapes, parents });
  const o = open ? openTxt(path) : { opened: false, why: '--no-open' };
  return { path, units, fill, grade, opened: o.opened, openWhy: o.why, decompose: decomposeLine(dictation, asks) };
}

// the ratchet: per percentage, the median of the last RATCHET_WINDOW compiles against its floor; every floor only rises
export function readLedger(p = LEDGER) { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }
export function median(xs) { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }
export function ratchet({ rows = readLedger(), floorPath = FLOOR, raise = false } = {}) {
  const win = rows.slice(-RATCHET_WINDOW);
  let F = {}; try { F = JSON.parse(readFileSync(floorPath, 'utf8')); } catch {}
  const floors = { fill: F.floor || 0, ...(F.pcts || {}) };
  const keys = ['fill', ...PCTS.map((p) => p.key)];
  const med = Object.fromEntries(keys.map((k) => [k, median(win.map((r) => (k === 'fill' ? r.fill : r.pcts ? r.pcts[k] : null)))]));
  if (med.fill == null) return { state: 'UNMEASURED', why: 'no compiles on the ledger', floor: floors.fill, floors };
  const below = keys.filter((k) => med[k] != null && floors[k] != null && med[k] < floors[k] - 1e-9);
  const empties = {}; for (const r of win) for (const e of r.empty || []) { const s = e.split(':')[1]; empties[s] = (empties[s] || 0) + 1; }
  if (raise) {
    for (const k of keys) if (med[k] != null && med[k] > (floors[k] || 0)) floors[k] = med[k];
    const { fill, ...pcts } = floors;
    mkdirSync(dirname(floorPath), { recursive: true });
    writeFileSync(floorPath, JSON.stringify({ floor: fill, pcts, at: new Date().toISOString(), n: win.length }, null, 2) + '\n');
  }
  return { state: below.length ? 'BELOW FLOOR' : 'AT OR ABOVE FLOOR', below, median: med.fill, medians: med, floor: floors.fill, floors, n: win.length, empties };
}

// COMPILE RUNS THE STEER (C2213, operator 2026-11-02, verbatim: "Do we have to modify the steer to make it automatically execute the
// steer instead it opens the text file? That's absolutely bankrupt. It means lots of stuff I've asked for, I just haven't been done.").
// Measured that day: of 171 asks compiled since 22 Oct, 63 became spec rows and 47 to 108 never did, because compile wrote the txt,
// opened it, and stopped until someone pasted the block back. The txt is the record, never a pause: compile now hands the same
// dictation to the one door (steer.mjs "<text>": declare the rows, set the goal, dispatch -p workers), detached so compile returns at
// once, and stamps the run line into the txt. Guard: tests/vna/c2213-compile-runs-the-steer.test.mjs.
// C2213b (operator 2026-11-04: "did you auto run the steer? if not make it impossible not to in the skill package"): no flag and no env
// stops the run outside the test runner (--compile-only and STEER_COMPILE_DRY bite only under NODE_TEST_CONTEXT); a UserPromptSubmit
// hook (steer-autorun-hook.mjs) runs compile on every `/steer <text>`; the same dictation inside RUN_WINDOW_MS is one run, so the
// chair's own Step 0 never double-dispatches; the child gets VNA_STEER_TXT and stamps the rows it declared into the txt.
// Guard: tests/vna/c2213b-the-steer-cannot-be-skipped.test.mjs.
export const TESTING = () => !!process.env.NODE_TEST_CONTEXT;
export const RUNS = () => process.env.VNA_STEER_RUNS || resolve(REPO, '.thetacog/steer-runs.ndjson');
export const RUN_WINDOW_MS = 30 * 60 * 1000;
const dictationSha = (text) => createHash('sha256').update(String(text).trim()).digest('hex').slice(0, 16);
export function recentRun(text, { now = Date.now() } = {}) {
  if (!existsSync(RUNS())) return null;
  const sha = dictationSha(text);
  const rows = readFileSync(RUNS(), 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return rows.reverse().find((r) => r.sha === sha && now - Date.parse(r.at) < RUN_WINDOW_MS) || null;
}
export function runCommand(text) { return [process.execPath, [process.env.VNA_STEER_DOOR || resolve(REPO, 'scripts/vna/steer.mjs'), text]]; }
export function runSteer(text, txtPath, { dry = process.env.STEER_COMPILE_DRY === '1' && TESTING() } = {}) {
  const [cmd, args] = runCommand(text);
  const log = txtPath.replace(/\.txt$/, '.run.log');
  if (!existsSync(args[0])) return { dispatched: false, why: `the door is not here: ${relative(REPO, args[0])}` };
  if (dry) return { dispatched: false, dry: true, cmd, args, log };
  const prior = recentRun(text);
  if (prior) return { dispatched: false, already: true, pid: prior.pid, log: prior.log, why: `already running since ${prior.at} (pid ${prior.pid})` };
  const fd = openSync(log, 'a');
  const child = spawn(cmd, args, { cwd: REPO, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, VNA_STEER_TXT: txtPath } });
  child.unref();
  try { mkdirSync(dirname(RUNS()), { recursive: true }); appendFileSync(RUNS(), JSON.stringify({ at: new Date().toISOString(), sha: dictationSha(text), pid: child.pid, txt: txtPath, log }) + '\n'); } catch {}
  appendFileSync(txtPath, `\n═══ RUN ═══\ndispatched ${new Date().toISOString()} · pid ${child.pid} · node scripts/vna/steer.mjs "<this dictation>" (declare → goal → -p workers) · log ${relative(REPO, log)}\n`);
  return { dispatched: true, pid: child.pid, log };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  if (a.includes('--backfill')) {
    const r = await backfillRecord();
    console.log(r.error ? `✗ ${r.error}` : `steer-compile backfill: ${r.asks} ask(s) · rules recomputed ${r.rules} (failed ${r.rulesFailed}) · hats recomputed ${r.hats} (failed ${r.hatsFailed}) · tape rows found ${r.tapes} · parent spans ${r.parents} (neither ${r.tapesFailed}) · rooms derived ${r.rooms} (failed ${r.roomsFailed}) · ${r.ms} ms`);
  } else if (a.includes('--check') || a.includes('--raise')) {
    const r = ratchet({ raise: a.includes('--raise') });
    console.log(`steer-compile ratchet: ${r.state}${r.median != null ? ` · over ${r.n} · ${Object.entries(r.medians).map(([k, v]) => `${k} ${v ?? "—"} (floor ${r.floors[k] ?? 0})`).join(" · ")}${r.below.length ? ` · below: ${r.below.join(" ")}` : ""}` : ` — ${r.why}`}${r.empties && Object.keys(r.empties).length ? ` · empty slots: ${Object.entries(r.empties).map(([k, v]) => `${k} ${v}`).join(' · ')}` : ''}`);
  } else {
    const text = a.filter((x) => !x.startsWith('--')).join(' ');
    if (!text.trim()) { console.error('usage: steer-compile.mjs "<dictation>" [--no-open] [--json] [--no-walk] · --check · --raise'); process.exit(2); }
    const r = await compile(text, { open: !a.includes('--no-open'), ...(a.includes('--no-walk') ? { walk: null } : {}) });
    if (a.includes('--compile-only') && !TESTING()) console.error('--compile-only is ignored outside the test runner (C2213b): the steer runs.');
    const run = a.includes('--compile-only') && TESTING() ? { dispatched: false, why: '--compile-only' } : runSteer(text, r.path);
    if (a.includes('--json')) console.log(JSON.stringify({ path: r.path, fill: r.fill, opened: r.opened, run, decompose: r.decompose, units: r.units.map((u) => ({ id: u.id, act: u.act.cls, guard: u.guard, basin: u.basin, fill: u.fill })) }));
    else console.log(`steer compiled: ${relative(process.cwd(), r.path)} · ${r.units.length} asks (${r.units.map((u) => u.id).join(' ')}) · fill ${r.fill} · ${r.opened ? 'opened' : `not opened (${r.openWhy})`} · ${run.already ? `ALREADY RUNNING (pid ${run.pid}, ${run.why})` : run.dispatched ? `RUNNING (pid ${run.pid}, log ${relative(process.cwd(), run.log)})` : run.dry ? `WOULD RUN: node scripts/vna/steer.mjs "<dictation>"` : `not run (${run.why})`}`);
    if (!a.includes('--json') && r.decompose) console.log(r.decompose);   // C2366: the chair numbers the asks before the rows are declared
  }
}
