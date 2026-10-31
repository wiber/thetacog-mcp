// packages/thetacog-mcp/scripts/tape/ask.mjs — THE LOOP, IN ONE COMMAND.
//
// Operator, 2026-08-20, describing the whole thing in one sentence:
//   "Using everything we've done so far as the thing that works as closely as possible to the rust
//    pipeline — ingest the text mass, whatever that is, make it selectable in this filthy UX, take
//    out the most load-bearing question, the most constraining question, the most high-level
//    directive question, and ask for the user feedback. After that has been applied, use that to
//    build the spec AND the foundation at the same time. You see how that works?"
//
// ── THE SHAPE, AND WHY IT IS ONE ACT AND NOT TWO ──────────────────────────────────────────────
// The SPEC is the accumulating coordinates. The FOUNDATION is what agents build from each one. They
// are not two phases — locking a coordinate IS writing the spec, and it is also what dispatches the
// agent. One answer from the operator produces both. That is why this is one command: any seam here
// would let the spec drift from what was built, which is the exact thing the tape exists to prevent.
//
//   ingest → select → extract the question → ASK → (lock the coordinate + fire the agent)
//
// ── WHY IT WORKS FOR PROBLEMS NOBODY HAS SOLVED ───────────────────────────────────────────────
// Drift measurement needs something to drift FROM. For a solved problem you write a spec up front.
// For an unsolved one there is no spec — that is what makes it unsolved. So the reference has to be
// ACCUMULATED: one recorded decision at a time, each constraining degrees of freedom, until there is
// enough mass to have a centre line. Only then does drift mean anything. The measurement comes second
// BY NECESSITY, not by preference.
//
// ── ANTI-REGRESSION, NOT JUST ENTROPY REDUCTION ───────────────────────────────────────────────
// Operator: "there's a sort of anti-normalisation, anti-regression thing that needs to happen...
// some decisions in the mass make other decisions more likely... that highlighted uniqueness and the
// power of the strength and the precision."
// Entropy reduction is symmetric — it scores every collapse of the space equally. But the MEAN is
// where projects go to die: a decision that narrows toward the generic centre has reduced entropy and
// destroyed the thing. The coordinates worth locking are the ones that move AWAY from what a competent
// generic system would have chosen, because those are the ones whose conditioning power makes a whole
// family of downstream decisions near-determined. The repo already measures distance-from-generic —
// buildTriptychInputs runs 12 IMPOSTORS against every real pair and the shape-match σ is read against
// that null. That is the anti-regression instrument; it needs feeding with coordinates, not inventing.
//
//   node packages/thetacog-mcp/scripts/tape/ask.mjs [--slug s] [--hours 6] [--sources a,b] [--json]
//   node packages/thetacog-mcp/scripts/tape/ask.mjs --answer "<the operator's answer>" [--agents N]

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const load = (m) => import(resolve(HERE, m));

// ── 1 · INGEST + 2 · SELECT — the mass, and which of it feeds THIS turn ───────────────────────
// "Selectable in this filthy UX": every source is listed with its mass and whether it contributed,
// and a source can be excluded. Excluded sources stay VISIBLE — seeing what was passed over is the
// same transparency contract the dropped atoms carry.
export async function ingest({ slug, hours = 6, sources = null }) {
  const dir = resolve(SESSIONS, slug);
  if (sources && sources.length) {
    const { chunkText } = await load('chunker.mjs');
    const turns = [];
    const manifest = [];
    for (const s of sources) {
      if (!existsSync(s)) { manifest.push({ source: s, included: false, reason: 'file not found' }); continue; }
      if (/\.jsonl$/i.test(s)) { manifest.push({ source: s, included: false, reason: 'jsonl — use --hours (the rust ingest lane), never a JS reader' }); continue; }
      const raw = readFileSync(s, 'utf8');
      const r = chunkText(raw);
      for (const t of r.turns) turns.push({ ...t, index: turns.length, source: s, side: t.role === 'operator' ? 'intent' : 'reality' });
      manifest.push({ source: s, included: true, bytes: raw.length, turns: r.turns.length });
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'turns.json'), JSON.stringify(turns, null, 2) + '\n');
    return { slug, turns: turns.length, manifest, lane: 'A (chunker)' };
  }
  const { harvest } = await load('harvest.mjs');
  const h = harvest({ hours, slug });
  return {
    slug, turns: h.turns ?? 0, lane: 'B (rust --ingest-transcript)',
    manifest: (h.files || []).map((f) => ({
      source: f.path, included: !f.skipped && !f.error,
      reason: f.error || f.skipped || null,
      bytes: f.bytes ?? null, intentClaims: f.intentClaims ?? null, realityClaims: f.realityClaims ?? null,
    })),
  };
}

