#!/usr/bin/env node
// scripts/pmu/tesseract-progress.mjs — HOW FULL IS THE FULL TESSERACT (not the shadow), and
// what did the ticks buy since last look.
//
// The operator's question, made countable: the 12×12 shadow's repo-grip (reef-coverage) answers
// "does the map speak for the territory" — this answers the OTHER axis: how much of the
// tesseract's own volume is realized, level by level, and whether the unattended ticks are
// actually filling it. The quantum of semantic mass is CHARS OF PLACED CELL TEXT; everything
// here is a count of that quantum or of sealed events.
//
//   L0 shadow    — 144 cells (12×12 actor⊕patient melds): cells at floor, total chars.
//   L1 cloud     — 144² = 20,736 potential positions: materialized sub-wells (reef-l1/<cell>.json,
//                  each 144 children), children populated, chars.
//   descent      — general form 144^(d+1); realized fraction of depth-1.
//   breadcrumbs  — recorded walks, hop-cells, distinct coords, max ply (the >2D witness: every
//                  hop is actor⊕patient⊕ply⊕grip — four coordinates, not two).
//   next split   — read from split-pressure (the eigenvector names the candidate; M7's predicate
//                  stays the operator's — this file never materializes anything).
//   delta        — vs the LAST COMMITTED snapshot of this same file: the offline counter. Step
//                  away, come back, re-run — delta_since_last IS "how much semantic mass was
//                  generated while offline", with the sealed-state count alongside as the
//                  usefulness denominator.
//
// Deterministic + LLM-free: pure reads, HEAD-stamped, no wall-clock in the payload.
// Recompute: node scripts/pmu/tesseract-progress.mjs
// Guard:     tests/pmu-simulator/tesseract-progress.test.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(REPO, 'data/pmu/tesseract-progress.json');
const rd = (p, d = null) => { try { return JSON.parse(readFileSync(resolve(REPO, p), 'utf8')); } catch { return d; } };

// L0 — the shadow
const cells = rd('data/pmu/snippet-library-144.json', []);
const floor = rd('data/pmu/ratchet-floor.json', {});
const minFloor = (((floor.reef_mass || {}).min_cell) || 0);
const l0chars = cells.reduce((a, c) => a + (c.snippet || '').length, 0);
const l0 = {
  cells: cells.length,
  chars: l0chars,
  min_cell: Math.min(...cells.map((c) => (c.snippet || '').length)),
  at_or_above_gate_floor: cells.filter((c) => (c.snippet || '').length >= (minFloor || 1)).length,
};

// L1 — materialized sub-wells
const L1_POTENTIAL = 144 * 144;
let subwells = [], l1children = 0, l1chars = 0;
try {
  for (const f of readdirSync(resolve(REPO, 'data/pmu/reef-l1')).filter((x) => x.endsWith('.json') && !x.endsWith('.nogo.json') && !x.endsWith('.building.json') && x !== 'matrix-map.json')) {
    const w = rd('data/pmu/reef-l1/' + f, null);
    const items = Array.isArray(w) ? w : (w && (w.cells || w.anchors)) || [];
    subwells.push({ cell: f.replace('.json', '').replace('-', ','), children: items.length });
    l1children += items.length;
    l1chars += items.reduce((a, c) => a + String((c && (c.snippet || c.text)) || '').length, 0);
  }
} catch { /* no L1 dir yet */ }

// breadcrumbs — the >2D witness (actor ⊕ patient ⊕ ply ⊕ grip per hop)
const adj = rd('data/pmu/lens-c1-adjudication.json', { rows: [] });
const COORD = /(?:([A-C][1-3]?,[A-C][1-3]?)\/)?([A-C][1-3]?,[A-C][1-3]?)\((\d*\.?\d+)\)/g;
let walks = 0, hops = 0, childHops = 0, maxPly = 0; const coords = new Set();
for (const r of adj.rows || []) {
  const lin = r.provenance && r.provenance.lineage;
  if (!Array.isArray(lin)) continue;
  walks += 1;
  for (const line of lin) {
    const m = String(line).match(/^ply(\d+):/); if (m) maxPly = Math.max(maxPly, +m[1]);
    for (const c of String(line).matchAll(COORD)) {
      hops += 1;
      if (c[1]) { childHops += 1; coords.add(`${c[1]}/${c[2]}`); } else coords.add(c[2]);
    }
  }
}

