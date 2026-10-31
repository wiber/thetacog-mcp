// scripts/vna/steer-ab-block.mjs — C510c THE DEPLOYER'S PAYOFF VIEW: STEER vs PLAIN TOKENS PER UNIT, BY COMPLEXITY DECILE, ON THE
// STATS PAGE (operator 2026-10-01: "logg the token savings properly - in the vsx, especially with the tokens per cog - percentile
// complexity etc.. we need to graph that as a payoff for the deployer when they open the stats page").
//
// Painted under ⚙️ Tokens per cog (steer-ui.mjs cogBody), after COMPLEXITY PER HUMAN %. It READS ONE RECEIPT —
// data/vna/steer-ab-tokens.json, written by scripts/vna/steer-ab-tokens.mjs (C510) from the append-only ndjson — and never
// computes over the transcripts (a page paint is 28 s already; the reading is 31 s over 1.9 GB and belongs to its own run).
// Every number on the block is a field of that receipt; an absent receipt prints UNMEASURED with its why and the command, never
// a digit. The block REPORTS: two medians per decile with both n, hollow and UNDERPOWERED under n 5 on either line, a
// difference only where both lines are powered, never the word "saves" — the deployer runs the check themselves.
// Pure over the reading; the one reader is readSteerAb(). No model. Rust port row: none — this composes one receipt into HTML.
// @guard tests/vna/c510c-stats-page-reads-the-token-receipt.test.mjs
import { readFileSync } from 'node:fs';
import { JSON_OUT, SAVINGS_JSON } from './steer-ab-tokens.mjs';

export const STEER_AB_CMD = 'node scripts/vna/steer-ab-tokens.mjs';
export const CHECK_CMD = 'node scripts/vna/steer-ab-tokens.mjs --unit <sha>';
const COLOR = { steer: '#1f9f86', plain: '#a56bff', surface: '#0b1017', dim: '#7b8794', fg: '#d8dee9', grid: '#1a2230' };   // validated on the dark surface (dataviz: CVD ΔE 21.9, contrast ≥ 3:1)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => { if (n == null || !Number.isFinite(n)) return '—'; const s = n < 0 ? '-' : '', a = Math.abs(n); return s + (a >= 1e6 ? `${(a / 1e6).toFixed(2)} M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)} k` : String(Math.round(a))); };   // sign kept, magnitude scaled

/** the receipt, or { missing: true, why } — never a typed shape */
export function readSteerAb(path = JSON_OUT) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return j && Array.isArray(j.deciles) && j.deciles.length === 10 ? j : { missing: true, why: 'the receipt carries no deciles' }; }
  catch (e) { return { missing: true, why: e.code === 'ENOENT' ? 'no receipt yet' : String(e.message || e).slice(0, 60) }; }
}

