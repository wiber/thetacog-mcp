#!/usr/bin/env node
// scripts/vna/snowball-refresh.mjs — C193's detached refresh: rebuilds the snowball sidecar OFF the prompt-steer
// hot path. Spawned by hook-doors.mjs's dispatchSnowballRefresh (back-off-gapped, never inline). Reads the prompt
// from a small file (never argv — unbounded length, a newline would break argv anyway, and a prompt never belongs
// in `ps`), parses the tree ONCE, walks it, decides the leaf exactly the way steer-hook.mjs's snowball() does
// (activeLeaf → anchorSeed), and writes a compact, servable set of lines for the NEXT turn's hot path to print
// as-is (readSnowballSidecar). This runs off the door entirely — it may take the 1-3s the hot path used to pay
// every turn; that cost now lands once per refresh (debounced), not once per prompt.
//
// KNOWN GAP, named rather than silently worked around: the resident (C184a, resident-client.mjs) only answers
// "tree-nodes for a row sha" today, not "the full bundle for a leaf id" — so this script still parses
// data/vna/spec-tree.json itself instead of asking the resident for it. Extending the resident's op set to serve a
// leaf's bundle directly is the next leg (named in the C193 spec row).
//
// A standalone CLI target, spawned exactly like spec-tree.mjs is by dispatchFold. C582: run() fires only when this file is the
// process entry, so the guard can import retroStage() without starting a refresh; nothing on the live path imports it.
//
// C582 THE RETRO SNOWBALL IS ON THIS PATH: before bundle(), retroStage() grows the read one row at a time from the gzip-nearest row
// (retro-snowball.mjs retroGrow — the loop retrieval-bench.mjs measures, one home) and the grown row set is what the bundle carries
// beside the leaf (carryRetro, inside the same 1,500-token cap). Switched on by retroLiveFlag() — the bench's held-out record —
// never by taste; off, the refresh is exactly what it was. The probe walks go to a scratch tape, never the live walk tape.
// @guard tests/ops/c193-the-prompt-hook-reads-the-leaf-first.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';
import { fullName } from './mesh.mjs';
import { seedSpecFirst, activeLeaf, anchorSeed, bundle, SPEC_TARGETS } from './spec-tree.mjs';
import { writeSnowballSidecar } from './hook-doors.mjs';
import { applyHairsPick } from './read-set.mjs';   // C176f: same override steer-hook.mjs's snowball() applies, off the hot path here too
import { walkOfSeed } from './read-set.mjs';   // C582a: the same walk the hook hands — no override without a named licence
import { appendTurn } from './flight-tape.mjs';   // C483: this walk IS the turn's placement — it is taped here, never dropped
import { roomFromTerminal } from '../../src/lib/pmu/room-key.mjs';
import { retroGrow, retroLiveFlag, carryRetro, rowsOf } from './retro-snowball.mjs';   // C582: the live retro snowball
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TREE_PATH = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
const SIDECAR = process.env.VNA_SNOWBALL_SIDECAR || resolve(REPO, '.thetacog/vna-snowball-sidecar.json');
const PROMPT_FILE = process.env.VNA_SNOWBALL_PROMPT_FILE || null;

// C483 THE TURN'S COORDINATE LANDS ON THE FLIGHT TAPE FROM HERE. Since C193 (3db7c1a2b6) a sidecar-served turn's walk runs in
// this process, and since C318 (0a4a81e63c) every turn over a mass tree does — and this script dropped the pixel (the sidecar
// keeps anchor/leaf/stage only), so from 2026-09-24T17:05Z no turn row carried one. When the hook dispatched this refresh it
// leaves the turn row to it (steer-hook.mjs: walkDetached); every path below writes exactly one row, with the walk's own pixel
// or an UNMEASURED reason. The hook hands the row over with VNA_REFRESH_TAPES_TURN=1 (the sidecar-hit and mass-miss branches);
// the full-price branch tapes its own and dispatches this only to feed the sidecar. VNA_NO_FLIGHT_TAPE tapes nothing, as in the hook.
const SESSION = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
function tapeTurn(seed) {
  if (process.env.VNA_NO_FLIGHT_TAPE || process.env.VNA_REFRESH_TAPES_TURN !== '1') return null;   // only when the hook handed this turn's row over
  try { return appendTurn({ seed, session: SESSION, room: roomFromTerminal() || null }); } catch { return null; }
}
const walkWhy = (w) => (!w || !w.row ? 'the walk door threw before it wrote a row' : w.row.pixel ? null : w.row.err || `the walk (sensor ${w.row.sensor || 'unmeasured'}) wrote no pixel`);

// C582: the retro stage. flag = retroLiveFlag() (the measured switch); walk = the probe walker (lensWalk on a scratch tape). Returns
// null when the flag is off, so the caller bundles exactly as before.
export const RETRO_SCRATCH = process.env.VNA_RETRO_SCRATCH || join(tmpdir(), 'thetacog-retro-snowball');
export function probeWalker(scratch = RETRO_SCRATCH) {
  return (text, { maxChars = null } = {}) => {
    try { const { row } = lensWalk(String(text), { source: 'probe', ref: 'retro-snowball', tape: join(scratch, 'probe-tape.ndjson'), receiptsDir: join(scratch, 'receipts'), timeoutMs: 6000, maxChars }); return { pixel: row.pixel || null, cells: row.cells || [], err: row.err || null }; }
    catch (e) { return { pixel: null, cells: [], err: String((e && e.message) || e).slice(0, 80) }; }
  };
}
export async function retroStage({ tree, prompt, flag = retroLiveFlag(), walk = probeWalker(), askCells = null, retroGrowFn = retroGrow }) {
  if (!flag || !flag.on) return null;
  const rows = rowsOf(tree);
  const grown = await retroGrowFn(tree, prompt, { walk, askCells, tau: flag.tau ?? undefined, rows });
  return { grown, rows, flag };
}

