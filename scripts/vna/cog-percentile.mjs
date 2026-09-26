#!/usr/bin/env node
// scripts/vna/cog-percentile.mjs — THE COG PINNED TO A PERCENTILE OF HUMAN WORK COMPLEXITY (C113e).
//
// Operator 2026-09-20, verbatim: "the complexity measures need to be under the keys (we have a lot of specs on
// tokens/complexity cog units (estimated pinned to something human if it makes sense - or actually just pin it to
// percentile of human work complexity - yes do that)".
//
// The pin is a RANK, never a rate: a commit's cog (C93a, minted only with a red witness) is placed against the
// distribution of cogs the CHAIR route minted — the commits a human made in this repo, which is the only human
// work the record holds. A commit the headless runner made (a `verdict` row in .thetacog/runner.ndjson names it by
// `work`) is ranked against that distribution but never joins it, so the runner cannot move the ruler it is
// measured with. Mid-rank percentile (ties count half). UNMEASURED below FLOOR chair rows — the floor is named
// on the line, never felt. No dollar, no model, nothing typed: every number is read off the two ndjson files.
//
// @guard tests/vna/c113e-cog-human-percentile.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FLOOR = 30;   // chair rows below which a percentile is not a reading
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nd = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/** the shas the runner made — every verdict row's `work`, as a 10-char prefix set */
export function runnerShas(runnerRows = []) {
  return new Set(runnerRows.filter((r) => r && r.kind === 'verdict' && r.work).map((r) => String(r.work).slice(0, 10)));
}
export const isRunnerSha = (sha, set) => set.has(String(sha || '').slice(0, 10));

/** mid-rank percentile of x in a sorted numeric array — ties count half; null on an empty array */
export function percentileOf(x, sorted) {
  if (!sorted.length || !Number.isFinite(x)) return null;
  let below = 0, eq = 0;
  for (const v of sorted) { if (v < x) below++; else if (v === x) eq++; else break; }
  return Math.round(((below + eq / 2) / sorted.length) * 100);
}

/**
 * @param {{cogRows: object[], runnerRows?: object[], floor?: number}} _
 * @returns {{status:'measured'|'UNMEASURED', why?:string, n:number, floor:number, human:number[], latest?:{sha,cog,pct,route}, median_pct?:number, runner?:{n:number, median_pct:number|null}}}
 */
export function humanCogPercentile({ cogRows = [], runnerRows = [], floor = FLOOR } = {}) {
  const rs = runnerShas(runnerRows);
  const minted = cogRows.filter((r) => r && r.minted && Number.isFinite(r.cog));
  const chair = minted.filter((r) => !isRunnerSha(r.sha, rs));
  const human = chair.map((r) => r.cog).sort((a, b) => a - b);
  const n = human.length;
  if (n < floor) return { status: 'UNMEASURED', why: `${n} chair cog${n === 1 ? '' : 's'} minted, floor ${floor}`, n, floor, human };
  const ranked = minted.map((r) => ({ sha: r.sha, cog: r.cog, pct: percentileOf(r.cog, human), route: isRunnerSha(r.sha, rs) ? 'runner' : 'chair' }));
  const latest = ranked[ranked.length - 1] || null;
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const runner = ranked.filter((r) => r.route === 'runner');
  return { status: 'measured', n, floor, human, latest, median_pct: med(ranked.map((r) => r.pct)), runner: { n: runner.length, median_pct: med(runner.map((r) => r.pct)) } };
}

/** the one line the panel paints: `cog p<NN> of chair work · <sha8> · n <k>` or `UNMEASURED — <why>` */
export function cogPercentileLine(r) {
  if (!r || r.status !== 'measured' || !r.latest) return `cog percentile UNMEASURED — ${r && r.why ? r.why : 'no reading'}`;
  return `cog p${r.latest.pct} of chair work · ${String(r.latest.sha).slice(0, 8)} · n ${r.n}${r.runner.n ? ` · runner median p${r.runner.median_pct} (${r.runner.n})` : ''}`;
}

export function readCogPercentile({ repo = REPO } = {}) {
  return humanCogPercentile({ cogRows: nd(resolve(repo, 'data/vna/cog.ndjson')), runnerRows: nd(resolve(repo, '.thetacog/runner.ndjson')) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = readCogPercentile();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else console.log(cogPercentileLine(r));
}
