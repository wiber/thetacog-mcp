#!/usr/bin/env node
// scripts/vna/spec-render.mjs — THE VERSIONED SPEC DOOR (VNA cockpit, 2026-09-07)
//
// One command per turn: snapshot the spec markdown to an immutable version, render it as a
// hyper-hierarchical dark HTML with (a) live checkbox state, (b) the encircled tesseract state
// from .thetacog/lens-encircled/latest.json with REEF NAMES (never bare coords), and (c) a
// one-click COPY payload for the right-side chat LLM. Then bash-open that version.
//
// LLM-FREE: pure function of the spec file + the lens receipt. No model in this path.
// VIA NEGATIVA: renders only what the spec file actually says; it never invents a section.
// @guard tests/vna/spec-render.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const SPEC = process.env.VNA_SPEC || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
const OUT_DIR = resolve(REPO, 'docs/specs/vna/versions');
const LENS = resolve(REPO, '.thetacog/lens-encircled/latest.json');
const LENS_PNG = resolve(REPO, '.thetacog/lens-encircled/latest.png');
const TXT = resolve(REPO, 'docs/05-content/blog/scratchpad/GoalNegSp.txt');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── version number: count existing versions, never overwrite one ──────────────
function nextVersion() {
  mkdirSync(OUT_DIR, { recursive: true });
  const ns = readdirSync(OUT_DIR).map((f) => /^v(\d+)-/.exec(f)?.[1]).filter(Boolean).map(Number);
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

// ── the checklist is the state. Parse it, never re-derive it. ─────────────────
function parseChecklist(md) {
  const out = [];
  for (const line of md.split('\n')) {
    const m = /^-\s*\[([ xX])\]\s*(\S+)\s+(.*)$/.exec(line.trim());
    if (m) out.push({ done: m[1].toLowerCase() === 'x', id: m[2], text: m[3] });
  }
  return out;
}

// ── open questions carry the assumption acted on; that is the via-negativa receipt ──
function parseOpenQuestions(md) {
  const out = [];
  const re = /^\-\s*\*\*(Q\d+)\*\*\s*(.*)$/gm;
  let m; while ((m = re.exec(md))) out.push({ id: m[1], text: m[2] });
  return out;
}

// ── hierarchy: headings become a collapsible tree; that is the "hyper-hierarchical" ask ──
function parseTree(md) {
  const nodes = [];
  const lines = md.split('\n');
  let cur = null;
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { cur = { depth: h[1].length, title: h[2], body: [] }; nodes.push(cur); continue; }
    if (cur) cur.body.push(line);
  }
  return nodes;
}

function loadLens() {
  try { return JSON.parse(readFileSync(LENS, 'utf8')); } catch { return null; }
}

// ── THE CLIPBOARD PAYLOAD — what gets pasted into the right-side chat LLM ─────
// It is the DISTILLED state: checklist + open questions + the reef-NAMED drift zones.
// A bare coordinate is banned (ALWAYS EXPAND COORDINATE LABELS), so every zone carries its name.
export function buildPayload({ version, checklist, questions, lens, specBytes, txtBytes }) {
  const done = checklist.filter((c) => c.done).length;
  const L = [];
  L.push(`# VNA COCKPIT — SPEC STATE v${version}`);
  L.push(`spec ${specBytes}B · source txt ${txtBytes}B · ${done}/${checklist.length} checked`);
  L.push('');
  L.push('## CHECKLIST');
  for (const c of checklist) L.push(`${c.done ? '[x]' : '[ ]'} ${c.id} ${c.text}`);
  L.push('');
  L.push('## OPEN QUESTIONS');
  for (const q of questions) L.push(`${q.id} ${q.text}`);
  if (lens) {
    L.push('');
    L.push(`## TESSERACT STATE — pixel ${lens.coord} (${lens.hat}) · domain ${lens.domain}`);
    if (lens.unmeasured) L.push(`UNMEASURED — ${lens.unmeasured} (no panel this prompt; the lists below are empty by construction, not quiet)`);
    else L.push(`walk ${lens.walkEngine || '?'} · regions ${lens.regionEngine || '?'} · aperture ${lens.apertureVersion || '?'} · off-lane ${lens.offPct ?? '?'}%`);
    const named = (lens.regions || []).filter((r) => r.name);
    if (named.length) {
      L.push('### ATTRACTED SEMANTIC CONTENT (the red cells, with what they mean)');
      for (const r of named) L.push(`- kind${r.kind} ${r.coord} — ${r.name}`);
    }
    // C20: the heading is read off the rows' own semantics — drift (Δ) · dispersion (self-lane) · unlabelled (an older
    // receipt with no field) — never "drift" by default: a dispersion ring printed under DRIFT is the fence failing
    const off = lens.outOfLane || [];
    const bySem = { drift: [], dispersion: [], unlabelled: [] };
    for (const o of off) (bySem[o.semantics === 'drift' || o.semantics === 'dispersion' ? o.semantics : 'unlabelled']).push(o);
    const HEAD = { drift: (n) => `### DRIFT ZONES — ${n} out of lane (Δ: reality fired where intent is weak)`, dispersion: (n) => `### DISPERSION ZONES — ${n} rings (self-lane: the mass sprayed over itself; not drift)`, unlabelled: (n) => `### ZONES WITHOUT SEMANTICS — ${n} (an older receipt carries no field; not read as drift)` };
    const order = ['drift', 'dispersion', 'unlabelled'].filter((k) => bySem[k].length || k === 'drift');
    for (const k of order) { const rows = bySem[k]; L.push(HEAD[k](rows.length)); for (const o of rows.slice(0, 40)) L.push(`- ${o.coord} ${o.hat}`); if (rows.length > 40) L.push(`- …+${rows.length - 40} more`); }
    const inl = lens.inLane || [];
    L.push(`### IN LANE — ${inl.length}`);
    for (const o of inl.slice(0, 20)) L.push(`- ${o.coord} ${o.hat}`);
  } else {
    L.push('');
    L.push('## TESSERACT STATE — UNAVAILABLE (lens receipt absent; not substituted)');
  }
  return L.join('\n');
}

