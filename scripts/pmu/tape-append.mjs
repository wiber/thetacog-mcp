#!/usr/bin/env node
// scripts/pmu/tape-append.mjs — THE ONE DOOR ONTO THE TAPE (2026-07-21, the clobbered-SPLIT
// incident: two SPLIT seals vanished because the harvest loop and an ad-hoc sealer both did
// read-modify-write on the shared tape JSON — the loop's older in-memory copy won, and the
// verdict seals survived only in the burn ledger. Same class as the panel-cache clobber:
// a fixed-name shared mutable file with concurrent writers).
//
// Contract: EVERY tape write goes through appendToTape() — exclusive mkdir lock (spin ≤5s),
// re-read the tape FRESH inside the lock, push, write, unlock. A writer that cannot take the
// lock throws (the caller records the failure); it never writes blind. Guard-enforced: no
// timeline_events.push + writeFileSync pair outside this module in the tape's writers.

import { readFileSync, writeFileSync, mkdirSync, rmdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_TAPE = resolve(REPO, 'docs/pmu/attest-flight-tape.json');

function takeLock(LOCK) {
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(LOCK); return; } catch { /* held */ }
    try { if (Date.now() - statSync(LOCK).mtimeMs > 60000) { rmdirSync(LOCK); continue; } } catch { continue; }
    if (Date.now() - t0 > 5000) throw new Error('tape lock not acquired in 5s — writer refused to write blind');
    const until = Date.now() + 50; while (Date.now() < until) { /* spin */ }
  }
}

/**
 * Append one or more states to the tape atomically-enough: fresh read inside the lock, so a
 * concurrent writer's committed appends are never clobbered. `mutate` (optional) receives the
 * fresh tape for callers that must derive fields from current state (e.g. next SPLIT-n seq)
 * and returns the state(s) to push — sequence computation happens INSIDE the lock or not at all.
 */
// AUTO-ARCHIVE (2026-07-21, operator: 'do we need to archive old tapes?' — yes: 698 events =
// 3.4MB tape = a 5.9MB page embedding it). At the ONE DOOR, when the tape exceeds MAX_EVENTS,
// the oldest overflow (never SPLIT states — verdicts stay resident) moves to a dated archive
// file beside the tape, committed like everything else. The archive is append-only history,
// the live tape stays fast, and nothing is ever deleted — 'where is what' includes the past.
const MAX_EVENTS = 600;
const KEEP_RECENT = 400;
function archiveOverflow(tape, TAPE) {
  const ev = tape.timeline_events;
  if (ev.length <= MAX_EVENTS) return null;
  const keepTail = ev.slice(-KEEP_RECENT);
  const head = ev.slice(0, ev.length - KEEP_RECENT);
  const pinned = head.filter((e) => String(e.id || '').startsWith('SPLIT-'));
  const toArchive = head.filter((e) => !String(e.id || '').startsWith('SPLIT-'));
  if (!toArchive.length) return null;
  const stamp = new Date().toISOString().slice(0, 10);
  const archPath = TAPE.replace(/\.json$/, `.archive-${stamp}.json`);
  let arch = { note: 'archived flight-tape events — append-only history, never deleted', timeline_events: [] };
  try { arch = JSON.parse(readFileSync(archPath, 'utf8')); } catch { /* new archive file */ }
  arch.timeline_events.push(...toArchive);
  writeFileSync(archPath, JSON.stringify(arch, null, 1));
  tape.timeline_events = [...pinned, ...keepTail];
  tape.archived_note = `${arch.timeline_events.length} event(s) in ${archPath.split('/').pop()} — full history preserved`;
  return toArchive.length;
}

// C1434 (2026-10-29): `opts.tape` names the tape file — attest-serve passes the one in the directory it SERVES, so a
// stranger's served page and the tape its first walk seeds are one file (the package-root tape 404'd on their cwd). An
// absent tape starts as the empty tape inside the lock; a mutate that returns nothing writes nothing.
export const EMPTY_TAPE = () => ({ kind: 'thetacog-attest-flight-tape', air_gapped: true, llm_in_path: false, network_calls: 0, timeline_events: [] });
export function appendToTape(statesOrMutate, opts = {}) {
  const TAPE = opts.tape ? resolve(opts.tape) : DEFAULT_TAPE;
  const LOCK = TAPE + '.lock';
  takeLock(LOCK);
  try {
    const tape = existsSync(TAPE) ? JSON.parse(readFileSync(TAPE, 'utf8')) : EMPTY_TAPE();
    if (!Array.isArray(tape.timeline_events)) tape.timeline_events = [];
    const out = typeof statesOrMutate === 'function' ? statesOrMutate(tape) : statesOrMutate;
    const list = (Array.isArray(out) ? out : [out]).filter(Boolean);
    if (!list.length) return tape;
    for (const s of list) tape.timeline_events.push(s);
    archiveOverflow(tape, TAPE);
    writeFileSync(TAPE, JSON.stringify(tape, null, 1));
    return tape;
  } finally {
    try { rmdirSync(LOCK); } catch { /* already released */ }
  }
}
