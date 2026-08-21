#!/usr/bin/env node
// scripts/pmu/lens-self-test.mjs — PURELY LOCAL instrument self-check (operator 2026-06-15: "inject a
// purely local lens test… what is the max sigma we can force artificially on the current lens?").
//
// Does NOT touch the commit. It probes the LENS itself (the 144-tile reef) so a LOW σ on a real commit
// can be told apart from a DEAD SENSOR. This is the calibration stamp an underwriter wants: proof the
// instrument CAN read high when there IS drift — so a low reading means "no drift here", not "broken".
//
// Two cheap SimHash probes (no pipeline, microseconds):
//   1. SEPARATION — pairwise Hamming distance between the 144 tile signatures. The MAX separation is the
//      instrument's full-scale deflection: the largest σ-shaped contrast the lens can register. A
//      collapsed lens (all tiles alike) has tiny separation and can discriminate nothing.
//   2. HALF-TILE GRIP — the operator's suggested forced perturbation: delete the FIRST HALF of each
//      seed, re-SimHash, measure how far the signature moved. If a half-truncated tile moves LESS than
//      tiles differ from each other, the lens still recognizes it (robust grip); if it moves as far as
//      a different tile, the lens is brittle.
//
// @guard  tests/pmu-simulator/lens-self-test.test.mjs

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simhash } from '../../src/app/pmu-simulator/signature.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

// Hamming distance between two BigInt signatures (any bit width).
function hamming(a, b) { let x = a ^ b, c = 0; while (x > 0n) { c += Number(x & 1n); x >>= 1n; } return c; }

export function lensSelfTest(libPath = resolve(REPO, 'data/pmu/snippet-library-144.json')) {
  let lib;
  try { lib = JSON.parse(readFileSync(libPath, 'utf8')); } catch { return null; }
  const arr = Array.isArray(lib) ? lib : (lib.anchors || lib.nodes || []);
  const seeds = arr.map((e) => String(e?.snippet || e?.seed || '')).filter((s) => s.length > 1);
  if (seeds.length < 2) return null;
  const sigs = seeds.map((s) => simhash(s));
  // 1. SEPARATION — full pairwise (144²/2 ≈ 10k comparisons, cheap)
  let maxSep = 0, sum = 0, n = 0;
  for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
    const d = hamming(sigs[i], sigs[j]); sum += d; n++; if (d > maxSep) maxSep = d;
  }
  const meanSep = Math.round((sum / n) * 10) / 10;
  // 2. HALF-TILE GRIP — delete the first half of each seed, measure signature drift
  let grip = 0;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const half = s.slice(Math.floor(s.length / 2));   // keep the SECOND half (first half deleted)
    grip += hamming(sigs[i], simhash(half));
  }
  const halfGripBits = Math.round((grip / seeds.length) * 10) / 10;
  // a lens is HEALTHY when its tiles separate widely AND a half-truncated tile stays nearer its origin
  // than a random other tile (grip drift < mean separation). Then the max separation is a real σ ceiling.
  const robust = maxSep > 0 && halfGripBits < meanSep;
  return { tiles: seeds.length, maxSepBits: maxSep, meanSepBits: meanSep, halfGripBits, robust };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = lensSelfTest();
  if (!r) { console.log('(lens unavailable)'); process.exit(0); }
  console.log(`LENS SELF-TEST · ${r.tiles} tiles · max separation ${r.maxSepBits} bits (full-scale ceiling) · mean ${r.meanSepBits} · half-tile grip drift ${r.halfGripBits} bits → ${r.robust ? 'ROBUST (sensor can discriminate; a low σ = no drift, not a dead lens)' : '⚠ DEGRADED (separation collapsed — readings are unreliable)'}`);
}
