#!/usr/bin/env node
// scripts/pmu/commit-drift.mjs — THE COMMIT → DRIFT-EMAIL ENGINE (the seamless-delegation spine).
// =============================================================================
// One commit on a delegated sub-project, end to end (operator's through-line):
//   1. load/build the JOB reef (the spec's signed intent)              — spec-reef
//   2. run the REAL recursive on-chip ballistic walk in Rust            — spec-deliver-walk (pmu-onchip)
//      → a drift receipt (verdict · σ-shape-match · off-shape vs tolerance)
//   3. price the drift BY TOLERANCE in insurance/options language       — cost-guidance
//   4. POST the receipt to the mesh ledger — the mesh IS the messenger   — mesh-post (VERDICT)
//   5. compose a RICH canonical drift email that EMBEDS the spec + the    — md → canonical-send
//      commit message, prices the drift, and ends in actionable moves.
//      Each Six-Needs section reinforces its own theme with SYNONYMS (R12).
//
// The walk is the real one (HARD RULE) — never placePixel/analytic. Runs from the local npx
// package: `npx thetacog-mcp commit-drift --reef <r> --room <R> --commit <sha>`.
//
// Output: a graded-ready draft in docs/comms/<channel>/drafts/ + the cost json + the mesh event.
// Arming it (move to approved/ + commit) runs the ≥95 gate + Ava-audio + send — the canonical door.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { costGuidance } from './cost-guidance.mjs';
import { specDrift, attributeCause } from './spec-drift.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 });

// SYNONYM lexicon (R12): each need's section re-states its own theme in varied words so the
// reader keeps re-locating which need they're in — and we think through "what connects to what".
const LEX = {
  connection:   ['connects to', 'ties back to', 'links to', 'is your grip on', 'hooks into', 'maps onto'],
  contribution: ['hands you', 'gives you', 'enables you to', 'lets you contribute', 'puts in your hands'],
  growth:       ['grows', 'compounds', 'levels up', 'extends', 'builds on'],
  certainty:    ['you can check yourself', 'is recomputable', 'holds still', 'reproduces byte-for-byte'],
};

// #14: the TO-ROOM drives reef-spec selection. A commit lands in a worker room; the reef it is
// graded against is the spec that was *delegated to that room* (to_room === room), newest first.
// This is the delegation contract: you don't pass a reef by hand, the room you're in picks it.
function pickReefForRoom(room) {
  const dir = resolve(REPO, 'data/pmu/reef');
  if (!existsSync(dir)) return null;
  const cands = readdirSync(dir)
    .filter(f => /^spec-reef-.*\.json$/.test(f))
    .map(f => resolve(dir, f))
    .map(p => { try { const r = JSON.parse(readFileSync(p, 'utf8')); return { p, r, mt: statSync(p).mtimeMs }; } catch { return null; } })
    .filter(x => x && x.r.to_room === room)
    .sort((a, b) => b.mt - a.mt);
  return cands.length ? cands[0].r : null;
}

function jobReef(reefPath, specPath, room) {
  if (reefPath && existsSync(reefPath)) return JSON.parse(readFileSync(reefPath, 'utf8'));
  if (specPath) {
    const r = sh('node', ['scripts/pmu/reef-from-spec.mjs', '--spec', specPath, '--json']);
    if (r.status === 0 && r.stdout.trim()) return JSON.parse(r.stdout);
  }
  const auto = pickReefForRoom(room);
  if (auto) { process.stderr.write(`  ↳ reef auto-selected by to_room=${room}: ${auto.spec_id} (from ${auto.from_room || '?'})\n`); return auto; }
  throw new Error(`need --reef <spec-reef.json> or --spec <path.md> (and no spec-reef is delegated to room "${room}")`);
}

function runWalk(reefPath, deliverables) {
  // the REAL recursive on-chip ballistic walk — never the analytic shortcut
  const args = ['scripts/pmu/spec-deliver-walk.mjs', '--reef', reefPath];
  if (deliverables) args.push('--deliverables', deliverables);
  else args.push('--demo');
  const r = sh('node', args);
  const wf = resolve(REPO, 'docs/pmu/spec-deliver-walk-receipt.json');
  if (!existsSync(wf)) throw new Error('walk produced no receipt — is the pmu-onchip daemon built? ' + (r.stderr || '').slice(-200));
  return JSON.parse(readFileSync(wf, 'utf8'));
}

