#!/usr/bin/env node
// scripts/pmu/attest-stale-orders.mjs — C1414 T1: THE STALE ORDERS, ONE INSTRUCTION, TWO WORLDS (2026-10-29).
//
// Operator, verbatim: "Delete the stale orders in a database it's gonna come up with a different set of the order is tomorrow and
// today so the world doesn't care about your symbol." (docs/specs/2026-10-29-spec-quality-in-the-crate-and-the-wedge-test.md, T1)
//
// One byte-identical instruction ("delete the stale orders", fixtures/stale-orders/instruction.txt) runs against two snapshots of
// one committed fixture database (fixtures/stale-orders/today.json, tomorrow.json — the same fifteen rows of one orders table; the
// clock moves one day and three orders placed on 2026-09-29 age past the 30-day cut overnight). The executor's reading of the word
// "stale" is fixed and printed (STALE_READING: one query, the clock a bound parameter, never part of the symbol), so the instruction
// hash AND the query are identical on both days — and the rows removed differ. The symbol does not hold the world; the world decides
// what the symbol touches.
//
//   npx thetacog-mcp attest-stale-orders                      both snapshots, one block
//   npx thetacog-mcp attest-stale-orders --snapshot today     one run (repeatable; a path to another snapshot file works too)
//   ... --json <file|->                                       the record as JSON (to a file, or stdout with -)
//
// The fixture lives at packages/thetacog-mcp/fixtures/stale-orders/ — the tarball's own fixtures/ (package.json "files"), so it
// ships with no copy step and has ONE home; this door finds it beside itself in the package (../../fixtures) and at the package
// path in the repo. The run deletes nothing on disk: the snapshot is read, the removal is computed, the record is printed.
// LLM-free, network-free. Guard: tests/vna/c1414-t1-the-stale-orders-one-instruction.test.mjs.
//
// C1415 T2: THE INSTRUMENT PLACES THE CHANGE, NEVER THE PROMPT. Each run's CHANGE — the diff of rows removed, every row in full —
// is placed against the lane declared before the run (fixtures/stale-orders/lane.txt, "orders older than 30 days and unpaid") through
// the one Rust walk: buildTriptychInputs → renderTriptych (lean) → walkBoolean, imported, never re-implemented; the crate's entry
// floors both texts (320 chars / 220 gzip bytes) and stamps the reading. The prompt is never placed (23 chars, under the floor, and
// the same bytes both days): it is REPLAYED — the instruction bytes, the declared lane and the query the instruction became, one
// sha256 — and the replay digest is equal on both runs while the two placements differ. --no-place skips the walk (T1's view).
// Report: docs/pmu/reports/2026-10-29-stale-orders.md. Guard: tests/vna/c1415-t2-the-instrument-places-the-change.test.mjs.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = resolve(HERE, '..', '..');   // the package root in an extract, the repo root here
const CANDIDATES = [resolve(PKG_ROOT, 'fixtures/stale-orders'), resolve(PKG_ROOT, 'packages/thetacog-mcp/fixtures/stale-orders')];
export const FIXTURE_DIR = CANDIDATES.find((d) => existsSync(resolve(d, 'today.json'))) || CANDIDATES[0];
export const SNAPSHOTS = ['today', 'tomorrow'];

// THE EXECUTOR'S READING OF "STALE" — the symbol the instruction became. One query, the same text on every run; the clock is a
// bound parameter of the snapshot, never written into the symbol. Its word for stale is "open and older than 30 days": an order
// placed more than 30 days before the clock that is not yet fulfilled. Whether that was the right reading of the word is not
// something this door can say (that is T2's "not sufficient for").
export const STALE_READING = Object.freeze({
  query: "DELETE FROM orders WHERE status <> 'fulfilled' AND placed_at < date(:clock, '-30 days')",
  words: 'stale = not fulfilled, and placed more than 30 days before the snapshot clock',
  cutDays: 30,
});

