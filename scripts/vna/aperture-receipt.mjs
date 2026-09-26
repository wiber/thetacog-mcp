#!/usr/bin/env node
// scripts/vna/aperture-receipt.mjs — THE APERTURE IS INSPECTABLE (C115, operator 2026-09-20, a Gemini reading he adopted:
// "if the aperture between the Merkle spec, the working tree files, and the L1 lattice is invisible, the radar looks like
// decorative generative art rather than a mechanical measurement").
//
// An engineer or underwriter looking at INTENT and REALITY must be able to verify, at a glance and then in full:
//   S_in  which exact spec basins constituted INTENT — the itemized rows (every checklist label), the headings, the open
//         questions — and the Merkle root of the spec tree they fold into;
//   F_in  which exact files at the COMMIT painted REALITY — path · blob sha · raw bytes · bytes the cut kept · truncated —
//         and which of the commit's files the aperture did NOT read (the first-N policy, git's own binary verdict);
//   κ     what fraction of the repo's mass was inside the aperture: Σ used reality bytes ÷ Σ sizes of every tracked blob
//         at the commit (`git ls-tree -r -l <sha>`), in RAW BYTES (gzip over 59k blobs is not a glance), cached per sha;
//   ω     an aperture hash — sha256 over the canonical JSON of {intent rows (path, used_bytes) · reality rows (path, blob,
//         used_bytes) · commit · aperture_version} — so anyone re-running the walk on another machine can check they fed
//         the chip the same bytes before comparing pixels.
//
// COMPOSED, NEVER RECOMPUTED. Every number here is READ off the receipt cockpit.mjs already writes (data/vna/cockpit.json:
// aperture.rows · ingest · config.numeric · config.hash · panels · commitFull · preview) and off git at the immutable commit.
// There is no second walk and no second byte count in this file: a receipt that disagreed with the cockpit would be two
// surfaces disagreeing about one commit, which is the foreclosure steer-ui.mjs declares for itself.
//
// REALITY IS THE IMMUTABLE COMMIT'S TREE. Blob shas come from `git ls-tree -r <sha>`, never the working tree. Under
// 👁 preview (cockpit-preview.json) the working tree is a look, not a receipt: `preview: true`, blob null, κ null, the
// exclusion list null — said, never faked.
//
//   node scripts/vna/aperture-receipt.mjs            compose from data/vna/cockpit.json → data/vna/aperture-receipt.json, print the line
//   node scripts/vna/aperture-receipt.mjs --json     …and print the receipt
//   node scripts/vna/aperture-receipt.mjs --preview  compose from cockpit-preview.json → aperture-receipt-preview.json
// Absent cockpit.json → `not run — node scripts/vna/cockpit.mjs`, exit 1, nothing written.
// @guard tests/vna/c115-aperture-receipt.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseChecklist, parseOpenQuestions } from './spec-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
export const COCKPIT_CMD = 'node scripts/vna/cockpit.mjs';
export const RECEIPT_CMD = 'node scripts/vna/aperture-receipt.mjs';
export const SPEC_REL = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';
export const RECEIPT = resolve(REPO, 'data/vna/aperture-receipt.json');
export const RECEIPT_PREVIEW = resolve(REPO, 'data/vna/aperture-receipt-preview.json');
export const MASS_CACHE_DIR = resolve(REPO, '.thetacog/aperture-mass');
/** the exclusion git decides: `git diff-tree --numstat` prints `-\t-` for every path git itself considers binary (cockpit.mjs) */
export const BINARY_RULE = 'git diff-tree --no-commit-id -r --numstat <sha> prints "-\\t-" — git\'s own binary verdict, never an extension list';

// ── canonical JSON: keys sorted at every depth, arrays kept in order — the recipe a stranger recomputes ω with ──
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
/** the tuple ω hashes — exported so the hash is recomputable from the receipt alone */
export function omegaTuple(r) {
  return {
    intent: r.intent.rows.map((x) => ({ path: x.path, used_bytes: x.used_bytes })).sort(byPath),
    // spans carry chunk_sha + the byte range, so ω MOVES when the WINDOW moves (a re-run that keeps
    // every file the same but slides pick_window's choice is a different reading, not the same one) —
    // never `lines`, which is a node-side presentation label derived FROM the span, not part of what
    // the crate decided.
    reality: r.reality.rows.map((x) => ({ path: x.path, blob: x.blob, used_bytes: x.used_bytes, spans: (x.spans || []).map((s) => ({ bytes: s.bytes, chunk_sha: s.chunk_sha })) })).sort(byPath),
    commit: r.commit,
    aperture_version: r.aperture_version,
  };
}
export const omegaOf = (r) => createHash('sha256').update(canonicalJson(omegaTuple(r))).digest('hex');

