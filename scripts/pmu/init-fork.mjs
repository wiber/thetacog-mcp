#!/usr/bin/env node
// scripts/pmu/init-fork.mjs — turn a fork of the benchmark repo into YOUR receipts surface.
//
//   (fork wiber/thetacog-mcp on GitHub, clone your fork, cd into it, then:)
//   npx thetacog-mcp init-fork
//
// One fork per tracked project per deployer — few things are as permanent as git open source,
// and the panels and deltas are small. What this does, additively and locally (no network):
//   1. Detects your fork identity from `git remote get-url origin`.
//   2. Replaces fork #0's tape (the vendor's panels) with YOUR empty, ready tape:
//      tape/panels/ cleared · tape/series.ndjson reset · tape/MANIFEST.md rewritten with your
//      identity and the same recompute contract. (The vendor's tape stays permanent upstream.)
//   3. Prints the loop: run the instrument on your commits -> panels/receipts append to tape/
//      -> commit (git IS the publication) -> `npx thetacog-mcp register-surface --url <fork>`.
//
// Refuses to run inside the upstream repo (fork #0's tape is never cleared by tooling).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const cwd = process.cwd();
let origin = '';
try { origin = execSync('git remote get-url origin', { cwd }).toString().trim(); } catch { /* not a git repo */ }
if (!origin) { console.error('✗ not a git repo with an origin remote — clone YOUR FORK first, then run init-fork inside it.'); process.exit(1); }
if (/wiber\/(thetacog-mcp|thetadrivencoach)/.test(origin)) { console.error('✗ this is the UPSTREAM repo — fork #0\'s tape is permanent. Fork it on GitHub, clone your fork, run init-fork there.'); process.exit(1); }
if (!existsSync(resolve(cwd, 'tape'))) { console.error('✗ no tape/ here — is this a fork of wiber/thetacog-mcp?'); process.exit(1); }

const panelsDir = resolve(cwd, 'tape/panels');
let cleared = 0;
if (existsSync(panelsDir)) for (const f of readdirSync(panelsDir)) { if (f.endsWith('.png')) { rmSync(resolve(panelsDir, f)); cleared++; } }
mkdirSync(panelsDir, { recursive: true });
writeFileSync(resolve(cwd, 'tape/series.ndjson'), '');
writeFileSync(resolve(cwd, 'tape/MANIFEST.md'), `# THE TAPE — ${origin.replace(/\.git$/, '')}

This fork is this deployer's receipts surface for ONE tracked project — the vendor's own tape
(fork #0) stays permanent upstream at wiber/thetacog-mcp. Same contract, your receipts:

- \`panels/\` — one tolerance-panel PNG per tracked commit, named by the commit sha that
  produced it; each a deterministic, LLM-free function of that commit, recomputable by any
  stranger with the shipped walker.
- \`series.ndjson\` — this project's running measurement series (starts empty; every tracked
  commit appends a row; append-only, never rewritten).

The loop: run the instrument against your tracked project -> panels + series rows land here ->
\`git commit\` (git IS the publication; the diffs are small and close to permanent) ->
\`npx thetacog-mcp register-surface --url ${origin.replace(/\.git$/, '')}\`.
Absent data reads UNMEASURED, never a pass. Rows in the upstream REGISTRY.md are
[self-reported] until this URL resolves anonymously and a receipt recomputes.
`);
console.log(`✅ fork initialized as your receipts surface (${origin})`);
console.log(`   cleared ${cleared} vendor panel(s) · tape/MANIFEST.md rewritten · series reset`);
console.log('\nThe loop from here:');
console.log('  1. run the instrument on your tracked project (npx thetacog-mcp attest-demo to start)');
console.log('  2. append panels + series rows to tape/ and git commit — the publication IS the commit');
console.log(`  3. npx thetacog-mcp register-surface --url ${origin.replace(/\.git$/, '')}`);
