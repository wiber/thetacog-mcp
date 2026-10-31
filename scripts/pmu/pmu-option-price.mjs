#!/usr/bin/env node
// scripts/pmu/pmu-option-price.mjs — price an OPTION ON A CONFIDENCE PERCENTILE.
// =============================================================================
// The instrument's underlying is a competence pixel's FOLDING-POINT DISTRIBUTION: for each item in a
// lane, the corruption/adversarial-stress fraction at which the agent stops gripping and ABSTAINS.
// From that distribution comes the survival curve S(c) = P(agent holds its lane up to stress c).
//
// THE WEATHER-DERIVATIVE MODEL (operator 2026-06-16): you cannot buy guaranteed rain; you can buy a
// 90%-rain forecast. Likewise you cannot guarantee an agent never drifts; you can buy coverage at a
// CONFIDENCE PERCENTILE. The strike is expressible BOTH ways — absolute (a stress level c) AND as an
// ingredient (the confidence percentile S(c)). Buyer and seller are BOTH happy as long as the realized
// hold-rate at stress c equals the percentile sold — that calibration is what makes the premium fair.
//
// BLACK-SCHOLES / ACTUARIAL MAPPING:
//   strike      = the purchased confidence percentile  (= a stress level c on the folding axis)
//   volatility  = the spread (sd) of the folding-point distribution
//   no model risk = the measurement is deterministic (within-item variance 0)
//   no false-payout tail = the instrument ABSTAINS rather than mint a verdict it cannot grip
//
// ⚠ PROVISIONAL until the gzip-NCD re-run (AR-12): the current study distribution was measured on the
// SECONDARY SimHash witness. The MODEL here is sensor-independent; the NUMBERS move when the harness is
// re-pointed to the canonical gzip-NCD sensor. This engine reads whatever study is latest and labels it.
//
// Usage:
//   node scripts/pmu/pmu-option-price.mjs --stress 0.30          # confidence + premium at 30% stress
//   node scripts/pmu/pmu-option-price.mjs --percentile 0.90      # the strike that yields 90% confidence
//   node scripts/pmu/pmu-option-price.mjs --stress 0.3 --notional 1000000 --load 0.2
//   node scripts/pmu/pmu-option-price.mjs --json

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = (() => { try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' , stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return resolve(HERE, '../..'); } })();
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const num = (f, d) => { const v = arg(f, null); return v == null ? d : parseFloat(v); };

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const std = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
// survival S(c) = fraction of items whose folding-point is ≥ c (hold the lane at least to stress c).
const survival = (folds, c) => folds.length ? folds.filter((f) => f >= c).length / folds.length : 0;
// empirical quantile (linear interpolation) of a sorted array at level q∈[0,1].
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function loadStudy() {
  const dir = resolve(REPO, 'data/pmu/study');
  const files = readdirSync(dir).filter((f) => /\.json$/.test(f)).sort();
  if (!files.length) throw new Error('no study run found — run scripts/pmu/pmu-study-harness.mjs first');
  const s = JSON.parse(readFileSync(resolve(dir, files[files.length - 1]), 'utf8'));
  const folds = (s.items || []).filter((r) => r.admitted && typeof r.foldingFraction === 'number').map((r) => r.foldingFraction);
  return { study: s, folds };
}

export function priceOption({ folds, stress = null, percentile = null, notional = 1, load = 0.15 }) {
  const sorted = [...folds].sort((a, b) => a - b);
  const vol = std(folds), mu = mean(folds);
  // resolve the strike both ways: from a stress level → its confidence percentile, OR from a desired
  // percentile → the stress level it corresponds to (the (1−p) quantile of folding-points).
  let strikeStress, confidencePercentile;
  if (stress != null) { strikeStress = stress; confidencePercentile = survival(sorted, stress); }
  else { const p = percentile ?? 0.9; confidencePercentile = p; strikeStress = quantile(sorted, 1 - p); }

  const S = confidencePercentile;            // P(hold the lane to the strike stress)
  const Pfail = 1 - S;                        // P(the agent drifts at/under that stress)
  // TWO instruments off the same curve:
  //  HOLD OPTION  — buyer pays a premium for the attested RIGHT to deploy at this percentile; the
  //                 fair value of a $notional payout-on-hold is S·notional, plus the seller's risk load.
  //  INSURANCE    — carrier pays $notional on FAILURE; fair premium = expected loss (1−S)·notional + load.
  const holdOptionPremium = +(S * notional * (1 + load)).toFixed(2);
  const insurancePremium = +(Pfail * notional * (1 + load)).toFixed(2);
  // a volatility (time-value) adjustment band: wider folding-spread ⇒ more uncertainty in the strike ⇒
  // a wider fair-price band. Reported as ± so the desk sees the model's own confidence in the price.
  const priceBand = +(vol * notional * 0.5).toFixed(2);

  return {
    strike: { confidencePercentile: +S.toFixed(4), stressLevel: +strikeStress.toFixed(4),
      absolute: `holds its lane up to ${Math.round(strikeStress * 100)}% adversarial corruption`,
      ingredient: `${Math.round(S * 100)}th-percentile confidence` },
    distribution: { n: folds.length, meanFoldingPoint: +mu.toFixed(4), volatility: +vol.toFixed(4) },
    pricing: { notional, riskLoad: load,
      holdOptionPremium, insurancePremium, priceBand,
      impliedHoldProb: +S.toFixed(4), impliedFailProb: +Pfail.toFixed(4) },
    settlement: {
      rule: `exercised while realized competence rank ≥ the ${Math.round(S * 100)}th percentile sold; expires worthless (abstain) below it`,
      bothHappyWhen: `the realized hold-rate at ${Math.round(strikeStress * 100)}% stress equals the ${Math.round(S * 100)}% percentile sold — the calibration condition (neither side has edge over many contracts)`,
      noFalsePayoutTail: 'the instrument ABSTAINS rather than mint a verdict it cannot grip — the seller cannot be forced to pay on an ungrippable item',
    },
  };
}

// CALIBRATION — THE binding requirement. A percentile-options market is only fair if selling the
// p-th percentile yields a realized hold-rate of p (the weather-forecaster's reliability). We measure
// it by k-fold cross-validation: set the strike stress for percentile p on the train folds, then
// measure the realized survival at that stress on the held-out fold. calibration error = |p − realized|.
// (In-fence CV is a FIRST signal; true calibration needs the out-of-sample blind held-out. AR-12: and
// the canonical gzip-NCD sensor.) Low error across percentiles ⇒ the strike is honestly priceable.
export function calibrate(folds, { k = 5, percentiles = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95] } = {}) {
  const idx = folds.map((_, i) => i);
  const foldOf = (i) => i % k;                               // deterministic fold assignment
  const rows = percentiles.map((p) => {
    const errs = [];
    for (let f = 0; f < k; f++) {
      const train = idx.filter((i) => foldOf(i) !== f).map((i) => folds[i]);
      const test = idx.filter((i) => foldOf(i) === f).map((i) => folds[i]);
      if (train.length < 2 || !test.length) continue;
      const sortedTrain = [...train].sort((a, b) => a - b);
      const strikeStress = quantile(sortedTrain, 1 - p);     // the stress that should yield p confidence
      const realized = survival(test, strikeStress);          // the hold-rate actually observed out-of-fold
      errs.push(Math.abs(p - realized));
    }
    return { percentileSold: p, meanAbsCalibrationError: errs.length ? +mean(errs).toFixed(4) : null };
  });
  const overall = +mean(rows.map((r) => r.meanAbsCalibrationError).filter((x) => x != null)).toFixed(4);
  return { k, rows, meanAbsCalibrationError: overall,
    verdict: overall <= 0.1 ? 'CALIBRATED (≤0.10 mean abs error — premiums are fair)' : 'MIS-CALIBRATED (>0.10 — the percentile sold ≠ the rate delivered; not yet tradeable)' };
}

async function main() {
  const asJson = process.argv.includes('--json');
  const { study, folds } = loadStudy();
  if (folds.length < 4) { console.error('too few admitted items in the study to form a distribution.'); process.exitCode = 1; return; }

  if (process.argv.includes('--calibrate')) {
    const cal = calibrate(folds);
    const provisional = !/HELD-OUT/i.test(study.corpus || '');
    if (asJson) { process.stdout.write(JSON.stringify({ ...cal, provisional, studyCorpus: study.corpus }, null, 2) + '\n'); return; }
    const B = '\x1b[1m', D = '\x1b[2m', Y = '\x1b[33m', G = '\x1b[32m', R = '\x1b[31m', X = '\x1b[0m';
    process.stderr.write(`${B}🎯 CALIBRATION (the binding requirement) — ${cal.k}-fold CV${X}\n`);
    if (provisional) process.stderr.write(`${Y}⚠ in-fence CV on the SimHash witness — a FIRST signal; true calibration needs the out-of-sample held-out on gzip-NCD${X}\n`);
    for (const r of cal.rows) process.stderr.write(`   sold ${Math.round(r.percentileSold * 100)}th pct → calibration error ${r.meanAbsCalibrationError ?? '—'}\n`);
    process.stderr.write(`   ${B}mean abs calibration error ${cal.meanAbsCalibrationError} → ${cal.meanAbsCalibrationError <= 0.1 ? G : R}${cal.verdict}${X}\n`);
    return;
  }
  const provisional = !/HELD-OUT/i.test(study.corpus || '') || /SimHash/i.test(study.corpus || '');
  const out = priceOption({ folds, stress: num('--stress', null), percentile: num('--percentile', null),
    notional: num('--notional', 1), load: num('--load', 0.15) });
  out.provenance = { studyCorpus: study.corpus, libSha: study.libSha, measured: study.measured,
    SENSOR_CAVEAT: provisional ? 'PROVISIONAL — distribution measured on the SimHash witness; numbers move on the gzip-NCD re-run (AR-12)' : 'gzip-NCD canonical' };

  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const B = '\x1b[1m', D = '\x1b[2m', Y = '\x1b[33m', G = '\x1b[32m', X = '\x1b[0m';
  process.stderr.write(`${B}🏦 OPTION ON A CONFIDENCE PERCENTILE${X}  (weather-derivative model)\n`);
  if (provisional) process.stderr.write(`${Y}⚠ ${out.provenance.SENSOR_CAVEAT}${X}\n`);
  process.stderr.write(`   STRIKE      : ${out.strike.ingredient}  ${D}(${out.strike.absolute})${X}\n`);
  process.stderr.write(`   DISTRIBUTION: n=${out.distribution.n} · mean folding ${out.distribution.meanFoldingPoint} · vol ${out.distribution.volatility}\n`);
  process.stderr.write(`   HOLD OPTION : ${G}${out.pricing.holdOptionPremium}${X} per ${out.pricing.notional} notional ${D}(±${out.pricing.priceBand}, load ${out.pricing.riskLoad})${X}\n`);
  process.stderr.write(`   INSURANCE   : ${out.pricing.insurancePremium} per ${out.pricing.notional} ${D}(pays on failure; fail prob ${out.pricing.impliedFailProb})${X}\n`);
  process.stderr.write(`   SETTLEMENT  : ${out.settlement.rule}\n`);
  process.stderr.write(`   BOTH HAPPY  : ${D}${out.settlement.bothHappyWhen}${X}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
