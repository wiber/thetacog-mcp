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
// Importable: import { computeLedgerRoot, computeHistoryRoot, appendPricedRow, attestLedger, verifyLedger } from './ledger-attest.mjs'

import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256Hex, attestationRoot, sealReceipt, verifyReceipt, sealReceiptAs, actorIdentity } from './receipt-crypto.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_LEDGER = resolve(REPO, 'data/pmu/measure-history.ndjson');
// C516 — THE POST-WALK LANDING POINT: the measured row for a sha lands here (appendPricedRow is the one door every
// caller — fresh-pair, probe-verify, calibration-premium, … — writes through), so this is also where the flight
// tape finds out the walk landed. Fired ONLY on the real, live ledger (never a test's fixture path, never the
// hyphen-form sync copy) — detached (spawn + unref, per the hook-never-blocks rule: appending one flight-tape row
// signs and hashes, which is bounded but still a child process we never want the caller waiting on) and best-effort:
// a spawn that fails to start never fails the pricing it rides on.
const FLIGHT_TAPE_CLI = resolve(REPO, 'scripts/vna/flight-tape.mjs');
function fireDeltaOnLanding(line, ledgerPath) {
  if (resolve(ledgerPath) !== DEFAULT_LEDGER) return;   // a test or a scratch ledger never tapes a delta row
  let sha = null; try { const row = JSON.parse(String(line)); sha = row && typeof row.sha === 'string' ? row.sha : null; } catch {}
  if (!sha) return;
  try { spawn(process.execPath, [FLIGHT_TAPE_CLI, 'delta', sha], { cwd: REPO, detached: true, stdio: 'ignore' }).unref(); } catch {}
}
const attestationPathFor = (ledger) => ledger.replace(/\.ndjson$/, '') + '.attestation.json';
// NOTE the sibling that is NOT this file: data/pmu/measure-history-archive.ndjson (hyphen) is
// reef-derivatives' periodic best-effort SYNC — an unsealed longitudinal convenience copy that
// can miss rows between runs. THIS dot-form archive is the sealed rotation log: written only by
// appendPricedRow, disjoint from current, covered by the root. Do not merge them — an out-of-
// door writer inside the sealed set makes ROOT MISMATCH permanent again (ratchet doc DP-7).
const archivePathFor = (ledger) => ledger.replace(/\.ndjson$/, '') + '.archive.ndjson';

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

// THE SAME LEAVES, WITHOUT THE STRING (2026-10-13). computeHistoryRoot read each ledger whole into one string, and the
// walk tape is sealed on EVERY prompt from EVERY room (walk-tape-seal.mjs, "~47 ms at 2,230 rows" when written). At 355,010
// rows / 1.6 GB one seal held 2.85 GB of node footprint, beside 15 rooms, on a 24 GB Mac. This reads fixed chunks and hashes
// line by line: only the 64-char leaves stay resident (~40 MB). Lines split on byte 0x0A, which never occurs inside a
// multi-byte UTF-8 sequence, so each decoded line, its \r strip, its blank filter and its hash are exactly ledgerLeaves'.
// Guard: tests/pmu-simulator/ledger-leaves-streamed.test.mjs (parity incl. CRLF, blanks, multibyte across chunk edges).
export function ledgerLeavesFromFile(path, chunk = 8 << 20) {
  if (!existsSync(path)) return [];
  const out = []; const buf = Buffer.allocUnsafe(chunk); let carry = Buffer.alloc(0);
  const push = (b) => { let line = b.toString('utf8'); if (line.endsWith('\r')) line = line.slice(0, -1); if (line.trim().length > 0) out.push(sha256Hex(line)); };
  const fd = openSync(path, 'r');
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, chunk, null); if (!n) break;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let i = data.indexOf(10); i !== -1; i = data.indexOf(10, start)) { push(data.subarray(start, i)); start = i + 1; }
      carry = Buffer.from(data.subarray(start));
    }
    if (carry.length) push(carry);
  } finally { closeSync(fd); }
  return out;
}

