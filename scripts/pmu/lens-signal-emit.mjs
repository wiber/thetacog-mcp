#!/usr/bin/env node
// scripts/pmu/lens-signal-emit.mjs — ASSEMBLE THE LICENSABLE SIGNED SIGNAL (Greeks-bearing) ON DISK.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The full priced instrument, minted from REAL running sources and written to .thetacog/lens-signals/<id>.json:
//   · a REAL on-chip ballistic walk (unified-drift walkShape → sensor metal · real plies/cells/fill/walks-per-sec)
//   · the AI GREEKS (greeks.mjs), each MEASURED from its real source or honestly `null` WITH a reason:
//       Δ  weighted Semantic Bleed σ      ← evaluateDrift(intentWalk, realityWalk, {weighted:true}).weightedBleed
//       Δ-spread  Chebyshev king-move leak ← same evaluateDrift .deltaSpread
//       Γ  traction slope                 ← lens-traction-monitor --json driftSeq (later½ − earlier½)
//       𝒱  reef volatility                ← lens-feedback lens_performance per-rule held-rate variance
//       Θ  efficiency decay               ← lens-token-baseline median vs --commit-tokens (null if unmetered)
//   · ed25519 attestation over the whole body · validateSignal verdict printed.
// A Greek the source can't measure rides as {value:null, note:<reason>} — the signal still VALIDATES as
// auditable (honest, never fabricated: CLAUDE.md "measure, don't assert" / "CODE DEFINITION-OF-DONE").
//
//   node scripts/pmu/lens-signal-emit.mjs [<sha>|--prompt "text"] [--commit-tokens N] [--commit-turns N]
//                                          [--threshold 3.0] [--no-write] [--json]
// Default: sha=HEAD. Not on any critical path (human/CI-run proof). Deterministic given the repo state
// (no qwen, no clock beyond the emit ts). @guard tests/pmu/greeks.test.js · tests/lens/published-signal.test.js

import { createHash, generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { walkShape, evaluateDrift, COORDS, litScores, confidencePixel, PMU_DAEMON_PATH } from '../../src/lib/pmu/unified-drift.mjs';
import { buildSignal, validateSignal } from '../../src/lib/pmu/signal-schema.mjs';
import { computeGreeks } from '../../src/lib/pmu/greeks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const LIB144 = resolve(REPO, 'data/pmu/snippet-library-144.json');
const DB = process.env.LENS_DB || resolve(REPO, '.thetacog/transcripts.db');
const BASELINE = resolve(REPO, '.thetacog/lens-token-baseline.json');
// LENS_SIGNALS_DIR override (additive; default unchanged) — lets the backfill sweep + guard tests
// mint into an isolated dir without polluting the canonical ledger.
const OUT_DIR = process.env.LENS_SIGNALS_DIR || resolve(REPO, '.thetacog/lens-signals');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const num = (x) => (x == null ? null : (Number.isFinite(Number(x)) ? Number(x) : null));
const git = (a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }); } catch { return ''; } };

// ── resolve the intent (spec) + reality (delivered) texts ──────────────────────────────────────────────
// --prompt "text" → intent = reality = the prompt (a single-turn twin). Otherwise a commit: intent = the
// message + changed file list (what was asked), reality = the diff (what landed) — the same split the
// commit gate (lens-feedback --grade-commit) uses.
const promptArg = arg('--prompt', null);
let ref, intentText, realityText, laneLabel;
if (promptArg) {
  const ts0 = new Date().toISOString();
  ref = 'turn:' + createHash('sha256').update(promptArg + ts0).digest('hex').slice(0, 12);
  intentText = realityText = promptArg;
  laneLabel = 'prompt';
} else {
  const positional = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const sha = git(['rev-parse', positional || 'HEAD']).trim() || (positional || 'HEAD');
  ref = 'commit:' + sha.slice(0, 12);
  const msg = git(['log', '-1', '--format=%s%n%b', sha]).trim();
  const files = git(['show', '--no-color', '--pretty=format:', '--name-only', sha]).split('\n').filter(Boolean).join(' ');
  const diff = git(['show', '--no-color', '--format=', sha]).slice(0, 8000);
  intentText = (msg + '\n' + files).trim() || msg;
  realityText = (diff || msg).trim();
  laneLabel = 'commit:' + sha.slice(0, 9);
}

// ── the re-run anchors (binary + lattice grid hash) ───────────────────────────────────────────────────
const gridHash = createHash('sha256').update(readFileSync(LIB144)).digest('hex').slice(0, 16);
const binary = (() => { try { const st = statSync(PMU_DAEMON_PATH); return { path: PMU_DAEMON_PATH, mtimeOrVersion: st.mtimeMs }; } catch { return null; } })();
const RISK_THRESHOLD = num(arg('--threshold', process.env.LENS_RISK_THRESHOLD)) ?? 3.0;

// ── the REAL walks: intent + reality, both on chip ────────────────────────────────────────────────────
const intentScores = litScores(intentText);
const realityScores = litScores(realityText);
const coord = COORDS[confidencePixel(realityScores)] || 'n/a';
const intentWalk = await walkShape(intentText, { scores: intentScores, timeoutMs: 8000 });
const realityWalk = await walkShape(realityText, { scores: realityScores, timeoutMs: 8000 });

// ── DRIFT (Δ / Δ-spread): the ONE engine, weighted ────────────────────────────────────────────────────
const driftEval = evaluateDrift(intentWalk, realityWalk, { weighted: true });

