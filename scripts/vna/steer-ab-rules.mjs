// scripts/vna/steer-ab-rules.mjs — C510b THE STEER-vs-PLAIN TOKEN READING'S DECISIONS, AS PURE FUNCTIONS THE LIVE CODE CALLS.
//
// THE CRYSTAL's method (spec §7, data/formal/harness-properties.json; the C236 steer-rules.mjs precedent): every decision the
// reading takes is a pure function here, its domain is enumerated or generated under a seed in the guard, and the file that
// RUNS the reading (scripts/vna/steer-ab-tokens.mjs — transport: transcripts, git, the receipt files) imports these and never
// carries a second copy. No fs, no git, no child processes: a file that imports this imports nothing else. The design is
// docs/specs/vna/token-savings-design.txt §2–§8; the properties, by id:
//   P-SUM      unitsOf        the per-unit total is the exact sum of the assistant usage rows inside the unit's span
//   P-LABEL    labelOf        a unit is STEER iff the prompt IN FORCE when it opened is the /steer command (`/steergoal`, `/goal`,
//                             prose: PLAIN); a commit made after a commit with no new prompt between inherits that prompt's label
//   P-RECEIPT  receiptShas    a unit closes only on git's own `[main <sha>]` answer inside a tool_result — never a sha in prose,
//                             in the hook's TREE context, or in an assistant message; a commit-page publish never closes one
//   P-RANK     rankUnits      the percentile is a monotone function of the complexity score (percentileOf, the one function)
//   P-DECILE   decilesOf      a decile with n < UNDERPOWERED_N on either line is underpowered: never solid, never a difference
//   P-MATCH    decilesOf      a decile's medians are computed over that decile's members only; the bins partition the units
//   P-APPEND   appendPlan     a re-run appends no row whose (session, sha) key is already on the record; it never rewrites
//   P-LADDER   (cited)        the C513 ladder never lets a row close without retry + thought + ask — goal.mjs stopCheck, proved
//                             by tests/vna/c513-goal-is-the-reminder-steer-is-the-run.test.mjs; not re-proved here
//
// PORT ROW: C510-R — unitsOf/complexityOf/rankUnits DECIDE a number and the reading over them HOLDS MASS (3.3 GB of
// transcripts on 2026-10-01), so under MAXIMISE RUST they move into the crate's streaming reader once this node reading has
// been green on the real corpus; the acceptance is byte-identical output on the fixture and the real record.
// @guard tests/vna/c510b-steer-ab-properties.test.mjs
import { percentileOf } from './cog-percentile.mjs';
import { upstreamStatusOf, UPSTREAM_CAUSE } from '../../src/lib/backup/upstream-outage-cause.mjs';   // C560a: the outage class, read off the row

export const STEER = 'STEER';
export const PLAIN = 'PLAIN';
export const UNDERPOWERED_N = 5;   // the C510 row: a decile with n under 5 is drawn hollow and labelled UNDERPOWERED
export const FIELDS = ['input', 'cache_create', 'cache_read', 'output'];
const KEYS = { input: 'input_tokens', cache_create: 'cache_creation_input_tokens', cache_read: 'cache_read_input_tokens', output: 'output_tokens' };
export const PUBLISH_SUBJECT = /^chore\(commit-page\): publish/;   // the post-commit page, made by a hook, never by the prompt
const STEER_TAG = /<command-name>\/steer<\/command-name>/;
const STEER_BARE = /^\s*\/steer(?:\s|$)/;
const RECEIPT = /\[main ([0-9a-f]{7,40})\]/g;   // git's own answer to `git commit` on main

/** the human prompt text of a transcript row, or null: a `user` row that is not a tool_result, not isMeta, not a sidechain */
export function promptTextOf(row) {
  if (!row || row.type !== 'user' || row.isMeta || row.isSidechain || !row.message) return null;
  const c = row.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.some((x) => x && x.type === 'tool_result')) return null;
  const t = c.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n');
  return t || null;
}

/** P-LABEL: the opening prompt is the /steer command — the harness tag, or the bare word followed by a space or the end */
export const isSteerPrompt = (text) => STEER_TAG.test(String(text || '')) || STEER_BARE.test(String(text || ''));
export const labelOf = (text) => (isSteerPrompt(text) ? STEER : PLAIN);

/** the four usage fields of an assistant row, or null when the row carries no usage */
export function usageOf(row) {
  const u = row && row.type === 'assistant' && row.message && row.message.usage;
  if (!u) return null;
  const out = {}; for (const k of FIELDS) out[k] = Number(u[KEYS[k]]) || 0; return out;
}
export const total = (u) => FIELDS.reduce((s, k) => s + (Number(u[k]) || 0), 0);
// ONE CALL PER message.id (C519-P-ONECALL): Claude Code writes one transcript row per content block, every block of a message repeating
// the same message.id and the same usage. A call is counted once per message.id (requestId the fallback; a row with neither is its own
// call). Every reader of usage — C510's units, C519's ticks, the steering ledger — goes through callKeyOf; the unit names the reader.
export const USAGE_SOURCE = 'transcript usage rows, one call per message.id';
export function callKeyOf(row) { if (!row || !row.message || !row.message.usage) return null; const id = row.message.id; if (typeof id === 'string' && id) return id; if (typeof row.requestId === 'string' && row.requestId) return row.requestId; return null; }

/** P-RECEIPT: every `[main <sha>]` inside the row's tool_result blocks — git's answer, carried back to the session */
export function receiptShas(row) {
  if (!row || row.type !== 'user' || !row.message || !Array.isArray(row.message.content)) return [];
  const out = [];
  for (const c of row.message.content) {
    if (!c || c.type !== 'tool_result') continue;
    const txt = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
    RECEIPT.lastIndex = 0; let m; while ((m = RECEIPT.exec(txt))) out.push(m[1]);
  }
  return out;
}

const zero = () => ({ calls: 0, input: 0, cache_create: 0, cache_read: 0, output: 0 });

/**
 * P-SUM, P-LABEL, P-RECEIPT together: the units of one session's rows (parsed jsonl, in file order).
 * `resolve(shaPrefix)` → { sha, at, subject, files, insertions, deletions, dirs, off_pct } | null — the commit facts (git, or a
 * fixture); the rules never touch git. A unit opens at the first prompt after the last close, closes on the first receipt
 * that resolves to a non-publish commit. Rows before the first prompt, and a span still open at the end, are counted under
 * `open` (calls, total, prompts) and never become units.
 */
export function unitsOf(rows, { session = null, resolve = () => null, hash = (s) => s } = {}) {
  const units = []; let cur = null, last = null; const open = { ...zero(), prompts: 0, spans: 0, opened_row: null }; const seen = new Set();   // opened_row: the index of the open span's first row, so a transport can set its cursor there and re-read the span next run
  const add = (acc, u) => { acc.calls += 1; for (const k of FIELDS) acc[k] += u[k]; };
  for (const [i, row] of rows.entries()) {
    const text = promptTextOf(row);
    if (text != null) {
      if (RESET_CMD.test(text)) { if (cur) cur.prompts += 0; continue; }   // a /clear is a reset of the session, never an ask: it opens nothing
      last = { label: labelOf(text), prompt_sha256: hash(text), version: row.version || null };
      if (!cur) cur = { session, ...last, opened_at: row.timestamp || null, opened_row: i, prompts: 1, inherited: false, model: null, ...zero() };
      else cur.prompts += 1;
      continue;
    }
    const u = usageOf(row);
    if (u) {
      const key = callKeyOf(row); if (key) { if (seen.has(key)) continue; seen.add(key); }   // one call per message, whatever its block count
      // a spend row after a close, with a prompt still in force: the same prompt is producing its next commit — the unit opens
      // here and INHERITS that prompt's label (prompts 0). Spend before any prompt at all is an orphan, counted under open.
      if (!cur && last) cur = { session, ...last, opened_at: row.timestamp || null, opened_row: i, prompts: 0, inherited: true, model: null, ...zero() };
      if (cur) { add(cur, u); if (!cur.model && row.message.model) cur.model = row.message.model; } else add(open, u);
      continue;
    }
    if (!cur) continue;
    for (const sha of receiptShas(row)) {
      const c = resolve(sha);
      if (!c || PUBLISH_SUBJECT.test(String(c.subject || ''))) continue;
      const { calls, input, cache_create, cache_read, output } = cur;
      units.push({ ...cur, usage_source: USAGE_SOURCE, sha: c.sha, subject: c.subject || null, closed_at: row.timestamp || c.at || null, closed_row: i, total: total({ input, cache_create, cache_read, output }), inputs: { files: c.files, insertions: c.insertions, deletions: c.deletions, dirs: c.dirs, off_pct: c.off_pct ?? null }, complexity: complexityOf(c) });
      void calls; cur = null; break;
    }
  }
  if (cur) { open.spans += 1; open.opened_row = cur.opened_row; open.prompts += cur.prompts; open.calls += cur.calls; for (const k of FIELDS) open[k] += cur[k]; }
  return { units, open: { ...open, total: total(open) } };
}

