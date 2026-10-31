#!/usr/bin/env node
// scripts/pmu/block-stats.mjs — PREFIX-INTERSECTION BLOCK STATISTICS over the 144×144 lattice.
// =============================================================================
// THE GAP THIS CLOSES (operator, 2026-06-10): "we need the tools to measure per
// prefix-intersection boundaries in the math (i.e. the B1×C3 block has stats X) and USE it."
// Every lens so far reads zones (row+col crosses of ONE anchor, sigma-localize) or whole-field
// geometry; nothing reads the RECTANGLE a prefix PAIR carves out. This module is that read-out.
//
// THE PAIR-COORDINATE MAPPING (canonical, shared with definer-walk-144 / competence-map /
// repo-heatmap — `anchors[r*12+c]`):
//   AXIS12 = the first 12 registry entries in ShortLex order:
//     [A, B, C, A1, A2, A3, B1, B2, B3, C1, C2, C3]          (indices 0..11)
//   anchor t (0..143)  =  the ordered pair (AXIS12[⌊t/12⌋], AXIS12[t mod 12]);
//   its coordinate name = "AXIS12[⌊t/12⌋],AXIS12[t mod 12]"  (e.g. t=130 → "C2,C2", t=104 → "B3,B3").
//   The 144×144 lattice cell (i,j) = field[i*144 + j] over ANCHOR indices i,j — 20,736 cells.
//
// PREFIX → AXIS REGION (zone arithmetic from data/pmu/shortlex-144-registry.json):
//   depth-1 (A|B|C)      — the ShortLex ZONE: anchors whose row-part is the name or any of its
//                          registry children among AXIS12 (e.g. A → row-parts {A,A1,A2,A3} →
//                          anchor index bands [0..11] ∪ [36..71]; 48 indices, NON-contiguous —
//                          hence regionOf returns rectangle(S)).
//   depth-2 (A1..C3)     — the exact 12-anchor band of that row-part (B3 → [96..107]). The
//                          registry's depth-3 children (A1A..C3N) never appear on the lattice
//                          axes, so a depth-2 zone is exactly its own band.
//   pair name ("X,Y")    — one of the 144 anchor names → a SINGLE row/col index (the finest
//                          grain: "C2,C2" → 130).
//   A block = rows(rowPrefix) × cols(colPrefix); B1×C3 at depth 2 = the 12×12 gestalt block
//   rows [72..83] × cols [132..143] = 144 cells. Depth-2 peers = the 144 gestalt blocks
//   (12 AXIS12 names per axis, EXACT bands — the same 12×12-block space regionGeometry,
//   zoneRank/144 and massInTop3Blocks already read). Depth-1 peers = the 9 zone super-blocks.
//
// WHY THE CONVENTIONAL FORM FAILS HERE (anti-rules protocol, docs/architecture/anti-rules-ledger.md):
//   • a Monte-Carlo / RNG-shuffled null (AR-6 analytic-shortcut cousin) would make the same
//     commit print different σ on different machines — the null here is the DETERMINISTIC
//     CYCLIC-SHIFT family: shift s ∈ 1..S moves the block to rows+s, cols+s (mod 144), reading
//     the same-shaped rectangle everywhere else on the torus. Bit-for-bit reproducible.
//   • this is SENSE-ONLY analysis of a measurement field — never the walk, never a follow rule
//     (AR-3), and blocks are AGGREGATION READS on the 144×144, never a 12×12 render substitute
//     (AR-8): the lattice stays 20,736 cells; the block table is a readout layered on top.
//   • mass is read on the ATTRIBUTED EXCESS field by default (grip − median floor): SimHash puts
//     random pairs at sim ≈ 0.5, so raw-grip block masses smear toward uniform by construction,
//     signal or not (the same reason regionGeometry centers; sigma-localize.mjs attributedDelta).
//
// @canonical-algorithm  registry → AXIS12 → prefix → axis index bands (zone at depth 1, exact
//   band at depth 2, single index for a pair name) → block = row-bands × col-bands → mass/share/
//   maxCell on |field| → rank+percentile among same-depth peers → z vs deterministic cyclic-shift
//   nulls → gestaltRank of the max cell's 12×12 block among all 144
// @forbidden-alternative  RNG/Monte-Carlo nulls · ranking by anything but measured mass ·
//   substituting the block table for the 144×144 field · inventing a 12×12 lattice (AR-8) ·
//   wiring this into the walk's follow rule (AR-3)
// @why  prefix-intersection boundaries are where intent meets reality per ShortLex lane pair;
//   without a per-block instrument "B1×C3 is hot" stays vibes, not a number
// @guard  tests/pmu-simulator/block-stats.test.mjs
//
// Usage:
//   node scripts/pmu/block-stats.mjs --target B3,B3                      # latest fresh-pair attributed field
//   node scripts/pmu/block-stats.mjs --target B1,C3 --depth 2 --top 5    # stat line + top-5 table
//   node scripts/pmu/block-stats.mjs --field <field.json> --target A,B --depth 1
//   node scripts/pmu/block-stats.mjs --target "B3,B3,C1,C2"              # single cell (two pair names)
//   flags: --raw (grip, not excess) · --nulls N (default 143) · --json
//
// CONSUMERS: wired in a follow-up (commit-triptych / mail-post are held by concurrent agents).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = (() => { try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' , stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return resolve(HERE, '../..'); } })();

