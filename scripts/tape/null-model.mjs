// packages/thetacog-mcp/scripts/tape/null-model.mjs — THE NULL OF THE TESSERACT.
//
// Operator, 2026-08-20: "this is meant to test the null of the tesseract — how do we
// counterfactually prove that the tesseract is closing the gap, converging on the spec constrained
// by the question and answers?"
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
// A prior spec document claimed an "Anti-Regression Index (Δ_null)" measured against a "12-impostor
// null model". THAT DID NOT EXIST — asserted, never built (grepped scripts/, packages/, docs/,
// .thetacog/pmu/src/ on this date: zero hits). Without a null, "the cone narrowed" is
// unfalsifiable: it could be an artifact of the walk, the sensor, or the lattice geometry, and we
// would never know. This module builds the real thing and reports honestly, including the case
// where a null family does NOT separate.
//
// ── THE THREE NULL FAMILIES, each isolating one failure mode ──────────────────────────────────
//   1. SHUFFLED-TOKEN  — same rule text, tokens shuffled. Same length, same vocabulary, ~same gzip
//                        mass, destroyed word order. If it places at the SAME coordinate, the
//                        sensor is reading mass/vocabulary, not word order. (gzip-NCD is expected
//                        to be weak here — if it is, we SAY so; we do not arrange a pass.)
//   2. FOREIGN-CORPUS  — matched-gzip-mass text from an unrelated domain (intertidal ecology /
//                        bread / glaciers — embedded below, zero software vocabulary). If foreign
//                        text lands near the session's centre, the lattice has a MAGNET and
//                        "in-lane" means nothing.
//   3. PERMUTED-LATTICE— the REAL rule against a seeded permutation of the canonical 144 snippet
//                        library, through unified-drift's buildSensor() override — THE SAME WALK,
//                        never a forked placer; the receipt carries apertureRatio (=1.0 here, the
//                        permutation moves snippets, it does not change their mass). If the rule
//                        still lands at the same cell when every cell's snippet moved, placement is
//                        driven by lattice geometry, not content.
//
// ── THE DISCRIMINATION STATISTIC ──────────────────────────────────────────────────────────────
// For every locked coordinate: Chebyshev (king-move, 0–11) distance between the REAL representative
// coordinate and each null placement — driftFrom() in physics.mjs, the same number the lane reading
// uses. Per family: n, collision rate (d=0), median distance, and a verdict from thresholds fixed
// A PRIORI (in summarize(), not tuned after seeing data):
//   DISCRIMINATES           median d >= 2  AND  collision rate <= 0.25
//   DOES NOT DISCRIMINATE   median d == 0  OR   collision rate >= 0.50
//   WEAK                    everything between
// d=1 is inside representativeCoord's centroid-tie-break jitter, hence the >=2 separation bar.
// An empty session returns UNMEASURED with the reason — never a 0 standing in for "no data".
//
// REUSED, NEVER REIMPLEMENTED: physics.mjs (placeText/representativeCoord/driftFrom — the real
// recursive on-chip ballistic walk, no analytic shortcut), coordinates.mjs (liveCoordinates/cone),
// unified-drift.mjs (buildSensor/walkShape/CANONICAL_SENSOR). LLM-FREE by construction; every
// number is a deterministic function of (session ledger × seed).
//
// @guard tests/tape/null-model-discriminates.test.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const gz = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;

// ── deterministic PRNG — every null is a function of (text, seed), re-runnable byte-identically ─
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rand) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── NULL 1 · SHUFFLED-TOKEN ───────────────────────────────────────────────────────────────────
// Returns { ok, text, reason }. A generator that hands back the input unchanged is NOT a null —
// comparing a thing to itself proves nothing — so identity is REFUSED with a reason, and the guard
// test asserts exactly that refusal. Up to 8 reseeded retries before giving up (a text of one
// repeated token can never be permuted into something else; that is a property of the text, said honestly).
export function shuffleTokens(text, seed = 1) {
  const t = String(text || '');
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { ok: false, text: null, reason: `cannot shuffle ${tokens.length} token(s) — no order to destroy` };
  if (new Set(tokens).size < 2) return { ok: false, text: null, reason: 'all tokens identical — every permutation is the input; not a null' };
  for (let attempt = 0; attempt < 8; attempt++) {
    const rand = mulberry32(seed + attempt * 7919);
    const out = seededShuffle(tokens, rand).join(' ');
    if (out !== tokens.join(' ')) return { ok: true, text: out, reason: null };
  }
  return { ok: false, text: null, reason: 'could not produce a permutation distinct from the input in 8 attempts' };
}

