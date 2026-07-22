// scripts/pmu/region-narrative.mjs — Step 2 of the reflexive narrative loop
// (docs/architecture/reflexive-narrative-loop.md).
//
// qwen reads the DRIFTED regions (amber/red) + their lattice MEANINGS + the commit message and tells
// ONE story, in the operator's frame: NOT "is the work good" (quality/alignment) — but "you asked for
// PLUMBING and here it did BRAIN SURGERY." WHERE the work landed, by meaning, not WHETHER it is good.
// If the thesis is right, that story alone ties it together: the ask (message) vs the lane it drifted
// into (the drifted coordinate's meaning) — and it names where in the message to look to correct it.
//
// HARD: qwen is OFF the on-commit critical path (compiler-not-interpreter). This runs async/on-demand
// and is advisory; the walk never waits on it. Graceful: no ollama → a deterministic template story.
//
// Usage:
//   node scripts/pmu/region-narrative.mjs --demo                 # the surgeon/plumber scenario
//   node scripts/pmu/region-narrative.mjs --message "..." --json # narrate a real panel's regions
import { detectRegions } from './regions-chip.mjs';   // one functional entry (default JS; PMU_REGIONS_CHIP=auto → chip)
import { sliceMessageToRegions, loadPairLib } from './region-message.mjs';
import { coordGist } from './lattice-meaning.mjs';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// pull the REAL commit context so qwen reasons about the commit, not the generic lens:
// the message (the ask), the changelog (what changed), and the reef (the spec it aimed at).
function pullCommit(sha) {
  const sh = (cmd) => { try { return execSync(cmd, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return ''; } };
  const message = sh(`git show -s --format=%B ${sha}`);
  const changelog = sh(`git show --stat --format= ${sha}`).slice(0, 900);
  let reef = '';
  try {
    const rc = JSON.parse(readFileSync(resolve(REPO, 'docs/pmu/spec-deliver-walk-receipt.json'), 'utf8'));
    const r = rc.receipt || rc;
    reef = (r.requirements || []).map((x) => `${x.req || ''}: ${x.title || ''}`.trim()).filter(Boolean).join('\n');
  } catch { /* no reef → narrate against the message alone */ }
  return { message, changelog, reef };
}

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.IM_MODEL || 'qwen2.5:7b';
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const KIND = { 1: 'in-lane (green)', 2: 'bleed (amber)', 3: 'drift (red)' };

const VERDICT = { 1: 'on-target', 2: 'bleed', 3: 'drift' };

// THE SPEC'S OWN NAMED CATEGORIES — an explicit reef's anchors {coord,title} so the story names
// lanes by what THIS commit's OWN spec calls them ("R1 — WHY-belief opens on the information
// hazard"), NOT the generic stock-144 business lens ("Tactics determine the timing…"). The reef
// IS the universe, but ONLY the reef this commit was actually delegated against — never a reef
// picked off disk by recency. A commit with no bound reef falls back to the generic lattice lens.
//
// REGRESSION (2026-07-01): this used to glob `data/pmu/reef/spec-reef-*.json` and take whichever
// file had the newest mtime, with zero binding to the commit being narrated. With one stray file
// on disk (spec-reef-dinner.json — the /dinner page's R1..R7 categories: "Format clarity (board
// meeting)", "Research links + contact", …) EVERY commit, regardless of subject, got its regions
// forced into those categories — hence nonsense like a GTM-email commit "wandering into" board-
// meeting format. Fixed by requiring the reef to be passed in explicitly per call (see
// parseReefAnchors + the `reef` param threaded through narrateRegions/buildRegionPrompt/laneLens).
// Guard: tests/pmu-simulator/region-narrative-reef-scoping.test.mjs.
export function parseReefAnchors(reef) {
  if (!reef) return [];
  if (Array.isArray(reef)) {
    return reef.map((a) => ({ coord: String(a.coord || '').trim(), title: String(a.title || '').trim() }))
      .filter((a) => a.coord && a.title);
  }
  const text = String(reef);
  const marker = text.indexOf('REEF ANCHORS:');
  const body = marker >= 0 ? text.slice(marker + 'REEF ANCHORS:'.length) : text;
  const out = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_.\-]*)\s*:\s*(.+?)\s*$/);
    if (m) out.push({ coord: m[1], title: m[2] });
  }
  return out;
}
// the lane label — prefer THIS COMMIT'S OWN reef's name for this coord, fall back to the generic 144 lens.
function laneLens(region, reefAnchors = []) {
  const coord = String(region.coord?.center || region.coord?.label || '').trim();
  const cat = reefAnchors.find((c) => c.coord === coord);
  if (cat) return `${cat.coord} — ${cat.title}`;
  return region.meaning || coordGist(coord) || '(unnamed lane)';
}
function sliceText(region) {
  const s = (region.messageSlice || []).map(x => x.clause);
  return s.length ? s.map(c => `  • "${c}"`).join('\n') : null;
}

