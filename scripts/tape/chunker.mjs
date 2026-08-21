// packages/thetacog-mcp/scripts/tape/chunker.mjs
// ════════════════════════════════════════════════════════════════════════════
// DETERMINISTIC SEGMENTATION — a PURE FUNCTION of the input text. Same text in,
// byte-identical turns out. No clock, no randomness, no model call anywhere in
// this file (physics.mjs / atomizer.mjs own the LLM + placement lanes; this
// module only cuts a raw transcript into turns and normalizes dictation noise).
//
// Two exports the rest of the engine chains together:
//   normalizeDictation(text) — PASS 1 of the voice glossary (deterministic
//     word-boundary substitution), mirroring scripts/voice/refine-prompt.mjs.
//   segment(text) -> { turns, totalLines } — the turn-boundary heuristics
//     described below, measured against the real specimen
//     (docs/05-content/blog/scratchpad/GDDadwill.txt).
//   chunkText(text) = segment(normalizeDictation(text).text) with the raw
//     line numbers preserved (see the "no line-shift" contract below).
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/thetacog-mcp/scripts/tape/chunker.mjs -> repo root is 4 levels up.
const REPO_ROOT_GUESS = resolve(HERE, '..', '..', '..', '..');
const GLOSSARY_PATH = process.env.TAPE_GLOSSARY_PATH
  || resolve(REPO_ROOT_GUESS, 'data', 'voice', 'glossary.json');

// ── PASS 1 — deterministic voice-glossary normalization ────────────────────
// Mirrors scripts/voice/refine-prompt.mjs's applyGlossary(): every `aka` in
// data/voice/glossary.json is substituted for its canonical `term`, longest
// aka first (so a multi-word phrase wins over a substring of it), word-boundary
// fenced, case-insensitive. Deterministic — no LLM, no randomness.
export function loadGlossary(path = GLOSSARY_PATH) {
  try {
    const g = JSON.parse(readFileSync(path, 'utf8'));
    return (g.terms || []).filter((t) => t && t.term && Array.isArray(t.aka));
  } catch {
    return [];
  }
}

