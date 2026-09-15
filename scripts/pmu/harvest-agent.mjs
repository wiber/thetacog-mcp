#!/usr/bin/env node
// scripts/pmu/harvest-agent.mjs — THE AFTERWARDS-AGENT (Cycle 2 C4 · spec §9 · the standing
// harvest contract). ONE AUTONOMOUS CYCLE per invocation:
//
//   1. INTAKE — adjudicated seeds (data/pmu/lens-c1-adjudication.json rows with verdicts) and
//      the C2 near-miss worklist (the floor file's lowest-Δσ battery rows).
//   2. APPLY — vocab stems / derived statements / anchor phrases / evictions onto
//      data/pmu/lens-reef.json, under the same rules lens-s2-seed proved (collision filter,
//      caps, historical-first). Applied rows are marked consumed in the adjudication file.
//   3. COMMIT — a reef-DATA commit authored by THIS AGENT: the message carries
//      `Harvest-Agent: autonomous` and NO Claude-Session trailer — the checkable provenance
//      (§9.3b): zero operator-session ids in the chain.
//   4. GATE — scripts/pmu/harvest-accept.mjs on that sha: sweep + battery, ACCEPT or
//      AUTO-REVERT (proven live-fire 2026-07-20: 406b09177 → e2cfc3ab8).
//   5. SEAL — on accept: re-pin the floor (F1 + Δσ fields) and seal a flight-tape state
//      `source: "harvest-agent"`; on red: the gate reverted, kickback carries root context.
//
// NON-BLOCKING BY CONSTRUCTION: runs as a knock-on (punch-list / Stop-hook / manual), never
// pre-commit, never touching human work. ENV: HARVEST_AGENT=1 marks the run.
//
// Run: HARVEST_AGENT=1 node scripts/pmu/harvest-agent.mjs [--dry]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync as _gzL } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const dry = process.argv.includes('--dry');
const REEF_PATH = resolve(REPO, 'data/pmu/lens-reef.json');
const ADJ_PATH = resolve(REPO, 'data/pmu/lens-c1-adjudication.json');

const reef = JSON.parse(readFileSync(REEF_PATH, 'utf8'));
const byName = new Map((reef.domains || []).map((d) => [d.domain, d]));
const vocabOf = (d) => new Set(String(d.vocab || '').toLowerCase().split(/\s+/).filter(Boolean));
const stemCount = new Map();
for (const d of reef.domains) for (const w of vocabOf(d)) stemCount.set(w, (stemCount.get(w) || 0) + 1);

let applied = { vocab: 0, derived: 0, anchors: 0, evictions: 0, skipped: 0 };
// TICK-PROMISE CONTRACT: settled promises (mass_bytes > 0, unique vs king moves) aggregate here
// and ride the seal — the tape advances on settled semantic mass, and bit rate becomes countable.
const promiseAgg = { settled: 0, mass_bytes: 0, density_sum: 0, coords: [] };
const seatedTexts = [];   // the cycle's ACTUAL content — the seal walks THIS, never boilerplate
const seatedKeys = [];
// N2b: sub-well files touched by child seating — loaded once, written once, committed alongside
const subWellCache = new Map();
// THE MELD (the C,A1 misplacement): the coordinate's own actor⊕patient definitions from the
// human-authored axis library — the anchor every seat/refresh decision and every seal intent
// carries. 262B of intent against a 202.4k reef is dust; the meld makes the question substantive.
let _axisLibH = null;
function meldForH(coord) {
  try {
    if (!_axisLibH) _axisLibH = JSON.parse(readFileSync(resolve(REPO, 'docs/architecture/axis-library-v1.json'), 'utf8'));
    const [ra, ca] = String(coord).split(',');
    const ax = (k) => (_axisLibH.axes || []).find((a) => a.rank === k);
    const A = ax(ra), B = ax(ca);
    if (!A || !B) return '';
    return [...(A.snippets || []).slice(0, 2), ...(B.snippets || []).slice(0, 2)].join(' ').slice(0, 1200);
  } catch { return ''; }
}

