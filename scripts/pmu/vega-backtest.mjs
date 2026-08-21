#!/usr/bin/env node
// scripts/pmu/vega-backtest.mjs — DAY-ONE VEGA: backtest a fork's own git log into an initial drift series.
//
//   npx thetacog-mcp vega-backtest [--n 30] [--repo <path>]
//
// The underwriter's first question to any new fork is: "your historical vega is YOUR repo's —
// why would it translate to mine on day one?" It shouldn't, and it doesn't have to: this command
// computes the fork's OWN initial series by replaying the instrument over its existing git log —
// per commit: message + added doc lines → INTENT, added code lines → REALITY, the same
// buildTriptychInputs → decode gate the battery uses (never a second implementation). Each commit
// becomes one series row {sha, sigmaDrift, offPct}; thin commits refuse honestly (the floor's
// jurisdiction) and are excluded from the stats rather than faked into them.
//
// Output: attest-out/backtest-series.ndjson + printed stats, then price it with
//   npx thetacog-mcp advisory-premium --series attest-out/backtest-series.ndjson
//
// Deterministic per repo state: same git log → same rows, byte-identical (no timestamps).

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const N = Math.max(5, Math.min(200, parseInt(arg('--n', '30'), 10) || 30));
const REPO = resolve(arg('--repo', process.cwd()));
const KILL = 25;

const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', maxBuffer: 5e7 });
let shas;
try { shas = sh(`git log --no-merges --format=%H -n ${N}`).trim().split('\n').filter(Boolean); }
catch { console.error('✗ not a git repository: ' + REPO); process.exit(2); }
if (!shas.length) { console.error('✗ empty git log'); process.exit(2); }

const { buildTriptychInputs } = await import(resolve(PKG, 'scripts/pmu/triptych-build.mjs'));
const { decodeDeltaThreeColourEdges } = await import(resolve(PKG, 'scripts/pmu/triptych-render.mjs'));

const DOC_EXT = /\.(md|mdx|txt|html?)$/i;
const CODE_EXT = /\.(m?[jt]sx?|rs|py|go|rb|java|c|cc|cpp|h|sh|sql|css|ya?ml|json)$/i;

console.log(`══════ VEGA BACKTEST — ${shas.length} commits of ${REPO.split('/').pop()} through the real gate ══════`);
const rows = [];
for (const sha of shas) {
  const msg = sh(`git show -s --format=%B ${sha}`);
  // added lines only, split by file kind — the same SAID/DID split the on-commit instrument uses
  let docAdd = '', codeAdd = '', file = '';
  for (const line of sh(`git show --format= --unified=0 ${sha}`).split('\n')) {
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    if (DOC_EXT.test(file)) docAdd += text + '\n';
    else if (CODE_EXT.test(file)) codeAdd += text + '\n';
  }
  const intentText = (msg + '\n' + docAdd).trim();
  const realityText = (codeAdd || docAdd).trim();   // doc-only commits: the doc IS what was done
  let row = { sha: sha.slice(0, 9), refused: true, sigmaDrift: null, offPct: null };
  if (intentText && realityText) {
    try {
      const built = await buildTriptychInputs({ intentText, realityText, repoRoot: PKG, killTolerancePct: KILL });
      const cole = built.renderArgs && built.renderArgs.cole;
      if (cole && cole.intent && cole.reality) {
        const tol = decodeDeltaThreeColourEdges(cole.intent.matrix || cole.intent, cole.reality.matrix || cole.reality, KILL);
        if (!tol.refused && tol.offPct != null) {
          row = { sha: sha.slice(0, 9), refused: false, sigmaDrift: Number(built.meta?.matchSigma) || 0, offPct: tol.offPct };
        }
      }
    } catch { /* row stays refused — never fabricated */ }
  }
  rows.push(row);
  console.log(`  ${row.sha}  ${row.refused ? 'REFUSED (thin — excluded from stats, never faked)' : 'off ' + String(row.offPct).padStart(3) + '% · σ ' + row.sigmaDrift.toFixed(2)}`);
}

mkdirSync(resolve(process.cwd(), 'attest-out'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'attest-out/backtest-series.ndjson'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const live = rows.filter((r) => !r.refused);
if (live.length >= 8) {
  const sig = live.map((r) => r.sigmaDrift), off = live.map((r) => r.offPct);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mS = mean(sig);
  const vega = Math.sqrt(sig.reduce((a, x) => a + (x - mS) * (x - mS), 0) / (sig.length - 1));
  const breach = off.filter((x) => x > KILL).length / off.length;
  console.log(`\n  n=${live.length} measured (${rows.length - live.length} refused) · initial vega ${vega.toFixed(2)} · breach@kill ${(100 * breach).toFixed(1)}%`);
} else {
  console.log(`\n  n=${live.length} measured — below the aperture floor; more history needed before any vega means anything`);
}
console.log('  → attest-out/backtest-series.ndjson');
console.log('  → price it: npx thetacog-mcp advisory-premium --series attest-out/backtest-series.ndjson');