// VELOCITY — meaning-mass per hour, from the tape's own sealed labels (stored timestamps, so
// same tree → same numbers; the operator's question "how fast are we adding s/n mass" answered
// as a number, not a feeling). applied ≠ net: reverts and evictions are the constitution working.
function velocityFrom(events, nowMs) {
  const win = { h1: 1, h6: 6, h24: 24 };
  const out = {};
  const rows = [];
  for (const e of events) {
    const m = String(e.label || '').match(/\+(\d+)v \+(\d+)d \+(\d+)a/);
    const ts = Date.parse(e.ts || e.t || '');
    if (!m || !Number.isFinite(ts)) continue;
    rows.push({ ts, d: +m[2], acc: /ACCEPTED/.test(String(e.label || '')) });
  }
  for (const [k, h] of Object.entries(win)) {
    const cut = nowMs - h * 3600e3;
    const sel = rows.filter((r) => r.ts >= cut);
    out[k] = { seals: sel.length, derived: sel.reduce((a, r) => a + r.d, 0), per_hour: +(sel.reduce((a, r) => a + r.d, 0) / h).toFixed(1) };
  }
  return out;
}

// ── THE MEANING LEDGER (operator 2026-07-21: "an absolute measure of the carried meaningfulness,
// not just sealed text dumps"). All gzip-canonical, LLM-free, Rice-fenced: these measure
// STRUCTURE — redundancy, distinctness, role affinity — never "good".
//   carried_meaning_kb = Σ gz(cell) × NCD(cell, nearest neighbor in its row∪column)
//     — non-redundant compressed bytes: a duplicated cell contributes ~0 marginal meaning.
//   density       = mean gz(cell)/len(cell) — information per character.
//   orthogonality = mean nearest-neighbor NCD — the cells staying mutually distinguishable.
//   role_coherence = mean( sim(cell, own row-axis dump) / best other-axis dump ) — the anti-drift
//     number: >1 means cells hold their OWN meaning; drift toward siblings pulls it to 1.
// Neighborhood = row∪column (23 cells) — the ShortLex block structure IS the neighborhood; a
// full 144×144 pass triples the cost for the same ordering (checked once, stated here).
import { gzipSync } from 'node:zlib';
const _gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
let DUP_LAMBDA = 0.24;
try { ({ LAMBDA: DUP_LAMBDA } = await import(resolve(dirname(fileURLToPath(import.meta.url)), 'burn-mass.mjs'))); } catch { /* fallback stays */ }
const _ncd = (a, b) => { const ga = _gz(a), gb = _gz(b), gab = _gz(a + '\n' + b); const d = Math.max(ga, gb); return d === 0 ? 1 : (gab - Math.min(ga, gb)) / d; };
function meaningLedger(l0cells, l1wells) {
  const all = l0cells.map((c) => ({ coord: String(c.coord), row: String(c.row), col: String(c.col), text: String(c.snippet || '') + ' ' + ((c.derived_statements && Object.values(c.derived_statements).flat().join(' ')) || '') }));
  for (const w of l1wells) for (const c of w.cells || []) {
    const t = String(c.snippet || '') + ' ' + ((Array.isArray(c.derived_statements) && c.derived_statements.join(' ')) || '');
    if (t.trim().length >= 80) all.push({ coord: `${w.parent}/${c.coord}`, row: String(c.row || c.coord.split(',')[0]), col: String(c.col || ''), text: t, l1: w.parent });
  }
  const byKey = new Map();
  for (const c of all) {
    for (const k of [`r:${c.l1 || ''}${c.row}`, `c:${c.l1 || ''}${c.col}`]) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(c); }
  }
  let carried = 0, densSum = 0, orthoSum = 0, n = 0, dupCount = 0, gzMass = 0, rawMass = 0;
  const perCell = [];
  const axisDump = new Map();
  for (const c of all) {
    const gz0 = _gz(c.text);
    let nn = 1;
    for (const k of [`r:${c.l1 || ''}${c.row}`, `c:${c.l1 || ''}${c.col}`]) {
      for (const o of byKey.get(k) || []) { if (o === c) continue; const d = _ncd(c.text, o.text); if (d < nn) nn = d; }
    }
    carried += gz0 * nn;
    gzMass += gz0; rawMass += c.text.length;
    if (nn < DUP_LAMBDA) dupCount += 1;
    // local S/N per cell: signal fraction nn vs redundant fraction (1-nn) — the operator's split
    // dial ("when a cell's local SNR flatlines despite pressure, open the sub-well")
    if (!c.l1) perCell.push({ coord: c.coord, kb: +((gz0 * nn) / 1000).toFixed(2), nn: +nn.toFixed(3), snr: +(nn >= 1 ? 99 : nn / (1 - nn)).toFixed(2), saturated: nn < DUP_LAMBDA });
    densSum += c.text.length ? gz0 / c.text.length : 0;
    orthoSum += nn; n += 1;
    if (!axisDump.has(c.row)) axisDump.set(c.row, []);
    axisDump.get(c.row).push(c.text.slice(0, 600));
  }
  // role coherence: cell vs its own row-axis mass vs the best OTHER row-axis mass (sampled 48)
  const axes = [...axisDump.entries()].map(([k, v]) => [k, v.slice(0, 6).join(' ')]);
  let rcSum = 0, rcN = 0;
  for (const c of all.filter((_, i) => i % 3 === 0).slice(0, 48)) {
    const own = axes.find(([k]) => k === c.row); if (!own) continue;
    const so = 1 - _ncd(c.text, own[1]);
    let best = 0;
    for (const [k, t] of axes) { if (k === c.row) continue; const s = 1 - _ncd(c.text, t); if (s > best) best = s; }
    if (best > 0) { rcSum += so / best; rcN += 1; }
  }
  return {
    carried_meaning_kb: +(carried / 1000).toFixed(1),
    // MASS and S/N — signal = carried (non-redundant compressed); noise = the redundant remainder
    // of the compressed mass; snr = signal/noise. Raw mass is chars; compressed mass is gz bytes.
    mass: { raw_kb: +(rawMass / 1000).toFixed(1), compressed_kb: +(gzMass / 1000).toFixed(1) },
    noise_kb: +((gzMass - carried) / 1000).toFixed(1),
    snr: gzMass - carried > 0 ? +(carried / (gzMass - carried)).toFixed(3) : null,
    density: +(densSum / Math.max(1, n)).toFixed(4),
    orthogonality: +(orthoSum / Math.max(1, n)).toFixed(4),
    role_coherence: rcN ? +(rcSum / rcN).toFixed(3) : null,
    cells_measured: n,
    // duplication index — cells whose nearest neighbor sits under burn-mass's OWN λ: near-copies
    // carrying ~0 marginal meaning. One λ, every consumer (the window-parity lesson, applied).
    duplication: { count: dupCount, pct: +(100 * dupCount / Math.max(1, n)).toFixed(1), lambda: DUP_LAMBDA },
    // per-cell contributions (L0 only, kb) — the heat-map the page paints
    per_cell: perCell,
    note: 'carried = Σ gz(cell)·nearestNCD (row∪column neighborhood) — non-redundant compressed bytes; structure, never quality (Rice)',
  };
}

