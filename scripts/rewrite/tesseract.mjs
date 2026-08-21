// scripts/rewrite/tesseract.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE TESSERACT ADAPTER — the "+T" half of the A/B.
//
// What "Tesseract guides the rewrite" concretely means here, in two moves:
//
//   GUIDE (pre-generation)  walkShape() places the passage on the 12×12 ShortLex
//     lattice. Each occupied cell has a canonical meaning + a "hat" (Strategist,
//     Operator, …). We inject those meanings and the book's VOICE-RULES as a
//     semantic fence: "this passage sits HERE; a rewrite that wanders off these
//     coordinates is wrong even if it reads nicely."
//
//   VERIFY (post-generation)  walkShape() the paragraph with the candidate
//     substituted, then evaluateDrift() against the original. That yields
//     coverage / weightedBleed / deltaSpread and an IN-LANE | BLEED | RUPTURE
//     verdict. Deterministic, LLM-free, re-runnable — the gate no model votes on.
//
// TWO REAL CONSTRAINTS, both discovered by running it:
//   • MIN_GZIP_BYTES ≈ 220. A lone sentence has too little gzip mass to place,
//     so we ALWAYS walk the whole paragraph (with the candidate spliced in),
//     never the bare sentence. That is also the honest comparison: what matters
//     is whether the paragraph still lands where it did.
//   • prompt-lens's `lensedContext` is an ECHO-THE-RECEIPT directive aimed at a
//     chat agent. Prepending it to a rewrite prompt makes the model print a
//     receipt instead of rewriting. We deliberately do NOT use it; we build our
//     own injection from the lattice placement, which is the part that carries
//     semantic signal.
//
// Degrades gracefully: if thetacog-mcp is absent or the Rust binary is missing,
// every function returns {available:false} and the +T tracks announce themselves
// as unguided rather than silently pretending to be guided. A silent degradation
// here would corrupt the entire A/B result, which is the one thing we cannot allow.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

// Packaged INSIDE thetacog-mcp: the tesseract root is this package. No HOME
// guessing, no sibling-checkout assumption — the chip ships with the tool, which
// is the whole point of shipping it here.
import { fileURLToPath } from 'node:url';
const TESSERACT_ROOT =
  process.env.THETACOG_MCP_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let _mod = null;      // unified-drift module
let _meaning = null;  // lattice-meaning module
let _snippets = null; // coord → {snippet, hat}
let _loadError = null;
let _loaded = false;

// CACHE THE IN-FLIGHT PROMISE, NOT A BOOLEAN. This bug silently voided the A/B.
//
// The original guard was `if (_loaded) return _mod;` with `_loaded = true` set BEFORE awaiting
// the import. The two Tesseract-guided tracks fire concurrently, by design — so the first caller
// began the load and the second saw `_loaded === true` with `_mod` still null, concluded the
// fence was unavailable, and skipped itself "to keep the A/B honest". Both guided arms bailed
// waiting on an import that was about to succeed. Nothing was broken and nothing was missing:
// measured as B/D `runs 2, ok 0, produced 0` while the unguided arms produced eight candidates
// each. The experiment ran for a full session with no treatment arm and reported it as a
// two-millisecond "timeout", which reads as a slow model rather than a dead track.
//
// A second caller now awaits the SAME promise instead of racing it. A failure is retried after a
// backoff rather than cached for the life of a process that outlives the transient.
let _loadFailedAt = 0;
let _loadPromise = null;
const LOAD_RETRY_MS = 30_000;

async function load() {
  if (_mod) return _mod;
  if (_loadPromise) return _loadPromise;
  if (_loaded && Date.now() - _loadFailedAt < LOAD_RETRY_MS) return null;
  _loadPromise = doLoad().finally(() => { _loadPromise = null; });
  return _loadPromise;
}

/** Why the fence is unavailable, for anything that must report it rather than swallow it. */
export function loadError() { return _loadError || (_mod ? null : 'tesseract module not loaded'); }

