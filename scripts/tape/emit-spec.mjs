// packages/thetacog-mcp/scripts/tape/emit-spec.mjs — THE PLUMBER'S SHAPE, WRITTEN DOWN.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
// Operator, pointing at a context pane reading "THE SPEC — UNMEASURED, no spec source found":
//   "this is the plumber spec so to speak — needs to be the file (and the tesseract etc) so we can
//    tell when it acts like an electrician."
//
// The specification already exists: thirteen locked coordinates, each a rule placed on the lattice.
// But it lives ONLY as rows in coordinates.ndjson, and a ledger is not a document. Nothing could read
// it AS a spec — which is why the spec bucket had nothing to classify, and, far worse, why there was
// no reference SHAPE to measure a tradesman against. You cannot notice the plumber wiring a socket if
// you never wrote down what plumbing looks like.
//
// ── THE SHAPE IS THE POINT, NOT THE PROSE ─────────────────────────────────────────────────────
// A spec as prose tells you what was decided. A spec as a SHAPE tells you when new work stops
// belonging to it. So this emits both, and the shape is the load-bearing half:
//
//   · the CENTRE and WIDTH of the cone the coordinates form (coordinates.mjs cone())
//   · the OCCUPANCY — which of the 144 cells are claimed, and how heavily
//   · the AXIS PULL — how much mass sits on each of the 12 ShortLex ranks, row and column
//
// That triple is the trade's signature. A commit that lands far from the centre, or lights ranks the
// spec never touches, is the electrician's hand — and it is decidable, not a judgement call.
//
// ── DERIVED, THEREFORE NEVER THE PLACE STATE IS AUTHORED ──────────────────────────────────────
// Both artifacts are regenerated from the ndjson every time. This repo has an incident for editing a
// generated file (seven live person pages deleted by the next regeneration, with no diff explaining
// it), so: edit the ledger, never these. Emitting is idempotent and the outputs are disposable.
//
// ── THE JSON IS THE PUBLISHED FORMAT ──────────────────────────────────────────────────────────
// Operator: "the tape must be the same json tape we publish online in the github — this is just one
// way to spec a role from a mass of text." So spec.json is written to be portable: a fork carries it,
// reads it, and has the whole specification plus the shape to check its own work against. The machine
// stays private; the FORMAT is public.
//
//   node emit-spec.mjs --slug gddadwill [--json]
//
// @guard tests/tape/emit-spec-is-derived.test.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');
const SHORTLEX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const NAMES = {
  A: 'Strategy', B: 'Tactics', C: 'Operations',
  A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
  B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal',
  C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow',
};
const label = (c) => (c ? `${c} (${NAMES[String(c).split(',')[0]] || '?'} ⊕ ${NAMES[String(c).split(',')[1]] || '?'})` : 'UNPLACED');

/**
 * THE TRADE'S SIGNATURE — occupancy + axis pull + cone. This is what a later commit is measured
 * against, so it is computed here and stored, never re-derived by whoever wants to compare.
 */
export function shapeOf(coords) {
  const placed = coords.filter((c) => c.coord);
  const cells = {};
  const rowPull = Object.fromEntries(SHORTLEX.map((r) => [r, 0]));
  const colPull = Object.fromEntries(SHORTLEX.map((r) => [r, 0]));
  for (const c of placed) {
    cells[c.coord] = (cells[c.coord] || 0) + 1;
    const [r, k] = String(c.coord).split(',');
    if (r in rowPull) rowPull[r] += 1;
    if (k in colPull) colPull[k] += 1;
  }
  const occupied = Object.keys(cells);
  return {
    n: coords.length,
    placed: placed.length,
    unplaced: coords.length - placed.length,
    cellsOccupied: occupied.length,
    ofCells: 144,
    breadthPct: +((occupied.length / 144) * 100).toFixed(2),
    // heaviest first — the cells this trade actually works in
    occupancy: Object.entries(cells).sort((a, b) => b[1] - a[1]).map(([coord, n]) => ({ coord, label: label(coord), n })),
    rowPull: Object.entries(rowPull).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([rank, n]) => ({ rank, name: NAMES[rank], n })),
    colPull: Object.entries(colPull).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([rank, n]) => ({ rank, name: NAMES[rank], n })),
  };
}

