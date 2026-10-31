#!/usr/bin/env node
// scripts/pmu/spec-deliver-walk.mjs — THE DELEGATION DRIFT RECEIPT, measured by the REAL WALK.
// =============================================================================
// bf-004 (laboratory, delegated by operator). The sibling spec-deliver-attest.mjs measures
// per-requirement PLACEMENT (gzip-NCD placePixel → which requirement the work lands on). That
// answers "did the room build R-n?". This script answers the DIFFERENT, harder question the
// delegation actually asks: "did the delivered work cohere with the SHAPE of the spec's intent?"
// — and it answers it with the one method the HARD RULE mandates:
//
//   THE REAL RECURSIVE ON-CHIP BALLISTIC WALK (CLAUDE.md · "PMU / COMPETENCE WALK").
//   intent = the author's reef (the requirements' full prose) · reality = the room's delivered work.
//   Project both onto the 144 ShortLex lattice (--sense), pick the intent CONFIDENCE PIXEL, and run
//   the real recursive `pmu-onchip --ballistic` walk (definerWalk144: row → significant column →
//   TRANSPOSE → recurse, one chip process per hop) to PAINT THE INTENT SHAPE. σ = the share of the
//   delivered-work mass that landed INSIDE that shape. NEVER the analytic shortcut — not placePixel
//   placement, not --walk converged/diffusion, not a JS BFS, not Monte-Carlo-as-the-walk. Speed is
//   the correctness tell (~tens of ms on chip, never the ~21s LLM path). The moment this regresses to
//   "the normal way" the whole differentiator is gone (operator, Jun 9).
//
// A↔B SIGNING (R2): the reef is sealed by the AUTHOR identity (actor = the room that wrote the spec);
// this receipt is sealed by the ROOM identity (patient = the room that delivered). Two distinct
// ed25519 keys; both halves root under one attestation_root an underwriter pins. R4 output = a signed
// receipt with σ + verdict + the INTENT/REALITY/DELTA triptych (the tolerance made visible).
//
// Usage:
//   node scripts/pmu/spec-deliver-walk.mjs --reef data/pmu/reef/spec-reef-<id>.json \
//        --deliverables <manifest.json> [--room builder] [--floor 0.30] [--tolerance 15]
//   node scripts/pmu/spec-deliver-walk.mjs --demo                  # the real bf-002 A↔B case (R5)
//   node scripts/pmu/spec-deliver-walk.mjs --check [--receipt <path>]   # recompute the walk (R4)
//
// deliverables manifest = { "room": "builder", "items": { "R1": {"file"|"text": ...}, ... } }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// THE ONE DRIFT ENGINE — the walk, the gzip-NCD seed/litScores projection, and the walk knobs are
// imported from the shared core (src/lib/pmu/unified-drift.mjs) so the COMMIT GATE and the CHAT RECEIPT
// are byte-for-byte the same machinery. NEVER a second walk implementation here.
import { walkShape, shapeCoverage, litScores, topSeeds, norm, confidencePixel, ncdSim, gzipLen, targets, COORDS, WALK_OPTS } from '../../src/lib/pmu/unified-drift.mjs';
import { sealReceiptAs, actorIdentity, attestationRoot, verifyReceipt, sha256Hex } from './receipt-crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DAEMON = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');
const LIB144 = resolve(REPO_ROOT, 'data/pmu/snippet-library-144.json');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

// The real bf-002 cross-room case is the canonical demo (R5): operator(intent) → builder(reality).
const DEMO_REEF = resolve(REPO_ROOT, 'data/pmu/reef/spec-reef-npx-underwriter-package.json');
const DEMO_DELIVER = resolve(REPO_ROOT, 'data/pmu/reef/spec-deliver-bf-002.json');
const RECEIPT_OUT = resolve(REPO_ROOT, 'docs/pmu/spec-deliver-walk-receipt.json');

const AXIS_NAME = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Law', A2: 'Goal', A3: 'Fund', B1: 'Speed', B2: 'Deal', B3: 'Signal', C1: 'Grid', C2: 'Loop', C3: 'Flow' };

// The walk knobs (WALK_OPTS), the deterministic seed selector (topSeeds/SEED_K), the 144 snippet
// targets, and the gzip-NCD sensor (litScores/ncdSim/gzipLen/confidencePixel/norm) now ALL live in the
// ONE drift engine (src/lib/pmu/unified-drift.mjs) and are imported above — so the commit gate and the
// chat receipt run the SAME walk, with the SAME knobs, over the SAME projection (byte-identical σ).
// Calibrated against bf-002: a real delivery covers ~67% of the intent shape, an off-topic one ~40%;
// tests/lens/pipeline-unity.test.js pins that the two paths share one engine.
const payloads = targets;   // the same 144 target array (firstSent reads it for the triptych dumps)
const blockOf = i => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3); // 0..15
const firstSent = i => (String(payloads[i] || COORDS[i]).split(/(?<=[.!?])\s/)[0] || COORDS[i] || '').slice(0, 110);

function loadDeliverable(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (item.text != null) return String(item.text);
  if (item.file) return readFileSync(resolve(REPO_ROOT, item.file), 'utf8');
  return '';
}

