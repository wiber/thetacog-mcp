#!/usr/bin/env node
// transcript-asks.mjs — C187: every ask the operator typed in a Claude Code session, and which spec row quotes it.
//
// "Did we spec all that was asked for?" is answered off the SESSION TRANSCRIPT (~/.claude/projects/<repo-slug>/<session>.jsonl),
// never off the model's memory of the conversation. An ask arrives two ways: a `user` row whose content is a string (a /steer
// dictation is wrapped in <command-args>), or a mid-turn message — a `queue-operation` enqueue row (the same text is echoed as a
// `queued_command` attachment; counted once). Everything else in the file (tool results, hook context, task notifications,
// local-command stdout, caveats) is not an ask.
//
// COVERAGE IS VERBATIM, NOT SIMILARITY: a row covers an ask when the row's text contains a normalised run of the ask's own words
// (the spec's rule: every row quotes the operator verbatim). A near-miss by gzip-NCD is printed as a HINT beside an unmapped ask and
// never counted as coverage — a similarity score standing in for "this was specced" is the token-for-construct proxy CLAUDE.md bans.
// LLM-free: string work and zlib only.
//
// C187b — THE ASK COUNT FOLLOWS THE COMPACTION CHAIN: a user row whose content starts with 'This session
// is being continued from a previous conversation' names its predecessor via 'read the full transcript
// at: <path>.jsonl'. That predecessor's own asks are real asks too — auto-compaction is a HARNESS event,
// not something the operator asked for less. chainAudit() follows the pointer recursively (cycle-safe via
// a visited-path set; a missing predecessor file is reported on its own row with missing:true, never
// silently dropped) and returns one audit() per session in the chain, each labelled by session id.
//
//   node scripts/vna/transcript-asks.mjs [--session <id|path>] [--spec <md>] [--since <iso>] [--json] [--no-chain]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SPEC_MD = resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const projectDir = (repo = REPO) => join(homedir(), '.claude', 'projects', repo.replace(/[^A-Za-z0-9]/g, '-'));
const MAX_BYTES = 256 * 1024 * 1024;

export function newestSession(dir = projectDir()) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }));
  files.sort((a, b) => b.t - a.t); return files[0]?.f || null;
}

// the words the operator typed, without the harness wrapping; a pasted block is dropped (it is someone else's text) and flagged
export function cleanAsk(raw) {
  let s = String(raw || '');
  const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/); if (args) s = args[1];
  else if (/<command-name>|<local-command-|<command-message>/.test(s)) return null;   // a bare slash command or its stdout: not an ask
  if (/^\s*<task-notification>|^\s*\[SYSTEM NOTIFICATION|^\s*Caveat:/.test(s)) return null;
  const pasted = /<pasted_content[\s\S]*?<\/pasted_content[^>]*>/.test(s);
  s = s.replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, ' ').replace(/\[Image #\d+\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^\/[\w:-]+$/.test(s)) return null;   // a bare slash command typed raw or enqueued mid-turn ("/compact") is the same harness act as the wrapped form — not an ask (C176i: it reached a corpus as a whole-ask match)
  return s.length >= 8 ? { text: s, pasted } : null;
}

export function readAsks(path, { since = null } = {}) {
  if (statSync(path).size > MAX_BYTES) throw new Error(`transcript ${path} is over ${MAX_BYTES} bytes — read it in a bounded window`);
  const seen = new Set(); const asks = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; }
    let raw = null, source = null;
    if (r.type === 'user' && typeof r.message?.content === 'string' && !r.isMeta) { raw = r.message.content; source = 'prompt'; }
    else if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string') { raw = r.content; source = 'mid-turn'; }
    if (raw == null) continue;
    const at = r.timestamp || null; if (since && at && at < since) continue;
    const c = cleanAsk(raw); if (!c) continue;
    const key = norm(c.text).slice(0, 200); if (seen.has(key)) continue; seen.add(key);
    asks.push({ at, source, text: c.text, pasted: c.pasted });
  }
  return asks;
}

