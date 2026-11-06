// src/app/pmu-simulator/signature.mjs
//
// HARDWARE-NATIVE SEMANTIC COMPRESSION — the on-chip-shaped comparator.
//
// gzip/NCD is the verified comparator, but it cannot run on the chip:
// DEFLATE is LZ77 + Huffman — sequential, stateful, dictionary-based.
// It has no combinational form, so it fails the S≡P≡H principle (the
// semantic op and the hardware op must be the SAME op). gzip therefore
// is not the chip's comparator — it is the ORACLE the chip approximates.
//
// THE SPLIT this module implements:
//
//   · INGEST (off-chip, once per commit) — text → a fixed K-bit
//     signature, by SimHash. This is the only "compression"; it is
//     software, off the ballistic path.
//
//   · BALLISTIC (on-chip, combinational) — distance IS the XOR gate,
//     widened from 1 bit to K:
//
//         distance(a,b) = popcount( sig(a) XOR sig(b) )
//
//     XOR and popcount are combinational (AC0). LSH theory: the Hamming
//     distance of two SimHash signatures is an unbiased estimator of
//     the content distance — it tracks NCD up to a constant.
//
// k_E — THE ENTROPIC DRIFT QUANTUM. That constant is k_E: one mismatched
// signature bit is one quantum of semantic loss; the quanta count is
//     n = popcount / k_E   (= total measured loss / bits-per-quantum).
//
// gzip/NCD stays as the ORACLE — signature.test.mjs proves the popcount
// distance tracks gzip-NCD; if it drifts, the signature width K is wrong.
//
// Pure ESM — BigInt only, zero dependencies. The chip will implement
// exactly this: a hash at ingest, an XOR-popcount tree per comparison.

// ── canonical parameters (configurable, NOT hardcoded physics) ───────
export const SIG_BITS = 64;          // signature width K — wider K, tighter NCD estimate
export const K_E = 1;                // entropic drift quantum — bits per quantum of loss
export const SIG_MISS = 0.30;        // normalized-distance threshold: drift (bit 1) at/above
export const SHINGLE_N = 4;          // char-level n-gram size — robust for prose AND code

// ── FNV-1a, 64-bit, seeded — deterministic string → BigInt ───────────
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

function fnv1a(str, seed) {
  let h = (FNV_OFFSET ^ seed) & MASK64;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

function isEmpty(text) { return !text || text.trim().length === 0; }

// ── shingles — text → char-level n-gram features ─────────────────────
// Char n-grams (not word tokens) so the same hasher works on prose and
// on source code, and small edits move only a few features.
export function shingles(text, n = SHINGLE_N) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length === 0) return [];
  if (t.length <= n) return [t];
  const out = [];
  for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n));
  return out;
}

// ── STOPWORDS — generic English + code-structural noise ──────────────
// Domain classification fails if the signature is a democracy of every
// word: a step has ~12 words, only 2-3 are domain-bearing, and SimHash's
// ±1 voting lets the 9 noise words outvote them. These carry no domain:
// English function words, and the trace-structural tokens every step
// shares (editFile, bash, src, ts, …). Stripped before shingling.
export const STOPWORDS = new Set([
  'the', 'to', 'a', 'an', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'is', 'it', 'its',
  'as', 'by', 'be', 'with', 'from', 'into', 'that', 'this', 'then', 'how', 'every', 'all',
  'i', 're', 'so', 'up', 'out', 'add', 'added', 'adding', 'change', 'changed', 'check',
  'review', 'trace', 'confirm', 'inspect', 'print', 'printed', 'before', 'after', 'diff',
  'usage', 'usages', 'run', 'running', 'new', 'old',
  'editfile', 'readfile', 'writefile', 'bash', 'grep', 'npm', 'npx', 'yarn', 'node',
  'src', 'lib', 'dist', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'file', 'files',
]);

