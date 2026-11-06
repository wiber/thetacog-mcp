// Operator 2026-11-05: "the bash open happened, but its empty.. it should have all you need to get started with the package -
// including the dump your convo into /steer and see it build the spec and execute it efficiently".
// The done-when: every skills report page, a skipped install included, carries the start-here steps (the one install command,
// a /steer ask, the dump-the-conversation step, the receipt) and a link to a manual that exists on disk; the manual carries the
// same conversation step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyHtml, debugReport, MANUAL_REL } from '../lib/install-user-skills.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = '/steer everything we decided in this conversation';
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'report-start-'));
const skipped = (h) => ({ at: 'now', version: '9.9.0', home: h, target: path.join(h, '.claude', 'skills'), skills: [], wrote: [], refused: [],
  claudeCode: { present: true, why: 'test' }, skipped: 'engine home (test): the monorepo\'s own skills stay in force' });

test('a skipped install still writes a page that gets a person started', () => {
  const h = home();
  const html = storyHtml(skipped(h));
  for (const must of ['start here', 'npx thetacog-mcp</code>', '/steer add a refunds endpoint', DUMP, 'SPEC-VNA-COCKPIT.md', 'Not installed:']) {
    assert.ok(html.includes(must), `the skipped page carries: ${must}`);
  }
});

test('the page lists every skill the package carries, a skipped install included', () => {
  const html = storyHtml(skipped(home()));
  const names = fs.readdirSync(path.join(PKG, 'skills')).filter((n) => fs.existsSync(path.join(PKG, 'skills', n, 'SKILL.md')));
  assert.ok(names.length >= 10, `the package carries its full skill set (found ${names.length})`);
  for (const n of names) assert.ok(html.includes(`id="skill-${n}"`), `the skipped page carries the /${n} card`);
});

test('the report links a manual that exists, and the manual carries the conversation step', () => {
  const h = home();
  const prev = process.env.THETACOG_NO_OPEN; process.env.THETACOG_NO_OPEN = '1';
  try { debugReport(skipped(h), { open: false }); } finally { if (prev === undefined) delete process.env.THETACOG_NO_OPEN; else process.env.THETACOG_NO_OPEN = prev; }
  const page = fs.readFileSync(path.join(h, '.thetacog', 'skills-install.html'), 'utf8');
  const manual = path.join(h, MANUAL_REL);
  assert.ok(page.includes(manual), 'the page links the manual by its path');
  assert.ok(fs.existsSync(manual), 'the linked manual was written beside the page');
  assert.ok(fs.readFileSync(manual, 'utf8').includes(DUMP), 'the manual carries the dump-the-conversation step');
  assert.ok(fs.readFileSync(path.join(PKG, 'manual', 'steer-in-the-app.html'), 'utf8').includes('id="dump-the-conversation"'), 'the shipped manual has the anchored section');
});

// Operator 2026-11-05: "it cannot require the -y or the @latest … can we make it not need that?" Measured the same day: a bare
// `npx thetacog-mcp` from Claude Code (stdin not a TTY) ran with no confirmation prompt and fetched the registry's latest over a cached
// older version. So the line a person is taught is the bare one, on the manual and on the report page.
test('the install line a person is taught carries no -y and no @latest', () => {
  const manual = fs.readFileSync(path.join(PKG, 'manual', 'steer-in-the-app.html'), 'utf8');
  const page = storyHtml(skipped(home())).split("<h2>every skill this package carries</h2>")[0];   // the start-here block, before the skill cards quote each skill verbatim
  for (const [where, text] of [['manual', manual], ['report page', page]]) {
    assert.ok(!/npx -y thetacog-mcp|thetacog-mcp@latest/.test(text), `the ${where} teaches the bare line, never -y or @latest`);
  }
  assert.ok(manual.includes('Run this for me: npx thetacog-mcp</code>'), 'the manual pastes the bare line');
});
