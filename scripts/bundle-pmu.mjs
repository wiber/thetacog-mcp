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
  // the per-PROMPT encircled PNG the lens spawns DETACHED (spawned by path, so the closure walker
  // can't reach it — list explicitly or the packaged lens silently skips the panel render).
  'lens-encircled-png.mjs',
  // THE AI GREEKS (operator 2026-08-13: "the npx install does not have it with the greeks"). The
  // priced-instrument emitter — Δ delta · Δ-spread · Γ gamma · 𝒱 vega · Θ theta — is spawned BY PATH
  // from hooks/post-commit, so the ./ walker could never reach it and the WHOLE greeks surface was
  // absent from every published tarball while the package README documented vega in two places. Listing
  // it here pulls src/lib/pmu/greeks.mjs + signal-schema.mjs through crossTree automatically.
  'lens-signal-emit.mjs',
  // …and its Γ source, which lens-signal-emit reaches by execFileSync (not import), so it is invisible
  // to both walkers. Without this line gamma is permanently null-with-reason on every install.
  'lens-traction-monitor.mjs',
  // the PROJECT altitude — the whole-repo insurability rollup (npx thetacog-mcp portfolio). Reads the
  // user's OWN measure-history + lens-receipts (empty on a fresh install, fills as they commit/prompt).
  'project-portfolio.mjs',
  'spec-drift-check.mjs',   // README-as-spec advisory governor (npx thetacog-mcp spec-drift)
  'intervene.mjs',          // the out-of-lane INTERVENTION loop (npx thetacog-mcp intervene) — count · sensemake · measured verify
  // verify-row.mjs — B13 THE VERIFIER (npx thetacog-mcp verify <row.json>), spawned BY PATH from
  // server.js's [cmd, rel] loop, so the closure walker can't reach it — list it explicitly or a
  // real standalone install ships every other clearing tool except the one a claims engine runs.
  'verify-row.mjs',
  // attest-bundle.mjs — B19 THE ATTESTATION BUNDLE producer (npx thetacog-mcp attest-bundle
  // <ref>), spawned BY PATH from server.js. Its cross-tree imports (walk-door.mjs, room-key.mjs,
  // lane-paths.mjs, mesh-keys.mjs) ship via crossTree() below because it is listed here — a
  // stranger with only the package cannot MINT a new bundle (no repo, no mesh identity). Since
  // ONE-DOOR (tests/pmu-simulator/walk-door.test.mjs) verify-row.mjs also cross-tree-pulls
  // walk-door.mjs (it now calls lensWalk instead of spawning `--lens` a second time), so the
  // same closure ships for both — a stranger's `verify` still needs no mesh identity because it
  // only reads lensWalk's `result.pixel`, never mints or signs a row.
  'attest-bundle.mjs',
  'attest.mjs', 'prove-rice.mjs', 'hooper.mjs', 'price-attest.mjs',
  // attest-countersign.mjs — THE CLOSING LINK of the bilateral loop (deployer + insurer sign the
  // same verdict; the insurer names whose oracle they honour). Spawned BY PATH from the ask doc's
  // walkthrough, so the closure walker can't reach it — list it explicitly or ATTESTATION-ASK.md
  // ships instructions for a file that isn't in the tarball.
  'attest-countersign.mjs',
  'attest-demo.mjs', 'prove.mjs', 'sense.mjs', 'bootstrap.mjs', 'proof-monologue.mjs',
  // attest-serve.mjs is spawned BY PATH (the detached localhost server) — not import'd, so the closure
  // walker can't reach it; list it explicitly so npx ships it (else the localhost serve falls to file://).
  'attest-serve.mjs',
  // power.mjs — the power-adapter mandate (AC re-arms the TTL, caffeinate -s pins the machine).
  // Imported by attest-serve.mjs, which the closure walker can't reach (spawned by path), so
  // list it explicitly or the published serve crashes on a missing module.
  'power.mjs',
  // attest-hypotheses.mjs — the CLI evasion/convergence suite (npx thetacog-mcp hypotheses), spawned by PATH.
  'attest-hypotheses.mjs',
  // ur-attest.mjs — the utilization-review preset (npx thetacog-mcp ur-attest), spawned BY PATH from
  // server.js; imports attest-hypotheses (placement) + receipt-crypto (seal). List it or npx ships nothing.
  'ur-attest.mjs',
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
  // APERTURE PHYSICS — the streaming adaptive-aperture picker (META-BULK). Nothing in the package
  // import's it (grip-validate.mjs, its only caller, is repo-internal), so the closure walker cannot
  // reach it; without this line the tarball ships the CHANGELOG's aperture claim and not the code.
  // It has its own CLI main block, so a stranger can run it directly out of node_modules.
  'grip-navigator.mjs',
  // ── THE DISPATCH-TABLE BACKLOG (2026-08-13) ────────────────────────────────────────────────────
  // Everything below is named by server.js's `for (const [cmd, rel] of [...])` table — i.e. the
  // package publicly answers to `npx thetacog-mcp <cmd>` for each — but was never listed here, so
  // each one ENOENT'd on a stranger's machine. Not a regression: the dispatch table grew one
  // feature commit at a time (Jun–Jul 2026) and THIS list never followed. Two lists, one promise,
  // no gate between them. `scripts/pmu/package-surface-spec.mjs` now derives the spec from the
  // dispatch table and fails when they diverge, so the backlog cannot silently re-accumulate.
  'lens-run.mjs', 'lens-tester-open.mjs',      // the causal-coherence QC lens (npx lens-run · lens-tester)
  'publish-commit.mjs',                        // npx publish-commit — the per-commit page publisher
  'confidence-overlay.mjs',                    // npx confidence — the competence-coordinate overlay
  'underwriter-grade.mjs',                     // npx underwriter-grade — the carrier-facing grade
  'lens-e0.mjs',                               // npx e0 — the E0 baseline lens
  'reef-miner.mjs',                            // npx miner — reef rule mining
  'harvest-agent.mjs', 'harvest-accept.mjs',   // npx harvest (+ its by-PATH accept leg)
  'lens-convergence-sweep.mjs',                // npx sweep — the convergence sweep
  'reef-loop-story.mjs',                       // npx loop-story
  'register-surface.mjs',                      // npx register-surface — the registry button
  'verify-baseline.mjs',                       // npx verify-baseline — check when you should have checked
  'init-fork.mjs',
  'simulate-payout.mjs',                       // npx simulate-payout — the settlement engine benchmark
  'my-pixel.mjs',                              // npx my-pixel — the dignity pixel (routing key)
  'map-crawl.mjs',                             // npx map-crawl — THE BIG MAP as a view [network]
  'verify-peer.mjs',                           // npx verify-peer — forks map each other by recomputation
  'big-map-axes.mjs',                          // npx big-map-axes — THE BIG MAP's side, as this surface's POV                             // npx init-fork — deployer swaps fork #0 tape for theirs
  'lane-index.mjs',                            // npx index — YOUR index of the surfaces in your lane (the entry point's step 3)
  'tesseract-progress.mjs',                    // by-PATH from harvest-agent — invisible to both walkers
  // vega-backtest.mjs / advisory-premium.mjs / trigger-battery.mjs — 2026-09-17: /benchmark and
  // /playbook (public/hardening/*.html) instruct a stranger to run all three, but the dispatch
  // entries + these ENTRIES lines were wired only on the abandoned `ghost-read-matrix` branch
  // (never merged to main), so an npx install ENOENTs — or worse, an unrecognized argv[2] fell
  // through to starting the MCP server. Listed here now that server.js dispatches all three.
  'vega-backtest.mjs', 'advisory-premium.mjs', 'trigger-battery.mjs',
  // walk.mjs — C92d THE ONE-MINUTE DOOR (npx thetacog-mcp walk): the buyer's HEAD through the one walk door, the three-word
  // reading over their declared rows. Spawned BY PATH from server.js; its cross-tree import src/lib/pmu/declared-reading.mjs
  // (the shipped pure reading) rides via crossTree because it is listed here.
  'walk.mjs',
  // replay.mjs — C99d THE REPLAY IS A DOOR, NOT A DEFENCE (npx thetacog-mcp replay --since <ref>): every commit in a range
  // through walk.mjs's walkRepo against the rows at that commit's height. Spawned BY PATH from server.js; imports ./walk.mjs.
  'replay.mjs',
  // verify-url.mjs — C97c `npx thetacog-mcp verify <url>`: the auditor's recompute of a served CAR bundle on foreign metal. Spawned BY
  // PATH from server.js; its cross-tree imports (src/lib/vna/row-canonical.mjs, src/lib/notary/mmr.mjs + gateway.mjs) ride via crossTree.
  'verify-url.mjs',
];
// Entry points OUTSIDE scripts/pmu. `closure()` reads relative to SRC (scripts/pmu), so a repo-relative
// entry can only enter through crossTree. `npx thetacog-mcp mesh-up` is dispatched by server.js and has
// never shipped — same two-list drift as the block above, one directory over.
// C94b — THE VNA DOORS (2026-09-19): the sidebar's sensors, one directory over. server.js dispatches each as
// `npx thetacog-mcp <door>` (its VNA_DOORS table names the same pairs; tests/vna/c94-foreign-repo-bootstrap.test.mjs
// diffs them), so in a stranger's repo the extension never spawns a scripts/vna/ path that exists only here. They
// enter through crossTree — steer-ui.mjs alone pulls ~85 modules across scripts/vna, scripts/pmu, scripts/cog,
// scripts/mesh and src/lib — and land under the package at their repo-relative paths (packages/thetacog-mcp/scripts/vna
// is gitignored like scripts/pmu; regenerated here at prepack). door-cmd.mjs is the page's own command rewrite.
const VNA_DOOR_SCRIPTS = [
  'scripts/vna/steer-ui.mjs', 'scripts/vna/cockpit.mjs', 'scripts/vna/aperture-receipt.mjs', 'scripts/vna/recompute-receipt.mjs', 'scripts/vna/story.mjs',
  'scripts/vna/alignment-map.mjs', 'scripts/vna/competence-pixel.mjs', 'scripts/vna/parametric-trigger.mjs',
  'scripts/vna/envelope.mjs', 'scripts/vna/mesh.mjs', 'scripts/vna/spec-tree.mjs',
  'scripts/vna/goal.mjs', 'scripts/vna/runner-reading.mjs', 'scripts/vna/straight-path.mjs',
  'scripts/vna/clip-ingest.mjs', 'scripts/vna/clip-watch.mjs', 'scripts/vna/underwriter-line.mjs',
  'scripts/vna/auth-flow.mjs',
  'scripts/vna/door-cmd.mjs',
  // C297 — the 💬 Steer Chat's own doors (steer-runner.mjs is spawned by steer.mjs by path, never imported, so it is a root too)
  'scripts/vna/steer.mjs', 'scripts/vna/workers.mjs', 'scripts/vna/keep-running.mjs', 'scripts/vna/chat-context.mjs',
  'scripts/vna/chat-model-verb.mjs', 'scripts/vna/steer-runner.mjs', 'scripts/vna/runner-resolver.mjs', 'scripts/vna/local-models.mjs',
  // C309d — the buyer's twelve-state monologue
  'scripts/vna/buyer-monologue.mjs',
];
const EXTRA_CROSS_ROOTS = ['scripts/mesh/mesh-up.mjs', ...VNA_DOOR_SCRIPTS];
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
// C94b.5 (2026-09-20): steer-ui → onboarding-steps.mjs reads ONBOARDING-STEPS.md by path — not a .json literal, so the walker never
// shipped it and a stranger's sidebar ENOENT'd on the first render. Copied explicitly, like the ledger below.
// C196 ext-A (2026-09-23): scripts/vna/chat-bridge.mjs (C167's chat pill) loads packages/thetacog-mcp-vscode/media/chat-core.js
// through createRequire(resolve(MEDIA, 'chat-core.js')) — a dynamic require, not a `from '...'`/`import('...')` literal ending in
// .mjs, so BOTH the closure walker and crossTree() are structurally blind to it; chat-core.js is also not JSON, so the earlier
// data-literal regex misses it too. It never shipped, and a stranger's `npx thetacog-mcp steer-ui` threw ENOENT on chat-bridge's
// require (seen red: tests/vna/c94-foreign-repo-bootstrap.test.mjs C94b.5, "Cannot find module '.../packages/thetacog-mcp-vscode/media/chat-core.js'").
// chat-bridge.mjs resolves MEDIA as resolve(REPO,'packages/thetacog-mcp-vscode/media') where REPO is two dirs up from ITS OWN file —
// inside the bundle that's PKG itself, so the copy destination below (PKG/packages/thetacog-mcp-vscode/media/chat-core.js) is where
// the bundled chat-bridge.mjs actually looks.
for (const r of ['docs/specs/vna/ONBOARDING-STEPS.md', 'docs/research/pmu-shape-detection-prereg.md', 'docs/research/pmu-shape-detection-prereg.seal.json', 'docs/research/pmu-shape-detection-ground-truth.json', '.thetacog/cache/reef-trajectory.ndjson', 'data/pmu/measure-history.ndjson', 'packages/thetacog-mcp-vscode/media/chat-core.js']) {
  if (existsSync(join(REPO, r))) LEDGER_DATA.push(r);
}
for (const d of LEDGER_DATA) {
  const s = join(REPO, d); const t = join(PKG, d);
  try { mkdirSync(dirname(t), { recursive: true }); copyFileSync(s, t); nData++; } catch { missing.push(d); }
}
// chat-core.js is a UMD module (`typeof module === 'object' && module.exports ? … : root.ChatCore = …`) — it needs Node's CJS
// loader. PKG's own package.json declares "type": "module" (packages/thetacog-mcp/package.json), and Node resolves a bare .js
// file's module system by walking UP for the NEAREST package.json — the copied media/ dir carries none of its own, so it
// inherited "module" from PKG, `module` read as undefined in that scope, and the UMD fell to `root.ChatCore = …` with `root`
// itself undefined (top-level `this` in ESM) → "Cannot set properties of undefined (setting 'ChatCore')" (seen red, C196 ext-A).
// The source tree never hit this because packages/thetacog-mcp-vscode/package.json (no "type" field ⇒ commonjs default) is the
// nearest package.json there. A one-line package.json beside the copy pins the same default inside the bundle.
if (existsSync(join(PKG, 'packages/thetacog-mcp-vscode/media/chat-core.js'))) {
  writeFileSync(join(PKG, 'packages/thetacog-mcp-vscode/media/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
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
const crossModules = crossTree([...mods.map((m) => 'scripts/pmu/' + m), ...EXTRA_CROSS_ROOTS]);

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
//
// Task 28 (closed 2026-09-17): copying src/*.rs alone gives SOURCE identity but not
// COMPILE identity. build.rs compiles vendor/zlib — the vendored Node/Chromium zlib
// fork lens.rs needs so gzip-NCD seeding is byte-identical to node:zlib (measured
// 2026-08-06: miniz_oxide/stock zlib mismatch 287/289 gzip lengths and reorder the
// top-3 seed set — see .thetacog/pmu/build.rs for the full parity note). Without
// build.rs + vendor/, a stranger's `cargo build` links flate2's default miniz_oxide
// backend, compiles CLEAN, and ships a DIFFERENT binary (sha f4a2e255… measured vs
// canonical 8b7076a8…) whose --lens output can diverge from ours — a stranger's
// `verify` could MISMATCH a row this repo's canonical binary MATCHES. So the refresh
// copies build.rs and the whole vendor/ tree too, preserving layout (vendor/zlib has
// its own contrib/ subdirectory).
const rustSrc = join(REPO, '.thetacog/pmu/src');
const rustDst = join(PKG, 'pmu-rust/src');
let nRust = 0, nVendor = 0;
if (existsSync(rustSrc)) {
  mkdirSync(rustDst, { recursive: true });
  for (const f of readdirSync(rustSrc).filter((x) => x.endsWith('.rs'))) { copyFileSync(join(rustSrc, f), join(rustDst, f)); nRust++; }
  for (const f of ['Cargo.toml', 'Cargo.lock', 'build.rs']) { const s = join(REPO, '.thetacog/pmu', f); if (existsSync(s)) copyFileSync(s, join(PKG, 'pmu-rust', f)); }
  // vendor/zlib — recurse to preserve the contrib/optimizations/ subdirectory.
  const copyTreeInto = (srcDir, dstDir) => {
    mkdirSync(dstDir, { recursive: true });
    for (const e of readdirSync(srcDir, { withFileTypes: true })) {
      const s = join(srcDir, e.name), d = join(dstDir, e.name);
      if (e.isDirectory()) copyTreeInto(s, d);
      else { copyFileSync(s, d); nVendor++; }
    }
  };
  const vendorSrc = join(REPO, '.thetacog/pmu/vendor');
  if (existsSync(vendorSrc)) copyTreeInto(vendorSrc, join(PKG, 'pmu-rust/vendor'));
}
writeFileSync(join(DST, 'BUNDLED.json'), JSON.stringify({ from: 'thetadrivencoach repo', entries: ENTRIES, modules: mods.sort(), cross_tree: crossModules.sort(), data, book, bundled_at_note: 'generated by bundle-pmu.mjs; do not edit by hand' }, null, 2));

console.log(`bundled the emailer + CLI subcommands into the package:`);
console.log(`  ${nMod} JS modules → packages/thetacog-mcp/scripts/pmu/`);
console.log(`  ${crossModules.length} cross-tree modules → packages/thetacog-mcp/src/ (walk driver + deps)`);
console.log(`  ${nData} data files → packages/thetacog-mcp/data,docs/`);
console.log(`  ${nRust} Rust source files + ${nVendor} vendor/zlib files → packages/thetacog-mcp/pmu-rust/ (build.rs + vendor now tracked, Task 28)`);
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
