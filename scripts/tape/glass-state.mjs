// packages/thetacog-mcp/scripts/tape/glass-state.mjs — ONE ARTIFACT, TWO READERS.
//
// Operator, after catching three visual regressions the agent could not see:
//   "that's a perfect example of a GDD fail — if it was built right the output would be readable by
//    you in the same step as served."
//
// An assistant driving the cockpit has no browser. It curls HTML and INFERS what the operator sees,
// so it misses regressions the operator catches instantly — and it has repeatedly reported
// "verified" for states that were visibly wrong on the glass. The page can render one thing while
// every API it calls returns another, and nothing detects the disagreement.
//
// The fix is the repo's own principle turned on the page itself: the cockpit's top deck emits a
// machine-readable snapshot of THE STATE IT ACTUALLY RESOLVED TO, written to the tape as it is
// served, so a human reading pixels and an agent reading JSON are looking at the same artifact.
//
// ── WHAT THE SNAPSHOT CARRIES ─────────────────────────────────────────────────────────────────
//   provenance      what session.json says was ingested (source file, bytes, mtime, turns/lines)
//   question        the active ask AND its retirement verdict — via question-retirement.mjs's
//                   retirementFor(), THE ONE DOOR. Two independent retirement checks already
//                   existed once (0.62 vs 0.52 thresholds) and were collapsed; this module reads
//                   the door, it does not build a third.
//   canonicalPanel  the real committed encircled PNG being shown (sha, path, bytes) — found on
//                   disk, never fabricated, same search order as api/canonical-panel
//   coordinates     the locked body: count, cells occupied, cone()/coneMomentum() from
//                   coordinates.mjs — the same functions the page's numbers come from
//   events          the last few cli-events.ndjson rows + live agents (fired minus finished,
//                   clamped at 0 — a lost completion line reads as still-running, never negative)
//
// Every section carries its value OR an `unmeasured` string naming which file was missing and what
// it would have held. Never a zero standing in for unknown.
//
// ── THE HASH IS THE NULL TEST ─────────────────────────────────────────────────────────────────
// `stateHash` is sha256 of the canonical (key-sorted) JSON with `renderedAt` excluded, so two reads
// answer "did anything actually change?" — precisely the question that exposed the stale-question
// bug: the page looked alive while its state was constant. A hash that never changes is the bug
// this file exists to catch. Assembly is READ-ONLY (retirementFor runs with record:false): a
// snapshot must not mutate the tape it is snapshotting, or the second read differs because of the
// first read and the null test destroys itself.
//
// LLM-FREE by construction — ledger reads, fs stats, git log, and the gzip sensor behind the one
// retirement door. Nothing in this module's import graph reaches a model.
//
// @guard tests/tape/glass-state-matches-served.test.mjs

import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync } from 'node:fs';
// git via the resolver — a bare 'git' is Apple's licence-gated xcrun stub and dies silently
// in any process without DEVELOPER_DIR (see git-bin.mjs; it cost 17 of 26 coordinates their owns[]).
import { git } from './git-bin.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCoordinates, cone, coneMomentum } from './coordinates.mjs';
import { retirementFor } from './question-retirement.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

export const GLASS_FILE = 'glass-state.json';

const sdir = (slug) => resolve(SESSIONS, slug);
const rel = (p) => p.startsWith(REPO + '/') ? p.slice(REPO.length + 1) : p;

