// packages/thetacog-mcp/scripts/tape/lock-and-attest.mjs — THE SINGLE SHARED WIRE.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
// The operator's target: "The right pane instantly locks COORD-010 to the SQLite tape. On the left,
// the terminal ignites." Two surfaces, one act. The failure mode that makes that impossible is TWO
// IMPLEMENTATIONS — a page path and a CLI path that drift until the glass and the metal disagree
// about what happened. This repo has an incident for exactly that shape (the panel was built two
// ways; only one was correct), which is why the panel now has ONE door.
//
// So locking is one door too. This script is the whole act, and BOTH surfaces invoke it:
//   · the page  → POST /api/lock → shells out to this file
//   · the CLI   → node lock-and-attest.mjs --slug s --rule "..." directly
// Same code, same ledger row, same panel, same event line. Neither surface can do something the
// other cannot see, because there is nothing else to do it with.
//
// ── WHAT ONE LOCK ACTUALLY IS ─────────────────────────────────────────────────────────────────
//   1. LOCK      coordinates.mjs lockCoordinate() — places the rule on the real ballistic walk,
//                discovers owns[] by git grep, mints the id and appends under a ledger lock.
//   2. ATTEST    build the decision's evidence corpus and render the encircled panel through
//                scripts/pmu/panel-door.mjs — the ONE door — carrying its admissibility reading.
//   3. ANNOUNCE  append ONE line to cli-events.ndjson AND print it to stdout, so the terminal
//                acknowledges a lever pulled on the glass. This is the "[TAPE] COORD-010 locked"
//                line; it is emitted here rather than by the caller so both surfaces get it free.
//
// Step 3 is deliberately the LAST thing and is best-effort: an announcement that fails must never
// lose a coordinate that is already on the tape. The ledger is the truth; the event line is a copy.
//
// ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────────────────────
// It does NOT dispatch a subagent and it does NOT commit. Locking a coordinate is the operator's
// decision being recorded; dispatching is a separate, countable act with its own receipt (worker.mjs)
// and its own failure modes. Fusing them would mean a failed dispatch could roll back a decision the
// operator actually made, which is backwards — the decision stands, the execution is what retries.
//
//   node lock-and-attest.mjs --slug <s> --rule "<text>" [--steer "<text>"] [--quote "<text>"]
//                            [--by cockpit|cli] [--json] [--no-panel]
//
// @guard tests/tape/lock-and-attest-writes-the-tape.test.mjs

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

