#!/usr/bin/env node
// scripts/vna/steer.mjs — C110 THE ONE DOOR: /steer re-implements /goal, for Claude Code first, any CLI model after
// (operator 2026-09-20: "re implement /goal in /steer for claude code (and later for any cli llm?) subagent doable
// after spec write?"). §25 already states the identity — /steer IS /goal with the record holding it. Before this file
// the six steps of "The loop, disciplined" (.claude/skills/steer/SKILL.md) were performed BY HAND, by a chair, across
// several separate commands. This is the one door: it runs the same six steps, in order, off the record, and computes
// nothing itself — every step spawns the existing script that already does that step.
//
//   1. text → rows     this file splits the text into distinct asks and appends each as a new top-level C<n> row,
//                       verbatim, with a guard line — directly, the way spec-check.mjs's `declare` appends a pending
//                       snippet (no second registry).
//   2. rows → goal      node scripts/vna/goal.mjs set --text "…" --unit "C.." …   (one unit per declared row)
//   3. dispatch          one worker per open unit, via the runner named by STEER_RUNNER (default steer-runner.mjs) —
//                       spawned as a child process, never imported, so a stub can stand in during a test
//   4. receipts          goal.mjs status · runner-reading.mjs · envelope.mjs --json, printed
//   5. repeat UNTIL THE SPEC IS SATISFIED (C186 — scripts/vna/steer-until.mjs): the win condition is every open spec row in scope,
//                       re-derived each cycle; CLEAR rows dispatch nearest-first by label; a halt is retried once with its reason, then
//                       STUCK, and the loop moves on; the turn budget is a meter; the $150/run spend ceiling pauses. --max-cycles is an
//                       explicit cap only (default: none). The end writes the asks ledger (C185) with STUCK / NEEDS / ACTS / UNCLEAR.
//   6. the close line     shas · rows ticked · what stayed open and why · both arms
//
// Subcommands `status | next | run | close` expose steps 4, 3, 3+4 and 6 alone, for when the chair wants one receipt
// without re-running the whole loop.
//
// THE DRIVER SEAM (C168e — ONE ENGINE KNOB FOR THE WHOLE LOOP). Before this: runner-resolver.mjs's preset table
// (.thetacog/vna-engine.json, what steer-runner.mjs's enginePlan reads by default) and steer.mjs's own
// BUILT_DRIVERS=['claude'] gate were TWO knobs that could disagree — an explicit `--driver ollama` here was refused
// even when the resolver's own preset was already built, so the only door onto qwen/goose was a DIRECT
// runner-resolver.mjs/steer-runner.mjs call that bypassed this file. Now there is one: `driver` names a PRESET ID
// (or alias — claude/goose/ollama/custom, runner-resolver.mjs's ALIAS table). Unset, checkDriver() reads whatever
// preset is ALREADY ACTIVE on the record and reports that — never an assumed "claude". Given, it is validated as a
// KNOWN preset id (pure, no write); applyDriver() then turns the SAME file runner-resolver.mjs `set --preset` turns,
// right before a dispatch — a no-op when that preset is already active, and never on a --dry-run. A preset whose
// binary is missing is steer-runner.mjs's existing ENGINE_BINARY_MISSING HALT row (missingBinary(), at spawn time),
// never a silent fallback to another preset.
//
// EVERY PATH IS ENV-OVERRIDABLE, reusing the names goal.mjs and steer-runner.mjs already honour, so a test runs this
// against a fixture repo in a temp dir and never touches the live spec or goal:
//   VNA_REPO              the repo root every relative path below resolves against (default: this file's own repo)
//   VNA_SPEC_MD            the spec markdown (default: <repo>/docs/specs/vna/SPEC-VNA-COCKPIT.md)  — goal.mjs's own name
//   VNA_GOAL               goal.json (default: <repo>/data/vna/goal.json)                            — goal.mjs's own name
//   VNA_RUNNER_NDJSON      the runner's receipt log (default: <repo>/.thetacog/runner.ndjson)         — steer-runner.mjs's own name
//   VNA_RUNNER_LOG_DIR     the runner's per-dispatch logs (default: <repo>/.thetacog/runner)           — steer-runner.mjs's own name
//   STEER_RUNNER            which script dispatch spawns (default: steer-runner.mjs beside this file) — a test points
//                          this at a stub so no real model is ever called
//
// A sensor that fails is stepped over and its receipt renders as "not run" (the same rule steer-ui.mjs's table states) —
// this file never crashes because one receipt command errored; it says so and keeps going.
//
//   node scripts/vna/steer.mjs "<text>" [--driver claude] [--max-cycles N] [--json]
//   node scripts/vna/steer.mjs status [--json]
//   node scripts/vna/steer.mjs next [--driver claude] [--json]
//   node scripts/vna/steer.mjs run [--driver claude] [--json]
//   node scripts/vna/steer.mjs close [--json]
//   node scripts/vna/steer.mjs until [--scope <ids|section>] [--ceiling N] [--dry-run] [--json]   C186: the whole-spec loop alone
//   node scripts/vna/steer.mjs --dry-run                                                            classify · order · print, no dispatch
//
// @guard tests/vna/c110-steer-is-goal-one-door.test.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { projectDir } from './transcript-asks.mjs';   // C331: the tape's transcripts live where the asks audit reads them
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rowPaths } from '../../src/lib/pmu/declared-reading.mjs';   // C780: the ONE `paths:` parser — a grown row's declared paths light the repo
import { specTicks, goalStatus as goalStatusRead, GOAL as GOAL_JSON } from './goal.mjs';
import { loopbackSegment } from './asked-vs-dictation.mjs';   // C777: the post-run loopback's line rides on the close beside C186c's regressed ticks; a red relation reads NOT DONE   // a pure regex reader already built — reused, never re-derived
import { goalAccounting } from './goal-accounting.mjs';   // C295: the goal-unit accounting on the close line
import { unloadAtLoopEnd, runUntil, steerUntil, dispatchRow, ledgerNotes, unquotedAsks, writeLedger, DEFAULT_CEILING_USD } from './steer-until.mjs';   // C186: the loop lives there
import { boardSyncBeforeCycle } from './steer-board-sync.mjs';   // C1025: `run`'s one dispatch reads the board first — same door `until` uses
import { projectSheetsBetween } from './steer-board-sync.mjs';   // C2170b: the project sheets write between cycles
import { readEngineConfig, presetOf, DEFAULT_PRESET, choiceOf, webHandoffRefusal, agentOf } from './runner-resolver.mjs';   // C168e: the ONE engine knob · C484: the big-model and web-handoff choices
import { readRunnerRows } from './runner-reading.mjs';   // C334: the land rate is read off the runner ledger
import { wilson } from './replay-bench.mjs';   // C334: one Wilson interval, the bench's own
import { isReport, isHelp, writeReport, REPORT_GUARD } from './steer-report.mjs';   // C254: a REPORT ask is answered on the host
import { statusLine as dozenStatusLine, dozenFor } from './outward-dozen.mjs';   // C242b: the dozen's one status line, read off .thetacog/outward-dozen.ndjson
import { isFollowUp } from './steer-rules.mjs';
import { readReserved } from './reserved-ids.mjs';   // C2159
import { decaySurface } from './theme-decay.mjs';   // C322d: a theme flat/rising past K commits surfaces one line — printed, never a gate
import { acquire, release, shouldStop } from './steer-lock.mjs';   // C273: one owner   // C267: a follow-up binds to the active row, never mints one
import { nearestMilestoneLine } from '../milestones/row-join.mjs';   // C307d: printed at declaration, never a bind, never a floor
import { shortReading, shortBits } from './iso-reading.mjs';   // C604/C618: the close line's `predicts` field (the bits) and its C226 tail — one reader, one home

const HERE = dirname(fileURLToPath(import.meta.url));
export { REPO, SPEC_MD } from './aim.mjs';
import { REPO, SPEC_MD } from './aim.mjs';   // one definition (aim.mjs), read here as before
export const GOAL_CLI = resolve(HERE, 'goal.mjs');
export const RUNNER_READING_CLI = resolve(HERE, 'runner-reading.mjs');
export const ENVELOPE_CLI = resolve(HERE, 'envelope.mjs');
export const DEFAULT_RUNNER_CLI = resolve(HERE, 'steer-runner.mjs');
export const ASKS_LEDGER_CLI = resolve(HERE, 'asks-ledger.mjs');
export const DEFAULT_MAX_CYCLES = Infinity;   // C186: no cycle cap by default — the spec is the win condition; --max-cycles N is an explicit cap
// C110c/C168e — THE DRIVER SEAM, named once, called everywhere a dispatch could happen.
// PURE — reads only, never writes. Unset (`driver` falsy) reports the preset ALREADY ACTIVE on the record (the file
// runner-resolver.mjs owns); given, it is resolved against the same PRESETS/ALIAS table (so 'claude', 'ollama',
// 'goose', a full preset id, or 'custom' are all recognized) — `driver` on the return is always the canonical
// preset id, never the alias typed. `built: false` means the name is not a known preset at all — a KNOWN preset
// whose binary happens to be missing is still `built: true` here; that failure is steer-runner.mjs's own
// ENGINE_BINARY_MISSING halt at spawn time, not a pre-dispatch refusal.
export function checkDriver(driver, { repo = REPO, owner = process.env.VNA_STEER_OWNER } = {}) {
  // C334a (operator 2026-09-26, verbatim: *"did /steer default to local models? I gave no such instruction - qwen etc is run
  // through steer chat (confirm it works in steer chat and does not hijack /steer..)"*). The engine file is the CHAT'S knob —
  // its 🤖 dropdown writes it (vna-engines.ts setSubagentHands → goose-local). A /steer the chat starts (VNA_STEER_OWNER=chat,
  // vna-chat-inline.ts runSteerVerb) reads it; every other /steer runs on the default preset unless --driver names one.
  if (!driver) { const preset = owner === 'chat' ? readEngineConfig(repo).preset : DEFAULT_PRESET; return { driver: preset, built: true, line: null }; }
  const p = presetOf(driver);
  if (p) return { driver: p.id, built: true, line: null };
  // C484: a web handoff is never a driver (it returns no commit) — a named refusal; a big Claude model id drives the claude -p preset
  // pinned to that id (applyDriver sets VNA_CLAUDE_MODEL for this run's tree only, never the chat's file)
  const c = choiceOf(driver);
  if (c && c.kind === 'web-handoff') return { driver: c.id, built: false, line: `driver ${c.id}: ${webHandoffRefusal(c.id)}` };
  if (c && c.kind === 'cli') return { driver: c.preset, built: true, line: null, claudeModel: c.claudeModel };
  if (c && c.kind === 'agent') return { driver: c.preset, built: true, line: null, agent: c.id, template: agentOf(c.id).template };   // C940
  return { driver, built: false, line: `driver ${driver}: UNMEASURED — not built` };
}
// C334 — THE OPERATOR'S /steer NAMES THE ENGINE'S MEASURED LAND RATE BEFORE IT DISPATCHES (observed 2026-09-26; operator's ask,
// verbatim: *"learn from the moving parts here"*). goose-local/qwen3:8b held the engine file from 2026-09-23T21:50Z and every /steer
// dispatched to it without saying what it lands. The rate is read off the runner ledger — the real dispatches, never the one-turn bench
// (C235d): trials = `dispatch` rows carrying the preset, landed = `verdict` rows with ok and ticked. When the active preset's Wilson
// 95 % upper bound is under the default preset's point rate, the line names the one switch — never performed here: a chat-owned run
// switches the chat's file (runner-resolver.mjs set), any other run drops/changes --driver. Unmeasured when the ledger holds nothing.
export function landRate(preset, rows) {
  const n = rows.filter((r) => r.kind === 'dispatch' && r.preset === preset).length;
  const x = rows.filter((r) => r.kind === 'verdict' && r.preset === preset && r.ok && r.ticked).length;
  return { preset, n, x, rate: n ? x / n : null, wilson95: wilson(x, n) };
}
const pct = (v) => `${(v * 100).toFixed(1)} %`;
// C334b (operator 2026-09-26, verbatim: *"find a way to only ask if theres no other way - and do it otherwise"*): a preset whose interval
// still reaches the default's rate gets no switch line, and the reason is a number, not a question — the fewest further dispatches with no
// land that would put its Wilson upper bound under that rate. The bench never overrides this (C235d: it is a proxy until the land rate agrees).
export function missesToTrail(x, n, target, cap = 10000) { if (!(target > 0)) return null; for (let k = 0; k <= cap; k++) if (wilson(x, n + k)[1] < target) return k; return null; }
export function engineLine(preset, { rows = readRunnerRows(), owner = process.env.VNA_STEER_OWNER } = {}) {
  const a = landRate(preset, rows);
  if (!a.n) return { line: `engine: ${preset} · land rate UNMEASURED — no dispatch on the runner ledger carries this preset`, trails: false, rate: a };
  let line = `engine: ${preset} · landed ${a.x}/${a.n} on the runner ledger (${pct(a.rate)}, Wilson 95 % ${pct(a.wilson95[0])}–${pct(a.wilson95[1])})`;
  if (preset === DEFAULT_PRESET) return { line, trails: false, rate: a };
  const d = landRate(DEFAULT_PRESET, rows);
  if (!d.n) return { line: `${line} · ${DEFAULT_PRESET} UNMEASURED, no comparison`, trails: false, rate: a };
  line += ` · ${DEFAULT_PRESET} lands ${d.x}/${d.n} (${pct(d.rate)})`;
  const trails = a.wilson95[1] < d.rate;
  if (!trails) { const k = missesToTrail(a.x, a.n, d.rate); if (k) line += ` — its upper bound still reaches that rate; ${k} more ${preset} dispatches with no land would put it under`; }
  if (trails) line += ` — TRAILS it, even at its upper bound; switch: ${owner === 'chat' ? `node scripts/vna/runner-resolver.mjs set --preset claude` : 'drop --driver (or --driver claude)'} — never switched silently`;
  return { line, trails, rate: a, against: d };
}