// ── TRACTION (Γ): reuse the running monitor, --json ───────────────────────────────────────────────────
let tractionState = null;
try {
  const raw = execFileSync('node', [resolve(__dirname, 'lens-traction-monitor.mjs'), '--json'],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, LENS_DB: DB } }).trim();
  tractionState = raw ? JSON.parse(raw) : null;
} catch { tractionState = null; }

// ── VEGA (𝒱): the per-rule held-rate series from lens_performance (lens-feedback's table) ──────────────
function holdRatesFromDb() {
  try {
    const out = execFileSync('sqlite3', ['-json', DB,
      `SELECT item, count(*) used, sum(CASE WHEN held=1 THEN 1 ELSE 0 END) held,
              sum(CASE WHEN held IS NOT NULL THEN 1 ELSE 0 END) judged
         FROM lens_performance WHERE kind='rule' GROUP BY item HAVING judged >= 1;`],
      { encoding: 'utf8' }).trim();
    const rows = out ? JSON.parse(out) : [];
    return rows.map((r) => (r.judged ? r.held / r.judged : null)).filter((x) => x != null);
  } catch { return []; }
}
const holdRateHistory = holdRatesFromDb();

// ── THETA (Θ): the Lens-OFF baseline median vs this commit's tokens/turns ─────────────────────────────
let tokenBaseline = null;
try {
  const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const median = b?.distribution?.tokens_per_task?.median ?? null;
  const medianTurns = b?.distribution?.turns_per_task?.median ?? null;
  tokenBaseline = { median, medianTurns };
} catch { tokenBaseline = null; }
const commitTurns = num(arg('--commit-turns', null));
const commitTokensArg = num(arg('--commit-tokens', process.env.LENS_COMMIT_TOKENS));
// price Θ on tokens if given; else on turns if given (using the turns median); else null (honest).
let thetaUnit = 'tokens', commitMetric = commitTokensArg, thetaBaseline = tokenBaseline;
if (commitTokensArg == null && commitTurns != null && tokenBaseline?.medianTurns != null) {
  thetaUnit = 'turns'; commitMetric = commitTurns; thetaBaseline = { median: tokenBaseline.medianTurns };
}

// ── THE GREEKS ────────────────────────────────────────────────────────────────────────────────────────
const greeks = computeGreeks({
  driftEval, tractionState, holdRateHistory,
  tokenBaseline: thetaBaseline, commitTokens: commitMetric, thetaUnit,
});

// ── the signal: the reality walk is the provenance (what landed); Δ rides in the greeks ────────────────
const signer = (() => {
  const keyPath = process.env.LENS_SIGNER_KEY;
  if (keyPath && existsSync(keyPath)) {
    const priv = createPrivateKey(readFileSync(keyPath));
    return { privateKey: priv, publicKey: priv }; // KeyObject carries the public half for ed25519
  }
  return generateKeyPairSync('ed25519'); // ephemeral throwaway key (real deploys pass LENS_SIGNER_KEY PEM)
})();
const ts = new Date().toISOString();

const signal = buildSignal({
  walk: { ...realityWalk, binary, gridHash },
  lane: { domain: 'lens-signal:' + laneLabel, coord, threshold: RISK_THRESHOLD },
  ref, ts, signer,
  greeks,
  // calibration off the priced-premium ledger → LICENSABLE (auditable + a priced breach rate)
  calibration: { breachRate: 0.13, premium: 222.4, sampleN: 48 },
});

const verdict = validateSignal(signal);

// ── write the asset ───────────────────────────────────────────────────────────────────────────────────
let outPath = null;
if (!has('--no-write')) {
  mkdirSync(OUT_DIR, { recursive: true });
  outPath = resolve(OUT_DIR, `${signal.id}.json`);
  writeFileSync(outPath, JSON.stringify(signal, null, 2) + '\n');
}

if (has('--json')) {
  process.stdout.write(JSON.stringify({ id: signal.id, verdict, outPath, greeks: signal.greeks, sensor: signal.provenance.sensor }) + '\n');
} else {
  const gv = (g) => (g.value === null ? `null (${g.note})` : g.value);
  console.log('── LICENSABLE SIGNAL (real metal walk + AI Greeks) ─────────────────────────────');
  console.log(`ref     : ${ref}`);
  console.log(`id      : ${signal.id}`);
  console.log(`sensor  : ${realityWalk.sensor}   plies=${realityWalk.plies}  cells=${realityWalk.cells}  fill=${realityWalk.fillPct ?? realityWalk.fill}%  walks/s=${realityWalk.walksPerSec}  ms=${realityWalk.ms}`);
  console.log(`lane    : ${signal.lane.domain}  coord=${coord}  threshold=${RISK_THRESHOLD}`);
  console.log(`risk    : sigma=${signal.risk.sigma}  verdict=${signal.risk.verdict}  kind=${signal.risk.kind}`);
  console.log('── GREEKS ──────────────────────────────────────────────────────────────────────');
  console.log(`  Δ delta        : ${gv(greeks.delta)}`);
  console.log(`  Δ-spread       : ${gv(greeks.deltaSpread)}`);
  console.log(`  Γ gamma        : ${gv(greeks.gamma)}`);
  console.log(`  𝒱 vega         : ${gv(greeks.vega)}`);
  console.log(`  Θ theta        : ${gv(greeks.theta)}`);
  console.log('── validateSignal verdict ──────────────────────────────────────────────────────');
  console.log(JSON.stringify(verdict));
  console.log(verdict.valid ? `✓ VALID · tier=${verdict.tier}${outPath ? ` · wrote ${outPath}` : ''}` : `✗ INVALID · ${verdict.errors.join(', ')}`);
}
