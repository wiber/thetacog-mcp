#!/usr/bin/env node
// scripts/pmu/pipeline.mjs
//
// SYMMETRICAL PHYSICS — XOR → ClaudBridge: unified pipeline driver.
//
// Implements the S≡P≡H (Semantic ≡ Physical ≡ Hardware) mandate.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sealReceipt, sha256Hex } from './receipt-crypto.mjs';
import {
  loadAxes, loadState, loadTiles, writeRunReceipt, resolveSnippet, saveState
} from './pipeline-state.mjs';
import { ingestIntent, ingestReality } from './corpus-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const STAGE_ORDER = ['resolve', 'invariants', 'sense', 'sigma', 'binarize', 'project', 'xor', 'walk', 'claudbridge'];
const SHORTLEX_RANKS = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

function round(n, d) { const p = 10 ** d; return Math.round(n * p) / p; }
function avg(arr) {
  if (!arr.length) return 0;
  return round(arr.reduce((a, b) => a + b, 0) / arr.length, 4);
}

function gzipLen(s) { return gzipSync(Buffer.from(s, 'utf8')).length; }

function ncdSim(za, a, snippet) {
  const zb = gzipLen(snippet);
  const zab = gzipLen(`${a}\n${snippet}`);
  const ncd = (zab - Math.min(za, zb)) / Math.max(za, zb);
  return Math.max(0, 1 - ncd);
}

function calcSigma(scores) {
  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted[0];
  const rest = sorted.slice(1);
  const mean = rest.reduce((a, b) => a + b, 0) / (rest.length || 1);
  const variance = rest.reduce((a, b) => a + (b - mean) ** 2, 0) / (rest.length || 1);
  const std = Math.sqrt(variance);
  return { top, mean, std, sigma: std > 0 ? (top - mean) / std : 0 };
}

function getSortedAnchors(raw) {
  const sorted = [];
  for (const r1 of SHORTLEX_RANKS) {
    for (const r2 of SHORTLEX_RANKS) {
      const entry = raw.find(a => a.row === r1 && a.col === r2);
      if (entry) sorted.push(entry);
    }
  }
  return sorted;
}

function xorGrids(a, b) {
  const N = a.length;
  const out = new Uint8Array(N);
  let diff = 0;
  for (let i = 0; i < N; i++) {
    if (a[i] !== b[i]) { out[i] = 1; diff++; }
  }
  return { delta: out, diff };
}

function packBitmapB64(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return Buffer.from(bytes).toString('base64');
}

// senseOnChip — push the 144-anchor sense onto the Rust daemon.
//
// Returns the dual-witness verdict per anchor: `scores` (PRIMARY = SimHash,
// the discriminative AC⁰ witness), `ncd_scores` (secondary gzip-NCD),
// `best_idx` (claim fragment matched), `agreement` (both witnesses agree on
// the fragment). This replaces the old in-JS gzip-NCD loop that (a) cost ~3s
// of zlib and (b) was degenerate — flat NCD couldn't separate the 144 axes.
function senseOnChip(claims, targets, targetLens, simhashOnly = false) {
  const daemonPath = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');
  const out = execSync(`"${daemonPath}" --sense`, {
    input: JSON.stringify({ claims, targets, target_lens: targetLens, simhash_only: simhashOnly }),
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024
  });
  return JSON.parse(out);
}

// binarizeByThreshold — light the anchors that clear a threshold on the
// primary witness score. Honours the dashboard `threshold` control instead
// of the old hardcoded `const k = 3` that capped every run at 3 lit nodes.
//
// Accepted forms:
//   "top-N"   → the N highest-scoring anchors        (e.g. "top-12")
//   "Nσ"|"Ns" → mean + N standard deviations          (e.g. "1.5σ", "2s")
//   "0.NN"    → an absolute score floor               (e.g. "0.85")
//   null/"auto" → default: mean + 1σ (statistically-present anchors)
export function binarizeByThreshold(scores, thresholdStr) {
  const n = scores.length;
  const mean = scores.reduce((a, b) => a + b, 0) / (n || 1);
  const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n || 1));
  const bits = new Uint8Array(n);
  let method, cutoff;

  const s = (thresholdStr == null ? 'auto' : String(thresholdStr)).trim().toLowerCase();
  let m;
  if ((m = s.match(/^top-?(\d+)$/))) {
    const k = Math.min(parseInt(m[1], 10), n);
    const ranked = scores.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, k);
    for (const r of ranked) bits[r.i] = 1;
    cutoff = ranked.length ? ranked[ranked.length - 1].v : 1;
    method = `top-${k}`;
  } else if ((m = s.match(/^([\d.]+)\s*(σ|s|sigma)$/))) {
    const nsig = parseFloat(m[1]);
    cutoff = mean + nsig * std;
    for (let i = 0; i < n; i++) if (scores[i] >= cutoff) bits[i] = 1;
    method = `${nsig}σ`;
  } else if ((m = s.match(/^(0?\.\d+|[01](?:\.\d+)?)$/))) {
    cutoff = parseFloat(m[1]);
    for (let i = 0; i < n; i++) if (scores[i] >= cutoff) bits[i] = 1;
    method = `floor ${cutoff}`;
  } else {
    cutoff = mean + std; // auto = mean + 1σ
    for (let i = 0; i < n; i++) if (scores[i] >= cutoff) bits[i] = 1;
    method = '1σ (auto)';
  }
  return { bits, method, cutoff, lit: bits.reduce((a, b) => a + b, 0), mean, std };
}