function readNdjson(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ── provenance — what the tape says it ingested ───────────────────────────────────────────────
export function provenanceFor(slug) {
  const p = resolve(sdir(slug), 'session.json');
  if (!existsSync(p)) {
    return { unmeasured: `no session.json at ${rel(p)} — it would have held the source file path, turn count, line count and ingest cursor for "${slug}"` };
  }
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    const source = Array.isArray(s.sources) && s.sources[0] ? s.sources[0] : null;
    let sourceStat = `unmeasured — session.json names no source file, so bytes/mtime cannot be read`;
    if (source) {
      if (existsSync(source)) {
        const st = statSync(source);
        sourceStat = { bytes: st.size, mtime: st.mtime.toISOString() };
      } else {
        sourceStat = `unmeasured — source file missing at ${source}; it would have held the raw transcript's bytes and mtime`;
      }
    }
    return {
      sessionFile: rel(p),
      sourceFile: source || 'unmeasured — session.json carries an empty sources array',
      sourceStat,
      totalTurns: s.totalTurns ?? 'unmeasured — session.json has no totalTurns field',
      totalLines: s.totalLines ?? 'unmeasured — session.json has no totalLines field',
      coveredLines: s.coveredLines ?? 'unmeasured — session.json has no coveredLines field',
      cursor: s.cursor ?? 'unmeasured — session.json has no cursor field',
      updatedAt: s.updatedAt ?? 'unmeasured — session.json has no updatedAt field',
    };
  } catch (e) {
    return { unmeasured: `session.json unreadable at ${rel(p)}: ${String(e.message).slice(0, 160)}` };
  }
}

// ── question — the active ask and its retirement verdict, through the one door ────────────────
export async function questionFor(slug) {
  const p = resolve(sdir(slug), 'questions.ndjson');
  if (!existsSync(p)) {
    return { unmeasured: `no questions.ndjson at ${rel(p)} — it would have held the ranked question records and any recorded retirements. Produce one with: node packages/thetacog-mcp/scripts/tape/next-question.mjs --slug ${slug}` };
  }
  let records;
  try { records = readNdjson(p); } catch (e) {
    return { unmeasured: `questions.ndjson unreadable at ${rel(p)}: ${String(e.message).slice(0, 160)}` };
  }
  // The newest record that actually HAS a question — same fallback api/question uses: a barren
  // ranking run must not silently replace a live question with an empty pane.
  const idx = records.map((r) => !!r.ask).lastIndexOf(true);
  if (idx < 0) {
    return { unmeasured: `questions.ndjson at ${rel(p)} holds ${records.length} record(s) but none carries an ask — every ranking run was barren or the file holds only retirements` };
  }
  const recAsk = records[idx].ask;
  const askTs = records[idx].ts;
  // Already durably recorded as retired? The ledger is the truth; this is a read of it, distinct
  // from the live verdict below (which recomputes through the sensor and may see a NEWER answer).
  const recorded = records.filter((r) => r.kind === 'retired' && r.askId === recAsk.id);
  // THE ONE DOOR — question-retirement.mjs owns the threshold, the sensor, and the wording.
  // record:false because assembly is read-only: recording belongs to the CLI and api/question;
  // a snapshot that appends to the ledger changes the very state its second read is compared to.
  const retirement = await retirementFor(slug, recAsk, askTs, { record: false });
  return {
    id: recAsk.id,
    question: recAsk.question,
    askedAt: askTs,
    answers: (recAsk.answers || []).map((a) => ({ label: a.label, coord: a.coord ?? 'unplaced' })),
    retirement,
    recordedRetired: recorded.length
      ? { by: recorded[recorded.length - 1].by, ts: recorded[recorded.length - 1].ts, ncd: recorded[recorded.length - 1].ncd }
      : false,
    barrenSince: records.length - 1 - idx > 0 ? records.filter((r, i) => i > idx && !r.kind).length : 0,
  };
}

// ── canonical panel — the real committed artifact being shown, never fabricated ───────────────
// Same search order as api/canonical-panel/+server.js: web-servable first, archive second, og
// fallback third; git log for recency, disk scan when git is unavailable.
const panelCandidates = (sha) => [
  { path: resolve(REPO, 'public/commit', sha, `trip-encircled-${sha}.png`), origin: 'public/commit (web-servable)' },
  { path: resolve(REPO, 'docs/pmu/commit-panels', `${sha}-encircled.png`), origin: 'docs/pmu/commit-panels (archive)' },
  { path: resolve(REPO, 'public/commit', sha, 'og.png'), origin: 'public/commit og.png (fallback)' },
];