function render({ version, md, checklist, questions, tree, lens, payload, stateHash }) {
  const done = checklist.filter((c) => c.done).length;
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 0;
  let pngUri = '';
  try { if (existsSync(LENS_PNG)) pngUri = 'data:image/png;base64,' + readFileSync(LENS_PNG).toString('base64'); } catch {}

  const treeHtml = tree.map((n) => {
    const body = n.body.join('\n').trim();
    if (!body && n.depth > 1) return '';
    const open = n.depth <= 2 ? ' open' : '';
    return `<details class="d${n.depth}"${open}><summary>${esc(n.title)}</summary><pre>${esc(body)}</pre></details>`;
  }).join('\n');

  const chkHtml = checklist.map((c) =>
    `<li class="${c.done ? 'ok' : 'todo'}"><b>${esc(c.id)}</b> ${esc(c.text)}</li>`).join('\n');

  const qHtml = questions.map((q) => `<li><b>${esc(q.id)}</b> ${esc(q.text)}</li>`).join('\n');

  const named = lens ? (lens.regions || []).filter((r) => r.name) : [];
  const zonesHtml = named.map((r) =>
    `<li class="k${r.kind}"><code>${esc(r.coord)}</code> ${esc(r.name)}</li>`).join('\n')
    || (lens && lens.unmeasured ? `<li class="muted">UNMEASURED — ${esc(lens.unmeasured)}</li>` : '<li class="muted">no named regions in this receipt</li>');
  const offHtml = lens ? (lens.outOfLane || []).map((o) =>
    `<span class="chip">${esc(o.coord)} · ${esc(o.hat)}</span>`).join(' ') : '';

  return `<!doctype html><meta charset="utf-8"><title>VNA spec v${version}</title>
<style>
:root{--bg:#0a0c10;--fg:#d8dee9;--dim:#7b8794;--acc:#4ec9b0;--red:#ff5959;--amb:#ffb000;--grn:#1e9150}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:19px;margin:0 0 4px;letter-spacing:.02em}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:1fr 380px;gap:20px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
.card{border:1px solid #1e242e;background:#0e1218;border-radius:8px;padding:14px;margin-bottom:16px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--acc);margin:0 0 10px}
ul{list-style:none;padding:0;margin:0}li{padding:3px 0;border-bottom:1px solid #151a22}
li.ok{color:var(--grn)}li.ok b:before{content:"✔ "}li.todo b:before{content:"☐ "}li.todo{color:var(--fg)}
li.k3{color:var(--red)}li.k2{color:var(--amb)}li.k1{color:var(--grn)}
.muted{color:var(--dim)}
code{color:var(--acc)}
.bar{height:6px;background:#151a22;border-radius:3px;overflow:hidden;margin:8px 0 14px}
.bar i{display:block;height:100%;background:var(--acc);width:${pct}%}
details{margin:0 0 6px}summary{cursor:pointer;color:var(--fg);padding:4px 0;font-weight:600}
details.d1>summary{color:var(--acc);font-size:15px;border-bottom:1px solid #1e242e}
details.d2>summary{color:#9cdcfe}details.d3>summary{color:var(--dim);font-weight:400}
pre{white-space:pre-wrap;color:var(--dim);font-size:12.5px;margin:6px 0 10px;padding-left:12px;border-left:2px solid #1e242e}
.chip{display:inline-block;background:#151a22;border:1px solid #232b36;border-radius:4px;padding:1px 6px;margin:2px 2px;font-size:11px;color:var(--dim)}
button{background:var(--acc);color:#04140f;border:0;border-radius:5px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer;width:100%}
button.alt{background:#232b36;color:var(--fg);margin-top:8px}
img.panel{width:100%;image-rendering:pixelated;border:1px solid #1e242e;border-radius:6px}
textarea{position:absolute;left:-9999px}
.hash{color:var(--dim);font-size:11px;word-break:break-all}
</style>
<div class="wrap">
<h1>VNA SEMANTIC COCKPIT — SPEC v${version}</h1>
<div class="sub">${done}/${checklist.length} checked · ${pct}% · stateHash <span class="hash">${stateHash}</span> · LLM-free render</div>
<div class="bar"><i></i></div>
<div class="grid">
 <div>
  <div class="card"><h2>Checklist — the live state</h2><ul>${chkHtml}</ul></div>
  <div class="card"><h2>Open questions</h2><ul>${qHtml}</ul></div>
  <div class="card"><h2>Spec tree</h2>${treeHtml}</div>
 </div>
 <div>
  <div class="card"><h2>Copy to the right-side LLM</h2>
   <button onclick="cp()">📋 Copy spec + tesseract state</button>
   <button class="alt" onclick="cpz()">📋 Copy drift zones only</button>
   <textarea id="pay">${esc(payload)}</textarea>
   <textarea id="zon">${esc(lens ? JSON.stringify(lens, null, 2) : '')}</textarea>
  </div>
  ${pngUri ? `<div class="card"><h2>Encircled Δ panel</h2><img class="panel" src="${pngUri}"></div>` : '<div class="card"><h2>Encircled Δ panel</h2><p class="muted">publishing — no panel on disk yet (never substituted)</p></div>'}
  <div class="card"><h2>Attracted semantic content</h2><ul>${zonesHtml}</ul></div>
  <div class="card"><h2>Out-of-lane zones</h2><div>${offHtml || '<span class="muted">none</span>'}</div></div>
 </div>
</div></div>
<script>
function copyEl(id){const t=document.getElementById(id);t.select();document.execCommand('copy');}
function cp(){copyEl('pay');event.target.textContent='✅ copied';setTimeout(()=>event.target.textContent='📋 Copy spec + tesseract state',1400);}
function cpz(){copyEl('zon');event.target.textContent='✅ copied';setTimeout(()=>event.target.textContent='📋 Copy drift zones only',1400);}
</script>`;
}

