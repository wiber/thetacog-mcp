#!/usr/bin/env node
// scripts/pmu/attest-demo-freeform.mjs — C1178: THE LAPTOP TEST.
//
// attest-demo's fixed scenario (a hardcoded spec + three hardcoded probes) proves the
// mechanism but never lets a stranger hand it their OWN job. This module turns ANY free-form
// text (the thing you'd hand an agent) into a spec: it places the text itself on the
// 12-rank axis lattice (the same gzip-NCD witness every gate call already uses — never a new
// sensor), authorizes the FAMILY that text landed in, and labels three stand-in work products
// green / flagged / breach by how far their own measured placement sits from that family —
// never by a keyword match on the work product's text.
//
// The three families (A, B, C) sit on a line, not a ring: home family itself is distance 0
// (green — plumbing), the one step over is distance 1 (flagged — wiring), the family two
// steps away is distance 2 (breach — demolition). That ordering is the axis library's own
// rank order (docs/architecture/axis-library-v1.json), never invented here.
//
// Pure, no subprocess, no network — attest-demo.mjs wires this into its CLI.
//
// C1246 — THE RELIABLE-LENGTH FLOOR. Six short inputs (coffee, invoice, delete every customer
// record, patent claims, deal terms, fund strategy — 6 to 29 characters) all placed at home cell
// C, same digest 51da7bea1198 — measured, not alleged: gzip-NCD on a short doc is dominated by
// gzip's fixed per-string overhead, not by what the doc says. MEASURED FLOOR: truncate each of
// the 48 reference snippets (docs/architecture/axis-library-v1.json) to N characters and ask
// compress() to recover the snippet's OWN axis — the recovery rate climbs 31% (10 chars) → 48%
// (20) → 71% (30) → 88% (40) → 94-98% (45-58, non-monotonic) → 100% at 59, and every length
// swept above it. 59 is the measured line where this sensor stops being a coin flip on its own
// corpus. buildFreeformSpec ABSTAINS (homeRank null, authorizedCells empty) below it rather than
// hand back a cell dressed as a measurement. See tests/vna/c1246-1-attest-demo-input-places-every.test.mjs.
//
// C1376 — ONE FLOOR, THE PACKAGE'S OWN. The 59 above was a SECOND constant beside the floor the package
// had already measured for the same sensor: scripts/rewrite/tesseract.mjs's MIN_GZIP_BYTES (220 — below
// this gzip mass a passage has too little to place) and OOC_MIN_CHARS (320 — a 190-char recipe from a
// different domain once scored 100% in-character purely by being short). Two floors for one sensor are
// two answers to one question, so the abstain now reads BOTH tesseract constants, imported never
// re-typed: under OOC_MIN_CHARS trimmed characters OR under MIN_GZIP_BYTES of gzip mass, the placement
// abstains and the reason names the half it fell under. MIN_RELIABLE_CHARS survives only as the name
// C1246 callers already import — it IS OOC_MIN_CHARS. The Peter fixture below is lengthened to clear
// both halves (513 chars, 309 gzip bytes; it was 130 / 116), so the bare `attest-demo` never prints a
// cell the package's own floor disowns. Guard: tests/vna/c1376-one-floor-the-package-s-own.test.mjs.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MIN_GZIP_BYTES, OOC_MIN_CHARS } from '../rewrite/tesseract.mjs';   // C1376: the package's own floor, one place
import { SCENARIOS } from './attest-scenarios.mjs';   // C1399: the demo's work products are the at-mass scenario texts
import { askSync } from '../vna/door-crate.mjs';   // C1409: the floor is decided in the crate (door.rs mass_op); this module relays it

export { MIN_GZIP_BYTES, OOC_MIN_CHARS };
export const MIN_RELIABLE_CHARS = OOC_MIN_CHARS;   // C1376: the name C1246 callers import — the tesseract value, never a second number
/** The gzip mass of a text — the bytes the sensor actually weighs (the same gzip compress.mjs runs). */
export function gzipMass(text) { return gzipSync(Buffer.from(String(text || ''), 'utf8')).length; }
export const FAMILY_ORDER = ['A', 'B', 'C'];

