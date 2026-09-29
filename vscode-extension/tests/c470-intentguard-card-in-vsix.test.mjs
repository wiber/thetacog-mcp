// packages/thetacog-mcp-vscode/tests/c470-intentguard-card-in-vsix.test.mjs — C470 THE GUARD: THE VSIX
// CARRIES THE CARD. Run: node --test packages/thetacog-mcp-vscode/tests/c470-intentguard-card-in-vsix.test.mjs
//
// (a) the extension's loader (src/intentguard/nativeAddon.ts, compiled to out/) resolves the right
//     filename for a given platform/arch and returns { addon: null, reason } — NEVER throws — when the
//     file is absent.
// (b) REAL: the card the extension's loader produces equals the card src/lib/intentguard/addon.mjs (the
//     server's own loader) produces, byte-for-byte, on the same text — naked and with a bulk/spec string.
//     Skipped with UNMEASURED when neither the packaged native/ nor a sibling ../IntentGuard checkout has
//     a working addon for this host.
// (c) .vscodeignore does not exclude native/ (a vsix without the addon ships a command that always says
//     UNMEASURED).
// (d) package.json contributes both commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { loadAddon } from '../../../src/lib/intentguard/addon.mjs';   // the SERVER's own loader (C465) — the byte-for-byte comparison target

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG_DIR, '..', '..');
const COMPILED = resolve(PKG_DIR, 'out/intentguard/nativeAddon.js');
const IG_DIST = resolve(REPO, '..', 'IntentGuard', 'napi', 'dist');

test('C470.0 the loader compiled', () => {
  assert.ok(existsSync(COMPILED), `run \`npx tsc -p .\` in ${PKG_DIR} — an uncompiled module never loads (${COMPILED})`);
});

const { loadNativeAddon, addonFileName } = createRequire(import.meta.url)(COMPILED);

test('C470a addonFileName() names the platform-arch pair the same way the sibling repo and the server loader do', () => {
  assert.equal(addonFileName('darwin', 'arm64'), 'intentguard.darwin-arm64.node');
  assert.equal(addonFileName('darwin', 'x64'), 'intentguard.darwin-x64.node');
  assert.equal(addonFileName('linux', 'arm64'), 'intentguard.linux-arm64.node');
  assert.equal(addonFileName('linux', 'x64'), 'intentguard.linux-x64.node');
  assert.equal(addonFileName(), `intentguard.${process.platform}-${process.arch}.node`, 'defaults to the running host');
});

