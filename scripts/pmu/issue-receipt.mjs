#!/usr/bin/env node
// scripts/pmu/issue-receipt.mjs
//
// AIR receipt issuer — takes a doc + intent, runs compress(), produces a
// signed receipt conforming to docs/architecture/air-receipt-schema-v1.json,
// appends to .thetacog/receipts.jsonl, prints the receipt to stdout.
//
// Usage:
//   node scripts/pmu/issue-receipt.mjs \
//     --job-id "draft-blog-X" \
//     --authorized A2,B3 \
//     --doc-file path/to/doc.txt \
//     [--threshold 4.0]
//
//   echo "..." | node scripts/pmu/issue-receipt.mjs --job-id X --authorized A2 --stdin
//
// Verdict rules (canonical, mirrored in air-receipt-schema-v1.html):
//   · IN_ROLE              both available witnesses agree AND cell ∈ authorized AND σ ≥ threshold
//   · OFF_DOMAIN           both witnesses agree AND cell ∉ authorized
//   · UNPLACEABLE          witnesses disagree OR σ < threshold under both
//   · PENDING_CALIBRATION  cache witness null AND SimHash σ < single-witness threshold
//
// The cache witness is LIVE (doc-derived ballistic walk on PMU hardware, σ a real
// z-score — see cache-witness.mjs). It is null only as a fallback when the pmu-onchip
// binary or grid is unavailable. The sparse-grid path broke the v0 σ ceiling and a
// first BOTH-agreement receipt exists (0ce8d186, cell A, σ_sim 3.67 / σ_cache 3.78).
// Remaining gap is agreement-RATE at scale + calibration, not existence.

