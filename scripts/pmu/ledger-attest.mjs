// scripts/pmu/ledger-attest.mjs
//
// THE SEAL OVER THE PRICED LEDGER — tamper-evidence for the payment-releaser.
//
// `npx thetacog-mcp premium` is deterministic (recomputable), but until now the ledger it
// prices (data/pmu/measure-history.ndjson) was plain append-only JSON: nothing stopped the
// PRODUCER from quietly editing its own loss history. An underwriter's one nightmare is
// Goodhart — the measured entity gaming the measurement — so a premium computed off an
// unsealed ledger is not underwritable.
//
// This is the additive fix (it does NOT touch the ~10 scripts that append rows): it computes
// a Merkle root over the per-row hashes and SIGNS that root with the SAME host ed25519 key the
// per-delegation receipts use (scripts/pmu/receipt-crypto.mjs). The result is a detached seal,
// data/pmu/measure-history.attestation.json. Any edit / insert / delete to any priced row
// changes a leaf hash → changes the root → `--verify` REJECTS. The seal carries its own
// signature, so the attestation file itself cannot be forged without the host key.
//
//   node scripts/pmu/ledger-attest.mjs            # seal the ledger (write the attestation)
//   node scripts/pmu/ledger-attest.mjs --verify   # recompute + verify; exit 1 on any mismatch
//   node scripts/pmu/ledger-attest.mjs --json      # machine-readable
//
// HONEST FENCE: this is tamper-EVIDENT, not tamper-PROOF. The host holds the key, so a holder
// could re-seal after editing. Append-time co-signing and on-chain anchoring of the root
// (contracts/ReefAttestation.sol) are the next rungs; this rung makes silent post-hoc edits
// to a priced history detectable by anyone who recomputes — the floor an underwriter needs.
//
// Importable: import { computeLedgerRoot, attestLedger, verifyLedger } from './ledger-attest.mjs'

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, attestationRoot, sealReceipt, verifyReceipt } from './receipt-crypto.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_LEDGER = resolve(REPO, 'data/pmu/measure-history.ndjson');
const attestationPathFor = (ledger) => ledger.replace(/\.ndjson$/, '') + '.attestation.json';

// One leaf hash per non-empty ledger line. We hash the EXACT line bytes (trimmed of the
// trailing newline only) so any byte change to any row is caught — no re-serialization that
// could mask a change behind key reordering.
export function ledgerLeaves(text) {
  return String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0)
    .map((line) => sha256Hex(line));
}

// Deterministic Merkle root over the row hashes (order-independent, like the receipt root —
// the premium aggregates the multiset, so order is not part of the priced statistic).
export function computeLedgerRoot(text) {
  const leaves = ledgerLeaves(text);
  return { root: attestationRoot(leaves), count: leaves.length };
}

// Seal the ledger: compute the root, sign it as a receipt, write the detached attestation.
// `at` (ISO timestamp) is provenance only and does NOT enter the root, so the root is stable
// across re-seals of an unchanged ledger.
export function attestLedger(ledgerPath = DEFAULT_LEDGER, { at } = {}) {
  const text = readFileSync(ledgerPath, 'utf8');
  const { root, count } = computeLedgerRoot(text);
  const sealed = sealReceipt({
    kind: 'pmu-ledger-attestation',
    ledger: ledgerPath.replace(REPO + '/', ''),
    algo: 'sha256-merkle/ed25519',
    count,
    root,
    at: at || null,
  });
  const out = attestationPathFor(ledgerPath);
  writeFileSync(out, JSON.stringify(sealed, null, 2) + '\n');
  return { out, root, count, pubkey_hex: sealed.pubkey_hex };
}

// Verify: (1) the attestation's own signature is authentic (not a forged seal), AND
// (2) the root recomputed from the CURRENT ledger equals the sealed root (no row altered).
// Returns { ok, reason, sealedRoot, currentRoot, count }. ok=false on ANY mismatch.
export function verifyLedger(ledgerPath = DEFAULT_LEDGER) {
  const attPath = attestationPathFor(ledgerPath);
  if (!existsSync(attPath)) return { ok: false, reason: 'no attestation — ledger is UNSEALED' };
  if (!existsSync(ledgerPath)) return { ok: false, reason: 'ledger file missing' };

  let att;
  try { att = JSON.parse(readFileSync(attPath, 'utf8')); }
  catch (e) { return { ok: false, reason: `attestation unreadable: ${e.message}` }; }

  const sealCheck = verifyReceipt(att);
  if (!sealCheck.ok) return { ok: false, reason: `seal signature invalid: ${sealCheck.reason}` };

  const { root: currentRoot, count } = computeLedgerRoot(readFileSync(ledgerPath, 'utf8'));
  if (currentRoot !== att.root) {
    return { ok: false, reason: 'ROOT MISMATCH — a priced row was altered, inserted, or removed',
      sealedRoot: att.root, currentRoot, count };
  }
  return { ok: true, sealedRoot: att.root, currentRoot, count, pubkey_hex: att.pubkey_hex };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ledgerArg = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || DEFAULT_LEDGER;
  const asJson = process.argv.includes('--json');

  if (process.argv.includes('--verify')) {
    const r = verifyLedger(ledgerArg);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }
    if (r.ok) {
      console.log(`\n  ✅ LEDGER SEAL VERIFIED — ${r.count} rows, root ${String(r.sealedRoot).slice(0, 16)}…`);
      console.log(`     the priced history matches the signed seal; no row was altered.\n`);
      process.exit(0);
    }
    console.log(`\n  ❌ LEDGER SEAL FAILED — ${r.reason}`);
    if (r.sealedRoot) console.log(`     sealed  ${r.sealedRoot}\n     current ${r.currentRoot}`);
    console.log('');
    process.exit(1);
  }

  // default: seal it
  const r = attestLedger(ledgerArg);
  if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`\n  🔏 SEALED ${r.count} priced rows`);
  console.log(`     root    ${r.root}`);
  console.log(`     signer  ${r.pubkey_hex.slice(0, 16)}… (host ed25519 — same key as the delegation receipts)`);
  console.log(`     → ${r.out.replace(REPO + '/', '')}`);
  console.log(`     verify any time: node scripts/pmu/ledger-attest.mjs --verify\n`);
}
