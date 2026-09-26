#!/usr/bin/env node
// scripts/vna/tape-sync.mjs — C74 THE INCREMENTAL CLIENT SYNC (goal 4 unit 2, 2026-09-18).
// Ships the flight tape's COMPLETE CARs (carOf — signature verifies, every inclusion proof recomputes) to the notary
// gateway (C44) and keeps the receipts. The cursor is a TAPE seq per device pubkey, and it is decided from two records:
//   remote  GET <endpoint>?pubkey=<hex> → device.last_seq, the highest sender_seq the notary has witnessed under this key
//   local   .thetacog/notary-cursor.json → the last seq a receipt was WRITTEN for (data/vna/notary-witness.ndjson)
//   effective = min(remote, local)  ·  --cursor N overrides both
// min, because a CAR the notary holds but we never got a receipt for (a cut mid-batch) must be re-offered — the gateway
// answers a replay with its EXISTING receipt for free (C44), so the receipt lands and nothing is witnessed twice; and a
// local cursor above the remote (a wiped or different notary) must not hide rows the notary has never seen. The cursor
// advances only to the last RECEIPTED seq, per batch, so an interrupted run resumes from its last receipt.
// Every witness row: { car_sha, sequence_height, witness_root, notary_signature, received_at } + seq · commit_sha · pubkey ·
// fingerprint (C44 fingerprintOf) · replay. `notaryCard` (C76) is the ONE rule the workbench paints from this file.
// 401 → exit 3 · 402 → exit 4 · 503 → exit 5 · transport → exit 2 — SAID, never retried, and the cursor does not move.
// The bearer entitlement (C75's door) rides Authorization when present: --bearer, NOTARY_BEARER, or
// .thetacog/notary-entitlement.json { token }. --dry-run prints the slice and posts nothing.
//   node scripts/vna/tape-sync.mjs [--endpoint URL] [--cursor N] [--batch 25] [--dry-run] [--pubkey hex] [--json]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carOf, FLIGHT, PROOFS_DIR } from './flight-tape.mjs';
import { STATE } from './tesseract-state.mjs';
import { fingerprintOf, receiptBytes } from '../../src/lib/notary/gateway.mjs';   // C76: the witness row names the device by C44's one fingerprint rule · C81b: the receipt bytes the notary signed
import { createMMR, leafHash } from '../../src/lib/notary/mmr.mjs';
import { cosignCount, cosignLine } from './cosign.mjs';   // C85b: k-of-n over the receipt's signatures, counted here, never a server's word
import { QUEUE_FILE, queueState, enqueue, markAttempt, markDrained, isPartition } from './notary-queue.mjs';   // C85c: the offline queue's one door
import { createHash } from 'node:crypto';   // C85a: the chain-inclusion walk, recomputed client-side from bytes on disk (WebCrypto, the same code the gateway runs)
import { createPublicKey, verify as edVerifySync } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const ENDPOINT = process.env.NOTARY_ENDPOINT || 'https://thetadriven.com/api/notary/ingest';
export const CURSOR_FILE = process.env.VNA_NOTARY_CURSOR || resolve(REPO, '.thetacog/notary-cursor.json');
export const WITNESS_FILE = process.env.VNA_NOTARY_WITNESS || resolve(REPO, 'data/vna/notary-witness.ndjson');
export const ENTITLEMENT_FILE = process.env.VNA_NOTARY_ENTITLEMENT || resolve(REPO, '.thetacog/notary-entitlement.json');
export const EXIT = { OK: 0, USAGE: 1, TRANSPORT: 2, UNAUTHENTICATED: 3, PAYMENT: 4, REFUSED: 5 };
export const TIMEOUT_MS = Number(process.env.VNA_NOTARY_TIMEOUT_MS ?? 10_000);   // C85c: a request past this is a partition, queued
const WITNESS_KEYS = ['car_sha', 'sequence_height', 'witness_root', 'notary_signature', 'received_at'];

const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

export function readCursor(file) { const c = readJson(file, null); return c && typeof c === 'object' && c.devices ? c : { v: 1, endpoint: null, devices: {} }; }
function writeCursor(file, cur) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(cur, null, 1) + '\n'); }

