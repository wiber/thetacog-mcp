// scripts/vna/machine-store.mjs — C173d THE DEVICE IS THE MACHINE, NOT THE APP (2026-09-22).
//
// Measured 2026-09-22: the licence in the operator's mailbox is signed to pubkey_fingerprint 19d66dc55db220b8, which is the
// ARCHITECT ROOM's derived key (mesh-keys roomIdentity('architect')). auth-flow.mjs deviceIdentity() resolved the device key
// from the room the host ran in, so VS Code (architect) presented 19d66dc55db220b8 and Cursor (laboratory) presented
// a29564ae013d1f27 — one Mac, two "devices", and the second IDE could never use the key it had paid for. The entitlement JWT
// sat in ONE app's per-app SecretStorage on top of that. This module is the ONE per-machine store both live in:
//
//   darwin      the login keychain, service=thetacog — account `device-key` holds the device's raw 32-byte ed25519 seed (hex),
//               account `entitlement` holds the licence JWT. Read with `security find-generic-password -s thetacog -a <acct> -w`,
//               written with `security -i` fed `add-generic-password -U …` on STDIN, so the value never rides argv (argv is
//               visible to every process on the host). No native dependency: /usr/bin/security via execFile.
//   otherwise   THE DECLARED FALLBACK: a file per account under ~/.thetacog/machine/ — directory 0700, file 0600. It is a
//               plaintext file guarded by POSIX permissions, not a keychain; it is the same trust level as the host key under
//               ~/.thetacog/pmu/keys that every tape row is already signed with, and it is named here so nobody mistakes it
//               for more.
//   THETACOG_MACHINE_STORE=<dir> forces the file store at <dir> on any platform — the hermetic door every test uses so no
//               test ever reads or writes the real keychain. `exec` and `platform` are injectable for the same reason.
//
// MIGRATE, NEVER RE-MINT. resolveDeviceKey(): keychain has a seed → it wins. Keychain empty and a legacy seed exists → the
// legacy bytes are copied in byte-for-byte (the fingerprint the site bound the licence to survives). Neither → a fresh seed.
// Both present and different → the keychain wins and the disagreement is a row on ~/.thetacog/machine-store.ndjson, never a
// silent overwrite. resolveEntitlement() applies the same rule to the licence JWT, with SecretStorage as the read-only legacy.
// @guard tests/vna/c173d-one-machine-one-device.test.mjs
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE = 'thetacog';
export const ACCOUNT = { device: 'device-key', entitlement: 'entitlement' };
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');   // raw 32-byte ed25519 seed → PKCS8 DER (RFC 8410)
const SAFE = /^[A-Za-z0-9._-]+$/;   // hex seeds and base64url JWTs only — the one alphabet that needs no quoting inside `security -i`

const defaultLog = () => process.env.THETACOG_MACHINE_STORE_LOG || join(homedir(), '.thetacog', 'machine-store.ndjson');

/** the per-machine store: { kind, where, get(account) → string|null, set(account, value), del(account) } */
export function machineStore({ exec = execFileSync, platform = process.platform, dir = process.env.THETACOG_MACHINE_STORE || null } = {}) {
  if (dir || platform !== 'darwin') return fileStore(dir || join(homedir(), '.thetacog', 'machine'));
  return keychainStore(exec);
}

function keychainStore(exec) {
  const get = (account) => {
    try {
      const out = exec('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      const v = String(out ?? '').trim(); return v || null;
    } catch { return null; }   // exit 44: no such item — absent, not an error
  };
  return {
    kind: 'keychain', where: `keychain service=${SERVICE}`,
    get,
    set(account, value) {
      const v = String(value);
      if (!SAFE.test(v) || !SAFE.test(account)) throw new Error('machine-store: refusing a value outside [A-Za-z0-9._-] (a seed is hex, a JWT is base64url)');
      exec('security', ['-i'], { input: `add-generic-password -U -s ${SERVICE} -a ${account} -w ${v}\n`, encoding: 'utf8', stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000 });
      if (get(account) !== v) throw new Error(`machine-store: the keychain did not hold ${account} after the write`);
    },
    del(account) { try { exec('security', ['delete-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore', timeout: 5000 }); } catch { /* absent */ } },
  };
}

function fileStore(dir) {
  const p = (account) => join(dir, account);
  return {
    kind: 'file', where: dir,
    get(account) { try { const v = readFileSync(p(account), 'utf8').trim(); return v || null; } catch { return null; } },
    set(account, value) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(p(account), String(value), { mode: 0o600 });
      chmodSync(p(account), 0o600);   // writeFileSync's mode applies only on create; an existing file is re-pinned
    },
    del(account) { try { unlinkSync(p(account)); } catch { /* absent */ } },
  };
}

function logRow(row, log = defaultLog()) {
  if (typeof log === 'function') { log(row); return; }
  try { mkdirSync(dirname(log), { recursive: true }); appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n'); } catch { /* the log is a receipt, never a gate */ }
}

// ── THE DEVICE KEY ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function keyFromSeed(seedHex) {
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const pubkey_hex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  return { privateKey, publicKey, pubkey_hex, fingerprint: createHash('sha256').update(Buffer.from(pubkey_hex, 'hex')).digest('hex').slice(0, 16) };
}
/** the raw 32-byte seed of a node KeyObject, hex — how a legacy (derived) key is copied byte-for-byte */
export const seedOf = (privateKey) => Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('hex');
const isSeed = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);

