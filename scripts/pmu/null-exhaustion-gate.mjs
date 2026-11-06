// scripts/pmu/null-exhaustion-gate.mjs — SN-10: THE WALL CLOCK TRUNCATES THE SHUFFLES, NOT THE WALKS.
//
// THE DEFECT THIS CLOSES (Marsh read, 2026-08-13; still open 2026-08-16).
// A shape-match σ is (actual − μ_null) / sd_null. Both halves of the denominator come from the
// IMPOSTOR NULL, and every impostor is a ballistic walk bounded by the same wall clock (`budgetMs`,
// definer-walk-144.mjs) as the two measured walks. On the 2026-08-13 read σ moved 5.47 → 7.63 while
// the ONLY thing varied was budgetMs — because both real walks had already converged by 200ms and
// the EIGHT SHUFFLES were what the clock cut off. A budget audit that watches only the measured
// walks reports all-clear while σ drifts underneath it.
//
// triptych-build already records the evidence — `meta.impostorNull = {n, exhausted, sigmaMu,
// sigmaSd, degenerate}` and `meta.walkSigmaRecomputable`. NOTHING ACTED ON IT. The claim surfaces
// went on printing a confidence band ("strong") beside a null nobody had checked had finished.
//
// THE RULE, stated once, here, so no surface re-derives it:
//   A σ BAND VERDICT may be published only when the null it stands on RAN TO COMPLETION.
//   • exhausted > 0        → some impostor hit the wall clock. The null is truncated; the σ is
//                            machine-load-dependent and will not replay shape-identical.
//   • degenerate === true  → sd = 0. The divide falls through to a σ of 0 that is a FALLBACK, not a
//                            measurement. This is the worst case, because 0 looks like a reading.
//   • walkSigmaRecomputable === false → a measured walk was truncated too; same conclusion.
//   • no instrumentation at all → UNKNOWN. A reading that cannot show whether its null finished is
//                            not a measured band either. Say "unknown", never assume "fine".
//   Any STRONGER null inherits this contamination unless it is gated first — which is why the gate
//   reads `families[]` (SN-4's per-null rows) and fails the whole reading if ANY family is dirty.
//   A second σ standing on a clean block-permutation null cannot rescue a truncated scatter null
//   printed beside it; they are one reading.
//
// WHAT THE GATE DOES NOT DO: it never suppresses the σ NUMBER and never claims to prevent anything.
// The number still prints, relabelled as telemetry, with the reason it is telemetry.
// We do not prevent a truncated null; we make the truncation a number on the receipt.
//
// @guard  tests/pmu-simulator/null-exhaustion-gate.test.mjs

// ── the four states a σ reading can be in ────────────────────────────────────────────────────
// Ordered worst-first: when several apply, `status` reports the worst one, and `reasons` carries
// every one of them (an operator debugging a gated reading needs all of it, not the headline).
export const GATE_STATUS = {
  DEGENERATE: 'degenerate',     // sd = 0 — the σ is a fallback, not a measurement
  TRUNCATED: 'truncated',       // a walk feeding the null (or a measured walk) hit the wall clock
  UNKNOWN: 'unknown',           // the receipt carries no null instrumentation to check
  MEASURED: 'measured',         // the null ran to completion; the band verdict may be published
};

const WORST_FIRST = [GATE_STATUS.DEGENERATE, GATE_STATUS.TRUNCATED, GATE_STATUS.UNKNOWN, GATE_STATUS.MEASURED];

// Normalize the two shapes triptych-build has emitted: the flat {n, exhausted, sigmaMu, sigmaSd,
// degenerate} it has recorded since 2026-08-13, and the SN-4 `families: [{kind, n, exhausted, ...}]`
// array that carries one row per null construction. Always returns an array of rows so downstream
// code has ONE shape to reason about; a flat record becomes a single unnamed row.
export function nullFamilies(impostorNull) {
  if (!impostorNull || typeof impostorNull !== 'object') return [];
  if (Array.isArray(impostorNull.families) && impostorNull.families.length) {
    return impostorNull.families.map((f) => ({
      kind: f.kind ?? impostorNull.kind ?? null,
      n: Number.isFinite(f.n) ? f.n : null,
      exhausted: Number.isFinite(f.exhausted) ? f.exhausted : null,
      sigmaSd: Number.isFinite(f.sigmaSd) ? f.sigmaSd : null,
      degenerate: f.degenerate === true || f.sigmaSd === 0,
      sigma: Number.isFinite(f.sigma) ? f.sigma : null,
    }));
  }
  return [{
    kind: impostorNull.kind ?? null,
    n: Number.isFinite(impostorNull.n) ? impostorNull.n : null,
    exhausted: Number.isFinite(impostorNull.exhausted) ? impostorNull.exhausted : null,
    sigmaSd: Number.isFinite(impostorNull.sigmaSd) ? impostorNull.sigmaSd : null,
    degenerate: impostorNull.degenerate === true || impostorNull.sigmaSd === 0,
    sigma: null,
  }];
}

