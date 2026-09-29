#!/usr/bin/env node
// scripts/pmu/walk.mjs — C92d THE ONE-MINUTE DOOR: `npx thetacog-mcp walk` on the buyer's HEAD (2026-09-19).
// =============================================================================================
// Runs in ANY repo that installed the package. Reads the caller's HEAD — the commit range since `--since` (default the
// parent), its paths, its mass — runs the ONE Rust walk on it through the ONE door (src/lib/pmu/walk-door.mjs, the binary
// resolved by src/lib/pmu/pmu-binary.mjs exactly as every other packaged door resolves it: the prebuilt at
// the package ships under <pkg>/.thetacog/pmu/, else UNMEASURED with the reason — no path of its own), and prints ONE block:
//
//   HEAD       <sha>  <subject>  · since <ref>: N commits · M paths · mass K chars / G gzip
//   placement  A1,C  A1.Strategy.Law × C.Operations  · σ 2.68 · z 2.9 admitted        | UNMEASURED — <reason>
//   reading    UNDECLARED — no spec rows in this repo …                                 | WITHIN | OUTSIDE(guard C1) | UNMEASURED — <reason>
//   wall       <ms> ms walk (read from the receipt) · <ms> git · <ms> guards
//   declare    add to <spec>:  - [ ] C1 (guard: `tests/c1.test.mjs`) paths: `src/**` <what must hold>
//
// UNDECLARED is the first thing a stranger's repo says: nothing declared covers the change, and that absence is the fact on
// the receipt. The reading is src/lib/pmu/declared-reading.mjs (shipped, pure): a row's `paths:` globs cover the changed
// files; the covering rows' guards are run here with `node --test` at HEAD (--no-guards skips them → UNMEASURED, never
// WITHIN). WHERE this landed is re-runnable — same bytes, same hash; WHETHER it is correct is undecidable (Rice) and not
// claimed; WHICH declared bound covered it, or that none did, is the third line. Nothing leaves the machine: no socket,
// no model, no tape row (source lens-cli keeps it off the live tape). Exit 0 with a block, never a stack trace; exit 2 only
// when the cwd is not a git repository. Guard: tests/vna/c92-one-minute-door.test.mjs.
//
//   npx thetacog-mcp walk [--since <ref>] [--spec <file>] [--repo <path>] [--no-guards] [--json]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { lensWalk, LENS_TEXT_MAX_COMMIT } from '../../src/lib/pmu/walk-door.mjs';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';
import { declaredRows, coveredBy, readingOf, fullName } from '../../src/lib/pmu/declared-reading.mjs';

const a = process.argv.slice(2);
const val = (k) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] != null ? a[i + 1] : null; };
const has = (k) => a.includes(k);
const JSON_OUT = has('--json'); const NO_GUARDS = has('--no-guards');
const CWD = resolve(val('--repo') || process.cwd());
const U = 'UNMEASURED';
const SPEC_CANDIDATES = ['docs/specs/vna/SPEC-VNA-COCKPIT.md', '.thetacog/SPEC.md', 'SPEC.md', 'docs/specs/SPEC.md', 'docs/SPEC.md'];
const DIFF_CAP = 200_000;

const git = (repo, ...args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 30000 }).replace(/\n$/, ''); } catch { return null; } };

/** the spec file a buyer's repo declares its rows in — --spec, THETACOG_SPEC, then the first candidate on disk, then any docs/specs/<sub>/SPEC*.md */
export function findSpec(repo, explicit = null) {
  if (explicit) return { path: resolve(repo, explicit), exists: existsSync(resolve(repo, explicit)), how: '--spec' };
  if (process.env.THETACOG_SPEC) return { path: resolve(repo, process.env.THETACOG_SPEC), exists: existsSync(resolve(repo, process.env.THETACOG_SPEC)), how: 'THETACOG_SPEC' };
  for (const c of SPEC_CANDIDATES) if (existsSync(join(repo, c))) return { path: join(repo, c), exists: true, how: 'found' };
  try { const d = join(repo, 'docs/specs'); for (const sub of ['', ...readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name)]) { const dir = join(d, sub); const f = readdirSync(dir).find((x) => /^SPEC.*\.md$/i.test(x)); if (f) return { path: join(dir, f), exists: true, how: 'found' }; } } catch {}
  return { path: join(repo, 'docs/specs/SPEC.md'), exists: false, how: 'none' };
}

