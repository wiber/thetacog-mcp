#!/usr/bin/env node
// scripts/vna/snowball-knob.mjs — C93g THE CAP IS A KNOB, NOT A CONSTANT — AND SO IS THE APERTURE (operator 2026-09-19: "hope we
// are not stuck on the fifteen hundred tokens for the sub and snowballs, because that's an optimisation and aperture target").
// Two knobs, one ratchet. The snowball's { cap, count, packing } per predicted SHAPE (C93f: spread · focused · spread+focused ·
// narrow) lives in data/vna/snowball-knob.json; the walk's aperture in force is apertureVersion() (prompt-lens.mjs). Both ride the
// runner's dispatch row as `snowball: { cap, count, packing, aperture, knob_v, shape }`, and both move only on the cog's evidence:
// a setting moves when the median tokens-per-cog on ≥ MIN_WITNESSED witnessed rows at that setting beats the peg (C93c) for the same
// band and shape — the move is a row on data/vna/snowball-knob.ndjson; a setting that does not beat the peg leaves the file byte-
// unchanged. BUNDLE_TOKEN_CAP (spec-tree.mjs, C82e) is never edited by the knob; it is the FLOOR no setting may fall below.
// v1 is 1500 × 1 for every shape — nothing changes until a row says so.
//
//   node scripts/vna/snowball-knob.mjs [--json]      print the knob in force and the setting each shape dispatches at
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BUNDLE_TOKEN_CAP, BUNDLE_CAP_MAX, bundle as bundleOf } from './spec-tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const KNOB_PATH = process.env.VNA_SNOWBALL_KNOB || resolve(REPO, 'data/vna/snowball-knob.json');
export const KNOB_NDJSON = process.env.VNA_SNOWBALL_KNOB_NDJSON || resolve(REPO, 'data/vna/snowball-knob.ndjson');
export const PREDICT_NDJSON = process.env.VNA_COG_PREDICT || resolve(REPO, 'data/vna/cog-predict.ndjson');
export const KNOB_FLOOR = BUNDLE_TOKEN_CAP;   // (4) the pinned constant is the floor — read, never re-typed
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
  return { v: 1, floor: KNOB_FLOOR, by_shape: Object.fromEntries(SHAPES.map((s) => [s, { cap: KNOB_FLOOR, count: 1, packing: PACKING[s] }])),
    cites: { floor: 'BUNDLE_TOKEN_CAP in scripts/vna/spec-tree.mjs (C82e) — never edited by the knob', moves: 'data/vna/snowball-knob.ndjson', peg: 'data/vna/cog-peg.json (C93c)', shape: 'data/vna/cog-predict.ndjson (C93f)' } };
}
export function readKnob(path = KNOB_PATH) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return defaultKnob(); } }
const clampCap = (c) => { const n = Number(c); return Number.isFinite(n) ? Math.min(BUNDLE_CAP_MAX, Math.max(KNOB_FLOOR, Math.round(n))) : KNOB_FLOOR; };

/** the row's predicted shape — the newest C93f prediction for the label; UNMEASURED rows dispatch at the narrow setting */
export function shapeOf(label, rows = ndRows(PREDICT_NDJSON)) {
  let hit = null; for (const r of rows) if (r.label === label && r.status === 'predicted' && r.shape) hit = r;
  return hit ? { shape: hit.shape, band: hit.band || null, source: 'cog-predict.ndjson (C93f)' } : { shape: null, band: null, why: `no C93f prediction for ${label}` };
}

/** the setting a dispatch rides: the knob's row for the shape, the cap held at or above the floor, the aperture stamped beside it */
export function settingFor({ label, shape = undefined, knob = readKnob(), aperture = null, predictRows = undefined } = {}) {
  const sh = shape !== undefined ? { shape, band: null } : shapeOf(label, predictRows);
  const key = SHAPES.includes(sh.shape) ? sh.shape : 'narrow';
  const s = (knob.by_shape && knob.by_shape[key]) || { cap: KNOB_FLOOR, count: 1, packing: PACKING[key] };
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
export function ratchetKnob({ shape, band, candidate, rows = [], peg, admission = null, knobPath = KNOB_PATH, ndjsonPath = KNOB_NDJSON, at = new Date().toISOString(), write = true } = {}) {
  const knob = readKnob(knobPath);
  const refuse = (why) => ({ moved: false, why, knob });
  if (!SHAPES.includes(shape)) return refuse(`unknown shape ${shape}`);
  if (!candidate || Number(candidate.cap) < KNOB_FLOOR) return refuse(`a cap under the floor (${KNOB_FLOOR}, BUNDLE_TOKEN_CAP) is never a setting`);
  if (candidate.aperture != null && !(admission && admission.admitted)) return refuse('an aperture move needs the aperture ratchet\'s own admission first (gain · z against the seed null)');
  const pegV = peg && peg.bands && peg.bands[band] && peg.bands[band].peg; if (!Number.isFinite(pegV)) return refuse(`no peg for band ${band} — UNMEASURED`);
  const at_ = rows.filter((r) => r.band === band && r.shape === shape && Number.isFinite(r.perCog) && sameSetting(r.snowball, candidate));
  if (at_.length < MIN_WITNESSED) return refuse(`${at_.length} witnessed row${at_.length === 1 ? '' : 's'} at the candidate for ${band}/${shape} — ${MIN_WITNESSED} needed`);
  const med = median(at_.map((r) => r.perCog)); if (!(med < pegV)) return refuse(`median ${Math.round(med)} tokens/cog does not beat the ${band} peg ${Math.round(pegV)}`);
  const from = knob.by_shape[shape]; const to = { ...from, cap: clampCap(candidate.cap), count: candidate.count };
  const next = { ...knob, v: (knob.v || 1) + 1, by_shape: { ...knob.by_shape, [shape]: to }, ...(candidate.aperture != null ? { aperture: candidate.aperture } : {}) };
  const row = { at, v: next.v, shape, band, from: { cap: from.cap, count: from.count }, to: { cap: to.cap, count: to.count }, ...(candidate.aperture != null ? { aperture: candidate.aperture, admission } : {}), n: at_.length, median_per_cog: Math.round(med), peg: Math.round(pegV) };
  if (write) { mkdirSync(dirname(knobPath), { recursive: true }); writeFileSync(knobPath, JSON.stringify(next, null, 1) + '\n'); appendFileSync(ndjsonPath, JSON.stringify(row) + '\n'); }
  return { moved: true, row, knob: next };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const k = readKnob(); const rows = SHAPES.map((s) => settingFor({ shape: s, knob: k }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ knob: k, settings: rows }, null, 1));
  else { console.log(`snowball knob v${k.v} · floor ${KNOB_FLOOR} (BUNDLE_TOKEN_CAP) · ${existsSync(KNOB_PATH) ? KNOB_PATH : 'no file — v1 defaults'}`); for (const r of rows) console.log(`  ${r.setting_shape.padEnd(15)} cap ${r.cap} × ${r.count} · ${r.packing}`); }
}
