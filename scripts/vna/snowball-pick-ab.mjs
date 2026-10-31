#!/usr/bin/env node
// scripts/vna/snowball-pick-ab.mjs — C610d: THE SNOWBALL PICK, ENSEMBLE VS GREEDY. DOES THE ENSEMBLE REMOVE THE CHERRY-PICK?
//
// retroGrow (retro-snowball.mjs) starts from the ONE row nearest the ask by NCD and grows greedily by nearest walked shape.
// Two arms, the engine untouched — only the seed set differs:
//   GREEDY    retroGrow as built: step 1 = the nearest row by NCD, then the retro order, τ / cap / plateau stop.
//   ENSEMBLE  step 1 = the rows C610c's CONSENSUS zones name for the brief (forecast-localise.mjs localise(), the per-pair
//             C610a ensemble forecast as its input), folded into ONE composite seed row (its text = the seed rows' texts,
//             its cells = their union) that the injected textDist puts first; growth from there is the same retroGrow with
//             the same τ, cap and stop. The composite expands back to its seed ids in the grown set.
//   Both grown sets are carried under the SAME BUNDLE_TOKEN_CAP (rows cut newest-added first, as carryRetro cuts them).
//
// SCORE — the snowball side of C609a's conditional code length, reusing brief-predicts-commit.mjs (never re-implemented):
//   code-only gain(arm) = [ C(diff | shuffled brief) − C(diff | brief ‖ arm's snowball) ] · 8 / |diff| (bits per diff byte)
//   the diff is C609a's code-only view (codeOnly → DIFF_CAP → mask), the null is C609a's own code-only shuffled-brief mean
//   (scorePairs(...).code_only, same draws, same 32 KiB window), the brief ‖ snowball is cut to BRIEF_CAP so every byte
//   stays referenceable. Paired difference per row d = gain(ensemble) − gain(greedy); halves = C609a's session halves;
//   z = mean(d) / (sd(d)/√n) per half. Bar: |z| ≥ 2 with one sign and n ≥ 20 in BOTH halves, else UNMEASURED with the count.
// Descriptive: pick differs = share of rows whose greedy start row is absent from the ensemble seed set; mean steps to stop.
// LLM-free: gzip and the one Rust walk (injected). Writes data/vna/snowball-pick-ab.json.
//
// SUFFICIENT FOR: whether ensemble-picked neighbour rows let the brief predict the code better, in bits, than the greedy pick.
// NOT SUFFICIENT FOR: which rows a human would have chosen, or whether the worker read them.
//
// Rust port row: declared C610d-port — this DECIDES a verdict (MEASURED/UNMEASURED, which arm wins), so once in use the
// paired scoring moves into the crate beside node_gzip_len (lens.rs) with C609a-port; the git/file shuttling stays node.
//
// @guard tests/vna/c610d-the-snowball-pick-ensemble-vs-greedy.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { retroGrow, rowsOf, RETRO_TAU, RETRO_MAX_STEPS } from './retro-snowball.mjs';
import { scorePairs, condBits, mask, codeOnly, WINDOW, DIFF_CAP, BRIEF_CAP, BAR, K_DEFAULT } from './brief-predicts-commit.mjs';
import { localise } from './forecast-localise.mjs';
import { ncd, BUNDLE_TOKEN_CAP, CHARS_PER_TOKEN } from './spec-tree.mjs';

// C1389: the repo being read — the caller's, when `npx thetacog-mcp snowball-pick-ab` runs elsewhere (C94b's own convention)
const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = resolve(REPO, 'data/vna/snowball-pick-ab.json');
export const PORT_ROW = 'C610d-port — lens.rs beside node_gzip_len: the paired code-length scoring decides the verdict, so it moves into the crate with C609a-port';
export const SNOW_CHARS = BUNDLE_TOKEN_CAP * CHARS_PER_TOKEN;
export const SUFFICIENT_FOR = 'whether ensemble-picked neighbour rows let the brief predict the code better, in bits, than the greedy pick';
export const NOT_SUFFICIENT_FOR = 'which rows a human would have chosen, or whether the worker read them';
const SEED_ID = '__C610d_ensemble_seed__';
const buf = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8'));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

