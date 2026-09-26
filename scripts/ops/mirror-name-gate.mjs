#!/usr/bin/env node
// scripts/ops/mirror-name-gate.mjs — REFUSE A PUBLIC PUSH THAT CARRIES A THIRD PARTY'S NAME.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// 2026-09-05: the mirror's email scrub was generalised from a fixed marker list to the construct
// ("any address whose domain is not ours"). That closed the ADDRESS hole and left the NAME hole
// wide open, because the reef's vocab bags carry people as bare tokens with no @ to match on:
//     "...finish jane doe acme subject book club next write replying loom email..." (synthetic; the original bag named a real person and this file must pass its own gate)
// Six real third parties were staged for a force-push to a public repo — four in data/pmu JSON,
// two more in .workflow/ room dashboards nobody had noticed were being mirrored at all.
//
// ── THE WATCHLIST IS DERIVED AT RUN TIME AND NEVER COMMITTED ────────────────────────────────
// The names come from .thetacog/email-sent.ndjson in the MONOREPO — who we have actually written
// to. Same pattern as tests/voice/amnesia-ledger.test.mjs, and for the same reason: a check for
// whether real people's names leak must not itself commit a list of real people's names.
//
// ── PERSON-SHAPED MEANS TWO TOKENS, AND THAT IS A MEASURED CHOICE ───────────────────────────
// The first version also matched single tokens of 6+ chars from local parts. It returned 128
// distinct hits over the mirror, topped by "address" (22,260), "verify", "project", "technical" —
// role-account mailboxes, not people. A gate that noisy is a gate that gets switched off. Keeping
// only first.last pairs took it to 14 hits, of which 6 were real third parties and the rest were
// our own name, book characters, and phrases like "semantic drift". Precision is what makes a
// refusal credible.
//
// SUFFICIENT FOR: does a name we have corresponded with appear, as a name, in text staged for
//   publication. NOT SUFFICIENT FOR: a person we have never emailed, a name written differently
//   than their address (Mary Pat vs marypat), or a name rendered as pixels in a screenshot. Those
//   need a human eye, and this gate does not pretend otherwise.
//
// Usage:  node scripts/ops/mirror-name-gate.mjs <mirror-dir>   → exit 0 clean, 4 on a hit
// Guard:  tests/ops/mirror-name-gate.test.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENT = resolve(REPO, '.thetacog/email-sent.ndjson');

// Ours, and deliberate. The book's characters are published on purpose; the author's name is the
// author's. Everything else is somebody who did not agree to appear in a public repository.
export const ALLOWED_NAMES = new Set(['elias moosman']);
// Documentation placeholders that are person-SHAPED and are not people. They arrive because real
// mail carries strings like "redacted@example.com" as an instruction to the reader. Curated and
// short on purpose: every entry here is a hole in the gate, so each one has to be worth it.
export const PLACEHOLDER_PAIRS = new Set([
  'first last', 'your email', 'real person', 'semantic drift', 'john doe', 'jane doe',
  'full name', 'your name',
]);
export const EXEMPT_DIRS = ['books', 'data/book'];   // the book ships; its characters ship with it
// The domains OUR published content may legitimately carry an address at. ONE list: scripts/
// mirror-to-public.sh's address assertion derives its bash ALLOW_DOMAINS from THIS (via
// scripts/ops/print-allow-domains.mjs), and attest-bundle.mjs's scrubReefForPublication imports
// it directly — "ours" is named in exactly one place, never restated per-consumer.
export const ALLOW_EMAIL_DOMAINS = [
  'thetadriven.com', 'example.com', 'users.noreply.github.com', 'anthropic.com',
  'npmjs.com', 'sentry.io', 'schema.org', 'w3.org', 'github.com',
];
export const TEXT_EXT = new Set(['.json', '.md', '.mjs', '.js', '.ts', '.html', '.txt', '.sh', '.toml', '.yml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'panels', 'encircled']);

/** first.last@ is the person-shaped local part. Single tokens are role accounts and are dropped. */
export function namesFromAddresses(addresses) {
  const out = new Set();
  for (const a of addresses) {
    const lp = String(a).toLowerCase().split('@')[0];
    const parts = lp.split(/[._-]/).filter((p) => /^[a-z]{3,}$/.test(p));
    if (parts.length >= 2) out.add(parts.slice(0, 2).join(' '));
  }
  for (const n of ALLOWED_NAMES) out.delete(n);
  for (const n of PLACEHOLDER_PAIRS) out.delete(n);
  return out;
}

export async function watchlist() {
  if (!existsSync(SENT)) return new Set();
  const addrs = new Set();
  const rl = createInterface({ input: createReadStream(SENT), crlfDelay: Infinity });
  for await (const line of rl) {
    for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const a = m[0].toLowerCase();
      // OUR OWN domains and the placeholder ones are not third parties. Without this the gate
      // mints names from first.last@example.com and then flags 'first last' in a licence stub —
      // three of the first run's eight files were exactly that, and noise is how a gate dies.
      if (/@(thetadriven\.com|example\.com|resend\.dev|test\.com|localhost)$/.test(a)) continue;
      addrs.add(a);
    }
  }
  return namesFromAddresses(addrs);
}

// ── BASE64-PACKED THIRD PARTIES (2026-09-17 leak: demo-attestation-bundle.json's reef.bytes_b64) ──
// A reef/axes blob rides inside JSON as a `*_b64` string. The bigram scan below sees only the
// base64 ALPHABET — a name inside is invisible until decoded. isMostlyPrintableUtf8 + decodeB64Field
// + findB64Strings give walkText a second pass per JSON file: decode every `_b64`-keyed field
// unconditionally, and any OTHER string field that itself decodes to ≥1KB of mostly-printable
// UTF-8 (a size floor so an ordinary short word — which is coincidentally within the base64
// alphabet — is never mistaken for a packed blob). Each decoded field is scanned exactly like any
// other file's text, under a virtual path `rel#jsonPath` — so an abort names the JSON PATH of the
// field, never just the file, and a human can find the exact string to fix.
export function isMostlyPrintableUtf8(buf) {
  if (!buf || !buf.length) return false;
  let printable = 0;
  for (const b of buf) if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) printable++;
  return printable / buf.length >= 0.85;
}
const B64_ALPHABET_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** value decodes as base64 → the decoded UTF-8 text, or null if it is not base64-shaped, or (for a
 *  field whose KEY does not end in `_b64`) decodes to under 1KB or is not mostly-printable text. A
 *  `_b64`-keyed field is trusted on its key alone (still must be non-empty and mostly-printable —
 *  a `_b64` field that is actually opaque binary, e.g. a compressed blob, is not text and is skipped
 *  rather than scanned as byte garbage). */
