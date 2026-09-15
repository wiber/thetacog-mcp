// src/lib/pmu/walk-knobs.mjs — THE ONE WALK-KNOB HOME (operator 2026-09-14: "ratchet the deep one per
// prompt always"). Every walk in the repo — the per-turn tape walk (walk-door → pmu-onchip --lens), the
// commit-receipt chain, the lens email, the per-prompt PNG (triptych-build → definerWalk144) — reads THESE.
// A literal walk knob at a call site, or a Rust-side default deciding a walk, is the regression
// tests/pmu-simulator/walk-door.test.mjs and one-encircled-pipeline.test.mjs exist to catch.
//
// WHY THIS FILE AND NOT triptych-build.mjs (where fc3af13580 first froze the knobs): triptych-build pulls
// in the pipeline, the renderer and the definer walk — 113 ms to import (measured 2026-09-14) — and the
// per-turn door sits on the hook's synchronous path (walk-door imports in 14 ms). The definition lives
// here; triptych-build RE-EXPORTS it, so `import { WALK_KNOBS } from './triptych-build.mjs'` still
// names the same frozen object. One definition, two doors.
//
// THE DEFECT THIS CLOSES (io1b, 2026-09-14): pmu-onchip --lens defaulted to max_depth 2 · top_k 3 ·
// budget 120 (lens.rs), the panel walked at maxDepth 8 · topK 2 · budget 220 (definer-walk-144.mjs).
// 4,667 tape rows — every turn, every commit, every aperture A/B — carried the SHALLOW walk while the
// receipts carried the deep one. Measured on four 800-char texts: depth 2 → 8 cut the walked set 35 → 19,
// raised σ 1.6 → 2.7, Jaccard between the two masks ≈ 0.55, and cost +0.3–0.5 ms in a 22 ms process.
export const WALK_KNOBS = Object.freeze({
  maxDepth: 8,
  topK: +(process.env.PMU_TOPK || 2),
  decay: +(process.env.PMU_DECAY || 0.5),
  budget: 220,        // the DETERMINISTIC hop bound (definerWalk144's default, now named) — this terminates every walk
  budgetMs: 600000,   // hop-bounded termination; the wall clock must never decide a panel
  impostors: 8,       // floor for the null (Math.max(8, n) in triptych-build)
});

// The flags the Rust lens takes for the same knobs — so the binary's own defaults never decide a walk.
export const lensWalkFlags = (k = WALK_KNOBS) => ['--max-depth', String(k.maxDepth), '--top-k', String(k.topK), '--budget', String(k.budget), '--budget-ms', String(k.budgetMs), '--decay', String(k.decay)];

// THE FLOOR (operator 2026-09-14: "the full is the minimum … or default the config at worst"). A caller may
// pass knobs; a caller may NOT walk shallower than the home. maxDepth / budget / budgetMs below the home are
// RAISED to it and the raise is named on the result (knobsRaised), so a receipt can say it happened; topK and
// decay are taken as given (they shape, they do not shorten) and default from the home. Used by
// definerWalk144 (the panel/receipt walk) and lensWalk (the tape walk) — one rule, one place.
export function floorKnobs(o = {}) {
  const raised = [];
  const atLeast = (key) => { const want = WALK_KNOBS[key], v = o[key]; if (v == null) return want; if (typeof v === 'number' && v < want) { raised.push(key); return want; } return v; };
  return { maxDepth: atLeast('maxDepth'), budget: atLeast('budget'), budgetMs: atLeast('budgetMs'), topK: o.topK == null ? WALK_KNOBS.topK : o.topK, decay: o.decay == null ? WALK_KNOBS.decay : o.decay, knobsRaised: raised };
}

// THE SEED APERTURE (operator 2026-09-14: "branches out wider on the side that is too slim until perfect fit").
// matchedCut cuts the 144 target snippets against the intent with aperture.rs's rule (the one cut in the crate).
// Defaults are DECIDED BY THE NUMBER (the replay A/B in rust-pipeline-flowchart §14), never by taste.
export const SEED_APERTURE = Object.freeze({ matchedCut: true, guidedPasses: 2 });   // decided by the replay (rust-pipeline-flowchart §14): matchedCut 32.3% vs 21.2% without; guided 2 = the knee. The cut rule itself lives in aperture.rs; there is no grow knob (CUT, NEVER GROW).
export const seedApertureFlags = (a = SEED_APERTURE) => [...(a && a.matchedCut === false ? ['--no-matched-cut'] : ['--matched-cut'])];
