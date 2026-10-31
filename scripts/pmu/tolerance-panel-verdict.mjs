#!/usr/bin/env node
// scripts/pmu/tolerance-panel-verdict.mjs — ONE place that decides what a tolerance panel READS AS.
//
// WHY THIS FILE EXISTS (the defect it was extracted to close, 2026-09-08):
// attest-demo.mjs printed "✅ in lane" whenever `tp.tooMany` was falsy — and `offPct == null` is
// falsy. The degenerate branch beside it only fired at `offPct >= 90`, so a null slipped past BOTH
// and the panel rendered:
//     TOLERANCE PANEL: 0g · 0a · 0r · off-lane null% vs 25% kill  ✅ in lane
// Zero grounded tiles, no measurement taken, green check. attest-demo-lifecycle.mjs:47 already
// mapped `offPct == null` → UNMEASURED, so the printer and the receipt disagreed about the same run.
//
// "I did not look" and "I looked and saw nothing" are different claims. For an insurance trigger
// only the second can ever be IN_LANE, and a false green is indistinguishable from a real one from
// the outside — which is the single output this whole instrument exists to say is not allowed.
//
// FORECLOSES: printing a bespoke pass/fail string at any panel call site. Every renderer asks here,
// so a future site cannot re-grow its own copy of the rule and drift from the receipt again.

/**
 * @param {{green?:number, amber?:number, red?:number, offPct?:number|null, tooMany?:boolean}|null} tp
 * @returns {'NO_PANEL'|'UNMEASURED'|'DEGENERATE'|'TOO_MANY'|'IN_LANE'}
 */
export function tolerancePanelVerdict(tp) {
  if (!tp) return 'NO_PANEL';
  const offPct = tp.offPct;
  // FAIL CLOSED FIRST. Absent data is never a pass, and it is checked before every other branch so
  // that no later condition can accidentally absorb it (which is exactly how the defect happened).
  if (offPct == null || Number.isNaN(Number(offPct))) return 'UNMEASURED';
  if ((tp.green ?? 0) === 0 && Number(offPct) >= 90) return 'DEGENERATE';
  if (tp.tooMany) return 'TOO_MANY';
  return 'IN_LANE';
}

/** The human string for a verdict, so the wording lives beside the decision. */
export function tolerancePanelMark(verdict) {
  return {
    NO_PANEL: '',
    UNMEASURED: '  ⚠ UNMEASURED — no off-lane count was produced this run',
    DEGENERATE: '  ⚠ DEGENERATE — the intent corpus did not ground onto the lattice',
    TOO_MANY: '  ⚠ TOO MANY — work drifts off-lane',
    IN_LANE: '  ✅ in lane',
  }[verdict] ?? '';
}

// ── C1375 (2026-10-28) — THE ONE WALK READING → THE ONE BOOLEAN ───────────────────────────────────
// Three verdict formulas lived on the attest-demo surface (docs/pmu/reports/2026-10-28-surgery-
// rewording-walk-vs-ncd.md): the web badge read a flat intent/reality/negative gzip-NCD
// (attest-hypotheses.mjs placement()), the lifecycle's boolean_state mixed a 12-axis gzip oracle gate
// with the walk's off-lane count, and the 144×144 walk itself (buildTriptychInputs → renderTriptych
// through scripts/vna/door-crate.mjs on the crate) drew the panels and reached no badge. A placement
// reading comes from the one Rust walk, never a proxy, and one rule lives in one place — this is it.
// Every surface that turns a tolerance-panel reading into IN_LANE / OFF_DOMAIN / UNMEASURED asks here:
// attest-serve.mjs (/render → the live badge), attest-demo-ux.mjs (the sealed boot badge) and
// attest-demo-lifecycle.mjs (boolean_state on the receipt schema).
//
// What this projection IS sufficient for: WHERE the reality landed against the intent lane — the walk's
// off-lane fraction against the kill, and the region classifier's tier. What it is NOT: whether the work
// is good (undecidable, Rice), and whether the reality sits nearer a declared negative than the intent
// (that is the gzip-NCD triangulation, which stays on the page as a labelled second reading).

export const WALK_DECIDED_BY = 'the one Rust walk — buildTriptychInputs → renderTriptych (scripts/pmu/triptych-build.mjs · scripts/pmu/triptych-render.mjs) through scripts/vna/door-crate.mjs on the crate (intentguard/src/ballistic.rs): off-lane % vs the kill → tier. Never gzip-NCD.';

