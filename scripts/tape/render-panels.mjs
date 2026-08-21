// packages/thetacog-mcp/scripts/tape/render-panels.mjs — THE REAL ENCIRCLED PANEL, PER ATOM.
//
// ┌─ THE RULE THIS FILE EXISTS TO OBEY (CLAUDE.md · incident 2026-07-24) ───────────────────────┐
// │ The encircled panel is a RENDERED PNG produced by the shipped pipeline off the real Rust    │
// │ ballistic walk. It is NOT a bitmask, NOT a client-side decode, and above all NOT a 12×12    │
// │ grid drawn in SVG as a stand-in. Decoding intent/reality bits into a hand-drawn grid        │
// │ INVENTS the artifact instead of finding it — that is the documented incident, and it cost   │
// │ two rounds the last time. Render the real PNG when present, an honest "not rendered yet"    │
// │ placeholder when not. Never a fake grid.                                                    │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// The renderer is the running code, reached through THE ONE DOOR: `panel({ intent, reality, message })`
// in packages/thetacog-mcp/scripts/pmu/panel-door.mjs → composeEncircledPanel, engine
// `rust-ballistic-walk`. We drive it; we do not re-derive it.
//
// PER ATOM, the two apertures are:
//   INTENT  = the atom's VERBATIM quote (operator bytes — never a paraphrase, per the placement fix)
//   REALITY = the extracted rule today; the dispatched commit's diff once the loop closes
//             (measure-enforcement.mjs owns that second form — same gate, different reality text).
//
// MEASURED 2026-08-20: ~150–275 ms per panel, ~7 KB each, engine rust-ballistic-walk.
//
//   node packages/thetacog-mcp/scripts/tape/render-panels.mjs <slug> [--only DECISION-017] [--force]
//   node packages/thetacog-mcp/scripts/tape/render-panels.mjs <slug> --session-axes   # walk against
//     this session's own axes-144.json (scripts/pmu/pipeline-state.mjs::loadAxes override) instead
//     of the repo-wide 144 library. Written to a SEPARATE file (`-axoverride` suffix) so it never
//     collides with — or gets read back as a cache-hit for — the repo-axes panel.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

// axesPath is optional and purely a filename discriminator here — an override run must never be
// mistaken for (or clobber) the repo-axes cache the default path writes.
export function panelPath(slug, atomId, axesPath) {
  return resolve(SESSIONS, slug, 'html', 'receipts', `${atomId}${axesPath ? '-axoverride' : ''}.png`);
}
export function panelMetaPath(slug, atomId, axesPath) {
  return resolve(SESSIONS, slug, 'html', 'receipts', `${atomId}${axesPath ? '-axoverride' : ''}.json`);
}

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

/** Render ONE atom's encircled panel. Returns {ok, path, meta} or {ok:false, reason} — never a fake.
 *  `axesPath` (optional) — walk against THIS 144-cell library instead of the repo-wide default.
 *  Forwarded, unmodified, all the way down to pipeline-state.mjs::loadAxes; undefined here means the
 *  repo-wide library, exactly as before this option existed. */
