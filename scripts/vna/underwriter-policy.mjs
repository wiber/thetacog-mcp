#!/usr/bin/env node
// scripts/vna/underwriter-policy.mjs — C87 THE UNDERWRITER'S POLICY FILE AND THE READING — TAPE, NOT BRAKE (goal 12, 2026-09-18).
// One declarative policy file (data/vna/underwriter-policy.json) and one reading over it. The file carries, per number,
// the receipt it was READ from (path + field) — the perturbation ladder's margin floor, the walk ratchet's z_required
// at the aperture in force, the compressor's FIT_MIN_GAIN — so the guard checks equality and nothing is typed fresh.
// Δ is the walk's delta_heatmap red-ring count on the Δ panel at the aperture in force, never a Chebyshev distance.
// The reading is { within: true|false|'UNMEASURED', bound, value, height, at } — WITHIN only when EVERY bound is
// measured and inside; the FIRST outside bound is named (an absence never hides a breach); else the first UNMEASURED
// bound is named; a missing receipt reads UNMEASURED, never WITHIN and never 0. It is signed with the tape key and
// appended to the flight tape as a `reading` row (SIGNED_KEYS unchanged: the reading rides in `delta`, the policy's
// content address in `sha`, the policy's cites in `proofs`). A CI job MAY read the row and refuse to deploy — that
// refusal is the client's wiring, named as such; nothing here halts anything. Zero LLM on this path.
//
//   node scripts/vna/underwriter-policy.mjs --cites            check every number on the file against its receipt
//   node scripts/vna/underwriter-policy.mjs --read [--json]    take a reading over the live receipts (appends nothing)
//   node scripts/vna/underwriter-policy.mjs --append [--room r] take a reading and append it to the flight tape
import { readFileSync } from 'node:fs';
import { tailRows } from './walk-tape-read.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { append, lastRow, FLIGHT } from './flight-tape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const POLICY = process.env.VNA_UNDERWRITER_POLICY || resolve(REPO, 'data/vna/underwriter-policy.json');
export const BOUNDS = ['k_of_n', 'rings_max', 'margin_floor', 'seed_null', 'columns_zero_drift'];
// the words the row refuses — a reading is a position on a tape, never money, never a promise about behaviour
export const REFUSED_WORDS = ['bond', 'certificate', 'guarantee', 'prevent'];
const U = 'UNMEASURED';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const get = (o, path) => String(path).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

export function readPolicy(path = POLICY) {
  const bytes = readFileSync(path, 'utf8');
  return { policy: JSON.parse(bytes), bytes, sha: sha256(bytes), path };
}

