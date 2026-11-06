#!/usr/bin/env node
// scripts/pmu/triptych-build.mjs — THE SHARED TRIPTYCH INPUT BUILDER.
//
// The on-commit emailer (commit-triptych.mjs) and the npx walkthrough (attest-demo.mjs) must render
// the SAME instrument — never a rigged subset. The email used to be the only path that fed
// renderTriptych the BALLISTIC EDGE matrices (cole), the pre-walk sense grids (rawGrids), the
// SHORTLEX-3 projection (shortlex), the competence-pixel statement, the diagonal tile dump, and the
// self-naming σ; attest-demo passed none of it and silently fell to the coarse heatmap-bitmap
// tolerance (decodeDeltaThreeColour, "no walk at all") with flat decode-only panels.
//
// This module extracts that construction — commit-triptych.mjs:214-520, byte-faithful — into ONE
// reusable function so BOTH surfaces build identical inputs from (intentText, realityText). It does
// NOT render; it returns the exact arg-set to spread into renderTriptych, plus the readout meta
// (pixel, σ, lane, tier, timings) the caller surfaces. The grand-slam npx run = this, fed real.
//
// @canonical-algorithm  commit-scoped sense decompose (20,736 ordered node-pair sigs) → competence pixel → leaf/definer ballistic walk ON CHIP both sides → coleData (edge matrices + matchSigma) → SHORTLEX-3 projection → the full renderTriptych input set
// @forbidden-alternative  the coarse decodeDeltaThreeColour-only path (no cole) · a 12-axis JS walk · symmetric outer-product sensing · feeding the spec LABEL (not its semantic content) into INTENT
// @why  attest-demo's tolerance/panels MUST be the same ballistic instrument the commit email ships (SUPERSET, never subset) or the npx run demonstrates gzip placement, not ShortRank
// @guard  tests/pmu-simulator/attest-demo-uses-edges.test.mjs · scripts/pmu/validate-dogfood.sh

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dominantBlocks } from './triptych-render.mjs';   // C18: the block rule has ONE home
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runPipeline } from './pipeline.mjs';
import { definerWalk144, COORDS, anchorScores, topSeeds } from './definer-walk-144.mjs';
import { pickStartPixel } from './start-pixel.mjs';
import * as DC from '../vna/door-crate.mjs';   // C612b: the sense loop and the walks in pmu-onchip --door-serve (node fallback kept)

const AX12 = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const AXNAME = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy·Law', A2: 'Strategy·Goal', A3: 'Strategy·Fund', B1: 'Tactics·Speed', B2: 'Tactics·Deal', B3: 'Tactics·Signal', C1: 'Operations·Grid', C2: 'Operations·Loop', C3: 'Operations·Flow' };
const tileWords = (coord) => { const [r, c] = String(coord || '').split(','); return r && c ? `${AXNAME[r] || r} × ${AXNAME[c] || c}` : String(coord || '?'); };
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const heatEmpty = (b64) => { const b = Buffer.from(b64 || '', 'base64'); if (!b.length) return true; for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false; return true; };

// ── THE WALK KNOBS HAVE ONE HOME (2026-09-14) ─────────────────────────────────────────────────
// Operator: "its provably not the same pipeline that is run elsewhere, like email or commit receipts,
// and it must be". Measured divergence before this: commit-triptych.mjs walked its cole edges with
// `budgetMs: 2500` (a WALL-CLOCK valve — machine-load-dependent, the exact thing definer-walk-144.mjs's
// header names as the σ drift Marsh read) while this builder (the door's path) used the deterministic
// 600000 hop-bounded default; topK/decay were read from PMU_TOPK/PMU_DECAY in one file and passed as
// parameters in the other. Two callers, two walks, two panels for the same texts. Every caller now reads
// THESE; a literal walk knob at a call site is the regression tests/pmu-simulator/one-encircled-pipeline
// .test.mjs exists to catch. (The impostor NULL — count and seed — is σ's null, not the panel's pixels,
// and is deliberately NOT unified here: changing it re-calibrates a settlement-grade series. Named.)
// The definition moved to src/lib/pmu/walk-knobs.mjs (14 ms import — the per-turn door sits on the hook's
// synchronous path and this module costs 113 ms to load). Re-exported here so every existing
// `import { WALK_KNOBS } from './triptych-build.mjs'` still names the same frozen object. ONE definition.
export { WALK_KNOBS } from '../../src/lib/pmu/walk-knobs.mjs';
import { WALK_KNOBS } from '../../src/lib/pmu/walk-knobs.mjs';

