#!/usr/bin/env node
// scripts/pmu/attest-sweep.mjs — THE TRIPWIRE UNDER ONE SPECIFICATION, SHIPPED (C1386, 2026-10-29).
//
// One specification. Reality morphed word by word from the faithful scenario toward a declared failure, the
// intent and the negative held fixed. At each blend step BOTH instruments read the same text, side by side:
//   · the flat gzip-NCD gate on the flight tape (writeTapeIntent → readTapeReceipt, tape-intent.mjs / tape-receipt.mjs)
//   · the one Rust walk (buildTriptychInputs → renderTriptych through door-crate on the crate) through walkBoolean
//     (tolerance-panel-verdict.mjs) — the badge's instrument as C1375 wired it: off-lane % vs the kill → IN_LANE / OFF_DOMAIN,
//     a null count UNMEASURED and never a pass.
// Per pair the door prints the first-flip blend fraction and the flip count for EACH instrument; the whole set runs twice
// inside one invocation and the sha256 of each instrument's verdict sequence is printed with whether the two runs are equal.
// Neither instrument is forced to agree with the other: where they differ, both are reported as measured.
//
// What this projection IS sufficient for: whether the verdict flips once at a fixed fraction as reality leaves the lane,
// per instrument, and whether a rerun reproduces it. What it is NOT: cross-text classification of independently written
// rewordings (that is C1377's 6/10, a different question), and whether the work was good (undecidable, Rice).
//
// Offline, LLM-free, data from this file's own tree (the repo in-tree, the package root in the npm tarball), output under
// the caller's cwd. `npx thetacog-mcp attest-sweep` and `npx thetacog-mcp attest-demo --sweep` both land here.
//
// THE STDOUT IS READ COLD (C1392, 2026-10-29 — wo1 ran `server.js attest-sweep` from an empty git repo: 262 s, engine rust,
// fallbacks {}, both shas equal, and the numbers were right while the page did not say what they meant). In order, stdout prints:
// (1) line 1 the sufficiency statement above, then the RUNTIME line; (2) every column defined once (COLUMNS), each instrument's
// states included; (3) the per-pair table, each tier past the kill followed by its inputs (dir · sev · blast) because the
// tier reads WHERE the off-lane mass sits, never how much (triptych-render.mjs region classifier; door_panel.rs the same rule);
// (4) the per-pair arrow labelled "first → last state"; (5) one ENDPOINT sentence per pair, the pure negative's reading in plain
// words; (6) beside k of n, how many pairs never return to IN_LANE after the first trip (UNPLACEABLE an abstention, not a
// return); (7) a PLATFORM line: the prebuilt walker is macOS arm64 only (postinstall.js), so the sha across platforms and engines
// is UNMEASURED. --quiet prints none of it. None of this touches a verdict: the sequences and their shas are C1386's.
//
// Usage:
//   node scripts/pmu/attest-sweep.mjs                              # the full pair set, 11 steps, run twice
//   node scripts/pmu/attest-sweep.mjs --pair faithful,sledgehammer --pair faithful,hallucination --steps 11
//   node scripts/pmu/attest-sweep.mjs --json <path> [--runs 2] [--out-dir <dir>] [--quiet]

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { blendSweep, resolveScenario, KNOWN_KEYS, DATA_ROOT } from './tape-blend-sweep.mjs';
import { SCENARIOS } from './attest-scenarios.mjs';
import { PRESETS } from './tape-presets.mjs';
import { stats as DOOR_STATS, crateEnabled as doorCrateEnabled } from '../vna/door-crate.mjs';   // which engine walked, off the crate's own counters
import { walkEngine } from './attest-recompute.mjs';
import { THRESHOLD as DRIFT_LIMIT_PCT } from './attest-hypotheses.mjs';   // C1393: the gate's drift limit, printed, never copied