/**
 * THE ONE DEVICE KEY FOR THIS MACHINE.
 *   legacySeed  a seed another store literally HOLDS (e.g. an app's SecretStorage) — compared on every call, so a disagreement
 *               with the machine store is logged, never resolved by overwriting.
 *   legacy      a thunk for the seed this machine PRESENTED before C173d (auth-flow.mjs derives it: the key the held claim
 *               is bound to, else the room key it would have used) — called only when the machine store is empty, because
 *               a derived key is not a second store and differing from it after the move is expected, not a disagreement.
 * → { seedHex, privateKey, publicKey, pubkey_hex, fingerprint, source: 'machine'|'migrated'|'minted', where, disagreement? }
 */
export function resolveDeviceKey({ store = machineStore(), legacySeed = null, legacy = () => null, log } = {}) {
  const held = store.get(ACCOUNT.device);
  if (isSeed(held)) {
    const old = legacySeed;
    const out = { seedHex: held.toLowerCase(), ...keyFromSeed(held), source: 'machine', where: store.where };
    if (isSeed(old) && old.toLowerCase() !== out.seedHex) {
      out.disagreement = { kept: out.fingerprint, ignored: keyFromSeed(old).fingerprint };
      logRow({ why: 'device-key disagreement — the machine store wins, the legacy key is ignored, nothing overwritten', ...out.disagreement, where: store.where }, log);
    }
    return out;
  }
  let old = isSeed(legacySeed) ? legacySeed : null;
  if (!old) { try { old = legacy(); } catch { old = null; } }
  if (isSeed(old)) {
    store.set(ACCOUNT.device, old.toLowerCase());
    const out = { seedHex: old.toLowerCase(), ...keyFromSeed(old), source: 'migrated', where: store.where };
    logRow({ why: 'device-key migrated into the machine store byte-for-byte', fingerprint: out.fingerprint, where: store.where }, log);
    return out;
  }
  const seed = randomBytes(32).toString('hex');
  store.set(ACCOUNT.device, seed);
  const out = { seedHex: seed, ...keyFromSeed(seed), source: 'minted', where: store.where };
  logRow({ why: 'device-key minted — no machine store entry and no legacy key', fingerprint: out.fingerprint, where: store.where }, log);
  return out;
}

// ── THE LICENCE ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** the JWT's payload for display — verification happened before it was ever stored; expired or malformed reads as null */
export function claimsOf(jwt, now = Date.now()) {
  try {
    const c = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
    if (!c || typeof c !== 'object') return null;
    if (typeof c.exp === 'number' && c.exp * 1000 < now) return null;
    return c;
  } catch { return null; }
}

/**
 * THE ONE LICENCE FOR THIS MACHINE. `legacyJwt` is what this app's SecretStorage holds (read-only migration source).
 * → { entitlement: string|null, claims: object|null, source: 'machine'|'migrated'|'none', disagreement? }
 */
export function resolveEntitlement({ store = machineStore(), legacyJwt = null, now = Date.now(), log } = {}) {
  const held = store.get(ACCOUNT.entitlement);
  const heldClaims = held ? claimsOf(held, now) : null;
  const legacy = legacyJwt && String(legacyJwt).trim() ? String(legacyJwt).trim() : null;
  if (held && heldClaims) {
    const out = { entitlement: held, claims: heldClaims, source: 'machine' };
    if (legacy && legacy !== held) {
      out.disagreement = { kept: heldClaims.pubkey_fingerprint ?? null, ignored: claimsOf(legacy, now)?.pubkey_fingerprint ?? null };
      logRow({ why: 'entitlement disagreement — the machine store wins, the app\'s SecretStorage copy is ignored, nothing overwritten', ...out.disagreement }, log);
    }
    return out;
  }
  const legacyClaims = legacy ? claimsOf(legacy, now) : null;
  if (legacy && legacyClaims) {
    if (held) logRow({ why: 'entitlement in the machine store had expired or was unreadable — replaced by the app\'s unexpired copy', fingerprint: legacyClaims.pubkey_fingerprint ?? null }, log);
    store.set(ACCOUNT.entitlement, legacy);
    logRow({ why: 'entitlement migrated from the app\'s SecretStorage into the machine store byte-for-byte', fingerprint: legacyClaims.pubkey_fingerprint ?? null }, log);
    return { entitlement: legacy, claims: legacyClaims, source: 'migrated' };
  }
  return { entitlement: null, claims: null, source: 'none' };
}

/** the C173c claims snapshot (non-secret: account · fingerprint · credits · exp) — read for the device-key migration only */
export function snapshotClaims(file = process.env.VNA_CLAIMS_SNAPSHOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../.thetacog/entitlement-claims.json')) {
  try { const c = JSON.parse(readFileSync(file, 'utf8')); return c && c.pubkey_fingerprint ? c : null; } catch { return null; }
}

/** store a VERIFIED entitlement (the caller verified it — auth-flow.mjs verify|connect|notarise) as this machine's licence */
export function storeEntitlement(jwt, { store = machineStore() } = {}) { store.set(ACCOUNT.entitlement, String(jwt).trim()); }
export function clearEntitlement({ store = machineStore() } = {}) { store.del(ACCOUNT.entitlement); }
