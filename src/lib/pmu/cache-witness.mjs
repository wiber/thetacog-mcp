// src/lib/pmu/cache-witness.mjs
//
// CACHE WITNESS — the physical-slot half of the two-witness lattice.
//
// HISTORY: this was a ballistic-walk scorer (`--ballistic --start <axis>` +
// a scoreWalk over a 144-cell grid). The May-28 20736-cell binary rebuild
// orphaned that contract — the walk's visits moved to 144×144 space and the
// old `cell < 144` filter dropped every one → σ0, always-A, self-recall 1/12.
// PORTED 2026-05-31 onto the live `--sense` scorer (the same 144-anchor SimHash
// the pipeline uses). The orphaned ballistic-walk path was deleted in this port.
//
// Algorithm (current):
//   1. `--sense` the doc against the 144 ShortLex anchor prototypes → scores[144].
//   2. cell = row-rank of the argmax anchor (matches witness_simhash.cell format).
//   3. σ = z-score of the top score against the 144-anchor distribution.
//   Self-recall on the 12 pure-axis snippets: exact 10/12, zone 11/12.
//
// SCOPE (MVP / lossy): sense-derived, so ENTANGLED with the semantic witness by
// design for now. Strict S/H independence (a byte-footprint physical witness via
// the daemon's `--byte-footprint` mode) is the strong-claim upgrade — see
// docs/architecture/pmu-pipeline-fulfilled.md §3.

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { loadAxes } from '../../../scripts/pmu/pipeline-state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const PMU_BIN = resolve(REPO_ROOT, '.thetacog/pmu/target/release/pmu-onchip');

// ── 144-anchor library, lazy-loaded once (the --sense targets) ────────────────
const _RANKS = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
let _anchors = null, _targets = null, _targetLens = null;
function loadAnchors() {
  if (_anchors) return _anchors;
  const raw = loadAxes();
  const sorted = [];
  for (const r1 of _RANKS) for (const r2 of _RANKS) {
    const e = raw.find(a => a.row === r1 && a.col === r2);
    if (e) sorted.push(e);
  }
  _anchors = sorted;
  _targets = sorted.map(a => a.snippet);
  _targetLens = _targets.map(s => gzipSync(Buffer.from(s, 'utf8')).length);
  return _anchors;
}

// cacheCellPredict — the cache witness, PORTED off the orphaned --ballistic path
// (which the May-28 20736-cell binary rebuild broke: scoreWalk dropped every
// out-of-range visit → σ0/always-A) onto the live --sense scorer: the same
// 144-anchor SimHash the pipeline uses. Returns the predicted cell (the row-rank
// of the best-matching anchor, matching witness_simhash.cell's format) + σ
// (z-score of the top anchor score against the 144-anchor distribution).
//
// SCOPE (MVP / lossy, see docs/architecture/pmu-pipeline-fulfilled.md §2.5): this
// is the SimHash-derived reading filling the cache-witness slot — ENTANGLED with
// the semantic witness for now. Strict S/H independence (the byte-footprint
// witness) is the strong-claim upgrade (§3). The --ballistic walk-as-predictor
// was tested and rejected (cardinal-bias collapse → 1/12 vs sense's 10/12); the
// walk stays for the pipeline's heat-cloud POV, not for cell prediction.
// Self-recall on the 12 pure-axis snippets: exact 10/12, zone 11/12.
export function cacheCellPredict(doc, _opts = {}) {
  if (!existsSync(PMU_BIN)) {
    return { cell: null, sigma: 0, status: 'PMU_BIN_MISSING', scores: [] };
  }
  if (!doc || !doc.trim()) {
    return { cell: null, sigma: 0, status: 'EMPTY_DOC', scores: [] };
  }

  const anchors = loadAnchors();
  let out;
  try {
    out = JSON.parse(execSync(`"${PMU_BIN}" --sense`, {
      input: JSON.stringify({ claims: [doc], targets: _targets, target_lens: _targetLens, simhash_only: false }),
      encoding: 'utf8',
      maxBuffer: 200 * 1024 * 1024,
    }));
  } catch (e) {
    return { cell: null, sigma: 0, status: 'SENSE_ERR', error: String(e).slice(0, 120), scores: [] };
  }

  const s = out.scores || [];
  if (!s.length) return { cell: null, sigma: 0, status: 'SENSE_EMPTY', scores: [] };

  let mi = 0;
  for (let i = 1; i < s.length; i++) if (s[i] > s[mi]) mi = i;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  const sigma = std > 0 ? (s[mi] - mean) / std : 0;
  const top5 = s
    .map((v, i) => ({ rank: anchors[i]?.row, coord: anchors[i]?.coord, score: v }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    cell: anchors[mi]?.row ?? null,        // row-rank — matches witness_simhash.cell
    coord: anchors[mi]?.coord ?? null,     // full anchor pair, for audit
    sigma,
    status: 'SENSE_OK',
    scores: top5,
    grid_population: s.length,
    method: 'rust-simhash --sense, 144-anchor argmax, σ z-score',
  };
}
