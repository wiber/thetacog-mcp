#!/usr/bin/env node
// scripts/pmu/lens-e0.mjs — E0: THE INVERSION, measured (spec §2.5 · goal S1).
// Registered as `npx thetacog-mcp e0` (server.js command registry) — the harness-law door.
//
// Heat-first placement (competence determines location): the REAL metal walk on each trap
// prompt (walkShape — never analytic), walk-heat argmax coord → nearest reef domain by
// ShortLex block distance; the keyword router demoted to tie-break. Compared against
// keyword-first routing on the SAME frozen trap set with the SAME evaluator. ZERO LLM.
//
// Results land three places (one schema): (1) an `e0` field appended as a row to
// data/pmu/lens-convergence-history.ndjson (the page's G8 reads the last row), (2) a SEALED
// state on the flight tape (source 'e0-sweep' — the polling instrument shows it), (3) stdout.
//
// Run: node scripts/pmu/lens-e0.mjs   ·   npx thetacog-mcp e0

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HISTORY = resolve(REPO, 'data/pmu/lens-convergence-history.ndjson');
const TAPE = resolve(REPO, 'docs/pmu/attest-flight-tape.json');

const { boundaryFromStubSpec, retrieveRules } = await import(resolve(HERE, 'prompt-lens.mjs'));
const { evalTraps, nearestDomainByCoord } = await import(resolve(HERE, 'lens-convergence-sweep.mjs'));
const { walkShape } = await import(resolve(REPO, 'src/lib/pmu/unified-drift.mjs'));
const { COORDS } = await import(resolve(HERE, 'definer-walk-144.mjs'));
const { sealState } = await import(resolve(HERE, 'metal-pass.mjs'));

const reefDoc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
const DOMAINS = reefDoc.domains || [];
const byName = new Map(DOMAINS.map((d) => [d.domain, d]));
const trapDoc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-trap-set.json'), 'utf8'));
const traps = trapDoc.traps || [];
console.log(`E0 · the inversion — heat-first vs keyword-first · trap-set v${trapDoc.version} (${traps.length} traps) · zero LLM`);

const t0 = Date.now();
// per unique prompt: keyword boundary (as today) + heat-first placement (the metal walk)
const keywordB = new Map(), heatDom = new Map();
let ccDegenerate = 0, fallbacks = 0;
for (const t of traps) {
  if (keywordB.has(t.prompt)) continue;
  const b = await boundaryFromStubSpec({ intent: t.prompt });
  keywordB.set(t.prompt, b);
  const w = await walkShape(t.prompt, { timeoutMs: 4000 });
  let coord = null;
  if (w && w.sensor === 'metal' && w.heat) {
    let best = -1, bi = -1;
    for (let i = 0; i < 144; i++) if (w.heat[i] > best) { best = w.heat[i]; bi = i; }
    coord = bi >= 0 ? COORDS[bi] : null;
  } else fallbacks++;
  if (coord === 'C,C') ccDegenerate++;                                  // FUNNEL RULE readout
  heatDom.set(t.prompt, nearestDomainByCoord(coord, DOMAINS, b.domain)); // keyword = tie-break/prior only
}
console.log(`  placements: ${keywordB.size} prompts · C,C funnel hits ${ccDegenerate} · non-metal fallbacks ${fallbacks} · ${Math.round((Date.now() - t0) / 1000)}s`);

const EMPTY_BOX = { r0: 0, r1: -1, c0: 0, c1: -1 };                     // perimeter off (fences unseeded)
const pickFor = (domName, prompt) => {
  const d = byName.get(domName);
  const boundary = { domain: domName, domainRules: d ? (d.rules || []) : [], template: d ? d.template : '', box: EMPTY_BOX, block: [0, 0], center: d ? d.coord : null };
  return { rules: retrieveRules(boundary, { intentText: prompt }).rules, routedDomain: domName };
};
const keyword = evalTraps((t) => pickFor(keywordB.get(t.prompt).domain || 'other', t.prompt), traps);
const heat = evalTraps((t) => pickFor(heatDom.get(t.prompt) || 'other', t.prompt), traps);
const kwRouted = keyword.misses.filter((m) => m.miss_reason === 'routed-away').length;
const htRouted = heat.misses.filter((m) => m.miss_reason === 'routed-away').length;

