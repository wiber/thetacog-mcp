// scripts/pmu/cost-guidance.mjs — turn a drift measurement into ADVISORY cost guidance
// an insurance/reinsurance desk reads natively: priced BY TOLERANCE, in their own language.
// =============================================================================
// The receipt's hard signal is decidable: how much of the delivery landed OFF the spec's
// intent shape (off_shape / "kill" %) versus the TOLERANCE band. That maps one-to-one onto
// an excess-of-loss cover: the tolerance IS the attachment point (losses within tolerance are
// retained by the insured), and the drift past it is the loss that attaches to the cover.
//
// DESIGN RULE (docs/strategy/underwriter-ecosystem-spec.md §IX.2, mirrored from price-attest):
//   premium = expected_loss × (1 + load),  expected_loss = P(attach) × severity × limit
//   σ (the placement precision) SHARPENS P(attach) — it is NOT the price. The breach RATE is
//   the actuarial signal; σ is how confident we are in the measurement. Never σ alone.
//
// Everything is ADVISORY / pre-calibration — we refuse to assert a bound quote (the honest
// fence). The numbers come back in desk shorthand: limit, attachment, rate-on-line, loss
// ratio, expected loss, loss-given-breach, plus the options view (a PUT on staying in-lane:
// strike, spot, moneyness, ITM/ATM/OTM) and the MULTIPLES a desk thinks in.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const usd = (n) => '$' + Math.round(n).toLocaleString();

// COVERAGE GUARD (2026-06-23) — price off COVERAGE, not raw σ.
// A hostile third-party assessment found the σ-inversion: σ is PLACEMENT confidence (how vocabulary-dense
// / well-placed the delivery is on the spec shape), NOT low risk. An in-lane NEGATION ("we did the
// OPPOSITE", saturated with the spec's own vocabulary) or pure keyword salad places at the HIGHEST σ — so
// a σ-only price would call it the CHEAPEST/safest, exactly the loss case. The orthogonal honest signal is
// COVERAGE: the share of the spec's requirements the delivery actually COVERED (the deep walk reports this
// per-requirement; the negation/salad covers NOTHING). When coverage is LOW we must ABSTAIN — flag SUSPECT
// / not-underwritable — regardless of σ. High σ + low coverage is the explicit red flag, never a discount.
const COVERAGE_ABSTAIN = 0.5;   // below this fraction of requirements covered → ABSTAIN/SUSPECT, no cheap quote