// C334a: pins the engine for THIS run's dispatches through VNA_ENGINE_PRESET (runner-resolver.mjs readEngineConfig honours it;
// the steer-runner children inherit it) and NEVER writes .thetacog/vna-engine.json — that file is the chat's selection, and a
// terminal /steer overwriting it (C168e's old applyDriver) or silently inheriting it (the 2026-09-23 → 09-26 goose run) are the
// same hijack from two sides. Chat-owned with no --driver: nothing pinned, the runner reads the chat's file.
export function applyDriver(driver, { repo = REPO, owner = process.env.VNA_STEER_OWNER, env = process.env } = {}) {
  if (!driver && owner === 'chat') return null;
  const c = driver && !presetOf(driver) ? choiceOf(driver) : null;   // C484: a claude-* choice → the claude -p preset + its model pin
  if (c && c.kind === 'cli') { env.VNA_ENGINE_PRESET = c.preset; env.VNA_CLAUDE_MODEL = c.claudeModel; return { preset: c.preset, claudeModel: c.claudeModel, via: 'VNA_ENGINE_PRESET+VNA_CLAUDE_MODEL' }; }
  if (c && c.kind === 'agent') { const a = agentOf(c.id); env.VNA_ENGINE_PRESET = c.preset; env.VNA_ENGINE_TEMPLATE = a.template; return { preset: c.preset, agent: a.id, template: a.template, via: 'VNA_ENGINE_PRESET+VNA_ENGINE_TEMPLATE' }; }   // C940
  const p = presetOf(driver || DEFAULT_PRESET); if (!p) return null;
  env.VNA_ENGINE_PRESET = p.id;
  return { preset: p.id, via: 'VNA_ENGINE_PRESET' };
}