// THE DECISION BOUND (spec §2.5): heat wins → flip (keyword demoted to prior); funnel wins →
// the inversion WAITS on density (S2), re-run scheduled. Recorded, acted on — never dangling.
const heatWins = htRouted < kwRouted && heat.f1 >= keyword.f1 - 0.02;
const verdict = heatWins
  ? `HEAT-FIRST WINS — routed-away ${htRouted} vs ${kwRouted}, F1 ${heat.f1} vs ${keyword.f1}: flip the router (keyword → prior).`
  : `FUNNEL HOLDS — heat-first routed-away ${htRouted} vs keyword ${kwRouted} (F1 ${heat.f1} vs ${keyword.f1}, C,C hits ${ccDegenerate}): the inversion WAITS ON DENSITY (S2 derived statements), re-run E0 after.`;

const e0 = {
  ts: new Date().toISOString(), trap_set_version: trapDoc.version,
  keyword_routed_away: kwRouted, heat_routed_away: htRouted,
  keyword_f1: keyword.f1, heat_f1: heat.f1,
  keyword: { P: keyword.precision, R: keyword.recall, TP: keyword.TP, FN: keyword.FN, FP: keyword.FP },
  heat: { P: heat.precision, R: heat.recall, TP: heat.TP, FN: heat.FN, FP: heat.FP },
  cc_funnel_hits: ccDegenerate, non_metal_fallbacks: fallbacks,
  heat_wins: heatWins, verdict,
};

// (1) history row the page's G8 binds to (last row's .e0)
const lines = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf8').trim().split('\n').filter(Boolean) : [];
const last = lines.length ? JSON.parse(lines[lines.length - 1]) : {};
appendFileSync(HISTORY, JSON.stringify({ ...last, ts: e0.ts, e0 }) + '\n');

// (2) SEALED tape state — the harness law: results land on the tape the instrument polls
try {
  const tape = JSON.parse(readFileSync(TAPE, 'utf8'));
  // ANNOTATION STATES ARE NEVER T-STATES (2026-07-20 — "we decoupled the greeks from the ui
  // again"): a T-id becomes the scrubber/boot state and a walk-less state dashes every Greek.
  // E0 receipts are annotations: E0-prefixed, sealed, visible in the ledger, never the boot.
  const seq = tape.timeline_events.filter((e) => String(e.id).startsWith('E0-')).length + 1;
  const mesh = await import(resolve(REPO, 'scripts/mesh/mesh-keys.mjs')).catch(() => null);
  const state = {
    id: 'E0-' + seq, parent_id: tape.timeline_events.length ? tape.timeline_events[tape.timeline_events.length - 1].id : null,
    ts: e0.ts, elapsed_ms: Date.now() - t0, label: `E0 · the inversion — ${heatWins ? 'HEAT-FIRST WINS' : 'funnel holds, waits on density'}`,
    scenarioKey: null, threshold: null,
    inputs: { intent: 'E0: heat-first vs keyword routing on the frozen trap set (spec §2.5, goal S1)', reality: verdict, negative: '' },
    metrics: { verdict: heatWins ? 'IN_LANE' : 'OFF_DOMAIN', mode: 'e0', drift: null, e0, placement_only: true },
    source: 'e0-sweep',
  };
  state.seal = sealState(state, mesh);
  tape.timeline_events.push(state);
  tape.generated_at = e0.ts;
  { const { appendToTape } = await import(resolve(HERE, 'tape-append.mjs')); appendToTape((t2) => { t2.timeline_events = tape.timeline_events; return []; }); }   // the ONE DOOR (resurrected-segment incident)
  console.log(`  sealed tape state ${state.id} (${state.seal.signed ? 'ed25519' : 'sha256'})`);
} catch (e) { console.log(`  (tape append skipped: ${e.message})`); }

console.log(`\n${verdict}`);
console.log(`  → ${HISTORY} (.e0 on the last row) · G8 flips on next page build`);
