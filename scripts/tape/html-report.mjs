// packages/thetacog-mcp/scripts/tape/html-report.mjs — the four static reports /tape opens on every run.
//
// WHY STATIC HTML AND NOT ONLY THE CONSOLE: the console is where you steer; these are the record.
// They open from file://, print correctly, survive the dev server being down, and can be attached to
// an email. The source doc's complaint is the blind terminal (L1421-1425: the UI "cannot just return
// a 'Success' message — it must display the anatomy of the proof"), and a report that only exists
// while a server runs is a different kind of blind.
//
// HOUSE RULES ENCODED HERE:
//  · ALWAYS EXPAND COORDINATE LABELS — never a bare `B,C1`.
//  · Absent data prints UNMEASURED with its reason. It must never render as a blank cell, because a
//    blank reads as a pass and the whole instrument stands on not being silent by omission.
//  · Every graph carries its caveat beneath it. A graph without its caveat becomes a verdict the
//    measurement cannot support.
//  · Dropped atoms stay VISIBLE and dimmed. Seeing what the AI passed over is the transparency contract.
//  · Self-contained: no CDN, no remote font, no network. Print-safe per .context/print-safe-css.md.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionsDir as storeSessionsDir } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UNMEASURED = (reason) => `<span class="unmeasured" title="${esc(reason || '')}">UNMEASURED</span>`;
const num = (v, reason) => (Number.isFinite(v) ? esc(v) : UNMEASURED(reason));

const NAMES = {
  A: 'Strategy', B: 'Tactics', C: 'Operations',
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};
const SHORTLEX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export function label(coord) {
  if (!coord) return UNMEASURED('no placement');
  const [r, c] = String(coord).split(',');
  return `${esc(coord)} <span class="dim">(${esc(NAMES[r] || r)} ⊕ ${esc(NAMES[c] || c)})</span>`;
}

const CSS = `
:root{--bg:#fff;--fg:#111;--dim:#667;--rule:#dde;--accent:#0a5;--warn:#b40;--drop:#aab;}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;margin:0;padding:2rem;max-width:1200px}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--rule);padding-bottom:.25rem}
nav{margin:.75rem 0 1.5rem;font-size:.85rem}nav a{color:var(--accent);margin-right:1rem;text-decoration:none}nav a:hover{text-decoration:underline}
.meta{color:var(--dim);font-size:.82rem;margin-bottom:1rem}
.chips span{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:.1rem .6rem;margin:.15rem .3rem .15rem 0;font-size:.8rem}
table{border-collapse:collapse;width:100%;font-size:.85rem}
th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--rule);vertical-align:top}
th{cursor:pointer;user-select:none;white-space:nowrap;background:#f7f8fa}
th:after{content:" ⇅";color:var(--dim);font-size:.75em}
tr.dropped{opacity:.45}
tr.dropped td:first-child:before{content:"drop ";color:var(--drop);font-size:.75em}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em}
pre{background:#f6f7f9;border:1px solid var(--rule);border-radius:6px;padding:.6rem;overflow-x:auto;white-space:pre-wrap}
blockquote{margin:.4rem 0;padding:.4rem .8rem;border-left:3px solid var(--rule);color:#334;background:#fafbfc}
.dim{color:var(--dim);font-weight:400}
.unmeasured{color:var(--warn);font-size:.8em;letter-spacing:.03em;border-bottom:1px dotted var(--warn);cursor:help}
.badge{background:#fee;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:0 .35rem;font-size:.75em}
.caveat{color:var(--dim);font-size:.8rem;font-style:italic;margin:.5rem 0 1.5rem;max-width:70ch}
.empty{color:var(--dim);padding:1rem;border:1px dashed var(--rule);border-radius:6px}
@media print{
  body{background:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;max-width:none}
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  nav{display:none}
}`;

const SORT_JS = `
document.querySelectorAll('table.sortable').forEach(function(t){
  t.querySelectorAll('th').forEach(function(th,i){
    th.addEventListener('click',function(){
      var tb=t.tBodies[0], rows=[].slice.call(tb.rows);
      var asc=th.dataset.asc!=='1'; th.dataset.asc=asc?'1':'0';
      rows.sort(function(a,b){
        var x=a.cells[i].dataset.v!==undefined?a.cells[i].dataset.v:a.cells[i].innerText;
        var y=b.cells[i].dataset.v!==undefined?b.cells[i].dataset.v:b.cells[i].innerText;
        var nx=parseFloat(x),ny=parseFloat(y);
        if(!isNaN(nx)&&!isNaN(ny))return asc?nx-ny:ny-nx;
        return asc?String(x).localeCompare(String(y)):String(y).localeCompare(String(x));
      });
      rows.forEach(function(r){tb.appendChild(r)});
    });
  });
});
document.querySelectorAll('[data-filter]').forEach(function(sel){
  sel.addEventListener('change',function(){
    var key=sel.dataset.filter,val=sel.value;
    document.querySelectorAll('tbody tr').forEach(function(r){
      var show=(val===''||r.dataset[key]===val);
      r.style.display=show?'':'none';
    });
  });
});`;

