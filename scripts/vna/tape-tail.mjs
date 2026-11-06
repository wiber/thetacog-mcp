#!/usr/bin/env node
// scripts/vna/tape-tail.mjs — THE LAST N TAPE ENTRIES, WITH THEIR TEXT (semantic mass).
//
// Operator: "the tesseract tape last 2-5 entries need to be copied (or more) for semantic mass (and
// be available to the steer)."
//
// WHY MASS AND NOT JUST COORDINATES. META-BULK: gzip-NCD only measures MEANING when both sides are
// the same size-order. A payload carrying one commit's placement is a thin rule with no mass — the
// model on the right, and any compression-based comparison, is left matching length noise. Bundling
// the last few entries WITH THE TEXT THAT PRODUCED THEM restores the mass on this side of the
// aperture, which is the whole point of the symmetric-bulk rule applied to the clipboard.
//
// AN ENTRY IS A PLACED COMMIT: its subject (the intent), where it landed, its σ, and its files. The
// placement comes from `envelope.mjs`'s receipt — the running code that already places the window —
// and the text comes from git. Nothing is placed here; a second placer would fork the receipt.
//
// A commit in the window that the envelope did not place is listed as UNPLACED rather than dropped:
// a tape with a silent hole in it is the absence-vs-zero failure at sequence scale.
//
// @guard tests/vna/tape-tail.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
const ENV = resolve(REPO, 'data/vna/envelope.json');
const g = (c) => execSync(c, { cwd: REPO, maxBuffer: 1 << 26 }).toString();

export function tapeTail(n = 5, { chars = 900 } = {}) {
  const placed = new Map();
  if (existsSync(ENV)) {
    try {
      const e = JSON.parse(readFileSync(ENV, 'utf8'));
      for (const w of e.work || []) placed.set(w.sha, w);
    } catch { /* an unreadable receipt is an absent one, and the rows below say UNPLACED */ }
  }
  // ABBREVIATION LENGTH IS A JOIN KEY, AND GIT'S DEFAULT IS NOT STABLE. The envelope's receipt keys
  // on 9 characters; `%h` gave 10 here (it grows with the repo), so every row joined to nothing and
  // the whole tape read UNPLACED — a length mismatch wearing the costume of a real finding.
  const shas = g(`git log -${n} --abbrev=9 --pretty=%h`).split('\n').filter(Boolean).map((x) => x.slice(0, 9));
  return shas.map((sha) => {
    const subject = g(`git log -1 --pretty=%s ${sha}`).trim();
    const body = g(`git log -1 --pretty=%B ${sha}`).trim().slice(0, chars);
    const files = g(`git show --name-only --pretty=format: ${sha}`).split('\n').filter(Boolean);
    const w = placed.get(sha) || null;
    return {
      sha, subject, body, files: files.length,
      coord: w?.coord ?? null, name: w?.name ?? null, sigma: w?.sigma ?? null,
      placed: !!w,
    };
  });
}

export function tapeText(entries) {
  const lines = ['# TESSERACT TAPE — the last ' + entries.length + ' entries, with their text (semantic mass)'];
  for (const e of entries) {
    lines.push('');
    lines.push(`## ${e.sha} · ${e.placed ? `${e.name || e.coord} · σ ${e.sigma}` : 'UNPLACED — outside the envelope\'s window, listed rather than dropped'} · ${e.files} files`);
    lines.push(e.body);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--n');
  const n = i >= 0 ? Math.max(1, Math.min(50, Number(process.argv[i + 1]) || 5)) : 5;
  const entries = tapeTail(n);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(entries, null, 2)); }
  else { console.log(tapeText(entries)); }
}
