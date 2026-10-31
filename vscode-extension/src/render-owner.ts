// packages/thetacog-mcp-vscode/src/render-owner.ts — ONE render per MACHINE, not per IDE host (C203 (3)).
//
// MEASURED 2026-09-23: VS Code and Cursor open on the same repo each run the eight watchers in extension.ts, so every
// tape row, every prompt and every fold spawned steer-ui.mjs TWICE — two 1 GB renders writing the same latest.html, and
// the operator's "the left panel keeps refreshing" was half of it. The page watcher already repaints EVERY host from the
// one file, so a second host gains nothing by rendering it again.
//
// THE RULE: a lock beside latest.html (pid · host · start · cause). A host acquires it before spawning; a LIVE lock held
// by another pid makes the request a no-op — that host repaints from the page the owner writes. A lock is stale when its
// pid is dead or its start is older than staleMs (the render itself is capped at 60 s in extension.ts), and a stale lock
// is taken over, so a crashed host never freezes every other one. Pure: the file, the clock and the liveness probe are
// injected, so the guard replays two hosts against one lock without a filesystem.
// @guard tests/vna/c203-the-refresh-is-one-visible-pattern.test.mjs

export interface OwnerLock { pid: number; host: string; start: number; cause: string }
export interface OwnerIO {
    read: () => string | null;                 // the lock file's bytes, or null when absent
    write: (text: string) => void;
    remove: () => void;
    alive: (pid: number) => boolean;           // process.kill(pid, 0) at home; injected in the guard
    now?: () => number;
}
export type Acquire = { held: true; lock: OwnerLock; release: () => void } | { held: false; owner: OwnerLock };

export const LOCK_NAME = 'render-owner.lock';   // beside latest.html — docs/specs/vna/steer/ is gitignored whole

export function parseLock(text: string | null): OwnerLock | null {
    if (!text) { return null; }
    try {
        const j = JSON.parse(text) as Partial<OwnerLock>;
        if (typeof j.pid !== 'number' || typeof j.start !== 'number') { return null; }
        return { pid: j.pid, host: String(j.host ?? '?'), start: j.start, cause: String(j.cause ?? '') };
    } catch { return null; }
}

export function tryAcquire(io: OwnerIO, me: { pid: number; host: string; cause: string }, staleMs = 120000): Acquire {
    const now = (io.now ?? (() => Date.now()))();
    const cur = parseLock(io.read());
    const live = cur !== null && cur.pid !== me.pid && io.alive(cur.pid) && now - cur.start < staleMs;
    if (live && cur) { return { held: false, owner: cur }; }
    const lock: OwnerLock = { pid: me.pid, host: me.host, start: now, cause: me.cause };
    io.write(JSON.stringify(lock));
    return { held: true, lock, release: () => { const after = parseLock(io.read()); if (after && after.pid === me.pid && after.start === now) { io.remove(); } } };
}