function page({ title, session, body, nav = true }) {
  const s = session || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — /tape ${esc(s.slug || '')}</title><style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<div class="meta">
  session <strong>${esc(s.slug || '(unnamed)')}</strong> ·
  sources: ${(s.sources || []).map((x) => `<code>${esc(String(x).replace(REPO + '/', ''))}</code>`).join(', ') || UNMEASURED('no sources recorded')} ·
  home: ${s.home?.coord ? label(s.home.coord) : UNMEASURED(s.home?.reason || 'home not yet decided')} ·
  generated ${esc(new Date().toISOString())}
</div>
${nav ? `<nav><a href="./specs.html">Atoms</a><a href="./decisions.html">Decisions</a><a href="./vega.html">Lane departure</a><a href="./verbiage.html">Verbiage</a></nav>` : ''}
${body}
<script>${SORT_JS}</script></body></html>`;
}

// ── the four reports ───────────────────────────────────────────────────────────────────────────
function specsHtml(d) {
  const atoms = d.atoms || [];
  if (!atoms.length) {
    return page({ title: 'Atoms', session: d.session, body:
      `<div class="empty">No atoms yet — the tape has walked ${esc(d.session?.cursor ?? 0)} of ${esc(d.session?.totalTurns ?? '?')} turns.
       This is a state, not a failure: an empty tape reads as UNWALKED, never as "nothing to find".</div>` });
  }
  const rows = atoms.map((a) => `<tr class="${a.status === 'dropped' ? 'dropped' : ''}" data-type="${esc(a.type)}" data-status="${esc(a.status)}">
    <td><code>${esc(a.id)}</code></td>
    <td>${esc(a.type)}</td>
    <td>${esc(a.priority || '')}</td>
    <td>${esc(a.rule || '')}${(a.contradicts || []).length ? ` <span class="badge">CONTRADICTS ${esc((a.contradicts || []).join(', '))}</span>` : ''}</td>
    <td>${a.target_surface ? `<code>${esc(a.target_surface)}</code>` : '<span class="dim">—</span>'}</td>
    <td>${label(a.coord || (a.placement || [])[0])}</td>
    <td data-v="${Number.isFinite(a.sigma) ? a.sigma : ''}">${num(a.sigma, 'no walk recorded for this atom')}</td>
    <td data-v="${Number.isFinite(a.laneDrift) ? a.laneDrift : ''}">${num(a.laneDrift, 'home not decided, or placement unavailable')}</td>
    <td>${esc(a.status)}</td><td>${esc(a.picked_by || '')}</td></tr>`).join('\n');
  return page({ title: 'Atoms', session: d.session, body: `
<div class="chips"><span>${atoms.length} live atoms</span><span>${atoms.filter((a) => a.status === 'dropped').length} dropped (shown, dimmed)</span><span>${atoms.filter((a) => (a.contradicts || []).length).length} with contradictions</span></div>
<p class="meta">Filter:
  <select data-filter="type"><option value="">all types</option>${['DECISION', 'CONSTRAINT', 'VERIFY', 'CONTEXT'].map((t) => `<option>${t}</option>`).join('')}</select>
  <select data-filter="status"><option value="">all statuses</option>${['suggested', 'picked', 'dropped', 'reintroduced', 'decided', 'dispatched', 'done'].map((t) => `<option>${t}</option>`).join('')}</select>
  — click any header to sort.</p>
<table class="sortable"><thead><tr><th>id</th><th>type</th><th>pri</th><th>rule</th><th>target surface</th><th>placement</th><th>σ</th><th>lane drift</th><th>status</th><th>picked by</th></tr></thead><tbody>${rows}</tbody></table>
<p class="caveat">Placement is a decidable WHERE — recomputable from the quote with no model in the path. It is not a
judgment that the atom is important or correctly extracted. σ reads vocabulary concentration, not truth. Lane drift is
distance from this session's home coordinate; off-lane means scope breadth, not defect.</p>` });
}

