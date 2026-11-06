// packages/thetacog-mcp/scripts/tape/physics.mjs — THE LLM-FREE LANE of /tape.
//
// ┌─ THE PURITY CONTRACT ───────────────────────────────────────────────────────────────────────┐
// │ NOTHING in this module's transitive import graph may reach a model. Not llm.mjs, not ollama, │
// │ not a `claude -p` spawn, not an API client. The atom's placement and the vega series are     │
// │ RECEIPTS: a deterministic, re-runnable function of the text. The moment a model touches this │
// │ path, a reproducible coordinate space starts leaning on an undecidable process — the exact   │
// │ thing the S=P=H thesis exists to refuse. Guarded by tests/tape/receipt-is-llm-free.test.mjs, │
// │ which walks the import graph TRANSITIVELY (a one-hop grep is the check that misses it).      │
// │ Verified clean at write time: tesseract.mjs and unified-drift.mjs import only node builtins  │
// │ plus definer-walk-144 and the Rust binary resolver.                                          │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// ── WHAT THIS MODULE MEASURES, AND WHAT IT REFUSES TO CLAIM ───────────────────────────────────
// Four distinct measurements live near each other and are constantly conflated. They are not the
// same number and this module keeps them apart by name:
//   1. PLACEMENT      — where an atom's quote lands on the 144 lattice.       (tesseract.place)
//   2. FIDELITY       — how far the extracted one-line rule sits from the     (tape-intent read,
//                       quote it claims to summarize.                          BULKED — see below)
//   3. LANE DRIFT     — how far an atom sits from the session's home          (driftFrom, Chebyshev)
//                       coordinate. This is the plumber/electrician boundary.
//   4. ENFORCEMENT    — whether a dispatched commit landed where its rule      (NOT here; that is a
//                       said it would.                                          triptych, later)
//
// All four are DECIDABLE WHERE-readings. None of them is a quality verdict. A high drift number
// does not mean an atom is wrong — it means it sits away from the lane, which is an observation
// the operator interprets. /rewrite's tesseract.mjs learned this the expensive way (its calibration
// found genuine rewrites and nonsense rewrites overlapping, with nonsense often scoring HIGHER),
// so nothing in /tape auto-rejects on a physics number. We record; the operator decides.
//
// @canonical  measured-not-asserted · null-with-reason where the data is absent · never a fabricated coordinate
// @guard  tests/tape/receipt-is-llm-free.test.mjs · tests/tape/vega-auc-monotonic.test.mjs

import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');              // packages/thetacog-mcp
const REPO = resolve(PKG, '..', '..');              // repo root

// ── THE SHORTLEX AXIS — canonical order, length-1 symbols before length-2 ─────────────────────
// This ordering IS the grid geometry: index 0..11 on each axis, so a coordinate "B,C1" is the
// cell (row 1, col 9). Chebyshev distance on those indices is the king-move the drift reading uses.
export const SHORTLEX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const IDX = Object.fromEntries(SHORTLEX.map((s, i) => [s, i]));

// ALWAYS EXPAND COORDINATE LABELS (CLAUDE.md standing rule): never emit a bare `B,C1` to a human.
// The canonical helper lives in attest-hypotheses.mjs (one rule, one place) and reads the axis
// library; we fall back to a plain expansion only if that module cannot be loaded, and we say so.
let _fullLabel = null;
async function labeller() {
  if (_fullLabel) return _fullLabel;
  try {
    const m = await import(resolve(REPO, 'scripts/pmu/attest-hypotheses.mjs'));
    if (typeof m.fullLabel === 'function') { _fullLabel = m.fullLabel; return _fullLabel; }
  } catch { /* fall through to the local expansion */ }
  const NAMES = {
    A: 'Strategy', B: 'Tactics', C: 'Operations',
    A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
    B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
    C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
  };
  _fullLabel = (coord) => {
    const [r, c] = String(coord).split(',');
    return `${coord} (${NAMES[r] || r} ⊕ ${NAMES[c] || c})`;
  };
  return _fullLabel;
}
export async function fullLabel(coord) { return (await labeller())(coord); }

