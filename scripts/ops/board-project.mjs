#!/usr/bin/env node
// scripts/ops/board-project.mjs — C2170 THE PROJECT SHEETS: one sheet per project (go-to-market · the code), what is done over what is
// next. Operator 2026-10-30, verbatim: "we need a check box or a comment on how it went for the spec written … we should be including
// file paths spec tags in the spreadsheet, but also the left offer part of it needs to be absolutely legible for a human to see what has
// been done over what is next … move the completed Rose to the lawn section right that’s something we should be able to not generate
// actually program".
//
// The PROJECT level sits one above the PROMPT level (Steer · Compiled, board-steer.mjs): a compiled steer declares rows, a project holds
// them until they are done. LLM-FREE end to end. docs/specs/vna/projects.json SELECTS the rows; everything on a row is read live:
//   tick + guard + text    the spec markdown (specRows below; `paths:` through declared-reading.mjs rowPaths)
//   plain head + priority  data/vna/board-heads.ndjson (newest wins)
//   files                  the row's `paths:` and guard, plus every repo path its text names that exists on disk
//   Merkle leaf            data/vna/spec-tree.json (the node whose cue is the row id), the same 10-hex the Tree sheet carries (C2170a)
//   the commit that ticked git log over the spec file, one pass, cached by the spec's own last commit
// Layout: the NEXT block on top (priority, then the goal's order), then DONE · LOG (newest tick first). A row moves from NEXT to
// DONE · LOG by program the pass after its tick lands, and its typed cells move with it (the writer keys his cells by id + header).
// The move is also appended to the sheet's Log tab and data/vna/project-moves.ndjson — the movement is the receipt (notes-to-log.mjs).
//   node scripts/ops/board-project.mjs --print [--project gtm|code]   the rows to stdout
//   node scripts/ops/board-project.mjs [--project gtm|code|--all]     write the sheet(s), cell by cell (created on first run)
//   node scripts/ops/board-project.mjs --between                      C2170b: the steer's between-cycles pass (config, lock, hash)
// Port row: C2170-port — the tick scan and the selection decide what a sheet shows; they move into the crate once the sheet is in use.
// @guard tests/ops/c2170-project-sheets.test.mjs
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowPaths } from '../../src/lib/pmu/declared-reading.mjs';   // the ONE `paths:` parser

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECTS_SRC = 'docs/specs/vna/projects.json';
export const SPEC_MD = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';
export const MOVES = 'data/vna/project-moves.ndjson';
export const HEAD = ['ID', 'HOW IT WENT · YOUR COMMENT (fill)', 'OK? ✓ / ✗ (fill)', 'STATE', 'WHAT', 'NEXT STEP · OR DONE BY', 'GUARD', 'FILES', 'TAGS', 'LEAF'];
export const LOG_HEAD = ['ID', 'WHEN', 'ROW', 'WHAT', 'COMMIT', 'LEAF'];
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const readJ = (p, d = null) => { try { return JSON.parse(readFileSync(resolve(REPO, p), 'utf8')); } catch { return d; } };
const readT = (p) => { try { return readFileSync(resolve(REPO, p), 'utf8'); } catch { return ''; } };
const family = (id) => Number((String(id).match(/^C(\d+)/) || [])[1] || 0);

