// src/lib/backup/provider-card.mjs — C903 THE PROVIDER CARD (operator 2026-10-17: "service providers can start defining their
// communicative, pixels or confidence pixels on the map and therefore a bit of different projects explaining why they're
// gonna learn how to solve this issue").
//
// A provider declares up to NINE competence pixels — a ShortLex block coordinate plus one sentence, why I can solve work
// here — in provider.json, carried INSIDE their own backup archive (scripts/vna/backup.mjs, under the archive's own sha256,
// like warranty-terms.json; frozen at the server's received_at the same way — src/lib/backup/warranty.mjs frozenAtFor).
//
// LANDING IS NEVER A MEAN. C902's alignment-map.mjs averaged a room's landed blocks into one centre-of-mass coordinate and
// the average fell to the middle of the lattice — 4 of 5 rooms centred on A2,A3 whether or not any commit ever landed
// there. A provider's landing is read off their own tape's placements (placements[].pixel, the shape
// src/lib/backup/drift-reading.mjs's PIXEL regex writes) bucketed into ShortLex blocks and reported DENSEST CELL FIRST —
// the cell with the most placements, never the arithmetic centre of several.
//
// Declared vs landed is read PER PIXEL: how many of the provider's own placements landed at the exact block they declared,
// beside the single densest cell their whole tape actually produced. A provider whose tape carries fewer than LANDED_FLOOR
// placements overall is UNDERPOWERED — the same floor scripts/vna/alignment-map.mjs uses for a room (n < 8 is noise
// wearing a number).
//
// SUFFICIENT FOR: what a provider declares, and where their own tape's placements actually land, both read off a record
// they did not write afterward (the archive froze at upload). NOT SUFFICIENT FOR: whether the declared pixel is the right
// one, or whether the provider's work there was good (Rice, 1953) — a human (or a bidder, C905) reads this, it does not
// decide.
// @guard tests/site/c903-provider-card.test.mjs
import { createHash } from 'node:crypto';
import { AX, shortLexToBlock, blockToShortLex } from '../../../scripts/pmu/shortlex-coords.mjs';

export const PROVIDER_ENTRY = 'provider.json';   // where the card rides inside the archive (scripts/vna/backup.mjs carries it)
export const PROVIDER_VERSION = 1;
export const MAX_PIXELS = 9;        // "up to nine competence pixels"
export const MAX_WHY = 240;         // one sentence, not a brief
export const LANDED_FLOOR = 8;      // alignment-map.mjs's MIN_COMMITS — below this a shape is noise wearing a number

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
/** the card's identity: sha256 over its canonical JSON — the same declared pixels always hash the same */
export const cardSha = (c) => createHash('sha256').update(canon(c)).digest('hex');

const isBlockCoord = (coord) => { const { br, bc } = shortLexToBlock(String(coord || '').trim()); return br >= 0 && bc >= 0; };
const normCoord = (coord) => { const { br, bc } = shortLexToBlock(String(coord || '').trim()); return blockToShortLex(br, bc); };

/** a shape check on the holder's card, never a repair: up to MAX_PIXELS { coord, why }, coord a parseable ShortLex block,
 *  why a non-empty sentence capped at MAX_WHY chars; else null. Mirrors warranty.mjs's termsOf. */
export function cardOf(buf) {
  let c = null; try { c = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!c || typeof c !== 'object' || c.version !== PROVIDER_VERSION || !Array.isArray(c.pixels)) return null;
  if (c.pixels.length === 0 || c.pixels.length > MAX_PIXELS) return null;
  const pixels = [];
  const seen = new Set();
  for (const p of c.pixels) {
    if (!p || typeof p !== 'object') return null;
    if (!isBlockCoord(p.coord)) return null;
    const coord = normCoord(p.coord);
    if (typeof p.why !== 'string' || !p.why.trim()) return null;
    if (seen.has(coord)) return null;   // one declaration per coordinate — a repeat is not a ninth pixel
    seen.add(coord);
    pixels.push({ coord, why: p.why.trim().slice(0, MAX_WHY) });
  }
  return { version: PROVIDER_VERSION, pixels };
}

// a ShortLex pixel address, fine-grained or block-level — the same shape placements[].pixel writes (drift-reading.mjs PIXEL)
const PIXEL_RE = /^[A-Z][0-9]*(?:\.[0-9]+)*,[A-Z][0-9]*(?:\.[0-9]+)*$/;
function blockOfPixel(pixel) {
  if (typeof pixel !== 'string' || !PIXEL_RE.test(pixel)) return null;
  const [r, c] = pixel.split(',');
  // a sub-anchor reading (e.g. "A2.1,C3") carries no block-level rank in AX; a block-level pixel does — only the latter
  // is counted, the same permissiveness alignment-map.mjs's blockOf applies to a commit's greeks coordinate.
  if (!AX.includes(r) || !AX.includes(c)) return null;
  return `${r},${c}`;
}

/** every placed pixel across a provider's own tape rows (receipt-only rows carrying placements[].pixel), one count per
 *  block coordinate. Returns cells sorted DENSEST FIRST (n descending, then ShortLex rank — never a mean of the blocks). */
export function landedCells(rows = []) {
  const by = new Map();
  let total = 0;
  for (const r of rows) {
    const placements = r && Array.isArray(r.placements) ? r.placements : [];
    for (const p of placements) {
      const coord = blockOfPixel(p && p.pixel);
      if (!coord) continue;
      by.set(coord, (by.get(coord) || 0) + 1);
      total++;
    }
  }
  const order = (coord) => { const { br, bc } = shortLexToBlock(coord); return br * AX.length + bc; };
  const cells = [...by.entries()].map(([coord, n]) => ({ coord, n })).sort((a, b) => (b.n - a.n) || (order(a.coord) - order(b.coord)));
  return { cells, total };
}

/**
 * The one reading. card: a shape-checked provider card (cardOf), or null for no card declared. rows: the provider's own
 * backed-up tape rows. Declared vs landed per pixel, beside the single densest cell the whole tape produced.
 */
export function providerReading({ card = null, rows = [] } = {}) {
  if (!card || !Array.isArray(card.pixels) || !card.pixels.length) {
    return { status: 'NO CARD', why: 'no provider.json rode in this archive, or it failed the shape check', perPixel: [], landed: [], total: 0, underpowered: null };
  }
  const { cells, total } = landedCells(rows);
  const underpowered = total < LANDED_FLOOR;
  const byCoord = new Map(cells.map((c) => [c.coord, c.n]));
  const densest = cells[0] || null;
  const perPixel = card.pixels.map((p) => ({
    coord: p.coord, why: p.why,
    landedN: byCoord.get(p.coord) || 0,
    isDensest: !!densest && densest.coord === p.coord,
  }));
  return {
    status: underpowered ? 'UNDERPOWERED' : 'MEASURED',
    floor: LANDED_FLOOR, total, underpowered,
    perPixel,
    landed: cells,
    densest: densest ? densest.coord : null,
    sufficientFor: 'what this provider declares, and where their own tape\'s placements actually landed, per declared pixel — densest cell first, never a mean',
    notFor: 'whether the declared pixel is the right one, or whether the work there was good (Rice, 1953)',
  };
}
