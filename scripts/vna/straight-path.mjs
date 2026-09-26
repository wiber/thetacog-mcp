#!/usr/bin/env node
// C96 — THE STATUS IS READ, NEVER TYPED. §26 THE STRAIGHT PATH of docs/specs/vna/SPEC-VNA-COCKPIT.md types a mark beside each
// of its five numbered steps — BUILT · DECLARED · HIS CLICK. This door derives the same five marks from the RECORD and prints
// them beside the typed ones, so a mark that aged is a named disagreement, never a quiet lie:
//
//   BUILT      = every row the step names is ticked AND its guard (C92a: specGuards → runGuard, node --test) is green
//   DECLARED   = a row the step names is open (an unticked checkbox)
//   HIS CLICK  = a row the step names says so in its own text (HIS_CLICK_RE: "his click" · "armed by him" · "he arms")
//   UNMEASURED = ticked, but the guard is red, unrun, or not on disk — a tick without a green guard is not BUILT
//
// plus the count from the entitlement ledger (C84c credits-ledger: purchase rows are licences bought; 0 prints UNMEASURED
// with the count, never a bare zero), and one line for the sidebar:
//
//   straight path: <built>/5 · next: <row>        (next = the first DECLARED step in path order; then his click; then none)
//
//   node scripts/vna/straight-path.mjs [--json] [--no-guards] [--check]
//     --no-guards  do not spawn node --test; a ticked row then reads UNMEASURED (never BUILT) with the reason
//     --check      exit 1 when a typed mark disagrees with the record, naming the step and the row
//
// Env: VNA_SPEC_MD (the spec), VNA_CREDITS_LEDGER (an ndjson credits ledger — the fileCreditsStore shape; prod's ledger is
// Supabase `credits_ledger` and is read when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set and VNA_CREDITS_LEDGER is not).
// Guard: tests/vna/c96-straight-path-status.test.mjs. Does not touch steer-ui.mjs — it may import straightPathLine.
import { readFileSync, existsSync } from 'node:fs';
import * as fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC_MD, runGuard, GUARD_ROOTS } from './flight-tape.mjs';
import { createCreditsLedger, fileCreditsStore, supabaseCreditsStore } from '../../src/lib/notary/credits-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
export const MARKS = Object.freeze(['BUILT', 'DECLARED', 'HIS CLICK', 'UNMEASURED']);
export const TARGET = 2000;   // §26: "2,000 licences bought through the extension"
export const SECTION_RE = /^## 26\. THE STRAIGHT PATH\b/m;
// the row's own text says the act is his — the construct is the sentence the spec writes, not a label
export const HIS_CLICK_RE = /\b(his click|armed by him|he arms)\b/i;
const ROW_RE = /^\s*-\s*\[([ xX])\]\s*(C\d{1,3}[a-z]?|T\d{1,3})\b(.*)$/;
const GUARD_RE = /\bguard[:s]?\s*`([^`]+)`/i;   // the same shape flight-tape.specGuards / spec-check.mjs read
const STEP_RE = /^(\d)\.\s+\*\*(.+?)\*\*\s+(BUILT|DECLARED|HIS CLICK|UNMEASURED)\b(.*)$/;
const LABEL_RE = /\bC\d{1,3}[a-z]?\b/g;

/** label → { ticked, guard, text } for every checklist row in the spec (rows only; prose naming a label is not a row) */
export function specRows(md) {
  const out = new Map();
  for (const line of String(md || '').split('\n')) {
    const m = ROW_RE.exec(line); if (!m || out.has(m[2])) continue;
    const g = GUARD_RE.exec(m[3]);
    out.set(m[2], { label: m[2], ticked: m[1] !== ' ', guard: g ? g[1].trim() : null, text: m[3].trim() });
  }
  return out;
}

/** the §26 section's text, up to the next `## ` heading */
export function straightPathSection(md) {
  const s = String(md || ''); const m = SECTION_RE.exec(s); if (!m) return null;
  const rest = s.slice(m.index); const next = rest.slice(m[0].length).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, m[0].length + next);
}

