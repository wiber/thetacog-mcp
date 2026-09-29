#!/usr/bin/env node
// scripts/vna/competence-pixel.mjs — THE OPERATOR'S COMPETENCE SHAPE, FROM EVIDENCE THAT ALREADY EXISTS
//
// The cockpit exists so the operator can see the forest for the trees. The endgame is a delta-encircled
// panel of his OWN competence shape: a CENTRE OF MASS, an ACTIVATION SHAPE (where the receipted work
// actually sits on the map of maps), and a GROWTH EDGE (where existing mass is nearest to unclaimed
// ground). The KPI is the leverage of the operator's grounding — and leverage is only readable if the
// instrument refuses to print a number it cannot stand behind.
//
// ── THE SUBSTRATE, found rather than invented ────────────────────────────────────────────────────
//   1. scripts/pmu/map-of-maps.mjs — the competence-by-coordinate store. Its cell shape
//      {n, sigma_mean (EWMA α=0.4), sigma_max, first_at, last_at} and its mass() = σ_mean × n are the
//      ONLY weighting used here. EWMA is deliberate (current outranks history); this file adds no second
//      recency scheme. Cells are produced by the store's own foldReceipts(), so they cannot drift from it.
//   2. src/data/commit-greeks-index.json — every commit's REALIZED coord + σ + ts. This is where the
//      work LANDED. Landing somewhere often is time-on-target, which is evidence; it is not a quality
//      claim, and Rice forbids the quality claim outright.
//   3. data/vna/pick-ledger.ndjson — which arm the operator takes (MOVE THE WORK vs MOVE THE
//      DECLARATION), written by scripts/vna/envelope.mjs --pick. New, and today nearly empty.
//   4. .thetacog/redirect-effect.ndjson — the output of scripts/pmu/redirect-effect.mjs (Δ_redirect,
//      whether a redirect was load-bearing). READ, never re-run from here: that script APPENDS every
//      row on every run, so driving it from a reader would multiply its own ledger.
//   5. scripts/vna/self-lane-panel.mjs — encircleSelfLane() bands a 144×144 matrix through the SHARED
//      tolerance-hue door. On a single-corpus panel a ring means SELF-DISPERSION, never drift.
//
// ── THE HONESTY CONTRACT, which matters more than the feature ───────────────────────────────────
//   • MINIMUM SAMPLE FLOOR. A shape computed from 0–3 picks is noise wearing a number. Below MIN_PICKS
//     (30 — the same floor measure-agreement.mjs uses for a bucket) the pick component reports
//     UNDERPOWERED with its n, and prints NO arm shares. The commit shape carries the same floor
//     (MIN_COMMITS). "I do not have enough data to say" and "the effect is absent" are different claims.
//   • THE SENTINEL FENCE. The greeks index carries σ=99 on a handful of commits, every one of them at
//     the origin A,A (Strategy ⊕ Strategy) — a could-not-place marker, not a measurement. The
//     non-sentinel ceiling on this index is 1.73, so anything above SIGMA_SENTINEL is excluded and the
//     count is printed. Un-fenced, four sentinels would EWMA the origin into the heaviest cell on the map.
//   • σ CARRIES ALMOST NO DISCRIMINATION on this index (p25–p95 = 1.49–1.73). The σ weighting is
//     honoured because it is the store's rule, and its coefficient of variation is printed so nobody
//     reads "σ-weighted" as "quality-weighted". On today's data the shape is time-on-target count.
//   • A GROWTH EDGE IS ADJACENCY WITH LOW MASS. Chebyshev-1 neighbours of the centre carrying less than
//     the panel's own dominance threshold (10% of peak). It is where competence is nearest to
//     unclaimed ground. It is NOT a prediction of anything — not of outcomes, not of money. That claim
//     is unfalsifiable and banned (NEVER GUARANTEE BEHAVIOR).
//   • LLM-FREE end to end. Exit 0 when measured (an UNDERPOWERED component is a measurement, honestly
//     reported). Exit 2 when the substrate is absent — "I did not look" and "I looked and saw nothing"
//     are different claims.
//
// SUFFICIENCY CONTRACT (AXIOM 1 W6), printed on the receipt rather than implied:
//   SUFFICIENT FOR: where the operator's receipted work concentrates on the lattice, how tightly, and
//   which adjacent coordinates carry little mass — re-runnable from the same files, no model anywhere.
//   NOT SUFFICIENT FOR: whether any of that work was good (Rice); whether the operator would CHOOSE
//   these coordinates (that is the pick ledger, and it is underpowered); anything about the future.
//
// Env (for hermetic guards): VNA_GREEKS · VNA_PICK_LEDGER · VNA_REDIRECT_LOG · VNA_OUT_DIR ·
//                            PMU_MAP_STORE (the store's own override) · VNA_MIN_PICKS · VNA_MIN_COMMITS
// @guard tests/vna/competence-pixel.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldReceipts, mass, loadMap, storePath, EWMA_ALPHA } from '../pmu/map-of-maps.mjs';
import { encircleSelfLane, PANEL_MEANING, LIT_MASS_FLOOR } from './self-lane-panel.mjs';
import { fullLabel } from '../pmu/attest-hypotheses.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const GREEKS = process.env.VNA_GREEKS || resolve(REPO, 'src/data/commit-greeks-index.json');
const LEDGER = process.env.VNA_PICK_LEDGER || resolve(REPO, 'data/vna/pick-ledger.ndjson');
const REDIRECT_LOG = process.env.VNA_REDIRECT_LOG || resolve(REPO, '.thetacog/redirect-effect.ndjson');
const OUT_DIR = process.env.VNA_OUT_DIR || resolve(REPO, 'data/vna');

