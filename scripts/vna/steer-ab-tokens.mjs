#!/usr/bin/env node
// scripts/vna/steer-ab-tokens.mjs — C510 WHAT /steer COSTS: TOKENS PER UNIT OF WORK BY COMPLEXITY PERCENTILE, STEER vs PLAIN,
// READ RETROACTIVELY FROM THE RECORD (operator 2026-10-01: "there is an AB test right we can't see how many tokens are used when
// you use the/steer command versus when you use any other regular goal or prompt … retroactively compare the percentile
// complexity tasks to how many tokens were needed to meet them and graph that … a line chart … with the/steer command and
// without … versus the percentile complexity of the work that was done").
//
// TRANSPORT ONLY. Every decision is in scripts/vna/steer-ab-rules.mjs (C510b, seven PROVED rows in the crystal); this file reads
// the transcripts (~/.claude/projects/<repo>/*.jsonl), asks git for the commit facts, reads the flight tape for the walk's
// off-lane share, and writes three receipts (design: docs/specs/vna/token-savings-design.txt):
//   data/vna/steer-ab-tokens.ndjson   one row per unit, APPEND-ONLY, idempotent on (session, sha) — the record (AXIOM 1: retain)
//   data/vna/steer-ab-tokens.json     the derived reading, regenerated whole from the ndjson: ten deciles × {STEER, PLAIN}
//                                     × {n, median}, hollow/UNDERPOWERED under n 5, the formula, the confounds, the open spans
//   (the headless runner's verdict rows — kind verdict, `work` = the commit, `usage` on the row (C66) — are the /steer
//   command's execution route: STEER units with route 'runner', session 'runner'; chair units carry route 'chair')
//   docs/specs/vna/steer-ab-tokens.html  the line chart: x = complexity decile, y = median total tokens per unit, two lines,
//                                     n printed per point, a thin decile hollow and labelled UNDERPOWERED, confounds on the page
// A unit is the span from a prompt to the commit it produced; the commit is the one git ANSWERED to this session (`[main
// <sha>]` in a tool_result) — never a sha that merely appears (the hook's TREE rows name other rooms' commits). The reading
// REPORTS, never concludes: two medians per decile with both n; a difference only where both n ≥ 5; never the word "saves".
//
// Incremental: a per-transcript byte cursor (.thetacog/steer-ab-tokens.cursor.json) set at the start of the OPEN span, so a
// unit that straddles two runs is read whole next time and no usage row is ever skipped (W4). --full re-reads everything
// (the ndjson still appends only what is new). LLM-free. Never a dollar (KR40).
//   node scripts/vna/steer-ab-tokens.mjs [--transcripts <dir>] [--repo <dir>] [--full] [--json]
//   node scripts/vna/steer-ab-tokens.mjs --unit <sha>        print the unit's row and the usage rows that sum to it
//   node scripts/vna/steer-ab-tokens.mjs --tooth-graph [--savings <json>]   C635g: write public/vna/tooth-graph.svg + src/lib/tooth-graph-reading.json from the receipt
// Rust port row: C510-R (steer-ab-rules.mjs header) — the reading holds mass; the transport stays node.
// @guard tests/vna/c510-steer-vs-plain-tokens-by-complexity.test.mjs
import { appendMember, members } from '../ops/cache-fold.mjs';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { unitsOf, rankUnits, decilesOf, appendPlan, unitKey, complexityOf, STEER, PLAIN, UNDERPOWERED_N, FIELDS, usageOf, total, savingsReading, foldAmends, amendPlan, steeringLedger, steeringOf, nextIsReset, theirsPerCall, SPEC_CORPUS, USAGE_SOURCE } from './steer-ab-rules.mjs';
import { latticeFacts } from './cog.mjs';
import { renderTicksSvg, renderToothGraphSvg, toothGraphReading } from './steer-ab-svg.mjs';   // C519 (b): the same bytes the page paints, saved per render · C635g: the tooth graph

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const TRANSCRIPTS = process.env.VNA_TRANSCRIPTS || resolve(homedir(), '.claude/projects', '-' + REPO.replace(/\//g, '-').replace(/^-/, ''));
export const NDJSON = process.env.VNA_STEER_AB_NDJSON || resolve(REPO, 'data/vna/steer-ab-tokens.ndjson');
export const JSON_OUT = process.env.VNA_STEER_AB_JSON || resolve(REPO, 'data/vna/steer-ab-tokens.json');
export const HTML_OUT = process.env.VNA_STEER_AB_HTML || resolve(REPO, 'docs/specs/vna/steer-ab-tokens.html');
export const CURSOR = process.env.VNA_STEER_AB_CURSOR || resolve(REPO, '.thetacog/steer-ab-tokens.cursor.json');
export const FLIGHT = process.env.VNA_FLIGHT_TAPE || resolve(REPO, 'data/vna/flight-tape.ndjson');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
// C519 — the % savings receipts: per TICK (C510's unit), derived from the unit record; one row per day of crossing COUNTS,
// append-only (a later row for a day supersedes); the json derived whole — the stats page reads it, never recomputes
export const DAILY_NDJSON = process.env.VNA_TOKEN_SAVINGS_NDJSON || resolve(REPO, 'data/vna/token-savings-daily.ndjson');
export const SAVINGS_JSON = process.env.VNA_TOKEN_SAVINGS_JSON || resolve(REPO, 'data/vna/token-savings.json');
// C519 (b): every chart saved — a dated, sha-named snapshot (the data json + the two svgs drawn from it) per render, never overwritten
export const CHARTS_DIR = process.env.VNA_TOKEN_SAVINGS_CHARTS || resolve(REPO, 'data/vna/token-savings-charts');
export const FORMULA = 'complexity = log2(1 + files) + log2(1 + insertions + deletions) + log2(1 + dirs) + off_pct / 25 — files, lines, dirs from `git show --numstat`; off_pct the flight tape commit row\'s delta.offPct (the one Rust walk), 0 when the walk has not landed; percentile mid-rank over ALL units (both labels), ties count half; decile = min(9, floor(pct / 10))';
export const CONFOUNDS = [
  'TASK MIX — STEER prompts are mostly spec rows; PLAIN prompts run from "push" to a three-domain ask. The complexity decile is the only control; within a decile the mix is uncontrolled.',
  'MODEL AND HARNESS CHANGE OVER TIME — every unit carries the model and the Claude Code version it ran under; a decile that mixes models is read with that in view.',
  'THE SKILL\'S OWN MASS — a /steer prompt injects the skill text, so a STEER unit starts with more new context than a PLAIN one by construction. It is inside the total, not subtracted.',
  'CACHE READS — the total is the four usage fields summed, cache reads included, as the row asks; the record keeps the four apart so a reader can re-total without them.',
  'PARALLEL ROOMS — nine sessions on one tree; a span may hold hook rows caused by another room\'s commit. Those tokens are still this session\'s spend; the commit is attributed only by git\'s own answer to this session.',
  'OPEN SPANS — a prompt that produced no commit is not a unit; its tokens are counted under open_spans and are not on the chart.',
  'THIN DECILES — n under 5 on either line is drawn hollow and labelled UNDERPOWERED; no difference is printed for it.',
];

const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** complete lines from `offset` with each line's byte offset; a truncated last line is left for the next read (spend.mjs's rule) */
export function linesFrom(path, offset = 0) {
  const fd = openSync(path, 'r'); try {
    const size = fstatSync(fd).size; if (size <= offset) return { rows: [], offsets: [], next: offset };
    const buf = Buffer.alloc(size - offset); readSync(fd, buf, 0, buf.length, offset);
    const rows = [], offsets = []; let at = 0;
    while (at < buf.length) {
      const nl = buf.indexOf(10, at); if (nl < 0) break;
      const line = buf.toString('utf8', at, nl); if (line.trim()) { try { rows.push(JSON.parse(line)); offsets.push(offset + at); } catch {} }
      at = nl + 1;
    }
    return { rows, offsets, next: offset + at };
  } finally { closeSync(fd); }
}

/** the commits of the repo, newest first, as a resolver over sha prefixes — one git call per run; facts per sha on demand */
export function gitResolver(repo = REPO) {
  const bySha = new Map();
  try {
    const out = execFileSync('git', ['log', '--all', '--format=%H%x1f%cI%x1f%s'], { cwd: repo, encoding: 'utf8', maxBuffer: 256 << 20 });
    for (const l of out.split('\n')) { if (!l) continue; const [sha, at, subject] = l.split('\x1f'); bySha.set(sha, { sha, at, subject }); }
  } catch {}
  const byPrefix = new Map(); for (const sha of bySha.keys()) byPrefix.set(sha.slice(0, 7), [...(byPrefix.get(sha.slice(0, 7)) || []), sha]);
  const facts = new Map();
  return (prefix) => {
    const p = String(prefix || ''); if (p.length < 7) return null;
    const cands = (byPrefix.get(p.slice(0, 7)) || []).filter((s) => s.startsWith(p)); if (cands.length !== 1) return null;
    const sha = cands[0]; if (facts.has(sha)) return facts.get(sha);
    const c = { ...bySha.get(sha), ...numstat(repo, sha) }; facts.set(sha, c); return c;
  };
}
/** files · insertions · deletions · distinct top-level dirs, from `git show --numstat` (a binary file's `-` counts as 0 lines) */
export function numstat(repo, sha) {
  let files = 0, insertions = 0, deletions = 0; const dirs = new Set();
  try {
    const out = execFileSync('git', ['show', '--numstat', '--format=', sha], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const l of out.split('\n')) { const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l); if (!m) continue; files += 1; insertions += m[1] === '-' ? 0 : Number(m[1]); deletions += m[2] === '-' ? 0 : Number(m[2]); const path = m[3].replace(/^.*=> /, '').replace(/[{}]/g, ''); dirs.add(path.includes('/') ? path.split('/')[0] : '.'); }
  } catch {}
  return { files, insertions, deletions, dirs: dirs.size };
}

