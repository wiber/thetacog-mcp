// src/lib/pmu/greeks.mjs — THE AI GREEKS (the priced risk-sensitivities of the competence signal).
// =============================================================================================
// A published signal (signal-schema.mjs) carries a σ and a verdict. The GREEKS are its derivatives — the
// options-desk sensitivities a reinsurer / options-writer prices the instrument on. Each Greek is
// MEASURED from a real running source in this repo, never asserted; when the source lacks the data to
// compute one HONESTLY (too few graded commits, no token count) the Greek is `null` WITH a reason, never
// fabricated. That honesty IS the asset — a Greek you can't back out of measurement is a lie you can't
// license (CLAUDE.md · "measure, don't assert" · "CODE DEFINITION-OF-DONE").
//
//   Δ  delta        = weighted Semantic Bleed σ            ← unified-drift evaluateDrift(...,{weighted:true}).weightedBleed  [0,1]
//   Δ-spread        = max Chebyshev king-move leak          ← unified-drift evaluateDrift(...).deltaSpread                    0..11
//   Γ  gamma        = traction slope (drift rate-of-change) ← lens-traction-monitor assessTraction driftSeq (later½ − earlier½)
//   𝒱  vega         = reef volatility (hold-rate variance)  ← lens-feedback lens_performance held-rate history (population var)
//   Θ  theta        = efficiency decay vs the Lens-OFF base ← .thetacog/lens-token-baseline.json median vs this commit's tokens
//
// Each Greek is `{ value:number|null, note:string }`: `value` is the measured number (or null when the
// data is absent) and `note` is its provenance (present) or the honest reason (null). Pure, dependency-
// free, deterministic given inputs — no I/O, no qwen, no clock. The CALLER (lens-signal-emit.mjs) gathers
// the real running-source inputs; this module only does the arithmetic on them.
//
// @canonical  measured-not-asserted; null+reason where the source has no data (never a fabricated Greek)
// @guard  tests/pmu/greeks.test.js

const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const G = (value, note) => ({ value, note });
const NULLG = (reason) => ({ value: null, note: reason });

// population variance of a numeric series (Σ(x−μ)²/n) — the reef-volatility primitive.
function populationVariance(xs) {
  const n = xs.length;
  if (n === 0) return 0;
  const mean = avg(xs);
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
}

// ── Δ (delta) = the weighted Semantic Bleed σ, verbatim from the ONE drift engine ──────────────────────
// "what fraction of the reality MASS landed OUTSIDE the intent lane." Range [0,1]. Requires evaluateDrift
// to have been run with {weighted:true} (otherwise .weightedBleed is undefined → null, honestly).
export function computeDelta(driftEval) {
  if (!driftEval || !isFiniteNum(driftEval.weightedBleed))
    return NULLG('Δ needs evaluateDrift(...,{weighted:true}).weightedBleed — absent');
  const v = driftEval.weightedBleed;
  if (v < 0 || v > 1) return NULLG(`Δ weightedBleed ${v} outside [0,1] — refusing to publish`);
  return G(v, 'Δ = weighted Semantic Bleed σ (unified-drift evaluateDrift weighted:true .weightedBleed)');
}

// ── Δ-spread = the secondary Chebyshev king-move leak (unified-drift .deltaSpread) ─────────────────────
export function computeDeltaSpread(driftEval) {
  if (!driftEval || !isFiniteNum(driftEval.deltaSpread))
    return NULLG('Δ-spread needs evaluateDrift(...,{weighted:true}).deltaSpread — absent');
  return G(driftEval.deltaSpread, 'Δ-spread = max Chebyshev (king-move) leak out of lane (unified-drift .deltaSpread)');
}

