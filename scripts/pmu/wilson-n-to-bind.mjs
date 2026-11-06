#!/usr/bin/env node
/**
 * wilson-n-to-bind — at what n does the breach-rate interval become bindable?
 *
 * WHY THIS EXISTS. /deck/actuary disclosed "the interval is too wide to bind, and whether it
 * tightens with volume or plateaus is the open empirical question." True, and travelling alone.
 * A negative result without an owner, a date and a mechanism is a confession; with all three it
 * is a gate. This is the mechanism.
 *
 * There is no modelling here and no assumption smuggled in beyond one stated plainly: hold the
 * OBSERVED breach rate constant and grow n. The Wilson score interval then narrows as a matter of
 * arithmetic, not of hope — so the answer to "does it tighten" is not a belief, it is a number.
 * (If the true rate is higher than observed, the interval is wider at every n; the honest read is
 * that this is a floor on n, not a ceiling. Stated so nobody has to catch us on it.)
 *
 *   node scripts/pmu/wilson-n-to-bind.mjs            # the table + the binding n
 *   node scripts/pmu/wilson-n-to-bind.mjs --json
 */
const Z = 1.96;                 // 95%
const BINDABLE_HALF_WIDTH = 0.01; // 1% — below this an underwriter can write against it
const ATTESTATIONS_PER_AGENT_YEAR = 10_000; // derived cap, docs/gtm/2026-07-15-agent-year-license…

export function wilson(k, n, z = Z) {
    const p = k / n, d = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / d;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return { low: centre - half, high: centre + half, half };
}

/** Smallest n at which the interval is bindable, holding the observed rate. */
export function nToBind(rate, target = BINDABLE_HALF_WIDTH) {
    for (let n = 10; n <= 100_000; n += 10) {
        const k = Math.max(1, Math.round(rate * n));
        if (wilson(k, n).half < target) return n;
    }
    return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const K_NOW = 1, N_NOW = 163;          // from the live ledger snapshot
    const rate = K_NOW / N_NOW;
    const nBind = nToBind(rate);
    const rows = [163, 250, 500, 750, 1000, 1500, 2000, 3000, 5000].map((n) => {
        const k = Math.max(1, Math.round(rate * n));
        return { n, k, half: wilson(k, n).half };
    });

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ rate, nBind, bindableHalfWidth: BINDABLE_HALF_WIDTH, rows }, null, 2));
        process.exit(0);
    }

    console.log('\n  WHEN DOES THE INTERVAL BIND?  (Wilson 95%, observed rate held constant)\n');
    console.log('     n    breaches    half-width');
    for (const r of rows) {
        console.log(`  ${String(r.n).padStart(5)}  ${String(r.k).padStart(8)}       ${(r.half * 100).toFixed(2)}%` +
            (r.half < BINDABLE_HALF_WIDTH ? '   ← bindable' : ''));
    }
    const share = nBind / ATTESTATIONS_PER_AGENT_YEAR;
    console.log(`\n  Bindable (half-width < ${BINDABLE_HALF_WIDTH * 100}%) at n ≈ ${nBind}.`);
    console.log(`  One agent-year is ${ATTESTATIONS_PER_AGENT_YEAR.toLocaleString()} attestations, so that is ` +
        `${(share * 100).toFixed(0)}% of a single agent-year — about ${Math.round(share * 365)} agent-days.`);
    console.log('\n  The pilot is not a request for patience. It is the machine that produces n.\n');
}
