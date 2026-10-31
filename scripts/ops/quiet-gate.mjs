#!/usr/bin/env node
// scripts/ops/quiet-gate.mjs — MAY BACKGROUND LOCAL COMPUTE RUN RIGHT NOW?
//
// WHY (operator 2026-08-30): "end the qwen during active sessions — we need a flag — qwen and
// thetacog ticks can run after 45 [minutes of] a session ends." Measured while he said it:
// qwen2.5:7b resident at 4.9 GB on the GPU, loaded by a background tick, during an active
// interactive session. The interactive loop is action→reaction; a background job that takes the
// GPU and four performance cores mid-thought spends the window the work needed.
//
// ══════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CONSTRUCT THIS FILE EXISTS TO GET RIGHT, and the reason it is not three lines inside
// session-idle.mjs:
//
//   session-idle.mjs is EDGE-TRIGGERED. It answers "did a session just close?" and fires ONCE
//   per close, keyed by the timestamp of the last human turn, so a 10-hour overnight gap mails
//   one email instead of 120. That once-per-close ledger is exactly right for an email.
//
//   A GATE IS LEVEL-TRIGGERED. It answers "is it quiet RIGHT NOW", every time it is asked, with
//   no memory at all. Reusing decideSessionClose() here would be a category error with a very
//   specific failure: the moment the session-close email went out, `lastFiredForHumanAt` matches
//   and the decision flips to fire:false — so the gate would SLAM SHUT on the entire quiet
//   period, which is the only time background work is supposed to run. Backwards, and green.
//
//   So this shares the SIGNAL (lastHumanAt — the already-guarded human-vs-machine turn split,
//   which is the genuinely hard half) and shares the THRESHOLD (IDLE_MS, one number, one place),
//   and deliberately does not share the ledger.
//
// WHY NOT A CACHE. This is asked by every gated tick, and lastHumanAt costs ~0.3s because it
// parses only the transcripts whose mtime can still hold a recent turn. A short-TTL cache would
// shave that — and would make the gate answer "quiet" for the first N seconds AFTER the operator
// starts typing, which is precisely the direction the complaint is about. A gate that is wrong in
// the only direction that matters is not an optimisation. 0.3s at a 5-minute cadence is free.
//
// THIS IS A SIBLING OF .thetacog/llm-pause, NEVER A MERGE. That flag is the CLAUDE BUDGET axis
// ("stop spending"), it is lifted by a person, and it explicitly does not gate local qwen — every
// $0 local lane says so in its own header. This is the CONTENTION axis ("not while I am typing"),
// it lifts itself after 45 quiet minutes, and it gates local compute above all. Two questions,
// two flags. A script may be held by either, for different reasons, and must consult both.
//
// EXIT CODES — 75 (EX_TEMPFAIL) is "no, try next tick", the convention scripts/ops/slot.sh
// already established. A launchd job that exits 75 has not failed; its work is idempotent and
// the next tick picks it up.
//
// CLI:
//   node scripts/ops/quiet-gate.mjs --check     # exit 0 = quiet (run) · 75 = active (skip)
//   node scripts/ops/quiet-gate.mjs --status    # human-readable, always exit 0
//   node scripts/ops/quiet-gate.mjs off  --ttl 2h   # THE FLAG: never gate (background always ok)
//   node scripts/ops/quiet-gate.mjs hold --ttl 3h   # THE FLAG: always gate (leave me alone)
//   node scripts/ops/quiet-gate.mjs auto            # back to the 45-minute rule
//
// Guard: tests/ops/quiet-gate.test.mjs — walked in BOTH directions on a simulated clock.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTurns, PROJECT_DIR } from './prompt-digest.mjs';
import { lastHumanAt, recentRecords, IDLE_MS } from './session-idle.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const FLAG_PATH = process.env.QUIET_GATE_FLAG
  || join(REPO, '.thetacog', 'quiet-gate.json');

// ONE THRESHOLD, ONE PLACE. The 45 minutes is session-idle.mjs's IDLE_MS — the same number the
// session-close email uses, because "the session ended" must not mean two different things.
export const QUIET_MS = Number(process.env.QUIET_GATE_IDLE_MS) || IDLE_MS;

export const MODES = ['auto', 'off', 'hold'];

// ── readFlag: the persisted mode, with its own expiry. An EXPIRED flag reads as `auto`, never as
// itself: a "leave me alone" hold that outlives the afternoon it was set for is an outage with a
// label on it — the exact failure .thetacog/llm-pause suffered for thirty-six days, where a file
// declaring its own reset date on line 2 held four stages dark because nothing ever read it.
export function readFlag(file = FLAG_PATH, now = Date.now()) {
  const envMode = (process.env.THETACOG_QUIET_GATE || '').trim().toLowerCase();
  if (MODES.includes(envMode)) return { mode: envMode, source: 'env', until: null };
  try {
    if (!existsSync(file)) return { mode: 'auto', source: 'default', until: null };
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (!MODES.includes(s?.mode)) return { mode: 'auto', source: 'default', until: null };
    if (s.until && Date.parse(s.until) <= now) {
      return { mode: 'auto', source: 'expired', until: s.until, expiredFrom: s.mode };
    }
    return { mode: s.mode, source: 'file', until: s.until || null, reason: s.reason || null };
  } catch {
    return { mode: 'auto', source: 'default', until: null };  // unreadable degrades to the rule
  }
}