export const KILL_PCT = 25;   // the kill attest-demo's badge grades against (OFFLANE_KILL_PCT)
export const INSTRUMENTS = Object.freeze({
  ncd: 'the flat gzip-NCD gate on the flight tape (tape-intent.mjs writeTapeIntent → readTapeReceipt; attest-hypotheses.mjs placement)',
  walk: 'the one Rust walk — buildTriptychInputs → renderTriptych through scripts/vna/door-crate.mjs on the crate, read through walkBoolean (tolerance-panel-verdict.mjs); off-lane % vs the kill',
});
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ── WHAT THE PAGE SAYS BEFORE IT SAYS ANY NUMBER (C1392) ─────────────────────────────────────────────────────────
// Line 1 of stdout. The same sentence as the header comment's sufficiency paragraph, said where a cold reader reads it.
export const SUFFICIENCY_LINE = 'THIS RUN IS SUFFICIENT FOR: the verdict\'s path, per instrument, as reality morphs word by word toward the declared negative under one specification (intent and negative held fixed), and its byte-identity on rerun. IT IS NOT SUFFICIENT FOR: cross-text classification of independently written rewordings (a different question), or whether the work was good (undecidable, Rice).';
// C1393 THE FLOOR: every text a pair compares goes to the walk's one entry in one crate call per pair (tape-blend-sweep.mjs); a step
// the crate names under its floor (320 chars / 220 gz bytes) is BELOW_FLOOR on the gate and UNMEASURED on the walk — both refusals,
// never trips — and a pair whose intent or negative is under it is refused whole, the reason printed. Every walk row carries the
// entry's stamp (apertureVersion · reef_sha · axes_sha · engine).
// The measured cost: wo1's cold run of the full default set (11 pairs × 11 steps × 2 runs = 242 steps) took 262 s on an arm64
// Mac with the prebuilt walker (the packed-tarball run in docs/pmu/reports/2026-10-29-tripwire-sweep-shipped.md took 200 s).
export const MEASURED_STEP_S = 262 / 242;   // the RUNTIME estimate's basis; the ENGINE line prints this run's measured ms
const about = (s) => (s < 90 ? `about ${Math.max(1, Math.round(s))} s` : `about ${Math.round(s / 60)} minutes`);
export function runtimeLine({ pairs, steps, runs }) {
  const full = defaultPairs().length * 11 * 2, here = pairs * steps * runs;
  return `RUNTIME  (estimate, before the run) ${about(full * MEASURED_STEP_S)} on an arm64 Mac for the full set (${defaultPairs().length} pairs × 11 steps × 2 runs = ${full} steps; 262 s measured cold, about 1 s a step); this invocation is ${pairs} pair${pairs === 1 ? '' : 's'} × ${steps} steps × ${runs} run${runs === 1 ? '' : 's'} = ${here} steps, ${about(here * MEASURED_STEP_S)}. Elsewhere postinstall builds the walker with cargo first (up to 300 s), or the walk falls back to node; the ENGINE line at the end names which ran.`;
}
// Every column the table prints, defined once. The tier lines name the classifier's inputs: past the kill the tier is not a
// function of off%, it reads where the off-lane mass sits — so 29 % can read UNINSURABLE beside 41 % PRICEABLE.
export function columnLines(kill = KILL_PCT) {
  return [
    'COLUMNS  (defined once here; every PAIR table below uses them)',
    '   f         blend fraction: the share of word slots taken from the declared negative\'s text (0.00 = the faithful reality, 1.00 = the pure negative)',
    '   words     words in the blended reality at that step',
    `   gzip-NCD  the flat gate's verdict on the flight tape (gzip compression distance, no lattice): IN_LANE = reality sits nearer the intent than the declared negative and inside the gate's drift limit; OFF_DOMAIN = nearer the declared negative, or past the drift limit (a trip); UNPLACEABLE = dI and dN too close to call, the gate abstains (never a trip, never a pass); BELOW_FLOOR = a text under the walk entry's floor (320 chars / 220 gz bytes, the crate decides): the gate's answer is recorded, never counted, a refusal like UNPLACEABLE ("padded" beside it when the gate wrapped the text in boilerplate first); REJECTED / EMPTY = the tape refused the row`,
    `      drift   the gate's drift limit is ${DRIFT_LIMIT_PCT} %: drift = 100·dI/(dI+dN); a row reading OFF_DOMAIN while dI < dN was decided by the limit, not by nearness, and prints "(drift D > ${DRIFT_LIMIT_PCT})" beside it`,
    '   dI        gzip normalised compression distance from reality to the intent (0 = the same text, about 1 = unrelated)',
    '   dN        the same distance from reality to the declared negative; the gate compares dN with dI',
    `   walk      the one Rust walk on the 144×144 lattice, read through walkBoolean: IN_LANE = off% at or under the ${kill} % kill; OFF_DOMAIN = off% over the kill (a trip); UNMEASURED = too few significant cells lit to grade (the lit-mass floor refuses), never a pass`,
    '   off%      the walk\'s off-lane share, in percent: of all reality\'s significant lattice cells (the denominator), the share that land two or more 12×12 blocks away from every block the intent dominates; printed with its % on every row',
    '   LIT-MASS FLOOR  a walk reason that names it counts significant cells on BOTH sides: the walk refuses when the intent OR the reality is under the floor, so both counts print beside it',
    '   tooMany   off% over the kill: the walk\'s own trip bit',
    '   tier      the region classifier\'s underwriting tier (triptych-render.mjs decodeDeltaThreeColourEdges; the crate\'s door_panel.rs holds the same rule). INSURABLE when tooMany is false. Past the kill the tier is not a function of off%: it reads WHERE the off-lane mass sits, not how much — UNINSURABLE when dir is bottom-up AND (sev is moderate or severe, OR blast is systemic), else PRICEABLE. Each tier past the kill prints its inputs beside it:',
    '      dir    bottom-up · top-down · self: the sign of the ruling red block\'s offset (bottom-up = an operational lane acting on a strategy lane it never declared)',
    '      sev    minor · moderate · severe: macro distance 0 · 1 · 2 between the ruling block\'s two lanes (Strategy · Tactics · Operations)',
    '      blast  point · bounded · systemic: 1 · 2 to 5 · 6 or more red blocks on the line that best explains the red',
  ];
}
// the tier's inputs as printed beside it — only past the kill, where the classifier had red blocks to read
export const tierInputs = (w) => (w && w.tooMany && w.region ? `dir ${w.region.direction} · sev ${w.region.severity} · blast ${w.region.blastRadius}` : '');
const REFUSALS = new Set(['UNPLACEABLE', 'UNMEASURED', 'REJECTED', 'EMPTY', 'BELOW_FLOOR']);
// C1393: the gate cell as printed — BELOW_FLOOR says "padded" when fatten() wrapped the text; an OFF_DOMAIN the drift limit decided says so
export function gateCell(n) {
  if (n.verdict === 'BELOW_FLOOR') return n.padded ? 'BELOW_FLOOR·padded' : 'BELOW_FLOOR';
  return String(n.verdict);
}
export const driftNote = (n) => (n.verdict === 'OFF_DOMAIN' && n.dI != null && n.dN != null && n.dI < n.dN && n.drift != null ? `  (drift ${n.drift} > ${DRIFT_LIMIT_PCT})` : '');
const litNote = (r) => (/LIT-MASS FLOOR/.test(String(r || '')) ? ' (the floor judges each side: refused when either is under it)' : '');
// C1432: why the walk issued no verdict, in the words of the refusal it relayed. walkBoolean (tolerance-panel-verdict.mjs) relays a spec the
// crate did not admit as "<the crate's admission line> — the crate did not admit this spec to a verdict", and that line starts with the
// admission's own state (SPEC_INSUFFICIENT or PLACEMENT_ONLY, door.rs admit_op); an S3b refusal is the admission's, never "too thin".
export function unmeasuredWhy(reason) {
  const r = String(reason || '');
  if (/below floor/.test(r)) return 'under the walk entry\'s floor';
  if (/^(SPEC_INSUFFICIENT|PLACEMENT_ONLY)\b/.test(r)) return `refused by the admission: ${r.split(' — ')[0]}`;
  if (/LIT-MASS FLOOR/.test(r)) return 'too thin to grade';
  return r.split(' — ')[0] || 'no reading';
}
/** the pure-endpoint reading of one pair, one plain sentence — the headline objection stated before anyone has to find it */
export function endpointSentence(p) {
  const s = p.steps[p.steps.length - 1];
  const w = s.walk, g = s.ncd.verdict;
  const ins = tierInputs(w);
  const walkPart = w.state === 'UNMEASURED' ? `walk UNMEASURED (${unmeasuredWhy(w.reason)}, never a pass)` : `walk ${w.state} ${w.offPct} % (tier ${w.tier}${ins ? ': ' + ins : ''})`;
  const verdict = w.state === g ? `both instruments read ${g}` : (REFUSALS.has(w.state) && REFUSALS.has(g)) ? 'both instruments refuse to read it' : (REFUSALS.has(w.state) || REFUSALS.has(g)) ? 'one instrument abstains where the other answers' : 'the two instruments disagree';
  return `${p.from} → ${p.to} at f=${s.f.toFixed(2)}${s.f === 1 ? ' (the pure negative)' : ''}: ${walkPart}, gate ${g} — ${verdict}${s.f === 1 ? ' at the pure negative' : ''}`;
}
export function platformLine(engine) {
  return `PLATFORM  this box ${process.platform}/${process.arch}, engine ${engine}. The prebuilt walk binary ships for macOS arm64 only (postinstall.js in the thetacog-mcp package); on any other platform postinstall builds it from the bundled Rust source with cargo (up to 300 s), or the walk falls back to node, and the ENGINE line names which ran. The verdict shas across platforms and engines are UNMEASURED: the shas above are this box's two runs, never a claim that another box reproduces them.`;
}

