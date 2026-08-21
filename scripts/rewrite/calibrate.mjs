#!/usr/bin/env node
// scripts/rewrite/calibrate.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE CALIBRATION GUARD — keeps the Tesseract claim honest.
//
// Feeds four KNOWN cases through the drift measurement and reports what it can
// and cannot tell apart:
//
//   no-op     the identical sentence           → must read as IDENTICAL
//   synonym   trivial word swaps               → must read as near-identical
//   genuine   a real, meaning-preserving fix   → should move
//   nonsense  deliberate word salad            → should move
//
// The whole point is the last two. If `genuine` and `nonsense` overlap, the
// metric measures displacement and not quality — and anything in the UI that
// implies otherwise is a lie. Run this whenever thetacog-mcp changes.
//
//   node scripts/rewrite/calibrate.mjs [--file <path>] [--n 6] [--json]
//
// `--scale window` measures over the fitted aperture instead of the paragraph.
// That experiment has been run (n=16): tripling the mass did NOT restore
// discrimination and broke the synonym control 5/16 times. The limit is what the
// sensor reads (vocabulary concentration), not how much it is fed.
//
// Exit 1 only if the CONTROLS break (no-op must be 100, synonym must be ≥95).
// Overlap between genuine and nonsense is REPORTED, never fatal — it is the
// current known state of the world, not a regression.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { extractProse, spliceRange, sentenceWindow } from './chunker.mjs';
import * as tess from './tesseract.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes('--json');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const FILE = arg('--file');
if (!FILE) { console.error('✗ calibrate needs --file <a prose file to calibrate against>'); process.exit(2); }
const N = parseInt(arg('--n', '6'), 10);

const NONSENSE = 'Purple bicycles enumerate the quarterly banana futures of Tuesday.';
const GENUINE = 'Rebuild the system without ever taking it offline.';

const avail = await tess.isAvailable();
if (!avail.available) {
  console.error(`✗ tesseract unavailable at ${avail.root}: ${avail.error}`);
  process.exit(JSON_OUT ? 0 : 1);
}

const raw = fs.readFileSync(FILE, 'utf8');
const { paragraphs } = extractProse(raw, { filename: FILE });
const targets = paragraphs.filter((p) => p.sentences.length >= 3).slice(0, N);

// ── SCALE ─────────────────────────────────────────────────────────────────
// `--scale window` measures over the FITTED APERTURE (five sentences either side,
// widened until it carries ≥700 chars) instead of the single paragraph.
//
// This is the experiment that matters for the lattice claim. Sentence-scale drift
// provably cannot separate a genuine rewrite from nonsense, and the stated cause is
// structural: MIN_GZIP_BYTES ≈ 220, and one sentence inside one paragraph lacks the
// mass for a stable ballistic walk. If that diagnosis is right, then giving the walk
// a properly-sized window should restore discrimination. If discrimination is STILL
// absent with adequate mass, the problem is not mass and the claim needs rethinking.
// Either answer is worth having; only the guess is not.
const SCALE = arg('--scale', 'paragraph');

const rows = [];
for (const p of targets) {
  const s = p.sentences[1];
  // Paragraph-relative offsets only. (Joining paragraphs with '\n\n' does NOT
  // reproduce the source's original spacing, so a "wide window" splice computed
  // from absolute offsets lands in the wrong place — that bug is why this only
  // ever measures at paragraph scope.)
  // Base text = the paragraph, or the fitted aperture window when --scale window.
  let baseStart = p.start;
  let baseText = p.text;
  if (SCALE === 'window') {
    const sw = sentenceWindow(paragraphs, p.index, 1);
    if (!sw) { rows.push({ paragraph: p.index, error: 'no window' }); continue; }
    baseStart = sw.start;
    baseText = raw.slice(sw.start, sw.end);
  }
  const relStart = s.start - baseStart;
  const relEnd = s.end - baseStart;
  if (baseText.slice(relStart, relEnd) !== s.text) {
    rows.push({ paragraph: p.index, error: 'offset mismatch' });
    continue;
  }

  const orig = await tess.place(baseText);
  if (!orig || orig.error) { rows.push({ paragraph: p.index, error: orig?.error || 'place failed' }); continue; }

  const cases = {
    noop: s.text,
    synonym: s.text.replace(/\bthe\b/g, 'that').replace(/\bis\b/g, 'remains'),
    genuine: GENUINE,
    nonsense: NONSENSE,
  };

  const row = { paragraph: p.index, chars: baseText.length, line: p.startLine };
  for (const [name, txt] of Object.entries(cases)) {
    const d = await tess.drift(orig, spliceRange(baseText, relStart, relEnd, txt));
    row[name] = d ? { coverage: d.coverage, bleed: d.weightedBleed, spread: d.deltaSpread, verdict: d.verdict } : null;
  }
  rows.push(row);
}

const ok = rows.filter((r) => !r.error && r.noop && r.synonym);
const noopBad = ok.filter((r) => r.noop.coverage !== 100);
const synBad = ok.filter((r) => r.synonym.coverage < 95);
const overlap = ok.filter((r) => r.genuine && r.nonsense && r.nonsense.coverage >= r.genuine.coverage);

const summary = {
  file: path.relative(REPO, FILE),
  scale: SCALE,
  sampled: ok.length,
  controls: {
    noopStable: noopBad.length === 0,
    synonymStable: synBad.length === 0,
  },
  discrimination: {
    nonsenseScoredEqualOrBetter: overlap.length,
    of: ok.length,
    discriminatesQuality: overlap.length === 0,
  },
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log(`\nTESSERACT DRIFT CALIBRATION — ${summary.file}  [scale: ${SCALE}]\n${'─'.repeat(72)}`);
  console.log('para  chars  no-op      synonym    genuine    nonsense');
  for (const r of rows) {
    if (r.error) { console.log(`${String(r.paragraph).padEnd(6)}${'—'.padEnd(7)}${r.error}`); continue; }
    const f = (c) => c ? `${String(c.coverage).padStart(3)}/${String(c.bleed).slice(0, 5).padEnd(6)}` : '  —    ';
    console.log(`${String(r.paragraph).padEnd(6)}${String(r.chars).padEnd(7)}${f(r.noop)} ${f(r.synonym)} ${f(r.genuine)} ${f(r.nonsense)}`);
  }
  console.log(`${'─'.repeat(72)}`);
  console.log(`CONTROLS    no-op stable: ${summary.controls.noopStable ? '✓' : '✗'}   synonym stable: ${summary.controls.synonymStable ? '✓' : '✗'}`);
  console.log(`DISCRIMINATION  nonsense scored ≥ genuine in ${overlap.length}/${ok.length} samples`);
  console.log(overlap.length
    ? `  ⇒ drift measures DISPLACEMENT, not quality. Do not gate candidates on it.\n`
    : `  ⇒ drift separated genuine from nonsense on every sample — re-examine the claim.\n`);
}

// Only the controls are fatal. Loss of discrimination is the documented status quo.
process.exit(noopBad.length || synBad.length ? 1 : 0);
