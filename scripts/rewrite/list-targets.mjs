#!/usr/bin/env node
// Tiny helper: print what scripts/rewrite.sh is willing to open.
import { listTargets } from './resolve-target.mjs';
import path from 'node:path';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const t = listTargets(REPO);
console.log('CHAPTERS');
for (const c of t.chapters) console.log(`  ${c.number != null ? `chapter ${c.number}`.padEnd(12) : ''.padEnd(12)} ${c.label}`);
console.log(`\nRECENT BLOG (${t.blog.length}) · SCRATCHPAD (${t.scratchpad.length}) — pass a slug fragment or a path`);
