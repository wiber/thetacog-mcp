// scripts/vna/code-slot.mjs — C269 (U6) THE CODE SLOT: A CHANGE BRIEF NAMES file:lines BEFORE THE MODEL WAKES. Operator 2026-09-25,
// verbatim: "The host … finds the file (media/chat.css) and extracts lines 30–60. The model is handed a 30-line edit window, not a
// 100,000-line codebase." C260's brief carried zero paths; the worker was told WHAT, never WHERE.
//
// FOUR SOURCES, IN ORDER, each named on the slot so a reader knows how much to trust it:
//   named   — a path the row itself cites (spec-clarity namedPaths), on disk
//   test    — C408: a code file the task's OWN GUARD imports (the red test names the module it exercises; measured 2026-09-28 over the
//             92-task replay basin: the truth file is among the guard's code imports on 79, its first import on 69 — the ask's subject
//             names it on 22). The guard is handed to the worker in every brief variant, so reading it leaks nothing the worker lacks.
//   symbol  — an identifier the ask carries (backticked span, dotted/camel/kebab token, a CSS selector) found by `git grep -F`
//   lexical — the ask's rarer content words (≥5 letters), `git grep -F -w` each, files scored by Σ 1/df over the words they hold
// NCD over code chunks (the operator's third source) is NOT here yet: it is measured first (C272 scores this retriever and any
// NCD retriever on the replay basin against a shuffled null) and trusted only if it beats this one. Until then: UNMEASURED.
// The window: 40 lines (WINDOW), stepped by 20, the one holding the most matched terms — ties to the earliest.
// Pure over git + the files; LLM-free. Port row C269p: the retriever decides, so it moves to the crate once C272 has scored it.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { namedPaths } from './spec-clarity.mjs';
import { contentWords } from './steer-rules.mjs';

export const WINDOW = 40;
export const SEARCH_ROOTS = ['scripts', 'src', 'packages', 'crates'];
const EXCLUDE = [':!**/node_modules/**', ':!**/out/**', ':!**/dist/**', ':!tests/**', ':!**/*.min.js', ':!**/*.map'];
const CODE = /\.(mjs|js|cjs|ts|tsx|jsx|css|rs|sh)$/;

/** identifiers the ask carries — the tokens a human would grep for */
export function symbolsOf(ask) {
  const t = String(ask || ''); const out = new Set();
  for (const m of t.matchAll(/`([^`]{3,80})`/g)) out.add(m[1].trim());
  for (const m of t.matchAll(/(?:^|\s)(\/[a-z][\w-]*(?:\/[\w-]+)+)(?=[\s),.:;]|$)/g)) out.add(m[1]);   // a route: /api/show
  for (const m of t.matchAll(/(?:^|[\s(])((?:\.[a-z][\w-]*)+|[a-z]+[A-Z]\w+|[a-z0-9]+(?:-[a-z0-9]+){1,4}|[a-z]+_[a-z_]+|[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?=[\s),.:;]|$)/g)) {
    const s = m[1]; if (s.length >= 5 && !/^\d/.test(s) && !/^(e-mail|re-run|one-line|follow-up|built-in)$/.test(s)) out.add(s);
  }
  return [...out].filter((s) => !/\s{2,}|^tests\//.test(s)).slice(0, 12);
}

/** C408 — the code files a guard imports, in order of appearance: relative specifiers resolved against the test's own directory,
 *  plus quoted root-prefixed paths (a test that reads a file by path). A specifier that is not itself in the tree is matched by
 *  suffix against the tree's files (a package test naming `src/vna-view.ts`). Test helpers (under tests/) are never a target.
 *  `tests` = [{ path, text }] — the caller reads the text (the trial dir, or `git show <sha>:<path>` for a past commit). */
const TREE_CACHE = new Map();
function treeFiles(repo, rev) {
  const k = `${repo}@${rev || ''}`; if (TREE_CACHE.has(k)) return TREE_CACHE.get(k);
  let out = [];
  try { out = execFileSync('git', rev ? ['ls-tree', '-r', '--name-only', rev] : ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((f) => CODE.test(f) && !/^tests\//.test(f)); } catch {}
  TREE_CACHE.set(k, out); return out;
}
export function testImports({ repo, tests = [], rev = null }) {
  const out = []; const tree = null;
  const push = (p) => { if (p && CODE.test(p) && !/^tests\//.test(p) && !out.includes(p)) out.push(p); };
  for (const t of tests || []) {
    const dir = posix.dirname(String(t.path || '')); const text = String(t.text || '');
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) push(posix.normalize(posix.join(dir, m[1])));
    for (const m of text.matchAll(/["'`]((?:scripts|src|packages|crates)\/[\w./-]+\.(?:mjs|js|cjs|ts|tsx|jsx|css|rs|sh))["'`]/g)) push(m[1]);
  }
  if (!out.length) return [];
  const files = treeFiles(repo, rev); const set = new Set(files);
  return out.map((p) => set.has(p) ? p : files.find((f) => f.endsWith('/' + p)) || null).filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
}

