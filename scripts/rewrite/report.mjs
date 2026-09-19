#!/usr/bin/env node
// scripts/rewrite/report.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE COMPOUNDING REPORT — the A/B result, accumulating in git.
//
// A single run's numbers are noise. The question this tool exists to answer —
// does lattice guidance produce prose a human prefers? — only resolves across
// days and hundreds of decisions. So this rolls the append-only ledger up by DAY
// and commits the result, which makes the report itself a time series: `git log`
// on the report file is the evolution of the experiment.
//
// Every number here is derived from `.thetacog/cache/rewrite/ledger.ndjson` plus
// the live session files. Nothing is estimated, nothing is carried forward by
// hand — regenerate it any time and it reproduces.
//
//   node scripts/rewrite/report.mjs [--days 14] [--commit] [--json] [--email]
//
// `--commit` writes and commits `docs/reports/rewrite/ab-report.md`. Without it,
// the report is printed and written but not committed.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLedger, winRates, listSessions, CACHE_DIR } from './store.mjs';
import { ledgerReadability, readabilityDelta } from './readability.mjs';
import { slopDelta } from './slop.mjs';
import { TRACKS, TRACK_BY_ID } from './tracks.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const DAYS = parseInt(arg('--days', '14'), 10);
const OUT = path.join(REPO, 'docs/reports/rewrite/ab-report.md');

const rows = readLedger({ limit: 200000 });
const dayOf = (ts) => String(ts || '').slice(0, 10);
const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const recent = rows.filter((r) => dayOf(r.ts) >= cutoff);

// ── per-day rollup ─────────────────────────────────────────────────────────
const days = new Map();
function day(d) {
  if (!days.has(d)) {
    days.set(d, {
      date: d, accepted: 0, skipped: 0, goodEnough: 0, manual: 0, keptOriginal: 0,
      byTrack: {}, easeSum: 0, easeN: 0, slopSum: 0, slopN: 0, files: new Set(),
    });
  }
  return days.get(d);
}

for (const r of recent) {
  const d = day(dayOf(r.ts));
  if (r.file) d.files.add(r.file);

  if (r.kind === 'good-enough') { d.goodEnough++; continue; }
  if (r.kind === 'skip') { d.skipped++; continue; }
  if (r.kind !== 'accept') continue;

  d.accepted++;
  if (r.winner === 'MANUAL') d.manual++;
  else if (r.winner === 'ORIGINAL') d.keptOriginal++;
  else if (r.winner) d.byTrack[r.winner] = (d.byTrack[r.winner] || 0) + 1;

  if (r.original && r.chosen && r.winner !== 'ORIGINAL') {
    const rd = readabilityDelta(r.original, r.chosen);
    if (rd.easeDelta != null) { d.easeSum += rd.easeDelta; d.easeN++; }
    const sd = slopDelta(r.original, r.chosen);
    d.slopSum += sd.delta; d.slopN++;
  }
}

const series = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
for (const d of series) {
  d.avgEase = d.easeN ? +(d.easeSum / d.easeN).toFixed(2) : null;
  d.avgSlop = d.slopN ? +(d.slopSum / d.slopN).toFixed(2) : null;
  d.fileCount = d.files.size;
}

// ── all-time ───────────────────────────────────────────────────────────────
const wr = winRates({});
const rd = ledgerReadability(rows);

// ── MONOLOGUE PRECISION — is the flagging engine any good? ─────────────────
// The only number that grades the DIAGNOSIS. Without it the system is
// unfalsifiable: it would keep flagging confidently and nobody would ever learn
// it was wrong. Also split by defect class, because "undefined term" and
// "non-sequitur" are not equally easy for a reader model to spot.
const graded = rows.filter((r) => r.kind === 'accept' && r.monologueGrade);
const mono = { right: 0, partly: 0, wrong: 0, total: graded.length, byDefect: {} };
for (const r of graded) {
  const g = r.monologueGrade;
  if (mono[g] !== undefined) mono[g]++;
  const d = r.defect || 'unknown';
  mono.byDefect[d] = mono.byDefect[d] || { right: 0, partly: 0, wrong: 0, n: 0 };
  mono.byDefect[d].n++;
  if (mono.byDefect[d][g] !== undefined) mono.byDefect[d][g]++;
}
mono.precision = mono.total ? +((mono.right + mono.partly * 0.5) / mono.total * 100).toFixed(1) : null;
for (const d of Object.values(mono.byDefect)) {
  d.precision = d.n ? +((d.right + d.partly * 0.5) / d.n * 100).toFixed(1) : null;
}

