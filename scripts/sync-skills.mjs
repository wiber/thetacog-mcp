#!/usr/bin/env node
// packages/thetacog-mcp/scripts/sync-skills.mjs — C1220: the shipped skills/<name>/SKILL.md are DERIVED, each from the one monorepo file
// SKILL_SOURCES names (lib/install-skills.mjs: /steer from the vsix's stranger-safe copy, /tend from .claude/skills/tend). prepack runs
// this first, so a skill edited at its source can never ship stale (the home /tend moved on 10-21 and c1113 went red with the package
// copy behind it). Outside the monorepo (a published tarball) there is no source to read, and this exits 0 having copied nothing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_SOURCES } from '../lib/install-skills.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MONO = resolve(PKG, '..', '..');
let n = 0;
for (const [name, rel] of Object.entries(SKILL_SOURCES)) {
  const src = join(MONO, rel); const dst = join(PKG, 'skills', name, 'SKILL.md');
  if (!existsSync(src)) continue;
  const a = readFileSync(src); let b = null; try { b = readFileSync(dst); } catch { b = null; }
  if (!b || !a.equals(b)) { mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, a);   // a skill new to SKILL_SOURCES has no folder yet (C2170c)
    n++; console.log(`sync-skills: skills/${name}/SKILL.md ← ${rel}`); }
}
if (!n) console.log('sync-skills: skills/ already match their sources');