// ── step 1: text → rows ──────────────────────────────────────────────────────────────────────
// THE SPLIT RULE, deterministic and documented rather than clever: cut on a newline, or on a
// sentence terminator ('.', '!', '?') followed by whitespace and a capital letter or '(' — the
// same shape a person reading the dictation aloud would pause at. If ANY resulting piece is under
// MIN_WORDS words, the split is not trusted (a clause sheared mid-thought reads as junk more often
// than it reads as a second ask) and the WHOLE text stays one row instead of guessing which pieces
// to keep. A single ask, or a text with no sentence boundary, is always one row.
export const MIN_ASK_WORDS = 3;
// C418 — A LITERAL REPLACEMENT VALUE IS NEVER SENTENCE-SPLIT (operator 2026-09-29, verbatim: "Swap the closer to Git
// records what changed. ThetaCog records where it landed against what you asked." — the payload after "to" was itself
// two sentences, and the naive split cut it in half: one dictation minted C418 (the verb clause alone) and C419 (the
// second half of the value), named directly on docs/specs/vna/goals/2026-09-29-what-we-have-left-to-finish-goal.txt
// line 60 as "the closer halved into C418 + C419"). swap/change/replace/set/rename/update name a literal value with
// "to"/"with"; everything after that word is the payload, taken whole, even when it carries its own sentence
// terminators. Seen red on the parent: this text split into two rows before the guard existed.
const REPLACEMENT_VERB = /^(swap|change|replace|set|rename|update)\b[\s\S]*?\b(?:to|with)\s+\S/i;
// bf-6735 — A COMPILED STEER DECLARES ONLY ITS STEER BLOCK. 2026-10-30: latest-spec.mjs fed a whole compiled steer (736 lines:
// THE STEER block, six percentages, Template M per ask, the dictation as given) to this door, the line rule below cut every line
// into an ask, and C1444–C2158 (715 rows) landed in the spec. A text carrying the compiler's `═══ THE STEER ═══` marker is read
// as the compiler wrote it (steer-compile.mjs renderSteer): one ask per `C<n> — ` head inside that block, the ask being its
// `verbatim:` span (quote marks and wrapping removed), or the head itself when the operator deleted the span. The ids come
// from the spec at declare time, never from the compiled heads.
export const STEER_MARK = /^═══ THE STEER ═══\s*$/;
export function compiledSteerAsks(text) {
  const ls = String(text || '').split(/\r?\n/);
  const start = ls.findIndex((l) => STEER_MARK.test(l.trim()));
  if (start < 0) return null;
  const asks = []; let cur = null;
  const flush = () => { if (!cur) return; const v = cur.verbatim.join(' ').replace(/\s+/g, ' ').trim().replace(/^"|"$/g, '').trim(); asks.push(v || cur.head); cur = null; };
  for (const raw of ls.slice(start + 1)) {
    if (/^═══/.test(raw.trim()) || /^GOAL:/.test(raw) || /^───/.test(raw.trim())) break;
    const head = /^C\d+[a-z]*\s+—\s+(.+)$/.exec(raw);
    if (head) { flush(); cur = { head: head[1].trim(), verbatim: [], inV: false }; continue; }
    if (!cur) continue;
    if (/^\s{2}verbatim:\s*$/.test(raw)) { cur.inV = true; continue; }
    if (/^\s{2}\S/.test(raw)) { cur.inV = false; continue; }   // draft head · act · guard
    if (cur.inV && raw.trim()) cur.verbatim.push(raw.trim());
  }
  flush();
  return asks;
}
export function splitAsks(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const compiled = compiledSteerAsks(t);   // bf-6735: a compiled steer is its STEER block, never its lines
  if (compiled) return compiled;
  // C422: a text with line breaks is one ask per non-empty line, taken whole —
  // his verdict sheet is written a line per ask. Only a single line is
  // sentence-split, and only a single line is held whole by REPLACEMENT_VERB.
  const lines = t.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  if (REPLACEMENT_VERB.test(t)) return [t];
  // C624: a single line is ONE ask. The sentence split shattered the C614 paragraph into 17 rows (2026-10-03); a sentence
  // boundary is how a person pauses, not how they enumerate. Sub-rows come only from an explicit enumeration in the line.
  const items = enumeratedItems(t);
  if (!items) return [t];
  const tooShort = items.some((s) => s.split(/\s+/).filter(Boolean).length < MIN_ASK_WORDS);
  return tooShort ? [t] : items;
}
// C624 — the explicit enumeration a one-line dictation may carry: markers 1) 2) · 1. 2. · (1) (2) · (a) (b) · a) b), counted
// in sequence from 1 or a. A run of two or more sequential markers splits the line; the text before the first marker is the
// preamble every item needs to read on its own, so it rides along on each. No sequential run → null (the line is one ask).
const ENUM_MARK = /(?:^|\s)(?:\((\d{1,2}|[a-z])\)|(\d{1,2})[.)]|([a-z])\))(?=\s)/g;
export function enumeratedItems(line) {
  const t = String(line || '').trim();
  const ord = (v) => (/^\d+$/.test(v) ? { k: 'n', i: Number(v) } : { k: 'a', i: v.charCodeAt(0) - 96 });
  const marks = [...t.matchAll(ENUM_MARK)].map((m) => ({ ...ord(m[1] || m[2] || m[3]), at: m.index + (m[0].length - m[0].trimStart().length), end: m.index + m[0].length }));
  const first = marks.findIndex((m) => m.i === 1);
  if (first < 0) return null;
  const run = [marks[first]];
  for (const m of marks.slice(first + 1)) if (m.k === run[0].k && m.i === run[run.length - 1].i + 1) run.push(m);
  if (run.length < 2) return null;
  const pre = t.slice(0, run[0].at).trim().replace(/[:\s\u2014-]+$/, '');
  return run.map((m, j) => { const body = t.slice(m.end, j + 1 < run.length ? run[j + 1].at : t.length).trim().replace(/[;,]\s*(and|or)?$/i, '').trim(); return pre ? `${pre} \u2014 ${body}` : body; });
}
export function slugify(s, maxWords = 6) {
  const words = String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.join('-') || 'ask';
}
// the next free whole-number id — a lettered sub-row (`C110a`) never raises it, but a whole-number row counts at ANY
// indent: C186a/C187/C188 were written two-space indented, and an unindented-only count re-issued C187 to a new ask
// C2159: an id the live spec mints must be free everywhere a row id is already spoken for — the compiled steer heads and record
// (steer-compile.mjs readReserved, C1454) and every guard file named c<n>-… under tests/. 2026-10-30: declare minted C1449/C1453/
// C1454 off the cockpit spec alone while tests/vna/c1449-the-claim-call…, c1453-… and c1454-… already existed. Fixture specs keep
// their own numbering (the floor applies to the live spec only).
export function reservedIdFloor({ testDirs = [resolve(REPO, 'tests')], treeSpecs = [resolve(REPO, 'docs/specs/vna/SPEC-FROM-TREE.md')], reserved = null } = {}) {
  let max = 0;
  for (const f of treeSpecs) { try { max = Math.max(max, nextTopLevelId(readFileSync(f, 'utf8')) - 1); } catch { /* no tree render: nothing reserved there */ } }   // the tree's own rows (n_spec_<id>)
  const walk = (d) => { let ents = []; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (e.isDirectory()) walk(join(d, e.name)); else { const m = /^c(\d+)[a-z]*-/.exec(e.name); if (m) max = Math.max(max, Number(m[1])); } } };
  for (const d of testDirs) walk(d);
  return Math.max(max, Number(reserved) || 0);
}
export function nextTopLevelId(specText) {
  let max = 0;
  for (const m of String(specText || '').matchAll(/^\s*-\s*\[[ xX]\]\s*C(\d+)\b/gm)) max = Math.max(max, Number(m[1]));
  return max + 1;
}
// a spec row is ONE markdown line: a blank line inside a dictation ends the list item and severs the operator span from
// the row (the C308 paste, 2026-09-25, landed as 105 lines and spec-clarity read it "no verbatim operator span")
export const oneLine = (t) => String(t || '').trim().replace(/\s*\r?\n\s*/g, ' · ');
// C331 — A PARAPHRASE IS NEVER STAMPED VERBATIM (observed 2026-09-26; operator's ask, verbatim: *"learn from the moving parts
// here"*). Every row used to say `(operator <date>, verbatim: …)` whatever produced its text; on 2026-09-26 the text was the chair's
// own decomposition and eight rows put it in the operator's mouth. THE TAPE is what the operator actually sent: the user messages of
// the newest Claude Code session transcripts for this repo (typed, mid-turn enqueued, or pasted — a paste is a span of his prompt
// too) and the user lines of the steer chat's log. The stamp says verbatim only when the ask, normalised (case, quotes, whitespace,
// the ' · ' oneLine joins), is a substring of one of them; otherwise it says chair decomposition and cites the newest prompt, and
// the word verbatim is not on the row — so spec-clarity reads no operator span and the row waits for one (NEEDS-OPERATOR).
export { TAPE_SESSIONS, CHAT_LOG, tapeKey, loadTape, onTape, FROM_RE, tapeRowId, fromPointer, parseFrom, resolveFrom, rowLineOf, aimOf } from './aim.mjs';   // C331 + C780: one reader of the tape, one aim
import { TAPE_SESSIONS, CHAT_LOG, tapeKey, loadTape, onTape, fromPointer, parseFrom, aimOf } from './aim.mjs';
// the newest prompt, as the operator's words the chair decomposed — harness wrapping and pastes stripped, first 160 chars
function newestWords(tape = []) {
  for (let i = tape.length - 1; i >= 0; i--) {
    const s = String(tape[i]).replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length >= 8 && !/^\/[\w:-]+$/.test(s) && !/^Caveat:|^\[SYSTEM/.test(s)) return s.slice(0, 160);
  }
  return null;
}
export function stampOf({ ask, at, tape = null, from = null }) {
  const span = String(ask).trim().replace(/"/g, '\\"');
  if (tape == null || onTape(ask, tape)) return `(operator ${at}, verbatim: *"${span}"*)`;
  // C780d: when the from: pointer resolved, the operator's words ARE the aimed span — never the newest row by clock, which after a
  // merge is whichever goal file was written last (C862–C864 cited main's questions steer while aiming at the /backup dictation)
  const w = from && from.span ? newestWords([from.span]) : newestWords(tape);
  return w ? `(chair decomposition ${at} of the operator's words *"${w.replace(/"/g, '\\"')}"*, not on the tape: *"${span}"*)` : `(chair decomposition ${at}, no operator prompt on the tape: *"${span}"*)`;
}
// C404 — A POINTER CARRIES ITS REFERENT (operator 2026-09-28, verbatim: *"lets fix the delta"*, after C403 — "tell qwen to make
// the improvment for this" — landed with no "this" on it). The 💬 chat declares `/steer <text>` verbatim, and a long ask that
// points back (C267's isFollowUp only catches ≤6 words) minted a row whose referent lived only in the chat model's previous reply:
// a worker reading C403 gets an instruction with no object. When the ask carries a deictic AND the chat log's newest user line is
// this ask (≤10 min old) AND the turn just before it is a chat MODEL's reply (matched against cot.ndjson, which only the model
// path writes — a host readout is never a referent), that reply rides the row as a REFERENT clause after the stamp, labelled as
// the model's words and whether it names any spec row. The verbatim span is untouched (C331); the clause is never operator text.
export const CHAT_COT = process.env.VNA_CHAT_COT || resolve(REPO, '.thetacog/chat/cot.ndjson');
const DEICTIC = /\b(this|that|these|those|above)\b/i;
const REFERENT_CHARS = 480;
const readNd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
export function chatReferent({ ask, chatLog = CHAT_LOG, cot = CHAT_COT, now = Date.now(), specMd = '' } = {}) {
  if (!DEICTIC.test(String(ask || ''))) return null;
  const log = readNd(chatLog); let u = -1;
  for (let i = log.length - 1; i >= 0; i--) if (log[i].role === 'user') { u = i; break; }
  if (u < 1) return null;
  const said = tapeKey(String(log[u].content || '').replace(/^\/steer\b\s*/i, ''));
  if (!said || !said.includes(tapeKey(oneLine(ask)))) return null;   // the newest chat line is not this ask → a terminal /steer
  if (log[u].at && now - Date.parse(log[u].at) > 10 * 60 * 1000) return null;
  const prev = log[u - 1];
  if (!prev || prev.role !== 'assistant') return null;
  const reply = String(prev.content || '');
  const by = readNd(cot).reverse().find((c) => c.reply && String(c.reply).trim() === reply.trim());
  if (!by) return null;   // a host readout (declared rows, the house menu, a report line) — not something a pointer means
  const ids = [...new Set(reply.match(/\bC\d+[a-z]?\b/g) || [])].filter((id) => new RegExp(`^-\\s*\\[[ xX]\\]\\s*${id}\\b`, 'm').test(specMd));
  const text = oneLine(reply.replace(/[*_`#>]/g, '')).replace(/\s+/g, ' ');
  return { model: by.model || 'the chat model', at: by.at || prev.at || '', ids, excerpt: text.length > REFERENT_CHARS ? text.slice(0, REFERENT_CHARS) + '…' : text };
}
export function referentClause(r) {
  if (!r) return '';
  const names = r.ids.length ? `it names ${r.ids.join(' ')}` : 'it names no spec row';
  return ` · REFERENT (the pointer means the 💬 ${r.model} reply just before the ask, ${String(r.at).slice(0, 16)}Z — the model's words, not the operator's and not the spec's; ${names}: *"${r.excerpt.replace(/"/g, '\\"')}"*)`;
}
// `tape` null = the caller vouches the text is the operator's (a pure unit call); declareRows always passes the loaded tape
export function declareRow({ id, ask: raw, at = new Date().toISOString().slice(0, 10), tape = null, referent = null, from = null }) {
  const ask = oneLine(raw);
  // C254: a REPORT row's guard is the report composer's own (committed) guard — the host writes the report and the tick is earned by it
  const kind = isReport(ask) ? 'REPORT' : 'CHANGE';
  const guard = kind === 'REPORT' ? REPORT_GUARD : `tests/vna/c${id}-${slugify(ask)}.test.mjs`;
  const headline = String(ask).trim().toUpperCase();
  const line = `- [ ] C${id} (guard: \`${guard}\`) ${headline} ${stampOf({ ask, at, tape, from })}${from ? ` · from: ${from.pointer}` : ''}${referentClause(referent)}`;
  return { id: `C${id}`, n: id, guard, kind, ask: String(ask).trim(), line, verbatim: tape == null || onTape(ask, tape), referent, from };
}
// appends every declared row at the end of the spec file (top-level rows in this spec already run bottom-to-newest) and
// returns the declared rows in order — nothing else in the file is touched
// C267 (U4) — THE ACTIVE ROW: the newest OPEN top-level row a dictation declared (its line carries "(operator <date>, verbatim:"),
// read from the bottom of the spec — the rows a /steer dictation appends run bottom-to-newest. Never a row someone else ticked.
export function activeRow(md) {
  const ls = String(md || '').split('\n');
  for (let i = ls.length - 1; i >= 0; i--) {
    const m = /^-\s*\[([ xX])\]\s*(C\d+[a-z]?)\b.*\(operator \d{4}-\d{2}-\d{2}, verbatim:/.exec(ls[i]);
    if (m) return m[1] === ' ' ? { id: m[2], i } : null;   // the newest dictated row is closed → nothing is active
  }
  return null;
}
// C1016a THE FIRST /steer IN A REPO WITH NO SPEC (measured 2026-10-19 in a linux/amd64 node:20 container, the Replit shape: `npx thetacog-mcp
// steer "<ask>"` died on ENOENT for docs/specs/vna/SPEC-VNA-COCKPIT.md, though step 1 of the loop IS declaring the ask as a row). Declaring
// creates the spec with a two-line header and the ask as C1; a follow-up with no spec, and `plan` / `until` with no spec, say what to type.
export const SPEC_HEADER = '# Spec\n\nOne row per ask, declared by /steer: `- [ ] C<n> …`. A ticked row is done; the guard named on a row is how it is checked.\n\n';
export const NO_SPEC_LINE = 'no spec yet at docs/specs/vna/SPEC-VNA-COCKPIT.md — `npx thetacog-mcp steer "<your ask>"` declares the first row';
// C1016c A HUMAN AT A TERMINAL IS ON THE TAPE (measured 2026-10-19 in the Replit-shaped container: the first ask declared as C1 read
// NEEDS-OPERATOR and nothing dispatched — the tape is Claude Code's transcripts, and a shell has none). A text typed into an interactive
// terminal is the person's own words: stdin is a TTY (the keyboard) and no Claude Code session holds the process (its Bash tool gives no TTY on
// stdin, and it sets CLAUDECODE), so a model can never pass this test. stdout is NOT required: a person may pipe the receipt into `less`
// (measured: piping it through `tail` made the first container run read chair). Then the CLI writes the text to the steer chat's log as a user line, the tape
// source C331 already reads — the verbatim check itself is unchanged, and a piped or scripted call stays chair until he says it.
export function typedAtTerminal({ stdin = process.stdin, env = process.env } = {}) { return !!(stdin && stdin.isTTY && !env.CLAUDECODE && !env.CLAUDE_CODE_ENTRYPOINT); }
export function recordTyped(text, { chatLog = CHAT_LOG, at = new Date().toISOString() } = {}) { mkdirSync(dirname(chatLog), { recursive: true }); appendFileSync(chatLog, JSON.stringify({ at, role: 'user', content: String(text), via: 'terminal' }) + '\n'); }
export function ensureSpec(specPath = SPEC_MD) { if (existsSync(specPath)) return false; mkdirSync(dirname(specPath), { recursive: true }); writeFileSync(specPath, SPEC_HEADER); return true; }
/** binds a follow-up to the active row: its words are appended to that row's line as an amendment, verbatim — no new row, no new guard */
export function bindFollowUp({ specPath = SPEC_MD, ask, at = new Date().toISOString().slice(0, 10), tape = null }) {
  if (!existsSync(specPath)) return { bound: false, why: 'a follow-up with no spec yet — say the ask itself; the first one is declared as row C1' };   // C1016a
  const md = readFileSync(specPath, 'utf8'); const a = activeRow(md);
  if (!a) return { bound: false, why: 'a follow-up with no open dictated row to bind to — say what to change' };
  const ls = md.split('\n'); ls[a.i] = `${ls[a.i]} · amended ${at}${tape == null || onTape(ask, tape) ? ', verbatim' : ' (chair, not on the tape)'}: *"${oneLine(ask).replace(/"/g, '\\"')}"*`;   // C331
  writeFileSync(specPath, ls.join('\n'));
  const line = ls[a.i]; const guard = (/\(guard:\s*`([^`]+)`/.exec(line) || [])[1] || null;
  return { bound: true, row: { id: a.id, n: Number(a.id.slice(1)), guard, kind: 'CHANGE', ask: String(ask).trim(), line, bound: true } };
}
export function declareRows({ specPath = SPEC_MD, text, at, tape = loadTape(), chatLog = CHAT_LOG, cot = CHAT_COT, ...o } = {}) {
  const asks = splitAsks(text);
  if (!asks.length) return [];
  if (asks.length === 1 && isFollowUp(asks[0])) {   // C267: "make that edit" · "finish it" · "decrease it more" never mint a row
    const b = bindFollowUp({ specPath, ask: asks[0], at, tape });
    declareRows.lastRefusal = b.bound ? null : b.why;
    return b.bound ? [b.row] : [];
  }
  declareRows.lastRefusal = null;
  ensureSpec(specPath);   // C1016a: the first declaration creates the spec
  const md = readFileSync(specPath, 'utf8');
  let next = nextTopLevelId(md);
  if (resolve(specPath) === resolve(SPEC_MD)) next = Math.max(next, reservedIdFloor({ reserved: o.reserved ?? readReserved() }) + 1);   // C2159
  const spans = askSpans(text);   // C780: the dictation slice each ask was cut from, same split, same order
  const rows = asks.map((ask, i) => { const r = declareRow({ id: next, ask, at, tape, referent: chatReferent({ ask, chatLog, cot, specMd: md }), from: tape ? fromPointer(spans[i] ?? ask, tape) : null }); next++; return r; });
  const sep = md.endsWith('\n') ? '' : '\n';
  writeFileSync(specPath, md + sep + rows.map((r) => r.line).join('\n') + '\n');
  // C780: the basin exists before any brief is printed — the spec's rows folded alone (spec-tree.mjs --basins-only), bounded,
  // on the tree this spec belongs to; a fixture spec with no tree named folds nothing (never a fixture row into the live tree)
  const rebuild = o.rebuild ?? process.env.VNA_DECLARE_REBUILD !== '0', walk = o.walk ?? process.env.VNA_DECLARE_WALK !== '0';   // o (C780): treePath · rootsPath · rebuild · walk
  declareRows.lastRebuild = rebuild ? rebuildBasins({ specPath, treePath: o.treePath, rootsPath: o.rootsPath, walk }) : { ok: false, why: 'rebuild off (VNA_DECLARE_REBUILD=0)' };
  return rows;
}

// ── the running-code calls — every one spawns the door that already owns the step ───────────────
// ── C780 AIM THE SNOWBALL AT THE ROW'S ORIGIN LINE (operator 2026-10-12, verbatim: *"the snowballs are supposed to follow the spec
// onto the file that generated to the specific line where it came from and then back into the repository … the snowball needs to
// be aimed"*). Every chair row carries `from: tape:<sha12>#L<first>-<last> (span sha <sha8>)`: the tape row (sha256 of its text, the
// id that survives a re-read — a seq index moves as sessions roll) and the 1-based lines inside it the row decomposes, with the
// sha8 of those lines verbatim. resolveFrom re-reads the lines off the tape and compares them to the recorded span: equal → AIMED;
// anything else → UNAIMED with why. The stamp's `not on the tape` span (C331) is the chair's text; the from: pointer is where it came from.
// C780: the tape and the aim live in aim.mjs (re-exported here) — see that file; the brief's grow and the rebuild stay below
/** the slice of the dictation each ask of splitAsks(text) was cut from — one per ask, same order (a multi-line text is one line per
 * ask; a single line is the whole line for every ask it enumerates) */
export function askSpans(text) {
  const t = String(text || '').trim(); if (!t) return [];
  const compiled = compiledSteerAsks(t); if (compiled) return compiled;   // bf-6735: each block ask is its own span
  const lines = t.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const n = splitAsks(t).length; return Array.from({ length: n }, () => t);
}
export const SPEC_TREE_CLI = resolve(HERE, 'spec-tree.mjs');
export const LIVE_TREE_PATH = resolve(REPO, 'data/vna/spec-tree.json');
/** the basins-only refresh, spawned bounded (a child so steer.mjs never loads the walk door at import): the live tree for the live spec,
 * a named treePath for a fixture, nothing when a fixture spec names no tree */
export function rebuildBasins({ specPath = SPEC_MD, treePath = undefined, rootsPath = undefined, walk = true, timeoutMs = 120000 } = {}) {
  const live = resolve(specPath) === resolve(SPEC_MD);
  const tp = treePath !== undefined ? treePath : live ? LIVE_TREE_PATH : null;
  if (!tp) return { ok: false, why: 'a fixture spec with no treePath — no tree to fold a basin into' };
  const rp = rootsPath !== undefined ? rootsPath : live ? resolve(REPO, 'data/vna/spec-tree-roots.ndjson') : String(tp).replace(/\.json$/, '-roots.ndjson');
  const t0 = Date.now();
  try {
    const out = execFileSync(process.execPath, [SPEC_TREE_CLI, '--basins-only', '--json', ...(walk ? [] : ['--no-walk'])], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VNA_SPEC_BASINS: specPath, VNA_SPEC_TREE: tp, VNA_SPEC_TREE_ROOTS: rp } });
    const j = JSON.parse(out.trim().split('\n').pop()); return { ...j, treePath: tp, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, why: `spec-tree.mjs --basins-only: ${String(e.stderr || e.message || e).trim().split('\n')[0].slice(0, 160)}`, treePath: tp, ms: Date.now() - t0 }; }
}
const REPO_PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.[a-z]{1,5}\b/g;
export const pathsNamedIn = (text, repo = REPO) => [...new Set((String(text || '').match(REPO_PATH_RE) || []).map((p) => p.replace(/^\.\//, '')).filter((p) => { try { return existsSync(resolve(repo, p)); } catch { return false; } }))];
/** the brief's aim: [`origin: …`, `lit: …`] or [`snowball: UNAIMED — why`]. The span (the tape's own lines) is the prompt retroGrow grows
 * from over the tree's walked rows; lit = repo paths the span and the grown rows name (and exist), the rules rule-grab finds for the span,
 * the grown row ids. walk/textDist/grabFn are injected by a guard (the fixture walker); live, the one walk door on a scratch tape. */
export async function briefAim({ label, specPath = SPEC_MD, repo = REPO, tape = loadTape(), tree = null, walk = null, textDist = null, grabFn = null, maxSteps = undefined, tau = undefined, boundMs = 45000, scratch = join(tmpdir(), 'vna-aim') } = {}) {
  const a = aimOf({ label, specPath, tape });
  if (!a.aimed) return [`snowball: UNAIMED — ${a.why}`];
  const lines = [`origin: ${a.id} L${a.first}-${a.last}`];
  let rows = [], why = null, lane = null;
  try {
    const RS = await import('./retro-snowball.mjs');
    let W = walk;
    if (!W) { const [{ makeWalker }, { lensWalk }] = await Promise.all([import('./asked-vs-dictation.mjs'), import('../../src/lib/pmu/walk-door.mjs')]); W = makeWalker(scratch, { lensWalk, timeoutMs: 4000 }); }
    if (!tree) why = 'no spec tree — nothing to grow from';
    else {
      const R = RS.rowsOf(tree);
      let timer; const bound = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`grow exceeded ${boundMs} ms`)), boundMs); });
      try { const g = await Promise.race([RS.retroGrow(tree, a.span, { walk: W, rows: R, textDist, maxSteps: maxSteps ?? RS.RETRO_MAX_STEPS, tau: tau ?? RS.RETRO_TAU }), bound]); rows = g.set || []; why = g.why || null; lane = g.pixel || null; }
      finally { clearTimeout(timer); }
    }
  } catch (e) { why = String(e.message || e).slice(0, 120); }
  const grown = tree ? rows.map((id) => tree.nodes[`n_spec_${id}`]).filter(Boolean).map((n) => String(n.content && n.content.text || '')) : [];
  const paths = [...new Set([...pathsNamedIn(a.span, repo), ...grown.flatMap((t) => [...rowPaths(t), ...pathsNamedIn(t, repo)])])];
  let rules = [];
  try { const G = grabFn || (await import('../cog/rule-grab.mjs')).grab; const g = G(a.span, { cap: 3, repo }); rules = (g.hits || []).map((h) => `${h.file}:${h.line}`); } catch (e) { rules = [`UNMEASURED — rule-grab: ${String(e.message || e).slice(0, 80)}`]; }
  lines.push(`lit: paths ${paths.join(' ') || 'none'} · rules ${rules.join(' ') || 'none'} · rows ${rows.join(' ') || 'none'}${lane ? ` · span pixel ${lane}` : ''}${why ? ` (grow: ${why})` : ''}`);
  return lines;
}

function trySpawn(bin, args, opts = {}) {
  try { const out = execFileSync(bin, args, { encoding: 'utf8', ...opts }); return { ok: true, code: 0, out }; }
  catch (e) { return { ok: false, code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || e.message || '') }; }
}
function lastJsonLine(out) {
  const lines = String(out || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch {} }
  return null;
}
// C624 — THE DOOR NEVER CLOBBERS AN OPEN GOAL: on 2026-10-03 a dictation replaced a goal that still had open units. When the goal
// in force has a unit not yet done, its open units are carried first (labels and title intact), the new rows are appended as
// units after them, and the text keeps the goal in force with this dictation added. A goal with every unit closed is replaced.
export function setGoalFromRows({ repo = REPO, text, rows, turns = null } = {}) {
  const held = goalStatusJson({ repo });
  const carried = held && Array.isArray(held.units) ? held.units.filter((u) => !u.done) : [];
  const fresh = rows.filter((r) => !carried.some((u) => (u.labels || []).includes(r.id)));
  const goalText = carried.length ? `${held.text} \u00b7 extended: ${text}` : text;
  const units = [...carried.map((u) => `${u.labels.join(' ')}::${u.title || u.labels.join(' ')}`), ...fresh.map((r) => r.id)];
  const args = ['set', '--text', goalText, ...units.flatMap((u) => ['--unit', u]), '--json'];
  if (turns) args.push('--turns', turns);
  const r = trySpawn('node', [GOAL_CLI, ...args], { cwd: repo });
  return { ...r, status: r.ok ? lastJsonLine(r.out) : null };
}
export function goalStatusJson({ repo = REPO } = {}) {
  const r = trySpawn('node', [GOAL_CLI, 'status', '--json'], { cwd: repo });
  return r.ok ? lastJsonLine(r.out) : null;
}
export function goalStatusLine({ repo = REPO } = {}) {
  const r = trySpawn('node', [GOAL_CLI, 'status'], { cwd: repo });
  return r.ok ? r.out.trim() : `goal: not run — node ${GOAL_CLI.slice(REPO.length + 1)} status`;
}
export function runnerReadingLine({ repo = REPO } = {}) {
  const r = trySpawn('node', [RUNNER_READING_CLI], { cwd: repo });
  return r.ok ? r.out.trim() : 'runner: not run — node scripts/vna/steer-runner.mjs';
}
export function envelopeReceipt({ repo = REPO } = {}) {
  const r = trySpawn('node', [ENVELOPE_CLI, '--json'], { cwd: repo });
  const json = r.ok ? lastJsonLine(r.out) : null;
  return { ok: !!json, json, card: json ? json.card : 'envelope: not run — node scripts/vna/envelope.mjs' };
}
// dispatches ONE unit through the named runner (STEER_RUNNER, default steer-runner.mjs) — spawned, never imported, so a
// test can point this at a stub and no real model is ever called. `driverBin` is steer-runner.mjs's own `--claude <bin>`
// — the CLAUDE CLI BINARY PATH, used only when the active preset resolves to claude-code-headless; it is NOT the engine
// knob (C168e: that is the ACTIVE PRESET on .thetacog/vna-engine.json, turned by applyDriver before this is called).
export function dispatchOne({ repo = REPO, runnerCli = process.env.STEER_RUNNER || DEFAULT_RUNNER_CLI, driverBin = 'claude' } = {}) {
  const r = trySpawn('node', [runnerCli, '--max-units', '1', '--claude', driverBin, '--json'], { cwd: repo });
  const result = lastJsonLine(r.out);
  // C242b: the dozen read the dispatch's own range (head0..head1 off the runner's JSON) — DETECTED rows, never a change to the result
  let dozen = null; try { if (result) { const dz = dozenFor(result, { repo }); dozen = { read: dz.read, drops: dz.drops, lines: dz.lines, unmeasured: dz.unmeasured }; } } catch (e) { dozen = { why: `not run — ${String(e && e.message || e).slice(0, 120)}` }; }
  return { ...r, result, dozen };
}
// step 5 (C186): repeat UNTIL THE SPEC IS SATISFIED. The old loop stopped on --max-cycles 3 and broke on the first cycle that ticked
// nothing; this one is steer-until.mjs's runUntil — the win condition re-derived from the spec every cycle, one CLEAR row per dispatch
// BY LABEL (nearest-first), a halt retried once with its reason then STUCK and the loop moves on, the budget metered. Each dispatch is
// kept in the legacy { cycle, ok, result } shape the close line and diminishingReturns already read; `.until` carries the loop result.
// `driverBin` (default 'claude'): the claude CLI binary path steer-runner.mjs's --claude flag takes — never the
// engine/preset (C168e). The engine is whatever is active on .thetacog/vna-engine.json when this is called; steer()
// turns that knob with applyDriver() before ever reaching here.
export async function dispatchLoop({ repo = REPO, specPath = SPEC_MD, runnerCli = process.env.STEER_RUNNER || DEFAULT_RUNNER_CLI, driverBin = 'claude', maxCycles = DEFAULT_MAX_CYCLES, scope = null, ceiling = DEFAULT_CEILING_USD, say = () => {} } = {}) {
  const dispatches = [];
  const dispatch = async (row, { retryReason, dial }) => {
    const r = await dispatchRow(row, { repo, runnerCli, driverBin, retryReason, dial });   // C278: the triage's dial rides through
    dispatches.push({ cycle: dispatches.length + 1, label: row.id, ok: !!r.raw, code: r.raw ? 0 : 1, out: r.raw ? '' : String(r.reason || ''), result: r.raw ? { ...r.raw, halted: r.halted, reason: r.reason } : null });
    return r;
  };
  // C273 — the dictated run is a door onto the same loop: it takes the one lock, or names who holds it and dispatches nothing
  const L = acquire({ owner: process.env.VNA_STEER_OWNER || 'chat' });
  if (!L.ok) { say(`not dispatched — the loop is held by ${L.holder.owner} (pid ${L.holder.pid}, since ${L.holder.started_at}); your rows are declared and wait for it (C273)`); dispatches.until = { held: L.holder, cycles: 0, ticked: [], stuck: [], deferred: [], needs: [], acts: [], log: [] }; return dispatches; }
  try {
    const stopRequested = () => shouldStop();   // C273
    const until = await runUntil({ specPath, scope, ceiling, maxCycles, dispatch, say, stopRequested });
    { const u = await unloadAtLoopEnd(); if (u.unloaded) say(`⏏ ${u.unloaded} unloaded — the loop stopped (D3)`); }
    dispatches.until = until;
    return dispatches;
  } finally { release(); }
}

// ── step 4, bundled: the three receipts, in order, each rendering "not run" rather than crashing ──
export function receipts({ repo = REPO } = {}) {
  const goal = goalStatusLine({ repo });
  const runner = runnerReadingLine({ repo });
  const env = envelopeReceipt({ repo });
  // C242b: one line off the outward-dozen ndjson — outward commits read · drops detected · repaired; an absent file reads zeros, never a crash
  let dozen; try { dozen = dozenStatusLine(); } catch (e) { dozen = `dozen: not run — ${String(e && e.message || e).slice(0, 100)}`; }
  return { goal, runner, envelope: env, dozen, lines: [goal, runner, env.card, dozen] };
}

// ── C185: DIMINISHING RETURNS — when a cycle stops folding asks in, itemise what it could not fold, and open it ──
// three conditions, checked in this order because the first two make "the last dispatch" meaningless: (1) the
// dictation produced no row at all — nothing was ever set to fold; (2) goal.mjs reports the turn budget OVER
// BUDGET — the loop is not stopping because it is done, it is stopping because it ran out of runway; (3) the last
// dispatch in the cycle ticked nothing (halted, errored, or dispatched 0) — the loop tried and the fold failed.
// VNA_STEER_FORCE_OVER_BUDGET=1 is a test-only seam (a fixture cannot cheaply fabricate turns-used past a budget
// without faking a long commit history) — never read as a real signal outside a test harness.
export function diminishingReturns({ rows = [], dispatches = [], goalOverBudget = false } = {}) {
  if (process.env.VNA_STEER_FORCE_OVER_BUDGET === '1') goalOverBudget = true;
  if (!rows.length) return { hold: true, reason: 'a dictation segment became no row' };
  if (goalOverBudget) return { hold: true, reason: 'goal.mjs reports OVER BUDGET' };
  if (!dispatches.length) return { hold: false, reason: null };
  const last = dispatches[dispatches.length - 1];
  const tickedNothing = !last.ok || !last.result || last.result.halted || (last.result.dispatched ?? 0) === 0;
  return tickedNothing ? { hold: true, reason: 'the last dispatch ticked nothing' } : { hold: false, reason: null };
}
// spawns the composer (scripts/vna/asks-ledger.mjs), bash-opens it (--open), and returns the path it wrote — or
// null when the composer itself could not run (never crashes the close line over a report it could not write)
export function runAsksLedger({ repo = REPO, rows = [], ledgerCli = process.env.STEER_ASKS_LEDGER || ASKS_LEDGER_CLI } = {}) {
  const args = [ledgerCli, '--open', '--json'];
  const ids = rows.map((r) => (r && r.id) || r).filter(Boolean);
  if (ids.length) args.push('--rows', ids.join(','));
  const r = trySpawn('node', args, { cwd: repo });
  const json = r.ok ? lastJsonLine(r.out) : null;
  return json && json.path ? json.path : null;
}

// ── step 6: the close line ───────────────────────────────────────────────────────────────────
// `ticks` is goal.mjs's own specTicks() shape — a plain { C<n>: true|false } map, reused rather than re-derived.
// `driver` (C168e): the ACTIVE PRESET id dispatch just ran (or was about to run) on — printed only when known, so
// closeFromRecord's stand-alone `close` read (which never re-checks a driver) keeps its existing shape untouched.
// `predicts` (C618): the C609a bits reading, short form (rate, z, n and session days per half, verdict); `admission` (C604):
// the C226 reading, short form, printed after it as `C226 …` — both read off their own receipts by the one reader (iso-reading.mjs);
// defaults to a fresh read so both callers (the run's close and closeFromRecord) carry it.
export function closeLine({ rows, dispatches = [], ticks = {}, envelope = null, driverRefused = null, driver = null, predicts = shortBits(), admission = shortReading() } = {}) {
  const ids = rows.map((r) => r.id);
  const dispatched = dispatches.filter((d) => d.ok && d.result && !d.result.halted).length;
  const ticked = ids.filter((id) => ticks[id] === true);
  const halts = dispatches.map((d) => d.result && d.result.halted ? d.result.reason : null).filter(Boolean);
  const open = ids.filter((id) => ticks[id] !== true).map((id) => {
    if (driverRefused) return `${id} (driver ${driverRefused}: UNMEASURED — not built)`;
    if (!dispatches.length) return `${id} (not dispatched)`;
    if (halts.length) return `${id} (${halts[halts.length - 1]})`;
    return `${id} (no verdict yet)`;
  });
  const work = envelope && envelope.json && envelope.json.moveWork ? envelope.json.moveWork.target.id : 'none';
  const decl = envelope && envelope.json && envelope.json.moveDecl ? envelope.json.moveDecl.coord : 'none';
  const driverSeg = driver ? ` · driver: ${driver}` : '';
  return `steer: ${rows.length} rows declared (${ids.join(' ')}) · goal set${driverSeg} · ${dispatched} dispatched · ${ticked.length} ticked · open: ${open.length ? open.join(', ') : 'none'} · arms: ${work} | ${decl}${predicts ? ` · predicts ${predicts}` : ''}${admission ? ` · C226 ${admission}` : ''}`;
}

// C295 — /steer STEERS THE GOAL: the close line names the goal units closed, every open ask no unit covers (fold it in via
// goal.mjs set, never drop it) and the /steergoal file the goal was set from. A reader of goalStatus (in-process, write:false —
// a close line never moves the active leaf), the spec and the tree render's ## PENDING; a failure reads "not run", never a crash.
export const SPEC_RENDER = process.env.VNA_SPEC_RENDER || resolve(REPO, 'docs/specs/vna/SPEC-FROM-TREE.md');
export function goalDoneUnits({ repo = REPO, specPath = SPEC_MD } = {}) {
  try { const st = goalStatusRead({ path: GOAL_JSON, repo, md: readFileSync(specPath, 'utf8'), write: false }); return st ? new Set(st.units.filter((u) => u.done).map((u) => u.n)) : null; } catch { return null; }
}
export function goalSegment({ repo = REPO, specPath = SPEC_MD, before = null } = {}) {
  try {
    const md = readFileSync(specPath, 'utf8');
    const st = goalStatusRead({ path: GOAL_JSON, repo, md, write: false });
    let source = null; try { source = JSON.parse(readFileSync(GOAL_JSON, 'utf8')).source || null; } catch {}
    let pendingMd = null; try { pendingMd = readFileSync(SPEC_RENDER, 'utf8'); } catch {}
    return goalAccounting({ status: st, md, pendingMd, source, before });
  } catch (e) { return { line: `goal: not run — ${String(e.message || e).slice(0, 100)}` }; }
}

// C332 — A REPORT NEVER TICKS A CHANGE ROW (observed 2026-09-26; operator's ask, verbatim: *"learn from the moving parts here"*).
// C323 (record a demo) read as a REPORT, the generic open-rows txt was written and the row was ticked — no demo existed. The
// report's guard is the composer's, green whatever the row asked, so a tick through it proves the txt was written, never that the
// row is done. The txt is written and opened; the row stays `- [ ]` until its own guard is green at a commit that names it.
export function answerReport(r, { repo = REPO, write = writeReport } = {}) {
  const rep = write({ text: r.ask, row: r, repo });
  return `report ${r.id} · written ${rep.path}${rep.opened ? ' · opened' : ''} · row stays open — a report never ticks (C332)`;
}

// ── the full loop, steps 1–6 in order ────────────────────────────────────────────────────────
// ── C175b — A FRESH ROW WAITS FOR ITS OWN BASIN, NOT FOR THE TAPE. C175's wait (steer-runner.mjs awaitFold) asks "is the tree
// at the tape?", but a row this door just declared is a spec row: the tree can be at the tape and still hold no
// n_spec_<id>. Measured 2026-09-27 on runner.ndjson: every first dispatch of a freshly declared row since 09-25 (C259 C260
// C261 C305 C324 C340 C341 C344 C348 C358) went out with write_pixel null, "no basin n_spec_<id> on the tree", and no
// snowball; the re-dispatch of the same row later had its pixel (C344: none at 02:48, A1,A2 at 03:08). C358's basin landed
// 62 s after its dispatch; the runner had waited 8 s. So the door waits, bounded, for each declared row's own basin before
// dispatching. It watches the 200-byte watermark and searches the ~115 MB tree for the id only when the root moves. Never a
// gate: past the ceiling it dispatches anyway and says the brief goes out without the basin.
export const BASIN_WAIT_MS = Number(process.env.VNA_BASIN_WAIT_MS ?? 120000);
export function treeHasBasin(treePath, id) {
  try { return readFileSync(treePath).includes(Buffer.from(`"n_spec_${id}"`)); } catch { return false; }
}
export async function awaitBasins({ ids = [], treePath = resolve(REPO, 'data/vna/spec-tree.json'), watermarkPath = resolve(REPO, 'data/vna/spec-tree.watermark.json'), waitMs = BASIN_WAIT_MS, pollMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), has = treeHasBasin } = {}) {
  const t0 = Date.now(); const rootOf = () => { try { return JSON.parse(readFileSync(watermarkPath, 'utf8')).root || null; } catch { return null; } };
  let missing = ids.filter((id) => !has(treePath, id)); let seen = rootOf();
  while (missing.length && Date.now() - t0 < waitMs) {
    await sleep(Math.max(1, pollMs));
    const r = rootOf(); if (r === seen) continue; seen = r;
    missing = missing.filter((id) => !has(treePath, id));
  }
  return { folded: ids.filter((id) => !missing.includes(id)), missing, waitedMs: Date.now() - t0 };
}

// C1220 — A DECLARED ROW GETS ITS PLAIN HEAD BEFORE IT IS DISPATCHED (2026-10-23: every fresh dictation halted on all its rows,
// "no plain head written for it yet (C1027)", because the door declared rows and dispatched them with no head; C1036 refuses a
// headless row, as it should). plain-heads.mjs backfill --ids writes the heads (parallel, bounded); a row it cannot head stays
// UNCLEAR and C1215 prints that snag. run is injectable so the guard drives it without a model.
export function headsForNewRows(rows, { run = (args) => execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 400_000, stdio: ['ignore', 'pipe', 'pipe'] }) } = {}) {
  const ids = rows.filter((r) => !r.bound && r.kind !== 'REPORT').map((r) => r.id);
  if (!ids.length) return { ids, line: null };
  try { const out = run([resolve(REPO, 'scripts/ops/plain-heads.mjs'), 'backfill', '--ids', ids.join(','), '--concurrency', String(Math.min(10, ids.length))]);
    return { ids, line: `heads: ${String(out).trim().split('\n').pop()}` }; }
  catch (e) { return { ids, line: `heads: NOT written — ${String(e.message || e).slice(0, 160)}; the rows halt as sludge until plain-heads.mjs backfill --ids ${ids.join(',')} runs` }; }
}

