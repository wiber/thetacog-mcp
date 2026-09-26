#!/usr/bin/env node
// scripts/vna/envelope.mjs — THE ATTRACTOR ENVELOPE. The net, not the box.
//
// Operator, 2026-09-08, correcting the reading of the whole spec:
//   "I never said to make it impossible to fail, impossible to drift. What I said was to make it
//    an attractor state — instead of the water wanting to go through the holes in the net, the
//    water sticks to the net. You do whatever it's going to do, and then you check if you can use
//    the tesseract as a signal to redirect afterwards back towards what you wanted, and run that
//    operation continuously as many times as you can. That's what a cockpit does."
//
// SO THE REDIRECT IS POST-HOC AND THE LOOP IS THE PRODUCT. Nothing here prevents anything. The
// work happens, the lattice reads where it landed, and this emits a restoring vector back toward
// the declaration. Drift is the INPUT, never the failure. An enclosure would be a different
// (and, per Rice, undecidable) machine; a restoring force only has to be computable AFTER the fact,
// which is exactly what the placement already is.
//
// TWO ARMS EVERY CYCLE, AND THE OPERATOR PICKS (his call, 2026-09-08):
//   MOVE THE WORK        — the declared-but-unworked coordinate to aim the next commit at.
//   MOVE THE DECLARATION — the worked-but-undeclared coordinate the spec never named, as a
//                          checklist amendment. Sometimes the drift WAS the real work.
// Neither is the correction; the pair is the choice. And which arm he picks, cycle after cycle,
// IS the competence pixel — a record of where this operator's work actually wants to go, which no
// self-report could produce.
//
// WHY BOTH ARMS AND NOT A SINGLE "FIX". A one-armed emitter assumes the declaration is always
// right, which is the transitive-abstraction failure the spec's own §11 diagnoses: abstractions
// are guaranteed to leak, so an instrument that can only ever push reality back at a fixed
// declaration will spend the operator's attention defending a stale map. Letting the declaration
// move is what makes this an attractor rather than a leash.
//
// LLM-FREE. Placement is gzip-NCD against the 144 cell masses — the arm measured at 4.34x over
// chance (data/vna/aperture-measurement.json). The model reads the emitted card; it never writes it.
//
// CLI: node scripts/vna/envelope.mjs [--pick work|declaration] [--note "..."] [--json]
//   --json prints ONE object (the cycle, every coord pre-named, the card text, the pick row if any)
//   and nothing else — the door the VS Code surface reads through. It adds no computation.
//
// @guard tests/vna/envelope.test.mjs · tests/vna/extension-envelope.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const LIB = resolve(REPO, 'data/pmu/snippet-library-144.json');
// GREEKS_INDEX_OUT matches build-greeks-index.mjs's own override var, so a fixture (e.g. C196a's
// signing-order-vs-commit-order guard) can point both the writer and this reader at one isolated file
// instead of forging rows into the real, committed index.
const GREEKS = process.env.GREEKS_INDEX_OUT || resolve(REPO, 'src/data/commit-greeks-index.json');
const SPEC = process.env.VNA_SPEC || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
// OVERRIDABLE ON PURPOSE. It was hard-coded, and the consequence was that the pick path — the most
// important path in this file, because the pick IS the competence signal — could only ever be
// guarded from source text, never actually run: exercising it meant appending a fabricated choice
// to the operator's real record. A guard that cannot run the path it guards is a green light.
const LEDGER = process.env.VNA_LEDGER || resolve(REPO, 'data/vna/pick-ledger.ndjson');
const AX = ['A','B','C','A1','A2','A3','B1','B2','B3','C1','C2','C3'];

// ── the lattice geometry, one definition ────────────────────────────────────
// Chebyshev on the 12x12 BLOCK grid — the same metric the encircled panel bands on (fenceDist)
// and the same one the aperture measurement scored on. A second metric here would let the
// envelope disagree with the panel about the very gap it is asking the operator to close.
export const blockOf = (coord) => {
  const m = /^([A-C])([1-3])?,([A-C])([1-3])?$/.exec(String(coord || '').trim());
  if (!m) return null;
  return ['ABC'.indexOf(m[1]) * 3 + (m[2] ? +m[2] - 1 : 1), 'ABC'.indexOf(m[3]) * 3 + (m[4] ? +m[4] - 1 : 1)];
};
export const cheb = (a, b) => (a && b) ? Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) : null;
const gz = (s) => gzipSync(Buffer.from(s, 'utf8')).length;