// ── THE WALK — intent shape painted by the real on-chip ballistic walk, σ = reality mass inside it ──
// budgetMs is set huge so the DETERMINISTIC hop budget (not wall-clock) terminates the walk — required
// for a byte-stable σ on recompute (R4). The walk itself is the real recursive `pmu-onchip --ballistic`
// (definerWalk144), never an analytic stand-in.
async function runWalk(reef, manifest, { floor, tolerance }) {
  const intentText = reef.anchors.map(a => a.snippet || `${a.title}. ${a.prose || ''}`).join('\n\n');
  const items = manifest.items || {};
  const realityText = Object.values(items).map(loadDeliverable).join('\n\n');

  const intentScores = litScores(intentText);
  const realityScores = litScores(realityText);
  const startPixel = confidencePixel(intentScores);
  if (startPixel < 0) throw new Error('intent projected onto no anchor — the spec reef is empty');

  // ── PER-REQUIREMENT COVERAGE — SPEC-UNIVERSE, BACKGROUND-RELATIVE (2026-06-24) ──
  // σ (shape-match) is PLACEMENT confidence: how vocabulary-dense / well-placed the delivery is on the
  // intent shape. It is NOT low risk. The honest, orthogonal signal is COVERAGE: of the spec's
  // requirements, how many did the delivery actually COVER? The SENSING UNIVERSE is the SPEC's OWN reef
  // anchors (the requirements' vocabulary) — NEVER the stock 144 generic-business library. The work
  // product is graded against the plumbing requirements' own words.
  //
  // THE BUG THIS FIXES (2026-06-24): a fixed absolute floor (0.18) sat BELOW the ~0.20–0.27 generic-English
  // gzip-NCD background — so an OFF-DOMAIN deliverable (cardiac surgery) cleared the floor on every plumbing
  // requirement and falsely read "covered 100% / COHERENT". Diagnostic: surgery vs a plumbing anchor ≈ 0.20
  // (background), real plumbing work ≈ 0.35 (real signal) — the signal was there, the absolute floor destroyed
  // it. FIX = BACKGROUND-RELATIVE: a requirement is COVERED only if the work's gzip-NCD on that anchor
  // meaningfully EXCEEDS the score a neutral/off-domain text gets on the SAME anchor. We compute a per-anchor
  // background from a fixed neutral paragraph (deterministic) AND floor it at the cross-anchor median, then
  // require signal = work_score − background ≥ COVERAGE_MARGIN. Compliant plumbing clears it (+0.05..+0.11 on
  // every anchor → 100%); surgery sits AT/BELOW background (−0.03..−0.07 → 0%). Deterministic, gzip-NCD only.
  const NEUTRAL_BG = 'The weather this afternoon turned overcast and a light breeze moved through the trees while several people walked along the riverside path discussing the upcoming municipal election and the price of groceries.';
  const COVERAGE_MARGIN = 0.03;  // signal a real on-topic delivery clears; off-domain prose sits at/below 0
  const bgZ = gzipLen(NEUTRAL_BG);
  // SIZE-ROBUST sensing: score each requirement against the BEST-matching individual delivery item (the
  // per-item max), NOT the concatenated reality blob. gzip-NCD of (big concatenated blob, one short anchor)
  // is diluted by the blob's unrelated mass, so a multi-item delivery would falsely read below the
  // single-short-paragraph background. Per-item max makes the work-vs-anchor score comparable to the
  // background (single short neutral text vs the same anchor) — the fair, size-independent comparison.
  const deliveryItems = Object.values(items).map(loadDeliverable).filter(t => t && t.trim());
  const itemZ = deliveryItems.map(t => gzipLen(t));
  const reqEntries = (reef.anchors || []).map((a, i) => {
    const reqText = a.snippet || `${a.title || ''}. ${a.prose || ''}`;
    const reqZ = reqText ? gzipLen(reqText) : 0;
    let sim = 0;
    if (reqText) for (let k = 0; k < deliveryItems.length; k++) sim = Math.max(sim, ncdSim(itemZ[k], deliveryItems[k], reqText, reqZ));
    const bg = reqText ? ncdSim(bgZ, NEUTRAL_BG, reqText, reqZ) : 0;
    return { coord: a.coord || a.id || `R${i + 1}`, title: a.title || '', sim, bg };
  });
  // floor the per-anchor background at the cross-anchor background median — guards a single anchor whose
  // neutral baseline happens to read low. The COVERED test is signal ABOVE this robust background.
  const bgSorted = reqEntries.map(e => e.bg).sort((x, y) => x - y);
  const bgMedian = bgSorted.length ? bgSorted[Math.floor(bgSorted.length / 2)] : 0;
  const requirements = reqEntries.map(e => {
    const background = Math.max(e.bg, bgMedian);
    const signal = e.sim - background;
    const covered = signal >= COVERAGE_MARGIN;
    return {
      req: e.coord, title: e.title,
      sim: +e.sim.toFixed(4), background: +background.toFixed(4), signal: +signal.toFixed(4),
      verdict: covered ? 'COVERED' : 'UNCOVERED',
    };
  });
  const coveredCount = requirements.filter(r => r.verdict === 'COVERED').length;
  const reqTotal = requirements.length;
  // coverage = fraction of requirements the delivery actually covered (0..1); null when there are no
  // enumerable requirements (then existing σ-only behaviour is unchanged — we never invent a signal).
  const coverage = reqTotal ? +(coveredCount / reqTotal).toFixed(4) : null;

  // TWO REAL BALLISTIC WALKS, both ON CHIP — now via the ONE drift engine (walkShape: the SAME
  // definerWalk144 / pmu-onchip --ballistic, the SAME WALK_OPTS, the SAME topSeeds the chat receipt
  // runs). timeoutMs:0 → no wall-clock race here: the commit gate completes deterministically, so σ is
  // byte-stable on recompute. We hand walkShape the already-computed gzip-NCD projection (scores) so it
  // is not recomputed. intent's shape = the spec's competence; reality's shape = the delivery's. The
  // empty-delivery case (no seeds) reuses the intent walk — identical to the prior behaviour.
  const intent = await walkShape(intentText, { floor, scores: intentScores, timeoutMs: 0 });
  const reality0 = await walkShape(realityText, { floor, scores: realityScores, timeoutMs: 0 });
  const reality = reality0.seed.length ? reality0 : intent;
  const intentHeat = intent.heat;
  const realityWalkHeat = reality.heat;
  const insideSet = intent.shape;
  const realitySet = reality.shape;

  // σ = SHAPE COVER: the fraction of the delivery's shape that falls INSIDE the spec's intent shape —
  // "how much of what the room built lands on what the spec asked for." NOT mass over the diffuse
  // background (that washes out to |shape|/144); the two TIGHT walked shapes are what discriminates.
  // shapeCoverage IS the commit gate's σ, lifted verbatim into the shared engine.
  const sigma_shape_match_pct = shapeCoverage(insideSet, realitySet);

  // dominant blocks of the intent shape → off-shape = delivery-shape anchors in ORTHOGONAL blocks
  // (block-distance ≥ 2). A few is acceptable bleed; a concentration past tolerance is the alarm.
  const shapeBlockHeat = new Array(16).fill(0);
  for (const i of insideSet) shapeBlockHeat[blockOf(i)] += intentHeat[i];
  const blockTotal = shapeBlockHeat.reduce((a, b) => a + b, 0) || 1;
  const rankedBlocks = [...shapeBlockHeat.keys()].filter(b => shapeBlockHeat[b] > 0).sort((a, b) => shapeBlockHeat[b] - shapeBlockHeat[a]);
  const domBlocks = []; let acc = 0;
  for (const b of rankedBlocks) { domBlocks.push(b); acc += shapeBlockHeat[b]; if (domBlocks.length >= 2 && acc / blockTotal >= 0.70) break; if (domBlocks.length >= 4) break; }
  if (!domBlocks.length && startPixel >= 0) domBlocks.push(blockOf(startPixel));
  const blockDist = b => { const br = Math.floor(b / 4), bc = b % 4; let m = Infinity; for (const d of domBlocks) { const dr = Math.floor(d / 4), dc = d % 4; m = Math.min(m, Math.max(Math.abs(br - dr), Math.abs(bc - dc))); } return Number.isFinite(m) ? m : 9; };

  let killCount = 0; const outside = [];
  for (const i of realitySet) {
    if (insideSet.has(i)) continue;
    if (blockDist(blockOf(i)) >= 2) { killCount++; outside.push({ coord: COORDS[i], heat: +realityWalkHeat[i].toFixed(4), first: firstSent(i) }); }
  }
  const kill_pct = realitySet.size ? Math.round(100 * killCount / realitySet.size) : 0;
  outside.sort((a, b) => b.heat - a.heat);

  const inside = [...insideSet].sort((a, b) => intentHeat[b] - intentHeat[a]).slice(0, 6)
    .map(i => ({ coord: COORDS[i], heat: +intentHeat[i].toFixed(4), first: firstSent(i) }));
  const realityHeat = norm(realityScores);   // the selective projection, for the REALITY triptych panel

  // verdict: COHERENT = the delivery's shape mostly lands on the spec's (cover ≥ 55%) and isn't
  // concentrated off-shape; OFF_SPEC = the delivery built mostly elsewhere (cover < 45% or off-shape
  // past tolerance); DRIFT = the partial-coherence band between. Thresholds calibrated on bf-002.
  //
  // COVERAGE OVERRIDE (2026-06-24): the σ shape-match is computed on the stock-144 lattice projection,
  // where an OFF-DOMAIN deliverable sits at the generic-English background and σ is meaningless noise.
  // The SPEC-UNIVERSE background-relative coverage is the honest, content-discriminating signal: if the
  // delivery covered (near-)NONE of the spec's own requirements above background, it is OFF_SPEC /
  // UNINSURABLE regardless of what σ reads. A genuinely on-spec delivery clears coverage AND σ.
  const errorTooMuch = kill_pct > tolerance;
  const COVERAGE_OFF_SPEC = 0.34;   // < ~a third of requirements cleared background ⇒ off-domain work
  const COVERAGE_COHERENT = 0.80;   // cleared ≥ 80% of requirements above background ⇒ on-spec
  let verdict;
  if (coverage !== null && coverage <= COVERAGE_OFF_SPEC) {
    verdict = 'OFF_SPEC';                                    // covered (near-)nothing of the spec — off-domain
  } else if (coverage !== null && coverage >= COVERAGE_COHERENT && !errorTooMuch) {
    verdict = 'COHERENT';                                   // covered the spec's own requirements above background
  } else if ((sigma_shape_match_pct < 45 || errorTooMuch)) {
    verdict = 'OFF_SPEC';
  } else {
    verdict = sigma_shape_match_pct >= 55 ? 'COHERENT' : 'DRIFT';
  }

  // ── INSURABILITY BOUNDARY (2026-06-24) — every delegation receipt carries the decidable line ──
  // The receipt is not just a drift report; it is an INSURABILITY instrument the hook emits locally.
  // We insure the DECIDABLE boundary (domain membership / WHERE) — never the undecidable interior
  // (within-domain quality, relation, polarity / WHETHER — that is the LLM's job). Coverage is the
  // decidable, hard-to-fool signal (you cannot keyword-stuff your way in; gzip-NCD reads structure).
  const insurability = {
    boundary: 'WHERE (domain membership) = decidable, recomputable, hard-to-fool · NOT WHETHER (within-domain quality) = undecidable, the LLM\'s job',
    insured_peril: 'domain-departure',
    decidable: true,
    basis_risk: 'low — the trigger IS the peril (we measure domain membership, not a proxy)',
    foolable: 'hard — gzip-NCD reads structure, not keywords; off-domain prose with keywords jammed in still does not compress like the domain',
    coverage,
    status: verdict === 'OFF_SPEC'
      ? 'PERIL FIRED — the delivery LEFT the spec\'s competence domain (insured event · decidable · signed · recomputable)'
      : verdict === 'COHERENT'
        ? 'IN-DOMAIN — within the insured competence; within-domain correctness (incl. relation/polarity) is NOT insured (undecidable, the LLM\'s job)'
        : 'BOUNDARY — partial domain coverage; the decidable signal is weak here, route to review',
  };

  return {
    startPixel, startCoord: COORDS[startPixel], seedCount: intent.seed.length,
    max_ply: intent.plies, hops: intent.hops,
    sigma_shape_match_pct, kill_pct, verdict, errorTooMuch,
    coverage, covered: coveredCount, requirements_total: reqTotal, requirements,
    insurability,
    inside: inside.slice(0, 6), outside: outside.slice(0, 6),
    domBlocks,
    intentHeat, realityHeat, realityWalkHeat,
    insideSet,
  };
}

