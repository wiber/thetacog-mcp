#!/usr/bin/env node
// scripts/ops/plain-heads.mjs — C1027 + C1028: EVERY ROW RANKED, RATED 0–9, AND GIVEN A PLAIN HEAD HE CAN JUDGE IN FIVE SECONDS.
// Operator 2026-10-19, verbatim: "all surfaces all cells must be 1) ranked by priority and 0-9 rated for priority - and 2 written so I
// can undersand them - there are many cells to rewrite // delegate".
//
// PRIORITY is the board's one rating, scripts/ops/board-priority.mjs specPriority (C1028), read here only to pick which rows get
// their heads first. This file never rates.
//
// THE PLAIN HEAD (C1027) is four fields written off the row's own text by a Sonnet writer:
//   DONE WHEN · NOW · FROM YOU · WAITS ON — or UNCLEAR with the reason, never a gap filled by guessing.
// Two checks, both before a head is kept:
//   (1) NO INVENTION, mechanical: every number and every row id in the head must appear in the row's own text (Gemini's samples
//       invented a 30 s heartbeat and "3 sample phrases"; this is the check that would have caught both).
//   (2) THE COLD READ: a weaker reader (Haiku) sees the head alone and predicts what the test checks and what he must do. The
//       prediction and the row's guard are kept side by side; the grade is read, never computed by a regex of the prose.
// Writers and readers run in parallel shells (CLAUDE.md: parallel, never a sequential model loop), outside the repo so no project
// hook rides along. Append-only ledger: data/vna/board-heads.ndjson, the one the board reads (headCells), one row per write,
// keyed by the row id and textSha of the row's full spec line, so a changed row reads STALE on the board.
//
//   node scripts/ops/plain-heads.mjs rank [--top N]
//   node scripts/ops/plain-heads.mjs sample [--n 20] [--concurrency 10]   write + check the top N; writes the review .txt
//   node scripts/ops/plain-heads.mjs backfill [--n N] [--concurrency 10]  the rest (C1020aa, bf-6386): only rows with no head for their
//                                    current text, or whose head failed the cold read; writes docs/specs/vna/plain-heads-backfill.txt
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifySpec } from '../vna/spec-clarity.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SPEC = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';
export { HEADS as LEDGER } from './board-priority.mjs';
import { HEADS, specPriority, loadContext, textSha } from './board-priority.mjs';
const DAY = 86_400_000;

