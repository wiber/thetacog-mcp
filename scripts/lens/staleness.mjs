#!/usr/bin/env node
// scripts/lens/staleness.mjs — THE STALENESS FIELD.
// =============================================================================
// `.thetacog/lens-traction.json` read {verdict:"HEALTHY", iterations:8, driftTrend:"flat",
// driftSeq:[0,0,0,0,0,0,0,0]} and carried no timestamp at all, so a gardener that had stopped
// thirty minutes ago and one that had stopped in July emitted the same eleven fields.
// `.thetacog/lens-reef-health.json` carried {reef_health, optimal_rule_count, ts:<epoch>} — a raw
// epoch with no declared period, so the only code that could judge it was the one function that
// happened to hardcode the TTL (prompt-lens.mjs REEF_HEALTH_TTL_MS). Every other reader saw a
// number with no way to know whether it was current.
//
// A health readout that reports its last computed value and not its age cannot distinguish a
// steady tick from a stopped clock. This module makes the age computable from the artifact alone:
// the writer stamps `last_success` and `period_seconds`, and any reader gets `age_seconds` and a
// verdict without knowing which script produced the file.
//
// It is a pure function of (object, mtime, now) — no LLM, no network, no wall-clock inside the
// analysis — so the guard drives it with fabricated inputs and gets a decidable answer.
//
//   node scripts/lens/staleness.mjs            # one line per declared artifact
//   node scripts/lens/staleness.mjs --json
//   node scripts/lens/staleness.mjs --check    # exit 1 if any artifact exceeds 2× its period
//   node scripts/lens/staleness.mjs --root <d> # judge a different tree (the test's path)
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// A tick that is stale is one that has missed a whole cycle and then some — one late run is jitter,
// two is a stopped clock. This is the multiplier the guard turns red at.
export const STALE_MULTIPLE = 2;

/**
 * THE DECLARED PERIODS. A period that lives only in the script that writes the file is invisible
 * to everyone reading it; declaring it here (and stamping it INTO the artifact) is what makes
 * staleness computable by anything that can read JSON.
 */
export const DECLARED = [
  {
    file: '.thetacog/lens-traction.json',
    periodSeconds: 1800,   // lens-gardener.sh --once, launchd every 30 min
    writer: 'scripts/pmu/lens-traction-monitor.mjs --write',
    tick: 'lens-gardener (30 min)',
  },
  {
    file: '.thetacog/lens-reef-health.json',
    periodSeconds: 1800,   // prompt-lens.mjs REEF_HEALTH_TTL_MS = 30 min
    writer: 'scripts/pmu/prompt-lens.mjs refreshReefHealthCache()',
    tick: 'lens-gardener (30 min)',
  },
];

/**
 * Stamp an artifact about to be written. Returns a NEW object — the caller decides what else
 * goes in it, this only guarantees the three fields a reader needs to judge age.
 */
export function stamp(obj, { periodSeconds, nowMs = Date.now() } = {}) {
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) {
    throw new Error('stamp(): periodSeconds must be a positive number — an undeclared period is the bug');
  }
  return {
    ...obj,
    last_success: new Date(nowMs).toISOString(),
    period_seconds: periodSeconds,
  };
}

/**
 * Judge one artifact. `obj` may be null (unreadable/missing). mtimeMs is the fallback clock for a
 * legacy artifact written before stamping existed — a legacy file is judged, never exempted.
 * @returns {{present:boolean, stamped:boolean, ageSeconds:number|null, periodSeconds:number,
 *            ratio:number|null, stale:boolean, clock:'last_success'|'ts'|'mtime'|'none'}}
 */
export function staleness(obj, mtimeMs, nowMs, { periodSeconds }) {
  if (obj === null || obj === undefined) {
    return { present: false, stamped: false, ageSeconds: null, periodSeconds, ratio: null, stale: true, clock: 'none' };
  }
  let atMs = null, clock = 'mtime';
  const declared = Number(obj.period_seconds);
  const period = Number.isFinite(declared) && declared > 0 ? declared : periodSeconds;

  const ls = Date.parse(obj.last_success ?? '');
  if (Number.isFinite(ls)) { atMs = ls; clock = 'last_success'; }
  else if (Number.isFinite(Number(obj.ts)) && Number(obj.ts) > 0) { atMs = Number(obj.ts); clock = 'ts'; }
  else { atMs = mtimeMs; clock = 'mtime'; }

  const ageSeconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
  const ratio = ageSeconds / period;
  return { present: true, stamped: clock === 'last_success', ageSeconds, periodSeconds: period, ratio, stale: ratio > STALE_MULTIPLE, clock };
}

/** Read + judge every declared artifact under `root`. */
export function surveyStaleness({ root = REPO, nowMs = Date.now(), declared = DECLARED } = {}) {
  return declared.map((d) => {
    const path = join(root, d.file);
    let obj = null, mtimeMs = 0;
    try { obj = JSON.parse(readFileSync(path, 'utf8')); mtimeMs = statSync(path).mtimeMs; } catch { obj = null; }
    return { ...d, ...staleness(obj, mtimeMs, nowMs, { periodSeconds: d.periodSeconds }) };
  });
}

export function formatAge(seconds) {
  if (seconds === null) return 'never';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/** One line per artifact — AGE first, value never. A stale HEALTHY must read as stale. */
export function oneLine(r) {
  const mark = !r.present ? '✗' : r.stale ? '⚠' : '✓';
  const age = r.present ? formatAge(r.ageSeconds) : 'missing';
  const per = `${Math.round(r.periodSeconds / 60)}m`;
  const note = !r.present ? 'never written'
    : r.stale ? `STALE — ${(r.ratio).toFixed(1)}× its ${per} period (${r.tick} has stopped)`
    : `${(r.ratio).toFixed(1)}× of ${per}`;
  const clock = r.present && !r.stamped ? ` [clock: ${r.clock}, unstamped]` : '';
  return `${mark} ${r.file} — age ${age} · ${note}${clock}`;
}

const isCli = process.argv[1] && process.argv[1].endsWith('staleness.mjs');
if (isCli) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--root');
  const root = i === -1 ? REPO : resolve(argv[i + 1]);
  const rows = surveyStaleness({ root });
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    for (const r of rows) process.stdout.write(oneLine(r) + '\n');
  }
  if (argv.includes('--check') && rows.some((r) => r.stale)) process.exit(1);
}
