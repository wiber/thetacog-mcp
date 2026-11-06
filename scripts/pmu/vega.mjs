// scripts/pmu/vega.mjs — THE ONE VEGA FUNCTION (C648a, 2026-10-05). The semantic vega is the sample standard deviation
// of sigmaDrift over the priced window of data/pmu/measure-history.ndjson. Until C648a that formula lived inline in
// advisory-premium.mjs; the graph on /backup and /backup/curve needs the same number at every point of the sealed history,
// so the formula moved here and BOTH import it (one rule, one place): advisory-premium.mjs prices the print with
// seriesVega(), and src/lib/backup/vega-graph.mjs draws the line with vegaHistory(), whose last point over the window the
// print names IS the print's vega.
//
// SUFFICIENT FOR: how much the drift placement spread across a window of commits, recomputable from the sealed rows.
// NOT SUFFICIENT FOR: whether any commit was good (Rice, 1953), a loss figure, or telling a change in behaviour from a
// slide of the window — that last one is why the line is drawn across the whole history and not printed as one point.
// Port row: C648a-r (decides a priced number — moves into the crate once the graph is in use).
// @guard tests/vna/c648a-vega-is-the-newest-graph.test.mjs

export const VEGA_MIN_ROWS = 30;   // the series aperture floor advisory-premium.mjs CURVE.minRows names — below it, REFUSED
export const VEGA_WINDOW = 200;    // the priced window: appendPricedRow's cap in scripts/pmu/ledger-attest.mjs

/** sample standard deviation of the finite values; null below two values (no spread to read) */
export function vegaOfSigmas(sigmas) {
  const s = (sigmas || []).map(Number).filter(Number.isFinite);
  if (s.length < 2) return null;
  const m = s.reduce((a, b) => a + b, 0) / s.length;
  return Math.sqrt(s.reduce((a, x) => a + (x - m) * (x - m), 0) / (s.length - 1));
}

/** the print's procedure over parsed rows: REFUSED (vega null) below the floor, else the stddev of sigmaDrift */
export function seriesVega(rows, { minRows = VEGA_MIN_ROWS } = {}) {
  const rs = (rows || []).filter(Boolean);
  const sig = rs.map((r) => Number(r.sigmaDrift)).filter(Number.isFinite);
  if (rs.length < minRows || sig.length < minRows) return { n: rs.length, vega: null };
  return { n: rs.length, vega: vegaOfSigmas(sig) };
}

const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };

/**
 * the vega over time: one point per ledger line (archive + current, oldest first), each the seriesVega of the trailing
 * `window` lines ending there — exactly the window a print taken at that row would have priced. A point below the floor is
 * null (UNMEASURED), never a zero, and it still counts: the series is as long as the history it was read from.
 */
export function vegaHistory(lines, { window = VEGA_WINDOW, minRows = VEGA_MIN_ROWS } = {}) {
  const rows = (lines || []).map((l) => (typeof l === 'string' ? parse(l) : l));
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = seriesVega(rows.slice(Math.max(0, i + 1 - window), i + 1), { minRows }).vega;
  return out;
}

/** the printed form of a vega (advisory-premium rounds to two places) */
export const printedVega = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(2));
