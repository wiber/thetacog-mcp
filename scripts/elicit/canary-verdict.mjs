#!/usr/bin/env node
// scripts/elicit/canary-verdict.mjs — did the loop prove itself today, and in how many seconds?
// ==========================================================================================
// Hop 14 of the machine-authored loop (goal 2026-08-28): a daily canary run is only worth
// installing if its ABSENCE is loud. "The digest asserts 'canary completed end-to-end in Xs';
// a MISSING canary receipt is a page." This module is the ONE implementation of that verdict —
// the loop email quotes it when it fires, and the unconditional daily digest quotes it every
// day, because an assertion that rides only the ingest mail goes silent exactly when the loop
// breaks, which is the silence the canary exists to end.
//
// END-TO-END is typed → tape: the canary receipt (gemini-canary.sh appends outcome "typed"
// with a nonce) to the tape row whose text carries that nonce (turn-identity's ingest stamps
// first_seen_at). Those are hops 0 through 6 measured by two records neither of which this
// module writes — the verdict is a pure read, recomputable by anyone.
//
// The canary deliberately never reaches the model ladder, a spec, or a constant (the canary
// lane in elicit-run.mjs), so typed→tape IS the full canary journey, not a truncation of it.
//
//   node scripts/elicit/canary-verdict.mjs              # verdict for today (UTC), human line
//   node scripts/elicit/canary-verdict.mjs --date 2026-08-28
//   node scripts/elicit/canary-verdict.mjs --json
//
// Guard: tests/elicit/canary-verdict.test.mjs (fixtures, both directions: a completed canary
// must report seconds; a missing one must page; typed-but-not-ingested must name which half).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAPE } from './turn-identity.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CANARY_RECEIPTS = process.env.CANARY_RECEIPTS_FILE
  || resolve(REPO, '.thetacog/elicit/canary-receipts.ndjson');

const nd = (p) => {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

// SALVAGE, for the receipts file only. The canary writer interpolated a JSON detail blob
// unescaped (fixed 2026-08-28 in gemini-canary.sh), so the historical "typed" receipts — the
// exact rows that prove the loop ran — are invalid NDJSON. A verdict that drops unparseable
// rows reads a PROVEN day as FAILED, which inverts the page. The four flat leading fields are
// machine-written with a fixed shape (ts/mode/nonce/outcome, hex nonce, enum outcome), so
// recovering them by pattern is reading the writer's own contract, not guessing at prose.
const receiptRows = (p) => {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { /* salvage below */ }
    const m = /^\{"ts":"([^"]+)","mode":"([^"]+)","nonce":"([0-9a-f]+)","outcome":"([^"]+)","detail":"(.*)\}\s*$/.exec(l);
    if (!m) return null;
    return { ts: m[1], mode: m[2], nonce: m[3], outcome: m[4], detail: m[5], salvaged: true };
  }).filter(Boolean);
};

/** Real (non-canary) tape traffic for one UTC date — the operator's own turns reaching the
 *  tape prove hops 0-6 without any injection. Counting them is what lets the canary be
 *  SILENCE-GATED: on a day the operator talked to Gemini, the chain is already proven and a
 *  test conversation would be pure sidebar litter (~365/year at one per day — cuo1's costing,
 *  and the operator has already asked "why are we using canary tokens?"). */
export function tapeTraffic({ date = new Date().toISOString().slice(0, 10), tapeFile = TAPE } = {}) {
  const rows = nd(tapeFile).filter((r) =>
    String(r.first_seen_at || r.seen_at || '').startsWith(date) && !/TD-CANARY/.test(String(r.text || '')));
  const last = rows[rows.length - 1];
  return { turns: rows.length, lastAt: last ? (last.first_seen_at || last.seen_at) : null };
}

/**
 * The verdict for one UTC date. Statuses, most alarming first:
 *   never-typed          no canary receipt, no real traffic — the loop is unproven. PAGE.
 *   attempted-failed     receipts exist but none reached "typed"/"landed" (no-tab,
 *                        no-composer, type-failed). The injection half is broken. PAGE.
 *   typed-not-ingested   landed, but the nonce never reached the tape AND no real traffic
 *                        reached it either. The scrape→ingest half is broken. PAGE.
 *   proven-by-traffic    no completed canary, but the operator's own turns reached the tape
 *                        today — the chain is proven by real use, which is the case the
 *                        silence-gated canary deliberately does not fire into.
 *   completed            a canary nonce is on the tape — end-to-end seconds reported.
 */
