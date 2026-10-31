#!/usr/bin/env node
// scripts/bookclub/open-weight.mjs — TIER-2: WHAT AN OPEN IS WORTH, CALIBRATED AGAINST T3.
//
// THE PROBLEM THIS EXISTS FOR. rank-readers-t3.mjs ranks by T3 renders, which is the only tier
// that cannot be faked cheaply — and that is exactly why 305 mailboxes that OPEN and never click
// and never render score zero and vanish off the page. They are not absent; they are unmeasured by
// the strictest instrument. Measured on the local mirror 2026-08-29: 775 openers after internal/
// role exclusion, 208 of whom also rendered, 305 open-only. (The ask that commissioned this
// column said 752; the number is recomputed here every run and printed, never quoted, because a
// denominator typed into a comment is a denominator that silently goes stale.)
//
// SO WE ASK THE ONLY QUESTION AN OPEN CAN ANSWER: among mailboxes whose opens look LIKE THIS, what
// fraction turned out to be render-verified readers? That fraction is the weight. It is an
// empirical calibration against the strong tier, not a new belief about opens.
//
// ── THE SUFFICIENCY CONTRACT (AXIOM 1's design rule — declared at the projection surface) ──────
//   SUFFICIENT FOR: ranking open-only mailboxes AGAINST EACH OTHER, so a mailbox whose opens sit
//     in a cell where 41% of peers went on to render outranks one in a cell where 3% did.
//   NOT SUFFICIENT FOR: asserting that any particular person read anything. The weight is a
//     population rate wearing a row's name. It never enters the T3 ladder and never becomes a
//     render — a probability and a receipt are different objects and this file will not merge them.
//
// ── THE DENOMINATOR IS THE WHOLE POINT, AND IT IS THE EASY THING TO GET WRONG ──────────────────
// P(T3=1 | open in cell) = (recipients in the cell who ever rendered) / (ALL recipients in the
// cell). Computing it over renderers only returns 1.000 for every cell — a perfect, useless
// number that would rank every open-only mailbox identically and look like it worked. Computing
// it over "openers who did something" quietly drops the silent majority and inflates every cell.
// The trial is a (recipient, cell) PAIR, deduped: a proxy that fires forty prefetches for one
// mailbox contributes ONE trial, so a single heavy prefetcher cannot swamp a cell's rate.
// Guard: tests/bookclub/open-weight.test.mjs fires on exactly this — a fixture whose renderers-
// only reading is 1.000 and whose correct reading is 0.250.
//
// ── PROVIDER IS A PROXY AND IS LABELLED AS ONE ─────────────────────────────────────────────────
// The construct is "which infrastructure fetched the pixel". The open rows carry NO user_agent and
// NO ip — measured: 0 of 21,736 — so that construct is not observable here and the mailbox DOMAIN
// stands in for it. That is a proxy, so it is checked rather than assumed: renderTable() prints
// each provider's own Δt distribution, and a class that really is proxy-prefetched has to show its
// mass in the t0 bucket. A class that does not is a class whose label is wrong, visibly.
//
// ── THE CONFOUND, MEASURED, AND WHY THIS COLUMN IS STRATIFIED ──────────────────────────────────
// The first run of this calibration ranked corporate-gateway|t1 mailboxes at the top with 76%, and
// that is the scanner shape rank-readers-v2 was invalidated for. The cause is in the data and the
// table prints it every run: openers on gmail.com render at 4.8%, openers on company domains at
// 41.0% — an 8.5× gap. It is not a readership gap. A link-rewriting gateway (SafeLinks, Proofpoint)
// FETCHES every URL in the message, that fetch runs our page's JS, and a T3 row appears. The same
// gateway also produces the fast open. So within a corporate mailbox the Δt buckets that best
// predict T3 are the prefetch buckets, and they predict it because one mechanism causes both —
// which is a correlation with nothing human in it.
// Consequence, and it is the design of the column rather than a caveat on it: the weight is
// COMPARABLE ONLY WITHIN A PROVIDER. Every cell therefore carries `lift` = weight ÷ that provider's
// own base rate, the ranking sorts on lift, and the provider is printed on every row so a
// cross-provider comparison has to be made deliberately instead of by accident.
// The lever this does NOT pull, named so it is not mistaken for done: DELIVERY-LOCK, the per-mailbox
// Δt SPREAD. A gateway fires at a near-constant Δt every send; a person's Δt scatters. That is the
// tell human-report.mjs used to unmask two false humans, it is computable from these same rows, and
// it is a different unit (per recipient, not per cell) than this ask commissioned.
//
// ── THIN CELLS SHRINK, THEY DO NOT SHOUT ───────────────────────────────────────────────────────
// One recipient in a cell who happened to render is not a 100% cell. Every rate is shrunk toward
// the global base rate with a Beta prior of strength `priorStrength` (default 20 trials' worth), and
// each cell carries n, the raw rate and a Wilson interval so the spread is beside the point value
// rather than behind it. A cell under `thinBelow` trials is marked THIN in the output.
//
//   node scripts/bookclub/open-weight.mjs            # the calibration table
//   node scripts/bookclub/open-weight.mjs --top 30   # + the ranked open-only readers
//   node scripts/bookclub/open-weight.mjs --json
//
// Guard: tests/bookclub/open-weight.test.mjs.
import { openSqlite } from '../lib/sqlite-lazy.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIRROR } from './mirror-read.mjs';

