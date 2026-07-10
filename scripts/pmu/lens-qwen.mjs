#!/usr/bin/env node
// scripts/pmu/lens-qwen.mjs — QWEN AS THE BUDGETED BACKGROUND CONTROL/VERIFIER (operator 2026-06-30).
// =============================================================================
// qwen2.5:7b is the lens's BACKGROUND control: it never blocks the human's prompt (off the sync critical
// path), it is BOUNDED by an explicit budget, and EVERY call is INSTRUMENTED (wall-ms + the ollama token
// counts) so the operator's two questions are MEASURED, never asserted:
//   1. "does qwen use its budget?"  → utilization = wall-ms / budget, % within budget (lens-qwen-usage.mjs).
//   2. "is the placement right?"     → the CONTROL task: qwen reads the routed domain/pixel and votes
//                                       agree/disagree (a cheap second opinion on the on-chip walk).
//
// THE HONESTY RULE (CLAUDE.md · "MEASURE, DON'T ASSERT"): the receipt must never say "qwen skipped" as if
// qwen were unavailable when it is up. We distinguish three real states via a fast localhost ping:
//   · ran      — the call completed (extrapolate or control); report ms + tokens.
//   · budget-skip (up)  — ollama IS up, we deliberately did not spend the budget on the sync path.
//   · down     — ollama is not answering; the degrade was forced, not chosen.
//
// Instrumentation sink: .thetacog/lens-qwen-usage.ndjson (append-only). Report: lens-qwen-usage.mjs --report.

import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const USAGE_LOG = resolve(REPO, '.thetacog/lens-qwen-usage.ndjson');
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.IM_MODEL || 'qwen2.5:7b';
// the explicit budget the operator asked for — qwen runs OFF the sync path but bounded by this. The
// default is set ABOVE the MEASURED p95 audit latency so the background auditor RELIABLY yields a real
// >0-token verdict (a 0-token timeout teaches NOTHING and, worse, used to render as a fabricated
// "uncertain" — see lens-qwen-audit.mjs). MEASUREMENT (live qwen2.5:7b, 2026-06-30, 20 audits): the WARM
// median is ~1.7s, but the COLD/queued tail (an audit queued behind the turn's extrapolate call, or a
// cold model) reaches p95≈4.6s. The OLD 3000ms budget cut that tail → measured answer-rate 93% (7% of
// audits returned 0 tokens = a lie). Raising to 6000ms clears the p95 with margin → MEASURED answer-rate
// 100% (20/20) with the median still ~1.7s (fast audits are unaffected; only the cold tail gets the room
// it needs). qwen is OFF the sync path so this generosity costs the human nothing. Tunable via LENS_QWEN_BUDGET_MS.
export const LENS_QWEN_BUDGET_MS = Number(process.env.LENS_QWEN_BUDGET_MS || 6000);
// below this remaining-budget we do NOT even attempt a 7b generation (it cannot finish) — the sync-path
// guard that stops a ~50ms aborted fetch from taxing every prompt. Distinct from the budget ceiling.
export const QWEN_MIN_MS = Number(process.env.LENS_QWEN_MIN_MS || 300);

// append one instrumentation row (best-effort, never throws, never blocks).
export function appendUsage(row) {
  try {
    mkdirSync(dirname(USAGE_LOG), { recursive: true });
    appendFileSync(USAGE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
  } catch { /* instrumentation is best-effort */ }
}

// fast up/down probe — BUSY-TOLERANT (2026-07-01 honest-down fix). Ground truth for "ollama is up" is a
// successful GET /api/tags: it lists installed models and NEVER touches the model, so it is instant even
// while ollama is mid-generation. A genuine down is immediate (localhost ECONNREFUSED throws at once), so
// down still resolves fast. The bug we are killing: under concurrent generation load a single TIGHT-deadline
// probe could miss while the server was perfectly reachable, and that transient miss was rendered on the
// PUBLIC receipt as `qwen · down` — a lie. Fix: RETRY (with a longer deadline on the retry) and only report
// down when EVERY attempt fails. NEVER claim down when /api/tags succeeds. `retries=0` restores single-shot.
export async function pingOllama({ timeoutMs = 400, retries = 1, retryTimeoutMs = 1500 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(attempt === 0 ? timeoutMs : retryTimeoutMs) });
      if (r.ok) return true;            // tags answered → up (busy or idle), never down
    } catch { /* transient busy-timeout OR a real down — decide only after the retries are spent */ }
  }
  return false;                        // sustained failure across every attempt = a genuine down
}

