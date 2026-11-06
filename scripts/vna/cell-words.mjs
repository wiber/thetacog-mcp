#!/usr/bin/env node
// scripts/vna/cell-words.mjs — C1044 THE CELL NAMES ITS STATE. Beside how many spec rows land in a 12×12 cell, a short legible list
// of words naming what is going on there. Operator 2026-10-20, verbatim: "the 2-D math, for example, should have the ability to not
// just rate how much is going on in which area but we should have the ability to summarize the state of that intersection as a
// [semantic] example and highly legible list of words that show sort of what the state of the intersection of the 12 x 12 is".
//
// WHERE THE WORDS COME FROM (CLAUDE.md, A LATTICE READING COMES FROM THE ONE RUST WALK): the placement is the walk's, never ours. A
// row belongs to a cell because its own walk put its pixel there (data/vna/tesseract-state.json `pixel`, folded from spec-tree.json
// `walk`) — the same placement the Map tab counts. The words are then read off the text of exactly those rows: a word is a
// candidate only if it occurs in a row placed in the cell, and it ranks by how many of the cell's rows carry it × how rare it is
// across every placed row (so "guard" and "row" never name a cell; the thing particular to it does). No noun regex decides
// anything, no model reads anything: same tree, same words. A cell with no row placed reads UNMEASURED.
//
// Words come from the OPEN rows when the cell has any (the Map counts open rows), else from its ticked rows, marked so.
//   node scripts/vna/cell-words.mjs              every placed cell, busiest first
//   node scripts/vna/cell-words.mjs --cell B,A1  one cell, with the rows its words came from
//   node scripts/vna/cell-words.mjs --write      refresh the HUD cache (.thetacog/cache/cell-words.json)
// Port row C1044-port: this DECIDES a reading (which words name a cell) — moves into the crate beside the walk once it is in use.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const STATE = process.env.VNA_TESSERACT_STATE || resolve(REPO, 'data/vna/tesseract-state.json');
export const CACHE = process.env.VNA_CELL_WORDS_CACHE || resolve(REPO, '.thetacog/cache/cell-words.json');
export const UNMEASURED = 'UNMEASURED';
export const K = 5;

// Function words and the spec's own scaffolding (every row has a guard, a done-when, an operator quote): never a name for one cell.
// This list removes words; it never adds one, so every surviving word is still a word of a placed row.
const STOP = new Set(('the and for that this with from into onto over under than then when what which who whom whose where while each every ' +
  'never always only also not nor but its it\'s are was were been being have has had does did doing done can could would should will shall ' +
  'must may might one two three four five six seven eight nine ten zero first last next same other own any all none some more most less ' +
  'very just like such them they their there here these those his her him she you your our ours ourselves itself because once since ' +
  'about after before again against between both down during further off out through until upon whether without within also isn ' +
  'guard test tests fails fail row rows spec operator verbatim when done mjs json ndjson scripts data docs tests src lib node ' +
  'says said say beside reads read written writes write line lines second need needs today make makes made lets nothing already back ' +
  'right stays left added latest actual carries named shows consider especially built figure marks landed correctly instead still ' +
  'even ever much many well good thing things something anything everything way ways goes going gets give gives given take takes ' +
  'keep keeps kept come comes part parts whole case cases time times next yet else rather back also both either neither tried ' +
  'happens happened says ones less least sure real really something lands sits').split(/\s+/).filter(Boolean));

/** the words of one row's text: code spans, paths, urls, ids and the operator's quoted speech removed (the row's own claim names the
 *  cell; the quote is why it was asked), lower-cased, ≥ 4 letters, function words dropped */
