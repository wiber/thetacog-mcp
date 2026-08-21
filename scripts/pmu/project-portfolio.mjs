#!/usr/bin/env node
// scripts/pmu/project-portfolio.mjs — THE PROJECT ALTITUDE (the missing third receipt).
//
// The insurability signals fire on-PROMPT (the lens receipt) and on-COMMIT (the triptych email), but
// never at the PROJECT level — the underwriter's actual view. This rolls the whole repo up into ONE
// portfolio panel, scale-invariant with the commit receipt: the SAME encircled-tolerance-panel +
// reef-named coordinates + σ + breach, aggregated across every commit and every prompt. LLM-free,
// deterministic — a pure function of the two ledgers, exactly like the on-chip receipt.
//
// TWO LEDGERS (the running code — never re-render each commit):
//   • data/pmu/measure-history.ndjson  — per-COMMIT σ/offPct → portfolio σ + BREACH (the loss ratio)
//   • .thetacog/lens-receipts/*.json   — per-PROMPT placed pixel + σ → the whole-repo DRIFT MAP
//
// The MAP: every prompt's placement is binned to its ShortLex block, coloured by the block's mean σ
// (green in-lane · amber bleed · red drift), then run through the ONE region pipeline (detectRegions →
// encircle → expandCoordName) so the project's hot regions are encircled and named by problem space:
// "the project concentrates in B1 Tactics.Speed → blog-content, drifts in A3 → comms-email."
//
//   node scripts/pmu/project-portfolio.mjs            # write docs/pmu/project-portfolio.html + print stats
//   node scripts/pmu/project-portfolio.mjs --json     # machine-readable rollup
// @guard tests/pmu-simulator/project-portfolio.test.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectRegions } from './regions-chip.mjs';
import { encircleRegionsPng } from './annotate-regions.mjs';
import { expandCoordName } from './reef-coord-name.mjs';
import { shortLexToBlock } from './shortlex-coords.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HISTORY = resolve(REPO, 'data/pmu/measure-history.ndjson');
const RECEIPTS = resolve(REPO, '.thetacog/lens-receipts');
const OUT = resolve(REPO, 'docs/pmu/project-portfolio.html');
const N = 144, B = 12, NB = 12;
const JSON_OUT = process.argv.includes('--json');
const BREACH_OFF = 15;                 // offPct > this = a breached commit (the raw drift indicator)
// σ bands, calibrated to the receipt distribution (median 1.37, p75 1.73): in-lane · bleed · drift.
const SIG_GREEN = 1.5, SIG_AMBER = 2.5;
const G = [30, 145, 80], A = [255, 176, 0], R = [255, 59, 59];

