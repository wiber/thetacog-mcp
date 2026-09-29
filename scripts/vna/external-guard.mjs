// scripts/vna/external-guard.mjs — C474 A GUARD THAT LIVES IN A SIBLING REPO. A spec row may name its acceptance
// in another checkout (`../IntentGuard/tests/cross_arch.rs`): the proof of the IntentGuard crate lives in the
// IntentGuard repo. Both doors that read a guard — steer-follow-through.mjs (`steer.mjs verify`) and spec-check's
// `toggle` — route such a path here, so there is one answer to "is that guard green" and not two.
//
// THE RULES, the same ones the in-repo path keeps:
//   · the guard runs on the sibling's COMMIT, never its working tree (AXIOM 1 W3 / C178a) — the commit is
//     extracted with `git archive` into a temp dir, so neither checkout is ever touched or dirtied;
//   · `.rs` → `cargo test --release --test <stem>` (target dir cached under ~/.cache, outside both repos);
//     `.mjs`/`.js` → `node --test`;
//   · the red witness runs the guard AS IT STANDS AT HEAD against the witness commit's PARENT tree — a guard
//     that passes there proves nothing (C283), and one that cannot compile there is red, as a missing import is.
//
// @guard tests/vna/c474-verify-external-guard.test.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import os from 'node:os';

/** `../<repo>/<rel>` → { extRepo, rel, kind, name }; anything else → null (an in-repo guard, untouched). */
export function parseExternal(guard, repo) {
  const m = /^\.\.\/([^/]+)\/(.+)$/.exec(String(guard || ''));
  if (!m) return null;
  const rel = m[2];
  const kind = /\.rs$/.test(rel) ? 'cargo' : /\.m?js$/.test(rel) ? 'node' : null;
  return { name: m[1], extRepo: resolve(repo, '..', m[1]), rel, kind };
}

