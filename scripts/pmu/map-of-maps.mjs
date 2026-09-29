// scripts/pmu/map-of-maps.mjs
//
// The map-of-maps store — WHO owns WHICH pixel by signed-receipt mass.
//
// Replaces the flat sha256 inbox semantics with a two-level index keyed by
// the receipt's ed25519 identity (pubkey) and the dignity-pixel coordinate:
//
//   map[pubkey_hex][coord] = {
//     receipts: [run_id],   // every run that landed on this coord (deduped)
//     n,                    // raw count of distinct receipts
//     sigma_mean,           // EWMA(α=0.4) of σ — favours CURRENT competence
//     sigma_max,            // running max σ ever seen here
//     drift_mean,           // EWMA(α=0.4) of drift %
//     first_at, last_at     // ISO timestamps, earliest + latest receipt
//   }
//
// EWMA (not arithmetic mean) is deliberate: an operator's CURRENT competence at
// a coordinate matters more than their history — role-continuity. agg := 0.4*new
// + 0.6*agg, seeded by the first value. n stays a raw count for mass.
//
// The same store an underwriter reads as the violation distribution per pubkey.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const DEFAULT_STORE = resolve(REPO_ROOT, 'data/pmu/claudbridge/map-of-maps.json');

// Resolved at CALL time so a test (or alternate host) can redirect the store via
// PMU_MAP_STORE without re-importing — keeps real data unpolluted under test.
export function storePath() {
  return process.env.PMU_MAP_STORE ? resolve(process.env.PMU_MAP_STORE) : DEFAULT_STORE;
}
export const STORE_PATH = DEFAULT_STORE;

const EWMA_ALPHA = 0.4;             // weight on the newest observation
const SIGMA_FLOOR = 3.4;            // gold floor (insurer-aligned)
const OWN_MIN_N = 3;                // ownership needs >= 3 receipts
const FRICTION_CEILING_PCT = 5;     // insurability drift ceiling (insurer-aligned)

// EWMA step — seed with the first value, then blend.
function ewma(prev, next, isFirst) {
  return isFirst ? next : (EWMA_ALPHA * next + (1 - EWMA_ALPHA) * prev);
}

// The coord a receipt lands on = the ROW anchor of its dignity_pixel.
// dignity_pixel looks like "B1,C ⊕ A2,B3" → coord "B1,C". Falsy/none → null.
export function rowAnchorOf(dignityPixel) {
  if (!dignityPixel || dignityPixel === 'none') return null;
  return String(dignityPixel).split('⊕')[0].trim();
}

// Drift % from a receipt: prefer explicit drift_pct, else derive from
// friction_nodes over the 20,736-cell lattice (insurerVerdict's definition).
function driftOf(payload) {
  if (payload.drift_pct != null) return payload.drift_pct;
  if (payload.friction_nodes != null) return (payload.friction_nodes / (144 * 144)) * 100;
  return 0;
}

export function loadMap() {
  const p = storePath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return {}; }
}

// Atomic write: tmp + rename so a concurrent reader never sees a half-file.
export function saveMap(map) {
  const p = storePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2));
  renameSync(tmp, p);
}

// Upsert one accepted, verified receipt into the map-of-maps.
// Returns { pubkey_hex, coord, cell } for the touched cell (or null if the
// receipt has no placeable dignity pixel). Idempotent per run_id.
export function upsertReceipt(payload, map = loadMap()) {
  const pubkey = payload.pubkey_hex;
  const coord = rowAnchorOf(payload.dignity_pixel);
  if (!pubkey || !coord) return null;

  const sigma = payload.sigma ?? 0;
  const drift = driftOf(payload);
  const at = payload.at || new Date().toISOString();
  const runId = payload.run_id;
  // The FULL dignity pixel ("A2,C ⊕ A2,C") — the depth-2 child key under the
  // depth-1 parent coord ("A2,C"). The coordinate IS the link (ShortLex prefix),
  // so this is a trie insertion, not a SimHash match.
  const fullPixel = (payload.dignity_pixel && payload.dignity_pixel !== 'none')
    ? String(payload.dignity_pixel).trim() : null;

  map[pubkey] = map[pubkey] || {};
  let cell = map[pubkey][coord];

  // Idempotent: a re-POSTed run_id does not double-count (parent or child).
  if (cell && runId && cell.receipts.includes(runId)) {
    saveMap(map);
    return { pubkey_hex: pubkey, coord, cell };
  }

  if (!cell) {
    cell = {
      receipts: runId ? [runId] : [],
      n: 1,
      sigma_mean: round(sigma),
      sigma_max: round(sigma),
      drift_mean: round(drift),
      first_at: at,
      last_at: at,
      children: {}
    };
    map[pubkey][coord] = cell;
  } else {
    if (runId) cell.receipts.push(runId);
    cell.sigma_mean = round(ewma(cell.sigma_mean, sigma, false));
    cell.drift_mean = round(ewma(cell.drift_mean, drift, false));
    cell.sigma_max = round(Math.max(cell.sigma_max, sigma));
    cell.n = runId ? cell.receipts.length : cell.n + 1;
    cell.last_at = at;
    cell.children = cell.children || {};
  }

  // Depth-2: recurse the full pixel as a child of its parent coord.
  if (fullPixel) {
    const ch = cell.children[fullPixel];
    if (!ch) {
      cell.children[fullPixel] = { n: 1, sigma_mean: round(sigma), sigma_max: round(sigma), last_at: at };
    } else {
      ch.sigma_mean = round(ewma(ch.sigma_mean, sigma, false));
      ch.sigma_max = round(Math.max(ch.sigma_max, sigma));
      ch.n += 1;
      ch.last_at = at;
    }
  }

  saveMap(map);
  return { pubkey_hex: pubkey, coord, cell };
}