async function runHardwareProjectXor(intentBits, realityBits) {
  const daemonPath = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');
  const input = {
    intent_bits: Array.from(intentBits),
    reality_bits: Array.from(realityBits)
  };
  const child = execSync(`"${daemonPath}" --project-xor`, {
    input: JSON.stringify(input),
    encoding: 'utf8'
  });
  return JSON.parse(child);
}

async function runHardwareWalk(gridB64, decay = 0.6, depth = 5, mode = 'traversal') {
  const daemonPath = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');
  const input = { grid_b64: gridB64, decay, depth, mode };
  const child = execSync(`"${daemonPath}" --walk`, {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024
  });
  return JSON.parse(child);
}

// ── intermediate vectors — persisted so stages can re-run piecemeal ──────────
// The score/bit/bitmap state from the last full run. runPartial() reloads this
// to re-threshold (binarize), re-XOR, or re-walk WITHOUT re-reading disk or
// re-sensing — the "tweak a parameter and watch the cloud shift" control plane.
const VEC_PATH = resolve(REPO_ROOT, 'data/pmu/pipeline/cache/vectors.json');
function saveVectors(v) {
  // ATOMIC WRITE (2026-06-15): the post-commit hook runs ~8 pipelines at once, all sharing this cache.
  // A plain writeFileSync truncates-then-writes, so a concurrent reader can catch the file EMPTY mid-
  // write → degenerate all-zero heat → the drift email's grid renders blank. Write to a per-process
  // temp file then rename() — atomic on POSIX, so a reader sees the whole old or whole new file, never
  // a partial. (Pairs with the empty-read retry loop in commit-triptych.mjs.)
  try {
    mkdirSync(dirname(VEC_PATH), { recursive: true });
    const tmp = `${VEC_PATH}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(v));
    renameSync(tmp, VEC_PATH);
  } catch { /* best-effort cache */ }
}
function loadVectors() {
  try { return JSON.parse(readFileSync(VEC_PATH, 'utf8')); } catch { return null; }
}

// computeWalk — the ballistic-walk POV. Walk the intent and reality grids on
// the chip, read the two heat clouds back, derive their cosine agreement and
// the dignity pixel (heaviest cell of the reality cloud). Shared by the full
// pipeline and runPartial('walk') so both produce an identical walk record.
async function computeWalk(anchors, intentB64, realityB64, mode = 'traversal') {
  const walkR = await runHardwareWalk(realityB64, 0.6, 5, mode);
  const walkI = await runHardwareWalk(intentB64, 0.6, 5, mode);
  const bufR = Buffer.from(walkR.heatmap_b64, 'base64');
  const f32R = new Float32Array(bufR.buffer, bufR.byteOffset, bufR.length / 4);
  const bufI = Buffer.from(walkI.heatmap_b64, 'base64');
  const f32I = new Float32Array(bufI.buffer, bufI.byteOffset, bufI.length / 4);
  let dot = 0, nR = 0, nI = 0, maxW = -1, dignityIdx = -1;
  for (let i = 0; i < f32R.length; i++) {
    dot += f32R[i] * f32I[i]; nR += f32R[i] * f32R[i]; nI += f32I[i] * f32I[i];
    if (f32R[i] > maxW) { maxW = f32R[i]; dignityIdx = i; }
  }
  const agreement = (nR > 0 && nI > 0) ? dot / (Math.sqrt(nR) * Math.sqrt(nI)) : 0;
  const rowIdx = Math.floor(dignityIdx / 144), colIdx = dignityIdx % 144;
  const dignityCoord = dignityIdx >= 0 ? `${anchors[rowIdx].coord} ⊕ ${anchors[colIdx].coord}` : 'none';

  // The ballistic POV: the topological difference of the two heat clouds.
  // |intent_heat − reality_heat| per cell — a GRADED divergence field that
  // smooths the residual compression noise the sparse binary XOR cannot. This
  // is the operator's "heat map of differences between perspectives"; the
  // binary XOR remains the sharp, sealable AIR signal for the cloudbridge.
  const delta = new Float32Array(f32R.length);
  let deltaEnergy = 0, divPeak = 0, divIdx = -1;
  for (let i = 0; i < f32R.length; i++) {
    const d = Math.abs(f32I[i] - f32R[i]);
    delta[i] = d; deltaEnergy += d;
    if (d > divPeak) { divPeak = d; divIdx = i; }
  }
  const totalEnergy = Math.sqrt(nR) + Math.sqrt(nI);
  const divRow = Math.floor(divIdx / 144), divCol = divIdx % 144;
  const divCoord = divIdx >= 0 ? `${anchors[divRow].coord} ⊕ ${anchors[divCol].coord}` : 'none';

  return {
    reality_heatmap_b64: walkR.heatmap_b64,
    intent_heatmap_b64: walkI.heatmap_b64,
    delta_heatmap_b64: Buffer.from(delta.buffer, delta.byteOffset, delta.byteLength).toString('base64'),
    reality_lit_nodes: walkR.lit_nodes,
    intent_lit_nodes: walkI.lit_nodes,
    agreement_pct: round(agreement * 100, 2),
    divergence_pct: totalEnergy > 0 ? round((deltaEnergy / (totalEnergy * 144)) * 100, 2) : 0,
    divergence_pixel: divCoord,
    dignity_pixel: dignityCoord,
    dignity_row: anchors[rowIdx]?.row || null,
    engine: 'rust-ballistic-walk',
    walk_mode: mode
  };
}

// ── pipeline ────────────────────────────────────────────────────────────────
export async function runPipeline(opts = {}) {
  const state = loadState();
  const rawAnchors = loadAxes(); 
  const anchors = getSortedAnchors(rawAnchors);
  const sigmaFloor = state.sigma_floor ?? 3.4;
  const stopAfter = opts.stopAfter || null; 
  const claudbridgeUrl = opts.claudbridgeUrl || process.env.CLAUDBRIDGE_URL || 'http://localhost:7777';

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const stages = {};
  const t0 = performance.now();

  function record(name, payload) {
    const t = performance.now() - t0;
    stages[name] = { ok: true, elapsed_ms: Math.round(t * 100) / 100, ...payload };
    return stages[name];
  }
  function fail(name, err) {
    stages[name] = { ok: false, error: String(err?.message || err) };
    return stages[name];
  }
  function shouldStop(name) { return stopAfter && name === stopAfter; }

// ── 1. RESOLVE — Ingest symmetrical corpora
// [INTENT: C2.Operations.Loop] Maintain unmediated contact with the repository's changing reality.
// [REALITY: corpus-ingest.mjs] Recursively crawls docs/ and src/, ranking by salience to fit in Gzip window.
let intentCorpus, realityCorpus;
try {
  // COMMIT-SCOPED override: when opts.intentText/realityText are supplied (the on-commit dogfood
  // feeds the commit's message+docs as intent and its changed files as reality), use them instead
  // of the whole-repo ingest — same walk+xor machinery, but fast and scoped to THIS commit.
  if (opts.intentText != null || opts.realityText != null) {
    intentCorpus = String(opts.intentText || '');
    realityCorpus = String(opts.realityText || '');
    record('resolve', {
      intent:  { kind: 'commit', value: opts.intentLabel || 'commit-intent', len: intentCorpus.length },
      reality: { kind: 'commit', value: opts.realityLabel || 'commit-reality', len: realityCorpus.length },
      warm: false, scoped: true
    });
  } else {
    const ri = ingestIntent(REPO_ROOT);
    const rr = ingestReality(REPO_ROOT);
    intentCorpus = ri.text;
    realityCorpus = rr.text;
    record('resolve', {
      intent:  { kind: 'mass', value: 'docs/', len: intentCorpus.length, cached: ri.cached, files: ri.files, ms: ri.ms },
      reality: { kind: 'mass', value: 'src/',  len: realityCorpus.length, cached: rr.cached, files: rr.files, ms: rr.ms },
      warm: ri.cached && rr.cached
    });
  }
} catch (e) { fail('resolve', e); return finalize(); }
if (shouldStop('resolve')) return finalize();

// ── 1.5 INVARIANTS — the coordinates-don't-lie gate (runtime, not just audit)
// Records each structural check so the dashboard's System Health panel and the
// architecture audit read a verified witness, not an assumption. A failed check
// surfaces red but does not hard-block (a scramble should be loud, not silent).
try {
  const checks = [];
  let aligned = true, bad = null;
  for (const r1 of SHORTLEX_RANKS) {
    for (const r2 of SHORTLEX_RANKS) {
      if (!rawAnchors.find(a => a.row === r1 && a.col === r2)) { aligned = false; bad = `${r1},${r2}`; break; }
    }
    if (!aligned) break;
  }
  checks.push({ name: '144 anchors ShortLex-aligned', ok: aligned, detail: aligned ? 'A,B,C,A1…C3,C3' : `missing ${bad}` });
  checks.push({ name: 'anchor count = 144', ok: anchors.length === 144, detail: `${anchors.length}` });
  checks.push({ name: 'intent corpus non-empty', ok: intentCorpus.length > 0, detail: `${intentCorpus.length} chars` });
  checks.push({ name: 'reality corpus non-empty', ok: realityCorpus.length > 0, detail: `${realityCorpus.length} chars` });
  record('invariants', { checks, ok_count: checks.filter(c => c.ok).length, total: checks.length });
} catch (e) { fail('invariants', e); }
if (shouldStop('invariants')) return finalize();

// ── 2. SENSE — Dual-Witness Deconstruction (ON CHIP)
// [INTENT: A2.Strategy.Goal] Resolve high-resolution strategic coordinates from unstructured mass.
// [REALITY: rust-simhash] SimHash (popcount of the 64-bit signature XOR — the AC⁰ witness)
// is PRIMARY: it separates concepts on short fragments where gzip-NCD collapses to a flat,
// length-dominated band. gzip-NCD rides along as the secondary witness so the dual-witness
// agreement check (do both witnesses pick the same fragment?) still works. Both run in the
// Rust daemon under Rayon — the old in-JS zlib loop was ~3s of the ~5.8s wall time.
let intentBits, realityBits;
let intentScores, realityScores, realityClaimMap, intentClaimMap;
let binMethod, binCutoff, binMean, binStd;
  try {
    const targets = anchors.map(a => a.snippet);
    const targetLens = targets.map(s => gzipLen(s));
    const claimsI = intentCorpus.split('\n\n').filter(s => s.trim().length > 20);
    const claimsR = realityCorpus.split('\n\n').filter(s => s.trim().length > 20);

    const senseSide = (claims) => {
      const out = senseOnChip(claims, targets, targetLens); // {scores, ncd_scores, best_idx, agreement, claim_best_anchor, claim_best_score}
      // PRIMARY WITNESS = gzip-NCD (out.ncd_scores). The on-commit loop measured (rounds 4–6,
      // measure-lens-sigma + guard test) that gzip-NCD out-separates SimHash on SHORT claim fragments
      // at EVERY length — the May-28 SimHash-primary was the regression (it traced to the target_lens=1
      // bug that had made gzip look degenerate). gzip now drives BOTH the σ and the walk's lit anchors;
      // SimHash stays as the secondary/context witness (frag_sim, hover). Falls back to SimHash if
      // ncd_scores is absent or mis-sized. `state.primary_lens='simhash'` reverts.
      const lens = process.env.PMU_PRIMARY_LENS || state.primary_lens || 'gzip';
      const primary = (lens === 'gzip' && Array.isArray(out.ncd_scores) && out.ncd_scores.length === (out.scores?.length ?? 0)) ? out.ncd_scores : out.scores;
      // COMPETITIVE assignment: each claim votes for the anchor it matches best,
      // so claims spread across the lattice and the hover fragment is distinct
      // per node. (Anchor→best-claim alone let one generic claim own every node.)
      const claimMap = {};
      anchors.forEach((a, i) => {
        claimMap[a.coord] = {
          claim: '(no distinctive match)',
          frag_sim: out.scores?.[i] ?? 0,     // per-anchor primary witness (for context)
          ncd: out.ncd_scores?.[i] ?? 0,      // secondary witness — gzip-NCD
          witness_agree: !!(out.agreement?.[i]),
          assigned: false
        };
      });
      const cba = out.claim_best_anchor || [];
      const cbs = out.claim_best_score || [];
      cba.forEach((ai, j) => {
        const a = anchors[ai];
        if (!a) return;
        const cur = claimMap[a.coord];
        // keep the strongest claim that chose THIS anchor
        if (!cur.assigned || (cbs[j] ?? 0) > cur.assign_sim) {
          cur.claim = claims[j] || '(no match)';
          cur.assign_sim = cbs[j] ?? 0;
          cur.assigned = true;
        }
      });
      const distinct = new Set(Object.values(claimMap).filter(c => c.assigned).map(c => c.claim)).size;
      const bin = binarizeByThreshold(primary, state.threshold);
      return { scores: primary, simhashScores: out.scores, claimMap, bits: bin.bits, bin, agree: out.agreement || [], distinct };
    };

    const resI = senseSide(claimsI);
    const resR = senseSide(claimsR);

    intentBits = resI.bits;
    realityBits = resR.bits;
    intentScores = resI.scores;
    realityScores = resR.scores;
    intentClaimMap = resI.claimMap;
    realityClaimMap = resR.claimMap;
    binMethod = resR.bin.method; binCutoff = resR.bin.cutoff; binMean = resR.bin.mean; binStd = resR.bin.std;

    const top5 = realityScores.map((s, i) => ({ coord: anchors[i].coord, sim: s }))
      .sort((a, b) => b.sim - a.sim).slice(0, 5);

    record('sense', {
      nodes: anchors.length,
      engine: 'rust-onchip',
      primary_witness: (state.primary_lens || 'gzip') === 'gzip' ? 'gzip-ncd' : 'simhash',
      secondary_witness: (state.primary_lens || 'gzip') === 'gzip' ? 'simhash' : 'gzip-ncd',
      intent_diag_lit: intentBits.reduce((a, b) => a + b, 0),
      reality_diag_lit: realityBits.reduce((a, b) => a + b, 0),
      intent_witness_agree: resI.agree.filter(Boolean).length,
      reality_witness_agree: resR.agree.filter(Boolean).length,
      intent_distinct_fragments: resI.distinct,
      reality_distinct_fragments: resR.distinct,
      top5, mean: avg(realityScores),
      intent_lit_indices: Array.from(intentBits).map((b, i) => b ? i : -1).filter(i => i >= 0),
      reality_lit_indices: Array.from(realityBits).map((b, i) => b ? i : -1).filter(i => i >= 0),
      intent_claim_map: intentClaimMap,
      reality_claim_map: realityClaimMap
    });
  } catch (e) { fail('sense', e); return finalize(); }
  if (shouldStop('sense')) return finalize();

  // 3. SIGMA
  let sigmaInfo;
  try {
    sigmaInfo = calcSigma(Array.from(realityScores));
    record('sigma', {
      sigma: round(sigmaInfo.sigma, 4),
      top: round(sigmaInfo.top, 4),
      mean: round(sigmaInfo.mean, 4),
      std: round(sigmaInfo.std, 4),
      band: sigmaInfo.sigma >= sigmaFloor ? 'gold' : 'noise'
    });
  } catch (e) { fail('sigma', e); return finalize(); }
  if (shouldStop('sigma')) return finalize();

  // 4. BINARIZE — threshold-honouring (replaces the old hardcoded k=3 cap)
  record('binarize', {
    bits_lit: realityBits.reduce((a, b) => a + b, 0),
    bits_total: anchors.length,
    threshold: state.threshold ?? 'auto',
    method: binMethod,
    cutoff: round(binCutoff, 4),
    score_mean: round(binMean, 4),
    score_std: round(binStd, 4)
  });
  if (shouldStop('binarize')) return finalize();

  // 5. PROJECT & 6. XOR
  let hwResult;
  try {
    hwResult = await runHardwareProjectXor(intentBits, realityBits);
    record('project', {
      grid_size: '144x144',
      pixels_lit: hwResult.reality_bitmap_b64 ? 9 : 0, 
      grid_bitmap_b64: hwResult.reality_bitmap_b64,
      lit_axis_indices: Array.from(realityBits).map((b, i) => b ? i : -1).filter(i => i >= 0),
      engine: 'rust-hardware-logic'
    });
    record('xor', {
      friction_nodes: hwResult.friction_nodes,
      drift_pct: round((hwResult.friction_nodes / 20736) * 100, 3),
      intent_bitmap_b64: hwResult.intent_bitmap_b64,
      reality_bitmap_b64: hwResult.reality_bitmap_b64,
      friction_bitmap_b64: hwResult.friction_bitmap_b64,
      grid_size: 144,
      intent_lit_indices: Array.from(intentBits).map((b, i) => b ? i : -1).filter(i => i >= 0)
    });
  } catch (e) { fail('project', e); fail('xor', e); return finalize(); }

  // 6.5. WALK — the ballistic POV (shared with runPartial via computeWalk)
  try {
    record('walk', await computeWalk(anchors, hwResult.intent_bitmap_b64, hwResult.reality_bitmap_b64, state.walk_mode || 'traversal'));
  } catch (e) { fail('walk', e); }

  // Persist the intermediate vectors so binarize/xor/walk can re-run piecemeal
  // (runPartial) without re-reading disk or re-sensing.
  saveVectors({
    run_id: runId,
    threshold: state.threshold ?? 'auto',
    scores: { intent: intentScores, reality: realityScores },
    claim_maps: { intent: intentClaimMap, reality: realityClaimMap },
    bits: { intent: Array.from(intentBits), reality: Array.from(realityBits) },
    bitmaps: {
      intent_b64: hwResult.intent_bitmap_b64,
      reality_b64: hwResult.reality_bitmap_b64,
      friction_b64: hwResult.friction_bitmap_b64
    },
    friction_nodes: hwResult.friction_nodes
  });

  // 7. CLAUDBRIDGE
  try {
    const sealed = sealReceipt({
      run_id: runId,
      sigma: stages.sigma.sigma,
      friction_nodes: hwResult.friction_nodes,
      band: stages.sigma.band,
      agreement: stages.walk?.agreement_pct,
      dignity_pixel: stages.walk?.dignity_pixel,
      // REAL INPUT (operator 2026-06-15: "replace the generic placeholders with the real input hash").
      // Bind the sha256 of the ACTUAL corpus evaluated, not a 'docs/' descriptor — so the seal proves
      // WHICH input produced this measurement.
      intent: { kind: 'sha256', value: sha256Hex(opts.intentText || '') },
      reality: { kind: 'sha256', value: sha256Hex(opts.realityText || '') },
      at: startedAt
    });
    const res = await postToClaudBridge(claudbridgeUrl, sealed);
    record('claudbridge', {
      url: claudbridgeUrl, status: res.status, payload_sha: sealed.sha256
    });
  } catch (e) { fail('claudbridge', e); }

  return finalize();

  function finalize() {
    const endedAt = new Date().toISOString();
    const allOk = STAGE_ORDER.every(s => !stages[s] || stages[s].ok !== false);
    const receipt = { run_id: runId, started_at: startedAt, ended_at: endedAt, ok: allOk, stages };
    const path = writeRunReceipt(runId, receipt);
    receipt.path = path;
    return receipt;
  }
}

// ── runPartial — re-run only the pipeline tail, reusing persisted vectors ─────
//
// The modular control plane: tweak the threshold and re-`binarize`, recompute
// the lattices with `xor`, or re-`walk` with new decay — in tens of ms, without
// paying the full resolve(2.6s)+sense cost. Each `from` reuses everything before
// it from the last run's vectors. `from` outside {binarize,xor,walk} (or a cold
// store) falls back to a full warm-cached runPipeline. This is the same physics
// at a different granularity — the fractal the operator asked for.
export async function runPartial(from, opts = {}) {
  const FAST = { binarize: 0, xor: 1, walk: 2 };
  if (!(from in FAST)) return runPipeline(opts);

  const state = loadState();
  const anchors = getSortedAnchors(loadAxes());
  const claudbridgeUrl = opts.claudbridgeUrl || process.env.CLAUDBRIDGE_URL || 'http://localhost:7777';
  const vec = loadVectors();
  const prev = state.last_run;
  if (!vec || !prev?.stages) return runPipeline(opts); // nothing to resume from
  // Resolution-aware: the node-vectors partial would revert a CELL view to the
  // sparse node grid ("kills the heatmap"). If the displayed run is cell-res,
  // re-run cell resolution so re-binarize/re-walk stay dense + pick up the new
  // threshold — the convincing view is reproducible with the button.
  if (prev.resolution === '144x144') return runCellResolution(opts);

  const rank = FAST[from];
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const stages = JSON.parse(JSON.stringify(prev.stages)); // inherit the unchanged stages
  // Mark every inherited stage reused; record() overwrites the recomputed ones
  // with a fresh object (no reused flag) so the dashboard can show which stages
  // this partial run actually touched vs. carried forward.
  for (const s of Object.values(stages)) { if (s) s.reused = true; }
  const t0 = performance.now();
  const record = (name, payload) => { stages[name] = { ok: true, elapsed_ms: Math.round((performance.now() - t0) * 100) / 100, ...payload }; };
  const litIdx = (bits) => Array.from(bits).map((b, i) => b ? i : -1).filter(i => i >= 0);

  let intentBits = Uint8Array.from(vec.bits.intent);
  let realityBits = Uint8Array.from(vec.bits.reality);
  let bitmaps = vec.bitmaps;
  let frictionNodes = vec.friction_nodes;

  // BINARIZE — re-threshold the persisted scores (no re-sense, no disk)
  if (rank <= 0) {
    const binI = binarizeByThreshold(vec.scores.intent, state.threshold);
    const binR = binarizeByThreshold(vec.scores.reality, state.threshold);
    intentBits = binI.bits; realityBits = binR.bits;
    stages.sense = {
      ...stages.sense,
      intent_diag_lit: intentBits.reduce((a, b) => a + b, 0),
      reality_diag_lit: realityBits.reduce((a, b) => a + b, 0),
      intent_lit_indices: litIdx(intentBits),
      reality_lit_indices: litIdx(realityBits)
    };
    record('binarize', {
      bits_lit: realityBits.reduce((a, b) => a + b, 0), bits_total: anchors.length,
      threshold: state.threshold ?? 'auto', method: binR.method, cutoff: round(binR.cutoff, 4),
      score_mean: round(binR.mean, 4), score_std: round(binR.std, 4)
    });
  }

  // PROJECT + XOR — recompute the 144×144 lattices on the chip
  if (rank <= 1) {
    const hw = await runHardwareProjectXor(intentBits, realityBits);
    bitmaps = { intent_b64: hw.intent_bitmap_b64, reality_b64: hw.reality_bitmap_b64, friction_b64: hw.friction_bitmap_b64 };
    frictionNodes = hw.friction_nodes;
    record('project', { grid_size: '144x144', grid_bitmap_b64: hw.reality_bitmap_b64, lit_axis_indices: litIdx(realityBits), engine: 'rust-hardware-logic' });
    record('xor', { friction_nodes: hw.friction_nodes, drift_pct: round((hw.friction_nodes / 20736) * 100, 3), intent_bitmap_b64: hw.intent_bitmap_b64, reality_bitmap_b64: hw.reality_bitmap_b64, friction_bitmap_b64: hw.friction_bitmap_b64, grid_size: 144, intent_lit_indices: litIdx(intentBits) });
  }

  // WALK — always the tail of a partial run
  try { record('walk', await computeWalk(anchors, bitmaps.intent_b64, bitmaps.reality_b64, state.walk_mode || 'traversal')); }
  catch (e) { stages.walk = { ok: false, error: String(e?.message || e) }; }

  // re-seal + ship to the cloudbridge so the AIR receipt tracks the new state
  try {
    const sealed = sealReceipt({
      run_id: runId, sigma: stages.sigma?.sigma, friction_nodes: frictionNodes,
      band: stages.sigma?.band, agreement: stages.walk?.agreement_pct, dignity_pixel: stages.walk?.dignity_pixel,
      intent: { kind: 'sha256', value: sha256Hex(opts.intentText || '') }, reality: { kind: 'sha256', value: sha256Hex(opts.realityText || '') }, at: startedAt
    });
    const res = await postToClaudBridge(claudbridgeUrl, sealed);
    record('claudbridge', { url: claudbridgeUrl, status: res.status, payload_sha: sealed.sha256 });
  } catch (e) { stages.claudbridge = { ok: false, error: String(e?.message || e) }; }

  saveVectors({ ...vec, threshold: state.threshold ?? 'auto', bits: { intent: Array.from(intentBits), reality: Array.from(realityBits) }, bitmaps, friction_nodes: frictionNodes });
  const receipt = { run_id: runId, started_at: startedAt, ended_at: new Date().toISOString(), ok: Object.values(stages).every(s => s.ok !== false), partial_from: from, stages };
  const path = writeRunReceipt(runId, receipt);
  receipt.path = path;
  return receipt;
}

// ── runCellResolution — match claims against the full 144×144 (20,736 cells) ──
//
// The micro-resolution alternative to the 144-node canonical run. Instead of
// sensing the 144 nodes and deriving the lattice by outer product, it senses
// every interference CELL directly (SimHash-only — NCD is ~60s at this scale),
// binarises per cell, XORs the two cell grids directly, and walks them. Use it
// to inspect WHERE on the 144×144 a perspective concentrates, not just which
// nodes; the 144-node run remains the canonical dual-witness AIR.
export async function runCellResolution(opts = {}) {
  const state = loadState();
  const tiles = loadTiles();          // 20,736 interference-cell snippets
  const anchors = getSortedAnchors(loadAxes());
  const stages = {};
  const t0 = performance.now();
  const record = (name, payload) => { stages[name] = { ok: true, elapsed_ms: Math.round((performance.now() - t0) * 100) / 100, ...payload }; };
  const runId = `cell-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();

  const ri = ingestIntent(REPO_ROOT), rr = ingestReality(REPO_ROOT);
  record('resolve', { intent: { len: ri.text.length, cached: ri.cached }, reality: { len: rr.text.length, cached: rr.cached }, warm: ri.cached && rr.cached });
  const claimsI = ri.text.split('\n\n').filter(s => s.trim().length > 20);
  const claimsR = rr.text.split('\n\n').filter(s => s.trim().length > 20);

  const targets = tiles.map(t => t.snippet);
  const lens = targets.map(() => 1);
  const senseCell = (claims) => {
    // DUAL-WITNESS (2026-07-09, RPM 22): simhashOnly=false — gzip-NCD runs alongside SimHash on the
    // receipt path; a lone hash never again masquerades as the pinned witness. Guarded by
    // tests/pmu-simulator/receipt-dual-witness.test.mjs.
    const out = senseOnChip(claims, targets, lens, false); // SimHash + gzip-NCD
    const bin = binarizeByThreshold(out.scores, state.threshold);
    return { bits: bin.bits, bin, scores: out.scores };
  };
  const I = senseCell(claimsI), R = senseCell(claimsR);
  // top cell + mean so the dashboard SENSE blurb isn't "undefined" in cell mode
  let topI = 0; for (const v of R.scores) if (v > topI) topI = v;
  const cellMean = avg(R.scores);

  // Also compute the NODE-level claim maps (cheap dual-witness over 144 anchors)
  // so the 144-grid hover and the navigator still resolve intent/reality
  // fragments per node — otherwise a cell run leaves the hover empty.
  const nodeTargets = anchors.map(a => a.snippet);
  const nodeLens = nodeTargets.map(s => gzipLen(s));
  const nodeClaimMap = (claims) => {
    const out = senseOnChip(claims, nodeTargets, nodeLens, false);
    const map = {};
    anchors.forEach(a => { map[a.coord] = { claim: '(no distinctive match)', frag_sim: 0, assigned: false }; });
    (out.claim_best_anchor || []).forEach((ai, j) => {
      const a = anchors[ai]; if (!a) return;
      const cur = map[a.coord];
      if (!cur.assigned || (out.claim_best_score?.[j] ?? 0) > cur.assign_sim) {
        cur.claim = claims[j] || '(no match)'; cur.assign_sim = out.claim_best_score?.[j] ?? 0; cur.assigned = true;
      }
    });
    const distinct = new Set(Object.values(map).filter(c => c.assigned).map(c => c.claim)).size;
    return { map, distinct };
  };
  const nI = nodeClaimMap(claimsI), nR = nodeClaimMap(claimsR);

  record('sense', {
    engine: 'rust-simhash-onchip-cells', resolution: '144x144', primary_witness: 'simhash', cells: 20736,
    intent_cells_lit: I.bits.reduce((a, b) => a + b, 0), reality_cells_lit: R.bits.reduce((a, b) => a + b, 0), method: R.bin.method,
    top5: [{ coord: 'top-cell', sim: round(topI, 4) }], mean: cellMean,
    intent_claim_map: nI.map, reality_claim_map: nR.map,
    intent_distinct_fragments: nI.distinct, reality_distinct_fragments: nR.distinct
  });

  // Cell-res DOES binarize (per-cell σ-gate inside senseCell) — record it so the
  // top bar shows binarize ACTIVE, not skipped. (sigma/project/claudbridge are
  // genuinely not run in cell mode: no z-score, direct XOR not outer-product,
  // no seal — those stay skipped honestly.)
  record('binarize', {
    bits_lit: R.bits.reduce((a, b) => a + b, 0), bits_total: 20736,
    threshold: state.threshold ?? 'auto', method: R.bin.method, cutoff: round(R.bin.cutoff, 4),
    resolution: 'cells'
  });

  // Direct XOR of the two 20,736-cell grids — no outer product at cell res.
  let friction = 0; const fr = new Uint8Array(20736);
  for (let i = 0; i < 20736; i++) { if (I.bits[i] !== R.bits[i]) { fr[i] = 1; friction++; } }
  const intentB64 = packBitmapB64(I.bits), realityB64 = packBitmapB64(R.bits), frictionB64 = packBitmapB64(fr);
  record('xor', { friction_nodes: friction, drift_pct: round(friction / 20736 * 100, 3), grid_size: 144, intent_bitmap_b64: intentB64, reality_bitmap_b64: realityB64, friction_bitmap_b64: frictionB64 });

  try { record('walk', await computeWalk(anchors, intentB64, realityB64, state.walk_mode || 'traversal')); }
  catch (e) { stages.walk = { ok: false, error: String(e?.message || e) }; }

  const receipt = { run_id: runId, resolution: '144x144', started_at: startedAt, ended_at: new Date().toISOString(), ok: true, stages };
  writeRunReceipt(runId, receipt);
  return receipt;
}

async function postToClaudBridge(url, payload) {
  try {
    const res = await fetch(`${url}/epoch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: e.message }; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--from');
  const from = fi >= 0 ? args[fi + 1] : null;
  const receipt = args.includes('--cells')
    ? await runCellResolution()
    : (from ? await runPartial(from) : await runPipeline());
  console.log(JSON.stringify(receipt, null, 2));
}
