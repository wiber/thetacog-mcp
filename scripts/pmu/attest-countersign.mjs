#!/usr/bin/env node
// scripts/pmu/attest-countersign.mjs — THE CLOSING LINK OF THE BILATERAL RISK MARKET.
//
// attest.mjs already produces the verdict: A publishes a reef, B submits a payload, the Oracle
// gates it and host-seals a receipt, and a stranger recomputes the whole thing. That is a
// MEASUREMENT. It is not yet a market, because nobody has said what the measurement OBLIGATES.
//
// A risk market needs two more signatures, and they are the two this file adds:
//
//   DEPLOYER  "that was my agent, that was the lane I declared, and I accept this record of it."
//   INSURER   "I accept this instrument as trigger basis, under these terms, from these oracles."
//
// With both, the receipt stops being an observation and becomes a bilateral artifact: the party
// who could be liable has acknowledged the record, and the party who would pay has pre-committed
// to what the record means. Neither had to trust the other, and neither had to trust us — every
// signature is over the same canonical body any stranger reconstructs offline.
//
// ── THE NON-CAPTURE PROPERTY (read this before changing anything here) ────────────────────────
// The INSURER names `accepted_oracles` — the set of oracle public keys whose verdicts they will
// honour. WE NEVER ADJUDICATE WHOSE ATTESTATION COUNTS. That is deliberate and it is the whole
// answer to "isn't this just a captive board with extra steps": there is no organ in this path
// through which capture could travel. An insurer may name a forked runtime's key, several keys, or
// ours; `circle` verifies against THEIR list, not against a list we ship. If we were bought
// tomorrow, no number in any existing receipt would move, and no counterparty would owe us a
// renegotiation. The independence is structural, not promised — and it is checkable by running
// `circle` on someone else's receipt.
//
// Consequence, stated plainly so nobody "fixes" it later: this file must never contain a hardcoded
// list of blessed oracle keys, and `circle` must never pass a receipt merely because WE signed it.
// Guarded by tests/attest/countersign-circle.test.mjs.
//
// ── THE ASK (this schema is v1 and we want it attacked) ───────────────────────────────────────
// Signing schemes are exactly the kind of thing that looks right and isn't. This one is deliberately
// small and boring — ed25519 over canonical JSON, sha256 for content addressing, one signature per
// role, no nesting, no aggregation — because every clever addition is somewhere for a flaw to hide.
// Known open questions we would rather have answered by someone who does this for a living:
//   1. Endorsements bind to `receipt_sha256` AND `verdict`, so an endorsement cannot be replayed
//      onto a different verdict. Is binding to both redundant, or is it load-bearing belt+braces?
//   2. There is no revocation. A wrong endorsement is corrected by issuing a superseding one and
//      the verifier taking the latest by timestamp. Timestamps are self-asserted. Is that
//      acceptable for a parametric trigger, or does it need an external time anchor?
//   3. `actorIdentity()` derives keys deterministically from a NAME for reproducible demos. That is
//      not a production secret and is documented as such — but the failure mode if someone ships it
//      as one is total. Should this file refuse to sign with a derived key unless --demo is passed?
//   4. Ordering: deployer-then-insurer is not enforced. Should it be?
// Corrections welcome as issues or PRs against github.com/wiber/thetacog-mcp. We would rather be
// corrected in public now than discover it inside somebody's claim.
//
// Usage:
//   node scripts/pmu/attest-countersign.mjs sign --receipt r.json --role deployer --as "Acme Corp" \
//        [--terms-file t.json] [--out r.json]
//   node scripts/pmu/attest-countersign.mjs sign --receipt r.json --role insurer --as "Carrier X" \
//        --accept-oracle <pubkey_hex> [--accept-oracle <hex> …] [--policy-ref POL-123] [--terms-file t.json]
//   node scripts/pmu/attest-countersign.mjs circle --receipt r.json [--json]
//
// LLM-FREE end to end: no model call anywhere in this file. The verdict it countersigns was itself
// produced with no model in its path.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actorIdentity, sealReceiptAs, verifyReceipt, sha256Hex, canonicalBody,
} from './receipt-crypto.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const SCHEMA_VERSION = 1;
export const ROLES = ['deployer', 'insurer'];

