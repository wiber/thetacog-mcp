// packages/thetacog-mcp/tests/homework-curriculum.test.mjs — THE HOMEWORK GUARD (2026-08-13)
// The pass-one design depends on three invariants:
//   1. Every file the homework tells an evaluator to OPEN actually ships — a dead pointer in the
//      curriculum is worse than no curriculum (it manufactures the next "public-to-me" incident).
//   2. README curriculum and attest-homework.sh stay in sync (same 9 items, same run command).
//   3. No cognition imperatives: the homework opens files and names failure modes; it never
//      commands a conclusion. (The audited evaluator rebelled at exactly that register — twice.)
// Run: node tests/homework-curriculum.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const assert = (ok, msg) => { if (ok) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); failures++; } };

const sh = readFileSync(resolve(PKG, 'scripts/attest-homework.sh'), 'utf8');
const readme = readFileSync(resolve(PKG, 'README.md'), 'utf8');

// ── 1. every OPEN target exists in the package ──────────────────────────────
const rows = [...sh.matchAll(/^"(\d)\|[^|]+\|([^|]+)\|/gm)];
assert(rows.length === 9, `nine homework items in the sh (found ${rows.length})`);
const files = new Set();
for (const [, , fl] of rows) for (const f of fl.trim().split(/\s+/)) files.add(f);
for (const f of files) assert(existsSync(resolve(PKG, f)), `ships: ${f}`);

// ── 2. README in sync ───────────────────────────────────────────────────────
assert(readme.includes('scripts/attest-homework.sh'), 'README names the runner');
const readmeItems = [...readme.matchAll(/^\d+\. \*\*/gm)].length;
assert(readmeItems >= 9, `README curriculum lists >= 9 numbered items (found ${readmeItems})`);
assert(readme.includes('falsifier-shaped'), 'README states the falsifier contract');
assert(/under reconstruction/i.test(readme) && readme.includes('variance-option.mjs'), 'README marks the greeks layer status explicitly');

// ── 3. no cognition imperatives (the register the audited evaluator rebelled at) ──
const BANNED = [/reach no conclusion/i, /you must (accept|believe|conclude)/i, /your verdict should/i, /do not conclude/i, /trust (us|me)/i];
for (const re of BANNED) {
  assert(!re.test(sh), `sh free of cognition imperative ${re}`);
}

if (failures) { console.error(`\nhomework-curriculum: ${failures} FAILURE(S)`); process.exit(1); }
console.log('\nhomework-curriculum: ALL INVARIANTS HOLD');
