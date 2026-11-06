#!/usr/bin/env node
// scripts/bookclub/rank-readers-t3.mjs — READERS RANKED BY WHAT CANNOT BE FAKED CHEAPLY.
//
// Operator rule (2026-08-28): a click only counts when our site rendered it. The old
// reader rankings were invalidated once already (rank-readers v2's top ten were 95-100%
// synchronized gateway clicks — sync-burst.mjs documents it). This ranker counts only
// T3 RENDER events: user_activity_logs rows whose event_data.flags.t carries the
// recipient's signed token — the page's JS ran in their browser and said who they are.
//
// RANK = distinct render DAYS first (loyalty — came back on different sends), then total
// renders, then recency. A gateway that renders headlessly still shows up here (some
// execute JS), but it cannot fake the DAYS axis cheaply across weeks without becoming
// exactly the loyal-reader behavior we want to find anyway; the residual is named, never
// hidden. Internal/self addresses are excluded via the existing internal-addresses list.
//
//   node scripts/bookclub/rank-readers-t3.mjs [--since 2026-07-08T00:00:00Z] [--top 50]
//                                             [--out FILE] [--json]
//
// Guard: tests/bookclub/rank-readers-t3.test.mjs (pure aggregation, both directions).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sbEnv, fetchAllRows } from './sb-env.mjs';
import { decodeTokenPayload } from './traffic-uplift-rank.mjs';
import { loadSettings } from './rank-settings.mjs';
import { geolocate, engagementClock, localHour, hourCenterOfMass, geoMismatch } from '../lib/ip-geo.mjs';
import {
  loadOpenTrials, calibrateOpenWeights, attachOpenWeights, openOnly,
  renderTable as renderOpenTable, renderOpenOnly, MIRROR_HINT,
} from './open-weight.mjs';

// ── pure aggregation (exported for the guard) ──────────────────────────────────────────
// events: [{recipient, ts(ISO), path}] → ranked [{recipient, renders, days, lastSeen, paths}]
// excludeFn: predicate — internal/self and role boxes (press@, info@) never rank as readers.
// mechPerDay: the renders-per-active-day above which a reader is called machine-shaped. It is a
// PARAMETER rather than a literal because it is a judgement call the operator tunes on the lab
// (scripts/bookclub/rank-lab.mjs) and saves to data/bookclub/rank-settings.json — the same value
// this CLI then reads, so the knob and the emailed file can never disagree.
export function rankReaders(events, { excludeFn = () => false, mechPerDay = 8 } = {}) {
  const byR = new Map();
  for (const e of events) {
    if (!e.recipient || excludeFn(e.recipient)) continue;
    const r = byR.get(e.recipient) ?? { recipient: e.recipient, renders: 0, days: new Set(), lastSeen: '', paths: new Set() };
    r.renders++;
    r.days.add(String(e.ts).slice(0, 10));
    if (e.ts > r.lastSeen) r.lastSeen = e.ts;
    if (e.path) r.paths.add(e.path);
    byR.set(e.recipient, r);
  }
  return [...byR.values()]
    .map(r => ({
      ...r, days: r.days.size, paths: [...r.paths],
      // A person reads a few pages a day and misses days; a sandbox detonates every send,
      // every day, at volume. Above mechPerDay renders per active day is the mechanical
      // signature — flagged, never silently dropped (measured: top row was 967 renders in
      // 34 days).
      mechanical: r.renders / r.days.size > mechPerDay,
    }))
    .sort((a, b) => b.days - a.days || b.renders - a.renders || (b.lastSeen < a.lastSeen ? -1 : 1));
}

