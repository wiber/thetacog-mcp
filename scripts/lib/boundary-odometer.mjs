// scripts/lib/boundary-odometer.mjs — the JS ORACLE of the boundary odometer (odometer.rs), integers only.
//
// The crate decides (MAXIMISE RUST: `intentguard::odometer::read` is the home). This file exists so a stranger with
// node and a lens JSON can recompute the receipt's crossing count from the walk's own edge list and lane mask and get
// the same integer, and so one formatter owns the receipt line. Nothing here is a float: a count, a count times three,
// a zero-padded remainder. That is the whole point of retiring σ from the line — σ needed rounding rules in two
// engines; c needs none.
//
// Sufficient for: recomputing c, exits, entries, k_e_milli and the tally string from (edges, lane_mask) exactly as the
// crate does. NOT sufficient for: the edges or the mask themselves (those come from the one Rust walk; a JS walk is
// the AR-1 forbidden stand-in), or whether a crossing was warranted (Rice).
//
// Guard: tests/pmu-simulator/boundary-odometer.test.mjs · the line on every composer: tests/vna/c829-retire-from-every-receipt-line-the.test.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';
import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';   // C829: the ONE caller of the per-text walk; this reader never spawns --lens itself

export const K_E_MILLI = 3;                // k_E = 0.003 per boundary crossing — CLAUDE.md, restated, never re-derived
export const HALF_LIFE_CROSSINGS = 231;    // ln(2)/k_E, in crossings, never days
export const CELL_BYTES = 64;
export const GRID = 144;

/** "0.012" from 12 milli-units. Integer division and a zero-padded remainder. */
export function tallyString(milli) {
  const m = Number(milli);
  if (!Number.isInteger(m) || m < 0) throw new Error(`tallyString: milli must be a non-negative integer, got ${milli}`);
  return `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, '0')}`;
}

/**
 * The read, mirroring odometer::read: edges = [[a, b], …] anchor indices, laneMask = 144 chars of '0'/'1' or a
 * boolean array. An edge naming an anchor outside 0..144 is skipped, never clamped.
 */
export function readOdometer(edges, laneMask) {
  const mask = typeof laneMask === 'string' ? [...laneMask].map((ch) => ch === '1') : laneMask.map(Boolean);
  if (mask.length !== GRID) throw new Error(`readOdometer: lane mask must have ${GRID} entries, got ${mask.length}`);
  let steps = 0, lineCrossings = 0, exits = 0, entries = 0;
  for (const [a, b] of edges) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= GRID || b >= GRID) continue;
    steps += 1;
    if (a !== b) lineCrossings += 1;           // one anchor, one 64-byte line (OD3): the line changes iff the anchor does
    if (mask[a] && !mask[b]) exits += 1;
    else if (!mask[a] && mask[b]) entries += 1;
  }
  const c = exits + entries;
  const k_e_milli = K_E_MILLI * c;
  return {
    steps, line_crossings: lineCrossings, exits, entries, c, k_e_milli,
    k_e_tally: tallyString(k_e_milli),
    ratio: { num: c, den: steps },
    k_e: '0.003', half_life_crossings: HALF_LIFE_CROSSINGS, cell_bytes: CELL_BYTES,
  };
}

/** The lane mask the crate built: anchor i is in lane iff its 12×12 block sits inside the fence box. */
export function laneMaskFromFence(fence, blocks) {
  if (blocks.length !== GRID) throw new Error(`laneMaskFromFence: ${GRID} blocks expected`);
  return blocks.map(([r, c]) => r >= fence.r0 && r <= fence.r1 && c >= fence.c0 && c <= fence.c1);
}

/** The word a line carries when the one Rust walk did not run or refused: never a σ, never a fabricated 0 (C829). */
export const UNMEASURED = 'UNMEASURED';

/**
 * THE RECEIPT LINE. `c=4 · kE=0.012 · cell=C,C · receipt=eed83296`. σ is not on it: the line reports an odometer, not a
 * spread. `crossings` null/undefined → `c=UNMEASURED · kE=UNMEASURED · cell=… · why=<why>` (the four fields stay, and the
 * why says which absence: no-walk, or receipt-carries-no-crossings).
 * `extra` is appended verbatim after the cell (witness-agreement, lens …), each already "k=v".
 * hooks/prepare-commit-msg mirrors this byte for byte in Python; tests/vna/c829-*.test.mjs holds the two equal.
 */
