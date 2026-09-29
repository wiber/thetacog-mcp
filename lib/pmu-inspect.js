// packages/thetacog-mcp/lib/pmu-inspect.js
//
// MCP `thetacog-pmu-inspect` dispatcher. Operates against the PMU pipeline
// state file (data/pmu/pipeline/state.json) and stage receipts
// (data/pmu/pipeline/stages/<run_id>.json) so the MCP tool, the dashboard,
// and the CLI driver all share one source of truth.
//
// The dispatcher does NOT import the pipeline driver — it shells out to
// `node scripts/pmu/pipeline.mjs --json` so this lib stays portable across
// the published npm package, where scripts/pmu/* are repo-resident, not
// package-resident.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const STATE_PATH = resolve(REPO_ROOT, 'data/pmu/pipeline/state.json');
const STAGES_DIR = resolve(REPO_ROOT, 'data/pmu/pipeline/stages');
const LIB_144_PATH = resolve(REPO_ROOT, 'data/pmu/snippet-library-144.json');
const LIB_20K_PATH = resolve(REPO_ROOT, 'data/pmu/snippet-library-20736.json');
const DRIVER_PATH = resolve(REPO_ROOT, 'scripts/pmu/pipeline.mjs');

const DEFAULT_STATE = {
  intent:  { kind: 'coord', value: 'A1,A1' },
  reality: { kind: 'mix',   value: '', mix: { base: 'A1,A1', drift: 'B2,B2', drift_fraction: 0.30 } },
  threshold: 'adaptive',
  sigma_floor: 3.4,
  last_run: null
};

function loadState() {
  if (!existsSync(STATE_PATH)) {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
    return { ...DEFAULT_STATE };
  }
  return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) };
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function normalizeSpec(input) {
  if (typeof input === 'string') {
    if (/^[A-C][1-3]?,[A-C][1-3]?$/.test(input.trim())) {
      return { kind: 'coord', value: input.trim() };
    }
    return { kind: 'text', value: input };
  }
  return input;
}

export function dispatchPmuInspect(args = {}) {
  const action = args.action || 'get-state';
  switch (action) {
    case 'get-state':      return handleGetState();
    case 'set-intent':     return handleSetIntent(args);
    case 'set-reality':    return handleSetReality(args);
    case 'set-threshold':  return handleSetThreshold(args);
    case 'run':            return handleRun(args);
    case 'get-run':        return handleGetRun(args);
    case 'list-runs':      return handleListRuns(args);
    case 'list-axes':      return handleListAxes(args);
    case 'list-tiles':     return handleListTiles(args);
    case 'reset':          return handleReset();
    default:
      return {
        error: `unknown action: ${action}`,
        valid_actions: ['get-state', 'set-intent', 'set-reality', 'set-threshold',
                        'run', 'get-run', 'list-runs', 'list-axes', 'list-tiles', 'reset']
      };
  }
}

function handleGetState() {
  if (!existsSync(LIB_144_PATH)) return { error: `axis library missing: ${LIB_144_PATH}`, repo_root: REPO_ROOT };
  const state = loadState();
  return {
    state,
    state_path: STATE_PATH,
    driver_path: DRIVER_PATH,
    axes_count: 144,
    tiles_available: existsSync(LIB_20K_PATH),
    last_run_id: state.last_run?.run_id || null,
    last_run_ok: state.last_run?.ok ?? null,
    last_run_sigma: state.last_run?.stages?.sigma?.sigma ?? null,
    last_run_friction: state.last_run?.stages?.xor?.friction_nodes ?? null
  };
}

function handleSetIntent(args) {
  const value = args.value ?? args.text ?? args.coord;
  if (value == null && !args.mix) return { error: 'set-intent requires `value` (coord/text) or `mix`' };
  const state = loadState();
  if (args.mix) state.intent = { kind: 'mix', value: '', mix: args.mix };
  else if (args.kind === 'file') state.intent = { kind: 'file', value };
  else state.intent = normalizeSpec(value);
  saveState(state);
  return { ok: true, intent: state.intent };
}

