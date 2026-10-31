// src/lib/pmu/attest-corpus.mjs
//
// THE ONE LOADER for data/pmu/attest-reference-corpus.json.
//
// WHY THIS EXISTS: the attest demo used to carry its probe strings as inline consts inside main(),
// and the honesty guard carried its own copy. Two copies drift, and the drift is invisible — the demo
// can show a corpus the guard never measured, which is precisely how "the gate is not a rubber stamp"
// survived as a claim the numbers did not support. One file, two readers, no drift.
//
// Deterministic by construction: `repeat` and `generate` probes are built from integer arithmetic
// (no RNG, no clock), so the same JSON yields byte-identical strings on every host and every run —
// the same discipline as the LLM-free receipt.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CORPUS_PATH = resolve(REPO_ROOT, 'data/pmu/attest-reference-corpus.json');

const J = (a) => a.filter(Boolean).join('\n\n');

// Deterministic pseudo-random tokens — a multiplicative walk, not Math.random().
function pseudoRandomTokens({ count, seed, modulus, prefix }) {
  return Array.from({ length: count }, (_, i) => `${prefix}${((i * seed) % modulus).toString(36)}`).join(' ');
}

function probeText(p) {
  if (Array.isArray(p.text)) return J(p.text);
  if (p.repeat) return Array(p.repeat.count).fill(p.repeat.token).join(' ');
  if (p.generate?.kind === 'pseudo_random_tokens') return pseudoRandomTokens(p.generate);
  throw new Error(`attest-corpus: probe "${p.key}" has no text/repeat/generate`);
}

export function loadAttestCorpus(path = CORPUS_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const probes = raw.probes.map((p) => ({ ...p, doc: probeText(p) }));
  const byKey = Object.fromEntries(probes.map((p) => [p.key, p]));
  return {
    lane: raw.lane,
    spec: J(raw.spec),
    probes,
    byKey,
    doc: (key) => {
      const p = byKey[key];
      if (!p) throw new Error(`attest-corpus: no probe "${key}"`);
      return p.doc;
    },
    inLane: probes.filter((p) => p.family === 'in_lane'),
    offLane: probes.filter((p) => p.family === 'off_lane'),
  };
}