const gitGrep = (repo, args, rev = null) => { try { return execFileSync('git', ['grep', '-I', ...args, ...(rev ? [rev] : []), '--', ...SEARCH_ROOTS, ...EXCLUDE], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
/** files holding `term` → Map(file → [line numbers]) */
function hits(repo, term, { word = false, rev = null } = {}) {
  const m = new Map();
  for (const l0 of gitGrep(repo, ['-n', '-F', ...(word ? ['-w', '-i'] : []), '-e', term], rev).split('\n')) {
    const l = rev && l0.startsWith(rev + ':') ? l0.slice(rev.length + 1) : l0;   // a tree-ish grep prefixes '<rev>:'
    const x = /^([^:]+):(\d+):/.exec(l); if (!x || !CODE.test(x[1])) continue;
    if (!m.has(x[1])) m.set(x[1], []); m.get(x[1]).push(Number(x[2]));
  }
  return m;
}

/** ranked candidates: [{ file, score, source, terms, lines }] — best first. `strip` removes paths/basenames (the measurement's leak control) */
const SOURCE_RANK = { named: 0, test: 1, symbol: 2, lexical: 3 };
export function rankFiles({ repo, ask, strip = false, max = 5, rev = null, tests = [] }) {   // rev: search a past tree (C272 scores at each task's parent) · tests: the guard's [{ path, text }] (C408)
  let text = String(ask || '');
  const named = strip ? [] : namedPaths(text).filter((p) => CODE.test(p) && (rev ? true : existsSync(resolve(repo, p))));
  if (strip) text = text.replace(/(?:\.claude|[a-z][\w-]*)\/[\w./@-]+\.[a-z]{1,5}\b/g, ' ').replace(/\b[\w-]+\.(mjs|js|cjs|ts|tsx|css|rs|sh|json|md)\b/g, ' ');
  const scores = new Map(); const add = (f, s, source, term, lines) => { const c = scores.get(f) || { file: f, score: 0, source, terms: [], lines: [] }; c.score += s; c.terms.push(term); c.lines.push(...lines); if (SOURCE_RANK[source] < SOURCE_RANK[c.source]) c.source = source; scores.set(f, c); };
  for (const f of named) add(f, 100, 'named', f, []);
  testImports({ repo, tests, rev }).forEach((f, i) => add(f, i === 0 ? 50 : 40, 'test', `imported by ${(tests.find((t) => String(t.text || '').includes(f.split('/').pop().replace(/\.\w+$/, ''))) || tests[0] || {}).path || 'the guard'}`, []));   // the first import is the module under test more often than not (69 vs 10 of 79)
  for (const sym of symbolsOf(text)) { const h = hits(repo, sym, { rev }); if (h.size && h.size <= 25) for (const [f, ls] of h) add(f, 10 / h.size, 'symbol', sym, ls); }
  const words = [...new Set(contentWords(text).filter((w) => w.length >= 5 && /^[a-z]+$/.test(w)))].slice(0, 16);
  for (const w of words) { const h = hits(repo, w, { word: true, rev }); if (h.size && h.size <= 60) for (const [f, ls] of h) add(f, 1 / h.size, 'lexical', w, ls); }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, max);
}

/** the densest WINDOW-line span of a file over the matched lines — [a, b], 1-based inclusive */
export function windowOf(repo, cand, win = WINDOW) {
  let n = 0; try { n = readFileSync(resolve(repo, cand.file), 'utf8').split('\n').length; } catch { return null; }
  if (!cand.lines.length) return [1, Math.min(n, win)];
  let best = [1, Math.min(n, win)], bestK = -1;
  for (let a = 1; a <= Math.max(1, n - win + 1); a += Math.max(1, Math.floor(win / 2))) { const b = Math.min(n, a + win - 1); const k = cand.lines.filter((l) => l >= a && l <= b).length; if (k > bestK) { bestK = k; best = [a, b]; } }
  return best;
}

/** the slot the brief carries: the best file's window, numbered, with its source; null when nothing was found */
export function codeSlot({ repo, ask, strip = false, window = WINDOW, helpers = true, tests = [] }) {   // C276: a retry's dial moves window / helpers · C408: tests = guard paths (read here) or [{ path, text }]
  const guards = (tests || []).map((t) => { if (typeof t !== 'string') return t; try { return { path: t, text: readFileSync(resolve(repo, t), 'utf8') }; } catch { return null; } }).filter(Boolean);
  const [top, ...rest] = rankFiles({ repo, ask, strip, max: 3, tests: guards });
  if (!top) return null;
  const w = windowOf(repo, top, window); const src = readFileSync(resolve(repo, top.file), 'utf8').split('\n');
  const body = src.slice(w[0] - 1, w[1]).map((l, i) => `${w[0] + i}: ${l}`).join('\n');
  return { file: top.file, lines: w, source: top.source, terms: [...new Set(top.terms)].slice(0, 6), also: rest.map((r) => r.file),
    text: [`THE CODE SLOT (found by the host — ${top.source}: ${[...new Set(top.terms)].slice(0, 4).join(', ')}): ${top.file}:${w[0]}-${w[1]}`, body,
      ...(rest.length && helpers ? [`other candidates: ${rest.map((r) => r.file).join(' · ')}`] : [])].join('\n') };
}
