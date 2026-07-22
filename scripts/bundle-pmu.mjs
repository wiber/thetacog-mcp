#!/usr/bin/env node
// packages/thetacog-mcp/scripts/bundle-pmu.mjs — package the on-commit EMAILER into the npm
// tarball. Follows the existing pmu-demo/pmu-report convention (copy the running code into the
// package) but does it by TRANSITIVE CLOSURE so the emailer's whole engine ships, not a
// hand-picked subset. Run from the repo before `npm publish` (or via prepack).
//
//   node packages/thetacog-mcp/scripts/bundle-pmu.mjs
//
// What it bundles, mirroring the repo layout under the package root so every module's
// resolve(HERE,'../..') still finds its data:
//   • the JS closure reachable from commit-triptych.mjs (import + dynamic import)
//   • the data files those modules read (snippet libraries, shortlex registry, reef, axis lib)
//   • the prebuilt Rust daemon if present (same-arch convenience; else `npx thetacog-pmu-rust` builds it)
// The CLI (server.js) prefers this bundled copy when the thetadrivencoach repo isn't the cwd.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // packages/thetacog-mcp
const REPO = resolve(PKG, '..', '..');                               // repo root
const SRC = join(REPO, 'scripts/pmu');
const DST = join(PKG, 'scripts/pmu');

