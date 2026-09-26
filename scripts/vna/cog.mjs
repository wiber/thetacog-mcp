#!/usr/bin/env node
// scripts/vna/cog.mjs — C93a THE MINT. The cog is a unit of WORK, minted from the COMMIT and never from the prompt
// (operator 2026-09-19: "peg the no-arbitrage token to complexity of work based on measurements"). A prompt-minted unit
// inflates with a longer prompt; a commit-minted unit cannot — its inputs are decidable facts of the receipt, and the gate
// is the RED WITNESS: the guard the commit changed fails on the parent tree and passes at HEAD (C66's redWitness, read
// from the runner's verdict row when the runner made the commit, recomputed the runner's way otherwise). NO RED WITNESS,
// NO COG — the mint reads 0 and says why. The weights are an estimate, declared in data/vna/cog-weights.json and moved
// only by C93e's calibration ratchet; the gate is a gate, never a weight. LLM-free: git, the tree, the runner tape.
//   node scripts/vna/cog.mjs <sha> [--no-recompute] [--json]        one commit, printed
//   node scripts/vna/cog.mjs --since <sha> [--no-recompute]         one row per commit appended to data/vna/cog.ndjson (idempotent on sha)
import { readFileSync, appendFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const WEIGHTS = process.env.VNA_COG_WEIGHTS || resolve(REPO, 'data/vna/cog-weights.json');
export const COG_NDJSON = process.env.VNA_COG_NDJSON || resolve(REPO, 'data/vna/cog.ndjson');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const SPEC_REL = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';
export const TAPE = process.env.VNA_FLIGHT_TAPE || resolve(REPO, 'data/vna/flight-tape.ndjson');
export const PREDICT_NDJSON = process.env.VNA_COG_PREDICT || resolve(REPO, 'data/vna/cog-predict.ndjson');
const blockXY = (cell) => { const [r, c] = String(cell).split(','); const ix = (x) => 'ABC'.indexOf(String(x).replace(/\d+$/, '')); return [ix(r), ix(c)]; };   // the 3×3 block grid coordinates of a cell
/** the poles — the farthest pair of lit cells on the full 12×12 lattice (row A1…C3 × col A1…C3 → 0…8 each, then the 144-cell index): the two subsystems a task must reconcile */
const cellXY = (cell) => { const ix = (t) => { const m = /^([ABC])(\d)?$/.exec(String(t).trim()); if (!m) return -1; return 'ABC'.indexOf(m[1]) * 3 + (m[2] ? Number(m[2]) - 1 : 1); }; const [r, c] = String(cell).split(','); return [ix(r), ix(c)]; };
export function polarSeparation(cells) { const pts = cells.map((c) => [c, ...cellXY(c)]).filter((p) => p[1] >= 0 && p[2] >= 0); let best = { polar: 0, poles: pts.length ? [pts[0][0], pts[0][0]] : [] }; for (const a of pts) for (const b of pts) { const d = Math.max(Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])); if (d > best.polar) best = { polar: d, poles: [a[0], b[0]] }; } return best; }
export function chebyshevRadius(cells) { const pts = cells.map(blockXY).filter(([a, b]) => a >= 0 && b >= 0); let r = 0; for (const p of pts) for (const q of pts) r = Math.max(r, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])); return r; }
/** gzip-NCD — the canonical sensor: NCD(a,b) = (C(ab) − min(C(a),C(b))) / max(C(a),C(b)), in [0,1] */
export function ncd(a, b) { const C = (x) => gzipSync(Buffer.from(String(x), 'utf8')).length; const ca = C(a), cb = C(b), cab = C(String(a) + String(b)); return Math.max(0, Math.min(1, (cab - Math.min(ca, cb)) / Math.max(ca, cb, 1))); }
/** the row against the files it names: the largest NCD across them — crossing into a foreign subsystem reads high; null when nothing named is on disk */
export function ncdCross(rowText, paths, repo = REPO) { const on = paths.filter((f) => { try { return statSync(resolve(repo, f)).isFile(); } catch { return false; } }); if (!rowText || !on.length) return null; let m = 0, read = 0; for (const f of on) { read++; let t = ''; try { t = readFileSync(resolve(repo, f), 'utf8').slice(0, Math.max(2048, String(rowText).length * 4)); } catch { continue; } /* bounded asymmetry: NCD of a small text against a huge one reads size, not novelty */ m = Math.max(m, ncd(rowText, t)); } return read ? Math.round(m * 1000) / 1000 : null; }
export function lcaDepth(paths) { const ps = paths.map((x) => String(x).split('/').slice(0, -1)).filter((x) => x.length); if (!ps.length) return null; let d = 0; for (;; d++) { const seg = ps[0][d]; if (seg == null || !ps.every((x) => x[d] === seg)) break; } return d; }
export const blockOf = (cell) => String(cell).split(',').map((c) => c.replace(/\d+$/, '')).join(',');   // 'A1,B3' → 'A,B' — the 3×3 block of a 144-cell coordinate
const ROW_RE = /^\s*- \[( |x)\] (C\d+[a-z]?|T\d+)\b/;
const LABEL_RE = /\bC\d{1,3}[a-z]?\b/g;
const isTestPath = (f) => /^tests\/.*\.(test\.)?m?js$/.test(f);
const git = (repo, ...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };
const ndRows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

