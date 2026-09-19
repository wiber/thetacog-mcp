#!/usr/bin/env node
// scripts/pmu/harvest-accept.mjs — THE HARVEST ACCEPT GATE (goal §8.2 R2 · terminal §8.4).
//
// The knock-on that keeps reef edits honest: given a reef-data commit (touches
// data/pmu/lens-reef.json), re-measure the constitution and AUTO-REVERT on regression.
// NON-BLOCKING BY DESIGN: this never runs pre-commit; it is the knock-on undoing a knock-on.
// Human work is never blocked — only reef DATA commits are ever reverted.
//
// ACCEPT iff (two-sided, spec §5.3): sweep F1 (defaults vector) ≥ ratchet floor
//            ∧ routing battery 22/22 (Φ_held = 0 — non-increasing vs the pinned floor).
// RED: git revert --no-edit <sha> + a kickback self-prompt carrying the root context
//      (SELF-IMPROVING FIRES: the fire diagnoses and prevents, never just undoes).
//
// Run: node scripts/pmu/harvest-accept.mjs [--sha <commit>] [--dry]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
// RESOLVE THE SHA ONCE, IMMEDIATELY (2026-07-20 proof-run bug): repo automation lands commits
// CONCURRENTLY (commit-page publishes etc.) — re-resolving HEAD after the ~2min sweep reverted
// the WRONG commit. The sha is pinned before any slow work; HEAD is never consulted again.
const sha = execFileSync('git', ['rev-parse', arg('--sha', 'HEAD')], { cwd: REPO, encoding: 'utf8' }).trim();
const dry = process.argv.includes('--dry');

// gate scope: only reef-data commits are ever revertable
const touched = execFileSync('git', ['show', '--name-only', '--pretty=format:', sha], { cwd: REPO, encoding: 'utf8' }).trim().split('\n');
if (!touched.includes('data/pmu/lens-reef.json')) {
  console.log(`harvest-accept: ${sha} does not touch lens-reef.json — out of scope, no gate.`);
  process.exit(0);
}

const floor = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/ratchet-floor.json'), 'utf8'));
const floorF1 = floor.picker.f1;
console.log(`harvest-accept · gating ${sha} against floor F1 ${floorF1} + battery 22/22`);

// 1. the sweep (frozen constitution) — read the fresh defaults-vector F1
// --gate-mode: Phase A + the ONE vector this gate reads. Measured 2026-07-20: the full 48-vector
// grid costs ~94s of which ~73s computes knob vectors the gate never looks at — 44% of a 166s
// tick, burned every cycle. The frontier grid stays available; it is just not on the hot path.
execFileSync('node', [resolve(HERE, 'lens-convergence-sweep.mjs'), '--gate-mode'], { cwd: REPO, stdio: 'pipe', timeout: 900000 });
const lines = readFileSync(resolve(REPO, 'data/pmu/lens-convergence-history.ndjson'), 'utf8').trim().split('\n');
let latest = null;
for (let i = lines.length - 1; i >= 0 && !latest; i--) { const r = JSON.parse(lines[i]); if (r.default_vector) latest = r; }
const f1 = latest.default_vector.f1;

// 2. the battery (Φ_held) — deterministic routing agreement, 22 prompts
const { BATTERY, HELD_OUT } = await import(resolve(HERE, 'grip-microscope.mjs'));
const { lensPrompt } = await import(resolve(HERE, 'prompt-lens.mjs'));
let misses = [];
for (const b of [...BATTERY, ...HELD_OUT]) {
  const base = await lensPrompt(b.draft);
  const dom = base.receipt?.domain || base.boundary?.domain || 'other';
  if (dom !== b.ideal) misses.push(`${b.draft.slice(0, 50)} → ${dom} (ideal ${b.ideal})`);
}

const green = f1 >= floorF1 - 1e-9 && misses.length === 0;
console.log(`  sweep F1 ${f1} (floor ${floorF1}) · battery ${22 - misses.length}/22 → ${green ? 'ACCEPT' : 'RED'}`);

if (green) { console.log('harvest-accept: ACCEPTED — the edit stays; re-pin the floor if F1 rose.'); process.exit(0); }

