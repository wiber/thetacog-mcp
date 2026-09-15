// scripts/pmu/lens-encircled-png.mjs — the per-PROMPT encircled PNG: THE ONE RUST WALK, through THE ONE DOOR.
// ============================================================================================
// CLAUDE.md HARD RULE (2026-09-11): "A LATTICE READING COMES FROM THE ONE RUST WALK — NEVER A NOUN-LIST
// PROXY … it's a 12x12 not a 144x144 — why would we not use the rust pipeline the same way always? that
// is the rule." THE INCIDENT THIS FILE REPLACES (2026-09-14): the previous version filled each walked
// ShortLex coord as a solid 12×12-pixel block (so the image had 144 distinct cells), coloured it by
// Chebyshev fence distance, and ran the region detector over that grid. No intent text, no reality text,
// no ballistic walk, no tolerance classify, no admissibility, no aperture stamp — a 12×12 painted large.
// Operator: "this is the totally wrong rust pipeline run! for the millionth time, we only get the brick
// on brick rsi if we call rust one way only - and ratchet aperture until it makes sense".
//
// NOW: intent = the FULL prompt · reality = the banks the lens picked (banksText — the SAME pairing the
// commit email's lens receipt ships, scripts/pmu/lens-receipt-email.mjs) · message = the prompt, so the
// operator's own clauses land in the rings. Rendered by panel() in panel-door.mjs → composeEncircledPanel
// → Rust ballistic walk → heatmaps → tolerance classify → Rust regions chip → encircled rings. The meta
// carries the PROOF, read off the pipeline's own stage records, never asserted here: walkEngine,
// regionEngine, admissibility (gzip mass floor), the aperture version in force, the axes library hash.
//
// REFUSES TO EMIT rather than emit a misleading picture (CLAUDE.md: "a generator must REFUSE to emit
// rather than emit a misleading empty artifact"): under the mass floor, on a lit-mass refusal, when the
// renderer is unavailable, or when either Rust engine did not run, latest.json says UNMEASURED with the
// reason and any STALE latest.png from an earlier prompt is REMOVED. Never a grid fallback.
//
// Each region carries its ShortLex coord + span, its written-out hat (hatName), and the RULES that live
// inside its ring — resolved by the lens's own retrieveRules over the region's block rectangle (the pile
// magnetized by the slice), named as name-the-pile stamps them. Runs DETACHED from the UserPromptSubmit
// lens (hooks never block). LLM-FREE. @guard tests/pmu-simulator/lens-encircled-png.test.mjs ·
// tests/pmu-simulator/one-encircled-pipeline.test.mjs (byte-identity with the commit-receipt chain)
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panel, canonicalMassFloor } from './panel-door.mjs';
import { hatName } from './shortlex-names.mjs';
import { shortLexToBlock } from './shortlex-coords.mjs';
import { ruleName } from './name-the-pile.mjs';
import { regionCoords } from './drift-seed.mjs';   // ONE expansion of a region rectangle → block coords (the seeder reads the same one)

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT_DIR = resolve(REPO, '.thetacog/lens-encircled');
// the two engine names the pipeline stamps on its own stage records (pipeline.mjs computeWalk ·
// regions-chip.mjs detectRegions). Compared VERBATIM — anything else is a fallback and is refused.
export const WALK_ENGINE = 'rust-ballistic-walk';
export const REGION_ENGINE = 'rust-regions-chip';