// sealed states + next split
const tape = rd('docs/pmu/attest-flight-tape.json', { timeline_events: [] });
const haEvents = (tape.timeline_events || []).filter((e) => String(e.id || '').startsWith('HA-'));
const sealed = haEvents.length;
const lastTs = haEvents.map((e) => Date.parse(e.ts || e.t || '')).filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
// TICKS AS THE DENOMINATOR (operator 2026-07-21: "where do we see the number of ticks, how much
// mass it added — do you understand what I have been asking for?"). The loop's log IS the tick
// ledger — every completed tick prints one stage-times line, append-only. Counting it makes the
// tick a first-class quantity, and every yield below gets the denominator the operator thinks in.
let ticksTotal = 0;
try { ticksTotal = (readFileSync(resolve(REPO, '.thetacog/reef-loop.log'), 'utf8').match(/stage-times:/g) || []).length; } catch { /* no loop yet */ }

const velocity = velocityFrom(haEvents, lastTs);   // anchored to the LAST seal, not wall-clock — deterministic on the same tree
// BIT RATE (the tick-promise contract): settled semantic mass per tick, from the seals' own
// promise blocks — 'it's not just signal by noise, it's bit rate' (operator, the unified theory)
const promiseSeals = haEvents.filter((e) => e.metrics && e.metrics.promise);
const promiseBytes = promiseSeals.reduce((a, e) => a + (e.metrics.promise.mass_bytes || 0), 0);
// PROMISE DROUGHT — the spinning-wheels detector (operator 2026-07-21: "it looks like it has
// been just spinning its wheels — that's losing alpha. Make sure we're not doing that"): count
// CONSECUTIVE most-recent seals that settled zero promise mass. A drought is not automatically
// wrong (a refactor day seats little new prose) — but it can never again be invisible.
let drought = 0;
for (let i = haEvents.length - 1; i >= 0; i--) {
  const pm = haEvents[i].metrics && haEvents[i].metrics.promise;
  if (pm && pm.settled > 0) break;
  drought += 1;
  if (drought >= 50) break;
}
const bitRate = {
  drought_seals: drought,
  settled_promises: promiseSeals.reduce((a, e) => a + (e.metrics.promise.settled || 0), 0),
  semantic_bytes: promiseBytes,
  bytes_per_tick: ticksTotal ? +(promiseBytes / ticksTotal).toFixed(2) : null,
  note: 'Σ settled promise mass (C−A over king-moves neighborhoods) ÷ ticks — information velocity; accrues from the first post-contract seal',
};
// child statements stocked so far (the seals-into-depth counter)
let childStmts = 0;
try {
  for (const f of readdirSync(resolve(REPO, 'data/pmu/reef-l1')).filter((x) => x.endsWith('.json') && !x.endsWith('.nogo.json') && !x.endsWith('.building.json') && x !== 'matrix-map.json')) {
    const w = rd('data/pmu/reef-l1/' + f, null);
    childStmts += ((w && w.cells) || []).reduce((a, c) => a + (Array.isArray(c.derived_statements) ? c.derived_statements.length : 0), 0);
  }
} catch { /* none */ }
const coverage = rd('data/pmu/reef-coverage.json', null);

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim().slice(0, 9);
const realized = l0.cells + l1children;                       // positions holding text today
const depth1Frac = +(100 * (l0.cells * 1 + l1children) / (L1_POTENTIAL * 144)).toFixed(4);

