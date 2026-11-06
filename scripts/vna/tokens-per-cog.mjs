// scripts/vna/tokens-per-cog.mjs — C659 TOKENS PER COG, ONE READING FOR TWO HOSTS (operator 2026-10-05, verbatim: "the tokens per
// Cog has to be on the page on the backup, I don't know where to put that with that that needs to be a graph and it has to make
// sense"). The VS Code sidebar (scripts/vna/steer-ui.mjs renderCogCard) and the site (src/components/receipt/TokensPerCog.tsx,
// mounted in the TOKEN EFFICIENCY beat) both read tokens per cog through tokensPerCogReading() and draw it through
// tokensPerCogSvg() + tokensPerCogPill(); neither host divides a spend by a cog itself.
//
// WHAT A COG IS: one minted unit of finished work — a commit whose guard failed on its parent and passes on it (the red
// witness) and that closed or touched a spec row; its size is the declared weights over rows ticked, basins touched, cells lit
// (data/vna/cog-weights.json, scripts/vna/cog.mjs C93a). An unminted commit is not a cog and is never a point on the line.
// HOW IT IS READ: tokens per cog = the session spend of record for that commit (data/vna/cog-spend.ndjson, C93h) ÷ its cog —
// the same quotient peg.mjs pegUpdate takes. THE PEG: per band, the fewest tokens per cog ever measured on a minted row; it only
// falls (C93c), so it is the floor every later row is read against.
// THE n FLOOR: a band with fewer than TPC_N_FLOOR measured minted rows draws its points but NO line — a trend over three points
// is a guess, and the page says "below the floor" instead.
// SUFFICIENT FOR: tokens spent per unit of finished work, by band, and whether that number is falling over the minted record.
// NOT SUFFICIENT FOR: whether the work was right (undecidable, Rice 1953), nor a dollar figure (no price is pinned, KR40).
// LLM-free, pure: rows in, a reading out; no file is read here (the hosts read their own receipts).
// Port row: C659r — the band split and the rolling median decide what is drawn; port beside peg.mjs once the page mount is live.
// @guard tests/vna/c659-tokens-per-cog-is-a-graph-that-makes-sense.test.mjs

export const TPC_N_FLOOR = 10;
export const TPC_WINDOW = 7;   // the rolling median's window, in measured rows of one band
export const TPC_UNIT = 'tokens per cog';
export const TPC_WHAT = 'A cog is one minted unit of finished work: a commit whose guard failed on its parent and passes on it, closing or touching a spec row.';
export const TPC_MINTED = 'It is minted from the commit, never from the prompt: node scripts/vna/cog.mjs --since <sha> weighs the rows ticked, the basins touched and the cells lit (data/vna/cog-weights.json); a commit with no red witness is not minted.';
export const TPC_PEG = 'Each band is read against its peg: the fewest tokens per cog ever measured on a minted row of that band. The peg only falls.';
export const TPC_RECOMPUTE = 'node scripts/vna/cog.mjs --since <sha> && node scripts/vna/peg.mjs';

/** the one quotient — tokens spent ÷ the cog minted; null when either side is missing (both hosts and the sidebar face call this) */
export function tokensPerCog(tokens, cog) { const t = Number(tokens), c = Number(cog); return Number.isFinite(t) && t > 0 && Number.isFinite(c) && c > 0 ? t / c : null; }
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const atMs = (at) => { const t = Date.parse(String(at || '')); return Number.isFinite(t) ? t : null; };

/**
 * tokensPerCogReading({ cogRows, spendRows, peg, nFloor }) → the one reading both hosts draw.
 *   cogRows   data/vna/cog.ndjson rows ({ sha, at, cog, band, minted, partial, why }); a re-minted sha supersedes its earlier row
 *   spendRows the spend of record per sha ({ sha, total, route, status }); a row with status UNMEASURED or no positive total is no spend
 *   peg       data/vna/cog-peg.json ({ bands: { <band>: { peg, legacy } } }) — optional
 */
