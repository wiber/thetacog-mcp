#!/usr/bin/env node
// scripts/economics/license-unit-economics.mjs
//
// bf-4673 — what one $20 agent-year licence actually costs us to serve.
//
// WHY THIS EXISTS. "We have zero overhead hosting costs" is true in the way that matters and false
// in the way a CFO will test it, and the repo currently cannot tell you which. Grep it and you get
// 85%, 96%, 97.6%, 99.9% and "zero marginal cost per transaction" — six different gross margins
// across six legacy docs, none derived, all quotable back at us in the same meeting. That is the
// asserted-number failure MEASURE DON'T ASSERT exists to stop, and it is the same one bf-4649 fixed
// for the 10,000-decisions figure.
//
// THE FINDING, stated up front because it is the point:
//   Our marginal cost per ATTESTATION is genuinely zero — the walk runs on the licensee's silicon,
//   so attestation volume never touches our infrastructure. Our marginal cost per SALE is not zero
//   and is not hosting: it is the payment rail. At self-serve card rates the processor takes 4.4%
//   of a single $20 unit. At fleet scale that same rail on a card would take 2.9% of ARR — on the
//   worked $1.2M account, more than every hosting line we run, by two orders of magnitude. The
//   finance answer is therefore not "zero cost", it is "our COGS is a payment decision, not an
//   engineering one" — and the decision is ACH.
//
// SUFFICIENCY CONTRACT (AXIOM 1, W6) — printed on every run:
//   SUFFICIENT FOR : the SHAPE of unit economics — which cost lines scale with attestation volume
//                    (none), with sale count (the rail), and with nothing (the fixed base); and the
//                    order of magnitude of each.
//   NOT SUFFICIENT FOR : an actual gross margin. The fixed-infrastructure inputs below are DECLARED
//                    list prices, not invoices. Nobody has reconciled them against a real Vercel /
//                    Supabase / Resend bill. Quote the structure, never the margin percentage,
//                    until that reconciliation exists.
//
// Usage:
//   node scripts/economics/license-unit-economics.mjs
//   node scripts/economics/license-unit-economics.mjs --json

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// THE UNIT — read from the live page, never retyped.
//
// The $100K harness was published as 15,000 agent-years for a while; it is $100K / $20 = 5,000, and
// the typo is called out in the page's own source comment. A number retyped into a model doc is a
// number that can drift away from the page a buyer is actually reading, so this parses it instead.
// ─────────────────────────────────────────────────────────────────────────────