// ── PLACEMENT · CALL 1 — WHERE the atom sits ──────────────────────────────────────────────────
// MEASURED 2026-08-20 against the real module: place(text) returns
//   { coords:[...], sigma, cells, sensor:'metal', apertureRatio, apertureMismatch, fillPct, ms, _walk }
// ~300 ms per call, byte-identical across runs, sensor 'metal' = the real Rust ballistic walk.
// NOTE the receipt from tape-intent carries NO coords and NO sigma — that was a contract error,
// corrected in TAPE-CONTRACT.md. Coordinates come from HERE and only here.
let _tess = null;
async function tesseract() {
  if (_tess) return _tess;
  _tess = await import(resolve(PKG, 'scripts/rewrite/tesseract.mjs'));
  return _tess;
}

export async function placeText(text) {
  const T = await tesseract();
  const avail = await T.isAvailable();
  if (!avail?.available) {
    // Honest absence. An unavailable walk is UNMEASURED — never a fabricated coordinate, and
    // never a silent fallback to some analytic stand-in (anti-rules ledger: the walk is the walk).
    return { available: false, reason: avail?.error || 'tesseract unavailable', coords: [], sigma: null, sensor: null };
  }
  const p = await T.place(String(text || ''));
  return {
    available: true,
    coords: p?.coords || [],
    sigma: typeof p?.sigma === 'number' ? p.sigma : null,
    cells: p?.cells ?? (p?.coords || []).length,
    sensor: p?.sensor || null,          // 'metal' = real walk · 'gzip-fallback' = degraded, and it SAYS so
    apertureRatio: p?.apertureRatio ?? null,
    fillPct: p?.fillPct ?? null,
    ms: p?.ms ?? null,
  };
}

// The atom's REPRESENTATIVE coordinate. place() lights many cells (33 on the GDD payload quote);
// the tape needs one cell per atom to plot and to measure lane drift from. We take the lit cell
// nearest the centroid of the lit set — deterministic, and crucially it is a cell that is ACTUALLY
// LIT rather than an invented centroid that no walk ever visited.
export function representativeCoord(coords) {
  const cells = (coords || []).map((c) => {
    const [r, k] = String(c).split(',');
    return { coord: c, r: IDX[r], k: IDX[k] };
  }).filter((c) => Number.isInteger(c.r) && Number.isInteger(c.k));
  if (!cells.length) return null;
  const mr = cells.reduce((a, c) => a + c.r, 0) / cells.length;
  const mk = cells.reduce((a, c) => a + c.k, 0) / cells.length;
  let best = null, bestD = Infinity;
  for (const c of cells) {
    const d = Math.max(Math.abs(c.r - mr), Math.abs(c.k - mk));
    // tie-break by ShortLex order so the result is stable, never arbitrary
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && best && (c.r * 12 + c.k) < (best.r * 12 + best.k))) {
      best = c; bestD = d;
    }
  }
  return best ? best.coord : null;
}

// ── LANE DRIFT — the king-move distance from the session's home cell ───────────────────────────
// THE PLUMBER/ELECTRICIAN READING. The source doc asks for exactly this: a way to know the shape
// of the tradesman you hired, so you can see the moment the work wanders into another trade's lane.
// 0 = in-lane. The maximum on a 12x12 grid is 11.
export function driftFrom(home, coord) {
  if (!home || !coord) return null;
  const [hr, hk] = String(home).split(',');
  const [cr, ck] = String(coord).split(',');
  if (![hr, hk, cr, ck].every((s) => Number.isInteger(IDX[s]))) return null;
  return Math.max(Math.abs(IDX[hr] - IDX[cr]), Math.abs(IDX[hk] - IDX[ck]));
}

// The session's home = the modal representative coordinate across the first N placed atoms.
// Ties break by ShortLex order (deterministic). Fewer than `min` atoms returns null WITH a reason
// rather than a home computed off two points — a lane derived from noise is worse than no lane.
export function homeCoord(repCoords, { min = 8, window = 24 } = {}) {
  const list = (repCoords || []).filter(Boolean).slice(0, window);
  if (list.length < min) {
    return { coord: null, reason: `home needs >= ${min} placed atoms; have ${list.length}`, n: list.length };
  }
  const tally = new Map();
  for (const c of list) tally.set(c, (tally.get(c) || 0) + 1);
  let best = null, bestN = -1;
  for (const [coord, n] of [...tally.entries()].sort((a, b) => {
    const [ar, ak] = a[0].split(','), [br, bk] = b[0].split(',');
    return (IDX[ar] * 12 + IDX[ak]) - (IDX[br] * 12 + IDX[bk]);
  })) {
    if (n > bestN) { best = coord; bestN = n; }
  }
  return { coord: best, reason: null, n: list.length, support: bestN };
}