/** THE ONE FORMULA (design §3): logs of the heavy-tailed counts, plus the walk's off-lane share scaled to four doublings at 100 % */
export function complexityOf({ files = 0, insertions = 0, deletions = 0, dirs = 0, off_pct = null } = {}) {
  const l2 = (x) => Math.log2(1 + Math.max(0, Number(x) || 0));
  const off = Number.isFinite(off_pct) ? Math.min(100, Math.max(0, off_pct)) / 25 : 0;
  return l2(files) + l2(insertions + deletions) + l2(dirs) + off;
}

/** P-RANK: every unit's percentile on the one ruler (all units, both labels), mid-rank, ties count half; then its decile */
export function rankUnits(units) {
  const sorted = units.map((u) => u.complexity).filter(Number.isFinite).sort((a, b) => a - b);
  return units.map((u) => { const pct = percentileOf(u.complexity, sorted); return { ...u, pct, decile: pct == null ? null : decileOf(pct) }; });
}
export const decileOf = (pct) => Math.min(9, Math.max(0, Math.floor(pct / 10)));

export function median(xs) { if (!xs.length) return null; const b = [...xs].sort((a, c) => a - c); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }

/** P-DECILE: the cell is underpowered when either line has fewer than `min` units; a difference exists only when it is not */
export function cellOf({ steer = [], plain = [], min = UNDERPOWERED_N } = {}) {
  const underpowered = steer.length < min || plain.length < min;
  const ms = median(steer), mp = median(plain);
  return { steer: { n: steer.length, median: ms }, plain: { n: plain.length, median: mp }, underpowered, difference: underpowered ? null : ms - mp };
}

/** P-MATCH: the ten deciles, each cell over its own members only — a unit is in exactly one bin */
export function decilesOf(ranked, { min = UNDERPOWERED_N } = {}) {
  return Array.from({ length: 10 }, (_, d) => {
    const here = ranked.filter((u) => u.decile === d);
    const cell = cellOf({ steer: here.filter((u) => u.label === STEER).map((u) => u.total), plain: here.filter((u) => u.label === PLAIN).map((u) => u.total), min });
    const routes = (l) => { const o = {}; for (const u of here) if (u.label === l) { const k = u.route || 'chair'; o[k] = (o[k] || 0) + 1; } return o; };
    return { decile: d, range: `p${d * 10}–p${d === 9 ? 100 : d * 10 + 9}`, ...cell, routes: { steer: routes(STEER), plain: routes(PLAIN) }, shas: { steer: here.filter((u) => u.label === STEER).map((u) => u.sha), plain: here.filter((u) => u.label === PLAIN).map((u) => u.sha) } };
  });
}

/** P-APPEND: the key is (session, sha); only rows whose key is absent from the record are appended, in order, once each */
export const unitKey = (u) => `${u.session || ''}:${u.sha}`;
export function appendPlan(existingKeys, rows) {
  const seen = new Set(existingKeys); const out = [];
  for (const r of rows) { const k = unitKey(r); if (seen.has(k)) continue; seen.add(k); out.push(r); }
  return out;
}

// ── C519 THE % TOKEN SAVINGS PER TICK — /steer AGAINST PLAIN (MEASURED) AND AGAINST A 1M-CONTEXT RUN (THE COUNTERFACTUAL) ──
// (operator 2026-10-01: "we need a % token savings comparing normals runs with /steer - (and the 1m context case as the
// counterfactual) … spikes going above a line that is 99%" · amended the same day: "the 99% is not the whole day! each is per
// tick, we just have to show some ticks save over 99% vs the percentile complexity expected" · "obviously not an average").
// The unit is ONE TICK — C510's unit, a prompt to the commit it produced. Pure, over the C510 unit rows; the properties, by id:
//   P-TICK     tickSavings      savings(tick) = 1 − actual ÷ EXPECTED(decile); actual = input + cache_create + cache_read of the
//                               tick (output is what the model wrote, not carried); the cache-weighted actual is shown beside it
//   P-EXPECT   expectedByDecile EXPECTED(decile) = median calls of the PLAIN ticks in that decile × 1,000,000 — a DECLARED
//                               counterfactual; a decile with no PLAIN tick has no EXPECTED (the tick is UNMEASURED, never 0);
//                               fewer than 5 PLAIN ticks ⇒ the EXPECTED is underpowered and the tick is drawn hollow
//   P-PLAIN    tickSavings      vs PLAIN (measured) = 1 − actual ÷ the PLAIN median actual of the decile — the second baseline
//   P-CROSS    crossingsOf      "k of n ticks crossed 99 %" counts measured ticks with vs_1m ≥ LINE_99 and names which (sha, day, pct)
//   P-PERIOD   perPeriod        a day or a week is ONLY how many ticks crossed in it — counts, never an averaged savings figure
export const LINE_99 = 0.99;
// C519 THE TOP-FIFTH LEVEL (operator 2026-10-02: "if it never hits 99% lets make it show the 20% of the time it crosses boundary x (and
// say what % that is)" · "could be best to do the 20% on all of them, then if we do that dynamically, then the % tells us where we are vs
// the 99 % claims"). Every chart draws TWO lines: the 99 % claim (fixed — what crossing counts against) and the TOP-FIFTH LEVEL, the
// savings the best 20 % of measured ticks reach, recomputed on every render. The share is 20 % by definition, so the READING is the
// level, never the share: its distance from 99 % says where that chart stands against the claim (rung 2's top fifth above 99 % is the
// claim held; rung 1's at ~87 % is how far the whole call is from it). The lowest value among the best ceil(20 % · n) measured ticks; < 5 values → null.
export const TOP_SHARE = 0.2;
export function topShareLevel(values, share = TOP_SHARE) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 5) return null;
  return v[Math.max(0, v.length - Math.ceil(share * v.length))];   // the lowest of the best ceil(share·n): exactly that many ticks sit at or above it
}
export function topShareNote(level, line = LINE_99) {
  if (level == null) return 'top fifth: UNMEASURED — fewer than 5 measured ticks';
  const d = (level - line) * 100; const pc = (x) => `${(x * 100).toFixed(x >= 0.99 ? 2 : 1)} %`;
  return `the best 20 % of ticks reach ${pc(level)} — ${d >= 0 ? `${d.toFixed(2)} points above` : `${(-d).toFixed(1)} points below`} the ${pc(line)} claim`;
}
export const COUNTERFACTUAL_1M = 1_000_000;
export const CACHE_CREATE_WEIGHT = 1.25, CACHE_READ_WEIGHT = 0.1;   // list-price ratios against a fresh input token: cache write 1.25×, cache read 0.1×
export const EXPECTED_FORMULA = 'EXPECTED(tick) = median calls of the PLAIN ticks in the tick\'s complexity decile (C510\'s ruler, both labels ranked together) × 1,000,000 tokens — every call of a 1M-context run carrying the full window; a declared counterfactual, never a run we made';
export const SAVINGS_FORMULA = 'savings(tick) = 1 − actual ÷ EXPECTED; actual = the tick\'s input + cache_create + cache_read tokens (cache-weighted also shown: writes ×1.25, reads ×0.1); never averaged over a day or a week — a day or a week is only how many ticks crossed the line in it';

