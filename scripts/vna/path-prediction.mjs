#!/usr/bin/env node
// scripts/vna/path-prediction.mjs — C612c: THE PATH-PREDICTION READ, THE CONSCIENCE'S ONE SCORE. LLM-FREE.
//
// The scorer is a crate call: `pmu-onchip --path-predict` (packages/thetacog-mcp/pmu-rust/src/path_predict.rs) decides every
// number and the verdict. This file only SHUTTLES pairs: it reads the record, builds per walk version the note's named files and
// flagged invariants, reads the commit's touched files and exercised invariants off the immutable commit (W3), and hands the
// arms to the crate. It never computes a rate, a null, a z or a verdict of its own.
//
// PRIMARY (revised 2026-10-03, efea97971e): INVARIANT-COLLISION RECALL — of the guards, byte ceilings and rules the commit
// EXERCISED, what fraction did the note flag before work, with precision beside it. SECONDARY: file p@k and recall, never swapped.
// C612h (narrowed — C612c's rulesFor sides flagged ~131 ids a note, base rate ~0.45, and read the working tree):
// Exercised = boundInvariants(touched, <sha>)  · Flagged = boundInvariants(the files the note names, <sha>^) — an invariant counts only
// when BOUND to a path: a guard whose test imports or names it · a CLAUDE.md/claude-rules section naming the exact path · a size
// ceiling declared for the file. Every binding is read with git at the immutable commit, never the working tree.
//
// Pairing and time fence: C610j's wide corpus verbatim (forecast-scored-on-past-commits.mjs planWide → the cached plan; the door
// grids REBUILT at the aperture in force by C610j's walkReading under .thetacog/cache/forecast-wide/<apertureVersion()>/, C612h), the row's own labels and every row absent from the spec at
// <sha>^ excluded from what a note may name (a note that names the row it was dispatched for quotes the declaration; a row that
// did not exist yet postdates the work). Halves by commit day (the plan's session field).
//
// Sufficient for: which walk version names where the work goes — and which invariants it will collide with — per millisecond.
// Not for: whether the work was good (Rice).
//
// C612p (2026-10-03): boundInvariants · weightedInvariants · flagTop are crate calls — `pmu-onchip --path-bind` (path_predict.rs
// mod bind, blobs through git cat-file --batch at the immutable commit). This file spawns it and shuttles JSON; the mjs bodies
// below stay as the REFERENCE (…Mjs), reached only with C612P_ENGINE=mjs, or once with a stderr UNMEASURED-rust line when the
// binary is absent. Proven equal by tests/vna/c612p-the-binding-and-the-vector-in-the-crate.test.mjs.
//
// Rust port row: C612c-port (data/vna/rust-punch-list.json) — the scorer is already in the crate; the naming step (heat → rows →
// files → invariants) decides what a note says, so it is the next to move beside lens.rs.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, posix } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { crateStdin, crateFile } from './crate-call.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_JSON = resolve(REPO, 'data/vna/path-prediction.json');
export const ARMS = Object.freeze(['ensemble', 'chained', 'ncd_grid', 'probeWalker', 'lens_d2', 'panel_d8']);
export const K_AT = 5, DRAWS = 50, BAND = 0.25, BAR = Object.freeze({ z: 2, n: 20 }), SEED = 'C612c';
export const TOP_CELLS = 12, MAX_ROWS = 4;
export const SUFFICIENT_FOR = 'which walk version names where the work goes — and which invariants it will collide with — per millisecond';
export const NOT_SUFFICIENT_FOR = 'whether the work was good (Rice)';
export const PORT_ROW = 'C612c-port — the naming step (heat → rows → files → invariants) moves beside lens.rs; the scorer already lives in pmu-onchip --path-predict';
export const PORT_ROW_BINDINGS = 'C612h-port — the three bindings (guard imports/names · rule section names · size ceiling) decide which invariants a note and a commit carry; they move beside the naming step in the crate, reading blobs at <sha> through git2';
export const SPEC_REL = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';