// ── WIN RATE PER DEFECT CLASS — where does the fence actually help? ────────
// The most actionable cut for developing the lattice: guidance may help on
// undefined terms and do nothing for pacing, and an aggregate hides that.
const byDefect = {};
for (const r of rows) {
  if (r.kind !== 'accept' || !r.winner) continue;
  const d = r.defect || 'unknown';
  byDefect[d] = byDefect[d] || { n: 0, guided: 0, raw: 0, manual: 0, original: 0 };
  byDefect[d].n++;
  if (r.winner === 'MANUAL') byDefect[d].manual++;
  else if (r.winner === 'ORIGINAL') byDefect[d].original++;
  else if (r.winner === 'B' || r.winner === 'D') byDefect[d].guided++;
  else byDefect[d].raw++;
}

// ── RE-SCAN AFTER EDIT — the only direct test of the product claim ────────
// Every other number is a proxy: readability approximates ease, slop approximates
// noise, displacement approximates meaning. This one re-reads the edited passage
// with the same reader and asks whether comprehension actually rose. If the tool
// works, `improvedPct` is high and `avgDelta` is positive. If it does not, this is
// where that shows up first, and it should be believed over the proxies.
const rescans = rows.filter((r) => r.kind === 'rescan');
const rescan = {
  n: rescans.length,
  improved: rescans.filter((r) => r.improved).length,
  worse: rescans.filter((r) => r.delta < 0).length,
  avgDelta: rescans.length ? +(rescans.reduce((a, r) => a + (r.delta || 0), 0) / rescans.length).toFixed(1) : null,
  byTrack: {},
};
rescan.improvedPct = rescan.n ? +(rescan.improved / rescan.n * 100).toFixed(1) : null;
for (const r of rescans) {
  const t = r.winner || 'UNKNOWN';
  rescan.byTrack[t] = rescan.byTrack[t] || { n: 0, sum: 0, improved: 0 };
  rescan.byTrack[t].n++;
  rescan.byTrack[t].sum += r.delta || 0;
  if (r.improved) rescan.byTrack[t].improved++;
}
for (const t of Object.values(rescan.byTrack)) {
  t.avgDelta = t.n ? +(t.sum / t.n).toFixed(1) : null;
  t.improvedPct = t.n ? +(t.improved / t.n * 100).toFixed(1) : null;
}

// ── REAL READER DROPS — evidence, as opposed to simulation ────────────────
let drops = { files: 0, drops: 0, anchors: 0 };
try {
  const dropsDir = process.env.REWRITE_DROPS_DIR || path.join(REPO, '.thetacog', 'rewrite', 'monologues');
  for (const f of fs.readdirSync(dropsDir)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dropsDir, f), 'utf8'));
    drops.files++;
    drops.drops += (j.drops || []).length;
    drops.anchors += (j.drops || []).reduce((a, d) => a + (d.anchors?.length || 0), 0);
  }
} catch {}
const guided = (wr.tracks.B?.won || 0) + (wr.tracks.D?.won || 0);
const rawT = (wr.tracks.A?.won || 0) + (wr.tracks.C?.won || 0);
const goodEnoughTotal = rows.filter((r) => r.kind === 'good-enough').length;

// ── live latency, straight off the session files ───────────────────────────
const timing = {};
for (const s of listSessions()) {
  try {
    const sess = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `session-${s.slug}.json`), 'utf8'));
    for (const [id, t] of Object.entries(sess.timing || {})) {
      const agg = timing[id] || { runs: 0, ok: 0, timeouts: 0, totalMs: 0, produced: 0 };
      agg.runs += t.runs || 0; agg.ok += t.ok || 0; agg.timeouts += t.timeouts || 0;
      agg.totalMs += t.totalMs || 0; agg.produced += t.produced || 0;
      timing[id] = agg;
    }
  } catch {}
}
for (const t of Object.values(timing)) {
  t.avgMs = t.runs ? Math.round(t.totalMs / t.runs) : null;
  t.successPct = t.runs ? +(t.ok / t.runs * 100).toFixed(1) : null;
}

// ── render ─────────────────────────────────────────────────────────────────
const now = new Date().toISOString();
const bar = (n, max, w = 18) => '█'.repeat(Math.round((n / Math.max(1, max)) * w)).padEnd(w, '·');
const maxWon = Math.max(1, ...TRACKS.map((t) => wr.tracks[t.id]?.won || 0));

