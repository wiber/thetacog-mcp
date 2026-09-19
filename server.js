#!/usr/bin/env node

/**
 * ThetaCog MCP Server v1.0.7 - Cognitive Room Detection & Switching
 *
 * MODE MANAGEMENT, NOT TASK MANAGEMENT.
 *
 * This MCP server enables Claude to:
 * 1. DETECT which cognitive room you should be in based on conversation
 * 2. STATUS check your current room context and input streams
 * 3. SWITCH between rooms with context preservation
 *
 * ARCHITECTURE:
 * - HTML files with embedded JSON = self-contained rooms (git-tracked)
 * - SQLite = optional session state and switch history
 * - Supabase = optional multi-tenant sync (same as CRM pattern)
 *
 * The HTML files ARE the rooms. JSON inside them. Claude Flow MCP talks
 * to the same SQLite when available, but rooms work without it.
 *
 * ROOM ARCHETYPES:
 * - Builder (🔨 Blue, Tactical) - Ship, don't theorize
 * - Architect (📐 Indigo, Strategic) - See the whole war before fighting
 * - Operator (🎩 Green, Strategic) - Close, don't explore
 * - Vault (🔒 Red, Foundational) - Protect the irreversible
 * - Voice (🎤 Purple, Tactical) - Test messaging variants
 * - Laboratory (🧪 Cyan, Tactical) - Break things safely
 *
 * TERMINAL MAPPING (macOS default):
 * - iTerm2 → Builder
 * - VS Code → Architect
 * - Kitty → Operator
 * - WezTerm → Vault
 * - Terminal → Voice
 * - Cursor → Laboratory
 *
 * v0.1.0 Changes:
 * - Initial release with 3 core tools: detect, status, switch
 * - SQLite optional (works in memory-only mode)
 * - Graceful shutdown handlers (SIGINT, SIGTERM, SIGHUP)
 * - Install subcommand for easy registration
 *
 * For parallel founders who think in parallel.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { computeOverview } from './overview.js';
import { dispatchPmuInspect } from './lib/pmu-inspect.js';
import { runNext, renderNarration, renderHtml } from './next-engine.mjs';

// ============================================================================
// INSTALL SUBCOMMAND (copied from CRM pattern)
// ============================================================================

// Subcommand: dashboard — local web UI for rules management (Shadow Agent)
if (process.argv[2] === 'dashboard') {
  await import('./dashboard.js');
  // dashboard.js attaches its own listener and lifecycle; don't fall through.
  // Use a long-running idle promise to keep the process alive while http listens.
  await new Promise(() => {});
}

// Subcommand: regen-hooks — read SQLite, regenerate .thetacog/hooks-config.json
if (process.argv[2] === 'regen-hooks') {
  await import('./regen-hooks.js');
  process.exit(0);
}

// Subcommand: pmu-demo — full PMU pipeline (gzipNCD + SimHash + XOR + signed receipt)
// See packages/thetacog-mcp/scripts/pmu-demo.mjs for the orchestrator.
if (process.argv[2] === 'pmu-demo') {
  await import('./scripts/pmu-demo.mjs');
  // pmu-demo.mjs handles its own process.exit; if it returns we exit cleanly.
  process.exit(0);
}

// Subcommand: pmu-report — full pipeline + self-contained HTML report
// + ShortLex depth-N decomp + map-of-maps gap flags + auto-open in browser.
// See packages/thetacog-mcp/scripts/pmu-report.mjs for the orchestrator.
if (process.argv[2] === 'pmu-report') {
  await import('./scripts/pmu-report.mjs');
  process.exit(0);
}

// Subcommand: pmu-triptych — the on-commit 144×144 lattice TRIPTYCH dogfood (the chip's own anatomy:
// INTENT · REALITY · DELTA-XOR + three-colour tolerance + diagonal tile dump). Runs the repo's
// scripts/pmu/commit-triptych.mjs (needs the Rust daemon + pipeline + lattice data, so — like verify —
// it locates the repo root and runs there rather than bundling the toolchain).
//   npx thetacog-mcp pmu-triptych [--commit <sha>=HEAD] [--email] [--open]
if (process.argv[2] === 'pmu-triptych') {
  const { spawnSync } = await import('node:child_process');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const REL = 'scripts/pmu/commit-triptych.mjs';
  let root = null;
  const cands = [process.env.THETACOG_REPO_ROOT, process.cwd(), path.resolve(here, '../../')].filter(Boolean);
  let d = process.cwd(); for (let i = 0; i < 8; i++) { cands.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
  cands.push(here);  // BUNDLED FALLBACK: the package ships the emailer's closure under here/scripts/pmu (bundle-pmu.mjs)
  for (const c of cands) { try { if (fs.existsSync(path.join(c, REL))) { root = path.resolve(c); break; } } catch { /* */ } }
  if (!root) { console.error(`✗ thetacog pmu-triptych: could not locate ${REL}. Run from the thetadrivencoach repo, or set THETACOG_REPO_ROOT.`); process.exit(1); }
  const r = spawnSync('node', [path.join(root, REL), ...process.argv.slice(3)], { stdio: 'inherit', cwd: root });
  process.exit(r.status ?? 0);
}