const DAY = 86_400_000;
const sha = (b) => createHash('sha256').update(b).digest('hex');
export const ageDays = (placedAt, clock) => Math.floor((Date.parse(`${clock}T00:00:00Z`) - Date.parse(`${placedAt}T00:00:00Z`)) / DAY);
/** the reading, applied: the rows the query removes from this snapshot (placed_at < clock − 30 days ⇔ age > 30) */
export const isStale = (row, clock) => row.status !== 'fulfilled' && ageDays(row.placed_at, clock) > STALE_READING.cutDays;

export function readInstruction(dir = FIXTURE_DIR) { return readFileSync(resolve(dir, 'instruction.txt')); }
export function loadSnapshot(name, dir = FIXTURE_DIR) {
  const path = SNAPSHOTS.includes(name) ? resolve(dir, `${name}.json`) : (isAbsolute(name) ? name : resolve(process.cwd(), name));
  const snap = JSON.parse(readFileSync(path, 'utf8'));
  if (!snap || !Array.isArray(snap.orders) || !/^\d{4}-\d{2}-\d{2}$/.test(String(snap.clock || ''))) throw new Error(`${path}: a snapshot carries a clock (YYYY-MM-DD) and an orders array`);
  return { ...snap, path };
}

/** the row as the diff prints it — every field, nothing summarised, one sentence per row (the claim splitter reads a sentence as one
 *  claim; a block of unpunctuated lines reads as ONE segment past its 400-char cap and senses nothing) */
export const rowLine = (r, clock) => `Order ${r.id} for ${r.customer} was removed: placed ${r.placed_at}, ${ageDays(r.placed_at, clock)} days old at the clock, total ${r.total_eur} EUR, paid ${r.paid ? 'yes' : 'no'}, status ${r.status}, ${r.items} item${r.items === 1 ? '' : 's'}.`;

/** ONE RUN: the instruction (its bytes), the reading (its query), one snapshot → the rows removed */
export function runStale(name, { dir = FIXTURE_DIR, instruction = readInstruction(dir) } = {}) {
  const snap = loadSnapshot(name, dir);
  const removed = snap.orders.filter((r) => isStale(r, snap.clock)).sort((a, b) => a.id - b.id);
  const kept = snap.orders.filter((r) => !isStale(r, snap.clock));
  const removedIds = removed.map((r) => r.id);
  const diffText = [
    `The instruction "${String(instruction).trim()}" removed ${removed.length} of ${snap.orders.length} rows from table ${snap.table || 'orders'} in snapshot ${snap.snapshot || name} (clock ${snap.clock}).`,
    ...removed.map((r) => rowLine(r, snap.clock)),
  ].join('\n');
  return {
    snapshot: snap.snapshot || name, clock: snap.clock, table: snap.table || 'orders',
    instruction: String(instruction).trim(), instruction_sha256: sha(instruction),
    query: STALE_READING.query, query_sha256: sha(STALE_READING.query),
    rows: snap.orders.length, removed_ids: removedIds, removed_sha256: sha(JSON.stringify(removed)), kept_ids: kept.map((r) => r.id).sort((a, b) => a - b),
    removed_rows: removed, diff_text: diffText,
  };
}

export function compare(runs) {
  const hashes = new Set(runs.map((r) => r.instruction_sha256));
  const sets = new Set(runs.map((r) => r.removed_ids.join(',')));
  const [a, b] = runs;
  const onlyB = b ? b.removed_ids.filter((id) => !a.removed_ids.includes(id)) : [];
  const onlyA = b ? a.removed_ids.filter((id) => !b.removed_ids.includes(id)) : [];
  return { instruction_hashes_equal: hashes.size === 1, removed_sets_differ: sets.size === runs.length && runs.length > 1, only_first: onlyA, only_second: onlyB };
}

