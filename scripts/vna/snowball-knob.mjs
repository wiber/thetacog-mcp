#!/usr/bin/env node
// scripts/vna/snowball-knob.mjs — C93g THE CAP IS A KNOB, NOT A CONSTANT — AND SO IS THE APERTURE (operator 2026-09-19: "hope we
// are not stuck on the fifteen hundred tokens for the sub and snowballs, because that's an optimisation and aperture target").
// Two knobs, one ratchet. The snowball's { cap, count, packing } per predicted SHAPE (C93f: spread · focused · spread+focused ·
// narrow) lives in data/vna/snowball-knob.json; the walk's aperture in force is apertureVersion() (prompt-lens.mjs). Both ride the
// runner's dispatch row as `snowball: { cap, count, packing, aperture, knob_v, shape }`, and both move only on the cog's evidence:
// a setting moves when the median tokens-per-cog on ≥ MIN_WITNESSED witnessed rows at that setting beats the peg (C93c) for the same
// band and shape — the move is a row on data/vna/snowball-knob.ndjson; a setting that does not beat the peg leaves the file byte-
// unchanged. BUNDLE_TOKEN_CAP (spec-tree.mjs, C82e) is never edited by the knob; it is the INCUMBENT every shape starts at.
// v1 is 1500 × 1 for every shape — nothing changes until a row says so.
//
// C228 — THE CONFIGURATION IS RATCHETED ON THE LAND RATE (operator's pasted goal 2026-09-24: *"The static 1500-token snowball limit
// and current walk caps are unmeasured hypotheses … The configuration itself is the target of the optimization."*; operator
// 2026-09-26: *"the 1500 limit is an optimisation target, why is this still a question.. the configs are all optimisation target"*).
// Two changes. (1) 1,500 is no longer a FLOOR: a setting anywhere in [BUNDLE_CAP_MIN, BUNDLE_CAP_MAX] (500–16000, spec-tree.mjs) is
// a candidate — the knob can move DOWN as well as up. (2) Tokens-per-cog beating the peg is no longer enough: a move also needs the
// LAND RATE per engine on the runner ledger (dispatches at the candidate setting that ended in a ticked row, landBySetting) to rise
// over the incumbent setting's, ≥ MIN_WITNESSED dispatches on each side, both intervals written on the move row. knobProvenance()
// is the falsifier as a reader: a value in force with no move row showing it beat the one before it.
//
//   node scripts/vna/snowball-knob.mjs [--json]      print the knob in force and the setting each shape dispatches at
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BUNDLE_TOKEN_CAP, BUNDLE_CAP_MIN, BUNDLE_CAP_MAX, bundle as bundleOf } from './spec-tree.mjs';
import { wilson } from '../pmu/wilson-n-to-bind.mjs';   // C228: the interval on each side of a move

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const KNOB_PATH = process.env.VNA_SNOWBALL_KNOB || resolve(REPO, 'data/vna/snowball-knob.json');
export const KNOB_NDJSON = process.env.VNA_SNOWBALL_KNOB_NDJSON || resolve(REPO, 'data/vna/snowball-knob.ndjson');
export const PREDICT_NDJSON = process.env.VNA_COG_PREDICT || resolve(REPO, 'data/vna/cog-predict.ndjson');
export const KNOB_START = BUNDLE_TOKEN_CAP;   // the incumbent every shape starts at — read, never re-typed
export const KNOB_FLOOR = BUNDLE_CAP_MIN;     // C228: the lowest SETTING is the bundle's own minimum, never the 1,500 incumbent
export const MIN_WITNESSED = 10;
export const MAX_ENVELOPES = 6;   // the per-basin set is capped in count, and so in total tokens (cap × count)
export const SHAPES = ['spread', 'focused', 'spread+focused', 'narrow'];
const ndRows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

const PACKING = {
  spread: 'interface signatures across the active basins',
  focused: 'the local fixture, the red witness, the target function',
  'spread+focused': 'interface signatures across the active basins, then the target function',
  narrow: 'the unit row and its parents',
};
export function defaultKnob() {
  return { v: 1, floor: KNOB_FLOOR, by_shape: Object.fromEntries(SHAPES.map((s) => [s, { cap: KNOB_START, count: 1, packing: PACKING[s] }])),
    cites: { start: 'BUNDLE_TOKEN_CAP in scripts/vna/spec-tree.mjs (C82e) — the incumbent, never edited by the knob', floor: 'BUNDLE_CAP_MIN (C228) — 1,500 is a target, not a floor', moves: 'data/vna/snowball-knob.ndjson', peg: 'data/vna/cog-peg.json (C93c)', shape: 'data/vna/cog-predict.ndjson (C93f)' } };
}
export function readKnob(path = KNOB_PATH) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return defaultKnob(); } }
const clampCap = (c) => { const n = Number(c); return Number.isFinite(n) ? Math.min(BUNDLE_CAP_MAX, Math.max(KNOB_FLOOR, Math.round(n))) : KNOB_START; };
/** C228 — the land rate of one setting on the runner ledger: dispatches of `preset` at `cap` (the dispatch row's cap) → verdict rows
 *  at the same preset and cap that were ok AND ticked the row. The same reading C334's engineLine takes, split by setting. */
