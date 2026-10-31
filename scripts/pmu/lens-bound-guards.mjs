#!/usr/bin/env node
// scripts/pmu/lens-bound-guards.mjs — C619: THE LENS SERVES THE GUARDS THE COMMITS EXERCISE, NOT ONLY THE RULE SECTIONS. LLM-FREE.
//
// Operator 2026-10-03: "what else do we need to close … the actual versus the ideal outcome map of Delta". The aperture ratchet's
// E and recall (C616) score the served set against C612h's EXERCISED set — the guards, rule sections and byte ceilings BOUND to
// the files a commit touched (pmu-onchip --path-bind, path_predict.rs mod bind). The lens served CLAUDE.md / claude-rules
// sections only, so a committed turn's should (≈ 95 % guard ids) and its served set shared nothing: E and recall read 0 by
// construction, not by measurement.
//
// What this adds, per prompt: the lens's own walk cells → the ≤ 4 spec rows holding the most of that heat (path-prediction.mjs
// namedOf — the SAME selection the lens_d2 arm of C612c uses, one rule in one place) → the files those rows name → the
// invariants bound to them at HEAD, top FLAG_K by specificity weight (pmu-onchip --path-bind through weighAndFlag — the crate
// decides, this file only shuttles). Each id keeps its binding tag (guard · rule · ceiling), so the served set carries guards
// BESIDE the rules, never mixed into them. Never a regex of test names: an id is served only because the crate bound it.
//
// THE LATENCY. The hook runs on every prompt. Two caches keep the crate off the hot path when nothing moved:
//   rows  — the spec-tree index (id, cells, named) keyed by the tree file's size+mtime; the 1 s JSON.parse happens once per tree
//           change, in a DETACHED rebuild while the stale index serves (only a missing index is built inline, once).
//   bind  — the crate's answer keyed by (HEAD sha, the named files). C620: a miss asks the long-lived daemon
//           (`pmu-onchip --door-serve --socket .thetacog/door-serve.sock`, {op:"bind"} → path_predict.rs bind::answer over the
//           Binder it holds per repo) over ONE connection this process keeps; only when the socket is absent (or the daemon cannot
//           answer) does it pay the one-shot --path-bind spawn (~250 ms measured). Same function, same bytes, either route.
//   C625: the row pick moved into the crate too. On the crate route ONE daemon request carries { pick: { cells, index: rows.json },
//           queries: [{ at, weigh, k }] } — path_predict.rs named_of picks the rows off the index file the daemon holds (cached
//           per size+mtime), binds the files they name, and answers { pick: { rows, named }, results }. namedOf here stays the
//           reference and the fallback route (no daemon, or C612P_ENGINE=mjs). The bind cache is keyed by the cut (sha · k · tree
//           key · cells), so a warm prompt needs neither the pick nor the bind.
// Sufficient for: which invariants the work this prompt points at will collide with, before it starts. Not for: whether the
// work was good (Rice). Port row: C619-port in data/vna/rust-punch-list.json — the row selection moves beside lens.rs with
// the C612c-port naming step; the binding already lives in the crate.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import net from 'node:net';
import { namedOf, weighAndFlag, engine, FLAG_K, REF } from '../vna/path-prediction.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = process.env.LENS_BOUND_CACHE || resolve(REPO, '.thetacog/cache/lens-bound-guards');
export const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const BIND_CACHE_MAX = 256;
export const ROW = 'C619';
export const SUFFICIENT_FOR = 'which invariants (guards · rule sections · ceilings) the work this prompt points at will collide with, before it starts';
export const NOT_SUFFICIENT_FOR = 'whether the work was good (Rice)';

export const SOCK = () => process.env.PMU_DOOR_SOCK || resolve(REPO, '.thetacog/door-serve.sock');
export const DAEMON_TIMEOUT_MS = Number(process.env.LENS_BOUND_DAEMON_MS || 15000);

