// scripts/vna/cockpit-at-cycle-end.mjs — C2363 (chair decomposition 2026-11-05 of the operator's words "build and ratchet the implied
// ones too"): away from home each steer cycle ends on the cockpit page opened once, the same panels the sidebar paints.
// The page IS steer-ui.mjs's page (what the extension's sidebar renders, and what `npx thetacog-mcp steer-ui` writes in a stranger's
// repo), so nothing here draws a panel of its own. The first cycle of a run renders it and opens it (steer-ui's own door choice: the
// sidebar when the IDE is up, the file otherwise); every later cycle re-renders it with --no-open, so the open tab or the sidebar
// re-reads it and no second window appears. The render is spawned DETACHED and never awaited: the next dispatch never waits on a page.
// At home (the tree this runner ships in) the engine paints the sidebar itself, so this returns without spawning.
// Off: VNA_COCKPIT_AT_CYCLE_END=0.
// @guard tests/vna/c2363-build-and-ratchet-the-implied-ones.test.mjs
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOME_REPO = resolve(HERE, '..', '..');   // the same "home" steer-runner.mjs's C1017d reads
export const STEER_UI = resolve(HERE, 'steer-ui.mjs');
export const COCKPIT = resolve(HERE, 'cockpit.mjs');
// 2026-11-05 (the operator's screenshot of an opened page with every panel 'not run — npx thetacog-mcp cockpit'): the page was
// rendered without the walk, so a stranger saw three empty panels. The walk runs first, then the page, in one detached chain; the
// page renders even when the walk fails, and says so itself. THETACOG_NO_OPEN=1 renders without opening (a test never opens a tab).

const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** one call per finished cycle; `state` is the run's own object ({} at the start of a run) — opened once per run, never per cycle */
export function cockpitAtCycleEnd({ repo, cycle, state = {}, env = process.env, home = HOME_REPO, spawnFn = spawn, isAlive = alive } = {}) {
  if (env.VNA_COCKPIT_AT_CYCLE_END === '0') return { spawned: false, line: null, why: 'VNA_COCKPIT_AT_CYCLE_END=0' };
  if (resolve(repo) === resolve(home)) return { spawned: false, line: null, why: 'home: the engine paints the sidebar itself' };
  if (state.pid && isAlive(state.pid)) return { spawned: false, line: `cockpit · cycle ${cycle} · the last render is still running (pid ${state.pid}) — this cycle's page waits for the next`, why: 'render running' };
  const open = !state.opened && env.THETACOG_NO_OPEN !== '1';
  const q = (p) => `'${String(p).replace(/'/g, `'\\''`)}'`;
  const args = ['-c', `${q(process.execPath)} ${q(COCKPIT)}; ${q(process.execPath)} ${q(STEER_UI)}${open ? '' : ' --no-open'}`];
  let child;
  try { child = spawnFn('/bin/sh', args, { cwd: repo, detached: true, stdio: 'ignore', env: { ...env, VNA_REPO: repo } }); child.unref?.(); }
  catch (e) { return { spawned: false, line: `cockpit · cycle ${cycle} · not rendered (${e.message}) — by hand: npx thetacog-mcp steer-ui`, why: e.message }; }
  state.opened = true; state.pid = child.pid;
  const page = resolve(repo, env.VNA_STEER_OUT || 'docs/specs/vna/steer/latest.html');
  return { spawned: true, opened: open, pid: child.pid, page, line: `cockpit · cycle ${cycle} · ${open ? 'opened' : 'refreshed'} ${page}${open ? ' (once this run; later cycles re-render it in place)' : ''}` };
}
