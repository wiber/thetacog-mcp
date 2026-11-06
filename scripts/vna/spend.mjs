#!/usr/bin/env node
// scripts/vna/spend.mjs — C93b THE SPEND, read from `usage`, never from bytes. Every assistant row of a Claude Code
// transcript (<transcript_path>.jsonl) carries message.usage { input_tokens, cache_creation_input_tokens,
// cache_read_input_tokens, output_tokens }; the token meter (C82e) was estimating this from the file's byte count. A
// PROMPT-TURN opens at a `user` row that is not a tool_result and holds every API call until the next one. A commit's
// spend is the runner's verdict row when the runner made it (C66 keeps the worker's usage on the row), else the sum of
// the chair's turns between the previous commit's timestamp and this commit's; UNMEASURED with the reason otherwise —
// never 0 for a sha nobody's transcript covers. The four fields are kept apart (a cache read is not an input token);
// never a dollar until a price is pinned (KR40). Incremental: the jsonl is read from a byte offset, a truncated last
// line is skipped.
//   node scripts/vna/spend.mjs <transcript.jsonl> [--json]            the turns
//   node scripts/vna/spend.mjs --commit <sha> --transcript <jsonl>     one commit's spend
import { readFileSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARS_PER_TOKEN, BUNDLE_TOKEN_CAP } from './spec-tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const FIELDS = ['input', 'cache_create', 'cache_read', 'output'];
const KEYS = { input: 'input_tokens', cache_create: 'cache_creation_input_tokens', cache_read: 'cache_read_input_tokens', output: 'output_tokens' };
const zero = () => ({ calls: 0, input: 0, cache_create: 0, cache_read: 0, output: 0 });
export const total = (u) => FIELDS.reduce((s, k) => s + (Number(u[k]) || 0), 0);
const ndRows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/** read complete lines from `offset`; a truncated last line is left for the next read */
export function readLines(path, offset = 0) {
  const fd = openSync(path, 'r'); try {
    const size = fstatSync(fd).size; if (size <= offset) return { lines: [], offset };
    const buf = Buffer.alloc(size - offset); readSync(fd, buf, 0, buf.length, offset);
    const text = buf.toString('utf8'); const cut = text.lastIndexOf('\n'); if (cut < 0) return { lines: [], offset };
    return { lines: text.slice(0, cut).split('\n').filter(Boolean), offset: offset + Buffer.byteLength(text.slice(0, cut + 1)) };
  } finally { closeSync(fd); }
}
const isPromptRow = (j) => j.type === 'user' && !(j.message && Array.isArray(j.message.content) && j.message.content.some((c) => c && c.type === 'tool_result'));

/** the prompt-turns of a transcript: { n, t0, t1, calls, input, cache_create, cache_read, output, prompt_chars } */
export function spendOf(transcriptPath, { offset = 0, turns = [] } = {}) {
  const { lines, offset: next } = readLines(transcriptPath, offset);
  let cur = turns.length ? turns[turns.length - 1] : null;
  for (const l of lines) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (isPromptRow(j)) { const c = j.message && j.message.content; const chars = typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((s, x) => s + (x && x.type === 'text' ? String(x.text).length : 0), 0) : 0; cur = { n: turns.length + 1, t0: j.timestamp || null, t1: j.timestamp || null, ...zero(), prompt_chars: chars }; turns.push(cur); continue; }
    const u = j.message && j.message.usage; if (!u || !cur) continue;
    cur.calls += 1; for (const k of FIELDS) cur[k] += Number(u[KEYS[k]]) || 0; if (j.timestamp) cur.t1 = j.timestamp;
  }
  return { turns, offset: next, path: transcriptPath };
}

