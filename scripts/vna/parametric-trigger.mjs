#!/usr/bin/env node
// scripts/vna/parametric-trigger.mjs — VECTOR 3: the exact receipt that constitutes a trigger event.
//
// The spec's third action: "Connect the negative boundary to the financial model. Define the exact
// cryptographic receipt required to trigger the E&O liability coverage."
//
// ── WHAT THIS DELIBERATELY DOES NOT CLAIM, because the spec's wording would be unfalsifiable ──
// The spec says "the system's inability to mathematically exceed its defined risk tolerance" and
// "proving the AI cannot operate outside its insurable lane". Read as ENCLOSURE those are banned
// here and rightly: no software decides whether its own output was good (Rice, 1953), and a promise
// about future conduct is answered by one counterexample. The operator settled the reading himself:
// "I never said to make it impossible to fail, impossible to drift... the water sticks to the net."
//
// So the survivable claim, which is also the STRONGER one because it is checkable:
//   we do not prevent the deviation. We make it COUNTABLE — DETECTED · PLACED · PRICED · DISPATCHED.
// A parametric trigger does not need to stop anything. It needs to fire or not fire, deterministically,
// on evidence neither party writes at claim time. That is the whole insurance requirement: if it is
// debatable it is semantic, and semantic is not insurable, because no underwriter writes a policy
// whose trigger is settled by argument.
//
// ── THE TRIGGER, STATED AS A PREDICATE OVER SIGNED FIELDS ──
// A receipt constitutes a TRIGGER EVENT iff ALL of:
//   1. attestation.alg === 'ed25519' && attestation.valid === true   (signed, verifiable by a third party)
//   2. laneSource === 'tolerance-panel'                              (ADMISSIBLE: actually measured)
//   3. toleranceOffPct is a finite number                            (a reading exists)
//   4. toleranceOffPct >= TRIGGER_THRESHOLD                          (the countable boundary crossing)
// Nothing in that predicate is a judgement. Every field is written by the pipeline before any claim
// exists, which is AXIOM 1's W3 — the checkpoint reads a record the actor did not author.
//
// ── ADMISSIBILITY IS THE HALF EVERYONE SKIPS ──
// Only receipts whose lane came from the tolerance panel carry a measurement. A receipt placed by
// σ alone has NO offPct, and treating its absence as zero would silently convert "not measured"
// into "no deviation" — the single most expensive error available here, and the same absence-reads-
// as-clean failure the lit-mass floor exists to stop. Those receipts are NOT ELIGIBLE, counted, and
// reported as a coverage gap rather than as good news.
//
// @guard tests/vna/parametric-trigger.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const GREEKS = resolve(REPO, 'src/data/commit-greeks-index.json');
const LANE = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
const fullName = (c) => { const m = /^([A-C][1-3]?),([A-C][1-3]?)$/.exec(String(c || ''));
  return m ? `${m[1]}.${LANE[m[1]]} × ${m[2]}.${LANE[m[2]]}` : String(c || '?'); };

if (!existsSync(GREEKS)) { console.error(`NOT ADMISSIBLE (exit 2): receipt index absent at ${GREEKS}`); process.exit(2); }

// ── ELIGIBILITY, evaluated per receipt with the reason recorded ─────────────
export function eligibility(r) {
  if (!(r.attestation?.alg === 'ed25519' && r.attestation?.valid === true)) return { eligible: false, reason: 'unsigned or invalid attestation' };
  if (r.laneSource !== 'tolerance-panel') return { eligible: false, reason: 'placed by sigma only — no tolerance measurement exists' };
  if (!Number.isFinite(r.toleranceOffPct)) return { eligible: false, reason: 'no off-lane reading on the receipt' };
  return { eligible: true, reason: null };
}
export function fires(r, threshold) {
  const e = eligibility(r);
  return e.eligible && r.toleranceOffPct >= threshold;
}

function load() {
  const g = JSON.parse(readFileSync(GREEKS, 'utf8'));
  return Object.entries(g).map(([sha, v]) => ({ sha: sha.slice(0, 12), ...v }));
}

