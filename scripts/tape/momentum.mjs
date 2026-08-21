#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/momentum.mjs — SEMANTIC MOMENTUM: measure the measuring
// instrument by running it backwards over real history.
//
// THE OPERATOR'S FRAMING (the design brief, verbatim, 2026-08-20):
// "Just building the measurement doesn't work unless you're attaching it to something better than
// measuring the temperature of the commit message versus what it actually did. That's a model
// quality measure more than anything else. We need to create a semantic momentum. We need to be
// able to figure out the shape of character going back in time and figuring out if this is where
// the prompt holds or it's bleeding, and that requires intent/reality."
//
// THE DISTINCTION THAT IS THE WHOLE POINT (first-class field, never blurred — pairKind):
//   'testimony' — intent is the COMMIT MESSAGE. The agent that wrote the code also wrote the
//                  message (a self-report). message-vs-diff is largely a MODEL-QUALITY signal, not
//                  a spec-adherence signal.
//   'authored'  — intent is a TAPE ATOM's rule + verbatim operator quote (approved by the human
//                  BEFORE the agent ran); reality is the commit that agent produced. Independent
//                  authorship on each side — this is the strong signal.
// Any aggregate MUST report both counts; the CLI refuses to print one blended headline number
// across kinds (headlineOffPct() below throws rather than silently averaging them together).
//
//   node packages/thetacog-mcp/scripts/tape/momentum.mjs [--n 60] [--slug <tape-session>]
//        [--lane <coord>] [--json] [--since <iso>]
//
// PER-COMMIT RECIPE — reused, not reinvented: scripts/pmu/vega-backtest.mjs already replays a git
// log through buildTriptychInputs → decodeDeltaThreeColourEdges (the same rust-walk instrument the
// on-commit gate uses) with an honest REFUSE on thin commits. That IS the door here too. The
// panel-adapter path (panel-door.mjs / composeEncircledPanel in tolerance-panel.mjs) is a SEPARATE,
// heavier composition (runPipeline → renderTriptych → encircled PNG) built for the visual receipt;
// momentum's terminal/JSON output needs offPct + sigmaDrift + a representative coordinate, not a
// rendered image, so it is not invoked here — see the "WHICH PANEL PATH" note in the final report
// for the reasoning. Session-scoped axes ARE threaded through buildTriptychInputs -> runPipeline as
// of DECISION-017 (scripts/pmu/triptych-build.mjs; guard: tests/pmu/build-triptych-axespath.test.mjs)
// -- see the axesPath note below, which is now live, not inert.
//
// GUARD (same commit): tests/tape/momentum-splits-testimony.test.mjs

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
// git via the resolver — a bare 'git' is Apple's licence-gated xcrun stub and dies silently
// in any process without DEVELOPER_DIR (see git-bin.mjs; it cost 17 of 26 coordinates their owns[]).
import { git } from './git-bin.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { resolveAtoms, readDispatches, listSessions } from './store.mjs';
import { assessTraction } from '../../../../scripts/pmu/lens-traction-monitor.mjs';

// packages/thetacog-mcp/scripts/tape/momentum.mjs -> repo root is 4 levels up.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const KILL = 25; // same kill-tolerance the on-commit gate + vega-backtest use
export const SERIES_PATH = resolve(REPO_ROOT, '.thetacog/momentum-series.ndjson');

const DOC_EXT = /\.(md|mdx|txt|html?)$/i;
const CODE_EXT = /\.(m?[jt]sx?|rs|py|go|rb|java|c|cc|cpp|h|sh|sql|css|ya?ml|json)$/i;

const AXNAME = {
  A: 'Strategy', B: 'Tactics', C: 'Operations',
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};

// ── ADDED LINES OFF THE IMMUTABLE COMMIT — never the working tree ──────────────────────────────
// `git show <sha>` reads the OBJECT the commit points at; it is unaffected by anything sitting
// dirty in the working tree at call time. That is asserted twice in the guard test: once by source
// inspection (this function shells to `git show`, never `git diff`/`readFileSync` against a
// checked-out path) and once dynamically (same sha, dirty tree in between, identical bytes out).
export function readAddedLines(sha, repoRoot = REPO_ROOT) {
  const diff = execSync(`git show --format= --unified=0 ${sha}`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 5e7 });
  let docAdd = '', codeAdd = '', file = '';
  const files = new Set();
  let addedLines = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) { file = line.slice(6); if (file !== '/dev/null') files.add(file); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    addedLines++;
    if (DOC_EXT.test(file)) docAdd += text + '\n';
    else if (CODE_EXT.test(file)) codeAdd += text + '\n';
  }
  return { docAdd, codeAdd, files: [...files], addedLines };
}

