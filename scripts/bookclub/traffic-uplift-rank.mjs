#!/usr/bin/env node
// scripts/bookclub/traffic-uplift-rank.mjs — DID THE NEWSLETTER MOVE THE SITE?
//
// Operator ask (2026-08-28): "correlate the clicks onto the site with the newsletter…
// check SQLite / the visit log to figure out which newsletter sends correlate with visits
// to the website… rank this newsletter — it has to be a percentile and a ranked list."
//
// The email-side metrics (opens/clicks) measure the MAILBOX, and the same-age forensics
// showed the first-hour click column is scanner-dominated (47 of 56 clickers in one
// 3-second gateway burst on 2026-08-28). Site visits are the harder currency: a page_view
// in user_activity_logs is a browser actually rendering the site. This script measures,
// per send, the visit RUSH the send preceded, against the quiet immediately before it.
//
// METHOD (each send at time T, window W minutes):
//   POST  = distinct visitor sessions in [T, T+W)          — the rush
//   PRE   = distinct visitor sessions in [T-W, T)          — the baseline
//   uplift = (POST+1)/(PRE+1)                              — Laplace-smoothed ratio
// Baseline is the window ENDING at the send, not same-clock-yesterday: sends fire near
// the same clock hour daily, so yesterday's window contains yesterday's own rush and
// flattens every uplift toward 1. Time-of-day bias is uniform across sends (same hour),
// and the output is a RANKING among sends, not an absolute traffic claim.
//
// Sessions counted two ways: ALL (any page_view) and HUMAN (event_data.human_score > 0).
// Measured 2026-08-28: human_score is >0 on almost no page_view row (the signals arrive
// in later beacons the tracker does not fold back), so the RANK uses ALL sessions and the
// human column rides along as information — never let a starved filter zero the metric.
//
// The window anchors at send START, not the ledger ts: individualized sends span up to
// ~54 minutes and the ledger stamps completion, so anchoring at ts put the rush in the
// PRE window (measured: 323 pre vs 52 post on 2026-08-28 before this correction).
//
// A send younger than W is ranked on a clipped window applied uniformly to every send
// (same-age discipline: never compare a 90-minute-old send's rush to a 6-hour rush).
//
//   node scripts/bookclub/traffic-uplift-rank.mjs [--win-min 360] [--last 20] [--json]
//
// Data: Central Supabase user_activity_logs (the /api/track/visit-shape sink) + the send
// ledger data/bookclub/sent.ndjson. Guard: tests/bookclub/traffic-uplift-rank.test.mjs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stripClubStem } from './club-subject.mjs';   // either subject shape (2026-10-07)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── pure math (exported for the guard) ─────────────────────────────────────────────────
export function uplift(post, pre) { return (post + 1) / (pre + 1); }

// CLICK CORROBORATION — which email clicks actually LANDED on the site.
// An email "open" can never corroborate (the pixel is fetched from the tracker's domain,
// it never touches the site); a click corroborates when a page_view follows it:
//   STRICT — the click carries a dest URL and a page_view of the SAME pathname appears
//            within [-skewS, +destWinS] of it (skew absorbs webhook-insert lag);
//   WEAK   — the click has no dest (measured 2026-08-29: only ~17% carry one) and ANY
//            page_view appears within [-skewS, +timeWinS]. Weak is only evidence because
//            the sends fire into near-zero ambient traffic; never read it as proof.
// clicks: [{t(ms), path|null, who}] · views: [{t(ms), path}]
// The WEAK tier SATURATES in a dense window (373 views in 152m ≈ one every 25s, so "any
// view within 2m" corroborates almost any click) — it is a volume signal, never an
// identity signal. Only STRICT clicks name people: whoStrict is the list to trust.
// STRICT collides too when the path is POPULAR: "/" is viewed roughly once a minute in a
// rush, so a wide window matches somebody's view for any "/" click. A human's page loads
// within seconds of the click, so strict stays tight — 120s forward, 30s skew. Residual
// limit, stated: on the hottest path a strict hit is still time-coincidence, not identity.
export function corroborate(clicks, views, { destWinS = 120, timeWinS = 120, skewS = 30 } = {}) {
  const out = { strict: 0, weak: 0, uncorroborated: 0, who: new Set(), whoStrict: new Set() };
  for (const c of clicks) {
    const hit = c.path
      ? views.some(v => v.path === c.path && v.t >= c.t - skewS * 1000 && v.t <= c.t + destWinS * 1000)
      : views.some(v => v.t >= c.t - skewS * 1000 && v.t <= c.t + timeWinS * 1000);
    if (hit && c.path) { out.strict++; out.who.add(c.who); out.whoStrict.add(c.who); }
    else if (hit) { out.weak++; out.who.add(c.who); }
    else out.uncorroborated++;
  }
  return out;
}