// ── gzip-NCD — the canonical sensor (NOT SimHash) ──────────────────────────────────────────────
const gz = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;
export function ncd(a, b) {
  if (!a || !b) return 1;
  const ca = gz(a), cb = gz(b), cab = gz(a + '\n' + b), mx = Math.max(ca, cb);
  return mx === 0 ? 1 : Math.max(0, Math.min(1.2, (cab - Math.min(ca, cb)) / mx));
}

// THE CONTRADICTION SHORTLIST — LLM-FREE. This narrows the field; it does NOT judge. The judgment
// (do these two rules actually collide?) is a model call and lives in contradict.mjs, off this path.
// That split is the whole discipline: the cheap deterministic sensor proposes, the model disposes,
// and only the sensor's half is a receipt.
export function ncdShortlist(newRule, priorRules, { k = 5, max = 0.45 } = {}) {
  const scored = (priorRules || [])
    .map((p) => ({ id: p.id, rule: p.rule, ncd: +ncd(String(newRule || ''), String(p.rule || '')).toFixed(4) }))
    .filter((p) => p.ncd <= max)
    .sort((a, b) => a.ncd - b.ncd || String(a.id).localeCompare(String(b.id)));
  return scored.slice(0, k);
}

// ── FIDELITY · CALL 2 — the quote-vs-rule reading, and the MASS TRAP it walks into ─────────────
// MEASURED on the first probe: a 430-char quote against its own 130-char rule returned
// OFF_DOMAIN / dI 0.7556 / offPct 52. That is a MASS artifact, not a fidelity signal — gzip-NCD
// only measures MEANING when both sides are the same size-order (the aperture). Reading that raw
// verdict as "the extraction was unfaithful" would be measuring the length difference and calling
// it drift.
//
// THE FIX IS SYMMETRIC, AND ONE-SIDED PADDING IS BANNED. We bulk BOTH sides toward matched mass by
// repeating each side's own content (its own words, never invented filler and never boilerplate
// that would drown a short rule in vocabulary the rule never used), then cut both to the same
// aperture. If the sides still cannot be matched, we return UNMEASURED with the reason.
const MIN_GZIP_BYTES = 220;   // the phantom-mass floor tape-intent enforces

// MEASURED FAILURE, 2026-08-20 — recorded because the next person will try it too:
// growing the short side by REPEATING its own text does not add gzip mass. gzip dedupes the
// repetition, so a 130-char rule repeated out to 430 chars still compressed to 96 bytes against a
// 220-byte floor, and all three probe atoms came back UNMEASURED. Repetition adds LENGTH, not
// ENTROPY, and the floor is a floor on entropy. This is why the canonical fatten() in
// attest-hypotheses.mjs pads with novel boilerplate vocabulary instead.
//
// THE CORRECT MOVE IS THE OTHER HALF OF META-BULK: cut the eye, don't grow the mass. Slide a
// rule-sized window across the quote and take the closest one. Both sides are then the same
// size-order by construction, which is the only condition under which gzip-NCD measures meaning
// rather than length. The reading is still LOW-MASS when the rule itself is short, and it says so.
function bulkToMatch(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return { a, b, bulked: false, ok: false, reason: 'empty side' };
  const target = Math.max(a.length, b.length);
  const grow = (s) => { let out = s; while (out.length < target) out += ' ' + s; return out.slice(0, target); };
  const A = grow(a), B = grow(b);
  const ok = gz(A) >= MIN_GZIP_BYTES && gz(B) >= MIN_GZIP_BYTES;
  return {
    a: A, b: B,
    bulked: A !== a || B !== b,
    ok,
    reason: ok ? null : `below the phantom-mass floor after matching (gzip ${gz(A)}/${gz(B)} < ${MIN_GZIP_BYTES})`,
  };
}
export { bulkToMatch };