// ── COMMIT → ATOM MATCHING ──────────────────────────────────────────────────────────────────────
// Every dispatches.ndjson row across every /tape session carries `commits:[]` (the shas the
// dispatched agent produced for that atom). Build one lookup keyed on normalized sha prefixes so a
// commit is traceable to the atom that authored its intent, regardless of which session it lives in.
export function buildCommitAtomIndex() {
  const idx = new Map(); // normalized hex key -> {slug, atomId}
  for (const s of listSessions()) {
    const slug = s.slug;
    for (const d of readDispatches(slug)) {
      if (!Array.isArray(d.commits)) continue;
      for (const c of d.commits) {
        const norm = String(c || '').toLowerCase();
        if (!/^[0-9a-f]{4,40}$/.test(norm)) continue; // skip non-sha placeholders (e.g. "fixture0001")
        idx.set(norm, { slug, atomId: d.atomId });
      }
    }
  }
  return idx;
}

export function matchCommitToAtom(sha, index) {
  const shaLower = String(sha).toLowerCase();
  for (let len = 40; len >= 7; len--) {
    const key = shaLower.slice(0, len);
    if (key.length < 7) break;
    if (index.has(key)) return index.get(key);
  }
  return null;
}

const ATOM_ID_RE = /\b((?:DECISION|CONSTRAINT|VERIFY|CONTEXT)-\d{2,})\b/i;

// ── ONE COMMIT → ONE ROW, through the one recipe ────────────────────────────────────────────────
export async function processCommit(sha, msg, added, atomIndex, opts = {}) {
  const { docAdd, codeAdd, files, addedLines } = added;
  let pairKind = 'testimony';
  let intentText = (msg + '\n' + docAdd).trim();
  let atomId = null, sessionSlug = null, axesPath;

  let atomMatch = matchCommitToAtom(sha, atomIndex);
  if (!atomMatch && opts.slug) {
    const m = msg.match(ATOM_ID_RE);
    if (m) atomMatch = { slug: opts.slug, atomId: m[1].toUpperCase() };
  }
  if (atomMatch) {
    const atom = resolveAtoms(atomMatch.slug).find((a) => String(a.id).toUpperCase() === String(atomMatch.atomId).toUpperCase());
    if (atom && (atom.rule || atom.quote)) {
      pairKind = 'authored';
      intentText = [atom.rule, atom.quote].filter(Boolean).join('\n').trim();
      atomId = atom.id;
      sessionSlug = atomMatch.slug;
      // a session own axes-144.json is recorded here so the intent is provably per-session, AND
      // (DECISION-017) buildTriptychInputs now threads axesPath to its internal runPipeline call —
      // this row walks the session own 144 axes, not the repo-wide library, when one exists. See
      // scripts/pmu/triptych-build.mjs and tests/pmu/build-triptych-axespath.test.mjs.
      const p = resolve(REPO_ROOT, `.thetacog/tape-sessions/${sessionSlug}/axes-144.json`);
      if (existsSync(p)) axesPath = p;
    }
  }

  const realityText = (codeAdd || docAdd).trim();
  const row = {
    sha: sha.slice(0, 9), fullSha: sha, ts: null, pairKind,
    offPct: null, sigmaDrift: null, refused: true, reason: null,
    coordIntent: null, coordReality: null,
    atomId, sessionSlug, files, addedLines,
  };
  if (!intentText) { row.reason = 'thin-intent'; return row; }
  if (!realityText) { row.reason = 'thin-reality'; return row; }

  try {
    const { buildTriptychInputs } = await import(resolve(REPO_ROOT, 'scripts/pmu/triptych-build.mjs'));
    const { decodeDeltaThreeColourEdges } = await import(resolve(REPO_ROOT, 'scripts/pmu/triptych-render.mjs'));
    const built = await buildTriptychInputs({ intentText, realityText, repoRoot: REPO_ROOT, killTolerancePct: KILL, axesPath });
    const cole = built.renderArgs && built.renderArgs.cole;
    if (!cole || !cole.intent || !cole.reality) { row.reason = 'no-cole'; return row; }
    const tol = decodeDeltaThreeColourEdges(cole.intent.matrix || cole.intent, cole.reality.matrix || cole.reality, KILL);
    if (tol.refused || tol.offPct == null) { row.reason = 'decode-refused'; return row; }
    row.refused = false;
    row.offPct = tol.offPct;
    row.sigmaDrift = Number(built.meta?.matchSigma) || 0;
    row.coordIntent = built.meta?.actorCoord || null;
    row.coordReality = built.meta?.patientCoord || null;
  } catch (e) {
    row.reason = 'pipeline-error:' + String(e?.message || e).slice(0, 100);
  }
  return row;
}

