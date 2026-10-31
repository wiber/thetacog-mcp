#!/usr/bin/env node
// scripts/vna/drift-note.mjs — C610g: THE PRE-RUN DRIFT NOTE. WALK ONCE BEFORE THE WORK, SNOWBALL FROM THE REDS, HAND THE RULES
// TO THE BUILDER. LLM-FREE.
//
// Operator 2026-10-03: "you run it once you find where the reds are … the snowballs starting from the red panel section … gives you
// the associations to what's there … feedback into the LLM even before the work begins … it's the pre-run … a mini commit in the
// beginning". So, at dispatch and before the worker wakes:
//   1 THE Δ WALK — the row's declaration (intent) against the files it names at HEAD (reality), through the ONE panel door
//     (scripts/pmu/panel-door.mjs panel(), the same door cockpit.mjs reaches its Δ through). Never a second walk.
//   2 THE REDS — the Δ panel's drift regions (kind 3, the same kind annotate-regions.mjs calls drift), expanded over their blockBox
//     to ShortLex cells (shortlex-coords.mjs blockToShortLex — the names every other surface uses).
//   3 LOCALISED — C610c's localise() (forecast-localise.mjs) with the red cells as a single-ingress forecast: K = 1, spread 0, so
//     every red cell reads CONSENSUS by construction and the note says so. Rows · files:spans · words come back with evidence.
//   4 THE RETRO SNOWBALL — C582's retroGrow (retro-snowball.mjs, one home), seeded from the rows the red zones name (their text is
//     the prompt, the red cells are the ask's shape), so it returns the neighbouring rows that live there: the rules.
//   5 THE NOTE — "drifting now at <zones> → <files> · rows <ids> · rules <ids>". Written to a sidecar beside the brief ALWAYS; put
//     INTO the brief only when the Δ walk is admissible, labelled CURRENT DRIFT, never a forecast. An inadmissible walk leaves the
//     brief byte-identical (withDriftNote).
//
// ADMISSIBLE means the door's own verdict: meta.admissible === true (both sides over the canonical gzip mass floor, the sensor in
// band) and the panel was not refused on the lit-mass rung. Anything else is UNMEASURED, and an UNMEASURED reading never reaches
// the worker as if it were evidence.
//
// SUFFICIENT FOR: where the declaration and the repo already disagree before any work, and which rows and rules live there.
// NOT SUFFICIENT FOR: whether the work will drift, or whether it was good (Rice). It is information for the builder, never a gate:
// nothing here can stop a dispatch, and the note carries no gate word (the guard reads it).
//
// Rust port row: none — this file decides nothing of its own (the door decides admissibility, the localiser classifies, the
// snowball stops itself) and holds no mass; it is orchestration, which stays node under MAXIMISE RUST.
//
// C610n — THE STAGE PROFILE: every note carries profile.stages (ms per stage: targets · read · tree · walker · aperture · door · localise
// · snowball) and profile.total_ms, written into the sidecar's receipt, so "where did the pre-run time go" is read off the record, never
// guessed. The first profile (2026-10-03) put ~70 % of a dispatch's pre-run in briefTargets → code-slot.mjs's per-term git greps (fixed
// there: one read of the tree), not in the walks. The note's text never depends on the profile.
//
// C610m — A NOTE THAT LIGHTS EVERYTHING SAYS NOTHING. The first live note (b7aa1c2526) lit all 9 block zones and named 13 rows: no
// localisation at all. So every admissible note states its COVERAGE on its first line (red cells ÷ the 144 lattice cells, zones lit ÷ 9,
// and the sensor arm the door walked — 'claim' until C610k's arm reports its own name on the door's meta). Above DIFFUSE_ZONES zones the
// note is DIFFUSE and reaches the brief as ONE line with no row list; the zone detail goes to the sidecar only (note.detail). Otherwise
// the brief carries the top BRIEF_ZONES zones by red mass (cells), each with at most BRIEF_ROWS rows. Sufficient for: whether the note
// localises. Not for: whether the localisation is right (C610f).
//
// @guard tests/vna/c610g-the-pre-run-drift-note.test.mjs
// @guard tests/vna/c610n-the-pre-run-walk-is-fast.test.mjs
// @guard tests/vna/c610m-a-note-that-lights-everything-says-nothing.test.mjs
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { blockToShortLex } from '../pmu/shortlex-coords.mjs';
import { localise } from './forecast-localise.mjs';
import { retroGrow, rowsOf, RETRO_TAU } from './retro-snowball.mjs';
import { briefForecast } from './brief-forecast.mjs';   // C610e: the forecast rides the brief only when its hit rate reads MEASURED; the sidecar always

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LABEL = 'CURRENT DRIFT';
export const GATE_WORDS = /\b(block|blocks|blocked|blocking|abort|aborts|aborted|prevent|prevents|prevented|reject|rejects|rejected)\b/i;
export const SUFFICIENT_FOR = 'where the declaration and the repo already disagree before any work, and which rows and rules live there';
export const NOT_SUFFICIENT_FOR = 'whether the work will drift, or whether it was good (Rice)';
const DRIFT_KIND = 3;   // annotate-regions.mjs: r.kind === 3 is drift (the red ring)
export const LATTICE_CELLS = 144;   // the 12×12 block lattice the red cells are named on (blockToShortLex)
export const ZONES_TOTAL = 9;       // the 3×3 block zones (forecast-localise.mjs blockOf: each coordinate with its digits dropped)
export const DIFFUSE_ZONES = 4;     // more zones lit than this → DIFFUSE: no zone stands out (C610m)
export const BRIEF_ZONES = 3, BRIEF_ROWS = 3;
const zoneOf = (cell) => String(cell).split(',').map((x) => x.trim().replace(/\d+$/, '')).join('×');   // forecast-localise.mjs blockOf, the same rule
/** C610m: how much of the lattice the reds cover — pure over the red cells and the door's meta */
export function coverageOf(red = [], meta = {}) {
  const zones = new Set(red.map(zoneOf));
  return { red_cells: red.length, lattice_cells: LATTICE_CELLS, cell_pct: Math.round(100 * red.length / LATTICE_CELLS), zones_lit: zones.size, zones_total: ZONES_TOTAL,
    diffuse: zones.size > DIFFUSE_ZONES, bound: `zones > ${DIFFUSE_ZONES} of ${ZONES_TOTAL}`, sensor: (meta && meta.sensor) || 'claim' };
}
export const coverageLine = (c) => `coverage ${c.red_cells}/${c.lattice_cells} cells (${c.cell_pct} %) · ${c.zones_lit}/${c.zones_total} zones lit · sensor ${c.sensor}`;
export const DIFFUSE_LINE = 'DIFFUSE: current drift is diffuse at this aperture — no zone stands out (the zone detail is in the sidecar, not here)';