// ── Γ (gamma) = traction slope = the rate-of-change of drift across graded commits ─────────────────────
// Reuses lens-traction-monitor's own trend math EXACTLY: over the driftSeq window (oldest→newest), the
// second-half mean minus the first-half mean. > 0 = drift rising (losing traction), < 0 = resolving.
// tractionState is the assessTraction(...) / `lens-traction-monitor --json` object (carries driftSeq).
// Γ needs ≥ minHistory graded commits (the monitor's MIN_HISTORY=3) or it is null WITH the reason — never
// a fabricated slope off 1-2 points.
export function computeGamma(tractionState, { minHistory = 3 } = {}) {
  const seq = tractionState && Array.isArray(tractionState.driftSeq)
    ? tractionState.driftSeq.filter(isFiniteNum) : [];
  if (seq.length < minHistory)
    return NULLG(`Γ needs ≥${minHistory} graded commits (traction driftSeq); have ${seq.length}`);
  const n = seq.length, half = Math.floor(n / 2);
  const earlier = avg(seq.slice(0, half));
  const later = avg(seq.slice(n - half));
  const slope = +(later - earlier).toFixed(4);
  return G(slope, `Γ = traction slope (later½ − earlier½ drift over ${n} graded commits; lens-traction-monitor assessTraction)`);
}

// ── 𝒱 (vega) = reef volatility = the VARIANCE of the injected rules' hold-rate ─────────────────────────
// holdRateHistory = the per-rule held-rate series (held/judged ∈ [0,1]) mined from lens_performance
// (lens-feedback --report). High variance = the reef's rules hold inconsistently (volatile). Needs ≥2
// samples for a variance to mean anything, else null WITH the reason.
export function computeVega(holdRateHistory) {
  const xs = Array.isArray(holdRateHistory) ? holdRateHistory.filter(isFiniteNum) : [];
  if (xs.length < 2)
    return NULLG(`𝒱 needs ≥2 hold-rate samples (lens_performance held-rate history); have ${xs.length}`);
  return G(+populationVariance(xs).toFixed(6),
    `𝒱 = population variance of ${xs.length} injected-rule hold-rates (lens-feedback lens_performance)`);
}

// ── Θ (theta) = efficiency decay = this commit's tokens vs the Lens-OFF baseline median ────────────────
// Θ = commitTokens / tokenBaseline.median. < 1 = cheaper than the pre-lens baseline (better); > 1 = worse.
// tokenBaseline is .thetacog/lens-token-baseline.json (median lives at .distribution.tokens_per_task.median;
// the caller may pass {median} directly). Needs BOTH a baseline median AND this commit's token count — if
// the per-commit token count is absent (the usual case: we don't meter a single commit), Θ is null WITH
// the reason. `unit` lets the caller price on turns instead of tokens (same ratio math).
export function computeTheta(tokenBaseline, commitTokens, { unit = 'tokens' } = {}) {
  const median = tokenBaseline && isFiniteNum(tokenBaseline.median) ? tokenBaseline.median
    : (tokenBaseline && isFiniteNum(tokenBaseline.medianTokens) ? tokenBaseline.medianTokens : null);
  if (!isFiniteNum(median)) return NULLG('Θ needs a Lens-OFF baseline median (lens-token-baseline.json)');
  if (median <= 0) return NULLG('Θ baseline median ≤ 0 — undefined ratio');
  if (!isFiniteNum(commitTokens)) return NULLG(`Θ needs this commit's ${unit} count (no per-commit meter available)`);
  const ratio = +(commitTokens / median).toFixed(4);
  return G(ratio,
    `Θ = commit ${unit} ${commitTokens} / Lens-OFF baseline median ${median} (lens-token-baseline; <1 = better than baseline)`);
}

// ── computeGreeks — the whole strip in one call, each Greek measured or honestly null ──────────────────
export function computeGreeks({ driftEval, tractionState, holdRateHistory, tokenBaseline, commitTokens, thetaUnit } = {}) {
  return {
    delta: computeDelta(driftEval),
    deltaSpread: computeDeltaSpread(driftEval),
    gamma: computeGamma(tractionState),
    vega: computeVega(holdRateHistory),
    theta: computeTheta(tokenBaseline, commitTokens, { unit: thetaUnit || 'tokens' }),
  };
}

export { populationVariance };
