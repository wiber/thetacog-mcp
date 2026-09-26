#!/usr/bin/env node
// scripts/pmu/replay.mjs — C99d THE REPLAY IS A DOOR, NOT A DEFENCE: `npx thetacog-mcp replay --since <ref>` (2026-09-19).
// =============================================================================================
// Re-reads every commit in a range through C92d's one door (scripts/pmu/walk.mjs → walkRepo, imported never re-implemented;
// the rows parse and the three-word reading are src/lib/pmu/declared-reading.mjs, the same function `walk` reads) against the
// rows declared at THAT commit's height — `git show <sha>:<spec>` — and prints one line per commit:
//
//   <sha7> · <pixel or UNMEASURED (reason)> · WITHIN | OUTSIDE(guard <label>) | UNDECLARED | UNMEASURED — <reason>
//
// then the tally and the three-line sufficiency contract. A covering row's guard runs on the tree EXPORTED at that height
// (`git archive <sha>` into a scratch directory, HEAD's node_modules linked in, removed after) — never a checkout, never a
// branch, never the working tree; a guard that cannot load there reads UNMEASURED, never OUTSIDE. --no-guards skips the
// export and every covering row reads UNMEASURED, never WITHIN. Nothing leaves the machine. Exit 0 with a block, never a
// stack trace; exit 2 only when the cwd is not a git repository.
//
// The reading is a DOOR: WHERE each commit landed is re-runnable (same bytes, same hash); WHETHER it was good is undecidable
// (Rice) and not claimed; the rows are the buyer's, not ours — the replay says which declared bound covered each commit, or
// that none did. A record the actor did not write exists; the replay reads it. That is all it says. Guard: tests/vna/c99d-replay-door.test.mjs.
//
//   npx thetacog-mcp replay --since <ref> [--to <ref>] [--spec <file>] [--repo <path>] [--rows-at <ref>] [--no-guards] [--json]
//   --since root   the whole history (a root commit has no parent boundary)
//   --rows-at <ref>  C92c: read the rows ONCE at that height (`git show <ref>:<spec>`) and hold every commit in the range
//                    against them — today's declared bounds over yesterday's commits. The default stays each commit's own
//                    height, where a commit older than the row's `paths:` is UNDECLARED by construction; the line names
//                    which was read. An unresolvable ref prints `rows UNMEASURED — <ref> does not resolve`, exit 0.
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { walkRepo, findSpec, runGuardAt } from './walk.mjs';
import { fullName } from '../../src/lib/pmu/declared-reading.mjs';

const a = process.argv.slice(2);
const val = (k) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] != null ? a[i + 1] : null; };
const has = (k) => a.includes(k);
const JSON_OUT = has('--json'); const NO_GUARDS = has('--no-guards');
const CWD = resolve(val('--repo') || process.cwd());
const U = 'UNMEASURED';
const WORDS = ['WITHIN', 'OUTSIDE', 'UNDECLARED', 'UNMEASURED'];
const SUFFICIENCY = {
  where: 'WHERE each landed is re-runnable — the same bytes through the same walk give the same hash; run it again.',
  whether: 'WHETHER it was good is undecidable (Rice) — not claimed here, not claimable from this record.',
  whose: "The rows are the buyer's, not ours — each line says which declared bound covered that commit, or that none did.",
};

const git = (repo, ...args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 30000 }).replace(/\n$/, ''); } catch { return null; } };

/** the commits of the range, oldest first: --since exclusive (or `root` for the whole history), --to inclusive (HEAD by default) */
export function rangeOf(repo, since, to = 'HEAD') {
  const toSha = git(repo, 'rev-parse', '--verify', '--quiet', `${to}^{commit}`);
  if (!toSha) return { shas: [], why: `--to ${to} does not resolve to a commit` };
  if (!since) return { shas: [], why: '--since <ref> is required — the range to replay (`root` for the whole history)' };
  if (since === 'root') return { shas: (git(repo, 'rev-list', '--reverse', toSha) || '').split('\n').filter(Boolean), why: null, base: null, to: toSha };
  const base = git(repo, 'rev-parse', '--verify', '--quiet', `${since}^{commit}`);
  if (!base) return { shas: [], why: `--since ${since} does not resolve to a commit in this repo` };
  return { shas: (git(repo, 'rev-list', '--reverse', `${base}..${toSha}`) || '').split('\n').filter(Boolean), why: null, base, to: toSha };
}

