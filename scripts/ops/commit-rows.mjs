#!/usr/bin/env node
// commit-rows.mjs — C195: commit ONLY the named spec rows, never the rest of a shared file.
//
// THE INCIDENT (2026-09-23, four times in one night): several rooms edit docs/specs/vna/SPEC-VNA-COCKPIT.md at once. `git add` then
// `git commit` let another room's commit take the staged index; `git commit --only <spec>` fixed that but committed the WHOLE file as
// it stood — every other room's uncommitted rows rode along under one message (C176d landed inside the C184a research commit). A
// commit whose message describes work it does not contain places wrong, and the placement is the product.
//
// THE MECHANISM: build the blob HEAD's file + ONLY the named rows' changes (a row is the line starting `- [ ] C<id>` / `- [x] C<id>`,
// at any indent), write it with `git hash-object -w`, commit it through a PRIVATE index (GIT_INDEX_FILE = a temp file seeded from HEAD),
// then point the real index's entry for that one path at the new HEAD blob so nothing looks staged. The working tree is never touched:
// other rooms' rows stay exactly where they are, uncommitted, for their own commit. Hooks run (no --no-verify).
//
//   node scripts/ops/commit-rows.mjs --file docs/specs/vna/SPEC-VNA-COCKPIT.md --rows C176d,C195 -m "message"   [--dry-run]
//   node scripts/ops/commit-rows.mjs --paths a.mjs,tests/b.test.mjs -m "message"   (whole files, same race-free door)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const rowId = (line) => { const m = line.match(/^\s*- \[[ x~]\] (C\d+[a-z]?)\b/); return m ? m[1] : null; };

// HEAD's lines with only the named rows changed/inserted as they stand in the working tree
export function scopedContent(headText, workText, ids) {
  const want = new Set(ids); const head = headText.split('\n'); const work = workText.split('\n');
  const headIdx = new Map(); head.forEach((l, i) => { const id = rowId(l); if (id && !headIdx.has(id)) headIdx.set(id, i); });
  const out = [...head]; const applied = []; const missing = [];
  for (const id of want) {
    const wi = work.findIndex((l) => rowId(l) === id); if (wi < 0) { missing.push(id); continue; }
    if (headIdx.has(id)) { out[out.indexOf(head[headIdx.get(id)])] = work[wi]; applied.push({ id, how: 'replaced' }); continue; }
    // a new row: insert after the nearest preceding working-tree line that already exists in the output
    let anchor = -1; for (let k = wi - 1; k >= 0; k--) { const at = out.indexOf(work[k]); if (at >= 0) { anchor = at; break; } }
    out.splice(anchor + 1, 0, work[wi]); applied.push({ id, how: anchor >= 0 ? 'inserted' : 'inserted-at-top' });
  }
  return { text: out.join('\n'), applied, missing };
}

// C195c — BIFURCATION ROWS (data/room-bifurcations.json), keyed by bf id + created_at. Every writer shares that one file (the
// triptych's QC emitter, `bifurcate --session` dispatches, hand back-fills), so a writer commits HEAD's store plus ONLY its own rows.
// The store is JSON.stringify(…, null, 2) + '\n' (bifurcate saveStore), which round-trips byte-identical, so the blob differs from
// HEAD by exactly the named rows. @guard tests/ops/c195c-commit-rows-takes-only-the-named-bifurcations.test.mjs
const bfKey = (b) => `${b.id}|${b.created_at}`;
// C195d: a pickup MOVES a row (bifurcate splices it out of `bifurcations` onto `picked_up` / `executed`), so every array-valued
// section of the store is searched, and a row is committed in the section it now sits in — HEAD's copy leaves its old section.
const sections = (store) => Object.keys(store).filter((k) => Array.isArray(store[k]));
const locate = (store) => { const m = new Map(); for (const k of sections(store)) store[k].forEach((b, i) => { if (b && b.id) m.set(bfKey(b), { k, i, b }); }); return m; };
export function scopedBifurcations(headText, workText, ids) {
  const head = JSON.parse(headText); const work = JSON.parse(workText); const want = new Set(ids);
  head.bifurcations = head.bifurcations || [];
  const was = locate(head); const applied = []; const found = new Set();
  for (const { k, b } of locate(work).values()) {
    if (!want.has(b.id)) continue; found.add(b.id);
    const prior = was.get(bfKey(b));
    if (prior && prior.k === k) { head[k][head[k].indexOf(prior.b)] = b; applied.push({ id: b.id, how: 'replaced', section: k }); continue; }
    if (prior) head[prior.k].splice(head[prior.k].indexOf(prior.b), 1);
    (head[k] = head[k] || []).push(b);
    applied.push({ id: b.id, how: prior ? `moved from ${prior.k}` : 'appended', section: k });
  }
  return { text: JSON.stringify(head, null, 2) + '\n', applied, missing: [...want].filter((id) => !found.has(id)) };
}
// the rows HEAD does not hold as they now stand — absent from HEAD, or sitting in another section there — optionally one writer's (match)
export function uncommittedBifurcations({ repo = process.cwd(), file = 'data/room-bifurcations.json', match = null } = {}) {
  let headText = '{}'; try { headText = git(['show', `HEAD:${file}`], { cwd: repo }); } catch { /* new file */ }
  const inHead = locate(JSON.parse(headText));
  return [...locate(JSON.parse(readFileSync(resolve(repo, file), 'utf8'))).values()]
    .filter(({ k, b }) => { const h = inHead.get(bfKey(b)); return (!h || h.k !== k) && (!match || match(b)); }).map(({ b }) => b.id);
}

