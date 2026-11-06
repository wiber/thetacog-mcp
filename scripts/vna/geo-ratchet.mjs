#!/usr/bin/env node
// scripts/vna/geo-ratchet.mjs — C176g: THE GEOMETRY LEG IS RATCHETED LIKE THE APERTURE WAS.
//
// C176d reported pure walk shape at chance (shape_wide_rowE z −1.37 | −1.66, 0 of 14 strata). That search measured an
// UNMATCHED aperture, not the ceiling: (a) 45/51 ask walks and 47/51 row walks were not admissible by the walk's own null
// test; (b) an ask is 11–600 chars against the Rust matched seed's 900-char eye (BULK_EYE_FINE), so the ask sat under the
// 220-byte gzip floor (aperture.mjs MIN_GZIP_BYTES); (c) the row's pixel came from the fold's 800-char head walk, the ask was
// walked fresh, rowE re-walked at cap 4000 — three apertures compared as one; (d) the metric was single-pixel block L1 /
// cell jaccard, not the Chebyshev fence distance the panel bands on; and the 45-arm search was a scratchpad script. This
// file is that search, in the repo, with the eye matched and every knob a named arm.
//
// GROUND TRUTH: retrieval-bench's — every transcript ask a spec row quotes verbatim (transcript-asks.mjs audit()), × every
// spec row (docs/specs/vna/SPEC-VNA-COCKPIT.md, read the way transcript-asks reads it — never spec-tree.blobs.json).
// Halves = splitHalves(ask ids, seed); null = the K=200 shuffled-ask null, z on the MEAN rank (retrieval-bench exports).
// LEVEL GROUND: the ground truth is built by verbatim quoting, so every row's operator quotes (*"…"*) are removed BEFORE
// it is sampled and walked — otherwise a window that contains the ask walks toward the row that quotes it and the
// geometry is handed the answer. One leak-check arm (quotes kept) is scored for the best arm and never eligible to keep.
//
// KNOBS, each a named arm (window × sample × config × metric × stratum):
//   window  ask       the ask alone
//           prev      the assistant turn before it + the ask, trimmed from the FRONT to the eye (the ask always lands)
//           eye       the transcript grown backwards from the ask's own offset (asks and assistant text, real text,
//                     never a paraphrase) until the eye is full, trimmed from the front
//   sample  head800   the row's first 800 chars (what the fold's head walk saw)
//           stride    walk-door's own even-stride sampler (digestForAperture) cut to the window's size-order —
//                     "cut the eye, never grow the mass" (aperture.mjs): target = min(eye, median window chars)
//   config  home      WALK_KNOBS + SEED_APERTURE (the door's home)
//           wide      seed aperture guidedPasses 4 · worms 4 · orthogonal · perm 8
//           deep      knobs maxDepth 12 · topK 3 · budget 400
//           — ONE config on BOTH sides, same cap (the eye), same digest mode; the arm records the aperture id of each side
//   metric  blockL1   block-grid L1 between the two walk pixels (C187a's first metric)
//           cheb      Chebyshev fence distance, symmetric: fenceDist(row pixel, ask fence) + fenceDist(ask pixel, row
//                     fence) — the band the encircled panel paints (shortlex-coords.mjs fenceDist); pixel Chebyshev breaks ties
//           jaccard   1 − Jaccard over the two walks' lit blocks
//           band      fence-banded shape: each lit block of one side banded against the OTHER side's fence (0 green · 1
//                     amber · 2 red, capped), averaged both ways
//   stratum all       every ask, ranked over every row
//           adm       admissible pairs only: the ask walk admissible, ranked over admissible rows, the ask counted only
//                     when an answering row is admissible
// KEEP RULE (stated before the read): z ≥ 2 vs the shuffled-ask null in BOTH halves AND n ≥ 20 in EACH half — n < 20 is
// UNMEASURED, never an estimate, never kept. The family-wise bar zRequired(k looks) is printed beside it. Floor only rises:
// a kept arm is replaced only by one whose weaker-half z is higher. Nothing clears → THE RESEARCH CLAUSE, verbatim, with the
// best arm and its n; the isomorphism stays a target (C176), never a fallback regex.
// WALKS: lensWalk on a SCRATCH tape + receipts dir (never the real tape), session null (no thread latching onto this
// session's prompts), cached by text sha + config + cap. LLM-free.
//
// C176h — THE SNOWBALL WINDOW: the eye window still left 47 of 54 asks refused by the walk's own null test, so the read side is
// walked as a SNOWBALL — window snowK = the ask + the top-k rows by h_allE (read-set.mjs rankRows, the read of record), k grown
// 1..6 in that retro order, capped at the eye, walked under the SAME config and cap as the row. Admissibility is printed per k;
// snowball arms are scored on admissible pairs ONLY (stratum adm). LEAK FENCE: the rows used to grow an ask are excluded from
// that ask's ranked set (a row cannot retrieve itself). FALSIFIER: no snowball arm reaches n ≥ 20 per half at any k → the
// receipt prints SNOWBALL_FALSIFIER verbatim — a measurement either way.
//   node scripts/vna/geo-ratchet.mjs [--transcript <jsonl>] [--scratch <dir>] [--K 200] [--seed 1] [--configs home,wide,deep] [--no-prune] [--no-snowball] [--dry]
// PRUNE (default): home walks the full window × sample grid; wide/deep walk only the window × sample that scored best under home.
// → data/vna/geo-ratchet.json (latest: kept arm or research clause, full leaderboard, meta) + data/vna/geo-ratchet.ndjson (one row per run)
// Port: C176g's scoring is a reading (it DECIDES keep) — its home is the crate once the arm set stops moving (MAXIMISE RUST).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { rng, shuffle, splitHalves, median, hitAt, chanceRank, toRanks, blockL1, jaccardDistance } from './retrieval-bench.mjs';
import { fenceDist, shortLexToBlock } from '../pmu/shortlex-coords.mjs';
import { capFor } from '../../src/lib/pmu/walk-door.mjs';   // C226d: the read cap IS the write cap — read from the door, never typed here
import { MIN_GZIP_BYTES } from '../rewrite/tesseract.mjs';   // C1409: the block `pmu-onchip --constants js` prints — the crate's number, never typed here
import { ask } from './door-crate.mjs';                       // C1409: the floor is DECIDED in the crate (door.rs mass_op); these benches relay its count

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_JSON = resolve(REPO, 'data/vna/geo-ratchet.json');
export const OUT_NDJSON = resolve(REPO, 'data/vna/geo-ratchet.ndjson');
export const SPEC_MD = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
// C226d (2026-09-24): THE READ CAP IS THE WRITE CAP. EYE was typed 900 (BULK_EYE_FINE) while the tree's rows are walked at the door's
// cap for source 'spec-tree' (800). The identity test — 40 tree rows, the row's OWN text through this walker and through walkPixel —
// agreed on 16/40 pixels (Jaccard p50 0.46, admission 20 → 7) at 900 and on 40/40 (Jaccard 1, admission 20 = 20) at 800: the eye
// is the line PLUS the mass, so a 900-char line starves the mass and the two sides read two instruments. One number, one home.
export const EYE = capFor('spec-tree');    // the door's cap for the tree's walk (walk-door LENS_TEXT_MAX) — guard tests/vna/c226d-*
export const HEAD = capFor('spec-tree');   // the fold's head walk — the same number, by construction
export const MIN_N = 20;           // per half; under it a stratum is UNMEASURED
export const Z_BAR = 2;            // per half
export { MIN_GZIP_BYTES };         // C1409: re-exported for ask-corpus / ask-time-fence — below it a reading is length, not meaning
export const SNOW_KS = [1, 2, 3, 4, 5, 6];   // C176h — rows grown onto the ask, in retro order
export const SNOWBALL_FALSIFIER = 'admissibility stayed under 20 pairs per half at every k — the read side cannot be walked as a snowball as it stands (C176h)';
export const RESEARCH_CLAUSE = 'no geometry arm clears the bar at a matched eye with ≥20 admissible pairs — the isomorphism stays a target (C176), never a fallback regex';
const sha12 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : 0; };

