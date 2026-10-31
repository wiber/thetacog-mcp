#!/usr/bin/env node
// scripts/vna/chained-ingress.mjs — C610h THE CHAINED INGRESS: RE-WALK FROM THE RED AND SEE WHETHER THE REDS HOLD.
//
// Operator 2026-10-03: "you run it once you find where the reds are then based on that you find another starting
// point. See if the reds are from there … reason about whether that actually is the right way of doing it".
//
// THE MECHANISM (LLM-free, a pure function of the grid and the walk):
//   walk 1 — the walk from ONE ingress (today's single start, definerWalk144([s]));
//   reds 1 — the cells whose heat is ≥ RED_FRAC × walk 1's max heat (the walk's own scale, never a fixed number);
//   ingress 2 — the reddest cell of walk 1 that is NOT walk 1's ingress (heat DESC, anchor ASC on ties);
//   walk 2 — the same walk, same grid, same knobs, from ingress 2 alone;
//   persist = reds 1 ∩ reds 2 · appear = reds 2 \ reds 1 · vanish = reds 1 \ reds 2.
//   The chained forecast heat is the per-cell MINIMUM of the two walks' max-normalised heats: a cell only scores if
//   BOTH starts reach it, so a basin the work keeps returning to persists and a one-hop dead end drops to zero.
//
// WHY THIS IS A QUESTION AND NOT A CLAIM: a red that only one start sees is the ingress's artefact; a red that a
// second start — seeded from the red itself — re-finds is a basin of the grid. Whether that sharpens the forecast of
// where the commit lands is read by the four-arm comparison below (single · chained · C610a ensemble · shuffled), on
// the C609a pairs (scripts/vna/brief-predicts-commit.mjs collectLive, reused verbatim), never asserted.
//
// SCORING — PROVISIONAL, C610b OWNS THE HIT-RATE LINE. Until C610b lands, the per-pair record is written in the shape
// it needs (each arm's forecast zones + the walked commit's Δ cells, all as anchor indices with coords) and scored by
// the geometry the C610b row pre-registers: hit = every one of the outcome's top-3 anchors has a forecast top-3 anchor
// within Chebyshev ≤ 2 blocks on the 12×12 anchor grid (THE METER's geometry). Null = the SHUFFLED arm: another
// pair's single-start forecast in the ±25 % brief-size band (C609a's BAND), every such draw, averaged. Halves split by
// session. Bar per half, pre-registered: z ≥ 2 vs the null AND n ≥ 20, else UNMEASURED with the count.
//
// THE DOOR: intent = the brief (the candidate), reality = the commit's code-only diff (C609a codeOnly), through
// matchAperture → panel-door.mjs panel (the one door) → its sensed 144×144 grids (stages.xor, MSB-first). The
// forecasts walk the INTENT grid only — the diff never enters a forecast; the outcome (Δ cells) is the single walk
// over the REALITY grid. apertureVersion() stamped on the receipt.
//
// RUST PORT (MAXIMISE RUST) — PORT ROW C610h-port, declared here because data/vna/rust-punch-list.json is held by a
// live C610a claim at the time of this commit (the chair folds it into `declared`):
//   row C610h · kind decides · stage chained-ingress · port `pmu-onchip --chained-walk --seeds <s> [--red-frac 0.5]`
//   home packages/thetacog-mcp/intentguard/src/walk_lens.rs definer_walk(grid, coords, start_anchors, o) called twice in ONE
//   process (the second start_anchors = [reddest non-ingress anchor of the first heat]) · acceptance: the chip's
//   persist/appear/vanish sets and chained heat equal chainedWalk's on the guard's basin+noise fixture.
//
// Sufficient for: whether a red-seeded second start sharpens where the work will land. NOT sufficient for: whether
// the work was good (Rice), nor for the hit-rate line itself (C610b).
//
//   node scripts/vna/chained-ingress.mjs [--limit N]   → data/vna/chained-ingress.json, line 1 to stdout
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
export const OUT_JSON = resolve(REPO, 'data/vna/chained-ingress.json');
export const RED_FRAC = 0.5;          // red = heat ≥ half the walk's own max
export const TOP_N = 3;               // forecast zones / Δ cells per pair (C610b's top-3)
export const FENCE = 2;               // Chebyshev blocks (THE METER)
export const BAR = Object.freeze({ z: 2, n: 20 });
export const BAND = 0.25;             // C609a's shuffled-brief size band
export const ARMS = Object.freeze(['single', 'chained', 'ensemble', 'shuffled']);
export const PORT_ROW = Object.freeze({
  row: 'C610h', kind: 'decides', stage: 'chained-ingress',
  port: 'pmu-onchip --chained-walk --seeds <s> [--red-frac 0.5]',
  home: 'packages/thetacog-mcp/intentguard/src/walk_lens.rs definer_walk (start_anchors) — two calls, one process',
  prototype: 'scripts/vna/chained-ingress.mjs chainedWalk',
  acceptance: 'the chip and chainedWalk agree on persist/appear/vanish and the chained heat on the C610h basin+noise fixture',
});
const CHECKPOINT = process.env.CHAINED_INGRESS_CHECKPOINT || resolve(tmpdir(), 'chained-ingress.checkpoint.ndjson');

