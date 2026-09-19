#!/usr/bin/env node
// scripts/pmu/rule-trigger-anchors.mjs — DUAL-ANCHOR RULE RETRIEVAL (operator 2026-08-01)
//
// The 2026-08-01 grading pass proved recall, not coverage, is the lens bottleneck: every
// zero-rule high-drift family mapped to a rule that already existed — placed where its CONTENT
// compresses, unreachable from where the SITUATIONS it governs land ("Measure, don't assert"
// seeded at the C,C magnet; NEVER-FORK and DELEGATE-TO-SUBTASKS dropped by the 240ch cap).
//
// The fix: rules keep their content-cell AND gain TRIGGER ANCHORS at the pixels where they're
// needed. Source of truth = data/pmu/rule-trigger-anchors.json (curated + learned); this module
// turns it into extra lens_rules rows (src='trigger') that seedRules RE-APPLIES on every reseed
// — lens_rules is derived (DELETE'd each reseed), so anchors must never be hand-INSERTed there.
// This is the knock-on child-shelf mechanism extended from templates to rules: the when-bag
// grows from measured misses, the parent rulebook is never mutated.
//
//   --learn   propose learned anchors from the trajectory spine: (rule, pixel) pairs served
//             together with a commit outcome ≥ MIN_SEEN times, where the rule's home cell
//             differs from the serving pixel. Appends src:'learned' entries (dedup'd).
//
// Guard: tests/pmu-simulator/retrieval-regression.test.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ANCHORS_FILE = resolve(REPO, 'data/pmu/rule-trigger-anchors.json');
const SPINE = process.env.TRAJECTORY_OUT || resolve(REPO, '.thetacog/trajectory.ndjson');
const MIN_SEEN = 3;

export function loadAnchors(file = ANCHORS_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { version: 1, anchors: [] }; }
}

// → rows for seedRules: one lens_rules row per (anchor, coord), src='trigger'.
// toBlock = shortLexToBlock passed in by the caller (avoids a circular import with prompt-lens).
export function anchorRows({ toBlock, file = ANCHORS_FILE } = {}) {
  const out = [];
  for (const a of loadAnchors(file).anchors || []) {
    if (a.needsFullText) continue;   // learned proposal still carrying its 40ch key — not seedable yet
    const rule = String(a.rule || '').slice(0, 240);
    if (rule.length < 30) continue;
    for (const coord of a.coords || []) {
      let br = 0, bc = 0;
      try { ({ br, bc } = toBlock(coord)); } catch { continue; }
      // per-anchor weight (2026-08-06, A/B-lab finding): the per-block trigger admission takes the
      // top TWO by weight — four 1.0-tied anchors at B,A1 meant the safety-critical hooks-off anchor
      // lost the tie to two voice anchors and never entered the injection. Safety anchors declare
      // weight > 1.0 in the anchors file; default stays 1.0.
      out.push({ coord, br, bc, rule: rule.replace(/'/g, "''"), weight: Number(a.weight) || 1.0, src: 'trigger' });
    }
  }
  return out;
}

// --learn: mine the spine for (ruleKey, pixel) pairs that repeatedly served with outcomes.
export function learnAnchors({ spine = SPINE, file = ANCHORS_FILE, minSeen = MIN_SEEN } = {}) {
  if (!existsSync(spine)) return { proposed: 0, reason: `no spine at ${spine}` };
  const rows = readFileSync(spine, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const seen = new Map();   // `${key}|${pixel}` → { n, rule }
  for (const r of rows) {
    if (!r.pixel || !r.outcome || r.outcome.commits === 0) continue;
    for (const key of r.rules || []) {
      const k = `${key}|${r.pixel}`;
      seen.set(k, { n: (seen.get(k)?.n || 0) + 1, key, pixel: r.pixel });
    }
  }
  const store = loadAnchors(file);
  const have = new Set((store.anchors || []).flatMap((a) => (a.coords || []).map((c) => `${a.rule.slice(0, 40)}|${c}`)));
  let proposed = 0;
  for (const { n, key, pixel } of seen.values()) {
    if (n < minSeen) continue;
    if (have.has(`${key}|${pixel}`)) continue;
    store.anchors.push({ rule: key, coords: [pixel], src: 'learned', why: `spine: served with outcome ${n}x at ${pixel}`, added: new Date().toISOString().slice(0, 10), needsFullText: true });
    have.add(`${key}|${pixel}`); proposed++;
  }
  if (proposed) writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
  return { proposed, total: store.anchors.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--learn')) {
    const r = learnAnchors();
    console.log(`learned anchors proposed: ${r.proposed}${r.reason ? ` (${r.reason})` : ''} · total ${r.total ?? '?'}`);
    if (r.proposed) console.log('NOTE: learned entries carry needsFullText:true — replace the 40ch key with the full rule text (≤240ch) before they seed.');
  } else {
    const rows = anchorRows({ toBlock: (c) => ({ br: 0, bc: 0 }) });
    console.log(`${rows.length} anchor rows from ${ANCHORS_FILE.replace(REPO + '/', '')} (coords unverified in this preview)`);
  }
}