export async function renderPanel(slug, atom, { force = false, axesPath } = {}) {
  const out = panelPath(slug, atom.id, axesPath);
  if (!force && existsSync(out) && statSync(out).size > 0) {
    let meta = null;
    try { meta = JSON.parse(readFileSync(panelMetaPath(slug, atom.id, axesPath), 'utf8')); } catch { /* meta optional */ }
    return { ok: true, path: out, cached: true, meta };
  }
  // ══ EXACTLY ONE DOOR — packages/thetacog-mcp/scripts/pmu/panel-door.mjs ═══════════════════════
  // There is one renderer in this repo: scripts/pmu/tolerance-panel.mjs::composeEncircledPanel
  // (walk → heatmaps → tolerance classify → region detect → encircled rings, LLM-free). This file
  // used to import that renderer DIRECTLY (the earlier version of this comment explained why that
  // was correct over the tesseract.mjs `pipelinePanels` wrapper, which drops `meta` and cannot pass
  // `message`). Direct-importing is now itself the second-door pattern: every file that reaches the
  // internals its own way is one more path that can silently drop something the next path doesn't.
  // `panel-door.mjs` IS that direct call — made once, correctly, behind one name and one argument
  // shape — so every OTHER caller (this file included) goes through it instead of re-deriving it.
  // Guard: tests/pmu/one-panel-door.test.mjs — this file's removal from the internals-callers
  // allowlist is the guard's own proof that migrating to the door is how the count goes down.
  //
  // On size: the underlying panel is 144×144 — one pixel per lattice cell. `scale` (default 4) is a
  // legibility upscale applied at ring-burn time, which is what the commit email itself ships, so a
  // 576px file is the 144×144 panel at the canonical scale, not a different artifact.
  const { panel } = await import(resolve(PKG, 'scripts/pmu/panel-door.mjs'));

  const intentText = String(atom.quote || '');       // VERBATIM operator bytes — never a paraphrase
  const realityText = String(atom.rule || '');
  if (!intentText || !realityText) return { ok: false, reason: 'atom is missing quote or rule' };

  const t0 = Date.now();
  const p = await panel({
    intent: intentText, reality: realityText,
    label: 'tape', sub: atom.id,
    message: intentText,     // ← the operator's own words, sliced into the rings
    axesPath,                // ← the seam: undefined/null = repo-wide 144 (default, unchanged)
  });
  if (p.unmeasured) return { ok: false, reason: p.unmeasured };
  if (!p?.png) return { ok: false, reason: 'renderer returned no png' };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, p.png);
  const meta = {
    atomId: atom.id, ms: Date.now() - t0, engine: p.meta?.engine || 'rust-ballistic-walk · panel-door.mjs (the one door)',
    axesPath: axesPath || null,
    offPct: p.meta?.offPct ?? null, green: p.meta?.green ?? null, amber: p.meta?.amber ?? null, red: p.meta?.red ?? null,
    region: p.meta?.region ?? null, tooMany: p.meta?.tooMany ?? null, domBlocks: p.meta?.domBlocks || null,
    // regions already carry FULL ShortLex names AND (because `message` was passed) the sliced words —
    // the door normalizes this shape, so no per-caller re-mapping is needed here anymore.
    regions: (p.regions || []).slice(0, 24).map((r) => ({ kind: r.kind, coord: r.coord, name: r.name, slices: (r.slices || []).map((m) => ({ clause: String(m.clause || '').slice(0, 160), coord: m.coord, sigma: m.sigma })), center: r.center, span: r.span })),
    renderedAt: new Date().toISOString(),
    lattice: '144×144 (one pixel per cell), rings burned at the canonical scale',
    intentIs: 'the atom verbatim quote (operator bytes)',
    realityIs: 'the extracted rule',
  };
  writeFileSync(panelMetaPath(slug, atom.id, axesPath), JSON.stringify(meta, null, 2));
  return { ok: true, path: out, cached: false, meta };
}

export async function renderAll(slug, { only = null, force = false, axesPath } = {}) {
  const atoms = liveAtoms(slug).filter((a) => (only ? a.id === only : true));
  const results = [];
  for (const a of atoms) {
    // Sequential on purpose: each render spawns the Rust walk, and a fan-out here would contend for
    // the same shared cache that the panel-repair incident scattered into a stray <sha>/ directory.
    results.push({ id: a.id, ...(await renderPanel(slug, a, { force, axesPath })) });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) { console.error('usage: node render-panels.mjs <slug> [--only <atomId>] [--force] [--session-axes]'); process.exit(2); }
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const force = process.argv.includes('--force');
  // --session-axes: walk against THIS session's own .../axes-144.json (built by axis-naming.mjs's
  // buildSessionAxes) instead of the repo-wide 144 library. No flag = today's behaviour, unchanged.
  const useSessionAxes = process.argv.includes('--session-axes');
  const axesPath = useSessionAxes ? resolve(SESSIONS, slug, 'axes-144.json') : undefined;
  if (useSessionAxes && !existsSync(axesPath)) {
    console.error(`✗ --session-axes given but no axes file at ${axesPath} — run axis-naming.mjs ${slug} first`);
    process.exit(2);
  }
  const rs = await renderAll(slug, { only, force, axesPath });
  let ok = 0;
  for (const r of rs) {
    if (r.ok) { ok++; console.log(`✓ ${r.id.padEnd(15)} ${r.cached ? 'cached' : String(r.meta?.ms || '?') + 'ms'} offPct=${r.meta?.offPct ?? '—'} green=${r.meta?.green ?? '—'} amber=${r.meta?.amber ?? '—'} red=${r.meta?.red ?? '—'}`); }
    else console.log(`✗ ${r.id.padEnd(15)} ${r.reason}`);
  }
  console.log(`\n${ok}/${rs.length} panels rendered — engine: ${rs.find((r) => r.meta?.engine)?.meta?.engine || 'n/a'}${axesPath ? ` — axesPath=${axesPath.replace(REPO + '/', '')}` : ''}`);
}
