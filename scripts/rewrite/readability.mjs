// scripts/rewrite/readability.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE READABILITY & TELEMETRY LAYER — proving the writing actually got better.
//
// Three independent rulers, deliberately not collapsed into one score. They
// disagree, and the disagreements are informative:
//
//   1. TRADITIONAL   Flesch-Kincaid + Flesch Reading Ease + character entropy.
//      Recognizable, cheap, and honestly limited — it counts syllables, not
//      meaning. A sentence can score beautifully and still be incomprehensible.
//      It is here as the familiar baseline, not as the verdict.
//
//   2. TESSERACT     gzip-NCD mass and the lattice walk. Measures semantic
//      placement, which is the thing FK cannot see.
//
//   3. COGNITIVE FRICTION  the reader's own comprehension scores from the
//      monologue pass. This is the only ruler measuring the thing we actually
//      care about — whether a human follows it. The line graph flattening as
//      edits land IS the proof the tool works.
//
// All of this is deterministic and LLM-free except #3, whose inputs come from the
// diagnostic pass that already ran.
// ════════════════════════════════════════════════════════════════════════════

import zlib from 'node:zlib';

/** Syllable estimate — heuristic, standard for FK, good enough at corpus scale. */
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function tokenize(text) {
  const clean = String(text || '')
    .replace(/[*_`>#\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const sentences = clean.split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim().length > 1);
  return { clean, words, sentences };
}

/** Shannon entropy over characters, in bits/char. Slop is low-entropy filler. */
export function charEntropy(text) {
  const s = String(text || '');
  if (!s.length) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return +h.toFixed(4);
}

/** gzip mass — the compression-based information measure Tesseract uses. */
export function gzipMass(text) {
  const buf = Buffer.from(String(text || ''), 'utf8');
  if (!buf.length) return { bytes: 0, gzipped: 0, ratio: 0 };
  const gz = zlib.gzipSync(buf, { level: 9 }).length;
  return { bytes: buf.length, gzipped: gz, ratio: +(gz / buf.length).toFixed(4) };
}

/**
 * Full readability profile for a chunk of prose.
 * `fleschReadingEase`: higher = easier (0-100+). `fkGrade`: US grade level.
 */
export function readability(text) {
  const { words, sentences } = tokenize(text);
  const nWords = words.length;
  const nSentences = Math.max(1, sentences.length);
  const nSyllables = words.reduce((a, w) => a + syllables(w), 0);

  const wordsPerSentence = nWords / nSentences;
  const syllablesPerWord = nWords ? nSyllables / nWords : 0;

  const fleschReadingEase = nWords
    ? +(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord).toFixed(2)
    : null;
  const fkGrade = nWords
    ? +(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59).toFixed(2)
    : null;

  // Long words (3+ syllables) — the density that makes technical prose heavy.
  const polysyllables = words.filter((w) => syllables(w) >= 3).length;

  return {
    words: nWords,
    sentences: nSentences,
    wordsPerSentence: +wordsPerSentence.toFixed(2),
    syllablesPerWord: +syllablesPerWord.toFixed(3),
    polysyllablePct: nWords ? +(polysyllables / nWords * 100).toFixed(1) : 0,
    fleschReadingEase,
    fkGrade,
    charEntropy: charEntropy(text),
    gzip: gzipMass(text),
  };
}

/**
 * Before/after delta for one edit. Positive `easeDelta` = easier to read;
 * negative `gradeDelta` = lower required grade level. Both are what we want.
 */
export function readabilityDelta(before, after) {
  const b = readability(before);
  const a = readability(after);
  return {
    before: b,
    after: a,
    easeDelta: b.fleschReadingEase != null && a.fleschReadingEase != null
      ? +(a.fleschReadingEase - b.fleschReadingEase).toFixed(2) : null,
    gradeDelta: b.fkGrade != null && a.fkGrade != null
      ? +(a.fkGrade - b.fkGrade).toFixed(2) : null,
    entropyDelta: +(a.charEntropy - b.charEntropy).toFixed(4),
    gzipRatioDelta: +(a.gzip.ratio - b.gzip.ratio).toFixed(4),
    wordsDelta: a.words - b.words,
    // The headline: did this edit make the sentence easier without inflating it?
    improved: (a.fleschReadingEase ?? 0) > (b.fleschReadingEase ?? 0) && a.words <= b.words * 1.35,
  };
}

/**
 * COGNITIVE FRICTION SCORE across the document.
 * Input: the session's `scanned` map (paragraphIndex → {minScore, sentences}).
 * Output: the running series the UI plots. As edits land and paragraphs are
 * re-scanned, the curve should rise toward 100 and flatten — that flattening is
 * the claim "the writing got measurably easier to follow", made falsifiable.
 */
export function frictionSeries(scanned, edits = []) {
  const rows = Object.entries(scanned || {})
    .map(([i, r]) => ({ paragraph: Number(i), score: r?.minScore ?? null, startLine: r?.startLine ?? null }))
    .filter((r) => typeof r.score === 'number')
    .sort((a, b) => a.paragraph - b.paragraph);

  if (!rows.length) return { series: [], mean: null, cold: 0, editedLines: [] };

  const mean = +(rows.reduce((a, r) => a + r.score, 0) / rows.length).toFixed(1);
  // Trailing average smooths the per-paragraph noise into a readable trend.
  const W = 5;
  let acc = 0;
  const series = rows.map((r, i) => {
    acc += r.score;
    if (i >= W) acc -= rows[i - W].score;
    return { ...r, trailing: +(acc / Math.min(i + 1, W)).toFixed(1) };
  });

  return {
    series,
    mean,
    cold: rows.filter((r) => r.score < 80).length,
    total: rows.length,
    editedLines: edits.map((e) => e.line),
  };
}

/** Aggregate readability across the whole ledger — the "is it working" number. */
export function ledgerReadability(rows) {
  const accepted = rows.filter((r) => r.kind === 'accept' && r.chosen && r.original && r.winner !== 'ORIGINAL');
  if (!accepted.length) return { n: 0 };

  let easeSum = 0, gradeSum = 0, improvedCount = 0, n = 0;
  const byTrack = {};
  for (const r of accepted) {
    const d = readabilityDelta(r.original, r.chosen);
    if (d.easeDelta == null) continue;
    n++;
    easeSum += d.easeDelta;
    gradeSum += d.gradeDelta ?? 0;
    if (d.improved) improvedCount++;
    const t = r.winner || 'UNKNOWN';
    byTrack[t] = byTrack[t] || { n: 0, ease: 0, grade: 0, improved: 0 };
    byTrack[t].n++;
    byTrack[t].ease += d.easeDelta;
    byTrack[t].grade += d.gradeDelta ?? 0;
    if (d.improved) byTrack[t].improved++;
  }

  for (const t of Object.values(byTrack)) {
    t.avgEaseDelta = +(t.ease / t.n).toFixed(2);
    t.avgGradeDelta = +(t.grade / t.n).toFixed(2);
    t.improvedPct = +(t.improved / t.n * 100).toFixed(1);
  }

  return {
    n,
    avgEaseDelta: +(easeSum / n).toFixed(2),
    avgGradeDelta: +(gradeSum / n).toFixed(2),
    improvedPct: +(improvedCount / n * 100).toFixed(1),
    byTrack,
  };
}