/** the tree at a height, exported once and lazily: git archive into a scratch dir, HEAD's node_modules linked in; { dir, ms } or { dir: null, why } */
function exportAt(repo, sha) {
  const t0 = performance.now();
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), `thetacog-replay-${sha.slice(0, 7)}-`));
    execFileSync('sh', ['-c', `git -C "$0" archive --format=tar "$1" | tar -x -C "$2"`, repo, sha, dir], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 600000, maxBuffer: 1024 * 1024 });
    const nm = join(repo, 'node_modules'); if (existsSync(nm) && !existsSync(join(dir, 'node_modules'))) { try { symlinkSync(nm, join(dir, 'node_modules'), 'dir'); } catch {} }
    return { dir, ms: +(performance.now() - t0).toFixed(1), why: null };
  } catch (e) { if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} } return { dir: null, ms: +(performance.now() - t0).toFixed(1), why: `the tree at ${sha.slice(0, 7)} could not be exported: ${String(e && e.message || e).split('\n')[0].slice(0, 120)}` }; }
}

const CANNOT_LOAD = /ERR_MODULE_NOT_FOUND|Cannot find (module|package)|SyntaxError|ERR_UNKNOWN_FILE_EXTENSION/;

/** one commit through the one door, against the rows at its height */
export function replayOne(top, sha, { specRel, guards = true, rowsText = undefined } = {}) {
  // rowsText (C92c): the spec's bytes read once at a fixed height, handed in by replayRange; undefined = this commit's own height
  const specText = rowsText !== undefined ? rowsText : specRel ? git(top, 'show', `${sha}:${specRel}`) : null;   // null = no spec at this height
  let exported = null; let exportMs = null;
  const runGuard = (guard) => {
    if (!exported) { exported = exportAt(top, sha); exportMs = exported.ms; }
    if (!exported.dir) return { status: 'unrun', ms: null, why: exported.why };
    const r = runGuardAt(exported.dir, guard);
    if (r.status === 'unrun') return { ...r, why: `the guard file is not in the tree at ${sha.slice(0, 7)}` };
    if (r.status === 'fail' && CANNOT_LOAD.test(String(r.why || ''))) return { status: 'unrun', ms: r.ms, why: `the guard could not load at ${sha.slice(0, 7)} — ${String(r.why).split('\n').filter(Boolean).slice(-1)[0].slice(0, 120)}` };
    return r;
  };
  let r;
  try { r = walkRepo({ repo: top, at: sha, specText, guards, runGuard }); }
  finally { if (exported && exported.dir) { try { rmSync(exported.dir, { recursive: true, force: true }); } catch {} } }
  if (!r.ok) return { sha, sha7: sha.slice(0, 7), subject: null, ok: false, why: r.why, spec_at_height: specText != null, placement: { status: U, why: r.why, pixel: null }, reading: { word: U, why: r.why }, wall: { ms: null, git_ms: null, guards_ms: null, export_ms: exportMs } };
  return { sha, sha7: sha.slice(0, 7), subject: r.head.subject, ok: true, paths: r.head.paths, mass: r.head.mass, spec_at_height: specText != null,
    placement: r.placement, reading: r.reading, wall: { ...r.wall, export_ms: exportMs } };
}

