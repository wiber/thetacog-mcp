#!/usr/bin/env node
// scripts/pmu/publish-commit.mjs — the npx option: publish a commit's drift-receipt triptych as a
// PUBLIC, SEO-indexable page under public/commit/<sha>/ (no email sent).
//
//   npx thetacog-mcp publish-commit [--commit <sha>] [--no-open]
//
// Thin wrapper: runs commit-triptych.mjs with --publish (and --no-email/--no-open) so the full rust
// render pipeline produces the panels, then publish-commit-page.mjs writes the page + PNGs. Defaults to
// HEAD. See scripts/pmu/publish-commit-page.mjs for the page writer and commit-triptych.mjs for the
// --publish path.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const triptych = path.join(here, 'commit-triptych.mjs');

// Forward the user's args; force --publish + --no-open, never --email.
const passthru = process.argv.slice(2).filter((a) => a !== '--email');
const args = [triptych, '--publish', '--no-open', ...passthru];
if (!passthru.includes('--commit')) args.push('--commit', 'HEAD');

const r = spawnSync('node', args, { stdio: 'inherit' });
process.exit(r.status ?? 0);
