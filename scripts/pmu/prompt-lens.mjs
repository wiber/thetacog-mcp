#!/usr/bin/env node
// scripts/pmu/prompt-lens.mjs — THE DIRECTIVE LENS (operator spec 2026-06-30, Option B).
// =============================================================================
// A prompt is interpreted from the repo's specific predictive perspective by NARROWING the semantic
// space BEFORE the cloud model runs. ONE pipeline, compression → on-chip → SQLite:
//
//   1. buildStubSpec(prompt)          the prompt is taken AS the stub-spec (intent) directly —
//                                     deterministic, no model — NOT an answer, a statement of intent.
//   2. boundaryFromStubSpec(stub)     the stub-spec is placed on the 144 lattice by the CANONICAL
//                                     gzip-NCD compression sensor (the seed), then the REAL on-chip
//                                     ballistic walk expands it (spec-deliver-walk / pmu-onchip
//                                     --ballistic, never the analytic shortcut). The Chebyshev hull
//                                     of the walked region IS the rigid fence around the intent.
//   3. retrieveRules(boundary)        the fence queries SQLite (lens_rules) for ONLY the load-bearing
//                                     rules whose coord falls inside it — merciless cutoff (MAX_RULES).
//   4. assembleInjection(stub,rules)  the lensed context (stub-spec + the few rules) — prepended to
//                                     the prompt so the cloud model sees only what THIS piece needs.
//
// Failure controls: MAX_RULES (no retrieval bloat) · LATENCY_BUDGET_MS (degrade gracefully, never
// block the human's prompt) — the Rust walk's speed is what keeps the local pipeline viable.
// Every run writes a receipt (which pixel, which rules, the king-move) for the QC/delegation trail.
//
//   node scripts/pmu/prompt-lens.mjs --prompt "fix the blog 500"          # print the lensed context
//   node scripts/pmu/prompt-lens.mjs --prompt "..." --json
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp as stampArtifact } from '../lens/staleness.mjs';
import { execFileSync } from 'node:child_process';
import { placePixel } from '../../src/lib/pmu/compress.mjs';   // CANONICAL compression sensor (gzip-NCD primary) — PIXEL placement + rule seeding
import { expandCoordName, canonicalName } from './reef-coord-name.mjs';   // canonical taxonomy EXTENDED with the reef's problem-space name — the SAME "full coordinate" the commit + project altitudes carry (scale-invariant, LLM-free)
import { hatName, hatRole, coordName } from './shortlex-names.mjs';   // THE HATS + full subcategory names per coordinate (operator 2026-08-06: names are the handholds; a bare coord is not grip)
import { ruleName as pileRuleName } from './name-the-pile.mjs';   // the ONE deterministic namer — stamped at reseed INSERT (lens_rules is derived)
import { walkShape, WALK_TIMEOUT_MS, CHAT_WALK_OPTS, SATURATION_FILL_PCT } from '../../src/lib/pmu/unified-drift.mjs';   // THE ONE WALK — the same on-chip ballistic engine the commit gate runs; σ is real-walk-derived; CHAT_WALK_OPTS keeps the chat walk SHALLOW (anti-saturation)
import { recordCost } from './lens-qwen.mjs';   // the token COST meter only — NO model call (2026-07-09: the lens is LLM-free end to end, prompt-level language + calling cycle both)
import { anchorRows } from './rule-trigger-anchors.mjs';   // TRIGGER ANCHORS (2026-08-01): rules re-seated at the pixels where the situations they govern land — the dual-anchor half of retrieval (source: data/pmu/rule-trigger-anchors.json, re-applied every reseed)
import { loadPairLib } from './region-message.mjs';            // the 144 ShortLex pair library
import { shortLexToBlock, NB } from './shortlex-coords.mjs';
import { promiseMass } from './promise-mass.mjs';
let _descentChildStatements = null;
try { ({ childStatementsFor: _descentChildStatements } = await import('./descent-context.mjs')); } catch { /* descent optional */ }
import { LAMBDA as PL_LAMBDA } from './burn-mass.mjs';
import { computeFromReceipt, renderHealthLine } from './lens-health-signals.mjs';   // the lens's OWN-CONTRIBUTION health signals (breadth · sparsity · per-signal utilization)

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.LENS_DB || resolve(REPO, '.thetacog/transcripts.db');
// SELF-HEAL source: the cycling background punch-list (scripts/punch-list-tick.sh reads the same file).
// Env-overridable so the guard test can point at a fixture. Read at CALL time (never module load) so a
// subprocess env override lands.
const PUNCH_LIST_DEFAULT = resolve(REPO, '.thetacog/punch-list.json');
// operator 2026-06-30: NOT a hard ≤3 — a SORTED list (~15), nearest-pixel first: rules 1-3 are the
// core "doctor" rules for the exact node, 4-15 the adjacent-perimeter rules. The sorted order hands
// the cloud model a topographical map (heaviest weight on top). The EXACT number is the optimization
// target, and how well the PMU sorts the relevant rules to the top IS the grand-slam readout of reef
// health (scripts/pmu/lens-sort-quality.mjs). Tunable via LENS_MAX_RULES.
const MAX_RULES = Number(process.env.LENS_MAX_RULES || 15);
// CHAR-BUDGET CAP (operator 2026-06-30): the count cap is an optimization target, but the HARD ceiling
// is the injected rules-CHARS — a real in-lane prompt's rules payload must fit under this so the lens
// stays token-cheap on EVERY prompt. retrieveRules fills core first (always admitted), then perimeter
// only while the running rules-chars stay ≤ budget. This is what keeps the perimeter "topographical map"
// from inflating the injection (the comms-email prompt was 1339ch / 3× over before this). Matches the
// TOKEN_CEILING the guard asserts (tests/lens/integration-contract.test.js). Tunable via env.
const RULES_CHAR_BUDGET = Number(process.env.LENS_RULES_CHAR_BUDGET || 400);
const BOUNDARY_RADIUS = Number(process.env.LENS_RADIUS || 2);  // Chebyshev radius of the fence (in blocks)
// ── DETERMINISTIC QUALITY FLAGS (operator 2026-06-30) — MEASURABLE thinness, computed SYNC, no LLM ─────
// These are the deterministic quality checks:
// these cheap deterministic checks catch MEASURABLE defects (char counts, the collapse-magnet coord) on
// they run on the sync path with zero model dependency, so a thin/degenerate turn is flagged RELIABLY every time —
// even when ollama is down or the audit hasn't landed. (CLAUDE.md: "LLM never on the blocking/reliability
// path"; "measure, don't assert".)
// thin-spec: the extrapolated stub-spec is too short to have captured the intent (under-captured directive).
// LENS GATES FROM SQLITE (operator 2026-07-02, AR-15): the floors are DATA in tc_pipeline_gates,
// read once at module load through the ONE shared reader (pipeline-gates.mjs) — same rulebook every
// pipeline consults; env still overrides for experiments; builtin default if the table is absent.
// Sync-path cost: zero (module-load only).
let _gateThinSpec = 120, _gateMinRules = 3;
try {
  const { readGate } = await import('./pipeline-gates.mjs');
  _gateThinSpec = readGate('lens-thin-spec-chars', 120);
  _gateMinRules = readGate('lens-min-rules', 3);
} catch { /* shared reader optional — builtins hold */ }
const THIN_SPEC_CHARS = Number(process.env.LENS_THIN_SPEC_CHARS || _gateThinSpec);
export const LENS_MIN_RULES = Number(process.env.LENS_MIN_RULES || _gateMinRules);
// C,C is the gzip-NCD COLLAPSE MAGNET: when a prompt has no real domain pull, the fallback compression
// sensor funnels it to the block-level "C,C" coord (real repo-domains ALWAYS carry a sub-anchor: C,C1 /
// C,C2 / …). A center or top-seed of exactly "C,C" = a degenerate placement, no domain gravity.
const isCollapseMagnet = (coord) => /^C,C$/.test(String(coord || '').trim());
// ONE shared degenerate test (2026-07-03, clarification mode): the receipt's ⚠ C,C-degenerate flag and
// the injection's CLARIFICATION MODE must key off the SAME expression — a split here would flag a turn
// degenerate while still injecting stale banks (or vice versa). Degenerate = routing produced NO domain
// (boundary.domain null → gzip fallback) AND the center/top-seed is the C,C collapse magnet — the true
// "no domain gravity" state (a C,C seed alone is NOT degenerate when keyword routing found a real domain).
export function isDegenerateBoundary(boundary = {}) {
  return !boundary.domain && (isCollapseMagnet(boundary.center)
    || isCollapseMagnet(((boundary.walkProvenance && boundary.walkProvenance.seedCoords) || [])[0]));
}
const LATENCY_BUDGET_MS = Number(process.env.LENS_BUDGET_MS || 1200); // local pipeline deadline; degrade past it
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