// the tesseract snapshot a CAR names, when the machine still holds it: the live state file (one sha) or a per-sha file beside the proofs
function snapshotFor(tsha, { statePath, proofsDir }) {
  const live = readJson(statePath, null); if (live && live.tesseract_sha === tsha) { const { tesseract_sha, ...state } = live; return { tesseract_sha, state }; }
  const kept = readJson(resolve(proofsDir, `tesseract-${tsha}.json`), null); if (kept && kept.tesseract_sha === tsha) { const { tesseract_sha, ...state } = kept; return { tesseract_sha, state: kept.state || state }; }
  return null;
}

async function http(fetchImpl, url, init) {
  let res; try { res = await fetchImpl(url, init); } catch (e) { const code = (e && e.cause && e.cause.code) || (e && e.code) || (e && e.name) || null; return { transport: `no response from ${url}: ${String(e && e.cause && e.cause.message || e.message || e).slice(0, 120)}${code ? ` [${code}]` : ''}`, code }; }
  let body = null; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
const said = (status, body) => { const b = body || {}; const rej = Array.isArray(b.rejected) && b.rejected[0] ? ` — ${b.rejected[0].why}` : ''; const why = b.why ? ` — ${b.why}` : ''; const price = status === 402 ? ` (needed ${b.needed}, available ${b.available})` : ''; return `${status}${why}${rej}${price}`; };

export async function sync({
  endpoint = ENDPOINT, tape = FLIGHT, proofsDir = PROOFS_DIR, statePath = STATE, cursorFile = CURSOR_FILE, witnessFile = WITNESS_FILE,
  cursor = null, batch = 25, dryRun = false, pubkey = null, bearer = null, fetch: fetchImpl = globalThis.fetch, quiet = false, now = () => new Date().toISOString(),
  queueFile = QUEUE_FILE, timeout = TIMEOUT_MS,
} = {}) {
  const log = quiet ? () => {} : (s) => process.stdout.write(s + '\n');
  const signal = () => (timeout > 0 && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined);
  // C85c: a partition (cannot reach the gateway) QUEUES every complete CAR above the cursor instead of failing — the drain lands them later
  const queue = (pk, above, why) => { const rows = nd(tape).filter((r) => r.kind === 'commit' && r.sig_pubkey === pk && r.seq > above); const cars = []; for (const r of rows) { const car = carOf(r, { proofsDir }); if (car && car.complete) cars.push({ car_sha: sha256hex(car.signature.signed_bytes), seq: r.seq, pubkey: pk }); } const n = enqueue(queueFile, cars, { why, now }); out.queued += n; out.why = why; log(`tape-sync: cannot reach the gateway — ${why} — ${n} CAR${n === 1 ? '' : 's'} queued on ${queueFile}; a detached drain will land them`); return n; };
  const token = bearer || process.env.NOTARY_BEARER || (readJson(ENTITLEMENT_FILE, {}) || {}).token || null;
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const rows = nd(tape).filter((r) => r.kind === 'commit' && r.sig_pubkey && (!pubkey || r.sig_pubkey === pubkey));
  const keys = [...new Set(rows.map((r) => r.sig_pubkey))];
  const local = readCursor(cursorFile); const override = cursor == null ? null : Number(cursor);
  const out = { endpoint, dryRun, devices: {}, slice: [], receipted: 0, replayed: 0, snapshots: { attached: 0, absent: 0 }, cursor: null, exit: EXIT.OK, why: null, queued: 0, queueFile };
  if (!keys.length) { log(`tape-sync: no signed commit rows on ${tape}`); out.cursor = { override, local: 0, remote: null, effective: override || 0 }; return out; }
  for (const pk of keys) {
    const mine = rows.filter((r) => r.sig_pubkey === pk).sort((a, b) => a.seq - b.seq);
    const localSeq = Number((local.devices[pk] || {}).seq || 0);
    // the remote's view of this device — one GET per run per key; a dead endpoint is said and the run stops before any POST
    let remoteSeq = null;
    if (override == null) {
      const g = await http(fetchImpl, `${endpoint}?pubkey=${pk}`, { headers, signal: signal() });
      if (isPartition(g) && !dryRun) { queue(pk, localSeq, g.transport || `GET ${said(g.status, g.body)}`); continue; }
      if (g.transport) { out.exit = EXIT.TRANSPORT; out.why = g.transport; log(`tape-sync: ${g.transport}`); return finish(); }
      if (g.status === 401) { out.exit = EXIT.UNAUTHENTICATED; out.why = said(g.status, g.body); log(`tape-sync: unauthenticated ${out.why}`); return finish(); }
      if (g.status === 503) { out.exit = EXIT.REFUSED; out.why = said(g.status, g.body); log(`tape-sync: the gateway refuses ${out.why}`); return finish(); }
      if (g.status !== 200 || !g.body) { out.exit = EXIT.TRANSPORT; out.why = `GET ${said(g.status, g.body)}${g.status === 404 ? ' — no notary route at this endpoint (C44 is not deployed there; deploy is a push and a push is the human\'s)' : ''}`; log(`tape-sync: ${out.why}`); return finish(); }
      remoteSeq = Number((g.body.device || {}).last_seq || 0);
    }
    const effective = override != null ? override : Math.min(localSeq, remoteSeq);
    const cur = { override, local: localSeq, remote: remoteSeq, effective }; out.cursor = out.cursor || cur; out.devices[pk] = { ...cur, rows: mine.length, sliced: 0, receipted: 0, replayed: 0, incomplete: 0 };
    const cars = []; for (const r of mine) { if (!(r.seq > effective)) continue; const car = carOf(r, { proofsDir }); if (!car || !car.complete) { out.devices[pk].incomplete++; continue; } cars.push(car); }
    out.devices[pk].sliced = cars.length; out.slice.push(...cars.map((c) => ({ pubkey: pk, seq: c.seq, commit_sha: c.commit_sha, tesseract_sha: c.tesseract_sha })));
    log(`tape-sync: ${pk.slice(0, 12)} · cursor local ${localSeq} · remote ${remoteSeq == null ? '(overridden)' : remoteSeq} · effective ${effective} · ${cars.length} CAR${cars.length === 1 ? '' : 's'} above it${out.devices[pk].incomplete ? ` · ${out.devices[pk].incomplete} incomplete skipped` : ''}`);
    if (dryRun) { for (const c of cars) log(`  would post seq ${c.seq} ${c.commit_sha.slice(0, 10)} tesseract ${c.tesseract_sha.slice(0, 10)}`); continue; }
    for (let i = 0; i < cars.length; i += batch) {
      const chunk = cars.slice(i, i + batch);
      const snaps = []; const seen = new Set();
      for (const c of chunk) { if (seen.has(c.tesseract_sha)) continue; seen.add(c.tesseract_sha); const s = snapshotFor(c.tesseract_sha, { statePath, proofsDir }); if (s) { snaps.push(s); out.snapshots.attached++; } else out.snapshots.absent++; }
      const records = chunk.map(({ missing, complete, ...car }) => car);
      const p = await http(fetchImpl, endpoint, { method: 'POST', headers, body: JSON.stringify({ records, tesseract_snapshots: snaps }), signal: signal() });
      if (isPartition(p)) { queue(pk, out.devices[pk].last || effective, p.transport || `POST ${said(p.status, p.body)}`); break; }
      if (p.transport) { out.exit = EXIT.TRANSPORT; out.why = p.transport; log(`tape-sync: ${p.transport} — cursor stays at ${out.devices[pk].last || effective}; resume with another run`); return finish(); }
      if (p.status === 401) { out.exit = EXIT.UNAUTHENTICATED; out.why = said(p.status, p.body); log(`tape-sync: unauthenticated ${out.why} — nothing appended, cursor unchanged`); return finish(); }
      if (p.status === 402) { out.exit = EXIT.PAYMENT; out.why = said(p.status, p.body); log(`tape-sync: payment required ${out.why} — nothing appended, cursor unchanged`); return finish(); }
      if (p.status === 503) { out.exit = EXIT.REFUSED; out.why = said(p.status, p.body); log(`tape-sync: the gateway refuses ${out.why}`); return finish(); }
      if (p.status !== 200 || !p.body || !Array.isArray(p.body.receipts) || p.body.receipts.length !== records.length) { out.exit = EXIT.TRANSPORT; out.why = `POST ${said(p.status, p.body)}`; log(`tape-sync: ${out.why} — cursor unchanged`); return finish(); }
      // receipts land, then the cursor — never the other way round
      const { last } = await land({ receipts: p.body.receipts, chunk, pk, notary_pubkey: p.body.notary_pubkey, endpoint, witnessFile, cursorFile, local, now, out, floor: effective });
      out.devices[pk].last = last;
      log(`  batch ${Math.floor(i / batch) + 1}: ${records.length} receipted (${p.body.receipts.filter((r) => r.replay).length} replay) · cursor → ${last} · notary height ${p.body.height}`);
    }
  }
  return finish();
  function finish() { if (out.exit === EXIT.OK && out.queued) log(`tape-sync: ${out.queued} queued · witness ${witnessFile}`); else if (out.exit === EXIT.OK) log(`tape-sync: ${dryRun ? `${out.slice.length} would post` : `${out.receipted} receipted (${out.replayed} replay) · snapshots ${out.snapshots.attached} attached / ${out.snapshots.absent} absent`} · witness ${witnessFile}`); return out; }
}

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');   // car_sha = sha256(signed_bytes), the gateway's own rule (C44 item 4), recomputed here
// the ONE landing: witness rows appended, then the cursor — sync and drain share it so a receipt lands the same way from either
async function land({ receipts, chunk, pk, notary_pubkey, endpoint, witnessFile, cursorFile, local, now, out, floor }) {
  const lines = []; let last = floor; const fingerprint = await fingerprintOf(pk); const dev = out.devices[pk] || (out.devices[pk] = { receipted: 0, replayed: 0 });
  for (let j = 0; j < chunk.length; j++) {
    const r = receipts[j]; const c = chunk[j];
    const w = Object.fromEntries(WITNESS_KEYS.map((k) => [k, k === 'received_at' ? r.timestamp : r[k]]));
    lines.push(JSON.stringify({ ...w, seq: c.seq, commit_sha: c.commit_sha, pubkey: pk, fingerprint, replay: r.replay === true, notary_pubkey: notary_pubkey || null, mmr: r.mmr || null, signatures: r.signatures || null, forks: r.forks || null, synced_at: now() }));   // C85a: the MMR proof rides beside the five fields; an old gateway's receipt has none and the row still verifies
    out.receipted++; dev.receipted++; if (r.replay) { out.replayed++; dev.replayed++; } last = Math.max(last, c.seq);
  }
  mkdirSync(dirname(witnessFile), { recursive: true }); appendFileSync(witnessFile, lines.join('\n') + '\n');
  local.endpoint = endpoint; local.devices[pk] = { seq: last, car_sha: receipts[chunk.length - 1].car_sha, sequence_height: receipts[chunk.length - 1].sequence_height, at: now() }; writeCursor(cursorFile, local);
  return { last };
}

// ── C85c THE DRAIN — the queue's pending rows, in seq order, sent to the gateway in batches; a DETACHED job (notary-queue.mjs
// dispatchDrain from the hook), never inline. Stops at the first non-2xx that is not a 402; a 402 stops it too and is surfaced as
// the price (out.price = { needed, available }) — a price is not a partition. A 200 lands receipts exactly as sync does (replays
// included — the gateway answers an already-witnessed CAR with its existing receipt for free, C44 item 4) and the rows are marked
// drained by APPENDING; a partition mid-drain appends attempt rows and returns OK for the next dispatch.
export async function drain({
  endpoint = ENDPOINT, tape = FLIGHT, proofsDir = PROOFS_DIR, statePath = STATE, cursorFile = CURSOR_FILE, witnessFile = WITNESS_FILE, queueFile = QUEUE_FILE,
  batch = 25, bearer = null, fetch: fetchImpl = globalThis.fetch, quiet = false, now = () => new Date().toISOString(), timeout = TIMEOUT_MS,
} = {}) {
  const log = quiet ? () => {} : (s) => process.stdout.write(s + '\n');
  const token = bearer || process.env.NOTARY_BEARER || (readJson(ENTITLEMENT_FILE, {}) || {}).token || null;
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const signal = () => (timeout > 0 && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined);
  const out = { endpoint, queueFile, pending: 0, drained: 0, receipted: 0, replayed: 0, skipped: 0, devices: {}, price: null, exit: EXIT.OK, why: null };
  const st = queueState(queueFile); out.pending = st.pending.length;
  if (!st.pending.length) { log(`tape-sync drain: queue empty (${st.drained} drained, ${st.rows} rows) · ${queueFile}`); return out; }
  // the CAR for each pending row, from the tape by (pubkey, seq), bound to the queued car_sha — a row the tape no longer carries is said and skipped
  const rows = nd(tape).filter((r) => r.kind === 'commit' && r.sig_pubkey); const byKey = new Map(rows.map((r) => [`${r.sig_pubkey}:${r.seq}`, r]));
  const local = readCursor(cursorFile); const groups = new Map();
  for (const q of st.pending) {
    const r = byKey.get(`${q.pubkey}:${q.seq}`); const car = r ? carOf(r, { proofsDir }) : null;
    if (!car || !car.complete || sha256hex(car.signature.signed_bytes) !== q.car_sha) { markAttempt(queueFile, [q], !car ? 'tape row not found for this seq/pubkey' : !car.complete ? `CAR incomplete: missing ${car.missing.join(',')}` : 'tape row bytes no longer hash to the queued car_sha', now); out.skipped++; continue; }
    if (!groups.has(q.pubkey)) groups.set(q.pubkey, []); groups.get(q.pubkey).push({ q, car });
  }
  for (const [pk, items] of groups) {
    for (let i = 0; i < items.length; i += batch) {
      const slice = items.slice(i, i + batch); const chunk = slice.map((x) => x.car); const qrows = slice.map((x) => x.q);
      const snaps = []; const seen = new Set(); for (const c of chunk) { if (seen.has(c.tesseract_sha)) continue; seen.add(c.tesseract_sha); const s = snapshotFor(c.tesseract_sha, { statePath, proofsDir }); if (s) snaps.push(s); }
      const records = chunk.map(({ missing, complete, ...car }) => car);
      const p = await http(fetchImpl, endpoint, { method: 'POST', headers, body: JSON.stringify({ records, tesseract_snapshots: snaps }), signal: signal() });
      const rest = items.slice(i).map((x) => x.q);
      if (isPartition(p)) { const why = p.transport || `POST ${said(p.status, p.body)}`; markAttempt(queueFile, rest, why, now); out.why = why; log(`tape-sync drain: still cannot reach the gateway — ${why} — ${rest.length} left pending`); return out; }
      const stop = (exit, why) => { markAttempt(queueFile, rest, why, now); out.exit = exit; out.why = why; log(`tape-sync drain: stopped — ${why} — ${rest.length} left pending`); return out; };
      if (p.status === 402) { out.price = { needed: p.body && p.body.needed, available: p.body && p.body.available }; return stop(EXIT.PAYMENT, `payment required ${said(p.status, p.body)}`); }
      if (p.transport) return stop(EXIT.TRANSPORT, p.transport);
      if (p.status === 401) return stop(EXIT.UNAUTHENTICATED, `unauthenticated ${said(p.status, p.body)}`);
      if (p.status === 503) return stop(EXIT.REFUSED, `the gateway refuses ${said(p.status, p.body)}`);
      if (p.status !== 200 || !p.body || !Array.isArray(p.body.receipts) || p.body.receipts.length !== records.length) return stop(EXIT.TRANSPORT, `POST ${said(p.status, p.body)}`);
      const floor = Number((local.devices[pk] || {}).seq || 0);
      await land({ receipts: p.body.receipts, chunk, pk, notary_pubkey: p.body.notary_pubkey, endpoint, witnessFile, cursorFile, local, now, out, floor });
      markDrained(queueFile, qrows, p.body.receipts, now); out.drained += qrows.length;
      log(`  drained ${qrows.length} (${p.body.receipts.filter((r) => r.replay).length} replay) · notary height ${p.body.height}`);
    }
  }
  log(`tape-sync drain: ${out.drained} drained (${out.replayed} replay) · ${out.skipped} skipped · witness ${witnessFile}`);
  return out;
}

// ── C76 THE STATUS CARD — one rule, read from the witness file ONLY. C81b VERIFY BEFORE GREEN: a row counts as witnessed only
// when its notary_signature verifies (Ed25519, sync — the card is painted inline) over the gateway's own receipt bytes
// {sequence_height, witness_root, timestamp, car_sha} against the notary_pubkey the row carries; the height is the highest
// sequence_height among VERIFIED rows; the fingerprint and witness_root are the newest verified row's. The newest row failing
// (a flipped byte, a foreign key, the pre-C76 unsigned shape) paints 🔴 receipt does not verify (seq S) — never green. No
// file, no rows → ⚪ not synced. A mock cycle's receipts (notary-audit.mjs) never land here, so green means a notary that
// answered over the wire AND signed what it answered.
const SPKI_ED25519 = '302a300506032b6570032100';
export function verifyWitnessRow(row) {
  try {
    if (!row || typeof row.notary_signature !== 'string' || typeof row.notary_pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(row.notary_pubkey)) return false;
    const key = createPublicKey({ key: Buffer.from(SPKI_ED25519 + row.notary_pubkey, 'hex'), format: 'der', type: 'spki' });
    const bytes = receiptBytes({ sequence_height: row.sequence_height, witness_root: row.witness_root, timestamp: row.received_at, car_sha: row.car_sha });
    return edVerifySync(null, Buffer.from(bytes, 'utf8'), key, Buffer.from(row.notary_signature, 'hex'));
  } catch { return false; }
}
// C90a THE LLM-CALL ROW CHECK — beside verifyWitnessRow, which does not change. A row from the app's `llm_calls` ledger
// (src/lib/llm/signed-call.mjs) verifies when its entry_hash recomputes from its own fields (the canonical entry,
// sorted keys) and its ed25519 signature verifies over { entry, entry_hash } under `pubkey` — the SITE key /api/auth/keys
// serves, the same one verifyEntitlement's JWTs are checked against. An unsigned row (signature null) is false: UNSIGNED,
// never a pass. node crypto here; verifyLlmRowWeb in the door answers the same question over the same bytes with WebCrypto.
export function verifyLlmRow(row, pubkey = row && row.pubkey) {
  try {
    if (!row || typeof row !== 'object' || typeof row.signature !== 'string' || typeof row.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(String(pubkey)) || row.pubkey !== pubkey) return false;
    if (sha256hex(canonicalLlmBytes(entryOfLlmRow(row))) !== row.entry_hash) return false;
    const key = createPublicKey({ key: Buffer.from(SPKI_ED25519 + pubkey, 'hex'), format: 'der', type: 'spki' });
    return edVerifySync(null, Buffer.from(canonicalLlmBytes({ ...entryOfLlmRow(row), entry_hash: row.entry_hash }), 'utf8'), key, Buffer.from(row.signature, 'hex'));
  } catch { return false; }
}
const LLM_ENTRY_KEYS = ['kind', 'at', 'provider', 'model', 'input_sha256', 'output_sha256', 'usage', 'ms', 'status', 'licence', 'prev_hash'];   // signed-call.mjs's LLM_ENTRY_KEYS, verbatim; the guard pins equality
const entryOfLlmRow = (row) => Object.fromEntries(LLM_ENTRY_KEYS.map((k) => [k, row[k] === undefined ? null : row[k]]));
const sortKeysLlm = (v) => Array.isArray(v) ? v.map(sortKeysLlm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysLlm(v[k])])) : v;
const canonicalLlmBytes = (o) => JSON.stringify(sortKeysLlm(o));
// C85a THE CHAIN-INCLUSION CHECK — beside verifyWitnessRow, which does not change (C85 invariant 1). A receipt's mmr
// { leaf_index, peak_index, path, peaks } is recomputed from the car_sha (leaf = sha256(0x00 ‖ car_sha)) up its mountain and
// across the bagged peaks; true only when the walk lands on `root` — the receipt's own witness_root, or a later head's.
// A receipt with no mmr field (the pre-C85a gateway) answers false here and is still a verified witness row above.
export async function verifyChainInclusion({ car_sha, proof, root } = {}) {
  try {
    if (typeof car_sha !== 'string' || !/^[0-9a-f]{64}$/.test(car_sha) || !proof || typeof root !== 'string') return false;
    const got = await createMMR().verify({ leaf_hash: await leafHash(car_sha), proof });
    return got != null && got === root;
  } catch { return false; }
}
// C85b: k-of-n witnesses — `k` (default 1: the notary alone, as C81b read it) and optional `parties` come from the policy (C87a);
// the count is cosignCount over the newest row's signatures, printed in `tray` as `verified-of-n witnesses`; short of k → 🔴
// naming the missing parties; a fork (a co-signer over different bytes) → 🔴 naming it; the label set stays the three words.
export function notaryCard({ witnessFile = WITNESS_FILE, k = 1, parties = null } = {}) {
  const rows = nd(witnessFile).filter((r) => r && Number.isFinite(r.sequence_height));
  // C82b: PRE-RELEASE until one receipt has VERIFIED over the wire — the same fact as ⚪/🔴, said in the word an account holder reads,
  // so a funded account never reads as a live witness; the green label carries no such word
  if (!rows.length) return { label: '⚪ not synced · PRE-RELEASE', height: 0, fingerprint: null, rows: 0, verified: 0, witness_root: null, prerelease: true };
  const ok = rows.filter(verifyWitnessRow); const newest = rows[rows.length - 1];
  const height = ok.length ? Math.max(...ok.map((r) => r.sequence_height)) : 0; const last = ok.length ? ok[ok.length - 1] : null;
  const base = { height, fingerprint: last ? last.fingerprint || '—' : null, rows: rows.length, verified: ok.length, witness_root: last ? last.witness_root || null : null };
  if (!verifyWitnessRow(newest)) return { label: `🔴 receipt does not verify (seq ${newest.seq ?? '?'})${ok.length ? '' : ' · PRE-RELEASE'}`, ...base, prerelease: !ok.length };
  const cosign = cosignCount({ receipt: newest, k, parties }); const tray = cosignLine(cosign);
  if (cosign.fork) return { label: `🔴 fork: ${cosign.forks.join(', ')} signed different bytes (seq ${newest.seq ?? '?'})`, ...base, prerelease: false, cosign, tray };
  if (!cosign.ok) return { label: `🔴 ${tray} short of ${cosign.k} (missing: ${cosign.missing.join(', ') || '—'}) (seq ${newest.seq ?? '?'})`, ...base, prerelease: false, cosign, tray };
  return { label: `🟢 Notarized (height ${height} · witness 0x${String(last.witness_root || '').slice(0, 8)} · ${base.fingerprint})`, ...base, prerelease: false, cosign, tray };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (a.includes('--help')) { process.stdout.write('node scripts/vna/tape-sync.mjs [drain] [--endpoint URL] [--cursor N] [--batch 25] [--dry-run] [--pubkey hex] [--bearer TOKEN] [--json]\n'); process.exit(EXIT.USAGE); }
  const r = a[0] === 'drain'
    ? await drain({ endpoint: val('--endpoint') || undefined, batch: Number(val('--batch')) || 25, bearer: val('--bearer'), quiet: a.includes('--json') })
    : await sync({ endpoint: val('--endpoint') || undefined, cursor: val('--cursor'), batch: Number(val('--batch')) || 25, dryRun: a.includes('--dry-run'), pubkey: val('--pubkey'), bearer: val('--bearer'), quiet: a.includes('--json') });
  if (a.includes('--json')) process.stdout.write(JSON.stringify(r, null, 1) + '\n');
  process.exit(r.exit);
}
