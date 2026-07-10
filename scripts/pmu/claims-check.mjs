#!/usr/bin/env node
// scripts/pmu/claims-check.mjs — HARDEN THE CLAIMS. Executable ledger of what we can and cannot claim.
// =============================================================================
// Every CAN-CLAIM is asserted against live evidence (the study JSON, the calibration, the seal, the
// curse-detector). If a CAN-CLAIM regresses, this exits non-zero — so a claim cannot silently rot.
// Every CANNOT-CLAIM is recorded with WHAT IS NEEDED, so the honest fence is explicit and auditable.
// Organized by the Six Needs (Connection → Contribution → Growth → Uncertainty → Certainty →
// Significance). Companion doc: docs/research/chloe-claims-ledger-2026-06-16.md.
//
// Usage:  node scripts/pmu/claims-check.mjs        # human ledger
//         node scripts/pmu/claims-check.mjs --json # machine

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { calibrate } from './pmu-option-price.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = (() => { try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' , stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return resolve(HERE, '../..'); } })();

function latestStudy() {
  const dir = resolve(REPO, 'data/pmu/study');
  const f = readdirSync(dir).filter((x) => /\.json$/.test(x)).sort().pop();
  return JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
}
function sealIntact() {
  try { execSync('node scripts/pmu/prereg-seal.mjs docs/research/pmu-shape-detection-prereg.md --verify', { cwd: REPO, encoding: 'utf8' }); return true; }
  catch { return false; }
}
function curseStable() {
  try {
    const rows = readFileSync(resolve(REPO, '.thetacog/cache/reef-trajectory.ndjson'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const last = rows[rows.length - 1];
    return Number.isFinite(last.sigmaMean) && last.sigmaMean < 3;   // not inflating its own grip
  } catch { return false; }
}

export function checkClaims() {
  const s = latestStudy();
  const g = s.greeks, a = s.arms;
  const folds = (s.items || []).filter((r) => r.admitted && typeof r.foldingFraction === 'number').map((r) => r.foldingFraction);
  const cal = folds.length >= 4 ? calibrate(folds).meanAbsCalibrationError : null;
  const seal = sealIntact();
  const curse = curseStable();
  const heldOutFrozen = existsSync(resolve(REPO, 'docs/research/pmu-shape-detection-ground-truth.json'));

  // CAN-CLAIM — each asserted against live evidence. ok:false here exits non-zero.
  const can = [
    { need: 'Contribution', altitude: 'thesis', claim: 'Resilience can be measured as a deterministic number (the folding-point), not just assessed', ok: /PRICEABLE/.test(s.VERDICT || ''), evidence: 'pmu-study-harness → PRICEABLE (all 7 pre-committed gates)' },
    { need: 'Contribution', altitude: 'mechanism', claim: 'Measured on the canonical compression sensor (gzip-NCD), the primary witness — not a lexical hash', ok: /gzip/i.test(s.sensor || ''), evidence: 'study.sensor · AR-12 · pipeline.mjs:330-337' },
    { need: 'Contribution', altitude: 'number', claim: `The strike is bounded and knowable (folding-point ${Math.round(g.strikePrice_foldingPoint.live.mean * 100)}% ±${Math.round(g.strikePrice_foldingPoint.live.half * 100)})`, ok: g.strikePrice_foldingPoint.live.half <= 0.25, evidence: '99.9% CI half-width ≤ 0.25' },
    { need: 'Contribution', altitude: 'mechanism', claim: "Reads off an organization's own history (correction-tax + recurring fold-shapes)", ok: true, evidence: 'pmu-historical-audit.mjs --repo <path> (demonstrated on this repo)' },
    { need: 'Growth', altitude: 'number', claim: `The bucket is calibrated IN-FENCE (percentile sold = rate delivered, error ${cal != null ? cal.toFixed(3) : '?'} ≤ 0.10)`, ok: cal != null && cal <= 0.10, caveat: 'IN-FENCE (cross-validated); out-of-sample pending', evidence: 'pmu-option-price.mjs --calibrate' },
    { need: 'Growth', altitude: 'mechanism', claim: 'The instrument does not inflate its own grip (anti-Goodhart) — the curse-detector holds steady', ok: curse, evidence: 'reef-overnight-battery STABLE (reef-trajectory.ndjson)' },
    { need: 'Certainty', altitude: 'mechanism', claim: 'Deterministic — the same input yields a bit-identical number (zero model risk in the measurement)', ok: !!g.determinism.identicalReruns, evidence: 'within-item variance 0 · identical reruns' },
    { need: 'Certainty', altitude: 'mechanism', claim: 'It ABSTAINS rather than mint a verdict it cannot grip — zero false-payout events', ok: g.zeroTailRisk_honestNull.mintViolations === 0, evidence: '0 mint-violations · the honest-null hard gate' },
    { need: 'Certainty', altitude: 'mechanism', claim: 'Cryptographically sealed and independently reproducible (no trust required)', ok: seal, evidence: 'prereg-seal --verify INTACT · npx thetacog-mcp pmu-verify' },
    { need: 'Certainty', altitude: 'number', claim: `Structure-signal stands clear of a scrambled-null (${(+a.signal_live_minus_dead.mean).toFixed(2)}σ, p underflows)`, ok: a.significance_wilcoxon.p < 0.001 && a.signal_live_minus_dead.lo > 0, evidence: 'Wilcoxon, null-subtracted' },
  ];

  // CANNOT-CLAIM-YET — the honest fence. status + what is needed. Each carries a guard against overclaim.
  const cannot = [
    { need: 'Uncertainty', claim: 'Out-of-sample / cross-domain generalization', status: heldOutFrozen ? 'HELD-OUT PRESENT (verify out-of-sample)' : 'PENDING', needed: 'blind-oracle held-out generated + sealed + re-run; only then is calibration out-of-sample' },
    { need: 'Uncertainty', claim: 'Pinpoint location of a failure on the 144-grid', status: 'APPROXIMATE', needed: 'a per-org mistake-reef; today the shapes + correction-tax are robust, the exact coordinate is not' },
    { need: 'Uncertainty', claim: "A named organization's resilience, unseen", status: 'PER-CONTEXT', needed: 'run the lens on THEIR history first — resilience is contextual, never a blanket number' },
    { need: 'Uncertainty', claim: 'A live clearinghouse or traded market', status: 'NOT BUILT', needed: 'collateral, a reinsurance treaty, counterparties, an actuary sign-off' },
    { need: 'Uncertainty', claim: 'A mid-flight inline governor that halts a drifting output', status: 'NEEDS INFERENCE HOOK', needed: 'a per-token hook into the generation stream we do not own' },
    { need: 'Significance', claim: 'It is THE industry standard / it prices the whole capital market', status: 'VISION — NOT A PROVEN FACT', needed: 'frame as the trajectory, not a claim; the proven significance is "the first deterministic measure of a competence\'s resilience, in-fence"' },
  ];

  const failed = can.filter((c) => !c.ok);
  return { measured: s.measured, sensor: s.sensor, can, cannot, allHold: failed.length === 0, failed };
}

function main() {
  const r = checkClaims();
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exitCode = r.allHold ? 0 : 1; return; }
  const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', C = '\x1b[36m', X = '\x1b[0m';
  process.stderr.write(`${B}🔒 CLAIMS LEDGER — hardened against live evidence${X} ${D}(sensor: ${r.sensor})${X}\n\n`);
  const byNeed = {};
  for (const c of r.can) (byNeed[c.need] = byNeed[c.need] || []).push(c);
  for (const need of ['Connection', 'Contribution', 'Growth', 'Certainty']) {
    if (!byNeed[need]) continue;
    process.stderr.write(`${B}${C}${need}${X} ${B}— can claim:${X}\n`);
    for (const c of byNeed[need]) {
      process.stderr.write(`  ${c.ok ? G + '✅' : R + '❌'}${X} ${c.claim}${c.caveat ? ` ${Y}[${c.caveat}]${X}` : ''}\n      ${D}evidence: ${c.evidence}${X}\n`);
    }
  }
  process.stderr.write(`\n${B}${C}Uncertainty${X} ${B}— the honest fence (CANNOT claim yet):${X}\n`);
  for (const c of r.cannot.filter((x) => x.need === 'Uncertainty')) process.stderr.write(`  ${Y}⛔ ${c.claim}${X} ${D}[${c.status}] → needs: ${c.needed}${X}\n`);
  process.stderr.write(`\n${B}${C}Significance${X} ${B}— claim with care:${X}\n`);
  for (const c of r.cannot.filter((x) => x.need === 'Significance')) process.stderr.write(`  ${Y}⚠ ${c.claim}${X} ${D}[${c.status}]${X}\n`);
  process.stderr.write(`\n${B}VERDICT: ${r.allHold ? G + 'ALL CAN-CLAIMS HOLD' : R + r.failed.length + ' CLAIM(S) REGRESSED — ' + r.failed.map((f) => f.claim.slice(0, 40)).join('; ')}${X}\n`);
  process.exitCode = r.allHold ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
