#!/usr/bin/env node
// scripts/vna/cog-turns.mjs — C119 COMPLEXITY PER HUMAN %, PER TURN: THE OPTIMISATION TARGET THAT MUST PREDICT TOKEN COST.
//
// Operator 2026-09-20, verbatim: "the output must imply complexity per human % in the first glance its an optimisation target
// for us that must predict token costs.. if its 99th percentile it predicts 1) high salary ie 1 percentile salary, and
// complicated turns and repeated .. if it does not we log the discrepency and learn from it later.. could be we are dealing
// with things that are over the 100th percentile complexity (nonsensical, but it may be we score it to be above what a human
// can decompose) either way refining our stance on that helps.. we need a graph there for the recent turns for complexity
// and mass per token, and per hour - we wont compare it to a particular salary or actual dollars, but its an early warning
// signal that trouble may be ahead if it reads high and not enough precautions".
//
// THE STANCE, consolidated (the decisions on tokens per cog this row settles; every earlier row it leans on is named):
//   1. THE RULER IS THE CHAIR'S MINTED COGS (C113e) — the commits a human made here, minted with a red witness (C93a). A
//      turn's complexity is its own walk (the one Rust pipeline's cells · trajectory · σ · gzip mass, never a noun count)
//      pushed through the PREDICT weights (C93f, data/vna/cog-weights.json predict.v) and ranked on that ruler. Mid-rank,
//      ties count half. UNMEASURED below the floor (30 chair rows), the floor named on the line.
//   2. p100+ IS A READING, NOT NONSENSE. A predicted cog above every chair row means no human commit on this record
//      decomposed that much at once. It is shown as `p100+ ×k` (k = predicted / the chair maximum) — and the stance is:
//      SPLIT IT BEFORE YOU SPEND (the delegate-to-subtasks rule). Above the ruler the prediction is unfalsifiable until a
//      chair row lands there; the row that lands moves the ruler, the reading is re-ranked, nothing is retyped.
//   3. THE PREDICTION IS SCORED AGAINST THE SPEND, AND A MISS IS LOGGED, NEVER SMOOTHED. The realised side is the turn's
//      own usage rows (C93b spend.mjs — the four usage fields, never bytes), ranked among the session's turns. gap = predicted
//      percentile − realised percentile. |gap| ≥ GAP_LOG is a discrepancy row in data/vna/cog-discrepancy.ndjson, appended
//      once per (session, turn) and only once the turn is CLOSED (a later turn opened — the live turn is still spending),
//      carrying both readings and their receipts, with `lesson: null` — learned from later (C93e's calibration reads it),
//      never at paint time.
//   4. NEVER A SALARY, NEVER A DOLLAR. The percentile implies the class of work (a p99 turn is the kind a p99 human does);
//      the labour pin (C93j) is the only place a rate lives, and it is declared, not read. This module names no currency.
//   3b. THE TWO MEASURES, AND HOW TO THINK OF THEM (operator 2026-09-20: "we need the right token / percentile or percentile /
//      tokens (what is the right way to think of it?) we need both measures, not turns before token mass"): the percentile is a
//      RANK (ordinal — it says which size class of human work this is); tokens are a MASS (cardinal). A rank divided by a mass is
//      not a number, so neither "token/percentile" nor "percentile/tokens" is the measure. The two measures are: (a) the
//      PERCENTILE — how hard, on the chair ruler; (b) TOKENS PER COG — what it cost per unit of work, read against the PEG of
//      its band (C93c, the floor that only falls). Cogs per M tokens is the same measure inverted (yield), so it is not a
//      third number. The discrepancy is therefore tok/cog against the peg (peg_ratio = tok/cog ÷ peg), not a rank against a
//      rank: a turn that predicts p41 and spends 5.6× its band's peg is the miss; a rank-of-spend among the session's turns
//      stays in the hover as a secondary reading. COST PER YIELD (the operator's paste, 2026-09-20): tokens are the spend,
//      the percentile is the yield — a low token count on a p05 task is nothing; the pitch is a hard task at a bounded peg. So
//      the face reads the spend BEFORE the yield — `<tok/cog> tok/cog at p<NN> complexity` — and the word "turn" never
//      appears on the cog card (turns are the runner's duration; they belong on the AUTONOMOUS RUNNER card). The live ask is
//      "this ask". Chair-vs-runner percentiles stay in the drawer.
//   3c. THE COG IS THE UNIT (the operator's paste, 2026-09-21, "maybe closer"): a cog has two properties that are never divided into
//      one number on the face — the YIELD (its complexity rank on the chair ruler) and the MASS (the tokens it cost). Tokens per cog
//      is gasoline-per-mile: a diagnostic, kept in the hover and the peg, never the headline noun. The face reads
//      `<n> cogs minted · this ask p<NN> complexity · <tok> tokens (<k>× peg <band>)`; the drawer's rows read `a<N>: p<NN> · <tok> tok
//      (<k>× peg <band>) ⚑`; the ruler line reads `chair baseline: <n> cogs (floor <f>)`. A p40 ask at 22× its band's peg is the
//      anomaly the developer must see at once — thrashing, not 22× the work. Never an hour, never a salary, never a dollar.
//   5. THE EARLY WARNING IS TWO SIGNS, BOTH READ: complexity HIGH (median percentile over the recent window ≥ WARN_PCT) and
//      spend RISING (tokens per hour over the last three turns ≥ WARN_RATE × the session's median). Both → ⚠ with the three
//      precautions named (claim the paths · split the ask · commit small). One → the sign that is up. Neither → ◦ quiet.
//
// @guard tests/vna/c119-complexity-per-human.test.mjs
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { tailRowsSince } from './walk-tape-read.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockOf, chebyshevRadius, polarSeparation, bandOf } from './cog.mjs';
import { percentileOf, runnerShas, isRunnerSha, FLOOR } from './cog-percentile.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DISCREPANCY_NDJSON = process.env.VNA_COG_DISCREPANCY || resolve(REPO, 'data/vna/cog-discrepancy.ndjson');
// C119l — every CLOSED ask's row is retained on its own ledger (append-once per session:turn), so the graph after a /clear is the last
// RECENT asks of the RECORD, not the one ask of a fresh transcript: a fresh session drew one bar and no line while its numbers moved
// (operator: "the numbers change but the graph is flat"), because the series was read off the session's transcript alone.
export const TURNS_NDJSON = process.env.VNA_COG_TURNS || resolve(REPO, 'data/vna/cog-turns.ndjson');
export const GAP_LOG = 34;      // secondary: a third of the ruler between the predicted rank and the spend rank (hover only)
export const RATIO_LOG = 4;     // primary: tokens per cog ≥ 4× or ≤ ¼ of the band's peg is a discrepancy — the peg is the floor that only falls, so ≤ ¼ means the peg should move
export const WARN_PCT = 75;     // the recent window's median complexity at or above this reads HIGH
export const WARN_RATE = 1.5;   // the last three turns' tokens/hour at or above this × the session median reads RISING
export const RECENT = 24;       // turns on the graph
export const WINDOW = 6;        // turns the warning's median reads over
const nd = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const T = (s) => (s ? Date.parse(s) || 0 : 0);
const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const r2 = (x) => Math.round(x * 100) / 100;

