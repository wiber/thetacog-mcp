#!/usr/bin/env node
// scripts/pmu/metal-pass.mjs — THE SHARED METAL PASS: seat the full walk Greeks into a tape state.
//
// One implementation, three callers (attest-perturb, build-demo-tape, scenario-to-tape) — the
// forgotten-caller bug class (T36–T42 baked placement_only because scenario-to-tape had its own
// pathless copy of nothing) ends by construction: any baker that seats states imports THIS.
// Calls the same /render the page runs (server up → full Greeks; down → null, caller labels
// placement_only honestly). Also exports backfill: heal placement_only states in-place.

import { readFileSync, existsSync } from 'node:fs';
import { createHash, sign as edSign } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function metalWalk({ intent, reality, negative, ideal }) {
  try {
    const portFile = ['.attest-serve.port', 'docs/pmu/.attest-serve.port'].map((f) => resolve(REPO, f)).find((f) => existsSync(f));
    if (!portFile) return null;
    const port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (!(port > 0)) return null;
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/render`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent, reality, negative, ...(ideal ? { ideal } : {}) }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const out = await res.json();
    if (!out || !out.live_response_metrics) return null;
    return { ...out.live_response_metrics, render_ms: Date.now() - t0, ...(ideal ? { ideal_domain: ideal } : {}) };
  } catch { return null; }
}

export function sealState(state, mesh) {
  const tHash = Date.now();
  const content_sha256 = createHash('sha256').update(JSON.stringify({ parent_id: state.parent_id, threshold: state.threshold, inputs: state.inputs, metrics: state.metrics })).digest('hex');
  let signature = null, signer = null;
  try { const id = mesh.roomIdentity('builder'); signature = edSign(null, Buffer.from(content_sha256, 'hex'), id.privateKey).toString('hex'); signer = { room: 'builder', pubkey_hex: id.pubkey_hex, algo: 'ed25519' }; } catch { /* hash-only */ }
  return { content_sha256, hash_ms: Date.now() - tHash, signature, signer, signed: !!signature };
}

// backfill — heal hollow states in a tape file: re-run the metal pass from each state's
// OWN inputs, seat the walk, flip placement_only, RE-SEAL (contents changed → new hash+signature).
// Two hollow classes: (1) placement_only — no walk at all; (2) TIMING-HOLLOW — a walk sealed
// under the pre-timing schema (no gzip_ms/walk_ms), which dashes the "gzip ingest time / PMU
// walk time" Greeks on the page beside a signed receipt (the credibility hole, 2026-07-19).
export async function backfillTape(tapePath, { onlySources = null } = {}) {
  const mesh = await import(resolve(REPO, 'scripts/mesh/mesh-keys.mjs')).catch(() => null);
  const tape = JSON.parse(readFileSync(tapePath, 'utf8'));
  const healed = [];
  for (const s of tape.timeline_events || []) {
    if (!s.metrics) continue;
    const timingHollow = s.metrics.walk && (s.metrics.walk.gzip_ms == null || s.metrics.walk.walk_ms == null);
    if (s.metrics.placement_only !== true && !timingHollow) continue;
    if (onlySources && !onlySources.includes(s.source)) continue;
    const ideal = (s.metrics.conv && s.metrics.conv.ideal) || (s.metrics.walk && s.metrics.walk.ideal_domain) || null;
    const walk = await metalWalk({ intent: s.inputs.intent, reality: s.inputs.reality, negative: s.inputs.negative, ideal });
    if (!walk) continue;                       // server down — leave honest placement_only
    s.metrics.walk = walk; s.metrics.placement_only = false;
    s.seal = sealState(s, mesh);
    healed.push(s.id);
  }
  return { tape, healed };
}