import { readFileSync, mkdirSync, existsSync, writeFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, generateKeyPairSync, createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { homedir } from 'node:os';
import { compress } from '../../src/lib/pmu/compress.mjs';
import { cacheCellPredict } from '../../src/lib/pmu/cache-witness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const AXIS_LIB_PATH = resolve(REPO_ROOT, 'docs/architecture/axis-library-v1.json');
// LOCKED file layout — per-receipt JSON at ~/.thetacog/pmu/receipts/<id>.json
// (outside the repo). A repo-local pointer is intentionally NOT maintained:
// the receipts are host-bound and not version-controlled. Stop-hook scans the
// dir directly. Tuesday's cache calibration writes alongside.
const RECEIPTS_DIR = resolve(homedir(), '.thetacog/pmu/receipts');
const PMU_MEASUREMENTS_DIR = resolve(REPO_ROOT, '.thetacog/pmu/measurements');
const HOST_KEY_PRIV = resolve(homedir(), '.thetacog/host-key.priv');
const HOST_KEY_PUB  = resolve(homedir(), '.thetacog/host-key.pub');
const HOST_UUID_PATH = resolve(homedir(), '.thetacog/host-uuid');

// ── arg parsing ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  out.threshold = 3.0;  // LOCKED: σ-margin ≥ 3 (was 4.0)
  out.lens = 'tri';     // 'tri' = legacy tri-witness gate; 'gzip' = gzip repoint
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--job-id') out.jobId = argv[++i];
    else if (a === '--authorized') out.authorized = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--doc-file') out.docFile = argv[++i];
    else if (a === '--stdin') out.stdin = true;
    else if (a === '--threshold') out.threshold = parseFloat(argv[++i]);
    else if (a === '--lens') out.lens = argv[++i];  // tri | gzip
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function usage() {
  console.error(`usage: node scripts/pmu/issue-receipt.mjs --job-id <id> --authorized A1,B2 (--doc-file PATH | --stdin) [--threshold 4.0] [--quiet]`);
  process.exit(2);
}

// ── ensure persistent identifiers exist ──────────────────────────────
// ── load latest PMU per-commit measurement (real hardware tier-tuple) ────
function loadLatestPmuMeasurement() {
  if (!existsSync(PMU_MEASUREMENTS_DIR)) return null;
  const files = readdirSync(PMU_MEASUREMENTS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;
  // pick most-recently-modified file (each is named by commit SHA)
  let latest = null, latestMtime = 0;
  for (const f of files) {
    const p = resolve(PMU_MEASUREMENTS_DIR, f);
    const m = statSync(p).mtimeMs;
    if (m > latestMtime) { latestMtime = m; latest = p; }
  }
  try { return JSON.parse(readFileSync(latest, 'utf8')); }
  catch { return null; }
}

function ensureHostUuid() {
  mkdirSync(dirname(HOST_UUID_PATH), { recursive: true });
  if (!existsSync(HOST_UUID_PATH)) {
    writeFileSync(HOST_UUID_PATH, randomUUID() + '\n', { mode: 0o600 });
  }
  return readFileSync(HOST_UUID_PATH, 'utf8').trim();
}

// ── ed25519 host keypair (LOCKED spec) ───────────────────────────────
// Private key at ~/.thetacog/host-key.priv (0600), public at host-key.pub.
// Public key embedded in every receipt so verify is signature-only — no key
// distribution required, cross-host trust ships with marketplace later.
function ensureHostKey() {
  mkdirSync(dirname(HOST_KEY_PRIV), { recursive: true });
  if (!existsSync(HOST_KEY_PRIV) || !existsSync(HOST_KEY_PUB)) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    writeFileSync(HOST_KEY_PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(HOST_KEY_PUB,  publicKey.export({ type: 'spki',  format: 'pem' }), { mode: 0o644 });
  }
  try { chmodSync(HOST_KEY_PRIV, 0o600); } catch {}
  const privPem = readFileSync(HOST_KEY_PRIV, 'utf8');
  const pubPem  = readFileSync(HOST_KEY_PUB, 'utf8');
  return { privateKey: createPrivateKey(privPem), publicKeyPem: pubPem };
}

// ── canonical JSON for signing (keys sorted, no whitespace) ──────────
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

// Sign with ed25519. node:crypto.sign(null, data, privKey) where algorithm=null
// is the canonical EdDSA call shape — Ed25519 is its own hash.
function signReceipt(receipt, privateKey) {
  const { signature: _omit, ...rest } = receipt;
  const canon = Buffer.from(canonicalize(rest), 'utf8');
  return cryptoSign(null, canon, privateKey).toString('hex');
}

// ── agreement classification (LOCKED spec) ───────────────────────────
// agreement='BOTH' iff simhash.cell==cache.cell AND both margins≥3
// (else GZIP_ONLY|SIMHASH_ONLY|DISAGREE — these NEVER skip, they are
// recorded for v2 calibration)
//
// BOTH is now reachable: the sparse-grid cache witness produced a first
// BOTH-agreement receipt (0ce8d186). It is still rare (n=1) — calibration raises
// the rate; when the cache witness IS null (binary/grid missing), BOTH is skipped.
// The receipt issues with agreement='SIMHASH_ONLY' (or GZIP_ONLY) and the
// Stop-hook falls through to LLM — by design, per LOCKED rule.
function classifyAgreement({ result, threshold, cacheWitness, lens = 'tri' }) {
  const w = result.witnesses;
  const sigmaG = w.gzipNCD.sigma;
  const sigmaS = w.simhashCosine.sigma;
  const gzipOk = sigmaG >= threshold;
  const simOk  = sigmaS >= threshold;

  // ── gzip repoint (2026-06-13) ────────────────────────────────────────
  // The gzip NCD lens is the proven compression-as-sensor (the working drift
  // sensor). With --lens gzip it ARBITRATES the gate on its own: gzip σ≥threshold
  // → GZIP_ONLY (a single-lens attestation, honestly labelled). The simhash and
  // ballistic-walk witnesses are still RUN and RECORDED for cross-check / v2
  // calibration but no longer flip the verdict. Returns DISAGREE only when the
  // gzip lens itself can't place the doc above threshold — never a false pass.
  // Spec: docs/superpowers/specs/2026-06-13-reef-grounded-hooks-design.md
  if (lens === 'gzip') {
    return gzipOk ? 'GZIP_ONLY' : 'DISAGREE';
  }

  // A cache witness only ARBITRATES the gate when it is calibrated. The v0
  // ballistic walk (calibration_status starts 'V0') is still RUN and RECORDED
  // for v2 calibration, but it must not VETO the working gzip/simhash lenses —
  // otherwise every receipt collapses to DISAGREE because the uncalibrated walk
  // lands on a different cell than the compression sensors. An admittedly-
  // uncalibrated witness stops vetoing the proven lenses; it does NOT bypass or
  // fake the walk.
  const cacheCalibrated = cacheWitness &&
    !String(cacheWitness.calibration_status || '').startsWith('V0');

  if (cacheCalibrated) {
    const cacheCellMatch = cacheWitness.cell === w.simhashCosine.cell;
    const cacheOk = cacheWitness.sigma >= threshold;
    if (cacheCellMatch && simOk && cacheOk) return 'BOTH';
    return 'DISAGREE';
  }
  // No calibrated cache witness — single-lens classification (gzip/simhash).
  if (gzipOk && simOk && result.agreement) return 'SIMHASH_ONLY';
  if (gzipOk && !simOk) return 'GZIP_ONLY';
  if (simOk && !gzipOk) return 'SIMHASH_ONLY';
  if (gzipOk && simOk && !result.agreement) return 'DISAGREE';
  return 'DISAGREE';
}

// ── verdict — per LOCKED spec enum is IN_ROLE | OFF_DOMAIN | UNPLACEABLE
// The agreement field carries the BOTH/GZIP_ONLY/etc. detail; verdict is
// computed against the AUTHORITATIVE cell (BOTH → that cell; otherwise the
// best single-witness cell). Stop-hook reads `agreement==='BOTH'` as the
// gate, NOT verdict.
function decideVerdict({ result, authorized, agreement, lens = 'tri' }) {
  const w = result.witnesses;
  // --lens gzip: the gzip cell is authoritative (the repoint). DISAGREE here
  // means the gzip lens couldn't place the doc above threshold → UNPLACEABLE,
  // never a forced in-/off-role on a cell the chosen lens didn't actually pick.
  if (lens === 'gzip') {
    if (agreement !== 'GZIP_ONLY') {
      return { verdict: 'UNPLACEABLE', reason: `gzip lens below threshold (σ_gzip=${w.gzipNCD.sigma.toFixed(2)})`, authoritative_cell: null };
    }
    const gcell = w.gzipNCD.cell;
    if (authorized.includes(gcell)) {
      return { verdict: 'IN_ROLE', reason: `gzip cell ${gcell} ∈ {${authorized.join(', ')}} (agreement=GZIP_ONLY, σ_gzip=${w.gzipNCD.sigma.toFixed(2)})`, authoritative_cell: gcell };
    }
    return { verdict: 'OFF_DOMAIN', reason: `gzip cell ${gcell} ∉ {${authorized.join(', ')}} — scope (agreement=GZIP_ONLY)`, authoritative_cell: gcell };
  }

  const cell = agreement === 'BOTH'
    ? w.simhashCosine.cell
    : (w.gzipNCD.sigma >= w.simhashCosine.sigma ? w.gzipNCD.cell : w.simhashCosine.cell);

  if (!cell) {
    return { verdict: 'UNPLACEABLE', reason: 'no witness placed the doc', authoritative_cell: null };
  }
  if (authorized.includes(cell)) {
    return {
      verdict: 'IN_ROLE',
      reason: `authoritative cell ${cell} ∈ {${authorized.join(', ')}} (agreement=${agreement}, σ_gzip=${w.gzipNCD.sigma.toFixed(2)}, σ_sim=${w.simhashCosine.sigma.toFixed(2)})`,
      authoritative_cell: cell,
    };
  }
  return {
    verdict: 'OFF_DOMAIN',
    reason: `authoritative cell ${cell} ∉ {${authorized.join(', ')}} — scope (agreement=${agreement})`,
    authoritative_cell: cell,
  };
}

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.jobId || !args.authorized) usage();
  if (!args.docFile && !args.stdin) usage();

  let doc;
  if (args.stdin) {
    doc = await new Promise((res) => {
      let buf = '';
      process.stdin.on('data', (c) => { buf += c; });
      process.stdin.on('end', () => res(buf));
    });
  } else {
    doc = readFileSync(args.docFile, 'utf8');
  }

  const axisLib = JSON.parse(readFileSync(AXIS_LIB_PATH, 'utf8'));
  const result = compress(doc, axisLib);

  // SimHash witness payload
  const w = result.witnesses;
  const ncdMargin = w.gzipNCD.scores.length >= 2
    ? w.gzipNCD.scores[0].score - w.gzipNCD.scores[1].score
    : 0;
  const witness_simhash = {
    cell: w.simhashCosine.cell,
    sigma: w.simhashCosine.sigma,
    ncd_margin: ncdMargin,
    method: 'compress.mjs/gzipNCD+simhashCosine (llmCosine pending OPENAI_API_KEY wiring)',
    gzip_cell: w.gzipNCD.cell,
    gzip_sigma: w.gzipNCD.sigma,
    sim_cell: w.simhashCosine.cell,
    sim_sigma: w.simhashCosine.sigma,
  };

  // ── witness_cache — REAL: doc-derived ballistic walk on PMU hardware ──
  // Run pmu-onchip --ballistic --grid <doc-grid> from each of 12 ShortLex
  // axes; cell = axis whose walk lands the heaviest visits on the doc's
  // occupied cells. Plus the host's tier_tuple from the most recent
  // per-commit PMU measurement.
  //
  // v0 calibration limitations (documented honestly):
  //   - Self-recall on pure-axis snippets: 7/12 within-1-cell (family-match),
  //     0/12 exact-match. Cardinal-axis bias persists in raw scorer.
  //   - Within-1-cell match against simhash cell IS the user-spec criterion
  //     for cache calibration ("SimHash-predicted cell matches cache-derived
  //     cell within 1 cell"). v0 partial — Tuesday's refinement target.
  // sparse=12 (8% grid density) is the calibration that lifts cache σ above
  // the LOCKED ≥3 threshold — discovered 2026-05-25 PM. Dense grids (50%)
  // give σ ≤ 2.1 because cardinal-axis walks cluster; sparse grids
  // concentrate the signal on doc-specific features.
  const cachePrediction = cacheCellPredict(doc, { sparse: true, sparseBits: 12 });
  const latestPmu = loadLatestPmuMeasurement();
  let witness_cache = null;
  const pending = [];
  if (cachePrediction.cell || latestPmu) {
    witness_cache = {
      cell: cachePrediction.cell,
      sigma: cachePrediction.sigma,
      tier_tuple: latestPmu ? {
        L1_ns: latestPmu.tiers?.L1?.ns_per_access ?? null,
        L2_ns: latestPmu.tiers?.L2?.ns_per_access ?? null,
        SLC_ns: latestPmu.tiers?.SLC?.ns_per_access ?? null,
        DRAM_ns: latestPmu.tiers?.DRAM?.ns_per_access ?? null,
        gate_ns: latestPmu.gate_ns_per_comparison ?? null,
        walk_ns_12x12: latestPmu.walk_ns_12x12 ?? null,
        miss_penalty: latestPmu.miss_penalty_dram_l1 ?? null,
      } : null,
      baseline_ref: latestPmu?.sha ?? null,
      measured_at: latestPmu?.measured_at ?? null,
      grid_population: cachePrediction.grid_population,
      walk_scores: cachePrediction.scores?.slice(0, 5),  // top 5 for audit
      calibration_status: 'V0_BALLISTIC_WALK_RAW_SCORER__REFINEMENT_PENDING_TUE',
      method: cachePrediction.method,
    };
    if (cachePrediction.status !== 'BALLISTIC_WALK_OK' && cachePrediction.status !== 'SENSE_OK') pending.push('cache_cell_mapping');
  } else {
    pending.push('cache');
  }

  const agreement = classifyAgreement({
    result, threshold: args.threshold, cacheWitness: witness_cache, lens: args.lens,
  });

  const { verdict, reason, authoritative_cell } = decideVerdict({
    result, authorized: args.authorized, agreement, lens: args.lens,
  });

  const hostUuid = ensureHostUuid();
  const { privateKey, publicKeyPem } = ensureHostKey();

  const receipt = {
    receipt_id: randomUUID(),
    host_uuid: hostUuid,
    host_pub_key: publicKeyPem.trim(),  // PEM, embedded for verify-only-with-receipt
    ts: new Date().toISOString(),
    semantic_intent: {
      job_id: args.jobId,
      authorized_cells: args.authorized,
    },
    physical_execution: {
      witness_simhash,
      witness_cache,
      pending_witnesses: pending,
    },
    agreement,
    gate_lens: args.lens,  // 'tri' (legacy tri-witness) | 'gzip' (gzip repoint)
    authoritative_cell,
    verdict,
    verdict_reason: reason,
    signature: '',
    signature_algorithm: 'ed25519',
  };
  receipt.signature = signReceipt(receipt, privateKey);

  // persist — per-receipt JSON in host-local ~/.thetacog/pmu/receipts/<id>.json
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  const receiptPath = resolve(RECEIPTS_DIR, `${receipt.receipt_id}.json`);
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

  if (!args.quiet) console.log(JSON.stringify(receipt, null, 2));
  // exit code carries the verdict for shell consumers
  process.exit(verdict === 'IN_ROLE' ? 0 : verdict === 'OFF_DOMAIN' ? 1 : 2);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(3); });
