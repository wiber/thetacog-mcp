// src/lib/backup/warranty-trial.mjs — C939 THE WARRANTY TRIAL, AS MATH THAT CANNOT BECOME INSURANCE OR RUN AWAY (operator 2026-10-17: "lets
// update both our answers and the questions to land the warranty business plan (and the door for users to stake their claim in - ie sell
// licneses by telling people on the vsx market page 1) save tokens 2) be part of the warranty revolution (as a trial I will do the consulting
// when the thing fails on your deployment, and pay a multiple on your licenses when warranty activeated /// cover ourselves sure - but lets
// figure out how to make this work … you must buy a floor of licenses to qualify obviously) ... lets formal methods on this to optimise the
// warranty math - make it attractive").
//
// THE SHAPE (each clause is a property the guard proves):
//   1. A holder who buys at least the FLOOR of licences joins the trial.
//   2. PREPAID HOURS come with the purchase and are redeemable AT WILL, fire or no fire — a service bought, never a benefit triggered by the
//      holder's loss (warranty-levels.mjs PREPAID_RULE). This is where "I will do the consulting when the thing fails on your deployment"
//      lives: the holder spends those hours whenever their agent fails, and nothing about their agent's failure moves money from us.
//   3. THE MULTIPLE pays only when OUR ACT fails — a dispatch that missed its window, a trigger that did not fire as declared, a re-run
//      whose bytes differ from the receipt, a gap in the tape — once per period, at most multiple × the holder's LIVE SPEND (C955: the
//      value of licences bought and NOT YET USED, never the raw purchase), IN KIND (API credits we buy for them, and the operator's hours
//      of equal value). A failure of the holder's agent never moves it: paying on the deployer's event would be insurance (NY Ins. Law §
//      1101(a)(1); C895).
//   4. THE STOP-LOSS: in any period, everything the multiple pays across all holders is at most stopLossShare × LIVE TRIAL SPEND summed
//      across every holder (C955), never the period's new sales — a quiet sales month no longer zeroes the pool, because the balance
//      still at risk (bought, not yet used) does not vanish just because nobody bought this period. Past the limit, claims are paid pro
//      rata. The total is bounded whatever the failure rate turns out to be.
//   5. THE SAFE MULTIPLE is read off our own record: with f failures of our act in N holder-periods, p_upper is the Wilson upper bound, and
//      the largest multiple whose expected cost stays inside the stop-loss is floor(stopLossShare / p_upper). Fewer failures, larger
//      multiple: the offer gets more attractive exactly as our act proves reliable, and never faster than the record allows.
// The numbers in TRIAL_PROPOSAL are PROPOSED: the operator sets them, and counsel reads the terms before any page offers them.
// SUFFICIENT FOR: what a holder gets, when the multiple pays, and that the pool stays bounded. NOT SUFFICIENT FOR: whether the terms are a
// warranty and not insurance in a given state (counsel), or whether any agent's work was good (Rice, 1953).
// @guard tests/warranty-plan/c939-warranty-trial-math.test.mjs
// @guard tests/vna/c957-the-holder-sets-the-multiple-and.test.mjs (priceFor)
// @guard tests/vna/c956-the-hours-accrue-on-credits-used.test.mjs (hoursAccrued, fileHoursLedger, hoursCeiling, redeemHours)
// @guard tests/vna/c955-the-payout-base-is-live-spend.test.mjs (liveSpend, liveTrialSpendUsd, trialTerms' onOurActFailure basis)
// @guard tests/vna/c974-the-variables-balanced-in-one-place.test.mjs (balance, FIT_BAND_CEILING, FIREABLE_BAND)
// @guard tests/vna/c978-the-redline-tier-push-it-harder.test.mjs (redlineTerms, redlineCountsAsFailure)
import { wilson } from './exceedance.mjs';

export const OUR_ACT_FAILURES = Object.freeze(['dispatch-missed', 'trigger-not-as-declared', 'rerun-bytes-differ', 'tape-gap']);

export const TRIAL_PROPOSAL = Object.freeze({
  floor: 25,                // licences to qualify ($500 at a $20 licence, 250,000 notarised receipts)
  prepaidHoursPerFloor: 1,  // consulting hours redeemable at will, per floor bought
  multiple: 2,              // × licence spend, in kind, when our act fails in the period — day one's safe multiple (safeMultiple at 20 clean holder-periods); it rises with the record
  hourValueUsd: 250,        // what one operator hour counts as inside an in-kind payout
  creditShare: 0.5,         // the share of an in-kind payout paid as API credits we buy for the holder; the rest as hours
  stopLossShare: 0.4,       // the most the multiple pays in a period, as a share of live trial spend across all holders (C955), under the incidental line
  hoursPerLicencesUsed: 25,       // C956 — accrual rate: one hour per this many licences of CREDITS USED (the operator may set 50)
  hoursExpiryMonths: 12,          // C956 — an accrued hour expires this many months after it accrues
  hoursCapPerHolderPerMonth: 4,   // C956/D6 — the monthly ceiling on redeemed hours, one holder
  hoursCapAllHoldersPerMonth: 20, // C956/D6 — the monthly ceiling on redeemed hours, summed across every holder
  period: 'calendar month', // D1 (C1007): one claim per holder per calendar month; the pool and the stop-loss read per month
  yearCoverBonusHours: 2,   // C1007: once, when a purchase at or above the floor covers one agent-year at the holder's declared burn — the floor's 1 h becomes a 3 h setup block
  maxMultiple: 5,           // C1007: the most any holder is offered, whatever the record supports; safeMultiple still reports the raw figure
  contractorHourlyUsd: 150, // C1007: the market mid for a senior contractor — the hiring threshold reads against it
  supportShare: 0.5,        // C1007: the share of licence revenue the program lets support cost; the other half is the instrument
  status: 'PROPOSED — the operator sets these numbers; counsel reads the terms before any page offers them',
});

const round2 = (x) => Math.round(x * 100) / 100;

// C1007: the licence unit — $20 buys 10,000 credits, one per stamped row (data/vna/notary-price.json metadata.credits_per_unit)
export const CREDITS_PER_LICENCE = 10000;
// C1007: the founder's monthly ceiling across all holders, ONE place — dispatch-market.mjs and gtm-ratchet.mjs import it from here
export const FOUNDER_MONTHLY_CEILING_HOURS = TRIAL_PROPOSAL.hoursCapAllHoldersPerMonth;

/** C1007: hours that accrue with use, counted in credits — one per hoursPerLicencesUsed licences consumed; an unused purchase accrues none */
export function accruedHours({ creditsUsed = 0, p = TRIAL_PROPOSAL } = {}) {
  return Math.floor(Math.max(0, Number(creditsUsed) || 0) / (CREDITS_PER_LICENCE * p.hoursPerLicencesUsed));
}

/** C1007: the year-cover bonus — at or above the floor, a purchase whose credits cover 365 days at the holder's declared burn carries
 *  yearCoverBonusHours once; no burn declared → no bonus (never assumed) */
