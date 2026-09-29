#!/usr/bin/env node
// scripts/vna/theme-decay.mjs — C322c: THE DECAY LINE, DERIVED, LLM-FREE.
//
// A new theme is a moved setpoint: the panel's jump to red when it is declared is the step response, expected and
// welcome. The question is never "is it red" but "does the red DECAY after the theme is declared". One line per
// theme:   <row> · red <x> % at t0 → <y> % now over <n> commits · decaying | flat | rising
//
// WHAT IT READS — the panel records only, never prose:
//   · red  = offPct on data/pmu/measure-history(.ndjson + both archives) — the tolerance panel's r/(g+a+r), the
//            same number the triptych prints (a17e79bb00: 877r of 1346 = 65). The LATEST row per sha wins: a
//            re-render supersedes an earlier scoring of the same commit.
//   · theme = the parent spec row a commit names in its subject (C322b → C322). The DECLARATION (t0) is the first
//            setpoint commit (scripts/pmu/setpoint.mjs: spec files + derived ledgers only) naming the theme, else
//            the first commit naming it. The series is the WORK commits after t0 naming the theme — a setpoint step
//            moves the declaration and is not scored as drift (C322b).
// VERDICT: the least-squares change across the series (slope × (n − 1)) against BAND = 5 points: below −BAND
// decaying, above +BAND rising, else flat. Fewer than 2 panels is UNMEASURED, never 0.
//
// NOT SUFFICIENT FOR: whether the work was right (Rice). A flat theme can be a theme whose words are not in the
// spec (move the declaration) or work that left the theme (move the work) — C322d names both; this file only
// measures.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitClass } from '../pmu/setpoint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const BAND = 5;          // points of red; a move smaller than this across the series is flat
export const MIN_PANELS = 2;
export const HISTORY = ['data/pmu/measure-history-archive.ndjson', 'data/pmu/measure-history.archive.ndjson', 'data/pmu/measure-history.ndjson'];

// C322b → C322 · C106c → C106 · C93n → C93. Every row id in a subject, parents deduped, in order of appearance.
export function themesOf(subject) {
  const out = [];
  for (const m of String(subject || '').matchAll(/\bC(\d{1,4})[a-z]?\d?\b/g)) { const t = `C${m[1]}`; if (!out.includes(t)) out.push(t); }
  return out;
}

// sha → red (offPct), latest row per sha. Keys are the ledger's short shas.
export function panelReds(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || !r.sha || r.offPct == null || !Number.isFinite(Number(r.offPct))) continue;
    const prev = m.get(r.sha);
    if (!prev || String(r.ts || '') >= prev.ts) m.set(r.sha, { red: Number(r.offPct), ts: String(r.ts || '') });
  }
  return m;
}
const redFor = (reds, sha) => { for (const [k, v] of reds) if (sha.startsWith(k) || k.startsWith(sha)) return v.red; return null; };

// least-squares change across the series, in points
export function totalChange(ys) {
  const n = ys.length; if (n < 2) return null;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return (num / den) * (n - 1);
}
export const verdictOf = (ch) => ch == null ? 'UNMEASURED' : ch < -BAND ? 'decaying' : ch > BAND ? 'rising' : 'flat';

// commits: oldest → newest, [{ sha, subject, files }]. reds: panelReds(). Returns one record per theme.
export function themeDecay(commits, reds) {
  const byTheme = new Map();
  (commits || []).forEach((c, i) => {
    for (const t of themesOf(c.subject)) { if (!byTheme.has(t)) byTheme.set(t, []); byTheme.get(t).push({ ...c, i }); }
  });
  const out = [];
  for (const [theme, cs] of byTheme) {
    const decl = cs.find((c) => commitClass(c.files) === 'setpoint') || cs[0];
    const series = cs.filter((c) => c.i > decl.i && commitClass(c.files) === 'work')
      .map((c) => ({ sha: c.sha, red: redFor(reds, c.sha) })).filter((p) => p.red != null);
    const ch = series.length >= MIN_PANELS ? totalChange(series.map((p) => p.red)) : null;
    out.push({
      theme, t0: decl.sha, n: series.length,
      redT0: series.length ? series[0].red : null, redNow: series.length ? series[series.length - 1].red : null,
      change: ch == null ? null : +ch.toFixed(1), verdict: series.length < MIN_PANELS ? 'UNMEASURED' : verdictOf(ch),
    });
  }
  return out;
}