test('C470b loadNativeAddon() picks the right file per platform/arch and never throws when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c470-native-'));
  try {
    // no native/ at all
    const empty = loadNativeAddon(dir);
    assert.equal(empty.addon, null);
    assert.match(empty.reason, /UNMEASURED/);
    assert.match(empty.reason, new RegExp(`native.*intentguard\\.${process.platform}-${process.arch}\\.node`));

    // a native/ that carries every OTHER platform's file, but not this one — still UNMEASURED, never throws,
    // and the reason names the file it actually looked for (proves it picked the RIGHT name, not just any .node)
    mkdirSync(join(dir, 'native'), { recursive: true });
    for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'x64']]) {
      if (platform === process.platform && arch === process.arch) continue;
      writeFileSync(join(dir, 'native', `intentguard.${platform}-${arch}.node`), 'not a real addon');
    }
    const stillEmpty = loadNativeAddon(dir);
    assert.equal(stillEmpty.addon, null);
    assert.match(stillEmpty.reason, /UNMEASURED/);
    assert.ok(stillEmpty.reason.includes(addonFileName()), `reason names the sought file: ${stillEmpty.reason}`);

    // a garbage file AT the right name: a bad .node still never throws — it is caught and reported
    writeFileSync(join(dir, 'native', addonFileName()), 'garbage, not an elf/macho binary');
    const bad = loadNativeAddon(dir);
    assert.equal(bad.addon, null);
    assert.match(bad.reason, /UNMEASURED/);
    assert.match(bad.reason, /failed to load/);

    // an explicit, different platform/arch resolves ITS OWN name, independent of the host running the test
    const other = loadNativeAddon(dir, 'darwin', 'arm64');
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      assert.match(other.reason, /failed to load/); // the garbage file above IS this host's name
    } else {
      assert.match(other.reason, /UNMEASURED: no native IntentGuard addon/); // the placeholder written above is unloadable-garbage too, but for THIS test what matters is the filename it named
      assert.ok(other.reason.includes('intentguard.darwin-arm64.node'), other.reason);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C470c a relative extensionPath still resolves to an absolute file (require() of a bare relative string is a MODULE lookup, not a file path)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c470-relative-'));
  try {
    mkdirSync(join(dir, 'native'), { recursive: true });
    writeFileSync(join(dir, 'native', addonFileName()), 'garbage');
    const cwdBefore = process.cwd();
    process.chdir(dir);
    try {
      const r = loadNativeAddon('.');
      // must still fail because the CONTENT is garbage, never because the require() call itself
      // mistook the resolved path for a package name (which reads as "Cannot find module '<bare name>'")
      assert.match(r.reason, /failed to load/, `must fail on content, not resolution: ${r.reason}`);
      assert.doesNotMatch(r.reason, /Cannot find module '(?!\/)/, 'a relative extensionPath must not produce a bare module-name lookup');
    } finally {
      process.chdir(cwdBefore);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C470d REAL: the extension loader\'s card equals the server loader\'s card, byte-for-byte, on the same text', async (t) => {
  if (!existsSync(IG_DIST)) { t.skip(`UNMEASURED: no ${IG_DIST} (../IntentGuard/napi/build-all.sh)`); return; }
  const hostFile = addonFileName();
  if (!existsSync(join(IG_DIST, hostFile))) { t.skip(`UNMEASURED: no ${join(IG_DIST, hostFile)} for this host`); return; }

  const server = loadAddon();
  if (!server.addon || typeof server.addon.card !== 'function') { t.skip(`UNMEASURED: server loader found no addon on this host (${server.reason || 'no addon'})`); return; }

  // Build a scratch "extension" with native/<hostFile> copied from the sibling repo's dist — exactly what
  // scripts/copy-intentguard-native.mjs does for the real vsix.
  const scratchExt = mkdtempSync(join(tmpdir(), 'c470-ext-'));
  try {
    mkdirSync(join(scratchExt, 'native'), { recursive: true });
    writeFileSync(join(scratchExt, 'native', hostFile), readFileSync(join(IG_DIST, hostFile)));

    const ext = loadNativeAddon(scratchExt);
    assert.ok(ext.addon, `extension loader failed on a freshly-copied real addon: ${ext.reason}`);
    assert.equal(ext.path, join(scratchExt, 'native', hostFile));

    for (const [name, text, bulk] of [
      ['naked', 'refund $400 to order 17\n', undefined],
      ['with bulk', 'refund $400 to order 17\n', '# lane\nrefunds under $500 only\n'],
    ]) {
      const fromExt = Buffer.from(await ext.addon.card(text, bulk));
      const fromServer = Buffer.from(await server.addon.card(text, bulk));
      assert.equal(fromExt.toString('hex'), fromServer.toString('hex'), `card() ${name}: extension loader vs server loader diverged`);
      assert.ok(fromExt.length > 0);
    }
  } finally {
    rmSync(scratchExt, { recursive: true, force: true });
  }
});

test('C470e .vscodeignore does not exclude native/', () => {
  const ignore = readFileSync(resolve(PKG_DIR, '.vscodeignore'), 'utf8');
  const lines = ignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const excludesNative = lines.some((l) => l === 'native' || l === 'native/' || l.startsWith('native/') || l === 'native/**');
  assert.equal(excludesNative, false, `.vscodeignore excludes native/: ${lines.filter((l) => l.includes('native')).join(', ')}`);
});

test('C470f package.json contributes both IntentGuard commands', () => {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const cmds = pkg.contributes.commands;
  const card = cmds.find((c) => /card.*for.*selection/i.test(c.title) && /intentguard/i.test(c.title));
  const check = cmds.find((c) => /check.*production.*card/i.test(c.title) && /intentguard/i.test(c.title));
  assert.ok(card, `no command titled ".../IntentGuard.../Card for Selection" — titles: ${cmds.map((c) => c.title).join(' | ')}`);
  assert.ok(check, `no command titled ".../IntentGuard.../Check a Production Card" — titles: ${cmds.map((c) => c.title).join(' | ')}`);
  // C106f.3 / C118.3 (already-guarded house rules): id keeps the vna. prefix, title carries Steer:
  for (const c of [card, check]) {
    assert.match(c.command, /^vna\./, `${c.command}: command id keeps the vna. prefix`);
    assert.match(c.title, /^Steer: /, `${c.command}: title carries the Steer: palette prefix`);
  }
});
