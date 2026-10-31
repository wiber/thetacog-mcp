#!/usr/bin/env node
// scripts/vna/steer-plan.mjs — C188: the THIN wrapper over `pmu-onchip --steer-plan`.
//
// The planner (which CLEAR rows run together, in what order) DECIDES, so it lives in the crate
// (.thetacog/pmu/src/steer_plan.rs, MAXIMISE RUST). This file only: builds stdin from the rows it is given,
// reads the slot count from free memory, spawns the binary, prints its JSON verbatim. There is NO node
// planning logic here and there must never be one — when the binary is missing or does not know the mode
// it prints `steer-plan: UNMEASURED — pmu-onchip not built` and exits 3, and the caller (C186) runs ONE
// row at a time.
//
// Usage:
//   node scripts/vna/steer-plan.mjs --rows rows.json [--slots k] [--last-pixel "A1,B2"]
//   echo '{"rows":[...],"last_pixel":"A,B"}' | node scripts/vna/steer-plan.mjs
// rows.json is either {rows:[{id,paths,pixel}], last_pixel} or a bare array of rows.
//
// THE SLOT TABLE (C168d memory reading; the reading is printed on stderr beside the slot count):
//   free + inactive RAM ≥ 6 GB → 3 slots · ≥ 3 GB → 2 · else 1.
//   Swap used ≥ 4 GB lowers the result by one (floor 1): the machine is already paging, a new worker pages harder.
//   --slots k overrides the table (the reading is still printed).
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary, PMU_SPAWN_DEADLINE } from '../../src/lib/pmu/pmu-binary.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UNMEASURED = 'steer-plan: UNMEASURED — pmu-onchip not built';
const GB = 1024 ** 3;

/** vm_stat free+inactive and sysctl swap used, in bytes; nulls when unreadable (never a guessed number). */
export function readMemory() {
  let freeBytes = null, swapUsedBytes = null;
  try {
    const vm = execFileSync('vm_stat', { encoding: 'utf8', timeout: 5000 });
    const page = Number((vm.match(/page size of (\d+) bytes/) || [])[1]);
    const pages = (k) => Number((vm.match(new RegExp(`Pages ${k}:\\s+(\\d+)`)) || [])[1]);
    if (page && Number.isFinite(pages('free')) && Number.isFinite(pages('inactive'))) freeBytes = (pages('free') + pages('inactive')) * page;
  } catch { /* not macOS or vm_stat absent */ }
  try {
    const sw = execFileSync('sysctl', ['vm.swapusage'], { encoding: 'utf8', timeout: 5000 });
    const m = sw.match(/used = ([\d.]+)([MG])/);
    if (m) swapUsedBytes = Number(m[1]) * (m[2] === 'G' ? GB : 1024 ** 2);
  } catch { /* no swap reading */ }
  return { freeBytes, swapUsedBytes };
}

/** the documented table above; an unreadable reading is 1 slot (the safe count, never a guess upward). */
export function slotsFor({ freeBytes, swapUsedBytes }) {
  if (freeBytes == null) return 1;
  let s = freeBytes >= 6 * GB ? 3 : freeBytes >= 3 * GB ? 2 : 1;
  if (swapUsedBytes != null && swapUsedBytes >= 4 * GB) s -= 1;
  return Math.max(1, s);
}

const gb = (b) => (b == null ? 'unread' : `${(b / GB).toFixed(1)} GB`);
export const describeReading = (r, slots, overridden) =>
  `steer-plan: slots ${slots}${overridden ? ' (--slots override)' : ''} ← free+inactive ${gb(r.freeBytes)}, swap used ${gb(r.swapUsedBytes)} (table: ≥6 GB→3 · ≥3 GB→2 · else 1; swap ≥4 GB −1)`;

/** spawn the crate. Returns { ok:true, raw, plan } or { ok:false } (binary missing / mode unknown). */
export function steerPlan(rows, { lastPixel = null, slots = 1 } = {}) {
  const bin = resolvePmuBinary(REPO);
  if (!bin || !existsSync(bin)) return { ok: false, why: 'no binary at ' + bin };
  const input = JSON.stringify({ rows, last_pixel: lastPixel });
  let raw;
  try {
    raw = execFileSync(bin, ['--steer-plan', '--slots', String(slots)], { input, encoding: 'utf8', maxBuffer: 1 << 24, ...PMU_SPAWN_DEADLINE });
  } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 160) }; }
  const line = raw.trim().split('\n').pop() || '';
  let plan; try { plan = JSON.parse(line); } catch { return { ok: false, why: 'binary did not print JSON (mode unknown?)' }; }
  if (!plan || plan.engine !== 'rust-steer-plan') return { ok: false, why: 'engine did not name itself (mode unknown)' };
  return { ok: true, raw: line, plan };
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  let text;
  if (arg('--rows')) text = readFileSync(resolve(arg('--rows')), 'utf8');
  else { try { text = readFileSync(0, 'utf8'); } catch { text = ''; } }
  let doc; try { doc = JSON.parse(text || '[]'); } catch (e) { process.stderr.write(`steer-plan: bad rows JSON — ${e.message}\n`); process.exit(2); }
  const rows = Array.isArray(doc) ? doc : (doc.rows || []);
  const lastPixel = arg('--last-pixel') ?? (Array.isArray(doc) ? null : (doc.last_pixel ?? null));
  const reading = readMemory();
  const override = arg('--slots');
  const slots = override ? Math.max(1, parseInt(override, 10) || 1) : slotsFor(reading);
  process.stderr.write(describeReading(reading, slots, !!override) + '\n');
  const out = steerPlan(rows, { lastPixel, slots });
  if (!out.ok) { process.stdout.write(UNMEASURED + '\n'); process.exit(3); }
  process.stdout.write(out.raw + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
