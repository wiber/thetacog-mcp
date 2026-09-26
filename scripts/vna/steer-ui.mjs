#!/usr/bin/env node
// scripts/vna/steer-ui.mjs — THE MAP AND THE SPEC ON ONE PAGE.
//
// Everything built tonight is a separate CLI printing a separate wall of text. That is five things
// to remember and five outputs to hold in your head at once, which is the opposite of seeing the
// forest. This renders ALL of it as one bash-opened page: the three encircled panels the chip walk
// produced (read from cockpit.mjs's receipt — the one rust-backed sensor, and the half a reader
// could not otherwise tell had run), the 144-lattice as a real grid you can
// look at, the story in three acts, both arms of the envelope, the checkbox spec beside them, the
// nine rooms, and the trigger.
//
// IT COMPUTES NOTHING. Every number comes from a receipt another script wrote. A second computation
// here would let the picture and the CLI disagree, and then neither is trustworthy. Missing receipts
// render as "not run — <command>" rather than as zeros: absence and measured-nothing are opposite
// claims, and this page must never make the first look like the second.
//
// @guard tests/vna/steer-ui.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { ENGINE_KEYS_LABEL, ENGINE_KEYS_LABEL_HTML, ENGINE_KEYS_COMMAND } from './door-labels.mjs';   // C243: the ONE name of the keys door — the page (vna-engines.ts) reads the generated mirror of this constant
import { statusLine as engineStatusLine } from './runner-resolver.mjs';   // C166: the keys pill (ENGINE_KEYS_LABEL) reads the resolver's line
import { readTreeJson } from './tree-once.mjs';   // the 54 MB spec tree parsed once per render, shared by load(), the cog card, babysit and legend
import { readTree, borneOut, loadBorneRegistry, thresholds, BUNDLE_TOKEN_CAP, CHARS_PER_TOKEN, specRows, ungraded as ungradedCount, guardOf as rowGuardOf } from './spec-tree.mjs';   // C103f: the tree line's ungraded count, the tree's own reading   // C98d: the unit's guard path is read off its own row   // C53c: the borne-out state per row, read from receipts · C89b: the snowball cap, named by its constant   // C178: the one guard parser, never a second copy
import { card3PolicyLine } from './underwriter-policy.mjs';
import { licenceStampLine } from './auth-flow.mjs';   // C90: signed under licence <fp8> · N rows | unlicensed rows: N, a pure line   // C87a: witness root · k-of-n · the policy reading, a pure line
import { boundaryProbeLine } from './flight-tape.mjs';   // C86: the boundary probe's line for card 3, a pure line
import { queueHead } from './hook-doors.mjs';   // C56: the next unit of work, the same door the hook prints it from
import { goalStatus, goalLine, specTicks } from './goal.mjs';   // C146: the spec's ticks, the goal's own reader
import { budgetGate } from './steer-metrics.mjs';   // C93n: the card prints the gate's own line — the overrun, and that the runner halts on it   // the /goal on the record — the same line the hook prints
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tapeTail } from './tape-tail.mjs';
import { tailRows, tailRowsSince } from './walk-tape-read.mjs';   // C119g: bounded tail reads of the walk tape — never a whole-file read of a tape that only grows
import { lineCount as ledgerLineCount, lastRowWhere, lastRowIndexed } from './ndjson-tail.mjs';   // a line count with a cursor — never the whole ledger as one string
import { readWatermark, foldedThrough } from './fold-writer.mjs';   // the fold gate's own "behind" — max(watermark, scanned)
import { mesh, meshText, fullName } from './mesh.mjs';
import { splatter, splatterText } from './splatter.mjs';
import { clipState } from './clip-watch.mjs';
import { readClipIngest, INGEST_CMD as CLIP_INGEST_CMD } from './clip-ingest.mjs';   // C98e: the bridge card prints what the last one-shot ingest's fold did
import { controlsManifest } from './controls.mjs';   // C105: the page audits its own buttons off the manifest it derives, never a typed list
import { doorAudit, doorLine, DOOR_LABEL } from './door-audit.mjs';   // C105: the three door labels are the audit's constants, painted from one place
import { backupCardLine } from './backup.mjs';   // C102c: the 🔗 reading — the newest upload receipt's URL, read off .thetacog/backup   // C105: the door named is the door opened — every label's verb vs the command it runs, painted on the strip
import { stripLine as askedVsBuiltStripLine, RECEIPT as AVB_RECEIPT } from './asked-vs-built.mjs';
import { panelSignal, panelLine, readFloor as readPanelFloor, FLOOR_FILE as PANEL_FLOOR_FILE } from './panel-signal.mjs';   // C106: the panel's copy is maximal comms — the page is read once, whole, as a reader sees it, then the line is set into it   // C106: asked vs built is a door — the strip reads the door's receipt, never recomputes it
import { readGauge, fmtB as fmtBytes, tokenMeter } from './clear-gauge.mjs';
import { spendOf as cogSpendOf, baselines as cogBaselines, effectiveness as cogEffectiveness, total as cogTotal } from './spend.mjs';   // C93d: the card reads usage rows on every paint
import { pegWalk as cogPegWalk, emptyPeg as cogEmptyPeg } from './peg.mjs';
import { bandReach as cogBandReach, litFloor as cogLitFloor } from './cog.mjs';   // C93o: which bands a ticking commit can reach under the live weights
import { babysitReading, babysitLine, windowReadings, windowLine } from './babysit.mjs';   // C93q: the three window readings — interventions/commit, halts/dispatch, tape bytes/operator byte over closed goals   // C93p: the prediction scored against landing — returns before the tick, ρ UNDERPOWERED below the floor
import { readRate as labourRate, reclaimed as labourReclaimed, competenceSplit as labourSplit, readReef as labourReef, bandTable as labourTable } from './labour.mjs';   // C93j: hours on the card, the dollar only from a cited declaration   // C82e: the token meter rides beside the gauge
import { runRowLabel } from './auth-flow.mjs';   // C75: the RUN row's 🔑 line, one rule
import { notaryCard } from './tape-sync.mjs';    // C76: the 🟢 Notarized / ⚪ not synced card, one rule, read from the witness file only
import { verify as verifyFlight, lastRow as flightLast, FLIGHT, carFor, licenceOf, append as tapeAppend, CREDITS_LOCAL, creditsLocalRows } from './flight-tape.mjs';   // C139: the local credits ledger — the number that ticks down per stamped row
import { readClaimHistory, summarizeClaims } from './licence-history.mjs';   // C182: many licences lock to one machine — k · sum, read off the claim history, never a second store
import { backupsPosted, countersignedBackedUp } from './backup.mjs';   // C111: the 💳 metric counts the countersigned receipts that are backed up, read off the upload receipts
import { loadReceipt as loadApertureReceipt, apertureReceiptLine, apertureHovers, RECEIPT_CMD as APERTURE_CMD } from './aperture-receipt.mjs';   // C115/C116: the APERTURE strip, the tile hovers and the 🔍 door read the receipt aperture-receipt.mjs wrote — never composed here
import { deltaSlack, deltaSlackLine, loadReceipts as loadCockpitReceipts } from './delta-slack.mjs';   // C109j: the Δ slack, measured under RINGS +, never eyeballed   // C109o: the 💳 metric counts backups, read off the upload receipts   // C104c: the onboard rows ride the ONE append door; C90: licenceOf counts the countersigned rows for the 💳 metric
import { readCogPercentile, cogPercentileLine } from './cog-percentile.mjs';
import { loadOptTargets, renderOptTargets } from './opt-targets.mjs';   // C321b: 📈 the optimisation targets, a third-level pill under 📋 Copy Run Summary
import { readTurnComplexity, logDiscrepancies, logTurns, complexityFaceLine, tokensPerCogHead, pctClass, warningLine, pctLabel, tokPerCogLabel, massLabel, pegOf, pegRatio, STANCE as COMPLEXITY_STANCE, DISCREPANCY_NDJSON } from './cog-turns.mjs';   // C119: complexity per human % per turn — the optimisation target that must predict token cost; the graph, the warning, the discrepancy log   // C113d/C113e: the cog pinned to a percentile of human work, the first line under the 💳 +
import { LICENCE_TOOLTIP, NO_BADGE, WHAT_THIS_FUNDS, SPARK_LINES, FEELS_LIKE_FLYING, STORY_SNIFF, loopInFive, RATIO_UNMEASURED, WHY_YOU_PAY, countLine, COUNT_UNMEASURED, notaryPriceFromReceipt, NOTARY_PRICE_RECEIPT } from './public-surface-register.mjs';   // C103e the spark lines · C103 the one sentence · C102e the sniff · C104b the loop in five · C102f why you pay · C99c the count off the price   // C95b: the stamp sentence — the 💳 tooltip and the pay card's first line, one constant, never a second copy · C100a: the no-badge sentence, the first line behind ▸ more
import { STEER_IS_GOAL, STEER_IS_GOAL_SHORT, HOOK_PLUSES, COUNTERSIGNED_NOUN, COUNTERSIGNED_WHY, STEER_NAME, DOUBLE_ENTRY_TAGLINE, CHECKOUT_URL } from './public-surface-register.mjs';   // C138: the checkout page, one string   // C114: the tagline, one constant   // C113f: the header is the name, the /steer introduction, the stats   // C109a: the count carries its noun, and the why beside it   // C95a: §25's sentence + the three pluses — the README's bytes, from the one constant
import { legendLive, renderLegend } from './legend.mjs';
import { renderDignityRatchet, readCompetencePixel } from './cog-fold.mjs';   // C155: the ratchet to the dignity pixel + the envelope, under ⚙️ Tokens per cog's +
import { composeLine } from './run-summary.mjs';
import { readAll as readAudio } from './audio-basin.mjs';   // C233: the 🎙️ audio pill reads the basin's receipts — pure over them, computes nothing   // C145: the export pill's Time on Target term is the Verified line's own, from the one painter
import { readWorkList, renderWorkList, aggregateLine as workListAggregate } from './spec-worklist.mjs';   // C204: the open spec as a clickable work list with aggregate stats
import { refDoors } from './ref-doors.mjs';   // C109e: every reference and metric on the page opens its doc — one pass at the write boundary, beside awayCommands
import { awayCommands, targetRepo, DOCS, docTooltip } from './door-cmd.mjs';   // C103f: the card is a link — the document each card opens, one table mirrored in commands.ts   // C94b: away from home every `node scripts/vna/x.mjs` on the page becomes `npx thetacog-mcp <door>` — one rewrite at the write boundary   // C80a: what the rings mean, for this repo, this run — per axis, from four records   // C78e: the causal chain's height and its ed25519 verdict, the tape's own

// C94b: the repo this page is ABOUT — VNA_REPO when `npx thetacog-mcp steer-ui` runs in a stranger's repo (server.js sets it to
// the caller's cwd), else this tree. The page is written there, where the extension's watcher reads it.
const REPO = targetRepo();
const D = (f) => resolve(REPO, 'data/vna', f);
// C109l — THE PANEL UPDATES CONSISTENTLY OR SAYS IT DID NOT (operator 2026-09-20: "we do need the ... guarantee or refresh button that
// the side panel updates consistently"). RECEIPT_PATHS is the ONE list of what this render reads, repo-relative. The extension's receipt
// watcher is GENERATED from it (scripts/vna/receipt-globs.mjs → packages/thetacog-mcp-vscode/src/receipt-globs.ts), so a receipt added
// here is watched by construction; newestReceipt() reads the same list, so the heartbeat can say PAGE STALE when one moved after the
// render. The guard scans this file for every receipt path it names: each is here, in RECEIPT_UNWATCHED with its reason, or in
// RENDER_WRITES. A path the render WRITES never goes here — a watcher on it would re-render forever. Conditional, once-only writes
// (recordOnboard's step row on the flight tape, the credits snapshot per token, the panel floor when it falls) cost one repaint, then stop.
export const RECEIPT_PATHS = Object.freeze([
  'data/vna/cockpit.json', 'data/vna/cockpit-preview.json', 'data/vna/envelope.json', 'data/vna/alignment-map.json', 'data/vna/competence-pixel.json',
  'data/vna/parametric-trigger.json', 'data/vna/severity-status.json', 'data/vna/story.json', 'data/vna/underwriting.json', 'data/vna/spec-tree.json',
  'data/vna/spec-tree-roots.ndjson', 'data/vna/goal.json', 'data/vna/tesseract-state.json', 'data/vna/regime-floors.json', 'data/vna/suite-health.ndjson',
  'data/vna/loop-health.json', 'data/vna/loop-health.ndjson', 'data/vna/labour-rate.json', 'data/vna/cog.ndjson', 'data/vna/cog-weights.json',
  'data/vna/cog-peg.json', 'data/vna/flight-tape.ndjson', 'data/vna/notary-witness.ndjson', 'data/vna/notary-price.json', 'data/vna/panel-signal-floor.json',
  'data/vna/aperture-receipt.json', 'data/vna/aperture-receipt-preview.json',
  'data/pmu/kr37-covenant.json', 'data/pmu/kr39-aperture.json', 'data/pmu/kr40-cost-envelope.json', 'data/pmu/kr41-steering-work.json',
  'data/pmu/grip-meter-history.ndjson', 'data/pmu/grip-meter-steer-history.ndjson',
  '.thetacog/runner.ndjson', '.thetacog/vna-seed.ndjson', '.thetacog/vna-fold-dispatch.ndjson', '.thetacog/vna-clear-gauge.json', '.thetacog/vna-steer-surfaced.ndjson',
  '.thetacog/vna-steer-file.json', '.thetacog/vna-clip-outbound.ndjson', '.thetacog/entitlement-claims.json', '.thetacog/lens-encircled/latest.json',
  '.thetacog/credits-local.ndjson', '.thetacog/vna-asked-vs-built.json', '.thetacog/vna-clip-ingest.ndjson', '.thetacog/vna-clip.armed', '.thetacog/audio/armed', '.thetacog/audio/daemon.json', '.thetacog/audio/slots.ndjson', '.thetacog/audio/autobuild', '.thetacog/audio/builds.ndjson', '.thetacog/backup/*.upload.json',
  'docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/amendments.ndjson', 'docs/specs/vna/PAYLOAD.txt', 'docs/specs/vna/RESEARCH-BUNDLE.txt', 'docs/specs/vna/ONBOARDING-STEPS.md',
]);
// read by the page but deliberately NOT watched — each with the reason a watcher on it would be wrong
export const RECEIPT_UNWATCHED = Object.freeze({
  '.thetacog/walk-tape.ndjson': 'written on every prompt, lens walk and commit row; the ingest age on the page ticks from data-at, and the prompt turn already re-renders through lens-encircled/latest.json',
  '.thetacog/lens-receipts': 'a directory of ~10k per-prompt receipts; the newest one is indexed by lens-encircled/latest.json, which is watched',
});
// what the render itself writes, every run — never watched
export const RENDER_WRITES = Object.freeze(['docs/specs/vna/steer/latest.html', 'docs/specs/vna/steer', '.thetacog/steer-writers.json', 'data/vna/cog-discrepancy.ndjson', 'data/vna/cog-turns.ndjson']);
// the newest receipt on disk off RECEIPT_PATHS: { rel, at } or null when none exists. A glob entry (one `*` in its last segment) reads its directory.
export function newestReceipt({ repo = REPO, paths = RECEIPT_PATHS } = {}) {
  let best = null;
  const see = (rel) => { try { const t = statSync(resolve(repo, rel)).mtime.getTime(); if (!best || t > best.t) best = { rel, t }; } catch {} };
  for (const p of paths) {
    if (!p.includes('*')) { see(p); continue; }
    const dir = p.slice(0, p.lastIndexOf('/')); const re = new RegExp('^' + p.slice(dir.length + 1).replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    try { for (const f of readdirSync(resolve(repo, dir))) if (re.test(f)) see(`${dir}/${f}`); } catch {}
  }
  return best ? { rel: best.rel, at: new Date(best.t).toISOString() } : null;
}
const RENDER_STARTED_AT = new Date().toISOString();   // C109l: the render's own clock — a receipt newer than this was not read by this page
const JWT_SHAPE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_ENV = /^(.*_BEARER|.*_SEED|.*_PRIVATE_KEY|.*_SECRET|.*_TOKEN|.*_API_KEY)$/;   // by shape — this file never names the bearer variable (C82b)
const envSecrets = (env = process.env) => Object.entries(env).filter(([k, v]) => SECRET_ENV.test(k) && typeof v === 'string' && v.length >= 12).map(([, v]) => v);
export function redactSecrets(s, { secrets = envSecrets() } = {}) {
  let out = String(s ?? '').replace(JWT_SHAPE, '[redacted: bearer]');
  for (const v of secrets) if (v) out = out.split(v).join('[redacted: secret]');
  return out;
}
const esc = (s) => redactSecrets(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const AXL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const LANE = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };

// A receipt is either read or reported absent. There is no third branch and no default value.
function load(file, cmd) {
  const p = D(file);
  if (!existsSync(p)) return { missing: true, cmd, file };
  try { return { ...(file === 'spec-tree.json' ? readTreeJson(p) : JSON.parse(readFileSync(p, 'utf8'))), missing: false, cmd, file }; }   // the 54 MB tree: parsed once per render (tree-once.mjs)
  catch (e) { return { missing: true, cmd, file, broken: String(e.message).slice(0, 80) }; }
}
// THE FORMAL METHODS' RECEIPTS live under data/pmu/ and are written by their own KR scripts; the same
// read-or-absent contract applies. 'Cognitive commit credits' is the operator's name for the commit unit
// KR40 defines — calls, tokens, minutes summed over the window since the previous same-room commit — and
// this page paints that unit in the RECORD'S OWN UNITS; the dollar line stays UNPINNED until the dated
// price table is filled, exactly as the receipt says.
function loadPmu(file, cmd) {
  const p = resolve(REPO, 'data/pmu', file);
  if (!existsSync(p)) return { missing: true, cmd, file };
  try { return { ...JSON.parse(readFileSync(p, 'utf8')), missing: false, cmd, file }; }
  catch (e) { return { missing: true, cmd, file, broken: String(e.message).slice(0, 80) }; }
}
const lastLine = (p) => { try { return lastRowWhere(p, () => true); } catch { return null; } };   // tail read — the ledger it is pointed at is ~400 MB
const blockOf = (c) => { const m = /^([A-C])([1-3])?,([A-C])([1-3])?$/.exec(String(c || '').trim());
  return m ? ['ABC'.indexOf(m[1]) * 3 + (m[2] ? +m[2] - 1 : 1), 'ABC'.indexOf(m[3]) * 3 + (m[4] ? +m[4] - 1 : 1)] : null; };

// A receipt that has not been run renders as the command that would produce it. Module-level so the
// panels renderer and the page use ONE not-run form and a guard can call it.
const miss = (r) => `<div class="miss">not run — <code>${esc(r.cmd)}</code>${r.broken ? ` <span class="dim">(${esc(r.broken)})</span>` : ''}</div>`;

// ── THE PANELS: the chip walk's own output, read back ───────────────────────
// The three encircled PNGs are the only rust-backed artifact in the loop. They are READ from
// cockpit.mjs's receipt and re-emitted byte-for-byte; nothing here decodes, thresholds or draws.
// An absent receipt says so with its command — a page that quietly showed no panels would read as
// "the walk found nothing" when the truth is "the walk never ran".
function renderPanels(cock) {
  if (cock.missing) return miss(cock);
  const panels = cock.panels || [];
  const cards = panels.map((p) => `
 <div class="panel"><h3>${esc(p.title)}</h3>
  ${p.png ? `<img src="${esc(p.png)}" alt="${esc(p.title)}">` : `<div class="norender">${esc(p.note || 'not rendered')}</div>`}
  <div class="means">${esc(p.meaning)}</div>
  ${p.counts ? `<div class="counts"><span class="g">${p.counts.green}</span> · <span class="a">${p.counts.amber}</span> · <span class="r">${p.counts.red}</span>${p.counts.offPct != null ? ` · off-lane <b>${p.counts.offPct}%</b>` : ''}${p.counts.dispersionPct != null ? ` · dispersion <b>${p.counts.dispersionPct}%</b>` : ''} · ${p.rings} rings</div>` : ''}
 </div>`).join('');
  return `<div class="panels">${cards || '<div class="norender">no heat matrices that run — panels not rendered (never substituted)</div>'}</div>
<div class="k" style="margin-top:9px">How to read the rings: <b>▸ WHAT THE RINGS MEAN</b> under THE WALK, above — said once on the page (C89). Rendered ${esc(String(cock.generatedAt || '').slice(0, 19))} from <code>${esc(cock.html || '')}</code>.</div>`;
}

// ── C78d THE ENCIRCLED TRIPTYCH AT THE TOP — with its sufficiency contracts (operator 2026-09-18: "I need to see the 3
// encircled panels update on each run at the top of the page - with what they mean"). The three PNGs are the one Rust
// walk's, read from cockpit.mjs's receipt and re-emitted byte-for-byte (never decoded, never a 12×12). Under each, the
// CANONICAL meaning — PANEL_MEANING, not the receipt's gloss: the receipt's intent/reality lines say "NOT drift", which
// puts the word under a panel whose rings are self-dispersion (C78 invariant 1b). The commit and a ticking age stamp
// every panel, so a panel that did not repaint after a run reads as stale rather than as current. An absent or unrun
// receipt paints three bordered placeholders — never a blank, never a substitute image.
// C89b — the tier-1 tooltips, the paste's copy corrected by the record: red on INTENT/REALITY is dispersion (scope-breadth),
// never error; red on Δ is off-lane, which is scope-breadth too, never a defect (off-lane is not a defect predictor, 2026-08).
// C149 THE CANONICALS VERBATIM (operator 2026-09-21: "lets consistently do that right so you can read the full explanation to what the circles
// mean, because we see that the canonicals have been interpreted in this"): what the circles mean is spec §17.1–17.3's own SUFFICIENT FOR /
// NOT SUFFICIENT FOR lines, read off docs/specs/vna/SPEC-VNA-COCKPIT.md at render and painted verbatim under ▸ WHAT THE RINGS MEAN — §17 says
// it itself: "the webview prints both lines under the panel, verbatim". PANEL_MEANING below stays the tooltip's short form; the printed
// explanation is the spec's words. An absent spec reads not run — the file, never a paraphrase standing in.
export function sufficiencyLines(specText) {
  const out = {}; const md = String(specText || '');
  for (const [k, head] of [['INTENT', /^### 17\.1 /m], ['REALITY', /^### 17\.2 /m], ['DELTA', /^### 17\.3 /m]]) {
    const m = head.exec(md); if (!m) { out[k] = null; continue; }
    const sec = md.slice(m.index, (() => { const n = /^### |^## /m.exec(md.slice(m.index + 4)); return n ? m.index + 4 + n.index : md.length; })());
    const suff = /^- \*\*SUFFICIENT FOR:\*\* (.*)$/m.exec(sec), not = /^- \*\*NOT SUFFICIENT FOR:\*\* (.*)$/m.exec(sec);
    out[k] = suff && not ? { sufficient: suff[1].trim(), notSufficient: not[1].trim() } : null;
  }
  return out;
}
export const SUFFICIENCY_CMD = 'docs/specs/vna/SPEC-VNA-COCKPIT.md §17';
export function readSufficiency(path = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md')) { try { return sufficiencyLines(readFileSync(path, 'utf8')); } catch { return { INTENT: null, REALITY: null, DELTA: null }; } }
/** the skill's hard rule, VERBATIM from .claude/skills/steer/SKILL.md (C149) — one constant, painted on the RINGS line */
export const RINGS_RULE = "Only the Δ panel's rings mean drift. Intent and reality rings mean self-dispersion — how tightly that corpus clusters about its own centre.";
export const PANEL_MEANING = Object.freeze({
  INTENT: 'declared mass — where the active spec rows planned to touch code; ring size is dispersion over the 144-basin lattice (green: one core · red: a dispersed scope); next: compare with REALITY',
  REALITY: 'performed mass — the files this commit touched; red rings are broad dispersion across subsystems, not error; next: read Δ',
  DELTA: 'performed minus declared; green in-lane · amber adjacent · red off-lane — scope-breadth, not a defect; next: open ▸ WHAT THE RINGS MEAN for the files under each ring',
});
export const PANEL_SEMANTICS = Object.freeze({ INTENT: 'dispersion', REALITY: 'dispersion', DELTA: 'drift' });
const PANEL_ORDER = ['INTENT', 'REALITY', 'DELTA'];
const panelKey = (title) => (/^\s*Δ/.test(String(title)) ? 'DELTA' : /^\s*REALITY/i.test(String(title)) ? 'REALITY' : /^\s*INTENT/i.test(String(title)) ? 'INTENT' : null);
const PANEL_LABEL = { INTENT: 'INTENT', REALITY: 'REALITY', DELTA: 'Δ' };
// C79d — the N on the PREVIEW badge: turn rows on the flight tape since its last commit row (no tape → null, never 0)
// ── C103d / C103b THE DAY-ONE FACE — the shared shape of every card (operator 2026-09-20: "button · metric · plus sign is high s/n
// per card, then show all we need after the plus"). One primary button per card, `<emoji> <Verb> <object> · <metric>`; the metric
// span is the card's one .measure (C80b) and is READ off the card's receipt — `not run — <command>` when the receipt is absent,
// never a zero, never a typed constant; the `+` (a <details class="plus"> C79a remembers) is the card's one fold and opens the
// tiers in place: the spark line (C103e) · the face block · the mid tier (⋮ secondaries + facts) · ▸ more. One rule, one place.
export const notRun = (cmd) => `not run — <code>${esc(cmd)}</code>`;
// C131 (operator 2026-09-21, verbatim: "Weaponize the Empty State … Add a secondary metric line to the empty state: ⚠️ Time on Target
// clock stopped. Unsigned work is not retained."): the second line under the 💳 face while the ledger is UNFUNDED — no key with
// credits held (the entitlement) and the notary not 🟢. A state read off the entitlement, never a number; gone the moment the clock runs.
export const LEDGER_EMPTY_LINE = '⚠️ Time on Target clock stopped. Unsigned work is not retained.';
// C134 (operator 2026-09-21, verbatim: "Keep the Credits remaining metric permanently visible next to the [💳 Fund Autonomy Ledger]
// action. As it ticks down, it visually reinforces the accumulation of the user's verified history."): the one term, read off the
// entitlement (the receipt in SecretStorage, C75) — N held · 0 none held · UNMEASURED when no entitlement is held (an absence is never a zero)
// C135b (operator 2026-09-21: "flash the exact timestamp of the cryptographic lock on the UI"): the card's backup line leads with the
// instant of the lock read off the newest upload receipt (.thetacog/backup/<sha>.upload.json) — countersigned_at (C135), else the local
// `at` (a pre-C135 receipt), else UNMEASURED; the sha is the receipt's, shortened to 12. Field-tolerant, never typed; no receipt → null.
export const countersignLineOf = (r) => {
  if (!r || typeof r !== 'object') return null;
  const iso = typeof r.countersigned_at === 'string' && r.countersigned_at ? r.countersigned_at : typeof r.at === 'string' && r.at ? r.at : null;
  return `🔗 countersigned ${iso ? esc(iso) : 'UNMEASURED — no timestamp on the receipt'} · ${esc(String(r.sha || '').slice(0, 12))}`;
};
export function countersignLine({ repo = REPO } = {}) {
  const dir = resolve(repo, '.thetacog/backup'); if (!existsSync(dir)) return null;
  let newest = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.upload.json'))) { let u = null; try { u = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; } if (!u || !u.url) continue; if (!newest || String(u.at || '').localeCompare(String(newest.at || '')) > 0) newest = u; }
  return countersignLineOf(newest);
}
// C139 (operator 2026-09-21, verbatim: "licences left … the count TICKS DOWN on the next repaint after each stamped row — read off the receipt,
// never a typed number, UNMEASURED when no entitlement is in the environment"): THE NUMBER. flight-tape.mjs spends one −1 row per stamped
// row on the LOCAL ledger (.thetacog/credits-local.ndjson — spendCredit, keyed by the row's sha) after reconcileCredits lands a snapshot
// row for the token (ref token:<jti>, else token:<iat>:<exp> — flight-tape's tokenRef); the balance is the SUM. Once that ledger holds
// THIS token's snapshot, the balance is the count and it moves locally, no reconnect. Before that the claim's `credits` is the site's
// snapshot at mint and moves only on reconnect — so it is said to be the last connect's, with the LICENSED rows under this key after
// the claim's iat counted beside it (stampedSince, off the tape rows handed in). No entitlement → null (UNMEASURED), never a zero.
export function licencesLeft({ entitlement = null, ledger = CREDITS_LOCAL, tapeRows = null } = {}) {
  const c = entitlement && typeof entitlement === 'object' ? entitlement : null;
  if (!c) return { n: null, source: null, stampedSince: null };
  const ref = `token:${c.jti != null ? c.jti : `${c.iat ?? ''}:${c.exp ?? ''}`}`;
  let rows = []; try { rows = creditsLocalRows(ledger); } catch { rows = []; }
  if (rows.some((r) => r && r.kind === 'snapshot' && r.ref === ref)) return { n: rows.reduce((a, r) => a + (Number(r && r.delta) || 0), 0), source: 'ledger', stampedSince: null };
  const n = Number.isFinite(Number(c.credits)) && c.credits !== null && c.credits !== '' && typeof c.credits !== 'boolean' ? Number(c.credits) : null;
  if (n == null) return { n: null, source: null, stampedSince: null };
  const fp = c.pubkey_fingerprint ? String(c.pubkey_fingerprint) : null; const since = Number.isFinite(Number(c.iat)) ? Number(c.iat) * 1000 : null;
  const stampedSince = Array.isArray(tapeRows) && fp ? tapeRows.filter((r) => { try { return licenceOf(r).status === 'LICENSED' && r.proofs.licence.pubkey_fingerprint === fp && (since == null || Date.parse(r.ts) > since); } catch { return false; } }).length : 0;
  return { n, source: 'claim', stampedSince };
}
export const creditsTerm = (entitlement, { ledger = CREDITS_LOCAL, tapeRows = null } = {}) => {
  const { n } = licencesLeft({ entitlement, ledger, tapeRows });   // C139: the same number the account line paints
  return n == null ? 'credits UNMEASURED — connect' : n > 0 ? `credits ${n}` : 'credits 0 · none held';
};
// C139: the account state beside every checkout door — signed in · <account_id, 8> off the claims, or not signed in; then the count
export function accountLine(entitlement, { ledger = CREDITS_LOCAL, tapeRows = null } = {}) {
  const c = entitlement && typeof entitlement === 'object' ? entitlement : null;
  const who = !c ? 'not signed in' : c.account_id ? `signed in · ${esc(String(c.account_id).slice(0, 8))}` : 'signed in · account UNMEASURED';
  const { n, source, stampedSince } = licencesLeft({ entitlement: c, ledger, tapeRows });
  const count = n == null ? 'licences left UNMEASURED — connect' : source === 'ledger' ? `${n} licences left` : `${n} left at last connect${stampedSince ? ` · ${stampedSince} stamped since` : ''}`;
  return `${who} · ${count}`;
}
export const accountSpan = (entitlement, opts) => `<span class="acct" title="C139 — signed-in-or-not is the account_id on the entitlement claims (SecretStorage, C75); the count is the local credits ledger's balance once it holds this token's snapshot (one −1 row per stamped row, .thetacog/credits-local.ndjson), else the claim's snapshot from the last connect; UNMEASURED with no entitlement">${accountLine(entitlement, opts)}</span>`;
// primaryAlt: the SAME painter for a card's alternate-state label (the 💳 once a key is held); the listing register reads the
// fresh-install labels off `primary(` calls (C94a sidebarPrimaryLabels) and must not count an alternate state as a seventh button
export const primaryAlt = (...a) => primary(...a);
// C109m.5: a ▶ beside the + was tried (operator: "if we can put an active button next to the + on the left") and REFUSED — five rows pin one
// control per face (C80b · C102d · C103b · C103d · C113b) and the face button already runs the row's command; the + box is "+" (− open),
// the face is the one pointer
// C150d (operator 2026-09-21, screenshot of 💳 with its count inside the green box: "the countersigned is the right text but it cannot be on the action button" · "you have to be able to scroll to read the counts"): the button IS the lead and carries the label only; the metric is the button's next sibling, so the sticky lead floats and the counts scroll under it. One painter; proofDoor is the same shape.
export const primary = (cmd, head, metric, title, cls = 'action') => `<button class="${cls}" onclick="go('${cmd}')" title="${esc(title)}"><span class="lbl">${head}</span></button> · <span class="measure">${metric}</span>`;
// operator 2026-09-20 (maximal comms): the ↗ door carries the age of the document it opens (its first path's mtime), or `not run` — a
// <span class="measure"> so the manifest keeps the label as the DOCS table names it (C103f) and reads the age as the metric
const docAge = (kind) => { const d = DOCS[kind]; if (!d || !d.paths || !d.paths.length) return 'not run'; try { const at = statSync(resolve(REPO, d.paths[0])).mtime.getTime(); return `<span class="age" data-at="${new Date(at).toISOString()}">${fmtAge(Date.now() - at)}</span> ago`; } catch { return 'not run'; } };
/** C122c — the same document door for a FACE: the DOCS label and tooltip (C103f.1: the title IS docTooltip), no .measure (the face's one measure is the primary's) */
export const faceDocDoor = (kind) => { const d = DOCS[kind]; return d ? `<button class="sb doc" onclick="go('${d.cmd}')" title="${esc(docTooltip(kind))}">${d.label}</button>` : ''; };
export const docDoor = (kind) => { const d = DOCS[kind]; return d ? `<button class="sb doc" onclick="go('${d.cmd}')" title="${esc(docTooltip(kind))}">${d.label} · <span class="measure">${docAge(kind)}</span></button>` : ''; };
/** C119e — a face button whose click opens the card's own + (the proof) and scrolls its graph into view; no command spawned, works in the browser copy too */
export const proofDoor = (id, head, metric, title, cls = 'action') => `<button class="${cls}" onclick="go('vna.${id}Proof')" title="${esc(title)}"><span class="lbl">${head}</span></button> · <span class="measure">${metric}</span>`;   // C150d: the metric beside the button, never on it
export const plusFold = (id, title, inner) => `<details class="plus" id="plus-${id}"><summary title="${esc(title)}">+</summary><div class="mrb">${inner}</div></details>`;
// C103f — THE TOP LINE STAYS ON THE CARD: a row's headline is its label and first clause, read off specRows (never typed), ≤ 120
// chars; the row's full text lives in the document the click opens. The leading (guard: …) (declared …) (built …) groups are
// skipped by paren depth; the clause ends at the first colon, dash, sentence end or parenthesis.
export function rowHeadline(label, { md = null, max = 120 } = {}) {
  if (!label) return null;
  if (md == null) { try { md = readFileSync(SPEC_MD, 'utf8'); } catch { md = ''; } }
  const row = specRows(md).find((x) => x.label === label); if (!row) return null;
  let s = String(row.text).trim().replace(/^C\d+[a-z]?\s*/, '');
  for (;;) { if (!s.startsWith('(')) break; let d = 0, i = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') { d--; if (d === 0) break; } } s = s.slice(i + 1).trim(); }
  s = s.replace(/^\*\*/, '');
  const m = /^(.*?)(?::|\.\s|\(| \*\*)/.exec(s); let clause = (m ? m[1] : s).trim();
  if (`${label} — ${clause}`.length > max && clause.includes(' — ')) clause = clause.split(' — ')[0];   // a long clause is cut at its own dash before the cap
  return `${label} — ${clause}`.slice(0, max);
}
// C98c — the ratio the meter read, as the line beside FEELS_LIKE_FLYING (C103): never a typed number
export const readRatioLine = (meter) => (meter && Number.isFinite(meter.not_re_sent_pct) ? `${meter.not_re_sent_pct} % of the window not re-sent — read off this session` : RATIO_UNMEASURED);

// ── C104a / C104c THE NEXT STEP IS ALREADY OPEN — a pure function over the record's state. The sequence is C101b's walkthrough
// in order; a step is taken when the record moved past it OR an `onboard` row on the tape says so (a taken step never re-opens
// after a reload, C104c). The two branches (halt · buy) open only while the record holds them. Every `why` cites the row that
// owns the step by its label and headline (rowHeadline — read off specRows, never typed).
// C108c — the steps are ROWS THE OPERATOR TUNES: the sequence and every word on the card are read from docs/specs/vna/ONBOARDING-STEPS.md
// (hand-edited, never generated) through the one parser in onboarding-steps.mjs — nothing typed at this site. The precedence
// nextStep walks over the record is unchanged; the operator edits a step's line, button, owning row or prediction in the file.
import { onboardSteps, onboardSequence, STEPS_FILE } from './onboarding-steps.mjs';
export const ONBOARD_SEQUENCE = onboardSequence();   // the file's non-branch order: walk · 💳 notarise · goal · run · backup · keep (operator 2026-09-20)
export const ONBOARD_STEPS = onboardSteps();   // key → { emoji, line, button, beside?, card, row } — halt and buy are the branches the record holds
export const NOTHING_NEXT = 'Nothing next — the loop is yours';
/** the states the record itself has passed — read, never guessed */
export function recordTaken({ walk = null, goal = null, runner = null, chain = null, entitlement = null } = {}) {
  const taken = new Set();
  if (walk && !walk.missing && Array.isArray(walk.panels) && walk.panels.length) taken.add('walk');
  if (goal && Array.isArray(goal.units) && goal.units.length) taken.add('goal');
  if (runner && /^(DONE|RUNNING|HALTED|PAUSED|ABORTED|DISPATCH)/.test(String(runner.state || '')) && runner.state !== 'not run') taken.add('run');
  if (entitlement && entitlement.pubkey_fingerprint) taken.add('notarise');
  return taken;
}
export function onboardTaken(rows = []) { return new Set((rows || []).filter((r) => r && r.kind === 'onboard' && r.seed && r.seed.step).map((r) => String(r.seed.step))); }
export function nextStep({ walk = null, goal = null, runner = null, chain = null, entitlement = null, onboard = [], licensed = 0, waiting = 0, backups = 0, md = undefined } = {}) {
  const fromRecord = recordTaken({ walk, goal, runner, chain, entitlement });
  const fromTape = onboardTaken(onboard);
  const taken = new Set([...fromRecord, ...fromTape]);
  const halted = runner && runner.state === 'HALTED';
  const hasTape = !!(chain && chain.state === 'MEASURED');
  const credits = entitlement && Number.isFinite(entitlement.credits) ? entitlement.credits : null;
  let state = null;
  const noKey = !taken.has('notarise') && !fromTape.has('notarise');
  if (!taken.has('walk')) state = 'walk';
  else if (hasTape && noKey) state = 'notarise';   // the first ACTION: a tape exists and no key is held → the checkout, before the loop is pitched (C102a, operator 2026-09-20)
  else if (!taken.has('goal')) state = 'goal';
  else if (!taken.has('run') && !halted) state = 'run';
  else if (halted) state = 'halt';
  else if (noKey) state = 'notarise';
  else if (credits != null && credits <= 0) state = 'buy';
  else if (licensed > 0 && !(backups > 0) && !fromTape.has('backup')) state = 'backup';   // the key stamped rows and nothing has left the machine yet → the countersign is next (C102c)
  else state = 'keep';
  const step = ONBOARD_STEPS[state];
  // C125 — the steps file absent (a bundle that dropped docs/specs/vna/ONBOARDING-STEPS.md, seen red in a stranger's repo)
  // is a READING on the card, never a throw that takes the whole page with it: C94b.5's contract, honoured here too.
  if (!step) return { state, line: `not run — ${STEPS_FILE} absent (${state} is the next step)`, emoji: '·', button: null, beside: null, card: null, row: null, why: state, last: false, hasTape, taken: [...taken], checklist: [], index: -1, missing: STEPS_FILE };
  const n = state === 'keep' || state === 'backup' ? licensed : waiting;
  const line = step.line.replace('<n>', String(n));
  const headline = rowHeadline(step.row, { md });
  const backupDone = backups > 0 || fromTape.has('backup'); if (backupDone) taken.add('backup');   // C102c: a posted backup is the step taken
  const checklist = ONBOARD_SEQUENCE.map((s) => ({ step: s, done: taken.has(s) || (s === 'keep' && state === 'keep'), open: s === state })).concat([...fromTape].filter((s) => !ONBOARD_SEQUENCE.includes(s)).map((s) => ({ step: s, done: true, open: false })));
  return { state, line, emoji: step.emoji, button: step.button, beside: step.beside || null, card: step.card, row: step.row, why: headline || step.row, last: state === 'keep', hasTape, taken: [...taken], checklist, index: ONBOARD_SEQUENCE.indexOf(state) };
}
/** C104c — the steps the record has passed that the tape has not recorded yet: appended as `onboard` rows through the ONE append door */
export function onboardMissing(step, onboard = []) { const seen = onboardTaken(onboard); return step.taken.filter((s) => !seen.has(s)); }
export function recordOnboard(step, { tape = FLIGHT, onboard = null, appendRow = tapeAppend } = {}) {
  const rows = onboard || (() => { try { return readFileSync(tape, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } })();
  const out = [];
  for (const s of onboardMissing(step, rows)) { try { out.push(appendRow({ kind: 'onboard', session: 'steer-ui', seed: { step: s, line: ONBOARD_STEPS[s] ? ONBOARD_STEPS[s].line : s } }, tape)); } catch (e) { out.push({ step: s, error: String(e.message || e).slice(0, 80) }); } }
  return out;
}
// the NEXT → card: one line, already open; behind its + the loop in five (C104b), the one sentence beneath it with the read
// ratio, and the checklist ✓/○ (C104c). The recommended button is named by its painted label — the click is the card's own
// button beneath, never a second copy of the command (C104a).
// C109c — NOTARISE THE TAPE AND BUY KEYS ARE ONE ACTION: when NEXT → is the 💳 step (notarise · buy) it paints no card of its own —
// its line and drawer fold under THE SECOND READER's + (the card whose face IS that door), and the page carries one 💳; the
// countersigned-receipts count on that face is the tell. Every other step keeps NEXT → as its own card (C104a).
// C141 (operator 2026-09-21: "the 9 pills … everything else folded into the list under + or ⋮"): NEXT → is never a tenth line — every
// step folds under the pill whose button IS that step (walk → 🚶 · goal → 📄 · run → ⚡ · halt → 🔍 · notarise/buy/backup/keep → 💳)
export const NEXT_FOLDS = Object.freeze({ walk: 'walk', goal: 'contract', run: 'runner', halt: 'halt', notarise: 'attest', buy: 'attest', backup: 'attest', keep: 'attest' });
export function nextFoldsInto(step) { return (step && NEXT_FOLDS[step.state]) || null; }
/** the drawer's inner HTML — NEXT → with its line, the loop in five, the sentence and the checklist — for the card it folds into */
export function renderNextInner(step, { meter = null, cap = BUNDLE_TOKEN_CAP } = {}) {
  const rec = step.button ? `Recommended: <span class="lb">${esc(step.button)}</span>${step.beside ? ` · <span class="lb">${esc(step.beside)}</span> beside it` : ''}` : 'the six buttons beneath';
  const line = step.last ? `${esc(NOTHING_NEXT)} · ${esc(step.line)}` : `${step.emoji} ${esc(step.line)}`;
  const loop = loopInFive(cap).map((l) => `<span class="c3l loop">${esc(l)}</span>`).join('');
  const check = step.checklist.map((c) => `<span class="c3l check">${c.done ? '✓' : '○'} ${esc(ONBOARD_STEPS[c.step] ? ONBOARD_STEPS[c.step].line.replace(' <n>', '') : c.step)}${c.open ? ' <span class="dim">← open</span>' : ''}</span>`).join('');
  return `<div class="c3h c3t"><b>NEXT →</b> <span class="why" title="the row that owns this step — its label and first clause, read off the spec">${esc(step.why)}</span></div><span class="c3l"><span class="measure">${line} · ${rec}</span></span>${loop}<span class="c3l dim flying" title="C103 — the one sentence, beside the ratio the meter read (C98c)">${esc(FEELS_LIKE_FLYING)} ${esc(readRatioLine(meter))}</span>${check}`;
}
export function renderNext(step, { meter = null, cap = BUNDLE_TOKEN_CAP, open = undefined } = {}) {
  // C141: the page never paints this card — every step folds under its pill (renderNextInner under the +); this stays the standalone painter
  // of the NEXT → card for the guards that read its drawer (C104b · C104c). C109c's `'' when it folds` is retired with the face it protected.
  const rec = step.button ? `Recommended: <span class="lb">${esc(step.button)}</span>${step.beside ? ` · <span class="lb">${esc(step.beside)}</span> beside it` : ''}` : 'the six buttons beneath';
  const line = step.last ? `${esc(NOTHING_NEXT)} · ${esc(step.line)}` : `${step.emoji} ${esc(step.line)}`;
  const loop = loopInFive(cap).map((l) => `<span class="c3l loop">${esc(l)}</span>`).join('');
  const check = step.checklist.map((c) => `<span class="c3l check">${c.done ? '✓' : '○'} ${esc(ONBOARD_STEPS[c.step] ? ONBOARD_STEPS[c.step].line.replace(' <n>', '') : c.step)}${c.open ? ' <span class="dim">← open</span>' : ''}</span>`).join('');
  const isOpen = open === undefined ? step.index <= 1 : open;
  return `<div class="card3 c-next"><div class="c3l face next"><span class="measure">${line} · ${rec}</span>${plusFold('next', 'what happens next and why — the loop in five lines, the sentence beneath it, and the checklist of the steps taken; next: the recommended button beneath', `<div class="c3h c3t"><b>NEXT →</b> <span class="why" title="the row that owns this step — its label and first clause, read off the spec">${esc(step.why)}</span></div>${loop}<span class="c3l dim flying" title="C103 — the one sentence, beside the ratio the meter read (C98c)">${esc(FEELS_LIKE_FLYING)} ${esc(readRatioLine(meter))}</span>${check}`).replace('<details class="plus" id="plus-next">', `<details class="plus" id="plus-next"${isOpen ? ' open' : ''}>`)}</div></div>`;
}

export function turnsSinceCommit(path = FLIGHT) {
  let rows; try { rows = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; }
  if (!rows.length) return null;
  let n = 0; for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].kind === 'commit') break; if (rows[i].kind === 'turn') n++; }
  return n;
}
// C79d — PREVIEW: between commits the panels show the working tree. The preview receipt (cockpit.mjs --reality tree → its
// own file, C25) is taken when it is NEWER than the commit receipt, badged PREVIEW · working tree · turn N and named against
// the commit it previews; an older preview is ignored. The commit receipt is never overwritten by a preview (C25).
// C222 — ONE SCREEN, ONE READING: the panels show the working-tree preview whenever it is newer than the HEAD walk, and the header's
// "Δ … off-lane · … red" read the HEAD walk — so the page painted "Δ 10% · 0 red" above panels and a Walk HEAD pill reading
// "Δ 31% · 478 red" (operator 2026-09-23, on that screen: "is this right?"). shownCock is the one rule for which receipt is on
// screen; the triptych and the header both call it.
export function shownCock(cockIn, preview) {
  const pvRan = (p) => p && !p.missing && Array.isArray(p.panels) && p.generatedAt && PANEL_ORDER.every((k) => p.panels.some((x) => panelKey(x.title) === k && x.png));
  const pv = pvRan(preview) ? preview : null;
  const commitAt = cockIn && !cockIn.missing && cockIn.generatedAt ? Date.parse(cockIn.generatedAt) : -Infinity;
  return pv && Date.parse(pv.generatedAt) > commitAt ? pv : cockIn;
}
export function renderTriptych(cockIn, { now = Date.now(), preview = null, turn = null, legendHtml = null, between = '', behind = null, aperture = null, under = '', fork = '', forkForce = false, sufficiency = undefined } = {}) {
  const suff = sufficiency === undefined ? readSufficiency() : sufficiency;   // C149: §17's lines, read at render (a test hands them in)
  const hover = apertureHovers(aperture);   // C116: the per-panel readings, off the aperture receipt (not run — <command> when absent)
  // a preview that did not render (a panel with png null — an empty tree diff) never blanks the commit's panels
  const pvRan = (p) => p && !p.missing && Array.isArray(p.panels) && p.generatedAt && PANEL_ORDER.every((k) => p.panels.some((x) => panelKey(x.title) === k && x.png));
  const pv = pvRan(preview) ? preview : null;
  const commitAt = cockIn && !cockIn.missing && cockIn.generatedAt ? Date.parse(cockIn.generatedAt) : -Infinity;
  const cock = shownCock(cockIn, preview); const usePreview = !!pv && cock === pv;   // C222: the one rule, shared with the header
  const byKey = {}; for (const p of (cock && !cock.missing && Array.isArray(cock.panels)) ? cock.panels : []) { const k = panelKey(p.title); if (k && !byKey[k]) byKey[k] = p; }
  // C174 (operator 2026-09-22, "reload killed this"): a receipt that carries the three panels IS a walk — a panel cockpit.mjs refused (png
  // null/'' + its note: a thin commit below the lit-mass floor, a flat decode) paints its refusal as UNMEASURED, and never blanks the panels
  // that rendered nor erases the walk's stamp. `ran` used to demand a PNG on all three, so one honest refusal read as "no walk yet".
  const ran = !!(cock && !cock.missing && cock.generatedAt && PANEL_ORDER.every((k) => byKey[k]));
  const refusedNote = (k) => String((byKey[k] && byKey[k].note) || 'not rendered').split(/ — |\. /)[0];
  const at = cock && cock.generatedAt ? String(cock.generatedAt) : null;
  const badge = usePreview ? `<b class="badge amber">PREVIEW · working tree · turn ${turn != null ? turn : '—'}</b> ` : '';
  const against = usePreview ? (cockIn && !cockIn.missing && cockIn.commit ? `against <code>${esc(cockIn.commit)}</code>` : 'against no commit receipt') : `commit <code>${esc(cock.commit || '?')}</code>`;
  const stamp = ran
    ? `${badge}${against} · walked <b class="age" data-at="${esc(at || '')}">${at ? fmtAge(now - Date.parse(at)) : '—'}</b> ago · ${esc(cock.engine || 'engine unreported')}`
    : `${badge}<span class="dim">no walk yet · ${cock && cock.missing ? `not run — <code>${esc(cock.cmd || 'node scripts/vna/cockpit.mjs')}</code>` : 'no walk in the receipt yet'}</span>`;
  // C103d (refined 2026-09-20): the three panels sit on the FACE labelled with the three words only — the counts, the stamp and
  // the legend are words, and every word goes behind the +. The tile's title attribute keeps the meaning for a hover.
  const tiles = PANEL_ORDER.map((k) => {
    if (!ran) return `<div class="tp ph" data-semantics="${PANEL_SEMANTICS[k]}" title="${esc(PANEL_MEANING[k] + ' — ' + hover[k])}"><h3>${PANEL_LABEL[k]}</h3><span class="ph-box" title="Awaiting commit or preview walk — 🚶 Walk HEAD renders the three panels from the receipt"></span></div>`;
    const p = byKey[k];
    if (!p.png) return `<div class="tp ph" data-semantics="${PANEL_SEMANTICS[k]}" title="${esc(PANEL_MEANING[k] + ' — ' + hover[k])}"><h3>${PANEL_LABEL[k]}</h3><span class="ph-box refused" title="${esc('UNMEASURED — ' + (p.note || 'the walk rendered no panel here') + ' — never a pass, never a blank')}">UNMEASURED · ${esc(refusedNote(k))}</span></div>`;
    return `<div class="tp" data-semantics="${PANEL_SEMANTICS[k]}" title="${esc(PANEL_MEANING[k] + ' — ' + hover[k])}"><h3>${PANEL_LABEL[k]}</h3><img src="${esc(p.png)}" alt="${PANEL_LABEL[k]} panel"></div>`;
  }).join('');
  const countsLines = ran ? PANEL_ORDER.map((k) => { const p = byKey[k]; const c = p.counts || null; if (!c) return ''; return `<span class="c3l dim counts"><b class="ib">${PANEL_LABEL[k]}</b> <span class="g">${c.green ?? '—'}</span> · <span class="a">${c.amber ?? '—'}</span> · <span class="r">${c.red ?? '—'}</span>${k === 'DELTA' && c.offPct != null ? ` · off-lane <b>${c.offPct}%</b>` : ''}${k !== 'DELTA' && c.dispersionPct != null ? ` · dispersion <b>${c.dispersionPct}%</b>` : ''}${p.rings != null ? ` · ${p.rings} rings` : ''}</span>`; }).join('') : '';
  // operator 2026-09-18: 'the dispersion and declared mass etc is wasted, that should be expandable prose' — the contracts live
  // once, behind ▸ what the rings mean (C79a remembers whether it is open); the tiles keep the counts, and each tile's title
  // attribute carries its own line for a hover.
  const meaning = `<details class="more meaning" id="details-meaning"><summary title="what a ring means on each panel and where each active ring sits in THIS repo — the coordinate, the two subsystems, the files git placed there; the sufficiency contract, never a verdict; next: find your last commit's files under their ring">▸ WHAT THE RINGS MEAN</summary><div class="mrb">${PANEL_ORDER.map((k) => `<div class="ml" data-semantics="${PANEL_SEMANTICS[k]}"><b>${PANEL_LABEL[k]}</b> · ${byKey[k] && Number.isFinite(Number(byKey[k].rings)) ? `${byKey[k].rings} ring${Number(byKey[k].rings) === 1 ? '' : 's'} on this render` : 'rings UNMEASURED'}</div>${suff && suff[k] ? `<div class="ml suff" data-panel="${k}"><b>SUFFICIENT FOR:</b> ${esc(suff[k].sufficient)}</div><div class="ml suff not" data-panel="${k}"><b>NOT SUFFICIENT FOR:</b> ${esc(suff[k].notSufficient)}</div>` : `<div class="ml suff miss" data-panel="${k}">${notRun(SUFFICIENCY_CMD)}</div>`}`).join('')}<div class="ml dim rule">Δ rings on this render: ${byKey.DELTA && Number.isFinite(Number(byKey.DELTA.rings)) ? byKey.DELTA.rings : 'UNMEASURED'} — the rule is the RINGS line above (once, C98f).</div>${legendHtml != null ? legendHtml : (() => { try { return renderLegend(legendLive()); } catch (e) { return `<div class="ml rr">legend not computed — ${esc(String(e.message || e).slice(0, 80))}</div>`; } })()}</div></details>`;
  // C80b — the header is a measure and an action: Δ off-lane % · red rings, and the walk button; the stamp rides behind the +
  const dc = byKey.DELTA && byKey.DELTA.counts; const refusedK = PANEL_ORDER.find((k) => byKey[k] && !byKey[k].png);
  const measure = ran && dc && dc.offPct != null ? `Δ ${dc.offPct}% off-lane · ${dc.red ?? '—'} red` : ran ? `Δ UNMEASURED${refusedK ? ` · ${PANEL_LABEL[refusedK]} ${esc(refusedNote(refusedK))}` : ' · no off-lane reading in the receipt'}` : cock && cock.missing ? notRun(cock.cmd || 'node scripts/vna/cockpit.mjs') : 'no walk yet';
  const walkMs = cock && cock.delta && Number.isFinite(cock.delta.ms) ? `the last walk took ${cock.delta.ms} ms (${(cock.delta.ms / 1000).toFixed(1)} s)` : 'walk time UNMEASURED until a receipt lands';
  const ap = cock && !cock.missing && cock.aperture ? `the aperture — ${esc(cock.aperture.engine || 'engine unreported')} · ${esc(String(cock.aperture.rawRatio))}:1 raw → ${esc(String(cock.aperture.usedRatio))}:1 cut · ${cock.aperture.matched ? 'matched' : '<b class="rr">NOT MATCHED</b>'} · ${cock.aperture.admissible ? 'above the floor' : `<b class="rr">below the ${esc(String(cock.aperture.floor))}-byte floor</b>`}` : 'the aperture — not in the receipt yet';
  const stale = behind != null && behind > 0 ? `<span class="c3l rr">⚠️ ${behind} commit${behind === 1 ? '' : 's'} behind HEAD · walk</span>` : '';
  const behindTerm = behind != null && behind > 0 ? ` · <b class="rr">${behind} behind HEAD</b>` : '';   // C144: the heartbeat's HEAD/behind verdict rides the walk's own metric
  const button = primary('vna.steer', '🚶 Walk HEAD', `${measure}${behindTerm}`, `walk the last authored commit on the 144×144 lattice and repaint every panel from the new receipt — ${walkMs}; the working tree only under 👁 preview, which is not a receipt; next: read Δ`);
  const walkReading = ran ? `· HEAD ${esc(String(cock.commit || '?').slice(0, 7))} · ${measure} · walked ${cock.generatedAt ? `<span class="age" data-at="${esc(cock.generatedAt)}">${fmtAge(now - Date.parse(cock.generatedAt))}</span> ago` : 'UNMEASURED'}` : `· ${measure}`;
  const nameLine = `<div class="tph c3t"><b>THE WALK</b> <span class="spark" title="${esc(SPARK_LINES.walk)} — C103e, the tagline; the line is the card's reading">${walkReading}</span></div>`;
  const tiers = `${nameLine}${between}<span class="c3l">${docDoor('walk')}</span><span class="c3l dim">· ${stamp}</span>${stale}`;   // C141: NEXT → (between) is the first line after the name, when the walk is the step   // the counts, the aperture and ▸ WHAT THE RINGS MEAN moved to the RINGS card (2026-09-20)
  // operator 2026-09-20: "the what does the rings mean was removed, we need the same format there, button metrics + ...(to see the shortlex
  // redefined) but draw the eye to the parts that matter, what you need to know" — RINGS is a card like the six: the header carries the
  // ring counts read at render (I and R muted, Δ in the accent — the only ring that means drift), one visible line of what you need to
  // know, the 🔍 button with the walk receipt's age, and ▸ more holding the ShortLex redefinition (details-meaning MOVED here, never
  // rewritten) and the aperture. The counts are the receipts' (panel.counts), never typed; absent → UNMEASURED.
  const ringCount = (k) => { const p = byKey[k]; return p && Number.isFinite(Number(p.rings)) ? Number(p.rings) : null; };   // panel.rings — the receipt's ring count (the counts field is lit CELLS by colour, a different number)
  const rI = ringCount('INTENT'), rR = ringCount('REALITY'), rD = ringCount('DELTA');
  const nR = (n) => (n == null ? 'UNMEASURED' : String(n));
  const ringsHead = `<span class="rings-head" title="${esc(`the rings on each panel, read off the walk receipt (panel.rings) — I ${nR(rI)} · R ${nR(rR)} · Δ ${nR(rD)}; only Δ's rings mean drift (green in-lane · amber adjacent · red off-lane); an I or R ring is self-dispersion, how tightly that corpus clusters about its own centre`)}"><b>RINGS</b> · <span class="dim">I ${nR(rI)}</span> · <span class="dim">R ${nR(rR)}</span> · <b class="acc rings-delta">Δ ${nR(rD)}</b> · ${dc && dc.offPct != null ? `<b class="acc">${dc.offPct}% off-lane</b>` : '<span class="dim">off-lane UNMEASURED</span>'}</span>`;
  // C149: the skill's sentence VERBATIM (RINGS_RULE), the three colours beside it as the legend they are
  const ringsKnow = `<span class="c3l rings-know" title="the skill's hard rule, verbatim — the three panels look alike, so narrating an intent ring as drift is the easiest possible lie"><b>${esc(RINGS_RULE)}</b> <span class="g">green in-lane</span> · <span class="a">amber adjacent</span> · <span class="r">red off-lane</span></span>`;
  const ringsMetric = `<span class="dim">I ${nR(rI)}</span> · <span class="dim">R ${nR(rR)}</span> · <b class="acc rings-delta">Δ ${nR(rD)}</b> · ${dc && dc.offPct != null ? `<b class="acc">${dc.offPct}% off-lane</b>` : '<span class="dim">off-lane UNMEASURED</span>'} · ${ran && cock.generatedAt ? `<span class="age" data-at="${esc(cock.generatedAt)}">${fmtAge(now - Date.parse(cock.generatedAt))}</span> ago` : 'not run'}`;
  // C109m (operator 2026-09-20: "expand, button, metrics (no wrap) for all of them"): RINGS is the same shape as every other line — the + first, one button, the counts as its metric; the what-you-need-to-know sentence lives under the +
  const ringsBtn = `<button class="sb rings" onclick="go('vna.openWalk')" title="${esc(`the rings on each panel, read off the walk receipt (panel.rings) — I ${nR(rI)} · R ${nR(rR)} · Δ ${nR(rD)}; only Δ's rings mean drift (green in-lane · amber adjacent · red off-lane); an I or R ring is self-dispersion, how tightly that corpus clusters about its own centre · ${docTooltip('walk')}`)}"><span class="lbl">🔍 Rings</span></button> · <span class="measure">${ringsMetric}</span>`;   // C150d: the reading beside the button, never on it — the button is the sticky lead
  const ringsCard = `<div class="card3 c-rings"><div class="c3l face">${ringsBtn}${plusFold('rings', 'what the rings mean — the ShortLex redefinition in full: the three panels, the A/B/C horizons, the 144-basin lattice, the full ShortLex name of every active ring on THIS render, the aperture; next: hover a ring on Δ', `<div class="c3h c3t">${ringsHead}</div>${ringsKnow}<span class="c3l dim slack" title="C109j — the Δ slack is measured, not eyeballed: over the last cockpit receipts, how often a REALITY-red cell read Δ green · amber · red, with the shuffled null beside it; UNMEASURED under 20 receipts — this repo keeps one live receipt at a time, so the series starts when receipts are archived; node scripts/vna/delta-slack.mjs">${esc((() => { try { return deltaSlackLine(deltaSlack(loadCockpitReceipts({ repo: REPO }))); } catch (e) { return `delta-slack: UNMEASURED — ${String(e.message || e).slice(0, 60)}`; } })())}</span>${countsLines}<span class="c3l dim horizons" title="the ShortLex redefinition: three horizons, A long-term (Strategy) · C medium-term (Operations) · B short-term (Tactics); a basin is the intersection of two, 12 × 12 = 144; every ring is named by its ShortLex pair — hover a cell on the map for the full name">horizons: A long · C medium · B short — 12 × 12 = 144 basins, each ring named by its ShortLex pair</span>${meaning}<span class="c3l dim" title="what the chip looked at — the engine, the raw→cut ratio and whether the aperture matched the ratchet's floor">${ap}</span>`)}</div></div>`;
  // C141 THE NINE PILLS: the tiles, then the 🚶 Walk HEAD pill (one of the nine) — RINGS, NEXT → (when the walk is the step) and whatever
  // the caller folds here (`under`: the arms, the panels drawer, the net, the fork) ride BEHIND the walk's +, in that order; nothing removed
  // C142 THE ACTIONABLE FORK (operator's fold 8, steer.txt 2026-09-21: "these pills physically do not exist on the UI until Walk HEAD measures a
  // Δ > 0 — when drift is detected, they drop down"): the two lane doors (📝 Auto-Amend Spec Basin · ↩️ Revert Drift Changes — the runner's own,
  // C-lane, handed in as `fork`) paint under the walk's + ONLY while the Δ receipt carries red or off-lane above zero, or the runner is PAUSED on
  // drift (forkForce); otherwise nothing — never a disabled placeholder
  const driftNow = !!(ran && dc && ((Number(dc.red) || 0) > 0 || (Number(dc.offPct) || 0) > 0));
  const forkLine = fork && (driftNow || forkForce) ? `<span class="c3l fork" title="C142 — the actionable fork, painted only while the walk's Δ shows drift (red ${dc ? dc.red : '—'} · off-lane ${dc ? dc.offPct : '—'} %) or the runner is paused on it: amend the basin to where the work went, or revert the drifted paths">${fork}</span>` : '';
  return `<div class="triptych"><div class="tps">${tiles}</div></div><div class="triptych card3 c-walk pill"><div class="c3l face">${button}${plusFold('walk', 'the walk — the commit and engine it read, the counts under each panel, the rings, the aperture, ▸ what the rings mean, and while Δ shows drift the fork (amend the basin · revert the drift); next: 🚶 Walk HEAD after your next commit', `${tiers}${forkLine}${ringsCard}${under}`)}</div></div>`;
}

// ── C78e THE LOOP HEALTH RIBBON — Merkle + L1, four metrics, UNMEASURED before a fabricated zero ───────────
// Every number is a receipt's: the tree root and basin counts (tesseract-state.json, tesseract-state.mjs writes it), the last
// fold (vna-fold-dispatch.ndjson, the hook's), the last prompt's seed (vna-seed.ndjson — the walk's gain and z against the
// z the null demanded, and the stage the door recorded: landed / released / abstained), the flight tape's height and its
// chain + signature verdict (flight-tape.mjs verify — recomputed here, never trusted from a summary), the notary height
// (C76 notaryCard, the witness file only). A metric whose receipt is missing, or whose field is not a finite number, is
// UNMEASURED — a 0 here would read as "no basins" or "height 0" when the truth is "no receipt".
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
export function loopHealth({ tesseract = D('tesseract-state.json'), fold = resolve(REPO, '.thetacog/vna-fold-dispatch.ndjson'), seed = resolve(REPO, '.thetacog/vna-seed.ndjson'), flight = FLIGHT, witness = undefined, now = Date.now() } = {}) {
  const UN = (why) => ({ state: 'UNMEASURED', why });
  let ts = null; try { ts = JSON.parse(readFileSync(tesseract, 'utf8')); } catch {}
  const f = lastLine(fold);
  const merkle = ts && typeof ts.root === 'string' && ts.root.length >= 8
    ? { state: 'MEASURED', root: ts.root, at: ts.at || null, rows: f ? num(f.rows) : null, watermark: f ? num(f.watermark) : null, behind: f ? num(f.behind) : null, foldAt: f && f.at ? String(f.at) : null, foldMs: f ? num(f.ms) : null }
    : UN(ts ? 'tesseract-state.json carries no root' : 'no tesseract-state.json — node scripts/vna/tesseract-state.mjs');
  const sd = lastLine(seed);
  const walk = sd
    ? { state: 'MEASURED', pixel: sd.pixel || null, leaf: sd.leaf || null, gain: sd.walk ? num(sd.walk.gain) : null, z: sd.walk ? num(sd.walk.z) : null, zRequired: sd.walk ? num(sd.walk.z_required) : null, stage: sd.stage || (sd.abstained ? 'abstained' : null), abstained: !!(sd.abstained || sd.promptAbstained), admitted: !!(sd.stage && sd.stage !== 'released' && sd.stage !== 'short' && !sd.abstained && !sd.promptAbstained), why: sd.why || null, at: sd.at || null }
    : UN('no vna-seed.ndjson — the hook writes one row per prompt');
  const c = ts && ts.counts;
  const basins = c && num(c.basins) != null && num(c.withLit) != null
    ? { state: 'MEASURED', total: c.basins, lit: c.withLit, dead: c.basins - c.withLit, ties: num(c.sharedCells) }
    : UN('no basin counts in tesseract-state.json');
  const last = flightLast(flight);
  let chain;
  if (!last) chain = UN('no flight tape — node scripts/vna/flight-tape.mjs');
  else { const v = verifyFlight(flight); const nc = notaryCard(witness ? { witnessFile: witness } : {}); chain = { state: 'MEASURED', height: num(last.seq), rows: v.rows, signed: v.signed, unsigned: v.unsigned, ok: v.ok, firstBreak: v.firstBreak, notaryHeight: nc.rows ? nc.height : null, notaryLabel: nc.label }; }
  return { merkle, walk, basins, chain, at: new Date(now).toISOString() };
}
export function renderLoopHealth(h, { now = Date.now(), extra = '' } = {}) {
  const age = (iso) => (iso ? `<b class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</b> ago` : '—');
  const un = (m) => `<b class="rr">UNMEASURED</b> <span class="dim">— ${esc(m.why || '')}</span>`;
  const cell = (k, body, title) => `<div class="rm" title="${esc(title)}"><span class="rk">${k}</span> ${body}</div>`;
  const m = h.merkle, w = h.walk, b = h.basins, c = h.chain;
  const merkle = m.state !== 'MEASURED' ? un(m) : `<code>0x${esc(m.root.slice(0, 8))}</code>${m.rows != null ? ` · ${m.rows} rows` : ''}${m.behind != null ? (m.behind === 0 ? ' · at the tape' : ` · <b class="rr">${m.behind} behind</b>`) : ''} · fold ${age(m.foldAt)}${Number.isFinite(m.foldMs) ? ` · fold ${m.foldMs} ms` : ''}`;
  const walk = w.state !== 'MEASURED' ? un(w) : w.abstained || !w.pixel ? `<b class="bo bo-UNMEASURED">abstained</b> <span class="dim">${esc(String(w.why || w.stage || '').slice(0, 60))}</span>` : `<span class="ib">${esc(w.pixel)}</span> · gain ${w.gain ?? '—'} · z ${w.z ?? '—'} / ${w.zRequired ?? '—'} · <b class="bo ${w.admitted ? 'bo-GUARDED' : 'bo-UNMEASURED'}">${esc(w.stage || '—')}</b>`;
  const basins = b.state !== 'MEASURED' ? un(b) : `${b.lit} lit · ${b.dead} dead · ${b.ties ?? '—'} ties <span class="dim">of ${b.total}</span>`;
  const chain = c.state !== 'MEASURED' ? un(c) : `height ${c.height ?? '—'} · ${c.ok ? '<b class="ok">✅ ed25519</b>' : `<b class="rr">❌ ed25519 · seq ${c.firstBreak ? c.firstBreak.seq : '?'}</b>`} · ${c.signed} signed · notary ${c.notaryHeight != null ? c.notaryHeight : '<span class="dim">not synced</span>'}`;
  return `<div class="ribbon"><div class="rh"><b>Engine Telemetry</b> <span class="dim">· the tree + the walk, from receipts${h.at ? ` · read ${age(h.at)}` : ''}</span></div><div class="rms">
${cell('MERKLE', merkle, 'data/vna/tesseract-state.json root · the last fold row of .thetacog/vna-fold-dispatch.ndjson')}
${cell('THE WALK', walk, 'the last row of .thetacog/vna-seed.ndjson — the Rust ballistic walk on the 144×144 for the last prompt; the stage is the door\'s, never a threshold of this page')}
${cell('BASINS', basins, 'tesseract-state.json counts: basins · withLit · sharedCells (active ties)')}
${cell('CHAIN', chain, 'data/vna/flight-tape.ndjson — seq of the last row, chain + ed25519 recomputed by flight-tape.mjs verify(); notary height from the witness file (C76)')}
${extra}</div></div>`;
}

// C113c — ENGINE TELEMETRY IS ONE LINE IN THE SAME FORMAT (operator 2026-09-20: "engine telemetry needs the same format, add the
// spec and build wording 3rd party backups etc"; supersedes C89b's ▸ ENGINE TELEMETRY drawer). Face: [+] [🌳 Open Tree · 0x<root8> ·
// <rows> rows · <behind>]; under the +: MERKLE · THE WALK · BASINS · CHAIN as before (renderLoopHealth), then BUILD (ext · doors) and
// BACKUPS (rows in the local diary · 3rd-party backups · countersigned receipts — two numbers, never one: the local backup is the
// diary, the 3rd-party one is what is backed up). An absent receipt reads not run — <command> or "not reported", never a zero.
// C141: the 🌳 Open Tree pill is one of the nine (indented under auto-paste — the tree is what the paste folds into); the telemetry
// (MERKLE · THE WALK · BASINS · CHAIN · BUILD · BACKUPS) rides behind its +, after the tree's own facts. `h` may be null (a fixture
// without a loop-health receipt): the ribbon then reads UNMEASURED on every cell, never a throw.
export function renderTelemetry(h, { now = Date.now(), build = null, doors = null, backups = null, indent = true, more = '', acct = '', metric = null, treeFacts = '' } = {}) {
  const m = h && h.merkle;
  const measure = metric != null ? metric : !m || m.state !== 'MEASURED' ? notRun('node scripts/vna/spec-tree.mjs')
    : `0x${esc(String(m.root).slice(0, 8))}${m.rows != null ? ` · ${fmt(m.rows)} rows` : ''}${m.behind != null ? (m.behind === 0 ? ' · at the tape' : ` · <b class="rr">${fmt(m.behind)} behind</b>`) : ''}`;
  const button = primary('vna.openTree', '🌳 Open Tree', measure, `open the spec tree in the editor — ${docTooltip('tree')}; the metric is the tree's nodes, its Merkle root, its revisions and how far it is behind the tape; next: 📋→🌳 Paste → Tree when it is behind`);
  const buildTxt = build && build.ext ? `ext ${esc(String(build.ext))}${build.state === 'LAG' ? ` · source ${esc(String(build.source || '?'))} · <b class="rr">LAG</b>` : ''}` : 'ext build not reported';
  const cell = (k, body, title) => `<div class="rm" title="${esc(title)}"><span class="rk">${k}</span> ${body}</div>`;
  const extra = cell('BUILD', `${buildTxt}${doors ? ` · ${esc(String(doors))}` : ''}`, 'VNA_EXT_VERSION stamped by the extension on its own repaints (buildLag) · the doors audit off the controls manifest this page derives from itself (C105)')
    + cell('BACKUPS', backups ? `${fmt(backups.local)} rows in the local diary · ${fmt(backups.third)} 3rd-party backups · ${fmt(backups.countersigned)} countersigned receipts` : 'not run — node scripts/vna/backup.mjs', 'two numbers, never one: the local diary is data/vna/flight-tape.ndjson (every row, signed at append); a 3rd-party backup is a posted upload receipt under .thetacog/backup (what is backed up); the countersigned receipts are the LICENSED rows on the tape (licenceOf, C90)');
  const un = (k) => ({ state: 'UNMEASURED', why: `no ${k} receipt handed to the page` });
  const hh = h && h.merkle && h.walk && h.basins && h.chain ? h : { merkle: un('tree'), walk: un('seed'), basins: un('tesseract-state'), chain: un('flight-tape'), at: null };
  // C103e/C106b: the reading is a value, never the spark repeated — basins lit is a different fact from the button's own root/rows/behind
  const treeReading = hh.basins.state === 'MEASURED' ? `${fmt(hh.basins.lit)} of ${fmt(hh.basins.total)} basins lit` : 'basins not counted yet';
  const treeFace = treeFacts || `<div class="c3l dim">${buildTxt} · ${backups ? `${fmt(backups.local)} local rows backed up` : 'backups not run'}</div>`;
  const inner = pillInner('THE TREE', { spark: 'the Merkle tree the spec and every paste fold into — the nodes are in the document the button opens', reading: treeReading, face: treeFace, doc: 'tree', acct, more: `${renderLoopHealth(hh, { now, extra })}${more}` });
  // never `c-tree` on this pill: the manifest's DATA rule (\btree\b) would read its + as a data row
  return pillBox('c-telemetry', 'telemetry', button, { indent, plusTitle: 'the tree — its facts, then the raw telemetry for the Merkle tree and the ballistic walk (the root, the fold, the last prompt\'s pixel with its gain and z, the basins lit, the chain\'s height and signature, the build, the backups); read-only, from receipts, no model; next: 📋→🌳 Paste → Tree when the tree is behind', inner });
}

// ── C183b THE LEFT RAIL SHOWS THE OPTIMISERS (operator 2026-09-23: "measure and output stats left
// side - we need a full set of optimisers there") — one compact column, every line a RESULT with its
// source, value, null and knob, read from data/vna/loop-health.json (C183a's composer) and painted
// here — this function COMPUTES NOTHING, it only formats what that receipt already carries. A result
// under its sample floor reads UNMEASURED (n shown when the reader carries one), never a zero; a trend
// arrow only when a previous run is handed in; the H1 hurdle is grey and carries no number — a hurdle
// is never climbed as an effect (the-ratchet-invariants.md rule 6, the night's central error). Rows
// the C183a receipt does not yet wire (order · coverage · spend vs ceiling) read not run — <command>,
// the same honest absence as any other unmeasured reading, never invented.
export const trendArrow = (cur, prevV) => (cur == null || prevV == null || !Number.isFinite(cur) || !Number.isFinite(prevV) ? '' : cur > prevV ? ' ▲' : cur < prevV ? ' ▼' : ' –');
export function optimiserRow(label, r, { value = null, unit = '', nullText = null, knob = null, prevValue = null } = {}) {
  if (!r || r.state !== 'MEASURED') {
    const n = r && Number.isFinite(r.n) ? ` (n=${r.n}${r.min_pairs != null ? ` of ${r.min_pairs} needed` : ''})` : '';
    const detail = [r && r.why, r && r.cmd ? `run ${r.cmd}` : null].filter(Boolean).join(' · ') || 'not run';
    return `<div class="rm" title="${esc(knob || '')}"><span class="rk">${esc(label)}</span> <b class="bo bo-UNMEASURED">UNMEASURED</b>${n} <span class="dim">— ${esc(detail)}</span></div>`;
  }
  const arrow = trendArrow(value, prevValue);
  return `<div class="rm" title="${esc(`${knob || ''}${nullText ? ` · null ${nullText}` : ''} · source ${r.source || ''}`)}"><span class="rk">${esc(label)}</span> ${esc(String(value))}${esc(unit)}${arrow ? `<span class="up">${esc(arrow)}</span>` : ''}</div>`;
}
// C183c (operator 2026-09-23, screenshot: ten label-only rows, one value spilling past the box, the panels shoved
// below the fold): the rail is a closed + drawer — the same details.g idiom as the six glances — its face one line,
// the count of results MEASURED; every row lives behind the +, and the open state survives repaints by its id.
// C183d (operator: "then rethink where it goes"): the drawer lives under the 🚶 Walk HEAD pill's +, right after the Health glance —
// the optimisers are the loop's results, Health is the walk's; between the header and the three panels it pushed the product below the fold.
export const optimiserFold = (reading, rail) => `<details class="g" id="g-optimisers"><summary title="the optimisers — every loop result (read=write, steering, yield, retrieval, harness, suite) with its source, value and null, painted from the C183a receipt data/vna/loop-health.json; read-only, computes nothing; next: node scripts/vna/loop-health-set.mjs when a row is UNMEASURED"><span class="gface">Optimisers <span class="gs">· ${esc(reading)}</span></span></summary>${rail}</details>`;
export function renderOptimiserRail(h, { prev = null } = {}) {
  if (!h) return optimiserFold('UNMEASURED', `<div class="ribbon" id="optimiser-rail"><div class="rh"><b>Optimisers</b> <span class="dim">— UNMEASURED, not run — node scripts/vna/loop-health-set.mjs</span></div></div>`);
  const E1 = h.E1_read_write, E2 = h.E2_steering, E3 = h.E3_yield, RET = h.retrieval_C187a, S1 = h.S1_harness, SU = h.S_suite, H1 = h.H1_grip_hurdle;
  const rows = [
    E1 && E1.state === 'MEASURED'
      ? optimiserRow('READ=WRITE (E1)', E1, { value: `${E1.pure_holds_in.length}/${E1.strata_n}`, unit: ' strata hold', knob: 'C176e isomorphism distance — kept arm vs the best pure-shape arm' })
      : optimiserRow('READ=WRITE (E1)', E1, { knob: 'C176e — node scripts/vna/read-write-relation.mjs --distance' }),
    E2 && E2.state === 'MEASURED'
      ? optimiserRow('STEERING (E2)', E2, { value: E2.value, nullText: `${E2.null_mean}±${E2.null_sd} (z ${E2.z})`, knob: 'admissible turn → next commit ≤2 blocks vs a shuffled-pairing null', prevValue: prev && prev.E2_steering && prev.E2_steering.value })
      : optimiserRow('STEERING (E2)', E2, { knob: 'THE METER — node scripts/pmu/grip-meter.mjs' }),
    E3 && E3.state === 'MEASURED'
      ? optimiserRow('YIELD (E3)', E3, { value: `$${E3.usd_per_ok}`, unit: '/ok', nullText: `${E3.ok}/${E3.verdicts} ok · $${E3.spend_usd} total`, knob: 'gates passed per $ — .thetacog/runner.ndjson cost_usd facts', prevValue: prev && prev.E3_yield && prev.E3_yield.usd_per_ok })
      : optimiserRow('YIELD (E3)', E3, { knob: 'node scripts/vna/runner-reading.mjs' }),
    RET && RET.state === 'MEASURED'
      ? optimiserRow('RETRIEVAL (C187a)', RET, { value: Object.entries(RET.sensors).map(([k, s]) => `${k} rank ${s.median_rank} hit10 ${s.hit10} z ${s.z}`).join(' · '), knob: `median rank · hit@10 per sensor, n=${RET.n_asks} chance=${RET.chance}` })
      : optimiserRow('RETRIEVAL (C187a)', RET, { knob: 'node scripts/vna/retrieval-bench.mjs' }),
    S1 && S1.state === 'MEASURED'
      ? optimiserRow('HARNESS (S1, C183)', S1, { value: Object.entries(S1.labels).map(([k, s]) => `${k} p50 ${s.p50}ms p95 ${s.p95}ms (n=${s.n})`).join(' · '), knob: `${S1.targets}` })
      : optimiserRow('HARNESS (S1, C183)', S1, { knob: 'node scripts/ops/harness-health.mjs' }),
    SU && SU.state === 'MEASURED'
      ? optimiserRow('SUITE', SU, { value: `${SU.pass}/${SU.tests}`, unit: ` pass (${SU.pct}%)`, knob: `sha ${SU.sha}` })
      : optimiserRow('SUITE', SU, { knob: 'data/vna/suite-health.ndjson' }),
    // H1 — the hurdle, grey, never a score (rule 6: strata add, hurdles multiply, one effect climbs)
    `<div class="rm dim" title="${esc(`${(H1 && H1.why) || ''} (the-ratchet-invariants.md rule 6)`)}"><span class="rk">GRIP HURDLE (H1)</span> <b class="bo bo-UNMEASURED">hurdle</b> <span class="dim">admits/refuses — not scored</span></div>`,
    // named in the C183a row but not yet wired into its receipt — surfaced honestly as not run, never invented
    `<div class="rm"><span class="rk">ORDER (fold lag)</span> <span class="dim">not run — node scripts/vna/spec-tree.mjs --fold</span></div>`,
    `<div class="rm"><span class="rk">COVERAGE</span> <span class="dim">not run — node scripts/vna/asked-vs-built.mjs · node scripts/vna/spec-clarity.mjs</span></div>`,
    `<div class="rm"><span class="rk">SPEND vs CEILING</span> <span class="dim">not run — node scripts/vna/steer-runner.mjs (budgetGate)</span></div>`,
  ];
  const measured = [E1, E2, E3, RET, S1, SU].filter((r) => r && r.state === 'MEASURED').length;
  return optimiserFold(`${measured} of 6 measured`, `<div class="ribbon" id="optimiser-rail"><div class="rh"><b>Optimisers</b> <span class="dim">· C183a receipt ${h.at ? esc(String(h.at).slice(0, 16)) : 'UNMEASURED'} · read-only, from receipts, computes nothing</span></div><div class="rms" style="grid-template-columns:1fr">${rows.join('')}</div></div>`);
}
export function loadLoopHealth({ repo = REPO } = {}) {
  const path = resolve(repo, 'data/vna/loop-health.json');
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
export function loadPrevLoopHealth({ repo = REPO } = {}) {
  const path = resolve(repo, 'data/vna/loop-health.ndjson');
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length < 2) return null;
    return JSON.parse(lines[lines.length - 2]);
  } catch { return null; }
}

// ── THE LIVE INGEST CARD (C78b): the Rust walk's receipt for the last paste ────────────────────
// Three receipts, last row of each, and nothing else: the ledger (bytes · source · status · sha), the fold
// (rows · watermark · behind) and the seed the hook wrote for the prompt (pixel · leaf · d · margin · walk
// gain · z · z_required · stage · released · why). Every number below is the hook's; this card recomputes
// none of them and owns no threshold — τ_attach and m_attach are READ from the floors file the tree itself
// calibrates against. A released / unplaced seed wears the amber ⚠️ UNPLACED DRAWER badge with the
// receipt's own why; a short prompt says "not walked" from its receipt; an absent receipt says "not run —
// <command>". Never a blank, never a fabricated zero.
export const INGEST_PATHS = Object.freeze({ ledger: resolve(REPO, 'docs/specs/vna/amendments.ndjson'), fold: resolve(REPO, '.thetacog/vna-fold-dispatch.ndjson'), seed: resolve(REPO, '.thetacog/vna-seed.ndjson') });
const INGEST_CMD = { ledger: 'node scripts/vna/steer-hook.mjs', fold: 'node scripts/vna/spec-tree.mjs --fold', seed: 'node scripts/vna/steer-hook.mjs' };
export function readIngest({ ledger = INGEST_PATHS.ledger, fold = INGEST_PATHS.fold, seed = INGEST_PATHS.seed } = {}) {
  const L = lastLine(ledger), F = lastLine(fold), S = lastLine(seed);
  const short = (s) => { const t = String(s || ''); return t.includes(':') ? t : t.split('/').pop(); };   // steer.txt · transcript:<session>
  const g = { state: L || F || S ? 'MEASURED' : 'UNMEASURED', cmd: INGEST_CMD, bytes: null, source: null, sha: null, status: null, at: null, fold: null, walk: null, slot: null };
  if (L) Object.assign(g, { bytes: num(L.bytes), source: short(L.source), sha: L.sha256 ? String(L.sha256).slice(0, 12) : null, status: L.status || null, at: L.at || L.ts || null });
  if (F) g.fold = { rows: num(F.rows), watermark: num(F.watermark), behind: num(F.behind), pid: num(F.pid), at: F.at || null };
  if (S) {
    const w = S.walk && typeof S.walk === 'object' ? S.walk : null;
    const abstained = !!(S.abstained || S.promptAbstained) || S.stage === 'short' || !S.pixel;
    g.walk = { pixel: S.pixel || null, gain: w ? num(w.gain) : null, z: w ? num(w.z) : null, zRequired: w ? num(w.z_required) : null, ms: num(S.ms), sensor: w ? w.sensor || null : null, walked: !!(w && S.pixel) };
    g.slot = { leaf: S.leaf || null, best: S.best && S.best.id ? S.best.id : null, d: num(S.d), margin: num(S.margin), inSlot: num(S.inSlot), stage: S.stage || (abstained ? 'abstained' : null), released: S.released || null, abstained, placed: S.stage === 'landed' && !abstained, why: S.why || null, at: S.at || null };
  }
  return g;
}
export function renderIngestCard(g, { now = Date.now(), th = thresholds() } = {}) {
  const age = (iso) => (iso ? `<b class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</b> ago` : '—');
  const nr = (k) => `<span class="miss">not run — <code>${esc(INGEST_CMD[k])}</code></span>`;
  const n = (x) => (x == null ? '—' : String(x));
  const row = (k, v) => `<div class="wbc"><div class="wbk">${k}</div><div class="wbv">${v}</div></div>`;
  if (g.state !== 'MEASURED') return `<div class="card3 c-ingest ingest"><div class="c3l face">${primary('vna.clipIngest', '⤵ Ingest', nr('seed'), 'one click: the clipboard lands on the steer file under a clip stamp, a ledger row is written, the fold runs')}${plusFold('ingest', 'the last paste\'s receipt rows', `<div class="wbh"><b>INGEST</b> <span class="dim">· the Rust walk's receipt for the last paste</span></div>${row('receipts', nr('seed'))}`)}</div></div>`;
  const paste = g.at == null && g.bytes == null ? nr('ledger')
    : `<b>+${g.bytes == null ? '—' : g.bytes.toLocaleString('en-US')} bytes from <code>${esc(g.source || '—')}</code></b> · ${esc(g.status || '—')}${g.sha ? ` · <code>${esc(g.sha)}</code>` : ''} · ${age(g.at)}`;
  const f = g.fold; const fold = !f ? nr('fold')
    : `${f.behind === 0 ? '<b class="bo bo-GUARDED">fold at the tape</b>' : f.behind == null ? '<b class="bo bo-UNMEASURED">UNMEASURED</b>' : `<b class="bo bo-BUILT">${f.behind} behind</b>`} · ${n(f.rows)} rows · watermark ${n(f.watermark)}${f.pid != null ? ` · pid ${f.pid}` : ''} · ${age(f.at)}`;
  const w = g.walk, s = g.slot;
  let walk, slot, state;
  if (!w || !s) { walk = nr('seed'); slot = ''; state = ''; }
  else if (s.abstained || !w.walked) {
    walk = `<b class="bo bo-DECLARED">not walked</b> <span class="dim">${esc(s.why || s.stage || 'the hook abstained')}</span>${w.ms != null ? ` · ${w.ms} ms` : ''}`;
    slot = s.leaf ? `anchor <b class="lb">${esc(s.leaf)}</b> <span class="dim">· the record is the anchor, the prompt was not placed</span>` : '';
    state = '';
  } else {
    walk = `<span class="ib">${esc(w.pixel)}</span> <span class="dim">${esc(fullName(w.pixel))}</span> · gain ${n(w.gain)} · z ${n(w.z)} / ${n(w.zRequired)}${w.sensor && w.sensor !== 'measured' ? ` <span class="dim">(${esc(w.sensor)})</span>` : ''}${w.ms != null ? ` · ${w.ms} ms` : ''}`;
    slot = `<b class="lb">${esc(s.leaf || '—')}</b>${s.best ? ` <span class="dim">${esc(s.best)}</span>` : ''} · d ${n(s.d)} / τ ${n(th.tau_attach)} · m ${n(s.margin)} / ${n(th.m_attach)}${s.inSlot != null ? ` · ${s.inSlot} in the slot` : ''}`;
    state = s.placed ? `<b class="bo bo-GUARDED">LANDED</b> <span class="dim">the seed attached to its basin; the tree grew by one snippet</span>`
      : `<b class="badge amber">⚠️ UNPLACED DRAWER</b> <b class="bo bo-UNMEASURED">${esc(String(s.released || s.stage || 'released').toUpperCase())}</b> <span class="dim">${esc(s.why || '')}</span>`;
  }
  // C109m.5: the ingest is a face row like every other — the paste, the fold and the walk on one nowrap line; the receipt rows under the +
  const measure = `${paste} · fold ${fold} · walk ${walk}${state ? ` · ${state}` : ''}`;
  return `<div class="card3 c-ingest ingest"><div class="c3l face">${primary('vna.clipIngest', '⤵ Ingest', measure, 'one click: the clipboard lands on the steer file under a clip stamp, a ledger row is written, the fold runs; this line is the Rust walk\'s receipt for the LAST paste — every number is the hook\'s')}${plusFold('ingest', 'the last paste\'s receipt rows — paste · fold · walk · basin · state; every number is the hook\'s, not run when the hook has not', `<div class="wbh"><b>INGEST</b> <span class="dim">· the Rust walk's receipt for the last paste · every number is the hook's</span>${s && s.at ? ` <span class="dim">· seed ${age(s.at)}</span>` : ''}</div>${row('paste', paste)}${row('fold', fold)}${row('walk · 144×144', walk)}${slot ? row('basin', slot) : ''}${state ? row('state', state) : ''}`)}</div></div>`;
}

// C79a — OPEN-STATE MEMORY through the webview's own door. The sidebar re-renders its HTML on every receipt (a paste, a
// verdict, 🔄 refresh) and a re-render is a fresh document: which <details> you opened must come back from storage that
// survives setHtml. In the VS Code webview that is vscode.getState()/setState() (session storage the host keeps for the view);
// in the browser copy, localStorage. Same key, same shape ({open:{id:bool}}); restored BEFORE first paint, written on every
// toggle. Exported so the guard can replay it over a fixture document; inlined once in the page.
// acquireVsCodeApi() may be called ONCE per document: the page acquires it first (this script runs before the host's shim,
// which is appended after the html) and parks it on window.__vs; the shim (vna-view.ts bridge) reuses __vs instead of acquiring.
export const OPEN_STATE_SCRIPT = `(function(){var K='vna.open';var api=null;try{if(typeof __vs!=='undefined'&&__vs)api=__vs;else if(typeof acquireVsCodeApi==='function'){api=acquireVsCodeApi();window.__vs=api;}}catch(e){}
var open={};try{if(api){var st=api.getState();open=(st&&st.open)||{};}else{open=JSON.parse(localStorage.getItem(K)||'{}');}}catch(e){open={};}
function save(){try{if(api)api.setState({open:open});else localStorage.setItem(K,JSON.stringify(open));}catch(e){}}
document.querySelectorAll('details[id]').forEach(function(d){if(d.id in open){if(open[d.id])d.setAttribute('open','');else d.removeAttribute('open');}
d.addEventListener('toggle',function(){open[d.id]=d.open;save();});});})();`;

// ── C79b ECONOMIC TELEMETRY — the token efficiency card (goal 6 unit 3). Four receipts, nothing else: the runner ledger's
// verdict rows carry the worker's OWN usage + cost_usd (claude -p --output-format json — a fact on the row, never estimated;
// steer-runner.mjs C66); the last seed row carries the served snowball's size (bundle.chars · tokens_est · cap — what the
// hook actually handed the turn, C79b); the clear gauge carries contextBytes (the transcript a monolithic chat carries);
// regime-floors.json carries the measured regime floors (C70). The collapse is a RATIO OF TWO RECEIPTS. A missing receipt
// reads UNMEASURED, never 0; the /goal's "1.4k vs 124k · ~85 %" are predictions this card overshoots or contradicts, never prints.
const r2 = (x) => Math.round(x * 100) / 100;
export function economics({ runner = resolve(REPO, '.thetacog/runner.ndjson'), seed = resolve(REPO, '.thetacog/vna-seed.ndjson'), gauge = resolve(REPO, '.thetacog/vna-clear-gauge.json'), floors = D('regime-floors.json'), cockpit = D('cockpit.json'), goal = D('goal.json') } = {}) {
  const UN = (why) => ({ state: 'UNMEASURED', why });
  let rows = []; try { rows = readFileSync(runner, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  let run;
  if (!rows.length) run = UN('no runner.ndjson yet — the runner writes one row per event');
  else {
    const lastRun = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === 'run').pop(); const cur = lastRun ? rows.slice(lastRun[1]) : rows;
    const verdicts = cur.filter((r) => r.kind === 'verdict'); const dispatches = cur.filter((r) => r.kind === 'dispatch').length;
    // C119h (operator 2026-09-21: "we had measures of token efficiency, it must have broke, or been subverted somehow?"): a `worker` row is
    // the worker's own usage when it halted before a verdict (11.1 M tokens in, 72 turns, $8.73 on the live tape) — summing verdicts alone
    // read that run as 0 tokens and let the face print 99.8 % not re-sent over work that re-read the repo 72 times. One row per (n, label),
    // the verdict preferred over the worker row; the turns are summed from num_turns where a row carries it.
    const spent = new Map(); for (const r of cur) { if ((r.kind === 'verdict' || r.kind === 'worker') && r.usage) { const key = `${r.n}:${r.label}`; if (!spent.has(key) || r.kind === 'verdict') spent.set(key, r); } }
    const tokens = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }; let usd = 0, turns = 0, unturned = 0;
    for (const v of spent.values()) { const u = v.usage || {}; tokens.input += num(u.input_tokens) || 0; tokens.cacheCreation += num(u.cache_creation_input_tokens) || 0; tokens.cacheRead += num(u.cache_read_input_tokens) || 0; tokens.output += num(u.output_tokens) || 0; usd += num(v.cost_usd) || 0; if (num(v.num_turns) != null) turns += v.num_turns; else unturned++; }
    run = { state: 'MEASURED', usd: r2(usd), meanUsd: verdicts.length ? usd / verdicts.length : null, verdicts: verdicts.length, dispatches, workers: spent.size, turns, unturned, tokens, at: cur[cur.length - 1].at || null };
  }
  const sd = lastLine(seed); const b = sd && sd.bundle;
  const snowball = b && num(b.tokens_est) != null ? { state: 'MEASURED', tokens: b.tokens_est, chars: num(b.chars), cap: num(b.cap), at: sd.at || null } : UN(sd ? 'the seed row carries no bundle size — a hook older than C79b' : 'no vna-seed.ndjson yet');
  let g = null; try { g = JSON.parse(readFileSync(gauge, 'utf8')); } catch {}
  const chat = g && num(g.contextBytes) != null ? { state: 'MEASURED', bytes: g.contextBytes, tokens: Math.round(g.contextBytes / 4), at: g.at || null } : UN('no clear gauge yet — the hook writes it every turn');
  // C119h — TWO RATIOS, NEVER CONFUSED: `boot` is the bundle against the chat's context (snowball / chat — what the cold worker is handed
  // instead of the transcript; ~99 % by construction, a property of the bundle, not of any work); `collapse` is the SPEND ratio — what the
  // worker actually sent in (input + cache creation + cache read, over its own turns) against what a chat would have re-sent over the same
  // turns (chat context × turns). Only the second may print as "not re-sent"; without a worker row with usage and turns it is UNMEASURED.
  const boot = snowball.state === 'MEASURED' && chat.state === 'MEASURED' && chat.tokens > 0 ? { state: 'MEASURED', ratio: snowball.tokens / chat.tokens, pct: Math.round((1 - snowball.tokens / chat.tokens) * 1000) / 10 } : UN('needs both the snowball and the chat sizes');
  const actualIn = run.state === 'MEASURED' ? run.tokens.input + run.tokens.cacheCreation + run.tokens.cacheRead : 0;
  const collapse = run.state !== 'MEASURED' ? UN(run.why) : !(run.turns > 0 && actualIn > 0) ? UN(run.workers ? 'the run\'s rows carry no usage with turns yet — nothing was sent, so nothing was saved' : 'no worker or verdict row with usage yet — the run has not spent') : chat.state !== 'MEASURED' ? UN('no chat size (clear gauge)') : (() => { const would = chat.tokens * run.turns; return { state: 'MEASURED', ratio: actualIn / would, pct: Math.round((1 - actualIn / would) * 1000) / 10, actual: actualIn, would, turns: run.turns, unturned: run.unturned }; })();
  let f = null; try { f = JSON.parse(readFileSync(floors, 'utf8')); } catch {}
  const fl = f && f.metrics ? { state: 'MEASURED', at: f.at || null, metrics: f.metrics } : UN('no data/vna/regime-floors.json');
  // THE LAST RUN — the newest verdict or halt row: the gates it passed, the worker's own seconds · turns · cost, the fold, the CAR
  const lastV = rows.filter((r) => r.kind === 'verdict' || r.kind === 'halt').pop();
  let lastRun;
  if (!lastV) lastRun = UN(rows.length ? 'no verdict yet — the run is on its first dispatch' : 'no runner.ndjson yet');
  else if (lastV.kind === 'halt') lastRun = { state: 'MEASURED', halted: true, label: lastV.label || null, reason: lastV.reason || null, at: lastV.at || null };
  else { const g = lastV.gates || {}; const keys = Object.keys(g); lastRun = { state: 'MEASURED', halted: false, ok: !!lastV.ok, label: lastV.label || null, gatesOk: keys.filter((k) => g[k] === true || g[k] === 'RED').length, gatesOf: keys.length, ms: num(lastV.ms), exit: num(lastV.exit), turns: num(lastV.num_turns), usd: num(lastV.cost_usd), tokens: lastV.usage ? (num(lastV.usage.input_tokens) || 0) + (num(lastV.usage.cache_creation_input_tokens) || 0) + (num(lastV.usage.cache_read_input_tokens) || 0) + (num(lastV.usage.output_tokens) || 0) : null, foldMs: num(lastV.foldMs), car: !!(lastV.car && lastV.car.complete), work: lastV.work ? String(lastV.work).slice(0, 10) : null, at: lastV.at || null }; }
  // PERFORMANCE — the walk's own receipt (cockpit.json: hops · ply · pipeline · Δ render) and the hook's ms on the seed row
  let ck = null; try { ck = JSON.parse(readFileSync(cockpit, 'utf8')); } catch {}
  const perf = ck && num(ck.pipelineMs) != null ? { state: 'MEASURED', pipelineMs: ck.pipelineMs, hops: ck.walk ? num(ck.walk.hops) : null, maxPly: ck.walk ? num(ck.walk.maxPly) : null, deltaMs: ck.delta ? num(ck.delta.ms) : null, hookMs: sd ? num(sd.ms) : null, commit: ck.commit || null, at: ck.generatedAt || null } : UN('no cockpit.json — node scripts/vna/cockpit.mjs');
  // SAVED — the difference of two receipts, and the cache's share of everything the workers read
  let gl = null; try { gl = JSON.parse(readFileSync(goal, 'utf8')); } catch {}
  const totalIn = run.state === 'MEASURED' ? run.tokens.input + run.tokens.cacheCreation + run.tokens.cacheRead : 0;
  const saved = { state: collapse.state, tokens: collapse.state === 'MEASURED' ? collapse.would - collapse.actual : null, boot: boot.state === 'MEASURED' ? chat.tokens - snowball.tokens : null, cacheReadShare: run.state === 'MEASURED' && totalIn > 0 ? run.tokens.cacheRead / totalIn : null, turnsUsed: run.state === 'MEASURED' ? run.verdicts : null, turnsBudget: gl && gl.turns ? gl.turns : null, transcriptTurns: g && num(g.turns) != null ? g.turns : null };
  return { run, snowball, chat, boot, collapse, floors: fl, lastRun, perf, saved };
}
export function renderEconomicsCard(e) {
  const un = (m) => `<b class="rr">UNMEASURED</b> <span class="dim">— ${esc(m.why || '')}</span>`;
  const k = (n) => (n == null ? '—' : n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const dur = (ms) => (ms == null ? '—' : ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
  const age = (iso) => (iso ? `<b class="age" data-at="${esc(iso)}">${fmtAge(Date.now() - Date.parse(iso))}</b> ago` : '');
  const L = e.lastRun;
  const last = L.state !== 'MEASURED' ? un(L) : L.halted ? `<b class="lb">${esc(L.label || '—')}</b> <b class="rr">HALTED</b> <span class="dim">${esc(String(L.reason || '').slice(0, 90))}</span> · ${age(L.at)}`
    : `<b class="lb">${esc(L.label || '—')}</b> ${L.ok ? '✅' : '❌'} ${L.gatesOk}/${L.gatesOf} gates · worker ${dur(L.ms)}${L.turns != null ? ` · ${L.turns} turns` : ''}${L.tokens != null ? ` · ${k(L.tokens)} tokens` : ''}${L.foldMs != null ? ` · fold ${L.foldMs} ms` : ''} · CAR ${L.car ? '✓' : '✗'}${L.work ? ` · <code>${esc(L.work)}</code>` : ''} · ${age(L.at)}`;
  const P = e.perf;
  const perf = P.state !== 'MEASURED' ? un(P) : `walk ${P.hops ?? '—'} hops · ply ${P.maxPly ?? '—'} · pipeline ${P.pipelineMs} ms${P.deltaMs != null ? ` · Δ ${dur(P.deltaMs)}` : ''}${P.hookMs != null ? ` · hook ${Math.round(P.hookMs)} ms` : ''}`;
  const S = e.saved, r = e.run;
  const savedLine = e.collapse.state !== 'MEASURED' ? `snowball ${e.snowball.state === 'MEASURED' ? `<b>${k(e.snowball.tokens)}</b>` : un(e.snowball)} · chat ${e.chat.state === 'MEASURED' ? `<b>${k(e.chat.tokens)}</b>` : un(e.chat)}`
    : `<b>${k(S.tokens)} tokens not re-sent</b> <b class="badge green">${e.collapse.pct}%</b> <span class="dim">${e.collapse.turns != null ? `(the worker sent ${k(e.collapse.actual)} in over ${e.collapse.turns} turns; a chat at ${k(e.chat.tokens)} would have re-sent ${k(e.collapse.would)}${e.collapse.unturned ? ` · ${e.collapse.unturned} row${e.collapse.unturned === 1 ? '' : 's'} without turns left out` : ''})` : `(snowball ${k(e.snowball.tokens)} vs chat ${k(e.chat.tokens)})`} · boot ${e.boot && e.boot.state === 'MEASURED' ? `${k(e.snowball.tokens)} vs chat ${k(e.chat.tokens)}, ${e.boot.pct}%` : 'UNMEASURED'}</span>`;
  const cacheLine = S.cacheReadShare != null ? ` · cache read ${(S.cacheReadShare * 100).toFixed(1)}%` : '';
  const turnsLine = S.turnsBudget && S.turnsUsed != null ? ` · turns ${S.turnsUsed} of ${S.turnsBudget.min}–${S.turnsBudget.max}` : '';
  // C89b (the fourth dictation): NEVER A DOLLAR ON A CARD — the worker's own token counts are the fact on the verdict row; its
  // cost_usd stays in runner.ndjson for whoever wants it and is never painted ("$26.13 this run" here was the source of the paste's line)
  const runTok = (t) => (t ? k((num(t.input) || 0) + (num(t.cacheCreation) || 0) + (num(t.cacheRead) || 0) + (num(t.output) || 0)) : '—');
  const runLine = r.state !== 'MEASURED' ? un(r) : r.verdicts === 0 ? `<b>${runTok(r.tokens)} tokens</b> over ${r.dispatches} dispatch${r.dispatches === 1 ? '' : 'es'} · <span class="dim">no verdict yet — the worker's usage lands on its verdict row</span>`
    : `<b>${runTok(r.tokens)} tokens</b> this run · ${r.verdicts} verdict${r.verdicts === 1 ? '' : 's'} of ${r.dispatches} dispatch${r.dispatches === 1 ? '' : 'es'}`;
  const floors = e.floors.state !== 'MEASURED' ? un(e.floors) : Object.entries(e.floors.metrics).map(([name, m]) => { const meas = m.measured && m.measured.headless; const pred = m.predicted && m.predicted.headless; return `${esc(name)} ${meas == null ? '<b class="rr">UNMEASURED</b>' : `<b>${esc(String(meas))}</b>`}${pred != null ? ` <span class="dim">(predicted ${esc(String(pred))})</span>` : ''}`; }).join(' · ');
  return `<div class="card3 c-econ"><div class="c3l c3t" title="the newest verdict row of .thetacog/runner.ndjson — the gates it passed, the worker's own seconds · turns · cost_usd, the fold, the CAR"><span class="rk">LAST RUN</span> ${last}</div><div class="c3l c3t" title="data/vna/cockpit.json — the Rust walk's hops and ply, the pipeline and Δ render times; the hook's ms from the seed row"><span class="rk">PERF</span> ${perf}</div><div class="c3l c3t" title="the served snowball (seed row bundle.tokens_est) against the transcript a chat would carry (clear gauge contextBytes / 4); cache read share of everything the workers read; verdicts against the goal's turn budget"><span class="rk">SAVED</span> ${savedLine}${cacheLine}${turnsLine}</div><div class="c3l c3t dim" title="Σ cost_usd over the runner ledger's current run · data/vna/regime-floors.json, measured per regime (C70)"><span class="rk">RUN</span> ${runLine} · ${floors}</div></div>`;
}

// ── BOTH ARMS: the envelope, read back ──────────────────────────────────────
// The page showed the map, the spec, the rooms and the trigger, and NOT the two arms — so step 4 of
// the loop, the one where the operator actually decides something, was the one step the page did not
// serve. BOTH arms or neither: a single "correction" assumes the declaration is always right, which
// is the transitive-abstraction failure this instrument exists to catch. Sometimes the drift WAS the
// real work.
//
// ABSTENTIONS GET NO BUTTONS AND NO ARM. Below the calibrated margin floor the placer refuses,
// because a confident WRONG placement measured worse than chance. Listing them beside the arms would
// invite aiming him with a coordinate the instrument declined to stand behind.
// C122g — THE ARMS UNDER THE WALK, ONLY WHILE THE ENVELOPE PULLS (operator's paste 2026-09-21: "if drift is detected, the [⇄ Amend] and
// [↩️ Revert] buttons appear directly below this pill, forcing a forensic decision" — KEPT as the record's own two arms, move the work ·
// move the declaration (envelope.mjs), picked by ⇄ Steer: Cycle and RECORDED, never inferred; REFUSED as "Revert", which is not an arm of
// this record). One face line in the cluster's shape: the ⇄ button is the .action, the pull its measure, the two arms the metrics; an
// empty arm is stated ("nothing on this arm"), never filled in. Pull 0 or no envelope paints nothing — the face stays the readouts.
export function renderArmsLine(env) {
  if (!env || env.missing || !(Number(env.pull) > 0)) return '';
  const w = env.moveWork && (env.moveWork.id || env.moveWork.coord) ? `${env.moveWork.id ? esc(env.moveWork.id) + ' · ' : ''}${esc(env.moveWork.name || env.moveWork.coord)}` : 'nothing on this arm';
  const d = env.moveDecl && env.moveDecl.coord ? `${esc(env.moveDecl.coord)} · ${env.moveDecl.n} commit${env.moveDecl.n === 1 ? '' : 's'}${env.moveDecl.totalUndeclared != null ? ` of ${env.moveDecl.totalUndeclared} undeclared` : ''}` : 'nothing on this arm';
  const metric = `pull ${esc(String(env.pull))} blocks · Arm 1 move the work → ${w} · Arm 2 move the declaration → ${d}`;
  return `<div class="card3 c-arms"><div class="c3l face">${primary('vna.cycle', '⇄ Pick an arm', metric, 'the two arms the drift offers — move the work back to the declared coordinate, or move the declaration to where the work landed; the pick is written to the envelope ledger (node scripts/vna/envelope.mjs --pick work|declaration), never inferred; next: the next commit lands on the arm you took')}</div></div>`;
}

function renderArms(env) {
  if (env.missing) return miss(env);
  const arm = (title, a, why) => `<div class="arm" title="${esc(title)}">` + (a
    ? `<div class="coord">${esc(a.name || a.coord)} <span class="k">— ${esc(why(a))}</span></div>`
    : `<div class="k" title="nothing on this arm this cycle — stated rather than filled in">not assigned this cycle</div>`) + '</div>';
  const work = arm('MOVE THE WORK — a declared coordinate no commit has reached', env.moveWork,
    (a) => `${a.id ? a.id + ' · ' : ''}aim the next commit here`);
  const decl = arm('MOVE THE DECLARATION — a worked coordinate the spec never named', env.moveDecl,
    (a) => `${a.n} commit${a.n === 1 ? '' : 's'} landed here${a.repeated ? ', repeatedly' : ''} of ${a.totalUndeclared} undeclared · ${(a.commits || []).slice(0, 4).join(' ')}`);
  const abst = (env.abstained || []).map((x) => `<li><b>${esc(x.id)}</b> <span class="k">margin ${x.margin != null ? x.margin.toFixed(5) : '—'} &lt; floor ${env.floor}</span></li>`).join('');
  return `<div class="arms">${work}${decl}</div>
<div class="k" style="margin-top:10px">pull <b>${esc(env.pull)}</b> blocks · fence ${esc(env.fence)} · window ${esc(env.limit)} commits · take one arm with <code>node scripts/vna/envelope.mjs --pick work|declaration --note "…"</code>, or <b>Steer: Cycle</b> in the IDE. Which arm you take, cycle after cycle, IS the competence signal — it is recorded, never inferred.</div>
${abst ? `<div class="k" style="margin-top:10px">ABSTAINED — ${(env.abstained || []).length} item(s) the placer refused below the floor ${env.floor}. No arm is offered on these, because a confident wrong placement measured worse than chance.</div><ul class="abst">${abst}</ul>` : ''}`;
}

// ── THE MAP: the 12x12 block grid, painted from receipts ────────────────────
// Rows are the ACTOR lane, columns the PATIENT lane, ShortLex order on both — the same anatomy the
// 144x144 panel uses, at block resolution so a human can read the cells.
// ── THE NET, AND THE SUBDIVISION THAT MAKES IT A NET ────────────────────────
// The grid is not a chart with 144 cells in it. It is the ShortLex SUBDIVISION drawn: three
// cardinals, each subdivided into three, on both axes — and the subdivision has to be VISIBLE or the
// picture is a heatmap and the hierarchy it encodes is invisible. So the 3x3 group boundaries are
// drawn heavy, the axes are labelled in two tiers (cardinal above leaf), and the cells inside a
// group read as one neighbourhood, which is what the fence measures distance in.
//
// The strands (declared items the placer stood behind) and the holes (mass that landed with no
// strand inside the fence) are painted on the same grid, because the whole question the operator
// asked — is the net fine enough to catch the water — is a question about the geometry BETWEEN them.
function renderMap({ align, comp, trigger, net }) {
  const cell = {};                       // "r,c" -> {classes, title}
  const mark = (coord, cls, why) => {
    const b = blockOf(coord); if (!b) return;
    const k = `${b[0]},${b[1]}`;
    (cell[k] ||= { cls: new Set(), why: [] });
    cell[k].cls.add(cls); cell[k].why.push(why);
  };
  // FIELD NAMES READ FROM THE RECEIPT, NOT GUESSED. The first version reached for
  // `comp.centreOfMass` and `comp.growthEdge[]`; the receipt actually carries `shape.centroid`,
  // `shape.peak` and `growthEdge.items[]`. Guessing the shape of a receipt another script wrote is
  // the same class as guessing what running code does — it fails loudly here, which is the good
  // case, but a guess that happened to hit a real key would have rendered a plausible wrong map.
  if (!comp.missing) {
    if (comp.shape?.centroid?.coord) mark(comp.shape.centroid.coord, 'centre', 'your centre of mass');
    if (comp.shape?.peak?.coord) mark(comp.shape.peak.coord, 'peak', `peak mass · n=${comp.shape.peak.n} · ${comp.shape.peak.sharePct}%`);
    for (const g of comp.growthEdge?.items || []) mark(g.coord, 'growth', `growth edge · n=${g.n}${g.toehold ? ' · toehold' : ''}`);
  }
  if (!align.missing) for (const r of align.rooms || []) {
    if (r.declared) mark(r.declared, r.status === 'RE-ROLL' ? 'pole-off' : 'pole', `${r.emoji || ''} ${r.key} declared pole${r.pull != null ? ` · pull ${r.pull}` : ''}`);
    if (r.centre && r.status === 'RE-ROLL') mark(r.centre, 'drifted', `${r.emoji || ''} ${r.key} work centred here`);
  }
  if (!trigger.missing) for (const e of trigger.severeExposure || []) mark(e.coord, 'severe', `severe events · ${e.n}`);
  // THE NET ITSELF. A strand is a declaration with a margin above the floor; a hole is where the
  // water landed with none inside the fence. Painting both is the only way the picture answers "is
  // the mesh fine enough here" rather than "where is there mass".
  if (net && !net.missing) {
    for (const h of net.holes || []) mark(h.coord, 'hole', `HOLE — ${h.n} commit(s) landed, nearest strand ${h.nearest?.id || 'none'} at ${h.nearest?.d ?? '—'} blocks (fence ${net.fence})`);
    for (const s2 of net.slack || []) mark(s2.coord, 'strand', `strand ${s2.id} — declared, no mass on it`);
  }

  let rows = '';
  for (let r = 0; r < 12; r++) {
    // The row's cardinal label is emitted once per group of three — the same subdivision, vertically.
    const HZR = { A: 'long', B: 'short', C: 'medium' };
    const cardR = 'ABC'[Math.floor(r / 3)] || '';
    let tds = `${r % 3 === 0 ? `<th class="card" rowspan="3">${cardR}<br><span class="hz">${HZR[cardR] || ''}</span></th>` : ''}<th class="ax">${AXL[r]}</th>`;
    for (let c = 0; c < 12; c++) {
      const k = `${r},${c}`, v = cell[k];
      const coord = `${AXL[r]},${AXL[c]}`;
      const name = `${AXL[r]}.${LANE[AXL[r]]} × ${AXL[c]}.${LANE[AXL[c]]}`;
      const cls = v ? [...v.cls].join(' ') : '';
      const title = v ? `${name}\n${v.why.join('\n')}` : name;
      // Heavy edges on the 3x3 group boundaries: the subdivision, drawn.
      const edge = `${r % 3 === 0 ? ' gt' : ''}${c % 3 === 0 ? ' gl' : ''}${r === 11 ? ' gb' : ''}${c === 11 ? ' gr' : ''}`;
      tds += `<td class="${cls}${edge}" title="${esc(title)}" data-c="${esc(coord)}"></td>`;
    }
    rows += `<tr>${tds}</tr>`;
  }
  // TWO TIERS, because the subdivision is the point: the cardinal spans its three leaves, so the
  // hierarchy is readable off the axis rather than inferred from the labels.
  let card = '<tr><th></th><th></th>';
  const HZ = { A: 'long', B: 'short', C: 'medium' };
  for (const c of ['A', 'B', 'C']) card += `<th class="card" colspan="3">${c} <span class="hz">${HZ[c]}</span></th>`;
  card += '</tr>';
  let head = '<tr><th></th><th></th>';
  for (let c = 0; c < 12; c++) head += `<th class="ax">${AXL[c]}</th>`;
  head += '</tr>';
  return `<table class="lat">${card}${head}${rows}</table>`;
}

// ── THE ENVELOPE: the commit unit, the covenant, the aperture, steering work, the meter ────────
// One card, five receipts, each read or reported absent. Nothing here is computed: a median is the
// receipt's median, a verdict is the receipt's verdict, UNMEASURED is printed as UNMEASURED.
const fmt = (x, d = 0) => (x == null || !Number.isFinite(+x) ? '—' : (+x).toLocaleString('en-US', { maximumFractionDigits: d }));
function renderEnvelope({ cost, cov, ap, sw, meterTurn, meterSteer }) {
  const row = (k, v) => `<div class="k"><b>${esc(k)}</b> ${v}</div>`;
  const unit = (u) => u ? `median ${fmt(u.median)} · mean ${fmt(u.mean)} · n ${fmt(u.n)}${u.floor != null ? ` · floor ${fmt(u.floor)}` : u.floor_why ? ` · floor — <span class="dim">${esc(u.floor_why)}</span>` : ''}` : '—';
  const meterLine = (m, label) => !m ? `<span class="dim">not run — <code>node scripts/pmu/grip-meter.mjs${label === 'steer' ? ' --source steer' : ''}</code></span>`
    : `${m.status === 'measured' ? `<b>${fmt(m.steering.value * 100)}%</b> n ${m.steering.n} · null ${fmt((m.steering.null_mean || 0) * 100)}% · z ${fmt(m.steering.z, 2)}` : `<span class="rr">UNMEASURED</span>`} — ${esc(m.steering?.verdict || '')} <span class="dim">(${esc(String(m.at || '').slice(0, 16))})</span>`;
  const o = cost.missing ? null : cost.envelope?.overall;
  const y = cost.missing ? null : cost.yield?.overall_commit_form;
  const c = cov.missing ? null : cov.compliance?.overall;
  const pct = (r) => (r && r.measured ? `${fmt(r.rate * 100, 1)}% (${r.pass}/${r.n})` : `<span class="rr">UNMEASURED</span>${r?.why ? ` <span class="dim">${esc(r.why)}</span>` : ''}`);
  return `
   <h3>The commit unit — cognitive commit credits, in the record's own units (KR40)</h3>
   ${cost.missing ? miss(cost) : `
   ${row('tokens / commit', unit(o?.tokens_per_commit))}
   ${row('minutes / commit', unit(o?.minutes_per_commit))}
   ${row('calls / commit', unit(o?.calls_per_commit))}
   ${row('yield Y', y ? `${y.passes} passes of ${y.decidable} decidable commits (${y.commits} rowed) → Y ${fmt(y.Y, 3)}` : '—')}
   ${row('dollars', o?.dollar_conversion?.unpinned ? `<span class="rr">UNPINNED</span> <span class="dim">${esc(o.dollar_conversion.why)}</span>` : `pinned · $${fmt(o?.dollar_conversion?.dollars_per_commit, 2)}/commit`)}
   <div class="dim" title="${esc(String(cost.rule || ''))}">a cost floor, an ask, never a price — n ${fmt(o?.tokens_per_commit?.n)}</div>`}
   <h3>The covenant — the collar, decidable per turn (KR37)</h3>
   ${cov.missing ? miss(cov) : `
   ${row('collar', `off-lane ≤ ${esc(cov.collar?.tau_pct)}% · breach β ∈ {${(cov.collar?.betas || []).join(', ')}} · calls ≤ ${esc(cov.collar?.k_calls)}`)}
   ${row('off-lane pass', pct(c?.off_lane))} ${row('calls pass', pct(c?.calls))} ${row('covenant pass (β 0)', pct(c?.covenant_beta_0))}
   <div class="dim">${esc(String(cov.verdict || '').slice(0, 220))}</div>`}
   <h3>The aperture — α per lane, the width meter (KR39)</h3>
   ${ap.missing ? miss(ap) : `
   ${row('mis-declared lanes (α > P)', (ap.mis_declared?.alpha_gt_p_mis_declared || []).length ? esc((ap.mis_declared.alpha_gt_p_mis_declared).map((x) => x.lane).join(', ')) : '0 named')}
   ${row('earns its pass (α < P)', (ap.mis_declared?.alpha_lt_p_earns_its_pass || []).length ? esc((ap.mis_declared.alpha_lt_p_earns_its_pass).map((x) => x.lane).join(', ')) : '0 named')}
   ${row('mesh inventory', ap.inventory ? `${fmt(ap.inventory.total_events)} events · ${fmt(ap.inventory.distinct_threads)} threads · ASK ${fmt(ap.inventory.type_counts?.ASK)} · CLAIM ${fmt(ap.inventory.type_counts?.CLAIM)} · VERDICT ${fmt(ap.inventory.type_counts?.VERDICT)} — <span class="dim">${esc(ap.inventory.rule || 'inventory, never liquidity')}</span>` : '—')}`}
   <h3>Steering work — KL(P_walk ‖ P_inertia) per lane (KR41)</h3>
   ${sw.missing ? miss(sw) : `${row('overall A / B', `KL ${fmt(sw.overall?.A?.kl?.pooled?.rate, 3)} z ${fmt(sw.overall?.A?.kl?.pooled?.z, 2)} · KL ${fmt(sw.overall?.B?.kl?.pooled?.rate, 3)} z ${fmt(sw.overall?.B?.kl?.pooled?.z, 2)}${sw.null_degenerate_on_every_measured_half ? ' · <span class="rr">null degenerate</span>' : ''}`)}
   <div class="dim">${esc(String(sw.verdict || '').slice(0, 220))}</div>`}
   <h3>The meter — did the placement predict the action (§16)</h3>
   ${row('turns', meterLine(meterTurn, 'turn'))}
   ${row('steers (pastes into the file open)', meterLine(meterSteer, 'steer'))}`;
}

// ── THE STEER FILE: which txt the loop follows, and where its last amendment landed ────────────
// The clipboard line is READ from clip-watch.mjs's one state function (armed flag + receipt), never
// re-derived here — three states, one of which is "not run", because an absent daemon is not a
// disarmed one. Texts: "clipboard: armed · N appended today" / "clipboard: disarmed" /
// "clipboard: not run — node scripts/vna/clip-watch.mjs arm".
function renderSteerFile({ pointer, surfaced, clip }) {
  if (!pointer) return `<div class="miss">no steer file — open a .txt in the IDE, or <code>node scripts/vna/steer-file.mjs set &lt;path&gt;</code></div>`;
  const p = surfaced && surfaced.placed ? Object.values(surfaced.placed).pop() : null;
  return `<div class="k"><b>${esc(pointer.source)}</b> · set ${esc(String(pointer.at || '').slice(0, 16))} by ${esc(pointer.by)}</div>
   <div class="${clip && clip.armed ? 'k' : 'dim'}">${esc(clip ? clip.line : 'clipboard: not run — node scripts/vna/clip-watch.mjs arm')}</div>
   ${surfaced ? `<div class="k">last amendment seen by Claude ${esc(String(surfaced.at || '').slice(11, 16))}Z · rows ${esc((surfaced.rows || []).join(','))} · ${fmt(surfaced.bytes)}B</div>
   <div class="k">${p ? (p.pixel ? `landed <b>${esc(p.pixel)}</b> ${esc(fullName(p.pixel))} · σ ${fmt(p.sigma, 2)} · ${p.sensor === 'metal' ? 'admissible' : '<span class="rr">UNMEASURED</span>'}${p.d_last_commit != null ? ` · ${p.d_last_commit} blocks from the last commit` : ''}` : 'unplaced — the walk refused') : 'not placed'}</div>`
   : '<div class="dim">no amendment surfaced yet — append to the file and send any prompt</div>'}`;
}

// ── THE SPEC TREE: the steer file as typed Merkle nodes, read from spec-tree.mjs's receipt ─────────
// Nested <details>, one per section; a leaf shows its type badge, hash8, where it landed (the walk's
// pixel with its full ShortLex name through the ONE expander, fullName — never re-expanded here) or
// UNMEASURED, and its revision count with the decided-at. Nothing is hashed, walked or typed on this
// page; the receipt already did that, and --proof <id> on the CLI is the verifier.
function renderSpecTree(t) {
  if (t.missing) return miss(t);
  const N = t.nodes || {}; const c = t.counts || {};
  const badge = (n) => `<span class="ty ty-${esc(n.type)}">${esc(n.type)}${n.cue ? `<i>:${esc(n.cue)}</i>` : ''}</span>`;
  const h8 = (n) => `<code>${esc(String(n.hash || '').slice(0, 8))}</code>`;
  const where = (n) => n.children && n.children.length ? '' : (n.pixel ? ` · <span class="ib">${esc(n.pixel)} ${esc(fullName(n.pixel))}</span>` : ' · <span class="rr">UNMEASURED</span>');
  const rev = (n) => (n.revisions && n.revisions.length) ? ` · <span class="dim">rev ${n.revisions.length} · decided ${esc(String(n.decidedAt || '').slice(0, 16))}</span>` : '';
  const clip = (n) => (n.meta && n.meta.via === 'clip') ? ' · <span class="dim">clip</span>' : '';
  const node = (id) => {
    const n = N[id]; if (!n || n.retracted) return '';
    if (n.children && n.children.length) {
      return `<details id="tr-${esc(String(n.hash || id).slice(0, 8))}"${n.level && n.level <= 2 ? ' open' : ''}><summary>${h8(n)} ${badge(n)} ${esc(n.content?.headline || '')} <span class="dim">· ${n.children.length}</span></summary><div class="tr">${n.children.map(node).join('')}</div></details>`;
    }
    return `<div class="lf" title="${esc(n.content?.text || '')}">${h8(n)} ${badge(n)} ${esc(n.content?.headline || '')}${where(n)}${rev(n)}${clip(n)}</div>`;
  };
  const root = N.root || { children: [] };
  return `<div class="k">root <b>${esc(String(t.root || '').slice(0, 8))}</b> · ${c.nodes ?? 0} nodes · ${c.revisions ?? 0} revision${c.revisions === 1 ? '' : 's'} · ${c.placed ?? 0} placed · ${c.unmeasured ?? 0} unmeasured · root unchanged since ${esc(String(t.rootSince || '—'))}</div>
   <div class="k dim">${esc(String(t.source || '').split('/').pop())} · rows ≤ ${t.watermark ?? '—'}${N.root && N.root.mass ? ` · ${fmtK(N.root.mass.chars)} chars · gzip ${fmtB(N.root.mass.gzip)} · ${snipWord(N.root.mass.snippets)}` : ''} · verify one node: <code>node scripts/vna/spec-tree.mjs --proof &lt;id&gt;</code></div>
   <div class="tree">${(root.children || []).map(node).join('') || '<div class="dim">no nodes — the ledger has no rows for this source</div>'}</div>`;
}

// ── OVERVIEW FIRST (operator 2026-09-17, row 12: "the spec needs to be easy to get an overview from …
// you didn't have to drill down somehow"). L1 = the three cardinals of the leaf's ROW lane (A Strategy /
// B Tactics / C Operations), L2 = the twelve sub-lanes beneath, both in ShortLex order because ShortLex
// is the address every receipt keys on — NEVER re-sorted into temporal order. Leaves are collapsed; each
// opens (L3, renderLeaf) to its contract, raw mass, decisions log, hat + rules and the --bundle line. A
// leaf with no pixel is not in any lane: it sits in an amber "unplaced — the walk refused" drawer with
// no buttons. "placed" = carries a pixel; "admissible" = the walk's seed null test passed (sensor
// metal); "unmeasured" = a pixel the null test did not admit — the walk's own three words, painted.
const rowLane = (px) => String(px || '').split(',')[0];
// the rail's numbers: chars and gzip bytes as the receipt wrote them, formatted only
// the operator's own shapes (2026-09-17): `42.1k chars · gzip 14.8k`, `342 chars · gzip 184B`, `(ρ 0.40)`
const fmtK = (n) => (n == null ? '—' : n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
const fmtB = (n) => (n == null ? '—' : n < 1000 ? `${n}B` : `${(n / 1000).toFixed(1)}k`);
const massLine = (m) => (m ? `${m.nodes != null ? `${m.nodes} nodes · ` : ''}${fmtK(m.chars)} chars · gzip ${fmtB(m.gzip)}` : 'mass not in receipt');
const snipWord = (k) => `${k} snippet${k === 1 ? '' : 's'}`;
function renderLeaf(n, t, { num = null, ticked = null } = {}) {
  const m = n.reef || null;
  const px = n.pixel ? `<span class="ib">${esc(n.pixel)} ${esc(fullName(n.pixel))}</span>${n.walk && n.walk.sensor === 'metal' ? '' : ' <span class="rr">UNMEASURED</span>'}` : '<span class="rr">UNMEASURED</span>';
  const badge = `<span class="ty ty-${esc(n.type)}">${esc(n.type)}${n.cue ? `<i>:${esc(n.cue)}</i>` : ''}</span>`;
  const revs = (n.revisions || []).filter((r) => !r.retracted), echoes = ((n.meta && n.meta.echoes) || []).filter((e) => !e.retracted);   // T11: retracted mass is marked in the receipt, never painted
  // C52c: a basin's slot carries its decisions; the latest is read, never inferred
  const decs = n.basin ? revs.filter((r) => r.kind === 'snippet' && r.decision) : [];
  const lineageHtml = n.basin && (decs.length || revs.some((r) => r.kind === 'revision')) ? `<div class="k">slot: <b>${revs.filter((r) => r.kind === 'revision').length + 1}</b> version${revs.filter((r) => r.kind === 'revision').length ? 's' : ''} · <b>${decs.length}</b> decision${decs.length === 1 ? '' : 's'}${decs.length ? ` · latest ${esc(String(decs[decs.length - 1].at).slice(0, 16))} — ${esc(String(decs[decs.length - 1].text).replace(/\s+/g, ' ').slice(0, 100))}` : ''}</div>` : '';
  const viaOf = (v) => (v === 'clip' ? 'clip' : 'hand');
  const raw = [...revs.map((r) => ({ at: r.at, sha8: String(r.hash).slice(0, 8), via: viaOf(r.meta && r.meta.via), text: r.text ?? '(revision carries no text)' })),
    ...echoes.map((e) => ({ at: e.at, sha8: String(e.rowSha).slice(0, 8), via: viaOf(e.via), text: '(echo — the same bytes, pasted again)' }))];
  const rawHtml = raw.length ? raw.map((r) => `<div class="rw"><code>${esc(r.sha8)}</code> ${esc(String(r.at).slice(0, 16))} · ${esc(r.via)}<div class="dim">${esc(r.text.slice(0, 280))}${r.text.length > 280 ? '…' : ''}</div></div>`).join('') : '<div class="dim">none — said once, never re-stated</div>';
  const log = [...revs.map((r) => `<div class="rw"><code>${esc(String(r.hash).slice(0, 8))}</code> ${esc(r.at)} · archived${r.ncd != null ? ` · ncd ${esc(r.ncd)}` : ''}</div>`),
    `<div class="rw"><code>${esc(String(n.hash).slice(0, 8))}</code> <b>DECIDED ${esc(n.decidedAt || n.at || '')}</b>${n.supersedes ? ` · supersedes ${esc(String(n.supersedes).slice(0, 8))}` : ' · first and only'}</div>`].join('');
  const hat = !m ? '<span class="dim">Hat: not read — node scripts/vna/spec-tree.mjs</span>'
    : (!n.pixel || !m.hat) ? 'Hat: unmeasured'
      : `Hat: <b>${esc(m.hat)}</b> · rules: ${(m.rules || []).length ? (m.rules || []).map((r) => `«${esc(r.name || r.text.slice(0, 40))}»`).join(' ') : `<span class="dim">${esc(m.rules_from || 'none')}</span>`}`;
  const cmd = `node scripts/vna/spec-tree.mjs --bundle ${n.id}`;
  // [COMMITTED] / [OPEN] only for a leaf that names a checklist item (C\d+) — read from SPEC-VNA-COCKPIT.md's
  // own boxes; a paragraph that names no item carries no tag rather than 400 [OPEN]s
  // the item id is the HEAD of the headline (optionally after a bullet, a box or a §), followed by a word —
  // never a C-token inside a coordinate like B2,C2 (that matched a ticked C2 and tagged a coordinate COMMITTED)
  const cid = /^(?:[-*]\s*)?(?:\[[ xX]\]\s*)?(?:§[\d.]+\s*)?(C\d{1,3})\s+[A-Za-z]/.exec(n.content.headline || '');
  const tag = cid && ticked ? (ticked.has(cid[1]) ? ' [COMMITTED]' : ' [OPEN]') : '';
  const M = n.mass || null, P = M && M.provenance ? M.provenance : null;
  const hhmm = (iso) => String(iso || '').slice(11, 16);
  const snips = raw.length ? raw.map((r) => `<details class="sn" id="sn-${esc(String(r.sha8 || ''))}"><summary>▶ [${esc(hhmm(r.at))} · +${esc(fmtB(r.text.length))} · ${esc(r.sha8)} · ${esc(r.via)}] "${esc(r.text.slice(0, 60))}${r.text.length > 60 ? '…' : ''}"</summary><pre>${esc(r.text)}</pre></details>`).join('') : '<div class="dim">      none — said once, never re-stated</div>';
  return `<details class="lf" id="lf-${esc(String(n.hash || '').slice(0, 8))}"><summary title="${esc(n.content.text)}">▶ ${num ? `§${esc(num)} ` : ''}${esc(n.content.headline)}${tag} <span class="dim">(${M ? `${fmtK(M.chars)} chars · ${snipWord(M.snippets)} · gzip ${fmtB(M.gzip)}` : 'mass not in receipt'})</span></summary>
   <div class="l3">
    <div class="k">├─ Spec Contract: ${M ? `${M.chars} chars · gzip ${fmtB(M.gzip)}` : '—'} · ${badge}</div>
    <div class="k">├─ Provenance Mass: ${P ? `${snipWord(M.snippets)} · ${fmtK(P.chars)} chars · gzip ${fmtB(P.gzip)} (ρ ${P.ratio.toFixed(2)})` : '—'}</div>
    <div class="k">├─ Merkle: <code>${esc(String(n.hash).slice(0, 8))}</code>… · ${n.pixel ? `Walk: ${px}` : 'Walk: <span class="rr">UNMEASURED</span>'}</div>
    ${lineageHtml ? `<div class="k">├─ ${lineageHtml.replace(/^<div class="k">|<\/div>$/g, "")}</div>` : ""}
    <div class="k">├─ ${hat}</div>
    <div class="k">└─ Snippets:</div>${snips}
    <pre>${esc(n.content.text)}</pre>
    <div class="k"><b>decisions log</b></div>${log}
    <div class="k"><b>bundle</b> · <code>${esc(cmd)}</code> <button class="mini" onclick="cp('b_${esc(n.id)}',this,'📋')" title="copy the bundle command for this node — paste it in a terminal to print the node's snowball (its text, decisions, parents to the root) for a chat">📋</button><textarea id="b_${esc(n.id)}">${esc(cmd)}</textarea></div>
   </div></details>`;
}
// ── C178 THE PAINTER READS EVERY ROW'S GUARD AGAINST THE IMMUTABLE COMMIT, NEVER THE WORKING TREE (operator 2026-09-22,
// verbatim: "Missing Guard Check (C178): Paint open rows RED if their guard file is missing on disk."). C53c's borneOut()
// answers "is there a guard on disk" — a room's own uncommitted file passes that check and paints GUARDED/BUILT there while
// every other room, and CI, and the guard itself once someone else commits, sees nothing at all. This wraps it with the one
// fact that survives a `git clone`: `git cat-file -e HEAD:<path>` (AXIOM 1's W3 — a checkpoint reads a record the actor did
// not author). MEASURED 2026-09-22: of the 17 open rows on the operator's list, 14 have no guard on disk; C173a was ticked
// at aae08ebbdb while its guard sat UNTRACKED (committed together with this row).
//   · an OPEN row with no guard in HEAD (none named, or named but not committed) → RED, why "guard not written"
//   · a TICKED row with no guard in HEAD → RED, why "ticked without a committed guard" — the C173a incident, exactly
// A registry row (C53c's receipt-graded states — MEASURED / MEASURED-HELD / MEASURED-BROKEN / …) is untouched: that door is
// a different, stricter claim than the row's own inline `(guard: …)`, and this wraps only the simpler one. NOTHING HERE
// UN-TICKS A ROW — it detects and places; withdrawing a tick stays spec-check.mjs's door alone (C26), never a render.
//
// ONE `git ls-tree` PER RENDER, NEVER ONE `git cat-file` PER ROW. The first shape here spawned a subprocess per guarded
// row — 474 rows, several hundred without a committed guard — and pushed a plain `--no-open` render from well under the
// T10 guard's 120 s budget to 2:23, timing the guard out. `git ls-tree -r --name-only HEAD` is exactly as much truth (the
// full set of paths tracked at HEAD) in one call; membership after that is a Set lookup. Cached per repo for the process.
let _headTrackedCache = null;
function headTrackedPaths(repo) {
  if (_headTrackedCache && _headTrackedCache.repo === repo) return _headTrackedCache.set;
  let set = new Set();
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    set = new Set(out.split('\n').filter(Boolean));
  } catch { /* not a git repo, or HEAD unborn — every guard reads as untracked, which is the honest answer */ }
  _headTrackedCache = { repo, set };
  return set;
}
export function guardTrackedAtHead(rel, { repo = REPO } = {}) {
  if (!rel) return false;
  return headTrackedPaths(repo).has(rel);
}
export function borneOutAtHead(label, node, { registry = {}, text = '', repo = REPO, trackedAtHead = guardTrackedAtHead } = {}) {
  const base = borneOut(label, node, { registry, repo });
  if (registry[label]) return base;   // C53c's receipt-graded door — a different, more rigorous claim than C178 checks
  const done = !!(node && node.meta && node.meta.done);
  const g = rowGuardOf(text);
  if (g && trackedAtHead(g, { repo })) return base;
  const why = done ? `ticked without a committed guard${g ? ` — ${g} is not in HEAD` : ' — no guard named'}` : `guard not written${g ? ` — ${g} is not in HEAD` : ''}`;
  return { state: 'RED', receipt: g, verdict: null, why };
}
// the ticked checklist items, set by main() from SPEC-VNA-COCKPIT.md before the page renders; a module
// value rather than an argument so the rail call stays the literal the page guard reads
let TICKED = null;
function renderSpecOverview(t, { ticked = TICKED } = {}) {
  if (t.missing) return miss(t);
  const N = t.nodes || {};
  // T11: a retracted node is marked in the receipt, never erased; the rail does not show it
  const leaves = Object.values(N).filter((n) => n.id !== 'root' && !(n.children && n.children.length) && !n.retracted);
  const CARD = { A: 'Strategy', B: 'Tactics', C: 'Operations' };
  // the horizon and branch numbers are READ from the receipt's lanes (spec-tree.mjs laneReceipt): nodes,
  // in-lane (the walk admitted it), chars → gzip, snippets. Horizons stay in ShortLex order; branches
  // inside a horizon are ordered by gzip mass descending — the heaviest branch first is the overview.
  const L = t.lanes || null;
  const out = [];
  if (!L) out.push('<div class="miss">lanes not in the receipt — re-run <code>node scripts/vna/spec-tree.mjs</code></div>');
  let bn = 0;   // § numbering: branch ordinal across the overview, leaf ordinal within the branch
  for (const c of ['A', 'B', 'C']) {
    const inCard = leaves.filter((n) => n.pixel && rowLane(n.pixel)[0] === c);
    const lane = L && L[c] ? L[c] : null;
    const branches = lane ? Object.entries(lane.branches || {}).sort((x, y) => y[1].gzip - x[1].gzip) : [];
    out.push(`<details class="l1" id="l1-${c}" open><summary>▼ [${c}] ${CARD[c]} (${lane ? massLine(lane) : `${inCard.length} nodes`})</summary>${
      branches.map(([px, b]) => { bn++; const col = b.col || px.split(',')[1]; return `<details class="l2" id="l2-${esc(String(px).replace(/[^A-Za-z0-9]+/g, '-'))}"><summary>▶ [${esc(px)}] ${esc(LANE[col] || col)}${b.domain ? ` — ${esc(b.domain)}` : ''} (${massLine(b)})</summary><div class="tr">${inCard.filter((n) => n.pixel === px).map((n, i) => renderLeaf(n, t, { num: `${bn}.${i + 1}`, ticked })).join('')}</div></details>`; }).join('') || '<div class="dim">nothing landed in this horizon</div>'}</details>`);
  }
  const un = leaves.filter((n) => !n.pixel);
  // T5: snips the band could not place — ambiguous between two leaves — sit here with their why, never guessed
  const snips = (t.unplacedSnips || []).map((u) => `<div class="lf"><code>${esc(String(u.hash || '').slice(0, 8))}</code> <span class="ty ty-${esc(u.type || 'intent')}">${esc(u.type || 'intent')}</span> ${esc(String(u.text || '').slice(0, 80))}… · <span class="rr">${esc(u.why || 'abstained')}</span> · ${esc(String(u.at || '').slice(0, 16))}</div>`).join('');
  out.push(`<details class="unplaced amber" id="l-unplaced"><summary>unplaced — the walk refused (${t.unplaced ? massLine(t.unplaced) : `${un.length} nodes`})</summary><div class="tr">${un.map((n) => `<div class="lf"><code>${esc(String(n.hash).slice(0, 8))}</code> <span class="ty ty-${esc(n.type)}">${esc(n.type)}</span> ${esc(n.content.headline)} · <span class="rr">UNMEASURED</span> · Hat: unmeasured</div>`).join('') + snips || '<div class="dim">none</div>'}</div></details>`);
  return out.join('');
}

// ── THE TWO TIMERS (operator 2026-09-17: "a timer since claude code was notified that the spec has
// been changed by paste or otherwise"). Painted from receipts; the only arithmetic is a subtraction
// from now. "spec changed" is the newest of three dated facts — the last amendments.ndjson row's
// `at` (a paste or a typed append), SPEC-VNA-COCKPIT.md's mtime (by hand), spec-tree.json's mtime (by
// tree) — and the line names which one won. "Claude notified" is the last row of
// .thetacog/vna-steer-surfaced.ndjson, which steer-hook.mjs writes only when an amendment was put into
// a Claude turn; a surfacing OLDER than the change is the honest state NOT YET NOTIFIED, and no
// surfacing file at all is not-run. The page is static, so every age is as-of-render and says so.
export const fmtAge = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};
export function specTimers({ ledgerAt = null, ledgerRow = null, specAt = null, treeAt = null, surfacedAt = null, surfacedRows = [], surfacedExists = false, now = Date.now() } = {}) {
  const cands = [];
  if (ledgerAt) cands.push({ at: ledgerAt, by: `by paste · row ${ledgerRow ?? '?'}` });
  if (specAt) cands.push({ at: specAt, by: 'by hand · SPEC md' });
  if (treeAt) cands.push({ at: treeAt, by: 'by tree' });
  let changed = null;
  for (const c of cands) { const t = Date.parse(c.at); if (Number.isFinite(t) && (!changed || t > changed.t)) changed = { ...c, t }; }
  const sAt = surfacedAt ? Date.parse(surfacedAt) : NaN;
  let notified;
  if (!surfacedExists || !Number.isFinite(sAt)) notified = { state: 'not-run' };
  else if (changed && sAt < changed.t) notified = { state: 'waiting', waitingMs: now - changed.t, at: surfacedAt, rows: surfacedRows };
  else notified = { state: 'notified', ageMs: now - sAt, at: surfacedAt, rows: surfacedRows };
  return { changed: changed ? { at: changed.at, by: changed.by, ageMs: now - changed.t } : null, notified, asOf: new Date(now).toTimeString().slice(0, 8) };
}
export function renderSpecTimers(t) {
  const rowsOf = (r) => (r && r.length) ? `row ${r.join(',')}` : 'no row';
  const changed = t.changed ? `spec changed: <b>${esc(fmtAge(t.changed.ageMs))}</b> ago (${esc(t.changed.by)})` : 'spec changed: <span class="dim">no dated change on record</span>';
  const n = t.notified;
  const notified = n.state === 'not-run' ? `<div class="miss">Claude notified: not run — the hook has not surfaced anything yet</div>`
    : n.state === 'waiting' ? `<div class="miss"><b>NOT YET NOTIFIED</b> — ${esc(fmtAge(n.waitingMs))} waiting <span class="dim">(last surfaced ${esc(String(n.at || '').slice(11, 19))}Z · ${esc(rowsOf(n.rows))})</span></div>`
      : `<div class="k">Claude notified: <b>${esc(fmtAge(n.ageMs))}</b> ago (${esc(rowsOf(n.rows))})</div>`;
  return `<div class="k">${changed} <span class="dim">· as of ${esc(t.asOf)}</span></div>${notified}`;
}
// ── WATCHED — the files the loop lives on, first on the page (operator, 2026-09-17: "side panel needs
// to list the watched files (appended by daemon and notify timer) I do not see the timer, only the
// commits, not the time since claude was notified"). One line per file: what it is, its last dated
// fact, who wrote it (CLIPBOARD from the clip marker on the row, HAND otherwise), and how long ago.
// Every age is painted from a timestamp on disk and carries that timestamp in data-at, so the page's
// ticker can advance the DISPLAYED age between re-renders without ever inventing a source time.
// THE HEARTBEAT — pure: four dated facts → one state. STALLED beats STALE beats LIVE. "read" is the
// last row of vna-steer-surfaced.ndjson (the hook put an amendment into a Claude turn); "ingest" is
// the last ledger row for the steer file. A daemon that is armed but not running is its own alarm.
// C89c — the stylesheet as a constant, so a guard reads the 350 px rule without a render; the one number the page used to
// interpolate (the spec bar's width) is a CSS variable the page sets inline (--spec-done).
export const PAGE_CSS = ":root{--bg:#0a0c10;--fg:#d8dee9;--dim:#7b8794;--acc:#4ec9b0;--g:#1e9150;--a:#ffb000;--r:#ff5959;--v:#a56bff}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13.5px/1.55 ui-monospace,Menlo,monospace}\n.wrap{max-width:1500px;margin:0 auto;padding:22px}\nh1{font-size:18px;margin:0 0 3px}.sub{color:var(--dim);font-size:12px;margin-bottom:18px}\n.grid{display:grid;grid-template-columns:minmax(420px,1fr) minmax(420px,1fr);gap:16px}\n@media(max-width:1040px){.grid{grid-template-columns:1fr}}\n.card{border:1px solid #1e242e;background:#0e1218;border-radius:8px;padding:14px;margin-bottom:16px}\n.card h2{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--acc);margin:0 0 10px}\nul{list-style:none;padding:0;margin:0}li{padding:3px 0;border-bottom:1px solid #151a22}\nli.ok{color:var(--g)}li.ok b:before{content:\"✔ \"}li.todo b:before{content:\"☐ \"}\n.miss{color:var(--dim);border:1px dashed #232b36;border-radius:5px;padding:10px;font-size:12px}\ncode{color:var(--acc)}.dim{color:var(--dim)}\ntable.lat{border-collapse:collapse;margin:4px auto}\ntable.lat td{width:26px;height:26px;border:1px solid #161b23;background:#0b0e13}\ntable.lat th.ax{color:var(--dim);font-size:10px;font-weight:400;padding:2px 4px}\ntd.pole{background:#123}td.pole-off{background:#132;outline:1px solid var(--a)}\ntd.drifted{background:var(--a)}td.severe{background:var(--r)}\ntd.peak{background:#2b6cb0}\ntd.centre{background:var(--v);outline:2px solid #fff}td.growth{background:#2a3a2a;outline:1px dashed var(--g)}\n.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:11px;color:var(--dim)}\n.legend i{display:inline-block;width:11px;height:11px;vertical-align:-1px;margin-right:5px;border:1px solid #222}\n.bar{height:6px;background:#151a22;border-radius:3px;overflow:hidden;margin:6px 0 12px}\n.bar i{display:block;height:100%;background:var(--acc);width:var(--spec-done,0%)}\n.rm{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #151a22;font-size:12.5px}\n.rr{color:var(--a)}.ib{color:var(--g)}.up{color:var(--dim)}\nbutton{background:var(--acc);color:#04140f;border:0;border-radius:5px;padding:9px 12px;font:inherit;font-weight:700;cursor:pointer;width:100%}\ntextarea{position:absolute;left:-9999px}\n.hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}button.mini{width:auto;padding:4px 8px;font-size:11.5px}\n.tree{font-size:12px;max-height:520px;overflow:auto}.tree details{margin:2px 0 2px 0}.tree summary{cursor:pointer;padding:2px 0}.tree .tr{margin-left:14px;border-left:1px solid #1e242e;padding-left:8px}\n.lf{padding:2px 0;border-bottom:1px solid #12161d}.lf>summary{white-space:nowrap;cursor:pointer}\n.l3{margin:4px 0 8px 12px;padding-left:8px;border-left:2px solid #2a3340;font-size:11.5px}.l3 pre{white-space:pre-wrap;margin:4px 0;color:var(--fg);background:#0b0e13;padding:6px;border-radius:4px;max-height:220px;overflow:auto}\n.rw{padding:2px 0;border-bottom:1px solid #12161d}.sn{margin-left:22px}.sn>summary{cursor:pointer;font-size:11.5px}.l1>summary{font-weight:700;color:var(--acc);cursor:pointer;padding:4px 0}.l2>summary{cursor:pointer;padding:3px 0 3px 10px}\n.amber>summary{color:var(--a);cursor:pointer;padding:4px 0}.amber{border:1px dashed var(--a);border-radius:5px;padding:2px 8px;margin-top:6px}\n.ty{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;border-radius:3px;padding:0 4px;border:1px solid #2a3340;color:var(--dim)}.ty i{font-style:normal;text-transform:none;letter-spacing:0}\n.ty-invariant{color:var(--r);border-color:var(--r)}.ty-boundary{color:var(--a);border-color:var(--a)}.ty-interface{color:var(--acc);border-color:var(--acc)}.ty-decision{color:var(--g);border-color:var(--g)}.ty-question{color:var(--v);border-color:var(--v)}.ty-section{color:#8fa3bf}\n.k{color:var(--dim);font-size:11.5px}\n.k.meter{display:block;margin-top:3px;padding:3px 6px;border:1px solid #1a2230;border-radius:5px;background:#0e141c;color:#c9d4e3}.k.meter .c3l{display:block;font-size:10.5px;margin-top:2px}\ntable.lat th.card{color:var(--acc);font-size:11px;font-weight:700;letter-spacing:.08em;padding:2px 5px}\ntable.lat th.card .hz{color:var(--dim);font-weight:400;font-size:9px;letter-spacing:0}\ntable.lat td.gt{border-top:2px solid #39424f}table.lat td.gl{border-left:2px solid #39424f}\ntable.lat td.gb{border-bottom:2px solid #39424f}table.lat td.gr{border-right:2px solid #39424f}\ntd.hole{background:repeating-linear-gradient(45deg,#3a1414,#3a1414 3px,#0b0e13 3px,#0b0e13 6px);outline:1px solid var(--r)}\ntd.strand{background:#0e2a24;outline:1px dashed var(--acc)}\n.verdict{font-size:15px;line-height:1.4;margin:0 0 6px}\n.verdict b{color:var(--r)}\ndetails{margin-bottom:16px}\ndetails>summary{cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);padding:7px 0;list-style:none;border-bottom:1px solid #151a22}\ndetails>summary::-webkit-details-marker{display:none}\ndetails>summary:before{content:\"▸ \";color:var(--acc)}\ndetails[open]>summary:before{content:\"▾ \"}\ndetails>.card{margin-top:10px}\n.panels{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}\n@media(max-width:1040px){.panels{grid-template-columns:1fr}}\n.card h3{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--acc);margin:10px 0 5px}\n.panel h3{font-size:11px;text-transform:uppercase;letter-spacing:.11em;color:var(--acc);margin:0 0 8px}\n.panel img{width:100%;image-rendering:pixelated;border-radius:5px;display:block;border:1px solid #1e242e}\n.panel .means{color:var(--dim);font-size:11px;margin-top:8px;line-height:1.45}\n.panel .counts{margin-top:6px;font-size:12px}\n.counts .g{color:var(--g)}.counts .a{color:var(--a)}.counts .r{color:var(--r)}\n.arms{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n@media(max-width:1040px){.arms{grid-template-columns:1fr}}\n.arm{border:1px solid #1e242e;background:#0b0e13;border-radius:6px;padding:11px}\n.arm h3{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--acc);margin:0 0 7px;line-height:1.4}\n.arm .coord{font-size:13.5px;color:var(--v);font-weight:700;margin-bottom:4px}\nul.abst{margin-top:6px;max-height:150px;overflow:auto}\n.norender{padding:26px 10px;text-align:center;color:var(--dim);border:1px dashed #232b36;border-radius:5px;font-size:11px}\n.flow{display:flex;align-items:stretch;gap:4px;margin:4px 0 6px}\n.flow .st{flex:1 1 0;min-width:0;border:1px solid #1a2230;border-radius:5px;padding:5px 7px;background:#0b0e13}\n.flow .st.ok{border-color:#2f8f4e}.flow .st.warn{border-color:#b8860b;background:#161208}.flow .st.bad{border-color:#b03a2e;background:#1a0f0e}\n.flow .stl{font-size:9px;letter-spacing:.12em;color:#556577}\n.flow .stb{font-size:11.5px;color:#e6edf3;margin:2px 0;white-space:nowrap}\n.flow .sts{font-size:10px;color:#7f8ea3;white-space:nowrap}\n.flow .arr{align-self:center;color:#3b4a5e;font-size:11px}\n.badges{display:flex;flex-wrap:wrap;gap:4px 6px;font-size:10.5px}\n.badges .bd{border:1px solid #1a2230;border-radius:10px;padding:1px 8px;color:#a9b7c8;background:#0b0e13;cursor:default}\n.mini.warn{border-color:#b8860b;color:#f0c674}\n.watched .wl{display:grid;grid-template-columns:110px 1fr;gap:2px 8px;padding:3px 0;border-bottom:1px solid #151b24;font-size:11px}\n.watched .wlab{color:var(--dim);letter-spacing:.05em;text-transform:uppercase;font-size:10px;padding-top:2px}\n.watched .wpath{color:#8fa3bf;font-size:10.5px;grid-column:2}\n.watched .wfact{grid-column:2}\n.watched .age{color:var(--v)}\n.ttl{font-size:11px;letter-spacing:.08em;color:#8fa3bf;margin:2px 0 6px}.ttl .name{color:#d8dee9;letter-spacing:0;font-size:12px}.ttl .what{color:#c9d4e3;letter-spacing:0;font-size:11.5px;line-height:1.45;margin:2px 0 1px;white-space:normal}\n.strip{display:flex;flex-wrap:wrap;gap:4px 5px;align-items:center;padding:5px 6px;margin-bottom:6px;border:1px solid #1a2230;border-radius:6px;background:#0b0e13;font-size:10.5px}\n.strip .sl,.mrb .sl{color:#556577;letter-spacing:.1em;text-transform:uppercase;font-size:9px;margin-left:4px}\n.strip .sb,.card3 .sb,.mrb .sb,.card3 .mini,.wb .sb,.hb .sb{font:inherit;font-size:10.5px;padding:2px 7px;border:1px solid #2a3442;border-radius:4px;background:#121821;color:#c9d4e3;cursor:pointer;display:inline-flex;align-items:center;gap:4px;line-height:1.4}\n.strip .sb:hover,.wb .sb:hover,.card3 .sb:hover{border-color:#4a5a70}\n.strip .chk.on,.mrb .chk.on{border-color:#2f8f4e}\n.strip .chk input,.mrb .chk input{margin:0}\n.hb{position:sticky;top:0;z-index:8;padding:6px 10px;margin:0 0 6px;border-radius:6px;font-size:11.5px;border:1px solid #1a2230;background:#0b0e13}\n.hb .avb,.hb .psig{color:var(--dim);margin-left:8px}.hb .avb.warn{color:var(--a)}\n.hb.live{border-color:#2f8f4e}.hb.stale{border-color:#b8860b}.hb.stalled,.hb.dead{border-color:#b03a2e;background:#1a0f0e}\ndetails.g{border:1px solid #1a2230;border-radius:6px;margin:6px 0;background:#0d1117}\ndetails.g>summary{cursor:pointer;padding:7px 10px;font-size:12px;list-style:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap}\ndetails.g>summary::-webkit-details-marker{display:none}\ndetails.g>summary::before{content:\"▸\";color:var(--dim);width:10px}\ndetails.g[open]>summary::before{content:\"▾\"}\ndetails.g>summary b{letter-spacing:.08em;min-width:52px}\ndetails.g .gs{color:#c9d4e3}\ndetails.g>*:not(summary){padding:0 8px 8px}\ndetails.g2>summary{cursor:pointer;color:#8fa3bf;font-size:11px;padding:4px 0}\n.mini{font-size:10px;padding:1px 6px;cursor:pointer}\n.cards3{display:grid;gap:4px;margin:0 0 5px}.card3{border:1px solid #1a2230;border-radius:5px;padding:4px 7px;background:#0e141c}.c3h{font-size:10.5px;color:#c9d4e3;display:flex;align-items:center;gap:6px;flex-wrap:nowrap;white-space:nowrap}.c3h .c3r{margin-left:auto;display:inline-flex;gap:4px;flex:0 0 auto}.c3l{font-size:10.5px;line-height:1.45;margin-top:2px;display:flex;align-items:center;gap:4px 6px;flex-wrap:wrap}.c3l>*{flex:0 0 auto}.c3l.c3t{white-space:nowrap;flex-wrap:nowrap}.card3 .sb{width:auto}.c3l .rs,.c3l .ttl2{flex:1 1 auto;min-width:0;white-space:nowrap}.card3 .runbtn,.card3 .cta{width:auto}.card3 .mini{padding:1px 6px;font-size:10px;width:auto}.card3 .rs{font-size:10.5px}.badge.amber{font:700 10px/1.4 Menlo,monospace;background:#7a5a10;color:#ffe8a8;padding:1px 6px;border-radius:3px;border:1px solid #c99a2e}.ingest .wbc{grid-template-columns:130px 1fr}\n.lb{font:600 10px/1.4 Menlo,monospace;background:#1f3f5f;color:#dfe9f5;padding:0 4px;border-radius:3px}.lane{font-size:10px;padding:0 5px;border-radius:3px}.lane.in{background:#1f5f2f}.lane.off{background:#6f1f1f}.lane.un{background:#333}.measure{font-weight:400;color:#c9d4e3}.action{font-size:11px;padding:2px 10px;cursor:pointer;border-radius:4px;border:1px solid #2a3a4f;background:#16324f;color:#fff;width:auto}.action.abort{background:#5f1f1f}.action.cta{font-weight:600;border-color:#2f6f4f;background:#1f5f3f}.action.mini{font-size:10.5px;padding:1px 7px}.tph.c3t{display:flex;align-items:center;gap:6px;white-space:nowrap}.mrb .card3{width:100%;margin:0}.mrb .ribbon{width:100%}.runbtn{font-size:11px;padding:2px 10px;cursor:pointer;border-radius:4px;border:1px solid #2a3a4f;background:#16324f;color:#fff}.runbtn.abort{background:#5f1f1f}.cta{font-size:11px;font-weight:600;padding:3px 12px;cursor:pointer;border-radius:4px;border:1px solid #2f6f4f;background:#1f5f3f;color:#fff}.more{display:inline-block;flex:0 0 auto}.more[open]{width:100%}.more>summary{display:inline-block;cursor:pointer;font-size:10.5px;color:#8fa3bf;border:1px solid #2a3442;border-radius:4px;padding:2px 7px;background:#121821;list-style:none}.more>summary::-webkit-details-marker{display:none}.more>summary::marker{content:\"\"}.more[open]>summary{color:#c9d4e3;border-color:#4a5a70}.mrb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 0 0;width:100%}.mrb .c3l{width:100%;white-space:normal}.meaning{display:block;margin-top:4px}.meaning>summary{display:inline-block}.ml{font-size:10.5px;line-height:1.4;color:#c9d4e3;width:100%}.legend{width:100%;margin-top:4px}.lr{padding:3px 6px;border-radius:4px;margin:2px 0}.lr.unfinished{background:#3a2a10}.lr.drift{background:#3a1515}.lr.covered{background:#2a2a10}.lx{width:100%;border-top:1px solid #1a2230;padding:2px 0;font-size:10.5px;white-space:nowrap}.nh{color:#dfe9f5}.c-econ{margin:0 0 5px}.c-econ .rk{margin-right:2px}.mainbtn{width:auto}\n.ribbon{margin:0 0 8px;border:1px solid #1a2230;border-radius:5px;padding:4px 6px;background:#0b1017}.rh{font-size:11px;color:#8fa3bf;margin-bottom:3px}.rms{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px}.rm{font-size:11px;line-height:1.4;white-space:nowrap}.rk{color:#5f7391;font-size:10px;letter-spacing:.04em}\n/* C183c — the optimiser rows wrap: .rm is defined twice (flex/space-between + nowrap), which pushed every value past the right edge of the sidebar */\n#optimiser-rail .rm{display:block;white-space:normal;overflow-wrap:anywhere}@media(max-width:560px){.rms{grid-template-columns:1fr}}.ok{color:#7ad38a}\n.triptych{margin:4px 0 8px}.tph{font-size:11px;color:#8fa3bf;margin-bottom:4px}.tps{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.tp{border:1px solid #1a2230;border-radius:5px;padding:4px;background:#0b1017;min-width:0}.tp h3{margin:0 0 3px;font-size:11px;color:#c9d4e3}.tp img{width:100%;height:auto;display:block;image-rendering:pixelated;border-radius:3px}.tp .means{font-size:10px;color:#8fa3bf;line-height:1.35;margin-top:3px}.tp .counts{font-size:10px;margin-top:2px}.tp.ph .ph-box{aspect-ratio:1/1;border:1px dashed #2a3a4f;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#5f7391;text-align:center;padding:6px}\n.rail{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px}\n.rail>details{min-width:280px;max-width:340px;flex:0 0 auto;scroll-snap-align:start;max-height:60vh;overflow-y:auto;border:1px solid #1a2230;border-radius:5px;padding:4px 6px}\n.bo{font:600 10px/1.4 Menlo,monospace;padding:0 4px;border-radius:3px;background:#333;color:#ddd;margin-right:4px}.bo-GUARDED{background:#1f5f2f}.bo-MEASURED-HELD{background:#1f6f4f}.bo-MEASURED{background:#2d5f7f}.bo-BUILT{background:#7f6a1f}.bo-DECLARED{background:#444}.bo-MEASURED-BROKEN{background:#8a2a2a}.bo-UNDERPOWERED,.bo-NOT-WORTH-A-BOUNDARY{background:#6a4a1f}.bo-UNMEASURED{background:#555;color:#eee}.bo-RED{background:var(--r);color:#2a0000}\n.c-cog .mrb .c3l,.c-cog .measure2,.c-cog .spark{white-space:normal;overflow:visible;text-overflow:clip}.wb{border:1px solid #2a3a4f;background:#0e141c}.wbh{margin-bottom:6px}.wbc{display:grid;grid-template-columns:150px 1fr;gap:8px;padding:4px 0;border-top:1px solid #1a2230;font-size:12px}.wbk{color:#8fa3bf;font-size:11px}.wbv{line-height:1.5}.bof{cursor:pointer}.bof.on{outline:2px solid #fff}.speclist li.hide{display:none}\n/* C93d — the cog card's scatter */\n.cogsvg{display:block;width:100%;border:1px solid #1a2230;border-radius:4px;background:#0b1017}.cogsvg .axis{stroke:#2a3442;stroke-width:1}.cogsvg .axl{fill:#7b8794;font-size:9px}.cogsvg .pegl{stroke:#ffb000;stroke-width:1}.cogsvg .dot.chair{fill:#4ec9b0}.cogsvg .dot.runner{fill:#a56bff}.cogsvg .dot.un{fill:none;stroke:#7b8794;stroke-width:1}.cogsvg .dot.um{fill:#555}.cxsvg .cx.ok{fill:#2f6f4f}.cxsvg .cx.warn{fill:#b8860b}.cxsvg .cx.hi{fill:#c0392b}.cxsvg .cx.over{fill:#a56bff}.cxsvg .cx.un{fill:#333}.cxsvg polyline.cxm{stroke:#4ec9b0;stroke-width:1.2}.cxsvg polyline.cxh{stroke:#a56bff;stroke-width:1.2;stroke-dasharray:3 2}.cxsvg .cxpeg{stroke:#4ec9b0;stroke-width:1;opacity:.7}.cxsvg text.cxm{fill:#4ec9b0}.cxsvg text.cxh{fill:#a56bff}.cxwarn{color:#ff5959;font-weight:600}.cxsign{color:#ffb000}.face>button.action .cxp{font-weight:700;padding:0 5px;border-radius:3px;color:#fff}.cxp.ok{background:#1f5f2f}.cxp.warn{background:#7a5a10;color:#ffe8a8}.cxp.hi{background:#8a2a2a;color:#ffd6d6}.cxp.over{background:#5a2a8a;color:#efdcff}.cxp.un{background:#333;color:#bbb}.c-cog .face>button.action .measure{white-space:nowrap}.cogtable{display:flex;flex-direction:column;gap:2px;width:100%;font-size:10px}.cogtable .tr{display:block;white-space:normal;color:#c9d4e3}.cogtable .tr b{color:#4ec9b0;margin-right:4px}.regimes{display:flex;flex-direction:column;gap:2px;width:100%}.regimes .rg{display:flex;align-items:center;gap:6px;font-size:10px;color:#c9d4e3}.regimes .rg i{display:inline-block;height:6px;border-radius:3px;background:#4ec9b0;flex:0 0 auto;max-width:60%}.regimes .rg-chat i{background:#ffb000}.regimes .rg-drift i{background:#ff5959}.regimes .rg b{font-weight:400;white-space:nowrap}\n/* C103d · C103b — the day-one face: one button line per card, the metric on the button, the + beside it; every word behind the + */\n/* C109m.4 — the six T5 sections (Tasks · Feed · Health · Net · Fork · Export) follow the face structure: [▸ +] sticky at the left, then ONE nowrap line in the same box as a face button, scroll sideways for the rest; the body is the drawer under it */\ndetails.g{width:max-content;min-width:100%}details.g>summary{display:flex;flex-wrap:nowrap;overflow:visible;gap:4px 6px;align-items:center;text-transform:none;letter-spacing:0;font-size:11px;padding:4px 7px;border-bottom:0;width:max-content;min-width:100%}details.g>*:not(summary){max-width:calc(100vw - 60px)}\ndetails.g>summary::before{content:\"+\";position:sticky;left:0;z-index:2;flex:0 0 auto;width:auto;font:700 13px/1.2 ui-monospace,Menlo,monospace;color:#8fa3bf;border:1px solid #2a3442;border-radius:4px;padding:2px 8px;background:#121821}\ndetails.g[open]>summary::before{content:\"−\";color:#c9d4e3;border-color:#4a5a70}\ndetails.g>summary>.gface{flex:0 0 auto;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-weight:600;font-size:11px;border-radius:4px;border:1px solid #2a3a4f;background:#16324f;color:#fff;line-height:1.55;min-width:0}\ndetails.g>summary>.gface .gs{font-weight:400;color:#c9d4e3;white-space:nowrap}\ndetails.g>summary>.mini{flex:0 0 auto;white-space:nowrap}\n/* C109m — the + is all the way left (order:-1, DOM order untouched), nothing wraps: make the window bigger or scroll sideways; an OPEN + keeps its summary on the button line and its drawer below, full width */\n/* C119i (operator 2026-09-21, screenshot: the runner face, a tall empty box, the 💳 drawer standing to its RIGHT as a narrow column): a drawer capped at the viewport (max-width on .mrb) FIT BESIDE the face button on the card's 1,446 px line — the wrap never happened, align-items:center dropped the button to the middle of the drawer's height, and the space above it read as an empty card. Cause: display:contents on a <details> is IGNORED by Chromium (UA shadow slots keep the box), so the drawer was never a flex item of the face. An OPEN + is now its own two-column grid on its own line after the button — [−][drawer capped at the viewport]; closed, the + stays at the left. Guard: c109m-plus-left-no-wrap C109m.2. */\n/* C109m.5 — ONE SCROLLER (operator 2026-09-20: \"never put the side panel sections in boundaries, scrolling sideways should scroll all of them uniformly\"): the PAGE scrolls sideways and every row moves together; a face and its card are as wide as their content, never their own scroll box; the three panels and the drawers keep the viewport's width (the .wrap is never max-content — that blew the panels up) */\nhtml,body{overflow-x:auto}.face{display:flex;flex-wrap:nowrap;overflow:visible;gap:4px 6px;align-items:center;width:max-content;min-width:100%}.card3,.hb{width:max-content;min-width:100%}.triptych:not(.card3),.tps,.mrb,.card{width:auto;max-width:calc(100vw - 52px)}details.plus[open]{display:contents}details.plus[open]::details-content{display:block;order:1;flex:1 0 100%;min-width:100%}\n.face:has(details.plus[open]){flex-wrap:wrap}.face>button.action{flex:0 0 auto;text-align:left;white-space:nowrap;padding:4px 10px;font-weight:600}\n.hb .face>label.sb.chk{flex:0 0 auto;white-space:nowrap;padding:4px 10px;font-weight:600;font-size:11px;border-radius:4px;border:1px solid #2a3a4f;background:#16324f;color:#fff;display:inline-flex;align-items:center;gap:4px;line-height:1.55;overflow:visible}\n.hb .face>.measure.live{white-space:nowrap;flex:0 0 auto} .hb .face>.tip{white-space:nowrap;flex:0 0 auto;font-size:10.5px} .apbar{display:flex;align-items:center;gap:6px}.apbar .apk{flex:0 0 auto}.apbar .aptrack{flex:1 1 120px;height:6px;border:1px solid #2a3449;border-radius:3px;background:#0f141c;overflow:hidden}.apbar .aptrack>i{display:block;height:100%;background:var(--acc)} .aprow{display:flex;gap:6px;align-items:center;white-space:nowrap}.aprow input{margin:0}.aphead{margin-top:6px}.hb .face>.tip.warn{color:var(--a)}\n.card3>.c3l.empty{white-space:nowrap;padding:1px 2px 0}.card3>.c3l.empty>.tip.warn{color:var(--a)}   /* C131: the empty-state line under the 💳 face, the live bar's tip-warn colour */\n.face>button.sb.rings{flex:0 0 auto;text-align:left;white-space:nowrap;padding:4px 10px;font-weight:600;font-size:11px;border-radius:4px;border:1px solid #2a3a4f;background:#16324f;color:#fff;width:auto;display:inline-block;line-height:1.55}.face>button.action .measure{font-weight:400;color:#c9d4e3}.face>button.action code{color:#8fd3c4}.face>button.action .lb,.face>button.action .lane,.face>button.action .badge{font-weight:600}details.plus{display:inline-block;flex:0 0 auto;margin:0;order:-1;position:sticky;left:0;z-index:2}\ndetails.plus>summary::before,details.plus[open]>summary::before{content:\"\"}details.plus>summary{order:-1}details.plus>summary{position:sticky;left:0;z-index:2;display:inline-block;box-sizing:border-box;width:27px;text-align:center;cursor:pointer;font:700 13px/1.2 ui-monospace,Menlo,monospace;color:#8fa3bf;border:1px solid #2a3442;border-radius:4px;padding:2px 8px;background:#121821;list-style:none}details.plus>summary::-webkit-details-marker{display:none}details.plus>summary::marker{content:\"\"}details.plus[open]>summary{color:#c9d4e3;border-color:#4a5a70;font-size:0}details.plus[open]>summary::after{content:\"−\";font-size:13px}details.plus>.mrb{padding:0;min-width:0;max-width:calc(100vw - 60px)}.spark{color:#8fa3bf;font-size:10.5px;font-weight:400;text-transform:none;letter-spacing:0}.c-next .face{border-left:2px solid var(--acc);padding-left:4px;margin-left:-6px}.c-next .measure{white-space:normal}.c-next .loop,.c-next .check{width:100%;font-size:10.5px}.c-next .why{color:#8fa3bf;font-weight:400;text-transform:none;letter-spacing:0}.triptych .tps{margin-bottom:6px}.mrb .tps,.mrb .counts{width:100%}.tph.c3t{white-space:normal}.tp .ph-box{min-height:60px}\n/* C89c — the two gates' second half: under 350 px the action rows stack and the secondary .sb buttons fold behind ⋮ — EXCEPT a pill's face (.c3l.face), which keeps C109m's one nowrap line: stacked, the button went 100 % wide and its measure fell under it as a bare · (Cursor's sidebar, 2026-09-22) */\ndetails.ctx{display:inline}details.ctx:not([open])>.ctxb{display:inline}details.ctx>summary{display:none;list-style:none;cursor:pointer;font-size:12px;padding:0 6px;border:1px solid #2a3a4f;border-radius:4px}details.ctx>summary::-webkit-details-marker{display:none}\n/* C126 (operator 2026-09-21, three screenshots: \"buttons need to be reasonablely wide … all buttons\"; measured at 420 px: 🔄 refresh and ↗ Open the steer file were each 1,775 px and teal, the live line 5,033 px): the bare `button{width:100%}` default reached the live line's doors (under .hb, not .card3/.strip/.mrb/.wb, so the .sb box never applied) — 100 % of a max-content face IS the face, and two of them doubled it. A face button is as wide as its words, never wider; the default stays for the lone card buttons. Guard: c126-face-buttons-intrinsic-width */\n.face button{width:auto}\n@media (max-width: 350px){.c3l{flex-direction:column;align-items:stretch}.c3l .action,.c3l .sb,.c3l details.more{width:100%;box-sizing:border-box}details.ctx>summary{display:inline-block}details.ctx:not([open])>.ctxb{display:none}.c3l.face{flex-direction:row;align-items:center}.c3l.face>.action,.c3l.face>.sb,.c3l.face>details.more{width:auto}}\n/* C141 THE NINE PILLS: the four indented pills and the 💳's empty-state line share ONE indent — the + column's width plus the face gap (--indent), so a child line starts under its parent's button, never under its + */:root{--indent:33px}.card3.pill.indent{margin-left:var(--indent);min-width:calc(100% - var(--indent))}.card3.pill.indent.deep{margin-left:calc(2 * var(--indent));min-width:calc(100% - 2 * var(--indent))}\n/* C172 THE TOGGLE HOLDS ITS BOX (operator 2026-09-22: \"the plus and minus sign needs to be in the same position, right now the minus moves\"): the + is 27 px wide in both states (--indent = 27 + the 6 px gap) and an OPEN + is display:contents — its summary stays the face's first flex item, in the + slot, and ::details-content drops to its own line (flex 1 0 100%, min-width 100% forces the break) with the drawer capped at the viewport. Replaces C119i's [−][drawer] grid, which put the − on the drawer's line below the pill. Chromium ignored display:contents on <details> before 131; VS Code (148) and Cursor (144) are past it — measured at 420 px by c172's guard: the toggle, the button and the metric keep their rects open vs closed. */\n/* C200 — a pill nested inside another pill's + (the 🔑 licence inside 💳): full width of the drawer, the indent is the parent's, a hairline above so it reads as a row of the drawer */.mrb .card3.pill.nested{width:max-content;min-width:100%;margin:4px 0 0;flex:0 0 auto}.mrb .card3.pill.nested>.c3l.face{width:max-content;min-width:100%;white-space:nowrap}/* the face keeps C109m.5's max-content width inside the drawer — `.mrb .c3l{width:100%}` would clip it to the drawer and wrap its lead button when its own + opens (C172.1 measured: button x 395.5 → 71) */\n/* C161 — the key box at the top while no key is held: a form line, not a pill */.keybox{display:flex;gap:6px;align-items:center;margin:0 0 6px;padding:6px 7px;border:1px solid #2f6f4f;border-radius:5px;background:#0e1a14}.keybox input{flex:1 1 200px;min-width:120px;font:11px ui-monospace,Menlo,monospace;padding:4px 8px;border:1px solid #2a3442;border-radius:4px;background:#0b0e13;color:#d8e6da}.keybox .sb{background:#1f5f3f;border-color:#2f6f4f;color:#fff;font-weight:600}.card3>.c3l.empty{flex-direction:row;align-items:center;gap:4px 6px}.card3>.c3l.empty::before{content:\"+\";visibility:hidden;flex:0 0 auto;font:700 13px/1.2 ui-monospace,Menlo,monospace;border:1px solid transparent;padding:2px 8px}.measure.live .hbstate{font-weight:700}.face>button.action .wit{font-weight:700}\n/* C150 THE LEAD FLOATS ON EVERY LINE (operator 2026-09-21: \"keeping the + floating is perfect — when you scroll, the lead button on the pill sticks so as you scroll you see which row you are on … the button if actionable is first, or a identity loop connection — would be the floating part\"; then, screenshot of 💳 scrolling under the +: \"the pill button needs to float like this because the action button is on the same element as the - sign\"): ONE rule for the construct — the line's lead (the curated action button, the checkbox label, the rings button; on a line with no button the bold identity term) is sticky beside the + column, with its own background so the scrolling text passes under it. left = --indent, the + column's width plus the face gap, the same constant the indented pills use. */\n.face>button.action,.face>label.sb.chk,.face>button.sb.rings,.lx>b.lead{position:sticky;left:var(--indent);z-index:1}.ml>b:first-child,.legend .lr>b:first-child,.c3l.dim>b:first-child{position:sticky;left:0;z-index:1;background:var(--bg);padding:0 6px 0 2px}.face>button.action,.face>label.sb.chk,.face>button.sb.rings{box-shadow:-6px 0 0 0 var(--bg)}.lx>b:first-child,.ml>b:first-child,.legend .lr>b:first-child,.c3l.dim>b:first-child{background:var(--bg);padding-right:4px}\n/* C149 NO BOUNDED PILL (operator 2026-09-21: \"this breaks the scroll to read to the right rule, its a bounded pill\"): no line class clips — overflow hidden and the ellipsis left .c3l.c3t · .c3h · .tph.c3t · .lx · .rm · .lf>summary · .flow .stb/.sts · .c3l .rs/.ttl2; the line runs its full width and the PAGE scrolls sideways (C109m.5); the only clips are the two gauges (.bar · .aptrack) */\n/* C167h SKEW-SAFE DOORS — a control whose command this running window did not register (an older installed build than the source that rendered the page) dims instead of toasting \"not registered\" on click */\n.skew-dim{opacity:.45;cursor:not-allowed;filter:grayscale(60%)}\n/* C204 — the open spec as a work list: a row expands on a click of its line (never a nested <details>), its id is the door to the spec line */.wlist{width:100%}.wl-row{display:block}.wl-row .wl-x{display:none;margin:0 0 4px 22px}.wl-row.open .wl-x{display:block}.wl-h{cursor:pointer;white-space:nowrap}";
export const STALL_MS = 30000;
// BUILD LAG (operator 2026-09-18: the window ran extension 0.3.8 under source 0.3.11 for a day and every RUN-row button toasted
// "not registered in this window"; nothing on the strip said which build the window held). Pure: the INSTALLED version rides
// VNA_EXT_VERSION into every repaint (auth-manager entitlementEnv), the SOURCE version is the package's; LAG names both and
// hands over the reinstall command + the one-click reload; a CLI repaint that knows no window says UNKNOWN, never MATCH.
export function buildLag({ ext = process.env.VNA_EXT_VERSION || null, code = process.env.VNA_EXT_CODE_VERSION || null, source = null } = {}) {
  if (source == null) { try { source = JSON.parse(readFileSync(resolve(REPO, 'packages/thetacog-mcp-vscode/package.json'), 'utf8')).version || null; } catch { source = null; } }
  const install = `cd packages/thetacog-mcp-vscode && npm run compile && npx @vscode/vsce package --allow-missing-repository --no-dependencies && code --install-extension thetacog-mcp-${source || '?'}.vsix --force`;
  const reload = `<button class="mini warn" onclick="go('vna.reloadWindow')" title="${esc('Developer: Reload Window re-reads the manifest (views, titles, activation events) the window registered when it opened; Restart Extensions restarts only the host process and cannot — a webview whose id changed underneath a stale window spins forever')}">↻ Reload Window</button>`;
  if (!ext) return { state: 'UNKNOWN', ext, code, source, html: `<span class="dim" title="a CLI repaint does not know the window's build; the extension stamps VNA_EXT_VERSION and VNA_EXT_CODE_VERSION on its own repaints">ext build not reported · source ${esc(source || '?')}</span>` };
  // C124 — three versions, three remedies. window = what the renderer registered at window load; code = the package.json beside the
  // out/ the host actually loaded; source = what the repo would package next. (2026-09-20: window 0.3.19 · code 0.3.25 · source 0.3.25
  // = a blank pane that survived Restart Extensions; only Reload Window fixes that, and reinstalling would have changed nothing.)
  if (code && ext !== code) return { state: 'WINDOW-STALE', ext, code, source, html: `<b class="rr pill">🪟 Window stale (window ${esc(ext)} · code ${esc(code)} · source ${esc(source || '?')})</b> ${reload} <span class="dim">Restart Extensions cannot fix this — the window's view registry is read once, at window load</span>` };
  if (code && code !== source) return { state: 'INSTALL-STALE', ext, code, source, html: `<b class="rr pill">📦 Install stale (code ${esc(code)} · source ${esc(source || '?')})</b> <code title="${esc(install)}">rebuild · package · install</code> <span class="dim">then ↻ Reload Window</span> <button class="mini" onclick="cp('c124inst',this,'⧉')" title="${esc(install)}">⧉ copy the command</button><textarea id="c124inst">${esc(install)}</textarea>` };
  if (ext === source) return { state: 'MATCH', ext, code, source, html: `<span class="dim">ext ${esc(ext)}</span>` };
  // no code version (a pre-C124 window): window vs source only — the remedy is undecidable, so both doors are offered
  return { state: 'LAG', ext, code, source, html: `<b class="rr pill">🚀 Update ready (v${esc(source || '?')} installed · v${esc(ext)} running)</b> ${reload} <span class="dim" title="${esc(install)}">if the installed build is older than the source, reinstall first</span>` };
}
// C98h — THE HEARTBEAT'S THREE FACTS, READ FROM RECEIPTS (the eighth paste, 2026-09-19): 📥 ingest = the walk tape's last row
// (.thetacog/walk-tape.ndjson — the ingest the instrument last recorded, any source); 🤖 read = the hook's last read
// (.thetacog/vna-steer-surfaced.ndjson — steer-hook.mjs's receipt when it surfaces the tree into a Claude turn); HEAD = git's
// HEAD against the commit the tape last ingested (the newest commit-reality row's `ref`; the tree's own `ingested` field is a
// list of ledger-row sha256s, never a git sha). Each fact carries the command that produces its receipt, so an absent one
// prints `not run — <command>` for itself only — never `never`, never `unknown`. Pure over the paths it is handed.
export const HEARTBEAT_PATHS = Object.freeze({ walkTape: process.env.PMU_WALK_TAPE || resolve(REPO, '.thetacog/walk-tape.ndjson'), surfaced: process.env.VNA_STEER_SURFACED || resolve(REPO, '.thetacog/vna-steer-surfaced.ndjson') });
export const HEARTBEAT_CMDS = Object.freeze({ ingest: 'node scripts/vna/cockpit.mjs', read: 'node scripts/vna/steer-hook.mjs', head: 'git rev-parse HEAD' });
// C211 (operator 2026-09-23, on 🔴 STALLED beside "📥 ingest 1m 1s ago": "why is ingest working and still stalled? backlog of walks /
// merkle?"): neither. STALLED compared the tape's last row of ANY source (every prompt, lens, commit and transcript row lands there)
// against the hook's last read of a STEER-FILE paste, so any activity at all read as a stall while no paste was waiting. The ingest
// AGE stays the tape's liveness (C98h); the stall now reads its own fact — pasteAt, the newest ledger row that is a paste (source not
// `transcript:…`), off a bounded 4 MB tail of amendments.ndjson — the only thing the hook's read is owed.
export function lastPasteAt(ledger = INGEST_PATHS.ledger) {
  try { const r = tailRows(ledger, 4 * 1024 * 1024); for (let i = r.length - 1; i >= 0; i--) { const x = r[i]; if (x && x.at && !String(x.source || '').startsWith('transcript:')) return x.at; } } catch {}
  return null;
}
export function heartbeatFacts({ walkTape = HEARTBEAT_PATHS.walkTape, surfaced = HEARTBEAT_PATHS.surfaced, ledger = INGEST_PATHS.ledger, repo = REPO, now = Date.now() } = {}) {
  // C119g — the walk tape is read from its TAIL (walk-tape-read.mjs): a whole-file read threw at Node's string ceiling on 2026-09-21 and the
  // header read the tape as empty (ingestAt null, walked null) while the tape was 547 MB and alive. The last row is in the last few MB;
  // the last commit-reality row is found by walking back in chunks until one appears, bounded at 128 MB, never the whole file.
  const rows = (path) => { try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const tailTape = (() => { try { return tailRows(walkTape, 4 * 1024 * 1024); } catch { return []; } })(); const last = tailTape[tailTape.length - 1] || null;
  const commitRow = [...tailTape].reverse().find((r) => r.source === 'commit-reality' && r.ref) || (() => { try { const r = tailRowsSince(walkTape, 0, { filter: (x) => x && x.source === 'commit-reality' && x.ref, maxBytes: 128 * 1024 * 1024, stopWhen: (kept) => kept.length > 0 }).rows; return r[r.length - 1] || null; } catch { return null; } })();
  const surf = rows(surfaced); const read = surf[surf.length - 1] || null;
  const git = (args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const sha = git(['rev-parse', 'HEAD']);
  const walked = commitRow ? String(commitRow.ref) : null;
  const behindS = sha && walked ? git(['rev-list', '--count', `${walked}..HEAD`]) : null;
  const behind = behindS != null && /^\d+$/.test(behindS) ? Number(behindS) : null;
  return {
    ingestAt: last && last.ts ? last.ts : null, pasteAt: lastPasteAt(ledger), readAt: read && read.at ? read.at : null, behind, head: sha, walked, now,
    ingest: { at: last && last.ts ? last.ts : null, cmd: HEARTBEAT_CMDS.ingest },
    read: { at: read && read.at ? read.at : null, cmd: HEARTBEAT_CMDS.read },
    head: { sha, sha7: sha ? sha.slice(0, 7) : null, walked, behind, cmd: HEARTBEAT_CMDS.head, ingestCmd: HEARTBEAT_CMDS.ingest },
  };
}
/** C109n — the auto-paste toggle, one painter: the live line's control and (until C109n lands fully) the runner feed tier */
// C113n (operator 2026-09-20: "the auto paste auto re engages when you remove the check, why?"): the handler used to call vna.clipArm on
// EVERY change, so an untick re-armed on the next repaint; tick arms, untick disarms (vna.clipDisarm, registered in vna-clip.ts)
// C130: the auto-paste NAME is one painter — 🟢/⚪ read off the clip receipt (armed), never typed — used by the toggle on the live line and
// by the feed drawer's face (its T5 name, the compiled cluster's noun for that drawer)
export const clipName = (clip) => `${clip && clip.armed ? '🟢' : '⚪'} auto-paste`;
export function clipToggle(clip) {
  const armed = !!(clip && clip.armed);
  return clip
    ? `<label class="sb chk ${armed ? 'on' : ''}" title="${armed ? `every ⌘C appends to the steer file (clip-watch daemon${clip.daemon ? ' pid ' + esc(String(clip.daemon)) : ''}); untick to stop reading the clipboard; next: 🌳 fold → tree` : 'tick to start clip-watch: every ⌘C appends to the steer file under a clip stamp; next: copy a paragraph'}"><input type="checkbox" ${armed ? 'checked' : ''} onchange="go(this.checked ? 'vna.clipArm' : 'vna.clipDisarm')"> ${clipName(clip)}</label>`
    : `<label class="sb chk" title="clip-watch has not run; next: tick it and copy a paragraph"><input type="checkbox" onchange="go(this.checked ? 'vna.clipArm' : 'vna.clipDisarm')"> ${clipName(clip)}</label>`;
}
export function heartbeat({ ingestAt = null, pasteAt = undefined, readAt = null, behind = null, head = null, walked = null, daemonPid = null, armed = false, treeAt = null, now = Date.now(), ingest = null, read = null, page = null } = {}) {
  // every age carries data-at so the page ticker advances it between re-renders (the clock stopped when
  // these were plain text — operator, 2026-09-17: "the notify claude works too except the clock is stopped")
  const age = (iso, cmd) => iso ? `<b class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</b> ago` : `not run — <code>${esc(cmd)}</code>`;
  const headSha = typeof head === 'string' ? head : head && head.sha ? head.sha : null;
  // C211: the stall is owed only on a PASTE — pasteAt when the caller read it (null = no paste on the ledger tail), ingestAt otherwise
  const owed = pasteAt === undefined ? ingestAt : pasteAt;
  const ing = owed ? Date.parse(owed) : NaN, rd = readAt ? Date.parse(readAt) : NaN;
  const stalled = Number.isFinite(ing) && (!Number.isFinite(rd) || ing - rd > STALL_MS) && (now - ing > STALL_MS);
  const daemonDead = armed && !daemonPid;
  const state = stalled ? 'STALLED' : (behind != null && behind > 0) ? 'STALE' : 'LIVE';
  const dot = state === 'STALLED' ? '🔴' : state === 'STALE' ? '🟡' : '🟢';
  const headLine = !headSha ? `HEAD not run — <code>${esc(HEARTBEAT_CMDS.head)}</code>`
    : behind == null ? `HEAD <code>${esc(headSha.slice(0, 7))}</code> · not run — <code>${esc(HEARTBEAT_CMDS.ingest)}</code>`
      : behind === 0 ? `<span class="dim" title="the walk tape's last ingested commit is HEAD">HEAD <code>${esc(headSha.slice(0, 7))}</code> · synced</span>`
        : `HEAD <code>${esc(headSha.slice(0, 7))}</code> · <button class="mini warn" onclick="go('vna.steer')" title="⚠️ the tape last ingested ${esc(String(walked || '?').slice(0, 7))}, ${behind} commit${behind === 1 ? '' : 's'} before HEAD; walk the last authored commit now (≈2 s)">behind ${behind} · walk</button>`;
  const parts = [`${dot} <b>${state}</b>`, `📥 ingest ${age(ingestAt, (ingest && ingest.cmd) || HEARTBEAT_CMDS.ingest)}`, `🤖 read ${age(readAt, (read && read.cmd) || HEARTBEAT_CMDS.read)}${stalled ? ' <b>— unconsumed</b>' : ''}`,
    headLine,
    daemonDead ? '<button class="sb warn" onclick="go(\'vna.clipArm\')" title="armed, but no clip-watch daemon holds the pid lock — nothing is reading the clipboard; click to start it (arm starts the daemon, C126b); next: copy a paragraph">❌ CLIP DEAD — armed, no daemon · start</button>' : armed ? `📋 clip ON${daemonPid ? ' · pid ' + esc(String(daemonPid)) : ''}` : '📋 clip off',
    // C113g — the tree reading is a door: the same age, on a button bound to vna.openTree ("do we need to open the tree by link here too?")
    `<button class="sb" onclick="go('vna.openTree')" title="${esc(`open the spec tree in the editor, the age is the last fold's — ${docTooltip('tree')}`)}">🌲 tree · <span class="measure">${treeAt ? age(treeAt) : 'not run — <code>node scripts/vna/spec-tree.mjs</code>'}</span></button>`];   // the reading rides a .measure so the manifest's label is the door's name alone (C102d)
  const sep = ' <span class="dim">·</span> ';
  // C109n — the live line is one card line like the six: the auto-paste toggle is its control, and its metric is the clip state, the
  // two ages and the STALE/behind verdict; HEAD and the tree ride under the + with the doors, the asked-vs-built and the panel signal
  const face = [parts[4], parts[1], parts[2], `${dot} <b>${state}</b>${behind != null && behind > 0 ? ' · ' + headLine.replace(/^HEAD <code>[^<]*<\/code> · /, '') : ''}`].join(sep);
  // C109l: the page's own freshness — when it was rendered and the newest receipt on RECEIPT_PATHS; PAGE STALE when that receipt moved
  // after the render (a watcher missed it, or the render failed and the last page stands). Painted, never gated; 🔄 refresh under the ⋮.
  const pAge = (iso) => `<span class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</span> ago`;
  const pageStale = !!(page && page.renderedAt && page.newest && page.newest.at && Date.parse(page.newest.at) > Date.parse(page.renderedAt));
  const pageFact = page && page.renderedAt ? `<span class="dim" title="C109l — the render's clock against the newest receipt the page reads (RECEIPT_PATHS, one list; the extension watches the same list)">rendered ${pAge(page.renderedAt)} · newest receipt ${page.newest && page.newest.at ? `<code>${esc(page.newest.rel)}</code> ${pAge(page.newest.at)}` : 'not run'}</span>` : '';
  const rest = [headLine, pageFact, parts[5]].filter(Boolean).join(sep);
  // C141/C144: the live line keeps the state dot, the two ages and the behind verdict (pulse); the clip part (parts[4]) is the auto-paste
  // pill's first verifier now (clipLine), painted there, never twice
  // the state is a <span class="hbstate"> here, never a <b>: the controls manifest names a card by its first <b>, and this line's name is AUTO-PASTE (the spark line under its +)
  // the behind verdict is the 🚶 Walk HEAD pill's metric now (C144: the parts fold into the pills they measure) — the pulse keeps the dot and the state word
  const pulse = [`${dot} <span class="hbstate">${state}</span>`, parts[1].replace(/<b class="age"/g, '<span class="age"').replace(/<\/b> ago/g, '</span> ago'), parts[2].replace(/<b class="age"/g, '<span class="age"').replace(/<\/b> ago/g, '</span> ago').replace(/<b>— unconsumed<\/b>/, '<span class="rr">— unconsumed</span>')].join(sep);
  const pulseOut = pageStale ? `${pulse}${sep}<span class="rr" title="C109l — ${esc(page.newest.rel)} changed after this page was rendered; the panel is showing the older reading — 🔄 refresh under the ⋮ repaints from the receipts">⚠️ PAGE STALE · <code>${esc(page.newest.rel)}</code></span>` : pulse;
  return { state, cls: state.toLowerCase() + (daemonDead ? ' dead' : ''), line: parts.join(sep), face, pulse: pulseOut, clipLine: parts[4], rest, stalled, daemonDead, pageStale };
}

// C113i — THE REFRESH IS ON THE LIVE LINE (operator 2026-09-20: "where is the refresh left panel button?"): the .hb strip is one
// exported painter; its face is the auto-paste toggle · the live measure · 🔄 refresh (class `sb refresh`, never bare `sb` — the ⋮
// fold splits on bare sb) · the +; the copy under card 1's ▸ more stays (C103b, nothing removed). Pure over what it is handed.
// C138, the sidebar half (operator 2026-09-21, verbatim: "never miss an opportunity to link to checkout licenses"): ONE painter of the
// checkout door — the 🛒 — on the live line's face and in every card's + drawer (the mid tier). It runs vna.notariseTape, the
// one command that opens thetadriven.com/notarise (auth-manager's deviceDoor 'notarise'; the extension registers no other checkout
// command), so the 🛒 is that door under the shopping label — never a second URL, never a second command. The tooltip names
// CHECKOUT_URL off the register. Class sb buy: inline under the + (a folded link is a missed opportunity), C102d's named exception.
export const buyDoor = () => B('vna.notariseTape', '🛒 Buy licences', `buy licence credits at ${CHECKOUT_URL.replace(/^https:\/\//, '')} — email only, no company fields; the device flow starts here and the key lands in SecretStorage by the poll, one credit stamps one row; next: the 💳 reads credits left`, 'sb buy');
export const refreshDoor = (refreshAge) => B('vna.refreshPage', `🔄 refresh · <span class="measure">${refreshAge}</span>`, 'repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale', 'sb refresh');
// C109b — RELOAD STAYS POSSIBLE (operator, verbatim: "make sure that reload the gui is still possible"): ↻ Reload Window was painted only
// inside buildLag's LAG / WINDOW-STALE html, so at MATCH and at UNKNOWN (every CLI repaint) the command existed in package.json and nowhere
// on the page. This door rides under the auto-paste pill's ⋮ beside 🔄 refresh in EVERY state, plain (class sb reload); the warn mini stays
// inline in the lag span as before. The title says both verbs: a refresh repaints from receipts, a reload remounts the extension host.
export const reloadDoor = () => B('vna.reloadWindow', '↻ Reload Window', 'Developer: Reload Window — remounts the extension host and re-reads the manifest (views, titles, activation events); 🔄 refresh only repaints this panel from the receipts on disk and cannot; use it when a button toasts "not registered in this window" or the pane spins — Restart Extensions cannot fix a stale window; next: click ↻ Reload Window once, then retry the button', 'sb reload');   // C102d.3: one sentence, ends next: …
// C122b — THE CONTEXT PILL CARRIES THE SAVINGS AND THE TIP (operator 2026-09-21: "print the token savings directly on the Context/Auto-paste
// pill as a live health metric … use the secondary metrics line to offer state-aware nudges"). Three pure readers over the receipts the
// template already loads — never typed, never a zero: the last paste's bytes and whether the fold is at the tape (readIngest), the
// window not re-sent (tokenMeter — the ratio off this session, C98c, and the cleared-sessions total when it is above zero), and the
// clear gauge's state; FOLD-FIRST and OVERDUE carry ⚠️ <carried> carried · Tip: + the gauge's own button (gaugeAction), FREE carries nothing.
export function liveFolded(g) {
  if (!g || g.state !== 'MEASURED' || g.bytes == null) return notRun(INGEST_CMD.ledger);
  const bytes = `+${Number(g.bytes).toLocaleString('en-US')} B`;
  const f = g.fold;
  if (!f) return `${bytes} · ${notRun(INGEST_CMD.fold)}`;
  if (f.behind === 0) return `${bytes} folded`;
  if (f.behind == null) return `${bytes} · fold UNMEASURED`;
  return `${bytes} · fold ${f.behind} behind`;
}
export function liveSavings(m) {
  const parts = [];
  if (m && Number.isFinite(m.not_re_sent_pct)) parts.push(`${m.not_re_sent_pct} % of the window not re-sent`);
  if (m && m.saved && Number.isFinite(m.saved.tokens) && m.saved.tokens > 0) parts.push(`${kTokens(m.saved.tokens)} tokens not re-sent over ${m.saved.sessions || 0} session${m.saved.sessions === 1 ? '' : 's'}`);
  if (parts.length) return parts.join(' · ');
  return `not re-sent UNMEASURED — ${esc((m && m.live && m.live.why) || 'no clear gauge yet')}`;
}
export function liveTip(g) {
  if (!g || (g.state !== 'FOLD-FIRST' && g.state !== 'OVERDUE')) return '';
  const carried = g.contextBytes != null ? fmtBytes(g.contextBytes) : 'an unmeasured amount';
  return `<span class="tip warn" title="${esc(`the clear gauge (${g.state}): the transcript this window carries; the tip is the gauge's own action — the same button the tree line paints`)}">⚠️ ${esc(carried)} carried · Tip:</span> ${gaugeAction(g)}`;
}
// ── C141/C144 AUTO-PASTE AND THE HEARTBEAT ARE ONE PILL (operator 2026-09-21, on a render that had split them: "this is an example of
// mangling the signal, auto paste and ingest are one pill at the top level"). The control and the health of the pipe it drives, on ONE line:
//   ☑ 🟢 auto-paste · 🟢 LIVE|🟡 STALE|🔴 STALLED · 📥 ingest <age> · 🤖 read <age> · pid <n> alive | ❌ CLIP DEAD (button) · last clip <age> <bytes>
//   · +<bytes> folded | fold <n> behind · tree <age> · <the window not re-sent>   [tip]   [↗ Open the steer file]   [+]
// The separate .hb line is gone as its own line — this pill IS the sticky heartbeat (position:sticky, the + never scrolls away, C109m.3).
// Its parts fold into the pills they measure: the HEAD/behind verdict rides the 🚶 Walk HEAD metric (renderTriptych's `behind`) and stays
// under this + as the heartbeat's own record; 🌲 tree <age> is the 🌳 Open Tree pill's; 🔄 refresh sits under this pill's ⋮; the build,
// the doors audit, asked-vs-built, the panel signal and the one-shot ⤵ Ingest Clipboard door are under this +. Four verifiers, each off
// its own receipt and `not run — <cmd>` when absent, never a zero (C144): the daemon (clipState.daemon) · the last clip (readClipIngest)
// · the fold against the ledger (readIngest → liveFolded) · the tree's last fold (spec-tree.json mtime). One toggle on the page (clipToggle).
// C141 — ONE PILL SHAPE, ONE PAINTER: every one of the nine is `<div class="card3 c-<x> pill[ indent]"><div class="c3l face">[button][face door][+ …]</div>[under]</div>`
// and behind its + the tiers C103b named — the spark line with the pill's NAME, the face block, the mid tier (the doc door · the ⋮
// secondaries · the facts · the 🛒 checkout line, C138/C139), then ▸ more and whatever the page folds under this pill (`more`)
// C203 — a ⋮ fold is keyed on the commands it holds (or an explicit key), so its id is the same bytes on every render and OPEN_STATE_SCRIPT can restore it
export const ctxKey = (html, key = null) => esc(String(key || [...String(html).matchAll(/go\('([^']+)'/g)].map((m) => m[1]).join("+") || "none").replace(/[^A-Za-z0-9+.-]+/g, "-"));
export const ctxFold = (html, key = null) => (html ? `<details class="ctx" id="ctx-${ctxKey(html, key)}"><summary title="more actions for this card — the secondary buttons, folded on a narrow panel; next: pick one of the secondary actions">⋮</summary><span class="ctxb">${html}</span></details>` : '');   // C89c: the secondaries behind ⋮ · C102d.3: the tooltip ends next: …, same as every other control
export const pillInner = (name, { spark = '', reading = '', face = '', mid = '', drawer = '', doc = null, inline = '', acct = '', more = '', next = '', nested = '' } = {}) =>   // C200: nested = a child pill rendered inside this +, after the name line
  `<div class="c3h c3t"><b>${name}</b> <span class="spark" title="${esc(spark)} — C103e, the tagline; the line is the card's reading">${reading || esc(spark)}</span></div>${next}${nested}<div class="tier fb">${face}</div><div class="tier mid">${doc ? `<span class="c3l">${docDoor(doc)}</span>` : ''}${inline}${mid}<span class="c3l checkout">${buyDoor()}${acct}</span></div>${drawer}${more}`;
export const pillBox = (cls, id, button, { faceDoor = '', under = '', indent = false, deep = false, plusTitle = '', inner = '', beat = '' } = {}) =>   // C172: deep = a sub-pill of an indented pill (two indents) · C173a: beat names the pill for a guard
  `<div class="card3 ${cls} pill${indent || deep ? ' indent' : ''}${deep ? ' deep' : ''}"${beat ? ` data-beat="${beat}"` : ''}><div class="c3l face">${button}${faceDoor}${plusFold(id, plusTitle, inner)}</div>${under}</div>`;
export function pasteVerifiers({ clip = null, clipIngest = null, ingest = null, treeAt = null, now = Date.now() } = {}) {
  const armed = !!(clip && clip.armed); const pid = clip && clip.daemon ? clip.daemon : null;
  const daemon = !clip ? notRun('node scripts/vna/clip-watch.mjs arm')
    : armed && pid ? `pid ${esc(String(pid))} alive`
      : armed ? '<button class="sb warn clipdead" onclick="go(\'vna.clipArm\')" title="armed, but no clip-watch daemon holds the pid lock — nothing is reading the clipboard; click to start it (arm starts the daemon, C126b); next: copy a paragraph">❌ CLIP DEAD · start</button>'
        : 'clip off';
  const last = clipIngest && clipIngest.at ? `last clip <span class="age" data-at="${esc(clipIngest.at)}">${fmtAge(now - Date.parse(clipIngest.at))}</span> ago · ${Number(clipIngest.bytes || 0).toLocaleString('en-US')} B` : `last clip ${notRun(CLIP_INGEST_CMD)}`;
  const fold = liveFolded(ingest);
  const tree = treeAt ? `tree <span class="age" data-at="${esc(treeAt)}">${fmtAge(now - Date.parse(treeAt))}</span> ago` : `tree ${notRun('node scripts/vna/spec-tree.mjs')}`;
  return { daemon, last, fold, tree, line: [daemon, last, fold, tree].join(' <span class="dim">·</span> ') };
}
export function renderLiveLine(hb, { clip = null, refreshAge = 'not run', lagHtml = '', doorsLine = '', doorsDisagree = 0, avbLine = '', clipIngest = null, now = Date.now(), ingest = null, meter = null, gauge = null, entitlement = entitlementFromEnv(), ledger = CREDITS_LOCAL, tapeRows = null, treeAt = null, mid = '', more = '', indent = false } = {}) {
  const sep = ' <span class="dim">·</span> ';
  const H = hb || heartbeat({ now });
  const v = pasteVerifiers({ clip, clipIngest, ingest, treeAt, now });
  const face = `${clipToggle(clip)}<span class="measure live paste" title="C144 — the heartbeat and the four health verifiers on the control's own line, each off its own receipt: the verdict and the two ages (heartbeatFacts) · the daemon pid (clipState) · the last clip's age and bytes (the ingest receipt) · the fold against the ledger (readIngest) · the tree's last fold; then the window not re-sent (C122b, the token meter)">${H.pulse || H.face}${sep}${v.line}${sep}${liveSavings(meter)}</span>${liveTip(gauge)}`;
  const secondaries = `${B('vna.clipIngest', `⤵ Ingest Clipboard · <span class="measure">${clipIngest && clipIngest.at ? `last ${fmtAge(now - Date.parse(clipIngest.at))} ago` : 'not run'}</span>`, 'one click: the clipboard lands on the steer file under a clip stamp, becomes a ledger row, and the fold runs now — the line above then reads what the fold did; next: 📥 Ingest Refined Goal')}${refreshDoor(refreshAge)}${reloadDoor()}`;   // C109b: ↻ Reload Window in every state, after 🔄 refresh
  const foldLine = `<span class="c3l"><span class="lag">${lagHtml}</span> <span class="doors${doorsDisagree === '__DOORS_WARN__' ? doorsDisagree : doorsDisagree ? ' warn' : ''}" title="C105 — the door named is the door opened: every button whose verb is bound (notarise · backup · sync) checked against the command it runs, off the controls manifest this page derives from itself; DISAGREE is painted, never gated — the fix is the row named">${esc(doorsLine)}</span> <span class="avb${/CONTRADICTED/.test(avbLine) ? ' warn' : ''}" title="C106 — asked vs built is a door, not a feeling: every spec row about the left panel or the extension page, read off its tick and its named guard's own result (built · open · UNMEASURED · CONTRADICTED) plus the pending asks not yet rows; read from the door's receipt ${esc(AVB_RECEIPT.slice(REPO.length + 1))}, never computed here — node scripts/vna/asked-vs-built.mjs">${esc(avbLine)}</span> <span class="psig" title="C106 — the panel's copy is maximal comms: every visible line of this page binned as carrying a value (a digit · UNMEASURED · not run · a sha · σ · Δ · %) or as copy; the floor in ${esc(PANEL_FLOOR_FILE.slice(REPO.length + 1))} only falls; OVER FLOOR is painted, never gated — node scripts/vna/panel-signal.mjs --list">__PANEL_SIGNAL__</span></span>`;
  void entitlement; void ledger; void tapeRows;   // C139/C98f: the account state is the 💳 pill's reading — painted there once; this pill's checkout line is the 🛒 alone
  const restSep = ' <span class="dim">·</span> '; const restParts = String(H.rest || '').split(restSep); const headFact = restParts.filter((x) => !/^<button/.test(x)).join(restSep); const restDoors = restParts.filter((x) => /^<button/.test(x)).join('');   // the HEAD line is a fact under the +; the 🌲 tree door joins the ⋮
  const inner = pillInner('AUTO-PASTE', { spark: 'every ⌘C lands on the steer file, becomes a row, and folds into the tree — this line is the heartbeat of that pipe', reading: `· ${H.state || 'UNMEASURED'} · ${v.daemon} · ${v.fold}`, face: `<div class="c3l">${headFact}</div>`, mid: `<span class="c3l">${ctxFold(secondaries + mid + restDoors)}</span>${foldLine}`, more });   // C102d: the secondaries (⤵ Ingest Clipboard · 🔄 refresh · the feed doors) behind ⋮
  return `<div class="card3 c-paste pill hb ${H.cls || ''}${indent ? ' indent' : ''}"><div class="c3l face">${face}${faceDocDoor('bridge')}${plusFold('live', 'the auto-paste line — HEAD and the walk behind it, the tree door, ⤵ Ingest Clipboard and 🔄 refresh, the feed doors, the installed build, the doors audit, asked-vs-built, the panel signal, then the workbench, the ingest receipt and the steer file; next: 🌳 fold → tree when the tape is ahead', inner)}</div></div>`;
}
export const renderPastePill = renderLiveLine;   // C144: one painter, two names — the pill is the live line

// C113b — THE WORKBENCH IS ONE LINE IN THE SAME FORMAT (operator 2026-09-20: "workbench needs the same format, topline stats after
// + button for action … and the sorted buttons need to be -"); supersedes C109q's per-cell folds. Face: [+] [📋→🌳 Paste → Tree ·
// <AT THE TAPE | n ROWS BEHIND> · <n> open · turn x of y]; under the +: the WORKBENCH name line, the doors (🌳 open tree · ⚡ walk),
// the cells the caller hands over (the goal, the next unit, the last seed, the fold) and the borne-out line. Pure over its inputs;
// an absent fold receipt reads not run — <command>, never a zero.
export function renderWorkbench(wb, { now = Date.now(), cells = '', bo = '' } = {}) {
  const f = wb && wb.fold;
  const foldState = !f ? '<span class="miss">not run — node scripts/vna/spec-tree.mjs</span>' : f.behind === 0 ? '<b class="bo bo-GUARDED">AT THE TAPE</b>' : f.behind == null ? '<b class="bo bo-UNMEASURED">UNMEASURED</b>' : `<b class="bo bo-BUILT">${f.behind} ROW${f.behind === 1 ? '' : 'S'} BEHIND</b>`;
  const open = wb && wb.open != null ? `${wb.open} open` : 'open UNMEASURED';
  const g = wb && wb.goal; const turn = g && g.turns ? `turn ${g.turns.used + 1} of ${g.turns.min}–${g.turns.max}${g.turns.over ? ' · OVER BUDGET' : ''}` : 'no /goal';
  const button = primary('vna.pasteToTree', '📋→🌳 Paste → Tree', `${foldState} · ${open} · ${turn}`, 'arm the clipboard, fold every new amendment row into the tree, repaint — the metric is the fold state against the ledger, the open rows and the turn of the /goal; next: 🌳 open tree to read what landed');
  const foldLine = !f ? '<span class="miss">not run — node scripts/vna/spec-tree.mjs</span>' : `last fold <b class="age" data-at="${esc(f.at || '')}">${f.at ? fmtAge(now - Date.parse(f.at)) : '—'}</b> ago by ${esc(f.by || '?')} · ${f.folds} folds`;
  const doors = `${B('vna.openTree', '🌳 open tree', `open the spec tree in the editor — ${docTooltip('tree')}`)} ${B('vna.steer', '⚡ walk', 'run the sensors and repaint')}`;
  return `<div class="card3 c-wb"><div class="c3l face">${button}${plusFold('wb', 'the workbench — the developer\'s four facts from receipts: the /goal and its units, the next unit of work, the last seed, the fold, the borne-out counts, and the doors 🌳 open tree · ⚡ walk; next: 📋→🌳 Paste → Tree when the ledger is ahead of the tree', `<div class="c3h c3t"><b>WORKBENCH</b> <span class="dim">· the developer's four facts, from receipts</span> <span class="wbd">${doors}</span></div><span class="c3l dim wbfold" title="the fold: data/vna/spec-tree-roots.ndjson last row vs the ledger's rows">${foldLine}</span>${cells}${bo ? `<span class="c3l dim wbbo">${bo}</span>` : ''}`)}</div></div>`;
}

// C113f — THE HEADER SAYS WHAT /STEER IS (operator 2026-09-20: "this must explain that /steer is /goal but with the full shebang,
// merkle tree to spec, anti drift with retro snowball sensors to ground your work in how you already do things here"; amended the
// same day on the screenshot: "this is where the /steer command needs to be introduced with the name, the stats are below, /goal
// with specs"). Three lines, one painter: (1) the name — STEER_NAME byte-identical (C109d); (2) the command introduced by name —
// `/steer — ` + §25's sentence byte-identical (C95a) + the shebang; (3) the stats — the receipt count (C106) · LLM-free.
export const STEER_SHEBANG = 'The full shebang: a Merkle tree from the spec to every commit, anti-drift with retro-snowball sensors, grounded in how you already work here.';
// C203 — THE PAGE PRINTS ITS OWN LAST REPAINT AND ITS CAUSE (operator 2026-09-23: "it's not clear one at the auto refreshes. When does
// the UI refresh and is the pattern clear"). The trigger that armed the render is CARRIED IN — VNA_RENDER_CAUSE from the extension's
// coalescer (render-coalesce.ts names the watcher: prompt · amendments · clip · spec-tree · runner · goal · refresh button · preview),
// or `--cause <name>` on the command line — never inferred from the page. A terminal run with neither says `cli`, which is true.
// The age ticks from data-at through the page's own ticker (display only; the timestamp is the render's, written once).
export function renderCause({ env = process.env, argv = process.argv } = {}) {
  const i = argv.indexOf('--cause'); if (i > 0 && argv[i + 1]) return String(argv[i + 1]);
  if (env.VNA_RENDER_CAUSE) return String(env.VNA_RENDER_CAUSE);
  return 'cli';
}
export function repaintLine({ cause, host = null, at = new Date().toISOString() } = {}) {
  return `<div class="k dim repaint" id="repaint-line" title="C203 — when this page was last painted and which watcher armed the render; the cause rides in from the host (VNA_RENDER_CAUSE) or --cause, never inferred">repainted <span class="age" data-at="${esc(at)}">0s</span> ago · cause <b>${esc(cause || 'unnamed')}</b>${host ? ` · host ${esc(host)}` : ''}</div>`;
}

export function renderHeader({ count = '__STEER_TTL__', ext = null, spec = null, trial = null, repaint = '' } = {}) {
  // each line carries its own reading (C106: a line either carries a receipt or is copy): the short form (C95a's slice) with the spec
  // ratio and the trial balance Δ off the last walk beside it; absent readings say not run — <command>.
  // C122a (operator 2026-09-21: "the top of the panel currently opens with a heavy block of text … if this is an operational instrument,
  // that text is in the way of the readouts … wrap the entire introduction into a single, top-level expandable pill"): §25's sentence,
  // the shebang and the tagline ride behind ONE + (id plus-loop — C79a remembers it), the same fold every card has; the line the reader
  // sees is the derived short form + the stats. C113f's three lines are still here in order (name · introduction · count), the
  // introduction folded; C114's tagline follows the /steer line; C116 keeps the count line last.
  const stats = `<span class="dim" title="the spec on the record: rows ticked of rows declared (docs/specs/vna/SPEC-VNA-COCKPIT.md)">· ${spec ? esc(spec) : notRun('node scripts/vna/spec-check.mjs')}</span> <span class="dim" title="the trial balance — Δ off the last walk receipt (data/vna/cockpit.json): performed minus declared">· ${trial ? esc(trial) : notRun('node scripts/vna/cockpit.mjs')}</span>`;
  // C221 — ONLY THE COPY GOES UNDER THE +; THE METRICS STAY ON THE LINE (operator 2026-09-23: "that needs to be under the +", then,
  // when the first attempt folded everything: "you hid the whole thing, we had the important metrics there as one line before").
  // Visible on the line: + · the spec ratio · the trial Δ · red — the METRICS only (operator 2026-09-23, on the render showing
  // exactly that: "is this right?" · "make the right designs stick"; this supersedes C122a's short form on the line). Inside the +:
  // §25's sentence, the shebang and the tagline, then the short-form sentence, the receipts count and the repaint line.
  const copyLead = `<div class="c3l"><span class="what" title="C95a — the derived short form of §25\x27s sentence (STEER_IS_GOAL_SHORT)">${esc(STEER_IS_GOAL_SHORT)}</span></div><div class="c3l dim" title="panel-signal.mjs (C106): every visible line of this page sorted into value / copy at render — a line carries a value when it holds a digit, UNMEASURED, not run, a sha, σ, Δ or %; the count is the page\x27s own, never typed">· ${count} · LLM-free</div>${repaint}`;
  const loop = plusFold('loop', 'the loop — §25\x27s sentence, the shebang and the tagline, then the short form, the receipts count and when this page was painted; next: read the stats beside the +',
    `<div class="c3h c3t"><b>THE LOOP</b> <span class="spark">/steer vs /goal</span></div><span class="c3l what" title="C95a — §25\x27s sentence, byte-identical to the README\x27s (STEER_IS_GOAL); C113f — the shebang (STEER_SHEBANG)">/steer — ${esc(STEER_IS_GOAL)} ${esc(STEER_SHEBANG)}</span><span class="c3l what dim tagline" title="C114 — the instrument named as what it is: column 1 intent (declared), column 2 reality (performed), Δ the trial balance; one constant (DOUBLE_ENTRY_TAGLINE)">${esc(DOUBLE_ENTRY_TAGLINE)}</span>` + copyLead);
  return `<div class="ttl"><b class="name" title="C109d — the name, one constant (STEER_NAME), the same bytes as the page title and the settings page; beside it the installed build (VNA_EXT_VERSION, buildLag)">${esc(STEER_NAME)} · ext ${esc(ext || 'build not reported')}</b><div class="c3l face hdr">${loop}<span class="what">${stats}</span></div></div>`;
}
// C116 — THE APERTURE STRIP, its own line UNDER the header block (painted right after renderHeader in the template — never inside
// it: C113f holds the count line as the header's last line, and this is not a fourth header line but the strip beneath): the tuple
// S_in · F_in · κ · ω as the one line aperture-receipt.mjs prints, read off data/vna/aperture-receipt.json; absent → not run.
// C123e — THE APERTURE IS A WHOLE PILL (operator 2026-09-21: "aperture has to be a whole pill" · "and we need a much better way to show
// it"). The strip was one bare wrapping line under the header (C116); it is now a pill in the cluster's shape — the 🔍 door is the
// .action, its metric says in words what the aperture IS: what the chip looked at (files · bytes · share of the repo) against what
// was declared (intent rows), and whether the aperture matched the ratchet's floor; behind the + the receipt line verbatim (C116's
// bytes, nothing removed), two proportion bars (bytes looked at over every tracked byte; files over every tracked file), the engine
// line (raw → cut ratio · matched · floor) and root · ω. Absent receipt → not run — <command>, never a zero.
export function apertureFaceMetric(r) {
  if (!r) return notRun(APERTURE_CMD);
  const nF = r.reality.rows.length, nI = r.intent.rows.length;
  const pct = r.kappa.pct != null ? `${r.kappa.pct} % of the repo` : 'κ UNMEASURED';
  const verdict = r.matched === true ? (r.admissible === false ? 'below the floor' : 'matched') : r.matched === false ? 'NOT matched' : 'UNMEASURED';
  return `looked at ${nF} file${nF === 1 ? '' : 's'} · ${kBytes(r.kappa.used_bytes)} · ${pct} ↔ declared ${nI} intent row${nI === 1 ? '' : 's'} · ${verdict}`;
}
const kBytes = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(Math.round(b / 100) / 10).toFixed(1)} kB`);
const bar = (num, den, label) => { const p = den > 0 ? Math.max(0.3, Math.min(100, 100 * num / den)) : 0; return `<div class="c3l dim apbar" title="${esc(label)}"><span class="apk">${esc(label)}</span><span class="aptrack"><i style="width:${p.toFixed(2)}%"></i></span></div>`; };
// C123f — THE APERTURE LISTS EVERY ROW (operator 2026-09-21: "the aperture needs to show all the ingest intent reality files, maybe even
// uncheck them — for the active /steer turn, next walk"). Under the pill's +, after the proportions: INTENT — every row the chip was
// handed (path · used bytes · share), REALITY — every file it read at the commit (path · blob sha · used bytes · share), EXCLUDED — every
// file of the commit the aperture skipped (git's binary verdict or the max_files cap), with the receipt's own why. Read off the receipt,
// never re-listed from the tree. Each row carries a checkbox: ticked = in the aperture as walked; the tick is READ-ONLY until C123g
// wires `vna.apertureToggle` (the untick writes data/vna/aperture-exclude.json, the next walk honours it, the receipt records it) — a
// disabled box is a reading, not a door, and says so in its title. C116.2's "never a file list inside the webview" is amended by this row.
// C115z (operator: "we should see which parts of what files are aperture receipts") — spansLabel
// collapses a reality row's spans[] (each {bytes:[start,end], lines:[[a,b],…], chunk_sha}, read
// straight off the receipt, never re-derived here) into one string: "bytes [a,b) · lines a–b …" per
// span, joined, so "what did the chip look at" is answerable to the line without opening the JSON.
const spansLabel = (x) => (Array.isArray(x.spans) ? x.spans : []).map((s) => {
  const b = Array.isArray(s.bytes) ? `bytes [${s.bytes[0]},${s.bytes[1]})` : null;
  const ls = Array.isArray(s.lines) && s.lines.length ? `lines ${s.lines.map((p) => (Array.isArray(p) ? (p[0] === p[1] ? `${p[0]}` : `${p[0]}–${p[1]}`) : p)).join(', ')}` : null;
  return [b, ls].filter(Boolean).join(' · ');
}).filter(Boolean).join(' | ');
export function renderApertureRows(r) {
  if (!r) return '';
  const row = (side, x, checked) => { const spans = spansLabel(x); return `<label class="c3l aprow" title="${esc(`${side} · ${x.path}${x.blob ? ' · blob ' + x.blob : ''} · ${x.used_bytes != null ? x.used_bytes.toLocaleString('en-US') + ' B used' : ''}${x.share_pct != null ? ' · ' + x.share_pct + ' % of this side' : ''}${x.truncated ? ' · TRUNCATED' : ''}${spans ? ' · ' + spans : ''}; the tick reads the aperture as walked — unticking is C123g (not wired yet)`)}"><input type="checkbox" ${checked ? 'checked' : ''} disabled> <code>${esc(x.path)}</code>${x.blob ? ` <span class="dim">${esc(String(x.blob).slice(0, 8))}</span>` : ''} <span class="dim">· ${x.used_bytes != null ? kBytes(x.used_bytes) : '—'}${x.bytes > 0 && x.used_bytes != null ? ` · <b class="infocus" title="C123f — how much of this file the chip had in focus: used bytes over the file's bytes at the commit">${Math.round(100 * x.used_bytes / x.bytes)} % of the file</b>` : ''}${x.share_pct != null ? ` · ${x.share_pct} % of this side` : ''}${x.truncated ? ' · TRUNCATED' : ''}${spans ? ` · <span class="dim spans" title="C115z — which byte/line span of this file fed the walk, read off the receipt">${esc(spans)}</span>` : ''}</span></label>`; };
  const intent = (r.intent && r.intent.rows) || [];
  const reality = (r.reality && r.reality.rows) || [];
  const ex = (r.reality && r.reality.excluded) || {};
  const exPaths = Array.isArray(ex.paths) ? ex.paths : null;
  return `<div class="c3h c3t aphead"><b>INTENT</b> <span class="spark">${intent.length} row${intent.length === 1 ? '' : 's'} the chip was handed${r.intent && r.intent.mode ? ` · ${esc(r.intent.mode)}` : ''}</span></div>${intent.map((x) => row('INTENT', x, true)).join('') || '<span class="c3l dim">no intent rows on the receipt</span>'}<div class="c3h c3t aphead"><b>REALITY</b> <span class="spark">${reality.length} file${reality.length === 1 ? '' : 's'} read at the commit</span></div>${reality.map((x) => row('REALITY', x, true)).join('') || '<span class="c3l dim">no reality rows on the receipt</span>'}<div class="c3h c3t aphead"><b>EXCLUDED</b> <span class="spark">${exPaths ? `${exPaths.length} of the commit's files the aperture skipped` : 'UNMEASURED — a preview carries no commit file list'}</span></div>${exPaths && exPaths.length ? exPaths.map((p) => row('EXCLUDED', { path: p }, false)).join('') : `<span class="c3l dim">${exPaths ? 'none — every file of the commit is in the aperture' : 'not run — a walk of a commit lists them'}</span>`}<span class="c3l dim" title="the receipt's own rule">${esc(`${ex.why || ''}${ex.max_files != null ? ` · max_files ${ex.max_files}` : ''}`)}</span>`;
}

export function renderApertureLine(r) {
  const button = primary('vna.viewAperture', '🔍 View Aperture Receipt', apertureFaceMetric(r), 'open the aperture receipt as a read-only native document beside the editor (steer://aperture/receipt.json, json): the intent rows and the spec basins they were itemized from, the reality rows with each file\'s blob sha at the immutable commit, the files the aperture excluded, κ over raw bytes, the Δ slack and ω; next: compare the files under REALITY with the rows under INTENT');
  const line = apertureReceiptLine(r);
  const inner = !r
    ? `<div class="c3h c3t"><b>THE APERTURE</b> <span class="spark" title="what the chip looked at, against what was declared">UNMEASURED</span></div><span class="c3l dim aperture" title="C115/C116 — the receipt line, verbatim">${esc(line)}</span>`
    : `<div class="c3h c3t"><b>THE APERTURE</b> <span class="spark" title="what the chip looked at, against what was declared">${(r.intent?.rows || []).length} intent · ${(r.reality?.rows || []).length} reality</span></div><span class="c3l dim aperture" title="${esc(`C115/C116 — the aperture is inspectable: which files at the commit painted REALITY (F_in) ↔ which spec rows were INTENT (S_in) · κ = used bytes ÷ every tracked byte at the commit, raw · root = the spec tree's Merkle root · ω = sha256 over the rows, their blob shas, the commit and the aperture version, so another machine checks it fed the chip the same bytes`)}">${esc(line)}</span>${bar(r.kappa.used_bytes, r.kappa.repo_bytes, `bytes looked at · ${kBytes(r.kappa.used_bytes)} of ${kBytes(r.kappa.repo_bytes)} tracked (${r.kappa.pct != null ? r.kappa.pct + ' %' : 'UNMEASURED'})`)}${bar(r.reality.rows.length, r.kappa.tracked_files, `files looked at · ${r.reality.rows.length} of ${r.kappa.tracked_files} tracked`)}<span class="c3l dim" title="what the chip looked at — the engine, the raw→cut ratio and whether the aperture matched the ratchet's floor">${esc(`${r.engine || 'engine UNMEASURED'} · ${r.raw_ratio != null ? r.raw_ratio + ':1 raw' : 'raw UNMEASURED'} → ${r.used_ratio != null ? r.used_ratio + ':1 cut' : 'cut UNMEASURED'} · ${r.matched ? 'matched' : 'NOT matched'} · floor ${r.floor ?? 'UNMEASURED'}${r.admissible === false ? ' · BELOW THE FLOOR — UNMEASURED' : ''}`)}</span><span class="c3l dim" title="root = the spec tree's Merkle root the intent rows were itemized from · ω = the receipt's own hash">${esc(`root ${r.intent && r.intent.root ? r.intent.root.slice(0, 8) : 'UNMEASURED'} · ω ${String(r.omega || '').slice(0, 8) || 'UNMEASURED'} · aperture ${String(r.aperture_version || '').slice(0, 8) || 'UNMEASURED'}`)}</span>${renderApertureRows(r)}`;
  // C141/C145: one of the nine, indented under 🚶 Walk HEAD (what the walk looked at)
  return `<div class="card3 c-aperture pill indent"><div class="c3l face">${button}${plusFold('aperture', 'the aperture — what the chip looked at (files · bytes · share of the repo) against what was declared (intent rows), the two proportions as bars, the engine line, root and ω; next: 🔍 View Aperture Receipt for the rows themselves', inner)}</div></div>`;
}
// C116 — THE DOOR: a read-only native document (steer://aperture/receipt.json through the extension's content provider), never a file
// list inside the webview; the metric is κ · ω off the receipt, not run when it is absent
export function renderApertureDoor(r) {
  const metric = r ? `κ ${r.kappa.pct != null ? r.kappa.pct + '%' : 'UNMEASURED'} · ω ${r.omega.slice(0, 8)}` : notRun(APERTURE_CMD);
  return B('vna.viewAperture', `🔍 View Aperture Receipt · <span class="measure">${metric}</span>`, `open the aperture receipt as a read-only native document beside the editor (steer://aperture/receipt.json, json): the intent rows and the spec basins they were itemized from, the reality rows with each file's blob sha at the immutable commit, the files the aperture excluded, κ over raw bytes, the Δ rings by coordinate, and ω with its recipe — data/vna/aperture-receipt.json, re-read on each open; next: recompute ω elsewhere with omegaTuple and compare pixels`, 'sb aperture');
}

// THE STRIP — the page's own, compact (operator 2026-09-17, screenshot: nine full-width buttons before
// any information). It lives HERE, not in the extension, so the checkbox and the FEED line are painted
// from one receipt in one render (they could disagree when the host painted one and the page the
// other), and so a change to the strip never needs a window reload. Buttons post commands through
// go(); in a browser copy go() says so. The clipboard checkbox reads clipState — the daemon's own file.
// C68 — the RUN row's status, folded from .thetacog/runner.ndjson (steer-runner.mjs writes one row per event): RUNNING while a
// dispatch has no verdict/halt after it, HALTED with the reason, DONE, or not run. Read at render; the extension keeps nothing.
// C113l — THE RED-WITNESS STATUS, off the last verdict row's gates (C66 redWitness: RED · GREEN-ON-PARENT · UNMEASURED, and
// guardGreen): PROVED only when the parent run was RED and the guard is green at HEAD; GREEN-ON-PARENT is ABSENT (nothing was
// witnessed); anything else UNMEASURED with the row's own why. No verdict yet → null, never a typed status.
export function redWitnessOf(rows) {
  const v = (rows || []).filter((r) => r && r.kind === 'verdict').pop(); if (!v) return null;
  const g = v.gates || {}; const label = v.label || null;
  if (!('redWitness' in g)) return { status: 'UNMEASURED', label, why: 'the last verdict carries no red-witness gate' };
  if (g.redWitness === 'RED') return g.guardGreen === true ? { status: 'PROVED', label, why: null } : { status: 'UNMEASURED', label, why: 'red on the parent but the guard is not green at HEAD' };
  if (g.redWitness === 'GREEN-ON-PARENT') return { status: 'ABSENT', label, why: 'the changed tests passed on the parent — nothing was witnessed' };
  return { status: 'UNMEASURED', label, why: v.redWhy || `red witness ${g.redWitness || 'UNMEASURED'}` };
}
// ── C147 HALT REASON HAS HEALTH METRICS (operator 2026-09-21: "if we show halt reason red witness we need better health metrics on that one"):
// a pure reading over the runner rows — halts of dispatches (the halt and dispatch rows counted), the last halt's age, the red witness state
// (🟢 green = PROVED · 🔴 red = ABSENT, the witness never seen red · UNMEASURED — the row's own why) off redWitnessOf, and the worker's last
// verdict (label · ✅/❌ · gates held of named). No rows → null → the pill reads not run — <cmd>; a count is read, never typed.
export function haltHealth(rows, { now = Date.now() } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const halts = rows.filter((r) => r && r.kind === 'halt'); const dispatches = rows.filter((r) => r && r.kind === 'dispatch');
  const lastHalt = halts[halts.length - 1] || null; const wit = redWitnessOf(rows);
  const v = rows.filter((r) => r && r.kind === 'verdict').pop() || null; const gates = v && v.gates && typeof v.gates === 'object' ? Object.values(v.gates) : [];
  const witness = !wit ? { state: 'UNMEASURED', why: 'no verdict row yet' } : wit.status === 'PROVED' ? { state: 'green', why: null } : wit.status === 'ABSENT' ? { state: 'red', why: wit.why } : { state: 'UNMEASURED', why: wit.why };
  return { halts: halts.length, dispatches: dispatches.length, lastHaltAt: lastHalt ? lastHalt.at || null : null, lastHaltReason: lastHalt ? String(lastHalt.reason || '') : null, witness, verdict: v ? { label: v.label || null, ok: v.ok === true, gatesOk: gates.filter((g) => g === true || g === 'GREEN' || g === 'RED').length, gatesOf: gates.length, at: v.at || null } : null, now };
}
export function haltMetricOf(h, { now = Date.now() } = {}) {
  if (!h) return notRun('run one goal');
  const age = (iso) => (iso ? `<span class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</span> ago` : null);
  const halts = `${h.halts} halt${h.halts === 1 ? '' : 's'} of ${h.dispatches} dispatch${h.dispatches === 1 ? '' : 'es'}`;
  const last = h.lastHaltAt ? `last halt ${age(h.lastHaltAt)}` : 'no halt yet';
  const w = h.witness.state === 'green' ? '🟢 red witness green' : h.witness.state === 'red' ? `🔴 red witness red${h.witness.why ? ` — ${esc(h.witness.why)}` : ''}` : `red witness UNMEASURED — ${esc(h.witness.why || 'no reading')}`;
  const v = h.verdict ? `last verdict ${esc(String(h.verdict.label || '—'))} ${h.verdict.ok ? '✅' : '❌'} ${h.verdict.gatesOk}/${h.verdict.gatesOf} gates` : 'last verdict UNMEASURED — no verdict row';
  return [halts, last, w, v].join(' · ');
}
export function runnerRowsOf(path) { try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; } }
export function readRunner(path, { now = Date.now() } = {}) {
  let rows; try { rows = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return { state: 'not run', line: 'not run — no runner.ndjson yet' }; }
  if (!rows.length) return { state: 'not run', line: 'not run — no runner.ndjson yet' };
  const witness = redWitnessOf(rows);   // C113l: the last verdict on the tape, any run
  const lastRun = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === 'run').pop(); const run = lastRun ? rows.slice(lastRun[1]) : rows;
  const disp = run.filter((r) => r.kind === 'dispatch').pop(); const last = run[run.length - 1];
  const verdicts = run.filter((r) => r.kind === 'verdict').length; const worker = run.filter((r) => r.kind === 'worker' || r.kind === 'verdict').pop();
  const lastExit = worker && worker.exit != null ? worker.exit : null;
  const dur = (ms) => `${Math.floor(ms / 60000)}m${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}s`;
  const who = disp ? `dispatch ${disp.n} → ${disp.label}` : 'no dispatch';
  if (last.kind === 'pause') return { witness, state: 'PAUSED', n: last.n, label: last.label, lastExit, verdicts, workPixel: last.workPixel, basinPixel: last.basinPixel, d: last.d, line: `PAUSED · ${last.label} · working tree at ${last.workPixel} vs basin ${last.basinPixel} · D_Cheb ${last.d} — amend the basin or revert the drift, then run again` };
  if (last.kind === 'lane') return { witness, state: 'UNMEASURED', n: last.n, label: last.label, lastExit, verdicts, line: `LANE UNMEASURED · ${last.label} · ${last.why}` };
  if (last.kind === 'resume') return { witness, state: 'RESUMED', n: last.n, label: last.label, lastExit, verdicts, line: `RESUMED · ${last.label} · ${last.via === 'amend' ? 'basin amended' : `${(last.paths || []).length} path(s) reverted`} — run again` };
  if (last.kind === 'halt') return { witness, state: 'HALTED', n: disp && disp.n, label: disp && disp.label, lastExit, verdicts, reason: last.reason, line: `HALTED · ${who}${lastExit != null ? ` · exit ${lastExit}` : ''} · ${last.reason}` };
  if (last.kind === 'done') return { witness, state: 'DONE', n: disp && disp.n, label: disp && disp.label, lastExit, verdicts, line: `DONE · ${verdicts} unit${verdicts === 1 ? '' : 's'} verified${lastExit != null ? ` · last exit ${lastExit}` : ''}` };
  if (last.kind === 'abort') return { witness, state: 'ABORTED', n: disp && disp.n, label: disp && disp.label, lastExit, verdicts, line: `ABORTED · ${who}` };
  if (disp && ['dispatch', 'run', 'dry-run'].includes(last.kind)) return { witness, state: 'RUNNING', n: disp.n, label: disp.label, lastExit, verdicts, line: `RUNNING · ${who} · ${dur(Math.max(0, now - Date.parse(disp.at)))}${verdicts ? ` · ${verdicts} verified` : ''}` };
  return { witness, state: 'RUNNING', n: disp && disp.n, label: disp && disp.label, lastExit, verdicts, line: `RUNNING · ${who} · after ${last.kind}` };
}
// C75 — the entitlement CLAIMS ride the environment from the host (auth-manager.ts decodes them out of context.secrets);
// the JWT itself never reaches this process, and the claims are not a secret: account_id · pubkey_fingerprint · credits · exp.
// C173c — ONE CLAIMS SNAPSHOT: two extension hosts (VS Code and Cursor) repaint one page and the claim lives in ONE app's
// SecretStorage, so env-only reading made the key box flicker as the writers alternated (measured 2026-09-22: 0.3.28 wrote
// keybox=1, 0.3.30 keybox=0, every 10–30 s). The host that holds the JWT writes the non-secret claims to one gitignored file;
// every writer reads env || snapshot, so either IDE, a terminal /steer and a worker paint the same state. Expired claims read as none.
export const CLAIMS_SNAPSHOT = resolve(REPO, '.thetacog/entitlement-claims.json');
const liveClaims = (c, now) => (c && typeof c === 'object' && !(typeof c.exp === 'number' && c.exp * 1000 < now) ? c : null);
export function entitlementFromEnv(env = process.env, { snapshot = env.VNA_CLAIMS_SNAPSHOT || CLAIMS_SNAPSHOT, now = Date.now() } = {}) {
  try { const c = liveClaims(JSON.parse(env.VNA_ENTITLEMENT_CLAIMS || 'null'), now); if (c) return c; } catch {}
  try { return liveClaims(JSON.parse(readFileSync(snapshot, 'utf8')), now); } catch { return null; }
}
// C179 — THE 🔑 API KEY SUB-PILL IN THE ⚡ RUNNER CARD reads VNA_ENGINE_KEY_ROWS the same way this card reads
// VNA_ENTITLEMENT_CLAIMS: the extension (vna-engines.ts engineKeyRowsEnv) is the only thing that ever touches SecretStorage,
// and merges the row already reduced to { engine, built, held, fp8, line } — fp8 is a one-way sha256 fingerprint of the
// key's bytes, never the key. A missing or malformed env carries no row: the pill then reads UNMEASURED per engine, never a
// silent zero (never re-derived here — a render process has no SecretStorage of its own to fall back to).
export function engineKeyRowsFromEnv(env = process.env) {
  try { const rows = JSON.parse(env.VNA_ENGINE_KEY_ROWS || 'null'); return Array.isArray(rows) ? rows : []; } catch { return []; }
}
// C173c — STALE-WRITER: a repaint from an extension build older than the newest build that painted this page in the last hour
// says so on the build line instead of silently overwriting a newer build's page. The record is one small gitignored file.
export const WRITERS_FILE = resolve(REPO, '.thetacog/steer-writers.json');
const semverCmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
export function staleWriter({ ext = process.env.VNA_EXT_VERSION || null, file = process.env.VNA_WRITERS_FILE || WRITERS_FILE, now = Date.now(), windowMs = 3600000, write = true } = {}) {
  if (!ext) return { state: 'UNKNOWN', html: '' };
  let rec = null; try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  if (rec && rec.ext && now - Number(rec.at || 0) < windowMs && semverCmp(ext, rec.ext) < 0) {
    return { state: 'STALE-WRITER', ext, newest: rec.ext, html: `<b class="rr pill" data-beat="stale-writer" title="C173c — an older extension build repainted a page a newer build painted ${esc(String(Math.round((now - rec.at) / 1000)))} s ago; two IDEs on one machine run different installs — update or close the older one">⚠️ STALE-WRITER (this ${esc(ext)} · newest ${esc(rec.ext)})</b>` };
  }
  if (write) { try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ ext, at: now })); } catch {} }
  return { state: 'CURRENT', ext, html: '' };
}
// ── C78a THREE CARDS AND ONE CTA (goal 5 unit 4; the strip before this was nine full-width buttons before any information,
// then a second row of five). CARD 1 ACTIVE CONTRACT: the goal's current unit (goalStatus — the record), the last prompt's
// coordinate · hat · domain and the lane badge from the lens receipt — the lens's own verdict (routed to a known repo-domain
// pixel = in lane; the gzip fallback = drifting), never a threshold of this page; UNMEASURED when the walk refused or there
// is no receipt. CARD 2 AUTONOMOUS RUNNER: ONE button — Run Headless when the runner ledger says not run / DONE / HALTED /
// ABORTED, Abort Worker when it says RUNNING — beside the ledger's own line. CARD 3 INSTITUTIONAL ATTESTATION: ONE CTA,
// 🔗 3rd-Party Attested Backup (vna.backupTape, C71 — the archive is composed here, the upload and the licence are the
// human's act on the site), the 🔑 entitlement line (C75), the signed count + height off the flight tape and the notary
// card (C76) as the air-gapped / notarized status. Everything else the strip held lives in the two trays below.
// C78a — the newest per-prompt lens receipt, named by the index the lens writes (lens-receipts/index.ndjson → <id>.json).
// inLane is the lens's rule restated once (prompt-lens.mjs: inLane = !!boundary.domain — a known domain, not the gzip fallback).
export function readLensReceipt(dir = resolve(REPO, '.thetacog/lens-receipts')) {
  const idx = lastLine(resolve(dir, 'index.ndjson')); if (!idx || !idx.id) return null;
  let j; try { j = JSON.parse(readFileSync(resolve(dir, `${idx.id}.json`), 'utf8')); } catch { return null; }
  const fit = (j.placement && j.placement.fit) || {}; const rat = (j.placement && j.placement.ratchet) || {};
  const domain = j.domain || null; const coord = j.pixel || j.coord || null;
  return { at: j.ts || null, coord, hat: j.hat || null, domain, sigma: typeof j.sigma === 'number' ? j.sigma : null, inLane: !!(domain && domain !== 'other' && coord), admissible: typeof rat.admissible === 'boolean' ? rat.admissible : null, gain: typeof fit.gain === 'number' ? fit.gain : null, z: typeof fit.z_fine === 'number' ? fit.z_fine : null, zRequired: typeof rat.z_required === 'number' ? rat.z_required : null, unmeasured: j.unmeasured || null, refused: !!j.refused };
}
const B = (cmd, label, title, cls = 'sb') => `<button class="${cls}" onclick="go('${cmd}')" title="${esc(title)}">${label}</button>`;
// C83a — THE VALUE LINE: card 3 reads what it was asking about before it asks. A pure function of the three receipts
// (C82e's token meter, C78e's flight-tape chain, C81b's notary card) — no fourth receipt, never a dollar. A missing
// term reads UNMEASURED for ITSELF only, and the line still renders; UNMEASURED is never 0 — a receipt that measured
// and found nothing yet (a session counted, zero saved) prints 0.
const kTokens = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export function valueLine({ meter = null, chain = null, notary = null } = {}) {
  const tokens = meter && meter.saved && Number.isFinite(meter.saved.tokens) ? kTokens(meter.saved.tokens) : 'UNMEASURED';
  const chainMeasured = !!(chain && chain.state === 'MEASURED');
  const signed = chainMeasured && Number.isFinite(chain.signed) ? String(chain.signed) : 'UNMEASURED';
  const height = chainMeasured && chain.height != null ? String(chain.height) : 'UNMEASURED';
  const notaryLabel = notary && notary.label ? notary.label : 'UNMEASURED';
  return `⛽ ${tokens} input tokens not re-sent · ${signed} signed rows · height ${height} · ${notaryLabel}`;
}
// C98d — THE UNIT'S WITNESS, READ OFF ITS OWN ROW. The guard path is what the spec row names in (guard: `…`) — specRows'
// text, never a path typed on the card; exists is a stat on disk. No unit → null; a row without a guard → path null.
export const SPEC_MD = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export function unitGuard({ label = null, md = null, repo = REPO } = {}) {
  if (!label) return null;
  if (md == null) { try { md = readFileSync(SPEC_MD, 'utf8'); } catch { md = ''; } }
  const row = specRows(md).find((r) => r.label === label);
  const m = row && /\(guard:\s*`([^`]+)`/.exec(row.text);
  const path = m ? m[1].trim() : null;
  return { label, path, exists: !!(path && existsSync(resolve(repo, path))) };
}
// C122e — THE CLOCK ON THE FACE (operator 2026-09-21: "the most important part of everything we could possibly say here is your time on
// target — the good and bad attestations you've signed, starting [date]"): the date the record starts, read off the tape — the first
// LICENSED row's ts when the countersigned record has begun, else the tape's first row; no rows → null (the metric already reads not run).
export function tapeSince(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const lic = rows.find((r) => { try { return licenceOf(r).status === 'LICENSED'; } catch { return false; } });
  const r = lic || rows.find((x) => x && x.ts) || null;
  return r && r.ts ? String(r.ts) : null;
}
// ── C141 THE NINE PILLS (operator 2026-09-21, verbatim: "the 9 pills, 4 indented, with curated action buttons at the beginning of the line
// must happen, and we fold the others into the list, must happen") — renderCards paints THE WHOLE LEFT PANEL under the live line: five
// root pills and five indented — TEN since C152 — in the operator's order (C142, amended by C151/C152): the tiles · 🚶 Walk HEAD [🔍 View Aperture Receipt] ·
// ⚡ Run Headless · 💳 Fund Autonomy Ledger [⚙️ Tokens per cog] · 🟢 auto-paste [📋 Copy Run Summary · 🌳 Open Tree] · 📄 Open Spec [🔍 Inspect Halt Reason]. Every other line the panel ever
// painted (the cog card, the bridge doors, NEXT →, RINGS, the arms, the workbench, the ingest receipt, the telemetry, the T5 drawers, the
// export textarea) is FOLDED under the nearest pill's + — nothing removed (C103b.2). `cock` is the walk receipt (the tiles + the walk pill
// are painted here so the order is one string); `folds` is what the page hands over per pill (main() only — the fixtures hand nothing).
export function renderCards({ goal = null, lens = null, runner = null, chain = null, clip = null, entitlement = entitlementFromEnv(), fingerprint = process.env.VNA_DEVICE_FINGERPRINT || null, notary = null, meter = tokenMeter(), economics: econIn = null, loop = null, bundleFile = resolve(REPO, 'docs/specs/vna/RESEARCH-BUNDLE.txt'), now = Date.now(), cogData = null, guard = undefined, clipIngest = undefined, md = undefined, licensedRows = undefined, next = null, backups = undefined, backedUp = undefined, cogPct = undefined, since = undefined, countersign = undefined, ledger = CREDITS_LOCAL,
  cock = undefined, optTargets = undefined, preview = null, turn = null, legendHtml = undefined, behind = null, aperture = undefined, pixel = undefined, ingest = undefined, treeAt = undefined, gauge = undefined, stree = undefined, spec = undefined, runnerRows = undefined, outbound = undefined, verified = undefined, build = null, doors = null, tapeBackups = null, folds = {}, hb = undefined, refreshAge = 'not run', lagHtml = '', doorsDisagree = 0, avbLine = '', chat = undefined, engineKeys = undefined, claimHistory = undefined, worklist = undefined, audio = undefined } = {}) {
  const tapeRowsForAcct = (() => { try { return readFileSync(FLIGHT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return null; } })();   // C139: the rows stamped since the claim, when the ledger is not yet this token's
  const F = (k) => (folds && folds[k]) || '';   // what the page folds under pill k (main() only)
  // C103d / C103b (revised 2026-09-20, operator: "button · metric · plus sign is high s/n per card, then show all we need after the
  // plus") — THE FACE IS THE SIX LINES: each card is exactly `<emoji> <Verb> <object> · <metric> [+]` — the button is the card's
  // one primary .action (C80b), its metric span the card's one .measure, read off the card's own receipt (`not run — <command>`
  // when the receipt is absent, never a zero, never a typed constant), and the `+` its one fold. Every word goes behind the +:
  // the spark line first (C103e), the face block (what the card read), the mid tier (the secondary buttons behind ⋮ and the two
  // or three facts a returning user wants), then ▸ more with the instrument. Nothing that was on the page is removed — it moves
  // down a tier (C103b's guard diffs the render against the capture at tests/vna/fixtures/c103b-pre-change-render.json).
  // C89c: the secondaries fold behind ⋮ (a <details class="ctx" open> — above 350 px the CSS hides the ⋮ and the buttons sit inline).
  const fold = (action, key = null) => { const i = action.indexOf('<button class="sb"'); if (i < 0) return action; const secondary = action.slice(i); return `${action.slice(0, i)}<details class="ctx" id="ctx-${ctxKey(secondary, key)}"><summary title="more actions for this card — the secondary buttons, folded on a narrow panel; next: pick one of the secondary actions">⋮</summary><span class="ctxb">${secondary}</span></details>`; };   // C102d.3: the tooltip ends next: …, same as every other control
  const more = (id, title, inner) => `<details class="more" id="${id}"><summary title="${esc(title)}">▸ more</summary><div class="mrb">${inner}</div></details>`;
  // the card: face = the primary button (+ an inline door the row names) and the +; behind the + the name rides the spark line
  // operator 2026-09-20 ("all parts of this has to be maximal comms"): the line beside the card's name is the card's READING — the same
  // metric its button carries — and the tagline (C103e's spark) rides as that line's tooltip, never as a visible line
  // C122c — THE FILE IS ON THE FACE (operator 2026-09-21: "opening the file the machine is working on should be obvious without
  // expanding the pill"): a face may carry, after its one .action, ONE file door (faceDoor — class sb witness or sb doc, no .measure;
  // the face's one measure stays the primary's, C80b · C103d.5 hold). C103d's "the face is the button, the metric and the + and
  // nothing else" is reversed for file doors and only for them; C109m.5's refused ▶ was a second ACTION, a door spawns nothing.
  // C141: card() is pillBox(pillInner()) — one shape for the nine (`pill`, `indent` for the four under a parent); `more` is what folds after ▸ more
  const card = (cls, name, id, button, { inline = '', spark = '', reading = '', face = '', mid = '', drawer = '', plusTitle = '', doc = null, faceDoor = '', under = '', acct = '', indent = false, deep = false, beat = '', more = '', next = '', nested = '' } = {}) =>
    pillBox(cls, id, button, { faceDoor, under, indent, deep, beat, plusTitle, inner: pillInner(name, { spark, reading, face, mid, drawer, doc, inline, acct, more, next, nested }) });   // C200: `nested` = a whole pill that lives inside this pill's +, first under the name line (the 🔑 licence inside 💳)   // C141: NEXT → (next) is its own line right after the name, before the face block   // C138: every card's + carries the checkout door, painted here once for the nine · C139: the 💳 pill's carries the account state beside it (acct)   // C131: `under` is the one line a face may carry beneath it, outside the + — the empty-state warning on the 💳 pill, in liveTip's tip-warn idiom
  const A = (cmd, label, title, cls = 'action') => `<button class="${cls}" onclick="go('${cmd}')" title="${esc(title)}">${label}</button>`;
  const age = (iso) => (iso ? `<b class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</b> ago` : '');
  const ageS = (iso) => (iso ? `<span class="age" data-at="${esc(iso)}">${fmtAge(now - Date.parse(iso))}</span> ago` : '');   // on a button metric: never a <b> before the card's name (the manifest keys the card on its first <b>)
  // C95a — /steer IS /goal++: card 2's first line behind the + is §25's sentence, then the three pluses, byte-identical to the README (one constant)
  const hook = `<div class="c3l dim hook" title="${esc(STEER_IS_GOAL)}">${esc(STEER_IS_GOAL_SHORT)}</div>`;
  // operator 2026-09-20: a bare icon button is a zero — each carries the age of the receipt it last produced, or `not run`
  const fileAge = (rel) => { try { return ageS(statSync(resolve(REPO, rel)).mtime.toISOString()); } catch { return 'not run'; } };
  const iconAges = { walk: fileAge('data/vna/cockpit.json'), preview: fileAge('data/vna/cockpit-preview.json'), spec: fileAge('docs/specs/vna/SPEC-VNA-COCKPIT.md'), export: fileAge('docs/specs/vna/PAYLOAD.txt'), refresh: fileAge('docs/specs/vna/steer/latest.html') };
  const pluses = `<span class="c3l dim hook" title="the same sentence the README opens with — §25, one constant">${esc(STEER_IS_GOAL)}</span>${HOOK_PLUSES.map((l) => `<span class="c3l dim hook">${esc(l)}</span>`).join('')}`;
  // 2 · ACTIVE CONTRACT — metric: unit n/N · the row's headline (C103f: label + first clause, read off specRows, ≤ 120) · the lane badge
  const cur = goal && goal.current;
  const lane = !lens || lens.unmeasured || lens.refused || !lens.coord ? '<span class="lane un">⚪ UNMEASURED</span>' : lens.inLane ? '<span class="lane in">🟢 In-Lane</span>' : '<span class="lane off">🔴 Off-Lane</span>';
  const headline = cur ? rowHeadline(cur.labels[0], { md }) : null;
  const unit = !goal ? '<span class="miss">no /goal on the record</span>' : !cur ? `every unit closed ${goal.done}/${goal.units.length}` : `unit ${cur.n}/${goal.units.length} <span class="lb">${esc(cur.labels.join(' '))}</span>`;
  // C146 (operator 2026-09-21: "📄 Open Spec prints rows ticked of declared · open rows · the active unit — with stats that make it clear"): the spec's
  // ticks lead (specTicks over the spec markdown — a value the caller hands in, else the file; null → not run), then the unit and the lane
  const specR = spec === undefined ? specStats(md) : spec;
  const specTerm = !specR ? notRun('node scripts/vna/spec-check.mjs') : `${specR.ticked} of ${specR.declared} rows ticked · ${specR.open} open`;
  const unitTerm = !goal ? notRun('node scripts/vna/goal.mjs set --text … --unit …') : !cur ? `${goal.done}/${goal.units.length} closed · ${lane}`   /* C122d: metric · metric, never a sentence */ : `unit ${cur.n}/${goal.units.length} · ${esc(headline || cur.labels[0])} · ${lane}`;
  // C204 (operator 2026-09-23: "Expandable with aggregate stats"): the face carries spec-clarity's aggregate (open · clear · stuck ·
  // needs-you · your-act, spec-worklist.mjs — never recounted here); a fixture that hands in its own spec counts reads no live list
  const wl = worklist === undefined ? (spec === undefined ? readWorkList({ tracked: (p) => guardTrackedAtHead(p), tree: (() => { try { return readTreeJson(resolve(REPO, 'data/vna/spec-tree.json')); } catch { return null; } })() }) : null) : worklist;
  const contractMetric = `${specTerm} · ${unitTerm}${wl ? ` · ${workListAggregate(wl)}` : ''}`;   // after the lane: C80b/C122d pin `N open · unit` as the lead
  const where = lens && lens.coord ? `<span class="ib">${esc(lens.coord)}</span> ${esc(fullName(lens.coord))} · ${esc(lens.hat || '—')} · ${esc(lens.domain || '—')}${lens.sigma != null ? ` · σ ${esc(String(lens.sigma))}` : ''} · ${age(lens.at)}${lens.unmeasured ? ` · <span class="dim" title="${esc(String(lens.unmeasured))}">${esc(String(lens.unmeasured).slice(0, 60))}</span>` : ''}` : '<span class="dim">no lens receipt — the walk has not placed a prompt yet</span>';
  // C98d — card 2 INSPECTS, never copies: 🧪 Open Red Witness opens the unit's guard (the path off its own spec row, unitGuard),
  // the first control behind the + (C103d revised: the face is the button, the metric and the + and nothing else); an absent file
  // says `not on disk — <path>` for this unit only; the copy-goal is the one secondary under ⋮
  const g = guard === undefined ? (cur ? unitGuard({ label: cur.labels[0], md }) : null) : guard;
  const witnessTitle = !g ? 'no /goal on the record — install one on card 4 (📥 Ingest Refined Goal); then this opens the unit\'s guard; next: 📥 Ingest Refined Goal'
    : !g.path ? `row ${g.label} names no guard — add (guard: \`tests/…\`) to its spec row; the witness must fail red before code lands`
    : !g.exists ? `not on disk — ${g.path} · the row names it, the file is not there yet; write it first and see it red`
    : `open ${g.path} in the editor — the test the row names, the one that must fail red before code lands and green after; next: node --test ${g.path}`;
  // class "sb witness" (never the bare "sb" the ⋮ fold splits on): inline at every width — C80b.0 keeps ONE .action per card
  const witnessDoor = A('vna.openGuard', '🧪 Open Red Witness', witnessTitle, `sb witness${g && g.path && !g.exists ? ' warn' : ''}`);
  let bst = null; try { bst = statSync(bundleFile); } catch {}
  const bMeasure = bst ? `bundle <b>${(bst.size / 1000).toFixed(1)}k</b> chars · ${age(bst.mtime.toISOString())}` : '<span class="dim">no bundle yet — the action writes it</span>';
  const ci = clipIngest === undefined ? readClipIngest() : clipIngest;
  const bridgeMetric = !ci ? notRun(CLIP_INGEST_CMD) : `${esc(ci.line || `${ci.added} new · ${ci.attached} attached · ${ci.released} RELEASED`)} · ${ageS(ci.at)}`;
  const ciLine = !ci ? `<span class="c3l dim" title="the last one-shot ingest's receipt (.thetacog/vna-clip-ingest.ndjson) — absent until ⤵ Ingest Clipboard runs once">⤵ no clip ingested yet — not run — <code>${esc(CLIP_INGEST_CMD)}</code></span>`
    : `<span class="c3l dim" title="what the fold did with the last ingested clip, off the fold's own return: new nodes · snippets attached to basins · attached but RELEASED (walk not admitted, kept UNMEASURED with its d)">⤵ last ingest ${age(ci.at)} · <b>${esc(ci.line || `${ci.added} new · ${ci.attached} attached · ${ci.released} RELEASED`)}</b> · ${esc(String(ci.bytes || 0))}B sha ${esc(String(ci.sha8 || '—'))}</span>${(ci.releasedAsks || []).map((x) => `<span class="c3l dim rel"><b class="lb">${esc(String(x.basin))}</b> ${x.pixel ? `<span class="ib">${esc(String(x.pixel))}</span> · ` : ''}d ${x.d == null ? '—' : esc(String(x.d))} · <span class="ttl2" title="${esc(String(x.headline))}">${esc(String(x.headline))}</span></span>`).join('')}`;
  let cogD = cogData; if (cogD === null) { try { cogD = cogCardData({ repo: REPO }); } catch (err) { cogD = { status: 'UNMEASURED', why: `cog reading failed: ${String(err.message).slice(0, 80)}`, stamp: '' }; } }
  // C109n (operator 2026-09-20: "ingest clipboard is not a section / the cogs / token must be there instead"): the bridge is not a
  // card — its two doors and the last-ingest line ride under the cog card's +; ⤵ Ingest Clipboard is the live line's door
  const bridgeTier = `<div class="tier mid bridge"><span class="c3l">${fold(B('vna.copyResearch', '🧠 Copy Prompt Bundle', 'rebuild RESEARCH-BUNDLE.txt from the receipts and copy it: the active basin, the recent Δ coordinates, the open rows and the goal, with the handshake — paste it to a browser model (Gemini, Claude); next: 📥 Ingest Refined Goal with its answer on the clipboard') + B('vna.ingestGoal', '📥 Ingest Refined Goal', 'read a refined /goal from the clipboard and run goal.mjs import --validate --install — every row it names must be a basin in spec-tree.json or the gate refuses and says which; on ACCEPTED it is written to data/vna/goal.json and card 1 shows unit 1; next: run it headless on card 2'))}</span><span class="c3l dim">${bMeasure}</span>${ciLine}<span class="c3l dim">paste the answer back with auto-paste on — each paragraph lands in its row (C52b); no local model on this path</span></div>`;
  // C113d (operator 2026-09-20: "the complexity measures need to be under the keys"): the cog view is still NAMED (TOKENS PER COG)
  // but it is a block under the 💳's +, not a face — the percentile line (C113e) first, then the meter; cards3 = contract · runner · attest
  const cogPctR = cogPct === undefined ? (() => { try { return readCogPercentile({ repo: REPO }); } catch (e) { return { status: 'UNMEASURED', why: String(e.message || e).slice(0, 80) }; } })() : cogPct;
  // C113j (amends C113d): the cog view is a FACE again (⚙️ Tokens per cog, between the contract and the runner); under the 💳 + only
  // the percentile line and the session token-spend line stay — the money side stays with the money
  const cogTier = `<div class="tier mid cog"><span class="c3l cogpct" title="C113e — every minted cog ranked against the CHAIR route's minted cogs (the commits a human made here); a runner commit is ranked but never joins the ruler; mid-rank, ties count half; UNMEASURED below 30 chair rows — node scripts/vna/cog-percentile.mjs">${esc(cogPercentileLine(cogPctR))}</span><span class="c3l dim cogspend" title="C113j — this session's token spend against its floor (prompt + CLAUDE.md per call) and its ceiling (the transcript re-sent per call); the tokens not re-sent are ceiling − actual — read off the transcript usage rows (C93b), never typed">${esc(sessionSpendLine(cogD))}</span></div>`;
  // C155: under the cog pill's + — the card's own graphs, then THE RATCHET TO THE DIGNITY PIXEL (the ruler · the peg · the rank · the pixel, off cogD, cogPctR and the pixel receipt), then what the page folds here (the envelope — the formal methods)
  const pixelR = pixel === undefined ? readCompetencePixel() : pixel;
  // C141/C142: the first pill is 📄 Open Spec (vna.openSpec — the door named is the door opened); 📄 View Unit Contract (vna.viewUnit, the spec
  // at the unit's own row) is the first door under its +, inline (class sb doc — never folded behind ⋮); the NEXT → card folds here at the goal step
  const viewUnitDoor = B('vna.viewUnit', '📄 View Unit Contract', 'open this unit\'s spec row in the editor (docs/specs/vna/SPEC-VNA-COCKPIT.md at the row\'s line — edit it if you like, the fold reads the file on the next turn) — its invariants, its acceptance checklist and the guard path that must fail red before code lands; next: run it headless on the ⚡ pill, or work it by hand', 'sb doc');
  const nextUnder = (k) => (next && nextFoldsInto(next) === k ? `<div class="c3l nextfold" title="C141 — NEXT → folded here: this pill's button is the step, so the step lives under its + instead of as a tenth line">${renderNextInner(next, { meter })}</div>` : '');
  const c1 = card('c-contract', 'ACTIVE CONTRACT', 'contract',
    primary('vna.openSpec', '📄 Open Spec', contractMetric, `open the spec in the editor (${docTooltip('spec')}) — the rows, the ticks, the active unit; edit a row and the fold reads it on the next turn; next: ⚡ Run Headless on the open unit, or work it by hand`),
    { spark: SPARK_LINES.contract, reading: !goal ? '· no goal set' : `· unit ${cur ? cur.n : goal.units.length}/${goal.units.length} · ${goal.done} closed · ${cur ? esc(String(cur.labels[0])) : 'all units closed'}`, plusTitle: 'the contract — the unit and its lane, the red witness, the hook sentence, the coordinate; next: 🧪 Open Red Witness',
      next: nextUnder('contract'), face: `<div class="c3l">${unit} ${lane}</div>${hook}`,
      faceDoor: witnessDoor,   // C122c: on the face, before the + (C98d's placement returns); painted once
      mid: `<span class="c3l">${viewUnitDoor}</span><span class="c3l">${fold(B('vna.copyGoal', '📋 copy the goal', 'copy the /goal with its units in execution order and the command that runs them — for a fresh Claude or for you; next: paste it into a fresh terminal'))}</span><span class="c3l dim">${cur ? `<span class="ttl2" title="${esc(String(cur.title))}">${esc(String(cur.title))}</span> · ${esc(budgetGate(goal).line)}` : ''}</span><span class="c3l dim">${where}</span>${bridgeTier}`,
      more: F('contract'),
      drawer: more('details-contract', 'the hook sentence · the three pluses · the unit · the coordinate · preview · spec · export; next: 👁 preview before you commit', `${pluses}<span class="c3l dim flying" title="C103 — the one sentence the extension says about why, beside the ratio the meter read (C98c)">${esc(FEELS_LIKE_FLYING)} ${esc(readRatioLine(meter))}</span><span class="c3l">${B('vna.steer', `⚡ walk · ${iconAges.walk}`, 'run every sensor and repaint the panels from the new receipt; next: read Δ')}${B('vna.preview', `👁 preview · ${iconAges.preview}`, 'where would the working tree land? — a look, not a receipt; next: commit to make it one')}${B('vna.openSpec', `📜 spec · ${iconAges.spec}`, 'open SPEC-VNA-COCKPIT.md in the editor; next: edit a row, the fold reads it on the next turn')}${B('vna.copyPayload', `📋 export · ${iconAges.export}`, 'copy the state for a chat — stamped, never re-ingested; next: paste it into the chat on the right')}${B('vna.refreshPage', `🔄 refresh · ${iconAges.refresh}`, 'repaint the side panel from the receipts on disk (≈200 ms, runs no sensor); next: 🚶 Walk HEAD when the receipts look stale')}</span>${renderWorkList(wl)}`) });
  // 4 · AUTONOMOUS RUNNER — metric: the ratio the meter read (C98c), `not run — run one goal` before one · the button flips on the runner state
  const r = runner || readRunner(resolve(REPO, '.thetacog/runner.ndjson'));
  const e = econIn || economics();
  const runningNow = r && r.state === 'RUNNING';
  const halted = r && r.state === 'HALTED';
  const snowball = `${BUNDLE_TOKEN_CAP.toLocaleString('en-US')}-token snowball`;   // C89b: the cap by its constant, never typed
  const runTitle = `one ephemeral claude -p per open unit, booted cold from the ${snowball} instead of this session's context; the run halts unless every check holds: exit 0 · HEAD moved · red witness · guard green · fold · CAR; next: step away, read the receipt here`;
  const pctTxt = e.collapse.state === 'MEASURED' ? `${e.collapse.pct} % not re-sent${e.collapse.turns != null ? ` · ${e.collapse.turns} turns · ${fmtTok(e.collapse.actual)} in` : ''}` : null;   // C119h: the spend ratio with its two terms, never the boot ratio
  // C113l: the idle face names the red-witness status off the last verdict row — token preservation and error states are two readings
  const wit = r && r.witness; const witTxt = wit ? `🛡️ Red witness · <span class="wit ${esc(wit.status)}"${wit.why ? ` title="${esc(`${wit.label ? wit.label + ' — ' : ''}${wit.why}`)}"` : ''}>${esc(wit.status)}</span>` : null;   // a span, never a <b>: the manifest names the pill by its first <b> — AUTONOMOUS RUNNER on the spark line (C141)
  const runMetric = witTxt && pctTxt ? `${witTxt} · ${pctTxt}` : witTxt ? `${witTxt} · ${notRun('run one goal')}` : pctTxt ? pctTxt : notRun('run one goal');
  // C141/C142: the runner's button is ⚡ Run Headless in every state but RUNNING (🛑 Abort Worker) — the halt is its own indented pill
  // (🔍 Inspect Halt Reason, C147), so a halt no longer flips this face; the metric carries HALTED with the reason
  const haltTitle = 'open the worker\'s output channel and the halt row runner.ndjson wrote — the reason is the file\'s own words (a red witness that stayed red, a commit that did not name its row, a lane the walk refused), never a typed list; next: fix the named cause, then 🔁 Retry Unit';
  const action = runningNow
    ? primary('vna.abortGoal', '🛑 Abort Worker', runMetric, 'kill the active worker\'s process group; the abort is written to runner.ndjson as its own row; next: read why on this card, then run again', 'action abort')
    : primary('vna.runGoal', '⚡ Run Headless', halted ? `<span class="rr wit">HALTED</span> · ${runMetric}` : runMetric, runTitle, 'action run');
  const retry = halted ? B('vna.runGoal', '🔁 Retry Unit · Run Headless', runTitle) : '';
  const paused = r && r.state === 'PAUSED';
  const laneActions = `${B('vna.amendBasin', '📝 Auto-Amend Spec Basin', 'the drift is the work: append an amendment row naming the working tree\'s pixel to the basin (C52a revision on the next fold), then run again; next: ⚡ Run Headless', 'sb fork')}${B('vna.revertDrift', '↩️ Revert Drift Changes', 'the drift is a mistake: git restore exactly the tracked paths the working tree changed — refused while another room holds a live claim on one of them — then run again; next: ⚡ Run Headless', 'sb fork')}`;   // C142: painted under 🚶 Walk HEAD's + while Δ shows drift or the runner is PAUSED — never on the runner now
  const L = e.lastRun;
  const lastShort = L.state !== 'MEASURED' ? '<span class="dim">no run yet</span>' : L.halted ? `<b class="lb">${esc(L.label || '—')}</b> <b class="rr">HALTED</b>` : `<b class="lb">${esc(L.label || '—')}</b> ${L.ok ? '✅' : '❌'} ${L.gatesOk}/${L.gatesOf}`;
  const savedShort = e.collapse.state === 'MEASURED' ? `<b class="badge green">${e.collapse.pct}% saved</b>` : '<b class="badge amber">saved UNMEASURED</b>';
  const runMeasure = `${savedShort} · last ${lastShort}${paused ? ' · <b class="rr">PAUSED on drift</b>' : runningNow ? ' · <b class="ok">RUNNING</b>' : halted ? ` · <b class="rr">HALTED</b> <span class="dim" title="${esc(String(r.reason || ''))}">${esc(String(r.reason || '').slice(0, 80))}</span>` : ' · <b class="dim">IDLE</b>'}`;
  const armed = !!(clip && clip.armed);
  void armed;
  // C144: the feed doors (📄 follow .txt · ⤓ tail · 🌳 fold → tree) ride under the auto-paste pill's + with the ONE toggle; the runner's ▸ more keeps the economics
  const feedDoors = `${B('vna.steerThisFile', '📄 follow .txt', 'point the tail watcher + the hook at the active .txt; next: append to it and watch the auto-paste pill')}${B('vna.checkTail', '⤓ tail', 'turn new appends into rows now; next: 🌳 fold → tree')}${B('vna.pasteToTree', '🌳 fold → tree', 'fold every new row into the Merkle spec tree; next: read the released asks under the 📄 Open Spec +')}`;
  // C166 — ⚙️ Engines & Keys: the engine the runner spawns, by the resolver's own status line (runner-resolver.mjs) — never typed here
  const eng = (() => { try { return engineStatusLine({ repo: REPO }); } catch { return null; } })();
  const enginesDoor = B('vna.openEnginesConfig', `${ENGINE_KEYS_LABEL_HTML} · ${esc(eng ? eng.name : 'UNMEASURED')} · ${entitlement && entitlement.pubkey_fingerprint ? `🔑 ${esc(String(entitlement.pubkey_fingerprint).slice(0, 8))} · ${esc(String(entitlement.credits ?? '?'))} cr` : '🔑 no licence'}`, `${eng ? eng.line : '[Runner: UNMEASURED]'} — pick the worker the headless runner spawns (claude -p · goose · ollama · your own command with {snowball}) and set its keys; the keys live in VS Code SecretStorage and reach the worker through its env, never a file or this page; next: ⚡ Run Headless`, 'sb doc');
  const c2 = card('c-runner', 'AUTONOMOUS RUNNER', 'runner', action,
    { spark: SPARK_LINES.run, faceDoor: faceDocDoor('run'), reading: `· runner ${runner && runner.state ? esc(String(runner.state)) : 'not run'}${runner && runner.at ? ` · ${ageS(runner.at)}` : ''} · ${e.collapse.state === 'MEASURED' ? `read ratio ${e.collapse.pct} %` : 'ratio UNMEASURED'}`, plusTitle: 'the runner — the last run and its gates, the worker line, the saved and cost lines, tokens per cog; next: 📋 Copy Run Summary on the export pill',
      next: nextUnder('runner'), face: `<div class="c3l">${runMeasure}</div>`,
      mid: `<span class="c3l">${enginesDoor}</span><span class="c3l dim"><span class="sl">worker</span> <span class="rs">${esc((r && r.line) || 'not run')}</span></span>`,
      drawer: more('details-runner', 'the runner line · last run · performance · saved · cost · the engine; next: 📋 Copy Run Summary for the team', `${renderEconomicsCard(e)}`),
      more: F('runner') });   // C152: ⚙️ Tokens per cog is no longer folded here — it is the tenth pill under 💳 (was C141's fold 7)
  // 5 · THE SECOND READER (C95b — was INSTITUTIONAL ATTESTATION) — metric: Local · <n> countersigned (the licence rows on the
  // tape, C90) or Signed · <fp8> · <n> countersigned · credits <N> once the key landed; `not run — no tape yet` before a tape.
  // The signed count, the height and the notary label print ONCE, behind the + (C95b.2); the body leads with the stamp
  // sentence (LICENCE_TOOLTIP, C97 Candidate 4/5). Never Upgrade · Pro · Subscribe · unassailable · un-forgeable · deterministic · attestation here (guard: c95b).
  const nc = notary && notary.label ? notary : (chain && chain.notaryLabel ? { label: chain.notaryLabel } : notaryCard());
  const ch = chain || loopHealth().chain;
  const notaryLabelSpan = `<span title="data/vna/notary-witness.ndjson at render — a mock cycle never writes it (C76)">${esc(nc.label)}</span>`;
  const attMeasure = !ch || ch.state !== 'MEASURED' ? `<b class="rr">UNMEASURED</b> <span class="dim">— ${esc((ch && ch.why) || 'no flight tape')}</span> · ${notaryLabelSpan}` : `<b>${ch.signed} signed</b> · height ${ch.height ?? '—'} · ${ch.ok ? '✅' : '❌'} · ${notaryLabelSpan}`;
  const stamp = `<span class="c3l stamp" title="the same sentence the README sells with — C97 Candidate 4, one constant">${esc(LICENCE_TOOLTIP)}</span>`;   // C95b: the body's first line
  // C89b — the receipt lines for ▸ more, each read at render and UNMEASURED on its own when its receipt is absent
  const tapeRows = (() => { try { return readFileSync(FLIGHT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return null; } })();   // null = no tape on disk: every line off it reads UNMEASURED, never a zero
  const c3lines = (() => {
    let policy = 'witness UNMEASURED · k-of-n UNMEASURED · policy UNMEASURED', probe = '⚡ boundary probe · UNMEASURED';
    try { const readingRow = (tapeRows || []).filter((r) => r.kind === 'reading').pop() || null; policy = card3PolicyLine({ notary: nc, cosign: nc && nc.cosign ? nc.cosign : null, reading: readingRow && readingRow.delta ? readingRow.delta : null }); } catch {}
    try { const car = carFor('HEAD'); probe = boundaryProbeLine(car && car.boundary_probe ? car.boundary_probe : null); } catch {}
    let licence = 'licence UNMEASURED'; try { if (tapeRows) licence = licenceStampLine({ rows: tapeRows.filter((r) => r.kind === 'commit' || r.kind === 'batch'), entitlement }); } catch {}
    return { policy, probe, licence };
  })();
  const licensed = licensedRows === undefined ? (tapeRows || []).filter((row) => { try { return licenceOf(row).status === 'LICENSED'; } catch { return false; } }).length : licensedRows;
  const fp8 = entitlement && entitlement.pubkey_fingerprint ? String(entitlement.pubkey_fingerprint).slice(0, 8) : null;
  const lastLicensedAt = (() => { try { const r = (tapeRows || []).filter((row) => { try { return licenceOf(row).status === 'LICENSED'; } catch { return false; } }).pop(); return r ? r.ts : null; } catch { return null; } })();
  const readerReading = !ch || ch.state !== 'MEASURED' ? notRun('no tape yet') : `signed ${ch.signed ?? 'UNMEASURED'} · unlicensed ${Math.max(0, (ch.rows ?? 0) - licensed)} · last countersigned receipt ${lastLicensedAt ? ageS(lastLicensedAt) : 'never'}`;
  const nBackups = backups === undefined ? (() => { try { const b = backupsPosted({ repo: REPO }); return b == null ? 0 : b; } catch { return 0; } })() : backups;   // C109o: the posted upload receipts; no backup dir yet reads 0 posted on the metric (the dir is made by the first 🔗)
  // C111: the metric is the countersigned receipts that are BACKED UP — the LICENSED rows inside the highest tape height a posted
  // upload's manifest holds (countersignedBackedUp); nothing posted → a measured 0. The backups count and the licence rows on the
  // tape move one tier down (c3backedLine), nothing removed (C103b).
  const bu = backedUp === undefined ? (() => { try { const r = countersignedBackedUp({ repo: REPO }); return r ? r : { backedUp: 0, backups: nBackups, height: 0 }; } catch { return { backedUp: 0, backups: nBackups, height: 0 }; } })() : { backedUp, backups: nBackups, height: null };
  // C113h (operator 2026-09-20: "emoji notarise insurable tape - 0 countersigned receipts - 0 3rd party backups (they are two numbers,
  // local backup is the diary, 3rd party is obviously backed up)"): the face is THREE PARTS — the label, the LICENSED rows on the
  // tape (licenceOf, C90 — the countersigned receipts), the posted upload receipts (backupsPosted — the 3rd-party backups). Two
  // kinds, two numbers, never merged. C111's intersection (the countersigned receipts inside the highest posted height) rides one
  // tier down on c3backedLine — a good number, not the face.
  const sinceIso = since === undefined ? tapeSince(tapeRows) : since;   // C122e: the clock, read off the tape (a test hands it in)
  // C141 (operator 2026-09-21, on the reload that still read "0 countersigned receipts"): a zero is the true count, and the metric names the
  // door that moves it — the 🔗 posts the archive the third party countersigns (the 3rd-party backup), the 💳 above stamps the next row
  const mover = nBackups === 0 ? ` · <span class="mover" title="C141 — what moves the zero: 🔗 Countersign (backup) posts the tape to the third party, one archive per credit; the 💳 above stamps the next row locally">${esc(DOOR_LABEL.backup)} to post one</span>` : '';
  const threeParts = `${licensed} ${COUNTERSIGNED_NOUN} · ${nBackups} 3rd-party backups${mover}${sinceIso ? ` · <span class="since" title="C122e — time on target: the date the record starts, the first row on the tape (data/vna/flight-tape.ndjson), read never typed">since ${esc(String(sinceIso).slice(0, 10))}</span>` : ''}`;
  const credits = creditsTerm(entitlement, { ledger, tapeRows: tapeRowsForAcct });   // C134: on the face in EVERY state · C139: the ledger's balance once reconciled, beside the action — the key is a receipt of its own, it reads before a tape
  const readerMetric = `${!ch || ch.state !== 'MEASURED' ? notRun('no tape yet') : fp8 ? `Signed · ${esc(fp8)} · ${threeParts}` : threeParts} · ${credits}`;   // C109a: never a bare count · C109o: never Local · C113h: two kinds, two numbers · C134: credits last, always
  const c3backedLine = `${bu.backedUp} ${COUNTERSIGNED_NOUN} backed up${bu.height == null ? '' : ` · height backed up ${bu.height}`} · ${nBackups} backups · ${licensed} ${COUNTERSIGNED_NOUN} on the tape`;
  // C89b — the trophy, not the chore (the fourth dictation): you did the work locally for free; the button seals it for the client.
  // Unfunded: 💳 Fund Autonomy Ledger (DOOR_LABEL.notarise — C132; was Notarise insurable tape) runs vna.notariseTape (C102a; label C111) — the device flow starts in the extension, the browser opens
  // /notarise?fp&h&code (C97f), the entitlement lands in SecretStorage by the poll; never the upload (C105 DOOR_SEMANTICS).
  // 🔑 Enter Key is C83b's by-hand door into SecretStorage, under ⋮ as the fallback only. Funded (🟢): ☁️ Sync tape.
  const funded = /🟢/.test(nc.label || '');
  const keyHeld = !!(entitlement && entitlement.pubkey_fingerprint && Number(entitlement.credits) > 0);   // C111/C113h/C132: ONE label in both states — DOOR_LABEL.notarise (💳 Fund Autonomy Ledger); the key state changes the title and the buy-keys line under the +, never the face
  // C173 — a CLAIM is not the same fact as CREDITS: a device holding a pubkey_fingerprint has claimed its licence, and asking it
  // to claim again on every repaint (the 2026-09-22 screenshot: 0 credits, the box back each time) is the defect. The claim hides
  // the key box; zero credits is a top-up line under the 💳, never a second claim.
  const claimed = !!(entitlement && entitlement.pubkey_fingerprint);
  const c3button = funded
    ? primary('vna.syncTape', DOOR_LABEL.sync, readerMetric, 'send the signed rows the notary has not seen to the co-signer and keep its receipts beside the tape (data/vna/notary-witness.ndjson) — one credit per witnessed commit; the receipts carry the MMR proof once C85a lands; next: read k-of-n and the policy line in ▸ more', 'action cta')
    : keyHeld
    ? primaryAlt('vna.notariseTape', DOOR_LABEL.notarise, readerMetric, `${LICENCE_TOOLTIP} the key with credits is held: every new row is stamped locally as it is written, one credit per row; this opens thetadriven.com/notarise?fp=<fp>&h=<h>&code=<code> again to top up — nothing leaves the machine; next: 🔗 Countersign (backup) when someone asks for the tape`, 'action cta')
    : primary('vna.notariseTape', DOOR_LABEL.notarise, readerMetric, `${LICENCE_TOOLTIP} You did the measuring locally for free; this starts the device flow from the extension and opens thetadriven.com/notarise?fp=<fp>&h=<h>&code=<code> for THIS tape — a simple card checkout, the key lands in SecretStorage by the poll with nothing to paste, and the licence stamps your new rows locally, one credit per row up to 10,000, nothing leaves the machine; next: this card reads Signed · <fp8> · credits N`, 'action cta');
  // C105c (operator 2026-09-20: "Make backup visible on plus … to third party"): 🔗 Countersign (backup) (DOOR_LABEL.backup; was 🔗 Backup to third party) sits INLINE under
  // the + in every state — the one door on this card that leaves the machine, named as such, never folded behind ⋮ — its
  // class `sb backup` keeps it out of fold()'s `<button class="sb"` cut and names it as C102d's third inline exception
  const c3backup = B('vna.backupTape', DOOR_LABEL.backup, 'post the tape + proofs as one content-addressed archive to thetadriven.com/api/backup/upload with your key — this is the door that LEAVES the machine, to the third party: a second reader who is not you countersigns the same bytes and keeps them where your lead can fetch and recompute them; it spends licence credits, one per archive; the manifest URL prints here, no file to find; next: paste that URL to a client, it carries no credential', 'sb backup');
  const c3backupLine = (() => { try { return backupCardLine({ repo: REPO }); } catch { return 'backup UNMEASURED'; } })();   // C102c: the newest upload receipt's URL, or what is bundled and not posted
  const c3countersign = countersign === undefined ? (() => { try { return countersignLine({ repo: REPO }); } catch { return null; } })() : countersign;   // C135b: the instant of the lock, off the same receipt (a test hands it in)
  const c3sign = B('vna.signTape', DOOR_LABEL.sign, 'sign the last authored commit (never the hook chore(commit-page) commit) onto the tape with your own key, free, local — every new row is already signed at append; this appends the commit row for HEAD now (auth-flow.mjs sign --sha HEAD); next: 💳 when you want a second key on the same rows', 'sb');
  // C136 (operator 2026-09-21, verbatim: "Maintain the direct license paste field strictly behind the ⋮ menu on the ledger pill … leaving the
  // manual bypass intact" · "🔌 Connect is the primary door") AMENDS C122f: the paste door (vna.enterEntitlement — the masked input box,
  // verified against the site's key before SecretStorage, C83 · C102a) leaves the face and sits LAST under ⋮ (details.ctx) as the bypass;
  // 🔌 Connect (the device flow, C75 — the key lands with nothing to paste) is the primary key door, FIRST under the same ⋮, moved up from
  // ▸ more. Neither is a face door: a face door opens a file and spawns nothing (C122c · C109m.5); the device flow spawns a process. The 💳
  // stays the reader's one .action (C109c). C102a.2's "sits under ⋮" holds again. Both class sb, so fold() takes them behind the ⋮.
  const c3connect = B('vna.connect', '🔌 Connect', 'OAuth 2.0 device flow on the tape\'s own key: the site shows a user code, login + payment + the licence happen there, the signed entitlement lands in SecretStorage (C75) with nothing to paste; next: the 💳 reads credits left');
  const c3keyDoor = B('vna.enterEntitlement', '🔑 Paste licence key', 'the manual bypass — paste the licence key off the receipt page into a masked input box; the key is verified against the site\'s signing key before it is stored in VS Code SecretStorage, never in a file or a setting, and every new row is stamped locally from then on, one credit per row; next: 💳 reads credits left');
  const c3secondaries = c3backup + c3connect + c3sign + c3keyDoor;   // C105c: the backup stays inline (sb backup); ⋮ holds Connect · Sign · Paste, in that order (C136)
  let priceLine = COUNT_UNMEASURED; try { const pr = notaryPriceFromReceipt({ file: resolve(REPO, NOTARY_PRICE_RECEIPT) }); priceLine = pr.price ? countLine({ price: pr.price }) : COUNT_UNMEASURED; } catch {}
  // C131 — the empty state under the 💳: while no key with credits is held and the notary is not 🟢, the clock (C122e — the first LICENSED
  // row) is not running and new rows go unstamped; the line says so in the live bar's tip-warn idiom, once, outside the button and the +
  const c3under = funded || keyHeld ? '' : claimed ? `<div class="c3l empty" data-beat="top-up" title="C173 — this device holds a claim (${esc(String(entitlement.pubkey_fingerprint))}) with no credits left: the licence is bound here, only the balance is spent; the 💳 tops it up, nothing to paste"><span class="tip warn">${esc(LEDGER_EMPTY_LINE)}</span> <span class="tip">🔑 ${esc(String(entitlement.pubkey_fingerprint).slice(0, 8))} claimed · 0 credits · the same 💳 tops up</span></div>` : `<div class="c3l empty" title="C131 — read off the entitlement: no licence key with credits is held in SecretStorage"><span class="tip warn" title="${esc(`the ledger is not funded: no key with credits is held, so no new row is stamped and the time-on-target clock (the first countersigned row on the tape) has not started; next: ${DOOR_LABEL.notarise} — the clock starts on the first stamped row · already bought on the site? ⋮ › 🔌 Connect, sign in with the email you bought under, Approve — the key lands here by itself (C160)`)}">${esc(LEDGER_EMPTY_LINE)}</span></div>`;
  // C200 (operator 2026-09-23, verbatim: "that pill nees to be hierarchically expanded under fund ledger (else yo see engine and license
  // keys at the same time (they need to make sense by being bunched up)"): the 🔑 licence pill is no longer a flat sibling of the pills
  // wearing a two-indent class — collapsed, 💳 still showed it, beside 🔑 Engine keys under ⚡ Run Headless, two key pills at once. It is
  // now the FIRST thing inside the 💳's own + (pillInner's `nested` slot, right after the name line): expand the ledger and the licence
  // is there, bunched with the balance it funds; collapse it and one 🔑 remains on the page, the runner's. The block therefore sits
  // ABOVE the c3 card that embeds it. C173a's beat, face and door are unchanged — only where the pill lives. Class `nested`, never
  // `indent deep`: inside a drawer the indent is the parent's. Guard: c200-which-tells-you-that-that-pill.test.mjs.
  // C161 THE KEY BOX (operator 2026-09-21, after buying on the site: "we need a box / form in the extension at the top for that"): while no
  // licence key with credits is held, one line at the top — paste a licence key OR the claim token from the purchase email; the extension
  // hands the text to vna.enterEntitlement, which verifies a key or completes a claim (the site binds the account's unclaimed licences
  // to this device and returns the key). Gone the moment a key is held. Not a pill: no +, no metric — a form, the one the operator asked for.
  // C173a (operator 2026-09-22: "the paste key must be in the fund auto pill as a sub pill inside it") — the C161 box is no longer a banner
  // above the pills: it is the 🔑 sub-pill under 💳, one indent deeper, beside ⚙️ Tokens per cog. No claim on this device → the face is the
  // masked input handed to the existing door (vna.enterEntitlement → ingestEntitlement); a claim held → the face READS it, fp8 · credits.
  const keyCredits = entitlement && entitlement.credits != null ? Number(entitlement.credits) : null;
  // C182 — MANY LICENCES LOCK TO ONE MACHINE, AND PASTING A LIST LOCKS THEM ALL: the server already sums every credits_ledger
  // row under this fingerprint; the client tracks it in .thetacog/claimed-licences.ndjson, one row per account claimed here
  // (auth-manager.ts appendClaimHistory, on every verified claim — a single paste or one of a pasted list). k>1 → the face
  // reads `🔑 <k> licences · <fp8> · <sum> cr`; k<=1 (the common case, and every existing fixture with no history file) keeps
  // the EXACT single-claim text C173a.2 pins, byte for byte — the history only ever ADDS a reading, never changes the old one.
  const claimHistoryR = claimHistory === undefined ? readClaimHistory() : claimHistory;
  const licSummary = claimed && fp8 ? summarizeClaims(claimHistoryR, entitlement.pubkey_fingerprint) : null;
  // C199 (operator 2026-09-23, verbatim: "the convention is + action then metrics, so key [+ 🔑 Licence · 19d66dc5 claimed] license should
  // take you to the engine and keys page"): the 🔑 label is no longer a <span class="lbl"> that does nothing — it is the pill's ACTION, a
  // `button.action` opening ⚙️ Engine & Keys through the runner's own door (vna.openEnginesConfig, C179 — one command, never a second);
  // the claim (or the paste input) follows it as the metric, byte-identical to what C173a.2 / C182 pin. Guard: c199-the-convention-is-action-then-metrics.test.mjs.
  const keyFace = claimed
    ? (licSummary && licSummary.k > 1
        ? `${B('vna.openEnginesConfig', '🔑 Licences', `open ${ENGINE_KEYS_LABEL} (C198) — the page that reads this claim beside the engines it pays for and takes another licence (C182d); the claim after this button is the metric, read off the entitlement, never the key`, 'action')} · <span class="measure">${licSummary.k} licences · ${esc(fp8)} · ${licSummary.sum} cr</span>`
        : `${B('vna.openEnginesConfig', '🔑 Licence', `open ${ENGINE_KEYS_LABEL} (C198) — the page that reads this claim beside the engines it pays for and takes another licence (C182d); the claim after this button is the metric, read off the entitlement, never the key`, 'action')} · <span class="measure">${esc(String(entitlement.pubkey_fingerprint).slice(0, 8))} claimed · ${keyCredits == null ? 'credits UNMEASURED' : `${keyCredits} credits`}</span>`)
    : `${B('vna.openEnginesConfig', '🔑 Paste a licence', `open ${ENGINE_KEYS_LABEL} (C198) — the bigger paste box (C182d: one licence or a list) and the engines the credits pay for; the inline box beside this button is the same door`, 'action')} · <input id="keybox-in" type="password" placeholder="🔑 paste a licence key or claim token" autocomplete="off" onkeydown="if(event.key==='Enter'){go('vna.enterEntitlement',this.value);this.value='';}"><button class="sb" onclick="var i=document.getElementById('keybox-in');go('vna.enterEntitlement',i.value);i.value='';" title="claim it to this device — the key lands in SecretStorage, the 💳 pill reads Signed · credits">Claim to this device</button>`;
  const cKey = `<div class="card3 c-key pill nested" data-beat="${claimed ? 'key-claim' : 'key-box'}" title="the licence on this device (C161 · C173 · C173a · C200 — inside the 💳's +, shown only when the ledger is expanded): paste the licence key from the purchase email, or the claim token it carries when it was bought on the site without a device; once claimed the face reads the claim"><div class="c3l face">${keyFace}${plusFold('key', 'the licence — paste a key or claim token; the site binds it to this device only (C173e: a second device is refused); next: 💳 reads Signed · credits', '<span class="c3l dim">one machine, one device — the key lives in the machine keychain (C173d), SecretStorage mirrors it</span>')}</div></div>`;
  // C172 (operator 2026-09-22: "that absolutely needs to be a sub pill to fund the autonomy ledger (on plus)"): 💳 Fund Autonomy Ledger is a
  // SUB-PILL of ⚡ Run Headless — indented under it the way 🔍 View Aperture Receipt sits under 🚶 Walk HEAD, the credits metric (C134) on its
  // face as before; its own sub-pills (⚙️ Tokens per cog) sit one indent deeper
  const c3 = card('c-attest', 'THE SECOND READER', 'attest', c3button,
    { indent: true, nested: cKey, spark: SPARK_LINES.reader, doc: 'reader', under: c3under, acct: accountSpan(entitlement, { ledger, tapeRows: tapeRowsForAcct }), reading: `· ${readerReading}`, plusTitle: `the second reader — the signed rows and the height, the price and why you pay, the key, buy keys, the three doors (sign · notarise · countersign); next: ${DOOR_LABEL.notarise}`,
      next: nextUnder('attest'), face: `<div class="c3l">${stamp}</div><div class="c3l">${attMeasure} · <span class="whymove" title="C109a — the sentence the blank cost: a lead who can recompute your tape buys the next key">${esc(COUNTERSIGNED_WHY)}</span></div>`,
      more: F('attest'),
      mid: `<span class="c3l dim buykeys" title="C111 — notarise and buy keys are the same move, one under the other: the 💳 above IS the purchase (thetadriven.com/notarise, a card checkout, the key lands in the extension by the poll); this line reads the key state off the entitlement">${esc(DOOR_LABEL.buy)} · ${keyHeld ? `${creditsTerm(entitlement, { ledger, tapeRows: tapeRowsForAcct })} held · the same 💳 tops up` : `${creditsTerm(entitlement, { ledger, tapeRows: tapeRowsForAcct })} · the same 💳 above buys them`}</span><span class="c3l dim backedline" title="C111/C113h — behind the face's two numbers: the countersigned receipts inside the highest tape height a posted archive holds (countersignedBackedUp), the posted upload receipts, the licence rows on the tape (licenceOf, C90)">${esc(c3backedLine)}</span><span class="c3l">${fold(c3secondaries)}</span><span class="c3l dim backupline" title="backupCardLine (C102c): the newest upload receipt under .thetacog/backup — the URL the site answered, read, never typed; C135b: the line leads with the instant of the lock off that receipt (countersigned_at, else its local at)">${c3countersign ? `${c3countersign} · ` : '🔗 '}${esc(c3backupLine)}</span><span class="c3l dim" title="countLine (C99c): the count is read off the committed price receipt (data/vna/notary-price.json), never typed">${esc(priceLine)}</span>${WHY_YOU_PAY.map((s) => `<span class="c3l dim whypay" title="C102f — SUPPORT · LOCAL · LATER, byte-identical to the checkout page">${esc(s)}</span>`).join('')}${cogTier}`,
      drawer: more('details-attest', 'the entitlement · credits · the witness · what this funds; next: 🔌 Connect under ⋮ when you hold a key', `<span class="c3l dim nobadge" title="the same sentence both READMEs carry in their boundary section — C100a, one constant; C80b keeps it behind the fold">${esc(NO_BADGE)}</span><span class="c3l dim funds" title="C119j — what a licence pays for, said plainly: the measurement is free (MIT), the seat funds its builders">${esc(WHAT_THIS_FUNDS)}</span><span class="c3l dim">${/🟢/.test(nc.label || '') ? `witnessed — ${nc.verified ?? '?'} of ${nc.rows ?? '?'} receipts verify (C81b) · ${entitlement && Number.isFinite(entitlement.credits) ? `credits left ${entitlement.credits}` : 'credits UNMEASURED — connect'}` : /🔴/.test(nc.label || '') ? `not witnessed — the newest receipt does not verify (${nc.verified ?? 0} of ${nc.rows ?? '?'} do); the card never goes green on an unverified row (C81b)` : 'air-gapped — no notary has receipted this tape yet'}</span>${funded ? `<span class="c3l dim" title="card3PolicyLine (C87a): the witness root · verified co-signers against the policy's k (C85b) · the last policy reading on the tape (C87) — each term UNMEASURED on its own when its receipt is missing">${esc(c3lines.policy)}</span>` : ''}<span class="c3l dim" title="licenceStampLine (C90): rows on the tape whose signed bytes carry the licence's public claims (proofs.licence) — signed under licence, never by it; the bearer never rides a row">${esc(c3lines.licence)}${nc && nc.tray ? ` · ${esc(nc.tray)}` : ''}</span><span class="c3l dim" title="boundaryProbeLine (C86): the boundary-crossing cost measured on THIS machine with its [min, max] spread, from data/vna/underwriting.json — rung 3; whether this was silicon is not what it proves">${esc(c3lines.probe)}</span><span class="c3l dim">the measurement is free; the underwriting is paid — this funds the co-signer</span><span class="c3l dim sniff" title="C102e — one admissible line from the story, every noun a door in the flow">${esc(STORY_SNIFF)}</span><span class="c3l"><span class="rs" title="the entitlement in context.secrets, read on repaint (C75)">${esc(runRowLabel(entitlement, fingerprint))}</span></span>`) });
  // 6 · SENSE-MAKING BRIDGE — metric: what the last one-shot ingest's fold DID (C98e) · the button is ⤵ Ingest Clipboard (the
  // first click on day one; 🧠 Copy Prompt Bundle is the second, one tier down)
  const c4 = card('c-bridge', 'SENSE-MAKING BRIDGE', 'bridge',
    primary('vna.clipIngest', '⤵ Ingest Clipboard', bridgeMetric, 'one click: the clipboard lands on the steer file under a clip stamp, becomes a ledger row, and the fold runs now — the card then prints what the fold did (N new · M attached · R RELEASED) and names each released ask by its first line, basin and d; a secret, our own export, a path or a clip already on the file is refused and says why; next: read the released asks, then 🧠 Copy Prompt Bundle', 'action cta'),
    { spark: SPARK_LINES.bridge, doc: 'bridge', reading: `· last paste ${ci && ci.at ? ageS(ci.at) : 'never'} · ${clip && Number.isFinite(clip.appendedToday) ? clip.appendedToday : 'UNMEASURED'} appended today`, plusTitle: 'the bridge — the bundle on disk, the prompt bundle and the refined goal doors, the last ingest; next: 🧠 Copy Prompt Bundle',
      face: `<div class="c3l">${bMeasure}</div>`,
      mid: `<span class="c3l">${fold(B('vna.copyResearch', '🧠 Copy Prompt Bundle', 'rebuild RESEARCH-BUNDLE.txt from the receipts and copy it: the active basin, the recent Δ coordinates, the open rows and the goal, with the handshake — paste it to a browser model (Gemini, Claude); next: 📥 Ingest Refined Goal with its answer on the clipboard') + B('vna.ingestGoal', '📥 Ingest Refined Goal', 'read a refined /goal from the clipboard and run goal.mjs import --validate --install — every row it names must be a basin in spec-tree.json or the gate refuses and says which; on ACCEPTED it is written to data/vna/goal.json and card 1 shows unit 1; next: run it headless on card 2'))}</span>${ciLine}`,
      drawer: more('details-bridge', 'the last ingest · how the answer lands; next: paste the answer back with auto-paste on', `<span class="c3l dim">paste the answer back with auto-paste on — each paragraph lands in its row (C52b); no local model on this path</span>`) });
  void c4;   // C196 (2026-09-23): c4 is dead code, NOT a dropped wire — bridgeTier (defined above, ~L1423) is the live
  // implementation of this same content (🧠 Copy Prompt Bundle · 📥 Ingest Refined Goal · bMeasure · ciLine) and is
  // already threaded into the c-contract pill's `mid` (search bridgeTier's other use). Confirmed by tests/vna/
  // c113d-complexity-under-the-keys.test.mjs's own ten-pill list, which has no c-bridge entry, nested or not — c4/
  // c-bridge was tried and superseded, not silently dropped. Re-wiring bridge:c4 here would duplicate copyResearch/
  // ingestGoal buttons on the page and break that test. See tests/vna/sense-making-bridge.test.mjs's C196 fix instead.
  const cCog = renderCogCard(cogD, { now, pill: true, deep: true, under: `${renderDignityRatchet({ cog: cogD, pct: cogPctR, pixel: pixelR })}${F('cog')}`, faceMetric: cogFaceMetric(cogD, cogPctR) });   // C152: the tenth pill — ⚙️ Tokens per cog with its graphs, indented under 💳 Fund Autonomy Ledger (operator 2026-09-21: "we lost the cog per token graphs, the most hyperstitioning part we had, it must be a top level")
  // ── the other five of the nine (C141) ──────────────────────────────────────────────────────────────────────────────────────────
  // 2 · 🟢 auto-paste (root) — the toggle and its health verifiers (C144); the feed doors and what the page folds here ride under its +
  const ing = ingest === undefined ? (() => { try { return readIngest(); } catch { return null; } })() : ingest;
  const tAt = treeAt === undefined ? (() => { try { return statSync(D('spec-tree.json')).mtime.toISOString(); } catch { return null; } })() : treeAt;
  const cPaste = renderLiveLine(hb === undefined ? null : hb, { clip, clipIngest: ci, ingest: ing, treeAt: tAt, meter, gauge: gauge === undefined ? null : gauge, now, entitlement, ledger, tapeRows: tapeRowsForAcct, refreshAge, lagHtml, doorsLine: doors == null ? '' : String(doors), doorsDisagree, avbLine, mid: feedDoors, more: F('paste') });
  // 3 · 🌳 Open Tree (indented under auto-paste — the tree is what the paste folds into)
  // C146: 🌳 Open Tree prints nodes · root sha8 · revisions · rows behind the tape — the tree receipt (spec-tree.json, a value or the file) and the fold receipt already read for the auto-paste line
  const streeR = stree === undefined ? load('spec-tree.json', 'node scripts/vna/spec-tree.mjs') : stree;
  const cTree = renderTelemetry(loop, { now, build, doors, backups: tapeBackups, indent: true, more: F('tree'), metric: treeMetric(streeR, ing && ing.fold ? ing.fold : null) });   // C139: the account state is the 💳 pill's reading (and the auto-paste pill's, the heartbeat) — painted twice on the page, never a third time (C98f)
  // 5 · 🔍 Inspect Halt Reason (indented under ⚡ Run Headless) — the halt row and the red witness, off the runner receipts (C147 adds the health metrics)
  // C147: the health reading off the runner rows (a value the caller hands in, else .thetacog/runner.ndjson; null → not run) — halts of dispatches · last halt age · red witness state · the last verdict
  const rowsR = runnerRows === undefined ? runnerRowsOf(resolve(REPO, '.thetacog/runner.ndjson')) : runnerRows;
  const hh = haltHealth(rowsR, { now });
  const haltMetric = `${halted ? `<span class="rr wit">HALTED</span> · ${esc(String(r.reason || '').slice(0, 80))} · ` : ''}${haltMetricOf(hh, { now })}`;
  const cHalt = card('c-halt', 'HALT REASON / RED WITNESS', 'halt',
    primary('vna.inspectHalt', '🔍 Inspect Halt Reason', haltMetric, haltTitle),
    { indent: true, spark: 'why the worker stopped, in the file\'s own words — and whether the red witness was seen', reading: `· ${halted ? 'halted' : 'no halt'} · ${wit ? `red witness ${esc(wit.status)}` : 'red witness UNMEASURED'}`, plusTitle: 'the halt — the reason row in full, the red witness and its why, the retry; next: fix the named cause, then ⚡ Run Headless',
      next: nextUnder('halt'), face: `<div class="c3l dim"><span class="sl">halt</span> <span class="rs">${halted ? esc(String(r.reason || '')) : 'the runner\'s last row is not HALTED — this branch is closed'}</span></div>${wit && wit.why ? `<div class="c3l dim"><span class="sl">witness</span> <span class="rs">${esc(`${wit.label ? wit.label + ' — ' : ''}${wit.why}`)}</span></div>` : ''}`,
      mid: `<span class="c3l">${fold(retry)}</span>`, more: F('halt') });
  // 6–8 · the tiles, 🚶 Walk HEAD (root), 🔍 View Aperture Receipt (indented), 📋 Copy Run Summary (indented) — the walk pill folds RINGS, NEXT → at the walk step, and the page's walk folds
  const cockR = cock === undefined ? { missing: true, cmd: 'node scripts/vna/cockpit.mjs' } : cock;
  const apR = aperture === undefined ? (() => { try { return loadApertureReceipt(); } catch { return null; } })() : aperture;
  const walkHtml = renderTriptych(cockR, { now, preview, turn, legendHtml: legendHtml === undefined ? null : legendHtml, behind, aperture: apR, between: nextUnder('walk'), under: F('walk'), fork: laneActions, forkForce: paused });
  const cAperture = renderApertureLine(apR);
  // C233 🎙️ THE AUDIO STREAM PILL — directly above 📋 Copy Run Summary (operator 2026-09-25: "it should be above copy run summary - checkobx, click to open, stats on ingest/minute")
  const cAudio = renderAudioPill(audio === undefined ? (() => { try { return readAudio(); } catch { return null; } })() : audio);
  const cExport = card('c-export', 'EXPORT', 'export',
    primary('vna.copyRunSummary', '📋 Copy Run Summary', exportMetric({ outbound: outbound === undefined ? readOutbound() : outbound, verified: verified === undefined ? verifiedLine({ cock: cockR, aperture: apR, tapeRows: tapeRowsForAcct }) : verified, now }), 'one line for the team — unit · verdict with its gates · the worker\'s tokens · tokens not re-sent · Δ, each from runner.ndjson, the meter and the cockpit, never typed; next: paste it where "what did the agent do" gets asked'),
    { indent: true, spark: 'the run summary and the Verified line, copied out for a chat — stamped, never re-ingested', reading: `· ${esc(verified === undefined ? verifiedLine({ cock: cockR, aperture: apR, tapeRows: tapeRowsForAcct }) : String(verified || 'Verified by ThetaCog: UNMEASURED'))}`, plusTitle: 'the export — the Verified line in full, the whole-state export for a chat; next: 📋 Copy Run Summary, then paste it in the chat on the right',
      face: '', mid: `<span class="c3l">${fold(B('vna.copyPayload', '📋 export', 'copy the state for a chat — stamped, never re-ingested; next: paste it into the chat on the right'))}</span>`, more: F('export') });
  // C321b 📈 OPTIMISATION TARGETS — deep (third level) under 📋 Copy Run Summary: the census list + hook-latency graphs, read off receipts,
  // never in the copied line (the copy is the outward receipt; this is the instrument's own health). Computes nothing.
  const optR = optTargets === undefined ? (() => { try { return renderOptTargets(loadOptTargets()); } catch { return renderOptTargets({}); } })() : renderOptTargets(optTargets || {});
  const cOpt = card('c-opt', 'OPTIMISATION TARGETS', 'opt', `<span class="action lbl" title="every optimisation target the ratchet census found, with graphs where a series exists">📈 Optimisation Targets</span> · <span class="measure">${optR.face}</span>`,
    { deep: true, beat: 'opt', spark: 'what each cost is trending to — the census of every floor and ratchet, and the hook latency every turn pays', plusTitle: 'the optimisation targets — graphs, then every target the census found', drawer: optR.drawer });
  // C142 THE SEQUENCE IS THE LOOP — the ONE triptych first (operator 2026-09-21: "the panels need to be at the top of the page"), then the nine in
  // THE OPERATOR'S numbering (2026-09-21, "reread the spec I set"): 1 🚶 Walk HEAD · 1b ⚡ Run Headless · 2 💳 Fund the ledger · 3 🟢 auto-paste
  // [4 🔍 View Aperture Receipt · 4b 📋 Export · 5 🌳 Open Tree] · 6 📄 Open Spec [7 🔍 Halt reason] — five root, four indented;
  // C151 (operator 2026-09-21: "aperture receipt belongs under the panels, maybe as a indented under walk head") moves 4 up under 1
  const WALK_MARK = '<div class="triptych card3 c-walk pill">'; const iw = walkHtml.indexOf(WALK_MARK);
  const tilesHtml = iw >= 0 ? walkHtml.slice(0, iw) : ''; const cWalk = iw >= 0 ? walkHtml.slice(iw) : walkHtml;
  // C201b (operator 2026-09-23, verbatim: "keep it in the subdivided section at the VS code level … but then don't have it in the tree"):
  // the chat is NOT a pill on this page any more — it lives in its own sidebar section (thetacog.chat, vna-chat.ts), bottom-left,
  // because it is not the same kind of thing as the control pills. The 💬 pill, its inline form, dropdowns, checkbox and seam list were
  // removed here; the one transcript (C167h) and the /steer verbs (C201a (4)) live in that section. Guard: c201b-the-chat-lives-in-its-own-ide-section-not-the-steer-page.test.mjs.
  // C179 — THE 🔑 API KEY SUB-PILL SITS INSIDE THE ⚡ RUNNER CARD, one indent under it (the same tier as 💬 Local Ideation and
  // 💳 Fund Autonomy Ledger, never a second key store — a FACE of C166's SecretStorage): one row per engine the runner can
  // dispatch, each reading `key held (<fp8>)` / `no key` from VNA_ENGINE_KEY_ROWS (vna-engines.ts engineKeyRowsEnv, merged
  // into every render spawn beside VNA_ENTITLEMENT_CLAIMS) — never the key itself. An engine the runner cannot yet dispatch
  // (no driver seam, C167f's SEAMS) reads `UNMEASURED — not built` regardless of whether a key is held.
  const engineKeyRowsR = engineKeys === undefined ? engineKeyRowsFromEnv() : engineKeys;
  // C245 (operator 2026-09-24, on a screenshot: "all pills need the same formatting, plus and puills in the same element, with an action
  // on the button … no plus, and no metrics on the expanded pill section"): the keys pill is the SAME pillBox as every other pill —
  // the door on the face, the + inside the face beside it, and the METRICS behind the +: one row per engine off the C239 rows
  // (VNA_ENGINE_KEY_ROWS, never a second store) — held / no key, the fp8 (never the key), and when it was set (setAt, off the C179a
  // audit ledger; a held key with no row reads "set — no record", never a made-up time). The face keeps one count. A host that
  // passes no rows gets one line, "open ⚙️🔑 Engine & Keys to read", never nothing. Supersedes C179c's "one line, no + drawer".
  // C179b still holds: the face is the BUTTON to the page, never a bare label, and no host/env jargon anywhere on the card.
  // Guard: c245-one-pill-shape-the-plus-inside-the-pill.test.mjs (+ c179b for the door).
  const engineKeyRows = Array.isArray(engineKeyRowsR) ? engineKeyRowsR : [];
  const fmtSetAt = (iso) => String(iso).replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}).*$/, '$1 $2Z');
  const engineKeyLines = engineKeyRows.map((r) => `<span class="c3l dim engkey"><b class="lb">${esc(String(r.engine))}</b> <span class="measure">${esc(String(r.line))}</span>${r.setAt ? ` <span class="dim">set ${esc(fmtSetAt(r.setAt))}</span>` : r.held ? ' <span class="dim">set — no record</span>' : ''}</span>`).join('');
  const heldN = engineKeyRows.filter((r) => r.held).length;
  // C150d: a primary's metric rides as its button's NEXT SIBLING, class "measure" — cEngineKeys's own button is
  // class="action" (C179/C245), so its metric must follow that same convention. It didn't (class "c3l dim"), which broke
  // faceButtons()-style parsers (tests/vna/_c101b-states.mjs): a regex expecting `</button> · <span class="measure">`
  // right after an .action button found a plain space instead here, so it backtracked past this button's own close and
  // absorbed the NEXT card's button and metric as if they were this one's (C103d/C78a's guards, discovered 2026-09-25).
  const keysOpenLine = `<span class="measure">open ${ENGINE_KEYS_LABEL} to read</span>`;
  const keysMetric = engineKeyRows.length ? `<span class="measure">${heldN} of ${engineKeyRows.length} held</span>` : keysOpenLine;
  const cEngineKeys = pillBox('c-engine-keys', 'engine-keys', B(ENGINE_KEYS_COMMAND, ENGINE_KEYS_LABEL, `open ${ENGINE_KEYS_LABEL} — the page that sets and reads the keys (SecretStorage, C166); the rows behind this pill's + are a face of it, never a second store`, 'action'),
    { faceDoor: ` · ${keysMetric}`, indent: true, beat: 'engine-keys', plusTitle: 'the keys the runner can spend, per engine — held / no key, the fp8 (never the key), and when it was set (C245); read from SecretStorage through the host, never the key itself',
      inner: pillInner(ENGINE_KEYS_LABEL, { spark: 'the keys the runner can spend, per engine — held / no key · fp8 · when it was set', face: engineKeyLines || keysOpenLine }) });
  return `${tilesHtml}<div class="cards3 pills">${cWalk}${cAperture}${c2}${cEngineKeys}${c3}${cCog}${cPaste}${cAudio}${cExport}${cOpt}${cTree}${c1}${cHalt}</div>`;   // C200: the 🔑 licence pill (cKey) is inside c3's + now, never a flat sibling   // C151: the aperture receipt is what the walk looked at — indented under 🚶 Walk HEAD, never under auto-paste · C167d: the chat sub-pill sits right after ⚡ Run Headless, ahead of 💳 · C179: the engine-keys sub-pill sits right after ⚡ Run Headless too, ahead of chat
}
// ── C233 🎙️ THE AUDIO STREAM PILL — the checkbox arms the basin (vna.audioArm / vna.audioDisarm), the face opens the transcript
// txt (vna.audioOpen), and every number is read off the basin's receipts by audioStats (scripts/vna/audio-basin.mjs): ingest per
// minute with a 30-bar spark, heard/chunks, transcription ms and lag, slotted · junk · owed, and the Merkle tree's last 30 min —
// roots, nodes added, spec nodes added, ledger rows. Absent receipts read UNMEASURED; nothing is typed.
// The dictation pill's health (operator 2026-09-24, verbatim: "it needs to have an output of the health of what happened with what
// was dictated"): heard · transcribed · appended · slotted · junk, each a count off the receipts.
export const audioName = (s) => `${s && s.armed ? '🎙️' : '🔇'} audio`;
export function audioToggle(s) {
  const armed = !!(s && s.armed);
  return `<label class="sb chk ${armed ? 'on' : ''}" title="${armed ? 'the mic is transcribed locally into .thetacog/audio/stream.txt and slotted into the tree on a timer; untick to stop listening' : 'tick to listen: the mic is transcribed on this machine (whisper, Silero VAD), one line per utterance, and slotted into the tree on a timer; nothing leaves the machine'}"><input type="checkbox" ${armed ? 'checked' : ''} onchange="go(this.checked ? 'vna.audioArm' : 'vna.audioDisarm')"> ${audioName(s)}</label>`;
}
// C233b 🔨 the second box — auto-build the admissible parts (operator 2026-09-26: "we may neednother check box for auto build the
// admissable parts of what it hears"): ticked, each slotted batch is split at pauses, walked, and only walk-admitted parts go to /steer
export function autobuildToggle(s) {
  const on = !!(s && s.autobuild);
  return `<label class="sb chk ${on ? 'on' : ''}" title="${on ? 'say "steer …" or "build …": that part goes to /steer like a typed /steer (≤ 2 cycles, $20 each; the walk reading rides on the receipt); everything else only slots; untick to stop' : 'tick to build by voice: a part of what the mic hears that opens with "steer …" or "build …" goes to /steer like a typed /steer (≤ 2 cycles, $20 each); off, speech only slots into the tree'}"><input type="checkbox" ${on ? 'checked' : ''} onchange="go(this.checked ? 'vna.audioAutobuildOn' : 'vna.audioAutobuildOff')"> ${on ? '🔨' : '⚪'} auto-build</label>`;
}
export function renderAudioPill(s, { indent = true } = {}) {
  const open = B('vna.audioOpen', '🎙️ Audio Stream', 'open the transcript — .thetacog/audio/stream.txt, one timestamped line per utterance', 'action');
  if (!s) return pillBox('c-audio', 'audio', `${audioToggle(null)} ${open}`, { faceDoor: ` · <span class="measure">${notRun('node scripts/vna/audio-basin.mjs status')}</span>`, indent, beat: 'audio', plusTitle: 'the audio basin has no receipt yet' });
  const f = (v, u = '') => (v == null ? 'UNMEASURED' : `${v}${u}`);
  const st = !s.armed ? '⚪ off' : s.alive ? '🎙️ LIVE' : s.error ? `❌ ${esc(s.error)}` : '🟡 armed · daemon not running';
  const face = `${st} · ${s.perMin}/min <span class="spark">${s.spark}</span> · owed ${s.pending} · 🌳 +${s.nodesAdded} nodes · spec +${s.specAdded.length} <span class="dim">(30 min)</span>`;
  const L = (label, body) => `<span class="c3l dim"><b class="lb">${label}</b> <span class="measure">${body}</span></span>`;
  const lines = [
    L('ingest', `${s.utterances} utterances · ${s.words} words · ${s.perMin}/min · ${s.wordsPerMin} words/min · <span class="spark">${s.spark}</span>`),
    L('health', `heard ${s.speechChunks}/${s.chunks} chunks · transcribed ${s.utterances} · slotted ${s.slotted} · carried ${s.carried} · junk ${s.junk} · owed ${s.pending} · reached the ledger once ${s.reachedOnce} · twice ${s.reachedTwice}`),
    L('speed', `transcribe ${f(s.transcribeMs, ' ms')} per chunk · RTF ${s.rtf == null ? 'UNMEASURED' : s.rtf.toFixed(3)} · lag ${s.lagMs == null ? 'UNMEASURED' : (s.lagMs / 1000).toFixed(1) + ' s'} · in tree after ${s.slotLagMs == null ? 'UNMEASURED' : Math.round(s.slotLagMs / 1000) + ' s'} · fold ${f(s.foldMs, ' ms')}`),
    L('merkle', `${s.roots} roots · +${s.nodesAdded} nodes · ${s.revisions == null ? 'revisions UNMEASURED' : '+' + s.revisions + ' revisions'} · root ${esc(s.root || 'UNMEASURED')}`),
    L('spec', `+${s.specAdded.length} spec nodes${s.specAdded.length ? ' — ' + esc(s.specAdded.slice(-8).map((x) => x.replace(/^n_spec_/, '')).join(' ')) : ''} · ledger ${s.ledgerRows} rows · ${s.ledgerBytes} B · ${s.ledgerAudio} 🎙️`),
    L('build', `${s.autobuild ? '🔨 on' : '⚪ off'} · ${s.builtParts || 0} parts walked · ${s.builtAdmissible || 0} admissible · ${s.builtAddressed || 0} addressed ("steer …") · ${s.builtDispatched || 0} dispatched${s.builtBusy ? ` · ${s.builtBusy} busy` : ''} (30 min)`),
    L('config', `${esc(s.model)} · chunk ${s.chunkS}s · slot every ${s.ingestEveryS}s${s.pid ? ' · pid ' + s.pid : ''}`),
  ].join('');
  return pillBox('c-audio', 'audio', `${audioToggle(s)} ${autobuildToggle(s)} ${open}`, { faceDoor: ` · <span class="measure">${face}</span>`, indent, beat: 'audio',
    plusTitle: 'the audio basin — ingest per minute, health of each dictation, speed, and the Merkle tree + spec additions in the last 30 min',
    inner: pillInner('AUDIO STREAM', { spark: 'every sentence the mic hears becomes a timestamped line, and on a timer the lines slot into the tree like a paste', face: lines }) });
}
// ── C146 THE TREE AND THE SPEC CARRY STATS — pure over the receipts: the tree's counts and root (spec-tree.json), the fold's behind (readIngest),
// the spec's ticks (specTicks over the markdown). Absent → not run — <cmd>; a count is read, never typed.
export function treeMetric(stree, fold = null) {
  if (!stree || stree.missing) return notRun('node scripts/vna/spec-tree.mjs');
  const c = stree.counts || {}; const behind = fold && fold.behind != null ? Number(fold.behind) : null;
  const behindTerm = behind == null ? 'behind UNMEASURED' : behind === 0 ? 'at the tape' : `<b class="rr">${behind} row${behind === 1 ? '' : 's'} behind</b>`;
  return `${c.nodes != null ? c.nodes : 'nodes UNMEASURED'} nodes · root ${esc(String(stree.root || '').slice(0, 8) || 'UNMEASURED')} · ${c.revisions != null ? c.revisions : 'UNMEASURED'} revisions · ${behindTerm}`;
}
export function specStats(md = undefined) {
  if (md == null) { try { md = readFileSync(SPEC_MD, 'utf8'); } catch { return null; } }
  const t = specTicks(md); const ids = Object.keys(t); if (!ids.length) return null;
  const ticked = ids.filter((k) => t[k]).length; return { ticked, declared: ids.length, open: ids.length - ticked };
}
// ── C145 THE EXPORT PILL'S OWN STATE — read, never typed: the last copy-out (the outbound receipt's `ide:run-summary` row — the extension
// writes one per 📋 Copy Run Summary, .thetacog/vna-clip-outbound.ndjson) and the Verified line's Time on Target term (composeLine, the
// same painter the copied line comes from). No row → `never copied`; no receipt for the line → UNMEASURED, never a zero.
export const OUTBOUND_RECEIPT = resolve(REPO, '.thetacog/vna-clip-outbound.ndjson');
export function readOutbound(path = OUTBOUND_RECEIPT, { by = 'ide:run-summary' } = {}) {
  try { const rows = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); return rows.filter((r) => r.by === by).pop() || null; } catch { return null; }
}
export function verifiedLine({ cock = null, aperture = null, tapeRows = null } = {}) { try { return composeLine({ cock: cock && !cock.missing ? cock : null, aperture, tapeRows }); } catch { return 'Verified by ThetaCog: UNMEASURED'; } }
// the term runs from `Time on Target` to the ledger URL that closes the line — the unlicensed state carries its own ` · unlicensed — 💳 …` inside the term
export const timeOnTargetTerm = (line) => { const m = /Time on Target[\s\S]*?(?= · https?:\/\/|$)/.exec(String(line || '')); return m ? m[0].trim() : 'Time on Target UNMEASURED'; };
export function exportMetric({ outbound = null, verified = null, now = Date.now() } = {}) {
  // never copied → the panel's absent form (`not run — <door>`, C103d.1): the door here is the pill's own button
  const copied = outbound && outbound.at ? `last copied <span class="age" data-at="${esc(outbound.at)}">${fmtAge(now - Date.parse(outbound.at))}</span> ago${outbound.bytes != null ? ` · ${Number(outbound.bytes).toLocaleString('en-US')} B` : ''}` : notRun('📋 Copy Run Summary');
  return `${copied} · ${esc(timeOnTargetTerm(verified))}`;
}
// ── C93d THE COG CARD — TOKENS PER COG (operator 2026-09-19: "comparing the token spent versus the complexity and comparing it
// to the best/worst case without using it … added to the panel on the left"; then "peg the no-arbitrage token to complexity of
// work based on measurements"). Every number is read: cog rows from data/vna/cog.ndjson (C93a, minted only with a red witness),
// spend from this session's transcript usage rows (C93b — the gauge receipt names transcriptPath) or the runner's verdict row,
// the peg from data/vna/cog-peg.json (C93c, a floor that only falls). The two baselines without the instrument are on the same
// strip from the same receipts: CEILING = calls × contextBytes/4 (the whole transcript re-sent per call), FLOOR = calls ×
// (prompt + CLAUDE.md). Never a dollar (KR40). The stamp is the weights file's own — "estimate v1 · UNCALIBRATED" until C93e.
export function readCogInputs({ repo = REPO, gauge = null } = {}) {
  const nd = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const g = gauge || (() => { try { return JSON.parse(readFileSync(resolve(repo, '.thetacog/vna-clear-gauge.json'), 'utf8')); } catch { return null; } })();
  const cogRows = nd(resolve(repo, 'data/vna/cog.ndjson'));
  let peg = null; try { peg = JSON.parse(readFileSync(resolve(repo, 'data/vna/cog-peg.json'), 'utf8')); } catch {}
  let weights = null; try { weights = JSON.parse(readFileSync(resolve(repo, 'data/vna/cog-weights.json'), 'utf8')); } catch {}
  let turns = [], transcript = g && g.transcriptPath && existsSync(g.transcriptPath) ? g.transcriptPath : null;
  let claudeMdTokens = null; try { claudeMdTokens = Math.round(statSync(resolve(repo, 'CLAUDE.md')).size / CHARS_PER_TOKEN); } catch {}
  return { cogRows, peg, weights, turns, transcript, gauge: g, claudeMdTokens };
}
export function cogCardData({ repo = REPO, inputs = readCogInputs({ repo }), log = true } = {}) {
  const { cogRows, weights, transcript, gauge, claudeMdTokens } = inputs;
  if (!cogRows.length || !weights) return { status: 'UNMEASURED', why: cogRows.length ? 'no weights file' : 'no cog row yet — node scripts/vna/cog.mjs --since <sha>', stamp: weights ? weights.stamp : 'estimate — no weights file' };
  const spendOf = cogSpendOf, baselines = cogBaselines, effectiveness = cogEffectiveness, total = cogTotal, pegWalk = cogPegWalk, emptyPeg = cogEmptyPeg;
  const turns = transcript ? spendOf(transcript).turns : [];
  // C119 — the turns' complexity on the chair ruler, scored against their own spend; a miss goes to the log once, never smoothed
  const complexity = (() => { try { const r = readTurnComplexity({ repo, turns, session: gauge && gauge.session, weights }); if (log && r.status === 'measured') { try { logDiscrepancies({ reading: r }); } catch {} try { logTurns({ reading: r }); } catch {} } return r; } catch (e) { return { status: 'UNMEASURED', why: `complexity reading failed: ${String(e.message).slice(0, 80)}` }; } })();
  let tree = null; try { tree = readTreeJson(resolve(repo, 'data/vna/spec-tree.json')); } catch {}   // readTree(text:false) is a bare parse — served from the one per-render parse (tree-once.mjs)   // only reef + walk.cells are read below — the 317 MB blobs sidecar was loaded on every repaint for nothing (2026-09-23 memory storm)
  const walk = pegWalk({ cogRows, turns, peg: inputs.peg || emptyPeg(weights), write: false, repo, tree });
  // C93j — the labour pin: measured route hours per cog by band; reclaimed hours and a value only when the rate is PINNED
  const rate = labourRate(resolve(repo, 'data/vna/labour-rate.json'));
  const reef = labourReef(); const cellsOf = (row) => { const labels = row.rows_ticked && row.rows_ticked.length ? row.rows_ticked : row.labels_named || []; const cells = []; for (const l of labels) { const n = tree && tree.nodes && tree.nodes[`n_spec_${l}`]; if (n && n.walk && Array.isArray(n.walk.cells)) cells.push(...n.walk.cells); } return cells; };
  const labour = walk.scores.map((sc) => { const row = cogRows.find((r) => r.sha === sc.sha); const split = row ? labourSplit(cellsOf(row), reef) : null; return { sha: sc.sha, band: sc.band, ...labourReclaimed({ cogRow: row, hours: sc.hours, skill: sc.skill, rate, split }) }; });
  const measuredL = labour.filter((l) => l.status === 'measured'); const byBand = {}; for (const l of measuredL) { (byBand[l.band] ||= { chair: [], runner: [] })[l.route === 'runner' ? 'runner' : 'chair'].push(l.route_hours_per_cog); }
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const labourTableRows = labourTable({ rows: labour, peg: walk.peg, rate, runnerRows: (() => { try { return readFileSync(resolve(repo, '.thetacog/runner.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } })() });
  const labourSummary = { table: labourTableRows, pin: rate.status, why: rate.why || null, currency: rate.currency || null, by: rate.by || null, estimate: /estimate/i.test(String(rate.by || '')), by_band: Object.fromEntries(Object.entries(byBand).map(([b, v]) => [b, { chair_h_per_cog: med(v.chair), runner_h_per_cog: med(v.runner), n: v.chair.length + v.runner.length }])), reclaimed_hours: measuredL.reduce((a, l) => a + (l.reclaimed_hours || 0), 0), value: rate.status === 'PINNED' ? measuredL.reduce((a, l) => a + (l.value || 0), 0) : null, rows: labour };
  const scored = walk.scores.filter((x) => x.effectiveness != null);
  const eff = scored.length ? scored.reduce((a, x) => a + x.effectiveness, 0) / scored.length : null;
  // this session against the two baselines without the instrument
  const calls = turns.reduce((a, t) => a + t.calls, 0), actual = turns.reduce((a, t) => a + total(t), 0);
  const promptTokens = turns.length ? Math.round(turns.reduce((a, t) => a + (t.prompt_chars || 0), 0) / turns.length / CHARS_PER_TOKEN) : 0;
  const b = baselines({ calls, promptTokens, claudeMdTokens: claudeMdTokens || 0, contextBytes: gauge && Number.isFinite(gauge.contextBytes) ? gauge.contextBytes : null });
  const session = { calls, actual, floor: b.floor, ceiling: b.ceiling, effectiveness: effectiveness({ actual, floor: b.floor, ceiling: b.ceiling }), turns: turns.length, transcript };
  // THE THREE REGIMES, each a receipt (the paste of 2026-09-19 asked for the tri-regime bar; the numbers were already on disk): bounded
  // headless run and disciplined chat, tokens per UNIT from data/vna/regime-floors.json (C70, measured); unbounded drift = this session's ceiling
  let regimes = null; try { const rf = JSON.parse(readFileSync(resolve(repo, 'data/vna/regime-floors.json'), 'utf8')); const t = rf.metrics && rf.metrics.tokens_k && rf.metrics.tokens_k.measured; regimes = { headless: t && Number.isFinite(t.headless) ? Math.round(t.headless * 1000) : null, chat: t && Number.isFinite(t.chat) ? Math.round(t.chat * 1000) : null, drift: b.ceiling, unit: 'tokens per unit (headless · chat) · tokens this session would re-send at the ceiling (drift)', source: 'data/vna/regime-floors.json metrics.tokens_k.measured (C70) · .thetacog/vna-clear-gauge.json contextBytes' }; } catch {}
  return { status: 'measured', complexity, stamp: weights.stamp, unit: weights.unit, expansion: weights.expansion, weights: weights.weights, gate: weights.gate || null, peg: walk.peg, scores: walk.scores, rows: cogRows, minted: cogRows.filter((c) => c.minted).length, effectiveness: eff, session, regimes, labour: labourSummary, reach: cogBandReach(weights, { litFloor: cogLitFloor(cogRows) }), windows: (() => { try { return windowReadings({ repo }); } catch (e) { return { status: 'UNMEASURED', why: `window reading failed: ${String(e.message).slice(0, 80)}` }; } })(), babysit: (() => { try { return babysitReading({ repo }); } catch (e) { return { status: 'UNMEASURED', why: `babysit reading failed: ${String(e.message).slice(0, 80)}` }; } })() };
}
// C113j — THE COG FACE NAMES THE FORMAL MEASURE: `<n> minted of <m> · peg <band> <k>/cog[ · legacy] · chair p<NN> · runner p<NN>` — the
// count off cog.ndjson, the peg off data/vna/cog-peg.json (the band with the newest non-legacy peg, else the newest band, stamped
// legacy — never hidden), the percentiles off readCogPercentile() (UNMEASURED with its why below the floor). Pure over its inputs.
export const fmtTok = (n) => (n == null || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(Math.round(n)));
export function cogFaceMetric(d, pct) {
  if (!d || d.status !== 'measured') { const why = (d && d.why) || 'no reading'; return /^no cog row/.test(why) ? notRun('node scripts/vna/cog.mjs --since <sha>') : `<span class="lane un">⚪ UNMEASURED</span> — ${esc(why)}`; }
  const bands = Object.entries((d.peg && d.peg.bands) || {}).filter(([, v]) => v && v.peg != null).map(([b, v]) => ({ b, ...v, t: Date.parse(v.at || 0) || 0 }));
  const newest = (xs) => xs.slice().sort((a, b) => b.t - a.t)[0];
  const pick = newest(bands.filter((x) => !x.legacy)) || newest(bands);
  const peg = pick ? `peg ${esc(pick.b)} ${fmtTok(pick.peg)}/cog${pick.legacy ? ' · legacy' : ''}` : 'peg none';
  const pc = pct && pct.status === 'measured' && pct.latest ? `chair p${pct.latest.pct} · ${pct.runner && pct.runner.n ? `runner p${pct.runner.median_pct}` : 'runner UNMEASURED'}` : `percentile UNMEASURED — ${esc((pct && pct.why) || 'no reading')}`;
  // C119: the first glance is the complexity per human % — the latest minted commit's rank, then this turn's, then the ratio and the peg
  // C119b: the second measure beside the first — the latest minted commit's spend ÷ its cog against its band's peg (never turns)
  const commitTok = (() => { const sha = pct && pct.status === 'measured' && pct.latest && pct.latest.sha; if (!sha) return null; const sc = (d.scores || []).find((x) => x.sha === sha), row = (d.rows || []).find((x) => x.sha === sha); if (!sc || !row || !sc.spend || !(row.cog > 0)) return null; const tok_per_cog = Math.round(sc.spend.total / row.cog); const pg = pegOf(row.band, d.peg); return { tokens: sc.spend.total, tok_per_cog, cog: row.cog, band: row.band, peg_legacy: pg ? pg.legacy : null, peg_ratio: pegRatio(tok_per_cog, pg) }; })();
  void pc; void peg;   // C119e: chair-vs-runner percentiles, the cog count and the peg roster read in the drawer — the proof; the face is the ledger entry `yield p<NN> · spend <tok> · rate <k>× peg`, the percentile first because it predicts turns and drift
  // C150d (operator 2026-09-21, screenshot '⚙️ 2.21 M tokens / cog · p37': "p37 is a metric not the open the report"): the button is the door — ⚙️ Tokens per cog — and the reading (tokens/cog, then the percentile line) is the metric beside it, never on the button
  return { head: '⚙️ Tokens per cog', metric: `${tokensPerCogHead({ commitTok, reading: d.complexity })} · ` + complexityFaceLine({ commitPct: pct, commitTok, reading: d.complexity, wrapPct: (label, r) => `<span class="cxp ${pctClass(r)}" title="${esc('the percentile of human work on the chair ruler — green under p' + WARN + ', amber from p' + WARN + ', red from p90, violet over the ruler (split the ask before you spend); C119f')}">${esc(label)}</span>` }) };
}
export function pegRoster(d) {
  const bands = Object.entries((d && d.peg && d.peg.bands) || {}).filter(([, v]) => v && v.peg != null);
  // C93o/C93l: a band no ticking commit can reach under the live weights is chair-only; a band no LANDED ticking commit can reach says so too
  const reach = (b) => { const r = d && d.reach && d.reach[b]; if (!r) return ''; if (!r.reachable_by_ticking_commit) return ` (chair-only under v${d.reach.weights_v})`; if (r.reachable_by_landed_ticking_commit === false) return ` (unreachable once the walk lands · lit floor ${d.reach.lit_floor})`; return ''; };
  return bands.length ? `PEG BANDS · ${bands.map(([b, v]) => `${b} ${fmtTok(v.peg)}/cog${reach(b)}${v.legacy ? ' (legacy)' : ''}`).join(' · ')}` : 'PEG BANDS · none yet';
}
export function sessionSpendLine(d) {
  const S = d && d.status === 'measured' && d.session; if (!S || !S.calls) return 'session · no transcript usage read yet — the gauge names the transcript';
  const notResent = S.ceiling != null && S.actual != null ? Math.max(0, S.ceiling - S.actual) : null; const pct = notResent != null && S.ceiling ? Math.round((notResent / S.ceiling) * 100) : null;
  return `session · ${S.calls} calls · actual ${fmtTok(S.actual)} · floor ${fmtTok(S.floor)} · ceiling ${fmtTok(S.ceiling)}${notResent != null ? ` · ${fmtTok(notResent)} tokens not re-sent, ${pct} %` : ''}`;
}
// C113k — THE COG DRAWER PAINTS THE ACTUAL WEIGHTS AND THE RATCHET, NEVER A FORMULA THE CODE DOES NOT COMPUTE (the paste's
// `P(task) = Base × (1+α·D_Cheb) × (1−NCD) × μ_PMU` was REFUSED — cog.mjs computes a weighted sum; a painted formula the code does not
// run is a claim to disprove). Every weight is read off data/vna/cog-weights.json through the reading (d.weights · d.stamp · d.gate);
// the zero weights are named as not weighed yet, never hidden. The ratchet: the peg is a floor that only falls (C93c), one line per
// band off cog-peg.json. Pure over the reading.
export function weightsBlock(d) {
  const w = (d && d.weights) || {};
  const terms = Object.entries(w).map(([k, v]) => `<span class="wt" title="${esc(`${k}: weight ${v} — data/vna/cog-weights.json`)}">${esc(k)} ${v === 0 ? '0 (not weighed yet)' : esc(String(v))}</span>`).join(' · ');
  return `<span class="c3l weights" title="the sum cog.mjs computes over the commit's inputs — rows ticked, basins touched, terms resolved, cells lit, the walk's lane jump, files, insertions, deletions, attempts, halts; the weights are declared in data/vna/cog-weights.json and move only through C93e's calibration"><span class="rk">cog = Σ w_i · x_i</span> · ${terms} · <span class="dim">${esc(d && d.stamp ? d.stamp : 'stamp UNMEASURED')} · gate: ${esc(d && d.gate ? d.gate : 'UNMEASURED')}</span></span><span class="c3l dim" title="C113k — corrected from the paste: the admissibility gate is the red witness (weights.gate), not a PMU factor; lane_jump is the one Rust walk's term, read off the flight tape's landed delta">the admissibility gate is the red witness (no red witness, no cog); lane_jump (w ${esc(String(w.lane_jump == null ? '—' : w.lane_jump))}) is the walk's term, read off the landed delta</span>`;
}
export function ratchetBlock(d) {
  const bands = Object.entries((d && d.peg && d.peg.bands) || {}).filter(([, v]) => v && v.peg != null);
  const line = (b, v) => `${esc(b)}: ${fmtTok(v.peg)} tok/cog set by ${esc(String(v.sha || '?').slice(0, 10))} ${esc(v.route || '?')} ${esc(String(v.at || '').slice(0, 10))}${v.legacy ? ' · legacy' : ''}`;
  return `<span class="c3l ratchet" title="C93c — the peg per band is the cheapest measured route (tokens per cog) and only falls; every move is a row in data/vna/cog-peg.ndjson; a legacy peg was set by a row minted before the lattice input and is not comparable to a landed row"><span class="rk">peg: a floor that only falls (C93c)</span> · ${bands.length ? bands.map(([b, v]) => line(b, v)).join(' · ') : 'no peg yet — the first minted row with a measured spend sets it'}</span>`;
}
// C119 — COMPLEXITY PER HUMAN %, THE RECENT TURNS: three series on one strip (bars = the turn's complexity percentile on the chair
// ruler, p100+ drawn full and marked ×k; line = gzip mass per k-token; line = tokens per hour), then the warning, the stance, the
// per-turn rows and the door to the discrepancy log. Every number read off the reading; no salary, no dollar, no smoothing.
export function complexityBlock(d) {
  const R = d && d.complexity;
  if (!R || R.status !== 'measured') return `<span class="c3l dim" title="C119 — the turn's own walk (cells · trajectory · σ · gzip) through the predict weights, ranked on the chair ruler; scored against the turn's usage rows">complexity per human % · UNMEASURED — ${esc((R && R.why) || 'no reading')}</span>`;
  const rows = R.rows; const W = 300, H = 84, PL = 26, PR = 30, PB = 12, n = Math.max(rows.length, 1), bw = (W - PL - PR) / n;
  const yPct = (p) => H - PB - (Math.min(100, Math.max(0, p)) / 100) * (H - PB - 6);
  const mMax = Math.max(1, ...rows.map((r) => r.tok_per_cog || 0)), hMax = Math.max(1, ...rows.map((r) => r.tok_per_hour || 0));
  const yM = (v) => H - PB - (v / mMax) * (H - PB - 6), yH = (v) => H - PB - (v / hMax) * (H - PB - 6), X = (i) => PL + i * bw + bw / 2;
  const pegV = (() => { const p = rows.map((r) => r.peg).filter((v) => v > 0); return p.length ? p[p.length - 1] : null; })();   // the live band's peg as a reference line on the tok/cog scale
  const bars = rows.map((r, i) => { const p = r.over != null ? 100 : r.pct; if (p == null) return `<rect x="${(PL + i * bw + 1).toFixed(1)}" y="${(H - PB - 3).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="3" class="cx un"><title>ask ${r.n} · complexity UNMEASURED (no walk in its window, or the ruler below its floor)</title></rect>`; const cls = r.over != null ? 'over' : p >= 90 ? 'hi' : p >= 75 ? 'warn' : 'ok'; return `<rect x="${(PL + i * bw + 1).toFixed(1)}" y="${yPct(p).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(H - PB - yPct(p)).toFixed(1)}" class="cx ${cls}"><title>ask ${r.n} · complexity ${pctLabel(r)} of human work (predicted cog ${r.predicted}, band ${r.band}; walk ${r.ref}: ${r.inputs ? `${r.inputs.blocks} blocks · radius ${r.inputs.radius} · polar ${r.inputs.polar} · depth ${r.inputs.depth} · σ ${r.inputs.sigma} · ${r.inputs.gzip} gzip-B` : '—'}) · spent ${r.tokens.toLocaleString()} tokens in ${r.calls} calls = p${r.realized_pct == null ? '—' : r.realized_pct} of this session's asks · gap ${r.gap == null ? '—' : r.gap}${r.logged ? ' · DISCREPANCY logged' : r.discrepancy ? ' · DISCREPANCY (live — logged when the next turn opens)' : ''} · ${tokPerCogLabel(r)} · ${r.mass_per_ktok} gzip-B per k-token · ${fmtTok(r.tok_per_hour)} tokens/hour over ${r.hours} h</title></rect>`; }).join('');
  const poly = (f, key, cls) => { const pts = rows.map((r, i) => (r[key] == null ? null : `${X(i).toFixed(1)},${f(r[key]).toFixed(1)}`)).filter(Boolean); return pts.length > 1 ? `<polyline points="${pts.join(' ')}" class="${cls}" fill="none"/>` : ''; };
  const svg = `<svg class="cogsvg cxsvg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="complexity per human percent, recent asks"><title>the recent asks — bars: this turn's complexity as a percentile of the chair's minted cogs (p100+ drawn full, ×k in the hover); teal line: tokens per cog (dotted teal: the band's peg, the floor that only falls); violet line: tokens per hour; hover a bar for its receipts</title><line x1="${PL}" y1="6" x2="${PL}" y2="${H - PB}" class="axis"/><line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" class="axis"/><line x1="${PL}" y1="${yPct(WARN).toFixed(1)}" x2="${W - PR}" y2="${yPct(WARN).toFixed(1)}" class="pegl" stroke-dasharray="2 3"><title>p${WARN} — the warning's HIGH line</title></line><text x="2" y="12" class="axl">p100</text><text x="2" y="${H - PB - 1}" class="axl">p0</text>${pegV ? `<line x1="${PL}" y1="${yM(pegV).toFixed(1)}" x2="${W - PR}" y2="${yM(pegV).toFixed(1)}" class="cxpeg" stroke-dasharray="1 3"><title>peg ${fmtTok(pegV)} tok/cog — the band's floor (C93c)</title></line>` : ''}<text x="${W - PR + 3}" y="12" class="axl cxm">${esc(fmtTok(mMax))}/cog</text><text x="${W - PR + 3}" y="24" class="axl cxh">${esc(fmtTok(hMax))}/h</text><text x="${W - PR - 2}" y="${H - 2}" class="axl" text-anchor="end">asks ${rows.length ? rows[0].n : '—'}–${rows.length ? rows[rows.length - 1].n : '—'}</text>${bars}${poly(yM, 'tok_per_cog', 'cxm')}${poly(yH, 'tok_per_hour', 'cxh')}</svg>`;
  const stance = `<span class="c3l dim" title="${esc('C119 — the stance on the ruler, consolidated: the ruler is the chair\'s minted cogs (C113e); a turn is its own walk through the predict weights (C93f); the prediction is scored against the spend (C93b) as tokens per cog against the band\'s peg (C93c) and a 4× miss is a row in ' + DISCREPANCY_NDJSON.replace(/^.*\/data\//, 'data/') + ' with lesson: null — learned from later by the calibration (C93e), never smoothed at paint')}">${esc(COMPLEXITY_STANCE)}</span>`;
  const warn = `<span class="c3l ${R.warning.level === 'WARN' ? 'cxwarn' : R.warning.level === 'SIGN' ? 'cxsign' : 'dim'}" title="${esc(`two signs, both read: HIGH = median complexity over the last ${R.warning.window} asks ≥ p75; RISING = the last three asks' tokens/hour ≥ 1.5× the session median; never a salary, never a dollar — an early warning that trouble may be ahead if it reads high without precautions`)}">${esc(warningLine(R))}</span>`;
  const tbl = `<span class="c3l cogtable cxtable">${rows.slice(-8).map((r) => `<span class="tr"><span class="rk">a${r.n}:</span> ${pctLabel(r)} · ${massLabel(r, 'tok')}${r.logged ? ' ⚑' : r.discrepancy ? ' ⚑ live' : ''} · ${fmtTok(r.tok_per_hour)}/h</span>`).join('')}</span>`;
  const ruler = `<span class="c3l dim" title="the chair ruler: every cog a human minted here (max ${R.ruler.max == null ? '—' : R.ruler.max}); the runner is ranked on it and never joins it (C113e)">chair baseline: ${R.ruler.n} cogs (floor ${R.ruler.floor}) · predict v${R.predict_v} · ${R.discrepancies} discrepanc${R.discrepancies === 1 ? 'y' : 'ies'} of ${R.n_turns} asks (tok/cog ≥ ${R.ratio_log}× or ≤ 1/${R.ratio_log} of the peg) → ${esc(DISCREPANCY_NDJSON.replace(/^.*\/data\//, 'data/'))}</span>`;
  return `<div class="c3h c3t"><span class="rk" title="C119 — the card's name stays TOKENS PER COG (the C89 manifest names a card by its first bold header); this strip is a block of the drawer like the weights and the ratchet">COMPLEXITY PER HUMAN %</span> <span class="spark" title="the cog is the unit — yield (rank on the chair ruler) and mass (tokens against the band's peg), never divided; a p99 ask predicts the class of work a p99 human does; 4× off the peg is logged">· ${esc(complexityFaceLine({ reading: R }).replace(/(^| · )complexity UNMEASURED — no reading( · |$)/, '$1').replace(/^ · /, ''))}</span></div><span class="c3l">${svg}</span>${warn}${tbl}${ruler}${stance}`;
}
const WARN = 75;
export function renderCogCard(d, { now = Date.now(), bridge = '', inner = false, pill = false, deep = false, under = '', faceMetric = null, checkout = `<span class="c3l checkout">${buyDoor()}</span>` } = {}) {   // C113j: faceMetric names the measure on the face (⚙️ Tokens per cog)   // C109n: the bridge's doors ride under the cog's + · C113d: inner = the drawer's content alone, painted under the 💳 +
  const A = (cmd, label, title, cls = 'action') => `<button class="${cls}" onclick="go('${cmd}')" title="${esc(title)}">${label}</button>`;
  const more = (id, title, inner) => `<details class="more" id="${id}"><summary title="${esc(title)}">▸ more</summary><div class="mrb">${inner}</div></details>`;
  // C103d: the face is the button and its metric — `<n> minted of <N>` read off cog.ndjson, `not run — <command>` before a row, UNMEASURED with its why when the reading refused; the whole measure (peg · effectiveness · the stamp · the two window lines) is the face block behind the +
  const cogBody = (measure, extra) => `${d && d.status === 'measured' ? weightsBlock(d) + ratchetBlock(d) + complexityBlock(d) : ''}<div class="c3h c3t"><b>TOKENS PER COG</b> <span class="spark" title="${esc(SPARK_LINES.cog)} — C103e, the tagline; the line is the card's reading · C113j: the peg roster off data/vna/cog-peg.json, legacy stamped, never hidden">· ${d && d.status === 'measured' ? esc(pegRoster(d)) : 'PEG BANDS · UNMEASURED'}</span></div><div class="tier fb"><div class="c3l"><span class="measure2">${d && d.status === 'measured' ? `${d.minted} minted of ${d.rows.length} · ` : ''}${measure}</span></div></div><div class="tier mid"><span class="c3l">${docDoor('cog')} <details class="ctx" id="ctx-cog"><summary title="more actions on this card; next: 🪙 Re-read session">⋮</summary>${B('vna.steer', '🪙 Re-read session', act.title)}</details></span>${checkout}</div>${extra}`;   // C138/C139: the cog card composes its own tiers — the same checkout line (buyDoor + accountSpan) at the end of its mid   // the drawer's content — the spark line, the measure, the doc door, the extra (bridge · ▸ more)
  const card = (metric, measure, action, extra) => inner
    ? `<div class="c3l cogface"><span class="measure">🪙 ${metric}</span> ${B('vna.steer', '🪙 Re-read session', act.title)}</div>${cogBody(measure, extra)}`   // C113d: under the 💳 + — the metric and the re-read door as a line, then the drawer as it was
    : `<div class="card3 c-cog${pill ? ` pill indent${deep ? ' deep' : ''}` : ''}"><div class="c3l face">${proofDoor('cog', faceMetric && faceMetric.head ? faceMetric.head : '⚙️ Tokens per cog', faceMetric == null ? metric : typeof faceMetric === 'string' ? faceMetric : faceMetric.metric, 'open the proof — how this percentile was computed: the ruler (every cog a human minted here), the predict weights Σw·x over this ask\'s own walk, the peg per band and the discrepancy log; the graph of the recent asks; next: 🪙 Re-read session behind ⋮')}${plusFold('cog', 'tokens per cog — the peg per band, effectiveness, the stamp, the scatter and the three regimes; next: mint the next commit with node scripts/vna/cog.mjs --since <sha>', cogBody(measure, extra) + under)}</div></div>`;
  const act = { title: 'run every sensor and repaint — the cog card reads data/vna/cog.ndjson, data/vna/cog-peg.json and this session\'s transcript usage rows on each paint; to mint new commits first: node scripts/vna/cog.mjs --since <sha>; next: the peg walk (node scripts/vna/peg.mjs --transcript <jsonl>) writes the moves' };
  const k = fmtTok;
  if (!d || d.status !== 'measured') { const why = (d && d.why) || 'no reading'; const metric = /^no cog row/.test(why) ? notRun('node scripts/vna/cog.mjs --since <sha>') : `<span class="lane un">⚪ UNMEASURED</span> — ${esc(why)}`; return card(metric, `<b class="lane un">⚪ UNMEASURED</b> <span class="dim">${esc(why)}</span> · <span class="dim">${esc((d && d.stamp) || '')}</span>`, act, `${bridge}${more('details-cog', 'the receipts this card reads; next: node scripts/vna/cog.mjs --since <sha> to mint the first row', '<span class="c3l dim">the receipts: data/vna/cog.ndjson · data/vna/cog-peg.json · the transcript usage rows (the gauge names the transcript) · the runner\'s verdict row — none read yet</span>')}`); }
  const bands = Object.entries(d.peg.bands).filter(([, v]) => v.peg != null);
  // C93o — a band no ticking commit can reach under the live weights is priced by unticked chair commits only; the line says so
  // C93l — a band no LANDED ticking commit can reach (the lit floor, read off the record) is out of the runner's reach too; a legacy peg says so
  const chairOnly = (b) => { const r = d.reach && d.reach[b]; if (!r) return ''; if (!r.reachable_by_ticking_commit) return ` (chair-only under v${d.reach.weights_v})`; if (r.reachable_by_landed_ticking_commit === false) return ` (unreachable once the walk lands · lit floor ${d.reach.lit_floor})`; return ''; };
  const legacy = (v) => (v.legacy ? ' · legacy' : '');
  const pegLine = bands.length ? bands.map(([b, v]) => `${b} ${k(v.peg)}/cog${chairOnly(b)}${legacy(v)}`).join(' · ') : 'no peg yet';
  void pegLine;   // C113j: the peg reads on the roster line (pegRoster); chairOnly/legacy stay on the band table below
  const effTxt = d.effectiveness == null ? 'effectiveness —' : `effectiveness ${d.effectiveness.toFixed(2)}`;
  const unitLine = `<span class="c3l def" title="${esc(`weights: ${JSON.stringify(d.weights || {})} (data/vna/cog-weights.json) — weighted by rows ticked · basins touched · cells lit · attempts`)}">1 ${esc(d.unit)} = one commit's minted work (red witness verified at HEAD + a row satisfied)</span>`;
  // C113j: the ratio is the face's, once; the peg reads on the roster line above; here the effectiveness and the windows, then the stamp
  const WN = d.windows; const winTxt = WN && WN.status === 'measured' ? `interventions/commit ${WN.median && WN.median.intervention_rate != null ? WN.median.intervention_rate : '—'} · halts/dispatch ${WN.median && WN.median.halts_per_dispatch != null ? WN.median.halts_per_dispatch : '—'}` : `windows UNMEASURED — ${esc((WN && WN.why) || 'no reading')}`;
  const measure = `${unitLine}<span class="c3l">${effTxt} · ${winTxt}</span><span class="c3l dim" title="${esc(`the ${d.unit} — the ${d.expansion}; a unit of work minted from the commit, never from the prompt (C93)`)}">${esc(d.stamp)}</span>`
  // C93p — the babysitting stat: how many times an open row was returned to before it landed, and whether the prediction saw it coming (ρ carries n; below the floor it is not a verdict)
  const measureB = `${measure}<span class="c3l dim" title="${esc('the prediction (C93f) scored against LANDING: returns = commits naming the row before its tick + runner halts; ρ = Spearman of predicted cog vs returns, UNDERPOWERED below 30 rows — node scripts/vna/babysit.mjs')}">${esc(babysitLine(d.babysit))}</span><span class="c3l dim" title="${esc('C93q — over every CLOSED goal on the flight tape: operator rows retained per commit (the steer file and the transcript, C19/C72), runner halts per dispatch (a gate failure with its reason, never a hallucination rate), flight-tape bytes per operator byte (bytes, never keystrokes) — node scripts/vna/babysit.mjs --windows')}">${esc(windowLine(d.windows))}</span>`;
  // the scatter: x = cog, y = tokens (log10), filled = minted, hollow = unminted; the peg line per band; every point titled with its receipts
  const pts = d.scores.map((s) => { const row = d.rows.find((r) => r.sha === s.sha) || {}; return { ...s, cog: row.cog || 0, inputs: row.inputs || {}, y: s.spend ? s.spend.total : null, subject: row.subject || '' }; });
  const xs = pts.map((p) => p.cog), ys = pts.map((p) => p.y).filter((y) => y > 0);
  const W = 300, H = 120, PL = 34, PB = 16, xmax = Math.max(1, ...xs) * 1.1, ymin = ys.length ? Math.min(...ys) / 2 : 1, ymax = ys.length ? Math.max(...ys) * 2 : 10;
  const X = (c) => PL + (c / xmax) * (W - PL - 6), Y = (t) => H - PB - ((Math.log10(Math.max(t, ymin)) - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin))) * (H - PB - 6);
  const lines = bands.map(([b, v]) => { const x1 = 0.05, x2 = xmax; return `<line x1="${X(x1).toFixed(1)}" y1="${Y(v.peg * x1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(v.peg * x2).toFixed(1)}" class="pegl" stroke-dasharray="3 2"><title>peg ${b} · ${k(v.peg)} tokens per cog · set by ${String(v.sha).slice(0, 10)} (${v.route}) · data/vna/cog-peg.json</title></line>`; }).join('');
  const dots = pts.map((p) => { const t = `${p.sha.slice(0, 10)} · cog ${p.cog}${p.minted === false || p.status === 'unminted' ? ' · not minted — ' + (p.why || '') : ''} · ${p.spend ? `${p.spend.route}: ${p.spend.calls} calls · cache_read ${p.spend.cache_read} · output ${p.spend.output} · total ${p.spend.total}` : 'spend UNMEASURED — ' + (p.why || '')}${p.effectiveness != null ? ` · effectiveness ${p.effectiveness.toFixed(2)}` : ''} · inputs ${JSON.stringify({ ...p.inputs, red_witness: p.inputs.red_witness && p.inputs.red_witness.status })} · data/vna/cog.ndjson · transcript usage rows`; const cx = X(p.cog).toFixed(1), cy = (p.y ? Y(p.y) : H - PB - 2).toFixed(1); return `<circle cx="${cx}" cy="${cy}" r="3.5" class="${p.status === 'unminted' ? 'dot un' : p.status === 'UNMEASURED' ? 'dot um' : 'dot ' + (p.spend && p.spend.route === 'runner' ? 'runner' : 'chair')}"><title>${esc(t)}</title></circle>`; }).join('');
  const svg = `<svg class="cogsvg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="tokens per cog"><title>tokens per cog — x: cog (work minted from the commit), y: tokens spent on it (log), dashed: the peg per band; filled = minted, hollow = unminted, grey = spend UNMEASURED; hover a point for its receipts</title><line x1="${PL}" y1="6" x2="${PL}" y2="${H - PB}" class="axis"/><line x1="${PL}" y1="${H - PB}" x2="${W - 6}" y2="${H - PB}" class="axis"/><text x="${W - 8}" y="${H - 4}" class="axl" text-anchor="end">cog</text><text x="4" y="12" class="axl">tokens</text>${lines}${dots}</svg>`;
  const S = d.session; const sess = S.calls ? `this session · ${S.calls} calls · actual ${k(S.actual)} · ceiling ${k(S.ceiling)} (transcript re-sent per call) · floor ${k(S.floor)} (prompt + CLAUDE.md per call) · ${S.effectiveness.value == null ? 'effectiveness UNMEASURED' : `effectiveness ${S.effectiveness.value.toFixed(2)}`}` : 'this session · no transcript usage read yet';
  const R = d.regimes; const rvals = R ? [['headless', R.headless], ['chat', R.chat], ['drift', R.drift]].filter(([, v]) => Number.isFinite(v)) : []; const rmax = Math.max(1, ...rvals.map(([, v]) => v));
  const bar = rvals.length ? `<span class="c3l regimes" title="${esc(`three regimes, each a receipt — ${R.unit}; ${R.source}; a regime with no receipt is not drawn`)}">${rvals.map(([n, v]) => `<span class="rg rg-${n}" title="${esc(`${n}: ${v.toLocaleString()} tokens — ${n === 'drift' ? 'this session\'s calls × transcript/4 (the ceiling)' : 'measured per unit, regime-floors.json (C70)'}`)}"><i style="width:${Math.max(2, Math.round((v / rmax) * 100))}%"></i><b>${n} ${k(v)}</b></span>`).join('')}</span>` : '<span class="c3l dim">regimes UNMEASURED — no regime-floors.json receipt</span>';
  const L = d.labour; const hb = L && L.by_band ? Object.entries(L.by_band).map(([b, v]) => `${b}: chair ${v.chair_h_per_cog == null ? '—' : v.chair_h_per_cog} h/cog · runner ${v.runner_h_per_cog == null ? '—' : v.runner_h_per_cog} h/cog`).join(' · ') : '';
  const hoursLine = !L ? '' : L.pin === 'PINNED' ? `<span class="c3l" title="${esc(`HOURS RECLAIMED = (declared human h/cog − measured route h/cog) × cogs, per band; value = hours × the declared rate for the basin's domain; declaration: data/vna/labour-rate.json by ${L.by || '—'}; route hours are measured (transcript turn span · runner verdict ms), never a base constant`)}">HOURS RECLAIMED ${L.reclaimed_hours.toFixed(1)} h${L.value != null ? ` · ${L.value.toFixed(2)} ${esc(L.currency)}` : ''} · ${esc(hb)} · <span class="dim" title="${esc('the rate is a split across the competences the walk lit — each row\'s value = hours × Σ share_domain × rate_domain (data/pmu/lens-reef.json domains, data/vna/labour-rate.json rates); by ' + (L.by || '—') + ', ' + (L.estimate ? 'ESTIMATE' : 'declared'))}">${L.estimate ? 'rates: operator estimate' : 'rates: declared'}</span></span>` : `<span class="c3l dim" title="${esc(`the pin is salaried hours (C93j): route hours per cog are MEASURED — chair from the transcript's turn span, runner from the verdict row's ms — and the skill is the basin's reef hat and domain on the tree; the human hours per cog without the instrument and the hourly rate are the buyer's declaration in data/vna/labour-rate.json (every number with cites) — ${L.why || 'not declared'}; no currency is printed until it exists`)}">hours per cog · ${esc(hb || 'UNMEASURED')} · rate ${esc(L.pin)}</span>`;
  const tbl = L && L.table && L.table.length ? `<span class="c3l cogtable" title="${esc('per band x: the peg (tokens/cog, C93c) · measured hours/cog by route · the competences the band\'s rows lit (reef domains by share) · the declared rate blended over them · the declared human hours/cog · human value/cog = human h/cog × rate · compute/cog = the runner\'s own cost_usd ÷ cog, UNMEASURED when no runner row carries a cost; every cell a receipt, a declaration, or UNMEASURED')}">${L.table.map((b) => `<span class="tr"><b>${esc(b.band)}</b> ${b.peg_tokens_per_cog == null ? '—' : k(b.peg_tokens_per_cog)} tok/cog${b.peg_route ? ` (${esc(b.peg_route)})` : ''} · h/cog ${b.runner_h_per_cog != null ? `runner ${b.runner_h_per_cog}` : ''}${b.chair_h_per_cog != null ? ` chair ${b.chair_h_per_cog}` : ''} · ${esc(b.competences.slice(0, 3).join(' '))}${b.pin === 'PINNED' ? ` · ${b.hourly != null ? b.hourly + ' ' + esc(b.currency) + '/h' : 'no rate'} · human ${b.human_h_per_cog ?? '—'} h/cog${b.human_value_per_cog != null ? ` = ${b.human_value_per_cog} ${esc(b.currency)}/cog` : ''}` : ' · rate UNPINNED'} · compute/cog ${b.compute_cost_per_cog == null ? 'UNMEASURED' : b.compute_cost_per_cog + ' USD list'}</span>`).join('')}</span>` : '';
  const extra = more('details-cog', 'the scatter · the three regimes · hours per cog · the band table · this session against the ceiling and the floor · the receipts', `<span class="c3l">${svg}</span>${bar}${hoursLine}${tbl}<span class="c3l dim" title="${esc('CEILING = calls × contextBytes/4 — the regime the 1.02 B cache-read session was measured in; FLOOR = calls × (prompt + CLAUDE.md at HEAD); actual = the sum of the four usage fields over this session\'s turns (C93b); receipts: .thetacog/vna-clear-gauge.json · ' + (S.transcript || 'no transcript'))}">${esc(sess)}</span><span class="c3l dim">the peg is the cheapest measured route per band and only falls (data/vna/cog-peg.ndjson holds every move); no red witness, no cog; never a dollar until a price is pinned</span>`);
  return card(`${d.minted} minted of ${d.rows.length}`, measureB, act, `${bridge}${extra}`);
}
// THE STRIP is now the three cards (C78a) — the name stays so every guard that reads the strip reads the cards. The
// clipboard checkbox reads clipState — the daemon's own file — inside the runner card's ▸ more.
export function renderStrip({ clip, runner = null, entitlement = entitlementFromEnv(), fingerprint = process.env.VNA_DEVICE_FINGERPRINT || null, notary = null, goal = null, lens = null, chain = null, loop = null, next = null }) {
  const armed = !!(clip && clip.armed);
  void armed;
  return renderCards({ goal, lens, runner, chain, clip, entitlement, fingerprint, notary, loop, next });
}
// C23 — THE PROMPT TURN as a tile: the lens walk of the last prompt (.thetacog/lens-encircled/latest.json, written by
// the prompt-lens hook) — pixel · hat · domain · in/out counts · off-lane % · age. Painted from the receipt; UNMEASURED
// when the walk refused; "not run" when there is no receipt. The extension's status bar reads the same file.
export function readLastPrompt(path) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return { at: j.at || null, coord: j.coord || null, hat: j.hat || null, domain: j.domain || null, inLane: (j.inLane || []).length, outOfLane: (j.outOfLane || []).length, offPct: j.offPct ?? null, unmeasured: j.unmeasured || null, refused: !!j.refused, engine: j.walkEngine || j.engine || null, prompt: typeof j.prompt === 'string' ? j.prompt.slice(0, 120) : null }; } catch { return null; }
}
export function renderLastPrompt(lp, { now = Date.now() } = {}) {
  if (!lp) return '<div class="card lastprompt"><h2>LAST PROMPT · lens walk</h2><div class="miss">not run — no lens receipt yet (the prompt-lens hook writes .thetacog/lens-encircled/latest.json on every prompt)</div></div>';
  const age = lp.at ? `<b class="age" data-at="${esc(lp.at)}">${fmtAge(now - Date.parse(lp.at))}</b> ago` : 'undated';
  const where = lp.coord && !lp.unmeasured && !lp.refused ? `<span class="ib">${esc(lp.coord)} ${esc(fullName(lp.coord))}</span> · ${esc(lp.hat || '—')} · ${esc(lp.domain || '—')}` : `<span class="rr">UNMEASURED</span>${lp.unmeasured ? ` — ${esc(String(lp.unmeasured).slice(0, 80))}` : lp.refused ? ' — the walk refused' : ''}`;
  return `<div class="card lastprompt"><h2>LAST PROMPT · lens walk</h2><div class="k">${where}</div><div class="k">in lane <b>${lp.inLane}</b> · out of lane <b>${lp.outOfLane}</b> · off-lane ${lp.offPct == null ? '<span class="dim">—</span>' : `<b>${esc(String(lp.offPct))}%</b>`} · ${age}${lp.engine ? ` · <span class="dim">${esc(lp.engine)}</span>` : ''}</div>${lp.prompt ? `<div class="dim">“${esc(lp.prompt)}”</div>` : ''}</div>`;
}
export function renderWatched({ w, timers, clip }) {
  // THE PIPELINE FLOW (operator, 2026-09-17: "visualize the flow of semantic mass horizontally … instantly
  // see where the blockage is"): three stations, one arrow each, badges not paths. The station that is
  // late is the one lit amber; nothing here is computed — every value is a dated fact read above.
  const age = (iso) => iso ? `<b class="age" data-at="${esc(iso)}">${esc(fmtAge(Date.now() - Date.parse(iso)))}</b>` : '<span class="dim">—</span>';
  const n = timers.notified;
  const armed = !!(clip && clip.armed);
  const clipSt = !clip ? { cls: 'off', big: '⚪ not run', small: 'clip-watch.mjs arm' }
    : armed && clip.daemon ? { cls: 'ok', big: '🟢 armed', small: `pid ${esc(String(clip.daemon))} · ${clip.appendedToday} today` }
    : armed ? { cls: 'bad', big: '❌ armed, no daemon', small: 'clip-watch.mjs --daemon' }
    : { cls: 'off', big: '⚪ standby', small: `${clip.appendedToday} today` };
  const fileSt = w.steer.path
    ? (w.steer.lastAt ? { cls: 'ok', big: `+${fmt(w.steer.bytes)}B ${age(w.steer.lastAt)} ago`, small: `row ${w.steer.row} · ${esc(String(w.steer.by || '').toLowerCase())} · ${esc(w.steer.sha8)}` }
                      : { cls: 'off', big: 'no append yet', small: esc(w.steer.path.split('/').pop()) })
    : { cls: 'bad', big: 'no steer file', small: 'steer-file.mjs set …' };
  const readSt = n.state === 'notified' ? { cls: 'ok', big: `🟢 read ${age(n.at)} ago`, small: `row ${esc((n.rows || []).join(',') || '—')}` }
    : n.state === 'waiting' ? { cls: 'warn', big: `⏳ PENDING ${age(timers.changed?.at)}`, small: 'unread — last read ' + esc(String(n.at || '').slice(11, 19)) + 'Z' }
    : { cls: 'off', big: 'nothing surfaced', small: 'send any prompt' };
  const st = (label, x) => `<div class="st ${x.cls}"><div class="stl">${label}</div><div class="stb">${x.big} <span class="sts">${x.small}</span></div></div>`;
  const badges = [
    // each chip is a DOOR (operator 2026-09-20: "clicking spec should open spec in the ide") — the verb on the chip is the command it runs (C105)
    `<button class="bd" onclick="go('vna.steerThisFile')" title="open ${esc(w.steer.path || 'the steer file')} in the editor (vna.steerThisFile)">📄 ${esc((w.steer.path || 'steer').split('/').pop())}${w.steer.row ? ` · row ${w.steer.row}` : ''}</button>`,
    `<button class="bd" onclick="go('vna.openAmendments')" title="open docs/specs/vna/amendments.ndjson in the editor (vna.openAmendments)">📑 ${w.ledger.rows ?? 0} rows${w.ledger.lastAt ? ` · ${age(w.ledger.lastAt)}` : ''}</button>`,
    `<button class="bd" onclick="go('vna.openSpec')" title="open docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor (vna.openSpec)">📜 spec${w.spec.at ? ` · ${age(w.spec.at)}` : ' · missing'}</button>`,
    `<button class="bd" onclick="go('vna.openTree')" title="open the spec tree (data/vna/spec-tree.txt) in the editor (vna.openTree)">🌲 ${w.tree.at ? `${esc(w.tree.root8)} · ${w.tree.nodes} nodes · ${w.tree.revisions} rev · ${age(w.tree.at)}` : 'not run'}</button>`,
  ].join('');
  return `<div class="flow">${st('CLIPBOARD', clipSt)}<div class="arr">──►</div>${st('STEER FILE', fileSt)}<div class="arr">──►</div>${st('CLAUDE', readSt)}</div>
<div class="badges">${badges}</div>`;
}

// The section head: the Paste → Tree button (posts {cmd:'vna.pasteToTree'} through the sidebar's
// go(); a browser copy of the page says so instead), the clipboard state from clip-watch.mjs's ONE
// state line (the same object the steer-file card paints — read once, painted twice), and the root.
// C51 — THE CLEAR GAUGE (clear-gauge.mjs): painted from the hook's receipt (.thetacog/vna-clear-gauge.json) and the
// tape/tree offsets, never from a turn count. FREE/OVERDUE carry the one-click actuator (vna.clearClaudeTerminal —
// one click, never unattended: a /clear injected mid-turn destroys the turn); FOLD-FIRST carries Paste → Tree instead.
// C122b — THE GAUGE'S ACTION IS ONE PAINTER: the button the gauge line paints and the button the live line's tip paints are the same
// bytes from the same function (one rule, one place); no gauge → no button, never a typed one.
export function gaugeAction(g) {
  if (!g) return '';
  return g.state === 'FOLD-FIRST'
    ? `<button class="mini warn" onclick="go('vna.pasteToTree')" title="fold the unfolded bytes into the tree first — a clear now loses them">🌳 Fold first</button>`
    : `<button class="mini${g.state === 'OVERDUE' ? ' warn' : ''}" onclick="go('vna.clearClaudeTerminal')" title="${esc(`send /clear to the active Claude terminal — you are carrying ${g.contextBytes != null ? fmtBytes(g.contextBytes) : 'an unmeasured amount'} of transcript because it feels needed; the tree holds everything that was folded, so a clear loses ${g.lose === 0 ? '0 B' : fmtBytes(g.lose)} and the next turn re-seeds from the spec; next: the snowball boots the next turn cold`)}">⚡ /clear the terminal</button>`;
}
export function renderClearGauge(g) {
  if (!g) return '';
  const act = gaugeAction(g);
  const carry = g.contextBytes != null ? `carrying <b>${esc(fmtBytes(g.contextBytes))}</b>${g.turns != null ? ` · ${g.turns} turn${g.turns === 1 ? '' : 's'}` : ''}` : '<span class="dim">transcript unmeasured until the next turn</span>';
  const lose = g.lose === 0 ? 'a clear loses <b>0 B</b>' : `a clear loses <b>${esc(fmtBytes(g.lose))}</b>`;
  return `<div class="k gauge gauge-${esc(g.state.toLowerCase())}">${g.dot} <b>${esc(g.state)}</b> <span class="dim">·</span> ${lose} <span class="dim">·</span> ${carry} <span class="dim">· spec ${esc(fmtBytes(g.specGzip))} gz</span> ${act}</div>`;
}
// C82e — THE TOKEN METER: one measure (input tokens a clear stopped re-sending, at the named ratio, over the sessions the
// ledger saw end) and one door directly under it — C75's Connect / Buy credits. The measurement is free; if it paid for
// itself, buy licences. UNMEASURED is not 0. Never a dollar until a price is pinned (KR40).
export function renderTokenMeter(m) {
  if (!m) return '';
  const k = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const S = m.saved || {}; const L = m.live || {};
  const measure = L.state !== 'MEASURED' && !S.sessions ? `<b class="rr">UNMEASURED</b> <span class="dim">— ${esc(L.why || 'no clear gauge yet')}</span>`
    : `<b>${k(S.tokens || 0)} input tokens not re-sent</b> <span class="dim">over ${S.sessions || 0} session${S.sessions === 1 ? '' : 's'} cleared free${S.foldFirst ? ` (${S.foldFirst} fold-first, counted 0)` : ''} · ${m.charsPerToken} chars/token · snowball ${k(m.snowballTokens)} subtracted per turn</span>`;
  const live = L.state === 'MEASURED' ? `<span class="c3l dim">${esc(m.line)}</span>` : '';
  // C91e: the same figure per GOAL — the goal row's own context × its own turns; a receipt from before C91e has no block and paints none; zero closed is an absence, not a zero
  const G = m.goals || null;
  const goals = G && G.closed > 0 ? `<span class="c3l" title="${esc(`sufficient for: ${G.sufficientFor || ''} · NOT for: ${G.notFor || ''}`)}">🎯 <b>${esc(G.line)}</b> <span class="dim">— each goal's own transcript at ${m.charsPerToken} chars/token × its own turns, snowball subtracted</span></span>` : '';
  return `<div class="k meter" title="${esc(`sufficient for: ${m.sufficientFor || ''} · NOT for: ${m.notFor || ''}`)}">⛽ ${measure}${live}${goals}<span class="c3l">${B('vna.connect', '🔑 Connect / Buy credits', 'OAuth 2.0 device flow on the tape\'s own key — login, payment and the licence happen on the site (C75)')} <span class="dim">the measurement is free — if it paid for itself, buy licences</span></span></div>`;
}
function renderSpecTreeHead({ stree, clip, timers, gauge = null, meter = null }) {
  const root = stree.missing ? 'not run' : `root <b>${esc(String(stree.root || '').slice(0, 8))}</b> · ${stree.counts?.nodes ?? 0} nodes${stree.retracted && stree.retracted.nodes ? ` · <span class="dim">retracted ${stree.retracted.nodes}</span>` : ''}`;
  return `<div class="hd"><button class="mini" onclick="go('vna.pasteToTree')" title="arm the clipboard, fold every new amendment row into the tree, repaint">📋→🌳 Paste → Tree</button>
   <span class="${clip && clip.armed ? 'ib' : 'dim'}">${esc(clip ? clip.line : 'clipboard: not run — node scripts/vna/clip-watch.mjs arm')}</span> <span class="dim">·</span> ${root}</div>
   ${renderClearGauge(gauge)}${renderTokenMeter(meter)}${renderSpecTimers(timers)}`;
}

function specBlocks(md) {
  const items = [];
  for (const line of md.split('\n')) {
    const m = /^-\s*\[([ xX])\]\s*(\S+)\s+(.*)$/.exec(line.trim());
    if (m) items.push({ done: m[1].toLowerCase() === 'x', id: m[2], text: m[3] });
  }
  const qs = [...md.matchAll(/^-\s*\*\*(Q\d+)\*\*\s*(.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
  return { items, qs };
}

function main() {
  const noOpen = process.argv.includes('--no-open');
  const story = load('story.json', 'node scripts/vna/story.mjs');
  const align = load('alignment-map.json', 'node scripts/vna/alignment-map.mjs');
  const comp = load('competence-pixel.json', 'node scripts/vna/competence-pixel.mjs');
  const trigger = load('parametric-trigger.json', 'node scripts/vna/parametric-trigger.mjs');
  const under = load('underwriting.json', 'node scripts/vna/underwriting.mjs');
  const sev = load('severity-status.json', 'node scripts/vna/severity-ledger.mjs');
  // The only rust-backed sensor in the loop. Its PNGs are READ from the receipt cockpit.mjs wrote —
  // re-deriving them here would mean walking the chip a second time and letting two surfaces
  // disagree about one commit, which is this file's declared foreclosure.
  const cock = load('cockpit.json', 'node scripts/vna/cockpit.mjs');
  const apertureRcpt = loadApertureReceipt();   // C115: composed off cockpit.json by aperture-receipt.mjs; null → not run — <command> on the strip, the hovers and the door
  const cockPreview = load('cockpit-preview.json', 'node scripts/vna/cockpit.mjs --reality tree --no-open');   // C79d: the working tree's walk, its own file
  const stree = load('spec-tree.json', 'node scripts/vna/spec-tree.mjs');
  const env = load('envelope.json', 'node scripts/vna/envelope.mjs');
  // The tape is read from git + the envelope's receipt, so it is never absent the way a receipt can
  // be; an entry the envelope did not place says UNPLACED rather than going missing.
  const tape = tapeTail(5);
  const net = mesh();
  // the formal methods' receipts and the steer loop's state — read, never computed
  const fm = {
    cost: loadPmu('kr40-cost-envelope.json', 'node scripts/pmu/kr40-cost-envelope.mjs'),
    cov: loadPmu('kr37-covenant.json', 'node scripts/pmu/kr37-covenant.mjs'),
    ap: loadPmu('kr39-aperture.json', 'node scripts/pmu/kr39-aperture.mjs'),
    sw: loadPmu('kr41-steering-work.json', 'node scripts/pmu/kr41-steering-work.mjs'),
    meterTurn: lastLine(resolve(REPO, 'data/pmu/grip-meter-history.ndjson')),
    meterSteer: lastLine(resolve(REPO, 'data/pmu/grip-meter-steer-history.ndjson')),
  };
  const steerFile = { pointer: (() => { try { return JSON.parse(readFileSync(resolve(REPO, '.thetacog/vna-steer-file.json'), 'utf8')); } catch { return null; } })(), surfaced: lastLine(resolve(REPO, '.thetacog/vna-steer-surfaced.ndjson')), clip: (() => { try { return clipState(); } catch { return null; } })() };
  const spl = net.missing ? { missing: true, cmd: net.cmd } : splatter({ net, limit: 4 });
  // the two timers' inputs — dated facts read off disk, never computed: the last ledger row for the
  // pointed source (any source when none is pointed), two mtimes, and the last surfacing receipt
  const timers = (() => {
    const led = resolve(REPO, 'docs/specs/vna/amendments.ndjson');
    let ledgerAt = null, ledgerRow = null;
    try {   // backwards from the end, flat memory — never the whole ledger as one string
      const t = lastRowIndexed(led, (r) => !steerFile.pointer || r.source === steerFile.pointer.source);
      if (t.row) { ledgerAt = t.row.at; ledgerRow = t.i; }
    } catch {}
    const mtime = (p) => { try { return statSync(p).mtime.toISOString(); } catch { return null; } };
    const surf = resolve(REPO, '.thetacog/vna-steer-surfaced.ndjson');
    return specTimers({ ledgerAt, ledgerRow, specAt: mtime(resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md')), treeAt: mtime(D('spec-tree.json')),
      surfacedAt: steerFile.surfaced?.at || null, surfacedRows: steerFile.surfaced?.rows || [], surfacedExists: existsSync(surf) });
  })();

  const gauge = (() => { try { return readGauge(); } catch { return null; } })();
  const meter = (() => { try { return tokenMeter(); } catch { return null; } })();   // C82e
  // WATCHED — the same dated facts the timers use, plus the last row's author (clip marker or not)
  const watched = (() => {
    const led = resolve(REPO, 'docs/specs/vna/amendments.ndjson');
    const steer = { path: steerFile.pointer?.source || null, lastAt: null, by: null, bytes: null, sha8: null, row: null };
    const ledger = { rows: null, lastAt: null };
    try {   // backwards from the end, flat memory — never the whole ledger as one string
      const last = lastRowIndexed(led, () => true);
      ledger.rows = last.lines; ledger.lastAt = last.row ? last.row.at : null;
      if (steer.path) { const t = lastRowIndexed(led, (r) => r.source === steer.path); const r = t.row; if (r) { steer.lastAt = r.at; steer.by = /<!--\s*clip/.test(r.text || '') ? 'CLIPBOARD' : 'HAND'; steer.bytes = r.bytes; steer.sha8 = String(r.sha256 || '').slice(0, 8); steer.row = t.i + 1; } }
    } catch {}
    const mtime = (p) => { try { return statSync(p).mtime.toISOString(); } catch { return null; } };
    const tree = { at: mtime(D('spec-tree.json')), root8: String(stree.root || '').slice(0, 8), nodes: stree.counts?.nodes ?? 0, revisions: stree.counts?.revisions ?? 0 };
    return { steer, ledger, spec: { at: mtime(resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md')) }, tree };
  })();

  const specPath = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
  const md = existsSync(specPath) ? readFileSync(specPath, 'utf8') : '';
  const { items, qs } = specBlocks(md);
  TICKED = new Set(items.filter((i) => i.done).map((i) => i.id));   // the checklist boxes the rail marks [COMMITTED]
  // C53c: one typed borne-out state per checklist row — the tree's node for the label (its meta.done and its named guard)
  // through borneOut(), which opens the registry's receipt; a row the tree does not hold yet renders from the md box alone
  const boReg = loadBorneRegistry();
  const boNode = (id) => (stree.missing ? null : Object.values(stree.nodes || {}).find((n) => n.basin && !n.retracted && n.meta && n.meta.label === id)) || null;
  const boOf = (id) => { const n = boNode(id); const it = items.find((i) => i.id === id); return borneOutAtHead(id, n || { meta: { done: !!(it && it.done) }, content: { text: it ? it.text : '' } }, { registry: boReg, text: it ? it.text : '' }); };
  const boCounts = items.map((i) => boOf(i.id).state).reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {});
  // ── C56 THE WORKBENCH (operator 2026-09-18: "a beautiful UX on the left side that's very usable — exactly the tools the
  // developer wants to see when they go there"). One strip at the top, every field from a receipt already on disk, nothing
  // computed here: the next unit of work (queueHead — the same door the hook prints), the last seed (the seed ledger's last
  // row: released / landed / abstained with the walk's numbers), the fold state (watermark vs ledger rows, the last fold's
  // time and who ran it), the spec's borne-out counts, and the one button. A missing receipt renders "not run — <command>".
  const wb = (() => {
    const q = (() => { try { return queueHead(); } catch { return null; } })();
    const nextRow = q && q.lines && q.lines[1] ? q.lines[1].replace(/^\s*·\s*/, '') : null;
    let seed = null; try { const L = readFileSync(resolve(REPO, '.thetacog/vna-seed.ndjson'), 'utf8').trim().split('\n'); seed = JSON.parse(L[L.length - 1]); } catch {}
    let seeds20 = null; try { const L = readFileSync(resolve(REPO, '.thetacog/vna-seed.ndjson'), 'utf8').trim().split('\n').slice(-20).map((l) => JSON.parse(l)); seeds20 = { n: L.length, released: L.filter((r) => r.stage === 'released').length, landed: L.filter((r) => !r.abstained && r.stage !== 'released').length, abstained: L.filter((r) => r.abstained).length }; } catch {}
    let fold = null; try { const roots = readFileSync(resolve(REPO, 'data/vna/spec-tree-roots.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((f) => f.kind !== 'retract'); const last = roots[roots.length - 1]; let ledgerRows = null; try { ledgerRows = ledgerLineCount(resolve(REPO, 'docs/specs/vna/amendments.ndjson')).lines; } catch {} const wm = stree.missing ? null : Math.max(stree.watermark, foldedThrough(readWatermark(resolve(REPO, 'data/vna/spec-tree.json')))); /* bounded count (the ledger is ~400 MB) · behind measured as the fold gate measures it */ fold = { at: last ? last.at : null, by: last ? last.by : null, behind: ledgerRows != null && wm != null ? Math.max(0, ledgerRows - 1 - wm) : null, folds: roots.length }; } catch {}
    let goal = null; try { goal = goalStatus({ write: false }); } catch {}
    return { nextRow, open: q ? q.open : null, seed, seeds20, fold, goal };
  })();
  const wbHtml = (() => {
    const cell = (k, v, cls = '') => `<div class="wbc ${cls}"><div class="wbv"><b class="wbk">${k}</b> ${v}</div></div>`;
    // C103f: the next unit's HEADLINE (label + first clause, rowHeadline off specRows, ≤ 120) — the row's text lives in the document the spec line opens
    const nextLabel = wb.nextRow ? wb.nextRow.split(' ')[0] : null; const nextHead = nextLabel ? (rowHeadline(nextLabel, { md }) || nextLabel) : null;
    // C178: RED carries its own reason on the row that most needs it — the next unit (boOf(nextLabel).state kept
    // literal per C53c(e)'s wiring assertion; the extra call is cheap, both read the same md-derived closure)
    const next = wb.nextRow ? `<b>${esc(nextLabel)}</b> <b class="bo bo-${esc(boOf(nextLabel).state)}">${esc(boOf(nextLabel).state)}</b>${boOf(nextLabel).state === 'RED' ? ` <span class="rr">${esc(boOf(nextLabel).why)}</span>` : ''} ${esc(nextHead.slice(nextHead.indexOf(' — ') + 3))} <span class="dim">· ${wb.open} open · newest first</span>` : '<span class="dim">no open rows — the spec is closed or unread</span>';
    const sd = wb.seed; const seedTxt = !sd ? '<span class="miss">not run — no seed row yet</span>' : sd.stage === 'released' ? `<b class="bo bo-UNMEASURED">RELEASED · UNMEASURED</b> <b>${esc(sd.leaf || '—')}</b> at ${esc(sd.pixel || '—')} · d ${sd.d ?? '—'} · walk gain ${sd.walk?.gain ?? '—'} z ${sd.walk?.z ?? '—'} (needs 0.015 / ${sd.walk?.z_required ?? '—'})` : sd.abstained ? `<b class="bo bo-DECLARED">ABSTAINED</b> ${esc(String(sd.why || '').slice(0, 110))}` : `<b class="bo bo-GUARDED">LANDED</b> <b>${esc(sd.leaf || '—')}</b> at ${esc(sd.pixel || '—')} · d ${sd.d ?? '—'} · margin ${sd.margin ?? '∞'}`;
    const s20 = wb.seeds20 ? ` <span class="dim">· last ${wb.seeds20.n}: ${wb.seeds20.landed} landed · ${wb.seeds20.released} released · ${wb.seeds20.abstained} abstained</span>` : '';
    const f = wb.fold; const foldTxt = !f ? '<span class="miss">not run — node scripts/vna/spec-tree.mjs</span>' : `${f.behind === 0 ? '<b class="bo bo-GUARDED">AT THE TAPE</b>' : f.behind == null ? '<b class="bo bo-UNMEASURED">UNMEASURED</b>' : `<b class="bo bo-BUILT">${f.behind} ROW${f.behind === 1 ? '' : 'S'} BEHIND</b>`} last fold <b class="age" data-at="${esc(f.at || '')}">${f.at ? fmtAge(Date.now() - Date.parse(f.at)) : '—'}</b> ago by ${esc(f.by || '?')} · ${f.folds} folds`;
    const bo = Object.entries(boCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<b class="bo bo-${esc(k)} bof" data-state="${esc(k)}" title="click to filter the spec list">${esc(k)}</b> ${v}`).join(' · ');
    // C113b: the fold state is the face; the cells ride under the + (the fold cell stays — nothing removed, C103b)
    const cells = `${wb.goal ? cell(`the /goal · turn ${wb.goal.turns.used + 1} of ${wb.goal.turns.min}–${wb.goal.turns.max}${wb.goal.turns.over ? ' · OVER BUDGET' : ''}`, `<b>${esc(wb.goal.text.slice(0, 160))}</b><br>${wb.goal.units.map((u) => `${u.done ? '☑' : wb.goal.current && u.n === wb.goal.current.n ? '▶' : '☐'} ${u.n}. ${esc(u.title.slice(0, 90))} <span class="dim">${esc(u.labels.join(' '))}${u.open.length ? ' · open ' + esc(u.open.join(' ')) : ''}${u.commits.length ? ' · ' + u.commits.length + ' commit' + (u.commits.length === 1 ? '' : 's') : ''}</span>`).join('<br>')}<br><span class="dim">done ${wb.goal.done} · left ${wb.goal.left} · node scripts/vna/goal.mjs</span>`, 'goal') : ''}${cell('next unit of work', next)}${cell('last seed · the snowball', seedTxt + s20)}${cell('the tree · fold', foldTxt)}`;
    return renderWorkbench(wb, { now: Date.now(), cells, bo: `the spec · ${items.filter((i) => i.done).length}/${items.length} ticked · borne-out · ${bo}` });
  })();
  // THE GLANCE LINES + THE HEARTBEAT — every number from a receipt already loaded above. "behind" is
  // asked of git (the walk's commit vs HEAD), as the sidebar's status bar does. The heartbeat is a
  // STATE: STALLED when the last ingest is newer than the last Claude read by more than STALL_MS,
  // STALE when the walk is behind HEAD, LIVE otherwise — the thresholds are named, not felt.
  const doneN = items.filter((i) => i.done).length;
  const glance = (() => {
    const ageOf = (iso) => iso ? `<b class="age" data-at="${esc(iso)}">${fmtAge(Date.now() - Date.parse(iso))}</b> ago` : 'not run';   // C98h: an absent receipt is not run, never never
    let behind = null; try { if (cock.commit) behind = Number(execFileSync('git', ['rev-list', '--count', `${cock.commit}..HEAD`], { cwd: REPO, encoding: 'utf8', timeout: 5000 }).trim()); } catch {}
    const delta = (cock.panels || []).find((p) => /Δ/.test(p.title || '')) || null;
    const armedTxt = `${clipName(steerFile.clip)} ${steerFile.clip?.armed ? 'ON' : 'off'}`;   // C130: the name through the one painter
    const notifiedTxt = timers.notified.state === 'notified' ? `Claude read ${ageOf(timers.notified.at)}` : timers.notified.state === 'waiting' ? '<b class="rr">NOT YET READ</b>' : 'Claude: nothing surfaced yet';
    const feed = watched.steer.lastAt
      ? `${armedTxt} · txt +${fmt(watched.steer.bytes)}B ${ageOf(watched.steer.lastAt)} by ${esc(watched.steer.by)} · ${notifiedTxt}`
      : `${armedTxt} · no append on the ledger yet`;
    const health = cock.missing ? 'walk not run — <code>node scripts/vna/cockpit.mjs</code>'
      : `${delta?.counts?.offPct ?? '—'}% off-lane · ${delta?.counts?.red ?? '—'} red · walk ${ageOf(cock.generatedAt)}${behind != null ? ` · ${behind} commit${behind === 1 ? '' : 's'} behind HEAD${behind > 0 ? ' <b class="rr">stale</b>' : ''}` : ''}`;
    const netLine = net.missing ? 'net not run — <code>node scripts/vna/mesh.mjs</code>'
      : `${esc(String(net.verdict || '').split(' — ')[0])} · caught ${net.caught}/${typeof net.water === 'number' ? net.water : (net.water || []).length} · mesh ${net.meshSize} vs fence ${net.fence} · ${(net.thin || []).length} thin · ${(net.holes || []).length} hole${(net.holes || []).length === 1 ? '' : 's'}`;
    const fork = env.missing ? 'envelope not run — <code>node scripts/vna/envelope.mjs</code>'
      : `arm 1: ${env.moveWork ? esc(env.moveWork.id || env.moveWork.coord) : 'nothing'} · arm 2: ${env.moveDecl ? `${esc(env.moveDecl.coord)} ← ${env.moveDecl.n} commits` : 'nothing'} · pull ${esc(env.pull)} · ${(env.abstained || []).length} abstained`;
    const tasks = `spec ${doneN}/${items.length} · ${items.length - doneN} open · tree ${stree.missing ? 'not run' : `${esc(String(stree.root || '').slice(0, 8))} · ${stree.counts?.nodes ?? 0} nodes · ${stree.counts?.revisions ?? 0} rev`}`;
    return { feed, health, net: netLine, fork, tasks, behind };
  })();
  // C98h: the three facts off their receipts (the walk tape's last row · the hook's last read · git HEAD vs the tape's ingested commit),
  // never the ledger's mtime or the cockpit's commit — each absent one says `not run — <command>` for itself
  const hb = heartbeat({ ...heartbeatFacts(), daemonPid: steerFile.clip?.daemon || null, armed: !!steerFile.clip?.armed, treeAt: watched.tree.at, page: { renderedAt: RENDER_STARTED_AT, newest: newestReceipt() } });   // C109l
  const lag0 = buildLag(); const sw = staleWriter();
  const lag = sw.html ? { ...lag0, html: `${sw.html} ${lag0.html}` } : lag0;   // C173c
  const lh = loopHealth();   // C78e — read once; the ribbon and card 3 paint the same receipt
  // C104a / C104c — NEXT → is computed once over the record (the cockpit receipt, the goal, the runner, the chain, the entitlement,
  // the onboard rows on the tape) and painted between the panels and the six lines; the steps the record has passed are recorded
  // as onboard rows through the tape's one append door so a taken step never re-opens after a reload
  const liveRunner = readRunner(resolve(REPO, '.thetacog/runner.ndjson'));
  const liveEnt = entitlementFromEnv();
  // C105: the strip is rendered once, then audited — the page reads its own buttons off the manifest controls.mjs derives from
  // this very HTML, so the doors line can never disagree with what is painted
  const tapeRowsAll = (() => { try { return readFileSync(FLIGHT, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } })();
  const licensedAll = tapeRowsAll.filter((row) => { try { return licenceOf(row).status === 'LICENSED'; } catch { return false; } }).length;
  const backupsPosted = (() => { try { return /\d+ posted$/.test(backupCardLine({ repo: REPO })) ? Number(/(\d+) posted$/.exec(backupCardLine({ repo: REPO }))[1]) : 0; } catch { return 0; } })();
  const step = nextStep({ walk: cock, goal: wb.goal, runner: liveRunner, chain: lh.chain, entitlement: liveEnt, onboard: tapeRowsAll, licensed: licensedAll, waiting: Math.max(0, tapeRowsAll.filter((row) => row.kind === 'commit' || row.kind === 'batch').length - licensedAll), backups: backupsPosted });
  if (!process.env.VNA_NO_FLIGHT_TAPE) { try { recordOnboard(step, { onboard: tapeRowsAll }); } catch {} }
  const avbLine = askedVsBuiltStripLine();   // C106: the full run's receipt line, else the fast glance (guards on disk, not run) — never computed twice
  const done = items.filter((i) => i.done).length;

  const acts = (a) => (a || []).map((l) => `<li>${esc(l)}</li>`).join('');
  // operator 2026-09-20: each story paragraph opens with the number it reads — the pull, the blocks, the off-lane % — read off the receipts
  const storyNum = (() => { const mv = story && !story.missing ? story.movement || {} : {}; const fr = story && !story.missing && story.frame && story.frame.tol ? story.frame.tol : null; const pull = env && !env.missing && env.pull != null ? `pull ${env.pull}` : mv.dispersionDelta != null ? `dispersion Δ ${mv.dispersionDelta}` : null; const blocks = Number.isFinite(mv.movedBlocks) ? `${mv.movedBlocks} block${mv.movedBlocks === 1 ? '' : 's'} moved` : null; const off = fr && fr.offPct != null ? `${fr.offPct}% off-lane` : null; const parts = [pull, blocks, off].filter(Boolean); return parts.length ? parts.join(' · ') : 'pull UNMEASURED · blocks UNMEASURED · off-lane UNMEASURED'; })();
  const actsN = (a) => (a && a.length ? `<li><b class="acc">${esc(storyNum)}</b> — ${esc(a[0])}</li>${acts(a.slice(1))}` : acts(a));

  // ── C141 THE NINE PILLS: the six T5 drawers keep their ids and their text (C130 · C109m.4) and fold under the pill each belongs to — the
  // spec drawer under 📄 Open Spec, the feed drawer with the workbench and the ingest receipt under 🟢 auto-paste, the panels · net · fork
  // drawers with the arms line under 🚶 Walk HEAD, the export drawer under 📋 Copy Run Summary. Nothing removed (C103b.2).
  // C130 (operator 2026-09-21: "Scrub Legacy Terms from the Auto-Generated Controls Section … ensure the documentation perfectly mirrors the
  // compiled extension's UI"): the T5 drawers keep their ids (the persisted open state keys on them) and lose the names Tasks · Feed · Health.
  // Each face names the door the drawer is for, bound to the command that already opens it — 📄 Open SPEC-VNA-COCKPIT.md → vna.openSpec
  // (the C94b command table's spec entry), the feed → the clipboard's own state through clipName (the toggle's painter), 🚶 Walk HEAD →
  // vna.steer (THE WALK card's door). The README's controls block is rendered from this page, so it prints these names and no other.
  // 
  const tasksDrawer = `<details class="g" id="g-tasks" open><summary title="what is on the spec and how much is ticked — the checked rows and the Merkle tree they fold into; the face opens docs/specs/vna/SPEC-VNA-COCKPIT.md in the editor (vna.openSpec); next: the unit card 1 names"><span class="gface"><button class="mini" onclick="event.preventDefault();go('vna.openSpec')" title="${esc(docTooltip('spec'))}"><b>📄 Open SPEC-VNA-COCKPIT.md</b></button> · <span class="gs">${glance.tasks}</span></span></summary>
 <!-- C103f THE CARD IS A LINK (operator 2026-09-20: "We don't write out the full text of the spec in the side panel: when you
      click it, you open the document"). The spec rows and the tree nodes are one aggregate line each; the click opens the
      file in the IDE (vna.openSpec · vna.openTree, the C94b command table); the counts and the borne-out chips sit behind a +.
      The row text and the node text live in the document, never here — the rendered page fell from 13.4 MB on this change. -->
 <div class="card3 c-spec-line"><div class="c3l face">${B('vna.openSpec', `spec · ${done}/${items.length} ticked · ${items.length - done} pending · open →`, `${docTooltip('spec')}`, 'sb doc')}${plusFold('spec', 'the spec\'s borne-out counts (GUARDED · MEASURED · BUILT · DECLARED, read from each guard\'s last run) and the tick bar; the rows themselves are in the file the line opens; next: ↗ open →', `<div class="c3h c3t"><b>THE SPEC</b> <span class="spark" title="the rows are in the document — the counts are here">${items.length ? Math.round(100 * done / items.length) : 0}% ticked</span></div><div class="bar" style="--spec-done:${items.length ? Math.round(100 * done / items.length) : 0}%"><i></i></div><div class="dim" style="margin:.2em 0 .5em">borne-out, read from receipts (C53c): ${Object.entries(boCounts).map(([k, v]) => `<b class="bo bo-${esc(k)}">${esc(k)}</b> ${v}`).join(' · ')}</div>`)}</div></div>
 <div class="card3 c-tree-line"><div class="c3l face">${B('vna.openTree', `tree · root ${esc(String(stree.root || '').slice(0, 8) || '—')} · ${stree.missing ? 'not run' : `${stree.counts?.nodes ?? 0} nodes`} · ${stree.missing ? '—' : (() => { try { return ungradedCount(stree).total; } catch { return '—'; } })()} ungraded · open →`, `${docTooltip('tree')}`, 'sb doc')}${plusFold('tree', 'the tree\'s gauge and meter — what a clear would lose, what was not re-sent; the nodes themselves are in data/vna/spec-tree.txt, which the line opens; next: ↗ open →', `<div class="c3h c3t"><b>THE TREE</b> <span class="spark" title="the nodes are in the document — the gauge is here">${stree.missing ? 'UNMEASURED' : `${stree.counts?.nodes ?? 0} nodes`}</span></div>` + renderSpecTreeHead({ stree, clip: steerFile.clip, timers, gauge, meter }))}</div></div>
   <details id="d-questions"><summary title="the open questions the ratchet has not yet closed — each filed under the id it was raised at; read before filing a new one">Open questions</summary><div class="card"><h2>Open questions</h2>
   <ul>${qs.map((q) => `<li><b>${esc(q.id)}</b> ${esc(q.text)}</li>`).join('') || '<li class="dim">none</li>'}</ul></div></details>

   <details id="d-trigger"><summary title="what makes a corpus attach-eligible and what happens once it does — the coverage gap and the attach curve, read from the trigger receipt, never typed">The trigger</summary><div class="card"><h2>The trigger</h2>
   ${trigger.missing ? miss(trigger) : `<div class="k">eligible ${trigger.eligible}/${trigger.corpus} · ${trigger.notEligible} carry no measurement (coverage gap, not a clean book)</div>
   <ul>${(trigger.curve || []).map((c) => `<li>attach <b>${c.threshold}</b> · ${c.events} events · ${(100 * c.rate).toFixed(1)}% <span class="${c.writable.startsWith('yes') ? 'ib' : 'rr'}">${esc(c.writable)}</span></li>`).join('')}</ul>`}
   ${sev.missing ? '' : `<div class="k" style="margin-top:8px">severity: <b>${esc(sev.status)}</b>${sev.status === 'UNDERPOWERED' ? ` — ${sev.n}/${sev.floor}, shortfall ${sev.shortfall}` : ''}</div>`}
   ${under.missing || !under.physical?.admissible ? '' : `<div class="k">physical attestation: ADMISSIBLE · control ${under.physical.control.ratio_median.toFixed(3)}x — a measured cost, not an enforcement</div>`}</div></details>

   <details id="d-tape"><summary title="the last commits taped and where each was placed — an UNPLACED entry carries no coordinate yet, never a guess">The tape — last ${tape.length} entries (the mass in the paste)</summary><div class="card"><h2>The tape — last ${tape.length} entries (the mass in the paste)</h2>
   ${tape.map((t) => `<div class="rm"><span><code>${esc(t.sha)}</code> ${esc(t.subject.slice(0, 64))}</span>` +
     `<span class="${t.placed ? 'ib' : 'up'}">${t.placed ? `${esc(t.coord)} · σ ${esc(t.sigma)}` : 'UNPLACED'}</span></div>`).join('')}
   <div class="k" style="margin-top:8px">Their full text rides in the clipboard payload — one commit alone is a thin rule with no mass to compare against.</div></div></details>

</details>`;
  const feedDrawer = `<details class="g" id="g-feed" open><summary title="what the loop is reading — the steer file the clipboard and the tail watcher append to, and whether the daemon has read it yet; the face is the clipboard's state (🟢 armed · ⚪ not), the toggle itself is on the live line; next: fold it into the tree (📋→🌳) or walk"><span class="gface"><b>${clipName(steerFile.clip)}</b> · <span class="gs">${glance.feed}</span></span></summary>
 <div class="card watched">${renderWatched({ w: watched, timers, clip: steerFile.clip })}</div>
 ${renderLastPrompt(readLastPrompt(resolve(REPO, '.thetacog/lens-encircled/latest.json')))}
 <details class="g2" id="g-feed-steer"><summary title="the .txt the loop follows (its path, size, last append, who appended) — every ⌘C with auto-paste on and every tail append lands here before it is folded">The steer file — what the loop follows</summary>  <div class="card"><h2>The steer file — what the loop follows</h2>
   ${renderSteerFile(steerFile)}</div>
</details>
</details>`;
  const healthDrawer = `<details class="g" id="g-health"><summary title="how far the last walked commit sits from its declared lane — off-lane %, red rings, the age of the walk, commits behind HEAD; the face walks HEAD again (vna.steer — the same door THE WALK card runs, every sensor, ≈2 s) and re-renders; next: read Δ on the triptych"><span class="gface"><button class="mini" onclick="event.preventDefault();go('vna.steer')" title="walk the last authored commit again — every sensor (≈2 s) — and repaint; the same door as THE WALK card's 🚶; next: read Δ on the triptych"><b>🚶 Walk HEAD</b></button> · <span class="gs">${glance.health}</span></span></summary>
 <div class="card"><h2>The panels — the ballistic walk on the chip${cock.missing ? '' : ` · ${esc(cock.engine || 'engine unreported')} · commit ${esc(cock.commit)} · pipeline ${cock.pipelineMs}ms · agreement ${cock.agreementPct ?? '—'}%`}</h2>
${renderPanels(cock)}
</div>


 <details class="g2" id="g-health-ap"><summary title="what the chip looked at — the engine, the raw→cut ratio and whether the aperture matched and cleared its byte floor; below the floor the walk is UNMEASURED, never wrong">the aperture — ${cock.missing || !cock.aperture ? 'UNMEASURED' : `${esc(cock.aperture.rawRatio)}:1 raw → ${esc(cock.aperture.usedRatio)}:1 cut`}</summary><div class="card"><h2>The aperture — what the chip looked at${cock.missing || !cock.aperture ? '' : ` · ${esc(cock.aperture.engine || 'engine unreported')} · ${esc(cock.aperture.rawRatio)}:1 raw → ${esc(cock.aperture.usedRatio)}:1 cut · ${cock.aperture.matched ? 'matched' : '<b class="rr">NOT MATCHED</b>'} · ${cock.aperture.admissible ? 'above the floor' : `<b class="rr">below the ${esc(cock.aperture.floor)}-byte floor</b>`}`}</h2>
${cock.missing ? miss(cock) : !cock.aperture ? '<div class="miss">this receipt predates the aperture rows — re-run <code>node scripts/vna/cockpit.mjs</code></div>' : `
 <div class="k">intent ${esc(cock.aperture.intentBytes)}B (gzip ${esc(cock.aperture.intentGzip)}) · reality ${esc(cock.aperture.realityBytes)}B (gzip ${esc(cock.aperture.realityGzip)})${cock.aperture.reason ? ` · <span class="rr">${esc(cock.aperture.reason)}</span>` : ''}</div>
 <ul class="abst" style="max-height:220px">${(cock.aperture.rows || []).map((r) => `<li><span class="${r.side === 'intent' ? 'ib' : 'up'}">[${esc(r.side)}]</span> <code>${esc(r.path)}</code> <span class="k">${esc(r.rawBytes)}B → ${esc(r.usedBytes)}B · ${esc(r.sharePct)}%${r.truncated ? ' · CUT' : ''}</span></li>`).join('')}</ul>
 <div class="k dim" style="margin-top:8px">gzip-NCD measures meaning only at matched mass. The larger side is CUT, never the smaller grown — repetition adds length, not entropy. Each document's share is proportional, so a many-file commit is not judged by the first four.</div>`}
</div>

</details>
</details>`;
  const netDrawer = `<details class="g" id="g-net"><summary title="whether the net is holding — how many of the last commits the fence caught, mesh vs fence, thin cells and holes on the 144 lattice; next: a hole is a lane with no spec row, declare one"><span class="gface"><b>Net</b> · <span class="gs">${glance.net}</span></span></summary>
 <div class="card"><h2 title="is the mesh fine enough to catch the water">The net — ${net.missing ? 'UNMEASURED' : esc(String(glance.net))}</h2>
${net.missing ? miss(net) : `
 <p class="verdict">${net.meshSize == null ? 'UNMEASURED — no placed work in the window' :
   net.meshSize > net.fence
     ? `The net is <b>TOO WIDE</b>. The water lands <b>${esc(net.meshSize)} blocks</b> from the nearest strand and the fence is ${esc(net.fence)} — ${esc(net.caught)} of ${esc(net.water)} commits caught (${esc(net.coveragePct)}%).`
     : `The net is holding — mass is landing inside the declared fence, ${esc(net.caught)}/${esc(net.water)} caught (${esc(net.coveragePct)}%).`}</p>
 <p class="verdict" style="font-size:13.5px;color:var(--fg)">${esc(net.horizon?.sentence || 'UNMEASURED')}</p>
 <div class="k dim" style="margin-bottom:8px">A = <b>long</b>-term (Strategy) · C = <b>medium</b>-term (Operations) · B = <b>short</b>-term (Tactics). A coordinate is an intersection of two horizons; the grid stays in ShortLex order because that is the address every receipt keys on, so the horizon is a label on the tier and never a re-sort.</div>
 <div class="k">${esc(net.strands)} strand(s) the placer stood behind · ${esc((net.thin || []).length)} too thin to catch anything (margin under ${esc(net.floor)}) · ${esc((net.holes || []).length)} hole(s) · ${esc((net.slack || []).length)} slack</div>
 ${(net.holes || []).length ? `<ul class="abst" style="max-height:170px;margin-top:8px">${net.holes.slice(0, 8).map((h) => `<li><b>${esc(h.name)}</b> <span class="k">${esc(h.n)} commit(s) · nearest strand ${esc(h.nearest?.id || 'none')} at ${esc(h.nearest?.d ?? '—')} blocks</span></li>`).join('')}</ul>` : ''}
 ${spl.missing || !spl.stories?.length ? '' : `<div style="margin-top:12px;border-top:1px solid #1e242e;padding-top:10px">
  <div class="k" style="margin-bottom:6px;color:var(--acc)">TRANSLATED — what landed where, and the words that carried it</div>
  ${spl.stories.map((st) => `<div style="margin-bottom:9px">
    <div><b>${esc(st.name)}</b> <span class="k">(${esc(st.horizonLanded || '—')}-term)</span> ← <span class="k">${st.declared ? `${esc(st.declared.id)} at ${esc(st.declared.name)} (${esc(st.horizonDeclared || '—')}-term), ${esc(st.declared.blocks)} blocks` : 'nothing declared'}</span></div>
    ${st.carried.length ? `<div class="k">words that carried it there: <b>${esc(st.carried.slice(0, 8).join(', '))}</b></div>` : '<div class="k dim">no distinctive vocabulary from the landed coordinate appears in those commits — the placement came from structure, and this story is weaker for it</div>'}
    <div class="k dim">${esc((st.shas || []).join(' '))}</div>
  </div>`).join('')}
  <div class="k dim">Two moves, and the instrument does not choose between them: aim the next commit at the declared coordinate, or move the declaration to where the work is.</div>
 </div>`}
 <div class="k dim" style="margin-top:8px">A hole is where the net is too wide — mass landed and nothing declared is inside the fence. A thin strand is a declaration the placer refused to stand behind: it is not distinctive enough to catch anything. Tighten by declaring at the coordinate, or accept the drift as the lane.</div>`}
</div>


 <details class="g2" id="g-net-map"><summary title="the 144-cell lattice — rows are the actor lane, columns the patient lane; a lit cell is a commit placed there; hover a cell for its coordinate and its rows">the map — 144 lattice, rows = actor lane, cols = patient lane</summary><div class="card"><h2>The map — 144 lattice, rows = actor lane, cols = patient lane</h2>
${renderMap({ align, comp, trigger, net })}
<div class="legend" title="hover any swatch for its meaning, or a cell for its full ShortLex name and why it is lit">
 <span title="your centre of mass"><i style="background:#a56bff;outline:2px solid #fff"></i></span>
 <span title="peak mass"><i style="background:#2b6cb0"></i></span>
 <span title="growth edge"><i style="background:#2a3a2a;outline:1px dashed #1e9150"></i></span>
 <span title="room pole (in band)"><i style="background:#123"></i></span>
 <span title="room pole (re-roll)"><i style="background:#132;outline:1px solid #ffb000"></i></span>
 <span title="where that room's work sits"><i style="background:#ffb000"></i></span>
 <span title="severe trigger events"><i style="background:#ff5959"></i></span>
</div>
</div>

</details>
</details>`;
  const forkDrawer = `<details class="g" id="g-fork"><summary title="the two arms the drift offers — move the work back to the declaration, or move the declaration to the work — with the pull between them; ⇄ pick records your choice on the ledger, never inferred"><span class="gface"><b>Fork</b> · <span class="gs">${glance.fork}</span></span> <button class="mini" onclick="event.preventDefault();go('vna.cycle')" title="both arms with pick buttons — the pick is recorded, never inferred">⇄ pick</button></summary>
   <div class="card"><h2>Both arms — move the work, or move the declaration</h2>
   ${renderArms(env)}</div>

 <details class="g2" id="g-fork-story"><summary title="one frame of what the walk saw, how it moved since the last commit, and what that means — read from data/vna/story.json, no model">The story — one frame</summary>  <div class="card"><h2>The story — one frame</h2>
   ${story.missing ? miss(story) : `<ul>${acts(story.acts?.oneFrame)}</ul>`}</div>
  <div class="card"><h2>How it moves · ${esc(storyNum)}</h2>
   ${story.missing ? miss(story) : `<ul>${actsN(story.acts?.movement)}</ul>`}</div>
  <div class="card"><h2>What it means for the work · ${esc(storyNum)}</h2>
   ${story.missing ? miss(story) : `<ul>${actsN(story.acts?.meaning)}</ul>`}</div>
</details>
 <!-- C155: the envelope moved under ⚙️ Tokens per cog's + (g-cog-fm) -->
   <details id="d-rooms"><summary title="each room against its declared name — IN BAND held, RE-ROLL forced a new declaration, the pull between them; a flag, never acted on">The rooms</summary><div class="card"><h2>The rooms</h2>
   ${align.missing ? miss(align) : (align.rooms || []).map((r) => `<div class="rm"><span>${esc(r.emoji || '')} ${esc(r.key)} <span class="k">${esc(r.declaredName || '—')}</span></span>` +
     `<span class="${r.status === 'RE-ROLL' ? 'rr' : r.status === 'IN BAND' ? 'ib' : 'up'}">${esc(r.status)}${r.pull != null ? ` · pull ${r.pull}` : ''}</span></div>`).join('')}
   ${align.missing ? '' : `<div class="k" style="margin-top:8px">attribution ${align.coverage?.pct}% · band ${align.band} blocks · a flag is surfaced, never acted on</div>`}</div></details>

</details>`;
  const exportDrawer = `<details class="g" id="g-export"><summary title="copy the whole state as text for a chat — the shape, the movement, the meaning and the open rows; stamped on its first line so the daemon never re-ingests it"><span class="gface"><b>Export</b> · <span class="gs">${tape.length} tape row${tape.length === 1 ? '' : 's'} · ${items.length - done} open</span></span></summary>
   <div class="card"><h2 title="copy the state below to the clipboard">Copy to the chat on the right · ${tape.length} tape row${tape.length === 1 ? '' : 's'}</h2>
   <button onclick="cp()" title="copy the state below to the clipboard — paste it into the chat on the right; it is stamped, so pasting it back never re-enters the tree">📋 Copy the whole state</button>
   <textarea id="pay">${esc([
     story.missing ? '' : ['# THE SHAPE', ...(story.acts?.oneFrame || []), '', '# HOW IT MOVES', ...(story.acts?.movement || []), '', '# WHAT IT MEANS', ...(story.acts?.meaning || [])].join('\n'),
     stree.missing ? '' : ['', `# SPEC TREE root ${stree.root} · ${stree.counts?.nodes} nodes · ${stree.counts?.revisions} revisions · unchanged since ${stree.rootSince}`].join('\n'),
     // C103f: the open rows by HEADLINE (label + first clause, rowHeadline off specRows) — the rows' full text lives in the spec file, named here, never written out
     '', `# SPEC ${done}/${items.length} · borne-out ${Object.entries(boCounts).map(([k, v]) => `${k} ${v}`).join(' · ')} · full rows: docs/specs/vna/SPEC-VNA-COCKPIT.md`, ...items.filter((i) => !i.done).map((i) => { const b = boOf(i.id); return `[ ] ${b.state}${b.state === 'RED' ? ` (${b.why})` : ''} ${rowHeadline(i.id, { md }) || i.id}`; }),
     '', '# OPEN QUESTIONS', ...qs.map((q) => `${q.id} ${q.text}`),
     net.missing ? '' : ['', meshText(net)].join('\n'),
     spl.missing ? '' : ['', splatterText(spl)].join('\n'),
     ['', `# TAPE — last ${tape.length}`, ...tape.map((t) => `${t.sha} ${t.placed ? `${t.coord} σ${t.sigma}` : 'UNPLACED'} — ${t.subject}`)].join('\n'),
     align.missing ? '' : ['', '# ROOMS', ...(align.rooms || []).map((r) => `${r.key} ${r.declaredName || '—'} ${r.status}${r.pull != null ? ` pull ${r.pull}` : ''}`)].join('\n'),
   ].join('\n'))}</textarea>

</details>`;
  // C155: under ⚙️ Tokens per cog's + — the ratchet to the dignity pixel (four receipts), then the envelope (the formal methods on their receipts — moved here from the fork drawer, painted once)
  const cogFold = `<details class="g2" id="g-cog-fm"><summary title="the formal methods on their receipts — the crystal, the shape guards, the readings — each PROVED, MEASURED or UNMEASURED from its own file, never asserted here">The envelope — the formal methods, read from their receipts</summary><div class="card"><h2>The envelope — the formal methods, read from their receipts</h2>
   ${renderEnvelope(fm)}</div></details>`;
  const folds = { cog: cogFold, contract: tasksDrawer, paste: `${wbHtml}${renderIngestCard(readIngest(), { now: Date.now() })}${feedDrawer}`, walk: `${renderArmsLine(env)}${healthDrawer}${renderOptimiserRail(loadLoopHealth(), { prev: loadPrevLoopHealth() })}${netDrawer}${forkDrawer}`, export: exportDrawer };
  // the nine pills, painted once; the doors audit (C105) runs over them and its line is set into the tree pill's BUILD cell and the live line after
  const refreshAge = (() => { try { return `<span class="age" data-at="${esc(statSync(resolve(REPO, 'docs/specs/vna/steer/latest.html')).mtime.toISOString())}">${fmtAge(Date.now() - statSync(resolve(REPO, 'docs/specs/vna/steer/latest.html')).mtime.getTime())}</span> ago`; } catch { return 'not run'; } })();
  const pillsRaw = renderCards({ clip: steerFile.clip, runner: liveRunner, goal: wb.goal, lens: readLensReceipt(), chain: lh.chain, loop: lh, entitlement: liveEnt, next: step, cock, preview: cockPreview, turn: turnsSinceCommit(), behind: glance.behind, aperture: apertureRcpt, ingest: (() => { try { return readIngest(); } catch { return null; } })(), treeAt: watched.tree.at, gauge, meter, build: lag, doors: '__DOORS_LINE__', doorsDisagree: '__DOORS_WARN__', tapeBackups: { local: tapeRowsAll.length, third: backupsPosted, countersigned: licensedAll }, folds, hb, refreshAge, lagHtml: lag.html, avbLine });
  const doors = doorAudit(controlsManifest(pillsRaw));   // C105: audited over the very HTML the pills are, then the line and its warn class are set in
  const pillsHtml = pillsRaw.split('__DOORS_LINE__').join(esc(doorLine(doors))).split('__DOORS_WARN__').join(doors.disagree.length ? ' warn' : '');

  let html = `<!doctype html><meta charset="utf-8"><title>${esc(STEER_NAME)}</title>
<style>${PAGE_CSS}
</style>
<div class="wrap">
${renderHeader({ repaint: repaintLine({ cause: renderCause(), host: process.env.VNA_RENDER_HOST || null }), ext: lag.ext, spec: `spec ${doneN}/${items.length} ticked`, trial: (() => { const d = ((shownCock(cock, cockPreview) || {}).panels || []).find((p) => /Δ/.test(p.title || '')); return d && d.counts && d.counts.offPct != null ? `Δ ${d.counts.offPct}% off-lane · ${d.counts.red ?? '—'} red` : null; })() })}
<!-- THE HEARTBEAT (operator, 2026-09-17: "We need a health check to be obvious … the second since last
     time Claude checked off ingested the pasted stuff") — one pinned line, a STATE not a number:
     LIVE · STALE · STALLED, from four dated facts already on disk. Then THE SIX GLANCES ("expandable
     drill down not just scroll" · "scroll sideways … for the spec overview"): one line each, closed by
     default, three levels deep; what you open stays open across re-renders. -->
${pillsHtml}
</div></div>
<script>
// COPY OFF THE PAGE IS AN EXPORT (2026-09-17, row 16: a selection copied off the panel was appended
// by the clipboard daemon as new mass). Any selection copied from this page leaves with the export
// stamp on its first line, which the daemon refuses on sight. The page's own copy buttons go through
// the host (copyOut), which stamps too; this covers the mouse.
document.addEventListener('copy', function (e) {
  var s = String(window.getSelection && window.getSelection() || '');
  if (!s.trim() || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', '<!-- thetacog:export · ' + new Date().toISOString() + ' · a read-out of the record, not mass — the clipboard daemon never appends this -->\\n' + s);
  e.preventDefault();
});
${OPEN_STATE_SCRIPT}
// THE TICKER: advances every displayed age from its own data-at each second. Display only — the
// source timestamps were read from disk by the renderer; this never computes a new one.
(function(){function f(ms){if(!(ms>=0))return'—';var s=Math.floor(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s';var h=Math.floor(m/60);if(h<48)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d '+(h%24)+'h';}
function tick(){var now=Date.now();document.querySelectorAll('.age[data-at]').forEach(function(el){var t=Date.parse(el.getAttribute('data-at'));if(t)el.textContent=f(now-t);});}
setInterval(tick,1000);tick();})();

function proof(id){var d=document.getElementById('plus-'+id);if(!d)return;d.open=true;var g=d.querySelector('.cxsvg')||d.querySelector('.cogsvg');if(g&&g.scrollIntoView)g.scrollIntoView({block:'nearest'});}
function go(c,t){if(/^vna\.[a-z]+Proof$/.test(c)){proof(c.slice(4,-5));return;}if(typeof _go==='function')_go(c,t);else alert('open this page in the ThetaCog sidebar (VS Code) to run '+c+' — the browser copy cannot spawn it');}
// C201b — the steer page carries no chat (it lives in its own sidebar section); what stays of this script is the C167h skew-safe
// door check, which dims any go(…) control whose command this window did not register.
(function(){
  var api=(typeof window.__vs!=='undefined'&&window.__vs)?window.__vs:null;
  window.addEventListener('message',function(e){
    var m=e.data;if(!m)return;
    // C167h SKEW-SAFE DOORS — the host answered 'ready' with exactly what THIS window registered; a button whose command
    // is missing is dimmed instead of left live to toast "not registered" when clicked (operator: "no persistence? does it
    // even execute?"). Every go(…)-posting control on the page is checked, not only the chat pill's own.
    if(m.type==='commandsInfo'){
      var have={};(m.commands||[]).forEach(function(c){have[c]=true;});
      document.querySelectorAll('[onclick],[onchange]').forEach(function(el){
        var src=(el.getAttribute('onclick')||'')+(el.getAttribute('onchange')||'');
        var mm=/go\\(\\s*(?:this\\.checked\\s*\\?\\s*'([^']+)'\\s*:\\s*'([^']+)'|'([^']+)')/.exec(src);if(!mm)return;
        var cmds=[mm[1],mm[2],mm[3]].filter(Boolean);
        cmds.forEach(function(cmd){
          if(/^vna\.[a-z]+Proof$/.test(cmd))return;
          if(have[cmd])return;
          el.setAttribute('disabled','');el.classList.add('skew-dim');
          el.title='needs '+(m.source||'?')+' · installed '+(m.installed||'?')+' · install from Desktop';
        });
      });
      return;
    }
    // C201b: no chatHistory branch — the host may still post it on 'ready', and it is ignored here; the chat section reads the
    // shared transcript itself (C167h).
  });
  if(api)api.postMessage({type:'ready'});
})();
function cp(id,btn,label){const t=document.getElementById(id||'pay');t.select();document.execCommand('copy');const b=btn||event.target;const was=label||'📋 Copy the whole state';b.textContent='✅ copied';setTimeout(()=>b.textContent=was,1400);}
// C56: click a borne-out chip in the workbench to filter the spec list to that state; click again to clear
document.querySelectorAll('.bof').forEach((c) => c.addEventListener('click', () => { const on = c.classList.contains('on'); document.querySelectorAll('.bof').forEach((x) => x.classList.remove('on')); const st = on ? null : c.dataset.state; if (!on) c.classList.add('on'); document.querySelectorAll('.speclist li').forEach((li) => li.classList.toggle('hide', !!st && li.dataset.state !== st)); const d = document.getElementById('g-tasks-spec'); if (d) d.open = true; }));
</script>`;

  mkdirSync(resolve(REPO, 'docs/specs/vna/steer'), { recursive: true });
  // ONE PAGE (T10, operator 2026-09-17: "slotted into the tree efficiently instead of opening a new txt
  // file"). The page is latest.html and nothing else; the sidebar re-renders it on every append, and a
  // dated copy per render was 33 files in one evening — clutter that reads as history but is not (the
  // receipts ARE the history). `--keep` writes one dated copy for a deliberate snapshot.
  const p = resolve(REPO, 'docs/specs/vna/steer/latest.html');
  html = refDoors(html);   // C109e: row ids → vna.viewUnit(label), receipt paths → vna.openFile, metrics carry data-doc — before the panel line is read, so the reading is over the page as mounted
  html = awayCommands(html);   // C94b: identity at home; in a stranger's repo the not-run lines name the door they can run
  // C106: the panel line is read over THIS page — the placeholder is one copy line until it is replaced, so the reading is
  // taken with it removed, then the line (digits, always a value line) is set in; the CLI door reads the same bytes back
  { const sig = panelSignal(html.replace('__PANEL_SIGNAL__', '').replace('__STEER_TTL__', '0 of 0 lines are receipts · this page computes none of them')); /* the stand-in carries a digit, as the set line will — the header is a value line both times, so the count the CLI reads back equals the count painted */ const fl = readPanelFloor(); html = html.replace('__PANEL_SIGNAL__', esc(panelLine(sig, fl ? { floor: fl.copy, over: sig.copy > fl.copy } : null))); html = html.replace('__STEER_TTL__', esc(`${sig.value} of ${sig.lines} lines are receipts · this page computes none of them`)); }   // operator 2026-09-20: "nothing computed here? that is a zero signal to noise" — the header carries the count itself
  writeFileSync(p, html);
  if (process.argv.includes('--keep')) writeFileSync(resolve(REPO, 'docs/specs/vna/steer', `steer-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.html`), html);

  const absent = [story, align, comp, trigger, under, sev, cock, env, stree].filter((r) => r.missing);
  console.log(`VNA steer UI — spec ${done}/${items.length} · ${absent.length ? `${absent.length} receipt(s) absent` : 'all receipts present'}`);
  for (const a of absent) console.log(awayCommands(`  not run: ${a.file} → ${a.cmd}`));   // C94b: the terminal line names the same door the page does
  console.log(`  ${p}`);
  // THE DOOR IS THE SIDEBAR WHEN THE IDE IS UP, THE FILE WHEN IT IS NOT — decided in ONE place
  // (chooseDoor, guarded by tests/vna/steer-ui-door.test.mjs). History, so the default is not
  // re-moved: until 0.3.1 the IDE door opened the webview BESIDE the code (ViewColumn.Beside), and
  // on 2026-09-08 the operator moved the default to `open <path>` ("no need to split panel"). At
  // 0.3.2 the page became an activity-bar VIEW — it costs the code no width — and on 2026-09-17 the
  // operator moved the default back: "open the sidebar (not the html) in vscode … instead of html in
  // browser or split file pane by default". The `/page` route only focuses the view; the sensors ran
  // here, and the view re-reads the file this script just wrote. `--open file` still asks for the
  // browser, `--open ide` still insists on the panel — nothing is removed, the DEFAULT moved.
  if (!noOpen) {
    const want = process.argv.includes('--open') ? process.argv[process.argv.indexOf('--open') + 1] : 'auto';
    const door = chooseDoor({ want, ideRunning: ideRunning(), extInstalled: extInstalled() });
    let opened = null;
    if (door === 'ide') {
      try { execFileSync('open', [IDE_DOOR]); opened = 'the ThetaCog sidebar'; }
      catch { opened = null; }
    }
    if (!opened) {
      try { execFileSync('open', [p]); opened = 'the file'; }
      catch (e) { console.log(`  (open failed: ${e.message})`); }
    }
    if (opened) console.log(`  opened as ${opened}${door === 'ide' && opened === 'the file' ? ' — the IDE door did not answer' : ''}`);
  }
}

// The URI the extension's handler routes to "focus the view, run nothing" (extension.ts,
// handleUri). An older extension that does not know `/page` falls to its default branch, which
// focuses the view and re-runs the sensors — slower, never wrong.
const IDE_DOOR = 'vscode://thetadriven.thetacog-mcp/page';
// "Running" is the MAIN process, not a helper: the helpers outlive a closed window, and a URI
// handed to a dead main process launches a new one, which is not the door the operator asked for.
// `ps -axo comm`, not pgrep: pgrep -f cannot read the main process's argv on this machine (measured
// 2026-09-17 — it listed every helper and missed pid 626), so a pgrep here would always say "down".
const IDE_MAIN = 'Visual Studio Code.app/Contents/MacOS/Code';
function ideRunning() {
  try { return execFileSync('ps', ['-axo', 'comm'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').some((l) => l.trim().endsWith(IDE_MAIN)); }
  catch { return false; }
}
function extInstalled() {
  try { return readdirSync(resolve(process.env.HOME || '', '.vscode/extensions')).some((d) => d.startsWith('thetadriven.thetacog-mcp-')); }
  catch { return false; }
}
// Pure: (what was asked, what is up) → which door. 'auto' takes the sidebar whenever it can be
// reached, the file otherwise; an explicit ask is honoured as asked.
function chooseDoor({ want = 'auto', ideRunning = false, extInstalled = false } = {}) {
  if (want === 'ide') return 'ide';
  if (want === 'file' || want === 'browser') return 'file';
  return ideRunning && extInstalled ? 'ide' : 'file';
}
export { renderMap, renderPanels, renderArms, renderSpecTree, renderSpecTreeHead, renderSpecOverview, renderLeaf, specBlocks, load, chooseDoor, IDE_DOOR };
if (import.meta.url === `file://${process.argv[1]}`) main();
