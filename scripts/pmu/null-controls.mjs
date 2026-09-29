// scripts/pmu/null-controls.mjs
//
// THE NULL CONTROLS, IN ONE PLACE, EACH TAGGED WITH THE STAGE IT ATTACKS.
//
// A null is only as strong as the thing it destroys. Until now every null in the
// walk-significance path was POST-SENSOR: we sensed the real corpus, got a 144×144
// lit-cell grid, and then shuffled the lit positions. That control answers exactly
// one question — "does the WALK amplify lattice topology, or would any grid of the
// same density walk the same way?" — and it is blind to the sensor. If gzip-NCD were
// gripping nothing but bag-of-words statistics, the post-sensor shuffle would never
// notice, because it never touches the text the sensor read.
//
// The WORD-SALAD null is UPSTREAM (pre-sensor). It holds the bag fixed and destroys
// only the ORDER: same claims, same whitespace-delimited tokens, same token
// frequencies, byte-identical total length, positions permuted. That text is then
// pushed through the UNCHANGED sense+walk path. So the pair reads:
//
//   post-sensor (shuffled-grid) : is the WALK doing work on top of the grid?
//   pre-sensor  (word-salad)    : is the SENSOR reading ORDER, or only the bag?
//
// A third null lives in scripts/pmu/pmu-study-harness.mjs (Arm 3, "dead reef" —
// the reef's anchors deterministically permuted across coordinates). That one is a
// different harness with a different unit of measure and is not registered here;
// it is named so nobody re-derives it as missing.
//
// Every generator here is SEEDED and deterministic: a null you cannot re-run is not
// a control, it is an anecdote.

/** Deterministic PRNG (mulberry32). Same seed → same stream, on every machine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Split text into alternating [word, gap, word, gap, …] chunks.
 * The WORD chunks are the whitespace-delimited tokens (punctuation stays attached to
 * its token — that is what keeps the character count exact under permutation).
 * The GAP chunks are the runs of whitespace, and they NEVER move: line breaks and
 * indentation stay exactly where they were, so only word ORDER is destroyed.
 */
export function splitWords(text) {
  const parts = String(text).split(/(\s+)/);
  const words = [], gaps = [], isWordSlot = [];
  for (const p of parts) {
    if (p === '') continue;
    const gap = /^\s+$/.test(p);
    isWordSlot.push(!gap);
    (gap ? gaps : words).push(p);
  }
  return { parts: parts.filter((p) => p !== ''), words, gaps, isWordSlot };
}

/** In-place Fisher-Yates with a seeded rng. */
export function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * WORD SALAD — permute the word tokens of `text`, leaving whitespace runs in place.
 * INVARIANTS (all guarded in tests/pmu-simulator/word-salad-null.test.mjs):
 *   · the multiset of word tokens is IDENTICAL (same vocabulary, same frequencies)
 *   · String(out).length === String(text).length  (exactly, not approximately)
 *   · the whitespace skeleton is byte-identical
 *   · only the ORDER changed
 */
export function wordSalad(text, rnd) {
  const { parts, isWordSlot } = splitWords(text);
  const words = parts.filter((_, i) => isWordSlot[i]);
  shuffleInPlace(words, rnd);
  let w = 0;
  return parts.map((p, i) => (isWordSlot[i] ? words[w++] : p)).join('');
}

/**
 * Salad a corpus of claims.
 *   scope 'claim'  — each claim is permuted WITHIN itself. Every claim keeps its own
 *                    length and its own bag; only intra-claim order dies. This is the
 *                    TIGHTER null and the default: the corpus still has the same
 *                    number of claims of the same sizes made of the same words.
 *   scope 'corpus' — the whole corpus is one bag; words migrate between claims. Claim
 *                    lengths are preserved (words are refilled slot-by-slot) but claim
 *                    identity is destroyed too. A looser, strictly-more-destructive null.
 */
export function saladClaims(claims, rnd, scope = 'claim') {
  if (scope === 'claim') return claims.map((c) => wordSalad(c, rnd));
  if (scope !== 'corpus') throw new Error(`saladClaims: unknown scope "${scope}"`);
  const split = claims.map((c) => splitWords(c));
  const pool = [];
  for (const s of split) for (let i = 0; i < s.parts.length; i++) if (s.isWordSlot[i]) pool.push(s.parts[i]);
  shuffleInPlace(pool, rnd);
  let w = 0;
  return split.map((s) => s.parts.map((p, i) => (s.isWordSlot[i] ? pool[w++] : p)).join(''));
}

/**
 * SHUFFLED GRID — the pre-existing post-sensor null, moved here so the two controls
 * sit side by side. Same popcount (same density), random positions, topology destroyed.
 * Takes and returns cell bits: it runs AFTER the sensor and is re-walked, never re-sensed.
 */
export function shuffleGridBits(bits, rnd) {
  let lit = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i]) lit++;
  const out = new Uint8Array(bits.length);
  const chosen = new Set();
  while (chosen.size < lit) chosen.add((rnd() * bits.length) | 0);
  for (const c of chosen) out[c] = 1;
  return out;
}

/**
 * THE REGISTRY. `stage` is the load-bearing field: a 'pre-sensor' null hands back
 * CLAIM TEXT that the caller MUST push through the unchanged sensor before walking;
 * a 'post-sensor' null hands back CELL BITS that go straight to the walk. Anything
 * that mutates the sense or walk path itself is not a null, it is a different system.
 */
export const NULL_CONTROLS = {
  'shuffled-grid': {
    stage: 'post-sensor',
    unit: 'cell-bits',
    preserves: 'density (popcount)',
    destroys: 'lattice topology (which cells are lit)',
    question: 'does the walk amplify real topology, or would any grid of this density do?',
    apply: (bits, rnd) => shuffleGridBits(bits, rnd),
  },
  'word-salad': {
    stage: 'pre-sensor',
    unit: 'claim-text',
    preserves: 'length, vocabulary, token frequencies, whitespace skeleton',
    destroys: 'word order',
    question: 'does the sensor read ORDER, or only the bag of words?',
    apply: (claims, rnd, scope = 'claim') => saladClaims(claims, rnd, scope),
  },
};
