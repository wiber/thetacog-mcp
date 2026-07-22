#!/usr/bin/env node
// scripts/pmu/attest.mjs — the Node A ↔ Node B transaction attestation.
//
// THE PRODUCT (surest, fastest to market). Everything the strategy transcript
// converged on collapses to one primitive: two parties who don't trust each
// other, one pre-shared reef, one signed verdict both can recompute. No
// blockchain, no settlement layer, no clearinghouse, no third LLM judge.
//
//   Node A  publish-reef   → publishes a SPEC: words + the lattice form
//                            (authorized ShortLex cells), sealed by A's key.
//   Node B  submit         → submits a PAYLOAD (the artifact + description),
//                            "signed by anyone" — B's own ed25519 identity.
//   Oracle  gate           → drives the EXISTING PMU Rust runner
//                            (issue-receipt.mjs --lens gzip → gzip-NCD → 144×144
//                            lattice → ballistic walk) and mints a BOUND receipt
//                            tying {reef · payload · B-pubkey · verdict · σ ·
//                            daemon attestation} together, host-sealed, addressed
//                            to A.
//   Stranger verify        → recomputes the commitment + payload hash, verifies
//                            every seal, and RE-RUNS the Oracle locally: same
//                            verdict, without trusting the issuer. That is Rice
//                            made concrete — software can't legibly verify
//                            software, but this hardware-grounded gate produces a
//                            verdict a stranger reproduces byte-for-byte.
//
// MATCH = IN_ROLE · DRIFT = OFF_DOMAIN · ABSTAIN = UNPLACEABLE.
//
// SECURITY: this touches no funds and no settlement. It signs a verdict. The
// reinsurer/clearinghouse bolts payout onto the verdict downstream — we stay the
// Oracle, never the exchange.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, createReadStream,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  actorIdentity, sealReceiptAs, sealReceipt, verifyReceipt, sha256Hex,
} from './receipt-crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ISSUE_RECEIPT = resolve(REPO_ROOT, 'scripts', 'pmu', 'issue-receipt.mjs');
const DAEMON = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');
const AXIS_LIB = resolve(REPO_ROOT, 'docs/architecture/axis-library-v1.json');
const RECEIPTS_DIR = resolve(homedir(), '.thetacog', 'pmu', 'receipts');

// ── the lattice, made legible ─────────────────────────────────────────────────
// The reef is "two surfaces of one thing": the spec in WORDS and the spec in the
// LATTICE (the authorized ShortLex cells). A1/A2 mean nothing to a human reading
// the receipt — so we gloss each authorized cell from the axis library into a
// plain-English line. A stranger then reads BOTH surfaces and sees they agree:
// the sentence and the coordinates it compiles to. The cells stay authoritative
// (they drive the gate); the gloss is the human-readable rendering, embedded so
// the reef is self-describing without the axis library on hand.
let _axisByRank = null;
function axisByRank() {
  if (_axisByRank) return _axisByRank;
  _axisByRank = {};
  try {
    const lib = JSON.parse(readFileSync(AXIS_LIB, 'utf8'));
    for (const a of (lib.axes || [])) _axisByRank[a.rank] = a;
  } catch { /* axis lib absent — gloss degrades to the bare cell */ }
  return _axisByRank;
}
function latticeGloss(cells) {
  const by = axisByRank();
  return cells.map((c) => {
    const a = by[c];
    return a
      ? { cell: c, reads: `${a.emoji || ''} ${c} · ${a.name} — ${a.question}`.trim() }
      : { cell: c, reads: `${c} (no axis gloss available)` };
  });
}

// ── verdict mapping (the two-party readout of the inner role verdict) ─────────
const INNER_TO_VERDICT = {
  IN_ROLE: 'MATCH',
  OFF_DOMAIN: 'DRIFT',
  UNPLACEABLE: 'ABSTAIN',
};
function verdictFor(inner) { return INNER_TO_VERDICT[inner] ?? 'ABSTAIN'; }

