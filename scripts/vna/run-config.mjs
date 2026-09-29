// scripts/vna/run-config.mjs — THE ROBOT ACCOUNTING: what configuration was actually in effect.
//
// Operator, 2026-09-08: "an exhaustive set of config mechanics to make sure it always runs the right
// way, because we run in different ways from different locations. It always has to work. It's quite
// complex so we have to make sure we don't go through this stuff, because it's gonna be brittle and
// break easily. We don't have a robot accounting exactly what is being adjusted, which files, what's
// the aperture, where are we looking for the intent, where are we looking for the reality."
//
// THE HAZARD IS REAL AND IT IS MEASURED, not anticipated. EIGHT environment variables reach the
// render path and every one of them can change what comes out without appearing anywhere in the
// output:
//   COVERAGE_ENCIRCLE  — swaps the region clusterer ENTIRELY (coverage-driven vs connectivity)
//   COVERAGE_CORE / _DFRAC / _DABS / _MAX — that clusterer's four thresholds
//   PMU_SHORTLEX_ZONES — changes what renderTriptych draws
//   PMU_REGIONS_CHIP   — changes the region detector's engine
//   PMU_PRIMARY_LENS   — changes the pipeline's arbitrating lens
//   CLAUDBRIDGE_URL    — changes where the pipeline reaches
//   PMU_ONCHIP         — changes WHICH BINARY is called the chip
// A shell that exports one of these renders a structurally different panel than a shell that does
// not, on the same commit, and both call themselves the receipt. That is the whole failure mode of
// "it works from here but not from there", and it is invisible by construction: an env var leaves no
// trace in the artifact it changed.
//
// THE DESIGN THAT MAKES THIS NON-BRITTLE, and it is the only part worth arguing about. The knob list
// is NOT hand-typed here. It is DISCOVERED by scanning the render path's own source for
// `process.env.X`, so a knob added anywhere in that graph appears in the manifest the moment it
// exists. A hand-typed list would be correct on the day it was written and quietly wrong forever
// after — which is the same class as the allowlist that must only shrink, and the same class as
// every stale checklist line this project has paid for.
//
// WHAT THIS IS SUFFICIENT FOR: answering "was this run configured the same way as that run" by
// comparing one hash, and "what exactly differed" by comparing two manifests.
// WHAT IT IS NOT SUFFICIENT FOR: whether the configuration was the RIGHT one. A hash says two runs
// agree; it cannot say they agree on something correct. That judgement stays with the operator.
//
// @guard tests/vna/config-is-accounted.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere

// The render path, named as PATHS rather than as a set of variable names. Scanning these files is
// what makes the knob list self-maintaining; adding a file here is the only manual step, and a file
// that joins the render path without joining this list is exactly what the guard's second subtest
// exists to catch.
export const RENDER_PATH = [
  'scripts/vna/cockpit.mjs',
  'scripts/vna/aperture.mjs',
  'scripts/vna/self-lane-panel.mjs',
  'scripts/pmu/panel-door.mjs',
  'scripts/pmu/tolerance-panel.mjs',
  'scripts/pmu/triptych-render.mjs',
  'scripts/pmu/triptych-build.mjs',
  'scripts/pmu/regions-chip.mjs',
  'scripts/pmu/annotate-regions.mjs',
  'scripts/pmu/pipeline.mjs',
  'scripts/pmu/corpus-ingest.mjs',
];

/** Every `process.env.X` the render path reads, discovered rather than declared. */
export function discoverKnobs(repo = REPO) {
  const found = new Set();
  for (const rel of RENDER_PATH) {
    const p = resolve(repo, rel);
    if (!existsSync(p)) continue;
    // COMMENTS STRIPPED FIRST. A `process.env.X` written inside an explanation is documentation,
    // not a knob — this file's own header names several in prose and would otherwise discover
    // itself. Same construct-not-token discipline the C18 guard uses.
    const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
    for (const m of src.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) found.add(m[1]);
  }
  // NODE_ENV and friends are set by every runner and say nothing about this instrument; naming them
  // would make every manifest differ for a reason nobody cares about.
  for (const noise of ['NODE_ENV', 'CI', 'HOME', 'PATH', 'TMPDIR']) found.delete(noise);
  return [...found].sort();
}

/**
 * The full effective configuration of one run.
 * `numeric` carries the constants that are NOT environment-settable but DO decide the reading —
 * they are read from their one home rather than restated, so a change there moves the hash.
 */
export function runConfig({ repo = REPO, argv = [], extra = {} } = {}) {
  const knobs = {};
  for (const k of discoverKnobs(repo)) knobs[k] = process.env[k] ?? null;

  // Read the constants from where they live. A restated constant is a second home (C18), and a
  // manifest that restates them would report the value it believes rather than the one in force.
  const num = {};
  try {
    const ap = readFileSync(resolve(repo, 'scripts/vna/aperture.mjs'), 'utf8');
    num.MIN_GZIP_BYTES = Number(/MIN_GZIP_BYTES = (\d+)/.exec(ap)?.[1] ?? null);
    num.apertureTolerance = Number(/tolerance = ([\d.]+)/.exec(ap)?.[1] ?? null);
  } catch { /* reported as null below */ }
  try {
    const tr = readFileSync(resolve(repo, 'scripts/pmu/triptych-render.mjs'), 'utf8');
    num.LIT_MASS_FLOOR = Number(/export const LIT_MASS_FLOOR = (\d+)/.exec(tr)?.[1] ?? null);
  } catch { /* null */ }
  try {
    const ck = readFileSync(resolve(repo, 'scripts/vna/cockpit.mjs'), 'utf8');
    // THE UNDECLARED CAP. `files.slice(0, N)` silently drops every changed file past N from the
    // reality corpus. It was a bare literal with no name and no mention in any output, so a 40-file
    // commit was being judged on its first 20 and the receipt said nothing.
    num.maxRealityFiles = Number(/files\.slice\(0, (\d+)\)/.exec(ck)?.[1] ?? null);
  } catch { /* null */ }

  const cfg = {
    repo,
    argv: argv.filter((a) => !a.startsWith('/')),   // paths differ per machine and are not configuration
    knobs,
    numeric: num,
    ...extra,
  };
  // The hash EXCLUDES repo, because the same configuration run from two clones is the same
  // configuration — that is the entire question being asked ("does it run the right way from a
  // different location"). Including the path would make every location differ trivially and the
  // hash would answer nothing.
  const { repo: _drop, ...hashable } = cfg;
  cfg.hash = createHash('sha256').update(JSON.stringify(hashable)).digest('hex').slice(0, 16);
  return cfg;
}

/** One human-readable block. Printed on every run, because a manifest nobody sees is not accounting. */
export function configText(cfg) {
  const set = Object.entries(cfg.knobs).filter(([, v]) => v != null);
  const lines = [`  config   hash ${cfg.hash} · ${set.length} of ${Object.keys(cfg.knobs).length} knobs SET`];
  for (const [k, v] of set) lines.push(`    ! ${k}=${v}   (a set knob changes the render; an unset one is the default)`);
  lines.push(`    numeric  ${Object.entries(cfg.numeric).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  return lines.join('\n');
}
