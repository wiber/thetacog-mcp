// scripts/vna/panel-carry.mjs — C647b THE PANEL TRAVELS WITH THE BACKUP (operator 2026-10-04, verbatim: "and this needs to be
// addressed … maybe a configure so you can publish on github the png encircled panel? there must be better solutions to this..",
// on a tape-slider frame reading "no panel published at https://thetadriven.com/").
//
// MEASURED BEFORE THIS CHANGE (the last backup this repo sent, 2026-10-04T23:27Z, head 41c749252b): the manifest's panel home
// was https://thetadriven.com/ (.thetacog/panel-home.json) and `present` listed 972 commits — only the tape commits whose
// panel sits at public/commit/<sha10>/trip-encircled-<sha10>.png. Of the tape's 3002 commit rows, 654 had their encircled
// panel ONLY in docs/pmu/commit-panels/ (the tracked native 144×144 archive — e.g. 2503b98252, the newest frames of the day),
// a tree panel-home.mjs never reads and a site never serves; 530 had no panel in any tree (rendered late or never). Every one
// of those read "no panel published at https://thetadriven.com/" with no count and no way to publish it.
//
// THE FIX: the backup carries the PNGs themselves. carryPanels() reads EVERY tracked panel tree at HEAD (the hook's
// public/commit/ tree and the docs/pmu/commit-panels/ archive), picks per tape commit the smallest panel file that is a PNG,
// and carries the newest commits' panels first into the archive as `panels/<sha10>.png`, under a byte budget and a count cap
// (PANEL_CARRY_BYTES / PANEL_CARRY_MAX — the archive must stay under the 4.5 MB upload body, backup.mjs UPLOAD_BODY_LIMIT).
// The server puts them in the backup store beside the archive (receive.mjs panelBlobKey) and serves them from there — no
// third-party config, never our domain. The configured base (panel-home.mjs: a GitHub raw URL, or .thetacog/panel-home.json)
// stays the optional second source for commits over the cap. The bytes are read from the git tree at HEAD (`git cat-file`),
// never the working tree — the panel the commit published, not a file a later render overwrote (AXIOM 1 W3).
//
// THE PANEL is the one Rust pipeline's published PNG (tests/ops/no-lattice-proxy.test.mjs) — carried byte for byte, never
// redrawn, never a neighbour commit's panel. SUFFICIENT FOR: which of the tape's commits have their published panel in this
// backup. NOT SUFFICIENT FOR: whether any of that work was good (Rice — undecidable), or a panel the repo never committed.
// Port row: none — transport (git → tar), no placement decided here.
// @guard tests/vna/c647b-the-panel-travels-with-the-backup.test.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { panelsManifest, REPO } from './panel-home.mjs';

/** the archive entry each carried panel rides as — receive.mjs reads exactly this shape */
export const PANEL_ENTRY = (sha10) => `panels/${sha10}.png`;
/** byte budget for carried panels in one archive: the --tapes archive measured 3.26 MB on 2026-10-04, the body limit is 4.5 MB */
export const PANEL_CARRY_BYTES = 768_000;
/** count cap: the newest this many tape commits that have a panel */
export const PANEL_CARRY_MAX = 200;
/** a single panel over this is not carried (the native 144×144 is ~5 KB, the hook's 576×576 upscale ~22 KB) */
export const PANEL_MAX_BYTES = 64 * 1024;
/** every tracked tree a panel for a commit is published in — the name captured is the commit's short sha */
export const PANEL_TREES = Object.freeze([
  { dir: 'public/commit/', re: /^public\/commit\/([0-9a-f]{7,40})\/trip-encircled-\1\.png$/ },
  { dir: 'docs/pmu/commit-panels/', re: /^docs\/pmu\/commit-panels\/([0-9a-f]{7,40})(?:-encircled)?\.png$/ },
]);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b) => !!b && b.length >= 8 && PNG_MAGIC.every((x, i) => b[i] === x);

const git = (repo, args, input) => { try { return execFileSync('git', args, { cwd: repo, input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024 }); } catch { return null; } };

/** name (short sha as it sits in the tree) → [{ path, bytes }] across every panel tree at HEAD; null when there is no HEAD */
export function panelFilesAtHead(repo = REPO) {
  const out = git(repo, ['ls-tree', '-r', '-l', 'HEAD', '--', ...PANEL_TREES.map((t) => t.dir)]);
  if (out == null) return null;
  const files = new Map();
  for (const line of out.toString('utf8').split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) continue;
    const path = line.slice(tab + 1); const size = Number(line.slice(0, tab).trim().split(/\s+/)[3]);
    for (const t of PANEL_TREES) {
      const m = t.re.exec(path); if (!m || !Number.isFinite(size)) continue;
      if (!files.has(m[1])) files.set(m[1], []);
      files.get(m[1]).push({ path, bytes: size });
    }
  }
  return files;
}