/** The line the terminal shows the instant a lever moves on the glass. */
export function eventLine(row, { dispatching = null } = {}) {
  const owns = (row.owns || []).filter((o) => o.kind === 'code').map((o) => o.file).slice(0, 3);
  const bits = [
    `[TAPE] ${row.id} locked`,
    row.coord ? `→ ${row.coord}` : '→ UNPLACED',
    row.sigma != null ? `σ ${row.sigma}` : null,
    owns.length ? `owns: [${owns.join(', ')}]` : 'owns: none discovered',
    dispatching ? `→ dispatching ${dispatching}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

/**
 * ATTEST one decision row: build its evidence corpus, check admissibility, and ONLY THEN render.
 *
 * ── THE 2336-BYTE INCIDENT (measured 2026-08-20) — why the admissibility gate is BEFORE the render ─
 * COORD-011, COORD-012 and COORD-013 all rendered at exactly 2336 bytes, byte-identical
 * (md5 d64efc803587493c1e3f3ccaea3fdb61). Reproduced: `panel({ intent: <anything>, reality: "" })`
 * returns that SAME constant PNG (5184 green / 15552 amber / 0 red) for ANY intent text — when one
 * side is empty the walk collapses to a constant tiling carrying zero information about either text.
 * The reality side was empty because those coordinates have owns[] = [] and no target_surface, so
 * decisionCorpus's readSurface(null) returned ''. gzip mass: reality 20 bytes vs the 220-byte floor.
 * The old code computed `admissible:false` and then WROTE THE PRETTY ARTIFACT ANYWAY, so the glass
 * had a real PNG whose pixels were a lie. The gate below refuses to render an inadmissible pair;
 * the attest instead SAYS which side lacked mass, with the measured gzip bytes.
 *
 * ── WHAT REALITY IS WHEN owns[] IS EMPTY ─────────────────────────────────────────────────────────
 * Nothing — and that is the honest answer, not a gap to paper over. A rule that names no readable
 * surface has no reality AT LOCK TIME; fabricating one (repo boilerplate, the rule echoed back)
 * would be the exact quiet substitution the corpus module exists to refuse. The reality for such a
 * decision ARRIVES when the dispatched agent commits: the commit's own published encircled panel
 * (public/commit/<sha>/trip-encircled-<sha>.png) IS the intent→reality delta of the act, and
 * last-action-panel.mjs binds the cockpit's action slot to exactly that. Decision unrenderable now,
 * receipt arrives with the execution — the decision stands, the evidence is what catches up.
 *
 * Exported separately from lockAndAttest so the guard can exercise the gate on a fabricated row
 * without minting a real coordinate. @guard tests/tape/panel-shows-the-last-action.test.mjs
 */
export async function attestDecision(slug, row) {
  const P = await import(resolve(HERE, 'physics.mjs'));
  const DOOR = await import(resolve(REPO, 'scripts/pmu/panel-door.mjs'));
  const DC = await import(resolve(HERE, 'decision-corpus.mjs'));
  const massFloor = await DOOR.canonicalMassFloor();
  const turns = DC.loadTurns(slug);
  const corpus = DC.decisionCorpus(row, turns, P, DOOR, { massFloor });
  const adm = corpus.admissibility || {};

  // THE GATE. An inadmissible pair is refused BEFORE the renderer — never rendered-then-flagged,
  // because the render of a thin pair is a constant artifact, not a reading of this decision.
  if (adm.admissible !== true) {
    return {
      rendered: false,
      admissible: adm.admissible ?? null,
      notAdmissible: adm.notAdmissible || adm.unmeasured || 'admissibility could not be computed',
      intentGzip: adm.intentGzip ?? null, realityGzip: adm.realityGzip ?? null,
      massFloor: adm.massFloor ?? massFloor ?? null,
      provenance: corpus.provenance?.kind || null,
      surfaceReason: corpus.surfaceReason || null,
      reason: `refused to render: ${adm.notAdmissible || adm.unmeasured || 'inadmissible pair'}`,
    };
  }

  const r = await DOOR.panel({
    intent: corpus.intent, reality: corpus.reality, message: row.rule,
    label: row.id, sub: corpus.surfaceFile || '',
  });
  if (!r?.png) return {
    rendered: false, admissible: true,
    intentGzip: adm.intentGzip, realityGzip: adm.realityGzip, massFloor: adm.massFloor,
    provenance: corpus.provenance?.kind || null,
    reason: r?.unmeasured || 'renderer returned no png',
  };

  const dir = resolve(SESSIONS, slug, 'html', 'receipts');
  mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `${row.id}.png`);
  writeFileSync(out, r.png);
  return {
    rendered: true, png: out.replace(REPO + '/', ''), bytes: r.png.length,
    meta: r.meta, regions: (r.regions || []).length,
    provenance: corpus.provenance?.kind || null,
    // The admissibility reading rides along so the glass never shows a length artifact as proof.
    admissible: r.meta?.admissible ?? true,
    notAdmissible: r.meta?.notAdmissible ?? null,
    intentGzip: adm.intentGzip, realityGzip: adm.realityGzip, massFloor: adm.massFloor,
  };
}

/**
 * Lock + attest. Returns everything both surfaces need to render the same act.
 * `panel:false` skips the render (the lock is still real) — used by tests and by a CLI that only
 * wants the ledger row, never as a silent degradation on the interactive path.
 */
export async function lockAndAttest(slug, { rule, steer = null, quote = null, by = 'cockpit', panel = true } = {}) {
  if (!rule || !String(rule).trim()) return { ok: false, reason: 'a coordinate needs a rule' };

  // ── STAGE TIMINGS, REPORTED · A LOCK TAKES MINUTES AND NOTHING SAID SO ───────────────────────
  // Measured 2026-08-21: one lock took 84s through the API and 3m39s standalone, at 11% CPU — so it
  // was WAITING, not computing. The operator experienced that as a frozen cockpit and reported it as
  // a UI bug three times. The UI was innocent; it was faithfully showing a button attached to a
  // three-minute call.
  //
  // Guessing which stage owns the minutes is exactly the move this repo bans. So each stage is
  // timed and the split ships in the response, where the page can put it next to the act. A cost
  // nobody can see is a cost nobody can cut.
  const t = { started: Date.now() };
  const mark = (k) => { t[k] = Date.now() - t.started; };

  const { lockCoordinate } = await import(resolve(HERE, 'coordinates.mjs'));
  const locked = await lockCoordinate(slug, {
    rule: String(rule), steer, quote, createdBy: by, kind: 'created',
  });
  // lockCoordinate returns { ok, coordinate, cone } — NOT { row }. Reading the wrong key produced a
  // response whose every field was undefined while the ledger row itself was written perfectly, and
  // it wrote a receipts/undefined.png on the way past. The cone rides along and is the narrowing
  // signal the operator watches ("the cone narrows from 1.25 to 0.95"), so it is carried through
  // rather than recomputed by whoever wants it.
  mark('placeMs');
  if (!locked?.ok || !locked?.coordinate) return { ok: false, reason: locked?.reason || 'lockCoordinate returned no coordinate' };
  const row = locked.coordinate;
  const cone = locked.cone || null;

  // ── ATTEST ────────────────────────────────────────────────────────────────────────────────
  let attest = { rendered: false, reason: 'panel render not requested' };
  if (panel) {
    try {
      attest = await attestDecision(slug, row);
    } catch (e) {
      // A failed panel must NEVER unwind a real coordinate. The lock already happened.
      attest = { rendered: false, reason: `attestation failed after the lock succeeded: ${String(e.message).slice(0, 200)}` };
    }
    mark('attestMs');
  }
  // attestMs is cumulative-from-start; the render's own cost is the difference.
  const timings = {
    placeMs: t.placeMs ?? null,
    renderMs: t.attestMs != null && t.placeMs != null ? t.attestMs - t.placeMs : null,
    totalMs: Date.now() - t.started,
  };

  // ── ANNOUNCE — best-effort, last, never load-bearing ──────────────────────────────────────
  const line = eventLine(row);
  try {
    const dir = resolve(SESSIONS, slug);
    mkdirSync(dir, { recursive: true });
    appendFileSync(resolve(dir, 'cli-events.ndjson'), JSON.stringify({
      ts: new Date().toISOString(), kind: 'lock', by,
      id: row.id, coord: row.coord, sigma: row.sigma,
      owns: (row.owns || []).filter((o) => o.kind === 'code').map((o) => o.file),
      panel: attest.png || null, admissible: attest.admissible ?? null,
      notAdmissible: attest.notAdmissible ?? attest.reason ?? null,
      intentGzip: attest.intentGzip ?? null, realityGzip: attest.realityGzip ?? null,
      line,
    }) + '\n');
  } catch { /* the ledger is the truth; a lost event line is cosmetic */ }

  return { ok: true, row, cone, attest, line, timings };
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
  const slug = arg('--slug', 'gddadwill');
  const rule = arg('--rule', null);
  if (!rule) { console.error('usage: lock-and-attest.mjs --slug <s> --rule "<text>" [--steer "..."]'); process.exit(2); }

  const res = await lockAndAttest(slug, {
    rule, steer: arg('--steer', null), quote: arg('--quote', null),
    by: arg('--by', 'cli'), panel: !process.argv.includes('--no-panel'),
  });
  if (!res.ok) { console.error(`✗ ${res.reason}`); process.exit(2); }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(res)); process.exit(0); }

  console.log(`\n  ${res.line}`);
  console.log(`  rule: ${String(res.row.rule).slice(0, 100)}${res.row.rule.length > 100 ? '…' : ''}`);
  if (res.attest.rendered) {
    console.log(`  panel: ${res.attest.png} (${res.attest.bytes} bytes · ${res.attest.regions} region(s) · off ${res.attest.meta?.offPct}%)`);
    console.log(`  admissible: ${res.attest.admissible} ${res.attest.notAdmissible ? `— ${res.attest.notAdmissible.slice(0, 120)}` : ''}`);
    console.log(`  provenance: ${res.attest.provenance}`);
  } else {
    console.log(`  panel: NOT RENDERED — ${res.attest.reason}`);
  }
  console.log('');
}