// THE INCREMENTAL SEAL (2026-10-13, operator: "there is an optimised way to do that"). Streaming fixed the memory, but every
// seal still re-hashed all 1.6 GB (~12 s) on every prompt from every room. The tape is append-only, so the WRITER's seal keeps
// the leaf digests up to the last sealed newline (.thetacog/cache/, gitignored) and hashes only the new tail. The cache is
// trusted only while the 4 KB ending at its offset still hashes the same and its digest count matches; any shrink, edit at the
// boundary or torn cache rebuilds from byte 0. VERIFY never reads this cache (verifyLedger → computeHistoryRoot streams the raw
// file): a cache the sealer wrote is the sealer's own account, and the check must read a record the actor did not author
// (AXIOM 1, W3). Rust port: this decides a root and holds mass, so it belongs on the derived punch list
// (node scripts/vna/engine-map.mjs → data/vna/rust-punch-list.json); the leaf cache + Merkle root move into the pmu crate.
const LEAF_CACHE_V = 1;
const leafCachePathFor = (ledger) => resolve(REPO, '.thetacog/cache', ledger.replace(REPO + '/', '').replace(/[\/]/g, '__') + '.leaves');
function boundaryHash(path, off) {
  if (off <= 0) return 'origin';
  const len = Math.min(4096, off); const b = Buffer.alloc(len); const fd = openSync(path, 'r');
  try { readSync(fd, b, 0, len, off - len); } finally { closeSync(fd); }
  return createHash('sha256').update(b).digest('hex');
}
export function ledgerLeavesIncremental(path, { cachePath = leafCachePathFor(path), chunk = 8 << 20 } = {}) {
  if (!existsSync(path)) return [];
  const size = statSync(path).size;
  let meta = null, raw = null;
  try { meta = JSON.parse(readFileSync(cachePath + '.json', 'utf8')); raw = readFileSync(cachePath); } catch { /* cold */ }
  const ok = meta && meta.v === LEAF_CACHE_V && meta.offset <= size && raw && raw.length === meta.count * 32 && boundaryHash(path, meta.offset) === meta.boundary;
  const kept = ok ? raw : Buffer.alloc(0); let offset = ok ? meta.offset : 0;
  const leaves = []; for (let i = 0; i < kept.length; i += 32) leaves.push(kept.toString('hex', i, i + 32));
  const fresh = []; let tail = null; const buf = Buffer.allocUnsafe(chunk); let carry = Buffer.alloc(0); let pos = offset; let sealedTo = offset;
  const leafOf = (b) => { let line = b.toString('utf8'); if (line.endsWith('\r')) line = line.slice(0, -1); return line.trim().length > 0 ? sha256Hex(line) : null; };
  const fd = openSync(path, 'r');
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, chunk, pos); if (!n) break;
      const base = pos - carry.length; pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let i = data.indexOf(10); i !== -1; i = data.indexOf(10, start)) { const h = leafOf(data.subarray(start, i)); if (h) { leaves.push(h); fresh.push(Buffer.from(h, 'hex')); } start = i + 1; sealedTo = base + start; }
      carry = Buffer.from(data.subarray(start));
    }
    if (carry.length) tail = leafOf(carry);   // an unterminated last row counts, exactly as the full read counts it, but is never cached
  } finally { closeSync(fd); }
  if (!ok || fresh.length || sealedTo !== offset) {
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      const all = Buffer.concat([kept, ...fresh]); const tmp = `${cachePath}.${process.pid}.tmp`;
      writeFileSync(tmp, all); renameSync(tmp, cachePath);
      writeFileSync(tmp + '.json', JSON.stringify({ v: LEAF_CACHE_V, offset: sealedTo, count: all.length / 32, boundary: boundaryHash(path, sealedTo) })); renameSync(tmp + '.json', cachePath + '.json');
    } catch { /* a cache that cannot be written only costs the next seal a full read */ }
  }
  if (tail) leaves.push(tail);
  return leaves;
}

// Deterministic Merkle root over the row hashes (order-independent, like the receipt root —
// the premium aggregates the multiset, so order is not part of the priced statistic).
export function computeLedgerRoot(text) {
  const leaves = ledgerLeaves(text);
  return { root: attestationRoot(leaves), count: leaves.length };
}

