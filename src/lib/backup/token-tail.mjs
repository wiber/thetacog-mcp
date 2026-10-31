// src/lib/backup/token-tail.mjs — THE TAIL READING, ONE HOME (C647c, operator 2026-10-04: "add the means for token count and fat
// tail graphs to the /backup pages (and left sidebar) it needs to be a live graph" · "I want to see the new graphs computed by query
// on those pages"). Moved here from scripts/vna/token-tail.mjs so the CLI, the loss run (C638), the /backup pages and the sidebar
// all compute the survival curve P(tick > x) through the SAME functions — a page under src/app cannot import scripts/vna/token-tail.mjs
// (.vercelignore strips it; C646 died "Cannot find module" on exactly that), so the math lives where both sides can reach it, and
// scripts/vna/token-tail.mjs re-exports it. Never a second implementation.
// Steered vs plain ticks, read as a loss distribution: the aggregate over the same tasks, the worst tick, the share of all tokens
// carried by the worst 5 %, the dispersion, and the survival curve. Complexity is matched by C510's decile. Resampling is seeded.
// Below the n floor (10 steered / 50 plain) the reading is UNMEASURED and carries its n, never a number.
// Not sufficient for: whether a steered tick did the same work as a plain one (route and task mix differ), or whether any of the
// work was good (Rice).
// Port row: none — a reader that decides nothing and holds no mass.
// @guard tests/vna/token-tail.test.mjs
// @guard tests/vna/c647c-live-fat-tail-on-backup.test.mjs

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
export const cv = (a) => { const m = sum(a) / a.length; return Math.sqrt(sum(a.map((y) => (y - m) ** 2)) / a.length) / m; };
// the share of all tokens carried by the worst 5 % of ticks — one definition, also read on a stranger's transcripts (C638 loss-run.mjs)
export const share5 = (a) => { const s = [...a].sort((x, y) => y - x); const k = Math.ceil(s.length * 0.05); return sum(s.slice(0, k)) / sum(s); };
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296; }
// C657: the claim graph (src/lib/backup/claim-graph.mjs) reads quantiles and seeds its permutations through THESE two, never a copy
export { q as quantile, lcg };
const binomLE = (n, k, p) => { let s = 0, c = 1; for (let i = 0; i <= k; i++) { if (i > 0) c = (c * (n - i + 1)) / i; s += c * p ** i * (1 - p) ** (n - i); } return s; };

/** the n floor below which nothing is drawn: a curve over 9 steered ticks is a picture of noise */
export const TAIL_FLOOR = Object.freeze({ steer: 10, plain: 50 });
/** how often the live chart re-queries the backed-up ticks; a backup lands at most that often */
export const LIVE_REFRESH_MS = 60_000;

/** TASK — C650 (operator 2026-10-05: "the fat tail is token per task"): what one point on the survival curve is. A tick IS a task:
 *  C510's unit, a prompt to the commit it produced (chat) or one headless-runner verdict row (one dispatched spec row → the commit it
 *  graded), keyed (session, sha) — the key the email's figures were computed over. Its tokens are summed over every model call in it
 *  (one call per message.id), so a task is many calls, never one. */
export const TASK = Object.freeze({
  unit: 'one task: a prompt to the commit it produced, or one headless-runner verdict row (a dispatched spec row to the commit it graded)',
  key: 'session:sha',
  tokens: 'input + cache_create + cache_read, summed over every model call in the task',
});
export const taskKey = (t) => `${t.session || ''}:${t.sha}`;
/** tailArms — the two task sets every tail figure and the survival curve are read over (tailReading's own filter, one place).
 *  C705h (operator 2026-10-09: "nothing even close has happened when /steer is engaged — ship the fix"): the DECLARED arm is the
 *  dispatched unit — a runner verdict row, one spec row's scope written down before that worker ran. A chair unit opened under a
 *  /steer prompt is the chat doing the work inline (the C668d anti-pattern): its scope was declared for the session, never for the
 *  task, and one such unit (10b0db112f, 293 calls, 149.5M tokens) carried the declared tail. It sits in NEITHER arm and is
 *  counted (chair_steer_excluded) so the cut is visible, never silent. */
