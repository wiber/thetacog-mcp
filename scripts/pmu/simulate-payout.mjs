#!/usr/bin/env node
// scripts/pmu/simulate-payout.mjs — THE BENCHMARK, made exact: simulate paying out on a
// GREEN PANEL + MISALIGNED ACTION. This is the prototype SETTLEMENT ENGINE — the same
// deterministic function that adjudicates a warranty claim is what settles a derivative
// written on the receipt series, years later, with nobody to subpoena.
//
//   npx thetacog-mcp simulate-payout
//
// What it runs, offline, zero network, zero model calls:
//   1. INDEX — places the corpus documents against the shipped spec with the two-witness
//      sensor (the rows a derivatives desk quotes against), then runs THE REAL GATE: the
//      walk-panel off-lane percentage against killTolerancePct=25 — the gate the hostile
//      audit measured (2026-08-13).
//   2. EVENT — the contradiction: a document whose WALK GATE reads GREEN while its ground
//      truth is off-lane. The corpus ships one BY DESIGN: fake_ops (~18% < kill@25) — the
//      instrument's DOCUMENTED calibration hole, used honestly. The event class survives
//      calibration: when the hole closes, this sim exits 3 and says so rather than fabricate.
//   3. SETTLEMENT — the work-order a real claim would compute: in-kind payout (GPU-hours +
//      accredited man-hours, SIMULATED CAPS, uncalibrated), investigation block included.
//
// DETERMINISM CONTRACT: the emitted files contain no timestamps and no randomness — run it
// twice, diff attest-out/simulated-settlement.json, get zero bytes. That empty diff is the
// property every layer above (warranty, pool, derivative) is priced on.
// FAIL-CLOSED: no walk daemon on this host, or the hole closed → exit 3 with the reason.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const j = (p) => JSON.parse(readFileSync(resolve(PKG, p), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

const { compress, placePixel } = await import(resolve(PKG, 'src/lib/pmu/compress.mjs'));
const corpus = j('data/pmu/attest-reference-corpus.json');
const axisLib = j('docs/architecture/axis-library-v1.json');
let pairLib = [];
try { pairLib = j('data/pmu/snippet-library-144.json'); if (!Array.isArray(pairLib)) pairLib = pairLib.anchors || pairLib.nodes || []; } catch { /* pixel optional */ }

const spec = Array.isArray(corpus.spec) ? corpus.spec.join(' ') : String(corpus.spec);
const specSha = sha(spec);
const doc = (p) => (Array.isArray(p.text) ? p.text.join(' ') : String(p.text));

// ── 1. INDEX — the two-witness placement rows ──────────────────────────────
const receipts = [];
for (const key of ['compliant', 'paraphrase', 'fake_ops', 'lorem']) {
  const probe = corpus.probes.find((p) => p.key === key);
  const text = doc(probe);
  const c = compress(text, axisLib);
  const px = pairLib.length ? placePixel(text, pairLib) : { pixel: null, sigma: 0, agreement: null };
  // gzip-NCD is the canonical sensor; on witness disagreement the composite cell is null BY
  // DESIGN (disagreement surfaced, never reconciled) — the index quotes the primary witness
  // and carries the disagreement bit, which is itself an alarm input.
  const gz = c.witnesses.gzipNCD;
  receipts.push({
    key, ground_truth: probe.family, doc_sha256: sha(text), spec_sha256: specSha,
    cell: gz.cell, sigma: Number((gz.sigma || 0).toFixed(6)), witness_agreement: c.agreement,
    pixel: px.pixel, pixel_sigma: Number((px.sigma || 0).toFixed(6)),
  });
}