export async function steer({ text, repo = REPO, specPath = SPEC_MD, driver = null, maxCycles = DEFAULT_MAX_CYCLES, scope = null, ceiling = DEFAULT_CEILING_USD, say = console.log } = {}) {
  const rows = declareRows({ specPath, text });
  // C277 — an ask from the chat ticks ↻ (operator: "a checkbox that is checked when you ask a question"): the host loop keeps going
  // after this dictation's own rows, until the box is unticked. The chat's door sets VNA_KEEP_AUTO=1; the CLI and the skill do not.
  if (process.env.VNA_KEEP_AUTO === '1' && rows.some((r) => r.kind !== 'REPORT')) { try { const k = await import('./keep-running.mjs'); const r = k.keepOn({ by: 'chat' }); say(`↻ keep running: on (ticked by this ask)${r.started ? ` · daemon pid ${r.started}` : ''} — untick it on the engines pill, or /steer loop off`); } catch (e) { say(`↻ keep running: not ticked — ${String(e.message || e).slice(0, 120)}`); } }
  say(rows.length === 1 && rows[0].bound ? `bound to ${rows[0].id} — a follow-up amends the active row, no new row (C267)` : `declared ${rows.length} row${rows.length === 1 ? '' : 's'}: ${rows.map((r) => r.id).join(' ') || 'none'}`);
  // C307d: A NEW ROW NAMES ITS MILESTONE AT DECLARATION — never a bind, never a floor (a floor here would go
  // red on every dictation). A follow-up bind (r.bound, C267) names no new row, so it prints none.
  for (const r of rows) { say(`  ${r.line}`); if (!r.bound) say(`    ${nearestMilestoneLine(r.ask)}`); }
  if (!rows.length) {
    say(declareRows.lastRefusal ? `nothing declared — ${declareRows.lastRefusal}` : 'nothing to declare — empty text, nothing done');
    const dr0 = diminishingReturns({ rows, dispatches: [] });
    let close0 = 'steer: 0 rows declared () · nothing done';
    if (dr0.hold) { const p = runAsksLedger({ repo, rows: [] }); if (p) close0 += ` · asks: ${p} (${dr0.reason})`; }
    say(close0);
    return { rows, goal: null, dispatches: [], receipts: null, close: close0, driverRefused: null };
  }
  const goal = setGoalFromRows({ repo, text, rows });
  const goalBefore = goalDoneUnits({ repo, specPath });   // C295: units already done before this run's dispatch
  say(goal.ok ? `goal set · ${rows.length} unit${rows.length === 1 ? '' : 's'}` : `goal: NOT set — ${goal.out.trim().slice(0, 200)}`);
  { const h = headsForNewRows(rows); if (h.line) say(h.line); }   // C1220: a fresh row gets its plain head before any dispatch, or C1036 halts it

  const dc = checkDriver(driver, { repo });
  const driverRefused = dc.built ? null : dc.driver;
  let dispatches = [];
  if (!dc.built) say(dc.line); else say(engineLine(dc.driver).line);   // C334: the rate before the dispatch
  // C110d — a dictation runs the rows IT declared (and their sub-rows), never the whole backlog: with scope null an older CLEAR row
  // nearer in walk order took the dispatch (2026-09-24: the chat's /steer declared C251 and the loop sent C223). `until` is the whole spec.
  // C254 — a REPORT row is answered HERE: the txt is composed from the record, opened, and the row ticked through spec-check (its guard
  // is the composer's). No worker, no model, no Ollama slot. Only CHANGE rows go on to the loop.
  for (const r of rows.filter((x) => x.kind === 'REPORT')) say(answerReport(r, { repo }));
  const changes = rows.filter((x) => x.kind !== 'REPORT');
  const runScope = scope || changes.map((r) => r.id).join(',');
  if (dc.built && !scope && runScope) say(`scope: the ${changes.length === 1 ? 'row' : 'rows'} just declared (${runScope}) — the backlog is \`steer.mjs until\``);
  if (dc.built && !scope && !runScope) say('nothing to dispatch — every declared row was a report, answered on the host');
  if (dc.built && runScope && changes.length && BASIN_WAIT_MS > 0) {   // C175b: the fresh rows' own basins before the first dispatch
    const b = await awaitBasins({ ids: changes.map((r) => r.id), treePath: resolve(repo, 'data/vna/spec-tree.json'), watermarkPath: resolve(repo, 'data/vna/spec-tree.watermark.json') });
    say(b.missing.length ? `basin: ${b.missing.join(' ')} not on the tree after ${Math.round(b.waitedMs / 1000)} s — dispatching without its pixel or snowball (UNMEASURED, C175b)` : `basin: ${b.folded.join(' ')} folded onto the tree in ${Math.round(b.waitedMs / 1000)} s — the brief carries its pixel and snowball`);
  }
  if (dc.built && runScope) { applyDriver(driver, { repo }); dispatches = await dispatchLoop({ repo, specPath, maxCycles, scope: runScope, ceiling, say }); }
  const startedAt = new Date().toISOString();
  for (const d of dispatches) say(d.ok ? `dispatch ${d.cycle} · ${d.result ? (d.result.halted ? `HALT — ${d.result.reason}` : `${d.result.dispatched ?? 0} dispatched`) : d.out.trim().slice(0, 200)}` : `dispatch ${d.cycle} · not run — ${d.out.trim().slice(0, 200)}`);

  const rec = receipts({ repo });
  for (const l of rec.lines) say(l);

  const ticks = specTicks(readFileSync(specPath, 'utf8'));
  let line = closeLine({ rows, dispatches, ticks, envelope: rec.envelope, driverRefused, driver: dc.built ? dc.driver : null });
  line += ` · ${goalSegment({ repo, specPath, before: goalBefore || new Set() }).line}`;   // C295
  line += ` · ${loopbackSegment().line}`;   // C777: asked-vs-dictation's line, or `not run` with the door named — never a silent omission
  const gj = goalStatusJson({ repo });
  const until = dispatches.until || null;
  if (until) {
    // C186 (e): the loop ended — every in-scope row is ticked, STUCK, NEEDS-OPERATOR or YOUR-ACT. The ledger opens only when it has
    // something for the operator (a derived list or an unquoted ask), never for a run that closed everything.
    const uq = await unquotedAsks({ since: until.startedAt || startedAt, specPath });
    const notes = ledgerNotes(until, { unquoted: uq.unquoted });
    // C308-class: WAITING-ON-CHILDREN is not counted toward forYou — the row clears itself once its named open children tick,
    // it is never CLEAR/dispatchable meanwhile (spec-clarity.mjs), and it asks the operator nothing.
    const waiting = (until.waiting || []).length;
    const forYou = until.stuck.length + until.needs.length + until.acts.length + uq.unquoted.length + (until.paused ? 1 : 0);
    line += ` · until: ticked ${until.ticked.length} · stuck ${until.stuck.length} · needs-you ${until.needs.length} · your acts ${until.acts.length} · waiting-on-children ${waiting}${until.paused ? ` · PAUSED (${until.paused.reason})` : ''}`;
    if (forYou) { const lg = writeLedger({ result: until, notes, repo, open: process.env.VNA_ASKS_NO_OPEN !== '1' }); if (lg.path) line += ` · asks: ${lg.path} (C186 end)`; }
  } else {
    const dr = diminishingReturns({ rows, dispatches, goalOverBudget: !!(gj && gj.turns && gj.turns.over) });
    if (dr.hold) { const p = runAsksLedger({ repo, rows }); if (p) line += ` · asks: ${p} (${dr.reason})`; }
  }
  say(line);
  const decay = decaySurface({ repo });   // C322d: after the close, one line per theme that has not decayed — nothing waits on it
  for (const l of decay) say(l);
  return { rows, goal, dispatches, receipts: rec, close: line, decay, driverRefused, until };
}

