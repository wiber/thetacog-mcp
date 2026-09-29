// scripts/lib/panel-provenance.mjs — sign a published encircled panel with the machine that made it,
// and say in the same signed body what was tested on that hardware and what was not.
//
// Operator 2026-09-26: "the PNG circle panels … those are the Hardware ones, those are based on the L1
// ballistic walk, so we should sign them by metadata … include all the information we need about what
// is Hardware testing and what is not." Spec row C339 (R1–R3, R5).
//
// THE IMAGE IS NOT TOUCHED. One iTXt chunk (keyword `thetadriven:provenance`) is inserted before IEND;
// IHDR/IDAT are byte-for-byte what the one pipeline emitted, so the pixel-identity proof in
// tests/pmu-simulator/one-encircled-pipeline.test.mjs still holds and `pixels_sha256` (IHDR+IDAT data)
// is the recomputable part. The signature is the host ed25519 key from receipt-crypto.mjs — a key file
// on this machine, NOT a chip-held key — and the body says so in `not_tested`, because a signature that
// let a reader assume Secure Enclave / TPM would be the overclaim C339 R5 forbids ("hardware-attested").
//
// SIGN ONLY AT PRODUCTION. A panel rendered on another machine or another day must never be stamped
// after the fact: the body asserts "this binary on this machine produced these pixels", which a backfill
// cannot know. There is deliberately no `sign` CLI over existing files — only `verify` and `show`.
//
//   node scripts/lib/panel-provenance.mjs verify <png>   # exit 0 iff signature + pixels check
//   node scripts/lib/panel-provenance.mjs show <png>     # print the signed body
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { cpus, arch, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sealReceipt, verifyReceipt } from '../pmu/receipt-crypto.mjs';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';   // THE ONE resolver

export const KEYWORD = 'thetadriven:provenance';
export const SCHEMA = 'thetadriven.panel-provenance/v1';
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ── chunk plumbing ────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
export function chunks(png) {
  if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  const out = []; let o = 8;
  while (o + 8 <= png.length) {
    const n = png.readUInt32BE(o); const type = png.toString('ascii', o + 4, o + 8);
    out.push({ type, data: png.subarray(o + 8, o + 8 + n), raw: png.subarray(o, o + 12 + n) });
    o += 12 + n; if (type === 'IEND') break;
  }
  return out;
}
const isOurs = (c) => c.type === 'iTXt' && c.data.subarray(0, KEYWORD.length).toString('latin1') === KEYWORD && c.data[KEYWORD.length] === 0;

// The recomputable part: the image as the pipeline emitted it (IHDR + every IDAT, data only).
export function pixelsSha256(png) {
  const h = createHash('sha256');
  for (const c of chunks(png)) if (c.type === 'IHDR' || c.type === 'IDAT') h.update(c.data);
  return h.digest('hex');
}

// ── what this machine is (R1) and which binary walked (R2) ────────────────────────────────────
function sysctl(name) { try { return execFileSync('sysctl', ['-n', name], { encoding: 'utf8', timeout: 500 }).trim(); } catch { return null; } }
function sysfs(p) { try { return readFileSync(p, 'utf8').trim(); } catch { return null; } }
export function platformFingerprint() {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const f = { cpu_model: cpus()[0]?.model ?? null, cpu_count: cpus().length, arch: arch(), os: `${platform()} ${release()}` };
  if (platform() === 'darwin') {
    Object.assign(f, { cache_line_bytes: num(sysctl('hw.cachelinesize')), l1d_bytes: num(sysctl('hw.l1dcachesize')), l2_bytes: num(sysctl('hw.l2cachesize')) });
  } else if (platform() === 'linux') {
    const base = '/sys/devices/system/cpu/cpu0/cache';
    Object.assign(f, { cache_line_bytes: num(sysfs(`${base}/index0/coherency_line_size`)), l1d_size: sysfs(`${base}/index0/size`), l2_size: sysfs(`${base}/index2/size`) });
  }
  return f;
}
const _binSha = new Map();
export function walkBinary() {
  let path = null;
  try { path = resolvePmuBinary(process.cwd()); } catch { path = null; }
  if (!path || !existsSync(path)) return { path: path || null, sha256: null, unmeasured: 'pmu-onchip binary not resolvable from this process' };
  if (!_binSha.has(path)) _binSha.set(path, createHash('sha256').update(readFileSync(path)).digest('hex'));
  return { path, sha256: _binSha.get(path) };
}