/** the steer rows of one session on the walk tape — the prompt walks (`prompt`) and the pastes amended onto them (`amend:<row>`) */
export function sessionWalks(tapeRows = [], session) {
  return tapeRows.filter((r) => r && r.session === session && r.source === 'steer' && (r.ref === 'prompt' || /^amend:\d+$/.test(String(r.ref))));
}

/** one walk row → the predict inputs C93f reads off a spec row's walk, here off the turn's own (cells · trajectory · σ · gzip) */
export function predictInputs(row) {
  const cells = Array.isArray(row.cells) ? row.cells : [];
  const traj = Array.isArray(row.trajectory) ? row.trajectory : [];
  const counts = {}; for (const c of traj) counts[c] = (counts[c] || 0) + 1;
  const depth = traj.length ? Math.round((Math.max(...Object.values(counts)) / traj.length) * 100) / 100 : 0;
  const gzip = (row.intentSpan && Number(row.intentSpan.gzip)) || 0;
  return { cells: cells.length, blocks: new Set(cells.map(blockOf)).size, radius: cells.length ? chebyshevRadius(cells) : 0, polar: cells.length ? polarSeparation(cells).polar : 0, depth, lca_depth: 0, ncd_cross: 0, gzip_kb: r2(gzip / 1024), terms_unresolved: 0, sigma: Number(row.sigma) || 0, gzip };
}
export function predictCog(inputs, weights) {
  const pw = (weights && weights.predict && weights.predict.weights) || {};
  return Math.round(Object.entries(pw).reduce((a, [k, v]) => a + v * (Number(inputs[k]) || 0), 0) * 1000) / 1000;
}