// ── 1. per-COMMIT portfolio stats (the loss ratio the underwriter prices) ─────────────────────────
function portfolioStats() {
  if (!existsSync(HISTORY)) return { n: 0, breachPct: 0, meanSigma: 0, docsOnlyPct: 0 };
  const H = readFileSync(HISTORY, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const n = H.length || 1;
  const breach = H.filter((h) => (h.offPct || 0) > BREACH_OFF).length;
  const sig = H.map((h) => Number(h.sigmaDrift) || 0).filter((x) => x < 50);   // drop σ outliers for the mean
  const meanSigma = sig.length ? sig.reduce((a, b) => a + b, 0) / sig.length : 0;
  const docsOnly = H.filter((h) => h.docsOnly).length;
  return { n: H.length, breachPct: +(100 * breach / n).toFixed(1), meanSigma: +meanSigma.toFixed(2), docsOnlyPct: +(100 * docsOnly / n).toFixed(1) };
}

// ── 2. per-PROMPT drift MAP: bin 2.4k receipts to blocks, colour by mean σ ─────────────────────────
function driftMap() {
  const per = new Map();  // "br,bc" → { sum, count }
  let placed = 0;
  if (existsSync(RECEIPTS)) {
    for (const f of readdirSync(RECEIPTS)) {
      if (!f.endsWith('.json')) continue;
      let d; try { d = JSON.parse(readFileSync(resolve(RECEIPTS, f), 'utf8')); } catch { continue; }
      if (!d.pixel || typeof d.sigma !== 'number' || !(d.sigma < 50)) continue;   // need a placed pixel + sane σ
      const { br, bc } = shortLexToBlock(d.pixel);
      if (!Number.isFinite(br) || !Number.isFinite(bc) || br < 0 || bc < 0) continue;
      const k = `${br},${bc}`; const e = per.get(k) || { sum: 0, count: 0 }; e.sum += d.sigma; e.count++; per.set(k, e);
      placed++;
    }
  }
  // paint the 144×144 rgba: each block with receipts → solid G/A/R by its mean σ.
  const rgba = new Uint8Array(N * N * 4);
  for (const [k, e] of per) {
    const [br, bc] = k.split(',').map(Number);
    const mean = e.sum / e.count;
    const col = mean <= SIG_GREEN ? G : mean <= SIG_AMBER ? A : R;
    for (let r = br * B; r < br * B + B; r++) for (let c = bc * B; c < bc * B + B; c++) {
      const o = (r * N + c) * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
  }
  return { rgba, placed, blocks: per.size, per };
}

export function computePortfolio() {
  const stats = portfolioStats();
  const map = driftMap();
  const regions = detectRegions(map.rgba).map((r) => ({
    kind: r.kind, coord: r.coord.label, blocks: r.blocks,
    name: (r.reef && r.reef.name) || r.coord.label, domain: r.reef && r.reef.domain, guessed: r.reef && r.reef.guessed,
  }));
  const drift = regions.filter((r) => r.kind !== 1);
  return { stats, map: { placed: map.placed, blocks: map.blocks, rgba: map.rgba }, regions, drift };
}

function render(p) {
  const KCOL = { 1: '#2ecf6f', 2: '#ffb000', 3: '#ff3b3b' }, KNM = { 1: 'in-lane', 2: 'bleed', 3: 'drift' };
  const png = encircleRegionsPng(p.map.rgba, detectRegions(p.map.rgba), { scale: 4 });
  const uri = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  const rows = p.regions.map((r) => `<div style="font-size:12px;color:#8b98a5;margin:3px 0"><b style="color:${KCOL[r.kind]}">${KNM[r.kind]}</b> &middot; <code style="color:#c9d1d9">${r.coord}</code> &middot; <b style="color:#b8c2cc">${r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b> &middot; ${r.blocks} blk</div>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Project portfolio — insurability rollup</title>
<div style="max-width:820px;margin:0 auto;padding:28px 20px;background:#070910;color:#e9edf5;font:15px/1.55 -apple-system,sans-serif">
<h1 style="font-size:22px;margin:0 0 2px">Project portfolio &mdash; the insurability rollup</h1>
<div style="color:#8a94a8;font-size:13px;margin-bottom:16px">The whole repo at project altitude &mdash; LLM-free, deterministic, the SAME encircled-tolerance-panel + reef-named coordinates as the commit receipt, aggregated across ${p.stats.n} commits &amp; ${p.map.placed} placements.</div>
<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px">
  <div style="background:#0e131e;border:1px solid #1a2130;border-radius:8px;padding:12px 16px"><div style="font-size:11px;color:#8a94a8;letter-spacing:.1em">BREACH RATE (loss ratio)</div><div style="font-size:24px;font-weight:700;color:${p.stats.breachPct > 50 ? '#ff3b3b' : p.stats.breachPct > 25 ? '#ffb000' : '#2ecf6f'}">${p.stats.breachPct}%</div><div style="font-size:11px;color:#5a6478">${p.stats.n} commits, offPct&gt;${BREACH_OFF}</div></div>
  <div style="background:#0e131e;border:1px solid #1a2130;border-radius:8px;padding:12px 16px"><div style="font-size:11px;color:#8a94a8;letter-spacing:.1em">MEAN σ (placement)</div><div style="font-size:24px;font-weight:700;color:#c9d1d9">${p.stats.meanSigma}</div><div style="font-size:11px;color:#5a6478">docs-only ${p.stats.docsOnlyPct}%</div></div>
  <div style="background:#0e131e;border:1px solid #1a2130;border-radius:8px;padding:12px 16px"><div style="font-size:11px;color:#8a94a8;letter-spacing:.1em">DRIFT REGIONS</div><div style="font-size:24px;font-weight:700;color:#ffb000">${p.drift.length}</div><div style="font-size:11px;color:#5a6478">${p.map.blocks} of 144 blocks worked</div></div>
</div>
<img src="${uri}" width="576" style="image-rendering:pixelated;border:1px solid #1a2130;border-radius:8px;max-width:100%;display:block;margin-bottom:6px">
<div style="font-size:12px;color:#8a94a8;margin-bottom:14px">🟢 in-lane (mean σ &le; ${SIG_GREEN}) · 🟡 bleed · 🔴 drift (mean σ &gt; ${SIG_AMBER}) &mdash; where the project's cognition lands, by ShortLex coordinate, named by the reef's problem space.</div>
<div style="font-weight:700;color:#e0a020;font-size:13px;margin-bottom:4px">&#9678; WHERE THE PROJECT WORKS &amp; DRIFTS &mdash; encircled &amp; reef-named</div>
${rows}
</div>`;
}

const p = computePortfolio();
if (JSON_OUT) {
  console.log(JSON.stringify({ stats: p.stats, placed: p.map.placed, blocks: p.map.blocks, regions: p.regions }, null, 2));
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(p));
  console.log(`PROJECT PORTFOLIO — ${p.stats.n} commits · breach ${p.stats.breachPct}% · mean σ ${p.stats.meanSigma} · ${p.map.placed} placements over ${p.map.blocks}/144 blocks`);
  console.log(`  drift regions (${p.drift.length}):`);
  for (const r of p.drift.slice(0, 8)) console.log(`    ${['', '🟢', '🟡', '🔴'][r.kind]} ${r.coord} → ${r.name} (${r.blocks} blk)`);
  console.log(`  → ${OUT}`);
}
