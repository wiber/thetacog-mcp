#!/usr/bin/env node
// scripts/pmu/agent-years.mjs — THE KEYFILE. N agent-years as N sequential keys.
// ─────────────────────────────────────────────────────────────────────────────
// The operator's spec, verbatim: "A txt file with a hundred keys is fine if they are in
// sequence and skip to the next key in order when used up."
//
// That is the right shape and it makes the unit honest. An agent-year is not a metering
// abstraction to be reconciled later — it IS a key. You bought a hundred, you get a
// hundred lines, you burn them in order, and when the file is empty you have run out.
// Nobody has to trust our count because the count is the file.
//
// WHY DERIVED RATHER THAN RANDOM: every key here is `agentIdentity(licenceSeed, agent_id)`
// with agent_id = "<license_id>#0001".."#N" — the HKDF already shipped in
// src/lib/license/signing.ts. So the keyfile is REPRODUCIBLE from the licence seed alone.
// Lose it and you re-derive it; you never need us to re-issue, and we never store it.
//
// THE GITIGNORE CONTRACT, and it is the whole security model at this layer:
//   .thetacog/agent-years.txt      PRIVATE KEYS   → gitignored, never committed, never sent
//   .thetacog/agent-years.cursor   which key is live → gitignored
//   tape/attestations/*.json       SIGNED RECEIPTS + PUBLIC keys → committed and published
// The private half stays in the fork's working tree. The public half is the product.
// `init` writes the .gitignore lines itself rather than trusting anyone to remember.
//
//   node scripts/pmu/agent-years.mjs issue --license <id> --seed <hex> --count 100
//   node scripts/pmu/agent-years.mjs next            # the current unspent key, binds it
//   node scripts/pmu/agent-years.mjs status          # how many left
//   node scripts/pmu/agent-years.mjs burn            # spend the current key, advance
//
// Exit 3 specifically means EXHAUSTED — the caller is out of agent-years and should be
// told to buy more rather than shown a stack trace.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { hkdfSync, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';

const CWD = process.cwd();
const DIR = resolve(CWD, '.thetacog');
const KEYFILE = join(DIR, 'agent-years.txt');
const CURSOR = join(DIR, 'agent-years.cursor');
const GITIGNORE = resolve(CWD, '.gitignore');

// Mirrors src/lib/license/signing.ts. Kept literal rather than imported because this runs
// in a customer's fork where the TypeScript source does not exist.
const AGENT_HKDF_SALT = 'thetadriven-agent-v1';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function identityFromSeed(seed32) {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed32]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv);
  const spki = pub.export({ format: 'der', type: 'spki' });
  return { priv, seed_hex: seed32.toString('hex'), pubkey_hex: spki.subarray(SPKI_ED25519_PREFIX.length).toString('hex') };
}

function agentIdentity(licenseSeedHex, agent_id) {
  if (!/^[0-9a-f]{64}$/i.test(licenseSeedHex || '')) throw new Error('need the 32-byte licence seed as hex');
  const seed = Buffer.from(hkdfSync('sha256', Buffer.from(licenseSeedHex, 'hex'), Buffer.from(AGENT_HKDF_SALT), Buffer.from(agent_id), 32));
  return identityFromSeed(seed);
}

const arg = (f, d = '') => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const cmd = process.argv[2];

function ensureGitignored() {
  const lines = ['.thetacog/agent-years.txt', '.thetacog/agent-years.cursor'];
  let gi = existsSync(GITIGNORE) ? readFileSync(GITIGNORE, 'utf8') : '';
  const missing = lines.filter(l => !gi.split('\n').some(x => x.trim() === l));
  if (!missing.length) return false;
  gi += (gi.endsWith('\n') || gi === '' ? '' : '\n') +
    '\n# Agent-year private keys. NEVER commit these — the public half goes in tape/ instead.\n' +
    missing.join('\n') + '\n';
  writeFileSync(GITIGNORE, gi);
  return true;
}

function readKeys() {
  if (!existsSync(KEYFILE)) { console.error('no keyfile. run: agent-years.mjs issue --license <id> --seed <hex> --count N'); process.exit(2); }
  return readFileSync(KEYFILE, 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const [seq, agent_id, seed_hex, pubkey_hex] = l.trim().split(/\s+/); return { seq: Number(seq), agent_id, seed_hex, pubkey_hex }; });
}
const readCursor = () => (existsSync(CURSOR) ? Number(readFileSync(CURSOR, 'utf8').trim()) : 1);

