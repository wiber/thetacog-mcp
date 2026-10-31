// packages/thetacog-mcp-vscode/src/intentguard/nativeAddon.ts — C470 THE VSIX CARRIES THE CARD: the ONE
// place the extension resolves the C469 IntentGuard napi addon it ships under native/ (copied in by
// scripts/copy-intentguard-native.mjs, wired before `vsce package`). Mirrors the resolution discipline of
// the server's src/lib/intentguard/addon.mjs (C465) — never throws on absence, never falls back to a JS or
// child-process reimplementation of the walk. A missing or unloadable addon is a fact the caller turns into
// an UNMEASURED message, never a guess.
//
// Kept a plain module (no `vscode` import) so it can be required from the extension host AND imported by a
// node:test guard with neither a running VS Code instance nor a mocked `vscode` module.
//
// @guard tests/c470-intentguard-card-in-vsix.test.mjs
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

/** The napi addon filename for a given (or the current) platform/arch — same shape as ../IntentGuard's own. */
export function addonFileName(platform: string = process.platform, arch: string = process.arch): string {
    return `intentguard.${platform}-${arch}.node`;
}

export interface LoadedNativeAddon {
    addon: any;
    path: string;
    reason?: undefined;
}

export interface UnmeasuredNativeAddon {
    addon: null;
    path?: undefined;
    reason: string;
}

/**
 * Resolves and requires the napi addon bundled at `<extensionPath>/native/intentguard.<platform>-<arch>.node`.
 * Returns { addon, path } on success or { addon: null, reason } — NEVER throws.
 */
export function loadNativeAddon(
    extensionPath: string,
    platform: string = process.platform,
    arch: string = process.arch,
): LoadedNativeAddon | UnmeasuredNativeAddon {
    const name = addonFileName(platform, arch);
    // resolve(), never join(): a relative extensionPath (a test's temp dir, say) must still produce an
    // ABSOLUTE path — require() of a bare relative string ("native/x.node") is a MODULE NAME lookup, not
    // a file path, and fails with a confusing "Cannot find module" even when existsSync() found the file.
    const filePath = resolve(extensionPath, 'native', name);
    if (!existsSync(filePath)) {
        return {
            addon: null,
            reason: `UNMEASURED: no native IntentGuard addon at ${filePath} — run "npm run package" (scripts/copy-intentguard-native.mjs) or build ../IntentGuard/napi/build-all.sh, then reload the window`,
        };
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const addon = require(filePath);
        return { addon, path: filePath };
    } catch (e: any) {
        return { addon: null, reason: `UNMEASURED: ${filePath} failed to load: ${e && e.message ? e.message : e}` };
    }
}

/** sha256 of the receipt's PAYLOAD line only (before the first '\n') — same slice src/lib/intentguard/door.mjs signs over. */
export function payloadSha256(receipt: Buffer): string {
    const nl = receipt.indexOf(0x0a);
    const payload = nl < 0 ? receipt : receipt.subarray(0, nl);
    return createHash('sha256').update(payload).digest('hex');
}

// ---------------------------------------------------------------------------------------------------------
// C741/C749 THE HUD DOOR: hudReading(windowText) returns the SAME JSON shape the `reading` event of
// `pmu-onchip --hud-serve` carries ({cells, walk, result, ...}) from ONE of two engines, named on the reading as
// walk.engine: 'napi' (the addon's hudReading binds the crate fn intentguard::hud::reading(text, config_json), the
// SAME code path the server runs) | 'node' (spawn scripts/vna/hud-read.mjs --once, which spawns
// `pmu-onchip --hud-serve`) | 'UNMEASURED' (neither ran; walk.why says why). There is one way to run it and it is
// the crate's. The contract: docs/specs/vna/HUD-NAPI-CONTRACT.md.
// @guard tests/vna/c741-build-the-napi-sync-for-the.test.mjs
// ---------------------------------------------------------------------------------------------------------
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

export type HudEngine = 'napi' | 'node' | 'UNMEASURED';

export interface HudReading {
    cells: any[];
    walk: { ok: boolean; why: string | null; engine: HudEngine; pin: string | null; [k: string]: any };
    landed?: string | null;
    declared?: string | null;
    room_differs?: boolean;
    [k: string]: any;
}