// ── THE EMAILED FILE, RENDERED ONCE ───────────────────────────────────────────────────
// This produces the exact bytes of data/bookclub/lists/<day>/render-verified.txt. It is
// exported so the lab previews THE ARTIFACT rather than a lookalike of it: a preview that
// re-implements its subject is a second source of truth and drifts on the first edit.
// Guard: tests/bookclub/rank-lab-is-wired.test.mjs asserts lab bytes === CLI bytes.
// Each row carries r.clock when the clock is knowable — the flag plus the CENTER OF MASS of that
// reader's engagement in THEIR OWN local time (operator 2026-08-29: "if scanners read your emails
// around 1am your time that is what we want to know"). A row with no resolvable timezone prints
// nothing there rather than a UTC-defaulted hour, because a fabricated 03:00 is the one error that
// would corrupt the exact signal the column exists to carry.
export function renderTxt(ranked, { since, renders, top = 50, mechPerDay = 8 } = {}) {
  return [
    `T3 RENDER-VERIFIED READER RANKING · since ${since} · ${renders} renders from ${ranked.length} readers`,
    `rank = distinct days first (loyalty), then renders. Only pages that RAN in the reader's browser count.`,
    `clock = center of mass of that reader's engagement in their OWN local time (circular mean), with`,
    `how tightly it clusters. 😴 = the mass sits in 01:00–05:00 local: read while its own owner sleeps.`,
    '',
    ...ranked.slice(0, top).map((r, i) =>
      `${String(i + 1).padStart(3)}  days:${String(r.days).padStart(3)}  renders:${String(r.renders).padStart(4)}  last:${r.lastSeen.slice(0, 10)}  ${(r.clock || '').padEnd(30)}  ${r.recipient}${r.mechanical ? `  ⚠ mechanical (>${mechPerDay} renders/day — sandbox-shaped)` : ''}${r.geoMismatch ? '  ⚑ egress country ≠ domain country' : ''}`),
  ].join('\n');
}

// Attach the engagement clock to each ranked row, in place. Kept beside rankReaders so every
// caller — CLI, lab, report — gets the identical column instead of three near-copies.
// events must carry {recipient, ts, ip}; geo is the Map from geolocate().
export function attachClocks(ranked, events, geo) {
  const byR = new Map();
  for (const e of events) {
    if (!byR.has(e.recipient)) byR.set(e.recipient, []);
    byR.get(e.recipient).push(e);
  }
  for (const r of ranked) {
    const evs = (byR.get(r.recipient) || []).map((e) => ({ when: e.ts, geo: (e.ip && geo?.get?.(e.ip)) || null }));
    r.clock = engagementClock(evs);
    r.com = hourCenterOfMass(evs.map((e) => localHour(e.when, e.geo)).filter((h) => h != null));
    r.asleepMass = !!(r.com && r.com.hour != null && r.com.hour >= 1 && r.com.hour < 5);
    // THE THIRD SIGNAL, and the one that needs no timing at all: does the egress country match
    // the domain's own country? Found 2026-08-29 by turning the machine cut on the lab — the
    // 5–8/day band the render cut cannot judge turned out to be full of .se domains reading
    // from Ireland at 23:00. null when there is no opinion to have (a .com says nothing).
    const cc = evs.map((e) => e.geo?.countryCode).find(Boolean) || null;
    r.geoMismatch = geoMismatch(r.recipient, cc);
  }
  return ranked;
}

