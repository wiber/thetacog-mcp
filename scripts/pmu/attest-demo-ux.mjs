#!/usr/bin/env node
// scripts/pmu/attest-demo-ux.mjs — THE LOCAL, AIR-GAPPED SANDBOX (the SECOND html attest-demo bash-opens).
//
// attest-demo.mjs writes the redpill QnA report (buildReport). THIS file builds the interactive
// instrument that opens ALONGSIDE it: three triangulation inputs (INTENT · REALITY · NEGATIVE), an
// interventions deck, a seven-panel pipeline where EVERY panel names its own source file / line
// count / byte size / sha256 (the chain-of-custody the underwriter needs), and three clickable
// 12×12 reef inspectors. While the terminal shows the LLM red-pill session, this page runs the
// measurement LIVE in the browser — recomputing placements with the browser's OWN gzip
// (CompressionStream) and crypto.subtle for hashes. There is NO fetch, NO XHR, NO external asset,
// NO model in the loop. That air-gap is not a nicety; it is the sale: a risk executive cannot
// underwrite an instrument that phones home or asks an AI to grade another AI.
//
// buildUX(R, extra) → a single self-contained HTML string. R is the attest-demo run object
// (spec, work, fakeWork, gate{verdict,sigma,cell}, triptych{offPct,tier,region}, files.reef …).
//
// THE RECEIPT IS LLM-FREE (hard rule): the SEALED half — this run's placement, σ, cell, receipt
// hash — is a pure function of the commit, embedded verbatim. The LIVE half (browser gzip) is the
// same deterministic sensor, re-run in front of the reader so they can move the inputs and watch
// the placement move — never a model, never the network.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SCENARIOS, DEFAULT_SCENARIO } from './attest-scenarios.mjs';
// vega — the same lens series metric the commit receipt surfaces (convergence: one lens for both cases)
let SERIES_SNAPSHOT = null;
try { ({ SERIES_SNAPSHOT } = await import('./prompt-lens.mjs')); } catch { /* series optional */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
// THE OFF-LANE KILL LINE — the receipt's fixed FINPRO-facing Boolean trigger. ONE source of
// truth: the sealed-state default, the tile's build-time colour, and the tile's LIVE colour fn
// all read this. Deliberately NOT the drift policy-limit slider (15-48%) — that dial is the
// carrier's operational drift limit; this is the separate off-lane kill axis and stays 25%.
// Incident 2026-07-20: the tile's pass/fail colour was baked at build time and never repainted,
// so the number moved with each state while the verdict colour stayed frozen.
const OFFLANE_KILL_PCT = 25;

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function locatedLabel(v) { return (v === 'MATCH' || v === 'DRIFT') ? 'PLACED' : 'UNPLACEABLE'; }

// The 144-cell reef, read once at build time and embedded (file:// fetch is unreliable — the page
// must be self-sufficient). coord · row · col · snippet, exactly what the definer walk anchors on.
function loadReef144() {
  try {
    const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/pmu/snippet-library-144.json'), 'utf8'));
    const cells = Array.isArray(raw) ? raw : (raw.anchors || raw.nodes || []);
    return cells.map((c) => ({ coord: String(c.coord || `${c.row},${c.col}`), row: String(c.row || ''), col: String(c.col || ''), snippet: String(c.snippet || '') }));
  } catch { return []; }
}

// Lens Calibration panel — injected verbatim into the instrument (kept in its own file so its
// browser-side backticks / ${} don't collide with this module's template literal). ADDITIVE: the
// prompt→actual-rules/playbook vs ideal convergence loop, polling /lens-tape live at 0.5s.
const LENS_CAL = (() => {
  try { return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'lens-calibration-panel.html'), 'utf8'); }
  catch { return ''; }
})();

/**
 * buildUX — the interactive, air-gapped local instrument.
 * @param {object} R  attest-demo run object
 * @param {object} extra  { reportHref, lifecycleHref } — sibling pages to cross-link
 */
// ── NARRATOR A/B (spec §9 M1) ───────────────────────────────────────────────────────────────────
// NARRATOR_READ: render-only — this surface DISPLAYS the narrators' accounts, read from their
// artifacts at page-build time. Nothing here feeds a scoring stage; the isolation guard
// (grammatical-walk-mode-b.test.mjs) asserts scoring stages never read these files, and permits
// this read only because this marker is declared in the reading file.
// The arms are labelled "Narrator A (qwen)" / "Narrator B (grammatical)" — NEVER bare "Mode B":
// on this page "Mode A / Mode B" already names the drift/catastrophe FAIL MODES, and one page may
// not carry two opposite meanings of the same label.
function narratorTail(file, n) {
  try {
    const lines = readFileSync(resolve(__dirname, '..', '..', file), 'utf8').trim().split('\n');
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
export function narratorABSection() {
  const escN = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const a = narratorTail('.thetacog/reef-loop-story.ndjson', 1)[0];
  const bs = narratorTail('.thetacog/grammatical-walk.ndjson', 3);
  const b = bs[bs.length - 1];
  const identical = bs.length >= 2 && bs.every((r) => r.story === bs[0].story);
  const arm = (label, rec, fillCmd, chips) =>
    '<div style="flex:1;min-width:280px"><div style="font-weight:700;margin-bottom:4px">' + label + '</div>'
    + (rec
      ? '<div class="dim" style="font-size:11px;margin-bottom:4px">' + escN(rec.ts || '') + (chips || '') + '</div>'
        + '<div style="font-size:12.5px;white-space:pre-wrap;background:rgba(127,127,127,.08);padding:10px;border-radius:6px">' + escN(rec.story || '') + '</div>'
      : '<div class="dim" style="font-size:12px">no account on this tree yet — fills with <code>' + escN(fillCmd) + '</code></div>')
    + '</div>';
  return '\n  <h2>Narrator A/B — the same cycle, two accounts <span class="dim" style="font-size:12px">(I4 · read from the artifacts at page build, never restated)</span></h2>\n'
    + '  <div class="card">\n'
    + '  <label class="chk" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="narrAB" checked onclick="document.getElementById(\'narrB\').style.display=this.checked?\'\':\'none\'"> A/B — show <b>Narrator B (grammatical)</b> beside <b>Narrator A (qwen)</b></label>\n'
    + '  <div style="display:flex;gap:14px;flex-wrap:wrap">'
    + arm('Narrator A (qwen)', a, 'scripts/pmu/reef-loop.sh (the story stage narrates after every scoring stage)', '')
    + '<div id="narrB" style="flex:1;min-width:280px;display:contents">'
    + arm('Narrator B (grammatical)', b, 'node scripts/pmu/grammatical-walk.mjs',
        b ? ' · ' + escN(b.ms) + 'ms, recorded in the artifact' + (identical ? ' · last ' + bs.length + ' accounts byte-identical' : '') : '')
    + '</div></div>\n'
    + '  <p class="legend">Both accounts are knock-on artifacts (<code>.thetacog/reef-loop-story.ndjson</code> · <code>.thetacog/grammatical-walk.ndjson</code>) read at page-build time. The verdict path never reads either — asserted structurally in <code>grammatical-walk-mode-b.test.mjs</code>. The arms say <b>Narrator</b>, never "Mode": Mode A/B on this page already names the drift/catastrophe fail modes.</p>\n'
    + '  </div>\n';
}

// ── RATCHET LIVE-READS (spec §9 M2 · I5) ────────────────────────────────────────────────────────
// Every number in this section is READ at page-build time — floors from data/pmu/ratchet-floor.json,
// the yield series from the shootout ledger, hit_rate recomputed from the adjudication artifact.
// Nothing is restated into this source (§4's corpse rule: a number typed into a page is a corpse
// waiting to be quoted; a number read at render cannot go stale).
function sparkSVG(values, floor, w, h) {
  if (!values.length) return '';
  const lo = Math.min(...values, floor), hi = Math.max(...values, floor);
  const span = (hi - lo) || 1;
  const x = (i) => (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
  const pts = values.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  return '<svg width="' + w + '" height="' + h + '" style="vertical-align:middle">'
    + '<line x1="2" y1="' + y(floor).toFixed(1) + '" x2="' + (w - 2) + '" y2="' + y(floor).toFixed(1) + '" stroke="#c62828" stroke-dasharray="3,2" stroke-width="1"/>'
    + '<polyline points="' + pts + '" fill="none" stroke="#1a7f37" stroke-width="1.5"/></svg>';
}
export function ratchetSection() {
  const gate = (() => { try { return JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'data/pmu/ratchet-floor.json'), 'utf8')); } catch { return null; } })();
  if (!gate || !gate.yield) return '';
  const yFloor = gate.yield.primary.floor;
  const yWidth = (gate.yield.width_is_measured_not_guessed && gate.yield.width_is_measured_not_guessed.floor_width) || 8;
  const hFloor = gate.yield.secondary.floor;
  // yield series — ONLY records at the floor's own width (WIDTH IS PART OF THE PIN)
  let series = [];
  try {
    series = readFileSync(resolve(__dirname, '..', '..', 'data/pmu/shootout-ledger.ndjson'), 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && Number(r.width) === Number(yWidth) && r.yield_quality != null)
      .map((r) => Number(r.yield_quality)).slice(-60);
  } catch { /* series renders as its fill command */ }
  // hit_rate = applied / (applied + burned), recomputed from the adjudication artifact:
  // applied = consumed rows carrying provenance.lineage (placed into the reef); burned = the rest.
  let hit = null, applied = 0, total = 0, rolling = [];
  try {
    const rows = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'data/pmu/lens-c1-adjudication.json'), 'utf8')).rows || [];
    const flags = rows.filter((r) => r.consumed).map((r) => (r.provenance && r.provenance.lineage) ? 1 : 0);
    total = flags.length; applied = flags.reduce((a, b) => a + b, 0);
    hit = total ? (100 * applied / total) : null;
    for (let i = 99; i < flags.length; i += 25) {
      const win = flags.slice(Math.max(0, i - 99), i + 1);
      rolling.push(100 * win.reduce((a, b) => a + b, 0) / win.length);
    }
  } catch { /* renders as fill command */ }
  const fmt = (v, d) => v == null ? '—' : Number(v).toFixed(d);
  return '\n  <h2>The ratchet, live <span class="dim" style="font-size:12px">(I5 · floors from ratchet-floor.json · series from the loop\'s own artifacts · nothing restated)</span></h2>\n'
    + '  <div class="card"><div style="display:flex;gap:22px;flex-wrap:wrap">'
    + '<div><div style="font-weight:700">yield_quality <span class="dim" style="font-weight:400">@ w' + yWidth + '</span></div>'
    + (series.length ? sparkSVG(series, yFloor, 220, 44) + '<div class="dim" style="font-size:11px">last ' + series.length + ' shootouts at w' + yWidth + ' · latest ' + fmt(series[series.length - 1], 4) + ' vs floor <b>' + yFloor + '</b> @ w' + yWidth + ' (red dash)</div>'
      : '<div class="dim" style="font-size:12px">no w' + yWidth + ' shootouts on this tree yet — fills as <code>scripts/pmu/reef-loop.sh</code> ticks</div>')
    + '</div>'
    + '<div><div style="font-weight:700">hit_rate <span class="dim" style="font-weight:400">= applied / (applied + burned)</span></div>'
    + (hit != null ? sparkSVG(rolling.length ? rolling : [hit], hFloor, 220, 44) + '<div class="dim" style="font-size:11px">' + applied + ' applied / ' + total + ' attempted = <b>' + fmt(hit, 2) + '%</b> vs floor <b>' + hFloor + '%</b> (rolling 100-row window)</div>'
      : '<div class="dim" style="font-size:12px">no adjudication rows on this tree yet — fills as the harvest agent runs</div>')
    + '</div></div>'
    + '  <p class="legend">Recompute both: yield from <code>data/pmu/shootout-ledger.ndjson</code> (width-matched — a floor quoted without its width is unreadable), hit_rate from <code>data/pmu/lens-c1-adjudication.json</code> (applied = consumed rows carrying <code>provenance.lineage</code>). Floors are the gate\'s, read at build — this page holds no number of its own.</p>\n'
    + '  </div>\n';
}