export function readWeights(path = WEIGHTS) { return JSON.parse(readFileSync(path, 'utf8')); }
// C93o — THE BANDS A TICKING COMMIT CAN REACH is a function of the weights, never a constant: a commit that ticks one row in one basin
// weighs rows_ticked + basins_touched before a single term, file or line. Under v1 that is 1.5 and band s ends at 1 — so every s row
// on the record is an unticked commit, and a runner dispatch (which closes only by ticking) can never land there; minting a band by
// withholding the tick is arbitrage. The finding rides the weights: the day C93e's fit lightens them, s flips reachable on its own.
export function minTickingCog(weights) { return Number(weights.weights.rows_ticked || 0) + Number(weights.weights.basins_touched || 0); }
// C93l — THE LIT FLOOR: the fewest cells the one Rust walk has lit on any minted, non-partial row whose walk landed (57 rows on
// 2026-09-19: min 99, median 136 of 144). Read off the record, never typed. A commit whose walk lands weighs at least
// basins_touched + lit_floor × lit_reality before its tick — 0.5 + 99 × 0.02 ≈ 2.5 under v1, 3.5 ticked — so s AND m are out of
// reach for any pegged commit; the s/m pegs on file were set by rows minted before the lattice input existed and are LEGACY.
export function litFloor(cogRows) { const lit = []; const newest = new Map(); for (const r of cogRows || []) newest.set(r.sha, r); for (const r of newest.values()) if (r.minted && !r.partial && r.inputs && r.inputs.lattice && r.inputs.lattice.status === 'landed' && Number.isFinite(r.inputs.lit_reality)) lit.push(r.inputs.lit_reality); return lit.length ? { floor: Math.min(...lit), n: lit.length, source: 'data/vna/cog.ndjson minted rows with a landed walk' } : { floor: null, n: 0, status: 'UNMEASURED', why: 'no minted row with a landed walk on the record' }; }
export function bandReach(weights, { litFloor: lf = null } = {}) {
  const min = minTickingCog(weights); const w = weights.weights;
  const landedMin = lf && Number.isFinite(lf.floor) ? Number(w.basins_touched || 0) + lf.floor * Number(w.lit_reality || 0) + Number(w.rows_ticked || 0) : null;
  const out = { weights_v: weights.v, min_ticking_cog: min, lit_floor: lf ? lf.floor : null, lit_floor_n: lf ? lf.n : 0, min_landed_ticking_cog: landedMin };
  for (const b of weights.bands) out[b.name] = { max: b.max, min_cog: min, reachable_by_ticking_commit: b.max == null || min <= b.max, reachable_by_landed_ticking_commit: landedMin == null ? null : (b.max == null || landedMin <= b.max) };
  return out;
}
export function bandOf(cog, weights) { for (const b of weights.bands) if (b.max == null || cog <= b.max) return b.name; return weights.bands[weights.bands.length - 1].name; }

