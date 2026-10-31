#!/usr/bin/env node
// scripts/pmu/descent-context.mjs — THE ONE DESCENT (spec §THE ONE DESCENT + §PREFIX METRIC).
//
// Auto-tick and live prompt are ONE machine: both ask "where does this text fit, and what
// context stack magnetizes there." This module is the single shared answer — the demand engine
// (Consumer B, wired first) and the lens (Consumer A, next) import THE SAME functions; the
// no-fork guard makes divergence a red build. Pure reads, no side effects, import-safe.
//
//   descend(text)            → { path, stack }   — NCD descent v1: place vs the 144 cell dumps,
//                              then vs the landed cell's sub-well children while wells exist.
//                              (The lens receipt's placement stays the real walk; this is the
//                              shared CONTEXT-BUILDER — Consumer A adopts it next pass.)
//   stackFor(address)        → per-level stack: cell dump · definers/rules · best statements ·
//                              radial neighborhood dumps.
//   ascendingHood(address,k) → banks: radial siblings at the deepest level, ASCENDING levels
//                              until k banks exist (the root is always full — neighbors always
//                              exist; depth changes WHICH, never WHETHER).
//   childShelves()           → every open child shelf (snippet ≥80, statements < CAP) with its
//                              full prefix address — the 467 the flat hunts cannot reach.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHORTLEX_AXES, neighborsWithin, meldFor } from './promise-mass.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CAP = 8;
const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
const ncd = (a, b) => { const ga = gz(a), gb = gz(b), gab = gz(a + '\n' + b); const d = Math.max(ga, gb); return d === 0 ? 1 : (gab - Math.min(ga, gb)) / d; };