// ── placement: the measured best arm — NCD against FULL cell mass ───────────
// Measured and rejected: cutting the aperture down (-8.3pt) and a second bulk pass (a 144/144
// fixpoint, so pure cost). This is the whole placer.
let _anchors = null, _z = null;
function anchors() {
  if (!_anchors) { _anchors = JSON.parse(readFileSync(LIB, 'utf8')); _z = _anchors.map((a) => gz(a.snippet || '')); }
  return _anchors;
}
export function place(text) {
  const A = anchors(); const zq = gz(text);
  let best = -1, v1 = -Infinity, v2 = -Infinity;
  for (let j = 0; j < A.length; j++) {
    const zab = gz(text + '\n' + (A[j].snippet || ''));
    const sim = 1 - ((zab - Math.min(zq, _z[j])) / Math.max(zq, _z[j]));
    if (sim > v1) { v2 = v1; v1 = sim; best = j; } else if (sim > v2) v2 = sim;
  }
  const a = A[best];
  return { coord: `${a.row},${a.col}`, block: blockOf(`${a.row},${a.col}`), margin: v1 - v2, top: v1 };
}

// THE ABSTENTION FLOOR, calibrated on the perturbation ladder rather than guessed
// (data/vna/perturbation-ladder.json: 0.00928 is the mean margin at the last rung still
// distinguishable from chance). Below it the placement is not trustworthy and the envelope must
// say so instead of aiming the operator at a coordinate it cannot stand behind — a confident wrong
// placement measured WORSE than chance, so a silent guess is the costliest possible output.
export const MARGIN_FLOOR = Number(process.env.VNA_MARGIN_FLOOR || 0.00928);

// ── DECLARED: every checklist row, ticked or not, placed by the ONE walk ─────────
// ARM 2 SETTLED (operator 2026-09-18, "settle Arm 2 to retain ticked rows"): a ticked row is STILL a declaration. Reading
// only unchecked rows made every finished lane read as drift — C54 declared A1,C3, was ticked the same day, and the next
// cycle named A1,C3 as undeclared for 8 commits (the v3 report's open question 4). A tick closes the WORK on a row, never
// the lane it declared. So: Arm 2 (worked-but-undeclared) fences against ALL rows; Arm 1 (declared-but-unworked) aims only
// at OPEN rows — a ticked row has no work left to move toward. The pull reads against all rows.
// THE PLACER IS THE ONE RUST WALK when the tree holds the row (operator, same turn: "the L1 cache ballistic walk … is
// supposed to be foundational … have we drifted away from it"): the basins' pixels are lensWalk's answer (spec-tree.mjs,
// n.pixel), the same door that placed the commits this cycle compares them to. Before this the declared side was placed
// by NCD against the 144 anchors (place() below) while the worked side came from the walk — a drift number that was
// partly two instruments disagreeing. place() remains ONLY for a row the tree has not folded yet (via 'ncd', with the
// ladder's margin floor); a walk-placed row is confident by construction (the door produced a pixel; whether the row is
// ABOUT that cell is the C47 claim and is not imported here — the same argument as C53b). Rows say which door placed them.
export function declared(md, { tree = null } = {}) {
  const out = [];
  const N = tree && tree.nodes || null;
  for (const line of md.split('\n')) {
    const m = /^-\s*\[( |x)\]\s*(\S+)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const id = m[2], text = m[3], done = m[1] === 'x';
    const n = N ? N[`n_spec_${id}`] : null;
    if (n && n.basin && !n.retracted && n.pixel && blockOf(n.pixel)) { out.push({ id, text, done, coord: n.pixel, block: blockOf(n.pixel), margin: null, top: null, via: 'walk', confident: true }); continue; }
    const p = place(text);
    out.push({ id, text, done, ...p, via: 'ncd', confident: p.margin >= MARGIN_FLOOR });
  }
  return out;
}
const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export function loadTree(path = TREE) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