// THE VERDICT. Input is whatever the surface has of the build's meta — pass the whole meta, or the
// two fields; both work, because a claim surface should not have to know which one it kept.
//
//   nullExhaustionVerdict({ impostorNull, walkSigmaRecomputable })
//     → { ok, status, reasons[], families[], bandSuppressed, recomputable, headline, detail }
//
// `ok === false` ⇒ the σ BAND VERDICT is suppressed and the reading is marked non-recomputable.
export function nullExhaustionVerdict(meta = {}) {
  const impostorNull = meta?.impostorNull ?? null;
  const walkRec = meta?.walkSigmaRecomputable;
  const families = nullFamilies(impostorNull);
  const reasons = [];
  const statuses = [];

  if (!families.length) {
    statuses.push(GATE_STATUS.UNKNOWN);
    reasons.push('no null instrumentation on this reading — it cannot show whether its impostor walks finished, so the band is unverified rather than clean');
  }

  for (const f of families) {
    const name = f.kind || 'the impostor null';
    if (f.degenerate) {
      statuses.push(GATE_STATUS.DEGENERATE);
      reasons.push(`${name}: sd = 0 across ${f.n ?? '?'} draws — the z-score divide falls through to a σ of 0 that is a fallback value, not a measurement`);
    }
    if (Number.isFinite(f.exhausted) && f.exhausted > 0) {
      statuses.push(GATE_STATUS.TRUNCATED);
      reasons.push(`${name}: ${f.exhausted} of ${f.n ?? '?'} impostor walks hit the wall-clock valve — the null is truncated, so this σ moves with machine load and will not replay shape-identical`);
    }
    if (!Number.isFinite(f.exhausted)) {
      statuses.push(GATE_STATUS.UNKNOWN);
      reasons.push(`${name}: no exhaustion count recorded — whether the null finished is unknown, which is not the same as finished`);
    }
  }

  if (walkRec === false) {
    statuses.push(GATE_STATUS.TRUNCATED);
    reasons.push('a MEASURED walk also hit its wall-clock valve (walkSigmaRecomputable = false) — both halves of the ratio are load-dependent on this run');
  }

  const status = WORST_FIRST.find((s) => statuses.includes(s)) || GATE_STATUS.MEASURED;
  const ok = status === GATE_STATUS.MEASURED;
  return {
    ok,
    status,
    reasons,
    families,
    bandSuppressed: !ok,
    // The whole reading — not just the band — is marked non-recomputable when the gate trips. A
    // truncated null makes the σ a function of the machine, and a number that is a function of the
    // machine is telemetry on every surface, not only the one that prints a word for it.
    recomputable: ok,
    headline: headlineFor(status, families),
    detail: reasons.join(' · '),
  };
}

function headlineFor(status, families) {
  const drawn = families.map((f) => f.n).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  switch (status) {
    case GATE_STATUS.DEGENERATE:
      return 'σ BAND SUPPRESSED — the null has zero spread, so this σ is a fallback value, not a measurement';
    case GATE_STATUS.TRUNCATED:
      return 'σ BAND SUPPRESSED — the wall clock truncated the null, not the walks; this σ is telemetry and will not replay shape-identical';
    case GATE_STATUS.UNKNOWN:
      return 'σ BAND UNVERIFIED — this reading carries no record of whether its null finished';
    default:
      return `null ran to completion (${drawn || '?'} impostor walks, none truncated) — the band verdict stands on a measured null`;
  }
}

// The one line a claim surface prints instead of a confidence word. `sigma` is still shown: we
// publish the number and the reason it is not a verdict, rather than hiding either.
export function gateLine(verdict, sigma) {
  const s = (sigma == null || !Number.isFinite(Number(sigma))) ? '—' : Number(sigma);
  if (verdict.ok) return `σ = ${s} · ${verdict.headline}`;
  return `σ = ${s} (TELEMETRY, NOT A VERDICT) · ${verdict.headline}. ${verdict.detail}.`;
}

// The band word a surface may print. Returns null when the gate suppresses it — callers render the
// gate's headline in its place, never a fallback adjective. Keep the thresholds where they already
// live at each surface; this only decides WHETHER a word may be printed at all.
export function bandOrSuppressed(verdict, bandFn, sigma) {
  if (!verdict.ok) return null;
  return bandFn(sigma);
}
