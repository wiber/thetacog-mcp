#!/usr/bin/env node
// C50 — THE LOCAL CRYPTOGRAPHIC TAPE (the flight recorder), before any notary (C44): a local, append-only, hash-chained,
// ed25519-signed ndjson tape of every decided commit and every prompt turn. A commit row carries the sha, the Merkle
// inclusion proof of each spec row the commit satisfied (from attest-commit.mjs: basin hash · sibling path · root ·
// verified), and the PMU Δ receipt for that sha (data/pmu/measure-history.ndjson: σ-drift, drift %, off-lane %,
// lane jump — or "not yet" when the drift walk has not landed). A turn row carries the session, the seed outcome and
// the gauge. Every row hashes the previous row (prev) and is signed with the ROOM's mesh identity (mesh-keys.mjs —
// the same key the walk tape and the mesh ledger use, never a second key); the pubkey rides beside the signature so
// anyone verifies without the host seed. `--verify` recomputes the chain and every signature and says the first
// break. Immune to nothing off-machine — that is C44's job and is not claimed here.
//
//   node scripts/vna/flight-tape.mjs commit <sha>        (post-commit, detached, after attest-commit)
//   node scripts/vna/flight-tape.mjs turn                 (the prompt hook, after the seed receipt)
//   node scripts/vna/flight-tape.mjs --verify [--json]
//   node scripts/vna/flight-tape.mjs --tail [N]
//   node scripts/vna/flight-tape.mjs batch <log.ndjson> --actor <name> --spec <rows.md> [--room r] [--no-walk]   (C73)
//
// C73 — THE RUNNING AGENT'S LOG IS THE DEFAULT SUBJECT; THE CODE REPO IS THE HARD CASE. The subject of a row is an append-only
// record of an autonomous actor, and a commit is ONE kind of it. `batch` tapes a foreign log the way `commit` tapes a commit:
// kind:'batch', sha = sha256 of the log's bytes (the content address a commit sha is for a repo), session = the actor's name,
// every turn's action_hash = sha256(prompt ‖ tool_call ‖ response) — the developer's commit sha and the agent's action hash are
// the SAME field (sha) under two kinds, never two schemas — each turn slotted through the one door (seedLeaf, gzip-NCD) against
// the actor's DECLARED rows (its own spec: a customer-service policy is a spec like ours), the landed basins riding on the row
// as Merkle inclusion proofs, signed with the same room identity, chained on the same tape. SIGNED_KEYS do not change: the
// turns ride in `seed`, the placement in `delta`, the proofs in `proofs`. Nothing on this path calls git.
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, openSync, readSync, closeSync, fstatSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, sign as edSign, verify as edVerify, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { roomIdentity, signerFor } from '../mesh/mesh-keys.mjs';   // C97e: the ONE key resolver — a room's derived key, else the local (host) key
import { roomFromCommitTrailer, roomFromTerminal } from '../../src/lib/pmu/room-key.mjs';
import { tesseractState } from './tesseract-state.mjs';
import { verifyProof, emptyTree, basins, seedLeaf, proof, thresholds } from './spec-tree.mjs';
import { writeProofFile } from './attest-commit.mjs';
import { hoursOf, skillOf } from './labour.mjs';
import { PIXEL as ADDRESS } from '../../src/lib/backup/drift-reading.mjs';   // C483: the repo view's one address shape — a turn's pixel is kept by the rule it is read by   // C92e: measured hours and the basin's skill, never a constant, never a table

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const FLIGHT = process.env.VNA_FLIGHT_TAPE || resolve(REPO, 'data/vna/flight-tape.ndjson');
const TREE_PATH = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const PROOFS_DIR = process.env.VNA_PROOFS_DIR || resolve(REPO, 'data/vna/proofs');
export const ATTEST = process.env.VNA_ATTESTATIONS || resolve(REPO, 'data/vna/attestations.ndjson');
export const MEASURE = process.env.PMU_MEASURE_HISTORY || resolve(REPO, 'data/pmu/measure-history.ndjson');
export const GAUGE = process.env.VNA_CLEAR_GAUGE || resolve(REPO, '.thetacog/vna-clear-gauge.json');
export const SEEDS = process.env.VNA_SEED_LOG || resolve(REPO, '.thetacog/vna-seed.ndjson');
export const UNDERWRITING = process.env.VNA_UNDERWRITING || resolve(REPO, 'data/vna/underwriting.json');
export const GENESIS = 'flight-tape/genesis';
// C514 — a chain break is sealed, never re-linked. The tape itself is never edited to make a break disappear (AXIOM 1:
// a discarded record is unpurchasable); a break that is understood is instead NAMED in this separate, append-only
// sidecar, which --verify reads without ever touching the signed rows it describes.
export const BREAKS = process.env.VNA_FLIGHT_BREAKS || resolve(REPO, 'data/vna/flight-tape-breaks.ndjson');

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
// the signed body is every field but the signature fields, in a fixed key order — so a verifier rebuilds the same bytes
// C97c: the rule lives in src/lib/vna/row-canonical.mjs so the foreign-metal verifier rebuilds the same bytes with nothing else from here
export { SIGNED_KEYS, canonical } from '../../src/lib/vna/row-canonical.mjs';
import { SIGNED_KEYS, canonical } from '../../src/lib/vna/row-canonical.mjs';

// ── C90 SIGNED UNDER LICENCE, LOCALLY, BEFORE ANY NOTARY. The licence is an EdDSA JWT whose claims name THIS device key's
// fingerprint (C75); it lives in the extension's SecretStorage and rides to children only by environment (auth-manager.ts:
// NOTARY_BEARER for the sync, VNA_ENTITLEMENT_CLAIMS — the decoded PUBLIC claims — for everything else). What the tape keeps
// is the stamp: { account_id, pubkey_fingerprint, exp, jti, kid } INSIDE the signed bytes at `proofs.licence` (the C63/C86
// precedent — SIGNED_KEYS do not move; a row signed before today verifies unchanged). The bearer never enters a row, a
// proof file, a CAR or a tool result: this module reads VNA_ENTITLEMENT_CLAIMS and never NOTARY_BEARER. A STAMP IS A CLAIM
// THE DEVICE KEY SIGNS, NOT A SIGNATURE BY THE LICENCE — the copy says "signed under licence". A licence is bound to one
// machine (C84 invariant 4): a stamp whose fingerprint is not the signing key's is REFUSED at write time. No licence in the
// environment → `proofs.licence: null`, read UNLICENSED on the CAR — never a fabricated stamp, never omitted silently.
export const LICENCE_STAMP_KEYS = ['account_id', 'pubkey_fingerprint', 'exp', 'jti', 'kid'];   // the PUBLIC claims; never credits, never the bearer
// the notary's fingerprintOf (src/lib/notary/gateway.mjs, WebCrypto, async) as node crypto, sync — the same 16 hex over the same raw key bytes
export const deviceFingerprint = (pubkeyHex) => createHash('sha256').update(Buffer.from(String(pubkeyHex), 'hex')).digest('hex').slice(0, 16);
export function licenceClaimsFromEnv(env = process.env) {
  if (!env.VNA_ENTITLEMENT_CLAIMS) return null;
  try { const c = JSON.parse(env.VNA_ENTITLEMENT_CLAIMS); return c && typeof c === 'object' ? c : null; } catch { return null; }
}
// the stamp for a row about to be signed by `pubkey`: null when no licence rides the environment; a throw when the licence
// names another machine's key. `claims` undefined → read the environment; `claims` null → explicitly unlicensed.
export function licenceStampFor({ claims, pubkey = null } = {}) {
  const c = claims === undefined ? licenceClaimsFromEnv() : claims;
  if (!c || typeof c !== 'object') return null;
  const stamp = Object.fromEntries(LICENCE_STAMP_KEYS.map((k) => [k, c[k] === undefined ? null : c[k]]));
  if (pubkey) { const fp = deviceFingerprint(pubkey); if (stamp.pubkey_fingerprint !== fp) throw new Error(`flight-tape: the licence names fingerprint ${stamp.pubkey_fingerprint}, this device key is ${fp} — a licence is bound to one machine; REFUSED at write`); }
  return stamp;
}
// the CAR's reading of a row's stamp — three cases, each said: stamped · written unlicensed · taped before the field existed
export function licenceOf(row) {
  const p = row && row.proofs && typeof row.proofs === 'object' ? row.proofs : null;
  if (!p || p.licence === undefined) return { status: 'UNLICENSED', why: (row && row.stamp_why) || 'this row was taped before C90 — no licence field on the signed row', stamp: null };
  // C102b: the row says why it carries no stamp (stamp_why, beside sig_why, outside the signed bytes) — 'credits 0' is one such why
  if (p.licence === null) return { status: 'UNLICENSED', why: row.stamp_why || 'no licence in the environment when the row was written (VNA_ENTITLEMENT_CLAIMS absent)', stamp: null };
  return { status: 'LICENSED', why: null, stamp: p.licence, sentence: 'signed under licence — a claim the device key signs, not a signature by the licence' };
}

