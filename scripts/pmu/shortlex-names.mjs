// scripts/pmu/shortlex-names.mjs — the canonical ShortLex axis → CATEGORY-NAME translation (LLM-FREE).
// ============================================================================================
// Operator 2026-07-05: "dig out the full 3-levels-deep ShortLex translation of what a1 etc means — b3,a4
// needs their category names." coordGist returned nothing and the registry semantics were all empty, so a
// coordinate on the encircled map had no name. This is the decidable translator: a fixed, canonical map,
// no model.
//   • Depth 1 (A,B,C) and depth 2 (A1..C3) are CANONICAL — the tesseract axis names in CLAUDE.md.
//   • Depth 3 (A1A..C3N, 132 children) have concept-dumps but no clean names yet (shortlex-registry
//     "phase 2 fills them via the GDD loop"). Until then they render as "<parent name>·<child>" — honest,
//     never fabricated. Fill data/pmu/shortlex-144-registry.json semantics to name them.
// Guarded by tests/pmu-simulator/shortlex-names.test.mjs.
const L1 = { A: 'Strategy', B: 'Tactics', C: 'Operations' };
const L2 = {
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};

// a single ShortLex axis label → its category name (A1 → "Strategy.Law", A1A → "Strategy.Law·A")
export function axisName(label) {
  const s = String(label || '').trim().toUpperCase();
  if (L1[s]) return L1[s];
  if (L2[s]) return L2[s];
  const m = s.match(/^([A-C][1-3])([A-Z])$/);        // depth-3: parent + child letter
  if (m && L2[m[1]]) return `${L2[m[1]]}·${m[2]}`;    // systematic child descriptor until GDD-named
  return s;                                            // unknown/malformed → the raw label, never invented
}

// the 3rd-level WORD per cell — compression-picked from the snippet corpus (scripts/pmu/anchor-words.mjs).
// This is the PROVENANCE token: it makes the coordinate name mean something concrete instead of a code.
let WORDS = {};
try {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  WORDS = JSON.parse(readFileSync(resolve(here, '..', '..', 'data/pmu/shortlex-words.json'), 'utf8'));
} catch { WORDS = {}; }

// the compression-picked intersection word for a coord's CENTER cell (e.g. "A1,A1" → "regulation")
export function anchorWord(coord) {
  const center = String(coord || '').split('▸')[0].trim();
  return WORDS[center] || '';
}

// a coord → "actor × patient · <intersection word>" — the readable name of its CENTER, provenance-complete
export function coordName(coord) {
  const center = String(coord || '').split('▸')[0].trim();
  const parts = center.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return '';
  const rn = axisName(parts[0]);
  const cn = parts[1] ? axisName(parts[1]) : '';
  const base = cn ? `${rn} × ${cn}` : rn;              // row = actor, col = patient
  const word = anchorWord(center);                     // the compression-picked 3rd-level intersection word
  return word ? `${base} · ${word}` : base;
}

// ── THE HATS (operator 2026-08-06: "write out the names of the hats … it may mean we need to add
// name to the hats / rules and write them out — maximise for grip") ──────────────────────────────
// A hat is the ROLE a coordinate puts you in: row = the hat you wear (actor), col = the domain you
// act on (patient). These 12 role-nouns are the canonical, fixed, LLM-free hat names for the
// tesseract axes — one per axis, emoji from the tesseract submission format. A bare "C,A1" is
// opaque; "Operator×Counsel" is a handhold. Distinct from the 9 room personas (different namespace).
const HAT = {
  A: 'Strategist', B: 'Tactician', C: 'Operator',
  A1: 'Counsel', A2: 'Aim-Setter', A3: 'Treasurer',
  B1: 'Pacesetter', B2: 'Dealmaker', B3: 'Herald',
  C1: 'Gridkeeper', C2: 'Loopkeeper', C3: 'Flowkeeper',
};
const HAT_EMOJI = {
  A: '🏛️', B: '⚡', C: '🔧',
  A1: '⚖️', A2: '🎯', A3: '💰',
  B1: '🏎️', B2: '🤝', B3: '📡',
  C1: '🔌', C2: '🔄', C3: '🌊',
};

// a single axis label → its hat role-noun (C1 → "Gridkeeper"; depth-3 C1A → "Gridkeeper·A" — the
// finest-grained named category we have, honest about the unnamed child, never invented)
export function hatRole(label) {
  const s = String(label || '').trim().toUpperCase();
  if (HAT[s]) return HAT[s];
  const m = s.match(/^([A-C][1-3])([A-Z])$/);
  if (m && HAT[m[1]]) return `${HAT[m[1]]}·${m[2]}`;
  return s;
}

export function hatEmoji(label) {
  const s = String(label || '').trim().toUpperCase();
  if (HAT_EMOJI[s]) return HAT_EMOJI[s];
  const m = s.match(/^([A-C][1-3])([A-Z])$/);
  return (m && HAT_EMOJI[m[1]]) || '';
}

// a coord's WORN HAT: "C,A1" → "Operator×Counsel" (actor role × patient role); "C,C" → "Operator"
// (the pure hat — acting on your own domain IS staying in role). Span coords name their CENTER.
export function hatName(coord) {
  const center = String(coord || '').split('▸')[0].trim();
  const [r, c] = center.split(',').map((x) => x.trim()).filter(Boolean);
  if (!r) return '';
  const rr = hatRole(r), cc = c ? hatRole(c) : '';
  return cc && cc !== rr ? `${rr}×${cc}` : rr;
}

export const CANONICAL = { L1, L2 };
export const HATS = { roles: HAT, emoji: HAT_EMOJI };
