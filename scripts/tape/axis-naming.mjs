// packages/thetacog-mcp/scripts/tape/axis-naming.mjs — SESSION-SCOPED AXIS NAMING for /tape.
//
// ┌─ THE IDEA (operator, 2026-08-20) ─────────────────────────────────────────────────────────────┐
// │ "computing the encircled PNG panel with 144 side named by the atoms — that should take it     │
// │ pretty far." Today the 144 lattice cells that NAME the encircled panel's regions are the       │
// │ repo-wide corpus (data/pmu/snippet-library-144.json) — one fixed meaning for coord "A2,B1"     │
// │ no matter what session is running. For a tape session, the axes should instead be NAMED BY     │
// │ THE SESSION'S OWN ATOMS: the session's extracted decisions become its coordinate system. This  │
// │ is BIG-MAP-FORMAT.md's "a node's meaning IS its compression corpus — the text the gzip         │
// │ aperture compresses against," applied one level down: not just the reef, but ONE TAPE'S reef.  │
// └────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// ── WHAT THIS FILE DOES, AND WHAT IT DOES NOT DO ───────────────────────────────────────────────
// It builds a 144-cell pairLib (data/pmu/snippet-library-144.json format) where each cell's
// `snippet` is either (a) the session's own atoms' VERBATIM quotes that landed at that coord, or
// (b) an honestly-marked fallback to the repo-wide snippet when the session has nothing there.
// That pairLib is the exact injection point `region-message.mjs::sliceMessageToRegions` already
// accepts (`{pairLib}`) — the seam this file was told to find rather than invent.
//
// IT DOES NOT — and per the build brief, MUST NOT — change how intentText/realityText get WALKED
// onto the 144×144 lattice. That walk (`runPipeline` in scripts/pmu/pipeline.mjs) reads its axis
// corpus via `loadAxes()` in pipeline-state.mjs, which hardcodes `LIB_144_PATH` at module scope with
// no override parameter anywhere in its call chain (`composeEncircledPanel` → `composeTolerancePanel`
// → `runPanelPipeline` → `runPipeline`). There is no exposed seam there, and none was hacked open —
// see the report this module's CLI prints, and the final report handed to the operator. The session
// axes therefore change WHICH REGION A CLAUSE OF THE MESSAGE IS FILED UNDER (the labeling), not the
// underlying green/amber/red tolerance classification (the walk). That is a real, measured, honestly
// bounded finding, not a workaround.
//
// @canonical  measured-not-asserted · verbatim-only · null-with-reason where session mass is absent
// @guard      none yet — this is the first build; a guard belongs in the SAME commit as any regression

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHORTLEX, representativeCoord, fullLabel, __internals__ } from './physics.mjs';
import { panelPath, panelMetaPath, renderPanel } from './render-panels.mjs';

const { gz, MIN_GZIP_BYTES: DEFAULT_FLOOR } = __internals__;

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');                 // packages/thetacog-mcp
const REPO = resolve(PKG, '..', '..');                 // repo root
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');
const REPO_LIB_PATH = resolve(REPO, 'data/pmu/snippet-library-144.json');

export function sessionAxesPath(slug) {
  return resolve(SESSIONS, slug, 'axes-144.json');
}

// ── the repo-wide 144, loaded WITH row/col/snippet intact (loadPairLib in region-message.mjs would
// strip row/col — we need them here to build a matching-shape fallback library) ──────────────────
function loadRepoLib144() {
  try {
    const arr = JSON.parse(readFileSync(REPO_LIB_PATH, 'utf8'));
    const cells = Array.isArray(arr) ? arr : (arr.anchors || arr.cells || []);
    const byCoord = new Map();
    for (const c of cells) {
      if (c && c.coord && c.snippet) byCoord.set(String(c.coord).trim(), { coord: String(c.coord).trim(), row: String(c.row || ''), col: String(c.col || ''), snippet: String(c.snippet) });
    }
    return byCoord;
  } catch (e) {
    return new Map();
  }
}

