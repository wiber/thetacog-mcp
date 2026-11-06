// scripts/lib/ip-geo.mjs — THE ONE ip-api field list, and the recipient-local clock it exists for.
//
// WHY THIS MODULE EXISTS (measured, 2026-08-11). The click stream cannot tell a person from a
// security gateway on timing alone. Over 18,041 geo-labelled book-club clicks the two populations
// are the SAME shape: median latency from delivery→click is 73s for datacenter IPs and 66s for
// non-datacenter; 34.6% vs 39.6% land inside the first minute. They are not spoofing a human curve
// — they simply click at the same moment a person opening on arrival clicks, so the send event is
// the only clock either one is running on. Every timing heuristic scored against an independent
// label failed the same way: `latency > 120s` still admits 79.7% datacenter, `real-browser UA`
// 86.7% (gateways send ordinary Mozilla/Windows strings), `distinct dests <= 3` 96.6%.
//
// The one thing a gateway CANNOT fake is clicking at 03:00 in the recipient's own timezone when
// nothing has just been sent and the human is asleep. That requires the recipient's LOCAL hour,
// which requires `offset` — and `offset` is exactly the field the four hand-copied call sites
// never asked for. Hence: one field list, in one place, with the clock fields in it.
//
// The list was duplicated verbatim across click-geo-report.mjs, human-report.mjs,
// nominee-research.mjs and analytics/sync-clicks.mjs; adding a field meant editing four files and
// remembering all four (ONE RULE LIVES IN ONE PLACE — CLAUDE.md). Import from here instead.
//
// Guard: tests/bookclub/ip-geo-fields.test.js.

// ip-api.com/batch fields. Ordered by what they are FOR, not alphabetically.
//   status,query          — envelope: did the lookup work, and for which IP
//   offset,timezone       — THE CLOCK. offset is UTC-offset in SECONDS; it is the only field that
//                           turns a click timestamp into the recipient's local hour, which is the
//                           only signal a gateway cannot manufacture. Never drop these.
//   countryCode,country   — countryCode is the stable key; country is for display only
//   regionName,city,lat,lon
//   isp,org,as,asname     — `as` is the ASN. Gateways rotate IPs WITHIN one ASN, so ASN fan-out
//                           survives the rotation that per-IP fan-out does not (measured: two
//                           Microsoft-ASN IPs served 22 and 23 distinct recipients each).
//   mobile                — mobile carrier. A gateway does not egress via a phone network.
//   proxy,hosting         — hosting=true is the datacenter tell: 86.6% of click instances.
export const IP_API_FIELDS = [
  'status', 'query',
  'offset', 'timezone',
  'countryCode', 'country', 'regionName', 'city', 'lat', 'lon',
  'isp', 'org', 'as', 'asname',
  'mobile', 'proxy', 'hosting',
].join(',');

// ip-api /batch caps at 15 req/min. 4.5s spacing keeps every batch answered instead of silently
// 429'd — and a missing geo erases the datacenter signal, which under-counts scanners rather than
// failing loudly. Pacing is part of correctness here, not politeness.
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 4500;

export async function geolocate(ips, { pauseMs = BATCH_PAUSE_MS } = {}) {
  const out = new Map();
  const list = [...new Set(ips.filter(Boolean))];
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE).map((ip) => ({ query: ip, fields: IP_API_FIELDS }));
    try {
      const res = await fetch('http://ip-api.com/batch', { method: 'POST', body: JSON.stringify(batch) }).then((r) => r.json());
      for (const g of res || []) if (g.status === 'success') out.set(g.query, g);
    } catch { /* caller ships without geo for this batch */ }
    if (i + BATCH_SIZE < list.length) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return out;
}

// ── THE LOCAL CLOCK ─────────────────────────────────────────────────────────────────────────────
// localHour(whenISO, geo) → hour 0..23 in the CLICKER's own timezone, or null when we cannot know.
// Returning null is load-bearing: an unknown offset must never silently become UTC, because a
// UTC-defaulted 03:00 is a fabricated "asleep" label and the whole study rests on that label being
// a fact rather than a guess. Absent geo → the click is UNCLASSIFIED, never ASLEEP and never AWAKE.
export function localHour(when, geo) {
  const off = geo?.offset;
  if (off == null || !Number.isFinite(Number(off))) return null;
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + Number(off) * 1000).getUTCHours();
}