// ── REEF-HEALTH cache (operator 2026-06-30: per-prompt receipt shows reef-health %, but computing it
// live = 7 fixture lens runs (~120ms node spawn) → too heavy for the SYNC critical path). So we CACHE
// the last reef_health (scripts/pmu/lens-sort-quality.mjs) in a tiny file and refresh it OUT-OF-BAND
// (the background refine path / CLI / a cron). The sync receipt only READS the cache (sub-ms). TTL keeps
// the background refresh from re-running on every prompt.
const REEF_HEALTH_CACHE = resolve(REPO, '.thetacog/lens-reef-health.json');
const REEF_HEALTH_TTL_MS = Number(process.env.LENS_REEF_HEALTH_TTL_MS || 30 * 60 * 1000); // 30 min
export function readReefHealth({ file = REEF_HEALTH_CACHE } = {}) {
  try { const j = JSON.parse(readFileSync(file, 'utf8'));
    // The clock is whichever the writer stamped; the PERIOD comes from the artifact when it declares
    // one, so a reader no longer has to hardcode the TTL to know whether the number is current.
    const atMs = Date.parse(j.last_success ?? '') || Number(j.ts) || 0;
    const ttlMs = Number(j.period_seconds) > 0 ? Number(j.period_seconds) * 1000 : REEF_HEALTH_TTL_MS;
    const ageMs = Date.now() - atMs;
    return { pct: Math.round(Number(j.reef_health) * 100), ageMs, ageSeconds: Math.round(ageMs / 1000),
      periodSeconds: Math.round(ttlMs / 1000), stale: ageMs > ttlMs, missing: false }; }
  catch { return { pct: null, ageMs: Infinity, stale: true, missing: true }; }
}
// refresh = shell the grand-slam readout (separate process → no circular import) and cache reef_health.
// Best-effort: never throws, never blocks the sync path (only called from CLI / background / --refresh-health).
export function refreshReefHealthCache({ file = REEF_HEALTH_CACHE, force = false } = {}) {
  if (!force && !readReefHealth({ file }).stale) return readReefHealth({ file }); // fresh enough, skip the spawn
  try {
    const out = execFileSync(process.execPath, [resolve(REPO, 'scripts/pmu/lens-sort-quality.mjs'), '--json'],
      { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(out);
    mkdirSync(dirname(file), { recursive: true });
    // `ts` stays for the readers that already parse it; last_success + period_seconds are what let
    // ANY reader compute the age without knowing which script wrote the file.
    writeFileSync(file, JSON.stringify(stampArtifact(
      { reef_health: j.reef_health, optimal_rule_count: j.optimal_rule_count, ts: Date.now() },
      { periodSeconds: Math.round(REEF_HEALTH_TTL_MS / 1000) })) + '\n');
  } catch { /* leave the previous cache in place */ }
  return readReefHealth({ file });
}

// ── stage 1 — the prompt IS the stub-spec (intent, repo-grounded) — deterministic, no model ────────
// (2026-07-09, operator: "remove any mention or call to qwen or llm from the pmu lens — the prompt
// level language and calling cycle now.") The prompt text itself is the honest statement of intent;
// routeToDomain (keyword + anchor-phrase, zero model) does the domain placement downstream.
export async function buildStubSpec(prompt) {
  const raw = String(prompt).slice(0, 800);
  return { intent: raw, domain: 'other', source: 'deterministic(prompt-as-intent)' };
}

// ── the REPO-DOMAIN REEF — anchors are THIS repo's real domains, each at a DISTINCT coord, each with
// its winning template + load-bearing rules. Routing here is what BREAKS the C,C collapse: a 5-word
// prompt is too short for raw gzip-NCD over the generic 144, so we route by repo-domain (keyword +
// anchor-phrase overlap, refined by gzip-NCD against the domain's vocab) to a distinct
// pixel. "UI work → the UI pixel; database work → the database pixel."
const REEF_FILE = (() => { try { return JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')); } catch { return {}; } })();
const REEF = REEF_FILE.domains || [];
// STANDING band (operator 2026-07-02: "caching is great, we want it to actively prevent forgetting"):
// the 2-3 never-forget rules injected EVERY turn regardless of domain — active repetition at exactly
// the cadence forgetting happens (each turn), a fixed ~200-char cost.
export const STANDING = REEF_FILE.standing || [];
export const WORK_TEMPLATES = REEF_FILE.templates || [];
// pick the named work-kind template by stemmed token overlap (same stem as the rule sort)
export function pickWorkTemplate(text) {
  const stem = (w) => (/ss$/.test(w) ? w : w.replace(/s$/, ''));
  const toks = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map(stem));
  let best = null, bestN = 0, second = null, secondN = 0;
  for (const t of WORK_TEMPLATES) {
    const n = String(t.when).split(/\s+/).map(stem).filter((w) => toks.has(w)).length;
    if (n > bestN) { second = best; secondN = bestN; best = t; bestN = n; }
    else if (n > secondN) { second = t; secondN = n; }
  }
  if (bestN <= 0) return null;
  // The runner-up rides along so the receipt can surface a STEERING moment when the pick was close
  // (operator 2026-07-09: the lens "can prompt the operator to steer or clarify the steering or not").
  // Same object shape as before plus two underscore-props — every existing caller reads .name/.skeleton.
  return { ...best, _pickScore: bestN, _runnerUp: second && secondN > 0 ? { name: second.name, score: secondN } : null };
}
// the FULL template-library denominator: every per-domain template + every named work-shape template.
// This is the "M" in the receipt's `templates N/M` (operator 2026-07-09: "it says templates 1 — should
// it not be 1/many?"). Module-load compute, $0 per prompt.
export const TEMPLATES_TOTAL = REEF.filter((d) => d.template).length + WORK_TEMPLATES.length;
// COVERAGE-DENSITY denominators (operator 2026-07-02: the "N of M" without touching the PMU cycle):
// computed ONCE at module load — per-prompt it is pure arithmetic on in-memory data.
export const REEF_RULES_TOTAL = REEF.reduce((n, d) => n + (d.rules || []).length, 0);
// 📈 SERIES SNAPSHOT (operator 2026-07-02: "do we add vega to the list?") — computed ONCE at module
// load from the per-commit measure-history tail; population honestly labeled (all-commits offPct>15,
// NOT the sealed-calibration premium rate). $0 per prompt.
export const SERIES_SNAPSHOT = (() => { try {
  const lines = readFileSync(resolve(REPO, 'data/pmu/measure-history.ndjson'), 'utf8').trim().split('\n').slice(-120);
  const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sig = rows.map((t) => Number(t.sigmaDrift)).filter(Number.isFinite);
  if (sig.length < 8) return null;
  const m = sig.reduce((a, b) => a + b, 0) / sig.length;
  const vega = Math.sqrt(sig.reduce((a, x) => a + (x - m) * (x - m), 0) / (sig.length - 1));
  const br = rows.filter((t) => Number(t.offPct) > 15).length;
  return { n: rows.length, vega: +vega.toFixed(2), breachPct: +(100 * br / rows.length).toFixed(1) };
} catch { return null; } })();
// PER-DOMAIN GOVERNED PATHS (operator 2026-07-02: "meta rules with file paths attached — automatically
// included"): merged from lens_rule_meta at MODULE LOAD (one SQLite read per process, $0 per prompt).
// Rendered as the 📁 line so the model is steered to the right part of the codebase before it searches.
const DOMAIN_PATHS = (() => { try {
  const rows = JSON.parse(execFileSync('sqlite3', ['-json', resolve(REPO, 'data/thetacoach.db'),
    "SELECT domain, paths FROM lens_rule_meta WHERE paths IS NOT NULL;"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '[]');
  const m = new Map();
  for (const r of rows) { const set = m.get(r.domain) || new Set(); for (const g of JSON.parse(r.paths)) set.add(g); m.set(r.domain, set); }
  return m;
} catch { return new Map(); } })();
// REEF-TOTAL-CHARS (operator 2026-06-30): the total character size of the reef the lens is searching —
// the sum of every domain's content (domain · vocab · template · tools · rules). Rendered on the rules
// line ("reef N.Nk ch") so the receipt shows how big the searched corpus is. Computed ONCE at module
// load (REEF is already parsed here) — no per-prompt work, keeps the sync path fast.
const REEF_TOTAL_CHARS = (() => { try { return REEF.reduce((n, d) =>
  n + String(d.domain || '').length + String(d.vocab || '').length + String(d.template || '').length
    + String(d.tools || '').length + (d.rules || []).join('').length, 0); } catch { return 0; } })();
export function reefTotalChars() { return REEF_TOTAL_CHARS; }
// 🏞️ THE BANKS — per-domain standing specs (lens-reef.json d.specs). The reef IS the map: specs are
// git-versioned next to the rules they govern, seeded FROM spec documents, existence-gated by
// tape-health class broken-banks. Injected every call by assembleInjection.
export function domainSpecs(domain) {
  if (!domain) return [];
  const d = REEF.find((x) => x.domain === domain);
  return (d && Array.isArray(d.specs)) ? d.specs : [];
}
export function allBanks() { return REEF.filter((d) => Array.isArray(d.specs) && d.specs.length).map((d) => ({ domain: d.domain, specs: d.specs })); }
export function routeToDomain(text) {
  if (!REEF.length) return null;
  const t = String(text).toLowerCase();
  const words = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  // DECIDABILITY INTEGRITY (2026-07-04): the placement score is DETERMINISTIC — keyword overlap + the
  // anchor-phrase override, ZERO model, no tiebreak dependency either. The receipt says "LLM-free (no
  // model in this verdict)"; that is literally true — an underwriter recomputing the placement gets the
  // SAME coordinate every time, by construction.
  //   ANCHOR-PHRASE OVERRIDE (2026-07-03): a per-domain `anchors` literal-phrase match is a strong (+5)
  //   single-shot bonus so a self-declared task type ("push a blog post") outweighs an incidental tangent.
  //   Guarded by tests/pmu/lens-anchor-phrase-override.test.js.
  const scored = REEF.map((d) => {
    const vocab = String(d.vocab).toLowerCase().split(/\s+/);
    // SHORT-STEM GUARD (S2, 2026-07-20): substring matching needs ≥6 chars — "party" was
    // substring-hitting "counterparty" and "ea" hitting "treaty", stealing the existing-
    // relationship boundary (the cycle-3 held-out lock). Short stems match as exact words only.
    const hits = vocab.reduce((n, v) => n + (words.has(v) || (v.length >= 6 && t.includes(v)) ? 1 : 0), 0);
    const anchors = Array.isArray(d.anchors) ? d.anchors : [];
    const anchorBonus = anchors.some((a) => t.includes(String(a).toLowerCase())) ? 5 : 0;
    return { ...d, score: hits + anchorBonus, hits, anchorBonus };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score <= 0) return null;   // no confident keyword domain → caller falls back to gzip-NCD
  // a tie among domains sharing the top score resolves to the FIRST in REEF order (Array.sort is stable) —
  // deterministic, no tiebreak vote of any kind.
  return top;
}

// ── stage 2 — place the intent on the repo reef (distinct domain pixel), fence it (Chebyshev) ───────
// Primary: route to the repo-domain pixel. Fallback (no confident domain): the canonical gzip-NCD seed
// + Chebyshev radius (spec-deliver-walk / pmu-onchip --ballistic is the deeper expansion). Never analytic.
export async function boundaryFromStubSpec(stub, { pairLib = loadPairLib(), radius = BOUNDARY_RADIUS, walkTimeoutMs = WALK_TIMEOUT_MS } = {}) {
  const text = stub.intent || stub.text || String(stub);
  // ── timing split (operator 2026-06-30, actuarial receipt): the routing is timed in μs (sub-ms), the
  // gzip-NCD COMPRESSION call (placePixel, fallback PIXEL only) in ms. In the repo-domain path placePixel
  // is not called → compressMs 0 (real). ROUTING places the PIXEL (keyword+anchor-phrase → distinct
  // repo-domain coord — this is what breaks the C,C collapse); it is unchanged.
  const tRoute = performance.now();
  const dom = routeToDomain(text);
  const routeUs = Math.round((performance.now() - tRoute) * 1000);   // μs — sub-ms routing never shows 0
  let center, domain = null, template = '', domainRules = null, compressMs = 0;
  if (dom) { center = dom.coord; domain = dom.domain; template = dom.template || ''; domainRules = dom.rules || []; }
  else { const tC = Date.now(); const placed = placePixel(text, pairLib); compressMs = Date.now() - tC; center = placed?.pixel || null; }   // gzip-NCD seed for the PIXEL only
  // ── THE METAL (operator 2026-06-30 unification): σ is now the REAL on-chip ballistic walk on the
  // prompt-intent — the SAME walkShape the commit gate runs, seeded from the prompt's lit anchors. There
  // is no delivered-code "reality" at chat time, so this σ is INTENT-PLACEMENT (the walk's placement
  // sharpness), honestly labeled — NOT the commit's intent-vs-reality coverage. Graceful + MARKED
  // gzip-fallback ONLY if the pmu-onchip binary is missing or a walk blows the tight wall-clock timeout
  // (never a silent metal claim). The walk RETURNS provenance (coords/plies/cells/seed) so the follow-up
  // lens-trace persister can record it.
  // CHAT_WALK_OPTS keeps this walk SHALLOW (maxDepth = CHAT_WALK_MAX_DEPTH) — the measured anti-saturation
  // floor (see unified-drift.mjs). The walk RETURNS its fill readout (matrix lit cells / 20736, walks/s,
  // saturated?) so the receipt can surface "walk: N plies · ~Yk w/s · fill Z%" and flag ⚠ SATURATED.
  const tWalk = performance.now();
  let walkRes = null;
  try { walkRes = await walkShape(text, { timeoutMs: walkTimeoutMs, opts: CHAT_WALK_OPTS }); } catch { walkRes = null; }
  const walkMs = +(performance.now() - tWalk).toFixed(1);
  // ── UN-IDLE THE GZIP (operator 2026-06-30): walkShape returns the time it spent in the gzip-NCD SEED
  // (litScores over the 144 targets) — REAL gzip work that ALWAYS runs and was previously hidden inside
  // walkMs. Surface it as the true gzip contribution and SUBTRACT it from the PMU number so PMU is the
  // pure metal walk (no gzip masquerading as walk time).
  const seedGzipUs = walkRes ? (walkRes.seedGzipUs || 0) : 0;
  const walkMetalMs = +Math.max(0, walkMs - seedGzipUs / 1000).toFixed(1);
  const sigma = walkRes ? walkRes.sigma : 0;
  const sensor = walkRes ? walkRes.sensor : 'gzip-fallback';
  const walkPlies = walkRes ? walkRes.plies : 0;
  const walkFillPct = walkRes ? (walkRes.fillPct || 0) : 0;
  const walkWalksPerSec = walkRes ? (walkRes.walksPerSec || 0) : 0;
  const walkSaturated = walkRes ? !!walkRes.saturated : false;
  const walkProvenance = walkRes ? { coords: walkRes.coords, plies: walkRes.plies, cells: walkRes.cells, matrixCells: walkRes.matrixCells, fillPct: walkRes.fillPct, walksPerSec: walkRes.walksPerSec, saturated: walkRes.saturated, seedCoords: walkRes.seedCoords, ms: walkRes.ms } : null;
  let br = 0, bc = 0; if (center) { try { ({ br, bc } = shortLexToBlock(center)); } catch { /* keep 0,0 */ } }
  const box = { r0: Math.max(0, br - radius), r1: Math.min(NB - 1, br + radius), c0: Math.max(0, bc - radius), c1: Math.min(NB - 1, bc + radius) };
  // ── TIER-1 WIRE, PRIMED + GATED (operator 2026-07-22): the RAM collision engine's {code+rules+hats}
  // injection payload — DORMANT by default. Behind LENS_MASS_INJECT=1 ONLY; lazy-imported + engine
  // cached so it costs nothing when off. Flip it the MOMENT the transcript/book-index cleanup lands
  // (builder's bifurcation) — injectionPayload is prose-safe, so an early flip degrades to code mass,
  // never book text in a code lane. Flag OFF ⇒ massInjection null ⇒ lens output unchanged (guarded).
  // LIVE via env OR a reversible flag file (.thetacog/lens-mass-inject.on — `touch` to flip, `rm` to revert).
  let massInjection = null, massArm = null;
  const massOn = process.env.LENS_MASS_INJECT === '1' || existsSync(resolve(REPO, '.thetacog/lens-mass-inject.on'));
  if (massOn && center) {
    try {
      const { buriedArm } = await import('./grip-ab-sweep.mjs');
      massArm = buriedArm(text);                         // BURIED A/B: only arm 2 gets injection → the tape
      if (massArm === 2) {                               // records control (arm 0/1) vs treatment (arm 2) = a REAL A/B
        const { loadCollisionEngine } = await import('./mass-collision.mjs');
        if (!globalThis.__COLL_ENGINE) globalThis.__COLL_ENGINE = loadCollisionEngine();
        // RECONCILED: pull mass at the coord the lens already routed to → O(1), no second walk, aligned.
        massInjection = await globalThis.__COLL_ENGINE.injectionPayload(text, { coord: center });
        if (massInjection) massInjection.arm = massArm;
      }
    } catch { massInjection = null; }
  }
  return { center, block: [br, bc], radius, box, sigma, sensor, domain, template, domainRules, walk: dom ? 'repo-domain' : 'ballistic-seed', compressMs, seedGzipUs, walkMs, walkMetalMs, routeUs, walkPlies, walkFillPct, walkWalksPerSec, walkSaturated, walkProvenance, walkHops: walkRes ? (walkRes.hops || 0) : 0, massInjection, massArm };
}

// ── stage 3 — the SORTED rules for this pixel: the domain's curated load-bearing rules first (the
// "doctor" rules), then SQLite rules near the fence (the adjacent perimeter), capped at MAX_RULES ────
// knobs (V2 convergence sweep, spec §5.2 — ALL optional, defaults = today's behavior exactly):
//   charBudgetOverride / coreFloorOverride — bypass the tc_pipeline_gates read for a sweep vector
//   scoreTheta — IDF admission cutoff: core rules ranked BELOW the floor are dropped when their
//                relevance score < theta (the floor's top rules always land, as today)
export function retrieveRules(boundary, { db = DB, cap = MAX_RULES, intentText = '', charBudgetOverride = null, coreFloorOverride = null, scoreTheta = null } = {}) {
  const meatByKey = new Map();   // rule-key → mined appendix; applied POST-admission (meat never evicts a rule)
  let topWhy = '';
  let selectionTrace = [];   // the ranked picks + relevance scores — LLM-FREE (deterministic IDF-density)
  const coreAvailable = (boundary.domainRules || []).length;   // the domain's full denominator
  // NAMES OF THE PILE (operator 2026-08-06: the rule has a NAME and the text content) — stored on the
  // entities themselves (reef rule_names sidecar + lens_rules.name column, stamped by name-the-pile.mjs),
  // read here so every surface can say WHICH rule, not just how many. Key = rule text ≤60ch (the same
  // convention derived_statements rides).
  const ruleNames = {};
  try { const d = REEF.find((x) => x.domain === boundary.domain); Object.assign(ruleNames, (d && d.rule_names) || {}); } catch { /* names optional */ }
  // PER-PROMPT RELEVANCE SORT of the curated core (operator 2026-07-02: "experiment with the pmu
  // lens until the spec reef sorts the RIGHT rules"). Curation order was the only order — a rule
  // appended last always rendered last, so the load-bearing rule for THIS prompt could sit at
  // position 7 behind the cap. Now: deterministic token-overlap between the intent and each rule
  // (sub-ms, no model), STABLE on ties so curation order remains the tiebreak. The receipt's
  // sort-quality fixture harness (lens-sort-quality.mjs) is the measuring stick.
  let core = (boundary.domainRules || []).slice();            // the exact domain's curated rules
  if (intentText && core.length > 1) {
    // Sibilant-aware plural strip ONLY (round-4 finding: the naive 'es' rule corrupted grades→grad,
    // losing the 'grade' match entirely). glasses→glasses stays; monologues→monologue; posts→post.
    const stem = (w) => (/ss$/.test(w) ? w : w.replace(/s$/, ''));
    const toks = new Set(String(intentText).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).map(stem));
    // PER-DOMAIN IDF DENSITY (round-4 finding: 'blog'/'post'/'with' appear in most of a domain's rules
    // and discriminate nothing — raw counts let them drown the one rare token that matters). Each
    // matched token contributes 1/df (df = how many of THIS domain's rules contain it), normalized by
    // sqrt(rule length). Deterministic, sub-ms, no model — the sort stays inside the Governor.
    // DERIVED STATEMENTS (spec §3.2, S2 2026-07-20): each rule's token pool = anchor text +
    // its historical derived statements (the measured miss prompts seeded by lens-s2-seed).
    // A paraphrase that failed once now scores its rule directly — the magnet, densified at rest.
    const derivedMap = (() => { const d = REEF.find((x) => x.domain === boundary.domain); return (d && d.derived_statements) || {}; })();
    // DEPTH-1 MEAT (2026-07-21, the sim's own finding: W1 froze at 76% while mass grew 52% — the
    // projection was BLIND TO THE SUB-WELLS; child statements were settle-only, never mined at
    // prompt time). The routed lane's sub-well children join the meat pool, tagged with their
    // child coord so the reader sees WHERE in the tree the statement lives. nogo + building wells
    // stay invisible (quarantine + staging are absolute). Deterministic, one JSON read, LLM-free.
    const childStmts = (() => {
      // THE ONE DESCENT, Consumer A (no-fork phase 2): the child pool comes from the SHARED
      // module — the lens never re-derives well reads (a divergent copy here was the fork the
      // guard exists to kill). Same nogo/staging invisibility, same tags, one source.
      try {
        const d = REEF.find((x) => x.domain === boundary.domain);
        if (!d || !d.coord || !_descentChildStatements) return [];
        return _descentChildStatements(String(d.coord));
      } catch { return []; }
    })();
    const ruleToks = core.map((r) => {
      const extra = (derivedMap[String(r).slice(0, 60)] || []).join(' ');
      return new Set(`${r} ${extra}`.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).map(stem));
    });
    const df = new Map();
    for (const set of ruleToks) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    const score = (i) => {
      let sum = 0;
      for (const w of ruleToks[i]) if (toks.has(w)) sum += 1 / (df.get(w) || 1);
      return ruleToks[i].size ? sum / Math.sqrt(ruleToks[i].size) : 0;
    };
    const ranked = core.map((r, i) => [r, score(i), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    // θ_score (V2, spec §5.2): an ADMISSION cutoff below the floor — rank < floor always lands
    // (today's guarantee), beyond the floor a rule needs relevance ≥ theta. null = off (today).
    const thetaFloor = coreFloorOverride != null ? coreFloorOverride : 3;
    core = (scoreTheta != null)
      ? ranked.filter((x, idx) => idx < thetaFloor || x[1] >= scoreTheta).map(x => x[0])
      : ranked.map(x => x[0]);
    // ── THE MEAT (operator 2026-07-21: "what makes it useful for projecting the reef down for a
    // particular prompt"): harvested derived statements were RANKING FUEL only — the slice carried
    // authored rule text and none of the mined mass. Now each of the top-2 picked rules carries its
    // single best-matching derived statement AS CONTENT (same 1/df scoring vs the prompt's own
    // tokens, min score > 0, 220ch cap each) — so every seat the loop lands makes tomorrow's
    // slices measurably richer. Deterministic, sub-ms, budget-bounded; the Governor stays LLM-free.
    // PROMISE-MASS INJECTION RANKER (ratchet-8, the one-sensor MMR): relevance scores NOMINATE,
    // but the PROMISE decides — a candidate is injected only if it SETTLES against the hood of
    // the prompt plus everything already injected (three gzips: compresses WITH the context,
    // stays unique among the picks). The incident it cures rode this very pass's own receipt:
    // two rules injected the IDENTICAL depth-1 statement — relevance has no memory of what the
    // slice already carries; the apparatus does. Bounded (top-5 nominees/rule), sub-ms, LLM-free.
    const injected = [];
    for (let ri = 0; ri < Math.min(2, ranked.length); ri++) {
      const [rTxt, rScore, rIdx] = ranked[ri];
      if (!(rScore > 0)) break;
      const stmts = derivedMap[String(rTxt).slice(0, 60)] || [];
      const scoreStmt = (s) => {
        const st = new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).map(stem));
        let sc = 0; for (const w of st) if (toks.has(w)) sc += 1 / (df.get(w) || 1);
        return st.size ? sc / Math.sqrt(st.size) : 0;
      };
      const nominees = [];
      for (const s of stmts) { const sc = scoreStmt(s); if (sc > 0) nominees.push({ s, sc, child: null }); }
      for (const { s, child } of childStmts) { const sc = scoreStmt(s); if (sc > 0) nominees.push({ s, sc, child }); }
      nominees.sort((a, b) => b.sc - a.sc);
      let bestS = null, bestScore = 0, bestChild = null;
      for (const n of nominees.slice(0, 5)) {
        if (injected.length) {
          const pm = promiseMass(String(n.s), [{ coord: 'prompt', text: String(intentText || '') }, ...injected.map((t, i) => ({ coord: `inj${i}`, text: t }))], PL_LAMBDA);
          if (!pm.settled) continue;   // near-copy of what the slice already carries — refused
        }
        bestS = n.s; bestScore = n.sc; bestChild = n.child;
        break;
      }
      // QUALITY FLOOR (2026-07-21, the CTA-junk incident: a marketing fragment rode a ui-frontend
      // receipt because ANY score > 0 injected): the statement must clear an ABSOLUTE relevance
      // floor AND a fraction of its rule's own score — weak overlap is ranking fuel, never content.
      const MEAT_FLOOR = 0.08;
      if (bestS && bestScore >= MEAT_FLOOR && bestScore >= 0.3 * rScore) {
        // MEAT NEVER EVICTS A RULE (the calibration regression, 2026-07-22: inflating core strings
        // BEFORE admission let one meat-carrying rule eat the char budget — n_actual collapsed 4-6→3
        // and labeled overlap halved 49.86→26.18). Record the meat by rule key; the admission loop
        // budgets AUTHORED text only; meat is appended to admitted rules AFTER the budget gate.
        meatByKey.set(String(rTxt).slice(0, 40), `
     ↳ mined${bestChild ? ` (depth-1 ${bestChild})` : ''}: ${String(bestS).slice(0, 220)}`);
        injected.push(String(bestS));
      }
    }
    if (ranked.length && ranked[0][1] > 0) {
      const w = [...ruleToks[ranked[0][2]]].filter(t => toks.has(t)).slice(0, 4);
      topWhy = w.join(', ');   // the matched stems — WHY this rule tops for THIS prompt
    }
    // THE SELECTION TRACE (operator 2026-07-18 — "I need to see the logic of the filter, not just
    // the aggregate precision"): expose the ranked picks + their relevance scores + the matched
    // stems. The scores already exist; this makes the PICK auditable, on the tape and page. NCD is
    // the sensor of record, but the per-rule RANKER is this deterministic IDF-density score.
    selectionTrace = ranked.map(([r, sc, i], rank) => ({
      rank, rule: String(r).slice(0, 90), score: +sc.toFixed(4),
      why: [...ruleToks[i]].filter(t => toks.has(t)).slice(0, 4).join(', ') || null,
    }));
  }
  const perimeter = [];
  // ── TRIGGER-CORE (operator 2026-08-01, the dual-anchor fix): a src='trigger' row sitting at the
  // prompt's EXACT pixel was curated/learned precisely for prompts that land there — it must not
  // fight the IDF-density ranker on surface tokens (trigger-shape ≠ content-shape is the very
  // reason it was missed; measured live: NEVER-FORK anchored at C,C still lost the 400ch budget to
  // nearer noise). Exact-pixel trigger hits are ALWAYS admitted, like the core floor, capped at 2.
  const triggerCore = [];
  // ── timing split (operator 2026-06-30, actuarial receipt): the SQLite query (the perimeter fetch) is
  // timed separately from the JS merge/dedup/cap (the SORT). Both surface as distinct receipt numbers.
  let sqlMs = 0;
  if (existsSync(db)) {
    const { r0, r1, c0, c1 } = boundary.box;
    // name column first; a pre-migration db (no name column) falls back to the unnamed query rather
    // than losing the perimeter entirely.
    const sqlFor = (cols) => `SELECT ${cols} FROM lens_rules
      WHERE br BETWEEN ${r0} AND ${r1} AND bc BETWEEN ${c0} AND ${c1}
      ORDER BY ((br-${boundary.block[0]})*(br-${boundary.block[0]}) + (bc-${boundary.block[1]})*(bc-${boundary.block[1]})) ASC, (src='trigger') DESC, weight DESC
      LIMIT ${cap};`;
    const tSql = Date.now();
    try {
      let rows = [];
      try { const out = execFileSync('sqlite3', ['-json', db, sqlFor('rule, name, br, bc, weight, src')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); rows = out ? JSON.parse(out) : []; }
      catch { const out = execFileSync('sqlite3', ['-json', db, sqlFor('rule, br, bc, weight, src')], { encoding: 'utf8' }).trim(); rows = out ? JSON.parse(out) : []; }
      for (const x of rows) {
        if (x.name) ruleNames[String(x.rule).slice(0, 60)] = x.name;
        if (x.src === 'trigger' && x.br === boundary.block[0] && x.bc === boundary.block[1] && triggerCore.length < 2) triggerCore.push(x.rule);
        else perimeter.push(x.rule);
      }
    } catch { /* sqlite optional */ }
    sqlMs = Date.now() - tSql;
  }
  // merge: core (sorted by curation) then perimeter, dedup, cap — nearest-pixel-first overall. This is
  // the SORT stage (separate timing from the SQL fetch above). CORE rules are ALWAYS admitted (the
  // load-bearing doctor rules for the exact node); PERIMETER rules are admitted nearest-first only while
  // the running rules-chars stay within RULES_CHAR_BUDGET (a too-long perimeter rule is skipped, not a
  // hard stop, so a nearer-but-shorter rule downstream can still fill the remaining budget). The chars
  // accounting mirrors the receipt's rulesChars (rules.join('\n').length → +1 separator per added rule).
  const tSort = performance.now();
  const coreKeys = new Set(core.map((r) => r.slice(0, 40)));
  // UNIFIED BUDGET (operator 2026-07-02: densified domains at 8-11 core rules busted the 400 ceiling;
  // the relevance sort makes a core cap SAFE — the right rules top, the tail is noise for THIS prompt).
  // Knobs are ON-DISK rows in tc_pipeline_gates (append/update/optimize without code changes):
  //   lens-rules-char-budget (400) · lens-min-core-rules (3, always admitted even over budget).
  let coreFloor = 3, charBudget = RULES_CHAR_BUDGET;
  if (charBudgetOverride != null || coreFloorOverride != null) {
    // sweep vector (V2): explicit knobs bypass the gates read — deterministic per vector
    if (charBudgetOverride != null) charBudget = charBudgetOverride;
    if (coreFloorOverride != null) coreFloor = coreFloorOverride;
  } else try {
    const g = execFileSync('sqlite3', ['-json', resolve(REPO, 'data/thetacoach.db'), "SELECT gate, value FROM tc_pipeline_gates WHERE gate IN ('lens-rules-char-budget','lens-min-core-rules') AND enabled=1;"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    for (const row of (g ? JSON.parse(g) : [])) {
      if (row.gate === 'lens-rules-char-budget') charBudget = parseInt(row.value, 10) || charBudget;
      if (row.gate === 'lens-min-core-rules') coreFloor = parseInt(row.value, 10) || coreFloor;
    }
  } catch { /* gates table optional — builtins hold */ }
  const seen = new Set(), rules = [];
  const triggerKeys = new Set(triggerCore.map((r) => r.slice(0, 40)));
  let chars = 0, coreAdmitted = 0;
  for (const r of [...triggerCore, ...core, ...perimeter]) {
    const k = r.slice(0, 40);
    if (seen.has(k)) continue;
    const isCore = coreKeys.has(k);
    const projected = rules.length === 0 ? r.length : chars + 1 + r.length; // join('\n') accounting
    if (triggerKeys.has(k)) { /* exact-pixel trigger anchor: always lands (≤2, ≤240ch each) */ }
    else if (isCore && coreAdmitted < coreFloor) { /* floor: top-sorted core always lands */ }
    else if (projected > charBudget) continue;                               // everything else budget-gated
    if (isCore) coreAdmitted++;
    seen.add(k); rules.push(r); chars = projected;
    if (rules.length >= cap) break;
  }
  // SORT timing in MICROSECONDS (operator 2026-06-30): the merge/dedup/cap is sub-millisecond, so ms
  // rounded to 0 on every prompt — μs makes the active op visible (e.g. sort 45μs), never the bare "0".
  const sortUs = Math.round((performance.now() - tSort) * 1000);
  // meat appended AFTER the budget gate — admitted set identical to the no-meat world by construction
  const rulesOut = rules.map((r) => { const m = meatByKey.get(r.slice(0, 40)); return m ? r + m : r; });
  // ⚓ VISIBILITY (operator 2026-08-01): the receipt note carries how many trigger anchors fired,
  // so the flywheel's compounding is visible per turn instead of taken on faith.
  const triggerAdmitted = rules.filter((r) => triggerKeys.has(r.slice(0, 40))).length;
  return { rules: rulesOut, ruleNames, sqlMs, sortUs, topWhy, coreAvailable, triggerAdmitted, selectionTrace: selectionTrace.slice(0, cap), note: `${core.length} core + ${perimeter.length} perimeter → ${rules.length}/${cap} (${chars}≤${charBudget}ch)${triggerAdmitted ? ` · ⚓${triggerAdmitted}` : ''}` };
}

// ── SELF-HEAL HANDOFF (operator 2026-07-01) — surface the next PENDING punch-list item into the
// directive block as a LOW-PRIORITY, OPTIONAL footnote so the cloud model (Claude) can address it
// OPPORTUNISTICALLY — a self-heal / self-improve loop. It is deliberately SUBORDINATE to the injected
// rules/template: an optional footnote, never a directive. It must NEVER derail the primary task —
// pushing work out-of-lane would violate the whole in-lane thesis, so the line's own text fences it
// ("address ONLY if it fits this prompt's lane; never derail the primary task"). Prefers an IN-LANE
// item (one whose id/description keyword-matches the routed domain) when cheap; otherwise the cursor's
// next pending item (matching punch-list-tick.sh's `cursor % len` selection). Graceful: empty/missing/
// malformed punch-list → returns '' (silent, no throw, never blocks the sync path; the read is sub-ms).
export function selfHealHandoff(boundary = {}, { file = process.env.LENS_PUNCH_LIST || PUNCH_LIST_DEFAULT } = {}) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const tasks = Array.isArray(j.tasks) ? j.tasks : [];
    if (!tasks.length) return '';
    const cursor = Number(j.cursor || 0);
    let idx = (((cursor % tasks.length) + tasks.length) % tasks.length);   // the next pending item (matches punch-list-tick.sh)
    // IN-LANE preference (cheap substring scan): if the routed domain word appears in a task's id or
    // description, surface THAT item instead — a self-heal the current prompt can address in-lane.
    const dom = String(boundary.domain || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (dom) {
      const domWords = dom.split(/\s+/).filter((w) => w.length > 2);
      const match = tasks.findIndex((t) => {
        const hay = `${t && t.id || ''} ${t && t.description || ''}`.toLowerCase();
        return domWords.some((w) => hay.includes(w));
      });
      if (match >= 0) idx = match;
    }
    const t = tasks[idx] || {};
    const title = String(t.id || 'task');
    const desc = String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const body = desc ? `${title} — ${desc}` : title;
    return `🔧 Self-heal (optional · punch-list #${idx}): ${body} · address ONLY if it fits this prompt's lane; never derail the primary task.`;
  } catch { return ''; }
}

// ── stage 4 — assemble the lensed context to PREPEND to the prompt (the injection) ─────────────────
// V2 STRUCTURE (operator 2026-07-03, from the Gemini completeness audit of six real injections —
// docs/superpowers/specs/2026-07-03-lens-injection-v2-design.md): OPERATING CONTEXT → CORE TASK →
// OUTPUT CONTRACT. Three measured fixes:
//   1. THE SANDWICH — the intent moves DOWN (⟦ CORE TASK ⟧, just above the contract) so the model
//      reads the banks (template · rules · standing) first, the intent second, and acts immediately —
//      no telemetry between intent and action (recency-bias loss was the audit's structural finding).
//   2. ONE TEMPLATE — the per-domain template and the named work-template rendered as ONE fused
//      🧩 TEMPLATE line (two overlapping how-to strings = split attention; audit finding #2).
//   3. OUTPUT CONTRACT — the sidecar-note instruction elevated from a buried trailing sub-bullet to a
//      numbered contract band at the very end (last thing read = least likely forgotten).
// Guarded by tests/lens/injection-structure.test.js (section order · single template line · contract last).
export function assembleInjection(stub, boundary, retrieval) {
  const rules = retrieval.rules || [];
  const why = retrieval.topWhy ? `   ← tops because your prompt said: ${retrieval.topWhy}` : '';
  // ── CLARIFICATION MODE (2026-07-03, audit turns 1+6 — the weakest-lift class): when the placement is
  // DEGENERATE (no routed domain + collapse-magnet coord) the lens has NO lane, so injecting a template
  // or perimeter rules is worse than nothing — stale banks actively fight the prompt (the audit's
  // blog-rules-for-an-email-idea case). Stop pretending: no template, no rules, no self-heal; STANDING
  // always survives; the model is directed to state its reading and prefer ONE targeted question over
  // executing the wrong reading. Deterministic (isDegenerateBoundary — the SAME expression as the
  // receipt's ⚠ C,C-degenerate flag), guarded by tests/lens/injection-structure.test.js.
  if (isDegenerateBoundary(boundary)) {
    // SHAPE RESCUE (2026-07-03, speech-act templates): a degenerate PLACEMENT can still carry a
    // confident SHAPE — "trace the decisions made in this chat" has no repo-domain gravity (audit T1)
    // but is unambiguously a trace-session speech act. When a work-template matches, inject IT (the
    // shape is the guidance the audit found missing on exactly these turns); domain rules/self-heal
    // stay dropped (there is still no lane). Only a shapeless degenerate turn asks for clarification.
    const rescue = pickWorkTemplate(stub.intent || stub.text || '');
    return [
      '⟦ DIRECTIVE LENS — CLARIFICATION MODE (degenerate placement, no domain gravity) ⟧',
      'This prompt placed at the collapse magnet with no repo-domain pull — the lens has NO lane for it, so no domain rules are injected (stale banks would fight the prompt).',
      rescue
        ? `🧩 TEMPLATE [${rescue.name} · shape-rescue]: ${rescue.skeleton}`
        : 'Directive: open with your one-line reading of the intent. If two readings diverge materially, ask ONE targeted question instead of executing the wrong one; otherwise proceed conservatively with the smallest footprint that satisfies the intent.',
      STANDING.length ? `⚓ STANDING (every turn, non-negotiable): ${STANDING.join(' · ')}` : '',
      '⟦ CORE TASK ⟧',
      `intent: ${stub.intent || stub.text}  ·  domain: ${boundary.domain || stub.domain || '?'}  ·  pixel ${boundary.center || '∅'} (degenerate)`,
      '⟦ OUTPUT CONTRACT ⟧',
      '1. The receipt block above is echoed VERBATIM as the first lines of the visible reply (already instructed).',
      rescue
        ? '2. Execute the CORE TASK per the 🧩 TEMPLATE, inside STANDING.'
        : '2. Execute the CORE TASK per the CLARIFICATION MODE directive, inside STANDING.',
      '3. End with ONE line, filled in truthfully: "Sidecar note: LOAD-BEARING: <the one injected rule that most shaped this turn, first 6 words> · UNUSED: <one injected rule that did not apply, first 6 words, or none> · DRIFT-CAUGHT: <what the lens stopped you from doing generically, or none>"',
    ].filter(Boolean).join('\n');
  }
  // ONE fused template line: the named work-kind skeleton (how to shape the work) + the routed
  // domain's specifics (the exact commands/invariants for this lane). Never two lines.
  const wt = pickWorkTemplate(stub.intent || stub.text || '');
  const dt = boundary.template || '';
  const templateLine = (wt && dt)
    ? `🧩 TEMPLATE [${wt.name} · ${boundary.domain}]: ${wt.skeleton} — domain specifics: ${dt}`
    : (wt ? `🧩 TEMPLATE [${wt.name}]: ${wt.skeleton}`
        : (dt ? `🧩 TEMPLATE [${boundary.domain || 'domain'}]: ${dt}` : ''));
  // 🔧 THE TOOLS — shaped ask → the exact command (added 2026-07-28 after a flagrant miss).
  // A RULE tells you what is true; a TOOL tells you what to RUN. The reef measured 5 procedural
  // rules against 14 diagnostic ones, and NOTHING in 190 rules named post-drift-history.sh — so
  // "find the script" could never magnetize, and six commits shipped with one drift panel between
  // them. Matched by the same stemmed-overlap scorer the rules use; LLM-free; top 2 injected.
  const toolsBlock = (() => {
    let reg;
    try { reg = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-tools.json'), 'utf8')); } catch { return ''; }
    const stem = (w) => (/ss$/.test(w) ? w : w.replace(/s$/, ''));
    const toks = new Set(String(stub.intent || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map(stem));
    const score = (t) => {
      let n = 0;
      for (const phrase of t.when || []) {
        for (const w of new Set(phrase.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3).map(stem))) if (toks.has(w)) n++;
      }
      // a tool in the routed domain gets a small edge — the lane is already evidence
      if (t.domain && t.domain === boundary.domain) n += 1;
      return n;
    };
    const hits = (reg.tools || []).map((t, i) => [t, score(t), i])
      .filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
    if (!hits.length) return '';
    return `🔧 TOOLS for this shaped ask — RUN these, do not re-derive them:\n${hits.slice(0, 2).map((t) => {
      const after = (t.after || []).length ? `\n     then: ${t.after.join(' && ')}` : '';
      return `  ▶ ${t.run}${after}\n     ${t.why}`;
    }).join('\n')}`;
  })();

  // each rule renders under its STORED NAME (the pile's own name field, name-the-pile.mjs) — «name»
  // then the payload body, so "what rules" is answerable at a glance and the handle is quotable.
  // key = the rule's OWN text (meat appendix "↳ mined:" stripped — it's appended post-admission,
  // so the stored key never contains it), ≤60ch like derived_statements.
  const nm = (r) => { const n = (retrieval.ruleNames || {})[String(r).split('↳')[0].trim().slice(0, 60)] || (retrieval.ruleNames || {})[String(r).slice(0, 60)]; return n ? `«${n}» ` : ''; };
  const rulesBlock = rules.length
    ? `⚖️ the ${rules.length} load-bearing rule(s) for this pixel — heaviest first (use these; ignore the rest of the rulebook):\n  [1] ${nm(rules[0])}${rules[0]}${why}${rules.slice(1).map((r, i) => `\n  [${i + 2}] ${nm(r)}${r}`).join('')}`
    : '(no rules indexed for this pixel yet)';
  return [
    '⟦ DIRECTIVE LENS — OPERATING CONTEXT (this repo, this lane) ⟧',
    // 📁 GOVERNED PATHS — the rule metadata's file turf, auto-included so the query focuses on the
    // right part of the codebase immediately (the "banks of the river").
    (boundary.domain && DOMAIN_PATHS.get(boundary.domain))
      ? `📁 this lane governs: ${[...DOMAIN_PATHS.get(boundary.domain)].slice(0, 6).join(' · ')}`
      : '',
    // 🏞️ THE BANKS (operator 2026-07-19: "a reminder of the specifications every time — the banks
    // of the river" · refined same day: "mostly extend specs and SORT them — the point is to
    // MAGNETIZE the relevant parts — extensions of the playbooks"): the lane's spec entries are
    // RANKED against the prompt with the same deterministic stem-overlap the rule sorter uses,
    // top 3 injected — so the banks SCALE by extension (harvest appends entries) without bloating
    // the injection. NOT globs, NOT a file atlas: sorted spec entries, SQL fence as the scale path.
    // Countable (the receipt carries the count); paths gated by tape-health (broken-banks).
    (() => {
      const specs = domainSpecs(boundary.domain);
      if (!specs.length) return '';
      const stem = (w) => (/ss$/.test(w) ? w : w.replace(/s$/, ''));
      const toks = new Set(String(stub.intent || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map(stem));
      const scoreOf = (s) => { let n = 0; for (const w of new Set(`${s.path} ${s.why}`.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3).map(stem))) if (toks.has(w)) n++; return n; };
      const magnetized = specs.map((s, i) => [s, scoreOf(s), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
      return `🏞️ BANKS — standing specs for this lane, magnetized to this prompt (extend the spec when this run changes direction):\n${magnetized.slice(0, 3).map((s) => `  ↳ ${s.path} — ${s.why}`).join('\n')}`;
    })(),
    templateLine,
    rulesBlock,
    toolsBlock,
    // STANDING band (anti-forgetting core): repeated EVERY turn — repetition at the cadence forgetting
    // happens. Fixed tiny cost; never domain-gated; the rules a long session must not drift off.
    STANDING.length ? `⚓ STANDING (every turn, non-negotiable): ${STANDING.join(' · ')}` : '',
    // SELF-HEAL footnote — subordinate to the rules above; silent '' when the punch-list is empty/missing.
    selfHealHandoff(boundary),
    // (2026-07-09: the qwen "delayed second opinion" injection retired here — it injected a model-
    // generated proposal into the NEXT turn's prompt, which is exactly what stage 1 must never do. A
    // decoupled, non-injected qwen rule-refiner is scoped separately, not wired into this injection.)
    // 🔁 SIDECAR FEEDBACK (2026-07-03, spec Phase 3 — the exhaust becomes intake): the PREVIOUS turn's
    // DRIFT-CAUGHT (captured by lens-sidecar-capture.mjs from the Stop hook) is injected ONCE so the
    // model verifies the same drift vector is not repeated. TTL-gated (stale sessions don't haunt the
    // next one), drained on read like the 🔮 insight. LOAD-BEARING/UNUSED stay telemetry-only.
    (() => { try {
      const f = process.env.LENS_SIDECAR_FILE || resolve(REPO, '.thetacog/lens-last-sidecar.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      const ttlMs = Number(process.env.LENS_SIDECAR_TTL_MS || 2 * 60 * 60 * 1000);
      const fresh = Date.now() - (j.ts || 0) <= ttlMs;
      try { unlinkSync(f); } catch { /* drain best-effort */ }
      const drift = String(j.drift || '').trim();
      if (fresh && drift && !/^none\b/i.test(drift))
        return `🔁 last turn's drift-catch: "${drift.slice(0, 160)}" — verify this drift vector is not repeated this turn`;
    } catch { /* none pending */ } return ''; })(),
    // THE SANDWICH — the intent lands HERE, after the banks, immediately before the contract: the
    // model is primed with the rules, reads the task, and acts without telemetry in between.
    '⟦ CORE TASK ⟧',
    `intent: ${stub.intent || stub.text}  ·  domain: ${boundary.domain || stub.domain || '?'}  ·  pixel ${boundary.center || '∅'}`,
    // OUTPUT CONTRACT — numbered, last, explicit. Item 3 is the UTILIZATION ATTESTATION (operator
    // 2026-07-02): forced RECALL of the rules at turn end (active anti-forgetting) + parseable
    // fire-rate data per rule — the reef's usage telemetry, one line.
    '⟦ OUTPUT CONTRACT ⟧',
    '1. The receipt block above is echoed VERBATIM as the first lines of the visible reply (already instructed).',
    '2. Execute the CORE TASK inside this lane, using the 🧩 TEMPLATE and the numbered rules above.',
    '3. End with ONE line, filled in truthfully: "Sidecar note: LOAD-BEARING: <the one injected rule that most shaped this turn, first 6 words> · UNUSED: <one injected rule that did not apply, first 6 words, or none> · DRIFT-CAUGHT: <what the lens stopped you from doing generically, or none>"',
  ].filter(Boolean).join('\n');
}

// ── THE ACTUARIAL RECEIPT — the standardized, always-present performance stamp (operator 2026-06-30:
// "make the lens's performance VISIBLE on EVERY prompt … the actuarial receipt that makes the system
// insurable"). Pure derivation from the run (negligible time); rendered at the TOP of the injection so
// the operator SEES the exact stats in the transcript on every prompt. Gated by tests/lens/actuarial-receipt.test.js.
// ── TERMINAL PROVENANCE (operator 2026-07-12) — the receipt names TWO rooms in DISTINCT roles, the
// "double mention" of terminals the operator called for. Both live on the SAME 12×12 room lattice:
//   • running-in    — the terminal this session PHYSICALLY runs in ($TERM_PROGRAM, live; marker fallback).
//                     Environmental. It may NOT fit the project direction — that's fine, it is not the spec.
//   • QC-delegated-to — the room the LENS PLACES this work in (derived from the coordinate = repo intention
//                     + specs), which OWNS the quality control for this run. The QC is deposited there; a
//                     sub-project can be picked up + carried by that room. Intent-derived, never the running room.
// The spec is derived from the intention and the repo specifications — NOT from which terminal is running.
const TERM_TO_ROOM = { 'iTerm.app': 'builder', 'Apple_Terminal': 'voice', 'WezTerm': 'vault', 'Rio': 'navigator', 'Alacritty': 'performer', 'kitty': 'operator', 'ghostty': 'operator', 'vscode': 'architect' };
const ROOMS_BY_KEY = {}, ROOM_BY_CELL = {};
try {
  const rj = JSON.parse(readFileSync(resolve(REPO, 'data/rooms.json'), 'utf8'));
  const R = rj.rooms || rj;
  for (const [k, v] of Object.entries(R)) {
    if (!v || typeof v !== 'object') continue;
    ROOMS_BY_KEY[k] = { key: k, emoji: v.emoji || '', terminal: v.terminal || '', coordinate: v.coordinate || v.coord || '' };
    const cellK = String(v.coordinate || v.coord || '').trim().split(/\s+/)[0];   // "A1 Strategy.Law" → "A1"
    if (cellK) ROOM_BY_CELL[cellK] = ROOMS_BY_KEY[k];
  }
} catch { /* open-source repo without data/rooms.json — degrade to the raw terminal name, never blank */ }
const roomTag = (room) => room ? `${room.emoji ? room.emoji + ' ' : ''}${room.key}` : '';
// PRIMARY room — where the session physically runs. Live $TERM_PROGRAM (a stranger's repo has it too),
// then the durable .thetacog/current-room marker, then the raw terminal string so it is never blank.
function detectRunningIn() {
  const tp = process.env.TERM_PROGRAM || '';
  const key = TERM_TO_ROOM[tp];
  if (key && ROOMS_BY_KEY[key]) return { ...ROOMS_BY_KEY[key], terminal: tp || ROOMS_BY_KEY[key].terminal };
  try { const m = JSON.parse(readFileSync(resolve(REPO, '.thetacog/current-room'), 'utf8')); if (m.key && ROOMS_BY_KEY[m.key]) return { ...ROOMS_BY_KEY[m.key], terminal: tp }; if (m.emoji || m.display) return { key: m.display || m.label || tp, emoji: m.emoji || '🖥️', terminal: tp }; } catch { /* no marker */ }
  return tp ? { key: tp, emoji: '🖥️', terminal: tp } : null;
}
// QC / DELEGATED-TO room — the LENS placement decides it: the placement coord's CELL → the room that OWNS
// that cell. Intent-derived (from the coordinate), NOT from which terminal runs. Falls back to the C2
// laboratory (the reef/PMU/verify lane) when no cell is legible — the same rule intervene.mjs uses.
const cellOfCoord = (coord) => { const row = String(coord || '').split(',')[0].trim().toUpperCase(); if (/^[ABC][123]/.test(row)) return row.slice(0, 2); if (/^[ABC]$/.test(row)) return row + '1'; return ''; };
const delegatedTo = (coord) => ROOM_BY_CELL[cellOfCoord(coord)] || ROOM_BY_CELL['C2'] || null;

export function buildReceipt(result) {
  const { stub, boundary, retrieval, timings = {} } = result;
  const returned = retrieval.rules || [];
  const coreSet = new Set((boundary.domainRules || []).map((r) => String(r).slice(0, 40)));
  const core = returned.filter((r) => coreSet.has(String(r).slice(0, 40))).length;   // curated domain rules that made the cut
  const perimeter = returned.length - core;                                          // SQLite/perimeter rules near the fence
  const rulesChars = returned.join('\n').length;
  const specChars = String(stub.intent || stub.text || '').length;
  // PER-PROMPT SORT-QUALITY (operator 2026-06-30): did the lens aim TRUE on THIS prompt? The #1 returned
  // rule should be a CORE rule of the routed domain (the doctor rule for this pixel). If it is → the sort
  // worked; if the top slot is a perimeter/adjacent rule → '✗ off' (the lens didn't focus the right rule).
  const topIsCore = returned.length > 0 && coreSet.has(String(returned[0]).slice(0, 40));
  const sortQuality = returned.length === 0 ? '✗ off' : (topIsCore ? 'top-rule relevant ✓' : '✗ off');
  // WHICH rule topped the sort, by name (operator 2026-08-06: "we need to know if that is correct, what
  // hats, what rules" — a bare count "4/13" is unverifiable; the №1 rule's opening words make the 📜
  // line checkable against the ⚖️ block below it). First clause only, whitespace-collapsed.
  // prefer the STORED name from the pile (reef rule_names / lens_rules.name); fall back to text head.
  const nameOfRule = (r) => (retrieval.ruleNames || {})[String(r).split('↳')[0].trim().slice(0, 60)]
    || (retrieval.ruleNames || {})[String(r).slice(0, 60)]
    || String(r).replace(/\s+/g, ' ').trim().slice(0, 40);
  const topRuleName = returned.length ? nameOfRule(returned[0]) : '';
  // ALL the picked rules by name (operator 2026-08-06: "yes 4/x rules but WHICH rules") — the 📜 line
  // carries the full named roster, heaviest first, so the count is checkable at a glance.
  const namedRules = returned.map((r) => nameOfRule(r));
  // reef-health: read the cached grand-slam readout (refreshed out-of-band); null if never computed yet.
  const reefHealthPct = readReefHealth().pct;
  // ── ENCIRCLED IN/OUT-OF-LANE (operator 2026-07-09: "encircle what was in and out of lane with
  // encircled after the pmu receipt if the rust is fast enough") — the rust walk already RAN and
  // already returned every walked coordinate (walkProvenance.coords) plus the Chebyshev fence (box),
  // so this partition is pure arithmetic on data in hand: zero extra walk time, zero model. Same
  // in/out semantics as the commit pipeline's encircled panel, rendered as the receipt's ◎ line.
  const prov = boundary.walkProvenance || {};
  const fence = boundary.box || null;
  const encircledIn = [], encircledOut = [];
  for (const c of (prov.coords || [])) {
    const { br, bc } = shortLexToBlock(c);
    const inside = fence && Number.isFinite(br) && Number.isFinite(bc)
      && br >= fence.r0 && br <= fence.r1 && bc >= fence.c0 && bc <= fence.c1;
    (inside ? encircledIn : encircledOut).push(c);
  }
  // ── GZIP, UN-IDLED (operator 2026-06-30): the receipt's gzip number now reflects the ACTUAL gzip work —
  // the always-on litScores seeding (μs) PLUS the rare placePixel fallback (ms) — never a 0 while gzip ran.
  const gzipSeedUs = timings.gzipSeedUs || 0;
  const gzipPlaceMs = timings.gzipPlaceMs || 0;
  return {
    encircledIn,                                  // walked coords INSIDE the Chebyshev fence (in-lane)
    encircledOut,                                 // walked coords OUTSIDE the fence (out-of-lane pull)
    totalMs: result.ms,
    gzipSeedUs,                                  // the ALWAYS-ON gzip-NCD seeding (litScores) — μs (the real gzip contribution)
    gzipPlaceMs,                                 // the placePixel fallback PIXEL placement — ms (0 when repo-domain routed)
    gzipMs: +((gzipSeedUs / 1000) + gzipPlaceMs).toFixed(1),   // total real gzip ms (back-compat number; now NON-zero when gzip ran)
    pmuMs: timings.pmuMs || 0,                   // THE METAL — the real on-chip ballistic walk (walkShape), gzip-seed subtracted
    sortUs: timings.sortUs || 0,                 // the JS merge/dedup/cap of core+perimeter (the rule SORT), MICROSECONDS
    sqlMs: timings.sqlMs || 0,                   // the SQLite perimeter fetch
    sensor: timings.sensor || 'gzip-fallback',   // 'metal' = the real walk ran · 'gzip-fallback' = degraded + MARKED
    // WALK READOUT (operator 2026-06-30): plies · throughput · cloud-fill — so a SATURATED walk is visible.
    walkPlies: boundary.walkPlies || 0,
    walkFillPct: boundary.walkFillPct || 0,
    walkWalksPerSec: boundary.walkWalksPerSec || 0,
    walkSaturated: !!boundary.walkSaturated,
    domain: boundary.domain || stub.domain || 'other',
    coord: boundary.center || '∅',
    // TERMINAL PROVENANCE — two rooms, distinct roles (see the helper above). running-in is environmental
    // ($TERM_PROGRAM); qcDelegatedTo is the LENS placement (intent-derived from the coord). Deliberately
    // NOT the same field — the whole point is that where you ARE and where the work is PLACED can diverge.
    ...(() => {
      const runningIn = detectRunningIn();
      const qc = delegatedTo(boundary.center || '');
      return {
        runningIn: runningIn ? { label: roomTag(runningIn), terminal: runningIn.terminal || '', key: runningIn.key } : null,
        qcDelegatedTo: qc ? { label: roomTag(qc), cell: qc.coordinate || '', key: qc.key } : null,
        qcSameAsRunning: !!(runningIn && qc && runningIn.key === qc.key),
      };
    })(),
    sigma: boundary.sigma,                        // INTENT-PLACEMENT from the real walk (NOT the commit's coverage σ)
    inLane: !!boundary.domain,                    // routed to a known repo-domain pixel = In-Lane; gzip fallback = Drift
    rulesReturned: returned.length,
    core, perimeter,
    coreAvailable: retrieval.coreAvailable ?? null,               // N of M — the domain denominator
    reefRulesTotal: REEF_RULES_TOTAL,                             // K of TOTAL — the whole-reef denominator
    rulesChars,
    specChars,
    sortQuality,
    topRuleName,                                  // the №1 sorted rule, by name — makes "4/13" checkable
    namedRules,                                   // ALL picked rules by stored name, heaviest first
    reefHealthPct,
    reefTotalChars: REEF_TOTAL_CHARS,             // total char size of the searched reef (rendered "reef N.Nk ch")
    ...(() => {
      // TEMPLATES N/M + STEERING (operator 2026-07-09): count BOTH picks (the routed domain's template
      // and the named work-shape template — the same two the 🧩 TEMPLATE line fuses) over the full
      // library denominator, and when the work-shape pick was CLOSE (runner-up within 1), surface a
      // visible steering moment so the operator can re-aim in one sentence. Deterministic, μs.
      const wt = pickWorkTemplate(stub.intent || stub.text || '');
      const names = [wt ? wt.name : null, boundary.template ? `${boundary.domain || 'domain'}-template` : null].filter(Boolean);
      const steering = wt && wt._runnerUp && (wt._pickScore - wt._runnerUp.score) <= 1
        ? { picked: wt.name, over: wt._runnerUp.name, scores: `${wt._pickScore}v${wt._runnerUp.score}` }
        : null;
      return {
        templatesCount: names.length,
        templatesTotal: TEMPLATES_TOTAL,
        templateName: names.join(' + ') || 'none',
        steering,
      };
    })(),
    // INSTANCE ALARMS — a glance must show WHICH stage failed for THIS prompt.
    alarmSpecBroken: specChars === 0,
    alarmNoTemplate: !boundary.template,
    alarmNoRules: returned.length === 0,
    // thin-rules (gate lens-min-rules, SQLite): a sorted list below the floor is not a sort — densify the domain.
    thinRules: returned.length > 0 && returned.length < LENS_MIN_RULES,
    // ── DETERMINISTIC QUALITY FLAGS (sync, no model) — MEASURABLE thinness on THIS turn's signal ──────
    // thin-spec: a >0 but under-floor stub-spec (intent under-captured); the 0-char case is already
    // alarmSpecBroken, so thin-spec is the 1..floor band — a distinct, softer signal.
    thinSpec: specChars > 0 && specChars < THIN_SPEC_CHARS,
    // C,C-degenerate: the placement collapsed to the magnet with NO real domain pull. The qualifier is
    // load-bearing — the gzip-NCD ballistic SEED funnels almost any short text to C,C, so a C,C seed alone
    // is NOT degenerate when keyword routing still found a real repo-domain (center = that domain's coord).
    // Degenerate = routing produced NO domain (boundary.domain null → gzip fallback) AND the center/top-seed
    // is the C,C magnet. That is the true "no domain gravity" state a very-low fill accompanies.
    ccDegenerate: isDegenerateBoundary(boundary),   // the ONE shared expression (clarification mode keys off it too)
  };
}

// renderReceipt(result) → the EXACT confirmed block (operator 2026-06-30). It is the headline the model
// is instructed to ECHO verbatim, so it shows EVERYWHERE (CLI, phone, web) — not just additionalContext.
// Instance alarms REPLACE the relevant line/segment when a stage is broken (spec 0 · no template · no rules).
export function renderReceipt(result) {
  const r = result.receipt || buildReceipt(result);
  const rh = r.reefHealthPct == null ? '?' : `${r.reefHealthPct}`;
  const reefCh = (r.reefTotalChars || 0) >= 1000 ? `${(r.reefTotalChars / 1000).toFixed(1)}k` : `${r.reefTotalChars || 0}`;
  // Line 3 — rules + sort-quality + reef-health + reef-total (alarm replaces the rules segment when none retrieved).
  const rulesSeg = r.alarmNoRules
    ? '📜 ⚠ NO RULES RETRIEVED'
    : `📜 rules ${r.rulesReturned}${r.coreAvailable ? `/${r.coreAvailable} domain` : ''} · ${r.rulesReturned}/${r.reefRulesTotal} reef (core ${r.core} · perimeter ${r.perimeter} · ${r.rulesChars} chars)${(r.namedRules || []).length ? `: ${r.namedRules.map((n) => `«${n}»`).join(' · ')}` : ''}`;
  // 🏞️ banks count (2026-07-19): how many standing specs this lane injected — the countable half
  // of "the reminder of the specifications every time". 0 on lanes not yet seeded (visible gap).
  const banksN = domainSpecs(r.domain).length;
  const line3 = `${rulesSeg} · 🏞️ banks ${banksN} · 🎯 sort-quality: ${r.sortQuality} · reef-health ${rh}% · reef ${reefCh} ch`;
  // Line 4 — spec + templates (each segment swaps to its own alarm when broken).
  const specSeg = r.alarmSpecBroken ? '📄 ⚠ SPEC BROKEN (0 chars)' : `📄 spec ${r.specChars} chars`;
  const tmplSeg = r.alarmNoTemplate ? '🧩 ⚠ NO TEMPLATE' : `🧩 templates ${r.templatesCount}/${r.templatesTotal || '?'} picked (${r.templateName})`;
  // DETERMINISTIC QUALITY FLAGS (sync, no model) — appended to line 4 only when the turn's signal is
  // thin/degenerate. These are RELIABLE (char counts + coord match). Silent on a healthy turn (no noise).
  const qualityFlags = [];
  if (r.thinSpec) qualityFlags.push(`⚠ thin-spec (${r.specChars}ch)`);
  if (r.ccDegenerate) qualityFlags.push('⚠ C,C-degenerate');
  const flagsSeg = qualityFlags.length ? ` · ${qualityFlags.join(' · ')}` : '';
  const isMetal = r.sensor === 'metal';
  const sensorSeg = isMetal ? 'metal ✓' : 'gzip-fallback';
  const sigmaProvenance = isMetal ? 'real walk' : 'gzip placement — the metal walk was unavailable';
  // WALK READOUT line (operator 2026-06-30): plies · throughput · cloud-fill. ⚠ SATURATED when the 144
  // cloud fill exceeds the ceiling (σ untrustworthy) — at the measured shallow depth it never trips.
  const wps = r.walkWalksPerSec || 0;
  const fillPct = r.walkFillPct ?? 0;
  const wpsSeg = wps >= 1000 ? `~${(wps / 1000).toFixed(1)}k w/s` : `~${wps} w/s`;
  const fillSeg = r.walkSaturated
    ? `fill ${fillPct}% ⚠ SATURATED (σ untrustworthy)`
    : `fill ${fillPct}% (≤${SATURATION_FILL_PCT}% ✓)`;
  const walkLine = `🌀 walk: ${r.walkPlies || 0} plies · ${wpsSeg} · ${fillSeg}`;
  // GZIP segment (operator 2026-06-30, un-idled): show the TRUE always-on gzip-NCD seeding (litScores) in
  // μs when sub-ms / ms when ≥1ms — never a misleading 0 while gzip ran — and DISTINGUISH it from the rare
  // placePixel fallback (appended only when it actually fired). The metal walk (PMU) no longer includes it.
  const gzipSeedUs = r.gzipSeedUs != null ? r.gzipSeedUs : Math.round((r.gzipMs || 0) * 1000);
  const gzipSeedSeg = gzipSeedUs >= 1000 ? `${(gzipSeedUs / 1000).toFixed(1)}ms` : `${gzipSeedUs}μs`;
  const gzipPlaceMs = r.gzipPlaceMs || 0;
  const gzipSeg = `gzip ${gzipSeedSeg} seed${gzipPlaceMs > 0 ? ` +${gzipPlaceMs}ms place` : ''}`;
  // the lens's OWN-CONTRIBUTION health line — breadth · reef size · per-signal utilization (gzip un-idled).
  let healthLine = renderHealthLine(computeFromReceipt(r));
  // 📈 the longitudinal series snapshot rides the health line (operator 2026-07-02: "add vega to the
  // list") — population labeled honestly; module-load compute, $0 here.
  if (SERIES_SNAPSHOT) healthLine = `📈 series: vega ${SERIES_SNAPSHOT.vega} · breach ${SERIES_SNAPSHOT.breachPct}% (all-commits offPct>15 — not the sealed premium rate) · n${SERIES_SNAPSHOT.n}\n${healthLine}`;
  // ── DECIDABILITY FRAME (operator 2026-07-01) — the load-bearing point, in plain language, among the
  // FIRST lines a reader sees. The whole thesis compressed: PLACEMENT is decidable (WHERE this landed —
  // the walk halts with a provable, re-runnable coordinate/verdict), QUALITY is NOT (bug-freedom is
  // Rice-undecidable; we REFUSE that claim). Metal-gated for the "recompute-it-yourself" AUTHORITY — a
  // gzip-fallback verdict is placement-decidable in principle but not silicon-attested — yet the
  // placement-decidable-vs-quality-undecidable FRAME is present either way, so it can never regress to
  // an overclaim ("all behaviour decidable") nor drop the honest quality refusal.
  // GOVERNOR CUE (operator 2026-07-01): the verdict is PROGRAMMATIC — the deterministic walk halts with a
  // provable placement; NO LLM decides it, on this line or anywhere else in the receipt (2026-07-09: the
  // lens is LLM-free end to end — no Generator, no background proposal, no model mention at all).
  // the FULL coordinate, full category names (operator 2026-07-09: "language from the perspective of
  // C,B3 — with full names for categories") — canonical taxonomy extended with the reef's problem-space
  // name, used for BOTH the header bracket and the DECIDABLE line (no more bare "[C,B3]" shorthand).
  const fullCoord = expandCoordName(r.coord).canonical;
  // ◎ ENCIRCLED — the walked coordinates partitioned by the Chebyshev fence (operator 2026-07-09:
  // "encircle what was in and out of lane … after the pmu receipt"). Same in/out semantics as the
  // commit pipeline's encircled panel, in text: in-lane = walked cells INSIDE the fence, out-of-lane
  // = the walk's pull OUTSIDE it, with the densest out-of-lane row named in full (the direction the
  // prompt leaks toward). Pure arithmetic on the walk's own output — no extra walk, no model.
  // SHORTLEX SUBCATEGORIES, FULL FORMAT — ADDITIVE, ALWAYS PREFIX + LABEL (operator 2026-08-06:
  // "it should be the shortlex subcategories not the hats … B,C B1a Tactics.x.y x C2b Operator.x.y").
  // Each walked cell renders as COORD then its full category names + the compression-picked anchor
  // WORD (the mined 3rd-level label we actually have): "B,A1 Tactics × Strategy.Law · regulation".
  // The chat walk's lattice is the 12×12 axis-pair grid — depth-3 cells live in the commit-grade
  // 144×144 projection (descent_depth in telemetry); the anchor word is the honest depth-3 signal here.
  const encList = (a, n = 6) => a.slice(0, n).map((c) => `${c} ${coordName(c)}`).join(' · ') + (a.length > n ? ` +${a.length - n} more` : '');
  let encLine = '';
  const eIn = r.encircledIn || [], eOut = r.encircledOut || [];
  if (eIn.length || eOut.length) {
    // the WHOLE leak distribution, not just the top row (operator 2026-08-06: "work backwards from
    // what makes this most decidable, most useful") — every out-of-role cell is accounted for by
    // actor axis, so the direction AND concentration of the leak are decidable from the line itself.
    let pull = '';
    if (eOut.length) {
      const rows = {};
      for (const c of eOut) { const row = String(c).split(',')[0]; rows[row] = (rows[row] || 0) + 1; }
      const dist = Object.entries(rows).sort((a, b) => b[1] - a[1])
        .map(([row, n]) => `${canonicalName(row)} ×${n}`).join(' · ');
      if (dist) pull = ` → pull: ${dist}`;
    }
    // off-lane % — the SAME semantics as the commit gate's offPct (the 📈 series line's breach input),
    // so the per-prompt receipt carries the exact number the premium is calibrated on. This is the
    // insurable signal of the turn: walked mass outside the fence over all walked mass.
    const offPct = Math.round(100 * eOut.length / (eIn.length + eOut.length));
    // the PNG pointer — the detached renderer writes the REAL encircled panel of THIS walk here
    // (same hues + same encircle door as the commit panel); chat can Read it to show the tesseract's
    // performance visually after the prompt returns.
    encLine = `◎ encircled — in-role ${eIn.length}${eIn.length ? `: ${encList(eIn)}` : ''} · out-of-role ${eOut.length}${eOut.length ? `: ${encList(eOut)}` : ''}${pull} · off-lane ${offPct}% · 🖼 .thetacog/lens-encircled/latest.png`;
  }
  // 🧭 STEERING (operator 2026-07-09: the first output should "prompt the operator to steer or clarify
  // the steering or not") — rendered ONLY when the work-shape pick was genuinely close, so a decisive
  // turn stays clean and an ambiguous one hands the operator a one-sentence re-aim.
  const steerLine = r.steering
    ? `🧭 steering: shaped as ${r.steering.picked} over ${r.steering.over} (${r.steering.scores}) — reply "shape as ${r.steering.over}" to re-aim, or proceed`
    : '';
  // 🖥️ TERMINAL PROVENANCE (operator 2026-07-12) — running-in (the terminal you're physically in) vs
  // QC-delegated-to (the room the LENS places this work in, which owns its quality control). Two roles on
  // the one 12×12 room lattice; the spec is intent-derived, never the running room. Blank only if neither
  // resolves (no $TERM_PROGRAM and no rooms.json — a truly bare environment).
  let termLine = '';
  if (r.runningIn || r.qcDelegatedTo) {
    const runSeg = r.runningIn ? `running-in ${r.runningIn.label}${r.runningIn.terminal ? ` (${r.runningIn.terminal})` : ''}` : 'running-in ?';
    const qcSeg = r.qcDelegatedTo ? ` · QC→ ${r.qcDelegatedTo.label}${r.qcDelegatedTo.cell ? ` [${r.qcDelegatedTo.cell}]` : ''}` : '';
    const note = r.qcSameAsRunning ? ' — you ARE the QC room for this run' : ' — QC placed from intent, not the terminal you\'re in';
    termLine = `🖥️ ${runSeg}${qcSeg}${note}`;
  }
  // The "programmatic · deterministic · LLM-free" triple lives ONCE, in the header (operator
  // 2026-08-06: "fun to say that, bit repetitive though") — this line keeps the DECIDABLE-placement
  // vs UNDECIDABLE-quality frame (guarded by tests/pmu/decidability-framing.test.js), not the triple.
  const decidableLine = isMetal
    ? `✅ DECIDABLE (no model in this verdict): WHERE this landed [${fullCoord}] is provable + re-runnable — recompute this verdict yourself. WHETHER it's bug-free is UNDECIDABLE (Rice) — we don't claim that.`
    : `✅ DECIDABLE (provisional; no model in this verdict): WHERE this landed [${fullCoord}] is provable in principle + re-runnable, but recompute-authority needs the on-chip metal walk (gzip fallback ran). WHETHER it's bug-free is UNDECIDABLE (Rice) — we don't claim that.`;
  const hatSeg = expandCoordName(r.coord).hat;
  return [
    `─── 🛰️ PMU Lens · ${r.domain} [${fullCoord}] · ${r.inLane ? 'In-Lane' : 'Drift'} (σ ${r.sigma}) · GOVERNOR — programmatic · deterministic · LLM-free ───`,
    decidableLine,
    // the FULL coordinate NAME — canonical taxonomy extended with the reef's problem-space name (the same
    // expansion the commit + project altitudes carry) — PLUS the worn hat, written out (the handhold).
    `🪸 ${hatSeg ? `🎩 ${hatSeg} — ` : ''}${expandCoordName(r.coord).name}`,
    termLine,  // 🖥️ running-in (environmental) vs QC-delegated-to (intent-placed) — the two-room provenance
    // μs for the always-on gzip SEED (sub-ms) + sub-ms SORT (never "0"); ms for the ms-scale walk/SQL.
    `⏱️ ${r.totalMs}ms — ${gzipSeg} · PMU ${r.pmuMs}ms · sort ${r.sortUs}μs · SQL ${r.sqlMs}ms`,
    // SENSOR — the SAME on-chip walk that gates a commit, run on this prompt. σ here is INTENT-PLACEMENT
    // (the walk's placement; there is no delivered-code reality at chat time), NOT the commit's coverage.
    `🧭 sensor: ${sensorSeg} · σ ${r.sigma} = intent-placement (${sigmaProvenance}; the commit gate's σ is intent-vs-reality coverage)`,
    walkLine,
    // 🛰️ THE TELEMETRY CONTRACT (fractal spec §7.3, S5) — six keys live on every receipt.
    (() => {
      const t = result.telemetry;
      if (!t) return '';
      const dm = t.discriminative_margin;
      const d2 = t.dimension_2_mass;
      const mag = (t.magnet_list_top_3 || []).map((m) => `${m.tighter ? '◉' : '○'}${m.id.slice(0, 24)}(${m.dev})`).join(' ');
      return `🛰️ telemetry: ${t.placement_mode} · depth ${t.descent_depth} · hops ${t.walk_hops_lived}`
        + (dm ? ` · Δσ ${dm.margin >= 0 ? '+' : ''}${dm.margin} vs ${dm.best_sibling}` : ' · Δσ —')
        + (d2 ? ` · dim2 ${d2.sub_cells_materialized}/144·${(d2.sub_reef_chars / 1000).toFixed(1)}k` : ' · dim2 —')
        + (mag ? ` · magnet ${mag}` : ' · magnet — (flat/funnel)');
    })(),
    line3,
    `${specSeg} · ${tmplSeg}${flagsSeg}`,
    healthLine,
    encLine,   // ◎ in/out-of-lane partition of the walked cells — after the stats, before the rule-off
    steerLine, // 🧭 the visible steering moment — only when the shape pick was close ('' otherwise)
    '────────────────────────────────────────────────────────',
  ].filter(Boolean).join('\n');
}

// The MODEL-ECHO instruction — prepended to the lensed context so the model prints the receipt as the
// FIRST lines of its VISIBLE reply (additionalContext is invisible on phone/web; the echo makes the
// receipt show EVERYWHERE). Deliberately blunt and unambiguous so it fires reliably.
export const ECHO_INSTRUCTION =
  '⟦ MANDATORY — ECHO THE RECEIPT FIRST ⟧ Before anything else, output the receipt block below VERBATIM '
  + '(character-for-character, every emoji and ─ rule line) as the very first lines of your visible reply, '
  + 'then answer the prompt. Do not summarize it, reformat it, wrap it in a code fence, or comment on it — '
  + 'print the block exactly, then proceed with your answer.';

// the whole pipeline, one call, latency-budgeted. LLM-FREE end to end (2026-07-09) — no extrapolator,
// no background audit, no generator proposal. Placement is keyword + anchor-phrase routing, seeded by
// gzip-NCD, expanded by the real on-chip ballistic walk. Zero model calls, on the sync path or off it.
// STAGE 3 render (gated): resolve the {rules+hats} refs to their text and format the coordinate-mass
// block the lens prepends. Lazy: reef + melds load ONLY when this fires (flag on). Code refs stay
// pointers (resolving 7MB of code inline is the seat step, not the render). LLM-free, prose-safe upstream.
let _reefRules = null, _reefRuleNames = null, _hatMelds = null;
function renderMassInjection(mi) {
  if (!_reefRules) {
    _reefRules = new Map(); _reefRuleNames = new Map();
    for (const d of (REEF_FILE.domains || [])) if (d.coord && Array.isArray(d.rules)) { _reefRules.set(`${d.domain}`, d.rules); _reefRuleNames.set(`${d.domain}`, d.rule_names || {}); }
    _hatMelds = new Map();
    // the pile entry carries BOTH the stored hat name and the payload body (name-the-pile.mjs)
    try { for (const c of JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'))) _hatMelds.set(String(c.coord), { snippet: String(c.snippet || ''), hat: String(c.hat || '') }); } catch { /* melds optional */ }
  }
  const lines = [];
  for (const r of mi.refs) {
    if (r.kind === 'rule') {
      const m = String(r.src).match(/^reef:(.+):(\d+)$/);
      const rules = m && _reefRules.get(m[1]); const t = rules && rules[+m[2]];
      const text = typeof t === 'string' ? t : (t && (t.rule || t.text));
      const name = text && m ? (_reefRuleNames.get(m[1]) || {})[String(text).slice(0, 60)] : '';
      if (text) lines.push(`  · RULE${name ? ` «${name}»` : ''}: ${String(text).slice(0, 240)}`);
    } else if (r.kind === 'hat') {
      const meld = _hatMelds.get(String(r.coord));
      // the hat is NAMED from the pile itself (stored .hat field), coord kept as the placement
      if (meld && meld.snippet) lines.push(`  · HAT 🎩 ${meld.hat || hatName(r.coord)} (${r.coord}): ${meld.snippet.slice(0, 200).replace(/\s+/g, ' ').trim()}`);
    } else if (r.kind === 'code') {
      lines.push(`  · CODE @ ${r.src}`);
    }
  }
  if (!lines.length) return '';
  return `⟦ COORDINATE MASS · ${mi.coord} (${mi.placed_by}) — the rules + hats that live where this prompt landed ⟧\n${lines.join('\n')}`;
}

export async function lensPrompt(prompt) {
  const t0 = Date.now();
  const stub = { intent: String(prompt).slice(0, 800), domain: routeToDomain(String(prompt).slice(0, 800))?.domain || 'other', source: 'deterministic(prompt-as-intent)' };
  const boundary = await boundaryFromStubSpec(stub);
  const retrieval = retrieveRules(boundary, { intentText: `${stub.intent || ''} ${String(prompt).slice(0, 400)}` });
  const ms = Date.now() - t0;
  // SPLIT timings (operator 2026-06-30): gzip (compression sensor, ms) · PMU = THE METAL WALK (ms) ·
  // sort (rule merge/dedup/cap, μs) · SQL (SQLite perimeter fetch, ms). Skipped stages report 0.
  // sensor rides along so the receipt honestly says whether the σ came from the real walk or a fallback.
  const timings = {
    gzipSeedUs: boundary.seedGzipUs || 0,        // the ALWAYS-ON gzip-NCD seeding (litScores over 144) — μs, un-idled
    gzipPlaceMs: boundary.compressMs || 0,       // the placePixel fallback PIXEL placement (rare; 0 when repo-domain routed) — ms
    pmuMs: boundary.walkMetalMs || 0,            // THE METAL — the on-chip ballistic walk, gzip-seed SUBTRACTED out (pure walk)
    sortUs: retrieval.sortUs || 0,               // microseconds
    sqlMs: retrieval.sqlMs || 0,
    sensor: boundary.sensor || 'gzip-fallback',
  };
  // ── 🛰️ THE TELEMETRY CONTRACT (fractal spec §7.3, goal S5) — six keys, deterministic, LLM-free.
  // One schema on three surfaces: this receipt, the tape walk blocks (via lensReadout), the page.
  const telemetry = await (async () => {
    try {
      const { computeMagnetList, discriminativeMargin, laneInvariants, laneBaseline } = await import(resolve(REPO, 'scripts/pmu/magnet-list.mjs'));
      const dEntry = REEF.find((x) => x.domain === boundary.domain) || null;
      // placement_mode: HONEST per prompt — keyword routing ran (the inversion is not live) vs
      // the gzip/walk fallback placed it (heat DID determine location for this prompt).
      const placement_mode = boundary.walk === 'repo-domain' ? 'keyword-fallback' : 'heat-first';
      // dimension_2_mass: the placed cell's sub-well, if materialized (E1 output), else null.
      let dimension_2_mass = null;
      try {
        const f = resolve(REPO, `data/pmu/reef-l1/${String(boundary.center || '').replace(',', '-')}.json`);
        const sw = JSON.parse(readFileSync(f, 'utf8'));
        dimension_2_mass = { sub_cells_materialized: (sw.cells || []).filter((c) => (c.snippet || '').length >= 40).length, sub_reef_chars: sw.stats ? sw.stats.total_chars : 0, contrast_ratio_C: sw.p1_contrast ?? null };
      } catch { /* unmaterialized cell — null is the honest value */ }
      // magnet list top-3 + discriminative margin (bounded: own lane + 5 shared-axis siblings)
      let magnet_list_top_3 = [], discriminative_margin = null;
      if (dEntry) {
        const m = computeMagnetList(stub.intent, laneInvariants(dEntry), laneBaseline(dEntry), 3);
        magnet_list_top_3 = m.flat ? [] : m.observations.map((o) => ({ id: o.id.slice(0, 44), dev: o.deviation, tighter: o.tighter }));
        const [prow, pcol] = String(dEntry.coord || '').split(',');
        const sibs = REEF.filter((x) => x.domain !== dEntry.domain && x.coord && (x.coord.startsWith(`${prow},`) || x.coord.endsWith(`,${pcol}`))).slice(0, 5);
        const baselines = Object.fromEntries([[dEntry.domain, laneBaseline(dEntry)], ...sibs.map((s) => [s.domain, laneBaseline(s)])]);
        discriminative_margin = discriminativeMargin(stub.intent, baselines, dEntry.domain);
      }
      return { placement_mode, descent_depth: 0, dimension_2_mass, magnet_list_top_3, walk_hops_lived: boundary.walkHops || 0, discriminative_margin };
    } catch { return { placement_mode: boundary.walk === 'repo-domain' ? 'keyword-fallback' : 'heat-first', descent_depth: 0, dimension_2_mass: null, magnet_list_top_3: [], walk_hops_lived: boundary.walkHops || 0, discriminative_margin: null }; }
  })();
  const base = { prompt, stub, boundary, retrieval, ms, timings, telemetry, within_budget: ms <= LATENCY_BUDGET_MS };
  const receipt = buildReceipt(base);
  base.receipt = receipt;
  // ── PER-PROMPT ENCIRCLED PNG (operator 2026-08-06: "at the end of the prompt we need the pngs
  // encircled … one single rust pipeline") — DETACHED, never on the hook's critical path (hooks never
  // block). Payload = the walk already in hand; the renderer reuses the ONE encircle door (regions
  // chip → encircleRegionsPng). Output: .thetacog/lens-encircled/latest.png + latest.json (hat-named).
  try {
    const { spawn } = await import('node:child_process');
    const dir = resolve(REPO, '.thetacog/lens-encircled');
    mkdirSync(dir, { recursive: true });
    const payloadFile = resolve(dir, 'pending.json');
    writeFileSync(payloadFile, JSON.stringify({
      at: new Date().toISOString(), coord: receipt.coord, domain: receipt.domain,
      coords: [...(receipt.encircledIn || []), ...(receipt.encircledOut || [])],
      fence: boundary.box || null, prompt: String(prompt).slice(0, 200),
    }));
    const child = spawn(process.execPath, [resolve(REPO, 'scripts/pmu/lens-encircled-png.mjs'), payloadFile], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch { /* the PNG is a trailing artifact — its failure never touches the receipt */ }
  // The lensed context = (1) the model-echo instruction (makes the receipt show on phone/web) → (2) the
  // ACTUARIAL RECEIPT block (echoed verbatim) → (3) the deterministic lens (intent · template · rules ·
  // DECIDABLE verdict). One prompt, no model-generated second opinion.
  base.lensedContext = `${ECHO_INSTRUCTION}\n\n${renderReceipt(base)}\n\n${assembleInjection(stub, boundary, retrieval)}`;
  // ── STAGE 3 (gated): render the {rules+hats} coordinate mass into the injected context. massInjection
  // is null unless LENS_MASS_INJECT=1, so this is a NO-OP by default (lensedContext byte-identical).
  // Lazy-resolves rule/hat text only when it fires (zero hot-path cost when off). Prose already filtered.
  try {
    const mi = boundary.massInjection;
    if (mi && Array.isArray(mi.refs) && mi.refs.length) {
      const block = renderMassInjection(mi);
      if (block) base.lensedContext += `\n\n${block}`;
    }
  } catch { /* gated render is best-effort — never breaks the base context */ }
  // ── GRIP LEDGER POSTER (v0.2 §I.2 · gated): the tesseract heat-map poster IN the injection — this is
  // what makes the grip ledger "the reality running in the prompt injection", not just on the page. Gated
  // by LENS_GRIP_POSTER=1 or .thetacog/lens-grip-poster.on → NO-OP by default (lensedContext byte-identical
  // when off). Lit tiles within Chebyshev radius of the placed pixel, tier-ordered, served ONE-PASS from the
  // RAM projection. Best-effort: a failure never touches the base context. Guarded by grip-poster.test.mjs.
  try {
    const gripOn = process.env.LENS_GRIP_POSTER === '1' || existsSync(resolve(REPO, '.thetacog/lens-grip-poster.on'));
    if (gripOn && boundary.center) {
      const { renderGripPoster } = await import('./grip-poster.mjs');
      // PICKER (measured 2026-07-23): the tight confidence PIXEL + gzip-NCD discriminates sharply (C,B2→all
      // testing rules); the broad walk-heatmap footprint does NOT (saturated ~37 cells → shape≈1 for
      // unrelated rules, measured worse). Heatmap/shape-match stays plumbed (heatCoords) for the NEXT build
      // — distinctive tight footprints + bitmap-popcount at 40M/s — with the pixel+gzip result as the bar.
      const poster = renderGripPoster(boundary.center, { promptText: prompt });
      if (poster && poster.block) { base.lensedContext += `\n\n${poster.block}`; base.gripPoster = poster.meta; }
    }
  } catch { /* gated poster is best-effort — never breaks the base context */ }
  // ── TOKEN COST METER (operator 2026-06-30) ──────────────────────────────────────────────────────
  // The exact per-prompt COST: the injected additionalContext (input the cloud pays for) + the echoed
  // receipt (output the model re-emits). chars/4 approx. This is the measured COST half of the "does
  // the lens save tokens?" question; the SAVINGS half is UNPROVEN until the A/B harness runs
  // (scripts/pmu/lens-token-ab.mjs · tests/lens/token-savings.test.js).
  try { base.tokenCost = recordCost({ injection: base.lensedContext, receipt: renderReceipt(base) }); } catch { /* best-effort */ }
  return base;
}

// TRAJECTORY JOIN KEYS (operator 2026-08-01): the receipt is the prompt-side half of the
// prompt→commit trajectory edge. Before this fix, 7,653/7,670 receipts carried rules_chosen: []
// (a refactor renamed retrieval.rows → retrieval.rules and the receipt kept mapping the dead
// field — silent for months because coverage.chosen still counted correctly), `when` held the id
// instead of a timestamp, and there was NO session/git join key — so the edge
// (prompt → injected rules → resulting commit) was un-indexed and trajectory analysis undecidable.
// Guarded by tests/pmu-simulator/lens-receipt-schema.test.mjs.
export function writeReceipt(result, { session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null, source = 'cli' } = {}) {
  const dir = resolve(REPO, '.thetacog/lens-receipts'); mkdirSync(dir, { recursive: true });
  const id = `lens-${Date.now().toString(36)}`;
  const path = resolve(dir, `${id}.json`);
  const ts = new Date().toISOString();
  let git_head = null;
  try { git_head = execFileSync('git', ['-C', REPO, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* receipt still lands without it */ }
  writeFileSync(path, JSON.stringify({
    id, ts, when: ts, ms: result.ms, within_budget: result.within_budget,
    session, git_head, source,
    pixel: result.boundary.center, fence: result.boundary.box, sigma: result.boundary.sigma,
    // P_raw for the decidable redirect-effect metric (2026-07-02): where the RAW prompt's
    // compression seed lands, independent of the reef redirect — the contrast term in
    // Δ = d(P_raw,P_result) − d(P_redirected,P_result). Deterministic, recomputable.
    seedPixel: (result.boundary.walkProvenance?.seedCoords || [])[0] || null,
    stub_source: result.stub.source,
    coverage: { chosen: (result.retrieval.rules || []).length, domainAvailable: result.retrieval.coreAvailable ?? null, reefTotal: REEF_RULES_TOTAL },
    // key = rule.slice(0,40) — the SAME dedup key retrieveRules uses, so downstream joins are exact.
    rules_chosen: (result.retrieval.rules || []).map((r) => ({ key: r.slice(0, 40), rule: r.slice(0, 120) })),
    selection_trace: (result.retrieval.selectionTrace || []).slice(0, 8),
    note: result.retrieval.note, prompt: String(result.prompt).slice(0, 400),
  }, null, 2) + '\n');
  return path;
}

// ── seed the rule-lens: every canonical rule-line PLACED on the lattice (so the fence can retrieve it) ─
// Source = the canonical rulebook (CLAUDE.md). Each rule-line is placed by the SAME compression sensor,
// so a rule lives at the pixel its words mean — and a prompt's fence retrieves exactly the rules whose
// meaning sits inside it. Re-runnable (idempotent rebuild of lens_rules).
export function seedRules({ db = DB, source = resolve(REPO, 'CLAUDE.md'), pairLib = loadPairLib() } = {}) {
  const text = existsSync(source) ? readFileSync(source, 'utf8') : '';
  // NOISE FILTER (operator 2026-06-30): the old filter kept anything with a colon or em-dash, so it
  // slurped CLAUDE.md GLOSSARY/STRUCTURE lines as if they were rules — trailer-field defs
  // ("`Originating-Terminal: <…>`", "`Story: <…>`"), TESSERACT axis defs ("EMOJI — …", "FOCUSED — …"),
  // markdown table rows ("| `data/manual-overrides.json` | … |"), numbered workflow steps
  // ("3. Promote: …"), and command-help ("`!schedule` reads …"). Those inflated the injected perimeter
  // to 1339ch for an in-lane comms prompt (3× the 400ch ceiling) while reading as "rules". Drop them at
  // the SEEDER so a re-seed never reintroduces them; the char-budget cap in retrieveRules is the runtime
  // backstop. Conservative by design — only obvious structural noise is excluded; real em-dash
  // imperatives ("Commit liberally — …", "Push sparingly — …") are KEPT.
  const isNoise = (l) =>
    /^\d+\.\s/.test(l)                          // numbered workflow step
    || /\|/.test(l)                             // markdown table row (pipe cells)
    || /^`?[A-Z][\w-]*`?\s*:\s*`?</.test(l)     // trailer/field def: "Label: <…>"
    || /^`?[A-Z]{2,}\b\s*—/.test(l)             // ALLCAPS axis/glossary def: "EMOJI —", "FOCUSED —"
    || /^`[^`]+`\s*(—|reads|=)/.test(l)         // backtick path/command then glossary/desc
    || /^[!`]/.test(l);                         // leading command-bang or backtick path fragment
  // rule-lines: bulleted/bolded imperatives, deduped, meaty enough to mean something, NOT structural noise.
  const lines = [...new Set(text.split('\n')
    .map((l) => l.replace(/^[\s>#*-]+/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length >= 30 && l.length <= 240 && /[a-z]/.test(l)
      && /(never|always|must|do not|don.t|rule|only|every|hard rule|gate|—|:)/i.test(l)
      && !isNoise(l)))];
  const rows = [];
  for (const rule of lines.slice(0, 400)) {
    const p = placePixel(rule, pairLib); if (!p?.pixel) continue;
    let br = 0, bc = 0; try { ({ br, bc } = shortLexToBlock(p.pixel)); } catch { continue; }
    rows.push({ coord: p.pixel, br, bc, rule: rule.replace(/'/g, "''"), weight: +(p.sigma || 0).toFixed(3), src: 'perimeter' });
  }
  // ── PARADOX-VOICE RULEBOOK → the same SQLite rulebook (operator 2026-07-04: "bake them into the
  // PMU runner"). docs/voice/paradox-voice-rulebook.md is the grading reference for ALL manuscript +
  // outreach prose, but its 13 hard rules are NUMBERED lines — exactly the shape the noise filter
  // above drops on purpose (it was tightened after the glossary-slurp incident; do NOT loosen it).
  // So the rulebook gets its own extractor: each `N. **Name.** text…` hard rule is joined across its
  // wrapped lines, compressed to one rule-line, tagged src='voice', and placed on the lattice by the
  // SAME sensor — so a book/content prompt's fence retrieves the voice rules whose meaning sits
  // nearest its pixel. Idempotent with the rest of the reseed.
  const voicePath = resolve(REPO, 'docs/voice/paradox-voice-rulebook.md');
  if (existsSync(voicePath)) {
    const vt = readFileSync(voicePath, 'utf8');
    const hard = (vt.split(/^## 1\..*$/m)[1] || '').split(/^## /m)[0] || '';
    const voiceRules = [...hard.matchAll(/^\d+\.\s+\*\*(.+?)\*\*\s*([\s\S]*?)(?=^\d+\.\s+\*\*|\s*$)/gm)]
      .map((m) => `Voice: ${m[1].replace(/\.$/, '')} — ${m[2].replace(/\s+/g, ' ').trim()}`.slice(0, 240));
    for (const rule of voiceRules) {
      const p = placePixel(rule, pairLib); if (!p?.pixel) continue;
      let br = 0, bc = 0; try { ({ br, bc } = shortLexToBlock(p.pixel)); } catch { continue; }
      rows.push({ coord: p.pixel, br, bc, rule: rule.replace(/'/g, "''"), weight: +(p.sigma || 0).toFixed(3), src: 'voice' });
    }
  }
  // ── TRIGGER ANCHORS (operator 2026-08-01): the dual-anchor half of retrieval. A rule is placed
  // where its CONTENT compresses; these rows re-seat it where the SITUATIONS it governs land
  // (data/pmu/rule-trigger-anchors.json — curated from the grading-pass miss families + learned from
  // the trajectory spine). Applied INSIDE the reseed because lens_rules is derived (DELETE'd below):
  // an anchor hand-INSERTed into SQLite would be wiped by the next gardener tick. src='trigger'.
  try {
    for (const r of anchorRows({ toBlock: shortLexToBlock })) rows.push(r);
  } catch { /* anchors are additive — a bad file never blocks the reseed */ }
  // lens_rules is DERIVED (DELETE+reINSERT below) — the name is stamped AT INSERT (name-the-pile's
  // deterministic namer), because a one-shot migration is wiped by the very next reseed (2026-08-06).
  const ddl = `CREATE TABLE IF NOT EXISTS lens_rules (coord TEXT, br INT, bc INT, rule TEXT, weight REAL, src TEXT DEFAULT 'perimeter', name TEXT);\nDELETE FROM lens_rules;\n`;
  const ins = rows.map((r) => `INSERT INTO lens_rules (coord,br,bc,rule,weight,src,name) VALUES ('${r.coord}',${r.br},${r.bc},'${r.rule}',${r.weight},'${r.src || 'perimeter'}','${pileRuleName(r.rule).replace(/'/g, "''")}');`).join('\n');
  execFileSync('sqlite3', [db], { input: ddl + ins, encoding: 'utf8' });
  return { seeded: rows.length, voice: rows.filter((r) => r.src === 'voice').length, db };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--seed-rules')) { const r = seedRules(); console.log(`lens_rules seeded: ${r.seeded} rules placed on the lattice → ${r.db.replace(REPO + '/', '')}`); process.exit(0); }
  if (process.argv.includes('--refresh-health')) { const h = refreshReefHealthCache({ force: true }); console.log(`reef-health cached: ${h.pct == null ? '?' : h.pct + '%'} → ${REEF_HEALTH_CACHE.replace(REPO + '/', '')}`); process.exit(0); }
  const prompt = arg('--prompt') || arg('-p');
  if (!prompt) { console.error('usage: prompt-lens.mjs --prompt "<text>" [--json] [--seed-rules] [--refresh-health]'); process.exit(1); }
  // OUT-OF-BAND refresh: the CLI / background-refine path is NOT latency-critical, so it refreshes the
  // reef-health cache (TTL-gated → at most one spawn per 30 min) before rendering, keeping the number the
  // SYNC path reads warm. The sync --emit path itself never spawns this; it only READS the cache.
  refreshReefHealthCache();
  const result = await lensPrompt(prompt);
  const receiptPath = writeReceipt(result);
  // AUTO-record what the sidecar injected (the performance loop — held is annotated later, never a
  // question). Only on the CLI/sidecar path; the gate's measurement runs lensPrompt directly, unrecorded.
  try {
    const { recordApplication } = await import('./lens-feedback.mjs');
    recordApplication({ prompt, domain: result.boundary.domain, pixel: result.boundary.center, rules: result.retrieval.rules, template: result.boundary.template, ts: Date.now().toString(36) });
  } catch { /* feedback best-effort */ }
  if (process.argv.includes('--json')) {
    // FLUSH-THEN-EXIT (latent-bug fix, 2026-06-30): process.exit(0) does NOT flush an async stdout PIPE
    // write, so a >~8KB JSON payload captured via execFileSync was TRUNCATED mid-string (the async-auditor
    // row inflated the receipt past the pipe threshold and exposed it — pre-existing, size-dependent). The
    // write callback fires only after the pipe has drained, so we exit AFTER the full payload lands. Guarded
    // by the flush-then-exit contract (a >~8KB JSON payload piped to execFileSync was truncated mid-string).
    process.stdout.write(JSON.stringify({ ...result, receiptPath }, null, 2) + '\n', () => process.exit(0));
  } else {
    console.log(`\n${result.lensedContext}\n`);
    console.log(`  ↳ ${result.ms}ms ${result.within_budget ? '(within budget)' : '⚠ over budget'} · stub:${result.stub.source} · ${result.retrieval.note} · receipt ${receiptPath.replace(REPO + '/', '')}`);
  }
}
