#!/usr/bin/env node
// scripts/vna/mesh.mjs — THE NET: where it catches, where the water falls through.
//
// Operator: "you are stringing a high-tension, highly distinctive semantic net across the problem
// space … for the water to stick, the net must be structurally matched to the exact granularity of
// the domain. If the net is too coarse, the water falls through."
//
// So the net is not a metaphor here, it is a measurement. The STRANDS are the declared items, each
// placed at a lattice coordinate with a MARGIN — how distinctive that declaration is against its
// nearest rival. The WATER is the execution mass: commits, placed by the same instrument. And the
// three failures the operator named are each a different measured thing, which is the whole reason
// to compute them separately:
//
//   HOLE  — mass landed and no strand is within the fence. The net is too WIDE here.
//   THIN  — a strand exists and its margin is below the calibrated floor. It is too INDISTINCT to
//           catch anything: the placer itself refused to stand behind that coordinate.
//   SLACK — a strand with no mass on it. Not a defect. Either work that has not happened yet, or a
//           declaration nobody is going to honour, and only the operator can say which.
//
// MESH SIZE IS THE HEADLINE NUMBER: the median distance, in blocks, from where the water lands to
// the nearest strand. A net whose mesh is wider than its fence is a net the water falls through, and
// that is a property of the DECLARATION, not of the work — which is exactly why the two arms exist.
//
// IT COMPUTES NO PLACEMENT. Every coordinate here was placed by envelope.mjs, which placed it with
// the chip. This reads that receipt and measures the geometry between the placements.
//
// @guard tests/vna/mesh.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const ENV = resolve(REPO, 'data/vna/envelope.json');
const OUT = resolve(REPO, 'data/vna/mesh.json');

const AXL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const LANE = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
// ALWAYS EXPAND COORDINATE LABELS: a bare "C2,A1" is opaque, and the expansion is the reasoning
// material — it is what makes a hole a sentence rather than a cell reference.
export const fullName = (c) => {
  const m = /^([A-C][1-3]?),([A-C][1-3]?)$/.exec(String(c || '').trim());
  return m ? `${m[1]}.${LANE[m[1]]} × ${m[2]}.${LANE[m[2]]}` : String(c || '');
};
const block = (c) => {
  const m = /^([A-C])([1-3])?,([A-C])([1-3])?$/.exec(String(c || '').trim());
  return m ? [('ABC'.indexOf(m[1])) * 3 + (m[2] ? +m[2] - 1 : 1), ('ABC'.indexOf(m[3])) * 3 + (m[4] ? +m[4] - 1 : 1)] : null;
};
// Chebyshev, because the lattice's fence is a BOX (the lens carries `boundary.box`), not a circle.
// Using Euclidean here would disagree with the fence every instrument downstream already uses.
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

// ── TIME × TIME — the tier IS a horizon, and naming it is what makes a coordinate a diagnosis ──
// Operator: "Strategy (A) is the long term, Operations (C) the medium, Tactics (B) the short." So a
// coordinate is an intersection of two time horizons, and a bleed between tiers is readable without
// looking at a line of code: intent locked long-term while mass lands short-term means kinetic
// energy is being spent on something that needs an architectural law.
//
// THE LATTICE IS NOT REORDERED, and that is deliberate. Temporal order is A → C → B; ShortLex order
// is A → B → C, and ShortLex is the ADDRESS every downstream consumer keys on. Re-sorting the grid
// to read as a timeline would silently repoint every receipt, every fence and every stored
// coordinate. The horizon is a LABEL on the tier, never a new ordering.
export const HORIZON = { A: 'long', B: 'short', C: 'medium' };
const tierOf = (c) => (String(c || '')[0] || '').toUpperCase();

// The bleed is measured on the ACTOR tier of each placement — the lane the work is acting FROM.
export function horizons(decl, work) {
  const tally = (items) => {
    const out = { long: 0, short: 0, medium: 0, n: 0 };
    for (const it of items) {
      const h = HORIZON[tierOf(it.coord)];
      if (!h) continue;
      out[h] += 1; out.n += 1;
    }
    return out;
  };
  const d = tally(decl), w = tally(work);
  const pct = (t, k) => (t.n ? Math.round((1000 * t[k]) / t.n) / 10 : null);
  const dominant = (t) => (t.n ? ['long', 'medium', 'short'].sort((a, b) => t[b] - t[a])[0] : null);
  const dh = dominant(d), wh = dominant(w);
  return {
    declared: { ...d, dominant: dh, longPct: pct(d, 'long'), mediumPct: pct(d, 'medium'), shortPct: pct(d, 'short') },
    work: { ...w, dominant: wh, longPct: pct(w, 'long'), mediumPct: pct(w, 'medium'), shortPct: pct(w, 'short') },
    bleeding: !!dh && !!wh && dh !== wh,
    // The sentence a reader can act on, or an honest refusal to make one. It states the horizons and
    // stops: what the work SHOULD be is the operator's call and the two arms are where he makes it.
    sentence: !dh || !wh
      ? 'UNMEASURED — not enough placed declarations or placed work to compare horizons'
      : dh === wh
        ? `Declaration and work are both ${dh}-term (${pct(d, dh)}% / ${pct(w, wh)}%) — the horizons agree.`
        : `Declaration is mostly ${dh}-term (${pct(d, dh)}%) and the work is landing ${wh}-term (${pct(w, wh)}%) — ${wh === 'short' && dh === 'long' ? 'kinetic energy spent on something declared as an invariant' : `${wh}-horizon mass against a ${dh}-horizon declaration`}.`,
  };
}

