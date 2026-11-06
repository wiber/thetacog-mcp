#!/usr/bin/env node
// packages/thetacog-mcp-vscode/scripts/copy-intentguard-native.mjs — C470 THE VSIX CARRIES THE CARD: copies
// the four C469 platform addons (built at ../IntentGuard/napi/dist/) into this package's native/, so `vsce
// package` ships one .node per (platform, arch) inside the .vsix and src/intentguard/nativeAddon.ts can
// `require()` the right one at runtime with no network and no compile step on the developer's machine.
//
// Run BEFORE `vsce package` — wired into `npm run package` (package.json). Refuses (exit 1) rather than
// silently packaging a stale or partial set: a missing platform means "IntentGuard: Card for Selection"
// on that host reports UNMEASURED with a clear reason, never a JS fallback that reimplements the walk.
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');                                  // packages/thetacog-mcp-vscode
const SRC_DIR = resolve(PKG_ROOT, '..', '..', '..', 'IntentGuard', 'napi', 'dist');
const DEST_DIR = resolve(PKG_ROOT, 'native');

// C771: build.sh (this host only) writes napi/intentguard.<plat>.node, not napi/dist/; --host copies just this host's addon from there
const HOST_DIR = resolve(PKG_ROOT, '..', '..', '..', 'IntentGuard', 'napi');
export const hostId = () => `${process.platform}-${process.arch}`;

export const REQUIRED = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];

export function fileNameFor(id) { return `intentguard.${id}.node`; }

export function copyIntentGuardNative({ srcDir = SRC_DIR, destDir = DEST_DIR, required = REQUIRED } = {}) {
    const missing = [];
    const copied = [];
    if (!existsSync(srcDir)) {
        return { ok: false, reason: `no ${srcDir} — build ../IntentGuard/napi/build-all.sh first`, copied, missing: required };
    }
    mkdirSync(destDir, { recursive: true });
    for (const id of required) {
        const name = fileNameFor(id);
        const from = join(srcDir, name);
        const to = join(destDir, name);
        if (!existsSync(from)) { missing.push(name); continue; }
        copyFileSync(from, to);
        copied.push(name);
    }
    if (missing.length) {
        return { ok: false, reason: `missing from ${srcDir}: ${missing.join(', ')}`, copied, missing };
    }
    return { ok: true, copied, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const host = process.argv.includes('--host');   // C771: only this host's addon, read from napi/ (build.sh's output) or dist/ when it holds it
    // --src <dir> (or INTENTGUARD_NAPI_DIR): read the addon from a build that did not land in ../IntentGuard — a box where the
    // clone is read-only builds the carve in a scratch dir (node scripts/intentguard/carve.mjs --out <dir> && <dir>/napi/build.sh)
    // and names that dir here. Without it the default places stand; a named dir that lacks the host's .node still REFUSES.
    const srcArg = process.argv.indexOf('--src') >= 0 ? process.argv[process.argv.indexOf('--src') + 1] : process.env.INTENTGUARD_NAPI_DIR;
    const srcOverride = srcArg ? resolve(srcArg) : null;
    const hostSrc = srcOverride || (existsSync(join(SRC_DIR, fileNameFor(hostId()))) ? SRC_DIR : HOST_DIR);
    const result = host ? copyIntentGuardNative({ srcDir: hostSrc, required: [hostId()] }) : copyIntentGuardNative(srcOverride ? { srcDir: srcOverride } : {});
    if (!result.ok) {
        console.error(`copy-intentguard-native: REFUSED — ${result.reason}`);
        process.exit(1);
    }
    console.log(`copy-intentguard-native: copied ${result.copied.length}/${host ? 1 : REQUIRED.length} → ${DEST_DIR}`);
    for (const f of readdirSync(DEST_DIR)) console.log(`  native/${f}`);
}