/** the caller's HEAD (or `at`, C99d's replay reads one commit at a time): sha, subject, the range since --since (parent by default), the changed paths, the text the walk reads */
export function readHead(repo, since = null, at = 'HEAD') {
  const sha = git(repo, 'rev-parse', '--verify', `${at}^{commit}`);
  if (!sha) return { sha: null, subject: null, since: null, commits: 0, paths: [], text: '', why: at === 'HEAD' ? 'no commit at HEAD — the repo has no commits yet' : `${at} does not resolve to a commit` };
  const subject = git(repo, 'log', '-1', '--format=%s', sha) || '';
  const parent = git(repo, 'rev-parse', '--verify', '--quiet', `${sha}~1`);
  let base = since ? git(repo, 'rev-parse', '--verify', '--quiet', `${since}^{commit}`) : parent;
  let sinceWhy = null;
  if (since && !base) { sinceWhy = `--since ${since} does not resolve — walked from the root`; base = null; }
  const range = base ? `${base}..${sha}` : sha;
  const commits = base ? Number(git(repo, 'rev-list', '--count', range) || 0) : Number(git(repo, 'rev-list', '--count', sha) || 1);
  const paths = (base ? git(repo, 'diff', '--name-only', base, sha) : git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha)) || '';
  const pathList = paths.split('\n').map((s) => s.trim()).filter(Boolean);
  const log = (base ? git(repo, 'log', '--format=%s%n%b', range) : git(repo, 'log', '--format=%s%n%b', sha)) || '';
  const diff = (base ? git(repo, 'diff', base, sha) : git(repo, 'show', '--format=', '--root', sha)) || '';
  const text = [log.trim(), pathList.join('\n'), diff.slice(0, DIFF_CAP)].filter(Boolean).join('\n\n');
  return { sha, subject, since: base ? (since || `${sha.slice(0, 10)}~1`) : (since || 'root'), sinceWhy, commits, paths: pathList, text, why: null };
}

/** one guard, in the buyer's repo, at HEAD: node --test <guard> — pass | fail with ms; the only child process on the reading's path */
export function runGuardAt(repo, guard, { timeoutMs = 180000 } = {}) {
  const abs = resolve(repo, guard);
  if (!existsSync(abs)) return { status: 'unrun', ms: null, why: 'the guard file is not on disk at HEAD' };
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;   // node --test inside node --test
  const t0 = performance.now();
  try { execFileSync('node', ['--test', guard], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env }); return { status: 'pass', ms: +(performance.now() - t0).toFixed(1), why: null }; }
  catch (e) { return { status: 'fail', ms: +(performance.now() - t0).toFixed(1), why: (String(e.stdout || '') + String(e.stderr || '')).slice(-200) || null, exit: e.status ?? null }; }
}

// `at` reads a commit other than HEAD; `specText` hands in the spec's bytes at that height (null = no spec there) instead of the
// file on disk; `runGuard(guard)` replaces runGuardAt(top, guard) so a guard can run on the tree AT that height — all three are
// C99d's replay reading one commit against the rows declared at ITS height, through this one function.
export function walkRepo({ repo = CWD, since = null, spec = null, guards = true, at = 'HEAD', specText = undefined, runGuard = null } = {}) {
  const t0 = performance.now();
  const top = git(repo, 'rev-parse', '--show-toplevel');
  if (!top) return { ok: false, exit: 2, repo, why: `${repo} is not inside a git repository — run the door from the repo whose HEAD you want read` };
  const head = readHead(top, since, at);
  const gitMs = +(performance.now() - t0).toFixed(1);
  const mass = { chars: head.text.length, gzip: head.text ? gzipSync(Buffer.from(head.text)).length : 0 };
  // THE WALK — the one door, the one resolver; source lens-cli keeps this off the live tape (nothing written, nothing sent)
  let placement;
  if (!head.sha) placement = { status: U, why: head.why, pixel: null, name: null, sigma: null, fit: null, nearest: null, bin: null, ms: null };
  else {
    const { row } = lensWalk(head.text, { source: 'lens-cli', ref: head.sha, maxChars: LENS_TEXT_MAX_COMMIT, digest: 'head', timeoutMs: 120000 });
    const bin = row.bin || null; const binAbs = resolvePmuBinary();
    const absent = row.err === 'binary absent';   // no walk ran: the wall time is null, never a zero
    const why = absent ? `binary absent — no pmu-onchip at ${binAbs} (the prebuilt ships for macOS arm64; \`npx thetacog-pmu-rust --help\` builds it from the bundled source)`
      : row.err ? `the walk refused: ${row.err}`
      : !row.admissible ? `seed null test not passed (z ${row.fit && Number.isFinite(row.fit.z) ? row.fit.z.toFixed(2) : U}, gain ${row.fit && Number.isFinite(row.fit.gain) ? row.fit.gain.toFixed(3) : U})${row.pixel ? ` — nearest cell ${row.pixel} ${fullName(row.pixel)}, not admitted` : ''}`
      : null;
    placement = why ? { status: U, why, pixel: null, name: null, sigma: null, fit: row.fit || null, nearest: row.pixel || null, bin, bin_sha: row.bin_sha || null, ms: absent ? null : row.ms, aperture: row.aperture_id || null }
      : { status: 'PLACED', why: null, pixel: row.pixel, name: fullName(row.pixel), sigma: row.sigma ?? null, fit: row.fit, nearest: null, bin, bin_sha: row.bin_sha || null, ms: row.ms, aperture: row.aperture_id || null, off_pct: row.off_pct ?? null };
  }
  // THE READING — the rows the buyer declared, the paths they cover, the guards run at HEAD
  const sp = findSpec(top, spec);
  const rows = specText !== undefined ? (specText == null ? [] : declaredRows(specText)) : sp.exists ? declaredRows(readFileSync(sp.path, 'utf8')) : [];
  const g0 = performance.now(); const results = {};
  if (rows.length && head.paths.length) {
    const { byRow } = coveredBy(head.paths, rows);   // the same cover the reading takes — one glob, one place
    for (const label of byRow.keys()) { const r = rows.find((x) => x.label === label); if (r && r.guard) results[label] = guards ? (runGuard ? runGuard(r.guard) : runGuardAt(top, r.guard)) : { status: "unrun", ms: null, why: "not run (--no-guards)" }; }
  }
  const guardsMs = +(performance.now() - g0).toFixed(1);
  const reading = readingOf({ rows, changed: head.paths, results });
  const declare = { spec: sp.path, exists: sp.exists, command: `- [ ] C1 (guard: \`tests/c1.test.mjs\`) paths: \`src/**\` <the one sentence that must hold>` };
  return { ok: true, exit: 0, repo: top, head: { sha: head.sha, subject: head.subject, since: head.since, since_why: head.sinceWhy || null, commits: head.commits, paths: head.paths.length, mass }, placement, reading,
    wall: { ms: placement.ms, git_ms: gitMs, guards_ms: guardsMs, total_ms: +(performance.now() - t0).toFixed(1) }, declare,
    sufficientFor: 'WHERE this change landed on the 144 lattice and WHICH declared bound covered it', notFor: 'WHETHER the code is correct (Rice) — not claimed' };
}

