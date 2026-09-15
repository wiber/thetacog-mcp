#!/usr/bin/env node
// scripts/pmu/sigma-legend.mjs — SPEC #3: every number names itself.
// =============================================================================
// THE ONE SHARED LEGEND. Every σ printed anywhere — commit email rows, triptych
// panel labels, spec-thread realization emails, perturbation-probe and
// reef-self-loop summaries — names its TYPE, its BAND, and a one-line VERDICT
// from THIS module, so the wording cannot drift apart (the same discipline as
// the panel anatomy: one source, many surfaces). Phone-readable: short phrases,
// no jargon beyond the firewall terms (ballistic cascade · ply · ShortLex ·
// leaf walk · cloud · time budget).
//
// THE THREE σ TYPES (ideal-case spec, double-check #9: "σ without its type and
// inputs is not a number"):
//   drift      — instrument confidence on a REAL commit (the commit-email σ).
//                Bands: <0 noise · 0–3 weak ("panel story is not yet evidence")
//                · 3–6 forming · ≥6 trustworthy · ≥8.5 verified-reef.
//   response   — sensitivity to a PLANTED edit (perturbation-probe). High AND
//                localized is the only good; ≈0 is correct ONLY for controls.
//   spec-delta — realization measured against its DECLARED spec (spec-thread
//                --realize: spec text = intent, commit = reality). Same bands
//                as drift; the verdict reads as did-the-work-land.
//
// Band edges are EXACT at 0, 3, 6, 8.5 (lower-inclusive: σ=3 is forming, σ=6
// is trustworthy, σ=8.5 is verified-reef) — pinned by the harness.
//
// @canonical-algorithm  one legend(type, value) → {label, band, verdict} + one
//   panelCaption(id) table — the single source every output surface reads
// @forbidden-alternative  per-surface verdict strings (wording drift) · a bare
//   σ with no type/band · captions hand-copied into renderers
// @why  spec #3: which σ are we looking at, and is high good here? must be
//   answered IN THE HTML, next to the number — not in a doc the reader recalls
// @guard  tests/pmu-simulator/sigma-legend.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// the per-run measure ledger (commit-triptych appends one ndjson line per run; capped at 200) —
// the percentile() readout below compares each fresh number against the last 10 recorded runs,
// so every email answers "is this high or low FOR US, lately?" programmatically.
export const MEASURE_HISTORY = resolve(HERE, '../../data/pmu/measure-history.ndjson');

export const SIGMA_TYPES = ['drift', 'response', 'spec-delta', 'localize', 'localize-attributed', 'localize-ncd', 'rank', 'panel', 'tight', 'aim'];

// the inline short name — what the reader sees right next to the number.
export const TYPE_NAME = {
  'drift': 'σ_drift',
  'response': 'σ_response',
  'spec-delta': 'σ_spec-delta',
  'localize': 'σ_localize',
  'localize-attributed': 'σ_localize(attr)',
  'localize-ncd': 'σ_localize(ncd)',
  'rank': 'σ_rank',
  'panel': 'σ_panel',
  'tight': 'σ_tight',
  'aim': 'σ_aim',
};

// the one-phrase identity of each type (printed with the number, every time).
export const TYPE_LABEL = {
  'drift': 'instrument confidence on a real commit',
  'response': 'sensitivity to a planted edit — high and localized is the only good',
  'spec-delta': 'realization measured against its declared spec',
  'localize': 'how unlikely it is the edit landed in the right zone by chance — z of the target zone’s |delta| mass vs all 144 anchor zones',
  'localize-attributed': 'the attributed lens — z of the CHANGED CLAIMS’ grip mass at the target zone vs all 144 anchor zones (claim-diff of the pair; a second lens, never a replacement for the whole-doc read)',
  'localize-ncd': 'the compression witness — z of the target zone’s gzip-NCD delta between the two sides’ zone-assigned claims, vs all 144 anchor zones (no SimHash anywhere in this lens; an independent second witness, never a replacement for the whole-doc read)',
  'rank': 'hierarchical rank certainty — where the target sits in the sensor’s own ordered significance list, converted to an EXACT uniform-null p (rank/12 at level-12, rank/144 at level-144, hypergeometric top-k — no estimator, no shuffled nulls); leads to: rank certainty → exact unlikeliness without nulls → the locked goal',
  'panel': 'JOINT rank certainty across the sweep — the exact binomial chance that k of n independent fresh edits land top-ranked at their own targets (acceptance = worst hit rank / 144, conservative; product-form Π rank_i/144 the sharper post-hoc read); one tile caps at σ≈2.46, the PANEL is where rank yields the big number; leads to: the distribution-level beyond-doubt claim',
  'tight': 'how much tighter the perturbed region is than chance — gyration radius of the |delta| field vs a deterministic cyclic-shift null',
  'aim': 'how much closer the |delta| centroid sits to the target cell than chance — centroid error in block space vs the same null',
};

