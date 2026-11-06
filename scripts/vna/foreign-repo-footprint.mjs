#!/usr/bin/env node
// scripts/vna/foreign-repo-footprint.mjs — ONE RULE: RECORD vs REGENERABLE for everything the engine writes under a
// stranger's VNA_REPO (AXIOM 1: evict-or-retain, never free; the proxy-is-not-the-thing).
//
// Incident this exists to prevent: a stranger's Claude read .thetacog/, data/vna/ and docs/specs/vna/ in their repo
// as one undifferentiated blob of "generated files" and proposed deleting all three — which would have discarded
// the credits ledger, the flight tape and the receipts alongside the actual caches and rendered pages. The product's
// value in that directory IS a record the actor did not write (W2); a cache sitting one level away from it is not
// the same kind of thing, and the two must never be collapsed into one delete.
//
//   RECORD       — a ledger, a receipt, the tape, a ratchet floor, a licence claim, or the user's own hand-authored
//                  spec. Never auto-deleted, never auto-.gitignore'd. A candidate for `git add` if the operator
//                  wants history of it in the repo.
//   REGENERABLE  — a rendered page, a payload, or a cache: re-running the same `npx thetacog-mcp <door>` on the
//                  same commit reproduces it. Safe to .gitignore; safe to delete.
//   null         — unclassified. A path under the three roots this module does not yet name. NEVER auto-ignored,
//                  NEVER auto-deleted — AXIOM 1's default is retain, not evict, for anything this module can't
//                  account for.
//
// THE PROXY IS NOT THE THING, applied to this module itself: classification is read off what the WRITER'S OWN CODE
// calls the path (a MASS_CACHE_DIR constant, an appendFileSync vs a writeFileSync-every-run), never off what a
// filename or a sentence in conversation calls it. The one caught case: `.thetacog/aperture-mass` reads in English
// as "the aperture-mass receipt" and is in fact `MASS_CACHE_DIR` in aperture-receipt.mjs — a cache wearing a
// receipt-shaped name. It is classified REGENERABLE here, against the name, because the directory rule (any path
// with a `cache` segment) wins over every other rule including a filename that contains "receipt".
//
// Pure leaf module: node:fs + node:path only. Deliberately does NOT import door-cmd.mjs (which imports callers that
// import this module back — a cycle) or steer-ui.mjs (3000+ lines, its own import graph). door-cmd.mjs calls
// `ensureForeignRepoFootprint(repo)` from `targetRepo()`, passing the repo it already resolved; this module never
// resolves VNA_REPO itself.
//
// @guard tests/vna/foreign-repo-footprint.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const ROOTS = Object.freeze(['.thetacog', 'data/vna', 'docs/specs/vna']);

const RECORD = 'RECORD';
const REGEN = 'REGENERABLE';

