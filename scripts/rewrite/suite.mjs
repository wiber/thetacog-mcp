#!/usr/bin/env node
// scripts/rewrite/suite.mjs
// ════════════════════════════════════════════════════════════════════════════
// AUTOMATED SUITE MODE — the benchmark you don't have to click through.
//
// Sweeps a whole document non-interactively: diagnoses every paragraph, fires the
// enabled tracks at every cold sentence, measures each candidate on all three
// rulers, and emits a standalone HTML report.
//
// DRY-RUN BY DEFAULT. It writes a report and touches nothing else. `--apply` lets
// it commit the top-scoring candidate per card, and that is deliberately opt-in:
// a benchmark that silently rewrites the manuscript while you read its output is
// not a benchmark, it is an accident waiting to be discovered three commits later.
//
//   node scripts/rewrite/suite.mjs --file <path> [--tracks A,B,C,D] [--from L400]
//        [--limit 20] [--threshold 80] [--apply] [--out <path>] [--json]
//
// The report answers one question per card: which track earned the edit, and by
// how much on which ruler.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { extractProse, contextWindow } from './chunker.mjs';
import { diagnoseParagraph, rankFindings, DEFAULT_PERSONA } from './diagnose.mjs';
import { runMatrix, TRACKS, TRACK_BY_ID } from './tracks.mjs';
import { apertureFor } from './resolve-target.mjs';
import { sweepDocument } from './slop.mjs';
import { readability, frictionSeries } from './readability.mjs';
import * as tess from './tesseract.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const FILE = arg('--file');
if (!FILE || !fs.existsSync(FILE)) { console.error('✗ need --file <existing path>'); process.exit(1); }

const TRACK_IDS = arg('--tracks', 'A,B,C,D').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(arg('--limit', '15'), 10);
const THRESHOLD = parseInt(arg('--threshold', '80'), 10);
const SCAN_CONCURRENCY = parseInt(arg('--scan-concurrency', '4'), 10);
const JSON_OUT = has('--json');
const APPLY = has('--apply');

const raw = fs.readFileSync(FILE, 'utf8');
const { paragraphs, totalLines } = extractProse(raw, { filename: FILE });
const start = apertureFor(paragraphs, arg('--from', 0));
const rel = path.relative(REPO, FILE);

const OUT = arg('--out', path.join(REPO, 'docs/reports/rewrite-suite', `${path.basename(FILE).replace(/\.[^.]+$/, '')}-${stamp()}.html`));

log(`◧ suite · ${rel}`);
log(`  ${paragraphs.length} paragraphs · ${totalLines} lines · from ¶${start} · tracks ${TRACK_IDS.join(',')}`);
if (APPLY) log('  ⚠ --apply: top candidates WILL be committed');
else log('  dry-run: report only, nothing written to the manuscript');

// ── document-level slop sweep (deterministic, instant) ─────────────────────
const slopSweep = sweepDocument(paragraphs);
log(`  slop density ${slopSweep.documentDensity}/100w · ${slopSweep.cleanPct}% paragraphs clean`);

// ── stage 1: diagnose, in parallel ─────────────────────────────────────────
const scanned = {};
const allFindings = [];
let cursor = start;
let active = 0;
let scanErrors = 0;

await new Promise((resolve) => {
  const pump = () => {
    while (active < SCAN_CONCURRENCY && cursor < paragraphs.length && allFindings.length < LIMIT * 3) {
      const i = cursor++;
      active++;
      diagnoseParagraph(paragraphs, i, { persona: DEFAULT_PERSONA })
        .then((d) => {
          const p = paragraphs[i];
          if (d?.ok) {
            scanned[i] = {
              startLine: p.startLine, endLine: p.endLine, local: true,
              minScore: d.findings.length ? Math.min(...d.findings.map((f) => f.score)) : 100,
            };
            allFindings.push(...d.findings);
          } else { scanErrors++; }
        })
        .catch(() => { scanErrors++; })
        .finally(() => {
          active--;
          if (cursor % 10 === 0) process.stderr.write(`\r  scanning ¶${cursor}/${paragraphs.length}…   `);
          if (active === 0 && (cursor >= paragraphs.length || allFindings.length >= LIMIT * 3)) resolve();
          else pump();
        });
    }
  };
  pump();
});
process.stderr.write('\r');

const cold = rankFindings(allFindings, { threshold: THRESHOLD }).slice(0, LIMIT);
log(`  scanned ${Object.keys(scanned).length} ¶ (${scanErrors} errors) · ${cold.length} cold sentences to work`);