// ── close alone: read the live record (whatever goal is currently set) and print the close line ──
export function closeFromRecord({ repo = REPO, specPath = SPEC_MD } = {}) {
  const st = goalStatusJson({ repo });
  const rows = st ? st.units.flatMap((u) => u.labels).map((id) => ({ id })) : [];
  const ticks = specTicks(readFileSync(specPath, 'utf8'));
  const rec = receipts({ repo });
  let line = closeLine({ rows, dispatches: rows.length ? [{ ok: true, result: { dispatched: st.turns.used } }] : [], ticks, envelope: rec.envelope, driverRefused: null });
  line += ` · ${goalSegment({ repo, specPath }).line}`;   // C295: the goal units, the uncovered asks, the /steergoal source
  line += ` · ${loopbackSegment().line}`;   // C777
  const dr = diminishingReturns({ rows, dispatches: [], goalOverBudget: !!(st && st.turns && st.turns.over) });
  if (dr.hold) { const p = runAsksLedger({ repo, rows }); if (p) line += ` · asks: ${p} (${dr.reason})`; }
  const decay = decaySurface({ repo });   // C322d
  return decay.length ? [line, ...decay].join('\n') : line;
}

// ── C547 — THE CHAT DOOR'S BRIEF CARRIES THE SAME SNOWBALL THE -p DOOR MASSES (operator 2026-10-01: "as long as they run the
// full snowball rust always"). Measured before: 0 snowball lines in all six C538–C543 chat briefs, while steer-runner's
// dispatch row carried read_set / snowball_sha off bundle(). This reads the SAME functions the runner calls at dispatch —
// capFor (the cap in force), c176DispatchFields (bundle() of the unit basin at that cap, the steer hook's snowball),
// c213DispatchFields (snowball_sha over the read_set), treeRootProof (the root against spec-tree-roots.ndjson) — never a
// second walk. The text rides beside the ids: bundleFn wraps bundle() only to keep the envelope it already built.
// No basin / no tree / a throw prints "snowball: UNMEASURED — <why>", never a silent omission.
export async function briefSnowball({ label, repo = REPO, treePath = undefined, ledgerPath = undefined, rootsPath = undefined, tree = undefined, bundleFn = null, specPath = SPEC_MD, forecastNoteFn = null, forecastPaths = undefined, forecastDir = null, aim = {} } = {}) {
  const R = await import('./steer-runner.mjs');
  // C780: the tree is read ONCE here (c176DispatchFields read it itself before) and handed to both the bundle and the aim's grow
  let T = tree; if (T === undefined) { T = null; try { T = JSON.parse(readFileSync(treePath || resolve(repo, 'data/vna/spec-tree.json'), 'utf8')); } catch {} }
  const snow = await briefSnowballCore({ R, label, repo, treePath, ledgerPath, rootsPath, tree: T, bundleFn });
  const aimed = aim === false ? null : await briefAim({ label, specPath, repo, tree: T, ...(aim || {}) });
  return withChatForecast(aimed ? `${snow}\n${aimed.join('\n')}` : snow, { R, label, repo, specPath, forecastNoteFn, forecastPaths, forecastDir });
}