export async function emitSpec(slug) {
  const dir = resolve(SESSIONS, slug);
  if (!existsSync(dir)) return { ok: false, reason: `no session "${slug}"` };

  const { liveCoordinates, cone, coneMomentum } = await import(resolve(HERE, 'coordinates.mjs'));
  const coords = liveCoordinates(slug).filter((c) => c.rule);
  if (!coords.length) {
    return { ok: false, reason: `session "${slug}" has no locked coordinates — there is no specification to emit yet, which is different from an empty one` };
  }

  const shape = shapeOf(coords);
  const theCone = cone(coords);
  let momentum = null;
  try { momentum = coneMomentum(coords); } catch { /* fewer than the minimum — reported as null, never as zero */ }

  const spec = {
    // ── the published contract. A fork reads THIS. ──
    formatVersion: 1,
    kind: 'thetacog-tape-spec',
    slug,
    emittedAt: new Date().toISOString(),
    note: 'DERIVED from coordinates.ndjson. Edit the ledger, never this file — it is regenerated and your edit would vanish with no diff explaining it.',
    requirements: coords.map((c) => ({
      id: c.id,
      rule: c.rule,
      coordinate: c.coord || null,
      coordinateLabel: label(c.coord),
      sigma: Number.isFinite(c.sigma) ? c.sigma : null,
      sensor: c.sensor || null,
      owns: (c.owns || []).filter((o) => o.kind === 'code').map((o) => o.file),
      lockedAt: c.ts || null,
      lockedBy: c.createdBy || null,
      unmeasured: c.coord ? null : (c.unmeasured || 'this rule was never placed on the lattice'),
    })),
    // ── THE TRADE'S SHAPE — what makes an electrician detectable ──
    shape,
    cone: {
      centre: theCone?.centre ?? null,
      centreLabel: theCone?.centreLabel ?? null,
      width: theCone?.width ?? null,
      max: theCone?.max ?? null,
      provisional: theCone?.provisional ?? null,
      momentum: momentum?.verdict ?? null,
      momentumDetail: momentum ?? null,
    },
    howToCheckDrift: 'Place a candidate rule or commit with the same walk, then measure its Chebyshev distance from cone.centre. Beyond cone.width it is outside the trade this spec describes; a cell absent from shape.occupancy is work this spec has never claimed.',
  };
  // A digest over the requirements + shape (NOT emittedAt) so two emissions of an unchanged tape
  // produce the same id — otherwise "did the spec change?" is unanswerable.
  spec.specHash = createHash('sha256')
    .update(JSON.stringify({ requirements: spec.requirements, shape: spec.shape, cone: { centre: spec.cone.centre, width: spec.cone.width } }))
    .digest('hex');

  const md = [
    `# THE SPEC · ${slug}`,
    '',
    `> ${coords.length} locked coordinates. This document is DERIVED from coordinates.ndjson and is`,
    '> regenerated on every emit — edit the ledger, never this file.',
    '',
    `**Shape** — ${shape.cellsOccupied}/144 cells (${shape.breadthPct}%), cone centre ${spec.cone.centreLabel ?? 'UNMEASURED'}, width ${spec.cone.width ?? 'UNMEASURED'}${spec.cone.momentum ? `, momentum ${spec.cone.momentum}` : ''}.`,
    '',
    `**Spec hash** \`${spec.specHash.slice(0, 16)}\` — stable across emissions while the tape is unchanged.`,
    '',
    '## Requirements',
    '',
    ...spec.requirements.flatMap((r) => [
      `### ${r.id} — ${r.coordinateLabel}`,
      '',
      r.rule,
      '',
      r.owns.length ? `Implemented by: ${r.owns.map((f) => `\`${f}\``).join(', ')}` : '_No code surface discovered for this rule._',
      r.unmeasured ? `\n⚠ ${r.unmeasured}` : '',
      '',
    ]),
    '## The trade\'s shape',
    '',
    'Cells this spec claims, heaviest first — work landing outside them is a different trade:',
    '',
    ...spec.shape.occupancy.map((o) => `- \`${o.coord}\` ${o.label} — ${o.n} rule${o.n === 1 ? '' : 's'}`),
    '',
    '### Axis pull',
    '',
    `Row: ${spec.shape.rowPull.map((r) => `${r.rank}(${r.n})`).join(' · ')}`,
    '',
    `Column: ${spec.shape.colPull.map((r) => `${r.rank}(${r.n})`).join(' · ')}`,
    '',
    '## How to check drift',
    '',
    spec.howToCheckDrift,
    '',
  ].join('\n');

  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, 'spec.json');
  const mdPath = resolve(dir, 'SPEC.md');
  writeFileSync(jsonPath, `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(mdPath, md);

  return {
    ok: true,
    json: jsonPath.replace(`${REPO}/`, ''),
    md: mdPath.replace(`${REPO}/`, ''),
    requirements: spec.requirements.length,
    specHash: spec.specHash,
    shape: spec.shape,
    cone: spec.cone,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // stdout must be blocking before any exit or a large payload truncates at ~8188 bytes through a pipe
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const r = await emitSpec(slug);
  if (!r.ok) { console.error(`✗ ${r.reason}`); process.exit(2); }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`\n  THE SPEC · ${slug}`);
  console.log(`  ${r.requirements} requirements → ${r.md} + ${r.json}`);
  console.log(`  shape: ${r.shape.cellsOccupied}/144 cells (${r.shape.breadthPct}%) · cone ${r.cone.centreLabel ?? 'UNMEASURED'} width ${r.cone.width}${r.cone.momentum ? ` · ${r.cone.momentum}` : ''}`);
  console.log(`  hash: ${r.specHash.slice(0, 16)}`);
  console.log(`  heaviest cells: ${r.shape.occupancy.slice(0, 3).map((o) => `${o.coord}×${o.n}`).join(' · ')}\n`);
}