// ── stage 2: run the matrix on each cold sentence ──────────────────────────
const cards = [];
for (let n = 0; n < cold.length; n++) {
  const finding = cold[n];
  const p = paragraphs[finding.paragraphIndex];
  if (!p) continue;
  const win = contextWindow(paragraphs, finding.paragraphIndex, 1, 1);
  process.stderr.write(`\r  matrix ${n + 1}/${cold.length} (¶${finding.paragraphIndex})…      `);
  const m = await runMatrix({
    finding, paragraph: p,
    beforeText: win.before.map((x) => x.text).join('\n\n'),
    afterText: win.after.map((x) => x.text).join('\n\n'),
    repoRoot: REPO, raw,
  }, TRACK_IDS);
  if (m.candidates.length) cards.push({ finding, paragraph: p, ...m });
}
process.stderr.write('\r');
log(`  ${cards.length} cards with candidates\n`);

// ── scoring: the composite the suite ranks by ──────────────────────────────
// Slop is weighted hardest because adding filler is the failure this tool exists
// to prevent; readability is the secondary signal. Displacement is REPORTED but
// carries zero weight — it cannot tell a good rewrite from nonsense (see
// tesseract.mjs), so scoring on it would be scoring on noise.
function scoreCandidate(c) {
  const slop = c.slop ? -c.slop.delta : 0;                 // cleaning slop is positive
  const ease = c.readability?.easeDelta ?? 0;
  const grade = c.readability?.gradeDelta ?? 0;
  const bloat = c.readability && c.readability.wordsDelta > 0
    ? Math.min(0, -(c.readability.wordsDelta - 3))
    : 0;
  return +(slop * 2 + ease * 0.35 + (-grade) * 1.2 + bloat * 0.5).toFixed(2);
}

for (const card of cards) {
  card.candidates.forEach((c) => { c.suiteScore = scoreCandidate(c); });
  card.candidates.sort((a, b) => b.suiteScore - a.suiteScore);
  card.top = card.candidates[0];
}

// ── the A/B tally ──────────────────────────────────────────────────────────
const tally = {};
for (const id of TRACK_IDS) tally[id] = { offered: 0, top: 0, sumScore: 0, n: 0 };
for (const card of cards) {
  for (const c of card.candidates) {
    if (!tally[c.trackId]) continue;
    tally[c.trackId].offered++;
    tally[c.trackId].sumScore += c.suiteScore;
    tally[c.trackId].n++;
  }
  if (card.top && tally[card.top.trackId]) tally[card.top.trackId].top++;
}
for (const t of Object.values(tally)) {
  t.avgScore = t.n ? +(t.sumScore / t.n).toFixed(2) : null;
  t.topRate = t.offered ? +(t.top / cards.length * 100).toFixed(1) : 0;
}

const guided = (tally.B?.top || 0) + (tally.D?.top || 0);
const rawT = (tally.A?.top || 0) + (tally.C?.top || 0);

// ── apply (opt-in) ─────────────────────────────────────────────────────────
let applied = 0;
if (APPLY && cards.length) {
  const { RewriteEngine } = await import('./engine.mjs');
  const engine = new RewriteEngine({ repoRoot: REPO, file: path.resolve(FILE), aperture: start, tracks: TRACK_IDS });
  for (const card of cards) {
    if (!card.top) continue;
    // Never auto-apply a candidate that ADDS slop, whatever else it scores.
    if (card.top.slop?.addedSlop) continue;
    try {
      const injected = {
        id: `suite-${applied}`, finding: card.finding,
        paragraph: { index: card.paragraph.index, text: card.paragraph.text, start: card.paragraph.start, end: card.paragraph.end, startLine: card.paragraph.startLine, endLine: card.paragraph.endLine },
        context: { before: '', after: '' }, placement: card.originalPlacement,
        trackResults: card.trackResults, candidates: card.candidates,
      };
      engine.session.cards.push(injected);
      await engine.accept({ cardId: injected.id, text: card.top.text, winner: card.top.trackId, commit: true });
      applied++;
    } catch (e) { log(`  ! apply failed on ¶${card.paragraph.index}: ${e.message}`); }
  }
  log(`  applied ${applied} edits`);
}

// ── report ─────────────────────────────────────────────────────────────────
const friction = frictionSeries(scanned, []);
const summary = {
  file: rel, generatedAt: new Date().toISOString(),
  paragraphs: paragraphs.length, totalLines, scanned: Object.keys(scanned).length,
  aperture: start, tracks: TRACK_IDS, threshold: THRESHOLD,
  coldSentences: cold.length, cards: cards.length,
  slop: { documentDensity: slopSweep.documentDensity, cleanPct: slopSweep.cleanPct },
  friction: { mean: friction.mean, cold: friction.cold, total: friction.total },
  tally, guidedVsRaw: { guided, raw: rawT }, applied, dryRun: !APPLY,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, renderHtml({ summary, cards, slopSweep, friction }));

