#!/usr/bin/env node
// scripts/pmu/onchain-settle.mjs — THE TRANSACTIONAL RESOLUTION (npx, v0).
//
// This is the whole money-flow chain in one command: a spec resolves into reality via the
// ballistic walk, the resulting driftPct/verdict becomes the on-chain PAYLOAD, and that payload
// drives the full InLanePolicy lifecycle — writePolicy → resolution → claim/reclaim — with the
// premium the buyer paid (calibrated from the ledger) and the live variance quote at trade time.
//
// It does NOT need an RPC, a funded key, or Foundry. It (1) emits the REAL ReefAttestation.anchor()
// calldata (ready to broadcast), and (2) runs a faithful JS mirror of the two contracts'
// state machine so a user sees the settlement deterministically, on their own machine. The chain
// deploy is the last mile; the resolution it settles on is provable here, now.
//
// THE CONTRACT TRUTH IT MIRRORS (contracts/ReefAttestation.sol + InLanePolicy.sol):
//   isInLane  == (verdict == IN_ROLE)        — only IN_ROLE holds the lane.
//   claim()   pays the beneficiary iff verdict == OFF_DOMAIN (the decidable breach — never on
//             UNPLACEABLE; C401a: an abstention is not a loss).
//   reclaim() returns escrow to the insurer iff verdict == IN_ROLE after expiry (the agent held its
//             lane — never on UNPLACEABLE either; an abstention is not a held lane).
//   UNPLACEABLE (the issuer's two witnesses disagreed) settles as REFERRED — a third state, never
//   CLAIM or RECLAIM: no automatic pay, no automatic return. The claim goes to the adjuster with the
//   receipt attached (InLanePolicy.refer() / resolveReferred()). decideSettlement() below is the pure
//   function this script and its guard (tests/vna/c401a-an-abstention-is-not-a-loss.test.mjs) share.
//
// THE FENCE: this settles on WHERE the work landed (decidable, anchored, recomputable). It never
// adjudicates WHETHER the work was good. The trigger is a coordinate, not a courtroom.
//
// Usage:
//   node scripts/pmu/onchain-settle.mjs [--receipt <path>] [--coverage 10000] [--ledger <ndjson>] [--json]
//   (no --receipt → uses the most recent receipt in ~/.thetacog/pmu/receipts/)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const AS_JSON = process.argv.includes('--json');
const COVERAGE = Number(arg('--coverage', '10000'));

