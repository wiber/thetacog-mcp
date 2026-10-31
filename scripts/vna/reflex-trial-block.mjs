// scripts/vna/reflex-trial-block.mjs — C637 THE REFLEX TRIAL GRAPH: TWO LINE CHARTS SIDE BY SIDE UNDER 📈 OPTIMISATION TARGETS
// (operator 2026-10-04, verbatim in the row: "run the test and add a graph to the left panel … the whole point is to show the
// with and without reflex on a measure that makes the most possible sense, ideally you could line graphs both of them side by
// side"). THE GRAPH HALF ONLY — the trial harness (scripts/vna/reflex-trial.mjs, built in a parallel room) runs the paired
// trial and writes the one receipt this file reads, data/vna/reflex-trial.json. This file never runs a trial, never touches
// a transcript, never spawns a worker — it composes two charts out of that one reading.
//
// What is a pure function of the reading (allowed here, never a second harness): the CUMULATIVE landed rate by pair order
// and its cumulative Wilson 95 % band, and the CUMULATIVE mean out-of-scope-writes by pair order — both folds over the
// reading's own `series`, computed once per render, never cached, never re-derived from anything the reading did not already
// carry (landed/outside_writes per trial, per arm). Everything else — n, the paired-gap stats, the manipulation rate — is
// printed exactly as the receipt states it, never recomputed.
//
// THE BAR (the row's own, C637): below n_pairs 20 every line draws HOLLOW/dashed and the block prints
// "UNMEASURED — n <k> of 20 pairs", no p-value printed as a finding — just n. An absent or malformed receipt prints
// UNMEASURED with the recompute command, never a digit. Never "saves" / "prevents" / "blocks" — this is a reading, not a
// guarantee of what the reflex does.
//
// Colours and the broken-line idiom are the house ones (steer-ab-rules.mjs: PAYOFF_COLOR/BASE_COLOR) — ON (the reflex live)
// takes PAYOFF_COLOR, OFF takes BASE_COLOR; a missing point breaks the line rather than being interpolated, the same rule
// every ninesPolyline-based chart on this page already uses. No new palette, no new broken-line mechanic.
//
// Pure over the reading; no fs beyond the one read, no model, no compute over a transcript. Rust port row: none — this
// composes one small receipt into two SVGs; it holds no mass.
// @guard tests/vna/c637-the-reflex-trial-graph.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYOFF_COLOR, BASE_COLOR } from './steer-ab-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REFLEX_TRIAL_CMD = 'node scripts/vna/reflex-trial.mjs --report';
export const RECEIPT_PATH = 'data/vna/reflex-trial.json';
export const BAR = 20;   // C637's own bar: UNMEASURED with n until 20 pairs have both arms
const DEFAULT_JSON = process.env.VNA_REFLEX_TRIAL_JSON || resolve(process.env.VNA_REPO || resolve(HERE, '..', '..'), RECEIPT_PATH);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)} %`);
const fmtNum = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const fmtP = (v) => (v == null || !Number.isFinite(v) ? '—' : v < 0.001 ? '<0.001' : v.toFixed(3));
const Z95 = 1.959963985;

/** the receipt, or { missing: true, why } — never a typed shape */
export function readReflexTrial(path = DEFAULT_JSON) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j && Array.isArray(j.series) ? j : { missing: true, why: 'the receipt carries no series' };
  } catch (e) { return { missing: true, why: e.code === 'ENOENT' ? 'no receipt yet' : String(e.message || e).slice(0, 60) }; }
}

/** the Wilson 95 % score interval for x of n — pure, no fs; [null, null] at n 0 */
export function wilson(x, n, z = Z95) {
  if (!n) return [null, null];
  const p = x / n, z2 = z * z, denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (center - half) / denom), Math.min(1, (center + half) / denom)];
}

/** cumulative landed rate by pair order for one arm ('on' | 'off'), each point its own Wilson band — a pure fold over the series */
export function cumulativeLanded(series, arm) {
  let x = 0;
  return series.map((row, i) => {
    const n = i + 1; const a = (row && row[arm]) || {};
    if (a.landed) x += 1;
    const [lo, hi] = wilson(x, n);
    return { order_index: row && row.order_index != null ? row.order_index : n, n, x, rate: x / n, lo, hi };
  });
}

/** cumulative mean out-of-scope writes by pair order for one arm — a pure fold over the series */
export function cumulativeOutside(series, arm) {
  let sum = 0;
  return series.map((row, i) => {
    const n = i + 1; const a = (row && row[arm]) || {};
    sum += Number(a.outside_writes) || 0;
    return { order_index: row && row.order_index != null ? row.order_index : n, n, mean: sum / n };
  });
}

const valueOf = (p, mode) => (mode === 'rate' ? p.rate : p.mean);

/** one line+band chart over two cumulative series (ON, OFF) — pure, no fs. mode 'rate' draws the Wilson band; 'mean' does not. */
function renderChart({ onPts, offPts, mode, yMax, dashed, title, ariaLabel }) {
  const W = 300, H = 150, PL = 32, PR = 8, PT = 10, PB = 22;
  const n = Math.max(onPts.length, offPts.length, 1);
  const X = (i) => (n <= 1 ? (PL + (W - PR)) / 2 : PL + i * ((W - PL - PR) / (n - 1)));
  const top = yMax > 0 ? yMax : 1;
  const Y = (v) => PT + (H - PT - PB) * (1 - Math.max(0, Math.min(1, v / top)));
  const gridLine = (f) => `<line x1="${PL}" x2="${W - PR}" y1="${Y(f).toFixed(1)}" y2="${Y(f).toFixed(1)}" stroke="#1a2230" stroke-width="1"/><text x="${PL - 3}" y="${(Y(f) + 3).toFixed(1)}" text-anchor="end" fill="#7b8794" font-size="8">${mode === 'rate' ? `${Math.round((f / top) * 100)}%` : f.toFixed(1)}</text>`;
  const grid = [0, top / 2, top].map(gridLine).join('');
  const seriesSvg = (pts, color, side) => {
    if (!pts.length) return '';
    const bandSvg = mode === 'rate' && pts.every((p) => p.lo != null && p.hi != null)
      ? (() => { const hiPts = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.hi).toFixed(1)}`); const loPts = pts.slice().reverse().map((p, i) => `${X(pts.length - 1 - i).toFixed(1)},${Y(p.lo).toFixed(1)}`); return `<polygon class="wilson-band ${side}" points="${hiPts.join(' ')} ${loPts.join(' ')}" fill="${color}" opacity="0.12"/>`; })()
      : '';
    const dash = dashed ? ' stroke-dasharray="4 3"' : '';
    // the broken-line idiom (steer-ab-svg.mjs/ninesPolyline): the series breaks at a null point rather than interpolating over it
    const segs = []; let cur = null;
    pts.forEach((p, i) => { const v = valueOf(p, mode); if (v == null || !Number.isFinite(v)) { cur = null; return; } if (!cur) { cur = []; segs.push(cur); } cur.push([i, v]); });
    const line = segs.filter((seg) => seg.length > 1).map((seg) => `<polyline class="seg ${side}" fill="none" stroke="${color}" stroke-width="1.6"${dash} points="${seg.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`).join('');
    const dots = pts.map((p, i) => { const v = valueOf(p, mode); if (v == null || !Number.isFinite(v)) return ''; const hoverVal = mode === 'rate' ? pct(v) : v.toFixed(2); return `<circle class="mk ${side}${dashed ? ' hollow' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${dashed ? 2.6 : 2.2}" fill="${dashed ? '#0b1017' : color}" stroke="${color}" stroke-width="${dashed ? 1.3 : 0}"><title>${esc(`pair ${p.order_index} (n ${p.n}) · ${hoverVal}`)}</title></circle>`; }).join('');
    return bandSvg + line + dots;
  };
  return `<svg class="cogsvg reflexsvg" data-mode="${mode}" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(ariaLabel)}"><title>${esc(title)}</title>${grid}${seriesSvg(onPts, PAYOFF_COLOR, 'on')}${seriesSvg(offPts, BASE_COLOR, 'off')}<text x="${PL}" y="${H - 4}" fill="#7b8794" font-size="8">pair 1</text><text x="${W - PR}" y="${H - 4}" text-anchor="end" fill="#7b8794" font-size="8">pair ${n}</text></svg>`;
}

