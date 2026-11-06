#!/usr/bin/env node
// scripts/cog/ollama-lane.mjs — THE LOCAL-MODEL LANE, BOTH ENDS: may this job load a model, and
// does it give the model back the moment it is done.
// =============================================================================================
// Operator 2026-10-05, verbatim: "how do we prevent these from ever happening again - if we load
// local models, unload them too".
//
// MEASURED THE SAME DAY. With the active-session hold live (llm-pause.mjs), qwen2.5:7b sat 6.3 GB
// resident and kept being reloaded by automatic callers. Two things were wrong at once:
//   1. a dozen callers reached ollama without asking the one gate (the ollama-callers ratchet read
//      76 against a known debt of 74), and
//   2. every caller that DID run left the model loaded for the server's OLLAMA_KEEP_ALIVE (2m) after
//      it finished. A job that runs every few minutes therefore keeps the model resident forever,
//      even though each individual call is short.
//
// THIS MODULE IS THE ONE PLACE BOTH ANSWERS LIVE, so a caller inherits them by importing it:
//   automaticHold()   the gate, read through llm-pause.mjs (never a second copy of the rule).
//                     LLM_ACTIVE_OK=1 is the explicit operator ask and is never held — the same
//                     convention region-narrative.mjs uses (C216: the holds stop the AUTO-fire).
//   oneShotBody(b)    a single-call job's /api/generate body with keep_alive 0, so ollama unloads the
//                     model as soon as the response is written instead of 2 minutes later.
//   releaseModel(m)   for a MULTI-call job (one paragraph per request), which must not unload between
//                     its own calls: one request after the last call, {model, keep_alive: 0} and NO
//                     prompt — ollama's documented unload. A request without a prompt never loads a
//                     model that is not resident, so a release can never be the thing that loads it.
//
// CLI (for shell callers that use the HTTP API rather than `ollama run`):
//   node scripts/cog/ollama-lane.mjs --release <model> [<model>…]   always exits 0 (best effort)
//   node scripts/cog/ollama-lane.mjs --held                           exit 10 = held, 0 = free
//
// Guard: tests/cog/ollama-callers-ratchet.test.mjs (the gate count, and the release on the wire).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmPauseActive } from './llm-pause.mjs';

export const OLLAMA_HOST = () => process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434';

/** The hold for an AUTOMATIC local-model caller, or null. LLM_ACTIVE_OK=1 = the operator asked by name. */
export function automaticHold({ explicit = process.env.LLM_ACTIVE_OK === '1' } = {}) {
  return llmPauseActive(undefined, { lane: 'ollama', explicit });
}

/** A single-call job's request body: the model is released when this one response is done. */
export function oneShotBody(body) {
  return { ...body, keep_alive: 0 };
}

/** The unload request: the model and keep_alive 0, never a prompt (a prompt would be a read). */
export function releaseBody(model) {
  return { model, keep_alive: 0 };
}

/** Unload `model` now. Best effort: never throws, resolves true when ollama accepted it. */
export async function releaseModel(model, { host = OLLAMA_HOST(), fetchFn = globalThis.fetch, ms = 5000 } = {}) {
  if (!model) return false;
  try {
    const r = await fetchFn(`${String(host).replace(/\/api\/generate$/, '').replace(/\/$/, '')}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(releaseBody(model)), signal: AbortSignal.timeout(ms),
    });
    return !!(r && r.ok);
  } catch {
    return false;
  }
}

const IS_CLI = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_CLI) {
  const args = process.argv.slice(2);
  if (args[0] === '--held') {
    const h = automaticHold();
    if (h) { console.log(`⏸  HELD until ${h.until}`); process.exit(10); }
    console.log('▶️  not held'); process.exit(0);
  }
  if (args[0] === '--release') {
    for (const m of args.slice(1)) {
      const ok = await releaseModel(m);
      console.error(`${ok ? '⏏  released' : '·  release not accepted (ollama down or model unknown)'} ${m}`);
    }
    process.exit(0);
  }
  console.error('usage: ollama-lane.mjs --release <model>… | --held');
  process.exit(2);
}