// ── the pure core ───────────────────────────────────────────────────────────────────────────────────────────────────
const maxOf = (h) => h.reduce((m, v) => (v > m ? v : m), 0);
/** reds(heat) → ascending anchor indices with heat > 0 and ≥ frac × max. */
export function reds(heat, frac = RED_FRAC) {
  const m = maxOf(heat); if (!(m > 0)) return [];
  const out = []; for (let a = 0; a < heat.length; a++) if (heat[a] > 0 && heat[a] >= frac * m) out.push(a);
  return out;
}
/** reddest(heat, exclude) → the hottest anchor not in `exclude` (heat DESC, index ASC), or null. */
export function reddest(heat, exclude = []) {
  const ex = new Set(exclude); let best = null;
  for (let a = 0; a < heat.length; a++) { if (ex.has(a) || !(heat[a] > 0)) continue; if (best == null || heat[a] > heat[best]) best = a; }
  return best;
}
/** topCells(heat, n) → the n hottest anchors with heat > 0 (heat DESC, index ASC). */
export function topCells(heat, n = TOP_N) {
  return heat.map((v, i) => [Number(v) || 0, i]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, n).map((x) => x[1]);
}
const norm = (h) => { const m = maxOf(h); return h.map((v) => (m > 0 ? v / m : 0)); };

/**
 * chainedWalk(grid, start, { walk, redFrac, ...knobs }) → { ingress:[s1,s2], walk1, walk2, reds1, reds2, persist, appear,
 * vanish, heat } — `walk(startAnchors, { gridBits, ...knobs })` is injectable (a fixture); the live default is THE walk.
 * No second ingress (walk 1 reached nothing beyond its start) ⇒ heat is walk 1's own and chained = false.
 */
export async function chainedWalk(grid, start, { walk = null, redFrac = RED_FRAC, ...knobs } = {}) {
  if (!walk) ({ definerWalk144: walk } = await import('../pmu/definer-walk-144.mjs'));
  const w1 = await walk([start], { ...knobs, gridBits: grid });
  const h1 = Array.from(w1.heat, Number);
  const r1 = reds(h1, redFrac);
  const s2 = reddest(h1, [start]);
  if (s2 == null) return { chained: false, ingress: [start], walk1: h1, walk2: null, reds1: r1, reds2: [], persist: [], appear: [], vanish: r1, heat: h1 };
  const w2 = await walk([s2], { ...knobs, gridBits: grid });
  const h2 = Array.from(w2.heat, Number);
  const r2 = reds(h2, redFrac);
  const S1 = new Set(r1), S2 = new Set(r2);
  const n1 = norm(h1), n2 = norm(h2);
  return {
    chained: true, ingress: [start, s2], walk1: h1, walk2: h2, reds1: r1, reds2: r2,
    persist: r1.filter((a) => S2.has(a)), appear: r2.filter((a) => !S1.has(a)), vanish: r1.filter((a) => !S2.has(a)),
    heat: n1.map((v, i) => Math.min(v, n2[i])),
  };
}

