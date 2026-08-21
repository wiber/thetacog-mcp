// packages/thetacog-mcp/scripts/tape/engine.mjs — THE MECHANISTIC WALK, ONE TURN AT A TIME.
// ════════════════════════════════════════════════════════════════════════════
// R0 (the spec's own anti-pattern, hard rule): never feed more than one segmented
// turn to an extraction call. This module's job is to walk a session's turn queue
// exactly one turn per step(), place every atom it finds through the LLM-free
// physics lane, backfill lane drift once a home coordinate is decidable, and
// PERSIST THROUGH THE LEDGER AFTER EVERY TURN so a crash resumes where it left off
// rather than losing a partially-walked session.
//
// TWO INGEST LANES (TAPE-CONTRACT.md's ingest-lane-B correction):
//   Lane A · raw operator text (.txt/.md)  -> chunker.mjs (deterministic, pure).
//   Lane B · Claude Code transcripts (.jsonl) -> shell out to the ALREADY-BUILT
//            Rust walker `pmu-onchip --ingest-transcript --path <f> --offset N`.
//            NEVER a JS transcript reader — that would fork the M1 bit-identity
//            gate the contract explicitly bans re-implementing.
//
// EXTRACTION IS THE ONLY LLM LANE, and it is owned by atomizer.mjs — a SEPARATE
// file another builder writes concurrently with this one. This module imports it
// LAZILY (inside the function that needs it) so engine.mjs loads and runs even
// while atomizer.mjs does not exist yet or is mid-write, and degrades HONESTLY to
// a labelled deterministic stub (one atom per substantial turn, extractor tagged
// 'deterministic-stub') rather than fabricating extraction quality it can't back.
// Same lazy-and-honest treatment for contradict.mjs (judgment, off the receipt
// path) from worker.mjs's dispatch flow.
//
// STEERING: a 'path' row splices that file's turns into the turn queue RIGHT
// AFTER the position the session had reached when the steer was applied
// (`insertAt`, recorded on the steering row). The queue is rebuilt from
// (session.sources concatenated) + (steering path rows replayed in append
// order, each splicing at its own recorded insertAt) — deterministic and
// crash-safe: nothing about turn ordering lives only in memory.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './store.mjs';
import * as chunker from './chunker.mjs';
import * as physics from './physics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const PMU_BIN = resolve(REPO, '.thetacog/pmu/target/release/pmu-onchip');

export { REPO, PMU_BIN };

// ── LANE B — shell out to the Rust walker, never reimplement it ────────────────
export function ingestTranscript(filePath, offset = 0) {
  return new Promise((resolvePromise) => {
    execFile(
      PMU_BIN,
      ['--ingest-transcript', '--path', filePath, '--offset', String(offset)],
      { maxBuffer: 256 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          return resolvePromise({ ok: false, error: String(err.message || err), stderr: String(stderr || '').slice(0, 500) });
        }
        try { resolvePromise({ ok: true, ...JSON.parse(stdout) }); }
        catch (e) { resolvePromise({ ok: false, error: `unparseable pmu-onchip --ingest-transcript output: ${e.message}` }); }
      },
    );
  });
}

// ── TURN QUEUE — built from sources, cached per-slug, invalidated on steer/edit ─
const _turnCache = new Map(); // slug -> { sig, queue, sourceMeta }

function invalidateTurnCache(slug) { _turnCache.delete(slug); }
export { invalidateTurnCache };