// ── FORK-FORWARD RESOLVER — copied verbatim from cli.mjs's liveAtoms(), byte-for-byte the same
// rule as store.mjs:resolveAtoms(): rows share ids, the LAST row per id is live, first-appearance
// order preserved. Not reimplemented differently — reused as the SAME algorithm, per TAPE-CONTRACT.
function liveAtoms(slug) {
  const f = resolve(SESSIONS, slug, 'specs.ndjson');
  if (!existsSync(f)) return [];
  const order = [], latest = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r?.id) continue;
    if (!latest.has(r.id)) order.push(r.id);
    latest.set(r.id, r);
  }
  return order.map((id) => latest.get(id));
}

// ── buildSessionAxes — the atoms name their own lattice ─────────────────────────────────────────
// For each of the 144 ShortLex×ShortLex cells: gather every LIVE atom whose representative `coord`
// is exactly this cell, concatenate their VERBATIM quotes (operator bytes, ordered by turn — NEVER
// a paraphrase, NEVER the extracted `rule` — the placement fix generalizes here exactly as the build
// brief names it), and test the assembled text against the gzip-mass floor (the same MIN_GZIP_BYTES
// floor physics.mjs already enforces for fidelity readings, reused rather than re-invented). A cell
// that clears the floor is `source:'session'`. A cell where atoms landed but the assembled text is
// still too thin is `source:'repo-thin'`, carrying the measured byte count as the reason. A cell
// with NO atoms at all is `source:'repo'`. Every cell always has SOME real text — never fabricated,
// never left empty.
export function buildSessionAxes(slug, { minChars = DEFAULT_FLOOR } = {}) {
  const dir = resolve(SESSIONS, slug);
  if (!existsSync(dir)) throw new Error(`no session '${slug}' under ${SESSIONS}`);

  const atoms = liveAtoms(slug).filter((a) => a && a.coord && a.quote);
  // group by representative coord — every atom already carries its own representative `coord`
  // (physics.representativeCoord ran once at placement time; we do not re-walk it here).
  const byCoord = new Map();
  for (const a of atoms.sort((x, y) => (x.turn ?? 0) - (y.turn ?? 0) || String(x.id).localeCompare(String(y.id)))) {
    if (!byCoord.has(a.coord)) byCoord.set(a.coord, []);
    byCoord.get(a.coord).push(a);
  }

  const repoLib = loadRepoLib144();
  const cells = [];
  const coveredCoords = [];
  const counts = { session: 0, repo: 0, repoThin: 0 };

  for (const row of SHORTLEX) {
    for (const col of SHORTLEX) {
      const coord = `${row},${col}`;
      const landed = byCoord.get(coord) || [];
      const repoFallback = repoLib.get(coord) || { coord, row, col, snippet: `(no repo snippet at ${coord} either — an ungrounded cell)` };

      if (!landed.length) {
        cells.push({ coord, row, col, snippet: repoFallback.snippet, source: 'repo', sessionAtomIds: [], gzBytes: null, note: 'no session atom placed here' });
        counts.repo++;
        continue;
      }

      const joined = landed.map((a) => String(a.quote).trim()).join('\n\n');
      const bytes = gz(joined);
      if (bytes >= minChars) {
        cells.push({ coord, row, col, snippet: joined, source: 'session', sessionAtomIds: landed.map((a) => a.id), gzBytes: bytes, note: null });
        counts.session++;
        coveredCoords.push(coord);
      } else {
        cells.push({
          coord, row, col, snippet: repoFallback.snippet, source: 'repo-thin', sessionAtomIds: landed.map((a) => a.id),
          gzBytes: bytes, note: `session text below the phantom-mass floor (gzip ${bytes} < ${minChars}) — fell back to repo`,
        });
        counts.repoThin++;
      }
    }
  }

  const out = sessionAxesPath(slug);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cells, null, 2));

  return { cells, counts, coveredCoords, path: out, sessionAtomCount: atoms.length };
}

