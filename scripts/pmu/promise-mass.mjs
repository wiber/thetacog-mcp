#!/usr/bin/env node
// scripts/pmu/promise-mass.mjs — THE TICK/PROMISE APPARATUS (operator 2026-07-21, the unified
// theory: "every operation has an intent, a reality, and a negative — and that needs to be worked
// into the ticks as well… the negative is the king moves around it: as much like this as possible,
// as unique as possible within them. It's not just signal by noise — it's bit rate").
//
// A tick is a PROMISE in the same I/R/N shape as every other operation:
//   INTENT   — the pressure coordinate (the actor⊕patient breadcrumb target: "fill this cell").
//   REALITY  — the payload actually pulled from the repo and seated there.
//   NEGATIVE — the KING-MOVES neighborhood: the ≤8 chebyshev-adjacent cells in the 12×12 (or in
//              the parent's sub-well for child coords). The payload must compress WITH the
//              neighbors (belongs there) yet stay unique AMONG them (adds, never repeats).
//
// THE APPARATUS (three gzips — physics, not heuristics):
//   A = gz(neighborhood) · B = gz(payload) · C = gz(neighborhood + payload)
//   SEMANTIC MASS  = C − A          net-new bytes packed into the area; redundancy crushes to ~0
//   DENSITY        = C / (A + B)    integration tightness; lower = fits the neighborhood
//   UNIQUE         = min NCD(payload, each neighbor) ≥ λ (burn-mass's OWN λ — one constant):
//                    a near-copy of a neighbor is noise wearing mass.
//
// Settlement: a promise SETTLES only when mass_bytes > 0 AND unique. Settled promises ride the
// harvest seal (metrics.promise) — the tape advances on settled mass, and the page's headline
// series becomes BIT RATE: semantic bytes per tick. Pure module, LLM-free, guard-tested.

import { gzipSync } from 'node:zlib';

export const SHORTLEX_AXES = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
const ncd = (a, b) => { const ga = gz(a), gb = gz(b), gab = gz(`${a}\n${b}`); const d = Math.max(ga, gb); return d === 0 ? 1 : (gab - Math.min(ga, gb)) / d; };

/**
 * RADIAL NEIGHBORHOOD (operator 2026-07-21: "not exactly eight — the ones that are CLOSE ENOUGH"):
 * a fixed neighbor count is a 2D chessboard artifact; ShortLex space is sorted and hierarchical,
 * so the Negative boundary is a DISTANCE THRESHOLD — all coords within chebyshev radius r in
 * ShortLex index space. radius 1 ≡ king moves (the compatibility case, and today's default);
 * radius is THE tuning knob as dimensions densify (sub-wells reuse the same function on their
 * own 12×12). Guarded: r=1 equals kingMoves exactly; r=2 is its strict superset.
 */
export function neighborsWithin(coord, radius = 1) {
  const [r, c] = String(coord).split(',');
  const ri = SHORTLEX_AXES.indexOf(r), ci = SHORTLEX_AXES.indexOf(c);
  if (ri < 0 || ci < 0) return [];
  const out = [];
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    if (!dr && !dc) continue;
    const nr = ri + dr, nc = ci + dc;
    if (nr < 0 || nr >= 12 || nc < 0 || nc >= 12) continue;
    out.push(`${SHORTLEX_AXES[nr]},${SHORTLEX_AXES[nc]}`);
  }
  return out;
}

/** King moves on the 12×12: the ≤8 chebyshev-adjacent coords in ShortLex index space. */
export function kingMoves(coord) {
  const [r, c] = String(coord).split(',');
  const ri = SHORTLEX_AXES.indexOf(r), ci = SHORTLEX_AXES.indexOf(c);
  if (ri < 0 || ci < 0) return [];
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = ri + dr, nc = ci + dc;
    if (nr < 0 || nr >= 12 || nc < 0 || nc >= 12) continue;
    out.push(`${SHORTLEX_AXES[nr]},${SHORTLEX_AXES[nc]}`);
  }
  return out;
}

/**
 * The apparatus. `neighbors` = [{coord, text}] for the king moves (caller resolves them from the
 * grid or sub-well); `payload` = the reality being seated. λ defaults to burn-mass's constant —
 * pass it in to keep ONE λ across every consumer (the window-parity law).
 */