function main() {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');
  const md = readFileSync(SPEC, 'utf8');
  const txtBytes = existsSync(TXT) ? readFileSync(TXT).length : 0;
  const checklist = parseChecklist(md);
  const questions = parseOpenQuestions(md);
  const tree = parseTree(md);
  const lens = loadLens();
  const version = nextVersion();
  const payload = buildPayload({ version, checklist, questions, lens, specBytes: Buffer.byteLength(md), txtBytes });
  const stateHash = createHash('sha256').update(md + '\n' + (lens ? JSON.stringify(lens) : '')).digest('hex').slice(0, 16);
  const html = render({ version, md, checklist, questions, tree, lens, payload, stateHash });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const htmlPath = resolve(OUT_DIR, `v${version}-${stamp}.html`);
  const mdPath = resolve(OUT_DIR, `v${version}-${stamp}.md`);
  writeFileSync(htmlPath, html);
  writeFileSync(mdPath, md);           // the immutable snapshot of what v<N> actually said
  writeFileSync(resolve(OUT_DIR, 'latest.html'), html);
  writeFileSync(resolve(REPO, 'docs/specs/vna/PAYLOAD.txt'), payload);

  console.log(`VNA spec v${version} · ${checklist.filter(c=>c.done).length}/${checklist.length} checked · stateHash ${stateHash}`);
  console.log(`  html    ${htmlPath}`);
  console.log(`  md      ${mdPath}`);
  console.log(`  payload docs/specs/vna/PAYLOAD.txt (${Buffer.byteLength(payload)}B)`);
  if (!lens) console.log('  ⚠ lens receipt absent — tesseract state reported UNAVAILABLE, never substituted');
  if (!noOpen) { try { execFileSync('open', [htmlPath]); } catch (e) { console.log('  (open failed: ' + e.message + ')'); } }
  return htmlPath;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { parseChecklist, parseOpenQuestions, nextVersion };
