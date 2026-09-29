// scripts/vna/steer-follow-through.mjs — C444 /STEER HAS TWO DISPATCH DOORS AND ONE FOLLOW-THROUGH (operator 2026-09-28, verbatim:
// *"/steer should be able to -p as well as in chat sessions subagents? likely better with /steer - just make sure they follow
// through - code that in"*).
//
//   brief <Cn>                 the SAME brief steer-runner.mjs hands a `claude -p` worker (dispatchBrief — the row, its guard, the
//                              snowball, the code slot), reused and never re-composed, followed by WORKER_CONTRACT. A chat session
//                              hands this text verbatim to an in-session subagent instead of hand-writing one.
//   verify <Cn> --since <sha>  the follow-through, identical for both doors: commits since <sha> touching the row's guard or any path
//                              the row names (`git rev-list <sha>..HEAD -- <paths>`), the guard re-run here with `node --test`, and
//                              only then the tick — through `spec-check.mjs toggle --item <Cn>`, never an edit of the spec by this
//                              file. No commit, or a red guard, prints `STUCK <Cn>: <reason>` and never ticks: a worker saying it
//                              is done is not the tick.
//
// Transport and orchestration only (git, a spawned guard, a spawned toggle) — the tick's DECISION stays in spec-check/steer-rules,
// so there is no port row for the Rust crate here (MAXIMISE RUST: what stays node).
// @guard tests/vna/c444-steer-two-doors-one-follow-through.test.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchBrief } from './steer-runner.mjs';
import { guardOf, namedPaths } from './spec-clarity.mjs';
import { parseExternal, runExternalGuard, externalCommits } from './external-guard.mjs';   // C474: a guard in a sibling repo

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = process.env.VNA_REPO || resolve(HERE, '..', '..');
const SPEC_DEFAULT = process.env.VNA_SPEC_MD || resolve(REPO_DEFAULT, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const SPEC_CHECK_CLI = resolve(HERE, 'spec-check.mjs');

// THE WORKER CONTRACT — one constant, so the chat door (brief) and the -p door carry the same words. The runner's claudeWorkOrder /
// localWorkOrder still tell a -p worker to earn its own tick (C398b); this contract is the C444 door's, and the chair's verify is
// the tick either way.
export const WORKER_CONTRACT = [
  'THE WORKER CONTRACT (C444 — the same for a claude -p worker and an in-session subagent):',
  '- Commit ONLY your own paths: git add <paths> then git commit --only <paths> -m "<type>(vna): <Cn> — <what you did>". Never a bare git commit, never --amend, stash, reset, branch, push or deploy: other sessions share this tree and its index.',
  '- Never tick the row. Do not run spec-check.mjs toggle and do not edit the checkbox. The chair ticks only after node scripts/vna/steer.mjs verify <Cn> --since <head-at-dispatch> re-runs your guard itself.',
  '- Your guard must be RED on the parent tree and GREEN on yours: spec-check refuses a guard that already passes on the parent (C355, 2026-09-29). If the row is already built on the parent, say so and commit nothing.',
  '- Before committing, run every test that names a file you changed (grep -rl <file> tests/): a new sidebar drawer once turned C89a\'s README guard red because only the row\'s own guard was run (C307e, 2026-09-29).',
  '- Claim before you edit: node scripts/ops/wip.mjs claim <paths> --note "<Cn>"; a live foreign claim means stop and report, never edit through it. Release after committing. Two workers once held steer-ui.mjs together and one commit swept the other\'s edit (e0a532d8ea, 2026-09-29).',
  '- To check whether a test was already red before you, NEVER git stash, checkout or restore: copy `git show HEAD:<path>` into your scratch directory and run the test against that copy. Two workers stashed the shared tree on 2026-09-29 and swept other sessions\' staged work.',
  '- Report back: every commit sha you landed, the guard path, and the guard\'s node --test output (the tests/pass/fail counts, and the first failing line if any).',
].join('\n');

export function rowLine(specPath, label) {
  return (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ xX]\\] ${label}\\b`).test(l)) || '').trim();
}

/** brief <Cn> — dispatchBrief, byte for byte, then a blank line, then WORKER_CONTRACT */
export function briefFor({ label, specPath = SPEC_DEFAULT, repo = REPO_DEFAULT } = {}) {
  if (!rowLine(specPath, label)) throw new Error(`no row ${label} in ${specPath}`);
  return dispatchBrief({ specPath, label, repo }) + '\n\n' + WORKER_CONTRACT;
}

const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// the verdict must not depend on who is asking: node --test exits 0 on a red file under NODE_TEST_CONTEXT (spec-check's CLEAN_ENV)
const cleanEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };

/** verify <Cn> --since <sha> — returns { ok, label, line, commits, guard, ticked }; never writes the spec itself */
export function verifyRow({ label, since, specPath = SPEC_DEFAULT, repo = REPO_DEFAULT, dry = false, toggleCli = SPEC_CHECK_CLI, witness = null } = {}) {
  const stuck = (reason, extra = {}) => ({ ok: false, label, line: `STUCK ${label}: ${reason}`, ticked: false, ...extra });
  if (!since) return stuck('no --since <sha> given — pass the HEAD you read at dispatch');
  const row = rowLine(specPath, label);
  if (!row) return stuck(`no row ${label} in ${specPath}`);
  if (/^- \[[xX]\]/.test(row)) return { ok: true, label, line: `${label} already ticked — nothing to verify`, ticked: false, commits: [], guard: guardOf(row) };
  const guard = guardOf(row);
  if (!guard) return stuck('the row names no guard — `(guard: tests/…)`');
  const paths = [...new Set([guard, ...namedPaths(row)])];
  let commits, counts;
  const ext = parseExternal(guard, repo);
  if (ext) {
    // C474 — the guard lives in a sibling repo: its commits are read from THAT repo's log, and it runs on that
    // repo's committed tree (git archive into a temp dir), never either working tree.
    commits = externalCommits(ext, { since });
    if (!commits.length) return stuck(`no commit in ${ext.name} touches ${ext.rel}`, { guard, commits });
    const r = runExternalGuard(ext);
    if (r.state !== 'green') return stuck(`guard ${r.state}: ${r.detail}`, { guard, commits });
    counts = { pass: r.pass, fail: 0 };
    return tickOrDry({ label, since, guard, commits, counts, dry, specPath, repo, toggleCli, witness, stuck, where: `${ext.name}@${r.commit.slice(0, 10)}` });
  }
  try { commits = git(repo, 'rev-list', `${since}..HEAD`, '--', ...paths).split('\n').filter(Boolean); }
  catch (e) { return stuck(`git rev-list ${since}..HEAD failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`, { guard }); }
  if (!commits.length) return stuck(`no commit since ${since.slice(0, 10)} touches ${paths.join(', ')}`, { guard, commits });
  let tap = '';
  try { tap = execFileSync('node', ['--test', '--test-reporter=tap', guard], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv(), timeout: 300000 }); }
  catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const first = (/^not ok \d+ - (.+)$/m.exec(out) || [])[1] || out.trim().split('\n').find(Boolean) || `exit ${e.status}`;
    return stuck(`guard red: ${first}`, { guard, commits });
  }
  counts = { pass: Number((/^# pass (\d+)/m.exec(tap) || [])[1] || 0), fail: Number((/^# fail (\d+)/m.exec(tap) || [])[1] || 0) };
  if (!counts.pass) return stuck(`guard red: ${guard} ran no passing test`, { guard, commits });
  return tickOrDry({ label, since, guard, commits, counts, dry, specPath, repo, toggleCli, witness, stuck });
}

function tickOrDry({ label, since, guard, commits, counts, dry, specPath, repo, toggleCli, witness, stuck, where }) {
  const head = `${commits.length} commit${commits.length === 1 ? '' : 's'} ${where ? `in ${where.split('@')[0]}` : `since ${since.slice(0, 10)}`} (${commits.slice(0, 6).map((c) => c.slice(0, 10)).join(' ')}) · ${guard} green (${counts.pass} pass${where ? ` at ${where}` : ''})`;
  if (dry) return { ok: true, label, line: `WOULD TICK ${label} — ${head} · --dry: spec-check toggle not run`, ticked: false, commits, guard, counts };
  let out = '';
  const args = [toggleCli, 'toggle', '--item', label, ...(witness ? ['--witness', witness] : [])];
  try { out = execFileSync('node', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), VNA_SPEC: specPath, VNA_GUARD_REPO: repo } }); }
  catch (e) { const why = (String(e.stderr || '') + String(e.stdout || '')).trim().split('\n').find(Boolean) || `exit ${e.status}`; return stuck(`spec-check refused the tick: ${why}`, { guard, commits }); }
  if (!/\bTICKED\b/.test(out)) return stuck(`spec-check did not tick: ${out.trim().split('\n').pop()}`, { guard, commits });
  return { ok: true, label, line: `TICKED ${label} — ${head} · via spec-check toggle`, ticked: true, commits, guard, counts };
}
