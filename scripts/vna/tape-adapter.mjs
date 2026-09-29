#!/usr/bin/env node
// scripts/vna/tape-adapter.mjs — C426a THE REFERENCE ADAPTER (2026-09-28). The contract a deployer or an underwriter builds
// against is data/vna/tape-adapter.schema.json (contract_version 1.0.0; prose: docs/specs/vna/TAPE-ADAPTER-CONTRACT.md).
// This script is the reference half of it, MIT like the rest of the package:
//
//   node scripts/vna/tape-adapter.mjs export [--out <file>] [--repo <dir>] [--manifest <sha>]
//   node scripts/vna/tape-adapter.mjs check <file>
//
// `export` reads what is already on disk — the flight tape (data/vna/flight-tape.ndjson, C50: hash-chained, ed25519-signed),
// the notary witness receipts (data/vna/notary-witness.ndjson, C81b/C85a–b: the four signed receipt fields, the MMR proof,
// the co-signatures), and the newest backup manifest (.thetacog/backup/<sha>.manifest.json, C71: the archive named by its
// bytes, every file with its sha256) — and writes ONE JSON bundle. Tape rows ride VERBATIM: a row's signature is over its
// canonical bytes (src/lib/vna/row-canonical.mjs), so an adapter that re-shaped a row would break the thing it carries.
// `check` validates any file against the schema (a hand-written validator for the subset the schema uses — no npm
// dependency), then recomputes every tape row's row_sha and verifies every signature it carries, and every witness
// receipt's notary signature. It prints CONFORMS or the FIRST field that does not, exit 0 / 1.
//
// THE BOUNDARY (C426 invariant 3, the C97 README boundary): the bundle holds placement, paths, hashes, guards and
// signatures — never code, diffs or prompts. A field NAMED like one (REFUSED_KEYS), or a string CARRYING one (a unified
// diff, a code fence, or text past MAX_STRING), is refused: by `check` as a failing field, and by `export` before anything
// is written — a tape row carrying one is not stripped, because stripping it would break that row's signature.
// LLM-FREE. Reads only; sends nothing.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { canonical } from '../../src/lib/vna/row-canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(HERE, '..', '..', 'data/vna/tape-adapter.schema.json');
export const CONTRACT_VERSION = '1.0.0';
export const GENESIS = 'flight-tape/genesis';   // flight-tape.mjs GENESIS — the first row's prev
export const REFUSED_KEYS = Object.freeze(['code', 'source_code', 'diff', 'patch', 'prompt', 'prompts', 'prompt_text', 'response', 'completion', 'tool_call', 'tool_calls', 'messages', 'transcript']);
export const MAX_STRING = 4096;   // the longest string on the real tape (2026-09-28) is 977 chars: a goal row's declared text
const CONTENT_PATTERNS = [
  [/^diff --git /m, 'a unified diff (diff --git)'],
  [/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m, 'a unified diff hunk (@@ … @@)'],
  [/^(---|\+\+\+) [ab]\//m, 'a unified diff header (--- a/ · +++ b/)'],
  [/```/, 'a code fence'],
];
export const SCOPE = Object.freeze({
  sufficient_for: 'where each decided commit and turn landed, against which declared rows, under which key, and whether the record has been edited since it was signed — recomputable from the commit, every signature verifiable with ed25519',
  not_sufficient_for: 'whether the work was good — undecidable (Rice, 1953); the bundle carries no code, no diffs and no prompts to judge it with',
});

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const nd = (p) => { if (!existsSync(p)) return null; return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${p}: line ${i + 1} is not JSON`); } }); };
const SPKI_ED25519 = '302a300506032b6570032100';
function edOk(pubHex, bytes, sigHex) {
  try { return edVerify(null, Buffer.from(bytes, 'utf8'), createPublicKey({ key: Buffer.from(SPKI_ED25519 + pubHex, 'hex'), format: 'der', type: 'spki' }), Buffer.from(sigHex, 'hex')); }
  catch { return false; }
}
// gateway.mjs receiptBytes, restated so this file imports nothing from the notary: the four signed fields, in this order
const receiptBytes = (w) => JSON.stringify({ sequence_height: w.sequence_height, witness_root: w.witness_root, timestamp: w.received_at, car_sha: w.car_sha });

