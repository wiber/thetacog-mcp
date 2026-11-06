// packages/thetacog-mcp/scripts/tape/next-rule.mjs — THE TASKMASTER'S FIRST MOVE.
//
// Operator, 2026-08-20, correcting the altitude:
//   "The taskmaster takes in the past. We infer the intent. That was in the transcript, the meeting,
//    whatever. And then it makes ONE call to create A rule. The MOST HIGH-LEVERAGE rule. And puts it
//    on the screen."
//
// ── WHAT THIS REPLACES, AND WHY ───────────────────────────────────────────────────────────────
// The first build extracted EVERY decision from a document — 58 turns, one model call each, into a
// 19-row queue with sorting and filtering. That is an enumerator, and it puts the burden back on the
// operator: here are nineteen things, you rank them. Wrong altitude.
//
// This is the right one: ingest the past, make ONE call, and return THE single rule most worth
// locking down right now. The system does the choosing. The operator does the deciding. A queue may
// still exist behind this, but it is a byproduct — never the front door.
//
// ── THE ONE CALL IS THE ONLY MODEL IN THIS FILE ───────────────────────────────────────────────
// Everything before it is deterministic: gather the past, compress it, rank candidate evidence by
// gzip mass and recency. Everything after it is deterministic: place the rule on the lattice, render
// its panel. The model does exactly one job — judge leverage — and it is the only undecidable step,
// so it is the only one whose output is treated as a proposal rather than a receipt.
//
// ── LEVERAGE, DEFINED SO THE MODEL CANNOT WAFFLE ──────────────────────────────────────────────
// High-leverage means: locking this down now PREVENTS THE MOST FUTURE REWORK. Concretely — it is a
// constraint that, left unstated, lets an agent (or a human) do a large amount of work in the wrong
// lane. It is not "the most important topic" and not "the most recent thing said". The prompt says so
// explicitly, and demands the verbatim evidence that the rule was inferred FROM, so the operator can
// see it was inferred from their own words rather than invented.
//
//   node packages/thetacog-mcp/scripts/tape/next-rule.mjs [--slug <session>] [--hours 6] [--json]
//                                                          [--exclude <ruleId,...>] [--dry-run]
//                                                          [--weight-cc N] [--weight-spec N] [--weight-repo N]

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { __internals__ as PHYSICS } from './physics.mjs';   // MIN_GZIP_BYTES — the entropy floor, one source

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const gz = (s) => gzipSync(Buffer.from(String(s || ' '), 'utf8')).length;

// ── 1 · GATHER THE PAST (deterministic) ───────────────────────────────────────────────────────
/** Turns from a harvested session, or from a walked document session. Both are "the past". */
export function gatherPast(slug) {
  const dir = resolve(SESSIONS, slug);
  if (!existsSync(dir)) return { ok: false, reason: `no session '${slug}'` };

  // a harvest session stores turns.json; a document session stores them on the session
  const turnsFile = resolve(dir, 'turns.json');
  if (existsSync(turnsFile)) {
    try {
      const turns = JSON.parse(readFileSync(turnsFile, 'utf8'));
      return { ok: true, turns, kind: 'harvest' };
    } catch { /* fall through */ }
  }
  const sessionFile = resolve(dir, 'session.json');
  if (!existsSync(sessionFile)) return { ok: false, reason: `session '${slug}' has no session.json` };
  const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  if (Array.isArray(session.turns) && session.turns.length) return { ok: true, turns: session.turns, kind: 'document' };

  // last resort: re-chunk the sources (deterministic, cheap)
  const out = [];
  for (const src of session.sources || []) {
    if (!existsSync(src) || /\.jsonl$/i.test(src)) continue;
    out.push({ index: out.length, role: 'operator', source: src, text: readFileSync(src, 'utf8'), side: 'intent' });
  }
  return out.length ? { ok: true, turns: out, kind: 'sources' } : { ok: false, reason: `session '${slug}' has no turns and no readable text sources` };
}

