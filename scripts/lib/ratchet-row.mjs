// scripts/lib/ratchet-row.mjs — C336e ONE DOOR FOR A RATCHET LEDGER ROW, AND IT CARRIES n.
//
// The census (scripts/vna/ratchet-census.mjs) reads a target's latest reading off its own ledger and calls it UNMEASURED when
// the row carries no n. 34 of 56 targets were UNMEASURED on 2026-09-26, most because each writer hand-rolled its append and
// none was made to say how many things the value was computed over. This is the one append every ratchet writer uses:
//   · n is REQUIRED — a finite number ≥ 0, the count the value was computed over (never a typed constant). A row without it is
//     refused with a throw, so the defect is a red run at the writer, never a silent UNMEASURED three weeks later.
//   · n = 0 is written honestly (the census keeps it UNMEASURED — an n of 0 is not a reading).
//   · the ledger path is `<floor stem>-ratchet.ndjson` beside the floor, so the census attaches it to the floor's row by stem.
// Sufficient for: the row exists and says its own sample size. NOT sufficient for: whether that n is the right population.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function ledgerFor(floorPath) {
  return floorPath.replace(/-floors?\.json$/, '-ratchet.ndjson').replace(/\.json$/, '-ratchet.ndjson');
}

export function ratchetRow(row) {
  if (!row || typeof row !== 'object') throw new Error('ratchet-row: a row is an object');
  if (typeof row.n !== 'number' || !Number.isFinite(row.n) || row.n < 0) {
    throw new Error(`ratchet-row: refused — n must be the count the value was computed over (got ${JSON.stringify(row.n)})`);
  }
  return { ts: row.ts || new Date().toISOString(), ...row };
}

export function appendRatchetRow(ledgerPath, row) {
  const r = ratchetRow(row);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, JSON.stringify(r) + '\n');
  return r;
}