// ── locate the receipt (explicit, or the latest on disk) ──────────────────────
function latestReceipt() {
  const dir = path.join(homedir(), '.thetacog', 'pmu', 'receipts');
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
      .map(f => ({ f: path.join(dir, f), m: statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0]?.f || null;
  } catch { return null; }
}
const receiptPath = arg('--receipt', null) || latestReceipt();
if (!receiptPath) {
  console.error('no receipt found. Run `npx thetacog-mcp attest-demo` first, or pass --receipt <path>.');
  process.exit(1);
}
const r = JSON.parse(readFileSync(receiptPath, 'utf8'));

// ── extract the on-chain scalars (mirrors onchain-anchor.mjs) ─────────────────
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const ENVELOPE = new Set(['signature', 'signature_algorithm', 'sig_hex', 'sha256']);
const body = {}; for (const k of Object.keys(r)) if (!ENVELOPE.has(k)) body[k] = r[k];
const bodyHash = '0x' + sha256(JSON.stringify(body));
const receiptId = '0x' + sha256(r.receipt_id || receiptPath);
const VERDICT = { UNPLACEABLE: 0, IN_ROLE: 1, OFF_DOMAIN: 2 };
const verdictName = r.verdict || 'UNPLACEABLE';
const verdict = VERDICT[verdictName] ?? 0;
const isInLane = verdict === 1; // contract truth: only IN_ROLE holds the lane
const sigma = r.gzip_witness?.sigma ?? r.physical_execution?.witness_simhash?.gzip_sigma ?? r.sigma ?? 0;
const sigmaMilli = Math.round(Number(sigma) * 1000);
const hostSignature = r.signature ? ('0x' + String(r.signature).replace(/^0x/, '')) : '0x';

// ── pull the calibrated premium + variance quote from the sibling rails ───────
function siblingJson(script, extra = []) {
  const res = spawnSync('node', [path.join(HERE, script), '--json', ...extra], { encoding: 'utf8' });
  if (res.status !== 0 || !res.stdout) return null;
  try { return JSON.parse(res.stdout); } catch { return null; }
}
const ledgerArgs = arg('--ledger', null) ? [] : []; // scripts default to data/pmu/measure-history.ndjson (cwd-relative)
const premiumData = siblingJson('calibration-premium.mjs', ledgerArgs);
const varianceData = siblingJson('variance-option.mjs', ledgerArgs);
const lanePremium = premiumData?.lanes?.find(l => l.status === 'PRICED') || premiumData?.lanes?.[0] || null;
const laneVariance = varianceData?.lanes?.find(l => l.status === 'QUOTED') || varianceData?.lanes?.[0] || null;

// ── the settlement decision — a pure function, mirrored 1:1 by InLanePolicy.sol (C401a) ───────
// writePolicy: insurer escrows COVERAGE → status OPEN. resolution: read the verdict (never just the
// collapsed isInLane bool — that bool is exactly what conflated OFF_DOMAIN with UNPLACEABLE before
// C401a). IN_ROLE → RECLAIM. OFF_DOMAIN → CLAIM. UNPLACEABLE → REFERRED: neither CLAIM nor RECLAIM
// fires on its own; the claim goes to the adjuster with the receipt attached.
export function decideSettlement(verdictName, coverage = 0) {
  if (verdictName === 'IN_ROLE') {
    return { action: 'RECLAIM', payTo: 'insurer', amount: coverage, status: 'EXPIRED',
      meaning: 'work held its lane → no breach → insurer recovers escrow and keeps the premium' };
  }
  if (verdictName === 'OFF_DOMAIN') {
    return { action: 'CLAIM', payTo: 'beneficiary', amount: coverage, status: 'PAID',
      meaning: `verdict ${verdictName} → coordinate left the lane → policy pays out, mechanically` };
  }
  // UNPLACEABLE (or any unrecognized verdict — refuse to guess, refer it): the issuer's two
  // witnesses disagreed. C401a — this is not a loss and not a held lane. No automatic pay, no
  // automatic return; the claim goes to the adjuster with the receipt attached.
  return { action: 'REFERRED', payTo: null, amount: 0, status: 'REFERRED',
    meaning: `verdict ${verdictName} → the issuer declined to place (its two witnesses disagree) → ` +
      'neither pays nor returns automatically; the claim goes to the adjuster with the receipt attached' };
}

const settlement = decideSettlement(verdictName, COVERAGE);

if (AS_JSON) {
  console.log(JSON.stringify({
    receipt: receiptPath, receiptId, verdict: verdictName, isInLane, bodyHash, sigmaMilli,
    anchorCalldata: { receiptId, bodyHash, sigmaMilli, verdict, hostSignature },
    premium: lanePremium ? { value: lanePremium.premium, status: lanePremium.status, breachRate: lanePremium.breachRate, n: lanePremium.n } : null,
    variance: laneVariance ? { fairVol: laneVariance.fairVolStrike, bid: laneVariance.quote?.bid, ask: laneVariance.quote?.ask } : null,
    coverage: COVERAGE, settlement,
  }, null, 2));
  process.exit(0);
}

// ── human report: the transaction, end to end ─────────────────────────────────
const rule = () => console.log('  ' + '─'.repeat(74));
const fx = (n, d = 1) => (n == null ? 'n/a' : Number(n).toFixed(d));
console.log('\n  SEMANTIC PUT OPTION — TRANSACTIONAL RESOLUTION  (npx v0)');
console.log('  spec ⇒ ballistic walk ⇒ drift ⇒ on-chain payload ⇒ policy settles');
rule();
console.log('  ① RESOLUTION — the walk resolved the spec into reality');
console.log(`     receipt        ${path.basename(receiptPath)}`);
console.log(`     verdict        ${verdictName}   (isInLane=${isInLane})`);
console.log(`     σ precision    ${fx(sigma, 3)}`);
console.log(`     bodyHash       ${bodyHash.slice(0, 26)}…   (the commitment a stranger reproduces)`);
rule();
console.log('  ② ON-CHAIN ANCHOR — ReefAttestation.anchor() calldata (ready to broadcast)');
console.log(`     receiptId      ${receiptId.slice(0, 26)}…`);
console.log(`     sigmaMilli     ${sigmaMilli}`);
console.log(`     verdict        ${verdict} (${verdictName})`);
console.log(`     hostSignature  ${hostSignature.slice(0, 26)}…`);
rule();
console.log('  ③ THE MARKET — what the buyer paid, calibrated from the ledger');
if (lanePremium) {
  console.log(`     premium        ${fx(lanePremium.premium)} units   [${lanePremium.status}]  from ${lanePremium.n} attestations`);
  console.log(`     breach rate    ${fx((lanePremium.breachRate || 0) * 100)}%   (the actuarial frequency this premium prices)`);
} else {
  console.log('     premium        n/a — no ledger in cwd (run from the repo, or premium rides off-chain)');
}
if (laneVariance) {
  console.log(`     variance quote bid ${fx(laneVariance.quote?.bid, 3)} / ask ${fx(laneVariance.quote?.ask, 3)}   (fair vol ${fx(laneVariance.fairVolStrike, 3)})`);
}
rule();
console.log('  ④ SETTLEMENT — InLanePolicy lifecycle (faithful contract mirror)');
console.log(`     writePolicy    insurer escrows coverage = ${COVERAGE} units, beneficiary = the work's owner`);
console.log(`     resolution     verdict=${verdictName}  ⇒  ${settlement.action}`);
if (settlement.action === 'REFERRED') {
  console.log(`     → REFERRED     no automatic pay, no automatic return   (policy status: ${settlement.status})`);
} else {
  console.log(`     → PAYS         ${settlement.amount} units to the ${settlement.payTo}   (policy status: ${settlement.status})`);
}
console.log(`     why            ${settlement.meaning}`);
rule();
console.log('  THE TRIGGER IS A COORDINATE, NOT A COURTROOM. Verify the resolution settles on the real');
console.log('  measurement (the same one the chain anchors), byte-for-byte, on your machine:');
console.log('     npx thetacog-mcp prove-rice --check        (exit 0 = verdict + σ reproduced)');
console.log(`     npx thetacog-mcp attest verify --receipt ${path.basename(receiptPath)}\n`);
