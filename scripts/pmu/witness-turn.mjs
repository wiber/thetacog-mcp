#!/usr/bin/env node
// packages/thetacog-mcp/scripts/pmu/witness-turn.mjs — C454 THE TURN WITNESS, CLIENT SIDE (operator 2026-09-29: "if you're gonna
// deploy the wrapper onto the server you definitely need it" · "the API for it should be in the extension obviously").
//
// The open client, shipped in the npm package the extension uses. Given a declared spec and ONE agent turn's text:
//   1. PLACE the turn through the one door (src/lib/pmu/walk-door.mjs lensWalk → pmu-onchip --lens, the binary resolved by
//      src/lib/pmu/pmu-binary.mjs exactly as attest-demo resolves it). No JS placement primitive — the door or UNMEASURED.
//   2. SIGN locally the way the MCP `thetacog-sign` tool does: `node scripts/vna/auth-flow.mjs sign --bytes - --json`, bytes on
//      stdin, an ALLOWLISTED environment (PATH/HOME/TMPDIR/USER + VNA_/THETACOG_/MESH_/PMU_ …) — the device key signs, the
//      bearer never crosses.
//   3. POST ONLY the signed receipt — placement projection, turn_sha, spec_sha, receipt_sha, timestamp, signature — to
//      /api/notary/ingest in the gateway's `{ records: [...] }` envelope (src/lib/notary/gateway.mjs). The turn text and the
//      spec text never leave the machine: only their sha256 does.
//   4. ASYNCHRONOUSLY: witnessTurn returns as soon as the receipt is signed; the post is a promise the caller may ignore.
//   5. A failed post (rejection, non-2xx) appends exactly one GAP line to a local append-only log (AXIOM 1 W5 — a gap in a
//      monotonic sequence is itself a countable displacement, so it is recorded, never swallowed).
//
// WHAT THIS RECEIPT IS SUFFICIENT FOR: where the turn landed against the declared spec, re-runnable from the same bytes, and
// that this device signed that placement at that time. WHAT IT IS NOT: whether the turn was good (Rice) — never claimed.
//
// Usage: node scripts/pmu/witness-turn.mjs --spec-file S --turn-file T [--lane L] [--url URL] [--gap-log PATH] [--json]

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
export const DEFAULT_INGEST_URL = process.env.THETACOG_NOTARY_INGEST_URL || 'https://thetadriven.com/api/notary/ingest';
export const DEFAULT_GAP_LOG = process.env.THETACOG_WITNESS_GAP_LOG || join(process.cwd(), '.thetacog', 'witness-gaps.ndjson');

const sha256 = (s) => createHash('sha256').update(Buffer.isBuffer(s) ? s : Buffer.from(String(s ?? ''), 'utf8')).digest('hex');
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
export const receiptBytes = (r) => JSON.stringify(sortKeys(r));   // sorted keys, no whitespace — the gateway's canonicalBytes rule

const specText = (spec) => typeof spec === 'string' ? spec : spec && typeof spec.text === 'string' ? spec.text : JSON.stringify(spec ?? null);
const specLane = (spec) => spec && typeof spec === 'object' && typeof spec.lane === 'string' ? spec.lane : null;

// The placement projection: ONLY coordinates and scalars off the walk — never a string the walk might echo from its input.
// Lane / label names come from the reef's own vocabulary; every other field is numeric or a coordinate.
const COORD = /^[A-C][1-3]?(,[A-C][1-3]?)?$/;
export function projectPlacement(result, why = null) {
  if (!result || !result.pixel) return { status: 'UNMEASURED', why: String(why || 'the walk returned no pixel').slice(0, 120) };
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
  const coords = (a) => Array.isArray(a) ? a.filter((c) => typeof c === 'string' && COORD.test(c)) : [];
  return {
    status: 'MEASURED',
    pixel: COORD.test(String(result.pixel)) ? String(result.pixel) : null,
    block: Array.isArray(result.block) ? result.block.map(num) : null,
    fence: result.fence && typeof result.fence === 'object' ? { c0: num(result.fence.c0), c1: num(result.fence.c1), r0: num(result.fence.r0), r1: num(result.fence.r1) } : null,
    sigma: num(result.sigma), fill_pct: num(result.fill_pct), hops: num(result.hops),
    in_role: coords(result.in_role), out_of_role: coords(result.out_of_role),
    admissible: !!(result.ratchet && result.ratchet.admissible),
    sensor: typeof result.sensor === 'string' && /^[a-z-]{1,16}$/.test(result.sensor) ? result.sensor : null,
  };
}

// DEFAULT PLACER — the one door. lensWalk is imported lazily so the guard (which injects `place`) never spawns the binary.
export async function loadDefaultPlace() {
  const { lensWalk } = await import('../../src/lib/pmu/walk-door.mjs');
  return (turn, spec) => {
    const { result, row } = lensWalk(turn, { source: 'turn', lane: specLane(spec), timeoutMs: 5000 });
    return projectPlacement(result, row && (row.error || row.err));
  };
}