export const EMAIL_SENT = process.env.EMAIL_SENT_FILE
  || resolve(REPO, '.thetacog/email-sent.ndjson');

/**
 * DECOMPOSE THE COMPLETED ROUND (operator, via the agent-routed gemSkill ledger, 2026-08-29:
 * "canary receipt decomposed with t0 = type time"): 624s could be 600s of detection plus 24s
 * of everything else, and one lump sum cannot say which hop is slow.
 *
 * TWO LEG READERS EXIST, DELIBERATELY — this is the per-verdict line the mail renders for
 * ONE round; scripts/elicit/canary-legs.mjs is the checker's whole-population instrument
 * (every run, injectable ledgers, endpoint verdicts, UNATTRIBUTABLE for never-verified
 * landings). Same leg vocabulary, different jobs; its header points back here. Deleting
 * either one is not a simplification, it is amputating one of the two questions.
 *
 * Four timestamps, four ledgers, none written by this function:
 *   type    the canary receipt (t0 — already the base of `seconds`)
 *   seen    the beat's detection-latency receipt (818e4c0baf), keyed of: t0 — may be ABSENT
 *           (pre-instrumentation, or a confounded round where another process scraped first),
 *           and an absent leg is reported as unmeasured, never folded into a neighbour
 *   sealed  the tape row's first_seen_at for the nonce
 *   mailed  email-sent.ndjson's "Gemini ingest <date>" send at/after sealing — absent while
 *           the detached mail is still in flight, and that too is said rather than guessed
 */
export function decomposeLegs({ typedAt, tapedAt, receipts, date, emailFile = EMAIL_SENT }) {
  const t0 = Date.parse(typedAt);
  const det = receipts.find((r) => r.outcome === 'detection-latency' && r.of === typedAt);
  const detectionS = det && Number.isFinite(Number(det.seconds)) ? Number(det.seconds) : null;
  const sealedS = Math.round((Date.parse(tapedAt) - t0) / 1000);
  const mail = nd(emailFile).find((m) =>
    // The daily loop thread (new form) or the legacy ingest subject — both join by date.
    (String(m.subject || '').startsWith(`🔁 The loop, end to end — ${date}`)
      || String(m.subject || '').startsWith(`Gemini ingest ${date}`))
    && Date.parse(m.ts) >= Date.parse(tapedAt));
  const mailedS = mail ? Math.round((Date.parse(mail.ts) - t0) / 1000) : null;
  const chain = [
    `type ${typedAt.slice(11, 19)}Z`,
    // NAME WHICH END IS MISSING (folded in from the retired canary-legs.mjs, whose first
    // version printed a bare MISSING and sent its reader to the tape when the tape was fine):
    // in the completed path the tape row is present by definition, so the gap is always the
    // detection receipt — say so, or the reader debugs the wrong hop.
    detectionS !== null ? `seen +${detectionS}s` : 'seen unmeasured (tape row present; no detection-latency receipt to measure from — pre-instrumentation or another process scraped first)',
    detectionS !== null ? `sealed +${sealedS}s (scrape+ingest ${sealedS - detectionS}s)` : `sealed +${sealedS}s`,
    mailedS !== null ? `mailed +${mailedS}s (mail ${mailedS - sealedS}s)` : 'mailed: not yet in email-sent.ndjson',
  ].join(' → ');
  return { detectionS, sealedS, mailedS, chain };
}