let md = `# Ghost-Read Matrix — A/B report

<sub>Generated ${now} · rolling ${DAYS} days · regenerate with \`node scripts/rewrite/report.mjs\`</sub>

**This file is committed on every run, so \`git log -p ${path.relative(REPO, OUT)}\` IS the
experiment's history.** Every number derives from the append-only ledger
(\`.thetacog/cache/rewrite/ledger.ndjson\`); nothing is carried forward by hand.

## The question

Does Tesseract-guided rewriting (tracks **B** and **D**) produce prose a human
actually accepts more often than raw model output (tracks **A** and **C**)?

**Current standing — guided ${guided} · raw ${rawT}** ${
  wr.totalDecisions < 30
    ? `\n\n> ⚠ **Not callable yet.** ${wr.totalDecisions} decisions recorded; this needs volume before the gap means anything. Reported as a running count, not a verdict.`
    : ''
}

## Win rate by track

| track | offered | won | win rate | avg ease Δ | avg latency | success |
|---|---|---|---|---|---|---|
`;

for (const t of TRACKS) {
  const w = wr.tracks[t.id];
  const rt = rd.byTrack?.[t.id];
  const ti = timing[t.id];
  md += `| **${t.id}** ${t.key} | ${w?.offered ?? 0} | ${w?.won ?? 0} \`${bar(w?.won ?? 0, maxWon)}\` | ${w?.winRate ?? '—'}% | ${rt?.avgEaseDelta ?? '—'} | ${ti?.avgMs != null ? (ti.avgMs / 1000).toFixed(1) + 's' : '—'} | ${ti?.successPct ?? '—'}% |\n`;
}

md += `| MANUAL | — | ${wr.manual} | — | — | — | — |
| kept ORIGINAL | — | ${wr.keptOriginal} | — | — | — | — |

<sub>**Latency is part of the result**, not overhead: a track that cannot answer in time
loses cards it might otherwise have won. Success% is runs that returned a usable
rewrite before timing out.</sub>

## Prose actually improved?

| metric | value |
|---|---|
| edits measured | ${rd.n ?? 0} |
| avg Flesch reading-ease Δ | **${rd.avgEaseDelta ?? '—'}** (higher = easier) |
| avg grade-level Δ | **${rd.avgGradeDelta ?? '—'}** (lower = easier) |
| edits that improved ease without bloat | **${rd.improvedPct ?? '—'}%** |
| paragraphs logged "good enough" | **${goodEnoughTotal}** |

<sub>"Good enough" is the control group: paragraphs the reader followed cleanly, logged
rather than silently skipped, so the edits have something to be measured against.</sub>

## Did comprehension actually rise? (re-scan after edit)

**The only direct test of the claim.** Every other number here is a proxy;
this one re-reads the edited passage with the same reader and compares. If the tool
works, most edits improve and the average delta is positive. If it does not, this is
where it shows first — and this should be believed over the proxies.

| | value |
|---|---|
| edits re-scanned | **${rescan.n}** |
| comprehension improved | ${rescan.improved} (**${rescan.improvedPct ?? '—'}%**) |
| got worse | ${rescan.worse} |
| **average score delta** | **${rescan.avgDelta ?? '—'}** |
${rescan.n === 0 ? '\n> Nothing re-scanned yet — it fires automatically on the next accepted edit.\n' : ''}
${Object.keys(rescan.byTrack).length ? `
| track | re-scans | improved | avg delta |
|---|---|---|---|
${Object.entries(rescan.byTrack).sort((a, b) => b[1].n - a[1].n).map(([t, v]) => `| ${t} | ${v.n} | ${v.improvedPct}% | ${v.avgDelta} |`).join('\n')}
` : ''}

## Is the flagging engine any good? (monologue precision)

The only number that grades the **diagnosis** rather than the rewrite. Without it
the system is unfalsifiable — it would keep flagging confidently and nobody would
ever learn it was wrong.

| | value |
|---|---|
| flags graded | **${mono.total}** |
| right | ${mono.right} |
| partly | ${mono.partly} |
| wrong (false flags) | ${mono.wrong} |
| **precision** (right + ½·partly) | **${mono.precision ?? '—'}%** |
${mono.total === 0 ? '\n> No monologues graded yet. Press `r` / `p` / `w` on a card — this is the loop that tells you whether the reader model is worth trusting.\n' : ''}
${Object.keys(mono.byDefect).length ? `
| defect class | graded | precision |
|---|---|---|
${Object.entries(mono.byDefect).map(([d, v]) => `| ${d} | ${v.n} | ${v.precision ?? '—'}% |`).join('\n')}
` : ''}

## Where does the fence help? (win rate per defect class)

The most actionable cut for developing the lattice — guidance may help on undefined
terms and do nothing for pacing, and an aggregate hides exactly that.

| defect | decisions | guided (B+D) | raw (A+C) | manual | kept original |
|---|---|---|---|---|---|
${Object.keys(byDefect).length
  ? Object.entries(byDefect).sort((a, b) => b[1].n - a[1].n)
      .map(([d, v]) => `| ${d} | ${v.n} | **${v.guided}** | ${v.raw} | ${v.manual} | ${v.original} |`).join('\n')
  : '| — | no decisions recorded yet | | | | |'}

## Real reader drops

Pasted human reactions, anchored to sentences by a subagent and queued **ahead of**
generated findings. A model's guess about where a human stumbles is a hypothesis; a
reader saying "I lost you here" is evidence.

| | value |
|---|---|
| documents with drops | ${drops.files} |
| drops recorded | **${drops.drops}** |
| sentences anchored | **${drops.anchors}** |

## Day by day

| date | accepted | skipped | good-enough | manual | avg ease Δ | avg slop Δ | tracks |
|---|---|---|---|---|---|---|---|
`;