function meshPost({ room, verdict, attestationRoot, sha, specId, reefSha, specPath, metrics }) {
  // the mesh ledger is the MESSENGER — and it must be SELF-DESCRIBING: the event carries WHICH
  // spec + WHICH reef (content-addressed by sha) it graded, not just a bare verdict. So a node
  // anywhere can see what intent this verdict pertains to and recompute it from the reef sha.
  // It also carries the PRICEABLE metrics (off-shape · σ · tolerance) so the underwriter can price the
  // premium straight off the relay — turning a verified receipt into a sellable instrument with no
  // access to the work product. (The signature still binds them; tampering the numbers fails verify.)
  const ok = verdict === 'COHERENT' || verdict === 'IN_ROLE';
  const r = sh('node', ['scripts/mesh/mesh-post.mjs', '--type', 'VERDICT', '--node', room, '--agent', `${room}_agent`,
    '--ok', String(ok), '--tx', (specId || sha || attestationRoot || 'drift').slice(0, 16),
    '--body', JSON.stringify({ verdict, spec_id: specId, reef_sha256: reefSha, spec: specPath, attestation_root: attestationRoot, commit: sha, metrics: metrics || null })]);
  return { posted: r.status === 0, out: (r.stdout || r.stderr || '').trim().slice(0, 200) };
}

function commitMessage(sha) {
  if (!sha) return '';
  const r = sh('git', ['log', '-1', '--pretty=format:%h %s%n%n%b', sha]);
  return r.status === 0 ? r.stdout.trim() : '';
}

// ── THE DELIVERED WORK = the commit's actual changed files (NOT the bf-002 demo). ───────────
// SEMANTIC ingest per CLAUDE.md ("code→reality, comments + identifier-words, NOT raw"): the reef
// is the spec's intent; THIS is the room's reality. Grading the real reef against this is the
// whole point — without it the walk falls back to --demo and σ is a content-independent constant
// (the 67%/e61117a2 bug: every spec graded the same fixed bf-002 case). Generated artifacts
// (logs, receipts, reef dumps) are excluded so we grade what the room AUTHORED, not its exhaust.
function buildCommitManifest(sha, room) {
  if (!sha) return null;
  const names = (sh('git', ['show', '--no-color', '--pretty=format:', '--name-only', sha]).stdout || '')
    .split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => !/^\.thetacog\/|^docs\/comms\/|^data\/pmu\/reef\/|\.cost\.json$|\.log$|\.narration\.|\.ndjson$/.test(f));
  const splitWords = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ');
  const items = {};
  for (const f of names.slice(0, 40)) {
    const blob = sh('git', ['show', `${sha}:${f}`]).stdout || '';
    if (!blob || blob.length > 200000) continue;
    let text;
    if (/\.(md|mdx|txt)$/.test(f)) {
      text = blob.replace(/^---[\s\S]*?\n---/m, '').replace(/```[\s\S]*?```/g, ' '); // prose, no frontmatter/code
    } else {
      const comments = (blob.match(/\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g) || []).join(' ');
      const idents = (blob.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).join(' ');
      text = splitWords(`${comments} ${idents}`); // comments + identifier-words, not raw syntax
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) items[f] = { text: text.slice(0, 8000) };
  }
  const msg = commitMessage(sha);
  if (msg) items['_commit_message'] = { text: msg }; // the room's own statement of the delivery
  if (!Object.keys(items).length) return null;
  const p = resolve(REPO, `.thetacog/comms/commit-deliver-${sha.slice(0, 7)}.json`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ room, sha, items }, null, 2));
  return p;
}