export function wordsOf(text) {
  const t = String(text || '').replace(/\*"[^"]*"\*/g, ' ').replace(/"[^"]{40,}"/g, ' ').replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\S+\/\S+/g, ' ')
    .replace(/\b[A-Z]{1,3}\d+[a-z]?\d*(-\w+)?\b/g, ' ').toLowerCase();
  return (t.match(/[a-z][a-z'-]*[a-z]/g) || []).map((w) => w.replace(/'s$/, '')).filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * The word list for every cell that has a row placed in it.
 * rows: [{ id, pixel, done, text }] — pixel is the walk's placement, text is the row's own spec text.
 * → Map(pixel → { pixel, open, all, from: 'open'|'ticked', rows: [ids the words were read from], words: [≤k] })
 */
export function cellWords(rows, { k = K } = {}) {
  const placed = rows.filter((r) => r && r.pixel);
  const bags = new Map(placed.map((r) => [r.id, new Set(wordsOf(r.text))]));
  const df = new Map(); for (const s of bags.values()) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  const N = placed.length;
  const byCell = new Map(); for (const r of placed) { if (!byCell.has(r.pixel)) byCell.set(r.pixel, []); byCell.get(r.pixel).push(r); }
  const out = new Map();
  for (const [pixel, rs] of byCell) {
    const open = rs.filter((r) => !r.done); const src = open.length ? open : rs;
    const dfc = new Map(); for (const r of src) for (const w of bags.get(r.id)) dfc.set(w, (dfc.get(w) || 0) + 1);
    // legible over rare: a word carried by several of the cell's rows beats a one-off (a typo, a hash), so the count is squared and,
    // where the cell has the rows for it, a word must recur in two of them; a word no other row in the tree uses is a one-off too.
    const scored = [...dfc].map(([w, c]) => ({ w, c, s: c * c * Math.log((N + 1) / (df.get(w) + 1)) }))
      .sort((a, b) => b.s - a.s || b.c - a.c || (a.w < b.w ? -1 : 1));
    const strict = scored.filter((x) => x.c >= 2 && df.get(x.w) >= 2);
    const words = (strict.length >= k ? strict : [...strict, ...scored.filter((x) => !strict.includes(x) && df.get(x.w) >= 2), ...scored.filter((x) => df.get(x.w) < 2)])
      .slice(0, k).map((x) => x.w);
    out.set(pixel, { pixel, open: open.length, all: rs.length, from: open.length ? 'open' : 'ticked', rows: src.map((r) => r.label || r.id), words });
  }
  return out;
}

/** one cell as a short legible line: "drift · lane · panel", or UNMEASURED when nothing is placed there */
export const wordLine = (entry, n = K) => (entry && entry.words.length ? entry.words.slice(0, n).join(' · ') + (entry.from === 'ticked' ? ' (ticked)' : '') : UNMEASURED);

/** the placed rows off the record: the walk's pixel (tesseract-state) joined to the row's own text (spec-tree) */
export function rowsFromRecord({ tree = TREE, state = STATE } = {}) {
  const st = JSON.parse(readFileSync(state, 'utf8')); const tr = JSON.parse(readFileSync(tree, 'utf8'));
  return (st.nodes || []).filter((n) => n.pixel).map((n) => { const t = tr.nodes && tr.nodes[n.id];
    return { id: n.id, label: n.label, pixel: n.pixel, done: !!n.done, text: t && t.content ? t.content.text : '' }; });
}

/** the HUD read: the cache when it is newer than the state it was read off, else recomputed and rewritten. Never throws. */
export function cellWordsCached({ tree = TREE, state = STATE, cache = CACHE } = {}) {
  try {
    const sm = statSync(state).mtimeMs;
    if (existsSync(cache)) { const c = JSON.parse(readFileSync(cache, 'utf8')); if (c.stateMtime === sm) return new Map(Object.entries(c.cells)); }
    const m = cellWords(rowsFromRecord({ tree, state }));
    try { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify({ stateMtime: sm, at: new Date().toISOString(), cells: Object.fromEntries(m) })); } catch { /* read-only tree */ }
    return m;
  } catch { return new Map(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const at = (f) => (a.indexOf(f) >= 0 ? a[a.indexOf(f) + 1] : null);
  if (a.includes('--write')) { try { const fs = await import('node:fs'); fs.unlinkSync(CACHE); } catch {} const m = cellWordsCached(); console.log(`cell words: ${m.size} placed cells → ${CACHE}`); process.exit(0); }
  const m = cellWords(rowsFromRecord());
  const one = at('--cell');
  if (one) { const e = m.get(one); console.log(`${one} · ${e ? `${e.open} open / ${e.all} placed` : '0 placed'} · ${wordLine(e)}`); if (e) console.log(`  from ${e.from} rows: ${e.rows.join(' ')}`); process.exit(0); }
  for (const e of [...m.values()].sort((x, y) => y.open - x.open || y.all - x.all)) console.log(`${e.pixel.padEnd(6)} ${String(e.open).padStart(3)} open / ${String(e.all).padStart(3)} · ${wordLine(e)}`);
}