/** the decidable facts of one commit — git only */
export function commitFacts({ sha, repo = REPO }) {
  const full = git(repo, 'rev-parse', sha); if (!full) return null;
  const numstat = (git(repo, 'show', '--numstat', '--format=', full) || '').split('\n').filter(Boolean).map((l) => { const [a, d, ...f] = l.split('\t'); return { file: f.join('\t'), ins: a === '-' ? 0 : +a, del: d === '-' ? 0 : +d }; });
  const files = numstat.map((n) => n.file);
  const insertions = numstat.reduce((s, n) => s + n.ins, 0), deletions = numstat.reduce((s, n) => s + n.del, 0);
  // rows newly ticked: a `+ - [x] Cnn` line whose label had no `- [x]` line removed in the same hunk
  const spec = git(repo, 'show', '--format=', full, '--', SPEC_REL) || '';
  const plusX = new Set(), minusX = new Set();
  for (const l of spec.split('\n')) { if (!/^[+-]/.test(l) || /^(\+\+\+|---)/.test(l)) continue; const m = ROW_RE.exec(l.slice(1)); if (!m || m[1] !== 'x') continue; (l[0] === '+' ? plusX : minusX).add(m[2]); }
  const rows_ticked = [...plusX].filter((l) => !minusX.has(l)).sort();
  const message = git(repo, 'log', '-1', '--format=%s%n%b', full) || '';
  const labels_named = [...new Set((message.match(LABEL_RE) || []))].sort();
  const at = git(repo, 'log', '-1', '--format=%cI', full);
  return { sha: full, at, files, tests: files.filter(isTestPath), insertions, deletions, rows_ticked, labels_named, subject: message.split('\n')[0] };
}

/** the runner's verdict row for this commit, when the runner made it (C66 writes `work` = the graded sha) */
export function runnerRowFor(sha, rows = ndRows(RUNNER_NDJSON)) { const s = String(sha); return rows.filter((r) => r.kind === 'verdict' && r.work && s.startsWith(String(r.work).slice(0, 10))).pop() || null; }

/** the red witness: the runner's, else recomputed the runner's way; a commit that changed no test is unwitnessed by construction */
export async function redWitnessFor({ facts, repo = REPO, runnerRows, recompute = true, scratchRoot = resolve(tmpdir(), 'vna-cog') }) {
  const r = runnerRowFor(facts.sha, runnerRows);
  if (r && r.gates && r.gates.redWitness) return { status: r.gates.redWitness === 'RED' ? 'witnessed' : r.gates.redWitness === 'UNMEASURED' ? 'UNMEASURED' : 'unwitnessed', guards: r.tests || facts.tests, source: 'runner', why: r.redWhy || null };
  if (!facts.tests.length) return { status: 'unwitnessed', guards: [], source: 'git', why: 'the commit changed no file under tests/' };
  if (!recompute) return { status: 'UNMEASURED', guards: facts.tests, source: 'none', why: 'no runner row and --no-recompute' };
  const { redWitness } = await import('./steer-runner.mjs');
  mkdirSync(scratchRoot, { recursive: true });
  const v = redWitness({ repo, head: facts.sha, tests: facts.tests, scratchRoot });
  return { status: v.verdict === 'RED' ? 'witnessed' : v.verdict === 'UNMEASURED' ? 'UNMEASURED' : 'unwitnessed', guards: facts.tests, source: 'recomputed', why: v.why };
}

/** THE TESSERACT'S OWN READING of the commit (operator 2026-09-19: "use the tesseract itself to estimate the complexity of tasks"):
 *  the flight tape's commit row carries the one Rust walk's delta once it lands — litReality (cells the work lit), laneJump (blocks
 *  moved), offPct (scope-breadth). Read from the tape, never from a noun count; UNMEASURED until the walk lands, and then the row is PARTIAL. */
export function latticeFacts({ sha, tapeRows = ndRows(TAPE) }) {
  const r = tapeRows.filter((x) => x.kind === 'commit' && x.sha && String(x.sha).startsWith(String(sha).slice(0, 10))).pop();
  const d = r && r.delta; if (!d || d.status !== 'landed') return { status: 'UNMEASURED', why: d && d.status ? String(d.status).slice(0, 80) : 'no commit row on the flight tape yet', lit_reality: 0, lane_jump: 0, off_pct: null };
  return { status: 'landed', lit_reality: Number(d.litReality) || 0, lane_jump: Number(d.laneJump) || 0, off_pct: Number.isFinite(d.offPct) ? d.offPct : null, sigma_drift: d.sigmaDrift ?? null, source: 'flight-tape commit row .delta (the one Rust walk)' };
}

