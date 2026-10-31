#!/usr/bin/env node
// packages/thetacog-mcp/scripts/reef-identity.mjs — C1394: THE SHIPPED REEF IS THE REPO'S REEF.
//
// The tripwire sweep ran in the package on a lens-reef.json of 517,721 bytes while the repo's was 534,628: the package
// was walking a different instrument, and the reading carried no sha to say so. Prepack now ends its data copy with this
// check. For every file the walk's one entry reads or stamps that the tarball carries (the reef, the axes, the aperture
// anchors, the shortlex registry — NOT_SHIPPED names the two that are not, and why), the shipped copy must equal its repo source by sha256 — or differ
// ONLY by the declared privacy scrub (bundle-pmu.mjs: an array item matching data/pmu/private-markers.txt dropped, a
// string value matching it redacted to '[redacted: private marker]'), which this checker re-derives structurally from the
// two parsed files and names line by line. Anything else — a trimmed reef, a stale copy, a missing file, a reformatted
// value — fails prepack (exit 1) naming the file and both shas. It never trims either side; it reads both.
//
// Why the scrub is the one allowed difference: shipping the marker strings would publish a private contact's name in a
// public npm tarball. The residual is NAMED (count + path) on every run, so the instrument a stranger walks is the repo's
// instrument minus exactly those strings — never silently thinner. The root fix is the reef's writer not seating them.
// THE BOOK (spec R4, f112284004): data/book/COMPLETE-BOOK.txt ships from books/tesseract/COMPLETE-BOOK.txt (bundle-pmu.mjs copies it,
// ./scripts/build-book-html.sh compiles it) and must equal it byte for byte — text, so no scrub applies. A stale book fails prepack
// the same way a stale reef does. The vsix engine's copy is held by the guard (it is built after the tarball, not by prepack).
// Sufficient for: whether the package walks the repo's reef and axes and ships the repo's book. Not for: whether either is right.
//
// C1435: THE STAMPED NUMBER ITSELF, NOT JUST ITS INPUTS. The cold six-question run on 2.58.0 found the published
// package stamping every receipt apertureVersion 715f737a8964 while the repo computed 1b5c488abe9c right then (reef
// 522,855 shipped vs 540,423 repo bytes) — a stale bundle the file check above would have refused, but nothing ever
// printed the two apertureVersion() values as a pair, which is the one legible number a stranger's cold run actually
// compares. verifyAperture() below reads scripts/pmu/prompt-lens.mjs's OWN apertureInputs() (never a second list here)
// so the files it holds to the repo can't drift from the ones apertureVersion() hashes, then calls apertureVersion()
// on both the repo's module and the shipped module and reports the pair. A privacy scrub changes those files' raw
// bytes on purpose (see above), so the two numbers legitimately differ even on a correct build — verifyAperture() is
// ok whenever the byte check above is ok (identical or scrub-only), and the two values are still reported, never
// silently equal. A genuine mismatch (stale, trimmed, or missing) fails prepack with both values named.
// @guard tests/vna/c1435-2-58-1-airtight-from-the.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '..', '..');

/** the files the walk's entry reads or stamps — the reef, the axes, and what the walk reads beside them */
export const WALK_FILES = [
  'data/pmu/lens-reef.json',                       // the reef (stamp reef_sha; apertureVersion)
  'data/pmu/snippet-library-144.json',             // the axes (stamp axes_sha; the walk's 144 library and its pair signatures)
  'data/pmu/rule-trigger-anchors.json',            // apertureVersion
  'data/pmu/shortlex-144-registry.json',           // the SHORTLEX-3 projection and the zone seams
];
/** shipped under a different path than its repo source: { file (in the package), from (in the repo) } */
export const BOOK = { file: 'data/book/COMPLETE-BOOK.txt', from: 'books/tesseract/COMPLETE-BOOK.txt' };
/** everything prepack checks: the walk's files (same path both sides) and the book */
export const SHIPPED = [...WALK_FILES, BOOK];
// read beside the walk but NOT in the tarball, each for a stated reason (printed on every run, never silent):
export const NOT_SHIPPED = [
  { file: '.thetacog/pmu/reef-connectivity-directed.json', why: 'a cache: definer-walk-144.mjs buildDirected() and walk_lens.rs load_directed_grid derive it from the axes when absent — measured 2026-10-29, 0 of 20,736 cells differ from the repo cache' },
  { file: 'data/pmu/shortlex-children-candidate.json', why: 'denied by .npmignore (16 private-marker values); it feeds only the SHORTLEX-3 projection row of the triptych HTML, never the tolerance reading or a verdict, and the package prints that row as skipped' },
];
export const REDACTED = '[redacted: private marker]';
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);