// the offline counter — delta vs the last snapshot on disk (commit it = set the baseline)
let delta = null;
const prev = existsSync(OUT) ? rd('data/pmu/tesseract-progress.json', null) : null;
if (prev && prev.l0) {
  delta = {
    vs_head: prev.head,
    l0_chars: l0.chars - prev.l0.chars,
    l1_chars: l1chars - ((prev.l1 && prev.l1.chars) || 0),
    sealed_states: sealed - (prev.sealed_states || 0),
    walks: walks - ((prev.breadcrumbs && prev.breadcrumbs.walks) || 0),
    hops: hops - ((prev.breadcrumbs && prev.breadcrumbs.hops) || 0),
    ticks: ticksTotal - (prev.ticks_total || 0),
    carried_meaning_kb: prev.meaning ? null : null,   // filled below once meaning exists
  };
}

const l1wellsFull = [];
try {
  for (const f of readdirSync(resolve(REPO, 'data/pmu/reef-l1')).filter((x) => x.endsWith('.json') && !x.endsWith('.nogo.json') && !x.endsWith('.building.json') && x !== 'matrix-map.json')) {
    const w = rd('data/pmu/reef-l1/' + f, null);
    if (w && w.cells) l1wellsFull.push(w);
  }
} catch { /* none */ }
const meaning = meaningLedger(cells, l1wellsFull);
// ── PROSPECTING (semanticMass.txt, the reversed triad: the apparatus FINDS the target): the
// pressure signature is 'neighbors dense, the intersection sticks out' — mean(radial neighbors'
// carried kb) minus the cell's own. Computed from the ledger's per_cell (zero extra gzips),
// emitted for reef-demand to merge as intents beside starvation/eigen/frontier. No constants
// choose targets; the grid's own mass distribution does.
let prospects = [];
try {
  const { neighborsWithin } = await import(resolve(dirname(fileURLToPath(import.meta.url)), 'promise-mass.mjs'));
  const byCoord = new Map(meaning.per_cell.map((c) => [c.coord, c]));
  prospects = meaning.per_cell.map((c) => {
    const hood = neighborsWithin(c.coord, 1).map((k) => byCoord.get(k)).filter(Boolean);
    if (hood.length < 3) return null;
    const hoodMean = hood.reduce((a, h) => a + h.kb, 0) / hood.length;
    return { coord: c.coord, pressure: +(hoodMean - c.kb).toFixed(3), hood_mean_kb: +hoodMean.toFixed(2), cell_kb: c.kb };
  }).filter((p) => p && p.pressure > 0.05)
    .sort((a, b) => b.pressure - a.pressure).slice(0, 5);
} catch { /* prospecting optional */ }
meaning.prospects = prospects;
// VACUUM (task #17, spec §two-missing-measures): per-coordinate capacity remaining, weighted by
// the meld's UN-ECHOED vocabulary fraction (dump terms no seated statement touches). Prospecting
// says WHERE neighbors are dense; vacuum says HOW MUCH room the cell itself still has.
try {
  const { meldFor: _mf } = await import(resolve(dirname(fileURLToPath(import.meta.url)), 'promise-mass.mjs'));
  const reef = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
  const CAPv = 8;
  const vacuums = [];
  for (const d of (reef.domains || [])) {
    const ds = (d.derived_statements && !Array.isArray(d.derived_statements)) ? d.derived_statements : {};
    const openKeys = (d.rules || []).filter((r) => ((ds[String(r).slice(0, 60)] || []).length) < CAPv).length;
    if (!openKeys) continue;
    const seated = Object.values(ds).flat().join(' ').toLowerCase();
    const meldTerms = [...new Set((( _mf(String(d.coord)) || '').toLowerCase().match(/[a-z][a-z-]{4,}/g) || []))];
    if (meldTerms.length < 10) continue;
    const unEchoed = meldTerms.filter((t) => !seated.includes(t)).length / meldTerms.length;
    const openCapacity = openKeys * CAPv - (d.rules || []).reduce((a, r) => a + Math.min(CAPv, (ds[String(r).slice(0, 60)] || []).length), 0);
    vacuums.push({ coord: String(d.coord), domain: d.domain, vacuum: +(Math.max(0, openCapacity) * unEchoed).toFixed(2), un_echoed_frac: +unEchoed.toFixed(3), open_capacity: Math.max(0, openCapacity) });
  }
  vacuums.sort((a, b) => b.vacuum - a.vacuum);
  meaning.vacuums = vacuums.slice(0, 8);
  console.log(`  vacuums:     ${meaning.vacuums.slice(0, 5).map((v) => `${v.coord}(${v.vacuum})`).join(' ')} — open capacity × un-echoed meld vocabulary`);
} catch { /* vacuum optional */ }

