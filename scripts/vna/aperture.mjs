#!/usr/bin/env node
// scripts/vna/aperture.mjs — MATCH THE APERTURE BEFORE THE CRUNCH, AND SHOW EVERY DOCUMENT IT USED.
//
// Operator: "the aperture in the rust pipeline is the trick … /steer must be extremely correct in
// which documents are chosen as inputs … it must be debuggable what each step is looking at for the
// tesseract crunching (ncd and on chip)."
//
// THE MEASUREMENT THAT MAKES THIS NECESSARY. On the last six commits the cockpit fed the chip an
// INTENT of 84–2798 bytes against a REALITY of 4001–60560 — ratios of 12.7×, 18.4×, 25×, 47.6×,
// 62.5× and 80.4×. gzip-NCD only measures MEANING when both sides are the same size-order; at 80:1
// it measures LENGTH. Every panel rendered from that pair was reading length noise, which is exactly
// why rings came out as ellipses spanning 92% of the lattice: there was no localized signal to find.
// The pipeline already had the words for this — its own admissibility check prints "READING IS
// LENGTH-DOMINATED, not drift" — but it only compared INTENT against an absolute floor, never intent
// against REALITY.
//
// CUT THE EYE, NEVER GROW THE MASS. This is settled and it was settled the expensive way
// (packages/thetacog-mcp/scripts/tape/physics.mjs, measured 2026-08-20): growing the short side by
// repeating its own text does not add gzip mass, because gzip dedupes the repetition — a 130-char
// rule repeated to 430 chars still compressed to 96 bytes against the 220 floor. Repetition adds
// LENGTH, not ENTROPY. So the larger side is CUT to the smaller side's size-order.
//
// PROPORTIONAL ACROSS DOCUMENTS, NEVER FIRST-N. Truncating the file list would let a 16-file commit
// be judged by whichever four files git happened to list first — the same defect one level up. Each
// document gets a share of the budget proportional to its own size, so a commit is represented by
// all of what it touched.
//
// EVERY ROW IS PRINTED. path · raw bytes · used bytes · share · why it was cut. That is the
// debuggable half: what the chip looked at is a list you can read, not an inference from a panel.
//
// @guard tests/vna/aperture.test.mjs
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';   // THE ONE resolver — honours PMU_BINARY, one canonical search (spec v2 Task 2)
import { fileURLToPath } from 'node:url';

// The phantom-mass floor thetacog-mcp's tape enforces. Below it a reading is length, not meaning,
// and this module says so rather than returning a number that looks like a measurement.
export const MIN_GZIP_BYTES = 220;
const gz = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;

// ── THE CHIP IS THE DEFAULT DOOR ────────────────────────────────────────────
// This decision is upstream of everything: sense() can only measure what it is handed, so the corpus
// cut determines every number downstream of it. It belongs on the chip with the rest of the
// decisions, and `pmu-onchip --aperture` is where it now runs.
//
// PARITY IS PROVEN, NOT ASSUMED. The Rust side computes gzip through the vendored Chromium zlib fork
// (lens::node_gzip_len), so a mass computed there equals node:zlib's byte-for-byte — and both sides
// count in UTF-8 BYTES. That last part was a real defect: JS String.length counts UTF-16 code units
// and Rust str::len() counts bytes, so before the fix the same commit gave 7.64:1 in node and 7.79:1
// on the chip and the two picked different windows. Measured after: identical corpora, identical
// rows, identical masses.
//
// THE FALLBACK SAYS IT FELL BACK. A silent JS fallback would make the architecture claim unfalsifiable
// — every run would look on-chip whether or not the binary was there. `engine` names the substrate
// that actually ran, and the surfaces print it.
const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const CHIP = process.env.PMU_ONCHIP || resolvePmuBinary(REPO);