export function chipPath() {
  for (const p of [process.env.PMU_ONCHIP, resolve(REPO, 'packages/thetacog-mcp/pmu-rust/target/release/pmu-onchip'), resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip')]) if (p && existsSync(p)) return p;
  return null;
}

/** score(doc) — the crate call. doc: { arms: [{ name, ms, pairs: [{ label, session, named, touched, flagged, exercised }] }], k?, draws?, seed?, band?, bar? } */
export function score(doc, { chip = chipPath() } = {}) {
  if (!chip) throw new Error('pmu-onchip not built — cargo build --release --manifest-path packages/thetacog-mcp/pmu-rust/Cargo.toml');
  return crateStdin('--path-predict', { k: K_AT, draws: DRAWS, seed: SEED, band: BAND, bar: BAR, ...doc }, { chip });   // C621: the one door spawns
}

// ── the shuttle: invariants as ids in one namespace (both sides use the same function: boundInvariants) ──────────────
const git = (args, max = 1 << 27) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: max, stdio: ["ignore", "pipe", "ignore"] });
const isTest = (p) => /(^|\/)tests?\//.test(p) && /\.test\.m?[jt]s$/.test(p);
const guardOf = (text) => [...String(text).matchAll(/guard:\s*`([^`]+)`/g)].map((m) => m[1]);
const PATH_RE = /\b(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g;
const pathsIn = (text) => [...new Set(String(text).match(PATH_RE) || [])];

// ── C612h: THE BINDINGS — an invariant counts only when it is BOUND to a path, read at the immutable commit (W3) ─────────
// C612c's sides were rulesFor(paths): sibling headers filled both the note and the ground truth (~131 ids a note, base rate
// ~0.45), and rules-for reads the WORKING TREE. Three bindings replace it, every one read with `git <cmd> <at>`:
//   guard    a test file at <at> that IMPORTS the path (a relative specifier resolving to it) or NAMES the exact path;
//            a touched/named test file is its own guard
//   rule     a CLAUDE.md or docs/architecture/claude-rules/*.md section (heading → next heading) naming the exact path
//            (the pre-split archive _CLAUDE.md.full-* is archaeology, not a rule in force)
//   ceiling  a size ceiling declared for the file: a test at <at> that names the exact path AND reads a size against a
//            limit, or the file's own first 40 lines declaring a byte/KB/MB limit
// Exact path = an occurrence not preceded by [A-Za-z0-9_./-] and not followed by [A-Za-z0-9_/-] or ".<word>".
export const BINDINGS = Object.freeze(['guard', 'rule', 'ceiling']);
const RULE_DIR = 'docs/architecture/claude-rules/';
const SIZE_READ = 'statSync\\([^)]*\\)\\.size|byteLength';
const SIZE_LIMIT = '(size|bytes|Bytes|byteLength\\([^)]*\\))[[:space:]]*<=?[[:space:]]*[A-Z0-9_]|[Cc]eiling|CEILING|MAX_BYTES';
const SELF_CEILING = /(?:\bunder\b|\bat most\b|\bno more than\b|\bceiling\b|≤)[^\n]{0,40}?\d[\d,_.]*\s?(?:KB|kB|MB|KiB|MiB|bytes)\b/;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function namesExactPath(text, p) { return new RegExp(`(?<![A-Za-z0-9_./-])${escRe(p)}(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9])`).test(String(text)); }
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)['"]([^'"]+)['"]/g;
export function importsPath(line, testFile, p) {
  for (const m of String(line).matchAll(SPEC_RE)) { const s = m[1]; if (s.startsWith('.') && posix.normalize(posix.join(posix.dirname(testFile), s)) === p) return true; }
  return false;
}
const gitAt = (repo, args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const headingOf = (l) => { const h = /^#{1,6}\s+(.*?)\s*$/.exec(l); return h ? h[1] : null; };
const AT = new Map();   // (repo, at) → { sections, sizeTests } — immutable per commit, so cached
function atCommit(repo, at) {
  const key = `${repo}\0${at}`; if (AT.has(key)) return AT.get(key);
  const files = ['CLAUDE.md', ...gitAt(repo, ['ls-tree', '-r', '--name-only', at, '--', RULE_DIR]).split('\n').filter((f) => f.endsWith('.md') && !posix.basename(f).startsWith('_CLAUDE.md.full'))];
  const sections = [];
  for (const f of files) {
    const text = gitAt(repo, ['show', `${at}:${f}`]); if (!text) continue;
    let head = null, body = [];
    const flush = () => { if (head !== null) sections.push({ file: f, heading: head, text: body.join('\n') }); };
    for (const l of text.split('\n')) { const h = headingOf(l); if (h != null) { flush(); head = h; body = []; } else body.push(l); }
    flush();
  }
  const list = (pat) => new Set(gitAt(repo, ['grep', '-l', '-E', pat, at, '--', 'tests/']).split('\n').filter(Boolean).map((l) => l.slice(at.length + 1)));
  const a = list(SIZE_READ), b = list(SIZE_LIMIT);
  const v = { sections, sizeTests: new Set([...a].filter((x) => b.has(x))) };
  if (AT.size > 64) AT.clear(); AT.set(key, v); return v;
}
/** boundInvariantsMjs(paths, at, { repo }) — THE REFERENCE (C612P_ENGINE=mjs): [{ id, binding, path }] sorted by id, one per id
 *  (first path wins), every binding read at <at> (a sha, or `<sha>^`). Never the working tree. */
export function boundInvariantsMjs(paths, at, { repo = REPO } = {}) {
  const P = [...new Set((paths || []).filter(Boolean))]; if (!P.length) return [];
  const out = new Map(); const add = (id, binding, path) => { if (!out.has(id)) out.set(id, { id, binding, path }); };
  const { sections, sizeTests } = atCommit(repo, at);
  for (const p of P) if (isTest(p)) add(`guard:${p}`, 'guard', p);
  const bases = [...new Set(P.map((p) => posix.basename(p)))];
  const hits = new Map();   // test → Set(path) named exactly / imported
  const named = new Map();  // test → Set(path) named exactly (the ceiling leg needs the name, not an import)
  if (bases.length) {
    const args = ['grep', '-n', '-I', '-F']; for (const b of bases) args.push('-e', b); args.push(at, '--', 'tests/');
    for (const l of gitAt(repo, args).split('\n')) {
      if (!l.startsWith(`${at}:`)) continue;
      const rest = l.slice(at.length + 1); const m = /^([^:]+):(\d+):(.*)$/.exec(rest); if (!m) continue;
      const [, file, , text] = m; if (!isTest(file)) continue;
      for (const p of P) {
        if (p === file || !text.includes(posix.basename(p))) continue;
        const nm = namesExactPath(text, p);
        if (nm || importsPath(text, file, p)) { if (!hits.has(file)) hits.set(file, new Set()); hits.get(file).add(p); }
        if (nm) { if (!named.has(file)) named.set(file, new Set()); named.get(file).add(p); }
      }
    }
  }
  for (const [file, ps] of hits) add(`guard:${file}`, 'guard', [...ps].sort()[0]);
  for (const s of sections) for (const p of P) if (s.text.includes(p) && namesExactPath(s.text, p)) { add(`rule:${s.file}#${s.heading}`, 'rule', p); break; }
  for (const [file, ps] of named) if (sizeTests.has(file)) for (const p of ps) add(`ceiling:${p}`, 'ceiling', p);
  for (const p of P) { const head = gitAt(repo, ['show', `${at}:${p}`]).split('\n').slice(0, 40).join('\n'); if (head && SELF_CEILING.test(head)) add(`ceiling:${p}`, 'ceiling', p); }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── C612m: THE BINDING WEIGHS SPECIFICITY — the NOTE side only; the ground truth stays every bound id, unweighted ─────────
