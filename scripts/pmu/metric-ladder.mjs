#!/usr/bin/env node
// scripts/pmu/metric-ladder.mjs — THE METRIC LADDER + the programmatic WEAKEST-LINK picker.
// =============================================================================
// The σ-precision loop's climbing numbers in ONE ordered block — each row:
// metric · current value · target · band · distance-to-target — and the system
// PICKS its own weakest link (the row furthest from target, weighted by
// leverage) so each loop iteration attacks it instead of relying on session
// memory. Every reading comes from a LIVE artifact (the running code's own
// outputs); a missing artifact renders as "no reading", never a faked value
// (fails conservative). Bands/verdicts/leads-to route through the ONE shared
// legend (sigma-legend.mjs) so wording cannot drift per surface.
//
// THE SEVEN RUNGS (source of truth = docs/architecture/pmu-architecture-qa.md
// "metrics board" + the live artifacts):
//   words-per-tile — median intersection-specific words/tile (floor 70): recomputed
//                    from snippet-library-144.json vs axis-library-v1.json parent
//                    vocabularies (same vocab form as reef-self-loop) — cheap (<1s).
//   sigma-drift    — median of the last 10 NON-docs-only commit-panel σ rows in
//                    data/pmu/measure-history.ndjson (docs-only proxy: litReality < 10
//                    — a docs-only commit has no real reality side to walk).
//   response-pass  — full-144 perturbation-probe pass count: latest reef-self-loop
//                    artifact carrying probeFull (after ?? before); fallback the
//                    latest data/pmu/perturbation-probe/<date>.json sample.
//   sigma-localize — latest data/pmu/sigma-localize/<date>.json (dated files only,
//                    never the ablation variants) → sigmaLocalize.
//   sigma-panel    — latest fresh-pair sweep summary.panel.sigmaPanel.
//   coverage       — the same panel's k/n deterministic top-rank hits.
//   uniq-first     — distinct tile openings, recomputed via tile-dump-inspect.mjs
//                    --json (measured ~0.13s — cheap enough to recompute).
//
// DISTANCE: normalized (target − value)/target, clamped 0..1, direction-aware
// (every rung here climbs UP; a 'down' metric would flip the numerator).
// WEAKEST LINK: max(distance × leverage) over rows with a reading; ties break
// to the earlier ladder row (deterministic). Leverage encodes the QA board's
// own priority — words-per-tile is "the single highest-leverage number in the
// system" (Q6), so it outranks equal distances elsewhere.
//
// CLI:  node scripts/pmu/metric-ladder.mjs            # the ladder as text
//       node scripts/pmu/metric-ladder.mjs --json     # { ladder, weakest } for machines
//
// @canonical-algorithm  read live artifacts → band via the one legend → normalized
//   distance-to-target → weakest = argmax(distance × leverage), deterministic
// @forbidden-alternative  faking a value for a missing artifact · per-surface band
//   wording · picking the next work item from session memory
// @guard  tests/pmu-simulator/metric-ladder.test.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { legend, measureBand, measureVerdict, leadsTo, readMeasureHistory } from './sigma-legend.mjs';
import { STOPWORDS } from '../../src/app/pmu-simulator/signature.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

// default live sources (every one overridable for tests — a missing path = "no reading", never a throw)
export const DEFAULTS = {
  sigmaLocalizeDir: resolve(REPO, 'data/pmu/sigma-localize'),
  freshPairDir: resolve(REPO, 'data/pmu/fresh-pair'),
  selfLoopDir: resolve(REPO, 'data/pmu/reef-self-loop'),
  probeDir: resolve(REPO, 'data/pmu/perturbation-probe'),
  historyPath: resolve(REPO, 'data/pmu/measure-history.ndjson'),
  libPath: resolve(REPO, 'data/pmu/snippet-library-144.json'),
  axisLibPath: resolve(REPO, 'docs/architecture/axis-library-v1.json'),
  orthoCmd: `node "${resolve(REPO, 'scripts/pmu/tile-dump-inspect.mjs')}" --json`,   // set false to skip recompute
};