// WHERE THE WINDOW IS CUT MATTERS AS MUCH AS ITS SIZE, and taking the head is the worst choice
// available in this repo. Every source file here opens with a long comment block in the same register
// — so a head-slice of fourteen files is fourteen near-identical headers, which gzip sees as one
// repeated document. Measured the first time this shipped: the reality side came back with ZERO
// significant cells and the panel correctly refused on the lit-mass floor. Matched mass, worthless
// content: the aperture was the right size and pointed at the boilerplate.
//
// So the window is CHOSEN, not defaulted: slide a few candidate windows across the document and keep
// the one with the highest entropy DENSITY (gzip bytes per raw byte). That is the other half of
// "cut the eye" — the eye moves, it does not just narrow — and it uses the same instrument the
// placement uses, so the selection and the measurement agree about what information is.
// EVERYTHING HERE IS COUNTED IN UTF-8 BYTES, and that is a portability decision, not a detail. This
// module has a twin on the chip (`pmu-onchip --aperture`), and JS `String.length` counts UTF-16 code
// units while Rust `str::len()` counts bytes — so the two implementations disagreed the moment an
// em-dash appeared, and this repo is made of em-dashes. Measured before the fix: the same commit
// gave 7.64:1 in node and 7.79:1 on the chip, and the two picked different windows. Bytes on both
// sides is the only unit under which "the migration is provable" means anything.
const bytes = (s) => Buffer.from(String(s ?? ''), 'utf8');
// Trim to a char boundary the way the Rust side does: a UTF-8 continuation byte is 10xxxxxx.
function sliceBytes(buf, at, budget) {
  let start = Math.min(at, buf.length);
  while (start > 0 && (buf[start] & 0xC0) === 0x80) start -= 1;
  let end = Math.min(start + budget, buf.length);
  while (end > start && end < buf.length && (buf[end] & 0xC0) === 0x80) end -= 1;
  return buf.subarray(start, end).toString('utf8');
}

// Returns {text, start, end} — start/end are BYTE offsets into `text` as handed in (post
// boundary-trim), mirroring the Rust side's pick_window so a receipt can name exactly which span
// of a document's reality text fed the walk (C115z). The Rust and node windows must agree byte-for
// -byte, including the offsets, or the parity guard (tests/vna/aperture.test.mjs) catches it.
function pickWindow(text, budget, { candidates = 6 } = {}) {
  const buf = bytes(text);
  if (buf.length <= budget) return { text, start: 0, end: buf.length };
  const span = buf.length - budget;
  const step = Math.max(1, Math.floor(span / (candidates - 1)));
  let best = '', bestStart = 0, bestEnd = 0, bestDensity = -1;
  for (let i = 0; i < candidates; i++) {
    const at = Math.min(span, i * step);
    const w = sliceBytes(buf, at, budget);
    if (!w.length) continue;
    const d = gz(w) / Math.max(1, bytes(w).length);
    if (d > bestDensity) {
      bestDensity = d; best = w;
      // Recompute the trimmed bounds sliceBytes actually used, the same char-boundary walk it did.
      let start = Math.min(at, buf.length);
      while (start > 0 && (buf[start] & 0xC0) === 0x80) start -= 1;
      let end = Math.min(start + budget, buf.length);
      while (end > start && end < buf.length && (buf[end] & 0xC0) === 0x80) end -= 1;
      bestStart = start; bestEnd = end;
    }
  }
  if (!best) { const w0 = sliceBytes(buf, 0, budget); return { text: w0, start: 0, end: bytes(w0).length }; }
  return { text: best, start: bestStart, end: bestEnd };
}

// A document is {path, text}. The intent side is usually one (the commit message); the reality side
// is the changed files. Both are treated identically — the matching is symmetric by construction.
export function matchAperture(intentDocs, realityDocs, { tolerance = 1.25, engine = 'auto' } = {}) {
  if (engine !== 'node' && existsSync(CHIP)) {
    try {
      const out = execFileSync(CHIP, ['--aperture'], {
        input: JSON.stringify({ intent: intentDocs, reality: realityDocs, tolerance }),
        maxBuffer: 1 << 26, timeout: 30000,
      }).toString();
      const parsed = JSON.parse(out);
      if (parsed && typeof parsed.intent === 'string' && Array.isArray(parsed.rows)) return parsed;
    } catch { /* fall through to node, and SAY so in `engine` below */ }
  }
  return matchApertureNode(intentDocs, realityDocs, { tolerance });
}