export function yearCoverBonus({ units = 0, burnRowsPerDay = null, p = TRIAL_PROPOSAL } = {}) {
  if (!(units >= p.floor) || !(Number(burnRowsPerDay) > 0)) return { hours: 0, covers: null };
  const covers = units * CREDITS_PER_LICENCE >= burnRowsPerDay * 365;
  return { hours: covers ? p.yearCoverBonusHours : 0, covers };
}

/** C955 — live spend for one holder: the value of licences bought and NOT YET USED (bought − used, never negative)
 *  at the holder's priceUsd. `licencesUsed` defaults to 0 — nothing spent yet, so the full purchase is still live. */
export function liveSpend({ units = 0, priceUsd = 20, licencesUsed = 0, creditsUsed = null }) {
  if (creditsUsed != null) licencesUsed = Math.max(0, Number(creditsUsed) || 0) / CREDITS_PER_LICENCE;   // C1007: the branch counted in credits
  return round2(Math.max(0, Math.max(0, units) - Math.max(0, licencesUsed)) * priceUsd);
}

/** C955 — the stop-loss base: live spend summed across every holder on the trial, never the period's new sales.
 *  `holders` is one row per holder, [{ units, priceUsd, licencesUsed }] — whatever each holder bought and has not
 *  yet used stays in the base even in a period where nobody buys a fresh licence. */
export function liveTrialSpendUsd(holders = []) {
  return round2((holders || []).reduce((a, h) => a + liveSpend(h), 0));
}

/** what a purchase of `units` licences at `priceUsd` carries under the trial. `licencesUsed` (C955, default 0) is
 *  how much of that purchase the holder has already spent down — the multiple pays on what is still LIVE (bought,
 *  not yet used), never on the raw purchase: a holder who has used all of it carries no claim, however much they
 *  once bought. */
export function trialTerms({ units, priceUsd, licencesUsed = 0, creditsUsed = null, burnRowsPerDay = null, p = TRIAL_PROPOSAL }) {
  const spend = round2(Math.max(0, units) * priceUsd);
  const liveSpendUsd = liveSpend({ units, priceUsd, licencesUsed, creditsUsed });
  const qualifies = units >= p.floor;
  const floors = qualifies ? Math.floor(units / p.floor) : 0;
  const onOurAct = round2(p.multiple * liveSpendUsd);
  return {
    qualifies, units, spend, liveSpendUsd,
    prepaid: (() => {   // C1007: purchase-day hours + the year-cover bonus + hours accrued on credits used
      const bonus = qualifies ? yearCoverBonus({ units, burnRowsPerDay, p }) : { hours: 0, covers: null };
      const accrued = qualifies && creditsUsed != null ? accruedHours({ creditsUsed, p }) : 0;
      const atPurchase = floors * p.prepaidHoursPerFloor + bonus.hours;
      return { hours: atPurchase + accrued, atPurchase, yearCoverBonus: bonus.hours, coversAgentYear: bonus.covers, accrued, rule: 'redeemable at will, fire or no fire' };
    })(),
    onOurActFailure: qualifies
      ? { totalUsd: onOurAct, baseUsd: liveSpendUsd, creditsUsd: round2(onOurAct * p.creditShare), hours: round2((onOurAct * (1 - p.creditShare)) / p.hourValueUsd), once: 'per period' }
      : null,
  };
}

const periodKey = (ts) => new Date(ts).toISOString().slice(0, 7);

/** C959 — ONE CLAIM PER PERIOD, NEVER RESET BY THE AGENT'S BEHAVIOUR (D1, D3): the period is a calendar month
 *  (periodKey); a holder who already drew a paid claim this period draws nothing further this period. The
 *  paste's rule — a payout resets the holder's base until "500 clean in-lane ticks" — is refused: the only inputs
 *  here are `terms` (the purchase) and `priorClaims` (what was already paid, by timestamp), never a count of the
 *  holder's agent's ticks, clean or otherwise. A new calendar month reopens the claim in full, with no ticks to
 *  rebuild first — reclaiming depends on the period turning over, never on the agent's record since the last
 *  payout. */
export function claimPeriodGate({ terms, priorClaims = [], nowMs = Date.now() }) {
  if (!terms || !terms.qualifies) return { mayClaim: false, period: periodKey(nowMs), why: 'below the floor: no trial' };
  const period = periodKey(nowMs);
  const already = (priorClaims || []).some((c) => c && c.usd > 0 && periodKey(c.ts) === period);
  if (already) return { mayClaim: false, period, why: 'already claimed this period' };
  return { mayClaim: true, period, why: 'no claim paid this period yet' };
}

/** what the multiple owes ONE holder in one period, from the typed events on their tape: only our act's failures
 *  count, and C959's claimPeriodGate runs first — `priorClaims` is the only history this reads, never a tally of
 *  the holder's agent's behaviour. */
export function holderClaim({ terms, events = [], priorClaims = [], nowMs = Date.now() }) {
  if (!terms || !terms.qualifies) return { usd: 0, why: 'below the floor: no trial' };
  const gate = claimPeriodGate({ terms, priorClaims, nowMs });
  if (!gate.mayClaim) return { usd: 0, why: gate.why, period: gate.period };
  const ours = events.filter((e) => OUR_ACT_FAILURES.includes(e && e.type));
  if (!ours.length) return { usd: 0, period: gate.period, why: events.length ? 'only events of the holder\'s own agent: never a claim against the warrantor' : 'no failure of our act' };
  return { usd: terms.onOurActFailure.totalUsd, period: gate.period, why: `our act failed: ${[...new Set(ours.map((e) => e.type))].join(', ')}` };
}

/** the period's pool: pays every claim in full while the total stays inside the stop-loss, otherwise pro rata — never above it */
export function poolPayout({ claims = [], revenueUsd, p = TRIAL_PROPOSAL }) {
  const owed = round2(claims.reduce((a, c) => a + (c.usd || 0), 0));
  const limit = round2(p.stopLossShare * revenueUsd);
  const factor = owed <= limit || owed === 0 ? 1 : limit / owed;
  return { owed, limit, factor, paid: round2(Math.min(owed, limit)), perClaim: claims.map((c) => round2((c.usd || 0) * factor)) };
}

/** the largest multiple the record supports: expected cost p_upper × multiple stays inside the stop-loss share */
export function safeMultiple({ failures, holderPeriods, p = TRIAL_PROPOSAL }) {
  if (!Number.isInteger(holderPeriods) || holderPeriods <= 0) return { multiple: null, why: 'UNMEASURED — no holder-periods on record yet' };
  const ci = wilson(failures, holderPeriods);
  const pUpper = ci ? ci[1] : 1;
  const multiple = Math.max(0, Math.floor(p.stopLossShare / pUpper));
  return { multiple, offered: Math.min(multiple, p.maxMultiple), pUpper, failures, holderPeriods };   // C1007: offered never above maxMultiple
}

// the agent-year licence price at the day-one multiple (p.multiple) — the $20 base the operator struck before any
// record existed. priceFor scales up from here; it never scales down past it.
export const BASE_PRICE_USD = 20;

