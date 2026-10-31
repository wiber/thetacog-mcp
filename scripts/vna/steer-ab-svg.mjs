// scripts/vna/steer-ab-svg.mjs — C519 THE TWO TICK CHARTS, ONE RENDERER, NO DEPENDENCIES. Imported by the stats-page block
// (steer-ab-block.mjs) and by the transport's snapshot writer (steer-ab-tokens.mjs, C519 (b)) so a saved chart re-draws byte for
// byte from its saved json with the same bytes the page painted. Pure over the ticks; no fs.
//   way 'regular'  y = savings vs the PLAIN tick measured at the same complexity decile (the 11:3x amendment's chart 1)
//   way 'worst'    y = savings vs a full 1,000,000-token window on every call a PLAIN tick of that decile takes (chart 2)
// Every tick is one point, in time order; EVERY ROUTE its own mark — chat ticks ● (teal), headless-runner / `claude -p` ticks ◆
// (violet); a hollow mark where the decile's baseline rests on under 5 PLAIN ticks; a dashed ring where the tick is UNMEASURED
// (no PLAIN tick in its decile). The 99 % line is on both. Palette validated on the dark surface #0b1017 (teal #1f9f86 · violet
// #a56bff: CVD ΔE 21.9, contrast ≥ 3:1); an API-billed tick's exact cost rides in the hover beside the token savings.
import { ninesYAxis, ninesPolyline, ninesOf, PAYOFF_COLOR, BASE_COLOR, sparseChartNote, topShareLevel, topFifthMark, aboveLine99 } from './steer-ab-rules.mjs';
import { sufficiencyLine } from '../../src/lib/receipt-sufficiency.mjs';   // C868: the tooth graph prints the one sufficiency pair, both halves, Rice in the NOT half   // C562b: the named top fifth, its badge, the 99 % colour
export const COLOR = Object.freeze({ chair: '#1f9f86', runner: '#a56bff', surface: '#0b1017', dim: '#7b8794', fg: '#d8dee9', grid: '#1a2230' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(v >= 0.99 ? 2 : 1)} %`);
export const WAY_FIELD = Object.freeze({ regular: 'vs_plain', worst: 'vs_1m', steering: 'steering', rung1: 'rung1', rung2: 'rung2', rung3: 'rung3' });
const valueOf = (t, field) => (field === 'steering' ? (t.steering ? t.steering.savings : null) : /^rung/.test(field) ? (t.rungs && t.rungs[field] ? t.rungs[field].savings : null) : t[field]);
export const WAY_TITLE = Object.freeze({ rung1: 'RUNG 1 · SEVERE — the whole call against a 1M window', rung2: 'RUNG 2 · STEERING CONTEXT — carrying the spec against carrying the corpus', rung3: 'RUNG 3 · PREPARED RUN — a fully specified -p brief against a 1M window', steering: 'HEADLINE — steering-context savings: live hook payload per call vs the corpus it stands in for (capped at a 1M window)', regular: 'REGULAR — vs the PLAIN tick measured at the same complexity decile', worst: 'WORST CASE — vs a full 1,000,000-token window on every call a PLAIN tick of that decile takes' });

/** @param {object[]} ticks — tickSavings rows · @param {{line?:number,width?:number,way?:'regular'|'worst'}} o */
export function renderTicksSvg(ticks, { line = 0.99, width = 300, way = 'worst', band = null } = {}) {   // band: { low, high, label } — the operator's reference band on rung 3
  const field = WAY_FIELD[way] || WAY_FIELD.worst;
  const W = width, H = 110, PL = 30, PR = 6, PT = 6, PB = 18; const n = Math.max(ticks.length, 1); const bw = (W - PL - PR) / n;
  // C519b: un(t) — the same UNMEASURED test the marks loop below uses, lifted so the axis and the sparse note can read it first
  const unOf = (t) => { const v0 = valueOf(t, field); return field === 'steering' || /^rung/.test(field) ? v0 == null : (!t.measured || v0 == null); };
  const measuredVals = ticks.filter((t) => !unOf(t)).map((t) => valueOf(t, field)).filter(Number.isFinite);
  const axis = ninesYAxis(measuredVals);   // C526: the nines axis — 99 % mid-axis, 90 · 99 · 99.9 · 99.99 evenly spaced
  const Yf = (f) => PT + (H - PT - PB) * (1 - f / axis.span);   // C562b: the span leaves room above the highest point — nothing on the frame
  const Y = (v) => Yf(axis.frac(v));
  const X = (i) => PL + i * bw + bw / 2;
  // C526: the line chart — one polyline per measured stretch, broken at every UNMEASURED tick, payoff colour above 99 %
  const poly = ninesPolyline(ticks.map((t) => (unOf(t) ? null : valueOf(t, field))), { axis });   // C562b: split at the 99 % claim always, never the line argument
  const lineSvg = poly.pieces.filter((pc) => pc.points.length > 1).map((pc) => `<polyline class="seg seg-${pc.side}" points="${pc.points.map(([i, f]) => `${X(i).toFixed(1)},${Yf(f).toFixed(1)}`).join(' ')}" fill="none" stroke="${pc.color}" stroke-width="1.2"/>`).join('');
  const grid = axis.grid.map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${Y(f).toFixed(1)}" y2="${Y(f).toFixed(1)}" stroke="${COLOR.grid}"/><text x="${PL - 3}" y="${(Y(f) + 3).toFixed(1)}" text-anchor="end" fill="${COLOR.dim}" font-size="8">${axis.label(f)}</text>`).join('');
  const note = sparseChartNote(measuredVals.length, ticks.length, 'tick');
  const noteSvg = note ? `<text class="sparse-note" x="${(W / 2).toFixed(1)}" y="${(H / 2).toFixed(1)}" text-anchor="middle" fill="${COLOR.dim}" font-size="8">${esc(note)}</text>` : '';
  const ref = `<line class="line99" x1="${PL}" x2="${W - PR}" y1="${Y(line).toFixed(1)}" y2="${Y(line).toFixed(1)}" stroke="${COLOR.fg}" stroke-width="1"/><text x="${W - PR}" y="${(Y(line) - 2).toFixed(1)}" text-anchor="end" fill="${COLOR.fg}" font-size="8">${Math.round(line * 1000) / 10} %</text>`;
  const top = topFifthMark(measuredVals); const topLv = top.level; const topSvg = topLv == null ? '' : `<line class="top20" x1="${PL}" x2="${W - PR}" y1="${Y(topLv).toFixed(1)}" y2="${Y(topLv).toFixed(1)}" stroke="${COLOR.fg}" stroke-width="1" stroke-dasharray="3 2" opacity="0.7"/><text class="top20" x="${PL + 2}" y="${(Y(topLv) - 2).toFixed(1)}" fill="${COLOR.fg}" font-size="8">${esc(top.label)}</text>${top.badge ? `<text class="top20-badge" data-badge="top-fifth-over-99" x="${(PL + 70).toFixed(1)}" y="${(Y(topLv) - 2).toFixed(1)}" fill="${PAYOFF_COLOR}" font-size="8" font-weight="600">${esc(top.badge)}</text>` : ''}`;
  const bandSvg = band && Number.isFinite(band.low) && Number.isFinite(band.high) ? `<rect class="band" x="${PL}" y="${Y(band.high).toFixed(1)}" width="${W - PL - PR}" height="${Math.max(1, Y(band.low) - Y(band.high)).toFixed(1)}" fill="${COLOR.fg}" opacity="0.12"><title>${esc(band.label || '')}</title></rect>` : '';
  const r = Math.max(1.5, Math.min(3.5, bw / 2 - 0.5));
  const marks = ticks.map((t, i) => {
    const x = X(i), sha10 = String(t.sha || '').slice(0, 10); const route = t.route === 'runner' ? 'runner' : 'chair';
    const v0 = valueOf(t, field); const un = field === 'steering' || /^rung/.test(field) ? v0 == null : (!t.measured || v0 == null);
    if (un) return `<g class="tk un" data-sha="${sha10}" data-route="${route}"><circle cx="${x.toFixed(1)}" cy="${(H - PB - 3).toFixed(1)}" r="${r}" fill="none" stroke="${COLOR.dim}" stroke-dasharray="1 1"/><title>${esc(`${t.day || '—'} ${sha10} ${t.label}/${route} · UNMEASURED — ${(/^rung/.test(field) && t.rungs && t.rungs[field] && t.rungs[field].why) || t.why || 'no baseline'}`)}</title></g>`;
    const v = v0; const hollow = field === 'steering' || /^rung/.test(field) ? false : t.underpowered; const above = aboveLine99(v); const col = above ? PAYOFF_COLOR : BASE_COLOR; const y = Y(v); const ceil = axis.clamped(v) === 'ceiling' ? ` · exact ${axis.exact(v)}, drawn at the ${axis.label(axis.ceiling)} % ceiling` : '';
    const mark = route === 'runner'
      ? `<polygon class="mk${hollow ? ' hollow' : ''}${above ? ' above' : ''}" points="${x.toFixed(1)},${(y - r - 0.8).toFixed(1)} ${(x + r + 0.8).toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y + r + 0.8).toFixed(1)} ${(x - r - 0.8).toFixed(1)},${y.toFixed(1)}" fill="${hollow ? COLOR.surface : col}" stroke="${col}" stroke-width="${hollow ? 1.2 : 0}"/>`
      : `<circle class="mk${hollow ? ' hollow' : ''}${above ? ' above' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${hollow ? COLOR.surface : col}" stroke="${col}" stroke-width="${hollow ? 1.2 : 0}"/>`;
    const cost = t.cost ? ` · cost ${t.cost.exact ? 'exact (API) ' : `${t.cost.source}-reported `}$${Number(t.cost.usd).toFixed(4)}` : '';
    const cause = /^rung/.test(field) && t.rungs && t.rungs[field] && t.rungs[field].cause ? ` · DETECTED: ${t.rungs[field].cause}` : '';
    const r3x = field === 'rung3' && t.rungs && t.rungs.rung3 && t.rungs.rung3.new_per_call != null ? ` · ${Number(t.rungs.rung3.new_per_call).toLocaleString()} new tokens per call (measured; ${Number(t.rungs.rung3.cache_read_per_call || 0).toLocaleString()} cached re-read, not counted)${t.rungs.rung3.declared_ceiling ? ` · declared ceiling ${Number(t.rungs.rung3.declared_ceiling).toLocaleString()}` : ''}` : '';
    const title = /^rung/.test(field) ? `${t.day || '—'} ${sha10} · ${t.label}/${route} · ${t.calls} calls · ${WAY_TITLE[field]} · ${pct(v)}${ceil}${r3x}${cause}${cost}${above ? ' · CROSSED 99 %' : ''}` : field === 'steering' ? `${t.day || '—'} ${sha10} · ${t.label}/${route} · ${t.steering.calls} calls · steering context ${Number(t.steering.ours).toLocaleString()} tokens over the tick vs ${Number(t.steering.theirs_per_call).toLocaleString()} per call${t.steering.capped ? ' (capped)' : ''} · savings ${pct(v)}${ceil}${t.steering.resets_in_span ? ` · ${t.steering.resets_in_span} reset(s) in the span` : ''}${t.steering.next_is_reset ? ' · a /clear follows' : ''}${cost}${above ? ' · CROSSED 99 %' : ''}` : `${t.day || '—'} ${sha10} · ${t.label}/${route} · p${t.pct} · ${t.calls} calls · actual ${Number(t.actual).toLocaleString()} · ${way === 'worst' ? `EXPECTED ${Number(t.expected_1m).toLocaleString()} (1M × median PLAIN calls)` : `PLAIN median ${Number(t.plain_median_actual).toLocaleString()}`} · ${way === 'worst' ? 'vs 1M' : 'vs PLAIN'} ${pct(v)} (price-weighted ${pct(way === 'worst' ? t.vs_1m_weighted : t.ways && t.ways.tick_weighted_vs_plain)})${ceil}${cost}${hollow ? ' · baseline on under 5 PLAIN ticks' : ''}${above ? ' · CROSSED 99 %' : ''}`;
    return `<g class="tk${above ? ' above' : ''}" data-sha="${sha10}" data-route="${route}">${mark}<title>${esc(title)}</title></g>`;
  }).join('');
  const xl = ticks.length ? `<text x="${PL}" y="${H - 4}" fill="${COLOR.dim}" font-size="7">${esc(ticks[0].day || '')}</text><text x="${W - PR}" y="${H - 4}" text-anchor="end" fill="${COLOR.dim}" font-size="7">${esc(ticks[ticks.length - 1].day || '')}</text>` : '';
  return `<svg class="cogsvg svsvg" data-way="${way}" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="token savings per tick, ${way === 'worst' ? 'worst case against a 1M-context window' : 'regular against the PLAIN tick of the same decile'}, the 99 percent line"><title>${esc(WAY_TITLE[way] || WAY_TITLE.worst)} · every tick one point in time order · ● chat tick · ◆ headless-runner / claude -p tick · the series line breaks at every UNMEASURED tick · teal above 99 % (the payoff), violet below · hollow: baseline on under 5 PLAIN ticks · dashed ring: UNMEASURED · the line: 99 %</title>${grid}${bandSvg}${ref}${topSvg}${lineSvg}${marks}${xl}${noteSvg}</svg>`;
}