// ── C1415 T2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const LANE_HEADLINE = 'orders older than 30 days and unpaid';
export const KILL_TOLERANCE_PCT = 25;   // the demo's dial (attest-serve.mjs _oneTriptych, trial-sledgehammer.mjs), never tuned here
export const SUFFICIENT_FOR = 'Sufficient for: what was touched, placed against the declaration.';
export const NOT_SUFFICIENT_FOR = 'Not sufficient for: whether "stale" was the right word.';
export function readLane(dir = FIXTURE_DIR) { return readFileSync(resolve(dir, 'lane.txt'), 'utf8'); }

/** WHAT A REPLAY OF THE PROMPT READS: the instruction bytes, the lane declared before the run, the query the instruction became.
 *  The clock and the rows are the world, not the prompt — so this digest cannot tell the two runs apart, by construction. */
export function promptReplay(run, lane) {
  const record = { instruction_sha256: run.instruction_sha256, lane_sha256: sha(lane), query: run.query };
  return { ...record, digest: sha(JSON.stringify(record)) };
}

/** THE CHANGE, PLACED: intent = the declared lane, reality = the diff of rows removed (never the prompt), through the one walk.
 *  A refusal, a crate that cannot answer, or a module that will not load reads UNMEASURED with its reason — never a throw. */
export async function placeChange(run, lane, { repoRoot = PKG_ROOT, kill = KILL_TOLERANCE_PCT } = {}) {
  const base = { intent_field: 'lane', reality_field: 'change', intent_sha256: sha(lane), reality_sha256: sha(run.diff_text), kill };
  const finish = (o) => { const reading = { ...base, ...o }; delete reading.decidedBy; return { ...base, ...o, digest: sha(JSON.stringify(reading)) }; };
  try {
    const [{ buildTriptychInputs }, { renderTriptych }, { walkBoolean }] = await Promise.all([
      import('./triptych-build.mjs'), import('./triptych-render.mjs'), import('./tolerance-panel-verdict.mjs')]);
    const built = await buildTriptychInputs({ intentText: lane, realityText: run.diff_text, repoRoot, killTolerancePct: kill, sigmaType: 'drift', withShortlex: false, fields: { intent: 'lane', reality: 'change' } });
    if (built.refused) return finish({ state: 'UNMEASURED', reason: built.reason, floor: built.floor ?? null, sizes: built.stamp?.sizes ?? null });
    const t = renderTriptych({ ...built.renderArgs, killTolerancePct: kill, label: 'C1415 stale orders', message: `the change of ${run.snapshot}`, files: [], lean: true });
    const tol = t.tol || {};
    const wb = walkBoolean({ ...tol, killTolerancePct: kill });
    return finish({
      state: wb.state, reason: wb.reason, offPct: wb.offPct, tooMany: wb.tooMany, tier: wb.tier,
      matchSigma: built.meta.matchSigma ?? null, lanePixel: built.meta.actorCoord ? `${built.meta.actorCoord}→${built.meta.patientCoord}` : null,
      cells: { green: tol.green ?? null, amber: tol.amber ?? null, red: tol.red ?? null }, changeLit: built.meta.senseR?.lit ?? null,
      floor: built.floor ?? null, sizes: built.stamp?.sizes ?? null, apertureVersion: built.stamp?.apertureVersion ?? null, engine: built.stamp?.engine ?? null,
      decidedBy: wb.decidedBy,
    });
  } catch (e) { return finish({ state: 'UNMEASURED', reason: `the walk did not answer: ${String(e?.message || e).split('\n')[0].slice(0, 160)}` }); }
}

const PLACE_FIELDS = ['state', 'offPct', 'tier', 'matchSigma', 'cells', 'changeLit'];
/** which reading fields differ between two placements (the readout the report quotes) */
export function placementDelta(a, b) { return PLACE_FIELDS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => ({ field: k, from: a[k], to: b[k] })); }

