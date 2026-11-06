#!/usr/bin/env node
// scripts/pmu/lattice-resolve.mjs — THE LATTICE RESOLVER (ingestion fix, 2026-07-22).
//
// The bottleneck the operator caught on the demo page: Ingestion·Intent read a 258-byte
// standalone sentence (intent_corpus.txt · LINES 1) and never resolved its coordinate
// addresses into the reef — the NCD measured the prompt against an empty room while the
// lattice's institutional mass sat unused. This module is the fix: given an intent text and
// its authorized cells, it detects the ShortLex addresses in play, pulls each addressed
// cell's TITLE + FULL CORPUS from the lattice sources (snippet-library-144 by coord row/col,
// lens-reef domains by coord), and returns the resolved corpus PLUS the chain-of-custody
// list of exactly which cells collided — so the ingestion receipt proves the full lattice
// was in play, not the box alone.
//
// Deterministic, LLM-free, read-only over the lattice files.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const AXIS_NAMES = (() => {
  const m = {};
  try {
    const raw = JSON.parse(readFileSync(resolve(REPO, 'docs/architecture/axis-library-v1.json'), 'utf8'));
    for (const a of (Array.isArray(raw) ? raw : (raw.axes || Object.values(raw)))) m[a.rank] = String(a.name || a.rank);
  } catch { /* names degrade to bare ranks */ }
  return m;
})();

const SNIPPETS = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'));
    return Array.isArray(raw) ? raw : (raw.anchors || raw.nodes || []);
  } catch { return []; }
})();

const LENS_DOMAINS = (() => {
  try { return JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')).domains || []; }
  catch { return []; }
})();

export const fullName = (rank) => AXIS_NAMES[rank] || rank;

// detect explicit addresses in a text: digit-bearing ranks (A1..C3) and actor,patient pairs
// (A,A2). Bare single letters are NOT detected from prose ("A" the article would false-flag);
// they enter only via the authorized list.
export function detectAddresses(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/\b([ABC][1-3])\b/g)) found.add(m[1]);
  for (const m of String(text).matchAll(/\b([ABC][1-3]?),([ABC][1-3])\b/g)) { found.add(m[1]); found.add(m[2]); }
  return [...found];
}

// the full corpus of one rank: every 144-cell snippet whose row or col is the rank (labeled by
// its intersection coord — the operator must SEE the full semantic dump, per-cell), plus every
// lens-reef domain whose coord names it (title = domain name; body = vocab + template + rules).
// DEFAULT IS FULL TEXT (2026-07-22: the 900-char cap showed ~3% of a rank's ~33k-char corpus —
// the auto-tick ingest must carry the whole dump; pass maxChars only to bound a preview).
function cellCorpus(rank, { maxChars = Infinity } = {}) {
  const parts = [];
  let len = 0;
  for (const s of SNIPPETS) {
    if (s.row === rank || s.col === rank) {
      const block = `[${s.coord}] ${String(s.snippet || '')}`;
      parts.push(block); len += block.length;
      if (len > maxChars) break;
    }
  }
  const titles = [];
  for (const d of LENS_DOMAINS) {
    const [r, c] = String(d.coord || '').split(',');
    if ((r === rank || c === rank) && len <= maxChars) {
      titles.push(d.domain);
      const block = `${d.domain}: ${d.vocab || ''} ${d.template || ''} ${(d.rules || []).join(' ')}`;
      parts.push(block); len += block.length;
    }
  }
  const joined = parts.join('\n');
  const body = Number.isFinite(maxChars) ? joined.slice(0, maxChars) : joined;
  return { rank, full: `${rank}.${fullName(rank)}`, titles, cells: parts.length, body, bytes: Buffer.byteLength(body, 'utf8') };
}

/**
 * Resolve an intent text through the lattice: authorized cells + any addresses detected in the
 * text each contribute their titled full corpus. Returns { corpus, cells } where corpus is the
 * original text followed by the addressed blocks, and cells is the custody list (which cells
 * collided, with byte counts) for the ingestion receipt.
 */
/**
 * AXIS-DESCRIPTOR MODE — the corrected mechanic (operator 2026-07-22, after the size-band
 * incident). Instead of the rank's ENTIRE row+column corpus (measured: 258B → 128,962B, a 500x
 * inflation that kept 1% of the instrument's separation — the dictionary black hole, live), bind
 * ONLY each rank's self-defining axis text: a concentrated ~200B vector per axis that grounds the
 * coordinate's conceptual boundary without swamping the intent it is supposed to ground.
 * MEASURED on the same fixture: 258B → 849B (3.3x), keeping 42% of raw separation vs 1%.
 * Guard: tests/pmu-simulator/intent-size-band.test.mjs (bounds MAX_INFLATION, MIN_SEPARATION_KEPT).
 */