// ── THE SETTLEMENT FIX (2026-08-09) — the root covers the FULL priced history, and rows are
// never destroyed. Diagnosis of the standing ROOT MISMATCH: the ledger is a live rolling
// window (fresh-pair appends on every measure and trimmed to the last 200 by REWRITING the
// file), while the seal was a one-shot snapshot nothing ever refreshed. Verify therefore
// compared today's window against a weeks-dead seal — RED was the steady state, which trains
// every reader to ignore the exact signal a settlement index exists to give. Three properties
// restore the S&P-close semantics:
//   (1) rotation ARCHIVES — overflow rows append to <ledger>.archive.ndjson, never vanish;
//   (2) the root is computed over archive + current (the full multiset), so a legitimate
//       append GROWS the history and re-seals, while any alteration/deletion of an already-
//       priced row changes a leaf it can no longer silently rotate away;
//   (3) the WRITER re-seals at write time (appendPricedRow below is the one door), so
//       verify-green is the steady state and RED means exactly one thing: bytes changed
//       outside the sealed writer path.
export function computeHistoryRoot(ledgerPath = DEFAULT_LEDGER) {
  const archiveLeaves = ledgerLeavesFromFile(archivePathFor(ledgerPath));
  const currentLeaves = ledgerLeavesFromFile(ledgerPath);
  return {
    root: attestationRoot([...archiveLeaves, ...currentLeaves]),
    count: archiveLeaves.length + currentLeaves.length,
    currentCount: currentLeaves.length,
    archiveCount: archiveLeaves.length,
  };
}

