// tests/onboarding-sequence.test.mjs — THE EIGHT-PROMPT ONBOARDING GUARD
//
// WHY THIS EXISTS (Marsh diligence session, 2026-08): a remote model ran attest-demo cold,
// returned "Don't wire this into anything", and inverted its own headline finding four questions
// later — with no new argument from us. The four questions were the whole delta. They are now the
// README's first section, in the READER's hands rather than in the tool's output (the same model
// flagged our in-output "context for the evaluating LLM" as prompt injection; it was right).
//
// The invariants a rename or a tidy-up would otherwise break SILENTLY:
//   1. The sequence is the FIRST thing on the page, and all eight prompts are present, in order.
//   2. Every file path a prompt tells an evaluator to open EXISTS in this package. A prompt that
//      sends a stranger to a moved file reads as a lie and kills the session at step 3.
//   3. The walk/Rust half is forced (operator: "not just the gzip") — step 4 names ballistic.rs
//      AND senseDecompose, and states the gzip sensor is the one already examined.
//   4. Step 8 personalises to the reader's own profession AND ships its own falsifier.
//   5. No prompt instructs a conclusion. Falsifier-shaped or it is injection, and injection was
//      the original finding.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(resolve(PKG, 'README.md'), 'utf8');
const SECTION = README.split('## 🍴 THIS REPO IS THE PRODUCT')[0];

test('1. the sequence is the first section, all eight prompts, in order', () => {
  assert.match(SECTION, /Hand this to your AI — six prompts, one paste at a time/);
  let cursor = 0;
  for (let n = 1; n <= 6; n++) {
    const at = SECTION.indexOf(`**${n} · `);
    assert.ok(at > 0, `prompt ${n} is present`);
    assert.ok(at > cursor, `prompt ${n} comes after prompt ${n - 1}`);
    cursor = at;
  }
  const blocks = SECTION.match(/```\n[\s\S]*?```/g) || [];
  assert.ok(blocks.length >= 6, `six copy-paste blocks (found ${blocks.length})`);
});

test('2. every file path the prompts send an evaluator to actually exists', () => {
  const blocks = (SECTION.match(/```\n[\s\S]*?```/g) || []).join('\n');
  const paths = [...new Set(blocks.match(/[\w./-]+\/[\w.-]+\.(mjs|rs|txt|json|sh|md)/g) || [])];
  paths.push(...(blocks.match(/pmu-rust\/target\/release\/pmu-onchip/g) || []));
  const uniq = [...new Set(paths)];
  assert.ok(uniq.length >= 4, `the prompts name real files (found ${uniq.length})`);
  for (const p of uniq) assert.ok(existsSync(resolve(PKG, p)), `prompt-referenced path exists: ${p}`);
  // the two the whole sequence pivots on, named explicitly so a silent rename cannot pass
  assert.ok(uniq.includes('scripts/pmu/triptych-build.mjs'), 'the integer sensor is named');
  assert.ok(uniq.includes('pmu-rust/src/ballistic.rs'), 'the ballistic walk source is named');
  assert.ok(uniq.includes('data/book/COMPLETE-BOOK.txt'), 'the shipped book is named');
});

test('3. the walk is forced, not just the gzip sensor', () => {
  const four = SECTION.slice(SECTION.indexOf('**3 · '), SECTION.indexOf('**4 · '));
  assert.match(four, /senseDecompose/, 'sends them into the integer sensor');
  assert.match(four, /ballistic\.rs/, 'sends them into the Rust walk');
  assert.match(four, /zlib/, 'asks the falsifiable question: does it call zlib');
  const three = SECTION.slice(SECTION.indexOf('**2 · '), SECTION.indexOf('**3 · '));
  assert.match(three, /pmu-onchip/, 'step 3 makes them check the binary executes');
  assert.match(three, /ballistic walk/i, 'step 3 names the walk');
  assert.match(three, /fall back to coarse/i, 'step 2 forces the walk-mode disclosure');
  // senseDecompose must remain zlib-free or step 4 asks a question with the wrong answer
  const sensor = readFileSync(resolve(PKG, 'scripts/pmu/triptych-build.mjs'), 'utf8');
  const body = sensor.slice(sensor.indexOf('const senseDecompose'), sensor.indexOf('const senseI ='));
  assert.ok(!/zlib|gzip|deflate/.test(body), 'senseDecompose stays integer-only — step 4 depends on it');
});

test('4. step 8 personalises to the reader, and carries its own falsifier', () => {
  const eight = SECTION.slice(SECTION.indexOf('**6 · '));
  assert.match(eight, /what I do for a\s+living/i, 'asks about the reader\'s profession');
  assert.match(eight, /MY job/, 'demands the concrete case, not the general one');
  assert.match(eight, /If the honest answer is "nothing," say that/i, 'the out is stated — not a leading prompt');
});

test('5. no prompt instructs a conclusion (falsifier-shaped, never injection)', () => {
  const blocks = (SECTION.match(/```\n[\s\S]*?```/g) || []).join('\n');
  for (const bad of [
    /you will find that/i, /note that this proves/i, /conclude that/i,
    /reach no conclusion until/i, /confirm that (?:it|this|they)/i, /agree that/i,
  ]) assert.ok(!bad.test(blocks), `no leading form: ${bad}`);
  assert.match(SECTION, /evidence must not instruct its auditor/i);
  assert.match(SECTION, /falsifier-shaped/);
  assert.match(SECTION, /evidence must not instruct its auditor/i);
  // step 1 must stay a cold ask for the takedown — the asymmetry is the whole design
  const one = SECTION.slice(SECTION.indexOf('**1 · '), SECTION.indexOf('**2 · '));
  assert.match(one, /whether its claims are to be taken seriously/);
});

