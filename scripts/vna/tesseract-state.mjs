#!/usr/bin/env node
// scripts/vna/tesseract-state.mjs — C63 THE TESSERACT STATE (goal 2 unit 1, 2026-09-18). The tree's manifold state, exported
// and content-addressed: every basin's pixel (the 12×12 projection), its walk's lit-cell vector over the 144 cells and its
// trajectory (the higher-dimensional state the pixel projects from), its mass and branch weight (own gzip over the sum), the
// Merkle root and the counts. Canonical bytes (sorted keys, no whitespace) → sha256 = tesseract_sha, which new flight-tape
// commit rows carry inside their signed body. DERIVED: written by this script from data/vna/spec-tree.json, never by hand;
// `--verify` recomputes the sha from the tree and says whether the file on disk matches. Nothing here walks or reads a model.
//   node scripts/vna/tesseract-state.mjs [--json] · node scripts/vna/tesseract-state.mjs --verify
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const STATE = process.env.VNA_TESSERACT_STATE || resolve(REPO, 'data/vna/tesseract-state.json');
// C81a THE ONE DOOR. The tree and its state land together or not at all: writeTree (spec-tree.mjs) holds this lock while it
// renames the tree, the outline and the state into place; writeState alone holds it too. This is a WRITE barrier, held for
// the renames only — .thetacog/vna-fold.lock (hook-doors.mjs) is the dispatch pid-lock that keeps two folds from starting,
// a different thing. A reader (verifyState) that finds a live writer's lock re-reads up to REREADS times, never sleeps.
export const LOCK = process.env.VNA_SPEC_TREE_LOCK || resolve(REPO, '.thetacog/spec-tree.lock');
export const REREADS = 3;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** the live writer holding the lock, or null — a lock whose pid is dead (or older than 60 s) is stale and is cleared here */
export function readLock(lock = LOCK) {
  let l = null; try { l = JSON.parse(readFileSync(lock, 'utf8')); } catch { return null; }
  if (l && Number.isInteger(l.pid) && alive(l.pid) && Date.now() - (Date.parse(l.at) || 0) < 60000) return l;
  try { unlinkSync(lock); } catch {} return null;
}
/** take the lock — atomic create; a live holder is waited on for at most ~1 s (writer side only), then taken over and said */
export function acquireLock(lock = LOCK) {
  mkdirSync(dirname(lock), { recursive: true });
  const body = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  for (let i = 0; i < 40; i++) {
    try { writeFileSync(lock, body, { flag: 'wx' }); return { taken: true, waited: i, over: null }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const holder = readLock(lock); if (!holder) continue;   // stale → cleared → retry the create
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  const over = readLock(lock); writeFileSync(lock, body); return { taken: true, waited: 40, over: over ? over.pid : null };
}
export function releaseLock(lock = LOCK) { try { const l = JSON.parse(readFileSync(lock, 'utf8')); if (l.pid === process.pid) unlinkSync(lock); } catch {} }
/** write via a sibling tmp then rename — a reader sees the old bytes or the new bytes, never a torn file */
export function atomicWrite(path, data) { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, path); }
const SL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
export const cellIndex = (p) => { const [r, c] = String(p || '').split(','); const i = SL.indexOf(r), j = SL.indexOf(c); return i < 0 || j < 0 ? null : i * 12 + j; };
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
// the walk row carries the trajectory as an array of pixels (walk-door.mjs); a comma-joined string is the older shape, read the same way
export const trajectoryCells = (t) => (Array.isArray(t) ? t.map(cellIndex).filter((x) => x != null) : typeof t === 'string' ? t.split(',').reduce((a, _, i, arr) => (i % 2 === 0 ? a.concat([cellIndex(`${arr[i]},${arr[i + 1]}`)]) : a), []).filter((x) => x != null) : null);
export const canonicalBytes = (state) => JSON.stringify(sortKeys(state));
export const shaOf = (state) => createHash('sha256').update(canonicalBytes(state)).digest('hex');

export function tesseractState(tree) {
  const basins = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted).sort((a, b) => (a.id < b.id ? -1 : 1));
  const own = (n) => (n.mass && n.mass.own ? n.mass.own.gzip : 0);
  const total = basins.reduce((a, n) => a + own(n), 0) || 1;
  const nodes = basins.map((n) => {
    const w = n.walk || {};
    const cells = Array.isArray(w.cells) ? [...new Set(w.cells)].map(cellIndex).filter((x) => x != null).sort((a, b) => a - b) : null;
    return { id: n.id, label: n.meta && n.meta.label, hash: n.hash, done: !!(n.meta && n.meta.done), pixel: n.pixel || null, cell: cellIndex(n.pixel), lit: cells, trajectory: trajectoryCells(w.trajectory), admissible: !!w.admissible, mass: own(n), weight: +(own(n) / total).toFixed(6), snippets: (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length };
  });
  const cells = {}; for (const n of nodes) if (n.cell != null) (cells[n.cell] ||= []).push(n.label);
  const shared = Object.entries(cells).filter(([, v]) => v.length > 1).map(([k, v]) => ({ cell: +k, pixel: `${SL[Math.floor(k / 12)]},${SL[k % 12]}`, basins: v }));
  const state = { v: 1, root: tree.root, at: tree.at || null, counts: { basins: nodes.length, withLit: nodes.filter((n) => n.lit && n.lit.length).length, sharedCells: shared.length }, lattice: { side: 12, cells: 144, order: SL }, nodes, shared };
  return { state, sha: shaOf(state) };
}
export function writeState({ treePath = TREE, out = STATE, tree = null, lock = LOCK, hold = true } = {}) {
  const t = tree || JSON.parse(readFileSync(treePath, 'utf8'));
  const { state, sha } = tesseractState(t);
  const json = JSON.stringify({ tesseract_sha: sha, ...state }, null, 1) + '\n';
  let same = false; try { same = readFileSync(out, 'utf8') === json; } catch {}
  if (!same) { if (hold) acquireLock(lock); try { atomicWrite(out, json); } finally { if (hold) releaseLock(lock); } }
  return { sha, out, counts: state.counts, same };
}
export function verifyState({ treePath = TREE, path = STATE, lock = LOCK } = {}) {
  // bounded re-read: a live writer mid-door explains a mismatch, so read again (≤ REREADS) — never a sleep, never a pass
  let rereads = 0, holder = null, r = null;
  for (;;) {
    if (!existsSync(path)) return { ok: false, why: 'no state file', rereads };
    const disk = JSON.parse(readFileSync(path, 'utf8')); const { tesseract_sha, ...body } = disk;
    const fromDisk = shaOf(body);
    const { sha: fromTree } = tesseractState(JSON.parse(readFileSync(treePath, 'utf8')));
    r = { ok: fromDisk === tesseract_sha && fromTree === tesseract_sha, disk: tesseract_sha, recomputedFromDisk: fromDisk, recomputedFromTree: fromTree, rereads, why: null };
    if (r.ok) return r;
    holder = fromTree !== tesseract_sha ? readLock(lock) : null;
    if (!holder || rereads >= REREADS) break;
    rereads++; r.rereads = rereads;
  }
  r.why = r.recomputedFromDisk !== r.disk ? 'the file does not hash to its own sha' : `the tree moved since the export${holder ? ` (lock held by pid ${holder.pid} after ${rereads} re-reads)` : ''}`;
  return r;
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify')) { const v = verifyState(); console.log(argv.includes('--json') ? JSON.stringify(v) : `tesseract state · ${v.ok ? 'VERIFIES' : 'DOES NOT VERIFY — ' + v.why} · disk ${String(v.disk).slice(0, 12)} · from tree ${String(v.recomputedFromTree).slice(0, 12)}`); process.exit(v.ok ? 0 : 1); }
  const r = writeState(); console.log(argv.includes('--json') ? JSON.stringify(r) : `tesseract state · sha ${r.sha.slice(0, 12)} · ${r.counts.basins} basins · ${r.counts.withLit} with lit cells · ${r.counts.sharedCells} shared cells · ${r.out}`);
}