// C612h's flagged set stayed at 29.3 per note: hub modules (cockpit.mjs, footprint.mjs, …) are imported or named by dozens of
// tests, so a note naming one bound them all. A guard's weight for a path is 1 / N, N = the non-test files present at <at> that
// guard imports (relative specifier) or names (a path string) — one module exercised binds strongly, twenty bind weakly. An id's
// weight is the sum over the note's paths it binds (a guard binding two of the note's files carries both shares). The same
// principle reads a rule section (1 / the non-test files present at <at> it names); a size ceiling is declared for exactly one
// file (weight 1), and a test the note names itself is its own guard (weight 1). The note flags the top FLAG_K by weight, ties
// by id. FLAG_K is fixed here, before the read, and never derived from one.
export const FLAG_K = 12;
export const PORT_ROW_WEIGHTS = 'C612m-port — the specificity weight (1 / non-test files a guard imports or names, at <sha>) and the top-12 cut decide what a note flags; they move beside the C612h bindings in the crate';
const TREE = new Map();   // at → Map(path → blob)
function treeAt(repo, at) {
  const key = `${repo}\0${at}`; if (TREE.has(key)) return TREE.get(key);
  const m = new Map();
  for (const l of gitAt(repo, ['ls-tree', '-r', '--full-tree', at]).split('\n')) { const t = l.indexOf('\t'); if (t < 0) continue; const meta = l.slice(0, t).split(' '); if (meta[1] === 'blob') m.set(l.slice(t + 1), meta[2]); }
  if (TREE.size > 8) TREE.clear(); TREE.set(key, m); return m;
}
const CAND = new Map();   // blob (else <at>:<file>) → candidate paths a binder names or imports (before the tree filter)
function candidatesOf(text, file) {
  const out = new Set();
  for (const m of String(text).matchAll(SPEC_RE)) { const s = m[1]; if (s.startsWith('.')) out.add(posix.normalize(posix.join(posix.dirname(file), s))); }
  for (const p of pathsIn(text)) out.add(p.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), p)) : p);
  return [...out];
}
/** specificityN(cands, tree, bound) — N: the non-test files present in `tree` that the binder imports or names; the
 *  paths it is bound to are always counted (an exact name the path regex misses still counts once). Never below 1. */
function specificityN(cands, tree, bound = []) {
  const s = new Set(cands.filter((p) => tree.has(p) && !isTest(p)));
  for (const p of bound) if (!isTest(p)) s.add(p);
  return Math.max(1, s.size);
}
/** weightedInvariants(paths, at, { repo }) — boundInvariants(paths, at) with a specificity weight per id (C612m). It calls
 *  boundInvariants unchanged and adds { weight, n, bound_paths }; the ids are exactly boundInvariants' ids. */
export function weightedInvariantsMjs(paths, at, { repo = REPO } = {}) {
  const P = [...new Set((paths || []).filter(Boolean))];
  const B = boundInvariantsMjs(P, at, { repo }); if (!B.length) return [];
  const tree = treeAt(repo, at); const { sections } = atCommit(repo, at);
  return B.map((x) => {
    if (x.binding === 'ceiling') return { ...x, weight: 1, n: 1, bound_paths: [x.path] };
    if (x.binding === 'rule') {
      const [file, ...h] = x.id.slice('rule:'.length).split('#'); const heading = h.join('#');
      const s = sections.find((y) => y.file === file && y.heading === heading) || { text: '' };
      const bp = P.filter((p) => s.text.includes(p) && namesExactPath(s.text, p));
      const n = specificityN(pathsIn(s.text), tree, bp);
      return { ...x, weight: Math.max(1, bp.filter((p) => !isTest(p)).length) / n, n, bound_paths: bp };
    }
    const file = x.id.slice('guard:'.length);
    const blob = tree.get(file); const ck = blob || `${at}:${file}`;
    let cands = CAND.get(ck);
    if (!cands) { cands = candidatesOf(gitAt(repo, ['show', `${at}:${file}`]), file); if (CAND.size > 20000) CAND.clear(); CAND.set(ck, cands); }
    const cs = new Set(cands);
    const bp = P.filter((p) => p !== file && !isTest(p) && cs.has(p));
    // the exact-name leg of boundInvariants can bind a path the candidate scan misses: fall back to the id's own path
    if (!bp.length && x.path !== file) bp.push(x.path);
    const n = specificityN(cands, tree, bp);
    const self = P.includes(file) ? 1 : 0;
    return { ...x, weight: self + bp.length / n, n, bound_paths: self ? [file, ...bp] : bp };
  });
}
/** flagTopMjs(weighted, k) — THE REFERENCE: the note's flagged ids, the top k by weight, ties by id. */
export function flagTopMjs(weighted, k = FLAG_K) {
  return [...weighted].sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, k).map((x) => x.id);
}

// ── C612p: THE DEFAULT PATH IS THE CRATE — spawn pmu-onchip --path-bind, shuttle JSON; nothing below decides ──────────────
export const ENGINE_ENV = 'C612P_ENGINE';
export const PORT_ROW_C612P = 'C612p — C612h boundInvariants · C612m weightedInvariants + flagTop (k 12) · C612o-vector vectorVerdict live in pmu-onchip --path-bind / --aperture-verdict (path_predict.rs mod bind); the mjs bodies are the reference behind C612P_ENGINE=mjs';
let WARNED = false;
/** the engine in force: 'crate' (default) or 'mjs' (the reference, by env — or when the binary is absent, said once on stderr) */
export function engine() {
  if (process.env[ENGINE_ENV] === 'mjs') return 'mjs';
  if (chipPath()) return 'crate';
  if (!WARNED) { WARNED = true; process.stderr.write('UNMEASURED-rust: pmu-onchip not built — C612p bindings ran on the mjs reference\n'); }
  return 'mjs';
}
/** crate(flag, doc) — one spawn of the chip, JSON in and out (the shuttle). The doc goes by --path, never stdin: a stdin
 *  handed over by spawnSync was seen held open twice on 2026-10-03 (the child blocked in read(0) for minutes). */