export const REGISTRY_PATH = resolve(REPO, 'data/pmu/shortlex-144-registry.json');
export const FRESH_DIR = resolve(REPO, 'data/pmu/fresh-pair');
export const N = 144;                 // anchors per axis
export const CELLS = N * N;           // 20,736
export const DEFAULT_NULLS = 143;     // every nontrivial cyclic shift of the torus diagonal

// ── registry → AXIS12 + zone arithmetic ─────────────────────────────────────────────────────────
export function loadRegistry(path = REGISTRY_PATH) {
  const reg = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(reg?.entries) || reg.entries.length < 12) throw new Error(`registry malformed: ${path}`);
  return reg;
}

// AXIS12 — the 12 depth≤2 names in registry (ShortLex) order; positions ARE the r/c of anchors[r*12+c].
export function axis12(registry) {
  return registry.entries.slice(0, 12).map((e) => e.name);
}

export const anchorName = (t, ax) => `${ax[Math.floor(t / 12)]},${ax[t % 12]}`;

export function anchorIndexOfPair(name, ax) {
  const [r, c] = String(name).split(',').map((s) => s.trim());
  const ri = ax.indexOf(r), ci = ax.indexOf(c);
  if (ri < 0 || ci < 0) throw new Error(`not an anchor pair name: "${name}"`);
  return ri * 12 + ci;
}

export function prefixDepth(prefix, registry) {
  if (String(prefix).includes(',')) return 3;                       // a full anchor pair name
  const e = registry.entries.find((x) => x.name === prefix && x.depth <= 2);
  if (!e) throw new Error(`unknown prefix "${prefix}" (expect A|B|C, A1..C3, or an anchor pair name)`);
  return e.depth;
}

// merge a sorted list of axis indices into contiguous [lo,hi] bands
const toBands = (idx) => {
  const bands = [];
  for (const i of idx) {
    const last = bands[bands.length - 1];
    if (last && i === last[1] + 1) last[1] = i; else bands.push([i, i]);
  }
  return bands;
};

// axisIndicesForPrefix — the sorted anchor-axis indices a prefix selects (see header). depth may
// be forced (e.g. depth:2 reads "A" as the exact band [0..11] instead of the zone) — the depth-2
// peer space is the 144 gestalt blocks over all 12 AXIS12 names.
export function axisIndicesForPrefix(prefix, registry, { depth = null } = {}) {
  const ax = axis12(registry);
  const d = depth ?? prefixDepth(prefix, registry);
  if (d === 3) return { depth: 3, indices: [anchorIndexOfPair(prefix, ax)], bands: toBands([anchorIndexOfPair(prefix, ax)]) };
  const pos = [];
  if (d === 2) {
    const p = ax.indexOf(prefix);
    if (p < 0) throw new Error(`"${prefix}" is not on AXIS12`);
    pos.push(p);
  } else {
    // depth 1: the ShortLex zone — the name itself + its registry children among AXIS12
    for (let p = 0; p < 12; p++) {
      const e = registry.entries[p];
      if (e.name === prefix || e.parent === prefix) pos.push(p);
    }
    if (!pos.length) throw new Error(`depth-1 prefix "${prefix}" selects nothing`);
  }
  const indices = [];
  for (const p of pos.sort((a, b) => a - b)) for (let k = 0; k < 12; k++) indices.push(p * 12 + k);
  return { depth: d, indices, bands: toBands(indices) };
}