// drift-style bands (shared by 'drift' and 'spec-delta'): edges exact at 0, 3, 6, 8.5.
const driftBand = (v) =>
  v < 0 ? 'noise' : v < 3 ? 'weak' : v < 6 ? 'forming' : v < 8.5 ? 'trustworthy' : 'verified-reef';

const DRIFT_VERDICT = {
  'noise': 'below zero — this read is noise, not a measurement',
  'weak': 'panel story is not yet evidence',
  'forming': 'separation is forming — the direction is real, the trust is not yet',
  'trustworthy': 'clears the trust floor — the panel story counts as evidence',
  'verified-reef': 'verified-reef territory — the instrument at full grip',
};

const SPEC_DELTA_VERDICT = {
  'noise': 'no measurable relation between the work and the declared spec',
  'weak': 'the work has not yet landed inside the declared intent',
  'forming': 'the realization is converging on the spec — iterate again',
  'trustworthy': 'the work landed inside the declared intent',
  'verified-reef': 'realization matches the spec at full instrument grip',
};

// response bands mirror the perturbation-probe taxonomy (dead <1 · weak 1–3 · pass ≥3).
const responseBand = (v) => (v < 1 ? 'dead' : v < 3 ? 'weak' : 'responsive');

const RESPONSE_VERDICT = {
  'dead': 'the sensor barely moves at the edited cell — correct only for a control (≈0)',
  'weak': 'the planted edit reads, but below the pass floor',
  'responsive': 'a sized edit reads loud at its own cell — good only if also localized',
};

// localize bands (σ_localize, the brain-surgeon measure — sigma-localize.mjs): how unlikely is it
// that the edit's |delta| mass concentrated in the TARGET anchor's row+col zone, vs the zone-mass
// distribution over all 144 anchor zones? Edges exact at 1, 3, 6 (lower-inclusive).
const localizeBand = (v) => (v < 1 ? 'chance' : v < 3 ? 'weak' : v < 6 ? 'localized' : 'outstanding');

const LOCALIZE_VERDICT = {
  'chance': 'the edit’s mass sits where chance would put it — the zone does not own this edit',
  'weak': 'the target zone leads, but not beyond a lucky draw — iterate the ingest',
  'localized': 'the edit landed in its own zone — the brain-surgeon read holds',
  'outstanding': 'unmistakable — the target zone owns the edit at outstanding separation',
};

// attributed verdicts — same bands (edges exact at 1/3/6), wording names the lens.
const LOCALIZE_ATTR_VERDICT = {
  'chance': 'the changed claims grip where chance would put them — the attribution does not reach its zone',
  'weak': 'the changed claims lean toward the target zone, but a lucky draw could match it',
  'localized': 'the changed claims grip their own zone — the edit’s trace is attributed',
  'outstanding': 'unmistakable — the target zone owns the changed claims at outstanding separation',
};

// compression-witness verdicts (σ_localize(ncd), the H4 lens) — same bands (edges exact at 1/3/6),
// wording names the SimHash-free instrument.
const LOCALIZE_NCD_VERDICT = {
  'chance': 'the zone’s compressibility moved no more than chance — the compression witness does not see the edit here',
  'weak': 'the target zone’s compressibility moved, but a lucky draw could match it',
  'localized': 'the compression witness agrees — the target zone’s claims changed beyond chance, with no SimHash in the loop',
  'outstanding': 'unmistakable on the compression witness alone — the target zone owns the edit without SimHash',
};

