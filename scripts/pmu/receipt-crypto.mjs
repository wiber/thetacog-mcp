// scripts/pmu/receipt-crypto.mjs
//
// ed25519 receipt identity for the PMU cloudbridge.
//
// A receipt is no longer merely hash-sealed — it is cryptographically OWNED.
// The host signs the canonical-JSON body with a persistent ed25519 key; the
// public key IS the operator/host identity that the map-of-maps indexes by.
//
// The SIGNER (pipeline.mjs sealReceipt) and the VERIFIER (claudbridge-mock
// POST /epoch) both live here, sharing ONE canonicalBody() — so the two sides
// cannot drift apart on what bytes were signed. That shared function is the
// zero-distance witness: the verifier reconstructs the exact body the signer
// hashed and signed, or it rejects.
//
// Envelope fields added to every sealed receipt:
//   pubkey_hex — 32-byte raw ed25519 public key, hex (the host identity)
//   sig_hex    — ed25519 signature over canonicalBody, hex
//   sha256     — sha256 of canonicalBody, hex (integrity, kept for continuity)

import {
  generateKeyPairSync, createPrivateKey, createPublicKey,
  sign as edSign, verify as edVerify, createHash
} from 'node:crypto';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync
} from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const KEY_DIR = resolve(homedir(), '.thetacog/pmu/keys');
const PRIV_PEM = resolve(KEY_DIR, 'host.priv.pem');
const PUB_PEM = resolve(KEY_DIR, 'host.pub.pem');

// Cache the loaded host key so repeated seals in one process don't re-read disk.
let _hostKeys = null;