// ── NULL 2 · FOREIGN-CORPUS — matched mass, unrelated domain ──────────────────────────────────
// Written for this file: intertidal ecology, bread fermentation, glacial geology. Deliberately zero
// software/patent/insurance vocabulary, so any landing near the session's centre is the LATTICE
// pulling, not the text pushing.
export const FOREIGN_CORPUS = [
  'The tide pool holds its residents to a schedule older than any of them. Twice a day the water withdraws and the anemones fold their tentacles inward, the limpets clamp their shells to the rock with a grip measured in kilograms, and the small sculpins retreat to the deepest crevice where a cup of seawater will outlast the afternoon sun. Barnacles feed only while submerged, sweeping the water with feathered legs, and their whole architecture is a bet on the rhythm of immersion.',
  'A sourdough culture is a negotiated settlement between yeasts and lactic bacteria, and the baker is a third party with limited jurisdiction. Flour and water arrive on a schedule; acidity rises until only the tolerant survive; the dough records every hour of fermentation in the size and gloss of its bubbles. Cold retards the yeast more than the bacteria, which is why a loaf proofed overnight in the refrigerator tastes of sour cream and hazelnut rather than of nothing.',
  'Glaciers move by two mechanisms and the difference is legible in the landscape they leave. Internal deformation creeps the ice downhill a few centimetres a day, layer sliding over layer like a deck of cards pushed from the top. Basal sliding is faster and rougher: meltwater lubricates the bed, the whole mass lurches, and boulders frozen into the sole gouge striations into the bedrock that survive for a hundred thousand years after the ice has gone.',
  'The heron hunts by refusing to move. It stands in the shallows with its neck folded into an S, and the fish, whose predators are mostly things that chase, file past a shape their instincts do not classify. The strike, when it comes, is over before the ripples reach the bank. An observer with a stopwatch finds the bird spends over ninety-nine percent of its hunting time perfectly still, and its yield per strike embarrasses every strategy built on pursuit.',
].join(' ');

// Cut a window of the foreign corpus whose gzip mass matches the target text's (grow until >=,
// seeded start offset). Both masses are reported; the caller can see how matched the match is.
export function foreignSample(targetText, seed = 1) {
  const targetZ = gz(targetText);
  const rand = mulberry32(seed);
  const words = FOREIGN_CORPUS.split(/\s+/);
  const start = Math.floor(rand() * Math.max(1, words.length - 40));
  let take = 8, text = '';
  while (take <= words.length) {
    // wrap around the corpus so a late start offset still has enough material
    const w = [];
    for (let i = 0; i < take; i++) w.push(words[(start + i) % words.length]);
    text = w.join(' ');
    if (gz(text) >= targetZ) break;
    take += 4;
  }
  return { ok: true, text, targetGzip: targetZ, gzip: gz(text), ratio: +(gz(text) / Math.max(1, targetZ)).toFixed(2) };
}

// ── NULL 3 · PERMUTED-LATTICE — the real rule, a shuffled axis library, THE SAME WALK ─────────
let _drift = null;
async function driftMod() {
  if (_drift) return _drift;
  _drift = await import(resolve(PKG, 'src/lib/pmu/unified-drift.mjs'));
  return _drift;
}
export async function permutedSensor(seed = 1) {
  const D = await driftMod();
  const rand = mulberry32(seed);
  const shuffled = seededShuffle(D.CANONICAL_SENSOR.targets, rand);
  // buildSensor marks apertureRatio on every receipt; a permutation preserves the snippet masses so
  // the ratio stays 1.0 — the null differs in ASSIGNMENT only, which is exactly the variable under test.
  return D.buildSensor(shuffled, { source: `permuted-lattice-seed-${seed}` });
}

// ── PLACEMENT — one door: physics.mjs for text nulls, walkShape+override for the lattice null ──
let _phys = null;
async function physics() {
  if (_phys) return _phys;
  _phys = await import(resolve(HERE, 'physics.mjs'));
  return _phys;
}

async function placeRep(text) {
  const P = await physics();
  const p = await P.placeText(text);
  if (!p.available) return { coord: null, sensor: null, unmeasured: p.reason };
  return { coord: P.representativeCoord(p.coords), sensor: p.sensor, cells: p.cells, unmeasured: null };
}

