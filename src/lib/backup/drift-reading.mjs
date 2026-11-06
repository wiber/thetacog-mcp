// src/lib/backup/drift-reading.mjs — C456 THE BACKED-UP TAPE, SEEN ON OUR SITE (operator 2026-09-29, verbatim: "backing up to
// tape and seeing the visualizations on our site is enough to justify the experience" · "you can measure the drift on our
// website … because it doesn't have to look at your code directly").
//
// The data loader for /backup/drift?manifest=<sha>. The page never has the licence holder's code, so it reads ONLY receipt
// fields off their flight-tape rows (scripts/vna/flight-tape.mjs: seq · ts · kind · sha · row_sha · proofs.items[] (the spec
// basin hash each commit satisfied) · proofs.guards[] (label + status) · delta (our walker's drift Δ)). receiptOnly() is an
// ALLOWLIST projection: anything else a row carries — the actor's turns in `seed`, a gauge, a diff, file content, a signature
// blob — never leaves this module. RECEIPT_FIELDS is exported so the page and its guard read the one list.
//
// The per-row word is readingOf (src/lib/vna/row-canonical.mjs — C92b, the rule verify-url.mjs re-exports, the same three
// words `npx thetacog-mcp verify <url>` prints), never a second rule; an absent reading is null and renders UNMEASURED, never a zero.
//
// Sufficient for: WHERE each commit landed against the spec rows it declared, and when it jumped lanes — re-runnable from the
// receipts. NOT sufficient for: whether the agent's work was good (Rice — undecidable, and not claimed here).
// Port row: none — this is a projection over fields another module decided; the reading itself lives in row-canonical.mjs.
// @guard tests/site/c456-backup-drift-page.test.mjs
// @guard tests/site/c479-repo-view.test.mjs
import { readingOf } from '../vna/row-canonical.mjs';

export const RECEIPT_FIELDS = [
  'seq', 'ts', 'kind', 'sha', 'row_sha',
  'proofs', 'proofs.items', 'proofs.items[].label', 'proofs.items[].id', 'proofs.items[].hash', 'proofs.items[].verified',
  'proofs.guards', 'proofs.guards[].label', 'proofs.guards[].status',
  'delta', 'delta.status', 'delta.driftPct', 'delta.offPct', 'delta.sigmaDrift', 'delta.laneJump',
  // C479: the coordinate the Rust walk (lensWalk, via spec-tree seedLeaf) wrote onto a turn row at seed.pixel, and onto each
  // batch turn at seed.turns[].pixel — renamed out of `seed` so none of seed's other fields (the actor's turns) can ride along.
  'placements', 'placements[].pixel', 'placements[].leaf',
];

// a ShortLex lattice address as the walk writes it ("A2,C" · "C2,B3") — a shape check on the COPY, never a placement: an
// address the walk did not write in this shape is dropped (UNMEASURED), never repaired. C483: exported — the flight-tape
// writer (scripts/vna/flight-tape.mjs turnSeed) keeps a turn's pixel by this one rule, so the writer and the reader never drift
export const PIXEL = /^[A-Z][0-9]*(?:\.[0-9]+)*,[A-Z][0-9]*(?:\.[0-9]+)*$/;
const LEAF = /^[A-Za-z0-9._:-]{1,64}$/;
const placementOf = (t) => {
  if (!t || typeof t !== 'object') return null;
  const pixel = typeof t.pixel === 'string' && PIXEL.test(t.pixel) ? t.pixel : null;
  const lf = typeof t.label === 'string' ? t.label : typeof t.leaf === 'string' ? t.leaf : null;
  const leaf = lf && LEAF.test(lf) ? lf : null;
  return pixel || leaf ? { pixel, leaf } : null;
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : v == null ? null : String(v));
const pick = (o, keys, fix = {}) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, fix[k] ? fix[k](o[k]) : o[k]]));