for (const d of series.slice(-DAYS)) {
  const tk = Object.entries(d.byTrack).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '—';
  md += `| ${d.date} | ${d.accepted} | ${d.skipped} | ${d.goodEnough} | ${d.manual} | ${d.avgEase ?? '—'} | ${d.avgSlop ?? '—'} | ${tk} |\n`;
}

if (!series.length) md += `| — | no decisions recorded in the window | | | | | | |\n`;

md += `
## The standing caveat (do not delete)

Tesseract **drift** is reported as displacement magnitude, **not** quality, and is
weighted **zero** in every ranking here. Calibration
(\`node scripts/rewrite/calibrate.mjs\`) showed deliberate nonsense scoring at or
above a genuine rewrite in 2 of 4 sampled paragraphs, because \`MIN_GZIP_BYTES ≈ 220\`
and one sentence lacks the mass for a stable walk. The signals carrying weight are
the deterministic slop delta, the readability delta, and which card the writer
accepted.

## Sessions

| file | cards queued | accepted | last touched |
|---|---|---|---|
`;
for (const s of listSessions().slice(0, 12)) {
  md += `| \`${path.relative(REPO, s.file)}\` | ${s.cards} | ${s.accepted} | ${String(s.updatedAt).slice(0, 16).replace('T', ' ')} |\n`;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);

if (has('--json')) {
  console.log(JSON.stringify({ winRates: wr, readability: rd, timing, series, goodEnoughTotal, mono, byDefect, drops, rescan }, null, 2));
} else {
  console.log(md);
}

if (has('--commit')) {
  try {
    const rel = path.relative(REPO, OUT);
    execFileSync('git', ['add', '--', rel], { cwd: REPO });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--', rel], { cwd: REPO, encoding: 'utf8' }).trim();
    if (!staged) {
      console.error('\n(report unchanged — nothing to commit)');
    } else {
      execFileSync('git', ['commit', '-m',
        `report(rewrite): A/B standing — guided ${guided} vs raw ${rawT} over ${wr.totalDecisions} decisions`,
        '-m', `Accepted: ${wr.totalDecisions} · manual ${wr.manual} · kept-original ${wr.keptOriginal} · good-enough ${goodEnoughTotal}\nAvg ease Δ ${rd.avgEaseDelta ?? '—'} · improved ${rd.improvedPct ?? '—'}%\nRegenerate: node scripts/rewrite/report.mjs`,
        '--', rel], { cwd: REPO });
      console.error(`\n✅ committed ${rel}`);
    }
  } catch (e) {
    console.error(`\n✗ commit failed: ${e.message}`);
  }
}

if (has('--email')) {
  try {
    execFileSync(process.execPath, [
      path.join(REPO, 'scripts/email-artifact.mjs'),
      '--html', OUT, '--to', 'you@example.com',
      '--subject', `Ghost-Read A/B — guided ${guided} vs raw ${rawT} (${wr.totalDecisions} decisions)`,
    ], { cwd: REPO, stdio: 'inherit' });
  } catch (e) {
    console.error(`✗ email failed: ${e.message}`);
  }
}