// ── PROVIDER, from the mailbox domain (the proxy; see header) ──────────────────────────────────
// Named for the fetch behaviour we are trying to separate, not for the company:
//   gmail-proxy       Google fetches every remote image through googleusercontent, at delivery.
//   apple-mpp         Mail Privacy Protection prefetches on Apple's infrastructure (iOS 15+).
//   microsoft         Outlook.com / Exchange Online prefetch and SafeLinks.
//   consumer-other    Yahoo/AOL/GMX/Proton and friends — consumer mailboxes, mixed behaviour.
//   corporate-gateway Everything else. A company domain's mail is filtered by SOMETHING, and that
//                     something opens pixels; which vendor is unknowable from the address alone.
// apple-mpp is the weakest arm and that is stated: MPP is a CLIENT setting, so an Apple Mail user
// on a gmail.com address is invisible to a domain test. The class captures Apple-hosted mailboxes
// only, and the calibration is what decides whether that partial class carries any signal.
const DOMAIN_CLASS = [
  [/^(gmail|googlemail)\.com$/i, 'gmail-proxy'],
  [/^(icloud|me|mac)\.com$/i, 'apple-mpp'],
  [/^(hotmail|outlook|live|msn)\./i, 'microsoft'],
  [/^(yahoo|ymail|rocketmail|aol|gmx|web\.de|mail|proton|protonmail|pm|zoho|yandex|qq|naver|163|126)\./i, 'consumer-other'],
];
export const PROVIDERS = ['gmail-proxy', 'apple-mpp', 'microsoft', 'consumer-other', 'corporate-gateway'];

export function providerOf(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return 'corporate-gateway';
  const domain = String(email).slice(at + 1).toLowerCase();
  for (const [re, cls] of DOMAIN_CLASS) if (re.test(domain)) return cls;
  return 'corporate-gateway';
}

// ── Δt BUCKETS — the seconds between the delivered webhook and the open ────────────────────────
// Boundaries follow the measured distribution rather than round numbers picked by feel. Over the
// 19,359 opens that join to a delivered (89.1% of all opens): p25 = 9s, p50 = 61s, p75 = 8.7min,
// p90 = 8.2h. The mass under ten seconds is machinery — nobody reads mail in nine seconds every
// time — and the tail past twelve hours is somebody getting to their inbox.
export const DT_BUCKETS = [
  { key: 't0', label: '≤10s  delivery-locked', maxS: 10 },
  { key: 't1', label: '10s–2m', maxS: 120 },
  { key: 't2', label: '2m–30m', maxS: 1800 },
  { key: 't3', label: '30m–12h', maxS: 43200 },
  { key: 't4', label: '>12h', maxS: Infinity },
];
export const BUCKET_KEYS = [...DT_BUCKETS.map((b) => b.key), 'unknown'];

// A non-finite Δt means the open never joined a delivered row (11% of opens: the delivery webhook
// predates the mirror, or was never stored). That is 'unknown' — its own cell with its own
// measured rate, never folded into a real bucket and never dropped, because 11% of the evidence
// silently reassigned is how a calibration lies.
// A NEGATIVE Δt (156 rows) is clock skew between two webhooks, not a reader who opened before
// delivery. It buckets as t0, which is where its physical meaning already sits.
export function bucketDt(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'unknown';
  for (const b of DT_BUCKETS) if (seconds <= b.maxS) return b.key;
  return DT_BUCKETS[DT_BUCKETS.length - 1].key;
}

export const cellKey = (provider, bucket) => `${provider}|${bucket}`;

