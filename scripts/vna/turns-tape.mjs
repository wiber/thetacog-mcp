// scripts/vna/turns-tape.mjs — the durable turn counter + day-tape writer for the VNA cockpit's
// per-turn HTML (C826e, 2026-10-15).
//
// docs/specs/vna/turns held 26,967 loose files / 74 GB because cockpit.mjs did two things every
// render: (1) wrote its stamped copy (t<turn>-<sha7>-<stamp>.html) as a NEW loose file, forever, and
// (2) derived the next turn number by `readdirSync(OUT_DIR)` over the whole pile and taking the max
// t<N>- — a cost that grows with the backlog it never cleaned up. Folding the loose files away would
// have reset that derivation back to t1, so the two problems have to be fixed together.
//
// AXIOM 1 (evict-or-retain, never free): the stamped copy is RETAINED, not deleted — it becomes one
// gzip member of the day's tape (docs/specs/vna/turns/folded/turn-<day>.tape.gz, or
// preview-<day>.tape.gz for a preview render) via the one shared tape format
// (scripts/ops/cache-fold.mjs appendMember/members), under the SAME NAME it would have had loose.
// Nothing ever reads a stamped copy back by path (confirmed: the only readers of this directory,
// scripts/vna/door-cmd.mjs and packages/thetacog-mcp-vscode/src/commands.ts, open latest.html only),
// so this file is never written loose at all — appendMember() is the only write.
//
// The turn number comes from a small counter file next to latest.html
// (docs/specs/vna/turns/turn-counter.json), seeded ONCE from the max of whatever loose t<N>- files
// and already-folded tape members exist at that moment, then persisted — so folding the backlog (or
// an operator later deleting an old day tape) can never make the count go backwards.
//
// @guard tests/vna/cockpit-turns-are-one-tape.test.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { appendMember, members } from '../ops/cache-fold.mjs';

export const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const counterPath = (outDir) => resolve(outDir, 'turn-counter.json');
export const foldedDir = (outDir) => resolve(outDir, 'folded');
/** The ONE naming rule for a day tape, shared by the live writer and the backlog fold — never
 *  reconstructed a second way in either caller. */
export const tapePathForDay = (outDir, fam, day) => resolve(foldedDir(outDir), `${fam}-${day}.tape.gz`);
export const tapePath = (outDir, { preview = false, ms = Date.now() } = {}) =>
  tapePathForDay(outDir, preview ? 'preview' : 'turn', dayOf(ms));

/** The family a loose docs/specs/vna/turns/ file belongs to — the backlog fold's own rule, exported
 *  so the one-off script and the guard test read the SAME classification. */
export function familyOf(name) {
  if (/^t\d+-/.test(name)) return 'turn';
  if (/^preview-\d/.test(name)) return 'preview';
  return null;   // latest.html / preview-latest.html / turn-counter.json / anything else: never touched
}

function maxTurnInNames(names) {
  return names.reduce((hi, n) => { const m = /^t(\d+)-/.exec(n); return m ? Math.max(hi, Number(m[1])) : hi; }, 0);
}

/** The highest turn number already folded onto any turn-*.tape.gz in outDir/folded. Reads only the
 *  member NAMES (cheap — see cache-fold.mjs members()), never the bodies. */
function maxTurnOnTapes(outDir) {
  let names; try { names = readdirSync(foldedDir(outDir)); } catch { return 0; }
  let hi = 0;
  for (const n of names) {
    if (!/^turn-\d{4}-\d{2}-\d{2}\.tape\.gz$/.test(n)) continue;
    for (const m of members(resolve(foldedDir(outDir), n))) hi = Math.max(hi, maxTurnInNames([m.name]));
  }
  return hi;
}

/** The next turn number for a render into outDir — from the durable counter, never from a readdir of
 *  OUT_DIR. Seeded exactly once, the first time the counter file is absent, from the max of whatever
 *  loose t<N>- files and already-folded tape members exist; every call after that reads and advances
 *  the counter file alone, so the number keeps rising no matter what later happens to OUT_DIR. */
export function nextTurn(outDir) {
  const cp = counterPath(outDir);
  let cur = 0;
  if (existsSync(cp)) {
    try { cur = Number(JSON.parse(readFileSync(cp, 'utf8')).turn) || 0; } catch { cur = 0; }
  } else {
    let loose = []; try { loose = readdirSync(outDir); } catch {}
    cur = Math.max(maxTurnInNames(loose), maxTurnOnTapes(outDir));
  }
  const turn = cur + 1;
  mkdirSync(dirname(cp), { recursive: true });
  writeFileSync(cp, JSON.stringify({ turn, updatedAt: new Date().toISOString() }));
  return turn;
}

/** Append the stamped copy as one gzip member on the day's tape, under its would-have-been-loose
 *  name. The loose file is never written — this call replaces that writeFileSync entirely. Returns
 *  the tape path, for the console line / receipt to name where the copy actually lives. */
export function foldStamped(outDir, name, html, { preview = false, ms = Date.now() } = {}) {
  const tape = tapePath(outDir, { preview, ms });
  appendMember(tape, name, html, ms);
  return tape;
}
