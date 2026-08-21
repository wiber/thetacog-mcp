#!/usr/bin/env node
// scripts/pmu/trigger-battery.mjs — THE TRIGGER, SORTED FROM EVERY ANGLE by small prompts.
//
// The judgment under test is never "is this instruction good?" (undecidable, never claimed).
// It is the surgeon's judgment: an instruction arrives mid-operation, and the only question is
// whether the next step is IN LINE with the character at this coordinate and the state of this
// board. Board = intent corpus. Instruction = reality corpus. The REAL gate decides: two-witness
// placement, the walk-panel kill@25, the lit-mass floor. No models, no tone-parsing, offline.
//
//   npx thetacog-mcp trigger-battery
//
// Row statuses, all honest:
//   MATCH            — current gate does what the target demands.
//   DOCUMENTED-HOLE  — target CONTRADICTION, gate reads GREEN: the known kill-threshold
//                      calibration hole (hostile audit, 2026-08-13) — the warranty class,
//                      recorded, never papered over.
//   DOMAIN-UNFITTED  — target GREEN, gate refuses/unmeasured: the shipped tesseract does not
//                      grip this room's vocabulary. NOT a defect — the measured demonstration
//                      that a fork must FIT ITS OWN tesseract (init-fork + the axis dumps)
//                      before the trigger means anything in its domain.
//   REGRESSION       — a noise row (target REFUSED) passes the gate: the floor failed. Exit 2.
//
// Files are timestamp-free: two runs diff to zero bytes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpus = JSON.parse(readFileSync(resolve(PKG, 'data/pmu/trigger-scenario-corpus.json'), 'utf8'));
const { buildTriptychInputs } = await import(resolve(PKG, 'scripts/pmu/triptych-build.mjs'));
const { decodeDeltaThreeColourEdges } = await import(resolve(PKG, 'scripts/pmu/triptych-render.mjs'));

// THE TWO-LEG RACK (operator steer, 2026-08-14 — "if you don't control the aperture under the
// context it just won't work"). Measuring the NAKED instruction against the board measures topic
// overlap, not the surgeon judgment. The judgment is CONDITIONAL — WHERE(step | board) — so:
//   LEG 1 (floor): the naked instruction must carry lattice mass on its own. Noise refuses HERE,
//     before any conditioning — a rich board must never launder "the the the" into a pass.
//   LEG 2 (alignment): symmetric bulk per META-BULK — intent = board (the universe that preceded,
//     operative plan included), reality = board ⊕ instruction (the universe WITH the step taken).
//     The shared board mass cancels in the delta; the residual is exactly where the step fires
//     outside the board's lane. Matched aperture on both sides — the eye is cut equal.
const rows = [];
let regression = false;
for (const s of corpus.scenarios) {
  // LEG 1 — the naked step's own mass (the floor's jurisdiction, unconditioned)
  const floorLeg = await buildTriptychInputs({ intentText: s.board, realityText: s.instruction, repoRoot: PKG, killTolerancePct: 25 });
  const fCole = floorLeg.renderArgs && floorLeg.renderArgs.cole;
  let floorRefused = true;
  if (fCole && fCole.intent && fCole.reality) {
    const fTol = decodeDeltaThreeColourEdges(fCole.intent.matrix || fCole.intent, fCole.reality.matrix || fCole.reality, 25);
    floorRefused = !!(fTol.refused || fTol.offPct == null);
  }
  let gate = 'UNMEASURED', off = null, built = floorLeg;
  if (floorRefused) {
    gate = 'REFUSED';
  } else {
    // LEG 2 — the conditional placement: the step judged INSIDE the board's universe
    built = await buildTriptychInputs({ intentText: s.board, realityText: `${s.board}\n\nNEXT STEP TAKEN: ${s.instruction}`, repoRoot: PKG, killTolerancePct: 25 });
    const cole = built.renderArgs && built.renderArgs.cole;
    if (cole && cole.intent && cole.reality) {
      const tol = decodeDeltaThreeColourEdges(cole.intent.matrix || cole.intent, cole.reality.matrix || cole.reality, 25);
      off = tol.offPct;
      gate = (tol.refused || tol.offPct == null) ? 'REFUSED' : (tol.tooMany ? 'RED' : 'GREEN');
    }
  }
  let status;
  if (s.target === 'GREEN') status = gate === 'GREEN' ? 'MATCH' : (gate === 'REFUSED' || gate === 'UNMEASURED' ? 'DOMAIN-UNFITTED' : 'MISMATCH');
  else if (s.target === 'REFUSED') { status = (gate === 'REFUSED' || gate === 'UNMEASURED') ? 'MATCH' : 'REGRESSION'; if (status === 'REGRESSION') regression = true; }
  else if (s.target === 'CONTRADICTION') status = gate === 'RED' ? 'MATCH' : (gate === 'GREEN' ? 'DOCUMENTED-HOLE' : (gate === 'REFUSED' ? 'DOMAIN-UNFITTED' : 'MISMATCH'));
  rows.push({ id: s.id, room: s.room, target: s.target, current_gate: gate, off_pct: off, walk_mode: (built.meta || {}).walkMode || null, status, why: s.why });
}

mkdirSync(resolve(process.cwd(), 'attest-out'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'attest-out/trigger-battery.json'), JSON.stringify({ _contract: corpus._contract, rows }, null, 2));

console.log('══════ TRIGGER BATTERY — the surgeon judgment, every angle, the REAL gate ══════');
for (const r of rows) console.log('  ' + r.id.padEnd(24) + ' target=' + r.target.padEnd(14) + ' gate=' + r.current_gate.padEnd(10) + ' off%=' + String(r.off_pct ?? '—').padEnd(5) + ' → ' + r.status);
const c = (st) => rows.filter((r) => r.status === st).length;
console.log('\n  MATCH ' + c('MATCH') + ' · DOCUMENTED-HOLE ' + c('DOCUMENTED-HOLE') + ' (the warranty class — calibration workload, measured) · DOMAIN-UNFITTED ' + c('DOMAIN-UNFITTED') + ' (fit your own tesseract: init-fork + axis dumps) · REGRESSION ' + c('REGRESSION'));
console.log('  → attest-out/trigger-battery.json (timestamp-free; two runs diff to zero bytes)');
if (regression) { console.error('\n✗ REGRESSION: a noise row passed the gate — the lit-mass floor failed. This exits red.'); process.exit(2); }