// rank bands (σ_rank, the H5 lens — rank-certainty.mjs composed read): bands by σ-equivalent at
// the localize edges, exact at 1 / 3 / 6 (lower-inclusive). The p behind the σ is EXACT (the
// crystal's own ordering), so the verdict can say "unlikeliness" without a null caveat.
const rankBand = (v) => (v < 1 ? 'chance' : v < 3 ? 'weak' : v < 6 ? 'ranked' : 'outstanding');

const RANK_VERDICT = {
  'chance': 'the target sits where chance would rank it in the sensor’s ordered list — no exact unlikeliness claimable',
  'weak': 'the target ranks high, but a uniform draw could match it — iterate the ingest',
  'ranked': 'the target heads the sensor’s own ordered list beyond a lucky draw — exact unlikeliness, no nulls needed',
  'outstanding': 'the crystal’s ordering locks onto the target — exact unlikeliness at the locked-goal floor',
};

// panel bands (σ_panel, the joint rank lens — rank-certainty.mjs panelCertainty): same edges as
// rank (exact at 1 / 3 / 6, lower-inclusive); the p behind the σ is an EXACT binomial tail under
// the stated independence-across-tiles null (the caveat travels in panelCertainty's output).
const panelBand = (v) => (v < 1 ? 'chance' : v < 3 ? 'weak' : v < 6 ? 'converging' : 'beyond-doubt');

const PANEL_VERDICT = {
  'chance': 'the panel of fresh edits lands where chance would put it — no joint claim yet',
  'weak': 'more edits find their targets than chance suggests, but a lucky panel could match it',
  'converging': 'the panel converges on its targets beyond a lucky draw — the joint claim is forming',
  'beyond-doubt': 'the distribution-level claim — this many fresh edits do not land top-ranked at their own targets by chance (exact binomial, independence caveat carried)',
};

// the SURGICAL verdict (σ_localize(ncd) single-zone certainty — sigma-localize.mjs PLACEMENT_SIGMA):
// the std-collapse degenerate hit. When EXACTLY one zone moves and it IS the target, the house
// z-estimator reads 0 (no elsewhere variance to divide by), but placement is EXACT — a single
// moved zone being the predicted one of 144 is p = 1/144, so σ ≈ 2.46 from placement alone. The
// magnitude is NOT folded in (the no-op control floor is exactly 0 — a zero-variance null gives no
// honest magnitude scale), so this reads placement-only and SAYS so. One source for the wording.
export const SURGICAL_VERDICT = 'surgical (placement-exact) — only the target zone moved, so the z has no elsewhere variance; placement alone is exact at 1/144 (σ ≈ 2.46), magnitude not folded in';
export function surgicalVerdict(magnitude = null) {
  return (magnitude != null && Number.isFinite(Number(magnitude)))
    ? `${SURGICAL_VERDICT} · moved-zone Δ ${+Number(magnitude).toFixed(4)}`
    : SURGICAL_VERDICT;
}
export function surgicalLine(magnitude = null) {
  return `σ_localize(ncd) · surgical · ${surgicalVerdict(magnitude)}`;
}

// region-geometry bands (σ_tight · σ_aim, sigma-localize.mjs regionGeometry): localize-style
// edges, exact at 1 / 3 / 6 (lower-inclusive), against the deterministic cyclic-shift null.
const tightBand = (v) => (v < 1 ? 'diffuse' : v < 3 ? 'weak' : v < 6 ? 'tight' : 'outstanding');

const TIGHT_VERDICT = {
  'diffuse': 'the perturbed region is no tighter than a shuffled field — the edit smears',
  'weak': 'some concentration, but a shuffle could match it — iterate the ingest',
  'tight': 'the perturbed region is genuinely compact — the edit has a shape',
  'outstanding': 'unmistakably compact — the region is a point, not a cloud',
};

const aimBand = (v) => (v < 1 ? 'chance' : v < 3 ? 'weak' : v < 6 ? 'aimed' : 'outstanding');

const AIM_VERDICT = {
  'chance': 'the region’s centre sits where a shuffle would put it — the aim is not yet real',
  'weak': 'the centre leans toward the target, but a lucky shuffle could match it',
  'aimed': 'the region’s centre sits on the target — the edit aimed where it claimed',
  'outstanding': 'dead centre at outstanding separation — the target owns the region’s mass',
};