async function turnsForSource(source) {
  if (/\.jsonl$/i.test(source)) {
    const r = await ingestTranscript(source, 0);
    if (!r.ok) return { turns: [], error: r.error, lane: 'B' };
    const think = Array.isArray(r.intentThinking) ? r.intentThinking : [];
    const real = Array.isArray(r.reality) ? r.reality : [];
    const n = Math.max(think.length, real.length);
    const turns = [];
    for (let i = 0; i < n; i++) {
      const t = think[i];
      const rl = real[i];
      // Lane B split per TAPE-CONTRACT.md: intentThinking is the INTENT side (feed to
      // extraction); reality is the REALITY side (held for enforcement-fidelity, later).
      // A transcript with no <thinking> block for that frame has an empty intent side —
      // honestly fall back to the reality text rather than silently dropping the frame,
      // and TAG the fallback so nobody reads it as a genuine intent claim.
      const hasThink = typeof t === 'string' && t.trim().length > 0;
      const text = hasThink ? t : rl;
      if (!text || !String(text).trim()) continue;
      turns.push({
        source, idx: i, role: hasThink ? 'lane-b-intent' : 'lane-b-reality-fallback',
        startLine: null, endLine: null, text: String(text), laneBReality: rl || null,
      });
    }
    return { turns, newOffset: r.newOffset, firstUserPrompt: r.firstUserPrompt, lane: 'B' };
  }
  let text;
  try { text = fs.readFileSync(source, 'utf8'); }
  catch (e) { return { turns: [], error: `cannot read source: ${e.message}`, lane: 'A' }; }
  const { turns, totalLines } = chunker.chunkText(text);
  return {
    turns: turns.map((t) => ({ source, idx: t.index, role: t.role, startLine: t.startLine, endLine: t.endLine, text: t.text })),
    sourceLines: totalLines,
    lane: 'A',
  };
}

/** getTurnQueue(slug, session) -> ordered turn records, rebuilt+cached per session shape. */
export async function getTurnQueue(slug, sessionArg) {
  const session = sessionArg || store.loadSession(slug);
  if (!session) return [];
  const steerRows = (session.steering || []).filter((r) => r.kind === 'path' && Number.isInteger(r.insertAt));
  const sig = JSON.stringify({ sources: session.sources, steer: steerRows.map((r) => [r.value, r.insertAt]) });
  const cached = _turnCache.get(slug);
  if (cached && cached.sig === sig) return cached.queue;

  let list = [];
  const sourceMeta = {};
  for (const src of session.sources || []) {
    const r = await turnsForSource(src);
    sourceMeta[src] = { error: r.error || null, lane: r.lane, newOffset: r.newOffset ?? null, sourceLines: r.sourceLines ?? null };
    list = list.concat(r.turns);
  }
  // Replayed in ledger (append) order — each splice happens against the list AS IT STOOD
  // when the steer was applied, which is exactly what insertAt recorded, so replaying in
  // the same order reproduces the identical final ordering deterministically.
  for (const row of steerRows) {
    const r = await turnsForSource(row.value);
    sourceMeta[row.value] = { error: r.error || null, lane: r.lane, steered: true, sourceLines: r.sourceLines ?? null };
    list.splice(Math.min(row.insertAt, list.length), 0, ...r.turns);
  }
  _turnCache.set(slug, { sig, queue: list, sourceMeta });
  return list;
}

/** sourceMetaFor(slug) -> per-source {lane, error, sourceLines, newOffset} from the warmed queue cache. */
export function sourceMetaFor(slug) { return _turnCache.get(slug)?.sourceMeta || null; }

// ── OPEN — create/resume a session and warm the turn queue ─────────────────────
export async function open({ slug, sources = [] } = {}) {
  const resolvedSlug = slug || (sources[0] ? store.slugify(sources[0]) : 'session');
  const session = store.createSession({ slug: resolvedSlug, sources });
  const queue = await getTurnQueue(resolvedSlug, session);
  session.totalTurns = queue.length;
  // TWO NUMBERS, TWO NAMES (the G3 discipline applied here). `totalLines` is the SOURCE
  // file's own line count — the same number `action=doc` returns and the console sizes the
  // tape view against, so a chunk's [startLine,endLine] anchors land on the right rows.
  // The sum of turn spans is a DIFFERENT quantity (it excludes the blank lines between
  // turns: 1386 vs 1467 on GDDadwill.txt) and is published under its own name.
  const meta = sourceMetaFor(resolvedSlug);
  session.totalLines = (session.sources || []).reduce((n, src) => n + (meta?.[src]?.sourceLines || 0), 0) || null;
  session.coveredLines = queue.reduce((n, t) => n + (Number.isInteger(t.startLine) && Number.isInteger(t.endLine) ? (t.endLine - t.startLine + 1) : 0), 0);
  store.saveSession(resolvedSlug, session);
  return { ok: true, slug: resolvedSlug, session, totalTurns: queue.length };
}