// ── the commitment: spec-in-words + spec-in-lattice, hashed as one ────────────
// The reef is two surfaces of one thing (transcript: "spec in words and a spec
// in a reef"). The commitment binds BOTH so a stranger knows exactly what was
// asked for — they can't be told one spec and shown another.
function reefCommitment({ job_id, spec, authorized_cells }) {
  return sha256Hex(JSON.stringify({
    job_id,
    spec,
    authorized_cells: [...authorized_cells].sort(),
  }));
}

// ── drive the EXISTING PMU Rust runner (do not reinvent) ──────────────────────
// Mirrors packages/thetacog-agent/gate.mjs: pipe payload to issue-receipt over
// stdin, capture the host-signed gzip-lens receipt it prints. The Rust daemon
// does the gzip-NCD sense + 144×144 projection + ballistic walk underneath.
function runOracleGate(payloadText, authorizedCells, { threshold } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!existsSync(ISSUE_RECEIPT)) {
      reject(new Error(`gate not found at ${ISSUE_RECEIPT}`));
      return;
    }
    const args = [
      ISSUE_RECEIPT,
      '--job-id', 'attest-gate',
      '--authorized', authorizedCells.join(','),
      '--lens', 'gzip',
      '--stdin',
    ];
    if (threshold != null) args.push('--threshold', String(threshold));

    const t0 = process.hrtime.bigint();
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (l) => out.push(l));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const elapsed_ms = Number(process.hrtime.bigint() - t0) / 1e6;
      let receipt = parseReceipt(out.join('\n'));
      if (!receipt) receipt = readNewestReceiptFile();
      if (!receipt) {
        reject(new Error(`no receipt captured (exit ${code}). stderr:\n${Buffer.concat(err).toString() || '(empty)'}`));
        return;
      }
      const w = receipt.physical_execution?.witness_simhash ?? {};
      resolvePromise({
        inner_verdict: receipt.verdict ?? null,
        authoritative_cell: receipt.authoritative_cell ?? null,
        agreement: receipt.agreement ?? null,
        gzip_cell: w.gzip_cell ?? null,
        gzip_sigma: typeof w.gzip_sigma === 'number' ? w.gzip_sigma : (typeof w.sigma === 'number' ? w.sigma : null),
        ncd_margin: typeof w.ncd_margin === 'number' ? w.ncd_margin : null,
        inner_receipt_id: receipt.receipt_id ?? null,
        host_pub_key: receipt.host_pub_key ?? null,
        elapsed_ms,
      });
    });
    child.stdin.write(payloadText);
    child.stdin.end();
  });
}

function parseReceipt(stdout) {
  const t = (stdout || '').trim();
  if (!t) return null;
  try { const o = JSON.parse(t); if (o && o.receipt_id && o.verdict) return o; } catch { /* scan */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s !== -1 && e > s) { try { const o = JSON.parse(t.slice(s, e + 1)); if (o && o.receipt_id) return o; } catch { /* give up */ } }
  return null;
}
function readNewestReceiptFile() {
  try {
    if (!existsSync(RECEIPTS_DIR)) return null;
    const files = readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith('.json'));
    let newest = null; let m = 0;
    for (const f of files) { const p = resolve(RECEIPTS_DIR, f); const mt = statSync(p).mtimeMs; if (mt > m) { m = mt; newest = p; } }
    return newest ? JSON.parse(readFileSync(newest, 'utf8')) : null;
  } catch { return null; }
}

