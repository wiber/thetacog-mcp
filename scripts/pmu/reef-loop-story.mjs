#!/usr/bin/env node
// scripts/pmu/reef-loop-story.mjs — qwen NARRATES the last loop cycle (the knock-on story,
// spec R3: models narrate LATER, never in the verdict). Reads ONLY deterministic outputs
// (floor file, last HA tape state, intake counts), asks LOCAL qwen for a 3-4 sentence log
// entry, appends to .thetacog/reef-loop-story.ndjson. Offline (127.0.0.1). Best-effort:
// a dead ollama means a skipped story, never a failed tick.
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const floor = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/ratchet-floor.json'), 'utf8'));
  const tape = JSON.parse(readFileSync(resolve(REPO, 'docs/pmu/attest-flight-tape.json'), 'utf8'));
  const ha = [...tape.timeline_events].reverse().find((e) => e.source === 'harvest-agent');
  const adj = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-c1-adjudication.json'), 'utf8'));
  const pending = (adj.rows || []).filter((r) => !r.consumed).length;
  // GREEKS + BREADCRUMBS (operator 2026-07-20: "qwen should have the greeks too … so qwen
  // learns to walk the breadcrumbs in the n-dimensional tesseract"): the agent state's sealed
  // walk (σ/coord — present since the metalWalk seal) and the last placed row's per-ply
  // gradient-trace lineage ride IN the facts. qwen still only NARRATES — never the verdict.
  const w = ha && ha.metrics && ha.metrics.walk;
  const greeks = w ? ` · greeks σ ${w.trajectory_drift_sigma ?? '—'} @ ${w.pixel_coord || '—'} (gzip ${w.gzip_ms ?? '—'}ms walk ${w.walk_ms ?? '—'}ms)` : '';
  const lastPlaced = [...(adj.rows || [])].reverse().find((r2) => r2.provenance && r2.provenance.lineage);
  const crumbs = lastPlaced ? ` · last walk ${lastPlaced.provenance.placed_coord} in ${lastPlaced.provenance.walk_hops} hops: ${lastPlaced.provenance.lineage.join(' → ')}` : '';
  const facts = `floor F1 ${floor.picker.f1} · last agent state ${ha ? `${ha.id} ${ha.metrics.verdict} (${ha.label})` : 'none'}${greeks} · intake pending ${pending} · Δσ trend ${JSON.stringify((floor.dsigma_trend_v2 || []).at(-1)?.vs_v2_baseline || null)}${crumbs}`;
  const r = await fetch(process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.LENS_CAL_MODEL || 'qwen2.5:7b', stream: false,
      prompt: `You are the night-shift log keeper for a self-refining semantic lattice. FACTS (deterministic, do not alter numbers): ${facts}. Write a 3-4 sentence log entry: what this cycle did, whether the constitution accepted, and what the numbers imply for the next tick. Plain prose, no markdown, no speculation beyond the facts.`,
      options: { temperature: 0.4, num_predict: 160 } }),
    signal: AbortSignal.timeout(120000) });   // 120s: cold model load (~17s) + tick CPU contention measured over 60s combined 2026-07-20
  const story = String((await r.json()).response || '').replace(/\s+/g, ' ').trim();
  appendFileSync(resolve(REPO, '.thetacog/reef-loop-story.ndjson'),
    JSON.stringify({ ts: new Date().toISOString(), facts, story }) + '\n');
  console.log(`story: ${story.slice(0, 120)}…`);
} catch (e) { console.log(`(story skipped: ${String(e.message).slice(0, 80)})`); }
