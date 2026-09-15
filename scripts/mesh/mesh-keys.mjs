#!/usr/bin/env node
// scripts/mesh/mesh-keys.mjs — Step 2: host-derived per-room ed25519 identities.
// ─────────────────────────────────────────────────────────────────────────────
// Each room is a NODE with its own cryptographic identity, derived from the host
// key so a `builder` signature carries distinct SPATIAL AUTHORITY no other daemon
// can forge:
//        Key_room = HKDF(HostSeed, salt="room-identity", info=room_name)
//
// Only a holder of the host key can derive any room key, so room signatures are
// host-bound. The registry (room → pubkey) is deterministic, so any verifier can
// recompute it and pin signers — a cross-room signature is rejected as a forgery.
//
//   node scripts/mesh/mesh-keys.mjs                 # print the room→pubkey registry
//   node scripts/mesh/mesh-keys.mjs --write          # also write the signed registry file
//
// Importable:  import { roomIdentity, roomRegistry, nodeForPubkey } from './mesh-keys.mjs'
// ─────────────────────────────────────────────────────────────────────────────
import { hkdfSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrCreateHostKeys, sealReceipt } from '../pmu/receipt-crypto.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const ROOMS_JSON = resolve(REPO, 'data/rooms.json');
const REGISTRY = process.env.MESH_REGISTRY || join(REPO, '.thetacog', 'mesh', 'room-registry.json');

// PKCS8 DER prefix for a raw 32-byte ed25519 seed (RFC 8410).
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const HKDF_SALT = 'room-identity';

const rawPubHex = (publicKey) => Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');

function hostSeed() {
  const jwk = loadOrCreateHostKeys().privateKey.export({ format: 'jwk' });
  return Buffer.from(jwk.d, 'base64url');            // the host's raw 32-byte ed25519 seed
}

const _cache = new Map();
// Derive a stable, host-bound ed25519 identity for a room.
export function roomIdentity(room) {
  if (_cache.has(room)) return _cache.get(room);
  const seed = Buffer.from(hkdfSync('sha256', hostSeed(), Buffer.from(HKDF_SALT), Buffer.from(String(room)), 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const id = { room, privateKey, publicKey, pubkey_hex: rawPubHex(publicKey) };
  _cache.set(room, id);
  return id;
}

export function roomKeys() {
  const doc = JSON.parse(readFileSync(ROOMS_JSON, 'utf8'));
  return Object.keys(doc.rooms || doc);
}

// room → pubkey_hex for every room (deterministic; any verifier can recompute it)
export function roomRegistry() {
  const reg = {};
  for (const room of roomKeys()) reg[room] = roomIdentity(room).pubkey_hex;
  return reg;
}

// reverse lookup: which room owns this pubkey? (null = unknown / forged)
export function nodeForPubkey(pubkey_hex) {
  for (const [room, pk] of Object.entries(roomRegistry())) if (pk === pubkey_hex) return room;
  return null;
}

// host-signed registry file so a verifier without the host key can still pin signers
export function writeRegistry() {
  mkdirSync(dirname(REGISTRY), { recursive: true });
  const sealed = sealReceipt({ kind: 'mesh-room-registry', salt: HKDF_SALT, rooms: roomRegistry() });
  writeFileSync(REGISTRY, JSON.stringify(sealed, null, 2) + '\n');
  return REGISTRY;
}
export function loadRegistry() {
  if (existsSync(REGISTRY)) { try { return JSON.parse(readFileSync(REGISTRY, 'utf8')).rooms; } catch { /* recompute */ } }
  return roomRegistry();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const reg = roomRegistry();
  if (process.argv.includes('--write')) console.log('✅ wrote ' + writeRegistry());
  console.log('\n  MESH ROOM REGISTRY  (Key_room = HKDF(host, "room-identity", room))\n');
  for (const [room, pk] of Object.entries(reg)) console.log(`  ${room.padEnd(12)} ${pk}`);
  console.log('');
}
