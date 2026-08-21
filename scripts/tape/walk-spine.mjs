// packages/thetacog-mcp/scripts/tape/walk-spine.mjs — THE LLM-FREE SPINE, runnable today.
//
// Walks a raw operator text file end to end through everything that does NOT need a model:
//   chunk -> proto-atoms -> place (real Rust ballistic walk) -> lane drift -> series -> 4 HTML reports.
//
// THE EXTRACTION LANE IS DELIBERATELY STUBBED and says so on every row (extractor:"deterministic-stub").
// One proto-atom per substantial operator turn, rule = its first sentence. That is NOT the Geometric
// Sorter — atomizer.mjs is. The stub exists so the SPINE can be measured and shown before the LLM lane
// is built, and so that when the real atomizer lands, the only thing that changes is where atoms come
// from. Nothing downstream of extraction is stubbed: the placements, the lane readings and the AUC are
// the real instrument.
//
// MEASURED 2026-08-20 on GDDadwill.txt: 58 turns -> 19 operator turns -> 19 atoms placed, sensor metal
// on all 19, 729ms total, home A2,B1 (Strategy.Goal + Tactics.Speed), total lane AUC 39, 11 departures.
//
// ── INTEGRATOR FIXES 2026-08-20 (three defects, one of which had already corrupted a live session) ──
//   1. NO MAIN GUARD. Every line ran at IMPORT time, so merely importing this module to check that it
//      loads re-walked the file and rewrote a real session's ledgers. Now: exported `walkSpine()`,
//      executed only when this file IS the entry point.
//   2. THE SLUG WAS HARDCODED. `TAPE_SLUG=billem` wrote into .../billem/ but stamped
//      `slug:'gddadwill'` into its session.json and called generateReports('gddadwill') — so the billem
//      run silently regenerated GDDadwill's reports. That is the exact corruption found live in
//      .thetacog/tape-sessions/billem/session.json. The slug is now threaded through, once.
//   3. `totalLines:1467` WAS A LITERAL — GDDadwill's line count, written into every session whatever
//      the source. Now taken from the segmentation, which is where the number actually comes from.
//   Machine-specific absolute paths also replaced with paths derived from this file's own location.
//
//   node packages/thetacog-mcp/scripts/tape/walk-spine.mjs            # defaults to GDDadwill.txt
//   TAPE_SLUG=billem TAPE_SOURCE=/abs/billEm.txt node .../walk-spine.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as P from './physics.mjs';
import * as C from './chunker.mjs';
import * as R from './html-report.mjs';
import * as store from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const firstSentence = (s) => {
  const m = s.replace(/\s+/g, ' ').match(/^.{40,220}?[.?!]\s/);
  return (m ? m[0] : s.slice(0, 180)).trim();
};

/**
 * walkSpine({src, slug}) -> the measured summary. Deterministic apart from `ts` fields.
 * Writes the session + both ndjson ledgers + the 4 HTML reports for THAT slug.
 */
