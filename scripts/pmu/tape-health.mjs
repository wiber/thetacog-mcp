#!/usr/bin/env node
// scripts/pmu/tape-health.mjs — the zero-out sentinel (operator 2026-07-18: "a sh that kicks
// back prompts/rules to trigger followon edits if something zeroes out").
//
// Scans the shared flight tape + the lens tape for the five measured incident classes and, on
// any finding, KICKS BACK a self-prompt carrying the root context (per SELF-IMPROVING FIRES:
// a fire must diagnose the root and name the mechanism, never just regenerate the artifact).
//
// The burn-down: each class below ended today as a door-level guard. This sentinel measures
// RECURRENCES-SINCE-GUARD — the alpha metric. Target: zero, forever. Alpha is NOT σ (σ is
// placement spread — it rose while quality degraded in the echo run); alpha is the rate at
// which incidents become impossibilities.
//
// Usage: node scripts/pmu/tape-health.mjs [--json] [--kick]   (--kick creates the self-prompt)

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const findings = [];
// ADVISORIES — earned DECISIONS, not defects. Reported prominently, never counted as recurrences,
// never affecting the exit code. Keeping them out of the incident channel is what stops the sentinel
// from crying wolf (the failure mode that left 7 UI guards red-on-correct-code until nobody read them).
const advisories = [];
const check = (cls, guard, bad, detail) => findings.push({ class: cls, guard, recurrences: bad.length, detail: bad.slice(0, 3), status: bad.length === 0 ? 'HELD' : 'RECURRED' });

// ── flight tape ───────────────────────────────────────────────────────────────
// --tape <path> targets an alternate tape file — the NEGATIVE-CONTROL door (operator 2026-07-19:
// "make sure the guards are not just green but reasonable"): a guard is only trusted after it has
// been SEEN to fire on a planted-bad tape. tests/pmu-simulator/tape-health-fires.test.mjs plants one.
const tapeArgIdx = process.argv.indexOf('--tape');
const tapePath = tapeArgIdx >= 0 ? resolve(process.argv[tapeArgIdx + 1]) : resolve(REPO, 'docs/pmu/attest-flight-tape.json');
const tape = existsSync(tapePath) ? JSON.parse(readFileSync(tapePath, 'utf8')) : { timeline_events: [] };
const T = (tape.timeline_events || []).filter((s) => String(s.id || '').startsWith('T'));

// era scoping: the metal-pass schema shipped 2026-07-18 — everything before is HISTORY
// (pre-guard), not a recurrence. Alpha counts recurrences SINCE the guard, never violations
// that predate it. (Was "first state carrying placement_only" — a proxy that broke the moment
// the 2026-07-20 walk-backfill healed pre-era states in place, stamping placement_only:false
// on T1/T2 and yanking three days of history into judgment. An explicit date can't be moved
// by a backfill.)
const METAL_ERA_TS = '2026-07-18T16:23:45Z';   // ts of T15, the first seal-time placement_only state (recovered from git @ b3aa47d52, pre-heal)
const ERA = T.filter((s) => String(s.ts || '') >= METAL_ERA_TS);

// 1. HOLLOW — a metal-era terminal state with neither walk nor the explicit placement_only label
check('hollow-state', 'perturb-no-hollow.test.mjs',
  ERA.filter((s) => s.source === 'cli-perturb' && s.metrics && !('walk' in s.metrics) && !('placement_only' in s.metrics))
    .map((s) => s.id),
  'walk + placement_only both absent (metal era)');

// 2. DUST — a state whose corpora are below the 120B measured floor (post-guard states only
//    would be refused at the door; any new one means the door leaked)
check('dust-corpus', 'DUST_FLOOR (perturb + /tape-append)',
  ERA.filter((s) => {
    const iB = Buffer.byteLength((s.inputs && s.inputs.intent) || ''), rB = Buffer.byteLength((s.inputs && s.inputs.reality) || '');
    // pointer-payload law: intent is a pointer (40B floor); reality carries the mass (120B floor)
    return (iB < 40 || rB < 120) && !(s.label || '').includes('negative control');
  }).map((s) => s.id + ' (i' + Buffer.byteLength((s.inputs && s.inputs.intent) || '') + 'B/r' + Buffer.byteLength((s.inputs && s.inputs.reality) || '') + 'B)'),
  'dust corpora on the shared tape (metal era)');

