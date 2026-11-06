#!/usr/bin/env node
// scripts/vna/read-set.mjs — C176d: THE READ RANKER OF RECORD, CONFIGURED BY THE RATCHET. Pure, LLM-free.
//
// The ranker is not a formula chosen by taste: it is whatever configuration data/vna/read-ratchet.json holds, and that file
// is written ONLY by writeRatchet(), which refuses any candidate that does not beat the leak-free text floor (ncdLQ) on BOTH
// held-out folds by z ≥ 2 against the shuffled-ask null, and refuses any candidate whose held-out numbers fall below the
// floor already on record — the floor only rises. (spec C176d; research 2026-09-23 in scripts/vna/retrieval-bench.mjs's
// protocol: 46 asks × 450 rows, halves A/B, K=200 shuffled-ask null, paired z on the mean rank vs ncdLQ.)
//
// WHAT WON (2026-09-23): HAIRS — LLM-free anchors extracted by regex from the row text AND from the commits that name the
// row (subjects, bodies, touched files) — scored as idf-weighted COVERAGE of the ask's anchors (Σ idf over shared anchors ÷
// Σ idf over the ask's anchors). Ties stay ties (tie_break 'none'); 'ncdLQ' is a configurable tie-break the ratchet did not keep. The class that carried it was the rare-WORD class
// (≥ 6 letters); file paths / C-ids / flags / identifiers alone sat AT CHANCE because 30 of 46 dictated asks name none.
// The kept config survived a leak ladder stricter than the floor's own (every ask BIGRAM stripped from the row before
// extraction, not only 8-word runs) — so the signal is topical vocabulary, not quote residue.
//
//   import { rankRows, readSet, extractHairs, keepDecision, writeRatchet, loadRatchet } from './read-set.mjs';
//   const ranked = rankRows(askText, rows);   // rows: [{ id, text, extra? }] — extra = the row's commit mass (subjects/bodies/files)
//   const ids = readSet(askText, rows, { k: 12 });
// Guard: tests/formal/c176d-the-shape-match-is-configured-by-the-ratchet.test.mjs
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SL, CELLS, litSet, overlap } from './tesseract-projection.mjs';   // C582a: the lit-cell vectors the walk admission reads (the mjs reference)
import { crateCall, bare, mjsReference, CRATE_ABSENT } from './crate-call.mjs';   // C612q: walkAdmits / cellsAdmit / measuredLicence decide in the crate

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RATCHET_JSON = resolve(REPO, 'data/vna/read-ratchet.json');
export const RATCHET_NDJSON = resolve(REPO, 'data/vna/read-ratchet.ndjson');
export const KEEP_Z = 2;   // the bar, per held-out fold, on the paired mean-rank difference vs the floor