const reefDomains = (() => { try { return JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')).domains || []; } catch { return []; } })();

// THE RULES INSIDE A RING — the lens's own resolver (retrieveRules: curated core of the domain seated
// there + the SQLite perimeter whose blocks fall inside the rectangle, nearest-first), never a new lookup.
function rulesForRegion(region, intentText, retrieveRules) {
  const box = region.blockBox; if (!box || typeof retrieveRules !== 'function') return [];
  const center = region.center || region.coord?.center || ''; const { br, bc } = shortLexToBlock(center);
  const domainName = region.reef?.domain || null;
  const dom = domainName ? reefDomains.find((d) => d.domain === domainName) : null;
  try {
    const got = retrieveRules({ domain: domainName, domainRules: (dom && dom.rules) || [], box, block: [Number.isFinite(br) ? br : box.r0, Number.isFinite(bc) ? bc : box.c0] }, { intentText });
    return (got.rules || []).map((text) => {
      const key = String(text).slice(0, 60);
      const stamped = got.ruleNames && got.ruleNames[key];
      return { name: stamped || ruleName(text), named: !!stamped, text: String(text) };
    });
  } catch { return []; }
}

const atomicWrite = (file, buf) => { const tmp = file + '.tmp'; writeFileSync(tmp, buf); renameSync(tmp, file); };

// ── THE APERTURE RATCHET — THE INTENT IS THE THREAD, NOT THE LINE (operator 2026-09-14: "ratchet
// aperture until it makes sense"; the same turn: "it only shows the emojis"). A one-line prompt can never
// carry the 220-byte mass floor on its own, so measured bare it is UNMEASURED on most turns — an honest
// reading and a useless one. The thread is the intent: THIS prompt plus the session's prior prompts,
// newest first, appended until the gzip mass clears the floor — bounded (≤ MAX_THREAD_PROMPTS prompts,
// ≤ MAX_THREAD_CHARS chars). The prior prompts are read from the running session ledger the hook already
// writes (.thetacog/lens-receipts/<id>.json — writeReceipt stamps `session` + `prompt`), never a new tape.
// What was used is stamped in latest.json `intentSpan`. Reality stays banksText for the CURRENT prompt;
// `message` (the clauses sliced into the rings) stays the current prompt. If even the whole session is
// under the floor (first turn, "hi"), UNMEASURED stands with the reason. Measured by hand the day this
// shipped: a thread of 7 short prompts rendered admissible (918/1285 gzip, 39% off lane, 7 regions).
// The thread helpers live in src/lib/pmu/thread-aperture.mjs (ONE home — the tape door reads the same rung); re-exported here so existing importers keep working.
export { MAX_THREAD_PROMPTS, MAX_THREAD_CHARS, RECEIPT_SCAN, threadIntent } from '../../src/lib/pmu/thread-aperture.mjs';
import { threadIntent, DEFAULT_RECEIPTS } from '../../src/lib/pmu/thread-aperture.mjs';

// the in/out cell lists, derived from the regions: red wins over amber wins over green per block coord.
const BAND = { 1: 'green', 2: 'amber', 3: 'red' }, RANK = { red: 3, amber: 2, green: 1 };
export function lanesFromRegions(regions) {
  const best = new Map();
  for (const r of regions || []) {
    const band = BAND[r.kind]; if (!band) continue;
    for (const coord of regionCoords(r)) { const prev = best.get(coord); if (!prev || RANK[band] > RANK[prev.band]) best.set(coord, { coord, hat: hatName(coord), band, region: r.span || r.coord }); }
  }
  const all = [...best.values()];
  return { inLane: all.filter((c) => c.band === 'green'), outOfLane: all.filter((c) => c.band !== 'green') };
}

// the whole render, importable (the tests drive this; the CLI below is just the detached shell).
export async function renderLensEncircled(payload, { outDir = DEFAULT_OUT_DIR, receiptsDir = DEFAULT_RECEIPTS } = {}) {
  const p = payload || {};
  const { coord = '', domain = '', prompt = '' } = p;   // walked coords/fence in the payload are ignored: the lanes come from the panel
  mkdirSync(outDir, { recursive: true });
  const pngPath = resolve(outDir, 'latest.png'), jsonPath = resolve(outDir, 'latest.json');
  const { banksText, apertureVersion, retrieveRules } = await import('./prompt-lens.mjs');
  const reality = p.banksText != null ? String(p.banksText) : banksText(p);
  const t0 = Date.now();
  // the ratchet: the intent is the thread when the line alone is under the floor
  const thread = threadIntent(String(prompt), p.session || null, { receiptsDir });   // the floor is the binary's (aperture.rs); canonicalMassFloor() below is the JS mirror the admissibility read uses
  const intent = thread.text;
  const res = (intent.trim() && reality.trim())
    ? await panel({ intent, reality, message: String(prompt), label: 'lens', sub: 'prompt-altitude' })
    : { png: null, meta: null, regions: [], unmeasured: 'payload carries no prompt or no banks text — nothing to walk' };
  const m = res.meta || {};
  // THE REFUSAL LADDER — every rung names itself; the first that fires is the reason.
  let unmeasured = res.unmeasured || null;
  if (!unmeasured && m.refused) unmeasured = m.refusal || 'lit-mass floor refused';
  if (!unmeasured && m.admissible === false) unmeasured = 'NOT ADMISSIBLE — ' + (m.notAdmissible || 'mass floor');
  if (!unmeasured && m.admissible == null) unmeasured = m.unmeasured || 'admissibility UNMEASURED — the mass floor could not be read';
  if (!unmeasured && m.walkEngine !== WALK_ENGINE) unmeasured = `walk engine was ${JSON.stringify(m.walkEngine)} — not the Rust ballistic walk`;
  if (!unmeasured && m.regionEngine !== REGION_ENGINE) unmeasured = `region engine was ${JSON.stringify(m.regionEngine)} — not the Rust regions chip (build it: cargo build --release --manifest-path .thetacog/pmu/Cargo.toml)`;
  if (!unmeasured && !res.png) unmeasured = 'renderer returned no png';
  const ms = Date.now() - t0;

  const regions = unmeasured ? [] : (res.regions || []).map((r) => ({
    kind: r.kind, coord: r.center || null, span: r.span || null, blockBox: r.blockBox || null, blocks: r.blocks ?? null,
    hat: r.reef?.hat || hatName(r.center || ''), name: r.reef?.name || null, domain: r.reef?.domain || null, guessed: r.reef?.guessed ?? null,
    rules: rulesForRegion(r, String(prompt), retrieveRules),
    slices: (r.slices || []).map((s) => ({ clause: String(s.clause || '').slice(0, 160), coord: s.coord, sigma: s.sigma })),
  }));
  const meta = {
    at: p.at || new Date().toISOString(), coord, domain, hat: hatName(coord),
    apertureVersion: p.apertureVersion ?? null, apertureVersionAtRender: apertureVersion(),
    engine: m.engine ?? null, walkEngine: m.walkEngine ?? null, walkMode: m.walkMode ?? null, senseEngine: m.senseEngine ?? null, senseWitness: m.senseWitness ?? null, regionEngine: m.regionEngine ?? null,
    axes: m.axes ?? null, ms, pipelineMs: m.ms ?? null,
    admissible: m.admissible ?? null, intentGzip: m.intentGzip ?? null, realityGzip: m.realityGzip ?? null, massFloor: m.massFloor ?? null, apertureRatio: m.apertureRatio ?? null,
    refused: !!m.refused, litMass: m.litMass ?? null, edges: m.edges ?? null,
    offPct: unmeasured ? null : m.offPct ?? null, green: unmeasured ? null : m.green ?? null, amber: unmeasured ? null : m.amber ?? null, red: unmeasured ? null : m.red ?? null,
    domBlocks: m.domBlocks ?? null,
    regions,
    // DERIVED FROM THE PANEL'S REGIONS (2026-09-14), never from the walk's fence partition: red+amber
    // rectangles → outOfLane, green → inLane, each block coord hat-named and carrying its band. The
    // walked coords/fence the hook still sends are NOT consulted — drift-seed, spec-render and the
    // cockpit read the tolerance reading, not the 12×12 proxy.
    ...lanesFromRegions(regions),
    prompt: String(prompt), intent, intentSpan: thread.span, reality,
    unmeasured,
  };
  if (unmeasured) {
    // a PNG from an earlier prompt sitting beside a fresh latest.json is a lie — remove it.
    if (existsSync(pngPath)) { try { unlinkSync(pngPath); } catch { /* best effort — latest.json still says UNMEASURED */ } }
    atomicWrite(jsonPath, JSON.stringify(meta, null, 2));
    return { png: null, meta };
  }
  atomicWrite(pngPath, res.png);   // atomic — a reader never sees a half PNG
  atomicWrite(jsonPath, JSON.stringify(meta, null, 2));
  return { png: pngPath, meta };
}

// CLI: node lens-encircled-png.mjs <payload.json> [--out-dir <dir>] — the detached leg the lens spawns.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = process.argv.slice(2);
    const od = args.indexOf('--out-dir');
    const outDir = od >= 0 ? resolve(args[od + 1]) : DEFAULT_OUT_DIR;
    const payload = JSON.parse(readFileSync(args[0], 'utf8'));
    const { png, meta } = await renderLensEncircled(payload, { outDir });
    process.stdout.write(png ? `${png} regions=${meta.regions.length} walk=${meta.walkEngine} regions-engine=${meta.regionEngine} ${meta.ms}ms\n` : `UNMEASURED: ${meta.unmeasured} (${meta.ms}ms)\n`);
    process.exit(png ? 0 : 2);
  } catch (e) {
    process.stderr.write(`lens-encircled-png: ${e.message}\n`);
    process.exit(1);
  }
}
