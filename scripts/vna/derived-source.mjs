// scripts/vna/derived-source.mjs — C174: A TREE'S OWN RENDER IS NEVER A STEER SOURCE.
//
// Measured 2026-09-22 20:33–20:47 (local): the IDE pointer followed the active editor onto data/vna/spec-tree.txt — the
// outline spec-tree.mjs writeTree() emits beside the tree — and the loop fed itself: every fold rewrote the .txt, the
// tail watcher read the rewrite as a ~209 KB "rewritten" tape row, the hook dispatched another fold on it, and the
// fold swapped the live tree for the render's own tree (the steer.txt tree retained aside). 27 of the last 60 tape
// rows were the tree reading itself; the hook printed "not folded yet" every turn because the fold made its own lag.
//
// LEG 1 — THE CONSTRUCT, not a filename: writeTree() writes <tree>.txt beside <tree>.json, and <tree>.json declares
// itself a spec tree in its first bytes ({ "v": 1, "source": …, … "watermark": … }). A .txt with such a sibling is
// that tree's outline, whatever it is called and wherever it lives (a fixture tree's outline is refused the same
// way). Only the head of the sibling is read — the live tree is ~57 MB and this runs on every pointer set and every
// hook turn. Guard: tests/vna/c174-leg1-a-tree-outline-is-never-a-steer-source.test.mjs.
//
// LEG 2 — ANY OTHER FILE A SCRIPT WRITES, found the same way CLAUDE.md's NEVER WRITE STATE INTO A GENERATED FILE
// rule says to find one by hand: `grep -l "writeFileSync.*<file>" scripts/`. The spec-tree outline is not the only
// artifact the loop can end up pointed at — story.mjs writes data/vna/story.txt, spec-render.mjs and cockpit.mjs
// write docs/specs/vna/PAYLOAD.txt and COCKPIT-PAYLOAD.txt, and the IDE's follow-the-active-editor does not know
// any of those are renders either. Run against scripts/vna/ (where the whole VNA loop and everything it emits
// lives) rather than the full scripts/ tree, so a pointer `set` or a tail read stays a sub-200ms check instead of
// a repo-wide scan. Guard: tests/vna/c174-a-derived-file-is-never-a-steer-source.test.mjs.
//
// NOT SUFFICIENT FOR: the >500-asks shatter receipt (the amendments-ledger `class: derived-source` dismissal) —
// that leg stays open on C174.
import { openSync, readSync, closeSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS_VNA = resolve(REPO, 'scripts/vna');

const HEAD_BYTES = 4096;
function head(path) {
  let fd = null;
  try { fd = openSync(path, 'r'); const b = Buffer.alloc(HEAD_BYTES); const n = readSync(fd, b, 0, HEAD_BYTES, 0); return b.subarray(0, n).toString('utf8'); }
  catch { return null; } finally { if (fd != null) try { closeSync(fd); } catch {} }
}

function escapeForGrepE(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** LEG 2: why `abs`'s basename is one some scripts/vna/*.mjs writes with writeFileSync, or null. The literal-line
 *  grep is the same test CLAUDE.md names for a data file generally — run as code so a fresh session need not
 *  remember to do it by hand before pointing the loop at a new source. */
function scriptWrittenWhy(abs) {
  const base = basename(abs);
  if (!existsSync(SCRIPTS_VNA)) return null;
  const pattern = `writeFileSync.*${escapeForGrepE(base)}`;
  let r;
  try {
    r = spawnSync('grep', ['-rlE', '--include=*.mjs', '--include=*.js', '--include=*.cjs', '--include=*.sh', pattern, SCRIPTS_VNA], { encoding: 'utf8' });
  } catch { return null; }
  if (!r || r.status !== 0 || !r.stdout) return null;   // 1 = no match, 2 = grep error — either way, not provably derived
  const hits = r.stdout.split('\n').filter(Boolean).map((p) => (p.startsWith(REPO + '/') ? p.slice(REPO.length + 1) : p));
  if (!hits.length) return null;
  return `a script writes it — ${hits[0]}${hits.length > 1 ? ` (+${hits.length - 1} more)` : ''} calls writeFileSync on ${base} — a render is never intent (C174: grep -l "writeFileSync.*${base}" scripts/vna/)`;
}

/** why `abs` is a derived render (a spec tree's own outline, or any other file a script writes), or null when it
 *  is not (the caller refuses on non-null). */
export function derivedWhy(abs) {
  if (typeof abs !== 'string' || !/\.txt$/i.test(abs)) return null;
  // C233 (2026-09-26): the audio basin's transcript is the basin's OWN output — its lines reach the tree through the clip door as
  // batches. Tapping 🎙️ Audio Stream opened it, the IDE's follow-the-editor pointed the steer file at it (02:22Z → 18:19Z), and every
  // spoken line then reached the ledger TWICE (the tail read of the raw append + the slotted batch), while pastes fed it, not steer.txt.
  if (/[\\/]\.thetacog[\\/]audio[\\/]/.test(abs)) return 'it is the audio basin\'s own transcript (C233) — its lines reach the tree through the clip door as batches; following it would fold every line twice';
  const sib = abs.replace(/\.txt$/i, '.json');
  if (existsSync(sib)) {
    const h = head(sib);
    if (h) {
      const isTree = /"v"\s*:\s*1\b/.test(h) && /"source"\s*:/.test(h) && /"watermark"\s*:/.test(h);
      if (isTree) return `it is the outline spec-tree.mjs writes beside the tree at ${sib} — a render is never intent (C174)`;
    }
  }
  return scriptWrittenWhy(abs);
}
