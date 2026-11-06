#!/usr/bin/env node
// scripts/pmu/lane-index.mjs — YOUR OWN INDEX. The second half of the entry point.
//
//   npx thetacog-mcp index
//
// THE NOSTR PATTERN, applied to competence: there is no central registry to join and nobody to
// ask. Every surface publishes its own signed receipts and its own dignity pixel on its own
// public repo; YOU run YOUR index over the surfaces YOU chose to follow, and rank them by how
// close they sit to YOUR coordinate on the shared 144×144 lattice. Two people following
// different surfaces get different indexes from the same code, and neither is wrong — the
// index is a point of view, exactly like tape/big-map-axes is.
//
// HONEST SCOPE, said once here and printed on every run: this is the INDEX half. The signed
// transport (ed25519 events, hash-chained, replay-projected) is scripts/mesh/; the publication
// substrate is git itself — a public repo IS the relay, which is why no relay ships here.
//
// WHAT IT COMPUTES, all offline, deterministic, LLM-free:
//   1. Your pixel from tape/dignity-pixel.json           (npx thetacog-mcp my-pixel writes it)
//   2. Every indexed surface's pixel from tape/map.json  (npx thetacog-mcp map-crawl writes it)
//   3. The lattice relation of each to you, under the canonical connectivity rule — two cells
//      are ADJACENT when they share a row OR a column axis (one hop on the walk's DAG). Same
//      cell = someone is standing on your coordinate. No shared axis = off-lane, unreachable
//      in one hop.
//   4. THE ALPHA COORDINATE: among the cells adjacent to yours, the ones NO surface you index
//      occupies — demand nearby, supply vacant. Ranked by how many indexed surfaces share an
//      axis with the candidate; ties break in ShortLex order.
//
// THE SUFFICIENCY CONTRACT (AXIOM 1, W6). Sufficient for: which surfaces you follow are in your
// lane, and which adjacent coordinates none of them occupy. NOT sufficient for: whether a
// vacant coordinate is vacant because it is valuable or because it is worthless — the index
// cannot see that, and the denominator (how many surfaces you actually follow) is printed on
// every run so a one-surface index can never read as a market survey.
//
// FAIL-CLOSED: no pixel of your own, or nothing crawled to index -> UNMEASURED + the exact
// command that fixes it, exit 1. An empty index is a different claim from an empty market.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CWD = process.cwd();
const readJson = (rel) => {
  const p = resolve(CWD, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};

// ShortLex over the 12 axes: shorter first, then lexicographic. 12 x 12 = the 144 cells.
const AXES = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const AXNAME = {
  A: 'Strategy', B: 'Tactics', C: 'Operations',
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};
// ALWAYS EXPAND COORDINATE LABELS — a bare rank is opaque to a reader who just arrived.
export const fullLabel = (coord) => {
  const [r, c] = String(coord || '').split(',');
  if (!r || !c) return String(coord || '—');
  return `${r},${c} (${AXNAME[r] || r} × ${AXNAME[c] || c})`;
};

const split = (coord) => {
  const [r, c] = String(coord || '').split(',');
  return AXES.includes(r) && AXES.includes(c) ? [r, c] : null;
};

/**
 * The canonical connectivity rule (buildIntentGrid): cells are one hop apart when they share a
 * row OR a column axis. Identical cells are SAME-CELL, not adjacent — someone is on your pixel.
 */
export function relation(mine, theirs) {
  const a = split(mine), b = split(theirs);
  if (!a || !b) return 'UNPLACED';
  if (a[0] === b[0] && a[1] === b[1]) return 'SAME-CELL';
  if (a[0] === b[0] || a[1] === b[1]) return 'IN-LANE';
  return 'OFF-LANE';
}

/** Every cell one hop from yours, in ShortLex order, excluding your own. */
export function adjacentCells(mine) {
  const a = split(mine);
  if (!a) return [];
  const out = [];
  for (const c of AXES) if (c !== a[1]) out.push(`${a[0]},${c}`);   // along your row axis
  for (const r of AXES) if (r !== a[0]) out.push(`${r},${a[1]}`);   // along your column axis
  return out;
}

// Below this many published pixels the demand score cannot discriminate, whatever it prints.
const MIN_PIXELS_TO_RANK = 3;

/**
 * THE ALPHA COORDINATE. Vacancy is a hard filter (nobody you index is there); demand is the
 * rank (how many indexed surfaces share an axis with the candidate). Deterministic throughout:
 * ties break in ShortLex order.
 *
 * A RANKED verdict requires the demand scores to actually SEPARATE — max > min — and at least
 * MIN_PIXELS_TO_RANK published pixels behind them. Without that, every candidate ties and the
 * winner is whatever ShortLex put first: a sort order wearing a ranking's clothes. It is
 * reported as UNRANKED and the top row is labelled arbitrary, because a confident-sounding
 * verdict off a denominator of one is the failure this project exists to refuse.
 */
export function rankAlpha(mine, peerPixels) {
  const pixels = peerPixels.filter(Boolean);
  const occupied = new Set(pixels);
  const candidates = adjacentCells(mine).filter((cell) => !occupied.has(cell));
  const scored = candidates.map((cell, shortlexRank) => {
    const [r, c] = split(cell);
    const demand = pixels.filter((p) => {
      const b = split(p);
      return b && (b[0] === r || b[1] === c);
    }).length;
    return { coordinate: cell, full_name: fullLabel(cell), demand, shortlexRank };
  });
  scored.sort((x, y) => y.demand - x.demand || x.shortlexRank - y.shortlexRank);
  const demands = scored.map((s) => s.demand);
  const separates = demands.length > 0 && Math.max(...demands) > Math.min(...demands);
  const enough = pixels.length >= MIN_PIXELS_TO_RANK;
  const ranked = separates && enough;
  let confidence;
  if (ranked) confidence = `RANKED — demand separates across ${pixels.length} indexed pixels`;
  else if (!enough) confidence = `UNRANKED — only ${pixels.length} indexed pixel(s) (need ${MIN_PIXELS_TO_RANK}); the pick below is ShortLex-first, NOT evidence`;
  else confidence = 'UNRANKED — every adjacent cell scores the same demand; the pick below is ShortLex-first, NOT evidence';
  return { ranked, confidence, candidates: scored };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const me = readJson('tape/dignity-pixel.json');
  if (!me || !split(me.dignity_pixel)) {
    console.error('UNMEASURED — you have no coordinate of your own yet, so nothing can be ranked relative to it.');
    console.error('  Compute it first (offline, from your own public text):  npx thetacog-mcp my-pixel');
    process.exit(1);
  }
  const map = readJson('tape/map.json');
  const subs = readJson('tape/subscriptions.json') || [];
  if (!map || !Array.isArray(map.surfaces) || map.surfaces.length === 0) {
    console.error('UNMEASURED — nothing indexed yet. An empty index is not an empty market, and this');
    console.error('  tool will not print one as if it were.');
    console.error('  Crawl the surfaces first:  npx thetacog-mcp map-crawl   [requires: network]');
    console.error('  Follow more than the fork graph by adding them to tape/subscriptions.json.');
    process.exit(1);
  }

  const mine = me.dignity_pixel;
  const myUrl = String(me.surface_url || '').replace(/\.git$/, '');
  const peers = map.surfaces
    .filter((s) => String(s.surface || '').replace(/\.git$/, '') !== myUrl)
    .map((s) => ({
      surface: s.surface,
      pixel: s.dignity_pixel || null,
      full_name: s.dignity_pixel ? fullLabel(s.dignity_pixel) : null,
      grip_sigma: s.grip_sigma ?? null,
      relation: relation(mine, s.dignity_pixel),
      // carried through verbatim: a self-reported row is a weaker index row than a recomputed one
      standing: s.inbound_attestations > 0 ? 'peer-recomputed' : 'self-reported',
      inbound_attestations: s.inbound_attestations ?? 0,
    }));

  const withPixel = peers.filter((p) => p.pixel);
  const alpha = rankAlpha(mine, withPixel.map((p) => p.pixel));
  const bucket = (r) => peers.filter((p) => p.relation === r);

  const index = {
    _view: 'YOUR INDEX — the surfaces YOU follow, ranked by lane proximity to YOUR pixel. A point of view, not a registry.',
    _regenerate: 'npx thetacog-mcp index',
    _pattern: 'nostr: no central registry — every surface publishes its own signed receipts on its own public repo; you index the ones you chose.',
    _sufficient_for: 'which surfaces you index sit in your lane, and which adjacent coordinates none of them occupy',
    _not_sufficient_for: 'whether a vacant coordinate is vacant because it is valuable or because it is worthless — read the denominator before treating this as a market view',
    you: { pixel: mine, full_name: fullLabel(mine), surface: myUrl || null, grip_sigma: me.grip_sigma ?? null },
    denominator: {
      surfaces_indexed: peers.length,
      with_a_published_pixel: withPixel.length,
      subscriptions: subs.length,
      source: 'tape/map.json (npx thetacog-mcp map-crawl) + tape/subscriptions.json',
    },
    same_cell: bucket('SAME-CELL'),
    in_lane: bucket('IN-LANE'),
    off_lane: bucket('OFF-LANE'),
    unplaced: bucket('UNPLACED'),
    alpha: alpha.candidates[0]
      ? { ...alpha.candidates[0], vacant: true, ranked: alpha.ranked, confidence: alpha.confidence }
      : { coordinate: null, confidence: 'NONE — every adjacent cell is occupied by a surface you index' },
    alpha_candidates: alpha.candidates.slice(0, 5),
  };

  mkdirSync(resolve(CWD, 'tape'), { recursive: true });
  writeFileSync(resolve(CWD, 'tape/index.json'), JSON.stringify(index, null, 2));

  console.log('◎ YOUR INDEX — no registry, no permission: the surfaces you follow, placed against yours');
  console.log('  you: ' + index.you.full_name + (index.you.grip_sigma != null ? ' · grip σ ' + index.you.grip_sigma : ''));
  console.log('  indexing ' + peers.length + ' surface(s), ' + withPixel.length + ' with a published pixel'
    + ' · ' + subs.length + ' subscription(s)');
  for (const [label, rows] of [['same cell', index.same_cell], ['in lane', index.in_lane], ['off lane', index.off_lane], ['unplaced', index.unplaced]]) {
    if (!rows.length) continue;
    console.log('  ' + label + ':');
    for (const r of rows) console.log('    ' + r.surface + '  ' + (r.full_name || 'no pixel published')
      + (r.grip_sigma != null ? ' · σ ' + r.grip_sigma : '') + '  [' + r.standing + ']');
  }
  console.log('  α  ' + (index.alpha.coordinate ? index.alpha.full_name + ' · demand ' + index.alpha.demand : '—'));
  console.log('     ' + index.alpha.confidence);
  console.log('  → tape/index.json · sufficient for: ' + index._sufficient_for);
  console.log('    NOT sufficient for: ' + index._not_sufficient_for);
  if (withPixel.length < 3) {
    console.log('  ⚠ ' + withPixel.length + ' indexed pixel(s) — too thin to rank. Follow more surfaces in'
      + ' tape/subscriptions.json, then re-run map-crawl.');
  }
}