/** The ensemble seed: the rows C610c's CONSENSUS zones name for this forecast, in zone order, deduplicated. */
export async function ensembleSeed(forecast, rows, { lib = null } = {}) {
  const r = await localise({ forecast, rows, lib });
  if (r.refused) return { ids: [], why: r.why };
  const ids = [];
  for (const z of r.zones.filter((z) => z.class === 'consensus')) for (const x of z.rows) if (!ids.includes(x.id)) ids.push(x.id);
  return { ids, zones: r.zones.filter((z) => z.class === 'consensus').map((z) => z.id), why: ids.length ? null : 'no consensus zone names a walked row' };
}

/** The snowball text carried beside the brief: rows in grown order, cut newest-added first to the token cap, never an overrun. */
export function snowballText(set, rows, { chars = SNOW_CHARS } = {}) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const ids = (set || []).filter((id) => byId[id]);
  let t = ids.map((id) => byId[id].text).join('\n'); let cut = 0;
  while (t.length > chars && ids.length > 1) { ids.pop(); cut++; t = ids.map((id) => byId[id].text).join('\n'); }
  if (t.length > chars) t = t.slice(0, chars);
  return { text: t, ids, cut };
}

/** One arm's grown read. seed = null → GREEDY (retroGrow as built); seed = [ids] → ENSEMBLE (composite seed row first). */
export async function growArm({ rows, brief, walk, askCells, textDist, seed = null, tau = RETRO_TAU, maxSteps = RETRO_MAX_STEPS }) {
  if (!seed) {
    const g = await retroGrow(null, brief, { walk, askCells, rows, textDist, tau, maxSteps });
    return { set: g.set, start: g.start, steps: g.stop ? g.stop.step : 0, stop: g.stop ? g.stop.why : null };
  }
  const S = new Set(seed); const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const comp = { id: SEED_ID, cells: [...new Set(seed.flatMap((id) => byId[id]?.cells || []))], text: seed.map((id) => byId[id]?.text || '').join('\n') };
  const R = [comp, ...rows.filter((r) => !S.has(r.id))];
  const dist = (id) => (id === SEED_ID ? -1 : textDist(id));
  const g = await retroGrow(null, brief, { walk, askCells, rows: R, textDist: dist, tau, maxSteps });
  const set = (g.set || []).flatMap((id) => (id === SEED_ID ? seed : [id]));
  return { set, start: seed[0] ?? null, steps: g.stop ? g.stop.step : 0, stop: g.stop ? g.stop.why : null };
}

/**
 * scoreAB(pairs, { rows, walk, forecastFor, K, lib }) — pairs: C609a's [{ label, brief, diff, session }].
 * forecastFor(pair) → a C610c forecast ({ mean, spread, aperture_version, ... }) or null. Pure over its inputs and the walk.
 */