// ONE oval = ONE qwen call. The prompt is the region's OWN slice of the commit message (what the
// gzip placed here) read against what the sensor already decided about this region (on-target /
// bleed / drift). NOT "is the work good" — only "did THIS part of the ask land where it said it
// would." The lane lens only NAMES the lane; the substance is the verbatim clauses.
// INPUT SEQUENCING (operator 2026-07-02: "maybe the sequencing of the inputs are wrong so the
// priority does not come through"): a 7b model weights EARLY tokens — so the COMMIT comes first
// (the subject), the region's verbatim slice second (the subject matter), the sensor verdict third,
// and the lane names LAST, explicitly labeled as the lens, never the subject. Previously the commit
// message never entered this prompt at all (only the gzip slice) and the generic lane-legend led —
// the model gloss-read the lattice instead of meta-commenting on the commit.
export function buildRegionPrompt(region, reefAnchors = [], commitSubject = '') {
  const slice = sliceText(region);
  const kind = KIND[region.kind];
  const cats = reefAnchors;
  const catBlock = cats.length
    ? `THE LENS (secondary — names lanes, never the subject) — this spec's own categories; name the lane by ONE of these, never generic business terms:\n${cats.map((c) => `  • ${c.coord} — ${c.title}`).join('\n')}\n\nThis region's lane: "${laneLens(region, reefAnchors).slice(0, 160)}"`
    : `THE LENS (secondary — a generic lane name, NOT the commit): "${laneLens(region, reefAnchors).slice(0, 200)}"`;
  return `THE COMMIT (your subject — everything you write is a meta-comment ON this ask):
${commitSubject ? `"${String(commitSubject).slice(0, 300)}"` : '(subject unavailable — ground in the verbatim clauses below)'}

THE PART OF THAT ASK THE SENSOR PLACED IN THIS REGION (verbatim — your subject matter):
${slice || '  (NONE — no stated-ask text landed in this lane. The panel lit it from the code/changelog, not from anything the message promised. For a red region that itself IS the drift: the work acted here without the ask ever naming it.)'}

THE SENSOR'S VERDICT for this region: ${kind}.
  • on-target (green) = the work here matched the lane the commit declared.
  • bleed (amber)     = it landed a lane or two off what was declared.
  • drift (red)       = it fired in a lane the commit never declared (the rupture).

${catBlock}

You are localizing competence drift for THIS one oval. NOT "is the work good" (undecidable, not your job) — only WHERE this slice landed versus what the commit said. Work can be excellent and still be in the wrong lane.
Write 1–2 plain sentences telling the story of THIS slice for a busy operator:
- Tie it to the commit's ask above; NAME the lane using the lens categories (e.g. "${cats[0]?.title?.slice(0, 40) || 'the named category'}…"), not generic terms.
- on-target → what this slice set out to do and that it stayed in that named lane.
- bleed/drift → which named lane it wandered INTO, and say plainly: that lane was OUT OF SPEC for this commit (the message never promised it). If no clause landed here, say the work touched this lane though the ask never named it.
No coordinate jargon, no quality judgement.
End with exactly one line:
VERDICT: ${VERDICT[region.kind]}`;
}

const QWEN_TIMEOUT_MS = Number(process.env.NARRATE_LLM_TIMEOUT_MS) || 45000;   // wall-clock: never hang on a wedged ollama (2026-07-05)
async function callQwen(prompt) {
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(QWEN_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.response || '').trim() || null;
  } catch { return null; }
}

// deterministic per-region fallback so the loop never depends on ollama being up (and is what
// --no-qwen / useLLM:false now routes through — a lens-generated semantic dump grounded in THIS
// commit's own message-slice, never a generic or mismatched-reef snippet).
// LABEL FORM (operator 2026-07-13: "the grey text looks like LLM — make them labels, keep the
// predicted content"). Terse, structured, computed-looking: coord/verdict/ask-clause fragments,
// never flowing prose. The prose sentences read like model narration; these read like machine
// output. Content unchanged (same deterministic slice + lane), only the shape.
function templateRegion(region, reefAnchors = []) {
  const slice = (region.messageSlice || []).map(x => x.clause);
  const ask = slice.length ? `ask: "${slice[0].slice(0, 80)}"` : 'no ask-clause landed here';
  if (region.kind === 1) return slice.length
    ? `${ask} · held the declared lane`
    : `held the declared lane · not singled out by the ask`;
  return slice.length
    ? `${ask} · landed off that lane · ${VERDICT[region.kind]}`
    : `fired from the code, not the ask · lane not declared · ${VERDICT[region.kind]}`;
}

