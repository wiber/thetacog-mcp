#!/usr/bin/env node
// scripts/pmu/burn-mass.mjs — THE BURN-MASS PRIMITIVE (spec §3 I1, 2026-07-20).
//
// GEOMETRIC DEFLATION, NOT A LEDGER. When a selector picks a candidate, that candidate joins the
// ATTEMPT HISTORY of its coordinate. The next selection measures every candidate against that
// history and disqualifies anything that lands in the near-duplicate cluster — so the search space
// is WARPED rather than filtered, and the selector flows to genuinely new material by geometry.
//
// WHY NOT A HASH LEDGER: a one-character variant scores NCD 0.0761 — a hash ledger passes it
// straight through; the geometry rejects it as decisively as an exact copy (0.0437).
//
// ATTEMPTED, NOT REJECTED — the distinction that matters. The demand engine's fixed point was NOT
// a gate rejecting it 13 times; its rows were CONSUMED and it kept re-deriving them, getting
// deduped at write time. Burn mass must therefore hold everything ATTEMPTED, or it misses the
// actual observed failure mode.
//
// THE PROBE IS NEAREST-ITEM, NEVER WHOLE-PILE. gzip-NCD is dimension-blind and needs comparable
// byte mass on both sides (measured 2026-07-20):
//     whole-pile : same-item 0.8639 vs unrelated 0.9705  →  0.107 separation, DECAYS as it grows
//     nearest-item: near-miss 0.0761 vs unrelated 0.7869 →  0.57 separation, STABLE
//
// THE BIMODAL VACUUM sets the threshold, not taste: identical 0.0437 · one-char near-miss 0.0761 ·
// nearest-other-burned 0.6545 · unrelated 0.7869. NOTHING lives between 0.08 and 0.65, so any λ in
// 0.2–0.6 behaves identically. λ=0.35 is a line drawn through vacuum — a hard disqualifier, with no
// weighting term to tune and no parameter to defend.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
// THE VACUUM THRESHOLD — RE-DERIVED 2026-07-20 from 0.35 → 0.24. The original 0.35 was measured on
// 8 items in ONE lane; the self-enumerating vacuum sentinel then re-measured across 35 lanes /
// 10,983 pairs and found the largest empty interval had moved to [0.1440, 0.3379] — 0.35 sat ABOVE
// it (margin_above -0.0121), cutting through occupied space. 0.24 is the MIDPOINT of the measured
// vacuum; it still rejects duplicates (0.044) and one-char near-misses (0.076) and admits unrelated
// material (0.65+), while sitting where nothing lives. This IS the doctrine the spec demanded: "if
// the gap narrows, lambda is a guess and must be re-derived." Guard: burn-mass measureVacuum() +
// tape-health lambda-out-of-vacuum. The sentinel will flag this again if the vacuum moves — the
// number is provisional-by-design, pinned to a measurement, never to taste.
export const LAMBDA = 0.24;
// BURN_MASS_STORE lets a guard point the primitive at a scratch file. A test that writes into the
// live attempt history would poison the very ledger it is asserting about.
const STORE = process.env.BURN_MASS_STORE ? resolve(process.env.BURN_MASS_STORE) : resolve(REPO, 'data/pmu/burn-mass.json');
// THE PROBE BOUND. Cost is measured, not assumed: one gzip-NCD is 134us on this machine, so a
// 120-candidate hunt against an unbounded 200-item mass is 3.2s PER TARGET — a real bite out of a
// ~135s tick, paid three times over. Newest-wins is the honest bound: the most recent 80 attempts
// at a coordinate are what a selector is actually at risk of re-picking, and 80 x 134us = 10.7ms
// per candidate keeps a full hunt near one second.
// WINDOW PARITY (2026-07-21, the eternal-return incident): this constant now governs BOTH the
// deflate probe window AND recordAttempt's lane cap. They used to differ (probe 80, lane 200) —
// so an attempt could age OUT of the probe while staying IN the dedupe: invisible to the
// repellor, immortal in the shootout, zero at intake. Proven live on B,C2: 86 lane records,
// probe covered positions >=6, the forever-winning passages sat at 0..5. One window, two
// consumers — anything dedupe can see, deflate can repel; what expires, expires from both.
export const MAX_PROBE_MASS = 80;

const z = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
export function ncd(a, b) {
  const ga = z(a), gb = z(b), gab = z(`${a}\n${b}`);
  const d = Math.max(ga, gb);
  return d === 0 ? 1 : (gab - Math.min(ga, gb)) / d;
}