/** C93f THE PREDICTION — before the work, from the row's OWN walk (operator 2026-09-19: "what the L1 ballistic walk and the NCD
 *  compression can do … a loose fit across the whole or a large part — if you need a lot of different competence areas … predict ahead
 *  of time and then update the algorithm as we use it"). Inputs: the cells the row's text lit, the distinct 3×3 blocks among them
 *  (the competence spread), the row's gzip mass, its unresolved C59 terms, its sigma. Never a noun count; UNMEASURED when the row
 *  has no walk. Appended once per (label, row hash) to data/vna/cog-predict.ndjson so the realized mint can be scored against it. */
export function predictOf({ label, tree, weights = readWeights(), rowText = null, repo = REPO }) {
  const n = tree && tree.nodes && tree.nodes[`n_spec_${label}`]; if (!n) return { label, status: 'UNMEASURED', why: 'no basin for the label', predicted: null };
  const wk = n.walk || {}; const cells = Array.isArray(wk.cells) ? wk.cells : [];
  if (!cells.length) return { label, status: 'UNMEASURED', why: 'the row has no walk yet', predicted: null, hash: n.hash };
  const blocks = new Set(cells.map(blockOf)).size; const gzip_kb = ((n.mass && n.mass.gzip) || 0) / 1024;
  // the seventh dictation: SPREAD (many blocks — many kinds of assistance working together) vs DEPTH (long but focused on one thing) —
  // depth is the share of the walk's trajectory steps on its modal cell; the shape is named from the two, never from the prose
  const traj = Array.isArray(wk.trajectory) ? wk.trajectory : []; const counts = {}; for (const c of traj) counts[c] = (counts[c] || 0) + 1;
  const depth = traj.length ? Math.round((Math.max(...Object.values(counts)) / traj.length) * 100) / 100 : 0;
  const terms = (n.defs && n.defs.terms) || []; const terms_unresolved = terms.filter((t) => !(t.exists || t.first || t.rule)).length;
  const radius = chebyshevRadius(cells);   // the footprint's Chebyshev span over the block grid — the dispersed mosaic reads 2, the dense core 0
  const { polar, poles } = polarSeparation(cells);   // far from both sides: the farthest pair of lit cells on the 12×12, and which two they are
  const pathTerms = terms.filter((t) => t.kind === 'path').map((t) => t.term); const lca_depth = lcaDepth(pathTerms);
  const ncd_cross = ncdCross(rowText, pathTerms, repo);   // the ninth paste's one sourced lever: the row against what it touches, by the canonical sensor   // the common directory of the paths the row names: 0 = root sprawl, deep = local
  const wide = blocks >= 5 || radius >= 2, focused = depth >= 0.6;   // the mosaic is wide by count or by span; the needle is focused by the trajectory
  const shape = wide && focused ? 'spread+focused' : wide ? 'spread' : focused ? 'focused' : 'narrow';
  const inputs = { cells: cells.length, blocks, radius, polar, depth, lca_depth, ncd_cross, gzip_kb: Math.round(gzip_kb * 100) / 100, terms_unresolved, sigma: Number(wk.sigma) || 0, admissible: !!wk.admissible };
  const pw = weights.predict.weights; const predicted = Math.round(Object.entries(pw).reduce((a, [k, v]) => a + v * (Number(inputs[k]) || 0), 0) * 1000) / 1000;
  return { label, status: 'predicted', predicted, band: bandOf(predicted, weights), shape, poles, inputs, hash: n.hash, pixel: n.pixel || wk.pixel || null, predict_v: weights.predict.v, source: 'the row\'s own walk in data/vna/spec-tree.json' };
}
export function appendPrediction({ label, tree, path = PREDICT_NDJSON, at = new Date().toISOString(), ...rest }) {
  const p = predictOf({ label, tree, ...rest }); if (p.status !== 'predicted') return { ...p, appended: false };
  const have = ndRows(path).some((r) => r.label === label && r.hash === p.hash); if (have) return { ...p, appended: false };
  mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify({ at, ...p }) + '\n'); return { ...p, appended: true };
}
export function predictionFor(labels, rows = ndRows(PREDICT_NDJSON)) { const hits = rows.filter((r) => labels.includes(r.label)); if (!hits.length) return null; const newest = new Map(); for (const h of hits) newest.set(h.label, h); const vals = [...newest.values()]; return { predicted: Math.round(vals.reduce((a, r) => a + (r.predicted || 0), 0) * 1000) / 1000, labels: vals.map((r) => r.label) }; }