if (cmd === 'issue') {
  const license = arg('license'), seed = arg('seed'), count = Number(arg('count', '0'));
  if (!license || !seed || !count) { console.error('usage: issue --license <id> --seed <hex> --count <n>'); process.exit(2); }
  mkdirSync(DIR, { recursive: true });
  const width = String(count).length < 4 ? 4 : String(count).length;
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const agent_id = `${license}#${String(i).padStart(width, '0')}`;
    const id = agentIdentity(seed, agent_id);
    rows.push(`${String(i).padStart(width, '0')}  ${agent_id}  ${id.seed_hex}  ${id.pubkey_hex}`);
  }
  writeFileSync(KEYFILE,
    `# ${count} agent-years for licence ${license}\n` +
    `# SEQ  AGENT_ID  PRIVATE_SEED_HEX  PUBLIC_KEY_HEX\n` +
    `# Burned in order. Re-derivable from the licence seed alone — we do not store these.\n` +
    `# PRIVATE. This file is gitignored. Publish tape/attestations/, never this.\n` +
    rows.join('\n') + '\n', { mode: 0o600 });
  writeFileSync(CURSOR, '1\n');
  const added = ensureGitignored();
  console.log(`issued ${count} agent-years → ${KEYFILE} (mode 0600)`);
  console.log(added ? 'added the private keyfile to .gitignore' : '.gitignore already covers it');
  console.log(`cursor at 1. next: node scripts/pmu/agent-years.mjs next`);
} else if (cmd === 'status') {
  const keys = readKeys(), cur = readCursor();
  const left = keys.length - cur + 1;
  console.log(`licence agent-years: ${keys.length} issued · ${Math.max(0, cur - 1)} burned · ${Math.max(0, left)} remaining`);
  if (left <= 0) { console.log('EXHAUSTED — buy more agent-years to run another agent.'); process.exit(3); }
  console.log(`current: ${keys[cur - 1].agent_id}`);
} else if (cmd === 'next') {
  const keys = readKeys(), cur = readCursor();
  if (cur > keys.length) { console.error('EXHAUSTED — no agent-years remaining.'); process.exit(3); }
  const k = keys[cur - 1];
  console.log(JSON.stringify({ seq: k.seq, agent_id: k.agent_id, pubkey_hex: k.pubkey_hex, seed_hex: k.seed_hex }));
} else if (cmd === 'burn') {
  const keys = readKeys(), cur = readCursor();
  if (cur > keys.length) { console.error('EXHAUSTED'); process.exit(3); }
  writeFileSync(CURSOR, `${cur + 1}\n`);
  console.log(`burned ${keys[cur - 1].agent_id} · ${keys.length - cur} remaining`);
  if (keys.length - cur === 0) console.log('that was the last one.');
} else if (cmd === 'sign') {
  // Sign a receipt body with the CURRENT agent-year key and emit a publishable attestation.
  const keys = readKeys(), cur = readCursor();
  if (cur > keys.length) { console.error('EXHAUSTED — cannot sign, no agent-years remaining.'); process.exit(3); }
  const k = keys[cur - 1];
  const bodyPath = arg('body');
  if (!bodyPath || !existsSync(bodyPath)) { console.error('usage: sign --body <receipt.json> [--out tape/attestations]'); process.exit(2); }
  const body = readFileSync(bodyPath, 'utf8');
  const id = identityFromSeed(Buffer.from(k.seed_hex, 'hex'));
  const sig_hex = edSign(null, Buffer.from(body), id.priv).toString('hex');
  const att = { agent_id: k.agent_id, seq: k.seq, pubkey_hex: k.pubkey_hex, sig_hex, body };
  const outDir = resolve(CWD, arg('out', 'tape/attestations'));
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${k.agent_id.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(att, null, 2));
  appendFileSync(join(outDir, 'MANIFEST.ndjson'), JSON.stringify({ file: out.split('/').pop(), agent_id: k.agent_id, pubkey_hex: k.pubkey_hex }) + '\n');
  console.log(`signed by ${k.agent_id} → ${out}`);
  console.log('COMMIT tape/attestations/. The keyfile stays gitignored.');
} else if (cmd === 'verify') {
  // THE INSURER SIDE. Runs server-side, needs no secret, and never phones home.
  // Point it at a directory of published attestations — a git clone, a fetch, a mounted
  // volume — and it re-checks every signature against the public key carried in the file.
  //   node agent-years.mjs verify --dir tape/attestations
  const dir = resolve(CWD, arg('dir', 'tape/attestations'));
  if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); process.exit(2); }
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  if (!files.length) { console.error('no attestations found'); process.exit(2); }
  let ok = 0, bad = 0;
  const seen = new Set();
  for (const f of files) {
    let a;
    try { a = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { console.log(`  UNREADABLE  ${f}`); bad++; continue; }
    if (!a.pubkey_hex || !a.sig_hex || typeof a.body !== 'string') { console.log(`  MALFORMED   ${f}`); bad++; continue; }
    const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(a.pubkey_hex, 'hex')]), format: 'der', type: 'spki' });
    if (edVerify(null, Buffer.from(a.body), pub, Buffer.from(a.sig_hex, 'hex'))) { ok++; seen.add(a.agent_id); }
    else { bad++; console.log(`  BAD SIG     ${f}  (${a.agent_id})`); }
  }
  console.log(`verified ${ok} attestation(s) across ${seen.size} agent-year(s); ${bad} bad`);
  console.log('');
  console.log('Signatures check out, and that is exactly as far as a signature goes. What this');
  console.log('does NOT prove is that the set is complete — omission is invisible to any');
  console.log('signature and always will be. Reconcile the agent-year count against the licence');
  console.log('tape, and make continuous publication a condition of the cover rather than a hope.');
  process.exit(bad ? 1 : 0);
} else {
  console.log('agent-years — N agent-years as N sequential keys, burned in order.\n');
  console.log('  issue --license <id> --seed <hex> --count <n>   derive and write the keyfile');
  console.log('  status                                          how many remain');
  console.log('  next                                            the current unspent key');
  console.log('  burn                                            spend it, advance the cursor');
  console.log('  sign --body <receipt.json>                      sign with the current key');
  console.log('  verify --dir <tape/attestations>                THE INSURER SIDE: check every signature\n');
  console.log('Private keys live in .thetacog/agent-years.txt (gitignored).');
  console.log('Signed attestations go to tape/attestations/ and ARE committed.');
  process.exit(cmd ? 2 : 0);
}
