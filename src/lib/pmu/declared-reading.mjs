// src/lib/pmu/declared-reading.mjs — THE THREE-WORD READING OVER A DECLARED BOUND (C92 · C92b · C92c · C92d, 2026-09-19).
// =============================================================================================
// A buyer declares a bound as ONE spec row with ONE guard and the paths it covers:
//     - [ ] C1 (guard: `tests/c1.test.mjs`) paths: `src/app/api/auth/**` the refund path never pays twice
// This module is the pure reading over such rows — it lives under src/lib/pmu so the npm package ships it (bundle-pmu's
// crossTree) and `npx thetacog-mcp walk` (scripts/pmu/walk.mjs) and the cockpit's underwriter reading (C87, C92b) read the
// same three words from the same function. Nothing here spawns, reads a file, or touches a clock; the caller hands in the
// rows, the changed paths and each guard's result.
//
//   WITHIN             every row whose paths cover a changed file has its guard run and passing
//   OUTSIDE(guard C1)  the first covering row whose guard failed — an absence never hides a breach, the first breach is named
//   UNDECLARED         no row's paths cover the changed files (or there are no rows at all) — the fact the underwriter prices
//   UNMEASURED         a covering row's guard could not be read (not run · not on disk · the row names no guard) — never WITHIN
//
// Nothing here claims the code is correct (Rice): the word says WHICH declared bound covered the change and WHAT its guard
// returned, or that none did. UNDECLARED and UNMEASURED are printed words, never an empty string and never WITHIN.
const ROW_RE = /^\s*-\s*\[( |x|X)\]\s*(C\d{1,3}[a-z]?|T\d{1,3})\b(.*)$/;   // the same row shape spec-tree.mjs / flight-tape.mjs read
const GUARD_RE = /\bguard[:s]?\s*`([^`]+)`/i;
// the declaration form is ` paths: \`glob\`, \`glob\`` — "paths:" outside backticks, each glob backticked, no whitespace inside a glob.
// Prose that mentions `paths:` inside backticks ("`paths:` globs on a row") is NOT a declaration: on 2026-09-19 the earlier
// /\bpaths:\s*(`…`)+/ read the backtick that CLOSED the mention as the one that OPENED a glob and returned a sentence as a path
// (C92c — token standing in for construct). The lookbehind refuses a backtick or word char before "paths:".
const PATHS_RE = /(?<![`\w])paths:\s*((?:`[^`\s]+`\s*,?\s*)+)/;

/** the `paths:` globs declared on a row's text — the ONE parser; spec-tree.mjs's specRows reads the same function (C92c) */
export function rowPaths(text) {
  const p = PATHS_RE.exec(String(text || ''));
  return p ? [...p[1].matchAll(/`([^`\s]+)`/g)].map((x) => x[1].trim()).filter(Boolean) : [];
}

/** the rows of a spec document: { label, done, guard, paths, text } — prose that names a label is not a row */
export function declaredRows(md) {
  const out = []; const seen = new Set();
  for (const line of String(md || '').split('\n')) {
    const m = ROW_RE.exec(line); if (!m || seen.has(m[2])) continue; seen.add(m[2]);
    const g = GUARD_RE.exec(m[3]); const paths = rowPaths(m[3]);
    out.push({ label: m[2], done: m[1] !== ' ', guard: g ? g[1].trim() : null, paths, text: `${m[2]} ${m[3]}`.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** a small glob: `**` any depth (including none), `*` within one segment, `?` one char; anchored to the whole path */
export function globMatch(path, glob) {
  const p = String(path).replace(/^\.\//, ''); const g = String(glob).replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { const slash = g[i + 2] === '/'; re += slash ? '(?:.*/)?' : '.*'; i += slash ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(p);
}

/** which rows cover which changed paths: byRow (label → the covered paths) and the paths no row covers */
export function coveredBy(changed, rows) {
  const byRow = new Map(); const uncovered = [];
  for (const f of changed || []) {
    let hit = false;
    for (const r of rows || []) { if ((r.paths || []).some((g) => globMatch(f, g))) { hit = true; if (!byRow.has(r.label)) byRow.set(r.label, []); byRow.get(r.label).push(f); } }
    if (!hit) uncovered.push(f);
  }
  return { byRow, uncovered };
}

/** the reading: { word, why, rows, covered, changed, guards: [{ label, guard, status, ms, why }] } — pure over its arguments */
export function readingOf({ rows = [], changed = [], results = {} } = {}) {
  const n = rows.length; const { byRow, uncovered } = coveredBy(changed, rows);
  const base = { rows: n, changed: changed.length, covered: byRow.size, uncovered: uncovered.length, guards: [] };
  if (!n) return { word: 'UNDECLARED', why: `no spec rows in this repo — ${changed.length} changed path${changed.length === 1 ? '' : 's'}, nothing declared covers ${changed.length === 1 ? 'it' : 'them'}`, ...base };
  if (!byRow.size) return { word: 'UNDECLARED', why: `${n} row${n === 1 ? '' : 's'} declared, no row's paths cover the ${changed.length} changed path${changed.length === 1 ? '' : 's'}`, ...base };
  const guards = [...byRow.keys()].map((label) => {
    const row = rows.find((r) => r.label === label); const res = results[label] || null;
    if (!row.guard) return { label, guard: null, status: 'unrun', ms: null, why: 'the row names no guard' };
    if (!res) return { label, guard: row.guard, status: 'unrun', ms: null, why: 'the guard was not run' };
    return { label, guard: row.guard, status: res.status || 'unrun', ms: Number.isFinite(res.ms) ? res.ms : null, why: res.why || null };
  });
  const out = { ...base, guards };
  const failed = guards.find((g) => g.status === 'fail');
  if (failed) return { word: `OUTSIDE(guard ${failed.label})`, why: `${failed.label}'s guard ${failed.guard} failed at HEAD${failed.ms != null ? ` in ${failed.ms} ms` : ''}`, ...out };
  const unread = guards.find((g) => g.status !== 'pass');
  if (unread) return { word: 'UNMEASURED', why: `${unread.label} covers the change but its guard could not be read — ${unread.why || unread.status}`, ...out };
  return { word: 'WITHIN', why: `${guards.length} covering row${guards.length === 1 ? '' : 's'} (${guards.map((g) => g.label).join(', ')}), every named guard passed at HEAD`, ...out };
}

/** the full ShortLex name of a coordinate — the cockpit's form (scripts/vna/envelope.mjs fullName), restated for the package */
export function fullName(coord) {
  const N = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund',
    B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
  const m = /^([A-C][1-3]?),([A-C][1-3]?)$/.exec(String(coord || ''));
  return m ? `${m[1]}.${N[m[1]]} × ${m[2]}.${N[m[2]]}` : String(coord || '?');
}
