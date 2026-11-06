// packages/thetacog-mcp/tests/benchmark-product-surface.test.mjs — THE PRODUCT-IDENTITY GUARD
// (goal 2026-08-14: "make it obvious that this is the functioning forked benchmark product —
// the repo is it — include the tesseract and all the panels from production.")
// Invariants:
//   1. README declares the product identity at the top (fork -> run -> publish receipts ->
//      register), names the tesseract as shipped, and points at tape/ + REGISTRY.md.
//   2. The tape exists: MANIFEST.md + series.ndjson + >=1000 sha-named panels (fork #0).
//   3. register-surface is wired: script present, dispatched in server.js, listed in bundle.
//   4. REGISTRY.md is seeded with row 0 (the vendor dogfooding first) and states the
//      self-reported -> stranger-verified promotion rule.
//   5. tape/ does NOT ship in the npm tarball (repo surface, not package bloat) but
//      REGISTRY.md DOES.
// Run: node tests/benchmark-product-surface.test.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const assert = (ok, msg) => { if (ok) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); failures++; } };
const read = (p) => readFileSync(resolve(PKG, p), 'utf8');

const readme = read('README.md');
assert(/THIS REPO IS THE PRODUCT/i.test(readme), 'README carries the product-identity banner');
assert(readme.indexOf('THIS REPO IS THE PRODUCT') < 3000, 'banner sits at the TOP (first 3000 chars)');
for (const marker of ['tape/MANIFEST.md', 'REGISTRY.md', 'register-surface', 'tesseract', 'UNMEASURED', 'technology guarantor']) {
  assert(readme.includes(marker), `README banner names: ${marker}`);
}

assert(existsSync(resolve(PKG, 'tape/MANIFEST.md')), 'tape/MANIFEST.md exists');
assert(existsSync(resolve(PKG, 'tape/series.ndjson')), 'tape/series.ndjson exists');
const panels = existsSync(resolve(PKG, 'tape/panels')) ? readdirSync(resolve(PKG, 'tape/panels')).filter((f) => /^[0-9a-f]{7,40}.*\.png$/.test(f)) : [];
assert(panels.length >= 1000, `tape/panels holds the production tape (${panels.length} sha-named panels, >=1000)`);

assert(existsSync(resolve(PKG, 'scripts/pmu/register-surface.mjs')), 'register-surface.mjs present in package scripts');
assert(read('server.js').includes("['register-surface', 'scripts/pmu/register-surface.mjs']"), 'register-surface dispatched in server.js');
assert(read('scripts/bundle-pmu.mjs').includes("'register-surface.mjs'"), 'register-surface in the bundle mods list');

for (const cmd of ['verify-baseline', 'init-fork', 'simulate-payout', 'my-pixel', 'map-crawl', 'verify-peer', 'big-map-axes']) {
  assert(existsSync(resolve(PKG, 'scripts/pmu/' + cmd + '.mjs')), cmd + '.mjs present');
  assert(read('server.js').includes("'scripts/pmu/" + cmd + ".mjs'"), cmd + ' dispatched');
  assert(read('scripts/bundle-pmu.mjs').includes("'" + cmd + ".mjs'"), cmd + ' in bundle');
}
assert(read('scripts/pmu/init-fork.mjs').includes('thetadrivencoach'), 'init-fork refuses the production monorepo too');

const hw = read('scripts/attest-homework.sh');
assert(/Authorize the 9-step chain/.test(hw), 'homework carries the AUTHORIZATION GATE (consent before the chain)');
assert(/--yes/.test(hw) && /Non-interactive/.test(hw), 'homework consent: --yes for non-interactive, never silent');
assert(/stag hunt/i.test(readme) && /Two ways to read this repo/.test(readme), 'README carries the dual framing (stag hunt + deep read)');
assert(/asks for your authorization/.test(readme), 'README states the homework asks authorization first');

// hardening: the aperture floor + the null instrumentation (Marsh items, 2026-08-14)
assert(/LIT-MASS FLOOR/.test(read('scripts/pmu/triptych-render.mjs')) && /refused: true/.test(read('scripts/pmu/triptych-render.mjs')), 'decode carries the lit-mass floor (S2: thin input REFUSED, never ok)');
assert(/impostorNull/.test(read('scripts/pmu/triptych-build.mjs')) && /degenerate: sd === 0/.test(read('scripts/pmu/triptych-build.mjs')), 'the impostor null reports itself (exhausted count + sd-degenerate flag)');
assert(/UNMEASURED/.test(read('scripts/pmu/simulate-payout.mjs')) && /lorem/.test(read('scripts/pmu/simulate-payout.mjs')), 'the sim shows the refusal row beside the miss');

const registry = read('REGISTRY.md');
assert(/\| 0 \|/.test(registry), 'REGISTRY.md seeded with row 0 (vendor dogfoods first)');
assert(/self-reported/.test(registry) && /stranger-verified/.test(registry), 'REGISTRY states the promotion rule');

// THE BIG MAP: the POV axes registry exists with the full 12^3 side, says what it is in-file,
// and the meta-map panel is SIZE-VERIFIED dense (>=15KB — a near-empty encircled render is a
// calm commit but a nonsense billboard; the sync's densest-of-newest policy must hold).
const axes = JSON.parse(read('axes/axes-1728.json'));
assert(axes.nodes.length === 1728 && axes.side === 1728 && axes.cells === 2985984, 'axes-1728: full 12^3 side (' + axes.nodes.length + ' nodes, ' + axes.cells + ' cells declared)');
assert(/THE BIG MAP/.test(axes._this_is) && /POV/.test(axes._this_is), 'axes registry SAYS it is the big map, as a POV — clear in the artifact itself');
assert(Array.isArray(axes._pov_watchlist), 'POV watchlist present (no canonical copy — consensus by overlap)');
assert(/self-improving competence map/.test(axes._becomes), 'the reality-version framing is in the artifact');
const mmSize = statSync(resolve(PKG, 'tape/meta-map.png')).size;
assert(mmSize >= 15000, 'meta-map.png is dense (' + mmSize + ' bytes >= 15000) — size verified, not eyeballed');

const files = JSON.parse(read('package.json')).files || [];
assert(!files.some((f) => String(f).startsWith('tape')), 'tape/ excluded from the npm tarball');
assert(files.includes('REGISTRY.md'), 'REGISTRY.md ships in the tarball');

if (failures) { console.error(`\nbenchmark-product-surface: ${failures} FAILURE(S)`); process.exit(1); }
console.log('\nbenchmark-product-surface: ALL INVARIANTS HOLD');