// ── C102b NOTARISE LOCALLY, RIGHT AWAY. Operator (2026-09-20): "you can notarise it locally, that's what you use the keys for
// right away." The C90 stamp is no longer a free rider on the claims: it is PAID for, one credit per stamped row, on a LOCAL
// ledger — `.thetacog/credits-local.ndjson`, rows { at, delta, ref, kind } and the balance a SUM (the C84c pattern, never an
// updated column; AXIOM 1: a stamp is a −1 row retained beside the row it paid for, ref = that row's sha). The entitlement's
// own `credits` is a SNAPSHOT the site took when it minted the token: on the first sight of a token (idempotent by jti) a
// `snapshot` row lands whose delta brings the SUM to the snapshot — in either direction, the larger of the two is never
// trusted, the snapshot resets the base and records `before` so the discrepancy is countable. Credits 0 → the row is still
// appended and signed, UNSTAMPED, `stamp_why: 'credits 0'`. The site is NOT told about local stamps here (that is the hosted
// notary's business, C97f, dormant behind `notarize: hosted`) — a re-minted token refills the base; named, not hidden.
export const CREDITS_LOCAL = process.env.VNA_CREDITS_LOCAL || resolve(REPO, '.thetacog/credits-local.ndjson');
export function creditsLocalRows(path = CREDITS_LOCAL) { return nd(path); }
// C102a: the ledger is folded ONCE and then only its new bytes — the balance (a SUM), the stamped refs and the snapshot refs — so
// the 10,000th stamp costs what the first did. A file that shrank (rewritten) is folded again from 0; a foreign process appending
// between two calls only grows the file, and the new bytes are folded on the next read. Never trusted past the file's own size.
const ledgerIdx = new Map();   // path → { size, sum, stamps: Set, snapshots: Set }
function ledgerIndex(path = CREDITS_LOCAL) {
  let size = 0; try { size = statSync(path).size; } catch { ledgerIdx.delete(path); return { size: 0, sum: 0, stamps: new Set(), snapshots: new Set() }; }
  let ix = ledgerIdx.get(path);
  if (!ix || size < ix.size) ix = { size: 0, sum: 0, stamps: new Set(), snapshots: new Set(), tail: '' };
  if (size > ix.size) {
    const fd = openSync(path, 'r'); const buf = Buffer.alloc(size - ix.size);
    try { readSync(fd, buf, 0, buf.length, ix.size); } finally { closeSync(fd); }
    const text = ix.tail + buf.toString('utf8'); const nl = text.lastIndexOf('\n');
    const whole = nl >= 0 ? text.slice(0, nl) : ''; ix.tail = nl >= 0 ? text.slice(nl + 1) : text;   // a partial last line waits for its newline
    for (const l of whole.split('\n')) { if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; } ix.sum += Number(r.delta) || 0; if (r.kind === 'stamp') ix.stamps.add(r.ref); else if (r.kind === 'snapshot') ix.snapshots.add(r.ref); }
    ix.size = size; ledgerIdx.set(path, ix);
  }
  return ix;
}
export function creditsLocalBalance(path = CREDITS_LOCAL) { return ledgerIndex(path).sum; }
const tokenRef = (c) => `token:${c.jti != null ? c.jti : `${c.iat ?? ''}:${c.exp ?? ''}`}`;
// the snapshot row for THIS token, once; { reconciled, balance, ref, before, why }
export function reconcileCredits({ claims, ledger = CREDITS_LOCAL, at = new Date().toISOString() } = {}) {
  const n = claims && typeof claims === 'object' ? Number(claims.credits) : NaN;
  const ix = ledgerIndex(ledger); const before = ix.sum;
  if (!Number.isFinite(n)) return { reconciled: false, balance: before, ref: null, before, why: 'the entitlement carries no credits claim' };
  const ref = tokenRef(claims);
  if (ix.snapshots.has(ref)) return { reconciled: false, balance: before, ref, before, why: 'already reconciled to this token' };
  mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify({ at, delta: n - before, ref, kind: 'snapshot', credits: n, before }) + '\n');
  return { reconciled: true, balance: n, ref, before, why: null };
}
// one credit, spent against one stamped row — ref is the row's sha, so a stamp is never charged twice for the same bytes
export function spendCredit({ rowSha, ledger = CREDITS_LOCAL, at = new Date().toISOString() } = {}) {
  if (ledgerIndex(ledger).stamps.has(rowSha)) return { spent: false, balance: creditsLocalBalance(ledger), why: 'this row is already paid for' };
  mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify({ at, delta: -1, ref: rowSha, kind: 'stamp' }) + '\n');
  return { spent: true, balance: creditsLocalBalance(ledger), why: null };
}
// THE SECOND READER's line (C97a's two states, C102b's local count) — a pure read of the tape and the ledger, for the dispatcher
// to wire into steer-ui.mjs: with a licence, the rows stamped under ITS fingerprint and the local balance; without, the count still
// read off the tape (never blank). C109o (operator: "never say local"): the licence stamp IS notarising — `rows notarised`, never "countersigned locally", never a Local prefix.
export function localStampReading({ tape = FLIGHT, ledger = CREDITS_LOCAL, entitlement = null } = {}) {
  const ent = entitlement && typeof entitlement === 'object' ? entitlement : null;
  const fp = ent && ent.pubkey_fingerprint ? String(ent.pubkey_fingerprint) : null;
  const rows = nd(tape);
  if (fp) { const n = rows.filter((r) => licenceOf(r).status === 'LICENSED' && r.proofs.licence.pubkey_fingerprint === fp).length; return `Signed · key ${fp.slice(0, 8)} · ${n} rows notarised · credits left ${creditsLocalBalance(ledger)}`; }
  return `${rows.filter((r) => licenceOf(r).status === 'LICENSED').length} rows notarised · no key held`;
}

// ── C86 THE BOUNDARY PROBE ON THE CAR — AXIOM 0 RUNG 3, NEVER RUNG 4. The paste asked for CPU performance-counter telemetry
// in the CAR header to prove the run happened on silicon. Refused: the raw counter is rung 4 (privileged, platform-gated,
// apparatus scope) and it would not prove that — a VM inside the control band passes the probe. What rides here is the
// MEASURED boundary-crossing cost on THIS machine: `pmu-onchip --boundary-probe --runs N` as underwriting.mjs already runs it,
// a median with its [min, max] spread, admissible only when the control band held. This path READS that receipt; it never
// runs the probe (a commit hook is not a quiet machine, and the receipt says when it was quiet). The field rides INSIDE the
// signed `delta` object — the C63 precedent for tesseract_sha inside `proofs` — so SIGNED_KEYS do not move and every row
// signed before today verifies unchanged. UNMEASURED carries a `why` and no number: never 0, never silently absent.
// `delta` is OUR walker's Δ (the PMU homonym); the CAR lifts the probe out to its own field so the two are never read as one.
export const BOUNDARY_SENTENCE = 'the boundary-crossing cost was measured on this machine; whether this was silicon is not what it proves.';
const unmeasured = (why, extra = {}) => ({ status: 'UNMEASURED', why, ...extra });
export function boundaryProbeFor({ path = UNDERWRITING, host = hostname() } = {}) {
  let j; try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { return unmeasured(`no probe receipt at ${basename(path)} — underwriting.mjs has not run on this machine`); }
  const p = j && j.physical; if (!p || typeof p !== 'object') return unmeasured('the receipt carries no physical attestation');
  if (p.available === false) return unmeasured(`the probe did not run: ${p.reason || 'unavailable'}`, { at: j.at || null });
  const machine = p.machine && typeof p.machine === 'object' ? p.machine : null;
  if (!machine || !machine.hostname) return unmeasured('the probe receipt names no machine — it predates the machine stamp; re-run underwriting.mjs', { at: j.at || null });
  if (machine.hostname !== host) return unmeasured(`the probe receipt was taken on another machine (${machine.hostname}), this is ${host}`, { at: j.at || null, machine });
  if (p.admissible !== true) return unmeasured(`the probe ran but was NOT ADMISSIBLE: ${(p.control && p.control.reason) || 'control outside the band'}`, { admissible: false, at: j.at || null, machine });
  const rows = Array.isArray(p.results) ? p.results.filter((r) => r && Number.isFinite(r.ratio_median)) : [];
  if (!rows.length) return unmeasured('the probe receipt carries no rows', { at: j.at || null, machine });
  const top = rows.reduce((a, b) => (b.kib > a.kib ? b : a));   // the boundary-crossing row is the largest working set; the control (in-cache) is the band, not the cost
  return { status: 'MEASURED', median: top.ratio_median, min: top.ratio_min, max: top.ratio_max, runs: top.runs ?? p.runs ?? null, admissible: true,
    machine, at: j.at || null, kib: top.kib, unit: 'x — dependent-load latency, boundary-crossing order over packed order (median of the runs, [min, max] the observed spread)',
    control: p.control ? { kib: p.control.control_kib, ratio_median: p.control.ratio_median, tolerance: p.control.tolerance } : null,
    rung: 3, source: basename(path), sentence: BOUNDARY_SENTENCE };
}
const fmtX = (v) => `${Number(v).toFixed(2)}x`;
// the card-3 line — a pure function of the CAR's boundary_probe field, for the dispatcher to wire into steer-ui.mjs
export function boundaryProbeLine(bp) {
  if (!bp || bp.status !== 'MEASURED') { const why = bp && bp.why ? String(bp.why) : ''; return `⚡ boundary probe · UNMEASURED${why ? ' — ' + (why.length > 110 ? why.slice(0, 109) + '…' : why) : ''}`; }
  return `⚡ boundary probe · ${fmtX(bp.median)} [${fmtX(bp.min)}, ${fmtX(bp.max)}] · ${bp.runs} runs · ${bp.machine.hostname} · ${String(bp.at || '').slice(0, 10)}`;
}

