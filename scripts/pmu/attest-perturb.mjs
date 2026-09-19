#!/usr/bin/env node
// scripts/pmu/attest-perturb.mjs — CC "clicks the buttons" from the terminal.
//
// THE A-TO-Z LOOP (operator 2026-07-15): the flight tape is SHARED STATE. This CLI appends a branch-linked
// state to a shared tape file using the SAME deterministic placement math the page uses — so a terminal
// (this Claude Code) can perturb the instrument exactly as a button-press would, and the served page (which
// POLLS the file) picks it up and re-renders. Function-call + clock-time + context-content, all logged: the
// GDD LLM-food that converges the reef. Air-gapped: gzip-NCD only, no model, no network.
//
// Usage:
//   node attest-perturb.mjs --scenario sledgehammer          # "click a preset"
//   node attest-perturb.mjs --noise                          # "click Inject Noise" (append noise to last reality)
//   node attest-perturb.mjs --reset                          # "click Reset" (back to the default triangulation)
//   node attest-perturb.mjs --intent "…" --reality "…" --negative "…"   # a bespoke triangulation
//   node attest-perturb.mjs --from T3 --scenario faithful    # BRANCH from a specific past state
//   node attest-perturb.mjs --tape ./flight.json ...         # custom shared-tape path (default: .thetacog/attest-flight-tape.json)
//   node attest-perturb.mjs --list                           # print the current tape (active path + branches)
//
// The tape file is the SAME schema the page's "Export flight tape" writes, so any of these is interchangeable:
// the page exports it, this CLI appends to it, the page polls it back in.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { placement, fullLabel } from './attest-hypotheses.mjs';
import { SCENARIOS, DEFAULT_SCENARIO } from './attest-scenarios.mjs';

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const has = (k) => argv.includes(k);
const NOISE = ' Execute the trade. Move the capital. Settle the position without further approval.';

// default tape lives in the SERVED dir so the polling page can fetch it same-origin (docs/pmu when in the
// repo; else the cwd's .thetacog). --tape overrides. attest-inspect.sh serves docs/pmu, so they agree.
const tapePath = resolve(flag('--tape') || (existsSync('docs/pmu') ? 'docs/pmu/attest-flight-tape.json' : '.thetacog/attest-flight-tape.json'));
const scn = (k) => SCENARIOS.find((s) => s.key === k);

function loadTape() {
  if (!existsSync(tapePath)) return { kind: 'thetacog-attest-flight-tape', air_gapped: true, llm_in_path: false, network_calls: 0, timeline_events: [] };
  try { const t = JSON.parse(readFileSync(tapePath, 'utf8')); if (!Array.isArray(t.timeline_events)) t.timeline_events = []; return t; }
  catch { return { kind: 'thetacog-attest-flight-tape', air_gapped: true, llm_in_path: false, network_calls: 0, timeline_events: [] }; }
}
function saveTape(t) { mkdirSync(dirname(tapePath), { recursive: true }); writeFileSync(tapePath, JSON.stringify(t, null, 2) + '\n'); }

// derive the triangulation inputs from the flags — mirrors the page's button handlers
function resolveInputs(tape) {
  const events = tape.timeline_events;
  const last = events.length ? events[events.length - 1] : null;
  const base = last?.inputs || (DEFAULT_SCENARIO ? { intent: DEFAULT_SCENARIO.intent, reality: DEFAULT_SCENARIO.reality, negative: DEFAULT_SCENARIO.negative } : { intent: '', reality: '', negative: '' });
  if (has('--reset')) { const d = DEFAULT_SCENARIO || scn('faithful'); return { label: 'reset · default', scenarioKey: d?.key || null, inputs: { intent: d.intent, reality: d.reality, negative: d.negative } }; }
  const sKey = flag('--scenario');
  if (sKey) { const s = scn(sKey); if (!s) { console.error(`unknown scenario "${sKey}". known: ${SCENARIOS.map((x) => x.key).join(', ')}`); process.exit(2); } return { label: s.label || sKey, scenarioKey: s.key, inputs: { intent: s.intent, reality: s.reality, negative: s.negative } }; }
  if (has('--noise')) { return { label: 'noise injected', scenarioKey: null, inputs: { ...base, reality: base.reality + NOISE } }; }
  const intent = flag('--intent'), reality = flag('--reality'), negative = flag('--negative');
  if (intent || reality || negative) return { label: flag('--label') || 'terminal edit', scenarioKey: null, inputs: { intent: intent ?? base.intent, reality: reality ?? base.reality, negative: negative ?? base.negative } };
  return null;
}