export const isDeclaredUnit = (t) => t.label === 'STEER' && t.route === 'runner';
export function tailArms(ticks) {
  const T = (ticks || []).filter((t) => t && t.measured && Number.isFinite(t.actual) && t.decile != null);
  return { T, S: T.filter(isDeclaredUnit), Pl: T.filter((t) => t.label === 'PLAIN'), X: T.filter((t) => t.label === 'STEER' && !isDeclaredUnit(t)) };
}

/** NULL_BAND — C657a (operator 2026-10-05: "the graph should be so persuasive because it's showing the null versus the actual"):
 *  what the band on the per-task survival figure is. For every one of tailReading's `sims` redraws (seed `seed`), the declared arm's
 *  task sizes are replaced by undeclared tasks drawn from the same complexity deciles, and that sample's survival share P(task ≥ x)
 *  is read at each x of a fixed log grid; the band is the 2.5 % and 97.5 % quantiles of those shares. It is where the declared curve
 *  would fall if declaring the scope made no difference. Outside it is the visible effect; inside it is NO SEPARATION. */
export const NULL_BAND = Object.freeze({
  level: 0.95,
  grid: 96,
  words: (sims) => `where the declared curve would fall if declaring the scope made no difference (same task sizes, ${Number(sims).toLocaleString('en-US')} redraws)`,
  how: 'for each redraw, one undeclared task per declared task drawn from its own complexity decile; P(task ≥ x) of that sample at each x; the 2.5 % and 97.5 % quantiles across redraws',
});

/** survivalNullBand — THE null band, read off tailReading's own redraws (never a second resampler): `draws` is one Float64Array per
 *  redraw (a declared-sized sample from the undeclared arm at matched deciles), `observed` the declared tasks those draws stand in for,
 *  `all` every task size (the grid spans them). Per grid x: lo/hi = the 2.5/97.5 % quantile of the redrawn share, obs = the declared
 *  share, side = below | inside | above. Shares are k ÷ n, so a quantile is an exact count, never an interpolation. */
export function survivalNullBand(draws, observed, all, { seed, sims, level = NULL_BAND.level, grid = NULL_BAND.grid } = {}) {
  const n = observed.length;
  const vals = all.filter((v) => v > 0);
  const a = Math.log10(Math.min(...vals)), b = Math.log10(Math.max(...vals));
  const x = Array.from({ length: grid }, (_, i) => Math.round(10 ** (a + ((b - a) * i) / (grid - 1))));
  const hist = x.map(() => new Uint32Array(n + 1));
  const atLeast = (s, v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return s.length - lo; };
  for (const d of draws) { const s = Float64Array.from(d).sort(); for (let g = 0; g < grid; g++) hist[g][atLeast(s, x[g])]++; }
  const quant = (h, p) => { const target = p * draws.length; let c = 0; for (let k = 0; k <= n; k++) { c += h[k]; if (c >= target) return k; } return n; };
  const tail = (1 - level) / 2;
  const so = [...observed].sort((u, v) => u - v);
  const lo = [], hi = [], mid = [], obs = [], side = [];
  for (let g = 0; g < grid; g++) {
    const kl = quant(hist[g], tail), kh = quant(hist[g], 1 - tail), ko = atLeast(so, x[g]);
    lo.push(kl / n); hi.push(kh / n); mid.push(quant(hist[g], 0.5) / n); obs.push(ko / n);
    side.push(ko < kl ? 'below' : ko > kh ? 'above' : 'inside');
  }
  const count = (s) => side.filter((v) => v === s).length;
  // the x-ranges where the declared curve leaves the band, as the figure states them
  const runs = []; for (let g = 0; g < grid; g++) { if (side[g] === 'inside') continue; const r = runs.at(-1); if (r && r.side === side[g] && r.to === g - 1) r.to = g; else runs.push({ side: side[g], from: g, to: g }); }
  return {
    seed, sims, level, n, x, lo, hi, mid, obs, side,
    outside: runs.map((r) => ({ side: r.side, from: x[r.from], to: x[r.to] })),
    count: { below: count('below'), inside: count('inside'), above: count('above') },
    verdict: count('below') + count('above') === 0 ? 'NO SEPARATION' : count('above') > 0 && count('below') === 0 ? 'ABOVE THE NULL' : count('below') > 0 && count('above') === 0 ? 'BELOW THE NULL' : 'BOTH SIDES',
    words: NULL_BAND.words(sims), how: NULL_BAND.how,
  };
}