// transitive JS closure from the emailer
function closure(entry) {
  const seen = new Set(); const data = new Set(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    let src = ''; try { src = readFileSync(join(SRC, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/from\s+["'](\.\/[\w.-]+\.mjs)["']/g)) stack.push(m[1].slice(2));
    for (const m of src.matchAll(/import\(\s*["'](\.\/[\w.-]+\.mjs)["']/g)) stack.push(m[1].slice(2));
    for (const m of src.matchAll(/(data\/pmu\/[\w./-]+\.json|docs\/architecture\/axis-library[\w.-]*\.json)/g)) data.add(m[1]);
  }
  return { mods: [...seen], data: [...data] };
}

// Bundle the on-commit emailer AND every CLI subcommand server.js dispatches into
// scripts/pmu/ (attest, prove-rice, hooper, price-attest, attest-demo, bootstrap,
// proof-monologue). These are spawned by PATH, not `import`'d, so the closure walker
// can't reach them transitively — list them as explicit entry points so the publish
// step is reproducible instead of relying on stale on-disk copies.
const ENTRIES = [
  'commit-triptych.mjs',
  // the PROMPT altitude — the lens receipt (σ + placement + reef-named coordinate) so npx ships the
  // on-prompt insurability signal, not just on-commit. The third of the three scale-invariant altitudes.
  'prompt-lens.mjs',
  // the PROJECT altitude — the whole-repo insurability rollup (npx thetacog-mcp portfolio). Reads the
  // user's OWN measure-history + lens-receipts (empty on a fresh install, fills as they commit/prompt).
  'project-portfolio.mjs',
  'spec-drift-check.mjs',   // README-as-spec advisory governor (npx thetacog-mcp spec-drift)
  'intervene.mjs',          // the out-of-lane INTERVENTION loop (npx thetacog-mcp intervene) — count · sensemake · measured verify
  'attest.mjs', 'prove-rice.mjs', 'hooper.mjs', 'price-attest.mjs',
  'attest-demo.mjs', 'prove.mjs', 'sense.mjs', 'bootstrap.mjs', 'proof-monologue.mjs',
  // attest-serve.mjs is spawned BY PATH (the detached localhost server) — not import'd, so the closure
  // walker can't reach it; list it explicitly so npx ships it (else the localhost serve falls to file://).
  'attest-serve.mjs',
  // attest-hypotheses.mjs — the CLI evasion/convergence suite (npx thetacog-mcp hypotheses), spawned by PATH.
  'attest-hypotheses.mjs',
  // attest-perturb.mjs — CC "clicks the buttons" from the terminal: appends branch-linked states to the
  // shared flight-tape JSON the served page polls (npx thetacog-mcp perturb). Imports attest-hypotheses.
  'attest-perturb.mjs',
  // attest-open.mjs — npx thetacog-mcp attest-open: serve + open the built pages (fast, no re-render).
  'attest-open.mjs',
  // THE WRITE-LOCK (Phase 1, 100% Cryptographic Attribution): tape-walk-worker is spawned BY PATH
  // (detached physics engine) from the write_tape_intent MCP tool — list it explicitly; its closure
  // pulls tape-intent.mjs (the ledger writer + binary gate) + attest-hypotheses.mjs (placement).
  'tape-walk-worker.mjs',
  // issue-receipt is spawned BY PATH (not import'd) and DRIVES the on-chip walk via
  // its cross-tree cache-witness dep — list it so its closure + cross-tree ship.
  'issue-receipt.mjs',
  // The money-flow rails — also spawned BY PATH (settle spawns premium+variance as
  // siblings), so list them explicitly or they never reach the tarball.
  'onchain-settle.mjs', 'calibration-premium.mjs', 'variance-option.mjs', 'onchain-anchor.mjs',
  // the seal over the priced ledger (npx ledger-attest) — tamper-evidence the premium reports.
  'ledger-attest.mjs',
  // The self-audit ledger (npx pmu-verify) + its by-PATH sub-verifier, so attest-demo can surface
  // the sealed evidence (4.48σ vs null · 0 false-mints · calibration · seal INTACT) LIVE in the install.
  'claims-check.mjs', 'prereg-seal.mjs',
];
const modSet = new Set(), dataSet = new Set();
for (const e of ENTRIES) { const c = closure(e); c.mods.forEach((m) => modSet.add(m)); c.data.forEach((d) => dataSet.add(d)); }
const mods = [...modSet], data = [...dataSet];
mkdirSync(DST, { recursive: true });
let nMod = 0, nData = 0, missing = [];
for (const m of mods) { const s = join(SRC, m); if (existsSync(s)) { copyFileSync(s, join(DST, m)); nMod++; } else missing.push('scripts/pmu/' + m); }
for (const d of data) {
  const s = join(REPO, d); const t = join(PKG, d);
  if (existsSync(s)) { mkdirSync(dirname(t), { recursive: true }); copyFileSync(s, t); nData++; } else missing.push(d);
}
// Self-audit ledger artifacts read DYNAMICALLY by claims-check (study dir, prereg + seal, trajectory).
// The closure walker only catches string-literal data/pmu/*.json, so copy these explicitly or
// `npx pmu-verify` cannot reproduce the sealed evidence offline (the strongest skeptic-disarming surface).
const LEDGER_DATA = [];
try {
  const sd = join(REPO, 'data/pmu/study');
  if (existsSync(sd)) { const f = readdirSync(sd).filter((x) => x.endsWith('.json')).sort().pop(); if (f) LEDGER_DATA.push('data/pmu/study/' + f); }
} catch { /* no study dir */ }
// data/pmu/measure-history.ndjson is the LEDGER calibration-premium.mjs and variance-option.mjs
// require (`const LEDGER = 'data/pmu/measure-history.ndjson'` in both). The closure-walker regex
// only matches `.json` string literals, never `.ndjson` — so this file silently never shipped in
// ANY published version, and `npx thetacog-mcp premium` / `variance` ENOENT'd for every stranger
// who ever ran them outside this exact checkout (found 2026-07-04, running a fresh `npx` install —
// the "run it yourself" claim in the two most recent blog posts was untested against a real
// install). Guarded by tests/pmu-simulator/npx-premium-fresh-cwd.test.js.
for (const r of ['docs/research/pmu-shape-detection-prereg.md', 'docs/research/pmu-shape-detection-prereg.seal.json', 'docs/research/pmu-shape-detection-ground-truth.json', '.thetacog/cache/reef-trajectory.ndjson', 'data/pmu/measure-history.ndjson']) {
  if (existsSync(join(REPO, r))) LEDGER_DATA.push(r);
}
for (const d of LEDGER_DATA) {
  const s = join(REPO, d); const t = join(PKG, d);
  try { mkdirSync(dirname(t), { recursive: true }); copyFileSync(s, t); nData++; } catch { missing.push(d); }
}
// The full book transcript — the "theory in the package" info-hazard: prove-rice's
// report embeds the load-bearing dossier inline and links the complete book so a
// stranger (human or LLM CLI) can verify our claims against the full derivation.
let book = 'absent';
for (const rel of ['books/tesseract/COMPLETE-BOOK.txt', 'docs/book/COMPLETE-BOOK.txt']) {
  const bs = join(REPO, rel);
  if (existsSync(bs)) { const bt = join(PKG, 'data/book/COMPLETE-BOOK.txt'); mkdirSync(dirname(bt), { recursive: true }); copyFileSync(bs, bt); book = `${(statSync(bt).size / 1e6).toFixed(1)}MB (${rel})`; break; }
}

// CROSS-TREE closure: some bundled scripts import modules OUTSIDE scripts/pmu via
// ../ paths — notably the cache witness that DRIVES the on-chip ballistic walk
// (../../src/lib/pmu/cache-witness.mjs) and its compress/signature deps. The ./
// walker above can't see these, so under npx the metal walk would throw
// "witness_cache absent". Follow every relative .mjs import (./ and ../), resolve
// repo-relative, copy preserving layout, recurse — so npx ships the whole walk.
function crossTree(startRepoRel) {
  const seen = new Set(); const stack = [...startRepoRel]; const copied = [];
  while (stack.length) {
    const rel = stack.pop(); if (seen.has(rel)) continue; seen.add(rel);
    let src = ''; try { src = readFileSync(join(REPO, rel), 'utf8'); } catch { missing.push(rel); continue; }
    const baseDir = dirname(rel);
    for (const m of src.matchAll(/(?:from|import\()\s*["'](\.\.?\/[\w./-]+\.mjs)["']/g)) {
      stack.push(join(baseDir, m[1]));   // node path.join normalizes the .. segments
    }
    // copy preserving repo-relative layout (idempotent for scripts/pmu deps reached
    // only cross-tree, e.g. pipeline-state.mjs that cache-witness needs).
    const t = join(PKG, rel); mkdirSync(dirname(t), { recursive: true });
    try { copyFileSync(join(REPO, rel), t); copied.push(rel); } catch { missing.push(rel); }
  }
  return copied;
}
const crossModules = crossTree(mods.map((m) => 'scripts/pmu/' + m));

// the latest on-host measurements → so issue-receipt's witness_cache carries the
// silicon tier_tuple (walk_ns, cache latencies) under npx too, not just in-repo.
let measures = 0;
try {
  const mdir = join(REPO, '.thetacog/pmu/measurements');
  const latest = readdirSync(mdir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, mt: statSync(join(mdir, f)).mtimeMs })).sort((a, b) => b.mt - a.mt).slice(0, 5);
  for (const { f } of latest) { const t = join(PKG, '.thetacog/pmu/measurements', f); mkdirSync(dirname(t), { recursive: true }); copyFileSync(join(mdir, f), t); measures++; }
} catch { /* no measurements — telemetry is optional, the walk landing is the proof */ }

// prebuilt daemon (same-arch convenience)
const daemonSrc = join(REPO, '.thetacog/pmu/target/release/pmu-onchip');
let daemon = 'absent (build with `npx thetacog-pmu-rust`)';
if (existsSync(daemonSrc)) {
  const t = join(PKG, '.thetacog/pmu/target/release/pmu-onchip');
  mkdirSync(dirname(t), { recursive: true }); copyFileSync(daemonSrc, t);
  // pmu-rust/ is the source `npx thetacog-pmu-rust` builds from on non-arm64 — keep its prebuilt current too.
  const t2 = join(PKG, 'pmu-rust/target/release/pmu-onchip');
  mkdirSync(dirname(t2), { recursive: true }); copyFileSync(daemonSrc, t2);
  // RE-SIGN THE COPY (2026-07-15 — the clean-room-smoke SIGKILL root cause): cargo emits a LINKER-SIGNED
  // adhoc signature bound to the original file; copyFileSync duplicates the bytes but the copy's adhoc
  // signature is invalid on arm64 macOS, so the OS SIGKILLs it on exec (exit 137, silent) → empty
  // walk_scores → the smoke fails and `npm publish` aborts in prepack. A fresh ad-hoc re-sign
  // (`codesign --force --sign -`) makes the copy runnable. No-op / harmless on non-macOS (codesign absent).
  for (const b of [t, t2]) {
    try { spawnSync('xattr', ['-c', b], { stdio: 'ignore' }); } catch { /* */ }
    try { const r = spawnSync('codesign', ['--force', '--sign', '-', b], { encoding: 'utf8' }); if (r.status !== 0 && process.platform === 'darwin') console.warn(`  ⚠ codesign re-sign failed for ${b}: ${(r.stderr || '').trim().slice(0, 120)}`); } catch { /* codesign absent (non-macOS) — fine */ }
  }
  daemon = `${(statSync(t).size / 1e6).toFixed(1)}MB (prebuilt, this arch, re-signed)`;
}

// ── RUST SOURCE REFRESH (else the bundled chip goes stale) ───────────────────
// The bundler copies the prebuilt daemon but historically NOT the Rust SOURCE, so
// pmu-rust/src drifted (shipped a Jun-12 chip with no --regions/--shortlex while the
// repo chip had them). `npx thetacog-pmu-rust` builds from THIS source on any arch
// without the prebuilt, so it MUST track the repo. Copy every .rs + Cargo.{toml,lock}.
const rustSrc = join(REPO, '.thetacog/pmu/src');
const rustDst = join(PKG, 'pmu-rust/src');
let nRust = 0;
if (existsSync(rustSrc)) {
  mkdirSync(rustDst, { recursive: true });
  for (const f of readdirSync(rustSrc).filter((x) => x.endsWith('.rs'))) { copyFileSync(join(rustSrc, f), join(rustDst, f)); nRust++; }
  for (const f of ['Cargo.toml', 'Cargo.lock']) { const s = join(REPO, '.thetacog/pmu', f); if (existsSync(s)) copyFileSync(s, join(PKG, 'pmu-rust', f)); }
}
writeFileSync(join(DST, 'BUNDLED.json'), JSON.stringify({ from: 'thetadrivencoach repo', entries: ENTRIES, modules: mods.sort(), cross_tree: crossModules.sort(), data, book, bundled_at_note: 'generated by bundle-pmu.mjs; do not edit by hand' }, null, 2));

console.log(`bundled the emailer + CLI subcommands into the package:`);
console.log(`  ${nMod} JS modules → packages/thetacog-mcp/scripts/pmu/`);
console.log(`  ${crossModules.length} cross-tree modules → packages/thetacog-mcp/src/ (walk driver + deps)`);
console.log(`  ${nData} data files → packages/thetacog-mcp/data,docs/`);
console.log(`  book:   ${book}`);
console.log(`  measurements: ${measures} (silicon tier_tuple telemetry)`);
console.log(`  daemon: ${daemon}`);
if (missing.length) { console.log(`  ⚠ missing (not bundled): ${missing.join(', ')}`); }
console.log(`  CLI: pmu-triptych prefers this bundled copy when the repo isn't the cwd.`);

// ── PRIVACY SCRUB (2026-07-20) ───────────────────────────────────────────────
// The closure walker bundles whatever data the modules read — which carried a private
// contact's name (harvested comms rules in lens-reef.json) and the operator's raw typed
// prompts (lens-c1-adjudication.json). The mirror's clean-assert caught it and ABORTED
// before push, as designed; this stage fixes it at the ROOT so the bundle is clean before
// the mirror ever sees it. The marker list lives in data/pmu/private-markers.txt (ONE
// source of truth, shared with scripts/mirror-to-public.sh; itself denylisted and never
// bundled — a scrubber whose own pattern ships is a leak wearing a fix). Every removal is
// COUNTED and logged (no silent caps). Markers file absent → scrub skipped, loudly.
const markersPath = join(REPO, 'data/pmu/private-markers.txt');
const PRIVATE_MARKERS = existsSync(markersPath)
  ? new RegExp(readFileSync(markersPath, 'utf8').trim().split('\n').filter(Boolean).join('|'), 'i')
  : null;
if (!PRIVATE_MARKERS) console.log('  ⚠ privacy: data/pmu/private-markers.txt absent — scrub SKIPPED (mirror clean-assert is the backstop)');
if (PRIVATE_MARKERS) {
  // 1) the operator's raw prompts never publish — drop the adjudication tape wholesale
  const { rmSync } = await import('node:fs');
  for (const rel of ['data/pmu/lens-c1-adjudication.json', 'data/pmu/private-markers.txt']) {
    const p = join(PKG, rel);
    if (existsSync(p)) { rmSync(p); console.log(`  privacy: dropped ${rel} (never publishes)`); }
  }
  // 2) deep-scrub every bundled JSON: array items matching a marker are DROPPED,
  //    dict string values matching are REDACTED — counted per file
  const scrub = (o, stat) => {
    if (Array.isArray(o)) {
      const kept = [];
      for (const v of o) {
        if (typeof v === 'string' && PRIVATE_MARKERS.test(v)) { stat.dropped++; continue; }
        kept.push(scrub(v, stat));
      }
      return kept;
    }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string' && PRIVATE_MARKERS.test(v)) { o[k] = '[redacted: private marker]'; stat.redacted++; }
        else o[k] = scrub(v, stat);
      }
      return o;
    }
    return o;
  };
  const walkJson = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walkJson(p); continue; }
      if (!e.name.endsWith('.json')) continue;
      let parsed; try { parsed = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      const stat = { dropped: 0, redacted: 0 };
      const clean = scrub(parsed, stat);
      if (stat.dropped || stat.redacted) {
        writeFileSync(p, JSON.stringify(clean, null, 1));
        console.log(`  privacy: ${p.slice(PKG.length + 1)} — dropped ${stat.dropped} entries, redacted ${stat.redacted} values`);
      }
    }
  };
  const dataDir = join(PKG, 'data');
  if (existsSync(dataDir)) walkJson(dataDir);
}

// ── CLEAN-ROOM GATE (Maxim: "the bearer asset is the only truth") ────────────
// Run the JUST-BUNDLED prove-rice from a throwaway /tmp dir with ZERO repo access.
// If the isolated package can't build the reef and run a real on-chip ballistic
// walk, the build FAILS here — never publish an artifact that only works in-repo.
// Skipped with --no-smoke (e.g. CI without the daemon for this arch).
if (!process.argv.includes('--no-smoke')) {
  const sandbox = join(tmpdir(), 'thetacog-bundle-smoke');
  mkdirSync(sandbox, { recursive: true });
  console.log('\n  clean-room smoke: running the bundled package from /tmp (no repo access)…');
  const r = spawnSync(process.execPath, [join(DST, 'prove-rice.mjs'), '--smoke'], { cwd: sandbox, encoding: 'utf8', timeout: 60000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').filter(Boolean).pop() || '(no output)';
  if (r.status === 0) {
    console.log(`  ✅ ${out}`);
  } else {
    console.error(`  ❌ CLEAN-ROOM SMOKE FAILED — the isolated package cannot run the on-chip walk.`);
    console.error(`     ${out}`);
    console.error(`     The artifact is not publishable. Fix the bundle (likely a missing cross-tree module or the daemon), then re-run.`);
    process.exit(1);
  }
}
