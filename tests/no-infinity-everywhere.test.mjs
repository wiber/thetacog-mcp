// tests/no-infinity-everywhere.test.mjs — THE NO-INFINITY-EVERYWHERE GUARD (C694c, 2026-10-08)
//
// Operator 2026-10-08, verbatim: "Everywhere" · "Both GitHub then figure out how to use it".
// The source repo (thetadrivencoach, C691) retracted a family of claims from the book: Katz
// centrality claimed at a 0.05 discount (it diverges there — the receipt is a first-depth
// attenuation, not Katz), a pole near one-twelfth presented as belonging to the committed
// floor (it belongs to the infinite tree the floor doesn't have), the 2.45 figure presented
// as an unretracted handshake between two instruments (it was one ladder summed twice), and
// phase-transition/lasing/ignition language claimed OF THE LATTICE (legitimate when describing
// the brain/PCI analogy ch08 already carries; not legitimate as a property of the 144-cell map).
//
// This repo's own surfaces (README.md, CHANGELOG.md) must never re-import any of those four
// claims without the retraction attached. Run: node --test tests/no-infinity-everywhere.test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function paragraphsMatching(text, re) {
  return text.split(/\n{2,}/).filter((p) => re.test(p));
}

function surfaces() {
  return {
    'README.md': readFileSync(resolve(PKG, 'README.md'), 'utf8'),
    'CHANGELOG.md': readFileSync(resolve(PKG, 'CHANGELOG.md'), 'utf8'),
  };
}

test('Katz is never tied to a 0.05 discount without the divergence disclaimed', () => {
  for (const [name, text] of Object.entries(surfaces())) {
    for (const para of paragraphsMatching(text, /katz/i)) {
      if (!/0\.05/.test(para)) continue;
      assert.match(
        para,
        /not Katz|isn'?t Katz|would diverge|diverges? (on|at)|fails? it/i,
        `${name}: a paragraph ties Katz to 0.05 without disclaiming the divergence:\n${para}`
      );
    }
  }
});

test('the pole near one-twelfth is never claimed as belonging to the committed floor', () => {
  for (const [name, text] of Object.entries(surfaces())) {
    for (const para of paragraphsMatching(text, /one-twelfth/i)) {
      assert.match(
        para,
        /no pole|does(?:n'?t| not) have (a |that )?pole|infinite tree|belongs to the infinite/i,
        `${name}: a paragraph names the one-twelfth pole without retracting it from the finite floor:\n${para}`
      );
    }
  }
});

test('the 2.45 figure is never presented as an unretracted cross-instrument handshake', () => {
  for (const [name, text] of Object.entries(surfaces())) {
    for (const para of paragraphsMatching(text, /2\.45\b/)) {
      // 2.45.0 is a package version, not the walk's figure — skip it.
      if (/2\.45\.0/.test(para) && !/2\.45\b(?!\.0)/.test(para.replace(/2\.45\.0/g, ''))) continue;
      assert.match(
        para,
        /below the band|capped|retract|was (one|the same) ladder|doesn'?t (own|have)|no pole/i,
        `${name}: a paragraph quotes 2.45 without the retraction attached:\n${para}`
      );
    }
  }
});

test('phase transition / lasing / ignition is never claimed OF the lattice itself', () => {
  for (const [name, text] of Object.entries(surfaces())) {
    for (const para of paragraphsMatching(text, /phase transition|\blasing\b|\bignition\b/i)) {
      assert.ok(
        !/lattice|144[^\n]{0,20}(cell|anchor|lattice)|reef/i.test(para),
        `${name}: a paragraph claims phase-transition/lasing/ignition OF the lattice:\n${para}`
      );
    }
  }
});

test('the old unretracted "Infinity Argument" framing does not return', () => {
  for (const [name, text] of Object.entries(surfaces())) {
    assert.ok(
      !/the infinity argument/i.test(text),
      `${name}: the retracted "Infinity Argument" heading/label has returned`
    );
    assert.ok(
      !/unbounded precision/i.test(text) || /finite floor|no pole|does(?:n'?t| not) have/i.test(text),
      `${name}: "unbounded precision" appears without the finite-floor retraction nearby`
    );
  }
});