// The rows of the spec. declared-reading.mjs declaredRows reads ids of at most three digits (C\d{1,3}), so every row from C1000 up is
// invisible to it; this reads the shape board-gtm.mjs specIndex reads (any id length, a letter suffix) and keeps rowPaths for `paths:`.
export const ROW = /^\s*- \[( |x|X)\] (C\d+[a-z]*)\b(.*)$/;
export function specRows(md) {
  const out = new Map();
  for (const l of String(md || '').split('\n')) {
    const m = ROW.exec(l); if (!m || out.has(m[2])) continue;
    const g = /\(guard: `([^`]+)`\)/.exec(m[3]);
    out.set(m[2], { label: m[2], done: m[1] !== ' ', guard: g ? g[1].trim() : null, paths: rowPaths(m[3]), text: `${m[2]} ${m[3]}`.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

// Every repo path a row names: its `paths:` and guard, plus each path token in its text (spec rows are upper-cased, so the token is
// lower-cased and KEPT ONLY WHEN IT EXISTS on disk — a guessed path is never printed as a file the row touches).
const PATH_TOKEN = /\b(?:scripts|tests|docs|src|packages|data|hooks|\.claude)\/[\w.\-/]+\.[a-z]{1,5}\b/gi;
export function filesOf(row, exists = (p) => existsSync(resolve(REPO, p))) {
  const out = []; const add = (p, must) => { const q = String(p).replace(/^\.\//, ''); if (q && !out.includes(q) && (!must || exists(q))) out.push(q); };
  for (const p of row.paths || []) add(p, false);
  for (const m of String(row.text || '').matchAll(PATH_TOKEN)) add(m[0].toLowerCase(), true);   // lower-cased only: a case-blind disk would pass the upper-cased token too
  return out.filter((p) => p !== row.guard);
}

export function leafIndex(tree = readJ('data/vna/spec-tree.json', {})) {
  const nodes = tree && tree.nodes ? (Array.isArray(tree.nodes) ? tree.nodes : Object.values(tree.nodes)) : [];
  return new Map(nodes.filter((n) => n && n.cue).map((n) => [n.cue, String(n.hash || '').slice(0, 10)]));
}
export function headIndex(txt = readT('data/vna/board-heads.ndjson')) {
  const ix = new Map();
  for (const l of txt.split('\n')) { try { const r = JSON.parse(l); if (r && r.id) ix.set(r.id, r); } catch {} }
  return ix;
}

// One git pass over the spec file: the commit that ticked each row and the commit that declared it. Cached by the spec's last commit,
// so a pass with no new spec commit spends nothing here.
export function specHistory({ days = 30, git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }) } = {}) {
  let last = ''; try { last = git(['log', '-1', '--format=%H', '--', SPEC_MD]).trim(); } catch { return { ticked: new Map(), declared: new Map(), last: null }; }
  const cacheP = resolve(REPO, '.thetacog/project-sheet-history.json');
  const c = (() => { try { return JSON.parse(readFileSync(cacheP, 'utf8')); } catch { return null; } })();
  if (c && c.last === last && c.days === days) return { ticked: new Map(c.ticked), declared: new Map(c.declared), last };
  const ticked = new Map(), declared = new Map(); let cur = null;
  const out = git(['log', `--since=${days}.days`, '--format=@@%h %cI', '-p', '--unified=0', '--', SPEC_MD]);
  for (const l of out.split('\n')) {
    if (l.startsWith('@@') && /^@@[0-9a-f]{7,} /.test(l)) { const [sha, at] = l.slice(2).split(' '); cur = { sha, at }; continue; }
    const m = /^\+\s*- \[( |x)\] (C\d+[a-z]*)\b/.exec(l); if (!m || !cur) continue;
    const into = m[1] === 'x' ? ticked : declared; if (!into.has(m[2])) into.set(m[2], cur);   // git log is newest first: keep the first seen
  }
  try { mkdirSync(dirname(cacheP), { recursive: true }); writeFileSync(cacheP, JSON.stringify({ last, days, ticked: [...ticked], declared: [...declared] })); } catch {}
  return { ticked, declared, last };
}

// THE SELECTION — which spec rows a project holds, in order of first mention. Never a hand-typed list of titles.
export function selectIds(p, { rows, all = {}, read = readJ, history }) {
  const s = p.select || {}; const ids = [];
  const add = (id) => { if (id && rows.has(id) && !ids.includes(id)) ids.push(id); };
  if (s.gtmSpec) for (const r of (read(s.gtmSpec, { rows: [] }).rows || [])) for (const id of r.refs || []) if (/^C\d/.test(id)) add(id);
  if (s.tag) for (const [id, r] of rows) if (new RegExp(`\\(${s.tag}:`, 'i').test(r.text)) add(id);
  if (s.goal) for (const u of (read(s.goal, { units: [] }).units || [])) for (const id of u.labels || []) add(id);
  if (s.compiled) for (const a of (read(s.compiled, { asks: [] }).asks || [])) add(a.id);
  if (s.declaredDays && history) { const cut = Date.now() - s.declaredDays * 864e5; for (const [id, c] of history.declared) if (Date.parse(c.at) >= cut && rows.get(id)?.guard) add(id); }
  for (const id of s.ids || []) add(id);
  const ex = new Set((s.exclude || []).flatMap((k) => all[k] || []));
  // doneDays: a ticked row stays on the sheet only while its tick is inside the window — older done work lives in the Log tab already
  const cutDone = s.doneDays && history ? Date.now() - s.doneDays * 864e5 : null;
  const keepDone = (id) => !cutDone || !rows.get(id).done || (history.ticked.has(id) && Date.parse(history.ticked.get(id).at) >= cutDone);
  return ids.filter((id) => !ex.has(id) && keepDone(id));
}

function tagsOf(id, r, { gtmSteps, compiled, goal }) {
  const t = [];
  const g = /\(GTM: SHEET=[^)]*?ROW=([\w.-]+)(?: → (H-\d+))?\)/i.exec(r.text); if (g) t.push(`GTM ${g[1]}${g[2] ? ` → ${g[2]}` : ''}`);
  const steps = gtmSteps.get(id); if (steps && !g) t.push(`GTM ${steps.join(' · ')}`);
  if (goal.has(id)) t.push('goal');
  const c = compiled.get(id); if (c) t.push(`steer ${basename(String(c.file || c.at || ''), '.txt') || 'compiled'}`);
  t.push(`family C${family(id)}`);
  return t.join(' · ');
}

export function stateOf(r, h) {
  if (r.done) return '✓ DONE';
  const cls = h && h.class;
  if (cls === 'YOUR-ACT') return '✋ YOUR ACT';
  if (cls === 'NEEDS-OPERATOR') return '✋ NEEDS YOU';
  return '☐ NEXT';
}

// The grid, pure: rows Map(id → declaredRows row), selected ids, heads, leaves, history.
// rank: Map(id → motions it unblocks), C2173 — when a project orders by unblocks, NEXT reads the critical path first.
export function composeProject(p, { rows, ids, heads = new Map(), leaves = new Map(), history = { ticked: new Map() }, gtmSteps = new Map(), compiled = new Map(), goal = [], exists, rank = null } = {}) {
  const goalIx = new Map(goal.map((id, i) => [id, i]));
  const cells = ids.map((id) => {
    const r = rows.get(id); const hr = heads.get(id) || {}; const h = hr.head || {};
    const what = clip(h.done_when ? h.done_when.replace(/^Done when\s*/i, '') : r.text.replace(/^C\d+[a-z]*\s*(\(guard: `[^`]*`\)\s*)?/, '').replace(/\((?:GTM|TEND):[^)]*\)\s*/i, '').replace(/\s*\((?:chair decomposition|operator)\b.*$/i, ''), 150);
    const what1 = /[a-z]/.test(what) ? what : what.charAt(0) + what.slice(1).toLowerCase();
    const t = history.ticked.get(id);
    const nextOrDone = r.done ? (t ? `✓ ${t.sha} · ${t.at.slice(0, 10)}` : '✓ ticked before the window') : clip(h.now && h.now !== 'nothing' ? `now: ${h.now}` : (h.waits_on && h.waits_on !== 'nothing' ? `waits on ${h.waits_on}` : 'build it'), 120);
    return { id, done: r.done, prio: Number.isFinite(hr.priority) ? hr.priority : -1, tick: t ? t.at : '',
      row: [id, '', '', stateOf(r, hr), what1, nextOrDone, r.guard || '', filesOf(r, exists).join('\n'), [tagsOf(id, r, { gtmSteps, compiled, goal: goalIx }), rank && !r.done && rank.get(id) ? `unblocks ${rank.get(id)} motion${rank.get(id) === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '), leaves.get(id) || 'not in the tree'], ub: (rank && rank.get(id)) || 0 };
  });
  const next = cells.filter((c) => !c.done).sort((a, b) => b.ub - a.ub || b.prio - a.prio || (goalIx.get(a.id) ?? 1e9) - (goalIx.get(b.id) ?? 1e9) || family(b.id) - family(a.id) || a.id.localeCompare(b.id));
  const done = cells.filter((c) => c.done).sort((a, b) => b.tick.localeCompare(a.tick) || family(b.id) - family(a.id));
  const you = next.filter((c) => /^✋/.test(c.row[3])).length;
  const blank = () => Array(HEAD.length).fill('');
  const sec = (id, label) => { const r = blank(); r[0] = id; r[4] = label; return r; };
  const now = blank(); now[0] = 'NOW'; now[4] = `✓ ${done.length} done · ☐ ${next.length - you} next · ✋ ${you} need you`; now[5] = `spec at ${String(history.last || '').slice(0, 10) || 'UNMEASURED'}`; now[8] = `project ${p.key} · rows selected by ${PROJECTS_SRC}`;
  return [HEAD, now, sec('■ NEXT', `NEXT — ${next.length} open, highest priority first`), ...next.map((c) => c.row), sec('■ DONE · LOG', `DONE · LOG — ${done.length} ticked, newest first; a row lands here by program the pass after its tick`), ...done.map((c) => c.row)];
}

// Everything a compose needs, read once.
export async function loadAll({ read = readJ } = {}) {
  const cfg = read(PROJECTS_SRC, { projects: [] });
  const rows = specRows(readT(SPEC_MD));
  const history = specHistory();
  const sel = {}; for (const p of cfg.projects) sel[p.key] = selectIds(p, { rows, all: sel, read, history });
  const gtmSteps = new Map();
  for (const p of cfg.projects) if (p.select && p.select.gtmSpec) for (const r of (read(p.select.gtmSpec, { rows: [] }).rows || [])) for (const id of r.refs || []) if (/^C\d/.test(id)) gtmSteps.set(id, [...(gtmSteps.get(id) || []), r.id]);
  const compiled = new Map(((read('data/vna/steer-compiled.json', { asks: [] }).asks) || []).map((a) => [a.id, a]));
  const goal = ((read('data/vna/goal.json', { units: [] }).units) || []).flatMap((u) => u.labels || []);
  // C2173: the GTM critical path — how many motions wait on each C-row (board-gtm.mjs unblocksIndex, the same rule as READY TO BUILD)
  let rank = null;
  const gp = cfg.projects.find((p) => p.select && p.select.gtmSpec && p.select.orderBy === 'unblocks');
  if (gp) { const G = await import('./board-gtm.mjs'); const src = read(gp.select.gtmSpec, { rows: [] }); rank = new Map([...G.unblocksIndex({ src, spec: G.specIndex(readT(SPEC_MD)) })].filter(([id]) => /^C\d/.test(id)).map(([id, m]) => [id, m.length])); }
  return { cfg, rows, history, sel, rank, ctx: { rows, heads: headIndex(), leaves: leafIndex(), history, gtmSteps, compiled, goal } };
}
export async function composeAll(only = null) {
  const L = await loadAll();
  return L.cfg.projects.filter((p) => !only || p.key === only).map((p) => ({ p, grid: composeProject(p, { ...L.ctx, ids: L.sel[p.key], rank: p.select && p.select.orderBy === 'unblocks' ? L.rank : null }) }));
}
// For the Tree sheet (C2170a): which project sheet holds each row.
export async function holderIndex() { const L = await loadAll(); const ix = new Map(); for (const p of L.cfg.projects) for (const id of L.sel[p.key]) if (!ix.has(id)) ix.set(id, p.sheet); return ix; }

export const gridHash = (grid) => createHash('sha256').update(JSON.stringify(grid)).digest('hex').slice(0, 16);
// The rows that crossed from NEXT to DONE since the last recorded move — the Log tab's new rows and the ledger's.
export function newMoves(grid, sheet, moved) {
  const out = []; let inDone = false;
  for (const r of grid) { if (r[0] === '■ DONE · LOG') { inDone = true; continue; } if (!inDone || !/^C\d/.test(r[0])) continue; if (!moved.has(`${sheet}\u0000${r[0]}`)) out.push(r); }
  return out;
}
const readMoves = () => new Set(readT(MOVES).split('\n').filter(Boolean).map((l) => { try { const j = JSON.parse(l); return `${j.sheet}\u0000${j.id}`; } catch { return ''; } }));

async function writeProject(token, p, grid) {
  const { writeSheet } = await import('./board-sheets-write.mjs');
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.sheets[p.sheet];
  if (!id) {
    const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: p.title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    if (!r.id) return `✗ ${p.sheet}: create failed — ${JSON.stringify(r).slice(0, 160)}`;
    id = r.id; j.sheets = { [p.sheet]: id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  const r = await writeSheet(token, id, grid, { name: p.sheet });
  if (r.refused) return `✗ ${p.sheet}: refused — ${r.why}`;
  // the movement is the receipt: every row now under DONE · LOG and not yet recorded goes to the ledger first (AXIOM 1), then the Log tab
  const moved = newMoves(grid, p.sheet, readMoves()); let logLine = '';
  if (moved.length) {
    const at = new Date().toISOString();
    for (const m of moved) appendFileSync(resolve(REPO, MOVES), JSON.stringify({ at, sheet: p.sheet, id: m[0], what: m[4], done_by: m[5], leaf: m[9] }) + '\n');
    const { appendLogTab } = await import('./board-cells.mjs');
    const l = await appendLogTab(id, 'Log', LOG_HEAD, moved.map((m) => [`${m[0]}`, at.slice(0, 16).replace('T', ' '), m[0], m[4], m[5], m[9]]));
    logLine = l.error || l.off ? ` · Log tab UNMEASURED — ${l.error || l.why} (ledger kept)` : ` · ${moved.length} row(s) moved to Log`;
  }
  const how = r.mode === 'cells' ? `${r.applied} cell(s) written · ${r.appended} appended · ${r.conflicts.length} conflict(s) left as typed` : `${r.newRows} rows · ${r.keptFills} typed kept`;
  return `✓ ${p.sheet}: ${how}${logLine} · https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export async function writeAll({ only = null, ifChanged = false } = {}) {
  const hashP = resolve(REPO, '.thetacog/project-sheets.hash.json');
  const seen = (() => { try { return JSON.parse(readFileSync(hashP, 'utf8')); } catch { return {}; } })();
  if (!existsSync(resolve(REPO, 'data/vna/board-drive.json'))) return ['project sheets: UNMEASURED — no data/vna/board-drive.json here (the board folder and its sheet ids); --print shows the sheets without Drive'];
  const plans = (await composeAll(only)).filter(({ p, grid }) => !ifChanged || seen[p.key] !== gridHash(grid));
  if (!plans.length) return ['project sheets: unchanged since the last write — nothing sent'];
  const { rcloneToken } = await import('./board-comments.mjs');
  const t = rcloneToken(); if (!t.token) return [`project sheets: UNMEASURED — ${t.why}`];
  const lines = [];
  for (const { p, grid } of plans) {
    const line = await writeProject(t.token, p, grid); lines.push(line);
    if (line.startsWith('✓')) { seen[p.key] = gridHash(grid); try { writeFileSync(hashP, JSON.stringify(seen)); } catch {} }
  }
  return lines;
}

// C2170b — the between-cycles pass: config on, one at a time (a lock with a live pid), write only what moved. Never throws.
export const LOCK = '.thetacog/project-sheets.lock';
export async function between({ cfg = readJ(PROJECTS_SRC, {}), lockPath = resolve(REPO, LOCK), alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }, write = writeAll } = {}) {
  if (!cfg.steer || !cfg.steer.enabled) return ['project sheets: off (projects.json steer.enabled false)'];
  try { const pid = Number(readFileSync(lockPath, 'utf8')); if (pid && pid !== process.pid && alive(pid)) return [`project sheets: a pass is already running (pid ${pid})`]; } catch {}
  try { mkdirSync(dirname(lockPath), { recursive: true }); writeFileSync(lockPath, String(process.pid)); } catch {}
  try { return await write({ ifChanged: true }); }
  catch (e) { return [`project sheets: UNMEASURED — ${String(e && e.message || e).slice(0, 160)}`]; }
  finally { try { rmSync(lockPath); } catch {} }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const only = a.includes('--project') ? a[a.indexOf('--project') + 1] : null;
  if (a.includes('--print')) {
    for (const { p, grid } of await composeAll(only)) { console.log(`── ${p.sheet}`); for (const r of grid) console.log([r[0], r[3], clip(r[4], 60), clip(r[5], 40), clip(String(r[7]).split('\n')[0], 50), r[9]].join(' │ ')); }
    process.exit(0);
  }
  const lines = a.includes('--between') ? await between() : await writeAll({ only, ifChanged: a.includes('--if-changed') });
  for (const l of lines) console.log(l);
  if (a.includes('--between')) { try { appendFileSync(resolve(REPO, '.thetacog/project-sheets.ndjson'), JSON.stringify({ at: new Date().toISOString(), lines }) + '\n'); } catch {} }
  process.exit(lines.some((l) => l.startsWith('✗')) ? 1 : 0);
}