// ── 1+2 INTAKE + APPLY: adjudicated seeds ──────────────────────────────────────────────────
if (existsSync(ADJ_PATH)) {
  const adj = JSON.parse(readFileSync(ADJ_PATH, 'utf8'));
  for (const row of adj.rows || []) {
    if (row.consumed) continue;
    const d = byName.get(row.domain);
    if (!d) { applied.skipped++; continue; }
    // ── N2b: CHILD SEATING (cb1-split-chain-spec §2.2) — a row carrying child_coord seats its
    // derived statement into the SUB-WELL child cell, not the saturated depth-0 rule key. Same
    // CAP (8), same dedupe, same counted-drop honesty; the touched well file joins the commit.
    if (row.verdict === 'reef-missing' && row.proposal && row.child_coord && row.proposal.derived_statement) {
      const [parentC, childC] = String(row.child_coord).split('/');
      const wellPath = resolve(REPO, 'data/pmu/reef-l1', `${String(parentC || '').replace(',', '-')}.json`);
      let well = subWellCache.get(wellPath);
      if (well === undefined) {
        try { well = JSON.parse(readFileSync(wellPath, 'utf8')); } catch { well = null; }
        subWellCache.set(wellPath, well);
      }
      const cell = well && (well.cells || []).find((c) => String(c.coord) === String(childC));
      if (!cell) { applied.skipped++; row.consumed = true; continue; }
      cell.derived_statements = Array.isArray(cell.derived_statements) ? cell.derived_statements : [];
      const stmt = String(row.proposal.derived_statement);
      if (cell.derived_statements.includes(stmt)) applied.dup_dropped = (applied.dup_dropped || 0) + 1;
      else if (cell.derived_statements.length >= 8) applied.cap_dropped = (applied.cap_dropped || 0) + 1;
      else { cell.derived_statements.push(stmt); applied.derived++; applied.child_derived = (applied.child_derived || 0) + 1; seatedTexts.push(stmt.slice(0, 220)); seatedKeys.push(row.child_coord); }
      if (row.promise && row.promise.settled) { promiseAgg.settled++; promiseAgg.mass_bytes += row.promise.mass_bytes; promiseAgg.density_sum += row.promise.density; promiseAgg.coords.push(row.child_coord || row.coord); }
      row.consumed = true;
      continue;
    }
    if (row.verdict === 'reef-missing' && row.proposal) {
      const dv = vocabOf(d);
      for (const w of (row.proposal.vocab_stems || []).slice(0, 4)) {
        const lw = String(w).toLowerCase();
        if (lw.length < 4 || dv.has(lw) || (stemCount.get(lw) || 0) >= 2) continue;
        d.vocab = `${d.vocab} ${lw}`; dv.add(lw); stemCount.set(lw, (stemCount.get(lw) || 0) + 1); applied.vocab++;
      }
      if (row.proposal.derived_statement && row.rule_key) {
        d.derived_statements = d.derived_statements || {};
        const arr = d.derived_statements[row.rule_key] = d.derived_statements[row.rule_key] || [];
        // CAPACITY IS A SILENT LOSS (found 2026-07-20 by the operator-corpus wiring): a rule key
        // saturated at 8 statements drops every further candidate AND still marks the row consumed
        // — the candidate is BURNED, unreconsiderable, and nothing in the counters said so. That
        // single line explains the whole plateau: F1 frozen at 0.886, "agent+gate 0s / nothing to
        // apply", and 178 placed operator directives yielding zero. Count the drop by REASON so a
        // saturated reef is visible instead of looking like an empty mine.
        if (arr.includes(row.proposal.derived_statement)) applied.dup_dropped = (applied.dup_dropped || 0) + 1;
        else if (arr.length >= 8) {
          // N2b FALLBACK RE-ROUTE (2026-07-21, the 379-plateau): an at-capacity drop whose lane
          // HAS a sub-well with open children seats there instead of burning — the same physics
          // as demand's child-seat, applied at the last door. Lanes without a well still drop
          // counted (their relief is the auto-split rotation, not a silent burn).
          const wellPath2 = resolve(REPO, 'data/pmu/reef-l1', String(d.coord || '').replace(',', '-') + '.json');
          let rerouted = false;
          if (existsSync(wellPath2)) {
            let well2 = subWellCache.get(wellPath2);
            if (well2 === undefined) { try { well2 = JSON.parse(readFileSync(wellPath2, 'utf8')); } catch { well2 = null; } subWellCache.set(wellPath2, well2); }
            const open = well2 && (well2.cells || []).filter((c) => String(c.snippet || '').length >= 80 && (Array.isArray(c.derived_statements) ? c.derived_statements.length : 0) < 8);
            if (open && open.length) {
              const { ncd } = await import(resolve(HERE, 'burn-mass.mjs'));
              let best = null, bestD = 2;
              for (const c of open) { const dd = ncd(row.proposal.derived_statement, String(c.snippet)); if (dd < bestD) { bestD = dd; best = c; } }
              if (best) {
                best.derived_statements = Array.isArray(best.derived_statements) ? best.derived_statements : [];
                if (!best.derived_statements.includes(row.proposal.derived_statement)) {
                  best.derived_statements.push(row.proposal.derived_statement);
                  applied.derived++; applied.child_derived = (applied.child_derived || 0) + 1; rerouted = true;
                  seatedTexts.push(String(row.proposal.derived_statement).slice(0, 220)); seatedKeys.push(`${d.coord}/${best.coord}`);
                }
              }
            }
          }
          if (!rerouted) {
            // THE REFRESH VALVE (the immortal-tape fix): no well to route into, but a candidate
            // strictly closer to the rule's own text than the worst incumbent REPLACES it — the
            // seated set ratchets toward its rule, the evicted text burns so it never returns,
            // and the tape advances on genuinely better material even at full capacity.
            const { refreshPick, recordAttempt: recAtt } = await import(resolve(HERE, 'burn-mass.mjs'));
            const pick = refreshPick(row.proposal.derived_statement, arr, String(row.rule_key) + ' ' + meldForH(d.coord).slice(0, 400));   // NEVER the bare rule stem — the meld anchors topicality (the C,A1 misplacement)
            if (pick.replace != null) {
              const evicted = arr[pick.replace];
              arr[pick.replace] = row.proposal.derived_statement;
              recAtt(evicted, d.coord, { by: 'refresh-evict', rule_key: row.rule_key });
              applied.derived++; applied.refreshed = (applied.refreshed || 0) + 1;
              // EVERY APPLIED STATEMENT IS SEATED WORK (ratchet-9, the intake-only-with-derived
              // mismatch): the refresh valve applied real material but never told the seal, so
              // refresh-only cycles stamped 'intake only (1 derived)' — an under-reporting seal
              // is a receipt that cannot vary with the work, the exact disease the cycle-specific
              // contract exists to refuse. A refresh seats; the seal says so.
              seatedTexts.push(String(row.proposal.derived_statement).slice(0, 220));
              seatedKeys.push(`${d.coord || row.coord || row.domain}:${String(row.rule_key || '').slice(0, 30)}~refresh`);
            } else applied.cap_dropped = (applied.cap_dropped || 0) + 1;
          }
        }
        else {
          arr.push(row.proposal.derived_statement); applied.derived++;
          seatedTexts.push(String(row.proposal.derived_statement).slice(0, 220)); seatedKeys.push(`${row.coord || row.domain}:${String(row.rule_key || '').slice(0, 40)}`);
          if (row.promise && row.promise.settled) { promiseAgg.settled++; promiseAgg.mass_bytes += row.promise.mass_bytes; promiseAgg.density_sum += row.promise.density; promiseAgg.coords.push(row.coord); }
        }
      }
      row.consumed = true;
    } else if (row.verdict === 'boundary' && row.proposal?.anchor_phrase) {
      d.anchors = Array.isArray(d.anchors) ? d.anchors : [];
      const p = String(row.proposal.anchor_phrase).toLowerCase();
      if (!d.anchors.includes(p) && p.split(' ').length >= 2) { d.anchors.push(p); applied.anchors++; }
      row.consumed = true;
    } else if (row.verdict === 'over-broad-vocab' && row.proposal?.evict_stems) {
      const evict = new Set(row.proposal.evict_stems.map((s) => String(s).toLowerCase()));
      const before = String(d.vocab).split(/\s+/).length;
      d.vocab = String(d.vocab).split(/\s+/).filter((w) => !evict.has(w.toLowerCase())).join(' ');
      applied.evictions += before - String(d.vocab).split(/\s+/).length;
      row.consumed = true;
    } else { row.consumed = true; applied.skipped++; }   // trap-mislabel/discard — consumed, never seeded
  }
  if (!dry) writeFileSync(ADJ_PATH, JSON.stringify(adj, null, 1));
  if (!dry) for (const [wp, well] of subWellCache) if (well) writeFileSync(wp, JSON.stringify(well, null, 1));
}