export function replayRange({ repo = CWD, since = null, to = 'HEAD', spec = null, guards = true, rowsAt = null, rowsText = undefined } = {}) {
  const t0 = performance.now();
  const top = git(repo, 'rev-parse', '--show-toplevel');
  if (!top) return { ok: false, exit: 2, repo, why: `${repo} is not inside a git repository — run the door from the repo whose commits you want re-read` };
  const range = rangeOf(top, since, to);
  const sp = findSpec(top, spec);
  const specRel = relative(top, sp.path).split('\\').join('/');
  // C92c: the rows at ONE height for every commit — `rowsAt` a ref (git show <ref>:<spec>, null = no spec there → UNDECLARED
  // with the reason), or `rowsText` the bytes themselves for a caller that already holds them; neither → each commit's own height
  let rowsWhy = null; let rowsAtSha = null;
  if (rowsText === undefined && rowsAt) {
    rowsAtSha = git(top, 'rev-parse', '--verify', '--quiet', `${rowsAt}^{commit}`);
    if (!rowsAtSha) rowsWhy = `--rows-at ${rowsAt} does not resolve to a commit in this repo — every line below reads the rows at its own height`;
    else rowsText = git(top, 'show', `${rowsAtSha}:${specRel}`);   // null when the spec is absent at that height
  }
  const commits = range.shas.map((sha) => replayOne(top, sha, { specRel, guards, rowsText }));
  const tally = { commits: commits.length, WITHIN: 0, OUTSIDE: 0, UNDECLARED: 0, UNMEASURED: 0, placed: 0, unplaced: 0 };
  for (const c of commits) { const w = String(c.reading.word).replace(/\(.*$/, ''); if (w in tally) tally[w]++; if (c.placement && c.placement.status === 'PLACED') tally.placed++; else tally.unplaced++; }
  return { ok: true, exit: 0, repo: top, since: since || null, to, base: range.base || null, range_why: range.why || null, spec: { path: sp.path, rel: specRel, how: sp.how, exists_at_head: sp.exists },
    rows_at: rowsText !== undefined ? (rowsAtSha ? `${rowsAt} (${rowsAtSha.slice(0, 7)})` : 'text handed in') : null, rows_why: rowsWhy,
    guards, commits, tally, wall: { total_ms: +(performance.now() - t0).toFixed(1) }, sufficiency: SUFFICIENCY,
    sufficientFor: 'WHERE each commit landed on the 144 lattice and WHICH declared bound covered it at that height', notFor: 'WHETHER the work was good (Rice) — not claimed' };
}

const shortPlacement = (p) => {
  if (!p) return `${U} (no reading)`;
  if (p.status === 'PLACED') return `${p.pixel} ${fullName(p.pixel)}${p.fit && Number.isFinite(p.fit.z) ? ` z ${p.fit.z.toFixed(2)}` : ''}`;
  const w = String(p.why || '');
  const reason = /binary absent/.test(w) ? 'binary absent' : /seed null/.test(w) ? `seed null not passed${p.nearest ? `, nearest ${p.nearest}` : ''}` : /refused/.test(w) ? 'the walk refused' : w.split(' — ')[0].slice(0, 60);
  return `${U} (${reason})`;
};

function render(r) {
  if (!r.ok) return ['thetacog replay — the door, not the defence', `range      ${U} — ${r.why}`, `tally      0 commits`, '', SUFFICIENCY.where, SUFFICIENCY.whether, SUFFICIENCY.whose].join('\n');
  const L = [];
  L.push(`thetacog replay — the door, not the defence · ${r.repo}`);
  L.push(`range      since ${r.since || '—'} → ${r.to}: ${r.tally.commits} commit${r.tally.commits === 1 ? '' : 's'}${r.range_why ? ` · ${U} — ${r.range_why}` : ''}`);
  L.push(`rows       ${r.spec.rel} ${r.rows_at ? `read at ${r.rows_at} for every commit (git show <ref>:<spec>)` : `read at each commit's height (git show <sha>:<spec>)`}${r.spec.exists_at_head ? '' : ' · absent at HEAD'}${r.rows_why ? ` · ${U} — ${r.rows_why}` : ''} · guards ${r.guards ? 'run on the tree exported at that height' : 'not run (--no-guards) — covering rows read UNMEASURED'}`);
  L.push('');
  for (const c of r.commits) L.push(`${c.sha7} · ${shortPlacement(c.placement)} · ${c.reading.word} — ${c.reading.why}${c.spec_at_height ? '' : ` (no ${r.spec.rel} at this height)`}`);
  if (!r.commits.length) L.push(`(no commits in the range)`);
  L.push('');
  L.push(`tally      ${r.tally.commits} commit${r.tally.commits === 1 ? '' : 's'} · ${WORDS.map((w) => `${w} ${r.tally[w]}`).join(' · ')} · placed ${r.tally.placed} / unplaced ${r.tally.unplaced} · ${r.wall.total_ms} ms total`);
  L.push('');
  L.push(SUFFICIENCY.where); L.push(SUFFICIENCY.whether); L.push(SUFFICIENCY.whose);
  return L.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  let r;
  try { r = replayRange({ repo: CWD, since: val('--since'), to: val('--to') || 'HEAD', spec: val('--spec'), guards: !NO_GUARDS, rowsAt: val('--rows-at') }); }
  catch (e) { r = { ok: false, exit: 2, repo: CWD, why: `the door could not read this repo: ${String(e && e.message || e).split('\n')[0].slice(0, 160)}` }; }
  if (JSON_OUT) console.log(JSON.stringify(r, null, 1)); else console.log(render(r));
  process.exitCode = r.exit;
}
