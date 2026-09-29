#!/usr/bin/env node
// scripts/vna/recompute-receipt.mjs — THE RECOMPUTE DOOR (C241, steered off the C240b milestone→goal map, operator 2026-09-24:
// "map out all the /milestones as goals we need (and therefore steer the work on the extension)"). One command a stranger runs
// on an aperture receipt someone handed them. It RE-DERIVES the receipt's tuple from the IMMUTABLE COMMIT and prints
// match / MISMATCH / UNMEASURED with both hashes, plus ONE pasteable line — the line docs/receipts/third-party-recompute.md
// is made of (docs/receipts/README.md says how a third party appends theirs).
//
// NO SECOND IMPLEMENTATION. Every number here comes from the code that made the receipt:
//   ω        scripts/vna/aperture-receipt.mjs omegaOf/omegaTuple/canonicalJson — the recipe the receipt itself names
//   blobs    `git ls-tree -r <commit>` through aperture-receipt.mjs's gitLsTreeDefault — the immutable tree, never the working tree
//   spec     the spec AT the commit (readSpecAtDefault) itemized with spec-render.mjs's parseChecklist/parseOpenQuestions —
//            the same calls cockpit.mjs's itemizedSpec makes, over `git show <sha>:<spec>` instead of the working tree
//   the cut  scripts/vna/aperture.mjs matchAperture (the chip, `pmu-onchip --aperture`) or matchApertureNode — whichever
//            engine the receipt says made it — over the reality files read the way cockpit.mjs reads them
//            (scripts/pmu/corpus-ingest.mjs commentProseWithSpans: comment prose for code, the raw text for prose)
//
// FOUR LEGS, ONE VERDICT.
//   tuple   ω recomputed over the receipt's OWN rows equals receipt.omega — a receipt whose tuple was altered by one byte fails
//           here (the row's falsifier)
//   commit  every reality row's blob is the blob at that path in the immutable commit
//   spec    the checklist labels the receipt says were the intent basins are the labels of the spec at the commit
//   cut     the window each reality row kept (used_bytes · [start,end) · chunk_sha) re-derives on the same engine, and ω over
//           the re-derived rows equals receipt.omega — this is "recomputed ω" on the line
// MISMATCH when any measured leg differs. UNMEASURED — with the reason, never "match" — when the commit is not in this
// repository, the receipt names the chip and the chip is not here, the engine is unreported, or the receipt is a preview
// (no immutable commit). Exit 0 match · 1 MISMATCH · 2 UNMEASURED.
//
// WHAT THE LINE IS SUFFICIENT FOR: that the bytes the chip was fed came from that commit under that aperture, re-derived on
// a machine we do not control. NOT for whether the walk was right (Rice) — the receipt does not claim it and neither does this.
//
//   node scripts/vna/recompute-receipt.mjs                              data/vna/aperture-receipt.json in this repo
//   node scripts/vna/recompute-receipt.mjs --receipt <file> [--json]    a receipt someone handed you; --json prints the result too
//   npx thetacog-mcp recompute-receipt --receipt <file>                 the same door from a stranger's checkout (server.js dispatch)
// VNA_REPO (or the cwd) is the repository the commit must be reachable in.
//
// MAXIMISE RUST (2026-09-22): this module DECIDES (a verdict) — its port row is derived by scripts/vna/engine-map.mjs; the
// comparison logic belongs in the crate once it is proved here, beside `--aperture`.
// @guard tests/vna/c241-the-recompute-door.test.mjs
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { omegaOf, gitLsTreeDefault, readSpecAtDefault, RECEIPT, SPEC_REL } from './aperture-receipt.mjs';
import { matchAperture, matchApertureNode } from './aperture.mjs';
import { parseChecklist, parseOpenQuestions } from './spec-render.mjs';
import { commentProseWithSpans } from '../pmu/corpus-ingest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
/** the root this script ships in: the repo in the private tree, the installed package under npx (scripts/vna/ → ../..) */
export const PKG_ROOT = resolve(HERE, '..', '..');
export const DOOR_CMD = 'node scripts/vna/recompute-receipt.mjs';
export const THIRD_PARTY_FILE = 'docs/receipts/third-party-recompute.md';
export const LINE_PREFIX = 'RECOMPUTE';
const CHIP_ENGINE = 'rust-aperture', NODE_ENGINE = 'node-aperture';
const ITEMIZED_PATH = 'SPEC-VNA-COCKPIT.md (itemized)', MESSAGE_PATH = 'commit message';