export function ranked({ spec = resolve(REPO, SPEC), ctx = loadContext() } = {}) {
  const md = readFileSync(spec, 'utf8'); const lines = md.split('\n');
  return classifySpec(md).rows.filter((r) => !r.done && !r.checked).map((r) => {
    const line = lines.find((l) => new RegExp(`^\\s*- \\[ \\] ${r.id}\\b`).test(l)) || '';
    const pr = specPriority({ ID: r.id, CLASS: r.class }, ctx);
    return { id: r.id, class: r.class, line, raw: line.replace(/^\s*- \[ \] /, ''), guard: (line.match(/\(guard: `([^`]+)`/) || [])[1] || null, priority: pr.p, why: pr.why, tie: pr.tie };
  }).filter((r) => r.raw).sort((a, b) => b.priority - a.priority || b.tie - a.tie);
}

// THE REST (C1020aa, bf-6386): a row needs a head when the ledger has none for its current text (textSha), or its newest head is
// not WRITTEN, or the cold reader disagreed with FROM YOU (check.pass false) — the row's head is rewritten, never kept on a failed read.
export function needsHead(rows, heads = loadContext().heads) {
  return rows.filter((r) => { const h = heads.get(r.id); return !h || h.textSha !== textSha(r.line) || h.verdict !== 'WRITTEN' || (h.check && h.check.pass === false); });
}

// (1) No invention: every number and row id in the head appears in the row text.
export function inventions(head, rowText) {
  const src = String(rowText); const out = [];
  const text = Object.values(head || {}).join(' ');
  for (const m of text.matchAll(/\bC\d+[a-z]{0,2}\d*\b|\b\d+(?:[.,]\d+)?\b/g)) if (!src.includes(m[0])) out.push(m[0]);
  return [...new Set(out)];
}

export const WRITE = (raw) => `You rewrite one spec row so its owner can judge it in five seconds. Use ONLY facts in the row text below; never add a number, a time, a count, a name or a mechanism that is not written there. Plain words: no file paths, no CLI commands, no slogans, no lifecycle prefixes, no commit hashes, no dates, no row ids except in "waits_on". Each field at most 20 words; say the one thing that matters, drop the list.
The repo's rooms (automated workers) do all building, fixing, drafting and composing. "from_you" is only what the OWNER alone can do: answer a question, sign in with his own account, pay, press send on something already drafted, publish, or a legal or money decision. Building or fixing anything is never "from_you".

Return ONLY a JSON object with four string fields:
- "done_when": the state that is true once the row closes, checkable yes or no, starting "Done when"
- "now": what is broken or missing today, one sentence
- "from_you": "nothing" or the one act or answer only the operator can give, one short sentence
- "waits_on": another row id the row says it waits on, or "nothing"
If the row text does not say what done looks like, return {"unclear": "<what is missing, one sentence>"} instead.

THE ROW:
${raw}`;
export const READ = (head) => `Below is a short summary of one task on a work board. From the summary alone, answer in JSON with two string fields:
- "test_checks": in one sentence, what an automated test would check to prove the task is done
- "owner_must": what the board's owner must personally do, or "nothing". Automated workers do all building, fixing, drafting and composing; the owner only answers questions, signs in, pays, presses send, publishes, or decides money and legal matters
Return only the JSON.

SUMMARY:
Done when: ${head.done_when}
Now: ${head.now}
From you: ${head.from_you}
Waits on: ${head.waits_on}`;

// THE WRITER HAS NO TOOLS (seen 2026-10-26, the same failure 9c2011ebc2 fixed in the recognize judge): with tools on, the writer
// reached for one inside --max-turns 1 and every head came back "writer failed: Reached max turns (1)", so /steer halted C1328,
// C1322 and C1329a–h as SLUDGE. --tools '' --setting-sources user keeps it a one-turn writer.
export const headWriterArgs = (model = 'sonnet') => ['-p', '--model', model, '--max-turns', '1', '--tools', '', '--strict-mcp-config', '--setting-sources', 'user'];
export function claudeJson(prompt, { model = 'sonnet', cwd = tmpdir(), timeoutMs = 180_000 } = {}) {
  return new Promise((res) => {
    const p = spawn('claude', headWriterArgs(model), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; const t = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; }); p.on('close', () => { clearTimeout(t); const m = out.match(/\{[\s\S]*\}/); try { res(m ? JSON.parse(m[0]) : { error: out.slice(0, 200) || 'no output' }); } catch { res({ error: `unparsed: ${out.slice(0, 200)}` }); } });
    p.stdin.end(prompt);
  });
}

async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

export async function writeHead(row, { call = claudeJson, write = WRITE } = {}) {   // C1231: write — the A/B door (plain-heads-ab.mjs); default the live prompt
  let head = await call(write(row.raw), { model: 'sonnet' });
  if (head.error) head = await call(write(row.raw), { model: 'sonnet' });   // one retry: a transient refusal or timeout, never a loop
  let inv = head.unclear || head.error ? [] : inventions(head, row.raw);
  if (inv.length) { head = await call(`${write(row.raw)}\n\nYour last attempt used facts not in the row: ${inv.join(', ')}. Remove them.`, { model: 'sonnet' }); inv = head.unclear || head.error ? [] : inventions(head, row.raw); }
  const verdict = head.error ? 'ERROR' : head.unclear ? 'UNCLEAR' : inv.length ? 'INVENTED' : 'WRITTEN';
  const read = verdict === 'WRITTEN' ? await call(READ(head), { model: 'haiku' }) : null;
  // The mechanical half of the cold read: does the reader, from the head alone, agree whether he has an act? The rest of the read
  // (its guess at the test, beside the real guard) is kept for a person to grade, never scored by a regex of the prose.
  const actAgrees = read && !read.error ? (/^nothing\b/i.test(String(head.from_you).trim()) === /^nothing\b/i.test(String(read.owner_must || '').trim())) : null;
  return { id: row.id, textSha: textSha(row.line), priority: row.priority, priority_why: row.why, class: row.class, guard: row.guard, verdict,
    head: verdict === 'WRITTEN' ? head : null, unclear: verdict === 'UNCLEAR' ? head.unclear : verdict === 'INVENTED' ? `the writer used facts not in the row: ${inv.join(', ')}` : verdict === 'ERROR' ? `writer failed: ${head.error}` : null,
    inventions: inv, check: read ? { pass: actAgrees, act_agrees: actAgrees, reader: read } : null };
}

function reviewTxt(recs) {
  const L = [`PLAIN HEADS — sample of ${recs.length}, highest priority first · ${new Date().toISOString().slice(0, 16)}`, 'Each row: priority (derived off the record, your GRADE overrides it) · the four-line head · what a weaker reader predicted from the head alone · the row\'s real test.', ''];
  for (const r of recs) {
    L.push(`${r.id} · PRIORITY ${r.priority} (${r.priority_why}) · ${r.verdict}`);
    if (r.head) {
      L.push(`  ${r.head.done_when}`, `  Now: ${r.head.now}`, `  From you: ${r.head.from_you}`, `  Waits on: ${r.head.waits_on}`);
      if (r.check) L.push(`  cold reader predicted the test: ${r.check.reader.test_checks || r.check.reader.error}`, `  cold reader predicted your act: ${r.check.reader.owner_must || ''}${r.check.act_agrees === false ? '  ⚠ disagrees with FROM YOU' : ''}`);
      L.push(`  real test: ${r.guard || 'none named'}`);
    } else L.push(`  ${r.unclear || ''}`);
    L.push('');
  }
  return L.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2); const arg = (f, d) => (a.includes(f) ? a[a.indexOf(f) + 1] : d);
  if (cmd === 'rank') {
    const r = ranked(); const top = Number(arg('--top', 40));
    const hist = {}; for (const x of r) hist[x.priority] = (hist[x.priority] || 0) + 1;
    console.log(`${r.length} open rows · priority histogram ${Object.entries(hist).sort((x, y) => y[0] - x[0]).map(([p, n]) => `${p}:${n}`).join(' ')}`);
    for (const x of r.slice(0, top)) console.log(`  ${x.priority} ${x.id} ${x.class} · ${x.why}`);
  } else if (cmd === 'sample') {
    const n = Number(arg('--n', 20)); const rows = ranked().slice(0, n);
    const cwd = join(tmpdir(), 'plain-heads'); mkdirSync(cwd, { recursive: true });
    const recs = await pool(rows, Number(arg('--concurrency', 10)), (row) => writeHead(row, { call: (p, o) => claudeJson(p, { ...o, cwd }) }));
    const at = new Date().toISOString();
    appendFileSync(resolve(REPO, HEADS), recs.map((r) => JSON.stringify({ at, ...r })).join('\n') + '\n');
    const out = resolve(REPO, 'docs/specs/vna/plain-heads-sample.txt'); writeFileSync(out, reviewTxt(recs));
    const v = {}; for (const r of recs) v[r.verdict] = (v[r.verdict] || 0) + 1;
    console.log(`plain heads · ${recs.length} rows · ${Object.entries(v).map(([k, c]) => `${k} ${c}`).join(' · ')} → ${out.replace(REPO + '/', '')}`);
  } else if (cmd === 'backfill') {
    // --ids C1,C2: only those rows (a /steer that declares new rows writes their heads before it dispatches; C1027's runner refuses a headless row).
    const only = arg('--ids', '') ? new Set(arg('--ids', '').split(',')) : null;
    const rows = needsHead(ranked()).filter((r) => !only || only.has(r.id)).slice(0, Number(arg('--n', 1e9)));
    const cwd = join(tmpdir(), 'plain-heads'); mkdirSync(cwd, { recursive: true });
    const recs = await pool(rows, Number(arg('--concurrency', 10)), (row) => writeHead(row, { call: (p, o) => claudeJson(p, { ...o, cwd }) }));
    const at = new Date().toISOString();
    if (recs.length) appendFileSync(resolve(REPO, HEADS), recs.map((r) => JSON.stringify({ at, ...r })).join('\n') + '\n');
    const out = resolve(REPO, 'docs/specs/vna/plain-heads-backfill.txt'); writeFileSync(out, reviewTxt(recs).replace(/^PLAIN HEADS — sample of/, 'PLAIN HEADS — backfill of'));
    const v = {}; for (const r of recs) v[r.verdict] = (v[r.verdict] || 0) + 1;
    console.log(`plain heads backfill · ${recs.length} rows · ${Object.entries(v).map(([k, c]) => `${k} ${c}`).join(' · ') || 'nothing to write'} → ${out.replace(REPO + '/', '')}`);
  } else { console.error('usage: plain-heads.mjs rank [--top N] | sample [--n 20] [--concurrency 10] | backfill [--n N] [--concurrency 10]'); process.exit(2); }
}