/** the peg of a band off data/vna/cog-peg.json (a legacy peg is a peg, stamped) — null when the band has none */
export function pegOf(band, peg) { const b = peg && peg.bands && peg.bands[band]; return b && Number.isFinite(b.peg) ? { peg: b.peg, legacy: !!b.legacy, sha: b.sha } : null; }
export const pegRatio = (tokPerCog, pg) => (tokPerCog != null && pg && pg.peg > 0 ? Math.round((tokPerCog / pg.peg) * 100) / 100 : null);

/** the chair ruler: every minted chair cog, sorted; the runner's rows are ranked on it and never join it (C113e) */
export function chairRuler({ cogRows = [], runnerRows = [] } = {}) {
  const rs = runnerShas(runnerRows);
  const human = cogRows.filter((r) => r && r.minted && Number.isFinite(r.cog) && !isRunnerSha(r.sha, rs)).map((r) => r.cog).sort((a, b) => a - b);
  return { human, n: human.length, max: human.length ? human[human.length - 1] : null, floor: FLOOR };
}
/** the percentile with the over-the-ruler reading: { pct, over } — over = predicted / chair max when the cog exceeds every chair row */
export function rankOnRuler(cog, ruler) {
  if (!ruler || ruler.n < ruler.floor || !Number.isFinite(cog)) return { pct: null, over: null };
  const pct = percentileOf(cog, ruler.human);
  const over = ruler.max > 0 && cog > ruler.max ? r2(cog / ruler.max) : null;
  return { pct, over };
}
export const pctLabel = (r) => (r == null || r.pct == null ? 'p—' : r.over != null ? `p100+ ×${r.over}` : `p${r.pct}`);

/**
 * the turns: every transcript turn with calls (a zero-call row is a mid-turn message — its walk folds into the turn that answered it),
 * each with the walks in its window, the predicted complexity (the heaviest walk in the window), its rank on the chair ruler,
 * the realised spend, its rank among the session's turns, mass per token, tokens per hour, and the gap.
 */