function load() {
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return { note: 'per-coordinate ATTEMPT history. Geometric deflation: a candidate near this mass is disqualified by compression distance, not by hash. See docs/architecture/self-observation-law-spec.md §3 I1.', lanes: {} }; }
}

/** every text attempted at this coordinate (the repellent mass) */
export function massFor(coord) { return (load().lanes[String(coord)] || []).map((r) => r.text); }

/**
 * THE PROBE. Returns the distance to the NEAREST attempted item at this coordinate.
 * 1 = nothing attempted here yet (no repulsion). Lower = closer to something already tried.
 */
export function distanceToMass(text, coord) {
  const mass = massFor(coord);
  if (!mass.length) return 1;
  let min = 1;
  for (const m of mass) { const d = ncd(text, m); if (d < min) min = d; }
  return +min.toFixed(4);
}

/** THE DISQUALIFIER — true when this candidate is a near-duplicate of something already attempted. */
export function isRepelled(text, coord, lambda = LAMBDA) { return distanceToMass(text, coord) < lambda; }

/**
 * DEFLATE — the caller's one required line. Filters a candidate list against the coordinate's
 * attempt history BEFORE the shootout ranks anything, so the selector never sees material it has
 * already tried. Returns {kept, repelled} so the caller can REPORT the deflation (a silent filter
 * is the same defect class as a silent burn).
 */
export function deflate(candidates, coord, getText = (c) => c.text, lambda = LAMBDA, excludeSha = null) {
  // excludeSha (spec §9 M5, the receipt-path wiring): attempts recorded under a given commit sha
  // are INVISIBLE when deflating for that same sha. Without this, a receipt-path selector's own
  // recording would change what the SAME commit renders on a re-run — breaking the receipt's
  // same-commit-twice-identical contract. History still bites on every OTHER sha, so the
  // loop-breaking is preserved exactly where it is safe.
  const recs = (load().lanes[String(coord)] || []).filter((r) => !excludeSha || r.sha !== excludeSha);
  // probe EVERYTHING stored — the write-cap (MAX_PROBE_MASS, in recordAttempt) is what bounds
  // cost. Slicing here re-opened the eternal return on legacy over-cap lanes: the stale head
  // never re-records, so no write ever trims it, and slice(-N) kept hiding exactly those rows.
  const mass = recs.map((r) => r.text);
  if (!mass.length) return { kept: candidates, repelled: [], mass_size: 0 };
  const kept = [], repelled = [];
  for (const c of candidates) {
    let min = 1;
    for (const m of mass) { const d = ncd(getText(c), m); if (d < min) min = d; if (min < lambda) break; }
    (min < lambda ? repelled : kept).push({ ...c, burn_distance: +min.toFixed(4) });
  }
  return { kept, repelled, mass_size: mass.length };
}

/** RECORD an attempt. Called after selection — success or failure, both are ATTEMPTS. */
export function recordAttempt(text, coord, meta = {}) {
  const doc = load();
  const key = String(coord);
  doc.lanes[key] = doc.lanes[key] || [];
  const t = String(text).slice(0, 400);
  if (doc.lanes[key].some((r) => r.text === t)) return false;
  doc.lanes[key].push({ text: t, ts: new Date().toISOString(), ...meta });
  // capped to the SAME window deflate probes (window parity — see MAX_PROBE_MASS above)
  if (doc.lanes[key].length > MAX_PROBE_MASS) doc.lanes[key] = doc.lanes[key].slice(-MAX_PROBE_MASS);
  try { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify(doc, null, 1)); } catch { return false; }
  return true;
}

/**
 * MEASURE THE VACUUM — is lambda still a line through empty space? (spec §3 I3)
 *
 * lambda=0.35 is only defensible while NOTHING lives around it. That was measured ONCE, on ONE
 * lane, and a constant justified by a single measurement is a constant on its way to becoming a
 * superstition. This re-derives it from whatever the attempt history actually holds now.
 *
 * THE SENSOR IS LABEL-FREE, which is what lets it run unattended: it does not need to know which
 * pairs are duplicates. It takes every pairwise distance available — within lane, across lanes,
 * plus a synthetic one-character mutation of each item (the case a hash ledger misses) — and finds
 * the LARGEST EMPTY INTERVAL in that distribution. If lambda sits inside it, lambda is a line
 * through vacuum by construction. If it does not, lambda is a guess and must be re-derived.
 *
 * MEASURED 2026-07-20 across 12 lanes / 2,291 pairs: the vacuum is [0.1440, 0.4074], width 0.2634,
 * and lambda sits inside it with 0.206 of margin below but only 0.057 above. Note what this
 * CORRECTS: the spec's single-lane claim that "any lambda in 0.2-0.6 behaves identically" is FALSE
 * on multi-lane data — 0.6 lands outside the vacuum and would repel genuinely distinct material.
 * The threshold survived; the tolerance around it did not.
 */