/** the compact chart: x = decile, y = median tokens per unit; a solid dot where both lines are powered, hollow (surface fill) where not; n per point */
export function renderSteerAbSvg(R) {
  const W = 300, H = 96, PL = 30, PR = 8, PT = 8, PB = 22; const cells = R.deciles;
  const vals = cells.flatMap((c) => [c.steer.median, c.plain.median]).filter((v) => v != null); const yMax = vals.length ? Math.max(...vals) * 1.1 : 1;
  const X = (d) => PL + (d + 0.5) * ((W - PL - PR) / 10); const Y = (v) => PT + (H - PT - PB) * (1 - v / yMax);
  const series = (key) => {
    const pts = cells.filter((c) => c[key].median != null); const solid = pts.filter((c) => !c.underpowered);
    const line = solid.length > 1 ? `<polyline fill="none" stroke="${COLOR[key]}" stroke-width="2" stroke-linejoin="round" points="${solid.map((c) => `${X(c.decile).toFixed(1)},${Y(c[key].median).toFixed(1)}`).join(' ')}"/>` : '';
    return line + pts.map((c) => `<g class="abpt ${key}${c.underpowered ? ' hollow' : ''}"><circle cx="${X(c.decile).toFixed(1)}" cy="${Y(c[key].median).toFixed(1)}" r="5.5" fill="${COLOR.surface}"/><circle cx="${X(c.decile).toFixed(1)}" cy="${Y(c[key].median).toFixed(1)}" r="4" fill="${c.underpowered ? COLOR.surface : COLOR[key]}" stroke="${COLOR[key]}" stroke-width="${c.underpowered ? 1.5 : 0}"/><title>${key.toUpperCase()} · ${esc(c.range)} · median ${fmt(c[key].median)} tokens · n ${c[key].n}${c.underpowered ? ' · UNDERPOWERED (n under 5 on a line)' : ''}</title></g>`).join('');
  };
  const grid = [0.5, 1].map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${Y(f * yMax).toFixed(1)}" y2="${Y(f * yMax).toFixed(1)}" stroke="${COLOR.grid}" stroke-width="1"/><text x="${PL - 3}" y="${(Y(f * yMax) + 3).toFixed(1)}" text-anchor="end" fill="${COLOR.dim}" font-size="8">${fmt(f * yMax)}</text>`).join('');
  const nl = cells.map((c) => `<text x="${X(c.decile).toFixed(1)}" y="${H - PB + 10}" text-anchor="middle" fill="${c.underpowered ? COLOR.dim : COLOR.fg}" font-size="7">${c.steer.n}/${c.plain.n}</text><text x="${X(c.decile).toFixed(1)}" y="${H - 3}" text-anchor="middle" fill="${COLOR.dim}" font-size="7">p${c.decile * 10}</text>`).join('');
  return `<svg class="cogsvg absvg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="median tokens per unit by complexity decile, STEER versus PLAIN"><title>x: complexity decile over all units · y: median total tokens per unit · under each point n as STEER/PLAIN · a hollow point is UNDERPOWERED (n under 5 on a line) · teal STEER, violet PLAIN</title>${grid}<line x1="${PL}" x2="${W - PR}" y1="${H - PB}" y2="${H - PB}" stroke="#2a3442"/>${series('plain')}${series('steer')}${nl}</svg>`;
}

/** the block: header · chart · the powered differences (or why none) · the check. Pure over the reading. */
export function renderSteerAbBlock(R) {
  const head = `<span class="rk" title="C510 — a unit is a prompt → the commit git answered to that session ([main <sha>] in a tool_result), or a headless-runner verdict row; complexity from the commit alone (files, lines, dirs, the walk's off-lane share), ranked over all units; the record is append-only (data/vna/steer-ab-tokens.ndjson), this block reads the derived receipt only">STEER vs PLAIN · TOKENS PER UNIT BY COMPLEXITY</span>`;
  if (!R || R.missing) return `<div class="c3h c3t">${head}</div><span class="c3l dim"><span class="lane un">⚪ UNMEASURED</span> — ${esc((R && R.why) || 'no reading')} · not run — <code>${esc(STEER_AB_CMD)}</code></span>`;
  const n = R.n || {}; const powered = R.deciles.filter((c) => !c.underpowered);
  const count = `<span class="c3l dim" title="${esc((R.confounds || []).join('\n'))}">${n.units ?? 0} units on the record · STEER ${n.steer ?? 0} (${n.steer_chair ?? '—'} in chat · ${n.steer_runner ?? '—'} by the headless runner) · PLAIN ${n.plain ?? 0} · ${R.open_spans ? `${R.open_spans.spans} open span${R.open_spans.spans === 1 ? '' : 's'} not charted` : 'open spans uncounted'} · read ${esc(String(R.at || '').slice(0, 16))}</span>`;
  const diff = powered.length
    ? `<span class="c3l" title="a difference is printed only where both lines have five or more units in the decile; it is a difference of medians, within one complexity class, and it is not summed across deciles">${powered.map((c) => `<span class="tr"><span class="rk">${esc(c.range)}:</span> STEER ${fmt(c.steer.median)} (n ${c.steer.n}) · PLAIN ${fmt(c.plain.median)} (n ${c.plain.n}) · STEER − PLAIN ${c.difference > 0 ? '+' : ''}${fmt(c.difference)}</span>`).join('')}</span>`
    : `<span class="c3l dim">no decile has five units on both lines yet — every point is hollow, no difference is printed; the lines fill as /steer closes commits</span>`;
  const check = `<span class="c3l dim">You don't have to take my word for it: <code>${esc(CHECK_CMD)}</code> prints the usage rows behind any point, and <code>${esc(STEER_AB_CMD)}</code> re-reads the record. Confounds in the hover; the full page is <code>docs/specs/vna/steer-ab-tokens.html</code>.</span>`;
  return `<div class="c3h c3t">${head}</div>${count}${renderSteerAbSvg(R)}${diff}${check}`;
}

