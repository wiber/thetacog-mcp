// scripts/vna/cog-fold.mjs — C155 THE COG PILL CARRIES THE FORMAL METHODS AND THE RATCHET TO THE DIGNITY PIXEL
// (operator 2026-09-21: "the cog/token graphs are critical for formal methods to optimise thetacog grip" · "add formal methods to
// that pill and explain how we ratchet towards human dignity pixel"). Painted under ⚙️ Tokens per cog's + (the tenth pill, C152),
// after the card's own graphs. Every number is READ off a receipt on disk; an absent receipt prints UNMEASURED with its why and
// never a digit in that slot (C133). No model on the path.
//
// THE RATCHET, in the order the receipts close it:
//   1 THE RULER — the chair's minted cogs (data/vna/cog.ndjson, C93a: minted only with a red witness — a test seen to fail, then
//     pass, by a human's commit). The human's commits ARE the ruler; nothing else on the page is.
//   2 THE PEG — tokens per cog per band (data/vna/cog-peg.json, C93c): a floor that only FALLS. A worker that spends more tokens per
//     cog than the peg is priced against the human's rate; the peg cannot be talked up, only earned down.
//   3 THE PERCENTILE — where the latest minted commit ranks on that ruler (cog-percentile, C119): a rank, never a rate.
//   4 THE PIXEL — data/vna/competence-pixel.json: where the receipted work LANDED (shape: centre of mass, concentration, adjacency,
//     re-runnable from the same files) and the pick ledger (preference: UNDERPOWERED until minPicks). The same receipt that prices an
//     agent's work clears a human into a verified role — by Rice the cache line cannot tell who did the work, so the pixel is
//     operator-agnostic by physics. It is EARNED when the picks reach power, and reads UNMEASURED until then.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTok = (n) => (n == null || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(Math.round(n)));
export const PIXEL_FILE = resolve(REPO, 'data/vna/competence-pixel.json');
export const PIXEL_CMD = 'node scripts/vna/competence-pixel.mjs';

/** the pixel receipt, or { missing: true, why } — never a typed shape */
export function readCompetencePixel(path = PIXEL_FILE) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return j && j.shape ? j : { missing: true, why: 'the receipt carries no shape' }; }
  catch (e) { return { missing: true, why: e.code === 'ENOENT' ? 'no receipt' : String(e.message || e).slice(0, 60) }; }
}

const un = (why) => `<span class="lane un">⚪ UNMEASURED</span> <span class="dim">— ${esc(why)}</span>`;
const line = (k, v, title) => `<span class="c3l dignity" data-k="${k}"${title ? ` title="${esc(title)}"` : ''}><b class="lead">${esc(k)}</b> ${v}</span>`;

/**
 * The four lines of the ratchet, read off the cog reading (d), the percentile (pct) and the pixel receipt. Pure: no disk here — the
 * page hands over what it already read (renderCards reads cog/pct; readCompetencePixel() is the pixel's one reader).
 */
export function renderDignityRatchet({ cog = null, pct = null, pixel = null } = {}) {
  const measured = cog && cog.status === 'measured';
  // 1 the ruler
  const ruler = measured
    ? `${cog.minted} minted of ${cog.rows.length} rows — a cog is minted only against a test seen red, then green (C93a)`
    : un((cog && cog.why) || 'no cog reading');
  // 2 the peg — newest non-legacy band, the floor that only falls
  const bands = measured && cog.peg && cog.peg.bands ? Object.entries(cog.peg.bands).filter(([, v]) => v && v.peg != null).map(([b, v]) => ({ b, ...v, t: Date.parse(v.at || 0) || 0 })) : [];
  const live = bands.filter((x) => !x.legacy).sort((a, b) => b.t - a.t);
  const peg = live.length
    ? `${live.map((x) => `${x.b} ${fmtTok(x.peg)} tok/cog`).join(' · ')} — a floor that only falls; a worker above it is priced against the human's rate`
    : bands.length ? `${bands.length} legacy band${bands.length === 1 ? '' : 's'} only — no comparable peg yet (a row minted before the lattice input)` : un('no peg band');
  // 3 the percentile — a rank on the ruler
  const rank = pct && pct.status === 'measured' && pct.latest
    ? `latest minted commit p${pct.latest.pct} on the chair ruler${pct.runner && pct.runner.n ? ` · runner median p${pct.runner.median_pct} over ${pct.runner.n}` : ' · runner UNMEASURED'} — a rank, never a rate`
    : un((pct && pct.why) || 'no percentile reading');
  // 4 the pixel — where the work landed, and whether the preference ledger has power
  let pix;
  if (!pixel || pixel.missing) pix = `${un((pixel && pixel.why) || 'no receipt')} · <code>${esc(PIXEL_CMD)}</code>`;
  else {
    const sh = pixel.shape || {}; const pk = pixel.picks || {};
    const shape = sh.verdict === 'MEASURED'
      ? `shape MEASURED over ${sh.n} commits · ${sh.coords} coordinates · peak ${esc(sh.peak && sh.peak.coord)} (${sh.peak && sh.peak.sharePct}%) · centroid ${esc(sh.centroid && sh.centroid.coord)}`
      : `shape ${esc(sh.verdict || 'UNMEASURED')}`;
    const picks = pk.verdict === 'MEASURED'
      ? `picks MEASURED (${pk.n})`
      : `picks ${esc(pk.verdict || 'UNMEASURED')}${pk.n != null && pk.minPicks != null ? ` — ${pk.n} of ${pk.minPicks}, ${pk.neededForPower} more before the preference has power` : ''}`;
    pix = `${shape} · ${picks} — the pixel is EARNED when the picks reach power; the same receipt clears a human into a verified role, and the cache line cannot tell who did the work (Rice)`;
  }
  const claims = pixel && !pixel.missing && pixel.claims
    ? `<span class="c3l dim dignity-claims"><b>SUFFICIENT FOR:</b> ${esc(pixel.claims.sufficientFor)} · <b>NOT SUFFICIENT FOR:</b> ${esc(pixel.claims.notSufficientFor)}</span>`
    : '';
  return `<div class="c3l dignity-head"><b>THE RATCHET TO THE DIGNITY PIXEL</b> <span class="dim">— four receipts, closed in order; the human's red-witnessed commits are the ruler, the peg only falls, the rank is on that ruler, the pixel is earned when the preference ledger has power</span></div>`
    + line('1 · the ruler', ruler, 'data/vna/cog.ndjson — C93a')
    + line('2 · the peg', peg, 'data/vna/cog-peg.json — C93c, the floor only falls')
    + line('3 · the rank', rank, 'the cog percentile — C119, a rank never a rate')
    + line('4 · the pixel', pix, 'data/vna/competence-pixel.json — where the receipted work landed, and the pick ledger')
    + claims;
}
