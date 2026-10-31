// scripts/pmu/spec-reef.mjs — THE REEF MADE TO ORDER FROM THE SPEC.
//
// THE FIX for the "almost, or is it" gap. The shipped gate sensed every work
// product against the GENERIC 144 (axis-library-v1.json: Strategy/Tactics/
// Operations…). The spec only got to SELECT which generic cells were in-lane —
// it never got to say what the cells MEAN. So a payment-gateway spec was scored
// against "exchange & negotiation" and a correct answer read DRIFT; a synonym of
// the spec found no grip on the generic axes and read ABSTAIN. The semantic map
// was canonical, not the spec's. (Proven: docs/architecture/anti-rules-ledger.md
// → AR "size-as-drift"/seed-library; project_low-sigma-traces-to-tile-library.)
//
// The cure is the whole thesis stated as code: BUILD THE REEF FROM THE SPEC.
// "Define the definer all the way down" — each anchor is a spec claim, thickened
// by the spec's own nearest claims (the claims that define it). Positional
// meaning: the most mutually-distinct claims become the primary axes (A,B,C); the
// rest refine them (A1…C3) — a ShortLex divergent series that covers the spec's
// neighbourhood (much, not everything) so we know with high precision WHERE the
// work drifts from the spec — which is exactly the priced variable (insure/option).
//
// Sensing is then `compress(work, buildSpecReef(spec))`: the work is referred to
// the SPEC's anchors, not the canonical ones. On-domain work lands on a spec axis
// with margin (MATCH); off-domain work is roughly equidistant from every spec
// axis → no margin → ABSTAIN (the gate refuses to flatter). Drift is measured in
// the spec's own field.
//
// DETERMINISTIC by construction (gzip-NCD + spec-order tie-breaks, no Date/random)
// so a stranger re-derives the SAME reef from the spec and the commitment binds it.

import { claimify } from './corpus-ingest.mjs';
import { ncd } from '../../src/app/pmu-simulator/cell-compress.mjs';

// ShortLex coordinates + the canonical axis emojis, in ShortLex order. The first
// three (A,B,C) are the primary definers; A1…C3 refine them. We assign the most
// mutually-distinct spec claims to the primaries so the divergent series fans out.
export const SHORTLEX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const EMOJI = ['🏛️', '⚡', '🔧', '⚖️', '🎯', '💰', '🏎️', '🤝', '📡', '🔌', '🔄', '🌊'];

// specClaims — shatter the spec into atomic claims. claimify is the canonical
// shatterer (isSemantic · classifyClaim · looksLikeCodeSyntax). It is tuned for
// repo corpora and is strict, so for a short hand-written spec it can under-yield;
// when it returns < 4 we fall back to a plain sentence/clause split so even a
// one-paragraph spec produces enough anchors to separate.
export function specClaims(spec) {
  let claims = claimify(spec);
  if (claims.length < 4) {
    claims = String(spec || '')
      .split(/(?<=[.!?;:])\s+|\n+|,\s+|\s+[—–-]\s+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 12);
  }
  // dedupe (case-insensitive), preserve spec order (the deterministic tie-break)
  const seen = new Set();
  const out = [];
  for (const c of claims) {
    const k = c.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

// farthestPointSample — greedy max-min on NCD. Start at claim 0 (spec order is the
// deterministic seed), then repeatedly add the claim whose nearest-already-chosen
// distance is the LARGEST. This pulls out the mutually most-distinct claims, which
// become the most-orthogonal anchors — directly the cure for the low-σ collapse
// (a transpose-symmetric / row-themed library gives no margin; orthogonal anchors do).
// Ties broken by lowest index (spec order) → fully deterministic.
export function farthestPointSample(claims, k) {
  const n = claims.length;
  if (n <= k) return claims.map((_, i) => i);
  const chosen = [0];
  const chosenSet = new Set(chosen);
  // nearest-chosen distance for every claim
  const nearest = claims.map((c) => ncd(c, claims[0]));
  while (chosen.length < k) {
    let best = -1; let bestD = -Infinity;
    for (let i = 0; i < n; i++) {
      if (chosenSet.has(i)) continue;
      if (nearest[i] > bestD) { bestD = nearest[i]; best = i; }
    }
    chosen.push(best);
    chosenSet.add(best);
    for (let i = 0; i < n; i++) {
      if (chosenSet.has(i)) continue;
      const d = ncd(claims[i], claims[best]);
      if (d < nearest[i]) nearest[i] = d;
    }
  }
  return chosen;
}

// axisName — a short human label from the seed claim's most salient content words
// (drop function words, keep the first few domain words). Cosmetic only; the
// snippets drive the gate, the name makes the lattice legible.
const NAME_STOP = new Set((
  'the a an is are was were be to of in on for with that this it as by from and or but if so ' +
  'we you they our your their will would can could should must not no every each a an into onto'
).split(' '));
function axisName(seed) {
  const words = (String(seed).match(/[A-Za-z][A-Za-z'-]{2,}/g) || [])
    .filter((w) => !NAME_STOP.has(w.toLowerCase()));
  const pick = words.slice(0, 3).join(' ');
  return pick ? pick.replace(/\b\w/g, (m) => m.toUpperCase()) : seed.slice(0, 24);
}

// buildSpecReef — the reef, made to order. Returns an axis-library shaped object
// (drop-in for compress(doc, axisLib)): { version, source, axes:[{rank,name,
// emoji,question,snippets}] }. Each axis = one FPS-selected spec claim (the
// definer) plus its nearest spec claims (the claims that define IT — the
// "definer of definer" thickening, bounded by the spec = the divergent series).
export function buildSpecReef(spec, { maxAxes = 12, thicken = 2 } = {}) {
  const claims = specClaims(spec);
  if (claims.length === 0) throw new Error('spec yielded no claims to build a reef from');
  const k = Math.min(maxAxes, claims.length);
  const seedIdx = farthestPointSample(claims, k);
  const seeds = seedIdx.map((i) => claims[i]);

  // assign every claim to its nearest seed → each seed accretes the claims that
  // elaborate it (define-the-definer). Ties → lowest seed index (deterministic).
  const members = seeds.map(() => []);
  for (let i = 0; i < claims.length; i++) {
    let best = 0; let bestD = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const d = ncd(claims[i], seeds[s]);
      if (d < bestD) { bestD = d; best = s; }
    }
    members[best].push(claims[i]);
  }

  const axes = seeds.map((seed, s) => {
    // snippets = the seed first, then its nearest distinct members, capped.
    const extra = members[s].filter((m) => m !== seed);
    const snippets = [seed, ...extra].slice(0, 1 + thicken);
    return {
      rank: SHORTLEX[s] || `X${s}`,
      name: axisName(seed),
      emoji: EMOJI[s % EMOJI.length],
      question: seed.length > 90 ? seed.slice(0, 90) + '…' : seed,
      snippets,
    };
  });

  return { version: 'spec-reef-v1', source: 'spec', axes };
}

// cellsOf — the default authorized lane = every cell the spec reef defines. The
// whole spec field is in-lane; only work that lands OFF the spec's anchors (no
// margin) drifts. Callers may still pass a narrower --authorized to gate a sub-lane.
export function cellsOf(reefLib) {
  return (reefLib.axes || []).map((a) => a.rank);
}
