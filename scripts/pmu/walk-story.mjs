#!/usr/bin/env node
// scripts/pmu/walk-story.mjs — BRICK #5: the STORY + ingest analysis (the second Gemini call).
//
// Operator (2026-06-10): "we might have to run another Gemini call after that to tell a story about
// what's actually happening in the heat map... the tech needs to analyse the ingest — what files were
// used and what actually ended up in the tiles, the semantic dumps." After the chip has done the
// deterministic work (ingest → walk → σ → tolerance), an LLM reads the RESULT and narrates it for a
// human: did the code do what the message said, where did it drift, and — critically — is the INGEST
// reasonable (were the right files used, do the lit tiles make sense, or is the sensor reading garbage)?
//
// OFF the on-commit critical path (a network LLM call): flag-gated (--story), run for the email artifact,
// never in the post-commit hook. Routed through the hardened llm-prompt.sh. Graceful: no LLM → no story,
// no failure. The chip decides; the LLM only EXPLAINS — it never feeds back into the gate.
//
// @canonical-algorithm  post-walk LLM narration: feed the deterministic RESULT (commit, files, lit-tile claims, start pixel, σ, tolerance, drifted lane) to Gemini → a human story + an ingest-reasonableness verdict
// @forbidden-alternative  the LLM feeding back into the gate/walk (it only explains) · narrating without the ingest analysis (the tiles are the trust check) · running it on the on-commit critical path
// @why  the chip says WHERE the drift is; a human needs WHAT it means and whether to trust the read — and the ingest analysis is how we catch a sensor reading garbage
// @guard  tests/pmu-simulator/walk-story.test.mjs
//
// Usage (lib):  import { tellStory } from './walk-story.mjs'; const s = await tellStory(ctx)
//   ctx = { sha, message, intentFiles[], realityFiles[], tiles[], start{coord,meaning}, sigma,
//           tol{green,amber,red,tooMany}, driftLane{axis,name}, hops, changes, pattern }
//   pattern = a plain-language read of the tolerance map's GEOMETRY (where the green carpet sits by
//   lane, whether it's the canonical diagonal, which orthogonal squares the red fired in). The story
//   must make SENSE of this picture (operator 2026-06-15: "if you see a line across it with green dots,
//   the pattern is what gemini must make sense of") — tied to the diagonal tiles + the real diff.
//   insurability = the content-free PROOF read from the geometry alone (the diagonal is the policy line:
//   declared risk vs actual exposure; off-diagonal green = basis risk; red tail = uninsurable). Even
//   when the tiles grip nothing (ingest SUSPECT), the SHAPE proves the mismatch — narrate it, don't hedge.
//   changes = the diff's ADDED lines (code, else docs) — the ground truth so the STORY narrates what
//   ACTUALLY changed in this commit, not the filename. The story is read WHILE looking at the tolerance
//   panel, so it must tie each lit/drifted region in that picture to a specific edit (operator 2026-06-15:
//   "the gemini-written parts need to tell the story in terms of what is actually in the commit changes").

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const LLM = resolve(REPO, 'scripts/llm-prompt.sh');
// THE FORMAT EXEMPLAR (operator: "have Gemini rewrite a previous one to make the pattern as good as
// possible so it knows how to format"). Gemini rewrote a real prior narration into the canonical
// pattern once, offline; every future story is few-shot anchored on it — committed, not regenerated.
const EXEMPLAR_PATH = resolve(REPO, 'data/pmu/story-exemplar.txt');