// ── STEERING ─────────────────────────────────────────────────────────────────
export async function applySteer(slug, { kind, value } = {}) {
  if (kind === 'path') {
    const abs = path.isAbsolute(value) ? value : resolve(REPO, value);
    if (!fs.existsSync(abs)) return { ok: false, error: `steer path not found: ${abs}` };
    const session = store.loadSession(slug) || store.createSession({ slug });
    const insertAt = session.cursor || 0;
    store.appendSteer(slug, { kind: 'path', value: abs, insertAt, appliedAt: new Date().toISOString() });
    invalidateTurnCache(slug);
    const after = store.loadSession(slug);
    const queue = await getTurnQueue(slug, after);
    after.totalTurns = queue.length;
    store.saveSession(slug, after);
    return { ok: true, kind: 'path', value: abs, insertAt, totalTurns: queue.length };
  }
  if (kind === 'prose') {
    store.appendSteer(slug, { kind: 'prose', value: String(value || ''), appliedAt: new Date().toISOString() });
    return { ok: true, kind: 'prose' };
  }
  return { ok: false, error: `unknown steer kind '${kind}' — expected 'path' or 'prose'` };
}

function buildPrimer(session) {
  return (session.steering || []).filter((r) => r.kind === 'prose').map((r) => r.value).join('\n\n');
}

// ── EXTRACTION — the only LLM lane, imported lazily, degraded honestly ─────────
let _atomizerMod; // undefined = not attempted, null = attempted & absent
async function loadAtomizer() {
  if (_atomizerMod !== undefined) return _atomizerMod;
  try { _atomizerMod = await import(resolve(HERE, 'atomizer.mjs')); }
  catch { _atomizerMod = null; }
  return _atomizerMod;
}

function firstSentence(s) {
  const m = String(s || '').replace(/\s+/g, ' ').match(/^.{40,220}?[.?!]\s/);
  return (m ? m[0] : String(s || '').slice(0, 180)).trim();
}

/** The deterministic-stub extraction (walk-spine.mjs's shape) — the honest degrade
 * when atomizer.mjs is absent or throws. One atom for a substantial turn, none for
 * a trivial one (a short turn genuinely produces zero atoms — that is not a failure). */
function stubAtomize(turn) {
  const text = String(turn.text || '').trim();
  if (text.length < 80) return { atoms: [], extractor: 'deterministic-stub' };
  return {
    atoms: [{ type: 'DECISION', quote: text.slice(0, 900), rule: firstSentence(text), target_surface: null, falsifier: null, priority: 'P1' }],
    extractor: 'deterministic-stub',
  };
}