export function lineOf(r) {
  if (r.verdict === 'UNMEASURED') return `${r.theme} · UNMEASURED — ${r.n} panel${r.n === 1 ? '' : 's'} after t0 ${String(r.t0).slice(0, 10)} (need ${MIN_PANELS})`;
  return `${r.theme} · red ${r.redT0} % at t0 → ${r.redNow} % now over ${r.n} commits · ${r.verdict}`;
}

// ── C322d: LIVENESS — A THEME THAT DOES NOT DECAY SURFACES, IT DOES NOT STOP ──────────────────────────────────────
// A theme still flat or rising once it has had K work commits after its declaration puts ONE computed line on the
// /steer close and in `steer.mjs status` (which the 💬 Steer chat context carries, chat-context.mjs). The line is
// the reading — both arms named, never a menu — and it is printed, never returned as a code: nothing waits on it.
// A decaying, young (< K) or UNMEASURED theme says nothing. Any prose story about it is a later LLM layer, never here.
export const K = 5;
export function surfaceLines(records, { k = K } = {}) {
  return (records || [])
    .filter((r) => (r.verdict === 'flat' || r.verdict === 'rising') && r.n >= k)
    .map((r) => `⟲ ${r.theme} is ${r.verdict} — red ${r.redT0} % → ${r.redNow} % over ${r.n} commits since its declaration (${String(r.t0).slice(0, 10)}): either the declaration moved (the theme's words are not in the spec) or the work moved (the work left the theme)`);
}
// never throws: a reader that cannot read surfaces nothing — the close is never held by its own instrument
// Cached on (HEAD, the history ledger's mtime, window): the chat calls `status` every turn, and the report is a pure
// function of those — a cache hit costs one rev-parse and a stat, a miss recomputes and rewrites (derived, gitignored).
export function decaySurface(opts = {}) {
  try {
    const repo = opts.repo || REPO, last = opts.last || 400;
    const head = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    const mt = HISTORY.map((f) => { try { return statSync(resolve(repo, f)).mtimeMs; } catch { return 0; } }).join(',');
    const key = `${head}|${mt}|${last}`, cp = resolve(repo, '.thetacog/cache/theme-decay.json');
    try { const c = JSON.parse(readFileSync(cp, 'utf8')); if (c.key === key) return surfaceLines(c.records, opts); } catch { /* miss */ }
    const records = decayReport({ repo, last });
    try { mkdirSync(dirname(cp), { recursive: true }); writeFileSync(cp, JSON.stringify({ key, at: new Date().toISOString(), records })); } catch { /* cache best-effort */ }
    return surfaceLines(records, opts);
  } catch { return []; }
}

// ── the readers (git + the ledger) ────────────────────────────────────────────────────────────────────────
export function readHistory(repo = REPO) {
  const rows = [];
  for (const f of HISTORY) {
    const p = resolve(repo, f); if (!existsSync(p)) continue;
    for (const l of readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; try { rows.push(JSON.parse(l)); } catch { /* skip */ } }
  }
  return rows;
}
export function readCommits({ repo = REPO, last = 400 } = {}) {
  const raw = execSync(`git log -n ${Number(last) || 400} --format=%x01%H%x09%s --name-only`, { cwd: repo, encoding: 'utf8', maxBuffer: 1e8 });
  const out = [];
  for (const block of raw.split('\x01').slice(1)) {
    const [head, ...rest] = block.split('\n');
    const [sha, ...s] = head.split('\t');
    out.push({ sha, subject: s.join('\t'), files: rest.map((x) => x.trim()).filter(Boolean) });
  }
  return out.reverse();   // oldest → newest
}
export function decayReport({ repo = REPO, last = 400 } = {}) {
  return themeDecay(readCommits({ repo, last }), panelReds(readHistory(repo)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const last = Number((a[a.indexOf('--last') + 1]) || 400) || 400;
  const recs = decayReport({ last: a.includes('--last') ? last : 400 });
  const only = a.includes('--theme') ? a[a.indexOf('--theme') + 1] : null;
  const rows = recs.filter((r) => !only || r.theme === only);
  if (a.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else if (a.includes('--surface')) for (const l of surfaceLines(rows)) console.log(l);
  else for (const r of rows.filter((r) => a.includes('--all') || r.verdict !== 'UNMEASURED')) console.log(lineOf(r));
}