// ── the endorsement body ─────────────────────────────────────────────────────────────────────
// Bound to BOTH the receipt hash and the verdict (see open question 1). `accepted_oracles` is
// insurer-only and is the field that keeps adjudication out of our hands.
export function endorsementBody({ role, by, receipt, terms, acceptedOracles, policyRef, ts }) {
  if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(' | ')}`);
  if (!receipt?.sha256) throw new Error('receipt has no sha256 — is it a sealed attestation receipt?');

  const body = {
    artifact: 'thetacog-endorsement',
    schema_version: SCHEMA_VERSION,
    role,
    by,
    // what is being endorsed, pinned two ways
    receipt_sha256: receipt.sha256,
    verdict: receipt.verdict ?? null,
    job_id: receipt.job_id ?? null,
    ts,
  };
  if (policyRef) body.policy_ref = policyRef;
  if (terms) body.terms = terms;
  if (role === 'insurer') {
    // REQUIRED for insurers. An insurer who names nobody has not said whose word they take, which
    // means the endorsement obligates nothing. Empty is a schema error, not a permissive default.
    if (!Array.isArray(acceptedOracles) || acceptedOracles.length === 0) {
      throw new Error('insurer endorsement must name --accept-oracle <pubkey_hex> (at least one) — we do not decide whose attestation counts');
    }
    body.accepted_oracles = [...acceptedOracles].sort();
  }
  return body;
}

export function signEndorsement(receipt, { role, name, terms, acceptedOracles, policyRef, ts, identity }) {
  const id = identity || actorIdentity(name);
  const body = endorsementBody({ role, by: name, receipt, terms, acceptedOracles, policyRef, ts });
  return sealReceiptAs(body, id);
}

// THE SEALED RECEIPT IS NEVER MUTATED. canonicalBody() strips only the {pubkey_hex, sig_hex,
// sha256} envelope and signs EVERYTHING else, so appending an `endorsements` key directly onto the
// receipt breaks the host seal — caught in first testing, and the reason this wraps instead. The
// oracle's receipt stays byte-identical forever and keeps verifying on its own; the market layer
// sits BESIDE it in a circle document. That ordering is also honest about who owns what: the oracle
// owns the measurement and nobody may edit it, the counterparties own their endorsements.
export const CIRCLE_ARTIFACT = 'thetacog-attestation-circle';

export function asCircleDoc(input) {
  if (input?.artifact === CIRCLE_ARTIFACT) return { ...input, endorsements: [...(input.endorsements || [])] };
  return { artifact: CIRCLE_ARTIFACT, schema_version: SCHEMA_VERSION, receipt: input, endorsements: [] };
}

export function attachEndorsement(input, endorsement) {
  const doc = asCircleDoc(input);
  doc.endorsements.push(endorsement);
  return doc;
}

// ── the circle check ─────────────────────────────────────────────────────────────────────────
// Returns a structured verdict on whether the bilateral loop is CLOSED. Four independent facts:
//   1. the oracle receipt verifies (sha256 + ed25519, against ITS OWN claimed pubkey)
//   2. a deployer endorsement verifies and binds to this exact receipt+verdict
//   3. an insurer endorsement verifies and binds to this exact receipt+verdict
//   4. the insurer's OWN accepted_oracles list contains the pubkey that sealed the receipt
// (4) is the one that matters: we are not on the list unless they put us there.
export function circle(input) {
  const doc = input?.artifact === CIRCLE_ARTIFACT ? input : { receipt: input, endorsements: [] };
  const receipt = doc.receipt;
  const findings = [];
  const oracle = verifyReceipt(receipt);
  findings.push({ check: 'oracle-receipt-seal', ok: !!oracle.ok, detail: oracle.ok ? `sealed by ${receipt.pubkey_hex?.slice(0, 16)}…` : oracle.reason });

  const byRole = {};
  for (const e of doc.endorsements || []) {
    const v = verifyReceipt(e);
    const bindsHash = e.receipt_sha256 === receipt.sha256;
    const bindsVerdict = (e.verdict ?? null) === (receipt.verdict ?? null);
    const ok = !!v.ok && bindsHash && bindsVerdict;
    const reason = !v.ok ? v.reason : !bindsHash ? 'endorses a different receipt hash' : !bindsVerdict ? 'endorses a different verdict' : null;
    // supersede-by-timestamp (see open question 2): latest valid endorsement per role wins
    const prior = byRole[e.role];
    if (ok && (!prior || String(e.ts) > String(prior.ts))) byRole[e.role] = e;
    findings.push({ check: `endorsement:${e.role}:${e.by}`, ok, detail: reason || `bound to ${e.receipt_sha256.slice(0, 16)}… (${e.verdict})` });
  }

  for (const role of ROLES) {
    if (!byRole[role]) findings.push({ check: `endorsement:${role}`, ok: false, detail: 'missing — the circle is open' });
  }

  // (4) THE NON-CAPTURE CHECK. The insurer's list, never ours.
  let oracleAccepted = false;
  const ins = byRole.insurer;
  if (ins) {
    oracleAccepted = (ins.accepted_oracles || []).includes(receipt.pubkey_hex);
    findings.push({
      check: 'insurer-accepts-this-oracle',
      ok: oracleAccepted,
      detail: oracleAccepted
        ? `${receipt.pubkey_hex?.slice(0, 16)}… is on the insurer's own accepted list`
        : `the sealing oracle is NOT on the insurer's accepted list — their call, not ours`,
    });
  }

  const closed = findings.every((f) => f.ok);
  return { closed, findings, deployer: byRole.deployer ?? null, insurer: byRole.insurer ?? null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { acceptOracle: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const nx = () => argv[++i];
    if (k === '--receipt') a.receipt = nx();
    else if (k === '--role') a.role = nx();
    else if (k === '--as') a.as = nx();
    else if (k === '--terms-file') a.termsFile = nx();
    else if (k === '--policy-ref') a.policyRef = nx();
    else if (k === '--accept-oracle') a.acceptOracle.push(nx());
    else if (k === '--out') a.out = nx();
    else if (k === '--ts') a.ts = nx();
    else if (k === '--json') a.json = true;
  }
  return a;
}

