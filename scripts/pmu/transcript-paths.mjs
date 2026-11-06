#!/usr/bin/env node
// scripts/pmu/transcript-paths.mjs — THE LEAF: a session transcript → the paths each tool call named, and the calls in one
// turn's window. No reading, no data file, no import of any kr-script.
//
// WHY THIS FILE EXISTS (2026-09-17): attest-bundle.mjs (B19) imported loadTranscriptPaths and windowCalls from
// kr33-uptake.mjs. The public package's closure walker followed that import into kr31-rct → ratchet-replay → the whole
// reading chain, and bundled the large ratchet corpus (2,200 prompt texts) and the KR18 paths cache into the
// package tree. The mirror's third-party NAME gate refused the push — 8 names in 2 files. A prompt corpus is private by
// construction (rows carry text_sha, never text); the producer of a public receipt must be a leaf. Everything below is
// moved VERBATIM from kr33-uptake.mjs, which now imports and re-exports it, so every existing caller keeps its import.
// Guards: tests/ops/npm-pack-no-leak.test.mjs (the corpora are PRIVATE paths) · the mirror DENY list · tests/formal/kr33-uptake.test.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TDIR = resolve(homedir(), '.claude/projects/-Users-thetacoach-GitHub-thetadrivencoach');
export const CALL_CAP = 20;
const PATH_FIELDS = ['file_path', 'notebook_path', 'path', 'pattern', 'glob'];
// a path-like token inside a shell line: at least one slash, ordinary path characters only. The lookbehind is load-bearing —
// without it `/dev/null` yields the repo-relative `dev/null`, i.e. an absolute path OUTSIDE the repo read as one inside it.
const PATHY = /(?<![A-Za-z0-9_.@+\-/])(?:[A-Za-z0-9_.@+-]+\/)+[A-Za-z0-9_.@+*-]*/g;

/** one candidate string → a repo-relative path, or null (a URL, a home path, an absolute path outside the repo, an option) */
export function normalisePath(raw, { repo = REPO } = {}) {
  let s = String(raw == null ? '' : raw).trim().replace(/^['"`]+/, '').replace(/['"`]+$/, '');
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;                      // a URL is not a path
  if (s.startsWith('~') || s.startsWith('-')) return null;                  // a home path, a flag
  if (isAbsolute(s)) { const n = normalize(s); if (n !== repo && !n.startsWith(repo + '/')) return null; s = n.slice(repo.length + 1); }
  s = s.replace(/^\.\//, '').replace(/[),;:'"]+$/, '').replace(/\/?\*\*?$/, '').replace(/\/+$/, '');
  return s || null;
}
/** one host-recorded tool_use block { name, input } → every repo-relative path it names, deduped and sorted */
export function extractPaths(block, { repo = REPO } = {}) {
  const input = (block && block.input) || {};
  const out = new Set();
  const add = (raw) => { if (typeof raw !== 'string') return; const p = normalisePath(raw, { repo }); if (p) out.add(p); };
  for (const k of PATH_FIELDS) add(input[k]);
  if (typeof input.command === 'string') {
    const stripped = input.command.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');   // a URL never contributes a path
    for (const m of stripped.match(PATHY) || []) add(m);
    for (const m of stripped.match(/(?:^|\s)(\/[^\s'"`;|&]+)/g) || []) add(m.trim());   // absolute paths, relativised if under the repo
  }
  return [...out].sort();
}
/** does a repo-relative path fall under a declared prefix? BY PATH COMPONENT — scripts/pmu never matches scripts/pmu-old */
export function underPrefix(path, prefix) {
  const p = String(path).replace(/^\.\//, '').replace(/\/+$/, '');
  const g = String(prefix).replace(/^\.\//, '').replace(/\/+$/, '');
  return !!g && (p === g || p.startsWith(g + '/'));
}
export const underAny = (path, prefixes) => (prefixes || []).some((g) => underPrefix(path, g));

/** the session transcript as events { t, kind:'user'|'tool', name, paths[] } — kr27's loadTranscript keeps only file_path, and
 *  uptake needs every path a call names, so the wider extractor is applied here rather than widening kr27's shape */
export function loadTranscriptPaths(session, { dir = TDIR, repo = REPO } = {}) {
  const p = resolve(dir, session + '.jsonl'); if (!existsSync(p)) return null;
  const out = [];
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; }
    const t = Date.parse(j.timestamp || ''); if (!Number.isFinite(t)) continue; const m = j.message;
    if (j.type === 'user' && m && (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some((b) => b.type === 'text')))) {
      if (!(Array.isArray(m.content) && m.content.every((b) => b.type === 'tool_result'))) out.push({ t, kind: 'user' });
    }
    if (m && Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') out.push({ t, kind: 'tool', name: b.name, paths: extractPaths(b, { repo }) });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** the tool calls between this human prompt and the next, capped — the window ends at the next human prompt, always */
export function windowCalls(events, ts, { cap = CALL_CAP } = {}) {
  const t0 = typeof ts === 'number' ? ts : Date.parse(ts);
  let start = -1, best = Infinity;
  for (let i = 0; i < events.length; i++) { const e = events[i]; if (e.kind !== 'user') continue; const d = Math.abs(e.t - t0); if (d < best && d <= 300000) { best = d; start = i; } }
  if (start < 0) { const k = events.findIndex((e) => e.t >= t0); if (k < 0) return []; start = k - 1; }
  const calls = [];
  for (let i = start + 1; i < events.length; i++) { const e = events[i]; if (e.kind === 'user') break; if (e.kind !== 'tool') continue; calls.push(e); if (calls.length >= cap) break; }
  return calls;
}
/** the uptake of one window against one delivered set */
