// scripts/vna/code-slot.mjs — C269 (U6) THE CODE SLOT: A CHANGE BRIEF NAMES file:lines BEFORE THE MODEL WAKES. Operator 2026-09-25,
// verbatim: "The host … finds the file (media/chat.css) and extracts lines 30–60. The model is handed a 30-line edit window, not a
// 100,000-line codebase." C260's brief carried zero paths; the worker was told WHAT, never WHERE.
//
// THREE SOURCES, IN ORDER, each named on the slot so a reader knows how much to trust it:
//   named   — a path the row itself cites (spec-clarity namedPaths), on disk
//   symbol  — an identifier the ask carries (backticked span, dotted/camel/kebab token, a CSS selector) found by `git grep -F`
//   lexical — the ask's rarer content words (≥5 letters), `git grep -F -w` each, files scored by Σ 1/df over the words they hold
// NCD over code chunks (the operator's third source) is NOT here yet: it is measured first (C272 scores this retriever and any
// NCD retriever on the replay basin against a shuffled null) and trusted only if it beats this one. Until then: UNMEASURED.
// The window: 40 lines (WINDOW), stepped by 20, the one holding the most matched terms — ties to the earliest.
// Pure over git + the files; LLM-free. Port row C269p: the retriever decides, so it moves to the crate once C272 has scored it.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
export function rankFiles({ repo, ask, strip = false, max = 5, rev = null }) {   // rev: search a past tree (C272 scores at each task's parent)
  let text = String(ask || '');
  const named = strip ? [] : namedPaths(text).filter((p) => CODE.test(p) && (rev ? true : existsSync(resolve(repo, p))));
  if (strip) text = text.replace(/(?:\.claude|[a-z][\w-]*)\/[\w./@-]+\.[a-z]{1,5}\b/g, ' ').replace(/\b[\w-]+\.(mjs|js|cjs|ts|tsx|css|rs|sh|json|md)\b/g, ' ');
  const scores = new Map(); const add = (f, s, source, term, lines) => { const c = scores.get(f) || { file: f, score: 0, source, terms: [], lines: [] }; c.score += s; c.terms.push(term); c.lines.push(...lines); if (source === 'named' || (source === 'symbol' && c.source === 'lexical')) c.source = source; scores.set(f, c); };
  for (const f of named) add(f, 100, 'named', f, []);
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
export function codeSlot({ repo, ask, strip = false, window = WINDOW, helpers = true }) {   // C276: a retry's dial moves window / helpers
  const [top, ...rest] = rankFiles({ repo, ask, strip, max: 3 });
  if (!top) return null;
  const w = windowOf(repo, top, window); const src = readFileSync(resolve(repo, top.file), 'utf8').split('\n');
  const body = src.slice(w[0] - 1, w[1]).map((l, i) => `${w[0] + i}: ${l}`).join('\n');
  return { file: top.file, lines: w, source: top.source, terms: [...new Set(top.terms)].slice(0, 6), also: rest.map((r) => r.file),
    text: [`THE CODE SLOT (found by the host — ${top.source}: ${[...new Set(top.terms)].slice(0, 4).join(', ')}): ${top.file}:${w[0]}-${w[1]}`, body,
      ...(rest.length && helpers ? [`other candidates: ${rest.map((r) => r.file).join(' · ')}`] : [])].join('\n') };
}