// Wilson score interval — the honest spread on a proportion, and unlike the normal approximation
// it does not produce a negative lower bound on the small cells this table is full of.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n; const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * THE CALIBRATION.
 * trials: [{recipient, provider, bucket, rendered, renderedHuman, dtS?}] — one row per
 *   (recipient, cell) pair. Pass the FULL opener population, renderers and non-renderers alike.
 * outcome: 'human' counts a render only when the mailbox is NOT machine-shaped by volume (the same
 *   >mechPerDay cut rank-readers-t3 already applies); 'any' counts every render. 'human' is the
 *   default because the loose outcome is measurably dirtier — it takes corporate-gateway from 22.6%
 *   to 41.0% on the live mirror, and the difference is sandboxes. Both are computed so the choice
 *   is visible in --json rather than baked in.
 * Returns { baseRate, providerBase, recipients, trials, cells: {[key]: {n,k,raw,weight,lift,…}} }.
 */
export function calibrateOpenWeights(trials, { priorStrength = 20, thinBelow = 8, outcome = 'human' } = {}) {
  const hit = (t) => (outcome === 'any' ? !!t.rendered : !!(t.renderedHuman ?? t.rendered));
  const seen = new Set();
  const rows = [];
  for (const t of trials) {
    const k = `${t.recipient}|${cellKey(t.provider, t.bucket)}`;
    if (seen.has(k)) continue;           // dedupe: one recipient contributes one trial per cell
    seen.add(k);
    rows.push(t);
  }
  // THE DENOMINATOR, built per recipient rather than per event — see the header. A mailbox appears
  // once here whether it opened once or four hundred times.
  const people = new Map();
  for (const t of rows) people.set(t.recipient, { provider: t.provider, hit: (people.get(t.recipient)?.hit || hit(t)) });
  const recipients = people.size;
  const baseRate = recipients ? [...people.values()].filter((p) => p.hit).length / recipients : 0;

  // Per-provider base rates. These are the strata: the weight is comparable within one of these
  // rows and not across them, which is what `lift` exists to make impossible to forget.
  const providerBase = {};
  for (const p of people.values()) {
    const b = providerBase[p.provider] || (providerBase[p.provider] = { n: 0, k: 0, rate: 0 });
    b.n++; if (p.hit) b.k++;
  }
  for (const b of Object.values(providerBase)) b.rate = b.n ? b.k / b.n : 0;

  const cells = {};
  for (const t of rows) {
    const key = cellKey(t.provider, t.bucket);
    const c = cells[key] || (cells[key] = { provider: t.provider, bucket: t.bucket, n: 0, k: 0, dts: [] });
    c.n++;
    if (hit(t)) c.k++;
    if (Number.isFinite(t.dtS)) c.dts.push(t.dtS);
  }
  for (const c of Object.values(cells)) {
    c.raw = c.n ? c.k / c.n : 0;
    // Beta-Binomial shrinkage toward the PROVIDER's base rate, not the global one. A thin Apple
    // cell should collapse toward what Apple mailboxes do, never toward what the corpus does —
    // shrinking to the global rate would import the gateway population's render propensity into
    // every small cell, which is the confound arriving through the back door.
    const prior = providerBase[c.provider]?.rate ?? baseRate;
    c.weight = (c.k + priorStrength * prior) / (c.n + priorStrength);
    c.lift = prior > 0 ? c.weight / prior : 1;
    const [lo, hi] = wilson(c.k, c.n);
    c.lo = lo; c.hi = hi;
    c.thin = c.n < thinBelow;
    c.dts.sort((a, b) => a - b);
    c.dtMedian = c.dts.length ? c.dts[Math.floor(c.dts.length / 2)] : null;
    delete c.dts;
  }
  return { outcome, baseRate, providerBase, recipients, trials: rows.length, priorStrength, thinBelow, cells };
}

// The weight for one mailbox = the MAX over the cells its opens fall in, never the mean.
// A Gmail proxy prefetches EVERY message, so a t0 open is emitted whether or not a person is
// there — it carries no information about the person and averaging it in would penalise every
// Gmail reader for their provider's behaviour. The slow open is the one with a person behind it,
// so the best cell is the evidence and the mean is reported beside it as context, never as rank.
// A mailbox has exactly one provider (it is derived from its own address), so every cell it lands
// in shares one prior and ordering by weight and ordering by lift are the same ordering here. Both
// are returned anyway: the weight is the number, the lift is the number you are allowed to compare.
export function weightForCells(cellKeys, cal) {
  const ws = [...new Set(cellKeys)].map((k) => cal.cells[k]).filter(Boolean);
  if (!ws.length) return { weight: cal.baseRate, lift: 1, best: null, provider: null, mean: cal.baseRate, cells: [] };
  const best = ws.reduce((a, b) => (b.weight > a.weight ? b : a));
  return {
    weight: best.weight,
    lift: best.lift,
    best: cellKey(best.provider, best.bucket),
    provider: best.provider,
    mean: ws.reduce((s, c) => s + c.weight, 0) / ws.length,
    cells: ws.map((c) => cellKey(c.provider, c.bucket)),
  };
}