export function loadMarkers(repo = REPO) {
  const p = join(repo, 'data/pmu/private-markers.txt');
  if (!existsSync(p)) return null;
  const parts = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return parts.length ? new RegExp(parts.join('|'), 'i') : null;
}

/** walk repo vs shipped JSON; every difference must be the scrub's own (drop a marker item / redact a marker string) */
export function scrubOnlyDiff(src, got, markers, path = '$', out = { dropped: [], redacted: [], other: [] }) {
  if (Array.isArray(src)) {
    if (!Array.isArray(got)) { out.other.push(`${path}: array became ${typeof got}`); return out; }
    const kept = src.map((v, i) => [v, i]).filter(([v]) => !(markers && typeof v === 'string' && markers.test(v)));
    for (const [v, i] of src.map((v, i) => [v, i])) if (markers && typeof v === 'string' && markers.test(v)) out.dropped.push(`${path}[${i}]`);
    if (kept.length !== got.length) { out.other.push(`${path}: ${kept.length} items after the scrub, ${got.length} shipped`); return out; }
    kept.forEach(([v, i], k) => scrubOnlyDiff(v, got[k], markers, `${path}[${i}]`, out));
    return out;
  }
  if (src && typeof src === 'object') {
    if (!got || typeof got !== 'object' || Array.isArray(got)) { out.other.push(`${path}: object became ${Array.isArray(got) ? 'array' : typeof got}`); return out; }
    const a = Object.keys(src), b = Object.keys(got);
    if (a.length !== b.length || a.some((k, i) => k !== b[i])) { out.other.push(`${path}: keys differ`); return out; }
    for (const k of a) {
      const v = src[k];
      if (markers && typeof v === 'string' && markers.test(v)) { if (got[k] === REDACTED) out.redacted.push(`${path}.${k}`); else out.other.push(`${path}.${k}: a marker value shipped unredacted`); continue; }
      scrubOnlyDiff(v, got[k], markers, `${path}.${k}`, out);
    }
    return out;
  }
  if (src !== got) out.other.push(`${path}: ${JSON.stringify(src).slice(0, 40)} → ${JSON.stringify(got).slice(0, 40)}`);
  return out;
}

/** → { ok, rows: [{ file, repo_sha, shipped_sha, identical, dropped, redacted, problem }] } */
export function verifyShippedReef({ repo = REPO, pkg = PKG, files = SHIPPED, markers = loadMarkers(repo) } = {}) {
  const rows = files.map((e) => {
    const file = typeof e === 'string' ? e : e.file, from = typeof e === 'string' ? e : e.from;
    const s = join(repo, from), t = join(pkg, file);
    if (!existsSync(s)) return { file, repo_sha: null, shipped_sha: null, identical: false, problem: 'no repo source' };
    if (!existsSync(t)) return { file, repo_sha: sha(readFileSync(s)), shipped_sha: null, identical: false, problem: 'not shipped' };
    const sb = readFileSync(s), tb = readFileSync(t);
    const row = { file, ...(from !== file ? { from } : {}), repo_sha: sha(sb), shipped_sha: sha(tb), identical: sb.equals(tb), dropped: 0, redacted: 0, problem: null };
    if (row.identical) return row;
    if (!/\.json$/.test(file)) return { ...row, problem: `bytes differ: ${file} must equal ${from} byte for byte (text, no scrub applies)` };
    let a, b; try { a = JSON.parse(sb.toString('utf8')); b = JSON.parse(tb.toString('utf8')); } catch { return { ...row, problem: 'bytes differ and a side is not JSON' }; }
    const d = scrubOnlyDiff(a, b, markers);
    row.dropped = d.dropped.length; row.redacted = d.redacted.length;
    if (d.other.length) row.problem = `differs beyond the privacy scrub (${d.other.length}): ${d.other.slice(0, 3).join(' · ')}`;
    else if (!row.dropped && !row.redacted) row.problem = 'bytes differ with no scrub to account for it';
    return row;
  });
  return { ok: rows.every((r) => !r.problem), rows };
}

