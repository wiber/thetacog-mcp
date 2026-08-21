// scripts/pmu/tape-walk-worker.mjs — THE PHYSICS ENGINE side of the write-lock (Phase 1,
// 100% Cryptographic Attribution). The ONLY component permitted to fill a receipt.
//
// Drains PENDING_WALK ledger entries from the flight tape. EVERY ingest goes through the engine
// (operator 2026-07-15: no JS shortcut may PREEMPT the physics — "if it's a pebble, let the engine
// measure the pebble"): the deterministic gzip-NCD placement (attest-hypotheses.mjs — LLM-free,
// air-gapped, same math as the served page) ALWAYS runs, and its measured read is ALWAYS recorded
// on the tape. THEN the measured mass classifies the read:
//   · gzip_bytes ≥ MIN_GZIP_BYTES → filled:true — the receipt the gate accepts
//   · gzip_bytes <  MIN_GZIP_BYTES → INSUFFICIENT_MASS, sparse:true, filled:false — the physical
//     numbers stay on the tape (io_context.measured_verdict) but are flagged untrustworthy.
//     MEASURED WHY (2026-07-15): a 232-char pebble walks to a CONFIDENT-looking OFF_DOMAIN mode B
//     (dI 0.279) — below the mass floor the engine doesn't fail loudly, it fabricates plausible
//     physics. The flag is a classification of a recorded measurement, never a fabricated error.
//
// APPEND-ONLY: the pending intent event is never mutated; the receipt is a CHILD event
// (parent_id = the intent event's id), so the served page's poll merges both permutations and the
// scrubber shows the pending→filled transition as two states. The receipt is LLM-FREE (hard rule).
//
// Usage:
//   node scripts/pmu/tape-walk-worker.mjs                 # one-shot drain
//   node scripts/pmu/tape-walk-worker.mjs --watch         # poll the tape every 500 ms (file-watcher stand-in)
//   node scripts/pmu/tape-walk-worker.mjs --tape <path>   # custom tape

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placement } from './attest-hypotheses.mjs';
import { loadTape, saveTape, massOf, findReceipt, MIN_GZIP_BYTES, defaultTapePath } from './tape-intent.mjs';

// THE ONE WALK (operator 2026-07-15: "one single rust pipeline used from everywhere — even the
// lens"): the SAME unified-drift walkShape the lens and the commit gate run — pmu-onchip
// --ballistic under the hood, honest 'gzip-fallback' sensor when the binary is absent, NEVER a
// silent metal claim and NEVER a second bespoke spawn of the daemon from this file.
const HERE = dirname(fileURLToPath(import.meta.url));
let _oneWalk = null;
const oneWalk = async () => (_oneWalk ??= await import(resolve(HERE, '../../src/lib/pmu/unified-drift.mjs')));

// the on-chip provenance leg of a receipt: walk intent AND reality through THE ONE WALK, then
// shapeCoverage (the commit gate's intent-vs-reality σ, unchanged math). Additive — the NCD
// triangulation verdict and the mass gate are untouched; this records WHERE on the lattice the
// submission physically landed, with the same sensor labels the lens receipt carries.
async function walkProvenance(inputs) {
  try {
    const { walkShape, CHAT_WALK_OPTS, shapeCoverage } = await oneWalk();
    const wI = await walkShape(inputs.intent, { opts: CHAT_WALK_OPTS });
    const wR = await walkShape(inputs.reality, { opts: CHAT_WALK_OPTS });
    return {
      sensor: wR.sensor, coverage_pct: shapeCoverage(wI.shape, wR.shape),
      sigma_intent: wI.sigma, sigma_reality: wR.sigma,
      plies: wR.plies, fillPct: wR.fillPct, walksPerSec: wR.walksPerSec, saturated: !!wR.saturated,
      cells_intent: wI.cells, cells_reality: wR.cells,
    };
  } catch (e) {
    return { sensor: 'unavailable', fallback_reason: String((e && e.message) || e) };
  }
}

export async function drainTape(tape = defaultTapePath()) {
  const doc = loadTape(tape);
  const pending = doc.timeline_events.filter((e) => e.physics_status === 'PENDING_WALK' && !findReceipt(doc, e.cursor_id));
  const receipts = [];
  for (const ev of pending) {
    const t0 = Date.now();
    const gzip_bytes = massOf(ev.inputs);
    const walk = await walkProvenance(ev.inputs);
    const base = {
      id: 'R-' + ev.cursor_id.slice(0, 8), parent_id: ev.id, ts: new Date().toISOString(),
      scenarioKey: ev.scenarioKey ?? null, scenario_tag: ev.scenario_tag, cursor_id: ev.cursor_id, lineage_id: ev.lineage_id,
      inputs: ev.inputs, physics_status: 'FILLED', source: 'tape-walk-worker',
    };
    // THE WALK ALWAYS RUNS — the engine measures every submission, pebble or not.
    const m = placement(ev.inputs.intent, ev.inputs.reality, ev.inputs.negative);
    // classification AFTER measurement: below the mass floor the measured read is recorded but untrusted.
    const sparse = gzip_bytes < MIN_GZIP_BYTES;
    const receipt = {
      ...base, elapsed_ms: Date.now() - t0,
      label: sparse ? '🧾 receipt · INSUFFICIENT_MASS (' + gzip_bytes + 'B < ' + MIN_GZIP_BYTES + 'B · measured ' + m.verdict + ')' : '🧾 receipt · ' + m.verdict,
      metrics: { verdict: sparse ? 'INSUFFICIENT_MASS' : m.verdict, mode: sparse ? 'sparse' : m.mode, drift: m.driftPct, dI: m.dI, dN: m.dN, offPct: m.offPct },
      // walk lives in io_context, not metrics: walk timings (walksPerSec) vary run-to-run while
      // metrics stays the deterministic pure-function-of-the-submission the guard pins.
      io_context: { filled: !sparse, sparse, gzip_bytes, min_gzip_bytes: MIN_GZIP_BYTES, measured_verdict: m.verdict, encircled: m.encircled, walk },
    };
    doc.timeline_events.push(receipt);
    receipts.push(receipt);
  }
  if (receipts.length) saveTape(tape, doc);
  return receipts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const tape = flag('--tape') || defaultTapePath();
  const tick = async () => { const r = await drainTape(tape); if (r.length) console.log(r.map((x) => `${x.id} ${x.metrics.verdict} · walk ${x.io_context.walk?.sensor || '-'}${x.io_context.filled ? '' : ' (unfilled)'}`).join('\n')); return r; };
  if (argv.includes('--watch')) { console.log('⚙ tape-walk-worker watching ' + tape); setInterval(tick, Number(flag('--interval') || 500)); }
  else { tick().then((r) => console.log(JSON.stringify({ drained: r.length, tape }, null, 2))); }
}
