// scripts/pmu/tape-blend-sweep.mjs — THE BOUNDARY MAP (operator 2026-07-15: "combine it with
// blending word changes to pinpoint where the flip happens — to deeply understand how the process
// is bounded").
//
// Interpolates REALITY word-by-word between two scenario texts (intent + negative held fixed) and
// runs EVERY blend through the write-lock gate on the flight tape: writeTapeIntent → readTapeReceipt,
// so each step is a pending→receipt pair the served instrument can scrub, and each receipt carries
// the ONE-PIPELINE walk provenance (sensor/σ/coverage). The output is the measured decision
// boundary: at which blend fraction the verdict flips, and how wide any UNPLACEABLE band is.
// Deterministic end to end (word interpolation + gzip-NCD + the real walk) — same sweep twice,
// identical verdict sequence. LLM-free (hard rule).
//
// C1386 (2026-10-29) — TWO INSTRUMENTS, SIDE BY SIDE. `walk: true` attaches, to every step, the one Rust
// walk's own reading of the same blend (buildTriptychInputs → renderTriptych through door-crate, turned into
// the Boolean by walkBoolean — the badge's instrument as C1375 wired it), beside the flat gzip-NCD gate's
// verdict. Neither is forced to agree with the other; the sweep reports both flip points as measured. The
// data root is the file's own tree (the repo in-tree, the package root inside the npm tarball), never cwd,
// so the packaged copy runs in a stranger's directory with its own binary and data.
//
// Usage:
//   node scripts/pmu/tape-blend-sweep.mjs                                  # faithful → sledgehammer, 11 steps
//   node scripts/pmu/tape-blend-sweep.mjs --from faithful --to hallucination --steps 21
//   node scripts/pmu/tape-blend-sweep.mjs --to preset:abstain-tie-dense    # a tape-presets.mjs fixture as the target
//   node scripts/pmu/tape-blend-sweep.mjs --tape <path>                    # default: the served tape
//   node scripts/pmu/tape-blend-sweep.mjs --walk                           # both instruments per step

import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { writeTapeIntent, readTapeReceipt, defaultTapePath, loadTape, findReceipt, sha256 } from './tape-intent.mjs';
import { typeReceipt, FILLED } from './tape-receipt.mjs';
import { SCENARIOS } from './attest-scenarios.mjs';
import { PRESETS, getPreset, presetFixture } from './tape-presets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The data root the walk reads (snippet library, pair signatures, the binary): this file's own tree. */
export const DATA_ROOT = resolve(HERE, '..', '..');

/** A scenario key (attest-scenarios.mjs) or `preset:<tag>` (a tape-presets.mjs row) → its {intent, reality, negative}.
 *  C1393: an explicit {key, label, intent, reality, negative} object passes through, so a guard can hand the sweep a fixture pair
 *  (the 2026-10-29 sub-floor texts) and watch it refuse, without editing the shipped scenario set. */
export function resolveScenario(key) {
  if (key && typeof key === 'object') return key.intent != null && key.reality != null && key.negative != null ? { key: String(key.key || 'fixture'), label: String(key.label || key.key || 'fixture'), intent: key.intent, reality: key.reality, negative: key.negative } : null;
  const s = SCENARIOS.find((x) => x.key === key);
  if (s) return { key, label: s.label, intent: s.intent, reality: s.reality, negative: s.negative };
  if (String(key).startsWith('preset:')) {
    const tag = String(key).slice('preset:'.length);
    const p = getPreset(tag), fx = presetFixture(tag);
    if (p && fx) return { key, label: p.title, preset: tag, intent: fx.intent, reality: fx.reality, negative: fx.negative };
  }
  return null;
}
export const KNOWN_KEYS = () => [...SCENARIOS.map((s) => s.key), ...PRESETS.filter((p) => p.fixture).map((p) => 'preset:' + p.tag)];

// ── THE FRAME CONTRACT (operator 2026-07-15): every step RENDERS its full triptych frame unless the
// state is content-hash-identical to an already-rendered state — a cache hit is the ONLY skippable
// frame ("they have to render unless exactly deterministically fitting prior state"). The key is a
// pure function of the triangulation texts, so a re-run of the same sweep re-uses every frame
// (instant) while any novel blend renders fresh. Drives the canonical pipeline
// (buildTriptychInputs → renderTriptych) — never a re-derived panel.
export function frameKey(intent, reality, negative) { return sha256(['blend-frame', intent, reality, negative].join(' ')); }

