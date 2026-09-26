#!/usr/bin/env node
// scripts/pmu/advisory-premium.mjs — THE FIRST CLOSED LOOP: an ADVISORY premium computed from the tape.
//
//   npx thetacog-mcp advisory-premium
//
// The tipping point is not a better sensor — it is the first policy-shaped number issued against a
// live repo with a public tape, recomputable by a stranger. This receipt is that number, honestly
// labeled: ADVISORY. The curve below is v0 — published, deterministic, versioned, and NOT an
// actuarially filed rate. It exists so it can be criticized, calibrated against loss experience,
// and superseded by v1 with a diff anyone can read. Mock the market's paperwork, never its math:
// every input here is measured, only the WEIGHTS are provisional.
//
// Inputs (all LLM-free, all from the record):
//   · tape/measure-history.ndjson — the per-commit drift series (sha, sigmaDrift, offPct, …).
//     SAME semantics as the lens's 📈 series line (prompt-lens.mjs SERIES_SNAPSHOT): vega is the
//     sample stddev of sigmaDrift; breach here uses the GATE's kill threshold (offPct > 25),
//     which is stricter than the lens's >15 diagnostic line — both are printed.
//   · attest-out/trigger-battery.json — the sensor-calibration annex (which miss classes the gate
//     catches in this domain), if the battery has been run. Absent ⇒ SENSOR-UNCALIBRATED note.
//
// FAIL-CLOSED (the series-level aperture floor): fewer than 30 rows ⇒ REFUSED, no premium — a
// thin series is never priced, exactly as a starved sensor is never a pass.
//
// Output is timestamp-free: two runs over the same tape diff to zero bytes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// --series <path>: price a caller-supplied series (e.g. vega-backtest output for a new fork's
// day-one vega) instead of the shipped tape. Same math, same floors — only the input moves.
const argIdx = process.argv.indexOf('--series');
const override = argIdx > 0 ? resolve(process.cwd(), process.argv[argIdx + 1] || '') : null;
const CANDIDATES = ['tape/measure-history.ndjson', 'data/pmu/measure-history.ndjson'];
const seriesPath = override && existsSync(override) ? override
  : CANDIDATES.map((p) => resolve(PKG, p)).find((p) => existsSync(p));

// ── CURVE v0 — every constant published, none of them filed ─────────────────────────────
const CURVE = {
  version: 'v0-advisory',
  baseCreditsPerAgentMonth: 100,           // denominated in GPU-credit-hours (in-kind, never fiat)
  wBreach: 2.0,                            // 1pt of premium per 0.5% breach rate at kill@25
  wVega: 0.10,                             // stability loading — the operator's word for the priced quantity
  wKurt: 0.05,                             // tail loading (fence-hugger exposure) — applies to EXCESS kurtosis > 0
  minRows: 30,                             // the series aperture floor — below this, REFUSED
  killPct: 25,                             // the gate's kill threshold; breach = share of rows above it
};

