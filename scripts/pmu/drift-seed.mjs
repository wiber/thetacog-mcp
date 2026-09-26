#!/usr/bin/env node
// scripts/pmu/drift-seed.mjs — SEED THE STEERING STREAM FROM THE LOCAL DRIFT ZONES.
// =============================================================================
// Operator, verbatim (gemini-web:d3c6d42d10bab36c, turn 32): "it's supposed to use the local
// drift zones and stories to focus its effort and the whole point that we're failing to do so
// far is … to create an extremely short steering issues that uncover what needs to be resolved,
// basically blockers conceptual blockers … they're not guardrails exactly, [they're] the banks
// of the river … if we can stream the seed".
//
// WHAT WAS MISSING, and it is an ABSENCE rather than a broken feature — which is why nothing
// was red. scripts/elicit/refine-questions.mjs is the running write-back ratchet, and all three
// of its question kinds (CONFIRM · CHOOSE · UNBLOCK) are sourced from the elicit QUEUE — an
// intent someone already dictated. Not one of them can see the panel. So the loop could ask
// "which file did you mean?" all day and could never ask "why does the work keep landing at a
// coordinate nothing declares?" — the question the drift zones exist to raise. This module is
// the fourth source: it reads the zones, joins them to the stories, and emits ONE short line.
//
// A BANK, NOT A GUARDRAIL. Nothing here blocks, gates or refuses. It surfaces where the work
// keeps leaving the channel and asks the one question that would resolve it. The answer is one
// word and the loop consumes it; that is the whole contract.
//
// ── THE RATCHET (structural, LLM-free — no model opinion anywhere on this path) ──────────────
//   1. OFF-LANE. The coordinate is in the panel's outOfLane set: reality fired where intent is
//      silent. Green cells are the loop working; they raise nothing.
//   2. VISITED. The coordinate carries ≥1 landing on the grip tape. This is the one that had to
//      be MEASURED rather than assumed, and the measurement inverted the obvious design. The
//      first hypothesis was that an UNSEATED coordinate (reef-coord-name's `guessed` flag — no
//      reef domain sits on it, so the name is borrowed and prints with a "~") is the conceptual
//      blocker: the walk landing where the vocabulary has no word. Measured on this repo
//      2026-09-09: all 19 unseated off-lane coords have ZERO landings, and all 3 SEATED ones
//      have 160 / 17 / 7. The unseated coordinates are not blockers, they are empty cells that
//      borrowed a neighbour's name. Seeding on `guessed` would have produced nineteen questions
//      about places nothing happens and hidden the three that matter. The signal is the
//      opposite pairing: SEATED, BUSY, and STILL OFF-LANE.
//   3. A CONCRETE REFERENT. A story (data/interventions/stories/<sha>.json) from the room that
//      owns the zone's governor axis. A question with nothing in it the operator can recognise
//      is opacity, and opacity is what refine-questions' own bar exists to reject.
//   4. IT FITS. MAX_CHARS or it does not ship. "Extremely short" is his constraint, and a
//      truncated question is a worse artifact than no question.
// Below the bar is SILENCE, never a weaker question.
//
// LOUDNESS = landings × mean σ. σ here is the lens's intent-PLACEMENT separation (the same σ the
// receipt prints), so a high-σ off-lane zone is one the lens is CONFIDENT landed out of lane —
// a loud violation, not a marginal read. Both terms are reported beside the rank, never folded
// into a single invented score.
//
// Usage:
//   node scripts/pmu/drift-seed.mjs                # rank + print the seeds (surface only)
//   node scripts/pmu/drift-seed.mjs --json         # machine form
//   node scripts/pmu/drift-seed.mjs --stream       # append to .thetacog/elicit/drift-seeds.ndjson
//   node scripts/pmu/drift-seed.mjs --top 3
//
// @guard tests/pmu-simulator/drift-seed.test.mjs

import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandCoordName } from './reef-coord-name.mjs';
import { blockToShortLex } from './shortlex-coords.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENCIRCLED = resolve(REPO, '.thetacog/lens-encircled/latest.json');
export const TAPE = resolve(REPO, '.thetacog/grip-tape.ndjson');
export const STORIES = resolve(REPO, 'data/interventions/stories');
export const SEED_STREAM = resolve(REPO, '.thetacog/elicit/drift-seeds.ndjson');

// A tweet. Short enough that it is read in the thread rather than skimmed past, long enough to
// carry a full ShortLex coordinate + a real commit subject. Anything longer is a briefing.
export const MAX_CHARS = 280;

// The governor axis owns the zone, and the 9 depth-2 axes map 1:1 to the 9 rooms. Cardinal
// governors (A/B/C) drift at the level spanning their three children — route to that hub.
// Same table drift-surfacer.mjs routes hot cells with; kept here as data, not re-derived logic.
export const ROOM_FOR_AXIS = {
  A1: 'vault', A2: 'architect', A3: 'performer',
  B1: 'navigator', B2: 'network', B3: 'voice',
  C1: 'builder', C2: 'laboratory', C3: 'operator',
  A: 'vault', B: 'navigator', C: 'builder',
};