// Subcommands: attest (Node A↔B verdict attestation) and prove-rice (the
// iterate-on-spec-to-prove-the-point loop). Both drive REAL scripts in
// scripts/pmu/ that call the Rust runner, so — like pmu-triptych — they locate
// the repo root rather than bundle the toolchain.
//   npx thetacog-mcp attest <publish-reef|submit|gate|verify> [...flags]
//   npx thetacog-mcp prove-rice [--check] [--llm gemini]
// The money-flow rails (the underwriter desk, runnable with no RPC):
//   npx thetacog-mcp ur-attest [--reality <text>|--reality-file <p>] [--policy-file <p>] [--json]
//                              — the UTILIZATION-REVIEW preset: two declared lanes, one sealed policy hash,
//                                auto-denial reads OFF_DOMAIN, empty record reads UNMEASURED (LLM-free)
//   npx thetacog-mcp settle   [--receipt <p>] [--coverage N]  — the TRANSACTIONAL RESOLUTION (spec⇒drift⇒chain⇒policy)
//   npx thetacog-mcp premium  [--strike N] [--base N]         — calibrated put-option premium from the ledger
//   npx thetacog-mcp variance [--window N]                    — variance swap quote on the lane
//   npx thetacog-mcp anchor   --receipt <p>                   — ReefAttestation.anchor() calldata for a receipt
// The local mesh (one node per room) — the internet mesh proven at small scale:
//   npx thetacog-mcp mesh-up           — one tick per room (the whole local mesh, bounded)
//   npx thetacog-mcp mesh-up --watch   — a live daemon per room
// B13, THE VERIFIER (spec §8.50) — the clearing primitive a claims engine runs on ONE signed
// tape row, with no MCP server and no access to our machine: the ed25519 signature over the
// row's own canonical tuple, then (only if that verifies) the placement recomputed from the
// commit and the reef/axes git blobs the row names, walked with the same instrument. Prints
// exactly one of MATCH · MISMATCH · UNVERIFIABLE on stdout's first line, `reason: …` on the
// second, exit 0 / 1 / 2. `--repo <path>` (default cwd) must be a checkout of the repo that
// produced the row (git objects + the built pmu-onchip binary); see scripts/pmu/verify-row.mjs.
//   npx thetacog-mcp verify <row.json> [--repo <path>] [--text <file>] [--reef <file>]
//                                      [--targets <file>] [--json]
// B19: `verify` also takes a BUNDLE (schema thetacog-attestation-bundle/1) — a git-independent
// commit-unit receipt with no `--repo` needed at all (the bundle carries the reef/axes bytes and
// the walked commit text) — and `verify --demo` runs it against the shipped fixture, needing
// neither a repo nor `--text`. `attest-bundle <commit-ref> [--out file.json]` PRODUCES one, but
// only inside this repo (git + a room's mesh identity + the walk tape); see attest-bundle.mjs.
// KNOWN_DISPATCH_CMDS accumulates every cmd name below as the loop walks the table (regardless of
// which one matches argv[2]) so the fallthrough guard further down can know the whole table
// without a second hand-typed copy of it — ONE RULE LIVES IN ONE PLACE.
const KNOWN_DISPATCH_CMDS = [];
for (const [cmd, rel] of [['verify', 'scripts/pmu/verify-row.mjs'], ['attest-bundle', 'scripts/pmu/attest-bundle.mjs'], ['prove', 'scripts/pmu/prove.mjs'], ['sense', 'scripts/pmu/sense.mjs'], ['attest', 'scripts/pmu/attest.mjs'], ['prove-rice', 'scripts/pmu/prove-rice.mjs'], ['hooper', 'scripts/pmu/hooper.mjs'], ['price-attest', 'scripts/pmu/price-attest.mjs'], ['attest-demo', 'scripts/pmu/attest-demo.mjs'], ['hypotheses', 'scripts/pmu/attest-hypotheses.mjs'], ['ur-attest', 'scripts/pmu/ur-attest.mjs'], ['perturb', 'scripts/pmu/attest-perturb.mjs'], ['attest-open', 'scripts/pmu/attest-open.mjs'], ['lens-tester', 'scripts/pmu/lens-tester-open.mjs'], ['lens-run', 'scripts/pmu/lens-run.mjs'], ['dinner-demo', 'scripts/pmu/dinner-demo.mjs'], ['publish-commit', 'scripts/pmu/publish-commit.mjs'], ['bootstrap', 'scripts/pmu/bootstrap.mjs'], ['proof', 'scripts/pmu/proof-monologue.mjs'], ['confidence', 'scripts/pmu/confidence-overlay.mjs'], ['annotate', 'scripts/pmu/annotate-regions.mjs'], ['portfolio', 'scripts/pmu/project-portfolio.mjs'], ['underwriter-grade', 'scripts/pmu/underwriter-grade.mjs'], ['settle', 'scripts/pmu/onchain-settle.mjs'], ['premium', 'scripts/pmu/calibration-premium.mjs'], ['ledger-attest', 'scripts/pmu/ledger-attest.mjs'], ['variance', 'scripts/pmu/variance-option.mjs'], ['anchor', 'scripts/pmu/onchain-anchor.mjs'], ['mesh-up', 'scripts/mesh/mesh-up.mjs'], ['spec-drift', 'scripts/pmu/spec-drift-check.mjs'], ['intervene', 'scripts/pmu/intervene.mjs'], ['e0', 'scripts/pmu/lens-e0.mjs'], ['miner', 'scripts/pmu/reef-miner.mjs'], ['harvest', 'scripts/pmu/harvest-agent.mjs'], ['sweep', 'scripts/pmu/lens-convergence-sweep.mjs'], ['loop-story', 'scripts/pmu/reef-loop-story.mjs'], ['register-surface', 'scripts/pmu/register-surface.mjs'], ['verify-baseline', 'scripts/pmu/verify-baseline.mjs'], ['init-fork', 'scripts/pmu/init-fork.mjs'], ['simulate-payout', 'scripts/pmu/simulate-payout.mjs'], ['my-pixel', 'scripts/pmu/my-pixel.mjs'], ['map-crawl', 'scripts/pmu/map-crawl.mjs'], ['verify-peer', 'scripts/pmu/verify-peer.mjs'], ['big-map-axes', 'scripts/pmu/big-map-axes.mjs'], ['index', 'scripts/pmu/lane-index.mjs'], ['vega-backtest', 'scripts/pmu/vega-backtest.mjs'], ['advisory-premium', 'scripts/pmu/advisory-premium.mjs'], ['trigger-battery', 'scripts/pmu/trigger-battery.mjs']]) {
  KNOWN_DISPATCH_CMDS.push(cmd);
  if (process.argv[2] === cmd) {
    const { spawnSync } = await import('node:child_process');
    const here = path.dirname(fileURLToPath(import.meta.url));
    let root = null;
    const cands = [process.env.THETACOG_REPO_ROOT, process.cwd(), path.resolve(here, '../../')].filter(Boolean);
    let d = process.cwd(); for (let i = 0; i < 8; i++) { cands.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
    cands.push(here);  // BUNDLED FALLBACK: the package ships these scripts under here/scripts/pmu (bundle-pmu.mjs)
    for (const c of cands) { try { if (fs.existsSync(path.join(c, rel))) { root = path.resolve(c); break; } } catch { /* */ } }
    if (!root) { console.error(`✗ thetacog ${cmd}: could not locate ${rel}. Run from the thetadrivencoach repo, or set THETACOG_REPO_ROOT.`); process.exit(1); }
    // `intervene` measures the CALLER'S repo (its REPO = process.cwd()) — preserve cwd even when
    // the script itself resolves from the bundled package (a stranger's repo has no scripts/pmu/).
    const childCwd = cmd === 'intervene' ? process.cwd() : root;
    const r = spawnSync('node', [path.join(root, rel), ...process.argv.slice(3)], { stdio: 'inherit', cwd: childCwd });
    process.exit(r.status ?? 0);
  }
}

// Resolve the thetadrivencoach repo root that holds scripts/pmu/verify-all.sh.
// The PMU verify path runs the REAL Rust daemon + the full test canon, so it
// cannot be bundled into npm (no Rust toolchain in a published tarball). Instead
// we LOCATE the repo robustly and fail with an actionable message if it's absent.
// Search order: explicit override → cwd (run from repo root) → ../../ (this
// package sits in-repo) → walk up from cwd. Returns null if not found.
const VERIFY_REL = 'scripts/pmu/verify-all.sh';
function resolvePmuRepoRoot(explicit) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.THETACOG_REPO_ROOT) candidates.push(process.env.THETACOG_REPO_ROOT);
  candidates.push(process.cwd());                 // invoked from the repo root
  candidates.push(path.resolve(here, '../../'));  // package lives at packages/thetacog-mcp
  // walk up from cwd in case we're nested somewhere inside the repo
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(path.join(c, VERIFY_REL))) return path.resolve(c); } catch { /* ignore */ }
  }
  return null;
}
const PMU_REPO_HINT =
  `pmu-verify needs the thetadrivencoach repository — the real Rust daemon, ` +
  `scripts/pmu/verify-all.sh, and the test canon are NOT bundled in npm (a verify ` +
  `that builds and runs the actual silicon path can't ship as a tarball). ` +
  `Fix: clone the repo and run from its root, OR set THETACOG_REPO_ROOT=/path/to/thetadrivencoach ` +
  `(CLI also accepts --repo-root <path>; the MCP tool accepts repo_root).`;

