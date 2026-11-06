// packages/thetacog-mcp/tests/ur-attest-zero-setup.test.mjs — FRICTIONLESS RECOMPUTATION (2026-09-14)
//
// The distribution discipline's fourth line: "npx thetacog-mcp ur-attest or attest-demo requires zero setup, zero
// proprietary API keys, and runs on an underwriter's laptop in under a minute." This guard pins the construct,
// not the sentence:
//   1. the command runs under a SCRUBBED environment — PATH and HOME only; no CLAUDE_*/ANTHROPIC_*/OPENAI_*/
//      RESEND_* key reaches it, and it does not need one;
//   2. it makes no network call (no fetch/http(s) client in the preset or the sensor it imports);
//   3. it finishes well inside a minute, measured and printed — the number is the receipt, never asserted loosely;
//   4. the receipt it writes verifies with the public key in the tape (a stranger recomputes the same bytes).
// Run: node --test packages/thetacog-mcp/tests/ur-attest-zero-setup.test.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = resolve(PKG, 'server.js');
const PRESET = resolve(PKG, 'scripts/pmu/ur-attest.mjs');
const SENSOR = resolve(PKG, 'scripts/pmu/attest-hypotheses.mjs');
const SCRUBBED = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };

test('1+3 · ur-attest runs with only PATH and HOME in its environment, and inside a minute (measured)', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-zero-'));
  const out = join(cwd, 'receipt.json');
  const t0 = performance.now();
  const raw = execFileSync('node', [SERVER, 'ur-attest', '--json', '--out', out], { cwd, env: SCRUBBED, encoding: 'utf8', timeout: 60000 });
  const ms = Math.round(performance.now() - t0);
  t.diagnostic(`ur-attest under a scrubbed env: ${ms} ms wall (limit 60000)`);
  assert.ok(ms < 60000, `${ms} ms is not "under a minute"`);
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  assert.strictEqual(j.kind, 'thetacog-ur-attest');
  assert.strictEqual(j.results.length, 4, 'the four default determinations are placed');
  assert.ok(existsSync(out), 'the receipt is written where asked');
});

test('2 · no network, no key: the preset and its sensor carry no fetch/http client and read no API key', () => {
  for (const f of [PRESET, SENSOR]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\bfetch\(|require\(['"]https?['"]\)|from ['"]node:https?['"]|new WebSocket\(/.test(src), `${f} makes no network call`);
    assert.ok(!/process\.env\.[A-Z_]*(API_KEY|TOKEN|SECRET)/.test(src), `${f} reads no API key`);
  }
});

test('4 · the receipt verifies with the key it carries — a stranger recomputes the same bytes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-zero-v-'));
  const out = join(cwd, 'receipt.json');
  execFileSync('node', [SERVER, 'ur-attest', '--json', '--out', out], { cwd, env: SCRUBBED, encoding: 'utf8', timeout: 60000 });
  const tape = JSON.parse(readFileSync(out, 'utf8'));
  const { verifyReceipt } = await import(resolve(PKG, 'scripts/pmu/receipt-crypto.mjs'));
  const v = verifyReceipt(tape);
  assert.strictEqual(v.ok, true, `receipt verifies: ${JSON.stringify(v).slice(0, 120)}`);
  assert.ok(tape.pubkey_hex && tape.sig_hex && tape.sha256, 'the receipt carries its key, signature and body hash');
});