// ── 2 · COMPRESS THE PAST TO AN APERTURE (deterministic) ──────────────────────────────────────
// The whole past does not fit in one call, and stuffing it would reproduce the exact anti-pattern the
// source document warns about. So: prefer the OPERATOR's own words (side:'intent'), prefer RECENT,
// require real gzip mass, and cut to a byte budget. What survives is the evidence the one call sees.
export function selectEvidence(turns, { budgetBytes = 24000, minChars = 180, weights = null } = {}) {
  // ── CONTEXT APERTURE BINDING (operator, 2026-08-20): "the sliders must directly populate the
  // CLI's harvest/ingest arguments so adjusting weights on the page physically re-ranks candidate
  // coordinates on the metal." The weights bias SELECTION ONLY — which turns make the aperture —
  // and are FORBIDDEN from touching a measured value (chars, gzip mass, σ, any placement). The
  // base score stays exactly what it always was; the weighted score is a SEPARATE field, and with
  // no weights passed this function is byte-identical to its pre-weights self (guarded by
  // tests/tape/weights-change-selection.test.mjs against a captured fixture).
  const norm = normalizeWeights(weights);
  const scored = (turns || [])
    .filter((t) => String(t.text || '').trim().length >= minChars)
    .map((t, i) => {
      const text = String(t.text);
      const isIntent = t.side === 'intent' || t.role === 'operator';
      const recency = i / Math.max(1, turns.length - 1);          // 0 oldest … 1 newest
      const mass = gz(text);
      // Operator words outrank assistant output 3:1 — the intent side is what a rule must be
      // inferred FROM. Recency matters but never enough to bury a heavy earlier constraint.
      const score = (isIntent ? 3 : 1) * Math.log(1 + mass) * (0.6 + 0.4 * recency);
      if (!norm) return { ...t, _mass: mass, _score: score, _isIntent: isIntent };
      const bucket = classifySource(t.source);
      const mult = norm.multipliers[bucket] ?? 1;                 // unclassified turns ride unweighted
      return { ...t, _mass: mass, _score: score, _isIntent: isIntent, _bucket: bucket, _mult: mult, _wScore: score * mult };
    })
    .sort(norm ? (a, b) => b._wScore - a._wScore : (a, b) => b._score - a._score);

  const picked = [];
  let used = 0;
  for (const t of scored) {
    const chunk = t.text.length > 2200 ? t.text.slice(0, 2200) : t.text;
    if (used + chunk.length > budgetBytes) continue;
    picked.push({ ...t, text: chunk });
    used += chunk.length;
  }
  // restore chronological order — the model should read the past forwards
  picked.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  // ── THE MANIFEST — what was CONSIDERED, so the operator can audit the selection ──────────────
  // Operator, 2026-08-20: "The UI is mostly just to guarantee that the right files were considered...
  // if you don't know what's being considered as past, you don't know how to ensure the intent and
  // you can't build the future reality or judge whether what you're getting is in line with what you
  // want. That's what the text box is for."
  //
  // The LLM does the SELECTING — that is what attention is for and it is the right job for it. But a
  // selection nobody can see is a selection nobody can correct. Before this, 13 of 55 turns fed the
  // answer and exactly ONE (the quoted turn) was exposed; the other twelve were invisible. So every
  // considered turn is now reported with its score components and its rank, and every REJECTED turn
  // is reported too, with the reason — an excluded source that stays visible is the same transparency
  // contract the dropped atoms carry. A steer aimed at an invisible selection is aimed at nothing.
  const pickedIdx = new Set(picked.map((t) => t.index));
  const manifest = scored.map((t, rank) => ({
    index: t.index, rank, source: t.source || null,
    startLine: t.startLine ?? null, endLine: t.endLine ?? null,
    chars: t.text.length, gzMass: t._mass,
    side: t._isIntent ? 'intent' : 'reality',
    score: +t._score.toFixed(3),
    // the weighted view is ADDITIVE — score above stays the unweighted base measurement, so a
    // reader (and the guard) can see exactly what the weighting moved: the rank, never the mass.
    ...(norm ? { bucket: t._bucket, weightMultiplier: +t._mult.toFixed(4), weightedScore: +t._wScore.toFixed(3) } : {}),
    selected: pickedIdx.has(t.index),
    reason: pickedIdx.has(t.index) ? null : 'below the byte budget once higher-scoring turns were taken',
    head: t.text.replace(/\s+/g, ' ').slice(0, 110),
  }));

  return {
    evidence: picked, bytes: used,
    intentTurns: picked.filter((t) => t._isIntent).length,
    realityTurns: picked.filter((t) => !t._isIntent).length,
    consideredTurns: scored.length,
    manifest,
    scoring: 'operator words weighted 3x over assistant output; log(1+gzip mass) x (0.6 + 0.4 x recency); cut to a byte budget',
    ...(norm ? { weighting: weightingReport(norm, picked) } : {}),
  };
}