export function writeFlag(mode, { ttlMs = null, reason = null, file = FLAG_PATH, now = Date.now() } = {}) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join('|')}`);
  if (mode === 'auto') { try { unlinkSync(file); } catch {} return { mode: 'auto', until: null }; }
  const rec = { mode, until: ttlMs ? new Date(now + ttlMs).toISOString() : null, reason, setAt: new Date(now).toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rec, null, 1));
  return rec;
}

// ── decideQuiet: THE PURE CORE. No fs, no clock of its own, no model. Level-triggered by
// construction — the same inputs always give the same answer, and nothing here remembers that it
// was asked before.
export function decideQuiet({ humanAt = null, now = Date.now(), flag = { mode: 'auto' }, quietMs = QUIET_MS } = {}) {
  if (flag.mode === 'off') {
    return { quiet: true, reason: 'gate disabled (mode=off) — background work always admitted', mode: 'off', flag };
  }
  if (flag.mode === 'hold') {
    return { quiet: false, reason: 'gate held open (mode=hold) — background work refused until lifted', mode: 'hold', flag };
  }
  if (humanAt === null) {
    // No human turn in the scanned window means nobody has typed for at least as long as the
    // window — which is longer than the threshold. Quiet, and honest about why.
    return { quiet: true, reason: 'no human-typed turn in the scanned window', mode: 'auto', humanAt: null, flag };
  }
  const idleFor = now - humanAt;
  const humanIso = new Date(humanAt).toISOString();
  if (idleFor >= quietMs) {
    return { quiet: true, reason: 'session quiet', mode: 'auto', humanAt: humanIso, idleFor, quietMs, flag };
  }
  return {
    quiet: false, reason: 'session ACTIVE — operator typed recently', mode: 'auto',
    humanAt: humanIso, idleFor, quietMs, waitMs: quietMs - idleFor, flag,
  };
}

// ── check: the whole job. Same mtime-bounded scan session-idle uses, so a tick costs ~0.3s.
export function check({ now = Date.now(), quietMs = QUIET_MS, dir = PROJECT_DIR, file = FLAG_PATH } = {}) {
  const flag = readFlag(file, now);
  // A flag that already decides the answer must not pay for a transcript scan. `off` and `hold`
  // are terminal, so the scan is skipped entirely — this is what makes the escape hatch cheap
  // enough to leave on.
  if (flag.mode !== 'auto') return { ...decideQuiet({ now, flag, quietMs }), scanned: 0 };
  const scanSince = now - Math.max(6 * 3600e3, quietMs * 4);
  const turns = extractTurns(recentRecords(scanSince, dir), scanSince);
  const humanAt = lastHumanAt(turns, now);
  return { ...decideQuiet({ humanAt, now, flag, quietMs }), scanned: turns.length };
}

function parseTtl(s) {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd])?$/i.exec(String(s || '').trim());
  if (!m) return null;
  const mult = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[(m[2] || 'm').toLowerCase()];
  return Number(m[1]) * mult;
}
const mins = (ms) => (ms == null ? '—' : `${Math.round(ms / 60000)}m`);

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find(a => MODES.includes(a));
  if (mode) {
    const ti = argv.indexOf('--ttl');
    const ttlMs = ti >= 0 ? parseTtl(argv[ti + 1]) : null;
    const ri = argv.indexOf('--reason');
    const rec = writeFlag(mode, { ttlMs, reason: ri >= 0 ? argv[ri + 1] : null });
    console.log(`quiet-gate: mode=${rec.mode}${rec.until ? ` until ${rec.until}` : ' (no expiry)'}`);
    if (mode === 'off' && !ttlMs) {
      console.log('note: no --ttl, so this holds until you set it back to `auto`. A flag with no timer is the shape that gets forgotten.');
    }
    return;
  }
  const d = check();
  if (argv.includes('--status') || argv.includes('--verbose')) {
    const icon = d.quiet ? '🟢' : '🔴';
    console.error(`${icon} quiet-gate: ${d.quiet ? 'QUIET — background work may run' : 'ACTIVE — background work refused'}`);
    console.error(`   ${d.reason} · mode=${d.mode}${d.flag?.until ? ` until ${d.flag.until}` : ''}${d.flag?.source ? ` (${d.flag.source})` : ''}`);
    if (d.humanAt) console.error(`   last human turn ${d.humanAt} · idle ${mins(d.idleFor)} of ${mins(d.quietMs)}${d.waitMs ? ` · ${mins(d.waitMs)} to go` : ''}`);
    if (d.flag?.source === 'expired') console.error(`   (a ${d.expiredFrom} flag expired at ${d.flag.until} — back on the ${mins(QUIET_MS)} rule)`);
  }
  if (argv.includes('--status')) { console.log(JSON.stringify(d, null, 1)); return; }
  console.log(JSON.stringify(d, null, 1));
  process.exit(d.quiet ? 0 : 75);   // 75 = EX_TEMPFAIL, the slot.sh convention: try next tick
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