// ── C63 THE COMPUTE ACTION RECEIPT — a VIEW of a commit row, never a rewrite of the tape. { at, commit_sha, leaf_id, merkle_root,
// inclusion_proof, pmu_delta, tesseract_sha, signature } from the row + the content-addressed proof file; verifiable from bare
// disk files: the proof recomputes to merkle_root, the signature verifies over the row's canonical bytes with the pubkey on the row.
export const CAR_KINDS = ['commit', 'batch'];   // C73: two kinds, one schema — commit_sha is the sha field under either
// C87: the kinds the tape ACCEPTS — a `reading` (underwriter-policy.mjs: the policy read against the receipts, signed, chained)
// rides here and is never a CAR; an unknown kind is refused before it can be chained. C91a: a `goal` (goal.mjs goalClose —
// the record that every unit of a /goal closed, sha = the goal file's bytes) rides the same way, once per goal_sha.
export const ROW_KINDS = ['commit', 'turn', 'batch', 'reading', 'goal', 'onboard', 'gap', 'delta', 'panel'];   // C104c: an onboarding step taken, recorded through this one door · C483a: a gap in the sequence, named on the tape (W5) · C649a: a commit's published panel bound by its sha256 (panel-coverage.mjs)
// C516 — a `delta` row is the LATE ARRIVAL of a drift walk for a sha whose commit row was taped before the walk landed
// (the post-commit hook tapes `commit` in parallel with the walk, so deltaFor froze "not yet" on the signed row). The
// tape is append-only and signed — the commit row is never rewritten — so the landed Δ rides a NEW row instead:
// {kind:'delta', sha, delta}. A reader of a commit row folds the newest `delta` row for that sha onto it (see
// src/lib/backup/drift-reading.mjs, adherence-by-domain.mjs, deployed-tapes.mjs).
export const DELTA_CORE_FIELDS = ['kind', 'sha', 'delta', 'seq', 'ts', 'row_sha', 'prev'];   // what a delta row carries — nothing else
// the notary core: `complete` is computed over these eight. C86's boundary_probe is REPORTED in `missing` when unmeasured but
// never gates completeness — a commit taped on a machine that has not run the probe is still witnessable; the absence is said.
export const CAR_CORE_FIELDS = ['at', 'commit_sha', 'leaf_id', 'merkle_root', 'inclusion_proof', 'pmu_delta', 'tesseract_sha', 'signature'];
export function carOf(row, { proofsDir = PROOFS_DIR, labour = null } = {}) {
  if (!row || !CAR_KINDS.includes(row.kind)) return null;
  const items = (row.proofs && row.proofs.items) || [];
  // a row taped before proof files existed: the proof_id is read off the C43 ledger's latest row for (sha, root)
  const ledgerRow = nd(ATTEST).filter((x) => x.sha === row.sha && x.root === (row.proofs && row.proofs.root)).pop();
  const leaves = items.map((p0) => { const p = { ...p0, proof_id: p0.proof_id || (ledgerRow && (ledgerRow.proofs.find((q) => q.label === p0.label) || {}).proof_id) || null }; let proof = null; if (p.proof_id) { try { proof = JSON.parse(readFileSync(resolve(proofsDir, `${p.proof_id}.json`), 'utf8')); } catch {} } return { leaf_id: p.id, label: p.label, leaf_hash: p.hash, merkle_root: p.root, proof_id: p.proof_id || null, inclusion_proof: proof ? proof.path : null, recomputed_root: proof ? verifyProof({ hash: p.hash, path: proof.path }) : null, verifies: proof ? verifyProof({ hash: p.hash, path: proof.path }) === p.root : null }; });
  const sigOk = row.sig && row.sig_pubkey ? (() => { try { return edVerify(null, Buffer.from(canonical(row)), createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(row.sig_pubkey, 'hex')]), format: 'der', type: 'spki' }), Buffer.from(row.sig, 'hex')); } catch { return false; } })() : null;
  const missing = [];
  // C86: the probe is lifted OUT of delta — pmu_delta stays our walker's Δ, boundary_probe is the machine's measured cost
  const { boundary_probe: bp0, ...pmuDelta } = (row.delta && typeof row.delta === 'object') ? row.delta : {};
  const boundary_probe = bp0 && bp0.status === 'MEASURED' ? bp0 : bp0 && bp0.status === 'UNMEASURED' ? bp0 : unmeasured('this row was taped before C86 — no boundary_probe on the signed row');
  // C90: the licence stamp is READ off the signed proofs — LICENSED with the stamp, or UNLICENSED with why; never absent from the CAR
  const licence = licenceOf(row);
  // C92e: labour is READ off the signed proofs — MEASURED with hours, or UNMEASURED with why; never absent from the CAR
  const labourCar = labourOf(labour || row);
  // C92a: the signed guard block rides onto the CAR as-is, or null on a pre-C92a row — never a fabricated pass
  const guards = row.proofs && Array.isArray(row.proofs.guards) ? row.proofs.guards : null;
  const car = { kind: row.kind, at: row.ts, commit_sha: row.sha, labour: labourCar, guards, leaf_id: leaves.length ? leaves.map((l) => l.leaf_id) : null, merkle_root: row.proofs && row.proofs.root || null, inclusion_proof: leaves.length ? leaves : null, pmu_delta: row.delta ? pmuDelta : null, tesseract_sha: row.proofs && row.proofs.tesseract_sha || null, boundary_probe, licence, signature: row.sig ? { sig: row.sig, pubkey: row.sig_pubkey, room: row.room, over: 'canonical(row) over SIGNED_KEYS', signed_bytes: canonical(row), verifies: sigOk } : null, seq: row.seq, row_sha: row.row_sha };
  for (const k of CAR_CORE_FIELDS) if (car[k] == null) missing.push(k);
  const complete = missing.length === 0 && leaves.every((l) => l.verifies) && sigOk === true;
  if (boundary_probe.status !== 'MEASURED') missing.push('boundary_probe');   // reported, never a gate (see CAR_CORE_FIELDS)
  car.missing = missing; car.complete = complete;
  return car;
}
export function carFor(sha, path = FLIGHT, opts = {}) { const rows = nd(path).filter((r) => CAR_KINDS.includes(r.kind) && r.sha && String(r.sha).startsWith(String(sha))); const row = rows[rows.length - 1]; const stamped = rows.filter((r) => r.proofs && r.proofs.labour).pop() || null; return carOf(row, { ...opts, labour: stamped }); }

