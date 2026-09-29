#!/usr/bin/env node
// scripts/pmu/lens-traction-monitor.mjs — THE TRACTION MONITOR (circuit-breaker for the directive lens).
// =============================================================================
// The lens grades each commit's drift (lens-feedback.mjs --grade-commit → lens_performance rows, kind='grade',
// held=1 in-lane / held=0 drift). This monitor watches the SEQUENCE of those grades and detects "spinning
// wheels": many iterations with FLAT-OR-RISING drift and no resolution — the out-of-pixel runaway (the
// bf-002 429-commit, never-merge incident). When traction is lost it raises a VISIBLE circuit-breaker
// SIGNAL — a ⚠ TRACTION LOST footer/flag — NOT a hard process-kill. The operator/loop decides what to do.
//
//   lens-traction-monitor.mjs                 # one-line status from the real grade history
//   lens-traction-monitor.mjs --window 12     # widen the window
//   lens-traction-monitor.mjs --json          # machine shape (deterministic, no wall-clock)
//   lens-traction-monitor.mjs --fixture <p>   # drive from an injected drift sequence (the test's path)
//   lens-traction-monitor.mjs --write         # also write the .thetacog/lens-traction.json surface
//
// FAST + DETERMINISTIC: reads the grade history (sqlite) or an injected fixture — NO qwen on the path.
// Insufficient history → INSUFFICIENT-DATA, never a crash.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stamp, DECLARED } from '../lens/staleness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.LENS_DB || resolve(REPO, '.thetacog/transcripts.db');
const SURFACE = resolve(REPO, '.thetacog/lens-traction.json');

// ── TUNABLE THRESHOLDS (the circuit-breaker's calibration) ─────────────────────────────────────────
export const WINDOW = 8;        // how many recent graded iterations to weigh
export const LOST_STREAK = 4;   // ≥ this many consecutive non-falling, above-ceiling iterations → ⚠ LOST
export const DRIFT_CEIL = 0.5;  // drift at/above this is "high" (binary grade: drift=1.0, in-lane=0.0)
export const HEALTHY_FLOOR = 0.25; // latest drift below this reads as resolved → HEALTHY
export const MIN_HISTORY = 3;   // fewer judged iterations than this → INSUFFICIENT-DATA
const EPS = 0.05;               // trend dead-band (flat unless the half-over-half delta exceeds this)

export const VERDICTS = {
  HEALTHY: 'HEALTHY',
  WATCH: 'WATCH',
  LOST: '⚠ TRACTION LOST',
  INSUFFICIENT: 'INSUFFICIENT-DATA',
};

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// Normalize an injected/looked-up history entry to a numeric drift in [0,1].
// Accepts: a bare number, {drift:n}, or a grade row {held:0|1} (held=1 in-lane→0 drift, held=0 drift→1).
function toDrift(e) {
  if (typeof e === 'number') return e;
  if (e && typeof e.drift === 'number') return e.drift;
  if (e && (e.held === 0 || e.held === 1 || e.held === '0' || e.held === '1')) return Number(e.held) === 1 ? 0 : 1;
  return null;
}