export function receiptLine(crossings, cell, receiptId, extra = [], { why = 'no-walk' } = {}) {
  let c, kE;
  const tail = [];
  if (crossings == null) { c = UNMEASURED; kE = UNMEASURED; tail.push(`why=${String(why).replace(/\s+/g, '-')}`); }   // the why rides the line: no-walk (binary absent/refused) · receipt-carries-no-crossings
  else {
    if (!Number.isInteger(crossings.c) || !Number.isInteger(crossings.k_e_milli)) throw new Error('receiptLine: crossings must carry integer c and k_e_milli');
    if (crossings.k_e_milli !== K_E_MILLI * crossings.c) throw new Error(`receiptLine: k_e_milli ${crossings.k_e_milli} is not ${K_E_MILLI} × c ${crossings.c}`);
    c = crossings.c; kE = tallyString(crossings.k_e_milli);
  }
  const parts = [`c=${c}`, `kE=${kE}`, `cell=${cell == null ? UNMEASURED : cell}`, ...tail, ...extra];
  if (receiptId) parts.push(`receipt=${String(receiptId).slice(0, 8)}`);
  return parts.join(' · ');
}

/**
 * The odometer a receipt or lens JSON carries, or null. Mirrors the hook's lookup (`crossings`, else `lens.crossings`)
 * and admits only the crate's integer shape (k_e_milli = 3·c), so a hand-typed or float count never reaches the line.
 */
export function crossingsFromReceipt(r) {
  if (!r || typeof r !== 'object') return null;
  const od = r.crossings ?? (r.lens && typeof r.lens === 'object' ? r.lens.crossings : null);
  if (!od || typeof od !== 'object') return null;
  if (!Number.isInteger(od.c) || !Number.isInteger(od.k_e_milli) || od.k_e_milli !== K_E_MILLI * od.c) return null;
  return od;
}

/**
 * THE NODE READER (C829): the count is read off the walk JSON `pmu-onchip --lens` already emits — never recomputed here
 * (the oracle above is for a stranger's check, not for the line). Returns { crossings, pixel, sigma, lens } or null when the
 * binary is absent or refuses; the caller prints UNMEASURED. Bounded: one spawn, a deadline, a capped buffer, the lens's
 * own 800-char text cut.
 */
export const LENS_TEXT_MAX = 800;
export function readOdometerFromText(text, { repoRoot = null, bin = null, timeoutMs = 20_000, exec = null } = {}) {
  // THROUGH THE ONE DOOR (tests/pmu-simulator/walk-door.test.mjs: no module other than src/lib/pmu/walk-door.mjs spawns the per-text
  // walk). Source 'lens-cli' returns the walk without landing a row on the actuarial tape (the reader is a check, not an execution).
  const used = String(text ?? '').slice(0, LENS_TEXT_MAX);
  if (!used.trim()) return null;
  try {
    const opts = { source: 'lens-cli', timeoutMs, maxChars: LENS_TEXT_MAX };
    if (repoRoot) opts.repoRoot = repoRoot;
    if (exec) opts.exec = exec;
    const { result: j } = lensWalk(used, opts);
    if (!j || typeof j !== 'object') return null;
    const crossings = crossingsFromReceipt(j);
    if (!crossings || !j.pixel) return null;
    return { crossings, pixel: j.pixel, sigma: j.sigma ?? null, lens: j };
  } catch { return null; }
}

// CLI: node scripts/lib/boundary-odometer.mjs <lens.json>   — recompute from a lens JSON and compare with the crate's own reading
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const lens = JSON.parse(readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8'));
  const mine = readOdometer(lens.edges, lens.lane_mask);
  const theirs = lens.crossings;
  const agree = theirs && mine.c === theirs.c && mine.exits === theirs.exits && mine.entries === theirs.entries && mine.k_e_milli === theirs.k_e_milli && mine.k_e_tally === theirs.k_e_tally;
  console.log(`${agree ? 'AGREE' : 'DISAGREE'}  ${receiptLine(mine, lens.pixel)}  (crate: c=${theirs?.c} kE=${theirs?.k_e_tally})`);
  process.exit(agree ? 0 : 1);
}
