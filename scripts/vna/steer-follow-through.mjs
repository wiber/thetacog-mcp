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
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { guardTimeoutMs } from '../lib/guard-timeout.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchBrief } from './steer-runner.mjs';
import { guardOf, namedPaths } from './spec-clarity.mjs';
import { parseExternal, runExternalGuard, externalCommits } from './external-guard.mjs';   // C474: a guard in a sibling repo
import { stampVerify, VERIFY_NDJSON } from './door-metrics.mjs';
import { aimOf } from './aim.mjs';   // C780: the ONE aim reading — the brief prints it, the follow-through records it (aim.mjs, never steer.mjs: its CLI imports this file)   // C563e (2): the denominator is verified outcomes, never dispatches

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
  // the three lines the HUD run (2026-10-12) was missing — each a relation a row-isolated worker cannot see; docs/specs/vna/asks/2026-10-12-hud-run-postmortem.txt
  '- The CANONICAL Rust crate is .thetacog/pmu; packages/thetacog-mcp/pmu-rust is the shipped MIRROR the bundler refreshes FROM the canonical. Edit the canonical first, or both in one commit, and run tests/pmu-simulator/rust-crate-mirror.test.mjs before committing: a module landed in the mirror alone is deleted by the next refresh (f2e4719311, 2026-10-12).',
  '- A server op or hot path never reads a file whole: bound the read and cap it (HEALTH_TAPE_CAP, fc1283a76e). The operator\'s walk tape is 1.6 GB; this box\'s is small, so a guard that passes here on a whole-file read is a proxy for the Mac, not the Mac.',
  '- Before the first dispatch of a goal, the chair pulls main (git fetch origin main; git merge-base HEAD origin/main) and merges when main moved; a worker that finds its named file differs from origin/main\'s layout reports it and stops rather than building on the stale base (f32ee93799, 2026-10-12).',
  '- A parent-tree comparison extracts ONLY the paths it needs (`git archive <sha> <path> <path> | tar -x -C <scratch>`), never the whole tree, and deletes the extract and any build output before reporting: two whole-tree extracts (4.4 GB and 4.2 GB) filled the box on 2026-10-14 and every later guard run died on ENOSPC. Under 2 GB free (`df -k .`), stop and report instead of building.',
  '- `git commit --only <path>` commits the WORKING-TREE file, not your edits: on a file other workers also hold (main.rs, lib.rs, a shared test), re-read it right before the commit, and if it carries lines whose modules or files are not yet tracked, wait for their commit or stage your hunks alone with `git add -p` — C830 committed C831 and C832 lines on 2026-10-14 and the head did not build for ten minutes.',
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

// C780 — THE FOLLOW-THROUGH RECORDS THE AIM ON THE DISPATCH ROW: an aim-stamp row { kind:'aim-stamp', label, since, aim: AIMED|UNAIMED,
// from, why } on its OWN ledger beside the verify ledger (.thetacog/aim-stamps.ndjson; VNA_AIM_NDJSON) — never on verify-stamps.ndjson,
// whose row count C563e's guard holds exactly — written by verify and by record-chat (the chat door's completion). A row with no from:
// pointer, or one whose lines no longer read as the recorded span, is UNAIMED with its why — said, never a silent omission.
export const aimLedgerFor = (verifyLedger = VERIFY_NDJSON) => process.env.VNA_AIM_NDJSON || resolve(dirname(verifyLedger), 'aim-stamps.ndjson');
export const AIM_NDJSON = aimLedgerFor(VERIFY_NDJSON);
export function recordAim({ label, specPath = SPEC_DEFAULT, tape = undefined, since = null, ledgerPath = AIM_NDJSON, at = new Date().toISOString() } = {}) {
  if (!label) throw new Error('recordAim: needs a label');
  const a = aimOf({ label, specPath, ...(tape !== undefined ? { tape } : {}) });
  const row = { at, kind: 'aim-stamp', label, since, aim: a.aimed ? 'AIMED' : 'UNAIMED', from: a.aimed ? `${a.id}#L${a.first}-${a.last}` : a.from ? `${a.from.id}#L${a.from.first}-${a.from.last}` : null, why: a.aimed ? null : a.why };
  try { mkdirSync(dirname(ledgerPath), { recursive: true }); appendFileSync(ledgerPath, JSON.stringify(row) + '\n'); } catch {}
  return row;
}