/** THE PAIR SET, n stated: faithful → every failure scenario attest-scenarios.mjs declares (abstain-tie included — the door reports
 *  what it does), claims-faithful → its two failures, and every fixture row tape-presets.mjs holds as a target for faithful. */
export function defaultPairs() {
  const pairs = [];
  for (const s of SCENARIOS) if (s.key !== 'faithful' && s.key !== 'claims-faithful') pairs.push(['faithful', s.key]);
  pairs.push(['claims-faithful', 'claims-drift'], ['claims-faithful', 'claims-catastrophe']);
  for (const p of PRESETS) if (p.fixture) pairs.push(['faithful', 'preset:' + p.tag]);
  return pairs;
}

// the verdict column per instrument on a mapped step — a gate refusal keeps its typed state (REJECTED / EMPTY), never a verdict
const ncdVerdict = (r) => r.ncd.verdict;
const walkVerdict = (r) => r.walk.state;
// THE TRIP: the instrument reads OFF_DOMAIN — the tripwire fired. UNPLACEABLE / UNMEASURED / INSUFFICIENT_MASS are refusals, not trips.
export const TRIP = 'OFF_DOMAIN';

function instrumentSummary(steps, verdictOf) {
  const seq = steps.map(verdictOf);
  const flips = []; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips.push({ at: steps[i].f, from: seq[i - 1], to: seq[i] });
  const tripIdx = seq.findIndex((v) => v === TRIP);
  // C1392 THE SECOND COUNT: tripped and never IN_LANE again at or after the first trip. A later UNPLACEABLE / UNMEASURED / typed
  // refusal is an abstention, not a return, so a gate that trips and then abstains still stays out; "monotone" (exactly one flip)
  // cannot see that, which is why both counts print side by side.
  const staysOut = tripIdx >= 0 && !seq.slice(tripIdx).includes('IN_LANE');
  return { sequence: seq, start: seq[0], end: seq[seq.length - 1], flips: flips.length, first_flip_at: flips.length ? flips[0].at : null, flip_list: flips,
    tripped: tripIdx >= 0, first_trip_at: tripIdx >= 0 ? steps[tripIdx].f : null, monotone: flips.length === 1,
    stays_out: staysOut, trip_at_last: tripIdx >= 0 && tripIdx === seq.length - 1 };
}

