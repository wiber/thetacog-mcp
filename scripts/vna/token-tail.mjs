#!/usr/bin/env node
// scripts/vna/token-tail.mjs — THE TAIL READING: steered vs plain ticks, read as a loss distribution (operator 2026-10-04:
// "its a fat tail distribution and he would understand the difference"). A reader over data/vna/token-savings.json (C519's
// ticks, one call per message.id), never a second usage parse. It computes nothing the medians already say; it reads the
// tail an underwriter prices: the aggregate over the same tasks, the worst tick, the share of all tokens carried by the
// worst 5 %, the dispersion, and the survival curve P(tick > x). Complexity is matched by C510's decile (the same ruler
// C519 uses). Resampling is seeded, so the same record gives the same bytes.
// Not sufficient for: whether a steered tick did the same work as a plain one (the route and the task mix differ — 35 of
// 44 steered ticks are headless runner ticks on pre-scoped spec rows), or whether any of the work was good (Rice).
// Port row: none — a reader that decides nothing and holds no mass.
// @guard tests/vna/token-tail.test.mjs
import fs from 'node:fs';
import path from 'node:path';

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
export const cv = (a) => { const m = sum(a) / a.length; return Math.sqrt(sum(a.map((y) => (y - m) ** 2)) / a.length) / m; };
// the share of all tokens carried by the worst 5 % of ticks — one definition, also read on a stranger's transcripts (C638 loss-run.mjs)
export const share5 = (a) => { const s = [...a].sort((x, y) => y - x); const k = Math.ceil(s.length * 0.05); return sum(s.slice(0, k)) / sum(s); };
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296; }
const binomLE = (n, k, p) => { let s = 0, c = 1; for (let i = 0; i <= k; i++) { if (i > 0) c = (c * (n - i + 1)) / i; s += c * p ** i * (1 - p) ** (n - i); } return s; };

export function tailReading(ticks, { sims = 20000, seed = 7 } = {}) {
  const T = ticks.filter((t) => t.measured && Number.isFinite(t.actual) && t.decile != null);
  const S = T.filter((t) => t.label === 'STEER'), Pl = T.filter((t) => t.label === 'PLAIN');
  if (S.length < 10 || Pl.length < 50) return { status: 'UNMEASURED', reason: `n steer ${S.length}, plain ${Pl.length} (need 10 / 50)` };
  const byDec = {}; for (const t of Pl) (byDec[t.decile] ||= []).push(t.actual);
  const Sx = S.filter((t) => byDec[t.decile]?.length);
  const r = lcg(seed);
  const aggS = sum(Sx.map((t) => t.actual));
  const aggs = [], worsts = [];
  for (let k = 0; k < sims; k++) {
    let s = 0, m = 0;
    for (const t of Sx) { const p = byDec[t.decile]; const v = p[Math.floor(r() * p.length)]; s += v; if (v > m) m = v; }
    aggs.push(s); worsts.push(m);
  }
  aggs.sort((a, b) => a - b); worsts.sort((a, b) => a - b);
  const worstS = Math.max(...Sx.map((t) => t.actual));
  const above = (pct) => Sx.filter((t) => t.actual > q(byDec[t.decile], pct)).length;
  const sa = S.map((t) => t.actual), pa = Pl.map((t) => t.actual);
  const over = (th) => ({ threshold: th, plain: pa.filter((v) => v > th).length, steer: sa.filter((v) => v > th).length });
  const days = T.map((t) => t.day).filter(Boolean).sort();
  return {
    status: 'MEASURED',
    span: { first: days[0] ?? null, last: days.at(-1) ?? null },
    sims,
    n: { steer: Sx.length, plain: Pl.length, steer_runner: Sx.filter((t) => t.route === 'runner').length },
    median: { steer: q(sa, 0.5), plain: q(pa, 0.5) },
    p95: { steer: q(sa, 0.95), plain: q(pa, 0.95) },
    max: { steer: Math.max(...sa), plain: Math.max(...pa) },
    aggregate: {
      steer: aggS, plain_expected: sum(aggs) / sims, plain_band95: [aggs[Math.floor(sims * 0.025)], aggs[Math.floor(sims * 0.975)]],
      less: 1 - aggS / (sum(aggs) / sims), p: aggs.filter((x) => x <= aggS).length / sims,
      how: 'for each steered tick, one plain tick drawn from its own complexity decile; the sum over the same task mix, resampled',
    },
    worst: { steer: worstS, plain_worst_of_n_median: worsts[Math.floor(sims / 2)], plain_band95: [worsts[Math.floor(sims * 0.025)], worsts[Math.floor(sims * 0.975)]], p: worsts.filter((x) => x <= worstS).length / sims },
    worst5_share: { steer: share5(sa), plain: share5(pa) },
    cv: { steer: cv(sa), plain: cv(pa) },
    above_own_decile: { p75: { n: above(0.75), expected: Sx.length * 0.25, p: binomLE(Sx.length, above(0.75), 0.25) }, p95: { n: above(0.95), expected: Sx.length * 0.05, p: binomLE(Sx.length, above(0.95), 0.05) } },
    over: [over(20e6), over(50e6), over(100e6)],
    survival: { steer: [...sa].sort((a, b) => a - b), plain: [...pa].sort((a, b) => a - b) },
    not_sufficient_for: 'same work per tick (route and task mix differ); whether the work was good (Rice)',
    check: 'node scripts/vna/token-tail.mjs --json',
  };
}