async function renderFrame({ intent, reality, negative, label, outDir, repoRoot = DATA_ROOT }) {
  const key = frameKey(intent, reality, negative);
  const html = join(outDir, key + '.html'), png = join(outDir, key + '.png');
  if (existsSync(html) && existsSync(png)) return { key, html, png, cached: true };   // deterministic fit → skip
  const { buildTriptychInputs } = await import('./triptych-build.mjs');
  const { renderTriptych, rgbaToPng } = await import('./triptych-render.mjs');
  const t0 = Date.now();
  const { renderArgs } = await buildTriptychInputs({ intentText: intent, realityText: reality, repoRoot });
  const trip = renderTriptych({ ...renderArgs, label, killTolerancePct: 25 });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(html, trip.dataHtml);
  if (trip.tol && trip.tol.rgba) writeFileSync(png, rgbaToPng(trip.tol.rgba));
  return { key, html, png: existsSync(png) ? png : null, cached: false, ms: Date.now() - t0 };
}

// ── THE WALK'S OWN READING OF ONE BLEND (C1386) ─────────────────────────────────────────────────────
// The same call the attest-demo badge makes (genTriptych → renderTriptych, kill 25) with `lean: true`, which
// returns the identical `tol` and skips the PNG encoding. walkBoolean (tolerance-panel-verdict.mjs) is the one
// place that reading becomes IN_LANE / OFF_DOMAIN / UNMEASURED — a null off-lane count is never a pass.
export async function walkReading({ intent, reality, repoRoot = DATA_ROOT, kill = 25, label = '' }) {
  const { buildTriptychInputs } = await import('./triptych-build.mjs');
  const { renderTriptych } = await import('./triptych-render.mjs');
  const { walkBoolean } = await import('./tolerance-panel-verdict.mjs');
  const t0 = Date.now();
  let built = null, t = null, error = null;
  try {
    // C1393: withShortlex false — the SHORTLEX-3 projection is drawn only by the triptych HTML, never read by tol (measured: the same
    // tol hash over six blends with and without it, 362 → 141 ms a step). The walk, the sense, the floor and the stamp are unchanged.
    built = await buildTriptychInputs({ intentText: intent, realityText: reality, repoRoot, intentLabel: 'spec', realityLabel: 'work', killTolerancePct: kill, sigmaType: 'drift', withShortlex: false });
    t = renderTriptych({ ...built.renderArgs, killTolerancePct: kill, label, files: [], lean: true });
  } catch (e) { error = String((e && e.message) || e).slice(0, 160); }
  const tol = t && t.tol ? t.tol : null;
  const rg = tol && tol.pattern && typeof tol.pattern === 'object' ? tol.pattern.region : null;
  const stampOf = (x) => (x && typeof x === 'object' ? { apertureVersion: x.apertureVersion ?? null, reef_sha: x.reef_sha ?? null, axes_sha: x.axes_sha ?? null, engine: x.engine ?? null } : null);
  // C1393: every walk row carries the entry's health stamp — the refusal's too (the crate stamps a refusal as it stamps a reading)
  const stamp = stampOf(tol?.stamp ?? built?.stamp ?? built?.renderArgs?.stamp ?? null);
  const w = walkBoolean(error ? { error } : tol ? {
    offPct: tol.offPct ?? null, tooMany: !!tol.tooMany, tier: rg?.tier ?? (tol.tooMany ? 'PRICEABLE' : 'INSURABLE'),
    green: tol.green ?? null, amber: tol.amber ?? null, red: tol.red ?? null,
    refused: !!tol.refused, refusal: tol.refusal || null, killTolerancePct: kill,
    stamp: tol.stamp ?? null,   // C1394: the walk entry's health stamp — dropped here, every step would read UNMEASURED
  } : null, { kill });
  return {
    state: w.state, offPct: w.offPct, tooMany: w.tooMany, tier: w.tier, reason: w.reason || (built?.refused ? built.reason : null), kill, stamp,
    green: tol?.green ?? null, amber: tol?.amber ?? null, red: tol?.red ?? null,
    walkMode: built?.meta?.walkMode || null, actorCoord: built?.meta?.actorCoord ?? null, ms: Date.now() - t0,
    // C1392: the region classifier's inputs to the tier (triptych-render.mjs decodeDeltaThreeColourEdges) — past the kill the
    // tier reads WHERE the off-lane mass sits (direction · severity · blast radius), never how much, so a reader who sees 29 %
    // UNINSURABLE beside 41 % PRICEABLE needs these on the page. Absent under the kill (no red block, nothing to classify).
    region: w.state !== 'UNMEASURED' && w.tooMany && rg ? { direction: rg.direction ?? null, severity: rg.severity ?? null, macroDist: rg.macroDist ?? null, blastRadius: rg.blastRadius ?? null, spread: rg.spread ?? null, motif: rg.motif ?? null } : null,
  };
}

