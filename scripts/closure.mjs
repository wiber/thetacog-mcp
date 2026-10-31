// packages/thetacog-mcp/scripts/closure.mjs — THE ONE import-closure rule (C1373, 2026-10-28).
//
// bundle-pmu.mjs copies "the JS closure reachable from an entry (import + dynamic import) and the data files those
// modules read" into the package at prepack. Until C1373 that rule lived only inside the bundler's top-level script, so
// nothing else could ask the same question — "what does the full projection read at runtime?" — without retyping the
// regexes. The package-completeness guard (tests/vna/c1373-package-completeness-pack-packages-thetacog-mcp.test.mjs)
// reads this closure and holds package.json "files" and `npm pack --dry-run` to it; the bundler walks with these same
// edges. One rule, one place: a module reached by an edge this file does not see is not shipped AND is not demanded.
//
// THREE KINDS OF EDGE, each a construct the demo actually follows (measured 2026-10-28 with an fs trace over
// `attest-demo --serve --no-llm`: 82 modules loaded, 71 by import, 11 by path):
//   static   `from '../x.mjs'`            — loads with the module, unconditionally
//   dynamic  `import('./x.mjs')`           — a runtime decision (a route hit, a try/catch); the server's doors enter here
//   same-dir `resolve(__dirname|HERE, 'x.mjs')` — a spawn target or `import(resolve(HERE, …))`: attest-demo's by-path
//            pillars (attest.mjs, price-attest.mjs) and attest-serve's route modules (velocity-scenarios, tape-append, …),
//            invisible to both older walkers; five of those route modules had never shipped
// Comments are stripped first: an import written in a comment is not an edge (scripts/pmu/package-surface-spec.mjs's rule).
// DATA is a `data/pmu/**/*.json` or axis-library literal in the RAW source — the bundler's own rule, unchanged. Reads by
// another literal (.ndjson, .md, .html, a path built at runtime) are OUTSIDE this closure: the bundler names them one by
// one (its LEDGER_DATA list) and so must any guard; the C1373 cold-run trace is where they are measured.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const stripComments = (src) => String(src).replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
export const STATIC_EDGE_RE = /\bfrom\s*["'](\.\.?\/[\w./-]+\.m?js)["']/g;                      // C94b.5: .m?js — spec-tree re-exports a .js
export const DYNAMIC_EDGE_RE = /\bimport\(\s*["'](\.\.?\/[\w./-]+\.m?js)["']/g;
export const SAME_DIR_EDGE_RE = /(?:resolve|join)\(\s*(?:__dirname|HERE)\s*,\s*["']([\w.-]+\.m?js)["']\s*\)/g;
export const DATA_LITERAL_RE = /(data\/pmu\/[\w./-]+\.json|docs\/architecture\/axis-library[\w.-]*\.json)/g;

/** repo-relative targets of the import edges in `src`, a module that lives at `baseDirRel` (its repo-relative dir) */
export function importEdges(src, baseDirRel, { dynamic = true, sameDir = true } = {}) {
  const code = stripComments(src), out = [];
  for (const m of code.matchAll(STATIC_EDGE_RE)) out.push(join(baseDirRel, m[1]));              // path.join normalises the .. segments
  if (dynamic) for (const m of code.matchAll(DYNAMIC_EDGE_RE)) out.push(join(baseDirRel, m[1]));
  if (sameDir) for (const m of code.matchAll(SAME_DIR_EDGE_RE)) out.push(join(baseDirRel, m[1]));
  return out;
}

/** the data/pmu/*.json + axis-library literals a module names (raw source: the bundler reads these before any comment strip) */
export function dataLiterals(src) {
  return [...new Set([...String(src).matchAll(DATA_LITERAL_RE)].map((m) => m[1]))];
}

/**
 * The transitive closure from repo-relative entry files, with the data literals of every module in it.
 * { modules: sorted repo-relative paths that exist, data: sorted literals, missing: edges that resolve to no file }
 */
export function runtimeClosure(repo, entries, opts = {}) {
  const seen = new Set(), data = new Set(), missing = [], stack = [...entries];
  while (stack.length) {
    const rel = stack.pop(); if (seen.has(rel)) continue; seen.add(rel);
    let src; try { src = readFileSync(join(repo, rel), 'utf8'); } catch { missing.push(rel); continue; }
    for (const e of importEdges(src, dirname(rel), opts)) stack.push(e);
    for (const d of dataLiterals(src)) data.add(d);
  }
  const miss = new Set(missing);
  return { modules: [...seen].filter((m) => !miss.has(m)).sort(), data: [...data].sort(), missing: missing.sort() };
}

// ── THE ROW'S ENTRIES (C1373): the full projection and the web view, as the operator named them ────────────────────────
// triptych-build.mjs (buildTriptychInputs) through door-crate.mjs on the shipped pmu-onchip; attest-demo (--serve --no-llm);
// attest-demo-ux (the page builder) and attest-serve (the page's server). The bundler stages the data this closure names
// (static edges: what loads with the demo); the guard demands it from "files" and from the tarball.
export const DEMO_ENTRIES = ['scripts/pmu/triptych-build.mjs', 'scripts/vna/door-crate.mjs', 'scripts/pmu/attest-demo.mjs', 'scripts/pmu/attest-demo-ux.mjs', 'scripts/pmu/attest-serve.mjs'];

// the operator's raw prompts never publish (bundle-pmu.mjs's privacy stage drops these from the staged tree) — ONE list
export const PRIVACY_DROPS = ['data/pmu/lens-c1-adjudication.json', 'data/pmu/private-markers.txt'];

/** true when a .npmignore (its text) denies `rel` — an exact line, a directory prefix, or a `*.ext` glob */
export function npmignoreDenies(ignoreText, rel) {
  return String(ignoreText).split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).some((d) => {
    if (d.startsWith('*')) return rel.endsWith(d.slice(1));
    const dir = d.replace(/^\//, '').replace(/\/$/, '');
    return rel === dir || rel.startsWith(`${dir}/`);
  });
}

/** true when package.json "files" (an allowlist read in order; `!x` negates; a dir entry covers its subtree) covers `rel` */
export function filesCovers(filesList, rel) {
  let covered = false;
  for (const raw of filesList || []) {
    const neg = raw.startsWith('!'); const pat = raw.replace(/^!/, '').replace(/^\.\//, '').replace(/\/$/, '');
    const hit = pat.includes('*')
      ? new RegExp(`^${pat.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}(/|$)`).test(rel)
      : rel === pat || rel.startsWith(`${pat}/`);
    if (hit) covered = !neg;
  }
  return covered;
}