export const MIN_PICKS = Number(process.env.VNA_MIN_PICKS || 30);      // measure-agreement's MIN_BUCKET
export const MIN_COMMITS = Number(process.env.VNA_MIN_COMMITS || 30);  // same floor, same argument
export const SIGMA_SENTINEL = 10;   // non-sentinel ceiling on the index is 1.73; 99 is a marker, not σ
export const DOMINANCE = 0.10;      // the panel's own dominant-block rule — "low mass" means below this

const N = 144, NB = 12;
const AX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const SHORTLEX = /^([A-C][1-3]?),([A-C][1-3]?)$/;

// ── geometry: coord ⇄ block on the 12×12 block grid (each block = 12×12 cells of the 144×144 panel)
export function blockOf(coord) {
  const m = SHORTLEX.exec(String(coord || '').trim());
  return m ? [AX.indexOf(m[1]), AX.indexOf(m[2])] : null;
}
export const coordOfBlock = (r, c) => `${AX[r]},${AX[c]}`;
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const named = (coord) => ({ coord, name: fullLabel(coord) });
const pct = (x) => Math.round(1000 * x) / 10;

// ── the floor, as one predicate so the guard can fire it in both directions ─────────────────────
export function pickVerdict(n, floor = MIN_PICKS) {
  return n >= floor ? 'POWERED' : 'UNDERPOWERED';
}

// ── 1. cells from the greeks index, folded through the store's own definition ───────────────────
export function cellsFromGreeks(greeks) {
  const rows = [], excluded = { sentinel: [], nonShortlex: 0, noTs: 0 };
  for (const [sha, g] of Object.entries(greeks)) {
    const ts = g.ts ? new Date(g.ts).getTime() : NaN;
    if (!Number.isFinite(ts)) { excluded.noTs++; continue; }
    if (!blockOf(g.coord)) { excluded.nonShortlex++; continue; }
    if ((g.sigma ?? 0) >= SIGMA_SENTINEL) { excluded.sentinel.push({ sha: sha.slice(0, 9), coord: g.coord, sigma: g.sigma }); continue; }
    rows.push({ coord: g.coord, sigma: g.sigma ?? 0, at: g.ts, ts, run_id: sha });
  }
  rows.sort((a, b) => a.ts - b.ts);   // EWMA is order-dependent: newest folds last
  const sig = rows.map((r) => r.sigma).sort((a, b) => a - b);
  const q = (p) => sig.length ? sig[Math.min(sig.length - 1, Math.floor(p * sig.length))] : null;
  const mu = sig.length ? sig.reduce((a, b) => a + b, 0) / sig.length : 0;
  const sd = sig.length ? Math.sqrt(sig.reduce((a, b) => a + (b - mu) ** 2, 0) / sig.length) : 0;
  // how much the σ weighting can move one cell's mass relative to another, at most — p95/p25 − 1.
  // Printed as a number so nobody reads "σ-weighted" as "quality-weighted".
  const sigmaLeverPct = q(0.25) ? Math.round(100 * (q(0.95) / q(0.25) - 1)) : null;
  return { cells: foldReceipts(rows), used: rows.length, excluded,
    sigma: { p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), cv: mu ? +(sd / mu).toFixed(3) : null, leverPct: sigmaLeverPct },
    span: rows.length ? { first: rows[0].at, last: rows[rows.length - 1].at } : null };
}

