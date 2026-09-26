// src/lib/notary/gateway.mjs — C44 THE INDEPENDENT NOTARY WITNESS GATEWAY (goal 4 unit 1, 2026-09-18).
// The handler behind POST /api/notary/ingest, as a pure function over an adapter pair so the guard drives it in-process and
// the edge route wraps it. WebCrypto ONLY (globalThis.crypto.subtle): the same bytes run on Node ≥ 20 and on the edge
// runtime — there is no node:crypto on commodity Vercel edge, and there is no enclave anywhere: trust rests on ed25519 +
// Merkle inclusion + the append-only chain, nothing else.
//
// A CAR arrives as the C63 view PLUS the row's canonical signed bytes (carOf → signature.signed_bytes). The gateway:
//   1. verifies the ed25519 signature over signed_bytes under the SENDER'S REGISTERED pubkey (registry keyed by fingerprint;
//      first registration is C75's door) — else 401, and the whole batch appends nothing;
//   2. binds every field the CAR claims (commit_sha · at · merkle_root · tesseract_sha) to those signed bytes — a CAR that
//      claims what its signature does not cover is a forgery, 401;
//   3. recomputes every inclusion proof to the merkle_root the sender signed — the server holds no spec and no "active
//      root" of its own — else 422;
//   4. car_sha = sha256(signed_bytes), recomputed here, never read from the client: a CAR already witnessed returns its
//      EXISTING receipt and costs nothing;
//   5. one credit per NEW verified CAR, the batch priced whole: 402 with needed/available when the account cannot pay,
//      nothing appended;
//   6. appends { sequence_height, sender, car_sha, merkle_root, tesseract_sha, received_at, prev_hash, entry_hash } and
//      returns { sequence_height, witness_root, timestamp, car_sha, notary_signature, mmr } signed with the notary's own key
//      (env secret, never in the repo). witness_root is the MMR root (C85a, mmr.mjs) over every car_sha up to that height; the
//      entry_hash chain stays beside it (prev_hash commits to it); mmr { leaf_index, peak_index, path, peaks } is the leaf's own
//      membership proof, and proof({ car_sha }) serves one against the current head.
// The ledger and accounts are INTERFACES, every call AWAITED (C84d): memoryLedger/memoryAccounts are the guard's; the durable
// one is pg-ledger.mjs (chainLedger over the repo's Postgres, append-only with the chain columns, NOTARY_LEDGER=postgres) and
// the accounts are credits-ledger.mjs's creditsAccounts (the rows the Stripe webhook writes, C84c) — 402 carries the price.

import { createMMR } from './mmr.mjs';   // C85a: witness_root is the MMR root over the ledger's car_shas at that height; the entry_hash chain stays beside it

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array((String(h).match(/../g) || []).map((x) => parseInt(x, 16)));
const isHex = (h, len) => typeof h === 'string' && (len == null || h.length === len) && /^[0-9a-f]*$/.test(h);
const PKCS8_PREFIX = '302e020100300506032b657004220420'; // Ed25519 PKCS#8 wrapper for a 32-byte seed