export function turnComplexity({ turns = [], tapeRows = [], cogRows = [], runnerRows = [], weights = null, peg = null, session = null, recent = RECENT } = {}) {
  if (!weights || !weights.predict) return { status: 'UNMEASURED', why: 'no predict weights (data/vna/cog-weights.json predict)' };
  const ruler = chairRuler({ cogRows, runnerRows });
  const walks = sessionWalks(tapeRows, session);
  const withCalls = turns.filter((t) => t && t.calls > 0);
  if (!withCalls.length) return { status: 'UNMEASURED', why: 'no transcript turn with usage rows yet', ruler };
  const rows = []; let prevEnd = 0;
  for (const t of withCalls) {
    const t0 = T(t.t0), t1 = T(t.t1) || t0;
    const lo = Math.max(prevEnd, t0 - 5 * 60 * 1000), hi = t1;   // the window: after the previous answered turn, within five minutes before this prompt
    const inWin = walks.filter((w) => { const ts = T(w.ts); return ts >= lo && ts <= hi; });
    const preds = inWin.map((w) => { const inputs = predictInputs(w); return { ref: w.ref, ts: w.ts, sha: w.text_sha, inputs, predicted: predictCog(inputs, weights) }; });
    const heaviest = preds.slice().sort((a, b) => b.predicted - a.predicted)[0] || null;
    const tokens = (t.input || 0) + (t.cache_create || 0) + (t.cache_read || 0) + (t.output || 0);
    const mass = preds.reduce((a, p) => a + p.inputs.gzip, 0);
    const hours = Math.max((t1 - t0) / 3.6e6, 1 / 60);   // a turn answered inside a minute is one minute — never a division by zero
    const rank = heaviest ? rankOnRuler(heaviest.predicted, ruler) : { pct: null, over: null };
    const band = heaviest ? bandOf(heaviest.predicted, weights) : null; const pg = band ? pegOf(band, peg) : null; const tok_per_cog = heaviest && heaviest.predicted > 0 && tokens > 0 ? Math.round(tokens / heaviest.predicted) : null;
    rows.push({ n: t.n, at: t.t0, calls: t.calls, tokens, output: t.output || 0, walks: preds.length, predicted: heaviest ? heaviest.predicted : null, band, tok_per_cog, peg: pg ? pg.peg : null, peg_legacy: pg ? pg.legacy : null, peg_ratio: pegRatio(tok_per_cog, pg), inputs: heaviest ? heaviest.inputs : null, ref: heaviest ? heaviest.ref : null, ...rank, mass, mass_per_ktok: tokens > 0 ? r2(mass / (tokens / 1000)) : null, tok_per_hour: Math.round(tokens / hours), hours: r2(hours) });
    prevEnd = t1;
  }
  const toks = rows.map((r) => r.tokens).sort((a, b) => a - b);
  for (const r of rows) { r.realized_pct = rows.length >= 3 ? percentileOf(r.tokens, toks) : null; r.gap = r.pct != null && r.realized_pct != null ? r.pct - r.realized_pct : null; r.rank_gap = r.gap != null && Math.abs(r.gap) >= GAP_LOG; r.discrepancy = r.peg_ratio != null && (r.peg_ratio >= RATIO_LOG || r.peg_ratio <= 1 / RATIO_LOG); r.live = r === rows[rows.length - 1]; r.logged = r.discrepancy && !r.live; }
  const latest = rows[rows.length - 1];
  const win = rows.slice(-WINDOW), last3 = rows.slice(-3);
  const medPct = med(win.map((r) => (r.over != null ? 100 : r.pct)).filter((x) => x != null));
  const medRate = med(rows.map((r) => r.tok_per_hour)), recentRate = med(last3.map((r) => r.tok_per_hour));
  const rateRatio = medRate > 0 && recentRate != null ? r2(recentRate / medRate) : null;
  const high = medPct != null && medPct >= WARN_PCT, rising = rateRatio != null && rateRatio >= WARN_RATE && rows.length >= 4;
  const warning = { level: high && rising ? 'WARN' : high || rising ? 'SIGN' : ruler.n < ruler.floor ? 'UNMEASURED' : 'QUIET', high, rising, median_pct: medPct, rate_ratio: rateRatio, window: win.length, precautions: ['claim the paths (node scripts/ops/wip.mjs claim)', 'split the ask — one commit per subtask', 'commit small, fast'] };
  return { status: 'measured', session, ruler: { n: ruler.n, max: ruler.max, floor: ruler.floor }, rows: rows.slice(-recent), n_turns: rows.length, latest, warning, discrepancies: rows.filter((r) => r.logged).length, predict_v: weights.predict.v, gap_log: GAP_LOG, ratio_log: RATIO_LOG };
}