// ── R3: the boundary-probe reading, only when it is THIS machine's and FRESH ──────────────────────
// `boundaryProbe` is the shape flight-tape.mjs's `boundaryProbeFor()` returns (duck-typed here so this
// module never imports flight-tape.mjs — the caller reads its own probe and hands it in, never assumed).
// Absent, not admissible, or older than the window → UNMEASURED with why, never a borrowed number (C339 R3).
export const MAX_PROBE_AGE_DAYS = 7;
export function freshBoundaryProbe(bp, { maxAgeDays = MAX_PROBE_AGE_DAYS, now = Date.now() } = {}) {
  const UNMEASURED_DEFAULT = 'no boundary-probe reading is bound to this panel yet (C339 R3)';
  if (!bp || bp.status !== 'MEASURED') return { status: 'UNMEASURED', why: (bp && bp.why) || UNMEASURED_DEFAULT };
  if (bp.admissible !== true) return { status: 'UNMEASURED', why: 'the boundary probe ran but was NOT ADMISSIBLE — the control band failed' };
  const at = bp.at ? Date.parse(bp.at) : NaN;
  if (!Number.isFinite(at)) return { status: 'UNMEASURED', why: 'the boundary probe reading carries no timestamp' };
  const ageDays = (now - at) / 86400000;
  if (ageDays > maxAgeDays) return { status: 'UNMEASURED', why: `the boundary probe reading is ${ageDays.toFixed(1)} days old — stale past the ${maxAgeDays}-day window, never a borrowed number` };
  return { status: 'MEASURED', median: bp.median, min: bp.min, max: bp.max, runs: bp.runs, admissible: true, machine: bp.machine, at: bp.at, age_days: Number(ageDays.toFixed(2)) };
}

// ── the signed body ───────────────────────────────────────────────────────────────────────────
// `walkEngine` is what the pipeline's own stage record says ran (panel-door meta.walkEngine); the body
// only claims the Rust walk when the caller passes that record, never by assumption. `boundaryProbe` is
// likewise only ever what the CALLER read (e.g. `flight-tape.mjs`'s `boundaryProbeFor()`) — this module
// never re-probes on its own, the same discipline as walkEngine above.
export function buildProvenance({ png, subject = null, walkEngine = null, apertureVersion = null, boundaryProbe = null } = {}) {
  const rustWalk = walkEngine === 'rust-ballistic-walk';
  const bin = walkBinary();
  const bp = freshBoundaryProbe(boundaryProbe);
  const rung3 = bp.status === 'MEASURED';
  const body = {
    schema: SCHEMA,
    subject,                                         // the commit sha (or other id) the panel places
    pixels_sha256: pixelsSha256(png),
    walk_engine: walkEngine,
    aperture_version: apertureVersion,
    binary: bin,
    platform: platformFingerprint(),
    boundary_probe: rung3 ? bp : { unmeasured: bp.why },
    signed_at: new Date().toISOString(),
    hardware: {
      tested: rustWalk && bin.sha256 ? [
        'The placement: these pixels were produced by the pmu-onchip ballistic walk (binary sha256 above) executing on the machine described in `platform` — positions resolved as addresses, walked row→column→row on this CPU (AXIOM 0 rung 1 — rung 2, dependent-load latency, is a separate probe not run here).',
      ] : [],
      not_tested: [
        ...(rustWalk && bin.sha256 ? [] : ['Which engine walked: the pipeline did not report the Rust walk, or its binary could not be hashed — treat the placement as unattested.']),
        ...(rung3 ? [] : [`The boundary-crossing cost on this machine (rung 3): ${bp.why}`]),
        'A chip-held key: the signature is a host ed25519 key stored as a file on this machine, not a Secure Enclave / TPM key. This is not "hardware-attested".',
        'The raw MSR / perf-counter read (rung 4): apparatus scope, never shipped default.',
        'Whether the work is correct: undecidable (Rice). The panel is sufficient for WHERE the work landed against a declaration, not WHETHER it is right.',
      ],
      recompute: 'Same commit + same binary + same aperture → same pixels_sha256, on any machine. The platform fields say where THIS copy was made.',
    },
  };
  return sealReceipt(body);
}