/** → { ok, repoVersion, shipVersion, files, problem } — the two apertureVersion() numbers themselves, derived
 *  from prompt-lens.mjs's own apertureInputs() (never a second list) and gated on the same scrub-tolerant file
 *  check verifyShippedReef already runs, so a legitimate privacy scrub never fails this and a stale or trimmed
 *  input always does. */
export async function verifyAperture({ repo = REPO, pkg = PKG, markers = loadMarkers(repo) } = {}) {
  const repoEntry = join(repo, 'scripts/pmu/prompt-lens.mjs'), pkgEntry = join(pkg, 'scripts/pmu/prompt-lens.mjs');
  if (!existsSync(repoEntry)) return { ok: false, repoVersion: null, shipVersion: null, files: [], problem: 'no repo scripts/pmu/prompt-lens.mjs' };
  const repoMod = await import(pathToFileURL(repoEntry).href);
  const files = repoMod.apertureInputs().rels;
  const repoVersion = repoMod.apertureVersion();
  if (!existsSync(pkgEntry)) return { ok: false, repoVersion, shipVersion: null, files, problem: 'not shipped: scripts/pmu/prompt-lens.mjs' };
  const fileCheck = verifyShippedReef({ repo, pkg, files, markers });
  const shipVersion = (await import(pathToFileURL(pkgEntry).href)).apertureVersion();
  const problem = fileCheck.ok ? null : `the aperture's own inputs differ beyond the privacy scrub: ${fileCheck.rows.filter((r) => r.problem).map((r) => `${r.file} (${r.problem})`).join(' · ')}`;
  return { ok: !problem, repoVersion, shipVersion, files, problem };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, rows } = verifyShippedReef();
  for (const r of rows) console.log(`  reef-identity ${r.problem ? '✗' : '✓'} ${r.file}${r.from ? ` (from ${r.from})` : ''}  repo ${r.repo_sha || '—'} · shipped ${r.shipped_sha || '—'}${r.identical ? ' · byte-identical' : r.problem ? '' : ` · identical but for the privacy scrub (${r.dropped} dropped, ${r.redacted} redacted)`}${r.problem ? ` · ${r.problem}` : ''}`);
  for (const n of NOT_SHIPPED) console.log(`  reef-identity · ${n.file} — not shipped: ${n.why}`);
  const ap = await verifyAperture();
  console.log(`  reef-identity ${ap.ok ? '✓' : '✗'} aperture parity — repo ${ap.repoVersion || '—'} · shipped ${ap.shipVersion || '—'}${ap.ok ? (ap.repoVersion === ap.shipVersion ? ' · match' : ' · differs only by the declared privacy scrub') : ''}${ap.problem ? ` · ${ap.problem}` : ''}`);
  if (!ok || !ap.ok) { console.error('  ❌ the package would walk a different reef or axes, ship a different book, or stamp a different aperture, than the repo — re-bundle (node scripts/bundle-pmu.mjs); never trim either side.'); process.exit(1); }
}