// Pure fold — the SAME EWMA / seed / max / count semantics as upsertReceipt, over an in-memory list of
// rows, with NO store write. Exists so a reader that derives cells from a different receipt source
// (scripts/vna/competence-pixel.mjs folds the commit-greeks index through it) cannot drift from the
// store's own definition of a cell — one rule, one place. Rows MUST arrive in time order: EWMA is
// order-dependent, and "current competence outranks history" is only true if the newest row folds last.
// Row shape: { coord, sigma, drift?, at, run_id? }.
export function foldReceipts(rows) {
  const cells = {};
  for (const r of rows) {
    const coord = r.coord;
    if (!coord) continue;
    const sigma = r.sigma ?? 0, drift = r.drift ?? 0, at = r.at;
    const c = cells[coord];
    if (!c) {
      cells[coord] = {
        receipts: r.run_id ? [r.run_id] : [], n: 1,
        sigma_mean: round(sigma), sigma_max: round(sigma), drift_mean: round(drift),
        first_at: at, last_at: at, children: {}
      };
    } else {
      if (r.run_id) c.receipts.push(r.run_id);
      c.sigma_mean = round(ewma(c.sigma_mean, sigma, false));
      c.drift_mean = round(ewma(c.drift_mean, drift, false));
      c.sigma_max = round(Math.max(c.sigma_max, sigma));
      c.n += 1;
      c.last_at = at;
    }
  }
  return cells;
}

