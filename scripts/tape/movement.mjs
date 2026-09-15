// packages/thetacog-mcp/scripts/tape/movement.mjs — HOW FAR DID THAT QUESTION LET US MOVE?
//
// Operator, 2026-08-20, supplying the half of the metric I could not compute:
//   "If we have to propose 3 coordinates we're not doing it right, because the most constraining
//    question solves many things at once — which updates the requirements and the investigation
//    document, and that allows multiple agents to be fired, meaning you can move pretty far if you
//    have the right kind of question. And you can REVERSE it: you find the right kind of question by
//    HOW FAR YOU CAN MOVE based on it, how much it constrained the space."
//
// ── WHY MY EARLIER METRIC COULD NOT WORK ──────────────────────────────────────────────────────
// next-question.mjs scores candidates BEFORE they are answered: spread of the answers' placements
// times predicted cone reduction. That is a forecast, and it failed its own calibration twice —
// first because the sensor was blind (answers placed in isolation land in the same cell), then
// because spread drowned reduction. The deeper problem is that a question's value is not knowable in
// advance. It is knowable AFTERWARDS, from what it unlocked.
//
// So this is the POST-HOC measurement, and the loop is: ask → apply → MEASURE THE MOVEMENT → use the
// movement to learn what a good question looks like. The metric trains on its own history rather than
// being tuned by hand, which is what a metric tuned by hand always turns out to need.
//
// ── THE THREE-COORDINATE TELL ─────────────────────────────────────────────────────────────────
// "If we have to propose 3 coordinates we're not doing it right." A question that needs several
// coordinates to express one decision was too small — it was asking about an implementation branch
// rather than a region of the space. So COORDINATES-PER-QUESTION is an inverse quality signal, and it
// is the cheapest one available: 1 is the target, 3 is a warning that the altitude was wrong.
//
// ── WHAT MOVEMENT IS, MEASURED FROM RECEIPTS THAT ALREADY EXIST ───────────────────────────────
// Nothing here is a new instrument. Every term is read off a ledger the loop already writes:
//   coordinatesLocked   coordinates.ndjson    — 1 is right; 3+ means the question was too small
//   agentsFired         dispatches.ndjson     — how many work orders the answer authorised at once
//   commitsLanded       dispatches[].commits  — what actually got built from it
//   surfacesClaimed     coordinate.owns[]     — how much of the repo the answer brought into scope
//   coneDelta           cone(before) - cone(after) — did the space actually contract
//   enforcementOffPct   the closing arrow     — did the built thing land where the answer said
//
// MOVEMENT = commitsLanded + agentsFired + surfacesClaimed, penalised by coordinatesPerQuestion.
// Deliberately crude and deliberately COUNTABLE — a weighted composite would be a number nobody can
// argue with, and the point is that the operator should be able to argue with it.
//
//   node packages/thetacog-mcp/scripts/tape/movement.mjs [--slug s] [--json]

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const nd = (slug, f) => {
  const p = resolve(SESSIONS, slug, f);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

/** Group the ledgers by the question (steer) that produced them. */
export function movementByQuestion(slug) {
  const coords = nd(slug, 'coordinates.ndjson');
  const disp = nd(slug, 'dispatches.ndjson');
  const orders = nd(slug, 'work-orders.ndjson');

  // live coordinates only, and keyed by the steer/provenance they came from — that IS the question
  const live = new Map();
  for (const c of coords) if (c?.id) live.set(c.id, c);

  const byQuestion = new Map();
  for (const c of live.values()) {
    if (c.status === 'retired') continue;
    const q = (c.steer || c.provenance || '(no question recorded — locked directly)').slice(0, 160);
    if (!byQuestion.has(q)) byQuestion.set(q, { question: q, coordinates: [], agentsFired: 0, commitsLanded: 0, surfaces: new Set(), enforcement: [] });
    const g = byQuestion.get(q);
    g.coordinates.push(c);
    for (const o of (c.owns || [])) if (o.kind === 'code') g.surfaces.add(o.file);
  }

  // attribute dispatches + commits to the question via the coordinate they cite
  const coordToQuestion = new Map();
  for (const [q, g] of byQuestion) for (const c of g.coordinates) coordToQuestion.set(c.id, q);
  for (const d of [...disp, ...orders]) {
    const cid = d.coordinateId || d.atomId;
    const q = coordToQuestion.get(cid);
    if (!q) continue;
    const g = byQuestion.get(q);
    g.agentsFired += Number(d.agents || 0);
    g.commitsLanded += (d.commits || []).length;
    for (const e of (d.enforcement || [])) if (Number.isFinite(e?.offPct)) g.enforcement.push(e.offPct);
  }

  return [...byQuestion.values()].map((g) => {
    const coordinatesLocked = g.coordinates.length;
    const surfacesClaimed = g.surfaces.size;
    // THE THREE-COORDINATE TELL: one coordinate per question is the target. The penalty is the
    // reciprocal, so 1 -> 1.0, 2 -> 0.5, 3 -> 0.33 — a question needing three is worth a third.
    const altitudePenalty = +(1 / Math.max(1, coordinatesLocked)).toFixed(3);
    const raw = g.commitsLanded + g.agentsFired + surfacesClaimed;
    return {
      question: g.question,
      coordinatesLocked, agentsFired: g.agentsFired, commitsLanded: g.commitsLanded, surfacesClaimed,
      enforcementOffPct: g.enforcement.length ? +(g.enforcement.reduce((a, b) => a + b, 0) / g.enforcement.length).toFixed(1) : null,
      altitudePenalty,
      movement: +(raw * altitudePenalty).toFixed(2),
      verdict: coordinatesLocked >= 3
        ? 'TOO SMALL — needed 3+ coordinates to say one thing; the question was an implementation branch, not a region'
        : raw === 0
          ? 'UNSPENT — the answer was locked but nothing was fired from it, so its value is UNMEASURED, not zero'
          : 'MOVED',
      coordinateIds: g.coordinates.map((c) => c.id),
    };
  }).sort((a, b) => b.movement - a.movement);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const rows = movementByQuestion(slug);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

  console.log(`\n  HOW FAR DID EACH QUESTION LET US MOVE · ${slug}`);
  console.log(`  movement = (commits + agents + surfaces) / coordinates-per-question`);
  console.log(`  one coordinate per question is the target; three means the altitude was wrong.\n`);
  if (!rows.length) { console.log('  no coordinates locked yet — nothing to measure\n'); process.exit(0); }
  for (const r of rows) {
    console.log(`  ${String(r.movement).padStart(6)}  ${r.verdict.split(' —')[0].padEnd(10)} coords ${r.coordinatesLocked} · agents ${r.agentsFired} · commits ${r.commitsLanded} · surfaces ${r.surfacesClaimed}${r.enforcementOffPct !== null ? ` · offPct ${r.enforcementOffPct}` : ''}`);
    console.log(`          ${r.question.slice(0, 92)}`);
    if (r.coordinatesLocked >= 3) console.log(`          ⚠ ${r.verdict}`);
    console.log('');
  }
  const spent = rows.filter((r) => r.movement > 0);
  console.log(`  ${spent.length}/${rows.length} questions actually moved anything.`);
  console.log(`  A question that locks a coordinate and fires nothing is UNSPENT — not bad, just not yet cashed.\n`);
}