export async function scoreAB(pairs, { rows, walk, forecastFor, K = K_DEFAULT, lib = null, tau = RETRO_TAU, maxSteps = RETRO_MAX_STEPS, snowChars = SNOW_CHARS } = {}) {
  const base = scorePairs(pairs, { K }).code_only;   // C609a's code-only arm: same windows, same draws, same session halves
  const byLabel = Object.fromEntries(pairs.map((p) => [p.label, p]));
  const aperture = { window: WINDOW, diff_cap: DIFF_CAP, brief_cap: BRIEF_CAP, token_cap: BUNDLE_TOKEN_CAP, snow_chars: snowChars, tau, max_steps: maxSteps, K };
  const arms = { greedy: { ...aperture }, ensemble: { ...aperture } };
  const scored = [], no_forecast = [], no_seed = [], no_walk = [];
  for (const b of base.scored) {
    const p = byLabel[b.label]; const brief = buf(p.brief);
    const F = forecastFor ? await forecastFor(p) : null;
    if (!F) { no_forecast.push({ label: b.label, why: 'no ensemble forecast on record for this pair' }); continue; }
    const seed = await ensembleSeed({ label: b.label, candidate: brief.toString('utf8'), ...F }, rows, { lib });
    if (!seed.ids.length) { no_seed.push({ label: b.label, why: seed.why }); continue; }
    const askW = walk(brief.toString('utf8')) || {};
    if (!askW.pixel) { no_walk.push({ label: b.label, why: askW.err || 'the ask walk wrote no pixel' }); continue; }
    const low = brief.toString('utf8').toLowerCase(); const memo = new Map(); const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const textDist = (id) => { if (!memo.has(id)) memo.set(id, ncd(low, String(byId[id].text).toLowerCase())); return memo.get(id); };
    const dx = mask(codeOnly(buf(p.diff)).subarray(0, DIFF_CAP));
    if (dx.length !== b.diff_bytes) throw new Error(`C610d: aperture drift on ${b.label} — diff ${dx.length} B here vs ${b.diff_bytes} B in C609a`);
    const one = async (seedIds) => {
      const g = await growArm({ rows, brief: brief.toString('utf8'), walk, askCells: askW.cells || [], textDist, seed: seedIds, tau, maxSteps });
      const s = snowballText(g.set, rows, { chars: snowChars });
      const view = mask(Buffer.concat([brief, Buffer.from('\n' + s.text, 'utf8')]).subarray(0, BRIEF_CAP));
      const own = condBits(view, dx);
      return { ...g, carried: s.ids, cut: s.cut, view_bytes: view.length, own_bits: own, gain: (b.null_mean_bits - own) / dx.length };
    };
    const greedy = await one(null), ensemble = await one(seed.ids);
    scored.push({ label: b.label, session: b.session, half: b.half, diff_bytes: dx.length, null_mean_bits: b.null_mean_bits, seed: seed.ids, zones: seed.zones,
      pick_differs: !seed.ids.includes(greedy.start), greedy, ensemble, d: ensemble.gain - greedy.gain });
  }
  const halves = ['a', 'b'].map((h) => {
    const ds = scored.filter((r) => r.half === h).map((r) => r.d);
    const s = ds.length > 1 ? sd(ds) : 0;
    return { n: ds.length, d_mean: ds.length ? mean(ds) : null, z: ds.length > 1 ? (s > 0 ? mean(ds) / (s / Math.sqrt(ds.length)) : (mean(ds) === 0 ? 0 : Math.sign(mean(ds)) * Infinity)) : null };
  });
  const why = [];
  halves.forEach((h, i) => { if (h.n < BAR.n) why.push(`n ${h.n} < ${BAR.n} in half ${'ab'[i]}`); else if (!(Math.abs(h.z) >= BAR.z)) why.push(`|z| ${h.z.toFixed(2)} < ${BAR.z} in half ${'ab'[i]}`); });
  if (!why.length && Math.sign(halves[0].z) !== Math.sign(halves[1].z)) why.push('the halves disagree in sign');
  const verdict = why.length ? 'UNMEASURED' : 'MEASURED';
  const gG = scored.length ? mean(scored.map((r) => r.greedy.gain)) : null, gE = scored.length ? mean(scored.map((r) => r.ensemble.gain)) : null;
  const differs = scored.length ? (100 * scored.filter((r) => r.pick_differs).length) / scored.length : null;
  const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? (x === Infinity ? '∞' : x === -Infinity ? '-∞' : '—') : x.toFixed(d));
  const winner = verdict === 'MEASURED' ? (halves[0].z > 0 ? 'ENSEMBLE predicts the code better' : 'GREEDY predicts the code better') : null;
  const skipped = [no_forecast.length && `${no_forecast.length} with no ensemble forecast`, no_seed.length && `${no_seed.length} with no consensus row`, no_walk.length && `${no_walk.length} unwalked`].filter(Boolean);
  const line = `C610d: code-only gain greedy ${f(gG)} · ensemble ${f(gE)} · paired z ${f(halves[0].z, 2)}|${f(halves[1].z, 2)} · n ${halves[0].n}|${halves[1].n} · pick differs ${differs == null ? '—' : differs.toFixed(0)} % · ` +
    `${verdict} — ${winner || why.join('; ')}` + (skipped.length ? ` · ${skipped.join(' · ')} (of ${base.scored.length} C609a code-only pairs)` : '');
  return {
    row: 'C610d', llm: false, line, verdict, why, winner, halves, arms, gain: { greedy: gG, ensemble: gE },
    pick_differs_pct: differs, mean_steps: { greedy: scored.length ? mean(scored.map((r) => r.greedy.steps)) : null, ensemble: scored.length ? mean(scored.map((r) => r.ensemble.steps)) : null },
    scored, no_forecast, no_seed, no_walk, c609a_code_only_pairs: base.scored.length, bar: BAR, port_row: PORT_ROW,
    sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR,
  };
}