// blend: first k word-slots come from TARGET, the rest from SOURCE — a deterministic morph whose
// only free variable is the fraction, so "where the flip happens" is a pure function of the texts.
export function blendWords(source, target, fraction) {
  const S = String(source).split(/\s+/), T = String(target).split(/\s+/);
  const L = Math.max(S.length, T.length);
  const k = Math.round(fraction * L);
  const out = [];
  for (let i = 0; i < L; i++) { const w = i < k ? T[i] : S[i]; if (w) out.push(w); }
  return out.join(' ');
}

/** every index where a verdict sequence differs from its previous step — {at, from, to} per flip */
export function flipsOf(rows, verdictOf) {
  const flips = [];
  for (let i = 1; i < rows.length; i++) {
    const a = verdictOf(rows[i - 1]), b = verdictOf(rows[i]);
    if (a !== b) flips.push({ at: rows[i].f, from: a, to: b });
  }
  return flips;
}

// PER-WORD MODE (operator 2026-07-15: "an action that takes n steps testing the one word at a
// time... and learn from the tape to understand exactly how the tool moves"): steps = one per word
// slot, so the flip localizes to the EXACT WORD whose replacement moved the verdict, and the
// encircled-cell diff at the flip shows WHERE on the reef the replacement landed (even if diffused).
// renderEvery matches frame cadence to png-gen time: render every Nth step (memoized as always).
export async function blendSweep({ fromKey = 'faithful', toKey = 'sledgehammer', steps = 11, tape = defaultTapePath(), lazy = true, render = 'none', framesDir = null, perWord = false, renderEvery = 1, walk = false, repoRoot = DATA_ROOT, kill = 25 } = {}) {
  const from = resolveScenario(fromKey), to = resolveScenario(toKey);
  if (!from || !to) throw new Error(`unknown scenario (${fromKey} / ${toKey}) — known: ${KNOWN_KEYS().join(', ')}`);
  fromKey = from.key; toKey = to.key;
  // ── C1393 THE FLOOR FOR THE WHOLE PAIR, ONE CRATE CALL ───────────────────────────────────────────────────────────────────────
  // Every text this pair will compare — the fixed intent and negative and each step's blended reality — goes to the walk's one
  // entry (door.rs entry_op) in ONE request, and the crate names every field under its floor (320 chars / 220 gz bytes). Node
  // decides nothing: a step whose intent, negative or reality the crate names is BELOW_FLOOR on the gate (a refusal, never a trip —
  // fatten() would have padded it, and a padded reading is partly a reading of the padding) and UNMEASURED on the walk (the entry
  // refuses it the same way). A pair whose intent or negative is under the floor is refused whole.
  const blends = []; for (let i = 0; i < steps; i++) { const f = steps === 1 ? 0 : i / (steps - 1); blends.push({ f, reality: blendWords(from.reality, to.reality, f) }); }
  let floor = null;
  try {
    const DC = await import('../vna/door-crate.mjs');
    const e = await DC.entryCrate({ texts: [{ field: 'intent', text: from.intent }, { field: 'negative', text: from.negative }, ...blends.map((b, i) => ({ field: `reality@${i}`, text: b.reality }))], reef: resolve(repoRoot, 'data/pmu/lens-reef.json'), axes: resolve(repoRoot, 'data/pmu/snippet-library-144.json') });
    const bad = new Set(e.refused ? (e.fields || [e.field]) : []);
    const sz = e.stamp?.sizes || {};
    floor = { admitted: !e.refused, floor: e.floor || null, stamp: e.stamp ? { apertureVersion: e.stamp.apertureVersion ?? null, reef_sha: e.stamp.reef_sha ?? null, axes_sha: e.stamp.axes_sha ?? null, engine: e.stamp.engine ?? null } : null,
      pair_refused: bad.has('intent') || bad.has('negative'), below: blends.map((b, i) => bad.has('intent') || bad.has('negative') || bad.has(`reality@${i}`)),
      sizes: { intent: sz.intent || null, negative: sz.negative || null, reality: blends.map((b, i) => sz[`reality@${i}`] || null) },
      reason: e.refused ? e.reason : null };
  } catch (err) { floor = { admitted: false, crate_error: String(err?.message || err).slice(0, 160), pair_refused: true, below: blends.map(() => true), sizes: null, reason: 'no crate entry — UNMEASURED (rust only)', stamp: null }; }
  const fieldReason = (i) => { const z = floor.sizes; if (!z) return floor.reason; const parts = []; const lim = floor.floor || { chars: 320, gz_bytes: 220 };
    for (const [k, v] of [['intent', z.intent], ['negative', z.negative], ['reality', z.reality[i]]]) if (v && (v.chars < lim.chars || v.gz_bytes < lim.gz_bytes)) parts.push(`${k} ${v.chars} chars / ${v.gz_bytes} gz bytes`);
    return `below floor: ${parts.join(', ') || 'named by the crate'} < ${lim.chars} / ${lim.gz_bytes}`; };
  const outDir = framesDir || resolve(existsSync('docs/pmu') ? 'docs/pmu/blend-frames' : '.thetacog/blend-frames');
  const srcWords = from.reality.split(/\s+/), tgtWords = to.reality.split(/\s+/);
  if (perWord) steps = Math.max(srcWords.length, tgtWords.length) + 1;   // one step per word slot
  const rows = [];
  for (let i = 0; i < steps; i++) {
    const { f, reality } = blends[i];
    const w = writeTapeIntent({ intent_text: from.intent, reality_text: reality, negative_text: from.negative, scenario_tag: `blend:${fromKey}->${toKey}@${f.toFixed(2)}`, tape });
    // THE TYPED READER, not `r.verdict || r.status`. That fallback promoted the STRING
    // 'REJECTED' into the verdict column and `rec.metrics?.dI` yielded undefined beside it, so
    // a sweep over refused rows plotted a flat curve that read as a finding. A refusal and a
    // measurement are different claims; the reader makes them different TYPES.
    const r = w.cursor_id ? await readTapeReceipt({ cursor_id: w.cursor_id, tape, lazy }) : null;
    let typed = typeReceipt(w, r);
    if (floor.below[i] && typed.state === FILLED) {
      // C1393: the gate answered on text under the crate's floor. It is recorded (gate_raw) and never counted: BELOW_FLOOR is a refusal.
      const { placement } = await import('./attest-hypotheses.mjs');
      const pl = placement(from.intent, reality, from.negative);
      typed = { state: 'BELOW_FLOOR', reason: fieldReason(i) + (pl.padded ? ` · padded (${pl.paddedFields.join(', ')})` : ''), padded: !!pl.padded, gate_raw: { verdict: typed.verdict, dI: typed.dI, dN: typed.dN, drift: typed.drift } };
    }
    // C1386: the walk reads the same blend whatever the gate said — a gate refusal and a walk reading are two instruments
    const walkRow = walk ? await walkReading({ intent: from.intent, reality, repoRoot, kill, label: `blend ${fromKey}→${toKey} f=${f.toFixed(2)}` }) : null;
    if (typed.state !== FILLED) {
      const row = { f: +f.toFixed(2), state: typed.state, reason: typed.reason, words: reality.split(/\s+/).filter(Boolean).length, below_floor: floor.below[i] };
      if (typed.state === 'BELOW_FLOOR') { row.padded = typed.padded; row.gate_raw = typed.gate_raw; }
      if (walkRow) row.walk = walkRow;
      rows.push(row);
      continue;
    }
    const rec = findReceipt(loadTape(tape), w.cursor_id) || {};
    const row = {
      f: +f.toFixed(2), verdict: typed.verdict, filled: true, state: FILLED,
      dI: typed.dI, dN: typed.dN, drift: typed.drift,
      sensor: rec.io_context?.walk?.sensor, coverage: rec.io_context?.walk?.coverage_pct,
      cursor: (w.cursor_id || '').slice(0, 8), words: reality.split(/\s+/).filter(Boolean).length, below_floor: false,
    };
    if (walkRow) row.walk = walkRow;
    if (perWord && i > 0) {
      // the word this step replaced (slot i-1 of the morph) — the causal unit of this delta
      row.word = { slot: i - 1, from: srcWords[i - 1] ?? '(none)', to: tgtWords[i - 1] ?? '(none)' };
    }
    if ((render === 'all' && (i % Math.max(1, renderEvery) === 0 || i === steps - 1)) || (render === 'last' && i === steps - 1)) {
      try { row.frame = await renderFrame({ intent: from.intent, reality, negative: from.negative, label: `blend ${fromKey}→${toKey} f=${f.toFixed(2)} · ${row.verdict}`, outDir, repoRoot }); }
      catch (e) { row.frame = { error: String((e && e.message) || e).slice(0, 120) }; }
    }
    rows.push(row);
  }
  if (render !== 'none') {
    // the filmstrip index — f → verdict → frame key, so the UX can walk the sequence in order
    try { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, 'index.json'), JSON.stringify({ fromKey, toKey, steps, frames: rows.map((r) => ({ f: r.f, verdict: r.verdict, key: r.frame?.key || null, cached: r.frame?.cached ?? null })) }, null, 2) + '\n'); } catch { /* best-effort */ }
  }
  // the boundary: every index where the verdict differs from the previous step's — in per-word
  // mode each flip carries the exact word that caused it AND the encircled-cell delta (which reef
  // cells lit/died when that word landed): the causal attribution the UX reasons over.
  const flips = [];
  const encAll = (rec) => rec ? [...(rec.green || []), ...(rec.amber || []), ...(rec.red || [])] : [];
  const doc = loadTape(tape);
  const encOf = (row) => { const rec = doc.timeline_events.find((e) => e.cursor_id && row.cursor && e.cursor_id.startsWith(row.cursor) && e.io_context); return encAll(rec?.io_context?.encircled); };
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].verdict === rows[i - 1].verdict) continue;
    const flip = { at: rows[i].f, from: rows[i - 1].verdict, to: rows[i].verdict };
    if (rows[i].word) flip.word = rows[i].word;
    const [prev, cur] = [new Set(encOf(rows[i - 1])), new Set(encOf(rows[i]))];
    flip.cells_gained = [...cur].filter((c) => !prev.has(c));
    flip.cells_lost = [...prev].filter((c) => !cur.has(c));
    flips.push(flip);
  }
  const out = { fromKey, toKey, from: { key: from.key, label: from.label }, to: { key: to.key, label: to.label }, steps, rows, flips, floor };
  if (walk) out.walkFlips = flipsOf(rows, (r) => r.walk ? r.walk.state : 'UNMEASURED');
  return out;
}