/** the receipt fields of one tape row, and nothing else */
export function receiptOnly(row) {
  const r = row && typeof row === 'object' ? row : {};
  const out = pick(r, ['seq', 'ts', 'kind', 'sha', 'row_sha'], { seq: num, ts: str, kind: str, sha: str, row_sha: str });
  const p = r.proofs && typeof r.proofs === 'object' ? r.proofs : null;
  if (p) {
    out.proofs = {};
    if (Array.isArray(p.items)) out.proofs.items = p.items.filter((i) => i && typeof i === 'object').map((i) => pick(i, ['label', 'id', 'hash', 'verified'], { label: str, id: str, hash: str, verified: (v) => v === true }));
    if (Array.isArray(p.guards)) out.proofs.guards = p.guards.filter((g) => g && typeof g === 'object').map((g) => pick(g, ['label', 'status'], { label: str, status: str }));
  }
  const d = r.delta && typeof r.delta === 'object' ? r.delta : null;
  if (d) out.delta = pick(d, ['status', 'driftPct', 'offPct', 'sigmaDrift', 'laneJump'], { status: str, driftPct: num, offPct: num, sigmaDrift: num, laneJump: num });
  // a raw tape row carries its walk's address in `seed`; a row already projected (rowsFor hands these on) carries `placements`
  const s = r.seed && typeof r.seed === 'object' ? r.seed : null;
  const src = s ? (Array.isArray(s.turns) ? s.turns : [s]) : Array.isArray(r.placements) ? r.placements : [];
  const placed = src.map(placementOf).filter(Boolean);
  if (placed.length) out.placements = placed;
  return out;
}

/** verify-url's three words, as the page prints them */
export function wordOf(row) {
  const w = readingOf(row);
  return w === 'in lane' ? 'in lane' : w.startsWith('off lane') ? 'off lane' : 'UNMEASURED';
}

// C516 — THE LATE ARRIVAL. The tape is append-only and signed, so a drift walk that lands after its commit row was
// taped never rewrites that row: it rides a SEPARATE `kind:'delta'` row (scripts/vna/flight-tape.mjs appendDeltaIfLanded
// / --backfill-deltas), {sha, delta}. Every reader of a commit row folds the newest delta row for that sha onto it —
// here, once, over the whole raw array, before any one row is projected. A `delta` row carries no reading of its own
// (no proofs, no kind the page draws) and never becomes a point; it is read only to fill another row's delta field,
// and only while that row still says "not yet" OR "never walked" (C524 — a commit the bounded catch-up finally walks
// still arrives this way; `never_walked` is read-live and can still resolve to `landed` later) — W4: retention is
// prospective-only, never a rewrite of a landed reading.
export function foldDeltas(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bySha = new Map();
  for (const r of list) {
    if (!r || r.kind !== 'delta' || typeof r.sha !== 'string' || !r.delta) continue;
    const prior = bySha.get(r.sha);
    if (!prior || (r.seq ?? 0) > (prior.seq ?? 0)) bySha.set(r.sha, r.delta);
  }
  const kept = list.filter((r) => r && r.kind !== 'delta');
  if (!bySha.size) return kept;
  const stillOpen = (s) => typeof s === 'string' && (s.startsWith('not yet') || s.startsWith('never walked'));
  return kept.map((r) => {
    const d = r && typeof r.sha === 'string' ? bySha.get(r.sha) : null;
    if (!d || !r.delta || !stillOpen(r.delta.status)) return r;
    return { ...r, delta: d };
  });
}

/** placements over time, per spec hash, and the lane jumps — every absent reading null, never 0 */
export function driftReading(rows) {
  const receipts = foldDeltas(rows).map(receiptOnly)
    .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')) || (a.seq ?? 0) - (b.seq ?? 0));
  const landed = (r) => r.delta && r.delta.status === 'landed';
  const points = receipts.map((r) => ({
    seq: r.seq ?? null, ts: r.ts ?? null, kind: r.kind ?? null, sha: r.sha ?? null, row_sha: r.row_sha ?? null,
    reading: wordOf(r),
    specs: (r.proofs && r.proofs.items ? r.proofs.items : []).map((i) => i.hash).filter(Boolean),
    driftPct: landed(r) ? r.delta.driftPct ?? null : null,
    offPct: landed(r) ? r.delta.offPct ?? null : null,
    laneJump: landed(r) ? r.delta.laneJump ?? null : null,
    deltaStatus: r.delta ? r.delta.status ?? null : null,
  }));
  const spec = new Map();
  for (const r of receipts) for (const i of (r.proofs && r.proofs.items) || []) {
    if (!i.hash) continue;
    const s = spec.get(i.hash) || { hash: i.hash, label: i.label ?? null, in: 0, off: 0, unmeasured: 0 };
    const w = wordOf(r); if (w === 'in lane') s.in++; else if (w === 'off lane') s.off++; else s.unmeasured++;
    spec.set(i.hash, s);
  }
  const measuredJumps = points.filter((p) => p.laneJump !== null);
  const laneJumps = points.length
    ? { count: measuredJumps.length ? measuredJumps.filter((p) => p.laneJump > 0).length : null, measured: measuredJumps.length, unmeasured: points.length - measuredJumps.length }
    : { count: null, measured: 0, unmeasured: 0 };
  return { status: points.length ? 'read' : 'UNMEASURED', points, bySpec: [...spec.values()], laneJumps };
}
