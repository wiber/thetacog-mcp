#!/usr/bin/env node
// scripts/vna/story.mjs — THE SHAPE, TOLD AS A STORY. One frame, the movement, and what it means.
//
// Operator, 2026-09-08: "a single intersection is fine, but really it is the shape match. Tell a
// story about the shape of the pattern in one frame, and how it moves over time, and what that
// means for the work being done. You see the forest for the trees very simply when you can list
// the checkboxes that haven't been checked yet, or tell a story about what is drifting."
//
// A COORDINATE IS NOT A STORY. `A1,C3` is a fact; it answers "where" and nothing else. The story is
// the SHAPE — what the lit mass looks like in one frame, how that shape moves across frames, and
// what the motion implies for the work. This narrates all three.
//
// THE SHAPE VOCABULARY IS NOT INVENTED HERE. It already exists in triptych-render.mjs's region
// classifier and it is the operator's own reading, from 2026-06-15: a LINE is the carrier of
// meaning because a line names what is held CONSTANT across a streak.
//   DIAGONAL      actor == patient. Saying and doing in the same lane. Self-reference.
//   HORIZONTAL    one actor sprayed across many patients. The invariant is WHO acted.
//   VERTICAL      one target hit from many actors. The invariant is WHAT was hit.
//   OFF-DIAGONAL  everything shifted k lanes — a systematic aim error, not random scatter.
// Blast radius is the extent along that line (>=6 systemic, 2-5 bounded, 1 point). Inventing a
// second set of shape names would let the prose and the panel describe one picture differently.
//
// LLM-FREE, AND THAT IS A DESIGN CHOICE RATHER THAN A LIMITATION. Every sentence is assembled
// deterministically from the classifier's own fields, so the story is re-runnable and cannot
// hallucinate a shape the pixels do not have. The model on the right elaborates; it never narrates
// the receipt. THE RECEIPT IS LLM-FREE is the rule this obeys.
//
// @guard tests/vna/story.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { computeFrame } from './frame.mjs';
import { computeCycle, fullName } from './envelope.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const GREEKS = resolve(REPO, 'src/data/commit-greeks-index.json');
const SPEC = process.env.VNA_SPEC || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
const LANE = ['Strategy', 'Tactics', 'Operations', 'Strategy.Law', 'Strategy.Goal', 'Strategy.Fund',
  'Tactics.Speed', 'Tactics.Deal', 'Tactics.Signal', 'Operations.Grid', 'Operations.Loop', 'Operations.Flow'];
const AXL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const laneName = (i) => (i >= 0 && i < 12) ? `${AXL[i]}.${LANE[i]}` : `lane ${i}`;
const blockOf = (c) => { const m = /^([A-C])([1-3])?,([A-C])([1-3])?$/.exec(String(c || '').trim());
  return m ? ['ABC'.indexOf(m[1]) * 3 + (m[2] ? +m[2] - 1 : 1), 'ABC'.indexOf(m[3]) * 3 + (m[4] ? +m[4] - 1 : 1)] : null; };
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