// DEFAULT SIGNER — the thetacog-sign path, verbatim in shape: auth-flow.mjs sign over stdin, allowlisted env.
export async function loadDefaultSign() {
  const { canonical } = await import('../../src/lib/vna/row-canonical.mjs');
  const flow = join(PKG, 'scripts', 'vna', 'auth-flow.mjs');
  return (bytes) => {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (k === 'PATH' || k === 'HOME' || k === 'TMPDIR' || k === 'USER' || /^(VNA_|THETACOG_|MESH_|PMU_|LENS_SESSION_ID$|CLAUDE_SESSION_ID$|TERM_PROGRAM$)/.test(k)) env[k] = v;
    const r = spawnSync('node', [flow, 'sign', '--bytes', '-', '--json'], { cwd: PKG, env, input: bytes, encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
    let out = null; try { out = JSON.parse(String(r.stdout || '').trim().split('\n').pop() || 'null'); } catch { out = null; }
    const row = out && out.row;
    if (!row || !row.sig || !row.sig_pubkey) throw new Error(`the signer answered nothing: ${String(r.stderr || r.stdout || '').slice(0, 200)}`);
    return { sig: row.sig, pubkey: row.sig_pubkey, signed_bytes: canonical(row), licence: out.status || null };
  };
}

export function appendGap(gapLog, line) {
  mkdirSync(dirname(gapLog), { recursive: true });
  appendFileSync(gapLog, JSON.stringify(line) + '\n');   // append-only: a GAP line is never rewritten or removed here
}

// witnessTurn — returns { receipt, body, posted } as soon as the receipt is signed. `posted` resolves to { ok, status } or
// { ok:false, gap } and NEVER rejects: the caller is not blocked and not thrown at by the network.
export function witnessTurn({ spec, turn, place, sign, fetch = globalThis.fetch, url = DEFAULT_INGEST_URL, gapLog = DEFAULT_GAP_LOG, now = () => new Date().toISOString() } = {}) {
  if (typeof turn !== 'string') throw new TypeError('witnessTurn: turn must be the turn text (a string)');
  if (typeof place !== 'function' || typeof sign !== 'function') throw new TypeError('witnessTurn: place and sign are required (use witness() for the defaults)');
  const placement = place(turn, spec);
  const receipt = { kind: 'turn-witness', v: 1, turn_sha: sha256(turn), spec_sha: sha256(specText(spec)), placement, timestamp: now() };
  const bytes = receiptBytes(receipt);
  receipt.receipt_sha = sha256(bytes);
  const signature = sign(bytes);
  const body = { records: [{ ...receipt, signature }] };
  const gap = (why) => { const line = { kind: 'GAP', at: now(), receipt_sha: receipt.receipt_sha, turn_sha: receipt.turn_sha, spec_sha: receipt.spec_sha, url, why: String(why).slice(0, 200) }; try { appendGap(gapLog, line); } catch { /* the log itself is unwritable — nothing further to do */ } return { ok: false, gap: line }; };
  let posted;
  try {
    posted = Promise.resolve(fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      .then((res) => (res && res.ok ? { ok: true, status: res.status } : gap(`HTTP ${res ? res.status : 'no response'}`)), (e) => gap(e && e.message || e));
  } catch (e) { posted = Promise.resolve().then(() => gap(e && e.message || e)); }
  return { receipt, body, posted };
}

// witness — the same call with the one door and the thetacog-sign signer wired in.
export async function witness(opts = {}) {
  return witnessTurn({ ...opts, place: opts.place || await loadDefaultPlace(), sign: opts.sign || await loadDefaultSign() });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const specFile = flag('--spec-file'), turnFile = flag('--turn-file');
  if (!specFile || !turnFile) { process.stderr.write('witness-turn: --spec-file S --turn-file T [--lane L] [--url URL] [--gap-log PATH] [--json]\n'); process.exit(1); }
  const spec = { text: readFileSync(specFile, 'utf8'), ...(flag('--lane') ? { lane: flag('--lane') } : {}) };
  const { receipt, posted } = await witness({ spec, turn: readFileSync(turnFile, 'utf8'), url: flag('--url') || DEFAULT_INGEST_URL, gapLog: flag('--gap-log') || DEFAULT_GAP_LOG });
  const r = await posted;
  process.stdout.write((argv.includes('--json') ? JSON.stringify({ receipt, posted: r }) : `${receipt.placement.pixel || receipt.placement.status} · receipt ${receipt.receipt_sha.slice(0, 12)} · ${r.ok ? 'witnessed' : 'GAP logged'}`) + '\n');
}
