#!/usr/bin/env node
// scripts/pmu/slice-descent.mjs — N2a: THE WALK DESCENDS (cb1-split-chain-spec §2.1).
//
// When a payload's depth-0 placement lands on a SPLIT cell (a sub-well exists at
// data/pmu/reef-l1/<R>-<C>.json), the walk does not bounce off the full bucket — it recurses one
// level down: the SAME definerWalk144 daemon, the SAME binary-grip grid construction the E1
// slice-walk proved (level-0 collapse payload: 2 hops at depth-0 → 100+ in the slice), pointed at
// the sub-well's 144 child dumps. Scale-invariance is the whole point: one walk, every level.
//
// Returns { child_coord, hops, lit, ms, lineageLine } — the lineage line uses the descent dialect
//   `plyD1: B,C1/A2,B3(0.52) …` (D1 = one level below the last L0 ply; parent "/" child)
// which split-pressure's parseLineage and the join-totality guard both understand (evolved in the
// same commit — one parser, all consumers). NEVER analytic: if the daemon is unavailable the
// descent returns null and the caller records nothing — a missing walk is never simulated.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
const sim = (a, b, za = null) => {
  const ga = za ?? gz(a), gb = gz(b), gab = gz(`${a}\n${b}`);
  const d = Math.max(ga, gb);
  return d === 0 ? 0 : 1 - (gab - Math.min(ga, gb)) / d;
};

export function subWellPath(coord) {
  return resolve(REPO, 'data/pmu/reef-l1', `${String(coord).replace(',', '-')}.json`);
}
export function hasSubWell(coord) { return existsSync(subWellPath(coord)); }

/**
 * Descend into `parentCoord`'s sub-well with `payloadText`.
 * Same walk, one level down. Returns null when there is no sub-well or no daemon —
 * the caller must treat null as "no descent recorded", never fabricate one.
 */
export async function descend(payloadText, parentCoord, opts = {}) {
  const p = subWellPath(parentCoord);
  if (!existsSync(p)) return null;
  let well; try { well = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  const cells = (well.cells || []).filter((c) => String(c.snippet || '').length >= 80);
  if (cells.length < 24) return null;   // a starved slice cannot grade a walk honestly

  let definerWalk144, COORDS;
  try { ({ definerWalk144, COORDS } = await import(resolve(HERE, 'definer-walk-144.mjs'))); }
  catch { return null; }                 // no daemon → no descent, never a simulation

  const zp = gz(payloadText);
  const byCoord = new Map((well.cells || []).map((c) => [c.coord, String(c.snippet || '')]));
  const scores = new Array(144).fill(0);
  for (let i = 0; i < 144; i++) {
    const dump = byCoord.get(COORDS[i]) || '';
    if (dump.length < 80) continue;
    scores[i] = sim(payloadText, dump, zp);
  }
  const sorted = [...scores].sort((a, b) => b - a);
  const theta = sorted[Math.min(60, sorted.length - 1)] || 0;
  const grid = new Uint8Array(144);
  let lit = 0;
  for (let i = 0; i < 144; i++) if (scores[i] >= theta && scores[i] > 0) { grid[i] = 1; lit++; }
  const seeds = scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 4).map((x) => x[1]);

  const t0 = Date.now();
  let raw;
  try { raw = await definerWalk144(seeds, { gridBits: grid, maxDepth: opts.maxDepth, budgetMs: opts.budgetMs })   // knobs default to THE ONE HOME (walk-knobs.mjs) and are floored there; the 6/3/3000 literals are gone; }
  catch { return null; }
  const ms = Date.now() - t0;

  // heat argmax = the child placement; top graded children make the lineage line
  let bestI = 0;
  for (let i = 1; i < 144; i++) if ((raw.heat[i] || 0) > (raw.heat[bestI] || 0)) bestI = i;
  const graded = scores.map((v, i) => ({ i, v })).filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v).slice(0, 4)
    .map((x) => `${parentCoord}/${COORDS[x.i]}(${x.v.toFixed(3)})`);
  return {
    child_coord: `${parentCoord}/${COORDS[bestI]}`,
    hops: raw.hops, lit, ms,
    lineageLine: `plyD1: ${graded.join(' ')}`,
  };
}