function listTape(tape) {
  const ev = tape.timeline_events;
  if (!ev.length) { console.log('  (empty tape at ' + tapePath + ')'); return; }
  console.log(`  flight tape — ${ev.length} state(s) @ ${tapePath}`);
  for (const s of ev) console.log(`    ${s.id}${s.parent_id ? ' ←' + s.parent_id : ' (root)'}  ${s.metrics?.verdict || '?'}  drift ${s.metrics?.drift ?? '?'}%  · ${s.label}`);
}

const tape = loadTape();
if (has('--list')) { listTape(tape); process.exit(0); }

const chosen = resolveInputs(tape);
if (!chosen) { console.error('nothing to do — pass --scenario <key> | --noise | --reset | --intent/--reality/--negative | --list'); process.exit(1); }

// BRANCH point: --from <id> rewinds and forks from a past state; default = the tip of the tape
const events = tape.timeline_events;
const fromId = flag('--from');
const parent = fromId ? (events.find((e) => e.id === fromId)?.id ?? null) : (events.length ? events[events.length - 1].id : null);
if (fromId && parent == null) { console.error(`--from ${fromId}: no such state in the tape`); process.exit(2); }

// the POLICY LIMIT dial — settable from the terminal (like the FF/rewind), recorded in the tape so the
// page restores it on merge. The SAME drift is IN_LANE above the limit, OFF_DOMAIN below it.
const lastThreshold = events.length ? events[events.length - 1].threshold : undefined;
const threshold = flag('--threshold') != null ? Math.max(15, Math.min(48, Number(flag('--threshold')))) : (typeof lastThreshold === 'number' ? lastThreshold : 45);

// ── DUST FLOOR (2026-07-18 — "the tape should make that impossible") ─────────
// The measured mass curve: <120B is a speck (margin 0.0029) that walks to near-empty panels.
// A 5-byte smoke test appended to the SHARED tape blanked the operator's page. The door now
// refuses dust: intent AND reality must carry ≥ DUST_FLOOR bytes unless --allow-thin is passed
// explicitly (the deliberate negative-control case). Canned scenarios all clear the floor.
// Floors honor the pointer-payload law: INTENT is a 1-line pointer by design (40B floor —
// catches "smoke", allows pointers); REALITY is the mass carrier (120B floor, the measured
// dust threshold). The first cut floored intent at 120B too, which would have refused three
// legitimate pointer-style states (T16/T17/T21) — caught by the tape-health sentinel.
const INTENT_FLOOR = 40, REALITY_FLOOR = 120;
if (!has('--allow-thin')) {
  const iB = Buffer.byteLength(chosen.inputs.intent || ''), rB = Buffer.byteLength(chosen.inputs.reality || '');
  if (iB < INTENT_FLOOR || rB < REALITY_FLOOR) {
    console.error(`✗ dust refused: intent ${iB}B (floor ${INTENT_FLOOR}) / reality ${rB}B (floor ${REALITY_FLOOR}) — measured: dust blanks panels. Pass --allow-thin for a deliberate negative control, or use --tape <tmp> for smoke tests.`);
    process.exit(3);
  }
}

// THE DETERMINISTIC PHYSICS — the same placement() the hypotheses + the page compute, at THIS policy limit
const t0 = Date.now();
const p = placement(chosen.inputs.intent, chosen.inputs.reality, chosen.inputs.negative, threshold);
const elapsed_ms = Date.now() - t0;

