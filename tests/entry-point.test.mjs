// tests/entry-point.test.mjs — THE ENTRY-POINT GUARD
//
// Two failures this must make impossible:
//   A. The regression it fixes coming back — bare `npx thetacog-mcp` at a terminal hanging on a
//      stdio server instead of naming attest-demo as step one.
//   B. The fix breaking every MCP client on earth — a client spawns this binary with piped
//      stdio and NO arguments, which is byte-identical to the human invocation apart from the
//      TTY bits. If the banner ever prints there, it lands in the middle of a JSON-RPC stream.
//
// (B) is checked by SPAWNING THE REAL SERVER over pipes, not by reading the gate's source. The
// gate function is checked directly, both branches, because the decision IS the construct.
import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldPrintEntry, renderEntry } from '../lib/entry-point.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_CLIENT = { argv: ['node', 'server.js'], stdoutIsTTY: undefined, stdinIsTTY: undefined, env: {} };
const HUMAN = { argv: ['node', 'server.js'], stdoutIsTTY: true, stdinIsTTY: true, env: {} };

test('1. a human at a terminal, no args, gets the sequence', () => {
  assert.equal(shouldPrintEntry(HUMAN), true);
});

test('2. an MCP client (piped stdio, no args) NEVER gets it', () => {
  assert.equal(shouldPrintEntry(MCP_CLIENT), false);
  // half-piped is still not a person: a client redirecting only one end must still be served
  assert.equal(shouldPrintEntry({ ...HUMAN, stdoutIsTTY: undefined }), false);
  assert.equal(shouldPrintEntry({ ...HUMAN, stdinIsTTY: undefined }), false);
  // and the explicit override wins even at a real terminal
  assert.equal(shouldPrintEntry({ ...HUMAN, env: { THETACOG_STDIO: '1' } }), false);
});

test('3. every shipped subcommand still owns its own output', () => {
  // read the dispatch table out of server.js rather than hand-listing names: a hand-typed
  // paraphrase of the real command set is a proxy for the command set, and would drift.
  const src = new URL('../server.js', import.meta.url);
  const text = require$readFileSync(src);
  const names = new Set();
  for (const m of text.matchAll(/process\.argv\[2\] === '([\w-]+)'/g)) names.add(m[1]);
  for (const m of text.matchAll(/\['([\w-]+)', 'scripts\//g)) names.add(m[1]);
  assert.ok(names.size >= 20, `found the dispatch table (${names.size} subcommands)`);
  assert.ok(names.has('attest-demo'), 'the entry command is in the table');
  for (const n of names) {
    assert.equal(shouldPrintEntry({ ...HUMAN, argv: ['node', 'server.js', n] }), false,
      `subcommand ${n} is not swallowed by the entry banner`);
    assert.equal(shouldPrintEntry({ ...MCP_CLIENT, argv: ['node', 'server.js', n] }), false);
  }
  // `serve` is the documented escape hatch and must fall through to the server, not print
  assert.equal(shouldPrintEntry({ ...HUMAN, argv: ['node', 'server.js', 'serve'] }), false);
});

test('4. --help is a human asking, terminal or not', () => {
  for (const h of ['--help', '-h', 'help']) {
    assert.equal(shouldPrintEntry({ ...MCP_CLIENT, argv: ['node', 'server.js', h] }), true, h);
  }
});

test('5. the sequence starts at attest-demo and reaches the index — in that order', () => {
  const out = renderEntry({ colour: false });
  const demo = out.indexOf('npx thetacog-mcp attest-demo');
  const pixel = out.indexOf('npx thetacog-mcp my-pixel');
  const index = out.indexOf('npx thetacog-mcp index');
  const register = out.indexOf('npx thetacog-mcp register-surface');
  assert.ok(demo > -1, 'attest-demo is named');
  assert.ok(demo < pixel && pixel < index && index < register,
    'demo → pixel → index → register, in that order');
  // the second half of the ask: the index is YOURS, and it is about the people in your lane
  assert.match(out, /No central registry/i);
  assert.match(out, /lane proximity to YOUR pixel/);
  // the MCP contract is stated where a confused user will look for it
  assert.match(out, /stdio server/);
  // never reprint the diligence prompts here — evidence must not instruct its auditor
  assert.ok(!/Run `npx thetacog-mcp attest-demo` and tell me whether its claims/.test(out));
});

test('6. the REAL server, spawned over pipes with no args, does not print the banner', async () => {
  const proc = spawn(process.execPath, [resolve(PKG, 'server.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  const exited = await new Promise((done) => {
    const t = setTimeout(() => done(false), 6000);
    proc.on('exit', () => { clearTimeout(t); done(true); });
  });
  proc.kill('SIGKILL');
  assert.ok(!/thetacog-mcp — a signed, recomputable record/.test(out + err),
    'the entry banner never reaches an MCP client');
  assert.ok(!/npx thetacog-mcp my-pixel/.test(out),
    'nothing from the sequence lands on the JSON-RPC channel');
  assert.equal(exited, false, 'the stdio server is still running — a client would be served');
});

// tiny local reader so the test has no dependency beyond node:fs
import { readFileSync } from 'node:fs';
function require$readFileSync(url) { return readFileSync(url, 'utf8'); }
