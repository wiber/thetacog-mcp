#!/usr/bin/env node
// scripts/pmu/confidence-overlay.mjs — draw confidence loops on the tolerance map.
//
// The operator's read: on the tolerance panel it's easy to SEE a high-confidence lane —
// a row that's mostly green. So make it explicit: for each row-band, compute the green
// share among its lit cells, and when it clears the threshold (default 80%), draw a loop
// around that band and label it "high confidence". Green = reality landed in the lane the
// intent declared; a majority-green row = that actor stayed in lane across its patients.
//
// Additive: it reads the SHIPPED tolerance panel (renderTriptych → tol.rgba, classified by
// the canonical GREEN/AMBER/RED hues) and lays an SVG overlay on top — no change to the
// renderer. The loops + labels are SVG so they stay crisp and readable.
//
//   npx thetacog-mcp confidence                  # run the pipeline, draw loops on the tolerance map, open HTML
//   npx thetacog-mcp confidence --green 0.8       # confidence threshold (default 0.8)
//   npx thetacog-mcp confidence --intent "…" --reality "…"   # scope to a commit's text

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const OUT = resolve(REPO, 'docs/pmu/confidence-map.html');
const N = 144, BLOCK = 12, BANDS = N / BLOCK; // 12 row-bands of 12 cells
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

// Classify a tolerance-panel pixel by hue (brightness-invariant). Canonical colours:
// GREEN=[30,145,80] AMBER=[255,176,0] RED=[255,59,59] · unlit≈[5,5,5].
function classify(r, g, b) {
  if (Math.max(r, g, b) < 14) return 0;        // unlit
  if (g >= r && g >= b) return 1;              // green: G is the max channel
  return (r > 0 && g / r >= 0.45) ? 2 : 3;     // amber (g/r≈.69) vs red (g/r≈.23)
}

async function main() {
  const { runPipeline } = await import('./pipeline.mjs');
  const { renderTriptych } = await import('./triptych-render.mjs');
  const greenTh = Number(arg('--green', '0.8'));

  let rgba, tol;
  if (has('--demo')) {
    // Synthetic in-lane panel (clearly labelled) so the loop rendering is visible even when
    // the live runs to hand are drift-heavy. Bands 0–5 mostly green, 6–11 mixed/red.
    ({ rgba, tol } = synthPanel());
    console.log('  --demo: synthetic green-majority tolerance map (proves the loop overlay; real in-lane commits look like this).');
  } else {
    const intentText = arg('--intent'); const realityText = arg('--reality');
    console.log('  Running the pipeline for a live tolerance map…');
    const r = await runPipeline(intentText || realityText ? { intentText, realityText, intentLabel: 'intent', realityLabel: 'reality' } : {});
    const w = r.stages?.walk || {}, x = r.stages?.xor || {};
    const t = renderTriptych({ intentB64: w.intent_heatmap_b64, realityB64: w.reality_heatmap_b64, frictionB64: x.friction_bitmap_b64, killTolerancePct: 25, label: 'confidence', sub: 'tolerance map' });
    rgba = t.tol?.rgba; tol = t.tol;
  }
  if (!rgba) { console.error('no tolerance rgba'); process.exit(3); }

  // per row-band: green/amber/red among lit cells → green confidence
  const bands = [];
  for (let band = 0; band < BANDS; band++) {
    let green = 0, amber = 0, red = 0;
    for (let row = band * BLOCK; row < band * BLOCK + BLOCK; row++) {
      for (let col = 0; col < N; col++) {
        const i = row * N + col, o = i * 4;
        const c = classify(rgba[o], rgba[o + 1], rgba[o + 2]);
        if (c === 1) green++; else if (c === 2) amber++; else if (c === 3) red++;
      }
    }
    const lit = green + amber + red;
    const pct = lit ? green / lit : 0;
    bands.push({ band, green, amber, red, lit, pct, confident: lit > 0 && pct >= greenTh });
  }

  const pngUri = await pngDataUri(rgba);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(bands, pngUri, greenTh, tol));

  console.log(`\n  CONFIDENCE LOOPS (green ≥ ${Math.round(greenTh * 100)}% of lit cells in a row-band):`);
  for (const b of bands) if (b.lit) console.log(`    band ${String(b.band).padStart(2)} ${b.confident ? '🟢 HIGH' : '  ·   '} ${Math.round(b.pct * 100)}% green  (${b.green}g/${b.amber}a/${b.red}r of ${b.lit} lit)`);
  const hi = bands.filter((b) => b.confident).length;
  console.log(`\n  ${hi} high-confidence row-band${hi === 1 ? '' : 's'} looped.  →  ${OUT.replace(REPO + '/', '')}`);
  if (!has('--no-open')) spawnSync('open', [OUT]);
}