// The daemon binary's own hash — the silicon attestation stub. A stranger
// confirms the SAME gate binary produced the verdict (in production this is the
// Secure-Enclave / tape-out key; here it is the binary digest).
function daemonAttestation() {
  let daemon_sha256 = null;
  try { if (existsSync(DAEMON)) daemon_sha256 = sha256Hex(readFileSync(DAEMON)); } catch { /* absent */ }
  return {
    daemon_sha256,
    daemon_present: !!daemon_sha256,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
}

// ── arg parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--job-id') o.jobId = argv[++i];
    else if (a === '--authorized') o.authorized = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--spec') o.spec = argv[++i];
    else if (a === '--spec-file') o.specFile = argv[++i];
    else if (a === '--payload') o.payload = argv[++i];
    else if (a === '--payload-file') o.payloadFile = argv[++i];
    else if (a === '--reef') o.reef = argv[++i];
    else if (a === '--receipt') o.receipt = argv[++i];
    else if (a === '--as') o.as = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--threshold') o.threshold = Number(argv[++i]);
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (!a.startsWith('--')) o._.push(a);
  }
  return o;
}
function readText({ inline, file }) {
  if (inline != null) return inline;
  if (file) return readFileSync(file, 'utf8');
  return null;
}
function usage() {
  console.error(`thetacog-mcp attest — Node A ↔ Node B verdict attestation

  publish-reef  --job-id <id> --authorized A,A1,B2 (--spec "<text>" | --spec-file F) [--as node-a] [--out reef.json]
  submit        --reef reef.json (--payload "<text>" | --payload-file F) [--as node-b] [--out payload.json]
  gate          --reef reef.json --payload payload.json [--threshold N] [--out receipt.json]
  verify        --receipt receipt.json --reef reef.json --payload payload.json [--threshold N]

MATCH = stayed in lane · DRIFT = out of lane · ABSTAIN = the gate refuses to flatter.`);
  process.exit(2);
}

// ── verbs ─────────────────────────────────────────────────────────────────────
function cmdPublishReef(a) {
  if (!a.jobId || !a.authorized) usage();
  const spec = readText({ inline: a.spec, file: a.specFile });
  if (spec == null) { console.error('publish-reef needs --spec or --spec-file'); process.exit(2); }
  const id = actorIdentity(a.as || 'node-a');
  const body = {
    artifact: 'thetacog-reef',
    job_id: a.jobId,
    // surface 1 — the spec in human words
    spec,
    // surface 2 — the spec in the lattice (authoritative; drives the gate)
    authorized_cells: a.authorized,
    // surface 2, made legible — the same lattice rendered in plain English
    authorized_lattice: latticeGloss(a.authorized),
    reef_commitment: reefCommitment({ job_id: a.jobId, spec, authorized_cells: a.authorized }),
    published_by: { name: id.name, pubkey_hex: id.pubkey_hex },
  };
  const reef = sealReceiptAs(body, id);
  const out = a.out || `reef-${a.jobId}.json`;
  writeFileSync(out, JSON.stringify(reef, null, 2));
  if (!a.quiet) {
    console.log(`📋 Reef published by ${id.name} → ${out}`);
    console.log(`   job_id        ${reef.job_id}`);
    console.log(`   spec (words)  "${spec.length > 64 ? spec.slice(0, 64) + '…' : spec}"`);
    console.log(`   spec (lattice, legible):`);
    for (const g of reef.authorized_lattice) console.log(`        ${g.reads}`);
    console.log(`   commitment    ${reef.reef_commitment.slice(0, 24)}…  (binds words + cells as one)`);
    console.log(`   sealed_by     ${id.pubkey_hex.slice(0, 24)}…`);
  }
  return reef;
}

function cmdSubmit(a) {
  if (!a.reef) usage();
  const reef = JSON.parse(readFileSync(a.reef, 'utf8'));
  const payload = readText({ inline: a.payload, file: a.payloadFile });
  if (payload == null) { console.error('submit needs --payload or --payload-file'); process.exit(2); }
  const id = actorIdentity(a.as || 'node-b');
  const body = {
    artifact: 'thetacog-payload',
    job_id: reef.job_id,
    // echoes WHAT this payload answers — binds the payload to A's reef.
    reef_commitment: reef.reef_commitment,
    payload,
    payload_sha256: sha256Hex(payload),
    submitted_by: { name: id.name, pubkey_hex: id.pubkey_hex },
  };
  const sealed = sealReceiptAs(body, id);
  const out = a.out || `payload-${reef.job_id}.json`;
  writeFileSync(out, JSON.stringify(sealed, null, 2));
  if (!a.quiet) {
    console.log(`📦 Payload submitted by ${id.name} → ${out}`);
    console.log(`   answers reef  ${reef.reef_commitment.slice(0, 24)}…`);
    console.log(`   payload_sha   ${sealed.payload_sha256.slice(0, 24)}…`);
    console.log(`   signed_by     ${id.pubkey_hex.slice(0, 24)}…  (anyone can be Node B)`);
  }
  return sealed;
}

