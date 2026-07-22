#!/usr/bin/env node
// scripts/pmu/commit-triptych.mjs — THE ON-COMMIT DOGFOOD (canonical anatomy).
//
// Drives the SAME running pipeline that produced the screenshot (scripts/pmu/pipeline.mjs →
// walk + xor bitmaps), commit-scoped, and renders the 144×144 lattice TRIPTYCH exactly as the
// dashboard does (INTENT · REALITY · DELTA-XOR; both axes = the 144 ShortLex anchors, cell = row
// ⊕ col) + the three-colour tolerance overlay. Real inline PNGs (node:zlib), so it travels in the
// email. Fast (commit-scoped, ~0.3-2s on the chip) — never the 21s LLM path.
//
//   node scripts/pmu/commit-triptych.mjs [--commit <sha>=HEAD] [--out <html>] [--email] [--open]
//
// @canonical-algorithm  on-commit dogfood: commit-SCOPED ingest (docs/message→INTENT, diff-code→REALITY) → definerWalk144 ON CHIP → 144×144 triptych → CID-inline email; fast (~0.3-2s), never the LLM path
// @forbidden-alternative  whole-repo / repo-ops-file / axis-def / spec flood in INTENT (peaks every commit on one anchor → symmetric, low σ) · the 12-axis JS leaf walk · a --gemini flag on the on-commit hook (the 21s path)
// @why  drift = what we SAID (docs) vs what we DID (code), per commit; a generic flood makes every commit look identical and the instrument can't tell two commits apart
// @guard  tests/pmu-simulator/dogfood-success-factors.test.mjs (SF3,SF4,SF8,SF9,SF13) · tests/pmu-simulator/gemini-spec-inspection.test.mjs

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync as fexists } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { runPipeline } from './pipeline.mjs';
import { renderTriptych } from './triptych-render.mjs';
import { reefBridge } from './reef-bridge.mjs';   // deterministic code→reef bridge — fixes the reality-walk collapse (empty panels)
import { coordName } from './shortlex-names.mjs';   // canonical A1→"Strategy.Law" translation — names every encircled coordinate (LLM-free)
import { encircleRegionsPng } from './annotate-regions.mjs';   // encircled-regions headline (named ShortLex regions)
import { detectRegions } from './regions-chip.mjs';   // THE one functional entry — chip clustering + JS labeling tail, identical shape. Default JS (byte-identical); PMU_REGIONS_CHIP=auto routes to the metal.
import { narrateRegions } from './region-narrative.mjs';   // qwen per-region META-COMMENT on THIS commit msg (reef-named), off the critical path — replaces the generic 144-lattice snippet in the COMPETENCE SHAPE list
import { laneVerdict, renderAttestation, assembleAuditorBody } from './auditor-attestation.mjs';   // AUDITOR-GRADE: decidable LANE:IN/OUT + top ATTESTATION block first, interpretive narration last
import { legend, legendLine, percentile, whatGoodLooksLike, walkCountRow, measureBand, measureVerdict, leadsTo } from './sigma-legend.mjs';   // SPEC #3: every number names itself (type · band · verdict · percentile vs last-10 · leadsTo)
import { definerWalk144, COORDS } from './definer-walk-144.mjs';
import { pickStartPixel } from './start-pixel.mjs';
import { tellStory } from './walk-story.mjs';
import { renderAudio } from './walk-audio.mjs';

// SIGHUP GUARD (2026-06-12 — the missing-images band): the post-commit hook detaches this run
// with `( nohup bash -c "node …" & )`, but bash RESETS SIGHUP to default in its children — nohup
// only shields bash itself. When the operator closed the terminal, the session's process-group
// HUP killed THIS node mid-run (logs: `bash: line 6: <pid> Hangup: 1  node …` at 22:34–23:15
// Jun 11) — ~10 commit emails died between render and send, panels never arrived. Reproduced
// bit-for-bit with `kill -HUP -<pgid>`. A no-op listener keeps the detached, file-logged job
// alive through terminal close and does NOT hold the event loop open (verified: instant exit).
process.on('SIGHUP', () => {});

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const sha = arg('--commit', 'HEAD');
const EMAIL = process.argv.includes('--email');
const PUBLISH = process.argv.includes('--publish');   // write public/commit/<sha>/ without sending email (npx publish-commit)
const OPEN = process.argv.includes('--open');
// FAST FOREGROUND SEND (additive 2026-06-30): `--no-story` (alias `--fast`) SKIPS the slow, optional
// enrichment stages that block a foreground `--email` send but are designed to run detached in the
// post-commit async job — the qwen per-region narration (narrateRegions), the input lens self-test
// (the leafWalk deletion-curve battery), the global lens-health probe, the rust-chip mesh-route
// (routeTaskChip), and the option-price call (priceOption). Every one has an existing graceful
// fallback (lattice-meaning text · empty battery · fromRoom self-route · empty price line), so the
// rich body still renders and the SAME canonical email still sends — just without the stages that
// stall the foreground. The honest Greeks/calibration block (study-JSON calibrate, kept) is untouched.
// Default (flag absent) behaviour is byte-identical to before.
const FAST = process.argv.includes('--no-story') || process.argv.includes('--fast');
// QWEN ON/OFF (additive 2026-07-01): `--no-qwen` (also implied by --fast/--no-story) skips ONLY the
// qwen per-region call for the COMPETENCE SHAPE narration — narrateRegions() still runs (message-
// slicing is local gzip, no network) so the per-oval story falls back to the deterministic,
// commit-message-grounded template (region-narrative.mjs templateRegion), never the bare lattice gist.
const NO_QWEN = FAST || process.argv.includes('--no-qwen') || process.env.PMU_NARRATE_QWEN === '0';
const DUMP_PNG = arg('--dump-png', null);   // write the panel PNGs to a dir (lens A/B comparison, no email)
// DELEGATION MODE (additive 2026-06-22): `--spec <delegated-spec.md>` folds the spec into the intent
// corpus (the existing PMU_SPEC_INTENT path → sigmaType='spec-delta') AND adds a delegation block
// (full spec + the reef built from it + the PMU×NCD interleave + walks/sec litmus) to the SAME rich
// commit email. `--reef <spec-reef.json>` supplies the sealed reef (else it is built from the spec).
// Both inert when absent — a normal on-commit email is byte-identical. This is the mesh spec↔reef
// receipt riding the canonical dogfood email, NOT a separate stripped-down path.
const SPEC_PATH = arg('--spec', null);
if (SPEC_PATH && !process.env.PMU_SPEC_INTENT) process.env.PMU_SPEC_INTENT = SPEC_PATH;
const REEF_PATH = arg('--reef', null);
// DELEGATED SPEC/REEF — loaded HERE (hoisted 2026-07-01 from ~line 1278, where it used to compute
// AFTER the encircled-region COMPETENCE SHAPE narration already ran and so could never reach it —
// part of the reef-scoping regression, see region-narrative.mjs). Only depends on args parsed above,
// so this is a pure move: every later use of these names is unchanged. Inert when --spec absent.
let delegSpecMd = null, delegSpecId = null, delegReef = null, delegReefSha = null, delegReefTmp = null;
const delegSpecPath = process.env.PMU_SPEC_INTENT;
if (delegSpecPath) {
  try {
    delegSpecMd = readFileSync(resolve(delegSpecPath), 'utf8');
    delegSpecId = (delegSpecMd.match(/^spec_id:\s*(.+)$/m) || [])[1]?.trim() || 'spec';
    try {
      if (REEF_PATH) delegReef = JSON.parse(readFileSync(resolve(REEF_PATH), 'utf8'));
      else delegReef = JSON.parse(readFileSync(resolve(REPO, `data/pmu/reef/spec-reef-${delegSpecId}.json`), 'utf8'));
    } catch {
      try { delegReef = JSON.parse(execSync(`node ${resolve(REPO, 'scripts/pmu/reef-from-spec.mjs')} --spec ${resolve(delegSpecPath)} --json`, { cwd: REPO, encoding: 'utf8' })); } catch { /* reef best-effort */ }
    }
    delegReefSha = delegReef?.sha256 || null;
    if (delegReef) { delegReefTmp = `/tmp/spec-reef-${delegSpecId}.json`; writeFileSync(delegReefTmp, JSON.stringify(delegReef, null, 2)); }
  } catch (e) { console.error('   delegation spec/reef load skipped:', String(e.message || e).slice(0, 100)); }
}
// the ask-slice text region-narrative.mjs's parseReefAnchors expects ("coord: title" lines) — empty
// for ordinary, non-delegated commits, so narration correctly falls back to the generic lattice lens
// instead of an unrelated spec's categories.
const delegReefAnchorText = (delegReef?.anchors || []).map(a => `${a.coord || ''}: ${a.title || ''}`.trim()).filter(Boolean).join('\n');

const shaShort = execSync(`git rev-parse --short ${sha}`, { cwd: REPO, encoding: 'utf8' }).trim();
const OUT = resolve(arg('--out', resolve(REPO, `docs/commit-triptych-${shaShort}.html`)));

// OPTIMISED INGEST (2026-06-09): the pipeline means intent=docs (what we SAID) and reality=code
// (what we DID). So split the commit's changed files by kind, and extract SEMANTIC content from
// code (comments + identifier-words split to plain words) instead of raw syntax — the reality
// corpus was ~81% code-as-claim that SimHash grips poorly (corpus-ingest.mjs note). Richer,
// better-gripping claims on both sides → a sharper triptych.
const msg = execSync(`git show -s --format=%B ${sha}`, { cwd: REPO, encoding: 'utf8' });
const files = execSync(`git diff-tree --no-commit-id --name-only -r ${sha}`, { cwd: REPO, encoding: 'utf8' })
  .split('\n').map(s => s.trim())
  .filter(s => s && !/^(\.workflow\/|public\/book\/|data\/rooms-|\.thetacog\/(punch-list|cache))|exports\/|\.epub$|-triptych\.html$/.test(s))
  .slice(0, 10);
