// scripts/vna/goal-accounting.mjs — C295 /steer STEERS THE GOAL: the goal-unit accounting on every /steer close line.
// (operator 2026-09-25, verbatim: "lets write /steer to work with /steergoal even better - more ambitously keep goal working and
// steer checking off open asks" · "goal is greedy, steer defaults to the spec / tesseract").
//
// A READER of receipts that already exist — goal.mjs goalStatus (the units and which are done), spec-clarity.mjs classifySpec (every
// open row, every class), the tree render's `## PENDING` (released asks, not yet rows) — never a second registry, never a model.
// It answers three things for the close line, and the line says each even when the answer is none:
//   · which goal units closed (this run, when the caller hands `before` — the unit numbers done before the dispatch; else so far)
//   · which open asks NO unit covers — every open row of any class plus every pending id, by id — to be folded into the goal as
//     new units (goal.mjs set), never dropped
//   · the /steergoal file the goal was set from (goal.json `source`, written by `goal.mjs set --source`, C294)
// Its own module (not steer.mjs or steergoal.mjs) so steer.mjs, steer-until.mjs and steergoal.mjs all import it without a cycle.
//
// @guard tests/vna/steer-skill-steers-the-goal.test.mjs
import { classifySpec } from './spec-clarity.mjs';

// the `## PENDING — released asks, not yet rows` section of SPEC-FROM-TREE.md (spec-tree.mjs renderPending), one id per line
export function parsePending(md) {
  const out = []; let inSec = false;
  for (const L of String(md || '').split('\n')) {
    if (/^## /.test(L)) { inSec = /^## PENDING\b/.test(L); continue; }
    if (!inSec) continue;
    const m = /^- \[ \] (P\d+\.\d+)\s+(.*)$/.exec(L); if (!m) continue;
    const basin = /· basin (C\d+[a-z]?\d*)/.exec(m[2]);
    out.push({ id: m[1], headline: m[2].split(' · ')[0].trim(), basin: basin ? basin[1] : null });
  }
  return out;
}

export function goalAccounting({ status, md = '', pendingMd = null, source = null, before = null } = {}) {
  if (!status) return { goal: false, closed: [], uncovered: [], source: null, line: 'goal: no goal on the record — /steergoal first' };
  const labels = new Set(status.units.flatMap((u) => u.labels));
  const closed = status.units.filter((u) => u.done && !(before && before.has(u.n))).map((u) => u.labels.join('+'));
  const open = classifySpec(md).rows.map((r) => r.id);
  const pending = parsePending(pendingMd).map((p) => p.id);
  const uncovered = [...open.filter((id) => !labels.has(id)), ...pending.filter((id) => !labels.has(id))];
  const src = source || status.source || null;
  const line = `goal units closed${before ? ' this run' : ''} ${closed.length}/${status.units.length}${closed.length ? ` (${closed.join(' ')})` : ''} · uncovered ${uncovered.length}${uncovered.length ? `: ${uncovered.join(' ')} — fold them in: goal.mjs set` : ''} · steergoal: ${src || 'none — the goal was not set from /steergoal'}`;
  return { goal: true, closed, uncovered, source: src, line };
}