// ── THE READING — pure over { policy, tape, receipts }; the clock is injected ─────────────────────────────────────────
// receipts: { cosign: { verified, n }            C85b — verified co-signatures on the newest witness receipt
//             delta:  { red, rings_at: [...] }    the Δ panel's counts (cockpit.json delta / panels[delta]) — red = drift rings
//             margin: number                      the walk's placement margin (top-two score gap, the ladder's unit)
//             walk:   { gain, z }                 the walk row's fit — the seed-null admission the one door applies }
export function policyReading({ policy, tape = FLIGHT, receipts = {}, now = () => new Date().toISOString() } = {}) {
  const R = receipts || {}; const P = policy || {};
  const values = {};
  const one = (bound, limit, value, ok, extra = {}) => { values[bound] = limit == null ? { within: U, bound: limit, value, why: `no receipt calibrates ${bound} — UNMEASURED, never a typed bound` } : value == null ? { within: U, bound: limit, value: U, why: `no receipt for ${bound}` } : { within: ok, bound: limit, value, ...extra }; };
  // k-of-n: verified signatures ≥ k
  const k = num(get(P, 'k_of_n.k')); const verified = num(get(R, 'cosign.verified'));
  one('k_of_n', k, verified, verified != null && k != null ? verified >= k : null, { n: num(get(R, 'cosign.n')) });
  // rings: the Δ panel's red-ring count ≤ rings_max
  const rm = P.rings_max === undefined ? null : num(P.rings_max); const red = num(get(R, 'delta.red'));
  one('rings_max', rm, red, red != null && rm != null ? red <= rm : null);
  // margin: the walk's placement margin ≥ the ladder's floor
  const mf = num(P.margin_floor); const margin = num(R.margin);
  one('margin_floor', mf, margin, margin != null && mf != null ? margin >= mf : null);
  // seed null: z ≥ z AND gain ≥ gain — both terms from the walk row
  const zr = num(get(P, 'seed_null.z')), gr = num(get(P, 'seed_null.gain')); const z = num(get(R, 'walk.z')), gain = num(get(R, 'walk.gain'));
  if (zr == null || gr == null) values.seed_null = { within: U, bound: { z: zr, gain: gr }, value: { z, gain }, why: 'no receipt calibrates seed_null — UNMEASURED, never a typed bound' };
  else if (z == null || gain == null) values.seed_null = { within: U, bound: { z: zr, gain: gr }, value: U, why: 'no walk row — no z, no gain' };
  else values.seed_null = { within: z >= zr && gain >= gr, bound: { z: zr, gain: gr }, value: { z, gain } };
  // columns declared zero-drift: no red ring on the Δ panel whose coordinate sits in that column; an empty list is trivially within
  const cols = Array.isArray(P.columns_zero_drift) ? P.columns_zero_drift : null;
  if (cols == null) values.columns_zero_drift = { within: U, bound: null, value: U, why: 'columns_zero_drift is not a list' };
  else if (!cols.length) values.columns_zero_drift = { within: true, bound: [], value: [] };
  else { const rings = Array.isArray(get(R, 'delta.rings_at')) ? R.delta.rings_at : null;
    if (!rings) values.columns_zero_drift = { within: U, bound: cols, value: U, why: 'no Δ panel rings_at receipt' };
    else { const hits = rings.filter((r) => r && r.band === 'red' && cols.includes(String(r.coord || '').split(',')[1])).map((r) => r.coord); values.columns_zero_drift = { within: hits.length === 0, bound: cols, value: hits }; } }
  // the tape's own height: the newest row's seq — UNMEASURED when there is no tape, never 0
  const last = (() => { try { return lastRow(tape); } catch { return null; } })();
  const height = last && Number.isFinite(last.seq) ? last.seq : U;
  const outside = BOUNDS.find((b) => values[b].within === false); const unmeasured = BOUNDS.find((b) => values[b].within === U);
  const first = outside || unmeasured || null;
  return { within: outside ? false : unmeasured ? U : true, bound: first, value: first ? values[first].value : null, height, at: now(), values, sufficientFor: 'whether the named receipts sit inside the declared bounds at this height', notFor: 'whether the work was good (Rice), whether a loss occurred, what it cost' };
}

// ── THE ROW — signed with the tape key, appended as kind:'reading' (never a CAR) ──────────────────────────────────────
export function appendReading({ policy = null, policyPath = POLICY, policyBytes = null, tape = FLIGHT, receipts = {}, room = null, ts = new Date().toISOString(), now = () => ts } = {}) {
  const P = policy ? { policy, bytes: policyBytes == null ? JSON.stringify(policy) : policyBytes, path: policyPath } : readPolicy(policyPath);
  const reading = policyReading({ policy: P.policy, tape, receipts, now });
  const { v, cites } = P.policy;
  return append({ kind: 'reading', sha: sha256(P.bytes), room, ts, proofs: { policy: { v: v ?? null, path: P.path, sha: sha256(P.bytes), cites: cites || null } }, delta: reading, seed: { receipts: summarise(receipts) } }, tape);
}
const summarise = (R) => R ? { cosign: R.cosign ?? null, delta: R.delta ? { red: R.delta.red ?? null, green: R.delta.green ?? null, amber: R.delta.amber ?? null, offPct: R.delta.offPct ?? null } : null, margin: R.margin ?? null, walk: R.walk ?? null } : null;