// ── git readers (the defaults; a test injects its own) ──
const git = (args, cwd = REPO) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
/** `git ls-tree -r -l <sha>` → [{mode, type, blob, size, path}] — every tracked blob at the immutable commit */
export function gitLsTreeDefault(sha, { cwd = REPO } = {}) {
  const out = [];
  for (const line of git(['ls-tree', '-r', '-l', sha], cwd).split('\n')) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\s+(-|\d+)\t(.*)$/.exec(line);
    if (m) out.push({ mode: m[1], type: m[2], blob: m[3], size: m[4] === '-' ? 0 : Number(m[4]), path: m[5] });
  }
  return out;
}
/** the commit's own file list — the same `git show --name-only` cockpit.mjs reads its reality from */
export function gitCommitFilesDefault(sha, { cwd = REPO } = {}) {
  return git(['show', '--name-only', '--pretty=format:', sha], cwd).split('\n').filter(Boolean);
}
/** the spec AT THE COMMIT (cockpit.mjs itemizes the working tree's spec at walk time; the receipt reads the immutable one and says whether the counts agree) */
export function readSpecAtDefault(sha, { cwd = REPO } = {}) {
  try { return git(['show', `${sha}:${SPEC_REL}`], cwd); } catch { return null; }
}
/** Σ tracked bytes at a sha, cached under .thetacog/aperture-mass/<sha>.json — the per-commit denominator of κ */
export function trackedMassAt(sha, { lsTree = gitLsTreeDefault, cacheDir = MASS_CACHE_DIR, cache = true } = {}) {
  const f = resolve(cacheDir, `${sha}.json`);
  if (cache && existsSync(f)) { try { const c = JSON.parse(readFileSync(f, 'utf8')); if (c && Number.isFinite(c.repo_bytes)) return c; } catch { /* recompute */ } }
  const rows = lsTree(sha);
  const rec = { sha, repo_bytes: rows.reduce((s, r) => s + (r.size || 0), 0), tracked_files: rows.length, unit: 'raw bytes', via: 'git ls-tree -r -l', at: new Date().toISOString() };
  if (cache) { try { mkdirSync(cacheDir, { recursive: true }); writeFileSync(f, JSON.stringify(rec)); } catch { /* the cache is a convenience */ } }
  return rec;
}

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const detailCounts = (detail) => { const o = {}; for (const m of String(detail || '').matchAll(/(\d+)\s+(items|headings|questions)/g)) o[m[2]] = Number(m[1]); return o; };

/**
 * The receipt, pure over injected readers.
 *   cockpit        the parsed data/vna/cockpit.json (or cockpit-preview.json)
 *   gitLsTree      (sha) → [{blob, size, path}]      blob shas + sizes at the commit
 *   gitCommitFiles (sha) → [path]                    the commit's file list (the exclusion set is files − aperture rows)
 *   readSpecAt     (sha) → md | null                 the spec at the commit, itemized the way cockpit.mjs itemizes it
 *   specTree       the parsed data/vna/spec-tree.json ({root}) or null
 *   apertureVersion  defaults to cockpit.config.hash — the run-config manifest (knobs + floors + tolerance + maxRealityFiles)
 */
