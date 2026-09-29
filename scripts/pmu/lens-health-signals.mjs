#!/usr/bin/env node
// scripts/pmu/lens-health-signals.mjs — THE LENS'S OWN-CONTRIBUTION HEALTH SIGNALS (operator 2026-06-30).
// =============================================================================
// Make the lens's OWN contribution a tracked, measurable health signal — not just its latency. Four signals,
// all derived (MEASURE, don't assert — CLAUDE.md "Code Definition-of-Done"):
//
//   breadth            populated unique lattice coords / 144 (from data/pmu/lens-reef.json). How much of the
//                      144 ShortLex lattice the reef actually covers. Tracked + ratcheted (operator wants it
//                      OPTIMIZED), but NOT to an arbitrary 50% — over-fragmenting domains violates 7±3 and
//                      hurts routing. The target is "as much breadth as keeps reef-health ≥95 + routing
//                      correct," ratcheted empirically (lens-contribution-gate.mjs).
//   walkSparsity       the RAW-CELL fillPct of a representative walk (matrixCells/20736 from the receipt). The
//                      saturation guard: must stay ≤ 0.70 (a saturated cloud → σ content-independent). At the
//                      measured shallow depth-2 this is ~0.01-0.02. NOTE: the on-chip walk AMPLIFIES with
//                      depth (it does NOT decay) — so this is the correct metric, NOT "heatmap mass."
//   reefSize           total char size of the searched reef (domain · vocab · template · tools · rules).
//   signalUtilization  for each of {gzip, walk, rules}: did it produce a REAL non-idle contribution this
//                      run, or is it honestly N/A? An idle-but-AVAILABLE signal (gzip showing 0μs while it ran)
//                      is a UTILIZATION FAILURE — exactly the "idle gzip on the receipt" the operator flagged.
//
//   node scripts/pmu/lens-health-signals.mjs            # the one-line health stamp
//   node scripts/pmu/lens-health-signals.mjs --json
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REEF_FILE = resolve(REPO, 'data/pmu/lens-reef.json');
const LATTICE = 144;

export function reefDomains({ file = REEF_FILE } = {}) {
  try { return JSON.parse(readFileSync(file, 'utf8')).domains || []; } catch { return []; }
}

// BREADTH — unique populated lattice coords / 144. (Distinct coords, not raw domain count — two domains on
// the same coord populate one cell.)
export function reefBreadth({ file = REEF_FILE } = {}) {
  const doms = reefDomains({ file });
  const coords = new Set(doms.map((d) => d.coord).filter(Boolean));
  const count = coords.size;
  return { count, lattice: LATTICE, breadth: +(count / LATTICE).toFixed(4) };
}

// REEF-SIZE — total char size of the searched corpus (mirrors prompt-lens.mjs REEF_TOTAL_CHARS exactly).
export function reefSize({ file = REEF_FILE } = {}) {
  return reefDomains({ file }).reduce((n, d) =>
    n + String(d.domain || '').length + String(d.vocab || '').length + String(d.template || '').length
      + String(d.tools || '').length + (d.rules || []).join('').length, 0);
}

// WALK SPARSITY — the RAW-CELL fill of the representative walk (receipt.walkFillPct is a %, return a fraction).
export function walkSparsity(receipt = {}) { return +(((receipt.walkFillPct || 0) / 100)).toFixed(4); }

// SIGNAL UTILIZATION — did each available signal do REAL work this run (✓), run in the background (bg), or
// is it honestly N/A / down? The gzip seed-time is the key one: > 0 ⇒ the gzip-NCD seeding actually ran and
// is SURFACED (not idle-but-hidden). `gzipSeedUs` is the always-on litScores seeding; `gzipPlaceMs` the rare
// placePixel fallback. Either counts as gzip work.
export function signalUtilization(receipt = {}) {
  const seedUs = receipt.gzipSeedUs != null ? receipt.gzipSeedUs : Math.round((receipt.gzipMs || 0) * 1000);
  const placeMs = receipt.gzipPlaceMs || 0;
  const gzipUs = seedUs + Math.round(placeMs * 1000);
  const gzip = { ran: gzipUs > 0, us: gzipUs, seedUs, placeMs, state: gzipUs > 0 ? '✓' : 'idle' };
  const walk = { ran: receipt.sensor === 'metal',
    state: receipt.sensor === 'metal' ? '✓' : ((receipt.pmuMs || 0) > 0 ? 'fallback' : 'N/A') };
  const rules = { ran: (receipt.rulesReturned || 0) >= 1,
    state: (receipt.rulesReturned || 0) >= 1 ? '✓' : 'N/A' };
  return { gzip, walk, rules };
}

// the full health bundle, derived from ONE lens receipt (+ the reef file).
export function computeFromReceipt(receipt = {}) {
  const b = reefBreadth();
  return {
    breadth: b.breadth, breadthCount: b.count, lattice: b.lattice,
    walkSparsity: walkSparsity(receipt),
    reefSize: reefSize(),
    signals: signalUtilization(receipt),
  };
}

// the mobile-tight one-line health stamp for the receipt, e.g.
//   📐 breadth 15% (22/144) · reef 11.5k ch · signals: gzip✓ walk✓ rules✓
export function renderHealthLine(h) {
  const pct = Math.round((h.breadth || 0) * 100);
  const reefCh = (h.reefSize || 0) >= 1000 ? `${(h.reefSize / 1000).toFixed(1)}k` : `${h.reefSize || 0}`;
  const s = h.signals || {};
  const seg = (name, sig) => {
    const st = (sig && sig.state) || 'N/A';
    return st === '✓' ? `${name}✓` : `${name}·${st}`;
  };
  const sig = `${seg('gzip', s.gzip)} ${seg('walk', s.walk)} ${seg('rules', s.rules)}`;
  return `📐 breadth ${pct}% (${h.breadthCount}/${h.lattice}) · reef ${reefCh} ch · signals: ${sig}`;
}

// run ONE sync lens receipt (no model on the critical path) and derive the health signals from it. The lens
// is SPAWNED as a subprocess (not imported) — prompt-lens.mjs statically imports THIS module, so importing
// it back here would deadlock the ESM cycle under top-level await (exit 13). Spawning mirrors the existing
// gate pattern (lens-target-gate.mjs / lens-health.sh) and keeps the receipt byte-identical to production.
export function healthFromLens({ prompt = process.env.LENS_HEALTH_PROMPT || 'update the stripe webhook', env = {} } = {}) {
  const out = execFileSync(process.execPath, [resolve(REPO, 'scripts/pmu/prompt-lens.mjs'), '--prompt', prompt, '--json'],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, LENS_BUDGET_MS: process.env.LENS_BUDGET_MS || '1', ...env } });
  const r = JSON.parse(out);
  return computeFromReceipt(r.receipt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = healthFromLens();
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(h, null, 2) + '\n'); process.exit(0); }
  console.log(renderHealthLine(h));
  console.log(`  breadth ${(h.breadth * 100).toFixed(1)}% (${h.breadthCount}/${h.lattice}) · walkSparsity ${(h.walkSparsity * 100).toFixed(2)}% · reefSize ${h.reefSize} ch`);
  console.log(`  signals: gzip ${h.signals.gzip.us}μs (${h.signals.gzip.state}) · walk ${h.signals.walk.state} · rules ${h.signals.rules.state}`);
}