function decisionsHtml(d) {
  const decs = d.decisions || [];
  const byId = Object.fromEntries((d.atoms || []).map((a) => [a.id, a]));
  if (!decs.length) {
    return page({ title: 'Decisions', session: d.session, body: `<div class="empty">No decisions recorded yet. Every decision lands here with the verbatim quote it was made against, the reply as spoken or typed, and its commit.</div>` });
  }
  const body = decs.map((x) => {
    const a = byId[x.atomId] || {};
    return `<h2>${esc(x.atomId)} — ${esc(x.verdict || '')}</h2>
    <p>${esc(a.rule || '')}</p>
    <blockquote>${esc(a.quote || '')}</blockquote>
    <p class="meta">reply: ${x.reply ? esc(x.reply) : UNMEASURED('no reply recorded')} ·
      ${x.spoken ? 'spoken aloud' : 'typed'} · subagents: ${num(x.subagents, 'not set')} ·
      commit: ${x.commit ? `<code>${esc(x.commit)}</code>` : UNMEASURED('no commit recorded for this decision')} ·
      ${esc(x.ts || '')}</p>`;
  }).join('\n');
  return page({ title: 'Decisions', session: d.session, body });
}

function vegaHtml(d) {
  const rows = (d.vega || []).filter((r) => r && r.kind !== 'enforcement');
  if (!rows.length) {
    return page({ title: 'Lane departure', session: d.session, body: `<div class="empty">No series yet — atoms must be placed before the tape can show where it went.</div>` });
  }
  const W = 1100, H = 320, PAD = 46;
  const maxAuc = Math.max(1, ...rows.map((r) => r.laneAuc || 0));
  const n = rows.length;
  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
  const y = (v) => H - PAD - ((v / maxAuc) * (H - 2 * PAD));
  const area = `M ${x(0)},${H - PAD} ` + rows.map((r, i) => `L ${x(i)},${y(r.laneAuc || 0)}`).join(' ') + ` L ${x(n - 1)},${H - PAD} Z`;
  const line = rows.map((r, i) => `${i ? 'L' : 'M'} ${x(i)},${y(r.laneAuc || 0)}`).join(' ');
  const departures = rows.map((r, i) => (Number.isFinite(r.laneDrift) && r.laneDrift >= 2
    ? `<circle cx="${x(i)}" cy="${y(r.laneAuc || 0)}" r="7" fill="none" stroke="#b40" stroke-width="2"><title>${esc(r.atomId)} — lane drift ${r.laneDrift} at ${esc(r.coord || '')}</title></circle>` : '')).join('');
  const unmeasured = rows.filter((r) => !Number.isFinite(r.laneDrift)).length;
  return page({ title: 'Lane departure', session: d.session, body: `
<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Lane departure area under the curve">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
  <path d="${area}" fill="#0a5" fill-opacity="0.10"/>
  <path d="${line}" fill="none" stroke="#0a5" stroke-width="2"/>
  ${departures}
  <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#889"/>
  <line x1="${PAD}" y1="${PAD - 10}" x2="${PAD}" y2="${H - PAD}" stroke="#889"/>
  <text x="${PAD}" y="${H - 14}" font-size="12" fill="#667">position along the tape (atom order) →</text>
  <text x="${PAD}" y="${PAD - 18}" font-size="12" fill="#667">cumulative king-move distance from the home coordinate ↑</text>
  <text x="${W - PAD}" y="${y(maxAuc) + 4}" font-size="12" fill="#0a5" text-anchor="end">total ${esc(maxAuc)}</text>
</svg>
<div class="chips"><span>total lane-departure AUC: <strong>${esc(rows.at(-1)?.laneAuc ?? 0)}</strong></span>
<span>${rows.length} atoms plotted</span>
<span>${rows.filter((r) => Number.isFinite(r.laneDrift) && r.laneDrift >= 2).length} lane departures circled</span>
${unmeasured ? `<span>${unmeasured} ${UNMEASURED('no lane reading — home unset or placement unavailable')}</span>` : ''}</div>
<p class="caveat"><strong>This is lane-departure AUC, deliberately not called vega.</strong> The priced vega in this
repo (greeks.mjs) is the variance of hold-rates and is published as the benchmark index; shipping a cumulative sum
under the same name would be two different numbers wearing one label. What this curve measures: how much of the
tape's mass sat away from the coordinate this session calls home. A rising slope means the work spent sustained time
in another trade's lane — which may mean the subject genuinely moved, or may be the drift you wanted to catch. It is a
decidable WHERE, computed with no model in the path, and it is not a quality score. Off-lane is scope breadth, not defect.</p>
<h2>the rows</h2>
<table class="sortable"><thead><tr><th>atom</th><th>pos</th><th>coordinate</th><th>σ</th><th>lane drift</th><th>lane AUC</th></tr></thead><tbody>
${rows.map((r) => `<tr><td><code>${esc(r.atomId)}</code></td><td data-v="${r.pos}">${esc(r.pos)}</td><td>${label(r.coord)}</td>
<td data-v="${r.sigma ?? ''}">${num(r.sigma, 'no walk')}</td>
<td data-v="${r.laneDrift ?? ''}">${num(r.laneDrift, r.unmeasured || 'no reading')}</td>
<td data-v="${r.laneAuc ?? ''}">${num(r.laneAuc, 'no reading')}</td></tr>`).join('\n')}
</tbody></table>` });
}

