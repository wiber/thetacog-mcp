#!/usr/bin/env node
// scripts/vna/steer-board-sync.mjs — C1025 STEER RUNS THE BOARD: before a steer cycle classifies and dispatches, this runs
// the board read (board.mjs --pull-drive), `board-answers.mjs route` (lands new ANSWERS on their rows) and
// `board-comments.mjs pull` (runs the operator's own comments as /steers in the owning room) — so a span or a comment lands
// on its row BEFORE the cycle reads the spec. Each step is SPAWNED (never imported — the board has its own CLI contract,
// and a test points the three paths at stubs, no real Drive call), and a step that cannot run (no Drive remote, nothing to
// route) prints UNMEASURED with its reason; the sync goes on regardless — the board never gates or blocks the steer loop.
// (operator 2026-10-19, relayed by wo1 bf-6380, mesh_fdf3631e-f4f, verbatim: "Delegate maybe we need a skill that hooks into
// steer".) Transport and orchestration only (three spawned CLIs): no port row for the Rust crate (MAXIMISE RUST: node stays
// node for this).
//   node scripts/vna/steer-board-sync.mjs
// @guard tests/ops/c1025-steer-runs-the-board.test.mjs
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
// C1063 (2026-10-20: every cycle printed 'board read: UNMEASURED — pull failed — directory not found'): --pull-drive copies the one
// 'ThetaCog/ThetaCog Board.xlsx' the board was before it became one sheet per surface plus the book, so the read had been dead. The board
// read is now one watch pass (board-watch.mjs): every sheet by id, metadata first, zero tokens unless he changed a cell.
export const BOARD_CLI = process.env.STEER_BOARD_CLI || resolve(REPO, 'scripts/ops/board-watch.mjs');
export const BOARD_READ_ARGS = [];
export const BOARD_ANSWERS_CLI = process.env.STEER_BOARD_ANSWERS_CLI || resolve(REPO, 'scripts/ops/board-answers.mjs');
export const BOARD_COMMENTS_CLI = process.env.STEER_BOARD_COMMENTS_CLI || resolve(REPO, 'scripts/ops/board-comments.mjs');

function run(cli, args, { repo = REPO } = {}) {
  try { return { ok: true, out: execFileSync('node', [cli, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message || e) }; }
}
const oneLine = (s) => String(s || '').trim().split('\n').filter(Boolean).pop() || '';

/** the board read — one board-watch.mjs pass; UNMEASURED (never a halt) when Drive cannot be read (the watch's own why) */
export function boardRead({ repo = REPO, cli = BOARD_CLI } = {}) {
  const r = run(cli, BOARD_READ_ARGS, { repo });
  if (r.ok) return { ok: true, line: `board read: ${oneLine(r.out) || 'pulled'}` };
  const m = /UNMEASURED — (.+)/.exec(r.out);
  return { ok: false, line: `board read: UNMEASURED — ${m ? m[1] : oneLine(r.out) || 'the pull failed'}` };
}

/** board-answers.mjs route — lands every new ANSWER on its spec row; UNMEASURED on any failure, never a throw */
export function routeAnswers({ repo = REPO, cli = BOARD_ANSWERS_CLI } = {}) {
  const r = run(cli, ['route'], { repo });
  return { ok: r.ok, line: r.ok ? `board route: ${oneLine(r.out) || 'landed 0 answer(s)'}` : `board route: UNMEASURED — ${oneLine(r.out) || 'route failed'}` };
}

/** board-comments.mjs pull — runs the operator's own comments as /steers in the owning room; UNMEASURED on any failure */
export function pullComments({ repo = REPO, cli = BOARD_COMMENTS_CLI } = {}) {
  const r = run(cli, ['pull'], { repo });
  return { ok: r.ok, line: r.ok ? `board comments: ${oneLine(r.out) || 'pulled'}` : `board comments: UNMEASURED — ${oneLine(r.out) || 'pull failed'}` };
}

/** THE DOOR — runs all three, in order, before a steer cycle classifies and dispatches. Never throws: a step that cannot
 * run is UNMEASURED with its reason, and the sync goes on — the board never gates or blocks the steer loop (C186's own rule). */
export function boardSyncBeforeCycle({ repo = REPO, say = () => {}, boardCli = BOARD_CLI, answersCli = BOARD_ANSWERS_CLI, commentsCli = BOARD_COMMENTS_CLI } = {}) {
  const steps = [boardRead({ repo, cli: boardCli }), routeAnswers({ repo, cli: answersCli }), pullComments({ repo, cli: commentsCli })];
  for (const s of steps) say(s.line);
  return { lines: steps.map((s) => s.line), ok: steps.every((s) => s.ok) };
}

// C2170b — THE PROJECT SHEETS BETWEEN CYCLES (operator 2026-10-30, verbatim: "it needs to be always called by the sear when we enable it"
// · "you do the work first, and then you run the fire the Works you can and then you do the cold shots … it’s supposed to be using the
// space between each cycle"). The READ of his cells stays before the cycle (boardRead above, board-watch). The WRITE runs after a verdict
// lands: one detached, niced `board-project.mjs --between` child, which holds a lock (never two at once) and writes only a sheet whose
// composed grid hash moved. projects.json steer.enabled false spawns nothing. Never throws, never waits on the child.
export const PROJECT_CLI = process.env.STEER_PROJECT_CLI || resolve(REPO, 'scripts/ops/board-project.mjs');
export const PROJECTS_CFG = 'docs/specs/vna/projects.json';
export function projectSheetsBetween({ repo = REPO, cli = PROJECT_CLI, cfgPath = resolve(repo, PROJECTS_CFG), spawnFn = null } = {}) {
  // under node --test --test-concurrency=2 with no spawn handed in, a loop test that stubs the board must never write to the live Drive
  if (!spawnFn && process.env.NODE_TEST_CONTEXT) return { spawned: false, line: 'project sheets: not run under a test runner (no spawn handed in)' };
  spawnFn = spawnFn || spawn;
  let cfg = null; try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch (e) { return { spawned: false, line: `project sheets: UNMEASURED — no ${PROJECTS_CFG} (${String(e.code || e.message)})` }; }
  if (!cfg.steer || !cfg.steer.enabled) return { spawned: false, line: 'project sheets: off (projects.json steer.enabled false) — on ask: node scripts/ops/board-project.mjs --all' };
  try {
    const child = spawnFn('nice', ['-n', '19', process.execPath, cli, '--between'], { cwd: repo, detached: true, stdio: 'ignore' });
    if (child && child.unref) child.unref();
    return { spawned: true, line: `project sheets: between-cycles pass spawned (detached, nice 19, writes only what moved; ledger .thetacog/project-sheets.ndjson)` };
  } catch (e) { return { spawned: false, line: `project sheets: UNMEASURED — ${String(e && e.message || e).slice(0, 120)}` }; }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) { boardSyncBeforeCycle({ say: console.log }); process.exit(0); }
