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
// THE TITLE (operator 2026-11-05: "never just show the steer number, always summarise into a reasonable title") is a fifth field of
// the SAME call — no second model call. The no-invention check below covers it like every field; every surface reads it through
// row-title.mjs titleOf (model title, else the deterministic fallback), never computed in two places.
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
//   node scripts/ops/plain-heads.mjs backfill [--ids C1,C2 [--force]] [--retitle] [--n N] [--concurrency 10]  the rest (C1020aa, bf-6386): only rows with no head for their
//                                    current text, or whose head failed the cold read; writes docs/specs/vna/plain-heads-backfill.txt
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifySpec } from '../vna/spec-clarity.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C1116f: a stranger's repo (npx sets VNA_REPO), never the package's own folder
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
// retitle (backfill --retitle): also a WRITTEN head with no title yet (written before the title field existed, 2026-11-05) — opt-in, so a
// bare backfill never re-buys every head in the spec for a title.
export function needsHead(rows, heads = loadContext().heads, { retitle = false } = {}) {
  return rows.filter((r) => { const h = heads.get(r.id); return !h || h.textSha !== textSha(r.line) || h.verdict !== 'WRITTEN' || (h.check && h.check.pass === false) || (retitle && !(h.head && String(h.head.title || '').trim())); });
}

// (1) No invention: every number and row id in the head appears in the row text.
export function inventions(head, rowText) {
  // token against token, never a substring (2026-11-05: an invented "30" in a title passed because the row carried "C2330")
  const TOK = /\bC\d+[a-z]{0,2}\d*\b|\b\d+(?:[.,]\d+)?\b/g; const src = String(rowText); const out = [];
  const have = new Set([...src.matchAll(TOK)].map((m) => m[0]));
  for (const m of src.matchAll(/\d+(?:[.,]\d+)?/g)) if (!/[A-Za-z]$/.test(src.slice(0, m.index))) have.add(m[0]);
  const text = Object.values(head || {}).join(' ');
  for (const m of text.matchAll(TOK)) if (!have.has(m[0])) out.push(m[0]);
  return [...new Set(out)];
}

export const WRITE = (raw, { parent = null, after = null } = {}) => `You rewrite one spec row so its owner can judge it in five seconds. Use ONLY facts in the row text below; never add a number, a time, a count, a name or a mechanism that is not written there. Plain words: no file paths, no CLI commands, no slogans, no lifecycle prefixes, no commit hashes, no dates, no row ids except in "waits_on". Each field at most 20 words; say the one thing that matters, drop the list.
The repo's rooms (automated workers) do all building, fixing, drafting and composing. "from_you" is only what the OWNER alone can do: answer a question, sign in with his own account, pay, press send on something already drafted, publish, or a legal or money decision. Building or fixing anything is never "from_you".

Return ONLY a JSON object with five string fields:
- "title": 3 to 8 plain words naming what the row delivers, in the row's own words, written from the part AFTER any preamble the row shares with its sibling rows (a "chair decomposition of … each item its own row —" lead, or any lead clause before the first " — " that only says where the row came from); sentence case, no row id, no number the row does not carry, no trailing full stop
- "done_when": the state that is true once the row closes, checkable yes or no, starting "Done when"
- "now": what is broken or missing today, one sentence
- "from_you": "nothing" or the one act or answer only the operator can give, one short sentence
- "waits_on": another row id the row says it waits on, or "nothing"
If the row text does not say what done looks like, return {"unclear": "<what is missing, one sentence>"} instead.

THE ROW:
${raw}${after ? `

THE PART OF THE ROW AFTER THE PREAMBLE ITS SIBLING ROWS SHARE (write the title from this part; the siblings carry the same preamble, so a title from it names them all):
${after}` : ''}${parent ? `

THE OPERATOR'S OWN WORDS THIS ROW WAS SPLIT FROM (${parent.via}). Read them only to name the title the way he would; every fact, number and field still comes from THE ROW alone:
${parent.words}` : ''}`;
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
    // C1116f: no claude on PATH is a named engine miss, never an unhandled spawn error that kills the backfill before it writes a record
    p.on('error', (e) => { clearTimeout(t); res({ error: e.code === 'ENOENT' ? 'ENGINE_BINARY_MISSING: claude is not on PATH — install Claude Code, then re-run plain-heads.mjs backfill' : String(e.message || e) }); });
    p.stdin.on('error', () => {});
    p.stdout.on('data', (d) => { out += d; }); p.on('close', () => { clearTimeout(t); const m = out.match(/\{[\s\S]*\}/); try { res(m ? JSON.parse(m[0]) : { error: out.slice(0, 200) || 'no output' }); } catch { res({ error: `unparsed: ${out.slice(0, 200)}` }); } });
    p.stdin.end(prompt);
  });
}

