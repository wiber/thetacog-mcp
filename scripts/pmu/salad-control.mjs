// scripts/pmu/salad-control.mjs — THE WORD-SALAD CONTROL, ONE FUNCTION (C692, operator 2026-10-08).
//
// A same-vocabulary, same-length permutation of a commit's REALITY TEXT (wordSalad, scripts/pmu/
// null-controls.mjs), pushed through the UNCHANGED sense+walk path (lensWalk), and the separation
// between the real placement and the salad's own placement recorded as a Hamming distance on the
// 144-cell mask, with a pairing null (another commit's salad). ONE home so the live commit gate
// (commit-triptych.mjs) and any backfill (salad-backfill.mjs) measure it identically — never two
// definitions of the same control.
//
// REFUSES WITH A REASON — never silently falls back to UNMEASURED-as-zero or a guessed number:
// empty reality text, a walk that returns no cells (including a deferred lock), or any thrown error
// all land as saladStatus: 'REFUSED: <reason>'. Only a real xorCount lands as 'MEASURED'.
import { wordSalad, mulberry32 } from './null-controls.mjs';

const xorCount = (x, y) => {
  if (!x || !y) return null;
  const A = new Set(x), B = new Set(y);
  let d = 0;
  for (const c of A) if (!B.has(c)) d++;
  for (const c of B) if (!A.has(c)) d++;
  return d;
};

/**
 * @param {object} args
 * @param {string} args.shaShort - the commit's short sha; seeds the deterministic permutation, so
 *   the same commit always salads the same way (re-runnable, never a fresh random draw per call).
 * @param {string} args.realityText - the commit's delivered reality corpus (same text the commit
 *   gate walks as `commit-reality`).
 * @param {string[]} args.realityCells - the ALREADY-WALKED reality placement's lit cells (`wr.cells`),
 *   so this never re-walks the real text — only the salad.
 * @param {(text:string, opts:object) => {row: object}} args.lensWalk - the one door (walk-door.mjs),
 *   injected so this stays testable without spawning the Rust binary.
 * @param {(opts:object) => Array<object>} args.readWalkTape - injected reader for the pairing null.
 * @param {string} args.tape - the walk tape path.
 * @param {string} [args.repoRoot]
 * @returns {{ saladStatus: string, saladHamming: number|null, saladHammingNull: number|null }}
 */
export function measureSaladControl({ shaShort, realityText, realityCells, lensWalk, readWalkTape, tape, repoRoot }) {
  try {
    if (!realityText || !realityText.trim()) throw new Error('empty reality text — nothing to salad');
    if (!realityCells) throw new Error('no reality placement to compare against');
    const seed = (parseInt(String(shaShort).slice(0, 8), 16) >>> 0) || 1;
    const saladText = wordSalad(realityText, mulberry32(seed));
    const ws = lensWalk(saladText, { source: 'commit-salad', ref: shaShort, repoRoot }).row;
    if (!ws || !ws.cells) throw new Error(ws && ws.err ? `salad walk: ${ws.err}` : 'salad walk returned no cells');
    const saladHamming = xorCount(realityCells, ws.cells);
    if (!Number.isFinite(saladHamming)) throw new Error('no ΔH between reality and its own salad');
    let saladHammingNull = null;
    try {
      const prevSalad = readWalkTape(tape, 400).filter((r) => r.source === 'commit-salad' && r.ref !== shaShort && r.cells).slice(-1)[0];
      if (prevSalad) saladHammingNull = xorCount(realityCells, prevSalad.cells);
    } catch { /* null is best-effort, never gates the measurement */ }
    return { saladStatus: 'MEASURED', saladHamming, saladHammingNull };
  } catch (e) {
    return { saladStatus: `REFUSED: ${String(e.message || e).slice(0, 80)}`, saladHamming: null, saladHammingNull: null };
  }
}
