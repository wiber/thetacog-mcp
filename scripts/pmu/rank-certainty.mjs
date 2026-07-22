#!/usr/bin/env node
// scripts/pmu/rank-certainty.mjs — H5: RANK-ORDER LOCALIZATION (the crystal's own structure).
// =============================================================================
// The operator's reframe (2026-06-12): "think in tolerances and RANKED lists of cells from the
// sensor instead of mass — if the sensor is clear, the geometric region should be more crystal
// than σs on the smear; rank regions may be enough or a starting point." The mass z (σ_localize)
// asks HOW MUCH heavier the target zone is than the smear; the rank lens asks WHERE the target
// sits in the sensor's own ordered significance list — and converts that position into an EXACT
// null probability, no estimator, no std.
//
// CHIP NOTE — ranks are COMPARATOR-NATIVE. The sensor's ordered significance list needs only
// pairwise comparisons and a counter (rank = 1 + count of cells that beat you): no floating-point
// mass integrals, no accumulation error, no division until the final p lookup — which is a fixed
// 12-, 144-, or table-entry map. This is MORE chip-friendly than the zone-mass z-score, per the
// operator's standing constraint "as long as it can be done on chip." A hardware comparator tree
// over block masses IS this lens.
//
// THE HIERARCHY (down the crystal, each level an exact uniform-null p):
//   LEVEL-12   — rank the 12 block-ROWS and 12 block-COLS of the 144×144 by |Δ|
//                (mass-rank AND max-cell-rank both reported); target rank r → p = r/12 EXACT.
//   LEVEL-144  — rank the 144 12×12 blocks; target block rank r → p = r/144 EXACT.
//   CELL SET   — top-k cells (k ∈ {5,10,25}, NONZERO only, ties broken value-desc then
//                index-asc) ∩ the target zone (row t ∪ col t, m = 287 of N = 20736):
//                exact hypergeometric tail P(X ≥ observed | k draws, m, N).
//   COMPOSED   — σ_rank: p_row (level-12 block-row mass rank) × p_within (the target block's
//                mass rank among the 12 blocks of its OWN block-row). The two are independent
//                under the exchangeable null only approximately (the caveat is carried in the
//                output, never hidden); the product of two uniform p-values is NOT uniform, so
//                the honest tail is Fisher's P(P₁P₂ ≤ x) = x(1 − ln x) — reported as pComposed,
//                with the raw product alongside.
//
// HONESTY RULES (the house forms):
//   · ties count CONSERVATIVELY — a tie ranks you WORSE (rank = 1 + #others ≥ you), so a
//     degenerate field cannot manufacture a hit; fails conservative, cannot be gamed up.
//   · a zero/flat field is flagged DEGENERATE and every σ reads 0 (the no-op control read).
//   · p → σ via the one-sided normal quantile σ = −qnorm(p) (so smaller p = larger σ), p clamped
//     to [1e-300, 1−1e-16]; deterministic throughout — no Math.random anywhere.
//
// @canonical-algorithm  |Δ| field → comparator ranks at three levels (12 rows · 12 cols · 144
//   blocks, ties-conservative) + exact hypergeometric top-k∩zone tails → exact uniform-null p per
//   level → σ via normal quantile → composed σ_rank from the Fisher-corrected product
// @forbidden-alternative  mass z-scores re-derived here (sigma-localize.mjs owns those) ·
//   optimistic tie-breaking (ties must rank worse) · treating the raw p-product as a tail
//   probability without the x(1−ln x) correction · Monte-Carlo nulls (the ranks have EXACT nulls)
// @why  the mass z drowned a real aim (σ_localize 0.61 while σ_aim read 3.91) — the ordered list
//   is the sensor's own certainty structure, and it is what a chip can compute natively
// @guard  tests/pmu-simulator/rank-localize.test.mjs
// Pre-registered: data/pmu/sigma-localize/ablation-h5-2026-06-12.json (predictions BEFORE run)

// ── exact-null machinery ─────────────────────────────────────────────────────────────────────