// regionOf — the cell-index rectangle(s) of a prefix pair: rows(rowPrefix) × cols(colPrefix).
export function regionOf(rowPrefix, colPrefix, registry = loadRegistry(), { rowDepth = null, colDepth = null } = {}) {
  const rows = axisIndicesForPrefix(rowPrefix, registry, { depth: rowDepth });
  const cols = axisIndicesForPrefix(colPrefix, registry, { depth: colDepth });
  const rects = [];
  for (const [r0, r1] of rows.bands) for (const [c0, c1] of cols.bands) rects.push({ r0, r1, c0, c1 });
  return {
    rowPrefix, colPrefix, rowDepth: rows.depth, colDepth: cols.depth,
    rowIndices: rows.indices, colIndices: cols.indices, rects,
    cells: rows.indices.length * cols.indices.length,
  };
}

// ── mass arithmetic (always on |field|) ─────────────────────────────────────────────────────────
const massAt = (field, rowIdx, colIdx, shift = 0) => {
  let m = 0;
  for (const i of rowIdx) { const ri = ((i + shift) % N) * N; for (const j of colIdx) m += Math.abs(field[ri + ((j + shift) % N)]); }
  return m;
};

const peersAtDepth = (registry, d) => {
  const ax = axis12(registry);
  if (d === 1) return registry.entries.slice(0, 3).map((e) => e.name);
  if (d === 2) return ax;                                            // the 12 gestalt band names
  return Array.from({ length: N }, (_, t) => anchorName(t, ax));     // the 144 anchor names
};

// blockStats — the full per-block readout. Deterministic: no RNG anywhere; ties break toward the
// lower index. zScore null = cyclic-shift family (shift s moves the rectangle along the torus
// diagonal); std < 1e-12 reads z = 0, honestly (the sigmaOfZones convention).
export function blockStats(field, rowPrefix, colPrefix, { nulls = DEFAULT_NULLS, registry = loadRegistry(), rowDepth = null, colDepth = null } = {}) {
  if (!field || field.length !== CELLS) throw new Error(`field must have ${CELLS} cells, got ${field?.length}`);
  const ax = axis12(registry);
  const region = regionOf(rowPrefix, colPrefix, registry, { rowDepth, colDepth });
  const mass = massAt(field, region.rowIndices, region.colIndices);
  let total = 0; for (let k = 0; k < CELLS; k++) total += Math.abs(field[k]);
  // max cell inside the region
  let maxVal = -Infinity, maxI = region.rowIndices[0], maxJ = region.colIndices[0];
  for (const i of region.rowIndices) for (const j of region.colIndices) {
    const v = Math.abs(field[i * N + j]);
    if (v > maxVal) { maxVal = v; maxI = i; maxJ = j; }
  }
  // peers at the same (rowDepth, colDepth)
  const rowPeers = peersAtDepth(registry, region.rowDepth), colPeers = peersAtDepth(registry, region.colDepth);
  let greater = 0, less = 0, nPeers = 0;
  for (const rp of rowPeers) for (const cp of colPeers) {
    nPeers++;
    if (rp === rowPrefix && cp === colPrefix) continue;
    const pr = axisIndicesForPrefix(rp, registry, { depth: region.rowDepth });
    const pc = axisIndicesForPrefix(cp, registry, { depth: region.colDepth });
    const pm = massAt(field, pr.indices, pc.indices);
    if (pm > mass) greater++; else if (pm < mass) less++;
  }
  const rankAmongPeers = 1 + greater;
  const percentile = nPeers > 1 ? +(100 * less / (nPeers - 1)).toFixed(2) : 100;
  // deterministic cyclic-shift null
  const S = Math.max(1, Math.min(nulls, N - 1));
  const samples = [];
  for (let s = 1; s <= S; s++) samples.push(massAt(field, region.rowIndices, region.colIndices, s));
  const mu = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mu) ** 2, 0) / samples.length);
  const zScore = sd > 1e-12 ? +((mass - mu) / sd).toFixed(3) : 0;
  // gestaltRank — the 12×12 block holding the max cell, ranked among all 144 gestalt blocks
  const gi = Math.floor(maxI / 12), gj = Math.floor(maxJ / 12);
  const gMass = new Float64Array(N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) gMass[Math.floor(i / 12) * 12 + Math.floor(j / 12)] += Math.abs(field[i * N + j]);
  let gGreater = 0; const gSelf = gMass[gi * 12 + gj];
  for (let b = 0; b < N; b++) if (b !== gi * 12 + gj && gMass[b] > gSelf) gGreater++;
  const gestaltRank = 1 + gGreater;
  return {
    block: `${rowPrefix}×${colPrefix}`, rowPrefix, colPrefix,
    rowDepth: region.rowDepth, colDepth: region.colDepth,
    cells: region.cells, rects: region.rects,
    mass: +mass.toFixed(6), share: total > 0 ? +(mass / total).toFixed(6) : 0,
    maxCell: { value: +(maxVal === -Infinity ? 0 : maxVal).toFixed(6), i: maxI, j: maxJ, row: anchorName(maxI, ax), col: anchorName(maxJ, ax) },
    rankAmongPeers, peers: nPeers, percentile,
    zScore, nullShifts: S, nullMean: +mu.toFixed(6), nullStd: +sd.toFixed(6),
    gestaltRank, gestaltBlock: `${ax[gi]}×${ax[gj]}`,
  };
}