const BAND_FN = {
  'drift': driftBand, 'spec-delta': driftBand, 'response': responseBand,
  'localize': localizeBand, 'localize-attributed': localizeBand, 'localize-ncd': localizeBand,
  'rank': rankBand, 'panel': panelBand,
  'tight': tightBand, 'aim': aimBand,
};
const VERDICTS = {
  'drift': DRIFT_VERDICT, 'spec-delta': SPEC_DELTA_VERDICT, 'response': RESPONSE_VERDICT,
  'localize': LOCALIZE_VERDICT, 'localize-attributed': LOCALIZE_ATTR_VERDICT,
  'localize-ncd': LOCALIZE_NCD_VERDICT,
  'rank': RANK_VERDICT, 'panel': PANEL_VERDICT,
  'tight': TIGHT_VERDICT, 'aim': AIM_VERDICT,
};

// ── legend(type, value) → { type, name, label, band, verdict } ─────────────────
export function legend(type, value) {
  if (!SIGMA_TYPES.includes(type)) throw new Error(`unknown σ type: ${type} (one of ${SIGMA_TYPES.join(', ')})`);
  const v = Number(value);
  if (!Number.isFinite(v)) return { type, name: TYPE_NAME[type], label: TYPE_LABEL[type], band: 'unmeasured', verdict: 'no number to read — the measurement did not run' };
  const band = BAND_FN[type](v);
  return { type, name: TYPE_NAME[type], label: TYPE_LABEL[type], band, verdict: VERDICTS[type][band] };
}

// the inline annotation every σ row carries: `<type> · <band> · <verdict>`.
export function legendLine(type, value) {
  const l = legend(type, value);
  return `${l.name} · ${l.band} · ${l.verdict}`;
}

// ── panelCaption(id) — one-clause reading per panel kind, single source ────────
// Each caption answers "what does good look like here?" in one clause, for a
// reader on a phone who has not memorized the spec.
const PANEL_CAPTIONS = {
  // the pair-lattice walk row
  'intent': 'good = the clouds concentrate where the commit SAYS it works',
  'reality': 'good = the same clouds as intent — shipped where declared',
  'delta': 'good = mostly green; magenta = said-not-done (chase it in the code), amber = done-not-said (chase it in the docs)',
  'tolerance': 'red only matters above the flip — a few amber is normal bleed',
  // the pre-walk trio (raw sense grids)
  'raw-intent': 'the no-point-of-view snapshot — what the sensor lit before any walk; the leaf walk below is what bridges the two grids',
  'raw-reality': 'the no-point-of-view snapshot, reality side — same sensor law',
  'raw-compare': 'good = green overlap without being a copy — near-100% is self-similarity, not alignment',
  // the ShortLex-3 projection trio
  'sl-intent': 'the three-length view — good = claims land inside their own zone',
  'sl-reality': 'same projection law — good = reality occupies the zones intent does',
  'sl-compare': 'good = the zones agree; cross-zone scatter is the drift to read',
  // the spec-delta reading (spec-thread realization email)
  'spec-delta': 'did the work land inside the declared intent?',
};

export const PANEL_IDS = Object.keys(PANEL_CAPTIONS);

export function panelCaption(id) {
  return PANEL_CAPTIONS[id] || '';
}

// ── percentile vs the last 10 recorded runs (SPEC #3 refinement 2: SENSE-MAKING) ──────────────
// Pure math first (unit-tested on a fixture): midrank percentile of `value` among `values` —
// below counts fully, ties count half, so a repeat of the median reads p50, not p100.
export function percentileOf(values, value) {
  const vs = (values || []).map(Number).filter(Number.isFinite);
  const v = Number(value);
  if (!vs.length || !Number.isFinite(v)) return null;
  let below = 0, equal = 0;
  for (const x of vs) { if (x < v) below++; else if (x === v) equal++; }
  return Math.round((100 * (below + 0.5 * equal)) / vs.length);
}