export function tailReading(ticks, { sims = 20000, seed = 7 } = {}) {
  const { T, S, Pl, X } = tailArms(ticks);
  if (S.length < TAIL_FLOOR.steer || Pl.length < TAIL_FLOOR.plain) return { status: 'UNMEASURED', reason: `n steer ${S.length}, plain ${Pl.length} (need ${TAIL_FLOOR.steer} / ${TAIL_FLOOR.plain})`, n: { steer: S.length, plain: Pl.length }, floor: TAIL_FLOOR };
  const byDec = {}; for (const t of Pl) (byDec[t.decile] ||= []).push(t.actual);
  const Sx = S.filter((t) => byDec[t.decile]?.length);
  const r = lcg(seed);
  const aggS = sum(Sx.map((t) => t.actual));
  const aggs = [], worsts = [], draws = [];   // C657a: every redraw is kept, so the null band reads the SAME draws as the aggregate and the worst
  for (let k = 0; k < sims; k++) {
    let s = 0, m = 0; const d = new Float64Array(Sx.length);
    for (let i = 0; i < Sx.length; i++) { const p = byDec[Sx[i].decile]; const v = p[Math.floor(r() * p.length)]; d[i] = v; s += v; if (v > m) m = v; }
    aggs.push(s); worsts.push(m); draws.push(d);
  }
  aggs.sort((a, b) => a - b); worsts.sort((a, b) => a - b);
  const worstS = Math.max(...Sx.map((t) => t.actual));
  const above = (pct) => Sx.filter((t) => t.actual > q(byDec[t.decile], pct)).length;
  const sa = S.map((t) => t.actual), pa = Pl.map((t) => t.actual);
  const over = (th) => ({ threshold: th, plain: pa.filter((v) => v > th).length, steer: sa.filter((v) => v > th).length });
  const days = T.map((t) => t.day).filter(Boolean).sort();
  return {
    status: 'MEASURED',
    seed,
    span: { first: days[0] ?? null, last: days.at(-1) ?? null },
    sims,
    n: { steer: Sx.length, plain: Pl.length, steer_runner: Sx.filter((t) => t.route === 'runner').length, chair_steer_excluded: X.length },
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
    null_band: survivalNullBand(draws, Sx.map((t) => t.actual), [...sa, ...pa], { seed, sims }),
    not_sufficient_for: 'same work per tick (route and task mix differ); whether the work was good (Rice)',
    check: 'node scripts/vna/token-tail.mjs --json',
  };
}

/** survivalSteps — THE survival curve as data: for ascending values a, the points (x = a[i], p = P(tick ≥ a[i]) = (n − i) ÷ n).
 *  Every painter (survivalSvg here, the live React chart on /backup/adherence, the sidebar) maps these, never its own step. */
export const survivalSteps = (a) => a.map((v, i) => ({ x: v, p: (a.length - i) / a.length }));

/** survivalScale — the log-log frame survivalSvg draws in (the x range follows the data, so a 1.4-billion-token session stays on
 *  the chart); returned as functions + ticks so a React painter uses the identical frame. */
