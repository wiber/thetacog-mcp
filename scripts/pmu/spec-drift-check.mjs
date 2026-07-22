#!/usr/bin/env node
// scripts/pmu/spec-drift-check.mjs — README-AS-SPEC drift check (ADVISORY, never blocks).
//
// THE IDEA (operator, 2026-07-11): the package README is the SPEC. The same drift engine that
// measures a commit's intent-vs-reality now measures CODE-vs-README-SPEC. If the pushed code has
// drifted from the README-spec, that is a signal the code was not annotated to its spec — because
// annotated-to-spec code CORRESPONDS to the README (it places in-lane). Drift = the missing
// annotation, LOCATED on the 144 lattice.
//
// POLICY (operator decision, 2026-07-11): ADVISORY only — it NEVER blocks the push (honors the
// guarded non-blocking pre-push invariant). Instead, on a rupture it AUTO-TRIGGERS a next-cycle
// investigation via the delegation door (bifurcate → rooms JSON + signed mesh, NEVER a git branch),
// which comes to rest at the all-systems check. This is the SELF-IMPROVING FIRE contract: diagnose
// (locate the drift coords) → escalate with repro context (bifurcate) → prevention is the guard.
//
// Run:
//   node scripts/pmu/spec-drift-check.mjs              # reality = code changed in @{u}..HEAD
//   node scripts/pmu/spec-drift-check.mjs --range HEAD~1..HEAD
//   node scripts/pmu/spec-drift-check.mjs --no-fire    # skip the auto-investigation bifurcate
// Always exits 0. LLM-free, deterministic (the receipt is a pure function of the inputs).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runPipeline } from './pipeline.mjs';
import { coordName } from './shortlex-names.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.cwd();   // the repo being checked (cwd) — correct in a stranger's repo AND ours
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
// The SPEC is the repo's README. Override with --readme <path> or SPEC_README (our monorepo points at
// the package README). Default = <cwd>/README.md — the README-as-spec for any repo that installs the hook.
const README = resolve(REPO, arg('--readme', process.env.SPEC_README || 'README.md'));

// The tolerance floor the commit receipt uses: off-lane above 25% is a rupture, not tolerated bleed.
export const KILL_PCT = 25;

// PURE, TESTABLE CORE — classify a drift measurement against the tolerance floor.
export function assessDrift({ driftPct, sigma, killPct = KILL_PCT }) {
  const rupture = driftPct > killPct;                 // left the lane past tolerated bleed
  const verdict = rupture ? 'RUPTURE' : (driftPct > killPct * 0.6 ? 'BLEED' : 'IN-LANE');
  return { rupture, verdict, driftPct, sigma };
}