export function mesh({ envelope } = {}) {
  const e = envelope || (existsSync(ENV) ? JSON.parse(readFileSync(ENV, 'utf8')) : null);
  if (!e) return { missing: true, cmd: 'node scripts/vna/envelope.mjs' };

  const fence = e.fence ?? 2;
  const floor = e.floor ?? 0;
  // A STRAND IS A DECLARATION THE PLACER STOOD BEHIND. An abstained item is listed as THIN rather
  // than as a strand: counting it would let an indistinct declaration take credit for catching mass
  // it could not have caught, which is the net measuring itself as tighter than it is.
  const strands = (e.confident || []).filter((c) => block(c.coord)).map((c) => ({ id: c.id, coord: c.coord, margin: c.margin, b: block(c.coord) }));
  const thin = (e.abstained || []).map((c) => ({ id: c.id, coord: c.coord || null, margin: c.margin ?? null }));
  const water = (e.work || []).filter((w) => block(w.coord)).map((w) => ({ sha: w.sha, coord: w.coord, sigma: w.sigma, b: block(w.coord) }));

  const drops = water.map((w) => {
    let best = null;
    for (const s of strands) {
      const d = dist(w.b, s.b);
      if (!best || d < best.d) best = { d, id: s.id, coord: s.coord };
    }
    return { ...w, nearest: best, caught: !!best && best.d <= fence };
  });

  const holes = new Map();
  for (const d of drops.filter((x) => !x.caught)) {
    const k = d.coord;
    const h = holes.get(k) || { coord: k, name: fullName(k), n: 0, shas: [], nearest: d.nearest };
    h.n += 1; if (h.shas.length < 6) h.shas.push(d.sha);
    holes.set(k, h);
  }
  const slack = strands.filter((s) => !drops.some((d) => dist(d.b, s.b) <= fence))
    .map((s) => ({ id: s.id, coord: s.coord, name: fullName(s.coord) }));

  const gaps = drops.filter((d) => d.nearest).map((d) => d.nearest.d).sort((a, b) => a - b);
  const meshSize = gaps.length ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2) : null;

  const horizon = horizons(strands.map((x) => ({ coord: x.coord })), water.map((x) => ({ coord: x.coord })));

  return {
    at: new Date().toISOString(), fence, floor, horizon,
    strands: strands.length, thin, water: water.length,
    caught: drops.filter((d) => d.caught).length,
    // The headline: how far the water falls before it meets a strand. Null when there is nothing to
    // measure — never zero, which would read as a perfect net over an empty lattice.
    meshSize,
    coveragePct: drops.length ? Math.round((1000 * drops.filter((d) => d.caught).length) / drops.length) / 10 : null,
    holes: [...holes.values()].sort((a, b) => b.n - a.n),
    slack,
    verdict: meshSize == null ? 'UNMEASURED — no placed work in the window'
      : meshSize > fence ? `TOO WIDE — the water lands ${meshSize} blocks from the nearest strand and the fence is ${fence}`
      : 'holding — the mass is landing inside the declared fence',
  };
}

export function meshText(m) {
  if (m.missing) return `not run — ${m.cmd}`;
  const l = [
    `# THE NET — ${m.strands} strand(s), ${m.water} drop(s), fence ${m.fence}`,
    `# TIME × TIME — ${m.horizon?.sentence || 'UNMEASURED'}`,
    `mesh size ${m.meshSize ?? 'UNMEASURED'} blocks · caught ${m.caught}/${m.water}${m.coveragePct != null ? ` (${m.coveragePct}%)` : ''} · ${m.verdict}`,
  ];
  if (m.holes.length) {
    l.push('', `## HOLES — mass landed with no strand inside the fence (the net is too wide here)`);
    for (const h of m.holes.slice(0, 8)) l.push(`  ${h.name} — ${h.n} commit(s)${h.nearest ? ` · nearest strand ${h.nearest.id} at ${h.nearest.d} blocks` : ' · no strand anywhere'}`);
  }
  if (m.thin.length) {
    l.push('', `## THIN — declared, but not distinctive enough to catch anything (margin below ${m.floor})`);
    for (const t of m.thin.slice(0, 8)) l.push(`  ${t.id} — margin ${t.margin != null ? t.margin.toFixed(5) : '—'}`);
  }
  if (m.slack.length) {
    l.push('', `## SLACK — a strand with no mass on it (work not yet done, or a declaration nobody will honour)`);
    for (const s of m.slack.slice(0, 8)) l.push(`  ${s.id} — ${s.name}`);
  }
  return l.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = mesh();
  if (!m.missing) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(m, null, 2)); }
  console.log(meshText(m));
  if (!m.missing) console.log(`\nreceipt → data/vna/mesh.json`);
}