/** C957 — THE HOLDER SETS THE MULTIPLE AND THE LICENCE PRICE RISES WITH IT (operator 2026-10-17: "my agent year
 *  license costs increase - you can set / optimise your agent year multiple"). The price scales linearly with the
 *  chosen multiple from the $20 base struck at the day-one multiple (p.multiple): priceUsd = base × multiple / p.multiple.
 *  The chosen multiple is capped at safeMultiple read off our own record (failures, holderPeriods); with no record
 *  yet the cap holds at the day-one multiple itself — the price can only rise once the record supports it, never on
 *  a holder's say alone. Because safeMultiple is defined so pUpper × multiple stays inside stopLossShare (C939.6),
 *  and stopLossShare < 0.5, the warranty-attributable share of the price (pUpper × the chosen multiple) stays under
 *  the incidental line (W10) for every allowed multiple, by construction. */
export function priceFor({ multiple, failures, holderPeriods, p = TRIAL_PROPOSAL, basePriceUsd = BASE_PRICE_USD } = {}) {
  const requested = Number.isFinite(multiple) ? multiple : p.multiple;
  const safe = safeMultiple({ failures, holderPeriods, p });
  const cap = Math.min(Number.isInteger(safe.multiple) ? Math.max(safe.multiple, p.multiple) : p.multiple, p.maxMultiple);   // C1007: never above maxMultiple
  const effectiveMultiple = Math.min(Math.max(requested, p.multiple), cap);
  const priceUsd = round2(basePriceUsd * (effectiveMultiple / p.multiple));
  const pUpper = safe.pUpper != null ? safe.pUpper : null;
  const warrantyShare = pUpper != null ? round2(pUpper * effectiveMultiple) : null;
  return {
    requestedMultiple: requested,
    cappedAt: cap,
    multiple: effectiveMultiple,
    priceUsd,
    basePriceUsd,
    warrantyShare,
    underIncidentalLine: warrantyShare == null ? true : warrantyShare < 0.5,
  };
}

// C956 — THE HOURS ACCRUE ON CREDITS USED (operator 2026-10-17: "relative to your licenses purchased and used"): prepaid
// hours accrue at hoursPerLicencesUsed licences of credits USED, not merely bought, so idle licences never earn hours;
// each batch of accrued hours expires hoursExpiryMonths after it accrues, and redemption is capped per holder and across
// every holder per month (D6) off an append-only ledger — never invented, never a default of zero.
export const HOURS_LEDGER_PATH = '.thetacog/backup/hours-redeemed.ndjson';

/** hours accrued from `licencesUsed` credits used so far, and the timestamp that batch expires at */
export function hoursAccrued({ licencesUsed = 0, accruedAtMs = Date.now(), p = TRIAL_PROPOSAL }) {
  const hours = Math.floor(Math.max(0, licencesUsed) / p.hoursPerLicencesUsed);
  if (!hours) return { hours: 0, accruedAtMs, expiresAtMs: null };
  const expires = new Date(accruedAtMs);
  expires.setUTCMonth(expires.getUTCMonth() + p.hoursExpiryMonths);
  return { hours, accruedAtMs, expiresAtMs: expires.getTime() };
}

/** ndjson, append-only, one row per redemption: { holder, hours, creditsUsd, ts } — carrier-grant.mjs's fileGrantStore
 *  shape: re-read on every call so a re-open is a cold start, never cached stale. */
export function fileHoursLedger(path, fs) {
  if (!fs || typeof fs.appendFileSync !== 'function') throw new Error('fileHoursLedger needs an injected fs (node only)');
  return {
    kind: 'file', path,
    rows() { return fs.existsSync(path) ? fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; },
    append(row) { fs.appendFileSync(path, JSON.stringify(row) + '\n'); return row; },
  };
}

const monthKey = (ts) => new Date(ts).toISOString().slice(0, 7);

/** D6 — the monthly hours ceiling, read off the ledger alone: an empty ledger reads UNMEASURED (no record yet of
 *  anyone redeeming), never "0 used" — AXIOM 1's rule that an absent measurement is UNMEASURED, not invented. */
export function hoursCeiling({ ledger, holder, nowMs = Date.now(), p = TRIAL_PROPOSAL }) {
  const rows = ledger.rows();
  if (!rows.length) return { status: 'UNMEASURED', why: 'the ledger has no rows yet — no record of anyone redeeming', holderHours: 0, allHoldersHours: 0 };
  const mk = monthKey(nowMs);
  const inMonth = rows.filter((r) => monthKey(r.ts) === mk);
  const holderHours = round2(inMonth.filter((r) => r.holder === holder).reduce((a, r) => a + (r.hours || 0), 0));
  const allHoldersHours = round2(inMonth.reduce((a, r) => a + (r.hours || 0), 0));
  return {
    status: 'MEASURED', holderHours, allHoldersHours,
    holderRoom: round2(Math.max(0, p.hoursCapPerHolderPerMonth - holderHours)),
    allHoldersRoom: round2(Math.max(0, p.hoursCapAllHoldersPerMonth - allHoldersHours)),
  };
}

/** redeem `requestedHours` for `holder`: pays hours up to whatever room the D6 caps leave (an UNMEASURED ledger grants
 *  the request in full — its own row is the first measurement), and converts every hour past the ceiling to API
 *  credits at hourValueUsd — the in-kind payout never shrinks, only its shape changes once the ceiling binds. */
export function redeemHours({ ledger, holder, requestedHours, nowMs = Date.now(), p = TRIAL_PROPOSAL }) {
  const ceiling = hoursCeiling({ ledger, holder, nowMs, p });
  const room = ceiling.status === 'UNMEASURED' ? Math.max(0, requestedHours) : Math.max(0, Math.min(ceiling.holderRoom, ceiling.allHoldersRoom));
  const hours = round2(Math.min(Math.max(0, requestedHours), room));
  const overflowHours = round2(Math.max(0, requestedHours - hours));
  const creditsUsd = round2(overflowHours * p.hourValueUsd);
  const row = { holder, hours, creditsUsd, ts: new Date(nowMs).toISOString() };
  if (hours > 0 || creditsUsd > 0) ledger.append(row);
  return { ...row, overflowHours, ceiling };
}

// C1012c THE SETUP HOUR IS THE FIRST DISPATCH ON THE MAP (operator 2026-10-18 /goal, the ladder: docs/strategy/2026-10-18-the-ladder-to-buy.txt):
// a non-coder's booked hour ("we move your app to GitHub and install Steer with you") pays from the holder's own accrued
// hours through redeemHours (C956) and opens the first row on the dispatch ledger (C898, read by dispatchReading and
// speed-curve.mjs for C965) — the same row later carries arrived_at and a closed event, so the setup hour is read with
// the same arrival-and-resolve clocks as every dispatch after it, never a second ledger.
export const SETUP_HOUR_LABEL = 'The setup hour: we move your app to GitHub and install Steer with you.';
export const SETUP_HOUR_HOURS = 1;
export const SETUP_HOUR_FIRE_PREFIX = 'setup-hour:';
export function setupHourFireRowSha(holder) { return `${SETUP_HOUR_FIRE_PREFIX}${holder}`; }

/** bookSetupHour: pay SETUP_HOUR_HOURS off the holder's C956 ledger and open their dispatch row (C898) in one call —
 *  the hour that is not paid from the ledger (overflowHours > 0) still opens the dispatch row; the booking is a
 *  commitment to dispatch, not a refusal gated on the holder's banked balance. */