// ── C620: ONE connection per process to the door daemon (unref'd while idle, so a hook still exits) ───────────────────────────
const conns = new Map();   // sock → { s, pending: Map(id → {res, timer}), next }
function connOf(sock) {
  const have = conns.get(sock); if (have && !have.s.destroyed) return Promise.resolve(have);
  return new Promise((res) => {
    const c = { s: net.connect(sock), pending: new Map(), next: 1, ready: false };
    let buf = '';
    const fail = () => { conns.delete(sock); for (const [, p] of c.pending) { clearTimeout(p.timer); p.res(null); } c.pending.clear(); if (!c.ready) res(null); };
    c.s.once('connect', () => { c.ready = true; c.s.unref(); conns.set(sock, c); res(c); });
    c.s.on('error', fail); c.s.on('close', fail);
    c.s.on('data', (d) => {
      buf += d.toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        const p = c.pending.get(j.id); if (!p) continue; c.pending.delete(j.id); clearTimeout(p.timer);
        if (!c.pending.size) c.s.unref();
        p.res(j.error || !j.out ? null : j);
      }
    });
  });
}
/** the daemon's {op:"bind"} answer for a --path-bind doc → { out, held } — null when no daemon answers (the caller spawns) */
export async function daemonBind(doc, { sock = SOCK(), timeoutMs = DAEMON_TIMEOUT_MS } = {}) {
  if (!existsSync(sock)) return null;
  const c = await connOf(sock); if (!c) return null;
  return new Promise((res) => {
    const id = c.next++;
    const timer = setTimeout(() => { c.pending.delete(id); res(null); }, timeoutMs); timer.unref();
    c.pending.set(id, { res, timer }); c.s.ref();
    c.s.write(JSON.stringify({ op: 'bind', id, doc }) + '\n');
  });
}
/** closes this process's daemon connection (tests; a hook just exits) */
export function closeDaemon() { for (const [, c] of conns) c.s.destroy(); conns.clear(); }
export let spawnCount = 0;
/** bindNamed(named, sha, k) — weighAndFlag's flagged ids through the daemon when its socket is live, a spawn otherwise:
 *  { ids, route: 'daemon' | 'crate' } (route 'crate' = the one-shot spawn, or the mjs reference under C612P_ENGINE=mjs) */
export async function bindNamed(named, sha, k = FLAG_K, { repo = REPO, sock = SOCK() } = {}) {
  const P = [...new Set((named || []).filter(Boolean))];
  if (!P.length) return { ids: [], route: 'none' };
  if (engine() === 'crate') {
    const r = await daemonBind({ repo: resolve(repo), queries: [{ at: sha, paths: P, weigh: true, k }] }, { sock });
    const q = r && r.out && r.out.results && r.out.results[0];
    if (q && Array.isArray(q.flagged)) return { ids: q.flagged, route: 'daemon' };
  }
  spawnCount++;
  return { ids: weighAndFlag(P, sha, k, { repo }).flagged, route: 'crate' };
}

const rowsFile = () => join(CACHE_DIR, 'rows.json');
const bindFile = () => join(CACHE_DIR, 'bind.json');
const atomic = (f, s) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; writeFileSync(t, s); renameSync(t, f); };
export function treeKey(tree = TREE) { try { const s = statSync(tree); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return null; } }