// ── 2. the shape: centre of mass, peak, radius, concentration ───────────────────────────────────
export function shapeFromCells(cells, { minCommits = MIN_COMMITS } = {}) {
  const entries = Object.entries(cells).map(([coord, cell]) => ({ coord, cell, block: blockOf(coord), mass: mass(cell) }))
    .filter((e) => e.block && e.mass > 0);
  const n = entries.reduce((a, e) => a + e.cell.n, 0);
  const total = entries.reduce((a, e) => a + e.mass, 0);
  const verdict = n >= minCommits ? 'MEASURED' : 'UNDERPOWERED';
  if (verdict === 'UNDERPOWERED' || !total) {
    return { verdict, n, minCommits, neededForPower: Math.max(0, minCommits - n), coords: entries.length,
      peak: null, centroid: null, radiusCheb: null, within1Share: null, topMass: [], concentration: null };
  }
  entries.sort((a, b) => b.mass - a.mass);
  const peak = entries[0];
  const rBar = entries.reduce((a, e) => a + e.mass * e.block[0], 0) / total;
  const cBar = entries.reduce((a, e) => a + e.mass * e.block[1], 0) / total;
  const cBlock = [Math.round(rBar), Math.round(cBar)];
  const centroidCoord = coordOfBlock(cBlock[0], cBlock[1]);
  const radius = entries.reduce((a, e) => a + e.mass * cheb(e.block, cBlock), 0) / total;
  const within1 = entries.filter((e) => cheb(e.block, cBlock) <= 1).reduce((a, e) => a + e.mass, 0) / total;
  const topMass = entries.slice(0, 8).map((e) => ({ ...named(e.coord), n: e.cell.n, sigma_mean: e.cell.sigma_mean,
    mass: +e.mass.toFixed(2), sharePct: pct(e.mass / total), last_at: e.cell.last_at, chebFromCentroid: cheb(e.block, cBlock) }));
  return {
    verdict, n, minCommits, coords: entries.length, totalMass: +total.toFixed(2),
    peak: { ...named(peak.coord), n: peak.cell.n, mass: +peak.mass.toFixed(2), sharePct: pct(peak.mass / total),
      first_at: peak.cell.first_at, last_at: peak.cell.last_at },
    centroid: { ...named(centroidCoord), block: cBlock, exact: [+rBar.toFixed(2), +cBar.toFixed(2)],
      coincidesWithPeak: centroidCoord === peak.coord, massAtCentroid: +(cells[centroidCoord] ? mass(cells[centroidCoord]) : 0).toFixed(2) },
    radiusCheb: +radius.toFixed(2), within1Share: pct(within1), topMass,
    // a description, never a grade — both shapes are real
    concentration: within1 >= 0.5 ? 'TIGHT — most mass sits within one block of the centre'
      : within1 >= 0.25 ? 'MIXED — a core with real mass elsewhere' : 'SPREAD — mass sits across several unrelated lanes',
  };
}