// SLEEP_WINDOW is deliberately narrow. 01:00–04:59 local excludes the late-evening phone check
// (23:00–00:59, genuinely human and common in European corporate inboxes) and the early riser
// (05:00+). We would rather label fewer clicks than label one awake human as a machine — the
// window's job is to produce clean NEGATIVES, not to catch every machine.
export const SLEEP_WINDOW = { from: 1, to: 5 };
export function isAsleep(when, geo) {
  const h = localHour(when, geo);
  if (h == null) return null;                       // unknown ≠ awake
  return h >= SLEEP_WINDOW.from && h < SLEEP_WINDOW.to;
}

// A click that lands while its own recipient is asleep is a machine — no heuristic in the chain.
// This is the ONLY classifier in the codebase that does not score one guess against another.
export function verdictFromClock(when, geo) {
  const asleep = isAsleep(when, geo);
  if (asleep == null) return { verdict: 'UNCLASSIFIED', reason: 'no timezone offset for this IP' };
  if (asleep) return { verdict: 'MACHINE', reason: `clicked at ${localHour(when, geo)}:00 local — recipient asleep` };
  return { verdict: 'AWAKE-WINDOW', reason: `clicked at ${localHour(when, geo)}:00 local — could be a person` };
}

// ── THE FLAG, AND THE CENTER OF MASS OF ENGAGEMENT (operator 2026-08-29) ────────────────────────
// "the preview message in those need the geo emoji, and time of day center of mass of engagement
// (local time) — look through all email sends, and algos and add this data everywhere (if scanners
// read your emails around 1am your time that is what we want to know)."
//
// verdictFromClock above answers this for ONE click. A reader is a POPULATION of clicks, and the
// question "when does this address actually read?" is a property of the population — which is why
// it needs its own statistic rather than a loop over the single-click verdict.

/** 'SE' → 🇸🇪. Regional-indicator pair; returns '' for anything that is not a 2-letter code. */
export function countryEmoji(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65, 0x1F1E6 + c.charCodeAt(1) - 65);
}