if (JSON_OUT) console.log(JSON.stringify({ summary, cards: cards.map(slimCard) }, null, 2));
else {
  log('─'.repeat(66));
  log(`TRACK      offered  top-pick  top-rate  avg-score`);
  for (const id of TRACK_IDS) {
    const t = tally[id];
    log(`  ${id} ${(TRACK_BY_ID.get(id)?.key || '').padEnd(16)} ${String(t.offered).padStart(4)} ${String(t.top).padStart(8)} ${String(t.topRate + '%').padStart(9)} ${String(t.avgScore ?? '—').padStart(10)}`);
  }
  log('─'.repeat(66));
  log(`Tesseract-guided (B+D) ${guided}  ·  raw (A+C) ${rawT}`);
  log(`\n  report → ${path.relative(REPO, OUT)}\n`);
}

function slimCard(c) {
  return {
    line: c.paragraph.startLine, score: c.finding.score, defect: c.finding.defect,
    monologue: c.finding.monologue, original: c.finding.text,
    top: c.top ? { track: c.top.trackId, text: c.top.text, score: c.top.suiteScore } : null,
    candidates: c.candidates.map((x) => ({ track: x.trackId, text: x.text, score: x.suiteScore, slop: x.slop?.delta, ease: x.readability?.easeDelta })),
  };
}

