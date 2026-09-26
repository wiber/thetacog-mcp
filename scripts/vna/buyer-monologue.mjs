#!/usr/bin/env node
// C309d — THE TWELVE-STATE BUYER'S MONOLOGUE, RUN. The lean sequential filter from the buyer's RPM
// (src/lib/brand/buyer-rpm.mjs): the states only the buyer holds print YOURS, the three the repo can decide are
// read off the repo (3 · is a spec frozen in git · 5 · which commit the last walk used · 6 · the walk's honest
// state), and the branch lands on exactly one of 9 / 10 / 11. 12 always prints. No model anywhere in the path —
// this is the seismograph describing itself, never grading the work.
//
//   node scripts/vna/buyer-monologue.mjs [--signing] [--outsider "<name>"] [--json]
//     --signing              you answered 8 "I am being asked to sign for the liability"
//     --outsider "<name>"    a named person outside your company will recompute the stamp (implies --signing)
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MONOLOGUE, MONOLOGUE_GATE, PROMISE_KEPT, STAMP_IS_OPTIONAL, walkState } from '../../src/lib/brand/buyer-rpm.mjs';
import { MACHINE_COMMIT, lastAuthored } from './authored-commit.mjs';

const SPEC = 'docs/specs/vna/SPEC-VNA-COCKPIT.md';
const RECEIPT = 'data/vna/cockpit.json';

function git(repo, args) {
  try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// 3 — a spec is FROZEN when it is committed: the walk reads the immutable commit, never the working tree.
export function specFrozen(repo) {
  if (!existsSync(resolve(repo, SPEC))) return { answer: 'NO', why: `no ${SPEC} — the walk falls back to the commit message, which is chat history by another name (UNDECLARED)` };
  const last = git(repo, ['log', '-n', '1', '--format=%h %cs', '--', SPEC]);
  if (!last) return { answer: 'NO', why: `${SPEC} exists but is not committed — a spec you can still edit is not frozen` };
  const dirty = git(repo, ['status', '--porcelain', '--', SPEC]);
  return { answer: 'YES', why: `${SPEC} committed at ${last}${dirty ? ' (uncommitted edits exist; the walk reads the committed version)' : ''}` };
}

// 5 — the commit the last walk actually used, against the commit you meant (the last authored one).
export function walkedCommit(repo, receipt) {
  if (!receipt) return { answer: 'UNMEASURED', why: `no ${RECEIPT} — no walk has run here yet` };
  const walked = String(receipt.commitFull || receipt.commit || '');
  const subject = String(receipt.subject || '');
  if (MACHINE_COMMIT.test(subject)) return { answer: 'MACHINE', why: `the last walk read ${walked.slice(0, 10)} "${subject.slice(0, 60)}" — the hook's commit; walk again (the default now takes the authored one)` };
  const meant = lastAuthored(repo);
  const same = meant && walked && (meant.startsWith(walked) || walked.startsWith(meant));
  return same
    ? { answer: 'AUTHORED', why: `the last walk read ${walked.slice(0, 10)} "${subject.slice(0, 60)}" — your last authored commit` }
    : { answer: 'AUTHORED, OLDER', why: `the last walk read authored ${walked.slice(0, 10)} "${subject.slice(0, 60)}"; your last authored commit is now ${String(meant).slice(0, 10)} — walk again to place it` };
}

export function monologue({ repo, receipt, signing = false, outsider = null }) {
  const decided = { 3: specFrozen(repo), 5: walkedCommit(repo, receipt), 6: (() => { const w = walkState(receipt); return { answer: w.state, why: w.why }; })() };
  const branch = outsider ? 10 : signing ? 11 : 9;
  const rows = MONOLOGUE.map((s) => {
    if (s.answer === 'repo') return { n: s.n, q: s.q, answer: decided[s.n].answer, why: decided[s.n].why };
    if (s.answer === 'yours') return { n: s.n, q: s.q, answer: 'YOURS', why: 'only you hold this answer — the tool does not guess it' };
    if (s.answer === 'branch') return s.n === branch
      ? { n: s.n, q: s.q, answer: 'HERE', why: s.n === 10 ? `${outsider} will recompute it — the stamp has a reader, so it is worth paying for` : s.n === 11 ? 'you are signing but no named outsider will recompute the stamp — do not pay yet' : 'free: install, one repo, one authored commit' }
      : { n: s.n, q: s.q, answer: '—', why: 'not your branch' };
    return { n: s.n, q: s.q, answer: 'STOP', why: 'measure the commit' };
  });
  return { rows, branch, pays: branch === 10, gate: MONOLOGUE_GATE, promise: PROMISE_KEPT, stamp: STAMP_IS_OPTIONAL };
}

function main(argv) {
  const flag = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const repo = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const p = resolve(repo, RECEIPT);
  let receipt = null; try { receipt = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { receipt = null; }
  const outsider = flag('--outsider');
  const out = monologue({ repo, receipt, signing: argv.includes('--signing') || !!outsider, outsider });
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const lines = ['THE BUYER\'S MONOLOGUE — twelve states, in order. ' + out.gate, ''];
  for (const r of out.rows) lines.push(`${String(r.n).padStart(2)}. ${r.q}`, `    → ${r.answer} — ${r.why}`);
  lines.push('', out.pays ? `Pay for the ledger stamp: ${outsider} is the reader.` : `Do not pay. ${out.stamp}`, `The promise kept: ${out.promise}`);
  process.stdout.write(lines.join('\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
