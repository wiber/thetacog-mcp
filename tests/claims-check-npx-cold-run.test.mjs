// packages/thetacog-mcp/tests/claims-check-npx-cold-run.test.mjs — THE ADAM-DEMO GUARD
//
// Incident (2026-07-13, live Adam/Marsh redpill call prep): `npx -y thetacog-mcp@latest attest-demo`,
// run exactly as instructed (a brand-new EMPTY, non-git folder — the redpill-progression doc's own
// "20 minutes, one empty folder" step), crashed inside "THE SELF-AUDIT LEDGER — pmu-verify" with a raw
// TypeError [ERR_INVALID_ARG_TYPE] stack trace — right in the middle of the trust-building "we became
// the skeptic; here is the receipt" section. Root cause: package.json's `files` whitelist shipped only
// `data/pmu/study/.gitkeep`, not the real study JSON — so claims-check.mjs's latestStudy() found an
// empty dir and `resolve(dir, undefined)` threw. WORSE: attest-demo.mjs's self-audit block treated any
// non-empty (stdout+stderr) as a valid ledger and printed the raw crash trace as if it were content.
//
// This test packs the REAL npm artifact (respecting package.json's `files`) and runs claims-check.mjs
// from a fresh non-git tmp dir — Adam's exact scenario — asserting it never leaks an unhandled stack
// trace, and separately guards the attest-demo.mjs cascading-symptom bug by source inspection.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG, '..', '..');   // packages/thetacog-mcp/scripts/pmu is a gitignored,
// prepack-regenerated MIRROR of REPO_ROOT/scripts/pmu (see scripts/bundle-pmu.mjs) — the real,
// git-tracked source lives at the repo root; source-inspection guards must read that copy, not
// the mirror (which npm pack silently regenerates from the root source as a side effect below).

test('package.json bundles the REAL study data, not just the placeholder', () => {
  const pkg = JSON.parse(readFileSync(resolve(PKG, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('data/pmu/study/'), 'files[] must ship data/pmu/study/ (real *.json), not the bare .gitkeep — else claims-check.mjs finds an empty dir when run via npx outside this repo');
  assert.ok(!pkg.files.includes('data/pmu/study/.gitkeep'), 'the placeholder-only entry must be gone, not merely supplemented');
});

test('claims-check.mjs runs clean from a fresh non-git dir using the ACTUAL packed npm artifact (Adam\'s exact scenario)', () => {
  const work = mkdtempSync(join(tmpdir(), 'thetacog-npx-cold-'));
  const packDir = join(work, 'pack');
  const runDir = join(work, 'empty-run-folder');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  try {
    const tgzName = execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: PKG, encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['xf', join(packDir, tgzName), '-C', packDir], { encoding: 'utf8' });
    const claimsCheck = join(packDir, 'package', 'scripts', 'pmu', 'claims-check.mjs');
    assert.ok(existsSync(claimsCheck), 'packed artifact must contain scripts/pmu/claims-check.mjs');

    const result = execFileSync(process.execPath, [claimsCheck], { cwd: runDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] , env: { ...process.env } })
      // execFileSync throws on nonzero exit, but claims-check.mjs can legitimately exit 1 (a claim
      // regressed) without crashing — only an unhandled exception is the bug this guards against.
      ;
    void result;
  } catch (e) {
    const combined = String((e.stdout || '') + (e.stderr || ''));
    assert.ok(!/TypeError|ERR_INVALID_ARG_TYPE|at resolve \(node:path/.test(combined),
      `claims-check.mjs must never leak a raw Node.js stack trace when run from an empty non-git folder — got:\n${combined.slice(0, 1200)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('attest-demo.mjs never renders a crashed self-audit subprocess as valid ledger content', () => {
  // read the REAL git-tracked source at the repo root, not the gitignored packages/thetacog-mcp
  // mirror that prepack silently regenerates from it (see PKG/REPO_ROOT note above).
  const src = readFileSync(resolve(REPO_ROOT, 'scripts/pmu/claims-check.mjs'), 'utf8');
  assert.match(src, /throw new Error\(`NO_STUDY_DATA/, 'latestStudy() must fail with a named, clean error instead of an opaque resolve(dir, undefined) TypeError');

  const demoSrc = readFileSync(resolve(REPO_ROOT, 'scripts/pmu/attest-demo.mjs'), 'utf8');
  assert.match(demoSrc, /cc\.status === 0 \? \(\(\(cc\.stdout/, 'the self-audit block must gate on the subprocess exit status before treating its stdout+stderr as a valid ledger — a nonzero exit means stderr is a crash trace, not content');
});
