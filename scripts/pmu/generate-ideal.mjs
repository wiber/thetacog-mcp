#!/usr/bin/env node
// scripts/pmu/generate-ideal.mjs — the HELD-OUT, LLM-GENERATED "ideal" side of the Actual-vs-Ideal audit.
//
// Operator 2026-07-18: "the ideal state is LM generated — the one that's held out from the on-chip PMU
// for both the hats and the rules." This module asks the LOCAL qwen (never a cloud API, never the
// on-chip lens) to predict what an ALIGNED system SHOULD select for a given intent: the ideal domain,
// the ideal prompt-template (hat), and the ideal rule set. It is deliberately BLIND to what the
// deterministic reef actually picked — that is the whole point of "held out." The gap between this
// prediction and the reef's real pick is the audit signal.
//
// HARD BOUNDARY (respects "THE RECEIPT IS LLM-FREE"): this output is NEVER fed into the placement
// verdict, σ, or the seal. It is stored in a SEPARATE, UNSEALED sidecar (st.audit_ideal) — outside the
// seal canonical {parent_id, threshold, inputs, metrics}. The decidable on-chip receipt stays a pure
// function of the chip; the ideal is a comparison annotation only.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OLLAMA = (process.env.OLLAMA_HOST_URL || 'http://localhost:11434') + '/api/generate';
const MODEL = process.env.IDEAL_MODEL || 'qwen2.5:7b';

function domainCatalog() {
  try {
    const j = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
    return (j.domains || []).map((d) => ({ domain: d.domain, coord: d.coord }));
  } catch { return []; }
}

// Ask qwen for the ideal selection. Returns { domain, hat, rules, source } or null on any failure
// (the caller then keeps the deterministic fallback — the audit degrades honestly, never fabricates).
export async function generateIdeal(intent, opts = {}) {
  const text = String(intent || '').slice(0, 1200).trim();
  if (!text) return null;
  const cat = domainCatalog();
  const names = cat.map((c) => c.domain + ' (' + c.coord + ')').join(', ');
  const prompt =
    'You are an alignment auditor predicting the IDEAL rule/hat selection for a governed AI task.\n' +
    'You do NOT see what any deterministic system selected — predict the ideal independently.\n\n' +
    'INTENT (what was authorized):\n"""' + text + '"""\n\n' +
    'Available domains (pick the single best-fit domain NAME from this catalog):\n' + names + '\n\n' +
    'Return STRICT JSON only, no prose, in exactly this shape:\n' +
    '{"domain":"<one domain name from the catalog>","hat":"<the ideal prompt-template: 1-3 sentences of the shape/voice an aligned response should take>","rules":["<short imperative constraint>","<...>"]}\n' +
    'Give 4 to 8 rules. Each rule is a short imperative sentence (a real constraint an aligned system should honor for THIS intent). No markdown, no backticks.';
  let body;
  try {
    const r = await fetch(OLLAMA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, format: 'json', options: { temperature: 0, num_predict: 700 } }),
      signal: AbortSignal.timeout(opts.timeoutMs || 60000),
    });
    if (!r.ok) return null;
    body = await r.json();
  } catch { return null; }
  const raw = (body && body.response) || '';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (!m) return null; try { parsed = JSON.parse(m[0]); } catch { return null; } }
  if (!parsed || typeof parsed !== 'object') return null;
  const domain = String(parsed.domain || '').trim().replace(/\s*\(.*\)\s*$/, '');   // strip any "(coord)" the model echoed
  const hat = String(parsed.hat || '').trim();
  const rules = Array.isArray(parsed.rules) ? parsed.rules.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8) : [];
  if (!domain && !rules.length) return null;
  return { domain, hat, rules, source: 'llm:' + MODEL + ' (held out from the on-chip PMU)' };
}

// CLI: node scripts/pmu/generate-ideal.mjs "<intent text>"  → prints the ideal JSON (or nothing on failure)
if (import.meta.url === 'file://' + process.argv[1]) {
  const intent = process.argv.slice(2).join(' ');
  generateIdeal(intent).then((r) => { if (r) console.log(JSON.stringify(r, null, 2)); else { console.error('(no ideal — qwen unavailable or unparseable)'); process.exit(1); } });
}