/**
 * THE COLUMN. Attaches {t2Weight, t2Lift, t2Cell, t2Provider, t2Mean, t2Thin} in place.
 * rows need {recipient}; byRecipient: Map recipient → Set(cellKey).
 */
export function attachOpenWeights(rows, byRecipient, cal) {
  for (const r of rows) {
    const keys = [...(byRecipient.get(r.recipient) || [])];
    const w = weightForCells(keys, cal);
    r.t2Weight = +w.weight.toFixed(4);
    r.t2Lift = +w.lift.toFixed(3);
    r.t2Mean = +w.mean.toFixed(4);
    r.t2Cell = w.best;
    r.t2Provider = w.provider || providerOf(r.recipient);
    r.t2Thin = !!(w.best && cal.cells[w.best]?.thin);
  }
  return rows;
}

// ── READ THE TRIALS OFF THE LOCAL MIRROR ───────────────────────────────────────────────────────
// Local SQLite only, no network. Returns null when the mirror is absent so every caller can say
// "unavailable, and here is the command" instead of printing an empty column that reads as zero.
export function loadOpenTrials({ path = MIRROR, excludeFn = () => false, mechPerDay = 8 } = {}) {
  if (!existsSync(path)) return null;
  const db = openSqlite(path, { readonly: true });
  try {
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/^.*</, '').replace(/>.*$/, '');
    // delivery time per (message_id, recipient) — the EARLIEST, since a resend of the same id
    // would otherwise make a fast open look slow.
    const delivered = new Map();
    for (const r of db.prepare(
      "SELECT message_id, recipient_email, created_at FROM email_events WHERE event_type='delivered'").all()) {
      const k = `${r.message_id}|${norm(r.recipient_email)}`;
      const t = Date.parse(r.created_at);
      if (!Number.isFinite(t)) continue;
      if (!delivered.has(k) || t < delivered.get(k)) delivered.set(k, t);
    }
    const clickers = new Set();
    for (const r of db.prepare("SELECT DISTINCT recipient_email FROM email_events WHERE event_type='click'").all()) {
      clickers.add(norm(r.recipient_email));
    }
    // Renders, WITH the volume signature attached. `renderedHuman` is the outcome the calibration
    // actually targets: a render from a mailbox that is not machine-shaped by volume. Same
    // mechPerDay cut rank-readers-t3.mjs applies, so the two files cannot disagree about what a
    // machine-shaped mailbox is.
    const renderers = new Map();
    for (const r of db.prepare(
      `SELECT recipient_email, COUNT(*) n, COUNT(DISTINCT date(created_at)) d FROM user_activity_logs
        WHERE recipient_email IS NOT NULL GROUP BY recipient_email`).all()) {
      renderers.set(norm(r.recipient_email), { n: r.n, days: r.d, perDay: r.d ? r.n / r.d : 0 });
    }

    const trials = [];
    const byRecipient = new Map();
    const people = new Map();
    for (const o of db.prepare(
      "SELECT message_id, recipient_email, created_at FROM email_events WHERE event_type='open'").all()) {
      const recipient = norm(o.recipient_email);
      if (!recipient || !recipient.includes('@') || excludeFn(recipient)) continue;
      const dAt = delivered.get(`${o.message_id}|${recipient}`);
      const oAt = Date.parse(o.created_at);
      const dtS = (Number.isFinite(dAt) && Number.isFinite(oAt)) ? (oAt - dAt) / 1000 : null;
      const provider = providerOf(recipient);
      const bucket = bucketDt(dtS);
      const rend = renderers.get(recipient) || null;
      const rendered = !!rend;
      const renderedHuman = !!rend && rend.perDay <= mechPerDay;
      trials.push({ recipient, provider, bucket, rendered, renderedHuman, dtS });
      if (!byRecipient.has(recipient)) byRecipient.set(recipient, new Set());
      byRecipient.get(recipient).add(cellKey(provider, bucket));
      const p = people.get(recipient) || { recipient, provider, opens: 0, openDays: new Set(), lastOpen: '', rendered, renderedHuman, clicked: clickers.has(recipient) };
      p.opens++;
      p.openDays.add(String(o.created_at).slice(0, 10));
      if (o.created_at > p.lastOpen) p.lastOpen = o.created_at;
      people.set(recipient, p);
    }
    for (const p of people.values()) p.openDays = p.openDays.size;
    return { trials, byRecipient, people: [...people.values()] };
  } finally { db.close(); }
}