export function landBySetting(rows, { preset, cap }) {
  const at = (r) => r.preset === preset && Number(r.cap ?? (r.snowball && r.snowball.cap)) === Number(cap);
  const n = rows.filter((r) => r.kind === 'dispatch' && at(r)).length;
  const x = rows.filter((r) => r.kind === 'verdict' && at(r) && r.ok && r.ticked).length;
  const w = n ? wilson(x, n) : null;
  return { preset, cap: Number(cap), n, x, rate: n ? x / n : null, wilson95: w ? [Math.max(0, +w.low.toFixed(3)), Math.min(1, +w.high.toFixed(3))] : null };
}
/** C228's falsifier as a reader: every shape whose setting differs from v1 must have a move row landing on it */
export function knobProvenance(knob = readKnob(), moves = ndRows(KNOB_NDJSON)) {
  const unproven = [];
  for (const s of SHAPES) { const k = knob.by_shape && knob.by_shape[s]; if (!k) continue;
    if (Number(k.cap) === KNOB_START && String(k.count) === '1') continue;
    if (!moves.some((m) => m.shape === s && m.to && Number(m.to.cap) === Number(k.cap) && String(m.to.count) === String(k.count) && m.land)) unproven.push({ shape: s, cap: k.cap, count: k.count, why: 'no move row with a land-rate reading lands on this setting' }); }
  return { ok: unproven.length === 0, unproven };
}

/** the row's predicted shape — the newest C93f prediction for the label; UNMEASURED rows dispatch at the narrow setting */
export function shapeOf(label, rows = ndRows(PREDICT_NDJSON)) {
  let hit = null; for (const r of rows) if (r.label === label && r.status === 'predicted' && r.shape) hit = r;
  return hit ? { shape: hit.shape, band: hit.band || null, source: 'cog-predict.ndjson (C93f)' } : { shape: null, band: null, why: `no C93f prediction for ${label}` };
}

/** the setting a dispatch rides: the knob's row for the shape, the cap held at or above the floor, the aperture stamped beside it */
export function settingFor({ label, shape = undefined, knob = readKnob(), aperture = null, predictRows = undefined } = {}) {
  const sh = shape !== undefined ? { shape, band: null } : shapeOf(label, predictRows);
  const key = SHAPES.includes(sh.shape) ? sh.shape : 'narrow';
  const s = (knob.by_shape && knob.by_shape[key]) || { cap: KNOB_START, count: 1, packing: PACKING[key] };
  const count = s.count === 'per_basin' ? 'per_basin' : Math.max(1, Math.min(MAX_ENVELOPES, Math.round(Number(s.count) || 1)));
  return { cap: clampCap(s.cap), count, packing: s.packing || PACKING[key], aperture, knob_v: knob.v, shape: sh.shape || null, setting_shape: key, ...(sh.why ? { shape_why: sh.why } : {}) };
}

/** the basins a row touches: its own, then every other spec label its text names that is a live basin on the tree (sorted) */
export function basinsTouched(tree, label) {
  const N = (tree && tree.nodes) || {}; const own = N[`n_spec_${label}`]; if (!own) return [];
  const text = (own.content && own.content.text) || '';
  const named = [...new Set((text.match(/\bC\d+[a-z]?(?:\.\d+)?\b/g) || []))].filter((l) => l !== label && N[`n_spec_${l}`] && !N[`n_spec_${l}`].retracted).sort();
  return [label, ...named];
}
const sha8 = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 8);
/** (2) MULTIPLE SNOWBALLS PER UNIT — one envelope per basin touched, each bundle(tree, leaf) at the setting's cap (C42's pure
 *  function), the set capped at MAX_ENVELOPES so the total is ≤ cap × MAX_ENVELOPES. count 1 = the unit's own envelope only. */
