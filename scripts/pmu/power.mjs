// scripts/pmu/power.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE POWER-ADAPTER MANDATE (operator 2026-08-13: "it should stay running on
// power adapter — can we mandate that generally somehow in the code?").
//
// The general rule, encoded once for every long-running local server:
//   plugged in  → the instrument stays alive, and the machine is kept from
//                 sleeping underneath it;
//   on battery  → mortality TTLs apply unchanged, and we never burn the
//                 battery to keep a forgotten server warm.
//
// Two primitives:
//   onACPower()          — true iff macOS reports 'AC Power' (pmset). Non-darwin
//                          or any error → false, so every caller fails toward
//                          the battery-frugal path, never toward immortality.
//   keepAwakeWhileOnAC() — spawns `caffeinate -s -w <pid>`, detached. The -s
//                          assertion is AC-ONLY BY THE OS'S OWN SEMANTICS: on
//                          battery it is inert, so this needs no polling loop —
//                          plug state changes and the kernel applies the rule.
//                          The -w pid bound means the assertion dies with the
//                          server; no orphan caffeinate outlives its process.
// ════════════════════════════════════════════════════════════════════════════

import { execFileSync, spawn } from 'node:child_process';

export function onACPower() {
  if (process.platform !== 'darwin') return false;
  try {
    return /AC Power/i.test(execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 3000 }));
  } catch {
    return false;
  }
}

export function keepAwakeWhileOnAC(pid = process.pid) {
  if (process.platform !== 'darwin') return null;
  try {
    const child = spawn('caffeinate', ['-s', '-w', String(pid)], { detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid;
  } catch {
    return null;
  }
}
