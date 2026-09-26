// packages/thetacog-mcp-vscode/src/device-door.ts — C102a THE KEYS LAND IN THE EXTENSION, NEVER PASTED (2026-09-20).
//
// The one reader of `auth-flow.mjs connect|notarise --json`: the script prints `{ open }` first (the page the browser
// opens while the IDE polls /token) and `{ entitlement, claims, line }` last (the JWT the site minted onto the device row,
// C84c). This module reads that stream and hands each line to an adapter — open the URL, store the secret, repaint — so the
// host (auth-manager.ts) is a thin vscode skin over it and the guard can drive the same reader in-process with a fixture
// child, a fixture secret store and no vscode. The JWT never rides argv, never a file, never a log line: it goes from the
// pipe into `store.store()` and nowhere else. No vscode import: pure, so `tsx` can load it under node --test.
// @guard tests/vna/c102a-keys-land-in-the-extension.test.mjs

export interface EntitlementClaims { account_id: string; pubkey_fingerprint: string; credits: number; exp: number }
export type DoorLine = { open?: string; entitlement?: string; claims?: EntitlementClaims; line?: string };
export type StdoutLike = { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown };
export type ChildLike = { stdout: StdoutLike; stderr: StdoutLike; on(event: 'close', cb: (code: number | null) => void): unknown; on(event: 'error', cb: (e: Error) => void): unknown; kill(): unknown };
export interface DeviceDoorAdapters {
    /** the browser: opened ONCE, on the first `{ open }` line */
    openExternal: (url: string) => PromiseLike<unknown>;
    /** SecretStorage: the JWT is stored the moment the poll returns it (C84a — no user action after paying) */
    store: { store(key: string, value: string): PromiseLike<void> };
    /** what happens after the store — the repaint, the toast; never sees the JWT */
    onEntitlement?: (claims: EntitlementClaims, line: string | undefined) => Promise<unknown> | unknown;
    onCancel?: () => void;
}
export interface DeviceDoorResult { opened: string | null; stored: boolean; claims: EntitlementClaims | null; code: number | null; stderr: string; error?: string }

export const SECRET_KEY = 'vna.entitlement';

/** parse one stdout line of the script; null when it is not JSON (a stray log) */
export function parseDoorLine(line: string): DoorLine | null {
    try { const v = JSON.parse(line); return v && typeof v === 'object' ? (v as DoorLine) : null; } catch { return null; }
}

/** read the child's stdout to the end: open once, store once, report */
export function readDeviceDoor(child: ChildLike, a: DeviceDoorAdapters): Promise<DeviceDoorResult> {
    return new Promise((resolve) => {
        const r: DeviceDoorResult = { opened: null, stored: false, claims: null, code: null, stderr: '' };
        let buf = ''; let pending: Promise<unknown> = Promise.resolve();
        child.stderr.on('data', (d) => { r.stderr += String(d); });
        child.stdout.on('data', (d) => {
            buf += String(d);
            const lines = buf.split('\n'); buf = lines.pop() ?? '';
            for (const line of lines) {
                const msg = parseDoorLine(line); if (!msg) { continue; }
                pending = pending.then(async () => {
                    if (msg.open && !r.opened) { r.opened = msg.open; await a.openExternal(msg.open); }
                    if (msg.entitlement && msg.claims) {
                        await a.store.store(SECRET_KEY, msg.entitlement);   // the pipe → the secret store; the token is not echoed, written or logged
                        r.stored = true; r.claims = msg.claims;
                        if (a.onEntitlement) { await a.onEntitlement(msg.claims, msg.line); }
                    }
                });
            }
        });
        child.on('close', (code) => { r.code = code; void pending.then(() => resolve(r)); });
        child.on('error', (e) => { r.error = e.message; void pending.then(() => resolve(r)); });
    });
}