async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

export async function writeHead(row, { call = claudeJson, write = WRITE, parent = null, after = null } = {}) {   // C1231: write — the A/B door (plain-heads-ab.mjs); default the live prompt
  const w = (raw) => (parent || after ? write(raw, { parent, after }) : write(raw));   // parent: his words it came from (parentWords) · after: its own part past the shared preamble (afterPreamble)
  let head = await call(w(row.raw), { model: 'sonnet' });
  if (head.error) head = await call(w(row.raw), { model: 'sonnet' });   // one retry: a transient refusal or timeout, never a loop
  let inv = head.unclear || head.error ? [] : inventions(head, row.raw);
  if (inv.length) { head = await call(`${w(row.raw)}\n\nYour last attempt used facts not in the row: ${inv.join(', ')}. Remove them.`, { model: 'sonnet' }); inv = head.unclear || head.error ? [] : inventions(head, row.raw); }
  const verdict = head.error ? 'ERROR' : head.unclear ? 'UNCLEAR' : inv.length ? 'INVENTED' : 'WRITTEN';
  const read = verdict === 'WRITTEN' ? await call(READ(head), { model: 'haiku' }) : null;
  // The mechanical half of the cold read: does the reader, from the head alone, agree whether he has an act? The rest of the read
  // (its guess at the test, beside the real guard) is kept for a person to grade, never scored by a regex of the prose.
  const actAgrees = read && !read.error ? (/^nothing\b/i.test(String(head.from_you).trim()) === /^nothing\b/i.test(String(read.owner_must || '').trim())) : null;
  return { id: row.id, textSha: textSha(row.line), priority: row.priority, priority_why: row.why, class: row.class, guard: row.guard, verdict,
    head: verdict === 'WRITTEN' ? head : null, unclear: verdict === 'UNCLEAR' ? head.unclear : verdict === 'INVENTED' ? `the writer used facts not in the row: ${inv.join(', ')}` : verdict === 'ERROR' ? `writer failed: ${head.error}` : null,
    inventions: inv, check: read ? { pass: actAgrees, act_agrees: actAgrees, reader: read } : null, ...(parent ? { title_context: parent.via } : {}) };
}

// THE TITLE'S CONTEXT (operator 2026-11-05: "are we using ncd / etc to snip out of the transcript? it should help to put the title as
// useful context"). A chair decomposition is the chair's paraphrase; the title writer also reads the operator's own words it was split
// from, found the way the compile already finds them — never a second NCD: (1) steer-compile.mjs parentSpanOf (the named parent row's
// `from: tape:…` pointer, else the lead clause found verbatim on the tape by aim.mjs fromPointer, the gzip-nearest tape snip) re-read off the
// tape by aim.mjs resolveFrom; (2) the parent row it names, "(C2330)", whose text the spec declared verbatim; (3) the operator words the
// row's own trailing span quotes. None of them → no context, the row alone. Bounded at PARENT_MAX chars.
export const PARENT_MAX = 1500;
// the row's own part past the preamble its siblings share (row-title.mjs stripPreamble over the spec's shared leads), or null when none
export async function afterPreamble(rows, { specText = null } = {}) {
  const T = await import('./row-title.mjs'); const spec = specText ?? (() => { try { return readFileSync(resolve(REPO, SPEC), 'utf8'); } catch { return ''; } })();
  const shared = T.sharedLeads(spec); const out = new Map();
  for (const r of rows) { const b = T.rowBody(r.line || r.raw); const s = T.stripPreamble(b, shared); if (s && s !== b) out.set(r.id, s); }
  return out;
}
const isDecomposition = (raw) => /chair decomposition|\bsplit from C\d+|\(C\d{2,5}[a-z]?\)/i.test(String(raw));
export async function parentWords(rows, { specText = null, tape = null, deps = null } = {}) {
  const out = new Map(); const want = rows.filter((r) => isDecomposition(r.raw)); if (!want.length) return out;
  const D = deps || { ...(await import('../vna/steer-compile.mjs')), ...(await import('../vna/aim.mjs')), ...(await import('./row-title.mjs')) };
  const spec = specText ?? (() => { try { return readFileSync(resolve(REPO, SPEC), 'utf8'); } catch { return ''; } })();
  let t = tape; if (!t) { try { t = D.loadTape(); } catch { t = []; } }
  const lines = spec.split('\n'); const clip = (x) => String(x).replace(/<\/?[a-z][\w-]*>/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, PARENT_MAX);   // a harness tag (<command-args>) is never his word
  for (const r of want) {
    const body = D.rowBody(r.line || r.raw);
    const par = D.parentSpanOf(body, { specText: spec, tape: t });
    if (par) { const got = D.resolveFrom(par.pointer, t); if (got.ok && got.span.trim()) { out.set(r.id, { words: clip(got.span), via: `the tape span ${par.pointer}, via ${par.via}` }); continue; } }
    const named = /\((C\d{2,5}[a-z]?)\)/.exec(D.leadClauseOf(body)) || /\bsplit from (C\d+[a-z]?)\b/i.exec(body);
    const pl = named && lines.find((l) => new RegExp(`^\\s*- \\[[ xX]\\] ${named[1]}\\b`).test(l));
    if (pl) { out.set(r.id, { words: clip(D.rowBody(pl)), via: `parent row ${named[1]}, as the spec declared it` }); continue; }
    const q = /operator's words \*"([^"]{8,})"\*/i.exec(r.line || r.raw);
    if (q) out.set(r.id, { words: clip(q[1]), via: 'the operator words the row quotes' });
  }
  return out;
}

