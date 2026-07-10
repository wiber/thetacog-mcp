// scripts/pmu/calibration-premium.mjs — the SECOND money-flow link, v0.
//
// The on-chain anchor (contracts/ReefAttestation.sol) and the policy that pays on a breach
// (contracts/InLanePolicy.sol) are the FIRST rail: they make the loss event decidable. But a
// reinsurer cannot quote a premium off a single decidable event — they need a CALIBRATED loss
// frequency. This script is that calibration: it reads the running ledger of attestations
// (data/pmu/measure-history.ndjson) and turns it into a priced premium per lane.
//
// DESIGN RULE (docs/strategy/underwriter-ecosystem-spec.md §IX.2): the premium is
//   base_rate × f(breach_rate, σ_distribution)
// NEVER σ alone. σ is the PRECISION of the measurement; the breach RATE is the actuarial
// frequency. We price off the frequency and LOAD for semantic volatility — never off σ.
//
// THE BLACK-SCHOLES MAPPING (the thread that motivated this — Semantic Put Option):
//   K (strike)      = the tolerance band on driftPct (default 4.668%, the live tol✓).
//                     driftPct > K is the loss event = "the coordinate exited the lane."
//   σ (volatility)  = SEMANTIC volatility = stddev(driftPct) across the lane's history.
//                     A high-variance lane is a high-σ lane; its premium is loaded up.
//   p̂ (frequency)  = empirical breach rate = #(driftPct > K) / N, with a Wilson 95% CI.
//   premium         = base_rate × p̂_upper × (1 + λ·σ_norm)   [conservative: upper CI bound]
//
// THE PROMOTION RATCHET (spec §IX.2): a lane stays ADVISORY (not yet priceable) until its
// breach-rate confidence interval tightens below a set half-width — i.e. until running VOLUME
// has earned a tradable number. This is the "needs volume, not new physics" link made literal.
//
// HONESTY GATE (memory: false-negative-from-wrong-metric): rows flagged ingestSuspect are a
// wrong-metric risk; they are EXCLUDED from pricing and reported separately. We never price on
// a measurement we already suspect is an artifact.
//
// Usage:
//   node scripts/pmu/calibration-premium.mjs [--strike 4.668] [--base 1000] [--lambda 0.5]
//                                            [--ci-halfwidth 0.10] [--json]
// Pure Node built-ins; deterministic over the ledger; no network, no new deps.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLedger } from './ledger-attest.mjs';

// LEDGER resolution: prefer cwd-relative (dev convenience — a caller can point at a different
// local ledger by cd'ing there first), fall back to resolving next to THIS script — guarantees
// the bundled npm copy works regardless of caller cwd or dispatch mechanism. Fixed 2026-07-04:
// a bare cwd-relative literal with no fallback ENOENT'd for any stranger who ran this script
// directly (or through anything that didn't `cd` to the repo/package root first) — the "run it
// yourself" claim in recent blog posts was untested against a real npx install.
const LEDGER_REL = 'data/pmu/measure-history.ndjson';
const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = existsSync(LEDGER_REL) ? LEDGER_REL : resolve(HERE, '..', '..', LEDGER_REL);

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined ? def : v;
}
const STRIKE = Number(arg('--strike', '4.668'));   // K — tolerance band on driftPct (%)
const BASE = Number(arg('--base', '1000'));        // base_rate — premium units at p̂=1, σ=0
const LAMBDA = Number(arg('--lambda', '0.5'));     // volatility loading λ
const CI_HALFWIDTH = Number(arg('--ci-halfwidth', '0.10')); // promote when Wilson half-width < this
const AS_JSON = process.argv.includes('--json');

// Wilson score interval for a binomial proportion (better than normal approx at the tails).
function wilson(successes, n, z = 1.96) {
  if (n === 0) return { lo: 0, hi: 1, mid: 0, half: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin), mid: center, half: margin };
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

// ── read the ledger ──────────────────────────────────────────────────────────
let rows;
try {
  rows = readFileSync(LEDGER, 'utf8').trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && typeof r.driftPct === 'number');
} catch (e) {
  console.error(`cannot read ${LEDGER}: ${e.message}`);
  process.exit(1);
}

// split honest (priceable) from suspect (excluded)
const suspect = rows.filter(r => r.ingestSuspect);
const clean = rows.filter(r => !r.ingestSuspect);

// bucket clean rows into lanes (the reef in play IS the lane)
const lanes = new Map();
for (const r of clean) {
  const key = r.reefSha || 'unknown';
  if (!lanes.has(key)) lanes.set(key, []);
  lanes.get(key).push(r);
}