// ── THE BOUNDARY ────────────────────────────────────────────────────────────────────────────────────────────────────
// The first refused thing found, depth-first, as { path, why } — or null.
export function refusedIn(value, path = '$') {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) return { path, why: `a string of ${value.length} characters — the bundle carries hashes and placements, never text past ${MAX_STRING}` };
    for (const [re, what] of CONTENT_PATTERNS) if (re.test(value)) return { path, why: `carries ${what} — the bundle never carries code, diffs or prompts` };
    return null;
  }
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) { const r = refusedIn(value[i], `${path}[${i}]`); if (r) return r; } return null; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (REFUSED_KEYS.includes(k.toLowerCase())) return { path: `${path}.${k}`, why: `the field \`${k}\` is refused — the bundle never carries code, diffs or prompts` };
      const r = refusedIn(v, `${path}.${k}`); if (r) return r;
    }
  }
  return null;
}

// ── THE VALIDATOR — the subset of JSON Schema the contract uses: type · const · enum · pattern · minimum · required ·
// properties · additionalProperties (boolean) · items. `pattern` applies to strings only (a null passes it, per the spec).
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const typeOk = (v, t) => { const a = typeOf(v); return t === a || (t === 'number' && a === 'integer'); };
export function validate(value, schema, path = '$') {
  if (schema.const !== undefined && value !== schema.const) return { path, why: `must be ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` };
  if (schema.enum && !schema.enum.includes(value)) return { path, why: `must be one of ${schema.enum.join(' · ')}, got ${JSON.stringify(value)}` };
  if (schema.type) { const ts = [].concat(schema.type); if (!ts.some((t) => typeOk(value, t))) return { path, why: `must be ${ts.join(' or ')}, got ${typeOf(value)}` }; }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return { path, why: `does not match ${schema.pattern}` };
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) return { path, why: `must be ≥ ${schema.minimum}` };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) return { path: `${path}.${k}`, why: 'is required and missing' };
    if (schema.additionalProperties === false && schema.properties) for (const k of Object.keys(value)) if (!(k in schema.properties)) return { path: `${path}.${k}`, why: 'is not a field of the contract' };
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in value) { const r = validate(value[k], sub, `${path}.${k}`); if (r) return r; }
  }
  if (Array.isArray(value) && schema.items) for (let i = 0; i < value.length; i++) { const r = validate(value[i], schema.items, `${path}[${i}]`); if (r) return r; }
  return null;
}

// ── INTEGRITY — what the schema cannot say: a row that recomputes, a signature that verifies ────────────────────────
export function integrity(bundle) {
  const rows = (bundle.tape && bundle.tape.rows) || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (sha256(canonical(r)) !== r.row_sha) return { path: `$.tape.rows[${i}]`, why: `row_sha does not recompute from the row (seq ${r.seq}) — the row was edited after it was signed` };
    if (r.sig && !edOk(r.sig_pubkey, canonical(r), r.sig)) return { path: `$.tape.rows[${i}].sig`, why: `does not verify under sig_pubkey (seq ${r.seq})` };
  }
  const ws = (bundle.witness && bundle.witness.rows) || [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w.notary_pubkey && !edOk(w.notary_pubkey, receiptBytes(w), w.notary_signature)) return { path: `$.witness.rows[${i}].notary_signature`, why: `does not verify under notary_pubkey (height ${w.sequence_height})` };
  }
  return null;
}

export function loadSchema(p = SCHEMA_PATH) { return JSON.parse(readFileSync(p, 'utf8')); }
export function check(bundle, schema = loadSchema()) { return refusedIn(bundle) || validate(bundle, schema) || integrity(bundle); }