export function crate(flag, doc, { chip = chipPath() } = {}) { return crateFile(flag, doc, { chip }); }   // C621: the spawn lives in crate-call.mjs
const uniq = (paths) => [...new Set((paths || []).filter(Boolean))];
/** boundInvariants(paths, at, { repo }) — C612h, [{ id, binding, path }] sorted by id, read at <at>: the crate's answer */
export function boundInvariants(paths, at, { repo = REPO } = {}) {
  const P = uniq(paths); if (!P.length) return [];
  if (engine() === 'mjs') return boundInvariantsMjs(P, at, { repo });
  return crate('--path-bind', { repo: resolve(repo), queries: [{ at, paths: P }] }).results[0].bound;
}
/** weightedInvariants(paths, at, { repo }) — C612m, boundInvariants with { weight, n, bound_paths } per id: the crate's answer */
export function weightedInvariants(paths, at, { repo = REPO } = {}) {
  const P = uniq(paths); if (!P.length) return [];
  if (engine() === 'mjs') return weightedInvariantsMjs(P, at, { repo });
  return crate('--path-bind', { repo: resolve(repo), queries: [{ at, paths: P, weigh: true }] }).results[0].weighted;
}
/** flagTop(weighted, k) — C612m, the top k by weight, ties by id: the crate's answer */
export function flagTop(weighted, k = FLAG_K) {
  if (engine() === 'mjs') return flagTopMjs(weighted, k);
  return crate('--path-bind', { flag: [{ weighted: (weighted || []).map((x) => ({ id: x.id, weight: x.weight })), k }] }).flags[0];
}
/** weighAndFlag(paths, at, k) — the note's two steps in ONE spawn: { weighted, flagged } */
export function weighAndFlag(paths, at, k = FLAG_K, { repo = REPO } = {}) {
  const P = uniq(paths);
  if (engine() === 'mjs') { const W = P.length ? weightedInvariantsMjs(P, at, { repo }) : []; return { weighted: W, flagged: flagTopMjs(W, k) }; }
  if (!P.length) return { weighted: [], flagged: [] };
  const r = crate('--path-bind', { repo: resolve(repo), queries: [{ at, paths: P, weigh: true, k }] }).results[0];
  return { weighted: r.weighted, flagged: r.flagged };
}
/** weighAndFlagMany(namedLists, at, k) — weighAndFlag for several path lists at one <at>, one spawn (the chip caches <at>) */
export function weighAndFlagMany(lists, at, k = FLAG_K, { repo = REPO } = {}) {
  if (engine() === 'mjs') return lists.map((P) => weighAndFlag(P, at, k, { repo }));
  if (!lists.length) return [];
  return crate('--path-bind', { repo: resolve(repo), queries: lists.map((P) => ({ at, paths: uniq(P), weigh: true, k })) }).results.map((r) => ({ weighted: r.weighted, flagged: r.flagged }));
}
/** the reference predicates the crate reproduces by hand (the guard compares them on fixtures through --path-bind's probe) */
export const REF = Object.freeze({ namesExactPath, importsPath, pathsIn, candidatesOf, selfCeiling: (t) => SELF_CEILING.test(t), headingOf, isTest });

/** exercised(sha, touched) — the invariants BOUND to a touched path, read at the immutable commit (W3). A touched test is
 *  its own guard, so the ticking row's new guard is in here by the guard binding, never by a separate leg. */
export function exercised(sha, touched, { repo = REPO } = {}) { return boundInvariants(touched, sha, { repo }).map((x) => x.id); }

/** cutOf(heat) — the arm's hottest cells, TIE-SAFE: the TOP_CELLS cut never splits a tie (a cell whose heat equals the first
 *  excluded cell's is dropped with it), so no cell is chosen by its index. heat: 144-array (COORDS order) or [coord, heat] pairs. */
export function cutOf(heat, coords = null) {
  const pairs = (coords ? heat.map((h, i) => [coords[i], Number(h) || 0]) : heat.map(([c, h]) => [c, Number(h) || 0])).filter(([, h]) => h > 0).sort((x, y) => y[1] - x[1]);
  if (pairs.length <= TOP_CELLS) return pairs;
  const edge = pairs[TOP_CELLS][1];
  return pairs.filter(([, h]) => h > edge);
}
/** noteOf(cut, rows, { at }) — the note a walk would write, read off ITS OWN heat: each row scored by the heat it holds
 *  (Σ heat over its cells ÷ its cell count), ≤ MAX_ROWS rows with score > 0 (ties by id) → the files those rows name → the
 *  invariants BOUND to those files at <at> (C612h: the parent of the commit — the note is written before the work), cut to the
 *  top flagK by specificity weight (C612m; flagK null = every bound id, the C612h note). bound = how many it cut from.
 *  cut: [coord, heat] pairs (cutOf), or plain coords (heat 1 each — the text walks). */
export async function noteOf(cut, rows, opts = {}) { return (await notesOf([cut], rows, opts))[0]; }
/** namedOf(cut, rows) — the ≤ MAX_ROWS rows holding the most of the cut's heat → the files they name. A row may carry `named`
 *  (its pathsIn, precomputed — C619's lens index) in place of `text`. Exported for the lens (C619): one selection, two callers.
 *  C625: the crate carries the same pick (path_predict.rs bind::named_of, PICK_MAX_ROWS = MAX_ROWS) behind {op:"bind", pick} — the
 *  lens rides that; this body stays the reference and the no-daemon fallback, equal on the C625 guard's fixtures. */
export function namedOf(cut, rows) {
  const H = new Map((cut || []).map((x) => (Array.isArray(x) ? [x[0], x[1]] : [x, 1])));
  const hit = rows.map((r) => ({ r, s: (r.cells || []).reduce((t, c) => t + (H.get(c) || 0), 0) / Math.max(1, (r.cells || []).length) })).filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || (a.r.id < b.r.id ? -1 : 1)).slice(0, MAX_ROWS).map((x) => x.r);
  return { hit, named: [...new Set(hit.flatMap((r) => r.named || pathsIn(r.text)))] };
}
/** notesOf(cuts, rows, { at }) — noteOf for several cuts at one <at>, the binding in ONE crate spawn (C612p) */
export async function notesOf(cuts, rows, { at = 'HEAD', repo = REPO, flagK = FLAG_K } = {}) {
  const sel = cuts.map((c) => namedOf(c, rows));
  if (flagK == null) return sel.map(({ hit, named }) => { const all = boundInvariants(named, at, { repo }).map((x) => x.id); return { rows: hit.map((r) => r.id), named, flagged: all, bound: all.length }; });
  const W = weighAndFlagMany(sel.map((x) => x.named), at, flagK, { repo });
  return sel.map(({ hit, named }, i) => ({ rows: hit.map((r) => r.id), named, flagged: W[i].flagged, bound: W[i].weighted.length }));
}

/** litHeat(w) — what an arm's walk reached: lit cells (heat > 0) and distinct heat values. A text walk returns cells
 *  without heat, so each lit cell has heat 1 (one level when any cell is lit). */
