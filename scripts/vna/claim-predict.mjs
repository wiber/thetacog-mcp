// scripts/vna/claim-predict.mjs — C2389: PREDICT A ROW'S CLAIM SET BEFORE DISPATCH, extending the Rust steer
// plan (C188, .thetacog/pmu/src/steer_plan.rs). That crate already batches an independent set of rows with
// disjoint claims and basin cells, nearest first, capped by free memory — but rule (5) there runs a row ALONE
// the moment it names no paths. Most rows name none because nobody hand-wrote `paths` on the spec line, not
// because the row truly touches nothing. This file predicts the missing claim from what the row already
// carries, so "no paths" stops being the default reading:
//
//   (1) the row's own declared paths — kept exactly as authored, never trimmed or overridden;
//   (2) its guard file — read off the row's spec text with guardOf() (spec-tree.mjs's ONE parser, C178,
//       reused here rather than a second regex for the same `guard: \`...\`` syntax);
//   (3) that guard's STATIC import closure — every relative require()/import the guard file names, resolved
//       and walked bounded (a guard importing half the repo is a bug in the guard, not a claim); the walk
//       never opens node_modules or a bare package name, only repo-relative specifiers;
//   (4) the worker's called-shot files (C2347, called-shot.mjs's parseShot) ALREADY ON RECORD for this row
//       id this session — a caller passes them in per id; this module makes no claim about where they live.
//
// A row's `pixel` (its basin) is read, never written — plan() in steer_plan.rs already turns it into a cell
// for the overlap check; predicting paths must not touch it.
//
// This DECIDES nothing (plan() still owns disjointness, cell overlap, order, the slot cap): it only fills
// `paths` in before that call. MAXIMISE RUST: prototyped here in node because steer_plan.rs is held by
// another worker this session; the port is a named ask (left open in the dispatch debrief), not a skip.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { guardOf } from './spec-tree.mjs';

const IMPORT_RE = /\b(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\))/g;

export const norm = (p) => { const t = String(p || '').trim(); return t.startsWith('./') ? t.slice(2) : t; };

/** every repo-relative require()/import a file (and the files it leads to) names, resolved against `repo`.
 * Bounded (maxFiles, maxDepth): a static walk, never node's own module resolution, never node_modules. */
export function importClosure(entryPath, { repo, maxFiles = 40, maxDepth = 3 } = {}) {
  const startAbs = resolve(repo, entryPath);
  const seen = new Set([startAbs]);
  const out = new Set();
  const queue = [{ abs: startAbs, depth: 0 }];
  while (queue.length && out.size < maxFiles) {
    const { abs, depth } = queue.shift();
    if (!existsSync(abs)) continue;
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec || !spec.startsWith('.')) continue;   // a bare package name claims nothing on this tree
      const resolved = resolve(dirname(abs), spec);
      const withExt = existsSync(resolved) ? resolved
        : existsSync(resolved + '.mjs') ? resolved + '.mjs'
        : existsSync(resolved + '.js') ? resolved + '.js'
        : null;
      if (!withExt || !withExt.startsWith(repo)) continue;
      const rel = norm(withExt.slice(repo.length + 1));
      if (out.has(rel)) continue;
      out.add(rel);
      if (depth < maxDepth && !seen.has(withExt)) { seen.add(withExt); queue.push({ abs: withExt, depth: depth + 1 }); }
    }
  }
  return [...out].sort();
}

/** the predicted claim set for one row. `text` is the row's spec line (guardOf reads the guard off it);
 * `paths` is whatever the row already declares — returned untouched whenever it is non-empty. */
export function predictClaim({ text = '', paths = [], repo, calledShotFiles = [] } = {}) {
  const declared = [...new Set((paths || []).map(norm).filter(Boolean))].sort();
  if (declared.length) return { paths: declared, guard: guardOf(text), from: 'declared' };

  const guard = guardOf(text);
  const predicted = new Set();
  if (guard) {
    const guardAbs = resolve(repo, guard);
    if (existsSync(guardAbs)) {
      predicted.add(norm(guard));
      for (const p of importClosure(guard, { repo })) predicted.add(p);
    }
  }
  for (const f of calledShotFiles || []) { const n = norm(f); if (n) predicted.add(n); }
  const out = [...predicted].sort();
  return { paths: out, guard, from: out.length ? 'guard+closure+shots' : 'none' };
}

/** predictRows: fills `paths` on every row that names none; a row already carrying paths is returned as-is.
 * `calledShotFilesById[row.id]` is the optional C2347 signal (4) above — the caller owns where it comes from. */
export function predictRows(rows, { repo, calledShotFilesById = {} } = {}) {
  return (rows || []).map((r) => {
    if (Array.isArray(r.paths) && r.paths.length) return r;
    const { paths } = predictClaim({ text: r.text || '', paths: [], repo, calledShotFiles: calledShotFilesById[r.id] || [] });
    return paths.length ? { ...r, paths } : r;
  });
}