// ── the live record: C609a's pairs (collectLive), the per-pair C610a ensemble forecast on record in chained-ingress.json ──
export async function runLive({ out = OUT, K = K_DEFAULT } = {}) {
  const { collectLive } = await import('./brief-predicts-commit.mjs');
  const { readTree, TREE } = await import('./spec-tree.mjs');
  const { probeWalker } = await import('./snowball-refresh.mjs');
  const { pairs, unpaired } = collectLive(REPO);
  // C1389: a stranger's npx install carries no data/vna/spec-tree.json (private, never shipped — see bundle-pmu.mjs
  // ENTRIES) — degrade to UNMEASURED naming the missing input instead of letting readTree's ENOENT surface a stack trace.
  if (!existsSync(TREE)) {
    const why = [`no spec tree at ${TREE} — nothing to grow a snowball over`];
    const doc = {
      at: new Date().toISOString(), forecast_source: null, forecast_aperture: null, unpaired: unpaired.length,
      row: 'C610d', llm: false, line: `C610d: UNMEASURED — ${why[0]}`, verdict: 'UNMEASURED', why, winner: null,
      halves: [], arms: null, gain: { greedy: null, ensemble: null }, pick_differs_pct: null,
      mean_steps: { greedy: null, ensemble: null }, scored: [], no_forecast: [], no_seed: [], no_walk: [],
      c609a_code_only_pairs: 0, bar: BAR, port_row: PORT_ROW, sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR,
    };
    if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ line: doc.line, ...doc }, null, 2) + '\n'); }
    return doc;
  }
  const rows = rowsOf(readTree(TREE, { text: true }));
  const chPath = resolve(REPO, 'data/vna/chained-ingress.json');
  const ch = existsSync(chPath) ? JSON.parse(readFileSync(chPath, 'utf8')) : { pairs: [] };
  const fc = new Map((ch.pairs || []).filter((p) => Array.isArray(p.zones?.ensemble) && p.zones.ensemble.length).map((p) => [`${p.label}|${p.sha}`, p.zones.ensemble]));
  const forecastFor = (p) => {
    const z = fc.get(`${p.label}|${p.sha}`); if (!z) return null;
    return { mean: Object.fromEntries(z.map((c) => [c.coord, 1])), spread: Object.fromEntries(z.map((c) => [c.coord, 0])), aperture_version: ch.aperture_version, ingress: { rule: 'top-k', K: 3, source: 'chained-ingress.json zones.ensemble' } };
  };
  const walk = probeWalker(join(tmpdir(), 'thetacog-c610d-snowball'));
  const r = await scoreAB(pairs, { rows, walk, forecastFor, K });
  const doc = { at: new Date().toISOString(), forecast_source: 'data/vna/chained-ingress.json zones.ensemble (C610a ensembleWalk top-3)', forecast_aperture: ch.aperture_version || null, unpaired: unpaired.length, ...r };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ line: doc.line, ...doc }, null, 2) + '\n'); }
  return doc;
}

// C1389: realpath both sides — argv[1] under a symlinked tmpdir (macOS /var/folders → /private/var) is not
// import.meta.url's canonical path, and a door that silently does nothing and exits 0 is the one output an npx
// door may never produce (the same fix attest-sweep.mjs carries for the identical reason).
const isMainModule = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMainModule) {
  const kArg = process.argv.indexOf('--k');
  try {
    const doc = await runLive({ K: kArg > 0 ? Number(process.argv[kArg + 1]) : K_DEFAULT });
    console.log(doc.line);
    console.log(`mean steps to stop greedy ${doc.mean_steps.greedy ?? '—'} · ensemble ${doc.mean_steps.ensemble ?? '—'} · → data/vna/snowball-pick-ab.json`);
  } catch (e) {
    // C1389: the npx door — anything else a stranger's repo is missing (an unreadable chained-ingress.json, an
    // unwritable OUT dir) prints what it could not measure, never a stack trace, and exits 0 like hud-snowball.mjs's own catch.
    console.log(`C610d: UNMEASURED — ${String((e && e.message) || e).split('\n')[0].slice(0, 160)}`);
  }
}
