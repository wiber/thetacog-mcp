// packages/thetacog-mcp/scripts/tape/sonnet.mjs — ONE BOUNDED MODEL CALL, ONE PLACE.
//
// Extracted from propose-questions.mjs the moment a SECOND caller needed it (choose-meaningful.mjs).
// CLAUDE.md: extract on FIRST duplication. Two copies of a spawn that strips six environment
// variables and hand-parses a JSON object out of prose is exactly the shape that drifts — and this
// repo has paid for that twice today alone (two panel selectors, two question readers).
//
// WHY THE ENV IS STRIPPED: `claude -p` inherits CLAUDECODE / CLAUDE_CODE_ENTRYPOINT and the
// ANTHROPIC_* credentials from the surrounding session and then hangs. Measured 2026-08-06:
// `env -u CLAUDECODE` alone is NOT enough — every CLAUDE_* and ANTHROPIC_* var has to go.
//
// WHY SONNET AND NOT A LOCAL MODEL: qwen is banned from anything the operator waits on (CLAUDE.md).
// A sequential await-loop over model calls is banned with it — callers fan out with Promise.all.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * One bounded sonnet call that must return a JSON object.
 * Resolves { ok:true, value } or { ok:false, reason } — never throws, never returns a half-answer.
 */
export function sonnetJson(prompt, what, { timeoutMs = 240_000, model = 'sonnet' } = {}) {
  return new Promise((res) => {
    const child = spawn('env', [
      '-u', 'CLAUDECODE', '-u', 'CLAUDE_CODE_ENTRYPOINT',
      '-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_AUTH_TOKEN', '-u', 'ANTHROPIC_BASE_URL',
      // ── HOOKS OFF FOR PROGRAMMATIC CALLS · THIS IS A CORRECTNESS FIX, NOT ONLY A SPEED ONE ──
      // `claude -p` fires UserPromptSubmit hooks, and this repo's hook is the full PMU lens. So
      // every programmatic call was (a) paying the interactive lens cost and (b) receiving the
      // lens's own OUTPUT CONTRACT — which demands a verbatim receipt block and a trailing sidecar
      // line. Measured 2026-08-21 on a prompt that said "Reply with only this JSON: {"ok":true}":
      //
      //   without override : 176s, and the reply ended
      //                      "…· UNUSED: never-commit-hooks-off · DRIFT-CAUGHT: none"
      //   with  override   :  68s, reply exactly {"ok":true}
      //
      // The model was answering the LENS rather than the caller. Every JSON contract in this
      // package — proposals, repairs, the meaningfulness choice — was being scored against a
      // response shaped by an instruction the caller never sent.
      //
      // Of the remaining 68s, time_to_request_ms is ~60s: startup (CLAUDE.md auto-discovery, plugin
      // sync, prefetches). `--bare` removes that too, but it also forces ANTHROPIC_API_KEY auth,
      // and this repo strips those vars deliberately — so the startup cost is NAMED here rather
      // than silently absorbed. It is the next thing to cut.
      'claude', '-p', prompt, '--model', model, '--output-format', 'json',
      '--settings', '{"hooks":{}}',
    ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      res({ ok: false, reason: `${what} timed out at ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); res({ ok: false, reason: `${what} could not spawn: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return res({ ok: false, reason: `${what} exited ${code}: ${String(err).trim().slice(0, 160) || '(fatal on stdout)'}` });
      let text = out;
      try { text = String(JSON.parse(out).result || out); } catch { /* raw */ }
      const m = String(text).replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
      if (!m) return res({ ok: false, reason: `${what} returned no JSON object (got: ${String(text).trim().slice(0, 120)})` });
      try { res({ ok: true, value: JSON.parse(m[0]) }); }
      catch (e) { res({ ok: false, reason: `${what} JSON did not parse: ${String(e.message).slice(0, 120)}` }); }
    });
  });
}