// ── wordShingles — word-level features (unigrams + bigrams) ──────────
// For classifying text by DOMAIN, word overlap is the signal and char
// n-grams only add noise — "jwt" fragmented into "jwt." picks up cross-
// domain collisions. Unigrams carry the domain; bigrams add a little
// order. Stopwords are stripped so only domain words vote. Pass this as
// the shingler to simhash for classification.
export function wordShingles(text, stop = STOPWORDS) {
  const words = (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .split(/\s+/).filter((w) => w && !stop.has(w));
  if (words.length === 0) return [];
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

// ── simhash — the INGEST step: text → a K-bit signature (BigInt) ─────
// Each feature votes ±1 on every signature bit; the sign of the vote
// sum is the bit. Similar texts share features → share votes → share
// bits. For K > 64 each feature contributes ⌈K/64⌉ seeded hashes. The
// shingler is pluggable — char n-grams (default, for NCD-tracking
// drift) or wordShingles (for domain classification).
export function simhash(text, bits = SIG_BITS, shingler = shingles) {
  const feats = shingler(text);
  if (feats.length === 0) return 0n;                 // empty → the zero signature
  const words = Math.ceil(bits / 64);
  const acc = new Array(bits).fill(0);
  for (const f of feats) {
    for (let w = 0; w < words; w++) {
      const h = fnv1a(f, BigInt(w + 1));
      for (let b = 0; b < 64 && w * 64 + b < bits; b++) {
        acc[w * 64 + b] += ((h >> BigInt(b)) & 1n) === 1n ? 1 : -1;
      }
    }
  }
  let sig = 0n;
  for (let i = 0; i < bits; i++) if (acc[i] > 0) sig |= (1n << BigInt(i));
  return sig;
}

// ── popcount / hamming — the BALLISTIC step (combinational) ──────────
export function popcount(value) {
  let n = value < 0n ? -value : value;
  let c = 0;
  while (n > 0n) { c += Number(n & 1n); n >>= 1n; }
  return c;
}

// the on-chip gate: XOR two signatures, popcount the result
export function hamming(sigA, sigB) {
  return popcount(sigA ^ sigB);
}

// ── signatureDistance — normalized [0,1] semantic distance ───────────
export function signatureDistance(textA, textB, bits = SIG_BITS) {
  return hamming(simhash(textA, bits), simhash(textB, bits)) / bits;
}

// ── quanta — n = total measured loss / k_E ───────────────────────────
// The raw popcount IS the measured loss; k_E converts it to quanta.
export function quanta(textA, textB, bits = SIG_BITS, kE = K_E) {
  return hamming(simhash(textA, bits), simhash(textB, bits)) / kE;
}

// ── signatureDelta — the full on-chip comparison record ──────────────
// The signature-path analogue of cell-compress.classifyCell: intent
// text + reality text → the drift bit, plus the raw measurements. The
// empty-side drift modes are settled by presence (a zero signature is
// an empty side), mirroring classifyNcd; the both-present case is the
// XOR-popcount distance against SIG_MISS.
export function signatureDelta(intentText, realityText, opts = {}) {
  const bits = opts.bits ?? SIG_BITS;
  const kE = opts.kE ?? K_E;
  const threshold = opts.threshold ?? SIG_MISS;
  const intentEmpty = isEmpty(intentText);
  const realityEmpty = isEmpty(realityText);
  if (intentEmpty && realityEmpty)
    return { bit: 0, state: 'COOL_EMPTY', hamming: 0, distance: 0, quanta: 0 };
  if (realityEmpty)
    return { bit: 1, state: 'MISS_INTENT_HEAVY', hamming: null, distance: 1, quanta: bits / kE };
  if (intentEmpty)
    return { bit: 1, state: 'MISS_REALITY_HEAVY', hamming: null, distance: 1, quanta: bits / kE };
  const sigI = simhash(intentText, bits);
  const sigR = simhash(realityText, bits);
  const ham = hamming(sigI, sigR);
  const distance = ham / bits;
  return {
    bit: distance >= threshold ? 1 : 0,
    state: distance >= threshold ? 'MISS_CONTRADICTION' : 'HIT',
    hamming: ham,
    distance,
    quanta: ham / kE,
  };
}

// ── signatureBit — just the drift bit (the chip's one-bit output) ────
export function signatureBit(intentText, realityText, opts = {}) {
  return signatureDelta(intentText, realityText, opts).bit;
}
