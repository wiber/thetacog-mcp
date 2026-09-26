// scripts/vna/derived-source.mjs — C174 (first leg): A TREE'S OWN RENDER IS NEVER A STEER SOURCE.
//
// Measured 2026-09-22 20:33–20:47 (local): the IDE pointer followed the active editor onto data/vna/spec-tree.txt — the
// outline spec-tree.mjs writeTree() emits beside the tree — and the loop fed itself: every fold rewrote the .txt, the
// tail watcher read the rewrite as a ~209 KB "rewritten" tape row, the hook dispatched another fold on it, and the
// fold swapped the live tree for the render's own tree (the steer.txt tree retained aside). 27 of the last 60 tape
// rows were the tree reading itself; the hook printed "not folded yet" every turn because the fold made its own lag.
//
// THE CONSTRUCT, not a filename: writeTree() writes <tree>.txt beside <tree>.json, and <tree>.json declares itself a
// spec tree in its first bytes ({ "v": 1, "source": …, … "watermark": … }). A .txt with such a sibling is that tree's
// outline, whatever it is called and wherever it lives (a fixture tree's outline is refused the same way). Only the
// head of the sibling is read — the live tree is ~57 MB and this runs on every pointer set and every hook turn.
//
// NOT SUFFICIENT FOR: the other derived sources C174 names (any file some script writes, found by the writeFileSync
// test) and the >500-asks shatter receipt — those legs stay open on C174.
import { openSync, readSync, closeSync, existsSync } from 'node:fs';

const HEAD_BYTES = 4096;
function head(path) {
  let fd = null;
  try { fd = openSync(path, 'r'); const b = Buffer.alloc(HEAD_BYTES); const n = readSync(fd, b, 0, HEAD_BYTES, 0); return b.subarray(0, n).toString('utf8'); }
  catch { return null; } finally { if (fd != null) try { closeSync(fd); } catch {} }
}

/** why `abs` is a spec tree's own outline, or null when it is not (the caller refuses on non-null) */
export function derivedWhy(abs) {
  if (typeof abs !== 'string' || !/\.txt$/i.test(abs)) return null;
  const sib = abs.replace(/\.txt$/i, '.json');
  if (!existsSync(sib)) return null;
  const h = head(sib);
  if (!h) return null;
  const isTree = /"v"\s*:\s*1\b/.test(h) && /"source"\s*:/.test(h) && /"watermark"\s*:/.test(h);
  return isTree ? `it is the outline spec-tree.mjs writes beside the tree at ${sib} — a render is never intent (C174)` : null;
}