// ── C429 THE CHIP THE PACKAGE SHIPS (C424 break 4) ──
// The lookup order: (1) the package's own pmu-rust/target/release/pmu-onchip WHEN ITS HEADER SAYS THIS PLATFORM, (2) the
// checkout's .thetacog/pmu/target/release/pmu-onchip, (3) PMU_BINARY (PMU_ONCHIP, the older name, is the same slot). None →
// no path, and the reason names <platform>-<arch>, so a stranger on a platform nothing ships for reads which one it is.
// "This platform" is read off the binary's own Mach-O / ELF header, never off its file name: a darwin-arm64 build under a
// generic path on linux-x64 would otherwise be "found" and fail at spawn, and the door would call that a chip answer.
export const PKG_CHIP_REL = 'pmu-rust/target/release/pmu-onchip';
export const CHECKOUT_CHIP_REL = '.thetacog/pmu/target/release/pmu-onchip';
const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64' };
/** "<platform>-<arch>[,<arch>…]" from the executable header, or null when the file is absent or no header we know */
export function binaryPlatform(file) {
  let b;
  try { const fd = openSync(file, 'r'); try { const buf = Buffer.alloc(4096); b = buf.subarray(0, readSync(fd, buf, 0, 4096, 0)); } finally { closeSync(fd); } } catch { return null; }
  if (b.length < 20) return null;
  if (b.readUInt32LE(0) === 0xfeedfacf) { const a = MACHO_CPU[b.readUInt32LE(4)]; return a ? `darwin-${a}` : null; }
  if (b.readUInt32BE(0) === 0xcafebabe) {   // universal (fat) Mach-O: big-endian arch count, 20-byte entries from offset 8
    const n = b.readUInt32BE(4), archs = [];
    for (let i = 0; i < n && 8 + i * 20 + 4 <= b.length; i++) { const a = MACHO_CPU[b.readUInt32BE(8 + i * 20)]; if (a) archs.push(a); }
    return archs.length ? `darwin-${archs.join(',')}` : null;
  }
  if (b[0] === 0x7f && b.toString('latin1', 1, 4) === 'ELF' && b[5] === 1) { const a = ELF_MACHINE[b.readUInt16LE(18)]; return a ? `linux-${a}` : null; }
  return null;
}
const runsHere = (hdr, platform, arch) => { if (!hdr) return false; const [p, as] = hdr.split('-'); return p === platform && as.split(',').includes(arch); };
/** the door's chip: { path, source: package|checkout|PMU_BINARY, platform } or { path: null, platform, why } */
export function resolveChip({ pkgRoot = PKG_ROOT, repo = REPO, env = process.env, platform = os.platform(), arch = os.arch() } = {}) {
  const here = `${platform}-${arch}`;
  const pkgBin = resolve(pkgRoot, PKG_CHIP_REL);
  const pkgHdr = existsSync(pkgBin) ? binaryPlatform(pkgBin) : null;
  if (runsHere(pkgHdr, platform, arch)) return { path: pkgBin, source: 'package', platform: here };
  const coBin = resolve(repo, CHECKOUT_CHIP_REL);
  if (existsSync(coBin)) return { path: coBin, source: 'checkout', platform: here };
  const envBin = env.PMU_BINARY || env.PMU_ONCHIP || '';
  if (envBin && existsSync(envBin)) return { path: envBin, source: 'PMU_BINARY', platform: here };
  const shipped = existsSync(pkgBin) ? `the package ships ${pkgHdr || 'an unrecognised binary'}, not ${here}` : `the package ships no pmu-onchip for ${here}`;
  return { path: null, platform: here, why: `no pmu-onchip for ${here}: ${shipped} (${pkgBin}), none in the checkout (${coBin}), PMU_BINARY ${envBin ? `names ${envBin}, which is absent` : 'is unset'} — build .thetacog/pmu (cargo build --release) or set PMU_BINARY` };
}

// ── the readers cockpit.mjs used, at the immutable commit (a test injects its own) ──
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
export const readers = (cwd = REPO, { pkgRoot = PKG_ROOT, env = process.env } = {}) => { const c = resolveChip({ pkgRoot, repo: cwd, env }); return {
  lsTree: (sha) => gitLsTreeDefault(sha, { cwd }),
  showFile: (sha, path) => git(['show', `${sha}:${path}`], cwd),
  readSpecAt: (sha) => readSpecAtDefault(sha, { cwd }),
  commitMessage: (sha) => git(['log', '-1', '--pretty=%B', sha], cwd),
  chip: c.path, chipSource: c.source || null, chipWhy: c.why || null,
}; };

