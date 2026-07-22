// scripts/pmu/reef-coord-name.mjs — expand a ShortLex coordinate into its PROBLEM-SPACE name, GUESSED
// from the reef (operator: "guess the name expansion from the reef … the repo … the problemspace …
// canonical extended … for the problem space at hand").
//
// The fixed tesseract taxonomy (A1 → Strategy.Law) is the CANONICAL base. The reef (data/pmu/lens-reef.json)
// is the repo's own problem space: 32 domains the gzip-NCD compression sensor named as it built the reef,
// each pinned to a coordinate with the category-naming VOCAB words it picked (A,A1 → "payments" →
// "stripe webhook payment checkout …"). This module EXTENDS the canonical name with that reef domain —
// exact when a domain sits on the coord, GUESSED from the Chebyshev-nearest domain otherwise — so the
// email's encircled coordinate carries the full problem-space name, computed with the lens, LLM-free.
//
// This is "compute them with the pmu lens": the reef IS the lens's named problem space; we read the
// domain the sensor already placed, never invent one.
//
// @guard tests/pmu-simulator/reef-coord-name.test.mjs

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { axisFullName, shortLexToBlock, NB } from './shortlex-coords.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REEF = resolve(REPO, 'data/pmu/lens-reef.json');

let _reef = null;
function reef() {
  if (_reef) return _reef;
  try {
    const doms = (JSON.parse(readFileSync(REEF, 'utf8')).domains || []).filter((d) => d && d.coord && d.domain);
    const byCoord = new Map(doms.map((d) => [String(d.coord).trim(), d]));
    _reef = { doms, byCoord };
  } catch { _reef = { doms: [], byCoord: new Map() }; }
  return _reef;
}

// the CANONICAL base name for a "row,col" coord — the fixed taxonomy, both ranks (e.g. "A.Strategy × A1.Strategy.Law").
export function canonicalName(coord) {
  const [r, c] = String(coord).split(',').map((s) => s.trim());
  const rn = axisFullName(r), cn = c ? axisFullName(c) : '';
  return cn ? `${rn} × ${cn}` : rn;
}

// the first N distinct vocab words the sensor picked for a domain (the category-naming extension).
function vocabHead(vocab, n) {
  return String(vocab || '').split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

// Chebyshev-nearest reef domain to a coord's block (the GUESS when no domain sits exactly on it).
function nearestDomain(coord) {
  const { br, bc } = shortLexToBlock(coord);
  if (!Number.isFinite(br) || !Number.isFinite(bc)) return null;
  let best = null, bd = Infinity;
  for (const d of reef().doms) {
    const { br: dr, bc: dc } = shortLexToBlock(d.coord);
    if (!Number.isFinite(dr) || !Number.isFinite(dc)) continue;
    const dist = Math.max(Math.abs(br - dr), Math.abs(bc - dc));
    if (dist < bd) { bd = dist; best = d; }
  }
  return best ? { domain: best, dist: bd } : null;
}

// THE ENTRY: expand a coord into { coord, canonical, domain, guessed, vocab, name }.
//   name = "<canonical> → <domain> · <vocab head>"  (domain guessed → "~<domain>")
// guessed=true means no reef domain sat on the coord; we borrowed the nearest one's problem-space name.
export function expandCoordName(coord, { vocabWords = 4 } = {}) {
  const key = String(coord).trim();
  const canonical = canonicalName(key);
  const exact = reef().byCoord.get(key);
  const hit = exact ? { domain: exact, dist: 0 } : nearestDomain(key);
  if (!hit) return { coord: key, canonical, domain: null, guessed: false, vocab: [], name: canonical };
  const guessed = hit.dist > 0;
  const vocab = vocabHead(hit.domain.vocab, vocabWords);
  const dname = guessed ? `~${hit.domain.domain}` : hit.domain.domain;
  return {
    coord: key,
    canonical,
    domain: hit.domain.domain,
    guessed,
    vocab: vocab.split(/\s+/).filter(Boolean),
    name: vocab ? `${canonical} → ${dname} · ${vocab}` : `${canonical} → ${dname}`,
  };
}

export default expandCoordName;