// ── C92e LABOUR ON THE CAR, INSIDE THE SIGNED BYTES, THE ROOT LAYOUT UNMOVED ───────────────────────────────────────────
// equivalent_labor_hours (C93j hoursOf: the runner's verdict ms — the chair's turn span needs the transcript the tape never
// has, so a chair row reads null with why), active_skill_tier (skillOf: the basin's reef hat + domain off the tree at the
// commit) and grounding_ratio (the verdict row's static_dynamic_ratio, C93k) ride at `proofs.labour` — the C63/C86/C90
// precedent: SIGNED_KEYS do not move, a row signed before today verifies unchanged. The verdict row is written AFTER the CAR
// is complete (the runner polls it), so the block cannot be on the first row for a sha: stampLabour APPENDS a commit row for
// the same sha carrying `proofs.amends` (the C91b shape), idempotent, and carFor reads labour off the newest row that has it.
// KR40: hours and a tier; no currency glyph enters a row.
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
const LABEL_RE = /\b(C\d{1,3}[a-z]?|T\d{1,3})\b/g;
export function labelsOfCommit(sha, repo = REPO) { try { return [...new Set(execFileSync('git', ['log', '-1', '--format=%s%n%b', sha], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(LABEL_RE) || [])]; } catch { return []; } }
export function labourStampFor({ sha, runnerRows = null, tree = null, labels = null, repo = REPO } = {}) {
  const rr = runnerRows || nd(RUNNER_NDJSON);
  const runnerRow = rr.filter((x) => x.kind === 'verdict' && x.work && String(sha).startsWith(String(x.work).slice(0, 10))).pop() || null;
  const h = hoursOf({ spend: null, turns: [], runnerRow });
  let T = tree; if (!T) { try { T = JSON.parse(readFileSync(TREE_PATH, 'utf8')); } catch { T = null; } }
  const sk = skillOf(labels || labelsOfCommit(sha, repo), T);
  const sdr = runnerRow ? runnerRow.static_dynamic_ratio : null;
  const gr = sdr && Number.isFinite(sdr.grounding_ratio) ? sdr.grounding_ratio : null;
  return {
    v: 1, unit: 'hours',
    equivalent_labor_hours: h.hours, route: h.route || null, hours_source: h.hours == null ? null : h.source, hours_why: h.hours == null ? (h.why || 'UNMEASURED') : null,
    active_skill_tier: sk.hat ? (sk.domain ? `${sk.hat} · ${sk.domain}` : sk.hat) : null, tier_source: sk.hat ? sk.source : null, tier_why: sk.hat ? null : (sk.why || 'UNMEASURED'),
    grounding_ratio: gr, ratio_source: gr == null ? null : 'runner verdict row static_dynamic_ratio (C93k)',
    ratio_why: gr != null ? null : !runnerRow ? 'no runner verdict row for this sha — a chair commit carries no parent-run classification' : !sdr ? 'the verdict row predates C93k — no static_dynamic_ratio on it' : 'nothing failed on the parent run — UNMEASURED, never 0',
  };
}
/** the CAR's reading of a row's labour block: MEASURED with hours, or UNMEASURED with why — never absent */
export function labourOf(row) {
  const l = row && row.proofs && row.proofs.labour;
  if (!l) return { status: 'UNMEASURED', why: 'no proofs.labour on any signed row for this sha — taped before C92e, or the runner has not stamped it yet' };
  const measured = Number.isFinite(l.equivalent_labor_hours);
  return { status: measured ? 'MEASURED' : 'UNMEASURED', equivalent_labor_hours: measured ? l.equivalent_labor_hours : null, active_skill_tier: l.active_skill_tier ?? null, grounding_ratio: Number.isFinite(l.grounding_ratio) ? l.grounding_ratio : null, ...(measured ? {} : { why: l.hours_why || 'no measured hours on the block' }), route: l.route || null, stamped_row: row.row_sha || null };
}
/** append the labour block as an amending commit row for the sha — the signed original is never edited; idempotent on the block's bytes */
export function stampLabour({ sha, tape = FLIGHT, runnerRows = null, tree = null, labels = null, repo = REPO } = {}) {
  const rows = nd(tape).filter((r) => r.kind === 'commit' && r.sha && String(r.sha).startsWith(String(sha)));
  const base = rows[rows.length - 1]; if (!base) return { ok: false, appended: false, why: `no commit row for ${String(sha).slice(0, 10)} on the tape — nothing to amend` };
  const stamp = labourStampFor({ sha: base.sha, runnerRows, tree, labels, repo });
  const have = rows.filter((r) => r.proofs && r.proofs.labour).pop();
  if (have && JSON.stringify(have.proofs.labour) === JSON.stringify(stamp)) return { ok: true, appended: false, why: 'the same block is already on the tape', row: have, stamp };
  const { licence, ...proofs } = base.proofs || {};   // the licence is re-stamped by append from the signing environment, never copied
  const row = append({ kind: 'commit', sha: base.sha, room: base.room || null, proofs: { ...proofs, labour: stamp, amends: base.row_sha }, delta: base.delta || null }, tape, { probe: base.delta && base.delta.boundary_probe });
  return { ok: true, appended: true, row, stamp };
}

// ── C92a THE GUARDS RIDE INSIDE THE CAR ────────────────────────────────────────────────────────────────────────────────
// For each spec row the commit names (the C43 satisfied-by door: the labels in its subject + body) the guard the row names is
// RUN — `node --test <guard>` under tests/vna or tests/pmu-simulator against HEAD (the checkout the row is signed from) and,
// with `parent`, against the parent's archived tree the runner already builds (C66: git archive <parent> -- ARCHIVE_PATHS
// into scratch, the HEAD guard copied in, node --test there — the RED WITNESS shape, so parent_status 'fail' is the guard
// seen red before the commit and 'pass' is GREEN-ON-PARENT). The block rides at `proofs.guards` — the C63/C86/C90/C92e
// precedent: SIGNED_KEYS do not move, a row signed before today verifies unchanged. pass with ms · fail · unrun with the
// reason (a row that names no guard, a guard outside the two roots, a guard file not on disk, a parent tree that cannot run
// it) · [] when the commit names no row — and then no child process is spawned. A guard named by two rows runs once.
// Nothing here claims the code is correct (Rice): the block says WHICH declared bound was run and WHAT it returned.
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const GUARD_ROOTS = ['tests/vna', 'tests/pmu-simulator'];
// the parent-tree archive the runner (C66) and the guard leg share — one list, steer-runner re-exports it
export const ARCHIVE_PATHS = ['scripts', 'src', 'tests', 'package.json', 'data/vna', 'docs/specs/vna', 'packages/thetacog-mcp-vscode', 'packages/thetacog-mcp/scripts', 'packages/intentguard/own'];   // + the extension (35 files, 664 KB): steer-ui → chat-bridge requires its media/chat-core.js, and 102 guards read its files — without it every such guard ran UNMEASURED on the parent tree (C199 STUCK ×2, 2026-09-23) · + the npm package's scripts only (101 files, 1.3 MB — never the 115 MB package): 14+ guards import them, C463 read witness-unmeasured without it (2026-09-29) · + the IntentGuard package's own source (39 files, 280 KB): the C493/C495 guards require its robot/key.js — C495 read witness-unmeasured without it (2026-09-30)
const ROW_RE = /^\s*-\s*\[[ xX]\]\s*(C\d{1,3}[a-z]?|T\d{1,3})\b(.*)$/;
const GUARD_RE = /\bguard[:s]?\s*`([^`]+)`/i;   // the same shape spec-check.mjs and outstanding.mjs read
/** label → the guard path the row names (null when the row names none); rows only — prose naming a label is not a row */
export function specGuards(specPath = SPEC_MD) {
  const out = new Map(); let md = ''; try { md = readFileSync(specPath, 'utf8'); } catch { return out; }
  for (const line of md.split('\n')) { const m = ROW_RE.exec(line); if (!m || out.has(m[1])) continue; const g = GUARD_RE.exec(m[2]); out.set(m[1], g ? g[1].trim() : null); }
  return out;
}
const testEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };   // node --test inside node --test
/** one guard, one tree: node --test <guard> in cwd — pass | fail with ms and the tail of the output; the only child process on this path */
export function runGuard(guard, cwd, { timeoutMs = 180000 } = {}) {
  const t0 = Date.now(); let out = '';
  try { execFileSync('node', ['--test', guard], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env: testEnv() }); return { status: 'pass', ms: Date.now() - t0, out: null }; }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); return { status: 'fail', ms: Date.now() - t0, exit: e.status ?? null, out: out.slice(-400) }; }
}
const underRoots = (g) => GUARD_ROOTS.some((r) => String(g).startsWith(r + '/'));
// C826 — THE PARENT TREE IS UPDATED, NEVER UNPACKED PER COMMIT. Until 2026-10-13 every commit naming a row unpacked the
// parent's ${ARCHIVE_PATHS} (11,033 files) into tmpdir and deleted them after: 78 commits a day × 22 k file events, with
// fseventsd at 130 % CPU. Now one persistent sparse, detached worktree (gitignored .thetacog/cache/parent-tree) is moved to
// each parent with checkout -f (git rewrites only the files that differ: 5 for a 5-file diff, measured) and clean -fdqx
// (whatever the last guard run wrote is gone). One holder at a time; a holder that waits past the deadline gets null and
// the caller unpacks as before. Guard: tests/vna/c826-the-parent-tree-is-updated-not-unpacked.test.mjs
const gitq = (args, cwd) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export function parentTreeAt({ repo = REPO, sha, archivePaths = ARCHIVE_PATHS, dir = resolve(repo, '.thetacog/cache/parent-tree'), waitMs = 180000 } = {}) {
  const lock = dir + '.lock'; const t0 = Date.now();
  mkdirSync(dirname(dir), { recursive: true });
  for (;;) {
    try { mkdirSync(lock); writeFileSync(resolve(lock, 'pid'), String(process.pid)); break; }
    catch {
      let holder = 0; try { holder = Number(readFileSync(resolve(lock, 'pid'), 'utf8')); } catch {}
      let alive = false; if (holder) { try { process.kill(holder, 0); alive = true; } catch {} }
      if (!alive && Date.now() - t0 > 2000) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() - t0 > waitMs) return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  const release = () => rmSync(lock, { recursive: true, force: true });
  try {
    const cone = archivePaths.map((p) => '/' + p + (/\.[a-z]+$/.test(p) ? '' : '/'));
    // C826b — THE CONE IS CHECKED EVERY CALL, NEVER ONLY AT BIRTH. 2026-10-15 the worktree git dir had lost its index,
    // config.worktree and info/sparse-checkout; the tree was no longer sparse, so checkout -f wrote all 63,321 tracked
    // files (4.6 GB) into the cache and Spotlight indexed every one. Reapplying the cone in place leaves every dirty file
    // outside it (33 on the live tree), so a tree whose cone differs from the declared paths is rebuilt from nothing.
    let have = null;
    if (existsSync(resolve(dir, '.git'))) { try { have = gitq(['sparse-checkout', 'list'], dir).split('\n').map((l) => l.trim()).filter(Boolean).join('\n'); } catch { have = null; } }
    if (have !== cone.join('\n')) {
      rmSync(dir, { recursive: true, force: true });
      try { gitq(['worktree', 'prune'], repo); } catch {}
      gitq(['worktree', 'add', '-q', '-f', '--no-checkout', '--detach', dir, sha], repo);
      gitq(['sparse-checkout', 'set', '--no-cone', ...cone], dir);
    }
    gitq(['checkout', '-q', '-f', '--detach', sha], dir);
    gitq(['clean', '-fdqx'], dir);
    return { dir, release, mode: 'worktree' };
  } catch (e) { release(); throw e; }
}
export function guardsFor(sha, { labels = null, spec = SPEC_MD, repo = REPO, parent = false, scratchRoot = tmpdir(), run = runGuard, archivePaths = ARCHIVE_PATHS, timeoutMs, parentTreeDir = null } = {}) {
  const rows = specGuards(spec);
  const named = [...new Set(labels || labelsOfCommit(sha, repo))].filter((l) => rows.has(l));
  if (!named.length) return [];   // the commit names no row: nothing to run, nothing spawned
  const head = new Map();   // guard path → the HEAD result, so a guard two rows name runs once
  const headResult = (g) => { if (!head.has(g)) head.set(g, existsSync(resolve(repo, g)) ? run(g, repo, { timeoutMs }) : { status: 'unrun', ms: null, why: 'the guard file is not on disk at HEAD' }); return head.get(g); };
  const items = named.map((label) => {
    const guard = rows.get(label);
    const base = { label, guard, tree: 'HEAD', status: 'unrun', ms: null, why: null, parent_status: null, parent_ms: null, parent_why: null };
    if (!guard) return { ...base, why: 'the row names no guard' };
    if (!underRoots(guard)) return { ...base, why: `the guard is outside ${GUARD_ROOTS.join(' · ')}` };
    const r = headResult(guard); return { ...base, status: r.status, ms: r.ms, why: r.why || null };
  });
  if (!parent) return items;
  // the parent leg — the runner's scratch: the archived parent tree + node_modules linked + the HEAD guard copied in
  const runnable = items.filter((i) => i.guard && underRoots(i.guard));
  if (!runnable.length) return items;   // C826: no guard to run on the parent — nothing is checked out or unpacked
  let parentSha = null; try { parentSha = execFileSync('git', ['rev-parse', `${sha}~1`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (!parentSha) return items.map((i) => (i.guard && underRoots(i.guard) ? { ...i, parent_status: 'unrun', parent_why: 'no parent commit' } : i));
  let pt = null; try { pt = runnable.length ? parentTreeAt({ repo, sha: parentSha, archivePaths, ...(parentTreeDir ? { dir: parentTreeDir } : {}) }) : null; } catch { pt = null; }   // C826
  const dir = pt ? pt.dir : resolve(scratchRoot, `guards-${String(sha).slice(0, 10)}`);
  if (!pt) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  const pres = new Map();
  try {
    const present = pt ? [] : archivePaths.filter((p) => { try { execFileSync('git', ['cat-file', '-e', `${parentSha}:${p}`], { cwd: repo, stdio: 'ignore' }); return true; } catch { return false; } });
    if (present.length) execFileSync('bash', ['-c', `git archive ${parentSha} -- ${present.map((p) => `'${p}'`).join(' ')} | tar -x -C '${dir}'`], { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] });
    const nm = resolve(repo, 'node_modules'); if (existsSync(nm) && !existsSync(resolve(dir, 'node_modules'))) { try { execFileSync('ln', ['-s', nm, resolve(dir, 'node_modules')]); } catch {} }
    for (const i of runnable) {
      if (pres.has(i.guard)) continue;
      if (!existsSync(resolve(repo, i.guard))) { pres.set(i.guard, { status: 'unrun', ms: null, why: 'the guard file is not on disk at HEAD — nothing to copy onto the parent tree' }); continue; }
      mkdirSync(dirname(resolve(dir, i.guard)), { recursive: true }); cpSync(resolve(repo, i.guard), resolve(dir, i.guard));
      const r = run(i.guard, dir, { timeoutMs });
      // the runner's rule: a failure because a module OUTSIDE the archive is missing is UNMEASURED, not red
      const missing = r.status === 'fail' ? [...String(r.out || '').matchAll(/Cannot find module '([^']+)'/g)].map((m) => m[1]).filter((m) => !m.startsWith(dir) || !archivePaths.some((p) => m.slice(dir.length + 1) === p || m.slice(dir.length + 1).startsWith(p + '/'))) : [];
      pres.set(i.guard, missing.length ? { status: 'unrun', ms: r.ms, why: `the guard could not run on the parent tree: module outside the archive ${missing[0].slice(0, 80)}` } : r);
    }
  } catch (e) { for (const i of runnable) if (!pres.has(i.guard)) pres.set(i.guard, { status: 'unrun', ms: null, why: `git archive failed: ${String(e.stderr || e.message).slice(0, 120)}` }); }
  finally { if (pt) { try { gitq(['checkout', '-q', '-f', '--detach', parentSha], dir); gitq(['clean', '-fdqx'], dir); } catch {} pt.release(); } else rmSync(dir, { recursive: true, force: true }); }   // the verdict is the deliverable; the scratch is never left behind (C826: the persistent tree is put back, not deleted)
  return items.map((i) => { const r = pres.get(i.guard); return r ? { ...i, parent_status: r.status, parent_ms: r.ms, parent_why: r.why || null } : i; });
}

// ── C73 THE BATCH: a foreign append-only log as one row ────────────────────────────────────────────────────────────────
// ‖ is JSON-array serialisation — unambiguous under embedded newlines (sha256("a\nb"‖""‖"c") ≠ sha256("a"‖"b"‖"c")).
export const actionHash = ({ prompt = null, tool_call = null, response = null }) => sha256(JSON.stringify([prompt ?? null, tool_call ?? null, response ?? null]));
const TURN_KEYS = { prompt: ['prompt', 'user', 'input'], tool_call: ['tool_call', 'tool', 'tools'], response: ['response', 'assistant', 'output'] };   // declared aliases, nothing inferred
const pick = (o, ks) => { for (const k of ks) if (o[k] !== undefined) return o[k] == null ? null : typeof o[k] === 'string' ? o[k] : JSON.stringify(o[k]); return null; };
export function readLog(path) {
  const bytes = readFileSync(path);
  const turns = bytes.toString('utf8').split('\n').filter(Boolean).map((l, i) => { let o; try { o = JSON.parse(l); } catch { o = { prompt: l }; } const t = { i, prompt: pick(o, TURN_KEYS.prompt), tool_call: pick(o, TURN_KEYS.tool_call), response: pick(o, TURN_KEYS.response), at: o.at || o.ts || null }; t.action_hash = actionHash(t); return t; });
  return { path, bytes: bytes.length, sha: createHash('sha256').update(bytes).digest('hex'), turns };
}
// the actor's declared rows as their own tree — the same basins() the cockpit spec uses; root is a function of the rows' text only
export function actorTree(specPath, { walk = true } = {}) {
  const tree = emptyTree(`actor-spec:${specPath}`);
  const b = basins(tree, readFileSync(specPath, 'utf8'), { specPath, walk });
  return { tree, rows: b.rows };
}
const turnText = (t) => [t.prompt, t.tool_call, t.response].filter(Boolean).join('\n');
export function batch({ log, actor, spec, room = null, walk = true, ts = new Date().toISOString(), tape = FLIGHT, proofsDir = PROOFS_DIR, th = thresholds() }) {
  const L = readLog(log); const { tree, rows } = actorTree(spec, { walk });
  const turns = L.turns.map((t) => { const s = seedLeaf(tree, turnText(t), { th }); const n = s.leaf ? tree.nodes[s.leaf.id] : null;
    return { i: t.i, at: t.at, action_hash: t.action_hash, stage: s.abstained ? 'released' : 'landed', leaf: s.leaf ? s.leaf.id : null, label: n && n.meta ? n.meta.label : null, d: s.d_min, margin: s.margin === Infinity ? null : s.margin, why: s.why, pixel: n && n.pixel ? n.pixel : null }; });
  const landedIds = [...new Set(turns.filter((t) => t.stage === 'landed').map((t) => t.leaf))];
  const items = landedIds.map((id) => { const n = tree.nodes[id]; const pr = proof(tree, id); let proof_id = null; try { proof_id = writeProofFile(pr, proofsDir); } catch {} return { label: n.meta.label, id, hash: n.hash, root: pr.root, verified: verifyProof(pr) === pr.root, pathLen: pr.path.length, proof_id, turns: turns.filter((t) => t.leaf === id).length }; });
  // the WALK places the actor's declared rows (basins() walks each row once); a landed turn inherits its row's coordinate.
  // laneJumps = consecutive landed turns whose rows sit in different lanes — the actor moving between its own rows.
  const walked = turns.filter((t) => t.pixel); const blk = (p) => String(p).split(',')[0];
  const basinsPlaced = Object.values(tree.nodes).filter((n) => n.basin && n.pixel).length;
  const laneJumps = walk && walked.length ? walked.slice(1).filter((t, k) => blk(t.pixel) !== blk(walked[k].pixel)).length : null;
  const proofs = { status: items.length ? 'attested' : 'no turn landed in a declared row', root: tree.root, tesseract_sha: tree.root, actor, spec: basename(spec), rows, items };
  const delta = { status: walk ? (walked.length ? 'landed' : 'unmeasured — the walk refused every declared row') : 'unmeasured — the walk was not run (--no-walk)',
    slots: { turns: turns.length, landed: turns.length - turns.filter((t) => t.stage === 'released').length, released: turns.filter((t) => t.stage === 'released').length, thresholds: { tau_attach: th.tau_attach, m_attach: th.m_attach } },
    walk: { status: walk ? (walked.length ? 'landed' : 'unmeasured — the walk refused every turn') : 'unmeasured — the walk was not run (--no-walk)', basinsPlaced: walk ? basinsPlaced : null, basins: rows, turnsOnPlacedBasins: walk ? walked.length : null, laneJumps } };
  return append({ kind: 'batch', sha: L.sha, session: actor, room, proofs, delta, seed: { actor, log: basename(log), bytes: L.bytes, turns }, ts }, tape);
}

// C90 THE TWO SIGNING DOORS (thetacog-sign: { sha } or { bytes }). A commit is taped as `commit <sha>` always was; bytes are
// content-addressed (sha = sha256 of the bytes, the address a commit sha is for a repo) and taped as kind 'batch' with no spec
// and no walk — the CAR says what is missing (no leaf, no root); nothing is fabricated to make it complete.
export function signCommit({ sha, room = null, tape = FLIGHT, claims, treePath = TREE_PATH, guards = true, parent = false, guardOpts = {} } = {}) {
  let tesseract_sha = null; try { tesseract_sha = tesseractState(JSON.parse(readFileSync(treePath, 'utf8'))).sha; } catch {}
  // C92a: the guards the named rows declare, run and signed into the row — null only when the caller turned the leg off, never a fabricated pass
  const guardBlock = guards ? guardsFor(sha, { parent, ...guardOpts }) : null;
  return append({ kind: 'commit', sha, room, proofs: { ...proofsFor(sha), tesseract_sha, guards: guardBlock }, delta: deltaFor(sha) }, tape, { claims });
}
export function signBytes({ bytes, room = null, session = 'thetacog-sign', tape = FLIGHT, claims } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8');
  const sha = createHash('sha256').update(buf).digest('hex');
  return append({ kind: 'batch', sha, session, room, proofs: { status: 'bytes signed as-is — no spec, no walk, no leaf', root: null, tesseract_sha: null, items: [] },
    delta: { status: 'unmeasured — the bytes were signed, not walked' }, seed: { bytes: buf.length, sha256: sha } }, tape, { claims });
}

// C102a (operator: "sign the local tape … up to 10k action — that is a hard launch requirement, must be super smooth"): the last row
// is read off the TAIL of the file, never by parsing the whole tape — measured before this: 2.7 ms/append at 500 rows, 7.7 at
// 2,000 (quadratic; 10,000 rows would take ~6 min). A chunk from the end, doubled until it holds a full last line.
export function lastRow(path = FLIGHT) {
  let fd; try { fd = openSync(path, 'r'); } catch { return null; }
  try {
    const size = fstatSync(fd).size; if (!size) return null;
    let len = 64 * 1024;
    for (;;) {
      const start = Math.max(0, size - len); const buf = Buffer.alloc(size - start); readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf8'); const lines = text.split('\n').filter(Boolean);
      // the chunk holds a complete last line when it starts at 0 or contains a newline before the last non-empty line
      const complete = start === 0 || text.lastIndexOf('\n', text.trimEnd().length - 1) >= 0;
      if (complete && lines.length) { for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch { if (start === 0 || i > 0) continue; break; } } }
      if (start === 0) return null;
      len *= 2;
    }
  } finally { closeSync(fd); }
}
// C115 — THE APERTURE HASH ON THE COMMIT ROW. ω (scripts/vna/aperture-receipt.mjs: sha256 over the intent rows, the reality
// rows with their blob shas at the commit, the commit, the aperture version) rides inside the signed `delta` so a stranger
// re-running the walk elsewhere can check they fed the chip the same bytes before comparing pixels. READ off the receipt
// aperture-receipt.mjs wrote, and only when that receipt names THIS sha — the post-commit hook tapes the row in parallel with
// the walk, so a row taped before the walk lands carries null (said, never a stale ω from the previous commit).
export const APERTURE_RECEIPT = process.env.VNA_APERTURE_RECEIPT || resolve(REPO, 'data/vna/aperture-receipt.json');
export function apertureOmegaFor(sha, path = APERTURE_RECEIPT) {
  try { const r = JSON.parse(readFileSync(path, 'utf8')); return r && !r.preview && r.commit && String(r.commit) === String(sha) && /^[0-9a-f]{64}$/.test(String(r.omega || '')) ? r.omega : null; } catch { return null; }
}
// C524: the commit's own git timestamp, ms since epoch — null when the sha is not a real object in this repo
// (a test fixture, a batch/content sha). Never thrown: a lookup failure is a reason to say UNMEASURED, not to crash.
export function commitTimeOf(sha, { cwd = REPO } = {}) {
  try {
    const t = execFileSync('git', ['show', '-s', '--format=%ct', String(sha)], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const n = Number(t); return Number.isFinite(n) ? n * 1000 : null;
  } catch { return null; }
}
// C524 — THE LANE'S OWN LAG, MEASURED, NEVER GUESSED: the largest gap the walk has actually shown between a
// commit's own timestamp and the `at` its landed row carries, over the most recent `window` landed rows (archive
// then live window, oldest matters least). A floor (LAG_FLOOR_MS) keeps one lucky fast sample from collapsing the
// lane to near-zero and calling every slightly-late commit "never walked".
const LAG_WINDOW = 50;
export const LAG_FLOOR_MS = 60 * 60 * 1000; // an hour — the receipt-backfill grace window is minutes; the walk's is coarser
export function measuredLagMs(path = MEASURE, { archivePath, window = LAG_WINDOW } = {}) {
  const arch = archivePath || (String(path).replace(/\.ndjson$/, '') + '.archive.ndjson');
  const rows = [...nd(arch), ...nd(path)].filter((r) => r && r.sha && r.at).slice(-window);
  let max = LAG_FLOOR_MS;
  for (const r of rows) {
    const ct = commitTimeOf(r.sha); if (ct == null) continue;
    const at = Date.parse(r.at); if (!Number.isFinite(at)) continue;
    const lag = at - ct; if (lag > max) max = lag;
  }
  return max;
}
// C516: window THEN archive — fresh-pair/calibration-premium roll the ledger at 200 rows (ledger-attest.mjs
// appendPricedRow), so a sha measured more than 200 commits ago lives only in <ledger>.archive.ndjson. Measured
// 2026-10-01: 606 of 673 "not yet" commit rows on the last 2000 had a walk row in window+archive — this is why.
//
// C524 — "NOT YET" MEANS STILL INSIDE THE WALK'S OWN WINDOW; "NEVER WALKED" MEANS THAT WINDOW HAS ALREADY PASSED
// WITH NO ROW ANYWHERE. Of 1,368 "not yet" rows found 2026-10-01, 1,060 had no row in window or archive at all —
// for those the walk was never late, it never ran. A commit younger than the lane's measured lag (`measuredLagMs`)
// is honestly "not yet" (its turn may still come); one older, with no row, is "never walked" — a different claim,
// carrying `never_walked: true` so a reader can show it as its own state, never folded into a generic pending count.
// `commitTime`/`now`/`lagMs` are injectable (never require a real git object) so a fixture sha can be aged in a test.
export function deltaFor(sha, path = MEASURE, { receipt = APERTURE_RECEIPT, archivePath, commitTime, now, lagMs } = {}) {
  const arch = archivePath || (String(path).replace(/\.ndjson$/, '') + '.archive.ndjson');
  const rows = nd(path).filter((r) => r.sha && String(sha).startsWith(String(r.sha)));
  const all = rows.length ? rows : nd(arch).filter((r) => r.sha && String(sha).startsWith(String(r.sha)));
  const aperture_omega = apertureOmegaFor(sha, receipt);
  if (!all.length) {
    const ct = commitTime !== undefined ? commitTime : commitTimeOf(sha);
    const nowMs = now != null ? now : Date.now();
    if (ct != null) {
      const lag = lagMs != null ? lagMs : measuredLagMs(path, { archivePath: arch });
      if (nowMs - ct >= lag) {
        return { status: 'never walked — the drift walk never ran on this sha (older than the lane\'s measured lag, no row in window or archive)', aperture_omega, never_walked: true };
      }
    }
    return { status: 'not yet — the drift walk has not landed for this sha', aperture_omega };
  }
  const r = all[all.length - 1];
  return { status: 'landed', at: r.at, sigmaDrift: r.sigmaDrift ?? null, driftPct: r.driftPct ?? null, offPct: r.offPct ?? null, laneJump: r.laneJump ?? null, litIntent: r.litIntent ?? null, litReality: r.litReality ?? null, aperture_omega };
}
// C516 — ONE sha, idempotent: skip when a delta row already rides the tape for this sha (never two), skip when the
// walk still has not landed (deltaFor says so). The post-walk landing point (ledger-attest.mjs appendPricedRow)
// calls this detached, one sha at a time; `--backfill-deltas` below calls it in a bounded loop over the record.
export function appendDeltaIfLanded(sha, { tape = FLIGHT, path = MEASURE, archivePath } = {}) {
  if (nd(tape).some((r) => r.kind === 'delta' && r.sha === sha)) return { appended: false, why: 'a delta row already rides the tape for this sha' };
  const delta = deltaFor(sha, path, { archivePath });
  if (delta.status !== 'landed') return { appended: false, why: delta.status };
  return { appended: true, row: append({ kind: 'delta', sha, delta }, tape) };
}
// C516 — every commit row on the tape still saying "not yet" whose sha the walk has since landed (window or
// archive). Oldest-first, deduped by sha, so a bounded `--limit` backfills the earliest misses first.
export function pendingDeltaShas(tape = FLIGHT) {
  const seen = new Set(); const out = [];
  for (const r of nd(tape)) {
    if (r.kind !== 'commit' || !r.sha || !r.delta || typeof r.delta.status !== 'string' || !r.delta.status.startsWith('not yet')) continue;
    if (seen.has(r.sha)) continue; seen.add(r.sha); out.push(r.sha);
  }
  return out;
}
// C516 — bounded + idempotent: a sha already carrying a delta row is counted as skipped, never appended twice;
// `limit` bounds how many NEW delta rows this call appends (not how many candidates it reads).
export function backfillDeltas({ tape = FLIGHT, path = MEASURE, archivePath, limit = Infinity } = {}) {
  const candidates = pendingDeltaShas(tape); const results = [];
  for (const sha of candidates) {
    if (results.filter((r) => r.appended).length >= limit) break;
    results.push({ sha, ...appendDeltaIfLanded(sha, { tape, path, archivePath }) });
  }
  return { candidates: candidates.length, appended: results.filter((r) => r.appended).length, skipped: results.filter((r) => !r.appended).length, results };
}
// C524 — every "not yet" commit row the tape still carries whose sha, read LIVE against today's clock (not the
// clock at the moment it was signed), is actually never-walked: older than the lane's measured lag, with no row in
// window or archive, and no `delta` row already caught it. NEWEST-FIRST, and it stops at `limit` (C833, operator 2026-10-14:
// "last in first out on commits/l1/ncd"): the freshest commit's reading is the one being looked at, and an old miss drains only
// when nothing newer waits. Until then it walked the WHOLE tape oldest-first and called deltaFor (two ledger reads + a git spawn)
// on every commit before slicing to 6 — the --never-walked listing took over 120 s. Now the cost is bounded by the limit.
export function neverWalkedShas(tape = FLIGHT, { path = MEASURE, archivePath, limit = Infinity, isNever = null } = {}) {
  const rows = nd(tape);
  const alreadyLanded = new Set(rows.filter((r) => r.kind === 'delta' && r.sha).map((r) => r.sha));
  let lag; const never = isNever || ((sha) => deltaFor(sha, path, { archivePath, lagMs: lag ??= measuredLagMs(path, { archivePath }) }).never_walked);
  const seen = new Set(); const out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const r = rows[i];
    if (r.kind !== 'commit' || !r.sha) continue;
    if (seen.has(r.sha) || alreadyLanded.has(r.sha)) continue;
    seen.add(r.sha);
    if (never(r.sha)) out.push(r.sha);
  }
  return out;
}
export function proofsFor(sha, path = ATTEST) {
  const a = nd(path).filter((x) => x.sha === sha).pop();
  if (!a) return { status: 'no attestation row — the commit named no spec row, or attest-commit has not run', items: [] };
  return { status: 'attested', root: a.root, items: a.proofs.filter((p) => p.present).map((p) => ({ label: p.label, id: p.id, hash: p.hash, root: p.root, verified: p.verified, pathLen: p.pathLen, proof_id: p.proof_id || null })) };
}
export function buildRow({ kind, sha = null, session = null, room = null, proofs = null, delta = null, seed = null, gauge = null, ts = new Date().toISOString(), prev = null, seq = 0 }) {
  const row = { seq, ts, kind, prev: prev || GENESIS, sha, session, room, proofs, delta, seed, gauge };
  row.row_sha = sha256(canonical(row));
  // C97e NO ROW WITHOUT A SIGNATURE: no room → the LOCAL key (the host key every room key derives from), and the row says which in
  // signed_as ('room' | 'local'). The old path wrote sig null + sig_why 'no room — no identity to sign with' for 188 rows by
  // 2026-09-19; those rows stay as written (W4) and are counted by unsignedRows(). A key that cannot load still says why.
  try { const id = signerFor(room); row.sig = edSign(null, Buffer.from(canonical(row)), id.privateKey).toString('hex'); row.sig_pubkey = id.pubkey_hex; row.signed_as = id.signed_as; row.sig_why = null; }
  catch (e) { row.sig = null; row.sig_pubkey = null; row.signed_as = null; row.sig_why = String(e.message || e).slice(0, 80); }
  return row;
}
// C483a THE SEQUENCE NEVER RESTARTS (operator 2026-09-29: "we back up the tape for license actions on it"). Measured: the tape's
// seq went 3579 → 1921 at 2026-09-24T17:15:57Z and 09-24T19:10Z..09-29T05:59Z vanished from the file — no script rewrote it;
// `git stash` (a session checking a guard red-on-parent) put the working copy back to HEAD's committed tape, the next append read
// that stale tail, and the stash was dropped or never popped (4 branches forked from seq 2023; the rows were recovered byte for
// byte from the stash commits into data/vna/tape-recovered/). Two defences, both inside the one append door:
//   · a HIGH-WATER MARK outside the working tree (the live tape's lives in .git/, which stash, checkout and restore never touch;
//     another tape has one only when handed `hwm` or VNA_FLIGHT_HWM — a fixture rewritten per run is not a lost row). Bound to
//     the tape's genesis row, so a fresh tape never inherits another's mark. When the tail
//     is behind the mark, the file was replaced under the writer: one `gap` row is appended FIRST, naming the tail it found and
//     the mark it lost (seq, row_sha, ts), and the seq resumes above the mark — the old rows stay where they are, the gap is said.
//   · a LOCK around read-the-tail → append, so two writers can no longer read the same tail and fork one seq (seen at 2679, 3304).
export function tapeSidecars(path = FLIGHT) {
  const gitDir = resolve(REPO, '.git'); let live = false;
  try { live = resolve(path) === resolve(REPO, 'data/vna/flight-tape.ndjson') && statSync(gitDir).isDirectory(); } catch {}
  return live ? { hwm: resolve(gitDir, 'vna-flight-tape.hwm.json'), lock: resolve(gitDir, 'vna-flight-tape.lock') } : { hwm: process.env.VNA_FLIGHT_HWM || null, lock: `${path}.lock` };
}
function firstRow(path) {
  let fd; try { fd = openSync(path, 'r'); } catch { return null; }
  try { const size = fstatSync(fd).size; for (let len = 16 * 1024; ; len *= 2) { const buf = Buffer.alloc(Math.min(len, size)); readSync(fd, buf, 0, buf.length, 0); const t = buf.toString('utf8'); const i = t.indexOf('\n'); if (i >= 0 || buf.length === size) { try { return JSON.parse(i >= 0 ? t.slice(0, i) : t); } catch { return null; } } } }
  finally { closeSync(fd); }
}
export function highWater(path = FLIGHT, { hwm = tapeSidecars(path).hwm } = {}) {
  if (!hwm) return null;
  const genesis = firstRow(path); if (!genesis) return null;
  try { const m = JSON.parse(readFileSync(hwm, 'utf8')); if (m && m.genesis === genesis.row_sha && Number.isFinite(m.seq)) return m; } catch {}
  let top = null; for (const r of nd(path)) if (Number.isFinite(r.seq) && (!top || r.seq > top.seq)) top = r;   // once per tape: no mark yet, so the tape itself is read
  return top ? { seq: top.seq, row_sha: top.row_sha, ts: top.ts, genesis: genesis.row_sha, from: 'scan' } : null;
}
function withTapeLock(lock, fn) {
  let fd = null; const t0 = Date.now(); const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { fd = openSync(lock, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') break;   // a lock that cannot be made never blocks the append
      try { if (Date.now() - statSync(lock).mtimeMs > 10000) { rmSync(lock, { force: true }); continue; } } catch { continue; }   // a dead writer's lock
      if (Date.now() - t0 > 3000) break; Atomics.wait(nap, 0, 0, 5);
    }
  }
  try { return fn(); } finally { if (fd !== null) { try { closeSync(fd); } catch {} rmSync(lock, { force: true }); } }
}
export function append(rowFields, path = FLIGHT, opts = {}) {
  if (!rowFields || !ROW_KINDS.includes(rowFields.kind)) throw new Error(`flight-tape: kind ${JSON.stringify(rowFields && rowFields.kind)} is not a tape row kind (${ROW_KINDS.join(' · ')})`);
  mkdirSync(dirname(path), { recursive: true });
  const side = tapeSidecars(path); if (opts && opts.hwm !== undefined) side.hwm = opts.hwm;
  return withTapeLock(side.lock, () => appendLocked(rowFields, path, opts || {}, side));
}
function appendLocked(rowFields, path, { probe, claims, ledger = CREDITS_LOCAL } = {}, side) {
  let last = lastRow(path);
  const hw = highWater(path, { hwm: side.hwm });
  if (hw && last && rowFields.kind !== 'gap' && hw.row_sha !== last.row_sha && hw.seq >= (last.seq || 0)) {   // a caller's own gap row names its gap itself   // the tail is behind the mark: the file was replaced under the writer
    const gts = new Date().toISOString();
    const gap = buildRow({ kind: 'gap', ts: gts, prev: last.row_sha, seq: hw.seq + 1, proofs: { gap: { found: { seq: last.seq, row_sha: last.row_sha, ts: last.ts }, high_water: { seq: hw.seq, row_sha: hw.row_sha, ts: hw.ts }, why: 'the tape\'s tail is behind its own high-water mark — the working copy was replaced by an older copy (a git stash, restore or checkout); the rows after the tail are wherever that copy went, not here', by: 'append (C483a)' } } });
    appendFileSync(path, JSON.stringify(gap) + '\n'); last = gap;
  }
  const nextSeq = Math.max(last ? (last.seq || 0) : -1, hw ? hw.seq : -1) + 1;
  const ts = rowFields.ts || new Date().toISOString();   // one clock for the row and the ledger rows it pays with
  // C86: every CAR kind carries the boundary probe inside its signed delta — read off the receipt, never run here
  if (CAR_KINDS.includes(rowFields.kind)) { const d = rowFields.delta && typeof rowFields.delta === 'object' ? rowFields.delta : {}; rowFields = { ...rowFields, delta: { ...d, boundary_probe: d.boundary_probe || probe || boundaryProbeFor() } }; }
  // C90 + C102b: the licence stamp — the PUBLIC claims from the environment (or `claims`) — rides inside the signed proofs of EVERY
  // NEW row, PAID FOR: one credit per stamped row on the local ledger, the entitlement's credits snapshot reconciled first (once per
  // token). REFUSED (a throw, nothing appended, nothing spent) when the licence names a key other than the one about to sign; at
  // credits 0 the row is appended unstamped and says so (stamp_why, beside sig_why, outside the signed bytes — SIGNED_KEYS do not move).
  const c = claims === undefined ? licenceClaimsFromEnv() : claims;
  let pubkey = null; try { pubkey = signerFor(rowFields.room).pubkey_hex; } catch {}   // C97e: the key about to sign — the room's, else the local key
  let stamp = null, stamp_why = null;
  if (!c || typeof c !== 'object') stamp_why = 'no licence in the environment when the row was written (VNA_ENTITLEMENT_CLAIMS absent)';
  else if (!pubkey) stamp_why = 'unsigned row — a stamp is a claim the device key signs';
  else {
    stamp = licenceStampFor({ claims: c, pubkey });   // the C90 function, the one stamp — throws on a foreign fingerprint BEFORE any ledger row
    if (!Number.isFinite(Number(c.credits))) { stamp = null; stamp_why = 'credits UNMEASURED — the entitlement carries no credits claim'; }
    else if (reconcileCredits({ claims: c, ledger, at: ts }).balance <= 0) { stamp = null; stamp_why = 'credits 0'; }
  }
  const p = rowFields.proofs && typeof rowFields.proofs === 'object' ? rowFields.proofs : null;
  if (stamp || CAR_KINDS.includes(rowFields.kind) || p) rowFields = { ...rowFields, proofs: { ...(p || {}), licence: stamp } };   // a CAR always names its licence field (C90); another kind only when it has proofs or a stamp
  const row = buildRow({ ...rowFields, ts, prev: last ? last.row_sha : null, seq: nextSeq });
  row.stamp_why = stamp ? null : stamp_why;
  appendFileSync(path, JSON.stringify(row) + '\n');
  if (side.hwm) { const g = firstRow(path); if (g) try { writeFileSync(side.hwm, JSON.stringify({ seq: row.seq, row_sha: row.row_sha, ts: row.ts, genesis: g.row_sha }) + '\n'); } catch {} }   // the mark, outside the tape; the tape itself is only ever appended
  if (stamp) spendCredit({ rowSha: row.row_sha, ledger, at: ts });   // the tape first (the record of what was stamped), then the credit it cost
  return row;
}
// C483 THE TURN ROW CARRIES ITS WALK COORDINATE, OR SAYS WHY NOT. Measured 2026-09-29: the last turn row with seed.pixel was
// 2026-09-24T17:04:59Z. C193 (3db7c1a2b6) served a goal-anchored turn from the sidecar and moved the prompt's walk into the
// detached snowball-refresh.mjs, which walked and dropped the pixel; C318 (0a4a81e63c) sent every other turn over a mass tree
// there too. The hook kept taping `pixel: null` with no reason. Every turn row now goes through this one projection: the
// pixel is the one Rust walk's (lensWalk → spec-tree seedSpecFirst), kept only when shaped like an address (the repo view's
// own rule, drift-reading.mjs PIXEL); without one the row names UNMEASURED and the reason (deferred under load · not
// dispatched · under 12 chars · no seed receipt) — never a silent absence. Rows already on the tape stay as written (W4).
export function turnSeed(s) {
  if (!s || typeof s !== 'object') return { abstained: true, stage: null, leaf: null, best: null, d: null, pixel: null, unmeasured: 'no seed receipt for this turn — the prompt was never seeded' };
  const pixel = typeof s.pixel === 'string' && ADDRESS.test(s.pixel) ? s.pixel : null;
  const why = pixel ? null : [s.unmeasured, s.why].find((x) => typeof x === 'string' && x.trim()) || (s.pixel != null ? `the seed's pixel ${JSON.stringify(String(s.pixel).slice(0, 40))} is not shaped like an address — dropped, never repaired` : 'the walk wrote no coordinate for this turn and its seed carried no reason');
  const nm = (x) => (x && typeof x === 'object' ? x.label || x.id || null : x ?? null);   // a label, never a leaf's text
  return { abstained: s.abstained ?? null, stage: s.stage ?? null, leaf: nm(s.leaf), best: nm(s.best), d: Number.isFinite(s.d) ? s.d : null, pixel, unmeasured: why };
}
// the one turn-row door: the CLI (`turn`, spawned by the prompt hook) and the detached refresh (the walk C193 moved) both call it
export function appendTurn({ seed, session = null, room = null, gauge, path = FLIGHT } = {}) {
  let g = gauge; if (g === undefined) { g = null; try { const x = JSON.parse(readFileSync(GAUGE, 'utf8')); g = { state: x.state, lose: x.lose, contextBytes: x.contextBytes, turns: x.turns }; } catch {} }
  return append({ kind: 'turn', session, room, seed: turnSeed(seed), gauge: g }, path);
}
// C91a: ONE row on its own — the hash over its canonical bytes and the signature under the pubkey it carries. The chain
// (prev) is verify()'s question, not this one's; verify() calls this per row so the two never drift.
export function verifyRow(r) {
  if (!r || typeof r !== 'object') return { ok: false, signed: false, why: 'no row' };
  if (r.row_sha !== sha256(canonical(r))) return { ok: false, signed: false, why: 'row_sha does not match the row — the row was edited' };
  if (!r.sig) return { ok: true, signed: false, why: null };
  let good = false; try { good = edVerify(null, Buffer.from(canonical(r)), createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(r.sig_pubkey, 'hex')]), format: 'der', type: 'spki' }), Buffer.from(r.sig, 'hex')); } catch {}
  return good ? { ok: true, signed: true, why: null } : { ok: false, signed: true, why: 'signature does not verify under its own pubkey' };
}
// C97e THE COUNT DOOR: the historical unsigned rows are retained, never rewritten (W4) — this counts them and names the first and
// last date; `unsignedAfterFix` is the prospective half, the rows the guard fails on. A gap in a monotonic record is itself a
// countable displacement (W5) — the count is what the panel prints, never a repair.
export function unsignedRows(path = FLIGHT, { fixAt = null } = {}) {
  const rows = nd(path); const un = rows.filter((r) => !r.sig);
  const out = { rows: rows.length, signed: rows.length - un.length, unsigned: un.length, first: un.length ? un[0].ts : null, last: un.length ? un[un.length - 1].ts : null, sinceFix: 0, unsignedAfterFix: [] };
  if (fixAt) { out.unsignedAfterFix = un.filter((r) => String(r.ts) > String(fixAt)).map((r) => ({ seq: r.seq, ts: r.ts, why: r.sig_why })); out.sinceFix = out.unsignedAfterFix.length; }
  else { const lastSigned = rows.filter((r) => r.sig && r.signed_as === 'local')[0]; out.sinceFix = lastSigned ? un.filter((r) => r.seq > lastSigned.seq).length : 0; }
  return out;
}
// C514 — a row whose `prev` matches NEITHER the sidecar's `prev` NOR its `expect_prev` at that seq is not this break;
// the match is exact on all three fields so a named row can only seal the specific cut it was written for.
export function namedBreaks(path = BREAKS) { return nd(path); }
function breakFor(seq, prevGot, expectPrev, path) {
  return namedBreaks(path).find((b) => b.seq === seq && b.prev === prevGot && b.expect_prev === expectPrev) || null;
}
export function verify(path = FLIGHT, { breaksPath = BREAKS } = {}) {
  const rows = nd(path); let prev = null; const out = { rows: rows.length, ok: true, signed: 0, unsigned: 0, firstBreak: null, breaks: [] };
  for (const r of rows) {
    const expectPrev = prev ? prev.row_sha : GENESIS;
    if (r.prev !== expectPrev) {
      out.ok = false;
      const named = breakFor(r.seq, r.prev, expectPrev, breaksPath);
      const brk = { seq: r.seq, why: `prev ${String(r.prev).slice(0, 12)} ≠ ${String(expectPrev).slice(0, 12)} — the chain is cut here`, named: !!named, cause: named ? named.cause : null };
      out.breaks.push(brk);
      // unnamed: stop here, same as before C514 — a cut nobody has named is never papered over by continuing past it
      if (!named) { out.firstBreak = brk; break; }
      // named and sealed: never re-link `prev` to make this row agree with the row before it (AXIOM 1) — instead the
      // walk keeps going, verifying this row and everything after it as their own segment, same as the side before
      // the break already was verified as its own segment above
    }
    const vr = verifyRow(r);
    if (!vr.ok) { out.ok = false; const brk = { seq: r.seq, why: vr.why, named: false, cause: null }; out.breaks.push(brk); out.firstBreak = out.firstBreak || brk; break; }
    if (vr.signed) out.signed++; else out.unsigned++;
    prev = r;
  }
  return out;
}