// C610e — THE CHAT DOOR'S FORECAST: the same fast tier the -p door awaits (drift-note.mjs preRunFastNote, which attaches the forecast
// through brief-forecast.mjs). The block follows the snowball ONLY when the hit-rate reading clears the bar at the aperture in force;
// otherwise the brief is the very same string. The sidecar leaf-<label>.forecast.json is written in every case. A fixture repo gets no
// live walk (its record is an unplaced forecast) unless the caller injects forecastNoteFn. VNA_FORECAST=0 turns the walk off.
async function withChatForecast(snow, { R, label, repo, specPath, forecastNoteFn, forecastPaths, forecastDir }) {
  try {
    const D = await import('./drift-note.mjs');
    const live = resolve(repo) === resolve(REPO);
    let note = null;
    if (forecastNoteFn) note = await forecastNoteFn({ label, repo, specPath });
    else if (live && process.env.VNA_FORECAST !== '0') {
      const row = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '');
      note = await D.preRunFastNote({ repo, specPath, label, files: R.briefTargets({ repo, row }), forecastDir, forecastPaths, door: 'chat' });
    }
    let av = null; try { av = (await import('../pmu/prompt-lens.mjs')).apertureVersion(); } catch { av = null; }
    const n2 = note && note.forecast ? note : D.withForecastOf(note || { placed: false, why: live ? 'VNA_FORECAST=0' : 'a fixture repo — the live walk is this repo\'s' }, { repo, label, apertureVersion: av, forecastDir, forecastPaths, door: 'chat' });
    return n2.forecast && n2.forecast.in_brief === true && n2.forecast.block ? `${snow}\n\n${n2.forecast.block}` : snow;
  } catch { return snow; }   // a reading, never a gate
}

