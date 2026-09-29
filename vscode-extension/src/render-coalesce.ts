// packages/thetacog-mcp-vscode/src/render-coalesce.ts — ONE render in flight, a trailing-edge debounce, a skip that is
// counted. The one rule for every repaint this host spawns (steer-ui.mjs, cockpit.mjs --reality tree).
//
// THE STORM (2026-09-20, load 166–242 on ten cores): every watcher — amendments.ndjson, runner.ndjson, spec-tree.json,
// lens-encircled/latest.json, goal.json — called a 1.5 s debounce that spawned steer-ui.mjs with NO in-flight guard. A
// render takes 4–20 s under load and one was seen at 1.4 GB RSS; a fold storm writes the tape every second, so renders
// piled up: four steer-ui.mjs alive at once, each slower for the others. The debounce alone cannot bound the pile —
// it bounds the START rate, never the count alive.
//
// THE RULE: (1) a request arms a trailing timer of DELAY ms (≥ 2 s), re-armed by every further request, so a burst is one
// render; (2) at most maxInFlight (1) render runs — a timer that fires while one is running does NOT spawn, it records
// `skipped` and marks `pending`; (3) when the running render finishes and a request arrived meanwhile, ONE more trailing
// render is armed, so nothing that landed during a render is lost; (4) a stream that never pauses — a fold storm writes the
// tape every second — would starve a pure trailing edge forever (seen red in the guard: 0 renders in a busy minute), so a
// render is forced at most maxWaitMs after the first un-rendered request. Pure: time, timers and the spawn are injected, so the
// guard (tests/vna/render-coalesce.test.mjs) replays a busy minute against both this policy and the old one and counts.
// C203 (1) — THE CAUSE RIDES WITH THE REQUEST: every request names the watcher that armed it; the causes folded into one
// render are joined ('runner+goal') and handed to run(), which carries them to steer-ui.mjs as VNA_RENDER_CAUSE so the page
// can print `repainted <age> · cause <watcher>` — read, never inferred. A skipped fire keeps its causes for the trailing render.
// @guard tests/vna/render-coalesce.test.mjs · tests/vna/c203-the-refresh-is-one-visible-pattern.test.mjs

export interface CoalesceState { requests: number; renders: number; skipped: number; inFlight: number; pending: boolean; lastCause: string; }
export interface CoalesceOpts {
    delayMs: number;                                   // trailing-edge debounce; the host passes RENDER_DEBOUNCE_MS (≥ 2000)
    run: (done: () => void, cause: string) => void;    // spawn the render; call done() when the child exits (success or not); cause = the joined watcher names
    maxInFlight?: number;                              // 1 by default — the whole point; Infinity models the old policy
    maxWaitMs?: number;                                // the ceiling on how long a continuous stream can postpone a render (default 4 × delayMs)
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (t: unknown) => void;
    log?: (line: string) => void;                      // the plugin's own receipt line for a skip
    label?: string;
}
export interface Coalescer { request: (cause?: string) => void; state: CoalesceState; }

export function makeCoalescer(o: CoalesceOpts): Coalescer {
    const max = o.maxInFlight ?? 1;
    const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clrT = o.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
    const log = o.log ?? (() => { /* silent */ });
    const label = o.label ?? 'render';
    const maxWait = o.maxWaitMs ?? o.delayMs * 4;
    const now = o.now ?? (() => Date.now());
    let firstAt: number | null = null;                  // the first request not yet rendered — the max-wait clock
    const state: CoalesceState = { requests: 0, renders: 0, skipped: 0, inFlight: 0, pending: false, lastCause: '' };
    let timer: unknown = undefined;
    let causes: string[] = [];                          // the watchers that armed the render not yet spawned, in arrival order, deduped
    const fire = () => {
        timer = undefined; firstAt = null;
        if (state.inFlight >= max) {
            state.skipped += 1; state.pending = true;
            log(`Steer ${label}: skipped — ${state.inFlight} in flight · skipped ${state.skipped} · renders ${state.renders} · requests ${state.requests}`);
            return;
        }
        state.inFlight += 1; state.renders += 1;
        const cause = causes.length ? causes.join('+') : 'unknown'; causes = []; state.lastCause = cause;
        let finished = false;
        o.run(() => {
            if (finished) { return; } finished = true;     // done() is idempotent — a child that fires close twice counts once
            state.inFlight -= 1;
            if (state.pending) { state.pending = false; arm(); }   // what landed during the render gets ONE trailing render
        }, cause);
    };
    const arm = () => {
        const t = now(); if (firstAt === null) { firstAt = t; }
        const wait = Math.max(0, Math.min(o.delayMs, firstAt + maxWait - t));   // trailing edge, capped by the max-wait ceiling
        if (timer !== undefined) { clrT(timer); } timer = setT(fire, wait);
    };
    return { request: (cause?: string) => { state.requests += 1; const c = (cause || 'unnamed').trim(); if (!causes.includes(c) && causes.length < 8) { causes.push(c); } arm(); }, state };
}
