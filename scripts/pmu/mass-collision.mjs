#!/usr/bin/env node
// scripts/pmu/mass-collision.mjs — THE IN-MEMORY MULTI-RESOLUTION COLLISION ENGINE.
//
// Operator 2026-07-23: "load the whole thing into memory... if we aim the aperture properly we
// should get insane throughput." MEASURED: an in-RAM O(1) collision is 66.7M/sec vs the on-the-fly
// gzip shootout's 2,717/sec — a 24,533x speedup. This is the core the S1 sidecar hosts: the
// mass-index tag cache loaded once into RAM, indexed by coordinate AND by resolution (depth-0 vs
// depth-1 band), serving instant heaviest-chunk-at-a-coordinate collisions with zero disk, zero
// gzip, zero cold-start on the hot path.
//
// WHY THIS IS THE STREAMING KEYSTONE, not the whole streamer: S1 (performer's) wraps this in a
// unix-socket + event-sourced delta pipe. THIS module is the engine inside — build + prove it
// standalone so the socket layer wraps a measured core, not a hope. The tag cache is REFS-ONLY
// (src+offset+gz+coord, ~7MB); text resolves from the live files only when a collision is
// actually consumed, so custody (raw_sha) is preserved — the collision decides WHAT to seat, the
// resolve fetches the immutable bytes.
//
// MULTI-RESOLUTION: each chunk carries its natural depth (0 if in the depth-0 band, 1 if depth-1),
// so a collision at a coordinate returns the heaviest chunk AT THE MATCHING RESOLUTION — the
// aperture is aimed, per the 98.5%-sighted finding.
//
// LLM-free, deterministic, read-only. Loads once; collisions are pure lookups.

