// packages/thetacog-mcp/tests/dinner-demo.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE-BEAT THEATER GUARD (operator 2026-07-10, Monday dinner). The dinner demo is the stripped,
// room-facing face of attest-demo: BEAT 1 green/in-lane · BEAT 2 red/out-of-lane-caught · BEAT 3 the
// signed recomputable receipt + the silent-drop line. It must (a) run the REAL engine (attest-demo,
// never a mock — dogfood is the demo), (b) print exactly the three beats + the recompute command, and
// (c) be registered as an npx subcommand. --auto runs it without pauses for CI.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(resolve(PKG, 'scripts/pmu/dinner-demo.mjs'), 'utf8');

test('the theater runs the REAL attest-demo engine, not a mock', () => {
  assert.match(SRC, /attest-demo\.mjs/, 'must shell the real demo');
  assert.ok(!/Math\.random|hardcoded|fakeSigma\s*=\s*['"]/.test(SRC), 'no fabricated numbers');
});

test('dinner-demo is registered as an npx subcommand', () => {
  const server = readFileSync(resolve(PKG, 'server.js'), 'utf8');
  assert.match(server, /'dinner-demo', 'scripts\/pmu\/dinner-demo\.mjs'/);
});

test('end-to-end --auto: prints all three beats + the recompute command + the silent-drop cue', () => {
  const out = execFileSync('node', ['scripts/pmu/dinner-demo.mjs', '--auto'],
    { cwd: PKG, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.match(out, /BEAT 1 · BASELINE/, 'beat 1 present');
  assert.match(out, /BEAT 2 · DRIFT/, 'beat 2 present');
  assert.match(out, /BEAT 3 · THE RECEIPT/, 'beat 3 present');
  assert.match(out, /IN LANE/, 'the green in-lane placement shows');
  assert.match(out, /OUT OF LANE/, 'the red out-of-lane placement shows');
  assert.match(out, /npx thetacog-mcp verify-receipt/, 'the recompute-it-yourself command shows');
  assert.match(out, /slide it across the table/, 'the silent-drop cue is the closer');
  // grounded in the real engine: the beats carry a real lattice cell (letter+optional digit)
  assert.match(out, /lands at\s+\x1b\[[\d;]*m[A-C]\d?/, 'beat 1 shows a real placed cell from the engine');
});