// narrate ONE region (one qwen call); returns the per-oval story + parsed verdict.
// Then a SELF-COHERENCE MONOLOGUE (operator 2026-06-27): qwen reads its OWN story back against the
// commit-message slice and says whether it COHERES — the story must be a meta-comment ON the commit
// message (seen through the reef lens), not a generic lattice gloss. An INCOHERENT verdict is the
// signal the pipeline uses to refine/re-narrate before it commits.
async function selfCoherence(region, prose) {
  const slice = (region.messageSlice || []).map((x) => x.clause).join(' · ');
  const check = await callQwen(`You wrote this one-line drift comment about a commit:
"${prose}"

The part of the commit message it is about:
${slice || '(no message text landed in this lane — the work acted where the ask was silent)'}

Is your comment a sensible META-COMMENT ON THAT COMMIT MESSAGE (what this commit said/did here), NOT a generic business-lattice gloss? Answer exactly one line:
COHERENT — <one clause why> | INCOHERENT — <what to fix>`);
  if (!check) return { coherent: null, coherence: '' };
  return { coherent: /^\s*COHERENT/i.test(check), coherence: check.trim().split('\n')[0].slice(0, 220) };
}

export async function narrateRegion(region, { useLLM = true, selfCheck = true, reefAnchors = [], commitSubject = '' } = {}) {
  let story = useLLM ? await callQwen(buildRegionPrompt(region, reefAnchors, commitSubject)) : null;
  const source = story ? `qwen (${MODEL})` : 'template';
  if (!story) story = templateRegion(region, reefAnchors);
  const verdict = (story.match(/VERDICT:\s*(on-target|bleed|drift)/i) || [, VERDICT[region.kind]])[1].toLowerCase();
  const prose = story.replace(/\n?VERDICT:.*/is, '').trim();
  const coh = (useLLM && selfCheck) ? await selfCoherence(region, prose) : { coherent: null, coherence: '' };
  return {
    n: region.n, coord: region.coord?.label, kind: KIND[region.kind], verdict, source,
    lane: laneLens(region, reefAnchors), slice: (region.messageSlice || []).map(x => ({ clause: x.clause, coord: x.coord, sigma: x.sigma })),
    story: prose, coherent: coh.coherent, coherence: coh.coherence,
  };
}

// Narrate the panel: slice the message onto the regions, then ONE qwen call per oval. We narrate
// EVERY drift region (amber/red — the signal) plus the top in-lane cores, capped so an off-critical
// async pass never fans out to dozens of calls. Returns per-oval stories + a count.
//
// `reef` — THIS COMMIT'S OWN bound reef only (a `coord: title` string, as commit-triptych.mjs
// builds from its delegated spec's anchors, or an array of {coord,title}). Absent for ordinary,
// non-delegated commits — that's correct: no reef means narrate against the generic lattice lens,
// never an unrelated spec's categories picked off disk (the 2026-07-01 regression).
export async function narrateRegions({ message, regions, reef = '', changelog = '', useLLM = true, pairLib = null, cap = 8 }) {
  const reefAnchors = parseReefAnchors(reef);
  const lib = pairLib || loadPairLib();
  const { sensor } = sliceMessageToRegions(message, regions, { pairLib: lib });
  const drift = regions.filter(r => r.kind >= 2).sort((a, b) => b.kind - a.kind || b.blocks - a.blocks);
  const inLane = regions.filter(r => r.kind === 1).sort((a, b) => b.blocks - a.blocks);
  const pick = [...drift, ...inLane].slice(0, cap);                    // drift first, then the biggest in-lane cores
  pick.forEach((r, i) => { if (r.n == null) r.n = i + 1; });           // number regions that arrived without one
  const perRegion = [];
  const commitSubject = String(message || '').split('\n').filter(Boolean).slice(0, 2).join(' — ');  // subject + first body line: the ask, LEADS every per-region prompt
  for (const r of pick) perRegion.push(await narrateRegion(r, { useLLM, reefAnchors, commitSubject }));  // sequential: kind to a single local ollama
  const source = perRegion.some(p => /^qwen/.test(p.source)) ? `qwen (${MODEL})` : 'template (ollama unavailable)';
  // a compact combined story for consumers that still want one blob (email/back-compat)
  const story = perRegion.map(p => `[${p.verdict}] ${p.story}`).join('\n') || templateRegion(regions[0] || { kind: 1, messageSlice: [] }, reefAnchors);
  const incoherent = perRegion.filter(p => p.coherent === false).length;   // stories that failed their own self-check
  return { perRegion, story, source, sensor, drift_count: drift.length, narrated: perRegion.length, incoherent };
}