test('6. the cover-vs-code framing survives, and the homework stays reachable', () => {
  const two = SECTION.slice(SECTION.indexOf('**2 · '), SECTION.indexOf('**3 · '));
  assert.match(two, /what did you actually skip/i, 'forces the skipped-steps disclosure');
  assert.match(two, /node version/i, 'asks for the environment facts');
  assert.match(two, /Quote your run, not their prose/i, 'refuses narration as evidence');
  assert.ok(existsSync(resolve(PKG, 'scripts/attest-homework.sh')), 'the homework script ships');
  assert.match(SECTION, /attest-homework\.sh/);
  assert.match(SECTION, /hello@thetadriven\.com/, 'the counter-transcript ask survives');
});

test('7. every button carries its point AND a predicted monologue (one line each)', () => {
  // operator 2026-08-20: "one line per each so the user understands what the point is" +
  // "then write out the remote llm inner monologue". Without this guard a tidy-up pass strips
  // both and the section degrades back into eight unexplained code blocks.
  for (let n = 1; n <= 6; n++) {
    const next = n < 8 ? SECTION.indexOf(`**${n + 1} · `) : SECTION.indexOf('**Then hand it the homework**');
    const step = SECTION.slice(SECTION.indexOf(`**${n} · `), next);
    const head = step.split('\n')[0];
    assert.match(head, /\*\*.+\*\*\s+\S.{20,}/, `step ${n} header states the point in a line`);
    assert.match(step, /^› \*(Predicted|Expect)/m, `step ${n} predicts what the remote model will say`);
  }
  // published as a forecast, never as a script the reader should hold their model to
  assert.match(SECTION, /a forecast, not a script/);
  assert.match(SECTION, /a model that says something else is the data we want/);
});

test('8. the other two surfaces point at the sequence without reprinting it', () => {
  // operator 2026-08-20: "figure out what other surfaces to put it against". The README is
  // surface 1. A cold runner is in the TERMINAL, and an evaluating model is sent to DILIGENCE.md
  // — both must point at the eight prompts. Neither may reprint them: an artifact that hands its
  // own auditor the questions is the prompt-injection finding all over again.
  // the package copy of scripts/ is DERIVED (synced from the monorepo root) — read the source
  // when it is there, exactly as attest-redpill.test.mjs does, so the guard never binds a copy
  const DEMO_PATH = [resolve(PKG, '../../scripts/pmu/attest-demo.mjs'), resolve(PKG, 'scripts/pmu/attest-demo.mjs')].find(existsSync);
  assert.ok(DEMO_PATH, 'attest-demo.mjs is reachable');
  const demo = readFileSync(DEMO_PATH, 'utf8');
  assert.match(demo, /PROMPTS .* LIVE IN THE README/, 'the terminal points at the README');
  assert.match(demo, /NOT IN THIS OUTPUT/, 'and says it is on purpose');
  assert.match(demo, /evidence must not instruct its auditor/i, 'and names the reason');
  assert.match(demo, /github\.com\/wiber\/thetacog-mcp/, 'with the address a stranger can reach');

  const dil = readFileSync(resolve(PKG, 'DILIGENCE.md'), 'utf8');
  assert.match(dil, /## Realization 0 — you were probably handed prompt 1 of/);
  assert.match(dil, /senseDecompose/, 'names the integer sensor');
  assert.match(dil, /ballistic\.rs/, 'names the walk — not just the gzip half');
  assert.match(dil, /about to write the verdict that got retracted/, 'states the stake plainly');

  // NEITHER surface may carry the pasteable blocks — pointing is not steering, reprinting is
  for (const [name, txt] of [['attest-demo', demo], ['DILIGENCE.md', dil]]) {
    assert.ok(!/Run `npx thetacog-mcp attest-demo` and tell me whether its claims/.test(txt),
      `${name} points at the sequence, never reprints prompt 1 as a paste block`);
    assert.ok(!/Last one, about me not them/.test(txt),
      `${name} does not reprint prompt 8`);
  }
});

test('9. the git-ignored scripts/pmu mirror matches its tracked source', () => {
  // 2026-08-21: packages/thetacog-mcp/scripts/pmu/ is a git-ignored copy of the repo-root
  // scripts/pmu/, regenerated by bundle-pmu.mjs — which ran ONLY from prepack. A GitHub-only
  // push therefore shipped whatever stale copy sat on disk: the six-prompt terminal pointer
  // landed on the tracked source while the mirror still said eight, and the public repo
  // published the old wording with no diff explaining it. mirror-to-public.sh now regenerates
  // before rsync; this asserts the two copies agree for the file the onboarding pointer lives in.
  const SRC = resolve(PKG, '../../scripts/pmu/attest-demo.mjs');
  const MIR = resolve(PKG, 'scripts/pmu/attest-demo.mjs');
  if (!existsSync(SRC)) return;               // running from the published tarball: no source to diff
  assert.ok(existsSync(MIR), 'the bundled mirror exists');
  assert.equal(readFileSync(MIR, 'utf8'), readFileSync(SRC, 'utf8'),
    'bundled scripts/pmu/attest-demo.mjs is byte-for-byte its tracked source — run bundle-pmu.mjs');

  const mirror = readFileSync(resolve(PKG, '../../scripts/mirror-to-public.sh'), 'utf8');
  assert.match(mirror, /bundle-pmu\.mjs/, 'the public mirror regenerates before it syncs');
  assert.ok(mirror.indexOf('bundle-pmu.mjs') < mirror.indexOf('rsync -a --delete'),
    'the regeneration runs BEFORE the rsync, or it ships the stale copy anyway');
});