export const tickActual = (u) => (Number(u.input) || 0) + (Number(u.cache_create) || 0) + (Number(u.cache_read) || 0);
export const tickWeighted = (u) => (Number(u.input) || 0) + CACHE_CREATE_WEIGHT * (Number(u.cache_create) || 0) + CACHE_READ_WEIGHT * (Number(u.cache_read) || 0);
export const savingsOf = (actual, baseline) => (baseline > 0 && Number.isFinite(actual) ? 1 - actual / baseline : null);
export const dayOf = (ts) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
/** ISO week of a YYYY-MM-DD day, as YYYY-Www */
export function weekOf(day) {
  const d = new Date(`${day}T00:00:00Z`); if (Number.isNaN(d.getTime())) return null;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
/** P-EXPECT: per decile, the PLAIN ticks' median calls × 1M and their median actual; null where no PLAIN tick sits */
export function expectedByDecile(ranked, { min = UNDERPOWERED_N } = {}) {
  return Array.from({ length: 10 }, (_, d) => {
    const plain = ranked.filter((u) => u.decile === d && u.label === PLAIN);
    if (!plain.length) return null;
    const mc = median(plain.map((u) => Number(u.calls) || 0));
    const perCall = (f) => plain.map((u) => (Number(u.calls) > 0 ? f(u) / Number(u.calls) : null)).filter((v) => v != null);
    return { decile: d, n_plain: plain.length, median_calls: mc, expected_1m: mc * COUNTERFACTUAL_1M, plain_median_actual: median(plain.map(tickActual)), plain_median_weighted: median(plain.map(tickWeighted)), plain_median_call: median(perCall(tickActual)), plain_median_call_weighted: median(perCall(tickWeighted)), underpowered: plain.length < min };
  });
}
/** EVERY WAY TO COMPUTE IT (the 11:44 amendment: "we need to show each way to compute it … never one number standing in for the
 *  others"): per tick and per call · raw and price-weighted · vs PLAIN (measured) and vs the 1M worst case · and the EXACT dollar
 *  cost the API returned for an API-billed `claude -p` tick (cost_source 'api'). Each way carries its formula; waysOf computes all. */
export const WAYS = Object.freeze([
  { id: 'steering_vs_corpus', label: 'HEADLINE · steering-context savings · per tick, token-weighted over its calls', unit: 'ratio', formula: '1 − Σ over the tick\'s calls of (tokens of every hook_additional_context attachment still live in the session at that call, since the last /clear or compaction) ÷ (calls × min(1,000,000, bytes of SPEC-VNA-COCKPIT.md + SPEC-FROM-TREE.md + spec-tree.json at the tick\'s HEAD ÷ 4)) — both sides the same quantity, one bytes÷4 ruler, so any per-token price cancels' },
  { id: 'tick_raw_vs_1m', label: 'per tick · raw · vs 1M (worst case)', unit: 'ratio', formula: '1 − (input + cache_create + cache_read of the tick) ÷ (median calls of the decile\'s PLAIN ticks × 1,000,000)' },
  { id: 'tick_raw_vs_plain', label: 'per tick · raw · vs PLAIN (measured)', unit: 'ratio', formula: '1 − (input + cache_create + cache_read of the tick) ÷ (median of the same sum over the decile\'s PLAIN ticks)' },
  { id: 'tick_weighted_vs_1m', label: 'per tick · price-weighted · vs 1M', unit: 'ratio', formula: '1 − (input + 1.25 × cache_create + 0.1 × cache_read of the tick) ÷ (median PLAIN calls × 1,000,000) — cache reads at their billed rate' },
  { id: 'tick_weighted_vs_plain', label: 'per tick · price-weighted · vs PLAIN', unit: 'ratio', formula: '1 − (input + 1.25 × cache_create + 0.1 × cache_read of the tick) ÷ (median of the same weighted sum over the decile\'s PLAIN ticks)' },
  { id: 'call_raw_vs_1m', label: 'per call · raw · vs 1M', unit: 'ratio', formula: '1 − (the tick\'s mean call: raw sum ÷ calls) ÷ 1,000,000 — one call against one full window' },
  { id: 'call_raw_vs_plain', label: 'per call · raw · vs PLAIN', unit: 'ratio', formula: '1 − (the tick\'s mean call) ÷ (median mean call over the decile\'s PLAIN ticks)' },
  { id: 'call_weighted_vs_1m', label: 'per call · price-weighted · vs 1M', unit: 'ratio', formula: '1 − (the tick\'s mean weighted call) ÷ 1,000,000' },
  { id: 'call_weighted_vs_plain', label: 'per call · price-weighted · vs PLAIN', unit: 'ratio', formula: '1 − (the tick\'s mean weighted call) ÷ (median mean weighted call over the decile\'s PLAIN ticks)' },
  { id: 'exact_cost_usd', label: 'exact cost — API-billed claude -p ticks only', unit: 'usd', formula: 'cost_usd as the API returned it on the runner\'s verdict row (cost_source api); a worker-reported figure (cost_source worker) is shown by its source and never as exact; a chat tick carries no billed cost' },
]);
export function waysOf(t, e) {
  const calls = Number(t.calls) > 0 ? Number(t.calls) : null; const mean = calls ? t.actual / calls : null, meanW = calls ? t.weighted / calls : null;
  const ok = (v) => (v == null || !Number.isFinite(v) ? null : v);
  return {
    tick_raw_vs_1m: e ? ok(savingsOf(t.actual, e.expected_1m)) : null, tick_raw_vs_plain: e ? ok(savingsOf(t.actual, e.plain_median_actual)) : null,
    tick_weighted_vs_1m: e ? ok(savingsOf(t.weighted, e.expected_1m)) : null, tick_weighted_vs_plain: e ? ok(savingsOf(t.weighted, e.plain_median_weighted)) : null,
    call_raw_vs_1m: mean == null ? null : ok(savingsOf(mean, COUNTERFACTUAL_1M)), call_raw_vs_plain: e && mean != null ? ok(savingsOf(mean, e.plain_median_call)) : null,
    call_weighted_vs_1m: meanW == null ? null : ok(savingsOf(meanW, COUNTERFACTUAL_1M)), call_weighted_vs_plain: e && meanW != null ? ok(savingsOf(meanW, e.plain_median_call_weighted)) : null,
    exact_cost_usd: t.cost && t.cost.exact && Number.isFinite(t.cost.usd) ? t.cost.usd : null,
    steering_vs_corpus: t.steering && Number.isFinite(t.steering.savings) ? t.steering.savings : null,
  };
}

// ── THE HEADLINE — STEERING-CONTEXT SAVINGS (7787f08df2, operator: "we know there is an algo that is both fair and shows this") ──
//   ours   = the tokens of every hook_additional_context attachment still live in the session at a call — they stay in context on
//            every call — counted from the transcript since the last /clear or compaction (chars ÷ 4, the one ruler)
//   theirs = min(1,000,000, the corpus that payload stands in for at that call's HEAD ÷ 4): SPEC_CORPUS — ~38 M tokens today
//            (spec-tree.json alone is 150 MB), so a 1M run is already truncated and the cap is printed
//   savings = 1 − Σ ours ÷ (calls × theirs), per tick, token-weighted over its calls; never averaged across ticks
//   P-INVARIANT: both sides are the same quantity, so a price w on both cancels: steeringSavings(w·ours, w·theirs) = steeringSavings(ours, theirs)
export const SPEC_CORPUS = Object.freeze(['docs/specs/vna/SPEC-VNA-COCKPIT.md', 'docs/specs/vna/SPEC-FROM-TREE.md', 'data/vna/spec-tree.json']);
export const CHARS_PER_TOKEN_RULER = 4;
const RESET_CMD = /<command-name>\/clear<\/command-name>/;
const attachmentChars = (a) => { const c = a && a.content; if (typeof c === 'string') return c.length; if (Array.isArray(c)) return c.reduce((s, x) => s + (typeof x === 'string' ? x.length : typeof x === 'object' && x && typeof x.text === 'string' ? x.text.length : 0), 0); return 0; };
/** the ledger over one session's rows: live[i] = steering tokens in context at usage row i (null for every other row); resets = the row
 *  indices of a /clear prompt or a compaction boundary; attachments = hook attachments counted. Pure. */
export function steeringLedger(rows) {
  const live = new Array(rows.length).fill(null); const resets = []; let cur = 0, attachments = 0; const seen = new Set();
  rows.forEach((r, i) => {
    if (!r) return;
    if (r.type === 'attachment' && r.attachment && r.attachment.type === 'hook_additional_context') { cur += Math.round(attachmentChars(r.attachment) / CHARS_PER_TOKEN_RULER); attachments += 1; return; }
    if (r.type === 'system' && r.subtype === 'compact_boundary') { cur = 0; resets.push(i); return; }
    const text = promptTextOf(r); if (text != null && RESET_CMD.test(text)) { cur = 0; resets.push(i); return; }
    if (usageOf(r)) { const key = callKeyOf(r); if (key) { if (seen.has(key)) return; seen.add(key); } live[i] = cur; }   // one call per message
  });
  return { live, resets, attachments };
}
/** a span's reading off the ledger: Σ live over its usage rows, its calls, and how many resets fell inside it */
export function steeringOf(L, from, to) {
  let ours = 0, calls = 0; for (let i = from; i <= to && i < L.live.length; i++) if (L.live[i] != null) { ours += L.live[i]; calls += 1; }
  return { ours, calls, resets_in_span: L.resets.filter((i) => i >= from && i <= to).length };
}
/** is the next event after the span a reset (a /clear or compaction) with no further call in between — the tick before the dip is cleared */
export function nextIsReset(L, to) { for (let i = to + 1; i < L.live.length; i++) { if (L.resets.includes(i)) return true; if (L.live[i] != null) return false; } return false; }
export function theirsPerCall({ bytes = 0 } = {}) { const raw = Math.round(Math.max(0, bytes) / CHARS_PER_TOKEN_RULER); return { theirs: Math.min(COUNTERFACTUAL_1M, raw), raw, capped: raw > COUNTERFACTUAL_1M }; }
export function steeringSavings({ ours = 0, calls = 0, theirs_per_call = 0 } = {}) { const denom = calls * theirs_per_call; if (!(calls > 0 && denom > 0)) return null; return ours > 0 ? 1 - ours / denom : 0; }   // no payload served at all ⇒ the mechanism did not run ⇒ 0, flagged (never 100 %)
/** the headline reading over the ticks: crossings, the cap note, the dip before a reset, per-day counts */
export function headlineOf(ticks, { line = LINE_99 } = {}) {
  const m = ticks.filter((t) => t.steering && Number.isFinite(t.steering.savings));
  const crossed = m.filter((t) => t.steering.savings >= line);
  const raw = m.map((t) => t.steering.raw_per_call).filter(Number.isFinite); const rawMax = raw.length ? Math.max(...raw) : null;
  const before = m.filter((t) => t.steering.next_is_reset), other = m.filter((t) => !t.steering.next_is_reset);
  return {
    id: 'steering_vs_corpus', n: m.length, unmeasured: ticks.length - m.length, crossed: crossed.length, line,
    cap_note: rawMax == null ? 'corpus size UNMEASURED' : `theirs per call = min(1,000,000, corpus ÷ 4): the corpus (SPEC-VNA-COCKPIT.md + SPEC-FROM-TREE.md + spec-tree.json) is ${rawMax.toLocaleString()} tokens at the newest tick, so every call is capped at 1,000,000 — a 1M run is already truncated`,
    dip: { n_before_reset: before.length, before_reset_median: median(before.map((t) => t.steering.savings)), n_other: other.length, other_median: median(other.map((t) => t.steering.savings)), reading: before.length && other.length ? (median(before.map((t) => t.steering.savings)) < median(other.map((t) => t.steering.savings)) ? 'the tick before a /clear reads lower — the session accumulated payload, the clear restored it' : 'no dip before a /clear is visible on this record') : 'UNMEASURED — too few ticks sit right before a reset' },
    confound: 'in this repo every prompt carries the hook, so this series measures the tree/snowball mechanism, not the /steer word; STEER vs PLAIN stays C510\'s measured chart',
    which: crossed.map((t) => ({ sha: t.sha, day: t.day, pct: t.pct, label: t.label, route: t.route, savings: t.steering.savings })),
  };
}
/** the billed cost on a tick, from the runner's verdict row: exact only when the API returned it (cost_source api) */
export const costOf = (u) => (u && u.cost_usd != null && Number.isFinite(Number(u.cost_usd)) && (u.route === 'runner') ? { usd: Number(u.cost_usd), source: u.cost_source || 'unknown', exact: u.cost_source === 'api' } : null);   // null is no cost, never $0

/** P-TICK · P-PLAIN: one tick's two savings against its decile's two baselines; UNMEASURED (measured:false) when the decile has no PLAIN tick */
export function tickSavings(u, expected) {
  const e = u.decile == null ? null : expected[u.decile]; const actual = tickActual(u), weighted = tickWeighted(u);
  const day = dayOf(u.closed_at || u.opened_at); const cost = costOf(u);
  const st = u.steering && typeof u.steering === 'object' ? { ...u.steering, savings: steeringSavings(u.steering) } : null; if (st) st.crossed = st.savings != null && st.savings >= LINE_99;
  const base = { sha: u.sha, session: u.session, route: u.route || 'chair', label: u.label, day, closed_at: u.closed_at || null, pct: u.pct, decile: u.decile, calls: u.calls, calls_source: u.calls_source || null, usage_source: u.usage_source || null, input: Number(u.input) || 0, cache_create: Number(u.cache_create) || 0, cache_read: Number(u.cache_read) || 0, output: Number(u.output) || 0, actual, weighted, cost, steering: st, snowball_cap: u.snowball_cap ?? null, upstream_status: upstreamStatusOf(u) };   // the four usage fields ride the tick: rung 3 and the hand recompute read them
  if (!e) { const r = { ...base, measured: false, why: u.decile == null ? 'no percentile' : 'no PLAIN tick in this decile — no EXPECTED', expected_1m: null, vs_1m: null, vs_1m_weighted: null, plain_median_actual: null, vs_plain: null, above_99: false, underpowered: true }; return { ...r, ways: waysOf(r, null), rungs: ladderOf(r) }; }
  const vs_1m = savingsOf(actual, e.expected_1m);
  const r = { ...base, measured: true, expected_1m: e.expected_1m, vs_1m, vs_1m_weighted: savingsOf(weighted, e.expected_1m), plain_median_actual: e.plain_median_actual, vs_plain: savingsOf(actual, e.plain_median_actual), above_99: vs_1m != null && vs_1m >= LINE_99, above_99_plain: savingsOf(actual, e.plain_median_actual) != null && savingsOf(actual, e.plain_median_actual) >= LINE_99, underpowered: e.underpowered };
  return { ...r, ways: waysOf(r, e), rungs: ladderOf(r) };
}
/** P-CROSS: the measured ticks at or above the line, counted and named */
export function crossingsOf(ticks, { line = LINE_99 } = {}) {
  const measured = ticks.filter((t) => t.measured);
  const which = measured.filter((t) => t.vs_1m >= line).map((t) => ({ sha: t.sha, day: t.day, pct: t.pct, label: t.label, route: t.route, vs_1m: t.vs_1m, underpowered: t.underpowered }));
  return { above: which.length, n: measured.length, unmeasured: ticks.length - measured.length, line, which };
}
/** P-PERIOD: per day or per week, counts only — ticks, crossed vs 1M, crossed vs PLAIN, by label */
export function perPeriod(ticks, keyOf) {
  const m = new Map();
  for (const t of ticks) {
    const k = keyOf(t); if (!k) continue; const r = m.get(k) || { period: k, ticks: 0, measured: 0, crossed_steering: 0, crossed_1m: 0, crossed_plain: 0, steer: 0, plain: 0, steer_crossed_1m: 0, health_r2: { n: 0, crossed: 0, rate: null }, health_r3: { n: 0, crossed: 0, rate: null } };
    r.ticks += 1; if (t.measured) r.measured += 1; if (t.steering && t.steering.crossed) r.crossed_steering = (r.crossed_steering || 0) + 1;
    for (const id of ['rung2', 'rung3']) { const h = r[`health_${id === 'rung2' ? 'r2' : 'r3'}`]; const g = t.rungs && t.rungs[id]; if (g && g.savings != null) { h.n += 1; if (g.crossed) h.crossed += 1; h.rate = h.crossed / h.n; } } if (t.above_99) r.crossed_1m += 1; if (t.above_99_plain) r.crossed_plain += 1; if (t.label === STEER) { r.steer += 1; if (t.above_99) r.steer_crossed_1m += 1; } else r.plain += 1;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

/** THE READING, pure over the unit rows (the C510 record or the same rows read out of a backup archive): every tick with its two savings,
 *  the crossings of the 99 % line (count and identity), per-day and per-week crossing COUNTS, the formulas, what it is NOT sufficient for.
 *  The viz page (/backup/adherence) and the local transport both call this one function — never a second copy. */
export function savingsReading(rows, { now = null } = {}) {
  const ranked = rankUnits(foldAmends(rows).map((r) => ({ ...r, complexity: Number.isFinite(r.complexity) ? r.complexity : complexityOf(r.inputs || {}) })));
  const expected = expectedByDecile(ranked);
  const ticks = ranked.map((u) => tickSavings(u, expected)).sort((a, b) => String(a.closed_at || '').localeCompare(String(b.closed_at || '')));
  const cross = crossingsOf(ticks);
  return {
    at: now, row: 'C519', unit: 'one tick — C510\'s unit: a prompt to the commit it produced (chat), or a headless-runner verdict row', line: LINE_99,
    expected_formula: EXPECTED_FORMULA, savings_formula: SAVINGS_FORMULA,
    baselines: { counterfactual_1m: 'COUNTERFACTUAL — EXPECTED(decile) = median PLAIN calls in the decile × 1,000,000; a declared formula, not a run we made', plain: 'MEASURED — the PLAIN median actual (input + cache_create + cache_read) of the tick\'s complexity decile' },
    expected_by_decile: expected,
    n: { ticks: ticks.length, measured: cross.n, unmeasured: cross.unmeasured, steer: ticks.filter((t) => t.label === STEER).length, plain: ticks.filter((t) => t.label === PLAIN).length, runner: ticks.filter((t) => t.route === 'runner').length, above_99: cross.above, above_99_steer: cross.which.filter((w) => w.label === STEER).length, above_99_plain_baseline: ticks.filter((t) => t.above_99_plain).length, api_billed: ticks.filter((t) => t.cost && t.cost.exact).length, costed: ticks.filter((t) => t.cost).length },
    crossings: cross,
    headline: headlineOf(ticks), ladder: { rungs: LADDER, prior: PRIOR, health: healthOf(ticks), note: 'three charts side by side in severity order, each exact and re-runnable on the record; rungs 2 and 3 are configuration health — a tick below the line is detected with its likely cause, never a gate' },
    computations: WAYS, crossings_by_way: Object.fromEntries(WAYS.filter((w) => w.unit === 'ratio').map((w) => [w.id, ticks.filter((t) => t.ways && t.ways[w.id] != null && t.ways[w.id] >= LINE_99).length])),
    prediction: { stated: 'the operator expects /steer subagent and -p ticks to cross 99 % against the worst case several times a day', falsifier: 'a day of /steer -p ticks whose worst-case savings cross 0.99 at least 3 times, read off this chart', lever: 'the per-call floor is Claude Code\'s own system prompt + CLAUDE.md + brief (≥ 60k tokens), so crossings need a worker that carries the brief alone (C517\'s local door, or a raw API worker) — a separate row, not assumed here', met_today: perPeriod(ticks, (t) => t.day).some((d) => d.steer_crossed_1m >= 3) },
    per_day: perPeriod(ticks, (t) => t.day), per_week: perPeriod(ticks, (t) => (t.day ? weekOf(t.day) : null)),
    ticks,
    split: { local: 'LOCAL — the whole per-tick series, free (MIT), never capped or time-boxed: a basic chart on the stats page, the ndjson for any report the local AI writes', portal: 'PAID — the complete chart on our third-party viz (/backup/adherence), drawn from the BACKED-UP series: dated, countersigned, shareable' },
    not_sufficient_for: ['vs 1M is arithmetic against a declared counterfactual, not a run we made', 'neither line says the work was good (Rice)', 'the task mix inside a decile is uncontrolled', 'a price (none pinned, KR40)'],
    check: 'node scripts/vna/steer-ab-tokens.mjs --unit <sha> prints the usage rows behind any tick; --json prints this reading; data/vna/token-savings-daily.ndjson carries the per-day crossing counts, latest per day in force',
  };
}

/** P-AMEND: an amend row ({ amend: <why>, session, sha, ...fields }) is never a unit; it merges its fields onto the unit with the same
 *  (session, sha) key, later rows winning — a correction is a later row, never an edit (AXIOM 1 W4). Unknown keys are dropped. */
export function foldAmends(rows) {
  const units = []; const idx = new Map(); const pending = new Map();
  for (const r of rows) {
    if (!r || !r.sha) continue; const k = unitKey(r);
    if (r.amend) { const { amend, at, session, sha, ...fields } = r; void amend; void at; void session; void sha; const u = idx.get(k); if (u) Object.assign(units[u], fields); else pending.set(k, { ...(pending.get(k) || {}), ...fields }); continue; }
    idx.set(k, units.length); units.push({ ...r, ...(pending.get(k) || {}) }); pending.delete(k);
  }
  return units;
}
/** the amend rows a fresh reading owes the record: for each fresh unit already on the record, the fields that are present on the fresh one and absent (undefined) on the recorded one */
export const USAGE_AMEND_FIELDS = ['calls', 'calls_source', 'input', 'cache_create', 'cache_read', 'output', 'total', 'steering', 'usage_source'];
export function amendPlan(recorded, fresh, { fields = ['cost_usd', 'cost_source', 'calls_source', 'calls', 'steering', 'snowball_cap'], why = 'late-field' } = {}) {
  const have = new Map(recorded.map((u) => [unitKey(u), u])); const out = [];
  for (const f of fresh) {
    const u = have.get(unitKey(f)); if (!u) continue; const patch = {};
    // a unit recorded by an older usage reader is re-read whole: every usage field, the reader's name with them
    if (f.usage_source && f.usage_source !== u.usage_source) { for (const k of USAGE_AMEND_FIELDS) if (f[k] !== undefined) patch[k] = f[k]; out.push({ amend: 'usage-reader', session: f.session, sha: f.sha, ...patch }); continue; }
    for (const k of fields) if (f[k] !== undefined && f[k] !== null && (u[k] === undefined || u[k] === null || (k === 'calls' && f.calls_source && f.calls_source !== u.calls_source))) patch[k] = f[k];
    if (patch.calls !== undefined && f.calls_source) patch.calls_source = f.calls_source;   // a corrected count carries its source
    if (Object.keys(patch).length) out.push({ amend: why, session: f.session, sha: f.sha, ...patch });
  }
  return out;
}

// ── THE SEVERITY LADDER (f4bb8d488d · 74482472cc): THREE CHARTS SIDE BY SIDE, each exact and re-runnable, each naming the question it
// answers and for whom; rungs 2 and 3 are CONFIGURATION HEALTH — set up right they sit above 99 % essentially every tick, and a tick
// below the line is DETECTED with its likely cause, never gated. The page never ranks a chart fair or unfair.
export const LADDER = Object.freeze([
  { id: 'rung1', line: LINE_99, label: 'RUNG 1 · SEVERE — the whole call against a 1M window', who: "the sceptic's question", question: 'what the whole call costs against a 1M window', formula: '1 − (input + cache_create + cache_read of the tick) ÷ (calls × 1,000,000) — every call charged its whole context, the window charged in full, the same weighting on both sides; a tick above 99 % here is news and is called out' },
  { id: 'rung2', line: LINE_99, label: 'RUNG 2 · STEERING PAYLOAD FOOTPRINT — the steering payload beside the spec it steers by', who: "the engineer's question", question: 'how small the steering payload is beside the spec corpus it stands in for — a size the injector chooses, never the bill', formula: '1 − Σ over the tick\'s calls of (hook_additional_context tokens live at that call, since the last /clear or compaction) ÷ (calls × min(1,000,000, corpus ÷ 4)) — both sides the same quantity on one bytes÷4 ruler, so a per-token price cancels (C519-P-INVARIANT); no payload served at all reads 0 and is flagged' },
  { id: 'rung3', line: LINE_99, label: 'RUNG 3 · PREPARED RUN — a fully specified -p brief against a 1M window', who: 'the question of what the engine does when it is healthy', question: 'what a prepared, fully specified run costs against a 1M window', formula: '1 − ((input_tokens + cache_creation_input_tokens) ÷ num_turns) ÷ 1,000,000 — MEASURED off the verdict row\'s usage off the runner\'s verdict row: the new tokens each call newly added (its brief, its tool results), not the cached prefix it re-reads (rung 1 carries that whole-call view); the brief\'s snowball cap is shown beside it as the DECLARED ceiling, never as the reading; a chat tick is not a prepared run and reads UNMEASURED here' },
]);
// the deployed wrapper's ladder: the same three rungs, rung 1 at 99 % (a wrapper call carries only its prompt, so rung 1 crosses 99 %)
export const WRAPPER_LADDER = Object.freeze(LADDER.map((r) => (r.id === 'rung1' ? Object.freeze({ ...r, line: LINE_99, line_note: undefined }) : r)));
// C563b RUNG 2 IS NAMED AS WHAT IT MEASURES (operator 2026-10-02): rung 2 is 1 − (steering payload ÷ the spec corpus) — a size the
// injector chooses, not the bill and not a proof the work is right. The BILL is the STEER tick against the PLAIN median at the same
// complexity decile (vs_plain), and it prints beside rung 2 wherever rung 2 is shown. Measured 2026-10-02 off data/vna/token-savings.json:
// median 8.7 % lower, n 43, range −424 % to +82.6 %, 25 of 43 cheaper, 0 above 99 %. @guard tests/voice/c563b-rung2-is-not-the-bill.test.mjs
export const RUNG2_READS = 'the steering payload beside the spec it steers by (1 − payload ÷ corpus) — a size the injector chooses, not the bill';
const pct1 = (v) => `${v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)} %`;
/** the bill vs PLAIN over the reading's ticks (savingsReading(...).ticks): the STEER ticks' vs_plain — median, range, how many cheaper */
export function plainBill(ticks) {
  const v = (ticks || []).filter((t) => t && t.label === STEER && t.measured !== false && Number.isFinite(t.vs_plain)).map((t) => t.vs_plain);
  if (!v.length) return { n: 0, median: null, min: null, max: null, cheaper: 0, above_99: 0, words: 'the bill vs PLAIN: UNMEASURED — no /steer tick has a PLAIN tick at its complexity decile' };
  const m = median(v), min = Math.min(...v), max = Math.max(...v), cheaper = v.filter((x) => x > 0).length, above = v.filter((x) => x >= LINE_99).length;
  const dir = m >= 0 ? `median ${pct1(m)} lower` : `median ${pct1(-m)} higher`;
  return { n: v.length, median: m, min, max, cheaper, above_99: above, words: `the bill vs PLAIN at the same complexity decile: ${dir} for /steer (n ${v.length}, range ${pct1(min)} to ${max >= 0 ? '+' : ''}${pct1(max)}, ${cheaper} of ${v.length} cheaper, ${above} above 99 %)` };
}
export const PRIOR = Object.freeze({ text: 'we get between 70 and 130 X improvement', ratio_low: 1 - 1 / 70, ratio_high: 1 - 1 / 130, source: 'the operator, 2026-10-01, verbatim (the C519 row) — a stated prior, unreceipted: no measurement row on the record carries it; drawn on rung 3 as the reference band' });
/** the three rungs of one tick, each { savings, crossed, cause|why } — cause only when measured and below the line */
export function ladderOf(t, { line = LINE_99, rung1Line = LINE_99 } = {}) {
  const calls = Number(t.calls) > 0 ? Number(t.calls) : 0;
  const r1 = calls ? 1 - t.actual / (calls * COUNTERFACTUAL_1M) : null;
  const st = t.steering; const r2 = st && Number.isFinite(st.savings) ? st.savings : null;
  let cause2 = null; if (r2 != null && r2 < line) cause2 = st.ours === 0 ? 'snowball not served — no hook payload live at any call of the tick' : st.calls > 0 && st.ours / st.calls > 0.5 * st.theirs_per_call ? 'session overdue a /clear — the live payload exceeds half the window per call' : 'leaf stale or brief unresolved — the payload is large for the spec it stands in for';
  // RUNG 3 is MEASURED off the run's own usage: the tokens each call newly added = (input + cache_create) ÷ turns; the cached prefix
  // it re-reads (cache_read) is rung 1's business; the brief's snowball cap rides beside it as the DECLARED ceiling, never the reading
  let r3 = null, why3 = null, cause3 = null, newPerCall = null, cachedPerCall = null;
  if (t.route !== 'runner' && t.route !== 'wrapper') why3 = 'not a prepared -p run (a chat tick) — rung 3 is read off prepared runs only';
  else if (!calls) why3 = 'the verdict row carries no turn count';
  else {
    const fresh = ((Number(t.input) || 0) + (Number(t.cache_create) || 0)) / calls; newPerCall = Math.round(fresh); cachedPerCall = Math.round((Number(t.cache_read) || 0) / calls);
    r3 = 1 - fresh / COUNTERFACTUAL_1M;   // the ratio on the exact quotient; the rounded figure is for the page
    if (r3 < line) cause3 = newPerCall > 100_000 ? 'prefix re-created as fresh — over 100,000 new tokens per call, the cache missed' : `brief unresolved — ${newPerCall.toLocaleString()} new tokens per call, over the 10,000 a resolved leaf carries`;
  }
  // C560a: a call whose own record carries a provider error status (5xx / overloaded / timeout) is a rung-3 break with its own
  // cause, read off the row (never inferred from a short or empty usage block); it wins over the token causes on that tick.
  // @guard tests/vna/c560a-upstream-outage-cause.test.mjs
  const upstream = t.upstream_status ?? upstreamStatusOf(t);
  if (upstream != null) { cause3 = UPSTREAM_CAUSE; why3 = null; }
  const declared = Number(t.snowball_cap) > 0 ? Number(t.snowball_cap) : null;
  return { rung1: { savings: r1, crossed: r1 != null && r1 >= rung1Line, line: rung1Line, why: r1 == null ? 'no calls' : null }, rung2: { savings: r2, crossed: r2 != null && r2 >= line, cause: cause2, why: r2 == null ? 'no steering ledger for this tick' : null }, rung3: { savings: r3, crossed: upstream == null && r3 != null && r3 >= line, cause: cause3, why: why3, upstream_status: upstream, new_per_call: newPerCall, cache_read_per_call: cachedPerCall, declared_ceiling: declared } };
}
/** the health reading over ticks: per rung the crossing rate over the measured ticks, and every flagged tick with its cause */
export function healthOf(ticks) {
  const rate = (id) => { const m = ticks.filter((t) => t.rungs && (t.rungs[id].savings != null || t.rungs[id].upstream_status != null)); const c = m.filter((t) => t.rungs[id].crossed); const top = topShareLevel(m.map((t) => t.rungs[id].savings).filter((v) => v != null)); return { n: m.length, crossed: c.length, rate: m.length ? c.length / m.length : null, top20: top, top20_note: topShareNote(top) }; };
  const flagged = []; for (const t of ticks) for (const id of ['rung2', 'rung3']) if (t.rungs && t.rungs[id].cause) flagged.push({ sha: t.sha, day: t.day, route: t.route, rung: id, savings: t.rungs[id].savings, cause: t.rungs[id].cause });
  return { rung1: rate('rung1'), rung2: rate('rung2'), rung3: rate('rung3'), flagged, breaks: breaksOf({ rung2: rate('rung2'), rung3: rate('rung3') }), ranked_causes: rankedCauses(flagged) };
}
// C534 EVERY BREAK BELOW 99 % IS COUNTED WITH ITS CAUSE (chair decomposition 2026-10-01 of the operator's words, not on the tape:
// "Count the times a call breaks below 99 % on each rung, and list every break with its cause, ranked by how often each cause
// occurs, so the page answers what actually happened on each break; the promise is that every break is detected, placed, priced
// and dispatched, never that a break cannot happen."). `flagged` already holds every break (never truncated — the page's `.slice(-8)`
// is a display choice, not a measurement one); this is the count (n − crossed, per rung, on the measured population only — an
// UNMEASURED tick is neither a break nor a pass) and the frequency ranking over the (rung, cause) pairs it actually produced.
// @guard tests/vna/c534-every-break-below-99-is-counted-with-its-cause.test.mjs
function breaksOf({ rung2, rung3 }) { return { rung2: rung2.n - rung2.crossed, rung3: rung3.n - rung3.crossed, total: (rung2.n - rung2.crossed) + (rung3.n - rung3.crossed) }; }
/** every (rung, cause) pair in `flagged`, counted and sorted most-frequent first — ties broken by rung then cause so the order is stable */
export function rankedCauses(flagged) {
  const n = new Map(); for (const f of flagged || []) { const k = `${f.rung}\u0000${f.cause}`; n.set(k, (n.get(k) || 0) + 1); }
  return [...n.entries()].map(([k, count]) => { const [rung, cause] = k.split('\u0000'); return { rung, cause, count }; }).sort((a, b) => b.count - a.count || a.rung.localeCompare(b.rung) || a.cause.localeCompare(b.cause));
}

// ── C519b A SPARSE CHART IS NEVER A BLANK BOX (operator 2026-10-01, verbatim: "they look empty.." about a severity chart with one
// purple dot on the 100 line and a 50/90/100 axis that wastes the whole box) — the record can genuinely hold one point (a backup
// taken early, a rung with one prepared run on it); the chart must SAY SO, and the axis must not spend its height on a range
// (0–90) nothing in the series ever visits. Pure; the SAME two functions back every renderer (steer-ab-svg.mjs, the stats-page
// block, and the two inline SVGs on /backup/adherence) — a rule stated once lives in one place.
export const SPARSE_N = 3;   // at or under this many measured points, the chart prints the count in words, never a bare box
/** the y-axis for a severity/savings chart: lo is the lowest tenth AT OR BELOW every measured value (never above 0.9, never
 *  below 0), so a series sitting at 0.99–1.00 draws across the box instead of pinned to its top edge; hi is always 1 (the
 *  savings/ladder ratios are bounded above by the formula). Three grid lines: lo, the midpoint, 1 — same shape as the old
 *  fixed grid so a point-dense series still reads as [0.5, 0.9, 1] when it actually ranges that low. */
export function chartYAxis(values) {
  const vs = (values || []).filter(Number.isFinite);
  const lo = vs.length ? Math.max(0, Math.min(0.9, Math.floor(Math.min(...vs) * 10) / 10)) : 0;
  return { lo, hi: 1, grid: [lo, lo + (1 - lo) / 2, 1] };
}
// ── C526 THE SAVINGS CHARTS READ IN NINES (operator 2026-10-01, verbatim: "It breaks 99%. I guess that means that you would make it
// a lot of risk scale or something around 99% were above 99% is makes more sense"). chartYAxis above is linear, so 97.8 %, 99.5 % and
// 99.99 % land within a few pixels of the 99 % line and the chart reads as an empty box. ninesYAxis is THE axis every savings/ladder
// chart draws on (TokenSavings and WrapperLadder on /backup/adherence, renderTicksSvg in steer-ab-svg.mjs): the log-odds of the miss,
// y ∝ −log10(1 − v), from 0 % savings (0 nines) at the floor to the stated ceiling (default 99.99 %, 4 nines) at the top, so 90 · 99 ·
// 99.9 · 99.99 are evenly spaced and 99 % sits mid-axis. A value at or past the ceiling draws AT the ceiling (clamped → 'ceiling', its
// exact figure through exact()); a value at or under 0 draws at the floor. chartYAxis stays exported for its C519b readers only.
export const NINES_CEILING = 0.9999;
export const NINES_GRID = Object.freeze([0.9, 0.99, 0.999, 0.9999]);
/** the nines of a ratio: −log10(1 − v); Infinity at or above 1 */
export const ninesOf = (v) => (v >= 1 ? Infinity : -Math.log10(1 - v));
/** @param {number[]} values the measured points (counted for at_ceiling / below_floor) · @param {{ceiling?: number}} o
 *  @returns {{ scale: 'nines', lo: 0, hi: number, ceiling: number, grid: number[], frac: (v:number)=>number, clamped: (v:number)=>'ceiling'|'floor'|null, label: (v:number)=>string, exact: (v:number)=>string, at_ceiling: number, below_floor: number }}
 *  frac(v) is the 0..1 height of v in the plot (0 = floor, 1 = ceiling); a renderer's Y is PT + plotH × (1 − frac(v)). */
export function ninesYAxis(values = [], { ceiling = NINES_CEILING } = {}) {
  const c = Number.isFinite(ceiling) && ceiling > 0 && ceiling < 1 ? ceiling : NINES_CEILING; const top = ninesOf(c);
  const clamped = (v) => (!Number.isFinite(v) ? null : v >= c ? 'ceiling' : v <= 0 ? 'floor' : null);
  const frac = (v) => { const k = clamped(v); if (k === 'ceiling') return 1; if (k === 'floor' || !Number.isFinite(v)) return 0; return ninesOf(v) / top; };
  const label = (v) => String(Number((v * 100).toFixed(6)));
  const exact = (v) => (!Number.isFinite(v) ? '—' : v >= 1 ? '100 %' : `${Number((v * 100).toFixed(v > 0 ? Math.min(10, Math.max(1, Math.ceil(ninesOf(v)))) : 1))} %`);
  const vs = (values || []).filter(Number.isFinite);
  const span = headroomSpan(vs.map(frac));   // C562b: the plot top, computed from the data — the highest point never sits on the frame
  return { scale: 'nines', lo: 0, hi: c, ceiling: c, grid: NINES_GRID.filter((g) => g <= c + 1e-12), frac, clamped, label, exact, at_ceiling: vs.filter((v) => v >= c).length, below_floor: vs.filter((v) => v <= 0).length, span };
}
// ── C562b THE LINE IS NAMED AND HAS HEADROOM (operator 2026-10-02, verbatim: "we dont have the graph optimised to 20% over the line (and
// tell us where that line is - and note when that line is over 99% which happens on rung 2-3)" · "we still need to change color of the
// line above 99% always - the line is just for sensibility"). Three rules, each ONE function every ladder renderer reads
// (renderTicksSvg in steer-ab-svg.mjs, renderLadderPanel in steer-ui.mjs, TokenSavings + WrapperLadder on /backup/adherence):
//   HEADROOM   ninesYAxis(values).span — the plot top in axis fractions, from the data: 1 while the highest point leaves HEADROOM of the
//              plot free above it, else highest ÷ (1 − HEADROOM), so a point at or past the 99.99 % ceiling draws BELOW the frame.
//              frac() is unchanged (C526: 99 % mid-axis); a renderer maps a fraction f to PT + plotH × (1 − f ÷ span)
//   TOP FIFTH  topFifthMark(values) — the level, the label printed AT the dashed line, and the badge "top fifth over 99 %" exactly when
//              the level is over 99 % (today rungs 2 and 3); a null level reads UNMEASURED with its reason, never a line at 0
//   COLOUR     aboveLine99(v) — the series colour trigger is the 99 % claim, ALWAYS (LINE_99 — never the chart's line argument, never
//              the top-fifth level, which is a reference for sense only)
// @guard tests/vna/c562b-the-line-is-named-and-has-headroom.test.mjs
export const HEADROOM = 0.12;   // the share of the plot height kept free above the highest plotted point
export function headroomSpan(fracs) {
  const top = Math.max(0, ...(fracs || []).filter(Number.isFinite));
  return top > 1 - HEADROOM ? top / (1 - HEADROOM) : 1;
}
export const aboveLine99 = (v) => Number.isFinite(v) && v >= LINE_99;
export const TOP_FIFTH_BADGE = 'top fifth over 99 %';
// C667 THE LABEL SET IS CHOSEN BY THE DATA (operator 2026-10-05, verbatim: "if all are above 99%, then one wording here is wrong too
// cannot be top one fifth over … that looks generated not templated var outputs"). A "top fifth" line only says something when some
// points fall short of the claim. So the reading picks its words: every measured point at or over the line → the dashed line sits at
// the LOWEST point, labelled "lowest: X", and the badge is the count "k of n over 99 %" (kind 'all-clear'); some short → the top-fifth
// level as before, its badge naming the count beside it; under 5 points and not all clear → UNMEASURED. Every word is a slot over
// the values handed in — k, n, the level — never typed. @guard tests/vna/c667-every-point-every-word-from-the-record.test.mjs
const pctWords = (x) => `${(x * 100).toFixed(x >= 0.99 ? 2 : 1)} %`;
export function topFifthMark(values, { line = LINE_99, unit = 'tick' } = {}) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  const n = v.length, k = v.filter((x) => x >= line).length;
  const lineWords = pctWords(line).replace('.00 %', ' %');
  if (n && k === n) {
    const lowest = Math.min(...v);
    return { level: lowest, kind: 'all-clear', k, n, label: `lowest: ${pctWords(lowest)}`, over99: true, badge: `${k} of ${n} over ${lineWords}`, note: `all ${n} ${unit}${n === 1 ? '' : 's'} clear the ${lineWords} claim — the lowest reaches ${pctWords(lowest)}` };
  }
  const level = topShareLevel(v);
  if (level == null) return { level: null, kind: 'unmeasured', k, n, label: null, over99: false, badge: null, note: topShareNote(null, line) };
  const over99 = level > line;
  return { level, kind: 'top-fifth', k, n, label: `top 20 %: ${pctWords(level)}`, over99, badge: over99 ? `${TOP_FIFTH_BADGE} · ${k} of ${n} over` : null, note: `${topShareNote(level, line)} · ${k} of ${n} ${unit}s at or over ${lineWords}` };
}
// C526 amendments (operator 2026-10-01, verbatim: "They must be line charts braking the lines so you see efficiency per prompt or tick
// or whatever" · "Change color of the line abive the line as oayoff"). Every nines chart is a LINE through the measured points in time
// order, one point per tick or call; the line BREAKS at an UNMEASURED point (a gap, never interpolated — a missing reading is never
// drawn as a value). Each stretch is coloured by its side of the 99 % line: PAYOFF above, BASE below, split at the interpolated
// crossing so no stretch mixes both. The dots take their side's colour. Defined once here; all three renderers import them.
export const PAYOFF_COLOR = '#1f9f86';   // the repo's teal — the stretch of the line above 99 %
export const BASE_COLOR = '#a56bff';     // the repo's violet — the stretch below
/** @param {(number|null)[]} values one per tick/call in time order, null where UNMEASURED · @param {{axis?: object, line?: number}} o
 *  @returns {{ segments: [number, number][][], pieces: { side: 'above'|'below', color: string, points: [number, number][] }[], line_frac: number }}
 *  points are [x-index, yFraction]; x-index may be fractional at a 99 % crossing. segments split at nulls; pieces split segments at 99 %. */
export function ninesPolyline(values, { axis = null, line = LINE_99 } = {}) {
  const vals = (values || []).map((v) => (v == null || !Number.isFinite(v) ? null : v));
  const ax = axis || ninesYAxis(vals.filter((v) => v != null)); const f99 = ax.frac(line);
  const segments = []; let cur = null;
  vals.forEach((v, i) => { if (v == null) { cur = null; return; } if (!cur) { cur = []; segments.push(cur); } cur.push([i, ax.frac(v)]); });
  const sideOf = (f) => (f >= f99 ? 'above' : 'below');
  const pieces = [];
  for (const seg of segments) {
    let piece = { side: sideOf(seg[0][1]), points: [seg[0]] }; pieces.push(piece);
    for (let k = 1; k < seg.length; k++) {
      const [x0, f0] = seg[k - 1], [x1, f1] = seg[k]; const s1 = sideOf(f1);
      if (s1 !== piece.side) { const cross = [x0 + ((f99 - f0) / (f1 - f0)) * (x1 - x0), f99]; piece.points.push(cross); piece = { side: s1, points: [cross] }; pieces.push(piece); }
      piece.points.push([x1, f1]);
    }
  }
  return { segments, pieces: pieces.map((p) => ({ ...p, color: p.side === 'above' ? PAYOFF_COLOR : BASE_COLOR })), line_frac: f99 };
}
/** the words a sparse chart prints instead of staying silent: n is the measured count, total is every point on the chart
 *  (measured + UNMEASURED); unit names what is being counted ('tick', 'call', …). null when the chart has enough points to
 *  read as a series on its own (over SPARSE_N measured) — the caller prints nothing extra in that case. */
export function sparseChartNote(n, total, unit = 'tick', { why = null } = {}) {
  const plural = (x) => `${x} ${unit}${x === 1 ? '' : 's'}`;
  if (!(total > 0)) return null;
  if (n === 0) return `${plural(total)} on the record, none measured yet${why ? ` — UNMEASURED: ${why}` : ''}`;   // C527: the reason rides with the count
  if (n > SPARSE_N) return null;
  return `${plural(n)} measured so far — the chart fills as more land`;
}

// ── C521 THE SAME LADDER FOR THE DEPLOYED LLM WRAPPER (operator 2026-10-01: "this along with the panels both are extremely useful health
// measures for your deployment … one of the things to prove that you're doing it right"). One wrapper call (a C504/C517 tape row) becomes
// one tick-shaped row and goes through the SAME ladderOf — never a second copy: per call, the input the wrapper actually sent (the prompt
// in `action`, chars ÷ 4 — the tape carries no usage row), the spec context it carried (the receipt's intent_span.chars ÷ 4) and the
// corpus it stands in for (the receipt's attempts[0].mass, bytes ÷ 4, capped at 1M); rung 3 reads the call's own prompt: a wrapper call
// is a fully specified call. Accepts a raw tape row or the backup's projection (prompt_chars · spec_chars · corpus_bytes).
export const WRAPPER_SUFFICIENCY = 'token savings is evidence the deployment is configured and run as specified; it is NOT what the warranty covers and says nothing about whether an answer was right (Rice)';
const cardOfReceipt = (receipt) => { try { const c = JSON.parse(String(receipt).split('\n')[0]); return c && typeof c === 'object' ? c : null; } catch { return null; } };
export const promptCharsOf = (action) => { const s = String(action || ''); const i = s.indexOf('--- prompt\n'); if (i < 0) return null; const j = s.indexOf('\n--- completion', i); return (j < 0 ? s.length : j) - (i + '--- prompt\n'.length); };
export function wrapperCallOf(row, job) {
  if (!row || typeof row !== 'object') return null;
  const card = typeof row.receipt === 'string' ? cardOfReceipt(row.receipt) : null;
  const promptChars = Number.isFinite(Number(row.prompt_chars)) && row.prompt_chars != null ? Number(row.prompt_chars) : promptCharsOf(row.action);
  if (promptChars == null) return null;   // a robot row, or a row without a prompt — not an LLM call
  const specChars = row.spec_chars != null ? Number(row.spec_chars) || 0 : card && card.intent_span ? Number(card.intent_span.chars) || 0 : 0;
  const corpusBytes = row.corpus_bytes != null ? Number(row.corpus_bytes) || 0 : card && Array.isArray(card.attempts) && card.attempts[0] ? Number(card.attempts[0].mass) || 0 : 0;
  const j = row.job && typeof row.job === 'object' ? row.job : {}; const jobName = typeof job === 'string' ? job : typeof row.job === 'string' ? row.job : j.name || 'wrapper';
  const actual = Math.round(promptChars / CHARS_PER_TOKEN_RULER); const ours = Math.round(specChars / CHARS_PER_TOKEN_RULER); const th = theirsPerCall({ bytes: corpusBytes });
  const steering = { ours, calls: 1, resets_in_span: 0, theirs_per_call: th.theirs, raw_per_call: th.raw, capped: th.capped, next_is_reset: false, source: 'the receipt\'s intent_span (the spec context the wrapper carried)' };
  steering.savings = steeringSavings(steering); steering.crossed = steering.savings != null && steering.savings >= LINE_99;
  const cost = Number.isFinite(Number(j.cost_usd ?? row.cost_usd)) && (j.cost_usd ?? row.cost_usd) != null ? { usd: Number(j.cost_usd ?? row.cost_usd), source: j.cost_source || row.cost_source || 'unknown', exact: (j.cost_source || row.cost_source) === 'api' } : null;
  const ts = typeof row.ts === 'string' ? row.ts : null;
  const rc = typeof row.commit === 'string' ? row.commit : typeof j.commit === 'string' ? j.commit : null; const commit = rc && /^[0-9a-f]{7,40}$/i.test(rc) ? rc.toLowerCase().slice(0, 10) : null;   // C521: the panel's key
  return { sha: `${jobName}#${row.seq ?? '?'}`, seq: row.seq ?? null, job: jobName, commit, model: j.model || row.model || null, label: 'WRAPPER', route: 'wrapper', day: ts ? dayOf(ts) : null, closed_at: ts, calls: 1, calls_source: 'one call per row', actual, weighted: actual, input: actual, cache_create: 0, cache_read: 0, output: 0, measured: true, above_99: false, cost, steering, snowball_cap: actual, upstream_status: upstreamStatusOf(row) ?? upstreamStatusOf(j) };
}
// C527: the one reason an all-UNMEASURED chart prints in its box — the most common why among its points (ties: first seen), never a
// silent frame; and WHEN the backup a chart is drawn from was taken (the receipt's received_at, else the newest row's ts), so a stale
// upload reads as stale in the box itself. @guard tests/vna/c527-an-empty-deployed-chart-says-why.test.mjs
export function commonWhy(whys) {
  const n = new Map(); for (const w of whys || []) if (w) n.set(w, (n.get(w) || 0) + 1);
  let best = null, k = 0; for (const [w, c] of n) if (c > k) { best = w; k = c; } return best;
}
const tsOf = (r) => (r && typeof r === 'object' ? (typeof r.ts === 'string' ? r.ts : typeof r.closed_at === 'string' ? r.closed_at : null) : null);
export function backupTakenAt({ receipt = null, rows = [] } = {}) {
  const at = receipt && typeof receipt.received_at === 'string' ? receipt.received_at : (rows || []).map(tsOf).filter((t) => t && Number.isFinite(Date.parse(t))).sort((x, y) => Date.parse(x) - Date.parse(y)).pop() || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { at, source: receipt && receipt.received_at === at ? 'upload' : 'newest row', label: `${new Date(Date.parse(at)).toISOString().slice(0, 16).replace('T', ' ')} UTC` };
}
export const NO_CORPUS_MASS_WHY = 'no corpus mass on the call\'s receipt (attempts[0].mass) — nothing to stand the spec context against';
/** the ladder over a wrapper tape (raw rows or the backup's projection): per call the three rungs, the health, the flagged calls, per-day counts */
export function wrapperLadder(rows, { job = null } = {}) {
  const calls = (rows || []).map((r) => wrapperCallOf(r, job || (r && typeof r.job === 'string' ? r.job : null))).filter(Boolean).map((c) => { const rungs = ladderOf(c, { rung1Line: LINE_99 }); if (rungs.rung2.savings === null && !(c.steering.theirs_per_call > 0)) rungs.rung2 = { ...rungs.rung2, why: NO_CORPUS_MASS_WHY }; return { ...c, rungs }; });   // C527: a wrapper call never borrows the chat-tick reason
  const health = healthOf(calls); health.flagged = health.flagged.map((f) => { const c = calls.find((x) => x.sha === f.sha); return { ...f, seq: c ? c.seq : null, job: c ? c.job : null }; });
  return { line: LINE_99, rungs: WRAPPER_LADDER, calls, health, per_day: perPeriod(calls, (c) => c.day), sufficiency: WRAPPER_SUFFICIENCY, formula_note: 'per call: input = the prompt the wrapper sent (chars ÷ 4 — the tape carries no usage row); the spec context = the receipt\'s intent_span; the corpus = the receipt\'s attempts[0].mass, capped at 1M; rung 3 reads the call itself as the prepared run' };
}
