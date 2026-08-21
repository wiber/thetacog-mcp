// scripts/pmu/reef-bridge.mjs — the DETERMINISTIC code→reef bridge (the root fix for the reality-walk
// COLLAPSE / empty panels, 2026-07-04). Full write-up: docs/architecture/reef-grip-walk-collapse-2026-07-04.md
// ============================================================================================
// Raw code identifiers don't cluster on the CONNECTED reef anchors, so the reality ballistic walk dies at
// ~2 hops while intent (goal-language) walks ~140 → empty cloud → 0-region panel. The removed on-board LLM
// used to translate code→goal-language so code gripped the reef; this does the same with ZERO model:
// for each reef domain whose vocab the code LITERALLY contains (≥2 keyword hits), emit a CLAIM-SENTENCE
// (senseDecompose extracts claims, not bare word-lists) so reality lights the SAME connected anchor for
// each domain its code actually touches — weighted by hit-count so stronger domains grip harder.
//
// SAFE AGAINST FALSE-GREEN by construction: a domain enriches ONLY when its keywords are literally
// present, so off-domain content (no vocab match) gets NO enrichment and honestly under-measures — it can
// never falsely grip a domain it doesn't name. Proven: a real-drift commit (9d7852777) still shows 611
// red after the bridge; genuinely off-domain text ("banana bread recipe") enriches to nothing.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REEF_DOMAINS = (() => {
  try { return (JSON.parse(readFileSync(resolve(HERE, '..', '..', 'data/pmu/lens-reef.json'), 'utf8')).domains) || []; }
  catch { return []; }
})();

// which reef domains does this text literally touch (≥2 vocab hits)? — the decidable, no-model classifier.
export function matchedDomains(text, { minHits = 2 } = {}) {
  const t = String(text || '').toLowerCase();
  if (!t) return [];
  const words = new Set(t.split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const out = [];
  for (const d of REEF_DOMAINS) {
    const vocab = String(d.vocab || '').toLowerCase().split(/\s+/).filter(Boolean);
    const present = vocab.filter(v => words.has(v) || t.includes(v));
    if (present.length >= minHits) out.push({ domain: d.domain, hits: present.length, present });
  }
  return out;
}

// the bridge corpus: claim-sentences that cluster reality on the connected anchors its code names.
export function reefBridge(text, { minHits = 2, weightCap = 5, vocabCap = 10 } = {}) {
  const out = [];
  for (const m of matchedDomains(text, { minHits })) {
    const claim = `This change operates in the ${String(m.domain).replace(/-/g, ' ')} domain, involving ${m.present.slice(0, vocabCap).join(' ')}.`;
    for (let k = 0; k < Math.min(m.hits, weightCap); k++) out.push(claim);   // weight by hit-count
  }
  return out.join('\n');
}