/** one sweep of every pair on a fresh tape → { pairs: [...], sequences: { ncd, walk } } */
export async function sweepSet({ pairs, steps, tape, repoRoot = DATA_ROOT, kill = KILL_PCT, log = () => {} }) {
  try { rmSync(tape, { force: true }); } catch { /* */ }
  const out = [];
  for (const [fromKey, toKey] of pairs) {
    const t0 = Date.now();
    const s = await blendSweep({ fromKey, toKey, steps, tape, walk: true, repoRoot, kill });
    const rows = s.rows.map((r) => ({
      f: r.f, words: r.words,
      below_floor: !!r.below_floor,
      ncd: r.state === 'FILLED' ? { verdict: r.verdict, dI: r.dI, dN: r.dN, drift: r.drift } : r.state === 'BELOW_FLOOR' ? { verdict: 'BELOW_FLOOR', reason: r.reason || null, padded: !!r.padded, gate_raw: r.gate_raw || null } : { verdict: r.state, reason: r.reason || null },
      walk: r.walk ? { state: r.walk.state, offPct: r.walk.offPct, tooMany: r.walk.tooMany, tier: r.walk.tier, region: r.walk.region ?? null, reason: r.walk.reason, walkMode: r.walk.walkMode, stamp: r.walk.stamp ?? null, ms: r.walk.ms ?? null } : { state: 'UNMEASURED', offPct: null, tooMany: null, tier: 'UNMEASURED', reason: 'no walk ran', stamp: null },
    }));
    const pair = { from: s.from.key, to: s.to.key, from_label: s.from.label, to_label: s.to.label, steps: rows, floor: s.floor, instruments: { ncd: instrumentSummary(rows, ncdVerdict), walk: instrumentSummary(rows, walkVerdict) }, ms: Date.now() - t0 };
    out.push(pair);
    log(pair);
  }
  const sequences = {};
  for (const k of ['ncd', 'walk']) { const seq = out.flatMap((p) => p.instruments[k].sequence); sequences[k] = { sha256: sha256(seq.join('\n')), length: seq.length }; }
  return { pairs: out, sequences };
}