export function readUnitPrice() {
  const src = readFileSync(resolve(REPO, 'src/app/pricing/page.tsx'), 'utf8');
  const m = src.match(/const\s+UNIT_PRICE\s*=\s*'\$(\d+(?:\.\d+)?)'/);
  if (!m) throw new Error('UNIT_PRICE not found in src/app/pricing/page.tsx — the model lost its anchor');
  return Number(m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// DECLARED INPUTS — every one a knob a hostile reader can turn.
// ─────────────────────────────────────────────────────────────────────────────

export const INPUTS = {
  // Stripe US list rates, checkable at stripe.com/pricing. Vendor list price, not a negotiated rate.
  cardRate: 0.029,
  cardFixed: 0.30,
  achRate: 0.008,
  achCap: 5.00,

  // Fixed infrastructure, DECLARED monthly list prices — NOT invoices. This is the softest input
  // here and the honest place to attack the model.
  fixedMonthlyLean: 67,    // Vercel Pro 20 + Supabase Pro 25 + Resend 20 + domain ~2
  fixedMonthlyLoaded: 500, // same plus overages, seats, a second project, error budget

  // What one attestation would cost if WE served it: one function invocation plus one durable row
  // write, at cloud list rates. A band, because the real figure depends on runtime and row size.
  hostedPerAttestationLow: 0.000005,
  hostedPerAttestationHigh: 0.00005,

  // The published meter: an agent-year is 365 days OR this many attestations, whichever comes first
  // (/cta, /pricing, /agent-year, the tape).
  meterAttestations: 10_000,

  // The worked account from docs/01-business/boi-bottom-up-license-model.md §2.
  accountHumans: 10_000,
  accountSubAgents: 50_000,
  harnessPrice: 100_000,

  // Measured, not declared: agent decisions per year off this repo's own tape at commit resolution.
  // Produced by scripts/economics/insurable-decision-rate.mjs (bf-4649), 30-day window, 2026-08-25.
  // Held as a constant here rather than re-walking git on every run; the guard re-walks and compares.
  measuredAgentCommitsPerYear: 21_194,
  measuredAgentHunksPerYear: 423_887,
};

// ─────────────────────────────────────────────────────────────────────────────
// DERIVATIONS
// ─────────────────────────────────────────────────────────────────────────────

export function paymentCost(amount, method, inputs = INPUTS) {
  if (method === 'card') return amount * inputs.cardRate + inputs.cardFixed;
  if (method === 'ach') return Math.min(amount * inputs.achRate, inputs.achCap);
  throw new Error(`unknown payment method: ${method}`);
}

export function buildModel(inputs = INPUTS) {
  const unit = readUnitPrice();

  // One unit, bought self-serve on a card. This is the true per-unit COGS at the small end.
  const oneUnitCard = paymentCost(unit, 'card', inputs);

  // The fleet account at steady state.
  const accountNodes = inputs.accountHumans + inputs.accountSubAgents;
  const accountARR = accountNodes * unit;
  const accountCard = paymentCost(accountARR, 'card', inputs);
  const accountAch = paymentCost(accountARR, 'ach', inputs);

  // Fixed base, and how many agent-years cover it.
  const fixedLean = inputs.fixedMonthlyLean * 12;
  const fixedLoaded = inputs.fixedMonthlyLoaded * 12;

  // The hosted counterfactual: what serving attestations ourselves would cost per agent-year, at
  // the metered ceiling and at the resolution the tape actually measures.
  const hosted = (n) => ({
    low: n * inputs.hostedPerAttestationLow,
    high: n * inputs.hostedPerAttestationHigh,
  });

  // The meter cross-check. The 10,000 came from a transcript. The tape is measured. If a busy agent
  // burns ~2 agent-years per calendar year, the meter predicts 2 x 10,000 = 20,000 commits/year.
  const meterPredictsPerCalendarYear = inputs.meterAttestations * 2;
  const meterVsMeasured = inputs.measuredAgentCommitsPerYear / meterPredictsPerCalendarYear;

  return {
    unit,
    harnessAgentYears: inputs.harnessPrice / unit,
    oneUnitCard,
    oneUnitCardPct: oneUnitCard / unit,
    accountNodes,
    accountARR,
    accountCard,
    accountCardPct: accountCard / accountARR,
    accountAch,
    accountAchPct: accountAch / accountARR,
    railSpread: accountCard - accountAch,
    fixedLean,
    fixedLoaded,
    breakEvenLean: fixedLean / unit,
    breakEvenLoaded: fixedLoaded / unit,
    hostedAtMeter: hosted(inputs.meterAttestations),
    hostedAtHunk: hosted(inputs.measuredAgentHunksPerYear),
    hostedAtHunkPctOfUnit: {
      low: hosted(inputs.measuredAgentHunksPerYear).low / unit,
      high: hosted(inputs.measuredAgentHunksPerYear).high / unit,
    },
    meterPredictsPerCalendarYear,
    meterVsMeasured,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const usd = (n) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString()}`);
const pct = (n) => `${(n * 100).toFixed(n < 0.001 ? 4 : 1)}%`;

function print(m) {
  const L = [];
  L.push('');
  L.push('  LICENCE UNIT ECONOMICS — what one agent-year costs us to serve (bf-4673)');
  L.push('');
  L.push(`  THE UNIT — read from src/app/pricing/page.tsx, not retyped`);
  L.push(`    unit price                 ${usd(m.unit)} / agent-year`);
  L.push(`    $100K harness              ${m.harnessAgentYears.toLocaleString()} agent-years  (${usd(100000)} / ${usd(m.unit)})`);
  L.push('');
  L.push('  COST PER ATTESTATION — the one that is actually zero');
  L.push(`    served by us at the meter ceiling (${INPUTS.meterAttestations.toLocaleString()} attestations)`);
  L.push(`                               ${usd(m.hostedAtMeter.low)} .. ${usd(m.hostedAtMeter.high)} per agent-year`);
  L.push(`    served by us at the resolution the tape measures (${INPUTS.measuredAgentHunksPerYear.toLocaleString()} hunks/yr)`);
  L.push(`                               ${usd(m.hostedAtHunk.low)} .. ${usd(m.hostedAtHunk.high)}  = ${pct(m.hostedAtHunkPctOfUnit.low)} .. ${pct(m.hostedAtHunkPctOfUnit.high)} of the unit`);
  L.push(`    served on the licensee's silicon (what we ship)`);
  L.push(`                               $0.00 — the walk never touches our infrastructure`);
  L.push('');
  L.push('  COST PER SALE — the one that is not zero, and is not hosting');
  L.push(`    one unit, self-serve card  ${usd(m.oneUnitCard)}  = ${pct(m.oneUnitCardPct)} of the unit`);
  L.push(`    ${m.accountNodes.toLocaleString()}-node account      ${usd(m.accountARR)} ARR`);
  L.push(`      paid by card             ${usd(m.accountCard)}  = ${pct(m.accountCardPct)} of ARR`);
  L.push(`      paid by ACH              ${usd(m.accountAch)}  = ${pct(m.accountAchPct)} of ARR`);
  L.push(`      the rail decision is worth ${usd(m.railSpread)} on this one account`);
  L.push('');
  L.push('  FIXED BASE — declared list prices, NOT invoices');
  L.push(`    lean                       ${usd(m.fixedLean)} / yr   covered by ${Math.ceil(m.breakEvenLean)} agent-years`);
  L.push(`    loaded                     ${usd(m.fixedLoaded)} / yr   covered by ${Math.ceil(m.breakEvenLoaded)} agent-years`);
  L.push('');
  L.push('  THE METER, CROSS-CHECKED AGAINST THE TAPE');
  L.push(`    "365 days or ${INPUTS.meterAttestations.toLocaleString()} attestations" x ~2 agent-years/calendar year`);
  L.push(`      predicts                 ${m.meterPredictsPerCalendarYear.toLocaleString()} / yr`);
  L.push(`      this repo's tape measures ${INPUTS.measuredAgentCommitsPerYear.toLocaleString()} / yr at commit resolution`);
  L.push(`      ratio                    ${m.meterVsMeasured.toFixed(2)}x — the transcript's meter is recoverable from a measurement`);
  L.push('');
  L.push('  SUFFICIENCY CONTRACT — SUFFICIENT FOR: the SHAPE of the cost structure and the order of');
  L.push('    magnitude of each line. NOT SUFFICIENT FOR: a gross margin percentage. The fixed inputs');
  L.push('    are declared list prices, never reconciled against an invoice. Quote the structure.');
  L.push('');
  return L.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const m = buildModel();
  if (process.argv.includes('--json')) console.log(JSON.stringify(m, null, 2));
  else console.log(print(m));
}