export function litHeat(w) {
  if (w && Array.isArray(w.heat)) { const lit = w.heat.map(Number).filter((h) => h > 0); return { lit: lit.length, heat: new Set(lit.map((h) => h.toFixed(9))).size }; }
  const n = (w && w.cells || []).length; return { lit: n, heat: n ? 1 : 0 };
}

function mulberry(seedStr) { let a = 2166136261 >>> 0; for (const ch of seedStr) { a ^= ch.codePointAt(0); a = Math.imul(a, 16777619) >>> 0; } return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
const r2 = (x) => (x == null ? null : +x.toFixed(2));

/** C612h: the plan (git-only, aperture-free) from whichever C610j cache dir holds one, newest file first. */
function findPlan(cacheRoot) {
  const found = [];
  for (const d of existsSync(cacheRoot) ? readdirSync(cacheRoot) : []) for (const f of readdirSync(join(cacheRoot, d))) if (f.startsWith('plan-')) found.push(join(cacheRoot, d, f));
  if (!found.length) return null;
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0];
}

export async function runLive({ limit = Number(process.env.C612C_LIMIT || 160), out = OUT_JSON, concurrency = Number(process.env.C612H_CONCURRENCY || 4) } = {}) {
  const t0 = performance.now();
  const cacheRoot = resolve(REPO, '.thetacog/cache/forecast-wide');
  const { apertureVersion } = await import('../pmu/prompt-lens.mjs');
  const av = apertureVersion();   // C612h: the grids are built at the aperture IN FORCE, never read off a stale cache dir
  const planPath = findPlan(cacheRoot);
  if (!planPath) throw new Error('no C610j plan cached — run forecast-scored-on-past-commits.mjs --wide first');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const items0 = (plan.items || plan).filter((it) => it.arms?.neighbourhood?.paths);
  const rnd = mulberry(SEED); const items = items0.map((it) => [rnd(), it]).sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, it]) => it);
  // rebuild the door grids at `av` (C610j's walkReading, cached by (sha, arm, aperture)); bounded concurrency
  const W = await import('./forecast-scored-on-past-commits.mjs');
  const readings = new Map(); const tGrid = performance.now(); let built = 0;
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) { const had = existsSync(join(cacheRoot, av, 'neighbourhood', `${it.sha}.json`)); readings.set(it.sha, await W.walkReading(REPO, it, 'neighbourhood', av)); if (!had) built++; }
  }));
  const gridMs = Math.round(performance.now() - tGrid);
  const dw = await import('../pmu/definer-walk-144.mjs');
  const { chainedWalk, unpack } = await import('./chained-ingress.mjs');
  const { rowsOf } = await import('./retro-snowball.mjs');
  const ST = await import('./spec-tree.mjs');
  const allRows = rowsOf(ST.readTree(ST.TREE, { text: true }));
  const { probeWalker } = await import('./snowball-refresh.mjs');
  const probe = probeWalker();
  const pairs = Object.fromEntries(ARMS.map((a) => [a, []])); const ms = Object.fromEntries(ARMS.map((a) => [a, []]));
  const lit = Object.fromEntries(ARMS.map((a) => [a, []])); const heat = Object.fromEntries(ARMS.map((a) => [a, []])); const nflag = Object.fromEntries(ARMS.map((a) => [a, []])); const nbound = Object.fromEntries(ARMS.map((a) => [a, []]));
  const nex = []; const kinds = { guard: 0, rule: 0, ceiling: 0 };
  const refused = []; const probeErr = []; const lensErr = []; const identity = Object.fromEntries(ARMS.map((a) => [a, { same_heat_as_ensemble: 0, same_note_as_ensemble: 0, of: 0 }])); const evidence = [];
  for (const it of items) {
    const rd = readings.get(it.sha);
    if (!rd || !rd.ok) { refused.push({ sha: it.sha, why: (rd && rd.reason) || 'no reading' }); continue; }
    let touched, specAt;
    try { touched = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', it.sha]).split('\n').filter(Boolean); } catch { refused.push({ sha: it.sha, why: 'diff-tree failed' }); continue; }
    try { specAt = git(['show', `${it.sha}^:${SPEC_REL}`]); } catch { specAt = ''; }
    const before = new Set([...specAt.matchAll(/^\s*- \[[ x]\] (C\d+[a-z]?)\b/gm)].map((m) => m[1]));
    const own = new Set(it.labels || [it.label]);
    const rows = allRows.filter((r) => before.has(r.id) && !own.has(r.id));
    const exB = boundInvariants(touched, it.sha); const ex = exB.map((x) => x.id);
    nex.push(ex.length); for (const x of exB) kinds[x.binding]++;
    const ig = unpack(rd.i0);
    const timed = async (arm, fn) => { const s = performance.now(); const cells = await fn(); ms[arm].push(performance.now() - s); return cells; };
    const cellsBy = {
      ensemble: await timed('ensemble', async () => { const e = await dw.ensembleWalk(ig, dw.ingressFor('top-k', { grid: ig, k: 3 }), { rule: 'top-k' }); return { heat: Array.from(e.meanHeat, Number) }; }),
      ncd_grid: await timed('ncd_grid', async () => { const e = await dw.ensembleWalk(ig, dw.ingressFor('top-k', { grid: ig, k: 1 }), { rule: 'top-k' }); return { heat: Array.from(e.meanHeat, Number) }; }),
      chained: await timed('chained', async () => { const s = dw.ingressFor('top-k', { grid: ig, k: 1 })[0]; if (s == null) return { heat: [] }; const c = await chainedWalk(ig, s, { walk: dw.definerWalk144 }); return { heat: Array.from(c.heat, Number) }; }),
      lens_d2: await timed('lens_d2', async () => { const w = probe(it.declaration || '', { maxChars: 800 }); if (w.err) lensErr.push({ sha: it.sha.slice(0, 12), err: w.err }); return { cells: (w.cells || []).slice(0, TOP_CELLS) }; }),
      panel_d8: await timed('panel_d8', async () => { const e = await dw.ensembleWalk(ig, dw.ingressFor('top-k', { grid: ig, k: 1 }), { rule: 'top-k', maxDepth: 8 }); return { heat: Array.from(e.meanHeat, Number) }; }),
      probeWalker: await timed('probeWalker', async () => { const w = probe(it.declaration || ''); if (w.err) probeErr.push({ sha: it.sha.slice(0, 12), err: w.err }); return { cells: (w.cells || []).slice(0, TOP_CELLS) }; }),
    };
    const notes = {};
    const armNotes = await notesOf(ARMS.map((arm) => { const w = cellsBy[arm] || {}; return w.heat ? cutOf(w.heat, dw.COORDS) : (w.cells || []); }), rows, { at: `${it.sha}^` });
    for (const [ai, arm] of ARMS.entries()) {
      const w = cellsBy[arm] || {};
      const lh = litHeat(w); lit[arm].push(lh.lit); heat[arm].push(lh.heat);
      const n = armNotes[ai];
      notes[arm] = n; nflag[arm].push(n.flagged.length); nbound[arm].push(n.bound);
      const id = identity[arm]; id.of++;
      if (w.heat && cellsBy.ensemble.heat && w.heat.length === cellsBy.ensemble.heat.length && w.heat.every((v, i) => Math.abs(v - cellsBy.ensemble.heat[i]) < 1e-12)) id.same_heat_as_ensemble++;
      if (notes.ensemble && JSON.stringify(n.flagged) === JSON.stringify(notes.ensemble.flagged)) id.same_note_as_ensemble++;
      pairs[arm].push({ label: it.sha.slice(0, 12), session: it.session, named: n.named, flagged: n.flagged, touched, exercised: ex });
    }
    if (evidence.length < 5) evidence.push({ sha: it.sha, touched, exercised: ex, exercised_bindings: exB,
      arms: Object.fromEntries(ARMS.map((a) => [a, { cut: cellsBy[a].heat ? cutOf(cellsBy[a].heat, dw.COORDS) : (cellsBy[a].cells || []), ...litHeat(cellsBy[a]), rows: notes[a].rows, named: notes[a].named, flagged_ids: notes[a].flagged, flagged: notes[a].flagged.length, bound: notes[a].bound }])) });
  }
  const litM = Object.fromEntries(ARMS.map((a) => [a, r2(mean(lit[a]))])), heatM = Object.fromEntries(ARMS.map((a) => [a, r2(mean(heat[a]))]));
  const doc = { row: 'C612c', arms: ARMS.map((a) => ({ name: a, ms: ms[a].length ? +median(ms[a]).toFixed(3) : null, lit: litM[a], heat: heatM[a], pairs: pairs[a] })) };
  const r = score(doc);
  const flaggedMean = Object.fromEntries(ARMS.map((a) => [a, r2(mean(nflag[a]))]));
  const boundMean = Object.fromEntries(ARMS.map((a) => [a, r2(mean(nbound[a]))]));
  const prim = r.arms.find((a) => a.arm === 'ensemble') || r.arms[0];
  const baseRate = prim?.invariant_recall?.null_mean ?? null;
  const assumptions = [
    `door grids are rebuilt at the aperture in force (${av}) through C610j's walkReading (cached by sha, arm, aperture) — ${built} built this run in ${gridMs} ms; the plan is C610j's git-only plan (${planPath.split('/forecast-wide/')[1]}); halves are commit days, so pairs inside one day are not independent`,
    'an invariant counts only when BOUND to a path (C612h): a test at the commit that imports the file (relative specifier) or names its exact path · a CLAUDE.md / claude-rules section naming the exact path (the pre-split archive excluded) · a size ceiling for the file (a size-reading test that names it, or its own head declaring a KB/MB/bytes limit); exercised reads the bindings at <sha>, flagged reads them at <sha>^; rules-for (working tree, sibling headers) is no longer a side',
    `C612m: the note flags the top ${FLAG_K} of what its files bind by specificity weight (1 / the non-test files present at <sha>^ that a guard imports or names, summed over the note\'s files it binds; a rule section by the same count of files it names; a ceiling and a self-named test weigh 1; ties by id) — k fixed in code before this read; the exercised side is every bound id at <sha>, unweighted and untruncated`,
    'a touched test file is its own guard, so the ticking row\'s guard enters by the guard binding; no suite was re-run at two commits',
    'a note names the files of the ≤ 4 rows holding the most of its own heat (Σ heat ÷ row cells) over its hottest ≤ 12 cells, cut tie-safe; its own row and rows absent at <sha>^ are excluded',
    'lit = cells with heat > 0 in the arm\'s walk (the text walks: the cells returned, each heat 1); heat = distinct heat values among them; both are means over the scored pairs',
    'lens_d2 is the lens text walk (lensWalk, 800 chars); ncd_grid and panel_d8 are both the K = 1 walk at the home knobs (maxDepth 8) — the same walk by construction, kept as two arms because the row names both',
    'ms is the median per-pair walk time of the arm in this process (grid build, naming and scoring excluded)',
    `probeWalker (lensWalk) yields under load: ${probeErr.length} of ${items.length} walks returned an err and enter the crate as an empty note (no_note), never a zero`,
  ];
  const out_doc = { at: new Date().toISOString(), row: 'C612c', refined_by: 'C612h', weighted_by: 'C612m', flag_k: FLAG_K, ground_truth: 'unweighted', llm: false, engine: r.engine, sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR,
    port_row: PORT_ROW, port_row_bindings: PORT_ROW_BINDINGS, port_row_weights: PORT_ROW_WEIGHTS, aperture: av, stale_aperture_replaced: 'c89f4d766eec', bindings: [...BINDINGS],
    flagged_mean: flaggedMean, bound_mean_before_cut: boundMean, exercised_mean: r2(mean(nex)), exercised_by_binding: kinds, lit: litM, heat: heatM,
    preregistered: { flag_k: FLAG_K, flagged_mean_at_most_12: Object.values(flaggedMean).every((m) => m != null && m <= FLAG_K), flagged_mean_below_15: Object.values(flaggedMean).every((m) => m != null && m < 15), base_rate: baseRate, base_rate_below_0_2: baseRate != null && baseRate < 0.2,
      before_c612m: { flagged_mean: 29.27, base_rate: 0.057, sha: 'ebb5203292' }, before: { flagged_mean: 131, base_rate: 0.45, lit: 24, heat: 4, aperture: 'c89f4d766eec' } },
    corpus: { plan: planPath.split('/forecast-wide/')[1], items: items.length, of: items0.length, grids_built: built, grid_ms: gridMs, refused, probe_walker_err: probeErr, lens_d2_err: lensErr }, identity, evidence, assumptions, run_ms: Math.round(performance.now() - t0),
    line: r.line, line2: r.line2, lines: r.lines, primary: r.primary, secondary: r.secondary, k: r.k, draws: r.draws, seed: r.seed, band: r.band, bar: r.bar,
    arms: r.arms.map(({ body, body2, ...a }) => ({ ...a, line: `C612c ${a.arm}: ${body}`, line2: `C612c ${body2}` })) };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(out_doc, null, 2) + '\n'); }
  return out_doc;
}

