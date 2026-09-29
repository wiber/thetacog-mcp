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
