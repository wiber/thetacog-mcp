// src/lib/backup/record-readiness.mjs — C1217 RECORD READINESS (operator 2026-10-22: "lets implement the credit score / readiness -
// (clearly if we jump in and convert warranties that takes a hit) we should be able to make that arithmetic based on tape / 3rd party
// backups?"). The public word is READINESS (C1216: never "credit score"; "Standing" already names the 📝 standing answers, C921).
//
// The arithmetic, end to end, with nothing new in it:
//   HELD     — a tape row counts only when a countersigned third-party backup holds it: rows.slice(0, height), height = the highest
//              manifest.rows.flight_tape among the upload receipts the server countersigned (countersignedBackedUp's height, C111).
//              A row the actor's own machine alone holds is the actor's account of itself (AXIOM 1, W3) — it waits for the next backup.
//   ELIGIBLE — warrantyReading()'s one predicate (src/lib/backup/warranty.mjs) over the held rows, under the bound terms; live rows
//              (after the freeze) and the backtest (before it) stay two records, never summed.
//   FIRES    — the live trigger fires (our receipt read green on work that landed past the declared threshold) PLUS every claim the
//              holder called on our act that is not already one of those fires. A converted warranty is a fire: calling a claim
//              lowers readiness, by construction, which is the hit the operator named.
//   READINESS— tapeReadiness({ eligible, fires }) (warranty-trial.mjs, C991), never a second formula: the Wilson 95 % upper bound, and
//              how many more held eligible commits the record needs before the trigger prices at the 5 % line.
// SUFFICIENT FOR: how far this record sits from a priceable trigger, recomputable from the tape, the upload receipts and the terms.
// NOT SUFFICIENT FOR: whether the agent's work was good (Rice, 1953), any price (the carrier sets it), or a promise about the agent.
// PORT ROW: C1217r — the held/fires arithmetic moves into the crate beside the walk once the pill is in use (MAXIMISE RUST).
// @guard tests/vna/c1217-build-the-pure-reader-packages-thetacog.test.mjs
import { warrantyReading } from './warranty.mjs';
import { tapeReadiness } from './warranty-trial.mjs';

export const CLAIMS_FILE = '.thetacog/warranty-claims.ndjson';   // one row per claim the holder called on our act: { at, sha?, type }
export const HEAD_WORD = 'Record readiness';
export const CARRIER_LINE = 'Your carrier sets the price; this is the record it reads.';

/** the countersigned height: the highest flight-tape row count a server-countersigned upload's manifest holds. `uploads` is
 *  [{ upload, manifest }]; an upload with no server countersign or no manifest beside it covers no height — never a guess. */
export function heldHeight(uploads = []) {
  let height = 0, countersigned = 0;
  for (const u of uploads || []) {
    const up = u && u.upload; const man = u && u.manifest;
    if (!up || up.ok === false || !up.countersigned_at) continue;
    countersigned += 1;
    const h = man && man.rows && Number.isFinite(man.rows.flight_tape) ? man.rows.flight_tape : 0;
    if (h > height) height = h;
  }
  return { height, countersigned };
}

const unmeasured = (why) => ({ status: 'UNMEASURED', why });

/** C1217 — the record readiness reading. `rows` = the flight tape (receiptOnly rows, in tape order); `uploads` as heldHeight;
 *  `claims` = the claims ledger rows, or null when the workspace holds no ledger (claims then read UNMEASURED, never 0). */
