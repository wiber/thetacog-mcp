// scripts/vna/opt-targets.mjs — C321b: 📈 OPTIMISATION TARGETS, the third-level pill under 📋 Copy Run Summary.
//
// WHERE IT LIVES AND WHY (operator 2026-09-25: "make all optimisation targets a sub pill of run summary with graphs (3rd
// level) - all optimisation targets need to be somewhere, is that the right place for it?"). The run summary is where a run's
// cost is read, so what each cost is trending towards sits one level under it. The copied line never carries it: 📋 copies the
// outward receipt for a team, and this pill is the instrument's own health. A pill of its own at the top would cost the page's
// sequence a slot for something read less often than the walk.
//
// WHAT IT PAINTS, computing nothing (steer-ui's rule): the ratchet census (C238a, data/vna/ratchet-census.json) is THE list —
// every floor, ratchet ledger and keep rule the code carries, discovered, never hand-typed — one line per target with its
// latest reading or UNMEASURED; hook latency (C321a, data/vna/hook-latency.json) is drawn as one sparkline per hook (hourly
// p50) beside its floor. A target with a series gets a graph; a target with only a floor gets a line; an absent receipt
// renders `not run — <command>`, never a zero.
// Guard: tests/vna/c321-optimisation-targets.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJson = (rel) => { try { return JSON.parse(readFileSync(resolve(REPO, rel), 'utf8')); } catch { return null; } };
export const CENSUS_CMD = 'node scripts/vna/ratchet-census.mjs';
export const LATENCY_CMD = 'node scripts/vna/hook-latency.mjs --ratchet';

export function loadOptTargets() {
  return { census: readJson('data/vna/ratchet-census.json'), latency: readJson('data/vna/hook-latency.json'), floor: readJson('data/vna/hook-latency-floor.json') };
}

/** pure: an hourly series → one inline svg polyline (linear, 0..max), the floor as a dashed line when given */
export function sparkline(points, { w = 220, h = 34, floor = null, label = '' } = {}) {
  const ys = points.map((p) => p.p50);
  if (points.length < 2) return `<span class="dim">${points.length} hour${points.length === 1 ? '' : 's'} on the ledger — a line needs 2</span>`;
  const max = Math.max(...ys, floor || 0) || 1;
  const X = (i) => ((i / (points.length - 1)) * (w - 2) + 1).toFixed(1), Y = (v) => (h - 1 - (v / max) * (h - 2)).toFixed(1);
  const line = points.map((p, i) => `${X(i)},${Y(p.p50)}`).join(' ');
  const fl = floor ? `<line x1="0" x2="${w}" y1="${Y(floor)}" y2="${Y(floor)}" stroke="var(--a)" stroke-dasharray="3 3" stroke-width="1"/>` : '';
  return `<svg class="cogsvg optsvg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)} — hourly p50, ${points.length} hours${floor ? `, floor ${floor} ms dashed` : ''}</title>${fl}<polyline fill="none" stroke="var(--acc)" stroke-width="1.5" points="${line}"/></svg>`;
}

// the census repeats one UNMEASURED reason across many targets — a list that says it N times hides the targets that have a
// reading. Measured targets get a line each; UNMEASURED ones get ONE line per distinct reason, naming their ids (C98f: a
// sentence appears once on the page).
export function groupCensus(rows) {
  const measured = [], byWhy = new Map();
  for (const r of rows) {
    const v = String((r.reading && r.reading.value) || 'UNMEASURED');
    if (/^UNMEASURED/.test(v)) { const k = v.slice(0, 120); if (!byWhy.has(k)) byWhy.set(k, []); byWhy.get(k).push(r.id); } else measured.push(r);
  }
  return { measured, unmeasured: [...byWhy].map(([why, ids]) => ({ why, ids })) };
}
const s = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