/** What a caller prints when the mirror is missing — the command, never an empty column. */
export const MIRROR_HINT = `no local mirror at ${MIRROR} — run scripts/central/mirror-sync.mjs`;

/** The open-only population: opened, never clicked, never rendered — the readers T3 cannot see. */
export function openOnly(people) {
  return people.filter((p) => !p.clicked && !p.rendered);
}

// ── RENDERERS ──────────────────────────────────────────────────────────────────────────────────
const p1 = (x) => `${(100 * x).toFixed(1)}%`;
const dur = (s) => (s == null ? '—' : s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${(s / 60).toFixed(1)}m` : `${(s / 3600).toFixed(1)}h`);

// THE CONFOUND LINE, computed from the run's own strata rather than quoted from a comment. It is
// printed at the top of the table because a reader who takes the weight column across providers
// gets a scanner ranking, and the number is what stops them.
export function confoundLine(cal) {
  const ranked = Object.entries(cal.providerBase).filter(([, b]) => b.n >= 10)
    .sort((a, b) => b[1].rate - a[1].rate);
  if (ranked.length < 2) return 'only one provider stratum has enough mailboxes to compare — no spread to report.';
  const [hiName, hiB] = ranked[0]; const [loName, loB] = ranked[ranked.length - 1];
  const gap = loB.rate > 0 ? (hiB.rate / loB.rate).toFixed(1) : '∞';
  return `⚠ CROSS-PROVIDER COMPARISON IS INVALID: ${hiName} openers reach T3 at ${p1(hiB.rate)}, ${loName} at ${p1(loB.rate)}`
    + ` — ${gap}×. Link-rewriting gateways fetch every URL, that fetch runs our JS, a T3 row appears. Compare LIFT, within a provider.`;
}

// DOES THE Δt DIMENSION RESOLVE ANYTHING FOR THIS PROVIDER? The column is only worth reading where
// the answer is yes, and the answer is decidable from intervals already computed: take the highest
// and lowest non-thin bucket and ask whether their Wilson intervals OVERLAP. Overlapping means the
// separation between the best and worst Δt bucket is inside sampling noise — the bucket is not
// telling you anything about that provider's mailboxes and the run says so rather than printing a
// spread of numbers that looks like a finding.
//
// THE `unknown` BUCKET IS EXCLUDED FROM THIS TEST, and the exclusion is the test being honest.
// `unknown` is not a Δt value, it is the ABSENCE of one — an open whose delivered row predates the
// mirror. Including it flipped two providers to "separates" on the first run (microsoft t1 93.5%
// vs unknown 31.1%; corporate-gateway t1 38.3% vs unknown 12.9%), and neither is a statement about
// timing — it is old mail against new mail. Measured against real buckets only, corporate's own
// spread (t1 38.3% vs t4 32.6%) overlaps and the honest verdict is that Δt does not separate there.
export function discriminationOf(cal, provider) {
  const real = new Set(DT_BUCKETS.map((b) => b.key));
  const cells = Object.values(cal.cells).filter((c) => c.provider === provider && !c.thin && real.has(c.bucket));
  if (cells.length < 2) return { provider, verdict: 'too few cells', separated: false };
  const hi = cells.reduce((a, b) => (b.raw > a.raw ? b : a));
  const lo = cells.reduce((a, b) => (b.raw < a.raw ? b : a));
  const separated = lo.hi < hi.lo;
  return {
    provider,
    separated,
    hi: cellKey(hi.provider, hi.bucket),
    lo: cellKey(lo.provider, lo.bucket),
    verdict: separated
      ? `Δt separates: ${hi.bucket} ${p1(hi.raw)} vs ${lo.bucket} ${p1(lo.raw)}, intervals disjoint`
      : `Δt does NOT separate: ${hi.bucket} ${p1(hi.raw)} vs ${lo.bucket} ${p1(lo.raw)}, intervals overlap — inside noise`,
  };
}

export function renderTable(cal) {
  const out = [
    `TIER-2 OPEN CALIBRATION · P(T3=1 | open in cell) · outcome = ${cal.outcome === 'any' ? 'any render' : 'render from a non-machine-shaped mailbox'}`,
    `${cal.recipients} opener mailboxes · ${cal.trials} (recipient,cell) trials · base rate ${p1(cal.baseRate)}`,
    `denominator = EVERY opener in the cell, renderers and not. Over renderers only every cell reads 100.0%.`,
    `weight = shrunk toward the PROVIDER's base rate with a prior of ${cal.priorStrength} trials; lift = weight ÷ that base; THIN = n<${cal.thinBelow}.`,
    `SUFFICIENT FOR ranking open-only mailboxes against each other WITHIN one provider.`,
    `NOT SUFFICIENT FOR claiming any person read anything, and not for comparing providers — see the line below.`,
    '',
    confoundLine(cal),
    '',
    `  strata: ${Object.entries(cal.providerBase).sort((a, b) => b[1].n - a[1].n)
      .map(([k, b]) => `${k} ${b.k}/${b.n} ${p1(b.rate)}`).join(' · ')}`,
    '',
    `  ${'provider'.padEnd(18)}${'Δt bucket'.padEnd(22)}${'n'.padStart(5)}${'k'.padStart(5)}${'raw'.padStart(8)}${'weight'.padStart(9)}${'lift'.padStart(7)}   ${'[95% CI]'.padEnd(17)} median Δt`,
  ];
  for (const provider of PROVIDERS) {
    let any = false;
    for (const key of BUCKET_KEYS) {
      const c = cal.cells[cellKey(provider, key)];
      if (!c) continue;
      any = true;
      const label = DT_BUCKETS.find((b) => b.key === key)?.label || 'no delivered row';
      out.push(`  ${provider.padEnd(18)}${`${key} ${label}`.padEnd(22)}${String(c.n).padStart(5)}${String(c.k).padStart(5)}`
        + `${p1(c.raw).padStart(8)}${p1(c.weight).padStart(9)}${`${c.lift.toFixed(2)}×`.padStart(7)}   `
        + `${`[${p1(c.lo)} ${p1(c.hi)}]`.padEnd(17)}${dur(c.dtMedian).padStart(7)}`
        + (c.thin ? '  THIN' : ''));
    }
    if (any) {
      const d = discriminationOf(cal, provider);
      out.push(`  ${''.padEnd(18)}${d.separated ? '✓' : '·'} ${d.verdict}`, '');
    }
  }
  return out.join('\n');
}

