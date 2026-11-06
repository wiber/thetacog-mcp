// src/lib/steer-is-goal.mjs — §25's ONE sentence (SPEC-VNA-COCKPIT.md §25), the one place it is typed (C95, operator verbatim:
// *"Put the /goal vs /steer sentence on card 1, README, and site, byte-identical."*). It lives under src/lib because a Next page
// cannot import scripts/ (C154's precedent, notary-seat-checkout.mjs); scripts/vna/public-surface-register.mjs re-exports it for
// the sidebar and the README guard. Guard: tests/vna/c95-steer-is-goal.test.mjs.
export const STEER_IS_GOAL = "/goal is what you want finished. /steer is /goal with the record holding it — every ask a row, every row a guard, every commit placed, every worker cold-booted from the tree, and the session evicted when the goal closes.";
