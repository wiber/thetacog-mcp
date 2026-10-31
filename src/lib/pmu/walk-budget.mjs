// src/lib/pmu/walk-budget.mjs — the walk's budget is a function of the machine's load, never a fixed number.
//
// THE STALL (2026-09-20): 14–19 pmu-onchip walkers alive at once on a ten-core Mac at load 166–242 (16–24 per core);
// 87 % of spec-tree walks in one hour crossed the fixed 800 ms door and were written UNMEASURED. Measured the same day at
// load 79: a walk alone takes ~130 ms. The 800 ms was never the walk's cost — it was fourteen walks racing one CPU each,
// and the fixed door recorded the race as a measurement that failed. A busy machine measuring nothing is a different
// claim from a machine that measured nothing, and the tape must say which.
//
// THE RULE, pure, fixture-guarded (tests/vna/walk-budget.test.mjs):
//   · timeoutMs = base × clamp(loadPerCore, 1, WALK_LOAD_SCALE_MAX) — the door widens with load, capped; never removed,
//     never unbounded (load 24/core buys 2 × base, not 24 ×);
//   · serialize = loadPerCore > WALK_LOAD_SERIALIZE — above it, walkers take turns on one lock (walk-door.mjs) instead of
//     racing; one bounded wait of WALK_LOCK_WAIT_MS, one retry, then the walker spawns NOTHING and its row says
//     `deferred: load <x>/core` — a deferral the next fold retries, not an UNMEASURED that looks like the text's fault.
// An unreadable load is load 0: the door never refuses to walk because a number was missing.
import os from 'node:os';

export const WALK_LOAD_SCALE_MAX = 2;      // the timeout grows with load per core, capped here (× base)
export const WALK_LOAD_SERIALIZE = 1.5;    // above this 1-min load per core, one walker at a time
export const WALK_LOCK_WAIT_MS = 400;      // one bounded wait for the lock; one retry — a deferred walk costs ≤ 2 × this and no CPU

export function walkBudget({ loadPerCore, base }) {
  const l = Number.isFinite(loadPerCore) && loadPerCore > 0 ? loadPerCore : 0;
  const scale = Math.min(WALK_LOAD_SCALE_MAX, Math.max(1, l));
  return { timeoutMs: Math.round(base * scale), serialize: l > WALK_LOAD_SERIALIZE, waitMs: Math.min(WALK_LOCK_WAIT_MS, base), retries: 1, loadPerCore: +l.toFixed(2) };
}

// the 1-min load average per core, read once per call (os.loadavg is a syscall, ~µs); 0 where the platform has none
export function loadPerCoreNow() {
  try { const cores = Math.max(1, (os.cpus() || []).length); const l = os.loadavg()[0]; return Number.isFinite(l) ? l / cores : 0; } catch { return 0; }
}