const dropped = (applied.cap_dropped || 0) + (applied.dup_dropped || 0);
if (applied.refreshed) console.log(`refresh valve: ${applied.refreshed} incumbent(s) replaced by closer-to-rule material (evicted text burned — never returns)`);
console.log(`harvest-agent intake: +${applied.vocab} vocab · +${applied.derived} derived · +${applied.anchors} anchors · −${applied.evictions} evicted · ${applied.skipped} discarded${dropped ? ` · DROPPED ${applied.cap_dropped || 0} at-capacity + ${applied.dup_dropped || 0} duplicate (candidates BURNED — consumed without applying)` : ''}`);
if (applied.vocab + applied.derived + applied.anchors + applied.evictions === 0) { console.log('nothing to apply — cycle ends (no empty commits).'); process.exit(0); }
if (dry) { console.log('DRY RUN — no write/commit.'); process.exit(0); }

writeFileSync(REEF_PATH, JSON.stringify(reef, null, 1));

// MEANING LEDGER KNOCK-ON (operator 2026-07-21: density/drift/carried-meaning join the auto
// ticks). Fired DETACHED only on cycles that moved mass (empty cycles exited above) — the
// instrument appends to meaning-history.ndjson; nothing here reads its output (never a verdict).
try {
  const { spawn } = await import('node:child_process');
  const mchild = spawn('node', [resolve(HERE, 'tesseract-progress.mjs')], { cwd: REPO, detached: true, stdio: 'ignore' });
  mchild.unref();
} catch { /* knock-on only */ }