export function decodeB64Field(key, value) {
  if (typeof value !== 'string') return null;
  const stripped = value.replace(/\s+/g, '');
  if (stripped.length < 8 || stripped.length % 4 !== 0 || !B64_ALPHABET_RE.test(stripped)) return null;
  let buf; try { buf = Buffer.from(stripped, 'base64'); } catch { return null; }
  if (!buf.length || !isMostlyPrintableUtf8(buf)) return null;
  const keyed = typeof key === 'string' && key.endsWith('_b64');
  if (!keyed && buf.length < 1024) return null;
  return buf.toString('utf8');
}
/** walk a parsed JSON value, yielding [jsonPath, decodedText] for every field decodeB64Field admits. */
export function* findB64Strings(node, path = '') {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i], p = `${path}[${i}]`;
      if (typeof v === 'string') { const d = decodeB64Field(null, v); if (d) yield [p, d]; }
      else yield* findB64Strings(v, p);
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'string') { const d = decodeB64Field(k, v); if (d) yield [p, d]; }
    else yield* findB64Strings(v, p);
  }
}

/** ONE walk, two consumers. scan() reports (first file per name, which is what an abort message
 *  wants) and scanFiles() rewrites (every file holding any name, which is what a redaction needs).
 *  Deriving both from the same generator is the point: the first version had redact() reading
 *  scan()'s first-file map, so a name in three files was cleared in one and the run still reported
 *  success. Two views of one walk cannot drift apart; two walks would. */
function* walkText(dir, { exempt = EXEMPT_DIRS } = {}) {
  const stack = [[dir, '']];
  while (stack.length) {
    const [d, rel] = stack.pop();
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (SKIP_DIRS.has(e.name)) continue;
      const nextRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!exempt.some((x) => nextRel === x || nextRel.startsWith(`${x}/`))) stack.push([join(d, e.name), nextRel]);
        continue;
      }
      if (!TEXT_EXT.has(extname(e.name))) continue;
      let s; try { s = readFileSync(join(d, e.name), 'utf8'); } catch { continue; }
      yield [nextRel, s];
      if (extname(e.name) === '.json') {
        let parsed; try { parsed = JSON.parse(s); } catch { parsed = null; }
        if (parsed) for (const [jsonPath, decoded] of findB64Strings(parsed)) yield [`${nextRel}#${jsonPath}`, decoded];
      }
    }
  }
}

/** Bigram scan: the tokens are adjacent or it is not a name. Returns name → first file seen (a
 *  base64-decoded hit reports `file#jsonPath`, so the field is nameable without printing its value). */