// ── scoring (provisional; C610b owns the line) ─────────────────────────────────────────────────────────────────────
const blk = (a) => [Math.floor(a / 12), a % 12];
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
/** hit(forecastTop, outcomeTop) — every outcome anchor has a forecast anchor within FENCE blocks. Empty either side ⇒ false. */
export function hit(F, A, fence = FENCE) {
  if (!F?.length || !A?.length) return false;
  return A.every((a) => F.some((f) => cheb(blk(f), blk(a)) <= fence));
}
const zOf = (k, n, p) => (n > 0 && p > 0 && p < 1 ? (k / n - p) / Math.sqrt(p * (1 - p) / n) : null);

/**
 * scoreArms(pairs) — pairs: [{ label, session, briefBytes, forecasts: { single, chained, ensemble|null }, outcome }]
 * (each a top-N anchor list). Returns per-arm hit rates, the shuffled null, per-half z/n and the verdict — PURE.
 * MEASURED only when the CHAINED arm clears z ≥ BAR.z and n ≥ BAR.n in BOTH halves.
 */
export function scoreArms(pairs) {
  const sessions = [...new Set(pairs.map((p) => p.session))].sort();
  const cut = Math.ceil(sessions.length / 2);
  const halfOf = (p) => (sessions.indexOf(p.session) < cut ? 0 : 1);
  const per = pairs.map((p, i) => {
    const draws = pairs.filter((q, j) => j !== i && q.forecasts?.single?.length && Math.abs(q.briefBytes - p.briefBytes) <= BAND * p.briefBytes);
    const nul = draws.length ? draws.filter((q) => hit(q.forecasts.single, p.outcome)).length / draws.length : null;
    return {
      label: p.label, half: halfOf(p), null: nul, draws: draws.length,
      single: hit(p.forecasts.single, p.outcome), chained: hit(p.forecasts.chained, p.outcome),
      ensemble: p.forecasts.ensemble ? hit(p.forecasts.ensemble, p.outcome) : null,
    };
  });
  const scored = per.filter((r) => r.null != null);
  const rate = (rows, k) => { const v = rows.filter((r) => r[k] != null); return v.length ? v.filter((r) => r[k]).length / v.length : null; };
  const mean = (rows) => (rows.length ? rows.reduce((s, r) => s + r.null, 0) / rows.length : null);
  const halves = [0, 1].map((h) => {
    const rows = scored.filter((r) => r.half === h); const p = mean(rows); const n = rows.length;
    const z = (k) => zOf(rows.filter((r) => r[k]).length, n, p);
    return { half: h, n, null: p, z_chained: z('chained'), z_single: z('single'), z_ensemble: rows.some((r) => r.ensemble != null) ? z('ensemble') : null };
  });
  const why = [];
  for (const h of halves) {
    if (h.n < BAR.n) why.push(`half ${'ab'[h.half]} n ${h.n} < ${BAR.n}`);
    else if (!(h.z_chained != null && h.z_chained >= BAR.z)) why.push(`half ${'ab'[h.half]} chained z ${h.z_chained == null ? '—' : h.z_chained.toFixed(2)} < ${BAR.z}`);
  }
  const verdict = why.length ? 'UNMEASURED' : 'MEASURED';
  return {
    verdict, why, halves, per,
    rates: { single: rate(scored, 'single'), chained: rate(scored, 'chained'), ensemble: rate(scored, 'ensemble'), shuffled: mean(scored) },
    n_scored: scored.length, n_pairs: pairs.length,
  };
}

