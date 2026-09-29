// src/lib/pmu/lane-paths.mjs — THE LANE → PATHS MAP, read from the reef's own declaration (G1 of spec §8.29; KR18's bridge).
//
// The map was never missing; it was never parsed. Every reef lane in data/pmu/lens-reef.json carries a `tools` field written
// BEFORE any walk ran — "scripts/pmu/*, src/lib/pmu/compress.mjs, pmu-onchip --ballistic" — a declaration of the part of
// the tree the lane governs, mixed with tool names that are not paths. This module keeps the tokens that resolve to a path
// in the repo at HEAD (a file, or a directory prefix, `*` and `./` stripped) and drops the rest, so the map is DECLARED
// (intent, AXIOM 1: a lane declared before it ran) and CHECKABLE (every glob exists). One convention is added and named:
// a `blog: <topic>` tool means src/content/blog — the lane's essays live there and nowhere else.
//
// What it is NOT: a learned association from commits (that would make KR18 read its own training set), and not a claim
// that a lane touches only these paths — KR18 measures whether the commit that followed touched what the lane named.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REEF = resolve(REPO, 'data/pmu/lens-reef.json');
const BLOG_DIR = 'src/content/blog';
let _map = null;

/** one `tools` string → the repo paths it names (deduped, sorted), or [] */
export function pathsFromTools(tools, { repo = REPO } = {}) {
  const out = new Set();
  for (let tok of String(tools || '').split(/[,\s]+/)) {
    if (!tok) continue;
    if (/^blog:?$/.test(tok)) { out.add(BLOG_DIR); continue; }
    if (tok.startsWith('~') || tok.startsWith('/') || tok.startsWith('-') || !/[\/.]/.test(tok)) continue;   // an option, a home or absolute path, a bare word — judged on the token as written
    tok = tok.replace(/^\.\//, '').replace(/\/?\*+$/, '').replace(/[),;:]+$/, '');
    if (!tok) continue;
    const abs = resolve(repo, tok);
    if (!abs.startsWith(repo) || !existsSync(abs)) continue;
    out.add(tok);
  }
  return [...out].sort();
}

/** { lane → paths[] } for every reef lane; lanes whose tools name no repo path map to [] (they are reported, never guessed) */
export function lanePathMap({ repo = REPO, reefPath = REEF } = {}) {
  if (_map && repo === REPO && reefPath === REEF) return _map;
  const domains = JSON.parse(readFileSync(reefPath, 'utf8')).domains || [];
  const m = {}; for (const d of domains) m[d.domain] = pathsFromTools(d.tools, { repo });
  if (repo === REPO && reefPath === REEF) _map = m;
  return m;
}
export const lanePaths = (lane, opts) => lanePathMap(opts)[lane] || [];
/** does a repo-relative path fall under one of the lane's declared paths? (a declared file matches itself; a directory matches its subtree) */
export function pathInLane(path, lane, opts) { const p = String(path).replace(/^\.\//, ''); return lanePaths(lane, opts).some((g) => p === g || p.startsWith(g.endsWith('/') ? g : g + '/')); }
export function lanesForPath(path, opts) { const m = lanePathMap(opts); return Object.keys(m).filter((l) => pathInLane(path, l, opts)); }
/** coverage of a set of touched paths: how many fall under ≥ 1 lane, and how many lanes each covered path has (breadth) */
export function coverage(paths, opts) {
  let covered = 0, lanesTotal = 0; const byLane = {};
  for (const p of paths) { const ls = lanesForPath(p, opts); if (ls.length) { covered++; lanesTotal += ls.length; for (const l of ls) byLane[l] = (byLane[l] || 0) + 1; } }
  return { paths: paths.length, covered, covered_share: paths.length ? +(covered / paths.length).toFixed(3) : 0, lanes_per_covered_path: covered ? +(lanesTotal / covered).toFixed(2) : 0, by_lane: byLane };
}
export function isDir(p, repo = REPO) { try { return statSync(resolve(repo, p)).isDirectory(); } catch { return false; } }