export const sha256 = async (s) => hex(await subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
// the tree's hashing rule, verbatim from spec-tree.mjs (parentHash = sha256(`${own}\n${children.join('\n')}`)); the guard pins equality
const parentHash = (own, childHashes) => sha256(`${own}\n${childHashes.join('\n')}`);
export async function verifyProof(pr) { let h = pr.hash; for (const s of pr.path) h = await parentHash(s.own, [...s.before, h, ...s.after]); return h; }
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
export const canonicalBytes = (o) => JSON.stringify(sortKeys(o)); // tesseract-state.mjs's rule: sorted keys, no whitespace

export const fingerprintOf = (pubkeyHex) => sha256(unhex(pubkeyHex)).then((h) => h.slice(0, 16));
const importPub = (pubkeyHex) => subtle.importKey('raw', unhex(pubkeyHex), { name: 'Ed25519' }, true, ['verify']);
async function edVerify(pubkeyHex, message, sigHex) { try { return await subtle.verify({ name: 'Ed25519' }, await importPub(pubkeyHex), unhex(sigHex), enc.encode(message)); } catch { return false; } }

// the notary's own identity from a 32-byte hex seed (env NOTARY_ED25519_SEED — never in the repo)
export async function notaryKeyFromSeed(seedHex) {
  if (!isHex(seedHex, 64)) throw new Error('notary seed must be 32 bytes hex');
  const privateKey = await subtle.importKey('pkcs8', unhex(PKCS8_PREFIX + seedHex), { name: 'Ed25519' }, true, ['sign']);
  const jwk = await subtle.exportKey('jwk', privateKey); const pubRaw = Uint8Array.from(atob(jwk.x.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return { privateKey, pubkey: hex(pubRaw) };
}
const RECEIPT_KEYS = ['sequence_height', 'witness_root', 'timestamp', 'car_sha'];
export const receiptBytes = (r) => JSON.stringify(Object.fromEntries(RECEIPT_KEYS.map((k) => [k, r[k]])));   // C81b: the client verifies over the same bytes (tape-sync.mjs verifyWitnessRow)
export const verifyReceipt = (receipt, notaryPubkeyHex) => edVerify(notaryPubkeyHex, receiptBytes(receipt), receipt.notary_signature);

// ── adapters ─────────────────────────────────────────────────────────────────────────────────────────
export function memoryLedger() {
  const entries = []; const byCar = new Map(); const receipts = new Map(); const snapshots = new Map(); const bySender = new Map();
  return {
    kind: 'memory', height: () => entries.length,
    // C74: the highest sender_seq witnessed for a fingerprint — the client's cursor comes from here, never from its own file alone
    senderHead: (fp) => bySender.get(fp) || null, head: () => (entries.length ? entries[entries.length - 1] : null), at: (h) => entries[h - 1] || null,
    byCarSha: (s) => byCar.get(s) || null, receiptFor: (s) => receipts.get(s) || null,
    append(entry, receipt) { if (entry.sequence_height !== entries.length + 1) throw new Error('height gap'); entries.push(entry); byCar.set(entry.car_sha, entry); receipts.set(entry.car_sha, receipt); const h = bySender.get(entry.sender) || { witnessed: 0, last_seq: 0, last_car_sha: null, last_sequence_height: 0 }; h.witnessed++; if ((entry.sender_seq || 0) >= h.last_seq) { h.last_seq = entry.sender_seq || 0; h.last_car_sha = entry.car_sha; h.last_sequence_height = entry.sequence_height; } bySender.set(entry.sender, h); return entry; },
    putSnapshot: (sha, state) => { if (!snapshots.has(sha)) snapshots.set(sha, state); }, getSnapshot: (sha) => snapshots.get(sha) || null,
  };
}
export function memoryAccounts() {
  const byFp = new Map(); const fpOf = new Map();
  return {
    kind: 'memory',
    async register(pubkeyHex, credits = 0) { const fp = await fingerprintOf(pubkeyHex); byFp.set(fp, { pubkey: pubkeyHex, credits }); fpOf.set(pubkeyHex, fp); return fp; },
    get: (fp) => byFp.get(fp) || null, credits: (fp) => (byFp.get(fp) || { credits: 0 }).credits,
    debit(fp, n) { const a = byFp.get(fp); if (!a || a.credits < n) throw new Error('insufficient'); a.credits -= n; return a.credits; },
  };
}

// ── the handler ──────────────────────────────────────────────────────────────────────────────────────
const CAR_FIELDS = ['at', 'commit_sha', 'merkle_root', 'inclusion_proof', 'tesseract_sha', 'signature'];
const R = (status, body) => ({ status, body });

export function createGateway({ ledger, accounts, notary: notaryIn, party = 'notary', now = () => new Date().toISOString() }) {
  let notary = null; // notaryKeyFromSeed is async (WebCrypto); accept the key or its promise
  async function check(car, i) {
    const bad = (why) => ({ i, commit_sha: car && car.commit_sha, why });
    if (!car || typeof car !== 'object') return { reject: bad('not an object'), code: 400 };
    for (const k of CAR_FIELDS) if (car[k] == null) return { reject: bad(`missing ${k}`), code: 400 };
    const s = car.signature; if (!s || !isHex(s.sig, 128) || !isHex(s.pubkey, 64) || typeof s.signed_bytes !== 'string') return { reject: bad('signature must carry sig (64 bytes hex) · pubkey (32 bytes hex) · signed_bytes'), code: 400 };
    const fp = await fingerprintOf(s.pubkey); const account = await accounts.get(fp);
    if (!account || account.pubkey !== s.pubkey) return { reject: bad(`pubkey ${fp} is not registered`), code: 401 };
    if (!(await edVerify(s.pubkey, s.signed_bytes, s.sig))) return { reject: bad('signature does not verify over signed_bytes under the registered pubkey'), code: 401 };
    let row; try { row = JSON.parse(s.signed_bytes); } catch { return { reject: bad('signed_bytes is not a JSON row'), code: 401 }; }
    const bound = [['commit_sha', row.sha], ['at', row.ts], ['merkle_root', row.proofs && row.proofs.root], ['tesseract_sha', row.proofs && row.proofs.tesseract_sha]];
    for (const [k, v] of bound) if (car[k] !== v) return { reject: bad(`${k} is not what the signed bytes carry`), code: 401 };
    if (!Array.isArray(car.inclusion_proof) || !car.inclusion_proof.length) return { reject: bad('no inclusion proof'), code: 422 };
    for (const leaf of car.inclusion_proof) {
      if (!leaf || !isHex(leaf.leaf_hash, 64) || !Array.isArray(leaf.inclusion_proof)) return { reject: bad('inclusion proof malformed'), code: 422 };
      const root = await verifyProof({ hash: leaf.leaf_hash, path: leaf.inclusion_proof });
      if (root !== car.merkle_root) return { reject: bad(`inclusion proof for ${leaf.label || leaf.leaf_id} recomputes to ${root.slice(0, 12)}, not the signed merkle_root`), code: 422 };
    }
    return { ok: { fp, car_sha: await sha256(s.signed_bytes), car, sender_seq: Number.isFinite(row.seq) ? row.seq : 0 } };
  }
  async function checkSnapshot(snap, i) {
    if (!snap || typeof snap !== 'object' || !isHex(snap.tesseract_sha, 64) || !snap.state || typeof snap.state !== 'object') return { i, why: 'snapshot must carry tesseract_sha and state' };
    const sha = await sha256(canonicalBytes(snap.state)); if (sha !== snap.tesseract_sha) return { i, why: `snapshot does not hash to its claimed tesseract_sha (${sha.slice(0, 12)} ≠ ${snap.tesseract_sha.slice(0, 12)})` };
    return null;
  }
  // C85a: the accumulator over the ledger's car_shas, in height order. Rebuilt from the ledger itself (ledger.at(h)) whenever it is
  // behind — a cold start, or a durable ledger another instance appended to — so the root at height h is a function of the retained
  // record and nothing held in memory. witness_root = the MMR root at that height; the receipt carries the leaf's own proof.
  const mmr = createMMR();
  async function catchUp() { for (let h = mmr.leafCount() + 1; h <= await ledger.height(); h++) { const e = await ledger.at(h); if (!e || !e.car_sha) throw new Error(`ledger has no entry at height ${h} — the accumulator cannot be rebuilt`); await mmr.append(e.car_sha); } }
  async function receiptFor(entry) {
    await catchUp(); if (mmr.leafCount() !== entry.sequence_height - 1) throw new Error(`accumulator at ${mmr.leafCount()} leaves, entry at height ${entry.sequence_height}`);
    const { leaf_index, root } = await mmr.append(entry.car_sha); const pr = mmr.proof(leaf_index);
    const r = { sequence_height: entry.sequence_height, witness_root: root, timestamp: entry.received_at, car_sha: entry.car_sha };
    r.notary_signature = hex(await subtle.sign({ name: 'Ed25519' }, notary.privateKey, enc.encode(receiptBytes(r))));
    r.mmr = { leaf_index, peak_index: pr.peak_index, path: pr.path, peaks: pr.peaks };
    r.signatures = [{ party, pubkey: notary.pubkey, sig: r.notary_signature }];   // C85b: the first party; auditor nodes countersign the same bytes (cosign) and the client counts k-of-n itself
    return r;
  }
  // C85b: countersign ANOTHER notary's receipt over a CAR this node verifies itself — the same check as ingest, then the receipt's
  // car_sha must be sha256(the CAR's signed bytes), and if this node's own ledger already witnessed that car_sha under DIFFERENT
  // bytes the answer is 409: a co-signer that disagrees on the bytes is not a co-signer, it is a fork, and the client is told so.
  async function cosign({ car, receipt } = {}) {
    if (notary == null && notaryIn) { try { notary = await notaryIn; } catch { notary = null; } }
    if (!notary || !notary.privateKey) return R(503, { why: 'no notary key — nothing to countersign with; set NOTARY_ED25519_SEED' });
    if (!receipt || typeof receipt !== 'object' || !RECEIPT_KEYS.every((k) => receipt[k] != null)) return R(400, { why: 'receipt must carry sequence_height · witness_root · timestamp · car_sha' });
    const c = await check(car, 0); if (c.reject) return R(c.code, { rejected: [c.reject], signed: 0 });
    if (c.ok.car_sha !== receipt.car_sha) return R(422, { why: `receipt car_sha ${String(receipt.car_sha).slice(0, 12)} is not sha256 of the CAR's signed bytes (${c.ok.car_sha.slice(0, 12)})`, signed: 0 });
    const over = receiptBytes(receipt); const mine = await ledger.receiptFor(receipt.car_sha);
    if (mine && receiptBytes(mine) !== over) return R(409, { why: 'fork — this node witnessed the same CAR under different bytes; a co-signer that disagrees on the bytes is not a co-signer', ours: receiptBytes(mine), theirs: over, signed: 0 });
    const sig = hex(await subtle.sign({ name: 'Ed25519' }, notary.privateKey, enc.encode(over)));
    return R(200, { party, pubkey: notary.pubkey, sig, over, signed: 1 });
  }

  return {
    async ingest(payload) {
      if (notary == null && notaryIn) { try { notary = await notaryIn; } catch { notary = null; } }
      if (!notary || !notary.privateKey) return R(503, { why: 'no notary key — receipts would be unsigned; set NOTARY_ED25519_SEED' });
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.records)) return R(400, { why: 'body must be { records: [CAR], tesseract_snapshots?: [Snapshot] }' });
      const snaps = payload.tesseract_snapshots == null ? [] : payload.tesseract_snapshots; if (!Array.isArray(snaps)) return R(400, { why: 'tesseract_snapshots must be an array' });
      // verify everything before touching the ledger — a batch with one forgery appends nothing
      const checked = []; for (let i = 0; i < payload.records.length; i++) checked.push(await check(payload.records[i], i));
      const rejected = checked.filter((c) => c.reject); if (rejected.length) return R(Math.max(...rejected.map((c) => c.code)), { rejected: rejected.map((c) => c.reject), appended: 0 });
      const snapRejects = []; for (let i = 0; i < snaps.length; i++) { const r = await checkSnapshot(snaps[i], i); if (r) snapRejects.push(r); }
      if (snapRejects.length) return R(400, { rejected: snapRejects, appended: 0 });
      // price the batch whole: a replay is free, a new CAR is one credit from the account its pubkey is bound to
      const fresh = []; const seen = new Set(); const need = new Map();
      for (const c of checked) { const { fp, car_sha } = c.ok; if ((await ledger.byCarSha(car_sha)) || seen.has(car_sha)) continue; seen.add(car_sha); fresh.push(c.ok); need.set(fp, (need.get(fp) || 0) + 1); }
      for (const [fp, n] of need) { const have = await accounts.credits(fp); if (have < n) return R(402, { why: 'insufficient credits — nothing appended', account: fp, needed: n, available: have, appended: 0, price: accounts.price ? accounts.price() : undefined }); }   // C84d: 402 is a PRICE, never a refusal to measure
      // append + receipt, in order; replays return their existing receipt
      const receipts = []; const at = now();
      for (const c of checked) {
        const { fp, car_sha, car, sender_seq } = c.ok; const existing = await ledger.receiptFor(car_sha);
        if (existing) { receipts.push({ ...existing, replay: true }); continue; }
        const head = await ledger.head(); const entry = { sequence_height: (await ledger.height()) + 1, sender: fp, sender_seq, car_sha, merkle_root: car.merkle_root, tesseract_sha: car.tesseract_sha, received_at: at, prev_hash: head ? head.entry_hash : null };
        entry.entry_hash = await sha256(JSON.stringify(entry));
        await accounts.debit(fp, 1, { car_sha }); const receipt = await receiptFor(entry); await ledger.append(entry, receipt); receipts.push(receipt);
      }
      let stored = 0; for (const s of snaps) { if (!(await ledger.getSnapshot(s.tesseract_sha))) { await ledger.putSnapshot(s.tesseract_sha, s.state); stored++; } }
      return R(200, { receipts, appended: receipts.filter((r) => !r.replay).length, height: await ledger.height(), snapshots: { stored, offered: snaps.length }, notary_pubkey: notary.pubkey, ledger: ledger.kind });
    },
    height: async () => ledger.height(), cosign,   // C84d: every adapter call is awaited — the durable ledger (pg-ledger.mjs) answers asynchronously; the memory one still answers in place
    // C85a: a membership proof for a witnessed CAR against the CURRENT head — a later height proves an earlier receipt (path ≤ ⌈log₂N⌉ + peaks)
    async proof({ car_sha } = {}) {
      if (!isHex(car_sha, 64)) return R(400, { why: 'car_sha must be 32 bytes hex' });
      const entry = await ledger.byCarSha(car_sha); if (!entry) return R(404, { why: 'no witness for this car_sha' });
      await catchUp(); const pr = mmr.proof(entry.sequence_height - 1);
      return R(200, { car_sha, sequence_height: entry.sequence_height, height: await ledger.height(), root: await mmr.root(), proof: pr });
    },
    fingerprint: (pubkeyHex) => fingerprintOf(pubkeyHex),
    // C74: what this device's cursor is from the notary's side — the highest sender_seq witnessed under its key
    async device(pubkeyHex) { const fingerprint = await fingerprintOf(pubkeyHex); const h = (ledger.senderHead && await ledger.senderHead(fingerprint)) || { witnessed: 0, last_seq: 0, last_car_sha: null, last_sequence_height: 0 }; return { fingerprint, ...h }; },
  };
}