/** the runner's verdict row for a sha (C66 writes `work` = the graded commit) */
export function runnerSpendFor(sha, rows = ndRows(RUNNER_NDJSON)) { const r = rows.filter((x) => x.kind === 'verdict' && x.work && String(sha).startsWith(String(x.work).slice(0, 10)) && x.usage).pop(); if (!r) return null; const u = r.usage; return { route: 'runner', calls: Array.isArray(u.iterations) ? u.iterations.length : (r.num_turns || null), input: u.input_tokens || 0, cache_create: u.cache_creation_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, source: 'runner verdict row', at: r.at }; }

const commitAt = (repo, sha) => { try { return execFileSync('git', ['log', '-1', '--format=%cI', sha], { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
const prevCommitAt = (repo, sha) => { try { return execFileSync('git', ['log', '-1', '--format=%cI', `${sha}~1`], { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };

/** one commit's spend: the runner's row, else the chair's turns between the previous commit and this one, else UNMEASURED */
export function spendOfCommit({ sha, repo = REPO, turns = [], runnerRows, at = null, prevAt = null }) {
  const r = runnerSpendFor(sha, runnerRows); if (r) return { sha, ...r, total: total(r) };
  const t1 = at || commitAt(repo, sha); const t0 = prevAt || prevCommitAt(repo, sha);
  if (!t1) return { sha, route: null, status: 'UNMEASURED', why: 'no such commit' };
  const T1 = Date.parse(t1), T0 = t0 ? Date.parse(t0) : -Infinity;
  const inside = turns.filter((t) => t.t0 && Date.parse(t.t0) <= T1 && Date.parse(t.t1 || t.t0) > T0);
  if (!inside.length) return { sha, route: null, status: 'UNMEASURED', why: 'no transcript turn between the previous commit and this one' };
  const sum = inside.reduce((a, t) => { a.calls += t.calls; for (const k of FIELDS) a[k] += t[k]; return a; }, zero());
  return { sha, route: 'chair', ...sum, total: total(sum), turns: inside.map((t) => t.n), source: 'transcript usage rows' };
}

/** the two baselines without the instrument, from the same receipts: FLOOR = calls × (prompt + CLAUDE.md); CEILING = calls × transcript/4 */
export function baselines({ calls, promptTokens = 0, claudeMdTokens = 0, contextBytes = null, charsPerToken = CHARS_PER_TOKEN }) {
  const floor = calls * (promptTokens + claudeMdTokens);
  const ceiling = contextBytes == null ? null : calls * Math.round(contextBytes / charsPerToken);
  return { floor, ceiling, snowball: BUNDLE_TOKEN_CAP };
}
export function effectiveness({ actual, floor, ceiling }) {
  if (![actual, floor, ceiling].every((x) => Number.isFinite(x)) || ceiling <= floor) return { value: null, status: 'UNMEASURED' };
  return { value: Math.max(0, Math.min(1, (ceiling - actual) / (ceiling - floor))), status: 'measured' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const tp = arg('--transcript') || argv.find((a) => a.endsWith('.jsonl'));
  if (arg('--commit')) { const { turns } = tp ? spendOf(tp) : { turns: [] }; console.log(JSON.stringify(spendOfCommit({ sha: arg('--commit'), turns }))); process.exit(0); }
  if (!tp) { console.error('node scripts/vna/spend.mjs <transcript.jsonl> | --commit <sha> --transcript <jsonl>'); process.exit(2); }
  const s = spendOf(tp);
  if (argv.includes('--json')) console.log(JSON.stringify(s)); else { const tot = s.turns.reduce((a, t) => { a.calls += t.calls; for (const k of FIELDS) a[k] += t[k]; return a; }, zero()); console.log(`${s.turns.length} prompt-turns · ${tot.calls} calls · input ${tot.input} · cache_create ${tot.cache_create} · cache_read ${tot.cache_read} · output ${tot.output} · total ${total(tot)}`); for (const t of s.turns.slice(-8)) console.log(`  turn ${t.n} · ${t.calls} calls · cache_read ${t.cache_read} · output ${t.output} · ${String(t.t0).slice(11, 19)}→${String(t.t1).slice(11, 19)}`); }
}
