// scripts/vna/crate-call.mjs — C612q: THE ONE SHUTTLE TO THE CRATE for the retrievers, the walk licence and the RCT read.
//
// The decisions live in packages/thetacog-mcp/intentguard/src/walk_lens.rs (mod c612q, mirrored byte for byte at packages/thetacog-mcp/intentguard/src/walk_lens.rs):
//   --cond-bits-batch  (C612d)  repo-as-spec-gain.mjs condBitsBatch
//   --structural-key   (C612k)  repo-as-spec-gain.mjs structuralKey · retrieve('structural-precedent')
//   --walk-admits      (C582a)  read-set.mjs walkAdmits · cellsAdmit · measuredLicence
//   --rct-read         (C610f)  forecast-rct.mjs readRct
// This file only moves JSON: it writes the payload on the chip's stdin and parses the one line it prints. The mjs bodies stay
// beside each caller as the REFERENCE, reached only when VNA_C612Q_MJS=1 (the parity receipt and the guard set it on purpose).
// A missing binary is never a silent fall back to the mjs decision: crateCall throws CRATE_ABSENT and each caller says what
// happens then (the walk's leaf stands; the offline scorers stop).
// @guard tests/vna/c612q-the-retrievers-and-the-rct-in-the-crate.test.mjs
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary, PMU_SPAWN_DEADLINE } from '../../src/lib/pmu/pmu-binary.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MJS_REFERENCE_ENV = 'VNA_C612Q_MJS';
export const CRATE_ABSENT = 'C612q: UNMEASURED — pmu-onchip not built (the decision lives in the crate; set VNA_C612Q_MJS=1 for the mjs reference)';
/** true only when the caller asked for the mjs reference path on purpose */
export const mjsReference = () => process.env[MJS_REFERENCE_ENV] === '1';

/** One call: payload → the chip's JSON. Throws CRATE_ABSENT when no binary, or the chip's own error when it fails. */
// C612t: THE DAEMON RELAY — the three small subcommands are answered by the long-lived --door-serve process ({op:"crate"}, door.rs
// c612q_serve over the same lens::c612q functions), so a call no longer pays for loading a fresh chip. The relay exits 3 (no daemon)
// or 4 (deadline) and the call falls back to the one-shot spawn; VNA_C612T_RELAY=0 forces the spawn (the before-timing reference).
export const RELAYED = Object.freeze(['--structural-key', '--structural-rank', '--walk-admits', '--rct-read']);
export const RELAY_ENV = 'VNA_C612T_RELAY';
export const SOCK = process.env.PMU_DOOR_SOCK || resolve(REPO, '.thetacog/door-serve.sock');
export let lastRoute = null;
export function relayCall(bin, flag, payload, { sock = SOCK } = {}) {
  if (process.env[RELAY_ENV] === '0' || !RELAYED.includes(flag) || !existsSync(sock)) return null;
  try {
    const raw = execFileSync(bin, ['--door-serve', '--relay', sock, '--timeout-ms', '30000'], { input: JSON.stringify({ op: 'crate', flag, payload }) + '\n', encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] });
    const r = JSON.parse(raw.trim().split('\n')[0] || 'null');
    return r && r.out && typeof r.out === 'object' ? r.out : null;   // a daemon older than C612t answers {error}: spawn instead
  } catch { return null; }
}
export function crateCall(flag, payload, { engine = null } = {}) {
  const bin = resolvePmuBinary(REPO);
  if (!bin || !existsSync(bin)) throw new Error(CRATE_ABSENT);
  let out = relayCall(bin, flag, payload); lastRoute = out ? 'relay' : 'spawn';
  if (!out) {
  const raw = execFileSync(bin, [flag], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 1 << 28, ...PMU_SPAWN_DEADLINE });
  const line = raw.trim().split('\n').pop() || '';
  try { out = JSON.parse(line); } catch { throw new Error(`C612q: ${flag} did not print JSON (mode unknown to this binary? rebuild it)`); }
  }
  if (engine && out.engine !== engine) throw new Error(`C612q: ${flag} did not name itself ${engine} (stale binary?)`);
  return out;
}
// ── C621: ONE DOOR TO THE BINARY — the three spawn shapes the 2026-10-02/03 ports each wrote for themselves (path-prediction's
// stdin scorer and --path doc, return-reading's async relay) live here once, beside crateCall. A caller may hand in the chip it
// resolved (path-prediction's chipPath keeps its own search order); the spawn, the deadline and the error text are this file's.
// @guard tests/vna/c621-one-door-to-the-binary.test.mjs
export const binary = () => resolvePmuBinary(REPO);
const failed = (flag, r) => new Error(`pmu-onchip ${flag} exited ${r.status}${r.signal ? ` (${r.signal})` : ''}: ${(r.stderr || '').slice(0, 300)}`);
/** crateStdin(flag, doc, { chip }) — one spawn, the doc on stdin, the chip's whole stdout parsed as JSON */
export function crateStdin(flag, doc, { chip = binary(), timeout = 600000 } = {}) {
  const r = spawnSync(chip, [flag], { input: typeof doc === 'string' ? doc : JSON.stringify(doc), encoding: 'utf8', maxBuffer: 1 << 28, timeout, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw failed(flag, r);
  return JSON.parse(r.stdout);
}
/** crateFile(flag, doc, { chip }) — one spawn, the doc by --path (never stdin: a stdin handed over by spawnSync was seen held open
 *  twice on 2026-10-03, the child blocked in read(0) for minutes), the chip's whole stdout parsed as JSON */
let SEQ = 0;
export function crateFile(flag, doc, { chip = binary(), timeout = 600000 } = {}) {
  const dir = join(tmpdir(), 'pmu-path-bind'); mkdirSync(dir, { recursive: true });
  const f = join(dir, `${process.pid}-${++SEQ}.json`); writeFileSync(f, JSON.stringify(doc));
  try {
    const r = spawnSync(chip, [flag, '--path', f], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28, timeout, killSignal: 'SIGKILL' });
    if (r.status !== 0) throw failed(flag, r);
    return JSON.parse(r.stdout);
  } finally { try { unlinkSync(f); } catch { /* gone */ } }
}
/** relayAsync(req, { sock, deadlineMs, chip }) — one request line through the --door-serve daemon relay, never past deadlineMs (+60 ms
 *  to reap): the parsed first answer line, or null (no daemon, deadline, a non-zero exit, unparseable) — the hook's fast leg */
export function relayAsync(req, { sock = SOCK, deadlineMs = 30000, chip = binary() } = {}) {
  return new Promise((ok) => {
    let out = '', done = false; const fin = (v) => { if (!done) { done = true; ok(v); } };
    try {
      const c = spawn(chip, ['--door-serve', '--relay', sock, '--timeout-ms', String(deadlineMs)], { stdio: ['pipe', 'pipe', 'ignore'] });
      const t = setTimeout(() => { try { c.kill(); } catch {} fin(null); }, deadlineMs + 60);
      c.stdout.on('data', (d) => { out += d; }); c.on('error', () => { clearTimeout(t); fin(null); });
      c.on('close', (code) => { clearTimeout(t); if (code !== 0) return fin(null); try { fin(JSON.parse(out.trim().split('\n')[0])); } catch { fin(null); } });
      c.stdin.on('error', () => {}); c.stdin.end(req);
    } catch { fin(null); }
  });
}
/** strip the chip's own fields (engine, compute_ms) so the returned shape is the mjs shape */
export function bare(out) { const { engine, compute_ms, ...rest } = out; return rest; }