export async function bookSetupHour({ ledger, dispatches, holder, provider = 'Elias Moosman', nowMs = Date.now(), p = TRIAL_PROPOSAL }) {
  if (!ledger || !dispatches || !holder) throw new Error('bookSetupHour needs an hours ledger, a dispatch store and a holder');
  const paid = redeemHours({ ledger, holder, requestedHours: SETUP_HOUR_HOURS, nowMs, p });
  const fire_row_sha = setupHourFireRowSha(holder);
  const opened = await dispatches.append({ account_id: holder, fire_row_sha, event: 'opened', provider, at: new Date(nowMs).toISOString() });
  return { ...paid, fire_row_sha, provider, opened_at: opened.at, label: SETUP_HOUR_LABEL };
}

/** C939b — who may join the trial (operator 2026-10-17: the survey is "the demand signal - the false door"): all ten standing answers
 *  given (a ___ blank left is not an answer) AND at least the floor of licences. The gate is eligibility for an offer, never a judgement
 *  of the holder's agent: nothing the agent does after joining moves the multiple (holderClaim pays on our act only). */
export function trialEligibility({ answered, of = 10, units = 0, p = TRIAL_PROPOSAL }) {
  const missing = [];
  if (!(answered >= of)) missing.push(`answer ${of - (answered || 0)} more of the ten standing questions`);
  if (!(units >= p.floor)) missing.push(`hold at least ${p.floor} licences (you hold ${units || 0})`);
  return { eligible: missing.length === 0, missing, floor: p.floor };
}

// C964 THE BALANCE BUYS SLA AMPLIFICATION, A WARRANTY ON OUR OWN ACT (operator 2026-10-18: "huge balance means we
// can prioritize you in cue when something does go wrong for example - its not that you are buying hours of
// cunsulting - can we set this up you are buying SLA amplification (warranties though..)"): the holder's live
// balance sets their place in the dispatch queue (dispatch-market.mjs queueOrder, C968 — balance desc, fire time
// asc) and WITH IT the dispatch window warranted here, tighter for a larger balance, read off ONE published step
// table. Queue order and window both read the same two numbers, balance and fire time, and nothing else: no event
// of the holder's agent is a parameter to either. A miss of the warranted window is 'dispatch-missed', the C939
// OUR_ACT_FAILURES member holderClaim already pays on — the trial pays on our act missing the tightened window,
// never on anything the deployer's own agent did.
//
// WINDOW_STEP_TABLE is the one published table: minBalanceUsd thresholds, each with the hours we warrant a
// dispatch inside. SUFFICIENT FOR: the warranted window at a given live balance, and whether a given dispatch
// missed it. NOT SUFFICIENT FOR: whether the table is actually published on /backup/warranty or the listing
// (a page-content check), or whether an unmeasured dispatch ever happened (Rice, 1953).
// @guard tests/vna/c964-the-balance-buys-sla-amplification-a.test.mjs
export const WINDOW_STEP_TABLE = Object.freeze([
  Object.freeze({ minBalanceUsd: 0, windowHours: 72 }),
  Object.freeze({ minBalanceUsd: 500, windowHours: 24 }),
  Object.freeze({ minBalanceUsd: 2000, windowHours: 8 }),
  Object.freeze({ minBalanceUsd: 10000, windowHours: 2 }),
]);

/** the warranted dispatch window for a live balance: the tightest (lowest) windowHours whose minBalanceUsd the
 *  balance clears, read off `table` alone. A larger balance never buys a LOOSER window, by isMonotoneStepTable
 *  below. */
export function warrantedWindowHours(balanceUsd, table = WINDOW_STEP_TABLE) {
  const sorted = [...table].sort((a, b) => a.minBalanceUsd - b.minBalanceUsd);
  let hours = sorted.length ? sorted[0].windowHours : null;
  for (const row of sorted) {
    if (balanceUsd >= row.minBalanceUsd) hours = row.windowHours;
  }
  return hours;
}

/** true only if `table`'s windowHours never rises as minBalanceUsd rises — the shape WINDOW_STEP_TABLE must
 *  hold, and the shape any future edit to the published table must keep. */
export function isMonotoneStepTable(table) {
  const sorted = [...table].sort((a, b) => a.minBalanceUsd - b.minBalanceUsd);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].windowHours > sorted[i - 1].windowHours) return false;
  }
  return true;
}

/** whether OUR act missed the warranted window — the only three numbers read are fireTimeMs, dispatchTimeMs and
 *  balanceUsd. Nothing the holder's agent did (ticks, prior claims, behaviour) is a parameter, so no agent event
 *  can ever move the verdict. A miss carries type 'dispatch-missed' — feed it straight into holderClaim's
 *  `events` to price it against the multiple. */
export function dispatchMissed({ fireTimeMs, dispatchTimeMs, balanceUsd, table = WINDOW_STEP_TABLE } = {}) {
  const windowHours = warrantedWindowHours(balanceUsd, table);
  const elapsedHours = (dispatchTimeMs - fireTimeMs) / 3_600_000;
  const missed = windowHours == null ? false : elapsedHours > windowHours;
  return { missed, windowHours, elapsedHours, type: missed ? 'dispatch-missed' : null };
}

// C974 THE VARIABLES BALANCED IN ONE PLACE (chair decomposition 2026-10-18 of "Let's teach the Market how to write
// specifications that we can fire on them … it's impossible to follow"): a pure balance({ fit, fireRate,
// suggestedRate, balanceUsd, multiple }) composes the existing readings above (trialTerms' onOurActFailure basis,
// suggestedRate's market rate, WINDOW_STEP_TABLE's balance-tiered window) into one report, over the C939 property
// grid, gaining three properties over it:
//   8. the holder's cost of self-evident fires (holderSelfEvidentFireCostUsd) rises monotonically as `fit` — how
//      tightly the spec is drawn — tightens PAST FIT_BAND_CEILING; at or below the ceiling it is flat at zero, so a
//      spec drawn inside the band never costs the holder anything here.
//   9. our expected pool cost (ourExpectedPoolCostUsd) reads fireRate, suggestedRate and multiple ALONE — `fit`
//      never appears in it, so no tightening of the holder's own spec ever moves our side of the ledger.
//   10. fireSignal is zero at and outside FIREABLE_BAND's floor and ceiling and peaks strictly inside the band
//       (never at an edge) — a fireRate at the map's edge carries no signal; the signal is carried by the ones
//       nearest the band's own middle.
// Every lever (FIT_BAND_CEILING, FIREABLE_BAND) stays PROPOSED — the operator's numbers, not derived from any
// record — and every recommended value balance() returns is labelled predicted: true, never a claim of fact.
// SUFFICIENT FOR: how the five named readings compose into one holder-facing and one pool-facing number, and that
// neither crosses into the other's inputs. NOT SUFFICIENT FOR: the actual FIT_BAND_CEILING or FIREABLE_BAND the
// business runs on (counsel and the operator set those), or whether any one fit score was itself a fair reading of
// a holder's spec (Rice, 1953).
// @guard tests/vna/c974-the-variables-balanced-in-one-place.test.mjs
export const FIT_BAND_CEILING = 0.8; // PROPOSED — fit past this tightens past the band; at or below it, no cost

