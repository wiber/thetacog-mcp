// tests/demo-card-onboarding.test.mjs — THE FIM DEMO-CARD ONBOARDING GUARD
//
// WHY THIS EXISTS. The README already carries the SIX-PROMPT sequence (guarded by
// onboarding-sequence.test.mjs) — an adversarial ladder aimed at a model auditing us. It is long
// on purpose. It is the wrong instrument for the other entry: a person standing in a room holding
// the physical FIM card, with whatever AI they already have open. Operator, dictating the ask:
// "the copy sequence of statements assurance … one at a time … short, concise, [not] overbearing
// … the first target is the readme."
//
// The invariants a tidy-up, a merge, or a well-meant expansion would otherwise break SILENTLY:
//   1. POSITION — the card section sits AFTER the six prompts and BEFORE the product section.
//      The reader arrives having already scrolled past the adversarial ladder ("if you [come]
//      from after the existing readme"); moving it above changes who it is addressed to.
//   2. ONE AT A TIME is structural, not a slogan — each step carries EXACTLY ONE paste block.
//      Two blocks in a step is a batch, and a batch is a briefing the reader cannot check.
//   3. SHORT / NOT OVERBEARING is MEASURED, never asserted: per-block line and character caps,
//      and the whole section must stay strictly shorter than the sequence it follows. A section
//      that grows past its parent has become the thing it was written to be an alternative to.
//   4. The physical facts are DERIVED from the manufacturing spec, not typed from memory. A
//      README that invents a cell count is a fabricated object, and the object is the whole claim.
//   5. Same injection ban as the parent section — no paste block may instruct a conclusion.
//   6. The sufficiency contract is printed: what the card DOES show, and what it does NOT.
//   7. No duplication — the card steps never reprint a prompt from the six above.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(resolve(PKG, 'README.md'), 'utf8');

const CARD_HEAD = '## 🎴 Were you handed the card?';
const PRODUCT_HEAD = '## 🍴 THIS REPO IS THE PRODUCT';
const cardAt = README.indexOf(CARD_HEAD);
const productAt = README.indexOf(PRODUCT_HEAD);
const CARD = cardAt >= 0 && productAt > cardAt ? README.slice(cardAt, productAt) : '';
const SIX = cardAt > 0 ? README.slice(0, cardAt) : '';

const STEPS = ['A', 'B', 'C'];
const FENCE = /```\n[\s\S]*?```/g;

/** The slice of the card section belonging to one lettered step (header → next header/end). */
function stepSlice(letter) {
  const start = CARD.indexOf(`**${letter} · `);
  const nextLetter = STEPS[STEPS.indexOf(letter) + 1];
  const end = nextLetter ? CARD.indexOf(`**${nextLetter} · `) : CARD.length;
  return CARD.slice(start, end > start ? end : CARD.length);
}

/** The pasteable text of a step, fences stripped. */
function pasteBlocks(text) {
  return (text.match(FENCE) || []).map((b) => b.replace(/^```\n/, '').replace(/```$/, '').trim());
}

test('1. the card section exists, after the six prompts and before the product section', () => {
  assert.ok(cardAt > 0, 'the demo-card onboarding section is present');
  assert.ok(productAt > cardAt, 'it sits before "THIS REPO IS THE PRODUCT"');
  // it must come after the LAST numbered prompt of the adversarial ladder, not merely after the
  // heading — an insertion in the middle of the six would silently re-address both sequences.
  const lastNumbered = README.lastIndexOf('**6 · ');
  assert.ok(lastNumbered > 0 && lastNumbered < cardAt, 'the six-prompt ladder completes first');
  assert.match(CARD, /three questions, one at a time/, 'the heading states the shape of the ask');
});

test('2. one at a time is structural — exactly three steps, exactly one paste block each', () => {
  let cursor = -1;
  for (const letter of STEPS) {
    const at = CARD.indexOf(`**${letter} · `);
    assert.ok(at > 0, `step ${letter} is present`);
    assert.ok(at > cursor, `step ${letter} comes after the previous step`);
    cursor = at;
    const blocks = pasteBlocks(stepSlice(letter));
    assert.equal(blocks.length, 1, `step ${letter} carries exactly one paste block (found ${blocks.length}) — two is a batch`);
  }
  assert.ok(!CARD.includes('**D · '), 'three steps, not a fourth — the cap is the point');
  assert.equal(pasteBlocks(CARD).length, 3, 'the whole section holds three paste blocks and no stray fourth');
  // and the instruction itself, in the reader's hands
  assert.match(CARD, /Paste one, wait for the answer, then paste the next/i, 'the one-at-a-time instruction is explicit');
  assert.match(CARD, /batch/i, 'and says what goes wrong when they are sent together');
});

test('3. short and not overbearing — measured, not claimed', () => {
  for (const letter of STEPS) {
    const [block] = pasteBlocks(stepSlice(letter));
    const lines = block.split('\n');
    assert.ok(lines.length <= 4, `step ${letter} pastes at most 4 lines (found ${lines.length})`);
    assert.ok(block.length <= 300, `step ${letter} pastes at most 300 chars (found ${block.length})`);
  }
  // the whole point of a second sequence is that it is smaller than the first one
  assert.ok(CARD.length < SIX.length,
    `the card section (${CARD.length} chars) stays shorter than the six-prompt sequence it follows (${SIX.length})`);
});