// ── C1373 (2026-10-28): THE 20,736 PAIR SIGNATURES LAND IN A COLD INSTALL ─────────────────────────────────────────────
// The pair-signature cache (144 × 144 simhashes over the snippet library) is written to .thetacog/cache/ the first time this
// builder runs, and senseClaimBoth hands the crate that FILE. A fresh npm install has no .thetacog/cache/ directory, so the
// write failed silently (best-effort catch), existsSync(PAIR_CACHE) stayed false, and every sense ran the node reference
// path — no fallback counted, but the crate was never asked (the repo, where the dir exists, took the crate path). The
// directory is created here, before the write; the write stays best-effort for a read-only tree.
export function pairCachePath(repo, libSha) {
  const dir = resolve(repo, '.thetacog/cache');
  try { mkdirSync(dir, { recursive: true }); } catch { /* read-only tree: the write below is best-effort too */ }
  return resolve(dir, `pair-sigs-144-${libSha}.json`);
}

// THE SHARED BUILD. Returns { renderArgs, meta }.
//   renderArgs — spread directly into renderTriptych (the caller adds label/sub/killTolerancePct).
//   meta       — { walkMode, startPixel, patientPixel, pixGrip, actorCoord, patientCoord,
//                  matchSigma, sigmaType, senseI, senseR, timings, diagTiles, domBlocks, note }.
// EVERYTHING is best-effort + honest: a thin corpus, a missing registry, or an unbuilt daemon
// degrades a sub-part to null/'coarse-fallback' with a note — NEVER a throw, NEVER a faked panel.
// C1411: the separation legs held per process, and the shipped declarations (attest-scenarios.mjs) — data relayed, never decided here
const LEGS = new Map();
// ── C1432 (2026-10-29): THE DECLARATION IS THE AUTHOR'S, NEVER THE GATE'S ─────────────────────────────────────────────────────────
// A scenario row's `expect` is the flat gzip-NCD gate's measured placement (attest-hypotheses.mjs placement()), the second reading that
// never decides (C1375). This used to key the declared positive on that field (the row the gate measured IN_LANE), so the second reading
// chose which row declares: C1430's admitted surgical spec (c53-se-clips), whose compliant report the gate reads OFF_DOMAIN mode A, would
// have shipped undeclared, PLACEMENT_ONLY, never a verdict. The declaration is the row's ROLE, which the author states in the row's key:
// the faithful row of a domain (key 'faithful', the default row, or '<domain>-faithful') is the compliant work the spec authorizes, so it
// declares positive = its reality and negative = its negative field. No field of the gate's measurement is read here.
// @guard tests/vna/c1432-the-declaration-is-the-author-s-never.test.mjs
export const declaresTheSpec = (sc) => !!sc && (sc.isDefault === true || sc.key === 'faithful' || String(sc.key || '').endsWith('-faithful'));
export function declarationOf(intentText, scenarios) {
  for (const sc of scenarios || []) if (declaresTheSpec(sc) && sc.intent === intentText) return { positive: sc.reality, negative: sc.negative };
  return null;
}
let _declared = null;
async function declaredSpec(intentText) {
  if (!_declared) _declared = (await import('./attest-scenarios.mjs')).SCENARIOS;
  return declarationOf(intentText, _declared);
}

