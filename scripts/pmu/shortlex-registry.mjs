#!/usr/bin/env node
// scripts/pmu/shortlex-registry.mjs — THE TRUE THREE-LENGTH SHORTLEX AXIS (operator, Jun 11).
//
// The 144-long axis becomes a real ShortLex enumeration — shorter prefixes ALWAYS before longer:
//   positions   0–2   = A, B, C                        (length-1, the 3 parents)
//   positions   3–11  = A1, A2, A3, B1, B2, B3, C1–C3  (length-2, the 9 axes)
//   positions  12–143 = the 132 length-3 children       (A1A … C3N)
//
// THE NAMING LAW (operator): NO separator characters. The symbol class ALTERNATES by depth —
// A (letter) → A1 (digit) → A1A (letter; the first child of A1) → A1B … C3N — and the
// alternation IS the separator: a class flip marks a component boundary, so every name parses
// unambiguously without dots. (A1.1 was the phase-1 placeholder spelling; it is retired.)
//
// 132 does NOT divide evenly by 9 (14.67) — the allocation is DATA-DRIVEN: it lives in the
// registry file (data/pmu/shortlex-144-registry.json) and the operator may rebalance it there;
// this generator re-reads an existing allocation and rebuilds the 144 entries deterministically.
// Default: A1..B3 get 15 children each (6×15=90), C1..C3 get 14 each (3×14=42) = 132.
//
// Visual consequence (the operator's verification method): the 144×144 diagonal shows THREE
// NESTED ZONES — a 3×3 square top-left (almost a dot), the 9×9 next (diagonal ends at pixel 12),
// then the 132×132 crystal lattice. Only then do we know the algorithm is applied properly, and
// only then can reach-then-verify recurse in three steps.
//
//   node scripts/pmu/shortlex-registry.mjs        # (re)build the registry, print zone boundaries
//
// @canonical-algorithm  three-length ShortLex enumeration 3|9|132 with data-driven child allocation; never shorter-after-longer, by construction + self-check
// @forbidden-alternative  the 12×12 outer-product PAIR labeling as the axis NAMES (pairs stay the CELL semantics, not the axis) · hardcoded zone boundaries anywhere downstream (compute from this registry)
// @guard  tests/pmu-simulator/shortlex-registry.test.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
export const REGISTRY_PATH = resolve(REPO, 'data/pmu/shortlex-144-registry.json');

export const PARENTS_1 = ['A', 'B', 'C'];
export const PARENTS_2 = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
// DEFAULT child allocation — 132 length-3 children across the 9 length-2 parents.
// 132/9 = 14.67, so it cannot be uniform; the operator may rebalance in the registry file.
export const DEFAULT_ALLOCATION = { A1: 15, A2: 15, A3: 15, B1: 15, B2: 15, B3: 15, C1: 14, C2: 14, C3: 14 };

// ── ShortLex comparison on names ──────────────────────────────────────────────
// Length = number of components (A=1 · A1=2 · A1G=3), NEVER character count. There is NO
// separator character: components are maximal same-class runs (letters | digits) and the
// class flip between runs IS the boundary. Shorter ALWAYS before longer; within a length,
// component-wise — digit runs compare NUMERICALLY (A2 < A10), letter runs lexically.
const components = (name) =>
  (String(name).match(/[A-Za-z]+|[0-9]+/g) || []).map((run) => (/^[0-9]/.test(run) ? Number(run) : run));
export function shortlexCompare(a, b) {
  const ca = components(a), cb = components(b);
  if (ca.length !== cb.length) return ca.length - cb.length;        // shorter first, always
  for (let i = 0; i < ca.length; i++) {
    if (ca[i] === cb[i]) continue;
    if (typeof ca[i] === 'number' && typeof cb[i] === 'number') return ca[i] - cb[i];
    return String(ca[i]) < String(cb[i]) ? -1 : 1;
  }
  return 0;
}