// allBlockStats — every block at one depth (1 → 9 zone super-blocks · 2 → 144 gestalt blocks),
// sorted by mass desc (ties → row-major prefix order). Same arithmetic, table form.
export function allBlockStats(field, depth = 2, { registry = loadRegistry(), nulls = DEFAULT_NULLS } = {}) {
  if (!field || field.length !== CELLS) throw new Error(`field must have ${CELLS} cells, got ${field?.length}`);
  const ax = axis12(registry);
  const names = peersAtDepth(registry, depth);
  let total = 0; for (let k = 0; k < CELLS; k++) total += Math.abs(field[k]);
  const rows = [];
  for (const rp of names) for (const cp of names) {
    const r = axisIndicesForPrefix(rp, registry, { depth });
    const c = axisIndicesForPrefix(cp, registry, { depth });
    const mass = massAt(field, r.indices, c.indices);
    rows.push({ block: `${rp}×${cp}`, rowPrefix: rp, colPrefix: cp, cells: r.indices.length * c.indices.length, mass, _r: r.indices, _c: c.indices });
  }
  rows.sort((a, b) => b.mass - a.mass || a.block.localeCompare(b.block));
  const S = Math.max(1, Math.min(nulls, N - 1));
  return rows.map((b, k) => {
    const samples = [];
    for (let s = 1; s <= S; s++) samples.push(massAt(field, b._r, b._c, s));
    const mu = samples.reduce((x, y) => x + y, 0) / samples.length;
    const sd = Math.sqrt(samples.reduce((x, y) => x + (y - mu) ** 2, 0) / samples.length);
    const { _r, _c, ...rest } = b;
    return {
      ...rest, rank: k + 1,
      mass: +b.mass.toFixed(6), share: total > 0 ? +(b.mass / total).toFixed(6) : 0,
      zScore: sd > 1e-12 ? +((b.mass - mu) / sd).toFixed(3) : 0,
    };
  });
}

// ── the live field: latest fresh-pair, ATTRIBUTED lens (recomputed, never stored-stale) ─────────
// The pair blob stores baseline/perturbed docs keyed by libSha; the field is recomputed through
// the same instrument sigma-localize uses (claimDiff → attributedDelta). Default read = the
// EXCESS field (grip − median floor) — see header for why raw grip smears.
export async function loadLatestFreshPairField({ raw = false } = {}) {
  const files = readdirSync(FRESH_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('sweep-'));
  if (!files.length) throw new Error(`no fresh-pair files in ${FRESH_DIR}`);
  const pairs = files.map((f) => {
    try { const j = JSON.parse(readFileSync(resolve(FRESH_DIR, f), 'utf8')); return j.baseline && j.perturbed ? { f, j } : null; } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.j.generatedAt).localeCompare(String(a.j.generatedAt)));
  if (!pairs.length) throw new Error(`no usable pair blobs (baseline+perturbed) in ${FRESH_DIR}`);
  const { f, j } = pairs[0];
  const libPath = isAbsolute(j.lib) ? j.lib : resolve(REPO, j.lib);
  if (!existsSync(libPath)) throw new Error(`pair lib missing: ${libPath}`);
  const { loadPairSigs, claimDiff, attributedDelta } = await import('./sigma-localize.mjs');
  const { pairSigs, libSha } = loadPairSigs(libPath);
  const { added, removed } = claimDiff(j.baseline, j.perturbed);
  const att = attributedDelta([...added, ...removed], pairSigs);
  return {
    field: raw ? att.grip : att.excess,
    meta: { file: `data/pmu/fresh-pair/${f}`, generatedAt: j.generatedAt, libSha, pairLibSha: j.libSha, coord: j.coord, term: j.term, foreignTerm: j.foreignTerm, lens: raw ? 'attributed-grip' : 'attributed-excess', claimsChanged: added.length + removed.length, floor: att.floor },
  };
}