export const FIREABLE_BAND = Object.freeze({ floor: 1, ceiling: 10 }); // PROPOSED — fires/period inside this band carry a signal

/** a triangular bump over FIREABLE_BAND: zero at and outside floor/ceiling, 1 at the band's own middle — never
 *  reused logic from elsewhere in the file, because this is the only place a fire rate's position IN a band (not
 *  a step table) is read. */
function fireSignal(fireRate, band = FIREABLE_BAND) {
  if (!Number.isFinite(fireRate) || fireRate <= band.floor || fireRate >= band.ceiling) return 0;
  const mid = (band.floor + band.ceiling) / 2;
  const half = (band.ceiling - band.floor) / 2;
  return round2(Math.max(0, 1 - Math.abs(fireRate - mid) / half));
}

/** C974 — the one place fit, fireRate, suggestedRate, balanceUsd and multiple compose: holderSelfEvidentFireCostUsd
 *  (fit alone, past FIT_BAND_CEILING), ourExpectedPoolCostUsd (fireRate · suggestedRate · multiple, never fit), and
 *  fireSignal (fireRate's place in FIREABLE_BAND). balanceUsd rides along for the caller (C964's window) and moves
 *  neither cost here. */
export function balance({ fit = 0, fireRate = 0, suggestedRate = 0, balanceUsd = 0, multiple = TRIAL_PROPOSAL.multiple } = {}) {
  const overCeiling = Math.max(0, fit - FIT_BAND_CEILING);
  const holderSelfEvidentFireCostUsd = round2(fireRate * suggestedRate * multiple * overCeiling);
  const ourExpectedPoolCostUsd = round2(fireRate * suggestedRate * multiple);
  return {
    status: 'PROPOSED',
    inputs: { fit, fireRate, suggestedRate, balanceUsd, multiple },
    holderSelfEvidentFireCostUsd: { value: holderSelfEvidentFireCostUsd, predicted: true },
    ourExpectedPoolCostUsd: { value: ourExpectedPoolCostUsd, predicted: true },
    fireSignal: { value: fireSignal(fireRate), predicted: true, band: FIREABLE_BAND },
  };
}

// C973 SELF-EVIDENT FIRES COST THE HOLDER, NEVER THE POOL, AND THE PRICE IS SHOWN BEFORE ARMING (chair decomposition
// 2026-10-18 of "Let's teach the Market how to write specifications that we can fire on them … it's impossible to
// follow"): specFitCost reads C974's balance().holderSelfEvidentFireCostUsd — one period's dollar cost of a spec
// fired on itself — out in the two units a holder actually holds: licencesConsumed (that dollar cost divided by the
// licence price) and prepaidHoursConsumed (the SAME dollar cost divided back out by the very suggestedRate that
// built it, so the rate cancels and the hour count reads fireRate × multiple × overCeiling alone — "at today's
// suggested rate" names the unit the conversion runs in, never a lever on the hour count itself).
//
// SELF_EVIDENT_FIRE is never a member of OUR_ACT_FAILURES (holderClaim's filter): whatever specFitCost prints,
// feeding it into holderClaim as an event never produces a claim, so poolPayout, safeMultiple (this file) and
// queueOrder (dispatch-market.mjs) — none of which take fit or fireRate as a parameter at all — never move with
// the holder's spec or fire rate. The holder's spec and the agent's excursions are the holder's event, never our
// act (C895, C939).
//
// SUFFICIENT FOR: what one period of a self-evident spec costs the holder, in licences and prepaid hours, before
// they arm it. NOT SUFFICIENT FOR: whether a given spec actually IS self-evident (Rice, 1953) — fit is a number
// the caller hands in, never computed here.
// @guard tests/vna/c973-self-evident-fires-cost-the-holder.test.mjs
export const SELF_EVIDENT_FIRE = 'self-evident-fire'; // never in OUR_ACT_FAILURES — the holder's own spec, never our act

export function specFitCost({ fit = 0, fireRate = 0, suggestedRate = 0, multiple = TRIAL_PROPOSAL.multiple, priceUsd = BASE_PRICE_USD } = {}) {
  const costUsd = balance({ fit, fireRate, suggestedRate, multiple }).holderSelfEvidentFireCostUsd.value;
  const licencesConsumed = priceUsd > 0 ? round2(costUsd / priceUsd) : 0;
  const prepaidHoursConsumed = suggestedRate > 0 ? round2(costUsd / suggestedRate) : 0;
  return {
    status: 'PROPOSED',
    inputs: { fit, fireRate, suggestedRate, multiple, priceUsd },
    costUsd, licencesConsumed, prepaidHoursConsumed,
  };
}

/** the one line a holder reads before arming a spec that fires on itself — PRICE BEFORE ARMING, named so no caller
 *  has to re-derive the wording that makes this the holder's event, never our act. */
export function formatSpecFitCost(cost) {
  const { fit, fireRate, suggestedRate } = cost.inputs;
  if (cost.costUsd === 0) return `spec-fit: fit ${fit} at or below FIT_BAND_CEILING (${FIT_BAND_CEILING}) — this spec costs nothing before arming`;
  return `spec-fit: fit ${fit} past FIT_BAND_CEILING (${FIT_BAND_CEILING}) at ${fireRate} fires/period costs $${cost.costUsd} one period — ${cost.licencesConsumed} licence(s) and ${cost.prepaidHoursConsumed} prepaid hour(s) at today's suggested rate ($${suggestedRate}/h) — PRICE BEFORE ARMING, the holder's own event, never our act`;
}

// C971 THE WARRANTY PAYS AT A MARKET RATE: DOLLARS FROM US, LICENCES CONSUMED, THE TRIGGER READ OFF THE HOLDER'S
// OWN SPEC (operator 2026-10-18: "see if we can also improve the terms of service and warranty math to make it a
// market rate. The company pays out in dollars, but it consumes licenses, for example, for the parametric in-kind,
// and also build the triggers based on how well your spec for your [cockpit]"): C939's onOurActFailure split a
// claim into creditsUsd (new API credits WE BUY, at the fixed hourValueUsd) and hours. marketRatePayout below
// replaces that fixed rate with market-rate.mjs's own suggestedRate for both legs, and replaces "buy new credits"
// with "consume the holder's own unused licences" (liveSpendUsd, C955) for the in-kind leg — nothing new is
// purchased on our side.
//
// THE SPLIT: p.creditShare of the claim's hours is paid as DOLLARS FROM US, at suggestedRate; the rest is the
// in-kind leg, valued at the same suggestedRate, and settled by CONSUMING the holder's own unused licences
// (round2(min(inKindUsd, liveSpendUsd) / priceUsd)) — never past what is still live (bought, not yet used, C955);
// whatever the claim asks for past that is named shortfallUsd, owed but not yet settled, never invented as paid.
//
// THE TRIGGER'S OWN RESOLUTION reads `fit` alone (C974's declared-spec tightness) — triggerResolutionHours falls
// linearly from TRIGGER_RESOLUTION_BASE_HOURS at fit 0 to zero at fit 1: a sharper declared lane gives a sharper
// (narrower), cheaper trigger to resolve, a looser one costs more hours to settle whether our act actually missed.
//
// marketRatePayout takes NO events, ticks, or any reading of the holder's agent's behaviour as a parameter at
// all — the signature itself is the proof that no such event can move dollarsUsd, inKind or trigger: there is
// nowhere in the call for one to enter. poolPayout and safeMultiple (above, unchanged) still bound the pool: feed
// this function's dollarsUsd into poolPayout's `claims` exactly as holderClaim's usd already is.
//
// SUFFICIENT FOR: the dollar leg, the in-kind leg and the trigger's own resolution cost for one already-qualified
// claim, all three at the one market rate. NOT SUFFICIENT FOR: whether the terms are actually offered this way —
// TRIAL_PROPOSAL.status stays 'PROPOSED' until counsel reads them — or whether a given dispatch really missed its
// window (that stays dispatchMissed's and Rice's).
// @guard tests/vna/c971-the-warranty-pays-at-a-market.test.mjs
export const TRIGGER_RESOLUTION_BASE_HOURS = 4; // PROPOSED — a fit of 0 costs this many hours to resolve a trigger; a fit of 1 costs none