// ── hairs: the regex anchor classes (one place) ─────────────────────────────────────────────────
export const HAIR = {
  path: /[\w./-]*[\w-]+\.(?:mjs|cjs|js|ts|tsx|rs|json|md|mdx|ndjson|sh|txt|html|css|toml|yaml|yml|png|svg)\b/g,
  cid: /\bC\d+[a-z]?\b/g,
  cmd: /\b(?:node|bash|npx|cargo|git)\s+[\w./-]+/g,
  slash: /(?:^|[\s(])(\/[a-z][a-z-]{2,})\b/g,
  flag: /--[a-z][a-z0-9-]+/g,
  tick: /`([^`\n]{2,60})`/g,
  ident: /\b(?:[a-z]+[A-Z][A-Za-z0-9]+|[a-z0-9]+_[a-z0-9_]+|[a-z]+-[a-z]+(?:-[a-z]+)+)\b/g,
  sha: /\b[0-9a-f]{10,40}\b/g,
  num: /\b\d+(?:[.,]\d+)?\s?(?:ms|s|%|k|kb|mb|gb|chars|tokens|rows|asks|min|h|x|bits?|days?|hz)\b/gi,
  alnum: /\b(?=[a-z0-9.]*\d)(?=[a-z0-9.]*[a-z])[a-z][a-z0-9.]{2,}\b/gi,
  word: /\b[a-z]{6,}\b/g,
};
export const CODE_CLASSES = ['path', 'cid', 'cmd', 'slash', 'flag', 'tick', 'ident', 'sha', 'num', 'alnum'];
export function extractHairs(text, classes = Object.keys(HAIR)) {
  const out = new Set(); const t = String(text || '');
  for (const c of classes) {
    const re = HAIR[c]; if (!re) continue; re.lastIndex = 0; let m;
    while ((m = re.exec(t))) { const tok = (m[1] || m[0]).toLowerCase().trim(); if (tok.length >= 2) out.add(c + ':' + tok); }
  }
  return out;
}

// ── the default configuration (what the ratchet kept on 2026-09-23); the file overrides it when present ───────────────
export const DEFAULT_CONFIG = Object.freeze({
  sensor: 'h_allE',                  // hair coverage over row text + commit mass (the ⊳ncdLQ tie-break scored z 1.98 on one fold at the floor's window — not kept)
  classes: Object.keys(HAIR),         // every class, the rare-word class included
  enrich: 'commits',                  // the row's anchors include those of the commits that name it (subjects · bodies · files)
  score: 'cov',                       // Σ idf(shared) ÷ Σ idf(ask's anchors)
  tie_break: 'none',                  // ties (an ask with no anchors) stay ties, ordered by id — never painted as a reading
  idf: 'log((N+1)/(df+1))+1',
});
export function configHash(cfg) { return createHash('sha256').update(JSON.stringify(cfg, Object.keys(cfg).sort())).digest('hex').slice(0, 12); }
export function loadRatchet(path = RATCHET_JSON) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function activeConfig(path = RATCHET_JSON) { const r = loadRatchet(path); return r && r.kept && r.kept.config ? r.kept.config : DEFAULT_CONFIG; }

// ── text helpers (the same normalisation and strip the bench uses) ─────────────────────────────────────────────────────
export const norm = (s) => String(s || '').toLowerCase().replace(/[*_`"“”'’]/g, '').replace(/\s+/g, ' ').trim();
const gz = (s) => gzipSync(Buffer.from(s)).length;
export function ncd(a, b) { const ca = gz(a), cb = gz(b), cab = gz(a + ' ' + b); return (cab - Math.min(ca, cb)) / Math.max(ca, cb); }
export function stripRuns(askText, rowText, win = 8) {
  const w = norm(askText).split(' ').filter(Boolean); let t = norm(rowText);
  const probes = w.length <= win ? [w.join(' ')] : Array.from({ length: w.length - win + 1 }, (_, i) => w.slice(i, i + win).join(' '));
  for (const p of probes) if (p.length >= 8 && t.includes(p)) t = t.split(p).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

// ── the ranker ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// rows: [{ id, text, extra?: string, files?: string[] }]. extra/files = the row's commit mass (see commitMass()); optional.
export function rowAnchors(row, cfg = DEFAULT_CONFIG, askText = null) {
  const src = askText == null ? [row.text, cfg.enrich === 'commits' ? row.extra : ''] : [stripRuns(askText, row.text), cfg.enrich === 'commits' ? stripRuns(askText, row.extra || '') : ''];
  const H = new Set([...extractHairs(src[0], cfg.classes), ...extractHairs(src[1] || '', cfg.classes)]);
  if (cfg.enrich === 'commits') for (const f of row.files || []) H.add('path:' + String(f).toLowerCase());
  return H;
}
export function idfOver(rows, cfg = DEFAULT_CONFIG) {
  const df = {}; const N = rows.length;
  for (const r of rows) for (const h of rowAnchors(r, cfg)) df[h] = (df[h] || 0) + 1;
  return (h) => Math.log((N + 1) / ((df[h] || 0) + 1)) + 1;
}
export function coverage(askH, rowH, idf) { let inter = 0, tot = 0; for (const h of askH) { const w = idf(h); tot += w; if (rowH.has(h)) inter += w; } return tot ? inter / tot : 0; }
// returns [{ id, cov, ncdLQ, rank }] sorted best first — hair coverage first (desc), leak-free NCD breaks ties (asc)
export function rankRows(askText, rows, cfg = activeConfig()) {
  const idf = idfOver(rows, cfg); const askH = extractHairs(askText, cfg.classes); const a = norm(askText);
  const scored = rows.map((r) => ({ id: r.id, cov: +coverage(askH, rowAnchors(r, cfg, askText), idf).toFixed(6), ncdLQ: cfg.tie_break === 'ncdLQ' ? +ncd(a, stripRuns(askText, r.text)).toFixed(6) : 0 }));
  scored.sort((x, y) => (y.cov - x.cov) || (x.ncdLQ - y.ncdLQ) || String(x.id).localeCompare(String(y.id)));
  scored.forEach((s, i) => { s.rank = i + 1; }); return scored;
}
export function readSet(askText, rows, { k = 12, cfg = activeConfig() } = {}) { return rankRows(askText, rows, cfg).slice(0, k).map((s) => s.id); }

// the commit mass per C-id: ONE bounded git pass (subjects, bodies, touched files of every commit whose message names the id)
// `until` freezes the mass at a moment (the ratchet's own `at`), so a replay of the ratchet reads the commits it read — mass grows every
// commit that names a row, and a live ranking legitimately drifts from the recorded one.
export function commitMass({ since = '2026-09-01', until = null, cwd = REPO, maxPerId = 40 } = {}) {
  const raw = execFileSync('git', ['log', `--since=${since}`, ...(until ? [`--until=${until}`] : []), '--format=%x00%H%x01%s%x01%b%x02', '--name-only'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const idx = {};
  for (const p of raw.split('\0').slice(1)) {
    const [head, filesRaw] = p.split('\x02'); const [, s, b] = head.split('\x01');
    const files = (filesRaw || '').split('\n').map((x) => x.trim()).filter(Boolean);
    for (const id of new Set((s + '\n' + (b || '')).match(/\bC\d+[a-z]?\b/g) || [])) { const e = idx[id] || (idx[id] = { n: 0, subjects: [], bodies: [], files: new Set() }); if (e.n >= maxPerId) continue; e.n++; e.subjects.push(s); e.bodies.push((b || '').slice(0, 600)); files.forEach((f) => e.files.add(f)); }
  }
  const out = {}; for (const id in idx) out[id] = { extra: idx[id].subjects.join('\n') + '\n' + idx[id].bodies.join('\n'), files: [...idx[id].files], n: idx[id].n }; return out;
}

// ── the ratchet ────────────────────────────────────────────────────────────────────────────────────────────────────────
// folds: { 'A→B': { median, z_vs_floor, floor_median, ... }, 'B→A': {...} } — held-out numbers, each fold fitted on the other half
export function keepDecision(folds, { z = KEEP_Z } = {}) {
  const fs = Object.values(folds || {}); if (fs.length < 2) return { keep: false, why: 'needs both held-out folds' };
  for (const f of fs) { if (!(Number(f.z_vs_floor) >= z)) return { keep: false, why: `z_vs_floor ${f.z_vs_floor} < ${z} in a fold` }; if (!(Number(f.median) < Number(f.floor_median))) return { keep: false, why: `median ${f.median} not below the floor ${f.floor_median} in a fold` }; }
  return { keep: true, why: `z_vs_floor ≥ ${z} and median below the floor in both folds` };
}
// floor only rises: a new kept config must not be worse than the kept one on record (min z_vs_floor and max median across folds)
export function beatsRecord(candidate, record) {
  if (!record || !record.kept) return true;
  const mz = (c) => Math.min(...Object.values(c.folds).map((f) => Number(f.z_vs_floor)));
  const mm = (c) => Math.max(...Object.values(c.folds).map((f) => Number(f.median)));
  return mz(candidate) >= mz(record.kept) - 1e-9 && mm(candidate) <= mm(record.kept) + 1e-9;
}
// writes ONLY a keeper that beats the record; returns { written, why }. Never writes a loser. Appends one ndjson row per write.
export function writeRatchet(candidate, { jsonPath = RATCHET_JSON, ndjsonPath = RATCHET_NDJSON, leaderboard = null, meta = null, now = new Date().toISOString() } = {}) {
  const d = keepDecision(candidate.folds); if (!d.keep) return { written: false, why: d.why };
  const record = loadRatchet(jsonPath);
  if (!beatsRecord(candidate, record)) return { written: false, why: 'does not beat the kept config on record — the floor only rises' };
  const hash = configHash(candidate.config);
  const out = { at: now, floor: candidate.floor || (record && record.floor) || 'ncdLQ', keep_rule: `held-out: paired (floor mean rank − arm mean rank) vs the shuffled-ask null, z ≥ ${KEEP_Z} in BOTH folds, and median below the floor in both; floor only rises`, kept: { name: candidate.name, config: candidate.config, hash, folds: candidate.folds }, leaderboard: leaderboard || (record && record.leaderboard) || null, meta: meta || null, history_n: ((record && record.history_n) || 0) + 1 };
  mkdirSync(dirname(jsonPath), { recursive: true }); writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n');
  appendFileSync(ndjsonPath, JSON.stringify({ at: now, name: candidate.name, hash, config: candidate.config, folds: candidate.folds, floor: out.floor }) + '\n');
  return { written: true, why: d.why, hash };
}

// ── C176f: THE SNOWBALL READS WITH THE CONFIGURATION THE RATCHET KEPT ──────────────────────────────────────────────────
// The prompt hook (steer-hook.mjs snowball(), and its C193 detached refresh, snowball-refresh.mjs) ranks the tree's own
// contract rows with rankRows(prompt, rows, activeConfig()) whenever the prompt is NOT anchored by a /goal leaf, instead
// of the NCD-nearest basin seedSpecFirst serves there today. Two pieces live here, once, so neither caller duplicates them:
//   rowsFromTree  — the SAME row shape the ratchet was measured on, built from a tree ALREADY PARSED (never a second
//                   52 MB parse) plus a commit-mass CACHE (never a live git call on the hook's hot path — commitMass()
//                   alone measured ~1.1s, over the hook's 800ms door; the cache is refreshed detached, gapped, by
//                   hook-doors.mjs's dispatchMassRefresh, which spawns `node scripts/vna/read-set.mjs --refresh-mass`).
//   hairsPick     — the kept config's top row, plus the NCD-nearest row named beside it as the floor (never used to
//                   pick — only so a reader can see what the demoted text sensor would have served instead).
//   applyHairsPick — the actual override decision a caller applies to its own NCD-picked leaf: a hairless ask (top
//                   coverage 0 — no idf-weighted anchor overlap at all) is a tie under DEFAULT_CONFIG's tie_break
//                   'none' and NEVER overrides; a real top pick that names a DIFFERENT row than the NCD pick does.
export const MASS_CACHE = process.env.VNA_ROW_MASS_CACHE || resolve(REPO, 'data/vna/row-commit-mass.json');
export function loadMassCache(path = MASS_CACHE) { try { const c = JSON.parse(readFileSync(path, 'utf8')); return c && c.mass && typeof c.mass === 'object' ? c.mass : {}; } catch { return {}; } }
export function writeMassCache(mass, path = MASS_CACHE) { mkdirSync(dirname(path), { recursive: true }); const out = { at: new Date().toISOString(), mass }; writeFileSync(path, JSON.stringify(out)); return { path, n: Object.keys(mass).length }; }
export function rowsFromTree(tree, massCache = {}) {
  return Object.values((tree && tree.nodes) || {}).filter((n) => n.type === 'contract' && n.cue)
    .map((n) => ({ id: n.cue, text: String(n.content?.text || ''), extra: (massCache[n.cue] && massCache[n.cue].extra) || '', files: (massCache[n.cue] && massCache[n.cue].files) || [] }));
}
export function hairsPick(prompt, rows, { cfg = activeConfig() } = {}) {
  if (!rows || !rows.length) return null;
  const ranked = rankRows(prompt, rows, cfg);   // the exact call the ratchet's numbers were measured against — no tie-break override
  const top = ranked[0];
  const a = norm(prompt);
  let floor = null;
  for (const r of rows) { const d = +ncd(a, stripRuns(prompt, r.text)).toFixed(6); if (!floor || d < floor.ncdLQ) floor = { id: r.id, ncdLQ: d }; }
  return { top, floor, ranked, hash: configHash(cfg), differ: floor ? top.id !== floor.id : null };
}
// ── C582a: THE TEXT RANKER MAY NOT OVERRULE THE WALK UNMEASURED ─────────────────────────────────────────────────────────
// The leaf applyHairsPick receives was placed by the one Rust walk (seedSpecFirst → anchorSeed): the walk chose the SLOT,
// the compressor only ordered inside it. C176d measured the hairs against the ncdLQ TEXT floor — never against the walk's
// own pick — so a hairs row the walk did not admit has no measurement licensing it to replace the walk. The override now
// fires only under a NAMED licence, and every override carries the licence it used (R.licence, R.why):
//   'no-walk'  — no walk placed this leaf (no pixel on it, or the seed's stage was the NCD fallback): the pick being
//                replaced IS the text floor, and C176d's kept config beat that floor on both held-out folds at z ≥ KEEP_Z
//                against the shuffled-ask null. This is the C176f case, unchanged.
//   'ring'     — the hairs' row sits in the walk's ring: its block is within walk.ring (Chebyshev, ShortLex blocks) of the
//                walk's pixel — the walk admitted the row as a candidate, the hairs only ordered inside it.
//   'cells'    — the walk's lit cells overlap the row's walked cells (node.walk.cells) above the fitted floor: K seeded
//                placements of the same cell count over the 144 cells, exceedance 0/K needed (C64's null, one candidate).
//   'measured' — a held-out measurement of hairs vs the WALK'S OWN pick (retrieval-bench.mjs ground truth, both folds,
//                shuffled-ask null) on record at HAIRS_WALK_LICENCE says the hairs beat the walk at z ≥ KEEP_Z on BOTH folds.
// None of the four → the walk's leaf stands, overridden false, and R.why names what was missing. Rust home (this DECIDES):
// packages/thetacog-mcp/intentguard/src/walk_lens.rs mod c612q as `pmu-onchip --walk-admits` — BUILT by C612q (port row C582a): the
// exported walkAdmits / cellsAdmit / measuredLicence shuttle to the chip; the *Mjs bodies below are the reference
// (VNA_C612Q_MJS=1). With no binary the override is not licensed: the walk's leaf stands and the why says so.
export const HAIRS_WALK_LICENCE = process.env.VNA_HAIRS_WALK_LICENCE || resolve(REPO, 'data/vna/hairs-vs-walk.json');
export const CELLS_K = 64;
export function loadWalkLicence(path = HAIRS_WALK_LICENCE) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
// the measured licence holds only when it was measured against the walk (never the text floor), on both folds, vs the shuffled-ask null
export function measuredLicence(L) {
  if (mjsReference()) return measuredLicenceMjs(L);
  try { return bare(crateCall('--walk-admits', { op: 'measured-licence', licence: L ?? null }, { engine: 'rust-walk-admits' })); } catch (e) { return { ok: false, why: String(e.message || e) }; }
}
export function measuredLicenceMjs(L) {
  if (!L || L.baseline !== 'walk' || L.null !== 'shuffled-ask' || !L.folds) return { ok: false, why: L ? `licence on record is not hairs-vs-walk on both folds against the shuffled-ask null` : 'no hairs-vs-walk measurement on record (UNMEASURED)' };
  const zA = L.folds.A && L.folds.A.z, zB = L.folds.B && L.folds.B.z;
  const said = `hairs vs the walk's pick, z fold A ${zA ?? '—'} / fold B ${zB ?? '—'} against the shuffled-ask null${L.K ? ` K=${L.K}` : ''} (needs ${KEEP_Z} on both)`;
  return { ok: Number.isFinite(zA) && Number.isFinite(zB) && zA >= KEEP_Z && zB >= KEEP_Z, why: said };
}
const blkOfPx = (p) => { const [r, c] = String(p || '').split(','); const i = SL.indexOf(r), j = SL.indexOf(c); return i < 0 || j < 0 ? null : [i, j]; };
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
function seeded(seedStr) {
  let a = parseInt(createHash('sha256').update(seedStr).digest('hex').slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// the walk's lit cells against one row's walked cells, with the fitted floor: the max overlap K random placements reach
export function cellsAdmit(walkCells, rowCells, { K = CELLS_K, id = '' } = {}) {
  if (mjsReference()) return cellsAdmitMjs(walkCells, rowCells, { K, id });
  try { return bare(crateCall('--walk-admits', { op: 'cells-admit', walkCells: walkCells ?? null, rowCells: rowCells ?? null, K, id: String(id) }, { engine: 'rust-walk-admits' })); } catch (e) { return { ok: false, why: String(e.message || e) }; }
}
export function cellsAdmitMjs(walkCells, rowCells, { K = CELLS_K, id = '' } = {}) {
  const S = litSet(walkCells), R = litSet(rowCells);
  if (!S.size) return { ok: false, why: 'the walk carries no lit cells' };
  if (!R.size) return { ok: false, why: 'the row carries no walked cells' };
  const best = overlap(S, R);
  if (!best) return { ok: false, overlap: 0, why: 'the walk\'s lit cells share no cell with the row' };
  const rnd = seeded([...S].sort((x, y) => x - y).join(',') + '|' + id);
  let exceedance = 0, floor = 0;
  for (let k = 0; k < K; k++) {
    const pool = Array.from({ length: CELLS }, (_, i) => i); const P = new Set();
    for (let i = 0; i < S.size; i++) { const j = i + Math.floor(rnd() * (CELLS - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; P.add(pool[i]); }
    const m = overlap(P, R); if (m > floor) floor = m; if (m >= best) exceedance++;
  }
  return { ok: exceedance === 0, overlap: best, floor, exceedance, K, why: `overlap ${best} of ${S.size} lit cells vs the fitted floor ${floor} (exceedance ${exceedance}/${K} over seeded placements)` };
}
// walk: { pixel, ring, cells, stage } from the caller's seed; absent → read off the leaf (its own pixel, ring 0 — the
// tightest ring, so a caller that hands no walk can only make the override HARDER, never easier)
export function walkAdmits(leaf, node, walk = null, { licence = loadWalkLicence() } = {}) {
  if (mjsReference()) return walkAdmitsMjs(leaf, node, walk, { licence });
  // the chip reads only these fields; node.id is sent as the template literal would print it (undefined → '' is the cellsAdmit default)
  const slimNode = node ? { id: node.id === undefined ? undefined : node.id, cue: node.cue, pixel: node.pixel, walk: node.walk ? { cells: node.walk.cells ?? null } : null } : node;   // an undefined node stays undefined (JSON drops it), as the template literal reads it
  try { return bare(crateCall('--walk-admits', { op: 'walk-admits', leaf: leaf ? { pixel: leaf.pixel ?? null } : (leaf ?? null), node: slimNode, walk: walk ?? null, licence: licence ?? null }, { engine: 'rust-walk-admits' })); }
  catch (e) { return { licence: null, why: `${String(e.message || e)} — the walk's leaf stands` }; }
}
export function walkAdmitsMjs(leaf, node, walk = null, { licence = loadWalkLicence() } = {}) {
  const W = walk || (leaf && leaf.pixel ? { pixel: leaf.pixel, ring: 0, cells: null, stage: 'leaf' } : null);
  if (!W || !blkOfPx(W.pixel) || W.stage === 'ncd') return { licence: 'no-walk', why: 'no walk placed this leaf — the pick replaced is the text floor the kept config beat on both folds (C176d)' };
  const nb = blkOfPx(node && node.pixel), ring = Number.isFinite(W.ring) ? W.ring : 0;
  if (nb && cheb(nb, blkOfPx(W.pixel)) <= ring) return { licence: 'ring', why: `the hairs' row ${node.pixel} sits within ${ring} block of the walk's ${W.pixel}` };
  const C = cellsAdmitMjs(W.cells, node && node.walk && node.walk.cells, { id: node && node.id });
  if (C.ok) return { licence: 'cells', why: C.why };
  const M = measuredLicenceMjs(licence);
  if (M.ok) return { licence: 'measured', why: M.why };
  return { licence: null, why: `the walk did not admit ${node && node.cue}: ${nb ? `${node.pixel} is outside ${ring} block of ${W.pixel}` : 'the row carries no pixel'}; cells — ${C.why}; measured — ${M.why}` };
}
// walkOfSeed — the ONE place a caller's seedSpecFirst seed + the lens walk row become the walk applyHairsPick reads
// (steer-hook.mjs snowball() and snowball-refresh.mjs both call it, so the two doors can never hand different walks)
export function walkOfSeed(seed, walkRow = null) {
  if (!seed) return null;
  return { pixel: seed.pixel || null, ring: Number.isFinite(seed.ring) ? seed.ring : 0, cells: walkRow && Array.isArray(walkRow.cells) ? walkRow.cells : null, stage: seed.stage || null };
}
export function applyHairsPick(leaf, tree, prompt, { massCache = loadMassCache(), cfg = activeConfig(), walk = null, licence = loadWalkLicence() } = {}) {
  const rows = rowsFromTree(tree, massCache);
  const HP = hairsPick(prompt, rows, { cfg });
  if (!HP || !leaf || !(HP.top.cov > 0) || HP.top.id === leaf.label) return { leaf, HP, overridden: false, licence: null, why: !HP || !leaf ? 'nothing to rank' : HP.top.id === leaf.label ? 'agrees with the walk\'s leaf' : 'hairless ask' };
  const node = Object.values((tree && tree.nodes) || {}).find((n) => n.type === 'contract' && n.cue === HP.top.id);
  if (!node) return { leaf, HP, overridden: false, licence: null, why: `no contract node for ${HP.top.id}` };
  const A = walkAdmits(leaf, node, walk, { licence });
  if (!A.licence) return { leaf, HP, overridden: false, licence: null, why: A.why };
  const picked = { id: node.id, label: node.meta && node.meta.label, headline: node.content.headline, text: node.content.text, pixel: node.pixel || null, done: !!(node.meta && node.meta.done), d: leaf.d ?? null, snippets: (node.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length };
  return { leaf: picked, HP, overridden: true, licence: A.licence, why: A.why };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--refresh-mass')) { const mass = commitMass(); const w = writeMassCache(mass); console.log(`row-commit-mass refreshed: ${w.n} ids → ${w.path.replace(REPO + '/', '')}`); process.exit(0); }
  const ask = argv.filter((a) => !a.startsWith('--')).join(' ');
  if (!ask) { console.log('usage: node scripts/vna/read-set.mjs "<ask text>" [--k 12] | --refresh-mass   (ranks data/vna/spec-tree.json contract rows under the ratchet\'s kept config)'); process.exit(0); }
  const k = Number(argv[argv.indexOf('--k') + 1] || 12);
  const t = JSON.parse(readFileSync(resolve(REPO, 'data/vna/spec-tree.json'), 'utf8')); const mass = commitMass();
  const rows = Object.values(t.nodes).filter((n) => n.type === 'contract' && n.cue).map((n) => ({ id: n.cue, text: String(n.content?.text || ''), extra: mass[n.cue]?.extra || '', files: mass[n.cue]?.files || [] }));
  const cfg = activeConfig(); const ranked = rankRows(ask, rows, cfg).slice(0, k);
  console.log(`read-set · config ${configHash(cfg)} (${cfg.sensor}) · ${rows.length} rows`);
  for (const r of ranked) console.log(`  ${String(r.rank).padStart(3)}  ${r.id.padEnd(8)} cov ${r.cov.toFixed(3)}  ncdLQ ${r.ncdLQ.toFixed(3)}`);
}