// ── C87a THE CARD-3 LINE — pure over { notary, cosign, reading }; the dispatcher wires it under `credits left N` when 🟢 ──
// `witness 0x<root8> · k-of-n witnesses · policy <WITHIN | OUTSIDE bound | UNMEASURED> at height h` — every term from a
// receipt or UNMEASURED (a notary with no verified root has no root to print; a real 0 verified co-signers is 0-of-n);
// the label set (🟢 Notarized / 🔴 / ⚪ · PRE-RELEASE) is card 3's and is never printed here; never a dollar.
export function card3PolicyLine({ notary = null, cosign = null, reading = null } = {}) {
  const root = notary && typeof notary.witness_root === 'string' && /^[0-9a-f]{8}/i.test(notary.witness_root) ? `0x${notary.witness_root.slice(0, 8)}` : U;
  const k = cosign && Number.isFinite(cosign.verified) ? cosign.verified : null; const n = cosign && Number.isFinite(cosign.n) ? cosign.n : null;
  const kofn = k != null && n != null ? `${k}-of-${n}` : U;
  const state = !reading ? U : reading.within === true ? 'WITHIN' : reading.within === false ? `OUTSIDE ${reading.bound || U}` : U;
  const height = reading && Number.isFinite(reading.height) ? reading.height : U;
  return `witness ${root} · ${kofn} witnesses · policy ${state} at height ${height}`;
}

