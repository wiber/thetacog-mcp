#!/usr/bin/env node
// scripts/pmu/price-attest.mjs — THE THIRD NODE: the underwriter's attestation.
//
// The two-party gate (attest.mjs) answers a decidable question: did Node B's work
// land inside the lane Node A's reef authorized? MATCH / DRIFT / ABSTAIN, signed,
// recomputable. This third node sits on TOP of that verdict and produces what a
// reinsurer / clearing house actually buys:
//
//   1. TOLERANCE   — is the work inside the priced tolerance band? (DECIDABLE — read
//                    straight off the gate verdict + σ. This is the hard signal.)
//   2. PRICE       — an insurance-premium / drift-option recommendation. (ADVISORY,
//                    PRE-CALIBRATION — a transparent function of σ and the tolerance
//                    band. We do NOT sell this as a calibrated quote; calibration is
//                    earned by running attestations, not asserted. The fence is the
//                    asset — see the disclaimer this prints.)
//   3. FLAGS       — the barter/settlement actions: ACCEPT · REWORK · ESCALATE · DECLINE.
//
// The underwriter is a DISTINCT identity from Node A and Node B — independence is
// the property that makes the signal underwritable (no party who profits from the
// verdict controls it). It seals its attestation over the gate receipt's own sha256,
// so the price is bound to the exact verdict it priced.
//
//   node scripts/pmu/price-attest.mjs --receipt receipt.json [--notional 10000000]
//        [--base-rate-bps 50] [--tolerance-sigma 3.4] [--as underwriter] [--out price.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorIdentity, sealReceiptAs, verifyReceipt } from './receipt-crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(flag, def) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; }
const has = (f) => process.argv.includes(f);

