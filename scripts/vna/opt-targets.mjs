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

/** pure: a series → one inline svg polyline, the floor as a dashed line when given. C336d generalised this off hook-latency's
 * {p50} points to ALSO take census {value} points: a point's y is p.value when present, else p.p50 (unchanged for latency
 * callers). Scale is 0..max when every value (and the floor) is ≥ 0 — the hook-latency case — else min..max, so a negative
 * reading (a ρ, a z) does not sit pinned to the baseline; the <title> always says which scale it used. */
// C336h — trend: null (no direction to steer by, or draws unchanged) | 'better' | 'worse' | 'flat'. Only the LAST segment
// (the two most recent points — the same pair ratchet-census.mjs's deriveTrend compared) is redrawn in the trend colour, on
// top of the base line, so the sparkline still shows the whole series but the reader's eye lands on which way it just moved.
const TREND_COLOR = { better: 'var(--g)', worse: 'var(--r)', flat: 'var(--dim)' };
export function sparkline(points, { w = 220, h = 34, floor = null, label = '', trend = null } = {}) {
  if (points.length < 2) return `<span class="dim">${points.length} point${points.length === 1 ? '' : 's'} on the ledger — a line needs 2</span>`;
  const ys = points.map((p) => (p.value != null ? p.value : p.p50));
  const hasNeg = ys.some((v) => v < 0) || (floor != null && floor < 0);
  const lo = hasNeg ? Math.min(...ys, floor != null ? floor : Infinity) : 0;
  const hi = Math.max(...ys, floor != null ? floor : -Infinity) || (hasNeg ? 0 : 1);
  const span = hi - lo || 1;
  const X = (i) => ((i / (points.length - 1)) * (w - 2) + 1).toFixed(1), Y = (v) => (h - 1 - ((v - lo) / span) * (h - 2)).toFixed(1);
  const line = points.map((p, i) => `${X(i)},${Y(ys[i])}`).join(' ');
  const fl = floor != null ? `<line x1="0" x2="${w}" y1="${Y(floor)}" y2="${Y(floor)}" stroke="var(--a)" stroke-dasharray="3 3" stroke-width="1"/>` : '';
  const scale = hasNeg ? `scale min..max (${lo.toFixed(3)}..${hi.toFixed(3)})` : `scale 0..max (${hi.toFixed(3)})`;
  const trendColor = trend ? TREND_COLOR[trend] : null;
  const trendSeg = trendColor ? `<polyline class="trendseg trend-${esc(trend)}" fill="none" stroke="${trendColor}" stroke-width="2.5" points="${X(points.length - 2)},${Y(ys[points.length - 2])} ${X(points.length - 1)},${Y(ys[points.length - 1])}"/>` : '';
  return `<svg class="cogsvg optsvg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)} — ${points.length} readings, ${scale}${floor != null ? `, floor ${floor} dashed` : ''}${trend ? `, latest segment ${trend}` : ''}</title>${fl}<polyline fill="none" stroke="var(--acc)" stroke-width="1.5" points="${line}"/>${trendSeg}</svg>`;
}
// C336h — the arrow/UNSTATED badge every graphed target carries so a line can be read as better or worse (operator
// 2026-09-26: "are you steering properly - show lower is better vs higher is better"). direction_how (quoted, when present)
// rides the title so the operator can see WHY without leaving the sidebar.
export function directionBadge(r) {
  const how = r && r.direction_how ? esc(r.direction_how) : '';
  if (r && r.direction === 'higher') return `<span class="dirup" title="higher is better${how ? ` — ${how}` : ''}">↑ higher is better</span>`;
  if (r && r.direction === 'lower') return `<span class="dirdown" title="lower is better${how ? ` — ${how}` : ''}">↓ lower is better</span>`;
  if (r && r.direction === 'CONFLICT') return `<span class="dirconflict" title="direction CONFLICT${how ? ` — ${how}` : ''}">⚠ CONFLICT — UNSTATED which way is better</span>`;
  return `<span class="dim dirunstated" title="no only-rises/only-falls/max_allowed phrase found — cannot be steered by a line yet">direction UNSTATED</span>`;
}