// C1409 (operator, 2026-10-29: "rust only"): how many of these texts sit under the phantom-mass floor is the CRATE's count (door.rs
// mass_op, floor "gz" on the bytes as given — the same bytes this module walks). { under, floor, reason }; under null when the crate
// did not answer, never a node comparison in its place. Shared by ask-corpus.mjs and ask-time-fence.mjs.
export async function crateUnderGzFloor(texts) {
  try {
    const r = await ask('mass', { texts: texts.map((t, i) => ({ field: String(i), text: String(t ?? '') })), floor: 'gz', trim: false });
    if (!r || !Array.isArray(r.sizes) || r.sizes.length !== texts.length || typeof r.under !== 'number') return { under: null, floor: null, reason: 'UNMEASURED — the crate answered no at-mass decision (a binary older than C1409)' };
    return { under: r.under, floor: r.floor ? r.floor.gz_bytes : null, reason: null };
  } catch (e) {
    return { under: null, floor: null, reason: `UNMEASURED — the crate could not decide the floor (${String((e && e.message) || e).slice(0, 120)}); rust only` };
  }
}

export const WINDOWS = ['ask', 'prev', 'eye'];
export const SAMPLES = ['head800', 'stride'];
export const METRICS = ['blockL1', 'cheb', 'jaccard', 'band'];
export const STRATA = ['all', 'adm'];
// the three walk configs of C176d's meta.walk_configs, as options lensWalk takes (knobs are floored at the home by the door)
export async function walkConfigs() {
  const { WALK_KNOBS, SEED_APERTURE } = await import('../../src/lib/pmu/walk-knobs.mjs');
  return {
    home: { knobs: { ...WALK_KNOBS }, seedAperture: { ...SEED_APERTURE } },
    wide: { knobs: { ...WALK_KNOBS }, seedAperture: { ...SEED_APERTURE, guidedPasses: 4, worms: 4, wormsOrthogonal: true, perm: 8 } },
    deep: { knobs: { ...WALK_KNOBS, maxDepth: 12, topK: 3, budget: 400 }, seedAperture: { ...SEED_APERTURE } },
  };
}
// the aperture id of ONE side of an arm: the eye cap, the digest mode, and the walk config (knobs + seed aperture). Both sides
// of an arm are walked with the same object, so both carry the same id — the thing C176d's three apertures did not.
export function apertureIdOf(cfg, cap) {
  const k = cfg.knobs || {}, a = cfg.seedAperture || {};
  return `t${cap}h·k${k.maxDepth}t${k.topK}b${k.budget}·g${a.guidedPasses ?? '-'}w${a.worms ?? 0}${a.wormsOrthogonal ? 'o' : ''}p${a.perm ?? 0}`;
}