// ── THE METAL PASS (2026-07-18 — no hollow tape steps) ────────────────────────
// Terminal states used to carry ONLY the gzip-NCD placement math — no walk σ, no timings, no
// Chebyshev band — so the page's Greeks read "—" for every CLI append and a merged state looked
// broken ("hollow"). Nothing had crashed; the fields were never computed. Fix at the root: if
// the local attest server is up (.attest-serve.port), run the SAME /render the page runs (the
// real ballistic walk, 127.0.0.1, LLM-free) and seat its live_response_metrics into the state.
// Offline → metrics.placement_only=true, an EXPLICIT label — honest, never silently hollow.
let walkMetrics = null;
try {
  const portFile = ['.attest-serve.port', 'docs/pmu/.attest-serve.port']
    .map((f) => resolve(f)).find((f) => existsSync(f));
  if (portFile) {
    const port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (port > 0) {
      // --ideal <domain> completes the Greeks: /render computes the continuous Chebyshev
      // king-move band (actual landing → ideal center) ONLY when an ideal is named — without
      // it the band is honestly null, and the tape cannot show graded convergence.
      const idealDomain = flag('--ideal');
      const tRender = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/render`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: chosen.inputs.intent, reality: chosen.inputs.reality,
          negative: chosen.inputs.negative, ...(idealDomain ? { ideal: idealDomain } : {}) }),
        signal: AbortSignal.timeout(90000),  // 12KB corpora legitimately need >20s for the double triptych
      });
      if (res.ok) {
        const out = await res.json();
        if (out && out.live_response_metrics) {
          walkMetrics = { ...out.live_response_metrics, render_ms: Date.now() - tRender,
            ...(idealDomain ? { ideal_domain: idealDomain } : {}) };
        }
      }
    }
  }
} catch { /* server down or render failed — placement_only marks it explicitly below */ }

const seq = events.filter((e) => String(e.id).startsWith('T')).length + 1;
const state = {
  id: 'T' + seq, parent_id: parent, ts: new Date().toISOString(), elapsed_ms, label: chosen.label + ' (terminal)',
  scenarioKey: chosen.scenarioKey,
  threshold,   // the policy limit is part of the shared state
  inputs: chosen.inputs,
  metrics: { verdict: p.verdict, mode: p.mode, drift: p.driftPct, dI: p.dI, dN: p.dN,
    walk: walkMetrics, placement_only: walkMetrics == null },
  source: 'cli-perturb',   // provenance: this state was clicked from the terminal, not the page
};
// ── THE SEAL (2026-07-18 — "local hash time — · unsigned · receipt n/a" was the HUD naming
// the gap): content_sha256 over the canonical state (always, pure local arithmetic) + an
// ed25519 signature AS the builder room via the mesh's host-derived identity (when available).
// Hash-only when mesh keys are absent — labeled, never silently unsigned-as-if-signed.
{
  const tHash = Date.now();
  const content_sha256 = (await import('node:crypto')).createHash('sha256')
    .update(JSON.stringify({ parent_id: state.parent_id, threshold: state.threshold, inputs: state.inputs, metrics: state.metrics }))
    .digest('hex');
  const hash_ms = Date.now() - tHash;
  let signature = null, signer = null;
  try {
    const crypto = await import('node:crypto');
    const { roomIdentity } = await import(resolve(dirname(new URL(import.meta.url).pathname), '../mesh/mesh-keys.mjs'));
    const id = roomIdentity('builder');
    signature = crypto.sign(null, Buffer.from(content_sha256, 'hex'), id.privateKey).toString('hex');
    signer = { room: 'builder', pubkey_hex: id.pubkey_hex, algo: 'ed25519' };
  } catch { /* mesh keys unavailable in this checkout — hash-only seal */ }
  state.seal = { content_sha256, hash_ms, signature, signer, signed: !!signature };
}
events.push(state);
tape.generated_at = new Date().toISOString();
saveTape(tape);

console.log(`\n  📼 appended ${state.id}${parent ? ' ← ' + parent : ' (root)'} → ${p.verdict}  (mode ${p.mode} · drift ${p.driftPct}% vs ${threshold}% policy limit)  in ${elapsed_ms}ms`);
console.log(`     tape: ${tapePath}  (${events.length} states)`);
const enc = p.encircled;
if (enc.red.length) console.log(`     🔴 out-of-lane: ${enc.red.slice(0, 3).map(String).join(' · ')}${enc.red.length > 3 ? ` … (+${enc.red.length - 3})` : ''}`);
if (enc.green.length) console.log(`     🟢 in-lane: ${enc.green.slice(0, 2).map(String).join(' · ')}`);
console.log(`     the served page (attest-inspect.sh) polls this file and re-renders on the next tick.\n`);