/** the discrepancy rows not yet on the log — one per (session, turn); the log is append-only and the key is the dedupe */
export function newDiscrepancies(reading, logRows = []) {
  if (!reading || reading.status !== 'measured') return [];
  const seen = new Set(logRows.map((r) => `${r.session}:${r.turn}`));
  const live = reading.latest ? reading.latest.n : null;   // the last turn is still spending — its gap is not a reading until the next turn opens
  return reading.rows.filter((r) => r.logged && r.n !== live && !seen.has(`${reading.session}:${r.n}`)).map((r) => ({ at: new Date().toISOString(), session: reading.session, turn: r.n, turn_at: r.at, predicted: r.predicted, predicted_pct: r.over != null ? 100 : r.pct, over: r.over, band: r.band, realized_tokens: r.tokens, tok_per_cog: r.tok_per_cog, peg: r.peg, peg_legacy: r.peg_legacy, peg_ratio: r.peg_ratio, realized_pct: r.realized_pct, gap: r.gap, calls: r.calls, tok_per_hour: r.tok_per_hour, mass: r.mass, inputs: r.inputs, ref: r.ref, ruler_n: reading.ruler.n, predict_v: reading.predict_v, lesson: null, source: 'the turn\'s own walk (walk-tape steer rows) through the predict weights; tokens per cog against the band\'s peg (data/vna/cog-peg.json); the usage rows (spend.mjs)' }));
}
/** the closed rows of this reading not yet on the turns ledger — one per (session, turn); the live row is never written (it is still spending) */
export function newTurnRows(reading, ledger = []) {
  if (!reading || reading.status !== 'measured') return [];
  const seen = new Set(ledger.map((r) => `${r.session}:${r.turn}`));
  return reading.rows.filter((r) => !r.live && !r.carried && !seen.has(`${reading.session}:${r.n}`)).map((r) => ({ at: r.at, session: reading.session, turn: r.n, pct: r.pct, over: r.over, predicted: r.predicted, band: r.band, tokens: r.tokens, tok_per_cog: r.tok_per_cog, peg: r.peg, peg_legacy: r.peg_legacy, peg_ratio: r.peg_ratio, realized_pct: r.realized_pct, gap: r.gap, calls: r.calls, tok_per_hour: r.tok_per_hour, hours: r.hours, mass: r.mass, mass_per_ktok: r.mass_per_ktok, walks: r.walks, inputs: r.inputs, ref: r.ref, discrepancy: !!r.discrepancy, ruler_n: reading.ruler.n, predict_v: reading.predict_v }));
}
export function logTurns({ reading, path = TURNS_NDJSON } = {}) {
  const rows = newTurnRows(reading, nd(path));
  if (rows.length) appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { appended: rows.length, path };
}
/** the ledger's rows that are not this reading's own, oldest first, as graph rows (`carried: true`, `n` = `a<turn>` of its session) */
export function carriedRows(reading, ledger = [], recent = RECENT) {
  const own = new Set((reading && reading.rows ? reading.rows : []).map((r) => `${reading.session}:${r.n}`));
  const need = Math.max(0, recent - (reading && reading.rows ? reading.rows.length : 0));
  if (!need) return [];
  return ledger.filter((r) => r && r.at && !own.has(`${r.session}:${r.turn}`)).sort((a, b) => T(a.at) - T(b.at)).slice(-need).map((r) => ({ ...r, n: r.turn, session: r.session, live: false, logged: !!r.discrepancy, carried: true }));
}
export function logDiscrepancies({ reading, path = DISCREPANCY_NDJSON } = {}) {
  const rows = newDiscrepancies(reading, nd(path));
  if (rows.length) appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { appended: rows.length, path };
}

