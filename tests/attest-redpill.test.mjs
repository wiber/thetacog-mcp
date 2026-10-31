// packages/thetacog-mcp/tests/attest-redpill.test.mjs — THE RED-PILL SPECTACLE GUARD
// (operator 2026-07-13: "the HTML must must must tell the user what questions it can ask their own
// AI that just got red pilled — make it a spectacle... it has to render the panels on the page and
// it has to explain the steps to take").
//
// Invariants on the attest-demo report:
//   1. The page NAMES the five panels (PRE-WALK Δ · INTENT · REALITY · Δ · TOLERANCE) and renders
//      them from THIS run (the triptych dataHtml block — real images, never a mockup).
//   2. The red-pill section exists as a SPECTACLE: six numbered questions for the reader's OWN AI,
//      including the recompute-offline corkscrew, and it never dictates the conclusion (Trust
//      Inversion: hand the bottle, let them pop it).
//   3. The steps section exists — numbered, from this page to the reader's own receipts, ending in
//      the ambient hooks (intervene / install-hooks).
//   4. The TERMINAL run announces the red pill too (the command is bash-opened; the console is the
//      first surface the runner sees).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = [resolve(PKG, '../../scripts/pmu/attest-demo.mjs'), resolve(PKG, 'scripts/pmu/attest-demo.mjs')].find(existsSync);
const SRC = readFileSync(SRC_PATH, 'utf8');

test('1. the five panels are named and rendered from the run', () => {
  assert.match(SRC, /The five panels — PRE-WALK Δ · INTENT · REALITY · Δ · TOLERANCE, rendered from THIS run/);
  assert.match(SRC, /\$\{trip\}/, 'the real triptych dataHtml must render right under the five-panels heading');
  assert.match(SRC, /the competence pixel on all of them/);
});

test('2. the red-pill spectacle: six questions for the reader\'s own AI, conclusion never dictated', () => {
  assert.match(SRC, /The red pill is not for you\. It is for your AI\./);
  for (const n of ['>1<', '>2<', '>3<', '>4<', '>5<', '>6<'].map((x) => x.replace(/>(\d)</, '$1')))
    assert.ok(SRC.includes(`<td class="mono" style="color:#f5d576">${n}</td>`), `question ${n} present`);
  assert.match(SRC, /recompute offline, byte-for-byte, without calling you again/i);   // the corkscrew
  assert.match(SRC, /we don't tell you what your AI will conclude/i);                  // Trust Inversion held
  assert.match(SRC, /hello@thetadriven\.com/);                                         // the counter-transcript ask
});

test('3. the steps: numbered, ending in the ambient hooks', () => {
  assert.match(SRC, /The steps — from this page to your own receipts/);
  assert.match(SRC, /You already did step one/);
  assert.match(SRC, /thetacog-mcp intervene<\/code>/);
  assert.match(SRC, /thetacog-install-hooks --all/);
  assert.match(SRC, /prove-rice --check/);
});

test('4. the terminal announces the red pill (the bash-opened surface)', () => {
  assert.match(SRC, /THE RED PILL IS NOT FOR YOU — IT IS FOR YOUR AI\./);
  assert.match(SRC, /SIX QUESTIONS to paste into your own Claude\/GPT\/Gemini/);
});
