// Operator 2026-11-05: "lets prep a part of the readme on github to show you can run the /steer commands in claude code app ie not
// terminal with a single command … make sure it bash opens the manual on install - I want to send it to people who dont do vscode".
// The done-when: the manual ships in the tarball, opens exactly once per version from whichever of postinstall or the first command
// runs first, never under CI or THETACOG_NO_OPEN=1, and the README carries the app section with the one command the manual names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openManual, tellAndShow, installUserSkills, manualHtml, MANUAL_REL, MANUAL_OPENED } from '../lib/install-user-skills.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL = path.join(PKG, 'manual', 'steer-in-the-app.html');
const ONE_COMMAND = 'npx thetacog-mcp';
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'manual-'));

test('the manual ships in the tarball and names the one command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('manual/'), 'package.json files carries the manual');
  const html = fs.readFileSync(MANUAL, 'utf8');
  assert.ok(html.includes(ONE_COMMAND), 'the manual names the one command');
  assert.ok(html.includes('/steer '), 'the manual shows a /steer ask');
});

test('opens once per version, and a new version opens it again', () => {
  const h = home(); const opened = [];
  const opener = (f) => opened.push(f);
  const env = {};
  assert.equal(openManual({ home: h, version: '9.9.0', at: 'now' }, { env, opener }).state, 'opened');
  assert.equal(openManual({ home: h, version: '9.9.0', at: 'now' }, { env, opener }).state, 'current');
  assert.equal(openManual({ home: h, version: '9.9.1', at: 'now' }, { env, opener }).state, 'opened');
  assert.equal(opened.length, 2);
  assert.equal(opened[0], path.join(h, MANUAL_REL));
  assert.equal(fs.readFileSync(path.join(h, MANUAL_REL), 'utf8'), manualHtml(PKG));
});

test('CI and THETACOG_NO_OPEN=1 copy the manual and never open it', () => {
  for (const env of [{ CI: 'true' }, { THETACOG_NO_OPEN: '1' }]) {
    const h = home(); const opened = [];
    const r = openManual({ home: h, version: '9.9.0', at: 'now' }, { env, opener: (f) => opened.push(f) });
    assert.equal(r.state, 'not-opened');
    assert.equal(opened.length, 0);
    assert.ok(fs.existsSync(path.join(h, MANUAL_REL)));
    assert.ok(!fs.existsSync(path.join(h, MANUAL_OPENED)), 'an unopened manual is never marked opened');
  }
});

test('the hidden postinstall path reaches the manual too (announce: false)', () => {
  const h = home(); fs.mkdirSync(path.join(h, '.claude'));
  const prev = process.env.THETACOG_NO_OPEN; process.env.THETACOG_NO_OPEN = '1';
  try {
    const story = installUserSkills({ home: h, door: 'postinstall', env: { HOME: h, THETACOG_NO_MCP: '1', THETACOG_NO_HOOKS: '1' }, bin: null });
    tellAndShow(story, { announce: false });
    assert.equal(story.manual && story.manual.state, 'not-opened', 'postinstall ran openManual');
  } finally { if (prev === undefined) delete process.env.THETACOG_NO_OPEN; else process.env.THETACOG_NO_OPEN = prev; }
});

test('the README carries the app section with the same one command', () => {
  const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
  const at = readme.indexOf('## 🖥️ /steer in the Claude Code app');
  assert.ok(at > 0, 'README has the app section');
  const section = readme.slice(at, readme.indexOf('\n## ', at + 5));
  assert.ok(section.includes(ONE_COMMAND), 'the section names the one command');
  assert.ok(section.includes('steer-in-the-app.html'), 'the section links the manual');
});

// "market that as an alternative to attest-demo - like "npx thetacog-mcp" and tell me what skills are available … make sure it works"
const SERVER = path.join(PKG, 'server.js');
const quietEnv = (h) => ({ ...process.env, HOME: h, THETACOG_NO_OPEN: '1', THETACOG_NO_MCP: '1', THETACOG_NO_HOOKS: '1' });

test('a bare npx thetacog-mcp from a shell with nothing on stdin lists the skills and exits 0, never a hung server', async () => {
  const { spawnSync } = await import('node:child_process');
  const h = home(); fs.mkdirSync(path.join(h, '.claude'));
  const r = spawnSync(process.execPath, [SERVER], { encoding: 'utf8', timeout: 30000, input: '', env: quietEnv(h) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "stdout stays clean"); assert.match(r.stderr, /Your Claude Code skills \(\d+/);
  assert.match(r.stderr, /^ {2}\/steer {2,}\S/m, 'the /steer line, read off its own description');
  assert.match(r.stderr, /type\n {2}\/steer </);
  assert.ok(r.stderr.includes(path.join(h, MANUAL_REL)), 'the manual path');
});

test('an MCP host still gets the server: initialize on the pipe is answered', async () => {
  const { spawn } = await import('node:child_process');
  const h = home();
  const p = spawn(process.execPath, [SERVER], { env: quietEnv(h), stdio: ['pipe', 'pipe', 'ignore'] });
  const answered = await new Promise((resolve) => {
    let out = '';
    const t = setTimeout(() => resolve(false), 20000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('"id":1')) { clearTimeout(t); resolve(true); } });
    setTimeout(() => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n'), 300);
  });
  p.kill();
  assert.ok(answered, 'initialize was answered after the bare-person peek');
});

// "the documented /steer and other skills in a full html showing how it works"
test('the installed manual walks /steer and carries one card per bundled skill, read off its own SKILL.md', () => {
  const html = manualHtml(PKG);
  assert.match(html, /How \/steer works/);
  const bundled = fs.readdirSync(path.join(PKG, 'skills')).filter((n) => fs.existsSync(path.join(PKG, 'skills', n, 'SKILL.md')));
  assert.ok(bundled.length >= 5);
  for (const n of bundled) {
    assert.ok(html.includes(`id="skill-${n}"`), `card for /${n}`);
    const desc = (/^description:\s*"?(.*?)"?$/m.exec(fs.readFileSync(path.join(PKG, 'skills', n, 'SKILL.md'), 'utf8')) || [, ''])[1];
    const firstWords = desc.replace(/\s*Triggers:[\s\S]*$/, '').split(/\s+/).slice(0, 4).join(' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(html.includes(firstWords), `/${n} card carries its own description: ${firstWords}`);
  }
  assert.ok(html.indexOf('id="skill-steer"') < html.indexOf('id="skill-board"'), '/steer comes first');
  assert.ok(html.includes('npx thetacog-mcp steer-compile'), '/steer card lists its doors');
});