/** the one line for the face: `complexity p<NN> of human work · turn p<NN> [↑|↓ gap] · …` — the percentile first, always */
export const fmtTokC = (n) => (n == null || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(Math.round(n)));
/** `<tok> tokens (<k>× peg <band>[ legacy])` — the MASS with its peg ratio; tok/cog itself stays a hover diagnostic (C119c) */
export const pegTag = (r) => (r && r.peg_ratio != null ? ` (${Math.round(r.peg_ratio) >= 10 ? Math.round(r.peg_ratio) : r.peg_ratio}× peg${r.band ? ` ${r.band}` : ''}${r.peg_legacy ? ' legacy' : ''})` : '');
export const massLabel = (r, word = 'tokens') => (r == null || r.tokens == null ? `${word} —` : `${fmtTokC(r.tokens)} ${word}${pegTag(r)}`);
export const tokPerCogLabel = (r) => (r == null || r.tok_per_cog == null ? 'tok/cog —' : `${fmtTokC(r.tok_per_cog)} tok/cog${r.peg_ratio != null ? pegTag(r) : ' (no peg)'}`);
// commitTok = { tok_per_cog, peg_ratio, band, peg_legacy } for the latest minted commit (its spend ÷ its cog against its band's peg)
// C119e (operator 2026-09-21: "the card must show percentile first because it predicts turns and drift"; the paste: Input (silicon)
// → Output (physics) → Value (human), fused on the face as a Yield vs Cost ledger entry): the face reads YIELD · SPEND · RATE — the
// percentile first, because it is the number that predicts turns and drift; the tokens second, the cost in machine mass; the peg
// ratio third, where the three units collapse into one alarm (22× the peg for p40 work = the machine thrashed). Tokens per cog is
// the BUTTON'S OWN LABEL (C119d, written out: "1.89 M tokens per cog"), never a face word. The cog count, the peg roster and Σw·x
// stay in the drawer — the proof of how the percentile was computed, one click behind the face.
// the paste's completion (operator 2026-09-21): button `⚙️ 1.2 M tokens / cog` (the exchange rate) · metrics `p26 complexity · 2.0 M tokens
// burned · 1.6 cogs minted · (6× peg l)` — the human rank, the mass, the yield that closes the division, the budget variance last
export const rateLabel = (r) => (r == null || r.peg_ratio == null ? '(no peg)' : `(${Math.round(r.peg_ratio) >= 10 ? Math.round(r.peg_ratio) : r.peg_ratio}× peg${r.band ? ` ${r.band}` : ''}${r.peg_legacy ? ' legacy' : ''})`);
export const cogsLabel = (c) => (c == null || !Number.isFinite(c) ? 'cogs —' : `${c >= 10 ? Math.round(c) : Math.round(c * 10) / 10} cog${c === 1 ? '' : 's'} minted`);
export const ledgerEntry = (r, who = '') => `${pctLabel(r)} complexity · ${fmtTokC(r.tokens)} tokens burned · ${cogsLabel(r.cog != null ? r.cog : r.predicted)} · ${rateLabel(r)}${who ? ` · ${who}` : ''}`;
/** the percentile's alarm class — the same bands as the graph's bars (WARN_PCT = warn, 90 = hi, over the ruler = over) */
export const pctClass = (r) => (r == null || r.pct == null ? 'un' : r.over != null ? 'over' : r.pct >= 90 ? 'hi' : r.pct >= WARN_PCT ? 'warn' : 'ok');
// C119f (operator 2026-09-21: "must show percentile even if last" · "percentile must be the first next you see - its critical to see
// right away, could also color it to alert the operator if the work gets very complex"): the FIRST token on the face is a percentile,
// always — the live ask's when its walk has landed, else the last ranked ask's of this record, else the last commit's; the source is
// named after the numbers, never before them. wrapPct(label, row) lets the panel colour it by pctClass; the text form is plain.
export function faceLead({ commitPct = null, commitTok = null, reading = null } = {}) {
  const R = reading && reading.status === 'measured' ? reading : null;
  const L = R && R.latest && R.latest.pct != null ? R.latest : null;
  if (L) return { row: L, who: `this ask${L.discrepancy ? (L.live ? ' (live)' : ' · logged') : ''}` };
  const prior = R ? R.rows.slice().reverse().find((r) => r.pct != null) : null;
  if (prior) return { row: prior, who: `last ranked ask a${prior.n}` };
  if (commitPct && commitPct.status === 'measured' && commitPct.latest && commitTok && commitTok.tokens != null) return { row: { pct: commitPct.latest.pct, over: null, ...commitTok }, who: 'last commit' };
  return null;
}
export function complexityFaceLine({ commitPct = null, commitTok = null, reading = null, wrapPct = (label) => label } = {}) {
  const entry = (r, who) => ledgerEntry(r, who).replace(pctLabel(r), wrapPct(pctLabel(r), r));
  const lead = faceLead({ commitPct, commitTok, reading });
  const commit = commitPct && commitPct.status === 'measured' && commitPct.latest
    ? (commitTok && commitTok.tokens != null ? `last commit ${ledgerEntry({ pct: commitPct.latest.pct, over: null, ...commitTok })}` : `last commit p${commitPct.latest.pct} complexity · tokens —`)
    : `last commit complexity UNMEASURED — ${(commitPct && commitPct.why) || 'no reading'}`;
  const askState = !reading || reading.status !== 'measured' || !reading.latest ? 'this ask UNMEASURED'
    : reading.latest.pct != null ? null
    : reading.ruler.n < reading.ruler.floor ? `this ask UNMEASURED (ruler ${reading.ruler.n} of ${reading.ruler.floor})` : 'this ask — (no walk in its window)';
  const w = reading && reading.status === 'measured' ? reading.warning : null; const sign = !w ? '' : w.level === 'WARN' ? ' · ⚠ high + rising' : w.level === 'SIGN' ? (w.high ? ' · ⚠ high' : ' · ⚠ rising') : '';
  if (!lead) return `${wrapPct('p—', null)} complexity · ${askState} · ${commit}`;
  const parts = [entry(lead.row, lead.who) + sign];
  if (askState) parts.push(askState);
  if (lead.who !== 'last commit') parts.push(commit);
  return parts.join(' · ');
}
/** the button's own label — tokens per cog written out (C119d), the live ask's when measured, else the last commit's */
export function tokensPerCogHead({ commitTok = null, reading = null } = {}) {
  const L0 = reading && reading.status === 'measured' && reading.latest && reading.latest.tok_per_cog != null ? reading.latest : null;
  const src = L0 || (commitTok && commitTok.tok_per_cog != null ? commitTok : null);
  return src ? `${fmtTokC(src.tok_per_cog)} tokens / cog` : 'Tokens per cog';
}
export function warningLine(reading) {
  if (!reading || reading.status !== 'measured') return `early warning UNMEASURED — ${(reading && reading.why) || 'no reading'}`;
  const w = reading.warning; const parts = [`complexity median ${w.median_pct == null ? '—' : `p${w.median_pct}`} over the last ${w.window} ask${w.window === 1 ? '' : 's'}`, `spend ${w.rate_ratio == null ? '—' : `${w.rate_ratio}×`} the session's median tokens/hour`];
  if (w.level === 'WARN') return `⚠ early warning · ${parts.join(' · ')} — precautions: ${w.precautions.join(' · ')}`;
  if (w.level === 'SIGN') return `⚠ ${w.high ? 'complexity high' : 'spend rising'} · ${parts.join(' · ')}`;
  if (w.level === 'UNMEASURED') return `early warning UNMEASURED · ruler ${reading.ruler.n} chair rows of ${reading.ruler.floor}`;
  return `◦ quiet · ${parts.join(' · ')}`;
}
export const STANCE = 'The cog is the unit, with two properties never divided into one number: the yield (its rank on the chair ruler) and the mass (the tokens it cost, read against its band\'s peg). p100+ is a reading, not nonsense: no human commit on this record decomposed that much at once — split it before you spend. An ask 4× off its peg is logged, never smoothed — thrashing, not 4× the work. Never an hour, never a salary, never a dollar.';