async function main() {
  const a = process.argv.slice(2);
  const names = []; for (let i = 0; i < a.length; i++) if (a[i] === '--snapshot' && a[i + 1]) names.push(a[++i]);
  const ji = a.indexOf('--json'); const jsonOut = ji >= 0 ? (a[ji + 1] || '-') : null;
  const place = !a.includes('--no-place');
  const runs = (names.length ? names : SNAPSHOTS).map((n) => runStale(n));
  const lane = readLane();
  for (const r of runs) { r.prompt_replay = promptReplay(r, lane); if (place) r.placement = await placeChange(r, lane); }
  const cmp = runs.length > 1 ? compare(runs) : null;
  if (cmp) {
    cmp.prompt_replay_digests_equal = new Set(runs.map((r) => r.prompt_replay.digest)).size === 1;
    if (place) { cmp.placements_differ = new Set(runs.map((r) => r.placement.digest)).size === runs.length; cmp.placement_delta = placementDelta(runs[0].placement, runs[1].placement); }
  }
  const record = { door: 'attest-stale-orders', rows: ['C1414', 'C1415'], fixture: FIXTURE_DIR, reading: STALE_READING, lane: { headline: LANE_HEADLINE, text: lane, sha256: sha(lane) }, runs, compare: cmp, sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR };
  if (jsonOut === '-') { process.stdout.write(JSON.stringify(record, null, 2) + '\n'); return; }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(record, null, 2) + '\n');
  const L = [];
  L.push('STALE ORDERS — one instruction, two worlds (C1414 · C1415)');
  L.push(`instruction  "${runs[0].instruction}"  sha256 ${runs[0].instruction_sha256.slice(0, 16)}…`);
  L.push(`reading      ${STALE_READING.query}`);
  for (const r of runs) L.push(`${r.snapshot.padEnd(9)} clock ${r.clock} · instruction ${r.instruction_sha256.slice(0, 12)}… · removed ${r.removed_ids.length} of ${r.rows} · ids ${r.removed_ids.join(' ')}`);
  if (cmp) L.push(`instruction hashes ${cmp.instruction_hashes_equal ? 'EQUAL' : 'DIFFER'} · removed-row sets ${cmp.removed_sets_differ ? 'DIFFER' : 'EQUAL'}${cmp.only_second.length ? ` (${runs[1].snapshot} also removes ${cmp.only_second.join(' ')})` : ''}`);
  L.push('the symbol is the same; the world it ran against decided what it touched.');
  L.push(`lane         "${LANE_HEADLINE}" (lane.txt, declared before the run)`);
  const fmtP = (p) => !p ? 'not placed (--no-place)' : p.state === 'UNMEASURED' ? `UNMEASURED — ${p.reason}`
    : `${p.state} · off-lane ${p.offPct} % vs kill ${p.kill} · σ ${p.matchSigma} · cells ${p.cells.green}g/${p.cells.amber}a/${p.cells.red}r · placement ${p.digest.slice(0, 12)}…`;
  for (const r of runs) L.push(`${r.snapshot.padEnd(9)} prompt replay ${r.prompt_replay.digest.slice(0, 12)}… · change placed: ${fmtP(r.placement)}`);
  if (cmp) {
    L.push(`prompt replay digests ${cmp.prompt_replay_digests_equal ? 'EQUAL — a replay of the prompt reads the two runs as the same' : 'DIFFER'}`);
    if (place) L.push(`change placements ${cmp.placements_differ ? 'DIFFER — the placement of the change reads them apart' : 'EQUAL — the placement does not read them apart'}${cmp.placement_delta.length ? ` (${cmp.placement_delta.map((d) => `${d.field} ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`).join(' · ')})` : ''}`);
  }
  L.push(SUFFICIENT_FOR); L.push(NOT_SUFFICIENT_FOR);
  if (jsonOut) L.push(`record → ${jsonOut}`);
  console.log(L.join('\n'));
}

const isMain = () => { try { return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };   // a /var → /private/var symlink (macOS tmpdir) is still this file
if (isMain()) {
  main().catch((e) => { console.error(`not run — attest-stale-orders: ${String(e?.message || e).split('\n')[0]}`); process.exit(1); });
}