export async function run() {
  const t0 = performance.now();
  let prompt = ''; try { prompt = PROMPT_FILE ? readFileSync(PROMPT_FILE, 'utf8') : ''; } catch {}
  let tree = null; try { tree = JSON.parse(readFileSync(TREE_PATH, 'utf8')); } catch { tapeTurn({ stage: null, pixel: null, unmeasured: 'no spec tree to walk the prompt against (the refresh read none)' }); return; }   // no tree yet — nothing to refresh; the hot path stays on its existing sidecar, or the live fallback
  const hasBasins = Object.values(tree.nodes).some((n) => n.basin);
  if (!hasBasins) { tapeTurn({ stage: null, pixel: null, unmeasured: 'the spec tree holds no basin to walk the prompt against' }); return; }
  const viaTargets = existsSync(SPEC_TARGETS);
  let w = null;
  try { w = lensWalk(String(prompt), { source: 'steer', ref: 'prompt-refresh', digest: prompt.length > 800 ? 'strided' : 'head', timeoutMs: 800, room: process.env.THETACOG_ROOM || null, ...(viaTargets ? { axesPath: SPEC_TARGETS } : {}) }); } catch {}
  const px = (w && w.row && w.row.pixel) || null;
  const seed = seedSpecFirst(tree, prompt, viaTargets && w && w.row ? w.row : px, { viaTargets });
  const nm = (x) => (x && typeof x === 'object' ? x.label || x.id || null : x ?? null);
  tapeTurn({ abstained: !!seed.abstained, stage: seed.stage || null, leaf: nm(seed.leaf), best: nm(seed.best), d: seed.leaf ? seed.leaf.d ?? null : seed.best ? seed.best.d ?? null : null,
    pixel: px, unmeasured: px ? null : walkWhy(w) });
  const active = activeLeaf(tree);
  const A = anchorSeed(seed, active);
  if (!A.leaf) return;   // nothing this leaf anchors on — the hot path falls through to its own live read
  // C176f: not anchored by a /goal leaf (or a commit) — the record's row above is UNCHANGED; here the prompt itself
  // picked the leaf (anchor 'prompt' or 'prompt-released'), so the kept ranker's read replaces the NCD-nearest one
  // when it actually carries anchor coverage (a hairless ask never overrides).
  let leaf = A.leaf, hairsLine = null;
  if (A.anchor !== 'goal' && A.anchor !== 'commit') {
    const HP = applyHairsPick(A.leaf, tree, prompt, { walk: walkOfSeed(seed, w && w.row) });   // C582a
    leaf = HP.leaf;
    hairsLine = `SNOWBALL (hairs · C176f, sidecar refresh): config ${HP.HP ? HP.HP.hash : '—'}${HP.overridden ? ` — OVERRIDING the walk's pick ${A.leaf.label || A.leaf.id} with ${leaf.label || leaf.id} under licence ${HP.licence} (${HP.why})` : ` — the walk's pick ${A.leaf.label || A.leaf.id} stands: ${HP.why}`}`;
  }
  // the ask is re-walked by the probe walker, the same door the bench's ask walk uses (the hook walk above may run on the spec targets' axes)
  let R = null; try { R = await retroStage({ tree, prompt }); } catch {}
  const env = await bundle(tree, leaf.id, { capTokens: 1500 });
  if (R) carryRetro(env, R.grown, R.rows, { exclude: leaf.cue || null });
  const RS = env.retro_snowball;
  const AL = env.active_leaf;
  const lines = [
    '⟦ SNOWBALL — seeded from the spec ⟧',
    `SNOWBALL (from the record · C57, sidecar refresh): basin ${leaf.label}${leaf.done ? ' [x]' : ' [ ]'} · ${A.anchor === 'goal' ? 'the /goal names it' : A.anchor === 'commit' ? `named by the last commit${leaf.sha ? ` ${leaf.sha}` : ''}` : 'the prompt re-aimed here'} · ${leaf.snippets ?? 0} chunk${(leaf.snippets ?? 0) === 1 ? '' : 's'} slotted`,
    `leaf ${AL.id} · ${AL.type}${AL.cue ? `:${AL.cue}` : ''} · anchor ${A.anchor} (C57)`,
    ...(hairsLine ? [hairsLine] : []),
    ...(RS ? [`SNOWBALL (retro · C582): grew ${RS.steps} row${RS.steps === 1 ? '' : 's'} from the gzip-nearest, stop ${RS.stop}${RS.overlap != null ? ` at overlap ${RS.overlap}` : ''} — carried: ${RS.rows.map((r) => r.cue).join(' · ') || 'none'}${RS.cut ? ` (${RS.cut} cut for the cap)` : ''}`] : []),
    `hat ${env.hat}${env.coordinate ? ` · ${env.coordinate.pixel} ${fullName(env.coordinate.pixel)}` : ''}`,
    `contract: ${env.contract.text}`,
    env.raw_semantic_mass && env.raw_semantic_mass.length ? `attached snippets: ${env.raw_semantic_mass.length} (full text on the live read, next turn this leaf changes)` : 'attached snippets: none',
  ];
  writeSnowballSidecar({
    at: new Date().toISOString(), leafLabel: leaf.label, leafId: leaf.id, anchor: A.anchor, reaimed: !!A.reaimed,
    lines, seed: { anchor: A.anchor, active: active ? active.label : null, reaimed: !!A.reaimed, leaf: leaf.label, stage: seed.stage || null },
    ms: +(performance.now() - t0).toFixed(1),
  }, SIDECAR);
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run();