const guardsLine = (g) => (g == null ? 'off' : !g.length ? '[] (names no row)' : ['pass', 'fail', 'unrun'].map((k) => `${g.filter((i) => i.status === k).length} ${k}`).join(' / '));
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// stdout to a pipe is asynchronous: process.exit() right after a large console.log truncates it (seen: a 20-turn batch row
// under --json came back as an empty stdout). The CLI sets exitCode and RETURNS; node exits when the write has drained.
if (isMain) main();
function main() {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
  if (argv.includes('--verify')) { const v = verify(); if (asJson) console.log(JSON.stringify(v)); else { const status = v.ok ? 'chain + signatures VERIFY' : v.firstBreak ? `BROKEN at seq ${v.firstBreak.seq}: ${v.firstBreak.why}` : `BROKEN-NAMED at seq ${v.breaks.map((b) => b.seq).join(',')} (${v.breaks.map((b) => b.cause).join(',')}) — sealed, chain verifies on each side`; console.log(`flight tape · ${v.rows} rows · ${v.signed} signed · ${v.unsigned} unsigned · ${status} · ${FLIGHT}`); } process.exitCode = v.ok ? 0 : 1; return; }
  if (argv.includes('--unsigned')) { const u = unsignedRows(FLIGHT); let fp = '—'; try { fp = signerFor(null).fingerprint; } catch {} if (asJson) console.log(JSON.stringify({ ...u, local_key: fp })); else console.log(`flight tape · ${u.rows} rows · ${u.unsigned} unsigned · first ${u.first || '—'} · last ${u.last || '—'} · ${u.signed} signed · local key ${fp} · ${FLIGHT}`); return; }
  if (argv.includes('--tail')) { const n = Number(argv[argv.indexOf('--tail') + 1]) || 5; for (const r of nd(FLIGHT).slice(-n)) console.log(`  #${r.seq} ${r.ts} ${r.kind} ${r.sha ? r.sha.slice(0, 10) : ''} · proofs ${r.proofs && r.proofs.items ? r.proofs.items.length : '—'} · Δ ${r.delta ? r.delta.status : '—'} · ${r.sig ? 'signed' : 'unsigned: ' + r.sig_why} · prev ${String(r.prev).slice(0, 10)}`); return; }
  // C516 — the bounded, idempotent catch-up for the 606 commit rows already on the tape saying "not yet" when the
  // walk had in fact landed (in the window or the archive). `--limit N` caps how many NEW delta rows this run appends.
  if (argv.includes('--backfill-deltas')) { const n = Number(argv[argv.indexOf('--backfill-deltas') + 1]); const limit = Number.isFinite(n) && n > 0 ? n : Infinity; const r = backfillDeltas({ limit }); if (asJson) console.log(JSON.stringify(r)); else console.log(`backfill-deltas · ${r.candidates} candidates still saying "not yet" · ${r.appended} delta rows appended · ${r.skipped} skipped (already landed on the row, or still not yet)`); return; }
  // C524 — oldest-first shas the walk never ran on (read LIVE, not off the row's frozen "not yet"); the bounded,
  // detached catch-up (scripts/controller/walk-backfill.sh) lists under `N` before walking any (`--dry-run`'s door).
  if (argv.includes('--never-walked')) { const n = Number(argv[argv.indexOf('--never-walked') + 1]); const limit = Number.isFinite(n) && n > 0 ? n : Infinity; const shas = neverWalkedShas(FLIGHT, { limit }); if (asJson) console.log(JSON.stringify({ shas })); else for (const sha of shas) console.log(sha); return; }
  const cmd = argv.find((a) => !a.startsWith('--'));
  if (cmd === 'commit') {
    const ref = argv[argv.indexOf('commit') + 1] || 'HEAD'; const sha = execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim();
    const room = roomFromTerminal() || roomFromCommitTrailer(sha, REPO) || null;
    // C63: the tesseract sha rides INSIDE the signed proofs object (SIGNED_KEYS never change under 170 signed rows); C90: so does the licence stamp
    const row = signCommit({ sha, room, guards: !argv.includes('--no-guards'), parent: argv.includes('--parent') });
    if (asJson) console.log(JSON.stringify(row)); else console.log(`#${row.seq} commit ${sha.slice(0, 10)} · proofs ${row.proofs.items.length} (${row.proofs.status}) · guards ${guardsLine(row.proofs.guards)} · Δ ${row.delta.status} · ${row.sig ? 'signed as ' + row.signed_as + (room ? ' ' + room : '') : 'unsigned: ' + row.sig_why}`);
    return;
  }
  if (cmd === 'guards') { const ref = argv[argv.indexOf('guards') + 1] || 'HEAD'; const sha = execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim(); const g = guardsFor(sha, { parent: argv.includes('--parent') }); if (asJson) console.log(JSON.stringify(g)); else { console.log(`guards ${sha.slice(0, 10)} · ${guardsLine(g)}`); for (const i of g) console.log(`  ${i.label} · ${i.guard || '—'} · ${i.status}${i.ms != null ? ' ' + i.ms + ' ms' : ''}${i.why ? ' (' + i.why + ')' : ''}${i.parent_status ? ' · parent ' + i.parent_status + (i.parent_ms != null ? ' ' + i.parent_ms + ' ms' : '') + (i.parent_why ? ' (' + i.parent_why + ')' : '') : ''}`); } if (g.some((i) => i.status === 'fail')) process.exitCode = 1; return; }
  if (cmd === 'labour') { const ref = argv[argv.indexOf('labour') + 1] || 'HEAD'; const sha = execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim(); const r = stampLabour({ sha }); if (asJson) console.log(JSON.stringify(r)); else console.log(r.ok ? `${r.appended ? `#${r.row.seq} labour ${sha.slice(0, 10)} · amends ${String(r.row.proofs.amends).slice(0, 10)}` : `labour ${sha.slice(0, 10)} · already on the tape`} · hours ${r.stamp.equivalent_labor_hours ?? `— (${r.stamp.hours_why})`} · tier ${r.stamp.active_skill_tier ?? `— (${r.stamp.tier_why})`} · grounding ${r.stamp.grounding_ratio ?? `— (${r.stamp.ratio_why})`}` : `labour ${sha.slice(0, 10)} · ${r.why}`); if (!r.ok) process.exitCode = 1; return; }
  if (cmd === 'car') { const sha = argv[argv.indexOf('car') + 1] || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { console.error('car: no sha given and no git — name the sha'); process.exitCode = 2; return; } })(); const car = carFor(sha); if (!car) { console.log(`no commit or batch row for ${sha.slice(0, 10)} on the tape`); process.exitCode = 1; return; } if (asJson) console.log(JSON.stringify(car)); else console.log(`CAR ${String(car.commit_sha).slice(0, 10)} · ${car.at} · licence ${car.licence.status} · leaves ${car.leaf_id ? car.leaf_id.length : 0} · root ${String(car.merkle_root || '—').slice(0, 12)} · tesseract ${String(car.tesseract_sha || '—').slice(0, 12)} · proofs ${car.inclusion_proof ? car.inclusion_proof.filter((l) => l.verifies).length + '/' + car.inclusion_proof.length + ' verify' : '—'} · signature ${car.signature ? (car.signature.verifies ? 'verifies' : 'FAILS') : '—'} · ${boundaryProbeLine(car.boundary_probe)} · ${car.complete ? 'COMPLETE' : 'missing: ' + car.missing.join(', ')}`); return; }
  if (cmd === 'batch') {
    const log = argv[argv.indexOf('batch') + 1]; const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
    const actor = arg('--actor'), spec = arg('--spec');
    if (!log || !actor || !spec) { console.error('usage: flight-tape.mjs batch <log.ndjson> --actor <name> --spec <rows.md> [--room r] [--no-walk] [--json]'); process.exitCode = 2; return; }
    const room = arg('--room') || roomFromTerminal() || null;   // never the commit trailer — there is no commit
    const row = batch({ log: resolve(log), actor, spec: resolve(spec), room, walk: !argv.includes('--no-walk') });
    if (asJson) console.log(JSON.stringify(row)); else console.log(`#${row.seq} batch ${row.sha.slice(0, 10)} · ${actor} · ${row.seed.turns.length} turns · landed ${row.delta.slots.landed} / released ${row.delta.slots.released} · proofs ${row.proofs.items.length} (${row.proofs.status}) · walk ${row.delta.walk.status} · ${row.sig ? 'signed as ' + row.signed_as + (room ? ' ' + room : '') : 'unsigned: ' + row.sig_why}`);
    return;
  }
  if (cmd === 'turn') {
    const session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null; const room = roomFromTerminal() || null;   // the terminal's room signs the turn
    // C483: the hook hands THIS turn's seed in VNA_TURN_SEED (never the log's last row — another session's turn can land between);
    // the seed log's tail stays the fallback for a caller that predates it. turnSeed names UNMEASURED when there is no pixel.
    let s; try { s = process.env.VNA_TURN_SEED ? JSON.parse(process.env.VNA_TURN_SEED) : undefined; } catch { s = { unmeasured: 'VNA_TURN_SEED did not parse' }; }
    if (s === undefined) { const seeds = nd(SEEDS); s = seeds.length ? seeds[seeds.length - 1] : null; }
    const row = appendTurn({ seed: s, session, room });
    if (asJson) console.log(JSON.stringify(row)); else console.log(`#${row.seq} turn · ${row.sig ? 'signed as ' + row.signed_as : 'unsigned: ' + row.sig_why} · ${row.proofs && row.proofs.licence ? 'stamped' : 'unstamped: ' + row.stamp_why}`);
    return;
  }
  // C516 — the post-walk landing point (ledger-attest.mjs appendPricedRow) calls this ONE sha at a time, detached,
  // right after the walk's row lands on measure-history: bounded (one ndjson read + one append), never blocking the caller.
  if (cmd === 'delta') {
    const sha = argv[argv.indexOf('delta') + 1];
    if (!sha) { console.error('usage: flight-tape.mjs delta <sha>'); process.exitCode = 2; return; }
    const r = appendDeltaIfLanded(sha);
    if (asJson) console.log(JSON.stringify(r)); else console.log(r.appended ? `#${r.row.seq} delta ${sha.slice(0, 10)} · landed` : `delta ${sha.slice(0, 10)} · not appended: ${r.why}`);
    return;
  }
  console.error('usage: flight-tape.mjs commit <sha> [--parent] [--no-guards] | guards <sha> [--parent] | batch <log> --actor <a> --spec <md> | turn | car [sha] | delta <sha> | --backfill-deltas [N] | --never-walked [N] | --verify | --tail [N]'); process.exitCode = 2; return;
}