// Subcommand: pmu-verify — reproduce every PMU due-diligence claim
// (weld diff=0, T1 forgeries, σ-on-silicon, reef ρ) by running the repo's
// scripts/pmu/verify-all.sh at the repo root with stdio inherited. verify-all's
// canon includes the dossier-freshness gate, so this run also fails if the
// built dossier drifts from the code/data (the keep-current gate).
// The repo root is located by resolvePmuRepoRoot() (override-able), not assumed.
// Pass --skip-build (or SKIP_BUILD=1) to never rebuild the Rust binary.
if (process.argv[2] === 'pmu-verify') {
  const flagIdx = process.argv.indexOf('--repo-root');
  const explicit = flagIdx >= 0 ? process.argv[flagIdx + 1] : null;
  const repoRoot = resolvePmuRepoRoot(explicit);
  if (!repoRoot) { console.error(`❌ ${PMU_REPO_HINT}`); process.exit(2); }
  const skipBuild = process.argv.includes('--skip-build') || process.env.SKIP_BUILD === '1';
  try {
    execSync(VERIFY_REL, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...(skipBuild ? { SKIP_BUILD: '1' } : {}) },
    });
    process.exit(0);
  } catch (err) {
    // execSync throws on non-zero exit; propagate the script's exit code.
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

// npx thetacog-mcp init-hooks — arm the README-as-spec governor in THIS repo. An onboard LLM runs
// this once to install the advisory, non-blocking pre-push (+ the async post-commit ingest). The
// governor then measures code-vs-README-spec on every push and fires an investigation on a rupture,
// never blocking. This is the "final mile" for distribution: a stranger gets the governor in one touch.
if (process.argv[2] === 'init-hooks') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const installer = path.join(here, 'bin', 'install-hooks.sh');
  try {
    execSync(`bash ${JSON.stringify(installer)} --pre-push`, { stdio: 'inherit' });
  } catch (e) {
    console.error('❌ init-hooks failed:', String(e.message));
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[2] === 'install') {
  console.error('🧠 Installing ThetaCog MCP Server...');
  console.error('');
  console.error('ℹ️  Mode management, not task management.');
  console.error('   - Detects which cognitive room you should be in');
  console.error('   - Switches context with memory palace anchoring');
  console.error('   - SQLite optional (works in memory-only mode)');
  console.error('');

  try {
    console.error('📝 Registering MCP server with Claude Code...');
    try {
      execSync('claude mcp add thetacog thetacog-mcp', { stdio: 'pipe' });
      console.error('✅ MCP server registered!');
    } catch (addError) {
      const errorMsg = addError.message || '';
      if (errorMsg.includes('already exists')) {
        console.error('✅ MCP server already registered!');
      } else {
        throw addError;
      }
    }
    console.error('');
    console.error('🎉 Installation complete!');
    console.error('');
    console.error('📋 Next steps:');
    console.error('   1. Restart Claude Code (Cmd+Q → reopen)');
    console.error('   2. Test with: "What room should I be in?"');
    console.error('   3. Or: "Switch to architect mode"');
    console.error('');
    console.error('📖 Tools available:');
    console.error('   - thetacog-detect: Analyze conversation for room signals');
    console.error('   - thetacog-status: Get current room context');
    console.error('   - thetacog-switch: Switch to a different room');
    console.error('');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to register MCP server:', error.message);
    console.error('   Try running manually: claude mcp add thetacog thetacog-mcp');
    process.exit(1);
  }
}

// THE FALLTHROUGH GUARD (2026-09-17). Every recognized subcommand above either dispatches and
// exits, or falls through deliberately (no argv[2] at all — the MCP-server default, spawned by a
// host with no terminal). Before this guard, an UNRECOGNIZED subcommand fell through the same way
// a legitimate bare invocation does: past every `if`, all the way to `new ThetaCogServer().run()`
// at the bottom of this file, which prints "server started" and sits on stdio — exit 0, no error.
// A stranger who typed a documented command with a typo, or a command whose dispatch entry had
// not shipped yet (the incident: `vega-backtest` / `advisory-premium` / `trigger-battery` were
// instructed on /benchmark and /playbook but had no entry in the table above — wired on the
// `ghost-read-matrix` branch, never merged to main), got a silently-hung MCP server instead of an
// error — the exact "fell through to demo behaviour instead of the real gate" failure /playbook
// itself names as disqualifying. `process.argv[2]` is the ONLY legitimate no-subcommand case.
if (process.argv[2] !== undefined) {
  // The 8 solo `if (process.argv[2] === 'x')` blocks above each exit before reaching here when
  // matched, so surviving to this line already means argv[2] wasn't one of them — list their
  // names once, for the error message, alongside the dispatch table's own accumulated list.
  const SOLO_CMDS = ['dashboard', 'regen-hooks', 'pmu-demo', 'pmu-report', 'pmu-triptych', 'pmu-verify', 'init-hooks', 'install'];
  const KNOWN = [...SOLO_CMDS, ...KNOWN_DISPATCH_CMDS];
  if (!KNOWN.includes(process.argv[2])) {
    console.error(`✗ unknown subcommand: ${process.argv[2]}`);
    console.error(`  known subcommands: ${KNOWN.join(', ')}`);
    console.error('  (no subcommand at all starts the MCP server itself, for a host like Claude Desktop)');
    process.exit(2);
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Room detection signals - add more patterns here to improve detection
// Claude Flow can edit this section to add domain-specific signals
const DETECTION_SIGNALS = {
  builder: {
    keywords: ['ship', 'deploy', 'build', 'fix', 'implement', 'code', 'done', 'finish', 'deadline', 'demo'],
    confidence: 0.85,
    emoji: '🔨',
    color: '#3b82f6',
    tier: 'tactical'
  },
  architect: {
    keywords: ['strategy', 'roadmap', 'bigger picture', 'sequence', 'prioritize', 'architecture', 'plan', 'vision', 'Q1', 'Q2', 'Q3', 'Q4'],
    confidence: 0.90,
    emoji: '📐',
    color: '#4f46e5',
    tier: 'strategic'
  },
  operator: {
    keywords: ['close', 'deal', 'revenue', 'prospect', 'sales', 'meeting', 'pipeline', 'convert', 'customer'],
    confidence: 0.88,
    emoji: '🎩',
    color: '#22c55e',
    tier: 'strategic'
  },
  vault: {
    keywords: ['patent', 'IP', 'legal', 'protect', 'trademark', 'confidential', 'irreversible', 'prove', 'validate'],
    confidence: 0.92,
    emoji: '🔒',
    color: '#ef4444',
    tier: 'foundational'
  },
  voice: {
    keywords: ['message', 'copy', 'blog', 'content', 'docs', 'documentation', 'explain', 'teach', 'write'],
    confidence: 0.80,
    emoji: '🎤',
    color: '#a855f7',
    tier: 'tactical'
  },
  laboratory: {
    keywords: ['experiment', 'prototype', 'test', 'try', 'explore', 'break', 'hack', 'spike', 'POC'],
    confidence: 0.82,
    emoji: '🧪',
    color: '#06b6d4',
    tier: 'tactical'
  },
  performer: {
    keywords: ['present', 'pitch', 'demo', 'live', 'rehearse', 'practice', 'speech', 'talk', 'stage'],
    confidence: 0.85,
    emoji: '🎬',
    color: '#f59e0b',
    tier: 'performance'
  },
  navigator: {
    keywords: ['find', 'search', 'explore', 'navigate', 'discover', 'map', 'chart', 'locate', 'grep', 'where'],
    confidence: 0.83,
    emoji: '🧭',
    color: '#0d9488',
    tier: 'exploration'
  },
  network: {
    keywords: ['message', 'slack', 'email', 'text', 'dm', 'reply', 'respond', 'connect', 'reach out'],
    confidence: 0.80,
    emoji: '🌐',
    color: '#6366f1',
    tier: 'communication'
  }
};

// Terminal to room mapping (macOS)
// Claude Flow can edit this to add Windows/Linux terminals
// HTML files are in .workflow/rooms/ relative to project root
const TERMINALS_MAC = {
  'iTerm': { app: 'iTerm.app', room: 'builder', html: 'iterm2-builder.html' },
  'VS Code': { app: 'Visual Studio Code.app', room: 'architect', html: 'vscode-architect.html' },
  'Kitty': { app: 'kitty.app', room: 'operator', html: 'kitty-operator.html' },
  'WezTerm': { app: 'WezTerm.app', room: 'vault', html: 'wezterm-vault.html' },
  'Terminal': { app: 'Terminal.app', room: 'voice', html: 'terminal-voice.html' },
  'Cursor': { app: 'Cursor.app', room: 'laboratory', html: 'cursor-laboratory.html' },
  'Alacritty': { app: 'Alacritty.app', room: 'performer', html: 'alacritty-performer.html' },
  'Rio': { app: 'rio.app', room: 'navigator', html: 'rio-navigator.html' },
  'Messages': { app: 'Messages.app', room: 'network', html: 'messages-network.html' }
};

// Memory Palace anchors for each room
// Claude Flow can customize these per user
const MEMORY_PALACES = {
  builder: "Walk to the workshop. Blue light. Tools on the wall. The smell of sawdust.",
  architect: "Walk up the stairs to the drafting room. Indigo light. Unroll the blueprints. See the whole war before you fight it.",
  operator: "Enter the trading floor. Green light. The deals are live. Every conversation ends with a next step.",
  vault: "Descend to the vault. Red light. The heavy door closes behind you. What enters here is protected forever.",
  voice: "Step onto the stage. Purple spotlight. The audience is listening. Test the message.",
  laboratory: "Enter the lab. Cyan glow. Safety goggles on. Break things safely here.",
  performer: "The green room. Mirror. Adrenaline. You've rehearsed. Now deliver. One shot to land the message.",
  navigator: "Open the navigation console. Teal glow fills the bridge. Chart unknown territory. GPU speed. Map the landscape.",
  network: "The communication hub. Indigo signals pulse. Connect, respond, reach out. Messages flow in and out."
};

// Identity rules for each room
// Claude Flow can expand these
const IDENTITY_RULES = {
  builder: [
    "You are shipping, not theorizing",
    "Done beats right when the demo is Sunday",
    "Make it work, not perfect"
  ],
  architect: [
    "You are redrawing the entire territory",
    "You see the whole war before you fight it",
    "You do not execute battles. You sequence them."
  ],
  operator: [
    "You are closing, not exploring",
    "Revenue is the only metric that matters here",
    "Every conversation ends with a next step"
  ],
  vault: [
    "You are protecting the irreversible",
    "You are validating before committing",
    "You do not ship from here. You prove from here."
  ],
  voice: [
    "You are testing messaging",
    "Experiment with variants",
    "Find what resonates"
  ],
  laboratory: [
    "You are prototyping fast",
    "Break things safely",
    "Failure is data here"
  ],
  performer: [
    "You have already rehearsed",
    "This is the moment you deliver",
    "One shot to land the message",
    "Reputation is on the line"
  ],
  navigator: [
    "You are charting unknown territory",
    "GPU speed means you see faster",
    "Map before you build",
    "Fast scouts make fast armies"
  ],
  network: [
    "You are connecting, not creating",
    "Messages flow in and out",
    "Respond quickly, reach out deliberately"
  ]
};

// ============================================================================
// TERMINAL DETECTION
// ============================================================================

/**
 * Detect which terminal Claude is running in
 * Uses TERM_PROGRAM env var (set by most terminals)
 */
function detectTerminal() {
  const termProgram = process.env.TERM_PROGRAM || '';
  const termProgramVersion = process.env.TERM_PROGRAM_VERSION || '';

  // Map env values to our terminal names
  const termMap = {
    'iTerm.app': 'iTerm',
    'vscode': 'VS Code',
    'Apple_Terminal': 'Terminal',
    'kitty': 'Kitty',
    'WezTerm': 'WezTerm',
    'Cursor': 'Cursor',
    'Alacritty': 'Alacritty',
    'rio': 'Rio',
    'Rio': 'Rio'
  };

  const detected = termMap[termProgram] || null;
  const room = detected ? TERMINALS_MAC[detected]?.room : null;

  return {
    termProgram,
    termProgramVersion,
    terminal: detected,
    room: room,
    html: detected ? TERMINALS_MAC[detected]?.html : null
  };
}

// ============================================================================
// STATE MANAGEMENT (SQLite primary, JSON export layer)
// ============================================================================

let currentRoom = null;
let roomHistory = [];
let db = null;
let thetacogDir = null;

// Try to load SQLite
async function initDatabase() {
  try {
    const Database = (await import('better-sqlite3')).default;
    thetacogDir = path.join(process.env.HOME, '.thetacog');
    const dbPath = path.join(thetacogDir, 'thetacog.db');

    // Ensure directory exists
    if (!fs.existsSync(thetacogDir)) {
      fs.mkdirSync(thetacogDir, { recursive: true });
    }

    db = new Database(dbPath);

    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        id INTEGER PRIMARY KEY,
        current_room TEXT,
        context_snapshot TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS room_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_room TEXT,
        to_room TEXT,
        signal TEXT,
        confidence REAL,
        switched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Todos per room (the main work items)
      CREATE TABLE IF NOT EXISTS room_todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT NOT NULL,
        text TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Input streams between rooms (flywheel)
      CREATE TABLE IF NOT EXISTS room_streams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_room TEXT NOT NULL,
        to_room TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS room_configs (
        room_name TEXT PRIMARY KEY,
        config_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Load current room from state
    const state = db.prepare('SELECT current_room FROM room_state WHERE id = 1').get();
    if (state) {
      currentRoom = state.current_room;
    }

    console.error('[ThetaCog] SQLite initialized at', dbPath);
    return true;
  } catch (e) {
    // COLD-START GUARD: better-sqlite3 is an OPTIONAL native dep. If its prebuild
    // was unavailable for this Node version, npm skipped it and we land here —
    // the CLI and every attest/demo command still run. Never let this path be silent.
    console.error('[ThetaCog] SQLite not available (optional native dep better-sqlite3 not installed for this Node version) — running in memory-only mode. All attest/demo commands work without it. See DILIGENCE.md in this package.');
    return false;
  }
}

// ============================================================================
// TODO CRUD (SQLite primary)
// ============================================================================

/**
 * Add a todo to a room
 */
function addTodo(room, text, priority = 5) {
  if (!db) return { error: 'SQLite not available' };

  const result = db.prepare(`
    INSERT INTO room_todos (room, text, priority)
    VALUES (?, ?, ?)
  `).run(room, text, priority);

  exportStateToJson(); // Sync to JSON
  return { id: result.lastInsertRowid, room, text, priority, done: false };
}

/**
 * List todos for a room (or all rooms)
 */
function listTodos(room = null) {
  if (!db) return [];

  if (room) {
    return db.prepare(`
      SELECT * FROM room_todos WHERE room = ? ORDER BY priority ASC, created_at DESC
    `).all(room);
  } else {
    return db.prepare(`
      SELECT * FROM room_todos ORDER BY room, priority ASC, created_at DESC
    `).all();
  }
}

/**
 * Update a todo (toggle done, change priority, edit text)
 */
function updateTodo(id, updates) {
  if (!db) return { error: 'SQLite not available' };

  const fields = [];
  const values = [];

  if (updates.done !== undefined) {
    fields.push('done = ?');
    values.push(updates.done ? 1 : 0);
  }
  if (updates.priority !== undefined) {
    fields.push('priority = ?');
    values.push(updates.priority);
  }
  if (updates.text !== undefined) {
    fields.push('text = ?');
    values.push(updates.text);
  }

  if (fields.length === 0) return { error: 'No updates provided' };

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.prepare(`UPDATE room_todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  exportStateToJson(); // Sync to JSON
  return { success: true, id };
}

/**
 * Delete a todo
 */
function deleteTodo(id) {
  if (!db) return { error: 'SQLite not available' };

  db.prepare('DELETE FROM room_todos WHERE id = ?').run(id);
  exportStateToJson(); // Sync to JSON
  return { success: true, id };
}

// ============================================================================
// INPUT STREAMS (Flywheel coordination)
// ============================================================================

/**
 * Send a message from one room to another
 */
function sendStream(fromRoom, toRoom, message) {
  if (!db) return { error: 'SQLite not available' };

  const result = db.prepare(`
    INSERT INTO room_streams (from_room, to_room, message)
    VALUES (?, ?, ?)
  `).run(fromRoom, toRoom, message);

  exportStateToJson();
  return { id: result.lastInsertRowid, fromRoom, toRoom, message };
}

/**
 * Get unread streams for a room
 */
function getStreams(room) {
  if (!db) return [];

  return db.prepare(`
    SELECT * FROM room_streams WHERE to_room = ? AND read = 0
    ORDER BY created_at DESC
  `).all(room);
}

/**
 * Mark streams as read
 */
function markStreamsRead(room) {
  if (!db) return { error: 'SQLite not available' };

  db.prepare('UPDATE room_streams SET read = 1 WHERE to_room = ?').run(room);
  return { success: true };
}

// ============================================================================
// JSON EXPORT (for HTML to read on tab focus)
// ============================================================================

/**
 * Export full state to JSON file
 * HTML files read this on visibilitychange event
 */
function exportStateToJson() {
  if (!db || !thetacogDir) return;

  const state = {
    currentRoom: currentRoom || 'builder',
    exportedAt: new Date().toISOString(),
    rooms: {}
  };

  // Get all rooms (all 9 cognitive rooms)
  const rooms = ['builder', 'architect', 'operator', 'vault', 'voice', 'laboratory', 'performer', 'navigator', 'network'];

  for (const room of rooms) {
    const todos = db.prepare(`
      SELECT id, text, done, priority FROM room_todos WHERE room = ?
      ORDER BY priority ASC
    `).all(room);

    const streams = db.prepare(`
      SELECT id, from_room, message, created_at FROM room_streams
      WHERE to_room = ? AND read = 0
    `).all(room);

    state.rooms[room] = {
      emoji: DETECTION_SIGNALS[room]?.emoji || '🧠',
      color: DETECTION_SIGNALS[room]?.color || '#667eea',
      tier: DETECTION_SIGNALS[room]?.tier || 'tactical',
      memoryPalace: MEMORY_PALACES[room],
      identityRules: IDENTITY_RULES[room],
      todos: todos.map(t => ({ ...t, done: !!t.done })),
      inputStreams: streams
    };
  }

  // Write to JSON file
  const jsonPath = path.join(thetacogDir, 'state.json');
  fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2));

  return state;
}

/**
 * Open the HTML for a room (or current room's HTML)
 */
function openRoomHtml(room = null) {
  const targetRoom = room || currentRoom || 'builder';
  const terminal = Object.values(TERMINALS_MAC).find(t => t.room === targetRoom);

  if (!terminal) {
    return { error: `No HTML mapping for room: ${targetRoom}` };
  }

  // Find the HTML file in .workflow/rooms/ relative to cwd or user home
  const possiblePaths = [
    path.join(process.cwd(), '.workflow', 'rooms', terminal.html),
    path.join(__dirname, '.workflow', terminal.html),
    path.join(process.env.HOME, '.thetacog', 'rooms', terminal.html)
  ];

  for (const htmlPath of possiblePaths) {
    if (fs.existsSync(htmlPath)) {
      // Use execSync to open (works on macOS)
      try {
        execSync(`open "${htmlPath}"`, { stdio: 'pipe' });
        return { success: true, opened: htmlPath, room: targetRoom };
      } catch (e) {
        return { error: `Failed to open: ${e.message}` };
      }
    }
  }

  return { error: `HTML not found for room: ${targetRoom}`, searched: possiblePaths };
}

// ============================================================================
// ROOM DETECTION LOGIC
// ============================================================================

/**
 * Detect which room the user should be in based on conversation text
 * @param {string} text - The conversation text to analyze
 * @returns {object} - { room, confidence, signals, switchRecommended }
 */
function detectRoom(text) {
  const lowerText = text.toLowerCase();
  const matches = [];

  // Check each room's keywords
  for (const [roomName, config] of Object.entries(DETECTION_SIGNALS)) {
    const foundKeywords = config.keywords.filter(kw => lowerText.includes(kw.toLowerCase()));
    if (foundKeywords.length > 0) {
      // Confidence scales with number of matching keywords
      const keywordRatio = foundKeywords.length / config.keywords.length;
      const adjustedConfidence = config.confidence * (0.5 + 0.5 * keywordRatio);

      matches.push({
        room: roomName,
        confidence: adjustedConfidence,
        signals: foundKeywords,
        emoji: config.emoji,
        color: config.color,
        tier: config.tier
      });
    }
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return {
      room: currentRoom || 'builder',
      confidence: 0.3,
      signals: [],
      switchRecommended: false,
      message: "No clear room signal detected. Staying in current room."
    };
  }

  const best = matches[0];
  const switchRecommended = best.room !== currentRoom && best.confidence > 0.7;

  return {
    room: best.room,
    confidence: best.confidence,
    signals: best.signals,
    emoji: best.emoji,
    color: best.color,
    tier: best.tier,
    currentRoom: currentRoom,
    switchRecommended: switchRecommended,
    memoryPalace: MEMORY_PALACES[best.room],
    identityRules: IDENTITY_RULES[best.room],
    alternatives: matches.slice(1, 3) // Top 2 alternatives
  };
}

/**
 * Switch to a new room, preserving context
 * @param {string} newRoom - The room to switch to
 * @param {string} contextSnapshot - Optional context to save from previous room
 * @returns {object} - The new room configuration
 */
function switchRoom(newRoom, contextSnapshot = null) {
  const previousRoom = currentRoom;

  // Save to history
  if (db) {
    db.prepare(`
      INSERT INTO room_history (from_room, to_room, signal, confidence)
      VALUES (?, ?, ?, ?)
    `).run(previousRoom, newRoom, 'manual_switch', 1.0);

    // Update current state
    db.prepare(`
      INSERT OR REPLACE INTO room_state (id, current_room, context_snapshot, updated_at)
      VALUES (1, ?, ?, CURRENT_TIMESTAMP)
    `).run(newRoom, contextSnapshot);
  }

  // Update in-memory state
  roomHistory.push({
    from: previousRoom,
    to: newRoom,
    at: new Date().toISOString()
  });
  currentRoom = newRoom;

  return {
    previousRoom: previousRoom,
    currentRoom: newRoom,
    memoryPalace: MEMORY_PALACES[newRoom],
    identityRules: IDENTITY_RULES[newRoom],
    emoji: DETECTION_SIGNALS[newRoom]?.emoji || '🧠',
    color: DETECTION_SIGNALS[newRoom]?.color || '#667eea',
    tier: DETECTION_SIGNALS[newRoom]?.tier || 'tactical',
    contextSaved: !!contextSnapshot,
    terminal: Object.values(TERMINALS_MAC).find(t => t.room === newRoom)?.app || null,
    html: Object.values(TERMINALS_MAC).find(t => t.room === newRoom)?.html || null
  };
}

/**
 * Get current room status
 * @returns {object} - Current room configuration and state
 */
function getStatus() {
  const room = currentRoom || 'builder';

  return {
    currentRoom: room,
    emoji: DETECTION_SIGNALS[room]?.emoji || '🧠',
    color: DETECTION_SIGNALS[room]?.color || '#667eea',
    tier: DETECTION_SIGNALS[room]?.tier || 'tactical',
    memoryPalace: MEMORY_PALACES[room],
    identityRules: IDENTITY_RULES[room],
    terminal: Object.values(TERMINALS_MAC).find(t => t.room === room)?.app || null,
    html: Object.values(TERMINALS_MAC).find(t => t.room === room)?.html || null,
    recentSwitches: roomHistory.slice(-5),
    sqliteEnabled: !!db
  };
}

// ============================================================================
// MCP SERVER
// ============================================================================

class ThetaCogServer {
  constructor() {
    this.server = new Server(
      {
        name: 'thetacog-mcp',
        version: '1.0.7',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'thetacog-detect',
            description: 'Analyze conversation to detect which cognitive room you should be in. Returns room suggestion, confidence score, and switching signals. Use when user says things like "let\'s think bigger picture" or "time to ship".',
            inputSchema: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: 'The conversation text to analyze for room detection signals',
                },
              },
              required: ['text'],
            },
          },
          {
            name: 'thetacog-status',
            description: 'Get current cognitive room status. Returns: current room, identity rules, memory palace anchor, recent switches, and terminal mapping.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'thetacog-switch',
            description: 'Switch to a different cognitive room. Saves context from previous room, loads new room configuration. Returns memory palace anchor and identity rules for new room.',
            inputSchema: {
              type: 'object',
              properties: {
                room: {
                  type: 'string',
                  description: 'Room to switch to: builder, architect, operator, vault, voice, laboratory, performer, navigator, or network',
                  enum: ['builder', 'architect', 'operator', 'vault', 'voice', 'laboratory', 'performer', 'navigator', 'network']
                },
                context: {
                  type: 'string',
                  description: 'Optional context snapshot to save from current room (e.g., "Working on Stripe integration, 80% complete")',
                },
              },
              required: ['room'],
            },
          },
          {
            name: 'thetacog-open',
            description: 'Open the HTML dashboard for a room in the browser. If no room specified, opens current room. The HTML auto-refreshes from state.json on tab focus.',
            inputSchema: {
              type: 'object',
              properties: {
                room: {
                  type: 'string',
                  description: 'Room to open (optional, defaults to current room)',
                  enum: ['builder', 'architect', 'operator', 'vault', 'voice', 'laboratory', 'performer', 'navigator', 'network']
                },
              },
            },
          },
          {
            name: 'thetacog-todo',
            description: 'Manage todos for a room. Actions: add, list, update, delete. Todos are stored in SQLite and synced to state.json for HTML display.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'Action to perform',
                  enum: ['add', 'list', 'update', 'delete']
                },
                room: {
                  type: 'string',
                  description: 'Room for the todo (required for add, optional for list)',
                },
                text: {
                  type: 'string',
                  description: 'Todo text (required for add)',
                },
                id: {
                  type: 'number',
                  description: 'Todo ID (required for update/delete)',
                },
                done: {
                  type: 'boolean',
                  description: 'Mark as done (for update)',
                },
                priority: {
                  type: 'number',
                  description: 'Priority 1-10 (1=highest). For add or update.',
                },
              },
              required: ['action'],
            },
          },
          {
            name: 'thetacog-stream',
            description: 'Send messages between rooms (flywheel coordination). Get unread input streams for a room.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'Action: send, get, or mark-read',
                  enum: ['send', 'get', 'mark-read']
                },
                from: {
                  type: 'string',
                  description: 'Source room (for send)',
                },
                to: {
                  type: 'string',
                  description: 'Target room (for send, get, mark-read)',
                },
                message: {
                  type: 'string',
                  description: 'Message to send (for send)',
                },
              },
              required: ['action'],
            },
          },
          {
            name: 'thetacog-export',
            description: 'Export current state to JSON file. HTML files read this on tab focus to refresh.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'thetacog-terminal',
            description: 'Detect which terminal Claude is running in, and which room it maps to.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'thetacog_overview',
            description: 'Live 3-recent + 3-next overview computed from real git activity. Reads owned-surface globs from each .workflow/rooms/<room>.html, groups commits in the last 14d by owning room (largest-fraction-of-files wins), filters auto-bumps, and returns: just_completed (3 most-recent meaningful commits, one per room), next_up (3 rooms scored by blocks_downstream × 2 + dormancy_days), and grid_12x12_colored_cells map. Spin-up DAG: voice → performer → network → operator → architect; foundation rooms (builder, laboratory, claudelab, vault, navigator) are independent.',
            inputSchema: {
              type: 'object',
              properties: {
                days_back: {
                  type: 'number',
                  description: 'How many days of git history to consider (default 14)',
                },
                repo_root: {
                  type: 'string',
                  description: 'Optional explicit repo root path (defaults to git-detected from cwd)',
                },
              },
            },
          },
          {
            name: 'thetacog-pmu-inspect',
            description: 'Inspect and control the PMU XOR→ClaudBridge pipeline. Reads/writes data/pmu/pipeline/state.json (shared with the CLI driver, dashboard, and ClaudBridge mock). Use to: peek current intent/reality + last run sigma/friction (get-state), change inputs (set-intent, set-reality, set-threshold), trigger a full pipeline run end-to-end (run; optional stage to stop early), retrieve a specific run\'s receipt (get-run), list recent runs (list-runs), or inspect the cached axis/tile libraries (list-axes, list-tiles). The intent/reality control plane is the load-bearing surface — changing intent here makes the next run + dashboard render against the new coordinate without code edits.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'Subcommand',
                  enum: ['get-state', 'set-intent', 'set-reality', 'set-threshold',
                         'run', 'get-run', 'list-runs', 'list-axes', 'list-tiles', 'reset']
                },
                value: {
                  type: 'string',
                  description: 'For set-intent/set-reality: a coord like "A1,A1" or free text. For set-threshold: a number or "adaptive".'
                },
                kind: {
                  type: 'string',
                  description: 'Optional input kind override for set-intent/set-reality: "coord" | "text" | "file"',
                  enum: ['coord', 'text', 'file']
                },
                mix: {
                  type: 'object',
                  description: 'For set-intent/set-reality: a mix spec { base:"A1,A1", drift:"B2,B2", drift_fraction:0.30 }',
                  properties: {
                    base: { type: 'string' },
                    drift: { type: 'string' },
                    drift_fraction: { type: 'number' }
                  }
                },
                stage: {
                  type: 'string',
                  description: 'For run: stop after this stage. Order: resolve → sense → sigma → binarize → project → xor → claudbridge',
                  enum: ['resolve', 'sense', 'sigma', 'binarize', 'project', 'xor', 'claudbridge']
                },
                threshold: {
                  type: 'string',
                  description: 'For run: override the binarize threshold ("adaptive" or a numeric like "0.55")'
                },
                run_id: {
                  type: 'string',
                  description: 'For get-run: the run id to fetch (e.g., "run-2026-05-27T15-00-34-…")'
                },
                limit: {
                  type: 'number',
                  description: 'For list-runs / list-axes / list-tiles: max items returned'
                },
                offset: {
                  type: 'number',
                  description: 'For list-tiles: pagination offset into the 20,736-tile library'
                }
              },
              required: ['action']
            }
          },
          {
            name: 'pmu_verify',
            description: 'Reproduce every PMU due-diligence claim — weld diff=0, T1 forgeries, σ-on-silicon, reef ρ. Runs scripts/pmu/verify-all.sh in the thetadrivencoach repo (the Rust daemon + canon are NOT bundled in npm; the repo is located via cwd / ../../, or set repo_root / THETACOG_REPO_ROOT). Includes the dossier-freshness gate (fails if the document drifts from the code).',
            inputSchema: {
              type: 'object',
              properties: {
                skip_build: {
                  type: 'boolean',
                  description: 'Skip rebuilding the Rust binary even if stale (sets SKIP_BUILD=1). Faster when the binary already exists.'
                },
                repo_root: {
                  type: 'string',
                  description: 'Absolute path to the thetadrivencoach repo root (the dir containing scripts/pmu/verify-all.sh). Only needed when the package is not running from inside the repo — otherwise auto-located.'
                }
              }
            }
          },
          {
            name: 'vna_sensor',
            description: 'THE SENSOR: the current gzip-NCD state between the working codebase and the intent document (the checkbox spec), callable as often as you like. Returns both arms of the attractor envelope — MOVE THE WORK (a declared-but-unworked coordinate to aim the next commit at) and MOVE THE DECLARATION (a worked-but-undeclared coordinate the spec never named) — plus the PULL in Chebyshev blocks, the abstained items the placer refused to place, and a human-readable card. DETERMINISTIC AND LLM-FREE: placement is gzip-NCD against the 144 cell masses, measured at 4.34x over chance. It does NOT gate, block or prevent anything — drift is the INPUT to this loop, and the redirect is emitted AFTER the work, so a red delta re-routes the next cycle rather than stopping this one. An item below the calibrated margin floor (0.00928, from the perturbation ladder) is ABSTAINED and never used to aim you: a confident wrong placement measures WORSE than chance. Sufficient for where the work sits relative to the declaration; NOT sufficient for whether the work was good (Rice) or whether the declaration is the correct half.',
            inputSchema: {
              type: 'object',
              properties: {
                spec_path: {
                  type: 'string',
                  description: 'Absolute path to the intent document (the markdown checklist). Defaults to docs/specs/vna/SPEC-VNA-COCKPIT.md in the located repo.'
                },
                limit: {
                  type: 'number',
                  description: 'How many recent placed commits count as "the work" this cycle (default 20).'
                },
                repo_root: {
                  type: 'string',
                  description: 'Absolute path to the thetadrivencoach repo root. Auto-located when running from inside the repo.'
                }
              }
            }
          },
          {
            name: 'write_tape_intent',
            description: 'Appends a proposed state change to the immutable physics tape (the WRITE-LOCK — Phase 1 of 100% Cryptographic Attribution). This does NOT execute the verification: the tool is a dumb ledger entry that returns only a cryptographic cursor. The physics engine (gzip-NCD placement, deterministic, LLM-free) fires when you call read_tape_receipt with the returned cursor_id — synchronous lazy evaluation, no background worker. Do NOT claim success, finalize a task, or write to a database until read_tape_receipt returns filled: true.',
            inputSchema: {
              type: 'object',
              properties: {
                intent_text: {
                  type: 'string',
                  description: 'The exact desired outcome or instructional constraint.'
                },
                reality_text: {
                  type: 'string',
                  description: 'The current state or generated artifact to be measured against the intent.'
                },
                negative_text: {
                  type: 'string',
                  description: 'The catastrophe boundary. Required for sledgehammer diagnostics.'
                },
                scenario_tag: {
                  type: 'string',
                  description: 'Maps to preset targets: golden-baseline, hallucination, semantic-drift, sledgehammer, abstain-tie.'
                },
                tape_path: {
                  type: 'string',
                  description: 'Optional absolute path to the flight tape. Defaults to docs/pmu/attest-flight-tape.json when run in the repo (the served instrument polls it), else .thetacog/attest-flight-tape.json.'
                }
              },
              required: ['intent_text', 'reality_text', 'scenario_tag']
            }
          },
          {
            name: 'read_tape_receipt',
            description: 'The binary gate of the write-lock: reads the physics receipt for a cursor_id. On a PENDING cursor this tool synchronously fires the physics engine (the walk ALWAYS runs — even a pebble is measured, then classified) and returns the receipt in the same call. Answers honestly: FILLED (filled: true — the only state that permits declaring success) · INSUFFICIENT_MASS (measured read recorded but below the mass floor; resubmit with real substance, max 3 strikes per lineage) · CATASTROPHIC_FAILURE (terminal — the lineage is locked at the protocol level, escalate to a human) · PENDING · UNKNOWN_CURSOR.',
            inputSchema: {
              type: 'object',
              properties: {
                cursor_id: {
                  type: 'string',
                  description: 'The sha256 cursor returned by write_tape_intent.'
                },
                wait_ms: {
                  type: 'number',
                  description: 'Max milliseconds to hold the connection polling the tape (default 4000, capped at 8000).'
                },
                tape_path: {
                  type: 'string',
                  description: 'Optional absolute path to the flight tape (must match the write_tape_intent call).'
                }
              },
              required: ['cursor_id']
            }
          },
          {
            name: 'thetacog-sign',
            description: 'SIGNED UNDER LICENCE, LOCALLY, BEFORE ANY NOTARY. Signs one flight-tape row with this device\'s ed25519 key — { sha } tapes that commit, { bytes } tapes the bytes content-addressed (sha256) — and stamps the licence\'s PUBLIC claims { account_id, pubkey_fingerprint, exp, jti, kid } INSIDE the signed bytes at proofs.licence. The claims are read from VNA_ENTITLEMENT_CLAIMS in this server\'s environment (the IDE extension sets it from its secret store); the bearer token is never read here and never enters the row, the CAR or this result. A licence naming another machine\'s key is refused at write. Without VNA_ENTITLEMENT_CLAIMS the row is signed UNLICENSED (proofs.licence: null) and this result says so. Returns the signed row, its CAR, the stamp, the four local verdicts (signature · fingerprint · claims · exp) and card 3\'s line. A stamp is a claim the device key signs — "signed under licence", never a signature by the licence. Sufficient for WHO signed WHAT under WHICH licence, re-runnably from the bytes on disk; not sufficient for whether the work was good (Rice). The measurement is free; the underwriting is paid.',
            inputSchema: {
              type: 'object',
              properties: {
                sha: { type: 'string', description: 'A commit sha (or unique prefix) in the located repo — taped as kind commit, with its proofs and Δ.' },
                bytes: { type: 'string', description: 'Arbitrary text to sign — taped as kind batch, sha = sha256(bytes); no spec, no walk, and the CAR says what is missing.' },
                room: { type: 'string', description: 'The room whose key signs (defaults to the terminal\'s room, else the last signed row\'s).' },
                repo_root: { type: 'string', description: 'Absolute path to the thetadrivencoach repo root. Auto-located when running from inside the repo.' }
              }
            }
          },
          {
            name: 'thetacog-verify-licence',
            description: 'The four local verdicts on one flight-tape row: signature (the row\'s ed25519 signature verifies under the device key on the row) · fingerprint (that key\'s fingerprint is the stamp\'s) · claims (the stamp equals the public claims in VNA_ENTITLEMENT_CLAIMS) · exp (the stamp was unexpired at row.ts). LICENSED when all four hold, REFUSED naming the failed checks, UNLICENSED when the row carries no stamp (proofs.licence null, or a row taped before the field existed — a check not run is not a check failed). Node crypto only, no network, no notary; the bearer is never read.',
            inputSchema: {
              type: 'object',
              properties: {
                row: { type: 'object', description: 'A flight-tape row as written (seq · ts · kind · … · sig · sig_pubkey).' },
                repo_root: { type: 'string', description: 'Absolute path to the thetadrivencoach repo root. Auto-located when running from inside the repo.' }
              },
              required: ['row']
            }
          },
          {
            name: 'thetacog-next',
            description: 'Predict the next steps across all 9 rooms from THREE real sources — chat transcripts (read backwards, bounded), the repo + git logs per each room\'s owned file/dir surface, and the board (room punch lists). EVERY room is filled with a ≥2-sentence themed narrative (the direction + the actual area); the current room gets the exhaustive narrative + a numbered actionable to-do list. This is the subdivision substrate the mesh runner uses for inter-room contracts + task hand-off. Returns structured JSON; set render=true to also get TTS narration + HTML.',
            inputSchema: {
              type: 'object',
              properties: {
                room: {
                  type: 'string',
                  description: 'The current room/seat to lead with: builder, architect, operator, vault, voice, laboratory, performer, navigator, or network. Defaults to navigator.'
                },
                repo_root: {
                  type: 'string',
                  description: 'Absolute path to the thetadrivencoach repo root. Auto-located via cwd / git if omitted.'
                },
                render: {
                  type: 'boolean',
                  description: 'Also return rendered narration (for premium TTS) + HTML in the response.'
                }
              }
            }
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'thetacog-detect': {
            const result = detectRoom(args.text || '');
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-status': {
            const result = getStatus();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-switch': {
            const result = switchRoom(args.room, args.context || null);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-open': {
            const result = openRoomHtml(args.room || null);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-todo': {
            let result;
            switch (args.action) {
              case 'add':
                result = addTodo(args.room, args.text, args.priority || 5);
                break;
              case 'list':
                result = listTodos(args.room || null);
                break;
              case 'update':
                result = updateTodo(args.id, {
                  done: args.done,
                  priority: args.priority,
                  text: args.text
                });
                break;
              case 'delete':
                result = deleteTodo(args.id);
                break;
              default:
                result = { error: 'Unknown action. Use: add, list, update, delete' };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-stream': {
            let result;
            switch (args.action) {
              case 'send':
                result = sendStream(args.from, args.to, args.message);
                break;
              case 'get':
                result = getStreams(args.to);
                break;
              case 'mark-read':
                result = markStreamsRead(args.to);
                break;
              default:
                result = { error: 'Unknown action. Use: send, get, mark-read' };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-export': {
            const result = exportStateToJson();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    exportedAt: result?.exportedAt,
                    path: path.join(thetacogDir || '~/.thetacog', 'state.json')
                  }, null, 2),
                },
              ],
            };
          }

          case 'thetacog-terminal': {
            const result = detectTerminal();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog_overview': {
            const result = computeOverview({
              daysBack: args?.days_back || 14,
              repoRoot: args?.repo_root || null,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'thetacog-pmu-inspect': {
            const result = dispatchPmuInspect(args || {});
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'pmu_verify': {
            // Reproduce every PMU due-diligence claim by running the repo's
            // scripts/pmu/verify-all.sh. The repo is LOCATED (override via repo_root /
            // THETACOG_REPO_ROOT), not assumed — the Rust daemon + canon aren't bundled.
            const repoRoot = resolvePmuRepoRoot(args?.repo_root || null);
            if (!repoRoot) {
              return { content: [{ type: 'text', text: PMU_REPO_HINT }], isError: true };
            }
            const skipBuild = args?.skip_build === true;
            let output;
            let passed = true;
            try {
              output = execSync(VERIFY_REL, {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, ...(skipBuild ? { SKIP_BUILD: '1' } : {}) },
              });
            } catch (err) {
              // execSync throws on non-zero exit; capture stdout/stderr and report failure.
              passed = false;
              output = `${err.stdout || ''}${err.stderr || ''}\n[exit code ${err.status}]`;
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `repo: ${repoRoot}\n\n${output}`,
                },
              ],
              isError: !passed,
            };
          }

          case 'write_tape_intent': {
            // THE WRITE-LOCK (Phase 1, 100% Cryptographic Attribution): the agent is strictly a
            // writer — this handler appends the pending ledger entry and returns ONLY the cursor.
            // The physics engine is a DETACHED worker (unidirectional state flow: no verification
            // ever runs in the tool that the agent called).
            const { writeTapeIntent, defaultTapePath } = await import(path.join(__dirname, 'scripts', 'pmu', 'tape-intent.mjs'));
            const tape = args?.tape_path || defaultTapePath();
            const out = writeTapeIntent({ intent_text: args?.intent_text, reality_text: args?.reality_text, negative_text: args?.negative_text || '', scenario_tag: args?.scenario_tag, tape });
            // NO worker is spawned here (synchronous lazy evaluation, operator pivot 2026-07-15):
            // read_tape_receipt is the physical trigger — zero background infrastructure, zero races.
            return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: out.status === 'REJECTED' || out.status === 'CATASTROPHIC_FAILURE' };
          }

          case 'vna_sensor': {
            // THE SENSOR — the codebase-vs-intent-document state, on demand.
            //
            // It DRIVES the emitter and computes nothing of its own. scripts/vna/envelope.mjs is
            // the running code: duplicating its placement, its Chebyshev metric or its margin floor
            // here would fork the receipt, and a forked receipt is a second answer to a question
            // that must have exactly one.
            //
            // It also never gates. The spec this serves says "when the Delta flashes red, the
            // system does not stop; it dynamically re-routes the next generation cycle" — so this
            // returns a redirect and an isError only when it genuinely could not look.
            const repoRoot = resolvePmuRepoRoot(args?.repo_root || null);
            if (!repoRoot) {
              return { content: [{ type: 'text', text: PMU_REPO_HINT }], isError: true };
            }
            const envPath = path.join(repoRoot, 'scripts', 'vna', 'envelope.mjs');
            if (!fs.existsSync(envPath)) {
              return { content: [{ type: 'text', text: JSON.stringify({
                status: 'UNAVAILABLE', reason: `envelope emitter not found at ${envPath}`,
                note: '"I did not look" and "I looked and saw nothing" are different claims — this is the first.'
              }, null, 2) }], isError: true };
            }
            try {
              const env = { ...process.env };
              if (args?.spec_path) env.VNA_SPEC = String(args.spec_path);
              if (args?.limit) env.VNA_LIMIT = String(Math.max(1, Math.min(200, Number(args.limit) || 20)));
              const out = execSync(`node ${JSON.stringify(envPath)} --json`, {
                cwd: repoRoot, encoding: 'utf8', env, timeout: 120000, maxBuffer: 1 << 26,
              });
              const j = JSON.parse(out.slice(out.indexOf('{')));
              // Hand back the shape a caller actually steers on, with the fences attached rather
              // than left for the reader to infer.
              const payload = {
                pull: j.pull,
                moveWork: j.moveWork, moveDecl: j.moveDecl,
                declared: j.confident?.length ?? 0,
                abstained: (j.abstained || []).map((a) => ({ id: a.id, text: a.text, margin: a.margin })),
                marginFloor: j.floor, cycleId: j.cycleId,
                unworked: (j.unworked || []).map((u) => ({ id: u.id, coord: u.coord, name: u.name })),
                undeclared: (j.undeclared || []).map((w) => ({ sha: w.sha, coord: w.coord, name: w.name })),
                card: j.card,
                contract: {
                  sufficientFor: 'where the work sits relative to the declaration, re-runnably and with no model in the path',
                  notSufficientFor: 'whether the work was good (Rice), or whether the declaration is the correct half rather than the work',
                  gates: 'none — this emits a redirect after the fact and stops nothing',
                },
              };
              return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
            } catch (e) {
              return { content: [{ type: 'text', text: JSON.stringify({
                status: 'FAILED', reason: String(e.message || e).slice(0, 400),
                note: 'reported rather than answered with a stale or invented state',
              }, null, 2) }], isError: true };
            }
          }

          case 'read_tape_receipt': {
            // THE BINARY GATE: bounded internal poll (hard limit 3 — no unbounded hold, no
            // token-burn loop), then the honest state. filled:true is the ONLY success.
            const { readTapeReceipt, defaultTapePath } = await import(path.join(__dirname, 'scripts', 'pmu', 'tape-intent.mjs'));
            const tape = args?.tape_path || defaultTapePath();
            const wait = Math.min(Math.max(Number(args?.wait_ms) || 4000, 0), 8000);
            const out = await readTapeReceipt({ cursor_id: args?.cursor_id, tape, wait_ms: wait });
            return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: out.status === 'CATASTROPHIC_FAILURE' || out.status === 'UNKNOWN_CURSOR' || out.status === 'REJECTED' };
          }

          case 'thetacog-sign':
          case 'thetacog-verify-licence': {
            // C90 — SIGNED UNDER LICENCE, LOCALLY, BEFORE ANY NOTARY. The server signs nothing itself: it drives
            // scripts/vna/auth-flow.mjs `sign` / `verify-licence` (the one signer, the one verifier) over stdin — bytes and
            // rows never ride argv. The child gets an ALLOWLISTED environment: PATH/HOME and the VNA_ / THETACOG_ / MESH_ /
            // PMU_ receipt paths, plus VNA_ENTITLEMENT_CLAIMS (the licence's PUBLIC claims). Nothing else crosses — the
            // bearer token the extension holds for the notary sync is not read here and cannot reach the signer.
            const repoRoot = resolvePmuRepoRoot(args?.repo_root || null);
            if (!repoRoot) return { content: [{ type: 'text', text: PMU_REPO_HINT }], isError: true };
            const flow = path.join(repoRoot, 'scripts', 'vna', 'auth-flow.mjs');
            if (!fs.existsSync(flow)) return { content: [{ type: 'text', text: JSON.stringify({ status: 'UNAVAILABLE', reason: `signer not found at ${flow}` }) }], isError: true };
            const env = {};
            for (const [k, v] of Object.entries(process.env)) if (k === 'PATH' || k === 'HOME' || k === 'TMPDIR' || k === 'USER' || /^(VNA_|THETACOG_|MESH_|PMU_|LENS_SESSION_ID$|CLAUDE_SESSION_ID$|TERM_PROGRAM$)/.test(k)) env[k] = v;
            const claimsPresent = !!process.env.VNA_ENTITLEMENT_CLAIMS;
            const environment = claimsPresent ? 'VNA_ENTITLEMENT_CLAIMS present — rows are signed under licence' : 'VNA_ENTITLEMENT_CLAIMS absent — rows are signed UNLICENSED (connect the licence in the IDE extension to stamp them)';
            let argv, input;
            if (name === 'thetacog-sign') {
              if (args?.sha) { argv = [flow, 'sign', '--sha', String(args.sha), '--json']; input = ''; }
              else if (typeof args?.bytes === 'string') { argv = [flow, 'sign', '--bytes', '-', '--json']; input = args.bytes; }
              else return { content: [{ type: 'text', text: JSON.stringify({ status: 'USAGE', reason: 'give { sha } or { bytes }' }) }], isError: true };
              if (args?.room) argv.push('--room', String(args.room));
            } else {
              if (!args?.row || typeof args.row !== 'object') return { content: [{ type: 'text', text: JSON.stringify({ status: 'USAGE', reason: 'give { row } — a flight-tape row object' }) }], isError: true };
              argv = [flow, 'verify-licence', '--row', '-', '--json']; input = JSON.stringify(args.row);
            }
            const { spawnSync } = await import('child_process');
            const r = spawnSync('node', argv, { cwd: repoRoot, env, input, encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
            let out = null; try { out = JSON.parse(String(r.stdout || '').trim().split('\n').pop() || 'null'); } catch { out = null; }
            if (!out || (r.status !== 0 && r.status !== 5)) {
              return { content: [{ type: 'text', text: JSON.stringify({ status: 'REFUSED', reason: String(r.stderr || r.stdout || 'the signer answered nothing').slice(0, 600), environment }, null, 2) }], isError: true };
            }
            return { content: [{ type: 'text', text: JSON.stringify({ ...out, environment }, null, 2) }], isError: out.status === 'REFUSED' };
          }

          case 'thetacog-next': {
            // Predict next steps across all rooms from transcripts + repo git-logs
            // + the board. Every room filled (≥2-sentence direction+area); the lead
            // room gets the exhaustive narrative + numbered to-do. The mesh runner
            // consumes this to form inter-room contracts and subdivide tasks.
            const R = runNext({ room: args?.room || 'navigator', repo: args?.repo_root || null });
            const payload = { ...R };
            if (args?.render === true) { payload.narration = renderNarration(R); payload.html = renderHtml(R); }
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async shutdown() {
    console.error('🛑 Shutting down ThetaCog MCP server...');

    // Close SQLite connection
    if (db) {
      try {
        db.close();
        console.error('   ✅ Closed SQLite connection');
      } catch (error) {
        console.error(`   ⚠️  Failed to close SQLite: ${error.message}`);
      }
    }

    console.error('   ✅ Cleanup complete');
    process.exit(0);
  }

  async run() {
    // Initialize database (optional)
    await initDatabase();

    // Start MCP server
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('✅ ThetaCog MCP server v1.0.7 started');
    console.error('   🧠 Mode management, not task management');
    console.error('   📦 SQLite: ' + (db ? 'enabled' : 'memory-only mode'));
    console.error('   🔨 Current room: ' + (currentRoom || 'builder (default)'));

    // Register cleanup handlers for graceful shutdown (copied from CRM pattern)
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGHUP', () => this.shutdown());

    // Handle uncaught errors gracefully
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error.message);
      this.shutdown();
    });
  }
}

// ============================================================================
// STARTUP
// ============================================================================

const server = new ThetaCogServer();
server.run().catch(console.error);