// ── text ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// every operator quote in a spec row (*"…"* and the curly form) removed — the leak-free row
export const stripOperatorQuotes = (t) => String(t).replace(/\*"[^"]*"\*/g, ' ').replace(/\*“[^”]*”\*/g, ' ').replace(/\s+/g, ' ').trim();
export function specRowsFrom(md) {
  const seen = new Set(); const rows = [];
  for (const l of md.split('\n')) { const m = l.match(/^\s*- \[([ x~])\] (C\d+[a-z]?)\b(.*)$/); if (m && !seen.has(m[2])) { seen.add(m[2]); rows.push({ id: m[2], text: m[3] }); } }
  return rows;
}
const tailTo = (s, n) => { s = String(s); return s.length <= n ? s : s.slice(s.length - n); };
// the ask's three windows from the transcript it was typed in. The sequence is rebuilt with transcript-asks' own cleanAsk and
// dedupe so ask i here is ask i of audit(); assistant text blocks are the other half of the sequence.
export async function askWindows(transcript, eye = EYE) {
  const { cleanAsk } = await import('./transcript-asks.mjs');
  const norm = (s) => String(s).toLowerCase().replace(/[*_`"“”'’]/g, '').replace(/\s+/g, ' ').trim();
  const seq = []; const seen = new Set();
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; }
    let raw = null;
    if (r.type === 'user' && typeof r.message?.content === 'string' && !r.isMeta) raw = r.message.content;
    else if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string') raw = r.content;
    else if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
      const t = r.message.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n').trim();
      if (t) seq.push({ role: 'assistant', text: t }); continue;
    }
    if (raw == null) continue;
    const c = cleanAsk(raw); if (!c) continue;
    const key = norm(c.text).slice(0, 200); if (seen.has(key)) continue; seen.add(key);
    seq.push({ role: 'ask', text: c.text });
  }
  const out = [];
  seq.forEach((e, i) => {
    if (e.role !== 'ask') return;
    let j = i - 1; while (j >= 0 && seq[j].role !== 'assistant') j--;
    const prevParts = []; while (j >= 0 && seq[j].role === 'assistant') { prevParts.unshift(seq[j].text); j--; }
    const ask = e.text.slice(0, eye);
    const room = Math.max(0, eye - ask.length - 1);
    const prev = prevParts.length && room ? tailTo(prevParts.join('\n'), room) + '\n' + ask : ask;
    let back = ''; for (let k = i - 1; k >= 0 && back.length < room; k--) back = seq[k].text + (back ? '\n' + back : '');
    const win = back && room ? tailTo(back, room) + '\n' + ask : ask;
    out.push({ text: e.text, windows: { ask, prev, eye: win } });
  });
  return out;
}
// C176h — the snowball windows of one ask: ask first (it always lands), then the ranked rows in retro order, cut at the eye.
// used = the rows that actually reached the window (a row the cap cut off entirely was not used, so it is not fenced).
export function snowballWindows(askText, rankedIds, textById, { ks = SNOW_KS, eye = EYE } = {}) {
  const ask = String(askText).slice(0, eye);
  return ks.map((k) => {
    let text = ask; const used = [];
    for (const id of rankedIds.slice(0, k)) { if (text.length >= eye) break; used.push(id); text += '\n' + String(textById[id] || ''); }
    return { k, text: text.slice(0, eye), used };
  });
}
export async function rowSample(text, sample, target) {
  if (sample === 'head800') return String(text).slice(0, HEAD);
  const { digestForAperture } = await import('../../src/lib/pmu/walk-door.mjs');
  return digestForAperture(String(text), target);
}

// ── the metrics over two walk records { pixel, cells, fence } ─────────────────────────────────────────────────────────────
const blockOf = (coord) => { const { br, bc } = shortLexToBlock(coord); return br < 0 || bc < 0 ? null : [br, bc]; };
const cheb2 = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
export const METRIC_FN = {
  blockL1: (a, r) => blockL1(a.pixel, r.pixel),
  cheb: (a, r) => { const pa = blockOf(a.pixel), pr = blockOf(r.pixel); if (!pa || !pr || !a.fence || !r.fence) return Infinity;
    return fenceDist(pr[0], pr[1], a.fence) + fenceDist(pa[0], pa[1], r.fence) + 1e-3 * cheb2(pa, pr); },
  jaccard: (a, r) => jaccardDistance(a.cells, r.cells),
  band: (a, r) => { if (!a.fence || !r.fence || !(a.cells || []).length || !(r.cells || []).length) return Infinity;
    const side = (cells, f) => mean(cells.map(blockOf).filter(Boolean).map(([br, bc]) => Math.min(2, fenceDist(br, bc, f))));
    return (side(r.cells, a.fence) + side(a.cells, r.fence)) / 2; },
};

// ── scoring one arm ──────────────────────────────────────────────────────────────────────────────────────────────────────
// askW[id] / rowW[rowId] = walk records; truth[id] = answering row ids. Returns per-half { n, median, mean, hit10, z, … } and
// the status under the keep rule. Ranks are mid-ranks over the stratum's rows; the null permutes truth sets across the half's asks.
// exclude[askId] = a Set of row ids fenced out of THAT ask's ranked set (C176h's leak fence: the rows it was grown from).
export function scoreArm({ askIds, truth, askW, rowW, metric, stratum, halves, K = 200, seed = 1, exclude = null }) {
  const fn = METRIC_FN[metric];
  const rowIds = Object.keys(rowW).filter((r) => rowW[r] && rowW[r].pixel && (stratum !== 'adm' || rowW[r].admissible));
  const rowsFor = (id) => exclude && exclude[id] ? rowIds.filter((r) => !exclude[id].has(r)) : rowIds;
  const inStratum = askIds.filter((id) => { const rs = rowsFor(id); return askW[id] && askW[id].pixel && (stratum !== 'adm' || askW[id].admissible) && truth[id].some((t) => rs.includes(t)); });
  const rankMap = {};
  for (const id of inStratum) { const d = {}; for (const r of rowsFor(id)) d[r] = fn(askW[id], rowW[r]); rankMap[id] = toRanks(d); }
  const rankFor = (id, tr) => { let b = Infinity; for (const t of tr) { const v = rankMap[id][t]; if (v != null && v < b) b = v; } return b; };
  const halvesOut = {};
  for (const [name, ids0] of Object.entries(halves)) {
    const ids = ids0.filter((id) => rankMap[id]);
    const obs = ids.map((id) => rankFor(id, truth[id]));
    const r = rng(seed); const samples = [];
    for (let k = 0; k < K && ids.length > 1; k++) { const s = shuffle(ids, r); samples.push(mean(ids.map((id, i) => { const v = rankFor(id, truth[s[i]]); return Number.isFinite(v) ? v : chanceRank(rowIds.length); }))); }
    const nm = mean(samples), ns = sd(samples), om = mean(obs);
    halvesOut[name] = { n: ids.length, median: median(obs), mean: om == null ? null : +om.toFixed(1), hit1: hitAt(obs, 1), hit10: hitAt(obs, 10), chance: chanceRank(rowIds.length), null_mean: nm == null ? null : +nm.toFixed(1), null_sd: +ns.toFixed(2), z: ns > 0 ? +((nm - om) / ns).toFixed(2) : 0 };
  }
  return { rows_n: rowIds.length, asks_n: inStratum.length, halves: halvesOut, ...verdict(halvesOut) };
}
// THE KEEP RULE — n ≥ MIN_N in each half first (else UNMEASURED, never kept), then z ≥ Z_BAR in each half
export function verdict(halves) {
  const hs = Object.values(halves); const minN = Math.min(...hs.map((h) => h.n)); const minZ = Math.min(...hs.map((h) => h.z));
  if (!(minN >= MIN_N)) return { status: `UNMEASURED (n ${hs.map((h) => h.n).join('|')} < ${MIN_N})`, keep: false, min_n: minN, min_z: minZ };
  return minZ >= Z_BAR ? { status: 'CLEARS', keep: true, min_n: minN, min_z: minZ } : { status: 'does not clear', keep: false, min_n: minN, min_z: minZ };
}
// FLOOR ONLY RISES: the previous kept arm survives unless this run keeps one whose weaker-half z is strictly higher
export function mergeFloor(prev, run) {
  const prevKept = prev && prev.kept ? prev.kept : null;
  const cands = (run.leaderboard || []).filter((a) => a.keep && !a.leak_check);
  const best = cands.sort((x, y) => y.min_z - x.min_z)[0] || null;
  if (best && (!prevKept || best.min_z > prevKept.min_z)) return { kept: { ...best, kept_at: run.at }, clause: null, floor_moved: true };
  if (prevKept) return { kept: prevKept, clause: null, floor_moved: false };
  const top = [...(run.leaderboard || [])].filter((a) => !a.leak_check).sort((x, y) => (y.min_z ?? -99) - (x.min_z ?? -99))[0] || null;
  return { kept: null, clause: RESEARCH_CLAUSE, best: top ? { name: top.name, min_n: top.min_n, min_z: top.min_z, status: top.status } : null, floor_moved: false };
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// walker(text, { config, cfg, cap, side: 'ask'|'row' }) → { pixel, cells, fence, admissible, ms, cached }. Injectable (the guard passes a fake).
export async function runGeo({ asks, rows, walker, configs, configNames = ['home', 'wide', 'deep'], prune = true, K = 200, seed = 1, eye = EYE, leakRows = null, prev = null, onPartial = null, transcript = null, zRequired = null } = {}) {
  const t0 = Date.now(); const walks = { count: 0, cached: 0, ms: 0, failed: 0 };
  const walk = async (text, name, cap, side) => { const w = await walker(text, { config: name, cfg: configs[name], cap, side }); if (w.cached) walks.cached++; else { walks.count++; walks.ms += Number(w.ms) || 0; } if (!w.pixel) walks.failed++; return w; };
  const askIds = asks.map((_, i) => `q${i}`); const truth = Object.fromEntries(asks.map((a, i) => [`q${i}`, a.truth]));
  const halves = (() => { const { A, B } = splitHalves(askIds, seed); return { 'A→B': B, 'B→A': A }; })();   // arms fit nothing; the name keeps C176d's fold labels (scored on the named half)
  const target = Object.fromEntries(WINDOWS.map((w) => [w, Math.min(eye, Math.round(median(asks.map((a) => a.windows[w].length))))]));
  const winFloor = {}; for (const w of WINDOWS) winFloor[w] = await crateUnderGzFloor(asks.map((a) => a.windows[w]));   // C1409: the crate's count
  const winGzipUnder = Object.fromEntries(WINDOWS.map((w) => [w, winFloor[w].under]));
  const winGzipFloor = WINDOWS.map((w) => winFloor[w].floor).find((x) => x != null) ?? null;
  const winGzipWhy = WINDOWS.map((w) => winFloor[w].reason).find(Boolean) || null;
  const leaderboard = []; const adm = { ask: {}, row: {} };
  let winSet = WINDOWS, sampSet = SAMPLES; const pruned = [];
  const hasSnow = asks.length > 0 && asks.every((a) => Array.isArray(a.snowball)); const snowAdm = {};
  const fence = { excluded_pairs: 0, truth_fenced: 0 };
  if (hasSnow) for (const a of asks) for (const s of a.snowball) { fence.excluded_pairs += s.used.length; fence.truth_fenced += s.used.filter((id) => a.truth.includes(id)).length; }
  const isSnow = (a) => /^snow\d/.test(a.window);
  for (const name of configNames) {
    // THE PRUNE (budget, stated before the read): the first config walks the full window × sample grid; every later config
    // walks only the window × sample whose best arm scored highest (weaker-half z) under the first — named in meta.pruned
    if (prune && name !== configNames[0] && winSet === WINDOWS) {
      const b = leaderboard.filter((a) => !isSnow(a)).sort((x, y) => (y.min_z ?? -99) - (x.min_z ?? -99))[0];
      if (b) { winSet = [b.window]; sampSet = [b.sample === 'head800' ? 'head800' : 'stride']; pruned.push({ after: configNames[0], window: b.window, sample: b.sample, by: b.name, min_z: b.min_z }); }
    }
    const cfg = configs[name]; const apId = apertureIdOf(cfg, eye);
    const askW = {}; for (const w of winSet) { askW[w] = {}; for (let i = 0; i < asks.length; i++) askW[w][`q${i}`] = await walk(asks[i].windows[w], name, eye, 'ask'); adm.ask[`${name}/${w}`] = Object.values(askW[w]).filter((x) => x.admissible).length; }
    const rowW = {};
    for (const s of sampSet) for (const tgt of new Set(s === 'head800' ? [HEAD] : winSet.map((w) => target[w]))) {
      const key = s === 'head800' ? 'head800' : `stride${tgt}`; rowW[key] = {};
      for (const r of rows) rowW[key][r.id] = await walk(await rowSample(r.text, s, tgt), name, eye, 'row');
      adm.row[`${name}/${key}`] = Object.values(rowW[key]).filter((x) => x.admissible).length;
    }
    for (const w of winSet) for (const s of sampSet) {
      const key = s === 'head800' ? 'head800' : `stride${target[w]}`;
      for (const m of METRICS) for (const st of STRATA) {
        const sc = scoreArm({ askIds, truth, askW: askW[w], rowW: rowW[key], metric: m, stratum: st, halves, K, seed });
        leaderboard.push({ name: `${w}·${key}·${name}·${m}·${st}`, window: w, sample: key, config: name, metric: m, stratum: st, aperture_id: { ask: apId, row: apId }, ...sc });
      }
    }
    // C176h — the snowball windows, walked under THIS config at THIS cap, scored admissible-only against every row sample
    // this config walked, with each ask's grow rows fenced out of its own ranked set
    if (hasSnow) {
      snowAdm[name] = {};
      for (const k of SNOW_KS) {
        const w = `snow${k}`; const aw = {}; const exclude = {};
        for (let i = 0; i < asks.length; i++) { const s = asks[i].snowball.find((x) => x.k === k); aw[`q${i}`] = await walk(s.text, name, eye, 'ask'); exclude[`q${i}`] = new Set(s.used); }
        const pairs = {};
        for (const key of Object.keys(rowW)) for (const m of METRICS) {
          const sc = scoreArm({ askIds, truth, askW: aw, rowW: rowW[key], metric: m, stratum: 'adm', halves, K, seed, exclude });
          leaderboard.push({ name: `${w}·${key}·${name}·${m}·adm`, window: w, sample: key, config: name, metric: m, stratum: 'adm', k, aperture_id: { ask: apId, row: apId }, ...sc });
          for (const [h, v] of Object.entries(sc.halves)) pairs[h] = Math.max(pairs[h] ?? 0, v.n);
        }
        snowAdm[name][k] = { admissible_asks: Object.values(aw).filter((x) => x.admissible).length, n_asks: asks.length, adm_pairs_per_half: pairs };
      }
    }
    if (onPartial) onPartial({ at: new Date().toISOString(), partial: true, configs_done: configNames.slice(0, configNames.indexOf(name) + 1), leaderboard, walks });
  }
  // the leak check: the best arm again with the row quotes KEPT — never eligible to keep
  const ranked = leaderboard.filter((a) => !isSnow(a)).sort((x, y) => (y.min_z ?? -99) - (x.min_z ?? -99));   // the leak check re-walks a WINDOW arm; snowball rows are already quote-stripped
  const bestArm = ranked[0];
  if (leakRows && bestArm) {
    const cfg = configs[bestArm.config]; const tgt = bestArm.sample === 'head800' ? HEAD : Number(bestArm.sample.replace('stride', ''));
    const askW = {}; for (let i = 0; i < asks.length; i++) askW[`q${i}`] = await walk(asks[i].windows[bestArm.window], bestArm.config, eye, 'ask');
    const rowW = {}; for (const r of leakRows) rowW[r.id] = await walk(await rowSample(r.text, bestArm.sample === 'head800' ? 'head800' : 'stride', tgt), bestArm.config, eye, 'row');
    const sc = scoreArm({ askIds, truth, askW, rowW, metric: bestArm.metric, stratum: bestArm.stratum, halves, K, seed });
    leaderboard.push({ name: bestArm.name + '+quotes', leak_check: true, window: bestArm.window, sample: bestArm.sample, config: bestArm.config, metric: bestArm.metric, stratum: bestArm.stratum, aperture_id: { ask: apertureIdOf(cfg, eye), row: apertureIdOf(cfg, eye) }, ...sc, keep: false });
  }
  const looks = leaderboard.filter((a) => !a.leak_check).length;
  const zReq = zRequired ? zRequired(looks) : null;
  for (const a of leaderboard) a.clears_familywise = zReq == null ? null : a.min_n >= MIN_N && a.min_z >= zReq;
  const run = { at: new Date().toISOString(), transcript, keep_rule: `n ≥ ${MIN_N} AND z ≥ ${Z_BAR} vs the K=${K} shuffled-ask null in BOTH halves (UNMEASURED under n ${MIN_N}); family-wise bar zRequired(${looks}) = ${zReq} printed beside`,
    leaderboard: leaderboard.sort((x, y) => (y.min_z ?? -99) - (x.min_z ?? -99)),
    meta: { n_asks: asks.length, n_rows: rows.length, eye, head: HEAD, window_target_chars: target, window_median_chars: Object.fromEntries(WINDOWS.map((w) => [w, median(asks.map((a) => a.windows[w].length))])),
      windows_under_gzip_floor: winGzipUnder, gzip_floor: winGzipFloor, ...(winGzipWhy ? { gzip_floor_reason: winGzipWhy } : {}), admissible_ask_walks: adm.ask, admissible_row_walks: adm.row, walks: { ...walks, ms: Math.round(walks.ms), ms_per_walk: walks.count ? Math.round(walks.ms / walks.count) : null },
      configs: Object.fromEntries(configNames.map((n) => [n, apertureIdOf(configs[n], eye)])), pruned, K, seed, looks, z_required_familywise: zReq, elapsed_ms: Date.now() - t0,
      snowball: hasSnow ? { ks: SNOW_KS, admissible_by_k: snowAdm, fence } : null,
      level_ground: 'operator quotes (*"…"*) removed from every row before sampling; one leak-check arm (+quotes) scored for the best arm, never eligible' } };
  const floor = mergeFloor(prev, run);
  const snowBest = hasSnow ? Math.max(0, ...leaderboard.filter(isSnow).map((a) => a.min_n)) : null;
  const snowball_clause = hasSnow ? (snowBest >= MIN_N ? null : SNOWBALL_FALSIFIER) : null;
  return { ...run, ...floor, snowball_clause, history_n: (prev?.history_n || 0) + 1 };
}

// the geometry leg, one line for read-write-relation --distance: kept arm · n · z per half · gap to the kept read (h_allE)
export function geoLine(geo, readRatchet = null) {
  if (!geo || !Array.isArray(geo.leaderboard)) return 'geometry leg (C176g) · UNMEASURED — no data/vna/geo-ratchet.json (run scripts/vna/geo-ratchet.mjs)';
  const hk = readRatchet?.kept?.folds || {};
  const fmt = (a) => Object.entries(a.halves || {}).map(([h, v]) => `${h} n ${v.n} median ${v.median} hit@10 ${v.hit10} z ${v.z}${hk[h] ? ` (gap to ${readRatchet.kept.name} ${+(v.median - hk[h].median).toFixed(2)})` : ''}`).join(' · ');
  if (geo.kept) return `geometry leg (C176g, ${String(geo.kept.kept_at || geo.at).slice(0, 10)}) · kept ${geo.kept.name} [${geo.kept.aperture_id?.ask}] · ${fmt(geo.kept)}${geo.snowball_clause ? ` · snowball (C176h): ${geo.snowball_clause}` : ''}`;
  const best = geo.leaderboard.find((a) => !a.leak_check && !/^snow\d/.test(a.window));
  const snow = geo.snowball_clause ? ` · snowball (C176h): ${geo.snowball_clause}` : '';
  return `geometry leg (C176g, ${String(geo.at).slice(0, 10)}) · ${geo.clause || RESEARCH_CLAUSE} · best ${best ? `${best.name} [${best.status}] · ${fmt(best)}` : 'none'}${snow}`;
}

export function printRun(o) {
  const L = [`geo-ratchet · ${o.meta.n_asks} asks × ${o.meta.n_rows} rows · eye ${o.meta.eye} · walks ${o.meta.walks.count} new (${o.meta.walks.ms_per_walk} ms) + ${o.meta.walks.cached} cached · ${(o.meta.elapsed_ms / 60000).toFixed(1)} min`];
  L.push(`  window median chars ${JSON.stringify(o.meta.window_median_chars)} · under the ${o.meta.gzip_floor}-byte gzip floor ${JSON.stringify(o.meta.windows_under_gzip_floor)}`);
  L.push(`  admissible ask walks ${JSON.stringify(o.meta.admissible_ask_walks)}`);
  L.push(`  admissible row walks ${JSON.stringify(o.meta.admissible_row_walks)}`);
  const sn = o.meta.snowball;
  if (sn) for (const [cfgName, per] of Object.entries(sn.admissible_by_k)) for (const [k, v] of Object.entries(per)) L.push(`  snowball k${k} · ${cfgName} · admissible ${v.admissible_asks}/${v.n_asks} asks · adm pairs per half ${Object.entries(v.adm_pairs_per_half).map(([h, n]) => `${h} ${n}`).join(' · ')}`);
  if (sn) L.push(`  snowball leak fence · ${sn.fence.excluded_pairs} ask×row pairs fenced · ${sn.fence.truth_fenced} of them an answering row`);
  if (o.snowball_clause) L.push(`  ${o.snowball_clause}`);
  L.push('  arm                                         half  n   median  hit@10  z      status');
  for (const a of o.leaderboard) for (const [h, v] of Object.entries(a.halves)) L.push(`  ${(a.name).padEnd(43)} ${h} ${String(v.n).padStart(3)} ${String(v.median).padStart(7)} ${String(v.hit10).padStart(6)}  ${String(v.z).padStart(6)}  ${a.status}${a.leak_check ? ' (leak check)' : ''}`);
  L.push(o.kept ? `  KEPT ${o.kept.name} (min z ${o.kept.min_z}, min n ${o.kept.min_n})` : `  ${o.clause} · best ${o.best?.name} n ${o.best?.min_n} min z ${o.best?.min_z}`);
  return L.join('\n');
}

// THE ONE WALKER, cached by text sha + aperture id on a SCRATCH tape (never the real tape), session null, LLM-free. Exported
// so C176k's ask-time-fence.mjs walks through the same door with the same cache — one walker, one place (extracted on first
// duplication). A DEFERRED walk (the door's load budget) is retried, never scored as a placement and never cached.
export async function makeCachedWalker(scratch) {
  const { lensWalk } = await import('../../src/lib/pmu/walk-door.mjs');
  mkdirSync(scratch, { recursive: true }); const cacheFile = join(scratch, 'geo-walk-cache.json');
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}; let dirty = 0;
  const flush = () => { if (dirty) { writeFileSync(cacheFile, JSON.stringify(cache)); dirty = 0; } };
  const walker = async (text, { config, cfg, cap }) => {
    const key = `${sha12(text)}:${apertureIdOf(cfg, cap)}`; if (cache[key]) return { ...cache[key], cached: true };
    let result, row;
    for (let t = 0; t < 4; t++) { ({ result, row } = lensWalk(text, { source: 'probe', tape: join(scratch, 'probe-tape.ndjson'), receiptsDir: join(scratch, 'receipts'), timeoutMs: 6000, maxChars: cap, session: null, knobs: cfg.knobs, seedAperture: cfg.seedAperture })); if (!(row.budget && row.budget.deferred)) break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); }
    const r = { pixel: row.pixel, cells: row.cells || [], fence: result?.fence || null, admissible: !!row.admissible, ms: row.ms, door_aperture_id: row.aperture_id, err: row.err };
    if (r.pixel) { cache[key] = r; if (++dirty >= 100) flush(); }
    return r;
  };
  return { walker, flush };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  let transcript = arg('--transcript', null);
  if (!transcript) { try { transcript = JSON.parse(readFileSync(resolve(REPO, 'data/vna/retrieval-bench.json'), 'utf8')).transcript; } catch {} }   // the bench's own ground-truth transcript
  if (!transcript || !existsSync(transcript)) { const { newestSession } = await import('./transcript-asks.mjs'); transcript = newestSession(); }
  const scratch = resolve(arg('--scratch', join(tmpdir(), 'thetacog-geo-ratchet')));
  const K = Number(arg('--K', 200)), seed = Number(arg('--seed', 1)); const dry = argv.includes('--dry');
  const { audit } = await import('./transcript-asks.mjs');
  const md = readFileSync(SPEC_MD, 'utf8'); const raw = specRowsFrom(md);
  const rows = raw.map((r) => ({ id: r.id, text: stripOperatorQuotes(r.text) })); const ids = new Set(rows.map((r) => r.id));
  const au = audit({ transcript }); const wins = await askWindows(transcript);
  if (wins.length !== au.asks.length) throw new Error(`window sequence ${wins.length} ≠ audit asks ${au.asks.length} — refuse rather than misalign`);
  // C176h — each ask's snowball: its rows ranked by the read of record (h_allE over the quote-stripped rows + their commit mass)
  const { rankRows, loadMassCache, activeConfig } = await import('./read-set.mjs');
  const mass = loadMassCache(); const readCfg = activeConfig();
  const readRows = rows.map((r) => ({ id: r.id, text: r.text, extra: mass[r.id]?.extra || '', files: mass[r.id]?.files || [] }));
  const textById = Object.fromEntries(rows.map((r) => [r.id, r.text]));
  const snow = argv.includes('--no-snowball') ? null : (t) => snowballWindows(t, rankRows(t, readRows, readCfg).map((s) => s.id), textById);
  const asks = au.asks.map((a, i) => ({ text: a.text, truth: a.rows.map((r) => r.id).filter((id) => ids.has(id)), windows: wins[i].windows, ...(snow ? { snowball: snow(wins[i].windows.ask) } : {}) })).filter((a) => a.truth.length);
  const configs = await walkConfigs(); const { walker, flush } = await makeCachedWalker(scratch);
  let prev = null; try { prev = JSON.parse(readFileSync(OUT_JSON, 'utf8')); if (prev.partial) prev = prev.prev_final || null; } catch {}
  const { zRequired } = await import('../pmu/knob-ratchet.mjs');
  const onPartial = dry ? null : (p) => { flush(); writeFileSync(OUT_JSON, JSON.stringify({ ...p, prev_final: prev }, null, 1) + '\n'); console.error(`… partial: ${p.configs_done.join(',')} · ${p.leaderboard.length} arms · ${p.walks.count} walks`); };
  const leakRows = raw.map((r) => ({ id: r.id, text: r.text }));
  const out = await runGeo({ asks, rows, walker, configs, configNames: String(arg('--configs', 'home,wide,deep')).split(','), prune: !argv.includes('--no-prune'), K, seed, leakRows, prev, onPartial, transcript, zRequired });
  flush();
  console.log(printRun(out));
  if (!dry) {
    writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + '\n');
    appendFileSync(OUT_NDJSON, JSON.stringify({ at: out.at, transcript, kept: out.kept ? { name: out.kept.name, min_z: out.kept.min_z, min_n: out.kept.min_n } : null, clause: out.clause, best: out.leaderboard.filter((a) => !a.leak_check)[0]?.name, best_min_z: out.leaderboard.filter((a) => !a.leak_check)[0]?.min_z, arms: out.leaderboard.length, walks: out.meta.walks, floor_moved: out.floor_moved }) + '\n');
    console.log(`→ data/vna/geo-ratchet.json · data/vna/geo-ratchet.ndjson`);
  }
}