export const norm = (s) => String(s).toLowerCase().replace(/[*_`"“”'’]/g, '').replace(/\s+/g, ' ').trim();   // exported for ask-corpus.mjs (C176i): one normalisation, one place

// the spec's rows, each with its id, tick state and full text (sub-rows included as their own rows)
export function specRows(md) {
  const rows = [];
  for (const l of md.split('\n')) { const m = l.match(/^\s*- \[([ x~])\] (C\d+[a-z]?)\b(.*)$/); if (m) rows.push({ id: m[2], ticked: m[1] === 'x', text: m[3] }); }
  return rows;
}

// covered = some window of ≥ WINDOW consecutive words of the ask appears verbatim (normalised) in the row
export const WINDOW = 8;
// the probes of one ask: every WINDOW-word run of its normalised words (the whole ask when it is ≤ WINDOW words), at or over
// the length floor — a short ask is covered only by the WHOLE ask quoted, a long one by any 8-word run. One rule, one place:
// coveringRows below and ask-corpus.mjs's index (C176i) both read it from here.
export function askProbes(text) {
  const w = norm(text).split(' ').filter(Boolean);
  const probes = w.length <= WINDOW ? [w.join(' ')] : Array.from({ length: w.length - WINDOW + 1 }, (_, i) => w.slice(i, i + WINDOW).join(' '));
  const floor = w.length <= WINDOW ? 8 : 20;
  return probes.filter((p) => p.length >= floor);
}
export function coveringRows(ask, rows) {
  const probes = askProbes(ask.text); const hits = [];
  for (const r of rows) { const t = norm(r.text); if (probes.some((p) => t.includes(p))) hits.push(r); }
  return hits;
}

const gz = (s) => gzipSync(Buffer.from(s)).length;
export function ncd(a, b) { const ca = gz(a), cb = gz(b), cab = gz(a + ' ' + b); return (cab - Math.min(ca, cb)) / Math.max(ca, cb); }
export function nearestRow(ask, rows) {
  let best = null; for (const r of rows) { const d = ncd(norm(ask.text), norm(r.text)); if (!best || d < best.d) best = { id: r.id, d: Math.round(d * 1000) / 1000 }; }
  return best;
}

export function audit({ transcript, spec = SPEC_MD, since = null } = {}) {
  const rows = specRows(readFileSync(spec, 'utf8'));
  const asks = readAsks(transcript, { since }).map((a) => {
    const cov = coveringRows(a, rows);
    return cov.length ? { ...a, rows: cov.map((r) => ({ id: r.id, ticked: r.ticked })) } : { ...a, rows: [], hint: nearestRow(a, rows) };
  });
  const mapped = asks.filter((a) => a.rows.length), unmapped = asks.filter((a) => !a.rows.length);
  return { transcript, spec, since, n: asks.length, mapped: mapped.length, unmapped: unmapped.length, done: mapped.filter((a) => a.rows.every((r) => r.ticked)).length, asks };
}

export const sessionIdOf = (path) => String(path).split('/').pop().replace(/\.jsonl$/, '');

const CONTINUATION_RE = /^This session is being continued from a previous conversation/;
const POINTER_RE = /read the full transcript at:\s*(\S+\.jsonl)/;

// The predecessor's path, or null if this transcript carries no compaction marker. Scanned off the RAW
// user-row text (isMeta rows excluded, same filter readAsks uses) — the marker is not necessarily the
// very first row in the file (a compaction can land mid-session, after turns already in this file), so
// every non-meta user row is checked in order and the first match wins.
export function predecessorPath(transcript) {
  if (!existsSync(transcript)) return null;
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'user' || typeof r.message?.content !== 'string' || r.isMeta) continue;
    const c = r.message.content;
    if (!CONTINUATION_RE.test(c)) continue;
    const m = c.match(POINTER_RE);
    return m ? m[1] : null;
  }
  return null;
}

// Walks the compaction chain from `transcript` back through every predecessor, auditing each session on
// its own (never merging transcripts before reading) and returning one entry per session in the chain,
// nearest-first. Cycle-safe: a resolved path already visited stops the walk rather than looping. A
// pointer to a file that does not exist is reported as its own {missing:true} entry, never swallowed.
export function chainAudit({ transcript, spec = SPEC_MD, since = null } = {}) {
  const visited = new Set();
  const sessions = [];
  let cur = transcript;
  let relation = 'this';
  while (cur) {
    const key = resolve(cur);
    if (visited.has(key)) { sessions.push({ transcript: cur, session: sessionIdOf(cur), relation, cycle: true, n: 0, asks: [] }); break; }
    visited.add(key);
    if (!existsSync(cur)) { sessions.push({ transcript: cur, session: sessionIdOf(cur), relation, missing: true, n: 0, asks: [] }); break; }
    const a = audit({ transcript: cur, spec, since });
    sessions.push({ relation, missing: false, ...a, session: sessionIdOf(cur) });
    const next = predecessorPath(cur);
    if (!next) break;
    cur = next;
    relation = 'predecessor';
  }
  const sum = (k) => sessions.reduce((s, x) => s + (x[k] || 0), 0);
  return { transcript, spec, since, sessions, n: sum('n'), mapped: sum('mapped'), unmapped: sum('unmapped'), done: sum('done') };
}

function printSession(out) {
  console.log(`transcript-asks · ${out.n} asks · ${out.mapped} quoted by a spec row (${out.done} all-ticked) · ${out.unmapped} quoted by NO row`);
  for (const a of out.asks) {
    const head = `${(a.at || '').slice(0, 16)} ${a.source === 'mid-turn' ? '↳' : '▶'} ${a.text.slice(0, 110)}${a.text.length > 110 ? '…' : ''}${a.pasted ? ' [+paste]' : ''}`;
    console.log(a.rows.length ? `  ✓ ${head}\n      → ${a.rows.map((r) => `${r.id}${r.ticked ? '☑' : '☐'}`).join(' ')}` : `  ✗ ${head}\n      → NO ROW · nearest ${a.hint?.id} (ncd ${a.hint?.d}, a hint, not coverage)`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  let t = arg('--session'); if (t && !t.endsWith('.jsonl')) t = join(projectDir(), `${t}.jsonl`); t = t || newestSession();
  if (!t || !existsSync(t)) { console.error(`transcript-asks: no transcript (${t || 'none found in ' + projectDir()})`); process.exit(2); }
  const spec = arg('--spec') ? resolve(arg('--spec')) : SPEC_MD, since = arg('--since');
  if (argv.includes('--no-chain')) {
    const out = audit({ transcript: t, spec, since });
    if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
    printSession(out);
    process.exit(0);
  }
  const chain = chainAudit({ transcript: t, spec, since });
  if (argv.includes('--json')) { console.log(JSON.stringify(chain, null, 2)); process.exit(0); }
  const missing = chain.sessions.find((s) => s.missing);
  const chainStr = chain.sessions.map((s) => s.session).join(' → ');
  console.log(`transcript-asks · ${chain.n} asks across ${chain.sessions.length} session${chain.sessions.length > 1 ? 's' : ''}${chain.sessions.length > 1 ? ` (chain: ${chainStr})` : ''} · ${chain.mapped} quoted by a spec row (${chain.done} all-ticked) · ${chain.unmapped} quoted by NO row`);
  if (missing) console.error(`  ⚠ missing predecessor transcript: ${missing.transcript} (session ${missing.session}) — the chain stops here, not silently`);
  for (const s of chain.sessions) {
    if (s.missing || s.cycle) continue;
    console.log(`\n=== ${s.session}${s.relation === 'this' ? ' (this session)' : ' (predecessor)'} · ${s.n} asks ===`);
    printSession(s);
  }
}