/** The Δ panel's red cells: every block inside a drift region's blockBox, as ShortLex coords; a region with no box gives its centre. */
export function redCellsOf(regions = []) {
  const out = new Set();
  for (const r of regions || []) {
    if (!r || r.kind !== DRIFT_KIND) continue;
    const b = r.blockBox;
    if (b && [b.r0, b.r1, b.c0, b.c1].every(Number.isFinite)) {
      for (let i = b.r0; i <= b.r1; i++) for (let j = b.c0; j <= b.c1; j++) out.add(blockToShortLex(i, j));
    } else if (r.center || (r.coord && r.coord.center)) out.add(r.center || r.coord.center);
  }
  return [...out];
}

/** The door's verdict, read — never re-derived. */
export function deltaAdmissible(door) {
  if (!door) return { admissible: false, why: 'the door returned nothing' };
  if (door.unmeasured) return { admissible: false, why: `the door: ${door.unmeasured}` };
  const m = door.meta || {};
  if (!door.png) return { admissible: false, why: 'the door rendered no panel' };
  if (m.refused) return { admissible: false, why: `the panel refused: ${m.refusal || 'lit-mass rung'}` };
  if (m.admissible !== true) return { admissible: false, why: m.notAdmissible || m.unmeasured || 'the door did not admit the reading' };
  return { admissible: true, why: null };
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
/** C610n: a stage clock — lap(name) records the ms since the last lap; done() is the profile the sidecar carries */
export function stageClock(seed = {}) {
  const stages = { ...seed }; let t = performance.now(); const t0 = t;
  return { lap(name) { const now = performance.now(); stages[name] = +((stages[name] || 0) + (now - t)).toFixed(1); t = now; },
    done() { const total = +(Object.values(seed).reduce((a, x) => a + (Number(x) || 0), 0) + performance.now() - t0).toFixed(1); return { stages: { ...stages }, total_ms: total }; } };
}

/**
 * driftNote — the pre-run note for one row. Pure over its inputs except the injected door and walker.
 *   label, intent (the row's declaration), files [{ path, text, cells? }] (the files it names, read at HEAD), reality (optional;
 *   defaults to the files' texts joined), tree or rows (the spec tree the snowball grows over), panelFn (the one door),
 *   walk (text → {pixel, cells}, for the snowball and for any file without its own cells), retroGrowFn, apertureVersion.
 */
export async function driftNote({ label, intent, files = [], reality = null, tree = null, rows = null, panelFn = null, walk = null, retroGrowFn = retroGrow, apertureVersion = null, head = null, lib = undefined, clock = null } = {}) {
  const at = new Date().toISOString();
  const ck = clock || stageClock(); const fin = (note) => ({ ...note, profile: ck.done() });   // C610n
  const base = { v: 1, at, label, head, kind: 'pre-run Δ walk (C610g)', engine: 'panel-door.mjs Δ → forecast-localise.mjs → retro-snowball.mjs; zero LLM', sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR };
  const realityText = reality != null ? String(reality) : files.map((f) => `// ${f.path}\n${f.text || ''}`).join('\n\n');
  if (!panelFn) { const m = await import('../pmu/panel-door.mjs'); panelFn = m.panel; }
  let door = null;
  try { door = await panelFn({ intent: String(intent || ''), reality: realityText, message: String(intent || ''), label: `pre-run ${label}` }); }
  catch (e) { door = { unmeasured: `the door threw: ${String(e && e.message || e).slice(0, 160)}` }; }
  ck.lap('door');
  const adm = deltaAdmissible(door);
  const red = redCellsOf(door && door.regions);
  const meta = (door && door.meta) || {};
  const reading = { admissible: adm.admissible, why: adm.why, red_cells: red, off_pct: meta.offPct ?? null, intent_gzip: meta.intentGzip ?? null, reality_gzip: meta.realityGzip ?? null, mass_floor: meta.massFloor ?? null };
  if (!adm.admissible) {
    return fin({ ...base, ...reading, zones: [], rows: [], rules: [], files: [],
      text: `${LABEL} — UNMEASURED for ${label}: the pre-run Δ walk was not admissible (${adm.why}). Nothing from this walk is in the brief; a reading the door did not admit is length, not meaning.` });
  }
  if (!red.length) {
    return fin({ ...base, ...reading, coverage: coverageOf(red, meta), diffuse: false, zones: [], rows: [], rules: [], files: [],
      text: `${LABEL} (pre-run Δ walk, ${label}${head ? ` at ${String(head).slice(0, 10)}` : ''}): no red cells — the declaration and the files it names agree everywhere the walk reached. Sufficient for: ${SUFFICIENT_FOR}. Not for: ${NOT_SUFFICIENT_FOR}.` });
  }

  // 3 — localise the reds: a single-ingress forecast (K = 1, spread 0 ⇒ every red cell reads CONSENSUS)
  const R = rows || rowsOf(tree);
  const forecast = { label: `pre-run-${label}`, aperture_version: apertureVersion, candidate: String(intent || ''), ingress: { rule: 'pre-run Δ red cells', K: 1 },
    mean: Object.fromEntries(red.map((c) => [c, 1])), spread: Object.fromEntries(red.map((c) => [c, 0])) };
  const fIn = files.map((f) => {
    const t = String(f.text || ''); const n = t.split('\n').length;
    return { path: f.path, spans: [{ bytes: [0, Buffer.byteLength(t)], lines: [[1, n]], chunk_sha: sha(t), ...(Array.isArray(f.cells) ? { cells: f.cells } : {}) }], _text: t };
  });
  const byPath = new Map(fIn.map((f) => [f.path, f._text]));
  const walkSpan = walk ? (path) => { const w = walk(byPath.get(path) || '') || {}; return w.pixel ? (w.cells || []) : null; } : null;
  const loc = await localise({ forecast, rows: R, fIn: fIn.map(({ _text, ...f }) => f), walkSpan, lib });
  ck.lap('localise');
  if (loc.refused) {
    return fin({ ...base, ...reading, admissible: false, why: `the localiser refused: ${loc.why}`, zones: [], rows: [], rules: [], files: [],
      text: `${LABEL} — UNMEASURED for ${label}: the localiser could not place the red cells (${loc.why}).` });
  }
  const zoneRows = [...new Set(loc.zones.flatMap((z) => z.rows.map((r) => r.id)))];
  const zoneFiles = [...new Set(loc.zones.flatMap((z) => z.files.map((f) => f.path)))];

  // 4 — the retro snowball, seeded from the rows the red zones name, shaped by the red cells
  let rules = [], snowball = null;
  if (zoneRows.length && walk) {
    const byId = Object.fromEntries(R.map((r) => [r.id, r]));
    const seed = zoneRows.map((id) => (byId[id] && byId[id].text) || '').join('\n');
    try {
      const g = await retroGrowFn(tree, seed, { walk, askCells: red, rows: R, tau: RETRO_TAU });
      snowball = { set: g.set || [], stop: g.stop ? g.stop.why : null, overlap: g.overlap ?? null };
      rules = (g.set || []).filter((id) => !zoneRows.includes(id));
    } catch (e) { snowball = { error: String(e && e.message || e).slice(0, 120) }; }
  } else snowball = { skipped: zoneRows.length ? 'no walker for the snowball' : 'no row overlaps a red zone' };
  ck.lap('snowball');
  const reefs = [...new Set(((door && door.regions) || []).filter((r) => r && r.kind === DRIFT_KIND).map((r) => (r.reef && r.reef.name) || r.name).filter(Boolean))];

  // C610m — coverage first; the brief carries one DIFFUSE line, or the top zones by red mass with their top rows
  const cov = coverageOf(red, meta);
  const head0 = `${LABEL} (pre-run Δ walk, ${label}${head ? ` at ${String(head).slice(0, 10)}` : ''}, aperture ${apertureVersion}) — ${coverageLine(cov)}`;
  const block = (zs, maxRows) => {
    const zr = zs.map((z) => ({ ...z, rows: z.rows.slice(0, maxRows) }));
    const rws = [...new Set(zr.flatMap((z) => z.rows.map((r) => r.id)))], fls = [...new Set(zr.flatMap((z) => z.files.map((f) => f.path)))];
    const zoneStr = zr.map((z) => `${z.coord} (${z.cells.length} cell${z.cells.length === 1 ? '' : 's'})`).join(', ');
    return [
      `${head0} — drifting now at ${zoneStr} → ${fls.length ? fls.join(', ') : 'no named file lit a red cell'} · rows ${rws.length ? rws.join(',') : '—'} · rules ${rules.length ? rules.join(',') : '—'}`,
      ...zr.map((z) => `  ${z.coord}: rows ${z.rows.length ? z.rows.map((r) => `${r.id}[${r.lit.join(' ')}]`).join(' ') : '—'} · files ${z.files.length ? z.files.map((f) => f.path).join(' ') : '—'} · words ${z.words.terms.length ? z.words.terms.join(',') : '—'}`),
      ...(reefs.length ? [`  the red rings' reefs: ${reefs.join(' · ')}`] : []),
      `  How is that happening, and why there? This is where the declaration and the repo already disagree, read before any work; it is information for you, not an instruction. Single ingress (K = 1, spread 0): every red cell reads as consensus by construction. Not a forecast — not for ${NOT_SUFFICIENT_FOR}.`,
    ].join('\n');
  };
  const byMass = loc.zones.map((z, i) => [z, i]).sort((a, b) => (b[0].cells.length - a[0].cells.length) || (a[1] - b[1])).map(([z]) => z);
  const detail = block(loc.zones, Infinity);   // every zone, every row the localiser returned — the sidecar's
  const briefZones = cov.diffuse ? [] : byMass.slice(0, BRIEF_ZONES);
  const text = cov.diffuse ? `${head0} — ${DIFFUSE_LINE}.` : block(briefZones, BRIEF_ROWS);
  return fin({ ...base, ...reading, coverage: cov, diffuse: cov.diffuse, brief_zones: briefZones.map((z) => z.coord),
    zones: loc.zones.map((z) => ({ coord: z.coord, cells: z.cells, rows: z.rows.map((r) => ({ id: r.id, lit: r.lit })), files: z.files.map((f) => f.path), words: z.words.terms })),
    rows: zoneRows, rules, files: zoneFiles, reefs, snowball, text, detail });
}

/** The brief, with the note appended ONLY when the Δ walk was admissible; otherwise the very same string. */
export function withDriftNote(brief, note) {
  // C610e: the forecast block follows the note ONLY when its gate read MEASURED (note.forecast.in_brief); otherwise not one byte changes
  const fc = note && note.forecast && note.forecast.in_brief === true && note.forecast.block ? `\n\n${note.forecast.block}` : '';
  if (!note || note.admissible !== true || !note.text) return `${brief}${fc}`;
  return `${brief}\n\n${note.text}${fc}`;
}

/** The sidecar beside the brief — always written, admissible or not. */
export function driftNotePath({ dir, label, n = null }) { return join(dir, `${n != null ? `${n}-` : ''}${label}.drift-note.txt`); }
export function writeDriftNote(note, { dir, label = note && note.label, n = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const p = driftNotePath({ dir, label, n });
  const { text, detail, ...rest } = note || {};
  writeFileSync(p, `${text || `${LABEL} — UNMEASURED for ${label}: no note was produced`}\n\n${detail && detail !== text ? `--- zone detail (sidecar only — C610m) ---\n${detail}\n\n` : ''}--- receipt ---\n${JSON.stringify(rest, null, 2)}\n`);
  return p;
}

/** The live door the runner calls: read the row, read its files AT HEAD (W3 — the immutable commit), walk, localise, snowball. */
export async function preRunDriftNote({ repo = REPO, specPath, label, files = [], head = null, panelFn = null, walk = null, tree = null, apertureVersion = null, stageMs = {} } = {}) {
  const ck = stageClock(stageMs);   // C610n: stageMs carries a stage the caller timed before this call (the runner's briefTargets → 'targets')
  const row = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '').trim();
  const h = head || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(); } catch { return null; } })();
  const read = [];
  for (const p of files) { try { read.push({ path: p, text: execFileSync('git', ['show', `${h || 'HEAD'}:${p}`], { cwd: repo, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') }); } catch { /* not at HEAD (the guard the worker will create) */ } }
  ck.lap('read');
  // C612b2: the tree's rows come from the --door-serve daemon, which holds them at the tree's root and re-reads only when the root moves;
  // absent crate (or PMU_DOOR_CRATE=0) → the whole tree in node, as before.
  let rows = null;
  if (!tree) { const { treeRows } = await import('./door-crate.mjs'); rows = await treeRows(); if (!rows) { const ST = await import('./spec-tree.mjs'); tree = ST.readTree(ST.TREE, { text: true }); } }
  ck.lap('tree');
  if (!walk) { const SR = await import('./snowball-refresh.mjs'); walk = SR.probeWalker(); }
  ck.lap('walker');
  if (!apertureVersion) { try { apertureVersion = (await import('../pmu/prompt-lens.mjs')).apertureVersion(); } catch { apertureVersion = null; } }
  ck.lap('aperture');
  const intent = row.replace(/^\s*-\s*\[[ xX]\]\s*/, '');
  if (!read.length) return { v: 1, at: new Date().toISOString(), label, head: h, admissible: false, why: 'the row names no file that exists at HEAD — no reality to walk', red_cells: [], zones: [], rows: [], rules: [], files: [], sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR, text: `${LABEL} — UNMEASURED for ${label}: the row names no file that exists at HEAD, so there is no reality to walk its declaration against.`, profile: ck.done() };
  return driftNote({ label, intent, files: read, tree, rows, panelFn, walk, apertureVersion, head: h, clock: ck });
}

// ── C612a — THE NOTE NEVER BLOCKS THE ROUND. The runner used to await the whole note above (median 21.4 s, C610n af6a784076) before
// the worker spawned; that wait was the pause. Now the note comes in two tiers:
//   FAST TIER (fastDriftNote / preRunFastNote) — the walk of the row's declaration (one lensWalk, the crate's walk) + localise over
//     the files it names + the rules bound to those paths (rules-for.mjs). No door. Awaited; it rides in the brief, always — when it
//     could not place anything it says UNMEASURED in one line, never a value.
//   SLOW TIER (startDoorTier) — the Δ door panel (preRunDriftNote → panel-door.mjs → composeEncircledPanel), STARTED beside the worker
//     and never awaited before the spawn; it lands as the sidecar <n>-<label>.drift-note.txt. The close line reads it with doorLine():
//     a sidecar that is absent reads `door: not run`, never a zero. REVISED 2026-10-03: the door is never close-line-only — when it
//     lands it also APPENDS one line (kind 'door') to the round sidecar <n>-<label>.round.ndjson (the same stem C612g's
//     conscience-watch.mjs appends its re-reads to), and the brief names that path, so the worker reads the door mid-round.
// Sufficient for: the worker never waits on the door. Not for: whether the note is right (C612c).
// Rust port row: none — this block is orchestration (start, await, write, read back); the walk is already the crate's, and the door's
// compose moving into pmu-onchip is C612b's row.
// @guard tests/vna/c612a-the-note-never-blocks-the-round.test.mjs
export const FAST_LABEL = 'CURRENT DRIFT — FAST TIER';
export const DOOR_NOT_RUN = 'door: not run';
/** The round sidecar the worker reads mid-round (C612g appends its re-reads to the same file). */
import { roundSidecarPath } from './round-sidecar.mjs';   // C612i: the one home moved to a module a per-write hook can load without this walk library
export { roundSidecarPath };
/** The one sentence the brief carries so the worker can read the door mid-round. */
export const roundPointer = (p) => `the Δ door panel streams into ${p} when it lands (one ndjson line, kind door) — read it mid-round: tail -n 5 ${p}`;
const FAST_MAX_RULES = 8;

/** The rules bound to the named paths, condensed: own-header files, CLAUDE.md sections, @guard paths. Pure over rulesFor()'s shape. */
export function rulesOfPaths(r) {
  if (!r) return [];
  const out = [];
  for (const g of new Set(r.guards || [])) if (/\//.test(g)) out.push(`guard ${g.replace(/[.,;]+$/, '')}`);   // a path, never prose after an @guard
  for (const c of r.claude || []) out.push(`CLAUDE.md: ${String(c.title || '').replace(/^#+\s*/, '').slice(0, 70)}`);
  for (const o of r.own || []) out.push(`header ${o.file}`);
  return [...new Set(out)];
}

/** fastDriftNote — the fast tier for one row: walk the declaration, localise its cells over the named files, list the paths' rules. */
export async function fastDriftNote({ label, intent, files = [], rows = null, tree = null, walk = null, rulesForFn = null, apertureVersion = null, head = null, lib = undefined, clock = null } = {}) {
  const ck = clock || stageClock(); const fin = (note) => ({ ...note, profile: ck.done() });
  const base = { v: 1, at: new Date().toISOString(), label, head, tier: 'fast', kind: 'pre-run fast tier (C612a)', engine: 'lensWalk → forecast-localise.mjs → rules-for.mjs; no door; zero LLM', sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR };
  const paths = files.map((f) => f.path);
  let rr = null; try { rr = rulesForFn ? rulesForFn(paths) : null; } catch { rr = null; }
  const rules = rulesOfPaths(rr); ck.lap('rules');
  const w = walk ? (walk(String(intent || '')) || {}) : {}; ck.lap('walk');
  const cells = Array.isArray(w.cells) ? w.cells : [];
  const at = `${label}${head ? ` at ${String(head).slice(0, 10)}` : ''}`;
  const rulesStr = rules.length ? `${rules.slice(0, FAST_MAX_RULES).join(' · ')}${rules.length > FAST_MAX_RULES ? ` (+${rules.length - FAST_MAX_RULES} in the sidecar)` : ''}` : '—';
  const tail = `the Δ door panel runs beside you and lands as a sidecar after you start (${DOOR_NOT_RUN} until it does)`;
  if (!w.pixel || !cells.length) {
    return fin({ ...base, admissible: true, placed: false, why: `the walk placed nothing (${w.err || (walk ? 'no cells' : 'no walker')})`, cells: [], zones: [], rows: [], rules, files: [],
      text: `${FAST_LABEL} (${at}) — UNMEASURED placement: the walk placed nothing (${w.err || (walk ? 'no cells' : 'no walker')}) · rules for the named paths: ${rulesStr} · ${tail}.` });
  }
  const R = rows || (tree ? rowsOf(tree) : []);
  const forecast = { label: `fast-${label}`, aperture_version: apertureVersion || 'unversioned', candidate: String(intent || ''), ingress: { rule: 'fast tier: the declaration\'s walked cells', K: 1 },
    mean: Object.fromEntries(cells.map((c) => [c, 1])), spread: Object.fromEntries(cells.map((c) => [c, 0])) };
  const fIn = files.map((f) => { const t = String(f.text || ''); return { path: f.path, spans: [{ bytes: [0, Buffer.byteLength(t)], lines: [[1, t.split('\n').length]], chunk_sha: sha(t), ...(Array.isArray(f.cells) ? { cells: f.cells } : {}) }], _text: t }; });
  const byPath = new Map(fIn.map((f) => [f.path, f._text]));
  const walkSpan = walk ? (p) => { const x = walk(byPath.get(p) || '', { maxChars: 800 }) || {}; return x.pixel ? (x.cells || []) : null; } : null;
  let loc = null; try { loc = await localise({ forecast, rows: R, fIn: fIn.map(({ _text, ...f }) => f), walkSpan, lib }); } catch (e) { loc = { refused: true, why: String(e && e.message || e).slice(0, 120) }; }
  ck.lap('localise');
  const zones = loc && !loc.refused ? loc.zones : [];
  const zRows = [...new Set(zones.flatMap((z) => z.rows.map((r) => r.id)))].slice(0, BRIEF_ZONES * BRIEF_ROWS);
  const zFiles = [...new Set(zones.flatMap((z) => z.files.map((f) => f.path)))];
  const text = `${FAST_LABEL} (${at}, aperture ${apertureVersion || 'unversioned'}) — the declaration walks to ${w.pixel} (${cells.length} cell${cells.length === 1 ? '' : 's'})`
    + ` → ${zFiles.length ? zFiles.join(', ') : 'no named file lit those cells'} · rows ${zRows.length ? zRows.join(',') : '—'} · rules for the named paths: ${rulesStr}`
    + `${loc && loc.refused ? ` · localise UNMEASURED (${loc.why})` : ''} · ${tail}. Information for you, not an instruction.`;
  return fin({ ...base, admissible: true, placed: true, pixel: w.pixel, cells, zones: zones.map((z) => ({ coord: z.coord, rows: z.rows.map((r) => r.id), files: z.files.map((f) => f.path) })), rows: zRows, rules, files: zFiles, text });
}

/** Read the named files AT HEAD (W3 — the immutable commit, never the working tree). */
function readAtHead(repo, h, files) {
  const read = [];
  for (const p of files) { try { read.push({ path: p, text: execFileSync('git', ['show', `${h || 'HEAD'}:${p}`], { cwd: repo, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') }); } catch { /* not at HEAD */ } }
  return read;
}

/** The live fast tier: the row, its files at HEAD, the tree's rows, the crate walk, rules-for. No door. */
export async function preRunFastNote({ repo = REPO, specPath, label, files = [], head = null, walk = null, tree = null, rulesForFn = null, apertureVersion = null, stageMs = {}, forecastDir = null, forecastPaths = undefined, door = 'p' } = {}) {
  const ck = stageClock(stageMs);
  const row = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '').trim();
  const h = head || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(); } catch { return null; } })();
  const read = readAtHead(repo, h, files); ck.lap('read');
  let rows = null;   // C612b2: the daemon's held rows first, the node read of the whole tree as the fallback
  if (!tree) { const { treeRows } = await import('./door-crate.mjs'); rows = await treeRows(); if (!rows) { try { const ST = await import('./spec-tree.mjs'); tree = ST.readTree(ST.TREE, { text: true }); } catch { tree = null; } } }
  ck.lap('tree');
  if (!walk) { const SR = await import('./snowball-refresh.mjs'); walk = SR.probeWalker(); }
  if (!rulesForFn) { try { rulesForFn = (await import('../ops/rules-for.mjs')).rulesFor; } catch { rulesForFn = null; } }
  if (!apertureVersion) { try { apertureVersion = (await import('../pmu/prompt-lens.mjs')).apertureVersion(); } catch { apertureVersion = null; } }
  ck.lap('setup');
  const note = await fastDriftNote({ label, intent: row.replace(/^\s*-\s*\[[ xX]\]\s*/, ''), files: read, tree, rows, walk, rulesForFn, apertureVersion, head: h, clock: ck });
  return withForecastOf(note, { repo, label, apertureVersion, head: h, forecastDir, forecastPaths, door });
}

/** C610e — attach the forecast to a fast-tier note: the sidecar leaf-<label>.forecast.json is written always; note.forecast.in_brief
 *  is true only when the hit-rate reading clears the bar at the aperture in force. A throw is a reading, never a gate. */
export function withForecastOf(note, { repo = REPO, label, apertureVersion = null, head = null, forecastDir = null, forecastPaths = undefined, ndjson = undefined, door = null } = {}) {
  const dir = forecastDir || process.env.VNA_RUNNER_LOG_DIR || resolve(repo, '.thetacog/runner');
  // the record: one kind 'forecast' row on runner.ndjson beside the dispatch row — the live repo's ledger, or the one the caller names
  const led = ndjson !== undefined ? ndjson : resolve(repo) === resolve(REPO) ? (process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson')) : null;
  try { const fc = briefForecast({ label, note, dir, apertureVersion, head, ...(forecastPaths ? { paths: forecastPaths } : {}) });
    if (led) { try { appendFileSync(led, JSON.stringify({ at: new Date().toISOString(), kind: 'forecast', row: 'C610e', label, door, in_brief: fc.in_brief, line: fc.line, path: fc.path }) + '\n'); } catch { /* a reading, never a gate */ } }
    return { ...note, forecast: { in_brief: fc.in_brief, block: fc.block, line: fc.line, path: fc.path } }; }
  catch (e) { return { ...note, forecast: { in_brief: false, block: null, line: `forecast: UNMEASURED — the forecast threw (${String(e && e.message || e).slice(0, 120)})`, path: null } }; }
}

/** startDoorTier — start the slow tier and return at once. The stale sidecar is removed first, so the close line never reads a prior
 *  round's door as this one's. Never throws; the returned promise resolves to { note, path } once the sidecar is on disk. */
export function startDoorTier({ noteFn, dir, label, n = null, onDone = null } = {}) {
  const path = driftNotePath({ dir, label, n }); const round = roundSidecarPath({ dir, label, n });
  try { rmSync(path, { force: true }); } catch { /* nothing to clear */ }
  const started_at = new Date().toISOString();
  const promise = Promise.resolve().then(() => noteFn())
    .catch((e) => ({ label, admissible: false, why: `drift-note threw: ${String(e && e.message || e).slice(0, 120)}`, text: `${LABEL} — UNMEASURED for ${label}: the door tier threw (${String(e && e.message || e).slice(0, 120)}).` }))
    .then((note) => { let p = null; try { p = writeDriftNote({ ...note, tier: 'door', door_started_at: started_at }, { dir, label, n }); } catch { p = null; }
      try { appendFileSync(round, JSON.stringify({ at: new Date().toISOString(), kind: 'door', tier: 'door (C612a)', label, n, line: doorLine(p), admissible: note.admissible === true, why: note.why || null, red_cells: note.red_cells || [], rows: note.rows || [], rules: note.rules || [], files: note.files || [], text: note.text || null, sidecar: p }) + '\n'); } catch { /* a reading, never a gate */ }
      try { onDone && onDone(note, p); } catch { /* a reading, never a gate */ } return { note, path: p }; });
  return { path, round, started_at, promise };
}

/** The close line's door clause, read off the sidecar ONLY. Absent → `door: not run` — never a zero, never a value. */
export function doorLine(path) {
  let raw = null; try { if (path && existsSync(path)) raw = readFileSync(path, 'utf8'); } catch { raw = null; }
  if (raw == null) return DOOR_NOT_RUN;
  const i = raw.indexOf('--- receipt ---'); let r = null;
  try { r = i >= 0 ? JSON.parse(raw.slice(i + '--- receipt ---'.length)) : null; } catch { r = null; }
  if (!r) return 'door: UNMEASURED — the sidecar carries no receipt';
  if (r.admissible !== true) return `door: UNMEASURED — ${String(r.why || 'not admissible').slice(0, 140)}`;
  const c = r.coverage || null;
  return `door: admissible · ${(r.red_cells || []).length} red cell${(r.red_cells || []).length === 1 ? '' : 's'}${c ? ` · ${c.zones_lit}/${c.zones_total} zones` : ''}${r.diffuse ? ' · DIFFUSE' : ''}${r.profile && r.profile.total_ms != null ? ` · ${(r.profile.total_ms / 1000).toFixed(1)} s` : ''}`;
}

// the CLI runs as a function, never a top-level await: steer-runner.mjs imports this module, so a TLA import of it here would deadlock
async function main() {
  const label = process.argv[2];
  if (!label) { console.error('usage: node scripts/vna/drift-note.mjs <row label> [--out <dir>]'); process.exit(2); }
  const i = process.argv.indexOf('--out'); const dir = i >= 0 ? process.argv[i + 1] : resolve(REPO, '.thetacog/runner');
  const specPath = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
  const { briefTargets } = await import('./steer-runner.mjs');
  const row = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '');
  const t0 = performance.now(); const files = briefTargets({ repo: REPO, row }); const targets = +(performance.now() - t0).toFixed(1);
  const note = await preRunDriftNote({ specPath, label, files, stageMs: { targets } });
  const p = writeDriftNote(note, { dir, label });
  console.log(note.text);
  console.error(`wrote ${p} · profile ${JSON.stringify(note.profile || null)}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