// INSTRUMENTED qwen generate. Captures wall-ms AND the ollama token counts (prompt_eval_count +
// eval_count) and logs them. budgetMs bounds the call; within_budget = it finished under budget.
// Returns { ok, ms, prompt_tokens, eval_tokens, within_budget, text, raw }.
export async function qwenGenerate(prompt, { budgetMs = LENS_QWEN_BUDGET_MS, label = 'generate', format = null, options = {} } = {}) {
  const t0 = performance.now();
  let prompt_tokens = 0, eval_tokens = 0, text = '', ok = false, raw = null;
  try {
    const body = { model: MODEL, prompt, stream: false, options: { temperature: 0.2, ...options } };
    if (format) body.format = format;
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(budgetMs),
    });
    if (r.ok) {
      raw = await r.json();
      prompt_tokens = Number(raw.prompt_eval_count || 0);
      eval_tokens = Number(raw.eval_count || 0);
      text = String(raw.response || '');
      ok = true;
    }
  } catch { /* timeout / down → ok stays false */ }
  const ms = +(performance.now() - t0).toFixed(1);
  const within_budget = ok && ms <= budgetMs;
  appendUsage({ task: label, ms, budget_ms: budgetMs, prompt_tokens, eval_tokens, within_budget, ok });
  return { ok, ms, prompt_tokens, eval_tokens, within_budget, text, raw };
}

// THE CONTROL TASK — qwen's second opinion on the on-chip walk's placement. Given the prompt and the
// domain/pixel the walk routed it to, does qwen AGREE the prompt belongs there? A cheap verifier that
// rides in the background; its verdict goes to the next-receipt surface (never blocks the sync answer).
// Returns { verdict:'agree'|'disagree'|'unknown', why, usage }.
export async function verifyPlacement({ prompt, domain, coord, budgetMs = LENS_QWEN_BUDGET_MS } = {}) {
  const p = `You are a routing verifier. A prompt was routed to repo-domain "${domain}" (lattice pixel ${coord}). `
    + `Do you AGREE this is the right domain for the prompt? Output ONLY minified JSON: `
    + `{"verdict":"agree|disagree","why":"<<=12 words>"}. PROMPT: """${String(prompt).slice(0, 400)}"""`;
  const g = await qwenGenerate(p, { budgetMs, label: 'control', format: 'json' });
  let verdict = 'unknown', why = g.ok ? '' : 'qwen unavailable';
  if (g.ok) { try { const o = JSON.parse(g.text || '{}'); verdict = /disagree/i.test(o.verdict) ? 'disagree' : (/agree/i.test(o.verdict) ? 'agree' : 'unknown'); why = String(o.why || ''); } catch { /* keep unknown */ } }
  return { verdict, why, usage: { ms: g.ms, prompt_tokens: g.prompt_tokens, eval_tokens: g.eval_tokens, within_budget: g.within_budget, budget_ms: budgetMs } };
}

// COST METER — the injected additionalContext (input the cloud pays for) + the echoed receipt (output
// the model re-emits). chars/4 token approximation (operator: "chars/4 approx, or a real tokenizer if
// available"). Logged so the per-prompt token COST is on the same ledger as the qwen utilization.
export const approxTokens = (s) => Math.ceil(String(s || '').length / 4);
export function recordCost({ injection = '', receipt = '' } = {}) {
  const input_tokens = approxTokens(injection);
  const output_tokens = approxTokens(receipt);
  appendUsage({ task: 'cost', input_tokens, output_tokens });
  return { input_tokens, output_tokens };
}
