#!/usr/bin/env node
// scripts/pmu/grip-navigator.mjs — THE STREAMING ADAPTIVE-APERTURE PICKER NAVIGATOR (operator 2026-07-23:
// "the streaming adaptive aperture picker navigator must be bulletproof").
//
// The whole session's measurement, distilled: gzip-NCD only measures MEANING when the two texts are the
// same SIZE-ORDER (the aperture). pixel+gzip won every A/B because it is size-matched (short prompt vs
// short rule). So the navigator ADAPTS THE APERTURE to the prompt's own size: a thin prompt is matched
// against thin rule text; a fat prompt (a steering thread with momentum) is matched against the fat
// rule+cell context. Same instrument, aperture chosen to fit — never a size-mismatch that measures length
// instead of meaning. Candidates come from the confidence pixel + its in-lane tolerance hull (the walk),
// never a global scan (the C,C magnet dominates a global match). LLM-FREE, deterministic, sub-second.
//
// BULLETPROOF CONTRACT (every path returns a well-formed result, never throws to the caller):
//   empty/degenerate prompt · C,C collapse placement · no rules at the pixel · huge prompt · unicode — all
//   return { ok, center, aperture, picks[], timing, note }, with picks possibly [] but never undefined.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStubSpec, boundaryFromStubSpec } from './prompt-lens.mjs';
import { litTilesAt } from './grip-poster.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
const ncd = (a, b) => { const A = String(a), B = String(b); if (!A || !B) return 1; const ga = gz(A), gb = gz(B), gab = gz(A + '\n' + B); const mx = Math.max(ga, gb); return mx ? (gab - Math.min(ga, gb)) / mx : 1; };
const SN = (() => { try { return JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8')); } catch { return []; } })();
const cellText = (c) => String((SN.find((x) => String(x.coord) === String(c)) || {}).snippet || '');

// THE META-BULK RULE (operator 2026-07-23, measured + immortal): a rule may NEVER be matched as naked text
// — a 6-word string has no mass and is invisible to the aperture, so the gzip math hallucinates. BUNDLE
// BOTH SIDES of the equation with their cell mass (the Actor⊕Patient composed cell at the pixel), so both
// are aperture-sized and the pixel sits at the center of mass. Symmetric fattening restores the mass,
// eliminates the blur (the heavy cell anchors compression to the domain), and DEFINES the aperture equally
// on each side — which is exactly what lets it stream (the eye moves with matched mass on both sides).
// Measured: symmetric prompt+cell vs rule+cell → testing→testing (ncd 0.066), delegation→delegation. The
// asymmetric one-side version (which we kept getting wrong) blurs; this does not.
const bulk = (text, coord) => `${String(text || '')}\n${cellText(coord)}`;   // text ⊕ its cell mass = one aperture-sized payload

export async function navigate(prompt, { cap = 8, min = 8 } = {}) {
  const t0 = Date.now();
  const P = String(prompt || '').trim();
  if (P.length < 3) return { ok: true, center: null, aperture: null, picks: [], timing_ms: Date.now() - t0, note: 'empty/too-short prompt — nothing to navigate (returned cleanly, no throw)' };
  let center = 'C,C', sigma = null, sensor = 'gzip-fallback', walkMs = 0;
  try { const b = await boundaryFromStubSpec(await buildStubSpec(P)); center = b.center || 'C,C'; sigma = b.sigma ?? null; sensor = b.sensor || 'gzip-fallback'; walkMs = b.walkMs ?? 0; }
  catch (e) { /* placement failed → stay at C,C, still return */ }
  // candidates: the confidence pixel + its in-lane tolerance hull (widen from Δ0 only as needed)
  let lit = [];
  try { lit = litTilesAt(center, { radius: 0, min }).lit || []; } catch { lit = []; }
  // THE META-BULK MATCH: bundle the PROMPT with its pixel cell (mass on the prompt side), match against
  // each candidate bundled with ITS cell (mass on the rule side). Both aperture-sized, pixel at center.
  const promptBundle = bulk(P, center);
  // CUT THE EYE (operator 2026-07-23): trim both bundles to a MATCHED aperture window so mass AND density
  // are equal on both sides of the gzip equation — the eye is the same size on each side, which is what
  // lets it stream without a size-mismatch. The window = the smaller of the two bundle sizes.
  const scored = lit.map((tl) => {
    const ruleBundle = bulk(tl.text, tl.coord);
    const eye = Math.min(promptBundle.length, ruleBundle.length);   // the matched aperture window (mass)
    return { tile: tl, ncd: ncd(promptBundle.slice(0, eye), ruleBundle.slice(0, eye)), eye };
  }).sort((a, b) => a.ncd - b.ncd);
  const seen = new Set(); const picks = [];
  for (const s of scored) { const k = String(s.tile.text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 50); if (seen.has(k)) continue; seen.add(k); picks.push({ coord: s.tile.coord, ncd: +s.ncd.toFixed(4), eye: s.eye, source: s.tile.source, text: s.tile.text }); if (picks.length >= cap) break; }
  const eyeMass = picks.length ? picks[0].eye : 0;
  return { ok: true, center, sigma, sensor, aperture: 'meta-bulk', aperture_reason: `both sides bundled with cell mass, eye cut to ${eyeMass}ch (matched mass+density, pixel at center)`, candidates: lit.length, picks, timing_ms: Date.now() - t0, walk_ms: walkMs, note: picks.length ? 'navigated' : 'placed but no rules at this pixel (returned cleanly)' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = process.argv.slice(2).join(' ') || 'write a failing regression test and a ratchet guard';
  const r = await navigate(p);
  console.log(JSON.stringify({ center: r.center, aperture: r.aperture, candidates: r.candidates, timing_ms: r.timing_ms }, null, 1));
  (r.picks || []).forEach((x, i) => console.log(`${i + 1}. ncd ${x.ncd} [${x.coord}] ${String(x.text).replace(/\s+/g, ' ').slice(0, 70)}`));
}