async function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  // THE SETTINGS FILE IS THE DEFAULT, THE FLAG IS THE OVERRIDE. The lab writes that file, so a
  // dial turned on localhost reaches this nightly run — that is the whole point of the lab, and
  // a knob that stopped at the preview would be a control wired to nothing.
  const S = loadSettings();
  const SINCE = arg('--since', S.since);
  const TOP = parseInt(arg('--top', String(S.topReaders)), 10);
  const MECH = Number(arg('--mech-per-day', String(S.mechPerDay)));
  const OUT = arg('--out', null);

  const sb = sbEnv();
  if (!sb) { console.error('not verified against the API — no Supabase env; refusing to fake it'); process.exit(1); }

  // T3 renders: page_views whose flags carry a token. The filter runs server-side so we
  // never page through untokened ambient traffic.
  const rows = await fetchAllRows(
    `${sb.SB}/rest/v1/user_activity_logs?created_at=gte.${SINCE}` +
    `&event_data->flags->>t=not.is.null&select=created_at,page_url,event_data,ip_address&order=created_at.asc`,
    sb.headers);

  const events = [];
  for (const v of rows) {
    const p = decodeTokenPayload(v.event_data?.flags?.t);
    if (p?.recipient_email) events.push({ recipient: p.recipient_email, ts: v.created_at, path: v.page_url, ip: v.ip_address || null });
  }

  // self/internal + role-box exclusion — reuse the existing predicates, never a hand copy
  let excludeFn = () => false;
  try {
    const { skipForPersonalReply } = await import('./internal-addresses.mjs');
    excludeFn = skipForPersonalReply;
  } catch { /* list unavailable → rank everyone, say nothing false */ }

  const ranked = rankReaders(events, { excludeFn, mechPerDay: MECH });

  // THE CLOCK. Geo is a network call, so --no-geo skips it and the column renders empty rather
  // than guessed — an absent clock is a different claim from a midnight one.
  if (!process.argv.includes('--no-geo')) {
    try {
      const geo = await geolocate(events.map((e) => e.ip).filter(Boolean));
      attachClocks(ranked, events, geo);
    } catch { /* ship the ranking without the column rather than with a fabricated one */ }
  }

  // ── TIER 2: THE CALIBRATED OPEN WEIGHT ───────────────────────────────────────────────────────
  // 305 mailboxes open and never click and never render, so the ladder above scores them zero and
  // they fall off the page — unmeasured by the strictest instrument, which is a different fact from
  // absent. open-weight.mjs asks the only question an open can answer: among mailboxes whose opens
  // look like these, what share turned out to be render-verified? It is computed over the FULL
  // opener denominator (775 mailboxes on this mirror, renderers and not) — over renderers only,
  // every cell reads 100% and the column would rank everyone identically while looking like it
  // worked.
  //
  // IT IS A SEPARATE SECTION AND MUST STAY ONE. A calibrated probability and a render receipt are
  // different objects; merging them would put an estimate on the ladder this file exists to keep
  // clean. --no-tier2 skips it; a missing mirror SAYS so and prints the command, because an empty
  // column reads as zero and zero is a claim.
  let tier2 = null;
  if (!process.argv.includes('--no-tier2')) {
    const loaded = loadOpenTrials({ excludeFn, mechPerDay: MECH });
    if (!loaded) tier2 = { unavailable: MIRROR_HINT };
    else {
      const cal = calibrateOpenWeights(loaded.trials, { outcome: 'human' });
      const openRows = attachOpenWeights(openOnly(loaded.people), loaded.byRecipient, cal)
        .sort((a, b) => b.t2Lift - a.t2Lift || b.openDays - a.openDays || b.opens - a.opens);
      tier2 = { cal, openRows };
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      since: SINCE, readers: ranked,
      tier2: tier2?.cal ? { calibration: tier2.cal, openOnly: tier2.openRows } : tier2,
    }, null, 2));
    return;
  }

  // ONE RENDERER. main() built these lines inline until 2026-08-29, which meant the lab's
  // "this is the emailed file" panel was a second implementation of the same format and would
  // have drifted on the first edit to either. renderTxt is now the only place it exists.
  const text = renderTxt(ranked, { since: SINCE, renders: events.length, top: TOP, mechPerDay: MECH });
  // The tier-2 block is APPENDED to the rendered file rather than folded into renderTxt, so the
  // bytes the lab previews (rank-lab-is-wired.test.mjs asserts lab === CLI) stay the T3 ladder and
  // the estimate arrives below it, under its own heading, never interleaved.
  const tier2Txt = !tier2 ? ''
    : tier2.unavailable ? `\n\nTIER-2 CALIBRATED OPEN WEIGHT · unavailable — ${tier2.unavailable}`
      : `\n\n${renderOpenTable(tier2.cal)}\n\n${renderOpenOnly(tier2.openRows, { top: TOP })}`;
  console.log(text + tier2Txt);
  if (OUT) { writeFileSync(OUT, text + tier2Txt + '\n'); console.error(`→ ${OUT}`); }

  // ── --html: THE LEGIBLE FORM (operator 2026-08-29: "rank the addresses legibly — it made
  //    a mess"). The plain-text list was stapled into the full report as a <pre> block, and
  //    on the day this shipped NINE of its top ten rows carried "⚠ mechanical" — the reader
  //    ranking's own headline was a list of sandboxes, and a human had to read past them to
  //    find a person. Measured 2026-08-28: 288 readers, top ten all flagged, the first
  //    unflagged profile at rank 10.
  //
  //    The flag was already computed and already honest; what was wrong was the LAYOUT
  //    putting a machine and a person on the same ladder. So the same ranking renders as two
  //    tables: PEOPLE first, MACHINE-SHAPED below, each keeping its own rank so nothing is
  //    hidden and the split is auditable. The >8/day threshold stays blunt and is SAID to be
  //    blunt in the page — several unflagged rows sit at 7-something renders a day, which is
  //    still a lot of reading, so the flag marks the certain machines, never the certain
  //    humans.
  const HTML = arg('--html', null);
  if (HTML) {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const people = ranked.filter(r => !r.mechanical);
    const machines = ranked.filter(r => r.mechanical);
    // THE CLOCK COLUMN — flag + center of mass of engagement in the READER'S local time.
    // An address the render cut calls a person, whose reading clusters at 03:00 in its own
    // timezone, is the shape the operator asked to surface; it is highlighted, not just printed.
    const row = (r) => `<tr style="border-bottom:1px solid #eee6d8">
      <td style="padding:5px 9px;color:#a89f8a">${ranked.indexOf(r) + 1}</td>
      <td style="padding:5px 9px;font-weight:600">${esc(r.recipient)}</td>
      <td style="padding:5px 9px;text-align:right;font-weight:700">${r.days}</td>
      <td style="padding:5px 9px;text-align:right;color:#6b7280">${r.renders}</td>
      <td style="padding:5px 9px;white-space:nowrap${r.asleepMass ? ';background:#fdf0f0;color:#b32020;font-weight:700' : ';color:#4a463e'}">${esc(r.clock || '—')}</td>
      <td style="padding:5px 9px;text-align:right;color:#8a8578;white-space:nowrap">${r.lastSeen.slice(0, 10)}</td></tr>`;
    const table = (rowsIn) => `<table style="border-collapse:collapse;width:100%;font:12.5px/1.45 -apple-system,sans-serif;background:#fff;border:1px solid #eee6d8">
<tr style="background:#f3efe4;text-align:left"><th style="padding:5px 9px">#</th><th style="padding:5px 9px">address</th><th style="padding:5px 9px;text-align:right">days</th><th style="padding:5px 9px;text-align:right">renders</th><th style="padding:5px 9px">engagement clock (their local time)</th><th style="padding:5px 9px;text-align:right">last</th></tr>${rowsIn.map(row).join('')}</table>`;
    // TIER 2, AS A THIRD TABLE AND NOT A THIRD SECTION OF THE LADDER. It carries its own header
    // saying what it is — an estimate against the T3 outcome — plus the cross-provider warning,
    // because the two numbers most likely to be misread off this page are a corporate 36% and a
    // gmail 5% put side by side, and those are not the same measurement.
    const t2Html = !tier2 ? ''
      : tier2.unavailable
        ? `<div style="font:700 12px/1 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9a6700;margin:18px 0 6px">Tier-2 open weight — unavailable</div>
<p style="font:11.5px/1.5 -apple-system,sans-serif;color:#8a8578;margin:0">${esc(tier2.unavailable)}</p>`
        : `<div style="font:700 12px/1 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#0b6ea8;margin:18px 0 6px">Tier-2 — opened, never clicked, never rendered · ${tier2.openRows.length}</div>
<p style="font:11.5px/1.5 -apple-system,sans-serif;color:#8a8578;margin:0 0 6px">These mailboxes score zero on the ladder above because the strictest instrument cannot see them. The weight is empirical: among the ${tier2.cal.recipients} opener mailboxes on this mirror, the share whose opens landed in the same (provider, Δt) cell and who <em>did</em> turn out render-verified. It is a population rate wearing a row's name — sufficient for ordering these rows against each other, not for saying anyone read anything.</p>
<p style="font:11.5px/1.5 -apple-system,sans-serif;color:#b32020;margin:0 0 6px">Read <strong>lift</strong> down a provider, never across one. Openers on company domains reach T3 far more often than Gmail openers, and that gap is link-rewriting gateways fetching every URL — not readership.</p>
<table style="border-collapse:collapse;width:100%;font:12.5px/1.45 -apple-system,sans-serif;background:#fff;border:1px solid #eee6d8">
<tr style="background:#f3efe4;text-align:left"><th style="padding:5px 9px">#</th><th style="padding:5px 9px">address</th><th style="padding:5px 9px">provider · Δt cell</th><th style="padding:5px 9px;text-align:right">lift</th><th style="padding:5px 9px;text-align:right">weight</th><th style="padding:5px 9px;text-align:right">opens</th><th style="padding:5px 9px;text-align:right">days</th><th style="padding:5px 9px;text-align:right">last</th></tr>
${tier2.openRows.slice(0, TOP).map((r, i) => `<tr style="border-bottom:1px solid #eee6d8">
  <td style="padding:5px 9px;color:#a89f8a">${i + 1}</td>
  <td style="padding:5px 9px;font-weight:600">${esc(r.recipient)}</td>
  <td style="padding:5px 9px;color:#6b7280;white-space:nowrap">${esc(r.t2Cell || '—')}${r.t2Thin ? ' · thin' : ''}</td>
  <td style="padding:5px 9px;text-align:right;font-weight:700">${r.t2Lift.toFixed(2)}×</td>
  <td style="padding:5px 9px;text-align:right;color:#6b7280">${(100 * r.t2Weight).toFixed(1)}%</td>
  <td style="padding:5px 9px;text-align:right;color:#6b7280">${r.opens}</td>
  <td style="padding:5px 9px;text-align:right;color:#6b7280">${r.openDays}</td>
  <td style="padding:5px 9px;text-align:right;color:#8a8578;white-space:nowrap">${String(r.lastOpen).slice(0, 10)}</td></tr>`).join('')}
</table>`;
    writeFileSync(HTML, `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p style="font:13px/1.5 -apple-system,sans-serif;color:#4a463e;margin:0 0 10px">${events.length} renders from ${ranked.length} readers since ${esc(SINCE.slice(0, 10))}. Rank = distinct DAYS first (came back across different sends), then total renders. Only pages that RAN in the reader's browser count.</p>
<div style="font:700 12px/1 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#1a7f37;margin:0 0 6px">People — ${people.length}</div>
${table(people.slice(0, TOP))}
<div style="font:700 12px/1 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9a6700;margin:18px 0 6px">Machine-shaped — ${machines.length}</div>
<p style="font:11.5px/1.5 -apple-system,sans-serif;color:#8a8578;margin:0 0 6px">Over 8 renders per active day: a person reads a few pages and misses days, a sandbox detonates every send. Shown, never dropped — and the threshold is blunt on purpose, so several rows just above the human list sit at 7-something and are not certainly people either. This marks the certain machines only.</p>
${table(machines.slice(0, Math.min(TOP, 25)))}
${t2Html}
<p style="font:11.5px/1.5 -apple-system,sans-serif;color:#8a8578;margin:10px 0 0">Recompute: node scripts/bookclub/rank-readers-t3.mjs --top ${TOP} --html &lt;path&gt;</p>
</body></html>`);
    console.error(`→ ${HTML}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