/** hours to resolve a trigger at a given `fit` (C974's declared-spec tightness, clamped to [0,1]) — falls linearly
 *  to zero as fit rises to 1, never negative, never a function of anything but fit itself. */
export function triggerResolutionHours(fit = 0, baseHours = TRIGGER_RESOLUTION_BASE_HOURS) {
  const clamped = Math.max(0, Math.min(1, Number(fit) || 0));
  return round2(baseHours * (1 - clamped));
}

/** the C971 payout shape for one already-qualified claim of `hours` (the claim's size, in operator-hours, read
 *  off the existing C939 claim math — never recomputed here): splits it into a cash leg (dollarsUsd, at
 *  suggestedRate) and an in-kind leg settled by consuming the holder's own unused licences (liveSpendUsd,
 *  priceUsd), and reports the trigger's own resolution cost at `fit`. Takes no events parameter — nothing of the
 *  holder's agent's behaviour is readable here, by construction. */
export function marketRatePayout({ hours = 0, suggestedRate = 0, liveSpendUsd = 0, priceUsd = BASE_PRICE_USD, fit = 0, p = TRIAL_PROPOSAL } = {}) {
  const cashHours = round2(Math.max(0, hours) * p.creditShare);
  const inKindHours = round2(Math.max(0, hours) - cashHours);
  const dollarsUsd = round2(cashHours * suggestedRate);
  const inKindUsd = round2(inKindHours * suggestedRate);
  const licencesConsumed = priceUsd > 0 ? round2(Math.min(inKindUsd, Math.max(0, liveSpendUsd)) / priceUsd) : 0;
  const shortfallUsd = round2(Math.max(0, inKindUsd - Math.max(0, liveSpendUsd)));
  const resolutionHours = triggerResolutionHours(fit);
  return {
    status: 'PROPOSED',
    rateUsd: suggestedRate,
    dollarsUsd,
    inKind: { usd: inKindUsd, licencesConsumed, shortfallUsd, priceUsd },
    trigger: { fit, resolutionHours, resolutionCostUsd: round2(resolutionHours * suggestedRate) },
  };
}

// C978 THE REDLINE TIER — PUSH IT HARDER, THE REMEDY PAYS MORE OFTEN AND SMALLER, IN CREDITS THAT BURN AGAIN
// (operator 2026-10-18: "Is there a way to think about the warranty to make it more aggressive so that it pays
// more often but you also uses your license is more often … it just means you're running closer to the metal and
// means that the instrument is more likely to break, but it also uses the license is faster … that would justify
// going faster, which is meaning we learn faster"): a holder may declare a REDLINE envelope — a tighter dispatch
// window, a higher stamp rate, a faster re-run cadence — than the base tier's. The tighter envelope burns the
// holder's credits faster (more stamps, more re-runs, per holder-period) and, because it runs closer to the
// metal, fails our act more often too. redlineTerms prices that trade the same way safeMultiple already prices
// the base tier: the multiple is read off the REDLINE TIER'S OWN RECORD (failures and holderPeriods counted
// inside that tier alone, never borrowed from the base tier's safeMultiple call), so a higher failure rate
// raises the Wilson upper bound pUpper, which only ever SHRINKS floor(stopLossShare / pUpper) — the tier pays
// more often, at a smaller multiple each time, and pUpper × multiple never crosses stopLossShare, by the same
// construction as safeMultiple (C939.5) applied to this tier's own failures.
//
// THE REMEDY is fixed, whatever the envelope or the record: re-performance plus licence credits, never cash,
// never transferable — paying on the deployer's own loss in cash would be insurance (NY Ins. Law § 1101(a)(1);
// C895), exactly as in the base tier.
//
// THE REDLINE STRESSES SPEED ONLY: REDLINE_SPEED_FAILURES (dispatch-missed, trigger-latency) are the acts a
// tighter envelope can push past safe — and a speed failure caused by load BEYOND the declared envelope, or
// induced on purpose, is EXCLUDED from the tier's own record (redlineCountsAsFailure reads event.beyondEnvelope
// and event.induced for that branch only). REDLINE_INTEGRITY_FAILURES (rerun-bytes-differ, tape-gap) stay
// ZERO-TOLERANCE IN EVERY TIER: redlineCountsAsFailure counts them unconditionally and never reads `envelope` or
// the exclusion flags on that branch at all — no redline input can ever move whether an integrity failure
// counts.
//
// SUFFICIENT FOR: the redline tier's own safe multiple and expected payout, bounded the same way the base
// tier's is, and which failure types the redline stresses versus holds zero-tolerance. NOT SUFFICIENT FOR:
// whether a given envelope is actually offered on any page (counsel and the operator set that), or whether a
// given dispatch truly ran beyond the declared envelope (Rice, 1953) — `beyondEnvelope`/`induced` are flags the
// caller hands in, never computed here.
// @guard tests/vna/c978-the-redline-tier-push-it-harder.test.mjs
export const REDLINE_SPEED_FAILURES = Object.freeze(['dispatch-missed', 'trigger-latency']);

export const REDLINE_INTEGRITY_FAILURES = Object.freeze(['rerun-bytes-differ', 'tape-gap']);

/** whether one event counts toward the redline tier's own failure record. An integrity failure (zero-tolerance)
 *  always counts, in every tier — `envelope` and the exclusion flags are never read on this branch. A speed
 *  failure counts unless it happened beyond the holder's declared envelope or was induced on purpose; anything
 *  else (an unknown type, the holder's own agent event) never counts. */
export function redlineCountsAsFailure(event, envelope = {}) {
  if (!event || typeof event !== 'object') return false;
  if (REDLINE_INTEGRITY_FAILURES.includes(event.type)) return true;
  if (!REDLINE_SPEED_FAILURES.includes(event.type)) return false;
  if (event.beyondEnvelope || event.induced) return false;
  return true;
}