// Real contract, verified against the running file 2026-08-20: atomizer.mjs exports
// `atomizeTurns(turns[], {primer, concurrency, model, minChars})` — a BATCH entry point
// whose own bounded pool does one model call per turn internally. To keep engine.step()'s
// R0 invariant honest end to end (this call site feeds it exactly ONE turn), we pass a
// single-element array; its own id assignment (assignIds, locally scoped, restarts at 001
// every call) is discarded — nextAtomId() below owns ids against the session's LIVE ledger.
// `model` is an OPTIONAL INJECTION POINT, threaded straight through to atomizer.mjs's own
// `model` option. Without it no guard could exercise a walk without spending a live model
// call — a test that needs the network is a test that goes red for reasons that have nothing
// to do with the code. Production passes nothing and atomizer.mjs defaults to cloud().
export async function atomizeTurn(turn, { session, primer, repoRoot, model } = {}) {
  const mod = await loadAtomizer();
  if (!mod || typeof mod.atomizeTurns !== 'function') {
    return { ...stubAtomize(turn), extractorAvailable: false, extractorReason: mod ? 'atomizer.mjs has no atomizeTurns export' : 'atomizer.mjs not found' };
  }
  try {
    const r = await mod.atomizeTurns([turn], { primer: primer || '', concurrency: 1, ...(model ? { model } : {}) });
    if (r?.failures?.length) {
      return { ...stubAtomize(turn), extractorAvailable: false, extractorReason: `atomizer.mjs call failed: ${String(r.failures[0].raw || 'unknown').slice(0, 200)}` };
    }
    // A turn the real extractor deliberately skipped (too short) or genuinely found nothing in is
    // an HONEST EMPTY — falling back to the stub here would fabricate an atom the extractor itself
    // declined to produce, which is worse than reporting zero.
    const atoms = (r.atoms || []).map(({ id, ...rest }) => rest);
    return { atoms, extractor: 'atomizer.mjs', extractorAvailable: true, rejects: r.rejects || [], skipped: r.skipped || [], extractorStats: r.stats || null };
  } catch (e) {
    return { ...stubAtomize(turn), extractorAvailable: false, extractorReason: `atomizer.mjs threw: ${e.message}` };
  }
}

// ── CONTRADICTION JUDGMENT — advisory, off the receipt path, imported lazily ───
let _contradictMod;
async function loadContradict() {
  if (_contradictMod !== undefined) return _contradictMod;
  try { _contradictMod = await import(resolve(HERE, 'contradict.mjs')); }
  catch { _contradictMod = null; }
  return _contradictMod;
}