async function briefSnowballCore({ R, label, repo, treePath, ledgerPath, rootsPath, tree, bundleFn }) {
  const head = '── SNOWBALL (C547: the same bundle() the -p door masses — c176DispatchFields at this dispatch\'s cap, read through the runner\'s own functions) ──';
  let knob = null; try { const { settingFor } = await import('./snowball-knob.mjs'); const { apertureVersion } = await import('../pmu/prompt-lens.mjs'); knob = settingFor({ label, aperture: apertureVersion() }); } catch {}
  const cp = R.capFor({ knob });
  let env = null;
  const inner = bundleFn || (await import('./spec-tree.mjs')).bundle;
  const wrapped = async (...a) => (env = await inner(...a));
  let f;
  try {
    f = await R.c176DispatchFields({ repo, label, cap: cp.cap, preset: (await import('./runner-resolver.mjs')).DEFAULT_PRESET, tree, bundleFn: wrapped,
      ...(treePath ? { treePath } : {}), ...(ledgerPath ? { ledgerPath } : {}) });
  } catch (e) { return `${head}\nsnowball: UNMEASURED — c176DispatchFields threw: ${String(e.message || e).slice(0, 160)}`; }
  const tr = rootsPath ? R.treeRootProof(f.treeRoot, rootsPath) : R.treeRootProof(f.treeRoot);
  const rootLine = `tree_root: ${f.treeRoot || 'none'} · ${tr.verdict} — ${tr.why}`;
  if (!Array.isArray(f.read_set) || !f.read_set.length) return [head, `snowball: UNMEASURED — ${f.read_set_why || 'bundle() massed no read_set'}`, rootLine].join('\n');
  const sn = R.c213DispatchFields({ label, ep: null, readSet: f.read_set });
  const mass = env && Array.isArray(env.raw_semantic_mass) ? [...env.raw_semantic_mass].reverse() : [];
  const textOf = new Map(mass.map((m) => [m.sha8, String(m.text ?? '').replace(/\s+/g, ' ').trim()]));
  const lines = [head,
    sn.snowball_sha ? `snowball_sha: ${sn.snowball_sha} (${sn.snowball_sha_source})` : `snowball: UNMEASURED — ${sn.snowball_sha_why}`,
    rootLine,
    `cap: ${cp.cap} tokens (${cp.source})${f.pack_cut ? ` · cut: ${f.pack_cut}` : ''}`,
    `basin pixel: ${f.write_pixel || `UNMEASURED — ${f.write_pixel_why}`}${f.write_walk ? ` · walk ${typeof f.write_walk === 'string' ? f.write_walk : JSON.stringify(f.write_walk)}` : ''}`,
    `read_set (${f.read_set.length} of ${f.read_set_n}) — ${f.read_set_source}; newest first:`,
    ...f.read_set.map((r) => `- ${r.id} [${r.via || '?'}]${r.via === 'basin' ? ' the unit row (THE ROW above)' : textOf.has(r.id) ? ` ${textOf.get(r.id)}` : ''}`)];
  return lines.join('\n');
}