// C1182 — THE BARE COMMAND'S DEFAULT: the deck's own Peter, a plumber, handed a real plumbing job.
// Lives here, not in attest-demo.mjs, so a caller that only needs the TEXT (attest-demo-ux.mjs's
// page boot, C1212) can read it without importing a CLI module whose main() runs unconditionally.
// C1376 — long enough to clear the package's own floor (OOC_MIN_CHARS / MIN_GZIP_BYTES above) in a
// plumber's own words: the first sentence is the original 130-char job, the rest is what Peter would
// add to the work order. Measured on the gzip-NCD sensor: lands in family C (Operations) with the
// whole top-4 inside C, margin 0.0154 over the nearest other family — an END of the A-B-C line, which
// is what lets the three stand-ins print one green, one flagged, one breach.
export const PETER_FIXTURE = 'Fix the leaking pipe under the kitchen sink, replace the corroded shutoff valve, and clear the slow drain in the hallway bathroom. Good plumbing is the loop that runs whether anyone watches, and it earns its keep by being boring: water flows where the pipes let it, inventory accumulates upstream of a slow drain, and a leak is pressure finding the weakest connection. Shut the main, run the loop once end to end, check every connection for a drip, and leave the old valve on the counter so I can see what failed.';

/** The family (A/B/C) a rank like 'A', 'B2', 'C3' belongs to. */
export function familyOf(rank) {
  const r = String(rank || '');
  return r.slice(0, 1).toUpperCase();
}

/** Distance between two families on the A-B-C line: 0 same, 1 adjacent, 2 far. */
export function familyDistance(a, b) {
  const ia = FAMILY_ORDER.indexOf(a), ib = FAMILY_ORDER.indexOf(b);
  if (ia < 0 || ib < 0) return Infinity;
  return Math.abs(ia - ib);
}

/** The deck's own words (src/app/deck/peter/PeterDeckClient.tsx), read off MEASURED distance. */
export function placementLabel(dist) {
  if (dist === 0) return 'green';
  if (dist === 1) return 'flagged';
  return 'breach';
}

/** Every rank in a family, ShortLex order: A → [A, A1, A2, A3]. */
export function familyCells(family) {
  const axisLib = FAMILY_SUBRANKS[family];
  if (!axisLib) return [];
  return [family, ...axisLib];
}
const FAMILY_SUBRANKS = { A: ['A1', 'A2', 'A3'], B: ['B1', 'B2', 'B3'], C: ['C1', 'C2', 'C3'] };

/**
 * Free-form input resolution: an existing file path reads as the file's contents; anything
 * else (including text that merely looks path-like) is the literal spec text. `existsSyncFn`
 * is injected so a test can exercise the file branch without touching the real filesystem.
 */
export function resolveFreeformInput(raw, { existsSyncFn, readFileSyncFn }) {
  const text = String(raw ?? '');
  if (text && existsSyncFn(text)) return readFileSyncFn(text, 'utf8');
  return text;
}