export function canonicalPanelFor() {
  let shas = [];
  try {
    const r = git(['log', '--format=%h', '-40'], { cwd: REPO, timeout: 10000 });
    if (!r.ok) throw new Error(r.reason);
    shas = r.out.split('\n').filter(Boolean);
  } catch { /* git unavailable — fall through to the disk scan */ }
  for (const s of shas) {
    const hit = panelCandidates(s).find((c) => existsSync(c.path));
    if (hit) {
      const st = statSync(hit.path);
      return { sha: s, file: rel(hit.path), origin: hit.origin, bytes: st.size, mtime: st.mtime.toISOString() };
    }
  }
  try {
    const base = resolve(REPO, 'public/commit');
    const dirs = readdirSync(base).map((d) => ({ d, p: resolve(base, d, `trip-encircled-${d}.png`) })).filter((x) => existsSync(x.p));
    if (dirs.length) {
      const last = dirs[dirs.length - 1];
      const st = statSync(last.p);
      return { sha: last.d, file: rel(last.p), origin: 'public/commit (disk scan — git unavailable)', bytes: st.size, mtime: st.mtime.toISOString() };
    }
  } catch { /* nothing published */ }
  return { unmeasured: 'no commit in the last 40 has a published canonical panel on disk — publish-commit-page.mjs runs async post-commit and LAGS the tape, so a very recent commit legitimately has none yet. Searched public/commit/<sha>/trip-encircled-<sha>.png and docs/pmu/commit-panels/<sha>-encircled.png' };
}

// ── coordinates — the locked body and its cone, from the same functions the page uses ─────────
export function coordinatesFor(slug) {
  const p = resolve(sdir(slug), 'coordinates.ndjson');
  if (!existsSync(p)) {
    return { unmeasured: `no coordinates.ndjson at ${rel(p)} — it would have held the locked coordinate ledger (id, rule, coord, sigma per row) that the cone is computed from` };
  }
  const coords = liveCoordinates(slug);
  const placed = coords.filter((c) => c.coord);
  const cells = [...new Set(placed.map((c) => c.coord))].sort();
  const c = cone(coords);
  return {
    count: coords.length,
    placed: placed.length,
    cellsOccupied: cells.length,
    cells,
    cone: c.centre
      ? { centre: c.centre, centreLabel: c.centreLabel, width: c.width, max: c.max, n: c.n, provisional: !!c.provisional }
      : { unmeasured: `cone has no centre: ${c.reason || 'no coordinate locked yet'}` },
    momentum: coneMomentum(coords),
  };
}

// ── events — the terminal's tape, and how many agents are still out ───────────────────────────
export function eventsFor(slug, { limit = 6 } = {}) {
  const p = resolve(sdir(slug), 'cli-events.ndjson');
  if (!existsSync(p)) {
    return { unmeasured: `no cli-events.ndjson at ${rel(p)} — it would have held the lock/dispatch/dispatch-done rows both surfaces append; nothing has been fired from either surface yet` };
  }
  try {
    const rows = readNdjson(p);
    // Fired minus finished, clamped at zero — a lost 'done' line (best-effort by design) must read
    // as still-running, never as a negative count. Same derivation as api/events.
    let fired = 0, done = 0;
    for (const r of rows) {
      if (r.kind === 'dispatch') fired += Number(r.agents) || 0;
      if (r.kind === 'dispatch-done') done += 1;
    }
    return {
      total: rows.length,
      fired, done,
      liveAgents: Math.max(0, fired - done),
      recent: rows.slice(-limit).map((r) => ({ ts: r.ts, kind: r.kind, id: r.id ?? null, line: r.line ?? null })),
    };
  } catch (e) {
    return { unmeasured: `cli-events.ndjson unreadable at ${rel(p)}: ${String(e.message).slice(0, 160)}` };
  }
}

// ── the hash — canonical form, renderedAt excluded, so two reads are comparable ───────────────
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canonical(v[k]);
    return o;
  }
  return v;
}