const USAGE = `attest-countersign — close the bilateral loop on an attestation receipt

  sign    --receipt <r.json> --role deployer --as "<name>" [--terms-file t.json] [--out f]
  sign    --receipt <r.json> --role insurer  --as "<name>" --accept-oracle <pubkey_hex> [more…]
                                                           [--policy-ref X] [--terms-file t.json]
  circle  --receipt <r.json> [--json]

The insurer names which oracle keys they honour. We never decide whose attestation counts —
that is the property that makes this safe to build a market on. Attack the schema: see the
open questions at the top of this file.`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); return; }
  if (!a.receipt) { console.error('need --receipt <file>'); process.exit(2); }
  const loaded = JSON.parse(readFileSync(a.receipt, 'utf8'));
  // accepts either a raw sealed receipt or an existing circle document
  const receipt = loaded?.artifact === CIRCLE_ARTIFACT ? loaded.receipt : loaded;

  if (cmd === 'sign') {
    if (!a.role || !a.as) { console.error('sign needs --role and --as'); process.exit(2); }
    const terms = a.termsFile ? JSON.parse(readFileSync(a.termsFile, 'utf8')) : null;
    let endorsement;
    try {
      endorsement = signEndorsement(receipt, {
        role: a.role,
        name: a.as,
        terms,
        acceptedOracles: a.acceptOracle,
        policyRef: a.policyRef,
        ts: a.ts || new Date().toISOString(),
      });
    } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }

    const updated = attachEndorsement(loaded, endorsement);
    const out = a.out || a.receipt;
    writeFileSync(out, JSON.stringify(updated, null, 2));
    console.log(`🖋  ${a.role} endorsement by ${a.as} → ${out}`);
    console.log(`   binds receipt ${receipt.sha256.slice(0, 16)}… verdict ${receipt.verdict}`);
    if (a.role === 'insurer') console.log(`   accepts ${a.acceptOracle.length} oracle key(s) — their list, not ours`);
    const c = circle(updated);
    console.log(c.closed ? '   ✅ circle CLOSED' : `   ○ circle open — ${c.findings.filter((f) => !f.ok).map((f) => f.check).join(', ')}`);
    return;
  }

  if (cmd === 'circle') {
    const c = circle(loaded);
    if (a.json) { console.log(JSON.stringify(c, null, 2)); process.exit(c.closed ? 0 : 1); }
    console.log(`\n  ${c.closed ? '✅ CIRCLE CLOSED' : '○ CIRCLE OPEN'} — receipt ${receipt.sha256?.slice(0, 16)}… verdict ${receipt.verdict}\n`);
    for (const f of c.findings) console.log(`  ${f.ok ? '✓' : '✗'} ${f.check.padEnd(38)} ${f.detail}`);
    console.log(c.closed
      ? '\n  Both parties signed the same measurement, and the insurer named this oracle themselves.\n  Recompute every signature offline — nothing here asks you to trust the issuer.\n'
      : '\n  Not a bilateral artifact yet. What is missing is listed above.\n');
    process.exit(c.closed ? 0 : 1);
  }

  console.error(USAGE);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