/** k of n pairs trip once at a fixed fraction, reruns identical — the after-shipping number, one line per instrument */
export function afterShippingLine(instrument, runs) {
  const n = runs[0].pairs.length;
  let trip = 0, once = 0, fixed = 0;
  for (let i = 0; i < n; i++) {
    const per = runs.map((r) => r.pairs[i].instruments[instrument]);
    const tripped = per[0].tripped;
    if (tripped) trip++;
    if (tripped && per[0].monotone) once++;   // exactly one flip in the whole sequence: it left the lane once and stayed out
    if (tripped && per.every((p) => p.first_trip_at === per[0].first_trip_at)) fixed++;
  }
  const identical = runs.every((r) => r.sequences[instrument].sha256 === runs[0].sequences[instrument].sha256);
  let k = 0;
  for (let i = 0; i < n; i++) { const per = runs.map((r) => r.pairs[i].instruments[instrument]); if (per[0].tripped && per[0].monotone && per.every((p) => p.first_trip_at === per[0].first_trip_at)) k++; }
  // C1392: beside k of n, the second count — never returns to IN_LANE after the first trip, on every run
  let staysOut = 0, lastOnly = 0;
  for (let i = 0; i < n; i++) { const per = runs.map((r) => r.pairs[i].instruments[instrument]); if (per.every((p) => p.tripped && p.stays_out)) { staysOut++; if (per[0].trip_at_last) lastOnly++; } }
  // C1393 (g): the abstention clause prints only when a refusal actually followed a trip in this run — never cited when none occurred
  const refusedAfterTrip = runs.some((r) => r.pairs.some((p) => { const q = p.instruments[instrument]; const i = q.sequence.indexOf(TRIP); return i >= 0 && q.sequence.slice(i).some((v) => REFUSALS.has(v)); }));
  const abstain = instrument === 'ncd' ? 'a later UNPLACEABLE or BELOW_FLOOR is the gate declining to place' : 'a later UNMEASURED is the walk refusing to grade';
  const clauses = [refusedAfterTrip ? `${abstain}: an abstention, counted as staying out, never as a return` : null, lastOnly ? `${lastOnly} of those trip only at the last step, where no later step exists to return` : null].filter(Boolean);
  const second = `${staysOut} of ${n} never return to IN_LANE after the first trip${clauses.length ? ` (${clauses.join('; ')})` : ''}`;
  return { instrument, n, trip, once, fixed, k, identical, stays_out: staysOut, trip_only_at_last: lastOnly, second,
    line: `${instrument}: ${k} of ${n} pairs trip once at a fixed fraction, reruns ${identical ? 'identical' : 'DIFFER'} (n = ${n}; ${trip} of ${n} reach OFF_DOMAIN, ${once} of ${n} of those flip exactly once, ${fixed} of ${n} trip at the same fraction on every run)` };
}

