#!/usr/bin/env node
// scripts/pmu/verify-url.mjs — C97c `npx thetacog-mcp verify <url>` (2026-09-20). THE AUDITOR'S OWN COMMAND, on foreign metal,
// with nothing from this repo: fetch the CAR bundle at a URL and RECOMPUTE it —
//   1. every row's hash over its canonical bytes (src/lib/vna/row-canonical.mjs — the one rule the tape signs under);
//   2. every row's ed25519 signature under the pubkey the row carries (sig_pubkey); an unsigned row is a failure, never a pass;
//   3. the chain — consecutive rows link prev → row_sha;
//   4. every receipt (C85b): car_sha names a row (car_sha = sha256 of the row's signed bytes = row_sha), the MMR proof (C85a,
//      src/lib/notary/mmr.mjs) climbs from leaf(car_sha) to the receipt's witness_root, every countersignature verifies over
//      receiptBytes under its own pubkey, and at least one verifying countersigner IS the key served at <origin>/api/auth/keys
//      (TLS is the root — the key comes from the same origin the CAR did, never from the bundle);
//   5. per row the three-word reading off proofs.guards (C92b): in lane · off lane (guard <label>) · unmeasured.
// Prints ONE line first — `VERIFIED — <n> rows · <k> countersigned · root <root8> · key <fp8>` or `NOT VERIFIED — <row or
// receipt>: <which check>` — then the per-row block. A URL that does not resolve, or a keys endpoint that refuses, prints
// `UNMEASURED — GET <url>: <failure>` and never a verdict. Exit 0 with a block; exit 1 only on NOT VERIFIED. Recomputable —
// same bytes, same hashes — never "deterministic", never "proves"; the walk that placed a row is the replay door's question
// (C99d), not this one's. `fetch` is injected for the guard; the CLI uses the global.
// Wire format (what the C97f drain uploads and the C99b audit link serves): a JSON object { rows: [tape rows], receipts:
// [witness receipts] } — or ndjson whose lines are rows (row_sha) and receipts (car_sha + witness_root).
// @guard tests/vna/c97-verify-by-url.test.mjs
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { canonical, rowSha } from '../../src/lib/vna/row-canonical.mjs';
import { createMMR, leafHash } from '../../src/lib/notary/mmr.mjs';
import { receiptBytes } from '../../src/lib/notary/gateway.mjs';

const SPKI = '302a300506032b6570032100';
const isHex = (h, n) => typeof h === 'string' && h.length === n && /^[0-9a-f]+$/.test(h);
const fingerprint = (pubHex) => createHash('sha256').update(Buffer.from(String(pubHex), 'hex')).digest('hex').slice(0, 16);
function sigOk(pubHex, bytes, sigHex) {
  try { if (!isHex(pubHex, 64) || !isHex(sigHex, 128)) return false; return edVerify(null, Buffer.from(bytes, 'utf8'), createPublicKey({ key: Buffer.from(SPKI + pubHex, 'hex'), format: 'der', type: 'spki' }), Buffer.from(sigHex, 'hex')); } catch { return false; }
}
// C92b's three words, read off the guards the row signed — never typed
export function readingOf(row) {
  const g = row && row.proofs && Array.isArray(row.proofs.guards) ? row.proofs.guards : null;
  if (!g || !g.length) return 'unmeasured';
  const bad = g.find((i) => i && i.status === 'fail'); if (bad) return `off lane (guard ${bad.label || '?'})`;
  return g.every((i) => i && i.status === 'pass') ? 'in lane' : 'unmeasured';
}
async function getJson(fetch, url) {
  let res; try { res = await fetch(url); } catch (e) { return { fail: `GET ${url}: ${e && e.message || e}` }; }
  if (!res || !res.ok) return { fail: `GET ${url}: ${res ? res.status : 'no response'}` };
  const text = await res.text();
  try { return { json: JSON.parse(text) }; } catch {}
  const lines = text.split('\n').filter((l) => l.trim()); const out = []; for (const l of lines) { try { out.push(JSON.parse(l)); } catch { return { fail: `GET ${url}: not JSON and not ndjson` }; } }
  return { json: out };
}
// the served keys: { pubkey } (the site key, C84a), and any notary_pubkey / keys[].pubkey the origin adds — every 64-hex key in the document
const servedKeys = (doc) => { const out = new Set(); const take = (v) => { if (isHex(v, 64)) out.add(v); }; if (doc && typeof doc === 'object') { take(doc.pubkey); take(doc.notary_pubkey); for (const k of Array.isArray(doc.keys) ? doc.keys : []) take(k && k.pubkey); } return out; };