// ── WORKED: recent commits' realized coordinates ────────────────────────────
// C196a (operator 2026-09-23): ORDER BY THE COMMIT'S OWN COMMITTER TIME, NEVER THE ATTESTATION'S
// SIGNING `ts`. `v.ts` on a GREEKS row is when the signal was SIGNED (build-greeks-index.mjs stamps
// sig.ts verbatim) — a different clock from when the commit itself landed. A sanctioned backfill
// (attestation-backfill.mjs, 50 rows signed 2026-09-23 for commits stalled since 09-20) gives old
// commits a fresh signing ts, which inverted the chronology when `worked()` sorted on it: stale
// commits read as the newest work. The signing ts STAYS on the row (it is a true fact about when it
// was signed) — only the ORDER key changes, to git's own record (W3: read a record the actor did not
// author) via the committer time at the sha.
//
// BATCHED, NEVER ONE PROCESS PER ROW — that pattern already cost a 17-min fold elsewhere (one
// `pmu-onchip` spawn per row on a 330MB sidecar). `git log --stdin` takes every sha on stdin and
// answers in one process; `--ignore-missing` means a GREEKS row whose sha no longer resolves (a
// squashed or since-rewritten commit) is skipped rather than aborting the whole batch.
function commitTimesMs(shas) {
  const map = new Map();
  const uniq = [...new Set(shas)];
  if (!uniq.length) return map;
  let out;
  try {
    out = execSync('git log --no-walk=unsorted --ignore-missing --format=%H%x09%ct --stdin', {
      cwd: REPO, input: uniq.join('\n') + '\n', maxBuffer: 1 << 26,
    }).toString();
  } catch { return map; }   // a git failure falls back to the signing ts below, never blocks worked()
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [full, ct] = line.split('\t');
    // git echoes back the FULL 40-char sha (%H), never the 12-char abbreviation we sent it (there is
    // no flag that round-trips the input token) — every GREEKS key is `sha.slice(0, 12)`
    // (lens-signal-emit.mjs), so the full hash's own first 12 chars IS that same key.
    if (full && ct) map.set(full.slice(0, 12), Number(ct) * 1000);
  }
  return map;
}
export function worked({ limit = 20 } = {}) {
  if (!existsSync(GREEKS)) return [];
  const g = JSON.parse(readFileSync(GREEKS, 'utf8'));
  const rows = Object.entries(g)
    .map(([sha, v]) => ({ sha: sha.slice(0, 9), fullSha: sha, coord: v.coord, signedTs: v.ts ? new Date(v.ts).getTime() : 0, sigma: v.sigma }))
    .filter((c) => c.coord && blockOf(c.coord));
  if (!rows.length) return [];
  const ct = commitTimesMs(rows.map((r) => r.fullSha));
  return rows
    .map((c) => ({ ...c, ts: ct.get(c.fullSha) || c.signedTs }))   // committer time wins; signing ts only when git can't resolve the sha
    .filter((c) => c.ts)
    .sort((a, b) => b.ts - a.ts).slice(0, limit)
    .map((c) => ({ ...c, block: blockOf(c.coord) }));
}