const report = [];
for (const [laneKey, lr] of lanes) {
  const drift = lr.map(r => r.driftPct);
  const sigma = lr.map(r => r.sigmaDrift).filter(x => typeof x === 'number');
  const breaches = drift.filter(x => x > STRIKE).length;
  const n = drift.length;
  const w = wilson(breaches, n);

  const sigmaV = std(drift);          // semantic volatility σ (Black-Scholes σ)
  // normalize σ_v to a 0..1+ loading: a lane whose drift std equals the strike is "1 strike-unit volatile"
  const sigmaNorm = STRIKE > 0 ? sigmaV / STRIKE : 0;
  // conservative actuarial price: upper CI bound on frequency, loaded for volatility
  const premium = BASE * w.hi * (1 + LAMBDA * sigmaNorm);

  const priceable = w.half < CI_HALFWIDTH;

  report.push({
    lane: laneKey,
    n,
    breaches,
    breachRate: breaches / n,
    ci95: [w.lo, w.hi],
    ciHalfWidth: w.half,
    semanticVolatility: sigmaV,
    sigmaPrecision: { mean: mean(sigma), median: sigma.slice().sort((a, b) => a - b)[Math.floor(sigma.length / 2)] ?? 0 },
    premium,
    status: priceable ? 'PRICED' : 'ADVISORY',
  });
}

if (AS_JSON) {
  console.log(JSON.stringify({
    strike: STRIKE, base: BASE, lambda: LAMBDA, ciHalfWidthThreshold: CI_HALFWIDTH,
    totalRows: rows.length, priced: clean.length, excludedSuspect: suspect.length,
    lanes: report,
  }, null, 2));
  process.exit(0);
}

// ── human report ─────────────────────────────────────────────────────────────
const rule = (s = '') => console.log('  ' + '─'.repeat(74) + (s ? '\n  ' + s : ''));
console.log('\n  SEMANTIC PUT-OPTION CALIBRATION — the priced premium, from the ledger');
rule();
console.log(`  ledger        ${LEDGER}`);
console.log(`  rows          ${rows.length} total · ${clean.length} priceable · ${suspect.length} excluded (ingestSuspect)`);
{
  // SEAL STATUS (advisory): an underwriter prices off a ledger the producer cannot have
  // silently edited. We report whether the priced history matches its ed25519-signed seal.
  const seal = verifyLedger(LEDGER);
  console.log(`  seal          ${seal.ok
    ? `✓ VERIFIED — ${seal.count} rows match the signed root ${String(seal.sealedRoot).slice(0, 12)}… (tamper-evident)`
    : `⚠ ${seal.reason} — run: node scripts/pmu/ledger-attest.mjs`}`);
}
console.log(`  K (strike)    driftPct > ${STRIKE}%  = the loss event (coordinate exits the lane)`);
console.log(`  base_rate     ${BASE}   ·   λ (vol loading)  ${LAMBDA}   ·   promote when CI half-width < ${CI_HALFWIDTH}`);
rule();
for (const r of report) {
  console.log(`\n  LANE ${r.lane}   [${r.status}]`);
  console.log(`    n attestations      ${r.n}`);
  console.log(`    breaches            ${r.breaches}   (empirical breach rate ${(r.breachRate * 100).toFixed(1)}%)`);
  console.log(`    p̂ 95% Wilson CI     [${(r.ci95[0] * 100).toFixed(1)}%, ${(r.ci95[1] * 100).toFixed(1)}%]   half-width ${(r.ciHalfWidth * 100).toFixed(1)}%`);
  console.log(`    σ semantic vol      ${r.semanticVolatility.toFixed(2)}  (stddev of driftPct = Black-Scholes σ)`);
  console.log(`    σ precision         mean ${r.sigmaPrecision.mean.toFixed(2)}  median ${r.sigmaPrecision.median.toFixed(2)}  (the measurement sharpness — NOT priced directly)`);
  console.log(`    PREMIUM             ${r.premium.toFixed(1)}  units  = base × p̂_upper × (1 + λ·σ/K)`);
  if (r.status === 'ADVISORY')
    console.log(`    → ADVISORY: CI too wide to quote. Needs running VOLUME, not new mechanism (spec §IX.2).`);
  else
    console.log(`    → PRICED: CI tight enough to write a policy. This number can go in InLanePolicy.sol.`);
}
rule();
console.log('  THE MAPPING: premium prices the FREQUENCY (p̂) and LOADS for SEMANTIC VOLATILITY (σ),');
console.log('  never σ-precision alone. Every new attest-demo / production attestation feeds this — the');
console.log('  premium tightens as volume grows. This is the link that needed volume, not physics.\n');
