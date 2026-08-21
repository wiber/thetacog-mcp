// scripts/pmu/tape-intent.mjs — PHASE 1 of 100% CRYPTOGRAPHIC ATTRIBUTION: the WRITE-LOCK.
//
// THE GATE (operator 2026-07-15): an agent cannot finalize a task, write to a database, or declare
// success without a cursor_id that maps to a receipt with io_context.filled === true on the tape.
// This module is deliberately STRIPPED of execution logic — the writer is a dumb ledger entry; the
// physics engine (tape-walk-worker.mjs → placement(), gzip-NCD, LLM-free) is the ONLY thing that can
// fill a receipt. Unidirectional state flow: agent writes → engine measures → agent reads. Never
// agent measures.
//
// APPEND-ONLY DISCIPLINE (same contract as the flight-tape UI): the pending intent event is NEVER
// mutated. The worker appends a child RECEIPT event (parent_id = the intent event) carrying the
// measurement. "Editing the past forks forward" — and the served page's scrubber keeps working
// because every event carries a truthful metrics.verdict (PENDING_WALK is a status, not a
// fabricated measurement; the gate keys exclusively off the receipt's io_context.filled).
//
// THE THREE HARD LIMITS (decided 2026-07-15, encoded here — not prose):
//   1. PHANTOM MASS   — MIN_GZIP_BYTES = 220 on the gzipped combined triangulation, applied AFTER
//                       the walk, never instead of it (operator 2026-07-15: no JS shortcut may
//                       preempt the engine). The walk always runs and its read is recorded; below
//                       the floor it is classified INSUFFICIENT_MASS / sparse:true — MEASURED WHY:
//                       a 232-char pebble walks to a confident-looking OFF_DOMAIN (dI 0.279), so
//                       an under-mass read is plausible-but-untrustworthy physics, not absent physics.
//   2. DEATH SPIRAL   — MAX_RETRIES = 3 INSUFFICIENT_MASS strikes per lineage (sha256 of
//                       scenario_tag|intent_text). Strike 3 → terminal CATASTROPHIC_FAILURE, and the
//                       lineage is locked at the WRITE side too: writeTapeIntent refuses a 4th
//                       submission. The gate snaps at the protocol level, not in the LLM's context.
//   3. ASYNC GAP      — SYNCHRONOUS LAZY EVALUATION (operator pivot 2026-07-15): read_tape_receipt
//                       IS the physical trigger. On a PENDING cursor the reader synchronously fires
//                       the physics engine (drainTape — ~20 ms gzip-NCD, cheap to hold the
//                       connection for) and returns the receipt in the same call. No background
//                       daemon, no launchd, no race conditions, no token-burn re-call loop. The
//                       bounded poll (default 4 s, 250 ms) survives only as the lazy:false
//                       fallback (e.g. a separate standalone worker owns the tape).
//
// CLI:
//   node scripts/pmu/tape-intent.mjs write --intent "…" --reality "…" --negative "…" --tag golden-baseline
//   node scripts/pmu/tape-intent.mjs read --cursor <sha256> [--wait 4000]

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const MIN_GZIP_BYTES = 220;   // hard limit 1 — phantom-mass floor (gzip bytes of intent+reality+negative)
export const MAX_RETRIES = 3;        // hard limit 2 — INSUFFICIENT_MASS strikes per lineage before terminal lock

// the preset matrix — scenario_tag (the agent-facing categorical label) → attest-scenarios key.
// 'hallucination' completes the matrix (added with this write-lock; see attest-scenarios.mjs).
export const PRESET_TAGS = {
  'golden-baseline': 'faithful',
  'hallucination': 'hallucination',
  'semantic-drift': 'analysis-execution',
  'sledgehammer': 'sledgehammer',
  'abstain-tie': 'abstain-tie',
};

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const lineageId = (tag, intent) => sha256('lineage\u0000' + tag + '\u0000' + intent);
export const massOf = (inputs) => gzipSync(Buffer.from([inputs.intent, inputs.reality, inputs.negative || ''].join('\n'), 'utf8')).length;

// same default as attest-perturb.mjs: the SERVED tape when in the repo, else the local .thetacog one
export const defaultTapePath = () => resolve(existsSync('docs/pmu') ? 'docs/pmu/attest-flight-tape.json' : '.thetacog/attest-flight-tape.json');

export function loadTape(tapePath) {
  const empty = { kind: 'thetacog-attest-flight-tape', air_gapped: true, llm_in_path: false, network_calls: 0, timeline_events: [] };
  if (!existsSync(tapePath)) return empty;
  try { const t = JSON.parse(readFileSync(tapePath, 'utf8')); if (!Array.isArray(t.timeline_events)) t.timeline_events = []; return t; }
  catch { return empty; }
}
export function saveTape(tapePath, t) { mkdirSync(dirname(tapePath), { recursive: true }); writeFileSync(tapePath, JSON.stringify(t, null, 2) + '\n'); }

const receiptsFor = (doc, cursor_id) => doc.timeline_events.filter((e) => e.cursor_id === cursor_id && e.io_context);
export const findReceipt = (doc, cursor_id) => receiptsFor(doc, cursor_id)[0] || null;
export const countStrikes = (doc, lin) => doc.timeline_events.filter((e) => e.lineage_id === lin && e.io_context && e.io_context.sparse === true).length;