// AXIS_DEF_CHARS is a JUDGMENT, not a derivation. Measured curve (separation kept vs raw):
// 40ch→68% · 80ch→57% · 120ch→48% · 180ch→42% · 220ch→40% · 300ch+→39% (flat — snippets are
// shorter than the cap above ~300). Grounding costs separation monotonically; what it BUYS is
// un-instrumented, so no value here is derivable yet. 220 buys the fullest descriptors that
// still clear the catastrophe guard — the operator sets the real dial when the benefit side
// has a measure. Guard: tests/pmu-simulator/intent-size-band.test.mjs (catastrophe-only bounds).
const AXIS_DEF_CHARS = 220;
let _axisLib = null;
function axisDescriptor(rank) {
  if (_axisLib === null) {
    try { _axisLib = JSON.parse(readFileSync(resolve(REPO, 'docs/architecture/axis-library-v1.json'), 'utf8')).axes || []; }
    catch { _axisLib = []; }
  }
  const a = _axisLib.find((x) => x.rank === rank);
  if (!a) return null;
  const body = String((a.snippets || [])[0] || '').slice(0, AXIS_DEF_CHARS);
  if (!body) return null;
  return { rank, full: `${rank}.${fullName(rank)}`, titles: [], cells: 1, body: `${rank}.${a.name || rank}: ${body}`, bytes: Buffer.byteLength(`${rank}.${a.name || rank}: ${body}`, 'utf8') };
}

export function resolveLattice(text, { authorized = [], maxCells = 8, maxCharsPerCell = Infinity, mode = 'axis' } = {}) {
  const ranks = [...new Set([...authorized, ...detectAddresses(text)])].slice(0, maxCells);
  // DEFAULT is axis-descriptor mode. mode:'full' preserves the old whole-row+column behavior for
  // callers that genuinely want the mass (knock-on-auto measures available mass, not a verdict) —
  // it is never the verdict path's default again.
  const cells = mode === 'full'
    ? ranks.map((r) => cellCorpus(r, { maxChars: maxCharsPerCell }))
    : ranks.map((r) => axisDescriptor(r)).filter(Boolean);
  const blocks = cells.filter((c) => c.body).map((c) =>
    `── ${c.full}${c.titles.length ? ` · ${c.titles.join(' · ')}` : ''} ──\n${c.body}`);
  const corpus = blocks.length ? `${text}\n\n${blocks.join('\n\n')}` : String(text);
  return {
    corpus,
    cells: cells.map(({ rank, full, titles, bytes }) => ({ rank, full, titles, bytes })),
    resolved_bytes: Buffer.byteLength(corpus, 'utf8'),
    raw_bytes: Buffer.byteLength(String(text), 'utf8'),
  };
}

/**
 * INGEST INTEGRITY (operator 2026-07-22: "I have to be able to see from the page that it's
 * confirmed and STAYS confirmed"): recompute the AVAILABLE mass per rank directly from the
 * lattice files and compare against what a resolved corpus actually CARRIED. ok=true only when
 * every rank carries 100% of its available mass — any re-introduced cap turns the panel red.
 */
export function ingestIntegrity(resolvedCells, { authorized = [], mode = 'axis' } = {}) {
  // The recompute must use the SAME unit the carry used, or "available" and "carried" measure
  // different things and the panel lies in whichever direction the mismatch points.
  const fresh = resolveLattice('', { authorized, mode });
  const availByRank = Object.fromEntries(fresh.cells.map((c) => [c.rank, c.bytes]));
  const rows = (resolvedCells || []).map((c) => {
    const available = availByRank[c.rank] ?? c.bytes;
    const pct = available ? +(100 * c.bytes / available).toFixed(1) : 100;
    return { rank: c.rank, full: c.full, carried: c.bytes, available, pct };
  });
  const pctTotal = rows.length
    ? +(100 * rows.reduce((a, r) => a + r.carried, 0) / rows.reduce((a, r) => a + r.available, 0)).toFixed(1)
    : 0;
  return { ok: rows.length > 0 && rows.every((r) => r.pct >= 100), pct_total: pctTotal, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2] || 'Route this through A1 and C1 per the authorized lane.';
  const r = resolveLattice(text, { authorized: ['A', 'A1', 'A2'] });
  console.log(`raw ${r.raw_bytes}B → resolved ${r.resolved_bytes}B · cells: ${r.cells.map((c) => `${c.full} (${c.bytes}B)`).join(' · ')}`);
}