export function stateHashOf(state) {
  const { renderedAt, stateHash, ...rest } = state; // eslint-disable-line no-unused-vars
  return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex');
}

// ── assembly ──────────────────────────────────────────────────────────────────────────────────
export async function assembleGlassState(slug) {
  const state = {
    slug,
    provenance: provenanceFor(slug),
    question: await questionFor(slug),
    canonicalPanel: canonicalPanelFor(),
    coordinates: coordinatesFor(slug),
    events: eventsFor(slug),
  };
  state.stateHash = stateHashOf(state);
  state.renderedAt = new Date().toISOString();
  return state;
}

export function serializeGlassState(state) {
  return JSON.stringify(state, null, 2) + '\n';
}

/**
 * Atomic write: temp file + rename, so a reader never catches a half-written file. Writes ONLY
 * into a session directory that already exists — a typo'd slug must not mint a junk session dir.
 */
export function writeGlassState(slug, serialized) {
  const dir = sdir(slug);
  if (!existsSync(dir)) {
    return { written: false, reason: `session directory ${rel(dir)} does not exist — refusing to create one for a slug the tape has never seen` };
  }
  const target = resolve(dir, GLASS_FILE);
  const tmp = resolve(dir, `.${GLASS_FILE}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, serialized);
    renameSync(tmp, target);
    return { written: true, file: rel(target) };
  } catch (e) {
    return { written: false, reason: String(e.message).slice(0, 200) };
  }
}

/** The write-as-you-serve unit: one assembly, one serialization, served AND written from the SAME bytes. */
export async function snapshotAndWrite(slug, { write = true } = {}) {
  const state = await assembleGlassState(slug);
  const serialized = serializeGlassState(state);
  const writeResult = write ? writeGlassState(slug, serialized) : { written: false, reason: 'dry run' };
  return { state, serialized, writeResult };
}

// ── CLI: node glass-state.mjs --slug gddadwill [--json] [--dry] ───────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const { state, serialized, writeResult } = await snapshotAndWrite(slug, { write: !process.argv.includes('--dry') });
  if (process.argv.includes('--json')) {
    // Exactly the bytes on disk — the route serves this verbatim, so serve==file by construction.
    process.stdout.write(serialized);
    if (!writeResult.written && !process.argv.includes('--dry')) process.stderr.write(`not written: ${writeResult.reason}\n`);
  } else {
    const q = state.question;
    console.log(`\n  glass state — ${slug}   hash ${state.stateHash.slice(0, 12)}`);
    console.log(`  question: ${q.unmeasured ? `UNMEASURED — ${q.unmeasured}` : `${q.id} — ${q.question}`}`);
    if (!q.unmeasured) console.log(`            ${q.retirement.retired ? '✓ RETIRED' : q.retirement.checked ? '· still open' : '? UNMEASURED'} — ${q.retirement.reason}`);
    const co = state.coordinates;
    console.log(`  coordinates: ${co.unmeasured ? `UNMEASURED — ${co.unmeasured}` : `${co.count} locked · ${co.cellsOccupied} cells · cone ${co.cone.unmeasured ? 'no centre' : `centre ${co.cone.centre} width ${co.cone.width}`} · ${co.momentum.verdict}`}`);
    const pa = state.canonicalPanel;
    console.log(`  panel: ${pa.unmeasured ? `UNMEASURED — ${pa.unmeasured.slice(0, 120)}` : `${pa.sha} · ${pa.file} · ${pa.bytes} bytes`}`);
    const ev = state.events;
    console.log(`  events: ${ev.unmeasured ? `UNMEASURED — ${ev.unmeasured.slice(0, 120)}` : `${ev.total} rows · ${ev.liveAgents} live agent(s) (${ev.fired} fired − ${ev.done} done)`}`);
    console.log(`  ${writeResult.written ? `written: ${writeResult.file}` : `NOT WRITTEN: ${writeResult.reason}`}\n`);
  }
}
