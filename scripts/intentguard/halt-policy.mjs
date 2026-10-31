#!/usr/bin/env node
// scripts/intentguard/halt-policy.mjs — C917 THE DEPLOYER TUNES THE HALT; IT RUNS ON THEIR MACHINE.
//
// Per deployed job, the SAME envelope C916 already reads (docs/specs/fleet/<job>.rings.json: pole ·
// electrician · forbidden) carries three more knobs, all the deployer's to set, none of ours to default
// toward a cap:
//   policy                   { plumber, electrician, demolisher } → one of LOG_AND_CONTINUE ·
//                             PAUSE_FOR_DISPATCH · HALT, per ring. An undeclared ring falls back to
//                             DEFAULT_POLICY below; an invalid declared value falls back too, named why —
//                             never thrown (TAPE, NOT BRAKE).
//   max_excursion_distance   a Chebyshev cell count (laneJump, scripts/pmu/lane-jump-sn.mjs — the one
//                             definition, never redefined here) from the pole's nearest cell. Exceeded on
//                             an electrician or demolisher reading, it HALTS regardless of the ring's own
//                             declared policy: a distance ceiling is a harder promise than a ring label.
//   token_ceiling             a per-task cap (C168b's dispatcher-wide BUDGET_OVERFLOW, read per task
//                             here): tokens over the ceiling HALTS regardless of ring or distance.
//
// WHAT WE WARRANT (never more): the signal fires as declared, on the record. haltDecision only NAMES the
// action — fleet-harness.mjs's act() is the wrapper that EXECUTES it, in the deployer's own process,
// before fn() (the call) runs. A job that declares no envelope reads ring=null here and gets
// LOG_AND_CONTINUE every time: declaring nothing behaves exactly as it did before this row existed.
//
// SUFFICIENT FOR: which of three actions a declared envelope names for a given ring/distance/token
// reading. NOT SUFFICIENT FOR: whether the halted call would have been good (Rice), or anything the
// deployer's own wrapper does with the name once handed back.
import { laneJump } from '../pmu/lane-jump-sn.mjs';

export const ACTIONS = ['LOG_AND_CONTINUE', 'PAUSE_FOR_DISPATCH', 'HALT'];
export const DEFAULT_POLICY = { plumber: 'LOG_AND_CONTINUE', electrician: 'LOG_AND_CONTINUE', demolisher: 'HALT' };

/** The Chebyshev distance from `pixel` to the NEAREST cell in `pole` — null when either side is unmeasured. */
export function excursionDistance(pixel, pole = []) {
  if (!pixel || !Array.isArray(pole) || !pole.length) return null;
  let best = null;
  for (const cell of pole) { const d = laneJump(pixel, cell); if (Number.isFinite(d) && (best === null || d < best)) best = d; }
  return best;
}

/**
 * haltDecision({ ring, pixel, pole, knobs, tokens }) → { action, distance, why }
 *   ring    'plumber' | 'electrician' | 'demolisher' | 'unmeasured' | null
 *   pixel   the call's own cell, for the distance check — null when unmeasured
 *   pole    the envelope's declared ring-1 cells, for the distance check
 *   knobs   { policy, max_excursion_distance, token_ceiling } — all optional, all the deployer's
 *   tokens  this task's own token count, when the caller has one — null when unmeasured
 */
export function haltDecision({ ring = null, pixel = null, pole = [], knobs = {}, tokens = null } = {}) {
  const k = knobs || {};
  if (Number.isFinite(k.token_ceiling) && Number.isFinite(tokens) && tokens > k.token_ceiling) {
    return { action: 'HALT', distance: null, why: `token ceiling exceeded: ${tokens} > ${k.token_ceiling} (C168b)` };
  }
  if (!ring || ring === 'unmeasured') {
    return { action: 'LOG_AND_CONTINUE', distance: null, why: 'unmeasured ring — never blocks by default (tape, not brake)' };
  }
  const distance = excursionDistance(pixel, pole);
  if (ring !== 'plumber' && Number.isFinite(k.max_excursion_distance) && distance !== null && distance > k.max_excursion_distance) {
    return { action: 'HALT', distance, why: `excursion distance ${distance} exceeded max ${k.max_excursion_distance} — overrides the ring's own policy` };
  }
  const declared = k.policy && k.policy[ring];
  if (declared != null) {
    if (ACTIONS.includes(declared)) return { action: declared, distance, why: `declared policy for ring=${ring}` };
    return { action: DEFAULT_POLICY[ring] || 'LOG_AND_CONTINUE', distance, why: `declared policy "${declared}" for ring=${ring} is not one of ${ACTIONS.join(' · ')} — fell back to the default` };
  }
  return { action: DEFAULT_POLICY[ring] || 'LOG_AND_CONTINUE', distance, why: `no declared policy for ring=${ring} — default` };
}
