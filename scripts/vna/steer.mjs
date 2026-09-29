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
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { projectDir } from './transcript-asks.mjs';   // C331: the tape's transcripts live where the asks audit reads them
import { fileURLToPath } from 'node:url';
import { specTicks, goalStatus as goalStatusRead, GOAL as GOAL_JSON } from './goal.mjs';   // a pure regex reader already built — reused, never re-derived
import { goalAccounting } from './goal-accounting.mjs';   // C295: the goal-unit accounting on the close line
import { unloadAtLoopEnd, runUntil, steerUntil, dispatchRow, ledgerNotes, unquotedAsks, writeLedger, DEFAULT_CEILING_USD } from './steer-until.mjs';   // C186: the loop lives there
import { readEngineConfig, presetOf, DEFAULT_PRESET } from './runner-resolver.mjs';   // C168e: the ONE engine knob
import { readRunnerRows } from './runner-reading.mjs';   // C334: the land rate is read off the runner ledger
import { wilson } from './replay-bench.mjs';   // C334: one Wilson interval, the bench's own
import { isReport, isHelp, writeReport, REPORT_GUARD } from './steer-report.mjs';   // C254: a REPORT ask is answered on the host
import { statusLine as dozenStatusLine, dozenFor } from './outward-dozen.mjs';   // C242b: the dozen's one status line, read off .thetacog/outward-dozen.ndjson
import { isFollowUp } from './steer-rules.mjs';
import { decaySurface } from './theme-decay.mjs';   // C322d: a theme flat/rising past K commits surfaces one line — printed, never a gate
import { acquire, release, shouldStop } from './steer-lock.mjs';   // C273: one owner   // C267: a follow-up binds to the active row, never mints one
import { nearestMilestoneLine } from '../milestones/row-join.mjs';   // C307d: printed at declaration, never a bind, never a floor

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
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
  return p ? { driver: p.id, built: true, line: null } : { driver, built: false, line: `driver ${driver}: UNMEASURED — not built` };
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
export function splitAsks(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  // C422: a text with line breaks is one ask per non-empty line, taken whole —
  // his verdict sheet is written a line per ask. Only a single line is
  // sentence-split, and only a single line is held whole by REPLACEMENT_VERB.
  const lines = t.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  if (REPLACEMENT_VERB.test(t)) return [t];
  const rough = t.split(/\r?\n+|(?<=[.!?])\s+(?=[A-Z(])|;\s+/).map((s) => s.trim()).filter(Boolean);
  if (rough.length <= 1) return [t];
  const tooShort = rough.some((s) => s.split(/\s+/).filter(Boolean).length < MIN_ASK_WORDS);
  return tooShort ? [t] : rough;
}
export function slugify(s, maxWords = 6) {
  const words = String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.join('-') || 'ask';
}
// the next free whole-number id — a lettered sub-row (`C110a`) never raises it, but a whole-number row counts at ANY
// indent: C186a/C187/C188 were written two-space indented, and an unindented-only count re-issued C187 to a new ask
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
export const TAPE_SESSIONS = 2;
export const CHAT_LOG = process.env.VNA_CHAT_LOG || resolve(REPO, '.thetacog/chat/session.ndjson');
const TAPE_MAX_BYTES = 128 * 1024 * 1024;
export const tapeKey = (s) => String(s || '').replace(/\s*·\s*/g, ' ').toLowerCase().replace(/[*_`"“”'’\\]/g, '').replace(/\s+/g, ' ').trim();
/** the operator's own messages, newest last — [] when no transcript or chat log can be read (then nothing is verbatim) */
export function loadTape({ repo = REPO, chatLog = CHAT_LOG, tapeFile = process.env.VNA_TAPE_FILE } = {}) {
  // VNA_TAPE_FILE: a fixture tape (one {text} JSON per line) standing in for the transcripts — a test writes the dictation it
  // types onto it, exactly as a typed prompt lands on the real one; it never bypasses the check
  if (tapeFile) { try { return readFileSync(tapeFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).text; } catch { return null; } }).filter(Boolean); } catch { return []; } }
  const out = [];
  try {
    const dir = projectDir(repo);
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs, n: statSync(join(dir, f)).size }))
      .sort((a, b) => b.t - a.t).slice(0, TAPE_SESSIONS).filter((x) => x.n <= TAPE_MAX_BYTES).reverse();
    for (const { f } of files) for (const l of readFileSync(f, 'utf8').split('\n')) {
      if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
      if (r.type === 'user' && typeof r.message?.content === 'string' && !r.isMeta) out.push({ at: r.timestamp || '', text: r.message.content });
      else if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string') out.push({ at: r.timestamp || '', text: r.content });
    }
  } catch {}
  try { for (const l of readFileSync(chatLog, 'utf8').split('\n')) { try { const j = JSON.parse(l); if (j.role === 'user' && typeof j.content === 'string') out.push({ at: j.at || '', text: j.content }); } catch {} } } catch {}
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.text);
}
export const onTape = (ask, tape = []) => { const k = tapeKey(ask); return !!k && tape.some((p) => tapeKey(p).includes(k)); };
// the newest prompt, as the operator's words the chair decomposed — harness wrapping and pastes stripped, first 160 chars
function newestWords(tape = []) {
  for (let i = tape.length - 1; i >= 0; i--) {
    const s = String(tape[i]).replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length >= 8 && !/^\/[\w:-]+$/.test(s) && !/^Caveat:|^\[SYSTEM/.test(s)) return s.slice(0, 160);
  }
  return null;
}
export function stampOf({ ask, at, tape = null }) {
  const span = String(ask).trim().replace(/"/g, '\\"');
  if (tape == null || onTape(ask, tape)) return `(operator ${at}, verbatim: *"${span}"*)`;
  const w = newestWords(tape);
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
export function declareRow({ id, ask: raw, at = new Date().toISOString().slice(0, 10), tape = null, referent = null }) {
  const ask = oneLine(raw);
  // C254: a REPORT row's guard is the report composer's own (committed) guard — the host writes the report and the tick is earned by it
  const kind = isReport(ask) ? 'REPORT' : 'CHANGE';
  const guard = kind === 'REPORT' ? REPORT_GUARD : `tests/vna/c${id}-${slugify(ask)}.test.mjs`;
  const headline = String(ask).trim().toUpperCase();
  const line = `- [ ] C${id} (guard: \`${guard}\`) ${headline} ${stampOf({ ask, at, tape })}${referentClause(referent)}`;
  return { id: `C${id}`, n: id, guard, kind, ask: String(ask).trim(), line, verbatim: tape == null || onTape(ask, tape), referent };
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
/** binds a follow-up to the active row: its words are appended to that row's line as an amendment, verbatim — no new row, no new guard */
export function bindFollowUp({ specPath = SPEC_MD, ask, at = new Date().toISOString().slice(0, 10), tape = null }) {
  const md = readFileSync(specPath, 'utf8'); const a = activeRow(md);
  if (!a) return { bound: false, why: 'a follow-up with no open dictated row to bind to — say what to change' };
  const ls = md.split('\n'); ls[a.i] = `${ls[a.i]} · amended ${at}${tape == null || onTape(ask, tape) ? ', verbatim' : ' (chair, not on the tape)'}: *"${oneLine(ask).replace(/"/g, '\\"')}"*`;   // C331
  writeFileSync(specPath, ls.join('\n'));
  const line = ls[a.i]; const guard = (/\(guard:\s*`([^`]+)`/.exec(line) || [])[1] || null;
  return { bound: true, row: { id: a.id, n: Number(a.id.slice(1)), guard, kind: 'CHANGE', ask: String(ask).trim(), line, bound: true } };
}
export function declareRows({ specPath = SPEC_MD, text, at, tape = loadTape(), chatLog = CHAT_LOG, cot = CHAT_COT } = {}) {
  const asks = splitAsks(text);
  if (!asks.length) return [];
  if (asks.length === 1 && isFollowUp(asks[0])) {   // C267: "make that edit" · "finish it" · "decrease it more" never mint a row
    const b = bindFollowUp({ specPath, ask: asks[0], at, tape });
    declareRows.lastRefusal = b.bound ? null : b.why;
    return b.bound ? [b.row] : [];
  }
  declareRows.lastRefusal = null;
  const md = readFileSync(specPath, 'utf8');
  let next = nextTopLevelId(md);
  const rows = asks.map((ask) => { const r = declareRow({ id: next, ask, at, tape, referent: chatReferent({ ask, chatLog, cot, specMd: md }) }); next++; return r; });
  const sep = md.endsWith('\n') ? '' : '\n';
  writeFileSync(specPath, md + sep + rows.map((r) => r.line).join('\n') + '\n');
  return rows;
}

// ── the running-code calls — every one spawns the door that already owns the step ───────────────
function trySpawn(bin, args, opts = {}) {
  try { const out = execFileSync(bin, args, { encoding: 'utf8', ...opts }); return { ok: true, code: 0, out }; }
  catch (e) { return { ok: false, code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || e.message || '') }; }
}
function lastJsonLine(out) {
  const lines = String(out || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch {} }
  return null;
}
export function setGoalFromRows({ repo = REPO, text, rows, turns = null } = {}) {
  const args = ['set', '--text', text, ...rows.flatMap((r) => ['--unit', r.id]), '--json'];
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
export function closeLine({ rows, dispatches = [], ticks = {}, envelope = null, driverRefused = null, driver = null } = {}) {
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
  return `steer: ${rows.length} rows declared (${ids.join(' ')}) · goal set${driverSeg} · ${dispatched} dispatched · ${ticked.length} ticked · open: ${open.length ? open.join(', ') : 'none'} · arms: ${work} | ${decl}`;
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
  const dr = diminishingReturns({ rows, dispatches: [], goalOverBudget: !!(st && st.turns && st.turns.over) });
  if (dr.hold) { const p = runAsksLedger({ repo, rows }); if (p) line += ` · asks: ${p} (${dr.reason})`; }
  const decay = decaySurface({ repo });   // C322d
  return decay.length ? [line, ...decay].join('\n') : line;
}

const USAGE = 'usage: node scripts/vna/steer.mjs "<text>" [--driver claude] [--max-cycles N] [--scope S] [--ceiling N] [--json]\n       node scripts/vna/steer.mjs until [--scope S] [--ceiling N] [--dry-run] [--json]\n       node scripts/vna/steer.mjs plan   (= until --dry-run: classify, order, print — $0, no row, no worker)\n       node scripts/vna/steer.mjs status|next|run|close [--json]\n       node scripts/vna/steer.mjs loop on|off|status   (C277: the ↻ keep-running box)\n       node scripts/vna/steer.mjs brief <Cn>   (C444: the -p worker brief + the worker contract, for a chat subagent)\n       node scripts/vna/steer.mjs verify <Cn> --since <head-at-dispatch> [--dry]   (C444: the follow-through — ticks only via spec-check)';
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
  if (argv[0] === 'brief' || argv[0] === 'verify') {
    const ft = await import('./steer-follow-through.mjs');
    const a2 = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const label = argv[1] && /^(C\d+[a-z]?\d*|T\d+)$/.test(argv[1]) ? argv[1] : null;
    if (!label) { console.error(`usage: steer.mjs ${argv[0]} <Cn>${argv[0] === 'verify' ? ' --since <sha> [--dry] [--witness <sha>] [--spec <path>] [--repo <path>]' : ' [--spec <path>]'}`); process.exit(2); }
    const specPath = a2('--spec') ? resolve(a2('--spec')) : SPEC_MD; const repo = a2('--repo') ? resolve(a2('--repo')) : REPO;
    if (argv[0] === 'brief') {
      let text; try { text = ft.briefFor({ label, specPath, repo }); } catch (e) { console.error(String(e.message || e)); process.exit(2); }
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
    if (!dc.built) console.log(dc.line);
    else { applyDriver(driver, { repo: REPO }); const d = dispatchOne({}); dispatches = [d]; console.log(d.ok ? (d.result ? JSON.stringify(d.result) : d.out.trim()) : `not run — ${d.out.trim().slice(0, 200)}`); }
    const rec = receipts({});
    for (const l of rec.lines) console.log(l);
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
  const out = await steer({ text, driver, maxCycles, scope, ceiling, say: asJson ? () => {} : console.log });
  if (asJson) console.log(JSON.stringify(out));
  process.exit(0);
}
