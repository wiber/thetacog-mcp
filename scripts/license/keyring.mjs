#!/usr/bin/env node
// scripts/license/keyring.mjs — MANY KEY FILES, ONE ORDERED SERIES, ONE SIGNED PUBLIC HALF.
// ─────────────────────────────────────────────────────────────────────────────
// THE PROBLEM THIS SOLVES. A deployer does not hold one licence forever. They buy more
// agent-years, a licence is replaced after a key is lost, an old one expires, a second
// entity in the same org gets its own. So the key directory is a SERIES, not a slot —
// and until now nothing said where it lives, what orders it, or which half of it may
// leave the machine. An app that picks "the key file" out of a directory of five is
// picking by readdir order, which is filesystem order, which is nothing.
//
// THE CONVENTION, and it is the whole point of this file:
//
//   ~/.thetacog/pmu/licenses/                       ← THE KEYRING. Outside every repo.
//     thetadriven-licence-<license_id>.json         ← one per licence. PRIVATE (0600).
//     sample-receipt-<license_id>.json              ← optional, signed demo artifacts
//     public-keyring.json                           ← the PUBLIC half, authority-signed
//
//   ORDER IS BY `minted_at`, ASCENDING — the time the licence was minted, which is a
//   fact about the licence, not about the file. Never mtime: copying a keyring to a new
//   machine rewrites every mtime and would silently reorder the series. Ties break on
//   license_id so the ordering is total and reproducible on any machine.
//
//   THE CURRENT licence is the LAST one in that order whose term has not expired. A new
//   purchase appends; it does not replace. Nothing is ever deleted from a keyring — a
//   revoked licence stays, marked, because a receipt signed under it last March is still
//   a receipt somebody may verify next year and its key must remain resolvable.
//
// WHAT MAY BE PUBLISHED. The public half of a keyring is license_id + pubkey_hex +
// minted_at + agent_years. Never seed_hex, never holder_email. `--publish` writes that
// projection, SIGNED BY THE AUTHORITY, to public/.well-known/thetadriven-licence-keys.json
// so a stranger can fetch the public keys over HTTPS and check a receipt against them
// with no account, no API call, and no trust in the page that served it.
//
// THE SIGNATURE ON THE MANIFEST IS THE POINT. An unsigned list of public keys served over
// HTTPS proves only that whoever controls the domain today served it. Signed by the
// authority key, the same one that signs every tape event, it is checkable against a key
// an auditor already pinned — and a substituted manifest fails that check rather than
// quietly redirecting trust.
//
// Usage:
//   node scripts/license/keyring.mjs                 # list the series, ordered
//   node scripts/license/keyring.mjs --json          # the same, machine-readable
//   node scripts/license/keyring.mjs --current       # just the active licence id
//   node scripts/license/keyring.mjs --publish       # write the signed public manifest
//   node scripts/license/keyring.mjs --dir <path>    # a keyring somewhere else
//
// Guarded by tests/license/keyring.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

// THE KEYRING LIVES IN THE REPO (2026-08-25, operator: "lets move the keys to our repo and
// test the gitignore"). One path instead of two, and it travels with the project. That is only
// safe because .gitignore covers it belt AND braces — the directory, the issuer's filename
// pattern anywhere in the tree, *.priv.pem and *.seed — and tests/license/keys-never-committed.test.mjs
// scans TRACKED files for a real seed_hex rather than trusting any of those path rules.
// The old home-directory keyring remains the fallback so installs made before this date keep working.
export const REPO_DIR = path.resolve(process.cwd(), '.thetacog/pmu/licenses');
export const HOME_DIR = path.resolve(homedir(), '.thetacog/pmu/licenses');
export const DEFAULT_DIR = fs.existsSync(REPO_DIR) ? REPO_DIR : HOME_DIR;
export const PUBLIC_MANIFEST = 'public-keyring.json';
export const WELL_KNOWN = 'public/.well-known/thetadriven-licence-keys.json';

const arg = (f, d = null) => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const has = (f) => process.argv.includes(f);

/**
 * Read every key file in a keyring, ORDERED BY MINTED TIME.
 *
 * A file that does not parse, or that carries no license_id, is REPORTED rather than
 * skipped: a keyring that silently drops a file it could not read is a keyring that
 * loses a licence and says everything is fine.
 */
export function readKeyring(dir = DEFAULT_DIR) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /^thetadriven-licence-.*\.json$/.test(n));
  } catch {
    return { dir, entries: [], unreadable: [], missing: true };
  }

  const entries = [];
  const unreadable = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const o = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!o.license_id || !o.pubkey_hex) {
        unreadable.push({ file: name, reason: 'no license_id/pubkey_hex — not a keyring file' });
        continue;
      }
      entries.push({
        file: name,
        license_id: o.license_id,
        pubkey_hex: o.pubkey_hex,
        // ORDER KEY. A property of the licence, never of the filesystem.
        minted_at: o.minted_at ?? null,
        agent_years: o.agent_years ?? 1,
        purpose: o.purpose ?? null,
        holder_email: o.holder_email ?? null,   // read, never published — see publicHalf()
        has_secret: typeof o.seed_hex === 'string' && o.seed_hex.length === 64,
      });
    } catch (e) {
      unreadable.push({ file: name, reason: e instanceof Error ? e.message.slice(0, 80) : 'unparseable' });
    }
  }

  // ASCENDING BY MINT TIME, ties broken by id so the order is total and machine-independent.
  // A file with no minted_at sorts FIRST and is flagged: undated is older than dated, and
  // guessing "now" for it would make it the current licence, which is the dangerous default.
  entries.sort((a, b) => {
    const at = a.minted_at ? Date.parse(a.minted_at) : -Infinity;
    const bt = b.minted_at ? Date.parse(b.minted_at) : -Infinity;
    if (at !== bt) return at - bt;
    return a.license_id < b.license_id ? -1 : a.license_id > b.license_id ? 1 : 0;
  });

  return { dir, entries, unreadable, missing: false };
}