async function cmdGate(a) {
  if (!a.reef || !a.payload) usage();
  const reef = JSON.parse(readFileSync(a.reef, 'utf8'));
  const payloadDoc = JSON.parse(readFileSync(a.payload, 'utf8'));

  // bind-check before we even sense: the payload must answer THIS reef.
  if (payloadDoc.reef_commitment !== reef.reef_commitment) {
    console.error(`✗ payload answers a different reef (${payloadDoc.reef_commitment?.slice(0, 16)}… ≠ ${reef.reef_commitment.slice(0, 16)}…)`);
    process.exit(2);
  }

  const g = await runOracleGate(payloadDoc.payload, reef.authorized_cells, { threshold: a.threshold });
  const verdict = verdictFor(g.inner_verdict);

  const body = {
    artifact: 'thetacog-attestation-receipt',
    receipt_kind: 'two-party-attestation',
    job_id: reef.job_id,
    // what was asked / what was evaluated / who produced it (the legible triple)
    reef_commitment: reef.reef_commitment,
    payload_sha256: payloadDoc.payload_sha256,
    submitter_pubkey: payloadDoc.submitted_by?.pubkey_hex ?? null,
    addressed_to: reef.published_by?.pubkey_hex ?? null,
    authorized_cells: reef.authorized_cells,
    // the verdict and the gzip-bridge signature that produced it
    verdict,
    inner_verdict: g.inner_verdict,
    authoritative_cell: g.authoritative_cell,
    gzip_witness: { cell: g.gzip_cell, sigma: g.gzip_sigma, ncd_margin: g.ncd_margin, agreement: g.agreement },
    threshold: a.threshold ?? null,
    // the hardware attestation (PMU stamp) + the inner host receipt it wraps
    host_attestation: { ...daemonAttestation(), gate_ms: g.elapsed_ms },
    inner_receipt_id: g.inner_receipt_id,
    oracle: 'thetacog pmu gzip-NCD → 144×144 lattice → ballistic walk',
  };
  const receipt = sealReceipt(body); // sealed by the HOST key (this silicon)
  const out = a.out || `receipt-${reef.job_id}.json`;
  writeFileSync(out, JSON.stringify(receipt, null, 2));

  const glyph = verdict === 'MATCH' ? '✅' : verdict === 'DRIFT' ? '🚫' : '⚖️';
  if (!a.quiet) {
    console.log(`${glyph} VERDICT: ${verdict}  (${g.inner_verdict})  → ${out}`);
    console.log(`   cell ${g.authoritative_cell ?? g.gzip_cell} ${verdict === 'MATCH' ? '∈' : '∉'} {${reef.authorized_cells.join(', ')}}   σ_gzip=${g.gzip_sigma?.toFixed(3)}`);
    console.log(`   binds  reef ${reef.reef_commitment.slice(0, 16)}… · payload ${payloadDoc.payload_sha256.slice(0, 16)}… · B ${(body.submitter_pubkey || '').slice(0, 16)}…`);
    console.log(`   daemon ${body.host_attestation.daemon_sha256?.slice(0, 16) ?? '(absent)'}…   gate ${g.elapsed_ms.toFixed(1)}ms   host-sealed ${receipt.pubkey_hex.slice(0, 16)}…`);
    console.log(`   → a stranger runs:  thetacog-mcp attest verify --receipt ${out} --reef ${a.reef} --payload ${a.payload}`);
  }
  if (a.json) console.log(JSON.stringify(receipt, null, 2));
  process.exit(verdict === 'MATCH' ? 0 : verdict === 'DRIFT' ? 1 : 2);
}