// ── C635g THE TOOTH GRAPH — the rung-2 series as a public picture (operator 2026-10-04: "it would even make more sense just to show
// the tooth graph on the left door"). The SAME series and the SAME colour rule as renderTicksSvg's 'rung2' way (rung2.savings per
// tick, teal at or above the 99 % claim, violet below, the line broken where there is no reading), drawn light for the iamfim.com
// paper ground, with a date axis and no hover jargon, small enough to commit (public/vna/tooth-graph.svg; data/ is untracked).
// What the shape means is read off the ladder's rung-2 formula, never asserted: savings = 1 − Σ (hook_additional_context tokens
// live at that call, SINCE THE LAST /clear OR COMPACTION) ÷ (calls × min(1M, corpus ÷ 4)). Inside a session the live payload only
// accumulates, so the line ramps DOWN; a /clear or compaction empties it, so the line JUMPS BACK. A tick with no payload served at
// all reads 0 on the formula and is flagged; it is drawn as a grey tick under the axis, never as a value on the line.
// Pure over the ticks, no fs. Writer: scripts/vna/steer-ab-tokens.mjs --tooth-graph. Guard: tests/vna/c635g-first-eyeshot-carries-the-install.test.mjs
export const TOOTH_GRAPH_GENERATOR = 'scripts/vna/steer-ab-tokens.mjs --tooth-graph';
export const TOOTH_PAPER = Object.freeze({ ground: '#faf8f2', ink: '#241f18', muted: '#6b6355', grid: '#d8d2c4', none: '#b9b2a4' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : ''; };

/** the rung-2 reading a page caption may quote, read off the receipt (never hand-typed) */
export function toothGraphReading(savings, { at = null } = {}) {
  const ticks = (savings && savings.ticks) || [];
  const vals = ticks.map((t) => (t.rungs && t.rungs.rung2 && Number.isFinite(t.rungs.rung2.savings) ? t.rungs.rung2.savings : null));
  const h = savings && savings.ladder && savings.ladder.health && savings.ladder.health.rung2;
  const rung = savings && savings.ladder && (savings.ladder.rungs || []).find((r) => r.id === 'rung2');
  return {
    generated_by: TOOTH_GRAPH_GENERATOR,
    receipt_at: (savings && savings.at) || at,
    n: h ? h.n : vals.filter((v) => v != null).length,
    crossed: h ? h.crossed : vals.filter((v) => v != null && aboveLine99(v)).length,
    top20: h ? h.top20 : null,
    none_served: vals.filter((v) => v != null && v <= 0).length,
    first_day: ticks.length ? ticks[0].day : null,
    last_day: ticks.length ? ticks[ticks.length - 1].day : null,
    formula: rung ? rung.formula : null,
  };
}

// C868: what the picture answers and what it does not, in the words of the one pair (src/lib/receipt-sufficiency.mjs); printed as
// <text> under the legend so the committed asset carries both halves. No jargon token (the C635g title rule reads these words too).
export const TOOTH_GRAPH_SUFFICIENT_FOR = 'the share of its spec each tick was handed, one point per tick in time order, recomputable from the committed receipt';
export const TOOTH_GRAPH_NOT_SUFFICIENT_FOR = 'what the tokens bought, or whether any tick\'s work was good, which is undecidable (Rice, 1953); nothing here claims it';
const SUFF_BAND = 28;   // user units under the legend for the two-line pair

/** @param {object[]} ticks tickSavings rows (t.rungs.rung2.savings) · @returns {string} a light, self-contained SVG */
export function renderToothGraphSvg(ticks, { width = 720, height = 230, floor = 0.8 } = {}) {
  const W = width, H = height, PL = 60, PR = 14, PT = 14, PB = 40, HT = H + SUFF_BAND;
  const suffText = sufficiencyLine({ sufficientFor: TOOTH_GRAPH_SUFFICIENT_FOR, notSufficientFor: TOOTH_GRAPH_NOT_SUFFICIENT_FOR });
  const cut = suffText.indexOf(' NOT sufficient for:');
  const suffSvg = `<text data-sufficiency="" x="${PL}" y="${(H + 10).toFixed(1)}" font-size="10">${esc(suffText.slice(0, cut))}<tspan x="${PL}" dy="13">${esc(suffText.slice(cut + 1))}</tspan></text>`;
  const vals = (ticks || []).map((t) => (t.rungs && t.rungs.rung2 && Number.isFinite(t.rungs.rung2.savings) ? t.rungs.rung2.savings : null));
  const lo = ninesOf(floor), hi = ninesOf(0.9999);
  const top = Math.max(hi, ...vals.filter((v) => v != null && v > 0 && v < 1).map(ninesOf)) * 1.04;   // headroom: no point on the frame
  const frac = (v) => (v == null ? 0 : v <= floor ? 0 : Math.min(1, (Math.min(ninesOf(v), top) - lo) / (top - lo)));
  const n = Math.max(vals.length, 1); const X = (i) => PL + ((W - PL - PR) * (i + 0.5)) / n; const Yf = (f) => PT + (H - PT - PB) * (1 - f);
  const onLine = vals.map((v) => (v == null || v <= 0 ? null : v));
  const { pieces } = ninesPolyline(onLine, { axis: { frac } });
  const path = (pts) => pts.map(([i, f], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)} ${Yf(f).toFixed(1)}`).join('');
  const lines = ['above', 'below'].map((side) => {
    const d = pieces.filter((p) => p.side === side && p.points.length > 1).map((p) => path(p.points)).join('');
    return d ? `<path d="${d}" fill="none" stroke="${side === 'above' ? PAYOFF_COLOR : BASE_COLOR}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  }).join('');
  const grid = [0.9, 0.99, 0.999, 0.9999].map((g) => { const y = Yf(frac(g)).toFixed(1); const main = g === 0.99;
    return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="${main ? TOOTH_PAPER.ink : TOOTH_PAPER.grid}" stroke-width="${main ? 1.2 : 1}"${main ? ' stroke-dasharray="5 3"' : ''}/><text x="${PL - 6}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end">${Number((g * 100).toFixed(2))} %</text>`; }).join('');
  const none = vals.map((v, i) => (v != null && v <= 0 ? `M${X(i).toFixed(1)} ${(H - PB + 3).toFixed(1)}v6` : '')).join('');
  const noneSvg = none ? `<path d="${none}" stroke="${TOOTH_PAPER.none}" stroke-width="1.2"/>` : '';
  const K = Math.min(6, vals.length); const idx = K > 1 ? [...new Set(Array.from({ length: K }, (_, k) => Math.round((k * (vals.length - 1)) / (K - 1))))] : [];
  const dates = idx.map((i, k) => `<text x="${X(i).toFixed(1)}" y="${(H - PB + 22).toFixed(1)}" text-anchor="${k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle'}">${esc(dayLabel(ticks[i].day))}</text>`).join('');
  const legend = `<text x="${W - PR}" y="${(H - 4).toFixed(1)}" text-anchor="end"><tspan fill="${PAYOFF_COLOR}">&#9644; at or above 99 %</tspan>  <tspan fill="${BASE_COLOR}">&#9644; below</tspan>  <tspan fill="${TOOTH_PAPER.none}">| nothing served</tspan></text><text x="${PL}" y="${(H - 4).toFixed(1)}">one point per tick, in time order</text>`;
  const first = ticks && ticks.length ? ticks[0].day : '', last = ticks && ticks.length ? ticks[ticks.length - 1].day : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HT}" width="${W}" height="${HT}" role="img" aria-labelledby="tg-t" data-generated-by="${esc(TOOTH_GRAPH_GENERATOR)}" data-series="rung2" data-ticks="${vals.length}" data-first-day="${esc(first)}" data-last-day="${esc(last)}"><title id="tg-t">The steering the agent is handed, per tick, as a share saved against the spec it steers by: it ramps down while a session runs and jumps back at each reset</title><rect width="${W}" height="${HT}" fill="${TOOTH_PAPER.ground}"/><g font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" fill="${TOOTH_PAPER.muted}">${grid}${dates}${legend}${suffSvg}</g>${lines}${noneSvg}</svg>\n`;
}