/** the reality text cockpit.mjs feeds the aperture: comment prose for a code file, the raw text otherwise — its readAs, the same call */
export const readAs = (path, text) => { const { text: prose } = commentProseWithSpans(text, extname(path)); return prose || text; };
/** the itemized spec cockpit.mjs's itemizedSpec builds — headings, checklist items, open questions — over the md handed in */
export function itemizedSpec(md) {
  const items = parseChecklist(md).map((i) => i.id + ' ' + i.text);
  const heads = md.split('\n').filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+ /, ''));
  const qs = parseOpenQuestions(md).map((q) => q.id + ' ' + q.text);
  return { text: [...heads, ...items, ...qs].join('\n'), items: items.length, heads: heads.length, qs: qs.length, labels: parseChecklist(md).map((i) => i.id) };
}

export const machineLine = () => `${os.platform()}-${os.arch()} ${os.release()} · node ${process.version}`;
const short = (s) => (typeof s === 'string' ? s.slice(0, 10) : '?');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The recompute, pure over injected readers. Returns the result; never throws on a bad receipt or a missing commit — that is a
 * verdict (UNMEASURED with its reason), not an exception.
 */
export function recomputeReceipt(receipt, { lsTree, showFile, readSpecAt, commitMessage, chip, chipWhy = null, at = new Date().toISOString(), machine = machineLine() } = {}) {
  const legs = { tuple: null, commit: null, spec: null, cut: null };
  // C431: the wall time of each leg that RAN, in ms (install excluded — the door cannot see it). A leg that did not run has no
  // entry: a 0 would claim a measurement. `lap(name)` closes the leg that started at the previous lap.
  const legs_ms = {}; let t0 = performance.now();
  const lap = (name) => { const t = performance.now(); legs_ms[name] = Math.round((t - t0) * 1000) / 1000; t0 = t; };
  const out = (verdict, reason, recomputed) => finish(receipt, { verdict, reason, recomputed_omega: recomputed, legs, legs_ms, at, machine });
  if (!receipt || typeof receipt !== 'object' || typeof receipt.omega !== 'string' || !receipt.intent?.rows || !receipt.reality?.rows) {
    return out('UNMEASURED', 'not an aperture receipt — no omega / intent.rows / reality.rows (data/vna/aperture-receipt.json is the shape)', null);
  }
  if (receipt.preview || !receipt.commit) return out('UNMEASURED', 'a preview receipt names no immutable commit — walk HEAD (node scripts/vna/cockpit.mjs) and recompute that receipt', null);
  const sha = receipt.commit;

  // tuple — ω over the receipt's own rows, the recipe it names
  const tupleOmega = omegaOf(receipt);
  legs.tuple = { omega: tupleOmega, same: tupleOmega === receipt.omega };
  lap('tuple');

  // commit — the immutable tree; unreadable → UNMEASURED
  let tree;
  try { tree = lsTree(sha); } catch (e) { lap('commit'); return out('UNMEASURED', `commit ${short(sha)} is not in this repository (${String(e.message || e).split('\n')[0].slice(0, 120)}) — fetch it, or run inside the repository the receipt names`, null); }
  if (!tree.length) { lap('commit'); return out('UNMEASURED', `commit ${short(sha)} is not in this repository (git ls-tree returned nothing) — fetch it, or run inside the repository the receipt names`, null); }
  const blobOf = new Map(tree.map((t) => [t.path, t.blob]));
  const blobDiffs = receipt.reality.rows.filter((r) => blobOf.get(r.path) !== r.blob).map((r) => ({ path: r.path, receipt: r.blob, commit: blobOf.get(r.path) ?? null }));
  legs.commit = { rows: receipt.reality.rows.length, same: blobDiffs.length === 0, diffs: blobDiffs };
  lap('commit');

  // spec — the basins at the commit vs the labels the receipt names
  const md = readSpecAt(sha);
  const spec = md ? itemizedSpec(md) : null;
  const labels = receipt.intent?.basins?.labels;
  if (Array.isArray(labels)) {
    if (!spec) legs.spec = { same: null, why: `${SPEC_REL} is not at commit ${short(sha)} — the receipt names ${labels.length} basins that cannot be read here` };
    else {
      const same = labels.length === spec.labels.length && labels.every((l, i) => l === spec.labels[i]);
      legs.spec = { same, receipt: labels.length, commit: spec.labels.length, first_diff: same ? null : (labels.find((l, i) => l !== spec.labels[i]) ?? spec.labels[labels.length] ?? null) };
    }
  } else legs.spec = { same: null, why: 'the receipt names no basins (intent.basins.labels is null)' };
  lap('spec');

  // cut — the same engine over the same files at the commit
  const engine = receipt.engine;
  let match;
  if (engine === CHIP_ENGINE) {
    if (!chip || !existsSync(chip)) return out('UNMEASURED', `the receipt was cut on ${CHIP_ENGINE} and pmu-onchip is not here — ${chipWhy || `${chip || 'no path resolves'} is absent on ${os.platform()}-${os.arch()} — build .thetacog/pmu (cargo build --release) or set PMU_BINARY`}`, null);
    match = (i, r) => matchAperture(i, r, { engine: 'auto', chip });   // the chip the door resolved is the chip that runs
  } else if (engine === NODE_ENGINE) match = (i, r) => matchApertureNode(i, r);
  else return out('UNMEASURED', `the receipt reports engine "${engine ?? 'none'}" — only ${CHIP_ENGINE} and ${NODE_ENGINE} can be re-run`, null);
  const outCut = (...a) => { lap('cut'); return out(...a); };   // the cut leg started reading, then stopped: its time is still spent
  const intentDocs = [];
  for (const row of receipt.intent.rows) {
    if (row.path === ITEMIZED_PATH) { if (!spec) return outCut('UNMEASURED', `the intent was the itemized spec and ${SPEC_REL} is not at commit ${short(sha)}`, null); intentDocs.push({ path: ITEMIZED_PATH, text: spec.text }); }
    else if (row.path === MESSAGE_PATH) intentDocs.push({ path: MESSAGE_PATH, text: commitMessage(sha) });
    else return outCut('UNMEASURED', `intent row "${row.path}" is not a document cockpit.mjs builds — cannot re-derive it`, null);
  }
  const realityDocs = [];
  for (const row of receipt.reality.rows) {
    let text; try { text = showFile(sha, row.path); } catch (e) { return outCut('UNMEASURED', `${row.path} is not readable at commit ${short(sha)} (${String(e.message || e).split('\n')[0].slice(0, 80)})`, null); }
    realityDocs.push({ path: row.path, text: readAs(row.path, text) });
  }
  const ap = match(intentDocs, realityDocs);

  if (engine === CHIP_ENGINE && ap.engine !== CHIP_ENGINE) { return outCut('UNMEASURED', `the receipt was cut on ${CHIP_ENGINE}; the chip here answered ${ap.engine || 'nothing'} (pmu-onchip --aperture failed) — a node re-run is a different engine, not a mismatch`, null); }
  const rowsOf = (side) => (ap.rows || []).filter((r) => r.side === side).sort(byPath);
  const rederived = {
    intent: { rows: rowsOf('intent').map((r) => ({ path: r.path, used_bytes: r.usedBytes })) },
    reality: { rows: rowsOf('reality').map((r) => ({ path: r.path, blob: blobOf.get(r.path) ?? null, used_bytes: r.usedBytes, spans: (typeof r.usedStart === 'number' && typeof r.usedEnd === 'number') ? [{ bytes: [r.usedStart, r.usedEnd], chunk_sha: r.chunkSha || null }] : [] })) },
    commit: sha, aperture_version: receipt.aperture_version,
  };
  const recomputed = omegaOf(rederived);
  const rowDiffs = [];
  const want = new Map(receipt.reality.rows.map((r) => [r.path, r]));
  for (const r of rederived.reality.rows) {
    const w = want.get(r.path); const ws = (w && w.spans && w.spans[0]) || {}; const rs = r.spans[0] || {};
    const same = w && w.used_bytes === r.used_bytes && JSON.stringify(ws.bytes ?? null) === JSON.stringify(rs.bytes ?? null) && (ws.chunk_sha ?? null) === (rs.chunk_sha ?? null);
    if (!same) rowDiffs.push({ path: r.path, receipt: w ? { used_bytes: w.used_bytes, bytes: ws.bytes ?? null, chunk_sha: ws.chunk_sha ?? null } : null, rederived: { used_bytes: r.used_bytes, bytes: rs.bytes ?? null, chunk_sha: rs.chunk_sha ?? null } });
  }
  const wantI = new Map(receipt.intent.rows.map((r) => [r.path, r]));
  for (const r of rederived.intent.rows) { const w = wantI.get(r.path); if (!w || w.used_bytes !== r.used_bytes) rowDiffs.push({ path: r.path, receipt: w ? { used_bytes: w.used_bytes } : null, rederived: { used_bytes: r.used_bytes } }); }
  lap('cut');
  legs.cut = { engine: ap.engine, omega: recomputed, same: recomputed === receipt.omega && rowDiffs.length === 0, rows: rederived.reality.rows.length + rederived.intent.rows.length, diffs: rowDiffs };

  const failed = [];
  if (!legs.tuple.same) failed.push(`tuple: ω over the receipt's own rows is ${legs.tuple.omega.slice(0, 12)}…, not the ${receipt.omega.slice(0, 12)}… it carries — a row or the hash was altered`);
  if (!legs.commit.same) failed.push(`commit: ${blobDiffs.length} blob${blobDiffs.length === 1 ? '' : 's'} differ at the commit (${blobDiffs.slice(0, 2).map((d) => d.path).join(', ')})`);
  if (legs.spec.same === false) failed.push(`spec: ${legs.spec.receipt} basins on the receipt vs ${legs.spec.commit} at the commit (first ${legs.spec.first_diff})`);
  if (!legs.cut.same) failed.push(rowDiffs.length ? `cut: ${rowDiffs.length} row${rowDiffs.length === 1 ? '' : 's'} re-derive differently on ${ap.engine} (${rowDiffs.slice(0, 2).map((d) => d.path).join(', ')})` : `cut: ω over the re-derived rows is ${recomputed.slice(0, 12)}…`);
  if (failed.length) return out('MISMATCH', failed.join(' · '), recomputed);
  const measured = [`tuple ω same`, `${legs.commit.rows} blob${legs.commit.rows === 1 ? '' : 's'} at the commit`, legs.spec.same === true ? `${legs.spec.commit} basins at the commit` : `spec ${legs.spec.why}`, `${legs.cut.rows} rows re-cut on ${ap.engine}`];
  return out('match', measured.join(' · '), recomputed);
}