// ── THE CITES — every number on the file names the receipt it was read from; resolve each and compare ─────────────────
// a cite: { path, field }                       a JSON file, a dot-path
//         { path, field, newest, select, tailBytes }  an ndjson file — the newest row whose `select` fields match (a tail read; the walk tape is 135 MB)
//         { path, export }                      a module's exported constant (the one place the number is defined)
//         { path, row, pattern }                a declared number: the spec row's text carries the pattern (a declaration, not a calibration — said so)
//         { status: 'UNMEASURED', why }         no receipt calibrates it; the number is null and the reading is UNMEASURED on that bound
export async function resolveCite(cite, { repo = REPO } = {}) {
  if (!cite || typeof cite !== 'object') return { status: U, why: 'no cite' };
  if (cite.status === U || !cite.path) return { status: U, why: cite.why || 'no receipt named' };
  const abs = resolve(repo, cite.path);
  try {
    if (cite.export) { const m = await import(pathToFileURL(abs).href); const v = m[cite.export]; return v === undefined ? { status: U, why: `${cite.path} exports no ${cite.export}` } : { status: 'READ', value: v }; }
    if (cite.pattern) { const text = readFileSync(abs, 'utf8'); const line = cite.row ? text.split('\n').find((l) => new RegExp(`^- \\[[ x]\\] ${cite.row}\\b`).test(l)) : text; if (!line) return { status: U, why: `${cite.path} has no row ${cite.row}` }; return line.includes(cite.pattern) ? { status: 'READ', value: cite.value ?? cite.pattern, declared: true } : { status: U, why: `${cite.path} row ${cite.row} does not carry "${cite.pattern}"` }; }
    if (/\.ndjson$/.test(cite.path)) {
      const rows = tailRows(abs, cite.tailBytes || 4 * 1024 * 1024); const sel = cite.select || {};
      const hit = [...rows].reverse().find((r) => Object.entries(sel).every(([k, v]) => get(r, k) === v));
      if (!hit) return { status: U, why: `${cite.path}: no row matches ${JSON.stringify(sel)} in the tail` };
      const v = get(hit, cite.field); return v === undefined ? { status: U, why: `${cite.path}: newest matching row has no ${cite.field}` } : { status: 'READ', value: v, at: hit.ts || hit.at || null };
    }
    const doc = JSON.parse(readFileSync(abs, 'utf8')); const v = get(doc, cite.field);
    return v === undefined ? { status: U, why: `${cite.path} has no ${cite.field}` } : { status: 'READ', value: v };
  } catch (e) { return { status: U, why: `${cite.path}: ${String(e.message || e).slice(0, 80)}` }; }
}
export async function policyCites(policy, { repo = REPO } = {}) {
  const cites = (policy && policy.cites) || {}; const out = [];
  for (const [key, cite] of Object.entries(cites)) {
    const expected = get(policy, key); const r = await resolveCite(cite, { repo });
    out.push({ key, expected: expected === undefined ? null : expected, path: cite.path || null, field: cite.field || cite.export || cite.pattern || null, status: r.status, receipt: r.status === 'READ' ? r.value : null, equal: r.status === 'READ' && r.value === expected, declared: !!r.declared, why: r.why || cite.why || null, at: r.at || null });
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const asJson = a.includes('--json'); const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (a.includes('--cites')) {
    const { policy } = readPolicy(); const rows = await policyCites(policy);
    if (asJson) console.log(JSON.stringify(rows, null, 1)); else for (const r of rows) console.log(`  ${r.key.padEnd(16)} ${String(r.expected).padEnd(8)} ${r.status === 'READ' ? (r.equal ? '= ' : '≠ ') + r.receipt + (r.declared ? ' (declared, not calibrated)' : '') : 'UNMEASURED — ' + r.why} · ${r.path || '—'}#${r.field || '—'}`);
    process.exitCode = rows.every((r) => (r.expected == null ? r.status === U : r.equal)) ? 0 : 1;
  } else if (a.includes('--read') || a.includes('--append')) {
    const { policy } = readPolicy(); const receipts = liveReceipts();
    if (a.includes('--append')) { const row = appendReading({ policy, receipts, room: val('--room') }); console.log(asJson ? JSON.stringify(row) : `#${row.seq} reading · policy ${row.delta.within === true ? 'WITHIN' : row.delta.within === false ? `OUTSIDE ${row.delta.bound}` : U} at height ${row.delta.height} · ${row.sig ? 'signed by ' + row.room : 'unsigned: ' + row.sig_why}`); }
    else { const r = policyReading({ policy, receipts }); console.log(asJson ? JSON.stringify(r, null, 1) : `policy ${r.within === true ? 'WITHIN' : r.within === false ? `OUTSIDE ${r.bound}` : U} at height ${r.height} · ${BOUNDS.map((b) => `${b} ${r.values[b].within === true ? 'in' : r.values[b].within === false ? 'OUT' : U}`).join(' · ')}`); }
  } else { console.error('usage: underwriter-policy.mjs --cites | --read [--json] | --append [--room r]'); process.exitCode = 2; }
}
// the live receipts, each read off the record the pipeline wrote — absent → null → that bound reads UNMEASURED
function liveReceipts() {
  const j = (p) => { try { return JSON.parse(readFileSync(resolve(REPO, p), 'utf8')); } catch { return null; } };
  const cock = j('data/vna/cockpit.json'); const delta = cock && cock.delta ? { ...cock.delta, rings_at: ((cock.panels || []).find((p) => p.id === 'delta') || {}).rings_at || null } : null;
  const walkRows = (() => { try { return tailRows(resolve(REPO, '.thetacog/walk-tape.ndjson'), 512 * 1024); } catch { return []; } })(); const w = walkRows.length ? walkRows[walkRows.length - 1] : null;
  const walk = w && w.fit ? { gain: w.fit.gain ?? null, z: w.fit.z ?? null, z_required: w.ratchet ? w.ratchet.z_required ?? null : null } : null;
  const margin = w && w.fit && Number.isFinite(w.fit.margin) ? w.fit.margin : null;
  let cosign = null; try { const wit = readFileSync(resolve(REPO, 'data/vna/notary-witness.ndjson'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); const last = wit[wit.length - 1]; if (last) cosign = Array.isArray(last.signatures) ? { verified: last.signatures.filter((s) => s && s.verified === true).length, n: last.signatures.length } : null; } catch {}
  return { cosign, delta, margin, walk };
}