/**
 * @param {{offPct?:number|null, tooMany?:boolean, tier?:string|null, green?:number, amber?:number, red?:number,
 *          refused?:boolean, refusal?:string|null, tolRefused?:boolean, tolRefusal?:string|null,
 *          killTolerancePct?:number, error?:string}|null} tp
 *   the walk's tolerance reading — attest-serve.mjs _oneTriptych (renderTriptych's tol, flattened) or
 *   attest-demo.mjs genTriptych's R.triptych. Both come off the same renderTriptych call.
 * @param {{kill?:number}} [opts] the kill the caller expects when the reading does not carry killTolerancePct (attest-demo's
 *   genTriptych and the ux seal run at 25, the OFFLANE_KILL_PCT the receipt prints). C1409: the verdict is the crate's, sealed at the
 *   kill the walks ran under; a reading or caller that claims another kill reads UNMEASURED (KILL_MISMATCH), never a re-read.
 * @returns {{state:'IN_LANE'|'OFF_DOMAIN'|'UNMEASURED', reading:string, offPct:number|null, tooMany:boolean|null,
 *            tier:string, kill:number, reason:string|null, decidedBy:string}}
 */
// ── C1394 (2026-10-29) — A READING WITHOUT ITS HEALTH STAMP IS NOT A READING ──────────────────────────────────────────────
// The walk's one entry (door.rs entry_op via buildTriptychInputs) stamps every result: the aperture version, the reef and axes
// shas, the engine that answered, and the size of every text it took. A reading missing any of them — an old fixture, a caller
// that rebuilt the object and dropped the field, a node walk (engine ≠ rust) — cannot say WHICH instrument at WHAT mass produced
// it, so it can never become IN_LANE or OFF_DOMAIN: walkBoolean returns UNMEASURED naming what is missing.
// C1407: no reef_sha — a stamped sha names only bytes the walk read, and no stage of the walk reads lens-reef.json.
export const STAMP_FIELDS = ['apertureVersion', 'axes_sha', 'engine', 'sizes'];
/** the stamp fields a reading lacks ([] = complete). engine must be 'rust'; sizes must name at least one text with chars + gz_bytes. */
export function stampMissing(stamp) {
  if (!stamp || typeof stamp !== 'object') return ['stamp'];
  const miss = [];
  for (const k of ['apertureVersion', 'axes_sha']) if (typeof stamp[k] !== 'string' || !stamp[k]) miss.push(k);
  if (stamp.engine !== 'rust') miss.push(stamp.engine ? `engine=${stamp.engine} (not rust)` : 'engine');
  const sz = stamp.sizes && typeof stamp.sizes === 'object' ? Object.values(stamp.sizes) : [];
  if (!sz.length || !sz.every((s) => s && Number.isFinite(s.chars) && Number.isFinite(s.gz_bytes))) miss.push('sizes');
  if (stamp.below_floor) miss.push(`below_floor: ${stamp.below_floor}`);   // a panel drawn under the floor (the commit-panel opt-in) is never a verdict
  return miss;
}

// C1406: the shape check above names what a reading lacks; the stamp is then VERIFIED as the crate's (door.rs verify_op through
// door-crate.mjs verifyStamp): the seal recomputed under the binary's build id, the floor on every size, the sense and walk stages.
// A hand-typed stamp, a tampered field, or a size under the floor reads UNMEASURED with the crate's reason.
import { verifyStamp } from '../vna/door-crate.mjs';

// ── C1409 (2026-10-29, operator: "rust only") — THE VERDICT IS THE CRATE'S; THIS IS THE RELAY ──────────────────────────────────────
// offPct = round(100·orth/total), tooMany = offPct > kill and the region classifier's tier are decisions, and the crate takes them: the
// walks op decodes the intent and reality walks at the kill it was handed (door.rs walks → door_panel.rs decode_edges, the port of
// triptych-render.mjs's edge decoder) and seals { offPct, tooMany, tier, kill } into the stamp, integers, under the same seal verify
// recomputes. sealedVerdict is the one node line that reads them. walkBoolean takes its state, offPct, tooMany, tier and kill from it
// and from nothing else; renderTriptych paints from it (triptych-render.mjs offLaneOf). A stamp that carries none (the walks ran without
// a kill, or no crate walk ran) answers null; a decode the crate refused answers its refusal. Node compares nothing here.
// @guard tests/vna/c1409-the-verdict-and-the-floor-live.test.mjs (V1, V5)
export function sealedVerdict(stamp) {
  const v = stamp && typeof stamp === 'object' ? stamp.verdict : null;
  if (!v || typeof v !== 'object') return null;
  const kill = v.kill != null && Number.isFinite(Number(v.kill)) ? Number(v.kill) : null;
  if (v.offPct == null) return { refused: true, refusal: String(v.refusal || 'the crate sealed no off-lane count'), kill };
  if (!Number.isInteger(v.offPct) || typeof v.tooMany !== 'boolean' || typeof v.tier !== 'string' || kill == null)
    return { refused: true, refusal: `the stamp's verdict is not in the crate's shape (${JSON.stringify(v).slice(0, 120)})`, kill };
  return { offPct: v.offPct, tooMany: v.tooMany, tier: v.tier, kill };
}

