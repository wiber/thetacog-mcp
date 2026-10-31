#!/usr/bin/env node
// scripts/bookclub/rank-settings.mjs — THE KNOBS, IN ONE PLACE, READ BY WHAT ACTUALLY SHIPS.
//
// Operator 2026-08-29: "make the high scores and reader rankings print to a localhost url as
// well, so the sql and sh reprints the list and we can tweak what will be in the emailed txt
// files in real time (so the algos are sensible)."
//
// THE RULE THIS FILE EXISTS TO SATISFY, and it is the whole point: a weighting set on the glass
// must reach the ranking that mints the output. A slider that redraws a preview and leaves the
// nightly job on its old literal is a control wired to nothing — fabrication wearing a UI, which
// this repo has shipped before and named as a defect. So the lab does not hold state: it WRITES
// this file, and rank-readers-t3.mjs / highscore.mjs READ it as their defaults. One value, two
// readers, no way for the knob and the emailed file to disagree.
//
// Every setting here was a hard-coded literal until 2026-08-29. Each is a judgement call, not a
// measurement, which is exactly why it belongs on a dial the operator can turn and see:
//
//   mechPerDay  renders-per-active-day above which a reader is called machine-shaped. Blunt on
//               purpose — a person reads a few pages and misses days; a sandbox detonates every
//               send. Measured: at 8, 94 of 288 readers flag, and several unflagged rows sit at
//               7-something, so the cut marks the certain machines, never the certain humans.
//   topReaders  how many rows the emailed txt carries.
//   since       the window the ranking is computed over.
//   minFetch    a send with fewer verified T2 fetches is a MEASUREMENT OUTAGE and is excluded
//               from the board, not ranked low — the 08-20 "45x champion on 3 renders" artifact.
//   topAll/topRecent  board sizes.
//   heatBands   the rank-percentile cuts for 4/3/2 flames. Was ceil(4*score/max), which printed
//               four flames on every published row because a tight field is all within ~95% of
//               its leader.
//
//   node scripts/bookclub/rank-settings.mjs            # print the effective settings
//   node scripts/bookclub/rank-settings.mjs --defaults # print the built-in defaults
//
// Guard: tests/bookclub/rank-lab-is-wired.test.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SETTINGS_PATH = resolve(REPO, 'data/bookclub/rank-settings.json');

export const DEFAULTS = Object.freeze({
  // reader ranking
  mechPerDay: 8,
  topReaders: 300,
  since: '2026-07-08T00:00:00Z',
  // high-score board
  minFetch: 10,
  topAll: 5,
  topRecent: 3,
  heatBands: [0.10, 0.25, 0.50],     // <=b0 → 4 flames, <=b1 → 3, <=b2 → 2, else 1
  // send ranking
  winMin: 360,
  lastSends: 20,
});

// Only known keys survive, and each is coerced + clamped. A settings file is written by a local
// web form, so it is untrusted input in the ordinary sense — a NaN here would silently rank
// everything as a machine, which reads exactly like a real result.
const NUM = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function normalize(raw = {}) {
  const d = DEFAULTS;
  const bands = Array.isArray(raw.heatBands) && raw.heatBands.length === 3
    ? raw.heatBands.map((b, i) => NUM(b, 0.01, 1, d.heatBands[i]))
    : [...d.heatBands];
  // bands must ascend or the flame assignment is not a partition
  bands.sort((a, b) => a - b);
  return {
    mechPerDay: NUM(raw.mechPerDay, 0.5, 500, d.mechPerDay),
    topReaders: Math.round(NUM(raw.topReaders, 1, 5000, d.topReaders)),
    since: typeof raw.since === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw.since) ? raw.since : d.since,
    minFetch: Math.round(NUM(raw.minFetch, 0, 10000, d.minFetch)),
    topAll: Math.round(NUM(raw.topAll, 1, 50, d.topAll)),
    topRecent: Math.round(NUM(raw.topRecent, 1, 50, d.topRecent)),
    heatBands: bands,
    winMin: Math.round(NUM(raw.winMin, 5, 2880, d.winMin)),
    lastSends: Math.round(NUM(raw.lastSends, 1, 500, d.lastSends)),
  };
}

/** the effective settings — the saved file over the defaults, always normalized. */
export function loadSettings() {
  try {
    return normalize(JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')));
  } catch {
    return normalize({});                 // no file yet = the defaults, never a crash
  }
}

/** persist. Returns the normalized object actually written, never the raw input. */
export function saveSettings(raw) {
  const s = normalize(raw);
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + '\n');
  return s;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const s = process.argv.includes('--defaults') ? normalize({}) : loadSettings();
  process.stdout.write(JSON.stringify(s, null, 2) + '\n');
}
