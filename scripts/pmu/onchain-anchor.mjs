#!/usr/bin/env node
// scripts/pmu/onchain-anchor.mjs — the OFF-CHAIN half of the on-chain attestation link (v0).
//
// Bridges a signed reef-placement receipt to the ReefAttestation contract (contracts/ReefAttestation.sol):
// it extracts the scalars the chain anchors and prints the `anchor(...)` calldata. The chain stores the
// commitment + signature O(1); the WORLD re-walks off-chain to prove the placement is the real,
// recomputable measurement. THIS script does the off-chain side: it (1) re-verifies the receipt with the
// shipped tool (the authoritative re-walk), and (2) emits the anchor calldata.
//
//   node scripts/pmu/onchain-anchor.mjs --receipt ~/.thetacog/pmu/receipts/<id>.json [--reef <reef.json>]
//
// THE FENCE, ON-CHAIN: we anchor WHERE the work landed (verdict + σ + signature). We never anchor
// WHETHER it was good — that is the underwriter's call. v0 leaves ed25519 signature verification to the
// off-chain verifier (the EVM has no native ed25519); the bodyHash is the commitment a verifier reproduces.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const receiptPath = arg('--receipt', null);
if (!receiptPath) { console.error('usage: onchain-anchor.mjs --receipt <path> [--reef <path>]'); process.exit(1); }
const r = JSON.parse(readFileSync(receiptPath, 'utf8'));

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const keccakish = (s) => '0x' + sha256(s); // placeholder id hash; the contract keys on a bytes32 — any collision-resistant hash works for v0

// canonical signed body = receipt MINUS the signature envelope, in insertion order (matches receipt-crypto.canonicalBody intent)
const ENVELOPE = new Set(['signature', 'signature_algorithm', 'sig_hex', 'sha256']);
const body = {}; for (const k of Object.keys(r)) if (!ENVELOPE.has(k)) body[k] = r[k];
const bodyHash = sha256(JSON.stringify(body));   // the commitment a stranger reproduces (authoritative re-walk = `attest verify`)

// map the gate verdict to the contract enum
const VERDICT = { UNPLACEABLE: 0, IN_ROLE: 1, OFF_DOMAIN: 2 };
const verdict = VERDICT[r.verdict] ?? 0;

// σ — gzip witness sigma, fixed-point milli
const sigma = r.gzip_witness?.sigma ?? r.physical_execution?.witness_simhash?.gzip_sigma ?? r.sigma ?? 0;
const sigmaMilli = Math.round(Number(sigma) * 1000);

const reefCommitment = arg('--reef', null)
  ? '0x' + sha256(readFileSync(arg('--reef', null), 'utf8'))
  : (r.reef_commitment ? (r.reef_commitment.startsWith('0x') ? r.reef_commitment : '0x' + r.reef_commitment) : '0x' + '00'.repeat(32));
const payloadSha = r.payload_sha256 ? '0x' + r.payload_sha256.replace(/^0x/, '') : '0x' + '00'.repeat(32);
const hostPubKey = '0x' + Buffer.from(String(r.host_pub_key || r.host_pubkey_hex || ''), 'utf8').toString('hex');
const hostSignature = r.signature ? ('0x' + String(r.signature).replace(/^0x/, '')) : '0x';

console.log('── ReefAttestation.anchor() calldata (v0) ───────────────────────────');
console.log(JSON.stringify({
  receiptId: keccakish(r.receipt_id || receiptPath),
  reefCommitment, payloadSha, bodyHash: '0x' + bodyHash,
  sigmaMilli, verdict, verdictName: r.verdict,
  hostPubKey, hostSignature,
}, null, 2));
console.log('─────────────────────────────────────────────────────────────────────');
console.log('NEXT: the AUTHORITATIVE off-chain proof a verifier runs before trusting the anchor —');
console.log('  npx thetacog-mcp prove-rice --check     (re-walks; exit 0 = verdict + σ reproduced byte-for-byte)');
console.log('  npx thetacog-mcp attest verify --receipt ' + receiptPath + '   (re-walk + signature check)');
console.log('The chain stores the commitment above; the re-walk proves it is the real measurement. WHERE, not WHETHER.');