// THE THREE TIERS OF A CLICK (operator 2026-08-28: "if the site doesn't render then the
// click doesn't count" — non-negotiable):
//   T1 MAILBOX — a Resend webhook click event. Proves a machine somewhere fetched the
//                tracking redirect. Gateways mass-produce these (47 clickers in 3s).
//   T2 FETCH   — our middleware saw ?t= and click-log verified the signature: the SITE
//                was HIT, with the clicker's own UA/IP. token IS NOT NULL in email_events.
//   T3 RENDER  — user_activity_logs carries the same token in event_data.flags.t: the
//                page's JS RAN in a browser. This is the tier that counts as a person.
// decodeTokenPayload reads the JWT payload WITHOUT verifying — fine here because T3 rows
// only exist when click-log's verifying route already accepted the same token upstream;
// analysis never mints trust, it groups what the verifier admitted.
export function decodeTokenPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return null; }
}

// rows: [{day, human_post, human_pre, ...}] → ranked desc by uplift, each row gains
// {uplift, rank, pctl}. Percentile = share of OTHER sends this send beats (0..100).
export function rankSends(rows) {
  const scored = rows.map(r => ({ ...r, uplift: uplift(r.all_post ?? r.human_post, r.all_pre ?? r.human_pre) }));
  scored.sort((a, b) => b.uplift - a.uplift);
  const n = scored.length;
  scored.forEach((r, i) => {
    r.rank = i + 1;
    r.pctl = n > 1 ? Math.round(100 * (n - 1 - i) / (n - 1)) : 100;
  });
  return scored;
}