// 3. ZEROED GREEKS — walk present but σ or coordinate nulled (a torn wire, not a thin input)
check('zeroed-greeks', 'page-reads-tape-walk.test.mjs',
  T.filter((s) => s.metrics && s.metrics.walk && (s.metrics.walk.trajectory_drift_sigma == null || !s.metrics.walk.pixel_coord))
    .map((s) => s.id),
  'walk block present but σ/coord null');

// 8. TIMING-HOLLOW WALK — walk present but the measured timings (gzip_ms/walk_ms) absent: the
//    state was sealed under the pre-timing schema or a writer dropped the keys. The page then
//    dashes "gzip ingest time / PMU walk time" beside an ed25519-verified receipt — a measured
//    number missing on a page that claims decidable receipts (operator 2026-07-19: "it harms
//    the credibility of the whole thing"). Heal: metal-pass backfillTape (timing-hollow leg).
check('timing-hollow-walk', 'metal-pass backfill + every writer carries gzip_ms/walk_ms',
  ERA.filter((s) => s.metrics && s.metrics.walk && (s.metrics.walk.gzip_ms == null || s.metrics.walk.walk_ms == null))
    .map((s) => s.id),
  'walk block present but gzip_ms/walk_ms null — run the metal-pass backfill');

// 9. INCOHERENT VERDICT — a sealed record whose own fields contradict the canonical placement
//    rules (attest-hypotheses.mjs:52-57). Canonical placement makes these combinations impossible;
//    one on the tape means a stale/divergent writer sealed it (operator 2026-07-19 pasted the page
//    narrating "✅ In-lane — 68.4% drift, under the 35% limit" — an impossible sentence). The page
//    now refuses to narrate these (paintVerdictFromMetal tripwire); this class catches them at rest.
check('incoherent-verdict', 'paintVerdictFromMetal tripwire + canonical placement is the ONE verdict',
  T.filter((s) => {
    const m = s.metrics || {}; if (!m.verdict) return false;
    const thr = typeof s.threshold === 'number' ? s.threshold : null;
    const d = typeof m.drift === 'number' ? m.drift : null;
    const hasD = m.dI != null && m.dN != null;
    if (m.verdict === 'IN_LANE' && d != null && (d > 50 || (thr != null && d > thr))) return true;
    if (m.verdict === 'OFF_DOMAIN' && m.mode === 'A' && d != null && thr != null && !(d > thr)) return true;
    if (m.verdict === 'OFF_DOMAIN' && m.mode === 'B' && hasD && !(m.dN < m.dI)) return true;
    if (m.verdict === 'UNPLACEABLE' && hasD && !(Math.abs(m.dN - m.dI) < 0.015)) return true;
    return false;
  }).map((s) => `${s.id} (${s.metrics.verdict}/${s.metrics.mode} drift ${s.metrics.drift} thr ${s.threshold})`),
  'verdict fields contradict the canonical placement rules');

// 10. VERDICT RECOMPUTE MISMATCH — the "reasonable, not just green" leg (operator 2026-07-19):
//     re-run the canonical placement from each state's OWN inputs and compare with the sealed
//     verdict. Internal coherence can't catch a record that is self-consistent but wrong (sealed
//     by an old implementation); recomputing can. Deterministic (gzip-NCD), no model, no network.
try {
  const { placement } = await import(resolve(REPO, 'scripts/pmu/attest-hypotheses.mjs'));
  check('verdict-recompute-mismatch', 'canonical placement() is deterministic + recomputable',
    T.filter((s) => {
      const m = s.metrics || {}, i = s.inputs || {};
      if (!m.verdict || m.verdict === 'PENDING_WALK' || !i.intent || !i.reality || !i.negative) return false;
      try {
        const p = placement(i.intent, i.reality, i.negative, typeof s.threshold === 'number' ? s.threshold : undefined);
        return p.verdict !== m.verdict || (typeof m.drift === 'number' && Math.abs(p.driftPct - m.drift) > 0.11);
      } catch { return false; }
    }).map((s) => s.id),
    'sealed verdict/drift disagree with a fresh canonical recompute from the state\'s own inputs');
} catch { /* placement module absent in a bare checkout — non-fatal */ }