// ── STALE-FLOOR FUSE (incident 2026-07-21T17:16Z → 07-22, 30h / ~18 commit-revert pairs) ──
// A floor may only judge an edit that was measured under the SAME evaluator the floor was pinned
// against. c45312e54 (07-21T17:16Z) changed prompt-lens.mjs — the picker — moving F1 0.885→~0.832
// in five minutes. The floor 0.879 was pinned 07-19 against evaluator ae4be298; the baseline has
// been unable to meet it ever since. Every harvest was then refused for a reason that had nothing
// to do with the harvest, and auto-reverted as if the EDIT were at fault. Reverting cannot fix a
// regime mismatch, so the loop could never converge — it just burned commits.
// This is PRECISION_DOCTRINE rule 5 ("RE-DERIVE, DO NOT INHERIT — old floors describe a system
// that no longer exists") enforced mechanically instead of written down and hoped for.
// A refusal whose cause is the GATE's own staleness must ESCALATE WITH CONTEXT, never revert
// (CLAUDE.md SELF-IMPROVING FIRES: a fire that only re-emits output is a symptom patch).
const { codeSha } = await import(resolve(HERE, 'lens-convergence-sweep.mjs'));
const pinnedCode = floor.picker.code_version || null;
const currentCode = codeSha();
const f1Failed = !(f1 >= floorF1 - 1e-9);
if (f1Failed && misses.length === 0 && pinnedCode && pinnedCode !== currentCode) {
  console.log('harvest-accept: STALE FLOOR — NOT REVERTING.');
  console.log(`  F1 ${f1} < floor ${floorF1}, but the battery is clean (22/22) and the evaluator changed`);
  console.log(`  since the floor was pinned: ${pinnedCode.slice(0, 16)} → ${currentCode.slice(0, 16)}.`);
  console.log('  The floor describes a regime that no longer exists; this edit was never judged.');
  console.log(`  RE-DERIVE: pin picker.f1 at the OBSERVED MINIMUM of baseline sweeps under evaluator`);
  console.log(`  ${currentCode.slice(0, 16)} (>=5 distinct values), then set picker.code_version to it.`);
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(resolve(REPO, 'data/pmu/revert-evidence.ndjson'), JSON.stringify({
      ts: new Date().toISOString(), sha: sha.slice(0, 12), verdict: 'STALE_FLOOR_NO_REVERT',
      f1, floor: floorF1, battery_misses: 0,
      pinned_code: pinnedCode.slice(0, 16), current_code: currentCode.slice(0, 16),
    }) + '\n');
  } catch { /* evidence is best-effort — never blocks the gate */ }
  process.exit(0);
}