// ── 3 · EXTRACT — the most constraining, highest-altitude question in the mass ─────────────────
// This is next-rule's ONE call (the model judges leverage, its only job) followed by next-question's
// deterministic scoring (which of the plausible answers actually move the cone). The model proposes;
// the LLM-free lane disposes.
export async function extractQuestion({ slug, excluded = [] }) {
  const { nextRule } = await load('next-rule.mjs');
  const r = await nextRule({ slug, excluded });
  if (!r.ok) return { ok: false, reason: r.reason };

  // The rule the model proposes becomes the question's FIRST answer; its negation-in-practice — the
  // thing a generic system would do instead — becomes the second. Scoring them against the locked
  // coordinates is what says whether this is a real question or a formality.
  const { liveCoordinates } = await load('coordinates.mjs');
  const { scoreQuestion } = await load('next-question.mjs');
  const P = await load('physics.mjs');
  const locked = liveCoordinates(slug);

  const q = {
    id: 'Q-NEXT',
    question: r.rule,
    answers: [
      { label: 'lock it', rule: r.rule },
      { label: 'the generic move', rule: `Do the conventional thing instead: ${String(r.rule).replace(/^(Never|Always|Do not|Only)\s+/i, '')}` },
    ],
  };
  const scored = await scoreQuestion(q, locked, P);
  return { ok: true, ...r, scored, lockedCount: locked.length };
}