export interface HudOptions {
    extensionPath: string;
    /** The repo root holding scripts/vna/hud-read.mjs (the node engine). */
    repoRoot?: string;
    /** The HUD config JSON handed to the crate fn; default: <repoRoot>/data/vna/hud-config.json, else '' (the crate then reads its defaults and says so). */
    configJson?: string;
    /** Test seam: replaces loadNativeAddon. */
    loader?: (extensionPath: string) => LoadedNativeAddon | UnmeasuredNativeAddon;
}

function hudConfigJson(opts: HudOptions): string {
    if (typeof opts.configJson === 'string') return opts.configJson;
    try { return readFileSync(resolve(opts.repoRoot || '', 'data', 'vna', 'hud-config.json'), 'utf8'); } catch { return ''; }
}

/** The version pin: the extension's own package.json version, the one the addon build is released against. */
export function hudPin(extensionPath: string): string | null {
    try { return String(JSON.parse(readFileSync(resolve(extensionPath, 'package.json'), 'utf8')).version); } catch { return null; }
}

/** Schema check shared by both engines: cells is an array, walk carries ok. Returns the why, or null when it holds. */
export function hudSchemaWhy(r: any): string | null {
    if (!r || typeof r !== 'object') return 'reading is not an object';
    if (!Array.isArray(r.cells)) return 'reading has no cells array';
    if (!r.walk || typeof r.walk.ok !== 'boolean') return 'reading has no walk.ok';
    return null;
}

function unmeasured(why: string, pin: string | null): HudReading {
    const cell = { slot: null, strategy: null, tactics: null, operations: null, colour: 'UNMEASURED', ncd: null, lane: null, why };
    return { cells: Array.from({ length: 9 }, () => ({ ...cell })), walk: { ok: false, why, engine: 'UNMEASURED', pin } };
}

export function hudReading(windowText: string, opts: HudOptions): HudReading {
    const pin = hudPin(opts.extensionPath);
    const loaded = (opts.loader || loadNativeAddon)(opts.extensionPath);
    let napiWhy: string | null = null;
    if (loaded.addon && typeof loaded.addon.hudReading === 'function') {
        try {
            const raw = loaded.addon.hudReading(windowText, hudConfigJson(opts), opts.repoRoot || '');
            const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const bad = hudSchemaWhy(r);
            if (!bad) return { ...r, walk: { ...r.walk, engine: 'napi', pin } };
            napiWhy = `addon hudReading broke the schema: ${bad}`;
        } catch (e: any) {
            napiWhy = `addon hudReading threw: ${e && e.message ? e.message : e}`;
        }
    } else {
        napiWhy = loaded.addon ? 'addon loaded without a hudReading export' : (loaded.reason as string);
    }
    const root = opts.repoRoot;
    if (!root) return unmeasured(`${napiWhy}; no repoRoot for the node engine`, pin);
    const script = resolve(root, 'scripts/vna/hud-read.mjs');
    if (!existsSync(script)) return unmeasured(`${napiWhy}; ${script} absent`, pin);
    const p = spawnSync(process.execPath, [script, '--once', '--json'], { input: windowText, encoding: 'utf8', cwd: root, timeout: 35000 });   // hud-read.mjs --once spawns `pmu-onchip --hud-serve`: the one way to run it
    if (p.status !== 0) return unmeasured(`${napiWhy}; hud-read.mjs exited ${p.status}: ${String(p.stderr || '').slice(0, 120)}`, pin);
    try {
        const r = JSON.parse(String(p.stdout).trim().split('\n').pop() as string);
        if (r && r.kind === 'error') return unmeasured(`${napiWhy}; ${r.why}`, pin);
        const bad = hudSchemaWhy(r);
        if (bad) return unmeasured(`${napiWhy}; hud-read.mjs broke the schema: ${bad}`, pin);
        return { ...r, walk: { ...r.walk, engine: 'node', pin } };
    } catch (e: any) {
        return unmeasured(`${napiWhy}; hud-read.mjs printed no JSON: ${e && e.message ? e.message : e}`, pin);
    }
}
