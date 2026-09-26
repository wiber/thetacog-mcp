// scripts/vna/babysit.mjs — C93p THE BABYSITTING READING: the prediction scored against LANDING, never against the cog alone
// (operator 2026-09-19: "we still wanna price the babysitting complexity of how hard is this … a very interesting stat that should
// be in the dashboard because it's actually something that we can predict and refine and optimize our understanding of because it's
// also probably at least correlated with whether the agentic work lands").
//
// C93f predicts a row's cog from its OWN walk before the work; C93e fits those weights on the REALIZED cog. Neither asks the
// question the operator asked: did the row LAND, and how many times did someone have to come back to it first? This file answers
// it from three receipts and nothing else — data/vna/cog-predict.ndjson (the prediction, newest per label), data/vna/cog.ndjson
// (the commits that named or ticked the label, with route and realized cog), .thetacog/runner.ndjson (the halts on the label).
//   returns   = commits naming the label before the one that ticked it + runner halts on it — the times it was RETURNED TO.
//   landed    = a commit with the label in rows_ticked exists on the record.
//   ρ         = Spearman rank correlation of predicted cog against returns over rows with both — UNDERPOWERED below MIN_ROWS (the
//               same floor C93e and C14 use), printed WITH n and never as a verdict; ρ is a number only at or above the floor.
// THE LEGEND IS NOT PUBLISHED, IT IS ANSWERED: `--legend` prints the bands (cog-weights.json) beside the buyer's own rate
// (labour-rate.json, C93j) — PINNED with its cites or UNPINNED — so "an hour of a doctor's work is how many cogs" is answered
// from the account-holder's declaration when asked, and never appears on the card. LLM-free.
//   node scripts/vna/babysit.mjs [--json]        node scripts/vna/babysit.mjs --legend
import { readFileSync } from 'node:fs';
import { scanLines } from './ndjson-tail.mjs';   // flat-memory whole-file scan
import { directions } from './spec-tree.mjs';
import { readTreeJson } from './tree-once.mjs';   // the 54 MB tree parsed once per render, shared with steer-ui   // C98i: the directions on a row's leaf, graded or not
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(HERE, '..', '..');
export const MIN_ROWS = 30;
const ndRows = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
// the amendments ledger is ~400 MB of pastes: scan it at flat memory and keep only what windowReading reads (at, bytes)
const slimAmendRows = (p) => { const out = []; try { scanLines(p, (l) => { try { const r = JSON.parse(l); out.push({ at: r.at, bytes: r.bytes }); } catch {} }); } catch {} return out; };
const newestPer = (rows, key) => { const m = new Map(); for (const r of rows) m.set(r[key], r); return m; };

/** rank with ties averaged — the construct, not a sort index */
export function ranks(xs) { const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const out = new Array(xs.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) out[idx[k][1]] = r; i = j + 1; } return out; }
export function spearman(xs, ys) {
  const n = xs.length; if (n < 3 || ys.length !== n) return null;
  const rx = ranks(xs), ry = ranks(ys); const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  if (!dx || !dy) return null;   // a constant column has no rank order to correlate — null, never 0
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000;
}