// ── 3. the activation shape as a 144×144 matrix for the shared encircle door ─────────────────────
// Block-resolution by construction: the greeks index carries depth-1 coords only, so each coord's
// 12×12 block is filled uniformly with its mass. Depth-2 sub-pixels would need the signed store's
// children{}, which the operator's store does not yet hold (see substrate.signedStore).
//
// THE MASS IS QUANTISED TO AN INTEGER, and the reason is a measured defect shape, not tidiness. The door
// keeps a cell only if w >= mu + k·sd over its lattice ROW (significantEdges, k=1). On a block-filled
// matrix a row holding ONE uniform value has sd = 0 ± ε, and a row holding TWO equal-count values puts
// its maximum EXACTLY on the threshold — so whether a block survives was a floating-point coin flip:
// measured 2026-09-08, a 40.00 block and a 3.20 block were dropped while 8 and 32 (exactly
// representable) survived. Integers make s/n, s2/n and sd exact, so the same block is significant
// every run. Real walk matrices are never uniform, which is why the shared renderer never sees this.
// The receipt's numbers come from the unquantised cells; only the PANEL INPUT is quantised, and a
// toehold never rounds to zero.
export function matrixFromCells(cells) {
  const m = new Float64Array(N * N);
  for (const [coord, cell] of Object.entries(cells)) {
    const b = blockOf(coord); const raw = mass(cell);
    if (!b || !(raw > 0)) continue;
    const w = Math.max(1, Math.round(raw));
    for (let r = 0; r < NB; r++) for (let c = 0; c < NB; c++) m[(b[0] * NB + r) * N + (b[1] * NB + c)] = w;
  }
  return m;
}

// ── 4. the growth edge: Chebyshev-1 neighbours of the centre carrying little mass ───────────────
export function growthEdge(cells, centreCoord, { dominance = DOMINANCE } = {}) {
  const cb = blockOf(centreCoord);
  if (!cb) return { centre: null, threshold: null, items: [] };
  let peakMass = 0; for (const cell of Object.values(cells)) peakMass = Math.max(peakMass, mass(cell));
  const threshold = dominance * peakMass;
  const items = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const r = cb[0] + dr, c = cb[1] + dc;
    if (r < 0 || r >= NB || c < 0 || c >= NB) continue;
    const coord = coordOfBlock(r, c); const cell = cells[coord]; const w = cell ? mass(cell) : 0;
    if (w < threshold) items.push({ ...named(coord), n: cell?.n ?? 0, mass: +w.toFixed(2), chebFromCentre: 1, toehold: w > 0 });
  }
  // sort: a toehold first (some receipts already there), then the empty ground — a sort, not a ranking of worth
  items.sort((a, b) => b.mass - a.mass);
  return { centre: named(centreCoord), threshold: +threshold.toFixed(2), dominance, items,
    meaning: 'adjacency (Chebyshev 1 from the centre of mass) carrying less than the panel\'s dominance threshold. ' +
      'This is where existing competence is nearest to unclaimed ground. It is a geometric fact about the receipts, not a prediction of any outcome.' };
}

// ── 5. the pick ledger — UNDERPOWERED until it is not ───────────────────────────────────────────
export function readPicks(path = LEDGER, { minPicks = MIN_PICKS } = {}) {
  const present = existsSync(path);
  const rows = present ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const n = rows.length;
  const verdict = pickVerdict(n, minPicks);
  const out = { path, present, n, minPicks, verdict, neededForPower: Math.max(0, minPicks - n),
    absence: 'a work-arm pick row records moveWorkTarget as a checklist ID, not a coordinate — envelope.mjs recordPick() would need to write the target coord before a work-arm pick can be placed on the lattice',
    armShare: null, declaredCoords: null };
  if (verdict !== 'POWERED') return out;
  const arms = { work: 0, declaration: 0 };
  for (const r of rows) if (r.arm in arms) arms[r.arm]++;
  const decl = {};
  for (const r of rows) if (r.arm === 'declaration' && blockOf(r.moveDeclCoord)) decl[r.moveDeclCoord] = (decl[r.moveDeclCoord] || 0) + 1;
  out.armShare = { workPct: pct(arms.work / n), declarationPct: pct(arms.declaration / n), counts: arms };
  out.declaredCoords = Object.entries(decl).sort((a, b) => b[1] - a[1]).map(([coord, k]) => ({ ...named(coord), picks: k }));
  return out;
}