function compose({ reef, walk, cost, drift2, cause, room, sha, commitMsg, channel }) {
  const w = walk.receipt.walk, v = walk.receipt.verdict;
  const causeLine = {
    none: 'Both tracks are inside tolerance — the room built the ask and the ask held still.',
    room_drift: 'Track A is out (the work drifted) while Track B held — this is on the delivery, not the spec.',
    spec_churn: 'Track B moved (the ask itself shifted) — weigh that before reading the work-drift as the room\'s fault.',
    both: 'Both tracks moved — the work drifted AND the ask shifted; separate them before pricing.',
  }[cause];
  const reqLines = (reef.anchors || []).map(a => {
    const gist = String(a.snippet || a.prose || a.title).replace(/\s+/g, ' ').trim().slice(0, 150);
    return `- **${a.coord} · ${a.title}** — ${gist}…`;
  }).join('\n');
  const rep = reef.report || {};
  const syn = (arr, i) => arr[i % arr.length];
  const date = arg('--date', new Date(0).toISOString().slice(0, 10).replace('1970-01-01', '2026-06-22')); // deterministic-safe
  // #14: address author-room → worker-room. The reef carries the SPEC author (from_room) and the
  // room it was delegated TO (to_room); `room` is who actually delivered. Surface both so the
  // receipt reads as a delegation: who asked → who built.
  const authorRoom = reef.from_room || 'operator';
  const workerRoom = room || reef.to_room || 'builder';
  const title = `Drift receipt — ${authorRoom} → ${workerRoom} on ${reef.spec_id} (${v}, ${w.sigma_shape_match_pct}% in-shape)`;
  const body = `---
title: ${title}
channel: ${channel}
from_room: ${authorRoom}
to_room: ${workerRoom}
date: ${date}
---

> **🔗 On-chain hash key (pin / verify):** \`${walk.attestation_root}\`
> Recompute on any machine: \`npx thetacog-mcp spec-deliver-walk --check\` → same σ, exit 0. This receipt is forwardable to an underwriter as-is — the hash key is all they pin; they re-walk to confirm.

## 0 · WHY-BELIEF

A delegated commit is only trustworthy once its drift from the spec is **measured and recomputable** — not asserted. This receipt is that measurement for ${sha ? `commit \`${sha.slice(0,9)}\`` : 'this delivery'} against the \`${reef.spec_id}\` spec: the real on-chip ballistic walk says **${v}**, with ${w.sigma_shape_match_pct}% of the delivery's shape landing inside the spec's intent shape and ${w.kill_pct}% off-shape against a ${w.tolerance_pct}% tolerance. You don't take our word for it — you re-walk it from the hash key above.

## 1 · CONNECTION

This ${syn(LEX.connection,0)} the spec you handed ${room}: the walk seeds from the spec's own intent shape and asks where the delivered work actually landed. What ${syn(LEX.connection,2)} what is the whole question — the receipt ${syn(LEX.connection,3)} reality on that map, so you see at a glance whether the commit stayed tied to what you asked or drifted to a neighbouring concern.

## 2 · CONTRIBUTION

The receipt ${syn(LEX.contribution,0)} a measurement instead of a claim: ${v === 'COHERENT' ? 'the work covered the spec' : 'where the work diverged'}, by how much, recomputable. It ${syn(LEX.contribution,2)} grade a room's delivery without re-reading the diff yourself — the walk already located it on the spec's map.

## 3 · GROWTH

Each graded commit ${syn(LEX.growth,0)} the ledger of what this room reliably delivers against specs — a track record that ${syn(LEX.growth,3)} into the room's own competence reef over time. Delegation gets cheaper the more you do it.

## 4 · UNCERTAINTY

Two tracks, read side by side — because a low score can be the spec's fault, not the room's:

- **Track A · REALITY** (did the room build it): off-shape **${w.kill_pct}%** vs **${w.tolerance_pct}%** tolerance — ${w.kill_pct <= w.tolerance_pct ? 'inside the lane' : 'past the boundary'}.
- **Track B · INTENT** (did the ask move): spec drift **${drift2.spec_drift_pct}%** (v${drift2.spec_version}${drift2.prev_sha ? ` vs ${drift2.prev_sha}` : ''}), intent-stability ${drift2.intent_stability}.
- **Attributed cause: \`${cause}\`** — ${causeLine}

${cost.options?.state ?? cost.status}. ${cost.plain_language}

## 5 · CERTAINTY

This verdict ${syn(LEX.certainty,0)}: \`npx thetacog-mcp spec-deliver-walk --check\` re-runs the same recursive walk and ${syn(LEX.certainty,3)} — same σ, exit 0. The attestation root \`${String(walk.attestation_root).slice(0,16)}…\` is posted to the mesh ledger; anyone replays it.

## 6 · SIGNIFICANCE

You stay the author; the mesh measures and carries. This receipt rode the **mesh ledger as the messenger** — the same signed event whether ${room} is a process here or a node across the web. That is what lets a project subdivide across rooms and still come back as one graded, recomputable whole.

## 7 · EVIDENCE

**The spec (${reef.spec_id}) — the intent this was graded against.** The reef below is built straight from the spec's REQUIREMENTS — one anchor per requirement — then sealed and content-addressed (\`${String(reef.sha256 || '').slice(0,12)}…\`, from spec \`${String(reef.spec_sha256 || '').slice(0,12)}…\`). The walk's intent shape is seeded from exactly these:

${reqLines}

**The reef's own contrast (gzip-NCD).** ${rep.requirements ?? (reef.anchors||[]).length} requirements → **${rep.collisions ?? 0} collisions**, mean pairwise NCD **${rep.meanPairwiseNCD ?? '—'}**, closeness ρ **${rep.closeness_rho ?? '—'}**. Low collisions and high pairwise distance mean the requirements occupy *distinct* regions of the lattice — so a delivery can actually be located against them rather than smearing across all of them.

**How it's measured — PMU and NCD, interleaved.** Two primitives, each doing the half the other can't:

- **NCD (compression) is the SENSOR — *where*.** gzip-NCD compresses the delivered text against each of the 144 ShortLex snippets: on-topic prose compresses *together* (similarity → high), unrelated prose shares nothing (→ 0). That projects both the spec's reef (intent) and this commit's files (reality) onto the lattice and lights the anchors each one actually occupies. It answers "which coordinates does this text *mean*" — decidably, no model in the path. (Canonical PRIMARY sensor; SimHash floods ~0.80 against any English and was the old σ-collapse bug.)
- **PMU (the ballistic walk) is the PROPAGATOR — the *shape*.** From NCD's strongest landings as seeds, the real recursive on-chip walk runs row → significant column → **transpose** → recurse (\`definerWalk144\`, one \`pmu-onchip --ballistic\` process per hop) to paint the full competence *shape* around those seeds — the region the spec *means*, not only the points it named.
- **The interleave.** NCD picks the seeds → PMU walks them into a shape → done **twice** (intent shape from the reef, reality shape from this commit) → **σ = the fraction of the delivery's shape that lands inside the spec's shape**. NCD alone gives isolated points with no tolerance region; PMU alone has no decidable place to start. Compression says *where*, the walk says *how much* — together they yield a tolerance you can price. This is why the verdict is **decidable** (sub-Turing ShortRank, below the line Rice's theorem needs), not merely deterministic.

**The commit — the delivered work that was graded:**

\`\`\`
${commitMsg || '(no commit message — synthetic/demo delivery)'}
\`\`\`

**The walk:** engine \`pmu-onchip --ballistic\` (real recursive on-chip; row→column→transpose→recurse), seeded from the reef's gzip-NCD landings, reached ply ${w.max_ply}, **${w.sigma_shape_match_pct}% of the delivery's shape inside the spec's**, ${w.kill_pct}% off-shape vs ${w.tolerance_pct}% tolerance → **${v}**. Cost guidance is priced by that tolerance.

## 8 · TO-DO

**Your next moves:**

- **Recompute it** — \`npx thetacog-mcp spec-deliver-walk --check\`; confirm the σ reproduces and the exit is 0 on your own machine.
- **${v === 'COHERENT' ? 'Accept the delivery' : 'Send it back or price it up'}** — the verdict is ${v}; ${w.kill_pct <= w.tolerance_pct ? 'inside tolerance, the put is out-of-the-money, accept.' : 'past tolerance, the cover attaches — renegotiate scope or re-spec.'}
- **Pin the anchor** — the attestation root is on the mesh ledger; a reinsurer pins \`${String(walk.attestation_root).slice(0,16)}…\` to bind this exact measurement.
`;
  return { body, title };
}