// the census repeats one UNMEASURED reason across many targets — a list that says it N times hides the targets that have a
// reading. Measured targets get a line each; UNMEASURED ones get ONE line per distinct reason, naming their ids (C98f: a
// sentence appears once on the page). Kept for the chat's text form (C321c), which has no graph to draw.
export function groupCensus(rows) {
  const measured = [], byWhy = new Map();
  for (const r of rows) {
    const v = String((r.reading && r.reading.value) || 'UNMEASURED');
    if (/^UNMEASURED/.test(v)) { const k = v.slice(0, 120); if (!byWhy.has(k)) byWhy.set(k, []); byWhy.get(k).push(r.id); } else measured.push(r);
  }
  return { measured, unmeasured: [...byWhy].map(([why, ids]) => ({ why, ids })) };
}

// C336d — every census target either graphs or says why not, never both and never neither (the falsifier: a target with ≥2
// numeric series readings and no line on the page). "≥2 numeric series values" is series.length itself — deriveSeries in
// ratchet-census.mjs already filters out non-numeric rows, so length is the count the guard checks against, computed from
// the fixture, never typed. Below 2, the reason is deduped the same way groupCensus dedupes UNMEASURED reasons.
export function groupSeriesTargets(rows) {
  const graphed = []; const byWhy = new Map();
  for (const r of rows) {
    const series = Array.isArray(r.series) ? r.series : [];
    if (series.length >= 2) { graphed.push(r); continue; }
    const readingValue = String((r.reading && r.reading.value) || 'UNMEASURED');
    const why = /^UNMEASURED/.test(readingValue) ? readingValue.slice(0, 120) : `${series.length} reading${series.length === 1 ? '' : 's'} on its ledger — a line needs 2`;
    if (!byWhy.has(why)) byWhy.set(why, []);
    byWhy.get(why).push(r.id);
  }
  return { graphed, listed: [...byWhy].map(([why, ids]) => ({ why, ids })) };
}
// the incumbent field is a derived SENTENCE ("path=value" or several joined by " · "), never a bare number — pull the first
// numeric token out of it to draw the floor's dashed line; a row with no numeric incumbent draws no dashed line (said, never faked).
export function numericFloor(row) {
  const v = row && row.incumbent && row.incumbent.value;
  if (typeof v !== 'string') return null;
  const m = v.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
const KIND_LABEL = { file: 'floor / ledger files', 'file-by-code': 'named by a writer script', 'code-only': 'code-only (no file of its own)' };

// C336d — THE ONE RUST PIPELINE, AS AN ORDERED SEQUENCE. Verified against docs/architecture/rust-pipeline-flowchart-2026-07-23.md
// and the /steer skill's table (.claude/skills/steer/SKILL.md) on 2026-09-26 — every path below is checked onto disk by this
// file's guard (tests/vna/c336d-…), never invented. `paths` is empty only for the one step that is not a file (the prompt
// or the commit itself); every other step names the script that does the work and, where the pipeline writes one, the
// receipt it lands in.
export const RUST_FLOW = [
  { id: 'prompt', label: 'Prompt / commit', paths: [], note: 'The dictated turn, or the commit at HEAD when the walk runs per-commit — nothing to open; the next step reads it straight off git.' },
  { id: 'aperture', label: 'Aperture — what the chip may look at', paths: ['scripts/vna/aperture.mjs'], note: 'aperture.mjs drives pmu-onchip --aperture (C115) to pick which spec basins and which files-at-the-commit enter the walk. Its numbers ride inside the next two steps’ receipts, never a receipt of their own.' },
  { id: 'walk', label: 'The ballistic walk — 144×144 lattice on the chip', paths: ['.thetacog/pmu'], note: 'The pmu-onchip binary built from this crate places the aperture’s bytes on the lattice — LLM-free, re-runnable from the same commit: same bytes in, same hash out (AXIOM 0). It writes nothing of its own; cockpit.mjs is the one caller that reads its output.' },
  { id: 'panel', label: 'Encircled panel — the tolerance triptych', paths: ['scripts/pmu/triptych-render.mjs', 'scripts/pmu/annotate-regions.mjs', 'docs/pmu/annotated-tolerance.html'], note: 'triptych-render.mjs decodes the walk’s heatmap bytes into INTENT · REALITY · Δ; annotate-regions.mjs finds each coloured cluster and draws its numbered ellipse. A published commit’s panel is tracked on purpose under docs/pmu/commit-panels/.' },
  { id: 'receipts', label: 'cockpit.json + aperture-receipt.json', paths: ['scripts/vna/cockpit.mjs', 'data/vna/cockpit.json', 'scripts/vna/aperture-receipt.mjs', 'data/vna/aperture-receipt.json'], note: 'cockpit.mjs composes the walk and the panels into one receipt per turn; aperture-receipt.mjs then reads THAT file only (never a second walk) and writes S_in · F_in · κ · ω as its own inspectable receipt.' },
  { id: 'tape', label: 'Tape — the walk sealed per turn', paths: ['scripts/pmu/walk-tape-seal.mjs', '.thetacog/tape/turns.ndjson', 'scripts/vna/tape-tail.mjs'], note: 'Every sealed turn appends to the append-only tape; tape-tail.mjs reads its last few rows back for the clipboard’s semantic mass.' },
  { id: 'spec-tree', label: 'Spec tree', paths: ['scripts/vna/spec-tree.mjs', 'data/vna/spec-tree.json'], note: 'Cuts the steer file’s amendments into a typed, content-addressed Merkle tree — one root hash per spec state.' },
  { id: 'envelope', label: 'Envelope', paths: ['scripts/vna/envelope.mjs', 'data/vna/envelope.json'], note: 'Reads where the commit landed against the declared lattice and emits the two arms — move the work, move the declaration — never a gate.' },
  { id: 'census', label: 'Ratchet census', paths: ['scripts/vna/ratchet-census.mjs', 'data/vna/ratchet-census.json'], note: 'Discovers every floor, ledger and keep rule in the tracked repo and reads each one’s own ledger for its latest reading and its series — the list this pill draws below.' },
  { id: 'page', label: 'This page', paths: ['scripts/vna/opt-targets.mjs', 'scripts/vna/steer-ui.mjs'], note: 'opt-targets.mjs paints the census’s readings as sparklines; steer-ui.mjs composes this pill into the sidebar — computing nothing, reading the receipts above.' },
];
// C203 — every <details> on the page carries a stable id so a repaint can restore every open fold (OPEN_STATE_SCRIPT
// keys off the id set, never a position). C89b.11 — an id'd <details>'s <summary> becomes a control the manifest reads,
// so it needs a title too (never MISSING); each step's own note already IS its one/two-sentence tooltip (C336d.1
// requires one) — reused verbatim rather than typed twice.
/** pure: the flow array → one outer <details> with a numbered nested <details> per step, an arrow between each. */
export function renderRustFlow(flow = RUST_FLOW) {
  const step = (s, i) => `<details class="flowstep" id="flow-${esc(s.id)}"><summary title="${esc(s.note)}">${i + 1}. ${esc(s.label)}</summary><div class="flownote">${esc(s.note)}${s.paths.length ? `<br><code>${s.paths.map(esc).join('</code> · <code>')}</code>` : ''}</div></details>`;
  const seq = flow.map((s, i) => (i ? `<div class="flowarr" aria-hidden="true">↓</div>${step(s, i)}` : step(s, i))).join('');
  return `<details class="flowroot" id="flow-root"><summary title="every step of the one Rust pipeline, prompt/commit to this page — LLM-free, re-runnable from the commit; next: open a step below for its files and receipt"><b>How data moves through the Rust pipeline</b> — ${flow.length} steps, prompt/commit to this page</summary><div class="flowseq">${seq}</div></details>`;
}
const s = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

/** pure: the pill's face (one measure line) and drawer (graphs, then the census list) */
export function renderOptTargets({ census = null, latency = null, floor = null } = {}) {
  const rows = census && Array.isArray(census.rows) ? census.rows : null;
  const measuredRows = rows ? rows.filter((r) => r.reading && r.reading.value && !/^UNMEASURED/.test(String(r.reading.value))) : [];
  const hooks = latency && latency.hooks ? Object.entries(latency.hooks).sort((a, b) => (b[1].totalS || 0) - (a[1].totalS || 0)) : [];
  const worst = hooks.find(([, h]) => h.status === 'MEASURED');
  // C336h — which way is better, tallied straight off each row's own `direction` field (never recomputed here: opt-targets
  // reads receipts, ratchet-census.mjs derives them). A row with no `direction` at all (an older census, a bare fixture)
  // counts as unstated, same as an explicit 'UNSTATED' — the pill never claims to know a direction the row does not carry.
  const dirCounts = rows ? rows.reduce((acc, r) => {
    const k = r.direction === 'higher' ? 'higher' : r.direction === 'lower' ? 'lower' : r.direction === 'CONFLICT' ? 'conflict' : 'unstated';
    acc[k] += 1; return acc;
  }, { higher: 0, lower: 0, unstated: 0, conflict: 0 }) : null;
  const face = [
    rows ? `${rows.length} targets · ${measuredRows.length} with a reading · ${rows.length - measuredRows.length} UNMEASURED` : `census not run — ${CENSUS_CMD}`,
    dirCounts ? `↑ ${dirCounts.higher} · ↓ ${dirCounts.lower} · unstated ${dirCounts.unstated}${dirCounts.conflict ? ` · ⚠ ${dirCounts.conflict} conflict` : ''}` : null,
    worst ? `slowest hook ${esc(worst[0])} p50 ${s(worst[1].p50)}` : `hook latency not run — ${LATENCY_CMD}`,
  ].filter(Boolean).join(' · ');
  const graphs = !latency ? `<div class="c3l dim">hook latency not run — ${esc(LATENCY_CMD)}</div>`
    : hooks.map(([label, h]) => {
      const f = floor && floor.hooks && floor.hooks[label] ? floor.hooks[label].p50 : null;
      const pts = (latency.hourly && latency.hourly[label]) || [];
      const read = h.status === 'MEASURED' ? `p50 ${s(h.p50)} · p90 ${s(h.p90)} · n ${h.n}${f ? ` · floor ${s(f)}${h.p50 > f ? ' · over' : ''}` : ''}` : `UNMEASURED (${esc(h.why)})`;
      return `<div class="c3l"><span class="sl">${esc(label)}</span> ${sparkline(pts, { floor: f, label })} <span class="rs">${read}</span></div>`;
    }).join('');
  // C336d — every census target whose OWN ledger carries ≥2 numeric readings, as a sparkline grouped by kind; the rest
  // listed with why not (deduped by reason, same construct as groupCensus). Replaces the old flat measured/UNMEASURED text
  // list (nothing here appears twice): a graphed target's reading is printed BESIDE its line, not as a second entry below it.
  const S = rows ? groupSeriesTargets(rows) : null;
  const byKind = !S ? {} : S.graphed.reduce((acc, r) => { (acc[r.kind] ??= []).push(r); return acc; }, {});
  const targetGraphs = !S ? '' : Object.entries(byKind).map(([kind, rs]) => `<div class="c3l"><b>${esc(KIND_LABEL[kind] || kind)}</b></div>` + rs.map((r) => {
    const f = numericFloor(r);
    // C336h — every graphed line carries its ↑/↓/UNSTATED badge and its latest segment coloured by trend, so a rising or
    // falling line can be read as GOOD or BAD without opening direction_how (which still rides the title, quoted).
    return `<div class="c3l"><span class="sl">${esc(r.id)}</span> ${sparkline(r.series, { floor: f, label: r.id, trend: r.trend })} ${directionBadge(r)} <span class="rs">${esc(String(r.reading.value).slice(0, 90))}${r.reading.n != null ? ` · n ${esc(r.reading.n)}` : ''}${r.trend ? ` · trend <b class="trend-${esc(r.trend)}">${esc(r.trend)}</b>` : ''}</span></div>`;
  }).join('')).join('');
  const targetListed = !S ? '' : S.listed.map((u) => `<div class="c3l dim"><span class="sl">${u.ids.length} × ${esc(u.why)}</span> <span class="rs">${esc(u.ids.join(' · '))}</span></div>`).join('');
  // C336h — the targets that CANNOT be steered yet (direction UNSTATED), named by id with the reason, so the operator can
  // see which of the 15 graphed lines (or any other row) has no ↑/↓ to read it by, distinct from an UNMEASURED reading.
  const unstatedRows = rows ? rows.filter((r) => r.direction === 'UNSTATED') : [];
  const unstatedList = unstatedRows.length
    ? `<div class="c3l dim"><b>direction UNSTATED (C336h)</b> — ${unstatedRows.length} target${unstatedRows.length === 1 ? '' : 's'} cannot be steered by a line yet: <span class="rs">${unstatedRows.map((r) => esc(r.id)).join(' · ')}</span></div>`
    : (rows ? '<div class="c3l dim">direction UNSTATED (C336h): none — every target says which way is better</div>' : '');
  const drawer = `${renderRustFlow()}<div class="c3l"><b>hook latency</b> — what every turn pays before the model reads the prompt (hourly p50, floor dashed)</div>${graphs}<div class="c3l"><b>every census target with a series</b> — ${S ? S.graphed.length : 0} graphed of ${rows ? rows.length : 0}, grouped by kind (${esc(CENSUS_CMD)})</div>${targetGraphs}${targetListed}${unstatedList}`;
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