// inverse standard normal CDF (Acklam's rational approximation, |ε| < 1.15e-9) — deterministic.
export function qnorm(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// p → σ, one-sided: smaller p = larger σ. σ(p=0.5) = 0; σ(p=1) reads a hard negative (worse than
// chance is shown, not hidden). p clamped so the quantile never overflows.
export function sigmaFromP(p) {
  const pc = Math.min(1 - 1e-16, Math.max(1e-300, Number(p)));
  return -qnorm(pc);
}

// log Γ (Lanczos, g = 7) → exact-enough binomials for the hypergeometric tail.
function logGamma(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const logChoose = (n, k) => (k < 0 || k > n || n < 0) ? -Infinity : logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

// P(X ≥ x) for X ~ Hypergeometric(N population, m successes, k draws) — exact tail sum in log
// space. x at or below the distribution's floor reads 1 (no certainty claimable from nothing).
export function hyperTail(N, m, k, x) {
  const floor = Math.max(0, k - (N - m));
  if (x <= floor) return 1;
  const hi = Math.min(k, m);
  if (x > hi) return 0;
  const denom = logChoose(N, k);
  let s = 0;
  for (let i = x; i <= hi; i++) s += Math.exp(logChoose(m, i) + logChoose(N - m, k - i) - denom);
  return Math.min(1, s);
}

// ── comparator ranks (ties CONSERVATIVE: a tie ranks you worse — fails conservative) ─────────
export function conservativeRank(values, t) {
  const v = values[t];
  let rank = 1, mx = -Infinity, mn = Infinity;
  for (let j = 0; j < values.length; j++) {
    if (j !== t && values[j] >= v) rank++;
    if (values[j] > mx) mx = values[j];
    if (values[j] < mn) mn = values[j];
  }
  return { rank, degenerate: mx === mn };   // degenerate = an all-tie (e.g. the zero field)
}

// ── block-space aggregations of the 20,736-cell |Δ| field (pure, no git/library) ─────────────
// CHIP NOTE: each is a fixed-fanout adder/comparator tree — 12 block-rows × (12×144 cells) etc.
export function blockRowStats(absd) {
  const mass = new Float64Array(12), max = new Float64Array(12);
  for (let i = 0; i < 144; i++) {
    const R = (i / 12) | 0;
    for (let j = 0; j < 144; j++) { const v = absd[i * 144 + j]; mass[R] += v; if (v > max[R]) max[R] = v; }
  }
  return { mass, max };
}

export function blockColStats(absd) {
  const mass = new Float64Array(12), max = new Float64Array(12);
  for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) {
    const C = (j / 12) | 0, v = absd[i * 144 + j];
    mass[C] += v; if (v > max[C]) max[C] = v;
  }
  return { mass, max };
}

export function blockStats(absd) {
  const mass = new Float64Array(144), max = new Float64Array(144);
  for (let i = 0; i < 144; i++) for (let j = 0; j < 144; j++) {
    const b = ((i / 12) | 0) * 12 + ((j / 12) | 0), v = absd[i * 144 + j];
    mass[b] += v; if (v > max[b]) max[b] = v;
  }
  return { mass, max };
}

// top-k NONZERO cells, ties broken value-desc then index-asc — the sensor's ordered significance
// list, truncated. Zero cells never join (a flat field draws nothing — no certainty from nothing).
export function topKCells(absd, k) {
  const idx = [];
  for (let c = 0; c < absd.length; c++) if (absd[c] > 0) idx.push(c);
  idx.sort((a, b) => (absd[b] - absd[a]) || (a - b));
  return idx.slice(0, k);
}

// ── σ_PANEL — the JOINT rank certainty across a sweep (the distribution-level claim) ──────────
// One tile's placement caps at σ ≈ 2.46 (rank 1 of 144 is p = 1/144 — exact but modest). The
// operator's ranked-geometric ask becomes rigorous AT THE PANEL SCALE: the joint probability
// that k of n INDEPENDENT fresh edits land top-ranked at their own targets by chance. Two exact
// forms, both uniform-null, no estimator, no Monte-Carlo (the ranks have EXACT nulls — AR):
//
//   BINOMIAL (the registrable headline, conservative): a tile is a HIT when its target zone
//   actually moved (ncdAtTarget > 0) AND ranks within the acceptance ceiling (rank ≤ rankCap,
//   default 3 — the house top-3 convention). Per tile the null acceptance is p = m/144 where
//   m = the WORST rank any counted hit needed (the loosest acceptance actually used) — an upper
//   bound on the per-tile null hit probability (a random target is among the top-m movers with
//   probability ≤ m/144). P_panel = Σ_{i≥k} C(n,i) p^i (1−p)^(n−i); σ_panel = −qnorm(P_panel).
//   Dead tiles (no zone moves) COUNT in n as misses — n never shrinks to flatter the tail.
//
//   PRODUCT (the sharper read, stated with its caveats): Π over hit tiles of (rank_i/144) =
//   P(every hit tile ranks at-or-better-than observed) under the uniform null. Sharper because
//   it uses each tile's ACTUAL rank (rank-1 hits contribute 1/144, rank-2 2/144, …) — but the
//   event is chosen AFTER seeing the data (only the favorable tiles join the product), so the
//   binomial stays the headline.
//
// INDEPENDENCE CAVEAT (carried in the output, never hidden): the tiles share the corpus and the
// same 144-anchor instrument — exact independence is an assumption, not a measurement. The σ is
// exact UNDER the stated null; the caveat is the honest price of the joint claim.

export const PANEL_RANK_CAP = 3;     // acceptance ceiling — the house top-3 convention (massInTop3Blocks)
export const PANEL_ZONES = 144;

// P(X ≥ k) for X ~ Binomial(n, p) — exact tail in log space, deterministic.
export function binomTail(n, k, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}

// panelCertainty(sweepJson) — reads a fresh-pair sweep result ({ perTile: [...] }) and returns
// the joint rank certainty. Rows missing the ncd rank fields (synthetic fixtures) are excluded
// from n; rows with ncdNonzeroZones === 0 (dead) stay IN n as misses.
export function panelCertainty(sweep, { rankCap = PANEL_RANK_CAP, zones = PANEL_ZONES } = {}) {
  const rows = (sweep?.perTile || []).filter((r) => Number.isFinite(r?.ncdZoneRank) && Number.isFinite(r?.ncdAtTarget));
  const n = rows.length;
  const caveats = [
    'independence: the tiles share the corpus and the same 144-anchor instrument — σ_panel is exact UNDER the independence-across-tiles null, which is an assumption, not a measurement',
    `binomial p = (worst hit rank)/${zones} is a conservative upper bound on the per-tile null acceptance — the registrable headline`,
    'product-form uses each hit tile’s ACTUAL rank (sharper), but the event is selected after seeing the data — reported beside the binomial, never instead of it',
  ];
  if (!n) {
    return {
      schema: 'panel-certainty-v1', n: 0, k: 0, rankCap, zones, hits: [],
      acceptanceRank: null, pPerTile: null, pBinomial: 1, sigmaPanel: 0, pProduct: 1, sigmaProduct: 0,
      degenerate: true, caveats, note: 'no measurable rows (perTile rows need ncdZoneRank + ncdAtTarget) — no certainty from nothing',
    };
  }
  const hits = rows
    .filter((r) => r.ncdAtTarget > 0 && r.ncdZoneRank <= rankCap)
    .map((r) => ({ tile: r.tile, coord: r.coord, rank: r.ncdZoneRank, p: r.ncdZoneRank / zones, surgical: r.ncdSurgical === true }));
  const k = hits.length;
  const acceptanceRank = k ? Math.max(...hits.map((h) => h.rank)) : null;
  const pPerTile = k ? acceptanceRank / zones : null;
  const pBinomial = k ? binomTail(n, k, pPerTile) : 1;
  const pProduct = k ? hits.reduce((a, h) => a * h.p, 1) : 1;
  return {
    schema: 'panel-certainty-v1',
    n, k, misses: n - k, rankCap, zones,
    deadInN: rows.filter((r) => r.ncdNonzeroZones === 0).length,   // dead tiles count as misses, never dropped
    hits, acceptanceRank, pPerTile,
    pBinomial, sigmaPanel: k ? +sigmaFromP(pBinomial).toFixed(2) : 0,
    pProduct, sigmaProduct: k ? +sigmaFromP(pProduct).toFixed(2) : 0,
    degenerate: false,
    headline: 'sigmaPanel (exact binomial tail, conservative acceptance) — sigmaProduct is the sharper post-hoc read',
    caveats,
  };
}

// ── the full hierarchical read ───────────────────────────────────────────────────────────────
// absd = the 20,736-cell |Δ| field; target = the anchor index 0..143 (zone = row t ∪ col t).
export function rankCertainty(absd, target, { ks = [5, 10, 25] } = {}) {
  const N = 20736, ZONE = 287;                      // |row t ∪ col t| = 144 + 144 − 1
  const tb = (target / 12) | 0;                     // the target's block-row AND block-col (diagonal cell)
  const targetBlock = tb * 12 + tb;

  // LEVEL-12 — block-rows and block-cols, both mass-rank and max-cell-rank; p = rank/12 EXACT.
  const rows = blockRowStats(absd), cols = blockColStats(absd);
  const rowMass = conservativeRank(rows.mass, tb), rowMax = conservativeRank(rows.max, tb);
  const colMass = conservativeRank(cols.mass, tb), colMax = conservativeRank(cols.max, tb);

  // LEVEL-144 — the 144 blocks; p = rank/144 EXACT.
  const blocks = blockStats(absd);
  const blockMass = conservativeRank(blocks.mass, targetBlock);
  const blockMax = conservativeRank(blocks.max, targetBlock);

  const degenerate = blockMass.degenerate;          // an all-tie at block level = a flat field
  const lvl = (rank, n, degen) => ({
    rank, of: n, p: rank / n,
    sigma: degen ? 0 : +sigmaFromP(rank / n).toFixed(2),
    degenerate: degen,
  });

  // CELL SET — top-k ∩ zone, exact hypergeometric tail. drawn < k when the field has fewer
  // nonzero cells; drawn = 0 (the control) reads p = 1, σ = 0 — n.s. by construction.
  const topK = ks.map((k) => {
    const cells = topKCells(absd, k);
    const hits = cells.filter((c) => ((c / 144) | 0) === target || c % 144 === target).length;
    const drawn = cells.length;
    const p = drawn === 0 ? 1 : hyperTail(N, ZONE, drawn, hits);
    return { k, drawn, hits, zoneSize: ZONE, p, sigma: drawn === 0 ? 0 : +sigmaFromP(p).toFixed(2) };
  });

  // COMPOSED σ_rank — row-rank p × within-block-row p. Independence under the exchangeable null
  // is approximate (the row's mass and its internal ordering share cells) — caveat carried, never
  // hidden. The raw product of two uniforms is NOT a tail probability; the honest tail is
  // Fisher's P(P₁P₂ ≤ x) = x(1 − ln x). Both reported; σ_rank reads the corrected tail.
  const withinRow = rows ? (() => {
    const rowBlocks = new Float64Array(12);
    for (let c = 0; c < 12; c++) rowBlocks[c] = blocks.mass[tb * 12 + c];
    return conservativeRank(rowBlocks, tb);
  })() : null;
  const pRow = rowMass.rank / 12;
  const pWithin = withinRow.rank / 12;
  const pProduct = pRow * pWithin;
  const pComposed = degenerate ? 1 : Math.min(1, pProduct * (1 - Math.log(pProduct)));
  const sigmaRank = degenerate ? 0 : +sigmaFromP(pComposed).toFixed(2);

  return {
    target, targetBlock, blockRow: tb, blockCol: tb, degenerate,
    level12: {
      row: { mass: lvl(rowMass.rank, 12, rowMass.degenerate), maxCell: lvl(rowMax.rank, 12, rowMax.degenerate) },
      col: { mass: lvl(colMass.rank, 12, colMass.degenerate), maxCell: lvl(colMax.rank, 12, colMax.degenerate) },
    },
    level144: {
      mass: lvl(blockMass.rank, 144, blockMass.degenerate),
      maxCell: lvl(blockMax.rank, 144, blockMax.degenerate),
    },
    topK,
    composed: {
      pRow, withinBlockRank: withinRow.rank, pWithin,
      pProduct, pComposed: +pComposed.toPrecision(4),
      sigmaRank,
      caveat: 'p_row × p_within assumes independence under the exchangeable null (approximate — the block-row mass and its internal ordering share cells); the product tail is Fisher-corrected x(1 − ln x), never the raw product',
    },
  };
}

// ── CLI — σ_panel on a saved sweep: node scripts/pmu/rank-certainty.mjs --panel <sweep.json> ──
const { fileURLToPath: _f2p } = await import('node:url');
const { resolve: _res } = await import('node:path');
if (process.argv[1] && _res(process.argv[1]) === _f2p(import.meta.url)) {
  const i = process.argv.indexOf('--panel');
  if (i >= 0) {
    const { readFileSync } = await import('node:fs');
    const capIdx = process.argv.indexOf('--rank-cap');
    const rankCap = capIdx >= 0 ? parseInt(process.argv[capIdx + 1], 10) : PANEL_RANK_CAP;
    const sweep = JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
    const p = panelCertainty(sweep, { rankCap });
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(p, null, 2) + '\n');
    else {
      console.log(`σ_PANEL — joint rank certainty (lib ${sweep.libSha || '?'} · ${p.n} tiles · rankCap ${p.rankCap})`);
      console.log(`  hits ${p.k}/${p.n} (target moved AND rank ≤ ${p.rankCap}): ${p.hits.map((h) => `${h.coord}@${h.rank}${h.surgical ? '✦' : ''}`).join(' · ') || '(none)'}`);
      console.log(`  acceptance = worst hit rank ${p.acceptanceRank}/144 → per-tile p ${p.pPerTile === null ? 'n/a' : p.pPerTile.toExponential(3)}`);
      console.log(`  BINOMIAL (headline, conservative): P ${p.pBinomial.toExponential(3)} → σ_panel ${p.sigmaPanel}`);
      console.log(`  PRODUCT  (sharper, post-hoc):      P ${p.pProduct.toExponential(3)} → σ_product ${p.sigmaProduct}`);
      for (const c of p.caveats) console.log(`  caveat: ${c}`);
    }
  }
}