export function apertureReceipt({ cockpit, gitLsTree = gitLsTreeDefault, gitCommitFiles = gitCommitFilesDefault, readSpecAt = readSpecAtDefault, specTree = null, apertureVersion = undefined, massCache = undefined } = {}) {
  if (!cockpit || typeof cockpit !== 'object') throw new Error(`aperture-receipt: no cockpit receipt — ${COCKPIT_CMD}`);
  const preview = !!cockpit.preview;
  const sha = cockpit.commitFull || null;
  const ap = cockpit.aperture || {}; const rows = Array.isArray(ap.rows) ? ap.rows : [];
  const aperture_version = apertureVersion !== undefined ? apertureVersion : (cockpit.config && cockpit.config.hash) || null;
  const numeric = (cockpit.config && cockpit.config.numeric) || {};

  // F_in — reality rows with the blob at the immutable commit; a preview has no immutable blob to name
  const tree = !preview && sha ? gitLsTree(sha) : [];
  const blobOf = new Map(tree.map((t) => [t.path, t]));
  // spans — C115z: WHICH byte/line range of the file the crate's pick_window actually kept, plus a
  // sha256 of that window's own bytes so it is independently re-verifiable without re-running the
  // walk. One row currently carries one window (pick_window picks exactly one); the field is an
  // array because a future multi-window cut is "add another entry", never a shape change. Read
  // straight off row.usedStart/usedEnd/chunkSha/lines — cockpit.mjs's ap.rows, which is itself read
  // straight off the crate's --aperture output (or its node parity fallback) — never re-derived here.
  const realityRows = rows.filter((r) => r.side === 'reality').map((r) => ({
    path: r.path, blob: preview ? null : (blobOf.get(r.path)?.blob ?? null), bytes: num(r.rawBytes), used_bytes: num(r.usedBytes), share_pct: num(r.sharePct), truncated: !!r.truncated,
    spans: (typeof r.usedStart === 'number' && typeof r.usedEnd === 'number')
      ? [{ bytes: [r.usedStart, r.usedEnd], lines: Array.isArray(r.lines) ? r.lines : null, chunk_sha: r.chunkSha || null }]
      : [],
  })).sort(byPath);
  const inAperture = new Set(realityRows.map((r) => r.path));
  const commitFiles = !preview && sha ? gitCommitFiles(sha) : null;
  const excluded = {
    max_files: num(numeric.maxRealityFiles),
    binary: BINARY_RULE,
    paths: commitFiles ? commitFiles.filter((f) => !inAperture.has(f)) : null,
    why: 'cockpit.mjs reads the first max_files of the commit\'s files and skips every path git calls binary; a file listed here painted nothing',
  };

  // S_in — intent rows + the basins the corpus was itemized from (the spec at the commit, parsed the way cockpit.mjs parses it)
  const intentRows = rows.filter((r) => r.side === 'intent').map((r) => ({ path: r.path, bytes: num(r.rawBytes), used_bytes: num(r.usedBytes), share_pct: num(r.sharePct), truncated: !!r.truncated })).sort(byPath);
  const ingestIntent = (cockpit.ingest || []).find((i) => i.side === 'intent' && /items/.test(String(i.via || ''))) || null;
  const readCounts = ingestIntent ? detailCounts(ingestIntent.detail) : {};
  const md = sha ? readSpecAt(sha) : null;
  let basins = { source: preview ? `${SPEC_REL} (working tree at walk time)` : `git show ${sha ? sha.slice(0, 9) : '?'}:${SPEC_REL}`, via: ingestIntent ? ingestIntent.via : null, labels: null, items: null, headings: null, questions: null, read_at_walk: readCounts, labels_match_ingest: null };
  if (md) {
    const items = parseChecklist(md); const heads = md.split('\n').filter((l) => /^#{2,3} /.test(l)); const qs = parseOpenQuestions(md);
    basins = { ...basins, labels: items.map((i) => i.id), items: items.length, headings: heads.length, questions: qs.length,
      labels_match_ingest: Object.keys(readCounts).length ? (readCounts.items === items.length && readCounts.headings === heads.length && readCounts.questions === qs.length) : null };
  }
  const intent = { mode: cockpit.intentMode || null, root: (specTree && specTree.root) || null, rows: intentRows, basins, gzip_bytes: num(ap.intentGzip), bytes: num(ap.intentBytes) };

  // κ — Σ used reality bytes ÷ Σ tracked bytes at the commit, RAW bytes
  const used = realityRows.reduce((s, r) => s + (r.used_bytes || 0), 0);
  const mass = !preview && sha ? trackedMassAt(sha, { lsTree: () => tree, ...(massCache || { cache: false }) }) : null;
  const kappa = { used_bytes: used, repo_bytes: mass ? mass.repo_bytes : null, tracked_files: mass ? mass.tracked_files : null, pct: mass && mass.repo_bytes > 0 ? Math.round((10000 * used) / mass.repo_bytes) / 100 : null, unit: 'raw bytes', definition: 'Σ used_bytes of the reality rows ÷ Σ size of every tracked blob at the commit (git ls-tree -r -l)' };

  // Δ — read off the delta panel
  const dp = (cockpit.panels || []).find((p) => p.id === 'delta' || /^Δ/.test(String(p.title || ''))) || null;
  const at = dp && Array.isArray(dp.rings_at) ? dp.rings_at : [];
  const delta = dp ? { rings: num(dp.rings), off_lane_pct: dp.counts ? num(dp.counts.offPct) : null, red: dp.counts ? num(dp.counts.red) : null, green: dp.counts ? num(dp.counts.green) : null, amber: dp.counts ? num(dp.counts.amber) : null,
    in_lane: at.filter((r) => r.band === 'green').map((r) => r.coord), off_lane: at.filter((r) => r.band === 'red').map((r) => r.coord), adjacent: at.filter((r) => r.band === 'amber').map((r) => r.coord) }
    : { rings: null, off_lane_pct: null, red: null, green: null, amber: null, in_lane: [], off_lane: [], adjacent: [] };

  const r = {
    v: 1, at: new Date().toISOString(), walked_at: cockpit.generatedAt || null,
    commit: sha, preview, aperture_version, engine: ap.engine || null,
    matched: ap.matched ?? null, admissible: ap.admissible ?? null, floor: num(ap.floor), raw_ratio: num(ap.rawRatio), used_ratio: num(ap.usedRatio), reason: ap.reason ?? null,
    kappa, intent,
    reality: { rows: realityRows, excluded, gzip_bytes: num(ap.realityGzip), bytes: num(ap.realityBytes) },
    delta,
    omega: null,
    recipe: 'omega = sha256(canonicalJson({intent:[{path,used_bytes}] sorted by path, reality:[{path,blob,used_bytes}] sorted by path, commit, aperture_version})) — scripts/vna/aperture-receipt.mjs omegaTuple/canonicalJson',
    sufficient_for: 'WHICH bytes the chip was fed and from WHICH commit — recomputable elsewhere; NOT sufficient for whether the walk was right (Rice), which no receipt claims',
  };
  r.omega = omegaOf(r);
  return r;
}

const kB = (b) => `${(Math.round(b / 100) / 10).toFixed(1)} kB`;
/** the one line the page paints under the header: APERTURE · <n> files (<kB> · <κ>% repo mass) ↔ <n> intent rows · root <root8> · ω <8> */
export function apertureReceiptLine(r) {
  if (!r) return `not run — ${RECEIPT_CMD}`;
  const nF = r.reality.rows.length, nI = r.intent.rows.length;
  const mass = r.kappa.pct != null ? `${kB(r.kappa.used_bytes)} · ${r.kappa.pct}% repo mass, raw bytes` : `${kB(r.kappa.used_bytes)} · κ UNMEASURED`;
  return `APERTURE · ${r.preview ? 'PREVIEW · ' : ''}${nF} file${nF === 1 ? '' : 's'} (${mass}) ↔ ${nI} intent row${nI === 1 ? '' : 's'} · root ${r.intent.root ? r.intent.root.slice(0, 8) : 'UNMEASURED'} · ω ${r.omega.slice(0, 8)}`;
}
/** the three panel hovers, read off the receipt (C116) */
export function apertureHovers(r) {
  if (!r) return { INTENT: `not run — ${RECEIPT_CMD}`, REALITY: `not run — ${RECEIPT_CMD}`, DELTA: `not run — ${RECEIPT_CMD}` };
  const dirs = [...r.reality.rows.reduce((m, x) => { const d = x.path.includes('/') ? x.path.split('/').slice(0, 2).join('/') : '.'; m.set(d, (m.get(d) || 0) + (x.used_bytes || 0)); return m; }, new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d);
  const gz = (n) => (n == null ? 'gzip UNMEASURED' : `${n} gzip-bytes`);
  return {
    INTENT: `Declared: ${r.intent.rows.length} row${r.intent.rows.length === 1 ? '' : 's'}${r.intent.basins.items != null ? ` · ${r.intent.basins.items} spec items · ${r.intent.basins.headings} headings · ${r.intent.basins.questions} questions` : ''} · ${gz(r.intent.gzip_bytes)}`,
    REALITY: `Performed: ${r.reality.rows.length} file${r.reality.rows.length === 1 ? '' : 's'}${dirs.length ? ` · ${dirs.join(' · ')}` : ''} · ${gz(r.reality.gzip_bytes)}${r.reality.excluded.paths && r.reality.excluded.paths.length ? ` · ${r.reality.excluded.paths.length} excluded` : ''}`,
    DELTA: `${r.delta.rings ?? 'UNMEASURED'} rings · ${r.delta.off_lane_pct ?? 'UNMEASURED'}% off-lane · ${r.delta.red ?? 'UNMEASURED'} red`,
  };
}
/** read the written receipt — null when absent (the page prints not run — <command>) */
export function loadReceipt(path = RECEIPT) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

function main() {
  const argv = process.argv.slice(2);
  const preview = argv.includes('--preview');
  const src = resolve(REPO, 'data/vna', preview ? 'cockpit-preview.json' : 'cockpit.json');
  if (!existsSync(src)) { console.log(`not run — ${COCKPIT_CMD}${preview ? ' --reality tree --no-open' : ''}`); process.exit(1); }
  const cockpit = JSON.parse(readFileSync(src, 'utf8'));
  let specTree = null; try { specTree = JSON.parse(readFileSync(resolve(REPO, 'data/vna/spec-tree.json'), 'utf8')); } catch { /* root UNMEASURED */ }
  const r = apertureReceipt({ cockpit, specTree, massCache: { cache: true, cacheDir: MASS_CACHE_DIR } });
  const out = preview ? RECEIPT_PREVIEW : RECEIPT;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2) + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  console.log(apertureReceiptLine(r));
  console.log(`  receipt ${out.slice(REPO.length + 1)} · κ ${r.kappa.pct ?? 'UNMEASURED'}% · ω ${r.omega}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