export function promiseMass(payload, neighbors, lambda = 0.24) {
  const hood = (neighbors || []).map((n) => String(n.text || '')).filter((t) => t.length >= 40);
  if (!hood.length) return { settled: false, why: 'no neighborhood — a promise needs banks to settle against', mass_bytes: 0 };
  const hoodText = hood.join('\n');
  const A = gz(hoodText), B = gz(String(payload)), C = gz(`${hoodText}\n${payload}`);
  const mass = C - A;
  const density = +(C / (A + B)).toFixed(4);
  let minN = 1;
  for (const t of hood) { const d = ncd(String(payload), t); if (d < minN) minN = d; }
  const unique = minN >= lambda;
  const settled = mass > 0 && unique;
  return {
    settled, mass_bytes: mass, density, min_neighbor_ncd: +minN.toFixed(4),
    why: settled ? `+${mass}B packed at density ${density} (unique: nearest neighbor NCD ${minN.toFixed(3)} ≥ λ)`
      : !unique ? `near-copy of a neighbor (NCD ${minN.toFixed(3)} < λ ${lambda}) — noise wearing mass`
      : 'zero net-new bytes — redundancy crushed by the neighborhood',
  };
}

/**
 * SEAT TOPICALITY (the C,A1 misplacement, 2026-07-21: a baseline-floors sentence seated under
 * the CID-images rule on shared 'floor/history' vocabulary): a payload may seat only if it is
 * strictly closer to ITS OWN anchor (rule + the cell's melded dump) than to a far coordinate's
 * dump. Pure three-input comparator — callers compose the texts; the eval that was missing.
 */
export function seatTopicality(payload, anchorText, awayText) {
  const ours = ncd(String(payload), String(anchorText || ''));
  const away = ncd(String(payload), String(awayText || ''));
  return { ours: +ours.toFixed(4), away: +away.toFixed(4), ok: ours < away };
}

// ── THE MELD + OPPOSITE (moved from reef-demand 2026-07-22: importing reef-demand EXECUTES the
// pipeline — the audit trap; these are pure and live here) ─────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve as _pmResolve, dirname as _pmDirname } from 'node:path';
import { fileURLToPath as _pmFile } from 'node:url';
const _PM_REPO = _pmResolve(_pmDirname(_pmFile(import.meta.url)), '..', '..');
const resolve = _pmResolve;
let _pmLib144 = null, _pmAxisLib = null;
// THE MELD (operator 2026-07-21, the C,A1 misplacement: 'c,a1 should have had the fulltext of
// both those in there… plus whatever else we need for the hunter'): the coordinate's own
// actor ⊕ patient definitions, from the human-authored axis library. This text anchors every
// seat decision — without it the fit is lexical drift-prone (a baseline-floors sentence seated
// under the CID-images rule because they shared 'floor/history' vocabulary).
export function meldFor(coord) {
  try {
    if (!_pmAxisLib) _pmAxisLib = JSON.parse(readFileSync(resolve(_PM_REPO, 'docs/architecture/axis-library-v1.json'), 'utf8'));
    const [ra, ca] = String(coord).split(',');
    const ax = (k) => (_pmAxisLib.axes || []).find((a) => a.rank === k);
    const A = ax(ra), B = ax(ca);
    if (!A || !B) return '';
    // THE REGION SEED IS THE CELL'S OWN DUMP, never two labels (operator: 'you gave it two
    // labels and expected it to populate a semantic region'): snippet-library-144 holds the
    // curated melded text of THIS cell (~760ch) — that leads; the axis sentences trail.
    if (!_pmLib144) { try { _pmLib144 = new Map(JSON.parse(readFileSync(resolve(_PM_REPO, 'data/pmu/snippet-library-144.json'), 'utf8')).map((c) => [String(c.coord), String(c.snippet || '')])); } catch { _pmLib144 = new Map(); } }
    const ownDump = _pmLib144.get(String(coord)) || '';
    return (ownDump + ' ' + [...(A.snippets || []).slice(0, 2), ...(B.snippets || []).slice(0, 2)].join(' ')).trim().slice(0, 1600);
  } catch { return ''; }
}
export function oppositeCoord(coord) {
  const AX = SHORTLEX_AXES;
  const [r, c] = String(coord).split(',');
  return `${AX[11 - AX.indexOf(r)]},${AX[11 - AX.indexOf(c)]}`;
}

