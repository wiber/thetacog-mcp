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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');
// PMU_PIPELINE_STATE overrides the on-disk location — tests point it at a scratch file so the
// corrupt-file recovery path can be exercised without touching the live tracked state.json.
export const STATE_PATH = process.env.PMU_PIPELINE_STATE
  ? resolve(process.env.PMU_PIPELINE_STATE)
  : resolve(REPO_ROOT, 'data/pmu/pipeline/state.json');
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

// ── THE ONE PLACE state.json IS READ AND WRITTEN ──────────────────────────────────────────────────
// INCIDENT 2026-09-06 22:11Z ("⛔ PMU pipeline invariant BREACH"): state.json held TWO documents —
// a complete one, then the tail of another starting at byte 458135 (`"run_id": "run-2026-09-06T15-35-…"`).
// saveState was a bare writeFileSync, and the pipeline is fired concurrently by post-commit hooks from
// many sessions. Two writers both open(O_TRUNC); the longer write lands; the shorter one then overwrites
// offset 0 and leaves the longer one's tail behind. loadState did a bare JSON.parse, so every
// commit-triptych render threw at pipeline.mjs:268 and no drift panel was produced for ANY commit.
//
// The fix has two halves and both live HERE (one rule, one place — claudbridge-mock.mjs used to carry
// its own writeFileSync of the same file; it now calls saveState):
//   (a) saveState writes a temp file in the SAME directory and renameSync()s it over state.json —
//       rename is atomic on the same filesystem, so a reader sees the old document or the new one,
//       never an interleaving of two.
//   (b) loadState never throws on a corrupt file. It parses; on failure it recovers the FIRST document
//       (the longest prefix that parses to a plain object), moves the corrupt bytes aside as
//       state.json.corrupt-<ts>-<pid> (AXIOM 1 — evict OR retain, never silently discard: the aside IS
//       the record of what was there), writes the recovered document back atomically, and prints ONE
//       stderr line naming the corruption and the recovery. If no prefix parses it falls back to
//       DEFAULT_STATE with the same aside + line. The receipt for a recovery is the aside file plus
//       that line.
// Guard: tests/pmu-simulator/pipeline-state-atomic-and-recovers.test.mjs (smoke + no-smoke + atomic).

function corruptAsidePath() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(dirname(STATE_PATH), `${basename(STATE_PATH)}.corrupt-${ts}-${process.pid}`);
}

// Longest prefix of `raw` that parses to a plain JSON object, or null. Pretty-printed documents close
// with a `}` at column 0, so those candidates are tried first (longest first); every other `}` is a
// fallback so a minified or hand-edited file still recovers.
export function recoverFirstJsonObject(raw) {
  const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const tryPrefix = end => {
    try { const v = JSON.parse(raw.slice(0, end + 1)); return isPlainObject(v) ? v : null; } catch { return null; }
  };
  const col0 = [];
  const others = [];
  for (let i = raw.indexOf('}'); i >= 0; i = raw.indexOf('}', i + 1)) {
    (i === 0 || raw[i - 1] === '\n') ? col0.push(i) : others.push(i);
  }
  for (const list of [col0, others]) {
    for (let k = list.length - 1; k >= 0; k--) {
      const v = tryPrefix(list[k]);
      if (v) return { value: v, bytes: list[k] + 1 };
    }
  }
  return null;
}

export function loadState() {
  if (!existsSync(STATE_PATH)) {
    saveState(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
  const raw = readFileSync(STATE_PATH, 'utf8');
  let s;
  try {
    s = JSON.parse(raw);
  } catch (err) {
    const aside = corruptAsidePath();
    writeFileSync(aside, raw);
    const rec = recoverFirstJsonObject(raw);
    s = rec ? rec.value : structuredClone(DEFAULT_STATE);
    saveState(s);
    const how = rec
      ? `recovered the first document (${rec.bytes} of ${raw.length} bytes)`
      : `no prefix parsed — fell back to DEFAULT_STATE`;
    process.stderr.write(
      `[pipeline-state] CORRUPT ${STATE_PATH} (${String(err.message).slice(0, 90)}): ${how}; corrupt bytes kept aside at ${aside}\n`
    );
  }
  return { ...structuredClone(DEFAULT_STATE), ...s };
}

export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  // temp in the SAME directory (rename across filesystems is not atomic); unique per writer so two
  // concurrent savers never share a temp file either.
  const tmp = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, STATE_PATH);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
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