// ── EXPORT ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function chainOf(rows) {
  const out = { rows: rows.length, ok: true, signed: 0, unsigned: 0, first_break: null }; let prev = null;
  for (const r of rows) {
    const expect = prev ? prev.row_sha : GENESIS;
    if (out.ok && r.prev !== expect) { out.ok = false; out.first_break = { seq: r.seq, why: 'prev does not name the row before it — the chain is cut here' }; }
    if (r.sig) out.signed++; else out.unsigned++;
    prev = r;
  }
  return out;
}
function newestManifest(dir, want = null) {
  if (!existsSync(dir)) return null;
  const all = readdirSync(dir).filter((f) => f.endsWith('.manifest.json')).map((f) => { try { return JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { return null; } }).filter((m) => m && m.sha);
  const m = want ? all.find((x) => x.sha === want) : all.sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  if (!m) return null;
  return { sha: m.sha, bytes: m.bytes, at: m.at, head: m.head ?? null, rows: m.rows || {}, chain_verified: !!m.chain_verified, tesseract_sha: m.tesseract_sha ?? null, files: (m.files || []).map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })) };
}
export function exportBundle({ repo = process.env.VNA_REPO || resolve(HERE, '..', '..'), manifest = null, now = () => new Date().toISOString() } = {}) {
  const tapePath = resolve(repo, 'data/vna/flight-tape.ndjson');
  const rows = nd(tapePath) || [];
  rows.forEach((r, i) => { const hit = refusedIn(r, `$.tape.rows[${i}]`); if (hit) throw Object.assign(new Error(`REFUSED — tape row seq ${r.seq}: ${hit.path} ${hit.why}. Nothing was written; the row is not stripped, because stripping it would break its signature.`), { refused: hit }); });
  const witnessPath = resolve(repo, 'data/vna/notary-witness.ndjson');
  const wraw = nd(witnessPath);
  const WKEYS = ['car_sha', 'sequence_height', 'witness_root', 'notary_signature', 'received_at', 'commit_sha', 'pubkey', 'fingerprint', 'replay', 'notary_pubkey', 'mmr', 'signatures', 'forks', 'synced_at'];
  const wrows = (wraw || []).filter((w) => w && Number.isFinite(w.sequence_height)).map((w) => Object.fromEntries(WKEYS.filter((k) => k in w).map((k) => [k, w[k]])));
  const withMmr = wrows.filter((w) => w.mmr && Array.isArray(w.mmr.peaks)).pop() || null;
  let head = null; try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (!/^[0-9a-f]{40}$/.test(head)) head = null; } catch { head = null; }
  const licensed = rows.filter((r) => r.proofs && r.proofs.licence && typeof r.proofs.licence === 'object').length;
  return {
    contract_version: CONTRACT_VERSION, kind: 'thetacog.tape-bundle', exported_at: now(), head,
    scope: { ...SCOPE },
    manifest: newestManifest(resolve(repo, '.thetacog/backup'), manifest),
    tape: { rows, chain: chainOf(rows) },
    witness: { rows: wrows, status: wraw === null ? 'UNMEASURED — no witness file at data/vna/notary-witness.ndjson; nothing has been receipted by a notary on this machine' : `${wrows.length} receipt${wrows.length === 1 ? '' : 's'} read` },
    mmr: withMmr ? { sequence_height: withMmr.sequence_height, witness_root: withMmr.witness_root, peaks: withMmr.mmr.peaks } : null,
    licence: { licensed, unlicensed: rows.length - licensed },
    refused: [...REFUSED_KEYS],
  };
}

const where = (f) => `${f.path}: ${f.why}`;
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2); const arg = (k) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : null);
  const USAGE = 'usage:\n  node scripts/vna/tape-adapter.mjs export [--out <file>] [--repo <dir>] [--manifest <sha>]\n  node scripts/vna/tape-adapter.mjs check <file>';
  if (cmd === 'export') {
    try {
      const b = exportBundle({ repo: arg('--repo') ? resolve(arg('--repo')) : undefined, manifest: arg('--manifest') });
      const bad = check(b);
      if (bad) { console.log(`REFUSED — the export does not conform, nothing was written: ${where(bad)}`); process.exitCode = 1; }
      else {
        const text = JSON.stringify(b, null, 1) + '\n'; const out = arg('--out');
        if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), text); console.log(`wrote ${out} · contract ${CONTRACT_VERSION} · ${b.tape.rows.length} tape rows (chain ${b.tape.chain.ok ? 'unbroken' : `cut at seq ${b.tape.chain.first_break.seq}`}, ${b.tape.chain.signed} signed) · ${b.witness.rows.length} witness receipts · manifest ${b.manifest ? b.manifest.sha.slice(0, 12) : 'none'} · ${b.licence.licensed} licensed rows`); }
        else process.stdout.write(text);
      }
    } catch (e) { console.log(e.refused ? e.message : `tape-adapter export: ${e.message}`); process.exitCode = 1; }
  } else if (cmd === 'check' && rest[0]) {
    let b; try { b = JSON.parse(readFileSync(resolve(rest[0]), 'utf8')); } catch (e) { console.log(`$: not a readable JSON file — ${e.message}`); process.exitCode = 1; }
    if (b !== undefined) {
      const bad = check(b);
      if (bad) { console.log(where(bad)); process.exitCode = 1; }
      else console.log(`CONFORMS · contract ${b.contract_version} · ${b.tape.rows.length} tape rows recompute (${b.tape.chain.signed} signatures verify) · ${b.witness.rows.length} witness receipts verify`);
    }
  } else { console.log(USAGE); process.exitCode = cmd ? 1 : 0; }
}