function main() {
  const rows = load();
  const elig = rows.filter((r) => eligibility(r).eligible);
  const notElig = rows.length - elig.length;
  const reasons = {};
  for (const r of rows) { const e = eligibility(r); if (!e.eligible) reasons[e.reason] = (reasons[e.reason] || 0) + 1; }

  console.log(`VNA PARAMETRIC TRIGGER — the receipt that constitutes an event · LLM-free\n`);
  console.log(`WE DO NOT PREVENT THE DEVIATION. We make it countable: DETECTED · PLACED · PRICED · DISPATCHED.`);
  console.log(`A trigger must fire or not fire on evidence neither party writes at claim time. Nothing here`);
  console.log(`claims the system cannot deviate — that claim is answered by one counterexample.\n`);

  console.log(`CORPUS: ${rows.length} receipts`);
  console.log(`ELIGIBLE: ${elig.length} (${(100 * elig.length / rows.length).toFixed(1)}%)`);
  console.log(`NOT ELIGIBLE: ${notElig} — counted, never read as "no deviation":`);
  for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${why}`);
  console.log('');

  // ── THE RATE CURVE. The threshold is an actuarial choice, not a display setting. ──
  console.log(`EVENT RATE BY THRESHOLD (over the ${elig.length} eligible receipts)`);
  console.log(`  thr    events    rate     writable?`);
  const curve = [];
  for (const thr of [15, 20, 25, 30, 40, 50, 60, 75, 90, 95]) {
    const n = elig.filter((r) => r.toleranceOffPct >= thr).length;
    const rate = elig.length ? n / elig.length : 0;
    // A parametric cover cannot be written where the event is routine. This is not a preference:
    // a trigger firing on a large fraction of ordinary operation prices to roughly the full limit,
    // and the instrument stops being insurance and becomes a subscription with extra steps.
    const writable = rate <= 0.05 ? 'yes — rare enough to price' : rate <= 0.15 ? 'marginal' : 'NO — routine, not an event';
    curve.push({ threshold: thr, events: n, rate: +rate.toFixed(4), writable });
    console.log(`  ${String(thr).padStart(3)}   ${String(n).padStart(6)}   ${(100 * rate).toFixed(1).padStart(5)}%   ${writable}`);
  }

  // ── THE FINDING THAT DECIDES VECTOR 3 ──
  const at15 = curve.find((c) => c.threshold === 15);
  console.log('');
  console.log(`THE CANONICAL PANEL THRESHOLD IS NOT A TRIGGER THRESHOLD.`);
  console.log(`  killTolerancePct = 15 is the DISPLAY threshold — where the panel starts painting red.`);
  console.log(`  As a parametric trigger it fires on ${at15.events}/${elig.length} eligible receipts (${(100 * at15.rate).toFixed(1)}%).`);
  console.log(`  An event that occurs in ${(100 * at15.rate).toFixed(0)}% of ordinary operation is not an event; it is the weather.`);
  console.log(`  A trigger threshold must come from the LOSS distribution, and it is not the same number.`);
  const writable = curve.filter((c) => c.writable.startsWith('yes'));
  if (writable.length) {
    const w = writable[0];
    console.log(`  On this corpus the rate first falls under 5% at threshold ${w.threshold} (${w.events} events, ${(100 * w.rate).toFixed(1)}%).`);
    console.log(`  That is where a parametric cover becomes arithmetically writable — NOT a recommendation to write one.`);
  } else {
    console.log(`  On this corpus NO tested threshold gets the rate under 5%. A parametric cover is not writable here yet.`);
  }

  // where do the events land — the underwriter's exposure map
  const evs = elig.filter((r) => r.toleranceOffPct >= 50);
  const byCoord = {};
  for (const r of evs) byCoord[r.coord] = (byCoord[r.coord] || 0) + 1;
  const top = Object.entries(byCoord).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) {
    console.log(`\nWHERE THE SEVERE EVENTS LAND (offPct >= 50, n=${evs.length}) — the exposure map:`);
    for (const [c, n] of top) console.log(`   ${String(n).padStart(4)}  ${c}  ${fullName(c)}`);
  }

  // ── THE SUBSTRATE DEFECT THAT BLOCKS A VERDICT-KEYED TRIGGER ──
  console.log(`\nBLOCKER, AND IT IS OURS: a trigger keyed on issue-receipt.mjs's VERDICT is not writable today.`);
  console.log(`  Its header promises UNPLACEABLE on witness disagreement; decideVerdict in tri mode has no`);
  console.log(`  such branch and places on the higher-sigma witness instead. Measured on the sealed corpus`);
  console.log(`  (data/pmu/study/2026-07-14-abstention.json): 26/30 disagree, 0 abstained, 15/30 mislabelled.`);
  console.log(`  A parametric trigger reading that verdict would fire on a coin-flip and be void on inspection.`);
  console.log(`  This trigger therefore keys on the TOLERANCE MEASUREMENT, which is computed, not adjudicated.`);
  console.log(`  See scripts/vna/measure-receipt-abstention.mjs. The fix is one branch and it is the operator's call.`);

  console.log(`\nSUFFICIENT FOR: whether a signed, measured receipt crosses a stated boundary — deterministically,`);
  console.log(`  re-runnably, on evidence written before any claim exists.`);
  console.log(`NOT SUFFICIENT FOR: whether the work was good (Rice), whether a loss occurred, what it cost, or`);
  console.log(`  whether any carrier would cover it. Those are underwriting acts performed by people on paper.`);

  const report = { at: new Date().toISOString(), corpus: rows.length,
    eligible: elig.length, notEligible: notElig, reasons,
    predicate: ['attestation.alg === ed25519 && attestation.valid === true', 'laneSource === tolerance-panel',
      'Number.isFinite(toleranceOffPct)', 'toleranceOffPct >= threshold'],
    curve, severeExposure: top.map(([coord, n]) => ({ coord, name: fullName(coord), n })),
    blocker: 'issue-receipt.mjs decideVerdict does not abstain on witness disagreement (26/30 disagree, 0 abstained, 15/30 wrong on the sealed corpus) — a verdict-keyed trigger is not writable until that is fixed',
    claimNotMade: 'this does not claim the system cannot deviate, nor that it fails closed; it makes deviation countable' };
  mkdirSync(resolve(REPO, 'data/vna'), { recursive: true });
  writeFileSync(resolve(REPO, 'data/vna/parametric-trigger.json'), JSON.stringify(report, null, 2));
  console.log(`\nreceipt → data/vna/parametric-trigger.json`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