// read the ndjson ledger (one JSON object per line; malformed lines skipped, never fatal).
export function readMeasureHistory(historyPath = MEASURE_HISTORY) {
  if (!existsSync(historyPath)) return [];
  const out = [];
  for (const line of readFileSync(historyPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
}

// percentile('sigmaDrift', 2.99) → 'p40 of last 10' — THIS run's value ranked against the last
// `window` history entries that actually carried the key. Null when there is no history yet
// (the caller prints 'no history yet' — absence is shown, not faked).
export function percentile(measureKey, value, { historyPath = MEASURE_HISTORY, window = 10 } = {}) {
  const hist = readMeasureHistory(historyPath)
    .map((e) => Number(e?.[measureKey]))
    .filter(Number.isFinite)
    .slice(-window);
  if (!hist.length) return null;
  const p = percentileOf(hist, value);
  return p == null ? null : `p${p} of last ${hist.length}`;
}

// ── WHAT GOOD LOOKS LIKE (SPEC #3 refinement 3) — the compact expected-vs block ───────────────
// One expected-appearance clause per headline measure, tied to the PRE-REGISTERED phantom-card
// P1-ALIGNED expectations (§B5: redZero · offPct<10 · sigmaPositive) and the σ bands above —
// the email shows EXPECTED next to SEEN so the reader never has to recall the spec.
export function whatGoodLooksLike({ localize = false } = {}) {
  const rows = [
    { id: 'sigma', measure: 'σ (shape-match)', expected: 'positive on an aligned commit (phantom P1: sigmaPositive) · ≥6 clears the trust floor · ≥8.5 verified-reef · 0–3 = panel story not yet evidence' },
    { id: 'tolerance', measure: 'tolerance g/a/r', expected: 'red ≈ 0 and orthogonal off-lane < 10% on an in-lane commit (phantom P1: redZero, offPctBelow 10) — a few amber is normal bleed' },
    { id: 'prewalk', measure: 'pre-walk overlap', expected: 'green overlap WITHOUT being a copy — near-100% is self-similarity (a docs-only read), not alignment' },
    { id: 'walks', measure: 'the walks', expected: 'both sides finish inside the 2500ms budget; clouds concentrate at block-heads (the ShortLex-ascending follow), early plies heavy, deep plies faint' },
  ];
  // opt-in (the σ_localize email passes { localize: true }) so the on-commit email stays byte-identical.
  if (localize) rows.push({ id: 'localize', measure: 'σ_localize', expected: 'on a targeted doc edit: ≥3 = the edit landed in its own zone (localized) · ≥6 outstanding · 1–3 weak (a lucky draw could match) · <1 chance — and the optimizer ITERATES the ingest until this number increases' });
  return rows;
}

// ── MEASURE BANDS + LEADS-TO (the commit-email "numbers, contextualized" contract) ────────────
// Operator (2026-06-12): every row the commit email keeps must carry value · band · good/bad
// phrase · percentile · leadsTo. The σ types above already band themselves; the OTHER headline
// measures (tolerance · pre-walk overlap · drift% · walk budget · lattice fill) band HERE, one
// source, so the wording can't drift per surface. leadsTo answers "so what do I do?" — the
// reader's next move given the band, in one clause.
export function measureBand(id, value, opts = {}) {
  const v = Number(value);
  switch (id) {
    case 'tolerance':   // value = off-lane %, opts.alarm = the aggregate flip (tooMany)
      return opts.alarm ? 'alarm' : v > 10 ? 'bleeding' : 'in-lane';
    case 'prewalk':     // value = raw overlap % of the two ingested grids
      return v >= 80 ? 'self-similar' : v >= 5 ? 'overlapping' : 'mostly-disjoint';
    case 'driftPct':    // value = XOR % of compared cells that disagree
      return v <= 30 ? 'close' : v <= 70 ? 'mixed' : 'far';
    case 'walks':       // value = walk ms, opts.budget = the time budget (ms)
      return v <= (opts.budget ?? 2500) ? 'inside-budget' : 'over-budget';
    case 'fill': {      // value = lit % of the 20,736-cell lattice
      return v < 0.5 ? 'sparse' : v <= 10 ? 'walkable' : 'flooded';
    }
    // ── ladder-only measures (metric-ladder.mjs) — banded HERE so wording lives in one place ──
    case 'coverage':       // value = panel hits as % of swept tiles (k/n·100, fresh-pair sweep)
      return v < 50 ? 'minority' : v < 75 ? 'majority' : v < 100 ? 'near-full' : 'full';
    case 'response-pass':  // value = full-144 perturbation-probe pass count as % of probed
      return v < 25 ? 'thin' : v < 50 ? 'forming' : v < 90 ? 'broad' : 'saturated';
    case 'words-per-tile': // value = median intersection-specific words/tile, opts.floor = 70
      return v < 10 ? 'parent-echo' : v < 40 ? 'enriching' : v < (opts.floor ?? 70) ? 'approaching-floor' : 'at-floor';
    case 'uniq-first':     // value = distinct tile openings of opts.n (=144) seeds
      return v < 100 ? 'templated' : v < (opts.n ?? 144) ? 'converging' : 'distinct';
    default: return 'unbanded';
  }
}

const MEASURE_VERDICT = {
  tolerance: {
    'in-lane': 'the commit stayed inside its declared lanes — red ≈ 0 is exactly what good looks like (phantom P1)',
    'bleeding': 'some reality fired outside the declared lanes — amber bleed, below the alarm flip',
    'alarm': 'too much reality fired in ORTHOGONAL lanes — the aggregate flip; this is the drift the instrument exists to catch',
  },
  prewalk: {
    'self-similar': 'near-total overlap is a COPY, not alignment — expect this on docs-only commits; it is not evidence',
    'overlapping': 'the two ingests share real ground without being copies — the healthy middle',
    'mostly-disjoint': 'docs and code light different cells — normal for a code-heavy commit; the WALK is what bridges them',
  },
  driftPct: {
    'close': 'intent and reality mostly agree cell-for-cell',
    'mixed': 'meaningful disagreement — expected to fall as the seed library converges',
    'far': 'the two sides barely share cells — read σ and the tolerance before trusting any panel story',
  },
  walks: {
    'inside-budget': 'both cascades ran to extinction inside the time budget — the read is complete',
    'over-budget': 'the cascade was TRUNCATED by its time budget — deep plies are missing from the picture',
  },
  fill: {
    'sparse': 'almost nothing lit — the ingest barely gripped; treat every other number as weak',
    'walkable': 'a real, walkable lattice (~4% is the density target) — the walk had ground to cover',
    'flooded': 'too much lit — a flooded lattice makes every commit look alike (the AR-2 failure shape)',
  },
  // ── ladder-only measures (metric-ladder.mjs) ──
  coverage: {
    'minority': 'fewer than half the swept fresh edits land top-ranked at their own targets — the joint claim rests on a minority',
    'majority': 'most swept edits find their targets — the panel carries, but the misses name the work',
    'near-full': 'nearly every swept edit lands top-ranked — the misses are the short list to chase',
    'full': 'every swept edit landed top-ranked at its own target — coverage is closed at this sweep size',
  },
  'response-pass': {
    'thin': 'only a sliver of the 144 tiles feel a planted edit at their own cell — the sensor grips a corner of the map',
    'forming': 'a growing minority of tiles pass the hardened probe — seed richness is the lever',
    'broad': 'most tiles feel their own edits — the map is mostly live',
    'saturated': 'nearly every tile passes the hardened probe — the ingestion works across the map',
  },
  'words-per-tile': {
    'parent-echo': 'tiles are concatenated parent text, not intersection semantics — ~all vocabulary is parent-covered',
    'enriching': 'real intersection-specific mass is accumulating, still far from the axis-sized floor',
    'approaching-floor': 'tiles approach the axis-sized floor — keep the reef GDD loop running',
    'at-floor': 'each tile carries intersection content as rich as an axis lexicon — the floor is met',
  },
  'uniq-first': {
    'templated': 'tile openings repeat — the seed library reads as templates, not 144 coordinates',
    'converging': 'almost every tile opens distinctly — a handful still share openings',
    'distinct': 'all seeds open distinctly — no repeating templates at the opening-sentence level',
  },
};

const LEADS_TO = {
  sigma: {
    'noise': 'do not act on the panels — on a docs-only commit this is expected; otherwise fix the ingest and re-run',
    'weak': 'read the maps as sketch, not evidence — converge the seed library before citing this',
    'forming': 'one more ingest iteration should clear the trust floor',
    'trustworthy': 'act on the panel story — this read counts as evidence',
    'verified-reef': 'cite this read downstream — the instrument is at full grip',
    'unmeasured': 'no walk ran — re-run with a non-empty corpus',
  },
  tolerance: {
    'in-lane': 'nothing to chase',
    'bleeding': 'glance at the TOLERANCE panel — amber clusters show where reality leaned out',
    'alarm': 'open the TOLERANCE panel and chase the red rows — undeclared work shipped',
  },
  prewalk: {
    'self-similar': 'discount σ on this commit — compare against a code commit instead',
    'overlapping': 'nothing to do — this is the healthy shape',
    'mostly-disjoint': 'nothing to do — judge alignment by σ and the walk panels, not this raw overlap',
  },
  driftPct: {
    'close': 'nothing to chase',
    'mixed': 'watch the trend (the percentile) — rising drift% across commits is the signal, one value is not',
    'far': 'check the ingest (did both sides actually grip?) before reading drift as real',
  },
  walks: {
    'inside-budget': 'the ply story in the panels is complete',
    'over-budget': 'rerun with a higher budget if the deep-ply story matters for this commit',
  },
  fill: {
    'sparse': 'enrich the commit message / docs — the sensor had nothing to grip',
    'walkable': 'nothing to do',
    'flooded': 'tighten θ or the claim budget — see anti-rules ledger AR-2 (unguided floods)',
  },
  // ── ladder leads-to for the σ types the ladder carries (bands from legend()) ──
  localize: {
    'chance': 'iterate the ingest until the target zone owns its own edit — the brain-surgeon read does not yet hold',
    'weak': 'one more ingest iteration — the zone leads but a lucky draw could match it',
    'localized': 'cite the brain-surgeon read; push toward outstanding',
    'outstanding': 'nothing to chase — hold the line on the next library change',
  },
  panel: {
    'chance': 'no joint claim yet — grow per-tile hits before citing the panel',
    'weak': 'add swept tiles / convert misses to hits before leaning on the joint number',
    'converging': 'one more sweep round should clear the beyond-doubt edge',
    'beyond-doubt': 'cite the distribution-level claim (carry the independence caveat)',
  },
  // ── ladder-only measures ──
  coverage: {
    'minority': 'convert misses to hits — read the per-tile sweep rows for which zones miss',
    'majority': 'chase the missing tiles in the sweep — each convert lifts σ_panel directly',
    'near-full': 'close the last misses — the short list is in the sweep artifact',
    'full': 'widen the sweep (more tiles) — coverage at this size is closed',
  },
  'response-pass': {
    'thin': 'raise seed richness (the reef GDD loop) — pass count follows intersection-specific words',
    'forming': 'keep the reef loop running — every enriched tile is a candidate pass',
    'broad': 'chase the failing minority — they name the weak zones',
    'saturated': 'hold — re-probe after any library change',
  },
  'words-per-tile': {
    'parent-echo': 'author intersection-specific seeds (what does B,A3 say that NEITHER parent says alone?) — the single highest-leverage number in the system',
    'enriching': 'keep the reef GDD loop authoring novel-word mass per tile',
    'approaching-floor': 'close the gap to the 70-word floor tile by tile',
    'at-floor': 'hold the floor — re-measure after any seed change',
  },
  'uniq-first': {
    'templated': 'LLM-verified ingest: kill the repeating templates and transpose dupes',
    'converging': 'fix the few shared openings — tile-dump-inspect names them',
    'distinct': 'nothing to chase at the opening level — depth (novel words) is the next axis',
  },
};

export function measureVerdict(id, band) { return (MEASURE_VERDICT[id] || {})[band] || ''; }
export function leadsTo(id, band) { return (LEADS_TO[id] || {})[band] || ''; }

// ── THE WALK-COUNT ROW (operator refinement 1: HOW MANY WALKS made each heatmap) ──────────────
// One side: hops (each hop = ONE real pmu-onchip --ballistic process), anchors lit by the
// cascade, and where the walk ENDED — the deepest-ply anchors, i.e. the definers-of-definers
// the recursion concentrated on. Built here so every surface words it identically.
export function walkCountSide(label, w) {
  if (!w) return `${label}: no walk`;
  const ends = (w.ends && w.ends.length) ? `, ended at ${w.ends.join(' · ')} (ply ${w.maxPly ?? '?'} — the definers-of-definers)` : '';
  return `${label}: ${w.hops} hops / ${w.procs ?? w.hops} chip processes / ${w.lit} anchors lit${ends}`;
}
export function walkCountRow(intent, reality) {
  return `${walkCountSide('INTENT', intent)} · ${walkCountSide('REALITY', reality)} · walks concentrate at block-heads by the ShortLex-ascending follow`;
}