// TWO RACES, BOTH MEASURED 2026-09-23 on this tree:
//  (1) another room commits while our hooks run — git's ref lock refuses our stale parent. Rebuild from the NEW HEAD, retry, never force.
//  (2) every `git commit` in the repo writes and re-reads ONE shared .git/COMMIT_EDITMSG around ~40 s of hooks, so two concurrent
//      commits swap messages: ac965190a6 carries this script's "tick C195 and C187b" message over a worker's e2e test re-pin, and the
//      tick itself never landed. So this script does not call `git commit`: it runs the SAME hooks itself against a PRIVATE message
//      file (the hooks take the path as $1), writes the tree from the private index, `git commit-tree`, and moves HEAD with a
//      compare-and-swap `git update-ref HEAD <new> <old>` — a parent that moved is a retry, never an overwrite. Hooks still run.
// THE SHARED INDEX MUST FOLLOW THE NEW HEAD, OR THE NEXT WHOLE-INDEX COMMIT REVERTS US (C195b, 2026-09-23): the commit goes
// through a private index, so the real index still holds the path's PRE-commit blob until it is realigned. A realign that lost
// to another process's .git/index.lock left four such entries, and panel-repair's unscoped `git commit` (51bcb741cb) shipped them —
// reverting C176e and two C196 fixes. So: retry while the lock is held, then VERIFY the entry equals HEAD, and throw loudly otherwise.
export function realignIndex(repo, paths, { tries = 600, waitMs = 500 } = {}) {   // 5 min: under load a sibling realign or `git diff --numstat` holds the lock for 30 s+ (measured 2026-09-23)
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let i = 1; ; i++) {
    try { git(['reset', '-q', '--', ...paths], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
      if (i < tries && /index\.lock|File exists/.test(String(e.stderr || e.message))) { sleep(waitMs); continue; }
      throw new Error(`committed, but the shared index still holds the old blob for ${paths.join(' ')} — run: git reset -q -- ${paths.join(' ')}   (${String(e.stderr || e.message).trim()})`);
    }
    try { git(['diff', '--cached', '--quiet', 'HEAD', '--', ...paths], { cwd: repo }); return; }
    catch { if (i < tries) { sleep(waitMs); continue; } throw new Error(`the shared index still differs from HEAD for ${paths.join(' ')} after ${tries} tries`); }
  }
}

const hooksDir = (repo) => { let d = ''; try { d = git(['config', 'core.hooksPath'], { cwd: repo }).trim(); } catch { /* default */ }
  return d ? resolve(repo, d) : resolve(repo, git(['rev-parse', '--git-path', 'hooks'], { cwd: repo }).trim()); };
function runHook(repo, name, args, env) {
  const h = join(hooksDir(repo), name); if (!existsSync(h)) return;
  execFileSync(h, args, { cwd: repo, env, stdio: ['ignore', 'inherit', 'inherit'] });   // a non-zero hook throws: the commit does not happen
}

export function commitRows(opts) {
  for (let attempt = 1; ; attempt++) {
    const r = commitRowsOnce(opts); if (r !== RETRY) return r;
    if (attempt >= 5) throw new Error('HEAD kept moving under the commit (5 attempts) — nothing was written; run it again');
  }
}
const RETRY = Symbol('retry');

// WHOLE FILES through the same race-free door (tests, scripts): each named path's working-tree bytes, or its deletion.
export function commitPaths({ paths, message, repo = process.cwd(), dryRun = false }) {
  for (let attempt = 1; ; attempt++) {
    const r = landTree({ repo, message, dryRun, build: (old) => paths.map((rel) => {
      const abs = resolve(repo, rel); if (!existsSync(abs)) return { rel, del: true };
      return { rel, blob: git(['hash-object', '-w', '--', rel], { cwd: repo }).trim(), mode: (statSync(abs).mode & 0o111) ? '100755' : '100644' };
    }) });
    if (r !== RETRY) return r;
    if (attempt >= 5) throw new Error('HEAD kept moving under the commit (5 attempts) — nothing was written; run it again');
  }
}

