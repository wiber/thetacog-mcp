#!/usr/bin/env node
// scripts/pmu/register-surface.mjs — "here is my open-source surface for receipts + tesseract."
//
// The command form of the registration button. A forker who has published their receipts runs:
//
//   npx thetacog-mcp register-surface --url https://github.com/you/your-benchmark-fork \
//        [--receipts tape/] [--name "Your Org"]
//
// What it does (LOCAL ONLY — no network write, ever):
//   1. Records the registration in .thetacog/receipts-surface.json — {surface_url, receipts_path,
//      name, tesseract: true, baseline} where baseline pins the LATEST receipt found locally
//      (the fork-to-activate-the-baseline decision: running + registering IS baseline activation).
//   2. Prints the exact `gh` command that opens a registration PR/issue against the public repo's
//      REGISTRY.md — the human presses enter on it; the tool never posts on anyone's behalf.
//
// Registration is a claim like every other claim here: [self-reported] until the registry row's
// URL resolves anonymously and its receipts recompute. The registry states that on every row.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const url = arg('url');
if (!url || !/^https:\/\//.test(url)) {
  console.error('usage: npx thetacog-mcp register-surface --url https://github.com/<you>/<fork> [--receipts tape/] [--name "Org"]');
  process.exit(1);
}
const receiptsPath = arg('receipts', 'tape/');
const name = arg('name', url.split('/').slice(-2).join('/'));

// baseline: pin the newest local receipt if one exists (activation evidence, kept local)
let baseline = null;
try {
  const dir = resolve(process.cwd(), '.thetacog');
  const cands = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('receipt') && f.endsWith('.json')) : [];
  if (cands.length) {
    baseline = join('.thetacog', cands.sort().pop());
    // PERSIST the activation (the fork-to-activate-baseline decision): the pinned receipt is
    // copied to ~/.thetacog/baseline-receipt.json — what `verify-baseline` compares against.
    const { copyFileSync } = await import('node:fs');
    copyFileSync(resolve(dir, cands.sort().pop()), resolve(os.homedir(), '.thetacog/baseline-receipt.json'));
  }
} catch { /* no local receipts yet — registration still valid, baseline pends first run */ }

const reg = { surface_url: url, receipts_path: receiptsPath, name, tesseract: true, baseline, registered_at: new Date().toISOString(), status: 'self-reported — verifiable when the URL resolves anonymously and the receipts recompute' };
const outDir = resolve(os.homedir(), '.thetacog');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'receipts-surface.json'), JSON.stringify(reg, null, 2));
console.log('✅ recorded → ~/.thetacog/receipts-surface.json');
console.log(JSON.stringify(reg, null, 2));
console.log('\nTo register publicly (you press enter — we never post for you):');
console.log(`  gh issue create --repo wiber/thetacog-mcp --title "registry: ${name}" \\`);
console.log(`     --body "Surface: ${url} · receipts: ${receiptsPath} · tesseract: included · baseline: ${baseline || 'pending first run'}"`);
console.log('\nYour row lands in REGISTRY.md as [self-reported] until a stranger can clone the URL and recompute a receipt.');