// ── ATOM ID COUNTERS — per-type, zero-padded 3, computed from the RAW ledger
// (never the resolved/live view) so a dropped-then-reintroduced id is never reused. ──
function nextAtomId(slug, type) {
  const prefix = String(type || 'DECISION');
  let max = 0;
  for (const a of store.readAtoms(slug)) {
    if (typeof a?.id === 'string' && a.id.startsWith(`${prefix}-`)) {
      const n = parseInt(a.id.slice(prefix.length + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// ── HOME + LANE-DRIFT BACKFILL ──────────────────────────────────────────────────
// When home first becomes decidable, atoms placed BEFORE that point had an honest
// laneDrift:null (UNMEASURED — no home yet). We backfill their `laneDrift` on the
// ATOM row via editAtom's fork-forward (a NEW row, the old one stays on the tape,
// per store.mjs's append-only discipline) and mark it `laneDriftProvisional:true`
// so the console can show it was computed after the fact, never silently rewritten.
// We deliberately do NOT touch vega-series.ndjson here: that ledger is "one row per
// atom, appended at placement time" (TAPE-CONTRACT.md) with no fork model, and
// html-report.mjs's AUC chart walks it in raw append order with no per-atom dedupe —
// re-appending corrected rows would double-count those atoms into the area. The
// early UNMEASURED contribution of 0 to laneAuc is itself an honest historical
// record of what was knowable at that point in the walk.
function backfillLaneDrift(slug, homeCoord) {
  const live = store.resolveAtoms(slug);
  let n = 0;
  for (const a of live) {
    if ((a.laneDrift === null || a.laneDrift === undefined) && a.coord) {
      const d = physics.driftFrom(homeCoord, a.coord);
      if (d !== null) { store.editAtom(slug, a.id, { laneDrift: d, laneDriftProvisional: true }); n++; }
    }
  }
  return n;
}

/**
 * contradictionIds(verdict, shortlist) -> string[]  — PURE. The adapter between engine.mjs and
 * contradict.mjs, exported so a guard can pin the shape the two modules exchange.
 *
 * WHY THIS EXISTS. engine.mjs asked `Array.isArray(verdicts)` while judgeContradictions returns
 * an OBJECT — { contradicts, judged, reason, ms }. The test was therefore false on every single
 * call and EVERY contradiction judgment was silently discarded. Measured on the real 58-turn walk
 * of GDDadwill.txt (2026-08-20): 94 atoms, 6 gzip-NCD shortlist hits, the judge invoked on all 6,
 * and 0 verdicts recorded — the design's own minimum-viable-proof step ("when you prove that you
 * can automatically detect a single contradiction, you have officially built the ruler") was dead
 * on the walk path and nothing anywhere said so.
 *
 * Accepts the object shape, tolerates a bare array, and NEVER trusts an id the shortlist did not
 * contain — the judge is fallible and may name an atom it was never shown.
 */
export function contradictionIds(verdict, shortlist = []) {
  const raw = Array.isArray(verdict) ? verdict
    : (verdict && Array.isArray(verdict.contradicts) ? verdict.contradicts : []);
  const allowed = new Set((Array.isArray(shortlist) ? shortlist : []).map((s) => s && s.id).filter(Boolean));
  const seen = new Set();
  return raw
    .filter((id) => typeof id === 'string' && allowed.has(id))
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

// ── STEP — take the turn at session.cursor and ONLY that turn (R0) ─────────────
export async function step(slug, opts = {}) {
  const session = store.loadSession(slug);
  if (!session) return { ok: false, error: `no session '${slug}'` };
  if (session.paused) return { ok: false, error: 'session paused', paused: true };

  const queue = await getTurnQueue(slug, session);
  if (session.cursor >= queue.length) {
    session.totalTurns = queue.length;
    store.saveSession(slug, session);
    return { ok: true, done: true, cursor: session.cursor, totalTurns: queue.length };
  }

  const turn = queue[session.cursor];
  const primer = buildPrimer(session);
  const atomResult = await atomizeTurn(turn, { session, primer, repoRoot: opts.repoRoot || REPO, model: opts.model });
  const tapePath = path.join(store.sessionPath(slug), 'flight-tape.json');
  const withFidelity = opts.withFidelity !== false;

  const placedAtoms = [];

  const scan = { candidates: 0, shortlisted: 0, atomsShortlisted: 0, judged: 0 };
  for (const proto of atomResult.atoms) {
    const id = nextAtomId(slug, proto.type || 'DECISION');
    const p = await physics.placeAtom({ quote: proto.quote, rule: proto.rule, tapePath, withFidelity });

    const atom = {
      id, type: proto.type || 'DECISION', source: turn.source,
      chunk: [turn.startLine ?? null, turn.endLine ?? null], turn: turn.idx,
      quote: proto.quote, rule: proto.rule,
      target_surface: proto.target_surface || null, falsifier: proto.falsifier || null,
      coord: p.coord, placement: p.placement, sigma: p.sigma, sensor: p.sensor,
      cells: p.cells, apertureFidelity: p.apertureFidelity, fidelity: p.fidelity || null,
      priority: proto.priority || 'P1', status: 'suggested', picked_by: 'ai',
      parent_id: null, contradicts: [], extractor: atomResult.extractor,
      laneDrift: null,
    };

    // Contradiction shortlist — LLM-free, blocks nothing, always computed against the
    // ledger's LIVE atoms so far (including any appended earlier in this very step).
    const priorLive = store.resolveAtoms(slug);
    const shortlist = physics.ncdShortlist(atom.rule, priorLive.map((a) => ({ id: a.id, rule: a.rule })));
    if (shortlist.length) atom.contradictShortlist = shortlist;
    scan.candidates += priorLive.length;
    if (shortlist.length) { scan.shortlisted += shortlist.length; scan.atomsShortlisted += 1; }

    store.appendAtom(slug, atom);
    placedAtoms.push(atom);

    // Contradiction JUDGMENT — advisory, off the receipt path, lazy + honest.
    // It may write contradicts[] and its own reason, and NOTHING else (design §D): never
    // placement, sigma, laneDrift, laneAuc, an enforcement number or a PNG.
    if (shortlist.length) {
      const cj = await loadContradict();
      const fn = cj?.judgeContradictions;
      if (typeof fn === 'function') {
        try {
          const verdict = await fn(atom, shortlist, {});
          scan.judged += 1;
          const ids = contradictionIds(verdict, shortlist);
          if (ids.length) store.editAtom(slug, atom.id, { contradicts: ids, contradictJudged: true });
          else store.editAtom(slug, atom.id, {
            contradicts: [],
            contradictJudged: verdict?.judged === true,
            // An unjudged shortlist is not the same as a judged "no contradiction". Record which.
            contradictReason: verdict?.judged === true ? null : (verdict?.reason || 'judge returned no verdict'),
          });
        } catch (e) {
          // Advisory: a throw here must never break the receipt path — but it must never be
          // invisible either. A silently swallowed judgment is how this lane died the first time.
          store.editAtom(slug, atom.id, { contradicts: [], contradictJudged: false, contradictReason: 'judge threw: ' + e.message });
        }
      } else {
        store.editAtom(slug, atom.id, { contradicts: [], contradictJudged: false, contradictReason: 'contradict.mjs not available' });
      }
    }

    // Home + backfill.
    const liveNow = store.resolveAtoms(slug);
    const repCoords = liveNow.map((a) => a.coord).filter(Boolean);
    const homeCalc = physics.homeCoord(repCoords, { min: 8 });
    const hadHome = !!session.home?.coord;
    if (homeCalc.coord) {
      session.home = { coord: homeCalc.coord, decidedFrom: homeCalc.n, support: homeCalc.support };
      if (!hadHome) backfillLaneDrift(slug, homeCalc.coord);
    }
    const laneDrift = session.home?.coord ? physics.driftFrom(session.home.coord, atom.coord) : null;
    if (laneDrift !== null) store.editAtom(slug, atom.id, { laneDrift });

    const vegaRows = store.readVega(slug);
    const prevAuc = vegaRows.length ? vegaRows[vegaRows.length - 1].laneAuc : 0;
    const pos = vegaRows.length;
    store.appendVega(slug, physics.vegaRow({ atomId: atom.id, pos, coord: atom.coord, sigma: atom.sigma, laneDrift, prevAuc }));
    atom.laneDrift = laneDrift;
  }

  // THE CONTRADICTION LANE MUST NEVER BE SILENTLY SILENT.
  // "0 contradictions" has to be distinguishable from "the lane never ran", or a tape that
  // checked nothing looks exactly like a tape that checked everything and found it clean.
  // MEASURED 2026-08-20 and left as an open finding rather than retuned blind: on one-line
  // extracted rules the gzip-NCD shortlist does not fire at its 0.45 gate. A genuinely opposed
  // pair — "read exactly one unchecked decided atom at a time, never more" vs "read the whole
  // remaining queue in one pass and fire them all in parallel" — measured 0.5225, while
  // unrelated pairs from the same two turns spread 0.4943–0.6311. The opposed pair is not
  // separable from the unrelated ones at this size-order, which is the naked-rule matching
  // CLAUDE.md's META-BULK rule forbids. Raising the gate to catch 0.5225 would shortlist
  // nearly every pair and destroy the blast-radius fence, so the gate stays and the shortfall
  // is REPORTED here instead of being hidden as a clean bill of health.
  const prevScan = session.contradictionScan || { candidates: 0, shortlisted: 0, atomsShortlisted: 0, judged: 0 };
  session.contradictionScan = {
    candidates: prevScan.candidates + scan.candidates,
    shortlisted: prevScan.shortlisted + scan.shortlisted,
    atomsShortlisted: prevScan.atomsShortlisted + scan.atomsShortlisted,
    judged: prevScan.judged + scan.judged,
    threshold: 0.45,
    note: 'shortlist = gzip-NCD <= 0.45 between one-line rules (LLM-free). judged = pairs the off-path judge actually saw. A judged count of 0 means no pair was ever presented, NOT that the tape is free of contradictions.',
  };

  session.cursor += 1;
  session.totalTurns = queue.length;
  session.stats = store.stats(slug);
  store.saveSession(slug, session);

  return {
    ok: true, done: false,
    turn: { index: turn.idx, source: turn.source, role: turn.role, startLine: turn.startLine, endLine: turn.endLine, chars: turn.text.length },
    atoms: placedAtoms, extractor: atomResult.extractor, extractorAvailable: atomResult.extractorAvailable !== false,
    extractorReason: atomResult.extractorReason || null,
    cursor: session.cursor, totalTurns: queue.length, home: session.home,
  };
}

// ── RUN — loop step, honoring pause and an optional external stop signal ───────
export async function run(slug, { maxTurns = Infinity, shouldStop = () => false } = {}) {
  const results = [];
  let n = 0;
  while (n < maxTurns) {
    if (shouldStop()) { results.push({ ok: true, stopped: true }); break; }
    const session = store.loadSession(slug);
    if (!session) return { ok: false, error: `no session '${slug}'`, steps: n, results };
    if (session.paused) { results.push({ ok: true, paused: true }); break; }
    const r = await step(slug);
    results.push(r);
    n++;
    if (!r.ok || r.done) break;
  }
  return { ok: true, steps: n, results, last: results[results.length - 1] || null };
}

// ── DISPATCH PROMPT — the default the operator edits on the page (R6) ──────────
export function generateDispatchPrompt(atom, { repoRoot = REPO } = {}) {
  const lines = [];
  lines.push('TAPE DISPATCH — enforce one decided spec atom in this repo.');
  lines.push('');
  lines.push(`ATOM ${atom.id}  (${atom.type}, priority ${atom.priority || 'P1'})`);
  lines.push(`RULE: ${atom.rule}`);
  lines.push('');
  lines.push(`VERBATIM SOURCE QUOTE (${atom.source ? path.relative(repoRoot, atom.source) || atom.source : 'source unknown'}${(atom.chunk || []).some(Number.isFinite) ? `, lines ${(atom.chunk || []).join('–')}` : ''}):`);
  lines.push('"""');
  lines.push(atom.quote || '(no quote captured)');
  lines.push('"""');
  lines.push('');
  lines.push(`TARGET SURFACE: ${atom.target_surface || 'not named in the source — find the right surface yourself and say what you chose and why before editing it.'}`);
  if (atom.falsifier) {
    lines.push('');
    lines.push(`FALSIFIER (must pass before you report this done): ${atom.falsifier}`);
  }
  lines.push('');
  lines.push('REPO STANDING CONVENTIONS (CLAUDE.md — non-negotiable, this tree is shared by parallel rooms right now):');
  lines.push('- NEVER create a git branch. NEVER `git commit --amend`, rebase, or reset on a shared tree.');
  lines.push('- Commit ONLY with `git commit --only <the exact paths you touched>`. Never `git add -A`.');
  lines.push('- THE DELIVERABLE IS THE GUARD, not the patch: ship a regression test / falsifier for this rule in the SAME commit as the fix.');
  lines.push('- Evidence over assertion: run what you built and paste the REAL output. "Should work" is not a report.');
  lines.push('- If this rule cannot be reached cleanly, say so plainly and explain the obstacle — never fabricate a pass.');
  lines.push('');
  lines.push('When done, report: exactly what you changed (file paths), the commit sha, and the real command output proving the falsifier (or the constraint) now holds.');
  return lines.join('\n');
}

export const __internals__ = { turnsForSource, nextAtomId, backfillLaneDrift, buildPrimer, stubAtomize };