// ── THE GAP, and the two arms ───────────────────────────────────────────────
export function computeCycle({ md, tree = undefined, work: workRows = null, limit = 20, fence = 2 } = {}) {
  const decl = declared(md, { tree: tree === undefined ? loadTree() : tree });
  const work = workRows ? workRows.map((w) => ({ ...w, block: w.block || blockOf(w.coord) })).filter((w) => w.block) : worked({ limit });
  const confident = decl.filter((d) => d.confident);
  const abstained = decl.filter((d) => !d.confident);

  // declared but unworked: no recent commit landed within the fence — OPEN rows only (a ticked row has no work to move toward)
  const unworked = confident.filter((d) => !d.done && !work.some((w) => cheb(d.block, w.block) <= fence));
  // worked but undeclared: no declared item sits within the fence of it
  const undeclared = work.filter((w) => !confident.some((d) => cheb(d.block, w.block) <= fence));

  // the pull: how far the recent work sits from the nearest declared intent, on average
  const dists = work.map((w) => {
    const ds = confident.map((d) => cheb(w.block, d.block)).filter((x) => x != null);
    return ds.length ? Math.min(...ds) : null;
  }).filter((x) => x != null);
  const pull = dists.length ? +(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(2) : null;

  // ARM 1 — MOVE THE WORK. Aim at the unworked declaration nearest the current work: nearest is
  // the cheapest real move, and an arm the operator will not take is not an arm.
  let moveWork = null;
  if (unworked.length && work.length) {
    const scored = unworked.map((d) => ({ d, dist: Math.min(...work.map((w) => cheb(d.block, w.block))) }))
      .sort((a, b) => a.dist - b.dist);
    const t = scored[0];
    const closes = pull ? Math.max(0, Math.round(100 * (pull - Math.max(0, pull - t.dist)) / pull)) : null;
    moveWork = { target: t.d, distanceFromWork: t.dist, alsoUnworked: unworked.length - 1, closesPct: closes };
  }

  // ARM 2 — MOVE THE DECLARATION. Cluster the undeclared work; the biggest cluster is the lane the
  // spec never named. A repeated landing is a signal; a single one is noise.
  let moveDecl = null;
  if (undeclared.length) {
    const byCoord = {};
    for (const w of undeclared) (byCoord[w.coord] ||= []).push(w);
    const top = Object.entries(byCoord).sort((a, b) => b[1].length - a[1].length)[0];
    moveDecl = { coord: top[0], commits: top[1].map((w) => w.sha), n: top[1].length,
      totalUndeclared: undeclared.length, repeated: top[1].length > 1 };
  }

  const placedBy = { walk: decl.filter((d) => d.via === 'walk').length, ncd: decl.filter((d) => d.via === 'ncd').length };
  const rows = { open: decl.filter((d) => !d.done).length, ticked: decl.filter((d) => d.done).length };
  // THE NET'S WIDTH, said beside the pull: a pull of 0 over a net that covers every cell at this fence means nothing.
  // cells = the 12×12 blocks within the fence of any confidently placed row; exact = the blocks a row sits on.
  const within = (f) => { let n = 0; for (let r = 0; r < 12; r++) for (let q = 0; q < 12; q++) if (confident.some((d) => cheb(d.block, [r, q]) <= f)) n++; return n; };
  const coverage = { exact: within(0), cells: within(fence), pct: Math.round(100 * within(fence) / 144), fence };
  return { decl, work, confident, abstained, unworked, undeclared, pull, moveWork, moveDecl, fence, limit, placedBy, rows, coverage };
}

// ── the pick ledger — the competence signal ─────────────────────────────────
// Which arm he takes, cycle after cycle, is the thing no self-report produces. Append-only: a
// ledger that can be rewritten is a record of a preference, not of a choice.
// THE CYCLE IDENTITY — so a pick is provably about the cycle the operator actually saw.
// A pick recomputes the cycle inside its own invocation, which looks harmless: the inputs are git
// state, and git state does not change while somebody reads a card. Except in THIS repo it does —
// post-commit hooks land `chore(commit-page)` commits unattended, so HEAD can move between the look
// and the click, and the ledger row would then describe a cycle nobody chose. Hashing the cycle
// makes that visible instead of silent: the caller passes back the id it displayed, and a mismatch
// is RECORDED. This does not prevent the race; it makes it countable, which is the whole posture.
export function cycleId(c) {
  return createHash('sha256').update(JSON.stringify({
    pull: c.pull,
    unworked: c.unworked.map((u) => u.id).sort(),
    undeclared: c.undeclared.map((w) => w.coord).sort(),
    moveWork: c.moveWork?.target?.id || null,
    moveDecl: c.moveDecl?.coord || null,
  })).digest('hex').slice(0, 12);
}

export function recordPick({ cycle, arm, note = '', shownId = null }) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  const id = cycleId(cycle);
  const row = { at: new Date().toISOString(), arm, note,
    cycleId: id, shownId: shownId || null,
    stale: shownId ? shownId !== id : null,   // null = the caller never said what it showed
    pull: cycle.pull, unworked: cycle.unworked.length, undeclared: cycle.undeclared.length,
    moveWorkTarget: cycle.moveWork?.target?.id || null, moveDeclCoord: cycle.moveDecl?.coord || null };
  appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  return row;
}