/** pure: the pill's face (one measure line) and drawer (graphs, then the census list) */
export function renderOptTargets({ census = null, latency = null, floor = null } = {}) {
  const rows = census && Array.isArray(census.rows) ? census.rows : null;
  const measuredRows = rows ? rows.filter((r) => r.reading && r.reading.value && !/^UNMEASURED/.test(String(r.reading.value))) : [];
  const hooks = latency && latency.hooks ? Object.entries(latency.hooks).sort((a, b) => (b[1].totalS || 0) - (a[1].totalS || 0)) : [];
  const worst = hooks.find(([, h]) => h.status === 'MEASURED');
  const face = [
    rows ? `${rows.length} targets · ${measuredRows.length} with a reading · ${rows.length - measuredRows.length} UNMEASURED` : `census not run — ${CENSUS_CMD}`,
    worst ? `slowest hook ${esc(worst[0])} p50 ${s(worst[1].p50)}` : `hook latency not run — ${LATENCY_CMD}`,
  ].join(' · ');
  const graphs = !latency ? `<div class="c3l dim">hook latency not run — ${esc(LATENCY_CMD)}</div>`
    : hooks.map(([label, h]) => {
      const f = floor && floor.hooks && floor.hooks[label] ? floor.hooks[label].p50 : null;
      const pts = (latency.hourly && latency.hourly[label]) || [];
      const read = h.status === 'MEASURED' ? `p50 ${s(h.p50)} · p90 ${s(h.p90)} · n ${h.n}${f ? ` · floor ${s(f)}${h.p50 > f ? ' · over' : ''}` : ''}` : `UNMEASURED (${esc(h.why)})`;
      return `<div class="c3l"><span class="sl">${esc(label)}</span> ${sparkline(pts, { floor: f, label })} <span class="rs">${read}</span></div>`;
    }).join('');
  const G = rows ? groupCensus(rows) : null;
  const list = !G ? '' : G.measured.map((r) => `<div class="c3l"><span class="sl">${esc(r.id)}</span> <span class="rs">${esc(String(r.reading.value).slice(0, 140))}${r.reading.n != null ? ` · n ${esc(r.reading.n)}` : ''}</span></div>`).join('')
    + G.unmeasured.map((u) => `<div class="c3l dim"><span class="sl">${u.ids.length} × ${esc(u.why)}</span> <span class="rs">${esc(u.ids.join(' · '))}</span></div>`).join('');
  const drawer = `<div class="c3l"><b>hook latency</b> — what every turn pays before the model reads the prompt (hourly p50, floor dashed)</div>${graphs}<div class="c3l"><b>every target the census found</b> — discovered from the code, never a roster (${esc(CENSUS_CMD)})</div>${list}`;
  return { face, drawer, count: rows ? rows.length : null };
}

// C321c — THE SAME TARGETS INSIDE 💬 STEER CHAT (operator 2026-09-25: "the same for all optimisation targets in steer chat (keep
// them inside steer chat)"). The chat renders text, so the graph is a unicode sparkline, one row per hook, and nothing is
// opened outside the chat: the house-menu door `opt-targets` runs this with --text and its printed lines ARE the reply.
const BARS = '▁▂▃▄▅▆▇█';
/** pure: an hourly series → a unicode sparkline, scaled 0..max */
export function textSparkline(points) {
  if (!points || points.length < 2) return `(${points ? points.length : 0} hour${points && points.length === 1 ? '' : 's'} — a line needs 2)`;
  const max = Math.max(...points.map((p) => p.p50)) || 1;
  return points.map((p) => BARS[Math.min(BARS.length - 1, Math.round((p.p50 / max) * (BARS.length - 1)))]).join('');
}
/** pure: the chat's text form of the pill — hook latency graphs first, then every census target */
export function renderOptTargetsText({ census = null, latency = null, floor = null } = {}) {
  const out = ['📈 OPTIMISATION TARGETS'];
  if (!latency) out.push(`hook latency: not run — ${LATENCY_CMD}`);
  else {
    out.push(`hook latency (last ${latency.hours}h; graph = hourly p50, oldest → newest, last 48h):`);
    for (const [label, h] of Object.entries(latency.hooks).sort((a, b) => (b[1].totalS || 0) - (a[1].totalS || 0))) {
      const f = floor && floor.hooks && floor.hooks[label] ? floor.hooks[label].p50 : null;
      const read = h.status === 'MEASURED' ? `p50 ${s(h.p50)} · p90 ${s(h.p90)} · n ${h.n}${f ? ` · floor ${s(f)}${h.p50 > f ? ' (over)' : ''}` : ''}` : `UNMEASURED (${h.why})`;
      out.push(`  ${label.padEnd(18)} ${textSparkline((latency.hourly && latency.hourly[label]) || [])}  ${read}`);
    }
  }
  const rows = census && Array.isArray(census.rows) ? census.rows : null;
  if (!rows) out.push(`census: not run — ${CENSUS_CMD}`);
  else {
    const measured = rows.filter((r) => r.reading && r.reading.value && !/^UNMEASURED/.test(String(r.reading.value)));
    out.push(`every target the census found: ${rows.length} (${measured.length} with a reading · ${rows.length - measured.length} UNMEASURED):`);
    const G = groupCensus(rows);
    for (const r of G.measured) out.push(`  ${String(r.id).padEnd(34)} ${String(r.reading.value).slice(0, 90)}${r.reading.n != null ? ` · n ${r.reading.n}` : ''}`);
    for (const u of G.unmeasured) out.push(`  ${u.ids.length} × ${u.why}\n      ${u.ids.join(' · ')}`);
  }
  return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = loadOptTargets();
  console.log(process.argv.includes('--json') ? JSON.stringify(renderOptTargets(d)) : renderOptTargetsText(d));
}