// ── C519 THE % SAVINGS BLOCK — PER TICK, TWO CHARTS (REGULAR vs PLAIN · WORST CASE vs 1M), EVERY WAY TO COMPUTE IT, THE 99 % LINE ──
// The LOCAL view: free (MIT), never capped — every tick on the record is a point in both charts, read off data/vna/token-savings.json
// (derived whole by the C510 transport from the per-tick record), never computed here. A day or a week appears ONLY as how many ticks
// crossed in it. EVERY WAY TO COMPUTE IT is a table, one row per way with its formula and its crossing count (never one number for
// the others); an API-billed `claude -p` tick shows the EXACT cost_usd the API returned beside its token savings, a worker-reported
// figure is labelled by its source, a chat tick reads no billed cost. Every tick above the line carries ONE action, "open this in the
// third-party viz": licensed → /backup/adherence at that tick (the upload door when nothing is backed up yet); unlicensed → the
// licence door. It sends nothing. The PAID view is the complete chart on that page, drawn from the backed-up series. The charts
// themselves come from steer-ab-svg.mjs — the same renderer the transport snapshots on every render (C519 (b)).
import { renderTicksSvg, COLOR as TICK_COLOR, WAY_TITLE } from './steer-ab-svg.mjs';
export { renderTicksSvg };
export const VIZ_DOOR = 'vna.openThirdPartyViz', UPLOAD_DOOR = 'vna.backupTape', LICENCE_DOOR = 'vna.notariseTape';
export const VIZ_URL = 'https://thetadriven.com/backup/adherence';
export function readTokenSavings(path = SAVINGS_JSON) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return j && Array.isArray(j.ticks) && j.crossings ? j : { missing: true, why: 'the receipt carries no ticks' }; }
  catch (e) { return { missing: true, why: e.code === 'ENOENT' ? 'no receipt yet' : String(e.message || e).slice(0, 60) }; }
}
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(v >= 0.99 ? 2 : 1)} %`);
const usd = (v) => `$${Number(v).toFixed(4)}`;
/** the action on a crossing tick: licensed → the viz at that tick (or the upload door when nothing is backed up yet); unlicensed → the licence door */
export function tickAction(tick, { licensed = false, manifest = null } = {}) {
  const sha10 = String(tick.sha || '').slice(0, 10);
  if (!licensed) return { door: LICENCE_DOOR, arg: null, label: 'open this in the third-party viz — needs a licence', onclick: `go('${LICENCE_DOOR}')` };
  if (!manifest) return { door: UPLOAD_DOOR, arg: null, label: 'open this in the third-party viz — back up the tapes first', onclick: `go('${UPLOAD_DOOR}')` };
  const url = `${VIZ_URL}?manifest=${manifest}#tick-${sha10}`;
  return { door: VIZ_DOOR, arg: url, label: 'open this in the third-party viz', onclick: `go('${VIZ_DOOR}','${url}')` };
}
/** C519 (a): EVERY WAY, side by side — one row per way: its label, its formula, how many ticks cross 99 % under it (or the exact-cost count) */
export function renderComputations(S) {
  const rows = (S.computations || []).map((w) => {
    const val = w.unit === 'usd' ? `${S.n.api_billed ?? 0} API-billed tick${(S.n.api_billed ?? 0) === 1 ? '' : 's'} with an exact cost · ${(S.n.costed ?? 0) - (S.n.api_billed ?? 0)} with a worker-reported cost` : `${(S.crossings_by_way || {})[w.id] ?? '—'} of ${S.crossings.n} cross 99 %`;
    return `<span class="tr" data-way="${w.id}" title="${esc(w.formula)}"><span class="rk">${esc(w.label)}:</span> ${esc(val)} <span class="dim">· ${esc(w.formula)}</span></span>`;
  }).join('');
  return `<span class="c3l cogtable ways" title="every way to compute it, each with its formula — never one number standing in for the others"><span class="rk">EVERY WAY TO COMPUTE IT</span>${rows}</span>`;
}
/** the block: the crossings headline, the two charts, every way, which ticks crossed (each with its exact cost and its one action), crossings per day / per week, the prediction with its falsifier, the formulas, the split, what it is NOT sufficient for. Never gated: the data is free. */
export function renderSavingsBlock(S, { licensed = false, manifest = null } = {}) {
  const head = `<span class="rk" title="C519 — % token savings per tick: 1 − actual ÷ baseline, two charts drawn apart — REGULAR (vs the PLAIN tick measured at the same complexity decile) and WORST CASE (vs a 1M-context window on every call); every way to compute it in the table; the record is data/vna/steer-ab-tokens.ndjson (per tick) + data/vna/token-savings-daily.ndjson (crossings per day), append-only; every render is saved under data/vna/token-savings-charts/">% TOKEN SAVINGS PER TICK · REGULAR vs PLAIN (measured) · WORST CASE vs 1M CONTEXT (counterfactual)</span>`;
  if (!S || S.missing) return `<div class="c3h c3t">${head}</div><span class="c3l dim"><span class="lane un">⚪ UNMEASURED</span> — ${esc((S && S.why) || 'no reading')} · not run — <code>${esc(STEER_AB_CMD)}</code></span>`;
  const c = S.crossings; const n = S.n || {}; const byWay = S.crossings_by_way || {};
  const headline = `<span class="c3l"><b>${c.above} of ${c.n} ticks crossed 99 %</b> on the worst case (${n.above_99_steer ?? 0} of them /steer · ${c.unmeasured} tick${c.unmeasured === 1 ? '' : 's'} UNMEASURED, no PLAIN tick in their decile) · <b>${byWay.tick_raw_vs_plain ?? n.above_99_plain_baseline ?? 0}</b> crossed 99 % on the regular chart · ${n.ticks} ticks (${n.steer} STEER · ${n.plain} PLAIN · ${n.runner ?? 0} by the headless runner) · ${n.api_billed ?? 0} API-billed tick${(n.api_billed ?? 0) === 1 ? '' : 's'} with an exact cost · read ${esc(String(S.at || '').slice(0, 16))}</span>`;
  const legend = `<span class="c3l dim"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${TICK_COLOR.chair};vertical-align:middle"></span> chat tick &nbsp; <span style="display:inline-block;width:8px;height:8px;transform:rotate(45deg);background:${TICK_COLOR.runner};vertical-align:middle"></span> headless-runner / claude -p tick &nbsp; hollow = baseline on under 5 PLAIN ticks &nbsp; dashed = UNMEASURED &nbsp; line = 99 %</span>`;
  const chart = (way) => `<span class="c3l dim" data-way-chart="${way}"><b>${esc(WAY_TITLE[way])}</b></span>${renderTicksSvg(S.ticks, { line: S.line, way })}`;
  const H = S.headline; const hlLine = H ? `<span class="c3l"><b>HEADLINE · ${H.crossed} of ${H.n} ticks crossed 99 %</b> on steering-context savings (${H.unmeasured} UNMEASURED) · ${esc(H.cap_note)} · <b>the dip:</b> ${esc(H.dip.reading)}${H.dip.before_reset_median != null ? ` (median ${pct(H.dip.before_reset_median)} on the ${H.dip.n_before_reset} ticks right before a /clear vs ${pct(H.dip.other_median)} on the other ${H.dip.n_other})` : ''} · <b>confound:</b> ${esc(H.confound)}</span>` : '';
  const costOf = (w) => { const t = S.ticks.find((x) => x.sha === w.sha); if (!t || !t.cost) return 'cost UNMEASURED (no billed cost on a chat tick)'; return t.cost.exact ? `cost ${usd(t.cost.usd)} exact (API)` : `cost ${usd(t.cost.usd)} ${esc(t.cost.source)}-reported, not exact`; };
  const which = c.which.length
    ? `<span class="c3l" title="every tick above the line on the worst case, with its exact cost where the API returned one, and its one action — it sends nothing; a share is the holder's act">${c.which.map((w) => { const act = tickAction(w, { licensed, manifest }); return `<span class="tr crossed" data-sha="${esc(String(w.sha).slice(0, 10))}"><span class="rk">${esc(w.day || '—')}</span> ${esc(String(w.sha).slice(0, 10))} · p${w.pct} · ${esc(w.label)}/${esc(w.route)} · ${pct(w.vs_1m)} · ${costOf(w)} <button class="sb viz tick-action" data-door="${act.door}" onclick="${act.onclick}" title="${esc(`${act.label} — licensed: the viz draws the complete chart from your backed-up series at this tick; it sends nothing`)}">🔭 ${esc(act.label)}</button></span>`; }).join('')}</span>`
    : `<span class="c3l dim">no tick has crossed the line yet — the chart draws what is there</span>`;
  const byDay = S.per_day.slice(-14).map((d) => `${esc(d.period)}: ${d.crossed_1m} of ${d.ticks}`).join(' · ');
  const byWeek = S.per_week.slice(-8).map((w) => `${esc(w.period)}: ${w.crossed_1m} of ${w.ticks}`).join(' · ');
  const periods = `<span class="c3l dim" title="how often a crossing happens — counts of ticks that crossed the worst-case line, never an averaged savings figure; zero is printed as zero"><b>crossings per day:</b> ${byDay || '—'}</span><span class="c3l dim"><b>per week:</b> ${byWeek || '—'}</span>`;
  const pr = S.prediction ? `<span class="c3l dim"><b>PREDICTION (not a promise):</b> ${esc(S.prediction.stated)}. <b>Today:</b> ${S.prediction.met_today ? 'MET on at least one day' : 'NOT YET MET'}. <b>Break it:</b> ${esc(S.prediction.falsifier)}. <b>The lever:</b> ${esc(S.prediction.lever)}.</span>` : '';
  const formulas = `<span class="c3l dim"><b>EXPECTED, the 1M counterfactual:</b> ${esc(S.expected_formula)}</span><span class="c3l dim"><b>WORST CASE baseline:</b> ${esc(S.baselines.counterfactual_1m)}</span><span class="c3l dim"><b>REGULAR baseline:</b> ${esc(S.baselines.plain)}</span><span class="c3l dim"><b>savings:</b> ${esc(S.savings_formula)}</span>`;
  const split = `<span class="c3l dim"><b>LOCAL (free):</b> this whole series, uncapped — <code>data/vna/steer-ab-tokens.ndjson</code> for any report the local AI writes; every render saved under <code>data/vna/token-savings-charts/</code>. <b>PAID:</b> the complete chart on the third-party viz, drawn from your backed-up series (<code>node scripts/vna/backup.mjs --upload --tapes</code> carries it).</span>`;
  const notFor = `<span class="c3l dim">Not sufficient for: ${(S.not_sufficient_for || []).map(esc).join(' · ')}. You don't have to take my word for it: <code>${esc(S.check || STEER_AB_CMD)}</code>.</span>`;
  const byDayH = H ? `<span class="c3l dim"><b>headline crossings per day:</b> ${S.per_day.slice(-14).map((d) => `${esc(d.period)}: ${d.crossed_steering || 0} of ${d.ticks}`).join(' · ') || '—'}</span>` : '';
  const LD = S.ladder; const rung = (rr) => `<span class="c3l" data-way-chart="${rr.id}"><b>${esc(rr.label)}</b> — ${esc(rr.question)} (${esc(rr.who)}) <span class="dim">· ${esc(rr.formula)}</span></span>${renderTicksSvg(S.ticks, { line: rr.line ?? S.line, way: rr.id, band: rr.id === 'rung3' && LD.prior ? { low: LD.prior.ratio_low, high: LD.prior.ratio_high, label: `the operator's reference band: ${LD.prior.text} (${pct(LD.prior.ratio_low)}–${pct(LD.prior.ratio_high)})` } : null })}`;
  const ladder = LD ? `<span class="c3l"><b>THE LADDER:</b> ${esc(LD.note)}</span>${LD.rungs.map(rung).join('')}` : '';
  const health = LD ? `<span class="c3l"><b>configuration health:</b> rung 2 ${LD.health.rung2.crossed} of ${LD.health.rung2.n} ticks above 99 % (${LD.health.rung2.rate == null ? 'UNMEASURED' : pct(LD.health.rung2.rate)}) · rung 3 ${LD.health.rung3.crossed} of ${LD.health.rung3.n} (${LD.health.rung3.rate == null ? 'UNMEASURED — no prepared -p tick on the record' : pct(LD.health.rung3.rate)}) · rung 1 ${LD.health.rung1.crossed} of ${LD.health.rung1.n} — 99 % on rung 1 is news when it happens · where each rung stands against the 99 % claim: rung 1 ${LD.health.rung1.top20_note} · rung 2 ${LD.health.rung2.top20_note} · rung 3 ${LD.health.rung3.top20_note} · rung 3 counts the tokens each call newly added, measured off the verdict row; the brief's declared ceiling${(() => { const c = S.ticks.map((t) => t.rungs && t.rungs.rung3 && t.rungs.rung3.declared_ceiling).filter(Boolean); return c.length ? ` (${[...new Set(c)].map((x) => Number(x).toLocaleString()).join(' / ')} tokens on the record)` : ''; })()} is a knob, never the reading · per day: ${S.per_day.slice(-10).map((d) => `${esc(d.period)} r2 ${d.health_r2.crossed}/${d.health_r2.n}${d.health_r3.n ? ` r3 ${d.health_r3.crossed}/${d.health_r3.n}` : ''}`).join(' · ')}</span>${LD.health.flagged.length ? `<span class="c3l dim" title="a tick below 99 % on rung 2 or 3 is detected with its likely cause — never a gate"><b>detected (${LD.health.flagged.length}):</b> ${LD.health.flagged.slice(-12).map((f) => `${esc(f.day || '—')} ${esc(String(f.sha).slice(0, 10))} ${f.rung} ${pct(f.savings)} — ${esc(f.cause)}`).join(' · ')}</span>` : `<span class="c3l dim">nothing detected below the line on rungs 2 and 3</span>`}<span class="c3l dim"><b>the operator\'s prior for rung 3:</b> ${esc(LD.prior.text)} (${pct(LD.prior.ratio_low)}–${pct(LD.prior.ratio_high)}) — ${esc(LD.prior.source)}</span>` : '';
  return `<div class="c3h c3t">${head}</div>${ladder}${health}${hlLine}${byDayH}${headline}${headlineWorst()}${legend}${chart('regular')}${chart('worst')}${renderComputations(S)}${which}${periods}${pr}${formulas}${split}${notFor}`;
  function headlineWorst() { return `<span class="c3l dim">the two charts below are shown beside the headline, never the headline: whole context per call vs a 1M window crosses for no tick; fresh tokens per call crosses for PLAIN ticks too</span>`; }
}