// Generate-once / load-thereafter the persistent host ed25519 keypair.
// Private key is written 0600 (owner read/write only) — it is the host secret.
export function loadOrCreateHostKeys() {
  if (_hostKeys) return _hostKeys;
  if (existsSync(PRIV_PEM) && existsSync(PUB_PEM)) {
    const privateKey = createPrivateKey(readFileSync(PRIV_PEM, 'utf8'));
    const publicKey = createPublicKey(readFileSync(PUB_PEM, 'utf8'));
    _hostKeys = { privateKey, publicKey, pubkey_hex: rawPubHex(publicKey) };
    return _hostKeys;
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(PRIV_PEM, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(PUB_PEM, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  _hostKeys = { privateKey, publicKey, pubkey_hex: rawPubHex(publicKey) };
  return _hostKeys;
}

// Raw 32-byte ed25519 public key as hex (via JWK — standard, no magic DER prefix).
function rawPubHex(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}

// Reconstruct a public KeyObject from the raw 32-byte hex identity.
export function pubKeyFromHex(hex) {
  const x = Buffer.from(hex, 'hex').toString('base64url');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
}

// The canonical signed/hashed body = the receipt MINUS the three envelope
// fields, re-serialized in original insertion order. Because the signer adds
// the envelope LAST (`{ ...obj, pubkey_hex, sig_hex, sha256 }`) and JSON
// preserves string-key order through stringify→parse→destructure, this
// reproduces byte-for-byte the JSON the signer signed.
export function canonicalBody(payload) {
  const { pubkey_hex, sig_hex, sha256, ...rest } = payload;
  return JSON.stringify(rest);
}

export function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

// Seal a receipt body: sign + hash, attach the identity envelope.
// `obj` MUST NOT already contain pubkey_hex/sig_hex/sha256.
export function sealReceipt(obj) {
  const { privateKey, pubkey_hex } = loadOrCreateHostKeys();
  const body = JSON.stringify(obj);
  const sha256 = sha256Hex(body);
  const sig_hex = edSign(null, Buffer.from(body), privateKey).toString('hex');
  return { ...obj, pubkey_hex, sig_hex, sha256 };
}

// ── per-actor identities (the Rice bridge) ───────────────────────────────────
//
// The map-of-maps keys purely on pubkey_hex — it never asks whether the signer
// is an AI agent or a human bureaucrat (Rice: the substrate can't tell at the
// cache line). So a human org-actor is simply a DISTINCT ed25519 identity that
// emits receipts at a coordinate. host = the machine; actorIdentity(name) = a
// named human (or unit) whose pubkey IS their org identity.
//
// Keys are derived DETERMINISTICALLY from the actor's name (seed =
// sha256("thetacog-org-actor:"+name)[:32]) so a demo is reproducible and an
// actor's identity is stable across runs without a key-distribution step. This
// is a demonstrably-distinct identity, NOT a production secret — a real
// deployment would generate+persist per-actor keys like loadOrCreateHostKeys.
const ACTOR_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function actorIdentity(name) {
  const seed = createHash('sha256').update('thetacog-org-actor:' + name).digest().subarray(0, 32);
  const der = Buffer.concat([ACTOR_PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  return { name, privateKey, publicKey, pubkey_hex: rawPubHex(publicKey) };
}

// Seal a receipt body AS a given identity (instead of the single host key).
// Same envelope and same canonicalBody() the verifier reconstructs — so a
// human-actor receipt verifies and aggregates through the EXACT same path as a
// host/agent receipt. `obj` MUST NOT already contain pubkey_hex/sig_hex/sha256.
export function sealReceiptAs(obj, identity) {
  const body = JSON.stringify(obj);
  const sha256 = sha256Hex(body);
  const sig_hex = edSign(null, Buffer.from(body), identity.privateKey).toString('hex');
  return { ...obj, pubkey_hex: identity.pubkey_hex, sig_hex, sha256 };
}

// Deterministic Merkle root over a set of receipt leaves (their sha256 hex).
// Leaves are sorted so the root is independent of receipt order — a single hash
// an underwriter pins to attest "these exact receipts, unaltered." Adding any
// receipt changes the root. Odd levels duplicate the last leaf (Bitcoin-style).
export function attestationRoot(leaves) {
  let level = [...(leaves || [])].filter(Boolean).sort();
  if (!level.length) return null;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? level[i];
      next.push(sha256Hex(a + b));
    }
    level = next;
  }
  return level[0];
}

// Verify a sealed receipt: sha256 integrity AND ed25519 signature over the
// reconstructed canonical body, keyed by the receipt's own claimed pubkey.
// Returns { ok:true, pubkey_hex } or { ok:false, reason }.
//
// T1 / HOST-KEY PINNING (the unforgeability gate). By default the verifier trusts
// the receipt's OWN embedded pubkey — which proves "whoever signed this held A key,"
// not "the attested host signed it." A forger can therefore mint a valid-looking
// receipt with their OWN key. Pass opts.trustedPubkeys = [hex,…] to PIN the signer:
// a receipt whose pubkey is not in the attested set is rejected. With the host key
// pinned (and, in production, sealed in the Secure Enclave / tape-out so it cannot
// be extracted), "sign it with your own key" no longer forges. The residual — proving
// the projection actually ran on THIS silicon — is the hardware-attestation (SE / tape-out).
export function verifyReceipt(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'not an object' };
  const { pubkey_hex, sig_hex, sha256 } = payload;
  if (!pubkey_hex) return { ok: false, reason: 'missing pubkey_hex' };
  if (!sig_hex) return { ok: false, reason: 'missing sig_hex' };
  if (!sha256) return { ok: false, reason: 'missing sha256' };

  // host-key pinning: the signer must be an attested key, else it's an untrusted forgery.
  const trusted = opts.trustedPubkeys;
  if (Array.isArray(trusted) && trusted.length && !trusted.includes(pubkey_hex)) {
    return { ok: false, reason: 'untrusted signer (pubkey not in pinned/attested set)' };
  }

  const body = canonicalBody(payload);
  if (sha256Hex(body) !== sha256) {
    return { ok: false, reason: 'sha256 mismatch (body tampered)' };
  }
  let pub;
  try { pub = pubKeyFromHex(pubkey_hex); }
  catch (e) { return { ok: false, reason: `bad pubkey_hex: ${e.message}` }; }
  let valid = false;
  try { valid = edVerify(null, Buffer.from(body), pub, Buffer.from(sig_hex, 'hex')); }
  catch (e) { return { ok: false, reason: `ed25519 verify error: ${e.message}` }; }
  if (!valid) return { ok: false, reason: 'ed25519 signature invalid' };

  return { ok: true, pubkey_hex };
}
