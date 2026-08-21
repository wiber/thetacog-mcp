// scripts/pmu/pipeline-state.mjs
//
// Shared state for the XOR → ClaudBridge pipeline.
//
// State is held on disk at data/pmu/pipeline/state.json so the CLI driver,
// MCP inspect tool, and dashboard all see the same intent/reality inputs and
// the same most-recent run-receipt. The 144-axis library is memoized in
// process; the 20,736-node library is loaded on demand only.
//
// Shape:
//   {
//     intent:  { kind:'coord'|'text'|'file', value:string },
//     reality: { kind:'coord'|'text'|'file'|'mix', value:string,
//                mix?:{base:string, drift:string, drift_fraction:number} },
//     last_run: { run_id, started_at, ended_at, stages:{...}, ok:boolean }
//                (mirror of data/pmu/pipeline/stages/<run_id>.json)
//     threshold: number,   // binarization gate (default 0.30)
//     sigma_floor: number  // earned-gold band (default 3.4)
//   }

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');
export const STATE_PATH = resolve(REPO_ROOT, 'data/pmu/pipeline/state.json');
export const STAGES_DIR = resolve(REPO_ROOT, 'data/pmu/pipeline/stages');
export const LIB_144_PATH = resolve(REPO_ROOT, 'data/pmu/snippet-library-144.json');
export const LIB_20K_PATH = resolve(REPO_ROOT, 'data/pmu/snippet-library-20736.json');

const DEFAULT_STATE = {
  intent:  { kind: 'coord', value: 'A1,A1' },
  reality: { kind: 'mix',   value: '', mix: { base: 'A1,A1', drift: 'B2,B2', drift_fraction: 0.30 } },
  threshold: '1σ',
  sigma_floor: 3.4,
  last_run: null
};

let _lib20k = null;

// ── loadAxes cache — keyed by RESOLVED PATH, not a single module-global slot ────────────────────
// WHY A MAP AND NOT A SECOND `let`: a session-scoped axis library (a tape session's own 144-cell
// naming, e.g. .thetacog/tape-sessions/<slug>/axes-144.json) needs to be loadable ALONGSIDE the
// repo-wide library, in the SAME process, without one clobbering the other. A single memoized slot
// (the pre-existing `_lib144`) is exactly the "memoized module-global clobbered by concurrent
// renders" hazard CLAUDE.md names — two renders in flight (one repo-scoped, one session-scoped)
// would race to overwrite the same variable. Keying by resolved path makes each path's cache entry
// independent, so an override can never leak into a caller that asked for the default.
// Default call `loadAxes()` (no argument) resolves to LIB_144_PATH — same object, same memoization,
// byte-identical to the pre-Map behaviour. This is the ONLY thing that may change silently; it must
// not.
const _axesCache = new Map();

export function loadAxes(path = LIB_144_PATH) {
  const resolvedPath = resolve(path);
  if (_axesCache.has(resolvedPath)) return _axesCache.get(resolvedPath);
  const data = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  _axesCache.set(resolvedPath, data);
  return data;
}

import { gzipSync as zlibGzipSync } from 'node:zlib';

export function loadTiles() {
  if (_lib20k) return _lib20k;
  if (!existsSync(LIB_20K_PATH)) throw new Error(`tiles library missing: ${LIB_20K_PATH}`);
  _lib20k = JSON.parse(readFileSync(LIB_20K_PATH, 'utf8'));
  return _lib20k;
}

let _tilesGzipLens = null;
export function getTilesGzipLens() {
  if (_tilesGzipLens) return _tilesGzipLens;
  const tiles = loadTiles();
  _tilesGzipLens = tiles.map(t => {
    return {
      len: zlibGzipSync(Buffer.from(t.snippet, 'utf8')).length,
      snippet: t.snippet
    };
  });
  return _tilesGzipLens;
}

export function loadState() {
  if (!existsSync(STATE_PATH)) {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
    return structuredClone(DEFAULT_STATE);
  }
  const s = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  return { ...structuredClone(DEFAULT_STATE), ...s };
}

export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function setIntent(input) {
  const state = loadState();
  state.intent = normalizeInput(input);
  saveState(state);
  return state.intent;
}

export function setReality(input) {
  const state = loadState();
  state.reality = normalizeInput(input);
  saveState(state);
  return state.reality;
}

function normalizeInput(input) {
  if (typeof input === 'string') {
    // Heuristic: "A1,A1" pattern = coord; else text
    if (/^[A-C][1-3]?,[A-C][1-3]?$/.test(input.trim())) {
      return { kind: 'coord', value: input.trim() };
    }
    return { kind: 'text', value: input };
  }
  if (input && typeof input === 'object') return input;
  throw new Error(`unknown input shape: ${typeof input}`);
}

// Resolve an intent/reality spec to a snippet (the thing we actually compress).
export function resolveSnippet(spec, axes = loadAxes()) {
  if (spec.kind === 'coord') {
    const entry = axes.find(e => e.coord === spec.value);
    if (!entry) throw new Error(`coord not in library: ${spec.value}`);
    return entry.snippet;
  }
  if (spec.kind === 'text') return spec.value;
  if (spec.kind === 'file') {
    const p = resolve(REPO_ROOT, spec.value);
    return readFileSync(p, 'utf8');
  }
  if (spec.kind === 'mix') {
    const base  = axes.find(e => e.coord === spec.mix.base);
    const drift = axes.find(e => e.coord === spec.mix.drift);
    if (!base || !drift) throw new Error(`mix coords missing: ${spec.mix.base} / ${spec.mix.drift}`);
    const f = Math.max(0, Math.min(1, spec.mix.drift_fraction));
    const head = base.snippet.slice(0, Math.floor(base.snippet.length * (1 - f)));
    const tail = drift.snippet.slice(0, Math.floor(drift.snippet.length * f));
    return head + '\n\n' + tail;
  }
  throw new Error(`unknown spec.kind: ${spec.kind}`);
}

// Lightweight axis index → coord lookup, used by the projection step
export function axisIndex(axes = loadAxes()) {
  return axes.map(e => e.coord);
}

// Write per-run-id stage receipt; returns the absolute path.
export function writeRunReceipt(runId, receipt) {
  mkdirSync(STAGES_DIR, { recursive: true });
  const p = resolve(STAGES_DIR, `${runId}.json`);
  writeFileSync(p, JSON.stringify(receipt, null, 2));
  // Update last_run pointer
  const state = loadState();
  state.last_run = receipt;
  saveState(state);
  return p;
}

export function listRuns() {
  if (!existsSync(STAGES_DIR)) return [];
  return readdirSync(STAGES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
}