function readCursor(path = CURSOR) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } }

/**
 * ONE RUN over the transcript directory: units closed since each file's cursor, appended once; the json and the html rebuilt
 * whole from the ndjson. Every collaborator injectable so the guard runs it over a fixture directory and a scratch repo.
 */
/** the corpus the hook payload stands in for, in bytes, at a commit: the two tracked specs at that sha (git), spec-tree.json as it is on disk (untracked); cached per sha */
export function corpusBytesAt(repo, sha, cache = new Map()) {
  if (cache.has(sha)) return cache.get(sha);
  let b = 0; for (const f of SPEC_CORPUS) { if (f.endsWith('.json')) { try { b += statSync(resolve(repo, f)).size; } catch {} continue; } try { b += Number(execFileSync('git', ['cat-file', '-s', `${sha}:${f}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || 0; } catch {} }
  cache.set(sha, b); return b;
}
export function run({ transcripts = TRANSCRIPTS, repo = REPO, ndjson = NDJSON, jsonOut = JSON_OUT, htmlOut = HTML_OUT, cursorPath = CURSOR, flight = FLIGHT, runner = RUNNER_NDJSON, dailyNdjson = DAILY_NDJSON, savingsJson = SAVINGS_JSON, chartsDir = CHARTS_DIR, corpusBytes = null, full = false, resolve: resolveSha = null, now = new Date().toISOString() } = {}) {
  const corpusCache = new Map(); const theirsAt = (sha) => theirsPerCall({ bytes: corpusBytes != null ? corpusBytes : corpusBytesAt(repo, sha, corpusCache) });
  const resolver = resolveSha || gitResolver(repo);
  const tape = nd(flight).filter((r) => r && r.kind === 'commit');
  const withLattice = (c) => { const lf = latticeFacts({ sha: c.sha, tapeRows: tape }); return { ...c, off_pct: lf.status === 'landed' ? lf.off_pct : null, lattice: lf.status }; };
  const record = nd(ndjson); const existing = foldAmends(record); const keys = new Set(existing.map(unitKey));
  const cursor = full ? {} : readCursor(cursorPath); const nextCursor = { ...cursor };
  let files = []; try { files = readdirSync(transcripts).filter((f) => f.endsWith('.jsonl')).sort(); } catch {}
  const fresh = []; const open = { spans: 0, calls: 0, total: 0, prompts: 0 }; let scanned = 0, bytes = 0;
  const recordedByFile = new Map(); for (const u of existing) if (u.transcript) recordedByFile.set(u.transcript, [...(recordedByFile.get(u.transcript) || []), u]);
  for (const f of files) {
    const path = join(transcripts, f); let size = 0; try { size = statSync(path).size; } catch { continue; } if (size < 2048) continue;
    // the cursor is the size last read; a file is read WHOLE when it grew (the steering ledger needs the session from its first row:
    // live context accumulates before a unit opens) or when a unit it holds predates the steering field (its amend is owed)
    const seen = Number(cursor[f]) || 0; const owed = (recordedByFile.get(path) || []).some((u) => u.steering === undefined || u.usage_source !== USAGE_SOURCE);   // a unit recorded by an older usage reader is owed its amend
    if (seen >= size && !owed) continue;
    const { rows, offsets, next } = linesFrom(path, 0); scanned += 1; bytes += next;
    const session = f.replace(/\.jsonl$/, ''); const L = steeringLedger(rows);
    const r = unitsOf(rows, { session, resolve: (p) => { const c = resolver(p); return c ? withLattice(c) : null; }, hash: sha256 });
    for (const u of r.units) {
      const th = theirsAt(u.sha); const so = steeringOf(L, u.opened_row, u.closed_row);
      const steering = { ...so, theirs_per_call: th.theirs, raw_per_call: th.raw, capped: th.capped, next_is_reset: nextIsReset(L, u.closed_row), source: 'hook_additional_context attachments live since the last /clear or compaction' };
      fresh.push({ at: now, ...u, route: 'chair', transcript: path, opened_row: u.opened_row, closed_row: u.closed_row, row_offset: offsets[u.opened_row] ?? null, lattice: (resolver(u.sha) && withLattice(resolver(u.sha)).lattice) || 'UNMEASURED', steering });
    }
    if (r.open.spans) { open.spans += 1; open.calls += r.open.calls; open.total += r.open.total; open.prompts += r.open.prompts; }
    nextCursor[f] = next;
  }
  // THE RUNNER ROUTE: every verdict row that names its commit and carries its usage is a STEER unit the headless runner made
  for (const v of runnerUnits({ runner, resolve: (p) => { const c = resolver(p); return c ? withLattice(c) : null; }, now })) { const th = theirsAt(v.sha); fresh.push({ ...v, steering: { ours: (v.snowball_cap || 0) * v.calls, calls: v.calls, resets_in_span: 0, theirs_per_call: th.theirs, raw_per_call: th.raw, capped: th.capped, next_is_reset: false, source: 'runner snowball cap' } }); }   // a -p worker carries its brief's snowball on every call; the cap is the row's declared tokens
  const plan = appendPlan(keys, fresh);
  // a unit already on the record whose fresh reading carries a field the record lacks (a cost, the runner's call count) gets an AMEND row — a later row, never an edit (W4)
  const amends = amendPlan(existing, fresh).map((a) => ({ at: now, ...a }));
  if (plan.length || amends.length) { mkdirSync(dirname(ndjson), { recursive: true }); appendFileSync(ndjson, [...plan, ...amends].map((r) => JSON.stringify(r)).join('\n') + '\n'); }
  mkdirSync(dirname(cursorPath), { recursive: true }); writeFileSync(cursorPath, JSON.stringify(nextCursor, null, 1));
  const allUnits = foldAmends([...record, ...plan, ...amends]);
  const reading = readingOf({ rows: allUnits, open, now, scanned, bytes, transcripts });
  mkdirSync(dirname(jsonOut), { recursive: true }); writeFileSync(jsonOut, JSON.stringify(reading, null, 1) + '\n');
  mkdirSync(dirname(htmlOut), { recursive: true }); writeFileSync(htmlOut, renderChart(reading));
  // C519 — per TICK: the savings reading over every unit on the record; per-day crossing COUNTS appended when they change
  const savings = savingsReadingOf({ rows: allUnits, now });
  const dailyExisting = nd(dailyNdjson); const latest = new Map(); for (const r of dailyExisting) if (r && r.period) latest.set(r.period, r);
  const dailyPlan = savings.per_day.filter((d) => { const p = latest.get(d.period); return !p || ['ticks', 'measured', 'crossed_1m', 'crossed_plain', 'steer', 'plain'].some((k) => p[k] !== d[k]); }).map((d) => ({ at: now, ...d }));
  if (dailyPlan.length) { mkdirSync(dirname(dailyNdjson), { recursive: true }); appendFileSync(dailyNdjson, dailyPlan.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
  mkdirSync(dirname(savingsJson), { recursive: true }); writeFileSync(savingsJson, JSON.stringify(savings, null, 1) + '\n');
  const snapshot = snapshotCharts({ dir: chartsDir, reading: savings, now });   // C519 (b): every render saved
  return { appended: plan.length, amended: amends.length, scanned, bytes, reading, ndjson, jsonOut, htmlOut, dailyAppended: dailyPlan.length, savings, dailyNdjson, savingsJson, snapshot };
}

/** C519 (b): one render's snapshot — the data the charts were drawn from, sha-named, never overwritten (the same stem is skipped),
 *  an index.ndjson row per written snapshot. C826g (2026-10-18): the snapshot is ONE gzip member on <dir>/<day>.tape.gz, never 7 loose
 *  files per render (2,583 born a day, 2.0 GB by 10-18, the file census flagged it). The six SVGs are derived: redrawSnapshot()
 *  re-draws any of them byte for byte from the member, so they are drawn on demand and never stored. */
export const CHART_WAYS = ['regular', 'worst', 'steering', 'rung1', 'rung2', 'rung3'];
export function snapshotCharts({ dir = CHARTS_DIR, reading, now = new Date().toISOString() } = {}) {
  // the hashed json is the DRAWN data (no timestamp inside), so the same data at two times is one sha under two dated stems
  const data = { line: reading.line, computations: reading.computations, headline: reading.headline, ladder: reading.ladder, n: reading.n, crossings: reading.crossings, crossings_by_way: reading.crossings_by_way, expected_by_decile: reading.expected_by_decile, ticks: reading.ticks };
  const json = JSON.stringify(data); const sha = createHash('sha256').update(json).digest('hex');
  const stem = `${String(now).replace(/[:.]/g, '-')}-${sha.slice(0, 12)}`;
  mkdirSync(dir, { recursive: true });
  const indexPath = resolve(dir, 'index.ndjson');
  if (existsSync(indexPath) && readFileSync(indexPath, 'utf8').includes(`"stem":"${stem}"`)) return { dir, stem, sha, written: false };
  const tape = resolve(dir, `${String(now).slice(0, 10)}.tape.gz`);
  if (!appendMember(tape, `${stem}.json`, json, Date.parse(now) || Date.now())) throw new Error(`snapshot did not verify on ${tape}`);
  appendFileSync(indexPath, JSON.stringify({ at: now, stem, sha, tape: `${String(now).slice(0, 10)}.tape.gz`, ticks: reading.n.ticks, above_99: reading.crossings.above }) + '\n');
  return { dir, stem, sha, tape, written: true };
}
/** The saved data of one snapshot, read back off its day tape (or a loose <stem>.json written before C826g). */
export function readSnapshot({ dir = CHARTS_DIR, stem } = {}) {
  const loose = resolve(dir, `${stem}.json`); if (existsSync(loose)) return JSON.parse(readFileSync(loose, 'utf8'));
  for (const m of members(resolve(dir, `${stem.slice(0, 10)}.tape.gz`))) if (m.name === `${stem}.json`) return JSON.parse(m.body.toString('utf8'));
  return null;
}
/** A past chart, re-drawn byte for byte from its saved data. */
export function redrawSnapshot({ dir = CHARTS_DIR, stem, way = 'regular' } = {}) { const d = readSnapshot({ dir, stem }); return d ? renderTicksSvgFor(d, way) : null; }
function renderTicksSvgFor(reading, way) { const pr = reading.ladder && reading.ladder.prior; return renderTicksSvg(reading.ticks, { line: reading.line, way, band: way === 'rung3' && pr ? { low: pr.ratio_low, high: pr.ratio_high, label: `the operator's reference band: ${pr.text}` } : null }); }

/** C519 — the derived savings reading over the unit record: the pure savingsReading (steer-ab-rules.mjs), the one the viz page runs too */
export function savingsReadingOf({ rows = foldAmends(nd(NDJSON)), now = new Date().toISOString() } = {}) { return savingsReading(foldAmends(rows), { now }); }

/** the runner's verdict AND worker rows as STEER units: the /steer dispatch's own usage (C66 keeps it on the row), the commit it
 *  graded — or, when the run never finished, the usage its runner row recorded anyway. C862 (operator 2026-10-15, "this looks
 *  like the stale graph?"): a run that halted at its turn cap, was stopped mid-grade, or was rolled back after a refused commit
 *  still spent the tokens on `v.label`'s declared scope; dropping it because it never resolves to a landed sha is survivorship —
 *  the arm would keep exactly the short, cheap runs and lose the long, costly ones. Every row with a declared scope AND usage the
 *  runner itself recorded enters, finished or not; a row with neither never does — usage is read off the record, never invented. */
export function runnerUnits({ runner = RUNNER_NDJSON, resolve: resolveSha, now = new Date().toISOString() } = {}) {
  const out = [];
  for (const v of nd(runner)) {
    if (!v || !v.usage || !v.label || (v.kind !== 'verdict' && v.kind !== 'worker')) continue;
    const work = v.work || v.head1 || null;
    const c = work ? resolveSha(String(work).slice(0, 10)) : null; if (c && PUBLISH_RE.test(String(c.subject || ''))) continue;
    const u = { input: Number(v.usage.input_tokens) || 0, cache_create: Number(v.usage.cache_creation_input_tokens) || 0, cache_read: Number(v.usage.cache_read_input_tokens) || 0, output: Number(v.usage.output_tokens) || 0 };
    // no landed commit (cap hit before a commit, HEAD never moved, or a rolled-back refusal) — a stable key off the halt event itself, never a collision across halts of the same label
    const sha = c ? c.sha : `halted:${sha256(`${v.kind}:${v.label}:${v.at || ''}`).slice(0, 12)}`;
    // (i) a whole run is never one call: an iteration is one claude -p PROCESS, its API calls are num_turns — the turns first, the process count only without them
    out.push({ at: now, session: 'runner', route: 'runner', label: STEER, usage_source: v.kind === 'verdict' ? 'the runner verdict row (usage summed by the runner)' : 'the runner worker row (usage summed by the runner; the run halted before a verdict)', sha, subject: c ? c.subject || null : null, finished: v.kind === 'verdict', halt_cause: v.kind === 'worker' ? (v.cause || v.reason || null) : null, opened_at: v.at || null, closed_at: c ? c.at : null, prompts: 1, inherited: false, prompt_sha256: null, version: null, model: v.engine || v.preset || null, calls: Number(v.num_turns) > 0 ? Number(v.num_turns) : Array.isArray(v.usage.iterations) && v.usage.iterations.length ? v.usage.iterations.length : 1, calls_source: Number(v.num_turns) > 0 ? 'num_turns' : Array.isArray(v.usage.iterations) && v.usage.iterations.length ? 'iterations' : 'unknown-one', ...u, total: total(u), inputs: c ? { files: c.files, insertions: c.insertions, deletions: c.deletions, dirs: c.dirs, off_pct: c.off_pct ?? null } : { files: 0, insertions: 0, deletions: 0, dirs: 0, off_pct: null }, complexity: c ? complexityOf(c) : 0, lattice: c ? (c.lattice || 'UNMEASURED') : 'UNMEASURED', transcript: runner, row_label: v.label || null, cost_usd: Number.isFinite(Number(v.cost_usd)) ? Number(v.cost_usd) : null, cost_source: v.cost_source || null, snowball_cap: Number(v.cap) > 0 ? Number(v.cap) : v.snowball && Number(v.snowball.cap) > 0 ? Number(v.snowball.cap) : 0 });   // C519 (c): the billed cost rides the tick; exact only when cost_source is api
  }
  return out;
}
const PUBLISH_RE = /^chore\(commit-page\): publish/;

/** the derived reading, whole, from the record rows — the json the stats page reads */
export function readingOf({ rows = foldAmends(nd(NDJSON)), open = null, now = new Date().toISOString(), scanned = null, bytes = null, transcripts = TRANSCRIPTS } = {}) {
  const ranked = rankUnits(rows.map((r) => ({ ...r, complexity: Number.isFinite(r.complexity) ? r.complexity : complexityOf(r.inputs || {}) })));
  const deciles = decilesOf(ranked);
  const by = (l) => ranked.filter((u) => u.label === l);
  const models = {}; for (const u of ranked) { const k = u.model || 'unknown'; models[k] = (models[k] || 0) + 1; }
  const med = (xs) => { if (!xs.length) return null; const b = [...xs].sort((a, c) => a - c); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  return {
    at: now, row: 'C510', unit: 'a prompt → the commit git answered to this session ([main <sha>] in a tool_result)', y: 'median total tokens per unit (input + cache_create + cache_read + output)', x: 'complexity decile over all units',
    formula: FORMULA, underpowered_n: UNDERPOWERED_N, confounds: CONFOUNDS,
    n: { units: ranked.length, steer: by(STEER).length, steer_chair: by(STEER).filter((u) => (u.route || 'chair') === 'chair').length, steer_runner: by(STEER).filter((u) => u.route === 'runner').length, plain: by(PLAIN).length, inherited: ranked.filter((u) => u.inherited).length, lattice_landed: ranked.filter((u) => u.lattice === 'landed').length },
    open_spans: open, models, scanned_transcripts: scanned, scanned_bytes: bytes, transcripts,
    overall: { steer: { n: by(STEER).length, median_total: med(by(STEER).map((u) => u.total)) }, plain: { n: by(PLAIN).length, median_total: med(by(PLAIN).map((u) => u.total)) }, note: 'pooled medians are NOT comparable across the task mix — read the deciles' },
    deciles: deciles.map((d) => ({ ...d, label: d.underpowered ? 'UNDERPOWERED' : 'measured' })),
    check: 'node scripts/vna/steer-ab-tokens.mjs --unit <sha> prints the usage rows that sum to any point; every row on data/vna/steer-ab-tokens.ndjson names its transcript and row span',
    sources: ['~/.claude/projects/<repo>/*.jsonl message.usage', 'git log / git show --numstat', 'data/vna/flight-tape.ndjson commit rows (delta.offPct)'],
  };
}

/** --unit <sha>: the row and the usage rows between its opened_row and closed_row, re-read from the transcript it names */
export function unitRows(sha, { ndjson = NDJSON } = {}) {
  const row = foldAmends(nd(ndjson)).filter((r) => r.sha && r.sha.startsWith(sha)).pop(); if (!row) return { status: 'UNMEASURED', why: 'no unit on the record for that sha' };
  if (row.route === 'runner') return { status: 'measured', row, usage: [{ source: 'runner verdict row', ...Object.fromEntries(FIELDS.map((k) => [k, row[k]])) }], sum: { ...Object.fromEntries(FIELDS.map((k) => [k, row[k]])), total: row.total }, agrees: true };
  let rows = []; try { rows = linesFrom(row.transcript, row.row_offset || 0).rows; } catch (e) { return { status: 'UNMEASURED', why: `transcript unreadable: ${e.message}`, row }; }
  const span = rows.slice(0, (row.closed_row - row.opened_row) + 1);
  const usage = span.map((r, i) => ({ i: row.opened_row + i, ts: r.timestamp || null, ...(usageOf(r) || {}) })).filter((r) => r.input != null);
  const sum = usage.reduce((a, u) => { for (const k of FIELDS) a[k] += u[k]; return a; }, { input: 0, cache_create: 0, cache_read: 0, output: 0 });
  return { status: 'measured', row, usage, sum: { ...sum, total: total(sum) }, agrees: total(sum) === row.total };
}

// ── THE CHART — inline SVG, no library; the dataviz contract: 2 px lines, ≥ 8 px markers with a surface ring, a legend for
// two series, selective direct labels (n per point, the row asks for it), a hover layer, a table view, confounds on the page.
// Palette validated on the dark surface #0b1017 (STEER #1f9f86 · PLAIN #a56bff — CVD ΔE 21.9, contrast ≥ 3:1).
export function renderChart(R) {
  const W = 760, H = 360, PL = 70, PR = 24, PT = 28, PB = 64;
  const cells = R.deciles; const vals = cells.flatMap((c) => [c.steer.median, c.plain.median]).filter((v) => v != null);
  const yMax = vals.length ? Math.max(...vals) * 1.1 : 1; const X = (d) => PL + (d + 0.5) * ((W - PL - PR) / 10); const Y = (v) => PT + (H - PT - PB) * (1 - v / yMax);
  const fmt = (n) => { if (n == null || !Number.isFinite(n)) return '—'; const s = n < 0 ? '-' : '', a = Math.abs(n); return s + (a >= 1e6 ? `${(a / 1e6).toFixed(2)} M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)} k` : String(Math.round(a))); };   // sign kept, magnitude scaled
  const series = (key, cls) => {
    const pts = cells.filter((c) => c[key].median != null);
    const line = pts.filter((c) => !c.underpowered).length > 1 ? `<polyline class="ln ${cls}" points="${pts.filter((c) => !c.underpowered).map((c) => `${X(c.decile).toFixed(1)},${Y(c[key].median).toFixed(1)}`).join(' ')}"/>` : '';
    const dots = pts.map((c) => `<g class="pt ${cls}${c.underpowered ? ' hollow' : ''}" data-decile="${c.decile}" data-n="${c[key].n}" data-median="${c[key].median}"><circle cx="${X(c.decile).toFixed(1)}" cy="${Y(c[key].median).toFixed(1)}" r="7" class="ring"/><circle cx="${X(c.decile).toFixed(1)}" cy="${Y(c[key].median).toFixed(1)}" r="5" class="dot"/><title>${key.toUpperCase()} · ${c.range} · median ${fmt(c[key].median)} tokens · n ${c[key].n}${c.underpowered ? ' · UNDERPOWERED (n under 5 on a line)' : ''}</title></g>`).join('');
    return line + dots;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = f * yMax; return `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="axl" x="${PL - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`; }).join('');
  const xl = cells.map((c) => `<text class="axl" x="${X(c.decile).toFixed(1)}" y="${H - PB + 16}" text-anchor="middle">${c.range}</text><text class="nl${c.underpowered ? ' un' : ''}" x="${X(c.decile).toFixed(1)}" y="${H - PB + 30}" text-anchor="middle">n ${c.steer.n} / ${c.plain.n}</text>${c.underpowered ? `<text class="nl un lbl" x="${X(c.decile).toFixed(1)}" y="${H - PB + 42}" text-anchor="middle">UNDERPOWERED</text>` : ''}`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="median tokens per unit by complexity decile, STEER versus PLAIN"><title>x: complexity decile over all units · y: median total tokens per unit · n per point as STEER / PLAIN · hollow = UNDERPOWERED</title>${ticks}<line class="axis" x1="${PL}" x2="${W - PR}" y1="${H - PB}" y2="${H - PB}"/>${xl}${series('plain', 'plain')}${series('steer', 'steer')}<text class="axl" x="${PL}" y="${PT - 10}">median tokens per unit</text><text class="axl" x="${W - PR}" y="${H - 8}" text-anchor="end">complexity decile (all units)</text></svg>`;
  const table = `<table><thead><tr><th>decile</th><th>STEER n</th><th>STEER median</th><th>PLAIN n</th><th>PLAIN median</th><th>STEER − PLAIN</th><th>power</th></tr></thead><tbody>${cells.map((c) => `<tr class="${c.underpowered ? 'un' : ''}"><td>${c.range}</td><td>${c.steer.n}${c.routes && c.routes.steer && c.routes.steer.runner ? ` <span class="dim">(${c.routes.steer.runner} runner)</span>` : ''}</td><td>${fmt(c.steer.median)}</td><td>${c.plain.n}</td><td>${fmt(c.plain.median)}</td><td>${c.difference == null ? '—' : (c.difference > 0 ? '+' : '') + fmt(c.difference)}</td><td>${c.underpowered ? 'UNDERPOWERED' : 'measured'}</td></tr>`).join('')}</tbody></table>`;
  const open = R.open_spans ? `${R.open_spans.spans} open span${R.open_spans.spans === 1 ? '' : 's'} (${fmt(R.open_spans.total)} tokens, not on the chart)` : 'open spans not counted this run';
  return `<!doctype html><meta charset="utf-8"><title>What /steer costs</title>
<style>:root{--bg:#0a0c10;--surface:#0b1017;--fg:#d8dee9;--dim:#7b8794;--grid:#1a2230;--steer:#1f9f86;--plain:#a56bff}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,Menlo,monospace;max-width:900px;margin:0 auto}
h1{font-size:18px;margin:0 0 4px}.dim{color:var(--dim)}svg{display:block;background:var(--surface);border:1px solid var(--grid);border-radius:6px;margin:12px 0}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:#2a3442;stroke-width:1}.axl{fill:var(--dim);font-size:10px}.nl{fill:var(--fg);font-size:10px}.nl.un{fill:var(--dim)}.nl.un.lbl{font-size:7px;letter-spacing:-0.2px}
.ln{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.ln.steer{stroke:var(--steer)}.ln.plain{stroke:var(--plain)}
.pt .ring{fill:var(--surface)}.pt .dot{fill:var(--steer)}.pt.plain .dot{fill:var(--plain)}.pt.hollow .dot{fill:var(--surface);stroke-width:2;stroke:var(--steer)}.pt.plain.hollow .dot{stroke:var(--plain)}
.pt:hover .dot{r:6}.legend span{display:inline-block;margin-right:16px}.sw{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:6px}.sw.steer{background:var(--steer)}.sw.plain{background:var(--plain)}
table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}th,td{text-align:right;padding:4px 8px;border-bottom:1px solid var(--grid)}th:first-child,td:first-child{text-align:left}tr.un td{color:var(--dim)}
ol,ul{padding-left:20px}code{color:#9fc4b8}</style>
<h1>What <code>/steer</code> costs — tokens per unit of work, by complexity decile</h1>
<div class="dim">C510 · read from the record ${esc(R.at)} · ${R.n.units} units (${R.n.steer} STEER: ${R.n.steer_chair ?? '—'} in chat, ${R.n.steer_runner ?? '—'} by the headless runner · ${R.n.plain} PLAIN) · ${R.n.inherited ?? 0} units inherited their prompt (a later commit under the same prompt) · ${open} · this page reports, never concludes</div>
<div class="legend"><span><i class="sw steer"></i>STEER — the unit opened with the /steer command</span><span><i class="sw plain"></i>PLAIN — any other prompt</span><span class="dim">hollow point = UNDERPOWERED (n under ${R.underpowered_n} on a line)</span></div>
${svg}
${table}
<p><b>The unit.</b> ${esc(R.unit)}. <b>y:</b> ${esc(R.y)}. <b>x:</b> ${esc(R.x)}.</p>
<p><b>The formula, from the commit alone.</b> <code>${esc(R.formula)}</code></p>
<p><b>Confounds, on the page because they are not netted out:</b></p><ol>${R.confounds.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
<p><b>You don't have to take my word for it.</b> ${esc(R.check)}. Models on the record: ${esc(Object.entries(R.models || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none')}.</p>
<p class="dim">Sources: ${R.sources.map(esc).join(' · ')}. Not sufficient for: how hard the work was (Rice), what the tokens bought, or a price (none pinned).</p>
`;
}

// C635g — THE TOOTH GRAPH, COMMITTED: --tooth-graph reads the C519 receipt already on disk (no transcript re-read) and writes the
// light rung-2 picture iamfim.com serves (public/vna/tooth-graph.svg) and the reading its captions quote
// (src/lib/tooth-graph-reading.json), so a caption number is never hand-typed. data/ is untracked; these two files are the
// committed projection of it. Refuses to write when the receipt has no rung-2 series (an empty picture is a different claim).
export const TOOTH_GRAPH_SVG = process.env.VNA_TOOTH_GRAPH_SVG || resolve(REPO, 'public/vna/tooth-graph.svg');
export const TOOTH_GRAPH_READING = process.env.VNA_TOOTH_GRAPH_READING || resolve(REPO, 'src/lib/tooth-graph-reading.json');
export function writeToothGraph({ savingsJson = SAVINGS_JSON, svgOut = TOOTH_GRAPH_SVG, readingOut = TOOTH_GRAPH_READING } = {}) {
  const S = JSON.parse(readFileSync(savingsJson, 'utf8'));
  const has = (S.ticks || []).some((t) => t.rungs && t.rungs.rung2 && Number.isFinite(t.rungs.rung2.savings));
  if (!has) throw new Error(`tooth graph: ${savingsJson} carries no rung-2 series — refusing to write an empty picture`);
  const svg = renderToothGraphSvg(S.ticks); const reading = toothGraphReading(S);
  mkdirSync(dirname(svgOut), { recursive: true }); writeFileSync(svgOut, svg);
  mkdirSync(dirname(readingOut), { recursive: true }); writeFileSync(readingOut, JSON.stringify(reading, null, 1) + '\n');
  return { svgOut, readingOut, bytes: Buffer.byteLength(svg), reading };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--tooth-graph')) { const t = writeToothGraph({ savingsJson: arg('--savings') || SAVINGS_JSON }); console.log(`tooth graph · rung 2 · ${t.reading.crossed} of ${t.reading.n} ticks at or above 99 % · ${t.bytes} bytes\n  → ${t.svgOut}\n  → ${t.readingOut}`); process.exit(0); }
  if (arg('--unit')) { const r = unitRows(arg('--unit')); console.log(JSON.stringify(r, null, 1)); process.exit(r.status === 'measured' ? 0 : 1); }
  const r = run({ transcripts: arg('--transcripts') || TRANSCRIPTS, repo: arg('--repo') || REPO, full: argv.includes('--full') });
  if (argv.includes('--json')) console.log(JSON.stringify({ c510: r.reading, c519: r.savings }, null, 1));
  else {
    const R = r.reading;
    console.log(`steer-ab-tokens · ${r.scanned} transcripts read (${(r.bytes / 1e6).toFixed(1)} MB) · +${r.appended} units → ${R.n.units} on the record (${R.n.steer} STEER · ${R.n.plain} PLAIN) · ${R.open_spans ? R.open_spans.spans : 0} open spans`);
    for (const d of R.deciles) console.log(`  ${d.range.padEnd(9)} STEER n ${String(d.steer.n).padStart(3)} median ${d.steer.median == null ? '—' : Math.round(d.steer.median).toLocaleString().padStart(11)} · PLAIN n ${String(d.plain.n).padStart(3)} median ${d.plain.median == null ? '—' : Math.round(d.plain.median).toLocaleString().padStart(11)}${d.underpowered ? ' · UNDERPOWERED' : ` · Δ ${Math.round(d.difference).toLocaleString()}`}`);
    const S = r.savings; const H = S.headline; const LH = S.ladder.health; console.log(`  C519 LADDER · rung1 ${LH.rung1.crossed}/${LH.rung1.n} · rung2 ${LH.rung2.crossed}/${LH.rung2.n} (health ${LH.rung2.rate == null ? '—' : (LH.rung2.rate * 100).toFixed(1) + ' %'}) · rung3 ${LH.rung3.crossed}/${LH.rung3.n} (health ${LH.rung3.rate == null ? '—' : (LH.rung3.rate * 100).toFixed(1) + ' %'}) · ${LH.flagged.length} flagged`); console.log(`  C519 HEADLINE steering-context savings: ${H.crossed} of ${H.n} ticks crossed 99 % (${H.unmeasured} UNMEASURED) · ${H.cap_note} · dip: ${H.dip.reading}`);
    for (const d of S.per_day.slice(-7)) console.log(`    ${d.period}: ${d.crossed_steering || 0} of ${d.ticks} ticks crossed on the headline`);
    console.log(`  C519 per tick · ${S.n.ticks} ticks (${S.n.measured} measured, ${S.n.unmeasured} UNMEASURED) · ${S.crossings.above} of ${S.crossings.n} crossed 99 % vs the 1M counterfactual (${S.n.above_99_steer} STEER) · ${S.n.above_99_plain_baseline} crossed 99 % vs PLAIN · +${r.dailyAppended} day rows`);
    for (const w of S.crossings.which.slice(-8)) console.log(`    ${w.day} ${String(w.sha).slice(0, 10)} p${w.pct} ${w.label}/${w.route} · ${(w.vs_1m * 100).toFixed(2)} %${w.underpowered ? ' · EXPECTED underpowered' : ''}`);
    for (const d of S.per_day.slice(-5)) console.log(`    ${d.period}: ${d.crossed_1m} of ${d.ticks} ticks crossed`);
    console.log(`  → ${r.jsonOut}\n  → ${r.htmlOut}\n  → ${basename(r.ndjson)} (append-only)\n  → ${r.savingsJson}\n  → ${basename(r.dailyNdjson)} (append-only)`);
  }
}