const NO_READING = 'no reading';
const median = (a) => { const s = a.map(Number).filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (x) => +(+x).toFixed(2);

// normalized distance-to-target, clamped 0..1, direction-aware ('up' = bigger is better).
export function distanceToTarget(value, target, direction = 'up') {
  if (value == null || target == null) return null;   // Number(null) is 0 — absence must stay absent
  const v = Number(value), t = Number(target);
  if (!Number.isFinite(v) || !Number.isFinite(t) || t === 0) return null;
  const raw = direction === 'down' ? (v - t) / t : (t - v) / t;
  return r2(Math.min(1, Math.max(0, raw)));
}

// ── artifact readers (each returns null on any failure — absence is shown, not faked) ─────────

// latest dated <YYYY-MM-DD>.json in a dir (skips ablation-* etc. — the dated file IS the canonical run)
function latestDated(dir) {
  try {
    const names = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return names.length ? JSON.parse(readFileSync(resolve(dir, names[names.length - 1]), 'utf8')) : null;
  } catch { return null; }
}

function readSigmaLocalize(dir) {
  const j = latestDated(dir);
  return j && Number.isFinite(Number(j.sigmaLocalize)) ? { value: Number(j.sigmaLocalize), coord: j.coord || null } : null;
}

// latest fresh-pair sweep-*.json by mtime → summary.panel { sigmaPanel, k, n }
function readPanel(dir) {
  try {
    const files = readdirSync(dir).filter((f) => /^sweep-.*\.json$/.test(f))
      .map((f) => ({ f, m: statSync(resolve(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    for (const { f } of files) {
      const p = JSON.parse(readFileSync(resolve(dir, f), 'utf8'))?.summary?.panel;
      if (p && Number.isFinite(Number(p.sigmaPanel))) return { sigmaPanel: Number(p.sigmaPanel), k: p.k, n: p.n, file: f };
    }
  } catch { /* no reading */ }
  return null;
}

// σ_drift — median of the last `window` NON-docs-only ledger rows. The appender now records
// docsOnly exactly (commit-triptych histLine); rows predating the flag fall back to the
// documented proxy (no real reality side → litReality < 10). Exact when present, proxy never lies.
function readDriftMedian(historyPath, { window = 10 } = {}) {
  try {
    const rows = readMeasureHistory(historyPath)
      .filter((r) => Number.isFinite(Number(r?.sigmaDrift))
        && (r?.docsOnly !== undefined ? !r.docsOnly : Number(r?.litReality ?? 0) >= 10))
      .slice(-window);
    const m = median(rows.map((r) => r.sigmaDrift));
    return m == null ? null : { value: r2(m), rows: rows.length };
  } catch { return null; }
}

// full-144 σ_response pass count — latest reef-self-loop artifact (by mtime) carrying probeFull;
// fallback: the latest dated perturbation-probe sample (smaller n, honestly labelled by its n).
function readResponsePass(selfLoopDir, probeDir) {
  try {
    const files = readdirSync(selfLoopDir).filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, m: statSync(resolve(selfLoopDir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    for (const { f } of files) {
      const pf = JSON.parse(readFileSync(resolve(selfLoopDir, f), 'utf8'))?.probeFull;
      const r = pf?.after ?? pf?.before;
      if (r && Number.isFinite(Number(r.passed)) && Number(r.probed) > 0) return { passed: Number(r.passed), probed: Number(r.probed), file: f };
    }
  } catch { /* fall through */ }
  const j = latestDated(probeDir);
  return j && Number.isFinite(Number(j.passed)) && Number(j.probed) > 0 ? { passed: Number(j.passed), probed: Number(j.probed), file: 'perturbation-probe' } : null;
}

// median intersection-specific words/tile — tile vocab MINUS both parents' vocabularies
// (the ideal-case-spec measurement: parents = the row + col axis lexicons in axis-library-v1;
// same vocab form as reef-self-loop: lowercase [a-z0-9]+ minus STOPWORDS). Cheap: pure set ops.
// ONE computation, three exports: buildParentVocab + novelWordCount are the primitives the
// authoring loop's gate reuses (reef-loop --novel) so before/after can never diverge from the
// ladder's own reading (a parallel recompute is the forbidden alternative).
const vocab = (text) => new Set((String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOPWORDS.has(w)));
export function buildParentVocab(axisLibPath) {
  try {
    const axisLib = JSON.parse(readFileSync(axisLibPath, 'utf8'));
    const axes = Array.isArray(axisLib?.axes) ? axisLib.axes : null;
    if (!axes) return null;
    return Object.fromEntries(axes.map((a) => [a.rank, vocab((a.snippets || []).join(' '))]));
  } catch { return null; }
}
export function novelWordCount(text, parentRowVocab, parentColVocab) {
  let n = 0;
  for (const w of vocab(text)) if (!parentRowVocab.has(w) && !parentColVocab.has(w)) n++;
  return n;
}
export function wordsPerTile(libPath, axisLibPath) {
  try {
    const lib = JSON.parse(readFileSync(libPath, 'utf8'));
    const parentVocab = buildParentVocab(axisLibPath);
    if (!Array.isArray(lib) || !parentVocab) return null;
    const out = [];
    for (const t of lib) {
      const pr = parentVocab[t.row], pc = parentVocab[t.col];
      if (!pr || !pc) continue;
      out.push({ coord: t.coord, row: t.row, col: t.col, novel: novelWordCount(t.snippet, pr, pc) });
    }
    return out.length ? out : null;
  } catch { return null; }
}
export function wordsPerTileMedian(libPath, axisLibPath) {
  const tiles = wordsPerTile(libPath, axisLibPath);
  if (!tiles) return null;
  const m = median(tiles.map((t) => t.novel));
  return m == null ? null : { value: m, tiles: tiles.length };
}

// uniqFirst — recomputed via the deterministic inspector (measured ~0.13s; the same source
// commit-triptych's orthogonality row reads). orthoCmd=false skips (→ no reading).
function readUniqFirst(orthoCmd) {
  if (!orthoCmd) return null;
  try {
    const m = JSON.parse(execSync(orthoCmd, { encoding: 'utf8', maxBuffer: 5e7, timeout: 30000 })).metrics;
    return Number.isFinite(Number(m?.uniqFirst)) ? { value: Number(m.uniqFirst), n: Number(m.count) || 144 } : null;
  } catch { return null; }
}

// ── the ladder ─────────────────────────────────────────────────────────────────────────────────
// leverage = the QA board's own priority ordering (words-per-tile is Q6's "single
// highest-leverage number"); distance × leverage is what the weakest-link picker maximizes.
export function metricLadder(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rows = [];
  const push = (row) => rows.push(row);
  const noReading = (id, name, target, leverage, sourceNote) => push({
    id, name, value: null, display: NO_READING, target, band: 'no-reading', distance: null,
    leverage, verdict: `${NO_READING} — artifact missing (${sourceNote}); shown as absent, never faked`, leadsTo: 'produce the artifact, then re-run the ladder',
  });

  // 1 · words-per-tile (leverage 1.0 — Q6: the single highest-leverage number in the system)
  {
    const r = wordsPerTileMedian(o.libPath, o.axisLibPath);
    if (r) {
      const band = measureBand('words-per-tile', r.value, { floor: 70 });
      push({ id: 'words-per-tile', name: 'intersection-specific words/tile (median)', value: r.value, display: `${r.value} (over ${r.tiles} tiles)`, target: 70, band, distance: distanceToTarget(r.value, 70), leverage: 1.0, verdict: measureVerdict('words-per-tile', band), leadsTo: leadsTo('words-per-tile', band) });
    } else noReading('words-per-tile', 'intersection-specific words/tile (median)', 70, 1.0, 'snippet-library-144 / axis-library-v1');
  }
  // 2 · σ_response full-144 pass count (leverage 0.9)
  {
    const r = readResponsePass(o.selfLoopDir, o.probeDir);
    if (r) {
      const pct = (100 * r.passed) / r.probed;
      const band = measureBand('response-pass', pct);
      push({ id: 'response-pass', name: 'σ_response pass count', value: r.passed, display: `${r.passed}/${r.probed}`, target: r.probed, band, distance: distanceToTarget(r.passed, r.probed), leverage: 0.9, verdict: measureVerdict('response-pass', band), leadsTo: leadsTo('response-pass', band) });
    } else noReading('response-pass', 'σ_response pass count', 144, 0.9, 'reef-self-loop probeFull / perturbation-probe');
  }
  // 3 · σ_drift commit-panel median (leverage 0.8) — target 6 = the trust floor (drift bands)
  {
    const r = readDriftMedian(o.historyPath);
    if (r) {
      const band = legend('drift', r.value).band;
      push({ id: 'sigma-drift', name: 'σ_drift (commit panel, median last 10 non-docs-only)', value: r.value, display: `${r.value} (n=${r.rows})`, target: 6, band, distance: distanceToTarget(r.value, 6), leverage: 0.8, verdict: legend('drift', r.value).verdict, leadsTo: leadsTo('sigma', band) });
    } else noReading('sigma-drift', 'σ_drift (commit panel, median last 10 non-docs-only)', 6, 0.8, 'measure-history.ndjson');
  }
  // 4 · σ_localize (leverage 0.7) — target 6 = the outstanding edge
  {
    const r = readSigmaLocalize(o.sigmaLocalizeDir);
    if (r) {
      const l = legend('localize', r.value);
      push({ id: 'sigma-localize', name: 'σ_localize (latest targeted edit)', value: r.value, display: `${r.value}${r.coord ? ` @ ${r.coord}` : ''}`, target: 6, band: l.band, distance: distanceToTarget(r.value, 6), leverage: 0.7, verdict: l.verdict, leadsTo: leadsTo('localize', l.band) });
    } else noReading('sigma-localize', 'σ_localize (latest targeted edit)', 6, 0.7, 'data/pmu/sigma-localize/<date>.json');
  }
  // 5+6 · coverage + σ_panel (one sweep artifact, two readings)
  {
    const p = readPanel(o.freshPairDir);
    if (p && Number.isFinite(Number(p.k)) && Number(p.n) > 0) {
      const pct = (100 * p.k) / p.n;
      const band = measureBand('coverage', pct, { n: p.n });
      push({ id: 'coverage', name: 'sweep coverage (deterministic top-rank hits)', value: p.k, display: `${p.k}/${p.n}`, target: p.n, band, distance: distanceToTarget(p.k, p.n), leverage: 0.6, verdict: measureVerdict('coverage', band), leadsTo: leadsTo('coverage', band) });
    } else noReading('coverage', 'sweep coverage (deterministic top-rank hits)', 12, 0.6, 'fresh-pair sweep summary.panel');
    if (p) {
      const l = legend('panel', p.sigmaPanel);
      push({ id: 'sigma-panel', name: 'σ_panel (joint rank certainty)', value: p.sigmaPanel, display: `${p.sigmaPanel}`, target: 6, band: l.band, distance: distanceToTarget(p.sigmaPanel, 6), leverage: 0.5, verdict: l.verdict, leadsTo: leadsTo('panel', l.band) });
    } else noReading('sigma-panel', 'σ_panel (joint rank certainty)', 6, 0.5, 'fresh-pair sweep summary.panel');
  }
  // 7 · uniq-first seed orthogonality (leverage 0.4) — target 144 distinct openings
  {
    const r = readUniqFirst(o.orthoCmd);
    if (r) {
      const band = measureBand('uniq-first', r.value, { n: r.n });
      push({ id: 'uniq-first', name: 'seed orthogonality (distinct openings)', value: r.value, display: `${r.value}/${r.n}`, target: r.n, band, distance: distanceToTarget(r.value, r.n), leverage: 0.4, verdict: measureVerdict('uniq-first', band), leadsTo: leadsTo('uniq-first', band) });
    } else noReading('uniq-first', 'seed orthogonality (distinct openings)', 144, 0.4, 'tile-dump-inspect --json');
  }
  return rows;
}

// ── the weakest-link picker — deterministic, leverage-weighted, one-line WHY ───────────────────
export function weakestLink(ladder) {
  let best = null, bestScore = -1;
  for (const row of ladder || []) {
    if (!Number.isFinite(row?.distance)) continue;   // "no reading" never wins (no coercion: Number(null)=0) — fails conservative
    const score = Number(row.distance) * Number(row.leverage ?? 1);
    if (score > bestScore) { bestScore = score; best = row; }   // strict > keeps ties on the EARLIER row
  }
  if (!best) return null;
  return {
    ...best,
    score: r2(bestScore),
    why: `${best.name} is furthest from target weighted by leverage (${best.display} vs target ${best.target} → distance ${best.distance} × leverage ${best.leverage} = ${r2(bestScore)}) — ${best.leadsTo}`,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const ladder = metricLadder();
  const weak = weakestLink(ladder);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ measured: new Date().toISOString(), ladder, weakest: weak }, null, 2));
  } else {
    console.log('THE LADDER — what\'s climbing · weakest link first');
    const sorted = [...ladder].sort((a, b) => {
      const sa = Number.isFinite(a.distance) ? a.distance * a.leverage : -1;
      const sb = Number.isFinite(b.distance) ? b.distance * b.leverage : -1;
      return sb - sa;
    });
    for (const r of sorted) {
      const mark = weak && r.id === weak.id ? '→ WEAKEST ' : '          ';
      console.log(`${mark}${r.name}: ${r.display} · target ${r.target} · ${r.band}${Number.isFinite(r.distance) ? ` · distance ${r.distance}` : ''}`);
      console.log(`            ${r.verdict}${r.leadsTo ? ` → ${r.leadsTo}` : ''}`);
    }
    if (weak) console.log(`\nWEAKEST LINK: ${weak.why}`);
    else console.log('\nWEAKEST LINK: none — no rung has a reading');
  }
}