// THE ONE READER (closure 4's other half, 2026-09-14). Property (1) above made the writer retain;
// a reader that opens only <ledger>.ndjson still sees a 200-row window and scores anything older
// as "no evidence" (probe-verify's driftOutcome wrote n_before=0 into 262 stories that way). Every
// reader that windows by time reads archive + current — exactly the multiset the root covers —
// through this door, never by re-deriving the archive path. Rows are parsed leniently (a corrupt
// line is dropped, never a thrown read) and returned oldest-first; callers filter on the fields
// they price. The hyphen-form measure-history-archive.ndjson is NOT part of this set (see NOTE
// at archivePathFor): unsealed, so unpriced.
export function readHistoryRows(ledgerPath = DEFAULT_LEDGER) {
  const archPath = archivePathFor(ledgerPath);
  const text = (existsSync(archPath) ? readFileSync(archPath, 'utf8') : '')
    + (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '');
  return text.split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// THE ONE DOOR for appending a priced row. Appends, rotates overflow into the archive
// (append-only — history only grows), and re-seals in the same call so the attestation can
// never lag the ledger. Bounded + deterministic: safe inline in hooks (no model, no network).
export function appendPricedRow(line, ledgerPath = DEFAULT_LEDGER, { cap = 200 } = {}) {
  const prev = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    : [];
  prev.push(String(line).replace(/\n+$/, ''));
  const overflow = prev.length > cap ? prev.slice(0, prev.length - cap) : [];
  const keep = prev.slice(-cap);
  if (overflow.length) {
    const archPath = archivePathFor(ledgerPath);
    const arch = existsSync(archPath) ? readFileSync(archPath, 'utf8') : '';
    writeFileSync(archPath, arch + overflow.join('\n') + '\n');
  }
  writeFileSync(ledgerPath, keep.join('\n') + '\n');
  fireDeltaOnLanding(line, ledgerPath);   // C516: the commit row this walk belongs to may already be taped "not yet"
  return attestLedger(ledgerPath);
}

// Seal the ledger: compute the root, sign it as a receipt, write the detached attestation.
// `at` (ISO timestamp) is provenance only and does NOT enter the root, so the root is stable
// across re-seals of an unchanged ledger.
export function attestLedger(ledgerPath = DEFAULT_LEDGER, { at } = {}) {
  // the writer's seal reads the current ledger through the leaf cache; verifyLedger recomputes from the raw bytes
  const archiveLeaves = ledgerLeavesFromFile(archivePathFor(ledgerPath));
  const currentLeaves = ledgerLeavesIncremental(ledgerPath);
  const root = attestationRoot([...archiveLeaves, ...currentLeaves]), count = archiveLeaves.length + currentLeaves.length;
  const currentCount = currentLeaves.length, archiveCount = archiveLeaves.length;
  const sealed = sealReceipt({
    kind: 'pmu-ledger-attestation',
    ledger: ledgerPath.replace(REPO + '/', ''),
    algo: 'sha256-merkle/ed25519',
    count,
    current_count: currentCount,
    archive_count: archiveCount,
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

  const { root: currentRoot, count } = computeHistoryRoot(ledgerPath);
  if (currentRoot !== att.root) {
    return { ok: false, reason: 'ROOT MISMATCH — priced history bytes changed outside the sealed writer path (a row altered, inserted, or removed without re-seal)',
      sealedRoot: att.root, currentRoot, count };
  }
  return { ok: true, sealedRoot: att.root, currentRoot, count, pubkey_hex: att.pubkey_hex };
}

// ── R7 — THE COUNTERSIGN RUNG (2026-08-09, ratchet doc DP-2). The host seal is tamper-evident
// but the host holds the key; a second key signing the SAME root + attestation hash makes a
// silent edit-and-reseal require collusion, not just possession. A countersign binds to one
// specific seal (its sha256) — every legitimate append re-seals and the countersign goes stale
// by design, exactly like an auditor's signature on one closing statement: it attests a
// point-in-time, never a moving window. Stale ≠ invalid; it is reported as binding an earlier
// seal. Countersigns live in a SIDECAR (the sealed attestation is never mutated — same rule as
// attest-countersign.mjs: appending keys onto a sealed body would break the seal it endorses).
const countersignPathFor = (ledger) => attestationPathFor(ledger).replace(/\.json$/, '') + '.countersigns.json';

export function countersignLedger(name = 'auditor', ledgerPath = DEFAULT_LEDGER) {
  const attPath = attestationPathFor(ledgerPath);
  if (!existsSync(attPath)) throw new Error('no attestation to countersign — seal the ledger first');
  const att = JSON.parse(readFileSync(attPath, 'utf8'));
  const seal = verifyReceipt(att);
  if (!seal.ok) throw new Error(`refusing to countersign an invalid seal: ${seal.reason}`);
  const { root } = computeHistoryRoot(ledgerPath);
  if (root !== att.root) throw new Error('refusing to countersign a stale seal — the ledger moved; re-seal first');
  const endorsement = sealReceiptAs({
    kind: 'pmu-ledger-countersign',
    by: name,
    countersigns_sha256: att.sha256,
    root: att.root,
    count: att.count,
  }, actorIdentity(name));
  const csPath = countersignPathFor(ledgerPath);
  const prev = existsSync(csPath) ? JSON.parse(readFileSync(csPath, 'utf8')) : [];
  prev.push(endorsement);
  writeFileSync(csPath, JSON.stringify(prev, null, 2) + '\n');
  return { path: csPath, endorsement };
}

// Verify every countersign: authentic signature AND binds the CURRENT seal (same attestation
// sha + same root). Countersigns of superseded seals report ok:false with reason 'stale'.
export function verifyCountersigns(ledgerPath = DEFAULT_LEDGER) {
  const attPath = attestationPathFor(ledgerPath);
  const csPath = countersignPathFor(ledgerPath);
  if (!existsSync(csPath)) return { ok: false, reason: 'no countersigns', countersigns: [] };
  if (!existsSync(attPath)) return { ok: false, reason: 'no attestation', countersigns: [] };
  const att = JSON.parse(readFileSync(attPath, 'utf8'));
  const countersigns = JSON.parse(readFileSync(csPath, 'utf8')).map((e) => {
    const v = verifyReceipt(e);
    const binds = e.countersigns_sha256 === att.sha256 && e.root === att.root;
    return {
      by: e.by, pubkey_hex: e.pubkey_hex,
      ok: !!v.ok && binds,
      reason: !v.ok ? `signature invalid: ${v.reason}` : !binds ? 'stale — countersigns a superseded seal' : null,
    };
  });
  return { ok: countersigns.some((e) => e.ok), countersigns };
}

// ── R8-PREPARATION (2026-08-09). The on-chain anchor (contracts/ReefAttestation.sol `anchor()`)
// is custody-gated: WHO submits is DP-2b, an operator decision. What is NOT custody-gated is the
// payload itself — deriving the exact calldata tuple from the sealed attestation is a pure
// function, so it ships now and the eventual submitter (whoever DP-2b names) signs and sends a
// byte-checkable record rather than composing one ad hoc. Field mapping, stated because the
// contract is receipt-shaped and this anchors a LEDGER seal: receiptId = the attestation's
// canonical-body sha (unique per seal) · reefCommitment = the Merkle root over the priced
// multiset · payloadSha = that same root (the payload IS the ledger) · bodyHash = the body sha ·
// sigmaMilli = 0 (a ledger seal has no σ) · verdict = 0 (IN_LANE; a seal that verifies is
// in-lane by construction — an unverifiable seal never reaches anchoring).
export function anchorPayload(ledgerPath = DEFAULT_LEDGER) {
  const attPath = attestationPathFor(ledgerPath);
  if (!existsSync(attPath)) throw new Error('no attestation — seal the ledger first');
  const att = JSON.parse(readFileSync(attPath, 'utf8'));
  const seal = verifyReceipt(att);
  if (!seal.ok) throw new Error(`refusing to derive an anchor for an invalid seal: ${seal.reason}`);
  const { root } = computeHistoryRoot(ledgerPath);
  if (root !== att.root) throw new Error('attestation is stale — re-seal before deriving the anchor');
  return {
    contract: 'ReefAttestation.anchor',
    receiptId: '0x' + att.sha256,
    reefCommitment: '0x' + att.root,
    payloadSha: '0x' + att.root,
    bodyHash: '0x' + att.sha256,
    sigmaMilli: 0,
    verdict: 0,
    hostPubKey: '0x' + att.pubkey_hex,
    hostSignature: '0x' + att.sig_hex,
    note: 'DERIVED, NOT SUBMITTED — submission is custody-gated (ratchet DP-2b)',
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // positional ledger path — skipping the value that belongs to --countersign <name>
  const csIdx = process.argv.indexOf('--countersign');
  const ledgerArg = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && i !== csIdx + 1) || DEFAULT_LEDGER;
  const asJson = process.argv.includes('--json');

  if (process.argv.includes('--anchor-payload')) {
    console.log(JSON.stringify(anchorPayload(ledgerArg), null, 2));
    process.exit(0);
  }

  if (process.argv.includes('--countersign')) {
    const i = process.argv.indexOf('--countersign');
    const name = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[i + 1] : 'auditor';
    const r = countersignLedger(name, ledgerArg);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
    console.log(`\n  ✍️  COUNTERSIGNED by "${name}" — root ${r.endorsement.root.slice(0, 16)}…`);
    console.log(`     second key ${r.endorsement.pubkey_hex.slice(0, 16)}… over the same seal → ${r.path.replace(REPO + '/', '')}\n`);
    process.exit(0);
  }

  if (process.argv.includes('--circle')) {
    const seal = verifyLedger(ledgerArg);
    const cs = verifyCountersigns(ledgerArg);
    const out = { seal, countersigns: cs };
    if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(seal.ok && cs.ok ? 0 : 1); }
    console.log(`\n  seal          ${seal.ok ? '✅ verified' : '❌ ' + seal.reason}`);
    for (const e of cs.countersigns) console.log(`  countersign   ${e.ok ? '✅' : '❌'} ${e.by} (${String(e.pubkey_hex).slice(0, 12)}…)${e.reason ? ' — ' + e.reason : ''}`);
    if (!cs.countersigns.length) console.log(`  countersign   — none (${cs.reason})`);
    console.log('');
    process.exit(seal.ok && cs.ok ? 0 : 1);
  }

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