/** the blobs at HEAD for these paths, in one `git cat-file --batch` */
export function blobsAtHead(repo, paths) {
  const res = new Map(); if (!paths.length) return res;
  const buf = git(repo, ['cat-file', '--batch'], paths.map((p) => `HEAD:${p}`).join('\n') + '\n');
  if (!buf) return res;
  let o = 0;
  for (const p of paths) {
    const nl = buf.indexOf(0x0a, o); if (nl < 0) break;
    const head = buf.subarray(o, nl).toString('utf8').split(' '); o = nl + 1;
    if (head[1] !== 'blob') continue;   // "<obj> missing"
    const n = Number(head[2]); res.set(p, Buffer.from(buf.subarray(o, o + n))); o += n + 1;
  }
  return res;
}

const tapeCommits = (tape) => { try { return readFileSync(tape, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.kind === 'commit' && typeof r.sha === 'string' && /^[0-9a-f]{10,40}$/i.test(r.sha)).map((r) => r.sha.toLowerCase()); } catch { return []; } };
const nameFor = (files, full) => { for (let n = Math.min(full.length, 40); n >= 7; n--) if (files.has(full.slice(0, n))) return full.slice(0, n); return null; };

/**
 * The panels a backup of `repo` carries, and the counts the page names when a frame has none.
 * → { carried: [{ sha10, path, bytes: Buffer }], of: { commits, in_repo, carried, cap_bytes, cap_count }, why? }
 *   commits  = distinct commit shas on the tape · in_repo = how many of them have a panel file in a tracked tree at HEAD
 *   carried  = how many ride in this archive (newest first, under PANEL_CARRY_BYTES and PANEL_CARRY_MAX)
 */
export function carryPanels({ repo = REPO, tape = resolve(repo, 'data/vna/flight-tape.ndjson'), budget = PANEL_CARRY_BYTES, max = PANEL_CARRY_MAX } = {}) {
  const shas = [...new Set(tapeCommits(tape))];
  const of = { commits: shas.length, in_repo: 0, carried: 0, cap_bytes: budget, cap_count: max };
  const files = panelFilesAtHead(repo);
  if (!files) return { carried: [], of: { ...of, in_repo: null }, why: 'no HEAD tree to read the published panels from' };
  const wanted = [];   // newest commit first
  for (const full of shas.slice().reverse()) {
    const name = nameFor(files, full); if (!name) continue;
    of.in_repo++;
    const pick = files.get(name).filter((f) => f.bytes > 0 && f.bytes <= PANEL_MAX_BYTES).sort((a, b) => a.bytes - b.bytes)[0];
    if (pick) wanted.push({ sha10: full.slice(0, 10), path: pick.path, size: pick.bytes });
  }
  const chosen = []; let used = 0;
  for (const w of wanted) { if (chosen.length >= max) break; if (used + w.size > budget) continue; chosen.push(w); used += w.size; }
  const blobs = blobsAtHead(repo, chosen.map((c) => c.path));
  const carried = [];
  for (const c of chosen) { const b = blobs.get(c.path); if (isPng(b)) carried.push({ sha10: c.sha10, path: c.path, bytes: b }); }
  of.carried = carried.length;
  return { carried, of };
}

/**
 * The manifest's `panels` field with the carried panels named: panel-home.mjs's { base, pattern, source, present } (the
 * optional configured base, unchanged) + carried: [sha10…] + of: the counts. `files` is what bundle() tars — never in the json.
 */
export function panelsWithCarry({ repo = REPO, tape = resolve(repo, 'data/vna/flight-tape.ndjson'), override = process.env.VNA_PANEL_HOME, budget, max, mode, visibility } = {}) {
  // C647n: mode = thetacog.panels.home (backup · repo · off); visibility = the check repo mode runs (panel-home.mjs checkRepoVisibility)
  let home; try { home = panelsManifest({ repo, tape, override, mode, ...(visibility ? { visibility } : {}) }); } catch (e) { home = { base: null, pattern: null, source: null, present: [], why: String((e && e.message) || e) }; }
  if (home.home === 'off') return { panels: { ...home, carried: [] }, files: [] };   // C647n: off carries nothing, and says so (PANELS_OFF_WHY)
  const c = carryPanels({ repo, tape, budget, max });
  return { panels: { ...home, carried: c.carried.map((x) => x.sha10), of: c.of, ...(c.why && !home.why ? { why: c.why } : {}) }, files: c.carried };
}