// THE CORE — pure, deterministic, injectable. seq is oldest→newest. Returns the full assessment.
export function assessTraction(seq, opts = {}) {
  const window = opts.window ?? WINDOW;
  const lostStreak = opts.lostStreak ?? LOST_STREAK;
  const driftCeil = opts.driftCeil ?? DRIFT_CEIL;
  const healthyFloor = opts.healthyFloor ?? HEALTHY_FLOOR;
  const minHistory = opts.minHistory ?? MIN_HISTORY;

  const all = (Array.isArray(seq) ? seq : []).map(toDrift).filter((d) => d != null);
  const w = all.slice(-window);              // weigh only the recent window (oldest→newest)
  const n = w.length;

  if (n < minHistory) {
    return { verdict: VERDICTS.INSUFFICIENT, iterations: n, window, driftTrend: 'unknown',
      lostStreak: 0, driftCeil, driftSeq: w };
  }

  // TREND — second-half average vs first-half average, with a dead-band so noise reads flat.
  const half = Math.floor(n / 2);
  const earlier = avg(w.slice(0, half));
  const later = avg(w.slice(n - half));
  let driftTrend = 'flat';
  if (later < earlier - EPS) driftTrend = 'falling';
  else if (later > earlier + EPS) driftTrend = 'rising';

  // TRAILING HIGH-STREAK — consecutive newest iterations at/above the ceiling (the "stuck/rising high" run).
  let trailingHigh = 0;
  for (let i = n - 1; i >= 0; i--) { if (w[i] >= driftCeil) trailingHigh++; else break; }

  const latest = w[n - 1];
  let verdict;
  if (driftTrend === 'falling' || latest < healthyFloor) {
    // resolving (drift coming down) OR clearly low → traction is fine.
    verdict = VERDICTS.HEALTHY;
  } else if (trailingHigh >= lostStreak && driftTrend !== 'falling') {
    // ≥LOST_STREAK consecutive non-falling, above-ceiling iterations → the spinning-wheels runaway.
    verdict = VERDICTS.LOST;
  } else {
    // elevated/flat but not resolving and not yet a full LOST streak → keep an eye on it.
    verdict = VERDICTS.WATCH;
  }

  return { verdict, iterations: n, window, driftTrend, lostStreak: trailingHigh, driftCeil, driftSeq: w };
}

// ── HISTORY SOURCES ────────────────────────────────────────────────────────────────────────────────
function fromFixture(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(j)) return j;
    if (Array.isArray(j.driftSeq)) return j.driftSeq;
    if (Array.isArray(j.history)) return j.history;
  } catch {}
  return [];
}

// Read the last `window*2` grade rows from lens_performance (kind='grade'), oldest→newest.
function fromDb(window) {
  try {
    const out = execFileSync('sqlite3', ['-json', DB,
      `SELECT held, note FROM lens_performance WHERE kind='grade' ORDER BY id DESC LIMIT ${window * 2};`],
      { encoding: 'utf8' }).trim();
    const rows = out ? JSON.parse(out) : [];
    return rows.reverse(); // oldest→newest
  } catch { return []; }
}

function oneLine(a) {
  if (a.verdict === VERDICTS.INSUFFICIENT)
    return `[Traction: INSUFFICIENT-DATA · ${a.iterations}/${MIN_HISTORY} graded iterations]`;
  const tag = a.verdict === VERDICTS.LOST ? a.verdict
    : a.verdict === VERDICTS.WATCH ? '◐ WATCH' : '✓ HEALTHY';
  const reset = a.verdict === VERDICTS.LOST ? ' — reset required (reset context or switch tool)' : '';
  return `[Traction: ${tag} · ${a.iterations} iters · drift ${a.driftTrend} · high-streak ${a.lostStreak}/${LOST_STREAK}${reset}]`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const window = Number(arg('--window', WINDOW)) || WINDOW;
  const fixture = arg('--fixture', process.env.LENS_TRACTION_FIXTURE || null);
  const seq = fixture ? fromFixture(fixture) : fromDb(window);
  const a = assessTraction(seq, { window });

  if (process.argv.includes('--write')) {
    // The ASSESSMENT stays ts-less — assessTraction() and --json are a pure function of the drift
    // sequence, and the tests drive them by fixture. The SURFACE is the opposite case: it is read
    // by things that cannot tell a steady gardener from a stopped one, so it carries last_success
    // and its declared period. Before this, [0,0,0,0,0,0,0,0] + HEALTHY meant both.
    const period = DECLARED.find((d) => d.file === '.thetacog/lens-traction.json').periodSeconds;
    try { writeFileSync(SURFACE, JSON.stringify(stamp({
      verdict: a.verdict, iterations: a.iterations, driftTrend: a.driftTrend,
      window: a.window, lostStreak: a.lostStreak, driftCeil: a.driftCeil, driftSeq: a.driftSeq,
    }, { periodSeconds: period }), null, 0) + '\n'); } catch {}
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(a) + '\n');
  } else {
    process.stdout.write(oneLine(a) + '\n');
  }
}