function main() {
  const room = arg('--room', 'builder');
  const channel = arg('--channel', 'self');
  const sha = arg('--commit', null);
  const notional = parseFloat(arg('--notional', '10000000'));
  const reefPath = arg('--reef', null);
  const specPath = arg('--spec', null);
  const deliverables = arg('--deliverables', null);

  const reef = jobReef(reefPath, specPath, room);
  const reefFile = reefPath || resolve(REPO, `data/pmu/reef/spec-reef-${reef.spec_id}.json`);
  if (!existsSync(reefFile)) { mkdirSync(dirname(reefFile), { recursive: true }); writeFileSync(reefFile, JSON.stringify(reef, null, 2)); }

  // grade the REAL reef against the REAL commit's delivered work (never the bf-002 --demo, which
  // overrides --reef and yields a content-independent constant σ). Explicit --deliverables wins.
  const deliv = deliverables || buildCommitManifest(sha, room);
  const walk = runWalk(reefFile, deliv);
  const w = walk.receipt.walk;
  // COVERAGE carried into the price: σ is placement-confidence, not low risk; low coverage ABSTAINS
  // (the anti-inversion — a vocabulary-dense negation/salad must not price cheap). null = walk did not
  // produce a per-requirement coverage (σ-only behaviour preserved). See cost-guidance.mjs.
  const cost = costGuidance({ offShapePct: w.kill_pct, tolerancePct: w.tolerance_pct, sigmaMatchPct: w.sigma_shape_match_pct, coveragePct: w.coverage ?? null, notional });
  // TRACK B (R2): did the SPEC itself move? + attribute the cause (room_drift vs spec_churn).
  const specSrc = specPath || (reef.source ? resolve(REPO, reef.source) : null);
  const drift2 = specSrc ? specDrift(specSrc) : { track: 'B/INTENT', spec_version: 1, spec_drift_pct: 0, intent_stability: 1, note: 'no spec path to track' };
  const cause = attributeCause({ workOffShapePct: w.kill_pct, workTolerancePct: w.tolerance_pct, specDriftPct: drift2.spec_drift_pct });
  const mesh = meshPost({ room, verdict: walk.receipt.verdict, attestationRoot: walk.attestation_root, sha,
    specId: reef.spec_id, reefSha: reef.sha256 || walk.reef_sha256, specPath: reef.source || specPath,
    metrics: { off_shape_pct: w.kill_pct, sigma_shape_match_pct: w.sigma_shape_match_pct, coverage: w.coverage ?? null, tolerance_pct: w.tolerance_pct, notional: notional } });

  const { body, title } = compose({ reef, walk, cost, drift2, cause, room, sha, commitMsg: commitMessage(sha), channel });
  const stem = `commit-drift-${reef.spec_id}${sha ? '-' + sha.slice(0,7) : ''}`;
  const draftPath = resolve(REPO, `docs/comms/${channel}/drafts/${stem}.md`);
  const costPath = resolve(REPO, `.thetacog/comms/${stem}.cost.json`);
  mkdirSync(dirname(draftPath), { recursive: true });
  mkdirSync(dirname(costPath), { recursive: true });
  writeFileSync(draftPath, body);
  writeFileSync(costPath, JSON.stringify(cost, null, 2));

  const B='\x1b[1m', D='\x1b[2m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
  process.stderr.write(`${B}⬡ COMMIT-DRIFT${X} ${D}— ${reef.spec_id} · ${room}${sha?' · '+sha.slice(0,9):''}${X}\n`);
  process.stderr.write(`  ${C}track A${X} ${walk.receipt.verdict} · ${w.sigma_shape_match_pct}% in-shape · ${w.kill_pct}% off vs ${w.tolerance_pct}% tol (real pmu-onchip --ballistic)\n`);
  process.stderr.write(`  ${C}track B${X} spec drift ${drift2.spec_drift_pct}% (v${drift2.spec_version}) · cause: ${B}${cause}${X}\n`);
  process.stderr.write(`  ${C}cost${X} ${cost.options?.state ?? cost.status} · premium ${cost.insurance.advisory_premium_usd ? '$'+cost.insurance.advisory_premium_usd.toLocaleString() : '$0'} · ${cost.insurance.rate_on_line_bps ?? 0} bps ROL\n`);
  process.stderr.write(`  ${C}mesh${X} ${mesh.posted ? G+'posted to ledger (the messenger)'+X : 'post skipped: '+mesh.out}\n`);
  process.stderr.write(`  ${C}email${X} draft → ${draftPath.replace(REPO+'/','')}  ${D}(cost → ${costPath.replace(REPO+'/','')})${X}\n`);
  process.stderr.write(`\n  ${D}arm + send (gated ≥95 + Ava audio + rich HTML):${X}\n`);
  process.stderr.write(`  scripts/comms/canonical-send.sh --content ${draftPath.replace(REPO+'/','')} --subject ${JSON.stringify(title)} --grade-receipt <grade.json> --cost ${costPath.replace(REPO+'/','')} --from-room --to elias@thetadriven.com --channels email,audio\n`);
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ draftPath, costPath, verdict: walk.receipt.verdict, cost, mesh }, null, 2) + '\n');
}

main();