export function canaryVerdict({
  date = new Date().toISOString().slice(0, 10),
  receiptsFile = CANARY_RECEIPTS,
  tapeFile = TAPE,
  emailFile = EMAIL_SENT,
} = {}) {
  // The date filter scopes the day's ATTEMPTS; the detection join below uses the UNFILTERED
  // ledger, because a detection-latency row is written when the beat fires and can land on the
  // other side of a UTC midnight from the canary it measures — its `of` key, not its own ts,
  // is what ties it to the round.
  const allReceipts = receiptRows(receiptsFile);
  const receipts = allReceipts.filter((r) => String(r.ts || '').startsWith(date));
  // "landed" is the current success outcome (composer typed AND send clicked AND the
  // conversation shows a turn); "typed" is the legacy success name still present in the
  // ledger's history. Both mean the injection half worked.
  const typed = receipts.filter((r) => r.outcome === 'typed' || r.outcome === 'landed');
  // Any injected nonce that made the tape completes the day; take the FASTEST completed pair so
  // a retried morning doesn't report the slow failure beside the working afternoon.
  const tapeRows = nd(tapeFile);
  let best = null;
  for (const t of typed) {
    const hit = tapeRows.find((row) => String(row.text || '').includes(t.nonce));
    if (!hit) continue;
    const secs = Math.round((Date.parse(hit.first_seen_at || hit.seen_at) - Date.parse(t.ts)) / 1000);
    if (Number.isFinite(secs) && (best === null || secs < best.seconds)) {
      best = { nonce: t.nonce, seconds: secs, typedAt: t.ts, tapedAt: hit.first_seen_at || hit.seen_at };
    }
  }
  if (best) {
    // SUFFICIENCY CONTRACT, stated on the row (the 2026-08-29 lesson, four findings in one
    // night with the same shape): this number proves the MACHINE-AUTHORED round — typed→tape,
    // zero operator keystrokes. It does NOT prove the beat found the canary UNAIDED; another
    // session driving the scrape produces the identical pair of receipts. Unaided detection
    // is the beat's own detection-latency receipt (pulse-receipts, 818e4c0baf), which states
    // its own confound. Two properties that read identically in a summary — keep them apart.
    const legs = decomposeLegs({ typedAt: best.typedAt, tapedAt: best.tapedAt, receipts: allReceipts, date, emailFile });
    return { status: 'completed', date, page: false, ...best, legs,
      line: `✅ canary completed end-to-end in ${best.seconds}s (${date}, nonce ${best.nonce}: ${legs.chain}). Proves the machine-authored round; whether the beat found it unaided is the detection-latency receipt's claim, not this number's.` };
  }
  // REAL TRAFFIC PROVES THE CHAIN WITHOUT AN INJECTION. On a day the operator's own turns
  // reached the tape, hops 0-6 demonstrably ran, and the silence-gated canary correctly did
  // not (or need not) fire. Without this branch the digest would page on every healthy day.
  const traffic = tapeTraffic({ date, tapeFile });
  if (traffic.turns > 0) {
    const canaryNote = !receipts.length ? ''
      : typed.length ? ' (a canary was injected too and has not reached the tape yet)'
      : ` (note: the canary itself attempted and failed to inject — ${receipts[receipts.length - 1].outcome})`;
    return { status: 'proven-by-traffic', date, page: false, turns: traffic.turns, lastAt: traffic.lastAt,
      line: `✅ chain proven by real traffic ${date} — ${traffic.turns} operator turn(s) reached the tape (last ${String(traffic.lastAt).slice(11, 19)}Z), so hops 0-6 ran without needing an injection${canaryNote}.` };
  }
  if (!receipts.length) {
    return { status: 'never-typed', date, page: true,
      line: `🚨 CANARY MISSING ${date} — no canary receipt and no real traffic: the loop is UNPROVEN today; silence currently means broken.` };
  }
  if (!typed.length) {
    const last = receipts[receipts.length - 1];
    return { status: 'attempted-failed', date, page: true, attempts: receipts.length,
      line: `🚨 CANARY FAILED ${date} — ${receipts.length} attempt(s), none landed. Last: ${last.outcome} (${String(last.detail || '').slice(0, 80)}). The injection half (hops 0-2) is broken.` };
  }
  const t = typed[typed.length - 1];
  return { status: 'typed-not-ingested', date, page: true, nonce: t.nonce, typedAt: t.ts,
    line: `🚨 CANARY STUCK ${date} — injected into Gemini at ${t.ts.slice(11, 19)}Z (nonce ${t.nonce}) but the nonce never reached the tape, and no real traffic reached it either. The scrape→ingest half (hops 3-6) is broken or lagging.` };
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const i = process.argv.indexOf('--date');
  const v = canaryVerdict(i > -1 ? { date: process.argv[i + 1] } : {});
  if (process.argv.includes('--json')) console.log(JSON.stringify(v, null, 2));
  else console.log(v.line);
  process.exit(v.page ? 1 : 0);
}