/** one row's babysitting: the prediction, then what the record says happened to it */
/** the spec's own tick state — landed is read from the spec's checkbox first, the cog row second, so a ticked row whose commit is not yet minted is never printed open */
export function specTicks(md) { const open = new Set(), ticked = new Set(); for (const m of String(md || '').matchAll(/^\s*- \[( |x)\] (C\d+[a-z]?)\b/gm)) (m[1] === 'x' ? ticked : open).add(m[2]); return { open, ticked }; }
// C98i: how many intent/decision snippets on the row's leaf were UNGRADED at a moment — the direction had landed (at ≤ t) and no grade
// for its hash had (at ≤ t). Read off the tree's revisions; the grade rows are the record. No tree → null, never 0.
export function ungradedAt(treeNodes, label, t) {
  if (!treeNodes) return null; const id = `n_spec_${label}`; const n = treeNodes[id]; if (!n) return null;
  const D = directions({ nodes: treeNodes }, id).filter((d) => !t || String(d.at) <= String(t));
  const revs = n.revisions || [];
  return D.filter((d) => !revs.some((g) => g.kind === 'grade' && g.hash === d.hash && (!t || String(g.at) <= String(t)))).length;
}
export function babysitRow({ label, predictions, cogRows, runnerRows, ticks = null, treeNodes = null }) {
  const p = predictions.get(label); if (!p) return { label, status: 'UNMEASURED', why: 'no prediction on the record — node scripts/vna/cog.mjs --predict ' + label };
  const naming = cogRows.filter((r) => (r.labels_named || []).includes(label) || (r.rows_ticked || []).includes(label)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const tick = naming.find((r) => (r.rows_ticked || []).includes(label)) || null;
  const before = tick ? naming.filter((r) => String(r.at) < String(tick.at)) : naming;
  const halts = runnerRows.filter((r) => r.kind === 'halt' && r.label === label).length;
  const route = tick ? (runnerRows.some((r) => r.kind === 'verdict' && r.work && String(tick.sha).startsWith(String(r.work).slice(0, 10))) ? 'runner' : 'chair') : null;
  const tickedInSpec = ticks ? ticks.ticked.has(label) : null; const landed = !!tick || tickedInSpec === true; const open = ticks ? ticks.open.has(label) : !tick;
  const ungradedTick = tick ? ungradedAt(treeNodes, label, tick.at) : null; const ungradedNow = ungradedAt(treeNodes, label, null);
  return { label, status: 'measured', predicted: p.predicted, band: p.band, shape: p.shape, landed, open, minted: !!tick, tick_sha: tick ? tick.sha.slice(0, 10) : null, route, realized: tick ? tick.cog : null, attempts: before.length, halts, returns: before.length + halts,
    ungraded_at_tick: ungradedTick, ungraded_now: ungradedNow, note: ungradedTick ? 'built over an ungraded direction' : null };   // C98i: a reading, never a block
}

export function babysitReading({ repo = REPO, predictRows = ndRows(resolve(repo, 'data/vna/cog-predict.ndjson')), cogRows = ndRows(resolve(repo, 'data/vna/cog.ndjson')), runnerRows = ndRows(resolve(repo, '.thetacog/runner.ndjson')), specMd = (() => { try { return readFileSync(resolve(repo, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'), 'utf8'); } catch { return ''; } })(), treeNodes = (() => { try { return readTreeJson(resolve(repo, 'data/vna/spec-tree.json')).nodes; } catch { return null; } })(), minRows = MIN_ROWS } = {}) {
  const ticks = specTicks(specMd);
  const predictions = newestPer(predictRows.filter((r) => r.status === 'predicted'), 'label');
  if (!predictions.size) return { status: 'UNMEASURED', why: 'no prediction on the record — node scripts/vna/cog.mjs --predict <label…>', rows: [], n: 0 };
  const rows = [...predictions.keys()].sort().map((label) => babysitRow({ label, predictions, cogRows, runnerRows, ticks, treeNodes }));
  const landed = rows.filter((r) => r.landed); const paired = rows.filter((r) => r.status === 'measured');
  const overUngraded = rows.filter((r) => r.note === 'built over an ungraded direction').map((r) => r.label);   // C98i
  const xs = paired.map((r) => r.predicted), ys = paired.map((r) => r.returns);
  const rho = spearman(xs, ys); const n = paired.length;
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const power = n >= minRows ? 'powered' : 'UNDERPOWERED';
  return { status: 'measured', n, predicted: rows.length, landed: landed.length, open: rows.filter((r) => r.open).length, built_over_ungraded: overUngraded, returns_median: med(ys), returns_median_landed: med(landed.map((r) => r.returns)),
    correlation: { rho: power === 'powered' ? rho : null, rho_provisional: rho, n, floor: minRows, power, why: power === 'powered' ? null : `n ${n} below the floor ${minRows} — ρ is not a verdict yet; the provisional value is shown as a number to refine, never to act on` },
    rows, source: 'data/vna/cog-predict.ndjson · data/vna/cog.ndjson · .thetacog/runner.ndjson' };
}

/** the legend, answered on ask: the bands the cog is priced in, beside the buyer's own rate or UNPINNED */
export function legend({ repo = REPO } = {}) {
  let weights = null, rate = null; try { weights = JSON.parse(readFileSync(resolve(repo, 'data/vna/cog-weights.json'), 'utf8')); } catch {}
  try { rate = JSON.parse(readFileSync(resolve(repo, 'data/vna/labour-rate.json'), 'utf8')); } catch {}
  const bands = weights ? weights.bands.map((b) => ({ name: b.name, max: b.max == null ? '∞' : b.max })) : [];
  const cited = rate && Array.isArray(rate.bands) ? rate.bands.every((b) => b.cites) : false;
  return { bands, unit: weights ? weights.unit : null, rate: rate ? (cited ? { status: 'PINNED', currency: rate.currency || null, by: rate.by || null, bands: rate.bands } : { status: 'UNPINNED', why: 'a rate row without cites is refused (C93j)' }) : { status: 'UNPINNED', why: 'no data/vna/labour-rate.json — the buyer has not declared a rate' },
    note: 'the legend is answered from the account-holder\'s declaration when asked; it is never printed on the card (C94f)' };
}

export function babysitLine(d) {
  if (!d || d.status !== 'measured') return `babysit ⚪ UNMEASURED · ${(d && d.why) || 'no reading'}`;
  const c = d.correlation; const rho = c.power === 'powered' ? `ρ ${c.rho}` : `ρ ${c.power} (n ${c.n} < ${c.floor}${c.rho_provisional == null ? '' : `, provisional ${c.rho_provisional}`})`;
  return `babysit ${d.predicted} predicted · ${d.landed} landed · returns median ${d.returns_median == null ? '—' : d.returns_median} · predicted-vs-returns ${rho}`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--legend')) { const l = legend(); if (argv.includes('--json')) console.log(JSON.stringify(l, null, 2)); else { console.log(`THE LEGEND — answered on ask, never on the card`); console.log(`  bands (${l.unit || 'cog'}): ${l.bands.map((b) => `${b.name} ≤ ${b.max}`).join(' · ') || '—'}`); console.log(`  rate: ${l.rate.status}${l.rate.why ? ' — ' + l.rate.why : ''}${l.rate.currency ? ' ' + l.rate.currency : ''}${l.rate.by ? ' · by ' + l.rate.by : ''}`); if (l.rate.bands) for (const b of l.rate.bands) console.log(`    ${b.name || b.band}: ${JSON.stringify(b)}`); } process.exit(0); }
  if (argv.includes('--windows')) { /* handled below */ } else {
  const d = babysitReading();
  if (argv.includes('--json')) { console.log(JSON.stringify(d, null, 2)); process.exit(0); }
  console.log(`THE BABYSITTING READING — the prediction scored against landing (C93p)`); console.log(`  ${babysitLine(d)}`);
  if (d.status === 'measured') { console.log(`  ${d.correlation.why || 'ρ at or above the floor'}`); console.log(`  label   predicted band shape           landed route   returns (attempts+halts)  realized  ungraded`); for (const r of d.rows) console.log(`  ${r.label.padEnd(7)} ${String(r.predicted).padEnd(9)} ${String(r.band).padEnd(4)} ${String(r.shape).padEnd(15)} ${(r.landed ? (r.minted ? 'yes' : 'yes*') : 'open').padEnd(6)} ${String(r.route || '—').padEnd(7)} ${String(r.returns).padEnd(3)} (${r.attempts}+${r.halts})${' '.repeat(16)}${String(r.realized == null ? '—' : r.realized).padEnd(9)} ${r.ungraded_at_tick == null ? (r.ungraded_now == null ? '—' : `${r.ungraded_now} now`) : `${r.ungraded_at_tick} at tick`}${r.note ? ' · ' + r.note : ''}`); if (d.built_over_ungraded.length) console.log(`  built over an ungraded direction (C98i, a reading): ${d.built_over_ungraded.join(' ')}`); console.log(`  yes* = ticked in the spec, its commit not yet minted (node scripts/vna/cog.mjs --since <sha>)`); console.log(`  source: ${d.source}`); }
  }
}

// ── C93q THE THREE WINDOW READINGS — the Bridge paste's metrics, corrected to what the record holds ─────────────────────────
// The paste (2026-09-19) proposed an Intervention Rate (steer commands per goal), Mean Cycles Between Resets, and a Complexity
// Weight (tape bytes ÷ human keystrokes). Each is countable; none is countable in the paste's words. Corrected:
//   interventions  = the operator's RETAINED rows in the goal's window (docs/specs/vna/amendments.ndjson — steer-file appends and
//                    transcript prompts, C19/C72); "steer commands" are a subset and the ledger does not distinguish them.
//   cycles         = commit rows on the flight tape in the window; "resets" = runner halts (a gate failure WITH its reason on the row —
//                    never a hallucination rate) and clear evictions are not on this tape and are not counted here.
//   tape depth     = bytes of flight-tape rows in the window ÷ bytes the operator appended in the window (the ledger holds BYTES,
//                    not keystrokes; no keystroke is on any record). No human bytes → UNMEASURED, never ∞.
// A window is a goal row on the flight tape whose status starts "closed": [seed.set_at, ts]. Fewer than 2 windows → the medians
// print with n and the word THIN. The complexity unit is the cog (C93a) — this file mints no second one.
export function goalWindows(flightRows) { const out = []; for (const r of flightRows) if (r.kind === 'goal' && r.delta && /^closed/.test(String(r.delta.status)) && r.seed && r.seed.set_at) out.push({ sha: String(r.sha || '').slice(0, 10), set_at: r.seed.set_at, closed_at: r.ts, status: r.delta.status }); return out; }
export function windowReading({ win, flightRows, amendRows, runnerRows }) {
  const inW = (t) => t && t >= win.set_at && t <= win.closed_at;
  const commits = flightRows.filter((r) => r.kind === 'commit' && inW(r.ts)); const tapeBytes = flightRows.filter((r) => inW(r.ts)).reduce((a, r) => a + Buffer.byteLength(JSON.stringify(r), 'utf8'), 0);
  const human = amendRows.filter((r) => inW(r.at)); const humanBytes = human.reduce((a, r) => a + (Number(r.bytes) || 0), 0);
  const halts = runnerRows.filter((r) => r.kind === 'halt' && inW(r.at)).length; const dispatches = runnerRows.filter((r) => r.kind === 'dispatch' && inW(r.at)).length;
  const r2 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return { goal: win.sha, set_at: win.set_at, closed_at: win.closed_at, commits: commits.length, interventions: human.length, human_bytes: humanBytes, tape_bytes: tapeBytes, halts, dispatches,
    intervention_rate: commits.length ? r2(human.length / commits.length) : null, halts_per_dispatch: dispatches ? r2(halts / dispatches) : null,
    tape_depth: humanBytes ? r2(tapeBytes / humanBytes) : null, tape_depth_why: humanBytes ? null : 'no operator bytes retained in the window — UNMEASURED, never ∞' };
}
export function windowReadings({ repo = REPO, flightRows = ndRows(resolve(repo, 'data/vna/flight-tape.ndjson')), amendRows = slimAmendRows(resolve(repo, 'docs/specs/vna/amendments.ndjson')), runnerRows = ndRows(resolve(repo, '.thetacog/runner.ndjson')) } = {}) {
  const wins = goalWindows(flightRows); if (!wins.length) return { status: 'UNMEASURED', why: 'no closed goal row on the flight tape — a window needs a goal that closed (C91a)', windows: [], n: 0 };
  const windows = wins.map((win) => windowReading({ win, flightRows, amendRows, runnerRows }));
  const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  return { status: 'measured', n: windows.length, thin: windows.length < 2, windows, median: { intervention_rate: med(windows.map((w) => w.intervention_rate)), halts_per_dispatch: med(windows.map((w) => w.halts_per_dispatch)), tape_depth: med(windows.map((w) => w.tape_depth)) },
    source: 'data/vna/flight-tape.ndjson (goal + commit rows) · docs/specs/vna/amendments.ndjson · .thetacog/runner.ndjson' };
}
export function windowLine(d) {
  if (!d || d.status !== 'measured') return `windows ⚪ UNMEASURED · ${(d && d.why) || 'no reading'}`;
  const f = (x) => (x == null ? '—' : x); const m = d.median;
  return `windows ${d.n}${d.thin ? ' THIN' : ''} · interventions/commit ${f(m.intervention_rate)} · halts/dispatch ${f(m.halts_per_dispatch)} · tape bytes/operator byte ${f(m.tape_depth)}`;
}
if (isMain && process.argv.includes('--windows')) {
  const d = windowReadings(); if (process.argv.includes('--json')) console.log(JSON.stringify(d, null, 2)); else { console.log(`THE THREE WINDOW READINGS (C93q) — ${windowLine(d)}`); for (const w of d.windows || []) console.log(`  goal ${w.goal} · ${w.set_at.slice(5, 16)} → ${w.closed_at.slice(5, 16)} · commits ${w.commits} · interventions ${w.interventions} (${w.human_bytes} B) · halts ${w.halts}/${w.dispatches} · tape ${w.tape_bytes} B · rate ${w.intervention_rate ?? '—'} · depth ${w.tape_depth ?? w.tape_depth_why}`); if (d.source) console.log(`  source: ${d.source}`); }
}
