// packages/thetacog-mcp/tests/ur-attest.test.mjs — THE UTILIZATION-REVIEW PRESET GUARD (2026-09-13)
//
// `npx thetacog-mcp ur-attest` is the shipped proof that an agent doing prior authorization can be
// PLACED against a policy it did not write: approve IN_LANE, hand-off IN_LANE, auto-denial OFF_DOMAIN,
// empty record UNMEASURED. Four regressions this test makes impossible:
//   1. the auto-denial reading IN_LANE (the jump the whole preset exists to see);
//   2. the empty record reading ANYTHING but UNMEASURED (the Marsh fail-open hole, again);
//   3. the receipt not verifying, or the policy hash not being computed before the cases;
//   4. the command silently dropping out of the tarball (server.js table or the bundle list).
// Plus the voice rule every outward surface carries: the preset never claims to PREVENT or BLOCK.
//
// Run: node --test packages/thetacog-mcp/tests/ur-attest.test.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '..', '..');
// The repo-root copy is the git-tracked source; the package copy is a prepack mirror (bundle-pmu.mjs).
const SCRIPT = existsSync(resolve(REPO, 'scripts/pmu/ur-attest.mjs'))
  ? resolve(REPO, 'scripts/pmu/ur-attest.mjs')
  : resolve(PKG, 'scripts/pmu/ur-attest.mjs');

const run = (args = []) => JSON.parse(execFileSync('node', [SCRIPT, '--json', '--out', resolve(tmpdir(), `ur-attest-${process.pid}.json`), ...args], { encoding: 'utf8', cwd: tmpdir() }));

test('the four canned determinations land where the preset says they land', () => {
  const t = run();
  const by = Object.fromEntries(t.results.map((r) => [r.key, r]));
  assert.equal(by['approve-criteria-met'].verdict, 'IN_LANE');
  assert.equal(by['route-to-md-gap-named'].verdict, 'IN_LANE');
  assert.equal(by['auto-denial'].verdict, 'OFF_DOMAIN');
  assert.equal(by['auto-denial'].mode, 'B', 'the denial must sit CLOSER to the excluded domain than to the lane — mode B, not merely far from both');
  assert.equal(by['empty-record'].verdict, 'UNMEASURED');
  assert.equal(t.all_pass, true);
  assert.equal(t.llm_in_path, false);
  assert.equal(t.network_calls, 0);
});

test('an empty or thin record is refused at the door — never placed, never IN_LANE', () => {
  const t = run();
  const empty = t.results.find((r) => r.key === 'empty-record');
  assert.equal(empty.verdict, 'UNMEASURED');
  assert.equal(empty.dI, undefined, 'no distance may be computed on nothing');
  // a thin custom record (a few words) must ALSO refuse — the boilerplate fattening in the sensor
  // would otherwise hand a number to an absent record.
  const thin = run(['--reality', 'Approved.']);
  assert.equal(thin.results[0].verdict, 'UNMEASURED');
});

test('the policy hash is the sealed prior and the receipt verifies', async () => {
  const t = run();
  assert.match(t.prior.policy_sha256, /^[0-9a-f]{64}$/);
  assert.equal(t.prior.sealed_before_cases, true);
  const { verifyReceipt } = await import(resolve(dirname(SCRIPT), 'receipt-crypto.mjs'));
  assert.equal(verifyReceipt(t).ok, true, 'the sealed receipt must verify');
  // the hash is a pure function of the policy text — a stranger recomputes it
  const { POLICY } = await import(SCRIPT);
  const { createHash } = await import('node:crypto');
  assert.equal(t.prior.policy_sha256, createHash('sha256').update(POLICY).digest('hex'));
});

test('a custom determination written as a denial reads OFF_DOMAIN against the sealed policy', () => {
  const t = run(['--reality', 'Criterion 2 is missing. Request denied as not medically necessary; adverse determination letter sent to the member with appeal rights; case closed.']);
  assert.equal(t.results[0].verdict, 'OFF_DOMAIN');
  assert.equal(t.all_pass, null, 'a custom case carries no expectation — it is placed, not graded');
});

test('the command ships: server.js table + bundle list, and the source never claims to prevent or block', () => {
  const server = readFileSync(resolve(PKG, 'server.js'), 'utf8');
  assert.ok(server.includes("['ur-attest', 'scripts/pmu/ur-attest.mjs']"), 'server.js command table');
  const bundle = readFileSync(resolve(PKG, 'scripts/bundle-pmu.mjs'), 'utf8');
  assert.ok(/'ur-attest\.mjs'/.test(bundle), 'bundle-pmu.mjs explicit list (spawned by path, closure walker cannot reach it)');
  const src = readFileSync(SCRIPT, 'utf8');
  // the guarantee is DETECTED · PLACED · RECEIPTED, never prevented/blocked (voice-and-pitch.md)
  const printed = src.split('\n').filter((l) => /console\.log|label:|proves:|does_not_prove:/.test(l)).join('\n');
  assert.doesNotMatch(printed, /\b(prevents?|prevented|blocks?|blocked)\b(?! a denial)/i, 'never claim prevention in the printed surface');
  assert.match(printed, /Nothing here stops a denial/, 'the disclaimer is printed, not implied');
});
