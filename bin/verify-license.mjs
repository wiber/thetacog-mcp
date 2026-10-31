#!/usr/bin/env node
// verify-license.mjs — check a ThetaDriven licence tape OFFLINE.
// ─────────────────────────────────────────────────────────────────────────────
// This is the whole point of an append-only, signed tape: you do not have to trust
// ThetaDriven, our servers, or our application code. You are handed the rows and you
// check them yourself, on your machine, with no network call to anyone.
//
// What it verifies:
//   1. every event's ed25519 signature against the public key embedded in that event
//   2. the hash chain — each event's prev_sha equals the previous event's sha256
//   3. that every event was signed by the SAME authority key (a mid-tape signer swap
//      is exactly what a forged segment looks like)
//   4. optionally, that a specific licence's public key appears as minted
//
// Usage:
//   npx thetacog verify-license --tape tape.json
//   npx thetacog verify-license --tape tape.json --license lic_ab12…
//   npx thetacog verify-license --tape tape.json --authority <pubkey_hex>   # pin the signer
//   cat tape.json | npx thetacog verify-license
//
// The tape file is a JSON array of events, or NDJSON (one event per line). Get yours
// from the holder, from us, or from the published redacted tape — the check is the
// same either way, which is the property that makes it worth running.
//
// Exit 0 = verified. Exit 1 = something failed, and it says exactly what.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

if (has('--help') || has('-h')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n')
    .filter(l => l.startsWith('//')).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

// The canonical signed body = the event MINUS its three envelope fields, re-serialized
// in insertion order. The signer appends the envelope LAST, and JSON preserves key
// order through stringify → parse, so this reproduces the exact bytes that were signed.
function canonicalBody(ev) {
  const rest = { ...ev };
  delete rest.pubkey_hex; delete rest.sig_hex; delete rest.sha256;
  return JSON.stringify(rest);
}

function verifyOne(ev) {
  const body = canonicalBody(ev);
  if (sha256Hex(body) !== ev.sha256) return 'sha256 mismatch — the body was altered after signing';
  try {
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(ev.pubkey_hex, 'hex').toString('base64url') },
      format: 'jwk',
    });
    if (!edVerify(null, Buffer.from(body), publicKey, Buffer.from(ev.sig_hex, 'hex'))) {
      return 'signature does not verify against the embedded public key';
    }
  } catch (e) {
    return `malformed key or signature: ${e.message}`;
  }
  return null;
}

// ── load ────────────────────────────────────────────────────────────────────
function loadTape() {
  const path = arg('--tape');
  const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) { console.error('✗ empty tape'); process.exit(1); }
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  // NDJSON — also accepts Supabase's {body:{...}} row shape
  return trimmed.split('\n').filter(Boolean).map(l => {
    const row = JSON.parse(l);
    return row.body && row.sha256 ? row.body : row;
  });
}

let events;
try { events = loadTape(); }
catch (e) { console.error(`✗ could not read tape: ${e.message}`); process.exit(1); }

if (!Array.isArray(events) || !events.length) {
  console.error('✗ tape is not a non-empty array of events');
  process.exit(1);
}

// Unwrap DB rows that nest the signed event under `body`.
events = events.map(e => (e.body && e.body.sha256 ? e.body : e));
events.sort((a, b) => Number(a.seq) - Number(b.seq));

// ── verify ──────────────────────────────────────────────────────────────────
const failures = [];
let expectedPrev = null;
const signers = new Set();

for (const ev of events) {
  const sigErr = verifyOne(ev);
  if (sigErr) failures.push(`seq ${ev.seq}: ${sigErr}`);
  signers.add(ev.pubkey_hex);

  if (expectedPrev !== null && ev.prev_sha !== expectedPrev) {
    failures.push(
      `seq ${ev.seq}: chain break — declares prev ${String(ev.prev_sha).slice(0, 12)}… ` +
      `but the previous event hashes to ${expectedPrev.slice(0, 12)}… ` +
      `(an event was removed, reordered, or inserted)`
    );
  } else if (expectedPrev === null && ev.prev_sha !== 'genesis' && !has('--segment')) {
    failures.push(
      `seq ${ev.seq}: this tape does not start at genesis. If you were given a SEGMENT ` +
      `rather than the whole tape, re-run with --segment to skip this check.`
    );
  }
  expectedPrev = ev.sha256;
}

if (signers.size > 1 && !has('--allow-signer-change')) {
  failures.push(
    `${signers.size} different authority keys signed this tape. A legitimate key rotation is ` +
    `possible but must be expected — re-run with --allow-signer-change if you know about it.`
  );
}

const pinned = arg('--authority');
if (pinned && !signers.has(pinned)) {
  failures.push(`no event was signed by the pinned authority key ${pinned.slice(0, 16)}…`);
}

const wanted = arg('--license');
let licenceLine = '';
if (wanted) {
  const minted = events.find(e => e.license_id === wanted && e.type === 'LICENSE_MINTED');
  const revoked = events.find(e => e.license_id === wanted && e.type === 'LICENSE_REVOKED');
  if (!minted) failures.push(`licence ${wanted} was never minted on this tape`);
  else if (revoked) failures.push(`licence ${wanted} was REVOKED at seq ${revoked.seq} (${revoked.ts})`);
  else licenceLine =
    `\n  licence ${wanted}\n    minted    ${minted.ts}\n    agent-yrs ${minted.agent_years}` +
    `\n    pubkey    ${minted.license_pubkey_hex}`;
}

// ── report ──────────────────────────────────────────────────────────────────
const authority = [...signers][0] || '(none)';
if (failures.length) {
  console.error(`\n✗ TAPE FAILED — ${failures.length} problem${failures.length === 1 ? '' : 's'} in ${events.length} events\n`);
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nA failure here means the record you were given is not the record that was signed.\n');
  process.exit(1);
}

const minted = events.filter(e => e.type === 'LICENSE_MINTED');
const revoked = events.filter(e => e.type === 'LICENSE_REVOKED');
const agentYears = minted.reduce((n, e) => n + (e.agent_years || 0), 0)
                 - revoked.reduce((n, e) => n + (e.agent_years || 0), 0);

console.log(`
✓ TAPE VERIFIED — ${events.length} events, chain intact, every signature checks out

  authority     ${authority}
  span          seq ${events[0].seq} → ${events[events.length - 1].seq}
  first / last  ${events[0].ts} → ${events[events.length - 1].ts}
  licences      ${minted.length} minted${revoked.length ? `, ${revoked.length} revoked` : ''}
  agent-years   ${agentYears} active${licenceLine}

  Verified locally. No network call was made and nothing here relied on trusting
  ThetaDriven — only on the signatures and hashes in the file you supplied.
`);
process.exit(0);