// THE MEAN MUST BE CIRCULAR, AND THIS IS NOT A DETAIL. Hours live on a circle: a reader who hits
// 23:00 and 01:00 has a center of mass at MIDNIGHT, and the arithmetic mean of 23 and 1 is 12 —
// high noon, the opposite side of the clock, and precisely the wrong answer about the one address
// shape we are hunting. So the hours become unit vectors, the vectors are summed, and the angle of
// the resultant is the answer (Fisher, Statistical Analysis of Circular Data, §2.2).
//
// The resultant LENGTH comes back too, and it carries as much signal as the angle. R is 0 when the
// reads are spread evenly around the clock and 1 when every read lands at the same instant of the
// day. A person's reading is diffuse — mornings, a lunch check, an evening catch-up — so a human R
// is low. A cron job fires at the same local minute forever, so its R pins near 1. A tight cluster
// at 03:00 is a scheduled scan; a loose cluster at 03:00 might be one insomniac in a small sample.
//
// hours: [0..23] (nulls dropped by the caller) → { hour, minute, R, n } | null when nothing is known
export function hourCenterOfMass(hours) {
  const hs = (hours || []).filter((h) => Number.isFinite(h));
  if (!hs.length) return null;
  let sx = 0; let sy = 0;
  for (const h of hs) {
    const a = (h / 24) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const R = Math.sqrt(sx * sx + sy * sy) / hs.length;
  // A resultant of ~zero means the reads are spread right around the clock and the angle is
  // meaningless — atan2(0,0) is 0, which would print a confident "00:00". Say so instead.
  if (R < 1e-9) return { hour: null, minute: null, R: 0, n: hs.length };
  let a = Math.atan2(sy, sx);
  if (a < 0) a += 2 * Math.PI;
  const frac = (a / (2 * Math.PI)) * 24;
  let hour = Math.floor(frac);
  let minute = Math.round((frac - hour) * 60);
  if (minute === 60) { minute = 0; hour = (hour + 1) % 24; }
  return { hour: hour % 24, minute, R, n: hs.length };
}

/** how tight the clustering is, in words. Bands are stated, never implied. */
export function spreadLabel(R) {
  if (R == null) return '';
  if (R >= 0.90) return 'clockwork';        // same local minute every time — scheduled
  if (R >= 0.70) return 'tight';
  if (R >= 0.40) return 'clustered';
  return 'spread';                          // reads all round the clock — human-shaped
}

/**
 * The one-glance string every send, report and ranking prints: flag, the local center of mass,
 * how tight it is, and an explicit ASLEEP mark when the mass sits in the sleep window.
 *   engagementClock([{when, geo}, …]) → "🇸🇪 03:14 local · clockwork · 😴 asleep"
 * Returns '' when nothing is knowable — an unknown clock must never render as a confident 00:00.
 *
 * THE LIMITATION, STATED BECAUSE IT CHANGES HOW THE COLUMN READS. The flag and the offset belong
 * to the EGRESS IP, not to the person. When mail is fetched through a security gateway the egress
 * is the gateway's datacenter, so the clock is Dublin's or Amsterdam's rather than the reader's —
 * measured on the first live run, a visible band of 🇮🇪/🇳🇱 rows sitting at 21:00–23:00, which is
 * an Azure/AWS egress fingerprint and not an Irish reader's evening.
 *
 * This does not weaken the machine signal, it sharpens it: many addresses sharing one flag and one
 * narrow hour IS the gateway, and that is worth seeing. What it forbids is the other reading —
 * this column can never be used to say "this HUMAN reads at 23:00", because for a proxied address
 * the hour is not theirs. Direct residential/mobile egress is the case where the clock is the
 * person's, and `mobile`/`hosting`/`proxy` from the same lookup are what separate the two.
 */
export function engagementClock(events) {
  const hours = [];
  let cc = '';
  for (const e of events || []) {
    const h = localHour(e.when, e.geo);
    if (h != null) hours.push(h);
    if (!cc && e.geo?.countryCode) cc = e.geo.countryCode;
  }
  const com = hourCenterOfMass(hours);
  const flag = countryEmoji(cc);
  if (!com || com.hour == null) return flag;                 // flag alone beats a fabricated clock
  const hh = String(com.hour).padStart(2, '0');
  const mm = String(com.minute).padStart(2, '0');
  const asleep = com.hour >= SLEEP_WINDOW.from && com.hour < SLEEP_WINDOW.to;
  return `${flag ? flag + ' ' : ''}${hh}:${mm} local · ${spreadLabel(com.R)}${asleep ? ' · 😴 asleep' : ''}`.trim();
}

// ── THE DOMAIN SAYS ONE COUNTRY, THE EGRESS SAYS ANOTHER ────────────────────────────────────────
// Found by turning the machine-cut dial on the lab, 2026-08-29. The render cut (>8/day) leaves a
// band of readers at 5–8/day that it cannot judge, and the clock column exposed what they are: a
// `.se` domain whose reads egress from Ireland or the Netherlands at 23:00, or from the US at
// exactly 17:00 every single time. That is Microsoft 365 / AWS regional routing, not a Swede.
//
// MEASURED on the live corpus: of 24 ccTLD domains with a resolvable clock, 15 (63%) mismatched,
// and 12 of those still passed as people — every one of them between 5.0 and 8.0 renders a day.
// The clearest single row is skatteverket.se — the Swedish Tax Agency — reading from a US IP at
// 17:00 clockwork.
//
// THE SAMPLE IS SMALL AND THIS IS A FLAG, NEVER A VERDICT. Twenty-four domains is not a rate you
// can price, legitimate travel and multinationals both produce honest mismatches, and a .com tells
// you nothing at all (which is why only ccTLDs are tested). It earns its place by being CHEAP and
// INDEPENDENT: it uses no timing, so it does not inherit the render cut's blind spot, and two
// independent signals agreeing is worth more than either alone.
const CC_TLD = {
  se: 'SE', ae: 'AE', nl: 'NL', ie: 'IE', dk: 'DK', no: 'NO', fi: 'FI', de: 'DE', fr: 'FR',
  uk: 'GB', ch: 'CH', it: 'IT', es: 'ES', be: 'BE', at: 'AT', pl: 'PL', pt: 'PT', gr: 'GR',
  in: 'IN', sg: 'SG', au: 'AU', ca: 'CA', br: 'BR', za: 'ZA', jp: 'JP', nz: 'NZ', ru: 'RU',
};

/** 'redacted@example.com' → 'SE'. Returns '' for .com/.org/.net and anything not a known country TLD. */
export function ccTldCountry(address) {
  const tld = String(address || '').split('.').pop().toLowerCase();
  return CC_TLD[tld] || '';
}

/**
 * null  — no opinion (not a ccTLD, or no geo). Never guess.
 * false — the egress country matches the domain's country.
 * true  — MISMATCH: worth looking at, on its own worth nothing.
 */
export function geoMismatch(address, countryCode) {
  const want = ccTldCountry(address);
  const got = String(countryCode || '').toUpperCase();
  if (!want || !/^[A-Z]{2}$/.test(got)) return null;
  return want !== got;
}