const GUARD_TIMEOUT_MS = guardTimeoutMs();   // scripts/lib/guard-timeout.mjs — the one limit both doors use
const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// the verdict must not depend on who is asking: node --test exits 0 on a red file under NODE_TEST_CONTEXT (spec-check's CLEAN_ENV)
const cleanEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };

/** verify <Cn> --since <sha> — returns { ok, label, line, commits, guard, ticked }; never writes the spec itself.
 * C563e (2): every call stamps the ledger verified:true (a real tick) or verified:false (STUCK) — `door.mjs` reads
 * only stamped rows, so a dispatch nobody ran verify on can never enter the denominator. --dry never stamps: it
 * ticks nothing, so it verifies nothing. */
export function verifyRow({ label, since, specPath = SPEC_DEFAULT, repo = REPO_DEFAULT, dry = false, toggleCli = SPEC_CHECK_CLI, witness = null, verifyLedgerPath = VERIFY_NDJSON } = {}) {
  const stuck = (reason, extra = {}) => { if (!dry) stampVerify({ label, verified: false, reason, since, ledgerPath: verifyLedgerPath }); return { ok: false, label, line: `STUCK ${label}: ${reason}`, ticked: false, ...extra }; };
  if (!dry && label) try { recordAim({ label, specPath, since, ledgerPath: aimLedgerFor(verifyLedgerPath) }); } catch {}   // C780: the aim rides the dispatch row's ledger, never a gate on the verdict
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
    return tickOrDry({ label, since, guard, commits, counts, dry, specPath, repo, toggleCli, witness, stuck, verifyLedgerPath, where: `${ext.name}@${r.commit.slice(0, 10)}` });
  }
  try { commits = git(repo, 'rev-list', `${since}..HEAD`, '--', ...paths).split('\n').filter(Boolean); }
  catch (e) { return stuck(`git rev-list ${since}..HEAD failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`, { guard }); }
  if (!commits.length) return stuck(`no commit since ${since.slice(0, 10)} touches ${paths.join(', ')}`, { guard, commits });
  let tap = '';
  try { tap = execFileSync('node', ['--test', '--test-reporter=tap', guard], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv(), timeout: GUARD_TIMEOUT_MS }); }
  catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const first = (/^not ok \d+ - (.+)$/m.exec(out) || [])[1] || out.trim().split('\n').find(Boolean) || `exit ${e.status}`;
    return stuck(`guard red: ${first}`, { guard, commits });
  }
  counts = { pass: Number((/^# pass (\d+)/m.exec(tap) || [])[1] || 0), fail: Number((/^# fail (\d+)/m.exec(tap) || [])[1] || 0) };
  if (!counts.pass) return stuck(`guard red: ${guard} ran no passing test`, { guard, commits });
  return tickOrDry({ label, since, guard, commits, counts, dry, specPath, repo, toggleCli, witness, stuck, verifyLedgerPath });
}

function tickOrDry({ label, since, guard, commits, counts, dry, specPath, repo, toggleCli, witness, stuck, verifyLedgerPath, where }) {
  const head = `${commits.length} commit${commits.length === 1 ? '' : 's'} ${where ? `in ${where.split('@')[0]}` : `since ${since.slice(0, 10)}`} (${commits.slice(0, 6).map((c) => c.slice(0, 10)).join(' ')}) · ${guard} green (${counts.pass} pass${where ? ` at ${where}` : ''})`;
  if (dry) return { ok: true, label, line: `WOULD TICK ${label} — ${head} · --dry: spec-check toggle not run`, ticked: false, commits, guard, counts };
  let out = '';
  const args = [toggleCli, 'toggle', '--item', label, ...(witness ? ['--witness', witness] : [])];
  try { out = execFileSync('node', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), VNA_SPEC: specPath, VNA_GUARD_REPO: repo } }); }
  catch (e) { const why = (String(e.stderr || '') + String(e.stdout || '')).trim().split('\n').find(Boolean) || `exit ${e.status}`; return stuck(`spec-check refused the tick: ${why}`, { guard, commits }); }
  if (!/\bTICKED\b/.test(out)) return stuck(`spec-check did not tick: ${out.trim().split('\n').pop()}`, { guard, commits });
  stampVerify({ label, verified: true, since, ledgerPath: verifyLedgerPath });
  return { ok: true, label, line: `TICKED ${label} — ${head} · via spec-check toggle`, ticked: true, commits, guard, counts };
}
