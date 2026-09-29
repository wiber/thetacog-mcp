#!/usr/bin/env node
// C94d — THE RUNNER, READ AS ONE LINE. /steer has /goal's shape: the working thread carries the snowball and the receipts,
// never a worker's build. This is the receipt door for the runner — a pure function over the rows steer-runner.mjs's
// record() appends to .thetacog/runner.ndjson (kinds: run · dispatch · verdict · halt · labour · done · worker · pause ·
// dry-run · audit · abort), printed as ONE line the chair can read after every dispatch:
//
//   runner: last <kind> <hh:mm> · <label> <ok|HALTED: reason|RUNNING> · <n> dispatched · <m> halts
//   runner: not run — node scripts/vna/steer-runner.mjs
//
// Rules the line keeps: the halt reason is the FILE'S OWN sentence (record()'s `reason`), never a paraphrase; an empty or
// absent file is "not run" with the door named, never `0 dispatched` (a zero is a measurement, absence is not); the label and
// verdict are the LAST run's (a file holds many runs), the counts are the whole file's; a dispatch that has no verdict, halt
// or done row after it is RUNNING — a spawn is not a pass. Zero LLM, zero git: the line is a function of the bytes.
//
//   node scripts/vna/runner-reading.mjs [--file .thetacog/runner.ndjson] [--json]
//
// Guard: tests/vna/c94-steer-reads-runner.test.mjs. Does not touch steer-hook.mjs / steer-ui.mjs — they may import this.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const RUNNER_NOT_RUN = 'runner: not run — node scripts/vna/steer-runner.mjs';

// one row per parseable line; a torn or foreign line is skipped, never a crash (the runner appends while the chair reads)
export function parseRunnerRows(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { const r = JSON.parse(s); if (r && typeof r === 'object' && r.kind) rows.push(r); } catch {}
  }
  return rows;
}
export function readRunnerRows(file = RUNNER_NDJSON) {
  if (!existsSync(file)) return [];
  try { return parseRunnerRows(readFileSync(file, 'utf8')); } catch { return []; }
}

const hhmm = (iso) => {
  const d = new Date(iso || NaN); if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// the facts the line is made of — exported so a page can print them as fields (the steer page's per-unit line, C94d)
export function runnerFacts(rows) {
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.kind) : [];
  if (all.length === 0) return null;
  const last = all[all.length - 1];
  const dispatched = all.filter((r) => r.kind === 'dispatch').length;
  const halts = all.filter((r) => r.kind === 'halt').length;
  // the last run's slice: from the last `run` row to the end (a file holds many runs; the verdict is the latest run's)
  let start = 0; for (let i = all.length - 1; i >= 0; i--) if (all[i].kind === 'run') { start = i; break; }
  const run = all.slice(start);
  const labelled = [...run].reverse().find((r) => r.label); const label = labelled ? String(labelled.label) : (run[0].label ? String(run[0].label) : null);
  const halt = [...run].reverse().find((r) => r.kind === 'halt');
  const verdict = [...run].reverse().find((r) => r.kind === 'verdict');
  const closed = run.some((r) => r.kind === 'done' || r.kind === 'abort' || r.kind === 'pause');
  let state;
  if (halt) state = { word: 'HALTED', reason: String(halt.reason || 'no reason on the row') };
  else if (verdict && verdict.ok === false) state = { word: 'HALTED', reason: String(verdict.reason || 'verdict not ok') };
  else if (verdict || closed) state = { word: 'ok', reason: null };
  else state = { word: 'RUNNING', reason: null };
  return { lastKind: String(last.kind), lastAt: last.at || null, label, state, dispatched, halts, rows: all.length, runs: all.filter((r) => r.kind === 'run').length };
}

export function runnerReading(rows) {
  const f = runnerFacts(rows);
  if (!f) return RUNNER_NOT_RUN;
  const verdict = f.state.word === 'HALTED' ? `HALTED: ${f.state.reason}` : f.state.word;
  return `runner: last ${f.lastKind} ${hhmm(f.lastAt)} · ${f.label || 'no label'} ${verdict} · ${f.dispatched} dispatched · ${f.halts} halts`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const fi = a.indexOf('--file'); const file = fi >= 0 && a[fi + 1] ? resolve(a[fi + 1]) : RUNNER_NDJSON;
  const rows = readRunnerRows(file);
  if (a.includes('--json')) process.stdout.write(JSON.stringify({ file, line: runnerReading(rows), facts: runnerFacts(rows) }) + '\n');
  else process.stdout.write(runnerReading(rows) + '\n');
}