export function tokensPerCogReading({ cogRows = [], spendRows = [], peg = null, nFloor = TPC_N_FLOOR, window = TPC_WINDOW } = {}) {
  const newest = new Map(); for (const c of cogRows || []) if (c && c.sha) newest.set(c.sha, c);
  const spend = new Map(); for (const s of spendRows || []) if (s && s.sha && s.status !== 'UNMEASURED' && Number.isFinite(Number(s.total)) && Number(s.total) > 0) spend.set(s.sha, s);
  const points = [...newest.values()].map((c) => {
    const s = spend.get(c.sha) || null; const cog = Number(c.cog) || 0;
    const status = !c.minted ? 'unminted' : c.partial ? 'PARTIAL' : !s || !(cog > 0) ? 'UNMEASURED' : 'measured';
    const tokens = s ? Number(s.total) : null;
    return { sha: c.sha, at: c.at || null, band: c.band || null, cog, minted: !!c.minted, status, tokens, perCog: status === 'measured' ? tokensPerCog(tokens, cog) : null, route: s ? s.route || null : null, why: status === 'measured' ? null : status === 'unminted' ? (c.why || 'not minted — no red witness') : status === 'PARTIAL' ? 'the walk has not landed for this sha — minted for the graph, not for the peg' : 'no spend of record for this commit' };
  });
  const measured = points.filter((p) => p.status === 'measured').sort((a, b) => (atMs(a.at) ?? 0) - (atMs(b.at) ?? 0));
  const roll = (vals) => vals.map((_, i) => median(vals.slice(Math.max(0, i - window + 1), i + 1)));
  const bandNames = [...new Set([...measured.map((p) => p.band), ...Object.keys((peg && peg.bands) || {})])].filter(Boolean);
  const bands = bandNames.map((band) => {
    const pts = measured.filter((p) => p.band === band); const n = pts.length; const vals = pts.map((p) => p.perCog);
    const pv = peg && peg.bands && peg.bands[band] && Number.isFinite(Number(peg.bands[band].peg)) ? Number(peg.bands[band].peg) : null;
    const drawn = n >= nFloor;
    const half = Math.floor(n / 2); const early = drawn ? median(vals.slice(0, half)) : null; const late = drawn ? median(vals.slice(n - half)) : null;
    const direction = !drawn || early == null || late == null ? null : late < early * 0.9 ? 'falling' : late > early * 1.1 ? 'rising' : 'flat';
    return { band, n, peg: pv, pegLegacy: !!(peg && peg.bands && peg.bands[band] && peg.bands[band].legacy), drawn, why: drawn ? null : `n=${n}, below the floor of ${nFloor} — points only, no line`, points: pts.map((p) => ({ sha: p.sha, at: p.at, perCog: p.perCog })), line: drawn ? roll(vals) : null, early, late, direction };
  });
  const series = roll(measured.map((p) => p.perCog));
  const n = measured.length;
  const status = n ? 'MEASURED' : 'UNMEASURED';
  return {
    status, why: n ? null : (newest.size ? 'no minted row with a spend of record' : 'no cog row on the record'),
    unit: TPC_UNIT, nFloor, window, n, minted: points.filter((p) => p.minted).length, rows: points.length,
    value: series.length ? series[series.length - 1] : null, series,
    first: measured.length ? measured[0].at : null, last: measured.length ? measured[measured.length - 1].at : null,
    points, bands,
  };
}