/** DIFFICULTY — how hard it turned out: commits naming the label before this one (attempts), runner halts on the label */
export function difficultyFacts({ facts, repo = REPO, runnerRows = ndRows(RUNNER_NDJSON) }) {
  const labels = facts.rows_ticked.length ? facts.rows_ticked : facts.labels_named; if (!labels.length) return { attempts: 0, halts: 0 };
  const log = git(repo, 'log', '--format=%H %s', `${facts.sha}~1`, '-n', '400') || '';
  const attempts = log.split('\n').filter((l) => l && !/ chore\(commit-page\):/.test(l) && labels.some((L) => new RegExp(`\\b${L}\\b`).test(l))).length;
  const halts = runnerRows.filter((r) => r.kind === 'halt' && labels.includes(r.label)).length;
  return { attempts, halts };
}

/** the tree's facts for the rows this commit names — basins, and the C59 terms resolved on the ticked rows */
export function treeFacts({ facts, tree }) {
  const nodes = (tree && tree.nodes) || {};
  const basins_touched = facts.labels_named.filter((l) => nodes[`n_spec_${l}`] && nodes[`n_spec_${l}`].basin && !nodes[`n_spec_${l}`].retracted).length;
  const terms_resolved = facts.rows_ticked.reduce((s, l) => { const n = nodes[`n_spec_${l}`]; const terms = (n && n.defs && n.defs.terms) || []; return s + terms.filter((t) => t.exists || t.first || t.rule).length; }, 0);
  return { basins_touched, terms_resolved };
}

export async function cogOf({ sha, repo = REPO, tree = null, runnerRows = undefined, tapeRows = undefined, weights = readWeights(), recompute = true }) {
  const facts = commitFacts({ sha, repo }); if (!facts) return null;
  const T = tree || (existsSync(TREE) ? JSON.parse(readFileSync(TREE, 'utf8')) : { nodes: {} });
  const rw = await redWitnessFor({ facts, repo, runnerRows, recompute });
  const tf = treeFacts({ facts, tree: T }); const lat = latticeFacts({ sha: facts.sha, tapeRows }); const df = difficultyFacts({ facts, repo, runnerRows: runnerRows === undefined ? undefined : runnerRows });
  const density = lat.status === 'landed' && lat.lit_reality > 0 ? Math.round((facts.insertions / lat.lit_reality) * 100) / 100 : null;   // in-basin concentration: insertions per cell the walk lit
  const inputs = { rows_ticked: facts.rows_ticked.length, red_witness: rw, files: facts.files.length, insertions: facts.insertions, deletions: facts.deletions, ...tf, lit_reality: lat.lit_reality, lane_jump: lat.lane_jump, density, lca_depth: lcaDepth(facts.files), lattice: lat, ...df };
  const raw = Object.entries(weights.weights).reduce((s, [k, w]) => s + w * (Number(inputs[k]) || 0), 0);
  const onRecord = facts.rows_ticked.length > 0 || tf.basins_touched > 0;   // the work names or ticks a live basin — a red test with no row is not work on the record
  const minted = rw.status === 'witnessed' && onRecord;   // the gate: a witnessed guard AND a basin it belongs to
  const cog = minted ? Math.round(raw * 1000) / 1000 : 0;
  const why = minted ? null : rw.status !== 'witnessed' ? `no red witness (${rw.status}: ${rw.why})` : 'the commit neither ticks nor names a live basin';
  const partial = minted && lat.status !== 'landed';   // minted for the graph; the peg waits for the walk (no arbitrage on a half measurement)
  const pred = predictionFor(facts.rows_ticked.length ? facts.rows_ticked : facts.labels_named);   // C93f: scored against the prediction made before the work
  const residual = minted && pred && pred.predicted > 0 ? Math.round((cog / pred.predicted) * 100) / 100 : null;   // > 1: harder than we thought
  return { sha: facts.sha, at: facts.at, subject: facts.subject, cog, band: bandOf(cog, weights), minted, partial, why, inputs, predicted: pred ? pred.predicted : null, residual, rows_ticked: facts.rows_ticked, labels_named: facts.labels_named, weights_v: weights.v };
}