function main() {
  const receiptPath = arg('--receipt');
  if (!receiptPath) { console.error('usage: price-attest --receipt <gate-receipt.json> [--notional N] [--base-rate-bps B] [--tolerance-sigma S] [--as underwriter] [--out price.json]'); process.exit(2); }
  const r = JSON.parse(readFileSync(receiptPath, 'utf8'));

  // The underwriter only prices a verdict it can itself verify. Independence + integrity.
  const sealOk = verifyReceipt(r).ok;
  if (!sealOk) { console.error('✗ refusing to price: gate receipt seal does not verify'); process.exit(1); }

  const notional = Number(arg('--notional', '10000000'));     // $ at risk on this deliverable
  const baseRateBps = Number(arg('--base-rate-bps', '50'));   // base premium, basis points of notional
  const tolSigma = Number(arg('--tolerance-sigma', '3.4'));   // earned-gold σ floor (pipeline default)
  const verdict = r.verdict;                                  // MATCH | DRIFT | ABSTAIN
  const sigma = Number(r.gzip_witness?.sigma ?? 0);
  const cell = r.authoritative_cell ?? r.gzip_witness?.cell ?? null;

  // ── 1. TOLERANCE — decidable, read off the gate ───────────────────────────
  // INSIDE   : MATCH and comfortably above the σ floor (signal is gold)
  // MARGINAL : MATCH but within 25% of the floor (priced, but loaded)
  // OUTSIDE  : DRIFT — landed in a cell the reef did not authorize
  // INSUFFICIENT: ABSTAIN — the gate refused to place it (uninsurable, do not price)
  let tolerance, flag, pricing_status, reason;
  if (verdict === 'ABSTAIN') {
    tolerance = 'INSUFFICIENT'; flag = 'ESCALATE'; pricing_status = 'NOT_PRICED';
    reason = `gate abstained (σ=${sigma.toFixed(2)} below threshold or witnesses disagree) — the honest no-mint. Uninsurable until the spec or the work is sharpened.`;
  } else if (verdict === 'DRIFT') {
    tolerance = 'OUT_OF_TOLERANCE'; flag = 'DECLINE'; pricing_status = 'ADVISORY_PRE_CALIBRATION';
    reason = `work landed in cell ${cell}, outside the authorized lane. Out of tolerance — decline or reprice as a different risk.`;
  } else { // MATCH
    const marginal = sigma < tolSigma * 1.25;
    tolerance = marginal ? 'MARGINAL' : 'INSIDE_TOLERANCE';
    flag = marginal ? 'REWORK' : 'ACCEPT'; pricing_status = 'ADVISORY_PRE_CALIBRATION';
    reason = `placement: cell ${cell} at σ=${sigma.toFixed(2)} (floor ${tolSigma}). ${marginal ? 'MARGINAL — inside the authorized cells but σ is close to the floor; the underwriter loads the premium or requests rework.' : 'Inside the authorized cells, σ comfortably above the floor.'}`;
  }

  // ── 2. PRICE — ADVISORY. A transparent function of σ vs the tolerance band. ──
  // risk_multiplier: 1.0 at the σ floor; falls toward ~0.25 as σ rises well above
  // the floor (a deep-in-lane verdict is cheap to insure); rises sharply as σ
  // approaches/crosses the floor; DRIFT is a different (loaded) risk; ABSTAIN is
  // not priced at all. This is NOT calibrated — it is the shape the calibration
  // will refine once realized rates are observed. We say so, loudly.
  let risk_multiplier = null, premium_usd = null, option = null;
  if (pricing_status === 'ADVISORY_PRE_CALIBRATION') {
    if (verdict === 'MATCH') {
      const headroom = Math.max(0, sigma - tolSigma);
      risk_multiplier = Number((0.25 + 0.75 / (1 + headroom / tolSigma)).toFixed(3)); // 1.0 at floor → 0.25 deep in lane
    } else { // DRIFT
      risk_multiplier = 4.0; // out-of-lane work is a loaded, different risk
    }
    premium_usd = Math.round(notional * (baseRateBps / 10000) * risk_multiplier);
    // drift-option framing: a put on staying-in-lane. strike = tolerance band σ;
    // distance-to-strike = σ - floor (in lane) drives the option's moneyness.
    const distanceToBand = Number((sigma - tolSigma).toFixed(2));
    option = {
      instrument: 'in-lane put (advisory)',
      strike_sigma: tolSigma,
      observed_sigma: sigma,
      distance_to_band: distanceToBand,
      moneyness: verdict === 'MATCH' ? (distanceToBand >= 0 ? 'out-of-the-money (no breach yet)' : 'at/near the money') : 'in-the-money (breach)',
      note: 'Black-Scholes-style pricing is intentionally NOT applied yet — volatility input requires the calibration we have not earned.',
    };
  }

  const underwriter = actorIdentity(arg('--as', 'underwriter'));
  const body = {
    artifact: 'thetacog-underwriter-attestation',
    receipt_kind: 'third-party-price-attestation',
    job_id: r.job_id,
    // bind to the EXACT verdict priced (independence + integrity)
    priced_receipt_sha256: r.sha256,
    reef_commitment: r.reef_commitment,
    payload_sha256: r.payload_sha256,
    gate_verdict: verdict,
    observed_sigma: sigma,
    authoritative_cell: cell,
    // the three things a reinsurer buys
    tolerance,
    barter_flag: flag,
    price: {
      pricing_status,
      currency: 'USD',
      notional,
      base_rate_bps: baseRateBps,
      tolerance_sigma_floor: tolSigma,
      risk_multiplier,
      advisory_premium_usd: premium_usd,
      option,
      DISCLAIMER: 'ADVISORY, PRE-CALIBRATION. The TOLERANCE verdict is decidable and recomputable; the PRICE is a transparent function of σ, not a calibrated quote. A calibrated premium requires realized-rate data earned by running attestations. Selling a price without calibration is the 2008 failure mode — we refuse it. The fence is the asset.',
    },
    reason,
    underwriter: { name: underwriter.name, pubkey_hex: underwriter.pubkey_hex, independent_of: [r.submitter_pubkey, r.addressed_to].filter(Boolean) },
  };
  const sealed = sealReceiptAs(body, underwriter);
  const out = arg('--out', `price-${r.job_id}.json`);
  writeFileSync(out, JSON.stringify(sealed, null, 2));

  if (!has('--quiet')) {
    const glyph = tolerance === 'INSIDE_TOLERANCE' ? '🟢' : tolerance === 'MARGINAL' ? '🟡' : tolerance === 'OUT_OF_TOLERANCE' ? '🔴' : '⚪️';
    console.log(`${glyph} UNDERWRITER (${underwriter.name}) → ${out}`);
    console.log(`   tolerance   ${tolerance}   ·   flag ${flag}   ·   placement reproduced @ σ=${sigma.toFixed(2)}`);
    if (premium_usd != null) {
      console.log(`   price       $${premium_usd.toLocaleString()} advisory premium  (notional $${notional.toLocaleString()} · ${baseRateBps}bps · ×${risk_multiplier} risk)`);
      console.log(`   option      ${option.instrument} · strike σ=${option.strike_sigma} · ${option.moneyness}`);
    } else {
      console.log(`   price       NOT PRICED (${tolerance}) — the gate abstained; uninsurable until sharpened.`);
    }
    console.log(`   ${reason}`);
    console.log(`   ⚖️  ${body.price.DISCLAIMER}`);
    console.log(`   sealed by underwriter ${underwriter.pubkey_hex.slice(0, 16)}… (independently-keyed role — distinct keys, one machine in this demo, not three real parties)`);
  }
  if (has('--json')) console.log(JSON.stringify(sealed, null, 2));
  process.exit(tolerance === 'INSIDE_TOLERANCE' ? 0 : tolerance === 'MARGINAL' ? 0 : tolerance === 'OUT_OF_TOLERANCE' ? 1 : 2);
}
main();