function render(r) {
  if (!r.ok) return [`thetacog walk — the one-minute door`, `HEAD       ${U} — ${r.why}`, `placement  ${U} — no repo to read`, `reading    UNDECLARED — no repo, no rows`, ''].join('\n');
  const L = [];
  const h = r.head;
  L.push(`thetacog walk — the one-minute door · ${r.repo}`);
  L.push(`HEAD       ${h.sha || U + ' — no commits'}  ${h.subject ? h.subject.slice(0, 72) : ''}`.trimEnd());
  L.push(`           since ${h.since || '—'}: ${h.commits} commit${h.commits === 1 ? '' : 's'} · ${h.paths} path${h.paths === 1 ? '' : 's'} · mass ${h.mass.chars} chars / ${h.mass.gzip} gzip${h.since_why ? ` · ${h.since_why}` : ''}`);
  const p = r.placement;
  L.push(p.status === 'PLACED'
    ? `placement  ${p.pixel}  ${p.name}  · σ ${p.sigma != null ? Number(p.sigma).toFixed(2) : U} · z ${p.fit && Number.isFinite(p.fit.z) ? p.fit.z.toFixed(2) : U} admitted${p.off_pct != null ? ` · off-lane ${p.off_pct}%` : ''}`
    : `placement  ${U} — ${p.why}`);
  const rd = r.reading;
  L.push(`reading    ${rd.word} — ${rd.why}`);
  for (const g of rd.guards || []) L.push(`           ${g.label} ${g.guard || '(no guard)'} → ${g.status}${g.ms != null ? ` ${g.ms} ms` : ''}${g.why && g.status !== 'pass' ? ` · ${String(g.why).split('\n').filter(Boolean).slice(-1)[0] || ''}` : ''}`);
  L.push(`wall       ${r.wall.ms == null ? 'no walk ran' : r.wall.ms + ' ms walk (read from the receipt)'} · ${r.wall.git_ms} ms git · ${r.wall.guards_ms} ms guards · ${r.wall.total_ms} ms total`);
  L.push(`declare    ${r.declare.exists ? `add a row to ${r.declare.spec}` : `create ${r.declare.spec} with a row`}:`);
  L.push(`           ${r.declare.command}`);
  L.push(`           then \`npx thetacog-mcp walk\` again — the reading turns WITHIN or OUTSIDE(guard C1) on the next commit that touches those paths`);
  L.push('');
  L.push(`WHERE this landed is re-runnable (same bytes, same hash); WHETHER it is correct is undecidable (Rice) and not claimed; WHICH declared bound covered it: ${rd.guards && rd.guards.length ? rd.guards.map((g) => g.label).join(', ') : 'none'}.`);
  return L.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  let r;
  try { r = walkRepo({ repo: CWD, since: val('--since'), spec: val('--spec'), guards: !NO_GUARDS }); }
  catch (e) { r = { ok: false, exit: 2, repo: CWD, why: `the door could not read this repo: ${String(e && e.message || e).split('\n')[0].slice(0, 160)}` }; }
  if (JSON_OUT) console.log(JSON.stringify(r, null, 1)); else console.log(render(r));
  process.exitCode = r.exit;
}