function round(x, p = 6) {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

// ── ownership + dignity queries ───────────────────────────────────────────────
//
// The universe of coordinates = the 144 canonical ShortLex node coords (the
// snippet-library-144 corpus). A coord's "sigma-potential" = the length of its
// canonical snippet: more substance at that coordinate = more competence there
// to demonstrate = a higher-value gap to grow into.

const LIB_144_PATH = resolve(REPO_ROOT, 'data/pmu/snippet-library-144.json');
let _corpus = null;
function corpusCoords() {
  if (_corpus) return _corpus;
  try {
    const lib = JSON.parse(readFileSync(LIB_144_PATH, 'utf8'));
    _corpus = lib.map(e => ({ coord: e.coord, potential: (e.snippet || '').length }));
  } catch { _corpus = []; }
  return _corpus;
}

// Mass = verified density: how much signed competence sits at a cell.
export function mass(cell) {
  return (cell?.sigma_mean ?? 0) * (cell?.n ?? 0);
}
// Dignity score = mass discounted by drift — competence you can still trust.
export function dignityScore(cell) {
  return mass(cell) * (1 - (cell?.drift_mean ?? 0) / 100);
}
// Verified competence: above the gold σ floor over enough receipts.
export function meetsThreshold(cell) {
  return (cell?.sigma_mean ?? 0) >= SIGMA_FLOOR && (cell?.n ?? 0) >= OWN_MIN_N;
}

// Two ShortLex ranks "share a rank-prefix" when they share a leading cardinal
// (A/B/C) — "B1" and "B3" both grow from B; "A" and "A2" share A.
function sharesRankPrefix(coordA, coordB) {
  if (!coordA || !coordB) return false;
  const [ra, ca] = coordA.split(',');
  const [rb, cb] = coordB.split(',');
  return (ra && rb && ra[0] === rb[0]) || (ca && cb && ca[0] === cb[0]);
}

// /pixel/:coord — every pubkey present at a coord, ranked by mass (densest
// first). The owner is the densest pubkey that ALSO clears the σ/n threshold —
// market-clearing: the pixel is contested, the densest verified competence wins.
export function pixelOwners(coord, map = loadMap()) {
  const rows = [];
  for (const [pubkey, coords] of Object.entries(map)) {
    const cell = coords[coord];
    if (!cell) continue;
    rows.push({
      pubkey_hex: pubkey, n: cell.n,
      sigma_mean: cell.sigma_mean, sigma_max: cell.sigma_max,
      drift_mean: cell.drift_mean, mass: round(mass(cell)),
      verified: meetsThreshold(cell)
    });
  }
  rows.sort((a, b) => b.mass - a.mass);
  const ownerIdx = rows.findIndex(r => r.verified);
  rows.forEach((r, i) => { r.owns = i === ownerIdx; });
  return { coord, owners: rows, owner: ownerIdx >= 0 ? rows[ownerIdx].pubkey_hex : null };
}

// The market-clearing owner of a coord (or null if no verified competence).
export function ownerOf(coord, map = loadMap()) {
  return pixelOwners(coord, map).owner;
}

// /dignity/:pubkey — the operator's owned territory, their dignity pixel, and
// the navigable gaps (unowned node coords) ranked by corpus potential, with the
// single highest gap adjacent (rank-prefix) to owned ground surfaced as next_axis.
export function dignityFor(pubkey, map = loadMap()) {
  const cells = map[pubkey] || {};
  const coords = Object.keys(cells);

  // Dignity pixel: P's own highest dignity-score coord.
  let dignity_pixel = null, best = -Infinity;
  for (const c of coords) {
    const s = dignityScore(cells[c]);
    if (s > best) { best = s; dignity_pixel = c; }
  }

  // Owned: P clears threshold here AND wins the market (market-clearing owner).
  const owned = coords
    .filter(c => meetsThreshold(cells[c]) && ownerOf(c, map) === pubkey)
    .sort((a, b) => mass(cells[b]) - mass(cells[a]));
  const ownedSet = new Set(owned);

  // Gaps: every canonical node coord P does NOT own, ranked by corpus potential.
  const gaps = corpusCoords()
    .filter(({ coord }) => !ownedSet.has(coord))
    .sort((a, b) => b.potential - a.potential)
    .map(({ coord, potential }) => ({ coord, potential }));

  // Next axis: highest-potential gap adjacent to owned ground.
  let next_axis = null;
  if (owned.length) {
    next_axis = gaps.find(g => owned.some(o => sharesRankPrefix(g.coord, o)))?.coord || null;
  }

  // Dignity sub-pixel: the heaviest depth-2 child of the dignity coord — the
  // cell-resolution pixel inside the operator's strongest region (the zoom-in).
  let dignity_subpixel = null;
  if (dignity_pixel) {
    const kids = cells[dignity_pixel]?.children || {};
    let bs = -Infinity;
    for (const [px, c] of Object.entries(kids)) {
      const m = (c.sigma_mean ?? 0) * (c.n ?? 0);
      if (m > bs) { bs = m; dignity_subpixel = px; }
    }
  }

  // Proximity gauge: how far the dignity cell is from insurable/ownable. Lets
  // the growth story read BEFORE ownership clears ("σ 3.07 — 0.33 below floor").
  const dcell = dignity_pixel ? cells[dignity_pixel] : null;
  const dignity_cell = dcell ? {
    coord: dignity_pixel, n: dcell.n, sigma_mean: dcell.sigma_mean,
    sigma_max: dcell.sigma_max, drift_mean: dcell.drift_mean
  } : null;
  const distance_to_insurable = dcell ? {
    sigma_gap: round(Math.max(0, SIGMA_FLOOR - dcell.sigma_mean)),
    drift_gap: round(Math.max(0, dcell.drift_mean - FRICTION_CEILING_PCT)),
    n_to_own: Math.max(0, OWN_MIN_N - dcell.n),
    insurable: dcell.sigma_mean >= SIGMA_FLOOR && dcell.drift_mean <= FRICTION_CEILING_PCT
  } : null;

  return {
    pubkey_hex: pubkey,
    dignity_pixel,
    dignity_subpixel,
    dignity_score: dignity_pixel ? round(best) : 0,
    dignity_cell,
    distance_to_insurable,
    owned,
    gaps,
    next_axis
  };
}

// /submap/:coord — zoom into a coord: its depth-2 children (cell-resolution
// pixels) ranked by mass. The literal map-of-maps — a sub-lattice addressed by
// the parent coordinate, no SimHash linking required.
export function subMapOf(pubkey, coord, map = loadMap()) {
  const cell = (map[pubkey] || {})[coord];
  const kids = cell?.children || {};
  const children = Object.entries(kids).map(([pixel, c]) => ({
    pixel, n: c.n, sigma_mean: c.sigma_mean, sigma_max: c.sigma_max,
    last_at: c.last_at, mass: round((c.sigma_mean ?? 0) * (c.n ?? 0))
  })).sort((a, b) => b.mass - a.mass);
  return {
    pubkey_hex: pubkey, coord,
    parent: cell ? { n: cell.n, sigma_mean: cell.sigma_mean, sigma_max: cell.sigma_max } : null,
    children
  };
}

export { EWMA_ALPHA, SIGMA_FLOOR, OWN_MIN_N, FRICTION_CEILING_PCT };