export function renderOpenOnly(rows, { top = 40 } = {}) {
  return [
    `TIER-2 OPEN-ONLY READERS · ${rows.length} mailboxes that open and never click, never render`,
    `lift = how much likelier this mailbox's Δt shape is to reach T3 than the average mailbox ON ITS OWN PROVIDER.`,
    `Read it down a provider, never across: a 1.4× gmail row and a 1.4× corporate row are not the same claim.`,
    '',
    ...rows.slice(0, top).map((r, i) =>
      `${String(i + 1).padStart(3)}  ${`${r.t2Lift.toFixed(2)}×`.padStart(6)}  w:${p1(r.t2Weight).padStart(6)}`
      + `  opens:${String(r.opens).padStart(4)}  days:${String(r.openDays).padStart(3)}  last:${String(r.lastOpen).slice(0, 10)}`
      + `  ${String(r.t2Cell || '—').padEnd(26)}  ${r.recipient}${r.t2Thin ? '  · THIN cell' : ''}`),
  ].join('\n');
}

async function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  let excludeFn = () => false;
  try { ({ skipForPersonalReply: excludeFn } = await import('./internal-addresses.mjs')); } catch { /* rank everyone */ }
  const loaded = loadOpenTrials({ excludeFn });
  if (!loaded) { process.stderr.write(`no mirror at ${MIRROR} — run scripts/central/mirror-sync.mjs\n`); process.exit(2); }
  const cal = calibrateOpenWeights(loaded.trials, {
    priorStrength: Number(arg('--prior', '20')),
    outcome: arg('--outcome', 'human'),
  });
  const rows = attachOpenWeights(openOnly(loaded.people), loaded.byRecipient, cal)
    .sort((a, b) => b.t2Lift - a.t2Lift || b.openDays - a.openDays || b.opens - a.opens);
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify({ calibration: cal, openOnly: rows }, null, 2)); return; }
  process.stdout.write(`${renderTable(cal)}\n\n${renderOpenOnly(rows, { top: Number(arg('--top', '30')) })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
