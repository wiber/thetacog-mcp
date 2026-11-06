// scripts/pmu/lattice-meaning.mjs — the per-coordinate SEMANTIC DUMP (Step 1 of the reflexive
// narrative loop, docs/architecture/reflexive-narrative-loop.md).
//
// data/pmu/snippet-library-144.json is the 144-coordinate (12×12) library of semantic dumps — one
// meaningful snippet per ShortLex anchor (coord "row,col" e.g. "A1,A2"). This module loads it once
// and turns a coordinate into its MEANING, so a region named "A,A1" can also carry "what A,A1 means
// in the lattice". The narrative (qwen) and the labels both read from HERE — the meaning is taken
// FROM the lattice, never invented. A spec delegation can override the source with its own reef.
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_LIB = resolve(REPO, 'data/pmu/snippet-library-144.json');
const UNNAMED_LOG = resolve(REPO, '.thetacog/cache/unnamed-coords.ndjson');

// Operator (2026-07-06): "we both have to throw an error or some flag when the panel is empty" —
// a region rendering with NO meaning must never disappear silently into a pretty fallback string in
// one email's HTML. Every empty lookup is (a) a loud console.warn, visible the moment it happens, and
// (b) appended to a durable log so "which coordinates keep coming up unnamed" is a queryable list, not
// something you'd only notice by reading an email closely. De-duplicated per coordinate PER PROCESS
// (not globally) so a single run doesn't spam the same warning hundreds of times.
const _warned = new Set();
function flagUnnamed(coord) {
  if (_warned.has(coord)) return;
  _warned.add(coord);
  console.warn(`⚠️  UNNAMED COORDINATE: "${coord}" has no lattice meaning — a region drew empty. Run scripts/pmu/shortlex-name-children.mjs --write, or check data/pmu/snippet-library-144.json.`);
  try {
    mkdirSync(dirname(UNNAMED_LOG), { recursive: true });
    appendFileSync(UNNAMED_LOG, JSON.stringify({ coord, ts: new Date().toISOString() }) + '\n');
  } catch { /* best-effort log; the console.warn above already fired */ }
}

let _map = null;
function loadMap(libPath = DEFAULT_LIB) {
  const m = new Map();
  try {
    const arr = JSON.parse(readFileSync(libPath, 'utf8'));
    for (const e of (Array.isArray(arr) ? arr : [])) if (e && e.coord) m.set(String(e.coord).trim(), String(e.snippet || '').trim());
  } catch { /* no library → empty map, callers degrade to coord-only */ }
  return m;
}
function map() { if (!_map) _map = loadMap(); return _map; }

// the full semantic dump for a coordinate ("A1,A2") — '' if the library has no entry
export function coordMeaning(coord) { return map().get(String(coord).trim()) || ''; }

// a gist — the first one or two sentences of the dump (capped), enough to actually explain what
// the coordinate means, not just tease it. Longer than a label; the full dump is coordMeaning().
export function coordGist(coord, words = 30) {
  const s = coordMeaning(coord);
  if (!s) { flagUnnamed(String(coord).trim()); return ''; }
  const sents = s.split(/(?<=[.!?])\s/);
  let out = sents[0] || '';
  if (out.split(/\s+/).length < 16 && sents[1]) out += ' ' + sents[1];   // pull a 2nd short sentence for context
  const w = out.split(/\s+/);
  return (w.length <= words ? out : w.slice(0, words).join(' ') + '…').replace(/\s+/g, ' ').trim();
}

// is the coordinate meaning library present?
export function hasMeanings() { return map().size > 0; }

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('lattice-meaning self-check · entries:', map().size);
  for (const c of ['A,A', 'A1,A2', 'C3,C3']) console.log(`  ${c} → ${coordGist(c) || '(no entry)'}`);
}
