// src/lib/backup/exceedance.mjs — C705 THE EXCEEDANCE TABLE AN ACTUARY READS (operator 2026-10-09: "translated to frequency … he will
// understand the P values"; the facility-actuary reader: "the CI is the headline", counts and a Wilson 95 % interval in every cell,
// never a bare "1 in N", and the worst case named as one order statistic, never a rate). One pure function over the survival arrays
// tailReading already returns (token-tail.mjs) — no second resampler, no second quantile. The budget line is k × the PLAIN median,
// one line for both arms, so a row compares the same threshold.
// Not sufficient for: whether a token exceedance is an agent acting outside delegated authority (same measurement shape, correlation
// UNMEASURED); whether steering caused the difference (observational, task mix differs); whether any work was good (Rice).
// Port row: none — a reader over arrays another module produced; it decides nothing and holds no mass.
// @guard tests/site/c705-tail-exceedance.test.mjs

export const BUDGET_MULTIPLES = Object.freeze([2, 3, 4, 10, 20, 50]);

/** Wilson score interval for x successes in n trials → [lo, hi] as proportions; n 0 → null */
export function wilson(x, n, z = 1.96) {
  if (!(n > 0)) return null;
  const p = x / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const arm = (xs, budget) => {
  const n = xs.length, x = xs.filter((v) => v > budget).length;
  return { x, n, rate: n ? x / n : null, ci: wilson(x, n) };
};

/** exceedanceTable({ survival, median }) → rows { k, budget, plain, steer } or null when the reading carries no survival arrays */
export function exceedanceTable(reading, ks = BUDGET_MULTIPLES) {
  const s = reading && reading.survival, m = reading && reading.median && reading.median.plain;
  if (!s || !Array.isArray(s.plain) || !Array.isArray(s.steer) || !(m > 0)) return null;
  return ks.map((k) => ({ k, budget: k * m, plain: arm(s.plain, k * m), steer: arm(s.steer, k * m) }));
}

/** the worst task as a multiple of its own arm's median — ONE order statistic, labelled so, never a rate */
export function worstMultiple(reading) {
  const M = reading && reading.max, m = reading && reading.median;
  if (!M || !m || !(m.plain > 0) || !(m.steer > 0)) return null;
  return { plain: M.plain / m.plain, steer: M.steer / m.steer };
}

export const pct = (p, d = 1) => (p == null ? 'UNMEASURED' : `${(100 * p).toFixed(d)}%`);
export const ciText = (ci, d = 1) => (ci ? `${(100 * ci[0]).toFixed(d)}–${(100 * ci[1]).toFixed(d)}%` : 'UNMEASURED');
