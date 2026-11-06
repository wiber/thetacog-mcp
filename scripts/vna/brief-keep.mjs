#!/usr/bin/env node
// scripts/vna/brief-keep.mjs — C235d THE BENCH IS A PROXY UNTIL THE LAND RATE AGREES (pasted goal, 2026-09-24: *"The ratchet only
// climbs when the model successfully reads the tree, executes the exact tool, and commits the work cleanly."*). brief-bench.mjs keeps
// a variant on its FIRST-TURN tool-call rate; a first-turn tool call is not a landed commit. This is the second question, and the one
// that moves what a worker is actually sent:
//   · the KEPT brief lives in data/vna/brief-kept.json (variant id + the knob values steer-runner renders); steer-runner.mjs reads it
//     at dispatch, applies it to the local brief, and stamps brief_variant on the dispatch, verdict and learn rows.
//   · keepBrief() moves it only when the candidate's LAND RATE on real unattended dispatches — dispatch rows carrying that
//     brief_variant, landed = verdict ok AND ticked (spec-check ticks only at a commit naming the row with its guard green) — rises
//     over the incumbent's, ≥ MIN_LAND dispatches on each side, both intervals on the move row. Bench evidence alone is refused.
//   · a variant steer-runner cannot render (framing json, a num_ctx the engine is not sent) is refused at keep time and named, never
//     stamped over a brief that differs from it.
// LLM-free; node (a decision — its port row is C170a's family: engine-map.mjs lists it on the next derivation).
//
//   node scripts/vna/brief-keep.mjs            the kept brief and the land rate of every variant on the ledger
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../pmu/wilson-n-to-bind.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const KEPT_PATH = process.env.VNA_BRIEF_KEPT || resolve(REPO, 'data/vna/brief-kept.json');
export const KEPT_NDJSON = process.env.VNA_BRIEF_KEPT_NDJSON || resolve(REPO, 'data/vna/brief-kept.ndjson');
export const MIN_LAND = 10;
export const INCUMBENT = Object.freeze({ v: 1, variant: 'I0', knobs: { framing: 'md', exit: 'today', exit_line: null, num_ctx: null } });
export const RENDERABLE = 'framing md · exit today|tail (the tail line carried literally) · num_ctx null';

export function readKeptBrief(path = KEPT_PATH) { try { const k = JSON.parse(readFileSync(path, 'utf8')); return k && k.variant ? k : INCUMBENT; } catch { return INCUMBENT; } }
/** why steer-runner cannot send this variant as written, or null when it can */
export function unrenderable(knobs = {}) {
  if (knobs.framing && knobs.framing !== 'md') return `framing ${knobs.framing} — steer-runner renders the md contract only`;
  if (knobs.num_ctx != null) return `num_ctx ${knobs.num_ctx} — the dispatch does not send a context window to the engine`;
  if (knobs.exit === 'tail' && !knobs.exit_line) return 'exit tail with no exit_line text to append';
  if (knobs.exit && !['today', 'tail'].includes(knobs.exit)) return `exit ${knobs.exit} — unknown`;
  return null;
}
/** the kept knobs applied to a local brief (md contract + work order): today = unchanged, tail = the exit line appended last */
export function applyKept(brief, kept = readKeptBrief()) {
  const k = kept.knobs || {};
  return k.exit === 'tail' && k.exit_line ? `${brief}\n\n${k.exit_line}` : brief;
}
const iv = (x, n) => { if (!n) return null; const w = wilson(x, n); return [Math.max(0, +w.low.toFixed(3)), Math.min(1, +w.high.toFixed(3))]; };
/** land rate of one brief variant on the runner ledger (a dispatch with no brief_variant ran the incumbent I0 — the only brief there was) */
export function landByVariant(rows, variant, { preset = null } = {}) {
  const at = (r) => (r.brief_variant || 'I0') === variant && (!preset || r.preset === preset);
  const n = rows.filter((r) => r.kind === 'dispatch' && at(r)).length;
  const x = rows.filter((r) => r.kind === 'verdict' && at(r) && r.ok && r.ticked).length;
  return { variant, preset, n, x, rate: n ? x / n : null, wilson95: iv(x, n) };
}
export function keepBrief({ candidate, rows = [], preset = null, bench = null, keptPath = KEPT_PATH, ndjsonPath = KEPT_NDJSON, at = new Date().toISOString(), write = true } = {}) {
  const kept = readKeptBrief(keptPath);
  const refuse = (why) => ({ kept: false, why, brief: kept });
  if (!candidate || !candidate.variant) return refuse('no candidate variant');
  if (candidate.variant === kept.variant) return refuse(`${candidate.variant} is already the kept brief`);
  const un = unrenderable(candidate.knobs); if (un) return refuse(`${candidate.variant} is not renderable by steer-runner: ${un}`);
  const c = landByVariant(rows, candidate.variant, { preset }), i = landByVariant(rows, kept.variant, { preset });
  if (!c.n) return refuse(`no real dispatch ran ${candidate.variant} — ${bench ? 'a bench keep alone is a proxy (C235d)' : 'UNMEASURED'}`);
  if (c.n < MIN_LAND || i.n < MIN_LAND) return refuse(`land rate on ${c.n} dispatch(es) of ${candidate.variant} and ${i.n} of ${kept.variant} — ${MIN_LAND} needed on each side`);
  if (!(c.rate > i.rate)) return refuse(`${candidate.variant} landed ${c.x}/${c.n}, not over ${kept.variant}'s ${i.x}/${i.n}`);
  const next = { v: (kept.v || 1) + 1, variant: candidate.variant, knobs: { ...INCUMBENT.knobs, ...candidate.knobs }, since: at.slice(0, 10), evidence: `land ${c.x}/${c.n} over ${kept.variant} ${i.x}/${i.n}${preset ? ` on ${preset}` : ''}`, moves: 'data/vna/brief-kept.ndjson' };
  const row = { at, v: next.v, from: kept.variant, to: candidate.variant, preset, candidate: c, incumbent: i, bench: bench || null };
  if (write) { mkdirSync(dirname(keptPath), { recursive: true }); writeFileSync(keptPath, JSON.stringify(next, null, 1) + '\n'); appendFileSync(ndjsonPath, JSON.stringify(row) + '\n'); }
  return { kept: true, row, brief: next };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { readRunnerRows } = await import('./runner-reading.mjs');
  const rows = readRunnerRows(); const k = readKeptBrief();
  console.log(`kept brief: ${k.variant} (v${k.v}) · ${k.evidence || ''}`);
  const vs = [...new Set(rows.filter((r) => r.kind === 'dispatch').map((r) => r.brief_variant || 'I0'))];
  for (const v of vs) { const l = landByVariant(rows, v); console.log(`  ${v.padEnd(10)} landed ${l.x}/${l.n}${l.wilson95 ? ` (Wilson ${l.wilson95.join('–')})` : ''}`); }
}