// ── R4 TRIPTYCH — INTENT(cyan) / REALITY(amber) / DELTA(red), 144 anchors, 4×4 blocks of 3×3 ──
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function panel(heat, hue) {
  const tone = (v) => {
    if (v < 0.06) return '#0d1220';
    if (hue === 'cyan') return `rgb(${Math.round(13 + 40 * v)},${Math.round(40 + 200 * v)},${Math.round(70 + 180 * v)})`;
    if (hue === 'amber') return `rgb(${Math.round(60 + 190 * v)},${Math.round(45 + 150 * v)},20)`;
    return `rgb(${Math.round(120 + 135 * v)},${Math.round(20 + 20 * v)},${Math.round(20 + 30 * v)})`; // red (delta)
  };
  let h = '<div class="blocks">';
  for (let br = 0; br < 4; br++) for (let bc = 0; bc < 4; bc++) {
    h += '<div class="block">';
    for (let wr = 0; wr < 3; wr++) for (let wc = 0; wc < 3; wc++) {
      const i = (br * 3 + wr) * 12 + (bc * 3 + wc); const v = Math.max(0, Math.min(1, heat[i] || 0));
      const [r, c] = (COORDS[i] || 'A,A').split(',');
      h += `<i style="background:${tone(v)}" title="${esc(COORDS[i])}  ${esc(AXIS_NAME[r] || r)}→${esc(AXIS_NAME[c] || c)}  ${v.toFixed(2)}"></i>`;
    }
    h += '</div>';
  }
  return h + '</div>';
}
function renderTriptych(w, reef, room) {
  const delta = w.intentHeat.map((iv, i) => Math.abs(iv - w.realityWalkHeat[i]));
  const dmax = Math.max(...delta) || 1; const deltaN = delta.map(d => d / dmax);
  const vcol = w.verdict === 'COHERENT' ? '#16a34a' : w.verdict === 'DRIFT' ? '#d4a017' : '#dc2626';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spec→delivery drift · ${esc(reef.spec_id)} · ${esc(reef.from_room)}→${esc(room)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#05070d;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;line-height:1.5;padding:1.6em 1.2em}.wrap{max-width:880px;margin:0 auto}
.kicker{font-family:ui-monospace,monospace;font-size:.7em;letter-spacing:.2em;color:#45a29e;text-transform:uppercase}h1{font-size:1.35em;color:#66fcf1;margin:.1em 0}
.verdict{display:inline-block;font-weight:700;padding:.15em .6em;border-radius:5px;color:#05070d;background:${vcol}}
.maps{display:flex;gap:1.4em;flex-wrap:wrap;align-items:flex-start;margin:1.1em 0}.col h3{font-size:.68em;color:#8b98a5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5em}
.blocks{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr);gap:5px;width:240px;height:240px}
.block{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:2px}.block i{display:block;border-radius:2px;cursor:crosshair}
.legend{font-family:ui-monospace,monospace;font-size:.7em;color:#8b98a5;margin:.5em 0}
.dump{background:#0b0f17;border-radius:6px;padding:.8em 1.1em;margin:1em 0;font-size:.8em}.dump h3{font-size:.68em;color:#45a29e;text-transform:uppercase;margin-bottom:.5em}.dump .t{border-bottom:1px solid #161d2b;padding:4px 0}.dump code{color:#fcd34d}
.foot{font-size:.75em;color:#5a6673;margin-top:1.4em;border-top:1px solid #1a2230;padding-top:.7em}
</style></head><body><div class="wrap">
<div class="kicker">Spec→delivery drift · the real on-chip ballistic walk · ${esc(reef.spec_id)}</div>
<h1>${esc(reef.from_room)} <span style="color:#5a6673">(intent)</span> → ${esc(room)} <span style="color:#5a6673">(delivered work)</span></h1>
<p style="margin:.4em 0"><span class="verdict">${esc(w.verdict)}</span> &nbsp; σ shape-match <b style="color:${vcol}">${w.sigma_shape_match_pct}%</b> · off-shape ${w.kill_pct}% · confidence pixel <code style="color:#fcd34d">${esc(w.startCoord)}</code> · walk reached ply <b>${w.max_ply}</b> (${w.hops} hops)</p>
${w.insurability ? `<div style="background:#0b0f17;border-left:3px solid ${vcol};border-radius:5px;padding:.7em 1em;margin:.6em 0;font-size:.82em"><b style="color:#66fcf1;letter-spacing:.08em">INSURABILITY</b> &nbsp;${esc(w.insurability.status)}<br><span style="color:#8b98a5;font-size:.9em">${esc(w.insurability.boundary)}</span></div>` : ''}
<div class="maps">
 <div class="col"><h3>① INTENT — the spec shape (cyan)</h3>${panel(w.intentHeat, 'cyan')}<div class="legend">painted from pixel ${esc(w.startCoord)} by the real recursive walk</div></div>
 <div class="col"><h3>② REALITY — delivered work (amber)</h3>${panel(w.realityHeat, 'amber')}<div class="legend">where the delivered work projects on the 144</div></div>
 <div class="col"><h3>③ DELTA — |intent − reality| (red)</h3>${panel(deltaN, 'red')}<div class="legend">the drift: bright = the spec asked, the work didn't land (or vice-versa)</div></div>
</div>
<div class="dump" style="border-left:3px solid #16a34a"><h3>INSIDE the intent shape — the work landed in the competence the spec means</h3>
 ${w.inside.map(x => `<div class="t"><code>${esc(x.coord)}</code> <span style="color:#7fd17f">${x.heat.toFixed(2)}</span> ${esc(x.first)}…</div>`).join('') || '<div>(reef reached nothing — sparse intent)</div>'}</div>
<div class="dump" style="border-left:3px solid #dc2626"><h3>OFF-SHAPE — delivered work landed in an orthogonal area (drift)</h3>
 ${w.outside.map(x => `<div class="t"><code>${esc(x.coord)}</code> <span style="color:#ff9b9b">${x.heat.toFixed(2)}</span> ${esc(x.first)}…</div>`).join('') || '<div style="color:#16a34a">(none past tolerance — the work stayed on the spec shape)</div>'}</div>
<p class="foot">The REAL recursive on-chip ballistic walk (pmu-onchip --ballistic, definerWalk144: row → significant column → transpose → recurse) — NEVER placePixel placement, --walk converged/diffusion, a JS BFS, or Monte-Carlo-as-the-walk. intent = the author's reef, reality = the delivered work. σ = the share of delivered-work mass inside the intent shape. Guarded by tests/pmu-simulator/competence-walk-is-real.test.mjs and tests/pmu-simulator/spec-deliver-walk-is-real.test.mjs.</p>
</div></body></html>`;
}

// ── SPEC-UNIVERSE TOLERANCE PANEL — green/red per spec requirement, background-relative ──
// The sensing universe is the SPEC's OWN anchors (NOT the stock 144). INTENT = every spec requirement
// (all lit — the spec asked for all of them). REALITY = the requirements the delivery COVERED above
// background. DELTA = the uncovered requirements (red = the spec asked, the work did not deliver above
// the off-domain noise floor). Off-domain work (surgery) covers nothing → the DELTA panel is all RED.
function renderSpecUniversePanel(w, reef, room) {
  const reqs = w.requirements || [];
  const covered = reqs.filter(r => r.verdict === 'COVERED').length;
  const total = reqs.length || 1;
  const covPct = Math.round(100 * covered / total);
  const vcol = w.verdict === 'COHERENT' ? '#16a34a' : w.verdict === 'DRIFT' ? '#d4a017' : '#dc2626';
  // per-requirement intensity from the background-relative SIGNAL (clamped 0..1 over a 0.20 signal span)
  const sigTone = (sig, on) => {
    if (!on) return '#0d1220';
    const v = Math.max(0, Math.min(1, sig / 0.20));
    return `rgb(${Math.round(13 + 40 * v)},${Math.round(60 + 180 * v)},${Math.round(50 + 90 * v)})`; // green ramp
  };
  const redTone = (uncovered) => uncovered ? 'rgb(200,40,40)' : '#0d1220';
  const tile = (label, body) => `<div class="tcol"><h3>${label}</h3><div class="trow">${body}</div></div>`;
  const cell = (r, bg, label) => `<div class="cell" style="background:${bg}" title="${esc(r.req)} · sim ${r.sim} − bg ${r.background} = signal ${r.signal} · ${esc(r.verdict)}"><b>${esc(r.req)}</b><span>${esc(label)}</span></div>`;
  const intentCells = reqs.map(r => cell(r, 'rgb(40,160,200)', 'asked')).join('');                       // all lit (cyan)
  const realityCells = reqs.map(r => cell(r, sigTone(r.signal, r.verdict === 'COVERED'), r.verdict === 'COVERED' ? 'covered' : '—')).join('');
  const deltaCells = reqs.map(r => cell(r, redTone(r.verdict !== 'COVERED'), r.verdict === 'COVERED' ? 'ok' : 'MISSING')).join('');
  const rows = reqs.map(r => `<div class="rrow"><code>${esc(r.req)}</code> <span class="${r.verdict === 'COVERED' ? 'ok' : 'bad'}">${esc(r.verdict)}</span> <span class="num">sim ${r.sim} − bg ${r.background} = <b>${r.signal >= 0 ? '+' : ''}${r.signal}</b></span> <span class="ttl">${esc(r.title)}</span></div>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spec-universe tolerance · ${esc(reef.spec_id)} · ${esc(reef.from_room)}→${esc(room)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#05070d;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif;line-height:1.5;padding:1.6em 1.2em}.wrap{max-width:880px;margin:0 auto}
.kicker{font-family:ui-monospace,monospace;font-size:.7em;letter-spacing:.2em;color:#45a29e;text-transform:uppercase}h1{font-size:1.3em;color:#66fcf1;margin:.1em 0}
.verdict{display:inline-block;font-weight:700;padding:.15em .6em;border-radius:5px;color:#05070d;background:${vcol}}
.maps{display:flex;gap:1.2em;flex-wrap:wrap;align-items:flex-start;margin:1.1em 0}.tcol h3{font-size:.66em;color:#8b98a5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5em}
.trow{display:flex;flex-direction:column;gap:5px}.cell{width:150px;min-height:42px;border-radius:5px;padding:5px 8px;display:flex;flex-direction:column;justify-content:center;color:#fff}
.cell b{font-family:ui-monospace,monospace;font-size:.78em}.cell span{font-size:.66em;opacity:.85;text-transform:uppercase;letter-spacing:.05em}
.dump{background:#0b0f17;border-radius:6px;padding:.8em 1.1em;margin:1em 0;font-size:.82em}.rrow{border-bottom:1px solid #161d2b;padding:5px 0;display:flex;gap:.6em;flex-wrap:wrap;align-items:baseline}
.rrow code{color:#fcd34d}.ok{color:#5fd17f;font-weight:700}.bad{color:#ff7b7b;font-weight:700}.num{font-family:ui-monospace,monospace;font-size:.85em;color:#8b98a5}.ttl{color:#9aa6b3}
.foot{font-size:.74em;color:#5a6673;margin-top:1.4em;border-top:1px solid #1a2230;padding-top:.7em}
</style></head><body><div class="wrap">
<div class="kicker">Spec-universe tolerance · background-relative coverage · ${esc(reef.spec_id)}</div>
<h1>${esc(reef.from_room)} <span style="color:#5a6673">(spec)</span> → ${esc(room)} <span style="color:#5a6673">(delivered work)</span></h1>
<p style="margin:.4em 0"><span class="verdict">${esc(w.verdict)}</span> &nbsp; coverage <b style="color:${vcol}">${covered}/${total} = ${covPct}%</b> of the spec's own requirements cleared the off-domain background floor · σ shape-match ${w.sigma_shape_match_pct}%</p>
<div class="maps">
 ${tile('① INTENT — every requirement (asked)', intentCells)}
 ${tile('② REALITY — covered above background', realityCells)}
 ${tile('③ DELTA — uncovered (red = missing)', deltaCells)}
</div>
<div class="dump"><h3 style="font-size:.68em;color:#45a29e;text-transform:uppercase;margin-bottom:.5em">Per-requirement — gzip-NCD signal above the neutral/off-domain background</h3>${rows}</div>
<p class="foot">SENSING UNIVERSE = the spec's OWN reef anchors (NOT the stock 144 business library). A requirement is COVERED only when the delivery's gzip-NCD on that anchor EXCEEDS the score a neutral off-domain text gets on the same anchor by ≥ the coverage margin (background-relative). Off-domain work sits at/below the background → near-zero coverage → DELTA panel all RED. Deterministic, gzip-NCD only, no LLM in the sensing path.</p>
</div></body></html>`;
}

// ── build + seal the receipt (A↔B: author reef + room work under one attestation root) ──
async function buildReceipt({ reef, manifest, floor, tolerance }) {
  const room = manifest.room || reef.to_room || 'builder';
  const w = await runWalk(reef, manifest, { floor, tolerance });

  const triptychPath = resolve(REPO_ROOT, `docs/pmu/spec-deliver-walk-${reef.spec_id}.html`);
  const triptychHtml = renderTriptych(w, reef, room);
  mkdirSync(dirname(triptychPath), { recursive: true });
  writeFileSync(triptychPath, triptychHtml);
  const triptych_sha256 = sha256Hex(triptychHtml);

  // SPEC-UNIVERSE tolerance panel (background-relative coverage) — green covered / red missing per
  // requirement. Written next to the triptych, or to an explicit --panel-out path when given.
  const panelHtml = renderSpecUniversePanel(w, reef, room);
  const panelOut = arg('--panel-out', null);
  const panelPath = panelOut ? resolve(panelOut) : resolve(REPO_ROOT, `docs/pmu/spec-deliver-panel-${reef.spec_id}.html`);
  mkdirSync(dirname(panelPath), { recursive: true });
  writeFileSync(panelPath, panelHtml);
  const panel_sha256 = sha256Hex(panelHtml);

  const body = {
    artifact: 'spec-deliver-walk-receipt',
    schema: 'walk-drift/v1',
    spec_id: reef.spec_id,
    source: reef.source,
    room,                                  // the PATIENT — delivered reality, sealed below by this identity
    author_room: reef.from_room,           // the ACTOR — the reef's signed intent
    reef_sha256: reef.sha256,              // binds this receipt to that exact sealed reef (cross-room)
    reef_pubkey_hex: reef.pubkey_hex,      // the author's identity
    walk: {
      engine: 'pmu-onchip --ballistic (definerWalk144 — real recursive on-chip; row→column→transpose→recurse)',
      start_coord: w.startCoord,
      intent_seeds: w.seedCount,
      max_ply: w.max_ply,
      hops: w.hops,
      propagated_past_ply1: w.max_ply > 1,          // the HARD-RULE liveness tell (a diagonal dies at ply 1)
      sigma_shape_match_pct: w.sigma_shape_match_pct,
      kill_pct: w.kill_pct,
      // COVERAGE — the anti-inversion signal. σ is placement-confidence (vocabulary density), NOT low
      // risk; coverage is the share of the spec's requirements the delivery actually COVERED. High σ +
      // low coverage = the negation/salad signature: must ABSTAIN/SUSPECT, never price cheap. null when
      // the reef carries no enumerable requirements (σ-only behaviour preserved for those callers).
      coverage: w.coverage,
      covered: w.covered,
      requirements_total: w.requirements_total,
      // SPEC-UNIVERSE background-relative per-requirement detail (the honest content-discriminating signal):
      // sim = gzip-NCD(work, requirement); background = off-domain neutral baseline on that requirement;
      // signal = sim − background; COVERED iff signal ≥ margin. Off-domain work reads signal ≤ 0 everywhere.
      coverage_sensing: 'spec-universe · background-relative (signal = work_ncd − neutral_bg_ncd ≥ margin)',
      requirements: w.requirements,
      tolerance_pct: tolerance,
      reef_floor: floor,
      inside_top: w.inside,
      off_shape_top: w.outside,
    },
    verdict: w.verdict,
    insurability: w.insurability,   // the decidable boundary the receipt insures (WHERE, not WHETHER)
    verdict_reason: (() => {
      const covPct = w.coverage !== null ? Math.round(100 * w.coverage) : null;
      // when coverage drove it, lead with the honest content signal
      if (covPct !== null && w.coverage <= 0.34)
        return `the delivery covered only ${w.covered}/${w.requirements_total} (${covPct}%) of the spec's own requirements above the off-domain background — off-domain / UNINSURABLE work, the spec was not built`;
      if (covPct !== null && w.coverage >= 0.80 && !w.errorTooMuch)
        return `the delivery covered ${w.covered}/${w.requirements_total} (${covPct}%) of the spec's own requirements above background, σ shape-match ${w.sigma_shape_match_pct}%, off-shape ${w.kill_pct}% ≤ ${tolerance}% — the room built what the spec asked`;
      return w.verdict === 'COHERENT'
        ? `${w.sigma_shape_match_pct}% of the delivery's shape lands inside the spec's intent shape (≥55%), off-shape ${w.kill_pct}% ≤ ${tolerance}% — the room built what the spec asked`
        : w.verdict === 'OFF_SPEC'
          ? (w.kill_pct > tolerance
            ? `off-shape ${w.kill_pct}% > ${tolerance}% tolerance — the delivery concentrates work in areas orthogonal to the spec`
            : `only ${w.sigma_shape_match_pct}% of the delivery's shape lands on the spec's (< 45%) — the room mostly built something the spec did not ask for`)
          : `${w.sigma_shape_match_pct}% of the delivery's shape lands on the spec's (45–55% band) — partial coherence, worth a look`;
    })(),
    triptych: { artifact: triptychPath.replace(REPO_ROOT + '/', ''), sha256: triptych_sha256, anatomy: 'INTENT(cyan) / REALITY(amber) / DELTA(red), 144 ShortLex anchors, 4×4 blocks of 3×3' },
    spec_universe_panel: { artifact: panelOut ? panelPath : panelPath.replace(REPO_ROOT + '/', ''), sha256: panel_sha256, anatomy: 'spec-universe · per-requirement green(covered)/red(missing), background-relative coverage' },
    // the honest fences — the walk is real and no LLM is in the trust path (R7-aligned)
    fences: {
      walk_is_real: true,
      no_llm_in_trust_path: true,
      forbidden_shortcuts_not_used: 'no placePixel placement · no --walk converged/diffusion · no JS BFS · no Monte-Carlo-as-the-walk',
      attestation_layer: 'L1 — your own machine, your own cache hierarchy, sealed locally',
    },
  };

  const sealed = sealReceiptAs(body, actorIdentity(room));
  const attestation_root = attestationRoot([reef.sha256, sealed.sha256]);
  return {
    receipt: sealed, attestation_root, reef_sha256: reef.sha256,
    inputs: { reef: arg('--reef', null), deliverables: arg('--deliverables', null), floor, tolerance },
  };
}

// ── R4: recompute — verify the seal, re-derive the root, and RE-WALK to reproduce σ byte-stably ──
async function check(receiptPath) {
  if (!existsSync(receiptPath)) { console.error(`no receipt at ${receiptPath} — run an attestation first`); process.exit(3); }
  const wrap = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const receipt = wrap.receipt || wrap;
  const v = verifyReceipt(receipt);
  if (!v.ok) { console.error(`❌ recompute FAILED — ${v.reason}`); process.exit(3); }
  const reroot = attestationRoot([receipt.reef_sha256, receipt.sha256]);
  if (wrap.attestation_root && wrap.attestation_root !== reroot) { console.error('❌ recompute FAILED — attestation_root drift'); process.exit(3); }
  // if the reef is on disk, the intent it was graded against must not have changed
  const reefPath = resolve(REPO_ROOT, 'data/pmu/reef', `spec-reef-${receipt.spec_id}.json`);
  let rewalk = null;
  if (existsSync(reefPath)) {
    const reef = JSON.parse(readFileSync(reefPath, 'utf8'));
    if (reef.sha256 !== receipt.reef_sha256) { console.error('❌ recompute FAILED — reef sha256 drift (the intent changed)'); process.exit(3); }
    // re-walk if we can reconstruct the manifest — the strongest claim: the σ reproduces.
    const delivPath = wrap.inputs && wrap.inputs.deliverables ? resolve(REPO_ROOT, wrap.inputs.deliverables) : DEMO_DELIVER;
    if (existsSync(delivPath)) {
      const manifest = JSON.parse(readFileSync(delivPath, 'utf8'));
      const w = await runWalk(reef, manifest, { floor: wrap.inputs ? wrap.inputs.floor : receipt.walk.reef_floor, tolerance: receipt.walk.tolerance_pct });
      rewalk = { sigma: w.sigma_shape_match_pct, verdict: w.verdict, max_ply: w.max_ply };
      if (w.sigma_shape_match_pct !== receipt.walk.sigma_shape_match_pct || w.verdict !== receipt.verdict) {
        console.error(`❌ recompute FAILED — σ/verdict drift (was ${receipt.walk.sigma_shape_match_pct}%/${receipt.verdict}, re-walk ${w.sigma_shape_match_pct}%/${w.verdict})`); process.exit(3);
      }
    }
  }
  const G = '\x1b[32m', D = '\x1b[2m', X = '\x1b[0m';
  process.stdout.write(`${G}✅ recompute OK${X} — ed25519 + sha256 verified, sealed by ${receipt.room} against ${receipt.author_room}'s reef\n`);
  process.stdout.write(`${D}   verdict ${receipt.verdict} · σ shape-match ${receipt.walk.sigma_shape_match_pct}% · walk reached ply ${receipt.walk.max_ply}${rewalk ? ' (re-walk reproduced σ byte-stably)' : ''} · attestation_root ${String(reroot).slice(0, 16)}…${X}\n`);
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--check')) return check(resolve(arg('--receipt', RECEIPT_OUT)));

  const floor = parseFloat(arg('--floor', '0.30'));
  const tolerance = parseFloat(arg('--tolerance', '15'));
  if (!existsSync(DAEMON)) { console.error('pmu-onchip daemon not built — the walk is ON CHIP (the whole point). Build .thetacog/pmu first.'); process.exit(1); }

  let reefPath, manifestPath;
  if (process.argv.includes('--demo')) {
    reefPath = DEMO_REEF; manifestPath = DEMO_DELIVER;
    if (!existsSync(reefPath) || !existsSync(manifestPath)) { console.error('demo fixtures missing — expected the bf-002 reef + deliverables on disk'); process.exit(2); }
  } else {
    reefPath = arg('--reef', null); manifestPath = arg('--deliverables', null);
    if (!reefPath || !manifestPath) { console.error('usage: spec-deliver-walk.mjs --reef <spec-reef.json> --deliverables <manifest.json> [--room R] [--floor 0.30] [--tolerance 15]\n   or: --demo   |   --check [--receipt <path>]'); process.exit(2); }
  }

  const reef = JSON.parse(readFileSync(resolve(reefPath), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  if (arg('--room', null)) manifest.room = arg('--room');
  const wrap = await buildReceipt({ reef, manifest, floor, tolerance });
  const receipt = wrap.receipt;

  const outPath = resolve(arg('--out', RECEIPT_OUT));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(wrap, null, 2));

  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(wrap, null, 2) + '\n'); return; }
  const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', C = '\x1b[36m', X = '\x1b[0m';
  const vcol = receipt.verdict === 'COHERENT' ? G : receipt.verdict === 'DRIFT' ? Y : R;
  process.stderr.write(`${B}⬡ SPEC→DELIVERY WALK${X} ${D}— ${receipt.spec_id} · ${receipt.author_room}(intent) → ${receipt.room}(work)${X}\n\n`);
  process.stderr.write(`  ${vcol}${B}${receipt.verdict}${X} ${D}— ${receipt.verdict_reason}${X}\n`);
  if (receipt.walk.coverage !== null) process.stderr.write(`  ${C}coverage ${B}${receipt.walk.covered}/${receipt.walk.requirements_total} (${Math.round(100 * receipt.walk.coverage)}%)${X}${C} of the spec's own requirements cleared the off-domain background${X}\n`);
  process.stderr.write(`  ${C}σ shape-match ${B}${receipt.walk.sigma_shape_match_pct}%${X}${C} inside the intent shape${X} · off-shape ${receipt.walk.kill_pct}% (tol ${receipt.walk.tolerance_pct}%)\n`);
  process.stderr.write(`  ${D}confidence pixel ${receipt.walk.start_coord} · real ballistic walk reached ply ${receipt.walk.max_ply} (${receipt.walk.hops} hops, past ply 1 = ${receipt.walk.propagated_past_ply1})${X}\n`);
  if (receipt.walk.off_shape_top.length) process.stderr.write(`  ${Y}off-shape:${X} ${receipt.walk.off_shape_top.slice(0, 3).map(x => x.coord).join(', ')}\n`);
  process.stderr.write(`\n  ${D}sealed by ${receipt.room} (ed25519 ${receipt.pubkey_hex.slice(0, 12)}…) vs author ${receipt.author_room} · attestation_root ${String(wrap.attestation_root).slice(0, 16)}…${X}\n`);
  process.stderr.write(`  ${D}triptych → ${receipt.triptych.artifact}${X}\n`);
  process.stderr.write(`  ${D}spec-universe panel → ${receipt.spec_universe_panel.artifact} · recompute: node scripts/pmu/spec-deliver-walk.mjs --check${X}\n`);
  process.stderr.write(`  → ${outPath.replace(REPO_ROOT + '/', '')}\n`);
}

export { buildReceipt, runWalk };
if (import.meta.url === `file://${process.argv[1]}`) main();