export async function buildTriptychInputs({
  intentText, realityText, repoRoot,
  intentLabel = 'spec', realityLabel = 'work',
  killTolerancePct = 25, sigmaType = 'drift',
  // budgetMs huge so the DETERMINISTIC hop budget (not wall-clock) terminates the walk —
  // byte-stable σ on recompute requires the cap be a hop count, not machine speed
  // (same rule as unified-drift.mjs; the 1200ms wall-clock here is what made the demo's
  // walk σ drift 9.5→9.6 across runs while the page said "byte-identical" — Marsh read, 2026-08-13).
  impostors = WALK_KNOBS.impostors, budgetMs = WALK_KNOBS.budgetMs, topK = WALK_KNOBS.topK, decay = WALK_KNOBS.decay,
  // axesPath -- optional override forwarded straight to runPipeline -> loadAxes (Map-keyed by
  // resolved path, so this can never clobber a caller that asked for the repo-wide default; see
  // pipeline-state.mjs::loadAxes and tests/pmu/axes-path-override.test.mjs). undefined (every
  // caller before this option existed, and every caller today that does not pass one) = today's
  // unchanged behaviour -- the repo-wide 144 library. A session (e.g. /tape) that built its own
  // axes-144.json passes it here so momentum.mjs / measure-enforcement.mjs can WALK against the
  // session's own 144 axes instead of always the repo-wide one (DECISION-017).
  axesPath,
  // C610k — THE SENSOR ARM. 'claim' (the default, the path every committed panel took) senses each side through
  // claimify → salienceRank → simhash vs the 20,736 pair signatures. 'ncd' hands the SAME walk the xor stage's own
  // bits from the SAME runPipeline call below (the Rust gzip-NCD sensor — never a second sensor) and picks the ingress
  // off that grid. A caller that passes nothing gets today's bytes; tests/vna/c610k-the-walk-on-the-ncd-grid.test.mjs
  // re-renders five frozen panels and fails on any change. Port row C610k (lens.rs walk entry).
  sensor = 'claim',
  // C612b2 — the panel's lean path (composeTolerancePanel with lean, via the crate): `pipeline` hands over the runPipeline result the caller
  // already has for the SAME texts and axes, so the pipeline runs once per panel, not twice; `withShortlex: false` skips the SHORTLEX-3
  // projection, which only the triptych HTML draws. Absent (every other caller), both behave exactly as before.
  pipeline = null, withShortlex = true,
  // C1394 — the third text the caller is about to compare (a declared negative), floored with the other two; and the field names the
  // refusal prints (attest-serve's panel B walks intent vs the NEGATIVE, so its second text is named 'negative', not 'reality').
  negativeText = null, fields = {},
  // C1394 — THE COMMIT PANEL'S NAMED OPT-IN. A thin commit is legitimately direction-only (CLAUDE.md, THE RECEIPT IS LLM-FREE), so
  // the commit-panel door (tolerance-panel.mjs composeTolerancePanel, the one module tests/pmu/instrument-entry-allowlist.json lets
  // pass it) still DRAWS a panel under the floor — but the entry's stamp carries below_floor, and walkBoolean reads any reading so
  // stamped as UNMEASURED: the picture is drawn, no verdict can be taken off it. Every other caller is refused (the default).
  drawBelowFloor = false,
  // C1411 S3 — THE SPEC'S OWN POSITIVE AND NEGATIVE: { positive, negative } texts the spec's author declares (a compliant work product,
  // and one that leaves the lane). Absent, the shipped declaration for this exact intent is used (attest-scenarios.mjs: the faithful
  // row, keyed on its role and never on the gate's measured outcome (C1432), carries the spec's positive as its reality and its negative as its negative); none → placement only.
  // The crate walks each (the same walk, a leg) and decides the admission (door.rs admit_op); node carries texts and stamps only.
  spec = null,
  // C1411 — internal: this call IS a separation leg ('positive' | 'negative'); the crate stamps it as one and it is never admitted.
  _leg = null,
} = {}) {
  if (sensor !== 'claim' && sensor !== 'ncd') throw new Error(`buildTriptychInputs: sensor must be 'claim' or 'ncd', got ${sensor}`);
  const REPO = repoRoot || process.cwd();
  const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');
  const meta = { walkMode: 'coarse-fallback', note: null };

  // ── 0. C1394 THE ONE ENTRY — the floor and the health stamp, in the crate, before anything is sensed or walked ──────────────
  // The floor lived in the CALLER (C1376 put it in the demo; the sweep was born without it and read the pure sledgehammer IN_LANE
  // at 224 chars / 161 gz bytes). It lives in door.rs entry_op now, and every caller of this function inherits it: a text under
  // the floor returns a refusal (state UNMEASURED, the field and both sizes) and never a panel. A crate that cannot answer is
  // UNMEASURED too — the walk is the crate's, and a node walk is not a reading (rust only). The stamp the crate computes rides on
  // every result (renderArgs.stamp → renderTriptych's tol.stamp → walkBoolean, which refuses a reading without a full one).
  const texts = [{ field: fields.intent || 'intent', text: intentText }, { field: fields.reality || 'reality', text: realityText }];
  if (negativeText != null) texts.push({ field: fields.negative || 'negative', text: negativeText });
  // C1407: ONE library path for the stamp, the sense and the walks — the C1394 skeptic pointed axesPath at a reversed library and the
  // stamp changed while the sense read <repoRoot>'s library and the walks read door-crate's own module repo's.
  const libPath = axesPath ? resolve(axesPath) : resolve(REPO, 'data/pmu/snippet-library-144.json');
  let entry = null;
  try { entry = await DC.entryCrate({ texts, axes: libPath, drawBelowFloor, leg: _leg }); }
  catch (e) { entry = { state: 'UNMEASURED', refused: true, reason: `no crate entry: ${String(e?.message || e).slice(0, 140)} — the walk runs only in the crate (rust only); UNMEASURED, never a node walk`, stamp: null, floor: null }; }
  // C1406: the below-floor opt-in is the crate's (entry_op draw_below_floor seals below_floor into the stamp); node writes no stamp field.
  if (!entry || entry.refused) {
    const reason = entry?.reason || 'no crate entry — UNMEASURED';
    const stamp = entry?.stamp || null;
    return {
      state: 'UNMEASURED', refused: true, field: entry?.field ?? null, chars: entry?.chars ?? null, gzBytes: entry?.gz_bytes ?? null, floor: entry?.floor ?? null, reason, stamp,
      renderArgs: { refused: true, refusal: reason, stamp, sigmaType, timings: { ingest: null, walk: null, total: 0 } },
      meta: { walkMode: 'refused', note: reason, refused: true, refusal: reason, stamp, timings: { ingest: null, walk: null, total: 0 } },
    };
  }
  const engines = { sense: 'rust', walks: 'rust' };   // which engine answered each stage of THIS call (meta only; the stamp is the crate's)
  // C1406: the stamp the crate sealed, relayed stage to stage — the sense and the walks each hand it back re-sealed with their stage.
  // A stage that answered in node never touches it, so its stamp lacks that stage and verify refuses it. Node writes no field of it.
  let sealed = entry.stamp;

  // ── 1. runPipeline → the walk HEATMAP bitmaps (with the empty-heat retry guard) ──
  const ppArgs = { intentText, realityText, intentLabel, realityLabel, axesPath };
  let r = pipeline || await runPipeline(ppArgs);
  const heatBad = (x) => heatEmpty(x?.stages?.walk?.reality_heatmap_b64) || heatEmpty(x?.stages?.walk?.intent_heatmap_b64);
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 5 && heatBad(r); attempt++) {
    await new Promise((res) => setTimeout(res, 300 * attempt));
    const r2 = await runPipeline(ppArgs);
    if (!heatBad(r2)) { r = r2; break; }
  }
  const pipelineMs = Date.now() - t0;
  const S = r.stages || {}, w = S.walk || {}, x = S.xor || {};
  const intentB64 = w.intent_heatmap_b64, realityB64 = w.reality_heatmap_b64, frictionB64 = x.friction_bitmap_b64;

  // ── 2. dominant blocks (top-4 intent block-mass) — the tolerance in-lane reference ──
  const ib = Buffer.from(intentB64 || '', 'base64');
  const f32 = ib.length === 20736 * 4 ? new Float32Array(ib.buffer, ib.byteOffset, 20736) : null;
  const blockOf = (i) => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
  let domBlocks = [];
  if (f32) domBlocks = dominantBlocks(f32, blockOf);   // C18: one home — triptych-render.mjs
  meta.domBlocks = domBlocks;

  // ── 3. the 144-node snippet library + the 20,736 ordered pair signatures (cached) ──
  let _lib = [];
  try { _lib = JSON.parse(readFileSync(libPath, 'utf8')); if (!Array.isArray(_lib)) _lib = _lib.anchors || _lib.nodes || []; } catch { _lib = []; }   // C1407: the one path
  const seedOf = (coord) => String((_lib.find((t) => t.coord === coord) || {}).snippet || '(empty tile)').replace(/\s+/g, ' ').trim();
  const meaning = {}; for (const a of _lib) if (a && a.coord) meaning[a.coord] = String(a.snippet || a.seed || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].slice(0, 110);

  let cole = null, rawGrids = null, shortlex = null, pixelStatementHtml = '', diagTiles = null, pixelCell = null;
  let tCole = 0, tIngest = null;
  try {
    const { simhash: sh, hamming: hd, SIG_BITS: SB, wordShingles: wsh } = await import('../../src/app/pmu-simulator/signature.mjs');
    const { claimify, salienceRank } = await import('./corpus-ingest.mjs');
    const nodeText = new Array(144).fill('');
    for (let a = 0; a < 144; a++) nodeText[a] = String((_lib.find((t) => t.coord === COORDS[a]) || {}).snippet || '');
    const libSha = createHash('sha256').update(nodeText.join(' ')).digest('hex').slice(0, 12);
    const PAIR_CACHE = pairCachePath(REPO, libSha);   // C1373: the dir is created first — a cold install has no .thetacog/cache/
    let pairSigs;
    if (existsSync(PAIR_CACHE)) {
      pairSigs = JSON.parse(readFileSync(PAIR_CACHE, 'utf8')).map(BigInt);
    } else {
      pairSigs = new Array(20736);
      for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) pairSigs[i * 144 + j] = sh(`${nodeText[i]} ${nodeText[j]}`, SB, wsh);
      try { writeFileSync(PAIR_CACHE, JSON.stringify(pairSigs.map(String))); } catch { /* cache best-effort */ }
    }
    // ── senseDecompose: directional 20,736-cell sensor decision (commit-triptych:317-333) ──
    const tIn0 = Date.now();
    const senseDecompose = (text) => {
      const claims = salienceRank(claimify(String(text || ''))).slice(0, 160);
      // DEGENERATE-TEXT GUARD (trigger-battery catch, 2026-08-14 — restored 2026-09-17 after the
      // ghost-read-matrix branch's corpus + battery script were reintroduced without this 7-line
      // companion fix from the SAME source commit, 213e83db03): single-token repetition ('the the
      // the…') FLOODS similarity mass — high lit count, zero meaning — and sailed past the
      // lit-mass floor at 34% off-lane on run one. Degenerate text produces NO grid: fewer than
      // 8 unique tokens -> zero grid -> masses 0 -> the floor refuses downstream. Repetition
      // is noise wearing mass; the floor measures diversity-bearing mass only.
      const _uniq = new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)).size;
      if (_uniq < 8) return { grid: new Uint8Array(20736), lit: 0 };
      const claimSigs = claims.map((c) => sh(c, SB, wsh));
      const score = new Float32Array(20736);
      for (const cs of claimSigs) for (let k = 0; k < 20736; k++) { const v = 1 - hd(cs, pairSigs[k]) / SB; if (v > score[k]) score[k] = v; }
      const sorted = Float32Array.from(score).sort().reverse();
      const TARGET = 900;
      const theta = Math.max(0.56, sorted[Math.min(TARGET, sorted.length - 1)] || 0.56);
      const g = new Uint8Array(20736); let lit = 0;
      for (let k = 0; k < 20736; k++) if (score[k] >= theta && score[k] > 0) { g[k] = 1; lit++; }
      return { grid: g, score, lit, theta, claims: claims.length };
    };
    // C610k: the ncd arm reads the xor stage's own bits (MSB-first, main.rs pack_bitmap_b64) — no claim, no simhash.
    const xorGrid = (b64) => { const bytes = Buffer.from(String(b64 || ''), 'base64'); const g = new Uint8Array(20736); let lit = 0; for (let i = 0; i < 20736; i++) if (bytes[i >> 3] & (1 << (7 - (i & 7)))) { g[i] = 1; lit++; } return { grid: g, lit, theta: null, claims: null }; };
    // C612b: the claim arm's score loop (claims × 20,736 hamming) runs in the crate (pmu-onchip --door-serve, door.rs sense) — the
    // claims, the simhash and the degenerate guard stay here; the crate returns the same f32 scores, θ and grid. Any crate error, or
    // PMU_DOOR_CRATE=0, takes senseDecompose above (the reference the guard holds the crate to).
    const senseClaimBoth = async (texts) => {
      if (!DC.crateEnabled() || !existsSync(PAIR_CACHE)) { engines.sense = 'node'; return texts.map(senseDecompose); }
      try {
        const prep = texts.map((text) => {
          const _uniq = new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)).size;
          if (_uniq < 8) return { degenerate: true };
          const claims = salienceRank(claimify(String(text || ''))).slice(0, 160);
          return { claims: claims.length, sigs: claims.map((c) => sh(c, SB, wsh)) };
        });
        const live = prep.filter((q) => !q.degenerate);
        const got = live.length ? await DC.senseCrate({ pairsPath: PAIR_CACHE, sides: live.map((q) => q.sigs), target: 900, floor: 0.56, stamp: sealed }) : [];
        if (got.stamp) sealed = got.stamp;
        let k = 0;
        return prep.map((q) => q.degenerate ? { grid: new Uint8Array(20736), lit: 0 } : (({ score, grid, lit, theta }) => ({ grid, score, lit, theta, claims: q.claims }))(got[k++]));
      } catch (e) { DC.noteFallback('sense', e); engines.sense = 'node'; return texts.map(senseDecompose); }
    };
    const [senseI, senseR] = sensor === 'ncd' ? [xorGrid(x.intent_bitmap_b64), xorGrid(x.reality_bitmap_b64)] : await senseClaimBoth([intentText, realityText]);
    if (sensor === 'ncd') meta.sensor = 'ncd';
    tIngest = Date.now() - tIn0;
    meta.senseI = { lit: senseI.lit, theta: senseI.theta, claims: senseI.claims };
    meta.senseR = { lit: senseR.lit, theta: senseR.theta, claims: senseR.claims };
    const intentGrid = senseI.grid, realityGrid = senseR.grid;
    rawGrids = { intent: intentGrid, reality: realityGrid };

    // ── competence pixel: sensed argmax actor∩patient (commit-triptych:345-364) ──
    let startPixel, patientPixel = 0, pixGrip = -1;
    if (sensor === 'ncd') {
      // C610k: the ncd grid carries bits, not scores, and each side lights its OWN anchor block (the xor stage is a
      // k×k outer product of that side's anchors), so an ingress drawn from the intent alone reaches nothing on a
      // reality whose anchors differ — measured on the five frozen panels: 4 of 5 refused at reality 0. The ncd ingress
      // is therefore the PAIR, one seed per side, handed to BOTH walks alike (the comparison stays one ingress): actor =
      // lens.rs top_seeds over the intent's lit count per anchor row (the rule C610a/b/h walk the xor grid with),
      // patient = the same rule over the reality grid (the intent's actor when the reality lights no row).
      // pixGrip is the actor→patient cell's bit on the intent grid.
      startPixel = topSeeds(anchorScores(intentGrid), 1)[0] ?? 0;
      patientPixel = topSeeds(anchorScores(realityGrid), 1)[0] ?? startPixel;
      pixGrip = intentGrid[startPixel * 144 + patientPixel] ? 1 : 0;
    } else {
      let pix = 0, pixScore = -1;
      for (let k2 = 0; k2 < 20736; k2++) if (senseI.score[k2] > pixScore) { pixScore = senseI.score[k2]; pix = k2; }
      const topCells = [...senseI.score.keys()].sort((a, b) => senseI.score[b] - senseI.score[a]).slice(0, 8);
      const actorMass = new Map(); for (const c of topCells) { const a = Math.floor(c / 144); actorMass.set(a, (actorMass.get(a) || 0) + senseI.score[c]); }
      const startPick = pickStartPixel([...actorMass.keys()], (a) => actorMass.get(a) || 0, { iters: 50, damping: 0.85 });
      startPixel = startPick.start;
      for (let j = 0; j < 144; j++) { const v = senseI.score[startPixel * 144 + j]; if (v > pixGrip) { pixGrip = v; patientPixel = j; } }
    }
    const startRow = Math.floor(startPixel / 12);
    pixelCell = startPixel * 144 + patientPixel;
    Object.assign(meta, { startPixel, patientPixel, pixGrip: +pixGrip.toFixed(3), actorCoord: COORDS[startPixel], patientCoord: COORDS[patientPixel] });

    // ── the leaf/definer ballistic walk ON CHIP, both sides + matchSigma (commit-triptych:370-407) ──
    // bounded for the interactive npx path: fewer impostors + a smaller per-walk budget than the
    // detached email path (which can afford 12 × 2.5s). Speed is a correctness signal — stay on chip.
    const leafWalk = (grid) => definerWalk144([startPixel, patientPixel], { gridBits: grid, maxDepth: WALK_KNOBS.maxDepth, topK, decay, budget: WALK_KNOBS.budget, budgetMs });
    // C612b: all ten walks (both sides + the impostor shuffles) in ONE crate call — door.rs walks → lens.rs definer_walk, the same walk
    // definerWalk144 spawns once per grid. The shuffles depend only on the reality grid, so they are drawn first, in the same PRNG
    // order as before; a crate error (or PMU_DOOR_CRATE=0) walks them one by one through definerWalk144, the reference path.
    const cosine = (a, b) => { let dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return (na && nb) ? dot / Math.sqrt(na * nb) : 0; };
    const shapeOverlap = (a, b) => cosine(a.matrix, b.matrix);
    // matchSigma's null MUST be deterministic — a z-score built on Math.random is neither recomputable
    // (the product's whole pitch) nor a real null at n=2 (the −1.3 bug). Seed a PRNG from the grid so the
    // same input yields byte-identical matchSigma, and floor the impostor count to a defensible N.
    // (2026-07-11 — the critic's fix; guarded by tests/pmu/matchsigma-deterministic.test.mjs.)
    let _seed = 2166136261 >>> 0; for (let i = 0; i < realityGrid.length; i++) { _seed ^= realityGrid[i]; _seed = Math.imul(_seed, 16777619) >>> 0; }
    const _rng = () => { _seed |= 0; _seed = _seed + 0x6D2B79F5 | 0; let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const shuffle = (g) => { const a = Uint8Array.from(g); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(_rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    const impGrids = Array.from({ length: Math.max(8, impostors) }, () => shuffle(realityGrid));
    const tc0 = Date.now();
    let walked = null;
    if (DC.crateEnabled()) { try { walked = await DC.walksCrate([startPixel, patientPixel], [intentGrid, realityGrid, ...impGrids], { maxDepth: WALK_KNOBS.maxDepth, topK, decay, budget: WALK_KNOBS.budget, budgetMs, stamp: sealed, lib: libPath, kill: killTolerancePct }); if (walked.stamp) sealed = walked.stamp; } catch (e) { DC.noteFallback('walks', e); walked = null; } }
    if (!walked) { engines.walks = 'node'; walked = [...await Promise.all([leafWalk(intentGrid), leafWalk(realityGrid)]), ...await Promise.all(impGrids.map((g) => leafWalk(g)))]; }
    const [it, rt, ...impWalks] = walked;
    tCole = Date.now() - tc0;   // C612b: the time of every walk this panel ran (both sides + the null), one call on the crate path
    const actual = shapeOverlap(it, rt);
    const imps = impWalks.map((iw) => shapeOverlap(it, iw));
    const mu = imps.reduce((s, v) => s + v, 0) / imps.length;
    const sd = Math.sqrt(imps.reduce((s, v) => s + (v - mu) ** 2, 0) / imps.length);
    const matchSigma = sd ? (actual - mu) / sd : 0;
    const cellsOf = (wlk) => wlk.matrix.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
    cole = { intent: it, reality: rt, startPixel, startRow, pixelCell, hops: it.hops + rt.hops, maxPly: Math.max(it.maxPly, rt.maxPly), matchSigma: +matchSigma.toFixed(2), actualMatch: +actual.toFixed(4), impMean: +mu.toFixed(3), intentCells: cellsOf(it), realityCells: cellsOf(rt) };
    meta.matchSigma = cole.matchSigma;
    meta.walkMode = 'ballistic-edges';
    // RECOMPUTABILITY OF THE WALK σ (2026-07-13). The impostor NULL was made deterministic in July
    // (seeded PRNG, above) — but every walk feeding this σ is ALSO bounded by wall-clock (budgetMs).
    // If that valve fires on any of the 10 walks, the σ is machine-load-dependent and must NOT be
    // presented as byte-identical. Observed: the demo's σ moved 9.5 → 9.6 across three runs while
    // printing "byte-identical every run" beside it. Surface the truth instead of asserting it.
    meta.walkSigmaRecomputable = !(it.timeBudgetTripped || rt.timeBudgetTripped || impWalks.some((w) => w.timeBudgetTripped));
    // IMPOSTOR-NULL INSTRUMENTATION (Marsh read, 2026-08-13): the σ's exposure runs through the
    // NULL, not the measured walks — at 200ms both walks sat converged while σ read 7.67 vs 7.63,
    // because the eight shuffles were the thing the wall clock truncated. A budget audit watching
    // only the walks reports all-clear while σ drifts underneath. So the null reports itself:
    // exhausted = shuffles that hit the wall clock; sigmaSd = the spread σ stands on (sd 0 means
    // the divide-by-zero fallback — a σ of 0 that is a fallback, not a measurement).
    meta.impostorNull = { n: impWalks.length, exhausted: impWalks.filter((w) => w.timeBudgetTripped).length, sigmaMu: +mu.toFixed(4), sigmaSd: +sd.toFixed(4), degenerate: sd === 0 };

    // ── the competence-pixel statement (commit-triptych:471-476) ──
    pixelStatementHtml = `<div style="margin:-6px 0 16px;padding:11px 13px;background:#0a1018;border:1px solid #1a2a3a;border-left:3px solid #ff50c8;border-radius:6px;font-size:12px;line-height:1.6;text-align:left">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#ff8ad8;text-transform:uppercase;margin-bottom:6px">◎ the pixel this work belongs to</div>
<div style="color:#c9d1d9"><b style="color:#ff8ad8">${COORDS[startPixel]}</b> — ${tileWords(COORDS[startPixel])} (actor) acting on <b style="color:#ff8ad8">${COORDS[patientPixel]}</b> — ${tileWords(COORDS[patientPixel])} (patient) · grip ${pixGrip.toFixed(3)}</div>
<div style="margin-top:7px;color:#8b98a5"><b style="color:#66fcf1">actor seed ${COORDS[startPixel]}</b> — ${esc(seedOf(COORDS[startPixel]))}</div>
<div style="margin-top:5px;color:#8b98a5"><b style="color:#fbbf24">patient seed ${COORDS[patientPixel]}</b> — ${esc(seedOf(COORDS[patientPixel]))}</div>
</div>`;

    // ── the diagonal tile dump (commit-triptych:255-262) ──
    const SENSE = S.sense || {};
    const icm = SENSE.intent_claim_map || {}, rcm = SENSE.reality_claim_map || {};
    const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    diagTiles = AX12.map((a) => { const coord = `${a},${a}`, ic = icm[coord] || {}, rc = rcm[coord] || {};
      return { coord, meaning: meaning[coord] || '', intent: clip(ic.claim, 95), intentSim: Math.round((ic.frag_sim ?? ic.assign_sim ?? 0) * 100), reality: clip(rc.claim, 95), realitySim: Math.round((rc.frag_sim ?? rc.assign_sim ?? 0) * 100) }; });

    // ── the SHORTLEX-3 projection row (commit-triptych:484-503) — degrades to a note ──
    if (withShortlex) try {
      const { shortlexLattice, zoneOccupancy, defaultSigOf } = await import('./shortlex-project.mjs');
      const { loadRegistry, REGISTRY_PATH } = await import('./shortlex-registry.mjs');
      const CAND_PATH = resolve(REPO, 'data/pmu/shortlex-children-candidate.json');
      if (!existsSync(REGISTRY_PATH)) throw new Error('registry missing');
      if (!existsSync(CAND_PATH)) throw new Error('candidate children missing');
      const slReg = loadRegistry();
      const slSigOf = defaultSigOf();
      const claimsOf = (t) => salienceRank(claimify(String(t || ''))).slice(0, 160);
      const tSl = Date.now();
      const lat = shortlexLattice({ registry: slReg, sigOf: slSigOf, intentClaims: claimsOf(intentText), realityClaims: claimsOf(realityText) });
      const slMs = Date.now() - tSl;
      const zi = zoneOccupancy(lat.intentGrid, slReg), zr = zoneOccupancy(lat.realityGrid, slReg);
      shortlex = { intentGrid: lat.intentGrid, realityGrid: lat.realityGrid, registry: slReg, zi, zr, ms: slMs, intentMeta: lat.intent, realityMeta: lat.reality };
    } catch (e) {
      shortlex = { note: String(e.message || e).slice(0, 140) };
    }
  } catch (e) {
    // the heavy ballistic path failed (unbuilt daemon, thin corpus, missing sensor dep) — degrade
    // HONESTLY to the coarse heatmap tolerance; the report states which path ran (walkMode).
    meta.note = String(e?.message || e).slice(0, 160);
  }

  meta.timings = { ingest: tIngest, walk: tCole || null, total: pipelineMs + tCole };
  // ── C1411 S3 THE ADMISSION — the crate reads the spec's own positive and negative legs and seals spec_separation ──────────────
  // Each leg is this same function on (spec, declared text), stamped as a leg by the entry and sealed by the same sense and walks; the
  // crate binds each to the spec and to its declared text, reads the verdict it sealed, and answers SEPARATED / SPEC_INSUFFICIENT /
  // PLACEMENT_ONLY in the reading's stamp. Node decides nothing: no declared text, no leg; a crate error leaves the stamp unadmitted,
  // which verify refuses. Legs are held per (role, spec, text, knobs) for the life of the process — the crate's own sealed answer.
  if (!_leg && DC.crateEnabled() && sealed && !sealed.below_floor) {
    try {
      const decl = spec || await declaredSpec(intentText);
      const legs = {};
      for (const role of ['positive', 'negative']) {
        const text = decl && typeof decl[role] === 'string' ? decl[role] : null;
        if (text == null) continue;
        const key = JSON.stringify([role, intentText, text, REPO, libPath, killTolerancePct, impostors, budgetMs, topK, decay, sensor]);
        if (!LEGS.has(key)) {
          if (LEGS.size >= 64) LEGS.delete(LEGS.keys().next().value);
          LEGS.set(key, buildTriptychInputs({ intentText, realityText: text, repoRoot: REPO, killTolerancePct, sigmaType, impostors, budgetMs, topK, decay, axesPath, sensor, withShortlex: false, _leg: role }).then((r) => r.stamp || null));
        }
        legs[role] = { text, stamp: await LEGS.get(key) };
      }
      const a = await DC.admitCrate({ stamp: sealed, ...legs });
      if (a && a.stamp) sealed = a.stamp;
      meta.specSeparation = a ? a.spec_separation : null;
    } catch (e) { meta.specSeparation = null; meta.admission = `no crate admission: ${String(e?.message || e).slice(0, 140)} — unadmitted, never a verdict`; }
  }
  // C1406: the stamp is the crate's, relayed as the last stage sealed it. A node answer anywhere (PMU_DOOR_CRATE=0, a crate error, no pair
  // cache) leaves that stage off the stamp, and the heavy path failing outright leaves both off, so verify (door.rs verify_reason) refuses
  // it by construction. Which engine answered each stage is meta, beside the stamp, never in it.
  const stamp = sealed;
  meta.stamp = stamp;
  meta.engines = engines;

  // C1409: PMU_DOOR_CRATE=0 runs the node REFERENCE sense and walk (the path c612b/c612r hold the crate equal to); it draws, and it
  // reads UNMEASURED at the entry — a node walk is not a reading (rust only). Its stamp carries no crate sense or walk stage either.
  const nodeRef = !DC.crateEnabled();
  if (nodeRef) meta.unmeasured = 'PMU_DOOR_CRATE=0: the node reference walk draws, but a node walk is not a reading (rust only); UNMEASURED';
  return {
    state: nodeRef ? 'UNMEASURED' : stamp.below_floor ? 'BELOW_FLOOR' : 'MEASURED', refused: false, stamp, floor: entry.floor, ...(nodeRef ? { reason: meta.unmeasured } : {}),
    renderArgs: {
      intentB64, realityB64, frictionB64, domBlocks,
      cole, rawGrids, shortlex, pixelStatementHtml, pixelCell,
      tiles: diagTiles || [], sigmaType,
      timings: meta.timings, stamp,
    },
    meta,
  };
}