export function fullName(coord) {
  const N = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
    B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
  const m = /^([A-C][1-3]?),([A-C][1-3]?)$/.exec(String(coord || ''));
  return m ? `${m[1]}.${N[m[1]]} × ${m[2]}.${N[m[2]]}` : String(coord || '?');
}

// ── the card, built once and read twice ─────────────────────────────────────
// The human CLI prints these lines; `--json` ships the same lines as `card` so the IDE surface
// copies the emitter's own words to the chat rather than composing a second card of its own.
export function renderCard(c) {
  const L = [];
  L.push(`VNA ENVELOPE — the net, not the box. Drift is the input.`, '');
  L.push(`declared: ${c.decl.length} rows (${c.rows ? `${c.rows.open} open · ${c.rows.ticked} ticked — a tick closes the work, never the lane` : '?'})  ·  placed by the one walk: ${c.placedBy ? c.placedBy.walk : '?'}  ·  by NCD (not yet folded): ${c.placedBy ? c.placedBy.ncd : '?'}  ·  ABSTAINED: ${c.abstained.length}`);
  L.push(`recent work: ${c.work.length} commits  ·  PULL: ${c.pull ?? '—'} blocks from the nearest declaration  ·  the net covers ${c.coverage ? `${c.coverage.pct}% of the grid at fence ${c.coverage.fence} (${c.coverage.exact} exact cells)` : '?'}${c.coverage && c.coverage.pct >= 95 ? '  ← saturated: the pull cannot discriminate at this fence' : ''}`, '');
  if (c.abstained.length) {
    L.push(`ABSTAINED (margin < ${MARGIN_FLOOR} — not placed rather than placed wrongly):`);
    for (const a of c.abstained.slice(0, 5)) L.push(`   ${a.id} ${a.text.slice(0, 62)} (margin ${a.margin.toFixed(5)})`);
    L.push('');
  }

  L.push(`┌─ ARM 1 · MOVE THE WORK ${'─'.repeat(42)}`);
  if (c.moveWork) {
    L.push(`│ aim the next commit at ${c.moveWork.target.id} — ${c.moveWork.target.coord}`);
    L.push(`│   ${fullName(c.moveWork.target.coord)}`);
    L.push(`│   "${c.moveWork.target.text.slice(0, 66)}"`);
    L.push(`│ ${c.moveWork.distanceFromWork} blocks from where the work already is` +
      (c.moveWork.closesPct != null ? ` · closes ~${c.moveWork.closesPct}% of the pull` : ''));
    if (c.moveWork.alsoUnworked) L.push(`│ (${c.moveWork.alsoUnworked} other declared item(s) also unworked)`);
  } else L.push(`│ nothing declared-but-unworked — the work is covering the declaration`);
  L.push(`└${'─'.repeat(66)}`);

  L.push(`┌─ ARM 2 · MOVE THE DECLARATION ${'─'.repeat(35)}`);
  if (c.moveDecl) {
    L.push(`│ the work keeps landing at ${c.moveDecl.coord} and the spec never named it`);
    L.push(`│   ${fullName(c.moveDecl.coord)}`);
    L.push(`│ ${c.moveDecl.n} commit(s): ${c.moveDecl.commits.join(', ')}${c.moveDecl.repeated ? '  ← repeated, so a signal not noise' : '  ← single landing, may be noise'}`);
    L.push(`│ amend the checklist to declare it, or decide the drift was wrong`);
  } else L.push(`│ nothing worked-but-undeclared — the declaration covers the work`);
  L.push(`└${'─'.repeat(66)}`);

  L.push('', `Which arm you take, cycle after cycle, IS the competence pixel.`);
  L.push(`record it:  node scripts/vna/envelope.mjs --pick work|declaration [--note "..."]`);
  return L.join('\n');
}