const f = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k');

export function survivalSvg(R, { w = 640, h = 360 } = {}) {
  // a survival curve an actuary reads first: P(unit > x), log-log. The x range follows the data (a 1.4-billion-token session
  // stays on the chart); the legend sits in its own corner, never on a curve; the words are the reader's, never ours.
  const pad = { l: 58, r: 16, t: 16, b: 44 };
  const all = [...R.survival.plain, ...R.survival.steer].filter((v) => v > 0);
  const hi = Math.max(4e8, ...all) * 1.15, lo = Math.min(3e5, ...all);
  const x0 = Math.log10(lo), x1 = Math.log10(hi);
  const xs = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8, 3e8, 1e9, 3e9, 1e10].filter((v) => v >= lo && v <= hi);
  const ys = [1, 0.1, 0.01, 0.002], y0 = Math.log10(1.5e-3), y1 = 0;
  const X = (v) => pad.l + ((Math.log10(v) - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (p) => pad.t + ((y1 - Math.log10(p)) / (y1 - y0)) * (h - pad.t - pad.b);
  const step = (a) => a.map((v, i) => `${X(Math.max(v, lo)).toFixed(1)},${Y((a.length - i) / a.length).toFixed(1)}`).join(' ');
  const grid = xs.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${h - pad.b}" class="g"/><text x="${X(v)}" y="${h - pad.b + 16}" class="t" text-anchor="middle">${f(v)}</text>`).join('')
    + ys.map((p) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(p)}" y2="${Y(p)}" class="g"/><text x="${pad.l - 6}" y="${Y(p) + 4}" class="t" text-anchor="end">${p >= 0.01 ? p * 100 + '%' : (p * 100).toFixed(1) + '%'}</text>`).join('');
  const lx = pad.l + 16, ly = h - pad.b - 30; // the lower-left corner is empty on any survival curve
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Survival curve of tokens per unit of agent work, with and without a scope declared before the work, log-log">
<style>.g{stroke:#d9d6cf;stroke-width:1}.t{font:11px ui-monospace,Menlo,monospace;fill:#6b6a65}.pl{fill:none;stroke:#b5562a;stroke-width:2}.st{fill:none;stroke:#2f7d6b;stroke-width:2.5}</style>
${grid}
<polyline class="pl" points="${step(R.survival.plain)}"/>
<polyline class="st" points="${step(R.survival.steer)}"/>
<rect x="${lx - 8}" y="${ly - 12}" width="238" height="40" fill="#ffffff" opacity="0.9"/>
<line x1="${lx}" x2="${lx + 18}" y1="${ly - 4}" y2="${ly - 4}" class="st"/><text x="${lx + 24}" y="${ly}" class="t" style="fill:#2f7d6b">scope declared · n ${R.n.steer} · worst ${f(R.max.steer)}</text>
<line x1="${lx}" x2="${lx + 18}" y1="${ly + 14}" y2="${ly + 14}" class="pl"/><text x="${lx + 24}" y="${ly + 18}" class="t" style="fill:#b5562a">no declared scope · n ${R.n.plain} · worst ${f(R.max.plain)}</text>
<text x="${w / 2}" y="${h - 6}" class="t" text-anchor="middle">tokens in one unit of agent work (log)</text>
<text x="14" y="${h / 2}" class="t" text-anchor="middle" transform="rotate(-90 14 ${h / 2})">share of units larger than x (log)</text>
</svg>`;
}

/** exceedanceSvg — the email's chart for a broker (C643b chart round, 2026-10-04). Same data as survivalSvg, in his words: "1 in N
 *  jobs", a one-line headline, and the resampled worst-of-44 marked AS resampled. Chosen by vision cold reads: of four candidates
 *  it was the only one a Paul reader would forward on its own; putting the band and the method on its face cost the forward, so the
 *  method rides in the P.S. for the data team (the footer says so). Every number is the reading's; the dates are its span. */
export function exceedanceSvg(R, { w = 640, h = 446 } = {}) {
  const pad = { l: 86, r: 20, t: 62, b: 78 };
  const M = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k');
  const all = [...R.survival.plain, ...R.survival.steer];
  const lo = 3e5, hi = Math.max(...all) * 1.2, x0 = Math.log10(lo), x1 = Math.log10(hi), y0 = Math.log10(1.5e-3);
  const X = (v) => pad.l + ((Math.log10(Math.max(v, lo)) - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (p) => pad.t + ((0 - Math.log10(p)) / (0 - y0)) * (h - pad.t - pad.b);
  const step = (a) => a.map((v, i) => `${X(v).toFixed(1)},${Y((a.length - i) / a.length).toFixed(1)}`).join(' ');
  const fmtDay = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '?');
  const xs = [1e6, 1e7, 1e8].map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${h - pad.b}" class="g"/><text x="${X(v)}" y="${h - pad.b + 18}" class="t" text-anchor="middle">${M(v)}</text>`).join('');
  const ys = [[1, 'every job'], [0.1, '1 in 10'], [0.01, '1 in 100'], [0.002, '1 in 500']].map(([p, l]) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(p)}" y2="${Y(p)}" class="g"/><text x="${pad.l - 8}" y="${Y(p) + 4}" class="t" text-anchor="end">${l}</text>`).join('');
  const yb = Y(1 / R.n.steer), wx = X(R.worst.plain_worst_of_n_median);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Exceedance curve: how often one piece of agent work is bigger than a given size, with and without a scope declared before the work">
<style>.g{stroke:#e2ded5;stroke-width:1}.t{font:13px Helvetica,Arial,sans-serif;fill:#5f5d57}.h{font:bold 17px Georgia,serif;fill:#1d1d1b}.s{font:13px Georgia,serif;fill:#5f5d57}.pl{fill:none;stroke:#b5562a;stroke-width:2.5}.st{fill:none;stroke:#2f7d6b;stroke-width:3}</style>
<text x="${pad.l}" y="26" class="h">The typical job is the same size. The rare job is not.</text>
<text x="${pad.l}" y="46" class="s">How often one piece of agent work is bigger than a given size</text>
${xs}${ys}
<polyline class="pl" points="${step(R.survival.plain)}"/><polyline class="st" points="${step(R.survival.steer)}"/>
<line x1="${wx}" x2="${wx}" y1="${Y(0.3) + 16}" y2="${yb + 10}" stroke="#b5562a" stroke-dasharray="4 3" stroke-width="1.5"/>
<text x="${w - pad.r}" y="${Y(0.3) - 6}" class="t" text-anchor="end" style="fill:#b5562a">worst of ${R.n.steer} undeclared jobs at the same sizes</text>
<text x="${w - pad.r}" y="${Y(0.3) + 10}" class="t" text-anchor="end" style="fill:#b5562a">(resampled from the ${R.n.plain}): typically ${M(R.worst.plain_worst_of_n_median)}</text>
<text x="${X(R.max.steer) - 4}" y="${yb + 24}" class="t" text-anchor="end" style="fill:#2f7d6b">worst of the ${R.n.steer} declared jobs: ${M(R.max.steer)}</text>
<text x="${pad.l + 10}" y="${h - pad.b - 34}" class="t" style="fill:#2f7d6b">— scope declared before the work (${R.n.steer} jobs)</text>
<text x="${pad.l + 10}" y="${h - pad.b - 14}" class="t" style="fill:#b5562a">— no declared scope (${R.n.plain} jobs), worst ${M(R.max.plain)}</text>
<text x="${(pad.l + w - pad.r) / 2}" y="${h - pad.b + 40}" class="t" text-anchor="middle">size of one piece of agent work, in tokens (log scale)</text>
<text x="20" y="${h - 8}" class="t" style="font-size:11.5px">Our own agent work, ${fmtDay(R.span?.first)} – ${fmtDay(R.span?.last)} 2026. How it was counted is in the P.S., for your data team.</text>
</svg>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = path.resolve('data/vna/token-savings.json');
  const R = tailReading(JSON.parse(fs.readFileSync(src, 'utf8')).ticks);
  const args = process.argv.slice(2);
  const svgAt = args.includes('--svg') ? args[args.indexOf('--svg') + 1] : null;
  const exAt = args.includes('--exceedance') ? args[args.indexOf('--exceedance') + 1] : null;
  if (svgAt && R.status === 'MEASURED') fs.writeFileSync(svgAt, survivalSvg(R));
  if (exAt && R.status === 'MEASURED') fs.writeFileSync(exAt, exceedanceSvg(R));
  if (args.includes('--json')) { const { survival, ...rest } = R; console.log(JSON.stringify(rest, null, 1)); }
  else if (R.status !== 'MEASURED') console.log(`UNMEASURED — ${R.reason}`);
  else console.log(`tail · steered n ${R.n.steer} vs plain n ${R.n.plain} · median ${f(R.median.steer)} vs ${f(R.median.plain)} · aggregate ${(R.aggregate.less * 100).toFixed(0)}% less (p ${R.aggregate.p.toFixed(3)}) · worst ${f(R.worst.steer)} vs worst-of-${R.n.steer} ${f(R.worst.plain_worst_of_n_median)} (p ${R.worst.p.toFixed(3)}) · worst 5% carry ${(R.worst5_share.steer * 100).toFixed(0)}% vs ${(R.worst5_share.plain * 100).toFixed(0)}% · CV ${R.cv.steer.toFixed(2)} vs ${R.cv.plain.toFixed(2)}`);
}