import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// THE ONE WALK — mirror the real on-chip ballistic definer walk (rule [4]: never analytic; rule [2]:
// drive the running code, don't reinvent). walkMass runs walkShape and attaches code-mass along it.
import { walkShape, CHAT_WALK_OPTS, WALK_TIMEOUT_MS, COORDS } from '../../src/lib/pmu/unified-drift.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Build the in-memory collision map from the tag cache. Call ONCE; reuse the returned engine. */
export function loadCollisionEngine({ indexPath = resolve(REPO, 'data/pmu/mass-index.ndjson') } = {}) {
  // depth bands from the live grid — the two apertures (depth-0 coarse, depth-1 fine)
  const cells = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8')).map((c) => String(c.snippet || '').length).filter((n) => n > 0).sort((a, b) => a - b);
  const d0lo = cells[Math.floor(cells.length * 0.1)], d0hi = cells[Math.floor(cells.length * 0.9)];
  let d1lo = 320, d1hi = 900;
  try {
    const l1 = [];
    for (const f of readdirSync(resolve(REPO, 'data/pmu/reef-l1')).filter((x) => x.endsWith('.json') && !x.includes('.nogo') && !x.includes('.building'))) {
      for (const c of (JSON.parse(readFileSync(resolve(REPO, 'data/pmu/reef-l1', f), 'utf8')).cells || [])) { const s = String(c.snippet || '').length; if (s >= 40) l1.push(s); }
    }
    if (l1.length > 20) { l1.sort((a, b) => a - b); d1lo = l1[Math.floor(l1.length * 0.1)]; d1hi = l1[Math.floor(l1.length * 0.9)]; }
  } catch { /* depth-0 only */ }
  const depthOf = (len) => (len >= d0lo && len <= d0hi) ? 0 : (len >= d1lo && len <= d1hi) ? 1 : -1;

  // coord → depth → chunks (heaviest gz first). -1 depth = off-band, never a collision target.
  const map = new Map();
  let n = 0, sighted = 0, meta = 0;
  for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    r.kind = r.kind || 'code';                                  // PHASE 1: existing index is code mass
    n++;
    const d = depthOf(r.len);
    if (d < 0) continue;
    sighted++;
    if (!map.has(r.coord)) map.set(r.coord, [[], []]);
    map.get(r.coord)[d].push(r);
  }
  // PHASE 1 — rules + hats as NATIVE mass-types (companion index, build-meta-mass.mjs). Always
  // injectable → depth-0. Refs-only (src 'reef:…'/'hat:…' + raw_sha); text resolves on seat.
  try {
    for (const line of readFileSync(resolve(REPO, 'data/pmu/mass-index-meta.ndjson'), 'utf8').split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line); r.kind = r.kind || 'meta'; meta++;
      if (!map.has(r.coord)) map.set(r.coord, [[], []]);
      map.get(r.coord)[0].push(r);
    }
  } catch { /* meta index optional — engine still serves code mass */ }
  for (const [, depths] of map) for (const arr of depths) arr.sort((a, b) => b.gz - a.gz);

  return {
    stats: { chunks: n, sighted, meta, sighted_pct: +(100 * sighted / Math.max(1, n)).toFixed(1), coords: map.size, bands: { depth0: [d0lo, d0hi], depth1: [d1lo, d1hi] } },
    /** collide(coord, depth) → the heaviest un-consumed chunk ref at this coordinate+resolution, O(1). */
    collide(coord, depth = 0) {
      const depths = map.get(String(coord));
      if (!depths) return null;
      const arr = depths[depth] || [];
      // heaviest not-yet-consumed (a consumed flag lets the loop mark seats without re-sorting)
      for (const r of arr) if (!r._consumed) return r;
      return null;
    },
    /** mark a ref consumed so the next collide skips it (the loop's seat receipt). */
    consume(ref) { if (ref) ref._consumed = true; },
    /** how much heavy mass sits un-consumed at a coordinate (the vacuum's supply). */
    supplyAt(coord, depth = 0) {
      const depths = map.get(String(coord));
      if (!depths) return 0;
      return (depths[depth] || []).filter((r) => !r._consumed).length;
    },
    /**
     * resolvePrompt(prompt, k) — THE USEFUL PATH (operator 2026-07-23: "connect prompt injection
     * to indexed RAM walks on the code"). Place the prompt at its coordinate (NCD vs the 144 cell
     * anchors — the one unavoidable cold cost, ~17ms/144-NCDs), then pull the live REPO MASS at
     * that coordinate from RAM (O(1), ~0.09ms). Returns { coord, ncd, mass } where mass is the k
     * heaviest code chunk REFS at the prompt's coordinate — resolve their bytes on demand (custody).
     * This is what a lens injects on top of its rules: the actual code that lives where the prompt
     * landed, matched to BOTH apertures (depth-0 macro, depth-1 micro). LLM-free, deterministic.
     */
    resolvePrompt(prompt, { k = 6, anchors = null } = {}) {
      // anchors = [[coord, dumpText], ...]; caller passes the 144 cell dumps (the placement basis)
      if (!anchors) return { coord: null, ncd: null, mass: [], note: 'pass anchors: the 144 cell dumps to place against' };
      const p = String(prompt || '').slice(0, 4000);
      const gp = gzipSync(Buffer.from(p, 'utf8')).length;
      let best = null, bd = 2;
      for (const [coord, dump] of anchors) {
        if (!dump || dump.length < 80) continue;
        const gd = gzipSync(Buffer.from(dump, 'utf8')).length;
        const gab = gzipSync(Buffer.from(p + '\n' + dump, 'utf8')).length;
        const mx = Math.max(gp, gd); const d = mx === 0 ? 1 : (gab - Math.min(gp, gd)) / mx;
        if (d < bd) { bd = d; best = coord; }
      }
      if (!best) return { coord: null, ncd: null, mass: [] };
      const depths = map.get(best) || [[], []];
      const mass = [...(depths[0] || []).slice(0, k), ...(depths[1] || []).slice(0, k)]
        .filter((r) => !r._consumed).sort((a, b) => b.gz - a.gz).slice(0, k)
        .map((r) => ({ src: r.src, gz: r.gz, len: r.len, coord: r.coord, raw_sha: r.raw_sha, kind: r.kind || "code" }));
      return { coord: best, ncd: +bd.toFixed(4), mass, supply: { depth0: this.supplyAt(best, 0), depth1: this.supplyAt(best, 1) } };
    },
    /**
     * walkMass(text) — MIRROR THE DEFINER WALK ON THE INDEX (operator 2026-07-22: "first make it
     * useful, then mirror the definer walk here"). Instead of pulling mass at ONE coordinate,
     * run THE ONE WALK (walkShape — the same real recursive on-chip ballistic engine the commit gate
     * and lens run; NEVER an analytic BFS) and attach the RAM code-mass at EVERY coordinate the walk
     * lit, ranked by the walk's own heat. This fuses the collision engine with the on-chip walk: the
     * walk decides WHICH coordinates (the definer chain — a cell's definer, then its definer's
     * definer), the collision engine decides WHICH code lives at each (heaviest gz first). Refs-only,
     * so custody (raw_sha) is preserved — bytes resolve from the immutable file only when seated.
     * Returns the definer chain WITH code mass — the pre-magnetized runway a lens injects.
     */
    async walkMass(text, { refsPerCoord = 4, maxCoords = 12 } = {}) {
      const w = await walkShape(String(text || ''), { opts: CHAT_WALK_OPTS, timeoutMs: WALK_TIMEOUT_MS });
      // the walk footprint = the definer chain; pair each lit cell with its heat (definition centrality)
      const lit = [...w.shape].map((i) => ({ coord: COORDS[i], heat: w.heat[i] || 0 }))
        .filter((c) => c.coord).sort((a, b) => b.heat - a.heat).slice(0, maxCoords);
      const chain = lit.map(({ coord, heat }) => {
        const depths = map.get(coord) || [[], []];
        const refs = [...(depths[0] || []).slice(0, refsPerCoord), ...(depths[1] || []).slice(0, refsPerCoord)]
          .filter((r) => !r._consumed).sort((a, b) => b.gz - a.gz).slice(0, refsPerCoord)
          .map((r) => ({ src: r.src, gz: r.gz, len: r.len, coord: r.coord, raw_sha: r.raw_sha, kind: r.kind || "code" }));  // refs-only
        return { coord, heat: +Number(heat).toFixed(4), supply: { depth0: this.supplyAt(coord, 0), depth1: this.supplyAt(coord, 1) }, refs };
      });
      return {
        seed: w.seedCoords || w.seed, plies: w.plies, hops: w.hops, sensor: w.sensor,
        footprint: lit.length, ms: w.ms,
        chain,                                    // the definer chain with code mass, refs-only
        massRefs: chain.reduce((n, c) => n + c.refs.length, 0),
      };
    },
    /**
     * coinRead(text) — THE TWO SIDES OF ONE COIN (operator 2026-07-22: "the tesseract expand and
     * the prompt injection correctness are two sides of the coin"). Run ONE definer walk (walkMass)
     * and PARTITION its footprint by grip: a coordinate the walk lit that HAS code mass is the
     * INJECT side (retrieval — the rules/mass that live there constrain the LLM); a coordinate the
     * walk lit that has NO mass is the EXPAND side (the vacuum THIS prompt just proved must grow).
     * Same walk, read two ways. The partition is TOTAL and DISJOINT — every walked coordinate is
     * exactly one side — which is what makes "two sides of one coin" a mechanical fact, not a figure
     * of speech: grip you can serve is injection correctness; grip you can't is expansion demand.
     * LLM-free, deterministic. (Mass QUALITY at each coord still rides on the index fix — a coord
     * that "has mass" today may hold book/transcript text until the transcript path is bundled.)
     */
    async coinRead(text, { supplyFloor = 1 } = {}) {
      const w = await this.walkMass(text);
      const inject = [], expand = [];
      for (const c of w.chain) {
        const supply = c.supply.depth0 + c.supply.depth1;
        if (supply >= supplyFloor && c.refs.length) inject.push(c);                 // serve now
        else expand.push({ coord: c.coord, heat: c.heat });                         // demand this prompt generated
      }
      return {
        footprint: w.footprint, plies: w.plies, hops: w.hops, sensor: w.sensor,
        inject,                                   // coords the tesseract can SERVE (injection correctness)
        expand,                                   // coords this prompt proves are VACUUMS (expansion demand)
        gripPct: w.footprint ? +(100 * inject.length / w.footprint).toFixed(1) : 0, // the coin's read: served / walked
      };
    },
    /**
     * injectionPayload(text) — THE TIER-1 WIRE, PRIMED (operator 2026-07-22: "keep the live lens
     * insertion primed so the moment the transcript-index cleanup lands the magnet goes live WITHOUT
     * injecting narrative prose into code lanes"). Produces the {code + rules + hats} the lens injects
     * on top of its rules — the pre-magnetized runway — from the inject side of the coin.
     * PROSE-SAFE BY CONSTRUCTION: book/transcript/audiobook sources are filtered out HERE, so even if
     * the flag is flipped on today's book-heavy index, no narrative prose reaches a code lane; it
     * degrades to whatever code/rule/hat mass exists (honest, never wrong). When builder lands the
     * kind field (code|rule|hat), the same filter keeps only those kinds. Refs-only; custody holds.
     */
    async injectionPayload(text, { maxRefs = 8, coord = null } = {}) {
      const PROSE = /books\/|audiobook|transcript|FULL-BOOK|\.epub|\/exports\//i;   // narrative sources barred from code lanes
      const clean = (arr) => arr
        .filter((ref) => !PROSE.test(String(ref.src || '')) && (!ref.kind || ['code', 'rule', 'hat'].includes(ref.kind)))
        .map((ref) => ({ coord: ref.coord, kind: ref.kind || 'code', src: ref.src, gz: ref.gz, raw_sha: ref.raw_sha }));
      // RECONCILED FAST PATH (walk/router gap fix): when the LENS passes the coordinate it already
      // routed to, pull mass THERE in O(1) — no second walk (kills the 168ms), no placement mismatch.
      if (coord) {
        const depths = map.get(String(coord)) || [[], []];
        const refs = [...clean(depths[0] || []), ...clean(depths[1] || [])].sort((a, b) => b.gz - a.gz);
        const total = (depths[0] || []).length + (depths[1] || []).length;
        return { coord: String(coord), placed_by: 'lens-router', gripPct: null, refs: refs.slice(0, maxRefs), prose_filtered: total - refs.length, expand: [] };
      }
      // WALK PATH (standalone): place via the on-chip walk when no lens coordinate is given.
      const r = await this.coinRead(text);
      const refs = [];
      for (const c of r.inject) for (const ref of clean(c.refs)) refs.push(ref);
      refs.sort((a, b) => b.gz - a.gz);
      return {
        coord: r.inject[0] ? r.inject[0].coord : null,
        placed_by: 'walk',
        gripPct: r.gripPct,
        refs: refs.slice(0, maxRefs),                     // the injection block — code/rule/hat refs, prose-filtered
        prose_filtered: r.inject.reduce((n, c) => n + c.refs.length, 0) - refs.length,
        expand: r.expand.map((e) => e.coord),             // coords with no servable mass (the demand this prompt made)
      };
    },
    _map: map,
  };
}

// ── MEASUREMENT HARNESS (proves the throughput floor) ────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const eng = loadCollisionEngine();
  const loadMs = Date.now() - t0;
  console.log(`mass-collision engine loaded in ${loadMs}ms · ${eng.stats.chunks} chunks · ${eng.stats.sighted_pct}% sighted · ${eng.stats.coords} coords`);
  console.log(`  bands: depth-0 [${eng.stats.bands.depth0}] · depth-1 [${eng.stats.bands.depth1}]`);
  // throughput: N random collisions
  const coords = [...eng._map.keys()];
  const t1 = Date.now(); const N = 1_000_000; let hits = 0;
  for (let i = 0; i < N; i++) { const c = coords[i % coords.length]; if (eng.collide(c, i & 1)) hits++; }
  const per = (Date.now() - t1) / N;
  console.log(`\n  ${N.toLocaleString()} collisions in ${Date.now() - t1}ms = ${per.toFixed(6)}ms each = ${(1000 / per / 1e6).toFixed(1)}M collisions/sec`);
  console.log(`  vs on-the-fly gzip shootout (~0.37ms): ${Math.round(0.37 / per).toLocaleString()}x faster`);
}