// 11. BROKEN BANKS — a lane's standing spec (lens-reef.json d.specs[].path — "the banks of the
//     river", injected EVERY call) points at a file that no longer exists. A torn bank silently
//     steers every prompt in that lane with a dead reference (operator 2026-07-19: the specs are
//     the every-run reminder; they must be existence-gated, not remembered).
try {
  const reefDoc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
  const broken = [];
  for (const d of (reefDoc.domains || [])) for (const s of (d.specs || []))
    if (!existsSync(resolve(REPO, s.path))) broken.push(`${d.domain} → ${s.path}`);
  check('broken-banks', 'lens-reef d.specs existence (the banks are gated, not remembered)',
    broken, 'a lane standing-spec path no longer exists');
} catch { /* reef absent in a bare checkout — non-fatal */ }

// 12. HUD-HOLLOW BOOT — the LAST T-state (the page's boot state) must carry metrics.walk with
//     the Greek keys, or the HUD paints all-dash on load ("we decoupled the greeks from the ui
//     again", 2026-07-20 — an E0 annotation landed at the tail as a T-state). Annotations are
//     E0-/R-prefixed, never T; the page also walks backward at boot (belt) — this is suspenders.
{
  const lastT = [...T].reverse().find((s) => s.metrics);
  check('hud-hollow-boot', 'annotation ids never T + page boot walks back to a walk-state',
    (lastT && !(lastT.metrics.walk && lastT.metrics.walk.trajectory_drift_sigma != null)) ? [lastT.id] : [],
    'the tape tail T-state carries no walk Greeks — the page boot would dash the HUD');
}

// 13. SWEEP-BELOW-FLOOR (goal S6 — continuous E0/sweep as a sentinel, never a commit gate):
//     the latest convergence sweep's defaults-vector F1 must be ≥ the pinned ratchet floor.
//     A drop = a reef/sorter regression landed without the harvest gate → RECURRED + kickback.
try {
  const floorDoc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/ratchet-floor.json'), 'utf8'));
  const histLines = readFileSync(resolve(REPO, 'data/pmu/lens-convergence-history.ndjson'), 'utf8').trim().split('\n').filter(Boolean);
  // latest row carrying a sweep result (rows may be e0-only annotations)
  let latest = null;
  for (let i = histLines.length - 1; i >= 0 && !latest; i--) { const r = JSON.parse(histLines[i]); if (r.default_vector && r.default_vector.f1 != null) latest = r; }
  const cur = latest ? latest.default_vector.f1 : null;
  const floorF1 = floorDoc.picker ? floorDoc.picker.f1 : null;
  check('sweep-below-floor', 'harvest-accept gate (auto-revert) + this sentinel',
    (cur != null && floorF1 != null && cur < floorF1 - 1e-9) ? [`sweep F1 ${cur} < floor ${floorF1}`] : [],
    'the latest sweep fell below the pinned ratchet floor — a regression landed ungated');
} catch { /* floor/history absent in a bare checkout — non-fatal */ }

// 14. GREEKS-HOLLOW-HA (operator 2026-07-20: "qwen should have the greeks too") — an autonomous
//     harvest-agent state sealed WITHOUT a metal walk. The T-scoped classes above never see HA
//     states (they filter ids starting with 'T'), so the agent's states dashed the HUD Greeks
//     invisibly all night. The seal now calls metalWalk (server up → full Greeks); the loop
//     watchdog keeps the server up; placement_only remains the honest server-down fallback but
//     is a RECURRENCE here — overnight, server-down IS the incident.
check('greeks-hollow-ha', 'harvest-agent seal calls metalWalk + reef-loop server watchdog',
  (tape.timeline_events || []).filter((s) => s.source === 'harvest-agent' && s.metrics && !s.metrics.walk).map((s) => s.id),
  'autonomous HA state with no walk Greeks — attest-serve was down at seal time; the watchdog should have restarted it');