// ── main ───────────────────────────────────────────────────────────────────────────────
async function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  const LAST = parseInt(arg('--last', '20'), 10);
  let WIN = parseInt(arg('--win-min', '360'), 10);

  const sb = (await import('./sb-env.mjs')).sbEnv();
  if (!sb) { console.error('not verified against the API — no Supabase env; refusing to fake it'); process.exit(1); }
  const { SB, headers: H } = sb;

  const seen = new Map();
  for (const line of readFileSync(resolve(REPO, 'data/bookclub/sent.ndjson'), 'utf8').trim().split('\n')) {
    const s = JSON.parse(line);
    if ((s.recipients ?? 0) > 400) seen.set(s.day, s); // last ledger entry per day wins
  }
  const sends = [...seen.values()]
    .map(s => {
      const done = new Date(String(s.ts).replace(' ', 'T').replace(/\+00$/, 'Z'));
      return { ...s, t0: new Date(done.getTime() - (s.span_min ?? 0) * 60000) };
    })
    .filter(s => !isNaN(s.t0))
    .sort((a, b) => a.t0 - b.t0)
    .slice(-LAST);
  if (!sends.length) { console.error('no sends in ledger'); process.exit(1); }

  // same-age clip: the youngest send bounds the window for everyone
  const ageMin = Math.floor((Date.now() - sends[sends.length - 1].t0.getTime()) / 60000);
  if (ageMin < WIN) { WIN = ageMin; console.error(`(latest send is ${ageMin}m old — window clipped to ${WIN}m for every send)`); }

  const fetchAll = (base) => import('./sb-env.mjs').then(m => m.fetchAllRows(base, H));

  async function sessions(fromIso, toIso) {
    const rows = await fetchAll(
      `${SB}/rest/v1/user_activity_logs?created_at=gte.${fromIso}&created_at=lt.${toIso}` +
      `&interaction_type=eq.page_view&select=session_id,page_url,created_at,event_data&order=created_at.asc`);
    const all = new Set(), human = new Set(), views = [];
    const renderWho = new Set();
    for (const v of rows) {
      all.add(v.session_id);
      if ((v.event_data?.human_score ?? 0) > 0) human.add(v.session_id);
      views.push({ t: new Date(v.created_at).getTime(), path: v.page_url });
      const tok = v.event_data?.flags?.t;
      if (tok) {
        const p = decodeTokenPayload(tok);
        if (p?.recipient_email) renderWho.add(p.recipient_email);
      }
    }
    return { all: all.size, human: human.size, views, renderWho };
  }

  async function clicksIn(fromIso, toIso) {
    const rows = await fetchAll(
      `${SB}/rest/v1/email_events?event_type=eq.click&created_at=gte.${fromIso}&created_at=lt.${toIso}` +
      `&select=created_at,dest,recipient_email&order=created_at.asc`);
    return rows.map(c => {
      let path = null;
      if (c.dest) { try { path = new URL(c.dest).pathname; } catch {} }
      return { t: new Date(c.created_at).getTime(), path, who: c.recipient_email };
    });
  }

  const rows = [];
  for (const s of sends) {
    const t0 = s.t0, t1 = new Date(t0.getTime() + WIN * 60000), tPre = new Date(t0.getTime() - WIN * 60000);
    const post = await sessions(t0.toISOString(), t1.toISOString());
    const pre = await sessions(tPre.toISOString(), t0.toISOString());
    const clicks = await clicksIn(t0.toISOString(), t1.toISOString());
    const corr = corroborate(clicks, post.views);
    // T2: clicks our own middleware verified (token present in the email_events row)
    const fetchVerified = await fetchAll(
      `${SB}/rest/v1/email_events?event_type=eq.click&token=not.is.null` +
      `&created_at=gte.${t0.toISOString()}&created_at=lt.${t1.toISOString()}&select=recipient_email`);
    rows.push({
      day: s.day, subject: s.subject, human_post: post.human, human_pre: pre.human,
      all_post: post.all, all_pre: pre.all,
      clicks: clicks.length, clickers: new Set(clicks.map(c => c.who)).size,
      corr_strict: corr.strict, corr_weak: corr.weak, corr_who: [...corr.whoStrict],
      fetch_who: new Set(fetchVerified.map(r => r.recipient_email)).size,
      render_who: [...post.renderWho],
    });
  }

  const ranked = rankSends(rows);

  // second percentile: T3 render-verified PEOPLE — the tier the operator ruled counts.
  // Computed BEFORE the --json return (it used to sit after it, so --json consumers got
  // render_pctl: undefined — the emailed stats would have shipped a hole).
  const byRender = [...ranked].sort((a, b) => (a.render_who?.length ?? 0) - (b.render_who?.length ?? 0));
  for (const r of ranked) {
    const i = byRender.indexOf(r);
    r.render_pctl = ranked.length > 1 ? Math.round(100 * i / (ranked.length - 1)) : 100;
  }

  if (process.argv.includes('--json')) { console.log(JSON.stringify({ win_min: WIN, ranked }, null, 2)); return; }

  // --html <path>: the emailable section for report-run.sh (full doc; the stapler
  // extracts <body>). Same three-tier table the operator's stats email carries.
  const htmlOut = arg('--html', null);
  if (htmlOut) {
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const subj = (s) => esc(stripClubStem(s).slice(0, 44));
    // LINK THE SENDS THAT ARE PUBLIC (operator 2026-08-29: "ranking the sends with links to
    // the public ones so I know which and they can too"). A row links iff its edition page
    // exists — the ranking reaches back further than the publishable body store does, so a
    // blanket link would 404 for the older half. Which sends are public is itself the fact
    // the operator asked to see, so it is rendered rather than assumed.
    const pubDir = new URL('../../public/bookclub/editions/', import.meta.url);
    const cell = (r) => (existsSync(new URL(`${r.day}.html`, pubDir))
      ? `<a href="https://thetadriven.com/bookclub/editions/${r.day}.html" style="color:#2a5db0">${subj(r.subject)}</a> <span style="color:#1a7f37;font-size:11px">public</span>`
      : `${subj(r.subject)} <span style="color:#a89f8a;font-size:11px">not published</span>`);
    const latestRow = ranked.find(r => r.day === sends[sends.length - 1].day);
    const trs = ranked.slice(0, 10).map(r => `<tr style="border-bottom:1px solid #eee6d8${r === latestRow ? ';font-weight:700;color:#a8320d' : ''}">
      <td style="padding:6px 9px">${r.rank}</td><td style="padding:6px 9px;white-space:nowrap">${r.day}</td>
      <td style="padding:6px 9px;text-align:right">${r.uplift.toFixed(1)}×</td>
      <td style="padding:6px 9px;text-align:right;color:#8a8578">${r.clicks}</td>
      <td style="padding:6px 9px;text-align:right">${r.fetch_who}</td>
      <td style="padding:6px 9px;text-align:right;font-weight:700">${r.render_who.length}</td>
      <td style="padding:6px 9px;text-align:right">P${r.pctl}/P${r.render_pctl}</td>
      <td style="padding:6px 9px;color:#6b7280">${cell(r)}</td></tr>`).join('');
    writeFileSync(htmlOut, `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p style="font:13px/1.5 -apple-system,sans-serif;color:#4a463e;margin:0 0 8px">A click only counts when OUR site saw it. <b>T1</b> = Resend webhook click (machines mass-produce these) · <b>T2</b> = our middleware verified the signed ?t= (the site was hit) · <b>T3</b> = the page's JS ran in the reader's browser with their token (a person-shaped event). Window: first ${WIN}m after each send start, uniform.</p>
<table style="border-collapse:collapse;width:100%;font:12.5px/1.45 -apple-system,sans-serif;background:#fff;border:1px solid #eee6d8">
<tr style="background:#f3efe4;text-align:left"><th style="padding:6px 9px">#</th><th style="padding:6px 9px">send</th><th style="padding:6px 9px;text-align:right">uplift</th><th style="padding:6px 9px;text-align:right">T1</th><th style="padding:6px 9px;text-align:right">T2✓</th><th style="padding:6px 9px;text-align:right">T3✓</th><th style="padding:6px 9px;text-align:right">pctl u/r</th><th style="padding:6px 9px">subject</th></tr>${trs}</table>
<p style="font:11.5px/1.5 -apple-system,sans-serif;color:#8a8578;margin:8px 0 0">Latest: uplift ${latestRow.uplift.toFixed(1)}× (rank ${latestRow.rank}/${ranked.length}, P${latestRow.pctl}) · ${latestRow.render_who.length} render-verified readers (P${latestRow.render_pctl}). Recompute: node scripts/bookclub/traffic-uplift-rank.mjs --last ${LAST}</p>
</body></html>`);
    console.error(`→ ${htmlOut}`);
  }

  console.log(`site-visit uplift per send · window ±${WIN}m around each send`);
  console.log('tiers: T1 clicks (Resend webhook) · T2 fetch✓ (middleware verified ?t=) · T3 render✓ (page JS ran with the token)');
  console.log('rank  day         uplift   all pre→post   T1 clk  T2 fetch✓  T3 render✓  upliftP  renderP');
  for (const r of ranked) {
    console.log(
      `${String(r.rank).padStart(3)}   ${r.day}  ${r.uplift.toFixed(2).padStart(6)}   ` +
      `${String(r.all_pre).padStart(4)}→${String(r.all_post).padEnd(5)}  ` +
      `${String(r.clicks).padStart(5)}   ${String(r.fetch_who).padStart(5)}      ${String(r.render_who.length).padStart(4)}      ` +
      `P${String(r.pctl).padEnd(4)} P${String(r.render_pctl).padEnd(4)}` +
      stripClubStem(r.subject).slice(0, 40));
  }
  const latest = ranked.find(r => r.day === sends[sends.length - 1].day);
  console.log(`\nLATEST (${latest.day}): uplift ${latest.uplift.toFixed(2)} (rank ${latest.rank}/${ranked.length}, P${latest.pctl}) · render-verified people ${latest.render_who.length} (P${latest.render_pctl})`);
  console.log(`T3 RENDER-VERIFIED readers — their browser ran our page with their own signed token (the list that counts): ${latest.render_who.length ? latest.render_who.join(', ') : 'none yet'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
