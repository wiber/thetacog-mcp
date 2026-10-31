#!/usr/bin/env node
// packages/thetacog-mcp/scripts/bundle-intentguard.mjs — C1424: the bundled IntentGuard addons are the release's.
//
// thetacog-mcp ships intentguard as a bundled dependency (C1380, 25cb8366e5): node_modules/intentguard is a real copy
// extracted from `npm pack ../IntentGuard`, never a file: link. 2.57.0 and vsix 0.3.119 shipped that copy from the
// 2026-10-28 22:13 pack (linux-x64 58bfdcf1…, linux-arm64 a8628e25…, darwin-arm64 53a0e70d…, darwin-x64 532bfe29…)
// while ../IntentGuard/napi/dist already carried the 2.1.0 release legs named by its BUILD-STAMP.json. Nothing compared
// the two, so the stale copy rode into a release.
//
//   node scripts/bundle-intentguard.mjs           re-pack ../IntentGuard into node_modules/intentguard and record the stamp
//   node scripts/bundle-intentguard.mjs --check   (prepack) refuse when the bundled copy is not the recorded stamp
//
// RE-BUNDLE: `npm pack` inside ../IntentGuard into a scratch dir under os.tmpdir() (the .tgz never lands in either repo),
// extract its package/ into a staging dir beside node_modules/intentguard, verify the four napi/dist/*.node sha256s equal
// ../IntentGuard/napi/dist/BUILD-STAMP.json, then swap the staging dir in by rename (the old dir, or a symlink, is
// removed first — the bundled copy is a real directory, never a link), verify again in place, and write
// intentguard-addons.json { version, source, addons: {leg: sha256}, bundledAt }. Nothing is built and nothing is
// committed inside ../IntentGuard; its own prepack (a statSync over the four legs) is the only thing that runs there.
//
// --CHECK refuses (exit 1, the differing legs named) when:
//   · intentguard-addons.json is missing or malformed (four legs, 64-hex each, a version);
//   · node_modules/intentguard is missing or a symlink (except under CI=true, see below);
//   · any of the four bundled .node sha256s differs from the recorded stamp;
//   · the bundled package.json version differs from the stamped version;
//   · ../IntentGuard/napi/dist/BUILD-STAMP.json is present and names different legs or source than the recorded stamp —
//     the 2.57.0 incident exactly: the bundled copy agreed with itself, the release beside it had moved.
// When ../IntentGuard is absent the sibling comparison cannot be made and is said so (UNMEASURED), never passed silently.
// The one carve-out: a CI checkout (CI=true; attest-demo-linux-smoke.yml packs a fresh clone) has no node_modules at all,
// because node_modules is untracked; that tarball resolves intentguard from the registry and is a smoke, never a release.
// It is printed as UNMEASURED and passes. Outside CI an absent bundle refuses: a release without it ships no engine.
//
// Overrides (the guard's firing test uses them on a scratch package): --pkg <dir> (default: this package),
// --intentguard <dir> (default: INTENTGUARD_REPO, else ../IntentGuard beside the repo).
// @guard tests/vna/c1424-the-bundled-intentguard-addons-are.test.mjs
import { readFileSync, writeFileSync, existsSync, lstatSync, mkdtempSync, rmSync, cpSync, renameSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE_PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // packages/thetacog-mcp
const REPO = resolve(HERE_PKG, '..', '..');
export const LEGS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
export const STAMP_REL = 'intentguard-addons.json';
export const BUNDLED_REL = 'node_modules/intentguard';
export const IG_DEFAULT = process.env.INTENTGUARD_REPO || resolve(REPO, '..', 'IntentGuard');
const HEX64 = /^[0-9a-f]{64}$/;
const short = (s) => (typeof s === 'string' ? `${s.slice(0, 8)}…` : String(s));

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const legFile = (dir, leg) => join(dir, 'napi', 'dist', `intentguard.${leg}.node`);

// the four legs' sha256 in a package dir (an intentguard package root); a missing leg reads null
export function legShas(dir) {
  const out = {};
  for (const leg of LEGS) out[leg] = existsSync(legFile(dir, leg)) ? sha256(legFile(dir, leg)) : null;
  return out;
}

// legs whose sha differs between two {leg: sha} maps, each named with both sides
export function diffLegs(want, got, [wantAs, gotAs] = ['recorded', 'found']) {
  return LEGS.filter((l) => want?.[l] !== got?.[l]).map((l) => `${l}: ${wantAs} ${short(want?.[l])} · ${gotAs} ${short(got?.[l])}`);
}

// a stamp is well-formed when it names exactly the four legs, each a 64-hex sha256, and a version
export function stampProblems(stamp) {
  const p = [];
  if (!stamp || typeof stamp !== 'object') return ['not a JSON object'];
  if (typeof stamp.version !== 'string' || !/^\d+\.\d+\.\d+/.test(stamp.version)) p.push(`version ${JSON.stringify(stamp.version)} is not a semver`);
  const legs = Object.keys(stamp.addons || {}).sort();
  if (JSON.stringify(legs) !== JSON.stringify(LEGS)) p.push(`addons names [${legs.join(', ')}], want exactly [${LEGS.join(', ')}]`);
  for (const l of LEGS) if (!HEX64.test(String(stamp.addons?.[l] ?? ''))) p.push(`addons.${l} is not a 64-hex sha256`);
  return p;
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

// the release's stamp beside this repo: ../IntentGuard/napi/dist/BUILD-STAMP.json, or null when that tree is absent
export function siblingStamp(ig = IG_DEFAULT) {
  const f = join(ig, 'napi', 'dist', 'BUILD-STAMP.json');
  return existsSync(f) ? { file: f, stamp: readJson(f) } : null;
}

// --check: the refusals, as a list (empty = the bundled copy is the recorded stamp, and the stamp is the release's)
export function check({ pkg = HERE_PKG, ig = IG_DEFAULT, env = process.env } = {}) {
  const refusals = [], notes = [];
  const stampFile = join(pkg, STAMP_REL), bundled = join(pkg, BUNDLED_REL);
  if (!existsSync(stampFile)) return { refusals: [`no recorded stamp at ${STAMP_REL} — run node scripts/bundle-intentguard.mjs`], notes };
  let stamp; try { stamp = readJson(stampFile); } catch (e) { return { refusals: [`${STAMP_REL} is not JSON: ${e.message}`], notes }; }
  const bad = stampProblems(stamp);
  if (bad.length) return { refusals: bad.map((b) => `${STAMP_REL}: ${b}`), notes };
  const sib = siblingStamp(ig);
  if (sib) {
    const d = diffLegs(sib.stamp.addons, stamp.addons, ['release', 'recorded']);
    if (d.length) refusals.push(`${STAMP_REL} is not the release's: ${sib.file} differs on ${d.length} leg(s) (run node scripts/bundle-intentguard.mjs):\n    ${d.join('\n    ')}`);
    if (sib.stamp.source && sib.stamp.source !== stamp.source) refusals.push(`${STAMP_REL} source ${short(stamp.source)} ≠ ${sib.file} source ${short(sib.stamp.source)}`);
  } else {
    notes.push(`UNMEASURED: no ${join(ig, 'napi/dist/BUILD-STAMP.json')} — the recorded stamp is checked against the bundled copy only, not against the release`);
  }
  if (!existsSync(bundled)) {
    if (env.CI && env.CI !== 'false' && env.CI !== '0') { notes.push(`UNMEASURED: no ${BUNDLED_REL} in this CI checkout (node_modules is untracked) — this tarball resolves intentguard from the registry and is a smoke, never a release`); return { refusals, notes, stamp }; }
    refusals.push(`no bundled copy at ${BUNDLED_REL} — run node scripts/bundle-intentguard.mjs (a release without it ships no engine)`);
    return { refusals, notes, stamp };
  }
  if (isLink(bundled)) refusals.push(`${BUNDLED_REL} is a symlink — the bundled copy must be a real directory from npm pack (C1380), run node scripts/bundle-intentguard.mjs`);
  const got = legShas(bundled);
  const d = diffLegs(stamp.addons, got);
  if (d.length) refusals.push(`the bundled addons are not the recorded stamp — ${d.length} leg(s) differ (run node scripts/bundle-intentguard.mjs):\n    ${d.join('\n    ')}`);
  let version = null; try { version = readJson(join(bundled, 'package.json')).version; } catch { /* named below */ }
  if (version !== stamp.version) refusals.push(`${BUNDLED_REL}/package.json version ${version} ≠ stamped ${stamp.version}`);
  return { refusals, notes, stamp, bundledShas: got };
}

// the re-bundle: npm pack ../IntentGuard → scratch → staging → swap → verify → stamp
export function bundle({ pkg = HERE_PKG, ig = IG_DEFAULT, log = console.log } = {}) {
  const sib = siblingStamp(ig);
  if (!sib) throw new Error(`no ${join(ig, 'napi/dist/BUILD-STAMP.json')} — nothing to bundle from (set INTENTGUARD_REPO)`);
  const want = sib.stamp.addons;
  const wantBad = stampProblems({ version: '0.0.0', addons: want });
  if (wantBad.length) throw new Error(`${sib.file} is malformed: ${wantBad.join('; ')}`);
  const distD = diffLegs(want, legShas(ig));
  if (distD.length) throw new Error(`${ig}/napi/dist does not match its own BUILD-STAMP.json — refusing to pack it:\n    ${distD.join('\n    ')}`);
  const scratch = mkdtempSync(join(tmpdir(), 'bundle-intentguard-'));
  const nm = join(pkg, 'node_modules'), target = join(pkg, BUNDLED_REL), staging = join(nm, `.intentguard-bundle-${process.pid}`);
  try {
    const packed = spawnSync('npm', ['pack', '--pack-destination', scratch], { cwd: ig, encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 });
    if (packed.status !== 0) throw new Error(`npm pack in ${ig} failed (exit ${packed.status}): ${String(packed.stderr || packed.error || '').slice(0, 400)}`);
    const tgzs = readdirSync(scratch).filter((f) => f.endsWith('.tgz'));
    if (tgzs.length !== 1) throw new Error(`npm pack left ${tgzs.length} tarballs in ${scratch}: ${tgzs.join(', ')}`);
    const tgz = join(scratch, tgzs[0]), ex = join(scratch, 'x');
    mkdirSync(ex);
    const tar = spawnSync('tar', ['-xzf', tgz, '-C', ex], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`tar -xzf ${tgz} failed: ${tar.stderr}`);
    const src = join(ex, 'package');
    const version = readJson(join(src, 'package.json')).version;
    const exD = diffLegs(want, legShas(src));
    if (exD.length) throw new Error(`the packed tarball's addons are not BUILD-STAMP.json's:\n    ${exD.join('\n    ')}`);
    mkdirSync(nm, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    cpSync(src, staging, { recursive: true });
    const stD = diffLegs(want, legShas(staging));
    if (stD.length) throw new Error(`the staged copy's addons are not BUILD-STAMP.json's:\n    ${stD.join('\n    ')}`);
    if (isLink(target)) unlinkSync(target); else rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    const got = legShas(target);
    const inD = diffLegs(want, got);
    if (inD.length) throw new Error(`after the swap the bundled addons are not BUILD-STAMP.json's:\n    ${inD.join('\n    ')}`);
    const stamp = {
      version,
      source: sib.stamp.source ?? null,
      addons: Object.fromEntries(LEGS.map((l) => [l, got[l]])),
      bundledAt: new Date().toISOString(),
      by: 'scripts/bundle-intentguard.mjs — npm pack ../IntentGuard, extracted into node_modules/intentguard; prepack runs --check',
    };
    writeFileSync(join(pkg, STAMP_REL), JSON.stringify(stamp, null, 2) + '\n');
    log(`· intentguard ${version} re-bundled from ${tgzs[0]} (npm pack ${ig}) into ${BUNDLED_REL}; source ${short(stamp.source)}`);
    for (const l of LEGS) log(`  ${l.padEnd(13)} ${got[l]}`);
    log(`  stamp → ${STAMP_REL}`);
    return stamp;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
  }
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = arg('--pkg') ? resolve(arg('--pkg')) : HERE_PKG;
  const ig = arg('--intentguard') ? resolve(arg('--intentguard')) : IG_DEFAULT;
  if (process.argv.includes('--check')) {
    const { refusals, notes, bundledShas } = check({ pkg, ig });
    for (const n of notes) console.log(`  ${n}`);
    if (refusals.length) {
      console.error(`✗ bundle-intentguard --check REFUSES the pack:\n  ${refusals.join('\n  ')}`);
      process.exit(1);
    }
    console.log(bundledShas ? `· intentguard bundle = recorded stamp (${LEGS.map((l) => `${l} ${short(bundledShas[l])}`).join(' · ')})` : '· intentguard bundle UNMEASURED (named above); nothing refused');
  } else {
    try { bundle({ pkg, ig }); } catch (e) { console.error(`✗ bundle-intentguard: ${e.message}`); process.exit(1); }
  }
}
