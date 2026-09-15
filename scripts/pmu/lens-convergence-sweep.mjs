#!/usr/bin/env node
// scripts/pmu/lens-convergence-sweep.mjs — THE CONVERGENCE SWEEP (spec §5.3).
//
// ZERO LLM CALLS. Loads the FROZEN labeled trap set (lens-trap-build.mjs), computes each
// trap prompt's boundary ONCE (the real routing + walk), then sweeps the retrieval knobs
// (θ_score · char budget · core floor) re-running ONLY retrieveRules per vector.
//
// Confusion per trap:  must-fire + rule returned → TP · missed → FN (with miss_reason:
// routed-away | ranked-out) · must-not + rule returned → FP · absent → TN.
// Objective: recall-weighted Fβ (β²=5 — an FN on a load-bearing rule costs ~5× an FP).
// Output: one ndjson row per vector → data/pmu/lens-convergence-history.ndjson, winner
// printed with the capability statement (spec §5.4). Also runs the GRADER VALIDATION
// (spec §5.5): canonical placement must separate each scenario's planted faithful reality
// from its planted violation before any live A/B verdict counts.
//
// Run: node scripts/pmu/lens-convergence-sweep.mjs

import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HISTORY = resolve(REPO, 'data/pmu/lens-convergence-history.ndjson');
const BETA2 = 5;

// DETERMINISTIC REUSE (tick optimization, operator 2026-07-20 "optimise the ticks"): the sweep
// is a pure function of the reef — same reef bytes ⇒ same result (measured 137-190s per run;
// a red gate cycle paid it TWICE, once judging the edit and once post-revert on the restored
// reef). With --reuse-if-unchanged, if the newest sha-stamped history row was computed on a
// byte-identical reef, its row is re-appended (stamped cached:true, provenance kept) instead
// of recomputed. This is determinism honestly exploited, never an asserted result: cache key
// = sha256(lens-reef.json), and any reef change forces the full sweep.
// CODE VERSION — the sweep is a pure function of the reef AND OF THE CODE THAT EVALUATES IT.
// INCIDENT 2026-07-21→22 (30h, ~18 commit/revert pairs, zero convergence): 6f4841b7e at 17:54
// changed prompt-lens.mjs (the picker: "wells under construction are invisible"), legitimately
// moving F1 0.885→0.832. The reuse key below covered only reef+trap-set BYTES, so for ~50 minutes
// the post-revert baseline replayed a STALE 0.885 row computed under the OLD picker while the
// true value had already fallen. At 18:12 a reef edit finally busted the key and 0.832 surfaced —
// now permanently under the 0.879 floor pinned 07-19 under the OLD picker. Every harvest since was
// refused on a floor its own baseline could not meet, and reverted as if the EDIT were at fault.
// A code-caused F1 shift MUST bust the cache, or the gate judges a new-regime edit against an
// old-regime baseline forever. These four files are the sweep's actual evaluator (three are
// dynamic imports below, invisible to any static dependency check).
export const EVALUATOR_DEPS = ['prompt-lens.mjs', 'attest-scenarios.mjs', 'attest-hypotheses.mjs', 'lens-convergence-sweep.mjs'];
export function codeSha() {
  const h = createHash('sha256');
  for (const f of EVALUATOR_DEPS) h.update(readFileSync(resolve(HERE, f)));
  return h.digest('hex');
}