// ── the machine door: `--json` ──────────────────────────────────────────────
// One object on stdout, nothing else. Every coordinate the cycle can render arrives with its full
// ShortLex name already attached (`name` on each item, plus a `names` map), so a reader of this
// JSON never has to know how to expand a coordinate — and therefore never can expand it wrongly.
function ledgerCount() {
  try { return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}
export function toJson(c, extra = {}) {
  const named = (x) => (x && x.coord) ? { ...x, name: fullName(x.coord) } : x;
  const names = {};
  for (const x of [...c.decl, ...c.work]) if (x.coord) names[x.coord] = fullName(x.coord);
  if (c.moveDecl) names[c.moveDecl.coord] = fullName(c.moveDecl.coord);
  return {
    decl: c.decl.map(named), confident: c.confident.map(named), abstained: c.abstained.map(named),
    work: c.work.map(named), unworked: c.unworked.map(named), undeclared: c.undeclared.map(named),
    pull: c.pull, fence: c.fence, limit: c.limit, floor: MARGIN_FLOOR,
    coverage: c.coverage || null, rows: c.rows || null, placedBy: c.placedBy || null,   // C60: the forest line reads these off the receipt
    moveWork: c.moveWork ? { ...c.moveWork, target: named(c.moveWork.target) } : null,
    moveDecl: named(c.moveDecl),
    names, card: renderCard(c),
    // the identity of THIS cycle, so a caller that displays it can hand it back on the pick and a
    // pick against a moved-on state is recorded as stale rather than passing as a real choice.
    cycleId: cycleId(c),
    ledger: { path: LEDGER.replace(REPO + '/', ''), count: ledgerCount() },
    ...extra,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const pick = argv.includes('--pick') ? argv[argv.indexOf('--pick') + 1] : null;
  const json = argv.includes('--json');
  const md = readFileSync(SPEC, 'utf8');
  const c = computeCycle({ md, tree: loadTree(), limit: Number(process.env.VNA_LIMIT || 20) });

  if (!json) console.log(renderCard(c));

  let row = null;
  if (pick) {
    if (!['work', 'declaration'].includes(pick)) { console.error(`--pick must be work|declaration`); process.exit(1); }
    const note = argv.includes('--note') ? argv[argv.indexOf('--note') + 1] : '';
    const shownId = argv.includes('--shown-id') ? argv[argv.indexOf('--shown-id') + 1] : null;
    row = recordPick({ cycle: c, arm: pick, note, shownId });
    if (!json) {
      console.log(`\n✔ recorded → ${LEDGER.replace(REPO + '/', '')}`);
      console.log(`  ${JSON.stringify(row)}`);
      if (row.stale) {
        console.log(`\n⚠ STALE PICK — you were shown cycle ${shownId}, this recomputed to ${row.cycleId}.`);
        console.log(`  The state moved between the look and the click. Recorded with stale:true rather than hidden.`);
      }
    }
  }
  // THE RECEIPT — written on every run, so a SECOND surface can show both arms without recomputing
  // them. steer-ui.mjs paints from receipts and computes nothing; before this file existed the
  // envelope was reachable only from this CLI and the IDE cycle panel, so the page that shows the
  // map and the spec could not show the two arms the loop actually turns on. Written on the human
  // path too, not just under --json: a receipt that only exists when a machine asked for it is a
  // receipt the human read-out can silently fall behind.
  const out = toJson(c, { pick: row });
  try {
    mkdirSync(resolve(REPO, 'data/vna'), { recursive: true });
    writeFileSync(resolve(REPO, 'data/vna/envelope.json'), JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
  } catch { /* best-effort receipt; the CLI's own output is never blocked by it */ }
  if (json) console.log(JSON.stringify(out));
}
// ABSENCE RENDERED AS ABSENCE, NEVER A STACK. Without this, a repo missing data/pmu/snippet-library-144.json (a
// fixture without the library, a fresh clone before the library is generated, any other precondition this file
// assumes) printed a raw node stack trace to stderr — and a caller that captures that stderr as "the answer"
// (the 💬 Steer chat's inline handler, C167g/C201, streams a spawned child's stdout+stderr straight into the
// transcript) appended the WHOLE TRACE as if it were the reply. Seen: rows 14/16 of the operator's real
// .thetacog/chat/session.ndjson were exactly this trace, naming a test's temp fixture path. One line, non-zero
// exit — the same contract every other "not run — <reason>" card in this codebase already honours.
if (import.meta.url === `file://${process.argv[1]}`) {
    try { main(); } catch (e) { console.error(`envelope: not run — ${(e && e.message) || String(e)}`); process.exit(1); }
}