/** the block: header · the legend · the two charts side by side (data-beat="reflex-trial") · the paired-gap line, the
 *  manipulation check, n, and the recompute command below the bar; below the bar, hollow/dashed charts and UNMEASURED
 *  with n, no p-value. Pure over the reading R (readReflexTrial's return) — never reaches for a second copy. */
export function renderReflexTrialBlock(R) {
  const head = `<span class="rk" title="C637 — a paired randomised trial on the replay basin: every task runs ON (the reflex returns its reading) and OFF (VNA_RETURN_READING=0), the same hook in both arms, in its own scratch tree; arm order a pure function of (task, seed), written before the first trial. The record is .thetacog/reflex-trial.ndjson, append-only; this panel reads the derived reading (${esc(RECEIPT_PATH)}) only, never a transcript.">THE REFLEX TRIAL · WITH AND WITHOUT, SIDE BY SIDE</span>`;
  if (!R || R.missing) {
    return `<div class="c3h c3t">${head}</div><span class="c3l dim"><span class="lane un">⚪ UNMEASURED</span> — ${esc((R && R.why) || 'no reading')} · not run — <code>${esc(REFLEX_TRIAL_CMD)}</code></span>`;
  }
  const series = Array.isArray(R.series) ? [...R.series].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)) : [];
  const nPairs = R.n_pairs ?? series.length;
  const bar = R.bar ?? BAR;
  const below = nPairs < bar;

  const onLanded = cumulativeLanded(series, 'on'), offLanded = cumulativeLanded(series, 'off');
  const onOutside = cumulativeOutside(series, 'on'), offOutside = cumulativeOutside(series, 'off');
  const outsideMax = Math.max(0.5, ...onOutside.map((p) => p.mean), ...offOutside.map((p) => p.mean)) * 1.15;

  const chart1 = renderChart({ onPts: onLanded, offPts: offLanded, mode: 'rate', yMax: 1, dashed: below,
    title: 'cumulative landed rate by pair order, ON (the reflex returns its reading) versus OFF, each with its cumulative Wilson 95 % band',
    ariaLabel: 'cumulative landed rate, ON versus OFF, by pair order, with a Wilson 95 % band' });
  const chart2 = renderChart({ onPts: onOutside, offPts: offOutside, mode: 'mean', yMax: outsideMax, dashed: below,
    title: 'cumulative mean out-of-scope writes per trial, ON versus OFF — lower is better',
    ariaLabel: 'cumulative mean out-of-scope writes per trial, ON versus OFF, by pair order — lower is better' });

  const legend = `<span class="c3l dim"><span style="display:inline-flex;width:8px;height:8px;border-radius:50%;background:${PAYOFF_COLOR};vertical-align:middle"></span> ON — the reflex returns its reading &nbsp; <span style="display:inline-flex;width:8px;height:8px;border-radius:50%;background:${BASE_COLOR};vertical-align:middle"></span> OFF — VNA_RETURN_READING=0${below ? ' &nbsp; hollow/dashed — below the bar' : ''}</span>`;
  const charts = `<div class="reflex-charts" data-beat="reflex-trial" style="display:flex;flex-wrap:wrap;gap:10px"><div style="flex:1 1 260px;min-width:220px"><div class="c3l dim">CUMULATIVE LANDED RATE BY PAIR ORDER · ON vs OFF (Wilson 95 % band)</div>${chart1}</div><div style="flex:1 1 260px;min-width:220px"><div class="c3l dim">CUMULATIVE MEAN OUT-OF-SCOPE WRITES PER TRIAL · ON vs OFF — lower is better</div>${chart2}</div></div>`;
  const check = `<span class="c3l dim">You don't have to take my word for it: <code>${esc(REFLEX_TRIAL_CMD)}</code> re-reads the record · receipt <code>${esc(RECEIPT_PATH)}</code>.</span>`;

  if (below) {
    return `<div class="c3h c3t">${head}</div>${legend}${charts}<span class="c3l dim"><span class="lane un">⚪ UNMEASURED — n ${nPairs} of ${bar} pairs</span></span>${check}`;
  }

  const arms = R.arms || {}; const paired = R.paired || {}; const manip = R.manipulation || {};
  const armLine = (label, a) => (a
    ? `${label} n ${a.n} · landed ${a.landed}/${a.n} (${pct(a.landed_rate)}, 95 % ${pct(a.wilson && a.wilson[0])}–${pct(a.wilson && a.wilson[1])}) · outside mean ${fmtNum(a.outside_mean)} (95 % ${fmtNum(a.outside_ci && a.outside_ci[0])}–${fmtNum(a.outside_ci && a.outside_ci[1])})`
    : `${label} UNMEASURED`);
  const armsLine = `<span class="c3l">${esc(armLine('ON', arms.on))}</span><span class="c3l">${esc(armLine('OFF', arms.off))}</span>`;
  const gapLine = `<span class="c3l dim"><b>PAIRED GAP</b> — landed: ON-only ${paired.landed ? paired.landed.on_only : '—'} · OFF-only ${paired.landed ? paired.landed.off_only : '—'} · McNemar p ${fmtP(paired.landed && paired.landed.mcnemar_p)} · outside writes: mean diff ${fmtNum(paired.outside && paired.outside.mean_diff)} (95 % CI ${fmtNum(paired.outside && paired.outside.ci && paired.outside.ci[0])}–${fmtNum(paired.outside && paired.outside.ci && paired.outside.ci[1])}) · permutation p ${fmtP(paired.outside && paired.outside.perm_p)}</span>`;
  const manipLine = `<span class="c3l dim"><b>MANIPULATION CHECK</b> — the reading returned on ${manip.on_trials_with_reading ?? '—'} of ${manip.on_trials_outside ?? '—'} ON trials that wrote outside (${pct(manip.rate)})</span>`;
  const nLine = `<span class="c3l dim">n ${nPairs} pairs · seed ${esc(String(R.seed ?? '—'))} · head ${esc(String(R.head || '').slice(0, 10))} · read ${esc(String(R.at || '').slice(0, 16))}</span>`;

  return `<div class="c3h c3t">${head}</div>${legend}${charts}${armsLine}${gapLine}${manipLine}${nLine}${check}`;
}