function buildPrompt(ctx) {
  let exemplar = '';
  try { exemplar = readFileSync(EXEMPLAR_PATH, 'utf8').trim(); } catch { /* format guidance degrades gracefully */ }
  const tiles = (ctx.tiles || []).slice(0, 12)
    .map(t => `  ${t.coord} (${t.meaning?.slice(0, 50) || '—'}): intent="${(t.intent || '').slice(0, 60)}" reality="${(t.reality || '').slice(0, 60)}"`)
    .join('\n');
  const tol = ctx.tol || {};
  // SELF-IMPROVEMENT context (operator: the email's exec summary should make sense of what happened,
  // how we improved the seed, and discuss the measurements vs the previous). One-commit lag is fine —
  // the reef report + the measure trend are from the prior run, surfaced now.
  let selfImprove = '';
  try {
    const rep = readFileSync(resolve(REPO, '.thetacog/reef-last-report.md'), 'utf8');
    selfImprove = rep.split('\n').filter(l => /Intervention:|Result:|Tolerance impact:|New seed:/.test(l)).map(l => l.replace(/\*\*/g, '')).join('\n');
  } catch { /* no reef report yet */ }
  let trend = '';
  try {
    const rows = readFileSync(resolve(REPO, 'data/pmu/measure-history.ndjson'), 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
    if (cur && prev) trend = `σ ${cur.sigmaDrift} (prev ${prev.sigmaDrift}) · drift ${cur.driftPct}% (prev ${prev.driftPct}%) · lit ${cur.litIntent}/${cur.litReality}`;
  } catch { /* no history */ }
  return `You are explaining a PMU drift read to the engineer who just committed. The chip projected the
commit's INTENT (its message + docs = what they SAID) and REALITY (its code = what they DID) onto a
144-cell competence lattice, walked the definer chain, and measured the overlap. Below is the
DETERMINISTIC result — your job is to NARRATE it, not recompute it. Be concrete and short.

COMMIT: ${(ctx.message || '').split('\n')[0].slice(0, 100)}
INTENT files (docs/message): ${(ctx.intentFiles || []).join(', ') || '(message only)'}
REALITY files (code): ${(ctx.realityFiles || []).join(', ') || '(none)'}
START pixel: ${ctx.start?.coord || '?'} — ${ctx.start?.meaning?.slice(0, 60) || ''}
definer-walk hops: ${ctx.hops ?? '?'}
SHAPE-MATCH σ: ${ctx.sigma ?? '?'} (how much reality's heat-shape follows intent's vs random)
TOLERANCE: ${tol.green ?? 0} green (in-lane) · ${tol.amber ?? 0} amber (bleed) · ${tol.red ?? 0} red (drift) · alarm ${tol.tooMany ? 'FIRED' : 'armed'}
MOST-DRIFTED lane: ${ctx.driftLane?.name || '(none — in lane)'}
REEF SELF-IMPROVEMENT (last seed strengthened): ${selfImprove || '(none yet)'}
MEASUREMENT TREND vs previous commit: ${trend || '(no prior)'}

WHAT ACTUALLY CHANGED in this commit (the diff's ADDED lines — the ground truth; tie the drift to a REAL
edit in here, quoting the actual code/prose, never just the filename):
${(ctx.changes || '').replace(/\n{2,}/g, '\n').slice(0, 1600) || '(no added lines captured)'}

THE PATTERN IN THE TOLERANCE PANEL (the actual SHAPE the reader is looking at — make sense of THIS):
${ctx.pattern || '(no pattern read)'}

INSURABILITY (the content-free proof read from the geometry alone — the diagonal IS the policy line):
${ctx.insurability || '(no policy read)'}

The lit DIAGONAL tiles (what the SimHash sensor actually matched — the trust check on the ingest; each
tile is one lane on the map, so a green dot in a lane should correspond to its tile's meaning):
${tiles || '  (none)'}

Write THREE short sections, plain text, no markdown headers, no preamble:
SUMMARY: the SELF-IMPROVEMENT executive summary, 2-3 lines a busy operator reads alone — (1) what
HAPPENED: this commit's intent + what tolerance drifted (the named lane, or "in lane"); (2) HOW WE
IMPROVED THE SEED: the reef self-improvement above (which cell, the orthogonality gain, the tolerance
impact) — or "no reef change" if none; (3) the MEASUREMENT TREND vs the previous commit (σ/drift up or
down) and what it means for whether the instrument is getting sharper.
STORY: written to be read WHILE looking at the tolerance panel directly above it — clarity over brevity,
LONGER IS FINE (aim 4-7 sentences). (1) Verdict FIRST: in lane or drifted. (2) READ THE PATTERN literally
from THE PATTERN line above and make it MAKE SENSE — describe the actual shape (a diagonal line of green
dots · a green streak down a named lane · a red cluster in an orthogonal square) and translate what that
shape MEANS in plain words: a green diagonal = you SAID and DID the same thing in the same lane (that's
the competence); a red square at "X acting on Y" = the code reached into lane Y while the message only
talked about lane X (that's the drift). (3) Tie each lit region to a SPECIFIC change in WHAT ACTUALLY
CHANGED — quote the real function/line/prose — AND to the matching diagonal TILE's meaning, so a reader
can point at a green dot and know which edit put it there and why it belongs in that lane. (4) End with
the σ number and what it says about whether to trust the read. CRUCIAL: even if the diagonal tiles
gripped nothing distinctive (ingest SUSPECT), the GEOMETRY still proves the mismatch — read the SHAPE
(off-diagonal bands, red clusters) as the proof and STATE the drift; do NOT hedge it to "unmeasurable"
when the picture is clearly off-lane. No hedging, no generic "the system measured" — make the picture
make sense.
POLICY: 1-2 sentences — translate INSURABILITY above into the underwriter's read: the declared risk
(the pink claim / what the message named) vs the actual exposure (the red lanes the code fired in), and
whether they MATCH. Off-diagonal green = basis risk you could still price; the red tail = the part no
rider covers. End plainly: insurable at face value · priceable with a loading · or uninsurable tail.
INGEST: 2-3 sentences — judging ONLY from the tile claims above, is the ingest reasonable? Name specific
cells. End with INGEST=GOOD or INGEST=SUSPECT on its own line.
${exemplar ? `\nMATCH THIS FORMAT EXACTLY (a canonical example — copy its structure, not its facts):\n${exemplar}` : ''}`;
}

export async function tellStory(ctx) {
  if (!existsSync(LLM)) return null;
  // SKIP THE MONOLOGUE BY DEFAULT (2026-06-19, operator: "skip the monologue for now"). The on-commit
  // LLM narration is opt-in behind .thetacog/commit-monologue.on so it can't slow or break the email
  // path while we settle the backend. The triptych + tolerance panel ship regardless (the chip read
  // stands without the prose). Re-enable: `touch .thetacog/commit-monologue.on`.
  if (!existsSync(resolve(REPO, '.thetacog/commit-monologue.on'))) return null;
  try {
    // Claude comments while we're actively self-improving (the flag); a LOCAL OLLAMA model otherwise
    // (2026-06-19, operator). Two reasons: (1) Gemini CLI is dead (free tier IneligibleTierError); (2)
    // grading the output of a LESS-CAPABLE local model is itself a forcing function — correcting a weak
    // draft makes the operator write better, the same capability-tell that makes a small model flip.
    // Override the model with OLLAMA_MODEL; default to the small qwen2.5:7b (the deliberately-weak grader).
    const selfImprove = existsSync(resolve(REPO, '.thetacog/reef-self-improve.on'));
    const cli = selfImprove ? 'claude -p' : `ollama run ${process.env.OLLAMA_MODEL || 'qwen2.5:7b'}`;
    const env = { ...process.env, LLM_PROMPT_CLI: cli, LLM_PROMPT_TIMEOUT: process.env.LLM_PROMPT_TIMEOUT || '180' };
    delete env.CLAUDECODE;   // the claude -p inheritance trap
    const raw = execFileSync('bash', [LLM, buildPrompt(ctx)], { encoding: 'utf8', maxBuffer: 5e8, env });
    const text = String(raw).trim();
    if (text.length < 20) return null;
    const verdict = /INGEST\s*=\s*SUSPECT/i.test(text) ? 'SUSPECT' : /INGEST\s*=\s*GOOD/i.test(text) ? 'GOOD' : 'UNKNOWN';
    return { text, ingestVerdict: verdict };
  } catch (e) { return { text: '', ingestVerdict: 'ERROR', error: String(e.message).slice(0, 140) }; }
}

// CLI: self-demo with a synthetic context (no chip needed) — prints the story.
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = {
    sha: 'demo', message: 'feat(pmu): the heat-cosine shape overlap', intentFiles: ['walkthrough.md'], realityFiles: ['commit-triptych.mjs'],
    start: { coord: 'C3,C3', meaning: 'the rate committed work crosses the finish line' }, hops: 160, sigma: 2.4,
    tol: { green: 55, amber: 34, red: 0, tooMany: false }, driftLane: null,
    tiles: [{ coord: 'C3,C3', meaning: 'flow / throughput', intent: 'the shape is the overlap of the heatmaps', reality: 'cosine of the two heat vectors' }],
  };
  tellStory(demo).then(s => console.log(s ? `[ingest=${s.ingestVerdict}]\n${s.text}` : '(no LLM available)'));
}
