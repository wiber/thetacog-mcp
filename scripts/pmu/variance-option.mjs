// scripts/pmu/variance-option.mjs — the THIRD money-flow rail: the options layer, v0.
//
// The insurance rail (calibration-premium.mjs) prices a PUT on the coordinate staying in lane:
// it pays the buyer of protection when the work drifts out. The options rail prices the thing a
// TRADER wants — a bet on the lane's SEMANTIC VOLATILITY itself, settled at machine speed. This is
// spec §IV "Options": "traders buy and sell options on the expected variance of agentic supply chains."
//
// THE INSTRUMENT — a variance swap on a reef-lane:
//   underlying        = realized semantic variance of the lane = var(driftPct) over a window.
//   K_var (strike)    = the FAIR variance = the historical mean of windowed realized variances.
//                       (A variance swap's fair strike is the expected future realized variance.)
//   payoff (per vega) = notional × (realized_var − K_var).  Long pays off when the lane gets
//                       MORE volatile than the market expected; short pays off when it calms.
//   vol-of-vol        = std of the windowed realized variances = the uncertainty IN the strike,
//                       which sets the bid/ask spread around the fair strike.
//
// WHY THIS IS ONLY POSSIBLE HERE (the whole thesis): a variance swap needs a realized variance
// that two strangers can agree on without trusting each other. An LLM "confidence" cannot settle a
// swap — it is not recomputable. driftPct IS recomputable (prove-rice --check, byte-identical), so
// its variance is a settleable underlying. The decidable measurement is what makes the derivative exist.
//
// DESIGN RULE: this rail consumes the SAME ledger and the SAME driftPct as the insurance rail — one
// measurement, two instruments. Never invent a second underlying; the whole point is one number.
//
// Usage:
//   node scripts/pmu/variance-option.mjs [--window 20] [--notional 1000] [--spread-k 1.0] [--json]
// Pure Node built-ins; deterministic over the ledger; no network, no new deps.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// See calibration-premium.mjs for the full note: prefer cwd-relative (dev convenience), fall back
// to resolving next to THIS script so the bundled npm copy works regardless of caller cwd. Fixed
// 2026-07-04 alongside the same bug in calibration-premium.mjs.
const LEDGER_REL = 'data/pmu/measure-history.ndjson';
const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = existsSync(LEDGER_REL) ? LEDGER_REL : resolve(HERE, '..', '..', LEDGER_REL);

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined ? def : v;
}
const WINDOW = Math.max(2, Number(arg('--window', '20')));  // rolling window for realized variance
const NOTIONAL = Number(arg('--notional', '1000'));          // vega notional per swap
const SPREAD_K = Number(arg('--spread-k', '1.0'));           // bid/ask = K_var ± SPREAD_K·volOfVol
const AS_JSON = process.argv.includes('--json');

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function variance(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}
function std(xs) { return Math.sqrt(variance(xs)); }

// ── read + order the ledger (clean rows only; suspect rows are a wrong-metric risk) ──
let rows;
try {
  rows = readFileSync(LEDGER, 'utf8').trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && typeof r.driftPct === 'number' && !r.ingestSuspect);
} catch (e) {
  console.error(`cannot read ${LEDGER}: ${e.message}`);
  process.exit(1);
}
rows.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));

// bucket by lane (the reef IS the lane)
const lanes = new Map();
for (const r of rows) {
  const key = r.reefSha || 'unknown';
  if (!lanes.has(key)) lanes.set(key, []);
  lanes.get(key).push(r.driftPct);
}

const report = [];
for (const [lane, series] of lanes) {
  if (series.length < WINDOW) {
    report.push({ lane, n: series.length, status: 'INSUFFICIENT', need: WINDOW });
    continue;
  }
  // rolling realized variance over the window
  const realized = [];
  for (let i = 0; i + WINDOW <= series.length; i++) realized.push(variance(series.slice(i, i + WINDOW)));

  const Kvar = mean(realized);          // fair variance strike
  const volOfVol = std(realized);       // uncertainty in the strike → spread
  const spotVar = realized[realized.length - 1]; // most-recent realized variance
  const bid = Math.max(0, Kvar - SPREAD_K * volOfVol);
  const ask = Kvar + SPREAD_K * volOfVol;
  // a long position struck at the fair K_var, marked to the latest realized variance:
  const markToMarket = NOTIONAL * (spotVar - Kvar);

  report.push({
    lane,
    n: series.length,
    window: WINDOW,
    fairVarianceStrike: Kvar,
    fairVolStrike: Math.sqrt(Kvar),
    volOfVol,
    spotVariance: spotVar,
    quote: { bid, ask },
    longMarkToMarket: markToMarket,
    status: 'QUOTED',
  });
}

if (AS_JSON) {
  console.log(JSON.stringify({ window: WINDOW, notional: NOTIONAL, spreadK: SPREAD_K, lanes: report }, null, 2));
  process.exit(0);
}

const rule = () => console.log('  ' + '─'.repeat(74));
console.log('\n  SEMANTIC VARIANCE SWAP — the options rail, priced from the ledger');
rule();
console.log(`  ledger        ${LEDGER}   ·   ${rows.length} clean attestations`);
console.log(`  underlying    realized variance of driftPct over a ${WINDOW}-attestation window`);
console.log(`  notional      ${NOTIONAL} per vega   ·   spread = K_var ± ${SPREAD_K}·vol-of-vol`);
rule();
for (const r of report) {
  if (r.status === 'INSUFFICIENT') {
    console.log(`\n  LANE ${r.lane}   [INSUFFICIENT]   ${r.n} attestations, need ≥ ${r.need} for a ${WINDOW}-window`);
    continue;
  }
  console.log(`\n  LANE ${r.lane}   [QUOTED]`);
  console.log(`    n attestations      ${r.n}   (window ${r.window})`);
  console.log(`    fair variance K_var ${r.fairVarianceStrike.toFixed(3)}   (fair vol ${r.fairVolStrike.toFixed(3)})`);
  console.log(`    vol-of-vol          ${r.volOfVol.toFixed(3)}   → the spread`);
  console.log(`    spot realized var   ${r.spotVariance.toFixed(3)}   (latest window)`);
  console.log(`    QUOTE  bid ${r.quote.bid.toFixed(3)}   /   ask ${r.quote.ask.toFixed(3)}   (variance points)`);
  console.log(`    long mark-to-market ${r.longMarkToMarket.toFixed(1)}  = notional × (spot − K_var)`);
  const lean = r.spotVariance > r.fairVarianceStrike ? 'ABOVE fair — lane is heating up (long pays)' : 'AT/BELOW fair — lane is calm (short pays)';
  console.log(`    read                ${lean}`);
}
rule();
console.log('  ONE MEASUREMENT, TWO INSTRUMENTS: the same recomputable driftPct that the insurance rail');
console.log('  prices as a breach FREQUENCY, this rail prices as a tradable VARIANCE. Settleable because a');
console.log('  stranger can recompute the underlying — an LLM confidence score never could.\n');