// ── 2b · THE WEIGHT KNOB (deterministic, selection-only) ──────────────────────────────────────
// The page's three sliders (ContextBalance.svelte: cc_transcripts / spec / repo_code, percentages
// summing ~100) and the CLI's --weight-cc / --weight-spec / --weight-repo flags land HERE, the one
// place the aperture is cut. Buckets are classified from the turn's source path with the same
// regexes /api/context displays (that route keeps its own copy — owned by another lane — so a
// divergence shows up as the page disagreeing with the engine, which is visible, not silent).
export function classifySource(source) {
  if (!source) return 'unclassified';
  const s = String(source);
  if (/\.claude\/projects\//.test(s) || /\.jsonl$/i.test(s)) return 'cc_transcripts';
  if (/docs\/specs\//.test(s) || /(^|\/)CLAUDE\.md$/.test(s) || /coordinates\.ndjson/.test(s)) return 'spec';
  return 'repo_code';
}

const WEIGHT_BUCKETS = ['cc_transcripts', 'spec', 'repo_code'];

/** Multipliers are RELATIVE: each bucket's weight over the mean of the three, so equal weights of
 *  any magnitude give multiplier 1.0 everywhere — the negative control the guard asserts (equal
 *  weights change NOTHING, proving an observed shift comes from the weighting, not the code path). */
export function normalizeWeights(weights) {
  if (!weights || typeof weights !== 'object') return null;
  const vals = WEIGHT_BUCKETS.map((k) => Math.max(0, Number(weights[k]) || 0));
  const mean = vals.reduce((a, b) => a + b, 0) / WEIGHT_BUCKETS.length;
  if (!(mean > 0)) return null;   // all-zero weights are not a weighting — fall back to default
  const multipliers = {};
  WEIGHT_BUCKETS.forEach((k, i) => { multipliers[k] = vals[i] / mean; });
  const given = {};
  WEIGHT_BUCKETS.forEach((k, i) => { given[k] = vals[i]; });
  return { given, multipliers };
}

/** Per-bucket honesty report. Below the entropy floor (MIN_GZIP_BYTES, physics.mjs) a bucket's
 *  surviving contribution is length noise, not influence — that is the MEASURED constraint, so it
 *  is reported per bucket as belowFloorAtThisWeight with the mass, never silently included. */
function weightingReport(norm, picked) {
  const buckets = {};
  for (const k of WEIGHT_BUCKETS) {
    const mine = picked.filter((t) => t._bucket === k);
    const mass = mine.length ? gz(mine.map((t) => t.text).join('\n')) : 0;
    buckets[k] = {
      weight: norm.given[k],
      multiplier: +norm.multipliers[k].toFixed(4),
      selectedTurns: mine.length,
      selectedGzBytes: mass,
      belowFloorAtThisWeight: mass < PHYSICS.MIN_GZIP_BYTES,
    };
  }
  return {
    applied: true,
    floor: PHYSICS.MIN_GZIP_BYTES,
    note: 'weights bias SELECTION ONLY — base scores, char counts and gzip masses are unweighted measurements; a bucket below the floor contributes length noise, not influence',
    buckets,
  };
}

// ── 3 · THE ONE CALL ──────────────────────────────────────────────────────────────────────────
export function buildPrompt(evidence, { excluded = [], repoRoot = REPO } = {}) {
  const body = evidence.map((t) => `[${t.index}${t._isIntent ? ' OPERATOR' : ' ASSISTANT'}] ${t.text}`).join('\n\n---\n\n');
  return `You are the Taskmaster. Below is THE PAST of a working session — an operator's own words, and some of the assistant output around them.

Your job is to make ONE judgment: what is the SINGLE MOST HIGH-LEVERAGE RULE to lock down right now?

HIGH-LEVERAGE means: stating this rule now PREVENTS THE MOST FUTURE REWORK. It is a constraint which, left unstated, would let an agent or a person do a large amount of work in the wrong lane. It is NOT "the most important topic", NOT "the most recent thing mentioned", and NOT a summary of the session.

HARD REQUIREMENTS:
- The rule must be INFERRED FROM the operator's own words below, and you must quote the exact verbatim span it came from. Copy it character-for-character. If you cannot quote it, you may not propose it.
- One sentence, imperative, specific enough that a subagent could act on it without asking a follow-up question.
- Name the repo surface it binds to if the past names one (a path under ${repoRoot}), else null.
- Give a falsifier if one is stated or clearly implied: a runnable command or check that would FAIL if the rule were violated. Else null.
${excluded.length ? `- These rules are ALREADY LOCKED DOWN. Do not propose them again or any near-restatement:\n${excluded.map((r) => `  · ${r}`).join('\n')}` : ''}

Answer with STRICT JSON, no prose and no code fence:
{"rule":"<one imperative sentence>","quote":"<verbatim span from the operator's words>","why_leverage":"<one sentence: what rework this prevents>","target_surface":"<path or null>","falsifier":"<command or null>","confidence":<0-1>,"runner_up":"<the second-best rule, one sentence, or null>"}

THE PAST:

${body}`;
}

/** Extract the first balanced JSON object from a model reply that may be fenced or chatty. */
export function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/** THE EXTRACTIVE LAW, enforced in code: the quote must really be in the past. */
export function verifyQuote(quote, turns) {
  const q = String(quote || '').trim();
  if (!q) return { ok: false, reason: 'no quote supplied' };
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const nq = norm(q);
  for (const t of turns) {
    if (norm(t.text).includes(nq)) return { ok: true, turnIndex: t.index, source: t.source || null };
  }
  return { ok: false, reason: 'the quote does not appear verbatim in the past — the rule was invented, not inferred' };
}

export async function nextRule({ slug, excluded = [], dryRun = false, model = null, weights = null } = {}) {
  const past = gatherPast(slug);
  if (!past.ok) return { ok: false, reason: past.reason };
  const sel = selectEvidence(past.turns, { weights });
  if (!sel.evidence.length) return { ok: false, reason: 'no turn in this session clears the mass floor — nothing to infer from' };

  const prompt = buildPrompt(sel.evidence, { excluded });
  if (dryRun) return { ok: true, dryRun: true, slug, prompt, ...sel, promptChars: prompt.length };

  const llm = await import(resolve(PKG, 'scripts/rewrite/llm.mjs'));
  const call = model && llm[model] ? llm[model] : (llm.cloud || llm.local);
  if (typeof call !== 'function') return { ok: false, reason: 'no model entry point found in ../rewrite/llm.mjs' };

  const t0 = Date.now();
  let reply;
  try { reply = await call(prompt, { maxTokens: 900 }); }
  catch (e) { return { ok: false, reason: `the one call failed: ${String(e.message).slice(0, 200)}` }; }

  const j = extractJson(typeof reply === 'string' ? reply : reply?.text || '');
  if (!j || !j.rule) return { ok: false, reason: 'the one call returned no parseable rule', raw: String(reply).slice(0, 300) };

  const v = verifyQuote(j.quote, past.turns);
  return {
    ok: true, slug, ms: Date.now() - t0,
    rule: String(j.rule), quote: String(j.quote || ''),
    whyLeverage: j.why_leverage || null,
    targetSurface: j.target_surface || null,
    falsifier: j.falsifier || null,
    confidence: typeof j.confidence === 'number' ? j.confidence : null,
    runnerUp: j.runner_up || null,
    verbatim: v.ok, verbatimReason: v.ok ? null : v.reason,
    sourceTurn: v.turnIndex ?? null, source: v.source ?? null,
    evidenceBytes: sel.bytes, intentTurns: sel.intentTurns, realityTurns: sel.realityTurns,
    manifest: sel.manifest, scoring: sel.scoring,
    consideredTurns: sel.consideredTurns,
    ...(sel.weighting ? { weighting: sel.weighting } : {}),
  };
}

/** Persist the proposal so the page/CLI can show it and the operator can decide on it. */
export function saveProposal(slug, r) {
  const dir = resolve(SESSIONS, slug);
  mkdirSync(dir, { recursive: true });
  const row = { ts: new Date().toISOString(), ...r };
  appendFileSync(resolve(dir, 'proposals.ndjson'), JSON.stringify(row) + '\n');
  writeFileSync(resolve(dir, 'next-rule.json'), JSON.stringify(row, null, 2) + '\n');
  return row;
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
  const slug = arg('--slug', 'harvest-6h');
  const excluded = String(arg('--exclude', '')).split(',').map((s) => s.trim()).filter(Boolean);
  // ── the same knob the page's sliders drive — terminal and glass turn ONE dial ────────────────
  // Any weight flag present arms the weighting; a flag left off defaults to an equal share of what
  // remains of 100 (documented behavior, not a guess — weights are relative, so scale cancels).
  let weights = null;
  const wFlags = { cc_transcripts: '--weight-cc', spec: '--weight-spec', repo_code: '--weight-repo' };
  if (Object.values(wFlags).some((f) => process.argv.includes(f))) {
    weights = {};
    const missing = [];
    for (const [k, f] of Object.entries(wFlags)) {
      const v = arg(f, null);
      if (v === null) missing.push(k); else weights[k] = Number(v);
    }
    const given = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const k of missing) weights[k] = Math.max(0, (100 - given) / Math.max(1, missing.length));
  }
  const r = await nextRule({ slug, excluded, weights, dryRun: process.argv.includes('--dry-run') });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 2); }
  if (!r.ok) { console.error('✗ ' + r.reason); process.exit(2); }
  if (r.dryRun) {
    console.log(`\n  DRY RUN · ${slug}`);
    console.log(`  evidence: ${r.evidence.length} turns · ${r.bytes} bytes (${r.intentTurns} operator, ${r.realityTurns} assistant) of ${r.consideredTurns} considered`);
    if (r.weighting) {
      for (const [k, b] of Object.entries(r.weighting.buckets)) {
        console.log(`  weight ${k}: ${b.weight}% (×${b.multiplier}) · ${b.selectedTurns} turns · gz ${b.selectedGzBytes}${b.belowFloorAtThisWeight ? ` ⚠ BELOW FLOOR (<${r.weighting.floor}) — length noise, not influence` : ''}`);
      }
    }
    console.log(`  prompt:   ${r.promptChars} chars — ONE call\n`);
    process.exit(0);
  }
  saveProposal(slug, r);
  console.log(`\n  ┌─ THE MOST HIGH-LEVERAGE RULE ${'─'.repeat(44)}`);
  console.log(`  │ ${r.rule}`);
  console.log(`  ├─ why: ${r.whyLeverage || 'UNMEASURED'}`);
  console.log(`  ├─ from your own words${r.verbatim ? ` (turn ${r.sourceTurn}, verified verbatim)` : ` — ⚠ NOT VERBATIM: ${r.verbatimReason}`}:`);
  console.log(`  │ "${String(r.quote).slice(0, 260)}"`);
  console.log(`  ├─ surface:   ${r.targetSurface || '—'}`);
  console.log(`  ├─ falsifier: ${r.falsifier || '—'}`);
  console.log(`  ├─ confidence ${r.confidence ?? 'UNMEASURED'} · one call · ${r.ms}ms · ${r.evidenceBytes} bytes of past`);
  if (r.runnerUp) console.log(`  ├─ runner-up: ${r.runnerUp}`);
  console.log(`  └${'─'.repeat(74)}\n`);
}