function verbiageHtml(d) {
  const atoms = d.atoms || [];
  const disp = Object.fromEntries((d.dispatches || []).map((x) => [x.atomId, x]));
  const decs = Object.fromEntries((d.decisions || []).map((x) => [x.atomId, x]));
  if (!atoms.length) return page({ title: 'Verbiage', session: d.session, body: `<div class="empty">Nothing extracted yet.</div>` });
  const body = atoms.map((a) => `
<h2>${esc(a.id)} <span class="dim">${esc(a.type)} · ${esc(a.status)}${a.priority ? ' · ' + esc(a.priority) : ''}</span></h2>
<p><strong>${esc(a.rule || '')}</strong></p>
<p class="meta">source: <code>${esc(String(a.source || '').replace(REPO + '/', ''))}</code> lines ${esc((a.chunk || [])[0] ?? '?')}–${esc((a.chunk || [])[1] ?? '?')} · placement ${label(a.coord)} · σ ${num(a.sigma, 'no walk')}${a.apertureFidelity?.ncd !== undefined ? ` · extraction NCD ${esc(a.apertureFidelity.ncd)}${a.apertureFidelity.lowMass ? ' <span class="unmeasured" title="the rule is under the entropy floor — a low-mass reading">low-mass</span>' : ''}` : ''}</p>
<blockquote>${esc(a.quote || '')}</blockquote>
${a.falsifier ? `<p class="meta">falsifier:</p><pre>${esc(a.falsifier)}</pre>` : ''}
${disp[a.id]?.prompt ? `<p class="meta">dispatch prompt as fired (sha ${esc(String(disp[a.id].promptSha || '').slice(0, 12))}):</p><pre>${esc(disp[a.id].prompt)}</pre>` : ''}
${decs[a.id]?.reply ? `<p class="meta">decision reply: ${esc(decs[a.id].reply)}</p>` : ''}`).join('\n');
  return page({ title: 'Verbiage', session: d.session, body });
}

// ── the entry point ────────────────────────────────────────────────────────────────────────────
export function generateReports(slug, { sessionsDir } = {}) {
  // ONE RULE, ONE PLACE. This default used to be a hardcoded <repo>/.thetacog/tape-sessions,
  // which ignored TAPE_SESSIONS_DIR — so every caller had to remember to pass sessionsDir and
  // the one that forgot wrote a temp session's reports into the REAL repo tree. (worker.mjs had
  // already been patched at its own call site; cli.mjs had not, and it spilled.) Defaulting to
  // store.sessionsDir() makes every caller correct by construction instead of by memory.
  const dir = resolve(sessionsDir || storeSessionsDir(), slug);
  const readJson = (f, dflt) => { try { return JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { return dflt; } };
  const readNd = (f) => { try { return readFileSync(resolve(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  // fork-forward resolution: rows share ids, the LAST row per id is the live one
  const live = (rows) => { const m = new Map(); for (const r of rows) if (r && r.id) m.set(r.id, { ...(m.get(r.id) || {}), ...r }); return [...m.values()]; };
  const d = {
    session: readJson('session.json', { slug }),
    atoms: live(readNd('specs.ndjson')),
    decisions: readNd('decisions.ndjson'),
    dispatches: readNd('dispatches.ndjson'),
    vega: readNd('vega-series.ndjson'),
  };
  const out = resolve(dir, 'html');
  mkdirSync(out, { recursive: true });
  const files = {
    specs: resolve(out, 'specs.html'),
    decisions: resolve(out, 'decisions.html'),
    vega: resolve(out, 'vega.html'),
    verbiage: resolve(out, 'verbiage.html'),
  };
  writeFileSync(files.specs, specsHtml(d));
  writeFileSync(files.decisions, decisionsHtml(d));
  writeFileSync(files.vega, vegaHtml(d));
  writeFileSync(files.verbiage, verbiageHtml(d));
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) { console.error('usage: node html-report.mjs <slug>'); process.exit(2); }
  const f = generateReports(slug);
  for (const [k, v] of Object.entries(f)) console.log(`${k.padEnd(10)} ${v}`);
}