/**
 * Turns free-form text into the spec attest-demo stages: the text itself IS the spec, and the
 * family its own placement lands in IS the authorized lane — compiled by the same witness
 * (`compressFn`, i.e. src/lib/pmu/compress.mjs's compress()) every gate call already runs, so
 * "turn it into a spec" is never a second, bespoke classifier.
 *
 * C1246 / C1376 — ABSTAIN BELOW THE PACKAGE'S OWN FLOOR. Text under OOC_MIN_CHARS trimmed characters,
 * or under MIN_GZIP_BYTES of gzip mass (both scripts/rewrite/tesseract.mjs's constants, imported above),
 * sits below the floor where this sensor places stably — so the placement ABSTAINS: homeRank null,
 * authorizedCells empty, abstainReason naming the half it fell under. A caller checks `.abstain` before
 * reading homeRank/homeFamily/authorizedCells.
 *
 * C1409 (operator, 2026-10-29: "rust only") — THE CRATE DECIDES THE FLOOR, THIS FUNCTION RELAYS IT. The two comparisons this
 * function held (trimmed length against OOC_MIN_CHARS, gzip mass against MIN_GZIP_BYTES) moved into door.rs mass_op, the entry's
 * own rule on the entry's own constants (trimmed, both halves). The abstain reason is the crate's ("below floor: spec <chars>
 * chars / <gz> gz bytes < 320 / 220"). A crate that cannot answer is an abstention with that reason, never a node comparison.
 *
 * C1371 — HOME MARGIN. `placed.witnesses.gzipNCD.scores` is the SAME per-axis score list the
 * gate already computes (compress.mjs), sorted best-first; `homeMargin` is just the gap between
 * the winning axis and the runner-up, read off that list rather than re-derived — null when the
 * placement abstains or the sensor exposes fewer than two scores.
 */
export function buildFreeformSpec(text, axisLib, compressFn) {
  const placed = compressFn(text, axisLib);
  // C1376 — the package's own floor, both halves: too few characters OR too little gzip mass to place. C1409: decided in the crate.
  const floor = placed.cell ? crateFloor(text) : { atMass: false, reason: null };   // no cell: nothing to hold to a floor
  const abstain = !placed.cell || !floor.atMass;
  const homeRank = abstain ? null : placed.cell;
  const homeFamily = homeRank ? familyOf(homeRank) : null;
  const abstainReason = abstain
    ? (placed.cell
        ? `${floor.reason} — the crate's floor (door.rs mass_op, \`pmu-onchip --constants js\`), where gzip's fixed overhead can out-weigh what the text says`
        : 'empty input')
    : null;
  const scores = placed.witnesses?.gzipNCD?.scores || [];
  const homeMargin = (!abstain && scores.length >= 2) ? (scores[0].score - scores[1].score) : null;
  return {
    spec: text, homeRank, homeFamily,
    authorizedCells: homeFamily ? familyCells(homeFamily) : [],
    sigma: placed.sigma, homeMargin, abstain, abstainReason,
  };
}

// C1409: the one call — the spec text in, the crate's at-mass decision and its reason out (door.rs mass_op, floor "entry": the
// entry's own rule, trimmed). Sync, because buildFreeformSpec is: one door-serve request through the daemon or the one-shot door.
function crateFloor(text) {
  try {
    const [r] = askSync([{ op: 'mass', texts: [{ field: 'spec', text: String(text ?? '') }], floor: 'entry', trim: true }], { timeoutMs: 30000 });
    const row = r && Array.isArray(r.sizes) ? r.sizes[0] : null;
    if (!row || typeof row.at_mass !== 'boolean') return { atMass: false, reason: 'UNMEASURED — the crate answered no at-mass decision (a binary older than C1409)' };
    return { atMass: row.at_mass, reason: r.reason || null };
  } catch (e) {
    return { atMass: false, reason: `UNMEASURED — the crate could not decide the floor (${String((e && e.message) || e).slice(0, 120)}); rust only, never a node comparison` };
  }
}

/**
 * The pitch's digest: folds in the raw INPUT TEXT first, so two different inputs — even two that
 * both abstain, or that land at the same cell — never collide (C1246: six different inputs once
 * shared one digest, 51da7bea1198, because the digest covered only the placement). Still
 * byte-identical across repeat runs of the identical input: never the receipt id or temp path.
 *
 * C1396 — THE DIGEST COVERS WHAT THE LINE SAYS. The printed line says "covers your input text and the placement"; a cold reader
 * found `--work` surgery and no work at all printed the same digest, because `works` never reached this hash. Each --work entry
 * ({ text, placement }: placement is "label:cell" off the gate, or "UNMEASURED" when the walk's one entry refused it) is folded in
 * as the sha256 of its exact bytes and its placement, in the order given. No works → the body is byte-identical to before, so
 * the bare and --input digests do not move.
 */