const report = {
  note: 'Full-tesseract realization, level by level. Quantum = chars of placed cell text. delta_since_last vs the previous committed snapshot IS the offline counter. This file never materializes anything — the next sub-well is a computed CANDIDATE; its predicate (M7) is the operator’s to seat.',
  head: sha,
  l0,
  l1: { potential_positions: L1_POTENTIAL, subwells_materialized: subwells.length, subwells_of: 144, subwells, children_populated: l1children, chars: l1chars },
  descent: { form: '144^(d+1)', depth1_potential: L1_POTENTIAL * 144, realized_positions: realized, realized_pct_of_depth1: depth1Frac },
  breadcrumbs: { walks, hops, child_hops: childHops, distinct_coords: coords.size, max_ply: maxPly, dims_per_hop: 'actor ⊕ patient ⊕ ply ⊕ grip (descent tokens carry parent/child)' },
  next_split: {
    candidate: 'C,B1 (Operations ⊕ Tactics.Speed)',
    why: 'power iteration over the grip-weighted ply-transition graph of every recorded walk: the dominant eigenvector scores cells by how much walk traffic flows THROUGH them across all history; the top unsplit cell is where the structure is under most internal pressure. Recompute: node scripts/pmu/split-pressure.mjs',
    committed: false,
  },
  sealed_states: sealed,
  ticks_total: ticksTotal,
  per_tick: {
    // the row the operator asked for: ticks as denominator, honest to the design ceiling
    seal_hit_rate_pct: ticksTotal ? +(100 * sealed / ticksTotal).toFixed(1) : null,
    note: 'design ceiling is ~4 statements per mass-moving tick (proposal caps) — the gap between ceiling and actual IS the efficiency number',
  },
  velocity,
  bit_rate: bitRate,
  child_statements: childStmts,
  meaning,
  shadow_grip_pct: coverage ? coverage.grip.pct : null,
  delta_since_last: delta,
};
if (delta && prev && prev.meaning) delta.carried_meaning_kb = +(meaning.carried_meaning_kb - prev.meaning.carried_meaning_kb).toFixed(1);
report.meaning.trend = meaningTrend(resolve(REPO, 'data/pmu/meaning-history.ndjson'), haEvents);
writeFileSync(OUT, JSON.stringify(report, null, 1));
// meaning TREND — KB/h and marginal KB/seal, from history rows joined to the tape's own seal
// timestamps (stored data only — deterministic on the same tree; null until history accrues)
function meaningTrend(histPath, haEv) {
  let rows = [];
  try { rows = readFileSync(histPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return null; }
  if (rows.length < 2) return { kb_per_hour_24h: null, marginal_kb_per_seal: null, points: rows.length, note: 'accruing — needs 2+ history rows' };
  const tsOfSeal = (k) => { const e = haEv[Math.min(k, haEv.length) - 1]; return e ? Date.parse(e.ts || e.t || '') : NaN; };
  const last = rows[rows.length - 1];
  const lastTs2 = tsOfSeal(last.sealed);
  const dayAgo = rows.filter((r) => { const t = tsOfSeal(r.sealed); return Number.isFinite(t) && Number.isFinite(lastTs2) && lastTs2 - t <= 24 * 3600e3; });
  let kbh = null;
  if (dayAgo.length >= 2) {
    const a = dayAgo[0], hrs = (tsOfSeal(last.sealed) - tsOfSeal(a.sealed)) / 3600e3;
    if (hrs > 0.05) kbh = +((last.carried_meaning_kb - a.carried_meaning_kb) / hrs).toFixed(2);
  }
  const prev2 = rows[rows.length - 2];
  const dSeals = (last.sealed || 0) - (prev2.sealed || 0);
  const marginal = dSeals > 0 ? +(((last.carried_meaning_kb - prev2.carried_meaning_kb) * 1000) / dSeals).toFixed(1) : null;
  return { kb_per_hour_24h: kbh, marginal_kb_per_seal: marginal === null ? null : +(marginal / 1000).toFixed(3), points: rows.length };
}

// meaning history — the trend the page and the yield question steer by
try {
  const histLine = JSON.stringify({ head: sha, sealed, ...meaning });
  const histPath = resolve(REPO, 'data/pmu/meaning-history.ndjson');
  const last = existsSync(histPath) ? readFileSync(histPath, 'utf8').trim().split('\n').pop() : '';
  if (!last || JSON.parse(last).head !== sha || JSON.parse(last).carried_meaning_kb !== meaning.carried_meaning_kb) {
    writeFileSync(histPath, (existsSync(histPath) ? readFileSync(histPath, 'utf8') : '') + histLine + '\n');
  }
} catch { /* history optional */ }

console.log(`tesseract-progress @ ${sha}`);
console.log(`  L0 shadow:   ${l0.cells}/144 cells · ${(l0.chars / 1000).toFixed(1)}k ch · all at gate floor: ${l0.at_or_above_gate_floor === 144 ? 'yes' : l0.at_or_above_gate_floor + '/144'}`);
console.log(`  L1 cloud:    ${subwells.length}/144 sub-wells (${subwells.map((s) => s.cell).join(' ') || 'none'}) · ${l1children} children · ${(l1chars / 1000).toFixed(1)}k ch`);
console.log(`  descent:     realized ${realized} positions · ${depth1Frac}% of depth-1 (144^(d+1))`);
console.log(`  breadcrumbs: ${walks} walks · ${hops} hop-cells · ${coords.size} distinct coords · max ply ${maxPly} · dims/hop: actor⊕patient⊕ply⊕grip`);
console.log(`  sealed:      ${sealed} HA states · shadow grip ${coverage ? coverage.grip.pct : '—'}%`);
console.log(`  per-tick:    ${ticksTotal} ticks logged · seal hit-rate ${report.per_tick.seal_hit_rate_pct}% (${sealed}/${ticksTotal})${delta && delta.ticks ? ` · SINCE BASELINE: ${delta.ticks} ticks → +${delta.sealed_states} seals (${(100*delta.sealed_states/Math.max(1,delta.ticks)).toFixed(1)}%/tick) · +${((delta.carried_meaning_kb ?? 0)).toFixed(1)}kb carried` : ''}`);
console.log(`  velocity:    ${velocity.h24.per_hour} stmts/h (24h: +${velocity.h24.derived} over ${velocity.h24.seals} seals) · 6h ${velocity.h6.per_hour}/h · 1h ${velocity.h1.per_hour}/h · ${childStmts} child stmts stocked`);
console.log(`  prospects:   ${meaning.prospects.length ? meaning.prospects.map((p) => `${p.coord}(${p.pressure})`).join(' ') : 'none over threshold'} — neighbors dense, intersection sticks out (the reversed triad)`);
console.log(`  s/n + mass:  signal ${meaning.carried_meaning_kb}kb / noise ${meaning.noise_kb}kb → S/N ${meaning.snr} · mass ${meaning.mass.raw_kb}kb raw → ${meaning.mass.compressed_kb}kb compressed`);
console.log(`  dup-index:   ${meaning.duplication.pct}% of cells under λ=${meaning.duplication.lambda} (near-copies) · trend ${report.meaning.trend && report.meaning.trend.kb_per_hour_24h != null ? report.meaning.trend.kb_per_hour_24h + 'kb/h' : 'accruing'} · marginal ${report.meaning.trend && report.meaning.trend.marginal_kb_per_seal != null ? report.meaning.trend.marginal_kb_per_seal + 'kb/seal' : '—'}`);
console.log(`  bit-rate:    ${bitRate.settled_promises} settled promises · ${bitRate.semantic_bytes}B semantic mass · ${bitRate.bytes_per_tick ?? '—'} B/tick · drought ${bitRate.drought_seals} seal(s) since last settle${bitRate.drought_seals >= 10 ? ' ⚠ SPINNING — investigate the filter, never assume virtue' : ''}`);
console.log(`  meaning:     ${meaning.carried_meaning_kb}kb carried (non-redundant compressed) · density ${meaning.density} · orthogonality ${meaning.orthogonality} · role-coherence ${meaning.role_coherence} · ${meaning.cells_measured} cells`);
if (delta) console.log(`  Δ since ${delta.vs_head}: +${(delta.l0_chars / 1000).toFixed(1)}k L0 ch · +${(delta.l1_chars / 1000).toFixed(1)}k L1 ch · +${delta.sealed_states} seals · +${delta.walks} walks · +${delta.hops} hops`);
else console.log('  Δ: no prior snapshot — THIS run is the baseline (commit it before stepping away)');
console.log(`  → data/pmu/tesseract-progress.json`);