export async function attestSweep({ pairs = defaultPairs(), steps = 11, runs = 2, outDir = resolve(process.cwd(), '.thetacog/attest-sweep'), repoRoot = DATA_ROOT, kill = KILL_PCT, quiet = false } = {}) {
  for (const [a, b] of pairs) for (const k of [a, b]) if (!resolveScenario(k)) throw new Error(`unknown scenario ${k} — known: ${KNOWN_KEYS().join(', ')}`);
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const say = quiet ? () => {} : (s) => console.log(s);
  const all = [];
  // C1392: what the run answers, then what it costs, then what every column means — before any number
  say(SUFFICIENCY_LINE);
  say(runtimeLine({ pairs: pairs.length, steps, runs }));
  say('');
  for (const l of columnLines(kill)) say(l);
  for (let run = 1; run <= runs; run++) {
    say(`\nRUN ${run}/${runs} — ${pairs.length} pair${pairs.length === 1 ? '' : 's'} × ${steps} steps · intent and negative fixed per pair · kill ${kill}% · data root ${repoRoot}`);
    let idx = 0;
    const res = await sweepSet({ pairs, steps, tape: join(outDir, `tape-run${run}.json`), repoRoot, kill, log: (p) => {
      idx++;
      if (run !== 1 || quiet) return;
      say(`\nPAIR ${idx}/${pairs.length}  ${p.from} → ${p.to}   (intent scenario → declared negative: ${p.to_label})`);
      const fl = p.floor || {};
      const nBelow = (fl.below || []).filter(Boolean).length;
      if (fl.pair_refused) say(`   PAIR REFUSED  UNMEASURED: ${fl.reason || 'below floor'} — the intent or the negative is under the walk entry's floor, so no step of this pair is a reading on either instrument`);
      else if (nBelow) say(`   FLOOR  UNMEASURED on ${nBelow} of ${(fl.below || []).length} steps (${p.steps.filter((x) => x.below_floor).map((x) => x.f.toFixed(2)).join(', ')}): a text under the walk entry's floor of ${fl.floor?.chars ?? 320} chars / ${fl.floor?.gz_bytes ?? 220} gz bytes; the walk reads UNMEASURED and the gate BELOW_FLOOR there, never a trip`);
      else say(`   FLOOR  every text at mass: the walk entry admitted all ${(fl.below || []).length} steps (≥ ${fl.floor?.chars ?? 320} chars and ≥ ${fl.floor?.gz_bytes ?? 220} gz bytes each, one crate call)${fl.stamp ? ` · stamp apertureVersion ${fl.stamp.apertureVersion} · reef_sha ${fl.stamp.reef_sha} · axes_sha ${fl.stamp.axes_sha}` : ''}`);
      say(`   f     words  gzip-NCD            dI      dN     | walk         off%   tooMany  tier`);
      for (const s of p.steps) say(`   ${s.f.toFixed(2)}  ${String(s.words).padStart(5)}  ${gateCell(s.ncd).padEnd(19)} ${s.ncd.dI != null ? s.ncd.dI.toFixed(4) : '  —   '}  ${s.ncd.dN != null ? s.ncd.dN.toFixed(4) : '  —   '} | ${String(s.walk.state).padEnd(12)} ${(s.walk.offPct != null ? s.walk.offPct + ' %' : '—').padStart(5)}  ${String(s.walk.tooMany ?? '—').padEnd(7)}  ${s.walk.tier}${tierInputs(s.walk) ? `  (${tierInputs(s.walk)})` : ''}${driftNote(s.ncd)}${s.walk.reason ? '  · ' + s.walk.reason + litNote(s.walk.reason) : ''}`);
      const I = p.instruments;
      const one = (k, name) => `${name} flips ${I[k].flips}${I[k].first_flip_at != null ? ` (first at ${I[k].first_flip_at})` : ''} · trip ${I[k].tripped ? `at ${I[k].first_trip_at}` : 'none'} · first → last state ${I[k].start} → ${I[k].end}`;
      say(`   ${one('ncd', 'gzip-NCD')}   |   ${one('walk', 'walk')}   [${p.ms} ms]`);
      say(`   ENDPOINT  ${endpointSentence(p)}`);
    } });
    all.push(res);
    if (run !== 1 && !quiet) say(`   (run ${run}'s per-pair tables are not printed: its verdict sequences are compared with run 1's by sha in the RERUN line below)`);
  }
  const equal = {}; for (const k of ['ncd', 'walk']) equal[k] = all.every((r) => r.sequences[k].sha256 === all[0].sequences[k].sha256);
  const after = { ncd: afterShippingLine('ncd', all), walk: afterShippingLine('walk', all) };
  const engine = { engine: walkEngine({ ...DOOR_STATS, enabled: doorCrateEnabled() }), enabled: doorCrateEnabled(), requests: { ...DOOR_STATS.requests }, fallbacks: { ...DOOR_STATS.fallbacks }, declined: { ...DOOR_STATS.declined } };
  const record = {
    door: 'attest-sweep', row: 'C1386', floor_row: 'C1393', ts: new Date().toISOString(), data_root: repoRoot, cwd: process.cwd(), kill, steps, runs, n_pairs: pairs.length,
    instruments: INSTRUMENTS, pairs: all[0].pairs, reruns: all.slice(1).map((r) => ({ pairs: r.pairs.map((p) => ({ from: p.from, to: p.to, instruments: p.instruments, ms: p.ms })), sequences: r.sequences })),
    pairs_ms: all.map((r) => r.pairs.reduce((a, p) => a + p.ms, 0)),   // C1393: the pairs' own walking time per run (elapsed_ms also holds queueing on a shared door)
    sequences: Object.fromEntries(['ncd', 'walk'].map((k) => [k, { runs: all.map((r) => r.sequences[k].sha256), equal: equal[k], length: all[0].sequences[k].length }])),
    after_shipping: { ncd: after.ncd.line, walk: after.walk.line, counts: { ncd: after.ncd, walk: after.walk } },
    engine, elapsed_ms: Date.now() - t0, walk_steps: all.reduce((a, r) => a + r.pairs.reduce((b, p) => b + p.steps.length, 0), 0),
    endpoints: all[0].pairs.map(endpointSentence),
    // C1393: how many steps the crate's floor refused, and how many pairs it refused whole — both refusals on both instruments
    floor_counts: { below_floor_steps: all[0].pairs.reduce((a, p) => a + p.steps.filter((s) => s.below_floor).length, 0), pairs_refused: all[0].pairs.filter((p) => p.floor?.pair_refused).length, pairs_partly_below: all[0].pairs.filter((p) => !p.floor?.pair_refused && p.steps.some((s) => s.below_floor)).length },
    platform: { os: process.platform, arch: process.arch, prebuilt: 'macOS arm64 only (postinstall.js)', cross_platform_sha: 'UNMEASURED' },
  };
  const ends = all[0].pairs.map((p) => { const e = p.steps[p.steps.length - 1]; return e.walk.state === e.ncd.verdict ? 'agree' : (REFUSALS.has(e.walk.state) || REFUSALS.has(e.ncd.verdict)) ? 'abstain' : 'disagree'; });
  const nOf = (v) => ends.filter((x) => x === v).length;
  say(`\nENDPOINTS  at the last step the two instruments agree on ${nOf('agree')} of ${ends.length} pairs, disagree on ${nOf('disagree')}, one abstains on ${nOf('abstain')}; each pair's ENDPOINT sentence is printed under its table`);
  say(`RERUN  (${runs} run${runs === 1 ? '' : 's'} on this box; each token is the sha256 of that run's verdict sequence, first 16 hex) gzip-NCD ${all.map((r) => r.sequences.ncd.sha256.slice(0, 16)).join(' / ')} equal=${equal.ncd ? 'yes' : 'NO'}  ·  walk ${all.map((r) => r.sequences.walk.sha256.slice(0, 16)).join(' / ')} equal=${equal.walk ? 'yes' : 'NO'}`);
  say(`AFTER SHIPPING  ${after.ncd.line.replace(/^ncd:/, 'gzip-NCD:')} · ${after.ncd.second}`);
  say(`AFTER SHIPPING  ${after.walk.line} · ${after.walk.second}`);
  record.steps_per_s = +(record.walk_steps / Math.max(0.001, record.elapsed_ms / 1000)).toFixed(2);
  say(`ENGINE  ${engine.engine} · crate requests ${JSON.stringify(engine.requests)} · fallbacks ${JSON.stringify(engine.fallbacks)} · declined ${JSON.stringify(engine.declined)} · measured ${record.elapsed_ms} ms for ${record.walk_steps} steps (${record.steps_per_s} steps/s, both instruments each step; the pairs' own time ${record.pairs_ms.join(' + ')} ms = ${(record.walk_steps / Math.max(0.001, record.pairs_ms.reduce((a, x) => a + x, 0) / 1000)).toFixed(2)} steps/s)`);
  say(platformLine(engine.engine));
  return record;
}

// realpath both sides: argv[1] under a symlinked tmpdir (/var/folders → /private/var) is not import.meta.url's canonical path, and a door
// that silently does nothing and exits 0 is the one output this instrument may never produce
const same = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
const isMain = !!process.argv[1] && same(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  const pairArgs = []; for (let i = 0; i < argv.length; i++) if (argv[i] === '--pair' && argv[i + 1]) pairArgs.push(argv[i + 1].split(',').map((s) => s.trim()));
  const pairs = pairArgs.length ? pairArgs : defaultPairs();
  const jsonPath = flag('--json', null);
  attestSweep({ pairs, steps: Number(flag('--steps', 11)), runs: Number(flag('--runs', 2)), outDir: flag('--out-dir', resolve(process.cwd(), '.thetacog/attest-sweep')), quiet: argv.includes('--quiet') })
    .then((rec) => { if (jsonPath) { mkdirSync(dirname(resolve(jsonPath)), { recursive: true }); writeFileSync(resolve(jsonPath), JSON.stringify(rec, null, 2) + '\n'); console.log(`JSON  ${resolve(jsonPath)}`); } process.exit(0); })
    .catch((e) => { console.error(e.stack || e.message); process.exit(3); });
}