// REVERT EVIDENCE (ratchet-27, LOG-ONLY — this block decides NOTHING and writes no verdict
// variable; it records which side of the two-sided gate failed, refs-only, so a red streak is
// attributable instead of a mystery. Found 2026-07-22: 19h of blanket reverts traced to F1
// 0.885→0.832 in a 2-minute window on 07-21T18:12Z — every cycle since was collateral).
try {
  const ev = {
    ts: new Date().toISOString(), sha: sha.slice(0, 12),
    f1, floor: floorF1, f1_short: +(floorF1 - f1).toFixed(4), f1_side: f1 >= floorF1 - 1e-9 ? 'pass' : 'FAIL',
    battery_misses: misses.length, battery_side: misses.length === 0 ? 'pass' : 'FAIL',
    miss_stems: misses.slice(0, 6).map((m) => String(m).slice(0, 80)),
  };
  const { appendFileSync } = await import('node:fs');
  appendFileSync(resolve(REPO, 'data/pmu/revert-evidence.ndjson'), JSON.stringify(ev) + '\n');
} catch { /* evidence is best-effort — never blocks the gate */ }
console.log(`harvest-accept: RED — ${dry ? 'DRY RUN (no revert)' : `auto-reverting ${sha}`}`);
for (const m of misses.slice(0, 4)) console.log(`    ✗ ${m}`);
if (!dry) {
  // REVERT WITH RETRY (incident 2026-07-20 01:04Z + 01:32Z: "fatal: revert failed" — twice —
  // left RED batches 9d645f6dc/+10 and 22212208d/+13 STANDING in the reef; baseline fell
  // 0.879→0.876 and every later honest harvest was refused against a floor the baseline no
  // longer met. Both reverts applied CLEANLY when re-run later → the failure is transient
  // (post-commit automation holding .git/index.lock / momentary dirty tree). A failed revert
  // may NOT be a log line and a shrug — retry with backoff, and on final failure kick back.)
  let reverted = false, lastErr = '';
  for (let attempt = 1; attempt <= 3 && !reverted; attempt++) {
    try {
      execFileSync('git', ['revert', '--no-edit', sha], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
      reverted = true;
    } catch (e) {
      lastErr = String(e.stderr || e.stdout || e.message).slice(0, 300);
      try { execFileSync('git', ['revert', '--abort'], { cwd: REPO, stdio: 'pipe' }); } catch { /* nothing in progress */ }
      if (attempt < 3) { console.log(`  revert attempt ${attempt} failed (${lastErr.split('\n')[0]}) — retrying in ${attempt * 5}s`); execFileSync('sleep', [String(attempt * 5)]); }
    }
  }
  if (!reverted) {
    // REVERT-BY-RESTORE (incident #2, 2026-07-20 04:20Z: revert hit a genuine merge conflict —
    // retries can't fix a conflict, and concurrent repo automation can rebase main mid-gate).
    // A harvest commit is reef-DATA only by construction, so restoring its files to their
    // pre-commit blobs IS the revert — content-level, conflict-proof, rebase-proof.
    try {
      const files = execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: REPO, encoding: 'utf8' })
        .trim().split('\n').filter((f) => f.startsWith('data/pmu/'));
      for (const f of files) writeFileSync(resolve(REPO, f), execFileSync('git', ['show', `${sha}^:${f}`], { cwd: REPO, encoding: 'utf8' }));
      execFileSync('git', ['commit', ...files.flatMap((f) => ['--only', f]),
        '-m', `Revert-by-restore: harvest ${sha.slice(0, 9)} — refused batch; conflict-proof pre-commit blob restore\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`],
        { cwd: REPO, stdio: 'pipe' });
      reverted = true;
      console.log(`  reverted-by-restore ${sha.slice(0, 9)} (${files.length} files → pre-commit blobs; revert had failed: ${lastErr.split('\n')[0]})`);
    } catch (e3) { console.log(`  ✗ revert-by-restore also failed: ${String(e3.stderr || e3.message).slice(0, 200)}`); }
  }
  if (!reverted) {
    console.log(`  ✗ revert failed after 3 attempts + restore fallback: ${lastErr}`);
    console.log('  manual recovery: git revert --no-edit ' + sha.slice(0, 9));
    // the RED batch is STANDING — this is the loudest possible kickback, never silence
    try {
      execFileSync('node', [resolve(REPO, 'scripts/self-prompt-create.mjs'),
        '--due', new Date(Date.now() + 900e3).toISOString(),
        '--action', `URGENT: RED harvest commit ${sha.slice(0, 9)} could NOT be auto-reverted (3 attempts) — the reef is carrying a refused batch and the floor gate will refuse every subsequent harvest. Run: git revert --no-edit ${sha.slice(0, 9)}, then a sweep to restore the ledger tail.`,
        '--context', `revert error: ${lastErr.split('\n')[0]} · gate: scripts/pmu/harvest-accept.mjs · incident class: sweep-below-floor`,
        '--room', 'laboratory'], { cwd: REPO, stdio: 'pipe', timeout: 90000 });
      console.log('  URGENT kickback self-prompt created (laboratory, due 15min)');
    } catch (e2) { console.log(`  ⚠ kickback failed: ${String(e2.stderr || e2.message).slice(0, 200)}`); }
    process.exit(1);
  }
  console.log(`  reverted ${sha.slice(0, 9)} (a reef-DATA commit — human work is never touched)`);
  // RESTORE THE LEDGER TAIL (loop-mode fix, 2026-07-20 tick 1): the RED sweep row is the
  // history tail after a revert, which keeps the sweep-below-floor sentinel firing forever
  // on an already-healed reef. One post-revert sweep appends the green row — the ledger
  // ends every gate run telling the truth about the CURRENT reef.
  try { execFileSync('node', [resolve(HERE, 'lens-convergence-sweep.mjs'), '--reuse-if-unchanged', '--gate-mode'], { cwd: REPO, stdio: 'pipe', timeout: 900000 }); console.log('  post-revert sweep appended (ledger tail restored — deterministic reuse when the reef is byte-identical)'); }
  catch { console.log('  ⚠ post-revert sweep failed — run lens-convergence-sweep.mjs manually'); }
  // THE REFUSED LEDGER (incident 2026-07-20 07:xxZ, operator: "are we doing it right? maybe
  // we learned it's not calibrated"): the revert restores lens-c1-adjudication.json along with
  // the reef — which ERASES the intake rows recording "we tried these". The miner's cursor is
  // that file, so the next tick re-mines the IDENTICAL batch, gets refused, reverts, forever.
  // Measured: HA-62..HA-67 were byte-identical (100% overlap, 2 unique statements each).
  // The constitution's refusal must OUTLIVE the revert — so it is written here, to a ledger
  // outside the reverted paths, carrying the reason (answerable: "what was refused, and why").
  try {
    const REFUSED = resolve(REPO, 'data/pmu/miner-refused.json');
    const doc = existsSync(REFUSED) ? JSON.parse(readFileSync(REFUSED, 'utf8')) : { rows: [] };
    const known = new Set((doc.rows || []).map((r) => r.key));
    const adjPath = resolve(REPO, 'data/pmu/lens-c1-adjudication.json');
    // read the PRE-revert intake (the batch that was just judged) from the refused commit itself
    const adjAtSha = JSON.parse(execFileSync('git', ['show', `${sha}:data/pmu/lens-c1-adjudication.json`], { cwd: REPO, encoding: 'utf8' }));
    const adjBefore = JSON.parse(execFileSync('git', ['show', `${sha}^:data/pmu/lens-c1-adjudication.json`], { cwd: REPO, encoding: 'utf8' }));
    const beforeKeys = new Set((adjBefore.rows || []).map((r) => String(r.prompt).slice(0, 60)));
    let added = 0;
    for (const r of adjAtSha.rows || []) {
      const key = String(r.prompt).slice(0, 60);
      if (beforeKeys.has(key) || known.has(key)) continue;
      doc.rows.push({ key, reason: 'constitution-refused', sha: sha.slice(0, 9), f1, floor: floorF1, ts: new Date().toISOString() });
      known.add(key); added++;
    }
    if (added) { writeFileSync(REFUSED, JSON.stringify(doc, null, 1)); console.log(`  refused ledger: +${added} candidates recorded (survive the revert — the miner will not re-propose them)`); }
    void adjPath;
  } catch (e4) { console.log(`  ⚠ refused-ledger write failed: ${String(e4.message).slice(0, 140)}`); }

  // the kickback — root context, per SELF-IMPROVING FIRES. DEDUPED (overwatch pass #2: 13
  // near-identical pending kickbacks piled up in one night — one pending prompt carries the
  // diagnosis task; copies add noise, not signal). If a pending harvest-revert kickback
  // already exists, skip creation and say so — the standing prompt already points here.
  const hasPendingKickback = (() => {
    try {
      const spDoc = JSON.parse(readFileSync(resolve(REPO, 'data/self-prompts.json'), 'utf8'));
      const list = spDoc.prompts || (Array.isArray(spDoc) ? spDoc : []);
      return list.some((x) => x.status === 'pending' && String(x.action || '').includes('harvest-accept REVERTED'));
    } catch { return false; }
  })();
  if (hasPendingKickback) { console.log('  kickback deduped — a pending harvest-revert diagnosis prompt already exists'); }
  else try {
    execFileSync('node', [resolve(REPO, 'scripts/self-prompt-create.mjs'),
      '--due', new Date(Date.now() + 3600e3).toISOString(),
      '--action', `harvest-accept REVERTED reef commit ${sha.slice(0, 9)}: sweep F1 ${f1} vs floor ${floorF1}, battery misses ${misses.length}. Diagnose WHICH entries regressed (the diff is small by construction), fix at mechanism level (boundary anchors / stem eviction / trap relabel), re-land behind the gate.`,
      '--context', `misses: ${misses.slice(0, 3).join(' | ')} · gate: scripts/pmu/harvest-accept.mjs · floor: data/pmu/ratchet-floor.json · spec §8.2 R2`,
      '--room', 'laboratory'], { cwd: REPO, stdio: 'pipe', timeout: 90000 });
    console.log('  kickback self-prompt created (laboratory)');
  } catch (e) { console.log(`  ⚠ kickback failed: ${String(e.stderr || e.message).slice(0, 200)}`); }
  process.exit(1);
}
process.exit(1);