// ── R5: the wording gate — "hardware-tested" is earned, never assumed ──────────────────────────
// True only when the signed body carries R1 (platform), R2 (binary sha256) AND R3 (an admissible,
// fresh boundary-probe reading) — otherwise the weaker, still-true "hardware-testable" phrasing.
// NEVER "hardware-attested" (that names a chip-held key — TEE / Secure Enclave / TPM, which this is not).
export const HARDWARE_TESTED_PHRASE = 'hardware-tested on the machine that signed it';
export const HARDWARE_TESTABLE_PHRASE = 'hardware-testable — run `pmu-onchip --boundary-probe` and watch the control';
export function hardwareClaimWording(provenance) {
  const p = provenance || {};
  const r1 = !!(p.platform && p.platform.cpu_model && p.platform.arch);
  const r2 = !!(p.binary && p.binary.sha256);
  const r3 = !!(p.boundary_probe && p.boundary_probe.status === 'MEASURED' && p.boundary_probe.admissible === true);
  return r1 && r2 && r3 ? HARDWARE_TESTED_PHRASE : HARDWARE_TESTABLE_PHRASE;
}

// Insert (or replace) our iTXt chunk before IEND. IHDR/IDAT untouched.
export function embedProvenance(png, sealed) {
  const text = Buffer.from(JSON.stringify(sealed), 'utf8');
  // iTXt: keyword \0 compression-flag compression-method language \0 translated-keyword \0 text
  const data = Buffer.concat([Buffer.from(KEYWORD, 'latin1'), Buffer.from([0, 1, 0, 0, 0]), deflateSync(text)]);
  const parts = [PNG_SIG];
  for (const c of chunks(png)) {
    if (isOurs(c)) continue;
    if (c.type === 'IEND') parts.push(chunk('iTXt', data));
    parts.push(c.raw);
  }
  return Buffer.concat(parts);
}

export function signPanelPng(png, opts = {}) {
  return embedProvenance(png, buildProvenance({ ...opts, png }));
}

export function readProvenance(png) {
  const c = chunks(png).find(isOurs);
  if (!c) return null;
  const compressed = c.data[KEYWORD.length + 1] === 1;
  // skip keyword\0, flag, method, language\0, translated\0
  let o = KEYWORD.length + 3; o = c.data.indexOf(0, o) + 1; o = c.data.indexOf(0, o) + 1;
  const payload = c.data.subarray(o);
  return JSON.parse((compressed ? inflateSync(payload) : payload).toString('utf8'));
}

export function verifyPanelPng(png) {
  const p = readProvenance(png);
  if (!p) return { ok: false, reason: 'no provenance chunk — unsigned panel' };
  const sig = verifyReceipt(p);
  if (!sig.ok) return { ok: false, reason: `signature: ${sig.reason}` };
  if (p.pixels_sha256 !== pixelsSha256(png)) return { ok: false, reason: 'pixels do not match the signed pixels_sha256' };
  return { ok: true, provenance: p };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, file] = process.argv.slice(2);
  if (!['verify', 'show'].includes(cmd) || !file) { console.error('usage: panel-provenance.mjs verify|show <png>'); process.exit(2); }
  const buf = readFileSync(file);
  if (cmd === 'show') { console.log(JSON.stringify(readProvenance(buf), null, 2)); process.exit(0); }
  const v = verifyPanelPng(buf);
  console.log(v.ok ? `✓ signed by ${v.provenance.pubkey_hex.slice(0, 16)}… on ${v.provenance.platform.cpu_model} · pixels match` : `✗ ${v.reason}`);
  process.exit(v.ok ? 0 : 1);
}
