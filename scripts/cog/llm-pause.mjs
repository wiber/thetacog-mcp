#!/usr/bin/env node
// scripts/cog/llm-pause.mjs — IS THE LLM HOLD LIVE? One reader, importable by anything.
// =============================================================================================
// `.thetacog/llm-pause` holds every ollama-driven lane while the operator decides whether to
// resume. The file states its own purpose: "the lift is what needs a person: resuming
// spec-reply-execute, gcal-agent/poll-execute, cos-overnight, whatsapp-cos and calendar-primer
// starts spending again, and the operator had not asked for that."
//
// MEASURED 2026-08-24, and the numbers are why this exists. On a machine 92.5% into swap, with
// Safari's AppleScript bridge taking 107 SECONDS to answer, `ollama ps` showed qwen2.5:7b resident
// at 4.9 GB on the GPU and 1.8 GB of RSS — loaded sixty seconds earlier by a comms send, with the
// hold live until 2026-08-26. Eight scripts invoke ollama and not one consulted the file.
// Stopping the model returned ollama from 1,832 MB to 98 MB.
//
// A SEPARATE MODULE ON PURPOSE. ollama-monologue.mjs does its work at import time — reading argv,
// exiting on a missing --file — so anything importing it runs a CLI. This repo has paid for that
// shape before: a guard test's own import of transcript-ingest.mjs ran the CLI and wrote 207 turns
// into the live store. A pause reader that cannot be imported without side effects is a pause
// reader nobody can test, and an untested gate is the kind that quietly stops gating.
//
// READ ONLY. Lifting the hold is the operator's decision, which is what the file says it is
// waiting for. Nothing here writes, expires, or removes it.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check as sessionIdleCheck, IDLE_MS } from '../ops/session-idle.mjs';
import { heavyHolder } from '../vna/heavy-lock.mjs';   // C292: a bench on local metal holds the ollama lane for automatic callers
import { alive } from '../vna/steer-lock.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAUSE_FILE = resolve(REPO, '.thetacog/llm-pause');

// THE ACTIVE-SESSION HOLD (operator 2026-09-15): "kill all the llama or qwen runners … in the future we
// need to turn them on 45 minutes after the last prompt … don't run them during active sessions."
// Measured the same evening: the postman drain fanned three ghost-reads out through llm-prompt.sh at
// once, each an `ollama run qwen2.5:7b`, while an interactive cook was reading with qwen3:8b — the
// models swapped on every paragraph and the machine crawled. The construct for "active" already
// exists and is guarded: scripts/ops/session-idle.mjs — the last HUMAN turn across every room
// (machine-issued turns excluded), 45 minutes. This is the same reader, applied to the local-model
// lane: a local model runs only when the operator has been quiet for IDLE_MS. Cloud lanes (claude -p)
// are not held by this — they do not lock the GPU. LLM_ACTIVE_OK=1 is the explicit interactive
// override, for the turn where the operator asks for a local read by name.
export function activeSession({ now = Date.now(), idleMs = IDLE_MS } = {}) {
  if (process.env.LLM_ACTIVE_OK === '1') return null;
  try {
    const d = sessionIdleCheck({ now, idleMs });
    if (d.humanAt == null || d.idleFor == null) return null;      // no human turn on record — not active
    if (d.idleFor >= idleMs) return null;
    const until = new Date(Date.parse(d.humanAt) + idleMs).toISOString();
    return { until, humanAt: d.humanAt, idleFor: d.idleFor, reason: `active session — last human prompt ${Math.round(d.idleFor / 60000)} min ago; local models run ${Math.round(idleMs / 60000)} min after the last prompt (operator 2026-09-15). LLM_ACTIVE_OK=1 overrides for an explicit ask.` };
  } catch {
    return null;   // a broken transcript scan must degrade to "not held" — the file hold still stands on its own
  }
}

/**
 * The live hold, or null. `{ until, reason }` when held.
 *
 * READS THE `until` FIELD, never a date scraped out of the prose. predict-leverage.mjs made
 * exactly that mistake on this same file and graded a live hold as four days past expiry: it
 * regexed ISO dates out of the body with a trailing word boundary, and "2026-08-26T12:00:00Z" has
 * no boundary between the date and the `T`, so the only date that mattered was the only one it
 * could not see. Every date it did see came from the sentences explaining the hold.
 */
// C216 — THE HOLDS STOP THE AUTO-FIRE, NEVER THE OPERATOR'S OWN ASK (operator 2026-09-23, verbatim: "conditionalise both … we
// have tokens, and its the auto fire of the models while active session I asked to stop"). `explicit: true` is a run the
// operator started by name — /steer from the terminal, the 💬 chat, or the chair acting on his ask. Neither the active-session
// quiet nor the pause file holds it. Every automatic caller (hooks, tick, postman, idle fires) passes nothing and stays held.
export function llmPauseActive(file = PAUSE_FILE, { lane = 'ollama', explicit = false } = {}) {
  if (explicit) return null;
  let held = null;
  try {
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      if (!raw.trim()) {
        // THE LEGACY MARKER: the original form was a bare `touch .thetacog/llm-pause`. An EMPTY file is that
        // marker and holds — failing toward "held" is the safe direction for a file whose whole purpose is to
        // stop spending (llm-prompt.sh made this call on 2026-08-24 for 39 callers; this is the one reader now).
        held = { until: 'legacy-marker', reason: 'bare-touch pause marker — rm .thetacog/llm-pause to resume' };
      } else {
        const s = JSON.parse(raw);
        if (s && typeof s.until === 'string' && Date.parse(s.until) > Date.now()) held = { until: s.until, reason: s.reason || null };
      }
    }
  } catch {
    held = null;   // a CORRUPT (non-empty, non-JSON) hold degrades to "not held", never wedges every caller
  }
  if (held) return held;
  // The active-session hold binds the LOCAL lane only.
  if (lane !== 'ollama') return null;
  return activeSession() || benchHold();
}

// C292 — AN AUTOMATIC CALLER NEVER LOADS A MODEL BESIDE A BENCH (operator 2026-09-25, verbatim: "Enforce a mutex so that heavy
// verification jobs … and model benchmarks never run simultaneously on local metal."). Measured the same morning: while
// replay-bench's trial ran, each commit's post-commit region-narrative loaded qwen2.5:7b next to the worker's qwen3:8b (two
// runners resident, load 224). The heavy lock (C287) is held by the bench; while a LIVE pid holds it, the ollama lane is held
// for every automatic caller. An explicit ask (explicit:true) returned above and is never held by this.
export function benchHold({ holder = heavyHolder(), isAlive = alive } = {}) {
  if (!holder || !isAlive(holder.pid)) return null;
  return { until: 'heavy-lock-release', reason: `heavy job running — ${holder.job || 'bench'} pid ${holder.pid} since ${holder.started_at}; automatic local-model callers wait for it (C292)` };
}

const IS_CLI = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_CLI) {
  const li = process.argv.indexOf('--lane');
  const held = llmPauseActive(PAUSE_FILE, { lane: li >= 0 ? process.argv[li + 1] : 'ollama' });
  if (held) {
    console.log(`⏸  HELD until ${held.until}`);
    if (held.reason) console.log(`   ${held.reason.slice(0, 300)}`);
    process.exit(10);            // 10 = held, so a shell caller can branch without parsing text
  }
  console.log('▶️  not held');
  process.exit(0);
}