async function doLoad() {
  _loaded = true;
  _loadFailedAt = Date.now();
  try {
    const driftPath = path.join(TESSERACT_ROOT, 'src/lib/pmu/unified-drift.mjs');
    if (!fs.existsSync(driftPath)) throw new Error(`unified-drift.mjs not found at ${driftPath}`);
    _mod = await import(`file://${driftPath}`);

    try {
      _meaning = await import(`file://${path.join(TESSERACT_ROOT, 'scripts/pmu/lattice-meaning.mjs')}`);
    } catch { _meaning = null; }

    try {
      const libPath = path.join(TESSERACT_ROOT, 'data/pmu/snippet-library-144.json');
      const parsed = JSON.parse(fs.readFileSync(libPath, 'utf8'));
      const arr = Array.isArray(parsed) ? parsed : parsed.snippets || [];
      _snippets = new Map(arr.map((s) => [s.coord, { snippet: s.snippet, hat: s.hat }]));
    } catch { _snippets = null; }
  } catch (err) {
    _loadError = String(err?.message || err);
    _mod = null;
  }
  if (_mod) _loadError = null;
  return _mod;
}

export async function isAvailable() {
  await load();
  return { available: !!_mod, root: TESSERACT_ROOT, error: _loadError };
}

/** Place a passage on the lattice. Returns null when Tesseract is unavailable. */
export async function place(text) {
  const m = await load();
  if (!m) return null;
  try {
    const w = await m.walkShape(text);
    return {
      coords: w.coords || [],
      sigma: w.sigma,
      cells: w.cells,
      sensor: w.sensor,              // 'metal' = Rust binary, 'gzip-fallback' = degraded
      apertureRatio: w.apertureRatio,
      apertureMismatch: w.apertureMismatch,
      fillPct: w.fillPct,
      ms: w.ms,
      _walk: w,                      // retained for evaluateDrift; never serialized to the UI
    };
  } catch (err) {
    return { error: String(err?.message || err), coords: [], _walk: null };
  }
}

/**
 * Compare a candidate paragraph against the original.
 *
 * ── WHAT THIS ACTUALLY MEASURES (calibrated 2026-08-11, do not overclaim) ──
 * A calibration sweep over chapter 8 (scripts/rewrite/calibrate.mjs) fed four
 * known cases through this path — an exact no-op, a synonym swap, a genuine
 * rewrite, and deliberate nonsense — and compared the results:
 *
 *     no-op     → coverage 100, bleed 0     (perfectly stable, every time)
 *     synonym   → coverage 97-100
 *     genuine   → coverage 44-97
 *     nonsense  → coverage 38-97
 *
 * The genuine and nonsense ranges OVERLAP, and nonsense frequently scored HIGHER
 * than the real rewrite. So this metric reliably measures HOW FAR the passage
 * moved, and does NOT measure whether the move was any good.
 *
 * THE MASS HYPOTHESIS WAS TESTED AND REFUTED (2026-08-12, n=16 per scale):
 *
 *   scale       avg chars   genuine cov   nonsense cov   nonsense≥genuine   synonym breaks
 *   paragraph        308          72.9          76.4              9/16               0/16
 *   fitted window    900          60.6          66.9             10/16               5/16
 *
 * Tripling the mass — far above MIN_GZIP_BYTES — did not restore discrimination.
 * It got slightly worse AND destabilised the synonym control. So the limit is not
 * mass; it is what the sensor reads. σ reads VOCABULARY CONCENTRATION: a genuine
 * rewrite changes domain-relevant vocabulary and moves the placement, while word
 * salad adds vocabulary orthogonal to the reef and perturbs it less. The sensor
 * works as designed; the design does not measure quality, at any window size.
 *
 * Therefore this returns a DISPLACEMENT reading, not a quality verdict, and
 * nothing in the system auto-rejects a candidate on it. Reporting it as a
 * pass/fail gate would invent a signal the measurement cannot support and would
 * quietly corrupt the very A/B this tool exists to run.
 */