export function scan(dir, names, opts = {}) {
  const found = new Map();
  for (const [rel, raw] of walkText(dir, opts)) {
    const toks = raw.toLowerCase().split(/[^a-z]+/);
    for (let i = 0; i + 1 < toks.length; i++) {
      const two = `${toks[i]} ${toks[i + 1]}`;
      if (names.has(two) && !found.has(two)) found.set(two, rel);
    }
  }
  return found;
}

/** EVERY file holding at least one watchlisted name. */
export function scanFiles(dir, names, opts = {}) {
  const files = new Set();
  for (const [rel, raw] of walkText(dir, opts)) {
    const toks = raw.toLowerCase().split(/[^a-z]+/);
    for (let i = 0; i + 1 < toks.length; i++) {
      // strip a b64 virtual path (`file.json#reef.bytes_b64`) back to the REAL file — that is
      // what redact() opens; a decoded blob cannot be patched by rewriting the base64 alphabet.
      if (names.has(`${toks[i]} ${toks[i + 1]}`)) { files.add(rel.split('#')[0]); break; }
    }
  }
  return files;
}

/** Replace every watchlisted name with a neutral token, in place. STAGED MIRROR ONLY — never the
 *  monorepo. Vocab bags are keyword soup, so dropping a name changes no structure. */
export function redact(dir, names, opts = {}) {
  const files = [...scanFiles(dir, names, opts)];
  for (const rel of files) {
    const p = join(dir, rel);
    let s; try { s = readFileSync(p, 'utf8'); } catch { continue; }
    for (const name of names) {
      const [a, b] = name.split(' ');
      s = s.replace(new RegExp(`${a}\\s+${b}`, 'gi'), 'redacted name');
    }
    writeFileSync(p, s);
  }
  return files;
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error('usage: mirror-name-gate.mjs <mirror-dir>'); process.exit(1); }
  const names = await watchlist();
  if (!names.size) {
    // "I did not look" and "I looked and saw nothing" are different claims.
    console.error('🛑 ABORT — no correspondence record, so the name gate could not run. Not a pass.');
    process.exit(1);
  }
  if (process.argv.includes('--redact')) {
    const touched = redact(dir, names);
    if (touched.length) console.log(`   redacted third-party names in ${touched.length} staged file(s)`);
  }

  // ── THE BOOK IS A WARNING, NOT AN ABORT, AND THE SPLIT IS THE HONEST PART ──────────────────
  // The first version EXEMPTED books/ outright — "the book ships, its characters ship with it" —
  // and that reasoning is right about characters and wrong about people. It let a real broker's
  // name and employer through as a worked example ("Sales Rep Permission: alpha_bravo/Account/*" (synthetic — the original example carried a real first_last))
  // in text that is already live on the site. But a novel legitimately contains names, and some of
  // them will collide with someone we have emailed, so aborting the push over the book would be a
  // gate that cries wolf about fiction. Blocking and flagging are different verdicts and they get
  // different exits: prose we publish on purpose gets a human's eye, everything else gets refused.
  // TWO SCANS, NOT ONE PARTITIONED SCAN. scan() records the FIRST file a name appears in, so
  // splitting a single result by path would misfile a name that is in BOTH the book and a real file
  // whenever the book copy is reached first — a false negative in the half that blocks. Scanning the
  // non-book tree on its own cannot make that mistake: anything it finds is outside the book by
  // construction.
  const blocking = scan(dir, names, { exempt: EXEMPT_DIRS });
  const all = scan(dir, names, { exempt: [] });
  const review = new Map([...all].filter(([n]) => !blocking.has(n)));

  if (review.size) {
    const files = [...new Set(review.values())].sort();
    console.warn(`⚠️  REVIEW — ${review.size} correspondent name(s) appear in published prose, in ${files.length} file(s):`);
    for (const f of files) console.warn(`   ${f}`);
    console.warn('   A book legitimately contains names; a real counterparty used as a worked example is');
    console.warn('   a different thing. Not blocking — a human decides which this is.');
  }
  if (blocking.size) {
    // The FILES are named; the NAMES ARE NOT PRINTED. An abort message is a log, and a log is not
    // where a third party's identity belongs — printing them would leak exactly what this stops.
    const files = [...new Set(blocking.values())].sort();
    console.error(`🛑 ABORT — ${blocking.size} third-party name(s) present in staged text, across ${files.length} file(s):`);
    for (const f of files) console.error(`   ${f}`);
    console.error('   (names deliberately not printed). Denylist the path or scrub the value. NOTHING pushed.');
    process.exit(4);
  }
  console.log(`✅ name gate clean — ${names.size} correspondents checked, none present outside published prose.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