// ── 4 · APPLY — the answer builds the SPEC and the FOUNDATION in one act ───────────────────────
// Lock the coordinate (that is the spec) AND generate the work order (that is the foundation). One
// call, because a seam between them is where the built thing drifts from the decided thing.
export async function apply({ slug, answer, agents = 1, question = null }) {
  const { lockCoordinate, liveCoordinates, graduationLine } = await load('coordinates.mjs');
  const locked = await lockCoordinate(slug, {
    rule: answer,
    steer: question,
    createdBy: 'operator',
    kind: 'created',
    provenance: question ? `answered: ${String(question).slice(0, 160)}` : null,
  });
  if (!locked.ok) return { ok: false, reason: locked.reason };
  const c = locked.coordinate;

  // THE FOUNDATION: the work order, carrying what ALREADY EXISTS so the agent is told what not to
  // rebuild before it is told what to build. This is the anti-duplication mechanism, applied at the
  // moment of dispatch rather than hoped for in a prompt.
  const owns = (c.owns || []).filter((o) => o.kind === 'code').slice(0, 6);
  const workOrder = [
    `THE RULE (locked by the operator as ${c.id}, coordinate ${c.coord}):`,
    c.rule,
    '',
    owns.length ? `ALREADY IMPLEMENTED — read these BEFORE writing anything, and do not rebuild them:` : `No existing implementation found for this rule (${c.ownsReason || 'no match'}). Treat it as new ground.`,
    ...owns.map((o) => `  · ${o.file}`),
    '',
    `THE DELIVERABLE IS THE GUARD, shipped in the SAME commit as the fix. A change without a`,
    `regression test that fails when the invariant breaks is not done.`,
    '',
    `HOUSE RULES: never a git branch, never --amend/rebase/reset (agents share this tree),`,
    `commit ONLY with 'git commit --only <your exact paths>'. No python. Evidence over assertion —`,
    `run what you build and quote real output. Absent data reads UNMEASURED with a reason.`,
  ].join('\n');

  const dir = resolve(SESSIONS, slug);
  mkdirSync(dir, { recursive: true });
  appendFileSync(resolve(dir, 'work-orders.ndjson'), JSON.stringify({
    ts: new Date().toISOString(), coordinateId: c.id, coord: c.coord, agents, workOrder,
  }) + '\n');

  const grad = graduationLine(c);
  return {
    ok: true, coordinate: c, workOrder, agents,
    cone: locked.cone,
    graduation: { ok: grad.ok, problems: grad.problems, markdown: grad.markdown },
    spec: `${liveCoordinates(slug).length} coordinate(s) now define this project`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'director');
  const JSONOUT = process.argv.includes('--json');

  const answer = arg('--answer', null);
  if (answer) {
    const r = await apply({ slug, answer, agents: parseInt(arg('--agents', '1'), 10) || 1, question: arg('--question', null) });
    if (JSONOUT) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 2); }
    if (!r.ok) { console.error('✗ ' + r.reason); process.exit(2); }
    const c = r.coordinate;
    console.log(`\n  ✓ SPEC — ${c.id} locked at ${c.coord}  σ ${c.sigma ?? 'UNMEASURED'}  sensor ${c.sensor || '—'}`);
    console.log(`    ${c.rule}`);
    console.log(`\n  ✓ FOUNDATION — work order for ${r.agents} agent(s), carrying ${(c.owns || []).filter((o) => o.kind === 'code').length} existing file(s)`);
    console.log(`\n  cone: centre ${r.cone.centreLabel || '—'} · width ${r.cone.width ?? 'UNMEASURED'} · ${r.spec}`);
    console.log(`  graduation: ${r.graduation.ok ? 'PASSES seedRules — will be retrievable by the fence' : 'BLOCKED — ' + r.graduation.problems.join('; ')}\n`);
    process.exit(0);
  }

  const srcArg = arg('--sources', null);
  const ing = await ingest({ slug, hours: parseFloat(arg('--hours', '6')) || 6, sources: srcArg ? srcArg.split(',') : null });
  const q = await extractQuestion({ slug });

  if (JSONOUT) { console.log(JSON.stringify({ ingest: ing, question: q }, null, 2)); process.exit(0); }

  console.log(`\n  ── 1·2 THE MASS, AND WHAT FED THIS TURN ${'─'.repeat(36)}`);
  console.log(`  lane ${ing.lane} · ${ing.turns} turns`);
  for (const m of (ing.manifest || []).slice(0, 8)) {
    console.log(`    ${m.included ? '✓' : '·'} ${String(m.source).replace(REPO + '/', '').slice(-58).padEnd(58)} ${m.included ? `${m.intentClaims ?? m.turns ?? '?'} intent` : m.reason}`);
  }
  if (!q.ok) { console.error(`\n  ✗ ${q.reason}\n`); process.exit(2); }

  console.log(`\n  ── 3 THE MOST CONSTRAINING QUESTION IN THE MASS ${'─'.repeat(28)}`);
  console.log(`\n  ${q.rule}\n`);
  console.log(`  why it is load-bearing: ${q.whyLeverage || 'UNMEASURED'}`);
  console.log(`  from your own words${q.verbatim ? ` (turn ${q.sourceTurn}, verified verbatim)` : ` — ⚠ NOT VERBATIM: ${q.verbatimReason}`}:`);
  console.log(`    "${String(q.quote).slice(0, 220)}"`);
  console.log(`  surface: ${q.targetSurface || '—'}`);
  console.log(`  confidence ${q.confidence ?? '—'} · one call · ${q.ms}ms · ${q.evidenceBytes} bytes of past`);

  // ── WHAT WAS CONSIDERED — the audit surface ──────────────────────────────────────────────────
  // The LLM does the selecting; this proves what it selected. Without it a steer is aimed at nothing,
  // because you cannot correct a choice you cannot see. Rejected turns stay listed, with the reason.
  const man = q.manifest || [];
  const sel = man.filter((m) => m.selected);
  const rej = man.filter((m) => !m.selected);
  console.log(`\n  ── WHAT WAS CONSIDERED ${'─'.repeat(52)}`);
  console.log(`  ${sel.length} of ${man.length} turns fed the question`);
  console.log(`  ${q.scoring || ''}`);
  for (const m of sel) {
    const mark = m.index === q.sourceTurn ? '►' : ' ';
    console.log(`   ${mark} #${String(m.index).padStart(3)} ${String(m.side).padEnd(8)} score ${String(m.score).padStart(6)} ${String(m.chars).padStart(5)}ch  ${String(m.head).slice(0, 72)}`);
  }
  if (rej.length) {
    console.log(`   ${rej.length} considered and NOT selected — highest rejected was #${rej[0]?.index} at score ${rej[0]?.score}`);
    console.log(`   reason: ${rej[0]?.reason}`);
  }
  console.log(`   ► = the turn the rule was quoted from`);
  const s = q.scored;
  console.log(`\n  ${s.cls} — ${s.verdict}`);
  console.log(`  spread ${s.spread} · cone ${s.widthBefore} → ${s.expectedAfter} (reduction ${s.reduction}) over ${q.lockedCount} locked`);
  console.log(`\n  ── 4 ANSWER IT AND BOTH GET BUILT ${'─'.repeat(41)}`);
  console.log(`  node packages/thetacog-mcp/scripts/tape/ask.mjs --slug ${slug} --agents 2 \\`);
  console.log(`       --answer "<your rule, edited however you want>"\n`);
}