// The stranger's recomputation. Trusts NOTHING in the receipt: rebuilds the
// commitment and the payload hash from the raw artifacts, verifies all three
// seals, then RE-RUNS the Oracle locally and checks the verdict reproduces.
async function cmdVerify(a) {
  if (!a.receipt || !a.reef || !a.payload) usage();
  const receipt = JSON.parse(readFileSync(a.receipt, 'utf8'));
  const reef = JSON.parse(readFileSync(a.reef, 'utf8'));
  const payloadDoc = JSON.parse(readFileSync(a.payload, 'utf8'));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); };

  // 1. seals — every party's signature verifies over its own canonical body.
  check('reef seal (Node A)', verifyReceipt(reef).ok, reef.published_by?.name);
  check('payload seal (Node B)', verifyReceipt(payloadDoc).ok, payloadDoc.submitted_by?.name);
  const oracleSeal = verifyReceipt(receipt);
  check('receipt seal (Oracle host)', oracleSeal.ok, oracleSeal.reason || receipt.pubkey_hex?.slice(0, 16) + '…');

  // 2. bindings — the receipt commits to THESE exact artifacts, recomputed.
  const recomputedCommitment = reefCommitment({ job_id: reef.job_id, spec: reef.spec, authorized_cells: reef.authorized_cells });
  check('reef_commitment recomputes', recomputedCommitment === reef.reef_commitment && reef.reef_commitment === receipt.reef_commitment, recomputedCommitment.slice(0, 16) + '…');
  const recomputedPayloadSha = sha256Hex(payloadDoc.payload);
  check('payload_sha256 recomputes', recomputedPayloadSha === payloadDoc.payload_sha256 && payloadDoc.payload_sha256 === receipt.payload_sha256, recomputedPayloadSha.slice(0, 16) + '…');
  check('payload answers this reef', payloadDoc.reef_commitment === reef.reef_commitment, null);

  // 3. THE RICE CHECK — re-run the Oracle on the raw artifacts, on the
  //    stranger's own hardware, and confirm the verdict reproduces. No trust
  //    in the issuer: the substrate itself vouches.
  const g = await runOracleGate(payloadDoc.payload, reef.authorized_cells, { threshold: receipt.threshold ?? a.threshold });
  const recomputedVerdict = verdictFor(g.inner_verdict);
  check('verdict reproduces (re-walk)', recomputedVerdict === receipt.verdict, `${recomputedVerdict} vs ${receipt.verdict}`);
  check('σ reproduces (deterministic gate)', g.gzip_sigma != null && receipt.gzip_witness?.sigma != null && Math.abs(g.gzip_sigma - receipt.gzip_witness.sigma) < 1e-9, `${g.gzip_sigma?.toFixed(6)}`);

  const allOk = checks.every((c) => c.ok);
  if (!a.quiet) {
    const gloss = reef.authorized_lattice || latticeGloss(reef.authorized_cells || []);
    console.log(`🔍 Verifying ${a.receipt} — recomputed on this machine, trusting nothing:\n`);
    console.log(`   Reef asked for (words):   "${reef.spec}"`);
    console.log(`   Reef asked for (lattice): ${gloss.map((g) => g.reads).join(' · ')}\n`);
    for (const c of checks) console.log(`   ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
    console.log(`\n${allOk ? '✅ RECEIPT VERIFIES' : '❌ RECEIPT FAILED'} — verdict: ${receipt.verdict}`);
    if (allOk) console.log(`   The stranger re-ran the gate and got the SAME verdict (${receipt.verdict}) and the SAME σ. That is the thing software cannot do.`);
  }
  if (a.json) console.log(JSON.stringify({ ok: allOk, verdict: receipt.verdict, checks }, null, 2));
  process.exit(allOk ? 0 : 1);
}

// ── dispatch ──────────────────────────────────────────────────────────────────
async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  switch (verb) {
    case 'publish-reef': cmdPublishReef(a); break;
    case 'submit': cmdSubmit(a); break;
    case 'gate': await cmdGate(a); break;
    case 'verify': await cmdVerify(a); break;
    default: usage();
  }
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(3); });