const isMain = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();   // realpath both sides (symlinked tmpdirs)
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  blendSweep({ fromKey: flag('--from', 'faithful'), toKey: flag('--to', 'sledgehammer'), steps: Number(flag('--steps', 11)), tape: flag('--tape', defaultTapePath()), render: flag('--render', 'none'), perWord: argv.includes('--per-word'), renderEvery: Number(flag('--render-every', 1)), walk: argv.includes('--walk') }).then((out) => {
    for (const r of out.rows) console.log(`  f=${r.f.toFixed(2)}  ${String(r.verdict ?? r.state).padEnd(14)} dI ${r.dI?.toFixed(4)} · dN ${r.dN?.toFixed(4)} · drift ${r.drift}${r.walk ? ` · walk ${r.walk.state} off ${r.walk.offPct ?? '—'}% tooMany ${r.walk.tooMany ?? '—'}` : ''}${r.word ? ` · word[${r.word.slot}] "${r.word.from}"→"${r.word.to}"` : ''} · walk ${r.sensor || '-'}${r.coverage != null ? ' cov ' + r.coverage + '%' : ''}  ${r.cursor || ''}${r.frame ? (r.frame.cached ? ' · frame ⟲cached' : r.frame.error ? ' · frame ✗' + r.frame.error : ' · frame ✓' + (r.frame.ms || 0) + 'ms') : ''}`);
    for (const x of out.flips) console.log(`  FLIP ${x.from}→${x.to} at f=${x.at}${x.word ? ` — word[${x.word.slot}] "${x.word.from}"→"${x.word.to}"` : ''}\n    reef delta: +${x.cells_gained.length} cells [${x.cells_gained.slice(0, 4).join(' · ')}${x.cells_gained.length > 4 ? ' …' : ''}] · −${x.cells_lost.length} [${x.cells_lost.slice(0, 4).join(' · ')}${x.cells_lost.length > 4 ? ' …' : ''}]`);
    if (!out.flips.length) console.log('  no flip — boundary outside [0,1]');
    if (out.walkFlips) for (const x of out.walkFlips) console.log(`  WALK FLIP ${x.from}→${x.to} at f=${x.at}`);
  });
}