// ── 6. the redirect effect — read the ledger redirect-effect.mjs already writes ─────────────────
export function readRedirect(path = REDIRECT_LOG, peakCoord = null, { minBucket = MIN_PICKS } = {}) {
  if (!existsSync(path)) return { path, present: false, verdict: 'ABSENT — run node scripts/pmu/redirect-effect.mjs (it writes this ledger; this reader never runs it)' };
  const byRun = new Map();
  for (const l of readFileSync(path, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (r.sha) byRun.set(r.sha, r); } catch { /* skip */ } }
  const rows = [...byRun.values()];   // the script appends on every run; one row per commit, last wins
  const f = (rs) => {
    const d = rs.filter((r) => r.delta != null).map((r) => r.delta);
    return { n: rs.length, deltaSamples: d.length,
      deltaMean: d.length ? +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2) : null,
      redirectNamedLanePct: rs.length ? pct(rs.filter((r) => r.dRedir <= 2).length / rs.length) : null };
  };
  const all = f(rows);
  const atPeak = peakCoord ? f(rows.filter((r) => r.result === peakCoord)) : null;
  return { path, present: true, rawRows: byRun.size, all, atPeak: atPeak ? { coord: peakCoord, ...atPeak, verdict: pickVerdict(atPeak.n, minBucket) } : null,
    meaning: 'Δ_redirect > 0 means the reef redirect pulled intent toward where the work landed (load-bearing). It is about the instrument\'s steering, not the operator\'s competence.' };
}