async function placeRepPermuted(text, sensor) {
  const [P, D] = [await physics(), await driftMod()];
  const w = await D.walkShape(String(text), { targets: sensor });
  if (w.unplaced || !w.coords?.length) return { coord: null, sensor: w.sensor, unmeasured: w.fallback_reason || 'no placement under permuted library' };
  return { coord: P.representativeCoord(w.coords), sensor: w.sensor, apertureRatio: w.apertureRatio, unmeasured: null };
}

// ── THE STATISTIC — pure, so the guard can feed it synthetic distances without a walk ─────────
// pairs: [{ family, d }] where d is the Chebyshev distance (int 0–11) or null (UNMEASURED, excluded
// from the stats but counted). Thresholds fixed a priori — see the header.
export function summarize(pairs) {
  const fams = new Map();
  for (const p of pairs || []) {
    if (!fams.has(p.family)) fams.set(p.family, []);
    fams.get(p.family).push(p.d);
  }
  const out = {};
  const ORDER = { 'DOES NOT DISCRIMINATE': 0, WEAK: 1, DISCRIMINATES: 2 };
  let worst = null;
  for (const [family, ds] of fams) {
    const measured = ds.filter((d) => Number.isFinite(d));
    if (!measured.length) {
      out[family] = { n: ds.length, measured: 0, verdict: 'UNMEASURED', reason: 'no null placement completed for this family' };
      continue;
    }
    const sorted = measured.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const collisionRate = +(measured.filter((d) => d === 0).length / measured.length).toFixed(3);
    let verdict;
    if (median === 0 || collisionRate >= 0.5) verdict = 'DOES NOT DISCRIMINATE';
    else if (median >= 2 && collisionRate <= 0.25) verdict = 'DISCRIMINATES';
    else verdict = 'WEAK';
    out[family] = {
      n: ds.length, measured: measured.length, medianChebyshev: median,
      min: sorted[0], max: sorted[sorted.length - 1], collisionRate, verdict,
    };
    if (worst === null || ORDER[verdict] < ORDER[worst]) worst = verdict;
  }
  return { families: out, overall: worst ?? 'UNMEASURED' };
}

// ── MEASURE — run the whole thing against a session's locked coordinates ──────────────────────
export async function measure(slug, { seeds = 3, includePermuted = true, log = () => {} } = {}) {
  const C = await import(resolve(HERE, 'coordinates.mjs'));
  const live = C.liveCoordinates(slug).filter((c) => c.coord);
  if (!live.length) {
    return {
      verdict: 'UNMEASURED', n: 0,
      reason: `no locked+placed coordinate in session '${slug}' — a null distribution needs a real placement to be compared against`,
    };
  }
  const P = await physics();
  const realCone = C.cone(live);
  const centre = realCone.centre || null;

  const pairs = [];            // { family, coordId, seed, d } — d = cheb(real, null)
  const foreignToCentre = [];  // magnet test: cheb(foreign placement, session centre)
  const detail = [];
  const permSensor = includePermuted ? await permutedSensor(1) : null;

  for (const c of live) {
    const rule = String(c.rule);
    const row = { id: c.id, real: c.coord, shuffled: [], foreign: [], permuted: null };

    for (let s = 1; s <= seeds; s++) {
      // shuffled-token
      const sh = shuffleTokens(rule, s);
      if (!sh.ok) {
        pairs.push({ family: 'shuffled-token', coordId: c.id, seed: s, d: null, reason: sh.reason });
      } else {
        const p = await placeRep(sh.text);
        const d = p.coord ? P.driftFrom(c.coord, p.coord) : null;
        pairs.push({ family: 'shuffled-token', coordId: c.id, seed: s, d, nullCoord: p.coord });
        row.shuffled.push({ seed: s, coord: p.coord, d });
        log(`  ${c.id} shuffled s${s} → ${p.coord ?? 'UNPLACED'} d=${d ?? '—'}`);
      }
      // foreign-corpus
      const fo = foreignSample(rule, s * 31 + (c.seq ?? 0));
      const pf = await placeRep(fo.text);
      const df = pf.coord ? P.driftFrom(c.coord, pf.coord) : null;
      pairs.push({ family: 'foreign-corpus', coordId: c.id, seed: s, d: df, nullCoord: pf.coord, massRatio: fo.ratio });
      if (pf.coord && centre) foreignToCentre.push(P.driftFrom(centre, pf.coord));
      row.foreign.push({ seed: s, coord: pf.coord, d: df, massRatio: fo.ratio });
      log(`  ${c.id} foreign  s${s} → ${pf.coord ?? 'UNPLACED'} d=${df ?? '—'} (mass ×${fo.ratio})`);
    }

    if (includePermuted) {
      const pp = await placeRepPermuted(rule, permSensor);
      const dp = pp.coord ? P.driftFrom(c.coord, pp.coord) : null;
      pairs.push({ family: 'permuted-lattice', coordId: c.id, seed: 1, d: dp, nullCoord: pp.coord });
      row.permuted = { coord: pp.coord, d: dp, sensor: pp.sensor };
      log(`  ${c.id} permuted    → ${pp.coord ?? 'UNPLACED'} d=${dp ?? '—'}`);
    }
    detail.push(row);
  }

  const stats = summarize(pairs);

  // MAGNET TEST — do off-topic texts sit as close to the centre as the real rules do?
  // realToCentre comes from the cone the session already computed; foreignToCentre from the nulls.
  const med = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const magnet = {
    realMedianToCentre: med(realCone.spread.map((x) => x.distance)),
    foreignMedianToCentre: med(foreignToCentre),
    nForeignPlaced: foreignToCentre.length,
    reading: null,
  };
  if (magnet.foreignMedianToCentre !== null && magnet.realMedianToCentre !== null) {
    magnet.reading = magnet.foreignMedianToCentre <= magnet.realMedianToCentre
      ? 'MAGNET: foreign text sits as close to the centre as the real rules — "in-lane" carries no information at this cone width'
      : 'no magnet: foreign text sits further from the centre than the real rules do';
  }

  return {
    slug, n: live.length, seeds,
    ts: new Date().toISOString(),
    cone: { centre, centreLabel: realCone.centreLabel, width: realCone.width },
    stats, magnet, pairs, detail,
    verdict: stats.overall,
  };
}