// ── APERTURE-CUT FIDELITY — the reading that actually works at this size-order ─────────────────
// "Does this one-line rule correspond to some passage of the quote it claims to summarize?"
// Slide a window the length of the rule across the quote, step ~1/4 window, take the MINIMUM NCD.
// Matched mass on both sides by construction (cut, never grow). Deterministic, LLM-free, ~1 ms.
//
// WHAT IT LICENSES: a low value means the rule's vocabulary genuinely sits somewhere in the quote —
// evidence the extraction is anchored rather than invented. WHAT IT DOES NOT LICENSE: it is not a
// judgment that the rule is the RIGHT summary, and a high value on a short rule may be size noise.
// When the rule is under the entropy floor the result is flagged lowMass and must be shown with
// that caveat attached, never as a bare number.
// ══ match(plate, aperture) — THE SENSOR. ONE implementation, THREE call sites. ══════════════════
//
// An APERTURE IS A WINDOW LENGTH, not a filter. gzip-NCD only compares at matched mass, which is
// what the padding failure above proved from the other side: you cannot GROW to compare, you CUT to
// compare. Slide a window at the PLATE'S OWN LENGTH across the aperture and take the closest one.
// Both sides are then the same size-order by construction — the only condition under which this
// sensor measures meaning instead of length.
//
// THE THREE CALL SITES, and why a second implementation is banned:
//   1. EXTRACTIVE LAW   — match(rule, quote): does the extracted rule quote its own source?
//   2. PLATE SELECTION  — match(plate.when, apertureI): does this hat/role shape-match this intent?
//   3. ENFORCEMENT      — match(plate, apertureC): does the code aperture still carry the shape?
// Same ban that killed the JS transcript reader: a fork here forks the bit-identity gate, and the
// three readings would stop being comparable — which is the whole point of them being one number.
//
// STRUCTURAL RULE, and it generalizes the placement fix one layer up: the aperture is assembled from
// VERBATIM BYTES, never from a paraphrase. If plate selection ran on a model's summary of the intent,
// the injected role would be chosen BY the paraphrase — a model steering its own prompt injection
// through the back door. Same failure as coordinates-from-the-receipt, different door.
//
// The score is named `plateMatch` (0.00–1.00) and gets its own name BEFORE it exists, not after a
// diligence reader finds it averaged with `drift` (0–100 NCD), `laneDrift` (0–11 king-move), the
// lane-departure AUC (cumulative), or `vega` (greeks variance). Five numbers, five names, never joined.
//
// MEASURED separation, GDDadwill payload quote: faithful rules 0.3415 / 0.3902, invented 0.5543 / 0.5595.
export function match(plate, aperture, { step = null } = {}) {
  const p = String(plate || ''), a = String(aperture || '');
  if (!p || !a) return { plateMatch: null, at: 0, windows: 0, lowMass: true, reason: 'empty side' };
  const L = p.length;
  const lowMass = gz(p) < MIN_GZIP_BYTES;
  const caveat = lowMass ? `plate below the entropy floor (gzip ${gz(p)} < ${MIN_GZIP_BYTES}) — a low-mass reading; report it with this caveat, never as a bare number` : null;
  if (a.length <= L) {
    return { plateMatch: +ncd(a, p).toFixed(4), at: 0, windows: 1, windowLen: L, lowMass, reason: caveat };
  }
  const st = step || Math.max(1, Math.floor(L / 4));
  let best = Infinity, at = 0, windows = 0;
  for (let i = 0; i + L <= a.length; i += st) {
    const d = ncd(a.slice(i, i + L), p);
    windows++;
    if (d < best) { best = d; at = i; }
  }
  return { plateMatch: +best.toFixed(4), at, windows, windowLen: L, lowMass, reason: caveat };
}

// CALL SITE 1 — the extractive law. A thin wrapper so there is visibly one sensor, not two.
// (`ncd` is kept as the legacy field name here because html-report and cli already read it.)
export function apertureFidelity(quote, rule) {
  const m = match(rule, quote);
  return { ncd: m.plateMatch, at: m.at, windows: m.windows, lowMass: m.lowMass, reason: m.reason };
}

