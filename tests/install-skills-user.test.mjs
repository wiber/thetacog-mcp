// C2305 (operator 2026-11-05): "Default install all skills if it's available … installed by default if there is Claude Code present.
// Install all the skills." · "The flags should only be used for debugging … print a long story … open a specific HTML page with what
// versions were present". Every case runs in a throwaway HOME with a PATH that holds node only, so the machine's own ~/.claude and its
// `claude` binary never decide the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLED = fs.readdirSync(path.join(PKG, 'skills')).filter((n) => fs.existsSync(path.join(PKG, 'skills', n, 'SKILL.md'))).sort();
const NODE_ONLY_PATH = path.dirname(process.execPath) + ':/usr/bin:/bin';
const run = (home, args) => spawnSync(process.execPath, [path.join(PKG, ...args[0].split('/')), ...args.slice(1)], {
  encoding: 'utf8', timeout: 60000, env: { HOME: home, PATH: NODE_ONLY_PATH, THETACOG_NO_OPEN: '1' },
});
const fresh = (withClaude) => { const h = fs.mkdtempSync(path.join(os.tmpdir(), 'c2305-')); if (withClaude) fs.mkdirSync(path.join(h, '.claude')); return h; };
const installed = (h) => { const d = path.join(h, '.claude', 'skills'); return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, 'SKILL.md'))).sort() : []; };

test('every bundled skill lands in ~/.claude/skills with no flag when Claude Code is present, and the default tells less, never nothing', () => {
  assert.ok(BUNDLED.includes('steer'), 'the package bundles /steer');
  assert.ok(BUNDLED.includes('licence'), 'the package bundles /licence (C2305 part 2)');
  const h = fresh(true);
  const r = run(h, ['lib/install-user-skills.mjs']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(installed(h), BUNDLED);
  for (const n of BUNDLED) assert.equal(fs.readFileSync(path.join(h, '.claude/skills', n, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(PKG, 'skills', n, 'SKILL.md'), 'utf8'));
  // "not silent just less" · "show and tell both": each skill named once, the report page written beside the tell
  for (const n of BUNDLED) assert.match(r.stderr, new RegExp(`^   /${n}$`, 'm'));
  assert.ok(r.stderr.trim().split('\n').length <= BUNDLED.length + 3, `less than the debug story, got: ${r.stderr}`);
  assert.ok(fs.existsSync(path.join(h, '.thetacog/skills-install.html')), 'the show half: the report page');
  const again = run(h, ['lib/install-user-skills.mjs']);
  assert.equal(again.stderr.trim().split('\n').length, 1, 'nothing new is one line');
  assert.match(again.stderr, /skills current/);
});

test('the npx door installs them too — a cached npx never re-runs postinstall', () => {
  const h = fresh(true);
  const r = run(h, ['server.js', 'skills']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(installed(h), BUNDLED);
  assert.equal(r.stdout, '', 'stdout stays clean: it is the MCP stdio channel');
});

test('no Claude Code on the machine: nothing written', () => {
  const h = fresh(false);
  run(h, ['lib/install-user-skills.mjs']);
  assert.deepEqual(installed(h), []);
});

test("someone else's SKILL.md is never overwritten", () => {
  const h = fresh(true);
  const p = path.join(h, '.claude/skills/steer/SKILL.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '---\nname: not-ours\n---\nmine\n');
  run(h, ['lib/install-user-skills.mjs']);
  assert.equal(fs.readFileSync(p, 'utf8'), '---\nname: not-ours\n---\nmine\n');
});

test('the engine home keeps its own skills: the marker stops the personal write', () => {
  const h = fresh(true);
  fs.mkdirSync(path.join(h, '.thetacog')); fs.writeFileSync(path.join(h, '.thetacog/engine-home'), '');
  run(h, ['lib/install-user-skills.mjs']);
  assert.deepEqual(installed(h), []);
});

test('--debug is the story: every skill named and a report page carrying the version', () => {
  const h = fresh(true);
  const r = run(h, ['server.js', 'skills', '--debug']);
  assert.equal(r.status, 0, r.stderr);
  const version = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  for (const n of BUNDLED) assert.match(r.stderr, new RegExp(`/${n}: missing → current`));
  const page = fs.readFileSync(path.join(h, '.thetacog/skills-install.html'), 'utf8');
  assert.match(page, new RegExp(version.replace(/\./g, '\\.')));
  for (const n of BUNDLED) assert.ok(page.includes(`/${n}`), `page names /${n}`);
});

// From the tarball run (2026-11-05): npm and npx hide postinstall output, so a stranger's first `npx thetacog-mcp skills` saw only
// "current" and never which skills landed; a foreign /steer was listed as current; THETACOG_NO_SKILLS=1 still printed a line.
test('after a hidden postinstall, the first command tells which skills landed — once', () => {
  const h = fresh(true);
  const pi = spawnSync(process.execPath, ['--input-type=module', '-e', `import { installUserSkills, tellAndShow } from ${JSON.stringify(path.join(PKG, 'lib/install-user-skills.mjs'))}; tellAndShow(installUserSkills(), { announce: false });`], { encoding: 'utf8', env: { HOME: h, PATH: NODE_ONLY_PATH, THETACOG_NO_OPEN: '1' } });
  assert.equal(pi.status, 0, pi.stderr);
  assert.deepEqual(installed(h), BUNDLED, 'postinstall wrote them');
  const first = run(h, ['server.js', 'skills']);
  for (const n of BUNDLED) assert.match(first.stderr, new RegExp(`^   /${n}$`, 'm'), `first command names /${n}: ${first.stderr}`);
  const second = run(h, ['server.js', 'skills']);
  assert.match(second.stderr, /skills current/);
  assert.equal(second.stderr.trim().split('\n').length, 1);
});

test("a foreign SKILL.md is never called current", () => {
  const h = fresh(true);
  const p = path.join(h, '.claude/skills/steer/SKILL.md');
  fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '---\nname: not-ours\n---\nmine\n');
  run(h, ['lib/install-user-skills.mjs']);
  const again = run(h, ['lib/install-user-skills.mjs']);
  const currentPart = again.stderr.split(' · left alone')[0];
  assert.ok(!/\/steer\b/.test(currentPart.replace(/\/steer-every/g, '')), `foreign /steer listed as current: ${again.stderr}`);
  assert.match(again.stderr, /left alone/);
});

test('THETACOG_NO_SKILLS=1 is quiet', () => {
  const h = fresh(true);
  const r = spawnSync(process.execPath, [path.join(PKG, 'server.js'), 'skills'], { encoding: 'utf8', env: { HOME: h, PATH: NODE_ONLY_PATH, THETACOG_NO_OPEN: '1', THETACOG_NO_SKILLS: '1' } });
  assert.equal(r.stderr.trim(), '');
  assert.deepEqual(installed(h), []);
});