/** THE SOURCE MOVED (2026-09-14). This loop's own contract — OFF-LANE = "reality fired where intent
 *  is silent" — is the TOLERANCE semantics: the kind-3 (red) and kind-2 (amber) regions of the Rust
 *  tolerance panel. Until this date the zones were read off latest.json `outOfLane`, which the hook
 *  filled from the WALK's Chebyshev fence partition of walked coords — the 12×12 proxy CLAUDE.md bans —
 *  so the loop that asks the steering questions was seeded from a list that never saw the walk.
 *  Now a region's block rectangle expands to its ShortLex block coords and THAT is the cell list;
 *  latest.json's inLane/outOfLane are derived from the same regions by lens-encircled-png.mjs, so the
 *  block-coord readers (spec-render, cockpit) keep working and read the real thing. A panel with no
 *  regions has no zones — walk coords alone can never seed. */
export function regionCoords(region) {
  const bb = region && region.blockBox;
  if (bb && Number.isFinite(bb.r0) && Number.isFinite(bb.r1) && Number.isFinite(bb.c0) && Number.isFinite(bb.c1)) {
    const out = [];
    for (let r = bb.r0; r <= bb.r1; r++) for (let c = bb.c0; c <= bb.c1; c++) out.push(blockToShortLex(r, c));
    return out;
  }
  const c = String((region && (region.coord?.center ?? region.coord)) || '').trim();
  return c ? [c] : [];
}
const BAND_OF_KIND = { 1: 'green', 2: 'amber', 3: 'red' };
/** Band for a coordinate: red if it lies inside a kind-3 region, amber inside a kind-2, else green.
 *  Red wins over amber where rectangles overlap. Derived from the panel's REGIONS only. */
export function bandOf(coord, { regions = [] } = {}) {
  const key = String(coord).trim();
  let band = 'green';
  for (const rg of regions || []) {
    const b = BAND_OF_KIND[rg.kind];
    if (!b || b === 'green') continue;
    if (regionCoords(rg).includes(key)) { if (b === 'red') return 'red'; band = b; }
  }
  return band;
}
/** Every off-lane block coord the panel's regions cover (red+amber), deduped, red-first. */
export function offLaneCoords(regions = []) {
  const seen = new Map();
  for (const rg of regions || []) {
    const b = BAND_OF_KIND[rg.kind];
    if (b !== 'red' && b !== 'amber') continue;
    for (const c of regionCoords(rg)) if (!seen.has(c) || b === 'red') seen.set(c, b);
  }
  return [...seen.entries()].map(([coord, band]) => ({ coord, band }));
}

/** Landings + mean σ per coordinate, from the grip tape. Pure over injected rows. */
export function tapeStats(rows = []) {
  const by = new Map();
  for (const r of rows) {
    const k = String(r?.coord || '').trim();
    if (!k) continue;
    const e = by.get(k) || { visits: 0, sigmaSum: 0, sigmaN: 0 };
    e.visits += 1;
    if (Number.isFinite(r.sigma)) { e.sigmaSum += r.sigma; e.sigmaN += 1; }
    by.set(k, e);
  }
  const out = new Map();
  for (const [k, e] of by) out.set(k, { visits: e.visits, sigma: e.sigmaN ? e.sigmaSum / e.sigmaN : null });
  return out;
}

/** THE ZONES: off-lane ∧ visited, ranked loudest first. Checks 1 and 2 of the ratchet.
 *  Returns every off-lane cell with its stats attached so a caller can see what was dropped. */
export function rankZones({ encircled = {}, tape = [] } = {}) {
  const stats = tapeStats(tape);
  const zones = offLaneCoords(encircled.regions || []).map((c) => {
    const coord = String(c.coord).trim();
    const s = stats.get(coord) || { visits: 0, sigma: null };
    const e = expandCoordName(coord);
    return {
      coord,
      band: bandOf(coord, encircled),
      visits: s.visits,
      sigma: s.sigma,
      loudness: s.visits * (s.sigma ?? 0),
      canonical: e.canonical,
      domain: e.domain || null,   // expandCoordName returns the domain NAME as a string, not the record
      seated: !e.guessed,
      room: ROOM_FOR_AXIS[coord.split(',')[0]] || null,
    };
  });
  const kept = zones.filter((z) => z.band === 'red' && z.visits > 0);
  kept.sort((a, b) => b.loudness - a.loudness || b.visits - a.visits || a.coord.localeCompare(b.coord));
  return { zones, kept };
}

/** Load the stories corpus (one JSON per commit), newest first. */
export function loadStories(dir = STORIES) {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { rows.push(JSON.parse(readFileSync(resolve(dir, f), 'utf8'))); } catch { /* a half-written story is not a blocker */ }
  }
  return rows.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
}

/** Check 3: the newest story from the room that owns this zone's governor axis.
 *  Room labels drift in the corpus ("📐 architect", "📐 VS Code Architect"), so match on the
 *  room KEY as a substring — never an exact label, which would silently find nothing.
 *  `usedShas` keeps two zones under one cardinal governor (C,A1 and C,A3 both route to builder)
 *  from citing the same commit — two questions quoting one subject read as one question sent
 *  twice, and the operator answers neither. */