// ── THE REMEDIATION SCHEDULE v0 — what a trigger actually BUYS, denominated in hours ────
// The premium above is a price. This is the LOSS SIDE: the thing the reserve has to be able
// to deliver when a reading breaches. It matters more than the price for anyone funding the
// reserve, because an hour is boundable and a cash indemnity is not — you can buy compute
// hours on a market and engineering hours off a rate card, so the maximum draw per event is
// known before the event happens. That is the whole reason the payout is in kind.
//
// Bands are selected by the RECEIPT'S OWN FIELDS, never by an adjuster: the gate's kill
// threshold (offPct > killPct) and the lens's diagnostic line (offPct > 15) already exist and
// are already published, so band selection is recomputable by anyone holding the tape.
// PERSISTENCE is the third band because a single breach and a breach that will not clear are
// different failures: a run of >= persistRun consecutive breaching readings is a region that
// is not resolving, and it draws the deep bundle.
//
// EVERY NUMBER HERE IS v0-ADVISORY AND PROPOSED, NOT FILED. The build plan's decision point
// (3 bands, thresholds published with the T5 hardening documents) is still open; this is the
// concrete proposal it will supersede. Published so it can be attacked with arithmetic rather
// than discussed in the abstract.
const REMEDIATION = {
  version: 'v0-advisory-proposed',
  supersededBy: 'the T5 hardening documents — thresholds, bundles and ceilings fixed there, per pool, in the paper',
  persistRun: 3,
  unit: 'hours',
  bands: [
    {
      id: 'B1',
      name: 'DIAGNOSTIC',
      selects: 'offPct > 15 and <= killPct — the lens diagnostic line, below the gate kill',
      engineerHours: 2,
      computeHours: 8,
      maxCompensableHours: 4,
      response: 'triage by the pixel holder; no dispatch unless it repeats',
    },
    {
      id: 'B2',
      name: 'BREACH',
      selects: 'offPct > killPct — the gate\'s own kill threshold, single reading',
      engineerHours: 8,
      computeHours: 40,
      maxCompensableHours: 12,
      response: 'dispatch to the highest-confidence pixel holder over the failure region',
    },
    {
      id: 'B3',
      name: 'PERSISTENT',
      selects: 'offPct > killPct on persistRun or more consecutive readings — a region that is not resolving',
      engineerHours: 24,
      computeHours: 120,
      maxCompensableHours: 32,
      response: 'deep bundle: pixel holder plus a second accredited pair, until the region lands back in lane',
    },
  ],

  // ── THE FOUR LABOUR RULES — the holes a "loose freelancer board" would leave open ──────
  // Each one closes a specific failure that has nothing to do with the sensor and everything
  // to do with whether a reserve can be funded. They are stated as machine-readable fields
  // because the whole architecture's claim is that dispatch, scope, clearance and eligibility
  // are decided by rule rather than by anybody's judgment during an incident.
  rules: {
    // R1 — the pixel holder may be asleep. Coverage cannot depend on a person being awake.
    dispatch: {
      rule: 'DISPATCH TIMEOUT + FAILOVER',
      acceptanceWindowHours: 2,
      cascade: ['rank-1 pixel holder', 'rank-2 pixel holder', 'accredited general bench'],
      note: 'unacknowledged inside the window cascades automatically; each hop is logged on the tape, so a slow network is measurable rather than deniable',
    },
    // R2 — an open-ended hour count is a cash indemnity wearing an in-kind costume.
    scope: {
      rule: 'CAPPED SCOPE — NO OPEN-ENDED BURN',
      note: 'each band carries a maximum compensable hour ceiling pre-funded by the retainer; work beyond the ceiling needs a NEW trigger or a deployer co-pay, never a bigger invoice on the same event',
    },
    // R3 — "is it fixed?" is the question that reintroduces the adjuster. It is a recompute.
    clearance: {
      rule: 'CLEARANCE IS A RECEIPT, NOT AN OPINION',
      note: 'payout is zero until a new commit passes the same attestation that failed and seals a receipt putting the region back inside the band; the fixer does the work, the tape issues the verdict',
    },
    // R4 — the bounty must never pay the party that caused the breach.
    eligibility: {
      rule: 'ANTI-SELF-DEALING FIREWALL',
      note: 'the author of the drifted commit and anyone inside the deployer organisation are ineligible for the bounty on that breach; the payer and the payee can never be the same book',
    },
  },
};

const out = { _this_is: 'ADVISORY PREMIUM — the first closed loop: a policy-shaped number from the public tape. NOT a filed rate; curve v0 is published to be criticized and superseded.', curve: CURVE, remediation: REMEDIATION };