export async function walkSpine({ src, slug } = {}) {
  const SRC = src || path.join(REPO, 'docs/05-content/blog/scratchpad/GDDadwill.txt');
  const SLUG = slug || store.slugify(SRC);
  const DIR = store.sessionPath(SLUG);
  fs.mkdirSync(DIR, { recursive: true });

  const { turns, totalLines } = C.chunkText(fs.readFileSync(SRC, 'utf8'));

  // one proto-atom per OPERATOR turn (the operator's turns are where directives live)
  const ops = turns.filter((t) => t.role === 'operator' && t.text.length > 300);
  const t0 = Date.now();
  const atoms = []; const vega = []; const reps = [];
  let auc = 0;

  for (let i = 0; i < ops.length; i++) {
    const t = ops[i];
    const quote = t.text.slice(0, 900);
    const rule = firstSentence(t.text);
    const r = await P.placeAtom({ quote, rule, withFidelity: false });
    reps.push(r.coord);
    atoms.push({
      id: `DECISION-${String(i + 1).padStart(3, '0')}`, type: 'DECISION', ts: new Date().toISOString(),
      source: SRC, chunk: [t.startLine, t.endLine], turn: t.index, quote, rule,
      target_surface: null, falsifier: null, coord: r.coord, placement: r.placement, sigma: r.sigma,
      sensor: r.sensor, apertureFidelity: r.apertureFidelity, priority: 'P1',
      status: 'suggested', picked_by: 'ai', parent_id: null, contradicts: [], extractor: 'deterministic-stub',
    });
  }

  const home = P.homeCoord(reps, { min: 8 });
  for (let i = 0; i < atoms.length; i++) {
    const laneDrift = P.driftFrom(home.coord, atoms[i].coord);
    const row = P.vegaRow({ atomId: atoms[i].id, pos: i, coord: atoms[i].coord, sigma: atoms[i].sigma, laneDrift, prevAuc: auc });
    auc = row.laneAuc; atoms[i].laneDrift = laneDrift; vega.push(row);
  }

  // contradiction shortlist across all rules (LLM-free half only)
  let pairs = 0;
  for (let i = 1; i < atoms.length; i++) {
    const sl = P.ncdShortlist(atoms[i].rule, atoms.slice(0, i).map((a) => ({ id: a.id, rule: a.rule })), { k: 3, max: 0.45 });
    if (sl.length) { atoms[i].contradicts = sl.map((s) => s.id); pairs += sl.length; }
  }

  fs.writeFileSync(path.join(DIR, 'session.json'), JSON.stringify({
    version: 1, slug: SLUG, sources: [SRC],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    cursor: turns.length, totalTurns: turns.length, totalLines,
    home: { coord: home.coord, decidedFrom: home.n, support: home.support },
    stats: { atoms: atoms.length, picked: 0, dropped: 0, decided: 0, dispatched: 0, done: 0, contradictions: pairs },
    paused: false, steering: [],
    extraction: 'deterministic-stub — the LLM atomizer lane is not yet built',
  }, null, 2));
  fs.writeFileSync(path.join(DIR, 'specs.ndjson'), atoms.map((a) => JSON.stringify(a)).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'vega-series.ndjson'), vega.map((v) => JSON.stringify(v)).join('\n') + '\n');
  for (const f of ['decisions.ndjson', 'dispatches.ndjson']) {
    if (!fs.existsSync(path.join(DIR, f))) fs.writeFileSync(path.join(DIR, f), '');
  }

  const files = R.generateReports(SLUG, { sessionsDir: store.sessionsDir() });
  return { slug: SLUG, src: SRC, turns: turns.length, totalLines, opsWalked: ops.length, atoms, vega, home, auc, pairs, files, ms: Date.now() - t0 };
}

// ── MAIN GUARD — importing this module must never walk a session ───────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await walkSpine({ src: process.env.TAPE_SOURCE, slug: process.env.TAPE_SLUG });
  console.log(`slug ${r.slug} · turns ${r.turns} · lines ${r.totalLines} · operator turns walked ${r.opsWalked} · atoms ${r.atoms.length} · ${r.ms}ms`);
  console.log(r.home.coord
    ? `home ${r.home.coord} (support ${r.home.support}/${r.home.n}) · total laneAuc ${r.auc} · shortlisted pairs ${r.pairs}`
    : `home UNMEASURED — ${r.home.reason || `only ${r.atoms.length} atom(s) placed, below the support floor`} · total laneAuc ${r.auc} · shortlisted pairs ${r.pairs}`);
  const dist = {}; for (const a of r.atoms) dist[a.coord] = (dist[a.coord] || 0) + 1;
  console.log('placement spread:', Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('departures (laneDrift>=2):', r.atoms.filter((a) => a.laneDrift >= 2).length);
  console.log('sensor: all metal?', r.atoms.every((a) => a.sensor === 'metal'));
  for (const [k, v] of Object.entries(r.files)) console.log(' ', k.padEnd(10), path.relative(REPO, v), fs.statSync(v).size + 'b');
}
