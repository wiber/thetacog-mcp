// scripts/pmu/converge-hero.mjs — the ONE transform that makes a commit page's COMPETENCE-SHAPE hero
// a LIT panel, never the empty direction-only grid.
//
// THE INCIDENT (2026-07-06): the apology outreach commit shipped a page whose SHARE image (og.png) was
// the lit apology panel, but whose in-page hero ("COMPETENCE SHAPE — regions encircled") was the empty
// direction-only grid. Two independent code paths described the same commit: publish-commit-page picks a
// lit `tol` panel for og; the body's competence-shape computed 0 drift regions (thin/data commit) and
// fell to a bare grid. A recipient clicked a lit email panel and landed on a blank hero.
//
// THE FIX is NOT "hero must equal og" — on 227/228 substantive pages the hero (competence shape) and og
// (social card) are DIFFERENT lit panels by design; forcing equality would corrupt them. The correct,
// narrow invariant: a page must never carry the BLANK-HERO caption below while a lit panel exists. This
// transform ONLY acts on pages that carry that exact caption (thin/data commits) — substantive pages,
// even ones whose commit MESSAGE happens to mention "direction-only", are left untouched.
//
// Used by BOTH the generator (publish-commit-page.mjs — new pages born converged) and the backfill
// (backfill-commit-heroes.mjs — the 285 already on disk). One transform, one artifact.

// The exact, generator-emitted empty-hero caption. Precise on purpose (won't match commit-message prose).
export const BLANK_HERO_MARKER = 'no drift regions to encircle (thin / data commit)';

const CAP_FULL_OLD =
  '&#9678; DIRECTION-ONLY &mdash; this commit declared intent; no drift regions to encircle (thin / data commit). The shape above shows the direction pixel on the lattice.';
const CAP_CORE_OLD =
  'no drift regions to encircle (thin / data commit). The shape above shows the direction pixel on the lattice.';
const CAP_NEW =
  '&#9678; the commit&rsquo;s own content, placed on the 144-anchor lattice &mdash; the same recomputable panel emailed on this commit.';
const CAP_CORE_NEW =
  'the commit&rsquo;s own content, placed on the 144-anchor lattice &mdash; recomputable.';

/** Is this page carrying the blank direction-only hero? (the precise generator caption, not loose prose) */
export function hasBlankHeroMarker(html) {
  return String(html).includes(BLANK_HERO_MARKER);
}

/** The base64 of the current COMPETENCE-SHAPE hero <img> (first data-uri image after the marker), or null. */
export function heroBase64(html) {
  const i = String(html).indexOf('COMPETENCE SHAPE');
  if (i < 0) return null;
  const m = String(html).slice(i).match(/<img\b[^>]*\bsrc="data:image\/png;base64,([^"]*)"/);
  return m ? m[1] : null;
}

/**
 * Replace the blank direction-only hero with a lit panel.
 * @param {string} html          the commit page HTML
 * @param {string} litBase64     base64 of a LIT panel PNG (the og / tolerance / freshly-rendered lens)
 * @returns {{html:string, changed:boolean, notes:string[]}}
 */
export function convergeHero(html, litBase64) {
  let out = String(html);
  const notes = [];
  // Substantive pages (no blank-hero caption) are NEVER touched — their hero is a real competence shape.
  if (!out.includes(BLANK_HERO_MARKER)) return { html: out, changed: false, notes: ['no-blank-marker'] };
  if (!litBase64) return { html: out, changed: false, notes: ['no-lit-panel-supplied'] };

  let changed = false;

  // (1) Swap the hero image (first data-uri <img> after the COMPETENCE SHAPE caption) to the lit panel.
  const mk = out.indexOf('COMPETENCE SHAPE');
  const region = out.slice(mk);
  const m = region.match(/<img\b[^>]*\bsrc="data:image\/png;base64,([^"]*)"/);
  if (m && m[1] !== litBase64) {
    const b64Start = mk + m.index + m[0].indexOf('base64,') + 'base64,'.length;
    const b64End = b64Start + m[1].length;
    out = out.slice(0, b64Start) + litBase64 + out.slice(b64End);
    changed = true;
    notes.push('hero-img-swapped');
  } else if (!m) {
    notes.push('WARN-no-hero-img');
  }

  // (2) Neutralize the blank-hero caption so the page reads honestly AND the marker is gone.
  if (out.includes(CAP_FULL_OLD)) {
    out = out.split(CAP_FULL_OLD).join(CAP_NEW);
    changed = true;
    notes.push('caption-full-replaced');
  } else if (out.includes(CAP_CORE_OLD)) {
    out = out.split(CAP_CORE_OLD).join(CAP_CORE_NEW);
    changed = true;
    notes.push('caption-core-replaced');
  }

  if (out.includes(BLANK_HERO_MARKER)) notes.push('LEFTOVER-MARKER'); // backfill flags these for a look
  return { html: out, changed, notes };
}