// Synthetic green-majority tolerance panel — for --demo only. Diagonal green carpet
// (in-lane), a couple of amber/red bleed bands, so the ≥80% loops visibly fire.
function synthPanel() {
  const GREEN = [30, 145, 80], AMBER = [255, 176, 0], RED = [255, 59, 59];
  const rgba = new Uint8Array(N * N * 4);
  let green = 0, amber = 0, red = 0;
  for (let row = 0; row < N; row++) {
    const band = Math.floor(row / BLOCK);
    for (let col = 0; col < N; col++) {
      const i = row * N + col, o = i * 4; rgba[o + 3] = 255;
      // light ~ every 7th cell so bands have a sane lit count
      if ((row * 7 + col) % 7 !== 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 5; continue; }
      let col3, kind;
      if (band <= 5) { kind = (col % 9 === 0) ? 'a' : 'g'; }        // bands 0-5: mostly green
      else if (band <= 8) { kind = (col % 2 === 0) ? 'g' : 'a'; }   // 6-8: mixed (~50%)
      else { kind = (col % 5 === 0) ? 'g' : 'r'; }                  // 9-11: mostly red
      col3 = kind === 'g' ? GREEN : kind === 'a' ? AMBER : RED;
      if (kind === 'g') green++; else if (kind === 'a') amber++; else red++;
      rgba[o] = col3[0]; rgba[o + 1] = col3[1]; rgba[o + 2] = col3[2];
    }
  }
  return { rgba, tol: { green, amber, red, offPct: Math.round(100 * red / (green + amber + red)) } };
}

// minimal RGBA→PNG data URI via the shipped encoder
async function pngDataUri(rgba) {
  const m = await import('./triptych-render.mjs');
  if (m.rgbaToPngDataUri) return m.rgbaToPngDataUri(rgba);
  return 'data:image/png;base64,' + Buffer.from(m.rgbaToPng(rgba)).toString('base64');
}

function render(bands, pngUri, greenTh, tol) {
  const SC = 5, px = N * SC, bh = BLOCK * SC; // scale the 144px map up so loops/labels read
  const loops = bands.filter((b) => b.confident).map((b) => {
    const y = b.band * bh;
    return `<rect x="3" y="${y + 3}" width="${px - 6}" height="${bh - 6}" rx="${bh / 2}" ry="${bh / 2}"
      fill="none" stroke="#46d369" stroke-width="3" />
      <text x="${px - 10}" y="${y + bh / 2 + 4}" text-anchor="end" fill="#46d369" font-family="ui-monospace,Menlo,monospace" font-size="13" font-weight="700">${Math.round(b.pct * 100)}% green · high confidence</text>`;
  }).join('');
  const tbl = bands.filter((b) => b.lit).map((b) => `<tr><td>band ${b.band}</td><td>${Math.round(b.pct * 100)}%</td><td class="dim">${b.green}g / ${b.amber}a / ${b.red}r</td><td>${b.confident ? '<span class="g">🟢 looped</span>' : '<span class="dim">—</span>'}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tolerance map — confidence loops</title><style>
  body{margin:0;background:#070910;color:#e9edf5;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:30px 20px 70px} h1{font-size:24px;margin:0 0 4px}
  .sub{color:#8a94a8;margin-bottom:18px;font-size:14px} .stage{position:relative;width:${N * 5}px;max-width:100%;margin:10px 0}
  .stage img{width:${N * 5}px;max-width:100%;image-rendering:pixelated;border:1px solid #1a2130;border-radius:8px;display:block}
  .stage svg{position:absolute;inset:0;width:${N * 5}px;height:${N * 5}px;max-width:100%;pointer-events:none}
  table{border-collapse:collapse;margin-top:18px;font-size:13.5px} td{padding:5px 12px;border-top:1px solid #1a2130}
  .g{color:#46d369;font-weight:700} .dim{color:#5a6478} code{font-family:ui-monospace,Menlo,monospace;color:#9fe6b0}
</style></head><body><div class="wrap">
  <h1>Tolerance map — confidence loops</h1>
  <div class="sub">Each row-band is circled when ≥ ${Math.round(greenTh * 100)}% of its lit cells are green (reality landed in the declared lane). A looped band = a high-confidence lane you can read at a glance. Panel: ${tol.green}g / ${tol.amber}a / ${tol.red}r, off-lane ${tol.offPct ?? '?'}%.</div>
  <div class="stage"><img src="${pngUri}" alt="tolerance map"><svg viewBox="0 0 ${N * 5} ${N * 5}">${loops}</svg></div>
  <table><tr><td>row-band</td><td>green%</td><td>cells</td><td></td></tr>${tbl}</table>
  <p class="dim" style="margin-top:18px">Additive overlay on the shipped tolerance panel (<code>renderTriptych → tol.rgba</code>), classified by the canonical GREEN/AMBER/RED hues. Fold into the panel renderer when ready.</p>
</div></body></html>`;
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(3); });
