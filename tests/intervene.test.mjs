// packages/thetacog-mcp/tests/intervene.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// THE PORTABLE INTERVENTION-LOOP GUARD (operator 2026-07-11: "implement this in the os npx repo...
// sensemaking and self improvement - not just storytelling"). Invariants mirror the monorepo's
// tests/ops/intervention-fire.test.js, adapted to the package's README-as-spec substrate:
//   1. reality is read from the IMMUTABLE commit (git show <sha>:<file>), never the mutable tree.
//   2. the countable event is appended BEFORE any model runs; dedup per sha.
//   3. the LLM is model-pinned + time-bounded + env-scrubbed; facts-only fallback; INTERVENE_OFF flag.
//   4. the prompt is maximal-context (full message · bounded diff · receipt facts · spec excerpt ·
//      prior lessons WITH measured outcomes) and asks the full question set (semantic pull ·
//      boundary class · missing guard · reef-vs-walk pct · dictionary adds · mechanical payload).
//   5. the loop closes MEASURED, never self-graded: drift-history trend + gzip dictionary ablation,
//      written back into the story; the LLM is told not to invent improvement numbers.
//   6. registered as an npx subcommand with the caller's cwd preserved; hook example is detached;
//      install-hooks arms it; bundle-pmu ships it.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// canonical home is the MONOREPO's scripts/pmu (the package copy is bundle-generated at prepack);
// fall back to the bundled copy so the guard also runs against a packed tree.
const SRC_PATH = [resolve(PKG, '../../scripts/pmu/intervene.mjs'), resolve(PKG, 'scripts/pmu/intervene.mjs')].find(existsSync);
const SRC = readFileSync(SRC_PATH, 'utf8');

test('1. reality from the immutable commit, never the working tree', () => {
  assert.match(SRC, /git\('show', `\$\{sha\}:\$\{f\}`\)/);
});

test('2. count before any model, dedup per sha', () => {
  const countIdx = SRC.indexOf('COUNT (dedup per sha, before any model)');
  const llmIdx = SRC.indexOf('const j = sensemake(');
  assert.ok(countIdx > -1 && llmIdx > -1 && countIdx < llmIdx, 'event append must precede the LLM call');
  assert.match(SRC, /some\(e => e\.sha === shaShort\)/);
});

test('3. LLM pinned + bounded + scrubbed + optional', () => {
  assert.match(SRC, /--model', 'claude-sonnet-5/);
  assert.match(SRC, /timeout: 240_000/);
  assert.match(SRC, /\(CLAUDE\|ANTHROPIC\)/);                     // nested-session env scrub
  assert.match(SRC, /sensemaking unavailable — facts-only intervention/);
  const hook = readFileSync(resolve(PKG, 'hooks/intervention-fire.example'), 'utf8');
  assert.match(hook, /INTERVENE_OFF/);
  assert.match(hook, /nohup npx thetacog-mcp intervene/);         // detached — never blocks the commit
});

test('4. the prompt is maximal-context with the full question set', () => {
  for (const marker of [
    'COMMIT MESSAGE (full', 'DIFF (bounded', 'THE SPEC (README-as-spec',
    'PRIOR INTERVENTIONS', 'MEASURED OUTCOME',
    'semantic_pull', 'boundary_failure', 'intent_reality_gap', 'missing_guard',
    'reef_signal_pct', 'walk_utilization', 'compression_dictionary_adds',
    'file_movements', 'configuration_updates', 'insurability',
  ]) assert.ok(SRC.includes(marker), `prompt must carry: ${marker}`);
});

test('5. the loop closes measured, never self-graded', () => {
  assert.match(SRC, /drift-history\.ndjson/);
  assert.match(SRC, /verifyStories/);
  assert.match(SRC, /gzipSync/);                                   // the dictionary ablation is real gzip
  assert.match(SRC, /do NOT invent a drift-improvement number/);
  assert.match(SRC, /verifyStories\(\);\s+\/\/ each fire closes the loop/);
});

test('6. registered as npx subcommand (cwd preserved), armed by install-hooks, shipped by bundle-pmu', () => {
  const server = readFileSync(resolve(PKG, 'server.js'), 'utf8');
  assert.match(server, /'intervene', 'scripts\/pmu\/intervene\.mjs'/);
  assert.match(server, /cmd === 'intervene' \? process\.cwd\(\)/);
  const install = readFileSync(resolve(PKG, 'bin/install-hooks.sh'), 'utf8');
  assert.match(install, /--interventions/);
  assert.match(install, /intervention-fire\.example/);
  const bundle = readFileSync(resolve(PKG, 'scripts/bundle-pmu.mjs'), 'utf8');
  assert.match(bundle, /'intervene\.mjs'/);
});