const cacheFile = (slug) => resolve(SESSIONS, slug, 'efficacy.json');
export function readCached(slug) {
  const f = cacheFile(slug);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
// NEVER process.exit() after a large stdout write: exit() kills the process before the pipe flushes
// past the ~8KB pipe buffer, and the consumer (the cockpit route) receives truncated JSON. MEASURED
// 2026-08-20: `report --json` (11,901 bytes) arrived as exactly 8,188 bytes through execFile while
// looking fine on a tty. Set process.exitCode and let node drain stdout on its own way out.
if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const cmd = process.argv[2];
  const slug = arg('--slug', 'gddadwill');
  const asJson = process.argv.includes('--json');

  if (cmd === 'measure') {
    const r = await measure(slug, { seeds: parseInt(arg('--seeds', '3'), 10), log: asJson ? () => {} : (l) => console.error(l) });
    if (r.verdict !== 'UNMEASURED' || r.n > 0) {
      mkdirSync(resolve(SESSIONS, slug), { recursive: true });
      writeFileSync(cacheFile(slug), JSON.stringify(r, null, 2));
    }
    if (asJson) {
      console.log(JSON.stringify(r));
    } else {
      console.log(`\n  NULL MODEL · ${slug} · ${r.n} locked coordinate(s)`);
      if (r.verdict === 'UNMEASURED' && !r.n) {
        console.log(`  ${r.reason}\n`);
      } else {
        for (const [fam, s] of Object.entries(r.stats.families)) {
          console.log(`  ${fam.padEnd(18)} n=${s.measured ?? 0}/${s.n}  median d=${s.medianChebyshev ?? '—'}  collisions=${s.collisionRate ?? '—'}  → ${s.verdict}`);
        }
        console.log(`  magnet: real med→centre ${r.magnet.realMedianToCentre} vs foreign ${r.magnet.foreignMedianToCentre} — ${r.magnet.reading || 'UNMEASURED'}`);
        console.log(`  OVERALL: ${r.verdict}\n`);
      }
    }
  } else if (cmd === 'report' || !cmd) {
    const c = readCached(slug);
    if (!c) {
      const out = { verdict: 'UNMEASURED', reason: `no efficacy run recorded for '${slug}' — run: node ${process.argv[1]} measure --slug ${slug}` };
      console.log(asJson ? JSON.stringify(out) : `  ${out.reason}`);
    } else {
      console.log(asJson ? JSON.stringify(c) : JSON.stringify(c.stats, null, 2));
    }
  } else {
    console.error('usage: null-model.mjs measure|report [--slug s] [--seeds n] [--json]');
    process.exitCode = 2;
  }
}