// ── 2. THE REAL GATE — walk-panel off-lane % against kill@25 (what the audit measured) ──
try {
  const { buildTriptychInputs } = await import(resolve(PKG, 'scripts/pmu/triptych-build.mjs'));
  const { decodeDeltaThreeColourEdges } = await import(resolve(PKG, 'scripts/pmu/triptych-render.mjs'));
  for (const r of receipts) {
    if (r.key === 'paraphrase') continue; // index-only // index-only row; the event needs baseline + adversary
    const probe = corpus.probes.find((p) => p.key === r.key);
    const built = await buildTriptychInputs({ intentText: spec, realityText: doc(probe), repoRoot: PKG, killTolerancePct: 25 });
    const cole = built.renderArgs && built.renderArgs.cole;
    if (!cole || !cole.intent || !cole.reality) { r.walk_gate = 'UNMEASURED'; r.walk_off_pct = null; continue; }
    const tol = decodeDeltaThreeColourEdges(cole.intent.matrix || cole.intent, cole.reality.matrix || cole.reality, 25);
    r.walk_off_pct = tol.offPct;
    r.walk_counts = { green: tol.green, amber: tol.amber, red: tol.red };
    if (tol.refused) r.refusal = tol.refusal;
    r.walk_mode = (built.meta || {}).walkMode || null;
    r.walk_gate = (tol.refused || tol.offPct == null) ? 'UNMEASURED' : (tol.tooMany ? 'RED' : 'GREEN');
  }
} catch (e) {
  console.error('WALK GATE UNAVAILABLE on this host (' + String(e && e.message).split('\n')[0] + ')');
  console.error('FAIL-CLOSED: refusing to simulate a payout without the real gate. UNMEASURED is never a pass.');
  process.exit(3);
}

// ── 3. EVENT: green WALK gate + off-lane ground truth = the miss the warranty pays on ──
const baseline = receipts.find((r) => r.key === 'compliant');
const miss = receipts.find((r) => r.walk_gate === 'GREEN' && r.ground_truth === 'off_lane');
if (!miss) {
  console.error('NO CONTRADICTION REPRODUCED — the calibration hole this simulation rides has been closed.');
  console.error('That is the instrument improving; switch the sim to the post-receipt-drift event class (see header). Refusing to fabricate a miss.');
  process.exit(3);
}

const workOrder = {
  work_order: 'SIMULATED — not a claim',
  event_type: 'GREEN_PANEL_MISALIGNED_ACTION',
  trigger_evidence: {
    baseline_receipt: { key: baseline.key, doc_sha256: baseline.doc_sha256, cell: baseline.cell, walk_off_pct: baseline.walk_off_pct, walk_gate: baseline.walk_gate },
    contradicting_record: { key: miss.key, doc_sha256: miss.doc_sha256, cell: miss.cell, walk_off_pct: miss.walk_off_pct, walk_gate: miss.walk_gate, ground_truth: miss.ground_truth },
    spec_sha256: specSha,
    mechanism: 'walk gate read GREEN on content whose ground truth is off-lane — the documented kill-threshold calibration hole (hostile audit, 2026-08-13); the exact class the missed-alarm warranty exists for',
  },
  drifted_scope: { from_cell: baseline.cell, at_cell: miss.cell, pixel: miss.pixel },
  pool_draw: {
    gpu_hours: 40, accredited_man_hours: 16, tier: 'certified-fixer',
    label: 'SIMULATED CAPS — uncalibrated; real caps are a wording decision point (DP4) priced from the tape',
  },
  investigation: { consented: true, fields: ['silence_class', 'drifted_cells', 'what_should_have_flagged'], findings_return: 'the tape (instrument-improvement input)' },
  recompute: { command: 'npx thetacog-mcp simulate-payout', contract: 'zero timestamps, zero randomness in emitted files — two runs diff to zero bytes' },
};