test('4. the physical facts come from the manufacturing spec, not from memory', () => {
  // monorepo-only: the published tarball has no docs/3d-models, so there is nothing to diff.
  const SPEC = resolve(PKG, '../../docs/3d-models/fim-batch-2-n1-terms/COMPLETE-ARTIFACT-SPECIFICATION.txt');
  const LEGEND = resolve(PKG, '../../docs/3d-models/fim-batch-2-n1-terms/CANONICAL-PATTERN.md');
  if (!existsSync(SPEC) || !existsSync(LEGEND)) return;
  const spec = readFileSync(SPEC, 'utf8');

  const grid = spec.match(/grid_size\s*=\s*(\d+)\s*x\s*(\d+)\s*#[^(]*\((\d+)\s*features\)/);
  assert.ok(grid, 'the spec still declares grid_size with its feature count');
  const [, cols, rows, cells] = grid.map(Number);
  const blocks = Number(spec.match(/blocks_per_artifact\s*=\s*(\d+)/)?.[1]);
  const perBlock = Number(spec.match(/cells_per_block\s*=\s*(\d+)/)?.[1]);
  assert.equal(cols * rows, cells, 'the spec is internally consistent');
  assert.equal(blocks * perBlock, cells, 'blocks × cells-per-block still reconstructs the grid');

  // README must state THESE numbers — computed here, never hard-coded in the assertion
  const words = { 4: 'four', 9: 'nine', 12: 'twelve', 16: 'sixteen' };
  const side = Math.sqrt(perBlock);
  assert.match(CARD, new RegExp(`${cols}×${rows} grid`), `README states the ${cols}×${rows} grid from the spec`);
  assert.match(CARD, new RegExp(`${cells} cells`), `README states ${cells} cells from the spec`);
  assert.match(CARD, new RegExp(`${words[blocks]} ${side}×${side} blocks`),
    `README states ${words[blocks]} ${side}×${side} blocks from the spec`);

  // every cell state named in the canonical legend must appear in the card's description —
  // the construct is "the four states", not the literal string "four"
  const legend = readFileSync(LEGEND, 'utf8');
  const states = [...legend.matchAll(/^\|\s*\*\*[PHBS]\*\*\s*\|\s*([A-Za-z]+)\s*\|/gm)].map((m) => m[1].toLowerCase());
  assert.equal(states.length, 4, 'the legend still defines four cell states');
  for (const s of states) assert.match(CARD.toLowerCase(), new RegExp(s), `the card description names the "${s}" state`);
  assert.match(CARD, new RegExp(`${words[states.length]} states`), 'and states how many there are');
});

test('5. every path a card step sends the reader to actually exists', () => {
  const blocks = pasteBlocks(CARD).join('\n');
  const paths = [...new Set(blocks.match(/[\w./-]+\/[\w.-]+\.(mjs|rs|txt|json|sh|md)/g) || [])];
  assert.ok(paths.length >= 1, 'the card steps name at least one real file');
  for (const p of paths) assert.ok(existsSync(resolve(PKG, p)), `card-referenced path exists: ${p}`);
  assert.ok(paths.includes('data/pmu/shortlex-144-registry.json'),
    'step A points at the registry — the object-vs-lattice check has nowhere else to land');
  // and the registry really does hold the number the card is compared against
  const reg = JSON.parse(readFileSync(resolve(PKG, 'data/pmu/shortlex-144-registry.json'), 'utf8'));
  const alloc = Object.values(reg.allocation || {});
  assert.ok(alloc.length > 0, 'the registry still declares its allocation');
  const branches = alloc.length;                              // A1..C3
  const roots = new Set(Object.keys(reg.allocation).map((k) => k[0])).size;  // A, B, C
  const children = alloc.reduce((a, b) => a + b, 0);          // 132, data-driven
  assert.equal(roots + branches + children, 144,
    `the shipped registry still totals 144 (${roots} roots + ${branches} branches + ${children} children) — step A compares the card against this number`);
});

test('6. no paste block instructs a conclusion (same injection ban as the six above)', () => {
  const blocks = pasteBlocks(CARD).join('\n');
  for (const bad of [
    /you will find that/i, /note that this proves/i, /conclude that/i,
    /confirm that (?:it|this|they)/i, /agree that/i, /verify that we/i,
  ]) assert.ok(!bad.test(blocks), `no leading form: ${bad}`);
  // each step states its point in its header line and predicts, never scripts, the answer
  for (const letter of STEPS) {
    const step = stepSlice(letter);
    assert.match(step.split('\n')[0], /\*\*.+\*\*\s+\S.{15,}/, `step ${letter} states the point in a line`);
    assert.match(step, /^› \*Expect/m, `step ${letter} predicts what the model will say`);
  }
});

test('7. the sufficiency contract is printed — what the card shows, and what it does not', () => {
  // match the SENTENCE, not the markup: bolding a word inside a claim ("fixed **before** you
  // tested it") must not be able to silently drop the assertion that the claim is there at all.
  const PROSE = CARD.replace(/\*+/g, '');
  assert.match(PROSE, /pre-commitment/i, 'names the property the object actually has');
  assert.match(PROSE, /before you tested it/i, 'states what it DOES show');
  assert.match(PROSE, /undecidable \(Rice, 1953\)/, 'and fences what it does NOT show, by name');
  assert.match(PROSE, /we do not claim it/i, 'in our own voice, not as a footnote');
  assert.match(PROSE, /hello@thetadriven\.com/, 'the falsifier has somewhere to go');
});

test('8. the card steps never reprint a prompt from the six above', () => {
  const sixBlocks = pasteBlocks(SIX);
  const cardBlocks = pasteBlocks(CARD);
  assert.ok(sixBlocks.length >= 6, 'the six-prompt ladder is still intact above');
  for (const c of cardBlocks) {
    for (const s of sixBlocks) {
      assert.notEqual(c, s, 'a card step reprints one of the six verbatim');
    }
  }
  // prompt 6 personalises to the reader's job; the card's third step must NOT be a second copy
  assert.ok(!/what I do for a living/i.test(CARD), 'the personal question lives once, in prompt 6');
});
