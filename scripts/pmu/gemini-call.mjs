#!/usr/bin/env node
// scripts/pmu/gemini-call.mjs — the ONE resilient Gemini CLI caller for the PMU loops.
//
// Why (operator, Jun 11: "fix the gemini call, it says not avail — did you change it or is there a
// limit?"): overnight the API returned 429 "No capacity available for model gemini-2.5-flash"
// (rateLimitExceeded) under heavy use (2 converge passes + 10 briefings + grading); night-loop
// iterations 5–6 fell back to deterministic text and one call ETIMEDOUT. Nothing was changed —
// it's a capacity limit. The fix: retry with backoff, then FALL BACK down a model chain instead of
// giving up. Flash stays first (the pinned default — the auto-router's ~4min retries are the thing
// we avoid); lite/2.0 are capacity relief, not a quality upgrade path.
//
// Used by: night-thinking-loop.mjs · reef-loop.mjs · reef-grade.mjs (LLM is always ingest/grading
// side — never the chip's blocking path, AR-7).

import { execFileSync } from 'node:child_process';

const CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const sleep = (ms) => { const sab = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(sab), 0, 0, ms); };

// Synchronous resilient call. Returns the model's text. Throws only after the WHOLE chain failed
// (callers keep their own deterministic last-resort fallbacks).
export function geminiCall(prompt, { models = CHAIN, retriesPerModel = 2, timeoutMs = 240000, cwd = process.cwd() } = {}) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt <= retriesPerModel; attempt++) {
      try {
        return execFileSync('gemini', ['--yolo', '--model', model, '-p', prompt],
          { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 5e7 }).trim();
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || '');
        const capacity = /429|rateLimit|No capacity|RESOURCE_EXHAUSTED|ETIMEDOUT/i.test(msg);
        if (!capacity && attempt === 0) break;            // non-capacity error → next model immediately
        if (attempt < retriesPerModel) sleep(3000 * (attempt + 1));   // backoff 3s, 6s
      }
    }
  }
  throw lastErr || new Error('gemini chain exhausted');
}