// ── 4. THE BOOK: rack up the ledger — pints, GPU credits, accredited hours ─────────────
// One event is a claim; a BOOK is what a desk prices. If the repo tape is present (git
// clone; not the npm tarball), derive a deterministic simulated book from the production
// series: every recorded breach row becomes one settled event at the simulated caps. All
// labeled SIMULATED; the pint is the ledger's joke unit (1 pint per settled event) and is
// labeled as exactly that.
let book = { source: 'single-event (no tape on this install)', events: 1 };
try {
  const series = readFileSync(resolve(PKG, 'tape/series.ndjson'), 'utf8').split('\n').filter(Boolean);
  let breaches = 0;
  for (const ln of series) { try { const row = JSON.parse(ln); const off = row.offPct ?? row.off_lane_pct ?? row.off; if (off != null && Number(off) > 15) breaches++; } catch { /* skip */ } }
  if (series.length) book = { source: `repo tape (${series.length} rows)`, events: Math.max(1, breaches) };
} catch { /* npm install — single event book */ }
const ledger = {
  label: 'SIMULATED BOOK — every number below is caps x simulated events, uncalibrated',
  settled_events: book.events, source: book.source,
  pints: book.events,
  gpu_credit_hours: book.events * workOrder.pool_draw.gpu_hours,
  accredited_man_hours: book.events * workOrder.pool_draw.accredited_man_hours,
  derivatives_on_top: {
    note: 'the layer OTHERS write on this series — we license the oracle, we never issue',
    instruments: ['competence cat bond (pool attachment on settled-event rate)', 'options on the off-lane spread', 'SLA-linked notes'],
    quote_commands: ['npx thetacog-mcp premium', 'npx thetacog-mcp variance'],
  },
};

mkdirSync(resolve(process.cwd(), 'attest-out'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'attest-out/settlement-index.json'), JSON.stringify(receipts, null, 2));
writeFileSync(resolve(process.cwd(), 'attest-out/simulated-settlement.json'), JSON.stringify(workOrder, null, 2));
writeFileSync(resolve(process.cwd(), 'attest-out/simulated-book.json'), JSON.stringify(ledger, null, 2));

console.log('══════ SETTLEMENT ENGINE — SIMULATED PAYOUT (offline, deterministic, LLM-free) ══════');
console.log('\nINDEX + GATE (what a desk quotes against · the gate the audit measured):');
for (const r of receipts) console.log('  ' + r.key.padEnd(11) + ' walk_gate=' + String(r.walk_gate || 'index-only').padEnd(11) + ' off%=' + String(r.walk_off_pct ?? '—').padEnd(6) + ' cell=' + String(r.cell).padEnd(4) + ' σ=' + r.sigma + '  ground_truth=' + r.ground_truth);
console.log('\nEVENT: ' + workOrder.event_type);
console.log("  the WALK gate read GREEN on '" + miss.key + "' at " + miss.walk_off_pct + '% off-lane (kill@25) — ground truth: off-lane by construction.');
console.log('  The panel was green; the action was misaligned. Not staged: the documented calibration hole, used honestly.');
console.log('\nSETTLEMENT (the in-kind payout, as a real claim would compute it):');
console.log('  pool draw: ' + workOrder.pool_draw.gpu_hours + ' GPU-hours + ' + workOrder.pool_draw.accredited_man_hours + ' accredited man-hours (' + workOrder.pool_draw.label + ')');
console.log('  → attest-out/simulated-settlement.json · attest-out/settlement-index.json');
console.log('\nTHE BOOK (racked up, simulated): ' + ledger.settled_events + ' settled event(s) [' + ledger.source + '] → '
  + ledger.pints + ' pint(s) 🍺 · ' + ledger.gpu_credit_hours + ' GPU credit-hours · ' + ledger.accredited_man_hours + ' accredited man-hours');
console.log('DERIVATIVES ON TOP (others write these; we license the oracle): ' + ledger.derivatives_on_top.instruments.join(' · '));
console.log('  quote the series: ' + ledger.derivatives_on_top.quote_commands.join('  ·  '));
console.log('\nRun it twice and diff the files: zero bytes. That empty diff is what every layer above is priced on.');