// ── renderWithSessionAxes — render one atom's panel and re-label its regions with the session's
// own axes, then diff against the repo-axis panel already on disk. ────────────────────────────────
//
// THE SEAM: `region-message.mjs::sliceMessageToRegions(message, regions, {pairLib})` accepts an
// INJECTED pairLib. `composeEncircledPanel` (tolerance-panel.mjs) calls that function internally
// but with NO way to pass a pairLib through — it always uses the default (repo-wide) library. That
// is the honest boundary of the seam: we cannot change composeEncircledPanel's signature (out of
// scope for this commit, and doing so from here would be exactly the "second way to run the
// pipeline" render-panels.mjs's header warns against). What we CAN do, without touching either file,
// is call composeEncircledPanel the SAME way render-panels.mjs does (the one door, direct import,
// intentText/realityText/label/sub — but WITHOUT `message`, so its internal default-pairLib slicing
// never runs), then call `sliceMessageToRegions` OURSELVES on the returned `regions` with the
// session pairLib injected. The rendered PNG's pixels (the walk, the tolerance classification, the
// ring shapes) are UNCHANGED by this — those come from the walk, not from message-labeling. Only
// the region metadata (`messageSlice`) — which clause of the atom's quote is filed under which
// region — changes. That is the true and complete scope of "session-scoped axis naming" as it
// actually reaches the panel today, and this file says so rather than overclaiming a walk-level
// change that does not exist.
export async function renderWithSessionAxes(slug, atom, { force = false } = {}) {
  if (!atom || !atom.id) throw new Error('renderWithSessionAxes needs an atom with an id');
  const intentText = String(atom.quote || '');
  const realityText = String(atom.rule || '');
  if (!intentText || !realityText) return { ok: false, reason: 'atom is missing quote or rule' };

  const axesPath = sessionAxesPath(slug);
  if (!existsSync(axesPath)) return { ok: false, reason: `no session axes at ${axesPath} — run buildSessionAxes(slug) first` };

  const outPng = resolve(SESSIONS, slug, 'html', 'receipts', `${atom.id}-session.png`);
  const outMeta = resolve(SESSIONS, slug, 'html', 'receipts', `${atom.id}-session.json`);

  // ── repo-axis baseline: reuse render-panels.mjs's own renderPanel (the exact same door), never
  // a second implementation of the repo-axis call. Renders it if it isn't already on disk.
  const repoBaseline = await renderPanel(slug, atom, { force: false });
  if (!repoBaseline.ok) return { ok: false, reason: `repo-axis baseline failed: ${repoBaseline.reason}` };

  if (!force && existsSync(outPng) && existsSync(outMeta)) {
    const meta = JSON.parse(readFileSync(outMeta, 'utf8'));
    return { ok: true, path: outPng, cached: true, meta, repoBaseline: repoBaseline.meta };
  }

  const { composeEncircledPanel } = await import(resolve(PKG, 'scripts/pmu/tolerance-panel.mjs'));
  const { sliceMessageToRegions, loadPairLib } = await import(resolve(REPO, 'scripts/pmu/region-message.mjs'));

  const t0 = Date.now();
  let p;
  try {
    // NO `message` here on purpose — see the header note above. We label the regions ourselves,
    // below, with the session pairLib injected through the seam sliceMessageToRegions exposes.
    p = await composeEncircledPanel({ intentText, realityText, label: 'tape', sub: `${atom.id}-session` });
  } catch (e) {
    return { ok: false, reason: `renderer threw: ${e.message}` };
  }
  if (!p?.png) return { ok: false, reason: 'renderer returned no png' };

  const sessionPairLib = loadPairLib(axesPath);
  const sliceResult = sliceMessageToRegions(intentText, p.regions, { pairLib: sessionPairLib });

  mkdirSync(dirname(outPng), { recursive: true });
  writeFileSync(outPng, Buffer.isBuffer(p.png) ? p.png : Buffer.from(p.png));

  // ── measured delta vs the repo-axis baseline already on disk ─────────────────────────────────
  const repoClauseCount = (repoBaseline.meta?.regions || []).reduce((n, r) => n + (r.slices || []).length, 0);
  const sessionClauseCount = (p.regions || []).reduce((n, r) => n + (r.messageSlice || []).length, 0);

  const meta = {
    atomId: atom.id, ms: Date.now() - t0,
    engine: 'rust-ballistic-walk · tolerance-panel.mjs (the one door) · session pairLib injected at region-message.mjs seam',
    axesPath, sessionPairLibSize: sessionPairLib.length,
    offPct: p.meta?.offPct ?? null, green: p.meta?.green ?? null, amber: p.meta?.amber ?? null, red: p.meta?.red ?? null,
    regions: (p.regions || []).slice(0, 24).map((r) => ({
      kind: r.kind, coord: r.coord, name: r.name,
      slices: Array.isArray(r.messageSlice) ? r.messageSlice.map((m) => ({ clause: String(m.clause || '').slice(0, 160), coord: m.coord, sigma: m.sigma })) : [],
      center: r.coord?.center ?? null, span: r.coord?.label ?? null,
    })),
    unplacedClauses: (sliceResult.unplaced || []).length,
    renderedAt: new Date().toISOString(),
    intentIs: 'the atom verbatim quote (operator bytes)', realityIs: 'the extracted rule',
    delta: {
      offPctSame: (p.meta?.offPct ?? null) === (repoBaseline.meta?.offPct ?? null),
      greenSame: (p.meta?.green ?? null) === (repoBaseline.meta?.green ?? null),
      amberSame: (p.meta?.amber ?? null) === (repoBaseline.meta?.amber ?? null),
      redSame: (p.meta?.red ?? null) === (repoBaseline.meta?.red ?? null),
      repoClauseCount, sessionClauseCount,
      note: 'offPct/green/amber/red come from the WALK (runPipeline), which reads no session axes — they are expected to match. clause counts come from region-message labeling, the actual seam — they are expected to differ.',
    },
  };
  writeFileSync(outMeta, JSON.stringify(meta, null, 2));
  return { ok: true, path: outPng, cached: false, meta, repoBaseline: repoBaseline.meta };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) { console.error('usage: node axis-naming.mjs <slug> [--render <atomId>]'); process.exit(2); }
  const renderId = process.argv.includes('--render') ? process.argv[process.argv.indexOf('--render') + 1] : null;

  const { cells, counts, coveredCoords, path, sessionAtomCount } = buildSessionAxes(slug);
  const total = cells.length;
  console.log(`\ntape axis-naming · ${slug}`);
  console.log(`  session atoms (live, coord+quote present): ${sessionAtomCount}`);
  console.log(`  144 cells → session:${counts.session}  repo-thin:${counts.repoThin}  repo:${counts.repo}`);
  console.log(`  coverage: ${counts.session}/${total} cells (${(100 * counts.session / total).toFixed(1)}%) named by this session's own atoms`);
  console.log(`  written → ${path.replace(REPO + '/', '')}\n`);

  if (counts.session) {
    console.log('  source      gzBytes  atoms                        full label');
    for (const c of cells.filter((c) => c.source !== 'repo')) {
      const lbl = await fullLabel(c.coord);
      console.log(`  ${c.source.padEnd(10)} ${String(c.gzBytes ?? '—').padStart(6)}   ${(c.sessionAtomIds.join(',') || '—').padEnd(28)} ${lbl}`);
    }
    console.log('');
  }

  if (renderId) {
    const atoms = liveAtoms(slug);
    const atom = atoms.find((a) => a.id === renderId);
    if (!atom) { console.error(`✗ no atom '${renderId}' in ${slug}`); process.exit(2); }
    const r = await renderWithSessionAxes(slug, atom, { force: true });
    if (!r.ok) { console.log(`✗ render failed: ${r.reason}`); process.exit(1); }
    console.log(`✓ session panel → ${r.path.replace(REPO + '/', '')}  ${r.cached ? '(cached)' : r.meta.ms + 'ms'}`);
    console.log(`  offPct ${r.meta.offPct} (repo ${r.repoBaseline?.offPct ?? '—'}, same=${r.meta.delta.offPctSame})`);
    console.log(`  green ${r.meta.green} amber ${r.meta.amber} red ${r.meta.red}  (repo ${r.repoBaseline?.green ?? '—'}/${r.repoBaseline?.amber ?? '—'}/${r.repoBaseline?.red ?? '—'})`);
    console.log(`  clauses placed into rings: session=${r.meta.delta.sessionClauseCount}  repo=${r.meta.delta.repoClauseCount}`);
    console.log(`  ${r.meta.delta.note}\n`);
  }
}
