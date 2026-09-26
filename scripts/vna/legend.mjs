#!/usr/bin/env node
// C80a — THE LEGEND IS A HEALTH METRIC PER AXIS (operator 2026-09-18: "what the rings mean is a lost opportunity — the rings
// are the 2D ShortLex in this project; translate the Merkle tree into the spec and redefine the axes with what they actually
// mean here … understanding how the 12 translate to this project, and what they map to on the tape"). Four records, no
// model: the cockpit receipt (rings_at per panel — coordinate · band · the reef's domain there), the 144-cell library (the
// sentence this project wrote for each cell), the spec tree (the rows whose pixel sits on each lane, open or ticked) and the
// flight tape (turn rows whose walk landed on each lane) and the envelope's placed commits (work: sha → coord — a commit
// row on the tape carries proofs, not a pixel; its coordinate is the envelope's). The readings are proofs: red on INTENT and on REALITY at
// a coordinate with no red on Δ ⇒ declared and performed alike, N open rows there ⇒ unfinished work, not drift; red on Δ ⇒
// drift, with the side that carries it. An LLM story about this legend is a later knock-on (RECEIPT IS LLM-FREE).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullName } from './mesh.mjs';
import { readTreeJson } from './tree-once.mjs';   // the 54 MB tree parsed once per render, shared with steer-ui

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const AXES = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export const LIBRARY = process.env.VNA_SNIPPET_LIBRARY || resolve(REPO, 'data/pmu/snippet-library-144.json');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const split = (coord) => { const [r, c] = String(coord || '').split(','); return AXES.includes(r) && AXES.includes(c) ? [r, c] : null; };
export const onLane = (coord, axis) => { const p = split(coord); return !!p && (p[0] === axis || p[1] === axis); };
const panelKey = (t) => (/^\s*Δ/.test(t) ? 'delta' : /^\s*REALITY/i.test(t) ? 'reality' : /^\s*INTENT/i.test(t) ? 'intent' : null);
const domainOf = (name) => { const m = /→\s*([^·]+)/.exec(String(name || '')); return m ? m[1].trim() : null; };
const firstSentence = (s) => { const m = /^(.+?[.!?])(\s|$)/.exec(String(s || '').trim()); return m ? m[1] : (String(s || '').trim() || null); };
const zero = () => ({ green: 0, amber: 0, red: 0 });
// C82a — FILE LINEAGE PER RING: the files under a reading are `git show --name-only --format= <sha>` over exactly the commits the
// envelope placed in that block — top three distinct paths by count (ties by name), the rest counted; a sha git cannot show is
// counted as unresolved, never guessed at. No mapping table, no heuristic, no model (C82 invariant 1).
export function filesForShas(shas, { repo = REPO, cache = FILE_CACHE } = {}) {
  const count = new Map(); let unresolved = 0;
  for (const sha of shas || []) {
    let paths = cache.get(sha);
    if (paths === undefined) { try { paths = execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch { paths = null; } cache.set(sha, paths); }
    if (!paths) { unresolved += 1; continue; }
    for (const f of new Set(paths)) count.set(f, (count.get(f) || 0) + 1);
  }
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { commits: (shas || []).length, unresolved, top: sorted.slice(0, 3).map(([path, n]) => ({ path, n })), more: Math.max(0, sorted.length - 3) };
}
const FILE_CACHE = new Map();
// C82a — THE CLAUSE IS SAID ONCE: what each reading kind proves, as a footnote under the readings; a reading line carries
// coordinate · the repo's names · counts · files and nothing else. Printed per coordinate the same proof read as an excuse.
export const FOOTNOTES = {
  drift: 'red on Δ — drift; the side named is where the red is (REALITY = performed, not declared · INTENT = declared, not performed)',
  unfinished: 'red on INTENT and on REALITY, none on Δ — declared and performed alike; the open rows there are unfinished work, not drift',
  covered: 'red on one side only, none on Δ — the other side covers it; dispersion inside the declaration or inside the work, not drift',
};
// a ring is a region of the CURRENT commit's walk: when no placed commit sits in its block over the window, the files are that
// commit's own (`own: true`), named as such — still git show, still the record; only with no cockpit commit at all is there nothing to name
const filesLine = (f) => f.commits === 0 ? 'no commit placed here this window' : f.own ? `from this commit's own walk (${f.sha}) · ${f.top.map((t) => t.path).join(', ')}${f.more ? ` +${f.more} more` : ''}` : `${f.commits} commit${f.commits === 1 ? '' : 's'} placed here${f.top.length ? ` · ${f.top.map((t) => t.path).join(', ')}${f.more ? ` +${f.more} more` : ''}` : f.unresolved ? ` · ${f.unresolved} not in this clone` : ''}`;
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

// C89b — THE TWELVE, AS THIS REPO NAMES THEM: one subsystem name per ShortLex lane, hand-declared once in
// data/vna/repo-domains.json (the paste's "C2,B1 (Packaging × Webview DOM)"), so a ring reads as a place in THIS project.
// The reef's own domain tags stay printed beside it (the axes block) so the two cannot drift apart silently.
export const SUBSYSTEMS_PATH = resolve(REPO, 'data/vna/repo-domains.json');
export function subsystemsOf(path = SUBSYSTEMS_PATH) {
  let j; try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
  return Object.fromEntries(Object.entries(j).filter(([k, v]) => /^[A-C][1-3]?$/.test(k) && v && typeof v === 'object'));
}
// C109i — THE CANONICAL TWELVE, read off the ONE source (src/app/6needs/data/axis-meta.ts: code · title · alias · pairFrame per
// block) so the drill-down carries what a lane IS (Law = Compliance ↔ Sovereignty, "bound to reality ↔ authority to bind reality")
// beside what it means HERE (repo-domains.json). Never a typed copy: a source missing any of the twelve reads UNMEASURED and no
// partial table is handed out. The parse is per block — the four fields inside one `{ … code: 'X' … }` — not a bare grep.
export const AXIS_META_PATH = resolve(REPO, 'src/app/6needs/data/axis-meta.ts');
export const CANON_ORDER = Object.freeze(['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']);
export function canonicalAxes({ path = AXIS_META_PATH } = {}) {
  let src; try { src = readFileSync(path, 'utf8'); } catch { return { state: 'UNMEASURED', why: `axis-meta not on disk — ${path}`, axes: null, path }; }
  const axes = {};
  for (const block of src.split(/\n\s*\{\s*\n/)) {
    const code = block.match(/^\s*code:\s*'([A-C][1-3]?)'/m); if (!code) continue;
    const f = (k) => { const m = block.match(new RegExp(`^\\s*${k}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm')); return m ? m[1].replace(/\\'/g, "'") : null; };
    const title = f('title'), alias = f('alias'), pairFrame = f('pairFrame');
    if (title && alias && pairFrame) axes[code[1]] = { code: code[1], title, alias, pairFrame };
  }
  const missing = CANON_ORDER.filter((c) => !axes[c]);
  if (missing.length) return { state: 'UNMEASURED', why: `axis-meta missing ${missing.join(' ')} — ${path}`, axes: null, path };
  return { state: 'MEASURED', axes, path };
}
/** the canonical name of one lane, off the source: A1 → "A1.Strategy.Law" (mesh.fullName), or the coordinate itself when unmeasured */
export function canonicalKeyLine(C) { if (!C || C.state !== 'MEASURED') return `canonical axes ${C && C.why ? 'UNMEASURED — ' + C.why : 'UNMEASURED'}`; const t = (c) => C.axes[c].title; return `A Strategy · B Tactics · C Operations — ${t('A1')} ${t('A2')} ${t('A3')} · ${t('B1')} ${t('B2')} ${t('B3')} · ${t('C1')} ${t('C2')} ${t('C3')} · ${Object.keys(C.axes).length} of ${CANON_ORDER.length} read off axis-meta.ts`; }
export function legend({ cock, tree, library, tape = [], work = [], reef = [], recent = 60, showDomains = 4, repo = REPO, subsystems = subsystemsOf(), canon = canonicalAxes() } = {}) {
  const panels = {}; for (const p of (cock && !cock.missing && Array.isArray(cock.panels)) ? cock.panels : []) { const k = panelKey(p.title); if (k) panels[k] = p; }
  const cells = library ? Object.values(library) : [];
  const cellOf = (coord) => cells.find((c) => c && c.coord === coord) || null;
  const basins = tree && tree.nodes ? Object.values(tree.nodes).filter((n) => n && n.basin && !n.retracted) : [];
  const rows = (tape || []).slice(-recent); const commits = (work || []).slice(-recent);
  const axes = AXES.map((axis) => {
    const diag = cellOf(`${axis},${axis}`);
    const mine = basins.filter((n) => n.pixel && onLane(n.pixel, axis));
    const tp = rows.filter((r) => r.kind === 'turn' && r.seed && r.seed.pixel && onLane(r.seed.pixel, axis));
    const cm = commits.filter((w) => w && w.coord && onLane(w.coord, axis));
    const rings = { intent: zero(), reality: zero(), delta: zero() }; const domains = new Set();
    for (const k of Object.keys(rings)) for (const r of (panels[k] && panels[k].rings_at) || []) if (onLane(r.coord, axis)) { rings[k][r.band] = (rings[k][r.band] || 0) + 1; const d = domainOf(r.name); if (d) domains.add(d); }
    // THE NAME HERE (operator: 'it's not Strategy.Fund — that is what we rename for this project; the Merkle tree adds top-level
    // redefinitions'): the reef's domains whose coordinate sits on this lane, in the reef's order — the repo's own map, never invented
    const here = (reef || []).filter((d) => d && d.coord && onLane(d.coord, axis)).map((d) => d.domain);
    return { axis, name: fullName(`${axis},${axis}`).split(' × ')[0], nameHere: { shown: here.slice(0, showDomains), more: Math.max(0, here.length - showDomains) }, sentence: diag ? firstSentence(diag.snippet) : null, domains: [...domains],
      rows: { open: mine.filter((n) => !(n.meta && n.meta.done)).map((n) => n.meta.label), ticked: mine.filter((n) => n.meta && n.meta.done).map((n) => n.meta.label) },
      tape: { commits: cm.length, turns: tp.length, last: [...tp.map((r) => r.ts), ...cm.map((w) => w.at || w.ts)].filter(Boolean).sort().pop() || null }, rings };
  });
  // THE READINGS — proofs over the receipt and the tree, nothing else; the lanes named as this repo names them (the coordinate stays the address)
  const laneName = (ax) => { const a = axes.find((x) => x.axis === ax); const s = a && a.nameHere.shown.slice(0, 2).join('·'); return s || (a ? a.name : ax); };
  const here = (coord) => { const p = split(coord); return p ? `${laneName(p[0])} × ${laneName(p[1])}` : fullName(coord); };
  // dual-canonical (C89b): the coordinate stays the address; the parentheses carry the repo's subsystem names for both lanes
  const subName = (ax) => (subsystems && subsystems[ax] && subsystems[ax].subsystem) || laneName(ax);
  const sub = (coord) => { const p = split(coord); return p ? `${subName(p[0])} × ${subName(p[1])}` : fullName(coord); };
  const line = (coord, files, kind) => `${coord} · ${fullName(coord)} (${sub(coord)}) ──► git: ${filesLine(files)} (${kind})`;   // C109i: the canonical pair, then the pair as this repo names it
  const bandAt = (k, coord) => { const r = ((panels[k] && panels[k].rings_at) || []).find((x) => x.coord === coord); return r ? r.band : null; };
  const coords = new Set(); for (const k of ['intent', 'reality', 'delta']) for (const r of (panels[k] && panels[k].rings_at) || []) if (r.coord) coords.add(r.coord);
  const readings = [];
  const own = cock && !cock.missing && cock.commit ? String(cock.commit) : null;
  const filesAt = (coord) => { const shas = commits.filter((w) => w && w.coord === coord).map((w) => w.sha); if (shas.length || !own) return filesForShas(shas, { repo }); const f = filesForShas([own], { repo }); return f.unresolved ? { ...f, commits: 0, own: false } : { ...f, own: true, sha: own.slice(0, 10) }; };
  for (const coord of coords) {
    const i = bandAt('intent', coord), re = bandAt('reality', coord), d = bandAt('delta', coord);
    const files = filesAt(coord);
    if (d === 'red') { const side = re === 'red' && i !== 'red' ? 'REALITY' : i === 'red' && re !== 'red' ? 'INTENT' : re === 'red' && i === 'red' ? 'BOTH' : (re ? 'REALITY' : i ? 'INTENT' : 'NEITHER'); readings.push({ kind: 'drift', coord, side, files, subsystems: sub(coord), reef: here(coord), text: line(coord, files, `drift on ${side}`) }); continue; }
    const open = basins.filter((n) => n.pixel === coord && !(n.meta && n.meta.done)).map((n) => n.meta.label);
    if (i === 'red' && re === 'red') { readings.push({ kind: 'unfinished', coord, openRows: open, files, subsystems: sub(coord), reef: here(coord), text: line(coord, files, `unfinished · ${open.length} open row${open.length === 1 ? '' : 's'}${open.length ? ` (${open.join(' ')})` : ' (no declared row on that cell)'}`) }); continue; }
    // one side red, Δ quiet: the other side covers it — dispersion inside the declaration (or inside the work), not drift
    if (i === 'red' || re === 'red') readings.push({ kind: 'covered', coord, side: re === 'red' ? 'REALITY' : 'INTENT', openRows: open, files, subsystems: sub(coord), reef: here(coord), text: line(coord, files, `covered, red on ${re === 'red' ? 'REALITY' : 'INTENT'} only · ${open.length} open row${open.length === 1 ? '' : 's'}${open.length ? ` (${open.join(' ')})` : ''}`) });
  }
  const named = {}; for (const k of Object.keys(panels)) named[k] = { named: (panels[k].rings_at || []).length, rings: panels[k].rings ?? null };
  for (const a of axes) { const c = canon && canon.state === 'MEASURED' ? canon.axes[a.axis] : null; a.canon = c ? { title: c.title, alias: c.alias, pairFrame: c.pairFrame } : null; a.here = subsystems && subsystems[a.axis] ? subsystems[a.axis].subsystem : null; }   // C109i
  return { axes, canon: canon ? { state: canon.state, why: canon.why || null, key: canonicalKeyLine(canon) } : null, readings, named, unplaced: { rows: basins.filter((n) => !n.pixel).length, tape: rows.filter((r) => r.kind === 'turn' && !(r.seed && r.seed.pixel)).length + commits.filter((w) => !(w && w.coord)).length }, at: cock && cock.generatedAt || null, commit: cock && cock.commit || null };
}

// C150c (operator 2026-09-21: "the action is the category, so we can expand shortlex canonicals too"): a canonical row is a line like a
// pill — its + (painted last in the DOM, CSS order:-1 puts it first and sticky at 0), its lead `<b class="lead">axis · canonical title</b>`
// sticky beside it, the metrics scrolling under; the pair frame, the sentence and the open rows fold under the +. One lead per line.
export function renderLegend(L) {
  const bands = (b) => `<span class="g">${b.green}</span>·<span class="a">${b.amber}</span>·<span class="r">${b.red}</span>`;
  const order = { drift: 0, unfinished: 1, covered: 2 }; const sorted = [...L.readings].sort((a, b) => order[a.kind] - order[b.kind]);
  const kinds = [...new Set(sorted.map((r) => r.kind))].sort((a, b) => order[a] - order[b]);
  const fn = kinds.length ? `<div class="ml dim fn">${kinds.map((k) => `${k === 'unfinished' ? '🟧' : k === 'covered' ? '🟨' : '🟥'} ${esc(FOOTNOTES[k])}`).join(' · ')}</div>` : '';
  const read = sorted.length ? sorted.slice(0, 3).map((r) => `<div class="ml lr ${r.kind}">${r.kind === 'unfinished' ? '🟧' : r.kind === 'covered' ? '🟨' : '🟥'} ${esc(r.text)}</div>`).join('') + (sorted.length > 3 ? `<div class="ml dim">+${sorted.length - 3} more — node scripts/vna/legend.mjs</div>` : '') + fn : '<div class="ml dim">no red ring on any panel — nothing to prove this run</div>';
  const named = Object.entries(L.named).filter(([, v]) => v.rings != null && v.named < v.rings).map(([k, v]) => `${k.toUpperCase()} ${v.named} of ${v.rings} rings named`).join(' · ');
  const axes = L.axes.map((a) => `<div class="lx" data-axis="${esc(a.axis)}" title="${esc(a.canon ? `${a.canon.title} — ${a.canon.pairFrame} (canonical, axis-meta.ts) · ` : '')}${esc(a.sentence || 'no sentence for this cell in the library')}"><b class="lead">${esc(a.axis)}${a.canon ? ` <b class="cn">${esc(a.canon.title)}</b>` : ''}</b> ${a.canon ? `· ${esc(a.canon.alias)} · <span class="dim">${esc(a.name)}</span> · here: ` : `<span class="dim">${esc(a.name)}</span> · here: `}${a.here ? `<b class="nh">${esc(a.here)}</b>` : ''}${a.nameHere.shown.length ? ` <span class="dim">(${esc(a.nameHere.shown.join(' · '))}${a.nameHere.more ? ` +${a.nameHere.more}` : ''})</span>` : a.here ? '' : '<b class="nh dim">—</b>'} · rows ${a.rows.open.length ? `open ${esc(a.rows.open.join(' '))}` : 'none open'}${a.rows.ticked.length ? ` · ✓${a.rows.ticked.length}` : ''} · ${a.tape.commits}c · ${a.tape.turns}t · I ${bands(a.rings.intent)} R ${bands(a.rings.reality)} Δ ${bands(a.rings.delta)}${`<details class="plus lxp" id="lxp-${String(a.axis).replace(/[^A-Za-z0-9]+/g, "-")}"><summary title="the canonical row, expanded — the pair frame, the cell's sentence, every open row (C150c: the lead floats, the row folds)">+</summary><div class="mrb">${a.canon ? `<span class="c3l"><b>${esc(a.canon.title)}</b> — ${esc(a.canon.pairFrame)}</span>` : ''}<span class="c3l dim">${esc(a.sentence || 'no sentence for this cell in the library')}</span>${a.rows.open.length ? `<span class="c3l">open rows · ${esc(a.rows.open.join(' · '))}</span>` : ''}${a.rows.ticked.length ? `<span class="c3l dim">ticked · ${a.rows.ticked.length}</span>` : ''}</div></details>`}</div>`).join('');
  // C150c: the canonical row's own rule rides with the rows it shapes (steer-ui.mjs's PAGE_CSS already floats `.lx>b:first-child` — the lead — beside the + column): the row is a nowrap flex line, its + first (order:-1, sticky at 0 by details.plus), an open + wraps its drawer under the line
  const css = '<style>.lx{display:flex;flex-wrap:nowrap;align-items:center;gap:4px 6px;white-space:nowrap;overflow:visible;text-overflow:clip;width:max-content;min-width:100%}.lx>details.plus{order:-1}.lx>details.plus[open]{flex:1 0 100%}.lx:has(details.plus[open]){flex-wrap:wrap;width:auto}.lx>b.lead{background:var(--bg,#0a0c10);padding:0 4px 0 2px}</style>';
  return `${css}<div class="legend"><div class="ml"><b>THE READINGS</b> <span class="dim">— proofs over the receipt and the tree${named ? ` · ${esc(named)}` : ''}</span></div>${read}<div class="ml"><b>THE TWELVE, AS THIS REPO NAMES THEM</b> <span class="dim">— the canonical lane (title · alias — pair frame, off src/app/6needs/data/axis-meta.ts) · here: the subsystem this repo declared for it (the reef's domains) · rows on the lane · commits/turns · rings I R Δ; hover a line for the cell's sentence</span></div><div class="ml dim canon-key" title="C109i — the canonical ShortLex twelve: three horizons, nine lanes, read off the one source; the coordinate stays the address">${esc(L.canon ? L.canon.key : 'canonical axes UNMEASURED')}</div>${axes}</div>`;
}

export function legendLive({ cockPath = resolve(REPO, 'data/vna/cockpit.json'), treePath = resolve(REPO, 'data/vna/spec-tree.json'), libraryPath = LIBRARY, tapePath = resolve(REPO, 'data/vna/flight-tape.ndjson'), envelopePath = resolve(REPO, 'data/vna/envelope.json'), reefPath = resolve(REPO, 'data/pmu/lens-reef.json') } = {}) {
  const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const env = J(envelopePath); const reefJ = J(reefPath);
  return legend({ cock: J(cockPath), tree: (() => { try { return readTreeJson(treePath); } catch { return null; } })(), library: J(libraryPath), tape: nd(tapePath), work: (env && env.work) || [], reef: (reefJ && reefJ.domains) || [] });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const L = legendLive();
  if (process.argv.includes('--json')) console.log(JSON.stringify(L, null, 1));
  else { for (const r of L.readings) console.log(`  ${r.kind === 'unfinished' ? '🟧' : r.kind === 'covered' ? '🟨' : '🟥'} ${r.text}`); for (const a of L.axes) console.log(`  ${a.axis.padEnd(2)} ${(a.nameHere.shown.join(' · ') || '—').padEnd(48).slice(0, 48)} rows open ${a.rows.open.length} ticked ${a.rows.ticked.length} · tape ${a.tape.commits}c/${a.tape.turns}t · I ${a.rings.intent.red}r R ${a.rings.reality.red}r Δ ${a.rings.delta.red}r · ${a.domains.join(', ') || '—'}`); }
}
