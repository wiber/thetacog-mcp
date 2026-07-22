#!/usr/bin/env node
// scripts/pmu/intervene.mjs — THE PORTABLE INTERVENTION LOOP (works in ANY repo that installed
// the package: `npx thetacog-mcp intervene`).
//
// The drift receipt is LLM-free and deterministic; the INTERVENTION is the sanctioned knock-on
// that fires when a commit's receipt lands OUT of its lane — sensemaking + self-improvement,
// never just storytelling. Same contract as the monorepo engine, zero monorepo dependencies:
//
//   1. MEASURE (deterministic, the real pipeline): reality = the commit's code read from the
//      IMMUTABLE commit (`git show <sha>:<file>` — never the mutable tree), intent = the
//      README-as-spec. runPipeline → driftPct · σ · located coords. EVERY run appends the row to
//      .thetacog/interventions/drift-history.ndjson — the series the closed loop measures against.
//   2. GATE + COUNT: out-of-lane (driftPct > kill, default 25) appends ONE countable event to
//      .thetacog/interventions/events.ndjson (dedup per sha, before any model runs).
//   3. SENSEMAKE (the LLM, bounded + model-pinned): maximal context — full commit message,
//      bounded diff, the receipt facts, the README-spec excerpt, prior lessons WITH measured
//      outcomes — and the full question set (semantic pull · boundary-failure class · lesson ·
//      MISSING GUARD · reef-vs-walk attribution · dictionary adds · mechanical payload).
//      INTERVENE_LLM=claude (pinned model) | gemini | none. Facts-only fallback, never blocks.
//   4. PUBLISH: .thetacog/interventions/stories/<sha>.json + a human-readable receipt on stdout.
//   5. CLOSE THE LOOP (measure, don't assert): --verify (also run at each fire) computes each
//      prior story's driftPct mean before→after from drift-history + gzip dictionary ABLATION,
//      writes `outcome` back — and the NEXT prompt reads it. The LLM never grades itself.
//
// Flags: --sha <sha=HEAD> · --kill <pct=25> · --llm claude|gemini|none · --spec <README.md> ·
//        --verify (only run the outcome measurement) · --dry (no LLM, no ledger writes)
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './pipeline.mjs';
import { assessDrift, nameDriftCoords, KILL_PCT } from './spec-drift-check.mjs';