export function measureVacuum({ lambda = LAMBDA, perLane = 10, minLanes = 2 } = {}) {
  const lanes = Object.entries(load().lanes).filter(([, v]) => v.length >= 3);
  if (lanes.length < minLanes) return { ok: null, reason: `only ${lanes.length} lane(s) carry >=3 attempts — not enough to measure a vacuum`, lanes: lanes.length };
  const D = [];
  for (const [, v] of lanes) {
    const t = v.map((r) => r.text).slice(0, perLane);
    for (const x of t) if (x.length > 22) D.push(ncd(x, `${x.slice(0, 20)}${x[20] === 'e' ? 'a' : 'e'}${x.slice(21)}`));
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) D.push(ncd(t[i], t[j]));
  }
  for (let a = 0; a < lanes.length; a++) for (let b = a + 1; b < lanes.length; b++) {
    const A = lanes[a][1].map((r) => r.text).slice(0, 5), B = lanes[b][1].map((r) => r.text).slice(0, 5);
    for (const x of A) for (const y of B) D.push(ncd(x, y));
  }
  D.sort((a, b) => a - b);
  let lo = 0, hi = 1, width = 0;
  for (let i = 0; i + 1 < D.length; i++) { const g = D[i + 1] - D[i]; if (g > width) { width = g; lo = D[i]; hi = D[i + 1]; } }
  const inside = lambda > lo && lambda < hi;
  return {
    ok: inside, lambda, lanes: lanes.length, pairs: D.length,
    vacuum: [+lo.toFixed(4), +hi.toFixed(4)], width: +width.toFixed(4),
    margin_below: +(lambda - lo).toFixed(4), margin_above: +(hi - lambda).toFixed(4),
    reason: inside
      ? `lambda ${lambda} sits inside the measured vacuum [${lo.toFixed(4)}, ${hi.toFixed(4)}]`
      : `lambda ${lambda} is NOT in the largest empty interval [${lo.toFixed(4)}, ${hi.toFixed(4)}] — it is cutting through occupied space and must be re-derived`,
  };
}

// CLI: node scripts/pmu/burn-mass.mjs --stats | --vacuum
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--vacuum')) {
    const v = measureVacuum();
    console.log(v.ok === null ? `vacuum: ${v.reason}` : `${v.ok ? '✓' : '✗'} vacuum: ${v.reason} · width ${v.width} · margin ${v.margin_below} below / ${v.margin_above} above · ${v.lanes} lanes, ${v.pairs} pairs`);
    process.exit(v.ok === false ? 1 : 0);
  }
  const doc = load();
  const lanes = Object.entries(doc.lanes);
  console.log(`burn mass: ${lanes.length} coordinates carry attempt history · λ=${LAMBDA} (nearest-item probe)`);
  for (const [k, v] of lanes.sort((a, b) => b[1].length - a[1].length).slice(0, 10)) console.log(`  ${k.padEnd(8)} ${v.length} attempts`);
  if (!lanes.length) console.log('  (empty — no selector has recorded an attempt yet)');
}

/**
 * THE REFRESH VALVE (operator 2026-07-21: "thousands of additions… refresh ones sometimes").
 * A FULL rule key is not a dead end: a candidate strictly CLOSER to the rule's own text than the
 * worst incumbent — by at least REFRESH_MARGIN of NCD — replaces that incumbent. Deterministic,
 * gzip-canonical, and ratchet-shaped: the seated set can only get closer to its rule over time,
 * and the evicted text joins the attempt history so it can never boomerang back. This is what
 * makes the tape immortal at capacity — additions never stop, they just have to be BETTER.
 */
export const REFRESH_MARGIN = 0.05;
export function refreshPick(candidateText, incumbents, ruleText, margin = REFRESH_MARGIN) {
  if (!candidateText || !ruleText || !Array.isArray(incumbents) || !incumbents.length) return { replace: null };
  const cand = ncd(String(candidateText), String(ruleText));
  let worstIx = -1, worstD = -1;
  for (let i = 0; i < incumbents.length; i++) {
    const d = ncd(String(incumbents[i]), String(ruleText));
    if (d > worstD) { worstD = d; worstIx = i; }
  }
  if (worstIx >= 0 && cand + margin < worstD) {
    return { replace: worstIx, candidate_ncd: +cand.toFixed(4), worst_ncd: +worstD.toFixed(4) };
  }
  return { replace: null, candidate_ncd: +cand.toFixed(4), worst_ncd: +worstD.toFixed(4) };
}