/** line1(score, persistence) — the receipt's first line. Never prints MEASURED unless scoreArms said so. */
export function line1(s, pers = null) {
  const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
  const [a, b] = s.halves;
  return `C610h: chained ${f(s.rates.chained)} · single ${f(s.rates.single)} · ensemble ${f(s.rates.ensemble)} · null ${f(s.rates.shuffled)} · ` +
    `z ${f(a.z_chained, 2)}|${f(b.z_chained, 2)} · n ${a.n}|${b.n}` +
    (pers ? ` · reds persist ${f(pers.persist, 2)} appear ${f(pers.appear, 2)} vanish ${f(pers.vanish, 2)} (mean per pair)` : '') +
    ` · ${s.verdict}${s.why.length ? ' — ' + s.why.join('; ') : ' — chained arm clears z ≥ 2, n ≥ 20 in both halves'}`;
}

// ── the live run ────────────────────────────────────────────────────────────────────────────────────────────────────
/** unpack(b64) → Uint8Array(20736), MSB-first (main.rs pack_bitmap_b64 — the door's own bits). */
export function unpack(b64) {
  const bytes = Buffer.from(String(b64 || ''), 'base64'); const out = new Uint8Array(20736);
  for (let i = 0; i < 20736; i++) if (bytes[i >> 3] & (1 << (7 - (i & 7)))) out[i] = 1;
  return out;
}

