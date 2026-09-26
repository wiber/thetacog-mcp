#!/usr/bin/env node
// scripts/ops/session-idle.mjs — WHEN DID THE WORK SESSION END?
//
// WHY (operator 2026-08-24): the prompt digest fires on a clock — four fixed times a day — so
// it lands in the middle of work as often as at the end of it. The moment worth mailing is the
// one the clock cannot see: the operator stopped typing. "if no cc prompt input by me has been
// done in the last 45 min, email me all actions since the last email of that kind ... the cycle
// is meant to make elicitation easier."
//
// THE TWO CONSTRUCTS THIS FILE EXISTS TO GET RIGHT, both of which a naive version gets wrong:
//
// 1. "INPUT BY ME" IS NOT "A USER TURN". A third of the turns in this repo's transcripts are
//    issued by programs — room-agent dispatches, shoot-kit fan-outs, spec templates, the
//    harness's own compaction handoff. Every one of them arrives as a `type:'user'` record. If
//    those reset the idle clock, a machine keeps the session open forever and this never fires;
//    if they are miscounted the other way, a real ask gets swallowed. machineIssued() from
//    room-context.mjs already computes that split and is guarded in both directions.
//
// 2. FIRING ONCE IS A PROPERTY OF THE SESSION, NOT OF THE CLOCK. A tick every 5 minutes over an
//    8-hour overnight gap would send 96 emails. The naive fix — "don't fire if we fired in the
//    last N hours" — is a proxy, and it drops the real second session when the operator works
//    twice in an evening. The construct is: a close is IDENTIFIED BY THE TIMESTAMP OF THE LAST
//    HUMAN TURN. Fire once per distinct value. Type again and that value moves, so the next
//    quiet period is genuinely a different close and mails again. No cooldown, no clock guard,
//    no drift.
//
// THE STATE IS A LEDGER, NOT A FLAG (AXIOM 1). Every fire appends {at, humanAt, since} — so
// "when did the last session close" is a retained record rather than something recomputed from
// an artifact that already moved. `since` is what the next email means by "all actions since
// the last email of that kind"; without the retained value there is no honest answer to it.
//
// CLI:
//   node scripts/ops/session-idle.mjs --check          # print the decision as JSON, change nothing
//   node scripts/ops/session-idle.mjs --check --verbose
//   node scripts/ops/session-idle.mjs --commit-fire    # record a fire (called BY the cycle, after it sends)
//
// Guard: tests/ops/session-idle.test.mjs — a simulated clock walked minute by minute.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTurns, PROJECT_DIR } from './prompt-digest.mjs';
import { machineIssued } from './room-context.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STATE_PATH = process.env.SESSION_CLOSE_STATE
  || join(REPO, '.thetacog', 'session-close', 'state.json');

export const IDLE_MS = Number(process.env.SESSION_IDLE_MS) || 45 * 60 * 1000;
// First-ever run has no retained `since`. Twelve hours is the honest default: it covers a full
// working day without claiming to summarise history the ledger never recorded.
export const COLD_START_LOOKBACK_MS = 12 * 3600 * 1000;

// ── humanTurns: the turns a PERSON typed. Everything machineIssued() catches is excluded, and
// so is anything that scrubbed to nothing upstream (extractTurns already drops those).
export function humanTurns(turns) {
  if (!turns.length) return [];
  const isMachine = machineIssued(turns);
  return turns.filter(t => !isMachine(t));
}

// ── lastHumanAt: the newest human turn's timestamp, or null. A record timestamped in the FUTURE
// is clock skew, not input — clamped to `now` so a bad clock cannot hold the session open
// forever (it would otherwise read as "typed 3 minutes from now", idle for negative time).
export function lastHumanAt(turns, now = Date.now()) {
  let best = null;
  for (const t of humanTurns(turns)) {
    const ts = Math.min(t.ts, now);
    if (best === null || ts > best) best = ts;
  }
  return best;
}

export function loadState(path = STATE_PATH) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { fires: [] }; }
}
export function saveState(state, path = STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const keep = { ...state, fires: (state.fires || []).slice(-40) };
  writeFileSync(path, JSON.stringify(keep, null, 1));
  return keep;
}