// ── ACT ONE: the shape in ONE frame ─────────────────────────────────────────
export function oneFrame(frame) {
  const L = [];
  if (frame.refused) {
    // A refusal is a sentence, not a blank. Absence of a shape and a clean shape are opposite claims.
    L.push(`This commit has no readable shape: ${frame.refusal}`);
    L.push(`That is not "no drift" — it is too little mass to say anything, and the two are opposite claims.`);
    return L;
  }
  const p = frame.pattern, R = p.region, t = frame.tol;
  const diag = p.greenDiag, off = p.greenOff, tot = diag + off || 1;
  const diagPct = Math.round(100 * diag / tot);

  L.push(`The frame is ${t.green} green, ${t.amber} amber, ${t.red} red — ${t.offPct}% off-lane.`);

  // The diagonal ratio is the single most legible thing in the picture: it says whether what was
  // declared and what was done occupy the SAME lane, or merely compatible ones.
  if (diagPct >= 40) L.push(`Green sits mostly ON the diagonal (${diagPct}%): what was said and what was done occupy the same lane.`);
  else if (diag === 0) L.push(`No green on the diagonal at all: nothing was done in the lane it was declared in, though ${off} cells still landed in tolerated neighbours.`);
  else L.push(`Green sits mostly OFF the diagonal (${diag} on, ${off} off): the work is adjacent to its declaration rather than inside it.`);

  if (R.motif === 'none') {
    L.push(`No drift line fired, so the picture has no motif to read — the shape is a carpet, not a streak.`);
  } else {
    const inv = R.invariant;
    if (R.motif === 'diagonal') L.push(`The drift is DIAGONAL: actor and target are the same lane. This is self-reference — the work is acting on its own territory.`);
    else if (R.motif === 'horizontal') L.push(`The drift is HORIZONTAL, held at ${laneName(inv.lane)}: one actor sprayed across many targets. The invariant is WHO is acting.`);
    else if (R.motif === 'vertical') L.push(`The drift is VERTICAL, held at ${laneName(inv.lane)}: one target hit from many directions. The invariant is WHAT is being hit.`);
    else L.push(`The drift is OFF-DIAGONAL by ${inv.k} lanes: everything landed a constant ${Math.abs(inv.k)} lanes from where it was declared. That is a systematic aim error, not scatter — scatter has no constant.`);

    L.push(`It runs ${R.spread} lane${R.spread === 1 ? '' : 's'} — ${R.blastRadius === 'systemic' ? 'systemic, streaking across the lattice' : R.blastRadius === 'bounded' ? 'bounded to a few lanes' : 'a single point'}.`);
    if (R.direction === 'bottom-up') L.push(`It reaches UP: execution moved into a higher-abstraction lane it never declared. That direction is the expensive one.`);
    else if (R.direction === 'top-down') L.push(`It reaches DOWN, from intent into execution — the ordinary direction of work.`);
    if (R.severity !== 'none') L.push(`Severity ${R.severity} (${R.macroDist} macro tier${R.macroDist === 1 ? '' : 's'} crossed).`);
  }
  return L;
}

// ── ACT TWO: how the shape MOVES ────────────────────────────────────────────
// The frame is a photograph; this is the film. Movement is the part a single panel cannot show and
// the part the operator actually steers on.
export function movement({ limit = 20 } = {}) {
  if (!existsSync(GREEKS)) return { rows: [], story: ['No commit index, so no movement can be read.'] };
  const g = JSON.parse(readFileSync(GREEKS, 'utf8'));
  const rows = Object.entries(g)
    .map(([sha, v]) => ({ sha: sha.slice(0, 9), coord: v.coord, ts: v.ts ? new Date(v.ts).getTime() : 0, sigma: v.sigma, off: v.toleranceOffPct }))
    .filter((c) => c.coord && c.ts && blockOf(c.coord))
    .sort((a, b) => a.ts - b.ts).slice(-limit)
    .map((c) => ({ ...c, block: blockOf(c.coord) }));
  if (rows.length < 3) return { rows, story: [`Only ${rows.length} placed commit(s) in range — too few to read a movement.`] };

  const L = [];
  const com = (arr) => [arr.reduce((s, r) => s + r.block[0], 0) / arr.length, arr.reduce((s, r) => s + r.block[1], 0) / arr.length];
  const half = Math.floor(rows.length / 2);
  const early = com(rows.slice(0, half)), late = com(rows.slice(half));
  const moved = cheb(early.map(Math.round), late.map(Math.round));

  L.push(`Across the last ${rows.length} placed commits, the centre of mass moved from ${laneName(Math.round(early[0]))} × ${laneName(Math.round(early[1]))} to ${laneName(Math.round(late[0]))} × ${laneName(Math.round(late[1]))} — ${moved} block${moved === 1 ? '' : 's'}.`);
  if (moved === 0) L.push(`It has not moved. The work is holding one territory, which is concentration if it is deliberate and a rut if it is not.`);
  else if (moved >= 4) L.push(`That is a large migration: the work is in a different part of the lattice than it started in.`);

  // Is the picture settling or spreading? Dispersion around the centre answers it.
  const disp = (arr, c) => arr.reduce((s, r) => s + cheb(r.block, c.map(Math.round)), 0) / arr.length;
  const dE = disp(rows.slice(0, half), early), dL = disp(rows.slice(half), late);
  const dd = +(dL - dE).toFixed(2);
  if (dd < -0.5) L.push(`Spread is FALLING (${dE.toFixed(1)} → ${dL.toFixed(1)} blocks): the work is converging. This is the water sticking to the net.`);
  else if (dd > 0.5) L.push(`Spread is RISING (${dE.toFixed(1)} → ${dL.toFixed(1)} blocks): the work is fanning out, covering more territory per commit.`);
  else L.push(`Spread is flat (${dE.toFixed(1)} → ${dL.toFixed(1)} blocks): the shape is stable, neither converging nor fanning.`);

  // A repeated coordinate is a lane the work keeps returning to — the strongest single signal here.
  const counts = {};
  for (const r of rows) counts[r.coord] = (counts[r.coord] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 1) L.push(`The work returned to ${fullName(top[0])} ${top[1]} times — the lane with the strongest pull in this window.`);

  const offs = rows.map((r) => r.off).filter((x) => Number.isFinite(x));
  if (offs.length >= 4) {
    const eo = offs.slice(0, Math.floor(offs.length / 2)), lo = offs.slice(Math.floor(offs.length / 2));
    const m = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const d = m(lo) - m(eo);
    L.push(`Off-lane percentage ${d < -2 ? 'fell' : d > 2 ? 'rose' : 'held'} across the window (${m(eo).toFixed(0)}% → ${m(lo).toFixed(0)}%).`);
  }
  return { rows, story: L, movedBlocks: moved, dispersionDelta: dd };
}