// C991 HOW LONG THE TAPE MUST BE — TWO CLOCKS, BOTH ACHIEVABLE (operator 2026-10-18: "How long does the tape need
// to be before you can claim warranties on it right that has to be achievable"): tapeReadiness answers two
// separate questions that the paste's single clock conflates.
//   CLOCK 1 — CLAIMABLE: a failure of OUR ACT is claimable from the moment the holder's terms are frozen, with no
//     waiting period. Our act is a fact per event (dispatch-missed, trigger-not-as-declared, rerun-bytes-differ,
//     tape-gap, OUR_ACT_FAILURES above); a seasoning period on our own act would make the warranty bait — asking a
//     holder to wait before a provable miss of OUR act counts against us.
//   CLOCK 2 — PRICEABLE: the trigger that sets the pool's own multiple (safeMultiple above) only arms once the
//     backtest holds enough eligible holder-periods that the Wilson 95% upper bound on the fire rate sits under the
//     5% "rare enough to price" line parametric-trigger.mjs already draws for its own corpus. minEligibleForRate
//     finds the smallest holder-period count at which wilson()'s upper bound crosses a given rate, for any fires —
//     at zero fires that is 73 for the 5% line and 22 for the 15% "marginal" line, read off wilson() itself, never
//     typed as a constant.
// SUFFICIENT FOR: whether a claim on our act is open today, and how many more eligible holder-periods the backtest
// needs before the trigger prices. NOT SUFFICIENT FOR: whether a given dispatch actually missed its window (that
// stays dispatchMissed's), or whether the operator or counsel actually opens the trigger at that line (PROPOSED).
// @guard tests/vna/c991-how-long-the-tape-must-be.test.mjs
export const PRICEABLE_RATE = 0.05;  // "rare enough to price" — parametric-trigger.mjs's own line
export const MARGINAL_RATE = 0.15;   // parametric-trigger.mjs's own "marginal" line

/** the smallest n (eligible holder-periods) at which wilson(fires, n)'s upper bound first falls to or under
 *  `maxRate`, searched upward from n = fires + 1 (wilson needs n > 0, and n must at least hold the fires counted).
 *  A cap of 100000 returns null rather than loop forever if `maxRate` is unreachable at this `fires` count. */
export function minEligibleForRate(fires, maxRate, z = 1.96) {
  const f = Math.max(0, Math.floor(fires) || 0);
  for (let n = f + 1; n <= 100000; n += 1) {
    const ci = wilson(f, n, z);
    if (ci && ci[1] <= maxRate) return n;
  }
  return null;
}

/** C991 — the two clocks, read off one eligible/fires count. `eligible` and `fires` are the live record of our own
 *  act (OUR_ACT_FAILURES), never the holder's agent. */
export function tapeReadiness({ eligible = 0, fires = 0 } = {}) {
  const e = Math.max(0, Math.floor(eligible) || 0);
  const f = Math.max(0, Math.floor(fires) || 0);
  const ci = e > 0 ? wilson(f, e) : null;
  const pUpper = ci ? ci[1] : 1;
  const neededForPriceable = minEligibleForRate(f, PRICEABLE_RATE);
  const neededForMarginal = minEligibleForRate(f, MARGINAL_RATE);
  return {
    ourAct: {
      claimable: true,
      waitingPeriod: 0,
      why: 'our act is a fact per event; a seasoning period on our own act would make the warranty bait',
    },
    trigger: {
      eligible: e, fires: f, pUpper,
      priceable: e >= (neededForPriceable ?? Infinity),
      marginal: e >= (neededForMarginal ?? Infinity),
      eligibleNeededForPriceable: neededForPriceable,
      eligibleNeededForMarginal: neededForMarginal,
    },
  };
}

/** C991 — the one line /backup/warranty shows beside the buyer path: how far the backtest sits from a priceable
 *  trigger, read off tapeReadiness() alone. */
export function formatTapeReadiness(reading) {
  const { eligible, eligibleNeededForPriceable: needed } = reading.trigger;
  if (needed == null) return `${eligible} eligible commits — no reachable count prices this trigger at today's fire rate`;
  return `${eligible} of ${needed} eligible commits to a priceable trigger`;
}

/** the redline tier's terms at a declared operating envelope (dispatchWindowHours, stampRate, rerunCadence —
 *  whatever the holder tightened). `failures` and `holderPeriods` are this tier's OWN record, never the base
 *  tier's: the multiple is safeMultiple's same Wilson-bound construction run on that record alone, so
 *  pUpper × multiple never crosses p.stopLossShare, and expectedPayoutUsd (that share of liveSpendUsd) never
 *  crosses limitUsd (p.stopLossShare × liveSpendUsd) — true at every failure rate, by construction. The remedy
 *  is fixed: re-performance plus licence credits, never cash, never transferable. */
export function redlineTerms({ envelope = {}, failures = 0, holderPeriods = 0, liveSpendUsd = 0, p = TRIAL_PROPOSAL } = {}) {
  const safe = safeMultiple({ failures, holderPeriods, p });
  const multiple = Number.isInteger(safe.multiple) ? safe.multiple : 0;
  const pUpper = safe.pUpper != null ? safe.pUpper : null;
  const expectedShareOfSpend = pUpper != null ? round2(pUpper * multiple) : 0;
  const expectedPayoutUsd = round2(expectedShareOfSpend * Math.max(0, liveSpendUsd));
  const limitUsd = round2(p.stopLossShare * Math.max(0, liveSpendUsd));
  return {
    status: 'PROPOSED',
    envelope,
    multiple,
    pUpper,
    expectedPayoutUsd,
    limitUsd,
    withinStopLoss: expectedPayoutUsd <= limitUsd + 1e-9,
    remedy: { kind: 're-performance-plus-credits', cashUsd: 0, transferable: false },
    stresses: REDLINE_SPEED_FAILURES,
    zeroTolerance: REDLINE_INTEGRITY_FAILURES,
  };
}

// C992 HOW MANY LICENCES YOU NEED — SIZED OFF YOUR OWN RATE, AND THE FLOOR REACHABLE IN A YEAR (operator 2026-10-18:
// "We need to refine the how many licenses do you need? How long does the tape need to be before you can claim
// warranties on it right that has to be achievable and"): licencesNeeded reads a row rate and a span and returns
// the ceiling of rows over ROWS_PER_LICENCE — nothing else. rowsPerDay feeds it from whichever reading exists: the
// tape's own rate (rowsPerDayFromTape, exposure.rows over exposure.from..to) once a tape exists, or the standing
// answer's own scale number (rowsPerDayFromStandingAnswer, the 'blast' question's rows-per-minute) before one
// does — never averaged between the two, and the tape always wins once it exists.
//
// Measured on our own tape (data/vna/warranty-dogfood.json): 7,704 rows over its own from/to span (about 299 rows
// a day), about 11 licences a year across nine rooms. At that rate today's TRIAL_PROPOSAL.floor of 25 licences is
// about 2.3 years of our heaviest use, and the first prepaid hour at today's hoursPerLicencesUsed (25) arrives
// after the same stretch.
//
// proposedFloor and floorAchievability are PROPOSED, for the operator to set, same as every number in
// TRIAL_PROPOSAL (this function never writes TRIAL_PROPOSAL.floor): the floor becomes the smaller of the current
// floor and one year of the holder's own projected rows, never under PROPOSED_MIN_FLOOR, and the achievability
// check prices a first hour at PROPOSED_HOURS_PER_LICENCES_USED (5) rather than today's 25. Because the proposed
// floor is itself capped at one year's own projection, floorReachableWithinYear holds BY CONSTRUCTION; the
// non-trivial half is firstHourWithinMonths, which floorAchievability actually computes off the measured rate.
//
// SUFFICIENT FOR: how many licences a given row rate needs over a span, and whether a proposed floor and hours
// rate clear a holder's own projected rate within a year. NOT SUFFICIENT FOR: whether the operator actually
// adopts PROPOSED_MIN_FLOOR or PROPOSED_HOURS_PER_LICENCES_USED (counsel and the operator set those), or whether
// a given holder's own tape will keep running at the rate it shows today.
// @guard tests/vna/c992-how-many-licences-you-need-sized.test.mjs
export const ROWS_PER_LICENCE = 10000; // C992 — one licence covers this many tape rows a year