export async function drift(originalWalk, candidateText) {
  const m = await load();
  if (!m || !originalWalk?._walk) return null;
  try {
    const cand = await m.walkShape(candidateText);
    const d = m.evaluateDrift(originalWalk._walk, cand, { weighted: true });
    const driftPct = d.coverage == null ? null : 100 - d.coverage;
    // Displacement bands, calibrated against the no-op/synonym controls above.
    let verdict = 'UNPLACED';
    if (d.coverage != null) {
      if (d.coverage >= 99) verdict = 'IDENTICAL';
      else if (d.coverage >= 90) verdict = 'MINIMAL';
      else if (d.coverage >= 60) verdict = 'MODERATE';
      else verdict = 'LARGE';
    }
    return {
      coverage: d.coverage,
      driftPct,
      weightedBleed: d.weightedBleed,
      deltaSpread: d.deltaSpread,
      sensor: d.sensor,
      // The candidate's own occupied cells — this is what the INTENT/REALITY
      // panels draw. Without it the UI can show a number but not the shape,
      // and the shape is the part a human can actually reason about.
      coords: cand.coords || [],
      sigma: cand.sigma,
      apertureRatio: cand.apertureRatio,
      apertureMismatch: cand.apertureMismatch,
      verdict,
      // Surfaced to the UI so the reading is never mistaken for a quality score.
      measures: 'semantic displacement magnitude, not rewrite quality',
      discriminatesQuality: false,
    };
  } catch (err) {
    return { error: String(err?.message || err), verdict: 'ERROR' };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// OUT-OF-CHARACTER DETECTION — the job this sensor is actually built for.
//
// Calibration established that drift cannot say whether a rewrite is GOOD. But
// that same calibration says precisely what it CAN do: it measures where
// vocabulary sits, deterministically and reproducibly. And "where the vocabulary
// sits, compared to where this author's vocabulary usually sits" is exactly the
// question "is this passage in character?"
//
// So the document is walked once to get its OWN centroid — the cells this writer
// occupies across this file — and each passage is compared against that, not
// against some external notion of quality. A passage that lights cells the rest
// of the document never touches is out of character: lifted, pasted, ghost-written,
// or drifted into a register the author does not use.
//
// This is a strictly better use of the sensor than rewrite-scoring, because it
// asks a vocabulary question of a vocabulary instrument.
// ════════════════════════════════════════════════════════════════════════════

let _centroidCache = new Map();

/**
 * Build the document's voice centroid: which lattice cells this file occupies,
 * and how often. Cached per (file, length) so it is computed once per document.
 */
export async function voiceCentroid(fileKey, paragraphs, { sample = 40 } = {}) {
  const m = await load();
  if (!m) return null;
  const key = `${fileKey}:${paragraphs.length}`;
  if (_centroidCache.has(key)) return _centroidCache.get(key);

  // Sample ACROSS the whole document — an intro has its own register and would
  // bias the centroid toward itself if we just took the first N paragraphs.
  const step = Math.max(1, Math.floor(paragraphs.length / sample));
  const picked = [];
  for (let i = 0; i < paragraphs.length; i += step) {
    if (paragraphs[i].text.length >= 200) picked.push(paragraphs[i]);
  }
  if (picked.length < 3) return null;

  // The centroid is a TEXT, not a set of cells. Set-membership was tried first
  // and failed flat: the union of cells across a document covers most of the
  // lattice, so every passage — including obvious corporate slop — scored 100%
  // "in character". Comparing a passage against a representative BODY of the
  // document via evaluateDrift does separate them (native 100 vs slop 32),
  // because that is the comparison the sensor is actually built to make.
  const body = picked.map((p) => p.text).join('\n\n');
  let walk = null;
  try { walk = await m.walkShape(body); } catch {}
  if (!walk) return null;

  const centroid = { _walk: walk, sampled: picked.length, chars: body.length, coords: walk.coords || [] };
  _centroidCache.set(key, centroid);
  return centroid;
}

// Below this, a passage has too little gzip mass to place stably and the reading
// is noise. Measured: a 190-char recipe — a completely different domain — scored
// 100% in-character purely because it was too short to place.
const OOC_MIN_CHARS = 320;

/**
 * How far out of character is this passage, against the document's own body?
 * @returns {{inCharacterPct:number, verdict:string}}
 *   verdict: IN-VOICE | EDGE | OUT-OF-CHARACTER | TOO-SHORT
 */
export async function outOfCharacter(centroid, text) {
  const m = await load();
  if (!m || !centroid?._walk) return null;
  const body = String(text || '');
  if (body.length < OOC_MIN_CHARS) {
    return {
      verdict: 'TOO-SHORT', inCharacterPct: null, chars: body.length,
      measures: `needs ≥${OOC_MIN_CHARS} chars to place stably`,
    };
  }
  try {
    const w = await m.walkShape(body);
    const d = m.evaluateDrift(centroid._walk, w, { weighted: true });
    const pct = d.coverage;
    if (pct == null) return { verdict: 'UNPLACED', inCharacterPct: null };

    let verdict = 'IN-VOICE';
    if (pct < 50) verdict = 'OUT-OF-CHARACTER';
    else if (pct < 75) verdict = 'EDGE';

    return {
      inCharacterPct: pct,
      bleed: d.weightedBleed,
      spread: d.deltaSpread,
      cells: w.cells,
      sigma: w.sigma,
      verdict,
      // Same honesty rule as everywhere else: this is a VOCABULARY measurement.
      // It flags REGISTER DRIFT, not badness. A deliberate change of voice reads
      // as out-of-character and should — the writer decides whether it was meant.
      measures: 'vocabulary register vs this document’s own body',
    };
  } catch { return null; }
}

/**
 * THE ENCIRCLED PANELS — intent vs reality, measured on the real Rust walk.
 *
 * `encircledIn`  = walked coordinates INSIDE the Chebyshev fence (in-lane)
 * `encircledOut` = walked coordinates OUTSIDE it (the out-of-lane pull)
 *
 * INTENT is the aperture window as it stands. REALITY is the same window with the
 * writer's current draft spliced into the flagged sentence's place. The delta is
 * which coordinates the edit pulls in-lane or pushes out.
 *
 * ── WHAT THIS IS NOT (state it wherever the panels are shown) ──
 * The intent panel is NOT a specification and NOT a prompt. Nobody wrote down what
 * this passage is supposed to mean; the "intent" is simply where the existing text
 * already sits. So the comparison answers "does my edit keep this passage where it
 * was?" — a displacement question — and NOT "does my edit satisfy the intent?",
 * which would require an intent that was actually declared. Reading it as the
 * latter is the single easiest way to fool yourself with this panel.
 */
/**
 * INTENT vs REALITY over the aperture — the comparison that actually means
 * something, on the real Rust walk.
 *
 * The lens's own `encircledIn/Out` classifies coordinates against a Chebyshev
 * fence that `lensPrompt` derives FROM THE TEXT YOU HAND IT. Measured on a real
 * chapter-8 aperture that returned **0 in-lane, 26 out** — and the edit moved
 * neither number. That is not a bug; it is the fence answering a different
 * question ("is this prompt inside its own derived boundary?"). It cannot tell
 * you whether YOUR EDIT kept the passage where it was.
 *
 * So the panels compare the aperture BEFORE against the aperture AFTER:
 *   INTENT   = cells the passage occupies as written  (the de-facto spec)
 *   REALITY  = cells it occupies with your draft spliced in
 *   ENCIRCLED = the delta — what the edit lit up and what it went dark on
 *
 * ── DISCLAIMER, and it belongs on screen ──
 * INTENT here is NOT a specification and NOT a prompt. Nobody declared what this
 * passage should mean; "intent" is only where the existing words already sit. So
 * this answers "does my edit keep the passage where it was?" — displacement — and
 * NOT "does my edit satisfy the intent?", which would need an intent someone
 * actually wrote down. Reading it as the second is how you fool yourself here.
 */
export async function intentReality(windowText, draftWindowText) {
  const m = await load();
  if (!m) return null;
  try {
    const [a, b] = await Promise.all([m.walkShape(windowText), m.walkShape(draftWindowText)]);
    const A = new Set(a.coords || []);
    const B = new Set(b.coords || []);
    const lit = [...B].filter((c) => !A.has(c));      // the edit brings these in
    const dark = [...A].filter((c) => !B.has(c));     // the edit gives these up
    const held = [...A].filter((c) => B.has(c));
    const d = m.evaluateDrift(a, b, { weighted: true });
    return {
      intent: { coords: [...A], sigma: a.sigma, cells: a.cells, sensor: a.sensor, aperture: a.apertureRatio },
      reality: { coords: [...B], sigma: b.sigma, cells: b.cells, sensor: b.sensor, aperture: b.apertureRatio },
      lit, dark, held,
      coverage: d.coverage,
      bleed: d.weightedBleed,
      spread: d.deltaSpread,
      changed: lit.length + dark.length,
      sensor: a.sensor,
      isSpec: false,
      disclaimer: 'INTENT is where the existing text sits, not a declared specification. This measures displacement, not satisfaction of intent.',
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// THE REAL ENCIRCLED PANEL — the same renderer the commit emails and attest page
// use. Operator rule, quoted in lens-encircled-png.mjs: "keep to using one single
// rust pipeline for everything". So this imports that pipeline rather than
// drawing its own picture of it:
//
//   paintWalk(coords, fence)   each ShortLex coord lights a 12×12 block in a
//                              144×144 field, hued by CHEBYSHEV DISTANCE from the
//                              fence — 0 green (in-lane), 1 amber (adjacent
//                              bleed), ≥2 red (orthogonal drift)
//   detectRegions(rgba)        the Rust regions chip finds contiguous regions
//   encircleRegionsPng(...)    draws the encirclements
//
// THE FENCE for a rewrite is the INTENT's own bounding box — the block rectangle
// the passage occupies as written. Reality is then coloured by how far it strays
// from where the passage already was, which is the question the writer is asking.
// A fence borrowed from anywhere else would colour the panel against a boundary
// this passage never claimed.
// ════════════════════════════════════════════════════════════════════════════
// THE ONE DOOR TO RUST. Everything that touches the chip goes through here.
//
// ── WHY THIS IS THE ONLY ENTRY POINT ──
// I built the panel three separate ways and all three were wrong, each in a way
// that LOOKED plausible on screen:
//
//   1. walkShape().coords painted as lit/unlit 12×12 blocks. Named as forbidden in
//      triptych-render.mjs's own header ("@forbidden-alternative reinventing a
//      12×12 drift map · a BINARY (non-gradient) heatmap"). Rendered as one flat
//      band, identical for intent and reality.
//   2. runPipeline heatmaps decoded as `rgb × val/max`. Graded, but the classifier
//      only recognises the EXACT tolerance hues — lens-encircled-png.mjs says it
//      outright: "Painting any other hue would make classify() drop the cells as
//      foreign and the panel would encircle nothing." It encircled nothing: 0
//      regions, no rings.
//   3. My own fence from a coord bounding box — which is not the in-lane
//      reference the classifier needs.
//
// tolerance-panel.mjs exists for exactly this reason. Its header: "the competence
// panel was being built TWO ways… Two ways, only one correct = exactly the drift
// the anti-rules ledger warns about." I made it four.
//
// So: `composeEncircledPanel` is the single door, and the aperture is set inside
// it. It runs runPanelPipeline (rust walk + empty-heat retry + domBlocks) →
// composeTolerancePanel (tolerance rgba WITH domBlocks as the in-lane reference,
// which is the part every wrong version omitted) → detectRegions →
// encircleRegionsPng. Nothing in this repo may reach past it.
//
// Guard: tests/rewrite/one-door-to-rust.test.mjs fails if any other Rust-panel
// path appears in scripts/rewrite.
let _toleranceMod = null, _toleranceTried = false;
async function loadTolerance() {
  if (_toleranceTried) return _toleranceMod;
  _toleranceTried = true;
  try {
    _toleranceMod = await import(`file://${path.join(TESSERACT_ROOT, 'scripts/pmu/tolerance-panel.mjs')}`);
  } catch { _toleranceMod = null; }
  return _toleranceMod;
}

/**
 * The encircled tolerance panel for one intent/reality pair — the same artifact the
 * commit email and the attest page show, through the same composed pipeline.
 *
 * @returns {{dataUri, regions, green, amber, red, offPct, domBlocks, ms}|{error}}
 */
export async function pipelinePanels(intentText, realityText) {
  const m = await loadTolerance();
  if (!m?.composeEncircledPanel) return { error: 'tolerance-panel.mjs not reachable in thetacog-mcp' };
  try {
    const t0 = Date.now();
    const { png, regions, meta, surfaces } = await m.composeEncircledPanel({
      intentText,
      realityText,
      scale: 4,
      label: 'intent → reality',
      sub: 'tolerance',
    });
    return {
      dataUri: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      regions: (regions || []).map((r) => ({
        kind: r.kind,
        coord: r.reef?.coord || r.coord?.center || null,
        name: r.reef?.name || null,
      })),
      green: meta?.green ?? null,
      amber: meta?.amber ?? null,
      red: meta?.red ?? null,
      offPct: meta?.offPct ?? null,
      region: meta?.region ?? null,
      domBlocks: meta?.domBlocks ?? null,
      ms: Date.now() - t0,
      engine: 'rust-ballistic-walk',
      door: 'composeEncircledPanel',
      // the two sides + delta as the walk rendered them, so no surface draws its own lattice.
      surfaces: surfaces || null,
      // which clusterer spoke — 'chip', or 'js-carpet-fallback' when the panel is all in-lane.
      regionSource: meta?.regionSource ?? null,
      // WHICH PIPELINE ACTUALLY RAN, and where it aimed. 'engine' above is a constant this file
      // asserts; walkMode is what the walk reports. When they disagree, believe walkMode.
      walkMode: meta?.walkMode ?? null,
      walkNote: meta?.walkNote ?? null,
      aperture: meta?.actorCoord
        ? { actor: meta.actorCoord, patient: meta.patientCoord, startPixel: meta.startPixel, grip: meta.pixGrip }
        : null,
      matchSigma: meta?.matchSigma ?? null,
      intentCells: meta?.intentCells ?? null,
      realityCells: meta?.realityCells ?? null,
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

export async function encircle(text) {
  await load();
  await loadLens();          // encircle() ran before activeRules() ever had, so the
                             // lens was unloaded and every panel silently fell back
                             // to raw placement with `fenced: false`.
  const body = String(text || '').trim();
  if (!body) return { in: [], out: [], coords: [], fenced: false, error: 'empty text' };

  if (!_lensMod?.lensPrompt) {
    // Fall back to raw placement so the panels still draw something true.
    const p = await place(body);
    if (!p || p.error) return { in: [], out: [], coords: [], fenced: false, error: p?.error || 'placement failed' };
    return { in: [], out: p.coords || [], coords: p.coords || [], sigma: p.sigma, sensor: p.sensor, fenced: false };
  }
  try {
    const r = await _lensMod.lensPrompt(body.slice(0, 4000));
    const inC = r?.receipt?.encircledIn || [];
    const outC = r?.receipt?.encircledOut || [];
    return {
      in: inC,
      out: outC,
      coords: [...inC, ...outC],
      sigma: r?.receipt?.sigma ?? null,
      sensor: r?.telemetry?.sensor || 'metal',
      fenced: true,
      ms: r?.ms ?? null,
    };
  } catch (err) {
    return { error: String(err?.message || err), in: [], out: [], coords: [] };
  }
}

/** Cached voice rules — the writer's temperament, the other half of the fence. */
/**
 * THE ACTIVE RULE SET — what the lens says governs this passage.
 *
 * The spec asks the card to show "the active rule set" alongside placement. The
 * lens retrieves rules seated at lattice coordinates from a SQLite table
 * (`lens_rules`) in the thetacog-mcp checkout. In this checkout that table is
 * UNSEEDED, so it returns zero rules.
 *
 * Zero is reported as zero, with the reason. The alternative — showing nothing —
 * reads as "no rules apply here", which is a different and false statement. A
 * reader of the card must be able to tell an empty rule set from an absent one.
 */
let _lensMod = null;
let _lensTried = false;
async function loadLens() {
  if (_lensTried) return _lensMod;
  _lensTried = true;
  try {
    const p = path.join(TESSERACT_ROOT, 'scripts/pmu/prompt-lens.mjs');
    if (fs.existsSync(p)) _lensMod = await import(`file://${p}`);
  } catch { _lensMod = null; }
  return _lensMod;
}

/**
 * THE LATTICE DRAW — n cells the passage does NOT occupy, from the real 144-cell library.
 *
 * WHY THIS IS A MEASUREMENT AND NOT A TOY. Every other number this tool reports compares the
 * passage to itself: coverage 31, sigma 0.8, 24 cells lit. None of those has a floor under it,
 * because nobody knows what 31 would be for an UNRELATED passage. The draw is that floor — the
 * null control. Placement only means something against the distribution of placements you did
 * not get.
 *
 * AND IT DOUBLES AS PROVOCATION. Asking a model for "some other ideas" returns mush, because
 * mush is the centroid. "You never went near C1,B3 — Operations · Flow" is a specific direction
 * the passage demonstrably did not take, named from a fixed library rather than generated, which
 * is the only reason it is not itself slop.
 *
 * BIASED AWAY FROM WHAT IS HELD, deliberately: drawing a cell the passage already occupies would
 * report the draw as a discovery when it is a restatement, and that is the failure mode that
 * makes a null control worse than none.
 *
 * @param {string|string[]} textOrCoords  prose to place, or coords already computed
 * @param {{n?: number}} opts
 */
export async function latticeSample(textOrCoords, { n = 4 } = {}) {
  await load();
  if (!_snippets || _snippets.size === 0) {
    return { available: false, cells: [], reason: 'snippet-library-144.json not reachable' };
  }

  // The caller may hand us coords it already has, but if it hands us prose we place it
  // OURSELVES rather than trusting a coords list assembled elsewhere — the whole point is
  // that the avoid-set is the passage's actual placement.
  let held = [];
  let placement = null;
  if (Array.isArray(textOrCoords)) {
    held = textOrCoords.filter(Boolean);
  } else if (textOrCoords) {
    placement = await place(String(textOrCoords));
    held = placement?.coords || [];
  }
  const heldSet = new Set(held);

  const pool = [..._snippets.keys()].filter((c) => !heldSet.has(c));
  if (!pool.length) return { available: true, cells: [], held: held.length, pool: 0 };

  // Deterministic draw. A shuffle that returns different cells every click cannot be a control:
  // you could not tell a real signal from a reroll, and you would reroll until you liked it.
  // Seeded on the passage, so the same passage always draws the same null.
  const seedSrc = Array.isArray(textOrCoords) ? held.join('|') : String(textOrCoords || '');
  let seed = 2166136261;
  for (let i = 0; i < seedSrc.length; i++) { seed ^= seedSrc.charCodeAt(i); seed = Math.imul(seed, 16777619) >>> 0; }
  const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

  const picked = [];
  const taken = new Set();
  while (picked.length < Math.min(n, pool.length)) {
    const i = Math.floor(next() * pool.length);
    if (taken.has(i)) continue;
    taken.add(i);
    const coord = pool[i];
    const snip = _snippets.get(coord);
    let gist = '';
    if (_meaning?.coordGist) { try { gist = String(_meaning.coordGist(coord) || ''); } catch {} }
    if (!gist && snip?.snippet) gist = snip.snippet.split(/(?<=\.)\s/).slice(0, 2).join(' ');
    picked.push({ coord, hat: snip?.hat || null, gist: gist.slice(0, 240) });
  }

  return {
    available: true,
    cells: picked,
    held: held.length,
    pool: pool.length,
    library: _snippets.size,
    sensor: placement?.sensor ?? null,
  };
}

export async function activeRules(text) {
  await loadLens();
  if (!_lensMod?.lensPrompt) {
    return { available: false, count: 0, rules: [], reason: 'prompt-lens.mjs not reachable' };
  }
  try {
    const r = await _lensMod.lensPrompt(String(text).slice(0, 2000));
    const rules = (r?.retrieval?.rules || []).slice(0, 8).map((x) => ({
      name: x.name || x.rule_name || null,
      coord: x.coord || null,
      text: String(x.text || x.rule || '').slice(0, 220),
    }));
    return {
      available: true,
      count: r?.retrieval?.rules?.length || 0,
      rules,
      encircledIn: r?.receipt?.encircledIn || [],
      encircledOut: r?.receipt?.encircledOut || [],
      ms: r?.ms ?? null,
      reason: (r?.retrieval?.rules?.length || 0) === 0
        ? 'lens_rules table is unseeded in this checkout — run seedRules() in thetacog-mcp to populate it'
        : null,
    };
  } catch (err) {
    return { available: false, count: 0, rules: [], reason: String(err?.message || err) };
  }
}

/**
 * The writer's temperament, DISTILLED — not the whole rules document.
 *
 * This used to paste the first 6,000 characters of VOICE-RULES.md into every
 * guided prompt. Combined with the lattice block that made a 7,488-char fence —
 * ~2,080 tokens on top of the passage — and the measured consequence was fatal to
 * the experiment: tracks B and D timed out on 7 of 7 runs and produced ZERO cards,
 * while the unguided tracks answered fine. A guided arm that can never finish
 * cannot lose the A/B on merit; it just never competes.
 *
 * So the fence carries the OPERATIVE rules — the bar and the one-line
 * do/don't directives — and drops the prose that explains them. The model needs
 * the constraint, not the essay about the constraint.
 */
let _voiceRules = null;
export function voiceRules(repoRoot = process.cwd(), maxChars = 1400) {
  if (_voiceRules !== null) return _voiceRules;
  // Optional: a host project may supply its own voice rules. Absent is fine —
  // the fence then carries lattice placement only, which is still a fence.
  const p = process.env.REWRITE_VOICE_RULES || path.join(repoRoot, 'VOICE-RULES.md');
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const lines = [];

    // The Bar — the three-part test, kept because it is the whole standard.
    const bar = /## The Bar[^\n]*\n([\s\S]*?)(?=\n## )/.exec(raw);
    if (bar) {
      for (const m of bar[1].matchAll(/^\d+\.\s+\*\*(.+?)\*\*\s*—\s*(.+)$/gm)) {
        lines.push(`• ${m[1]} — ${m[2].replace(/\s+/g, ' ').trim()}`);
      }
    }

    // Operative one-liners: the "Cut any …" / "Never …" / "No …" directives.
    for (const m of raw.matchAll(/^-\s+(Cut any [^\n]+|Never [^\n]+|No [A-Z][^\n]+)$/gm)) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      if (t.length < 160) lines.push(`• ${t}`);
    }

    const distilled = lines.slice(0, 14).join('\n');
    _voiceRules = distilled.length > 80 ? distilled.slice(0, maxChars) : raw.slice(0, maxChars);
  } catch {
    _voiceRules = '';
  }
  return _voiceRules;
}

/**
 * Build the guidance block injected into +Tesseract rewrite prompts.
 * This is the ENTIRE difference between track A and track B (and C vs D) —
 * keeping it in one function is what makes the A/B honest.
 */
export async function guidanceBlock(paragraphText, { repoRoot = process.cwd(), maxCoords = 4 } = {}) {
  const p = await place(paragraphText);
  if (!p || p.error || !p.coords.length) {
    return { available: false, block: '', placement: p || null };
  }

  const lines = [];
  for (const coord of p.coords.slice(0, maxCoords)) {
    const snip = _snippets?.get(coord);
    let gist = '';
    if (_meaning?.coordGist) {
      try { gist = String(_meaning.coordGist(coord) || ''); } catch {}
    }
    if (!gist && _meaning?.coordMeaning) {
      try { gist = String(_meaning.coordMeaning(coord) || '').split(/(?<=\.)\s/).slice(0, 2).join(' '); } catch {}
    }
    if (!gist && snip?.snippet) gist = snip.snippet.split(/(?<=\.)\s/).slice(0, 2).join(' ');
    lines.push(`  • ${coord}${snip?.hat ? ` [${snip.hat}]` : ''} — ${gist.slice(0, 300)}`);
  }

  const rules = voiceRules(repoRoot);

  const block = `── TESSERACT SEMANTIC FENCE (deterministic placement, computed not guessed) ──

This passage has been placed on the 12×12 ShortLex lattice by gzip-mass + a
ballistic walk. It occupies these cells, and it must STILL occupy them after
your rewrite:

${lines.join('\n')}

Aperture ratio ${p.apertureRatio} (band 0.25–4)${p.apertureMismatch ? ' ⚠ MISMATCH — sensor out of calibration' : ' ✓ in band'} · σ ${p.sigma} · ${p.cells} cells lit · sensor: ${p.sensor}

What the fence means for your rewrite: the SEMANTIC PLACEMENT is fixed; the
PROSE is not. You may change any word. You may not move the meaning to a
different cell. A rewrite that reads beautifully but drifts off these
coordinates will be measured as RUPTURE and discarded — the measurement runs
after you, deterministically, and no amount of good prose talks it out of the
verdict.

── THE WRITER'S TEMPERAMENT (voice rules this book is bound by) ──
${rules}
`;

  return { available: true, block, placement: p };
}

export { TESSERACT_ROOT };