// ── 3 COMMIT — autonomous provenance (no session trailer; the agent IS the author) ─────────
// LOCK-CONTENTION RETRY (2026-07-20): git add/commit here races the concurrent panel-repair and
// commit-page publish auto-commits on .git/index.lock. Measured: 10 collisions overnight, all
// self-recovering, but each emitted a bare `fatal: index.lock` that woke the failure monitor.
// The collision is transient by nature (the other writer holds the lock for milliseconds), so a
// short backoff retry turns a benign-but-noisy fatal into a silent success. Same pattern as the
// revert-retry in harvest-accept. Only a PERSISTENT lock (a crashed writer's stale file) now
// surfaces — which is the one that genuinely warrants a human.
const gitWithRetry = (args, opts = {}) => {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe', ...opts }); }
    catch (e) {
      lastErr = e;
      if (!/index\.lock/.test(String(e.stderr || e.message))) throw e;   // a real git error is not retried
      if (attempt < 6) execFileSync('sleep', [String(attempt * 0.6)]);    // 0.6..3.0s → ~9s total, covers a concurrent commit-page publish (measured 46-144s cadence, ~1-3s hold)
    }
  }
  // Exhausted the ~9s window — this is no longer a transient collision but a PERSISTENT lock (a
  // crashed writer's stale file). Emit a DISTINCT marker so the failure monitor alerts on THIS
  // while staying silent for the transient collisions the retry now swallows. A bare 'fatal:' is
  // too broad — it woke the watcher on every benign collision.
  console.error('GIT-LOCK-STUCK: index.lock held past the retry window — a writer likely crashed; inspect .git/index.lock');
  throw lastErr;
};
const touchedWells = [...subWellCache.entries()].filter(([, w]) => w).map(([wp]) => wp.slice(REPO.length + 1));
// BATCH COMMITS (operator 2026-07-22: 'advance the tape without making a git commit every time'):
// a cycle below the mass floor seals its tape state but SKIPS the git commit — its file changes
// accumulate and ride the next qualifying cycle's commit. The tape is the per-cycle record; git
// is the batch checkpoint. Floor via HARVEST_COMMIT_MIN (default 2 applied units); gate-revert
// for uncommitted cycles = checkout of the touched files (see the gate block), never a rev revert.
const COMMIT_MIN = parseInt(process.env.HARVEST_COMMIT_MIN || '2', 10);
const massApplied = applied.vocab + applied.derived + applied.anchors;
const doCommit = massApplied >= COMMIT_MIN;
if (!doCommit) console.log(`batch-commit: cycle mass ${massApplied} < floor ${COMMIT_MIN} — tape seals, git waits (changes ride the next qualifying commit)`);
if (doCommit) {
gitWithRetry(['add', 'data/pmu/lens-reef.json', 'data/pmu/lens-c1-adjudication.json', ...touchedWells]);
gitWithRetry(['commit',
  '--only', 'data/pmu/lens-reef.json', '--only', 'data/pmu/lens-c1-adjudication.json',
  ...touchedWells.flatMap((wp) => ['--only', wp]),
  '-m', `harvest(agent): autonomous cycle — +${applied.vocab} vocab +${applied.derived} derived +${applied.anchors} anchors −${applied.evictions} evictions

Applied adjudicated seeds under the standing contract (spec §9 C4). Gated
next by harvest-accept (sweep + battery, auto-revert on red).

Harvest-Agent: autonomous
Provenance: no-operator-session`]);
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
if (doCommit) console.log(`committed ${sha.slice(0, 9)} (Harvest-Agent: autonomous)`);

// ── 4 GATE — accept or auto-revert (the constitution judges, not the agent) ────────────────
let gateOut = '';
let accepted = true;
if (!doCommit) {
  // BATCHED CYCLE: no commit was made, so the gate MUST NOT run against the previous sha (a red
  // would revert someone else's commit). The gate judges at checkpoint granularity — the next
  // qualifying commit carries these accumulated changes through harvest-accept in full.
  gateOut = 'batched — below the commit floor; the gate judges the accumulated changes at the next qualifying commit';
} else {
try { gateOut = execFileSync('node', [resolve(HERE, 'harvest-accept.mjs'), '--sha', sha], { cwd: REPO, encoding: 'utf8', timeout: 1200000 }); }
catch (e) { accepted = false; gateOut = String(e.stdout || e.message); }
}
console.log(gateOut.trim().split('\n').slice(-3).join('\n'));

// ── 5 SEAL — the autonomous state on the tape (accept AND red both get receipted) ─────────
try {
  const { sealState, metalWalk } = await import(resolve(HERE, 'metal-pass.mjs'));
  const mesh = await import(resolve(REPO, 'scripts/mesh/mesh-keys.mjs')).catch(() => null);
  const TAPE = resolve(REPO, 'docs/pmu/attest-flight-tape.json');
  const tape = JSON.parse(readFileSync(TAPE, 'utf8'));
  const seq = tape.timeline_events.reduce((m, e) => { const x = String(e.id||'').match(/^HA-?(\d+)$/); return x ? Math.max(m, +x[1]) : m; }, 0) + 1;   // max-id+1, never count+1 — archiving shrinks counts and count+1 minted DUPLICATE ids (the archive-collision incident)
  const promiseMetrics = promiseAgg.settled ? { settled: promiseAgg.settled, mass_bytes: promiseAgg.mass_bytes, mean_density: +(promiseAgg.density_sum / promiseAgg.settled).toFixed(4), coords: promiseAgg.coords.slice(0, 12) } : null;
  const line = `harvest-agent cycle: ${!doCommit ? 'BATCHED' : accepted ? 'ACCEPTED' : 'REVERTED'} — +${applied.vocab}v +${applied.derived}d +${applied.anchors}a −${applied.evictions}e @ ${sha.slice(0, 9)}${!doCommit ? ' (uncommitted — rides the next checkpoint)' : ''}`;
  // GREEKS FOR THE AGENT (operator 2026-07-20: "qwen should have the greeks too") — the sealed
  // autonomous state carries a REAL metal walk when the attest server is up (the loop watchdog
  // keeps it up); placement_only stays as the honest fallback when it isn't. Inputs carry real
  // byte-mass (contract text + gate transcript), never a dust label — gzip-NCD needs mass.
  // CYCLE-SPECIFIC SEAL INPUTS (2026-07-21, the constant-placement incident: 40/40 seals stamped
  // B,C1 · σ 1.73 because the intent was THE SAME SENTENCE every cycle — the seal measured the
  // template, not the cycle; the operator smelled 'hardcoded' and was right in effect). Intent
  // names THIS cycle's targets; reality carries the ACTUAL seated statements. The seal's
  // placement now varies with the work — a receipt that cannot vary attests nothing.
  const inputs = {
    // CYCLE-CONTENT LEADS (ratchet-5 detector remediation): with the static contract phrase first,
    // every seal placed at the SAME pixel (12/12 at B,B1) even with varying targets — the prefix
    // outweighed the variable tail in placement. The cycle's own content opens the intent; the
    // standing-contract citation closes it.
    // FULL SHORTLEX NAMES + PAYLOAD (operator 2026-07-21: 'I want the explicit label names…
    // otherwise I have to worry it does not have alpha on what it is doing' — the ALWAYS EXPAND
    // COORDINATE LABELS standing rule, applied at the seal). Every seated key expands to its
    // actor ⊕ patient role names and carries a slice of the actual seated statement, so the
    // intent reads as WORK, never as an opaque rank list.
    intent: (() => {
      const ROLE = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund', B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
      const expandCoord = (coord) => String(coord).split('/').map((c) => c.split(',').map((a) => ROLE[a] ? `${a}.${ROLE[a]}` : a).join(' ⊕ ')).join(' → ');
      // a seated key is either a pure coordinate breadcrumb OR coord:rule-stem — either way the
      // COORDINATE leads with full role names (operator: 'not just strategy.law or a1'); rule
      // stems break at a word boundary, never mid-sentence. The actor⊕patient DUMP stays in the
      // reef where the promise's three gzips already measure against it — inlining it here would
      // re-create constant placement through shared boilerplate (decided 2026-07-21).
      const expand = (key) => {
        const [head, ...rest] = String(key).split(':');
        const stem = rest.join(':').replace(/~refresh$/, '');
        const tag = /~refresh$/.test(String(key)) ? ' (refresh)' : '';
        const coordPart = /^[A-C][1-3]?,[A-C][1-3]?(\/[A-C][1-3]?,[A-C][1-3]?)?$/.test(head) ? `${head} (${expandCoord(head)})` : head;
        const stemCut = stem ? ' · ' + (stem.length > 30 ? stem.slice(0, 30).replace(/\s+\S*$/, '') + '…' : stem) : '';
        return coordPart + stemCut + tag;
      };
      const seen = new Set(); const lines = [];
      for (let i = 0; i < seatedKeys.length && lines.length < 5; i++) {
        if (seen.has(seatedKeys[i])) continue; seen.add(seatedKeys[i]);
        const meldSlice = meldForH(String(seatedKeys[i]).split(':')[0].split('/')[0]);
        lines.push(`${expand(seatedKeys[i])}${meldSlice ? ` [${meldSlice.slice(0, 110)}…]` : ''} «${String(seatedTexts[i] || '').slice(0, 70)}»`);
      }
      // VOID CAPTURES join the cycle line (task #9): reef-demand's last-run.json (fresh ≤10 min)
      // carries what the hunts captured into the void intake this cycle — real work the seal must
      // name, or the tick lies idle ('intake only') while mass lands.
      let voidLine = '';
      try {
        const vr = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/void-intake/last-run.json'), 'utf8'));
        if (Date.now() - Date.parse(vr.ts) < 600000) {
          const caps = (vr.captures || []).filter((c) => c.captured > 0);
          if (caps.length) voidLine = ' · VOID ' + caps.map((c) => `${c.coord} +${c.captured}${c.sample ? ` «${c.sample.slice(0, 50)}»` : ''}`).join(' · ');
        }
      } catch { /* no void run this cycle */ }
      return `THIS cycle seated: ${(lines.join(' · ') || 'intake only') + voidLine} (${applied.derived} derived, ${applied.vocab} vocab) — autonomous harvest cycle (spec §9 C4, standing contract)`;
    })(),
    reality: line + '\nSEATED THIS CYCLE:\n' + (seatedTexts.slice(0, 5).join('\n') || '(no statements seated)') + '\n' + String(gateOut || '').slice(-800),
    negative: 'compose new rules from model imagination; skip the gate; edit human-authored files; tune knobs to pass the battery',
  };
  const walk = await metalWalk({ intent: inputs.intent, reality: inputs.reality, negative: inputs.negative });
  // DRIFT AT THE SEAL DOOR (all-measures contract, 2026-07-21: 'the contract is failing if these
  // are empty'): every seal carries full I/R/N, so drift-toward-excluded is three gzips away —
  // dI = NCD(reality,intent), dN = NCD(reality,negative), drift = 100·dI/(dI+dN)
  // (0 = on intent · 50 = catastrophe midline). Computed locally; never blank on a live seal.
  const { ncd: _ncdP } = await import(resolve(HERE, 'burn-mass.mjs'));
  const dI = _ncdP(inputs.reality, inputs.intent), dN = _ncdP(inputs.reality, inputs.negative);
  const driftPct = (dI + dN) > 0 ? +(100 * dI / (dI + dN)).toFixed(1) : null;
  // LOAD (task #17, spec §two-missing-measures): gz(box)/gz(pixel meld) per I/R/N box — how much
  // of the landed region's definition each box exercises; 262B-dust becomes a number. Null-honest
  // when no walk landed a pixel.
  let loadM = null;
  try {
    const px = walk && walk.pixel_coord;
    const meldTxt = px ? meldForH(String(px)) : '';
    if (meldTxt) {
      const gzn = (s) => _gzL(Buffer.from(String(s || ''), 'utf8')).length;
      const gm = gzn(meldTxt);
      loadM = { pixel: String(px), intent: +(gzn(inputs.intent) / gm).toFixed(3), reality: +(gzn(inputs.reality) / gm).toFixed(3), negative: +(gzn(inputs.negative) / gm).toFixed(3) };
    }
  } catch { /* null-honest */ }
  const state = {
    id: 'HA-' + seq, parent_id: tape.timeline_events.at(-1)?.id ?? null, ts: new Date().toISOString(),
    elapsed_ms: null, label: line, scenarioKey: null, threshold: null,
    inputs,
    metrics: { verdict: accepted ? 'IN_LANE' : 'OFF_DOMAIN', mode: 'harvest-agent', applied, sha, inputs_v: 2,
      // FULL IO (operator): the gzip-searched surfaces of this cycle's hunts, fresh ≤10 min —
      // a misplacement is diagnosable from the seal alone.
      ...((() => { try { const io = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/hunt-io-last.json'), 'utf8')); return (Date.now() - Date.parse(io.ts) < 600000) ? { io_surfaces: io.surfaces, io_gates: io.gates } : {}; } catch { return {}; } })()),
      // THE DECISIONS BLOCK (task #16): every accept + refusal-with-mechanism from the cycle's
      // demand run, fresh-windowed — the record of what was recorded.
      ...((() => { try { const dc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/decisions-last.json'), 'utf8')); return (Date.now() - Date.parse(dc.ts) < 600000) ? { decisions: { accepted: dc.accepted.slice(0, 12), refused: dc.refused.slice(0, 12), void: dc.void } } : {}; } catch { return {}; } })()),
      drift: driftPct, dI: +dI.toFixed(4), dN: +dN.toFixed(4),
      ...(loadM ? { load: loadM } : {}),
      ...(promiseMetrics ? { promise: promiseMetrics } : {}),
      ...(walk ? { walk, placement_only: false } : { placement_only: true }) },
    source: 'harvest-agent',
  };
  state.seal = sealState(state, mesh);
  // ONE DOOR ONTO THE TAPE (clobbered-SPLIT incident): fresh-read + lock inside appendToTape —
  // this writer can no longer overwrite seals committed by another process since ITS read.
  const { appendToTape } = await import(resolve(HERE, 'tape-append.mjs'));
  appendToTape(state);
  console.log(`sealed ${state.id} (${state.seal.signed ? 'ed25519' : 'sha256'}) · source: harvest-agent`);
} catch (e) { console.log(`(tape seal skipped: ${e.message})`); }
process.exit(accepted ? 0 : 1);