/** the compact index: one row per live contract — id, cells, the files its text names (rowsOf's filter, pathsIn's reading) */
export async function buildRowIndex(tree = TREE) {
  const { readTree } = await import('../vna/spec-tree.mjs');
  const { rowsOf } = await import('../vna/retro-snowball.mjs');
  const key = treeKey(tree);
  const rows = rowsOf(readTree(tree, { text: true })).map((r) => ({ id: r.id, cells: r.cells, named: REF.pathsIn(r.text) }));
  atomic(rowsFile(), JSON.stringify({ row: ROW, key, tree, at: new Date().toISOString(), rows }));
  return rows;
}
/** the index in force: fresh → served; stale → served while a detached rebuild runs; absent → built inline once */
export async function rowIndex({ tree = TREE, inline = false } = {}) {
  let doc = null; try { doc = JSON.parse(readFileSync(rowsFile(), 'utf8')); } catch { /* absent */ }
  if (doc && doc.tree === tree && doc.key === treeKey(tree)) return { rows: doc.rows, index: 'fresh' };
  if (doc && doc.tree === tree && !inline) {
    const lock = join(CACHE_DIR, "rebuild.lock"); let busy = false; try { busy = Date.now() - statSync(lock).mtimeMs < 60000; } catch { /* no lock */ }
    if (!busy) try { atomic(lock, String(process.pid)); spawn(process.execPath, [fileURLToPath(import.meta.url), '--rebuild'], { detached: true, stdio: 'ignore', env: { ...process.env, VNA_SPEC_TREE: tree } }).unref(); } catch { /* the stale index still serves */ }
    return { rows: doc.rows, index: 'stale' };
  }
  return { rows: await buildRowIndex(tree), index: 'built' };
}
export function headSha(repo = REPO) { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
const bindingOf = (id) => String(id).split(':')[0];

/** boundForCells(cells) — the invariants the lens serves for its walk: { rows, named, ids, guards, by_binding, at, route, ms }.
 *  ids keep their binding prefix (guard:/rule:/ceiling:); guards is the guard: subset. An empty ids says WHY (never a silent 0). */
/** C625: the crate's whole bound-guard step in one daemon request — the row pick (named_of over the rows.json the daemon reads)
 *  and the bind of the picked files. → { rows, named, ids } or null when no daemon answers (the caller falls back to namedOf). */
export async function daemonPick(cut, sha, k = FLAG_K, { repo = REPO, sock = SOCK() } = {}) {
  if (engine() !== 'crate') return null;
  const r = await daemonBind({ repo: resolve(repo), pick: { cells: cut, index: rowsFile() }, queries: [{ at: sha, weigh: true, k }] }, { sock });
  const p = r && r.out && r.out.pick; const q = r && r.out && r.out.results && r.out.results[0];
  if (!p || p.error || !Array.isArray(p.named) || !q || !Array.isArray(q.flagged)) return null;
  return { rows: p.rows, named: p.named, ids: p.named.length ? q.flagged : [] };
}
export async function boundForCells(cells, { repo = REPO, tree = TREE, at = null, k = FLAG_K, inline = false } = {}) {
  const t0 = performance.now();
  const cut = (cells || []).filter(Boolean);
  const sha = at || headSha(repo);
  const key = `${sha}\0${k}\0${treeKey(tree)}\0${JSON.stringify(cut)}`;
  let cache = {}; try { cache = JSON.parse(readFileSync(bindFile(), 'utf8')); } catch { /* absent */ }
  let got = cache[key] && Array.isArray(cache[key].ids) && Array.isArray(cache[key].named) ? { ...cache[key], route: 'cache', index: 'cache' } : null;
  if (!got) {
    const { rows, index } = await rowIndex({ tree, inline });
    const d = await daemonPick(cut, sha, k, { repo });
    if (d) got = { ...d, route: 'daemon', index };
    else {
      const { hit, named } = namedOf(cut, rows);
      got = { rows: hit.map((r) => r.id), named, ids: [], route: 'none', index };
      if (named.length) ({ ids: got.ids, route: got.route } = await bindNamed(named, sha, k, { repo }));
    }
    if (got.named.length) {
      cache[key] = { rows: got.rows, named: got.named, ids: got.ids, t: Date.now() };
      const keys = Object.keys(cache); if (keys.length > BIND_CACHE_MAX) for (const x of keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - BIND_CACHE_MAX)) delete cache[x];
      try { atomic(bindFile(), JSON.stringify(cache)); } catch { /* the answer stands without the cache */ }
    }
  }
  const base = { row: ROW, llm: false, at: sha, index: got.index, rows: got.rows, named: got.named };
  if (!got.named.length) return { ...base, ids: [], guards: [], by_binding: {}, route: 'none', why: got.rows.length ? 'the rows the walk lit name no file' : 'the walk lit no row', ms: +(performance.now() - t0).toFixed(1) };
  const ids = got.ids;
  const by = {}; for (const id of ids) (by[bindingOf(id)] ||= []).push(id);
  return { ...base, ids: [...ids], guards: by.guard || [], by_binding: Object.fromEntries(Object.entries(by).map(([b, xs]) => [b, xs.length])), route: got.route, ms: +(performance.now() - t0).toFixed(1) };
}

/** the injected block: the bound guards tagged as guards, beside the rule block — short, one id per line */
export function renderBoundBlock(b, { max = FLAG_K } = {}) {
  if (!b || !b.ids || !b.ids.length) return '';
  const lines = b.ids.slice(0, max).map((id) => `  🛡 ${id}`);
  return `🛡 BOUND GUARDS (${ROW} · pmu-onchip --path-bind at ${String(b.at || '').slice(0, 10)} · rows ${b.rows.join(' ')}) — the invariants the files this work points at are bound to; run the guards before the commit:\n${lines.join('\n')}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--rebuild')) await buildRowIndex();
  else { const cells = process.argv.slice(2).filter((a) => !a.startsWith('--')); process.stdout.write(JSON.stringify(await boundForCells(cells), null, 2) + '\n'); }
}
