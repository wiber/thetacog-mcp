// The one time limit a door puts on running a guard (steer-follow-through.mjs verify · spec-check.mjs toggle). A guard that
// re-reads a corpus through the panel door can need more than the default 5 min (C610l: 80 items ≈ 465 s). The default stays
// bounded; VNA_VERIFY_GUARD_TIMEOUT_MS raises it for one run, named on the command line, never silently. One rule, one place.
export const DEFAULT_GUARD_TIMEOUT_MS = 300000;
export function guardTimeoutMs(env = process.env) {
  const n = Number(env.VNA_VERIFY_GUARD_TIMEOUT_MS);
  return n > 0 ? n : DEFAULT_GUARD_TIMEOUT_MS;
}
