// scripts/rewrite/llm.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE TWO ENGINES.
//
//   local()  → ollama /api/generate (qwen2.5:7b by default). No API key, no
//              watermark, no network. This is the model that SHREDS the token
//              biasing, because its vocabulary distribution has nothing to do
//              with the upstream green list.
//   cloud()  → headless `claude -p --output-format json`. The capable writer.
//
// Two hard-won conventions inherited from scripts/ghost-read-async.mjs:
//   • `env -u CLAUDECODE` before every claude spawn. Inside a Claude Code
//     session that variable is set, and a nested claude sees it and refuses /
//     misbehaves. Unsetting it is what makes nesting work at all.
//   • Every call is timeout-bounded and NEVER throws upward as a crash — a
//     dead track returns {ok:false} so the other three still populate the card.
//     A rewrite UI that stalls because one model hiccupped is worthless.
// ════════════════════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process';
import path from 'node:path';
import { localLimit, cloudLimit, uiLimit } from './limiter.mjs';

const OLLAMA_BASE = process.env.OLLAMA_HOST_URL || 'http://localhost:11434';
export const LOCAL_MODEL = process.env.REWRITE_LOCAL_MODEL || 'qwen2.5:7b';
export const CLOUD_MODEL = process.env.REWRITE_CLOUD_MODEL || 'sonnet';

// ── THE REPO'S HARD RULE (CLAUDE.md §"QWEN IS BANNED FROM ACTIVE TASKS", 2026-07-28) ──
// "A local qwen call on the interactive path is BANNED. qwen is for hook-triggered /
//  async / background work ONLY. Any reader-monologue, ghost-read, grading-input or
//  writing task that the operator is WAITING ON runs as PARALLEL SONNET SUBAGENTS."
//
// The writer IS waiting on the card stack, so Sonnet owns the interactive path and the
// local tracks are strictly best-effort. The local budget is therefore SHORT and
// non-negotiable: a slow local model must never hold up a card. It drops out, its
// latency is recorded as a metric (that timing is part of the A/B result), and the
// card ships with whatever tracks answered.
const LOCAL_TIMEOUT = Number(process.env.REWRITE_LOCAL_TIMEOUT_MS || 45_000);
const CLOUD_TIMEOUT = Number(process.env.REWRITE_CLOUD_TIMEOUT_MS || 180_000);

/**
 * APERTURE SIZING — fit the context window to the actual input.
 *
 * A fixed `num_ctx: 8192` allocates an 8192-token KV cache for every call, and the
 * diagnostic aperture is ~345 tokens on average (max ~1045 across chapter 12). That
 * is a 13x oversized allocation per request, paid on every scan, and on Metal it is
 * the difference between a usable scanner and one that times out. Size the window to
 * the aperture — the same principle the Rust pipeline applies to minimise input
 * entropy — instead of pinning it wide and hoping.
 */
function apertureCtx(prompt, reserveOut = 700) {
  const tokens = Math.ceil(prompt.length / 3.6) + reserveOut; // 3.6 chars/token, conservative
  for (const size of [1024, 2048, 4096, 8192, 16384]) if (tokens <= size) return size;
  return 32768;
}

/** ── LOCAL: ollama ──────────────────────────────────────────────────────── */
export async function local(prompt, opts = {}) {
  const lane = opts.interactive ? uiLimit : localLimit;
  return lane.run(() => localCall(prompt, opts));
}

async function localCall(prompt, { model = LOCAL_MODEL, json = false, temperature = 0.7, timeout = LOCAL_TIMEOUT, numCtx } = {}) {
  const t0 = Date.now();
  const num_ctx = numCtx || apertureCtx(prompt);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        ...(json ? { format: 'json' } : {}),
        options: { temperature, num_ctx },
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return { ok: false, error: `ollama ${res.status}`, ms: Date.now() - t0, model };
    const body = await res.json();
    return { ok: true, text: (body.response || '').trim(), ms: Date.now() - t0, model };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), ms: Date.now() - t0, model };
  }
}

// NEUTRAL CWD — measured 2026-08-11: the identical prompt takes 118s when claude
// runs inside this repo and 34s from an empty directory. `claude -p` loads the
// project's CLAUDE.md, skills, and MCP servers on every invocation, and this repo's
// context is enormous. Every prompt we send is fully self-contained — the model
// never needs to read a repo file — so running from a scratch directory is a 3.5x
// speedup for free. Callers that genuinely need repo context pass an explicit cwd.
import os from 'node:os';
import fsSync from 'node:fs';
const NEUTRAL_CWD = (() => {
  const d = path.join(os.tmpdir(), 'rewrite-neutral-cwd');
  try { fsSync.mkdirSync(d, { recursive: true }); } catch {}
  return d;
})();

