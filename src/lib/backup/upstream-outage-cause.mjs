// src/lib/backup/upstream-outage-cause.mjs — C560a UNCERTAINTY — UPSTREAM API OUTAGE AS ITS OWN CAUSE
// (operator 2026-10-02, the MARKET FIT, RECOGNITION AND THE UNDERWRITING TIPPING POINT dictation, verbatim: "Expand
// real-time root-cause categorization to classify adversarial prompt injections and upstream API outages alongside
// standard context-mass bloat.")
//
// WHAT THIS BUILDS: one more `(rung, cause)` class for the C534 cause ranking (scripts/vna/steer-ab-rules.mjs
// rankedCauses), beside the context-bloat causes ladderOf already writes and C557d's injection-shaped class
// (src/lib/backup/injection-shaped-cause.mjs). A call is counted as upstream-outage when ITS OWN RECORD carries a
// provider error status — the transcript row's `apiErrorStatus` (5xx, 529 overloaded included) or its `error` field
// naming a provider-side failure (server_error · overloaded_error · api_error · timeout). It is READ OFF THE ROW, never
// inferred: a slow call, a short reply, an empty usage block or a missing row is NOT counted as an outage — absent a
// status, the class says nothing.
//
// WHAT IS NOT AN OUTAGE, ON PURPOSE: 429 rate_limit (our quota, 315 such rows on the record at 2026-10-02) and 401
// authentication_failed (our credential) are statuses the provider returned correctly about OUR account. Counting them
// as upstream would place our own limit on the provider's ledger, so they stay out of this class.
//
// WHY RUNG 3: rung 3 is read off the run's own per-call usage. A call the provider failed returned no usage, so that is
// the rung whose reading the failed call breaks; it is counted there, never on a new rung.
//
// LLM-FREE, BY CONSTRUCTION: a numeric range test and a lookup in a published, frozen list of error names. Nothing is
// scored, nothing calls a model. Sufficient for WHERE a break came from on the record; whether the work was good is
// undecidable (Rice, 1953) and this reading does not touch it.
//
// Port row: none yet (a field read over recorded rows; add to the Rust punch list if it moves off the prototype path).
// @guard tests/vna/c560a-upstream-outage-cause.test.mjs
import { rankedCauses } from '../../../scripts/vna/steer-ab-rules.mjs';

export const RUNG = 'rung3';

export const SUFFICIENT_FOR = "counting, per call, whether the call's own record carries a provider error status (5xx, overloaded, timeout), read off the row";
export const NOT_SUFFICIENT_FOR = "any outage the record does not carry a status for (a slow call, a dropped row), or any claim about the provider's availability beyond these rows — whether the work was good is undecidable (Rice, 1953) independent of this reading";

/** the published provider-side error names this class reads — never a quota (rate_limit) or credential (authentication_failed) error */
export const UPSTREAM_ERROR_NAMES = Object.freeze(['server_error', 'overloaded_error', 'api_error', 'timeout', 'timeout_error', 'overloaded']);

const statusOf = (row) => {
  if (!row) return null;
  for (const v of [row.apiErrorStatus, row.api_error_status, row.status]) { const n = Number(v); if (v != null && Number.isInteger(n)) return n; }
  return null;
};
const errorNameOf = (row) => {
  if (!row) return null;
  const e = row.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof e.type === 'string') return e.type;
  return null;
};

/** the status of a provider-side failure carried on the row, or null — 5xx by number, or a published error name */
export function upstreamStatusOf(row) {
  const s = statusOf(row);
  if (s === 429 || s === 401 || s === 403) return null;   // our quota or our credential — the provider answered correctly
  if (s != null && s >= 500 && s <= 599) return s;
  const name = errorNameOf(row);
  if (name && UPSTREAM_ERROR_NAMES.includes(name)) return s ?? name;
  return null;
}

/** true only when the row itself carries a provider error status — never inferred from silence, latency or empty usage */
export const upstreamOutage = (row) => upstreamStatusOf(row) != null;

export const UPSTREAM_CAUSE = "upstream-outage — the call's own record carries a provider error status (5xx, overloaded, timeout)";

/** the (rung, cause) entries in C534's `flagged` shape ({ sha, day, route, rung, savings, cause }), plus the status read */
export function upstreamOutageFlags(rows) {
  const out = [];
  for (const r of rows || []) {
    const status = upstreamStatusOf(r);
    if (status != null) out.push({ sha: r.sha ?? null, day: r.day ?? null, route: r.route ?? null, rung: RUNG, savings: null, cause: UPSTREAM_CAUSE, status });
  }
  return out;
}

/** the C534 ranking (rankedCauses, imported, never re-derived) over existing flags with this class folded in beside them */
export function rankedCausesWithUpstream(flagged, rows) {
  return rankedCauses([...(flagged || []), ...upstreamOutageFlags(rows)]);
}