export function readTurnComplexity({ repo = REPO, turns = [], session = null, weights = null } = {}) {
  const w = weights || (() => { try { return JSON.parse(readFileSync(resolve(repo, 'data/vna/cog-weights.json'), 'utf8')); } catch { return null; } })();
  const pg = (() => { try { return JSON.parse(readFileSync(resolve(repo, 'data/vna/cog-peg.json'), 'utf8')); } catch { return null; } })();
  // C119g — the tape is read from its TAIL, bounded in bytes and stopped at the session's first answered turn (minus the five-minute
  // window): a whole-file read threw at Node's string ceiling on 2026-09-21 (547 MB tape) and every walk vanished into a caught [] —
  // the graph went flat while the tokens moved. tailRowsSince never builds one string of the file (scripts/vna/walk-tape-read.mjs).
  const withCalls = turns.filter((t) => t && t.calls > 0); const since = withCalls.length ? Math.min(...withCalls.map((t) => T(t.t0))) - 5 * 60 * 1000 : Date.now();
  const tape = (() => { try { return tailRowsSince(resolve(repo, '.thetacog/walk-tape.ndjson'), since, { filter: (r) => r && r.source === 'steer' && r.session === session }); } catch (e) { return { rows: [], bytesRead: 0, complete: false, why: String(e.message || e).slice(0, 80) }; } })();
  const r = turnComplexity({ turns, session, weights: w, peg: pg, tapeRows: tape.rows, cogRows: nd(resolve(repo, 'data/vna/cog.ndjson')), runnerRows: nd(resolve(repo, '.thetacog/runner.ndjson')) });
  if (r.status !== 'measured') return { ...r, tape: { bytes_read: tape.bytesRead, complete: tape.complete, walks: tape.rows.length, why: tape.why || null } };
  // C119l — the graph is the last RECENT asks of the record: the turns ledger's rows (earlier sessions, or this one before a /clear) ride in
  // front of this transcript's own; `carried: true` marks them, the warning and the discrepancies stay this session's
  const carried = carriedRows(r, nd(TURNS_NDJSON));
  return { ...r, rows: [...carried, ...r.rows], carried: carried.length, tape: { bytes_read: tape.bytesRead, complete: tape.complete, walks: tape.rows.length, why: tape.why || null } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { spendOf } = await import('./spend.mjs');
  const g = existsSync(resolve(REPO, '.thetacog/vna-clear-gauge.json')) ? JSON.parse(readFileSync(resolve(REPO, '.thetacog/vna-clear-gauge.json'), 'utf8')) : null;
  const tp = process.argv.find((a) => a.endsWith('.jsonl')) || (g && g.transcriptPath);
  const session = g && g.session;
  // --backfill [N]: log the closed rows of the N newest sibling transcripts (default 4) onto the turns ledger, oldest first — a one-off
  // that seeds C119l's ledger from the record; every later paint appends its own closed rows as they close
  if (process.argv.includes('--backfill')) {
    const { readdirSync, statSync } = await import('node:fs');
    const n = Number(process.argv[process.argv.indexOf('--backfill') + 1]) || 4; const dir = tp ? dirname(tp) : null;
    if (!dir) { console.log('no transcript dir — pass a .jsonl'); process.exit(2); }
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => resolve(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, n).reverse();
    for (const f of files) { const sid = f.split('/').pop().replace(/\.jsonl$/, ''); const rr = readTurnComplexity({ turns: spendOf(f).turns, session: sid }); const own = rr.status === 'measured' ? rr.rows.filter((x) => !x.carried) : []; const matched = own.some((x) => x.walks > 0);   // a transcript whose id matches no steer row on the tape is another room's, or the hook stamped a different session id — its asks are not this record's closed rows
      const out = rr.status === 'measured' && matched ? logTurns({ reading: { ...rr, rows: own.map((x) => (f === tp ? x : { ...x, live: false })) } }) : { appended: 0, why: rr.status === 'measured' ? 'no steer row on the tape carries this transcript\'s id — skipped' : rr.why }; console.log(`${sid.slice(0, 8)} · ${rr.status === 'measured' ? `${rr.n_turns} asks · tape ${Math.round((rr.tape.bytes_read || 0) / 1048576)} MB ${rr.tape.complete ? 'complete' : 'INCOMPLETE'}` : rr.why} · appended ${out.appended}${out.why ? ` · ${out.why}` : ''}`); }
    process.exit(0);
  }
  const r = readTurnComplexity({ turns: tp && existsSync(tp) ? spendOf(tp).turns : [], session });
  if (process.argv.includes('--log')) console.log(JSON.stringify(logDiscrepancies({ reading: r })));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else { console.log(complexityFaceLine({ reading: r })); console.log(warningLine(r)); if (r.rows) for (const x of r.rows) console.log(`a${x.n}: ${pctLabel(x)} · ${massLabel(x, 'tok')}${x.discrepancy ? ' ⚑' : ''}${x.live ? ' live' : ''} · cog ${x.predicted} · ${tokPerCogLabel(x)} · ${x.calls} calls · ${x.tok_per_hour} tok/h`); }
}