// ── THE WRITER — a dumb ledger entry; zero execution logic ────────────────────────────────────
export function writeTapeIntent({ intent_text, reality_text, negative_text = '', scenario_tag, tape = defaultTapePath(), now = new Date().toISOString() }) {
  for (const [k, v] of Object.entries({ intent_text, reality_text, scenario_tag })) {
    if (!v || typeof v !== 'string') return { cursor_id: null, status: 'REJECTED', instruction: `Missing required field ${k}. Submit intent_text, reality_text, scenario_tag (negative_text required for divergence presets).` };
  }
  const doc = loadTape(tape);
  const lineage_id = lineageId(scenario_tag, intent_text);
  const strikes = countStrikes(doc, lineage_id);
  if (strikes >= MAX_RETRIES) {
    // hard limit 2, write side: the lineage is dead this cycle — the protocol refuses the ledger entry.
    return { cursor_id: null, status: 'CATASTROPHIC_FAILURE', locked: true, lineage_id, strikes, instruction: `Lineage locked after ${MAX_RETRIES} INSUFFICIENT_MASS attempts. Do NOT resubmit a reworded variant; escalate to a human operator with the lineage_id.` };
  }
  const cursor_id = sha256(['tape-intent', now, scenario_tag, intent_text, reality_text, negative_text].join('\u0000'));
  const last = doc.timeline_events[doc.timeline_events.length - 1] || null;
  doc.timeline_events.push({
    id: 'W-' + cursor_id.slice(0, 8), parent_id: last ? last.id : null, ts: now, elapsed_ms: 0,
    label: '⛓ intent queued · ' + scenario_tag,
    scenarioKey: PRESET_TAGS[scenario_tag] ?? null, scenario_tag, cursor_id, lineage_id,
    inputs: { intent: intent_text, reality: reality_text, negative: negative_text },
    metrics: { verdict: 'PENDING_WALK', mode: 'pending' },   // status stub — NOT a measurement
    physics_status: 'PENDING_WALK', io_context: null, source: 'write_tape_intent',
  });
  saveTape(tape, doc);
  // the return is brutally minimal — no confirmation of verification, only the receipt pointer.
  return { cursor_id, status: 'QUEUED_FOR_PHYSICS_ENGINE', instruction: 'Verification pending. Poll read_tape_receipt with this cursor_id. Proceed ONLY if filled: true.' };
}

// ── THE READER — the binary gate ──────────────────────────────────────────────────────────────
export async function readTapeReceipt({ cursor_id, tape = defaultTapePath(), wait_ms = 4000, poll_ms = 250, lazy = true }) {
  if (!cursor_id) return { cursor_id: null, filled: false, status: 'REJECTED', instruction: 'cursor_id is required.' };
  const t0 = Date.now();
  for (;;) {
    let doc = loadTape(tape);
    let receipt = findReceipt(doc, cursor_id);
    if (!receipt && lazy && doc.timeline_events.some((e) => e.cursor_id === cursor_id && e.physics_status === 'PENDING_WALK')) {
      // SYNCHRONOUS LAZY EVALUATION — the read IS the choke point: fire the physics engine now,
      // hold the connection for the walk, return the receipt in this same call. The agent still
      // never measures: the fill happens in the engine module, keyed off the immutable ledger entry.
      const { drainTape } = await import('./tape-walk-worker.mjs');
      await drainTape(tape);
      doc = loadTape(tape);
      receipt = findReceipt(doc, cursor_id);
    }
    if (receipt) {
      if (receipt.io_context.sparse === true) {
        const strikes = countStrikes(doc, receipt.lineage_id);
        if (strikes >= MAX_RETRIES) return { cursor_id, filled: false, status: 'CATASTROPHIC_FAILURE', locked: true, lineage_id: receipt.lineage_id, strikes, instruction: 'Terminal. The lineage is locked; escalate to a human operator. Further write_tape_intent calls on this lineage will be refused.' };
        return { cursor_id, filled: false, status: 'INSUFFICIENT_MASS', strikes, retries_remaining: MAX_RETRIES - strikes, gzip_bytes: receipt.io_context.gzip_bytes, min_gzip_bytes: MIN_GZIP_BYTES, instruction: 'The submission lacks physical mass for a real walk. Resubmit via write_tape_intent with substantive intent/reality text — not a one-word reword.' };
      }
      return { cursor_id, filled: true, status: 'FILLED', verdict: receipt.metrics.verdict, metrics: receipt.metrics, receipt_id: receipt.id, receipt_ts: receipt.ts, elapsed_ms: receipt.elapsed_ms };
    }
    const intentEv = doc.timeline_events.find((e) => e.cursor_id === cursor_id && e.physics_status === 'PENDING_WALK');
    if (!intentEv) return { cursor_id, filled: false, status: 'UNKNOWN_CURSOR', instruction: 'No ledger entry with this cursor_id. Call write_tape_intent first.' };
    if (Date.now() - t0 >= wait_ms) return { cursor_id, filled: false, status: 'PENDING', instruction: 'The physics engine has not filled this cursor yet. Ensure tape-walk-worker is running, then poll read_tape_receipt again. Do NOT claim success.' };
    await new Promise((r) => setTimeout(r, poll_ms));   // hard limit 3 — bounded internal poll
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const tape = flag('--tape') || defaultTapePath();
  const cmd = argv[0];
  if (cmd === 'write') {
    console.log(JSON.stringify(writeTapeIntent({ intent_text: flag('--intent'), reality_text: flag('--reality'), negative_text: flag('--negative') || '', scenario_tag: flag('--tag'), tape }), null, 2));
  } else if (cmd === 'read') {
    readTapeReceipt({ cursor_id: flag('--cursor'), tape, wait_ms: Number(flag('--wait') || 4000) }).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.filled ? 0 : 1); });
  } else {
    console.error('usage: tape-intent.mjs write --intent "…" --reality "…" [--negative "…"] --tag <preset> | read --cursor <id> [--wait ms]  [--tape path]');
    process.exit(2);
  }
}