// ── C612p: THE PORT RECEIPT — crate vs reference on the live C612c/h/m evidence, and the binding of one commit timed ─────────
export const C612P_JSON = resolve(REPO, 'data/vna/c612p-bind-port.json');
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : v));
/** sameWeighted(a, b) — same ids, bindings, paths, n and bound paths in the same order; weights within 1e-12 */
export function sameWeighted(a, b) {
  return a.length === b.length && a.every((x, i) => { const y = b[i]; return x.id === y.id && x.binding === y.binding && x.path === y.path && x.n === y.n && Math.abs(x.weight - y.weight) <= 1e-12 && canon(x.bound_paths) === canon(y.bound_paths); });
}
/** the live read through one engine: per evidence commit, exercised at <sha> + the six notes at <sha>^ */
export function liveRead(evidence, eng) {
  const prev = process.env[ENGINE_ENV]; if (eng === 'mjs') process.env[ENGINE_ENV] = 'mjs'; else delete process.env[ENGINE_ENV];
  try {
    return evidence.map((e) => { const arms = Object.keys(e.arms); const W = weighAndFlagMany(arms.map((a) => e.arms[a].named), `${e.sha}^`, FLAG_K);
      return { sha: e.sha, exercised: boundInvariants(e.touched, e.sha), notes: Object.fromEntries(arms.map((a, i) => [a, { named: e.arms[a].named, ...W[i] }])) }; });
  } finally { if (prev == null) delete process.env[ENGINE_ENV]; else process.env[ENGINE_ENV] = prev; }
}
/** compareLive(c, m) — { pairs, equal, diffs } over two liveRead results */
export function compareLive(c, m) {
  const diffs = []; let pairs = 0;
  c.forEach((x, i) => { const y = m[i];
    pairs++; if (canon(x.exercised) !== canon(y.exercised)) diffs.push(`${x.sha.slice(0, 12)} exercised`);
    for (const a of Object.keys(x.notes)) { pairs++; const p = x.notes[a], q = y.notes[a];
      if (canon(p.flagged) !== canon(q.flagged)) diffs.push(`${x.sha.slice(0, 12)} ${a} flagged`);
      if (!sameWeighted(p.weighted, q.weighted)) diffs.push(`${x.sha.slice(0, 12)} ${a} weights`); } });
  return { pairs, equal: pairs - diffs.length, diffs };
}
/** the scorer's verdict over the evidence pairs a live read builds — the same crate scorer, fed by either engine's bindings */
export function verdictOf(read, evidence) {
  const arms = Object.keys(read[0]?.notes || {});
  const doc = { row: 'C612p', arms: arms.map((a) => ({ name: a, ms: 1, pairs: read.map((r, i) => ({ label: r.sha.slice(0, 12), session: r.sha.slice(0, 12), named: r.notes[a].named, flagged: r.notes[a].flagged, touched: evidence[i].touched, exercised: r.exercised.map((x) => x.id) })) })) };
  const r = score(doc); return { line: r.line, verdicts: Object.fromEntries(r.arms.map((x) => [x.arm, x.verdict])) };
}
function stats(xs) { const s = [...xs].sort((a, b) => a - b), n = s.length, m = n >> 1; return { median_ms: +(n % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1), min_ms: +s[0].toFixed(1), max_ms: +s[n - 1].toFixed(1), n }; }
/** time the binding of one commit in a FRESH process (cold caches): the exercised side at <sha> and the six notes at <sha>^ */
function timeOnce(eng, e) {
  const url = new URL(import.meta.url).href;
  const code = `const P = await import(${JSON.stringify(url)}); const e = JSON.parse(process.env.C612P_E); const t0 = performance.now(); P.boundInvariants(e.touched, e.sha); const t1 = performance.now(); const a = Object.keys(e.arms); P.weighAndFlagMany(a.map((k) => e.arms[k].named), e.sha + '^', P.FLAG_K); const t2 = performance.now(); process.stdout.write(JSON.stringify({ bind: t1 - t0, pair: t2 - t0 }));`;
  const env = { ...process.env, C612P_E: JSON.stringify({ sha: e.sha, touched: e.touched, arms: Object.fromEntries(Object.entries(e.arms).map(([k, v]) => [k, { named: v.named }])) }) };
  if (eng === 'mjs') env[ENGINE_ENV] = 'mjs'; else delete env[ENGINE_ENV];
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`timing run (${eng}) exited ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
  return JSON.parse(r.stdout);
}
export async function c612pReceipt({ runs = Number(process.env.C612P_RUNS || 7), out = C612P_JSON } = {}) {
  const d = JSON.parse(execFileSync('git', ['show', `HEAD:${OUT_JSON.slice(REPO.length + 1)}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }));
  const ev = d.evidence || [];
  const tc = performance.now(); const c = liveRead(ev, 'crate'); const crateMs = performance.now() - tc;
  const tm = performance.now(); const m = liveRead(ev, 'mjs'); const mjsMs = performance.now() - tm;
  const cmp = compareLive(c, m); const vc = verdictOf(c, ev), vm = verdictOf(m, ev);
  // 20 real commits beyond the evidence (≤ 40 touched files each, newest first from HEAD): exercised at <sha>, the touched files' weighted note at <sha>^
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const shas = git(['rev-list', '--no-merges', '--max-count=200', head]).split('\n').filter(Boolean);
  const real = []; for (const sha of shas) { if (real.length >= 20) break; const t = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]).split('\n').filter(Boolean); if (t.length && t.length <= 40) real.push({ sha, touched: t }); }
  const realDiffs = [];
  for (const x of real) {
    const one = (eng) => { const prev = process.env[ENGINE_ENV]; if (eng === 'mjs') process.env[ENGINE_ENV] = 'mjs'; else delete process.env[ENGINE_ENV];
      try { return { b: boundInvariants(x.touched, x.sha), w: weighAndFlag(x.touched, `${x.sha}^`, FLAG_K) }; } finally { if (prev == null) delete process.env[ENGINE_ENV]; else process.env[ENGINE_ENV] = prev; } };
    const p = one('crate'), q = one('mjs');
    if (canon(p.b) !== canon(q.b)) realDiffs.push(`${x.sha.slice(0, 12)} bound`);
    if (!sameWeighted(p.w.weighted, q.w.weighted) || canon(p.w.flagged) !== canon(q.w.flagged)) realDiffs.push(`${x.sha.slice(0, 12)} weighted`);
  }
  // the C612o replay (every version with ≥ MIN_TURNS committed turns) through both engines, and each version judged against the one before as its floor
  // (in a child: lens-aperture-ratchet.mjs imports this module, and a cycle through a module still in its top-level await never settles)
  const replayCode = `const R = await import(${JSON.stringify(new URL('../pmu/lens-aperture-ratchet.mjs', import.meta.url).href)}); const E = 'C612P_ENGINE';
  const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : v));
  const rep = async (eng) => { if (eng === 'mjs') process.env[E] = 'mjs'; else delete process.env[E]; try { return await R.replay({ log: () => {} }); } finally { delete process.env[E]; } };
  const rc = await rep('crate'), rm = await rep('mjs');
  const cur = (o) => ({ ...o, measures: { ...o.measures, E: { ...o.measures.E, epoch: 'current' } } });
  const chained = []; for (let i = 1; i < rc.length; i++) { const fl = { version: rc[i - 1].version, epoch: 'current', measures: cur(rc[i - 1]).measures }; const vec = { version: rc[i].version, versions: [rc[i].version], n: rc[i].n, ...cur(rc[i]) };
    chained.push({ floor: fl.version, version: vec.version, crate: R.vectorVerdict(fl, vec), mjs: R.vectorVerdictMjs(fl, vec) }); }
  const strip = (o) => o.map((x) => ({ version: x.version, n: x.n, verdict: x.verdict, as_if_current_walk: x.as_if_current_walk }));
  process.stdout.write(JSON.stringify({ versions: rc.map((x) => x.version), equal: canon(strip(rc)) === canon(strip(rm)) && chained.every((x) => canon(x.crate) === canon(x.mjs)), crate: strip(rc), chained }));`;
  const rr = spawnSync(process.execPath, ['--input-type=module', '-e', replayCode], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env } });
  if (rr.status !== 0) throw new Error(`replay child exited ${rr.status}: ${(rr.stderr || '').slice(0, 300)}`);
  const replay = JSON.parse(rr.stdout);
  const e = ev[0]; const T = { mjs: { bind: [], pair: [] }, crate: { bind: [], pair: [] } };
  for (let i = 0; i < runs; i++) for (const eng of (i % 2 ? ['crate', 'mjs'] : ['mjs', 'crate'])) { const t = timeOnce(eng, e); T[eng].bind.push(t.bind); T[eng].pair.push(t.pair); }
  const doc = { at: new Date().toISOString(), row: 'C612p', llm: false, engine: 'pmu-onchip --path-bind · --aperture-verdict', reference: `${ENGINE_ENV}=mjs`, flag_k: FLAG_K,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), evidence_from: 'HEAD:data/vna/path-prediction.json evidence',
    live: { commits: ev.length, ...cmp, same_verdict: canon(vc) === canon(vm), verdict_crate: vc, verdict_mjs: vm, read_ms: { crate: Math.round(crateMs), mjs: Math.round(mjsMs) } },
    real_commits: { n: real.length, from: head, max_touched: 40, equal: real.length - new Set(realDiffs.map((d) => d.split(' ')[0])).size, diffs: realDiffs },
    replay,
    timing: { commit: e?.sha, touched: e?.touched.length, notes: Object.keys(e?.arms || {}).length, cold: 'a fresh node process per run (no binding cache), engines alternated',
      bind_commit: { what: 'boundInvariants(touched, <sha>) — the exercised side of one commit', before_mjs: stats(T.mjs.bind), after_crate: stats(T.crate.bind) },
      bind_pair: { what: 'exercised at <sha> + the six arms\' weighted notes at <sha>^ (one pair of runLive)', before_mjs: stats(T.mjs.pair), after_crate: stats(T.crate.pair) } } };
  if (out) writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--c612p-receipt')) {
  const r = await c612pReceipt();
  const f = (s) => `${s.median_ms} ms [${s.min_ms}, ${s.max_ms}] n ${s.n}`;
  console.log(`C612p live: ${r.live.equal}/${r.live.pairs} equal over ${r.live.commits} commits · same verdict ${r.live.same_verdict} · diffs ${JSON.stringify(r.live.diffs)}`);
  console.log(`real commits: ${r.real_commits.equal}/${r.real_commits.n} equal · replay ${r.replay.versions.join(', ')} equal ${r.replay.equal} (chained ${r.replay.chained.map((x) => `${x.version} vs ${x.floor}: ${x.crate.action}`).join('; ')})`);
  console.log(`bind one commit: mjs ${f(r.timing.bind_commit.before_mjs)} → crate ${f(r.timing.bind_commit.after_crate)}`);
  console.log(`bind one pair:   mjs ${f(r.timing.bind_pair.before_mjs)} → crate ${f(r.timing.bind_pair.after_crate)} → data/vna/c612p-bind-port.json`);
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = await runLive();
  console.log(d.line); console.log(d.line2); for (const l of d.arms.map((a) => a.line)) console.log(l);
  console.log(`bound/note before the k=${d.flag_k} cut ${JSON.stringify(d.bound_mean_before_cut)}`);
  console.log(`flagged/note ${JSON.stringify(d.flagged_mean)} · exercised/commit ${d.exercised_mean} · base rate ${d.preregistered.base_rate}`);
  console.log(`aperture ${d.aperture} · items ${d.corpus.items} of ${d.corpus.of} · grids built ${d.corpus.grids_built} · refused ${d.corpus.refused.length} · run ${d.run_ms} ms · → data/vna/path-prediction.json`);
}