export function matchApertureNode(intentDocs, realityDocs, { tolerance = 1.25 } = {}) {
  const sum = (docs) => docs.reduce((s, d) => s + bytes(d.text).length, 0);
  const iRaw = sum(intentDocs), rRaw = sum(realityDocs);
  const rows = [];

  // The budget is the SMALLER side, times a tolerance. Not 1.00: an exact match would cut the larger
  // side to the byte and buy nothing over the same size-order, and gzip-NCD is stable within a
  // small factor. 1.25 is named here so it is one number in one place rather than a feel.
  const target = Math.max(1, Math.min(iRaw, rRaw)) * tolerance;

  const cut = (docs, side, raw) => {
    const out = [];
    for (const d of docs) {
      const text = d.text || '';
      const len = bytes(text).length;
      // Proportional share, floored so a small file is never cut to nothing — a document reduced to
      // zero bytes is a document that was silently excluded.
      const share = raw > 0 ? len / raw : 0;
      const budget = raw <= target ? len : Math.max(200, Math.floor(target * share));
      const { text: used, start: usedStart, end: usedEnd } = pickWindow(text, budget);
      const usedLen = bytes(used).length;
      const chunkSha = createHash('sha256').update(bytes(used)).digest('hex');
      out.push(used);
      rows.push({ side, path: d.path, rawBytes: len, usedBytes: usedLen,
        sharePct: Math.round(1000 * share) / 10, truncated: usedLen < len,
        usedStart, usedEnd, chunkSha });
    }
    return out.join('\n');
  };

  const intent = cut(intentDocs, 'intent', iRaw);
  const reality = cut(realityDocs, 'reality', rRaw);
  const iGz = gz(intent), rGz = gz(reality);
  const iLen = bytes(intent).length, rLen = bytes(reality).length;
  const usedRatio = Math.round((100 * Math.max(iLen, rLen)) / Math.max(1, Math.min(iLen, rLen))) / 100;

  // TWO SEPARATE VERDICTS, NEVER MERGED. `matched` is about the RATIO — are the two sides the same
  // size-order. `admissible` is about the FLOOR — does each side carry enough entropy to be read at
  // all. A pair can be perfectly matched and still be two tiny strings, which is matched noise.
  const matched = usedRatio <= tolerance * 1.6;
  const admissible = iGz >= MIN_GZIP_BYTES && rGz >= MIN_GZIP_BYTES;
  return {
    engine: 'node-aperture',
    intent, reality, rows,
    rawRatio: Math.round((100 * Math.max(iRaw, rRaw)) / Math.max(1, Math.min(iRaw, rRaw))) / 100,
    usedRatio, matched, admissible,
    intentBytes: iLen, realityBytes: rLen,
    intentGzip: iGz, realityGzip: rGz, floor: MIN_GZIP_BYTES, tolerance,
    reason: admissible
      ? (matched ? null : `sides still differ by ${usedRatio}× after cutting — the reading is length-dominated`)
      : `below the phantom-mass floor after matching (gzip ${iGz}/${rGz} < ${MIN_GZIP_BYTES}) — matched, and still too thin to read`,
  };
}

export function apertureText(a) {
  const lines = [
    `# APERTURE — what the chip looked at`,
    `${a.engine || 'engine unreported'} · raw ${a.rawRatio}:1 → cut to ${a.usedRatio}:1 · intent ${a.intentBytes}B (gzip ${a.intentGzip}) · reality ${a.realityBytes}B (gzip ${a.realityGzip}) · floor ${a.floor}`,
    `matched: ${a.matched ? 'yes' : 'NO'} · admissible: ${a.admissible ? 'yes' : 'NO'}${a.reason ? ` — ${a.reason}` : ''}`,
    '',
  ];
  for (const r of a.rows) {
    lines.push(`  [${r.side}] ${r.path} — ${r.rawBytes}B raw → ${r.usedBytes}B used (${r.sharePct}% of its side)${r.truncated ? ' · CUT' : ''}`);
  }
  return lines.join('\n');
}
