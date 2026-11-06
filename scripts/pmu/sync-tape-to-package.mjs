#!/usr/bin/env node
// scripts/pmu/sync-tape-to-package.mjs — wire the PRODUCTION tape into the open-source surface.
//
// Copies the per-commit tolerance panels (docs/pmu/commit-panels/*.png) and the measurement
// series (.thetacog/autotick-series.ndjson) into packages/thetacog-mcp/tape/ — the public
// repo's fork-#0 receipt tape. ADDITIVE ONLY: never deletes a panel (the tape is append-only
// by definition); the series file is replaced wholesale (it is itself append-only upstream).
//
// Safe by construction: read-only on production paths, writes only under packages/thetacog-mcp/tape/.
// Run manually or from the punch-list; NEVER wired into a hook without an explicit ask.
//
// Run: node scripts/pmu/sync-tape-to-package.mjs

import { readdirSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_PANELS = resolve(REPO, 'docs/pmu/commit-panels');
const SRC_SERIES = resolve(REPO, '.thetacog/autotick-series.ndjson');
const DST = resolve(REPO, 'packages/thetacog-mcp/tape');
const DST_PANELS = resolve(DST, 'panels');

mkdirSync(DST_PANELS, { recursive: true });
let copied = 0, skipped = 0;
for (const f of readdirSync(SRC_PANELS)) {
  if (!f.endsWith('.png')) continue;
  const dst = resolve(DST_PANELS, f);
  if (existsSync(dst) && statSync(dst).size === statSync(resolve(SRC_PANELS, f)).size) { skipped++; continue; }
  copyFileSync(resolve(SRC_PANELS, f), dst);
  copied++;
}
if (existsSync(SRC_SERIES)) copyFileSync(SRC_SERIES, resolve(DST, 'series.ndjson'));
// the META-MAP: the newest encircled panel IS the front-page coordinate — refresh it with the tape
const enc = readdirSync(SRC_PANELS).filter((f) => f.endsWith('-encircled.png')).map((f) => ({ f, m: statSync(resolve(SRC_PANELS, f)).mtimeMs, s: statSync(resolve(SRC_PANELS, f)).size })).sort((a, b) => b.m - a.m);
// meta-map = the DENSEST of the 20 newest encircled panels (recent AND legible — a near-empty
// encircled render is a calm commit, good news but a poor billboard; density picks the panel
// with the most drawn regions while staying current). Same walk-generated PNG rule as ever.
const pick = enc.slice(0, 20).sort((a, b) => b.s - a.s)[0] || enc[0];
if (pick) copyFileSync(resolve(SRC_PANELS, pick.f), resolve(DST, 'meta-map.png'));
console.log(`tape-sync: ${copied} panel(s) copied, ${skipped} unchanged, series refreshed → packages/thetacog-mcp/tape/`);
