// scripts/vna/tesseract-projection.mjs — C64 DIMENSIONAL SPLITTING FROM THE ONE WALK (goal 2 unit 2, 2026-09-18).
// The 12×12 pixel is a PROJECTION: the walk lights a set of cells on the 144-cell lattice (`cells` on every walk row) and
// the pixel is where it settled. Two basins on one pixel are not one point — they are two lit-cell vectors that happen
// to project to the same cell. When the compressor ties (C58) and no label decides (C62), a chunk is routed by the
// OVERLAP of its own lit cells with each candidate's: a pick only when the best overlap is UNIQUE and beats a shuffled
// null — K placements of the chunk's cell count over the 144 cells, the max overlap over the same candidates each time,
// exceedance = placements reaching the real best; a pick needs exceedance 0/K. Otherwise a tie, said with its numbers.
// The null is seeded from the cells and the candidate ids, so the receipt is the same on every re-run (a placement
// claim must recompute). Nothing here walks, reads a model, or matches a string: the vectors come off the walk rows.
// Projection back to the panel preserves ShortLex order — this module never touches a pixel.
import { createHash } from 'node:crypto';

export const SL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export const CELLS = 144;
export const K_NULL = 64;
export const cellIndex = (p) => { const [r, c] = String(p || '').split(','); const i = SL.indexOf(r), j = SL.indexOf(c); return i < 0 || j < 0 ? null : i * 12 + j; };
export const litSet = (cells) => new Set((Array.isArray(cells) ? cells : []).map(cellIndex).filter((x) => x != null));
export const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

// mulberry32 over a sha256 of the inputs: deterministic, dependency-free, good enough for K placements
function prng(seedStr) {
  let a = parseInt(createHash('sha256').update(seedStr).digest('hex').slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// one placement: n distinct cells out of the 144 (partial Fisher–Yates)
function place(n, rnd) {
  const pool = Array.from({ length: CELLS }, (_, i) => i); const out = new Set();
  for (let i = 0; i < n && i < CELLS; i++) { const j = i + Math.floor(rnd() * (CELLS - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; out.add(pool[i]); }
  return out;
}

// cellTiebreak(chunkCells, cands, { K }) → { pick, why, overlaps, null: { K, exceedance, best } }
// cands: nodes carrying walk.cells (a basin); a candidate with no cells overlaps nothing and is said so.
export function cellTiebreak(chunkCells, cands, { K = K_NULL } = {}) {
  const S = litSet(chunkCells);
  const rows = (cands || []).map((c) => ({ c, set: litSet(c.walk && c.walk.cells) }));
  const overlaps = rows.map(({ c, set }) => ({ id: c.id, label: c.meta && c.meta.label, overlap: overlap(S, set) })).sort((x, y) => y.overlap - x.overlap || (x.id < y.id ? -1 : 1));
  const receipt = { pick: null, why: null, overlaps, null: { K, exceedance: null, best: overlaps.length ? overlaps[0].overlap : 0 } };
  if (!S.size) return { ...receipt, why: 'no lit cells on the chunk' };
  if (!rows.some((r) => r.set.size)) return { ...receipt, why: 'no lit cells on any candidate' };
  if (overlaps.length < 2) return { ...receipt, why: 'fewer than two candidates' };
  const best = overlaps[0].overlap;
  if (best === 0) return { ...receipt, why: 'no overlap with any candidate' };
  if (best === overlaps[1].overlap) return { ...receipt, why: `best overlap ${best} not unique (${overlaps[0].label} = ${overlaps[1].label})` };
  // the shuffled null: the same cell count, K random placements, the max over the same candidates
  const rnd = prng([...S].sort((a, b) => a - b).join(',') + '|' + rows.map((r) => r.c.id).sort().join(','));
  let exceedance = 0;
  for (let k = 0; k < K; k++) { const P = place(S.size, rnd); const m = Math.max(...rows.map((r) => overlap(P, r.set))); if (m >= best) exceedance++; }
  receipt.null.exceedance = exceedance;
  if (exceedance > 0) return { ...receipt, why: `overlap ${best} of ${S.size} is what the shuffled null reaches (exceedance ${exceedance}/${K})` };
  const pick = rows.find((r) => r.c.id === overlaps[0].id).c;
  return { ...receipt, pick, why: null };
}
