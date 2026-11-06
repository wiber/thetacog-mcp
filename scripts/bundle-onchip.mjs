#!/usr/bin/env node
// packages/thetacog-mcp/scripts/bundle-onchip.mjs — the package ships pmu-onchip for every platform, not only this Mac's.
// Copies each leg scripts/pmu/build-onchip-all.sh built into <package>/.thetacog/pmu/target/dist/ (already in "files", so
// npm and the vsix engine both carry it). A leg ships only when shippableOnchips() finds it current against the crate;
// a stale or missing leg is printed with its reason and left out, so that platform reads UNMEASURED and never runs old code.
// Runs in prepack, after bundle-pmu.mjs.
// @guard tests/pmu-simulator/onchip-every-platform.test.mjs
import { copyFileSync, mkdirSync, rmSync, renameSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shippableOnchips } from '../../../scripts/pmu/onchip-source-stamp.mjs';
import { ONCHIP_DIST_REL } from '../../../src/lib/pmu/pmu-binary.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function bundleOnchip({ pkg = PKG, log = console.log } = {}) {
  const out = join(pkg, ONCHIP_DIST_REL);
  rmSync(out, { recursive: true, force: true });   // a leg that stopped being current must not linger from the last pack
  mkdirSync(out, { recursive: true });
  const { ok, skipped } = shippableOnchips();
  for (const { id, path } of ok) {
    const to = join(out, `pmu-onchip.${id}`);
    copyFileSync(path, `${to}.tmp`); chmodSync(`${to}.tmp`, 0o755); renameSync(`${to}.tmp`, to);   // new inode (Mach-O signature cache)
  }
  log(`· onchip: shipped ${ok.map((o) => o.id).join(', ') || 'none'}`);
  for (const s of skipped) log(`  UNMEASURED ${s.id}: ${s.why}`);
  return { ok: ok.map((o) => o.id), skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) bundleOnchip();
