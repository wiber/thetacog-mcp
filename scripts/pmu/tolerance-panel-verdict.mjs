#!/usr/bin/env node
// scripts/pmu/tolerance-panel-verdict.mjs — ONE place that decides what a tolerance panel READS AS.
//
// WHY THIS FILE EXISTS (the defect it was extracted to close, 2026-09-08):
// attest-demo.mjs printed "✅ in lane" whenever `tp.tooMany` was falsy — and `offPct == null` is
// falsy. The degenerate branch beside it only fired at `offPct >= 90`, so a null slipped past BOTH
// and the panel rendered:
//     TOLERANCE PANEL: 0g · 0a · 0r · off-lane null% vs 25% kill  ✅ in lane
// Zero grounded tiles, no measurement taken, green check. attest-demo-lifecycle.mjs:47 already
// mapped `offPct == null` → UNMEASURED, so the printer and the receipt disagreed about the same run.
//
// "I did not look" and "I looked and saw nothing" are different claims. For an insurance trigger
// only the second can ever be IN_LANE, and a false green is indistinguishable from a real one from
// the outside — which is the single output this whole instrument exists to say is not allowed.
//
// FORECLOSES: printing a bespoke pass/fail string at any panel call site. Every renderer asks here,
// so a future site cannot re-grow its own copy of the rule and drift from the receipt again.

/**
 * @param {{green?:number, amber?:number, red?:number, offPct?:number|null, tooMany?:boolean}|null} tp
 * @returns {'NO_PANEL'|'UNMEASURED'|'DEGENERATE'|'TOO_MANY'|'IN_LANE'}
 */
export function tolerancePanelVerdict(tp) {
  if (!tp) return 'NO_PANEL';
  const offPct = tp.offPct;
  // FAIL CLOSED FIRST. Absent data is never a pass, and it is checked before every other branch so
  // that no later condition can accidentally absorb it (which is exactly how the defect happened).
  if (offPct == null || Number.isNaN(Number(offPct))) return 'UNMEASURED';
  if ((tp.green ?? 0) === 0 && Number(offPct) >= 90) return 'DEGENERATE';
  if (tp.tooMany) return 'TOO_MANY';
  return 'IN_LANE';
}

/** The human string for a verdict, so the wording lives beside the decision. */
export function tolerancePanelMark(verdict) {
  return {
    NO_PANEL: '',
    UNMEASURED: '  ⚠ UNMEASURED — no off-lane count was produced this run',
    DEGENERATE: '  ⚠ DEGENERATE — the intent corpus did not ground onto the lattice',
    TOO_MANY: '  ⚠ TOO MANY — work drifts off-lane',
    IN_LANE: '  ✅ in lane',
  }[verdict] ?? '';
}