export function walkBoolean(tp, opts = {}) {
  // the kill a reading CLAIMS (its own killTolerancePct, else the caller's opts.kill); the verdict's kill is the one the crate sealed
  const given = (x) => x != null && x !== '' && Number.isFinite(Number(x));
  const claimed = given(tp?.killTolerancePct) ? Number(tp.killTolerancePct) : given(opts.kill) ? Number(opts.kill) : null;
  const panel = (tp && !tp.error) ? tp : null;
  // the count the panel DREW (renderTriptych paints it from the sealed verdict): it says whether a panel was drawn, never what it reads
  const drawn = (panel && panel.offPct != null && !Number.isNaN(Number(panel.offPct))) ? Number(panel.offPct) : null;
  const stamp = (panel && panel.stamp) || null;
  const refuse = (reading, reason) => ({ state: 'UNMEASURED', reading, offPct: drawn, tooMany: drawn == null ? null : (typeof panel.tooMany === 'boolean' ? panel.tooMany : null),
    tier: 'UNMEASURED', kill: claimed ?? 25, reason, stamp, decidedBy: WALK_DECIDED_BY });
  // FAIL CLOSED FIRST: no panel, or a panel that drew no count (the entry refused, the lit-mass floor) — its own reason, before anything
  if (!panel) return refuse('NO_PANEL', tp && tp.error ? `no walk panel: ${tp.error}` : 'no walk panel on this run');
  if (drawn == null) return refuse('UNMEASURED', panel.refusal || panel.tolRefusal || 'the walk produced no off-lane count (lit-mass floor) — too thin to grade; never a pass');
  // C1394: a verdict needs the entry's full health stamp
  const miss = stampMissing(stamp);
  if (miss.length) return refuse('UNSTAMPED', `no health stamp (${miss.join(', ')} missing) — a walk reading must carry apertureVersion, axes_sha, engine rust and the text sizes from the walk's one entry (C1394); never a pass`);
  // C1406: the stamp is verified as the crate's — the seal recomputed under the binary's build id, the floor, the sense and walk stages
  const v = verifyStamp(stamp);
  // C1412 S4: the crate names a missing spec_mass / spec_margin / spec_separation beside the seal (a deleted field breaks both)
  if (!v.ok) return refuse('UNVERIFIED', `the stamp is not the crate's (${v.reason})${v.specMissing && v.specMissing.length ? ` · S4: ${v.specMissing.join(', ')} missing` : ''} — a reading is a verdict only on a stamp the crate signed and re-verifies (C1406); never a pass`);
  // C1411 S3: the crate admits a verdict only on a spec that separated its own positive (IN_LANE) from its own negative (OFF_DOMAIN);
  // its line (SPEC_INSUFFICIENT · positive <verdict> · negative <verdict>, or PLACEMENT_ONLY) is relayed verbatim as the reason.
  if (!v.admitted) return refuse(String(v.admission || 'SPEC_INSUFFICIENT').split(' ')[0], `${v.admission} — the crate did not admit this spec to a verdict (C1411, S3); never a pass`);
  // C1409: the verdict itself is the crate's, read off the verified stamp — no comparison is made here
  const sealed = sealedVerdict(stamp);
  if (!sealed) return refuse('NO_VERDICT', 'the stamp carries no sealed verdict — the crate decides offPct, tooMany and the tier at the kill it walked under (C1409, rust only); a reading without it is never a verdict');
  if (sealed.refused) return refuse('NO_VERDICT', `the crate sealed no verdict: ${sealed.refusal} (C1409); never a pass`);
  if (claimed != null && claimed !== sealed.kill) return refuse('KILL_MISMATCH', `the reading claims kill ${claimed} %, the crate decided at kill ${sealed.kill} % — a verdict is read only at the kill the crate sealed (C1409); never a pass`);
  const reading = tolerancePanelVerdict({ green: panel.green, offPct: sealed.offPct, tooMany: sealed.tooMany });
  const state = reading === 'IN_LANE' ? 'IN_LANE' : reading === 'TOO_MANY' ? 'OFF_DOMAIN' : 'UNMEASURED';
  const { offPct, tooMany, kill } = sealed;
  // the tier is the crate's underwriting output of a MEASURED reading; an unmeasured one (DEGENERATE) has none
  const tier = state === 'UNMEASURED' ? 'UNMEASURED' : sealed.tier;
  const reason = state !== 'UNMEASURED' ? null : 'DEGENERATE — the intent corpus did not ground onto the lattice (0 green, off-lane >= 90%)';
  return { state, reading, offPct, tooMany, tier, kill, reason, stamp, decidedBy: WALK_DECIDED_BY };
}