const REPO = process.cwd();                      // the repo being measured (any repo)
const DIR = resolve(REPO, '.thetacog/interventions');
const HIST = resolve(DIR, 'drift-history.ndjson');
const EVENTS = resolve(DIR, 'events.ndjson');
const STORIES = resolve(DIR, 'stories');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const git = (...a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 }); } catch { return ''; } };
const readNd = (p) => { try { return readFileSync(p, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

// ── 1. MEASURE — reality from the IMMUTABLE commit, intent = README-as-spec ────────────────────
export async function measureCommit(sha, specPath) {
  const files = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean)
    .filter(f => /\.(mjs|js|ts|tsx|jsx|py|rs|sh|sol|go|java|rb)$/.test(f));
  const realityText = files.map(f => git('show', `${sha}:${f}`)).join('\n').slice(0, 200_000);
  const intentText = existsSync(specPath) ? readFileSync(specPath, 'utf8') : '';
  if (!realityText || !intentText) return null;
  const r = await runPipeline({ intentText, realityText });
  const driftPct = r.stages?.xor?.drift_pct ?? 0;
  const sigma = r.stages?.sigma?.sigma ?? 0;
  return { files, driftPct, sigma, band: r.stages?.sigma?.band ?? '—', coords: nameDriftCoords(r.stages?.walk) };
}

// ── 3. the PROMPT — the portable context maximizer (same question set as the monorepo engine) ──
export function buildPrompt({ sha, m, kill, specPath, stories }) {
  const msg = git('log', '-1', '--format=%B', sha).trim();
  let diff = git('show', '--format=', sha, '--', ...m.files.slice(0, 8));
  const dl = diff.split('\n'); if (dl.length > 220) diff = dl.slice(0, 220).join('\n') + `\n… [truncated at 220 of ${dl.length} lines]`;
  const spec = (existsSync(specPath) ? readFileSync(specPath, 'utf8') : '').slice(0, 4000);
  const prior = stories.slice(0, 3).map(s =>
    `  - ${s.sha}: ${s.lesson || s.why || '(no lesson)'}${s.outcome ? ` · MEASURED OUTCOME: driftPct mean ${s.outcome.drift_before}→${s.outcome.drift_after} (${s.outcome.n_after} commits since)${s.outcome.dict_benefit_bytes != null ? ` · dict ablation ${s.outcome.dict_benefit_bytes}B` : ''}` : ' · outcome not yet measured'}`
  ).join('\n') || '  (none yet)';

  return `You are the INTERVENTION engine for a deterministic drift-receipt pipeline. This commit's receipt landed OUT of its lane vs the README-as-spec (driftPct=${m.driftPct.toFixed(1)}, kill threshold ${kill}). The receipt is LLM-free and already computed; your job is the knock-on: SENSEMAKING + SELF-IMPROVEMENT, never just storytelling. You are a forensic diagnostic engine AND an automated refactoring agent — stay on the POSITIONAL-drift axis; never claim to be a semantic-meaning oracle.

== THE EVENT ==
sha ${sha.slice(0, 9)} · driftPct ${m.driftPct.toFixed(1)} (kill ${kill}) · σ ${m.sigma.toFixed(2)} (${m.band}) · drift located at: ${m.coords.join(' · ') || 'unnamed coords'}

== COMMIT MESSAGE (full — the commit's CLAIMED intent) ==
${msg}

== DIFF (bounded — the ACTUAL work) ==
${diff || '(no code diff)'}

== THE SPEC (README-as-spec excerpt — the intent lane the receipt measured against) ==
${spec}

== PRIOR INTERVENTIONS (do NOT repeat these lessons — their measured outcomes tell you what already worked or failed; escalate) ==
${prior}

== YOUR JOB — answer ALL, grounded ONLY in the evidence above ==
1. WHY: reconstruct the semantic pull — which exact terms/structures in the DIFF dragged placement toward the located coords.
2. BOUNDARY FAILURE class — exactly one of "intentional" | "structural" | "mistagged" (spec stale ⇒ "mistagged": the work is fine, the claimed lane/spec is wrong).
3. INTENT-REALITY GAP: the contradiction between the commit's claim and the measurement.
4. HOW FIXED: restore alignment — annotate the code in-lane, or update the README-spec section that is stale.
5. CHECKLIST: 2-6 concrete file-level patches.
6. LESSON: the ONE durable takeaway, NEW relative to the prior lessons above.
7. MISSING GUARD: the single test/gate/rule that would have prevented this event class (empty string only if none makes sense) — the primary deliverable.
8. PIPELINE PROBE — experiment on the detector itself: reef_signal_pct/walk_signal_pct (integers, sum 100 — gzip-NCD reef placement vs recursive ballistic-walk spread, with rationale), walk_utilization (too shallow, saturated, or right-sized — one adjustment), reef_tightening (1-3 runnable experiments with measurable outcomes), compression_dictionary_adds (0-5 LITERAL repeated template strings copied from the diff — these get gzip-ablation-tested deterministically).
9. MECHANICAL INTERVENTION: file_movements [{source_path,target_path,rationale}] + configuration_updates [{file,injected_glob_or_rule}] — e.g. the README section to annotate; empty arrays when not warranted.
10. INSURABILITY: one sentence — what this event does to the lane's premium and what restores it.

NOTE ON NUMBERS: do NOT invent a drift-improvement number — the pipeline measures outcomes itself (drift-history trend + dictionary ablation) and feeds the MEASURED result into the next intervention. Your job is hypotheses precise enough to be tested.

Reply with ONLY a JSON object, no fence:
{"why_out_of_lane":"...","semantic_pull":"...","boundary_failure":"intentional|structural|mistagged","intent_reality_gap":"...","how_fixed":"...","checklist":["..."],"lesson":"...","missing_guard":"...","pipeline_probe":{"reef_signal_pct":0,"walk_signal_pct":0,"reef_vs_walk_rationale":"...","walk_utilization":"...","reef_tightening":["..."],"compression_dictionary_adds":["..."]},"mechanical_intervention":{"file_movements":[],"configuration_updates":[]},"insurability":"..."}`;
}

// bounded, model-pinned LLM dispatch — node spawnSync timeout (portable; no GNU timeout needed)
function sensemake(prompt, llm) {
  if (llm === 'none') return null;
  // scrub CLAUDE*/ANTHROPIC* — a nested `claude -p` inside a Claude Code session hangs otherwise
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k)));
  const cmd = llm === 'gemini'
    ? ['gemini', ['prompt', prompt]]
    : ['claude', ['-p', '--model', 'claude-sonnet-5', '--output-format', 'text', prompt]];
  const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', timeout: 240_000, env, maxBuffer: 1 << 24 });
  const m = String(r.stdout || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── 5. the CLOSED LOOP — measured, never self-graded ───────────────────────────────────────────
export function verifyStories({ minAfter = 3, corpusN = 20 } = {}) {
  if (!existsSync(STORIES)) return 0;
  const hist = readNd(HIST);
  const gz = (s) => gzipSync(Buffer.from(s)).length;
  const corpus = git('log', `-${corpusN}`, '--format=%H').trim().split('\n').filter(Boolean)
    .map(sha => git('show', '--format=%B', sha).slice(0, 20000)).filter(Boolean);
  let n = 0;
  for (const f of readdirSync(STORIES).filter(f => f.endsWith('.json'))) {
    const p = resolve(STORIES, f);
    let s; try { s = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (!s || s.outcome) continue;
    const t = Date.parse(s.ts);
    const before = hist.filter(h => Date.parse(h.ts) < t && Date.parse(h.ts) > t - 7 * 864e5).map(h => h.driftPct);
    const after = hist.filter(h => Date.parse(h.ts) > t && h.sha !== s.sha).map(h => h.driftPct);
    if (after.length < minAfter) continue;
    const mean = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
    const outcome = { drift_before: mean(before), drift_after: mean(after), n_before: before.length, n_after: after.length, measured_at: new Date().toISOString() };
    const dict = (s.pipeline_probe?.compression_dictionary_adds || []).filter(x => typeof x === 'string' && x.length >= 8).join('\n');
    if (dict && corpus.length) {
      const gzD = gz(dict);
      outcome.dict_benefit_bytes = corpus.reduce((sum, text) => sum + (gz(text) - (gz(dict + '\n' + text) - gzD)), 0);
      outcome.dict_corpus_n = corpus.length;
    }
    s.outcome = outcome;
    writeFileSync(p, JSON.stringify(s, null, 2));
    n++;
    console.log(`✅ verified ${s.sha}: driftPct ${outcome.drift_before}→${outcome.drift_after} (n=${outcome.n_after})${outcome.dict_benefit_bytes != null ? ` · dict ${outcome.dict_benefit_bytes}B` : ''}`);
  }
  return n;
}

async function main() {
  mkdirSync(STORIES, { recursive: true });
  if (has('--verify')) { const n = verifyStories(); console.log(`intervene --verify: ${n} newly measured`); return; }

  const sha = git('rev-parse', arg('--sha', 'HEAD')).trim();
  if (!sha) { console.error('intervene: not a git repo / bad --sha'); process.exit(0); }
  const shaShort = sha.slice(0, 9);
  const kill = Number(arg('--kill', process.env.INTERVENE_KILL || KILL_PCT));
  const specPath = resolve(REPO, arg('--spec', process.env.SPEC_README || 'README.md'));
  const dry = has('--dry');

  const m = await measureCommit(sha, specPath);
  if (!m) { console.log('intervene: nothing to measure (no code files or no spec) — advisory, exit 0.'); return; }

  // EVERY run feeds the history series — this is what the closed loop measures against.
  if (!dry) appendFileSync(HIST, JSON.stringify({ ts: new Date().toISOString(), sha: shaShort, driftPct: +m.driftPct.toFixed(1), sigma: +m.sigma.toFixed(2) }) + '\n');

  const { verdict, rupture } = assessDrift({ driftPct: m.driftPct, sigma: m.sigma, killPct: kill });
  console.log(`${rupture ? '🛑' : verdict === 'BLEED' ? '🟡' : '✅'} intervene: ${verdict} · driftPct ${m.driftPct.toFixed(1)} (kill ${kill}) · σ ${m.sigma.toFixed(2)} · ${m.coords.join(' · ') || 'no located coords'}`);
  if (!rupture) { verifyStories(); return; }                       // in-lane → still close the loop on priors

  // COUNT (dedup per sha, before any model)
  if (readNd(EVENTS).some(e => e.sha === shaShort)) { console.log('intervene: already counted — once per sha.'); return; }
  if (!dry) appendFileSync(EVENTS, JSON.stringify({ ts: new Date().toISOString(), sha: shaShort, driftPct: +m.driftPct.toFixed(1), subject: git('log', '-1', '--format=%s', sha).trim() }) + '\n');

  // SENSEMAKE — maximal context, prior outcomes included
  const stories = readdirSync(STORIES).filter(f => f.endsWith('.json')).sort().reverse()
    .map(f => { try { return JSON.parse(readFileSync(resolve(STORIES, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  const prompt = buildPrompt({ sha, m, kill, specPath, stories });
  if (has('--print-prompt')) { console.log(prompt); return; }
  const llm = dry ? 'none' : arg('--llm', process.env.INTERVENE_LLM || 'claude');
  const j = sensemake(prompt, llm) || {};

  const story = {
    sha: shaShort, day: new Date().toISOString().slice(0, 10), driftPct: +m.driftPct.toFixed(1), sigma: +m.sigma.toFixed(2), coords: m.coords,
    subject: git('log', '-1', '--format=%s', sha).trim(),
    why: j.why_out_of_lane || '(sensemaking unavailable — facts-only intervention)',
    semantic_pull: j.semantic_pull || '', boundary_failure: j.boundary_failure || '', intent_reality_gap: j.intent_reality_gap || '',
    how: j.how_fixed || '', checklist: Array.isArray(j.checklist) ? j.checklist : [],
    lesson: j.lesson || '', missing_guard: j.missing_guard || '',
    pipeline_probe: j.pipeline_probe || null, mechanical_intervention: j.mechanical_intervention || null,
    insurability: j.insurability || '', ts: new Date().toISOString(),
  };
  if (!dry) writeFileSync(resolve(STORIES, `${shaShort}.json`), JSON.stringify(story, null, 2));

  // the human-readable receipt (stdout is the surface in a stranger's repo — no email dependency)
  console.log(`\n🛠️  INTERVENTION — out-of-lane receipt, sensemade`);
  console.log(`   ${story.subject}\n   ${shaShort} · driftPct ${story.driftPct} (kill ${kill})${story.boundary_failure ? ` · ${story.boundary_failure}` : ''}`);
  console.log(`   WHY: ${story.why}`);
  if (story.semantic_pull) console.log(`   PULL: ${story.semantic_pull}`);
  if (story.how) console.log(`   FIX: ${story.how}`);
  for (const c of story.checklist) console.log(`     ☐ ${c}`);
  if (story.lesson) console.log(`   LESSON: ${story.lesson}`);
  if (story.missing_guard) console.log(`   MISSING GUARD (the deliverable): ${story.missing_guard}`);
  if (story.pipeline_probe?.reef_signal_pct != null) console.log(`   PROBE: reef ${story.pipeline_probe.reef_signal_pct}% · walk ${story.pipeline_probe.walk_signal_pct}% — ${story.pipeline_probe.reef_vs_walk_rationale || ''}`);
  console.log(`   story → .thetacog/interventions/stories/${shaShort}.json · events → ${readNd(EVENTS).length} counted`);

  // ── QC DELEGATION — the out-of-lane QC belongs to a ROOM, not to this fire. It routes to
  // 🧪 laboratory (the reef/PMU/verify lane — the SAME room spec-drift-check uses) via the delegation
  // door (bifurcate → rooms JSON + signed mesh, NEVER a git branch). Best-effort: in a stranger's repo
  // there's no bifurcate.mjs, so it just NAMES the room; in ours it delegates. The room is deliberately
  // OBVIOUS so a human or another model (e.g. Fable) can shore it up from the laboratory end.
  // LENS-DETERMINED ROOM (operator 2026-07-12: "qc to wherever the spec belongs · say so in the lens"):
  // the drift's dominant coordinate → the room that OWNS that tesseract cell. Not hardcoded — the lens
  // places the drift, the placement names the room. Falls back to laboratory if no cell is legible.
  const ROOM_BY_CELL = { A1: ['vault', '🔒'], A2: ['architect', '📐'], A3: ['performer', '🎭'], B1: ['navigator', '🧭'], B2: ['network', '☕'], B3: ['voice', '🎤'], C1: ['builder', '🔨'], C2: ['laboratory', '🧪'], C3: ['operator', '🎩'] };
  const tally = {}; for (const c of (story.coords || [])) { const mm = String(c).match(/\b([ABC][123])\b/); if (mm) tally[mm[1]] = (tally[mm[1]] || 0) + 1; }
  const topCell = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || 'C2';
  const [QC_ROOM, QC_EMOJI] = ROOM_BY_CELL[topCell] || ['laboratory', '🧪'];
  console.log(`\n   🔀 QC → ${QC_EMOJI} ${QC_ROOM} — the lens places this drift at ${topCell}, so its QC is OWNED by the ${QC_ROOM} room (say so in the lens).`);
  if (!dry) {
    try {
      execFileSync('node', [resolve(REPO, 'scripts/bifurcate.mjs'),
        '--to', QC_ROOM,
        '--action', `QC out-of-lane drift ${shaShort} (${story.driftPct}% off-lane · ${story.boundary_failure || 'unclassified'}) at ${(story.coords || []).join(', ') || 'unnamed coords'}`,
        '--context', `Intervention receipt: ${story.subject}. WHY: ${story.why}. Missing guard: ${story.missing_guard || '(none named)'}. Verify the drift is real, ship the guard, and if boundary_failure=mistagged FIX the README-as-spec — poor spec ⇒ poor detection ⇒ poor intervention. Story: .thetacog/interventions/stories/${shaShort}.json`,
        '--commit'], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
      console.log(`   ✅ delegated to ${QC_EMOJI} ${QC_ROOM} (bifurcate — rooms JSON + signed mesh). Shore it up from the laboratory end.`);
    } catch (e) { console.log(`   (bifurcate unavailable here — ${String(e.message).slice(0, 50)}; the QC room is still ${QC_EMOJI} ${QC_ROOM}).`); }
  }

  verifyStories();   // each fire closes the loop on its predecessors
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch(e => { console.error('intervene:', e.message); process.exit(0); });