export async function appendSince({ since, repo = REPO, path = COG_NDJSON, ...rest }) {
  const shas = (git(repo, 'rev-list', '--reverse', '--no-merges', `${since}..HEAD`) || '').split('\n').filter(Boolean);
  const newest = new Map(); for (const r of ndRows(path)) newest.set(r.sha, r); const out = [];
  const tapeRows = rest.tapeRows || ndRows(TAPE);
  for (const sha of shas) {
    const prev = newest.get(sha);
    if (prev && !(prev.partial && latticeFacts({ sha, tapeRows }).status === 'landed')) continue;   // done, or still waiting for the walk
    const row = await cogOf({ sha, repo, ...rest, tapeRows, recompute: prev ? false : rest.recompute, runnerRows: prev ? [{ kind: 'verdict', work: sha, gates: { redWitness: prev.inputs.red_witness.status === 'witnessed' ? 'RED' : prev.inputs.red_witness.status === 'UNMEASURED' ? 'UNMEASURED' : 'GREEN-ON-PARENT' }, tests: prev.inputs.red_witness.guards, redWhy: prev.inputs.red_witness.why }, ...(rest.runnerRows || [])] : rest.runnerRows });
    if (!row) continue; if (prev) row.inputs.red_witness.source = prev.inputs.red_witness.source;   // the witness is the one already on record
    mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(row) + '\n'); out.push(row);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const recompute = !argv.includes('--no-recompute');
  if (arg('--predict')) { const T = existsSync(TREE) ? JSON.parse(readFileSync(TREE, 'utf8')) : { nodes: {} }; const labels = argv.slice(argv.indexOf('--predict') + 1).filter((a) => !a.startsWith('--')); const rowsMd = (() => { try { return readFileSync(resolve(REPO, SPEC_REL), 'utf8').split('\n'); } catch { return []; } })(); const textOf = (l) => { const line = rowsMd.find((x) => ROW_RE.test(x) && ROW_RE.exec(x)[2] === l); return line || null; }; for (const l of labels) { const p = appendPrediction({ label: l, tree: T, rowText: textOf(l) }); console.log(`${l} · ${p.status === 'predicted' ? `predicted ${p.predicted} (${p.band}) · ${JSON.stringify(p.inputs)}${p.appended ? '' : ' · already on record'}` : `UNMEASURED — ${p.why}`}`); } process.exit(0); }
  if (arg('--since')) { const rows = await appendSince({ since: arg('--since'), recompute }); console.log(`${rows.length} row${rows.length === 1 ? '' : 's'} appended → ${COG_NDJSON}`); for (const r of rows) console.log(`  ${r.sha.slice(0, 10)} cog ${r.cog} ${r.minted ? `(${r.band}${r.partial ? ' · PARTIAL — walk not landed' : ''}${r.residual != null ? ` · predicted ${r.predicted} · residual ${r.residual}${r.residual > 1 ? ' harder than we thought' : ''}` : ''})` : `— ${r.why}`}`); process.exit(0); }
  const sha = argv.find((a) => !a.startsWith('--')); if (!sha) { console.error('node scripts/vna/cog.mjs <sha> | --since <sha> | --predict <label…> [--no-recompute] [--json]'); process.exit(2); }
  const row = await cogOf({ sha, recompute }); if (!row) { console.error(`no such commit: ${sha}`); process.exit(2); }
  if (argv.includes('--json')) console.log(JSON.stringify(row)); else console.log(`${row.sha.slice(0, 10)} · cog ${row.cog} ${row.minted ? `· band ${row.band}` : `· not minted — ${row.why}`}\n  inputs ${JSON.stringify({ ...row.inputs, red_witness: row.inputs.red_witness.status })} · weights v${row.weights_v}`);
}