function akaRegex(aka) {
  const esc = aka.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\w'])${esc}(?![\\w'])`, 'gi');
}

function applyGlossary(text, terms) {
  let out = String(text || '');
  const subs = [];
  const pairs = [];
  for (const t of terms) for (const aka of t.aka) pairs.push({ aka, term: t.term });
  pairs.sort((a, b) => b.aka.length - a.aka.length);
  for (const { aka, term } of pairs) {
    const re = akaRegex(aka);
    let n = 0;
    out = out.replace(re, () => { n++; return term; });
    if (n) subs.push({ from: aka, to: term, count: n });
  }
  return { text: out, substitutions: subs };
}

/**
 * normalizeDictation(text) -> { text, substitutions, lineCountPreserved, warning }
 *
 * PASS 1 only (deterministic, LLM-free) — chunker.mjs has no business calling
 * qwen; that is a separate, optional pass elsewhere. Substitutions are
 * word-boundary and never touch newlines, so the line count MUST be identical
 * before/after — this is asserted, not assumed, because every downstream
 * startLine/endLine anchor depends on it. If it ever isn't (a future glossary
 * entry containing a literal newline would break this), fall back to the
 * UN-normalized text and record a warning rather than silently shifting every
 * chip's anchor in the console.
 */
export function normalizeDictation(text, { glossary = null } = {}) {
  const raw = String(text || '');
  const terms = glossary || loadGlossary();
  const { text: normalized, substitutions } = applyGlossary(raw, terms);
  const rawLines = raw.split('\n').length;
  const normLines = normalized.split('\n').length;
  if (normLines !== rawLines) {
    return {
      text: raw,
      substitutions: [],
      lineCountPreserved: false,
      warning: `normalizeDictation: line count shifted ${rawLines} -> ${normLines}; falling back to un-normalized text`,
    };
  }
  return { text: normalized, substitutions, lineCountPreserved: true, warning: null };
}

// ── PASS 2 — turn segmentation ──────────────────────────────────────────────
//
// Turn boundaries are UNMARKED in the raw specimen. Below is the scored,
// documented heuristic set (spec v2 R1), calibrated against
// docs/05-content/blog/scratchpad/GDDadwill.txt but implemented as GENERAL
// signals (not string-matched to that file) so a different transcript still
// segments sanely.
//
// STEP A — blocks. A "block" is a maximal run of non-blank lines. Every block
// carries `blankBefore` = the count of blank lines immediately preceding it
// (0 for the very first block in the document).
//
// STEP B — block mode. blankBefore >= PASTE_BLANK_THRESHOLD (2) marks a
// PASTED region: multi-paragraph content that was itself copy/pasted into the
// transcript (an email, a memo, a doc) and formatted with a blank line (often
// more than one, from a rich-text source) between every paragraph — REGARDLESS
// of who is "speaking". Consecutive pasted-mode blocks merge into ONE 'pasted'
// turn spanning all of them; this directly matches the measured specimen,
// where GDDadwill.txt lines 1-76 are a single operator-authored memo with
// triple-blank-line paragraph breaks (blankBefore=3), and turn boundaries
// resume in live-reply mode (blankBefore=1) at line 78.
//
// blankBefore < 2 is LIVE mode: normal turn-taking. Each live block is scored
// on two independent signal sets (documented inline below) and classified
// 'operator' or 'assistant'. Consecutive live blocks of the SAME role merge
// into one turn.
//
// STEP C — hysteresis. A lone short/ambiguous sentence inside a multi-
// paragraph reply (e.g. "Good question.") must not fragment that reply into
// many one-block turns. A live block only FLIPS the running role if its own
// score margin for the opposing role is >= FLIP_MARGIN; otherwise it continues
// the current turn. This is "sticky" segmentation — named so future tuning
// doesn't reintroduce block-by-block fragmentation.
const PASTE_BLANK_THRESHOLD = 2;
const FLIP_MARGIN = 2;

// Operator turns in the specimen: single monster lines (600-2600 chars),
// dictation-corrupted, high words-per-sentence (run-on — mirrors
// scripts/voice/refine-prompt.mjs's looksDictated()), and very often open
// with a short imperative fragment.
const OPERATOR_OPENERS = /^(let'?s|let’s|i need|i want|we need|never|always|ok\b|okay\b|so\b|stop\b|don'?t|do not)/i;

// Assistant turns: many short lines/paragraphs, end in a question mark, carry
// short Title-Case headers on their own line, and numbered list items.
const NUMBERED_ITEM = /^\d+\.\s+\S/;
const TITLE_HEADER = /^[A-Z][A-Za-z0-9 ,'()/&-]{2,70}$/; // short, capitalized, no terminal punctuation

function scoreBlock(text) {
  const t = text.trim();
  const len = t.length;
  const words = t.split(/\s+/).filter(Boolean).length;
  const sentences = (t.match(/[.!?]/g) || []).length || 1;
  const wordsPerSentence = words / sentences;
  const lines = t.split('\n');
  const lastLine = lines[lines.length - 1].trim();
  const firstLine = lines[0].trim();

  let operator = 0;
  let assistant = 0;

  if (len > 500) operator += 2;                       // monster-line signal
  if (wordsPerSentence > 28) operator += 2;            // run-on / dictation signal (looksDictated threshold)
  if (OPERATOR_OPENERS.test(firstLine)) operator += 1; // short imperative fragment opener

  if (lastLine.endsWith('?')) assistant += 2;          // assistant turns often close on a question
  if (len < 250) assistant += 1;                       // short paragraph
  if (NUMBERED_ITEM.test(firstLine) || lines.some((l) => NUMBERED_ITEM.test(l.trim()))) assistant += 2;
  if (lines.length === 1 && words <= 10 && TITLE_HEADER.test(t) && !/[.?!]$/.test(t)) assistant += 2; // short header line

  return { operator, assistant };
}

function classifyBlock(text) {
  const { operator, assistant } = scoreBlock(text);
  return operator > assistant ? 'operator' : 'assistant'; // tie defaults to assistant (majority short-paragraph style)
}

/**
 * segment(text) -> { turns: [{index, role, startLine, endLine, text}], totalLines }
 * Pure function of `text`. Line numbers are 1-indexed and refer to the INPUT
 * `text` passed to this function — callers that want anchors into the
 * ORIGINAL pre-normalization source must call segment() on the raw text (or
 * on normalizeDictation()'s output when lineCountPreserved is true, since the
 * line numbering is identical either way by construction).
 */
export function segment(text) {
  const raw = String(text || '');
  const lines = raw.split('\n');
  const totalLines = lines.length;

  // STEP A — build blocks.
  const blocks = [];
  let cur = null;
  let blankRun = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    if (lines[i].trim() === '') {
      blankRun++;
      if (cur) { blocks.push(cur); cur = null; }
    } else {
      if (!cur) cur = { start: ln, end: ln, blankBefore: blankRun, lines: [lines[i]] };
      else { cur.end = ln; cur.lines.push(lines[i]); }
      blankRun = 0;
    }
  }
  if (cur) blocks.push(cur);

  // STEP B + C — merge blocks into turns.
  const turns = [];
  let current = null; // { mode: 'pasted'|'live', role, startLine, endLine, textLines }

  const flush = () => {
    if (!current) return;
    turns.push({
      index: turns.length,
      role: current.role,
      startLine: current.startLine,
      endLine: current.endLine,
      text: current.textLines.join('\n'),
    });
    current = null;
  };

  for (const b of blocks) {
    const blockText = b.lines.join('\n');
    const mode = b.blankBefore >= PASTE_BLANK_THRESHOLD ? 'pasted' : 'live';

    if (mode === 'pasted') {
      if (current && current.mode === 'pasted') {
        current.endLine = b.end;
        current.textLines.push('', blockText); // preserve a paragraph break in the reconstructed text
      } else {
        flush();
        current = { mode: 'pasted', role: 'pasted', startLine: b.start, endLine: b.end, textLines: [blockText] };
      }
      continue;
    }

    // live mode
    const { operator, assistant } = scoreBlock(blockText);
    const blockRole = classifyBlock(blockText);

    if (current && current.mode === 'live') {
      const margin = current.role === 'operator' ? (assistant - operator) : (operator - assistant);
      const flips = margin >= FLIP_MARGIN;
      if (!flips) {
        current.endLine = b.end;
        current.textLines.push('', blockText);
        continue;
      }
    }
    flush();
    current = { mode: 'live', role: blockRole, startLine: b.start, endLine: b.end, textLines: [blockText] };
  }
  flush();

  return { turns, totalLines };
}

/** chunkText(text) — normalizeDictation then segment; convenience wrapper. */
export function chunkText(text) {
  const norm = normalizeDictation(text);
  const result = segment(norm.text);
  return { ...result, normalization: { substitutions: norm.substitutions, lineCountPreserved: norm.lineCountPreserved, warning: norm.warning } };
}

export const __internals__ = { scoreBlock, classifyBlock, PASTE_BLANK_THRESHOLD, FLIP_MARGIN };