/** the sidebar's spend rows off its peg walk's scores (scores[i].spend = { route, total, … } when measured) */
export function spendRowsOfScores(scores) { return (scores || []).filter((s) => s && s.spend && Number(s.spend.total) > 0).map((s) => ({ sha: s.sha, route: s.spend.route, total: s.spend.total })); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const tokWord = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
const BAND_INK = { s: '#9a9aa2', m: '#d9733f', l: '#35a08a', xl: '#7cc4ff' };
const inkOf = (b) => BAND_INK[b] || '#c8a2ff';

/** the one graph: x = when the cog was minted, y = tokens per cog (log); per band the dots, the rolling median when n clears the
 *  floor, and the dashed peg. Both hosts paint this string. */
export function tokensPerCogSvg(r, { w = 480, h = 240 } = {}) {
  if (!r || r.status !== 'MEASURED') return `<p class="tpc-un" data-tpc-graph="UNMEASURED">tokens per cog: UNMEASURED — ${esc((r && r.why) || 'no reading')}</p>`;
  const P = { l: 46, r: 12, t: 12, b: 34 };
  const all = r.bands.flatMap((b) => b.points); const ms = all.map((p) => atMs(p.at)).filter((t) => t != null);
  const timed = ms.length === all.length;   // a row with no parseable `at` puts the whole axis on record order instead of time
  const seq = new Map(all.map((p, i) => [p.sha, i]));
  const t0 = timed ? Math.min(...ms) : 0, t1 = timed ? Math.max(...ms) : Math.max(1, all.length - 1), span = Math.max(1, t1 - t0);
  const ys = [...r.bands.flatMap((b) => b.points.map((p) => p.perCog)), ...r.bands.map((b) => b.peg)].filter((v) => v > 0);
  const lo = Math.log10(Math.min(...ys)) - 0.1, hi = Math.log10(Math.max(...ys)) + 0.1;
  const xOf = (p) => (timed ? atMs(p.at) : seq.get(p.sha));
  const X = (p) => P.l + ((xOf(p) - t0) / span) * (w - P.l - P.r);
  const Y = (v) => h - P.b - ((Math.log10(v) - lo) / Math.max(1e-9, hi - lo)) * (h - P.t - P.b);
  const grid = []; for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) grid.push(10 ** e);
  const gridSvg = grid.map((v) => `<line x1="${P.l}" x2="${w - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#2a2a2e"/><text x="${P.l - 4}" y="${(Y(v) + 4).toFixed(1)}" fill="#9a9aa2" font-size="11" text-anchor="end">${tokWord(v)}</text>`).join('');
  const day = (t) => (timed ? new Date(t).toISOString().slice(0, 10) : `row ${t + 1}`);
  const axis = `<text x="${P.l}" y="${h - P.b + 16}" fill="#9a9aa2" font-size="11">${day(t0)}</text><text x="${w - P.r}" y="${h - P.b + 16}" fill="#9a9aa2" font-size="11" text-anchor="end">${day(t1)}</text><text x="${(P.l + w - P.r) / 2}" y="${h - 4}" fill="#9a9aa2" font-size="11" text-anchor="middle">${timed ? 'when the cog was minted →' : 'order on the record →'}</text>`;
  const bandsSvg = r.bands.map((b) => {
    const ink = inkOf(b.band);
    const pegSvg = b.peg > 0 ? `<line data-peg="${esc(b.band)}" x1="${P.l}" x2="${w - P.r}" y1="${Y(b.peg).toFixed(1)}" y2="${Y(b.peg).toFixed(1)}" stroke="${ink}" stroke-dasharray="4 3" opacity=".7"><title>${esc(`band ${b.band} peg ${tokWord(b.peg)} tokens per cog — the floor that only falls${b.pegLegacy ? ' (legacy: set before the walk landed)' : ''}`)}</title></line>` : '';
    const dots = b.points.map((p) => `<rect x="${(X(p) - 2.5).toFixed(1)}" y="${(Y(p.perCog) - 2.5).toFixed(1)}" width="5" height="5" rx="2.5" fill="${ink}" opacity=".55"><title>${esc(`${String(p.sha).slice(0, 10)} · band ${b.band} · ${tokWord(p.perCog)} tokens per cog`)}</title></rect>`).join('');
    const line = b.drawn && b.line ? `<polyline data-band-line="${esc(b.band)}" points="${b.points.map((p, i) => `${X(p).toFixed(1)},${Y(b.line[i]).toFixed(1)}`).join(' ')}" fill="none" stroke="${ink}" stroke-width="2"/>` : '';
    return `<g data-band="${esc(b.band)}" data-n="${b.n}" data-drawn="${b.drawn ? 'yes' : 'no'}">${pegSvg}${dots}${line}</g>`;
  }).join('');
  const legend = `<div class="tpc-legend" style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin:4px 0">${r.bands.map((b) => `<span data-legend="${esc(b.band)}"><b style="color:${inkOf(b.band)}">band ${esc(b.band)}</b> n=${b.n}${b.peg ? ` · peg ${tokWord(b.peg)}` : ''} · ${b.drawn ? (b.direction ? `${b.direction} (${tokWord(b.early)} → ${tokWord(b.late)})` : 'line') : `below the floor of ${r.nFloor} — no line`}</span>`).join('')}</div>`;
  return `<div class="tpc" data-tpc-graph="MEASURED"><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="tokens per cog over time, log scale, one line per band that clears its n floor, dashed: the band's peg" style="display:block;max-width:640px"><title>tokens per cog — y: tokens spent per minted unit of finished work (log), x: when it was minted; the solid line is the rolling median of ${r.window} rows, drawn only for a band with n ≥ ${r.nFloor}; dashed: the band's peg</title>${gridSvg}${axis}${bandsSvg}</svg>${legend}</div>`;
}