function finish(receipt, { verdict, reason, recomputed_omega, legs, legs_ms = {}, at, machine }) {
  const commit = receipt?.commit || null, av = receipt?.aperture_version || null;
  const id = commit ? `${commit.slice(0, 10)}@${av || 'no-aperture-version'}` : 'no-commit';
  const expected = typeof receipt?.omega === 'string' ? receipt.omega : 'none';
  const engine = receipt?.engine || 'unreported';
  const line = [LINE_PREFIX, `receipt ${id}`, `commit ${commit || 'none'}`, `expected ω ${expected}`, `recomputed ω ${recomputed_omega || 'UNMEASURED'}`,
    verdict === 'match' ? 'match' : `${verdict} — ${reason}`, engine, machine, at].join(' · ');
  return { v: 1, at, receipt_id: id, commit, aperture_version: av, engine, expected_omega: expected, recomputed_omega, verdict, reason, legs, legs_ms, machine, line };
}

/** what the line means, for the document the extension opens beside the receipt and for the README */
export const LINE_FORMAT = `${LINE_PREFIX} · receipt <commit10>@<aperture_version> · commit <sha40> · expected ω <sha256> · recomputed ω <sha256 | UNMEASURED> · <match | MISMATCH — why | UNMEASURED — why> · <engine> · <platform-arch release · node vN> · <ISO date>`;

function main() {
  const argv = process.argv.slice(2);
  const file = argv.includes('--receipt') ? resolve(argv[argv.indexOf('--receipt') + 1] || '') : RECEIPT;
  let receipt = null;
  try { receipt = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    const r = finish(null, { verdict: 'UNMEASURED', reason: `no receipt at ${file} (${e.code || e.message}) — node scripts/vna/aperture-receipt.mjs writes one, or pass --receipt <file>`, recomputed_omega: null, legs: {}, at: new Date().toISOString(), machine: machineLine() });
    if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2)); console.log(r.line); process.exit(2);
  }
  const r = recomputeReceipt(receipt, readers(REPO));
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  console.log(r.line);
  if (r.verdict !== 'match') console.log(`  ${r.verdict} — ${r.reason}`);
  console.log(`  paste the RECOMPUTE line into ${THIRD_PARTY_FILE} (docs/receipts/README.md)`);
  process.exit(r.verdict === 'match' ? 0 : r.verdict === 'MISMATCH' ? 1 : 2);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