if (!seriesPath) {
  out.state = 'REFUSED';
  out.reason = 'no drift series found (tape/measure-history.ndjson) — a repo with no tape has no premium';
} else {
  const rows = readFileSync(seriesPath, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sig = rows.map((r) => Number(r.sigmaDrift)).filter(Number.isFinite);
  const off = rows.map((r) => Number(r.offPct)).filter(Number.isFinite);
  out.seriesSha = createHash('sha256').update(readFileSync(seriesPath)).digest('hex').slice(0, 16);
  out.n = rows.length;
  if (rows.length < CURVE.minRows || sig.length < CURVE.minRows) {
    out.state = 'REFUSED';
    out.reason = `series aperture floor: ${rows.length} rows < ${CURVE.minRows} — a thin series is never priced`;
  } else {
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mS = mean(sig);
    const vega = Math.sqrt(sig.reduce((a, x) => a + (x - mS) * (x - mS), 0) / (sig.length - 1));
    const mO = mean(off);
    const sdO = Math.sqrt(off.reduce((a, x) => a + (x - mO) * (x - mO), 0) / (off.length - 1)) || 1;
    const kurtExcess = off.reduce((a, x) => a + ((x - mO) / sdO) ** 4, 0) / off.length - 3;
    const breach = off.filter((x) => x > CURVE.killPct).length / off.length;
    const breach15 = off.filter((x) => x > 15).length / off.length;   // the lens's diagnostic line, for cross-reference
    const multiplier = 1 + CURVE.wBreach * breach + CURVE.wVega * vega + CURVE.wKurt * Math.max(0, kurtExcess);
    out.state = 'ADVISORY';
    out.measured = {
      vega: +vega.toFixed(2),                       // stddev of sigmaDrift — the priced stability
      breachPctAtKill: +(100 * breach).toFixed(1),  // offPct > 25 (the gate's own threshold)
      breachPctAt15: +(100 * breach15).toFixed(1),  // the lens diagnostic, printed for cross-reference
      kurtosisExcess: +kurtExcess.toFixed(2),       // tail shape — the fence-hugger exposure signal
      note: 'raw series — the scope-gate (off-lane-as-scope-breadth correction) is NOT yet applied; the sealed rate will be lower',
    };
    out.advisoryPremium = {
      creditsPerAgentMonth: Math.round(CURVE.baseCreditsPerAgentMonth * multiplier),
      multiplier: +multiplier.toFixed(3),
      denomination: 'GPU-credit-hours (in-kind remediation credits — never fiat indemnity)',
    };

    // ── THE LOSS SIDE, MEASURED ON THIS TAPE ───────────────────────────────────────────
    // Classify every reading into a band by the published rule and count what the schedule
    // would actually have dispatched over this series. Nothing here is an estimate: it is the
    // same rows the premium is priced from, run through the band selector. Rows inside a
    // persistent run are B3 and are NOT also counted as B2 — one event, one band.
    const kill = off.map((x) => x > CURVE.killPct);
    const inRun = kill.map(() => false);
    for (let i = 0; i < kill.length; i += 1) {
      if (!kill[i]) continue;
      let j = i;
      while (j < kill.length && kill[j]) j += 1;
      if (j - i >= REMEDIATION.persistRun) for (let k = i; k < j; k += 1) inRun[k] = true;
      i = j - 1;
    }
    const counts = { B1: 0, B2: 0, B3: 0 };
    off.forEach((x, i) => {
      if (inRun[i]) counts.B3 += 1;
      else if (kill[i]) counts.B2 += 1;
      else if (x > 15) counts.B1 += 1;
    });
    const band = (id) => REMEDIATION.bands.find((b) => b.id === id);
    const engineerHours = Object.entries(counts)
      .reduce((a, [id, n]) => a + n * band(id).engineerHours, 0);
    const computeHours = Object.entries(counts)
      .reduce((a, [id, n]) => a + n * band(id).computeHours, 0);
    const ceilingHours = Object.entries(counts)
      .reduce((a, [id, n]) => a + n * band(id).maxCompensableHours, 0);
    out.lossSide = {
      _this_is: 'what the published schedule would have dispatched over THIS series — measured, not modelled',
      events: counts,
      eventsTotal: counts.B1 + counts.B2 + counts.B3,
      readings: off.length,
      engineerHours,
      computeHours,
      engineerHoursCeiling: ceilingHours,        // the maximum compensable exposure, by rule
      engineerHoursPerHundredReadings: +((100 * engineerHours) / off.length).toFixed(1),
      note: 'engineerHoursCeiling is the CAP, not a forecast: beyond it, an event needs a new trigger or a deployer co-pay. The bounded number is the point — an hour ceiling is what a cash indemnity does not have.',
    };
  }
  // sensor-calibration annex — the battery rows, if this domain has run them
  const batteryPath = resolve(process.cwd(), 'attest-out/trigger-battery.json');
  if (existsSync(batteryPath)) {
    try {
      const b = JSON.parse(readFileSync(batteryPath, 'utf8'));
      const count = (st) => b.rows.filter((r) => r.status === st).length;
      out.sensorCalibration = { match: count('MATCH'), documentedHole: count('DOCUMENTED-HOLE'), mismatch: count('MISMATCH'), regression: count('REGRESSION'), source: 'attest-out/trigger-battery.json' };
    } catch { /* annex best-effort */ }
  } else {
    out.sensorCalibration = { note: 'SENSOR-UNCALIBRATED — run `npx thetacog-mcp trigger-battery` to measure which miss classes the gate catches in this domain before trusting the premium' };
  }
}

mkdirSync(resolve(process.cwd(), 'attest-out'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'attest-out/advisory-premium.json'), JSON.stringify(out, null, 2));

console.log('══════ ADVISORY PREMIUM — the first closed loop (curve v0, published to be criticized) ══════');
if (out.state === 'REFUSED') {
  console.log(`  REFUSED — ${out.reason}`);
} else {
  const m = out.measured, p = out.advisoryPremium;
  console.log(`  series n=${out.n} (sha ${out.seriesSha})`);
  console.log(`  vega ${m.vega} · breach@kill ${m.breachPctAtKill}% (offPct>25) · breach@15 ${m.breachPctAt15}% · kurtosis-excess ${m.kurtosisExcess}`);
  console.log(`  → ADVISORY premium: ${p.creditsPerAgentMonth} GPU-credit-hours / agent-month (multiplier ${p.multiplier})`);
  console.log(`  ⚠ ${m.note}`);
  const sc = out.sensorCalibration;
  console.log(sc.match != null ? `  sensor calibration: ${sc.match} MATCH · ${sc.documentedHole} DOCUMENTED-HOLE · ${sc.mismatch} MISMATCH · ${sc.regression} REGRESSION` : `  ${sc.note}`);
}
console.log('  → attest-out/advisory-premium.json (timestamp-free; two runs diff to zero bytes)');
