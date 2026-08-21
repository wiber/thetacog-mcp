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

const out = { _this_is: 'ADVISORY PREMIUM — the first closed loop: a policy-shaped number from the public tape. NOT a filed rate; curve v0 is published to be criticized and superseded.', curve: CURVE };

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