// ── the whole computation, pure over its inputs ─────────────────────────────────────────────────
export function computeCompetence({ greeks, picksPath = LEDGER, redirectPath = REDIRECT_LOG, store = null } = {}) {
  const g = cellsFromGreeks(greeks);
  const shape = shapeFromCells(g.cells);
  const matrix = matrixFromCells(g.cells);
  const band = shape.verdict === 'MEASURED' ? encircleSelfLane(matrix) : { refused: true, refusal: 'shape UNDERPOWERED — no panel rendered', png: null, regions: [] };
  const edge = shape.centroid ? growthEdge(g.cells, shape.centroid.coord) : { centre: null, items: [] };
  const picks = readPicks(picksPath);
  const redirect = readRedirect(redirectPath, shape.peak?.coord ?? null);

  // the signed store: what the map-of-maps actually holds for anyone at ShortLex coords
  const map = store ?? loadMap();
  const pubkeys = Object.keys(map);
  let receipts = 0, shortlexCoords = 0;
  for (const coords of Object.values(map)) for (const [coord, cell] of Object.entries(coords)) { receipts += cell.n || 0; if (blockOf(coord)) shortlexCoords++; }
  const signedStore = { path: storePath(), pubkeys: pubkeys.length, receipts, shortlexCoords,
    verdict: shortlexCoords ? 'HOLDS SHORTLEX CELLS' : 'EMPTY OF PLACEABLE RECEIPTS — the shape below is derived from commit landings, not signed receipts' };

  return {
    at: new Date().toISOString(), llmFree: true,
    substrate: { greeks: { path: GREEKS, commits: Object.keys(greeks).length, used: g.used, excluded: { sentinels: g.excluded.sentinel.length,
      sentinelCoords: [...new Set(g.excluded.sentinel.map((s) => s.coord))], nonShortlex: g.excluded.nonShortlex, noTs: g.excluded.noTs },
      sigma: g.sigma, sigmaNote: 'leverPct = p95/p25 − 1: the most the σ weighting can move one cell\'s mass relative to another. Small means mass ≈ time-on-target count.',
      span: g.span, ewmaAlpha: EWMA_ALPHA }, signedStore },
    shape,
    panel: { meaning: PANEL_MEANING.reality, litMassFloor: LIT_MASS_FLOOR, refused: !!band.refused, refusal: band.refusal || null,
      green: band.green ?? null, amber: band.amber ?? null, red: band.red ?? null, dispersionPct: band.dispersionPct ?? null,
      litMass: band.litMass ?? null, significantCoords: band.litMass != null ? Math.round(band.litMass / (NB * NB)) : null, domBlockCount: band.domBlockCount ?? null,
      significanceNote: 'the panel shows the row-significant subset (significantEdges k=1.0, the shared tolerance-panel rule); topMass on this receipt carries every coord',
      regions: (band.regions || []).map((r) => ({ cls: r.cls ?? r.class ?? null, coord: r.coord?.center || r.coord || null, reef: r.reef || null })),
      resolution: 'block (12×12 cells per coord, mass quantised to an integer for the panel input) — the greeks index carries depth-1 coords only' },
    growthEdge: edge, picks, redirect,
    claims: {
      whatThisIs: 'where the operator\'s receipted work LANDED, weighted by the store\'s own EWMA σ × n, and how tightly it clusters',
      whatThisIsNot: 'a quality claim (undecidable — Rice), a preference claim (pick ledger underpowered), or a forecast of any outcome',
      sufficientFor: 'centre of mass, activation shape, concentration vs dispersion, and adjacency with low mass — re-runnable from the same files',
      notSufficientFor: 'whether the work was good, whether the operator would choose these coordinates, or anything about the future',
    },
    _png: band.png || null,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(GREEKS)) {
    console.error(`NOT ADMISSIBLE (exit 2): substrate absent — ${GREEKS} does not exist. I did not look at a shape; there was nothing to look at.`);
    process.exit(2);
  }
  let greeks;
  try { greeks = JSON.parse(readFileSync(GREEKS, 'utf8')); }
  catch (e) { console.error(`NOT ADMISSIBLE (exit 2): substrate unreadable — ${e.message}`); process.exit(2); }

  const R = computeCompetence({ greeks });
  const { shape, panel, growthEdge: edge, picks, redirect, substrate } = R;

  console.log(`COMPETENCE PIXEL — the operator's shape on the map of maps, LLM-free\n`);
  console.log(`substrate  ${substrate.greeks.commits} commits · ${substrate.greeks.used} used · ${substrate.greeks.excluded.sentinels} σ-sentinel excluded` +
    (substrate.greeks.excluded.sentinelCoords.length ? ` (all at ${substrate.greeks.excluded.sentinelCoords.map(fullLabel).join(', ')})` : '') +
    ` · span ${substrate.greeks.span?.first?.slice(0, 10)} → ${substrate.greeks.span?.last?.slice(0, 10)}`);
  const sg = substrate.greeks.sigma;
  console.log(`           σ p25–p95 = ${sg.p25}–${sg.p95} (CV ${sg.cv}) · the σ weighting moves a cell's mass by at most ~${sg.leverPct}% relative — mass is ${sg.leverPct != null && sg.leverPct < 25 ? 'essentially' : 'partly'} time-on-target count`);
  console.log(`           signed store: ${substrate.signedStore.pubkeys} pubkey(s), ${substrate.signedStore.receipts} receipt(s), ${substrate.signedStore.shortlexCoords} at ShortLex coords → ${substrate.signedStore.verdict}\n`);

  console.log(`┌─ SHAPE · ${shape.verdict} (n=${shape.n}, floor ${shape.minCommits}) ${'─'.repeat(30)}`);
  if (shape.verdict === 'MEASURED') {
    console.log(`│ PEAK      ${shape.peak.name}  n=${shape.peak.n}  ${shape.peak.sharePct}% of mass  (last ${shape.peak.last_at.slice(0, 10)})`);
    console.log(`│ CENTROID  ${shape.centroid.name}  block ${JSON.stringify(shape.centroid.block)} exact ${JSON.stringify(shape.centroid.exact)}` +
      (shape.centroid.coincidesWithPeak ? '  = peak' : `  (≠ peak — mass at centroid ${shape.centroid.massAtCentroid})`));
    console.log(`│ RADIUS    ${shape.radiusCheb} blocks (mass-weighted Chebyshev from centroid) · ${shape.within1Share}% of mass within 1 block`);
    console.log(`│ ${shape.concentration} — a description of the shape, never a grade`);
    console.log(`│ top mass:`);
    for (const t of shape.topMass) console.log(`│   ${t.name}  n=${t.n}  ${t.sharePct}%  cheb ${t.chebFromCentroid}`);
    console.log(`│ what this is: where the work LANDED — time-on-target. Not a quality claim (Rice).`);
  } else {
    console.log(`│ ${shape.n} placeable commits is below the floor of ${shape.minCommits}; ${shape.neededForPower} more would power it. No centre is claimed.`);
  }
  console.log(`└${'─'.repeat(66)}`);

  console.log(`┌─ PANEL · self-dispersion, NOT drift ${'─'.repeat(30)}`);
  if (panel.refused) console.log(`│ ${panel.refusal}`);
  else {
    console.log(`│ green ${panel.green} · amber ${panel.amber} · red ${panel.red} · dispersion ${panel.dispersionPct}% · ${panel.significantCoords} coords row-significant (of ${shape.coords}) · dominant blocks ${panel.domBlockCount}`);
    if (!panel.regions.length) console.log(`│ no rings: nothing dispersed to encircle — the shared detector rings the MINORITY hue, and a one-lane operator has none`);
    console.log(`│ rings (${panel.regions.length}):` + panel.regions.slice(0, 6).map((r) => ` ${r.cls ?? ''}${r.coord ? ' ' + fullLabel(r.coord) : ''}`).join(' ·'));
    console.log(`│ ${panel.meaning}`);
  }
  console.log(`└${'─'.repeat(66)}`);

  console.log(`┌─ GROWTH EDGE · adjacency with low mass ${'─'.repeat(27)}`);
  if (edge.centre) {
    console.log(`│ centre ${edge.centre.name} · low = mass < ${edge.threshold} (${DOMINANCE * 100}% of peak)`);
    if (!edge.items.length) console.log(`│ every neighbour already carries dominant mass — the edge is beyond Chebyshev 1`);
    for (const it of edge.items) console.log(`│   ${it.name}  n=${it.n}  mass ${it.mass}${it.toehold ? '  (toehold)' : '  (unclaimed)'}`);
    console.log(`│ ${edge.meaning}`);
  } else console.log(`│ no centre (shape underpowered) — no edge is claimed`);
  console.log(`└${'─'.repeat(66)}`);

  console.log(`┌─ PICKS · ${picks.verdict} (n=${picks.n}, floor ${picks.minPicks}) ${'─'.repeat(28)}`);
  if (picks.verdict === 'POWERED') {
    console.log(`│ work ${picks.armShare.workPct}% · declaration ${picks.armShare.declarationPct}%`);
    for (const d of picks.declaredCoords.slice(0, 5)) console.log(`│   declaration → ${d.name}  ×${d.picks}`);
  } else {
    console.log(`│ ${picks.present ? `${picks.n} pick(s) recorded` : 'ledger absent'} — ${picks.neededForPower} more \`envelope.mjs --pick\` cycles would power it.`);
    console.log(`│ No arm shares are printed from ${picks.n} rows: that would be noise wearing a number.`);
  }
  console.log(`│ absence: ${picks.absence}`);
  console.log(`└${'─'.repeat(66)}`);

  console.log(`┌─ REDIRECT EFFECT · read from redirect-effect.mjs's ledger ${'─'.repeat(9)}`);
  if (!redirect.present) console.log(`│ ${redirect.verdict}`);
  else {
    console.log(`│ all commits: n=${redirect.all.n} · Δ_redirect mean ${redirect.all.deltaMean} (${redirect.all.deltaSamples} samples) · redirect named the realized lane ${redirect.all.redirectNamedLanePct}%`);
    if (redirect.atPeak) console.log(`│ at the peak ${fullLabel(redirect.atPeak.coord)}: n=${redirect.atPeak.n} · Δ mean ${redirect.atPeak.deltaMean} · named lane ${redirect.atPeak.redirectNamedLanePct}% · ${redirect.atPeak.verdict}`);
    console.log(`│ ${redirect.meaning}`);
  }
  console.log(`└${'─'.repeat(66)}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const receiptPath = resolve(OUT_DIR, 'competence-pixel.json');
  const pngPath = resolve(OUT_DIR, 'competence-pixel.png');
  const { _png, ...receipt } = R;
  if (_png) { writeFileSync(pngPath, _png); receipt.panel.png = pngPath; } else receipt.panel.png = null;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`\nSUFFICIENT FOR: ${receipt.claims.sufficientFor}`);
  console.log(`NOT SUFFICIENT FOR: ${receipt.claims.notSufficientFor}`);
  console.log(`\nreceipt → ${receiptPath}${_png ? `\npanel   → ${pngPath}` : ''}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