export function recordReadiness({ rows = null, uploads = [], terms = null, frozenAt = null, claims = null } = {}) {
  if (!Array.isArray(rows)) return { status: 'UNMEASURED', why: 'no flight tape in this workspace (data/vna/flight-tape.ndjson) — the walk writes it on each commit' };
  const { height, countersigned } = heldHeight(uploads);
  const h = Math.min(height, rows.length);
  const held = warrantyReading({ rows: rows.slice(0, h), terms, frozenAt });
  const all = warrantyReading({ rows, terms, frozenAt });
  const bound = held.status === 'BOUND';
  const falseGreens = held.live.fires;
  const fireShas = new Set(falseGreens.map((f) => f && f.sha).filter(Boolean));
  const claimRows = Array.isArray(claims) ? claims.filter((c) => c && typeof c === 'object') : null;
  const calledShas = new Set((claimRows || []).map((c) => c.sha).filter(Boolean));
  const extraCalls = claimRows ? claimRows.filter((c) => !c.sha || !fireShas.has(c.sha)).length : 0;
  const fires = falseGreens.length + extraCalls;
  const live = tapeReadiness({ eligible: held.live.eligible, fires }).trigger;
  const backtest = tapeReadiness({ eligible: held.backtest.eligible, fires: held.backtest.fires.length }).trigger;
  return {
    status: bound ? 'MEASURED' : 'PREVIEW',
    why: bound ? null : 'no bound terms — the next backup carries .thetacog/warranty-terms.json and the server freezes it; until then every row is backtest',
    held: { height: h, countersigned, rows: rows.length, unheldEligible: all.live.eligible - held.live.eligible + all.backtest.eligible - held.backtest.eligible },
    eligible: held.live.eligible,
    ourFalseGreens: falseGreens.length,
    claimsCalled: claimRows ? claimRows.length : unmeasured(`no claims ledger at ${CLAIMS_FILE}`),
    claimsUncalled: claimRows ? falseGreens.filter((f) => !calledShas.has(f.sha)).length : unmeasured(`no claims ledger at ${CLAIMS_FILE}`),
    fires,
    pUpper: live.pUpper,
    priceable: live.priceable,
    eligibleNeededForPriceable: live.eligibleNeededForPriceable == null ? null : Math.max(0, live.eligibleNeededForPriceable - live.eligible),
    backtest: { eligible: backtest.eligible, fires: backtest.fires, pUpper: backtest.pUpper, priceable: backtest.priceable },
    sources: { tape: 'data/vna/flight-tape.ndjson', held: '.thetacog/backup/*.upload.json + *.manifest.json', predicate: 'src/lib/backup/warranty.mjs warrantyReading', formula: 'src/lib/backup/warranty-trial.mjs tapeReadiness', claims: CLAIMS_FILE },
  };
}

const n = (v) => (v && typeof v === 'object' && v.status === 'UNMEASURED' ? 'UNMEASURED' : String(v));

/** the pill face, one line, read off recordReadiness() alone. */
export function readinessFace(r) {
  if (!r || r.status === 'UNMEASURED') return `${HEAD_WORD} · UNMEASURED — ${r ? r.why : 'not read'}`;
  const after = r.priceable ? 'priceable now' : r.eligibleNeededForPriceable == null ? 'no reachable count prices it at this fire rate' : `priceable after ${r.eligibleNeededForPriceable} more`;
  const claims = n(r.claimsUncalled) === 'UNMEASURED' ? 'claims UNMEASURED (no ledger)' : `${r.claimsUncalled} claims left uncalled`;
  return `${HEAD_WORD} · ${r.eligible} commits held by a third party · ${claims} · ${after}`;
}

/** the expanded lines: each count with its source, then the carrier line. */
export function readinessLines(r) {
  if (!r || r.status === 'UNMEASURED') return [readinessFace(r), CARRIER_LINE];
  const pct = (p) => `${Math.round(p * 10000) / 100} %`;
  return [
    ...(r.status === 'PREVIEW' ? [`PREVIEW — ${r.why}`] : []),
    `held: ${r.held.height} of ${r.held.rows} tape rows sit inside ${r.held.countersigned} countersigned backups (${r.sources.held}); ${r.held.unheldEligible} eligible commits wait for the next backup`,
    `eligible since the terms froze: ${r.eligible} (${r.sources.predicate})`,
    `our false greens: ${r.ourFalseGreens} · claims called: ${n(r.claimsCalled)} · each called claim counts as a fire (${r.sources.claims})`,
    `upper bound on the fire rate: ${pct(r.pUpper)} at 95 % (${r.sources.formula})`,
    `backtest, before the terms froze: ${r.backtest.eligible} eligible, ${r.backtest.fires} fires, upper bound ${pct(r.backtest.pUpper)} — a separate record, never summed`,
    CARRIER_LINE,
  ];
}