export async function runLive({ limit = Infinity, out = OUT_JSON } = {}) {
  const { collectLive, codeOnly } = await import('./brief-predicts-commit.mjs');
  const { matchAperture } = await import('./aperture.mjs');
  const { panel } = await import('../pmu/panel-door.mjs');
  const dw = await import('../pmu/definer-walk-144.mjs');
  // C621: every walk here is THE DOOR's walk (door-crate walksCrate — the call triptych-build makes under every panel, c342b), never a
  // second spawn of the definer walk beside it. A crate that cannot walk refuses the pair (UNMEASURED), never a fallback walk.
  const DC = await import('./door-crate.mjs');
  const doorWalk = async (seeds, { gridBits, ...knobs } = {}) => (await DC.walksCrate(seeds, [gridBits], knobs))[0];
  const { apertureVersion } = await import('../pmu/prompt-lens.mjs');
  const ensembleAvail = typeof dw.ensembleWalk === 'function' && typeof dw.ingressFor === 'function';
  const topSeed = (g) => { const s = new Array(144).fill(0); for (let a = 0; a < 144; a++) { let n = 0; for (let j = 0; j < 144; j++) if (g[a * 144 + j]) n++; s[a] = n; } return topCells(s, 1)[0] ?? null; };

  const { pairs: raw, unpaired } = collectLive(REPO);
  const cp = new Map();
  if (existsSync(CHECKPOINT)) for (const l of readFileSync(CHECKPOINT, 'utf8').split('\n')) { try { const j = JSON.parse(l); cp.set(j.key, j.reading); } catch { /* */ } }
  const pairs = [], refused = [];
  for (const p of raw.slice(0, limit)) {
    const key = `${p.label}|${p.sha}`;
    let reading = cp.get(key);
    if (!reading) {
      const diff = codeOnly(p.diff).toString('utf8');
      if (!diff.trim()) reading = { ok: false, reason: 'no code hunk' };
      else {
        const ap = matchAperture([{ path: `brief ${p.label}`, text: p.brief.toString('utf8') }], [{ path: `${p.sha.slice(0, 10)} code-only diff`, text: diff }]);
        if (ap.admissible === false) reading = { ok: false, reason: `aperture: ${ap.reason || 'inadmissible'}` };
        else {
          const door = await panel({ intent: ap.intent, reality: ap.reality, label: `C610h ${p.label}@${p.sha.slice(0, 10)}` });
          const x = door?.stages?.xor;
          reading = door.unmeasured || !x?.intent_bitmap_b64 || !x?.reality_bitmap_b64
            ? { ok: false, reason: `door: ${door.unmeasured || 'no sense grids returned'}` }
            : { ok: true, intentB64: x.intent_bitmap_b64, realityB64: x.reality_bitmap_b64 };
        }
      }
      cp.set(key, reading); mkdirSync(dirname(CHECKPOINT), { recursive: true });
      appendFileSync(CHECKPOINT, JSON.stringify({ key, reading, at: new Date().toISOString() }) + '\n');
    }
    if (!reading.ok) { refused.push({ label: p.label, sha: p.sha, why: reading.reason }); continue; }
    const ig = unpack(reading.intentB64), rg = unpack(reading.realityB64);
    const si = topSeed(ig), sr = topSeed(rg);
    if (si == null || sr == null) { refused.push({ label: p.label, sha: p.sha, why: 'a side has no lit anchor row (no ingress)' }); continue; }
    let single, ch, outW, ensemble = null;
    try {
      single = await doorWalk([si], { gridBits: ig });
      ch = await chainedWalk(ig, si, { walk: doorWalk });
      outW = await doorWalk([sr], { gridBits: rg });
      if (ensembleAvail) { const e = await dw.ensembleWalk(ig, dw.ingressFor('top-k', { grid: ig, k: 3 }), { rule: 'top-k', walk: doorWalk }); ensemble = topCells(e.meanHeat); }
    } catch (e) { refused.push({ label: p.label, sha: p.sha, why: `door walk UNMEASURED: ${e.message || e}` }); continue; }
    const C = dw.COORDS;
    const z = (xs) => (xs ? xs.map((a) => ({ anchor: a, coord: C[a] })) : null);
    const outcome = topCells(outW.heat);
    if (!outcome.length) { refused.push({ label: p.label, sha: p.sha, why: 'the commit walk reached no cell' }); continue; }
    pairs.push({
      label: p.label, sha: p.sha, session: p.session, briefBytes: p.brief.length,
      forecasts: { single: topCells(single.heat), chained: topCells(ch.heat), ensemble },
      zones: { single: z(topCells(single.heat)), chained: z(topCells(ch.heat)), ensemble: z(ensemble) },
      outcome, delta_cells: z(outcome),
      chain: { ingress: z(ch.ingress), chained: ch.chained, persist: z(ch.persist), appear: z(ch.appear), vanish: z(ch.vanish), reds1: ch.reds1.length, reds2: ch.reds2.length },
    });
  }
  const s = scoreArms(pairs);
  const avg = (k) => { const v = pairs.filter((p) => p.chain.reds1); return v.length ? v.reduce((a, p) => a + (p.chain[k]?.length || 0) / Math.max(1, p.chain.reds1), 0) / v.length : null; };
  const pers = pairs.length ? { persist: avg('persist'), appear: avg('appear'), vanish: avg('vanish') } : null;
  let line = line1(s, pers);
  if (!ensembleAvail) line += ' · ensemble arm UNMEASURED — C610a ensembleWalk not exported at this tree';
  const doc = {
    at: new Date().toISOString(), row: 'C610h', llm: false, aperture_version: apertureVersion(), line,
    bar: BAR, red_frac: RED_FRAC, top_n: TOP_N, fence: FENCE, band: BAND, port_row: PORT_ROW,
    scoring: 'PROVISIONAL — C610b owns the hit-rate line; hit = every Δ top-3 anchor has a forecast top-3 anchor within Chebyshev ≤ 2 blocks; null = shuffled single-start forecasts of other pairs in the ±25 % brief band',
    door: 'intent = brief, reality = code-only diff → matchAperture → panel-door.mjs panel → stages.xor sense grids; forecasts walk the intent grid only, Δ cells = the single walk over the reality grid',
    ...s, pairs, refused, unpaired,
  };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); }
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const li = process.argv.indexOf('--limit');
  const doc = await runLive({ limit: li > 0 ? Number(process.argv[li + 1]) : Infinity });
  console.log(doc.line);
  console.log(`pairs walked ${doc.pairs.length} · refused ${doc.refused.length} · unpaired ${doc.unpaired.length} · aperture ${doc.aperture_version} · → data/vna/chained-ingress.json`);
}
