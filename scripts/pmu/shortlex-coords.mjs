// scripts/pmu/shortlex-coords.mjs — the canonical ShortLex ↔ coordinate conversions.
//
// The 144-anchor lattice is 12 ShortLex ranks × 12 ShortLex ranks. A coordinate is "row,col"
// (e.g. "A,A1"). The tolerance panel is 144×144 cells, reduced to a 12×12 BLOCK grid where block
// (br,bc) — block indices 0..11 — corresponds to ShortLex rank AX[br] on the intent axis and
// AX[bc] on the reality axis. These are the relevant functions to convert both ways, shared by the
// annotator, the Rust-pipeline panel, and the email so the SAME names appear everywhere.
//
// Canonical rank order (matches book-heatmaps.mjs AX and architecture-audit.mjs SHORTLEX_RANKS):
export const AX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export const NB = 12;   // blocks per axis
export const N = 144;   // cells per axis
export const B = N / NB; // 12 cells per block

// Rank → fully band-qualified name. SINGLE SOURCE for "which band is A2 in" — every consumer
// that narrates a coordinate (commit-story.mjs, telephone-banks.mjs) must read the band from
// HERE, not restate/reparaphrase it, so a sub-anchor's parent band is never left for the reader
// (human or model) to infer from a one-line gloss stated once and then forgotten 500 words later.
export const AXIS_FULL_NAME = {
  A: 'A.Strategy', B: 'B.Tactics', C: 'C.Operations',
  A1: 'A1.Strategy.Law', A2: 'A2.Strategy.Goal', A3: 'A3.Strategy.Fund',
  B1: 'B1.Tactics.Speed', B2: 'B2.Tactics.Deal', B3: 'B3.Tactics.Signal',
  C1: 'C1.Operations.Grid', C2: 'C2.Operations.Loop', C3: 'C3.Operations.Flow',
};
export function axisFullName(rank) { return AXIS_FULL_NAME[String(rank).trim()] || String(rank).trim(); }

// rank label ↔ block index (0..11)
export function rankToIndex(rank) { return AX.indexOf(String(rank).trim()); }
export function indexToRank(i) { return AX[((i % NB) + NB) % NB]; }

// BLOCK (br,bc) ↔ ShortLex coord "row,col"
export function blockToShortLex(br, bc) { return `${indexToRank(br)},${indexToRank(bc)}`; }
export function shortLexToBlock(coord) {
  const [r, c] = String(coord).split(',').map(s => s.trim());
  return { br: rankToIndex(r), bc: rankToIndex(c) };
}

// 144-CELL (i,j ∈ 0..143) ↔ ShortLex coord — a cell lives in block (⌊i/12⌋, ⌊j/12⌋)
export function cellToShortLex(i, j) { return blockToShortLex(Math.floor(i / B), Math.floor(j / B)); }
export function shortLexToCellBlock(coord) {
  const { br, bc } = shortLexToBlock(coord);
  return { i0: br * B, i1: br * B + B - 1, j0: bc * B, j1: bc * B + B - 1 };
}

// REGION blockBox {r0,r1,c0,c1} (inclusive block indices) → a human ShortLex span label.
// A 1×1 region → "A,A1"; a span → "A,A1 ▸ B1,C2" (top-left anchor ▸ bottom-right anchor).
export function regionShortLex(blockBox) {
  const { r0, r1, c0, c1 } = blockBox;
  const tl = blockToShortLex(r0, c0);
  // the region's DOMINANT/center anchor — the single coordinate whose lattice meaning best names it
  const center = blockToShortLex(Math.round((r0 + r1) / 2), Math.round((c0 + c1) / 2));
  if (r0 === r1 && c0 === c1) return { label: tl, center, anchors: [tl] };
  const br = blockToShortLex(r1, c1);
  // enumerate the corner anchors that bound the region (the ShortLex bounding box)
  const anchors = [blockToShortLex(r0, c0), blockToShortLex(r0, c1), blockToShortLex(r1, c0), blockToShortLex(r1, c1)]
    .filter((v, i, a) => a.indexOf(v) === i);
  return { label: `${tl} ▸ ${br}`, center, anchors, rowSpan: [indexToRank(r0), indexToRank(r1)], colSpan: [indexToRank(c0), indexToRank(c1)] };
}

// Self-check when run directly: round-trips + a couple of known coords.
if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = (a, b, m) => console.log(`${a === b ? '✓' : '✗ FAIL'} ${m}: ${a}${a === b ? '' : ' ≠ ' + b}`);
  ok(blockToShortLex(0, 3), 'A,A1', 'block (0,3) → A,A1');
  ok(JSON.stringify(shortLexToBlock('A,A1')), JSON.stringify({ br: 0, bc: 3 }), 'A,A1 → block (0,3)');
  ok(cellToShortLex(0, 40), 'A,A1', 'cell (0,40) → A,A1 (col 40 in block 3)');
  ok(regionShortLex({ r0: 0, r1: 1, c0: 3, c1: 10 }).label, 'A,A1 ▸ B,C2', 'region span label');
  for (let i = 0; i < NB; i++) ok(rankToIndex(indexToRank(i)), i, `round-trip index ${i}`);
}