/** §26's numbered steps: { n, title, labels, typed, rest } — labels are the C-rows the bold title names, or the body's when the title names none ("The key") */
export function parseStraightPath(md) {
  const sec = straightPathSection(md); if (!sec) return [];
  const steps = [];
  for (const line of sec.split('\n')) {
    const m = STEP_RE.exec(line); if (!m) continue;
    const title = m[2].replace(/\.$/, '').trim();
    const inTitle = [...new Set(title.match(LABEL_RE) || [])];
    const labels = inTitle.length ? inTitle : [...new Set(String(m[4]).match(LABEL_RE) || [])];
    steps.push({ n: Number(m[1]), title, labels, typed: m[3], rest: m[4].trim(), line: line.trim() });
  }
  return steps;
}

const underRoots = (g) => GUARD_ROOTS.some((r) => String(g).startsWith(r + '/'));
/**
 * the record's mark for each step. `run(guard, cwd)` and `exists(guard)` are injectable (the guard's fixture); a guard the
 * spec names twice runs once. `run: null` never spawns — ticked rows read UNMEASURED with the reason.
 */
export function markSteps(steps, rows, { run = runGuard, exists = (g) => existsSync(resolve(REPO, g)), repo = REPO, timeoutMs } = {}) {
  const cache = new Map();
  const result = (guard) => {
    if (!cache.has(guard)) {
      if (!underRoots(guard)) cache.set(guard, { status: 'unrun', ms: null, why: `the guard is outside ${GUARD_ROOTS.join(' · ')}` });
      else if (!exists(guard)) cache.set(guard, { status: 'unrun', ms: null, why: 'the guard file is not on disk' });
      else if (!run) cache.set(guard, { status: 'unrun', ms: null, why: 'guards not run (--no-guards)' });
      else cache.set(guard, run(guard, repo, { timeoutMs }));
    }
    return cache.get(guard);
  };
  return steps.map((s) => {
    const named = s.labels.map((l) => rows.get(l) || null);
    const missing = s.labels.filter((l, i) => !named[i]);
    if (missing.length) return { ...s, record: 'UNMEASURED', why: `no spec row for ${missing.join(', ')}`, guards: [] };
    const his = named.filter((r) => HIS_CLICK_RE.test(r.text)).map((r) => r.label);
    if (his.length) return { ...s, record: 'HIS CLICK', why: `${his.join(', ')} says so`, guards: [] };
    const open = named.filter((r) => !r.ticked).map((r) => r.label);
    if (open.length) return { ...s, record: 'DECLARED', why: `${open.join(', ')} open`, guards: [] };
    const guards = named.map((r) => (r.guard ? { label: r.label, guard: r.guard, ...result(r.guard) } : { label: r.label, guard: null, status: 'unrun', ms: null, why: 'the row names no guard' }));
    const notGreen = guards.filter((g) => g.status !== 'pass');
    if (notGreen.length) return { ...s, record: 'UNMEASURED', why: notGreen.map((g) => `${g.label} guard ${g.status}${g.why ? ' — ' + g.why : ''}`).join('; '), guards };
    return { ...s, record: 'BUILT', why: `${guards.map((g) => `${g.label} ${g.ms} ms`).join(', ')}`, guards };
  });
}

/** typed ≠ record, each named by step and row */
export function disagreements(steps) {
  return steps.filter((s) => s.typed !== s.record).map((s) => ({
    n: s.n, labels: s.labels, typed: s.typed, record: s.record, why: s.why,
    line: `step ${s.n} (${s.labels.join(', ') || s.title}): typed ${s.typed} · record ${s.record}${s.why ? ' — ' + s.why : ''}`,
  }));
}

const fmt = (n) => Number(n).toLocaleString('en-US');
export function nextStep(steps) {
  return steps.find((s) => s.record === 'DECLARED' || s.record === 'UNMEASURED') || steps.find((s) => s.record === 'HIS CLICK') || null;
}
/** the sidebar line: straight path: <built>/5 · next: <row> */
export function straightPathLine(steps) {
  const built = steps.filter((s) => s.record === 'BUILT').length;
  const nx = nextStep(steps);
  const next = !nx ? `none — ${fmt(TARGET)} licences is the result` : `${nx.labels[0] || nx.title}${nx.record === 'HIS CLICK' ? ' (his click)' : ''}`;
  return `straight path: ${built}/${steps.length || 5} · next: ${next}`;
}

