// C825 — THE TEMP SWEEP: the repo's leaked temp folders are removed, whatever leaked them.
// 2026-10-13: os.tmpdir() held 100,870 top-level entries (4.5 GB), 3–22 k new per day, all test and script fixtures
// made with mkdtemp(tmpdir()) and never removed (798 call sites). Every mkdtemp and every scan paid for the 100 k,
// and fseventsd sat at 130 % CPU with ~33 k faults/s. Fixing 798 sites does not stay fixed; this bounds the effect.
// A folder is swept only when ALL hold: its name starts with a prefix this repo's own code passes to tmpdir()
// (derived by reading tests/ scripts/ src/, never typed here), something follows the prefix (a bare fixed path —
// a lock, a socket — is never touched), and it is older than MIN_AGE (6 h; a test finishes in minutes).
// Runs from mem.mjs --reap on the 5-minute controller tick, at most MAX_PER_RUN entries per run.
import { readdirSync, readFileSync, statSync, rmSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIN_AGE_MS = 6 * 3600 * 1000;
export const MAX_PER_RUN = 5000;
export const LEDGER = resolve(REPO, '.thetacog/tmp-sweep.ndjson');
const CACHE = resolve(REPO, '.thetacog/cache/tmp-prefixes.json');
// any path the code builds directly under tmpdir(): mkdtemp(join(tmpdir(), 'x-')), resolve(tmpdir(), `x-${pid}`)
const SITE = /(?:join|resolve)\(\s*(?:os\.)?tmpdir\(\)\s*,\s*['`"]([^'`"$\/]+)/g;

function* files(dir) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p); else if (/\.(mjs|js|cjs|ts|sh)$/.test(e.name)) yield p;
  }
}

/** The prefixes this repo's code puts under tmpdir(), read from the code itself. Shorter than 3 chars is refused. */
export function derivePrefixes(roots = ['tests', 'scripts', 'src'].map((d) => join(REPO, d))) {
  const set = new Set();
  for (const r of roots) for (const f of files(r)) {
    let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
    if (!t.includes('tmpdir()')) continue;
    for (const m of t.matchAll(SITE)) if (m[1].length >= 3) set.add(m[1]);
  }
  return [...set].sort();
}

export function cachedPrefixes({ maxAgeMs = 3600 * 1000, now = Date.now() } = {}) {
  try { const c = JSON.parse(readFileSync(CACHE, 'utf8')); if (now - c.at < maxAgeMs && c.prefixes.length) return c.prefixes; } catch {}
  const prefixes = derivePrefixes();
  try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify({ at: now, prefixes })); } catch {}
  return prefixes;
}

/** Is `name` a leaked instance of one of `prefixes`? Something must follow the prefix. */
export function ownedBy(name, prefixes) {
  return prefixes.some((p) => name.length > p.length && name.startsWith(p));
}

export function leaked({ dir = tmpdir(), prefixes, now = Date.now(), minAgeMs = MIN_AGE_MS } = {}) {
  const out = []; let entries = 0;
  for (const name of readdirSync(dir)) {
    entries++;
    if (!ownedBy(name, prefixes)) continue;
    let st; try { st = statSync(join(dir, name)); } catch { continue; }
    if (now - st.mtimeMs >= minAgeMs) out.push(name);
  }
  return { entries, leaked: out };
}

export function sweep({ dir = tmpdir(), prefixes = cachedPrefixes(), now = Date.now(), minAgeMs = MIN_AGE_MS, max = MAX_PER_RUN, dryRun = false, ledger = LEDGER } = {}) {
  const { entries, leaked: names } = leaked({ dir, prefixes, now, minAgeMs });
  const take = names.slice(0, max); let removed = 0;
  if (!dryRun) for (const n of take) { try { rmSync(join(dir, n), { recursive: true, force: true }); removed++; } catch {} }
  const row = { at: new Date(now).toISOString(), dir, entries, leaked: names.length, removed, dry_run: dryRun || undefined, prefixes: prefixes.length };
  if (!dryRun && ledger) { try { mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify(row) + '\n'); } catch {} }
  return row;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const max = process.argv.includes('--all') ? Infinity : MAX_PER_RUN;
  const r = sweep({ dryRun: !process.argv.includes('--sweep'), max });
  console.log(`TMP     ${r.entries} entries in ${r.dir} · ${r.leaked} leaked repo folders older than 6 h · ${r.dry_run ? 'would remove' : 'removed'} ${r.dry_run ? Math.min(r.leaked, max) : r.removed} (${r.prefixes} prefixes read from the code)`);
}
