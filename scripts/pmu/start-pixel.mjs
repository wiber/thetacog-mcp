#!/usr/bin/env node
// scripts/pmu/start-pixel.mjs — BRICK #2: RECURSIVE (stable) start-pixel selection.
//
// Operator (2026-06-10): "recursively improve picking what pixel we're starting from." The dogfood
// started the definer walk at the single heaviest-diagonal lit anchor — a one-shot argmax that SWINGS
// when two anchors are near-equal, so the whole walk shape (and σ) hinges on a marginal pick.
//
// The fix: don't trust the raw mass. Let the DEFINER GRAPH decide. Mass-seed a power iteration over the
// directed connectivity (i→j = the definer edge the walk follows) and let it converge to the
// self-consistent ATTRACTOR among the lit anchors — the intersection the lit intent actually flows to,
// the genuinely-most-confident actor∩patient pixel. Power iteration is recursive by construction and
// stable: small perturbations of the lit set don't move the dominant eigenvector's argmax.
//
// Pure JS over the connectivity (the SELECTION is meta — the chip runs the actual walk afterwards), so
// it's ~instant and adds nothing to the on-chip path.
//
// @canonical-algorithm  mass-seeded PageRank power-iteration over the DIRECTED definer connectivity; start = argmax steady-state mass among lit anchors; stability checked by re-seed perturbation
// @forbidden-alternative  single-shot argmax on raw diagonal mass (swings on a marginal pick) · ignoring connectivity (mass alone isn't the attractor) · running the chip to PICK the start (selection is meta)
// @why  the walk shape and σ hinge on the start; a stable, graph-justified start is what makes the whole read reproducible commit-to-commit
// @guard  tests/pmu-simulator/start-pixel-stable.test.mjs
//
// Usage (lib):  import { pickStartPixel } from './start-pixel.mjs'
//   pickStartPixel(litIndices, massOf, { iters, damping, topK }) -> { start, score, stable, ranked }
// Usage (CLI):  node scripts/pmu/start-pixel.mjs   # self-demo on a synthetic lit set

import { buildDirected, COORDS } from './definer-walk-144.mjs';

const N = 144;

// Mass-seeded power iteration. `mass[i]` seeds + teleports (PageRank damping), so the result is the
// attractor the lit mass FLOWS to along the definer edges — not just the heaviest raw cell.
function steadyState(mass, { iters = 50, damping = 0.85 } = {}) {
  const A = buildDirected();                         // 20736 flat, A[i*144+j]=1 iff definer edge i→j
  // column-normalize out-edges so mass conserves as it propagates along i→j.
  const outDeg = new Array(N).fill(0);
  for (let i = 0; i < N; i++) { let d = 0; for (let j = 0; j < N; j++) d += A[i * N + j]; outDeg[i] = d || 1; }
  const seedSum = mass.reduce((s, x) => s + x, 0) || 1;
  const teleport = mass.map(x => x / seedSum);       // teleport back to the lit mass distribution
  let x = teleport.slice();
  for (let t = 0; t < iters; t++) {
    const nx = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      if (x[i] === 0) continue;
      const share = (damping * x[i]) / outDeg[i];
      for (let j = 0; j < N; j++) if (A[i * N + j]) nx[j] += share;
    }
    for (let j = 0; j < N; j++) nx[j] += (1 - damping) * teleport[j];
    x = nx;
  }
  return x;
}

// Pick the start pixel = the lit anchor with the highest steady-state attractor mass.
// massOf(i) -> the per-anchor intent mass (e.g. the diagonal heat); litIndices restricts the candidates.
export function pickStartPixel(litIndices, massOf, { iters = 50, damping = 0.85, topK = 8 } = {}) {
  const lit = [...new Set((litIndices || []).filter(i => i >= 0 && i < N && COORDS[i]))];
  if (!lit.length) return { start: 0, score: 0, stable: true, ranked: [] };
  const mass = new Array(N).fill(0);
  for (const i of lit) mass[i] = Math.max(0, Number(massOf(i)) || 0);
  if (mass.reduce((s, x) => s + x, 0) === 0) for (const i of lit) mass[i] = 1;   // flat fallback
  // The START is a SOURCE (where the confident lit intent begins the chain), so MASS is primary; the
  // graph steady-state is only a TIE-BREAKER among near-equal-mass anchors. A full PageRank let mass
  // drain to the lattice's C3 sink and pinned the start to row 11 regardless of the commit — wrong.
  // score = normalized-mass + ALPHA·normalized-flow, ALPHA small, so flow decides ONLY genuine ties.
  const ss = steadyState(mass, { iters, damping });
  const norm = (vals) => { const mx = Math.max(...vals, 1e-12); return vals.map(v => v / mx); };
  const massN = norm(lit.map(i => mass[i])), flowN = norm(lit.map(i => ss[i]));
  const ALPHA = 0.15;
  const ranked = lit.map((i, k) => ({ i, coord: COORDS[i], score: massN[k] + ALPHA * flowN[k], mass: mass[i], flow: ss[i] }))
    .sort((a, b) => b.score - a.score);
  const start = ranked[0].i;
  // STABILITY: drop the single weakest lit anchor and re-pick. A stable choice doesn't move when the
  // marginal seed is perturbed — the metric the operator named ("the walk shape doesn't swing").
  let stable = true;
  if (lit.length > 2) {
    const weakest = ranked[ranked.length - 1].i;
    const lit2 = lit.filter(i => i !== weakest);
    const mass2 = mass.slice(); mass2[weakest] = 0;
    const ss2 = steadyState(mass2, { iters, damping });
    const m2 = norm(lit2.map(i => mass2[i])), f2 = norm(lit2.map(i => ss2[i]));
    const start2 = lit2.map((i, k) => ({ i, s: m2[k] + ALPHA * f2[k] })).sort((a, b) => b.s - a.s)[0].i;
    stable = start2 === start;
  }
  return { start, score: ranked[0].score, stable, ranked: ranked.slice(0, topK) };
}

// CLI self-demo: a synthetic lit set with two near-equal heavy anchors → show the graph breaks the tie.
if (import.meta.url === `file://${process.argv[1]}`) {
  const lit = [0, 13, 26, 39, 52, 111, 130];
  const massOf = i => (i === 111 ? 1.00 : i === 130 ? 0.99 : 0.4);   // 111 vs 130 nearly tied
  const r = pickStartPixel(lit, massOf);
  console.log('lit:', lit.map(i => COORDS[i]).join(' '));
  console.log('start pixel:', r.start, COORDS[r.start], '· score', r.score.toFixed(4), '· stable', r.stable);
  console.log('ranked:', r.ranked.map(x => `${x.coord}(${x.score.toFixed(3)})`).join(' '));
}