// ── ACT THREE: what it means for the work ───────────────────────────────────
// The simplest possible forest-for-the-trees: what is declared and not done, and what is drifting.
export function meaning(cycle) {
  const L = [];
  L.push(`${cycle.confident.length} declared item${cycle.confident.length === 1 ? '' : 's'} placed confidently; ${cycle.abstained.length} could not be placed and were NOT guessed at.`);
  if (cycle.pull != null) L.push(`Recent work sits ${cycle.pull} blocks from the nearest declaration on average.`);
  if (cycle.unworked.length) {
    L.push(`Declared but untouched (${cycle.unworked.length}):`);
    for (const u of cycle.unworked.slice(0, 6)) L.push(`   ☐ ${u.id} — ${u.text.slice(0, 72)}`);
  } else L.push(`Nothing declared is untouched — every confidently-placed item has work near it.`);
  if (cycle.moveDecl) {
    L.push(`Drifting: the work keeps landing at ${fullName(cycle.moveDecl.coord)}, which the spec never declared (${cycle.moveDecl.n} commit${cycle.moveDecl.n === 1 ? '' : 's'}${cycle.moveDecl.repeated ? ', repeated — a signal' : ', once — possibly noise'}).`);
  } else L.push(`Nothing is drifting outside the declaration.`);
  return L;
}

async function main() {
  const argv = process.argv.slice(2);
  const sha = argv.includes('--commit') ? argv[argv.indexOf('--commit') + 1] : 'HEAD';
  const limit = Number(process.env.VNA_LIMIT || 20);
  const frame = await computeFrame({ sha, repo: REPO });
  const mv = movement({ limit });
  const cycle = computeCycle({ md: readFileSync(SPEC, 'utf8'), limit });

  const out = [];
  out.push(`THE SHAPE — commit ${frame.sha} · ${frame.ms}ms · LLM-free`);
  out.push(`${frame.subject.slice(0, 90)}`);
  out.push('');
  out.push('── ONE FRAME ' + '─'.repeat(54));
  for (const l of oneFrame(frame)) out.push('  ' + l);
  out.push('');
  out.push('── HOW IT MOVES ' + '─'.repeat(51));
  for (const l of mv.story) out.push('  ' + l);
  out.push('');
  out.push('── WHAT IT MEANS FOR THE WORK ' + '─'.repeat(37));
  for (const l of meaning(cycle)) out.push('  ' + l);

  const text = out.join('\n');
  console.log(text);
  mkdirSync(resolve(REPO, 'data/vna'), { recursive: true });
  writeFileSync(resolve(REPO, 'data/vna/story.txt'), text);
  writeFileSync(resolve(REPO, 'data/vna/story.json'), JSON.stringify({
    at: new Date().toISOString(), sha: frame.sha, subject: frame.subject,
    frame: { refused: frame.refused, refusal: frame.refusal, tol: frame.tol && !frame.refused ? { green: frame.tol.green, amber: frame.tol.amber, red: frame.tol.red, offPct: frame.tol.offPct } : null, region: frame.pattern?.region || null },
    movement: { movedBlocks: mv.movedBlocks ?? null, dispersionDelta: mv.dispersionDelta ?? null, n: mv.rows.length },
    meaning: { confident: cycle.confident.length, abstained: cycle.abstained.length, pull: cycle.pull,
      unworked: cycle.unworked.map((u) => u.id), driftCoord: cycle.moveDecl?.coord || null },
    acts: { oneFrame: oneFrame(frame), movement: mv.story, meaning: meaning(cycle) },
  }, null, 2));
  console.log(`\nreceipt → data/vna/story.json · text → data/vna/story.txt`);
  if (argv.includes('--copy')) { try { execFileSync('pbcopy', { input: text }); console.log('opened on the clipboard for the chat on the right'); } catch {} }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