function reviewTxt(recs) {
  const L = [`PLAIN HEADS — sample of ${recs.length}, highest priority first · ${new Date().toISOString().slice(0, 16)}`, 'Each row: priority (derived off the record, your GRADE overrides it) · the four-line head · what a weaker reader predicted from the head alone · the row\'s real test.', ''];
  for (const r of recs) {
    L.push(`${r.id} · PRIORITY ${r.priority} (${r.priority_why}) · ${r.verdict}`);
    if (r.head) {
      L.push(`  Title: ${r.head.title || '(none written — the board prints the fallback)'}`, `  ${r.head.done_when}`, `  Now: ${r.head.now}`, `  From you: ${r.head.from_you}`, `  Waits on: ${r.head.waits_on}`);
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
    const parents = await parentWords(rows); const afters = await afterPreamble(rows);
    const recs = await pool(rows, Number(arg('--concurrency', 10)), (row) => writeHead(row, { call: (p, o) => claudeJson(p, { ...o, cwd }), parent: parents.get(row.id) || null, after: afters.get(row.id) || null }));
    const at = new Date().toISOString();
    appendFileSync(resolve(REPO, HEADS), recs.map((r) => JSON.stringify({ at, ...r })).join('\n') + '\n');
    const out = resolve(REPO, 'docs/specs/vna/plain-heads-sample.txt'); writeFileSync(out, reviewTxt(recs));
    const v = {}; for (const r of recs) v[r.verdict] = (v[r.verdict] || 0) + 1;
    console.log(`plain heads · ${recs.length} rows · ${Object.entries(v).map(([k, c]) => `${k} ${c}`).join(' · ')} → ${out.replace(REPO + '/', '')}`);
  } else if (cmd === 'backfill') {
    // --ids C1,C2: only those rows (a /steer that declares new rows writes their heads before it dispatches; C1027's runner refuses a headless row).
    const only = arg('--ids', '') ? new Set(arg('--ids', '').split(',')) : null;
    const rows = (only && a.includes('--force') ? ranked() : needsHead(ranked(), undefined, { retitle: a.includes('--retitle') })).filter((r) => !only || only.has(r.id))   // --force: with --ids, rewrite those rows whatever their head.slice(0, Number(arg('--n', 1e9)));
    const cwd = join(tmpdir(), 'plain-heads'); mkdirSync(cwd, { recursive: true });
    const parents = await parentWords(rows); const afters = await afterPreamble(rows);
    const recs = await pool(rows, Number(arg('--concurrency', 10)), (row) => writeHead(row, { call: (p, o) => claudeJson(p, { ...o, cwd }), parent: parents.get(row.id) || null, after: afters.get(row.id) || null }));
    const at = new Date().toISOString();
    mkdirSync(resolve(REPO, 'docs/specs/vna'), { recursive: true }); mkdirSync(dirname(resolve(REPO, HEADS)), { recursive: true });
    if (recs.length) appendFileSync(resolve(REPO, HEADS), recs.map((r) => JSON.stringify({ at, ...r })).join('\n') + '\n');
    const out = resolve(REPO, 'docs/specs/vna/plain-heads-backfill.txt'); writeFileSync(out, reviewTxt(recs).replace(/^PLAIN HEADS — sample of/, 'PLAIN HEADS — backfill of'));
    const v = {}; for (const r of recs) v[r.verdict] = (v[r.verdict] || 0) + 1;
    console.log(`plain heads backfill · ${recs.length} rows · ${Object.entries(v).map(([k, c]) => `${k} ${c}`).join(' · ') || 'nothing to write'} → ${out.replace(REPO + '/', '')}`);
  } else { console.error('usage: plain-heads.mjs rank [--top N] | sample [--n 20] [--concurrency 10] | backfill [--n N] [--concurrency 10]'); process.exit(2); }
}
