// scripts/vna/cosign.mjs — C85b THE CO-SIGNERS — k-OF-n KEYS, NEVER AN ENCLAVE (goal 12 unit 3, 2026-09-18).
// A witness receipt carries signatures: [{ party, pubkey, sig }]. The first is the hosted notary's (notary_signature stays
// that one, so verifyWitnessRow does not change); the rest are auditor nodes that ran the same MIT gateway over the same CAR
// and countersigned the SAME { sequence_height, witness_root, timestamp, car_sha } bytes. Nothing here is a server's word that
// consensus happened: every signature is verified HERE, sync, over the bytes on disk, and k-of-n is a count the client makes.
//   attachCosign({ receipt, cosig })          — cosig = { party, pubkey, sig, over }; attaches when `over` IS receiptBytes(receipt),
//                                               else records it under receipt.forks — a co-signer over different bytes is a fork, and the receipt says so
//   cosignCount({ receipt, k, parties })      — { verified, n, k, ok, missing: [parties], fork }; a receipt with a fork is never ok
//   cosignLine(count)                         — `verified-of-n witnesses`, the tray line (C81b's label set is untouched by it)
// The auditor node is the gateway with its own NOTARY_ED25519_SEED — the client's compliance officer runs it; nothing needs
// ThetaDriven to hold their key.
// @guard tests/vna/c85-cosign.test.mjs
import { createPublicKey, verify as edVerifySync } from 'node:crypto';
import { receiptBytes } from '../../src/lib/notary/gateway.mjs';

const SPKI_ED25519 = '302a300506032b6570032100';
const isHex = (h, len) => typeof h === 'string' && h.length === len && /^[0-9a-f]*$/.test(h);
function verifies(pubkeyHex, bytes, sigHex) {
  try {
    if (!isHex(pubkeyHex, 64) || !isHex(sigHex, 128)) return false;
    const key = createPublicKey({ key: Buffer.from(SPKI_ED25519 + pubkeyHex, 'hex'), format: 'der', type: 'spki' });
    return edVerifySync(null, Buffer.from(bytes, 'utf8'), key, Buffer.from(sigHex, 'hex'));
  } catch { return false; }
}
// the receipt's own bytes, from the four signed fields — a witness ROW (tape-sync) keeps timestamp as received_at
const bytesOf = (r) => receiptBytes({ sequence_height: r.sequence_height, witness_root: r.witness_root, timestamp: r.timestamp != null ? r.timestamp : r.received_at, car_sha: r.car_sha });
// the signature list: the field when present; a pre-C85b receipt/row counts its notary_signature as the one party
export function signaturesOf(r) {
  if (Array.isArray(r.signatures) && r.signatures.length) return r.signatures;
  if (typeof r.notary_signature === 'string' && typeof r.notary_pubkey === 'string') return [{ party: r.notary_party || 'notary', pubkey: r.notary_pubkey, sig: r.notary_signature }];
  return [];
}

export function attachCosign({ receipt, cosig }) {
  const out = { ...receipt, signatures: signaturesOf(receipt).slice(), forks: Array.isArray(receipt.forks) ? receipt.forks.slice() : [] };
  if (!cosig || typeof cosig !== 'object') return out;
  const over = bytesOf(receipt);
  if (cosig.over !== over) { if (!out.forks.some((f) => f.pubkey === cosig.pubkey && f.over === cosig.over)) out.forks.push({ party: cosig.party, pubkey: cosig.pubkey, sig: cosig.sig, over: cosig.over }); return out; }
  if (!out.signatures.some((s) => s.pubkey === cosig.pubkey)) out.signatures.push({ party: cosig.party, pubkey: cosig.pubkey, sig: cosig.sig });
  return out;
}

export function cosignCount({ receipt, k = 1, parties = null } = {}) {
  const sigs = receipt ? signaturesOf(receipt) : []; const over = receipt ? bytesOf(receipt) : '';
  const ok_ = new Set(); const bad = [];
  for (const s of sigs) { if (verifies(s.pubkey, over, s.sig)) ok_.add(s.party); else bad.push(s.party); }
  const required = Array.isArray(parties) && parties.length ? parties : sigs.map((s) => s.party);
  const missing = [...new Set([...required.filter((p) => !ok_.has(p)), ...bad])];
  const fork = !!(receipt && Array.isArray(receipt.forks) && receipt.forks.length);
  const n = Math.max(required.length, sigs.length); const verified = ok_.size; const K = Number.isFinite(k) && k > 0 ? k : 1;
  return { verified, n, k: K, ok: !fork && verified >= K, missing, fork, forks: fork ? receipt.forks.map((f) => f.party) : [] };
}
export const cosignLine = (c) => `${c.verified}-of-${c.n} witnesses`;