function commitRowsOnce({ file, rows, bf = null, message, repo = process.cwd(), dryRun = false }) {
  const rel = file; const old = git(['rev-parse', 'HEAD'], { cwd: repo }).trim();
  const headText = git(['show', `${old}:${rel}`], { cwd: repo }); const workText = readFileSync(resolve(repo, rel), 'utf8');
  const { text, applied, missing } = bf ? scopedBifurcations(headText, workText, bf) : scopedContent(headText, workText, rows);
  if (missing.length) throw new Error(`rows not in the working tree: ${missing.join(' ')}`);
  if (text === headText) return { committed: false, why: 'the named rows already match HEAD', applied };
  if (dryRun) return { committed: false, dryRun: true, applied, bytes: text.length - headText.length };
  const blob = git(['hash-object', '-w', '--stdin'], { cwd: repo, input: text }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'commit-rows-')); const idx = join(dir, 'index'); const msg = join(dir, 'MSG');
  let sha;
  try {
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    git(['read-tree', old], { cwd: repo, env });
    const mode = git(['ls-tree', old, rel], { cwd: repo }).split(/\s+/)[0] || '100644';
    git(['update-index', '--cacheinfo', `${mode},${blob},${rel}`], { cwd: repo, env });
    writeFileSync(msg, message.endsWith('\n') ? message : message + '\n');
    runHook(repo, 'pre-commit', [], env);
    runHook(repo, 'prepare-commit-msg', [msg, 'message'], env);
    runHook(repo, 'commit-msg', [msg], env);
    const tree = git(['write-tree'], { cwd: repo, env }).trim();
    sha = git(['commit-tree', tree, '-p', old, '-F', msg], { cwd: repo }).trim();
    const subject = readFileSync(msg, 'utf8').split('\n')[0];
    try { git(['update-ref', '-m', `commit: ${subject}`, 'HEAD', sha, old], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { return RETRY; }                                   // HEAD moved under us: our commit object is orphaned, nothing is lost
  } finally { rmSync(dir, { recursive: true, force: true }); }
  realignIndex(repo, [rel]);                                  // the real index's entry follows the new HEAD (verified); the working tree is untouched
  runHook(repo, 'post-commit', [], process.env);
  return { committed: true, sha: sha.slice(0, 10), applied };
}

function landTree({ repo, message, dryRun, build }) {
  const old = git(['rev-parse', 'HEAD'], { cwd: repo }).trim(); const entries = build(old);
  if (dryRun) return { committed: false, dryRun: true, paths: entries.map((e) => e.rel) };
  const dir = mkdtempSync(join(tmpdir(), 'commit-paths-')); const idx = join(dir, 'index'); const msg = join(dir, 'MSG'); let sha;
  try {
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    git(['read-tree', old], { cwd: repo, env });
    for (const e of entries) {
      if (e.del) git(['update-index', '--force-remove', '--', e.rel], { cwd: repo, env });
      else git(['update-index', '--add', '--cacheinfo', `${e.mode},${e.blob},${e.rel}`], { cwd: repo, env });
    }
    writeFileSync(msg, message.endsWith('\n') ? message : message + '\n');
    runHook(repo, 'pre-commit', [], env); runHook(repo, 'prepare-commit-msg', [msg, 'message'], env); runHook(repo, 'commit-msg', [msg], env);
    const tree = git(['write-tree'], { cwd: repo, env }).trim();
    if (tree === git(['rev-parse', `${old}^{tree}`], { cwd: repo }).trim()) return { committed: false, why: 'the named paths already match HEAD' };
    sha = git(['commit-tree', tree, '-p', old, '-F', msg], { cwd: repo }).trim();
    try { git(['update-ref', '-m', `commit: ${readFileSync(msg, 'utf8').split('\n')[0]}`, 'HEAD', sha, old], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { return RETRY; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  realignIndex(repo, entries.map((e) => e.rel));
  runHook(repo, 'post-commit', [], process.env);
  return { committed: true, sha: sha.slice(0, 10), paths: entries.map((e) => e.rel) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const pathsArg = arg('--paths');
  if (pathsArg) { const message = arg('-m') || arg('--message'); if (!message && !argv.includes('--dry-run')) { console.error('usage: commit-rows.mjs --paths a,b -m "msg"'); process.exit(2); }
    console.log(JSON.stringify(commitPaths({ paths: pathsArg.split(',').filter(Boolean), message, dryRun: argv.includes('--dry-run') }))); process.exit(0); }
  const bfArg = arg('--bf');
  if (bfArg) { const message = arg('-m') || arg('--message'); if (!message && !argv.includes('--dry-run')) { console.error('usage: commit-rows.mjs --bf bf-1,bf-2 -m "msg" [--file data/room-bifurcations.json]'); process.exit(2); }
    console.log(JSON.stringify(commitRows({ file: arg('--file') || 'data/room-bifurcations.json', bf: bfArg.split(',').filter(Boolean), message, dryRun: argv.includes('--dry-run') }))); process.exit(0); }
  const file = arg('--file') || 'docs/specs/vna/SPEC-VNA-COCKPIT.md'; const rows = String(arg('--rows') || '').split(',').filter(Boolean);
  const message = arg('-m') || arg('--message');
  if (!rows.length || (!message && !argv.includes('--dry-run'))) { console.error('usage: commit-rows.mjs --rows C1,C2 -m "msg" [--file <path>] [--dry-run]'); process.exit(2); }
  const out = commitRows({ file, rows, message, dryRun: argv.includes('--dry-run') });
  console.log(JSON.stringify(out));
}