export async function envelopesFor({ tree, label, setting, bundleFn = bundleOf } = {}) {
  const basins = basinsTouched(tree, label); if (!basins.length) return { envelopes: [], why: `no basin n_spec_${label} on the tree` };
  const want = setting.count === 'per_basin' ? basins.slice(0, MAX_ENVELOPES) : basins.slice(0, Math.min(setting.count, basins.length));
  const envelopes = [];
  for (const b of want) { const env = await bundleFn(tree, `n_spec_${b}`, { capTokens: setting.cap }); if (env) envelopes.push({ basin: b, sha8: sha8(env), env }); }
  return { envelopes, touched: basins.length, cut: basins.length - envelopes.length, total_cap: setting.cap * envelopes.length };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sameSetting = (a, b) => a && b && clampCap(a.cap) === clampCap(b.cap) && String(a.count) === String(b.count) && (b.aperture == null || a.aperture === b.aperture);
/** (3) + (5) THE RATCHET. `rows` are witnessed rows { band, shape, snowball: { cap, count, aperture }, perCog } (a verdict-ok runner
 *  row joined to its minted cog and its measured spend). A candidate setting moves the knob for `shape` only when ≥ MIN_WITNESSED rows
 *  at that setting in that band+shape have a median tokens-per-cog under the band's peg. An aperture move additionally needs the
 *  aperture ratchet's own admission (gain · z against the seed null) — the cog adds the second question, never replaces the first.
 *  A refusal writes nothing; a move rewrites the knob (v + 1) and appends one row. */
export function ratchetKnob({ shape, band, candidate, rows = [], peg, admission = null, land = null, knobPath = KNOB_PATH, ndjsonPath = KNOB_NDJSON, at = new Date().toISOString(), write = true } = {}) {
  const knob = readKnob(knobPath);
  const refuse = (why) => ({ moved: false, why, knob });
  if (!SHAPES.includes(shape)) return refuse(`unknown shape ${shape}`);
  if (!candidate || Number(candidate.cap) < KNOB_FLOOR || Number(candidate.cap) > BUNDLE_CAP_MAX) return refuse(`a cap outside [${KNOB_FLOOR}, ${BUNDLE_CAP_MAX}] (BUNDLE_CAP_MIN–MAX) is never a setting`);
  if (candidate.aperture != null && !(admission && admission.admitted)) return refuse('an aperture move needs the aperture ratchet\'s own admission first (gain · z against the seed null)');
  const pegV = peg && peg.bands && peg.bands[band] && peg.bands[band].peg; if (!Number.isFinite(pegV)) return refuse(`no peg for band ${band} — UNMEASURED`);
  const at_ = rows.filter((r) => r.band === band && r.shape === shape && Number.isFinite(r.perCog) && sameSetting(r.snowball, candidate));
  if (at_.length < MIN_WITNESSED) return refuse(`${at_.length} witnessed row${at_.length === 1 ? '' : 's'} at the candidate for ${band}/${shape} — ${MIN_WITNESSED} needed`);
  const med = median(at_.map((r) => r.perCog)); if (!(med < pegV)) return refuse(`median ${Math.round(med)} tokens/cog does not beat the ${band} peg ${Math.round(pegV)}`);
  // C228: the land rate per engine is the judge — the per-cog peg alone never moves the knob
  if (!land || !land.candidate || !land.incumbent) return refuse('no land-rate reading for the candidate and the incumbent — UNMEASURED; tokens/cog alone never moves the knob (C228)');
  if (land.candidate.n < MIN_WITNESSED || land.incumbent.n < MIN_WITNESSED) return refuse(`land rate on ${land.candidate.n} dispatch(es) at the candidate and ${land.incumbent.n} at the incumbent — ${MIN_WITNESSED} needed on each side`);
  if (!(land.candidate.rate > land.incumbent.rate)) return refuse(`land rate ${land.candidate.x}/${land.candidate.n} at the candidate does not rise over ${land.incumbent.x}/${land.incumbent.n} at the incumbent`);
  const from = knob.by_shape[shape]; const to = { ...from, cap: clampCap(candidate.cap), count: candidate.count };
  const next = { ...knob, v: (knob.v || 1) + 1, by_shape: { ...knob.by_shape, [shape]: to }, ...(candidate.aperture != null ? { aperture: candidate.aperture } : {}) };
  const row = { at, v: next.v, shape, band, from: { cap: from.cap, count: from.count }, to: { cap: to.cap, count: to.count }, ...(candidate.aperture != null ? { aperture: candidate.aperture, admission } : {}), n: at_.length, median_per_cog: Math.round(med), peg: Math.round(pegV), land: { preset: land.preset || land.candidate.preset || null, candidate: land.candidate, incumbent: land.incumbent } };
  if (write) { mkdirSync(dirname(knobPath), { recursive: true }); writeFileSync(knobPath, JSON.stringify(next, null, 1) + '\n'); appendFileSync(ndjsonPath, JSON.stringify(row) + '\n'); }
  return { moved: true, row, knob: next };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const k = readKnob(); const rows = SHAPES.map((s) => settingFor({ shape: s, knob: k }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ knob: k, settings: rows }, null, 1));
  else { console.log(`snowball knob v${k.v} · floor ${KNOB_FLOOR} (BUNDLE_CAP_MIN) · start ${KNOB_START} (BUNDLE_TOKEN_CAP, a target) · ${existsSync(KNOB_PATH) ? KNOB_PATH : 'no file — v1 defaults'}`); for (const r of rows) console.log(`  ${r.setting_shape.padEnd(15)} cap ${r.cap} × ${r.count} · ${r.packing}`); }
}