/** ── CLOUD: headless claude -p ──────────────────────────────────────────── */
export async function cloud(prompt, opts = {}) {
  // `interactive` — a human is watching a spinner. Use the small separate lane so the press does not
  // queue behind the buffer fill, and so its clock is not spent sharing the CPU with three batch walks.
  const lane = opts.interactive ? uiLimit : cloudLimit;
  return lane.run(() => cloudCall(prompt, opts));
}

function cloudCall(prompt, { model = CLOUD_MODEL, timeout = CLOUD_TIMEOUT, cwd = NEUTRAL_CWD } = {}) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    // `env -u CLAUDECODE` — see header. Without it a nested claude inherits the
    // parent session marker and the call does not behave as a clean headless run.
    const child = spawn(
      'env',
      // ALSO UNSET THE API KEY (2026-08-12). The Next dev server loads .env.local into process.env,
      // so a spawned `claude` inherited ANTHROPIC_API_KEY and switched off the claude.ai login it was
      // meant to use: "connectors are disabled because ANTHROPIC_API_KEY … takes precedence over your
      // claude.ai login", then exit 1 after ~181s. Measured side by side, same prompt, same model:
      // 32s and a clean answer from a shell without the key, 181s and a failure from the server with
      // it. The packaged console never saw the bug because nothing there reads .env.local — which is
      // exactly why it looked like a model problem rather than an environment one.
      ['-u', 'CLAUDECODE', '-u', 'CLAUDE_CODE_ENTRYPOINT',
       '-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_AUTH_TOKEN', '-u', 'ANTHROPIC_BASE_URL',
       'claude', '-p', prompt,
       '--model', model, '--output-format', 'json'],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '', err = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      done({ ok: false, error: `timeout after ${timeout}ms`, ms: Date.now() - t0, model });
    }, timeout);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => done({ ok: false, error: String(e.message), ms: Date.now() - t0, model }));
    child.on('close', (code) => {
      if (code !== 0) {
        return done({ ok: false, error: `claude exit ${code}: ${err.slice(0, 400)}`, ms: Date.now() - t0, model });
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return done({ ok: false, error: String(parsed.result || 'claude error'), ms: Date.now() - t0, model });
        done({
          ok: true,
          text: String(parsed.result || '').trim(),
          ms: Date.now() - t0,
          model,
          costUsd: parsed.total_cost_usd ?? null,
        });
      } catch {
        // Not JSON — fall back to raw stdout so a format change degrades instead of dying.
        const text = out.trim();
        if (text) return done({ ok: true, text, ms: Date.now() - t0, model, costUsd: null });
        done({ ok: false, error: 'unparseable claude output', ms: Date.now() - t0, model });
      }
    });
  });
}

/**
 * Pull the first JSON value out of a model response. Models wrap JSON in prose,
 * fences, or preamble no matter how firmly you ask them not to; this recovers it
 * rather than discarding an otherwise-good generation.
 */
export function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);

  for (const c of candidates) {
    const trimmed = c.trim();
    try { return JSON.parse(trimmed); } catch {}
    // Scan for a balanced {...} or [...] island.
    for (const open of ['{', '[']) {
      const close = open === '{' ? '}' : ']';
      const s = trimmed.indexOf(open);
      if (s < 0) continue;
      let depth = 0, inStr = false, esc = false;
      for (let i = s; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === open) depth++;
        else if (ch === close) {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(trimmed.slice(s, i + 1)); } catch { break; }
          }
        }
      }
    }
  }
  return null;
}

/** Health probe for both engines — the UI shows this so a dead track is visible, not silent. */
export async function health() {
  const [ol, cl] = await Promise.all([
    // Generous: under 4 concurrent scans ollama takes seconds to answer /api/tags,
    // and a 4s probe reported a perfectly healthy engine as DOWN.
    fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json())
      .then((j) => ({ ok: true, models: (j.models || []).map((m) => m.name) }))
      .catch((e) => ({ ok: false, error: String(e.message) })),
    new Promise((resolve) => {
      const c = spawn('env', ['-u', 'CLAUDECODE', 'claude', '--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let o = '';
      const t = setTimeout(() => { try { c.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, 10_000);
      c.stdout.on('data', (d) => { o += d; });
      c.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message) }); });
      c.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? { ok: true, version: o.trim() } : { ok: false, error: `exit ${code}` }); });
    }),
  ]);
  return {
    local: { ...ol, model: LOCAL_MODEL, available: ol.ok && (ol.models || []).includes(LOCAL_MODEL) },
    cloud: { ...cl, model: CLOUD_MODEL, available: cl.ok },
  };
}