/** cargo test's summary lines → { state: green|red|hollow, pass, fail, detail }. A compile error is red. */
export function parseCargoSummary(out) {
  const s = String(out || '');
  let pass = 0, fail = 0, lines = 0;
  for (const m of s.matchAll(/test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/g)) { lines++; pass += +m[2]; fail += +m[3]; }
  if (/error(\[E\d+\])?: |could not compile/.test(s) && !lines) return { state: 'red', pass: 0, fail: 0, detail: 'does not compile' };
  if (/no test target named/.test(s)) return { state: 'red', pass: 0, fail: 0, detail: 'the test target does not exist' };
  if (fail > 0) {
    const failing = [...s.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((x) => x[1]);
    return { state: 'red', pass, fail, detail: failing.join(' · ') || `${fail} failed` };
  }
  if (!lines || pass === 0) return { state: 'hollow', pass, fail, detail: 'ran no passing test' };
  return { state: 'green', pass, fail, detail: `${pass} passed` };
}

function git(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function tryGit(repo, ...args) { try { return git(repo, ...args); } catch { return null; } }

/**
 * Run the sibling guard on `commit`'s tree. With `guardFrom`, the guard FILE is taken from that commit instead
 * (the red witness: HEAD's guard against an older tree). Returns { state, detail, pass, commit }.
 */
export function runExternalGuard({ extRepo, rel, kind, name }, { commit = 'HEAD', guardFrom = null, targetDir, timeoutMs = 900000 } = {}) {
  if (!existsSync(resolve(extRepo, '.git'))) return { state: 'unmeasured', detail: `no sibling checkout at ${extRepo}` };
  if (!kind) return { state: 'unmeasured', detail: `no runner for ${rel} (only .rs and .mjs/.js)` };
  const sha = tryGit(extRepo, 'rev-parse', commit);
  if (!sha) return { state: 'unmeasured', detail: `${name}: no commit ${commit}` };
  const src = guardFrom || sha;
  if (tryGit(extRepo, 'cat-file', '-e', `${src}:${rel}`) === null) return { state: 'not-committed', detail: `${name}/${rel} is not committed at ${src.slice(0, 10)}` };
  const dir = mkdtempSync(join(os.tmpdir(), `vna-extguard-${name}-`));
  try {
    // tar -m: every extracted file gets NOW as its mtime. git archive stamps files with the COMMIT's time, so an older
    // commit's sources look older than the test binary a newer commit already left in the shared CARGO_TARGET_DIR, and
    // cargo reruns that stale binary as if it were this tree's (C460's witness read GREEN-ON-PARENT on a parent with no
    // card() to compile). Fresh mtimes force the local crate to rebuild; registry dependencies stay cached.
    execFileSync('bash', ['-c', `git -C '${extRepo}' archive ${sha} | tar -x -m -C '${dir}'`], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (guardFrom) { mkdirSync(dirname(resolve(dir, rel)), { recursive: true }); writeFileSync(resolve(dir, rel), execFileSync('git', ['-C', extRepo, 'show', `${guardFrom}:${rel}`])); }
    let out = '';
    if (kind === 'cargo') {
      const env = { ...process.env, CARGO_TARGET_DIR: targetDir || resolve(os.homedir(), '.cache', 'vna-external-guard', name) };
      try { out = execFileSync('cargo', ['test', '--release', '--test', basename(rel, '.rs')], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs }); }
      catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
      return { ...parseCargoSummary(out), commit: sha };
    }
    const nm = resolve(extRepo, 'node_modules'); if (existsSync(nm)) { try { execFileSync('ln', ['-s', nm, resolve(dir, 'node_modules')]); } catch { /* best effort */ } }
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
    try {
      out = execFileSync('node', ['--test', '--test-reporter=tap', rel], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
      const pass = +(/^# pass (\d+)/m.exec(out) || [0, 0])[1];
      return pass ? { state: 'green', pass, fail: 0, detail: `${pass} passed`, commit: sha } : { state: 'hollow', pass: 0, fail: 0, detail: 'ran no passing test', commit: sha };
    } catch (e) {
      out = String(e.stdout || '') + String(e.stderr || '');
      const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
      return { state: 'red', pass: 0, fail: failing.length || 1, detail: failing.join(' · ') || 'failed', commit: sha };
    }
  } catch (e) {
    return { state: 'unmeasured', detail: `could not extract ${name}@${sha.slice(0, 10)}: ${String(e.stderr || e.message).slice(0, 160)}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The red witness for a sibling guard: HEAD's guard file against `witness`~1. RED | GREEN-ON-PARENT | UNMEASURED. */
export function externalWitness(ext, { witness, targetDir } = {}) {
  const w = witness || (tryGit(ext.extRepo, 'log', '--diff-filter=A', '--format=%H', '--', ext.rel) || '').split('\n').filter(Boolean).pop();
  if (!w) return { verdict: 'UNMEASURED', why: `no commit adds ${ext.name}/${ext.rel} — name one: --witness <sha>` };
  const parent = tryGit(ext.extRepo, 'rev-parse', `${w}~1`);
  if (!parent) return { verdict: 'UNMEASURED', why: `${w.slice(0, 10)} has no parent` };
  const r = runExternalGuard(ext, { commit: parent, guardFrom: 'HEAD', targetDir });
  if (r.state === 'red') return { verdict: 'RED', why: `fails at ${w.slice(0, 10)}~1: ${r.detail}`, witness: w };
  if (r.state === 'green') return { verdict: 'GREEN-ON-PARENT', why: `passes at ${w.slice(0, 10)}~1 already`, witness: w };
  return { verdict: 'UNMEASURED', why: r.detail, witness: w };
}

/** Commit evidence in the sibling repo: its own commits since `since` (when that sha is its own), else the commits that touched the guard. */
export function externalCommits(ext, { since } = {}) {
  const own = since && tryGit(ext.extRepo, 'cat-file', '-e', `${since}^{commit}`) !== null;
  const out = own ? tryGit(ext.extRepo, 'rev-list', `${since}..HEAD`, '--', ext.rel) : tryGit(ext.extRepo, 'log', '--format=%H', '-n', '20', '--', ext.rel);
  return (out || '').split('\n').filter(Boolean);
}
