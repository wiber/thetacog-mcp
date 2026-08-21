#!/usr/bin/env node
// scripts/pmu/big-map-axes.mjs — THIS GENERATES THE BIG MAP'S AXES, AS A POV.
//
// Say it plainly, in code: the 12^3 = 1,728-node ShortLex axis set written here IS one side of
// THE BIG MAP — the definition set that grows into the playground everyone compares to. And
// there is deliberately NO single canonical copy of it anywhere: what this script writes is
// THIS SURFACE'S POINT OF VIEW — seeded from the libraries this repo ships, collated from the
// axis dumps of the surfaces this repo WATCHES (its fork graph + tape/subscriptions.json).
// Every fork runs the same generator over ITS OWN watchlist and gets its own POV; the REALITY
// version — the large, general, SELF-IMPROVING competence map — is what emerges where POVs
// overlap and keep agreeing under recomputation. Consensus by overlap, never by master file.
//
// Discovery is a browsing action, on purpose: your local AI finds tone-setting repos to watch
// the way anyone browses GitHub, and adds them to tape/subscriptions.json. No new infra.
//
//   npx thetacog-mcp big-map-axes              → axes/axes-1728.json (offline, deterministic:
//                                                seeds + any LOCAL axes/<X>/<Y>/<Z>.dump.json)
//   npx thetacog-mcp big-map-axes --collate    → also fetches watched surfaces' dumps
//                                                [requires: network — labeled, never assumed]
//
// EXTRACTIVE LAW AT EVERY SCALE: seeds are SELECTED from the shipped 144 libraries (real
// passages, never composed); collated snippets arrive with their source surface + sha; the
// SEEDING HEURISTIC (parent-plane snippet + child self-definition) is one replaceable choice,
// labeled as such — the FORMAT is the contract, the heuristic is v0.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTDIR = resolve(PKG, 'packages/thetacog-mcp/axes');
const COLLATE = process.argv.includes('--collate');
const SY = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const NAME = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund', B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };

let lib = JSON.parse(readFileSync(resolve(PKG, 'data/pmu/snippet-library-144.json'), 'utf8'));
if (!Array.isArray(lib)) lib = lib.anchors || lib.nodes || [];
const snip = (r, c) => { const e = lib.find((t) => t.coord === `${r},${c}`); return e ? String(e.snippet || '').replace(/\s+/g, ' ').trim() : ''; };

// the watchlist = this POV's horizon
let watch = [];
try { watch = JSON.parse(readFileSync(resolve(PKG, 'packages/thetacog-mcp/tape/subscriptions.json'), 'utf8')).map((s) => s.surface || s); } catch { /* none */ }

// collated dumps: local axes/<X>/<Y>/<Z>.dump.json always; watched surfaces' dumps with --collate
const collated = {};
const fold = (path, snippets, source) => {
  if (!collated[path]) collated[path] = [];
  for (const s of snippets || []) { const h = createHash('sha256').update(String(s)).digest('hex'); if (!collated[path].some((x) => x.sha === h)) collated[path].push({ snippet: String(s).slice(0, 400), sha: h, source }); }
};
for (const x of SY) for (const y of SY) for (const z of SY) {
  const p = resolve(OUTDIR, x, y, `${z}.dump.json`);
  if (existsSync(p)) { try { const d = JSON.parse(readFileSync(p, 'utf8')); fold(`${x}/${y}/${z}`, d.snippets, 'local'); } catch { /* skip */ } }
}
if (COLLATE) {
  for (const surface of watch) {
    const m = String(surface).match(/github\.com\/([^/]+\/[^/]+)/); if (!m) continue;
    for (const x of SY) for (const y of SY) for (const z of SY) {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/HEAD/axes/${x}/${y}/${z}.dump.json`);
        if (r.ok) { const d = await r.json(); fold(`${x}/${y}/${z}`, d.snippets, surface); }
      } catch { /* absent = nothing to fold */ }
    }
  }
}

const nodes = [];
for (const x of SY) for (const y of SY) for (const z of SY) {
  const path = `${x}/${y}/${z}`;
  const seeds = [snip(x, y), snip(z, z)].filter(Boolean).map((s) => s.slice(0, 240));
  const coll = collated[path] || [];
  nodes.push({
    path, name: `${NAME[x]} × ${NAME[y]} → ${NAME[z]}`,
    seed_snippets: seeds,
    seed_provenance: [`snippet-library-144 @ ${x},${y}`, `snippet-library-144 @ ${z},${z}`],
    collated: coll,
    status: coll.length ? `COLLATED (${coll.length} snippet(s) from ${[...new Set(coll.map((c) => c.source))].length} source(s))` : 'SEED — v0 heuristic (parent-plane + child self-definition), replaceable; refined dumps supersede by collation',
  });
}
const registry = {
  _this_is: 'THE BIG MAP — one SIDE, as THIS SURFACE\'S POV: the 12^3 ShortLex axis set (1,728 nodes). The 2D map is the ordered-pair square (2,985,984 cells, RAM-native). No canonical copy exists anywhere — every fork generates its own POV over its own watchlist; the reality version is where POVs overlap and keep agreeing under recomputation.',
  _becomes: 'the definition set that grows into the playground everyone compares to — the large general self-improving competence map',
  _pov_watchlist: watch,
  _regenerate: 'npx thetacog-mcp big-map-axes [--collate requires network] — offline run is deterministic (byte-identical from the same libraries + local dumps)',
  _dumps_live_at: 'axes/<X>/<Y>/<Z>.dump.json (per-node refined dumps, this repo); watched surfaces\' dumps fold in via --collate',
  side: 1728, cells: 1728 * 1728,
  source_sha256: createHash('sha256').update(JSON.stringify(lib)).digest('hex').slice(0, 16),
  nodes,
};
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(resolve(OUTDIR, 'axes-1728.json'), JSON.stringify(registry, null, 1));
console.log(`◎ THE BIG MAP (this surface's POV): ${nodes.length} axis nodes → axes/axes-1728.json`);
console.log(`  watchlist: ${watch.length} surface(s) · collated nodes: ${nodes.filter((n) => n.collated.length).length} · seeds from shipped libs (sha ${registry.source_sha256})`);