export function survivalScale(R, { w = 640, h = 360, pad = { l: 58, r: 16, t: 16, b: 44 } } = {}) {
  const all = [...R.survival.plain, ...R.survival.steer].filter((v) => v > 0);
  const hi = Math.max(4e8, ...all) * 1.15, lo = Math.min(3e5, ...all);
  const x0 = Math.log10(lo), x1 = Math.log10(hi);
  const xs = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8, 3e8, 1e9, 3e9, 1e10].filter((v) => v >= lo && v <= hi);
  const ys = [1, 0.1, 0.01, 0.002], y0 = Math.log10(1.5e-3), y1 = 0;
  const X = (v) => pad.l + ((Math.log10(v) - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (p) => pad.t + ((y1 - Math.log10(p)) / (y1 - y0)) * (h - pad.t - pad.b);
  const points = (a) => survivalSteps(a).map((s) => `${X(Math.max(s.x, lo)).toFixed(1)},${Y(s.p).toFixed(1)}`).join(' ');
  return { w, h, pad, lo, hi, xs, ys, X, Y, points };
}

export const tokensWord = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k').replace(/\.0([BM])$/, '$1');
const f = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k');
export const pctTick = (p) => (p >= 0.01 ? p * 100 + '%' : (p * 100).toFixed(1) + '%');

export function survivalSvg(R, { w = 640, h = 360 } = {}) {
  // a survival curve an actuary reads first: P(unit > x), log-log. The legend sits in its own corner, never on a curve; the words
  // are the reader's, never ours.
  const { pad, xs, ys, X, Y, points } = survivalScale(R, { w, h });
  const grid = xs.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${h - pad.b}" class="g"/><text x="${X(v)}" y="${h - pad.b + 16}" class="t" text-anchor="middle">${f(v)}</text>`).join('')
    + ys.map((p) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(p)}" y2="${Y(p)}" class="g"/><text x="${pad.l - 6}" y="${Y(p) + 4}" class="t" text-anchor="end">${pctTick(p)}</text>`).join('');
  const lx = pad.l + 16, ly = h - pad.b - 30; // the lower-left corner is empty on any survival curve
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Survival curve of tokens per unit of agent work, with and without a scope declared before the work, log-log">
<style>.g{stroke:#d9d6cf;stroke-width:1}.t{font:11px ui-monospace,Menlo,monospace;fill:#6b6a65}.pl{fill:none;stroke:#b5562a;stroke-width:2}.st{fill:none;stroke:#2f7d6b;stroke-width:2.5}</style>
${grid}
<polyline class="pl" points="${points(R.survival.plain)}"/>
<polyline class="st" points="${points(R.survival.steer)}"/>
<rect x="${lx - 8}" y="${ly - 12}" width="238" height="40" fill="#ffffff" opacity="0.9"/>
<line x1="${lx}" x2="${lx + 18}" y1="${ly - 4}" y2="${ly - 4}" class="st"/><text x="${lx + 24}" y="${ly}" class="t" style="fill:#2f7d6b">scope declared · n ${R.n.steer} · worst ${f(R.max.steer)}</text>
<line x1="${lx}" x2="${lx + 18}" y1="${ly + 14}" y2="${ly + 14}" class="pl"/><text x="${lx + 24}" y="${ly + 18}" class="t" style="fill:#b5562a">no declared scope · n ${R.n.plain} · worst ${f(R.max.plain)}</text>
<text x="${w / 2}" y="${h - 6}" class="t" text-anchor="middle">tokens in one unit of agent work (log)</text>
<text x="14" y="${h / 2}" class="t" text-anchor="middle" transform="rotate(-90 14 ${h / 2})">share of units larger than x (log)</text>
</svg>`;
}

/** tokensPerDay — the token count per day off the same measured ticks (actual = input + cache_create + cache_read), split by label;
 *  a day is only where ticks fell, never an average. */
export function tokensPerDay(ticks) {
  const by = new Map();
  for (const t of ticks || []) {
    if (!t || !t.day || !Number.isFinite(t.actual)) continue;
    const d = by.get(t.day) || { day: t.day, steer: 0, plain: 0, ticks: 0 };
    if (t.label === 'STEER') d.steer += t.actual; else d.plain += t.actual;
    d.ticks += 1; by.set(t.day, d);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}