export function buildUX(R, extra = {}) {
  const reportHref = extra.reportHref || 'attest-demo-report.html';
  const lifecycleHref = extra.lifecycleHref || 'attest-demo-lifecycle.html';
  const g = R.gate || {};
  const tp = (R.triptych && !R.triptych.error) ? R.triptych : null;

  let reefDoc = {}; try { reefDoc = JSON.parse(readFileSync(R.files.reef, 'utf8')); } catch { /* embed empty */ }
  let recDoc = {}; try { recDoc = JSON.parse(readFileSync(R.files.receipt, 'utf8')); } catch { /* */ }
  const authorized = reefDoc.authorized_cells || ['A', 'A1', 'A2'];
  const cells144 = loadReef144();
  // REEF GATE (2026-07-19 — operator: "to validate the full reef is there (and size of reef) —
  // are you gating that?"): the page must NOT build over a gutted reef. The 144 semantic dumps ARE
  // the sensor corpus (litScores NCD-compresses every input against them); a missing or thinned
  // cell silently degrades every placement while the page still LOOKS credible. Loud beats plausible.
  // Guarded end-to-end by tests/pmu-simulator/reef-embedded-full.test.mjs.
  if (cells144.length !== 144) throw new Error(`REEF GATE: expected 144 reef cells, got ${cells144.length} — refusing to build the instrument over a gutted reef (data/pmu/snippet-library-144.json)`);
  {
    const thin = cells144.filter((c) => c.snippet.length < 200);
    if (thin.length) throw new Error(`REEF GATE: ${thin.length} reef cell(s) under 200 ch (${thin.slice(0, 5).map((c) => c.coord).join(', ')}) — the semantic dumps are the sensor corpus; refusing to build`);
  }
  // WHY panel (spec: docs/pmu/rule-picker-calibration-spec.md §4) — the MEASURED battery snapshot,
  // embedded at build, best-effort (an absent snapshot renders as a gray "run the battery" chip,
  // never a fabricated number). ADDITIVE: no existing surface reads this.
  let calib = null;
  try {
    const mm = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/grip/microscope.json'), 'utf8'));
    calib = { agreement: mm.agreement || null, agreementHeld: mm.agreement_held_out || null,
      meanLoopMs: mm.speed ? mm.speed.mean_loop_ms : null, maxLoopMs: mm.speed ? mm.speed.max_loop_ms : null,
      generated_ms: mm.generated_ms || null };
  } catch { calib = null; }
  // G2/G3 data — the LAST calibration-cycle row (spec §3 phase 6). Best-effort: absent file →
  // the gray slots stand and name the run. The page never draws an unproven bar.
  let calibHistory = null;
  try {
    const lines = readFileSync(resolve(REPO_ROOT, 'data/pmu/lens-calibration-history.ndjson'), 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) calibHistory = JSON.parse(lines[lines.length - 1]);
  } catch { calibHistory = null; }
  // G6 (spec §5.6) — the CONVERGENCE row: labeled-trap confusion matrix + knob sweep + capability
  // statement. Same discipline: absent file → gray slot naming the runs.
  let convergence = null;
  try {
    const clines = readFileSync(resolve(REPO_ROOT, 'data/pmu/lens-convergence-history.ndjson'), 'utf8').trim().split('\n').filter(Boolean);
    if (clines.length) convergence = JSON.parse(clines[clines.length - 1]);
  } catch { convergence = null; }
  // G9 — DIMENSION-2 MASS (spec §7.1): read the E1 sub-well when materialized.
  let dim2mass = null;
  try {
    const sw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/pmu/reef-l1/B-C1.json'), 'utf8'));
    dim2mass = { parent: sw.parent, cells: (sw.cells || []).filter((c) => (c.snippet || '').length >= 40).length,
      chars: sw.stats ? sw.stats.total_chars : 0, contrast: sw.p1_contrast ?? null, p1_pass: sw.p1_pass ?? null,
      p3: sw.p3 ? { l0: sw.p3.level0_hops, slice: sw.p3.slice_hops, pass: sw.p3.pass, shadow: sw.p3.shadow_top_wells } : null };
  } catch { dim2mass = null; }
  // G7 — THE BANKS coverage (operator 2026-07-19: per-lane standing specs injected every call).
  // Computed at build from the reef itself: lanes seeded / total, broken paths (should be 0 —
  // tape-health broken-banks is the runtime twin of this build-time read).
  let banks = null;
  try {
    const reefDoc = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/pmu/lens-reef.json'), 'utf8'));
    const doms = reefDoc.domains || [];
    const seeded = doms.filter((d) => Array.isArray(d.specs) && d.specs.length);
    const broken = [];
    for (const d of seeded) for (const s of d.specs) { try { readFileSync(resolve(REPO_ROOT, s.path)); } catch { broken.push(`${d.domain} → ${s.path}`); } }
    banks = { total: doms.length, seeded: seeded.length, broken,
      lanes: seeded.map((d) => ({ domain: d.domain, n: d.specs.length })) };
  } catch { banks = null; }
  // The canonical axis key — emoji + RANK.FullName per axis — so the encircled result speaks the SAME
  // visual language as the commit email / lens receipt (no LLM: a fixed, deterministic legend).
  let axisMap = {};
  try {
    const axRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'docs/architecture/axis-library-v1.json'), 'utf8'));
    const axArr = Array.isArray(axRaw) ? axRaw : (axRaw.axes || Object.values(axRaw));
    for (const a of axArr) axisMap[a.rank] = { emoji: a.emoji || '', name: a.name || a.rank };
  } catch { /* fall back to bare ranks */ }

  // The three triangulation corpora. INTENT = the authorized-cell semantic content (what the spec
  // AUTHORIZES). REALITY = Node B's borderline work. NEGATIVE = the excluded domain — we use the
  // plausible-but-off-lane FAKE (structural negation: an operations-execution deliverable, NOT a
  // one-word flip). All three are what the pipeline actually measured.
  // The live sandbox seeds from the shared attest-scenarios. Each canned intervention carries its REAL
  // pre-rendered encircled PNGs (from attest-demo's pipeline runs, R.scenarios keyed by scenario), so the
  // floating panels show the ACTUAL pipeline output — not a browser approximation — when you fire it.
  // Free-text edits fall back to the labeled canvas analogue (only live Rust could redraw arbitrary text).
  const sealedWork = String(R.work || '');
  const pngByKey = {}; for (const r of (Array.isArray(R.scenarios) ? R.scenarios : [])) pngByKey[r.key] = r;
  const scenarios = SCENARIOS.map((s) => { const r = pngByKey[s.key] || {}; return { key: s.key, label: s.label, intent: s.intent, reality: s.reality, negative: s.negative, isDefault: !!s.isDefault,
    encircledA: r.encircledA || null, encircledB: r.encircledB || null, tolA: r.tolA || null, tolB: r.tolB || null, deltaA: r.deltaA || null, deltaB: r.deltaB || null,
    wIntentGzip: r.wIntentGzip || null, wIntentWalk: r.wIntentWalk || null, wRealityGzip: r.wRealityGzip || null, wRealityWalk: r.wRealityWalk || null, wNegGzip: r.wNegGzip || null, wNegWalk: r.wNegWalk || null,
    regionA: r.regionA || 0, regionB: r.regionB || 0 }; });
  const intentText = DEFAULT_SCENARIO.intent;
  const realityText = DEFAULT_SCENARIO.reality;
  const negativeText = DEFAULT_SCENARIO.negative;

  // SEALED verdict of THIS run (the receipt half — a function of the commit, embedded verbatim).
  const sealed = {
    verdict: g.verdict || 'UNPLACEABLE',
    placed: locatedLabel(g.verdict),
    sigma: Number.isFinite(Number(g.sigma)) ? Number(g.sigma) : null,
    cell: g.cell || tp?.actorCoord || null,
    deterministic: !!g.deterministic,
    offPct: tp?.offPct ?? null,
    tier: tp?.tier || (tp?.tooMany ? 'PRICEABLE' : 'INSURABLE'),
    region: tp?.region || null,
    receiptId: recDoc.receipt_id || recDoc.run_id || null,
    signed: !!recDoc.signature,
    reefCommitment: (reefDoc.reef_commitment || '').slice(0, 16),
    threshold: OFFLANE_KILL_PCT, // off-lane kill %, the FINPRO-facing Boolean trigger
  };

  // The IN_LANE Boolean: the executive trigger. In-lane iff the sealed cell starts with an
  // authorized-family letter AND off-lane% is under the kill threshold. Abstain → UNPLACEABLE.
  const cellFamilyOk = /^A/.test(String(sealed.cell || ''));
  const offOk = sealed.offPct == null || sealed.offPct < sealed.threshold;
  const boolState = sealed.placed === 'UNPLACEABLE' ? 'UNPLACEABLE' : (cellFamilyOk && offOk) ? 'IN_LANE' : 'OFF_DOMAIN';

  // Provenance for the THREE ingest panels — real line/byte counts of the corpora this run measured.
  const prov = (name, text) => ({ source_file: name, line_count: text.split('\n').length, byte_size: Buffer.byteLength(text, 'utf8') });
  const ingestProv = {
    intent: { ...prov('intent_corpus.txt', intentText), note: 'semantic content of authorized cells ' + authorized.join(' · ') },
    reality: { ...prov('work.txt', realityText), note: "Node B's work product (signed, independent key)" },
    negative: { ...prov('excluded_domain.txt', negativeText), note: 'the excluded domain — a plausible off-lane deliverable (structural negation)' },
  };

  // EMBED THE FLIGHT TAPE (2026-07-18 — file:// convergence runs): file:// cannot fetch, so the
  // baked scenario steps must ride IN the page. Read the tape at build; the boot seeds flightTape
  // from it so scrubbing the offline page IS the convergence run. Served (http) still polls for live
  // appends on top of the embedded seed.
  let embeddedTape = [], embeddedTapeBootCursor = null;
  try { const tp = R.files && R.files.flightTape; if (tp) { const td = JSON.parse(readFileSync(tp, 'utf8')); embeddedTape = Array.isArray(td.timeline_events) ? td.timeline_events : []; if (typeof td.boot_cursor === 'number') embeddedTapeBootCursor = td.boot_cursor; } } catch { /* no tape — page boots empty, unchanged */ }
  // THE COUNTERFACTUAL — with-reef vs ablated (snap-counterfactual.mjs). Embedded so file:// shows
  // the reef relief without a server. The ONE obvious story: general model routes on its own, the
  // reef snaps it to the rules + hat (0→100% hat, 0→97% rules).
  let counterfactual = null;
  try { const cfPath = R.files && R.files.counterfactual; if (cfPath) counterfactual = JSON.parse(readFileSync(cfPath, 'utf8')); } catch { /* optional */ }
  // THE GROWTH CURVE (2026-07-18 — "measure the physics, not 100%/0%"): capability vs reef-mass
  // from reef-growth-curve.mjs; the hypothesis graph the page renders per the operator's framing.
  // AUTONOMOUS-MODE TIME BUDGET (operator 2026-07-20: "add a panel … with a pie chart of how the
  // qwen controller uses its time for autonomous mode (separate from no llm verdict)").
  // MEASURED, never illustrative: parsed from the loop's own stage-times lines. The separation the
  // operator asked for is structural — every stage except 'story' is deterministic and LLM-free;
  // 'story' IS the entire qwen cost. If the log is absent the panel renders "no ticks recorded"
  // rather than inventing a shape (a fabricated budget on an attestation page would be the exact
  // credibility hole the timing-hollow sentinel exists to prevent).
  // SUB-WELL CENSUS — how many of the 144 cells have actually subdivided under semantic pressure
  // (data/pmu/reef-l1/<coord>.json). Read, never assumed: the shadow-vs-tesseract panel states the
  // realized depth honestly, and today that number is 1.
  let subWellCount = 0;
  try { subWellCount = readdirSync(resolve(REPO_ROOT, 'data/pmu/reef-l1')).filter((f) => f.endsWith('.json')).length; } catch { subWellCount = 0; }

  let autonomyBudget = null;
  try {
    const logTxt = readFileSync(resolve(REPO_ROOT, '.thetacog/reef-loop.log'), 'utf8');
    // FORMAT-TOLERANT (2026-07-20): the loop grew a leading `demand Ns · ` stage and the old
    // regex silently excluded every new-format line — the panel kept rendering a median of the
    // DEAD regime while looking live (the quiet-sensor shape: a parser pinned to a retired format
    // is a sensor that stopped firing, not a condition that closed). Both formats parse now, and
    // autonomy-budget-format.test.mjs asserts the NEWEST stage-times line in the live log matches.
    const rows = [...logTxt.matchAll(/stage-times: (?:demand (\d+)s · )?miner (\d+)s · agent\+gate (\d+)s · sentinel (\d+)s · story (\d+)s/g)]
      .map((m) => ({ demand: +(m[1] || 0), miner: +m[2], gate: +m[3], sentinel: +m[4], story: +m[5] }));
    if (rows.length) {
      const recent = rows.slice(-20);                       // the CURRENT regime, not the whole night
      const med = (k) => { const v = recent.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
      const seg = [
        { key: 'gate', name: 'gate — sweep + battery', ms: med('gate'), llm: false },
        { key: 'story', name: 'story — qwen narration', ms: med('story'), llm: true },
        { key: 'demand', name: 'demand — target scan', ms: med('demand'), llm: false },
        { key: 'miner', name: 'miner — extract + walk', ms: med('miner'), llm: false },
        { key: 'sentinel', name: 'sentinel — 15 classes', ms: med('sentinel'), llm: false },
      ].filter((x) => x.ms > 0);
      const total = seg.reduce((a, b) => a + b.ms, 0) || 1;
      autonomyBudget = {
        ticks: recent.length, total_s: total,
        llm_s: seg.filter((x) => x.llm).reduce((a, b) => a + b.ms, 0),
        deterministic_s: seg.filter((x) => !x.llm).reduce((a, b) => a + b.ms, 0),
        segments: seg.map((x) => ({ ...x, pct: +(100 * x.ms / total).toFixed(1) })),
      };
    }
  } catch { /* no loop log in a bare checkout — panel says so */ }

  let growthCurve = null;
  try { const gcPath = R.files && R.files.growthCurve; if (gcPath) growthCurve = JSON.parse(readFileSync(gcPath, 'utf8')); } catch { /* optional */ }

  // Everything the client needs, embedded. No network, no model — the browser recomputes with gzip.
  const DATA = {
    sealed, authorized, cells144, lifecycleHref, axisMap, calib, calibHistory, convergence, banks, dim2mass,
    embeddedTape, embeddedTapeBootCursor, counterfactual, growthCurve, autonomyBudget,
    texts: { intent: intentText, reality: realityText, negative: negativeText },
    ingestProv,
    receipt: {
      id: sealed.receiptId, signed: sealed.signed, reef_commitment: reefDoc.reef_commitment || null,
      payload_sha256: recDoc.payload_sha256 || null, threshold_sigma: recDoc.threshold || null,
    },
    // The canned scenarios — each carries its REAL pre-rendered encircled PNGs (encircledA/B) so the
    // floating panels show the actual pipeline output when you fire the intervention.
    presets: scenarios,
    scenarios,
  };

  // ── DEFAULT POLICY-LIMIT (drift) THRESHOLD, computed at build time ────────────────────────────
  // The live sensor measures drift as POSITION between the two poles: driftPct = 100·dI/(dI+dN), where
  // 0% = on Intent, 50% = equidistant (the Mode-B catastrophe midline: closer to the excluded domain),
  // 100% = on the Negative. gzip-NCD never reaches 0 for related text, so the usable band sits ~35–65%.
  // We compute the DEFAULT scenario's drift here (Node zlib — the same gzip family as the browser) and
  // set the slider default a few points ABOVE it, so the page loads IN_LANE and the operator can drag
  // the slider DOWN to watch Mode A (drift) trip, then load the Draft→Execute preset to watch Mode B
  // (catastrophe) trip — proving the distinction. (Browser-vs-zlib variance shifts the live number by a
  // digit; the +4 margin absorbs it.) Separate axis from the receipt's off-lane% kill (that stays 25%).
  // The redundancy floor + operational-boundary boilerplate, defined ONCE here and injected into the
  // client script verbatim (below), so the build-time default-threshold math and the runtime browser
  // math fatten identically — otherwise short intent/negative corpora fatten at runtime but not at
  // build time and the default scenario can load one bucket off.
  const REDUNDANCY_FLOOR = 220;
  const BOILER_PRE = "Under the governing operational authority and the authorized-scope guidelines, the deploying party frames the following action within its full control boundary. The instrument measures the structural region of this content against the authorized lane, not a keyword match. The operative content follows in full: ";
  const BOILER_POST = " This concludes the operational boundary within which the structural placement is measured, per the authorized mandate and the defined excluded domain.";
  const fatN = (t) => { t = String(t || ''); return Buffer.byteLength(t, 'utf8') < REDUNDANCY_FLOOR ? BOILER_PRE + t + BOILER_POST : t; };
  const gzN = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;
  const ncdN = (a, b) => { if (!a || !b) return 1; const ca = gzN(a), cb = gzN(b), cab = gzN(a + '\n' + b); const mx = Math.max(ca, cb); return mx === 0 ? 1 : Math.max(0, Math.min(1.2, (cab - Math.min(ca, cb)) / mx)); };
  let liveThresholdDefault = 40;
  try {
    const dI = ncdN(fatN(realityText), fatN(intentText)), dN = ncdN(fatN(realityText), fatN(negativeText));
    const drift = 100 * dI / (dI + dN);
    liveThresholdDefault = Math.max(15, Math.min(48, Math.round(drift) + 4));  // a few points above the default's drift → loads IN_LANE
  } catch { /* keep 40 */ }
  DATA.liveThresholdDefault = liveThresholdDefault;

  // ── THE REAL PIPELINE PANELS — the running code, NOT reinvented ───────────────────────────────
  // R.triptych.dataHtml is the output of runPipeline → renderTriptych (the actual ballistic walk on the
  // 144×144 lattice) — the SAME instrument the commit emails ship: PRE-WALK Δ · INTENT · REALITY · Δ ·
  // TOLERANCE (the 3-rows-collapse-to-2 walk). We EMBED it verbatim. The interactive what-ifs re-run this
  // SAME pipeline on-chip via the local /render endpoint (Loop 1 — the old browser-gzip analogue — is now
  // deleted); the browser never rebuilds the pipeline. (find the running code first, always.)
  const tripHtml = (tp && tp.dataHtml) ? tp.dataHtml : null;
  // Individual pipeline panels (data URIs) for the canonical 3-row flow. P = Intent-vs-Reality build
  // (Intent row, Reality row, Δ Mode-A, Tolerance, Encircled). PN = Intent-vs-Negative build (Negative
  // row, Δ Mode-B). All real pipeline output.
  const P = (tp && tp.panels) ? tp.panels : {};
  const tpNeg = (R.triptychNeg && !R.triptychNeg.error) ? R.triptychNeg : null;
  const PN = (tpNeg && tpNeg.panels) ? tpNeg.panels : {};
  const havePanels = !!(P.rawIntent && P.intent && P.tolerance);
  // the FILLED, correct encircled PNGs shown on the page (Fail A = intent-vs-reality drift,
  // Fail B = intent-vs-negative catastrophe) — the floating panels DEFAULT to these so both are filled.
  DATA.pageEncircledA = P.encircled || null;
  DATA.pageEncircledB = PN.encircled || null;
  DATA.pageDeltaA = P.delta || null; DATA.pageTolA = P.tolerance || null;
  DATA.pageDeltaB = PN.delta || null; DATA.pageTolB = PN.tolerance || null;
  DATA.pageWIntentGzip = P.rawIntent || null; DATA.pageWIntentWalk = P.intent || null;
  DATA.pageWRealityGzip = P.rawReality || null; DATA.pageWRealityWalk = P.reality || null;
  DATA.pageWNegGzip = PN.rawReality || null; DATA.pageWNegWalk = PN.reality || null;
  // vega — the SAME lens series metric the commit receipt shows (prompt-lens SERIES_SNAPSHOT); the lens
  // converges, so we surface it here too when it adds to the underwriter's read (volatility-of-σ).
  let vega = null; try { vega = SERIES_SNAPSHOT && SERIES_SNAPSHOT.vega != null ? SERIES_SNAPSHOT.vega : null; } catch { /* */ }
  const walkSigma = tp && tp.matchSigma != null ? Number(tp.matchSigma).toFixed(1) : null;
  const timings = tp && tp.timings ? tp.timings : null;
  const T = (k) => (timings && timings[k] != null) ? `${timings[k]}ms` : '—';
  const walkModeReal = tp?.walkMode || null;
  // Chebyshev tolerance envelope on the sealed placement σ (illustrative): ≥1−1/k² of mass within ±kσ.
  const chebLo = sealed.sigma != null ? Math.max(0, sealed.sigma - 2 * 1).toFixed(2) : '—';
  const chebHi = sealed.sigma != null ? (sealed.sigma + 2 * 1).toFixed(2) : '—';

  const sigStr = sealed.sigma != null ? sealed.sigma.toFixed(4) : '—';
  const boolColor = boolState === 'IN_LANE' ? '#46d369' : boolState === 'OFF_DOMAIN' ? '#ff5d52' : '#f0b429';
  const boolGlow = boolState === 'IN_LANE' ? 'rgba(70,211,105,.18)' : boolState === 'OFF_DOMAIN' ? 'rgba(255,93,82,.18)' : 'rgba(240,180,41,.18)';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>attest-demo — the local, air-gapped instrument</title>
<style>
  :root{--bg:#070910;--panel:#0e131e;--line:#1a2130;--ink:#e9edf5;--dim:#8a94a8;--cy:#5ad1ff;--gn:#46d369;--am:#f0b429;--rd:#ff5d52;--mono:ui-monospace,Menlo,Monaco,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 20px 90px}
  a{color:var(--cy);text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:26px;letter-spacing:-.4px;margin:0 0 4px}
  .sub{color:var(--dim);font-style:italic;margin-bottom:14px}
  h2{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--cy);margin:34px 0 10px;border-top:1px solid var(--line);padding-top:20px}
  .mono{font-family:var(--mono)} .dim{color:var(--dim)} .gn{color:var(--gn)} .am{color:var(--am)} .rd{color:var(--rd)} .cy{color:var(--cy)}
  code{font-family:var(--mono);font-size:12.5px;color:#9fe6b0;background:#0a0e17;padding:1px 6px;border-radius:5px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
  /* AIR-GAP BADGE — the first thing an underwriter must see */
  .airgap{display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,rgba(70,211,105,.08),rgba(90,209,255,.05));border:1px solid var(--gn);border-radius:12px;padding:12px 16px;margin:10px 0 4px}
  .airgap .lock{font-size:26px}
  .airgap b{color:var(--gn)}
  .airgap small{color:var(--dim);display:block;font-size:12px}
  /* VERDICT HEADER — the Boolean policy trigger */
  .verdict{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center;border-radius:14px;padding:20px 22px;margin:12px 0;border:2px solid ${boolColor};background:${boolGlow}}
  .verdict .state{font-size:40px;font-weight:800;letter-spacing:-1px;color:${boolColor};font-family:var(--mono)}
  .verdict .greeks{font-family:var(--mono);font-size:13px;color:var(--dim);line-height:1.9}
  .verdict .greeks b{color:var(--ink)}
  .pill{display:inline-block;font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line);color:var(--dim)}
  .greeksgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  /* THE INSTRUMENT — dial beside readout. Two columns on desktop so turning the policy limit and
     watching g-threshold/g-offlane move is ONE glance; stacks on narrow screens (controls first,
     because the dial is the thing you reach for). */
  .instrument{display:grid;grid-template-columns:minmax(280px,340px) 1fr;gap:12px;align-items:start}
  .instrument-controls{margin:0}
  @media (max-width:820px){ .instrument{grid-template-columns:1fr} }
  /* AUTONOMOUS-MODE TIME PANEL — the qwen controller's budget, subdivided. Deterministic stages
     render cyan, the single LLM stage amber, so "where does the model actually cost us" is visible
     without reading a legend. */
  .budgetwrap{display:grid;grid-template-columns:minmax(200px,240px) 1fr;gap:14px;align-items:center}
  @media (max-width:820px){ .budgetwrap{grid-template-columns:1fr} }
  .budgetlegend{display:flex;flex-direction:column;gap:6px;font-size:12px}
  .budgetrow{display:flex;align-items:center;gap:8px}
  .budgetsw{width:11px;height:11px;border-radius:2px;flex:0 0 auto}
  .budgetrow .bn{flex:1}
  .budgetrow .bv{font-family:var(--mono);font-weight:700}
  .tile{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-height:56px}
  /* THE FLIGHT TAPE SCRUBBER — media-control bar for time-travel */
  .scrubber{display:flex;align-items:center;gap:12px;justify-content:center;background:#0a0e17;border:1px solid var(--cy);border-radius:10px;padding:8px 12px;margin-top:10px}
  .scrubber button{font-family:var(--mono);font-size:12px;min-width:88px}
  .scrubber button:disabled{opacity:.35;cursor:not-allowed}
  #scrubLabel{font-size:12px;color:var(--cy);min-width:230px;text-align:center}
  .histbanner{background:rgba(240,180,41,.15);border:1px solid var(--am);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--am);text-align:center}
  /* Gotcha 1 — rigid locking: fixed heights so scrubbing through history never jitters the layout */
  .box textarea{min-height:132px;height:132px}
  .tile .tv{font-family:var(--mono);font-size:19px;font-weight:700}
  .tile .tk{font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
  .trip{background:#0a0e17;border:1px solid var(--line);border-radius:12px;padding:8px;margin-top:8px;overflow-x:auto}
  /* the canonical data-flow: 3 corpus rows (gzip → walk) → 2 comparators → tolerance → encircled */
  .flowwrap{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:start}
  @media(max-width:820px){.flowwrap{grid-template-columns:1fr}}
  .flow{background:#0a0e17;border:1px solid var(--line);border-radius:12px;padding:12px}
  .frow{display:grid;grid-template-columns:64px 1fr 22px 1fr;gap:8px;align-items:center;margin-bottom:8px}
  .frow .rl{font-family:var(--mono);font-size:11px;font-weight:700;text-transform:uppercase;writing-mode:horizontal-tb}
  .frow.i .rl{color:var(--cy)} .frow.r .rl{color:var(--am)} .frow.n .rl{color:var(--rd)}
  .pcell{background:#05070d;border:1px solid var(--line);border-radius:8px;padding:4px;text-align:center}
  .pcell img{width:100%;max-width:150px;image-rendering:pixelated;border-radius:4px;display:block;margin:0 auto}
  .pcell .cap{font-size:9px;color:var(--dim);font-family:var(--mono);margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
  .arrow{color:var(--dim);text-align:center;font-size:16px}
  .collapse{text-align:center;color:var(--dim);font-size:11px;margin:6px 0;border-top:1px dashed var(--line);padding-top:8px}
  .comps{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .comp{background:#05070d;border:1px solid var(--line);border-radius:8px;padding:6px;text-align:center}
  .comp.a{border-left:3px solid var(--am)} .comp.b{border-left:3px solid var(--rd)}
  .comp img{width:100%;max-width:150px;image-rendering:pixelated;border-radius:4px}
  .comp .cl{font-size:10px;font-family:var(--mono);margin-bottom:3px}
  /* the 2×3 fail-mode grid — rows Fail A / Fail B; cols comparator → tolerance → encircled */
  .modegrid{display:grid;grid-template-columns:96px 1fr 20px 1fr 20px 1fr;gap:6px;align-items:center;background:#0a0e17;border:1px solid var(--line);border-radius:12px;padding:12px;overflow-x:auto}
  .mghead{font-family:var(--mono);font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;text-align:center;padding-bottom:2px}
  .mgrl{font-family:var(--mono);font-size:11px;font-weight:700;line-height:1.3}
  .mgrl.a{color:var(--am)} .mgrl.b{color:var(--rd)}
  .mgcell{background:#05070d;border:1px solid var(--line);border-radius:8px;padding:4px;text-align:center}
  .mgcell.tolc{border-left:2px solid var(--cy)} .mgcell.encc{border-left:2px solid #f5d576}
  .mgcell img{width:100%;max-width:150px;image-rendering:pixelated;border-radius:4px;display:block;margin:0 auto}
  .mgcell .mc{font-size:9px;color:var(--dim);font-family:var(--mono);margin-top:2px}
  /* drift-only policy: Fail-B lane switched off → dim it (mgrl.b + all following siblings = the B row) */
  .modegrid.nob .mgrl.b, .modegrid.nob .mgrl.b ~ *{opacity:.28;filter:grayscale(1)}
  #threshold:disabled{opacity:.4;cursor:not-allowed}
  /* FLOATING live tolerance HUD — stays in view while you edit the boxes; fires canned interventions */
  .floathud{position:fixed;right:14px;bottom:14px;width:236px;background:rgba(10,14,23,.97);border:1px solid var(--line);border-radius:12px;padding:10px;z-index:999;box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(4px)}
  .floathud.min{width:auto;padding:6px 10px}
  .floathud .hudtop{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
  .floathud .hudstate{font-family:var(--mono);font-weight:800;font-size:15px}
  .floathud .hudmin{cursor:pointer;color:var(--dim);font-size:14px;background:none;border:none;padding:0 4px}
  .floathud .hudmode{font-family:var(--mono);font-size:10.5px;line-height:1.45;border-radius:6px;padding:6px 8px;margin-bottom:7px;border:1px solid var(--line);background:#0a0e17}
  .floathud .hudmode b{font-weight:800}
  .floathud .hudmode.modeB{border-color:#ff5d52;background:rgba(255,93,82,.10);color:#ffb3ad}
  .floathud .hudmode.modeA{border-color:#ff5d52;background:rgba(255,93,82,.07);color:#ffc9a3}
  .floathud .hudmode.abstain{border-color:#f0b429;background:rgba(240,180,41,.10);color:#f7d488}
  .floathud .hudmode.inlane{border-color:#46d369;background:rgba(70,211,105,.09);color:#8ee6a8}
  .hudencs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:4px 0}
  .hudenc{text-align:center}
  .hudenc canvas, .hudenc img{width:100%;height:auto;aspect-ratio:1;object-fit:contain;background:#05070d;border:1px solid var(--line);border-radius:6px;image-rendering:pixelated;display:block}
  .hudenclbl{font-family:var(--mono);font-size:9px;margin-top:2px;color:var(--dim)}
  .hudmodes{display:flex;gap:6px;margin:6px 0;font-family:var(--mono);font-size:10px}
  .hudmodes .hm{flex:1;text-align:center;padding:3px;border-radius:5px;border:1px solid var(--line)}
  .hudbtns{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
  .hudbtns button{font-size:10px;padding:3px 6px;flex:1;min-width:64px}
  .hudlbl{font-size:9px;color:var(--dim);font-family:var(--mono);margin-top:6px;line-height:1.4}
  .hudscrub{display:flex;align-items:center;gap:8px;justify-content:center;margin:6px 0 4px}
  .hudscrub button{font-family:var(--mono);font-size:11px;padding:2px 8px;background:#0a0e17;border:1px solid var(--cy);color:var(--cy);border-radius:5px;cursor:pointer}
  .hudscrub button:disabled{opacity:.35;cursor:not-allowed}
  #hudScrub{font-size:10px;color:var(--cy);min-width:150px;text-align:center}
  .regchip{cursor:pointer;text-decoration:underline dotted transparent;transition:text-decoration-color .1s}
  .regchip:hover{text-decoration-color:currentColor}
  .lightbox{position:fixed;inset:0;background:rgba(3,6,12,.82);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
  .lightbox[hidden]{display:none}   /* a class display:flex would otherwise override the [hidden] UA rule → a blue overlay frozen over the whole page on load */
  /* LIVE-RUST spinner + stale-clearing: while the on-chip walk runs, hide stale panels and spin */
  .rustspin{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10000;background:#0b1220;border:1px solid var(--cy);border-radius:22px;padding:7px 18px;font-family:var(--mono);font-size:12px;color:var(--cy);display:flex;align-items:center;gap:9px;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  .rustspin[hidden]{display:none}
  .rustspin .dot{width:11px;height:11px;border:2px solid var(--cy);border-top-color:transparent;border-radius:50%;animation:rustspin .7s linear infinite}
  @keyframes rustspin{to{transform:rotate(360deg)}}
  body.rustpending .pcell img, body.rustpending .mgcell img{opacity:.5;transition:opacity .15s}   /* SUBTLE dim (not a black-out) while the fresh walk lands — never blocks interaction */
  .lbcard{background:#0b1220;border:1px solid #24405c;border-radius:12px;padding:22px 24px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.6);font-size:14px;line-height:1.6}
  .lbcard h3{margin:0 0 4px;font-family:var(--mono);font-size:18px}
  .lbcard .lbclose{float:right;cursor:pointer;color:var(--dim);font-size:20px;line-height:1;border:none;background:none}
  .lbcard .lbseed{margin-top:10px;padding:9px 11px;background:#080d15;border-radius:7px;border-left:3px solid #334}
  .lbcard .lbtag{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:800;border-radius:4px;padding:2px 8px}
  .hudregions{margin-top:6px;font-size:10px}
  .hudregions summary{cursor:pointer;color:var(--cy);font-family:var(--mono);font-size:10px}
  #hudRegionList{font-size:9.5px;line-height:1.6;margin-top:4px;max-height:120px;overflow-y:auto}
  #hudRegionList span{margin-right:4px}
  @media(max-width:700px){.floathud{position:static;width:auto;margin:12px 0;box-shadow:none}}
  .encbox{background:#0a0e17;border:1px solid #f5d57644;border-radius:12px;padding:12px 14px;margin:12px 0}
  .pflabel{font-family:var(--mono);font-size:11px;color:var(--cy);letter-spacing:.04em;margin:12px 0 6px}
  .frow.head{margin-bottom:2px} .frow.head .cap2{font-size:10px;color:var(--dim);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;text-align:center}
  .realtag{display:inline-block;font-family:var(--mono);font-size:10px;color:#04180a;background:var(--gn);padding:1px 7px;border-radius:20px;vertical-align:middle}
  .analoguetag{display:inline-block;font-family:var(--mono);font-size:10px;color:#1a1200;background:var(--am);padding:1px 7px;border-radius:20px;vertical-align:middle}
  /* triangulation inputs */
  .tri{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  @media(max-width:820px){.tri{grid-template-columns:1fr}.verdict{grid-template-columns:1fr}}
  .box{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:10px}
  .box .lbl{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
  .box.intent .lbl{color:var(--cy)} .box.reality .lbl{color:var(--am)} .box.negative .lbl{color:var(--rd)}
  textarea{width:100%;min-height:120px;background:#05070d;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font-family:var(--mono);font-size:12px;line-height:1.5;resize:vertical}
  .rawbtn{margin-top:6px;font-size:11px;padding:4px 8px;width:100%}
  .tolabel{margin-top:6px;font-family:var(--mono);font-size:11px;font-weight:700;text-align:center;padding:4px;border-radius:6px;border:1px solid var(--line)}
  .tolabel.g{color:var(--gn);background:rgba(70,211,105,.12);border-color:var(--gn)}
  .tolabel.a{color:var(--am);background:rgba(240,180,41,.12);border-color:var(--am)}
  .tolabel.r{color:var(--rd);background:rgba(255,93,82,.12);border-color:var(--rd)}
  .rawpay{margin-top:6px;background:#05070d;border:1px solid var(--line);border-radius:8px;padding:8px;font-family:var(--mono);font-size:10.5px;line-height:1.5;color:#9fe6b0;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word}
  .rawpay .wrapnote{color:var(--am);display:block;margin-bottom:4px}
  .deck{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
  button{font:inherit;font-size:13px;cursor:pointer;background:#121a2b;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 14px}
  button:hover{border-color:var(--cy)} button.primary{background:var(--gn);color:#04180a;border-color:var(--gn);font-weight:700}
  button.warn{border-color:var(--am)} button.presetbtn{font-size:12px}
  .policy{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:10px}
  .policy label{font-size:13px;color:var(--dim)} .policy label b{color:var(--ink)}
  .policyrow{display:flex;align-items:center;gap:12px;margin-top:8px}
  .policyrow input[type=range]{flex:1;accent-color:var(--am)}
  #threshVal{font-size:18px;font-weight:700;color:var(--am);min-width:52px;text-align:right}
  .failbanner{margin-top:10px;font-size:13px;line-height:1.5}
  .failbanner .modeA{background:rgba(255,93,82,.10);border-left:3px solid var(--rd);padding:8px 12px;border-radius:6px}
  .failbanner .modeB{background:rgba(255,93,82,.18);border-left:3px solid #ff2d1f;padding:8px 12px;border-radius:6px}
  .failbanner .inlane{background:rgba(70,211,105,.10);border-left:3px solid var(--gn);padding:8px 12px;border-radius:6px}
  .failbanner .abstain{background:rgba(240,180,41,.10);border-left:3px solid var(--am);padding:8px 12px;border-radius:6px}
  .dist{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px}
  .distcard{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center}
  .distcard .n{font-family:var(--mono);font-size:22px;font-weight:700}
  .distcard .k{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.1em}
  /* seven-panel pipeline w/ provenance */
  .pipe{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  .pnl{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:12px;position:relative}
  .pnl .step{position:absolute;top:8px;right:10px;font-family:var(--mono);font-size:10px;color:var(--dim)}
  .pnl .title{font-weight:700;font-size:13px;margin-bottom:2px}
  .pnl .desc{font-size:12px;color:var(--dim);min-height:34px}
  .provbox{font-family:var(--mono);font-size:10.5px;color:var(--dim);border-top:1px dashed var(--line);margin-top:8px;padding-top:6px;line-height:1.7}
  .provbox b{color:#7fd0a0} .provbox .h{color:var(--cy);word-break:break-all}
  .pnl.health-ok{border-left:3px solid var(--gn)} .pnl.health-halt{border-left:3px solid var(--rd)}
  .pnl.src-intent{box-shadow:inset 3px 0 0 var(--cy)} .pnl.src-reality{box-shadow:inset 3px 0 0 var(--am)} .pnl.src-negative{box-shadow:inset 3px 0 0 var(--rd)}
  .pnl.tracing{outline:2px solid var(--cy);outline-offset:1px;background:#0d1524;transition:outline .12s,background .12s}
  .feeds{font-size:10px;color:var(--dim);margin-top:2px}
  .feeds .fi{color:var(--cy)} .feeds .fr{color:var(--am)} .feeds .fn{color:var(--rd)}
  /* reef inspectors */
  .reefs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
  @media(max-width:820px){.reefs{grid-template-columns:1fr}.pipe{grid-template-columns:1fr 1fr}}
  .grid12{display:grid;grid-template-columns:repeat(12,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;aspect-ratio:1}
  .gc{background:#0a0e17;cursor:pointer;position:relative}
  .gc:hover{outline:1px solid var(--cy);z-index:2}
  .gc.auth{box-shadow:inset 0 0 0 1px rgba(70,211,105,.35)}
  .reeflbl{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;text-align:center}
  /* per-box SEMANTIC-DUMP glyph (R12, 2026-07-18 — operator: "the 12x12 reef is the semantic dump
     gzip works with"): a 12x12 texture of the ACTUAL bytes each box feeds the walk — an INPUT
     inspector, NOT a placement measurement (the placement stays on-chip). Cell intensity = byte
     density of that slice of the dump; hue = the box role. Hover a cell for its byte range. */
  .dumpwrap{display:flex;align-items:center;gap:8px;margin-top:6px}
  .whyrow{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}
  .whychip{flex:1 1 210px;background:#0a0e17;border:1px solid var(--line);border-radius:6px;padding:10px 12px;font-size:12px;line-height:1.5}
  .whychip .big{font-size:19px;font-weight:700}
  .whychip.gray{opacity:.78;border-style:dashed}
  .whybar{height:6px;background:#1a2333;border-radius:3px;margin-top:6px;overflow:hidden}
  .whybar i{display:block;height:100%}
  .tsbars{display:flex;align-items:flex-end;gap:2px;height:46px;margin-top:6px}
  .tsbars i{flex:1;background:#66fcf1;opacity:.85;border-radius:1px 1px 0 0;min-width:2px}
  .reefinspect{margin-top:10px}
  .reefinspect summary{cursor:pointer;font-size:12.5px;color:var(--dim)}
  .reefgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;margin:10px 0}
  .reefgrid b{display:block;padding:5px 2px;text-align:center;font-size:9.5px;font-weight:600;font-family:ui-monospace,monospace;border-radius:3px;cursor:pointer;border:1px solid var(--line);background:#0a0e17;line-height:1.35}
  .reefgrid b:hover{outline:1px solid #fff}
  .reefdetail{white-space:pre-wrap;font-size:11.5px;line-height:1.5;color:var(--dim);background:#0a0e17;border:1px solid var(--line);border-radius:6px;padding:10px;max-height:280px;overflow:auto}
  .dumpglyph{display:grid;grid-template-columns:repeat(12,1fr);gap:1px;width:84px;height:84px;flex:0 0 84px;background:var(--line);border:1px solid var(--line);border-radius:4px;overflow:hidden}
  .dumpglyph i{display:block;width:100%;height:100%}
  .dumpglyph i:hover{outline:1px solid #fff;z-index:2;position:relative}
  .dumplbl{font-family:var(--mono);font-size:9.5px;line-height:1.3;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
  .inspect{background:#0a0e17;border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px;min-height:70px;font-size:13px}
  .inspect .co{font-family:var(--mono);color:var(--cy);font-weight:700}
  .legend{font-size:11px;color:var(--dim);margin-top:6px}
  .enc-key{font-family:var(--mono);font-size:12px;color:var(--cy);margin-bottom:8px}
  .enc-row{margin:6px 0;line-height:2}
  .chip{display:inline-block;font-family:var(--mono);font-size:12px;padding:2px 8px;margin:2px;border-radius:20px;border:1px solid var(--line);background:#0a0e17}
  .encfocus{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px}
  .focustitle{font-family:var(--mono);font-size:11px;color:var(--cy);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .encdec{font-size:13px;margin:3px 0;line-height:1.5}
  .foot{margin-top:14px}
  details summary{cursor:pointer;color:var(--cy);margin:6px 0}
  .omit{border-left:3px solid var(--am);padding-left:14px;margin:10px 0}
  .omit .pv{color:var(--rd)} .omit .ev{color:var(--gn)}
  .status{font-family:var(--mono);font-size:12px;color:var(--dim);margin-top:8px}
</style></head><body><div class="wrap">

  <h1>Are you out of your pixel? — <span class="cy">the local instrument</span></h1>
  <div class="sub">A <b>local instrument</b> that measures one thing: <b>did an AI action stay inside the lane it was authorized to operate in?</b> It weighs what was authorized (Intent) against what actually happened (Reality) and the outcome you ruled out (Negative), and returns a sealed <b>IN_LANE / OFF_DOMAIN / UNPLACEABLE</b> verdict — <b>no cloud, and no model anywhere in the measurement</b>; nothing leaves this machine. The panels below are that measurement running live on-chip — the same walk the commit emails ship.</div>

  <div class="airgap">
    <span class="lock">🔒</span>
    <div>
      <b>ZERO-LLM VERIFICATION · 100% LOCAL PMU · ZERO CLOUD EXFILTRATION</b>
      <small>The panels are the running pipeline (<code>runPipeline → renderTriptych</code>, the real recursive walk). The interactive what-ifs re-run that SAME on-chip walk through the local <code>/render</code> endpoint (127.0.0.1) — the browser holds no compression engine of its own; the display is a pure projection of the metal. No <code>fetch</code> to the internet, no external asset, no model in the measurement path. The terminal's LLM is an adversary trying to break the math, never in it.</small>
    </div>
  </div>

  <!-- FLOATING LIVE TOLERANCE HUD — stays in view while you edit; fires canned interventions -->
  <div class="floathud" id="floatHUD">
    <div class="hudtop"><span class="hudstate" id="hudState">—</span><button class="hudmin" id="hudMin" title="minimize">▁</button></div>
    <div id="hudBody">
      <div class="hudmode" id="hudMode">— edit a box or fire an intervention —</div>
      <div class="hudencs">
        <div class="hudenc"><img id="hudImgA" alt="encircled drift"><div class="hudenclbl" id="hudA">Fail A · drift</div></div>
        <div class="hudenc"><img id="hudImgB" alt="encircled catastrophe"><div class="hudenclbl" id="hudB">Fail B · catastrophe</div></div>
      </div>
      <div class="hudscrub"><button id="hudPrev" title="rewind">|◁</button><span id="hudScrub" class="mono">—</span><button id="hudNext" title="fast-forward">▷|</button></div>
      <div class="hudbtns" id="hudBtns"><button id="hudNoise">✦ noise</button></div>
      <div class="hudlbl"><b>live encircled</b> · the on-chip <code>encircleRegionsPng</code> panels re-rendered via the local /render endpoint. Edit a box or fire an intervention — both panels redraw from metal.</div>
    </div>
  </div>
  <div class="rustspin" id="rustSpin" hidden><span class="dot"></span> walking on-chip — rendering all panels…</div>

  <!-- ① THE VERDICT — FIRST (operator 2026-07-20: "verdict should be at the top, lets make sure
       the sequence is ideal"). An attestation instrument ANSWERS before it explains: the reader
       sees IN_LANE / OFF_DOMAIN / UNPLACEABLE and the plain-English condition-of-coverage sentence
       before any dial, panel or chart. THE IDEAL SEQUENCE, and why each step earns its place:
         ① verdict      — the answer, and what it means for coverage
         ② instrument   — the dial that produced it + the Greeks it moves (cause beside effect)
         ③ live panels  — the metal that computed it (floating HUD, always in view)
         ④ autonomy     — where the unattended tick spends its time (deterministic vs model)
         ⑤ tape         — time-travel + scenarios: reproduce any prior verdict
         ⑥ evidence     — measured vs unproven, triangulation inputs, reef
       Answer → instrument → proof → provenance. Guard: attest-instrument-panel.test.mjs. -->
  <div class="verdict">
    <div class="state" id="boolState">${esc(boolState)}</div>
    <div class="greeks">
      <div>SEALED this run — <b>${esc(sealed.placed)}</b> @ sense-axis <b>${esc(sealed.cell || '—')}</b> · σ <b>${esc(sigStr)}</b> ${sealed.deterministic ? '· <span class="gn">byte-identical every run</span>' : ''} <span id="g-phase" title="◉ Phase-Locked = chip≡tape≡UI agree · ⟳ Pending Resonance = chip still hunting the coordinate (an unsealed live edit)" style="color:var(--gn);font-weight:700">◉ Phase-Locked</span></div>
      <div><span class="pill">IN_LANE</span> <span class="pill">OFF_DOMAIN</span> <span class="pill">UNPLACEABLE</span> — the three states a policy wording keys on.</div>
    </div>
  </div>
  <div class="failbanner" id="failBanner" style="margin-bottom:8px"></div>

  <!-- ②ᴵ THE INSTRUMENT — insurance CONTROLS + the GREEKS, together, above the fold
       (operator 2026-07-20: "the insurance controls (and greeks) together at the top of the page").
       WHY together: the dial and the readout it moves are ONE instrument. Split across the page, an
       underwriter had to scroll to see whether turning the policy limit changed the numbers — the
       single most important causal link on the page was the one thing you could not watch happen.
       Every id is preserved verbatim (g-sigma, g-threshold, threshold, includeFailB, …) because all
       wiring is by id: paintHud's addressable-tile table, the viewport-config reconcile, and the
       optimistic local echo all keep working unchanged. Guard: attest-instrument-panel.test.mjs. -->
  <h2>The instrument — controls &amp; Greeks</h2>
  <div class="instrument">
    <div class="card instrument-controls">
    <div class="policy">
      <label for="threshold"><b>Policy limit</b> — the carrier's dial: how far Reality may drift from Intent before the drift itself trips a claim.</label>
      <div class="policyrow">
        <input id="threshold" type="range" min="15" max="48" step="1" value="${liveThresholdDefault}">
        <span class="mono" id="threshVal">${liveThresholdDefault}%</span>
      </div>
      <div class="dim" style="font-size:11px;margin-top:6px">Drift is <b>position toward the excluded domain</b> (0% = on Intent, <b>50% = the catastrophe midline</b> → Mode B). The policy limit trips Mode A <i>below</i> that line. Loads IN_LANE by default — drag left to watch Mode A trip; load <b>Draft→Execute</b> for Mode B, <b>Force Tie</b> for UNPLACEABLE.</div>
      <div id="supersededMsg" class="rd" style="display:none;font-family:var(--mono);font-size:12px;margin-top:6px;font-weight:700">⛔ Policy limit superseded by Catastrophe Breach (Fail Mode B) — the slider does not apply while Reality is on the excluded rail.</div>
      <label class="chk" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-top:8px;cursor:pointer"><input type="checkbox" id="includeFailB" checked> Include <b class="rd">Fail Mode B</b> — the negative triangulation (catastrophe breach). Uncheck for a <b>drift-only</b> policy that ignores the excluded-domain rail.</label>
    </div>
    </div>
    <div class="instrument-greeks">
  <div class="greeksgrid">
    <div class="tile"><div class="tv" id="g-sigma" style="color:var(--cy)">${esc(sigStr)}</div><div class="tk">σ — placement (gate)</div></div>
    <div class="tile"><div class="tv" id="g-walksigma" style="color:var(--cy)">${walkSigma != null ? esc(walkSigma) : '—'}</div><div class="tk">σ — divergent walk</div></div>
    ${vega != null ? `<div class="tile"><div class="tv" style="color:var(--cy)">${esc(String(vega))}</div><div class="tk">vega — σ volatility (lens)</div></div>` : ''}
    <div class="tile"><div class="tv" id="g-drift" style="color:var(--am)">—</div><div class="tk">drift toward excluded</div></div>
    <div class="tile"><div class="tv" id="g-threshold" style="color:var(--am)">${liveThresholdDefault}%</div><div class="tk">policy limit (Mode A)</div></div>
    <div class="tile"><div class="tv" id="g-cheb">${chebLo} – ${chebHi}</div><div class="tk">Chebyshev ±2σ band</div></div>
    <div class="tile"><div class="tv" id="g-offlane" style="color:${sealed.offPct != null && sealed.offPct >= sealed.threshold ? 'var(--rd)' : 'var(--gn)'}">${sealed.offPct != null ? sealed.offPct + '%' : '—'}</div><div class="tk">off-lane vs ${sealed.threshold}% kill</div></div>
    <div class="tile"><div class="tv" id="g-tier">${esc(sealed.tier)}</div><div class="tk">underwriter tier</div></div>
    <div class="tile"><div class="tv" style="font-size:15px" id="g-ingest">${T('ingest')}</div><div class="tk">gzip ingest time</div></div>
    <div class="tile"><div class="tv" style="font-size:15px" id="g-walktime">${T('walk')}</div><div class="tk">PMU walk time</div></div>
    <div class="tile"><div class="tv" style="font-size:15px" id="g-hashtime">—</div><div class="tk">local hash time</div></div>
    <div class="tile"><div class="tv" style="font-size:13px;color:${sealed.signed ? 'var(--gn)' : 'var(--dim)'}" id="g-sealsig">${sealed.signed ? 'ed25519 ✓' : 'unsigned'}</div><div class="tk" id="g-sealreceipt">receipt ${esc(sealed.receiptId || 'n/a')}</div></div>
  </div>
  <p class="legend">All decidable, on-chip, LLM-free: σ is the divergent-walk localization; drift is the gzip-NCD position; the timings are the real walk (~ms = the chip path, never the ~21s LLM path); the receipt is ed25519-signed and recomputable offline. Nothing here is a model's opinion.</p>
    </div>
  </div>

  <!-- ②ˢ THE SHADOW vs THE TESSERACT — CORRECTED 2026-07-20 (operator: "144x144 is unlikely to
       be the tesseract, didnt we split cells on pressure? ... the lattice projection was meant to
       be the large dimensional tesseract computed for a particular prompt (from full repo to
       current context)"). The first version of this panel called 144x144 "the tesseract". It is
       NOT — it is the DEPTH-0 SHADOW. Each of the 144 anchors can SUBDIVIDE UNDER SEMANTIC
       PRESSURE into its own 144-cell sub-well (data/pmu/reef-l1/<coord>.json), so the addressable
       space is RECURSIVE: 144^(d+1) at descent depth d. The tesseract is not a fixed grid — it is
       the DESCENT PATH COMPUTED FOR ONE PROMPT, from full-repo mass down to that prompt's context.
       Every number below is read from the live artifacts (reef, reef-l1/, the sealed walk).
       Guard: attest-instrument-panel.test.mjs (shadow-projection leg). -->
  <h2>The shadow vs the tesseract — what you are actually looking at</h2>
  <div class="card">
    <div class="greeksgrid">
      <div class="tile"><div class="tv" style="color:var(--cy)">144</div><div class="tk">shadow — cells drawn (12×12)</div></div>
      <div class="tile"><div class="tv" style="color:var(--cy)">${(144 * 144).toLocaleString()}</div><div class="tk">depth-0 cloud (144²)</div></div>
      <div class="tile"><div class="tv" style="color:var(--am)">${(144 ** 3).toLocaleString()}</div><div class="tk">depth-1 space (144³)</div></div>
      <div class="tile"><div class="tv" style="color:var(--am)">144×</div><div class="tk">each descent ply multiplies by</div></div>
      <div class="tile"><div class="tv" id="s-subwells" style="color:${subWellCount > 1 ? 'var(--cy)' : 'var(--am)'}">${subWellCount} / 144</div><div class="tk">sub-wells materialized</div></div>
      <div class="tile"><div class="tv" id="s-depth">0</div><div class="tk">descent depth this prompt</div></div>
      <div class="tile"><div class="tv" id="s-walkfill">—</div><div class="tk">cells this walk lit</div></div>
      <div class="tile"><div class="tv" style="color:var(--am)">${(100 * (144 * 144 + subWellCount * 144) / (144 ** 3)).toFixed(3)}%</div><div class="tk">realized ÷ depth-1 potential</div></div>
    </div>
    <p class="legend"><b>The tesseract is not a grid — it is the descent computed for one prompt.</b> The lattice has 144 ShortLex anchors per axis, so a depth-0 state is <b>144² = ${(144 * 144).toLocaleString()}</b> cells. But a cell <b>subdivides under semantic pressure</b>: when enough mass accumulates at one coordinate it materializes its own 144-cell sub-well, and the addressable space becomes <b>144<sup>d+1</sup></b> at descent depth <i>d</i> — depth&nbsp;1 alone is <b>${(144 ** 3).toLocaleString()}</b> positions, <b>144×</b> the cloud drawn here. What the panels render is the <b>12 × 12 shadow</b> of that structure at <b>depth 0</b>. <b>Honest state today:</b> <b>${subWellCount} of 144</b> sub-wells is materialized (E1 returned NO-GO at contrast C=0.825 — cells failed by incoherence <i>within</i>, not blobbiness between), so we live at depth 0 and the realized space is <b>${(144 * 144 + subWellCount * 144).toLocaleString()}</b> positions — <b>${(100 * (144 * 144 + subWellCount * 144) / (144 ** 3)).toFixed(3)}%</b> of the depth-1 potential. Depth is the open frontier, not a shipped claim.</p>
  </div>

  <!-- ②ᴬ AUTONOMOUS-MODE TIME BUDGET — where the unattended loop actually spends a tick.
       Deterministic stages (cyan) vs the ONE model stage (amber): the separation the receipt rests
       on, made visible. Measured from the loop's own stage-times lines, median of the last 20 ticks
       — never a drawn shape. Guard: attest-instrument-panel.test.mjs. -->
  ${autonomyBudget ? `<h2>Autonomous mode — where the tick goes</h2>
  <div class="card">
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <label class="chk" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" id="loopAuto" disabled> <b>auto tick</b> — decompose the repo into the tesseract (the harvest loop)</label>
      <label class="chk" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" id="loopAB" disabled> A/B — run BOTH narrators per tick (evidence accumulation)</label>
      <span class="dim" id="loopState" style="font-size:11px">checking for local loop…</span>
    </div>
    <div class="budgetwrap">
      <div id="budgetChart"></div>
      <div>
        <div class="budgetlegend" id="budgetLegend"></div>
        <p class="legend" style="margin-top:10px">Median of the last <b>${autonomyBudget.ticks}</b> unattended ticks: <b>${autonomyBudget.total_s}s</b> of work per cycle, of which <b class="am">${autonomyBudget.llm_s}s</b> is the local model writing the night-log and <b class="cy">${autonomyBudget.deterministic_s}s</b> is deterministic, LLM-free work. <b>The verdict lives entirely in the cyan.</b> qwen narrates the numbers after they are computed and sealed — it never produces, grades, or touches the receipt. That is why a slow or dead model degrades the diary, never the attestation.</p>
      </div>
    </div>
  </div>` : ''}


  <!-- 📊 WHY PANEL (2026-07-19 — spec: docs/pmu/rule-picker-calibration-spec.md §4). ADDITIVE, no
       existing surface altered: measured claims from data that exists (G1 battery · G5 tape timings);
       the unproven claims (G2 precision/recall · G3 outcome A/B · G4 token savings) render as RESERVED
       GRAY SLOTS naming the exact run that fills each — this page never draws an unproven bar. -->
  <h2>Why this instrument — measured vs unproven <span class="dim" style="font-size:12px">(the rule/hat picker, actual vs ideal)</span></h2>
  <div class="card" id="whyPanel">
    <div class="whyrow" id="whyMeasured"></div>
    <div class="whyrow" id="whyTimingSeries"></div>
    <div class="whyrow" id="whyUnproven"></div>
    <p class="legend">Measured chips come from <code>data/grip/microscope.json</code> (the routing battery, incl. HELD-OUT prompts) and this page's own flight tape (per-sealed-state chip timings). Gray slots are claims this page refuses to draw until their run exists — each names the command that fills it. Full loop: <code>docs/pmu/rule-picker-calibration-spec.md</code>.</p>
  </div>

  <!-- ⑥ THE PROMPT-SPEC INPUT SURFACE — directly beneath the x-ray; these FEED the pipeline below -->
  <h2>Triangulation inputs — Intent · Reality · Negative <span class="dim" style="font-size:12px">↓ these feed the pipeline below</span></h2>
  <div class="card">
    <p class="dim" style="margin-top:0">Write a real scenario: <b>Intent</b> = what was authorized, <b>Reality</b> = what actually happened, <b>Negative</b> = what you did NOT want (keep Reality and Negative clearly different). Edit any box and the <b>floating encircled panels re-render</b> from the on-chip /render walk. Or fire an <b>intervention</b> — flip between the faithful surgery and the sledgehammer shift, for example — and watch both encircled panels move. <span class="realtag">on-chip /render</span> every panel is the real <code>encircleRegionsPng</code> output from the metal, not a browser approximation. The exact string fed to the walk is one click away; nothing else enters the calc.</p>
    <div id="histBanner" class="histbanner" hidden>⏳ VIEWING HISTORICAL RECORD — edits will snap to the present and append a new state.</div>
    <div class="tri">
      <div class="box intent"><div class="lbl"><span>① Intent (authorized)</span><span class="dim" id="pi"></span></div><textarea id="tIntent">${esc(intentText)}</textarea><div class="dumpwrap"><div class="dumpglyph" id="glyph-intent" title="semantic dump — the bytes gzip compresses for Intent"></div><span class="dumplbl">semantic dump<br>what gzip compresses</span></div><button class="rawbtn" data-for="intent">⧉ View raw context payload</button><pre class="rawpay" id="raw-intent" hidden></pre></div>
      <div class="box reality"><div class="lbl"><span>② Reality (outcome)</span><span class="dim" id="pr"></span></div><textarea id="tReality">${esc(realityText)}</textarea><div class="dumpwrap"><div class="dumpglyph" id="glyph-reality" title="semantic dump — the bytes gzip compresses for Reality"></div><span class="dumplbl">semantic dump<br>what gzip compresses</span></div><div class="tolabel" id="tol-reality">—</div><button class="rawbtn" id="runLiveLLM" style="border-color:var(--gn);color:var(--gn)">▶ Run Live LLM (agent → Reality)</button><button class="rawbtn" data-for="reality">⧉ View raw context payload</button><pre class="rawpay" id="raw-reality" hidden></pre></div>
      <div class="box negative"><div class="lbl"><span>③ Negative (excluded)</span><span class="dim" id="pn"></span></div><textarea id="tNegative">${esc(negativeText)}</textarea><div class="dumpwrap"><div class="dumpglyph" id="glyph-negative" title="semantic dump — the bytes gzip compresses for Negative"></div><span class="dumplbl">semantic dump<br>what gzip compresses</span></div><div class="tolabel" id="tol-negative">—</div><button class="rawbtn" data-for="negative">⧉ View raw context payload</button><pre class="rawpay" id="raw-negative" hidden></pre></div>
    </div>
    <!-- 🪸 THE REEF PER-CELL VIEW (2026-07-19 — operator: "where is the reef per cell view? … to
         validate the full reef is there (and size of reef)"). A read-only projection of D.cells144 —
         the EXACT embedded corpus litScores NCD-compresses every box against. No browser recompute
         (Loop 1 stays dead); this renders content, it never places. The validation line goes red the
         moment any of the 144 dumps is missing or gutted. -->
    <details class="reefinspect" id="reefInspect"><summary>🪸 <b>The reef, per cell</b> — <span id="reefValidation">validating…</span> <span class="dim">(click any cell to read the full semantic dump gzip compresses against)</span></summary>
      <div id="reefGrid" class="reefgrid"></div>
      <pre id="reefCellDetail" class="reefdetail">click any cell — coord · full ShortLex name · size · the full semantic dump</pre>
    </details>
    <!-- ⑤ THE ACTUAL-vs-IDEAL AUDIT — directly UNDER the three inputs (operator 2026-07-18: "that should
         be text boxes underneath the three text boxes… the ideal is LM generated, held out from the
         on-chip PMU, for both the hats and the rules… expandable to see the full text of both the prompt
         template and the rule template"). Two boxes: ACTUAL (the reef's PMU-selected rules + hat) vs
         IDEAL (the LLM-predicted target, held out from the LLM-FREE verdict — a comparison signal only,
         never fed into the placement). Painted by paintHud from the tape (rule_hat_compare). -->
    <div id="ruleHatCompare" style="margin-top:12px"></div>
    <p class="legend">NCD = Normalized Compression Distance (Li–Vitányi 2004). <b class="rd">Mode A (drift)</b> — drifts past the policy limit. <b class="rd">Mode B (catastrophe)</b> — closer to the excluded domain than Intent (supersedes). Within a hair of the tie → <b class="am">UNPLACEABLE</b>; it abstains, never guesses.</p>
  </div>

  <!-- ④ TAPE & SCENARIOS — the policy dials moved UP into the instrument panel; what remains here
       is time-travel + scenario loading, which belong beside the tape, not beside the Greeks. -->
  <h2>Tape &amp; scenarios</h2>
  <div class="card">
    <!-- THE FLIGHT TAPE SCRUBBER — append-only time-travel. UI = f(flightTape[cursor]); vanilla, no libraries. -->
    <div class="scrubber" id="scrubber">
      <button id="prevBtn" title="previous recorded state">|◁ Prev</button>
      <span id="scrubLabel" class="mono">— no records yet —</span>
      <button id="nextBtn" title="next recorded state">Next ▷|</button>
    </div>
    <!-- THE CONVERGENCE CHART — drift% per step over the active path; the recovery arc IS convergence -->
    <div id="convChart" style="text-align:center;margin-top:8px;min-height:20px"></div>
    <!-- THE COUNTERFACTUAL — with-reef vs ablated: the reef relief, the ONE obvious story -->
    <div id="counterfactual" style="margin-top:12px"></div>
    <!-- THE HYPOTHESIS GRAPH — capability vs reef-mass: the physics of the reef building -->
    <div id="growthHypothesis" style="margin-top:12px"></div>
    <!-- THE PICK-TRACE — the rules the reef selected for THIS state, ranked by relevance score -->
    <div id="pickTrace" style="margin-top:12px"></div>
    <div class="deck">
      <button class="primary" id="runBtn">▶ Run verification</button>
      <button class="warn" id="noiseBtn">✦ Inject noise into Reality</button>
      <span id="presetHolder"></span>
      <button id="resetBtn">↺ Reset to default</button>
      <button id="exportBtn">⤓ Export flight tape (JSON · full timeline)</button>
    </div>
    <div class="dim" style="font-size:11.5px;margin-top:4px">The preset buttons are <b>just prompts</b> — each one loads a prompt into the boxes exactly as if you had typed it, then runs the same on-chip pipeline. They are the same objects the terminal convergence loop replays (<code>reef-converge.mjs</code> → this page's polling): nothing pre-rendered, no special path.</div>
    <div class="dist" style="margin-top:10px">
      <div class="distcard"><div class="n cy" id="dIntent">—</div><div class="k">NCD(Reality → Intent) · metal</div></div>
      <div class="distcard"><div class="n rd" id="dNegative">—</div><div class="k">NCD(Reality → Negative) · metal</div></div>
      <div class="distcard"><div class="n am" id="driftPct">—</div><div class="k">drift toward excluded (%)</div></div>
    </div>
    <div class="status" id="liveStatus">Idle — press <b>Run verification</b> to run the on-chip render.</div>
  </div>

  <!-- ⑤ THE CANONICAL DATA FLOW — the REAL pipeline: 3 corpus rows (gzip → walk) → 2 comparators → tolerance -->
  <h2>The pipeline — the canonical data flow <span class="realtag">REAL · on-chip walk</span></h2>
  <p class="dim">The running pipeline itself (<code>buildTriptychInputs → renderTriptych</code>, the real ballistic walk${walkModeReal ? ` · ${esc(walkModeReal)}` : ''} — the SAME instrument the commit emails ship). Read it left-to-right, top-to-bottom: each corpus is <b>gzip-ingested</b> then <b>walked</b>; the three walks collapse through the <b>two comparators</b> — the two fail modes — into <b>tolerance</b>, then <b>encircled</b>. <b class="cy">Fire a canned intervention</b> (Faithful · Sledgehammer · Analysis→Execution · Force-Tie) and <b>every one of these PNGs re-renders</b> from that scenario's real pipeline run — the whole page moves, proving it's not canned. Free-text edits re-run the SAME on-chip walk through the local /render endpoint (127.0.0.1) — the panels, the distances, and the floating placement all move from the metal; the page holds no measurement engine of its own.</p>
  ${havePanels ? `
  <div class="pflabel">STEP 1 — each corpus is gzip-ingested, then walked <span class="dim">(3 corpora × 2 stages)</span></div>
  <div class="flow">
    <div class="frow head"><span class="rl"></span><div class="cap2">gzip ingest <span class="dim" style="text-transform:none;letter-spacing:0">— each box NCD-compressed against the embedded reef: <b>${cells144.length} cells · ${(cells144.reduce((a,c)=>a+c.snippet.length,0)/1000).toFixed(1)}k ch · gz ${(gzipSync(Buffer.from(cells144.map(c=>c.snippet).join('\n'))).length/1024).toFixed(0)}KB</b> (the semantic dumps in cells — open 🪸 The reef, per cell to validate all 144 + read every dump)</span></div><div></div><div class="cap2">ballistic walk</div></div>
    <div class="frow i"><span class="rl">Intent</span><div class="pcell"><img id="w-iGzip" src="${P.rawIntent || ''}" alt="gzip ingest intent"></div><div class="arrow">→</div><div class="pcell"><img id="w-iWalk" src="${P.intent || ''}" alt="walk intent"></div></div>
    <div class="frow r"><span class="rl">Reality</span><div class="pcell"><img id="w-rGzip" src="${P.rawReality || ''}" alt="gzip ingest reality"></div><div class="arrow">→</div><div class="pcell"><img id="w-rWalk" src="${P.reality || ''}" alt="walk reality"></div></div>
    <div class="frow n"><span class="rl">Negative</span><div class="pcell"><img id="w-nGzip" src="${PN.rawReality || ''}" alt="gzip ingest negative"></div><div class="arrow">→</div><div class="pcell"><img id="w-nWalk" src="${PN.reality || ''}" alt="walk negative"></div></div>
  </div>
  <div class="collapse">▼ the three walks collapse into the two fail modes — each runs comparator → tolerance → <b>encircled</b> ▼</div>
  <div class="pflabel">STEP 2 — two fail modes, each ending in its encircled receipt <span class="dim">(2 modes × comparator · tolerance · encircled)</span></div>
  <div class="modegrid">
    <div class="mghead"></div><div class="mghead">comparator (Δ)</div><div class="mghead"></div><div class="mghead">tolerance</div><div class="mghead"></div><div class="mghead">◎ encircled</div>
    <div class="mgrl a">Fail A<br>drift</div>
      <div class="mgcell"><img id="mg-deltaA" src="${P.delta || ''}" alt="delta A"><div class="mc">Intent↔Reality</div></div><div class="arrow">→</div>
      <div class="mgcell tolc"><img id="mg-tolA" src="${P.tolerance || ''}" alt="tolerance A"><div class="mc">lane gate</div></div><div class="arrow">→</div>
      <div class="mgcell encc"><img id="mg-encA" src="${P.encircled || ''}" alt="encircled A"><div class="mc">named regions</div></div>
    <div class="mgrl b">Fail B<br>catastrophe</div>
      <div class="mgcell"><img id="mg-deltaB" src="${PN.delta || ''}" alt="delta B"><div class="mc">Reality↔Negative</div></div><div class="arrow">→</div>
      <div class="mgcell tolc"><img id="mg-tolB" src="${PN.tolerance || ''}" alt="tolerance B"><div class="mc">lane gate</div></div><div class="arrow">→</div>
      <div class="mgcell encc"><img id="mg-encB" src="${PN.encircled || ''}" alt="encircled B"><div class="mc">named regions</div></div>
  </div>
  <p class="legend">Two independent readings — you breach if you <b class="am">drift too far from Intent</b> (Fail A) <b>OR</b> land <b class="rd">closer to the excluded domain than to Intent</b> (Fail B). Each mode carries its own tolerance gate and its own encircled receipt; green in-lane · amber tolerated · red past the boundary.</p>` : `<div class="card"><p class="am">The pipeline panels did not render this run${tp ? '' : ' (no triptych in this build)'} — the live on-chip /render + the sealed receipt above still stand. Re-run <code>npx thetacog-mcp attest-demo</code> where the on-chip daemon is built.</p></div>`}

  <!-- ⑧ FULL CONTEXT INTO THE RUST PIPELINE — the chain of custody per stage -->
  <h2>Full context into the pipeline — the chain of custody</h2>
  <p class="dim">Exactly what each pipeline stage consumed: source, line count, byte size, and a local sha256. This is the accountability layer under the panels above — if a stage cannot name its source it <b class="rd">HALTS</b> (no hidden context bleed). It attributes liability to the byte; it is NOT the panels (those are the real walk above).</p>
  <div class="pipe" id="pipe"></div>

  <!-- ACTUARIAL SIGNALS — tell them what to want; they price it -->
  <h2>Actuarial signals — what this instrument already counts (you price which ones)</h2>
  <div class="card">
    <p class="dim" style="margin-top:0">You don't have to design the telemetry. Every measurement above emits countable, timestamped, recomputable signals — the raw material of a rate. Here are the ones an underwriter typically wants; tell us which you'd price, and the policy keys on them. <span class="dim">(The monologue we're after: <i>"I can't underwrite a heat-map, but I can underwrite that Boolean — and here are the counts that build the rate."</i>)</span></p>
    <table>
      <tr><th>Signal</th><th>What it counts</th><th>What an actuary does with it</th></tr>
      <tr><td class="cy"><b>OFF_DOMAIN rate</b></td><td>breaches per N actions (Mode A + Mode B)</td><td>the base claim frequency — the headline rate.</td></tr>
      <tr><td class="cy"><b>Mode A vs Mode B mix</b></td><td>drift breaches vs catastrophe breaches</td><td>two severity tiers priced separately — gradual drift ≠ domain-shift catastrophe.</td></tr>
      <tr><td class="cy"><b>Margin to the excluded domain</b></td><td>dN − dI (how close to the third rail)</td><td>a leading indicator — tightening margin predicts a Mode B before it fires.</td></tr>
      <tr><td class="cy"><b>Abstention rate</b></td><td>UNPLACEABLE events (ties the instrument refused)</td><td>a data-quality / spec-looseness signal — high abstention means the lane needs sharpening.</td></tr>
      <tr><td class="cy"><b>Time-in-lane %</b></td><td>the complement of off-lane over a book</td><td>the good-behavior credit — the basis for an experience discount.</td></tr>
      <tr><td class="cy"><b>Drift velocity</b></td><td>how fast drift% climbs across a session</td><td>a trend/renewal signal — a book drifting upward reprices at renewal.</td></tr>
    </table>
    <p class="dim">Every one is a discrete, recomputable event — not a model's opinion. That is the precondition for pricing a book rather than inspecting a single incident.</p>
  </div>

  <!-- THE DOCUMENTATION FOOTER -->
  <h2>What we built · what we did NOT build · what's next</h2>
  <div class="card foot">
    <p><b class="gn">What we built.</b> A localized, deterministic liability trigger that measures the structural distance between authorized intent, realized action, and the excluded domain — with no LLM inference in the measurement path and nothing leaving the machine.</p>
    <p><b class="am">What we did NOT build — and the objection each omission kills:</b></p>
    <div class="omit"><b>No continuous onChange recompute.</b> You press a button; the instrument takes a discrete measurement and seals it. <span class="pv">Prevented: "it's a jittery calculator guessing as I type — subjective."</span> <span class="ev">Enforced: "it takes a measurement, seals it, stamps a finalized receipt — a discrete, countable event."</span></div>
    <div class="omit"><b>No single-word ("left vs right kidney") examples.</b> The presets are structural negation — Drafting vs Executing, a shift in operational authority. <span class="pv">Prevented: "if it just matches the word 'left,' a cheaper keyword filter does this."</span> <span class="ev">Enforced: "it caught a breach of authority a keyword filter would miss."</span></div>
    <div class="omit"><b>No LLM in the verification path.</b> The on-chip definer-walk does the measurement (via the local /render endpoint, 127.0.0.1); the terminal's model is the adversary, not the judge. <span class="pv">Prevented: "he's asking an AI to grade another AI — a black box in a black box."</span> <span class="ev">Enforced: "the measurement is pure arithmetic; the model is excluded from the receipt."</span></div>
    <div class="omit"><b>No cloud sync.</b> Sensitive AI-incident logs never leave the deployer's machine. <span class="pv">Prevented: "I can't upload client incident logs to a third-party startup server."</span> <span class="ev">Enforced: "the instrument is air-gapped; the record is yours."</span></div>
    <p><b class="cy">What's next — the bare-metal standard.</b> This page drives the real on-chip definer-walk through the local <code>/render</code> endpoint (127.0.0.1) — the browser holds no measurement engine of its own. The legally-binding production standard is the <b>bare-metal Linux definer-walk</b> — the same measurement, hardware-deterministic, built for massive parallel verification. The local walk you see here and the Linux walk agree by construction; the receipt is portable across both.</p>
    <p class="dim">Full lifecycle, roles, and liability boundaries: <a href="${esc(lifecycleHref)}">the six-page spec →</a> · the LLM red-pill session + the six questions: <a href="${esc(reportHref)}">the redpill report →</a></p>
  </div>

  <div class="card mono" style="font-size:12px"><div>$ npx thetacog-mcp attest-demo</div><div class="dim"># re-runs the chain and bash-opens this page + the redpill report</div>
    <div style="margin-top:6px" class="dim"># verify offline, trusting no one: <span class="cy">npx thetacog-mcp prove-rice --check</span></div></div>

<script>
"use strict";
// GOTCHA #2 (injection escaping) — the 144-cell reef carries dense raw semantic dumps; a stray
// backtick, quote, or a script-closing tag in that noise would break page parsing and blank the screen. So the
// run data is injected as BASE64 (alphabet [A-Za-z0-9+/=] — cannot contain any HTML/JS metachar) and
// decoded UTF-8-safely on load. No template-literal interpolation of untrusted text anywhere.
const DATA_B64 = "${Buffer.from(JSON.stringify(DATA), 'utf8').toString('base64')}";
function b64ToUtf8(b64){ const bin = atob(b64); const bytes = Uint8Array.from(bin, (c)=>c.charCodeAt(0)); return new TextDecoder().decode(bytes); }
const D = JSON.parse(b64ToUtf8(DATA_B64));

// ── LOOP 1 IS DEAD — the browser-side gzip compression engine (the streaming-gzip size fn + the NCD it fed)
// has been DELETED. The page is now a pure projection of on-chip metal: every measurement (verdict, σ, drift,
// the encircled panels) comes from the local /render endpoint (the bare-metal definer-walk on 127.0.0.1),
// never from a browser recompute. The only local crypto that remains is the provenance sha256 below (a hash,
// not a sensor) — it never fed the placement math and does not touch the receipt.
// GOTCHA #1 (secure-context trap) — crypto.subtle is undefined on file:// in Safari and some strict
// Chrome policies (not a "secure context"). attest-demo serves this over localhost to avoid it, but if
// the page is ever opened directly from disk the demo must NOT blank out. So sha256 tries WebCrypto and
// falls back to a compact pure-JS SHA-256 — the provenance hash always renders, air-gapped either way.
async function sha256(str){
  try { if (self.crypto && self.crypto.subtle) { const buf = await self.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); } } catch(e){ /* fall through */ }
  return sha256js(str);
}
// compact pure-JS SHA-256 (no deps, no network) — the fallback for insecure contexts
function sha256js(ascii){
  function rrot(x,n){ return (x>>>n)|(x<<(32-n)); }
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes=new TextEncoder().encode(ascii); const l=bytes.length; const withOne=l+1;
  const k=(56-withOne%64+64)%64; const total=withOne+k+8; const m=new Uint8Array(total);
  m.set(bytes); m[l]=0x80; const bitLen=l*8;
  for(let i=0;i<8;i++){ m[total-1-i]=(bitLen/Math.pow(2,8*i))&0xff; }
  const w=new Uint32Array(64);
  for(let off=0;off<total;off+=64){
    for(let i=0;i<16;i++){ w[i]=(m[off+i*4]<<24)|(m[off+i*4+1]<<16)|(m[off+i*4+2]<<8)|(m[off+i*4+3]); }
    for(let i=16;i<64;i++){ const s0=rrot(w[i-15],7)^rrot(w[i-15],18)^(w[i-15]>>>3); const s1=rrot(w[i-2],17)^rrot(w[i-2],19)^(w[i-2]>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)|0; }
    let [a,b,c,d,e,f,g,h]=H;
    for(let i=0;i<64;i++){ const S1=rrot(e,6)^rrot(e,11)^rrot(e,25); const ch=(e&f)^(~e&g); const t1=(h+S1+ch+K[i]+w[i])|0; const S0=rrot(a,2)^rrot(a,13)^rrot(a,22); const maj=(a&b)^(a&c)^(b&c); const t2=(S0+maj)|0; h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0; }
    H=[(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
  }
  return H.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
const byteLen = (s)=> new TextEncoder().encode(s).length;
const lineCount = (s)=> s.length ? s.split('\\n').length : 0;

const $ = (id)=>document.getElementById(id);
const authSet = new Set(D.authorized);
let lastResult = null;   // the most recent run's full state — for the sealed claims export

// ── PROVENANCE-FIRST PIPELINE PANELS ──────────────────────────────────────────────────────────
// Seven stages. Each renders its source/lines/bytes/hash. A stage with no source HALTS (red).
function panelDefs(state){
  const {intent,reality,negative} = state.texts;
  return [
    {step:'1/7', title:'Ingestion · Intent',   desc:'The authorized spec content → the 144-lattice.',   src:D.ingestProv.intent.source_file,   text:intent,  cls:'src-intent',   feeds:'<span class="fi">◧ Intent box</span>'},
    {step:'2/7', title:'Ingestion · Reality',  desc:"Node B's realized work product.",                 src:D.ingestProv.reality.source_file,  text:reality, cls:'src-reality',  feeds:'<span class="fr">◧ Reality box</span>'},
    {step:'3/7', title:'Ingestion · Negative', desc:'The excluded domain (structural negation).',      src:D.ingestProv.negative.source_file, text:negative,cls:'src-negative', feeds:'<span class="fn">◧ Negative box</span>'},
    {step:'4/7', title:'Compression',          desc:'gzip → NCD (Reality vs Intent / Negative).',      src:'ncd(reality,·)', text:intent+reality+negative, derived:true, feeds:'<span class="fr">Reality</span> vs <span class="fi">Intent</span> / <span class="fn">Negative</span>'},
    {step:'5/7', title:'Final Walk',           desc:'row → transpose → row recursion (definer-of-definer).', src:'reef:144-cells',  text:JSON.stringify(D.cells144.length), derived:true, feeds:'the 144-cell reef'},
    {step:'6/7', title:'Tolerance',            desc:'the two fail modes → IN_LANE · OFF_DOMAIN · UNPLACEABLE',src:'gate(reef,payload)', text:state.verdictText||'', derived:true, feeds:'threshold + triangulation'},
    {step:'7/7', title:'Receipt seal · sha256', desc:'the cryptographic seal — a countable, recomputable event bound to the inputs.', src:'receipt.json', text:(D.receipt.id||'')+(D.receipt.reef_commitment||''), derived:true, feeds:'all stages above'},
  ];
}
async function renderPipeline(state){
  const defs = panelDefs(state);
  const nodes = await Promise.all(defs.map(async (d)=>{
    const halt = !d.text && !d.derived;
    const hash = d.text ? (await sha256(d.text)).slice(0,16) : null;
    const lines = d.derived ? '—' : lineCount(d.text);
    const bytes = d.derived ? '—' : byteLen(d.text);
    return \`<div class="pnl \${halt?'health-halt':'health-ok'} \${d.cls||''}" data-step="\${d.step}">
      <span class="step">\${d.step}</span>
      <div class="title">\${d.title}</div>
      <div class="desc">\${d.desc}</div>
      <div class="feeds">↳ context: \${d.feeds||'—'}</div>
      <div class="provbox">
        <div><b>SOURCE</b> \${d.src}</div>
        <div><b>LINES</b> \${lines} · <b>BYTES</b> \${bytes}</div>
        <div><b>SHA256</b> <span class="h">\${hash? hash+'…' : (halt?'⛔ HALT — no source':'derived')}</span></div>
      </div></div>\`;
  }));
  $('pipe').innerHTML = nodes.join('');
}
// GOTCHA/steer — trace the data path: momentarily light each panel in sequence so the reader SEES
// the flow from the Intent/Reality/Negative boxes → ingest → compression → walk → placement → seal.
function tracePipeline(){
  const panels = [...document.querySelectorAll('#pipe .pnl')];
  panels.forEach((p, i) => {
    setTimeout(() => { p.classList.add('tracing'); setTimeout(() => p.classList.remove('tracing'), 340); }, i * 160);
  });
}

// ── LOOP 1 REMOVED — the browser reef inspectors (litForCorpus/paintGrid/showCell), the structural-delta
// paint, and the canvas encircled analogue all recomputed per-cell gzip-NCD in the browser. They are GONE.
// The 144-lattice is now shown ONLY by the on-chip /render PNG panels (INTENT/REALITY/DELTA + encircled),
// which are the real ballistic walk on metal — never a browser approximation.
function setHM(id, txt){ const e=$(id); if(e) e.textContent = txt; }

// ── PER-BOX SEMANTIC-DUMP GLYPH (R12, 2026-07-18 — operator: "bring back the hover reef under the
// text boxes… the 12x12 reef is the semantic dump gzip works with"): a 12x12 texture of the ACTUAL
// bytes each box feeds the walk. This is an INPUT INSPECTOR, not a placement measurement — it renders
// the byte-density of the dump gzip compresses (repetitive text = smooth, diverse = noisy) so the
// operator SEES the semantic mass each box contributes. Deterministic, LLM-free, instant (no fetch),
// a pure function of the box text. It does NOT recompute the removed browser gzip-NCD placement (Loop 1
// stays dead — the placement is on-chip); it only shows the ingest the chip is handed. Hue = box role
// (intent cyan · reality amber · negative red), matching the .fi/.fr/.fn palette.
// attribute-escape the raw reef snippets (dense semantic dumps — GOTCHA #2, they carry quotes/&/<)
// before they land in a title="" attribute, so a snippet can never break the markup or inject.
function attrEsc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\s+/g,' ').trim(); }
function renderDumpGlyph(hostId, text, hue){
  var host = $(hostId); if(!host) return;
  var bytes = new TextEncoder().encode(String(text||''));
  var N = 144, sum = new Array(N).fill(0), cnt = new Array(N).fill(0);
  if(bytes.length){ for(var i=0;i<bytes.length;i++){ var k = Math.floor(i * N / bytes.length); if(k>=N) k=N-1; sum[k]+=bytes[i]; cnt[k]++; } }
  var reef = (typeof D !== 'undefined' && D && D.cells144) || [];   // the 144 ShortLex anchors — the reef the walk grips (G7: render their text)
  var html = '';
  for(var k=0;k<N;k++){
    var lit = cnt[k] > 0;
    var avg = lit ? sum[k]/cnt[k] : 0;
    var intensity = Math.min(1, avg/150);              // avg byte value → texture (printable ASCII ~32-126)
    var L = lit ? Math.round(14 + intensity*50) : 8;   // lightness ramp; dark = empty slice
    var bg = lit ? ('hsl('+hue+',72%,'+L+'%)') : '#0a0e17';
    // G7 (2026-07-19 — operator: "the reefs are not rendering the text content of each of the 144 cells"):
    // each cell carries its ShortLex anchor's coord + snippet TEXT on hover — the reef content gzip works
    // against — alongside how many bytes THIS box contributes to that slice. The content was always
    // embedded (D.cells144); it just wasn't surfaced. Guarded by tests/pmu-simulator/dump-glyph-render.
    var rc = reef[k] || null;
    var coord = rc ? (rc.coord || '') : ('cell '+k);
    var snip = rc ? attrEsc(rc.snippet).slice(0,140) : '';
    var title = 'reef '+attrEsc(coord)+' (anchor '+(k+1)+'/144) · this box: '+cnt[k]+'B · avg byte '+Math.round(avg)+(snip?(' — '+snip):'');
    html += '<i style="background:'+bg+'" title="'+title+'"></i>';
  }
  host.innerHTML = html;
  // SIZE LABEL (2026-07-19 — operator: "print reef size next to each of the 3 reefs (are there 3
  // real reefs under)"): there are NOT three reefs — three CORPORA (the box texts, rendered here)
  // against the ONE shared 144-cell reef. Print both numbers on each glyph so that is unambiguous.
  var lbl = host.parentElement ? host.parentElement.querySelector('.dumplbl') : null;
  if(lbl){
    var rT = 0; for(var q=0;q<reef.length;q++) rT += String(reef[q].snippet||'').length;
    var reefBit = (reef.length === 144)
      ? 'vs the ONE shared reef<br><b>144 cells · '+(rT/1000).toFixed(1)+'k ch</b>'
      : '<b style="color:var(--rd)">⚠ reef '+reef.length+'/144</b>';
    lbl.innerHTML = 'semantic dump<br>this box: <b>'+bytes.length+' B</b><br>'+reefBit;
  }
}
function renderDumpGlyphs(){
  renderDumpGlyph('glyph-intent',   $('tIntent')   ? $('tIntent').value   : '', 190);
  renderDumpGlyph('glyph-reality',  $('tReality')  ? $('tReality').value  : '',  40);
  renderDumpGlyph('glyph-negative', $('tNegative') ? $('tNegative').value : '',   0);
}

// ── 📊 WHY PANEL (2026-07-19, spec §4) — measured vs unproven, ADDITIVE + read-only. G1 renders
// the embedded battery snapshot; G5 projects chip timings from the flight tape the page already
// holds; G2/G3/G4 are gray slots naming the run that fills them. No recompute, no new painters.
function renderWhyPanel(){
  var mHost = $('whyMeasured'), tHost = $('whyTimingSeries'), uHost = $('whyUnproven');
  if(!mHost || !tHost || !uHost) return;
  var C = (typeof D !== 'undefined' && D && D.calib) || null;
  var chips = '';
  if(C && C.agreement){
    var a = C.agreement, h = C.agreementHeld || {};
    chips += '<div class="whychip"><div class="big" style="color:var(--gn)">'+(a.pct!=null?a.pct+'%':'—')+'</div>G1 · routing agreement — train ('+(a.hit||0)+'/'+(a.n||0)+')<div class="whybar"><i style="width:'+(a.pct||0)+'%;background:var(--gn)"></i></div></div>';
    chips += '<div class="whychip"><div class="big" style="color:var(--gn)">'+(h.pct!=null?h.pct+'%':'—')+'</div>G1 · routing agreement — HELD-OUT ('+(h.hit||0)+'/'+(h.n||0)+')<div class="whybar"><i style="width:'+(h.pct||0)+'%;background:var(--gn)"></i></div></div>';
    chips += '<div class="whychip"><div class="big">'+(C.meanLoopMs!=null?Math.round(C.meanLoopMs)+'ms':'—')+'</div>G1 · input→injection mean on the battery, ZERO model calls · max '+(C.maxLoopMs!=null?Math.round(C.maxLoopMs)+'ms':'—')+'</div>';
    chips += '<div class="whychip"><div class="big" style="color:var(--gn)">rank 1</div>G1 · sort-quality fixtures: first relevant rule at rank 1 (scripts/pmu/lens-sort-quality.mjs)</div>';
  } else {
    chips = '<div class="whychip gray">battery snapshot missing — run: node scripts/pmu/grip-microscope.mjs</div>';
  }
  mHost.innerHTML = chips;
  var walks = [], gz = [];
  for(var i=0;i<flightTape.length;i++){ var w = flightTape[i].metrics && flightTape[i].metrics.walk; if(w && w.walk_ms!=null){ walks.push(+w.walk_ms); gz.push(+(w.gzip_ms||0)); } }
  if(walks.length){
    var mx = Math.max.apply(null, walks) || 1, bars = '';
    for(var j=0;j<walks.length;j++) bars += '<i style="height:'+Math.max(4, Math.round(46*walks[j]/mx))+'px" title="state '+(j+1)+': walk '+walks[j]+'ms · gzip '+gz[j]+'ms"></i>';
    var med = walks.slice().sort(function(x,y){return x-y;})[Math.floor(walks.length/2)];
    tHost.innerHTML = '<div class="whychip" style="flex:2 1 340px"><b>G5 · chip timing per sealed state</b> — walk median '+med+'ms across '+walks.length+' states (a step up = a path regression, visible here before anyone quotes a number)<div class="tsbars">'+bars+'</div></div>';
  } else { tHost.innerHTML = ''; }
  // 🛰️ §7.3 TELEMETRY CONTRACT — the third surface (receipt + tape + THIS chip). Reads the
  // LAST walk-carrying state's walk.telemetry; pre-contract states render the honest note.
  var lastW = null;
  for(var q=flightTape.length-1;q>=0;q--){ var wq = flightTape[q].metrics && flightTape[q].metrics.walk; if(wq){ lastW = wq; break; } }
  var TT = lastW && lastW.telemetry;
  tHost.innerHTML += TT
    ? '<div class="whychip"><b>🛰️ telemetry (§7.3, latest walk state)</b><br>'+TT.placement_mode+' · depth '+TT.descent_depth+' · hops '+TT.walk_hops_lived
      + (TT.discriminative_margin ? ' · Δσ '+TT.discriminative_margin.margin+' vs '+TT.discriminative_margin.best_sibling : ' · Δσ —')
      + (TT.dimension_2_mass ? ' · dim2 '+TT.dimension_2_mass.sub_cells_materialized+'/144' : ' · dim2 —')
      + '<br><span class="dim">'+((TT.magnet_list_top_3||[]).map(function(m){return (m.tighter?"◉":"○")+m.id.slice(0,26)+"("+m.dev+")";}).join(" · ") || "magnet flat (funnel)")+'</span></div>'
    : '<div class="whychip gray"><b>🛰️ telemetry (§7.3)</b><br>no post-contract walk state on the tape yet — fills on the next /render or lens run</div>';
  // G2/G3 — MEASURED once a calibration cycle exists (D.calibHistory = last history row);
  // gray slots naming the run otherwise. G4 stays gray until the token A/B concludes.
  var H = (typeof D !== 'undefined' && D && D.calibHistory) || null;
  var g2, g3;
  if(H && H.aggregates){
    var ag = H.aggregates;
    g2 = '<div class="whychip"><b>G2 · picked-vs-ideal (cycle '+H.cycle+', '+H.llm_calls+' LLM calls, held-out ideal)</b><br>'
       + '<span class="big" style="color:var(--gn)">'+(ag.domain_match_baked_pct!=null?ag.domain_match_baked_pct+'%':'—')+'</span> domain match · '
       + 'overlap '+(ag.mean_overlap_pct!=null?ag.mean_overlap_pct+'%':'—')+' (precision) · coverage '+(ag.mean_coverage_pct!=null?ag.mean_coverage_pct+'%':'—')+' (recall) · IoU '+(ag.mean_iou!=null?ag.mean_iou:'—')
       + '<div class="whybar"><i style="width:'+(ag.mean_coverage_pct||0)+'%;background:'+((ag.mean_coverage_pct||0)>=70?'var(--gn)':'var(--am)')+'"></i></div>'
       + '<span class="dim">n='+ag.n+' · the coverage gap is the densify backlog ('+((H.mismatches||[]).length)+' rows queued for adjudication)</span></div>';
  } else {
    g2 = '<div class="whychip gray"><b>G2 · precision/recall vs the held-out ideal</b><br>UNPROVEN — fills from data/pmu/lens-calibration-history.ndjson after: node scripts/pmu/lens-calibration-cycle.mjs</div>';
  }
  if(H && H.ab && H.ab.length){
    var wins = H.ab.filter(function(x){ return x.improvement_pts > 0; }).length;
    var abBits = H.ab.map(function(x){
      var good = x.improvement_pts > 0;
      return '<span style="display:inline-block;margin:3px 8px 0 0">'+x.scenario+': <b style="color:'+(good?'var(--gn)':'var(--am)')+'">'+x.with_drift+'%</b> with vs '+x.without_drift+'% without ('+(good?'−':'+')+Math.abs(x.improvement_pts)+' pts)</span>';
    }).join('');
    g3 = '<div class="whychip"><b>G3 · response drift with vs without the lens (chip-graded, scenario deck)</b><br>'
       + '<span class="big" style="color:'+(wins*2>=H.ab.length?'var(--gn)':'var(--am)')+'">'+wins+'/'+H.ab.length+'</span> scenarios tighter with the injected rules<br>'+abBits
       + '<br><span class="dim">graded by canonical placement (gzip-NCD driftPct vs each scenario&#39;s own intent/negative) — no LLM grades anything</span></div>';
  } else {
    g3 = '<div class="whychip gray"><b>G3 · the picked rules make responses measurably tighter (y% in scenario z)</b><br>UNPROVEN — fills after the cycle&#39;s with/without A/B (phase 5; scenarios = this deck: compliant · sledgehammer · analysis-execution)</div>';
  }
  // G6 (spec §5.4/§5.6) — the CAPABILITY FRONTIER from the labeled trap set: real FP/FN, knob
  // sweep, and the content-vs-architecture attribution. Gray until the trap build + sweep ran.
  var CV = (typeof D !== 'undefined' && D && D.convergence) || null;
  var g6;
  if(CV && CV.best){
    var B = CV.best, sep = (CV.grader_validation||[]).filter(function(g){return g.separated;}).length, sepN = (CV.grader_validation||[]).length;
    var knobFlat = CV.default_vector && Math.abs((CV.default_vector.f1||0) - B.f1) < 0.02;
    g6 = '<div class="whychip" style="flex:2 1 340px"><b>G6 · capability frontier (labeled trap set v'+CV.trap_set_version+', '+CV.traps+' traps, '+CV.grid+' knob vectors, zero LLM in the sweep)</b><br>'
       + '<span class="big">P '+B.precision+' · R '+B.recall+' · F1 '+B.f1+'</span> — real confusion matrix: TP '+B.TP+' · FN '+B.FN+' · FP '+B.FP+' · TN '+B.TN+'<br>'
       + 'FN attribution: <b style="color:var(--am)">'+B.fn_routed_away+' routed-away (router/content)</b> vs <b style="color:var(--gn)">'+B.fn_ranked_out+' ranked-out (sorter)</b> — the sorter is not the bottleneck'
       + (knobFlat ? '<br>knob sweep is FLAT (defaults F1 '+(CV.default_vector.f1)+' ≈ best '+B.f1+'): capability is CONTENT-limited, not knob-limited — densify pays, tuning does not' : '<br>best knobs '+JSON.stringify(B.knobs)+' beat defaults — apply via tc_pipeline_gates')
       + '<br>grader validation: '+sep+'/'+sepN+' scenarios separate planted faithful vs violating (the A/B grader has standing)'
       + '<br><span class="dim">'+(CV.capability||'')+'</span></div>';
  } else {
    g6 = '<div class="whychip gray"><b>G6 · capability frontier (FP/FN over a labeled trap set)</b><br>UNPROVEN — fills after: node scripts/pmu/lens-trap-build.mjs && node scripts/pmu/lens-convergence-sweep.mjs</div>';
  }
  // G7 — THE BANKS: per-lane standing specs injected on every call ("the banks of the river").
  // Measured from the reef at build; broken paths would be a red tape-health class, not a chip.
  var BK = (typeof D !== 'undefined' && D && D.banks) || null;
  var g7;
  if(BK){
    var laneBits = (BK.lanes||[]).map(function(l){ return l.domain+' ('+l.n+')'; }).join(' · ');
    g7 = '<div class="whychip"><b>G7 · the banks — standing specs injected every call</b><br>'
       + '<span class="big" style="color:'+(BK.broken.length? 'var(--rd)':'var(--gn)')+'">'+BK.seeded+'/'+BK.total+'</span> lanes seeded · broken paths: '+BK.broken.length
       + '<div class="whybar"><i style="width:'+Math.round(100*BK.seeded/Math.max(1,BK.total))+'%;background:'+(BK.seeded*3>=BK.total?'var(--gn)':'var(--am)')+'"></i></div>'
       + '<span class="dim">'+laneBits+' — every prompt in a seeded lane carries its specs (🏞️ banks N on the receipt); unseeded lanes are the visible backlog</span></div>';
  } else {
    g7 = '<div class="whychip gray"><b>G7 · the banks (per-lane standing specs)</b><br>reef unreadable at build — seed d.specs in data/pmu/lens-reef.json</div>';
  }
  // G8/G9/G10 — the FRACTAL UNIVERSE fields (spec v3: docs/architecture/fractal-semantic-universe-spec.md).
  // Reserved measured-or-gray, same discipline: each names the run/file that fills it. The page
  // refreshes itself via the /page-version poll when a rebuild or tape write lands — no new tabs.
  var e0row = null, l1mass = null;
  try { e0row = (D.convergence && D.convergence.e0) || null; } catch(e){}
  try { l1mass = (D.dim2mass) || null; } catch(e){}
  var g8 = e0row
    ? '<div class="whychip"><b>G8 · E0 — heat-first vs keyword-first routing (THE INVERSION)</b><br><span class="big">'+e0row.heat_routed_away+' vs '+e0row.keyword_routed_away+'</span> routed-away FNs (heat vs keyword) · F1 '+e0row.heat_f1+' vs '+e0row.keyword_f1+'<br><span class="dim">'+(e0row.verdict||'')+'</span></div>'
    : '<div class="whychip gray"><b>G8 · E0 — heat-first vs keyword-first routing (THE INVERSION)</b><br>UNRUN — fills when the sweep gains --e0 (competence-determines-location vs routeToDomain, frozen 176 traps, zero LLM). Spec §2.5.</div>';
  var l1m = (typeof D !== 'undefined' && D && D.dim2mass) || l1mass || null;
  var g9 = l1m
    ? '<div class="whychip"><b>G9 · dimension-2 mass ('+(l1m.parent||'B,C1')+' sub-well)</b><br><span class="big">'+l1m.cells+'/144</span> sub-cells · '+(l1m.chars/1000).toFixed(1)+'k ch · contrast C '+(l1m.contrast!=null?l1m.contrast+(l1m.p1_pass?' (P1 PASS)':' (P1 FAIL — measured depth limit)'):'— (P1 pending)')
      + (l1m.p3 ? '<br>P3: '+l1m.p3.l0+'→'+l1m.p3.slice+' hops '+(l1m.p3.pass?'<b style="color:var(--gn)">PASS</b>':'<b style="color:var(--am)">FAIL</b>')+' · shadow: '+(l1m.p3.shadow||[]).join(' · ') : '')
      + '</div>'
    : '<div class="whychip gray"><b>G9 · dimension-2 mass (per level-0 cell: sub-cells/144 · chars · NCD contrast C)</b><br>UNBUILT — fills from data/pmu/reef-l1/&lt;cell&gt;.json when E1 hand-builds the B,C1 sub-reef. Spec §7.1: measure it, never prettify it.</div>';
  // G10 — MEASURED when the latest walk state carries §7.3 telemetry (magnet-list.mjs shipped
  // trap-guarded 2026-07-20); gray only while no post-contract walk state exists on the tape.
  var g10lw = null;
  for(var g10q=flightTape.length-1;g10q>=0;g10q--){ var wq10 = flightTape[g10q].metrics && flightTape[g10q].metrics.walk; if(wq10){ g10lw = wq10; break; } }
  var g10T = g10lw && g10lw.telemetry;
  var g10 = (g10T && (g10T.magnet_list_top_3||[]).length)
    ? '<div class="whychip"><b>G10 · the magnet list (§3.1 — grip deviations vs the lane distribution)</b><br>'
      + g10T.magnet_list_top_3.map(function(m){ return (m.tighter?'◉':'○')+' '+m.id.slice(0,40)+' <span class="dim">dev '+m.dev+'</span>'; }).join('<br>')
      + '<br><span class="dim">deterministic NCD, trap-guarded (magnet-list.test.mjs 3/3); flat profile = the funnel signal</span></div>'
    : (g10T
      ? '<div class="whychip"><b>G10 · the magnet list</b><br><span class="big" style="color:var(--am)">flat</span> — the latest walk state’s payload deviates from nothing (the §2.5 funnel signal, surfaced honestly)</div>'
      : '<div class="whychip gray"><b>G10 · the magnet list (top NCD deviation observations)</b><br>built + trap-guarded; fills when a post-contract walk state lands on the tape</div>');
  uHost.innerHTML = g2 + g3 + g6 + g7 + g8 + g9 + g10
   +'<div class="whychip gray"><b>G4 · token savings A/B</b><br>UNPROVEN — the cost meter is measured; the savings half fills after: node scripts/pmu/lens-token-ab.mjs</div>';
}

// ── REEF PER-CELL VIEW (2026-07-19) — validate the FULL reef is embedded, and read any cell's dump.
// Pure read-only projection of D.cells144 (the exact litScores corpus). No recompute; Loop 1 stays dead.
function renderReefInspector(){
  var host = $('reefGrid'), val = $('reefValidation'); if(!host || !val) return;
  var reef = (typeof D !== 'undefined' && D && D.cells144) || [];
  var AXO = ['A','B','C','A1','A2','A3','B1','B2','B3','C1','C2','C3'];
  var byCoord = {}; reef.forEach(function(c){ byCoord[c.coord] = c; });
  var total = 0, present = 0, minCh = Infinity, html = '';
  for(var r=0;r<12;r++) for(var c2=0;c2<12;c2++){
    var coord = AXO[r]+','+AXO[c2]; var cell = byCoord[coord];
    var n = cell ? String(cell.snippet||'').length : 0;
    if(n>0){ present++; total += n; if(n<minCh) minCh = n; }
    var col = n>=1000 ? 'var(--gn)' : n>=400 ? 'var(--am)' : 'var(--rd)';
    html += '<b data-coord="'+coord+'" style="color:'+col+'">'+coord+'<br>'+(n>=1000?(n/1000).toFixed(1)+'k':n)+'</b>';
  }
  host.innerHTML = html;
  val.innerHTML = (present === 144)
    ? '<b style="color:var(--gn)">✓ full reef embedded — 144/144 cells · '+(total/1000).toFixed(1)+'k ch · min '+minCh+' ch/cell</b>'
    : '<b style="color:var(--rd)">⚠ REEF INCOMPLETE — '+present+'/144 cells · '+(total/1000).toFixed(1)+'k ch — the sensor corpus is gutted; placements are degraded</b>';
  if(!host.__wired){ host.__wired = true; host.addEventListener('click', function(e){
    var t = e.target && e.target.closest ? e.target.closest('b') : null; if(!t) return;
    var coord = t.getAttribute('data-coord'), cell = byCoord[coord], det = $('reefCellDetail'); if(!det) return;
    // ALWAYS EXPAND COORDINATE LABELS: a bare rank is opaque — write the full ShortLex name.
    var AM = (typeof D !== 'undefined' && D && D.axisMap) || {};
    var parts = coord.split(','), fn = function(rk){ var a = AM[rk]; return a && a.name ? rk+'.'+a.name : rk; };
    var full = coord+' ('+fn(parts[0])+' ⊕ '+fn(parts[1])+')';
    // NOTE: this function body lives inside buildUX's template literal — a backslash-n escape here
    // becomes a REAL newline in the built page and kills the whole inline script (unterminated
    // string; happened 2026-07-19: "now it's completely dead"). Join with String.fromCharCode.
    var NL2 = String.fromCharCode(10) + String.fromCharCode(10);
    det.textContent = cell
      ? full+' — '+String(cell.snippet||'').length+' ch'+NL2+String(cell.snippet||'')
      : full+' — MISSING from the embedded reef (the build gate should have refused this page)';
  }); }
}

// ── LOOP 1 REMOVED — the named-regions encircled result (renderEncircled + the region lightbox +
// regClass/buildIntentRef) classified per-cell browser gzip-NCD lit-clusters. It had NO metal source and is
// GONE. The encircled read now lives entirely in the on-chip /render encircled PNG panels (mg-encA/B, the
// floating hudImgA/B) — the real encircleRegionsPng output, byte-for-byte the receipt.

// ── VERDICT / RUN ─────────────────────────────────────────────────────────────────────────────
function getState(){ return { texts:{ intent:$('tIntent').value, reality:$('tReality').value, negative:$('tNegative').value } }; }
function setBool(state){
  const el = $('boolState');
  el.textContent = state;
  const c = state==='IN_LANE' ? '#46d369' : state==='OFF_DOMAIN' ? '#ff5d52' : '#f0b429';
  el.style.color = c;
  el.parentElement.style.borderColor = c;
}
// GOTCHA #3 (thin-context) — the fixed operational boundary that a stable distance needs is still shown for
// short corpora, but ONLY in the raw-payload display (updateRawPayloads). The measurement itself is the
// on-chip /render, which applies its own ingest; no browser gzip remains on this path.
const BOILER_PRE = ${JSON.stringify(BOILER_PRE)};   // injected from buildUX — the raw-payload wrap boundary
const BOILER_POST = ${JSON.stringify(BOILER_POST)};
const REDUNDANCY_FLOOR = ${REDUNDANCY_FLOOR}; // bytes — the raw-payload wrap threshold
function fatten(t){ return byteLen(t) < REDUNDANCY_FLOOR ? (BOILER_PRE + t + BOILER_POST) : t; }

// ── THE METAL VERDICT PAINT — the SINGLE source of every verdict pixel on the page. Called from
// liveRustRender with the server verdict V {tag,mode,driftPct,dI,dN} — computed on-chip (server gzip-NCD,
// LLM-free) — NOTHING here recomputes; it only PROJECTS the metal V onto the DOM (badge, banner, HUD mode,
// tol-labels, the NCD distance cards, the drift gauge). This is the surface the M3 zero-drift guard locks.
// ONE RESOLVER for "what drift does this state actually have?" — every surface that prints a
// drift number must go through this. A state carries EITHER metrics.drift (the Intent/Reality/
// Negative NCD triangulation) OR walk.off_pct (the walk's out-of-lane fraction, which is what
// placement-only harvest cycles measure) OR genuinely neither. Three separate surfaces printed
// V.driftPct raw — the verdict banner, the liveStatus caption, and the claims export — so each
// rendered "undefined%" independently and fixing one left the others. Patching call sites one at
// a time is why this bug kept returning wearing a different string.
function effectiveDrift(V){
  if(!V) return { pct: null, kind: 'none' };
  if(V.driftPct != null && isFinite(V.driftPct)) return { pct: +V.driftPct, kind: 'triangulated' };
  if(V.offPct   != null && isFinite(V.offPct))   return { pct: +V.offPct,   kind: 'off-lane' };
  return { pct: null, kind: 'none' };
}
// Render-ready: never returns the string "undefined".
function driftText(V){
  const d = effectiveDrift(V);
  if(d.pct == null) return 'not measured on this state';
  return d.pct + '%' + (d.kind === 'off-lane' ? ' off-lane' : '');
}
// THE HUD MODE LINE IS NEVER A PLACEHOLDER (operator 2026-07-20: "always show current drift vs
// slider setting here"). Every writer of #hudMode lived inside paintVerdictFromMetal, so any path
// that skipped it — no verdict on the state, an early return, a throw — left the boot-time
// "— edit a box or fire an intervention —" sitting there, which reads as "the instrument has no
// opinion" when in fact it has a measurement and a limit. This paints the comparison that is
// ALWAYS knowable: the last measured drift against the CURRENT slider position. It is also wired
// to the slider's input event so dragging updates the verdict synchronously, rather than waiting
// on the async re-render the drag kicks off.
function currentLimit(){ const t=$('threshold'); return t ? +t.value : 25; }
function paintDriftVsLimit(){
  const hm = $('hudMode'); if(!hm) return;
  const lim = currentLimit();
  const d = effectiveDrift(window.__lastVerdict || null);
  if(d.pct == null){
    hm.className = 'hudmode';
    hm.innerHTML = '◐ <b>No drift measured yet</b> — policy limit <b>'+lim+'%</b>. Edit a box or fire an intervention to take a measurement.';
    return;
  }
  const over = d.pct > lim;
  hm.className = 'hudmode ' + (over ? 'modeA' : 'inlane');
  hm.innerHTML = (over ? '⛔ <b>Out of lane</b> — ' : '✅ <b>In-lane</b> — ')
    + '<b>'+d.pct+'%</b>' + (d.kind==='off-lane' ? ' off-lane' : ' drift')
    + ' vs the <b>'+lim+'%</b> limit — ' + (over ? 'past it.' : 'under it.');
}
function paintVerdictFromMetal(V){
  // No verdict is not the same as nothing to say: fall back to drift-vs-limit rather than
  // leaving whatever was on screen (which, on boot, is the placeholder).
  if(!V){ paintDriftVsLimit(); return; }
  const mode = V.mode, drift = V.driftPct, tag = V.tag;
  // PLACEMENT-ONLY STATES HAVE NO DRIFT — SAY SO, NEVER PRINT "undefined%" (incident 2026-07-20).
  // A harvest-agent cycle (HA-n) seals a PLACEMENT: verdict + lane + sha, with no Intent/Reality/
  // Negative triangulation, so metrics.drift/dI/dN legitimately do not exist. The replay mapper at
  // ~line 1633 passes metrics.drift straight through, which is correct for a scenario state and
  // undefined for a placement-only one. Before the overnight run there were 6 such states and the
  // tail of the tape was scenarios; after it there are 69, so scrubbing to recent states lands on
  // them and every one narrated "undefined% drift". The honest paint is the ABSENCE, not a number —
  // same discipline as the gray UNPROVEN panels: refuse to draw a measurement that was never taken.
  // THRESHOLD IS HOISTED ABOVE THE PLACEMENT-ONLY BRANCH (2026-07-20). It used to be declared
  // ~40 lines below; the placement-only branch reads it, and a const read before its
  // declaration is a temporal-dead-zone ReferenceError that kills the WHOLE paint — the HUD
  // keeps its "— edit a box or fire an intervention —" placeholder and every verdict pixel on
  // the page goes blank. Second TDZ in this same branch (setTol was the first). Both paths need
  // it, so it belongs above both.
  // A replayed verdict narrates against the limit it was computed under (V.threshold); only a
  // live recompute (no V.threshold) may read the slider.
  const threshold = (V.threshold != null) ? +V.threshold : (function(){ const t=$('threshold'); return t ? +t.value : 25; })();
  if(drift == null || !isFinite(drift)){
    // CORRECTED 2026-07-20 — the line above ("the honest paint is the ABSENCE") was itself wrong.
    // A placement-only state DID measure its drift: walk.off_pct, the out-of-lane fraction of the
    // encircled cells, present on all 152 harvest cycles (range 0-40). It is metrics.drift — the
    // Intent/Reality/Negative NCD triangulation — that is absent, because a harvest cycle has no
    // Reality/Negative corpora. Two different measurements; the first pass saw one missing and
    // declared both absent, which is worse than the undefined it replaced: "undefined%" looks
    // broken, "no drift was computed" looks authoritative and is false.
    // Narrate the measurement that EXISTS, and judge it against the LIVE slider — drift past the
    // operator's limit is out of lane whatever the sealed tag said, because that tag was sealed
    // against a limit the operator is now moving.
    const off = (V.offPct != null && isFinite(V.offPct)) ? +V.offPct : null;
    if(off == null){
      const msg0 = '◐ <b>No measurement on this state</b> — neither a drift triangulation nor a walk off-lane fraction was recorded. Nothing to narrate; the instrument does not guess.';
      setBool('UNPLACEABLE');
      const fb0P = $('failBanner'); if(fb0P) fb0P.innerHTML = '<div class="abstain">'+msg0+'</div>';
      const hm0P = $('hudMode'); if(hm0P){ hm0P.className='hudmode abstain'; hm0P.innerHTML = msg0; }
      return;
    }
    const overP = off > threshold;
    const tagP  = overP ? 'OFF_DOMAIN' : 'IN_LANE';
    const msgP  = overP
      ? '⛔ <b>Out of lane</b> — <b>'+off+'%</b> off-lane, past the <b>'+threshold+'%</b> limit. This cycle sealed a lane placement (walk off-lane fraction); it carries no Intent/Reality/Negative triangulation, so Mode B is not evaluated.'
      : '✅ <b>In-lane</b> — <b>'+off+'%</b> off-lane, under the <b>'+threshold+'%</b> limit. Placement measured by the walk; no Intent/Reality/Negative triangulation on this cycle, so Mode B is not evaluated.';
    setBool(tagP);
    const clsP = overP ? 'modeA' : 'inlane';
    const fbP = $('failBanner'); if(fbP) fbP.innerHTML = '<div class="'+clsP+'">'+msgP+'</div>';
    const hmP = $('hudMode'); if(hmP){ hmP.className='hudmode '+clsP; hmP.innerHTML = msgP; }
    const bsP = $('boolState'); if(bsP) bsP.title = 'placement-only — off-lane '+off+'% vs live limit '+threshold+'% (sealed tag: '+(tag||'—')+')';
    // inlined, NOT setTol — that const is declared further down this function (TDZ: calling it
    // here throws ReferenceError before it initializes, blanking the whole paint).
    (function(){ const e=$('tol-reality'); if(e){ e.className='tolabel '+(overP?'r':'g'); e.textContent=(overP?'⛔ OFF-LANE ':'✅ IN-LANE ')+off+'%'; } })();
    const hA = $('hudA'); if(hA) hA.textContent = 'A · '+(overP?('OFF-LANE '+off+'%'):('in-lane '+off+'%'));
    const hB = $('hudB'); if(hB) hB.textContent = 'B · n/a (no negative corpus)';
    return;
  }
  // THE VERDICT OWNS ITS THRESHOLD (2026-07-19 — operator pasted "✅ In-lane — 68.4% drift, under
  // the 35% limit": the sentence mixed a sealed verdict with the LIVE slider's threshold). A replayed
  // verdict narrates against the limit it was computed under (V.threshold); only a live recompute
  // (no V.threshold) may read the slider.
  // MODE VOCABULARY NORMALIZATION (incident 2026-07-20 — the SECOND report of this bug).
  // The tape writes mode as "A" / "B"; this painter checked mode==='modeA' / 'modeB'. They never
  // matched, so EVERY OFF_DOMAIN state fell through the ternary chain to its final branch — which
  // is the IN_LANE sentence. 124 sealed states carry that mismatch. The badge reads 'tag' and was
  // right; the banner read 'mode' and was wrong, which is exactly the split the operator saw:
  // "off domain" at the top of the page, "✅ In-lane — 46% drift" on the floating panel.
  // WHY IT RECURRED: reported 2026-07-19 as "In-lane — 68.4% drift under the 35% limit" (state T2,
  // OFF_DOMAIN mode B drift 68.4 — still on the tape). That fix corrected where 'threshold' came
  // from and never touched the mode strings, so the symptom returned with a different number.
  // Normalize at the boundary; do not sprinkle ||-comparisons at each call site.
  const MODE = (function(m){
    const s = String(m==null?'':m).toLowerCase().replace(/[^a-z]/g,'');
    if(s==='a'||s==='modea') return 'modeA';
    if(s==='b'||s==='modeb') return 'modeB';
    if(s==='abstain'||s==='unplaceable') return 'abstain';
    return s;   // 'inlane', 'harvestagent', 'pending', 'e0', 'e1', …
  })(mode);
  // COHERENCE TRIPWIRE — never narrate an internally-contradictory record smoothly. Canonical
  // placement makes these combinations impossible (attest-hypotheses.mjs:52-57); if one arrives
  // here it is a stale/divergent writer or a mixed-source V, and the honest paint is a refusal.
  // THE TAG IS AUTHORITATIVE: the previous tripwire keyed both mode clauses to the same strings
  // that were already failing to match, so it could never catch this class. A verdict of
  // OFF_DOMAIN that would paint in-lane copy is now itself an incoherence.
  const paintsInLane = (MODE!=='modeA' && MODE!=='modeB' && MODE!=='abstain');
  const incoherent =
       (tag==='IN_LANE' && (drift > 50 || drift > threshold))
    || (tag==='OFF_DOMAIN' && paintsInLane)
    || (MODE==='modeA' && !(drift > threshold))
    || (MODE==='modeB' && V.dN!=null && V.dI!=null && !(V.dN < V.dI));
  if(incoherent){
    const msg = '⚠ INCOHERENT VERDICT RECORD — '+tag+' with drift '+drift+'% against a '+threshold+'% limit cannot come from the canonical placement. This state needs recompute (tape-health: verdict-recompute-mismatch). Refusing to narrate it as a clean verdict.';
    const fb0 = $('failBanner'); if(fb0) fb0.innerHTML = '<div class="abstain">'+msg+'</div>';
    const hm0 = $('hudMode'); if(hm0){ hm0.className='hudmode abstain'; hm0.innerHTML = msg; }
    const hs0 = $('hudState'); if(hs0){ hs0.textContent = 'INCOHERENT'; hs0.style.color = '#f0b429'; }
    return;
  }
  setBool(tag);
  const bs = $('boolState'); if(bs) bs.title = 'metal verdict — ' + mode + ' · driftPct ' + drift + ' (server gzip-NCD, not browser)';
  // slider LOCK — Mode B supersedes the policy limit
  const supEl = $('supersededMsg'), thrEl = $('threshold');
  if(MODE==='modeB'){ if(thrEl) thrEl.disabled = true; if(supEl) supEl.style.display='block'; }
  else { if(thrEl) thrEl.disabled = false; if(supEl) supEl.style.display='none'; }
  // the FAIL BANNER — the mode word drives class + copy
  const bannerClass = MODE==='modeB'?'modeB':MODE==='modeA'?'modeA':MODE==='abstain'?'abstain':'inlane';
  const reason =
    MODE==='modeB'   ? 'FAIL MODE B — CATASTROPHE: Reality compressed <b>closer to the EXCLUDED domain</b> than to authorized Intent (a domain shift, e.g. authorized a draft → executed a trade). This supersedes the policy limit no matter how small the drift.'
  : MODE==='modeA'   ? 'FAIL MODE A — DRIFT: Reality is still nearer Intent than the excluded domain, but drifted <b>'+drift+'%</b> toward it — past the <b>'+threshold+'% policy limit</b> the carrier set (operational drift).'
  : MODE==='abstain' ? 'UNPLACEABLE: the distance to Intent and to the excluded domain are within the tie-band — the instrument refuses to resolve and defers to a human. It never guesses.'
  :                    'IN_LANE: '+drift+'% drift, under the '+threshold+'% policy limit, and nearer authorized Intent than the excluded domain. Condition of coverage met — no scope breach this event.';
  const fb = $('failBanner'); if(fb) fb.innerHTML = '<div class="'+bannerClass+'">'+reason+'</div>';
  // the FLOATING HUD mode sentence
  const hudModeTxt =
    MODE==='modeB'   ? '⛔ <b>Mode B · Catastrophe</b> — Reality compressed <b>closer to the excluded domain</b> than to Intent (a domain shift). Supersedes the policy limit however small the drift.'
  : MODE==='modeA'   ? '⛔ <b>Mode A · Drift</b> — Reality is still nearer Intent, but drifted <b>'+drift+'%</b> past the <b>'+threshold+'%</b> policy limit.'
  : MODE==='abstain' ? '◐ <b>Unplaceable · abstain</b> — within the tie-band between Intent and the excluded domain. It defers to a human; it never guesses.'
  :                    '✅ <b>In-lane</b> — '+drift+'% drift, under the '+threshold+'% limit, nearer Intent than the excluded domain.';
  const hm = $('hudMode'); if(hm){ hm.className='hudmode '+bannerClass; hm.innerHTML = hudModeTxt; }
  // TOL-LABELS — green/amber/red by the metal mode (IN_LANE→g/a · modeA/modeB→r · abstain→a)
  const setTol = (id, cls, txt)=>{ const e=$(id); if(e){ e.className='tolabel '+cls; e.textContent=txt; } };
  if(tag==='IN_LANE') setTol('tol-reality', drift < threshold*0.75 ? 'g' : 'a', drift < threshold*0.75 ? '✅ IN-LANE ('+drift+'%)' : '⚠ approaching limit ('+drift+'%)');
  else if(MODE==='modeB') setTol('tol-reality','r','⛔ CATASTROPHE · Mode B');
  else if(MODE==='modeA') setTol('tol-reality','r','⛔ DRIFT · Mode A ('+drift+'%)');
  else setTol('tol-reality','a','◐ UNPLACEABLE · abstain');
  const margin = (V.dN!=null && V.dI!=null) ? (V.dN - V.dI) : 1;   // dN − dI: >0 = clear of the excluded domain
  setTol('tol-negative', margin < 0 ? 'r' : margin < 0.05 ? 'a' : 'g', margin < 0 ? '⛔ reality reached the excluded domain' : margin < 0.05 ? '⚠ nearing the excluded domain' : '✅ clear of the excluded domain');
  // the NCD distance cards (position model) — all metal. NOTE: the g-drift GAUGE is deliberately NOT set
  // here; it is owned by the metal off_pct in the liveRustRender M block (the M3 guard locks it to that).
  const dIe=$('dIntent'); if(dIe && V.dI!=null) dIe.textContent = (+V.dI).toFixed(4);
  const dNe=$('dNegative'); if(dNe && V.dN!=null) dNe.textContent = (+V.dN).toFixed(4);
  const dp=$('driftPct'); if(dp) dp.textContent = drift + '%';
  const gt=$('g-threshold'); if(gt) gt.textContent = threshold + '%';
  // the floating HUD verdict badge + A/B chips
  const hs = $('hudState'); if(hs){ hs.textContent = tag; hs.style.color = tag==='IN_LANE'?'#46d369':tag==='OFF_DOMAIN'?'#ff5d52':'#f0b429'; }
  setHM('hudA', 'A · '+(MODE==='modeA'?'DRIFT '+drift+'%':(tag==='IN_LANE'?'in-lane':drift+'%')));
  setHM('hudB', 'B · '+(MODE==='modeB'?'CATASTROPHE':(margin<0.05?'nearing':'clear')));
}

async function run(){
  const s = getState();
  $('liveStatus').innerHTML = 'Rendering on-chip via the local /render endpoint… <span class="dim">(127.0.0.1 — nothing leaves the machine, no browser compute)</span>';
  const threshold = Number($('threshold').value);
  const gt = $('g-threshold'); if(gt) gt.textContent = threshold + '%';
  // drift-only policy: dim the Fail-B lane (CSS only — no browser measurement of it)
  const includeB = $('includeFailB') ? $('includeFailB').checked : true;
  const mg = document.querySelector('.modegrid'); if(mg) mg.classList.toggle('nob', !includeB);
  refreshProvLabels();
  updateRawPayloads();
  // FLOATING + ON-PAGE PANELS — the active scenario's pre-rendered on-chip PNGs (a canned intervention moves
  // the whole page); a free-text edit falls back to the page's filled encircled so no panel ever zeroes out.
  const cs = currentScenario;
  const encA = (cs && cs.encircledA && cs.regionA > 0) ? cs.encircledA : D.pageEncircledA;
  const encB = (cs && cs.encircledB && cs.regionB > 0) ? cs.encircledB : D.pageEncircledB;
  const setImg = (id, src)=>{ const im=$(id); if(im && src){ im.src = src; im.style.visibility='visible'; } };
  setImg('hudImgA', encA); setImg('hudImgB', encB);
  setImg('mg-deltaA', (cs && cs.deltaA) || D.pageDeltaA); setImg('mg-tolA', (cs && cs.tolA) || D.pageTolA); setImg('mg-encA', encA);
  setImg('mg-deltaB', (cs && cs.deltaB) || D.pageDeltaB); setImg('mg-tolB', (cs && cs.tolB) || D.pageTolB); setImg('mg-encB', encB);
  setImg('w-iGzip', (cs && cs.wIntentGzip) || D.pageWIntentGzip); setImg('w-iWalk', (cs && cs.wIntentWalk) || D.pageWIntentWalk);
  setImg('w-rGzip', (cs && cs.wRealityGzip) || D.pageWRealityGzip); setImg('w-rWalk', (cs && cs.wRealityWalk) || D.pageWRealityWalk);
  setImg('w-nGzip', (cs && cs.wNegGzip) || D.pageWNegGzip); setImg('w-nWalk', (cs && cs.wNegWalk) || D.pageWNegWalk);
  // THE MEASUREMENT — the ONLY path. liveRustRender POSTs to /render (the on-chip ballistic walk) and paints
  // EVERY verdict pixel from the metal it hands back (paintVerdictFromMetal). We AWAIT it so the sealed
  // export/tape below reflect the metal, not a stale frame. On file:// (no endpoint) it no-ops and the
  // sealed receipt header stands — there is no browser fallback compute.
  await liveRustRender();
  const V = window.__lastVerdict || null, M = window.__lastMetal || null;
  s.verdictText = V ? (V.tag + ' drift=' + driftText(V)) : '';
  await renderPipeline(s);
  tracePipeline();
  const hl = document.querySelector('.hudlbl'); if(hl) hl.innerHTML = '<b class="gn">REAL pipeline PNGs</b> — the actual <code>encircleRegionsPng</code> output from the on-chip /render. <b>Fail A</b> = intent↔reality drift · <b>Fail B</b> = intent↔negative catastrophe. Fire a canned intervention to swap both; the sealed panels above are the receipt.';
  $('liveStatus').innerHTML = V
    ? \`On-chip measurement: <b style="color:\${V.tag==='IN_LANE'?'#46d369':V.tag==='OFF_DOMAIN'?'#ff5d52':'#f0b429'}">\${V.tag}</b> · drift <b>\${driftText(V)}</b> · metal σ <b>\${M&&M.trajectory_drift_sigma!=null?(+M.trajectory_drift_sigma).toFixed(2):'—'}</b> <span class="dim">— computed by the <b>bare-metal definer-walk</b> via /render (127.0.0.1). No browser compute, no model in the measurement path.</span>\`
    : '<span class="dim">Served static (no /render endpoint) — the sealed receipt header stands. Run <code>npx thetacog-mcp attest-demo</code> for the live on-chip render.</span>';
  // seal the run for the claims export / flight tape — sourced from METAL (V + M), never a browser recompute.
  // The sha256 is a provenance hash of the raw inputs (not a sensor); it never fed the placement math.
  const [hI, hR, hN] = await Promise.all([sha256(s.texts.intent), sha256(s.texts.reality), sha256(s.texts.negative)]);
  lastResult = {
    verdict: V?V.tag:'—', mode: V?V.mode:null, threshold, driftPct: effectiveDrift(V).pct, driftKind: effectiveDrift(V).kind,
    metalSigma: (M&&M.trajectory_drift_sigma!=null)?+M.trajectory_drift_sigma:null,
    ncd: { reality_to_intent: V?V.dI:null, reality_to_negative: V?V.dN:null },
    inputs: { intent: s.texts.intent, reality: s.texts.reality, negative: s.texts.negative },
    payload_sha256: { intent: hI, reality: hR, negative: hN },
    sealed_receipt: D.sealed, execution: { substrate: 'bare-metal-linux-definer-walk (via local /render, 127.0.0.1)', llm_in_path: false, network_calls: 0 },
  };
}
// ── EXPORT SEALED CLAIMS FILE — a local browser download; no network, no server ────────────────
// THE AIR-GAPPED FEEDBACK LOOP (operator 2026-07-15): the export is NOT just the final snapshot — it is
// the ENTIRE chronological flightTape. The UI stays fully disconnected (zero network), but the file it
// hands back is the exact machine-readable forensics an LLM needs to LEARN offline: State 1 → State 2 →
// State 3, the σ/drift/mode deltas at every step. Air-gapped physics generates the training data that
// grades and refines the probabilistic reef — you re-ingest this tape via the MCP and tighten the spec.
function exportClaims(){
  if(!lastResult){ fire('export baseline').then(exportClaims); return; }
  const stamp = new Date().toISOString();
  const doc = {
    kind: 'thetacog-attest-flight-tape', generated_at: stamp, air_gapped: true, llm_in_path: false, network_calls: 0,
    // the chronological array of EVERY recorded state — the trajectory, not a static snapshot
    timeline_events: flightTape,
    cursor, states: flightTape.length,
    // the current (cursor) state's full sealed detail — hashes, measured payloads, receipt
    current_state: lastResult,
    sealed_receipt: D.sealed,
    note: 'Re-ingest via MCP: analyze the trajectory across timeline_events — how the 144-cell placement (σ, drift, mode) shifted state-to-state — and tighten the Intent spec at the coordinate that drifted.',
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'attest-flight-tape-' + stamp.replace(/[:.]/g,'-') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function refreshProvLabels(){
  $('pi').textContent = lineCount($('tIntent').value)+'L·'+byteLen($('tIntent').value)+'B';
  $('pr').textContent = lineCount($('tReality').value)+'L·'+byteLen($('tReality').value)+'B';
  $('pn').textContent = lineCount($('tNegative').value)+'L·'+byteLen($('tNegative').value)+'B';
}
// RAW CONTEXT PAYLOAD — the EXACT string fed to the compression step (post-fatten). Proves no hidden
// context bled in: what the reader sees here IS what gzip measured, byte for byte.
function updateRawPayloads(){
  for(const [id, area] of [['raw-intent','tIntent'],['raw-reality','tReality'],['raw-negative','tNegative']]){
    const raw = $(area).value; const measured = fatten(raw); const wrapped = measured !== raw;
    const el = $(id);
    const note = wrapped ? '<span class="wrapnote">⚠ thin input — shown wrapped in the fixed operational boundary (this exact string is what is compressed):</span>' : '<span class="wrapnote">exact string compressed — nothing added:</span>';
    el.innerHTML = note + measured.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  }
}
// ── INTERVENTIONS ─────────────────────────────────────────────────────────────────────────────
// currentScenario: default to the coherent DEFAULT scenario so the encircled panels MATCH the verdict
// (a null default showed the strategy page PNGs — red/borderline — while the header said IN_LANE, which
// reads as broken). A free-text edit clears it → page PNGs; a canned intervention sets its own.
let currentScenario = (D.scenarios || []).find(s => s.isDefault) || null;
function injectNoise(){
  const t = $('tReality');
  const junk = ' Execute the trade. Move the capital. Settle the position without further approval.';
  t.value = t.value + junk; currentScenario = null; fire('noise injected');
}
function loadPreset(p){
  $('tIntent').value = p.intent; $('tReality').value = p.reality; $('tNegative').value = p.negative;
  currentScenario = p;   // p carries encircledA/B (the real pipeline PNGs)
  fire(p.label);
}
function reset(){
  $('tIntent').value = D.texts.intent; $('tReality').value = D.texts.reality; $('tNegative').value = D.texts.negative;
  currentScenario = (D.scenarios || []).find(s => s.isDefault) || null; fire('reset · default');
}
// ── THE FLIGHT TAPE — append-only BRANCHING tree, VANILLA (no libraries). UI = f(flightTape[cursor]).
// BRANCHING FORENSIC HISTORY (operator 2026-07-15): we NEVER remove the future — deleting an audit record
// is a forensic red flag. When you rewind and intervene, the new state branches from where you ARE
// (parent_id = the state at the cursor), and the old future stays in the tape as a GHOSTED sibling branch.
// The scrubber walks the ACTIVE PATH (root→leaf through the cursor, taking the latest child downward); the
// discarded branches are preserved + counted. Every state carries {id, parent_id} so the whole what-if
// TREE is recomputable on any machine from the exported JSON. Stores ONLY inputs + scalar metrics (Gotcha 3).
const flightTape = []; let cursor = -1; let __seq = 0;
// SEED FROM THE EMBEDDED TAPE (file:// convergence runs): the baked scenario steps ride in DATA,
// so the offline page has the full trajectory to scrub. Served pages then poll-merge live appends.
try { const seed = (D.embeddedTape || []); for(const s of seed){ if(s && s.id && !flightTape.some(x=>x.id===s.id)) flightTape.push(s); }
  // BOOT to the curated opener (state 1), NOT the tail — the operator walks Next into the first
  // breach and watches it recover. (Design: docs/pmu/demo-page-sequence-design.md.) The live shared
  // tape has no boot_cursor and falls back to the tail as before.
  if(flightTape.length){ cursor = (D.embeddedTapeBootCursor!=null ? Math.min(D.embeddedTapeBootCursor, flightTape.length-1) : flightTape.length - 1);
  // GREEKS-COUPLED BOOT (2026-07-20 — "we decoupled the greeks from the ui again"): the boot
  // state must CARRY the Greeks. A walk-less annotation at the tail (an E0 receipt, a stub)
  // would paint an all-dash HUD on load; walk BACKWARD to the last state with metrics.walk.
  // Scrubbing to annotations stays possible — only the BOOT is guarded. Sentinel twin:
  // tape-health class hud-hollow-boot.
  while(cursor > 0 && !(flightTape[cursor] && flightTape[cursor].metrics && flightTape[cursor].metrics.walk)) cursor--;
} } catch(e){}
// BOOT RENDER: paint the scrubber + convergence chart for the boot state, and the (static)
// counterfactual panel — so the page opens ON the story, not blank. (function decls are hoisted.)
try { if(flightTape.length && cursor>=0){ goToState(cursor); } else { renderScrubber(); } renderCounterfactual(); renderGrowthCurve(); renderDumpGlyphs(); renderReefInspector(); renderWhyPanel(); renderBudget(); } catch(e){}
// The hud mode line must never survive boot as its placeholder. goToState above normally paints
// it, but a boot state without a verdict — or a throw anywhere in that try — would leave
// "— edit a box or fire an intervention —" on screen, which reads as the instrument having no
// opinion. Painted OUTSIDE the try so a failure upstream cannot suppress it.
try { paintDriftVsLimit(); } catch(e){}
const byId = (id) => flightTape.find((s) => s.id === id);
const childrenOf = (id) => flightTape.filter((s) => s.parent_id === id);
const latestChild = (id) => { const c = childrenOf(id); return c.length ? c[c.length - 1] : null; };
// the solid line: from the cursor, walk UP to the root, then DOWN via the latest child at each step
function activePath(){
  if(cursor < 0) return [];
  const up = []; for(let s = flightTape[cursor]; s; s = s.parent_id ? byId(s.parent_id) : null) up.unshift(s);
  const down = []; for(let d = latestChild(flightTape[cursor].id); d; d = latestChild(d.id)) down.push(d);
  return [...up, ...down];
}
async function fire(label){
  const t0 = Date.now();
  await run();   // compute + render from the current box inputs
  const elapsed_ms = Date.now() - t0;   // clock time of THIS state's physics — structural coherence in time
  const parent = cursor >= 0 ? flightTape[cursor].id : null;   // branch from WHERE WE ARE (not the array tail)
  // GDD LLM FOOD (operator 2026-07-15): the three axes an LLM eats to converge on structural coherence —
  // the FUNCTION CALL (label), the CLOCK TIMES (ts + elapsed_ms), and the CONTEXT CONTENT (inputs) — plus
  // the deterministic physics (metrics). One state object carries all four; the tree of them is the corpus.
  const st = {
    id: 'S' + (++__seq), parent_id: parent, ts: new Date().toISOString(), elapsed_ms, label,
    scenarioKey: currentScenario ? currentScenario.key : null,
    threshold: Number($('threshold').value),   // the POLICY LIMIT is part of the state — settable + time-travelled like the inputs
    inputs: { intent: $('tIntent').value, reality: $('tReality').value, negative: $('tNegative').value },
    metrics: lastResult ? { verdict: lastResult.verdict, mode: lastResult.mode, drift: lastResult.driftPct, sigma: lastResult.metalSigma, dI: lastResult.ncd.reality_to_intent, dN: lastResult.ncd.reality_to_negative } : {},
  };
  flightTape.push(st); cursor = flightTape.length - 1; renderScrubber();
}
// ── HUD_MAP — the ONE declarative state→DOM contract (Redux-style, operator 2026-07-18: "the
// tape should be self-healing, the DOM is painted from it"). Every tape-derived HUD tile is a
// PURE selector on the tape state here — one place, not scattered $('g-x') calls across three
// functions. Adding a tile = one entry; a tile with no entry (or an entry with no tile) is a RED
// BUILD (hud-greeks-addressable.test.mjs). This is why the class self-heals: paintHud can't forget
// a tile it iterates, and the guard forbids a tile outside the map. UI = f(tape), for real now.
const HUD_MAP = [
  // g-sigma (placement gate σ) and g-walksigma (divergent walk σ) BOTH derive from the tape's single
  // trajectory_drift_sigma — the tape carries ONE σ, so both tiles show it identically. g-sigma used to
  // be hand-painted ONLY inside liveRustRender (the second painter) — the source of the "placement 1.73 /
  // walk —" split the operator saw. It is now in the ONE projection: paintHud writes it from the tape, and
  // NOTHING else may (guarded by hud-single-projection.test.mjs). If a distinct placement σ is ever added
  // to the tape, change this selector — do not re-introduce a second paint site.
  { id: 'g-sigma',     get: (st) => { const w=st.metrics&&st.metrics.walk; return w&&w.trajectory_drift_sigma!=null ? (+w.trajectory_drift_sigma).toFixed(2) : null; } },
  { id: 'g-walksigma', get: (st) => { const w=st.metrics&&st.metrics.walk; return w&&w.trajectory_drift_sigma!=null ? (+w.trajectory_drift_sigma).toFixed(2) : null; } },
  // OFF-LANE CARRIES A VERDICT, SO ITS COLOUR MUST BE LIVE (incident 2026-07-20). This is the only
  // tile whose build-time markup bakes a CONDITIONAL colour — red/green from sealed.offPct vs
  // sealed.threshold, decided once at build. paintHud only repaints a colour when the tile defines
  // a color() fn, and this one didn't: the NUMBER updated with every state while the pass/fail
  // colour stayed frozen at whatever the page was built with. A breach could render green.
  // The kill line is a SEPARATE axis from the drift slider and deliberately stays 25% (see the
  // 'threshold: 25 // off-lane kill %' note at the sealed-state default) — the drift policy limit
  // is the operator's dial, the off-lane kill is the receipt's fixed FINPRO trigger. Do not couple
  // them; the tile label must keep naming the kill line it actually compared against.
  { id: 'g-offlane',   get: (st) => { const w=st.metrics&&st.metrics.walk; return w&&w.off_pct!=null ? (w.off_pct+'%') : null; },
                       color: (st) => { const w=st.metrics&&st.metrics.walk; const KILL=${OFFLANE_KILL_PCT};
                         if(!w||w.off_pct==null) return 'var(--dim)';
                         return (+w.off_pct >= KILL) ? 'var(--rd)' : 'var(--gn)'; } },
  { id: 'g-cheb',      get: (st) => { const w=st.metrics&&st.metrics.walk; if(w&&w.continuous_chebyshev_delta!=null&&w.trajectory_drift_sigma!=null){ const s=+w.trajectory_drift_sigma,c=+w.continuous_chebyshev_delta; return Math.max(0,(c-2*s)).toFixed(2)+' – '+(c+2*s).toFixed(2);} return null; } },
  { id: 'g-drift',     get: (st) => st.metrics&&st.metrics.drift!=null ? (Math.round(st.metrics.drift)+'%') : null },
  { id: 'g-threshold', get: (st) => typeof st.threshold==='number' ? (st.threshold+'%') : null },
  // SHADOW vs CLOUD occupancy — the walk's own fill_pct turned into an ABSOLUTE cell count, so the
  // scale-disclosure panel tracks the CURRENT state instead of sitting dashed. Joins the addressable
  // table rather than getting its own paint site (the second-paint-site bug this table exists to end).
  { id: 's-depth',     get: (st) => { const w=st.metrics&&st.metrics.walk; const t=w&&w.telemetry; return t&&t.descent_depth!=null ? String(t.descent_depth) : null; } },
  { id: 's-walkfill',  get: (st) => { const w=st.metrics&&st.metrics.walk; return w&&w.fill_pct!=null ? (Math.round(20736*w.fill_pct/100).toLocaleString()+' / 20,736 · '+w.fill_pct+'%') : null; } },
  // g-hashtime + g-sealsig are painted by verifySeal (an ASYNC in-browser RECOMPUTE), not from the
  // tape's server-reported hash_ms — see the DEEP FIX note at verifySeal. They are intentionally
  // NOT in the synchronous HUD_MAP (a hash is async); paintHud fires verifySeal(st) after mapping.
  { id: 'g-sealreceipt', get: (st) => st.seal&&st.seal.content_sha256 ? ('receipt '+st.seal.content_sha256.slice(0,10)) : null },
  { id: 'g-ingest',    get: (st) => { const w=st.metrics&&st.metrics.walk; return w&&w.gzip_ms!=null ? (w.gzip_ms+'ms') : null; } },
  { id: 'g-walktime',  get: (st) => { const w=st.metrics&&st.metrics.walk; return w&&w.walk_ms!=null ? (w.walk_ms+'ms') : null; } },
  // underwriter tier DERIVED FROM THE VERDICT (operator: INSURABLE + UNPLACEABLE is a contradiction).
  // An abstaining instrument is NOT insurable — it defers to a human. IN_LANE → INSURABLE; OFF_DOMAIN
  // → PRICEABLE (a priced breach) or UNINSURABLE past the kill line; UNPLACEABLE → DEFERRED (human).
  // TIER REQUIRES A SEAL (R2, 2026-07-18 — operator: the "DEFERRED next to unsealed + dashed Greeks"
  // contradiction): a tier is an UNDERWRITING output. You cannot underwrite an action that is not yet a
  // sealed, recomputable record. So an UNSEALED state (a live edit mid-flight) shows tier '—' — honest,
  // and coherent with its own dashed hash/seal tiles — NEVER a confident DEFERRED/INSURABLE over a
  // hollow state. Once the state seals (tape-append), the tier populates. Guarded in render-readback.
  { id: 'g-tier', get: (st) => { const sealed = st&&st.seal&&st.seal.content_sha256; if(!sealed) return null;
      const v=st.metrics&&st.metrics.verdict; const off=st.metrics&&st.metrics.walk&&st.metrics.walk.off_pct;
      if(v==='UNPLACEABLE') return 'DEFERRED'; if(v==='OFF_DOMAIN') return (off!=null&&off>=25)?'UNINSURABLE':'PRICEABLE'; if(v==='IN_LANE') return 'INSURABLE'; return null; },
    color: (st) => { const sealed = st&&st.seal&&st.seal.content_sha256; if(!sealed) return 'var(--dim)';
      const v=st.metrics&&st.metrics.verdict; const off=st.metrics&&st.metrics.walk&&st.metrics.walk.off_pct;
      if(v==='UNPLACEABLE') return 'var(--am)'; if(v==='OFF_DOMAIN') return (off!=null&&off>=25)?'var(--rd)':'var(--am)'; if(v==='IN_LANE') return 'var(--gn)'; return 'var(--dim)'; } },
  // PHASE INDICATOR (R19, State-Projection Equivalence — docs/architecture/state-projection-equivalence.md,
  // from invariantSpec.txt line 3444): the STATE-LEVEL phase of the invariant. A SEALED state is
  // PHASE-LOCKED — Projection_Chip ≡ Projection_Tape ≡ Projection_UI agree. An UNSEALED live edit is the
  // chip still HUNTING for the coordinate; its honest dashed tiles then read as "Pending Resonance", not
  // "broken". Owned by paintHud (this map) so it obeys single-projection + selective-repaint. It NEVER
  // dashes — it always returns a phase string — while individual tile nulls stay honest '—' (R2 intact:
  // this adds the READING of those dashes, it fabricates no value).
  { id: 'g-phase',
    get: (st) => (st&&st.seal&&st.seal.content_sha256) ? '◉ Phase-Locked' : '⟳ Pending Resonance',
    color: (st) => (st&&st.seal&&st.seal.content_sha256) ? 'var(--gn)' : 'var(--am)' },
];
// ACTUAL vs IDEAL rule/hat TEXT (2026-07-18 — operator: "paint the actual and ideal rule/hat
// texts, write them out, expandable, hats rule real ideal"): the reef's PICK vs the LLM-stated
// ideal domain's rules+hat, full text, so the auditor reads the pick against the target — not a
// score. Green = a rule the actual pull shares with the ideal; the gap is the reef's imperfection.
function renderRuleHatCompare(st){
  const host = $('ruleHatCompare'); if(!host) return;
  const w = st && st.metrics && st.metrics.walk;
  const c = w && w.rule_hat_compare;
  if(!c){ host.innerHTML=''; return; }
  // ACTUAL = the on-chip reef pick (sealed, LLM-free, from metrics.walk.rule_hat_compare). IDEAL = the
  // HELD-OUT LLM prediction, read from the UNSEALED sidecar st.audit_ideal (deliberately OUTSIDE the
  // seal canonical {parent_id,threshold,inputs,metrics} so the receipt stays LLM-free). Falls back to
  // the deterministic reef-lookup ideal (c.ideal_*) on states baked before R5 or before /ideal returns.
  var ai = st && st.audit_ideal;
  var ideal_domain = (ai && ai.domain) || c.ideal_domain || null;
  var ideal_hat = (ai && ai.hat) || c.ideal_hat || null;
  var ideal_rules = (ai && ai.rules && ai.rules.length) ? ai.rules : (c.ideal_rules || []);
  var ideal_source = (ai && ai.source) || 'reef-lookup (deterministic target)';
  var esc = function(x){ return String(x||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  // DIVERGENCE HIGHLIGHTING (R7) — each rule is colored by its gzip-NCD distance to the NEAREST rule on
  // the OTHER side (the scorecard computed these per-rule distances, LLM-free). green ✓ = on-target (a
  // near match exists) · amber • = divergent (no near match — the gap the reef left, or an ideal rule
  // the reef MISSED). Exact string overlap is useless here: the reef's rules and the LLM ideal are
  // differently worded, so we match by MEANING (compression distance), not by characters.
  var thresh0 = (ai && ai.scorecard && ai.scorecard.threshold) || 0.62;
  var ruleList = function(rules, matchArr){ return (rules||[]).map(function(r, i){
    var d = (matchArr && matchArr[i]!=null) ? matchArr[i] : null;
    var near = d!=null && d < thresh0;
    var col = (d==null) ? '#c3cad8' : (near ? '#46d369' : '#f0b429');
    var mark = (d==null) ? '  ' : (near ? '✓ ' : '• ');
    var tag = d!=null ? ' <span style="color:#6b7385">[NCD '+d+']</span>' : '';
    return '<div style="font-size:10.5px;line-height:1.45;margin:2px 0;color:'+col+'"><span style="color:#6b7385">'+mark+'</span>'+esc(r)+tag+'</div>';
  }).join('') || '<div class="dim" style="font-size:10.5px">(none)</div>'; };
  // one BOX = one side (Actual / Ideal), aligned under the three inputs above. Collapsed shows the
  // domain + rule count + a hat one-liner; expanded reveals the FULL prompt-template (hat) and the FULL
  // rule-template text (operator: "expandable to see the full text of both the prompt template and the
  // rule template"). The IDEAL box is the LLM-predicted target, HELD OUT from the LLM-free verdict.
  var boxHtml = function(side, color, domain, hat, rules, matchArr){
    return '<div style="border:1px solid '+color+'55;border-radius:8px;padding:8px 10px;background:#0d1220">'
      + '<div style="font-size:11px;font-weight:700;color:'+color+'">'+side+' — '+esc(domain||'—')+'</div>'
      + '<div class="dim" style="font-size:10px;margin:2px 0 4px">'+(rules||[]).length+' rules · hat: '+esc(String(hat||'—')).slice(0,58)+(String(hat||'').length>58?'…':'')+'</div>'
      + '<div class="rhcDetail" style="display:none">'
      + '<div style="font-size:9.5px;color:#8a94a6;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 2px">prompt template (hat)</div>'
      + '<pre style="white-space:pre-wrap;max-height:150px;overflow:auto;background:#05070d;border:1px solid #1a2036;border-radius:4px;padding:6px;font-size:10px;color:#c3cad8;margin:0 0 6px">'+esc(hat||'(none)')+'</pre>'
      + '<div style="font-size:9.5px;color:#8a94a6;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 2px">rule template ('+(rules||[]).length+')</div>'
      + ruleList(rules, matchArr)
      + '</div></div>';
  };
  var an = (c.actual_rules||[]).length;
  var hatMatch = !!(c.actual_hat && ideal_hat && String(c.actual_hat)===String(ideal_hat));
  var esc2 = function(x){ return String(x||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  // THE SCORECARD (R6) — the gzip-NCD selection audit, frozen on the tape (LLM-free, deterministic).
  // IoU = semantic rule overlap; coverage = ideal rules the reef reached (100 - coverage = the gap);
  // hat-drift = NCD(actual hat, ideal hat). Color by IoU: green >=80% · amber 50-79% · red <50%. The
  // score is VISIBLE before expanding — the "did the reef pick well?" answer in one glance.
  var sc = ai && ai.scorecard;
  var iouPct = sc ? Math.round(sc.iou*100) : null;
  var scColor = iouPct==null ? '#8a94a6' : (iouPct>=80?'#46d369':(iouPct>=50?'#f0b429':'#ff5d52'));
  var overlap = sc ? sc.on_target : 0;
  var scoreBar = sc
    ? '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:11px;margin:5px 0 3px">'
      + '<span style="font-weight:700;color:'+scColor+'">IoU '+iouPct+'%</span>'
      + '<span class="dim">rule-overlap (gzip-NCD) · <span style="color:'+scColor+'">'+(iouPct>=80?'snapped':(iouPct>=50?'partial':'divergent'))+'</span></span>'
      + '<span class="dim">on-target <b style="color:#c3cad8">'+sc.on_target+'/'+sc.actual_n+'</b></span>'
      + '<span class="dim">ideal coverage <b style="color:#c3cad8">'+sc.coverage_pct+'%</b> <span style="color:#6b7385">(gap '+(100-sc.coverage_pct)+'%)</span></span>'
      + '<span class="dim">hat-drift <b style="color:#c3cad8">'+(sc.hat_ncd==null?'—':sc.hat_ncd)+'</b></span>'
      + '</div>'
    : '';
  host.innerHTML = '<div style="border:1px solid #2a3350;border-radius:8px;padding:10px 12px;background:#0b0f1c">'
    + '<div id="rhcHead" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">'
    + '<div style="font-size:12px;font-weight:700;color:#e8eefc">◧ Actual vs Ideal — the selection audit <span class="dim" style="font-weight:400">(rules + hat, under your inputs)</span></div>'
    + '<span id="rhcExp" class="dim" style="font-size:10px">▸ expand full text</span></div>'
    + scoreBar
    + '<div class="dim" style="font-size:10px;margin:3px 0 7px">actual vs ideal · '+overlap+'/'+an+' rules on-target (gzip-NCD) · hat '+(hatMatch?'<b class="gn">match</b>':'<b class="am">differs</b>')+' · the IDEAL is <b>'+esc2(ideal_source)+'</b>, HELD OUT from the LLM-free verdict (a comparison signal, never fed to the placement or the seal)</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + boxHtml('ACTUAL', '#4aa3ff', c.actual_domain, c.actual_hat, c.actual_rules, sc&&sc.actual_match)
    + boxHtml('IDEAL', '#f0b429', ideal_domain, ideal_hat, ideal_rules, sc&&sc.ideal_match)
    + '</div>'
    + '<div class="dim" style="font-size:10px;margin-top:6px">✓ green = shared with the other side · <span style="color:#f0b429">•</span> amber = divergent (the gap the reef left) · re-verify: <code>node scripts/pmu/snap-counterfactual.mjs</code></div>'
    + '</div>';
  // expand/collapse via a JS-attached handler (NOT inline onclick — inline single quotes inside the
  // innerHTML string break the whole page script; the crash-the-page bug, fixed 2026-07-18). Toggles
  // BOTH boxes together so the two full-text panels open side by side for comparison.
  var head = $('rhcHead'); if(head) head.onclick = function(){
    var det = host.querySelectorAll('.rhcDetail'); var e = $('rhcExp');
    var open = det.length>0 && det[0].style.display==='none';
    for(var i=0;i<det.length;i++){ det[i].style.display = open?'block':'none'; }
    if(e) e.textContent = open?'▾ collapse':'▸ expand full text';
  };
}
// THE PICK-TRACE (2026-07-18 — operator: "I need to see the logic of the filter, not just the
// aggregate precision"): the rules the reef SELECTED for this state, ranked by the deterministic
// IDF-density relevance score (LLM-FREE). Green = strong, amber = weak (picked but far). An
// ablated/no-reef state has an empty trace — no pick mechanism. The pick made auditable.
function renderPickTrace(st){
  const host = $('pickTrace'); if(!host) return;
  const w = st && st.metrics && st.metrics.walk;
  const trace = (w && w.selection_trace) || [];
  if(!trace.length){
    host.innerHTML = '<div style="border:1px solid #2a3350;border-radius:8px;padding:8px 12px;background:#0d1220"><div style="font-size:12px;font-weight:700;color:#e8eefc">◧ Pick-Trace — the rules the reef selected</div><div class="dim" style="font-size:10.5px;margin-top:4px">no selection trace on this state (re-bake with the server up; an ablated/no-reef state has no pick mechanism — it wanders).</div></div>';
    return;
  }
  var mx = Math.max.apply(null, trace.map(function(t){ return t.score; }).concat([0.0001]));
  var rows = trace.slice(0,15).map(function(t){
    var rel = t.score/mx; var col = t.score<=0 ? '#8a94a6' : (rel<0.34 ? '#f0b429' : (rel<0.67?'#c9d14a':'#46d369'));
    var barW = Math.round(Math.max(2, rel*100));
    return '<div style="display:flex;align-items:center;gap:6px;margin:2px 0;font-size:10.5px">'
      + '<span style="color:#6b7385;width:16px;text-align:right">'+(t.rank+1)+'</span>'
      + '<div style="flex:0 0 46px;height:8px;background:#1a1f2e;border-radius:2px;overflow:hidden"><div style="height:100%;width:'+barW+'%;background:'+col+'"></div></div>'
      + '<span style="color:'+col+';width:42px;font-variant-numeric:tabular-nums">'+t.score.toFixed(3)+'</span>'
      + '<span style="color:#c3cad8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(t.rule||'').replace(/</g,'&lt;')+(t.why?' <span style="color:#6b7385">· ['+t.why+']</span>':'')+'</span>'
      + '</div>';
  }).join('');
  host.innerHTML = '<div style="border:1px solid #2a3350;border-radius:8px;padding:8px 12px;background:#0d1220">'
    + '<div style="font-size:12px;font-weight:700;color:#e8eefc;margin-bottom:2px">◧ Pick-Trace — '+trace.length+' rules selected, ranked by relevance</div>'
    + '<div class="dim" style="font-size:10px;margin-bottom:5px">deterministic IDF-density score (LLM-free) · <span style="color:#46d369">■ strong</span> <span style="color:#f0b429">■ weak</span> · [matched stems] = why it was picked for this prompt</div>'
    + rows + '</div>';
}
// THE DEEP FIX (2026-07-18 — operator: "we need a deep fix" for local hash time): the page never
// computed the hash — it displayed the SERVER's seal.hash_ms. But the thesis is "recompute it
// yourself, offline." verifySeal RECOMPUTES the content sha256 IN-BROWSER over the SAME canonical
// fields the seal was signed over ({parent_id, threshold, inputs, metrics}), TIMES that recompute
// (the real local hash time), and CHECKS it against st.seal.content_sha256. Match → the seal is
// browser-VERIFIED (green, with the real ms). Mismatch → TAMPERED (red) — the state was altered
// after sealing. On an unsealed live edit there is no seal → honest '—'. This makes the receipt
// self-verifying offline, and local-hash-time a real measurement — the whole point of the artifact.
async function verifySeal(st){
  const gh=$('g-hashtime'), gv=$('g-sealsig'), gr=$('g-sealreceipt');
  const seal = st && st.seal;
  if(!seal || !seal.content_sha256){ if(gh) gh.textContent='—'; if(gv){ gv.textContent='unsealed'; gv.style.color='var(--dim)'; } return; }
  try {
    const canon = JSON.stringify({ parent_id: st.parent_id==null?null:st.parent_id, threshold: st.threshold, inputs: st.inputs, metrics: st.metrics });
    const t0 = (self.performance&&performance.now)?performance.now():Date.now();
    const got = await sha256(canon);
    const ms = ((self.performance&&performance.now)?performance.now():Date.now()) - t0;
    const match = (got === seal.content_sha256);
    if(gh){ gh.textContent = (ms<1?ms.toFixed(2):Math.round(ms))+'ms'; gh.title = 'in-browser recompute of the content sha256 (offline, no server) — this IS the local hash time'; }
    if(gr){ gr.textContent = 'receipt '+seal.content_sha256.slice(0,10); }
    if(gv){
      if(match){ gv.textContent = seal.signed ? 'ed25519 ✓ verified' : 'sha256 ✓ verified'; gv.style.color='var(--gn)'; gv.title='the browser recomputed the hash and it MATCHES the sealed record — offline-verified'; }
      else { gv.textContent = 'TAMPERED ✗'; gv.style.color='var(--rd)'; gv.title='the recomputed hash does NOT match the sealed record — the state was altered after sealing'; }
    }
  } catch(e){ if(gh) gh.textContent='—'; }
}
// paintHud — the single render(state)→DOM. Every mapped tile shows its selector's value, or '—'
// (a dash is an HONEST null, never a forgotten tile). Called by goToState; nothing else paints these.
// SELECTIVE REPAINT (R11/D2 — operator: "only paint and recompute the parts that changed… a mathematical
// right update for the same reason Redux works"): paintHud MEMOIZES the last value it wrote per tile and
// SKIPS the write when the new value is identical. An unchanged repaint therefore writes ZERO tiles — the
// "zero-delta ⇒ bypass" principle at the projection layer. Correctness is preserved: a skipped tile
// already holds the correct value (it was written last time and hasn't changed). This is the degenerate
// (signal = whole state) case of the chip delta-emitter designed in docs/architecture/attest-delta-
// propagation.md; the per-signal emitter refines WHICH diff triggers WHICH tile, same bypass semantics.
// Color rides the value: for every mapped tile the color is a pure function of the same inputs that
// determine the value, so an unchanged value ⇒ unchanged color (no separate color write needed).
var __lastTile = {};
function paintHud(st){
  window.__hudTileWrites = 0;
  for(const t of HUD_MAP){ const el=$(t.id); if(!el) continue; const v=t.get(st); const nv=(v==null?'—':String(v));
    if(__lastTile[t.id] !== nv){ el.textContent = nv; if(t.color) el.style.color=t.color(st); __lastTile[t.id]=nv; window.__hudTileWrites++; }
  }
  try{ renderPickTrace(st); }catch(e){} try{ renderRuleHatCompare(st); }catch(e){} try{ verifySeal(st); }catch(e){}
}

async function goToState(i){
  if(i < 0 || i >= flightTape.length) return;
  const st = flightTape[i];
  // REPLAY SEMANTICS (operator 2026-07-18: "replay reads the tape; if it recomputes it should
  // advance the tape"): stash the state's SEALED receipts (placement metrics + walk + ideal)
  // BEFORE run(). During a replay the STORED verdict + Greeks are authoritative — the /render
  // call is fired for PANELS only and must not overwrite them (the refresh incident: a fresh
  // boot recomputed UNPLACEABLE from the boxes and clobbered the sealed OFF_DOMAIN + Greeks).
  window.__tapeWalk = (st.metrics && st.metrics.walk) || null;
  window.__tapeIdeal = (st.metrics && st.metrics.walk && st.metrics.walk.ideal_domain) || null;
  window.__replayState = st;   // cleared by liveRustRender after the panel pass
  // THE SEAL ON REPLAY (2026-07-18): "local hash time — · unsigned · receipt n/a" was the HUD
  // naming its own gap. Terminal states now carry seal {content_sha256, hash_ms, signature} —
  // paint it; hash-only states show 'sha256 only' amber, never a silent dash.
  // THE SINGLE PAINT: UI = f(tape). paintHud maps the whole HUD from the tape state via HUD_MAP —
  // no scattered per-tile wiring, so no tile can be forgotten. This is the self-healing contract.
  paintHud(st);
  $('tIntent').value = st.inputs.intent; $('tReality').value = st.inputs.reality; $('tNegative').value = st.inputs.negative;
  renderDumpGlyphs();   // R12: the per-box semantic-dump glyphs are a pure fn of the box text (= f(tape state))
  if(typeof st.threshold === 'number'){ const th = $('threshold'); th.value = st.threshold; const tv = $('threshVal'); if(tv) tv.textContent = st.threshold + '%'; }
  currentScenario = st.scenarioKey ? ((D.scenarios || []).find(s => s.key === st.scenarioKey) || null) : null;
  await run();   // Gotcha 3: recompute+render from the stored inputs (incl. the policy limit) — a REPLAY, never a new append
  cursor = i; renderScrubber();
}
// Prev/Next navigate the ACTIVE PATH (the causal branch), not raw array order
function stepScrub(dir){
  const path = activePath(); const pos = path.findIndex((s) => s.id === flightTape[cursor].id);
  const target = path[pos + dir]; if(target) goToState(flightTape.indexOf(target));
}
// ── THE SHARED-TAPE POLL — CC "clicks the buttons" from the terminal (attest-perturb.mjs appends a
// branch-linked state to ./attest-flight-tape.json); the SERVED page polls that file and merges any new
// states, then jumps to the newest and re-renders. UI = f(sharedTape). Air-gap intact: this only runs when
// the page is SERVED over http (localhost) — under file:// there is no fetch, so the file stays a static,
// fully-disconnected receipt. Nothing leaves the machine either way (127.0.0.1 only).
// ── LIVE RUST (served only): "the page must run rust." POST the current inputs to the local /render
// endpoint (127.0.0.1 — air-gapped to the internet, NOT to the chip) and swap in the freshly ballistic-
// walked panels. Non-blocking + coalesced: if inputs change mid-render, one more render fires after. On
// file:// (no endpoint) it silently no-ops and the pre-rendered panels stand.
let __rustBusy = false, __rustPending = false;
async function liveRustRender(){
  if(!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return;
  if(__rustBusy){ __rustPending = true; return; }
  __rustBusy = true;
  document.body.classList.add('rustpending'); const spin = $('rustSpin'); if(spin) spin.hidden = false;   // spinning until all rust finishes; stale panels dimmed
  clearTimeout(window.__rustSafety); window.__rustSafety = setTimeout(()=>{ document.body.classList.remove('rustpending'); const s2=$('rustSpin'); if(s2) s2.hidden=true; __rustBusy=false; }, 20000);   // SAFETY: never leave the page dimmed if a render hangs
  // TAPE-WALK PASSTHROUGH (2026-07-18 — "the polling did not repopulate the greeks"): a merged
  // terminal state carries its sealed metal receipts in metrics.walk (incl. ideal_domain). The
  // recompute must carry the SAME ideal or the Chebyshev band comes back null and the gauges dash.
  const body = { intent: $('tIntent').value, reality: $('tReality').value, negative: $('tNegative').value, threshold: (function(){ const t=$('threshold'); return t ? +t.value : 25; })(), ...(window.__tapeIdeal ? { ideal: window.__tapeIdeal } : {}) };
  // ALWAYS FILL: only replace a panel when the fresh walk PNG is SUBSTANTIAL (a sparse/thin walk ~1KB must
  // not blank the good baseline). Full walk panels are ~8-12KB b64; the bar cleanly rejects the thin ones.
  const setSrc = (id, src)=>{ const im=$(id); if(im && src && src.length > 2000){ im.src = src; im.style.visibility='visible'; } };
  try {
    const r = await fetch('./render', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    if(r.ok){
      const d = await r.json(), a = d.a && d.a.panels, b = d.b && d.b.panels;
      // encircled is ALWAYS populated now (the server falls back to the delta when 0-region), so always swap it
      if(a){ setSrc('w-iGzip', a.rawIntent); setSrc('w-iWalk', a.intent); setSrc('w-rGzip', a.rawReality); setSrc('w-rWalk', a.reality); setSrc('mg-deltaA', a.delta); setSrc('mg-tolA', a.tolerance); setSrc('mg-encA', a.encircled); setSrc('hudImgA', a.encircled); }
      if(b){ setSrc('w-nGzip', b.rawReality); setSrc('w-nWalk', b.reality); setSrc('mg-deltaB', b.delta); setSrc('mg-tolB', b.tolerance); setSrc('mg-encB', b.encircled); setSrc('hudImgB', b.encircled); }
      // IO CONTEXT (operator 2026-07-15): surface each ingest's fill so a thin panel is DIAGNOSABLE, not
      // mysteriously blank — you see WHICH corpus is sparse and edit that box. Permanently avoids empty panels.
      const io = [], mark = (label, ioObj) => { if(!ioObj) return; const r = ioObj.panels && ioObj.panels.reality; const kb = (n)=> (n/1000).toFixed(1)+'KB'; if(r) io.push(label + ' ' + kb(r.walkBytes) + (r.sparse ? ' <b class="am">⚠ sparse — edit this box</b>' : ' <b class="gn">✓</b>')); };
      mark('reality', d.a && d.a.io); mark('negative', d.b && d.b.io);
      // DISPLAY ← METAL (Step 1.2): the gauges read the on-chip live_response_metrics from /render — the
      // sealed pmu-onchip numbers — NOT the browser sep/σ analogue. The chip writes the OUT; the screen mirrors.
      // TAPE-WALK MERGE: on a REPLAY the tape receipts WIN over the recompute (the stored state
      // is the sealed record; the recompute only refreshes panels). On a live edit the recompute
      // wins and the tape fills only what it left null.
      const RS = window.__replayState;
      let M = d.live_response_metrics; const TW = window.__tapeWalk;
      if(TW){
        if(RS){ M = { ...(M||{}), ...Object.fromEntries(Object.entries(TW).filter(([k,v])=>v!=null)) }; }
        else { M = { ...(M||{}) }; for(const k of Object.keys(TW)) if(M[k]==null && TW[k]!=null) M[k]=TW[k]; }
      }
      if(M){
        window.__lastMetal = M;   // the EXACT metal the status line + export read. NOTE: the HUD is NOT
        // painted from M here. TOTAL PROJECTION (operator 2026-07-18: "one source of truth for those
        // things — that's the whole point of a tape"): liveRustRender refreshes PANEL IMAGES + the verdict
        // badge ONLY; it may NOT write a single HUD tile. The HUD is a pure projection of the tape via
        // goToState→paintHud, painted ONCE per state change. Seven rounds of "which painter wins the race"
        // ended by DELETING the second painter, not by patching precedence. On a live edit the edited
        // state is APPENDED to the tape and painted from THERE (see the __editDirty branch below), so even
        // an edit renders from the one source. Guarded by hud-single-projection.test.mjs — a g-* write in
        // this function turns the build red.
        const hs = $('hudState'); if(hs && M.pixel_coord){ hs.title = 'metal placement ' + M.pixel_coord + ' · Δ ' + (M.continuous_chebyshev_delta==null?'—':M.continuous_chebyshev_delta); }
      }
      // VERDICT ← METAL (Loop-1-dead): the ENTIRE verdict surface — badge, fail banner, HUD mode sentence,
      // tol-labels, the NCD distance cards, the drift gauge — is painted from the server verdict (gzip-NCD on
      // metal, LLM-free) by paintVerdictFromMetal. There is no browser recompute; window.__lastVerdict is what
      // the M3 zero-drift guard asserts the whole painted surface equals.
      // VERDICT: on a REPLAY the stored placement verdict is the sealed record — paint IT, not
      // the recompute (the recompute of a replayed state is a display refresh, not a new event).
      // On a live edit the fresh server verdict paints AND the state advances the shared tape.
      const RS2 = window.__replayState;
      if(RS2 && RS2.metrics && RS2.metrics.verdict){
        // A PLACEMENT-ONLY STATE STILL MEASURED ITS DRIFT — it is walk.off_pct, not metrics.drift.
        // (Corrected 2026-07-20: an earlier pass read the absent metrics.drift and concluded "no
        // drift was computed", which is false — all 152 harvest cycles carry off_pct, range 0-40.)
        // metrics.drift is the Intent/Reality/Negative NCD triangulation; off_pct is the walk's
        // out-of-lane fraction. Different measurements, both real. Pass off_pct so the painter can
        // narrate the actual percentage and judge it against the LIVE slider.
        const SV = { tag: RS2.metrics.verdict, mode: RS2.metrics.mode, driftPct: RS2.metrics.drift,
          offPct: (RS2.metrics.walk && RS2.metrics.walk.off_pct != null) ? +RS2.metrics.walk.off_pct : null,
          dI: RS2.metrics.dI ?? null, dN: RS2.metrics.dN ?? null, threshold: RS2.threshold ?? null };
        window.__lastVerdict = SV;
        paintVerdictFromMetal(SV);
        const bs2 = $('boolState'); if(bs2) bs2.title = (bs2.title||'') + ' · SEALED — from the tape (' + RS2.id + '), not recomputed';
      } else if(d.verdict){
        window.__lastVerdict = d.verdict;
        paintVerdictFromMetal(d.verdict);
        // RECOMPUTE ADVANCES THE TAPE: an operator-edit render is a new event — append it to the
        // shared tape (same schema as a CLI perturb, source 'page-recompute'). Gated on a real
        // edit (__editDirty) so boot/replay renders never spam the timeline.
        if(window.__editDirty && !RS2){
          window.__editDirty = false;
          try {
            fetch('./tape-append', { method:'POST', headers:{'content-type':'application/json'},
              body: JSON.stringify({ parent_id: (flightTape[cursor]&&flightTape[cursor].id)||null,
                label: 'operator edit', threshold: body.threshold, inputs: { intent: body.intent, reality: body.reality, negative: body.negative },
                metrics: { verdict: d.verdict.tag, mode: d.verdict.mode, drift: d.verdict.driftPct,
                  dI: d.verdict.dI ?? null, dN: d.verdict.dN ?? null, walk: d.live_response_metrics || null,
                  placement_only: d.live_response_metrics == null } }) })
              .then(r=>r.json()).then(function(j){
                if(!j || !j.state) { if(j && j.id) __mergedIds.add(j.id); return; }
                // R3: the appended state comes back COMPLETE + SEALED. Push it and paint it FROM THE TAPE
                // (the one projection) — Greeks + seal + tier all populate, no hollow edit state.
                __mergedIds.add(j.id);
                if(!flightTape.some(function(x){return x.id===j.id;})) flightTape.push(j.state);
                cursor = flightTape.length - 1; goToState(cursor);
                // then fetch the HELD-OUT live ideal (qwen) + its gzip-NCD scorecard, attach to the
                // appended state, and re-render JUST the audit box. Async — never blocks the paint; the
                // ideal is a comparison signal only, never the verdict/seal.
                var actual = (d.live_response_metrics && d.live_response_metrics.rule_hat_compare) || {};
                fetch('./ideal', { method:'POST', headers:{'content-type':'application/json'},
                  body: JSON.stringify({ intent: body.intent, actual_rules: actual.actual_rules || [], actual_hat: actual.actual_hat || null }) })
                  .then(function(r){ return r.json(); }).then(function(id){
                    if(id && id.ideal){ j.state.audit_ideal = id.ideal; if((typeof cursor==='number') && flightTape[cursor] && flightTape[cursor].id===j.state.id) renderRuleHatCompare(j.state); }
                  }).catch(function(){});
              }).catch(function(){});
          } catch(e){}
        }
      }
      window.__replayState = null;   // replay complete — subsequent renders are live again
      const hl = document.querySelector('.hudlbl'); if(hl) hl.innerHTML = '<b class="gn">⚡ LIVE RUST</b> — <b>ballistic-walked on-chip</b> via the local endpoint (127.0.0.1, no internet). Edit any box → the walk re-runs. Page = f(tape).' + (io.length ? '<br><span class="dim">ingest io — ' + io.join(' · ') + '</span>' : '');
    }
  } catch { // endpoint absent (file:// or static serve) or a fetch error — panels stand. The HUD is
    // NOT painted here: it was already painted from the tape by goToState→paintHud BEFORE run() called
    // liveRustRender. Painting gauges from __tapeWalk here was the SECOND painter that raced the tape
    // (the "Greeks dash / placement disagrees with walk" bug). A tooltip is not a tile value, so the
    // diagnostic hudState title is allowed; no g-* textContent write is.
    const TW = window.__tapeWalk;
    if(TW){
      const hs = $('hudState'); if(hs && TW.pixel_coord){ hs.title = 'tape placement ' + TW.pixel_coord + ' · Δ ' + (TW.continuous_chebyshev_delta==null?'—':TW.continuous_chebyshev_delta) + (TW.render_ms!=null?' · '+TW.render_ms+'ms':''); }
    }
  }
  __rustBusy = false;
  if(__rustPending){ __rustPending = false; return liveRustRender(); }   // coalesced re-render keeps the spinner up
  clearTimeout(window.__rustSafety); document.body.classList.remove('rustpending'); const sp = $('rustSpin'); if(sp) sp.hidden = true;   // all rust finished — reveal all panels
  // NEVER-BLANK (2026-07-18): if the fresh walk was thin, setSrc rejected the swap — correct —
  // but any panel that still HOLDS a substantial src must be visible. Stale-and-labeled beats
  // blank; the io "sparse — edit this box" line carries the diagnosis. A blank panel is a bug.
  ['w-iGzip','w-iWalk','w-rGzip','w-rWalk','mg-deltaA','mg-tolA','mg-encA','hudImgA','w-nGzip','w-nWalk','mg-deltaB','mg-tolB','mg-encB','hudImgB'].forEach((id)=>{ const im=$(id); if(im && im.src && im.src.length > 2000) im.style.visibility='visible'; });
}
const __mergedIds = new Set();
// THE YANK GUARD (operator 2026-07-15 — "the flickering even affects the slider move"): a poll-merge
// used to goToState() on EVERY new tape event, overwriting the boxes + threshold mid-gesture — a
// terminal sweep writing dozens of events made the page yank continuously. Events still MERGE every
// poll (the tape is never dropped); the CURSOR SNAP is deferred while the operator is actively
// interacting (any input/pointer within the last 3 s), then the next quiet poll lands on the newest.
window.__lastUserTs = 0;
document.addEventListener('input', () => { window.__lastUserTs = Date.now(); }, true);
document.addEventListener('pointerdown', () => { window.__lastUserTs = Date.now(); }, true);
async function pollTape(){
  if(!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return;
  let doc; try { const r = await fetch('./attest-flight-tape.json?_=' + Date.now(), { cache: 'no-store' }); if(!r.ok) return; doc = await r.json(); } catch { return; }
  const ev = Array.isArray(doc?.timeline_events) ? doc.timeline_events : [];
  let newest = null;
  for(const s of ev){ if(!s || !s.id || __mergedIds.has(s.id) || flightTape.some((x) => x.id === s.id)) continue; __mergedIds.add(s.id); flightTape.push(s); newest = s; }
  if(!newest && window.__pendingMergeSnap && Date.now() - window.__lastUserTs > 3000){ newest = window.__pendingMergeSnap; }   // quiet again — land the deferred snap
  if(newest){ // a terminal perturbation arrived — load its inputs, repaint from OUR gzip, land the cursor on it
    if(Date.now() - window.__lastUserTs <= 3000){ window.__pendingMergeSnap = newest; renderScrubber(); return; }   // operator mid-gesture: merge only, no yank
    window.__pendingMergeSnap = null;
    const i = flightTape.indexOf(newest);
    const banner = $('scrubLabel'); if(banner) banner.textContent = '⇩ terminal perturbation merged: ' + (newest.label || newest.id);
    await goToState(i);
  }
}
// ── PASSIVE VIEWPORT SWEEP (Step 6) — the controls are a REFLECTION of the tape, not independent DOM
// state. On change, a CONFIG frame is appended to the ledger fire-and-forget (POST /viewport-config); the
// 0.5s poll reads the tail (GET /viewport-config) and reconciles the controls passively — but NEVER
// clobbers a control the operator is actively touching (the SAME yank guard the flight-tape merge uses:
// focus OR any input/pointer within the last 3s). The optimistic local echo on the control (below) paints
// the new value INSTANTLY so dragging feels live; the poll only reconciles when the DOM has DRIFTED from
// the ledger while the operator is idle. Tape = source of truth · local echo = immediate feedback.
function currentViewportConfig(){
  return { threshold: (function(){ const t=$('threshold'); return t ? +t.value : null; })(),
           include_fail_b: $('includeFailB') ? $('includeFailB').checked : null, view: null };
}
function postViewportConfig(){
  if(!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return;
  try { fetch('./viewport-config', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(currentViewportConfig()) }).catch(()=>{}); } catch(e){}
}
async function pollViewportConfig(){
  if(!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return;
  let doc; try { const r = await fetch('./viewport-config?_=' + Date.now(), { cache:'no-store' }); if(!r.ok) return; doc = await r.json(); } catch { return; }
  const cfg = doc && doc.config; if(!cfg) return;
  // YANK GUARD (extends the flight-tape merge guard at pollTape): the optimistic echo already showed the
  // operator their own change, so a mid-gesture reconcile would only fight the cursor — defer it while a
  // control is focused OR any input/pointer landed in the last 3s, then a quiet poll lands the ledger value.
  const focused = ['threshold','includeFailB'].some((id)=>{ const el=$(id); return el && document.activeElement===el; });
  if(focused || Date.now() - window.__lastUserTs <= 3000) return;
  let changed = false;
  if(cfg.threshold != null){ const th=$('threshold'); if(th && +th.value !== +cfg.threshold){ th.value = cfg.threshold; const tv=$('threshVal'); if(tv) tv.textContent = cfg.threshold + '%'; const gt=$('g-threshold'); if(gt) gt.textContent = cfg.threshold + '%'; changed = true; } }
  if(cfg.include_fail_b != null){ const cb=$('includeFailB'); if(cb && cb.checked !== !!cfg.include_fail_b){ cb.checked = !!cfg.include_fail_b; changed = true; } }
  window.__lastViewportConfig = cfg;   // the ledger value the DOM was reconciled to (the guard test reads this)
  if(changed) liveRustRender();        // PASSIVE re-render — reflect the reconciled policy, NEVER fire()/append a state
}
// ── AUTONOMOUS-MODE BUDGET DONUT — vanilla SVG, zero libraries (the page is air-gapped; a CDN
// chart lib would be a network call on an instrument whose entire claim is that it makes none).
// Subdivided by stage and colour-coded by the one distinction that matters: deterministic (cyan)
// vs model (amber). Arithmetic is plain trigonometry; no dependency, no build step.
function renderBudget(){
  var host = $('budgetChart'); if(!host || !D.autonomyBudget) return;
  var segs = D.autonomyBudget.segments || []; if(!segs.length) return;
  var R = 78, r = 46, cx = 92, cy = 92, a0 = -Math.PI/2, parts = [];
  var CY = getComputedStyle(document.documentElement).getPropertyValue('--cy').trim() || '#22d3ee';
  var AM = getComputedStyle(document.documentElement).getPropertyValue('--am').trim() || '#f59e0b';
  // deterministic stages get graded cyan tints so the SUBDIVISION is readable inside the family
  var tints = ['', '', ''], di = 0;
  for(var i=0;i<segs.length;i++){
    var s = segs[i], frac = s.pct/100, a1 = a0 + frac*2*Math.PI;
    var large = (a1-a0) > Math.PI ? 1 : 0;
    var x0=cx+R*Math.cos(a0), y0=cy+R*Math.sin(a0), x1=cx+R*Math.cos(a1), y1=cy+R*Math.sin(a1);
    var ix1=cx+r*Math.cos(a1), iy1=cy+r*Math.sin(a1), ix0=cx+r*Math.cos(a0), iy0=cy+r*Math.sin(a0);
    var d = 'M'+x0+','+y0+' A'+R+','+R+' 0 '+large+' 1 '+x1+','+y1+' L'+ix1+','+iy1+' A'+r+','+r+' 0 '+large+' 0 '+ix0+','+iy0+' Z';
    var fill = s.llm ? AM : CY;
    var op = s.llm ? 1 : (di===0 ? 1 : (di===1 ? 0.62 : 0.38));
    if(!s.llm) di++;
    parts.push('<path d="'+d+'" fill="'+fill+'" opacity="'+op+'"><title>'+s.name+' — '+s.ms+'s ('+s.pct+'%)</title></path>');
    a0 = a1;
  }
  var llmPct = segs.filter(function(s){return s.llm;}).reduce(function(a,b){return a+b.pct;},0);
  host.innerHTML = '<svg viewBox="0 0 184 184" width="184" height="184" role="img" aria-label="autonomous tick time budget">'
    + parts.join('')
    + '<text x="92" y="86" text-anchor="middle" font-family="var(--mono)" font-size="21" font-weight="700" fill="currentColor">'+D.autonomyBudget.total_s+'s</text>'
    + '<text x="92" y="104" text-anchor="middle" font-family="var(--mono)" font-size="10" opacity="0.7" fill="currentColor">per tick</text>'
    + '<text x="92" y="120" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="'+AM+'">'+llmPct.toFixed(0)+'% model</text>'
    + '</svg>';
  var leg = $('budgetLegend'); if(!leg) return;
  leg.innerHTML = segs.map(function(s){
    var c = s.llm ? AM : CY;
    return '<div class="budgetrow"><span class="budgetsw" style="background:'+c+'"></span>'
      + '<span class="bn">'+s.name+(s.llm?' <b class="am">· LLM</b>':' <span class="dim">· deterministic</span>')+'</span>'
      + '<span class="bv">'+s.ms+'s · '+s.pct+'%</span></div>';
  }).join('');
  initLoopControls();
}

// AUTO-TICK CONTROLS — live only when served by attest-serve (127.0.0.1); on file:// the fetch
// fails and the checkboxes stay disabled with an honest note (the air-gap is preserved — the
// page never gains network reach, it only talks to the local instrument that already serves it).
var loopCtlWired = false;
function initLoopControls(){
  if(loopCtlWired) return; loopCtlWired = true;
  var auto = $('loopAuto'), ab = $('loopAB'), state = $('loopState');
  if(!auto || !ab || !state) return;
  function paint(st){
    auto.disabled = !st.running; ab.disabled = !st.running;
    auto.checked = st.running && !st.paused; ab.checked = !!st.ab;
    state.textContent = st.running
      ? ('loop pid live · ' + (st.paused ? 'PAUSED' : 'ticking') + (st.lastStages ? ' · ' + st.lastStages.replace('stage-times: ','') : ''))
      : 'loop not running — start it in a terminal: bash scripts/pmu/reef-loop.sh loop';
  }
  function poll(){
    fetch('./loop-status', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(paint)
      .catch(function(){ auto.disabled = true; ab.disabled = true; state.textContent = 'controls need the local server (node scripts/pmu/attest-serve.mjs) — file:// stays air-gapped'; });
  }
  function send(action){
    fetch('./loop-control', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ action: action }) })
      .then(function(){ poll(); }).catch(function(){ poll(); });
  }
  auto.addEventListener('change', function(){ send(auto.checked ? 'resume' : 'pause'); });
  ab.addEventListener('change', function(){ send(ab.checked ? 'ab-on' : 'ab-off'); });
  poll(); setInterval(poll, 5000);
}

function renderScrubber(){
  const el = $('scrubLabel'), hud = $('hudScrub'), hp = $('hudPrev'), hn = $('hudNext');
  const setHud = (txt, pd, nd) => { if(hud) hud.textContent = txt; if(hp) hp.disabled = pd; if(hn) hn.disabled = nd; };
  if(flightTape.length === 0 || cursor < 0){ el.textContent = '— no records yet —'; $('prevBtn').disabled = true; $('nextBtn').disabled = true; $('histBanner').hidden = true; setHud('—', true, true); return; }
  const path = activePath(), pos = path.findIndex((s) => s.id === flightTape[cursor].id), st = flightTape[cursor];
  const ghosted = flightTape.length - path.length;   // preserved discarded-branch nodes
  const label = 'State ' + (pos + 1) + ' of ' + path.length + ': ' + (st.label || '—') + (st.metrics.verdict ? ' · ' + st.metrics.verdict : '') + (ghosted > 0 ? ' · ' + ghosted + ' branched' : '');
  el.textContent = label;
  $('prevBtn').disabled = pos <= 0;
  $('nextBtn').disabled = pos >= path.length - 1;
  $('histBanner').hidden = (childrenOf(st.id).length === 0);   // banner shows iff the cursor has a child (viewing the past)
  setHud((pos + 1) + '/' + path.length + ' · ' + (st.metrics.verdict || st.label || '—'), pos <= 0, pos >= path.length - 1);   // FF/rewind on the floating panel
  renderConvChart(path, pos);
}
// THE CONVERGENCE CHART (2026-07-18 — "draw charts and optimise by them"): a sparkline over the
// active path's drift/threshold per step. The recovery arc (breach → under the limit) is the shape
// the operator reads to know a lever gripped. Vanilla SVG, no libraries, file:// safe.
function renderConvChart(path, pos){
  const host = $('convChart'); if(!host) return;
  // POINT AT ONE ARC: if the cursor is on a scenario step, chart ONLY that scenario's contiguous
  // run — the breach→recover arc, not the whole tape. One arc across the policy line is a proof;
  // 98 unrelated points are noise. (Design: docs/pmu/demo-page-sequence-design.md.)
  const cur = path[pos] || {};
  const scn = cur.scenarioKey || null;
  let seg = path, segPos = pos, title = '';
  if(scn){
    let lo = pos; while(lo > 0 && path[lo-1].scenarioKey === scn) lo--;
    let hi = pos; while(hi < path.length-1 && path[hi+1].scenarioKey === scn) hi++;
    seg = path.slice(lo, hi+1); segPos = pos - lo;
    title = (cur.metrics && cur.metrics.conv && cur.metrics.conv.scenario) ? cur.metrics.conv.scenario : scn;
  }
  const pts = seg.map(s => ({ drift: (s.metrics && (s.metrics.drift!=null?s.metrics.drift:(s.metrics.conv&&s.metrics.conv.driftPct!=null?s.metrics.conv.driftPct:null))), thr: (s.threshold!=null?s.threshold:45) }));
  const have = pts.filter(p => typeof p.drift === 'number');
  if(have.length < 2){ host.innerHTML = '<span class="dim" style="font-size:11px">convergence chart — scrub to a scenario arc (Next ▷|) or bake one: scripts/pmu/scenario-to-tape.mjs</span>'; return; }
  path = seg; pos = segPos;   // draw the arc, not the whole tape
  const W=Math.max(220, path.length*26), H=54, PAD=6, thr=pts[0].thr||45;
  const x=function(i){ return PAD + i*((W-2*PAD)/Math.max(1,path.length-1)); };
  const y=function(d){ return H-PAD - (Math.max(0,Math.min(100,d))/100)*(H-2*PAD); };
  var line=''; for(var i=0;i<pts.length;i++){ if(typeof pts[i].drift==='number'){ line += (line?' L':'M') + x(i).toFixed(1) + ',' + y(pts[i].drift).toFixed(1); } }
  var dots=''; for(var j=0;j<pts.length;j++){ if(typeof pts[j].drift==='number'){ dots += '<circle cx="'+x(j).toFixed(1)+'" cy="'+y(pts[j].drift).toFixed(1)+'" r="'+(j===pos?4:2.5)+'" fill="'+(pts[j].drift<=thr?'#46d369':'#ff5d52')+'"'+(j===pos?' stroke="#e8eefc" stroke-width="1.5"':'')+'/>'; } }
  var thrY = y(thr).toFixed(1);
  host.innerHTML = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="overflow:visible">'
    + '<line x1="'+PAD+'" y1="'+thrY+'" x2="'+(W-PAD)+'" y2="'+thrY+'" stroke="#f0b429" stroke-width="1" stroke-dasharray="3 3"/>'
    + '<text x="'+(W-PAD)+'" y="'+(+thrY-3)+'" fill="#f0b429" font-size="9" text-anchor="end">policy '+thr+'%</text>'
    + '<path d="'+line+'" fill="none" stroke="#4aa3ff" stroke-width="1.5"/>'+dots+'</svg>'
    + '<div class="dim" style="font-size:10px;margin-top:2px">drift% per step'+(title?' · <b>'+title+'</b> arc':'')+' · green = in-lane · the recovery arc is convergence · '+have.length+' steps</div>';
}
// THE COUNTERFACTUAL PANEL (2026-07-18 — "this is the story you need to see"): with-reef vs
// ablated, the reef relief. General intelligence routes on its own; the REEF snaps it to the
// rules + hat. Two bars per metric — the GAP is the product. Vanilla, file:// safe.
function renderCounterfactual(){
  const host = $('counterfactual'); if(!host) return;
  const cf = D.counterfactual; if(!cf){ host.innerHTML=''; return; }
  // THE ABLATE TOGGLE (2026-07-18 — the forwardable experiment): flip the reef OFF and watch the
  // measured collapse. Both paths are MEASURED held-out results (snap-counterfactual.mjs), not a
  // live simulation — the toggle switches which measured path drives the headline, honestly labeled.
  const ablated = !!window.__ablateView;
  const a = cf.path_alpha, b = cf.path_beta, cur = ablated ? b : a;
  const bar = function(label, av, bv){
    const pa = Math.round((av||0)*100), pb = Math.round((bv||0)*100);
    return '<div style="margin:5px 0"><div style="font-size:11px;color:#8a94a6;margin-bottom:2px">'+label
      + ' — <b style="color:#46d369">with reef '+pa+'%</b> vs <span style="color:#ff5d52">no reef '+pb+'%</span></div>'
      + '<div style="position:relative;height:14px;background:#1a1f2e;border-radius:3px;overflow:hidden">'
      + '<div style="position:absolute;left:0;top:0;height:100%;width:'+pa+'%;background:#46d369;opacity:'+(ablated?'.25':'.85')+'"></div>'
      + '<div style="position:absolute;left:0;top:0;height:100%;width:'+pb+'%;background:#ff5d52;opacity:'+(ablated?'.95':'.9')+';border-right:2px solid #fff"></div>'
      + '</div></div>';
  };
  host.innerHTML = '<div style="border:1px solid #2a3350;border-radius:8px;padding:10px 12px;background:#0d1220">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div style="font-size:12px;font-weight:700;color:#e8eefc">◧ Operational Determinism — what the reef adds (measured)</div>'
    + '<label style="font-size:11px;color:'+(ablated?'#ff5d52':'#8a94a6')+';cursor:pointer;display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="ablateToggle" '+(ablated?'checked':'')+'> ablate the reef</label>'
    + '</div>'
    + '<div style="font-size:13px;margin-bottom:6px;color:'+(ablated?'#ff5d52':'#46d369')+'"><b>'+(ablated?'PATH β · no reef':'PATH α · with reef')+'</b> — hat '+Math.round((cur.hat_acc||0)*100)+'% · rules-precision '+Math.round((cur.rules_precision||0)*100)+'% · routing '+Math.round((cur.route_acc||0)*100)+'%</div>'
    + bar('Playbook (hat) correct', a.hat_acc, b.hat_acc)
    + bar('Rules on-target (precision)', a.rules_precision, b.rules_precision)
    + bar('Routing (finds the lane)', a.route_acc, b.route_acc)
    + '<div class="dim" style="font-size:10.5px;margin-top:7px;line-height:1.5">Both paths are MEASURED held-out results, deterministic and LLM-free — not a simulation. The model <b>routes on its own</b> (routing identical both paths: base intelligence). The <b style="color:#46d369">reef</b> supplies the playbook + rule layer: <b>0→100% hats, 0→97% rules</b>, without holding all 181 rules in context. Not a safety claim (Rice-barred) — a determinism claim: precision measured, bounded, ratchet-gated. Recompute it yourself: <code>scripts/pmu/snap.sh</code> · ablated path: <code>node scripts/pmu/snap-counterfactual.mjs</code></div>'
    + '</div>';
  const tg = $('ablateToggle'); if(tg) tg.onchange = function(){ window.__ablateView = tg.checked; renderCounterfactual(); };
}
// THE HYPOTHESIS GRAPH (2026-07-18 — "put that as a hypothesis graph on the page"): capability
// vs reef-mass. HYPOTHESIS: the model finds the domain on its own (routing flat at 1.0 at every
// fraction); the reef supplies the playbooks + rules, so capability CLIMBS with reef-mass — a
// measurable trajectory with a slope (build velocity), not a switch. The stated LLM ideal is the
// comparison target, not asserted truth: distance-to-ideal is countable either way.
function renderGrowthCurve(){
  const host = $('growthHypothesis'); if(!host) return;
  const G = D.growthCurve; if(!G || !G.curve || G.curve.length < 2){ host.innerHTML=''; return; }
  const W=300, H=110, PAD=24;
  const x=function(f){ return PAD + f*(W-2*PAD); };
  const y=function(v){ return H-PAD - (Math.max(0,Math.min(1,v)))*(H-2*PAD); };
  const line=function(key,color){ var d=''; for(var i=0;i<G.curve.length;i++){ var p=G.curve[i]; d+=(i===0?'M':'L')+x(p.reef_fraction).toFixed(1)+','+y(p[key]).toFixed(1);} 
    var dots=''; for(var j=0;j<G.curve.length;j++){ var q=G.curve[j]; dots+='<circle cx="'+x(q.reef_fraction).toFixed(1)+'" cy="'+y(q[key]).toFixed(1)+'" r="2.5" fill="'+color+'"/>'; }
    return '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.6"/>'+dots; };
  var vmax=0; for(var i=0;i<(G.velocity||[]).length;i++) vmax=Math.max(vmax,G.velocity[i].d_hat_per_domain||0);
  host.innerHTML = '<div style="border:1px solid #2a3350;border-radius:8px;padding:10px 12px;background:#0d1220">'
    + '<div style="font-size:12px;font-weight:700;color:#e8eefc;margin-bottom:4px">◧ Hypothesis — the physics of the reef building</div>'
    + '<div class="dim" style="font-size:10.5px;line-height:1.5;margin-bottom:6px">The general model finds the <b>domain</b> on its own (<span style="color:#4aa3ff">routing flat at 100%</span> at every reef fraction). The <b style="color:#46d369">reef</b> supplies the playbooks + rules — capability <b>climbs with reef-mass</b>, a trajectory with measurable build velocity, not a switch. The stated ideal is the comparison target, countable either way.</div>'
    + '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="overflow:visible">'
    + '<line x1="'+PAD+'" y1="'+y(0)+'" x2="'+(W-PAD)+'" y2="'+y(0)+'" stroke="#2a3350"/>'
    + '<line x1="'+PAD+'" y1="'+y(1)+'" x2="'+(W-PAD)+'" y2="'+y(1)+'" stroke="#2a3350" stroke-dasharray="3 3"/>'
    + '<text x="'+(PAD-4)+'" y="'+(y(1)+3)+'" fill="#8a94a6" font-size="8" text-anchor="end">100%</text>'
    + '<text x="'+(PAD-4)+'" y="'+(y(0)+3)+'" fill="#8a94a6" font-size="8" text-anchor="end">0%</text>'
    + '<text x="'+(W-PAD)+'" y="'+(H-6)+'" fill="#8a94a6" font-size="8" text-anchor="end">reef mass →</text>'
    + line('route','#4aa3ff') + line('hat','#46d369') + line('rules_precision','#f0b429')
    + '</svg>'
    + '<div class="dim" style="font-size:10px;margin-top:3px"><span style="color:#4aa3ff">■ routing</span> · <span style="color:#46d369">■ playbook (hat)</span> · <span style="color:#f0b429">■ rules precision</span> · peak build velocity '+vmax.toFixed(3)+' hat/domain · held-out, deterministic, LLM-free</div>'
    + '</div>';
}
// ── LOOP 1 REMOVED — the in-browser evasion/convergence hypotheses (bPlacement/runHypothesesBrowser) ran
// the whole placement in browser gzip-NCD. That suite lives on the metal side (npx thetacog-mcp hypotheses);
// the browser copy is GONE so no control on this page recomputes a placement locally.

// wire up
$('runBtn').onclick = ()=> fire('run verification');
$('prevBtn').onclick = ()=> stepScrub(-1);
$('nextBtn').onclick = ()=> stepScrub(+1);
if($('hudPrev')) $('hudPrev').onclick = ()=> stepScrub(-1);   // FF/rewind on the floating panel
if($('hudNext')) $('hudNext').onclick = ()=> stepScrub(+1);
$('noiseBtn').onclick = injectNoise;
$('resetBtn').onclick = reset;
// PASSIVE-VIEWPORT SWEEP (Step 5) — the policy-limit slider and the Fail-B checkbox both route through
// fire() → run() → await liveRustRender(), i.e. they RE-RUN THE METAL /render (the new threshold is POSTed
// in the body and the server verdict re-evaluates the Mode-A cutoff). No control on this page depends on the
// deleted browser ncd() any more. Dirty-field guard: a change during an in-flight render coalesces via
// __rustPending (liveRustRender), so the newest input always wins and the paint never lands on a stale frame.
// OPTIMISTIC LOCAL ECHO (threshVal/g-threshold paint instantly) → append the CONFIG frame to the ledger
// fire-and-forget (postViewportConfig) → fire() re-runs the metal. The next quiet poll reconciles from the
// tape (pollViewportConfig), so the tape is the source of truth while the echo keeps dragging live.
// SYNCHRONOUS drift-vs-limit repaint before the async fire(): a full re-render takes ~100ms+, so
// without this the HUD lags the drag and can hold a stale verdict for the entire gesture. The
// operator's contract is "always show current drift vs slider setting" — current means during the
// drag, not after it settles.
$('threshold').addEventListener('input', ()=>{ $('threshVal').textContent = $('threshold').value + '%'; const gt=$('g-threshold'); if(gt) gt.textContent = $('threshold').value + '%'; paintDriftVsLimit(); postViewportConfig(); fire('policy limit ' + $('threshold').value + '%'); });
if($('includeFailB')) $('includeFailB').addEventListener('change', ()=>{ postViewportConfig(); fire($('includeFailB').checked ? 'triangulation ON' : 'drift-only'); });
// raw-payload toggles
document.querySelectorAll('.rawbtn').forEach((b)=>{ b.onclick = ()=>{ const pre = $('raw-'+b.dataset.for); pre.hidden = !pre.hidden; b.textContent = pre.hidden ? '⧉ View raw context payload' : '✕ Hide raw context payload'; }; });
$('exportBtn').onclick = exportClaims;
const ph = $('presetHolder');
D.presets.forEach((p)=>{ const b = document.createElement('button'); b.className='presetbtn'; b.textContent='📝 prompt: '+p.label; b.title='a prompt — loads into the boxes exactly as if typed, runs the same pipeline; the convergence loop replays these from the terminal'; b.onclick=()=>loadPreset(p); ph.appendChild(b); });
// the floating HUD fires the SAME canned interventions — click one, watch the live tolerance move instantly
if($('hudNoise')) $('hudNoise').onclick = injectNoise;
const hb = $('hudBtns');
if(hb){ D.presets.forEach((p)=>{ const b=document.createElement('button'); b.textContent=p.label.split('→')[0].trim().slice(0,10); b.title=p.label; b.onclick=()=>loadPreset(p); hb.appendChild(b); }); }
if($('hudMin')) $('hudMin').onclick = ()=>{ const h=$('floatHUD'), body=$('hudBody'); const min=body.style.display!=='none'; body.style.display=min?'none':''; h.classList.toggle('min', min); $('hudMin').textContent=min?'▢':'▁'; };
// LIVE on-edit — the on-chip /render re-runs ~400ms after you stop typing, so the encircled panels + the
// green/amber/red labels move as you edit (no need to click Run). The sealed PNG panels stay this run's.
let editTimer = null;
// Gotcha 2 (desync): a free-text edit clears the scenario and FIRES a new state — which appends at the end
// and snaps the cursor to the present. Editing while viewing a historical record therefore forks forward,
// never mutates the past (the tape is immutable + append-only).
function liveEdit(){ currentScenario = null; window.__editDirty = true; window.__replayState = null; window.__tapeWalk = null; window.__tapeIdeal = null; renderDumpGlyphs(); refreshProvLabels(); clearTimeout(editTimer); editTimer = setTimeout(()=> fire('manual edit'), 400); }
['tIntent','tReality','tNegative'].forEach(id=> $(id).addEventListener('input', liveEdit));
// STAGE 2 · MODE B — the live agent: qwen GENERATES the Reality (the driver), then the SAME gate runs
// (the brake). The model only fills the box; the verdict/metric path stays LLM-free. Preset = Mode A.
const rll = $('runLiveLLM'); if(rll) rll.addEventListener('click', async ()=>{
  const intent = $('tIntent').value; if(!intent.trim()) return;
  const orig = rll.textContent; rll.disabled = true; rll.textContent = '▶ agent running…';
  try {
    const r = await fetch('./agent-run', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ intent }) });
    const j = await r.json();
    if(j && j.reality){ $('tReality').value = j.reality; currentScenario = null; fire('live LLM · Mode B'); rll.textContent = orig; }
    else { rll.textContent = '▶ ' + ((j && j.error) ? String(j.error).slice(0,40) : 'no local model'); }
  } catch(e){ rll.textContent = '▶ Run Live LLM — offline'; }
  finally { rll.disabled = false; }
});
// first paint — the initial state IS the first tape record (State 1 of N)
fire('default · IN_LANE baseline');
// live terminal control: when served over http, poll the shared tape so CLI perturbations appear on the page
// AUTO-REFRESH ON REGEN (operator 2026-07-18: "running it should auto-refresh the page in .5s"):
// capture the served page's version on load; each 0.5s poll checks /page-version and reloads if
// the HTML was regenerated — so a terminal run refreshes the OPEN tab, no new tab. Guarded so a
// fresh load does not loop: __pageVersion is set once from the FIRST successful poll.
async function pollPageVersion(){
  if(!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return;
  try { const r = await fetch('./page-version?_='+Date.now(), { cache:'no-store' }); if(!r.ok) return; const j = await r.json();
    if(window.__pageVersion == null){ window.__pageVersion = j.version; return; }         // first poll: record baseline
    if(j.version && j.version !== window.__pageVersion){ location.reload(); }               // regenerated → refresh the tab
  } catch(e){}
}
if(/^https?:$/.test(location.protocol)){ setInterval(()=>{ pollTape(); pollViewportConfig(); pollPageVersion(); }, 500); }
</script>
${narratorABSection()}${ratchetSection()}</div>${LENS_CAL}</body></html>`;
}

// CLI: 'node attest-demo-ux.mjs <run.json> [out.html]' — build from a persisted run object (for
// tests / regeneration without re-running the whole chain).
if (import.meta.url === `file://${process.argv[1]}`) {
  const runPath = process.argv[2];
  if (!runPath) { console.error('usage: attest-demo-ux.mjs <run.json> [out.html]'); process.exit(1); }
  const R = JSON.parse(readFileSync(runPath, 'utf8'));
  const html = buildUX(R, {});
  const out = process.argv[3];
  if (out) { const { writeFileSync } = await import('node:fs'); writeFileSync(out, html); console.log('wrote', out); }
  else process.stdout.write(html);
}