// ── decideSessionClose: THE PURE CORE. No fs, no clock of its own, no model. Everything the
// cycle does downstream is a consequence of this one answer, which is why it is the thing the
// simulation walks minute by minute.
export function decideSessionClose({ turns = [], now = Date.now(), state = {}, idleMs = IDLE_MS } = {}) {
  const humanAt = lastHumanAt(turns, now);
  if (humanAt === null) {
    return { fire: false, reason: 'no human-typed turn in the scanned window', humanAt: null, idleMs: null };
  }
  const idleFor = now - humanAt;
  if (idleFor < idleMs) {
    return {
      fire: false, reason: 'still working', humanAt: new Date(humanAt).toISOString(),
      idleFor, idleMs, waitMs: idleMs - idleFor,
    };
  }
  const humanIso = new Date(humanAt).toISOString();
  if (state.lastFiredForHumanAt === humanIso) {
    return {
      fire: false, reason: 'this session close was already mailed', humanAt: humanIso,
      idleFor, idleMs, firedAt: state.lastFiredAt || null,
    };
  }
  // `since` is the retained boundary of the LAST email of this kind — never recomputed from the
  // window, because the window is a different question ("last 6h") from this one ("since I last
  // told you"). Cold start falls back, and says so, rather than pretending to a boundary.
  const coldStart = !state.lastFiredAt;
  const since = coldStart ? new Date(now - COLD_START_LOOKBACK_MS).toISOString() : state.lastFiredAt;
  return {
    fire: true, reason: coldStart ? 'first session close on record' : 'session went quiet',
    humanAt: humanIso, idleFor, idleMs, since, coldStart,
    sinceMs: Date.parse(since),
  };
}

// ── nextState: PURE. The state after a fire. Kept separate from the disk write so the
// simulation can walk a thousand ticks of a scripted day without touching a filesystem — the
// only way to know this is solid is to run the clock, and a simulator that needs real files is
// a simulator nobody runs.
export function nextState(decision, { at = Date.now(), state = {}, extra = {} } = {}) {
  const atIso = new Date(at).toISOString();
  return {
    ...state,
    lastFiredAt: atIso,
    lastFiredForHumanAt: decision.humanAt,
    fires: [...(state.fires || []), { at: atIso, humanAt: decision.humanAt, since: decision.since, ...extra }],
  };
}

// ── recordFire: append the countable event to disk. Called by the cycle AFTER the send
// succeeds — a fire recorded before the send would evict the record of an email that never
// went out, and the next email's `since` would then skip everything the failed one covered.
export function recordFire(decision, { at = Date.now(), state = null, path = STATE_PATH, extra = {} } = {}) {
  return saveState(nextState(decision, { at, state: state || loadState(path), extra }), path);
}

// ── recentRecords: parse ONLY the transcripts that can contain a recent turn. An append-only
// jsonl's mtime bounds its newest record from above — a file untouched for six hours cannot
// hold a turn from five minutes ago — so this is the property itself, not a stand-in for it.
// It is what makes a five-minute tick cost milliseconds instead of re-parsing 100MB+.
export function recentRecords(sinceMs, dir = PROJECT_DIR, slackMs = 3600e3) {
  const records = [];
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return records; }
  for (const f of files) {
    const p = join(dir, f);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.mtimeMs < sinceMs - slackMs) continue;
    let raw; try { raw = readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* partial line */ }
    }
  }
  records.sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0));
  return records;
}

// ── check: the tick's whole job. Cheap enough to run every few minutes.
export function check({ now = Date.now(), idleMs = IDLE_MS, statePath = STATE_PATH, dir = PROJECT_DIR } = {}) {
  // Scan back four idle windows: long enough to always contain the last human turn when one
  // exists nearby, short enough that the machineIssued template count stays meaningful.
  const scanSince = now - Math.max(6 * 3600e3, idleMs * 4);
  const turns = extractTurns(recentRecords(scanSince, dir), scanSince);
  return { ...decideSessionClose({ turns, now, state: loadState(statePath), idleMs }), scanned: turns.length };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--commit-fire')) {
    const d = check();
    if (!d.fire) { console.error('refusing to record a fire that was not due: ' + d.reason); process.exit(2); }
    recordFire(d);
    console.log(JSON.stringify({ recorded: true, humanAt: d.humanAt, since: d.since }));
    return;
  }
  const d = check();
  if (argv.includes('--verbose')) {
    const mins = (ms) => (ms == null ? '—' : `${Math.round(ms / 60000)}m`);
    console.error(`session-idle: fire=${d.fire} · ${d.reason} · last human ${d.humanAt || '—'} · idle ${mins(d.idleFor)} of ${mins(d.idleMs)} · scanned ${d.scanned} turns`);
  }
  console.log(JSON.stringify(d, null, 1));
  process.exit(d.fire ? 0 : 1);       // exit 0 ONLY when the cycle should run — the shell gate
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
