// packages/thetacog-mcp-vscode/tests/c501b-viz-button-is-seen-between-plus-and-fund.test.js — C501b THE GUARD: THE 3RD PARTY
// VIZ BUTTON IS SEEN BETWEEN THE + AND 💳 FUND AUTONOMY LEDGER, NOT PAST THE EDGE (operator 2026-09-30, verbatim: "hook the
// visualisation dashboard on our site up to a button between the + and fund autonomy ledger (the 3rd party backup button I
// asked for) or did you put it somewhere I cant see?").
//
// C501 put the button last in the c-attest face's SOURCE, adjacent to <details class="plus">; but PAGE_CSS paints
// details.plus{order:-1;position:sticky;left:0} FIRST, so the button rendered after the 💳 button's whole metric line —
// measured at a 420 px sidebar: + x=51 · 💳 x=84 · 3rd party viz x=1163, off the panel. C501's guard read a source index,
// a token standing in for the construct. This guard reads the construct: the page is rendered in Chromium at 420 px
// (playwright from the repo's node_modules) and the rects must say plus.right ≤ viz.left, viz.right ≤ fund.left and
// viz.right ≤ 420. Falsifier: any of those three inequalities fails on the rendered rects.
const test = require('node:test');
const assert = require('node:assert/strict');
const { writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { createRequire } = require('node:module');

const PKG_DIR = resolve(__dirname, '..');
const REPO = resolve(PKG_DIR, '..', '..');
const WIDTH = 420;

test('C501b.1 at a 420 px panel the viz button is painted between the + and the 💳 Fund Autonomy Ledger button, inside the panel', async () => {
  const UI = await import('../../../scripts/vna/steer-ui.mjs');
  const cards = UI.renderCards({ thirdPartyVizManifest: null });
  const html = `<!doctype html><meta charset="utf-8"><style>${UI.PAGE_CSS}\n</style><div class="wrap">${cards}</div>`;
  const dir = mkdtempSync(join(tmpdir(), 'c501b-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, html);
  const { chromium } = createRequire(resolve(REPO, 'package.json'))('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 2400 } });
    await page.goto('file://' + file);
    const r = await page.evaluate(() => {
      const face = document.querySelector('.card3.c-attest > .c3l.face');
      if (!face) return { face: false };
      const rect = (el) => { if (!el) return null; const c = el.getBoundingClientRect(); return { left: Math.round(c.left), right: Math.round(c.right), w: Math.round(c.width) }; };
      const plus = face.querySelector(':scope > details.plus > summary');
      const viz = [...face.querySelectorAll(':scope > button')].find((b) => b.textContent.trim() === '3rd party viz');
      const fund = [...face.querySelectorAll(':scope > button.action')].find((b) => b.textContent.includes('Fund Autonomy Ledger'));
      return { face: true, plus: rect(plus), viz: rect(viz), fund: rect(fund) };
    });
    console.log(`C501b rects @${WIDTH}px: ${JSON.stringify(r)}`);
    assert.ok(r.face, 'the c-attest face renders');
    assert.ok(r.plus && r.plus.w > 0, 'the + is painted on the c-attest face');
    assert.ok(r.viz && r.viz.w > 0, 'a "3rd party viz" button is painted on the c-attest face');
    assert.ok(r.fund && r.fund.w > 0, 'the 💳 Fund Autonomy Ledger .action is painted on the c-attest face');
    assert.ok(r.plus.right <= r.viz.left, `the + must sit left of the viz: plus.right=${r.plus.right} viz.left=${r.viz.left}`);
    assert.ok(r.viz.right <= r.fund.left, `the viz must sit left of 💳: viz.right=${r.viz.right} fund.left=${r.fund.left}`);
    assert.ok(r.viz.right <= WIDTH, `the viz must be inside the ${WIDTH} px panel: viz.right=${r.viz.right}`);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