// CALL SITE 2 — plate selection. Score EVERY plate; return them ranked ascending (closest first).
// Nothing is filtered out here: the caller injects those under threshold and shows the rest DIMMED.
// Seeing what was scored and passed over is the same transparency contract as the dropped atom rows,
// and for the same reason — an unexplained absence reads as "there was nothing there".
//
// `fixedWindow` — CROSS-PLATE RANKING ONLY, measured fix for the length artifact (plate-calibration.mjs
// §1, 2026-08-20): with no fixedWindow, match() windows the aperture at EACH PLATE'S OWN length, which
// is correct WITHIN one plate (the extractive-law and enforcement call sites both ask "does this text,
// at its own length, appear somewhere in the aperture" and must keep asking it that way) but makes
// scores INCOMPARABLE when ranking many plates against one aperture: the shortest plate gets the
// shortest window and the fewest chances to mismatch, so the shortest plate in the whole set wins by
// construction regardless of content. Pass `fixedWindow: N` (e.g. the corpus's own median plate length)
// and every plate is clipped to its first N chars before match() runs, so every ranked plate is scored
// through the SAME aperture. A plate NATIVELY SHORTER than N is left at its own length (there is no
// real text to manufacture a bigger window out of — padding by repetition adds length, not entropy, see
// bulkToMatch's own note above) and flagged `underfilled: true` so a consumer can see the reading is
// still length-biased for that one row, rather than silently trusting it.
//
// This is ONE function serving both contracts (not a fork of match()) because the ranking use and the
// per-plate use are the SAME sensor asked at two different apertures — `fixedWindow` only changes what
// substring of the plate gets handed to match(), never how match() itself compares. Extractive-law and
// enforcement callers simply never pass the option, so their behaviour is byte-identical to before.
export function rankPlates(plates, aperture, { threshold = 0.45, fixedWindow = null } = {}) {
  return (plates || [])
    .map((pl) => {
      const shape = String(pl.shape ?? pl.when ?? pl.rule ?? pl.text ?? '');
      const underfilled = fixedWindow ? shape.length < fixedWindow : false;
      const scored = fixedWindow && !underfilled ? shape.slice(0, fixedWindow) : shape;
      const m = match(scored, aperture);
      return {
        id: pl.id ?? pl.name, name: pl.name ?? pl.id, kind: pl.kind || 'plate', coord: pl.coord || null,
        plateMatch: m.plateMatch, at: m.at, windowLen: m.windowLen, lowMass: m.lowMass,
        injected: m.plateMatch !== null && m.plateMatch <= threshold,
        inject: pl.inject ?? pl.skeleton ?? null,
        shapeChars: shape.length,
        ...(fixedWindow ? { underfilled } : {}),
      };
    })
    .filter((r) => r.plateMatch !== null)
    .sort((a, b) => a.plateMatch - b.plateMatch || String(a.id).localeCompare(String(b.id)));
}

// THE WIDTH SWEEP — the knob that makes this a display of HOW TO GET IT RIGHT rather than a verdict.
// Widening the aperture changes which plate wins. Return the ranking as a function of width so the
// FLIP POINT is visible: that flip is the creativity the operator named, made repeatable by someone else.
export function widthSweep(plates, apertureFull, widths, { threshold = 0.45 } = {}) {
  return (widths || []).map((w) => {
    const slice = String(apertureFull || '').slice(0, w);
    const ranked = rankPlates(plates, slice, { threshold });
    return { width: w, gzBytes: gz(slice), belowFloor: gz(slice) < MIN_GZIP_BYTES, winner: ranked[0] || null, top: ranked.slice(0, 3) };
  });
}

// The fidelity read. Returns UNMEASURED-with-reason rather than a verdict the geometry cannot carry.
export async function fidelity({ quote, rule, tapePath }) {
  const m = await import(resolve(REPO, 'scripts/pmu/tape-intent.mjs'));
  const bulk = bulkToMatch(quote, rule);
  if (!bulk.ok) {
    return { measured: false, reason: bulk.reason, verdict: 'UNMEASURED', bulked: bulk.bulked };
  }
  const w = m.writeTapeIntent({
    intent_text: bulk.a, reality_text: bulk.b, negative_text: '',
    scenario_tag: 'semantic-drift',
    tape: tapePath || resolve(REPO, '.thetacog/attest-flight-tape.json'),
  });
  if (!w?.cursor_id) {
    return { measured: false, reason: w?.instruction || w?.status || 'write refused', verdict: 'UNMEASURED', bulked: bulk.bulked };
  }
  const r = await m.readTapeReceipt({ cursor_id: w.cursor_id, tape: tapePath, wait_ms: 8000 });
  if (!r?.filled) {
    // INSUFFICIENT_MASS / CATASTROPHIC_FAILURE / PENDING are all honest non-answers. Never a fake fill.
    return { measured: false, reason: r?.status || 'unfilled', verdict: r?.status || 'UNMEASURED', cursor_id: w.cursor_id, bulked: bulk.bulked };
  }
  return {
    measured: true, cursor_id: w.cursor_id, bulked: bulk.bulked,
    verdict: r.verdict, drift: r.metrics?.drift ?? null,
    dI: r.metrics?.dI ?? null, dN: r.metrics?.dN ?? null, offPct: r.metrics?.offPct ?? null,
    elapsed_ms: r.elapsed_ms ?? null,
  };
}