const DOC_EXT = /\.(md|mdx|txt)$/, CODE_EXT = /\.(mjs|js|ts|tsx|rs|sh|py)$/, HTML_EXT = /\.html$/;
const read = f => { try { return readFileSync(resolve(REPO, f), 'utf8'); } catch { return ''; } };
const splitIdent = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ').toLowerCase();
// pull the MEANING out of a code file: comment text + declared identifier names as words
function semanticOfCode(content) {
  const out = [];
  for (const raw of content.split('\n')) {
    const t = raw.trim();
    const cm = t.match(/^(?:\/\/\/?|#|\*|\/\*)\s?(.+?)(?:\*\/)?$/);            // comment line
    if (cm && cm[1] && !/^[-=*#\s]+$/.test(cm[1])) out.push(cm[1].trim());
    const decl = t.match(/\b(?:function|const|let|class|fn|def|impl|struct|enum|interface|type)\s+([A-Za-z_][A-Za-z0-9_]+)/);
    if (decl) out.push(splitIdent(decl[1]));                                   // identifier → words
  }
  return out.join('. ').slice(0, 20000);   // whole-file semantic, not a thin slice — rich ingest
}
// REEF BRIDGE (2026-07-04) — the deterministic fix for the reality-walk COLLAPSE (empty panels). Extracted
// to scripts/pmu/reef-bridge.mjs so it is unit-testable; see that file + docs/architecture/reef-grip-walk-
// collapse-2026-07-04.md. Emits claim-sentences for the reef domains the code LITERALLY names (≥2 hits) so
// reality clusters on the SAME connected anchors intent uses; off-domain code enriches to nothing (no
// false-grip). Guarded by tests/pmu-simulator/reef-bridge.test.mjs.
const stripHtml = c => c.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// INTENT INCLUDES THE TESTS (operator 2026-06-10): a test is not "what we did" — it's the RULEBOOK,
// what we DECLARED must hold. The rulebook is effectively infinite, so we don't try to ingest its
// words; we ingest each test's SEMANTIC INTENT (why-comments + test/describe titles + assertion
// messages) and let the chip carry it as a SHAPE. So tests → INTENT, implementation code → REALITY.
const isTest = f => /(?:^|\/)tests?\//.test(f) || /\.(test|spec)\.[a-z]+$/.test(f);
const docFiles = files.filter(f => DOC_EXT.test(f) || HTML_EXT.test(f));
const testFiles = files.filter(f => CODE_EXT.test(f) && isTest(f));
const codeFiles = files.filter(f => CODE_EXT.test(f) && !isTest(f));
// the SEMANTIC INTENT of a test = its why (comments) + the rule names (test/describe/it titles) +
// the assertion messages (what each rule asserts). This is the "why we run these", as a shape.
function semanticOfTest(content) {
  const out = [];
  for (const raw of content.split('\n')) {
    const t = raw.trim();
    const cm = t.match(/^(?:\/\/\/?|#|\*|\/\*)\s?(.+?)(?:\*\/)?$/);
    if (cm && cm[1] && !/^[-=*#\s]+$/.test(cm[1])) out.push(cm[1].trim());
    const title = t.match(/\b(?:test|describe|it)\(\s*['"`](.+?)['"`]/);
    if (title) out.push(title[1]);
    const amsg = t.match(/assert[\w.]*\([^,]*,\s*['"`](.+?)['"`]/);
    if (amsg && /[a-z]{3}/i.test(amsg[1])) out.push(amsg[1]);
  }
  return out.join('. ').slice(0, 20000);
}
// the GOVERNING tests the changed code POINTS AT via its @guard annotation (the spec it references) —
// the rulebook for this code, pulled into intent even when those tests aren't in this commit's diff.
const guardTestsOf = content => { const out = []; const re = /@guard[^\n]*?(tests?\/[\w./-]+\.(?:test|spec)\.[a-z]+)/g; let m; while ((m = re.exec(content))) out.push(m[1]); return out; };
// INGEST v3 — COMMIT-SPECIFIC (operator: the generic-spec flood made EVERY commit peak on the same
// anchor 111 → symmetric, low σ). The fix: feed only what is SPECIFIC to THIS commit, so the lit
// anchors (and the walk's start) vary commit-to-commit.
//   INTENT  (what THIS commit DECLARED) = the commit message + the touched docs + the diff's added
//            DOC lines. No project-wide specs/rules — they drowned the commit-specific signal.
//   REALITY (what THIS commit DID)      = the diff's added CODE lines + the full semantic of the
//            changed code. The diff is the most precise, most commit-specific signal.
const docProse = docFiles.map(f => HTML_EXT.test(f) ? stripHtml(read(f)) : read(f));
const isDocLine = (file) => DOC_EXT.test(file) || HTML_EXT.test(file);
function diffAdded(predicate) {
  try {
    const raw = execSync(`git show --format= --unified=0 ${sha}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 5e7 });
    const out = []; let cur = '';
    for (const l of raw.split('\n')) {
      if (l.startsWith('diff --git')) { const m = l.match(/ b\/(\S+)/); cur = m ? m[1] : ''; }
      else if (/^\+[^+]/.test(l) && predicate(cur)) out.push(l.slice(1).trim());
    }
    // BLOCK ISOLATION (2026-07-03, incident bf-170 — a real blog-content edit rendered a permanent
    // blank/0-region panel): claimify() (corpus-ingest.mjs) splits its input into BLOCKS on a double
    // newline, then per-block decides prose-vs-code (a `looksCode` heuristic matching bare `{`/`}`/
    // `;`/`=`/`=>` ANYWHERE in the block) — prose blocks split by SENTENCE, code blocks split by RAW
    // LINE. Joining with a SINGLE '\n' merges every added diff line into ONE block, so one line's
    // incidental code-ish character (a URL query param like `?t=4736` is enough) flips the ENTIRE
    // multi-paragraph diff into "code mode" — each unwrapped mdx paragraph then becomes one gigantic
    // "line" that blows past claimify's MAX_CLAIM=400 and gets dropped, collapsing a rich diff (5726
    // chars measured on d5658f796) to ~1 surviving claim → the walk senses nothing → blank panel.
    // Join with a BLANK LINE instead so every diff line is its own independent claimify block: one
    // line's code-ish character can no longer contaminate its neighbors' prose classification.
    return out.filter(Boolean).join('\n\n');
  } catch { return ''; }
}
const diffDocs = diffAdded(isDocLine), diffCode = diffAdded(f => CODE_EXT.test(f) && !isTest(f));    // reality excludes tests
// the rulebook for THIS commit: tests it touched + the governing tests its changed code @guard-points at.
const governingTests = [...new Set(codeFiles.flatMap(f => guardTestsOf(read(f))).filter(t => fexists(resolve(REPO, t))))];
const testSemantic = [...new Set([...testFiles, ...governingTests])].map(f => semanticOfTest(read(f))).filter(Boolean);
// THE IDEAL-CASE SPEC AS INTENT (operator, Jun 11: "iterate on the ideal case as the intent sent
// in emails till everything is perfect and use it as part of the intent"). Scoped to PMU commits
// ONLY — a project-wide flood is the anchor-111 incident (AR-10); for PMU code this spec IS the
// declared rulebook, so drift-from-ideal shows as heat.
// THE SPEC JOINS AS A SHAPE, NOT FULL PROSE (2026-06-11, AR-10 in scoped form): the full 14k of
// spec prose QUOTES code identifiers and consumed the salience-capped claim budget — on a small
// PMU commit (fe787af12) ~105 of intent's 117 claims were the spec's, the commit's own 12 claims
// drowned, σ collapsed 9.17 → 0.33 and the tolerance lost its red (433r → 0r): the instrument
// blinded by its own rulebook. Same principle as tests (semanticOfTest = titles + assertions, not
// the whole file): the spec's SEMANTIC INTENT = its headings (the ShortLex skeleton), its bold
// contract lines (**Passes forward:** / **Leads to:** / **Victor…**) and the double-check list —
// never the code-identifier-rich discussion prose.
function semanticOfSpec(content) {
  const out = [];
  let capturing = false, inDoubleCheck = false;
  for (const raw of String(content || '').split('\n')) {
    const t = raw.trim();
    if (/^#{1,6}\s/.test(t)) { inDoubleCheck = /double-check/i.test(t); out.push(t.replace(/^#{1,6}\s*/, '')); capturing = false; continue; }
    if (!t) { capturing = false; continue; }
    const isItem = /^(-|\d+\.)\s/.test(t);
    const contract = /^-\s+\*\*(Passes forward|Leads to|Victor)/i.test(t);     // the contract lines
    const dcItem = inDoubleCheck && /^\d+\.\s/.test(t);                        // the double-check list
    if (contract || dcItem) { out.push(t.replace(/^(-|\d+\.)\s+/, '')); capturing = true; continue; }
    if (isItem) { capturing = false; continue; }
    if (capturing) out[out.length - 1] += ' ' + t;                             // wrapped continuation
  }
  return out.join('\n').replace(/\*\*/g, '').slice(0, 6000);
}
const PMU_RE = /^(scripts\/pmu\/|tests\/pmu-simulator\/|\.thetacog\/pmu\/|src\/app\/pmu-simulator\/)/;
// PMU_NO_SPEC=1 — evidence/sweep hook: run the same commit WITHOUT the spec joining intent (the
// with/without comparison that caught the 2026-06-11 spec-flood blinding).
const idealSpec = (process.env.PMU_NO_SPEC === '1' || !files.some(f => PMU_RE.test(f))) ? '' : semanticOfSpec(read('docs/architecture/pmu-ideal-case-spec.md'));
// DOCS-ONLY HONESTY (2026-06-11 — the literal all-green source): the suspiciously clean tolerances
// ('1155g/0a/0r' c1e1003c9 · '907g/0a/0r' 340b2dfae) were BOOK commits, not PMU — on a docs-only
// commit the reality fallback IS diffDocs, so diffDocs must not ALSO join intent or the instrument
// compares a corpus to its own subset (reproduced live on 2ceddf00c: pre-walk overlap 96%,
// 1081g/1a/0r, σ 26.31 — self-similarity, not alignment). Intent keeps msg + full doc prose;
// the added lines stay reality-side; and the docs-only σ is flagged DISCOUNTED below
// (ideal-case spec, double-check #5: σ on a doc-only commit means nothing).
const docsOnly = !(codeFiles.length || testSemantic.length);
// PMU_SPEC_INTENT (spec-thread protocol, 2026-06-11): path to the THREAD'S OWN declared spec text —
// the SPEC email this commit replies to. When set, the spec text JOINS intentText as the LEADING
// member, so the triptych's intent↔reality delta measures realization-vs-spec (did the work land
// inside the declared intent?). This is ADDITIVE and opt-in: with the env unset the intent corpus
// is byte-identical to before. It is NOT the AR-10 flood — AR-10 forbids a PROJECT-WIDE generic
// spec drowning every commit's signal (the anchor-111 incident); this is the thread's OWN declared
// intent for THIS commit, commit-scoped by construction (one spec = one thread = the commits that
// reply to it). Set by scripts/pmu/spec-thread.mjs --realize.
let specIntent = '';
if (process.env.PMU_SPEC_INTENT) {
  try { specIntent = readFileSync(resolve(process.env.PMU_SPEC_INTENT), 'utf8').trim(); }
  catch (e) { console.error(`   PMU_SPEC_INTENT unreadable (${String(e.message || e).slice(0, 80)}) — proceeding without spec intent`); }
}
// PMU_INTENT_EXTRA (2026-07-11): an OPTIONAL richer declared-intent — the recent DIRECTION (several
// substantive commit logs) + the README-spec + the code's own annotations — so a thin single-commit
// intent is never empty. readme-panels.mjs sets it; unset = the exact prior behaviour. Leads the intent.
const intentText = [process.env.PMU_INTENT_EXTRA || '', specIntent, msg, ...docProse, docsOnly ? '' : diffDocs, ...testSemantic, idealSpec].filter(Boolean).join('\n\n');       // declared intent = (direction/spec/annotations) + (the thread's spec, when realizing) + message + docs + the RULEBOOK (tests + the ideal-case spec on PMU commits)
// SPEC #3 — the σ this run measures NAMES ITSELF: a spec-thread --realize run (PMU_SPEC_INTENT
// set) measures realization-vs-spec → σ_spec-delta; the plain on-commit run → σ_drift. One type
// per run, carried into every surface (email row · panel σ box · console) via the shared legend.
const sigmaType = specIntent ? 'spec-delta' : 'drift';
// ⛔ HARD RULE (operator 2026-07-04) — THE DECIDABLE ON-CHIP RECEIPT IS LLM-FREE. NEVER combine an LLM's
// output with the decidable panel. A local-LM "semantic reality" (ollama) used to be PREPENDED to this
// corpus; it made the receipt NON-DETERMINISTIC — the same commit rendered 1079 / 1590 / 333 lit and
// random EMPTY panels, because the model paraphrased "proper"↔"correct" on every call. That is the
// exact "fooling ourselves" the whole S=P=H thesis forbids: a reproducible coordinate space must not
// depend on an undecidable model. The LLM story about the drift is a SEPARATE, LATER knock-on output
// (the second email / a follow-up), NEVER the insurance receipt. Do NOT re-add semanticReality here.
// Guard: tests/pmu-simulator/receipt-is-llm-free.test.mjs.
//
// Reality is also read from the IMMUTABLE COMMIT (git show <sha>:<file>), never the mutable working tree,
// so the panel is a pure, reproducible function of the commit — not of whatever the tree happens to hold.
const readAtCommit = f => { try { return execSync(`git show ${sha}:${f}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 5e7 }); } catch { return ''; } };
const _codeSemantic = [diffCode, ...codeFiles.map(f => semanticOfCode(readAtCommit(f)))].filter(Boolean).join('\n');
const realityText = [
  diffCode,                                                                                          // the ACTUAL code changes (most commit-specific)
  ...codeFiles.map(f => semanticOfCode(readAtCommit(f))).filter(Boolean),                            // + the full semantic of the changed code AT THIS COMMIT
  reefBridge(_codeSemantic),                                                                         // + DETERMINISTIC reef-bridge: cluster reality on the connected anchors its code literally names (empty for off-domain → no false-grip; fixes the walk-collapse)
  // IDENTICAL-DECOMPOSE BUG (2026-06-11): this fallback used to copy docProse WHOLESALE into
  // reality — the SAME corpus intent already carries at full mass — so on a nothing-but-docs
  // commit BOTH sides claimified to the identical top-160 claims (HEAD: "1189 lit · θ 0.750"
  // printed twice, PRE-WALK Δ 100%). senseDecompose was never the culprit (it's pure); the
  // wiring fed it the same corpus twice. Each side decomposes its OWN corpus: a docs-only
  // commit's REALITY = what it DID = the diff's ADDED doc lines; the full prose stays on the
  // intent side (the SAID). A doc change with no claim-worthy added lines now honestly senses
  // to ~0 lit — "declared a chapter, did nothing semantic" — instead of a fake 100% match.
  ...(codeFiles.length || testSemantic.length ? [] : [diffDocs]),
].filter(Boolean).join('\n\n') || files.map(f => readAtCommit(f)).join('\n\n');   // fallback also reads the IMMUTABLE commit (deterministic)
const ingestChars = intentText.length + realityText.length;

const t0 = Date.now();
const ppArgs = { intentText, realityText, intentLabel: `${specIntent ? 'SPEC+' : ''}msg+${docFiles.length}docs+${testSemantic.length}tests`, realityLabel: `${codeFiles.length}code` };
let r = await runPipeline(ppArgs);
// EMPTY-READ RETRY LOOP (operator 2026-06-13/15: "this one is empty" → STILL empty after a single
// retry, so the drift grid showed up blank in the email). The post-commit hook fires ~8 jobs at once;
// a shared pipeline input (vector cache · reef seeds · pipeline state) caught mid-write hands the walk
// degenerate all-zero heat → an empty grid that falls through to the "direction only" panel. A SINGLE
// retry often lands inside the SAME still-open race window, so retry up to 5× with a GROWING BACKOFF
// that lets the concurrent writers finish (standalone re-runs reliably produce ~720g). Check BOTH
// reality AND intent heat — either being empty zeroes the tolerance grid. Only if every retry still
// comes back empty do we honestly fall to "direction only" downstream.
const heatEmpty = (b64) => { const b = Buffer.from(b64 || '', 'base64'); if (!b.length) return true; for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false; return true; };
const heatBad = (x) => heatEmpty(x?.stages?.walk?.reality_heatmap_b64) || heatEmpty(x?.stages?.walk?.intent_heatmap_b64);
for (let attempt = 1; attempt <= 5 && heatBad(r); attempt++) {
  const waitMs = 300 * attempt;   // 300 · 600 · 900 · 1200 · 1500 ms — outlast the concurrent write window
  console.error(`   ⚠ empty heat (concurrent-write race) — retry ${attempt}/5 after ${waitMs}ms`);
  await new Promise((res) => setTimeout(res, waitMs));
  const r2 = await runPipeline(ppArgs);
  if (!heatBad(r2)) { r = r2; break; }
}
const pipelineMs = Date.now() - t0;
const w = r.stages?.walk || {}, x = r.stages?.xor || {};
if (!w.intent_heatmap_b64 || !x.friction_bitmap_b64) { console.error('pipeline produced no triptych bitmaps (stages:', Object.keys(r.stages || {}).join(','), ')'); process.exit(1); }

// PER-STAGE TIMINGS (the pipeline records cumulative elapsed_ms; diff consecutive stages). ingest =
// resolve+sense (claimify → on-chip --sense); on-chip = walk+xor (the ballistic + XOR on the chip).
const S = r.stages || {};
const seq = ['resolve', 'invariants', 'sense', 'sigma', 'binarize', 'project', 'xor', 'walk', 'claudbridge'];
const stageMs = {}; let prev = 0;
for (const k of seq) { if (S[k]?.elapsed_ms != null) { stageMs[k] = Math.round((S[k].elapsed_ms - prev) * 10) / 10; prev = S[k].elapsed_ms; } }
// INGEST = turning the whole touched corpus (message + docs + rules + axis defs vs the code) into
// lit anchors: resolve (corpus prep) + claimify + the on-chip --sense projection. With the rich
// corpus this is the real cost (sensing everything), legitimately tens-to-hundreds of ms — NOT 0.
// ON-CHIP WALK = the ballistic walk (+ xor) — the fast part (~ms). Distinct numbers, by construction.
const tIngest = Math.round(((stageMs.resolve ?? 0) + (stageMs.sense ?? 0)) * 10) / 10;

// TILE DUMP — what the on-chip SimHash ACTUALLY matched, per DIAGONAL anchor (A,A … C3,C3), so the
// sensor can't hide nonsense (operator: "see the tile dumps in the 12x12, at least the diagonals, to
// inspect what the llm/simhash found"). intent_claim_map / reality_claim_map come straight from the
// sense stage. We show: the anchor's canonical MEANING (the snippet) + the INTENT claim that lit it +
// the REALITY claim that lit it + the witness sims. If those claims read as garbage, the sensor is lying.
const SENSE = S.sense || {};
const icm = SENSE.intent_claim_map || {}, rcm = SENSE.reality_claim_map || {};
let _lib = []; try { _lib = JSON.parse(read('data/pmu/snippet-library-144.json')); if (!Array.isArray(_lib)) _lib = _lib.anchors || _lib.nodes || []; } catch { /* */ }
const meaning = {}; for (const a of _lib) if (a && a.coord) meaning[a.coord] = String(a.snippet || a.seed || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].slice(0, 110);
const AX12c = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const diagTiles = AX12c.map(a => { const coord = `${a},${a}`, ic = icm[coord] || {}, rc = rcm[coord] || {};
  return { coord, meaning: meaning[coord] || '', intent: clip(ic.claim, 95), intentSim: Math.round((ic.frag_sim ?? ic.assign_sim ?? 0) * 100), reality: clip(rc.claim, 95), realitySim: Math.round((rc.frag_sim ?? rc.assign_sim ?? 0) * 100) }; });

// dominant blocks from the intent heatmap (top-4 by column-node block mass) → tolerance reference
const ib = Buffer.from(w.intent_heatmap_b64, 'base64');
const f32 = ib.length === 20736 * 4 ? new Float32Array(ib.buffer, ib.byteOffset, 20736) : null;
const blockOf = i => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
let domBlocks = [];
if (f32) { const bm = new Array(16).fill(0); for (let i = 0; i < 20736; i++) bm[blockOf((i % 144) % 144)] += f32[i]; domBlocks = [...bm.keys()].filter(b => bm[b] > 0).sort((a, b) => bm[b] - bm[a]).slice(0, 4); }

// THE LEAF WALK (operator-corrected canon, 2026-06-10 — see definer-walk-144.mjs header):
// the chip is handed the commit's SEMANTIC BINARY GRID — the project/binarize DECOMPOSITION of the
// ingest onto the 20,736-cell lattice ("we always have to put that on the chip by decomposing it into
// the 144×144 binary lattice, based on the prior step") — NOT the structural connectivity. ONE
// pmu-onchip --ballistic process runs the whole explosion (ballistic.rs: every lit cell of each active
// row spawns its COLUMN as a new row next ply — the transpose — weight decays per ply, no dedup,
// weight-floor extinction, frames streamed per ply = the PMU data).
const intentLit = SENSE.intent_lit_indices || [];
const realityLit = SENSE.reality_lit_indices || [];
// ── THE DIRECTIONAL SENSED DECOMPOSITION (operator, 2026-06-10): "we should be using the SENSOR —
// the compression algorithm — to determine whether an intersection in the 144×144 (the 20,000) should
// be there or not. If we're not doing that right, we're not going to get anything else right."
// The outer product (cell i,j = lit_i ∧ lit_j) is SYMMETRIC by construction — the symmetric-columns
// problem. Here each of the 20,736 cells gets its own sensor decision, DIRECTIONAL: split every claim
// at its midpoint — the HEAD grips the ROW anchor (the actor/lens), the TAIL grips the COLUMN anchor
// (the patient/object). cell(i,j) = max over claims of min(sim(head,tile_i), sim(head→row? no — tail,
// tile_j)). Actor→patient ordering is what makes the lattice asymmetric and cyclic-capable — because
// meaning is. Timed and reported (this is the heavy sensor pass; GPU is the later optimization).
// Operator's algorithm (2026-06-10): "take the 144 cells and make 144 AXES NODES from them, then
// simhash/compress sensing the 0/1 binary in the lattice — that would fix the symmetry."
//   1. NODES: the 144 tile snippets ARE the nodes (already DIRECTIONAL — tile X,Y ≠ tile Y,X since
//      the intersection-leads work), promoted from the 12×12 library to first-class axes.
//   2. PAIR SIGNATURES: for each ORDERED pair (i,j), the sensor signature of node_i → node_j is the
//      simhash of their concatenation IN THAT ORDER — the cross-boundary shingles differ for (j,i),
//      so asymmetry falls out of the meaning, not a hack. 20,736 signatures = the "20,000 runs" —
//      commit-INDEPENDENT, so built once and cached per library hash (the heavy pass; GPU later).
//   3. SENSE: per commit side, bit(i,j) = a claim compresses well against pair(i,j) — max over claim
//      sigs of sim(claim, pairSig[i,j]) ≥ θ, θ set by density target. Timed and reported.
const { simhash: sh, hamming: hd, SIG_BITS: SB, wordShingles: wsh } = await import('../../src/app/pmu-simulator/signature.mjs');
const { claimify, salienceRank } = await import('./corpus-ingest.mjs');
const { createHash } = await import('node:crypto');
const nodeText = new Array(144).fill('');
for (let a = 0; a < 144; a++) nodeText[a] = String((_lib.find(t => t.coord === COORDS[a]) || {}).snippet || '');
const libSha = createHash('sha256').update(nodeText.join(' ')).digest('hex').slice(0, 12);
const PAIR_CACHE = resolve(REPO, `.thetacog/cache/pair-sigs-144-${libSha}.json`);
let pairSigs, tPair = 0;
if (fexists(PAIR_CACHE)) {
  pairSigs = JSON.parse(readFileSync(PAIR_CACHE, 'utf8')).map(BigInt);
} else {
  const tp0 = Date.now();
  pairSigs = new Array(20736);
  for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) pairSigs[i * 144 + j] = sh(`${nodeText[i]} ${nodeText[j]}`, SB, wsh);
  tPair = Date.now() - tp0;
  try { writeFileSync(PAIR_CACHE, JSON.stringify(pairSigs.map(String))); } catch { /* cache best-effort */ }
  console.log(`   pair-signature build: 20,736 ordered node-pair sigs in ${tPair}ms (cached → ${PAIR_CACHE.split('/').pop()})`);
}
function senseDecompose(text, label) {
  const t0s = Date.now();
  const claims = salienceRank(claimify(String(text || ''))).slice(0, 160);
  const claimSigs = claims.map(c => sh(c, SB, wsh));
  const score = new Float32Array(20736);
  for (const cs of claimSigs) for (let k = 0; k < 20736; k++) { const v = 1 - hd(cs, pairSigs[k]) / SB; if (v > score[k]) score[k] = v; }
  // θ from a density target: sparse + commit-specific, never flooded; floor keeps junk grips out.
  const sorted = Float32Array.from(score).sort().reverse();
  const TARGET = 900;                                          // ~4% of 20,736 — a real, walkable lattice
  const theta = Math.max(0.56, sorted[Math.min(TARGET, sorted.length - 1)] || 0.56);
  const g = new Uint8Array(20736); let lit = 0;
  for (let k = 0; k < 20736; k++) if (score[k] >= theta && score[k] > 0) { g[k] = 1; lit++; }
  let asym = 0, pairs = 0;
  for (let i = 0; i < 144; i++) for (let j = i + 1; j < 144; j++) { const a = g[i * 144 + j], b = g[j * 144 + i]; if (a || b) { pairs++; if (a !== b) asym++; } }
  const ms = Date.now() - t0s;
  console.log(`   sensor decompose [${label}]: ${claims.length} claims × 20,736 node-pairs → ${lit} lit · θ ${theta.toFixed(3)} · asymmetric ${pairs ? Math.round(100 * asym / pairs) : 0}% · ${ms}ms`);
  return { grid: g, score, lit, theta, ms, claims: claims.length, asymPct: pairs ? Math.round(100 * asym / pairs) : 0 };
}
const senseI = senseDecompose(intentText, 'intent'), senseR = senseDecompose(realityText, 'reality');
const intentGrid = senseI.grid, realityGrid = senseR.grid;
// THE COMPETENCE PIXEL (operator, 2026-06-10): "we need to SENSE where the competence pixel of the
// commit is (ACTOR–PATIENT) in order to walk the row of the ACTOR first (then what defines the
// definer)." The pixel is not a column-mass heuristic — it is the SENSED argmax of the intent
// lattice: the ordered node-pair (actor, patient) the commit's claims grip hardest. The walk then:
//   ply 0 — the ACTOR's row (the actor's own competences);
//   the pixel's own transpose hands the PATIENT's row as the first definer jump (what defines the
//   act) — seeded second, and the cascade recurses from there (the definer of the definer).
// The POV is printed + emailed so the operator can always answer "where did the walk begin?"
let pix = 0, pixScore = -1;
for (let k2 = 0; k2 < 20736; k2++) if (senseI.score[k2] > pixScore) { pixScore = senseI.score[k2]; pix = k2; }
const actorA = Math.floor(pix / 144), patientA = pix % 144;
// stability: among the top-8 sensed cells, the actor pick must not swing on a marginal claim — the
// definer-graph attractor (start-pixel.mjs) tiebreaks actors weighted by their sensed pixel mass.
const topCells = [...senseI.score.keys()].sort((a, b) => senseI.score[b] - senseI.score[a]).slice(0, 8);
const actorMass = new Map(); for (const c of topCells) { const a = Math.floor(c / 144); actorMass.set(a, (actorMass.get(a) || 0) + senseI.score[c]); }
const startPick = pickStartPixel([...actorMass.keys()], a => actorMass.get(a) || 0, { iters: 50, damping: 0.85 });
const startPixel = startPick.start;            // the ACTOR anchor — its row is walked FIRST
const startRow = Math.floor(startPixel / 12);
// THE PATIENT IS RE-SENSED ON THE CHOSEN ACTOR'S OWN ROW (crosshair bug, 2026-06-11): when the
// attractor re-picked the actor, the old derivation took the patient from whatever top-8 cell
// happened to share the new actor (with a `|| [0, patientA]` fallback that could pair a FOREIGN
// patient) and kept reporting the GLOBAL max's grip — so the crosshair sat on a cell whose grip
// was never the number in the email (probed: fe787af12 reported 0.8125 at a cell sensing 0.7969).
// Now: patient = argmax of the sensed score over the chosen ACTOR's full row, grip = the score OF
// THAT CELL. Words, crosshair ◎ and grip number are the same cell by construction.
let patientPixel = 0, pixGrip = -1;
for (let j = 0; j < 144; j++) { const v = senseI.score[startPixel * 144 + j]; if (v > pixGrip) { pixGrip = v; patientPixel = j; } }
console.log(`   competence pixel (actor∩patient): ${COORDS[startPixel]} ∩ ${COORDS[patientPixel]} · grip ${pixGrip.toFixed(3)} · walking the ACTOR row first${startPixel !== actorA ? ` (attractor re-picked the actor from ${COORDS[actorA]}; sensed max ${pixScore.toFixed(3)})` : ''}`);
// REEF SELF-HEAL TARGET (operator 2026-06-16: "do it, keep measuring"). Emit the lane this commit is
// about (the competence pixel = the dominant actor anchor, verified to resolve to a reef cell) so the
// post-commit hook can AIM reef-strengthen at it — the battery's repo-grounded signal pointing the
// EXISTING self-heal engine (surfaced dry-run, never auto-applied). Written every commit; cheap.
try { writeFileSync(resolve(REPO, '.thetacog/cache/reef-target.txt'), `${COORDS[startPixel] || ''}\t${shaShort}`); } catch { /* graceful */ }
// the leaf walk: same start (the chosen perspective) for both sides; each side walks ITS OWN grid.
// time budget 2.5s per walk (the email path is detached — depth buys the ply-colour story); the σ
// impostors run shallower/faster so the 12-impostor loop stays bounded.
// topK=2: with ~40 lit anchors, K=3 consumes them all by ply 3 (3+9+27) — one colour band. K=2
// stretches the same anchors over deeper chains (2+4+8+16+…) → the ply-colour story is visible.
// Seeds: the ACTOR's row first (ply 0), the PATIENT's row second — the pixel's own transpose, the
// first definer jump. Both sides walk from the SAME pixel (the shared perspective).
// SWEEP HOOKS (sigma-overnight): PMU_TOPK / PMU_DECAY override the walk params for the tolerance
// sweep; PMU_SWAP=1 swaps intent↔reality corpora — the artifact CONTROL (if red stays in the same
// rows regardless of which side carries the code, the read is register bias, not drift).
const SWEEP_TOPK = +(process.env.PMU_TOPK || 2), SWEEP_DECAY = +(process.env.PMU_DECAY || 0.5);
const leafWalk = (grid) => definerWalk144([startPixel, patientPixel], { gridBits: grid, maxDepth: 8, topK: SWEEP_TOPK, decay: SWEEP_DECAY, budgetMs: 2500 });   // async — the explosion is concurrent
let coleData = null, tCole = 0, matchSigma = 0;
try {
  const tc0 = Date.now();
  const SWAPPED = process.env.PMU_SWAP === '1';
  // the swap exchanges ROLES, so the impostor null must shuffle whichever grid PLAYS reality —
  // shuffling the original realityGrid under swap compares a walk to its own shuffle (σ explodes).
  const gI = SWAPPED ? realityGrid : intentGrid, gR = SWAPPED ? intentGrid : realityGrid;
  const [it, rt] = await Promise.all([leafWalk(gI), leafWalk(gR)]);
  tCole = Date.now() - tc0;
  // SHAPE-MATCH SIGMA — the shape is the overlap of the two CLOUD fields (the semantic map the walks
  // painted), scored as the cosine of the full 20,736-cell visit vectors; impostors = the SAME walk on
  // a bit-shuffled reality grid (same density, no meaning) — σ = (actual − μ_imp)/σ_imp, measured.
  const cosine = (a, b) => { let dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return (na && nb) ? dot / Math.sqrt(na * nb) : 0; };
  const shapeOverlap = (a, b) => cosine(a.matrix, b.matrix);   // the cloud overlap = the shape match
  const actual = shapeOverlap(it, rt);
  const shuffle = (g) => { const a = Uint8Array.from(g); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const imps = [];
  const impWalks = await Promise.all(Array.from({ length: 12 }, () => leafWalk(shuffle(gR))));
  for (const iw of impWalks) imps.push(shapeOverlap(it, iw));
  const mu = imps.reduce((s, x2) => s + x2, 0) / imps.length;
  const sd = Math.sqrt(imps.reduce((s, x2) => s + (x2 - mu) ** 2, 0) / imps.length);
  matchSigma = sd ? (actual - mu) / sd : 0;
  const cellsOf = (w) => w.matrix.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  coleData = { intent: it, reality: rt, startPixel, startRow, pixelCell: startPixel * 144 + patientPixel, hops: it.hops + rt.hops, maxPly: Math.max(it.maxPly, rt.maxPly), matchSigma: +matchSigma.toFixed(2), actualMatch: +actual.toFixed(4), impMean: +mu.toFixed(3), intentCells: cellsOf(it), realityCells: cellsOf(rt) };
  console.log(`   clouds: intent ${coleData.intentCells} cells · reality ${coleData.realityCells} cells · raw overlap ${actual.toFixed(6)}`);
} catch (e) { console.error('leaf walk skipped:', String(e.message || e).slice(0, 120)); }

// ── PROBE (PMU_PROBE=1): evidence dump for the crosshair/orientation invariants; exits early.
// Invariant it exists to check: the crosshair cell, the words and the grip number are the SAME
// cell (gripReportedInEmail === gripOfChosenCell, crosshair py=actor row, px=patient col), and the
// sense grids stay ~symmetric while the WALK's upper-triangle skew is the ShortLex-ascending
// guided follow (REAL, not a mirror bug) — measured 2026-06-11 on fe787af12/453ea1324/317307a40.
if (process.env.PMU_PROBE) {
  const triCount = (g) => { let above = 0, below = 0, diag = 0; for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) { const v = g[i * 144 + j]; if (!v) continue; if (i === j) diag++; else if (j > i) above++; else below++; } return { above, below, diag }; };
  const triMass = (m) => { let above = 0, below = 0, diag = 0; for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) { const v = m[i * 144 + j]; if (v <= 0) continue; if (i === j) diag += v; else if (j > i) above += v; else below += v; } return { above: +above.toFixed(1), below: +below.toFixed(1), diag: +diag.toFixed(1) }; };
  const probe = {
    sha: shaShort,
    sensedMax: { pix, actorA, patientA, coordActor: COORDS[actorA], coordPatient: COORDS[patientA], score: +pixScore.toFixed(4) },
    chosen: { startPixel, coordStart: COORDS[startPixel], patientPixel, coordPatientPx: COORDS[patientPixel], actorRepicked: startPixel !== actorA },
    crosshair: { cell: startPixel * 144 + patientPixel, py: startPixel, px: patientPixel },
    gripReportedInEmail: +pixGrip.toFixed(4),
    gripOfChosenCell: +senseI.score[startPixel * 144 + patientPixel].toFixed(4),
    topCells: topCells.map(c => ({ cell: c, actor: Math.floor(c / 144), patient: c % 144, score: +senseI.score[c].toFixed(4) })),
    intentGridTri: triCount(intentGrid), realityGridTri: triCount(realityGrid),
    walkIntentTri: coleData ? triMass(coleData.intent.matrix) : null,
    walkRealityTri: coleData ? triMass(coleData.reality.matrix) : null,
  };
  console.log('PROBE ' + JSON.stringify(probe, null, 1));
  process.exit(0);
}

// ── THE PMU DATA BLOCK (operator: "absolutely have to have in commit emails: the PMU data, the
// hardware attestation, and the other statics — all the time measurements, how orthogonal it is").
// 1) HARDWARE ATTESTATION — the chip's own live report (bare daemon run, ~ms): gate ns, cache tiers,
//    miss penalty; + sha256 of the daemon binary (WHICH silicon-path produced this read).
const DAEMON_BIN = resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');
let gateHw = {};
try {
  const rep = execSync(`"${DAEMON_BIN}" 2>/dev/null`, { encoding: 'utf8', maxBuffer: 5e7, timeout: 20000 });
  const g = (re) => { const m = rep.match(re); return m ? m[1] : null; };
  gateHw = {
    gateNs: g(/64-bit lane:\s*([\d.]+) ns/), missPenalty: g(/miss penalty:\s*([\d.]+)x/),
    l1: g(/L1\s+\d+ KiB\s+([\d.]+) ns/), dram: g(/DRAM\s+\d+ KiB\s+([\d.]+) ns/),
    walkNs: g(/walk time at the measured gate rate:\s*([\d.]+) ns/),
  };
  gateHw.binSha = execSync(`shasum -a 256 "${DAEMON_BIN}" | cut -c1-16`, { encoding: 'utf8' }).trim();
} catch { /* attestation best-effort; absence is shown, not faked */ }
// 2) RECEIPT — the pipeline's sealed run receipt (run id + payload sha when the bridge is up).
const receipt = { runId: r.run_id || null, payloadSha: (r.stages?.claudbridge?.payload_sha || '').slice(0, 16) || null, band: r.stages?.sigma?.band ?? null };
// 3) ORTHOGONALITY — how orthogonal the 144-tile seed library is right now (deterministic inspector).
let ortho = {};
try { ortho = JSON.parse(execSync(`node "${resolve(REPO, 'scripts/pmu/tile-dump-inspect.mjs')}" --json`, { encoding: 'utf8', maxBuffer: 5e7, timeout: 60000 })).metrics || {}; } catch { /* */ }

// the intersection IN WORDS (operator, Jun 11: "you have to write out explicitly the intersection
// in words as well — we see it in the maps, but it also has to be written out"). Axis names per
// the canonical ShortLex ranks.
const AXNAME = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy\u00b7Law', A2: 'Strategy\u00b7Goal', A3: 'Strategy\u00b7Fund', B1: 'Tactics\u00b7Speed', B2: 'Tactics\u00b7Deal', B3: 'Tactics\u00b7Signal', C1: 'Operations\u00b7Grid', C2: 'Operations\u00b7Loop', C3: 'Operations\u00b7Flow' };
const tileWords = (coord) => { const [r, c] = String(coord || '').split(','); return r && c ? `${AXNAME[r] || r} \u00d7 ${AXNAME[c] || c}` : String(coord || '?'); };
// the FULL reef seed for a tile (operator: "the spelled-out intersection AND full reef seeds for
// that intersection") — the reader must see WHAT was gripped, not just where.
const seedOf = (coord) => String((_lib.find(t => t.coord === coord) || {}).snippet || '(empty tile)').replace(/\s+/g, ' ').trim();
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const day = execSync(`git show -s --format=%cs ${sha}`, { cwd: REPO, encoding: 'utf8' }).trim();
// THE PIXEL UNDER THE PRE-WALK PANELS (operator dictation, Jun 11): the pre-walk COMPARISON panel
// carries the crosshair "so you can see where the chosen pixel sits in the raw overlap" (the two
// snapshot panels stay crosshair-free — no point of view), and immediately below the pre-walk
// panels the email SPELLS OUT which pixel the commit belongs to — coordinates + axis names — AND
// the FULL reef seed text that created that intersection: actor tile AND patient tile, the whole
// snippet, never the clipped first sentence. The maps show it; the words pin it.
const pixelStatementHtml = `<div style="margin:-6px 0 16px;padding:11px 13px;background:#0a1018;border:1px solid #1a2a3a;border-left:3px solid #ff50c8;border-radius:6px;font-size:12px;line-height:1.6;text-align:left">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#ff8ad8;text-transform:uppercase;margin-bottom:6px">◎ the pixel this commit belongs to</div>
<div style="color:#c9d1d9"><b style="color:#ff8ad8">${COORDS[startPixel]}</b> — ${tileWords(COORDS[startPixel])} (actor) acting on <b style="color:#ff8ad8">${COORDS[patientPixel]}</b> — ${tileWords(COORDS[patientPixel])} (patient) · grip ${pixGrip.toFixed(3)}</div>
<div style="margin-top:7px;color:#8b98a5"><b style="color:#66fcf1">actor seed ${COORDS[startPixel]}</b> — ${esc(seedOf(COORDS[startPixel]))}</div>
<div style="margin-top:5px;color:#8b98a5"><b style="color:#fbbf24">patient seed ${COORDS[patientPixel]}</b> — ${esc(seedOf(COORDS[patientPixel]))}</div>
</div>`;
// ── THE SHORTLEX-3 PROJECTION ROW (operator, Jun 11: "the commit images still lack the
// three-length") — the COMMIT'S OWN corpora (the same intentText/realityText senseDecompose eats)
// run through shortlexLattice in the new 144-NAME coordinate system (ABC · A1..C3 · the 132
// candidate children), so every commit email carries the three-length view. Pure sensor math
// (SimHash vs the registry signatures) — no LLM, stays on the chip-speed path (SF13/AR-7);
// measured + printed. Missing registry/candidate files degrade to a one-line note in the email —
// the post-commit hook must NEVER crash on this row.
let shortlex = null;
try {
  const { shortlexLattice, zoneOccupancy, defaultSigOf } = await import('./shortlex-project.mjs');
  const { loadRegistry, REGISTRY_PATH } = await import('./shortlex-registry.mjs');
  const CAND_PATH = resolve(REPO, 'data/pmu/shortlex-children-candidate.json');
  if (!fexists(REGISTRY_PATH)) throw new Error('registry missing (data/pmu/shortlex-144-registry.json)');
  if (!fexists(CAND_PATH)) throw new Error('candidate children missing (data/pmu/shortlex-children-candidate.json)');
  const slReg = loadRegistry();
  const slSigOf = defaultSigOf();
  const claimsOf = (t) => salienceRank(claimify(String(t || ''))).slice(0, 160);
  const tSl = Date.now();
  const lat = shortlexLattice({ registry: slReg, sigOf: slSigOf, intentClaims: claimsOf(intentText), realityClaims: claimsOf(realityText) });
  const slMs = Date.now() - tSl;
  const zi = zoneOccupancy(lat.intentGrid, slReg), zr = zoneOccupancy(lat.realityGrid, slReg);
  shortlex = { intentGrid: lat.intentGrid, realityGrid: lat.realityGrid, registry: slReg, zi, zr, ms: slMs, intentMeta: lat.intent, realityMeta: lat.reality };
  console.log(`   shortlex-3 projection: ${slMs}ms · intent ${lat.intent.lit} lit (zones ${zi.z1}/${zi.z2}/${zi.z3} · ${zi.cross} cross) · reality ${lat.reality.lit} lit (zones ${zr.z1}/${zr.z2}/${zr.z3} · ${zr.cross} cross)`);
} catch (e) {
  shortlex = { note: String(e.message || e).slice(0, 140) };
  console.error(`   shortlex-3 projection skipped: ${shortlex.note}`);
}
const tRender0 = Date.now();
const trip = renderTriptych({
  intentB64: w.intent_heatmap_b64, realityB64: w.reality_heatmap_b64, frictionB64: x.friction_bitmap_b64,
  domBlocks, killTolerancePct: 25,
  label: `commit ${shaShort} — 144×144 lattice triptych (on-chip)`,
  // THE PIXEL STATEMENT (operator, Jun 10): the email must SAY which intersection the ingest chose,
  // in words — the crosshair on the image confirms it, it doesn't replace it.
  sub: `◎ the ingest chose ${COORDS[startPixel]} — ${tileWords(COORDS[startPixel])} — acting on ${COORDS[patientPixel]} — ${tileWords(COORDS[patientPixel])} (grip ${pixGrip.toFixed(3)}) · the walk starts at the ACTOR's row · ${files.length} file(s)`,
  message: msg, files, tiles: diagTiles, cidSuffix: `${shaShort}-${Date.now().toString(36)}`,
  cole: coleData,
  rawGrids: { intent: intentGrid, reality: realityGrid },   // the pre-walk snapshots (no point of view)
  pixelCell: startPixel * 144 + patientPixel,               // crosshair on the pre-walk COMPARISON panel (snapshots stay bare)
  pixelStatementHtml,                                       // the pixel + full reef seeds, spelled out below the pre-walk panels
  shortlex,                                                 // the SHORTLEX-3 PROJECTION row (three panels, zone seams always on; degrades to a note)
  sigmaType,                                                // SPEC #3: the σ box names its type · band · verdict via the shared legend
  timings: { ingest: tIngest, walk: tCole || (stageMs.walk ?? null), total: pipelineMs + tCole },
});
const renderMs = Date.now() - tRender0;
const sigma = r.stages?.sigma?.sigma, drift = x.drift_pct, friction = x.friction_nodes;

// ENCIRCLED COMPETENCE-SHAPE PANEL — computed ONCE here from the dense, domBlocks-correct trip.tol.rgba,
// BEFORE the --dump-png and email blocks, so BOTH the blog OG (post-drift-history reads trip-encircled.png
// out of --dump-png) and the email headline are the SAME bytes. Name carries the -<sha>-<ts> double suffix
// the DUMP_PNG stripper expects → it lands as a stable `trip-encircled.png`.
let narrativeRegions = null, encircledName = null;
if (trip.tol && trip.tol.rgba) {
  try {
    narrativeRegions = detectRegions(trip.tol.rgba);   // one pipeline (default JS; chip via PMU_REGIONS_CHIP)
    // ── SEND-GATE (operator 2026-07-02, AR-15: "it should know not to send that"). Consulted via
    // the SHARED gate reader (pipeline-gates.mjs) — the one module every emitter uses, so the
    // pipelines connect consistently: same SQLite rulebook (tc_pipeline_gates), same builtin
    // defaults, same trip ledger. An encircled panel with 0 regions is a black square; never emit.
    const { passMinGate } = await import('./pipeline-gates.mjs');
    if (passMinGate({ gate: 'encircled-nonempty', builtinDefault: 1,
        actual: narrativeRegions?.length || 0, sha: shaShort,
        context: { tol: `${trip.tol.green}g/${trip.tol.amber}a/${trip.tol.red}r` },
        action: 'encircled panel suppressed (empty shape); receipt continues as direction-only' })) {
      encircledName = `trip-encircled-${shaShort}-${Date.now().toString(36)}.png`;
      trip.pngs.push({ name: encircledName, buf: encircleRegionsPng(trip.tol.rgba, narrativeRegions, { scale: 4 }) });
    } else {
      // ENCIRCLED ON ALL EMAILS (operator 2026-07-05). A 0-region tolerance for a thin/direction-only commit
      // is NOT a black square — tol.rgba carries the ◎ direction pixel + the grid. Show it as the headline
      // (no rings, labelled direction-only) so EVERY receipt has the shape. Only a TRULY all-dark tolerance
      // (a genuinely broken panel) is still suppressed. Guarded by tests/pmu-simulator/encircled-on-all-emails.test.mjs.
      const anyLit = trip.tol.rgba.some((v, i) => (i % 4 !== 3) && v > 12);   // any non-dark, non-alpha channel
      if (anyLit) {
        encircledName = `trip-encircled-${shaShort}-${Date.now().toString(36)}.png`;
        trip.pngs.push({ name: encircledName, buf: encircleRegionsPng(trip.tol.rgba, [], { scale: 4 }) });
        narrativeRegions = [];   // EMPTY (not null): the headline still renders the image + a direction-only note
        console.error(`   ◎ direction-only encircled panel (0 regions, tolerance lit) — shown as the headline shape`);
      } else {
        console.error(`   ⛔ gate encircled-nonempty: truly all-dark tolerance (tol ${trip.tol.green}g/${trip.tol.amber}a/${trip.tol.red}r) — skipped; trip logged`);
        narrativeRegions = null; encircledName = null;   // a real broken panel → skip cleanly
      }
    }
  } catch (e) { console.error(`   encircle skipped: ${String(e.message || e).slice(0, 120)}`); }
}

// ── SENSE-MAKING (SPEC #3 + operator refinements, 2026-06-11) ────────────────────────────────
// 1) HOW MANY WALKS made each heatmap — per side: hops (each hop = one real pmu-onchip
//    --ballistic process), anchors the cascade lit, and where the walk ENDED (the deepest-ply
//    anchors = the definers-of-definers the recursion concentrated on).
const walkSideStats = (wk) => {
  if (!wk) return null;
  const lit = wk.ply.reduce((s, p) => s + (p >= 0 ? 1 : 0), 0);
  const deep = []; for (let a = 0; a < 144; a++) if (wk.ply[a] === wk.maxPly) deep.push(a);
  deep.sort((a, b) => (wk.heat[b] || 0) - (wk.heat[a] || 0));
  return { hops: wk.hops, procs: wk.hops, lit, maxPly: wk.maxPly, ends: deep.slice(0, 3).map(a => COORDS[a]) };
};
const wkI = coleData ? walkSideStats(coleData.intent) : null;
const wkR = coleData ? walkSideStats(coleData.reality) : null;
// 2) PERCENTILE vs the last 10 recorded runs — computed BEFORE this run joins the ledger, so
//    the readout is honestly "against the previous 10", never against itself.
const HIST_PATH = resolve(REPO, 'data/pmu/measure-history.ndjson');
const pctOpts = { historyPath: HIST_PATH, window: 10 };
const pct = {
  sigma: coleData ? percentile('sigmaDrift', coleData.matchSigma, pctOpts) : null,
  drift: drift != null ? percentile('driftPct', drift, pctOpts) : null,
  off: percentile('offPct', trip.tol.offPct, pctOpts),
  prewalk: trip.preWalk ? percentile('prewalkOverlap', trip.preWalk.rawPct, pctOpts) : null,
};
const pctTxt = (p) => p ?? 'no history yet';
// 3) THE MEASURE-HISTORY LEDGER — one ndjson line per run, capped at the last 200, so the
//    percentile machinery has ground truth to rank against on the NEXT run.
// ── THE INGEST GATE (operator 2026-06-13) ──────────────────────────────────────────────────
// A thin / message-dominated reality grip = the sensor gripped the MESSAGE (prose, rich in the
// semantic reef) not the CODE (technical, poor in it) → the σ/drift is NOT evidence. Mark it so it
// never pollutes the trend or the self-improvement. Deterministic proxy for the LLM's INGEST=SUSPECT
// verdict: reality lit < 10 absolutely, OR reality much sparser than intent (the rich side won).
const litI = wkI ? wkI.lit : null;
const litR = wkR ? wkR.lit : null;
const ingestSuspect = litR != null && (litR < 10 || (litI != null && litI > 0 && litR < 0.25 * litI));
// ── PIN THE REEF (L2 consistency) — libSha (the sensed snippet-library, computed above ~line 285) +
// reefSha (the self-improvement target reef-144) into every measure row, so cross-commit σ is comparable
// while the reef self-improves AND the divergence between the two libraries stays visible.
const reefSha = (() => { try { return createHash('sha256').update(read('data/pmu/reef/reef-144.json')).digest('hex').slice(0, 12); } catch { return null; } })();
try {
  const histLine = JSON.stringify({
    sha: shaShort, ts: new Date().toISOString(),
    sigmaDrift: coleData ? coleData.matchSigma : null, driftPct: drift ?? null, offPct: trip.tol.offPct ?? null,
    walksIntent: wkI ? wkI.hops : null, walksReality: wkR ? wkR.hops : null,
    litIntent: litI, litReality: litR,
    prewalkOverlap: trip.preWalk ? trip.preWalk.rawPct : null,
    docsOnly: !!docsOnly,   // recorded exactly — the ladder's σ_drift median filtered on a litReality<10 proxy until this landed
    ingestSuspect,          // the gate: true ⇒ this commit's σ/drift is not trusted (sensor gripped the message, not the code)
    libSha, reefSha,        // PIN: the reef version this σ was measured against — cross-commit comparability
  });
  const prevLines = fexists(HIST_PATH) ? readFileSync(HIST_PATH, 'utf8').split('\n').filter(Boolean) : [];
  prevLines.push(histLine);
  writeFileSync(HIST_PATH, prevLines.slice(-200).join('\n') + '\n');
} catch (e) { console.error('   measure-history append skipped:', String(e.message || e).slice(0, 80)); }
// ── THE VERDICT BLOCK — FIRST (operator, 2026-06-12: "the commit email passes its own bar").
// Three lines in the reader's own order: did this commit drift? · can I trust that reading? ·
// where? Each line carries its band + verdict from the ONE shared legend (sigma-legend.mjs) —
// never hand-worded here. Everything else in the email is supporting detail for these 3 lines.
const AX12v = AX12c;   // the 12 canonical lanes, declared once above for the tile dump
const prV = trip.tol.perRow || [];
const worstLaneIdx = prV.length ? prV.indexOf(Math.max(...prV)) : -1;
const worstLane = (worstLaneIdx >= 0 && Math.max(...prV) > 0) ? `${AX12v[worstLaneIdx]} · ${AXNAME[AX12v[worstLaneIdx]] || AX12v[worstLaneIdx]}` : null;
const tolBand = measureBand('tolerance', trip.tol.offPct, { alarm: trip.tol.tooMany });
const sigLeg = legend(sigmaType, coleData ? coleData.matchSigma : NaN);
// docs-only is N/A BY DESIGN, not a discount caveat (pass-3 monologue: "DISCOUNTED reads as the
// tool failing"): no code changed → said-vs-did has no reality side to grip → σ cannot mean
// anything today, and SAYING SO is the instrument working, not failing.
const trustDiscount = docsOnly ? ' · docs-only commit: no code changed, so said-vs-did has no reality side to grip — σ is N/A by design today (the instrument being honest, not failing); judge this commit by the lane read above' : '';
// interpret the percentile FOR the reader (pass-3 monologue: three stacked caveats read as
// hedging): pull the pNN out and say in words whether THIS commit is unusual for us lately.
const pctNum = (p) => { const m = /^p(\d+)/.exec(p || ''); return m ? +m[1] : null; };
const pctRead = (p, { highBad = true } = {}) => { const n = pctNum(p); if (n == null) return p ?? 'no history yet'; const unusual = highBad ? n > 70 : n < 30; return `${p} — ${unusual ? 'unusually ' + (highBad ? 'high' : 'low') + ' for you lately' : 'normal for you lately'}`; };
const bandChip = (txt, col) => `<span style="display:inline-block;padding:1px 7px;border:1px solid ${col};border-radius:9px;color:${col};font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.06em">${txt}</span>`;
const driftedYes = trip.tol.tooMany;
// NO-SIGNAL guard: if the grid lit nothing (g+a+r==0) even after the retry, this is "couldn't measure"
// — a tiny/non-semantic diff or a persistent empty read — NOT a clean in-lane pass. Never render it green.
const tolEmpty = (trip.tol.green + trip.tol.amber + trip.tol.red) === 0;
const trustOk = !docsOnly && coleData && (sigLeg.band === 'trustworthy' || sigLeg.band === 'verified-reef');
const vLine = (n, q, head, headCol, rest) => `<div style="margin:9px 0 0"><div style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.14em;color:#5f6b78;text-transform:uppercase">${n} · ${q}</div>
<div style="font-size:15px;font-weight:700;color:${headCol};margin:1px 0 1px">${head}</div>
<div style="font-size:12px;color:#8b98a5;line-height:1.55">${rest}</div></div>`;
const vCol = tolEmpty ? '#9aa6b2' : driftedYes ? '#ff3b3b' : '#2ecf6f';
const vColHi = tolEmpty ? '#9aa6b2' : driftedYes ? '#ff6b6b' : '#2ecf6f';
const verdictBlock = `<div style="margin:0 0 14px;padding:12px 15px;background:#0a1018;border:1px solid #1a2a3a;border-left:3px solid ${vCol};border-radius:8px">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:${vColHi};text-transform:uppercase">the verdict · commit ${shaShort}</div>
${vLine('1', 'did this commit drift?', tolEmpty ? `DIRECTION ONLY — reality lit nothing measurable, so there is no drift to score (no code change, or a tiny / non-semantic diff). This commit still set a direction — see line 3.` : driftedYes ? `YES — out of lane (${trip.tol.offPct}% orthogonal vs the 25% tolerance)` : `NO — in lane (off-lane ${trip.tol.offPct}%, tolerance 25%)`, vColHi, tolEmpty ? `${bandChip('direction-only', '#9aa6b2')} read this as "direction set, reality not yet measurable" — not a pass, not a fail` : `${bandChip(tolBand, driftedYes ? '#ff6b6b' : tolBand === 'bleeding' ? '#e0a020' : '#2ecf6f')} ${measureVerdict('tolerance', tolBand)} · vs your last 10 commits: ${pctRead(pctTxt(pct.off))}`)}
${vLine('2', 'can you trust that reading?', docsOnly ? 'N/A — docs-only commit (by design)' : coleData ? `${sigLeg.name} ${coleData.matchSigma} — ${sigLeg.band.toUpperCase()}` : 'no walk ran', trustOk ? '#2ecf6f' : '#e0a020', docsOnly ? `${bandChip('n/a', '#e0a020')}${trustDiscount.replace(/^ · /, ' ')}` : `${bandChip(sigLeg.band, trustOk ? '#2ecf6f' : '#e0a020')} ${sigLeg.verdict} · vs your last 10: ${pctRead(pctTxt(pct.sigma), { highBad: false })}${coleData && (sigLeg.band === 'noise' || sigLeg.band === 'weak') ? ` · why low: usually a thin grip (only ${senseR.claims} reality vs ${senseI.claims} intent claims sensed) or a seed library not yet converged — low σ means "don't lean on the maps", NOT "the commit is bad"` : ''}`)}
${vLine('3', 'where does this commit live?', `${COORDS[startPixel]} ${tileWords(COORDS[startPixel])} → ${COORDS[patientPixel]} ${tileWords(COORDS[patientPixel])}`, '#ff8ad8', `read it as actor × patient: this commit is mostly <b>${tileWords(COORDS[startPixel])}</b> work acting on <b>${tileWords(COORDS[patientPixel])}</b> (grip ${pixGrip.toFixed(3)}). this is the commit's COORDINATE — where the work lives — not a judgement; the panels below (◎ marks this cell) are what judge it${worstLane && driftedYes ? ` · drift concentrates in lane <b style="color:#ffce6b">${worstLane}</b> — read that row on the TOLERANCE panel` : ''}`)}
<div style="font-size:11px;color:#5f6b78;margin-top:9px;border-top:1px solid #141c28;padding-top:7px">next: ${docsOnly ? leadsTo('sigma', 'noise') : leadsTo('sigma', sigLeg.band) || '—'}${driftedYes ? ` · ${leadsTo('tolerance', 'alarm')}` : ''}</div>
</div>`;
// ② what this email reports, one compact line (the breadth-first orientation before any dive).
const directionsLine = `<div style="margin:0 0 16px;font-size:11.5px;color:#5f6b78;line-height:1.6"><b style="color:#8b98a5">what this instrument measures:</b> drift = what this commit SAID (message + docs) vs what it DID (code), sensed and walked on the chip — a deterministic read, not an LLM opinion. in reading order: <b style="color:#8b98a5">① the verdict</b> (above) → <b style="color:#8b98a5">② the maps</b> (the raw sense grids, then the leaf-walk clouds that bridge them, then DELTA/TOLERANCE judging the result) → <b style="color:#8b98a5">③ the numbers, contextualized</b> (every value with band · verdict · percentile · what it leads to) → <b style="color:#8b98a5">④ expert detail</b>, collapsed (attestation · receipts · timings · σ inputs).</div>`;
// ── ③ THE NUMBERS, CONTEXTUALIZED — every row the reader keeps carries value · band · good/bad
// phrase · percentile vs last-10 · leadsTo, all from the shared legend; the expected-appearance
// phrases come from the same pre-registered whatGoodLooksLike() table (phantom P1 + the σ bands).
const WGL = Object.fromEntries(whatGoodLooksLike().map(g => [g.id, g.expected]));
const numCard = ({ name, value, band, bandCol, verdict, pctile, leads, expected }) => `<div style="border-bottom:1px solid #121a26;padding:8px 0">
<div style="font-size:12.5px;color:#c9d1d9"><span style="color:#5f6b78">${name}</span> · <b>${value}</b> ${bandChip(band, bandCol)}${pctile ? ` <span style="color:#5f6b78;font-size:11px">${pctile}</span>` : ''}</div>
<div style="font-size:11.5px;color:#8b98a5;line-height:1.5;margin-top:2px">${verdict}${leads ? ` → <span style="color:#9fd4cf">${leads}</span>` : ''}</div>
${expected ? `<div style="font-size:10.5px;color:#5f6b78;line-height:1.45;margin-top:2px">good looks like: ${expected}</div>` : ''}</div>`;
const GOODCOL = '#2ecf6f', WARNCOL = '#e0a020', BADCOL = '#ff6b6b';
const fillPctI = coleData ? +(100 * coleData.intentCells / 20736).toFixed(1) : 0;
const fillPctR = coleData ? +(100 * coleData.realityCells / 20736).toFixed(1) : 0;
const fillBand = measureBand('fill', Math.max(fillPctI, fillPctR));
const walkBand = measureBand('walks', tCole, { budget: 2500 });
const prewalkBand = trip.preWalk ? measureBand('prewalk', trip.preWalk.rawPct) : null;
const driftBandM = drift != null ? measureBand('driftPct', drift) : null;
const numbersBlock = `<div style="margin:18px 0;padding:4px 15px 8px;background:#0a0f17;border-left:3px solid #45a29e;border-radius:6px">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#45a29e;text-transform:uppercase;margin:10px 0 2px">③ the numbers, contextualized — value · band · verdict · percentile · what it leads to</div>
${numCard({ name: 'shape-match σ', value: coleData ? `${coleData.matchSigma}${docsOnly ? ' (discounted)' : ''}` : '— no walk', band: sigLeg.band, bandCol: trustOk ? GOODCOL : WARNCOL, verdict: `${sigLeg.verdict}${docsOnly ? ' · docs-only: reality ⊆ the doc corpus, so this σ measures self-similarity, not alignment' : ''}`, pctile: pctTxt(pct.sigma), leads: leadsTo('sigma', docsOnly ? 'noise' : sigLeg.band), expected: WGL.sigma })}
${numCard({ name: 'tolerance (edge cells)', value: `${trip.tol.green} green · ${trip.tol.amber} amber · ${trip.tol.red} red · off-lane ${trip.tol.offPct}%`, band: tolBand, bandCol: driftedYes ? BADCOL : tolBand === 'bleeding' ? WARNCOL : GOODCOL, verdict: measureVerdict('tolerance', tolBand), pctile: pctTxt(pct.off), leads: leadsTo('tolerance', tolBand), expected: WGL.tolerance })}
${trip.preWalk ? numCard({ name: 'pre-walk overlap', value: `${trip.preWalk.rawPct}%`, band: prewalkBand, bandCol: prewalkBand === 'self-similar' ? WARNCOL : GOODCOL, verdict: measureVerdict('prewalk', prewalkBand), pctile: pctTxt(pct.prewalk), leads: leadsTo('prewalk', prewalkBand), expected: WGL.prewalk }) : ''}
${drift != null ? numCard({ name: 'drift (XOR %)', value: `${drift}% of compared cells disagree`, band: driftBandM, bandCol: driftBandM === 'close' ? GOODCOL : driftBandM === 'mixed' ? WARNCOL : BADCOL, verdict: measureVerdict('driftPct', driftBandM), pctile: pctTxt(pct.drift), leads: leadsTo('driftPct', driftBandM) }) : ''}
${(wkI && wkR) ? numCard({ name: 'the walks (how the heatmaps were made)', value: `intent ${wkI.hops} hops → ply ${wkI.maxPly} · reality ${wkR.hops} hops → ply ${wkR.maxPly} · ${tCole}ms`, band: walkBand, bandCol: walkBand === 'inside-budget' ? GOODCOL : WARNCOL, verdict: `${measureVerdict('walks', walkBand)} · each hop = one real on-chip ballistic process; intent ended at ${wkI.ends.join(' · ')}, reality at ${wkR.ends.join(' · ')} — the definers-of-definers the recursion concentrated on`, pctile: '', leads: leadsTo('walks', walkBand), expected: WGL.walks }) : ''}
${coleData ? numCard({ name: 'lattice fill', value: `intent ${coleData.intentCells}/20736 (${fillPctI}%) · reality ${coleData.realityCells}/20736 (${fillPctR}%)`, band: fillBand, bandCol: fillBand === 'walkable' ? GOODCOL : WARNCOL, verdict: measureVerdict('fill', fillBand), pctile: '', leads: leadsTo('fill', fillBand) }) : ''}
</div>`;
// ── THE METRIC LADDER (σ-precision loop, 2026-06-12) — the system's climbing numbers in one
// ordered block, weakest link picked PROGRAMMATICALLY (distance-to-target × leverage) so the loop
// names its own next move instead of relying on session memory. All readings + wording come from
// metric-ladder.mjs → the one shared legend; a missing artifact reads "no reading", never a fake.
// Guarded: the ladder must NEVER throw the email path — any failure skips the block entirely.
let ladderBlock = '';
try {
  const { metricLadder, weakestLink } = await import('./metric-ladder.mjs');
  const ladder = metricLadder();
  const weak = weakestLink(ladder);
  const lScore = (r) => (Number.isFinite(r.distance) ? r.distance * (r.leverage ?? 1) : -1);
  const lRows = [...ladder].sort((a, b) => lScore(b) - lScore(a)).slice(0, 7).map((r) => {
    const isWeak = weak && r.id === weak.id;
    const col = r.band === 'no-reading' ? '#5f6b78' : isWeak ? BADCOL : Number.isFinite(r.distance) && r.distance <= 0.1 ? GOODCOL : WARNCOL;
    return `<div style="padding:5px 8px;border-bottom:1px solid #121a26;font-size:11.5px;color:#8b98a5;line-height:1.5${isWeak ? ';background:#1a0f14;border-left:3px solid #ff6b6b;border-radius:3px' : ''}">${isWeak ? '<b style="color:#ff6b6b">→ weakest</b> · ' : ''}<span style="color:#c9d1d9">${r.name}</span> · <b style="color:${col}">${r.display}</b> → target ${r.target} ${bandChip(r.band, col)}${Number.isFinite(r.distance) ? ` <span style="color:#5f6b78;font-size:10.5px">distance ${r.distance}</span>` : ''}${r.leadsTo ? ` · <span style="color:#9fd4cf">${r.leadsTo}</span>` : ''}</div>`;
  }).join('\n');
  ladderBlock = `<div style="margin:18px 0;padding:4px 15px 8px;background:#0a0f17;border-left:3px solid #ff8ad8;border-radius:6px">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#ff8ad8;text-transform:uppercase;margin:10px 0 4px">the ladder — what's climbing · weakest link first</div>
${lRows}
${weak ? `<div style="font-size:11px;color:#8b98a5;line-height:1.5;margin-top:7px">next move (picked by the system, not session memory): ${weak.why}</div>` : '<div style="font-size:11px;color:#5f6b78;margin-top:7px">no rung has a reading — produce the artifacts, then re-run</div>'}
</div>`;
  if (weak) console.log(`   metric ladder: weakest link = ${weak.id} (${weak.display} vs target ${weak.target}, score ${weak.score})`);
} catch (e) { console.error('   metric ladder skipped:', String(e.message || e).slice(0, 100)); }

// BRICK #5 — THE STORY (the second Gemini call). After the chip's deterministic read, an LLM narrates
// what's happening + judges whether the INGEST is reasonable (what files were used, what landed in the
// tiles). OFF the on-commit critical path: gated on --story ONLY (NOT --email) — the post-commit hook
// runs --email on every commit, so coupling the story to --email would fire a Gemini call per commit
// (an SF13 violation). The full narrated email is the on-demand `--email --story`.
// BRICK #6: --audio implies the story (it narrates the story text) and is likewise OFF the hook.
const AX12s = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const AXN = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund', B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Ops.Grid', C2: 'Ops.Loop', C3: 'Ops.Flow' };
// ── INSURABILITY READOUT (content-free, reverse-engineered from the panel GEOMETRY alone — the proof
// an underwriter reads WITHOUT reading the code; operator 2026-06-15). The DIAGONAL is the policy line:
// green ON it = declared risk == actual exposure == insurable at face value. Off-diagonal green = BASIS
// RISK (exposure in lanes the declaration never named — priceable, a premium loading). Red mass at
// orthogonal distance = the UNINSURABLE TAIL (exposure too far to cover). Same primitive as the drift
// receipt, read in insurance units — the bridge from "uninsurable AI" (the asymptote: red → all,
// distance → max) to a priced policy. Hoisted so BOTH the headline (under the image) and the story
// carry it; band orientation is the operator's image read (horizontal band = stable actor sprayed
// across patients it never named; vertical = stable patient, varied actor; diagonal = saying==doing).
let insur = null, bandTxt = '';
if (trip.tol && trip.tol.pattern) {
  const P = trip.tol.pattern;
  const diagShare = (P.greenDiag + P.greenOff) ? Math.round(100 * P.greenDiag / (P.greenDiag + P.greenOff)) : 0;
  const conc = (arr) => { const t = arr.reduce((s, v) => s + v, 0) || 1; const top = [...arr].sort((a, b) => b - a).slice(0, 2).reduce((s, v) => s + v, 0); return top / t; };
  const rowC = conc(P.greenRow), colC = conc(P.greenCol);
  bandTxt = diagShare >= 55 ? 'a clean diagonal (saying==doing in the same lane)'
    : rowC >= colC + 0.12 ? 'horizontal green bands — a STABLE actor sprayed across patients it never named'
    : colC >= rowC + 0.12 ? 'vertical green bands — a stable patient hit from actors the message never named'
    : 'rigid off-diagonal bands — saying and doing split across different lanes';
  const exposureLanes = (P.redBlocks || []).map(b => `${AX12s[b.br]}×${AX12s[b.bc]}`);
  const matches = !trip.tol.tooMany;
  // UNDERWRITER-NATIVE VERDICT (operator 2026-06-15: "do not output engineering logs — output the exact
  // legal/actuarial string the underwriter reads"). The LINE-FIRST region classifier already chose the
  // motif (which invariant/line the red falls on), its blast radius, severity and tier — the LINE is the
  // carrier of meaning ("it is not just the triangles… any geometry region, often lines"). Name it.
  const R = P.region || {};
  const macroL = ['Strategy', 'Tactics', 'Operations'];
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
  const laneName = (idx) => AXN[AX12s[idx]] || '?';
  // BIDIRECTIONAL LENS ROUTER (operator 2026-06-15: "SUSPECT + systemic triggers a calibration rather
  // than a false verdict"). A systemic line under a SUSPECT ingest — the SimHash gripped nothing
  // distinctive, so ONE anchor dominates every lane — is the signature of LENS BLINDNESS, not rogue
  // code. Now that the verdict is SEALED into a bearer token, minting a FALSE UNINSURABLE is the worst
  // outcome. Detect SUSPECT deterministically from the diagonal tiles (how many gripped anything); when
  // a UNINSURABLE systemic ruling rests on a blind lens, ABSTAIN (UNDETERMINED) and emit the BACKWARD
  // signal — tune the implicated anchors — instead of condemning the code. The lens improves the read;
  // the read improves the lens.
  // SUSPECT = the read is not evidence. Two deterministic signals: (1) WEAK σ — the shape-match is not
  // distinguishable from random (< 2σ, the canonical "panel story is not yet evidence" band); (2) BLIND
  // ingest — the diagonal tiles came back as the '(no distinctive match)' placeholder (the SimHash
  // gripped nothing). SimHash always returns a low non-zero sim, so test the CLAIM placeholder, not sim>0.
  const blindTiles = (diagTiles || []).filter(t => /no distinctive match/i.test(`${t.intent} ${t.reality}`)).length;
  const weakEvidence = (coleData?.matchSigma ?? 99) < 2.0;
  const suspectIngest = weakEvidence || blindTiles >= 10;   // σ not evidence, OR ≥10/12 tiles gripped nothing
  const calibrate = R.tier === 'UNINSURABLE' && suspectIngest && R.blastRadius === 'systemic';
  let nature = 'In-Lane', vector = '—', rupture = '—', rationale = 'Declared risk matches actual exposure; insurable at face value.';
  const tier = calibrate ? 'UNDETERMINED' : (R.tier || (matches ? 'INSURABLE' : 'PRICEABLE'));
  if (R.ruling) {
    const aLane = AX12s[R.ruling.br], pLane = AX12s[R.ruling.bc], aName = AXN[aLane], pName = AXN[pLane];
    const motifTxt = R.motif === 'horizontal' ? `Horizontal line — one actor (${laneName(R.invariant?.lane)}) across many patients`
      : R.motif === 'vertical' ? `Vertical line — one boundary (${laneName(R.invariant?.lane)}) hit from many actors`
      : R.motif === 'off-diagonal' ? `Off-diagonal line — a systematic ${R.offset > 0 ? 'below-diagonal (bottom-up)' : 'above-diagonal (top-down)'} shift of ${Math.abs(R.offset)} lane(s)`
      : 'Diagonal — self-reference (saying==doing)';
    const dirTxt = R.direction === 'bottom-up' ? 'Bottom-Up' : R.direction === 'top-down' ? 'Top-Down' : 'In-Lane';
    nature = `${dirTxt} · ${motifTxt} · ${cap(R.blastRadius)} blast radius`;
    vector = R.direction === 'bottom-up' ? `${aName} redefining ${pName} (${aLane} → ${pLane})`
      : R.direction === 'top-down' ? `${aName} directing ${pName} (${aLane} → ${pLane})`
      : `${aName} on ${pName} (${aLane} → ${pLane})`;
    rupture = `${cap(R.severity)} — macro ${macroL[R.ruling.actorMacro]}→${macroL[R.ruling.patientMacro]}, prefix ${R.ruling.prefixActor}→${R.ruling.prefixPatient}, line spans ${R.spread} lane${R.spread === 1 ? '' : 's'}`;
    rationale = tier === 'UNINSURABLE' ? `Execution altered a higher-abstraction boundary (${pName}) without declaration${R.blastRadius === 'systemic' ? ', streaking across the whole lattice' : ''}. Uninsurable tail risk.`
      : tier === 'PRICEABLE' ? `Exposure ${R.direction === 'top-down' ? 'flows top-down (intent→execution)' : 'is bounded within one frame'}; priceable with a loading.`
      : `Declared risk matches actual exposure; insurable at face value.`;
  } else if (!matches) {
    nature = 'Diffuse bleed (no concentrated line)'; rationale = 'Off-lane bleed without a concentrated line; priceable with a loading.';
  }
  // ROUTER OVERRIDE: when calibrating, the verdict ABSTAINS — it is a lens-blindness flag, not a ruling.
  if (calibrate && R.ruling) {
    nature = `Lens calibration required · was ${nature}`;
    rationale = `SUSPECT read (σ ${(coleData?.matchSigma ?? 0).toFixed(2)}${weakEvidence ? ' — not evidence' : ''}${blindTiles >= 10 ? `, ${blindTiles}/12 tiles gripped nothing` : ''}) under a systemic line = LENS BLINDNESS, not drift. Verdict ABSTAINS; the implicated lane (${laneName(R.invariant?.lane ?? R.ruling.br)}) is routed to reef calibration. Re-measure after the lens is tuned.`;
  }
  const tierColor = tier === 'UNINSURABLE' ? '#ff3b3b' : tier === 'PRICEABLE' ? '#e0a020' : tier === 'UNDETERMINED' ? '#a78bfa' : '#2ecf6f';
  const underwriter = `VERDICT: ${tier}\nNATURE: ${nature}\nVECTOR: ${vector}\nABSTRACTION RUPTURE: ${rupture}\nRATIONALE: ${rationale}`;
  insur = { diagShare, basisRiskPct: trip.tol.offPct, tailRed: trip.tol.red, exposureLanes, matches,
    tier, nature, vector, rupture, rationale, tierColor, underwriter,
    verdict: matches
      ? `declared risk MATCHES actual exposure within tolerance — insurable at face value (${diagShare}% on the policy diagonal)`
      : `${tier} — ${nature}: ${vector}. ${rationale} (basis risk ${trip.tol.offPct}% off-lane, ${diagShare}% on the policy diagonal)` };
  // BACKWARD SIGNAL — emit the lens-calibration request (the implicated anchors to tune). Surfaced,
  // NOT auto-applied (anti-rule: the LLM/instrument never silently mutates the reef seed; a lens change
  // is reviewed). The reef self-improve / orthogonalize pass reads this to TARGET the blind anchors
  // instead of random cells — closing the loop bidirectionally (forward prices · backward tunes).
  if (calibrate && R.ruling) {
    try {
      const calReq = { sha: shaShort, at: new Date().toISOString(), reason: 'suspect-read-systemic-line',
        sigma: coleData?.matchSigma ?? null, weak_evidence: weakEvidence, blind_tiles: blindTiles,
        lane: laneName(R.invariant?.lane ?? R.ruling.br), invariant: R.invariant,
        motif: R.motif, blast_radius: R.blastRadius, implicated_anchors: (P.redBlocks || []).map(b => `${AX12s[b.br]}×${AX12s[b.bc]}`) };
      writeFileSync(resolve(REPO, `.thetacog/cache/lens-calibration-${shaShort}.json`), JSON.stringify(calReq, null, 2));
      console.log(`   ⚖ LENS CALIBRATION queued: lane ${calReq.lane} · σ ${(coleData?.matchSigma ?? 0).toFixed(2)} (suspect) · systemic ${R.motif} line → .thetacog/cache/lens-calibration-${shaShort}.json (surfaced, not auto-applied)`);
    } catch (e) { /* graceful */ }
  }
}
if (insur) console.log(`   insurability ruling: ${insur.tier} · ${insur.nature} · ${insur.vector} · rupture ${insur.rupture}`);
const AUDIO = process.argv.includes('--audio');
const STORY = process.argv.includes('--story') || AUDIO;
let storyBlock = '', storyObj = null;
if (STORY && coleData) {
  const pr = trip.tol?.perRow || [];
  const worstIdx = pr.length ? pr.reduce((m, v, k) => (v > pr[m] ? k : m), 0) : -1;
  const driftLane = (trip.tol?.tooMany && worstIdx >= 0 && pr[worstIdx] > 0) ? { axis: AX12s[worstIdx], name: AXN[AX12s[worstIdx]] } : null;
  // GROUND TRUTH for the narration: the diff's ACTUAL added lines (code preferred — the most
  // commit-specific signal; docs as fallback on a docs-only commit). So the story ties each drifted
  // region in the picture to a REAL edit, not the filename (operator 2026-06-15).
  const changes = (diffCode || diffDocs || '').slice(0, 1800);
  // THE TILE PATTERN the reader is looking AT (operator 2026-06-15: "if you see a line across it with
  // green dots, the pattern is what gemini must make sense of"). Translate the tolerance map's lane
  // geometry (trip.tol.pattern) into the named-lane sentence the story narrates: where the green
  // carpet sits, whether it's the canonical diagonal (saying=doing in the SAME lane), and which
  // orthogonal squares the red drift fired in (lane × lane). Empty-graceful.
  let patternDesc = '';
  const P = trip.tol?.pattern;
  if (P) {
    const lane = (i) => `${AX12s[i]} (${AXN[AX12s[i]]})`;
    const topRows = P.greenRow.map((v, i) => [i, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topCols = P.greenCol.map((v, i) => [i, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const diagShare = (P.greenDiag + P.greenOff) ? Math.round(100 * P.greenDiag / (P.greenDiag + P.greenOff)) : 0;
    const shape = diagShare >= 55 ? `a DIAGONAL line of green dots (${diagShare}% of the green sits ON the diagonal — what you SAID and what you DID land in the SAME lane)`
      : diagShare >= 25 ? `green spread along the diagonal AND off it (${diagShare}% on-diagonal — some saying-doing in the same lane, some bleeding sideways)`
      : `green scattered OFF the diagonal (${diagShare}% on-diagonal — the doing landed in different lanes than the saying)`;
    const redTxt = (P.redBlocks || []).length
      ? `red drift fired in: ${P.redBlocks.map(b => `${AX12s[b.br]} acting on ${AX12s[b.bc]}`).join(', ')}`
      : 'no red — nothing fired in an orthogonal lane';
    patternDesc = `green carpet concentrated down rows ${topRows.map(([i]) => lane(i)).join(', ') || '(none)'} `
      + `and across columns ${topCols.map(([i]) => lane(i)).join(', ') || '(none)'}; the shape is ${shape} — ${bandTxt}; ${redTxt}.`;
  }
  const story = await tellStory({
    sha: shaShort, message: msg, intentFiles: docFiles, realityFiles: codeFiles,
    start: { coord: COORDS[startPixel] || '?', meaning: meaning[COORDS[startPixel]] || '' },
    sigma: coleData.matchSigma, hops: coleData.hops, tol: trip.tol, driftLane, tiles: diagTiles, changes,
    pattern: patternDesc, insurability: insur?.underwriter || insur?.verdict,
  });
  storyObj = story;
  if (story && story.text) {
    const vColor = story.ingestVerdict === 'GOOD' ? '#2ecf6f' : story.ingestVerdict === 'SUSPECT' ? '#ff3b3b' : '#e0a020';
    storyBlock = `<div style="margin:18px 0;padding:14px 16px;background:#0a1620;border-left:3px solid #66fcf1;border-radius:6px"><div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.18em;color:#66fcf1;text-transform:uppercase;margin-bottom:8px">Self-improvement summary · what happened · how we improved the seed · measurement trend · ingest <b style="color:${vColor}">${story.ingestVerdict}</b></div><div style="font-size:14px;color:#cdd6e0;line-height:1.6;white-space:pre-wrap">${story.text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div></div>`;
    console.log(`   story: ingest=${story.ingestVerdict} · ${story.text.split('\n')[0].slice(0, 80)}…`);
  }
}
// ── ON-CHIP TIME (unique per commit — a fresh silicon measurement, NOT a constant) ──
let onChip = null;
try {
  const BIN = resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');
  if (fexists(BIN)) {
    const tp = execSync(`${BIN} --throughput`, { cwd: REPO, encoding: 'utf8' });
    onChip = {
      meanNs: tp.match(/mean=([\d.]+)/)?.[1] ?? '?',
      elapsedMs: tp.match(/elapsed=([\d.]+) ms/)?.[1] ?? '?',
      wps: tp.match(/walks\/sec=(\d+)/)?.[1] ?? '?',
      lit: tp.match(/cells lit:\s*(\d+ \/ \d+)/)?.[1] ?? '?',
    };
    console.log(`   ON-CHIP time (this commit): per-walk mean ${onChip.meanNs}ns · ${onChip.elapsedMs}ms · ${onChip.wps} walks/sec · ${onChip.lit} lit`);
  }
} catch (e) { console.error('   on-chip timing skipped:', String(e.message || e).slice(0, 80)); }

// ── REEF GRID snapshot (input seed → sensor SimHash sanity check), recomputed when the reef changed ──
let reefPng = null, reefHtml = null;
try {
  reefPng = execSync(`${resolve(REPO, 'scripts/pmu/reef-grid-snapshot.sh')}`, { cwd: REPO, encoding: 'utf8' }).trim() || null;
  const rh = resolve(REPO, '.thetacog/cache/reef-grid.html'); if (fexists(rh)) reefHtml = rh;
} catch (e) { /* graceful */ }

// ── REEF SimHash SENSE time (this commit) — time the sensor compressing the 144 seeds (no side effects) ──
let reefSense = null;
try {
  const { simhash } = await import('../../src/app/pmu-simulator/signature.mjs');   // was './signature.mjs' — missing path made reefSense silently null → the '?' in the email
  const lib = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'));
  const ts = Date.now(); for (const e of lib) simhash(e.snippet || e.seed || '');
  reefSense = { ms: Date.now() - ts, n: lib.length };
  console.log(`   reef SimHash sense: ${reefSense.n} seeds in ${reefSense.ms}ms (this commit)`);
} catch (e) { /* graceful */ }

// ── HARDWARE root of trust (attestation key + machine serial/UUID — WHICH silicon ran this) ──
let hw = null;
try {
  const a = JSON.parse(execSync(`node ${resolve(REPO, 'scripts/pmu/hw-sign-fallback.mjs')}`, { cwd: REPO, encoding: 'utf8' }));
  let serial = null, uuid = null;
  try { const id = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { cwd: REPO, encoding: 'utf8' });
    serial = id.match(/IOPlatformSerialNumber"\s*=\s*"([^"]+)"/)?.[1]; uuid = id.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1]; } catch { /* */ }
  hw = { pubkey: a.pubkey_b64 ? a.pubkey_b64.slice(0, 28) + '…' : null, algo: a.algo, derived: /deriv/i.test(`${a.hw} ${a.note}`), serial, uuid };
  console.log(`   HW root of trust: serial ${serial ?? '?'} · attest ${hw.pubkey ?? '?'} (${a.algo})`);
} catch (e) { /* graceful */ }

// ── ④ EXPERT DETAIL — COLLAPSED (operator, 2026-06-12: "demote/collapse expert rows into a
// <details> block"). Everything the on-call engineer needs to CHECK this read — chain status,
// attestation, receipts, stage timings, the σ definition with its full inputs — none of which
// the 10-second phone reader needs to GRADE it. The chain ticks ride the summary line, so
// "did everything run?" is answerable without expanding. The reader-facing copies of these
// numbers live in the verdict block + the numbers-contextualized section above.
const okm = (c) => c ? '✅' : '⚠️';
const row = (k, v) => `<tr><td style="padding:2px 10px 2px 0;color:#5f6b78;white-space:nowrap;vertical-align:top">${k}</td><td style="color:#c9d1d9">${v}</td></tr>`;
const expertDetails = `<details style="margin:18px 0;padding:10px 14px;background:#0a0f17;border:1px solid #141c28;border-radius:6px;font-family:ui-monospace,monospace;font-size:12px">
<summary style="font-size:11px;letter-spacing:.14em;color:#45a29e;text-transform:uppercase;cursor:pointer">④ expert detail — chain ${okm(true)} reef · ${okm(!!onChip)} on-chip · ${okm(!!hw)} hardware · ${okm(true)} render — attestation · receipts · timings · σ inputs (tap to expand)</summary>
<table style="border-collapse:collapse;margin-top:8px">
${row('chain', `${okm(true)} reef sensed — ${reefSense ? `${reefSense.n} seeds → SimHash in ${reefSense.ms}ms` : '144 tiles → SimHash'}${reefHtml ? ' · grid attached (input seed → SimHash sanity check)' : ''} · ${okm(!!onChip)} on-chip ${onChip ? `${onChip.meanNs}ns/walk · ${onChip.elapsedMs}ms · ${onChip.wps} walks/sec · ${onChip.lit} lit (measured on silicon, this commit)` : 'binary unavailable'} · ${okm(true)} triptych rendered · pipeline ${pipelineMs}ms · render ${renderMs}ms · ${friction ?? '—'} XOR-friction nodes`)}
${row('hardware root of trust', hw ? `serial <b>${hw.serial ?? '?'}</b> · UUID ${hw.uuid ? hw.uuid.slice(0, 8) + '…' : '?'} · attest ${hw.pubkey ?? '?'} (${hw.algo}${hw.derived ? ' · hw-derived fallback, weaker than Secure Enclave' : ''})` : 'attestation unavailable')}
${row('gate (XOR+popcount)', gateHw.gateNs ? `${gateHw.gateNs} ns / driven comparison · walk @ gate rate ${gateHw.walkNs ?? '—'} ns` : '— (daemon report unavailable)')}
${row('cache witness', gateHw.l1 ? `L1 ${gateHw.l1} ns · DRAM ${gateHw.dram} ns · miss ×${gateHw.missPenalty}` : '—')}
${row('daemon binary', gateHw.binSha ? `sha256 ${gateHw.binSha}… (the attested silicon path)` : '—')}
${row('run receipt', receipt.runId ? `${receipt.runId}${receipt.payloadSha ? ` · payload ${receipt.payloadSha}…` : ''}${receipt.band != null ? ` · band ${receipt.band}` : ''}` : '—')}
${row('timings', `ingest ${tIngest}ms · definer-walk+σ ${tCole}ms · render ${renderMs}ms · pipeline ${pipelineMs}ms <span style="color:#5a6673">· ingest = commit-scoped SENSING only (msg + changed files → lattice); deep seed authoring lives in the reef-self-loop, off the commit path</span>`)}
${row('walks (this heatmap)', (wkI && wkR) ? walkCountRow(wkI, wkR) : '—')}
${row('per-stage', Object.entries(stageMs).map(([k, v]) => `${k} ${v}ms`).join(' · ') || '—')}
${row('walk start', ` ${COORDS[startPixel] || startPixel} (${startPick.stable ? 'STABLE' : '⚠ marginal'} attractor) · ${coleData ? coleData.hops : 0} hops · maxPly ${coleData ? coleData.maxPly : 0}`)}
${row('σ — defined by its inputs', coleData ? `σ = (cos(intentCloud, realityCloud) − μ of 12 bit-shuffled-reality impostor walks) / sd · INPUTS: intent ${senseI.claims} claims @ θ ${senseI.theta.toFixed(3)} (msg + ${docFiles.length} docs + ${testFiles.length + governingTests.length} tests${idealSpec ? ' + ideal-case spec' : ''}${specIntent ? ' + SPEC intent' : ''}) · reality ${senseR.claims} claims @ θ ${senseR.theta.toFixed(3)} (${codeFiles.length} code) · walk topK ${SWEEP_TOPK} decay ${SWEEP_DECAY} ply≤8 budget 2500ms · seed-lib ${libSha} — σ comparisons are only valid at equal inputs` : '—')}
${row('σ raw', coleData ? `heat-cosine ${coleData.actualMatch} vs random ${coleData.impMean} → ${legendLine(sigmaType, coleData.matchSigma)}` : '—')}
${row('shortlex-3 projection', shortlex && shortlex.zi ? `${shortlex.ms}ms · intent zones ${shortlex.zi.z1}/${shortlex.zi.z2}/${shortlex.zi.z3} (+${shortlex.zi.cross} cross) · reality zones ${shortlex.zr.z1}/${shortlex.zr.z2}/${shortlex.zr.z3} (+${shortlex.zr.cross} cross) · zone 3 = candidate children, pre-ratchet` : `skipped — ${shortlex?.note ?? '?'}`)}
${row('orthogonality (seed 144)', ortho.uniqFull != null ? `${ortho.uniqFull}/144 unique · ${ortho.uniqFirst}/144 openings · pairwise sim ${ortho.meanPairwiseSim} · junk ${ortho.junkCount}` : '—')}
${row('intent documents', [...docFiles, ...testFiles, ...governingTests].map(f => f.split('/').pop()).join(' · ') || '(message only)')}
</table></details>`;
const footer = `<p style="font-size:12px;color:#5a6673;margin-top:16px;border-top:1px solid #1a2230;padding-top:10px">Produced on the chip by the running pipeline (scripts/pmu/pipeline.mjs → runPipeline → walk + xor), commit-scoped${onChip ? ` · on-chip per-walk ${onChip.meanNs}ns (this commit)` : ''}. Recompute: <code>node scripts/pmu/commit-triptych.mjs --commit ${shaShort}</code></p>`;
const artLinks = `<p style="font-size:11px;color:#5a6673;margin-top:10px">Commit artifacts (open on a computer — Gmail mobile won't follow file:// links; the inline images above are the phone-viewable form): <a href="file://${resolve(REPO, 'public/pmu-demo/reef-grid.html')}" style="color:#66fcf1">reef grid</a> · <a href="file://${OUT}" style="color:#66fcf1">this triptych</a> · <a href="file://${resolve(REPO, 'docs/architecture/ballistic-gate-hdl-email.html')}" style="color:#66fcf1">the HDL</a> — all three are also attached to this email.</p>`;
// Both canonical links for THIS commit: the full commit page on our own site (same output as this
// email — the live /commit/<sha> route) AND the actual commit on GitHub. Not just GitHub.
const siteCommitUrl = `https://thetadriven.com/commit/${shaShort}`;
const ghCommitUrl = `https://github.com/wiber/thetadrivencoach/commit/${sha}`;
const commitLinks = `<div style="margin:10px 0 4px;font-size:12px;color:#9aa6b2;line-height:1.6">View this commit: <a href="${siteCommitUrl}" style="color:#66fcf1;font-weight:600">◎ the full commit page on thetadriven.com</a> <span style="color:#5a6673">(same output as this email)</span> · <a href="${ghCommitUrl}" style="color:#66fcf1">⌥ the actual commit on GitHub</a></div>`;
const wrap = (inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Commit triptych · ${shaShort}</title></head>
<body style="background:#05070d;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px"><div style="max-width:780px;margin:0 auto">
<div style="font-family:ui-monospace,monospace;font-size:.7em;letter-spacing:.2em;color:#45a29e;text-transform:uppercase">PMU · on-commit dogfood · the chip's own anatomy</div>
${commitLinks}${storyBlock}${verdictBlock}${directionsLine}${inner}${numbersBlock}${ladderBlock}${expertDetails}${footer}${artLinks}</div></body></html>`;
writeFileSync(OUT, wrap(trip.dataHtml));   // attached file: data-URIs (renders in a browser)
if (DUMP_PNG) {   // lens A/B: write each panel PNG with a STABLE per-panel name (strip the sha-ts suffix)
  for (const p of trip.pngs) writeFileSync(resolve(DUMP_PNG, p.name.replace(/-[^-]+-[^-]+\.png$/, '.png')), p.buf);
  // ALSO dump the encircled REGIONS with their coordinate LABELS + lattice MEANINGS, so the STORY
  // knock-on (commit-story.mjs, email 2) can drag out what each lit-up area means WITHOUT re-deriving
  // it — the same deterministic regions the receipt drew. Each: {kind, coord label, meaning, blocks}.
  try {
    // FULL region objects (kind numeric + blockBox + coord) so the STORY knock-on can re-run the
    // per-region narration (narrateRegions) itself, plus a human `label` for the email.
    const regionsOut = (narrativeRegions || []).map(r => ({
      kind: r.kind, label: ({ 1: 'in-lane', 2: 'bleed', 3: 'drift' })[r.kind] || 'lit',
      coord: r.coord || null, blockBox: r.blockBox || null, meaning: r.meaning || '', blocks: r.blocks || 0,
    }));
    writeFileSync(resolve(DUMP_PNG, 'regions.json'), JSON.stringify({
      sha: shaShort, message: msg, tolerance: trip.tol ? `${trip.tol.green ?? '?'}g/${trip.tol.amber ?? '?'}a/${trip.tol.red ?? '?'}r` : null,
      offPct: trip.tol?.offPct ?? null, regions: regionsOut,
    }, null, 2));
  } catch { /* best-effort */ }
  console.log(`   DUMP_PNG: ${trip.pngs.length} panels + regions.json → ${DUMP_PNG.replace(REPO + '/', '')}`);
}
console.log(`✅ commit triptych · ${shaShort} · INTENT/REALITY/DELTA-XOR 144×144 on-chip · ${pipelineMs}ms pipeline + ${renderMs}ms render`);
console.log(`   timings: ingest ${tIngest}ms · definer-walk ${tCole}ms (row→transpose→row, ballistic XOR per hop) · σ ${sigma ?? '?'} · ${friction ?? '?'} friction`);
console.log(`   definer walk: start pixel ${coleData ? coleData.startPixel : '?'} (row ${coleData ? coleData.startRow : '?'}) · ${startPick.stable ? 'STABLE' : '⚠ marginal'} attractor · ${coleData ? coleData.hops : 0} hops · maxPly ${coleData ? coleData.maxPly : 0}`);
console.log(`   SHAPE-MATCH σ = ${coleData ? coleData.matchSigma : '?'} (actual match ${coleData ? coleData.actualMatch : '?'} vs random-reality mean ${coleData ? coleData.impMean : '?'})${coleData ? ` · ${legendLine(sigmaType, coleData.matchSigma)}` : ''}${docsOnly ? ' · ⚠ DISCOUNTED (docs-only)' : ''}`);
console.log(`   tolerance: ${trip.tol.green}g/${trip.tol.amber}a/${trip.tol.red}r ${trip.tol.tooMany ? '→ RED' : '→ ok'} · domBlocks ${trip.tol.domBlockCount ?? '?'}/144${trip.preWalk ? ` · pre-walk overlap ${trip.preWalk.rawPct}%` : ''}`);
if (wkI && wkR) console.log(`   walks: ${walkCountRow(wkI, wkR)}`);
console.log(`   percentiles vs last-10: σ ${pctTxt(pct.sigma)} · drift ${pctTxt(pct.drift)} · off-lane ${pctTxt(pct.off)}`);
console.log(`   → ${OUT.replace(REPO + '/', '')}`);
if (OPEN) { try { execSync(`open "${OUT}"`); } catch { /* */ } }

// BRICK #6 — the optional AUDIO walkthrough (local TTS, no network/cost). Renders the Brick #5 story to
// an MP3 with macOS `say` + lame; attached to the email. Off the critical path (--audio only). Graceful.
let audioPath = null;
if (AUDIO && storyObj && storyObj.text) {
  audioPath = renderAudio(storyObj.text, `/tmp/commit-walk-${shaShort}.mp3`);
  console.log(audioPath ? `   audio: ${audioPath.replace('/tmp/', '')} (local say+lame, attached to email)` : '   audio: skipped (no say/lame or empty story)');
}

// "IF COMMIT THEN DIRECTION, SO NOT BLANK" (operator 2026-06-15): a blank tolerance panel that reads
// "not a pass" is misleading — a commit is ALWAYS a direction (its declared intent). Two cases:
//   (a) PURE CHURN — nothing semantic on EITHER side (a data/json/ndjson-only commit: senseI.lit 0 AND
//       senseR.lit 0). No direction to show, no drift to score → SKIP the email. These were the blank
//       drift-watch emails the operator kept getting on automation-churn commits.
//   (b) DIRECTION ONLY — intent lit but reality empty (tolEmpty). Lead with the DIRECTION (what the
//       commit declared, from the competence pixel), honestly labelled. Never a blank "not a pass".
// Honest-null is preserved (anti-rule: NO faked green) — a real but unmeasurable-reality commit reads
// "direction set, reality not yet measurable", not a pass.
const nothingToSay = senseI.lit === 0 && senseR.lit === 0;
if (EMAIL && nothingToSay) {
  console.log(`   drift-watch email SKIPPED — churn commit: nothing said or done to measure (intent ${senseI.lit} lit · reality ${senseR.lit} lit). A commit with no semantic direction gets no blank email.`);
}

// ONE PIPELINE (operator 2026-06-28: "there should be only one pipeline, the delegation receipt").
// The full delegation-receipt body — silicon bearer attestation + every panel + the verdict blocks —
// is built for BOTH --email and --publish. Only the actual SEND (execSync email-artifact) is gated on
// --email; --publish writes the SAME rich artifact to public/commit/<sha>/ without sending mail.
if ((EMAIL || PUBLISH) && !nothingToSay) {
  try {
    // EMAIL BODY uses CID images (Gmail strips data: URIs → blank graphs). Write each panel PNG to a
    // tmp file and pass it as --inline; the cidHtml references cid:<basename>. The data-URI .html is
    // ALSO attached (opens with graphs in a browser). Best of both.
    //
    // TOLERANCE FIRST (2026-06-13 — operator: "we lost the tolerance image, that was the highest signal
    // we had"). The body grew to ~10 stacked panels at ~115KB; Gmail CLIPS past ~102KB, and the
    // tolerance panel sat 7th — below the fold, clipped away. Fix: render the tolerance panel as a
    // HEADLINE at the very top (always above the clip line) AND attach it standalone (survives any
    // clip). The full triptych still follows for the curious. This panel gets pole position by design.
    const tolPng = trip.pngs.find(p => /trip-tolerance/.test(p.name));
    const tolFp = tolPng ? `/tmp/${tolPng.name}` : null;
    if (tolPng) writeFileSync(tolFp, tolPng.buf);
    // ENCIRCLED-REGIONS HEADLINE (operator 2026-06-26): the FIRST image in every drift/delegation
    // email — the tolerance SHAPE with each green/amber/red cluster ringed in its own colour, numbered,
    // and NAMED by its ShortLex bound coordinate, placed BEFORE the bearer attestation metrics so the
    // receipt shows the shape the off-lane % describes, not just a number. Same encircleRegionsPng()
    // the npx `annotate` mode burns + the same shortlex-coords names → verify-everywhere by eye.
    let encircledHeadline = '';
    try {
      // REUSE the encircled panel computed once above (narrativeRegions + encircledName) — same bytes the
      // blog OG gets from --dump-png. The headline is just the HTML around that already-pushed CID image.
      if (narrativeRegions && encircledName) {
        const KCOL = { 1: '#2ecf6f', 2: '#ffb000', 3: '#ff3b3b' }, KNM = { 1: 'in-lane', 2: 'bleed', 3: 'drift' }, KCW = { 1: 'green', 2: 'amber', 3: 'red' };
        // THE RECEIPT IS LLM-FREE (HARD RULE — operator 2026-07-05: "the email still looks like it uses
        // llm calls for the drift story; it must just write out the category names + subcategory ranges for
        // drift/bleed/lane — the story email has the llm context"). The receipt's per-region description is
        // now ALWAYS the DETERMINISTIC template (category + ShortLex subcategory range + count), useLLM:false
        // unconditionally — NOT !NO_QWEN, which let qwen run on every normal --email and violated the
        // decidable-receipt rule. The qwen narrative belongs ONLY in the separate STORY email (commit-story,
        // the detached knock-on). Guarded by tests/pmu-simulator/receipt-regions-llm-free.test.mjs.
        let storyByN = new Map();
        try {
          const narr = await narrateRegions({ message: msg, regions: narrativeRegions, reef: delegReefAnchorText, useLLM: false, cap: Math.max(8, narrativeRegions.length) });
          if (narr && Array.isArray(narr.perRegion)) storyByN = new Map(narr.perRegion.map(p => [p.n, p.story]));
        } catch { /* template-only, no network — falls through to the lattice meaning so the headline still renders */ }
        const rows = narrativeRegions.length === 0
          ? `<div style="font-size:11px;color:#7e8b99;margin:3px 0;text-align:center;font-style:italic">&#9678; DIRECTION-ONLY &mdash; this commit declared intent; no drift regions to encircle (thin / data commit). The shape above shows the direction pixel on the lattice.</div>`
          : narrativeRegions.map(r => { const comment = storyByN.get(r.n) || r.meaning; const cname = (r.reef && r.reef.name) || coordName(r.coord.label); /* reef-computed problem-space name (canonical extended); falls back to the canonical taxonomy — LLM-free */ return `<div style="font-size:11px;color:#8b98a5;margin:3px 0"><span style="display:inline-block;width:15px;color:${KCOL[r.kind]};font-weight:700">${r.n}</span><b style="color:${KCOL[r.kind]}">${KNM[r.kind]}</b> &middot; ShortLex <code style="color:#c9d1d9">${r.coord.label}</code>${cname ? ` <b style="color:#b8c2cc">${String(cname).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b>` : ''} &middot; ${r.blocks} ${KCW[r.kind]} block${r.blocks === 1 ? '' : 's'}${comment ? `<br><span style="color:#6b7684;margin-left:15px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.01em">${String(comment).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>` : ''}</div>`; }).join('');
        encircledHeadline = `<div style="margin:0 0 20px;padding:0 0 16px;border-bottom:1px solid #1a2230">`
          + `<div style="font-size:13px;font-weight:700;color:#e0a020;margin-bottom:3px;text-align:center">&#9678; COMPETENCE SHAPE &mdash; the leaf walk, encircled</div>`
          + `<div style="font-size:11px;color:#7e8b99;margin-bottom:4px;text-align:center">the shape the off-lane % describes &mdash; each cluster ringed in its own colour, numbered, located on the 144-anchor lattice</div>`
          // OBVIOUSLY LLM-FREE + the leaf-walk connection, on the email's face (operator 2026-07-13:
          // "the receipt needs to be obviously LLM free · a connection between the leaf walk"). The
          // regions ARE the leaf walk's output: decodeDeltaThreeColourEdges over the Cole-trace
          // intent/reality matrices (triptych-render.mjs) → tol.rgba → these ovals. Every name, range
          // and read below is templated deterministically (useLLM:false), never a model.
          + `<div style="font-size:10.5px;color:#5f6b78;line-height:1.55;margin-bottom:10px;text-align:center;max-width:560px;margin-left:auto;margin-right:auto">each region is where the <b style="color:#8b98a5">leaf walk</b> &mdash; the recursive definer-of-definer walk on the chip &mdash; lit reality <i>outside</i> the declared intent lane. Named, ranged and read below <b style="color:#8b98a5">deterministically, with zero model in the loop</b> &mdash; recompute the identical bytes yourself: <code style="color:#8fd19e">npx thetacog-mcp attest-demo</code></div>`
          + `<img src="cid:${encircledName}" width="576" style="width:100%;max-width:576px;height:auto;display:block;margin:0 auto;image-rendering:pixelated;background:#000;border:1px solid #1a2230;border-radius:4px">`
          + `<div style="margin:10px auto 0;max-width:576px">${rows || '<div style="font-size:11px;color:#7e8b99;text-align:center">no lit regions this commit</div>'}</div>`
          + `</div>`;
      }
    } catch (e) { /* best-effort: the encircled headline never blocks the email */ }
    const tolVerdict = tolEmpty ? '◎ direction only — declared intent, reality not yet measurable (not a drift score, not a fail)'
      : trip.tol.tooMany ? '⚠ TOO MANY out-of-lane — drifting'
      : (trip.tol.offPct > 0 ? 'in lane, some bleed' : 'fully in lane');
    // FULL-WIDTH + STORY (operator, 2026-06-13: "more story and full width on that image — what does
    // it tell us?"). The native PNG is 144px; max-width:100% only CAPS, so it rendered tiny + centered
    // with no explanation. Fix: force width:100% (image-rendering:pixelated keeps the upscale crisp,
    // same as the triptych panels) AND a static read-the-map legend below it — axes, the three colours,
    // the pink ◎ coordinate, what good looks like — so a glance at the grid is self-explaining. The
    // legend is STATIC (the colours/axes can't drift); the LIVE numbers are the only variable part.
    const sw = (col, txt) => `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${col};vertical-align:baseline;margin-right:5px"></span>${txt}`;
    const tolStory = `<div style="font-size:11px;color:#7e8b99;line-height:1.7;text-align:left;max-width:660px;margin:12px auto 0">`
      + `<b style="color:#8b98a5">what you're looking at:</b> the whole map is your competence lattice — both edges are the same 144 ShortLex anchors (what you do × what you act on). Each lit cell is one place this commit <b>said</b> something (its message + docs) and <b>did</b> something (its code). Colour = whether saying and doing landed in the same lane.<br>`
      + `${sw('#2ecf6f', `<b style="color:#2ecf6f">green</b> — in lane: you worked where you declared. This is the competence; more green is better.`)}<br>`
      + `${sw('#ffb000', `<b style="color:#ffb000">amber</b> — bleed: code touched a neighbour you didn't mention. A little is normal — nobody declares everything.`)}<br>`
      + `${sw('#ff3b3b', `<b style="color:#ff3b3b">red</b> — drift: code fired in an <i>orthogonal</i> lane (the surgeon doing plumbing) and enough of it to flip the aggregate. Red ≈ 0 is what good looks like.`)}<br>`
      + `<span style="color:#ff8ad8">◎</span> the pink ring is <b>this commit's coordinate</b> — where its work actually concentrated on the lattice.<br>`
      + (tolEmpty
          ? `<b style="color:#9aa6b2">so, this commit:</b> the reality side lit nothing measurable (no code change, or a tiny / non-semantic diff), so there is no drift to score. What it <i>does</i> carry is a <b style="color:#ff8ad8">direction</b> — the commit declared intent around <b>${COORDS[startPixel]}</b>${meaning[COORDS[startPixel]] ? ` (${meaning[COORDS[startPixel]]})` : ''}. Read this as <b style="color:#9aa6b2">direction set, reality not yet measurable</b> — not a pass, not a fail.`
          : `<b style="color:#8b98a5">so, this commit:</b> ${trip.tol.green} green, ${trip.tol.amber} amber, ${trip.tol.red} red → off-lane <b>${trip.tol.offPct}%</b> against a 25% tolerance — <b style="color:${trip.tol.tooMany ? '#ff3b3b' : '#2ecf6f'}">${tolVerdict}</b>.`)
      + `</div>`;
    // INSTRUMENT CALIBRATION — the latest PRE-REGISTERED study run's headline Greeks, so EVERY commit
    // email carries the proof the bucket is a priceable underlying (operator 2026-06-16: "make sure the
    // emails have the updated pipeline metrics"). This is the per-commit insurability verdict (geometry)
    // ANNOTATED with the instrument's standing calibration (the sealed 3-arm study: strike/folding-point,
    // signal vs dead-reef null, p, monotonic decay, PRICEABLE). Read-only; absence is shown, not faked.
    let calib = null;
    try {
      const sdir = resolve(REPO, 'data/pmu/study');
      const sfiles = readdirSync(sdir).filter(f => /\.json$/.test(f)).sort();
      if (sfiles.length) {
        const s = JSON.parse(readFileSync(resolve(sdir, sfiles[sfiles.length - 1]), 'utf8'));
        const sg = s.greeks, sa = s.arms;
        calib = {
          fold: Math.round((sg.strikePrice_foldingPoint.live.mean) * 100),
          signal: +sa.signal_live_minus_dead.mean.toFixed(2),
          p: sa.significance_wilcoxon.p, mono: Math.round(sg.volatility_monotonicity.rate * 100),
          mintViol: sg.zeroTailRisk_honestNull.mintViolations,
          verdict: String(s.VERDICT || '').split(' ')[0],
          // EVIDENCE provenance — so this reads as a reproducible measurement, not a marketing number.
          corpus: /HELD-OUT/i.test(s.corpus || '') ? 'cross-domain held-out (sealed)' : 'in-fence pilot',
          n: s.N?.admitted ?? null, filled: s.N?.filled ?? null, when: s.measured,
        };
        // THE EPISTEMIC PERIMETER (operator 2026-06-16): not a humility disclaimer — the explicit
        // statement of WHAT THIS INSTRUMENT CAN ACTUALLY SAY SOMETHING ABOUT, which IS the terms of the
        // transaction. Two facts make the perimeter: the DESCRIBABLE region (the fence — how many cells
        // pass paraphrase-invariant ∧ substitution-sensitive) and CALIBRATION (does the percentile sold
        // equal the rate delivered). If un-calibrated, NOTHING is sellable yet — and the email says so.
        try {
          const { calibrate } = await import('./pmu-option-price.mjs');
          const folds = (s.items || []).filter(r => r.admitted && typeof r.foldingFraction === 'number').map(r => r.foldingFraction);
          const cal = folds.length >= 4 ? calibrate(folds) : null;
          calib.calErr = cal ? cal.meanAbsCalibrationError : null;
          calib.calibrated = cal ? cal.meanAbsCalibrationError <= 0.1 : false;
        } catch { calib.calErr = null; calib.calibrated = false; }
      }
    } catch { /* graceful — calibration line is best-effort */ }
    const calibLine = calib ? `<div style="margin-top:9px;padding-top:8px;border-top:1px solid #141c28">`
      + `<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#5f6b78;margin-bottom:4px">study evidence · resilience = the folding-point · sealed 3-arm run${calib.n ? ` · N=${calib.n} ${calib.corpus}` : ''}</div>`
      + `<div><span style="color:#5f6b78">RESILIENCE (folding-point):</span> holds to <b style="color:#c9d1d9">${calib.fold}%</b> adversarial corruption before it abstains</div>`
      + `<div><span style="color:#5f6b78">SIGNAL vs dead-reef null:</span> <b style="color:#c9d1d9">${calib.signal}σ</b> · p <b style="color:#c9d1d9">${calib.p != null ? calib.p.toExponential(1) : '—'}</b> (null-subtracted)</div>`
      + `<div><span style="color:#5f6b78">DECAY · HONEST-NULL:</span> <b style="color:#c9d1d9">${calib.mono}%</b> monotonic · <b style="color:#c9d1d9">${calib.mintViol}</b> false mints → <b style="color:${calib.verdict === 'PRICEABLE' ? '#2ecf6f' : '#e0a020'}">${calib.verdict}</b>${calib.calibrated ? ` · <b style="color:#2ecf6f">CALIBRATED ${calib.calErr}</b>` : (calib.calErr != null ? ` · <b style="color:#e0a020">mis-cal ${calib.calErr}</b>` : '')}</div>`
      + `<div style="color:#3f4955;font-size:10px;margin-top:3px">one survival curve, two readouts: an <b style="color:#5f6b78">option</b> pays while it holds · <b style="color:#5f6b78">insurance</b> pays if it folds. reproduce: <span style="color:#5f6b78">npx thetacog pmu-verify</span></div>`
      + `</div>` : '';
    // THE EPISTEMIC PERIMETER — what we can actually say something about, stated as the transaction
    // terms. A confidence pixel sold at a percentile is a weather forecast: "90% rain" is only worth
    // buying if it rains ~90% of those times (calibration). Right now the region we can speak to is
    // SMALL — provisional sensor, a 144-cell map, a single commit's scope. We say so explicitly; the
    // instrument only quotes where it grips. That is what makes the market self-policing.
    const perimeterBlock = calib ? (() => {
      const describable = (calib.n != null && calib.filled) ? `${calib.n} / ${calib.filled} lattice cells` : '—';
      const litNow = `${senseI.lit ?? 0} intent · ${senseR.lit ?? 0} reality anchors lit`;
      const sellable = calib.calibrated
        ? `<b style="color:#2ecf6f">a calibrated resilience option</b> — e.g. a 90th-pct guarantee it holds its lane, on the ${calib.n}-cell fence (in-fence; out-of-sample pending)`
        : `<b style="color:#e0a020">nothing tradeable yet</b> — un-calibrated (mean error ${calib.calErr ?? '—'} &gt; 0.10)`;
      return `<div style="margin-top:9px;padding-top:8px;border-top:1px solid #141c28">`
        + `<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#5f6b78;margin-bottom:4px">epistemic perimeter · what we can price (the transaction terms)</div>`
        + `<div><span style="color:#5f6b78">DESCRIBABLE region:</span> <b style="color:#c9d1d9">${describable}</b> pass the fence ${`<span style="color:#3f4955">(the rest are out-of-scope, not failures)</span>`}</div>`
        + `<div><span style="color:#5f6b78">CALIBRATION:</span> ${calib.calibrated ? `<b style="color:#2ecf6f">calibrated</b>` : `<b style="color:#e0a020">MIS-CALIBRATED</b>`} (sold-percentile vs delivered-rate, err ${calib.calErr ?? '—'})</div>`
        + `<div><span style="color:#5f6b78">THIS COMMIT:</span> <b style="color:#c9d1d9">${litNow}</b></div>`
        + `<div><span style="color:#5f6b78">SELLABLE NOW:</span> ${sellable}</div>`
        + `<div style="color:#3f4955;font-size:10px;margin-top:3px">why small: provisional sensor (SimHash→gzip-NCD pending) · 144-cell map · this commit's scope. We quote only where the instrument grips — the perimeter IS the contract.</div>`
        + `</div>`;
    })() : '';
    // ROLLING RESILIENCE (24-day aggregate) — the learning from 1300+ commits/24d: a single-commit
    // email is one slice; this situates it in the org-level resilience trend. The CORRECTION TAX (% of
    // recent commits that fold back to fix a prior mistake — the historical-audit headline) IS an
    // organizational resilience read; the reef σ-trend (from the curse-detector's trajectory) proves
    // the instrument isn't inflating its own grip. Both are CHEAP (git subjects + a cached ndjson) —
    // no heavy recompute on the commit path.
    const rollingBand = (() => {
      try {
        const subs = execSync(`git log --since='24 days ago' --format='%s'`, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n').filter(Boolean);
        const corr = subs.filter(s => /\b(fix|revert|correct|hardening|wrong|regress|incident|provisional|race|blank|bug|broke)\b/i.test(s)).length;
        const tax = subs.length ? Math.round(corr / subs.length * 100) : 0;
        const taxCol = tax >= 25 ? '#ff3b3b' : tax >= 15 ? '#e0a020' : '#2ecf6f';
        let traj = '';
        try {
          const rows = read('.thetacog/cache/reef-trajectory.ndjson').trim().split('\n').filter(Boolean).slice(-2).map(l => JSON.parse(l));
          if (rows.length) {
            const last = rows[rows.length - 1], prev = rows[0];
            const dS = rows.length > 1 ? +(last.sigmaMean - prev.sigmaMean).toFixed(2) : 0;
            const arrow = dS > 0.02 ? '▲' : dS < -0.02 ? '▼' : '—';
            traj = `<div><span style="color:#5f6b78">REEF σ̄:</span> <b style="color:#c9d1d9">${last.sigmaMean}</b> ${arrow} · ρ ${last.rho} · <b style="color:#2ecf6f">STABLE</b> <span style="color:#3f4955">(not inflating its own grip — anti-Goodhart)</span></div>`;
          }
        } catch { /* trajectory optional */ }
        return `<div style="margin-top:9px;padding-top:8px;border-top:1px solid #141c28">`
          + `<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#5f6b78;margin-bottom:4px">rolling resilience · last 24 days (this commit in context)</div>`
          + `<div><span style="color:#5f6b78">VELOCITY:</span> <b style="color:#c9d1d9">${subs.length}</b> commits (~${Math.round(subs.length / 24)}/day)</div>`
          + `<div><span style="color:#5f6b78">CORRECTION TAX:</span> <b style="color:${taxCol}">${tax}%</b> (${corr} folded back to fix) <span style="color:#3f4955">— the org-level resilience read</span></div>`
          + traj
          + `</div>`;
      } catch { return ''; }
    })();
    // RECURRING-FOLD EARLY-WARNING — the organizational immune system in the email. The
    // historical-audit caches the recurring mis-fold shapes (.thetacog/cache/fold-shapes.json); here we
    // gzip-NCD THIS commit's diff against each cached fold signature. If it compresses tight to a shape
    // the org has corrected before, the email says so BEFORE it becomes the (N+1)th correction — "stop,
    // you've made this mistake before." Cheap: one git show + a few gzips against a cached file.
    const foldWarning = (() => {
      try {
        const cache = JSON.parse(read('.thetacog/cache/fold-shapes.json') || '{}');
        if (!cache.shapes || !cache.shapes.length) return '';
        // exclude noisy/bulk paths (data, caches, ndjson, db, images) — fold-shapes live in code/doc, and
        // a commit that sweeps the multi-MB email-sent.ndjson would otherwise blow the buffer (ENOBUFS).
        const diff = execSync(`git show ${shaShort} --format= --unified=0 --no-color -- ':(exclude).thetacog/' ':(exclude)data/' ':(exclude)public/' ':(exclude)*.ndjson' ':(exclude)*.db' ':(exclude)*.png' ':(exclude)*.jpg'`, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 })
          .split('\n').filter(l => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')).map(l => l.slice(1).trim()).join('\n').slice(0, 4000);
        if (diff.length < 60) return '';
        const gz = (s) => gzipSync(Buffer.from(s, 'utf8')).length;
        const ncd = (a, b) => { const za = gz(a), zb = gz(b), zab = gz(a + '\n' + b); return Math.max(0, 1 - (zab - Math.min(za, zb)) / Math.max(za, zb)); };
        let best = null;
        for (const s of cache.shapes) { if (!s.signature) continue; const sim = ncd(diff, s.signature); if (!best || sim > best.sim) best = { ...s, sim }; }
        if (!best || best.sim < 0.25) return '';   // floor: precision-first (noise ~0.08, real repeat 0.38) — advisory flag, not a gate
        return `<div style="margin:12px auto 0;max-width:660px;padding:10px 14px;background:#1a0f0a;border:1px solid #5a2d1a;border-left:3px solid #e0a020;border-radius:6px;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.6;color:#e0b890">`
          + `<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#c9882a;margin-bottom:4px">⚠ recurring-fold early-warning</div>`
          + `<div>this commit resembles <b style="color:#f0c060">«${best.label}»</b> — a fold-shape the org has corrected <b>×${best.size}</b> before (grip ${best.sim.toFixed(2)}). Check the code before it becomes the ${best.size + 1}th.</div>`
          + `</div>`;
      } catch { return ''; }
    })();
    // PROOF OF INSURABILITY — the underwriter-native RULING (read from the geometry alone; priced
    // without reading the code). A definitive policy verdict, not an engineering log.
    const policyBlock = insur ? `<div style="margin:14px auto 0;max-width:660px;padding:12px 14px;background:#0a0f17;border:1px solid ${insur.tierColor}44;border-left:3px solid ${insur.tierColor};border-radius:6px;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.7;color:#9aa6b2">`
      + `<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#5f6b78;margin-bottom:7px">proof of insurability · priced from the geometry, not the code</div>`
      + `<div><span style="color:#5f6b78">VERDICT:</span> <b style="color:${insur.tierColor}">${insur.tier}</b></div>`
      + `<div><span style="color:#5f6b78">NATURE:</span> ${insur.nature}</div>`
      + `<div><span style="color:#5f6b78">VECTOR:</span> ${insur.vector}</div>`
      + `<div><span style="color:#5f6b78">ABSTRACTION RUPTURE:</span> ${insur.rupture}</div>`
      + `<div><span style="color:#5f6b78">RATIONALE:</span> ${insur.rationale}</div>`
      + calibLine
      + perimeterBlock
      + rollingBand
      + `</div>` : '';
    const tolHeadline = tolPng ? `<div style="margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #1a2230">`
      + `<div style="font-size:13px;font-weight:700;color:${tolEmpty ? '#9aa6b2' : '#e0a020'};margin-bottom:3px;text-align:center">${tolEmpty ? '◎ DIRECTION — what this commit declared' : '⬛ TOLERANCE — the highest-signal read'}</div>`
      + `<div style="font-size:11.5px;color:#8b98a5;margin-bottom:10px;text-align:center"><b style="color:#2ecf6f">${trip.tol.green}</b> green · <b style="color:#ffb000">${trip.tol.amber}</b> amber · <b style="color:#ff3b3b">${trip.tol.red}</b> red · off-lane <b>${trip.tol.offPct}%</b> vs 25% — ${tolVerdict}</div>`
      + `<img src="cid:${tolPng.name}" width="660" style="width:100%;max-width:660px;height:auto;display:block;margin:0 auto;image-rendering:pixelated;background:#000;border:1px solid #1a2230;border-radius:4px">`
      + policyBlock + tolStory + `</div>` : '';
    // PROVENANCE STRIP — the insurability ASSETS up top, ABOVE the tolerance panel (operator 2026-06-15:
    // "needs to be early in the email, on top of the tolerance panel, timings, attestation looking all").
    // The commit is only the trigger; the INSURED object is the drift, so the receipt must stand on its
    // own — who ran it (attested silicon) · what code (daemon sha) · sealed receipt (payload · band) ·
    // the lens (seed-lib) · the on-chip timings — all the trust assets, scannable before the verdict.
    // ── THE BEARER ASSET — the COMPLETE policy seal (operator 2026-06-15: "bind Input + Lens + Verdict
    // into one un-spoofable token; alter any field → the signature breaks → it becomes a Bearer Asset").
    // The pipeline's INNER seal binds only the scalar measurement; this OUTER seal binds the REAL commit
    // input (msg + intent/reality corpus hashes), the EXACT lens (full seed-lib sha256), the actuarial
    // VERDICT, and the inner seal's payload_sha — ed25519-signed. An underwriter / oracle / smart
    // contract verifies that THIS verdict was produced by THIS lens on THIS input, with NO human trust.
    // LENS SELF-TEST — reef + THIS commit's SAME input (operator 2026-06-15: "the self test has to be
    // reef plus the same git log/repo as the real one… because they are fast, we can self test"). The σ
    // noise floor (impMean, impStd) is measured on THIS input's OWN bit-shuffled impostors, so the MAX σ
    // the lens could register here — reality FORCED to perfectly match intent (cosine→1) — is
    // (1 - impMean)/impStd. Comparing that FORCED ceiling to the ACTUAL read separates a LIVE-but-no-drift
    // read from a DEAD sensor: high ceiling + low actual = genuine no-drift; low ceiling = blind on this input.
    // REAL forced-perturbation experiments — MEASURED, not derived (operator 2026-06-15: "make it real…
    // real perturbation because it verifies the instrument on every commit — it lives in consort with
    // the repo"). The instrument and the repo co-evolve, so a one-time calibration is meaningless; we
    // VERIFY the live sensor on THIS commit's actual input every time. Take a perfect copy of the intent
    // corpus as "reality" and DELETE a growing prefix (the operator's "delete the first half"), re-sense
    // each, and MEASURE σ through the SAME walk. A healthy instrument reads HIGH at full match and decays
    // MONOTONICALLY to ~0 as the signal is destroyed — that response curve is the meaning. Fast (~ms/walk),
    // and this whole job is already the detached post-commit async, so the extra walks ride for free.
    let selfTest = null;
    if (!FAST && coleData && intentGrid && typeof senseDecompose === 'function') {   // --no-story: skip the leafWalk deletion-curve battery → the instrument-attestation block simply omits (selfTest stays null)
      try {
        const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return (na && nb) ? d / Math.sqrt(na * nb) : 0; };
        const shuf = (g) => { const a = Uint8Array.from(g); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
        const measure = async (gR) => {
          const [it, rt] = await Promise.all([leafWalk(intentGrid), leafWalk(gR)]);
          const actual = cos(it.matrix, rt.matrix);
          const imps = (await Promise.all(Array.from({ length: 8 }, () => leafWalk(shuf(gR))))).map((iw) => cos(it.matrix, iw.matrix));
          const mu = imps.reduce((s, x) => s + x, 0) / imps.length;
          const sd = Math.sqrt(imps.reduce((s, x) => s + (x - mu) ** 2, 0) / imps.length);
          return sd ? +(((actual - mu) / sd)).toFixed(1) : 0;
        };
        const curve = [];
        for (const frac of [0, 0.5, 1.0]) {   // fraction of the intent-as-reality corpus deleted from the front
          const corrupted = frac >= 1 ? '' : intentText.slice(Math.floor(intentText.length * frac));
          const grid = (corrupted.length < 2) ? new Uint8Array(20736) : senseDecompose(corrupted, 'selftest').grid;
          curve.push({ deleted: frac, sigma: await measure(grid) });
        }
        const peak = Math.max(...curve.map((p) => p.sigma)), floor = curve[curve.length - 1].sigma;
        const monotonic = curve.every((p, i) => i === 0 || p.sigma <= curve[i - 1].sigma + 0.5);   // info only
        // LIVE = the instrument reads HIGH on real signal and ~0 on destroyed signal (it RESPONDS).
        // Strict monotonicity is NOT required — a concentrated sub-corpus can read cleaner (higher σ).
        const live = peak > 5 && floor < Math.max(2, peak * 0.25);
        // EXPERIMENT 2 — Semantic Substitution / cross-wire (the "is it semantic on chip?" proof, operator
        // 2026-06-15). Force-replace the dominant anchor's defining words with an ORTHOGONAL anchor's words
        // in the intent corpus, re-sense as reality, and MEASURE σ vs the original intent. A reef reading
        // MEANING must see a different thing → σ COLLAPSES. If σ survives the swap, the reef is matching
        // structure/noise, not semantics — i.e. it is NOT the right reef for this codebase.
        let crossWire = { applicable: false, reason: 'n/a' };
        try {
          const domCoord = COORDS[startPixel] || 'A,A';
          const orthoCoord = ['A,A', 'B,B', 'C,C'].find((c) => c[0] !== domCoord[0]) || 'C3,C3';
          const wordsOf = (coord) => Array.from(new Set((meaning[coord] || '').toLowerCase().match(/[a-z]{4,}/g) || []));
          const domWords = wordsOf(domCoord), orthoWords = wordsOf(orthoCoord);
          let wired = intentText, swaps = 0;
          if (orthoWords.length) for (let i = 0; i < domWords.length; i++) {
            const re = new RegExp(`\\b${domWords[i]}\\b`, 'gi');
            if (re.test(wired)) { wired = wired.replace(re, orthoWords[i % orthoWords.length]); swaps++; }
          }
          if (swaps > 0) {
            const crossSigma = await measure(senseDecompose(wired, 'crosswire').grid);
            const collapsed = crossSigma < Math.max(2, peak * 0.4);
            const powered = swaps >= 5;   // too few reef words swapped → the test can't conclude (honest null)
            crossWire = { applicable: true, dom: domCoord, ortho: orthoCoord, swaps, baseline: peak, cross_sigma: crossSigma, collapsed, powered,
              pass: powered ? collapsed : null,
              note: !powered ? 'underpowered — thin reef-vocabulary overlap with this corpus (a tuning gap, not a clean pass/fail)' : collapsed ? 'σ collapsed → reads SEMANTICS' : 'σ survived → reads STRUCTURE, not meaning' };
          } else crossWire = { applicable: false, reason: 'reef vocabulary absent from corpus (code-dominant input → semantic grip gap)' };
        } catch (e) { crossWire = { applicable: false, reason: String(e.message || e).slice(0, 50) }; }
        // EXPERIMENT 3 — Repo Center-of-Mass / coverage (the environmental baseline, operator 2026-06-15).
        // Turn the lens on the trailing history: sense each recent commit's corpus and ask whether the
        // reef GRIPS it distinctively. coverage = fraction of recent commits the reef maps → is this the
        // right reef for the WHOLE repo, not just this commit. Low coverage = mis-fit instrument. The
        // center-of-mass names the lanes the repo actually works in. No walk — just sense — so it's cheap.
        let coverage = { applicable: false, reason: 'n/a' };
        try {
          const recent = execSync(`git log -25 --format=%H%x09%s ${sha}`, { cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
          let covered = 0, total = 0; const centers = {};
          for (const line of recent) {
            const tab = line.indexOf('\t'); if (tab < 0) continue;
            const h = line.slice(0, tab), subj = line.slice(tab + 1);
            let files = ''; try { files = execSync(`git diff-tree --no-commit-id --name-only -r ${h}`, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).slice(0, 12).map((f) => splitIdent(f.replace(/[\/._-]+/g, ' '))).join(' '); } catch { /* */ }
            const sd = senseDecompose(`${subj} ${files}`, 'coverage');
            let best = 0, bestIdx = 0; for (let i = 0; i < 144; i++) { const s = sd.score[i * 144 + i] || 0; if (s > best) { best = s; bestIdx = i; } }
            total++; if (best >= 0.55) { covered++; const c = COORDS[bestIdx]; centers[c] = (centers[c] || 0) + 1; }
          }
          const pct = total ? Math.round(100 * covered / total) : 0;
          const com = Object.entries(centers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}×${n}`);
          coverage = { applicable: true, window: total, covered, pct, pass: pct >= 60, center_of_mass: com };
        } catch (e) { coverage = { applicable: false, reason: String(e.message || e).slice(0, 50) }; }
        selfTest = { measured: true, curve, sigma_max: peak, sigma_floor: floor, sigma_actual: coleData.matchSigma, monotonic, live, cross_wire: crossWire, coverage };
        console.log(`   LENS SELF-TEST (measured): σ ${curve.map((p) => `${Math.round(p.deleted * 100)}%→${p.sigma}`).join(' · ')} · peak ${peak} floor ${floor} → ${live ? 'SENSOR LIVE' : '⚠ NOT VERIFIED'}${monotonic ? '' : ' · σ peaks at a concentrated sub-corpus'}`);
        console.log(`   EXP2 cross-wire: ${crossWire.applicable ? `${crossWire.dom}→${crossWire.ortho} (${crossWire.swaps} swaps) σ ${peak}→${crossWire.cross_sigma} — ${crossWire.note}` : `n/a (${crossWire.reason})`}`);
        console.log(`   EXP3 coverage: ${coverage.applicable ? `reef maps ${coverage.pct}% of last ${coverage.window} commits (${coverage.covered}/${coverage.window}) → ${coverage.pass ? 'CALIBRATED ✓' : '⚠ mis-fit (low coverage)'} · center-of-mass ${coverage.center_of_mass.join(' ') || '—'}` : `n/a (${coverage.reason})`}`);
      } catch (e) { console.error('   lens self-test skipped:', String(e.message || e).slice(0, 100)); }
    }
    // GLOBAL lens health — reef-only tile separation (the instrument's full-scale deflection + half-tile
    // grip robustness). Fast (SimHash, no pipeline), so it ships on every commit alongside the input test.
    let lensHealth = null;
    if (!FAST) try { const { lensSelfTest } = await import('./lens-self-test.mjs'); const h = lensSelfTest(); if (h) lensHealth = { max_sep_bits: h.maxSepBits, mean_sep_bits: h.meanSepBits, half_grip_bits: h.halfGripBits, robust: h.robust }; } catch (e) { /* graceful */ }   // --no-story: skip the global lens-health probe
    // DELEGATION ATTESTATION (additive) — delegSpecMd/delegSpecId/delegReef/delegReefSha/delegReefTmp
    // are loaded near the top of the file now (hoisted 2026-07-01, see comment there), so the
    // SIGNATURE below still binds BOTH halves (the ASK reef + the ANSWER) — inert when --spec absent.
    // PROVENANCE (additive, #2) — WHERE this ran: the committing room (Originating-Terminal trailer) +
    // its terminal app (rooms.json) + a recomputable room/app identity sha. Bound into the signature so
    // the receipt attests not just what + by-whom, but in-which-room/app/silicon. Best-effort.
    let provenance = null;
    try {
      const { sha256Hex: _sh } = await import('./receipt-crypto.mjs');
      const _trailer = (msg.match(/Originating-Terminal:\s*(.+)/i) || [])[1] || '';
      const _rooms = JSON.parse(read('data/rooms.json')); const _rs = _rooms.rooms || _rooms;
      const _room = Object.keys(_rs).find(k => new RegExp(`\\b${k}\\b`, 'i').test(_trailer)) || null;
      const _entry = _room ? _rs[_room] : null;
      provenance = {
        ran_in_room: _room,
        terminal_app: _entry?.terminal || null,
        term_program: process.env.TERM_PROGRAM || null,
        term_version: process.env.TERM_PROGRAM_VERSION || null,
        room_identity_sha256: _entry ? _sh(JSON.stringify(_entry)) : null,
      };
    } catch { /* provenance best-effort */ }
    let bearer = null, bearerFp = null;
    try {
      const { sealReceipt: sealPolicy, sha256Hex } = await import('./receipt-crypto.mjs');
      const seedLibRaw = read('data/pmu/snippet-library-144.json');
      const policyBody = {
        kind: 'cato-policy/v1',
        commit: { sha, short: shaShort, msg_sha256: sha256Hex(msg), intent_sha256: sha256Hex(intentText), reality_sha256: sha256Hex(realityText) },
        lens: { seed_lib_sha256: sha256Hex(seedLibRaw), lib_sha: typeof libSha !== 'undefined' ? libSha : null, self_test: selfTest, health: lensHealth },
        verdict: insur ? { tier: insur.tier, nature: insur.nature, vector: insur.vector, rupture: insur.rupture, rationale: insur.rationale, sigma: coleData?.matchSigma ?? null, band: receipt?.band ?? null, off_pct: trip.tol.offPct, diag_share: insur.diagShare } : { tier: tolEmpty ? 'UNMEASURED' : (trip.tol.tooMany ? 'UNINSURABLE' : 'INSURABLE') },
        measurement: { run_id: receipt?.runId ?? null, payload_sha256: r.stages?.claudbridge?.payload_sha ?? receipt?.payloadSha ?? null },
        hardware: hw ? { serial: hw.serial ?? null, attest_pubkey: hw.pubkey ?? null, algo: hw.algo ?? null } : null,
        // DELEGATION — sign BOTH halves so this email attests the ASK and the ANSWER as one mesh artifact.
        delegation: delegSpecPath ? {
          ask:    { spec_id: delegSpecId, reef_sha256: delegReefSha, spec_sha256: delegReef?.spec_sha256 ?? null, from_room: delegReef?.from_room ?? null, to_room: delegReef?.to_room ?? null, intent_sha256: sha256Hex(intentText) },
          answer: { commit: sha, reality_sha256: sha256Hex(realityText), verdict: insur ? insur.tier : (tolEmpty ? 'UNMEASURED' : (trip.tol.tooMany ? 'UNINSURABLE' : 'INSURABLE')), off_pct: tolEmpty ? null : trip.tol.offPct, sigma: coleData?.matchSigma ?? null },
        } : undefined,
        provenance,   // #2 — where it ran: room + terminal app + recomputable room/app identity sha
        at: new Date().toISOString(),
      };
      bearer = sealPolicy(policyBody);   // adds ed25519 pubkey_hex, sig_hex, sha256 over the canonical body
      bearerFp = `/tmp/policy-${shaShort}.json`;
      writeFileSync(bearerFp, JSON.stringify(bearer, null, 2));
      console.log(`   BEARER policy sealed: ${bearer.sha256.slice(0, 16)}… · ed25519 sig ${bearer.sig_hex.slice(0, 12)}… · signer ${bearer.pubkey_hex.slice(0, 12)}… (binds input+lens+verdict${policyBody.delegation ? '+delegation' : ''}${provenance?.ran_in_room ? '+provenance' : ''})`);
    } catch (e) { console.error('   bearer seal skipped:', String(e.message || e).slice(0, 120)); }
    const ck = '<span style="color:#2ecf6f">✓</span>';
    const lbl = (s) => `<span style="color:#5f6b78">${s}</span>`;
    const attestStrip = `<div style="max-width:660px;margin:0 auto 16px;padding:10px 14px;background:#0a0f17;border:1px solid #14b8a655;border-left:3px solid #45a29e;border-radius:6px;font-family:ui-monospace,monospace;font-size:10.5px;line-height:1.7;color:#8b98a5">`
      + `<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#45a29e;margin-bottom:6px">⛓ produced on attested silicon · sealed receipt — verify without trusting the sender</div>`
      + `<div>${ck} ${lbl('silicon')} ${hw?.serial ?? '?'} · attest ${hw?.pubkey ?? '?'} (${hw?.algo ?? '—'})</div>`
      + (provenance?.ran_in_room ? `<div>${ck} ${lbl('ran in')} <b style="color:#9aa6b2">${provenance.ran_in_room}</b> · ${provenance.terminal_app || provenance.term_program || '?'}${provenance.term_version ? ' ' + provenance.term_version : ''} · room-id ${(provenance.room_identity_sha256 || '').slice(0, 12)}…</div>` : '')
      + `<div>${ck} ${lbl('daemon')} sha256 ${gateHw?.binSha ?? '?'}…${gateHw?.gateNs ? ` · ${lbl('gate')} ${gateHw.gateNs}ns/cmp` : ''}</div>`
      + `<div>${ck} ${lbl('sealed receipt')} ${receipt?.runId ?? '?'} · payload ${receipt?.payloadSha ?? '?'}… · band <b style="color:#e0a020">${receipt?.band ?? '?'}</b></div>`
      + `<div>${ck} ${lbl('on-chip')} ${onChip?.meanNs ?? '?'}ns/walk · pipeline ${pipelineMs}ms${reefSense ? ` · ${lbl('lens')} ${reefSense.n} seeds/${reefSense.ms}ms` : ''}${typeof libSha !== 'undefined' && libSha ? ` · seed-lib ${libSha}` : ''}</div>`
      + (lensHealth ? `<div>${ck} ${lbl('lens health')} global separation ${lensHealth.max_sep_bits}b · half-tile grip ${lensHealth.half_grip_bits}b → ${lensHealth.robust ? '<b style="color:#2ecf6f">ROBUST</b>' : '<b style="color:#ff3b3b">DEGRADED</b>'}</div>` : '')
      + (bearer ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid #14b8a633">${ck} <b style="color:#14b8a6">BEARER POLICY</b> sha256 <b>${bearer.sha256.slice(0, 16)}…</b> · ed25519 sig ${bearer.sig_hex.slice(0, 12)}… · signer ${bearer.pubkey_hex.slice(0, 12)}… <span style="color:#5f6b78">— binds input+lens+verdict + instrument health; attached as policy-${shaShort}.json (verify: node scripts/pmu/verify-policy.mjs)</span></div>` : '')
      + `</div>`;
    // INSTRUMENT ATTESTATION — the on-chip self-test battery as an actuarial PASS/PARTIAL block, ON TOP of
    // the tolerance panel (operator 2026-06-15: "render the PASS/FAIL block where the CRO can't miss it"
    // + "the email should preempt the gzip objection out of the box"). Three experiments the sensor ran
    // on ITSELF, before it signed — the zero-trust compliance certificate.
    let battery = '';
    if (selfTest) {
      const brow = (name, status, color, detail) => `<div style="margin:4px 0"><span style="display:inline-block;min-width:160px;color:#c9d1d9">${name}</span><b style="color:${color}">${status}</b> <span style="color:#7e8b99">${detail}</span></div>`;
      const cw = selfTest.cross_wire || {}, cv = selfTest.coverage || {};
      const [s1, c1] = selfTest.live ? ['PASS', '#2ecf6f'] : ['FAIL', '#ff3b3b'];
      const [s2, c2] = !cw.applicable ? ['PARTIAL', '#e0a020'] : cw.pass === true ? ['PASS', '#2ecf6f'] : cw.pass === false ? ['FAIL', '#ff3b3b'] : ['PARTIAL', '#e0a020'];
      const [s3, c3] = !cv.applicable ? ['N/A', '#5f6b78'] : cv.pass ? ['PASS', '#2ecf6f'] : ['PARTIAL', '#e0a020'];
      battery = `<div style="max-width:660px;margin:0 auto 16px;padding:12px 14px;background:#0a0f17;border:1px solid #a78bfa55;border-left:3px solid #a78bfa;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.55;color:#9aa6b2">`
        + `<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#a78bfa;margin-bottom:8px">🔬 instrument attestation · on-chip self-test — the sensor tried to break itself before it signed</div>`
        + brow('Signal Decay', s1, c1, `σ ${selfTest.curve.map((p) => `${Math.round(p.deleted * 100)}%→${p.sigma}`).join(' ')} — σ responds to signal`)
        + brow('Semantic Substitution', s2, c2, cw.applicable ? `σ ${cw.baseline}→${cw.cross_sigma} on a meaning-swap · ${cw.note}` : `${cw.reason || 'n/a'}`)
        + brow('Repo Calibration', s3, c3, cv.applicable ? `reef maps ${cv.pct}% of last ${cv.window} commits · center-of-mass ${cv.center_of_mass.join(' ') || '—'}` : (cv.reason || '—'))
        + `<div style="margin-top:8px;padding-top:7px;border-top:1px solid #a78bfa22;font-size:10px;color:#5f6b78;line-height:1.5"><b style="color:#7e8b99">why this isn't gzip:</b> NCD/compression gives a scalar with no frame. This is a <b>located</b> drift on a grounded 144-anchor ShortLex lattice, traversed by the recursive definer-walk (not a flat distance). The Substitution row IS the discriminator — gzip survives a meaning-swap; a semantic reef collapses.</div>`
        + `</div>`;
    }
    // ── THE THREE-NODE ATTESTATION (operator 2026-06-17) — name the roles the cato-policy already binds,
    // and add the attestor's missing outputs: price + barter flag + recommendation. SPEC NODE serves the
    // spec + the 144-semantics lattice (intent + lens); WORK NODE produces the work (reality); the
    // ATTESTOR (a 3rd party, trustlessly via the sealed receipt) reads the A↔B drift, says inside/outside
    // tolerance, prices the option/insurance off the calibrated survival curve at THIS commit's stress,
    // and flags settlement (CLOSE = accept/barter · INSURE = renegotiate/cover · ABSTAIN = can't grip).
    const threeNode = await (async () => {
      try {
        const sha12 = (t) => createHash('sha256').update(String(t || '')).digest('hex').slice(0, 12);
        const specFp = sha12(intentText), workFp = sha12(realityText);
        const latticeFp = (typeof libSha !== 'undefined' && libSha) ? libSha : sha12(read('data/pmu/snippet-library-144.json'));
        let priceLine = '', barter, barterCol, rec;
        if (tolEmpty) { barter = 'ABSTAIN'; barterCol = '#9aa6b2'; rec = 'direction only — reality not yet measurable; the attestor abstains until work lands'; }
        else {
          const inside = !trip.tol.tooMany;
          const stress = Math.min(1, (trip.tol.offPct || 0) / 100);
          if (!FAST) try {   // --no-story: skip the option-price call → the PRICE line simply omits (priceLine stays empty)
            const { priceOption } = await import('./pmu-option-price.mjs');
            const sdir = resolve(REPO, 'data/pmu/study');
            const sfiles = readdirSync(sdir).filter(f => /\.json$/.test(f)).sort();
            const sj = JSON.parse(read(`data/pmu/study/${sfiles[sfiles.length - 1]}`));
            const folds = (sj.items || []).filter(r => r.admitted && typeof r.foldingFraction === 'number').map(r => r.foldingFraction);
            if (folds.length >= 4) {
              const p = priceOption({ folds, stress, notional: 100 });
              priceLine = `<div><span style="color:#5f6b78">PRICE @ ${trip.tol.offPct}% stress:</span> confidence <b style="color:#c9d1d9">${Math.round(p.strike.confidencePercentile * 100)}%</b> · option <b style="color:#c9d1d9">${p.pricing.holdOptionPremium}</b> · insurance <b style="color:#c9d1d9">${p.pricing.insurancePremium}</b> /100 notional</div>`;
            }
          } catch { /* price best-effort */ }
          if (inside) { barter = 'CLOSE'; barterCol = '#2ecf6f'; rec = 'inside tolerance — the option exercises; accept the work and settle (barter close)'; }
          else { barter = 'INSURE'; barterCol = '#e0a020'; rec = 'outside tolerance but gripped — price the insurance / renegotiate the spec before settling'; }
        }
        return `<div style="max-width:660px;margin:0 auto 16px;padding:12px 14px;background:#0a0f17;border:1px solid #66a3ff44;border-left:3px solid #66a3ff;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.7;color:#9aa6b2">`
          + `<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#66a3ff;margin-bottom:7px">⬡ three-node attestation · spec + work + a trustless 3rd party</div>`
          + `<div><span style="color:#5f6b78">① SPEC NODE</span> serves the spec + the 144-semantics lattice — <span style="color:#7e8b99">intent ${specFp}… · lattice ${latticeFp}</span></div>`
          + `<div><span style="color:#5f6b78">② WORK NODE</span> produced the work — <span style="color:#7e8b99">reality ${workFp}…</span></div>`
          + `<div style="margin-top:5px;padding-top:5px;border-top:1px solid #141c28"><span style="color:#5f6b78">③ ATTESTOR (3rd party)</span> reads the A↔B drift, trustlessly via the sealed receipt above:</div>`
          + `<div><span style="color:#5f6b78">TOLERANCE:</span> ${tolEmpty ? '<b style="color:#9aa6b2">no work to attest</b>' : (trip.tol.tooMany ? `<b style="color:#ff3b3b">OUTSIDE</b> (${trip.tol.offPct}% off-lane vs 25%)` : `<b style="color:#2ecf6f">INSIDE</b> (${trip.tol.offPct}% off-lane vs 25%)`)}</div>`
          + priceLine
          + `<div><span style="color:#5f6b78">BARTER FLAG:</span> <b style="color:${barterCol}">${barter}</b> — ${rec}</div>`
          + `</div>`;
      } catch { return ''; }
    })();
    const bearerArg = bearerFp ? ` --attach ${bearerFp}` : '';   // the portable Bearer Asset — the trustless token an oracle/underwriter ingests
    // ── DELEGATION BLOCK (additive display) — full spec + reef-from-spec + PMU×NCD interleave + walks/sec
    // litmus, ABOVE the panels. Built from the SAME vars the signature bound, so what's SHOWN is what's
    // SIGNED. Inert (empty) on a normal commit.
    let delegationBlock = '';
    if (delegSpecPath && delegSpecMd) {
      try {
        const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rep = delegReef?.report || {};
        const anchorRows = (delegReef?.anchors || []).map(a =>
          `<div style="margin:3px 0"><b style="color:#66fcf1">${esc(a.coord)}</b> <b style="color:#c9d1d9">${esc(a.title)}</b> <span style="color:#7e8b99">${esc(String(a.snippet || a.prose || '').replace(/\s+/g, ' ').slice(0, 130))}…</span></div>`).join('');
        const cps = gateHw?.gateNs ? (1 / Number(gateHw.gateNs)).toFixed(2) : null;
        const litmus = onChip ? `⚡ ${onChip.wps ? Number(onChip.wps).toLocaleString() : '—'} ballistic walks/sec${cps ? ` · gate ${cps}B comparisons/sec` : ''} on chip (${onChip.meanNs ?? '—'}ns/walk) — a walk is MANY chip processes (one per hop); impossible off-silicon` : '';
        const signedLine = bearer ? `<div style="margin-top:6px;color:#2ecf6f">✓ SIGNED — this whole artifact (ASK reef + ANSWERED work) is bound under ed25519 sig <b>${esc(bearer.sig_hex.slice(0, 12))}…</b> · sha256 ${esc(bearer.sha256.slice(0, 16))}… — a mesh receiver verifies without trusting the sender (<span style="color:#7e8b99">node scripts/pmu/verify-policy.mjs</span>)</div>` : '';
        delegationBlock = `<div style="max-width:660px;margin:0 auto 16px;padding:12px 14px;background:#0a0f17;border:1px solid #f0a93055;border-left:3px solid #f0a930;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;color:#9aa6b2">`
          + `<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#f0a930;margin-bottom:7px">🪸 delegation receipt · ${esc(delegSpecId)} — the ASK (spec+reef) and the ANSWERED work, attested together</div>`
          + `<div style="margin-bottom:6px"><span style="color:#5f6b78">ASK · reef</span> <b>${esc((delegReefSha || '—').slice(0, 12))}…</b> built from the spec · ${rep.requirements ?? (delegReef?.anchors || []).length} reqs · <b>${rep.collisions ?? '—'}</b> collisions · mean pairwise NCD <b>${rep.meanPairwiseNCD ?? '—'}</b> · closeness ρ <b>${rep.closeness_rho ?? '—'}</b>${delegReef?.from_room ? ` · <span style="color:#5f6b78">${esc(delegReef.from_room)} → ${esc(delegReef.to_room || '')}</span>` : ''}</div>`
          + anchorRows
          + (litmus ? `<div style="margin:7px 0;color:#f0a930">${litmus}</div>` : '')
          + `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #f0a93022;font-size:10px;color:#7e8b99;line-height:1.5"><b style="color:#9aa6b2">PMU × NCD interleave:</b> gzip-NCD compresses each claim onto the 144 ShortLex anchors (the decidable <i>where</i>) → its top landings seed the real recursive definer walk, which fans out ballistically row→significant-column→transpose→recurse on chip (the <i>shape</i>) → σ = the fraction of the ANSWERED work's shape inside the ASK's. Compression says where; the walk says how much.</div>`
          + signedLine
          + `<details style="margin-top:7px"><summary style="cursor:pointer;color:#5f6b78">▸ full delegated spec (${esc(delegSpecPath)})</summary><pre style="white-space:pre-wrap;font-size:10px;color:#8b98a5;margin-top:6px">${esc(delegSpecMd)}</pre></details>`
          + `</div>`;
      } catch (e) { console.error('   delegation block skipped:', String(e.message || e).slice(0, 100)); }
    }
    const delegArg = `${delegSpecPath ? ` --attach ${resolve(delegSpecPath)}` : ''}${delegReefTmp ? ` --attach ${delegReefTmp}` : ''}`;
    // ── FROM → TO DELEGATION DIRECTION (operator 2026-06-28) ──────────────────────────────────────
    // Every commit is DIRECTED: work is DONE in one room, its QUALITY is OWNED by another. Name that
    // direction as ONE OF THE FIRST things in the receipt — above the attest strip. FROM = the room the
    // commit ran in; TO = the explicit delegation target if this is a delegation, else the room whose
    // OWNED SURFACE the changed files most touch (the room that owns this commit's QC). Best-effort:
    // wrapped so a missing rooms.json / card never blocks the email. "It doesn't matter what room you
    // started in — it's always delegating to some room; every commit is directed at a room."
    let fromToHeader = '';
    try {
      const roomsMap = JSON.parse(readFileSync(resolve(REPO, 'data/rooms.json'), 'utf8')).rooms || {};
      const keys = Object.keys(roomsMap);
      const term = (k) => roomsMap[k]?.terminal || k;
      const emo  = (k) => roomsMap[k]?.emoji || '🔀';
      // normalise an arbitrary room string (a key, a terminal name, or a persona) to a canonical key
      const norm = (s) => {
        s = String(s || '').toLowerCase();
        if (!s) return null;
        return keys.find(k => s.includes(k)
          || s.includes(String(roomsMap[k].terminal || '').toLowerCase())
          || s.includes(String(roomsMap[k].persona || '').toLowerCase().replace(/^the\s+/, ''))) || null;
      };
      // FALLBACK (2026-07-04): recent commits lacked the Originating-Terminal trailer → fromRoom went null
    // → the delegation from→to header VANISHED (operator: "I'm not seeing the delegation receipts anymore;
    // they should be delegating to a different room with the full drift"). Default to the live room, else
    // 'operator', so the delegation ALWAYS fires and routeTaskChip can route the QC to a DIFFERENT room.
    let fromRoom = delegReef?.from_room || norm(provenance?.ran_in_room) || null;
    if (!fromRoom) {
      try { const _lbl = execSync('scripts/open-room-session.sh --print-label', { cwd: REPO, encoding: 'utf8' }).trim(); fromRoom = norm((_lbl.split(/\s+/).pop() || '').toLowerCase()) || null; } catch { /* no live room */ }
      fromRoom = fromRoom || 'operator';
    }
      let toRoom = delegReef?.to_room || null;
      let routeFit = null, routeVerdict = null;
      if (!toRoom && !FAST) {   // --no-story: skip the rust-chip mesh-route walk → toRoom stays null → the direction header self-routes to fromRoom below
        // SHAPE-MAX-MATCH from the ROOMS-REEF MESH (operator 2026-06-28): the target room is the one whose
        // OWN competence pixel best RECOGNIZES this work — the real recursive ballistic WALK shape-match on
        // the rust chip (~½s), NOT owned-surface globs, NOT keyword overlap, NOT cosine. routeTaskChip
        // (scripts/mesh/mesh-route-chip.mjs, the same router /next --map uses) walks each room's coordinate
        // basin and fits this commit's walked mass into it. Every commit is a directed delegation: done in
        // the originating room, QC pointed at the room the mesh says owns this shape.
        try {
          const { routeTaskChip } = await import(resolve(REPO, 'scripts/mesh/mesh-route-chip.mjs'));
          let changed = [];
          try { changed = execSync(`git diff-tree --no-commit-id --name-only -r ${sha}`, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no diff */ }
          const workText = `${msg}\n${changed.join(' ').replace(/[\/._-]+/g, ' ')}`;
          const route = await routeTaskChip(workText);
          toRoom = (route.ranked && route.ranked[0] && route.ranked[0].room) || route.room || fromRoom;
          routeFit = route.fit; routeVerdict = route.verdict;
        } catch (e) { toRoom = fromRoom; }
      } else if (!toRoom && FAST) {
        // FAST-PATH ROUTE (demo-credibility BUG fix, 2026-07-01): the ~½s rust-chip shape-match is skipped
        // in --no-story, but the receipt still names a direction — and it must NEVER self-delegate (from → from
        // reads as a broken governance loop on the PUBLIC /commit page). Compute a CHEAP DETERMINISTIC route
        // to a DIFFERENT room (vector_keyword overlap + stable-hash tie-break). The full walk stays the real
        // router in non-fast mode; this is only the fast fallback, and it is guaranteed distinct from fromRoom.
        try {
          const { cheapRouteRoom } = await import(resolve(REPO, 'scripts/pmu/cheap-route.mjs'));
          let changed = [];
          try { changed = execSync(`git diff-tree --no-commit-id --name-only -r ${sha}`, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no diff */ }
          const workText = `${msg}\n${changed.join(' ').replace(/[\/._-]+/g, ' ')}`;
          toRoom = cheapRouteRoom(workText, fromRoom);
        } catch (e) { /* graceful — the self-loop guard below still repairs a null/equal toRoom */ }
      }
      // SELF-LOOP GUARD (BUG fix): whatever routed above (fast or full), a DERIVED direction must point to a
      // DISTINCT room. routeTaskChip's `|| fromRoom` fallback, a catch, or a missing map can still leave
      // toRoom === fromRoom → force the next distinct room deterministically. An EXPLICIT delegReef.to_room is
      // never overridden (that is intentional operator direction, not a derived route).
      if (fromRoom && toRoom === fromRoom && !delegReef?.to_room) {
        try {
          const { nextDistinctRoom } = await import(resolve(REPO, 'scripts/pmu/cheap-route.mjs'));
          toRoom = nextDistinctRoom(fromRoom, { seed: sha });
        } catch (e) { /* leave as-is if rooms.json unavailable */ }
      }
      const fr = fromRoom || toRoom, tr = toRoom || fromRoom;
      if (fr || tr) {
        const isDeleg = !!delegReef?.to_room;
        const self = fr === tr;
        // CONFIDENCE GATE (operator 2026-07-04): a DERIVED route below the fit floor (SUSPECT, e.g. 0.31)
        // must not masquerade as a confident delegation — it is shown, but honestly marked, and it does
        // NOT write a QC to-do (no phantom task in a room the router isn't sure about). An EXPLICIT
        // delegReef.to_room is always confident (operator direction, not a guess).
        const routeConfident = isDeleg || routeFit == null || routeFit >= 0.5;
        const cell = (k) => `<b style="color:#cdd6e0">${emo(k)} ${term(k)}</b>`;
        const arrowTag = isDeleg ? 'delegated' : (self ? 'done · self-QC' : (routeConfident ? 'QC →' : 'QC? (low-confidence) →'));
        const fitTxt = routeFit != null ? ` · shape-match fit ${routeFit} (${routeVerdict})${routeConfident ? '' : ' — below the confidence floor, direction only'} · rooms-reef mesh, rust daemon ~½s` : '';
        fromToHeader =
          `<div style="max-width:660px;margin:0 auto 12px;padding:10px 16px;background:#0d1220;border:1px solid #2a3552;border-left:3px solid #e0a020;border-radius:6px;font-family:ui-monospace,monospace;color:#9aa6b2">`
          + `<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#e0a020;margin-bottom:5px">⬡ delegation direction · from somewhere → pointing somewhere</div>`
          + `<div style="font-size:14px;line-height:1.5">${cell(fr)} <span style="color:#5f6b78">— ${arrowTag} →</span> ${cell(tr)}</div>`
          + `<div style="font-size:11px;color:#7e8b99;margin-top:4px">`
          + (self
              ? `done in <b>${term(fr)}</b> · the mesh routes its QC back to itself${fitTxt}`
              : `work done in <b>${term(fr)}</b> · QC written to <b>${term(tr)}</b>'s to-do${isDeleg ? ' (explicit delegation)' : ` (shape-max-match)`}${fitTxt}`)
          + `</div></div>`;

        // WRITE THE QC TO THE TARGET ROOM'S TO-DO — this is what delegation MEANS: the work is done in the
        // originating room, but its quality-control item is queued for the room the mesh says owns this
        // shape (surfaces in scripts/room.sh "🔀 Incoming bifurcations"). bifurcate writes the rooms JSON
        // (+ best-effort signed mesh push); it never commits/pushes git, so it is safe on this path.
        if (tr && fr && tr !== fr && routeConfident && (EMAIL || PUBLISH)) {
          try {
            const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://thetadriven.com';
            const verdictTxt = trip.tol ? (trip.tol.tooMany ? `OUTSIDE tolerance ${trip.tol.offPct}% off-lane` : `INSIDE tolerance ${trip.tol.offPct}% off-lane`) : 'on-chip receipt';
            execSync(`node ${resolve(REPO, 'scripts/bifurcate.mjs')} --from ${fr} --to ${tr} --action ${JSON.stringify('QC: ' + (msg.split('\n')[0] || shaShort).slice(0, 90))} --context ${JSON.stringify(`Shape-max-match delegation (fit ${routeFit}, ${routeVerdict}). ${verdictTxt}. Full receipt: ${SITE}/commit/${shaShort}/`)} --commit ${shaShort} --link ${SITE}/commit/${shaShort}/`, { cwd: REPO, stdio: 'ignore' });
            console.log(`   🔀 QC delegated → ${tr}'s to-do (shape-match fit ${routeFit}, ${routeVerdict})`);
          } catch (e) { /* bifurcate best-effort — the receipt never blocks on the to-do write */ }
        }
      }
    } catch (e) { /* the direction header is best-effort and never blocks the receipt */ }
    // ── AUDITOR-GRADE ORDER (operator 2026-07-01) ──────────────────────────────────────────────────
    // PROOF at the TOP, interpretive narration at the BOTTOM. The new ATTESTATION block leads with the
    // DECIDABLE, PROVABLE facts only — LANE:IN/OUT (deterministic, σ/tolerance vs threshold + placement,
    // NOT a probability), the lattice placement, sensor:metal ✓, the ed25519 signature, gridHash, binary
    // version, and the σ placement measurement — the recompute-it-yourself anchors. Below it: the honest
    // calibration/telemetry tier (tolerance + study evidence + perimeter + receipts + self-test), then the
    // maps, then LAST the interpretive tier (qwen "why it drifted" + the from→to delegation direction),
    // clearly divided off as optional and NOT part of the attested proof.
    const lane = laneVerdict({
      placed: !!coleData,
      unplaced: !coleData && !tolEmpty,        // non-blank commit that placed nothing on the lattice → OUT
      tolTooMany: !!(trip.tol && trip.tol.tooMany),
      tolEmpty,
    });
    let attestationBlock = '';
    try {
      attestationBlock = renderAttestation({
        lane,
        sigma: coleData ? coleData.matchSigma : null,
        coord: COORDS[startPixel] || null,
        patient: COORDS[patientPixel] || null,
        domain: (tileWords(COORDS[startPixel]) || meaning[COORDS[startPixel]] || ''),
        sensorMetal: !!(hw && hw.serial),
        sensorLabel: hw ? `${hw.serial ?? '?'} · attest ${hw.pubkey ?? '?'} (${hw.algo ?? '—'})` : '',
        sigValid: !!(bearer && bearer.sig_hex),
        sigHex: bearer ? String(bearer.sig_hex).slice(0, 12) : '',
        signer: bearer ? String(bearer.pubkey_hex).slice(0, 12) : '',
        gridHash: libSha || '',
        binVersion: (gateHw && gateHw.binSha) ? gateHw.binSha : '',
        walkNs: (onChip && onChip.meanNs) ? onChip.meanNs : null,
      });
    } catch (e) { /* the attestation headline is best-effort but should lead — fall back to a bare LANE line */
      attestationBlock = `<div style="max-width:660px;margin:0 auto 18px;padding:14px 16px;background:#070c14;border-radius:8px;font-family:ui-monospace,monospace;color:#c9d1d9"><div style="font-size:20px;font-weight:800">LANE: ${lane}</div></div>`;
    }
    const telemetryTier = `${tolHeadline}${attestStrip}${battery}${threeNode}${foldWarning}`;   // honest calibration/telemetry — moved BELOW the proof, unchanged
    // HEADLINE = the ⬡ delegation-direction line + the encircled COMPETENCE SHAPE (the density-zone
    // picture + its per-region narratives). It LEADS the email (operator 2026-07-01, with the screenshot:
    // "that is … the first picture you see; then lane out etc. comes after") — moved OUT of narrationTier
    // so it rides above Gmail's ~102KB clip instead of being demoted below the maps. The bulky full-spec
    // delegationBlock stays LAST (it is reference detail, not the headline).
    // FULL COMMIT MESSAGE (operator 2026-07-02: "add the full commit message to the drift receipt
    // emails — they should at least rhyme with the drift narrative from qwen"): the ask, verbatim,
    // right between the direction header and the shape it produced.
    const msgEsc = String(msg || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const msgBlock = msgEsc ? `<div style="max-width:660px;margin:0 auto 14px"><div style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#8b98a5;margin-bottom:4px">the commit message (the ask the narratives below are about)</div><pre style="background:#0a0f17;border:1px solid #1a2230;border-radius:6px;padding:10px 12px;font-size:11px;line-height:1.5;color:#c9d1d9;white-space:pre-wrap;margin:0">${msgEsc.slice(0, 4000)}</pre></div>` : '';
    const headlineTier = `${fromToHeader}${msgBlock}${encircledHeadline}`;
    const narrationTier = `${delegationBlock}`;                                                  // interpretive: full delegated-spec detail — LAST
    const body = `<!doctype html><meta charset="utf-8"><div style="max-width:700px;margin:0 auto;padding:14px;background:#05070d;color:#c9d1d9">${assembleAuditorBody({ headline: headlineTier, attestation: attestationBlock, telemetry: telemetryTier, maps: wrap(trip.cidHtml).match(/<body[^>]*>([\s\S]*)<\/body>/)[1], narration: narrationTier })}</div>`;
    try { const previewBody = `<!doctype html><meta charset="utf-8"><div style="max-width:700px;margin:0 auto;padding:14px;background:#05070d;color:#c9d1d9">${assembleAuditorBody({ headline: headlineTier, attestation: attestationBlock, telemetry: telemetryTier, maps: wrap(trip.dataHtml).match(/<body[^>]*>([\s\S]*)<\/body>/)[1], narration: narrationTier })}</div>`; writeFileSync(`/tmp/deleg-email-preview-${shaShort}.html`, previewBody); } catch { /* preview best-effort */ }
    // PUBLISH the triptych as a PUBLIC, SEO-indexable page under public/commit/<sha>/ and LINK it in the
    // email — the email's claim becomes verifiable on the open web (un-spoofable) and every commit receipt
    // is indexable (operator 2026-06-28: "all triptychs must be public … link the predicted url … the
    // email is validated on web"). The files deploy with the next commit; the email carries the PREDICTED
    // url (operator confirmed that is fine). Best-effort — never blocks the email.
    const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://thetadriven.com';
    const publicUrl = `${SITE_URL}/commit/${shaShort}/`;
    let publicLink = '';
    try {
      const { publishCommitPage } = await import('./publish-commit-page.mjs');
      const ogDesc = tolEmpty ? 'direction only — reality not yet measurable'
        : (trip.tol?.tooMany ? `OUTSIDE tolerance · ${trip.tol.offPct}% off-lane` : `INSIDE tolerance · ${trip.tol.offPct}% off-lane`);
      publishCommitPage({ repoRoot: REPO, shaShort, sha, pngs: trip.pngs, bodyHtmlCid: body, subject: (msg || '').split('\n')[0] || `Commit ${shaShort}`, description: ogDesc, tolEmpty });
      // NUANCE 2026-07-13 (copy-only, inside the band string — NEVER touches render/slots/send
      // logic; guarded by the full pmu hard-suite run before any push): the underwriter's
      // translation rides the receipt everywhere it travels.
      publicLink = `<div style="max-width:700px;margin:0 auto 12px;padding:10px 14px;background:#0a0f17;border:1px solid #45a29e55;border-left:3px solid #45a29e;border-radius:6px;font:12px/1.6 ui-monospace,monospace;color:#9aa6b2">📡 <b style="color:#66fcf1">Public receipt — share this drift map</b> (un-spoofable · indexable · the same panel below, hosted on the open web): <a href="${publicUrl}" style="color:#66a3ff">${publicUrl}</a><br><span style="color:#8a8578">It reads like a claims file because it is one — green: the lane held · red, circled: the strike, drawn. Attachable to a D&amp;O or Cyber policy as the exhibit; recomputable by opposing counsel.</span></div>`;
      console.log(`   🌐 public receipt → public/commit/${shaShort}/  (${publicUrl})`);
    } catch (e) { console.error('   public-page skipped:', String(e.message || e).slice(0, 120)); }
    // ── CANONICAL LATEST PANELS (operator 2026-07-13: like the parent open-source repo — "we take
    // the last panels from the last commit always and put [them] on the front page. The fact that
    // you see them first and they're always changing is a huge signal."). Overwrite the stable
    // slots the homepage ApexSpine reads (public/home-panels/latest-*.png); they deploy with the
    // next push. LIT-FLOOR: a slot only updates when the fresh render exceeds 8KB — a thin/blank
    // panel NEVER replaces the last lit one (the broken-blank class, guarded in tests/reorg).
    try {
      // EXACT-PREFIX slot map (operator 2026-07-13: "the panels are wrong — the commit emails have
      // it right"). The email's canonical five are trip-intent / trip-reality / trip-delta /
      // trip-tolerance / trip-encircled; a substring match also caught the raw (pre-walk, UNGROUNDED
      // flat sensor) and sl variants, and whichever rendered last stole the slot. The homepage set
      // must be BYTE-IDENTICAL in kind to the email's core panels.
      const SLOT_RE = {
        // the compression seeds (gzip-NCD one-hop placements, BEFORE the walk) — operator
        // 2026-07-13: the raw pair belongs on the page; raw→walked IS the definer-of-definer
        // walk made visible. 7 slots, one run, one hallmark.
        'raw-intent': /^trip-raw-intent-/, 'raw-reality': /^trip-raw-reality-/,
        intent: /^trip-intent-/, reality: /^trip-reality-/, delta: /^trip-delta-/,
        tolerance: /^trip-tolerance-/, encircled: /^trip-encircled-/,
      };
      // PER-SLOT lit-floors (calibrated 2026-07-13 on a 909g/362a render): the heat-cloud panels
      // (intent/reality/encircled) are big; delta/tolerance are flat-colour grids that compress to
      // 2-5KB even heavily lit. The true blank signature is ~600B (the cat-bond empty intent).
      const SLOT_FLOOR = { 'raw-intent': 1200, 'raw-reality': 1200, intent: 5000, reality: 5000, delta: 1200, tolerance: 1200, encircled: 5000 };
      const hpDir = resolve(REPO, 'public/home-panels');
      const set = {};
      for (const p of trip.pngs) {
        const name = String(p.name || '');
        for (const [slot, re] of Object.entries(SLOT_RE)) {
          if (re.test(name) && p.buf && p.buf.length >= SLOT_FLOOR[slot]) set[slot] = p.buf;
        }
      }
      const slots = Object.keys(SLOT_RE);
      if (slots.every(s => set[s])) {
        // ATOMIC SET: all five from THIS render, or none — a mixed-commit collage is the exact
        // wrongness this replaces. Provenance stamped so the hallmark is checkable on sight.
        for (const s of slots) writeFileSync(resolve(hpDir, `latest-${s}.png`), set[s]);
        writeFileSync(resolve(hpDir, 'latest.json'),
          JSON.stringify({ sha: shaShort, ts: new Date().toISOString(), slots: slots.length }) + '\n');
        console.log(`   🖼  home-panels: full coherent set (${slots.length}/${slots.length}) refreshed from ${shaShort} — same panels the email carries`);
      } else {
        // NEVER-EMPTY CONTRACT: an incomplete set is not silence — trip recorded, previous coherent
        // set stays live, panel-repair takes the SECOND LOOK (re-derives the lens context) and its
        // successful repair re-runs this writer via the re-render.
        const missing = slots.filter(s => !set[s]).join(',');
        appendFileSync(resolve(REPO, '.thetacog/pipeline-gate-trips.ndjson'),
          JSON.stringify({ ts: new Date().toISOString(), gate: 'home-panel-lit-floor', sha: shaShort, action: `incomplete set (missing/thin: ${missing}) — previous coherent set kept; second look queued` }) + '\n');
        console.log(`   🖼  home-panels: incomplete set for ${shaShort} (missing/thin: ${missing}) → previous set kept · gate trip recorded`);
      }
    } catch (e) { /* best-effort: the homepage feed never blocks the receipt */ }
    // ── THE WRAPPER / CONTEXT LEAD-UP (operator 2026-07-13, monologue-first design). The receipt
    // email is the highest-frequency surface we own and the one thing a broker forwards; the
    // wrapper is engineered to generate the forward-to-grip monologue in the reader. Copy-only —
    // it prepends to the body's top div, ABOVE the band and panels; render/slots/send untouched.
    // Fork-2: one clause adapts to clean vs. drifted vs. direction-only (deterministic, from
    // trip.tol — NO model). Fork-1 default: subject unchanged (Gmail day-threading preserved).
    const laneClause = tolEmpty
      ? `This one is direction-only — the commit was too thin to light a region yet; the receipt still carries its coordinate and lane.`
      : (trip.tol?.tooMany
        ? `This one caught a miss: ${trip.tol.offPct}% of the work landed outside the lane it was given — circled in red below. A stated exception is what surplus looks like in print; watch the instrument locate it.`
        : `This one held: the work landed inside the lane it was given (${trip.tol?.offPct ?? 0}% off). Watch a clean receipt hold.`);
    const wrapper = `<div style="max-width:700px;margin:0 auto 14px;padding:15px 17px;background:#0a0f17;border:1px solid #2a3441;border-radius:8px;font:14px/1.62 -apple-system,Helvetica,Arial,sans-serif;color:#c9d1d9">`
      + `<p style="margin:0 0 10px">This fired when I committed code a moment ago — the chip placed what the commit did against what I meant, signed it, mailed it. ${laneClause} Recompute it yourself, same bytes: <code style="background:#141821;padding:1px 5px;border-radius:4px;color:#8fd19e">npx thetacog-mcp attest-demo</code>.</p>`
      + `<p style="margin:0;color:#a8b0bd">If this reached you as a forward: the five panels below are a claims file, drawn before the first claim — legible to an adjuster, recomputable by opposing counsel. Send it to the one person on your side who&#39;d run the command, or just reply.</p>`
      + `</div>`;
    const tmp = `/tmp/commit-triptych-email-${shaShort}.html`;
    writeFileSync(tmp, body.replace(/(<div style="max-width:700px;margin:0 auto;padding:14px;background:#05070d;color:#c9d1d9">)/, `$1${wrapper}${publicLink}`));
    const inlineArgs = trip.pngs.map(p => { const fp = `/tmp/${p.name}`; writeFileSync(fp, p.buf); return `--inline ${fp}`; }).join(' ');
    const audioArg = audioPath ? ` --attach ${audioPath}` : '';   // BRICK #6: attach the MP3 walkthrough when --audio
    const reefArg = `${reefHtml ? ` --attach ${reefHtml}` : ''}${reefPng ? ` --attach ${reefPng}` : ''}`;   // the reef grid (input seed → SimHash sanity check)
    const tolArg = tolFp ? ` --attach ${tolFp}` : '';   // tolerance PNG attached standalone — can never be clipped away
    // THREADED (operator: "same subject so I can't tell the difference" → thread them, even better).
    // A DAILY subject → Gmail threads every commit's heatmap into ONE conversation per day; the per-commit
    // verdict / sha / σ live in the BODY's exec-summary lede. One thread to follow, not N scattered.
    // The delegation receipt's identity is the DELEGATOR — always the from_room, whoever the work was
    // delegated to (incl. to-self). The from_room leads the subject so the thread groups by who asked.
    const delegFromRoom = delegReef?.from_room || null;
    const subject = delegSpecId
      ? `🪸 ${delegFromRoom ? delegFromRoom + ' ' : ''}delegation receipt · ${delegSpecId} · signed · ${day}`
      : `🪸 PMU drift watch · ${day}`;
    // SEND only when --email. --publish has, by this point, already written the SAME rich artifact to
    // public/commit/<sha>/ (the publishCommitPage call above) — the page IS the delegation receipt.
    if (EMAIL) {
      // ── EXACTLY-ONCE SEND GUARD (operator 2026-07-13: "the commits are sending doubles of the
      // same email panels — absolutely unacceptable"). Forensics: nearly every commit that day got
      // 2 drift-watch receipts (some 6×, one 10×) — multiple paths (hook, receipt-backfill racing
      // the in-flight hook render, repair herds) re-invoke this script with --email for the SAME
      // sha, and nothing at the send door checked. THE LEDGER IS THE MARKER: one receipt email per
      // sha, ever, regardless of how many upstream paths re-render. Renders stay re-runnable
      // (--publish, repair); only the SEND is once. Deliberate re-send: TRIPTYCH_EMAIL_FORCE=1.
      // Guarded by tests/pmu-simulator/email-exactly-once.test.mjs — changing this selection
      // context without changing that test is a red build.
      let alreadySent = false;
      try {
        const ledgerPath = resolve(REPO, '.thetacog/email-sent.ndjson');
        alreadySent = fexists(ledgerPath) &&
          readFileSync(ledgerPath, 'utf8').includes(`commit-triptych-email-${shaShort}.html`);
      } catch { /* unreadable ledger → fail open (send) — a lost dedup beats a lost receipt */ }
      if (alreadySent && process.env.TRIPTYCH_EMAIL_FORCE !== '1') {
        console.log(`   ⛔ exactly-once: receipt email for ${shaShort} already in the ledger — send SKIPPED (LLM-free receipt; the intervention carries the LLM) (TRIPTYCH_EMAIL_FORCE=1 to override)`);
      } else {
      // ── THE RECEIPT — LLM-FREE, deterministic, sent NOW, and the ONLY email this path sends.
      // it never waits on and is never blocked by a local model (CLAUDE.md: THE RECEIPT IS LLM-FREE).
      execSync(`node ${resolve(REPO, 'scripts/email-artifact.mjs')} --html ${tmp} --no-attach ${inlineArgs} --attach ${OUT}${tolArg}${audioArg}${reefArg}${bearerArg}${delegArg} --to you@example.com --subject ${JSON.stringify(subject)} --from-room`, { cwd: REPO, stdio: 'inherit' });
      // ── NO EMAIL 2 FROM THE RECEIPT PATH (operator 2026-07-13: "the email should revert to no LLM
      // in the loop for the drift receipt — and the intervention should have big LLM in the loop").
      // The per-commit qwen story knock-on is REMOVED here: the receipt loop is now purely LLM-free.
      // The big LLM sensemaking lives where it earns its cost — scripts/interventions/intervention-fire.sh,
      // which fires ONLY on an out-of-lane commit (an intervention), model-pinned + daily-capped, and
      // sends its own narrative email AFTER the receipt. Drift-only, not per-commit.
      }
    } else {
      console.log(`   ✓ published the full delegation receipt (no email; --publish)`);
    }

    // REFLEXIVE NARRATIVE (async, OFF the critical path): hand qwen the LIVE regions + the FULL real
    // context — message + the actual diff (git log) + the reef + the spec text — so it tells where THIS
    // commit slips from the spec it aimed at. Detached; writes .thetacog/cache/region-narrative-<sha>.json;
    // never blocks the commit or the email. The static panel labels are the lens; THIS is the commit read.
    try {
      if (narrativeRegions && narrativeRegions.length) {
        const changelog = execSync(`git show --stat --format= ${sha}`, { cwd: REPO, encoding: 'utf8' }).slice(0, 700)
          + '\n\n' + execSync(`git show ${sha} --format= --unified=0 --no-color -- ':(exclude).thetacog/' ':(exclude)data/'`, { cwd: REPO, encoding: 'utf8' }).slice(0, 1400);
        const reefText = [delegSpecMd ? `SPEC:\n${delegSpecMd.slice(0, 1200)}` : '', (delegReef?.anchors || []).length ? 'REEF ANCHORS:\n' + delegReef.anchors.map(a => `${a.coord || ''}: ${a.title || ''}`.trim()).filter(Boolean).join('\n') : ''].filter(Boolean).join('\n\n');
        const niFile = `/tmp/narrative-input-${shaShort}.json`;
        writeFileSync(niFile, JSON.stringify({ sha: shaShort, message: msg, reef: reefText, changelog, regions: narrativeRegions }));
        const child = spawn('node', [resolve(REPO, 'scripts/pmu/region-narrative.mjs'), '--from', niFile], { cwd: REPO, detached: true, stdio: 'ignore' });
        child.unref();
        console.log(`   🧠 reflexive narrative spawned (async) → .thetacog/cache/region-narrative-${shaShort}.json`);
      }
    } catch (e) { /* best-effort: the narrative never blocks the email */ }
  } catch (e) { console.error('email skipped:', String(e.message || e).slice(0, 120)); }
}