// Ground-truthed per-path overrides. A directory key (no file extension on the last segment) covers every path
// under it. Checked in insertion order; the first (longest-named, most specific) match wins over the generic
// fallback rules below.
const EXPLICIT = new Map(Object.entries({
  // ── docs/specs/vna — the spec is hand-authored; its render, its payloads and its pages are not ────────────────
  'docs/specs/vna/SPEC-VNA-COCKPIT.md': RECORD,          // THE USER'S SPEC
  'docs/specs/vna/amendments.ndjson': RECORD,            // the spec-edit history
  'docs/specs/vna/RESEARCH-BUNDLE.txt': RECORD,          // user-curated clip bundle — not re-derivable from the commit alone
  'docs/specs/vna/versions': RECORD,                     // spec-render.mjs's own comment: "the immutable snapshot of what v<N> actually said" — vN-*.html/.md
  'docs/specs/vna/versions/latest.html': REGEN,          // a pointer copy of the highest vN already retained above — override of the directory rule just above
  'docs/specs/vna/PAYLOAD.txt': REGEN,
  'docs/specs/vna/COCKPIT-PAYLOAD.txt': REGEN,
  'docs/specs/vna/PREVIEW-PAYLOAD.txt': REGEN,
  'docs/specs/vna/steer': REGEN,                         // steer/latest.html — RENDER_WRITES, steer-ui.mjs's own page
  'docs/specs/vna/turns': REGEN,                         // turns/latest.html, turns/preview-latest.html — cockpit.mjs's own page
  'docs/specs/vna/ONBOARDING-STEPS.md': REGEN,

  // ── .thetacog — ledgers, the tape, the licence claim, the mesh ledger are RECORD; caches, locks, flags are not ──
  '.thetacog/credits-local.ndjson': RECORD,              // "the local credits ledger — the number that ticks down per stamped row" (flight-tape.mjs)
  '.thetacog/walk-tape.ndjson': RECORD,                  // the tape
  '.thetacog/runner.ndjson': RECORD,
  '.thetacog/vna-seed.ndjson': RECORD,
  '.thetacog/vna-fold-dispatch.ndjson': RECORD,
  '.thetacog/vna-steer-surfaced.ndjson': RECORD,
  '.thetacog/vna-clip-outbound.ndjson': RECORD,
  '.thetacog/vna-clip-ingest.ndjson': RECORD,
  '.thetacog/vna-steer-file.json': RECORD,               // what the operator dictated into the bridge card — not re-derivable
  '.thetacog/entitlement-claims.json': RECORD,           // the only local, non-secret trace of a claimed licence (per-machine)
  '.thetacog/lens-receipts': RECORD,                     // per-prompt receipts — the AXIOM1 debt named in CLAUDE.md, never silently swept
  '.thetacog/mesh': RECORD,                              // mesh/ledger.ndjson — the append-only signed mesh ledger
  '.thetacog/chat/session.ndjson': RECORD,
  '.thetacog/chat/cot.ndjson': RECORD,
  '.thetacog/audio/builds.ndjson': RECORD,
  '.thetacog/backup': RECORD,                            // *.upload.json — proof an upload actually happened; not re-creatable by re-running
  '.thetacog/aperture-mass': REGEN,                      // MASS_CACHE_DIR in aperture-receipt.mjs — a cache despite the "mass" / "receipt" sound of it
  '.thetacog/cache': REGEN,                              // the directory name IS the contract — wins over every other rule
  '.thetacog/steer-writers.json': REGEN,                 // RENDER_WRITES — steer-ui.mjs's own "who touched what" cache, recomputed every paint
  '.thetacog/vna-clear-gauge.json': REGEN,
  '.thetacog/vna-asked-vs-built.json': REGEN,
  '.thetacog/lens-encircled/latest.json': REGEN,         // THE RECEIPT IS LLM-FREE: a pure reproducible function of the commit
  '.thetacog/lens-encircled/latest.png': REGEN,
  '.thetacog/vna-clip.armed': REGEN,
  '.thetacog/audio/armed': REGEN,
  '.thetacog/audio/daemon.json': REGEN,
  '.thetacog/current-room': REGEN,
  '.thetacog/runner/pids': REGEN,
  '.thetacog/runner/scratch': REGEN,

  // ── data/vna — a ratchet floor is cross-run memory (RECORD); every other render receipt here is a pure ────────
  // ── recomputation from the current commit + the ledgers above (REGENERABLE), unless it is itself an append log ─
  'data/vna/flight-tape.ndjson': RECORD,                 // the tape (data/vna copy)
  'data/vna/cog.ndjson': RECORD,                         // "the card reads usage rows on every paint" — a log, not a one-shot render
  'data/vna/cog-discrepancy.ndjson': RECORD,
  'data/vna/cog-turns.ndjson': RECORD,
  'data/vna/notary-witness.ndjson': RECORD,
  'data/vna/suite-health.ndjson': RECORD,
  'data/vna/loop-health.ndjson': RECORD,
  'data/vna/regime-floors.json': RECORD,                 // a ratchet floor — "floor only rises"
  'data/vna/panel-signal-floor.json': RECORD,
  'data/vna/aperture-receipt.json': RECORD,              // the signed aperture receipt itself
  'data/vna/aperture-receipt-preview.json': RECORD,
  'data/vna/mesh.json': REGEN,
  'data/vna/cockpit.json': REGEN,
  'data/vna/cockpit-preview.json': REGEN,
  'data/vna/envelope.json': REGEN,
  'data/vna/alignment-map.json': REGEN,
  'data/vna/competence-pixel.json': REGEN,
  'data/vna/parametric-trigger.json': REGEN,
  'data/vna/severity-status.json': REGEN,
  'data/vna/story.json': REGEN,
  'data/vna/underwriting.json': REGEN,
  'data/vna/spec-tree.json': REGEN,                      // a parse of the spec md, not an event log, despite the .json
  'data/vna/spec-tree-roots.ndjson': REGEN,              // ditto — a parse, not a log, despite the .ndjson
  'data/vna/goal.json': REGEN,
  'data/vna/tesseract-state.json': REGEN,
  'data/vna/labour-rate.json': REGEN,
  'data/vna/cog-weights.json': REGEN,
  'data/vna/cog-peg.json': REGEN,                        // a rollup of cog.ndjson, not the ledger itself
  'data/vna/loop-health.json': REGEN,                    // a rollup of loop-health.ndjson, not the log itself
  'data/vna/notary-price.json': REGEN,
  'data/vna/token-savings.json': REGEN,                  // a rollup of steer-ab-tokens.ndjson (RECORD by the default rule below)
}));

// Directory-segment and suffix fallbacks for anything NOT named above. Checked in this order; the first match wins.
const CACHE_SEGMENT = /(^|\/)cache(\/|$)/;
const FLOOR_FILE = /-floors?\.json$/;                    // a ratchet floor is cross-run memory, never a one-shot render
const OPERATIONAL = /\.(lock|sock|pid|armed)$/;          // nothing to lose — a flag or a socket, not a record of anything