const USAGE = 'usage: node scripts/vna/steer.mjs "<text>" [--driver claude] [--max-cycles N] [--scope S] [--ceiling N] [--json]\n       node scripts/vna/steer.mjs until [--scope S] [--ceiling N] [--dry-run] [--json]\n       node scripts/vna/steer.mjs plan   (= until --dry-run: classify, order, print — $0, no row, no worker)\n       node scripts/vna/steer.mjs status|next|run|close [--json]\n       node scripts/vna/steer.mjs loop on|off|status   (C277: the ↻ keep-running box)\n       node scripts/vna/steer.mjs brief <Cn> [<Cn> ...]   (C444/C477: the -p worker brief + the worker contract per id, one Agent call each)\n       node scripts/vna/steer.mjs verify <Cn> --since <head-at-dispatch> [--dry]   (C444: the follow-through — ticks only via spec-check)\n       node scripts/vna/steer.mjs record-chat <Cn> [--tokens-in N] [--tokens-out N] [--tool-uses N] [--wall-s N]   (C563e: the chat door own completion facts, read off the Agent call, never estimated)\n       node scripts/vna/steer.mjs door   (C563e: tokens/wall-clock per VERIFIED outcome, by door chat|p, median [min,max] n — UNDERPOWERED under 10)';
const UNTIL_FLAGS = ['--dry-run', '--json', '--driver', '--max-cycles', '--scope', '--ceiling', '--since', '--no-open'];
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  // C186b — AN UNREAD FLAG NEVER BUYS A WORKER (2026-09-23: `until --help` was not parsed, ran the WHOLE spec for real and spawned
  // three paid claude -p workers). --help/-h prints usage anywhere; on until/plan any flag outside UNTIL_FLAGS prints usage, exit 2.
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  // C254 (C253's defect): a bare `help` / `usage` / `?` is a question about the door, never a dictation — it declared a row and a worker
  if (argv.filter((x) => !x.startsWith('-')).length === 1 && isHelp(argv.find((x) => !x.startsWith('-')))) { console.log(USAGE); process.exit(0); }
  // C423 — a verb followed by prose never runs the verb: `run a inner monologue on the readme` ran `run` (the goal's next unit) and
  // dropped the rest. Quote the whole line to dictate it; the chat host already routes it as one "<text>" (STEER_VERB_RE).
  if (['status', 'next', 'run', 'close', 'until', 'plan'].includes(argv[0]) && argv[1] && !argv[1].startsWith('-')) { console.error(`"${argv[0]}" is a verb and takes flags only — "${argv.slice(1).join(' ')}" would be dropped. Nothing dispatched. To dictate the line, quote it: steer.mjs "${argv.join(' ')}"`); process.exit(2); }
  // C444 — TWO DISPATCH DOORS, ONE FOLLOW-THROUGH (scripts/vna/steer-follow-through.mjs). `brief <Cn>` prints the -p worker's
  // dispatchBrief + the one WORKER_CONTRACT for a chat subagent; `verify <Cn> --since <sha>` ticks only through spec-check toggle
  // on a green guard AND a commit since the sha, else prints STUCK and exits 1. --spec/--repo (or VNA_SPEC_MD/VNA_REPO) point it at a fixture.
  // C563e (1): the chat door's own recorder — the chair runs this right after an Agent call returns, with the
  // numbers read off that call's own task notification (never estimated): tokens in/out, tool uses, wall-clock
  // seconds. Writes into the SAME runner.ndjson shape the -p door writes, with door: 'chat'.
  if (argv[0] === 'record-chat') {
    const dm = await import('./door-metrics.mjs');
    const a2 = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const LABEL_RE = /^(C\d+[a-z]?\d*|T\d+)$/;
    const label = argv[1] && LABEL_RE.test(argv[1]) ? argv[1] : null;
    if (!label) { console.error('usage: steer.mjs record-chat <Cn> [--tokens-in N] [--tokens-out N] [--tool-uses N] [--wall-s N]'); process.exit(2); }
    const num = (k) => { const v = a2(k); if (v == null) return null; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${k} must be a number, got ${JSON.stringify(v)}`); return n; };
    try {
      const row = dm.recordChatCompletion({ label, tokens_in: num('--tokens-in'), tokens_out: num('--tokens-out'), tool_uses: num('--tool-uses'), wall_s: num('--wall-s') });
      console.log(`recorded ${label} · door chat · tokens_in ${row.tokens_in ?? '?'} tokens_out ${row.tokens_out ?? '?'} tool_uses ${row.tool_uses ?? '?'} wall_s ${row.wall_s ?? '?'}`);
      try { const ft = await import('./steer-follow-through.mjs'); const am = ft.recordAim({ label }); console.log(`aim: ${am.aim}${am.why ? ` — ${am.why}` : ''}`); } catch (e) { console.error(`C780: aim not recorded — ${String(e.message || e).slice(0, 120)}`); }
    } catch (e) { console.error(String(e.message || e)); process.exit(2); }
    process.exit(0);
  }
  // C563e (3): `steer.mjs door` — tokens and wall-clock per VERIFIED outcome (never per dispatch), by door, median
  // [min,max], n; under 10 verified on a side and the comparison refuses a winner (UNDERPOWERED).
  if (argv[0] === 'door') {
    const dm = await import('./door-metrics.mjs');
    const a2 = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const ndjson = a2('--runner') || dm.RUNNER_NDJSON; const verifyLedger = a2('--verify-ledger') || dm.VERIFY_NDJSON;
    for (const l of dm.doorLines({ ndjson, verifyLedger })) console.log(l);
    process.exit(0);
  }
  if (argv[0] === 'brief' || argv[0] === 'verify') {
    const ft = await import('./steer-follow-through.mjs');
    const a2 = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const LABEL_RE = /^(C\d+[a-z]?\d*|T\d+)$/;
    const label = argv[1] && LABEL_RE.test(argv[1]) ? argv[1] : null;
    if (!label) { console.error(`usage: steer.mjs ${argv[0]} <Cn>${argv[0] === 'verify' ? ' --since <sha> [--dry] [--witness <sha>] [--spec <path>] [--repo <path>]' : ' [--spec <path>]'}`); process.exit(2); }
    const specPath = a2('--spec') ? resolve(a2('--spec')) : SPEC_MD; const repo = a2('--repo') ? resolve(a2('--repo')) : REPO;
    if (argv[0] === 'brief') {
      // C477 — `brief C1 C2 C3`: every id up to the first flag, each brief whole under its own header, so one call arms every
      // parallel Agent of the chat turn. Every id is checked and every brief built BEFORE anything prints (a bad id refuses the
      // whole call, exit 2, no half-printed set). One id prints exactly what C444 shipped: no header.
      const ids = []; for (const x of argv.slice(1)) { if (x.startsWith('-')) break; ids.push(x); }
      const bad = ids.filter((x) => !LABEL_RE.test(x)); if (bad.length) { console.error(`not a row id: ${bad.join(' ')} — usage: steer.mjs brief <Cn> [<Cn> ...] [--spec <path>]`); process.exit(2); }
      // C559 — a row another chair briefed inside the hold window prints HELD instead of a brief (two chat sessions on one goal
      // spent ~330k tokens re-briefing C544 · C545 · C548). --take re-briefs anyway and names whom it took from.
      const cdl = await import('./chat-dispatch-ledger.mjs'); const me = cdl.sessionId(); const take = argv.includes('--take');
      const ledgerPath = process.env.VNA_CHAT_DISPATCH_LEDGER || resolve(repo, '.thetacog/chat-dispatch.ndjson');   // a --repo fixture keeps its own ledger
      const held = []; for (const id of ids) { const h = cdl.holdFor({ label: id, session: me, ledgerPath }); if (h && !take) held.push([id, h]); }
      for (const [id, h] of held) console.log(cdl.heldLine(id, h));
      const heldIds = new Set(held.map(([id]) => id)); const keep = ids.filter((id) => !heldIds.has(id));
      if (!keep.length) process.exit(3);
      let head = null; try { head = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* a fixture repo may have no HEAD */ }
      for (const id of keep) { const h = take ? cdl.holdFor({ label: id, session: me, ledgerPath }) : null; cdl.recordBrief({ label: id, session: me, head, took_from: h ? h.by : null, ledgerPath }); }
      ids.length = 0; ids.push(...keep);
      let text, briefs; try {
        briefs = ids.map((id) => ft.briefFor({ label: id, specPath, repo }));
        // C547 — every brief carries its unit's snowball (the -p door's bundle(), never a second walk), or UNMEASURED with its why
        for (let i = 0; i < ids.length; i++) { let s; try { s = await briefSnowball({ label: ids[i], repo, specPath }); } catch (e) { s = `snowball: UNMEASURED — ${String(e.message || e).slice(0, 160)}`; } briefs[i] += '\n\n' + s; }
        text = ids.length === 1 ? briefs[0] : briefs.map((b, i) => `${'═'.repeat(8)} BRIEF ${ids[i]} (${i + 1} of ${ids.length}) ${'═'.repeat(8)}\n${b}`).join('\n\n');
      } catch (e) { console.error(String(e.message || e)); process.exit(2); }
      // C612l — the chat door leaves a C609a pair: each brief (the exact text printed for it) lands as <n>-<Cn>.snowball.txt with
      // a kind:'dispatch', door:'chat' row naming it, stamped BEFORE the brief returns (n = its position in this call, as the -p
      // runner numbers a run). A failed stamp is said on stderr, never a gate on the brief. VNA_CHAT_PAIR=0 turns it off.
      if (process.env.VNA_CHAT_PAIR !== '0') try { const bp = await import('./brief-predicts-commit.mjs'); for (let i = 0; i < ids.length; i++) bp.stampChatBrief({ repo, label: ids[i], brief: briefs[i], n: i + 1, head0: head }); }
      catch (e) { console.error(`C612l: the chat brief left no pair — ${String(e.message || e).slice(0, 160)}`); }
      process.stdout.write(text + '\n', () => process.exit(0)); await new Promise(() => {});
    }
    const r = ft.verifyRow({ label, since: a2('--since'), specPath, repo, dry: argv.includes('--dry'), witness: a2('--witness') || null });
    process.stdout.write(r.line + '\n', () => process.exit(r.ok ? 0 : 1)); await new Promise(() => {});
  }
  if (argv[0] === 'until' || argv[0] === 'plan') { const bad = argv.filter((x) => x.startsWith('-') && !UNTIL_FLAGS.includes(x)); if (bad.length) { console.error(`unknown flag ${bad.join(' ')} — nothing dispatched\n` + USAGE); process.exit(2); } }
  // C186: --dry-run IN ANY POSITION is dry (2026-09-23 defect: `until --dry-run` fell through to the text branch, declared "until" as a
  // row, set the goal and spawned a paid worker). It classifies, orders and prints — no row declared, no goal.mjs set, no runner spawn,
  // no ledger written — whatever else is on the line. `until` without it runs the whole-spec loop for real.
  // C201a: `plan` IS `until --dry-run` — before this, `plan` (a verb the chat advertised, C201) fell through to the text
  // branch below: splitAsks('plan') → ['plan'], a spec row called "plan" declared, a goal set, a paid worker spawned — the C186
  // defect class, reachable from a chat box. Now it classifies, orders and prints at $0, whatever else is on the line.
  if (argv.includes('--dry-run') || argv[0] === 'until' || argv[0] === 'plan') {
    const a2 = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const dry = argv.includes('--dry-run') || argv[0] === 'plan'; const json = argv.includes('--json');
    const driverArg = a2('--driver');
    if (!existsSync(SPEC_MD)) { console.log(NO_SPEC_LINE); process.exit(0); }   // C1016a: plan / until in a spec-less repo say what to type
    const dc = checkDriver(driverArg, { repo: REPO }); if (!dc.built) { console.log(dc.line); process.exit(0); }
    if (!json) console.log(engineLine(dc.driver).line);   // C334: plan and until name the engine's measured land rate first
    if (!dry) applyDriver(driverArg, { repo: REPO });   // C334a: pinned for a real run (never on --dry-run), never written to the chat's file
    const text = argv.find((x, i) => i === 0 && !x.startsWith('--') && x !== 'until' && x !== 'plan');
    if (dry && text && !json) console.log(`dry-run: the text is NOT declared as a row — "${text.slice(0, 80)}"`);
    const mc = a2('--max-cycles') ? Number(a2('--max-cycles')) : null;
    const r = await steerUntil({ dryRun: dry, scope: a2('--scope'), ceiling: a2('--ceiling') ? Number(a2('--ceiling')) : DEFAULT_CEILING_USD, since: a2('--since'), say: json ? () => {} : console.log, openLedger: !argv.includes('--no-open'), ...(Number.isFinite(mc) ? { maxCycles: mc } : {}) });
    if (json) console.log(JSON.stringify(r));
    process.exit(0);
  }
  // C185: `asks` passes every remaining flag straight through to the composer — this door never re-parses them
  // C277 — /steer loop on|off|status: the skill's door onto the ↻ box (the same keep file the checkbox and the chat tick)
  if (argv[0] === 'loop') {
    const k = await import('./keep-running.mjs'); const sub = argv[1] || 'status';
    if (sub === 'on') { const r = k.keepOn({ by: process.env.VNA_STEER_OWNER || 'claude-code' }); console.log(`↻ on${r.started ? ` · daemon started, pid ${r.started}` : ' · daemon already running'}`); }
    else if (sub === 'off') { const r = k.keepOff(); console.log(`↻ off${r.stop ? ' · the running pass stops after its row' : ''}`); }
    else { const st = await k.status(); console.log(`${st.face} · daemon ${st.daemon_alive ? 'alive' : 'not running'}`); }
    process.exit(0);
  }
  if (argv[0] === 'asks') {
    const ledgerCli = process.env.STEER_ASKS_LEDGER || ASKS_LEDGER_CLI;
    try { execFileSync('node', [ledgerCli, ...argv.slice(1)], { cwd: REPO, stdio: 'inherit', env: process.env }); process.exit(0); }
    catch (e) { process.exit(e.status ?? 1); }
  }
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const asJson = argv.includes('--json');
  const driver = arg('--driver');   // C168e: unset means "whatever preset is already active" — checkDriver() reads it, never assumes claude
  const maxCycles = arg('--max-cycles') ? Number(arg('--max-cycles')) : DEFAULT_MAX_CYCLES;
  const scope = arg('--scope'); const ceiling = arg('--ceiling') ? Number(arg('--ceiling')) : DEFAULT_CEILING_USD;
  const cmd = ['status', 'next', 'run', 'close'].includes(argv[0]) ? argv[0] : null;

  if (cmd === 'status') {
    // C264 (U1) — `status --json` is the one small readout: fields, not prose (scripts/vna/steer-readout.mjs)
    if (asJson) { const { readout } = await import('./steer-readout.mjs'); console.log(JSON.stringify(readout())); process.exit(0); }
    if (!existsSync(SPEC_MD)) { console.log(NO_SPEC_LINE); process.exit(0); }   // C1017: a spec-less repo says what to type, never an absolute ENOENT
    const rec = receipts({});
    for (const l of rec.lines) console.log(l);
    for (const l of decaySurface({})) console.log(l);   // C322d: the 💬 Steer chat context carries `status`, so the line reaches the chat too
    if (asJson) console.log(JSON.stringify(rec));
    process.exit(0);
  }
  if (cmd === 'next') {
    const dc = checkDriver(driver, { repo: REPO });
    if (!dc.built) { console.log(dc.line); process.exit(0); }
    applyDriver(driver, { repo: REPO });
    const d = dispatchOne({});
    console.log(d.ok ? (d.result ? JSON.stringify(d.result) : d.out.trim()) : `not run — ${d.out.trim().slice(0, 200)}`);
    process.exit(d.ok ? 0 : d.code);
  }
  if (cmd === 'run') {
    let dispatches = [];
    const dc = checkDriver(driver, { repo: REPO });
    // C201a: the dispatch and the spend ceiling are printed BEFORE anything is spawned — the first line a chat box streams
    // back is what `run` is about to do and what it may cost, never the runner's own first line
    console.log(`run · driver ${dc.driver} · ceiling $${ceiling}${scope ? ` · scope ${scope}` : ''} · one dispatch through ${process.env.STEER_RUNNER ? 'STEER_RUNNER' : 'steer-runner.mjs'}, then the receipts`);
    // C1025 — the board read runs before this cycle dispatches: a span or a comment lands on its row first; UNMEASURED
    // (no Drive remote) never blocks it.
    { const bs = boardSyncBeforeCycle({ repo: REPO }); for (const l of bs.lines) console.log(l); }
    if (!dc.built) console.log(dc.line);
    else { applyDriver(driver, { repo: REPO }); const d = dispatchOne({}); dispatches = [d]; console.log(d.ok ? (d.result ? JSON.stringify(d.result) : d.out.trim()) : `not run — ${d.out.trim().slice(0, 200)}`); }
    const rec = receipts({});
    for (const l of rec.lines) console.log(l);
    if (dispatches.length) console.log(projectSheetsBetween({ repo: REPO }).line);   // C2170b: the one dispatch landed — the project sheets write after it, detached
    if (asJson) console.log(JSON.stringify({ dispatches, receipts: rec }));
    process.exit(0);
  }
  if (cmd === 'close') {
    const line = closeFromRecord({});
    console.log(line);
    process.exit(0);
  }
  const text = argv[0] && !argv[0].startsWith('--') ? argv[0] : arg('--text');
  if (!text) { console.error(USAGE); process.exit(2); }
  if (typedAtTerminal()) recordTyped(text);   // C1016c: a person at a terminal typed it — it is on the tape before it is declared
  const out = await steer({ text, driver, maxCycles, scope, ceiling, say: asJson ? () => {} : console.log });
  if (asJson) console.log(JSON.stringify(out));
  process.exit(0);
}