export function storyFor(zone, stories = [], { usedShas = new Set() } = {}) {
  if (!zone?.room) return null;
  const needle = zone.room.toLowerCase();
  const mine = stories.filter((s) => String(s?.room || '').toLowerCase().includes(needle) && s.subject);
  return mine.find((s) => !usedShas.has(String(s.sha))) || null;
}

/** THE SEED — one line, or null below the bar. No marker: the poster owns its own marker, so
 *  this never has to know which channel it lands in. The question is the modeled A-vs-B fork
 *  (lane wrong, or work wrong?) — one word answers it, which is the affordance bar. */
export function seedFor(zone, story, { maxChars = MAX_CHARS } = {}) {
  if (!zone || zone.band !== 'red' || !zone.visits) return null;
  if (!story) return null;
  const dom = zone.domain ? ` (${zone.domain})` : '';
  const sig = Number.isFinite(zone.sigma) ? `, σ ${zone.sigma.toFixed(2)}` : '';
  const subj = String(story.subject).replace(/\s+/g, ' ').slice(0, 64);
  const off = Number.isFinite(story.offPct) ? ` ${story.offPct}% off-lane` : '';
  const text = `${zone.canonical}${dom} is red with ${zone.visits} landings${sig} — the work keeps firing where nothing is declared. Latest: "${subj}"${off}. Wrong LANE (declare it) or wrong WORK (stop it)?`;
  if (text.length > maxChars) return null;   // it fits or it does not ship
  return { ref_id: `drift:${zone.coord}`, coord: zone.coord, kind: 'blocker',
    certainty: `off-lane×${zone.visits}`, room: zone.room, text };
}

/** The assembly: zones → stories → seeds, ranked. Pure over injected corpora. */
export function driftSeeds({ encircled = {}, tape = [], stories = [], top = 5 } = {}) {
  const { zones, kept } = rankZones({ encircled, tape });
  const seeds = [], usedShas = new Set();
  for (const z of kept) {
    const story = storyFor(z, stories, { usedShas });
    const seed = seedFor(z, story);
    if (seed) { usedShas.add(String(story.sha)); seeds.push({ ...seed, sha: story.sha, loudness: z.loudness, sigma: z.sigma, visits: z.visits }); }
    if (seeds.length >= top) break;
  }
  return { zones, kept, seeds };
}

const readNd = (p) => (existsSync(p)
  ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : []);

/** Read the live local artifacts. Each absence is REPORTED, never silently treated as empty —
 *  "I did not look" and "I looked and saw nothing" are different claims. */
export function readLive() {
  const missing = [];
  let encircled = {};
  if (existsSync(ENCIRCLED)) { try { encircled = JSON.parse(readFileSync(ENCIRCLED, 'utf8')); } catch { missing.push(ENCIRCLED); } }
  else missing.push(ENCIRCLED);
  if (!existsSync(TAPE)) missing.push(TAPE);
  if (!existsSync(STORIES)) missing.push(STORIES);
  return { encircled, tape: readNd(TAPE), stories: loadStories(), missing };
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const has = (f) => process.argv.includes(f);
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  const top = Number(arg('--top', '5'));
  const { encircled, tape, stories, missing } = readLive();
  if (missing.length) {
    console.error(`drift-seed: COULD NOT LOOK — absent: ${missing.map((m) => m.replace(REPO + '/', '')).join(', ')}`);
    if (!existsSync(ENCIRCLED)) process.exit(2);   // no panel, no zones: that is not "no drift"
  }
  const { zones, kept, seeds } = driftSeeds({ encircled, tape, stories, top });
  if (has('--json')) { console.log(JSON.stringify({ zones, kept, seeds }, null, 2)); process.exit(0); }
  console.log(`drift-seed · ${zones.length} off-lane cells · ${kept.length} red ∧ visited · ${seeds.length} clear the ratchet`);
  const dropped = zones.filter((z) => z.band === 'red' && !z.visits).length;
  console.log(`  dropped: ${dropped} red cells with zero landings (${zones.filter((z) => z.band === 'red' && !z.visits && !z.seated).length} of them unseated — a borrowed name, not a blocker)`);
  for (const z of kept) {
    const seed = seeds.find((s) => s.coord === z.coord);
    console.log(`\n  ${z.coord.padEnd(7)} loud ${z.loudness.toFixed(1).padStart(6)} · ${z.visits} landings · σ ${z.sigma?.toFixed(2) ?? '—'} · ${z.room || '?'} · ${z.canonical}`);
    console.log(seed ? `    ↳ ${seed.text}` : '    ↳ (no story from this room — below the bar, silent)');
  }
  if (has('--stream') && seeds.length) {
    mkdirSync(dirname(SEED_STREAM), { recursive: true });
    const ts = new Date().toISOString();
    for (const s of seeds) appendFileSync(SEED_STREAM, JSON.stringify({ ts, ...s }) + '\n');
    console.log(`\nstreamed ${seeds.length} seed(s) → ${SEED_STREAM.replace(REPO + '/', '')}`);
  }
}