// ── LANE / AGGREGATE MATH — pure, no git, no pipeline. This is what the guard tests. ───────────
export function laneOf(coordIntent) {
  if (!coordIntent) return 'UNKNOWN';
  const [row] = String(coordIntent).split(',');
  return row || 'UNKNOWN';
}

export function laneLabel(lane) {
  return lane === 'UNKNOWN' ? 'UNKNOWN' : `${lane} (${AXNAME[lane] || lane})`;
}

export function splitByPairKind(rows) {
  return {
    testimony: rows.filter((r) => r.pairKind === 'testimony'),
    authored: rows.filter((r) => r.pairKind === 'authored'),
  };
}

// THE REFUSAL THAT IS THE POINT OF THIS GUARD: a testimony pair (message-vs-diff, a model-quality
// signal) and an authored pair (independently-authored spec-vs-diff, a spec-adherence signal) must
// NEVER be averaged into one number — that number would misrepresent what was actually measured.
// Throws rather than silently blending; callers wanting a headline MUST report both kinds' counts.
export function headlineOffPct(rows) {
  const live = rows.filter((r) => !r.refused && r.offPct != null);
  const kinds = new Set(live.map((r) => r.pairKind));
  if (kinds.size > 1) {
    throw new Error('headlineOffPct: refuse to blend testimony and authored pairs into one number — report both counts separately');
  }
  if (!live.length) return null;
  return live.reduce((s, r) => s + r.offPct, 0) / live.length;
}

// laneMomentum(rows) — rows for ONE lane, oldest→newest. Refused/thin rows are EXCLUDED from the
// mean and counted separately (never faked into the series). Trend math is REUSED verbatim from
// lens-traction-monitor.mjs's assessTraction (second-half mean minus first-half mean, EPS dead-band)
// rather than a second slope implementation — `window` is widened to the lane's own full history
// (assessTraction's circuit-breaker default of 8 is tuned for iteration loops, not a multi-week walk).
export function laneMomentum(rows, opts = {}) {
  const live = rows.filter((r) => !r.refused && r.offPct != null);
  const refusedCount = rows.length - live.length;
  const seq = live.map((r) => r.offPct / 100); // assessTraction is calibrated to a 0..1 drift scale
  const a = assessTraction(seq, { window: Math.max(1, seq.length), minHistory: opts.minHistory ?? 3 });
  const half = Math.floor(a.driftSeq.length / 2);
  const firstHalf = a.driftSeq.slice(0, half);
  const secondHalf = a.driftSeq.slice(a.driftSeq.length - half);
  const mean = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  const firstMean = mean(firstHalf), secondMean = mean(secondHalf);
  let verdict = 'UNMEASURED';
  if (a.verdict !== 'INSUFFICIENT-DATA') verdict = a.driftTrend === 'rising' ? 'BLEEDS' : 'HOLDS';
  const { testimony, authored } = splitByPairKind(live);
  return {
    n: live.length, refusedCount,
    firstMeanOffPct: firstMean == null ? null : +(firstMean * 100).toFixed(1),
    secondMeanOffPct: secondMean == null ? null : +(secondMean * 100).toFixed(1),
    deltaOffPct: (firstMean != null && secondMean != null) ? +((secondMean - firstMean) * 100).toFixed(1) : null,
    driftTrend: a.driftTrend, verdict,
    testimonyN: testimony.length, authoredN: authored.length,
  };
}