// 16. SELF-AUDIT — "IS THE WORK USEFUL?" (spec §10.5, the highest-value open build). Classes 1-15
//     ask whether OUTPUT IS WELL-FORMED. Not one asks whether the work was WORTH DOING. That gap
//     let the sentinel report 14/14 HELD for five hours across three simultaneous defects, each of
//     which was measurable from artifacts already on disk:
//       · the FIXED POINT      — same batch proposed, refused, reverted, forever (yield = 0)
//       · the STARVED CORPUS   — 40 commits + ~33 files read from a 14,432-commit repo (input flat)
//       · the 48x UNREAD GRID  — the gate computed 48 knob vectors and read exactly 1 (output unconsumed)
//     THREE LEGS, one question each. Every leg is a RATIO or a TREND, never a snapshot — a snapshot
//     cannot tell "working" from "spinning".
{
  const RD = (p) => { try { return JSON.parse(readFileSync(resolve(REPO, p), 'utf8')); } catch { return null; } };
  const NDJ = (p, n) => { try { return readFileSync(resolve(REPO, p), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } };
  const findings16 = [];

  // (a) IS THE INPUT GROWING? A rotating intake must surface DIFFERENT raw counts tick to tick.
  //     Identical counts across a window = the cursor is stuck on one stratum (the 5-hour fixed
  //     point's upstream twin), and no artifact class can see it.
  const intake = NDJ('data/pmu/miner-intake-history.ndjson', 6);
  if (intake.length >= 4) {
    if (new Set(intake.map((r) => r.raw)).size === 1)
      findings16.push(`intake stratum STUCK: ${intake.length} consecutive ticks read an identical ${intake[0].raw}-candidate corpus`);
    const floorDoc = RD('data/pmu/ratchet-floor.json');
    const fl = floorDoc && floorDoc.intake;
    const last = intake.at(-1);
    if (fl && last && last.doc_files < fl.corpus_doc_files_min)
      findings16.push(`corpus SHRANK below the intake ratchet: ${last.doc_files} doc files < floor ${fl.corpus_doc_files_min}`);
  }

  // (b) IS THE OUTPUT CONSUMED? The gate reads ONE vector (default_vector.f1). A gate-path sweep
  //     that computed a full knob grid did 47/48 of its work for nobody. Detects the class of waste
  //     that hid in plain sight inside the gate's own source for the whole night.
  const sweeps = NDJ('data/pmu/lens-convergence-history.ndjson', 8);
  const wasteful = sweeps.filter((r) => r.gate_mode === true && (r.grid || 1) > 1);
  if (wasteful.length)
    findings16.push(`gate-path sweep computed ${wasteful.at(-1).grid} knob vectors but the gate reads 1 — ${wasteful.length}/${sweeps.length} recent gate rows`);

  // (c) IS YIELD MOVING? Over a sustained window of ACCEPTED cycles the capability metric must
  //     actually change. All-accept with a frozen F1 is the mirror image of all-refuse: the gate
  //     has stopped discriminating, and "100% accepted" reads like success on every other panel.
  const withF1 = sweeps.filter((r) => r.default_vector && r.default_vector.f1 != null);
  const haAll = (tape.timeline_events || []).filter((s) => s.source === 'harvest-agent');
  const recentHA = haAll.slice(-12);
  const allAccepted = recentHA.length >= 8 && recentHA.every((s) => (s.metrics || {}).verdict === 'IN_LANE');
  //     THE EXCHANGE RATE (added on the leg's first real firing): "frozen" alone is not actionable
  //     — the operator needs the COST. The accept criterion is non-decreasing F1, so byte-neutral
  //     content passes BY DESIGN and accumulates forever: the ledger has a benefit side and no cost
  //     side. Measured 2026-07-20: +6,582 reef bytes bought +2 derived statements and 0.887 → 0.886
  //     F1. Report bytes-per-cycle beside the frozen metric so the trade is visible, not inferred.
  if (allAccepted && withF1.length >= 6 && new Set(withF1.map((r) => r.default_vector.f1)).size === 1) {
    let cost = '';
    try {
      const reefNow = Buffer.byteLength(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
      const shas = execFileSync('git', ['log', '--format=%H', `-${recentHA.length}`, '--', 'data/pmu/lens-reef.json'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      if (shas.length >= 2) {
        const then = Buffer.byteLength(execFileSync('git', ['show', `${shas.at(-1)}:data/pmu/lens-reef.json`], { cwd: REPO, encoding: 'utf8' }));
        cost = ` · cost: +${(reefNow - then).toLocaleString()} reef bytes over ${shas.length} accepted cycles for ZERO capability gain (the accept criterion is non-decreasing F1, so neutral content passes by design and accumulates — the ledger has no cost side)`;
      }
    } catch { /* git unavailable — the frozen finding still stands */ }
    findings16.push(`yield FROZEN: ${recentHA.length} consecutive accepts while F1 never moved off ${withF1.at(-1).default_vector.f1} — the gate is accepting without improving${cost}`);
  }

  // (d) IS THE RATCHET RATCHETING? If the OBSERVED MINIMUM over a sustained window sits above the
  //     pinned floor, the floor is stale — the system has proven a higher baseline and is still
  //     graded against the old one. Reported, never auto-applied: advancing the floor changes the
  //     constitution's strictness, which is an operator decision (and pinning the HIGH-WATER mark
  //     would refuse the next cycle — the min is the safe statistic, the max is not).
  //     ADVISORY, NOT AN INCIDENT (corrected on first run): a lagging floor is not something being
  //     WRONG — it is a DECISION waiting for the operator. Counting it as a recurrence made the
  //     whole sentinel exit non-zero on a healthy tape, which is the exact cry-wolf failure that
  //     left seven UI guards red-on-correct-code until nobody read them. Incidents and advisories
  //     are different species: an incident says "this is broken", an advisory says "you have earned
  //     a decision". They must never share an exit code.
  if (withF1.length >= 6) {
    const floorDoc = RD('data/pmu/ratchet-floor.json');
    const pinned = floorDoc && floorDoc.picker ? floorDoc.picker.f1 : null;
    const observedMin = Math.min(...withF1.map((r) => r.default_vector.f1));
    if (pinned != null && observedMin > pinned + 1e-9)
      advisories.push(`ratchet LAGGING: observed min F1 ${observedMin} over the last ${withF1.length} sweeps exceeds the pinned floor ${pinned} — the proven baseline has moved and the floor has not. Operator call: advance to the observed MIN (${observedMin}), never the max — pinning the high-water mark would refuse the very next cycle.`);
  }

  check('self-audit-usefulness', 'spec §10.5 — input growing · output consumed · yield moving · ratchet advancing',
    findings16,
    'the work is well-formed but not useful: a stuck intake, an unread computation, a frozen yield, or a stale floor');
}

// 15. HARVEST FIXED-POINT (operator 2026-07-20: "this loop should have identified and fixed
//     that issue"). Every class above watches ARTIFACT INTEGRITY — hollow states, dust, unsigned
//     seals, incoherent verdicts. NONE watched YIELD. So the loop truthfully reported 14/14 HELD
//     for five hours while proposing the IDENTICAL refused batch every tick (HA-62..HA-67 were
//     byte-identical; 52 of 62 refusals were the same candidates recycled — the gate's revert
//     restored the adjudication file, erasing the memory of what had been tried).
//     THE SENSOR: N consecutive refused HA states whose applied-shape is identical = a loop, not
//     a constitution discriminating. Fires at 3 — enough to be a pattern, short enough to catch
//     it in one hour instead of one night. Heal: the refused ledger (data/pmu/miner-refused.json)
//     must be growing; if it is not, the gate is not recording what it refused.
{
  const haStates = (tape.timeline_events || []).filter((s) => s.source === 'harvest-agent');
  const tail = haStates.slice(-4);
  const shape = (s) => JSON.stringify((s.metrics || {}).applied || {}) + '|' + ((s.metrics || {}).verdict || '');
  const allRefused = tail.length >= 3 && tail.every((s) => (s.metrics || {}).verdict === 'OFF_DOMAIN');
  const identical = tail.length >= 3 && new Set(tail.map(shape)).size === 1;
  check('harvest-fixed-point', 'refused ledger (miner-refused.json) + miner cursor consults it',
    (allRefused && identical) ? [`${tail.length} consecutive refused cycles with identical applied-shape ${shape(tail[0])} — the miner is re-proposing a refused batch`] : [],
    'the loop is spinning: same batch proposed, refused, reverted, repeat — yield is zero and no artifact class can see it');
}

// 17. MEMORYLESS SELECTOR (spec §3 I3) — the sentinel DISCOVERS selectors instead of listing them.
//     Every class above was pointed at something by a human; that is why 14/14 read HELD through
//     five dead hours. This one enumerates its own subjects: any script that ranks candidate
//     material AND writes it into a shared corpus is swept in automatically, so a new memoryless
//     selector turns the suite red without anyone editing this file. Its first run found FIVE
//     nobody had listed — including reef-densify, which mines 443 blog posts with no memory at all.
//     Debt is declared AT THE SITE (// @selector: memoryless-debt), never in a list here: an
//     allowlist forgives, a ratcheted at-site tag expires.
try {
  const { census, undeclared, declaredDebt } = await import(resolve(REPO, 'scripts/pmu/selector-census.mjs'));
  const rows = census();
  const news = undeclared(rows), debt = declaredDebt(rows);
  check('memoryless-selector', 'selector-census structural discovery + at-site debt tags',
    news.map((r) => `${r.file} (${!r.has_memory ? 'no attempt history' : !r.deflates_upstream ? 'deflates after the ranking' : 'never records its picks'})`),
    'a selector ranks candidate material without consulting what it already tried — the fixed-point shape');
  let pin = null;
  try { pin = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/ratchet-floor.json'), 'utf8')).selectors; } catch { /* unpinned */ }
  if (pin && debt.length > pin.memoryless_debt_max)
    findings.push({ class: 'selector-debt-grew', guard: 'ratchet-floor.selectors (one-way)', recurrences: 1,
      detail: [`${debt.length} declared-debt selectors exceeds the pin of ${pin.memoryless_debt_max} — the debt ratchet only shrinks`], status: 'RECURRED' });
  else if (debt.length)
    advisories.push(`selector debt: ${debt.length} discovered selector(s) rank material with no attempt history, each declared at its own site — ${debt.map((r) => r.file.split('/').pop()).join(', ')}. Not incidents (recorded, pinned, one-way); each is wired by deleting its tag in the same commit.`);
} catch { /* census absent in a bare checkout — non-fatal */ }

// 18. LAMBDA OUT OF VACUUM (spec §3 I3) — the burn-mass threshold is only defensible while NOTHING
//     lives around it. That was measured ONCE on ONE lane; a constant justified by a single
//     measurement is a constant on its way to becoming a superstition. This re-derives the largest
//     empty interval from whatever the attempt history now holds, across ALL lanes, label-free.
try {
  const { measureVacuum } = await import(resolve(REPO, 'scripts/pmu/burn-mass.mjs'));
  const v = measureVacuum();
  check('lambda-out-of-vacuum', 'burn-mass measureVacuum() re-measured across every lane',
    v.ok === false ? [v.reason] : [],
    'lambda is cutting through occupied space — it is a guess now, not a line through vacuum, and must be re-derived');
  // A SHRINKING margin is a decision, not a defect: lambda still works, but the room around it is
  // closing. Advisory so it cannot cry wolf, named so it cannot be missed.
  if (v.ok === true && Math.min(v.margin_below, v.margin_above) < 0.08)
    advisories.push(`lambda MARGIN NARROW: vacuum [${v.vacuum[0]}, ${v.vacuum[1]}] width ${v.width} across ${v.lanes} lanes / ${v.pairs} pairs — lambda ${v.lambda} has only ${Math.min(v.margin_below, v.margin_above)} of clearance. Note this already CORRECTS the spec's single-lane claim that any lambda in 0.2-0.6 behaves identically: 0.6 now sits outside the vacuum. Operator call: re-centre lambda in the measured interval.`);
} catch { /* primitive absent in a bare checkout — non-fatal */ }

// 6. UNSIGNED — seal-era states missing the content hash (operator: "the sh should have
//    kicked this back — local hash time — · unsigned · receipt n/a"). Era = first sealed state.
const sealEra = T.findIndex((s) => s.seal && s.seal.content_sha256);
check('unsigned-state', 'seal at both doors (perturb + /tape-append)',
  (sealEra >= 0 ? T.slice(sealEra) : []).filter((s) => !(s.seal && s.seal.content_sha256)).map((s) => s.id),
  'state after the seal era with no content_sha256');

// ── convergence velocity (the one Greek) + scenario drift ───────────────────────────────────
// 7. CONVERGENCE DRIFT — a breach on the flight tape that never flipped back to 0 (velocity 0),
//    OR a real scenario (not the negative control) sitting in drift. This is the alpha signal:
//    the loop is not converging. Heals by kickback like every other class.
try {
  const { execFileSync } = await import('node:child_process');
  const velRaw = (() => { try { return execFileSync('node', [resolve(REPO, 'scripts/pmu/convergence-velocity.mjs'), '--json'], { cwd: REPO, encoding: 'utf8' }); } catch (e) { return e.stdout || '{}'; } })();
  const vel = JSON.parse(velRaw);
  const scnRaw = (() => { try { return execFileSync('node', [resolve(REPO, 'scripts/pmu/velocity-scenarios.mjs'), '--json'], { cwd: REPO, encoding: 'utf8' }); } catch (e) { return e.stdout || '{}'; } })();
  const scn = JSON.parse(scnRaw);
  const badScenarios = (scn.results || []).filter((r) => r.drift && r.key !== 'unrecoverable-drift').map((r) => r.key);
  const tapeDrift = (vel.summary && vel.summary.drift_unflipped) || 0;
  check('convergence-drift', 'convergence-velocity + velocity-scenarios tests',
    [...(tapeDrift ? [`${tapeDrift} unflipped breach on the tape`] : []), ...badScenarios],
    'a breach that never returned to 0 — the loop is drifting, not converging');
} catch { /* velocity tooling absent in a bare checkout — non-fatal */ }

// ── lens tape (microscope) ────────────────────────────────────────────────────
const microPath = resolve(REPO, 'data/grip/microscope.json');
if (existsSync(microPath)) {
  const m = JSON.parse(readFileSync(microPath, 'utf8'));
  // 4. EMPTY PANELS — the never-empty guarantee (an empty panel is a bug, not a state)
  check('empty-lens-panel', 'never-empty STANDING fallback',
    [...(m.tape || []), ...(m.held_tape || [])].filter((t) => !t.coherence.never_empty).map((t) => t.inbound_event.intent_prompt.slice(0, 40)),
    'domain/template/rules empty in a tape row');
  // 5. HELD-OUT BREACH — Φ_held > 0 (the memorization/poisoning guard — caught both mass incidents)
  check('held-out-breach', 'Φ_held gate (grip-microscope accept-criterion)',
    m.phi && m.phi.held_out > 0 ? ['Φ_held=' + m.phi.held_out] : [],
    'held-out off-lane count above zero');
}

const recurred = findings.filter((f) => f.status === 'RECURRED');
const out = { ts: new Date().toISOString(), alpha: { classes: findings.length, held: findings.length - recurred.length, recurred: recurred.length,
  reads: 'alpha = recurrences-since-guard pinned at 0 across all classes; NOT σ (placement spread)' }, findings };

if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`tape-health · ${findings.length} incident classes · ${out.alpha.held} HELD · ${recurred.length} RECURRED${advisories.length ? ` · ${advisories.length} ADVISORY` : ''}`);
  for (const a of advisories) console.log(`  ⓘ ADVISORY — ${a}`);
  for (const f of findings) console.log(`  ${f.status === 'HELD' ? '✓' : '✗'} ${f.class} [guard: ${f.guard}] — recurrences ${f.recurrences}${f.recurrences ? ' · ' + f.detail.join(', ') : ''}`);
}

// ── THE KICK-BACK (--kick): a recurrence fires a self-prompt WITH the root context ───────────
if (recurred.length && process.argv.includes('--kick')) {
  const due = new Date(Date.now() + 3600e3).toISOString();
  for (const f of recurred) {
    try {
      execFileSync('node', [resolve(REPO, 'scripts/self-prompt-create.mjs'),
        '--due', due,
        '--action', `tape-health RECURRENCE: ${f.class} came back (${f.recurrences}x) despite guard ${f.guard} — the guard has a hole; fix the DOOR, not the state, and extend the guard in the same commit`,
        '--context', `detail: ${f.detail.join(', ')} · sentinel: scripts/pmu/tape-health.mjs · the five classes and their guards are the alpha burn-down (docs/architecture/six-part-convergence-invariant-experiment.md)`,
        '--room', 'builder'], { cwd: REPO, stdio: 'pipe', timeout: 30000 });
      console.log(`  🛰️ kicked back self-prompt for ${f.class}`);
    } catch { console.error(`  ✗ kick-back failed for ${f.class} — create the self-prompt manually`); }
  }
}
process.exit(recurred.length ? 1 : 0);
