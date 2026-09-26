#!/usr/bin/env node
// scripts/vna/cockpit.mjs — THE VNA SEMANTIC COCKPIT, one HTML per turn.
//
//   node scripts/vna/cockpit.mjs [--commit <sha>=HEAD] [--no-open]
//
// Renders the operator's three panels — INTENT · REALITY · Δ — with ALL THREE ENCIRCLED
// (GoalNegSp.txt: "we only do the circle panel on the third one, but we could do all of them"),
// beside the distilled checkbox spec and a one-click clipboard payload for the right-side chat LLM.
//
// LLM-FREE END TO END. Every number and every ring on this page is a pure, re-runnable function of
// the commit. The model reads this page; it never writes it.
//
// FINDS THE RUNNING CODE, REINVENTS NOTHING:
//   runPipeline({intentText, realityText})       — the commit-scoped door that already exists
//   walk.{intent,reality,delta}_heatmap_b64      — CELLS*4 bytes → Float32Array (the documented
//                                                  decode contract at triptych-render.mjs:15)
//   decodeDeltaThreeColourEdges                  — the CANONICAL Δ tolerance decode, untouched
//   encircleSelfLane                             — intent/reality banding into the SAME hues, so
//                                                  the SAME detectRegions/encircleRegionsPng door
//                                                  works on all three (scripts/vna/self-lane-panel)
//
// THE PANELS DO NOT MEAN THE SAME THING AND THE PAGE SAYS SO. Only Δ's rings mean drift; the intent
// and reality rings mean self-dispersion (how concentrated that corpus is about its own centre).
// Narrating an intent ring as drift would be the instrument lying, so the meaning is printed under
// each panel rather than left for the reader to assume.
//
// @guard tests/vna/cockpit.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { encircleSelfLane, PANEL_MEANING } from './self-lane-panel.mjs';
import { buildPayload, parseChecklist, parseOpenQuestions } from './spec-render.mjs';
import { tapeTail, tapeText } from './tape-tail.mjs';
import { matchAperture, apertureText } from './aperture.mjs';
import { commentProseWithSpans } from '../pmu/corpus-ingest.mjs';
import { panel as canonicalPanel } from '../pmu/panel-door.mjs';
import { runConfig, configText } from './run-config.mjs';   // the robot accounting: what was actually in effect
import { intentRowsFor } from './intent-rows.mjs';   // C311: the rows the commit SERVES, never a dense window of the whole spec
import { goalStatus } from './goal.mjs';   // C311 rule 3 — the /goal in force's OPEN units

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const SPEC = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
const LENS = resolve(REPO, '.thetacog/lens-encircled/latest.json');
const CELLS = 144 * 144;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const argv = process.argv.slice(2);
// ── `--out <dir>` — AN ISOLATED DESTINATION, so a run cannot clobber another run's receipt ──────
// Operator, 2026-09-08: "we run in different ways from different locations. It always has to work.
// It's quite complex so we have to make sure we don't go through this stuff, because it's gonna be
// brittle and break easily."
//
// MEASURED, and it is the brittleness he predicted arriving on schedule: `node --test tests/vna/`
// runs files CONCURRENTLY, several of them spawn this script, and every one wrote the same
// `data/vna/cockpit.json`. So one file's render overwrote the receipt another file was mid-way
// through reading, and two guards went red roughly one run in three — for a reason that had nothing
// to do with either guard. An intermittent red is worse than a solid one: it trains you to re-run
// until it passes, which is the habit that makes every other red invisible.
//
// The fix is a DESTINATION, not a lock. A lock would serialize the suite and still leave the shared
// path; a destination means concurrent runs are simply not talking about the same file. The default
// is unchanged, so nothing that does not ask for isolation notices.
const outArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const OUT_ROOT = outArg ? resolve(outArg) : REPO;
const OUT_DIR = resolve(OUT_ROOT, 'docs/specs/vna/turns');