/**
 * The CURRENT licence: the last minted one that has not expired.
 * Expiry is minted_at + 365 days unless the file records its own term. A keyring whose
 * newest entry has expired returns null rather than falling back to an older live one —
 * "your licence lapsed" and "use the one from two years ago" are different answers.
 */
export function currentLicence(entries, now = Date.now()) {
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  if (!last.minted_at) return { ...last, expired: null, note: 'undated — cannot say whether it is current' };
  const term = (last.term_days ?? 365) * 24 * 60 * 60 * 1000;
  const expired = Date.parse(last.minted_at) + term < now;
  return { ...last, expired };
}

/** THE ONLY FIELDS THAT MAY LEAVE THE MACHINE. Anything not listed here does not travel. */
export function publicHalf(entries) {
  return entries.map((e) => ({
    license_id: e.license_id,
    pubkey_hex: e.pubkey_hex,
    minted_at: e.minted_at,
    agent_years: e.agent_years,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = arg('--dir', DEFAULT_DIR);
  const ring = readKeyring(dir);

  if (has('--publish')) {
    // Sign with the AUTHORITY key through the one signing module — no crypto here.
    const repo = process.cwd();
    const script = [
      `import { sealAs, authorityIdentity } from '${path.join(repo, 'src/lib/license/signing.ts')}';`,
      `const keys = ${JSON.stringify(publicHalf(ring.entries))};`,
      `const body = { v: 1, kind: 'licence-public-keyring', generated_at: new Date().toISOString(),`,
      `  note: 'Public halves only. Ordered by minted_at ascending. Signed by the same authority key that signs every licence tape event, so a substituted manifest fails verification rather than quietly redirecting trust.',`,
      `  verify: 'https://thetadriven.com/verify-receipt', keys };`,
      `console.log(JSON.stringify(sealAs(body, authorityIdentity()), null, 2));`,
    ].join('\n');
    // .env.local carries LICENSE_SIGNING_SEED locally; tsx runs the TS module directly.
    const out = execFileSync('npx', ['tsx', '-e', script], {
      cwd: repo, encoding: 'utf8', maxBuffer: 1 << 24,
      env: { ...process.env, ...loadEnvLocal(repo) },
    });
    const signed = out.slice(out.indexOf('{'));
    fs.writeFileSync(path.join(dir, PUBLIC_MANIFEST), signed);
    fs.mkdirSync(path.dirname(path.join(repo, WELL_KNOWN)), { recursive: true });
    fs.writeFileSync(path.join(repo, WELL_KNOWN), signed);
    console.log(`🔑 signed public keyring → ${path.join(dir, PUBLIC_MANIFEST)}`);
    console.log(`🌐 web-served copy      → ${WELL_KNOWN}  (https://thetadriven.com/.well-known/thetadriven-licence-keys.json)`);
    console.log(`   ${ring.entries.length} licence(s), public halves only — no seed, no holder email.`);
    process.exit(0);
  }

  if (has('--json')) {
    console.log(JSON.stringify({ ...ring, current: currentLicence(ring.entries) }, null, 2));
    process.exit(0);
  }

  if (has('--current')) {
    const c = currentLicence(ring.entries);
    console.log(c ? c.license_id : '');
    process.exit(c ? 0 : 1);
  }

  console.log(`🔑 keyring ${ring.dir}${ring.missing ? ' (does not exist yet)' : ''}`);
  if (!ring.entries.length) console.log('   no licence key files — issue one: npx tsx scripts/license/issue-key.mts --email you@example.com');
  ring.entries.forEach((e, i) => {
    const cur = i === ring.entries.length - 1 ? ' ← current' : '';
    console.log(`   ${String(i + 1).padStart(2)}. ${e.minted_at ?? 'undated'.padEnd(24)}  ${e.license_id}  ${e.agent_years}ay  ${e.has_secret ? 'key present' : 'PUBLIC ONLY'}${cur}`);
    if (e.purpose && /NOT recorded/.test(e.purpose)) console.log(`       ⚠ ${e.purpose}`);
  });
  for (const u of ring.unreadable) console.log(`   ⚠ ${u.file}: ${u.reason}`);
}

/** .env.local, read only to hand LICENSE_SIGNING_SEED to the signing child process. */
function loadEnvLocal(repo) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(repo, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no local env — the child will fail loudly, which is correct */ }
  return out;
}