/** the C647d pill spec — the closed face is the number, n and the same series; behind the + what a cog is, how it is minted,
 *  the peg it is read against and n per band */
export function tokensPerCogPill(r, { id = 'tokens-per-cog' } = {}) {
  const has = r && r.status === 'MEASURED';
  const perBand = has ? r.bands.map((b) => `band ${b.band}: n=${b.n}${b.peg ? `, peg ${tokWord(b.peg)}` : ''}${b.drawn ? (b.direction ? `, ${b.direction}` : '') : `, below the floor of ${r.nFloor}`}`).join(' · ') : 'no band measured';
  return {
    id, label: 'Tokens per unit of finished work', value: has ? Math.round(r.value) : null, unit: TPC_UNIT, n: has ? r.n : 0, series: has ? r.series.map((v) => Math.round(v)) : [], why: has ? undefined : (r && r.why) || 'no reading',
    read: {
      left: `<p data-tpc="what">${esc(TPC_WHAT)}</p><p data-tpc="minted">${esc(TPC_MINTED)}</p><p>The number is the rolling median of the newest ${has ? r.window : TPC_WINDOW} measured cogs; the line falling means each unit of finished work costs fewer tokens.</p>`,
      right: `<p data-tpc="peg">${esc(TPC_PEG)}</p><p data-tpc="n">n per band — ${esc(perBand)}. A band under ${has ? r.nFloor : TPC_N_FLOOR} rows draws points and no line.</p>${has ? `<p>Minted record: ${esc(String(r.first).slice(0, 10))} to ${esc(String(r.last).slice(0, 10))}.</p>` : ''}`,
    },
    notFor: {
      left: '<p>Whether the work was right — undecidable (Rice, 1953). This counts tokens against minted work, never quality.</p>',
      right: '<p>A dollar figure: no price per token is pinned here. Nor a trend in a band below its n floor.</p>',
    },
    mitigation: {
      left: `<p>Recompute it from your own record: <code>${esc(TPC_RECOMPUTE)}</code>.</p>`,
      right: '<p>Every point names its commit; the spend of record is data/vna/cog-spend.ndjson and the peg moves are data/vna/cog-peg.ndjson — a point whose tokens differ from that commit\'s usage rows falsifies it.</p>',
    },
  };
}