export function loadFieldFile(path) {
  const j = JSON.parse(readFileSync(isAbsolute(path) ? path : resolve(REPO, path), 'utf8'));
  const arr = Array.isArray(j) ? j : j.field || j.absd || j.cells;
  if (!Array.isArray(arr) || arr.length !== CELLS) throw new Error(`${path}: expected a ${CELLS}-cell field`);
  return Float64Array.from(arr.map(Number));
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  const has = (f) => process.argv.includes(f);
  const target = arg('--target', 'B3,B3');
  const depthArg = arg('--depth', null);
  const top = +arg('--top', 5);
  const nulls = +arg('--nulls', DEFAULT_NULLS);
  const fieldArg = arg('--field', 'fresh-pair');
  const registry = loadRegistry();

  // parse target: "B3,B3" → prefixes (B3, B3); "B3,B3,C1,C2" → two pair names (single cell)
  const tok = target.split(',').map((s) => s.trim()).filter(Boolean);
  let rowPrefix, colPrefix;
  if (tok.length === 2) [rowPrefix, colPrefix] = tok;
  else if (tok.length === 4) { rowPrefix = `${tok[0]},${tok[1]}`; colPrefix = `${tok[2]},${tok[3]}`; }
  else { console.error(`bad --target "${target}" (want "ROW,COL" or "R1,C1,R2,C2")`); process.exit(1); }
  const forcedDepth = depthArg != null ? +depthArg : null;

  (async () => {
    let field, meta;
    if (fieldArg === 'fresh-pair' || fieldArg === 'latest') ({ field, meta } = await loadLatestFreshPairField({ raw: has('--raw') }));
    else { field = loadFieldFile(fieldArg); meta = { file: fieldArg, lens: 'file' }; }

    const stats = blockStats(field, rowPrefix, colPrefix, { nulls, registry, rowDepth: forcedDepth, colDepth: forcedDepth });
    const table = allBlockStats(field, forcedDepth ?? 2, { registry, nulls }).slice(0, top);

    if (has('--json')) { console.log(JSON.stringify({ meta, target: stats, top: table }, null, 2)); return; }
    console.log(`field: ${meta.file} · lens ${meta.lens}${meta.coord ? ` · pair tile ${meta.coord} (${meta.term}→${meta.foreignTerm})` : ''}${meta.libSha ? ` · libSha ${meta.libSha}` : ''}`);
    console.log(`\n${stats.block}  [depth ${stats.rowDepth}×${stats.colDepth} · ${stats.cells} cells]`);
    console.log(`  mass ${stats.mass} · share ${(stats.share * 100).toFixed(2)}% · rank ${stats.rankAmongPeers}/${stats.peers} (p${stats.percentile}) · z ${stats.zScore} (${stats.nullShifts} cyclic-shift nulls) · gestalt ${stats.gestaltBlock} rank ${stats.gestaltRank}/144`);
    console.log(`  max cell ${stats.maxCell.value} @ (${stats.maxCell.row})×(${stats.maxCell.col}) [i=${stats.maxCell.i}, j=${stats.maxCell.j}]`);
    console.log(`\ntop ${top} blocks at depth ${forcedDepth ?? 2}:`);
    for (const b of table) console.log(`  #${b.rank} ${b.block.padEnd(9)} mass ${String(b.mass).padEnd(12)} share ${(b.share * 100).toFixed(2).padStart(6)}% · z ${b.zScore}`);
  })().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