// key covers ALL THREE inputs the sweep is a function of: the reef, the trap constitution,
// and the evaluator code version (see codeSha above — the omission that caused the incident).
export function reefSha() {
  const h = createHash('sha256');
  h.update(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json')));
  h.update(readFileSync(resolve(REPO, 'data/pmu/lens-trap-set.json')));
  h.update(codeSha());
  return h.digest('hex');
}

// ROUTING SHA — the narrow key for the boundary cache. A boundary (Phase A: routing + the real
// on-chip walk) is a function of the prompt and the reef's ROUTING surface only: domain, coord,
// vocab, anchors. It provably does NOT read derived_statements — those are consumed by
// retrieveRules in Phase B (prompt-lens.mjs:306, the single reference in the file). Keying the
// cache on the WHOLE reef would bust 176 cached walks on every harvest, and every recent harvest
// is "+0 vocab +N derived" — i.e. changes that cannot move a boundary. This key survives them,
// which is the difference between a 43s gate sweep and a 6s one. If boundaryFromStubSpec ever
// starts reading derived_statements, this key becomes wrong — guarded by
// tests/pmu-simulator/boundary-cache.test.mjs (routing-surface-only assertion).
export function routingSha() {
  const reef = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
  const routing = (reef.domains || []).map((d) => ({ domain: d.domain, coord: d.coord, vocab: d.vocab, anchors: d.anchors }));
  const h = createHash('sha256');
  h.update(JSON.stringify(routing));
  h.update(readFileSync(resolve(REPO, 'data/pmu/lens-trap-set.json')));
  return h.digest('hex');
}

// pure evaluator — unit-testable (tests/pmu-simulator/lens-convergence-sweep.test.mjs)
export function evalTraps(pickFn, traps) {
  let TP = 0, FN = 0, FP = 0, TN = 0;
  const misses = [];
  for (const t of traps) {
    const picked = pickFn(t);                                   // { rules: string[], routedDomain }
    const hit = picked.rules.some((r) => String(r).slice(0, 60) === t.rule_key);
    if (t.kind === 'must-fire') {
      if (hit) TP++;
      else { FN++; misses.push({ ...t, miss_reason: picked.routedDomain !== t.domain ? 'routed-away' : 'ranked-out' }); }
    } else {
      if (hit) { FP++; misses.push({ ...t, miss_reason: 'false-positive' }); }
      else TN++;
    }
  }
  const P = TP + FP ? TP / (TP + FP) : 0;
  const R = TP + FN ? TP / (TP + FN) : 0;
  const f1 = P + R ? +(2 * P * R / (P + R)).toFixed(3) : 0;
  const fbeta = (BETA2 * P + R) ? +((1 + BETA2) * P * R / (BETA2 * P + R)).toFixed(3) : 0;
  return { TP, FN, FP, TN, precision: +P.toFixed(3), recall: +R.toFixed(3), f1, fbeta, misses };
}

// ── E0 (spec §2.5, goal S1) — THE INVERSION measured: heat-first placement vs keyword routing ──
// Heat-first = the REAL metal walk on the prompt (walkShape, never analytic); the walk-heat
// argmax coord maps to the nearest reef domain by ShortLex block distance (Chebyshev on the
// 12×12); the keyword router is demoted to tie-break. Zero LLM. Same evalTraps, same traps.
const AXE0 = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export function nearestDomainByCoord(coord, domains, keywordPrior = null) {
  const pos = (c) => { const [r, k] = String(c || '').split(','); return [AXE0.indexOf(r), AXE0.indexOf(k)]; };
  const [pr, pc] = pos(coord);
  if (pr < 0 || pc < 0) return keywordPrior;
  let best = null, bestD = Infinity;
  for (const d of domains) {
    const [dr, dc] = pos(d.coord);
    if (dr < 0 || dc < 0) continue;
    const dist = Math.max(Math.abs(dr - pr), Math.abs(dc - pc));
    if (dist < bestD || (dist === bestD && keywordPrior && d.domain === keywordPrior)) { bestD = dist; best = d; }
  }
  return best ? best.domain : keywordPrior;
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  // deterministic reuse door (see reefSha above) — BEFORE any expensive import/phase
  const REEF_SHA_NOW = reefSha();
  if (process.argv.includes('--reuse-if-unchanged')) {
    try {
      const lines = readFileSync(HISTORY, 'utf8').trim().split('\n').filter(Boolean);
      // scan BACK for any row computed on this exact (reef, trap-set) — NOT newest-only: on a
      // red gate cycle the newest row is always the sweep of the EDITED reef, and the restored
      // baseline's row sits one or more rows behind it (bug found overwatch pass #1: the door
      // matched 0 of 8 red cycles because it broke at the first sha-stamped row).
      for (let i = lines.length - 1, scanned = 0; i >= 0 && scanned < 100; i--, scanned++) {
        const r = JSON.parse(lines[i]);
        if (!r.reef_sha || !r.default_vector) continue;   // pre-sha rows can't prove identity
        if (r.reef_sha === REEF_SHA_NOW) {
          const copy = { ...r, ts: new Date().toISOString(), cached: true, cached_from_ts: r.cached_from_ts || r.ts };
          appendFileSync(HISTORY, JSON.stringify(copy) + '\n');
          console.log(`sweep: reef+traps byte-identical to ${copy.cached_from_ts} (sha ${REEF_SHA_NOW.slice(0, 12)}) — deterministic reuse → F1 ${r.default_vector.f1}`);
          process.exit(0);
        }
      }
    } catch { /* no history yet — full sweep */ }
  }
  const { boundaryFromStubSpec, retrieveRules } = await import(resolve(HERE, 'prompt-lens.mjs'));
  const { SCENARIOS } = await import(resolve(HERE, 'attest-scenarios.mjs'));
  const { placement } = await import(resolve(HERE, 'attest-hypotheses.mjs'));

  const trapDoc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-trap-set.json'), 'utf8'));
  const traps = trapDoc.traps || [];
  console.log(`trap-set v${trapDoc.version}: ${traps.length} traps · boundaries once, then the knob grid (zero LLM calls)`);

  // Phase A — boundary per unique prompt, ONCE (the real routing + metal walk)
  //
  // THE BOUNDARY CACHE (operator 2026-07-20: "the on chip going from sub second to over a minute
  // is strange" — it is, and this is why). PROFILED: one boundary costs ~119ms, of which the chip
  // COMPUTE is ~14ms; the rest is PROCESS SPAWN. definer-walk-144 runs one real `pmu-onchip
  // --ballistic` process PER HOP (canon — AR-protected, batched per ply but one process each), and
  // a walk takes 30-39 hops. So Phase A = 176 boundaries x ~35 hops ~= 6,000 process launches = 21s.
  // The walk is NOT slow; we were paying macOS process-launch overhead ~35x per boundary.
  //
  // The fix is NOT to touch the walk (that would trade the canonical on-chip algorithm for speed —
  // exactly the substitution the anti-rules forbid). It is to stop RECOMPUTING it: the trap set is
  // FROZEN and a boundary is a deterministic function of (prompt, reef). Same key => same answer,
  // by the same determinism the receipt itself rests on. Cache keyed on the reef+traps sha; any
  // reef change busts every entry, so a stale boundary is impossible by construction.
  const t0 = Date.now();
  const BCACHE = resolve(REPO, 'data/pmu/boundary-cache.json');
  let bcache = { key: null, boundaries: {} };
  const ROUTING_SHA = routingSha();
  try { const d = JSON.parse(readFileSync(BCACHE, 'utf8')); if (d.key === ROUTING_SHA) bcache = d; } catch { /* cold cache */ }
  const boundaries = new Map();
  let hits = 0, misses = 0;
  for (const t of traps) {
    if (boundaries.has(t.prompt)) continue;
    const cached = bcache.boundaries[t.prompt];
    if (cached) { boundaries.set(t.prompt, cached); hits++; continue; }
    const b = await boundaryFromStubSpec({ intent: t.prompt });
    boundaries.set(t.prompt, b); bcache.boundaries[t.prompt] = b; misses++;
  }
  if (misses) { try { writeFileSync(BCACHE, JSON.stringify({ key: ROUTING_SHA, built_at: new Date().toISOString(), note: 'deterministic boundary cache: a boundary is f(prompt, reef); the trap set is frozen. Busted wholesale by any reef/trap change (key = reef_sha).', boundaries: bcache.boundaries })); } catch { /* non-fatal */ } }
  console.log(`  boundaries: ${boundaries.size} in ${Math.round((Date.now() - t0) / 1000)}s (${hits} cached · ${misses} walked${hits ? ` — ${Math.round(100 * hits / (hits + misses))}% off the metal` : ''})`);

  // Phase B — the grid (spec §5.2; perimeter radius skipped while lens_rules fences are unseeded)
  //
  // GATE MODE (operator 2026-07-20: "a lean process where there is no wasted time"). MEASURED:
  // Phase A costs 21s (176 real metal walks); the full 48-vector grid costs ~73s more — and the
  // harvest gate reads exactly ONE number out of it, default_vector.f1. So every gate call spent
  // ~73s computing 47 knob vectors nobody read: 44% of a 166s tick, burned. --gate-mode computes
  // Phase A + the default vector only. The full grid remains the calibration instrument (run it
  // whenever the knob frontier is the question); it is simply no longer on the gate's hot path.
  const GATE_MODE = process.argv.includes('--gate-mode');
  const GRID = [];
  if (GATE_MODE) GRID.push({ theta: null, budget: 400, floor: 3 });   // the default vector — the only one the gate reads
  else for (const theta of [null, 0.05, 0.1, 0.2])
    for (const budget of [300, 400, 600, 900])
      for (const floor of [2, 3, 4]) GRID.push({ theta, budget, floor });

  const rows = [];
  for (const v of GRID) {
    const res = evalTraps((t) => {
      const b = boundaries.get(t.prompt);
      const ret = retrieveRules(b, { intentText: t.prompt, scoreTheta: v.theta, charBudgetOverride: v.budget, coreFloorOverride: v.floor });
      return { rules: ret.rules, routedDomain: b.domain };
    }, traps);
    rows.push({ knobs: v, ...res, misses: undefined, miss_count: res.misses.length });
    if (rows.length % 12 === 0) console.log(`  …${rows.length}/${GRID.length} vectors`);
  }
  rows.sort((a, b) => b.fbeta - a.fbeta || b.f1 - a.f1);
  const best = rows[0];

  // re-evaluate best to keep its miss list (the densify/adjudication backlog)
  const bestFull = evalTraps((t) => {
    const b = boundaries.get(t.prompt);
    const ret = retrieveRules(b, { intentText: t.prompt, scoreTheta: best.knobs.theta, charBudgetOverride: best.knobs.budget, coreFloorOverride: best.knobs.floor });
    return { rules: ret.rules, routedDomain: b.domain };
  }, traps);
  const routedAway = bestFull.misses.filter((m) => m.miss_reason === 'routed-away').length;
  const rankedOut = bestFull.misses.filter((m) => m.miss_reason === 'ranked-out').length;

  // GRADER VALIDATION (spec §5.5) — planted-pair separation, per scenario, decidable. The deck
  // DESIGNS most realities as violations (sledgehammer's planted reality is the breach), so the
  // check compares against each scenario's DESIGNED verdict — "reality reads IN_LANE" would be
  // wrong-by-design for 4/5 (v1 of this check had that bug; corrected same session).
  const EXPECT = { faithful: 'IN_LANE', sledgehammer: 'OFF_DOMAIN', hallucination: 'OFF_DOMAIN', 'analysis-execution': 'OFF_DOMAIN', 'abstain-tie': 'UNPLACEABLE' };
  const grader = SCENARIOS.filter((s) => s.reality && s.negative && s.intent && EXPECT[s.key]).map((s) => {
    const reality = placement(s.intent, s.reality, s.negative);
    const violating = placement(s.intent, s.negative, s.negative);
    return { scenario: s.key, designed_verdict: EXPECT[s.key], reality_verdict: reality.verdict,
      negative_as_reality_verdict: violating.verdict,
      separated: reality.verdict === EXPECT[s.key] && violating.verdict !== 'IN_LANE' };
  });

  // S2 BACKLOG (v7.2 — the misses are the seed list, PERSISTED; cycle 1 stored only counts and
  // a later reader assumed the rows existed — materialize them so S2 starts from a file, not a
  // false assumption): every best-knob miss with its prompt, rule, domain, reason.
  writeFileSync(resolve(REPO, 'data/pmu/lens-s2-backlog.json'), JSON.stringify({
    built_at: new Date().toISOString(), trap_set_version: trapDoc.version, knobs: best.knobs,
    note: 'S2 seed list — each row is a measured miss: the prompt that failed, the rule it should have surfaced, and why it missed. SOURCE RULE: these are the historical-first derived_statements candidates.',
    misses: bestFull.misses.map((m) => ({ kind: m.kind, domain: m.domain, rule_key: m.rule_key, prompt: m.prompt, miss_reason: m.miss_reason })),
  }, null, 1));

  const record = {
    ts: new Date().toISOString(), trap_set_version: trapDoc.version, traps: traps.length,
    reef_sha: REEF_SHA_NOW, gate_mode: GATE_MODE,   // a gate-mode row carries ONLY the default vector — never mistake it for a frontier measurement
    grid: GRID.length, wall_ms: Date.now() - t0,
    best: { knobs: best.knobs, TP: best.TP, FN: best.FN, FP: best.FP, TN: best.TN,
      precision: best.precision, recall: best.recall, f1: best.f1, fbeta: best.fbeta,
      fn_routed_away: routedAway, fn_ranked_out: rankedOut },
    default_vector: rows.find((r) => r.knobs.theta === null && r.knobs.budget === 400 && r.knobs.floor === 3) || null,
    top5: rows.slice(0, 5).map((r) => ({ knobs: r.knobs, f1: r.f1, fbeta: r.fbeta, P: r.precision, R: r.recall })),
    grader_validation: grader,
    capability: `at knobs ${JSON.stringify(best.knobs)} the picker achieves P ${best.precision} · R ${best.recall} · F1 ${best.f1} over ${traps.length} labeled traps; residual FN: ${routedAway} routed-away (router/content) + ${rankedOut} ranked-out (sorter)`,
  };
  appendFileSync(HISTORY, JSON.stringify(record) + '\n');
  console.log(`\nBEST ${JSON.stringify(best.knobs)} → P ${best.precision} · R ${best.recall} · F1 ${best.f1} · Fβ ${best.fbeta} (TP ${best.TP} FN ${best.FN} FP ${best.FP} TN ${best.TN})`);
  console.log(`  FN split: ${routedAway} routed-away (content/router) · ${rankedOut} ranked-out (sorter)`);
  const dv = record.default_vector; if (dv) console.log(`  today's defaults → P ${dv.precision} · R ${dv.recall} · F1 ${dv.f1}`);
  console.log(`  grader validation: ${grader.filter((g) => g.separated).length}/${grader.length} scenarios separate planted faithful vs violating`);
  console.log(`  → ${HISTORY}`);
}