const noOpen = argv.includes('--no-open');
// THE DEFAULT COMMIT IS THE LAST AUTHORED ONE, NOT HEAD (2026-09-17). Every authored commit is
// followed by the post-commit hook's own `chore(commit-page): publish …` (one generated file,
// reality 0 bytes), so "walk HEAD" walked the machine's commit and the aperture refused all three
// panels — three REFUSED boxes on the panel for a commit the operator never made. A machine commit
// is skipped; an explicit --commit is honoured as given.
// The rule moved to authored-commit.mjs (C309b) so the extension's sign door resolves the same way; re-exported here
// for the callers (and tests) that import it from cockpit.
export { MACHINE_COMMIT, pickAuthoredCommit } from './authored-commit.mjs';
import { lastAuthored as lastAuthoredIn, resolveCommitArg } from './authored-commit.mjs';
const lastAuthored = () => lastAuthoredIn(REPO);
const sha = (argv[argv.indexOf('--commit') + 1] && argv.includes('--commit')) ? resolveCommitArg(argv[argv.indexOf('--commit') + 1], REPO) : lastAuthored();
// PREVIEW MODE (C25, §17.4). `--reality tree` answers "where would this land if committed now?" over
// the MUTABLE working tree. It is not a receipt and must never be shown as one: a receipt reads a
// record the actor did not author (AXIOM 1 W3), and the working tree is exactly the record the actor
// is still writing. So a preview carries source:'tree' and its own caption, writes its own files,
// and never touches latest.html or data/vna/cockpit.json — the two are never displayed under one
// caption, and sharing an output path is the surest way to end up displaying them that way.
const preview = argv.includes('--reality') && argv[argv.indexOf('--reality') + 1] === 'tree';
// ── INGEST CONTROL (operator, 2026-09-08: "we need control of the ingest sources so we can check") ──
// `--intent spec|message|both`. DEFAULT spec, and the default moved for a reason he named himself:
//   "that's different from the bar between the correct message and the writing, which is a delta of a
//    different kind — that's 'did you DECLARE what you said'. This is 'did you do what the SPEC said',
//    which is what it's supposed to be doing."
// TWO QUESTIONS, NEVER MERGED, and until now this file only ever asked the weaker one:
//   message — did the commit message describe its own diff? Near-tautological: a commit that says what
//             it did scores clean, which is exactly the "almost exactly doing what it said" Δ he saw.
//   spec    — did the work land where the DECLARATION said it would? This is the VNA question.
// IT ALSO ENDS THE STARVATION, measured rather than argued. The aperture matches the larger side DOWN
// to the smaller. With intent = a commit message (3031 raw / 1646 gzip on 854c98681a) the reality side
// was cut from 5967 gzip to 2073 — 65% of the work discarded before the walk saw it. That is why the
// intent and reality panels read as sparse lines: there was almost nothing left to be chaotic with.
const intentAsked = argv.includes('--intent') ? String(argv[argv.indexOf('--intent') + 1] || 'spec') : 'spec';
// C125 — THE STRANGER'S FIRST WALK (2026-09-20). A repo that has never declared a row has no
// docs/specs/vna/SPEC-VNA-COCKPIT.md, and until this landed the default walk died there with ENOENT before
// the chip saw a byte — the first thing a marketplace install did was crash (seen red in a scratch repo:
// `npx thetacog-mcp steer-ui` → "not run — steer-ui: TypeError"). The walk still runs: HEAD's message is
// the intent until the first row is declared, and the receipt SAYS SO (`intentFallback`) so a reader never
// mistakes the weaker question (did the commit describe its diff) for the VNA one (did it land where the
// spec said). Asking for spec explicitly (`--intent spec`) with no spec is still the caller's error.
const specDeclared = existsSync(resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'));
const intentFallback = !specDeclared && !argv.includes('--intent') ? 'no spec declared at docs/specs/vna/SPEC-VNA-COCKPIT.md — HEAD\'s message is the intent until the first row is declared' : null;
const intentMode = intentFallback ? 'message' : intentAsked;
// How many tape entries ride in the payload. 5 by default — enough mass to compare against, few
// enough to stay readable in a chat window.
const tapeN = argv.includes('--tape') ? Math.max(1, Math.min(50, Number(argv[argv.indexOf('--tape') + 1]) || 5)) : 5;
const g = (cmd) => execSync(cmd, { cwd: REPO, maxBuffer: 1 << 26 }).toString();

// ── THE MATRIX SOURCE — measured, not assumed ────────────────────────────────
// MEASURED AND REJECTED: walk.intent_heatmap_b64 decodes to a clean CELLS*4 Float32Array, so it
// LOOKS like the matrix these banders want. It is not. It is a near-flat PLATEAU — 400 lit cells
// whose values span 6 parts in 14,800 (0.04% relative spread). significantEdges() thresholds at
// mean + k*std, and on a flat field the std collapses, so it found 20 cells against a floor of 24
// and all three panels REFUSED. The refusal was correct behaviour on the wrong input: that blob is
// a LIT-SET, not a heat field, and conflating the two produces a false refusal.
//
// The canonical path (commit-triptych.mjs:746) feeds decodeDeltaThreeColourEdges the COLE matrices
// — the output of definerWalk144, the real recursive on-chip ballistic walk over the commit's own
// grid. Those carry genuine ply-decay dynamic range: same commit, 380 nonzero and 380 significant
// cells, in 25ms. So we drive the walk the canonical path drives.
//
// THE WALK IS ALWAYS THE REAL RECURSIVE ON-CHIP BALLISTIC WALK (hard rule) — never an analytic
// shortcut, never a JS BFS, never the flat heatmap standing in for it.
// THIS FILE NO LONGER WALKS. It once carried `unpackGrid` + `coleMatrix` — its own grid unpack and
// its own definerWalk144 call — because the door returned a picture and nothing else. The door now
// returns the walk it already ran, so the second implementation is gone rather than merely unused: a
// fallback that runs a DIFFERENT instrument is not a safety net, it is the second door with a
// conditional in front of it. If the door cannot render, this file reports that and shows no panel.
const png64 = (buf) => 'data:image/png;base64,' + buf.toString('base64');

async function main() {
  const shaFull = g(`git rev-parse ${sha}`).trim();
  const shaShort = preview ? 'TREE' : shaFull.slice(0, 9);

// ── CODE REACHES THE REALITY CORPUS AS ITS PROSE, NEVER AS ITS SOURCE ────────────────────────
// PMU DOGFOOD rule 4, which this script was not obeying: "INGEST = docs→intent, code→reality,
// SEMANTIC not raw (comments + identifier-words from code)". `corpus-ingest.mjs` has carried the
// reason since v4-prose (2026-06-05): the reality corpus was ~81% code-as-claim and the 144 English
// anchors gripped identifier soup, so `classifyClaim` was added as the prose-vs-code gate.
// cockpit.mjs fed raw `git show` output straight in and inherited exactly that failure.
//
// MEASURED, and it is why this is a defect and not a preference: a prose commit (f28a436214, an
// .html strategy doc) renders 11 reality rings, while code commits (be258163b1, 79c4628805 — both
// only .mjs) produce ZERO significant cells, refuse on the lit-mass floor, and take the Δ panel
// down with them. Raw JavaScript shares almost no vocabulary with the anchors, so the score field
// comes out flat — which is rung 1's signature, the population-average field. The instrument was
// structurally unable to measure the work that builds it.
//
// `commentProse` returns '' for a non-code extension, so prose files pass through untouched and
// this is one rule in one place rather than an extension test re-typed here. A code file with no
// comments falls back to its source and is COUNTED as such — dropping it would understate the mass
// silently, and "read as raw source" is a thing the receipt should say out loud.
// C115z (operator: "we should see which parts of what files are aperture receipts") — a picked
// window (aperture.rs pick_window's usedStart/usedEnd) is a byte range into THIS function's return
// value, so `proseMaps` remembers, per path, how to walk that range back to file lines: the
// comment-prose block spans when there were comments, or a direct byte→line count on the raw text
// when there were none (a code file with no comments is read as raw, per the rule above). Read from
// the same extraction readAs already performs — never a second pass over the file.
const proseMaps = new Map();
const readAs = (path, text, tally) => {
  const { text: prose, spans } = commentProseWithSpans(text, extname(path));
  tally.push({ side: 'reality', path, via: prose ? 'comment-prose' : 'raw', rawBytes: Buffer.byteLength(text), usedBytes: Buffer.byteLength(prose || text), detail: null });
  proseMaps.set(path, prose ? { kind: 'comment-prose', spans } : { kind: 'raw', rawText: text });
  return prose || text;
};
// A byte range [start, end) into the text readAs(path, …) returned → the file LINE ranges it came
// from (1-indexed, inclusive). null when the path was never read as reality (nothing to map).
function spanToLines(path, start, end) {
  const info = proseMaps.get(path);
  if (!info || typeof start !== 'number' || typeof end !== 'number') return null;
  if (info.kind === 'raw') {
    const buf = Buffer.from(info.rawText, 'utf8');
    const lineAt = (b) => buf.subarray(0, Math.max(0, Math.min(b, buf.length))).toString('utf8').split('\n').length;
    return [[lineAt(start), lineAt(end)]];
  }
  return info.spans.filter((s) => s.proseStart < end && s.proseEnd > start).map((s) => [s.startLine, s.endLine]);
}

  // THE EFFECTIVE CONFIGURATION, resolved before anything reads a file. Eight environment variables
  // reach this render path and any of them changes the output without appearing in it — a shell that
  // exports COVERAGE_ENCIRCLE renders through a different clusterer entirely and still calls itself
  // the receipt. The manifest makes "was this run configured like that run" a hash comparison.
  const config = runConfig({ repo: REPO, argv, extra: { intentMode, preview, sha: String(sha) } });

  const ingest = [];
  const SPEC_MD = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');

  // C311 — THE ROWS THE COMMIT SERVES, never a dense window of the whole spec. His own diagnosis was
  // "maybe the specifications are not itemized correctly" — but even the itemized form is now ~1 MB
  // (674 items): the aperture cuts it to 1.4% and `pickWindow` keeps ONE dense window of whatever
  // survives, which on cad904b9a was five rows (C84g C46 C47 C85 C85a) a walking-prompt commit never
  // named and never touched. So intent is the rows the commit actually DECLARES against — first rule
  // that yields rows wins: the C-ids the commit message names, then the rows whose declared paths
  // cover the changed files, then the goal-in-force's open units, and only when none of those match
  // does the old whole-spec window survive, LABELLED as the fallback it is. See scripts/vna/intent-rows.mjs.
  let intentRowsResult = null;

  let msg, subject, files;
  let reality = '';
  const realityDocs = [];
  if (preview) {
    // INTENT is the message being DRAFTED — .git/COMMIT_EDITMSG if the operator is mid-commit,
    // otherwise the last message, said out loud rather than silently substituted, because the two
    // are different claims about what this change is meant to be.
    const editMsg = resolve(REPO, '.git/COMMIT_EDITMSG');
    const drafted = existsSync(editMsg) ? readFileSync(editMsg, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n').trim() : '';
    msg = drafted || g('git log -1 --pretty=%B HEAD');
    subject = `PREVIEW · ${(drafted ? 'drafted message' : 'no drafted message — HEAD\'s is standing in')} · ${msg.split('\n')[0].slice(0, 80)}`;
    // REALITY is the uncommitted change: tracked modifications plus staged adds. Untracked files are
    // NOT included — an untracked file is not yet part of what a commit would carry, and counting it
    // would make the preview answer a question the commit will not ask.
    files = [...new Set([
      ...g('git diff --name-only HEAD').split('\n'),
      ...g('git diff --cached --name-only').split('\n'),
    ])].filter(Boolean);
    const binary = new Set([...g('git diff --numstat HEAD').split('\n'), ...g('git diff --cached --numstat').split('\n')]
      .map((l) => l.split('\t')).filter((c) => c[0] === '-' && c[1] === '-').map((c) => c[2]).filter(Boolean));
    for (const f of files.slice(0, 20)) {
      if (binary.has(f)) continue;
      try { const t = readFileSync(resolve(REPO, f), 'utf8'); realityDocs.push({ path: f, text: readAs(f, t, ingest) }); } catch { /* deleted in tree */ }
    }
  } else {
    msg = g(`git log -1 --pretty=%B ${shaFull}`);
    subject = msg.split('\n')[0];
    files = g(`git show --name-only --pretty=format: ${shaFull}`).split('\n').filter(Boolean);
    // COMMIT-SCOPED INGEST, the canonical anatomy: message+docs → INTENT, changed code → REALITY.
    // BINARY PATHS ARE ASKED OF GIT, NEVER GUESSED FROM AN EXTENSION. `--numstat` prints `-\t-` for
    // every file git itself considers binary, which is the construct; an extension blacklist is the
    // token standing in for it and would miss a `.woff`, a `.pdf`, or a base64 blob in a `.json`.
    // The defect this closes, measured on edba994b3: the reality corpus was
    // `public/commit/f28a436214/trip-encircled-f28a436214.png` — 37181 bytes of PNG read as utf8 and
    // cut to 200. gzip-NCD over compressed-image header bytes measures the deflate stream, not the
    // work, and every ring drawn from that pair was reading an image's entropy as semantics.
    const binary = new Set(g(`git diff-tree --no-commit-id -r --numstat ${shaFull}`).split('\n')
      .map((l) => l.split('\t')).filter((c) => c[0] === '-' && c[1] === '-').map((c) => c[2]).filter(Boolean));
    for (const f of files.slice(0, 20)) {
      if (binary.has(f)) continue;
      try { const t = g(`git show ${shaFull}:${f}`); realityDocs.push({ path: f, text: readAs(f, t, ingest) }); } catch { /* deleted file */ }
    }
  }

  // MATCH THE APERTURE BEFORE THE CRUNCH. Measured across six commits before this landed: intent
  // 84–2798 bytes against reality 4001–60560 — up to 80:1. gzip-NCD measures MEANING only at matched
  // mass; at 80:1 it measures length, and every ring drawn from that pair was reading length noise.
  // The larger side is CUT (never the smaller grown — repetition adds length, not entropy), and each
  // document's share is proportional so a 16-file commit is not judged by the first four.
  // EVERY INTENT DOCUMENT IS NAMED AND COUNTED, exactly like the reality side, so "what went in" is
  // answerable by reading the receipt rather than by reading this file.
  const intentDocs = [];
  if (intentMode === 'spec' || intentMode === 'both') {
    const specMdText = existsSync(SPEC_MD) ? readFileSync(SPEC_MD, 'utf8') : '';
    // write:false — a walk must never mutate .thetacog/vna-active-leaf.json as a side effect of reading
    // which rows are open; only an explicit `goal.mjs status` call is allowed to write that pointer.
    // Named goalSt, never `g` — the outer `g` above is the shell-out helper, and shadowing it with a
    // `const` in this same function scope would put every earlier `g(...)` call in the temporal dead zone.
    const goalSt = goalStatus({ repo: REPO, md: specMdText, write: false });
    intentRowsResult = intentRowsFor({ message: msg, changedFiles: files, specMd: specMdText, goalUnits: goalSt?.units || [] });
    const label = intentRowsResult.rule === 'window'
      ? 'SPEC-VNA-COCKPIT.md (itemized, window fallback — no row named the commit)'
      : `SPEC-VNA-COCKPIT.md (rows: ${intentRowsResult.rule} ${intentRowsResult.ids.join(',')})`;
    intentDocs.push({ path: label, text: intentRowsResult.text });
    ingest.push({ side: 'intent', path: 'SPEC-VNA-COCKPIT.md', via: `intent-rows:${intentRowsResult.rule}`,
      rawBytes: Buffer.byteLength(intentRowsResult.text),
      detail: intentRowsResult.ids.length ? intentRowsResult.ids.join(' ') : 'whole-spec window (no row matched — fallback)' });
  }
  if (intentMode === 'message' || intentMode === 'both') {
    intentDocs.push({ path: 'commit message', text: msg });
    ingest.push({ side: 'intent', path: 'commit message', via: 'raw', rawBytes: Buffer.byteLength(msg), detail: null });
  }
  if (!intentDocs.length) { console.error('--intent must be spec|message|both (got "' + intentMode + '")'); process.exit(2); }
  const ap = matchAperture(intentDocs, realityDocs);
  reality = ap.reality;
  const intentText = ap.intent;

  // C115z — WHICH FILE LINES each reality row's kept window came from, read off the SAME
  // usedStart/usedEnd the chip (or its node fallback) already decided — never re-derived, only
  // translated to lines via the map readAs built while ingesting. Attached here, once, so every
  // downstream reader (cockpit.json, the aperture receipt, the steer page) sees the same spans.
  for (const row of ap.rows) {
    if (row.side !== 'reality') continue;
    row.lines = spanToLines(row.path, row.usedStart, row.usedEnd);
  }

  // ── THE APERTURE'S OWN VERDICT REACHES THE PANEL, which it previously did not ─────────────
  // `matchAperture` already computes `admissible` — does each side carry enough gzip mass (floor
  // 220) to be READ at all — and cockpit.mjs printed it in the summary line and then rendered
  // anyway. Measured on edba994b3: intent gzip 60 / reality gzip 175 against the 220 floor,
  // `admissible: false`, and the INTENT panel still drew four rings over a periodic comb. The Δ and
  // reality panels happened to refuse, but on the LATER lit-mass rung and for a different reason —
  // so two of three caught it by luck and the one the operator was looking at did not.
  //
  // A PERIODIC TILING WITH FULL-WIDTH ELLIPSES IS THE LENGTH ARTIFACT'S SIGNATURE, not structure:
  // below the mass floor gzip-NCD is comparing string lengths, the field has no locality, and the
  // ring detector faithfully encircles the regular comb that produces. The panel that refuses is
  // telling the truth; the panel that draws is not. Refusal carries the aperture's own reason and
  // its own numbers, so "I could not read this" is never confusable with "I read it and it was clean".
  const apertureRefusal = ap.admissible ? null
    : `REFUSED — APERTURE · ${ap.reason} · a reading below the mass floor is length, not meaning`;

  // ── Δ COMES THROUGH THE ONE DOOR, NEVER THIS FILE'S OWN WALK ────────────────────────────────
  // Operator, seeing the two panels side by side: "the panel does not have the right rust running,
  // thetacog-mcp does... the third encircled panel is blank in vna, the other is the working rust."
  // He was right, and `tests/pmu/one-panel-door.test.mjs` had been RED the whole time saying so:
  // "A SECOND DOOR was just born" — naming scripts/vna/cockpit.mjs, engine-map.mjs and frame.mjs.
  //
  // WHAT DIVERGED, precisely. `buildTriptychInputs` seeds the walk from senseDecompose's grid at the
  // sensed argmax (pickStartPixel over the actor mass, then the patient argmax) with a DETERMINISTIC
  // hop budget. This file built its grid from the XOR stage's binarized bitmap and seeded from
  // `intent_lit_indices.slice(0, 2)` — the first two lit indices in index order, which is arbitrary —
  // under a 2500ms WALL-CLOCK budget, so the σ was machine-load dependent on top of everything else.
  // Same walker, different grid, different seed, different budget: a different instrument wearing the
  // same name.
  //
  // MEASURED on 854c98681a, the same commit both ways: this file's Δ rendered 0 rings — blank, which
  // reads as "clean" — while the door returned a 17,420-byte panel with 5 regions, 18% off-lane,
  // 952 green / 780 amber. A blank panel and a clean panel are different claims and this one was
  // making the wrong one.
  //
  // IT COSTS ~23s AGAINST ~230ms, and that is the honest trade: speed is why a second door gets born
  // and a fast blank panel is worth nothing. The door is also what "tied to practical processes"
  // means here — it is the same panel the commit email ships and the same one thetacog-mcp serves.
  let doorDelta = null;
  if (!apertureRefusal) {
    // FED THE APERTURE-CUT TEXTS, and that is recorded rather than left for a reader to discover.
    // The commit-email path feeds the door RAW intent and reality; this file cuts both to a matched
    // size-order first (the aperture stage above). Both are defensible, they are NOT the same
    // reading, and the difference is real: on 854c98681a the raw feed reports 18% off-lane and the
    // cut feed 11%. So the receipt says which it was — a number that silently answers a different
    // question than the one on the published panel is the drift this whole instrument exists to name.
    doorDelta = await canonicalPanel({ intent: intentText, reality, message: msg, label: `commit ${shaShort}` });
  }
  // The stages the door already ran — read from its return rather than recomputed. `x` is kept only
  // for the payload's drift_pct line; nothing here walks.
  const w = doorDelta?.stages?.walk || {};
  const x = doorDelta?.stages?.xor || {};
  const senseStage = doorDelta?.stages?.sense || {};
  const pipelineMs = doorDelta?.stages?.pipelineMs ?? doorDelta?.meta?.ms ?? 0;

  // ── THE MATRICES ARE THE DOOR'S, AND THERE IS NO SECOND SOURCE ─────────────────────────────
  // Operator: "the intent and reality are way too sparse. They are reading lines instead of dots."
  //
  // MEASURED, and the grid was never the problem: on 854c98681a the reality grid carries 529 lit
  // cells and intent 625 — plenty of mass. What died was the WALK. The local walk was seeded from
  // `*_lit_indices.slice(0, 2)` — the two LOWEST-NUMBERED lit axes, an arbitrary corner of the
  // lattice — and terminated in 26 hops at ply 3. A walk launched from a leaf produces a near-flat
  // field; `significantEdges` thresholds at mean + k·std; a collapsed std yields ZERO significant
  // cells. That is the sparseness, and it is the anti-rules ledger's "unlit starts" forbidden form.
  //
  // The canonical walk picks its seed by MASS — pickStartPixel over the sensed argmax actor mass,
  // then the patient argmax — under a DETERMINISTIC hop budget rather than a wall clock, which is
  // why it reaches hundreds of cells and why its σ is recomputable. It was always being computed one
  // layer inside the door and thrown away.
  let im = null, rm = null, walkMeta = null;
  const walkSource = doorDelta?.cole ? 'panel-door (canonical: sensed-argmax seed, deterministic hop budget)' : 'none — the door returned no walk';
  if (doorDelta?.cole?.intent?.matrix && doorDelta.cole.reality?.matrix) {
    im = Float64Array.from(doorDelta.cole.intent.matrix);
    rm = Float64Array.from(doorDelta.cole.reality.matrix);
    const c = doorDelta.cole;
    walkMeta = { hops: c.hops ?? null, maxPly: c.maxPly ?? null, startPixel: c.startPixel ?? null, matchSigma: c.matchSigma ?? null, source: walkSource };
  }

  const panels = [];
  let deltaInfo = null;


  if (apertureRefusal) {
    deltaInfo = { refused: true, refusal: apertureRefusal };
    for (const [id, title] of [['intent', 'INTENT · declared mass'], ['reality', 'REALITY · performed mass'], ['delta', 'Δ INTENT vs REALITY']]) {
      panels.push({ id, title, png: null, meaning: PANEL_MEANING[id], note: apertureRefusal, counts: null });
    }
  } else if (im && rm) {
    // Δ — the canonical decode, untouched. This is the receipt everyone already trusts.
    // The door's verdict is the Δ. `decodeDeltaThreeColourEdges` is still what the door runs one
    // layer down — it is reached THROUGH the door now, not around it, so this file no longer imports it.
    if (doorDelta && doorDelta.png) {
      const dm = doorDelta.meta || {};
      deltaInfo = { offPct: dm.offPct, green: dm.green, amber: dm.amber, red: dm.red, tooMany: dm.tooMany, engine: dm.engine, ms: dm.ms, via: 'panel-door', fedWith: 'aperture-cut (the commit-email path feeds RAW — these are different readings)' };
      panels.push({ id: 'delta', title: 'Δ INTENT vs REALITY', png: png64(doorDelta.png), meaning: PANEL_MEANING.delta,
        regions: doorDelta.regions || [], counts: { green: dm.green, amber: dm.amber, red: dm.red, offPct: dm.offPct } });
    } else if (doorDelta) {
      // NEVER a fabricated blank: the door reports WHY it could not render and that reason ships.
      deltaInfo = { refused: true, refusal: doorDelta.unmeasured || 'the door returned no panel' };
      panels.push({ id: 'delta', title: 'Δ INTENT vs REALITY', png: null, meaning: PANEL_MEANING.delta, note: deltaInfo.refusal, counts: null });
    }
    // INTENT + REALITY — self-dispersion through the SAME encircle door.
    for (const [id, mat, title] of [['intent', im, 'INTENT · declared mass'], ['reality', rm, 'REALITY · performed mass']]) {
      const s = encircleSelfLane(mat);
      panels.unshift({ id, title, png: s.png ? png64(s.png) : null, meaning: PANEL_MEANING[id],
        note: s.refused ? s.refusal : null, regions: s.regions, fieldWide: s.fieldWide,
        counts: s.refused ? null : { green: s.green, amber: s.amber, red: s.red, dispersionPct: s.dispersionPct } });
    }
    panels.sort((a, b) => ['intent', 'reality', 'delta'].indexOf(a.id) - ['intent', 'reality', 'delta'].indexOf(b.id));
  }

  // the distilled spec state — the thing that gets pasted right
  const md = existsSync(SPEC) ? readFileSync(SPEC, 'utf8') : '';
  const checklist = parseChecklist(md), questions = parseOpenQuestions(md);
  let lens = null; try { lens = JSON.parse(readFileSync(LENS, 'utf8')); } catch {}
  const specPayload = buildPayload({ version: shaShort, checklist, questions, lens,
    specBytes: Buffer.byteLength(md), txtBytes: 0 });

  // THE DRIFT-ZONE PAYLOAD — reef-named, never bare coordinates (ALWAYS EXPAND COORDINATE LABELS).
  // The semantic content of the red cells IS the reasoning material: they were ATTRACTED there.
  const zoneLines = [];
  for (const p of panels) {
    if (!p.regions?.length) continue;
    zoneLines.push(`## ${p.title}`);
    zoneLines.push(`meaning: ${p.meaning}`);
    for (const rg of p.regions.slice(0, 24)) {
      // expandCoordName returns an OBJECT; .name is the written-out ShortLex + domain + vocab
      // ("C1.Operations.Grid × B1.Tactics.Speed → ~market-posture · posture positioning market").
      // ALWAYS EXPAND COORDINATE LABELS: a bare "C1,B1" is opaque to the reader on the right, and
      // the expanded vocab IS the semantic content that got attracted — the reasoning material.
      const reef = rg.reef && typeof rg.reef === 'object' ? rg.reef : null;
      const nm = reef?.name || (typeof rg.reef === 'string' ? rg.reef : '') || rg.coord?.label || '';
      const band = rg.kind === 1 ? 'green' : rg.kind === 2 ? 'amber' : 'red';
      zoneLines.push(`- [${band}] ${rg.coord?.center || '?'} — ${nm}`);
    }
  }
  const fullPayload = [
    preview ? '# VNA COCKPIT — PREVIEW · mutable tree · not a receipt' : `# VNA COCKPIT — commit ${shaShort}`,
    `source: ${preview ? 'tree' : 'commit'}`,
    `subject: ${subject}`,
    `files: ${files.length} · pipeline ${pipelineMs}ms · walk agreement ${w.agreement_pct ?? '—'}% · divergence ${w.divergence_pct ?? '—'}%`,
    `witness agreement (sense stage, primary ${senseStage.primary_witness ?? '?'} vs secondary ${senseStage.secondary_witness ?? '?'}): intent ${senseStage.intent_witness_agree ?? '—'}/144 · reality ${senseStage.reality_witness_agree ?? '—'}/144`,
    deltaInfo && !deltaInfo.refused ? `Δ verdict: off-lane ${deltaInfo.offPct}% (green ${deltaInfo.green} · amber ${deltaInfo.amber} · red ${deltaInfo.red})` : `Δ verdict: ${deltaInfo?.refusal || 'UNAVAILABLE'}`,
    '',
    apertureText(ap),
    '',
    '# ATTRACTED SEMANTIC CONTENT — the cells the walk landed on, with what they mean',
    ...zoneLines,
    '',
    // SEMANTIC MASS ON THIS SIDE OF THE APERTURE (META-BULK). One commit's placement is a thin rule
    // with no mass; gzip-NCD and the model on the right are both left matching length noise against
    // it. The last few entries WITH THEIR TEXT restore the mass. `--tape N` widens it.
    tapeText(tapeTail(tapeN)),
    '',
    specPayload
  ].join('\n');

  const stateHash = createHash('sha256').update(shaFull + md + fullPayload).digest('hex').slice(0, 16);
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(resolve(OUT_ROOT, 'data/vna'), { recursive: true });
  const turn = (readdirSync(OUT_DIR).map((f) => /^t(\d+)-/.exec(f)?.[1]).filter(Boolean).map(Number).reduce((a, b) => Math.max(a, b), 0)) + 1;

  const done = checklist.filter((c) => c.done).length;
  const panelHtml = panels.map((p) => `
  <div class="panel">
    <h3>${esc(p.title)}</h3>
    ${p.png ? `<img src="${p.png}" alt="${esc(p.title)}">` : `<div class="norender">${esc(p.note || 'not rendered')}</div>`}
    <div class="means">${esc(p.meaning)}</div>
    ${p.counts ? `<div class="counts"><span class="g">${p.counts.green}</span> · <span class="a">${p.counts.amber}</span> · <span class="r">${p.counts.red}</span>${p.counts.offPct != null ? ` · off-lane <b>${p.counts.offPct}%</b>` : ''}${p.counts.dispersionPct != null ? ` · dispersion <b>${p.counts.dispersionPct}%</b>` : ''}</div>` : ''}
  </div>`).join('');

  const chk = checklist.map((c) => `<li class="${c.done ? 'ok' : 'todo'}"><b>${esc(c.id)}</b> ${esc(c.text)}</li>`).join('');
  const qs = questions.map((q) => `<li><b>${esc(q.id)}</b> ${esc(q.text)}</li>`).join('');

  const html = `<!doctype html><meta charset="utf-8"><title>VNA cockpit · ${esc(shaShort)}</title>
<style>
:root{--bg:#0a0c10;--fg:#d8dee9;--dim:#7b8794;--acc:#4ec9b0;--g:#1e9150;--a:#ffb000;--r:#ff5959}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-monospace,Menlo,monospace}
.wrap{max-width:1400px;margin:0 auto;padding:22px}
h1{font-size:18px;margin:0 0 3px}.sub{color:var(--dim);font-size:12px;margin-bottom:16px}
.panels{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
@media(max-width:980px){.panels{grid-template-columns:1fr}}
.panel{border:1px solid #1e242e;background:#0e1218;border-radius:8px;padding:11px}
.panel h3{font-size:11px;text-transform:uppercase;letter-spacing:.11em;color:var(--acc);margin:0 0 8px}
.panel img{width:100%;image-rendering:pixelated;border-radius:5px;display:block}
.means{color:var(--dim);font-size:11px;margin-top:8px;line-height:1.45}
.counts{margin-top:6px;font-size:12px}.counts .g{color:var(--g)}.counts .a{color:var(--a)}.counts .r{color:var(--r)}
.norender{padding:26px 10px;text-align:center;color:var(--dim);border:1px dashed #232b36;border-radius:5px;font-size:11px}
.grid{display:grid;grid-template-columns:1fr 400px;gap:18px}
@media(max-width:980px){.grid{grid-template-columns:1fr}}
.card{border:1px solid #1e242e;background:#0e1218;border-radius:8px;padding:14px;margin-bottom:14px}
.card h2{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--acc);margin:0 0 9px}
ul{list-style:none;padding:0;margin:0}li{padding:3px 0;border-bottom:1px solid #151a22;font-size:12.5px}
li.ok{color:var(--g)}li.ok b:before{content:"✔ "}li.todo b:before{content:"☐ "}
button{background:var(--acc);color:#04140f;border:0;border-radius:5px;padding:10px;font:inherit;font-weight:700;cursor:pointer;width:100%}
button.alt{background:#232b36;color:var(--fg);margin-top:7px}
textarea{position:absolute;left:-9999px}
.hash{color:var(--dim);font-size:11px}
</style>
<div class="wrap">
<h1>${preview ? 'VNA COCKPIT · <span style="color:var(--a)">PREVIEW · mutable tree · not a receipt</span>' : `VNA COCKPIT · turn ${turn} · commit ${esc(shaShort)}`}</h1>
<div class="sub">${esc(subject.slice(0, 120))} · ${files.length} files · pipeline ${pipelineMs}ms · agreement ${w.agreement_pct ?? '—'}% · LLM-free · stateHash <span class="hash">${stateHash}</span></div>
<div class="panels">${panelHtml || '<div class="norender">no heat matrices this run — panels not rendered (never substituted)</div>'}</div>
<div class="grid">
 <div>
  <div class="card"><h2>Spec checklist — ${done}/${checklist.length}</h2><ul>${chk}</ul></div>
  <div class="card"><h2>Open questions</h2><ul>${qs}</ul></div>
 </div>
 <div>
  <div class="card"><h2>Copy right →</h2>
   <button onclick="cp('pay',this,'📋 Copy cockpit + spec state')">📋 Copy cockpit + spec state</button>
   <button class="alt" onclick="cp('zon',this,'📋 Copy drift zones only')">📋 Copy drift zones only</button>
   <textarea id="pay">${esc(fullPayload)}</textarea>
   <textarea id="zon">${esc(zoneLines.join('\n'))}</textarea>
  </div>
  <div class="card"><h2>Reading the panels</h2>
   <p style="color:var(--dim);font-size:11.5px;margin:0">Only the Δ panel's rings mean <b>drift</b>. Intent and reality rings mean <b>self-dispersion</b> — how tightly that corpus clusters about its own centre. Scattered work matching a scattered declaration reads in-lane on Δ and still reads red on reality; both are correct.</p></div>
 </div>
</div></div>
<script>function cp(id,btn,label){const t=document.getElementById(id);t.select();document.execCommand('copy');btn.textContent='✅ copied';setTimeout(()=>btn.textContent=label,1400);}</script>`;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const p = resolve(OUT_DIR, preview ? `preview-${stamp}.html` : `t${turn}-${shaShort}-${stamp}.html`);
  writeFileSync(p, html);
  // A PREVIEW NEVER WRITES THE RECEIPT'S PATHS. latest.html and COCKPIT-PAYLOAD.txt are what the IDE
  // and the clipboard read as "where did HEAD land?"; a preview overwriting them would answer a
  // different question under the same name, which is precisely what §17.4 forbids.
  writeFileSync(resolve(OUT_DIR, preview ? 'preview-latest.html' : 'latest.html'), html);
  writeFileSync(resolve(OUT_ROOT, preview ? 'docs/specs/vna/PREVIEW-PAYLOAD.txt' : 'docs/specs/vna/COCKPIT-PAYLOAD.txt'), fullPayload);

  // ── THE RECEIPT — so a SECOND surface can show this run without re-walking the chip ──────────
  // steer-ui.mjs paints from receipts and computes nothing, so before this file existed the only
  // rust-backed half of the loop was invisible there: the page showed the map and the spec, and a
  // reader could not tell whether the ballistic walk had run at all. That is the absence-vs-zero
  // failure one level up — not a missing number, a missing SENSOR with nothing saying so.
  // The panels ride as data: URIs because the PNG is the artifact, not a pointer to one, and a
  // second reader resolving a relative path against a different cwd is how a panel renders blank.
  mkdirSync(resolve(REPO, 'data/vna'), { recursive: true });
  writeFileSync(resolve(OUT_ROOT, preview ? 'data/vna/cockpit-preview.json' : 'data/vna/cockpit.json'), JSON.stringify({
    preview,
    generatedAt: new Date().toISOString(),
    turn, commit: shaShort, commitFull: shaFull, subject, files: files.length,
    pipelineMs,
    engine: w.engine || null,               // 'rust-ballistic-walk' when the chip walked
    agreementPct: w.agreement_pct ?? null,
    divergencePct: w.divergence_pct ?? null,
    dignityPixel: w.dignity_pixel ?? null,
    divergencePixel: w.divergence_pixel ?? null,
    walk: walkMeta, delta: deltaInfo, stateHash,
    // WHAT THE CHIP LOOKED AT, as rows. Without this the panels are a conclusion with no premise:
    // you can see where mass landed and not which documents produced it, which makes a wrong reading
    // indistinguishable from a wrong input.
    intentMode,
    intentFallback,
    // C311 — which rule chose the intent rows, and which rows: 'message'|'paths'|'goal' name real
    // rows the commit serves; 'window' (or null, when intentMode never ran intentRowsFor) means the
    // labelled whole-spec fallback, never a silent one.
    intentRows: intentRowsResult ? { rule: intentRowsResult.rule, ids: intentRowsResult.ids } : null,
    config,
    walkSource,
    ingest,
    aperture: { engine: ap.engine, rawRatio: ap.rawRatio, usedRatio: ap.usedRatio, matched: ap.matched, admissible: ap.admissible,
      intentBytes: ap.intentBytes, realityBytes: ap.realityBytes, intentGzip: ap.intentGzip,
      realityGzip: ap.realityGzip, floor: ap.floor, reason: ap.reason, rows: ap.rows },
    html: p.slice(REPO.length + 1),
    panels: panels.map((pl) => ({
      id: pl.id, title: pl.title, meaning: pl.meaning, note: pl.note || null,
      png: pl.png || null, rings: pl.regions?.length ?? 0, counts: pl.counts || null,
      // A band that was too wide to be a ring is REPORTED, never silently dropped: a dispersed field
      // is a real finding, and a panel that just showed fewer rings would hide it.
      fieldWide: (pl.fieldWide || []).map((f) => ({ coord: f.coord?.center || null, spanPct: f.spanPct, kind: f.kind })),
      // THE RINGS' OWN COORDINATES, NAMED. The payload has carried these as text since the beginning
      // and the receipt did not, so every other surface could show that five rings exist and not
      // WHERE — which is the only part a person can reason about. A ring count is a fact about the
      // picture; a coordinate is a fact about the work.
      rings_at: (pl.regions || []).slice(0, 12).map((rg) => ({
        coord: rg.coord?.center || null,
        band: rg.kind === 1 ? 'green' : rg.kind === 2 ? 'amber' : 'red',
        name: (rg.reef && typeof rg.reef === 'object' ? rg.reef.name : typeof rg.reef === 'string' ? rg.reef : null) || rg.coord?.label || null,
      })),
    })),
  }, null, 2));

  console.log(preview
    ? `VNA cockpit · PREVIEW · mutable tree · not a receipt · ${files.length} uncommitted file(s) · ${pipelineMs}ms`
    : `VNA cockpit · turn ${turn} · commit ${shaShort} · ${pipelineMs}ms`);
  for (const pl of panels) console.log(`  ${pl.id.padEnd(8)} ${pl.png ? `${pl.regions?.length ?? 0} rings` : 'NOT RENDERED — ' + (pl.note || '').slice(0, 70)}`);
  // PRINTED, not merely recorded: an ingest you must open a JSON file to inspect is an ingest nobody
  // inspects, and being able to CHECK what went in is the whole point of the flag.
  console.log(configText(config));
  console.log('  walk     ' + walkSource);
  console.log('  ingest   --intent ' + intentMode + (intentFallback ? ' (fallback: ' + intentFallback + ')' : ''));
  for (const d of ingest) console.log('    · ' + d.side.padEnd(7) + ' ' + d.via.padEnd(22) + String(d.rawBytes).padStart(7) + 'B  ' + d.path + (d.detail ? '  [' + d.detail + ']' : ''));
  console.log(`  aperture ${ap.engine} · ${ap.rawRatio}:1 raw → ${ap.usedRatio}:1 cut · ${ap.rows.length} documents · ${ap.matched ? 'matched' : 'NOT MATCHED'} · ${ap.admissible ? 'admissible' : 'BELOW THE FLOOR'}`);
  console.log(`  html    ${p}`);
  console.log(`  payload docs/specs/vna/${preview ? 'PREVIEW-PAYLOAD' : 'COCKPIT-PAYLOAD'}.txt (${Buffer.byteLength(fullPayload)}B)`);
  if (!noOpen) { try { execFileSync('open', [p]); } catch (e) { console.log('  (open failed: ' + e.message + ')'); } }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('cockpit failed:', e.message); process.exit(1); });