// --- demo: the surgeon/plumber scenario, in the business lattice ---
function synthDriftPanel() {
  // a panel whose dominant lane is OPERATIONS-cadence (green) but with a RED cluster at the
  // legal/governance corner — i.e. "asked for operations, did legal/governance" (the surgeon/plumber).
  const N = 144, B = 12; const G = [30, 145, 80], R = [255, 59, 59];
  const rgba = new Uint8Array(N * N * 4);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const o = (r * N + c) * 4; rgba[o + 3] = 255;
    if ((r + c) % 3 !== 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 5; continue; }
    const br = Math.floor(r / B), bc = Math.floor(c / B);
    // RED block at (br 3-5, bc 3-5) ≈ coord A1..A3 × A1..A3 (the legal/governance/goal corner)
    const col = (br >= 3 && br <= 5 && bc >= 3 && bc <= 5) ? R : G;
    rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2];
  }
  return rgba;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // --from <json>: narrate from PRECOMPUTED regions + message + reef + changelog (commit-triptych
  // writes this so the narrative runs on the LIVE panel without re-running the pipeline). Off the
  // critical path: commit-triptych spawns this detached. Writes the FOCUS narrative to cache.
  const fromFile = arg('--from', null);
  if (fromFile) {
    const inp = JSON.parse(readFileSync(resolve(fromFile), 'utf8'));
    const out = await narrateRegions({ message: inp.message || '', regions: inp.regions || [], reef: inp.reef || '', changelog: inp.changelog || '', useLLM: !process.argv.includes('--no-llm') });
    const outPath = resolve(REPO, `.thetacog/cache/region-narrative-${inp.sha || 'last'}.json`);
    mkdirSync(resolve(REPO, '.thetacog/cache'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ sha: inp.sha || null, ...out }, null, 2));
    const drift = out.perRegion.filter(p => p.verdict !== 'on-target');
    console.log(`region-narrative → ${outPath.replace(REPO + '/', '')} · ${out.source} · ${out.narrated} ovals (${drift.length} drift) · sensor ${out.sensor}`);
    // --append <draftFile>: weave the PER-OVAL grounded stories INTO the email draft. Each oval is its
    // own line — its slice of the ask + whether it stayed on-target or drifted — beside the lattice.
    const appendFile = arg('--append', null);
    if (appendFile && existsSync(resolve(appendFile))) {
      const lines = out.perRegion.map(p => {
        const slice = p.slice[0] ? ` — from the ask: “${p.slice[0].clause.slice(0, 110)}”` : ' — (no stated-ask text landed here)';
        return `- **Area ${p.n} · ${p.kind} → ${p.verdict.toUpperCase()}**${slice}\n  ${p.story}`;
      }).join('\n');
      appendFileSync(resolve(appendFile), `\n\n## The story of this commit — per-oval grounded read (${out.source})\n\n${lines}\n`);
      console.log(`  ↳ appended ${out.narrated} per-oval stories → ${appendFile.replace(REPO + '/', '')}`);
    }
    process.exit(0);
  }
  const sha = arg('--commit', null);
  let message, reef = '', changelog = '';
  if (sha) {
    ({ message, reef, changelog } = pullCommit(sha));
    console.log(`  pulled real commit ${sha}: message ${message.length}c · changelog ${changelog.length}c · reef ${reef ? 'present' : 'none'}`);
  } else {
    message = arg('--message', 'Run the daily operations cadence loop: keep the execution flow moving and the deal pipeline current. Pure ops housekeeping — no policy or legal changes.');
  }
  const regions = detectRegions(synthDriftPanel());   // demo locator; real panel arrives when wired into commit-triptych
  const out = await narrateRegions({ message, regions, reef, changelog, useLLM: !process.argv.includes('--no-llm') });
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); process.exit(0); }
  console.log(`\n  THE ASK:\n  "${message.slice(0, 200)}${message.length > 200 ? '…' : ''}"\n`);
  console.log(`  ${out.narrated} OVALS narrated (${out.drift_count} drift) · source ${out.source} · sensor ${out.sensor}\n`);
  for (const p of out.perRegion) {
    const tag = p.verdict === 'on-target' ? '🟢' : p.verdict === 'bleed' ? '🟡' : '🔴';
    console.log(`  ${tag} Area ${p.n} · ${p.coord} · ${p.kind} → ${p.verdict.toUpperCase()}`);
    if (p.slice[0]) console.log(`     ↳ ask-slice (gzip): "${p.slice[0].clause.slice(0, 100)}" (σ ${p.slice[0].sigma})`);
    else console.log(`     ↳ ask-slice (gzip): (none landed here — the lane lit from code, not the ask)`);
    console.log(`     ${p.story.split('\n').join('\n     ')}\n`);
  }
}