function handleSetReality(args) {
  const value = args.value ?? args.text ?? args.coord;
  const state = loadState();
  if (args.mix) state.reality = { kind: 'mix', value: '', mix: args.mix };
  else if (args.kind === 'file' && value != null) state.reality = { kind: 'file', value };
  else if (value != null) state.reality = normalizeSpec(value);
  else return { error: 'set-reality requires `value` (coord/text), `mix`, or kind=file + value' };
  saveState(state);
  return { ok: true, reality: state.reality };
}

function handleSetThreshold(args) {
  const t = args.value ?? args.threshold;
  if (t == null) return { error: 'set-threshold requires `value`' };
  const state = loadState();
  state.threshold = (t === 'adaptive' || t === 'auto') ? 'adaptive' : parseFloat(t);
  if (state.threshold !== 'adaptive' && Number.isNaN(state.threshold)) {
    return { error: `bad threshold: ${t} (expected number or "adaptive")` };
  }
  saveState(state);
  return { ok: true, threshold: state.threshold };
}

function handleRun(args) {
  if (!existsSync(DRIVER_PATH)) return { error: `driver missing: ${DRIVER_PATH}` };
  const cliArgs = ['--json'];
  if (args.stage) cliArgs.push('--stage', String(args.stage));
  if (args.threshold != null) cliArgs.push('--threshold', String(args.threshold));
  const res = spawnSync('node', [DRIVER_PATH, ...cliArgs], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.error) return { error: `spawn failed: ${res.error.message}` };
  if (res.status !== 0) return { error: `driver exited ${res.status}`, stderr: res.stderr };
  try { return { ok: true, receipt: JSON.parse(res.stdout) }; }
  catch (e) { return { error: `bad driver output: ${e.message}`, stdout_head: res.stdout.slice(0, 200) }; }
}

function handleGetRun(args) {
  const runId = args.run_id || args.id;
  if (!runId) return { error: 'get-run requires `run_id`' };
  const p = resolve(STAGES_DIR, `${runId}.json`);
  if (!existsSync(p)) return { error: `no such run: ${runId}` };
  return { run_id: runId, receipt: JSON.parse(readFileSync(p, 'utf8')) };
}

function handleListRuns(args) {
  if (!existsSync(STAGES_DIR)) return { count: 0, runs: [] };
  const limit = args.limit ?? 10;
  const files = readdirSync(STAGES_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit);
  return {
    count: files.length,
    runs: files.map(f => {
      const r = JSON.parse(readFileSync(resolve(STAGES_DIR, f), 'utf8'));
      return {
        run_id: r.run_id,
        ok: r.ok,
        sigma: r.stages?.sigma?.sigma ?? null,
        friction_nodes: r.stages?.xor?.friction_nodes ?? null,
        ended_at: r.ended_at
      };
    })
  };
}

function handleListAxes(args) {
  if (!existsSync(LIB_144_PATH)) return { error: `library missing: ${LIB_144_PATH}` };
  const lib = JSON.parse(readFileSync(LIB_144_PATH, 'utf8'));
  const limit = args.limit ?? 24;
  return {
    total: lib.length,
    shown: Math.min(limit, lib.length),
    axes: lib.slice(0, limit).map(e => ({
      coord: e.coord, row: e.row, col: e.col, snippet_preview: (e.snippet || '').slice(0, 80)
    }))
  };
}

function handleListTiles(args) {
  if (!existsSync(LIB_20K_PATH)) return { error: `tile library missing: ${LIB_20K_PATH}` };
  const lib = JSON.parse(readFileSync(LIB_20K_PATH, 'utf8'));
  const offset = args.offset ?? 0;
  const limit  = args.limit  ?? 20;
  return {
    total: lib.length,
    offset, limit,
    tiles: lib.slice(offset, offset + limit).map(t => ({
      address: t.address, parent: t.parent, mass: t.mass,
      snippet_preview: (t.snippet || '').slice(0, 80)
    }))
  };
}

function handleReset() {
  saveState({ ...DEFAULT_STATE });
  return { ok: true, state: DEFAULT_STATE };
}