export const PROPOSED_MIN_FLOOR = 3; // C992 — PROPOSED: a floor never drops under this many licences

export const PROPOSED_HOURS_PER_LICENCES_USED = 5; // C992 — PROPOSED: replaces TRIAL_PROPOSAL.hoursPerLicencesUsed (25)

/** the ceiling of `rowsPerDay * days` rows over ROWS_PER_LICENCE — the only inputs are a rate and a span. */
export function licencesNeeded({ rowsPerDay = 0, days = 365 } = {}) {
  const rows = Math.max(0, rowsPerDay) * Math.max(0, days);
  return Math.ceil(rows / ROWS_PER_LICENCE);
}

/** the tape's own row rate, read off one exposure record's rows and from/to span — UNMEASURED with no tape yet,
 *  never a rate invented as zero. */
export function rowsPerDayFromTape(exposure) {
  const rows = exposure && exposure.rows;
  const fromMs = exposure && Date.parse(exposure.from);
  const toMs = exposure && Date.parse(exposure.to);
  if (!Number.isFinite(rows) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return { status: 'UNMEASURED', why: 'no tape exposure yet — read the standing answer\'s scale number instead', rowsPerDay: null };
  }
  const spanDays = (toMs - fromMs) / 86_400_000;
  return { status: 'MEASURED', rowsPerDay: round2(rows / spanDays), spanDays: round2(spanDays), rows };
}

/** the standing answers' own scale number, before a tape exists: the 'blast' question's rows-changed-per-minute
 *  answer, converted to a day. `blastNumbers` is that question's `numbers` answer shape, e.g. { rows: '12' }. */
export function rowsPerDayFromStandingAnswer(blastNumbers) {
  const perMinute = Number(blastNumbers && blastNumbers.rows);
  if (!Number.isFinite(perMinute) || perMinute < 0) {
    return { status: 'UNANSWERED', why: 'the blast-radius question\'s rows-per-minute has no answer yet', rowsPerDay: null };
  }
  return { status: 'ANSWERED', rowsPerDay: round2(perMinute * 1440) };
}

/** C992 — the one row rate licencesNeeded is fed from: the tape's own rate once `exposure` reads MEASURED, else
 *  the standing answer's scale number, never the two averaged together. */
export function rowsPerDay({ exposure, blastNumbers } = {}) {
  const fromTape = rowsPerDayFromTape(exposure);
  if (fromTape.status === 'MEASURED') return fromTape;
  return rowsPerDayFromStandingAnswer(blastNumbers);
}

/** the PROPOSED floor at a measured or answered `rowsPerDay`: the smaller of `baseFloor` (TRIAL_PROPOSAL.floor by
 *  default) and one year of the holder's own projected rows (licencesNeeded at days=365), never under `minFloor` —
 *  so the floor can only ever be a holder's own achievable year, capped from above by the trial's existing floor. */
export function proposedFloor({ rowsPerDay: rpd = 0, baseFloor = TRIAL_PROPOSAL.floor, minFloor = PROPOSED_MIN_FLOOR } = {}) {
  const yearProjection = licencesNeeded({ rowsPerDay: rpd, days: 365 });
  return Math.max(minFloor, Math.min(baseFloor, yearProjection));
}

/** C992 — the achievability property the guard proves: at a given `rowsPerDay`, proposedFloor is reachable within
 *  one year (true BY CONSTRUCTION — the floor is capped at one year's own projection) and the first prepaid hour,
 *  one per `hoursPerLicencesUsed` licences used, accrues within `withinMonths`. */
export function floorAchievability({ rowsPerDay: rpd = 0, baseFloor = TRIAL_PROPOSAL.floor, minFloor = PROPOSED_MIN_FLOOR, hoursPerLicencesUsed = PROPOSED_HOURS_PER_LICENCES_USED, withinMonths = 12 } = {}) {
  const floor = proposedFloor({ rowsPerDay: rpd, baseFloor, minFloor });
  const licencesPerYear = licencesNeeded({ rowsPerDay: rpd, days: 365 });
  const yearsToFloor = licencesPerYear > 0 ? floor / licencesPerYear : Infinity;
  const monthsToFirstHour = licencesPerYear > 0 ? round2((hoursPerLicencesUsed / licencesPerYear) * 12) : Infinity;
  return {
    status: 'PROPOSED',
    rowsPerDay: rpd,
    licencesPerYear,
    floor,
    floorReachableWithinYear: yearsToFloor <= 1 + 1e-9,
    hoursPerLicencesUsed,
    monthsToFirstHour,
    firstHourWithinMonths: monthsToFirstHour <= withinMonths + 1e-9,
  };
}

/** C1007 (the branch's C977) — WHEN HIRING IS WORTH IT, read off the hours ledger, never felt. `months` are the newest-last rows of
 *  { redeemedHours, setupHours, licenceRevenueUsd }. The founder's ceiling binds when demanded hours exceed the ceiling in each of
 *  the last two months; a hire is funded when supportShare × licence revenue covers the overflow at contractorHourlyUsd in both.
 *  Both → HIRE; binds but unfunded → RAISE-HOURS-PER-LICENCE-OR-QUEUE; neither → HOLD; under two months → UNMEASURED.
 *  @guard tests/warranty-plan/c1007-the-program-prices-the-founders-time.test.mjs */
export function hiringSignal({ months = [], p = TRIAL_PROPOSAL, ceilingHours = FOUNDER_MONTHLY_CEILING_HOURS } = {}) {
  if (!Array.isArray(months) || months.length < 2) return { signal: 'UNMEASURED', why: 'fewer than two months on the hours ledger' };
  const last = months.slice(-2).map((m) => {
    const demanded = (Number(m.redeemedHours) || 0) + (Number(m.setupHours) || 0);
    const overflow = Math.max(0, demanded - ceilingHours);
    const budget = p.supportShare * (Number(m.licenceRevenueUsd) || 0);
    return { demanded, overflow, budget, funded: overflow > 0 && budget >= overflow * p.contractorHourlyUsd };
  });
  const binds = last.every((m) => m.overflow > 0);
  const funded = last.every((m) => m.funded);
  const signal = binds && funded ? 'HIRE' : binds ? 'RAISE-HOURS-PER-LICENCE-OR-QUEUE' : 'HOLD';
  return { signal, ceilingHours, months: last, contractorHourlyUsd: p.contractorHourlyUsd, supportShare: p.supportShare };
}