export function freeformDigest(text, spec, placements, works = []) {
  let body = spec.abstain ? `${text}|UNMEASURED` : `${text}|${spec.homeRank}|${(placements || []).join(',')}`;
  if (works && works.length) body += '|work:' + works.map((w) => `${createHash('sha256').update(String(w.text ?? '')).digest('hex')}=${w.placement}`).join(',');
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

// ── C1399 (2026-10-29) — THE DEMO'S WORK PRODUCTS ARE NEVER ITS REFERENCE PARAGRAPHS ─────────────────────────────────────────
// wo3 found the three "work products" were the reference corpus itself (sampleWorkProducts below joins the axis library's own A, B
// and C snippets), so every run printed one breach, one flag and one green whatever spec was given: a circular demo. The bare demo
// now places three of C1393's at-mass scenario realities (scripts/pmu/attest-scenarios.mjs, every text over the crate's floor of
// 320 chars / 220 gz bytes, none padded): a compliant job, a scope creep and a destructive one, written as work reports, never as
// library anchors. Their verdicts move with the spec (the guard runs two specs and reads a verdict change). The scenario's
// `expect` is the gate's recorded outcome against the scenario's OWN intent; here they are read against YOUR spec, so it is not
// printed. sampleWorkProducts stays exported for its own guard (C1178) and is no longer what the demo places.
// Guard: tests/vna/c1399-the-demo-s-work-products-are.test.mjs.
// ── C1401 (2026-10-29) — THE WALK'S OUTPUT NAMES WHAT IT IS SUFFICIENT FOR ─────────────────────────────────────────────────
// wo3 measured the sensor grid that feeds the walk (senseDecompose: a 64-bit simhash of each claim's word shingles against 20,736
// snippet-pair signatures) as order-blind (swap two sentences: 0 of 20,736 cells flip) and nearly deletion-blind (delete a whole
// content sentence: 8 flip). Per AXIOM 1 W6 a projection surface declares the question it is sufficient for and the one it is not,
// so the bare demo and --serve print this one line beside the walk's reading. One place: both doors import it; the package README's
// walk paragraph carries the same halves (lane E, the "(C1401)" sentence). Guard: tests/vna/c1401-the-walk-s-output-names-what.test.mjs.
export const WALK_SUFFICIENCY_LINE = 'THE WALK IS SUFFICIENT FOR: WHERE the work lands against the declared lane (which of the 20,736 node-pair cells light, re-runnable byte-for-byte from the same bytes). NOT SUFFICIENT FOR: sentence order or a single lost sentence, and never for whether the work is correct (undecidable, Rice).';
export const DEMO_WORK_KEYS = Object.freeze(['faithful', 'partial-drift', 'sledgehammer']);
export function demoWorkProducts(scenarios = SCENARIOS) {
  return DEMO_WORK_KEYS.map((key) => {
    const s = scenarios.find((x) => x.key === key);
    if (!s || !s.reality) throw new Error(`attest-scenarios.mjs carries no "${key}" reality — the demo's work products are read from it, never typed`);
    return { key, sourceFamily: key, text: s.reality };
  });
}

/**
 * Three stand-in work products, one per family, each carrying real text already in the axis
 * library (never fabricated). `sourceFamily` is only a label for the printed line — the
 * green/flagged/breach verdict attest-demo prints comes from GATING this text and measuring
 * where it actually lands, which may or may not agree with the family it was drawn from.
 */
export function sampleWorkProducts(axisLib) {
  return FAMILY_ORDER.map((family) => {
    const ranks = familyCells(family);
    const snippets = ranks.flatMap((r) => axisLib.axes.find((a) => a.rank === r)?.snippets || []);
    return { sourceFamily: family, text: snippets.filter(Boolean).join('\n\n') };
  });
}