// ── the count, off the entitlement ledger (C84c) — a purchase row is a licence bought ────────────────────────────────────
async function openLedger({ file = process.env.VNA_CREDITS_LEDGER || null, supabase = null } = {}) {
  if (file) return { ledger: createCreditsLedger(fileCreditsStore(file, fs)), source: `file ${file}` };
  const url = supabase?.url ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = supabase?.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try { const { createClient } = await import('@supabase/supabase-js'); return { ledger: createCreditsLedger(supabaseCreditsStore(createClient(url, key))), source: 'supabase credits_ledger' }; }
    catch (e) { return { ledger: null, source: `supabase unreachable — ${e.message}` }; }
  }
  return { ledger: null, source: 'no ledger reachable — set VNA_CREDITS_LEDGER=<ndjson> or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY' };
}
export async function licenceCount(opts = {}) {
  const { ledger, source } = await openLedger(opts);
  let rows = [];
  if (ledger) { try { rows = await ledger.rows(null); } catch (e) { return { status: 'UNMEASURED', purchases: 0, credits: 0, first: null, source: `${source} — ${e.message}`, line: `licences: UNMEASURED — 0 purchase rows read (${source} — ${e.message})` }; } }
  const buys = rows.filter((r) => Number(r.delta) > 0 && (r.kind || 'purchase') === 'purchase').sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const credits = buys.reduce((s, r) => s + Number(r.delta || 0), 0);
  const first = buys.length ? buys[0].at : null;
  // C317a: a buy whose key is one of ours is a rehearsal, not a sale. `own` is a set of 16-hex fingerprints; absent → foreign is null (unread).
  const own = opts.own ? new Set(opts.own) : null;
  const foreign = own ? buys.filter((r) => !own.has(String(r.pubkey_fingerprint || ''))).length : null;
  if (!buys.length) return { status: 'UNMEASURED', purchases: 0, foreign: own ? 0 : null, credits: 0, first: null, source, line: `licences: UNMEASURED — 0 purchase rows on the ledger (${source}) · the result is ${fmt(TARGET)}` };
  return { status: 'MEASURED', purchases: buys.length, foreign, credits, first, source, line: `licences: ${buys.length} of ${fmt(TARGET)} bought · ${credits} credits · first ${String(first).slice(0, 10)}` };
}

/** the whole reading: steps with record marks, the line, the count, the disagreements */
export async function straightPathStatus({ md = null, spec = SPEC_MD, run, exists, ledger = {}, timeoutMs } = {}) {
  const text = md != null ? md : readFileSync(spec, 'utf8');
  const steps = markSteps(parseStraightPath(text), specRows(text), { ...(run !== undefined ? { run } : {}), ...(exists ? { exists } : {}), timeoutMs });
  const count = await licenceCount(ledger);
  return { steps, built: steps.filter((s) => s.record === 'BUILT').length, line: straightPathLine(steps), count, disagreements: disagreements(steps) };
}

export function renderStraightPath(st) {
  const out = [st.line, st.count.line];
  for (const s of st.steps) out.push(`${s.n}. ${s.title} · ${s.record}${s.typed !== s.record ? ` (typed ${s.typed} — DISAGREES)` : ''}${s.why ? ' — ' + s.why : ''}`);
  if (st.disagreements.length) { out.push(''); out.push('DISAGREES WITH THE RECORD — correct the typed mark:'); for (const d of st.disagreements) out.push('  ' + d.line); }
  return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const st = await straightPathStatus({ ...(a.includes('--no-guards') ? { run: null } : {}) });
  if (a.includes('--json')) process.stdout.write(JSON.stringify(st) + '\n');
  else process.stdout.write(renderStraightPath(st) + '\n');
  if (a.includes('--check') && st.disagreements.length) process.exitCode = 1;
}