// ── build the 144 entries (deterministic; self-checked) ───────────────────────
export function buildRegistry(allocation = DEFAULT_ALLOCATION) {
  const total = PARENTS_2.reduce((s, p) => s + (allocation[p] || 0), 0);
  if (total !== 132) throw new Error(`allocation must sum to 132 length-3 children (got ${total})`);
  const entries = [];
  for (const name of PARENTS_1) entries.push({ index: entries.length, name, parent: null, depth: 1, semantic: '' });
  for (const name of PARENTS_2) entries.push({ index: entries.length, name, parent: name.slice(0, 1), depth: 2, semantic: '' });
  for (const parent of PARENTS_2) {
    for (let n = 1; n <= allocation[parent]; n++) {
      // Child n of A1 is A1A, A1B, … — a LETTER, because the parent ends in a digit and the
      // alternating symbol class is the separator. Allocation max is 15 (≤26), so one letter.
      entries.push({ index: entries.length, name: `${parent}${String.fromCharCode(0x40 + n)}`, parent, depth: 3, semantic: '' });
    }
  }
  // SELF-CHECK: 144 entries, never shorter-after-longer, strict ShortLex ascent.
  if (entries.length !== 144) throw new Error(`registry must hold 144 entries (got ${entries.length})`);
  for (let i = 1; i < entries.length; i++) {
    if (shortlexCompare(entries[i - 1].name, entries[i].name) >= 0) {
      throw new Error(`ShortLex order violated at ${i}: ${entries[i - 1].name} !< ${entries[i].name}`);
    }
  }
  return {
    _comment: 'The three-length ShortLex axis: 3 (A,B,C) | 9 (A1..C3) | 132 children (A1A..C3N). NAMING LAW: no separator chars — the symbol class alternates by depth (letter, digit, letter) and the alternation IS the separator. Child allocation is DATA-DRIVEN — 132 does not divide by 9 (14.67); the operator may rebalance the `allocation` map and re-run scripts/pmu/shortlex-registry.mjs. `semantic` fields are EMPTY in phase 1; phase 2 fills them via the GDD loop with perturbation-probe checks before/after.',
    version: 1,
    allocation,
    entries,
  };
}

// ── zone boundaries, computed FROM the registry (never hardcoded downstream) ──
// major: the diagonal nesting seams x=y=3 (end of length-1) and x=y=12 (end of length-2).
// childStarts: within [12,144), each length-2 parent's child-block start (12, 27, 42, …).
export function zoneBoundaries(registry) {
  const e = registry.entries;
  const firstDepth = (d) => e.findIndex(x => x.depth === d);
  const major = [firstDepth(2), firstDepth(3)];                     // [3, 12]
  const childStarts = [];
  let prevParent = null;
  for (const x of e) {
    if (x.depth !== 3) continue;
    if (x.parent !== prevParent) { childStarts.push(x.index); prevParent = x.parent; }
  }
  return { major, childStarts };
}

// ── load (file if present, else built) — render code calls this ───────────────
export function loadRegistry() {
  if (existsSync(REGISTRY_PATH)) {
    try { return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')); } catch { /* fall through */ }
  }
  return buildRegistry();
}

// ── CLI: (re)build deterministically, preserve an operator-rebalanced allocation ─
// AND preserve phase-2 `semantic` naming (operator 2026-07-06, incident same day: this script has
// no wiring into any hook/controller stage, but a re-run — by hand, or by a concurrent session
// investigating the same file in parallel — used to silently WIPE every semantic word
// scripts/pmu/shortlex-name-children.mjs had written, because buildRegistry() always starts every
// entry at semantic: ''. Phase 1 (structure) and phase 2 (naming) are separate concerns; regenerating
// the structure must never regress the naming. Merge by `name`, not by array index — the allocation
// can rebalance which parent owns how many children, which shifts array positions.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let allocation = DEFAULT_ALLOCATION;
  let prevSemanticByName = new Map();
  if (existsSync(REGISTRY_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
      const keysOk = prev.allocation && PARENTS_2.every(p => Number.isInteger(prev.allocation[p]));
      const sum = keysOk ? PARENTS_2.reduce((s, p) => s + prev.allocation[p], 0) : 0;
      if (sum === 132) allocation = prev.allocation;                // operator rebalance survives regeneration
      for (const e of (prev.entries || [])) if (e && e.name && e.semantic) prevSemanticByName.set(e.name, e.semantic);
    } catch { /* keep default */ }
  }
  const reg = buildRegistry(allocation);
  let restored = 0;
  for (const e of reg.entries) {
    const prevWord = prevSemanticByName.get(e.name);
    if (prevWord) { e.semantic = prevWord; restored++; }
  }
  if (restored > 0) console.log(`preserved ${restored} existing semantic word(s) from the prior registry (phase 2 survives regeneration)`);
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
  const z = zoneBoundaries(reg);
  console.log(`shortlex-144-registry written → ${REGISTRY_PATH}`);
  console.log(`zones: |0,${z.major[0]}) length-1 · [${z.major[0]},${z.major[1]}) length-2 · [${z.major[1]},144) length-3`);
  console.log(`child-block starts: ${z.childStarts.join(', ')}`);
  console.log(`allocation: ${PARENTS_2.map(p => `${p}=${reg.allocation[p]}`).join(' ')}`);
}
