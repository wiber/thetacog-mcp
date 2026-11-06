// src/lib/backup/gtm-loop.mjs — C962 THE LOOP IN ONE ORDER ON THE LISTING AND /BACKUP/WARRANTY (chair decomposition
// 2026-10-18 of the operator's words "/steer spec all these and set the ratchets to optimise the gtm", not on the
// tape: "THE LOOP IN ONE ORDER ON THE LISTING AND /BACKUP/WARRANTY: install and measure free (MIT) -> buy the
// agent-year licences your standing answers size -> join the trial (founder hours as you use credits, the multiple
// you set, the price it carries) -> your pixel grows as your landed work places -> you get dispatched at your cell
// and paid from the neighbour's prepaid hours; no counsel status and no proposed number shown as offered
// (need-to-know), the trial numbers marked proposed until terms v2.2 publish").
//
// ONE array, read by both surfaces (packages/thetacog-mcp-vscode/README.md's listing and /backup/warranty/page.tsx)
// — never a second hand-typed copy, per CLAUDE.md's "a rule stated once lives in ONE place". No step carries a
// dollar figure, a multiple, a licence count or a counsel/status word: the numbers stay in warranty-trial.mjs's
// TRIAL_PROPOSAL, marked PROPOSED there; this loop only names the shape of each step.
// @guard tests/vna/c962-the-loop-in-one-order-on.test.mjs
export const GTM_LOOP = Object.freeze([
  '1 · Install and measure — free and open-source (MIT).',
  '2 · Buy the agent-year licences your standing answers size.',
  '3 · Join the trial — founder hours as you use credits, the multiple you set, the price it carries (terms PROPOSED).',
  '4 · Your pixel grows as your landed work places.',
  '5 · You get dispatched at your cell, paid from the neighbour\'s prepaid hours.',
]);

export const GTM_LOOP_MARKERS = [
  '<!-- gtm-loop:begin — rendered from GTM_LOOP in src/lib/backup/gtm-loop.mjs; do not edit by hand -->',
  '<!-- gtm-loop:end -->',
];

export const gtmLoopText = () => GTM_LOOP.join('\n');

export function gtmLoopBlock(md) {
  const i = md.indexOf(GTM_LOOP_MARKERS[0]);
  const j = md.indexOf(GTM_LOOP_MARKERS[1]);
  if (i < 0 || j < i) return null;
  return md.slice(i + GTM_LOOP_MARKERS[0].length, j).trim();
}

export function writeGtmLoopBlock(md) {
  const i = md.indexOf(GTM_LOOP_MARKERS[0]);
  const j = md.indexOf(GTM_LOOP_MARKERS[1]);
  if (i < 0 || j < i) return md;
  return md.slice(0, i + GTM_LOOP_MARKERS[0].length) + '\n' + gtmLoopText() + '\n' + md.slice(j);
}

// A step "shows a number as an offer" when a digit sits outside its leading ordinal ("N · "). PROPOSED rides
// free of digits by construction, so this stays mechanical rather than a human re-read of each release.
export function offeredNumberIn(step) {
  return /\d/.test(String(step).replace(/^\d+\s*·\s*/, ''));
}

export const COUNSEL_STATUS_WORD = /\bcounsel\b/i;