export function costGuidance({ offShapePct, tolerancePct, sigmaMatchPct = 60, coveragePct = null, notional = 10_000_000, load = 0.15 }) {
  const tol = clamp(Number(tolerancePct) || 0, 0.0001, 100);
  const off = clamp(Number(offShapePct) || 0, 0, 100);
  const limit = Number(notional) || 10_000_000;
  // coverage is OPTIONAL: a 0..1 fraction of requirements covered. When absent (null/undefined) we leave
  // existing behaviour exactly unchanged — we never invent a coverage signal a caller did not measure.
  const coverage = (coveragePct == null || Number.isNaN(Number(coveragePct))) ? null : clamp(Number(coveragePct), 0, 1);
  const lowCoverage = coverage != null && coverage < COVERAGE_ABSTAIN;
  if (lowCoverage) {
    // ABSTAIN — vocabulary-dense, covered nothing. No premium, no fee link. This is the anti-inversion:
    // the gauge must not be MOST reassured (cheapest) exactly when it should be MOST alarmed.
    return {
      status: 'ABSTAIN — high placement-σ, low coverage (vocabulary-dense, covered nothing); not underwritable',
      band: 'SUSPECT',
      underwritable: false,
      basis: 'priced off COVERAGE, not raw σ: σ is placement-confidence, not low risk. Low coverage abstains regardless of σ.',
      inputs: { off_shape_pct: off, tolerance_attachment_pct: tol, sigma_precision_pct: +Number(sigmaMatchPct).toFixed(1), coverage: +coverage.toFixed(4), notional: limit },
      insurance: { advisory_premium_usd: null, rate_on_line_bps: null, structure: 'not underwritable — coverage below abstain threshold' },
      options: null,
      multiples: null,
      plain_language: `ABSTAIN — placement-σ is ${(+Number(sigmaMatchPct).toFixed(0))}% but coverage is only ${(coverage * 100).toFixed(0)}% of requirements (below the ${(COVERAGE_ABSTAIN * 100).toFixed(0)}% floor). High σ with low coverage is the negation/keyword-salad signature: vocabulary-dense, covered nothing. This is NOT a cheap premium — it is the alarm. Not underwritable; needs review.`,
    };
  }

  // TOLERANCE = the attachment point. Drift beyond it is the loss that reaches the cover.
  const overage = Math.max(0, off - tol);                 // how far past the lane boundary
  const room = Math.max(1, 100 - tol);                    // distance from boundary to "fully out"
  const severity = clamp(overage / room, 0, 1);           // loss-given-breach, as a fraction of limit

  // P(attachment): logistic on the distance to the boundary, SHARPENED by σ-precision.
  // A confident measurement (high σ-match) makes the breach/no-breach call crisper.
  const precision = clamp(sigmaMatchPct / 100, 0.2, 1);
  const k = 0.12 + 0.20 * precision;                      // steeper when we're more sure
  const pAttach = clamp(1 / (1 + Math.exp(-(off - tol) * k)), 0, 1);

  const expectedLossRate = clamp(pAttach * severity, 0, 1);
  const expectedLoss = expectedLossRate * limit;
  const premium = expectedLoss * (1 + load);
  const rolBps = Math.round((premium / limit) * 10000);   // rate-on-line, the desk's headline metric
  const targetLossRatio = +(1 / (1 + load)).toFixed(3);   // break-even loss ratio (advisory)

  // OPTIONS view — a PUT on the work staying in-lane (pays if drift breaches the tolerance strike).
  const moneyness = +(((off - tol) / tol)).toFixed(3);    // >0 ITM (already breached), <0 OTM (inside)
  const state = off > tol ? 'IN-THE-MONEY — lane already breached'
    : off > tol * 0.8 ? 'AT-THE-MONEY — riding the tolerance boundary'
    : 'OUT-OF-THE-MONEY — comfortably inside the lane';

  const coverPerPremium = premium > 0 ? +(limit / premium).toFixed(1) : null;

  const breached = pAttach >= 0.5;
  const plain = breached
    ? `Off-shape ${off}% has crossed the ${tol}% tolerance, so the cover attaches. On a ${usd(limit)} limit the advisory premium is ≈ ${usd(premium)} — about ${rolBps} bps rate-on-line — against an expected loss of ${usd(expectedLoss)} (loss-given-breach ${(severity * 100).toFixed(0)}% of limit). The put is in-the-money; this delivery is the kind you'd price up or send back. Advisory, pre-calibration.`
    : `Off-shape ${off}% sits inside the ${tol}% tolerance, so the put is out-of-the-money and the cover is cheap: advisory premium ≈ ${usd(premium)} on a ${usd(limit)} limit (${rolBps} bps rate-on-line, ${coverPerPremium ?? '—'}× cover per premium dollar). You're paying for precision, not for risk. Advisory, pre-calibration.`;

  return {
    status: 'ADVISORY — pre-calibration; a transparent f(tolerance, σ-precision), not a bound quote',
    basis: 'priced by TOLERANCE: off-shape drift vs the tolerance attachment; σ-match sharpens P(attach) but never sets the price alone. Coverage gate clears (σ is placement-confidence, not the discount).',
    inputs: { off_shape_pct: off, tolerance_attachment_pct: tol, sigma_precision_pct: +Number(sigmaMatchPct).toFixed(1), coverage: coverage == null ? null : +coverage.toFixed(4), notional: limit },
    insurance: {
      structure: 'excess-of-loss — tolerance is the attachment, the spec-reef is the covered peril',
      cover_limit_usd: Math.round(limit),
      attachment_point: `${tol}% off-shape (drift within tolerance is retained by the insured)`,
      prob_of_attachment: +pAttach.toFixed(3),
      loss_given_breach_pct_of_limit: +(severity * 100).toFixed(1),
      expected_loss_usd: Math.round(expectedLoss),
      advisory_premium_usd: Math.round(premium),
      rate_on_line_bps: rolBps,
      target_loss_ratio: targetLossRatio,
    },
    options: {
      instrument: 'PUT on staying in-lane (pays if the delivery drifts past tolerance)',
      strike: `${tol}% off-shape (the tolerance boundary)`,
      spot: `${off}% off-shape (measured)`,
      moneyness,
      state,
    },
    multiples: {
      cover_per_premium_dollar: coverPerPremium,    // "$N of cover for every $1 of premium"
      premium_over_expected_loss: +(1 + load).toFixed(2),
      rate_on_line: `${rolBps} bps`,
    },
    plain_language: plain,
  };
}

// CLI: cost-guidance.mjs --off 18 --tolerance 15 --sigma 62 [--coverage 0.67] [--notional 10000000]
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  const covRaw = arg('--coverage', null);
  const g = costGuidance({
    offShapePct: parseFloat(arg('--off', '18')),
    tolerancePct: parseFloat(arg('--tolerance', '15')),
    sigmaMatchPct: parseFloat(arg('--sigma', '60')),
    coveragePct: covRaw == null ? null : parseFloat(covRaw),
    notional: parseFloat(arg('--notional', '10000000')),
  });
  process.stdout.write(JSON.stringify(g, null, 2) + '\n');
  process.stderr.write(`\n  ${g.plain_language}\n`);
}