export async function verifyCarAt({ url, fetch = globalThis.fetch } = {}) {
  const out = { url, verdict: null, line: null, rows: 0, countersigned: 0, root: null, key: null, perRow: [], failures: [], block: '' };
  if (!/^https?:\/\//.test(String(url || ''))) { out.verdict = 'UNMEASURED'; out.line = `UNMEASURED — ${JSON.stringify(url)} is not an http(s) URL`; out.block = out.line; return out; }
  const got = await getJson(fetch, url);
  if (got.fail) { out.verdict = 'UNMEASURED'; out.line = `UNMEASURED — ${got.fail}`; out.block = out.line; return out; }
  const doc = got.json; const items = Array.isArray(doc) ? doc : [...(Array.isArray(doc.rows) ? doc.rows : []), ...(Array.isArray(doc.receipts) ? doc.receipts : [])];
  const rows = items.filter((x) => x && typeof x === 'object' && typeof x.row_sha === 'string').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const receipts = items.filter((x) => x && typeof x === 'object' && typeof x.car_sha === 'string' && typeof x.witness_root === 'string').sort((a, b) => (a.sequence_height ?? 0) - (b.sequence_height ?? 0));
  if (!rows.length) { out.verdict = 'UNMEASURED'; out.line = `UNMEASURED — ${url} carries no tape row (no row_sha on any object)`; out.block = out.line; return out; }
  const origin = new URL(url).origin; const keysUrl = `${origin}/api/auth/keys`;
  const kg = await getJson(fetch, keysUrl);
  if (kg.fail) { out.verdict = 'UNMEASURED'; out.line = `UNMEASURED — ${kg.fail} (the countersignatures cannot be checked against the origin's key)`; out.block = out.line; return out; }
  const keys = servedKeys(kg.json); const served = kg.json && isHex(kg.json.notary_pubkey, 64) ? kg.json.notary_pubkey : (kg.json && isHex(kg.json.pubkey, 64) ? kg.json.pubkey : null);
  if (!keys.size) { out.verdict = 'UNMEASURED'; out.line = `UNMEASURED — ${keysUrl} served no 32-byte ed25519 key`; out.block = out.line; return out; }
  out.key = served;
  const F = out.failures; const name = (r) => `row ${r.seq ?? '?'}`;
  // 1–3: the rows
  const bySha = new Map(); let prev = null;
  for (const r of rows) {
    const per = { seq: r.seq, kind: r.kind, sha: r.sha ? String(r.sha).slice(0, 10) : null, reading: readingOf(r), signed_as: r.signed_as || (r.sig ? (r.room ? 'room' : 'local') : null), signer: r.sig_pubkey ? fingerprint(r.sig_pubkey).slice(0, 8) : null, countersignatures: 0, ok: true, why: null };
    const rs = rowSha(r);
    if (rs !== r.row_sha) { per.ok = false; per.why = 'row_sha does not recompute from the row\'s canonical bytes — the row was edited'; }
    else if (!r.sig || !r.sig_pubkey) { per.ok = false; per.why = `unsigned${r.sig_why ? ' (' + r.sig_why + ')' : ''} — no row without a signature`; }
    else if (!sigOk(r.sig_pubkey, canonical(r), r.sig)) { per.ok = false; per.why = 'signature does not verify under the pubkey on the row'; }
    else if (prev && Number.isFinite(r.seq) && Number.isFinite(prev.seq) && r.seq === prev.seq + 1 && r.prev !== prev.row_sha) { per.ok = false; per.why = `prev ${String(r.prev).slice(0, 12)} is not the previous row's row_sha — the chain is cut here`; }
    if (!per.ok) F.push(`${name(r)}: ${per.why}`);
    bySha.set(r.row_sha, per); out.perRow.push(per); prev = r;
  }
  out.rows = rows.length;
  // 4: the receipts
  const mmr = createMMR();
  for (const rc of receipts) {
    const h = rc.sequence_height ?? '?'; const label = `receipt ${h}`;
    const per = bySha.get(rc.car_sha);
    if (!per) { F.push(`${label}: car_sha ${String(rc.car_sha).slice(0, 12)} names no row in the bundle`); continue; }
    if (!rc.mmr || typeof rc.mmr !== 'object') { F.push(`${label}: no MMR proof on the receipt (a pre-C85a receipt cannot be recomputed here)`); continue; }
    let landed = null; try { landed = await mmr.verify({ leaf_hash: await leafHash(rc.car_sha), proof: rc.mmr }); } catch { landed = null; }
    if (landed !== rc.witness_root) { F.push(`${label}: MMR proof recomputes to ${String(landed || '—').slice(0, 8)}, not witness_root ${String(rc.witness_root).slice(0, 8)}`); continue; }
    const over = receiptBytes({ sequence_height: rc.sequence_height, witness_root: rc.witness_root, timestamp: rc.timestamp != null ? rc.timestamp : rc.received_at, car_sha: rc.car_sha });
    const sigs = Array.isArray(rc.signatures) && rc.signatures.length ? rc.signatures : (typeof rc.notary_signature === 'string' && typeof rc.notary_pubkey === 'string' ? [{ party: rc.notary_party || 'notary', pubkey: rc.notary_pubkey, sig: rc.notary_signature }] : []);
    if (!sigs.length) { F.push(`${label}: no countersignature on the receipt`); continue; }
    let good = 0, anchored = false, bad = null;
    for (const s of sigs) { if (sigOk(s.pubkey, over, s.sig)) { good++; if (keys.has(s.pubkey)) anchored = true; } else { bad = bad || (s.party || String(s.pubkey || '').slice(0, 8)); } }
    if (bad) { F.push(`${label}: countersignature by ${bad} does not verify over the receipt's bytes`); continue; }
    if (!anchored) { F.push(`${label}: no countersignature under the key at ${keysUrl} (served ${[...keys].map((k) => fingerprint(k).slice(0, 8)).join(', ')})`); continue; }
    per.countersignatures = good; out.countersigned++; out.root = rc.witness_root;
  }
  const rootFail = receipts.length && !out.root;
  out.verdict = F.length ? 'NOT VERIFIED' : 'VERIFIED';
  out.line = F.length ? `NOT VERIFIED — ${F[0]}` : `VERIFIED — ${out.rows} rows · ${out.countersigned} countersigned · root ${out.root ? out.root.slice(0, 8) : '—'} · key ${out.key ? fingerprint(out.key).slice(0, 8) : '—'}`;
  const lines = [out.line];
  for (const p of out.perRow) lines.push(`  #${p.seq ?? '?'} ${p.kind || '?'}${p.sha ? ' ' + p.sha : ''} · ${p.reading} · ${p.ok ? `signed as ${p.signed_as || '?'} ${p.signer || ''}`.trim() : 'FAILS: ' + p.why} · ${p.countersignatures} countersignature${p.countersignatures === 1 ? '' : 's'}`);
  if (F.length > 1) for (const f of F.slice(1)) lines.push(`  also: ${f}`);
  lines.push(`  recomputed from ${url} · key from ${keysUrl}${rootFail ? ' · no receipt anchored' : ''} · what is checked: row hash, row signature, chain, MMR proof, countersignatures; what is not: whether the code is good (undecidable) or where the walk placed it (replay --since)`);
  out.block = lines.join('\n');
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const url = argv.find((a) => !a.startsWith('--')); const asJson = argv.includes('--json');
  if (!url) { console.log('usage: npx thetacog-mcp verify <url> [--json] — fetch the CAR bundle at <url>, recompute every row hash, signature, MMR proof and countersignature against the key at <origin>/api/auth/keys'); process.exitCode = 2; }
  else {
    const v = await verifyCarAt({ url });
    if (asJson) console.log(JSON.stringify(v)); else console.log(v.block);
    process.exitCode = v.verdict === 'NOT VERIFIED' ? 1 : 0;
  }
}