// ── THE ATOM PLACEMENT — the one call the engine makes per atom ────────────────────────────────
export async function placeAtom({ quote, rule, tapePath, withFidelity = true }) {
  const t0 = Date.now();
  const p = await placeText(quote);
  const coord = p.available ? representativeCoord(p.coords) : null;
  const out = {
    placement: p.coords, coord, sigma: p.sigma, sensor: p.sensor,
    cells: p.cells ?? null, fillPct: p.fillPct ?? null,
    walk_ms: p.ms ?? null, total_ms: null,
    fidelity: null,
    unmeasured: p.available ? null : p.reason,
  };
  // The aperture-cut reading always runs: it is ~1 ms, LLM-free, and it is the one that survives the
  // size-order mismatch between a long quote and its one-line rule.
  out.apertureFidelity = apertureFidelity(quote, rule);
  // The deeper tape-intent triangulation is attempted only when both sides can honestly carry it;
  // on this corpus it usually cannot, and it says so rather than returning a mass artifact as a verdict.
  if (withFidelity && p.available) {
    try { out.fidelity = await fidelity({ quote, rule, tapePath }); }
    catch (e) { out.fidelity = { measured: false, reason: 'fidelity threw: ' + e.message, verdict: 'UNMEASURED' }; }
  }
  out.total_ms = Date.now() - t0;
  return out;
}

// ── THE VEGA SERIES — area under the lane-departure curve ──────────────────────────────────────
// One row per atom, in tape order. `auc` is the running sum of drift: the total area the tape has
// spent away from its own lane. It is monotonic non-decreasing by construction (drift >= 0), which
// is what makes it an AREA rather than a score — and it is recomputable from the rows alone.
// ⚠ NAMING, DELIBERATE (design review G2/G3, 2026-08-20) — two collisions avoided:
//   · `drift` is ALREADY TAKEN on this same tape. tape-walk-worker.mjs writes metrics.drift as a
//     0–100 NCD percentage into the very flight-tape these atoms reference by cursor_id. Ours is a
//     0–11 king-move count. Two different numbers, one name, one join away from being averaged
//     together by the first consumer that plots them. Ours is renamed `laneDrift`; theirs is frozen.
//   · `vega` is ALSO TAKEN. greeks.mjs:computeVega is population VARIANCE of hold-rates, and
//     aggregate-vega.mjs publishes that to data/benchmark/vega-index-history.ndjson as the index
//     constituents settle against. A cumulative SUM shipped under the same name inside the same
//     package hands any diligence reader a free contradiction. The file name is pinned, so the row
//     carries kind:'lane-auc' and the graph is titled "Lane-departure AUC". The word vega is reserved
//     for the real thing: variance of enforcement hold-rates, computable once dispatches close the loop.
export function vegaRow({ atomId, pos, coord, sigma, laneDrift, prevAuc = 0 }) {
  const d = Number.isFinite(laneDrift) ? laneDrift : 0;
  return {
    atomId, pos,
    kind: 'lane-auc',
    coord: coord || null,
    sigma: Number.isFinite(sigma) ? sigma : null,
    laneDrift: Number.isFinite(laneDrift) ? laneDrift : null,  // null = UNMEASURED, contributes 0 to the area
    laneAuc: +(prevAuc + d).toFixed(4),
    unmeasured: Number.isFinite(laneDrift) ? null : 'no lane reading (home unset or placement unavailable)',
  };
}

// Rebuild the whole series from placed atoms — pure, so a test can check monotonicity without I/O.
export function buildSeries(atoms, home) {
  let auc = 0;
  return (atoms || []).map((a, i) => {
    const laneDrift = driftFrom(home, a.coord);
    const row = vegaRow({ atomId: a.id, pos: i, coord: a.coord, sigma: a.sigma, laneDrift, prevAuc: auc });
    auc = row.laneAuc;
    return row;
  });
}

export const __internals__ = { IDX, gz, MIN_GZIP_BYTES };
