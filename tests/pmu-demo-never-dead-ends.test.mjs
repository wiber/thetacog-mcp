// packages/thetacog-mcp/tests/pmu-demo-never-dead-ends.test.mjs — THE NO-DEAD-END GUARD
//
// Incident (2026-07-24, posture-spec session): the README Quick Start (and older outreach)
// still instructs strangers to run `npx thetacog-mcp pmu-demo`, but the 2026-06-29 kill-switch
// (correctly retiring the parallel demo-th-rec report generator) made that documented entry
// print "disabled: …" and exit — a dead end at the exact moment a stranger follows the proof
// line. The market posture is "civilized roads": a documented entry may retire, but it must
// ROUTE onto the canonical pipeline (`prove`, the first-run self-proof), never dead-end.
//
// Two guards:
//   1. SOURCE — the kill-switch branch imports the canonical prove chain (and the retired
//      generator stays opt-in behind DEMO_TH_REC=1, honoring the 2026-06-29 directive).
//   2. BEHAVIOR — `node server.js pmu-demo` (no env opt-in) actually emits the self-proof
//      banner, not the old "disabled:" line.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('pmu-demo kill-switch routes to the canonical prove chain in source', () => {
  const src = readFileSync(resolve(PKG, 'scripts/pmu-demo.mjs'), 'utf8');
  assert.match(src, /DEMO_TH_REC/, 'the 2026-06-29 opt-in kill-switch must remain');
  assert.match(src, /import\(['"]\.\/pmu\/prove\.mjs['"]\)/,
    'the non-opt-in path must import the canonical prove chain, not dead-end');
});

test('pmu-demo without DEMO_TH_REC runs the first-run self-proof, not "disabled:"', () => {
  const env = { ...process.env };
  delete env.DEMO_TH_REC;
  const out = execFileSync(process.execPath, [resolve(PKG, 'server.js'), 'pmu-demo'], {
    encoding: 'utf8', env, timeout: 120000,
  });
  assert.ok(!out.startsWith('disabled:'), 'documented entry must never open with a dead end');
  assert.match(out, /first-run self-proof/, 'must emit the canonical prove banner');
});

test('an abstain is a distance reading, never a silent skip (the stranger first-60-seconds guard)', () => {
  // 2026-07-24: `prove` PILLAR 3 read 20/20 commits as bare abstains — honest, but a stranger's
  // first impression was "the instrument never fires on MY work". Every abstain must now render
  // its nearest tile + bits-over-noise-floor. Whenever ANY abstain occurs, the nearest-miss
  // readout MUST accompany it; zero-abstain runs are exempt.
  const out = execFileSync(process.execPath, [resolve(PKG, 'server.js'), 'prove'], {
    encoding: 'utf8', timeout: 120000, cwd: resolve(PKG, '..', '..'),
  });
  const m = out.match(/(\d+) honest abstains/);
  assert.ok(m, 'PILLAR 3 must report the abstain count');
  if (Number(m[1]) > 0) {
    assert.match(out, /nearest misses .*distance reading/, 'abstains must carry the nearest-miss readout');
    assert.match(out, /@ \d+ bits — [\d.]+ over the noise floor/, 'each miss must show tile distance vs noise floor');
  }
});