/** RECORD | REGENERABLE | null for a path relative to the repo root. null = not one of the three roots, or unclassified. */
export function classify(relPath) {
  const p = String(relPath).replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (!ROOTS.some((r) => p === r || p.startsWith(r + '/'))) return null;
  for (const [known, verdict] of EXPLICIT) {
    if (p === known || p.startsWith(known + '/')) return verdict;
  }
  if (CACHE_SEGMENT.test(p)) return REGEN;
  if (OPERATIONAL.test(p) || /\.lock\//.test(p)) return REGEN;
  if (FLOOR_FILE.test(p)) return RECORD;
  if (p.endsWith('.ndjson')) return RECORD;              // default for an append log under these roots: retain, don't guess
  if (p.endsWith('.html')) return REGEN;                 // a rendered page
  return null;                                           // unclassified — never auto-ignored, never auto-deleted
}

/** every path this module names explicitly, with its verdict — for the guard and for `node foreign-repo-footprint.mjs --list` */
export function knownPaths() {
  return [...EXPLICIT.entries()].map(([path, verdict]) => ({ path, verdict })).sort((a, b) => a.path.localeCompare(b.path));
}

/** the REGENERABLE subset — exactly what the .gitignore block lists */
export function regenerablePaths() {
  return knownPaths().filter((r) => r.verdict === REGEN).map((r) => r.path);
}

/** the RECORD subset — never written to .gitignore, never deleted by this module or anything it calls */
export function recordPaths() {
  return knownPaths().filter((r) => r.verdict === RECORD).map((r) => r.path);
}

const BLOCK_START = '# >>> thetacog-foreign-repo-footprint (generated; do not edit by hand — scripts/vna/foreign-repo-footprint.mjs) >>>';
const BLOCK_END = '# <<< thetacog-foreign-repo-footprint <<<';

function blockBody() {
  const lines = [
    '# Regenerable output of the ThetaCog engine (npx thetacog-mcp <door>): rendered pages, payloads and caches —',
    '# reproducible by re-running the same door on this commit. The ledgers, receipts and the tape are deliberately',
    '# NOT listed here and are NOT safe to delete — see .thetacog/README.md.',
    ...regenerablePaths(),
  ];
  return lines.join('\n');
}

/** idempotent: writes the block once, updates its body in place on a later run (new regenerable paths get added),
 * never duplicates it, never touches a line outside it. Creates .gitignore if absent. */
function writeGitignoreBlock(repo) {
  const file = resolve(repo, '.gitignore');
  const body = blockBody();
  const block = `${BLOCK_START}\n${body}\n${BLOCK_END}`;
  if (!existsSync(file)) { writeFileSync(file, block + '\n'); return; }
  const text = readFileSync(file, 'utf8');
  const startIdx = text.indexOf(BLOCK_START);
  const endIdx = text.indexOf(BLOCK_END);
  if (startIdx === -1 || endIdx === -1) {
    const sep = text.length && !text.endsWith('\n') ? '\n' : '';
    writeFileSync(file, text + sep + (text.length ? '\n' : '') + block + '\n');
    return;
  }
  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + BLOCK_END.length);
  const next = before + block + after;
  if (next !== text) writeFileSync(file, next);
}

const README = `# .thetacog/ — what this directory is

This directory was created by the ThetaCog engine (\`npx thetacog-mcp <door>\`) while reading and measuring this
repo. It is not part of your application — nothing in here is required to build, test or ship your code.

Two kinds of files live here, and they are not interchangeable:

RECORD — keep these. They are a ledger, a receipt, or the tape: a history the engine cannot recompute because it
already happened (credits spent, a licence claimed, a run that occurred). Deleting one loses that history for
good. Examples: .thetacog/credits-local.ndjson (the credits ledger), .thetacog/entitlement-claims.json (the licence
claim), .thetacog/walk-tape.ndjson (the tape).

REGENERABLE — safe to delete, already in .gitignore. These are rendered pages, payloads and caches: re-running the
same \`npx thetacog-mcp <door>\` command on the same commit reproduces them. Examples: .thetacog/cache/,
.thetacog/aperture-mass/.

If you are tidying this repo or freeing disk space: delete the REGENERABLE paths freely. Leave the RECORD paths
alone, or ask before removing them — they are the one part of this directory whose value cannot be rebuilt by
running the engine again.

The rule that classifies a new path, and the full list: scripts/vna/foreign-repo-footprint.mjs in the thetacog-mcp
package.
`;

function writeReadme(repo) {
  const file = resolve(repo, '.thetacog', 'README.md');
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, README);
}

const _ensured = new Set();   // per-process memo — cheap even when called on every targetRepo()

/** Run once per repo, cheaply: the .gitignore block (create-or-update) + .thetacog/README.md (create-if-absent).
 * The caller (door-cmd.mjs's targetRepo()) is responsible for never calling this at home. */
export function ensureForeignRepoFootprint(repo) {
  if (!repo || _ensured.has(repo)) return;
  _ensured.add(repo);
  try { mkdirSync(repo, { recursive: true }); } catch {}
  writeGitignoreBlock(repo);
  writeReadme(repo);
}

if (process.argv[1] && process.argv[1].endsWith('foreign-repo-footprint.mjs') && process.argv.includes('--list')) {
  for (const { path, verdict } of knownPaths()) console.log(`${verdict.padEnd(12)} ${path}`);
}