export function computeLaneTable(rows, opts = {}) {
  const byLane = new Map();
  for (const r of rows) {
    const lane = laneOf(r.coordIntent);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(r);
  }
  const table = [];
  for (const [lane, laneRows] of byLane) table.push({ lane, ...laneMomentum(laneRows, opts) });
  table.sort((a, b) => b.n - a.n);
  return table;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
  const N = Math.max(5, Math.min(500, parseInt(arg('--n', '60'), 10) || 60));
  const slug = arg('--slug', null);
  const laneFilter = arg('--lane', null);
  const since = arg('--since', null);
  const asJson = process.argv.includes('--json');

  const sh = (cmd) => execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 5e7 });
  const logArgs = ['log', '--no-merges', '--format=%H', '-n', String(N)];
  if (since) logArgs.push(`--since=${since}`);
  let shas;
  try { const r = git(logArgs, { cwd: REPO_ROOT }); if (!r.ok) throw new Error(r.reason); shas = r.out.trim().split('\n').filter(Boolean); }
  catch { console.error('✗ not a git repository: ' + REPO_ROOT); process.exit(2); }
  if (!shas.length) { console.error('✗ empty git log'); process.exit(2); }
  shas.reverse(); // oldest → newest

  if (!asJson) console.log(`══════ SEMANTIC MOMENTUM — ${shas.length} commits, oldest→newest — measuring where the prompt holds vs bleeds ══════`);

  const atomIndex = buildCommitAtomIndex();
  const rows = [];
  const t0 = Date.now();
  for (const sha of shas) {
    const msg = sh(`git show -s --format=%B ${sha}`);
    const ts = sh(`git show -s --format=%cI ${sha}`).trim();
    const added = readAddedLines(sha, REPO_ROOT);
    const row = await processCommit(sha, msg, added, atomIndex, { slug });
    row.ts = ts;
    rows.push(row);
    mkdirSync(dirname(SERIES_PATH), { recursive: true });
    appendFileSync(SERIES_PATH, JSON.stringify(row) + '\n');
    if (!asJson) {
      const tag = row.refused ? `REFUSED (${row.reason})` : `off ${String(row.offPct).padStart(3)}% · σ ${row.sigmaDrift.toFixed(2)}`;
      console.log(`  ${row.sha}  [${row.pairKind}]  ${tag}`);
    }
  }
  const wallMs = Date.now() - t0;

  const displayRows = laneFilter ? rows.filter((r) => laneOf(r.coordIntent) === laneFilter || r.coordIntent === laneFilter) : rows;
  const table = computeLaneTable(displayRows);
  const { testimony, authored } = splitByPairKind(rows.filter((r) => !r.refused));
  const refusedTotal = rows.filter((r) => r.refused).length;

  if (asJson) {
    console.log(JSON.stringify({ n: shas.length, since, wallMs, lanes: table, testimonyN: testimony.length, authoredN: authored.length, refusedTotal, rows: displayRows }, null, 2));
  } else {
    console.log(`\n  ── PER-LANE MOMENTUM ${laneFilter ? `(filtered to lane ${laneFilter})` : ''} ──`);
    console.log('  lane                            n  first%  second%  delta   verdict');
    for (const row of table) {
      console.log(`  ${laneLabel(row.lane).padEnd(30)} ${String(row.n).padStart(3)}  ${String(row.firstMeanOffPct ?? '—').padStart(6)}  ${String(row.secondMeanOffPct ?? '—').padStart(7)}  ${String(row.deltaOffPct ?? '—').padStart(6)}  ${row.verdict}  (testimony ${row.testimonyN} / authored ${row.authoredN} / refused ${row.refusedCount})`);
    }
    console.log(`\n  testimony pairs: ${testimony.length} · authored pairs: ${authored.length} · refused (thin, excluded from stats): ${refusedTotal}`);
    if (authored.length === 0) {
      console.log('  ⚠ ZERO authored pairs — this run is measuring TESTIMONY ONLY (message-vs-diff, a model-quality signal), not spec-adherence. That is the weak signal the operator named.');
    }
    console.log(`\n  wall-clock for ${shas.length} commits: ${(wallMs / 1000).toFixed(1)}s`);
    console.log(`  → ${SERIES_PATH.replace(REPO_ROOT + '/', '')}`);
  }
}