// name the top off-lane coordinates (the WHERE), LLM-free — the reality cells the code lit that the
// README-spec did NOT (done-not-declared = code beyond the spec = the missing annotation, located).
export function nameDriftCoords(walk, limit = 6) {
  const toArr = (v) => Array.isArray(v) ? v : [];
  const intent = new Set(toArr(walk?.intent_lit_nodes).map(Number));
  const reality = toArr(walk?.reality_lit_nodes).map(Number);
  if (!reality.length) return [];
  const cell = reality.some(n => n >= 144);            // >=144 → 144×144 cell index; else bare anchor
  const freq = new Map();                              // count off-lane weight per row-anchor (the actor)
  for (const n of reality) {
    if (intent.has(n)) continue;                        // in-lane — code the spec covers
    const anchor = cell ? Math.floor(n / 144) % 144 : n % 144;
    freq.set(anchor, (freq.get(anchor) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([a]) => { try { return coordName(a); } catch { return `#${a}`; } });
}

async function main() {
  if (!existsSync(README)) { console.error('spec-drift: README not found:', README); process.exit(0); }
  const range = arg('--range', null);
  const fire = !process.argv.includes('--no-fire');

  // REALITY = the code being pushed/committed (commit-scoped, never whole-repo — the fast chip path).
  let files = [];
  try {
    const spec = range || `@{u}..HEAD`;
    files = execFileSync('git', ['diff', '--name-only', spec], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { /* no upstream / first push */ }
  if (!range && !files.length) {
    try { files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean); } catch {}
  }
  const codeFiles = files.filter(f => /\.(mjs|js|ts|tsx|jsx|py|rs|sh|sol)$/.test(f) && existsSync(resolve(REPO, f)));
  if (!codeFiles.length) { console.log('📐 spec-drift: no code files in range — nothing to check (advisory).'); process.exit(0); }

  const realityText = codeFiles.map(f => { try { return readFileSync(resolve(REPO, f), 'utf8'); } catch { return ''; } })
    .join('\n').slice(0, 200_000);                     // bounded — the fast chip path, never the LLM path
  const intentText = readFileSync(README, 'utf8');

  const r = await runPipeline({ intentText, realityText });
  const driftPct = r.stages?.xor?.drift_pct ?? 0;
  const sigma = r.stages?.sigma?.sigma ?? 0;
  const band = r.stages?.sigma?.band ?? '—';
  const agreement = r.stages?.walk?.agreement_pct ?? null;
  const where = nameDriftCoords(r.stages?.walk);
  const { rupture, verdict } = assessDrift({ driftPct, sigma });

  const icon = rupture ? '🛑' : (verdict === 'BLEED' ? '🟡' : '✅');
  console.log(`${icon} README-AS-SPEC drift: ${verdict} · off-lane ${driftPct.toFixed(1)}% (kill ${KILL_PCT}%) · σ ${sigma.toFixed(2)} (${band})${agreement != null ? ` · shape-match ${agreement}%` : ''}`);
  console.log(`   reality = ${codeFiles.length} code file(s): ${codeFiles.slice(0, 5).join(', ')}${codeFiles.length > 5 ? ' …' : ''}`);
  if (where.length) console.log(`   drift located at: ${where.join(' · ')}`);
  console.log(`   ⚠️  REMINDER (to the pushing agent): README is the spec. Drift here means the code is not annotated to its spec — either update the README-spec to cover this, or annotate the code so it places in-lane. Recompute: node scripts/pmu/spec-drift-check.mjs`);

  // BLEED (amber) — warn + the rerun-investigation prompt for Claude (RED gets the full fire below).
  // Both bleed and red must carry the warn + the "rerun investigation" prompt, never silent.
  if (verdict === 'BLEED') {
    console.log(`\n🟡 BLEED WARN — drift is tolerated but trending off-lane at ${where.join(', ') || 'unnamed coords'} (${driftPct.toFixed(1)}%, kill ${KILL_PCT}%).`);
    console.log(`   🔁 RERUN-INVESTIGATION (for Claude): read the code AND the README-spec at these coordinates — is the spec stale, or is the code drifting toward a rupture? Rerun any time: npx thetacog-mcp spec-drift`);
  }

  // SELF-IMPROVING FIRE: on rupture, print the "get to work" prompt LOUDLY (works in ANY repo — this is
  // what an onboard LLM reads) AND, if the delegation door exists, escalate a next-cycle investigation
  // via bifurcate (never blocks, never a git branch). Comes to rest at the all-systems check.
  let sha = 'HEAD'; try { sha = execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch {}
  if (rupture) {
    // ALERT THE HUMAN (not a silent commit): write a standardized investigation stub the dashboard
    // surfaces + the investigating LLM fills in. It is either a SPEC problem or an EXECUTION problem.
    try {
      const invDir = resolve(REPO, '.thetacog/investigations');
      mkdirSync(invDir, { recursive: true });
      const stub = `# 🛑 Spec-drift investigation — ${sha}\n\n` +
        `- **triggered:** README-as-spec rupture on push \`${sha}\`\n` +
        `- **off-lane:** ${driftPct.toFixed(1)}% (kill ${KILL_PCT}%) · σ ${sigma.toFixed(2)} (${band})\n` +
        `- **located at:** ${where.join(' · ') || 'unnamed coords'}\n` +
        `- **code:** ${codeFiles.slice(0, 8).join(', ')}\n\n` +
        `## The one question — SPEC STALE or CODE OVERREACH?\n` +
        `The deterministic walk points at the map; the heavy LLM tells the why. Read the code AND the\n` +
        `README-spec at these coordinates and write the verdict below (maybe the instrument is wrong — say so):\n\n` +
        `**Verdict:** _(unfilled — a healthy project closes this to zero)_\n`;
      writeFileSync(resolve(invDir, `${sha}-spec-drift.md`), stub);
      console.log(`\n📂 investigation opened → .thetacog/investigations/${sha}-spec-drift.md (surfaces on the dashboard — ALERT THE HUMAN)`);
    } catch { /* never block over a write */ }
    console.log(`\n🛑 GET TO WORK — README-as-spec RUPTURE on ${sha} (${driftPct.toFixed(1)}% off-lane at ${where.join(', ') || 'unnamed coords'}).`);
    console.log(`   The deterministic PMU walk caught a rupture between the README-spec (intent) and this code (reality).`);
    console.log(`   Look at the code AND the README-spec and tell the narrative story: is the SPEC STALE (update the README) or did the CODE OVERREACH (annotate/fix it in-lane)? Maybe the instrument is wrong — say so.`);
    console.log(`   The push already went through — this is an advisory investigation, not a block.\n`);
  }
  if (rupture && fire) {
    try {
      execFileSync('node', ['scripts/bifurcate.mjs',
        '--to', 'laboratory',
        '--action', `GET TO WORK: narrate the README-as-spec rupture (${driftPct.toFixed(0)}% off-lane) at ${where.join(', ') || 'unnamed coords'}`,
        '--context', `The deterministic PMU walk caught a rupture between the README-spec (intent) and push ${sha} (reality): off-lane ${driftPct.toFixed(1)}% (kill ${KILL_PCT}%), σ ${sigma.toFixed(2)}, located at ${where.join(', ') || 'unnamed coords'}. Code files: ${codeFiles.slice(0, 8).join(', ')}. Look at the code AND the README-spec and tell the narrative story of what happened here: is the SPEC STALE (README doesn't yet describe this code → update the spec) or did the CODE OVERREACH (it did something its spec never authorized → annotate/fix the code so it places in-lane)? Maybe the instrument is wrong — say so. The deterministic engine points at the map; you tell the why. Comes to rest at the next all-systems check (a healthy project has zero open spec-drift investigations).`,
        '--commit'], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
      console.log(`   🔀 auto-queued a spec-drift investigation for the laboratory room (bifurcate) — comes to rest at the all-systems check.`);
    } catch (e) { console.log(`   (bifurcate skipped: ${String(e.message).slice(0, 80)})`); }
  }
  process.exit(0);   // ADVISORY — never blocks the push
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