function log(s) { if (!JSON_OUT) console.error(s); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderHtml({ summary, cards, slopSweep, friction }) {
  const colors = Object.fromEntries(TRACKS.map((t) => [t.id, t.color]));
  const trackRows = summary.tracks.map((id) => {
    const t = summary.tally[id];
    const tk = TRACK_BY_ID.get(id);
    return `<tr><td><span class="sw" style="background:${colors[id]}"></span>${id} ${esc(tk?.key || '')}</td>
      <td>${t.offered}</td><td><b>${t.top}</b></td><td>${t.topRate}%</td><td>${t.avgScore ?? '—'}</td></tr>`;
  }).join('');

  const fricPts = friction.series.map((s, i) => `${(i / Math.max(1, friction.series.length - 1)) * 100},${100 - s.trailing}`).join(' ');

  const cardHtml = cards.map((c, i) => `
    <article class="card">
      <header>
        <span class="score s${c.finding.score < 40 ? 'a' : c.finding.score < 65 ? 'b' : 'c'}">${c.finding.score}/100</span>
        <span class="tag">${esc(c.finding.defect)}</span>
        <span class="dim">line ${c.paragraph.startLine} · ¶${c.paragraph.index}</span>
      </header>
      <blockquote class="mono">&ldquo;${esc(c.finding.monologue)}&rdquo;</blockquote>
      <div class="orig"><span class="lbl">ORIGINAL</span>${esc(c.finding.text)}</div>
      <table class="cands"><thead><tr><th>track</th><th>rewrite</th><th>slop</th><th>ease</th><th>grade</th><th>shift</th><th>score</th></tr></thead><tbody>
      ${c.candidates.map((x) => `<tr class="${x === c.top ? 'top' : ''}">
        <td><span class="sw" style="background:${colors[x.trackId] || '#888'}"></span>${x.trackId}</td>
        <td>${esc(x.text)}<div class="why">${esc(x.motivation || '')}</div></td>
        <td class="${(x.slop?.delta ?? 0) <= 0 ? 'good' : 'bad'}">${x.slop ? (x.slop.delta > 0 ? '+' : '') + x.slop.delta : '—'}</td>
        <td class="${(x.readability?.easeDelta ?? 0) > 0 ? 'good' : 'bad'}">${x.readability?.easeDelta ?? '—'}</td>
        <td class="${(x.readability?.gradeDelta ?? 0) <= 0 ? 'good' : 'bad'}">${x.readability?.gradeDelta ?? '—'}</td>
        <td class="dim">${x.drift ? esc(x.drift.verdict.toLowerCase()) + ' ' + x.drift.coverage + '%' : '—'}</td>
        <td><b>${x.suiteScore}</b></td></tr>`).join('')}
      </tbody></table>
    </article>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Ghost-Read Suite — ${esc(summary.file)}</title>
<style>
:root{--bg:#0d1117;--panel:#11161d;--line:#1f2933;--text:#c9d4e0;--dim:#8b98a5;--cyan:#66fcf1;--ok:#4ade80;--bad:#f87171}
*{box-sizing:border-box}body{background:var(--bg);color:var(--text);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:24px}
h1{color:var(--cyan);font-size:18px;margin:0 0 4px}h2{font-size:13px;color:var(--dim);letter-spacing:1px;margin:26px 0 10px;text-transform:uppercase}
.dim{color:var(--dim)}.good{color:var(--ok)}.bad{color:var(--bad)}.mono{font-family:inherit}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px}
.stat b{display:block;font-size:20px;color:var(--cyan);font-weight:600}
.stat span{font-size:11px;color:var(--dim)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden}
th{text-align:left;font-size:10px;letter-spacing:1px;color:var(--dim);padding:7px 9px;border-bottom:1px solid var(--line);text-transform:uppercase}
td{padding:7px 9px;border-bottom:1px solid #161c24;vertical-align:top}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:14px}
.card header{display:flex;gap:10px;align-items:center;margin-bottom:8px;font-size:11px}
.score{font-weight:700}.sa{color:#f87171}.sb{color:#fb923c}.sc{color:#ffd166}
.tag{border:1px solid var(--line);padding:1px 6px;border-radius:3px;color:var(--dim)}
blockquote{margin:0 0 9px;padding:7px 11px;background:rgba(248,113,113,.07);border-left:3px solid var(--bad);color:#e3b9b9;font-style:italic}
.orig{padding:7px 10px;background:#0a0e14;border-radius:4px;margin-bottom:9px}
.lbl{display:block;font-size:9px;letter-spacing:1px;color:var(--dim);margin-bottom:3px}
.cands td:nth-child(2){max-width:520px}
.why{color:var(--dim);font-size:11px;margin-top:3px}
tr.top{background:rgba(102,252,241,.05)}
.note{background:var(--panel);border:1px solid var(--line);border-left:3px solid #ffd166;border-radius:4px;padding:11px;color:var(--dim);margin:14px 0}
svg{background:#0a0e14;border-radius:4px}
</style></head><body>
<h1>◧ Ghost-Read Suite — ${esc(summary.file)}</h1>
<div class="dim">${esc(summary.generatedAt)} · ${summary.dryRun ? 'DRY RUN (nothing written)' : `APPLIED ${summary.applied} edits`} · tracks ${summary.tracks.join(',')} · threshold ${summary.threshold}</div>

<div class="grid">
  <div class="stat"><b>${summary.cards}</b><span>cards generated</span></div>
  <div class="stat"><b>${summary.coldSentences}</b><span>cold sentences</span></div>
  <div class="stat"><b>${summary.friction.mean ?? '—'}</b><span>mean comprehension</span></div>
  <div class="stat"><b>${summary.slop.documentDensity}</b><span>slop density /100w</span></div>
  <div class="stat"><b>${summary.slop.cleanPct}%</b><span>paragraphs slop-clean</span></div>
  <div class="stat"><b>${summary.guidedVsRaw.guided}–${summary.guidedVsRaw.raw}</b><span>Tesseract vs raw</span></div>
</div>

<h2>A/B — which track earns the edit</h2>
<table><thead><tr><th>track</th><th>offered</th><th>top pick</th><th>top rate</th><th>avg score</th></tr></thead><tbody>${trackRows}</tbody></table>

<div class="note"><b>How to read this.</b> The composite score weights <b>slop reduction</b> hardest and
readability second. Semantic <b>shift</b> is shown for every candidate but carries <b>zero weight</b>:
calibration showed it measures how far a rewrite moves the passage, not whether the move was good —
deliberate nonsense scores in the same range as a genuine rewrite at single-sentence scale. Treat the
top-pick column as a machine-suggested ranking, not a verdict; the real A/B is which candidate a human
picks in the console.</div>

<h2>Cognitive friction across the document</h2>
<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="120">
  <polyline points="${fricPts}" fill="none" stroke="#66fcf1" stroke-width="0.8" vector-effect="non-scaling-stroke"/>
  <line x1="0" y1="20" x2="100" y2="20" stroke="#4ade80" stroke-width="0.3" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
</svg>
<div class="dim">trailing comprehension (higher is better); dashed line = the 80 threshold below which a sentence is flagged</div>

<h2>Worst slop paragraphs (deterministic, LLM-free)</h2>
<table><thead><tr><th>line</th><th>density</th><th>verdict</th><th>top hits</th></tr></thead><tbody>
${slopSweep.worst.slice(0, 12).map((w) => `<tr><td>${w.startLine}</td><td>${w.density}</td><td class="${w.verdict === 'CLEAN' ? 'good' : 'bad'}">${w.verdict}</td><td class="dim">${w.topHits.map((h) => esc(h.kind)).join(', ')}</td></tr>`).join('')}
</tbody></table>

<h2>Cards</h2>
${cardHtml || '<div class="dim">No cold sentences found above the threshold.</div>'}
</body></html>`;
}