let _lib = null, _wells = null, _reef = null;
function lib144() { if (!_lib) _lib = new Map(JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8')).map((c) => [String(c.coord), String(c.snippet || '')])); return _lib; }
function wells() {
  if (!_wells) {
    _wells = new Map();
    const dir = resolve(REPO, 'data/pmu/reef-l1');
    if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.nogo.json') && !x.endsWith('.building.json'))) {
      const w = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      _wells.set(String(w.parent), w);
    }
  }
  return _wells;
}
function reef() { if (!_reef) _reef = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')); return _reef; }

export function prefixParts(address) { return String(address).split('/'); }

/** spec §PREFIX METRIC: d(a,b) = (shared-prefix depth, Chebyshev at the first divergent level). */
export function prefixDistance(a, b) {
  const pa = prefixParts(a), pb = prefixParts(b);
  let shared = 0;
  while (shared < pa.length && shared < pb.length && pa[shared] === pb[shared]) shared++;
  const la = pa[shared], lb = pb[shared];
  if (la == null || lb == null) return { shared, cheby: 0, deeper: Math.abs(pa.length - pb.length) };
  const [ra, ca] = la.split(','), [rb, cb] = lb.split(',');
  const cheby = Math.max(Math.abs(SHORTLEX_AXES.indexOf(ra) - SHORTLEX_AXES.indexOf(rb)), Math.abs(SHORTLEX_AXES.indexOf(ca) - SHORTLEX_AXES.indexOf(cb)));
  return { shared, cheby, deeper: 0 };
}

function cellTextAt(address) {
  const parts = prefixParts(address);
  if (parts.length === 1) return lib144().get(parts[0]) || '';
  const w = wells().get(parts.slice(0, -1).join('/')) || wells().get(parts[parts.length - 2]);
  if (!w) return '';
  const c = (w.cells || []).find((x) => String(x.coord) === parts[parts.length - 1]);
  return c ? String(c.snippet || '') : '';
}

/** spec §PREFIX METRIC: radial siblings at own level, ASCENDING until k banks — never a vacuum hood. */
export function ascendingHood(address, k = 5) {
  const banks = [];
  let parts = prefixParts(address);
  while (parts.length >= 1 && banks.length < k) {
    const level = parts[parts.length - 1];
    const prefix = parts.slice(0, -1).join('/');
    for (const n of neighborsWithin(level, 1)) {
      const addr = prefix ? `${prefix}/${n}` : n;
      const t = cellTextAt(addr);
      if (t.length >= 40) banks.push({ coord: addr, text: t.slice(0, 1200) });
      if (banks.length >= k) break;
    }
    parts = parts.slice(0, -1);   // ascend — the root grid is always full
  }
  return banks;
}

/** per-level context stack — the actor⊕patient-and-deeper, expanded to the neighborhood. */
export function stackFor(address) {
  const parts = prefixParts(address);
  const stack = [];
  for (let i = 0; i < parts.length; i++) {
    const addr = parts.slice(0, i + 1).join('/');
    const dump = cellTextAt(addr);
    const lane = i === 0 ? (reef().domains || []).find((d) => String(d.coord) === parts[0]) : null;
    const w = i > 0 ? (wells().get(parts.slice(0, i).join('/')) || wells().get(parts[i - 1])) : null;
    const cell = w ? (w.cells || []).find((x) => String(x.coord) === parts[i]) : null;
    stack.push({
      address: addr,
      dump: dump.slice(0, 1200),
      rules: lane ? (lane.rules || []).slice(0, 6) : (w ? [String((w.definers || {})[parts[i].split(',')[0]] || '').slice(0, 300)].filter(Boolean) : []),
      statements: lane
        ? Object.values((lane.derived_statements && !Array.isArray(lane.derived_statements)) ? lane.derived_statements : {}).flat().slice(-4)
        : (cell && Array.isArray(cell.derived_statements) ? cell.derived_statements.slice(-4) : []),
      neighborhood: neighborsWithin(parts[i], 1).slice(0, 8).map((n) => {
        const na = i === 0 ? n : `${parts.slice(0, i).join('/')}/${n}`;
        return { coord: na, dump: cellTextAt(na).slice(0, 300) };
      }).filter((n) => n.dump.length >= 40),
    });
  }
  return stack;
}

/** the shared descent (v1: NCD placement; the lens adopts this builder next pass). */
export function descend(text) {
  const t = String(text || '').slice(0, 2000);
  let best = null, bestD = 2;
  for (const [coord, dump] of lib144()) {
    if (dump.length < 80) continue;
    const d = ncd(t, dump);
    if (d < bestD) { bestD = d; best = coord; }
  }
  const path = [best];
  let cursor = best;
  while (wells().has(cursor)) {
    const w = wells().get(cursor);
    let cb = null, cbd = 2;
    for (const c of w.cells || []) {
      const s = String(c.snippet || '');
      if (s.length < 80) continue;
      const d = ncd(t, s);
      if (d < cbd) { cbd = d; cb = String(c.coord); }
    }
    if (!cb) break;
    path.push(cb);
    cursor = `${cursor}/${cb}`;
    if (!wells().has(cursor)) break;
  }
  const address = path.length === 1 ? path[0] : path.reduce((a, p, i) => i === 0 ? p : `${a}/${p}`, '');
  return { path, address, ncd_leaf: +bestD.toFixed(4), stack: stackFor(address) };
}

/** every open child shelf with its full address — the target mass the flat hunts cannot reach. */
export function childShelves() {
  const out = [];
  for (const [parent, w] of wells()) {
    for (const c of w.cells || []) {
      const stmts = Array.isArray(c.derived_statements) ? c.derived_statements.length : 0;
      if (String(c.snippet || '').length >= 80 && stmts < CAP) {
        out.push({ address: `${parent}/${c.coord}`, parent, child: String(c.coord), stmts, dump_len: String(c.snippet || '').length });
      }
    }
  }
  return out.sort((a, b) => a.stmts - b.stmts || b.dump_len - a.dump_len);
}

/** Consumer A's meat pool (shared — the lens must never re-derive this): every child statement
 *  of the routed coord's well, tagged with its child coord. Deepest-first enrichment source. */
export function childStatementsFor(coord) {
  const w = wells().get(String(coord));
  if (!w) return [];
  const out = [];
  for (const c of w.cells || []) {
    for (const s of (Array.isArray(c.derived_statements) ? c.derived_statements : [])) {
      out.push({ s: String(s), child: String(c.coord) });
    }
  }
  return out;
}
