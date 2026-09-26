#!/usr/bin/env node
// scripts/vna/steer-until.mjs — C186 THE LOOP: /steer runs like /goal with the WHOLE SPEC as the win condition.
// (operator 2026-09-23: "it should not stop untill all open asks are finished, from spec and tree wtith l1 etc" ·
//  "can we make /steer work like /goal (did we deliver all parts of the spec / spec all that was asked for?)")
//
// Before this file three lines stopped /steer: dispatchLoop's --max-cycles 3 and its break on the first cycle that ticked nothing
// (steer.mjs), the runner's budgetGate halt past the goal's 5–10 turns (steer-runner.mjs), and goal.mjs's hand-set units. Here:
//   (a) the WIN CONDITION is DERIVED EVERY CYCLE — spec-clarity.mjs over the spec as it stands, so a row declared mid-run is next cycle's
//   (b) every open row is CLEAR / NEEDS-OPERATOR / YOUR-ACT (spec-clarity.mjs); only CLEAR rows dispatch, YOUR-ACT never does
//   (c) CLEAR rows go nearest-first from the last landed commit's pixel (spec-clarity.mjs orderByWalk — envelope.mjs's metric)
//   (d) a dispatch that HALTS is retried ONCE with the halt reason in its brief (steer-runner.mjs --retry-reason), then STUCK, and the
//       loop MOVES ON — a green dispatch that leaves the row unticked counts as an attempt too, so no row loops forever
//   (e) the loop ENDS only when no CLEAR, un-stuck row is left — then the asks ledger (C185, asks-ledger.mjs) gets STUCK / NEEDS / ACTS
//       and every operator ask since the loop began that NO row quotes (C187 transcript-asks.mjs over the session transcript)
// NOT A BRAKE, A METER: the turn budget prints (steer-metrics budgetGate, the runner gets --meter-budget); what PAUSES is physical or
// paid — the spend ceiling ($150/run default, `--ceiling`, summed from runner.ndjson cost_usd since the loop began), the memory ceiling
// (C168d — not built: printed UNMEASURED, queues nothing), the active-session pause for a LOCAL preset (C168f seam: llm-pause.mjs).
// EVERY CYCLE prints one line:
//   cycle <k> · open <n> (clear <c> · stuck <s> · needs-you <u>) · dispatched <id> · verdict <…> · spend $<x> of $<ceiling> · next <id> (L1 <d>)
// followed by ` · meter <turn budget> · mem <state> · quiet <state>`.
// Zero LLM in any verdict, order or class: regexes, existsSync, git, the runner's own JSON.
//
//   node scripts/vna/steer-until.mjs [--dry-run] [--scope <ids|section>] [--ceiling 50] [--since <iso>] [--json]
// @guard tests/vna/c186-steer-runs-until-the-spec-is-satisfied.test.mjs
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySpec, orderByWalk, pathRule, CLEAR, NEEDS, ACT } from './spec-clarity.mjs';
import { acquire, release, shouldStop } from './steer-lock.mjs';
import { retryDial } from './steer-rules.mjs';   // C276
import { triage } from './triage.mjs';   // C278
export function countRetries(path = RUNNER_NDJSON) { try { return readFileSync(path, 'utf8').split('\n').filter((l) => l.includes('"kind":"retry-dial"')).length; } catch { return 0; } }   // C273: one owner
import { MAX_ATTEMPTS, attemptVerdict, dispatchable } from './steer-rules.mjs';   // C236: the loop's decisions are the crystal's pure functions
import { tailRowsSince } from './walk-tape-read.mjs';   // bounded ndjson reads (runner.ndjson for spend), never a whole-file slurp
import { dozenFor, DOZEN_NDJSON } from './outward-dozen.mjs';
import { unloadModel } from './workers.mjs';   // D3: the local worker model is unloaded once, when the loop stops   // C242b: the dozen read every outward-prose file in the worker's range after the verdict
import { longOnShort as longOnShortDefault, COCKPIT_JSON as DEFAULT_COCKPIT_JSON } from './long-on-short.mjs';   // C312

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const RUNNER_NDJSON = process.env.VNA_RUNNER_NDJSON || resolve(REPO, '.thetacog/runner.ndjson');
export const DEFAULT_RUNNER_CLI = resolve(HERE, 'steer-runner.mjs');
export const ASKS_LEDGER_CLI = resolve(HERE, 'asks-ledger.mjs');
export const DEFAULT_CEILING_USD = Number(process.env.VNA_STEER_CEILING_USD || 150);   // the operator's number (2026-09-23: "make the cost ceiling 150 which will never be hit if done right")
export { MAX_ATTEMPTS };   // the dispatch and ONE retry carrying the halt reason — one constant, in steer-rules.mjs (C236)

const lastJson = (out) => { const ls = String(out || '').trim().split('\n'); for (let i = ls.length - 1; i >= 0; i--) { try { return JSON.parse(ls[i]); } catch {} } return null; };
const record = (path, row) => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n'); } catch {} };

// ── the cycle line — the one format, pure ─────────────────────────────────────────────────────────────────────────
export function cycleLine({ k, open, clear, stuck, needs, dispatched = '—', verdict = '—', spend = 0, ceiling = DEFAULT_CEILING_USD, next = null, nextD = null, meter = null, mem = 'UNMEASURED', quiet = 'n/a' }) {
  const base = `cycle ${k} · open ${open} (clear ${clear} · stuck ${stuck} · needs-you ${needs}) · dispatched ${dispatched} · verdict ${verdict} · spend $${Number(spend).toFixed(2)} of $${ceiling} · next ${next || 'none'} (L1 ${nextD ?? '—'})`;
  return `${base} · meter ${meter || 'no /goal budget'} · mem ${mem} · quiet ${quiet}`;
}
export const CYCLE_RE = /^cycle \d+ · open \d+ \(clear \d+ · stuck \d+ · needs-you \d+\) · dispatched \S+ · verdict .+ · spend \$\d+\.\d\d of \$\d+(\.\d+)? · next \S+ \(L1 (\d+|—)\)/;

// ── spend: the workers' OWN reported cost since the loop began, off runner.ndjson (never estimated) ─────────────────
export function spendSince(since, { path = RUNNER_NDJSON } = {}) {
  if (!existsSync(path)) return 0;
  const t0 = Date.parse(since) || 0;
  const { rows } = tailRowsSince(path, t0, { tsOf: (r) => Date.parse(r && r.at) || 0, filter: (r) => typeof r.cost_usd === 'number' });
  return rows.reduce((s, r) => s + r.cost_usd, 0);
}

// ── the gates that QUEUE, never halt ──────────────────────────────────────────────────────────────────────────────
export function memGate() { return { state: 'UNMEASURED', why: 'C168d memory ceiling not built — nothing queued on memory' }; }
export async function quietGate({ repo = REPO } = {}) {
  try {
    const { readEngineConfig, presetOf } = await import('./runner-resolver.mjs');
    const p = presetOf(readEngineConfig(repo).preset);
    if (!p || p.local !== true) return { state: 'n/a', why: `${p ? p.id : 'default'} is not a local engine` };
    const { llmPauseActive } = await import('../cog/llm-pause.mjs');
    // C216: scripts/vna/steer.mjs is started only by the operator (no hook, tick or cron calls it) — so a /steer run is an
    // EXPLICIT ask and neither hold applies. STEER_AUTO=1 marks the one case that is not: an automatic caller, which stays held.
    const explicit = process.env.STEER_AUTO !== '1';
    return llmPauseActive(undefined, { lane: 'ollama', explicit }) ? { state: 'QUEUE', why: 'auto-fire during an active session — a local worker waits for the quiet (llm-pause)' } : { state: 'OPEN', why: explicit ? 'explicit /steer ask — the holds stop auto-fire only' : 'quiet' };
  } catch (e) { return { state: 'UNMEASURED', why: String(e.message || e).slice(0, 120) }; }
}
// read in-process with write:false — `goal.mjs status` as a CLI rewrites the active-leaf file, and a meter must write nothing
export async function meterLine({ repo = REPO } = {}) {
  try { const { goalStatus } = await import('./goal.mjs'); const st = goalStatus({ repo, write: false }); if (!st || !st.turns || st.turns.max == null) return null; const over = Math.max(0, st.turns.used - st.turns.max); return `turns ${st.turns.used} of ${st.turns.min ?? '?'}–${st.turns.max}${over ? ` (over by ${over}, metered)` : ''}`; } catch { return null; }
}

// ── the real dispatch: one row by label through the runner, budget metered, the halt reason carried on a retry ──────
// ASYNC (execFile, never execFileSync) so a second slot's worker runs while the first's is in flight — C186a's greed needs it
export async function dispatchRow(row, { repo = REPO, runnerCli = process.env.STEER_RUNNER || DEFAULT_RUNNER_CLI, driverBin = 'claude', retryReason = null, dial = undefined, ndjson = RUNNER_NDJSON } = {}) {
  const args = [runnerCli, '--label', row.id, '--max-units', '1', '--claude', driverBin, '--meter-budget', '--json'];
  if (retryReason) args.push('--retry-reason', retryReason);
  // C276 — a retry moves one dial: the caller's pick (C278's triage, when it has earned it) or the fixed rotation over the ledger's retries
  // C315 — the record also carries WHO chose it (dial_by: gemma | rotation), so the impasse ledger can compare their landings
  if (retryReason) { const dl = dial || retryDial(countRetries(ndjson)); args.push('--dial', dl, '--dial-by', dial ? 'gemma' : 'rotation'); }
  const { out, code } = await new Promise((done) => execFile('node', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, VNA_BUDGET_METER: '1' }, maxBuffer: 64 << 20 }, (e, so, se) => done({ out: String(so || '') + (e ? String(se || '') : ''), code: e ? (e.code ?? 1) : 0 })));
  const r = lastJson(out);
  if (!r) return { halted: true, reason: `runner printed no JSON (exit ${code}): ${out.trim().slice(-200)}` };
  const halted = !!(r.halted || r.paused || (r.exitCode && r.exitCode !== 0) || (r.dispatched === 0 && !r.ok));
  return { halted, reason: r.reason || (halted ? `runner exit ${r.exitCode ?? code}` : null), raw: r };
}

// ── "did we spec all that was asked for": every operator ask since `since` that NO row quotes — C187's door (transcript-asks.mjs,
// cf9e1467d5) over the session transcript (newestSession() unless one is named), never the walk tape (it holds text_sha, never words)
export async function unquotedAsks({ since, specPath = SPEC_MD, session = process.env.VNA_STEER_SESSION || null, repo = REPO } = {}) {
  const { audit, projectDir, newestSession } = await import('./transcript-asks.mjs');
  let t = session; if (t && !t.endsWith('.jsonl')) t = join(projectDir(repo), `${t}.jsonl`);
  try { t = t || newestSession(projectDir(repo)); } catch { t = null; }
  if (!t || !existsSync(t)) return { sessions: 0, asks: 0, unquoted: [], why: 'no session transcript found' };
  try { const a = audit({ transcript: t, spec: specPath, since }); return { sessions: 1, transcript: t, asks: a.n, unquoted: a.asks.filter((x) => !x.rows.length).map((x) => ({ at: x.at, text: x.text, hint: x.hint ? x.hint.id : null })) }; }
  catch (e) { return { sessions: 0, asks: 0, unquoted: [], why: String(e.message || e).slice(0, 160) }; }
}

// ── C188 THE PLANNER IS THE CRATE'S: scripts/vna/steer-plan.mjs (d3395abef6) wraps `pmu-onchip --steer-plan` and reads the slot count
// from free memory. stdin {rows:[{id,paths,pixel}], last_pixel} → stdout the crate's JSON {engine:'rust-steer-plan', slots, batch:[{id,
// l1, pixel, claim}], queue, why}; exit 3 + `steer-plan: UNMEASURED — pmu-onchip not built` when the binary is missing. Node never plans
// a batch: UNMEASURED → one slot, said. The RUNNING rows go in first so the crate certifies the whole running set (see runUntil).
export const STEER_PLAN_CLI = process.env.STEER_PLAN || resolve(HERE, 'steer-plan.mjs');
export const PLAN_UNMEASURED = 'steer-plan: UNMEASURED — pmu-onchip not built';
export function planSlots(rows, { running = [], lastPixel = null, cli = STEER_PLAN_CLI, repo = REPO } = {}) {
  const unmeasured = { slots: 1, batch: null, l1: {}, line: PLAN_UNMEASURED };
  if (!existsSync(cli)) return unmeasured;
  const input = JSON.stringify({ rows: [...running, ...rows].map((r) => ({ id: r.id, paths: r.paths || [], pixel: r.pixel ?? null })), last_pixel: lastPixel });
  let out = '';
  try { out = execFileSync('node', [cli], { cwd: repo, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 << 20 }); }
  catch (e) { out = String(e.stdout || ''); }
  const j = lastJson(out);
  if (!j || j.engine !== 'rust-steer-plan' || !Number.isInteger(j.slots) || j.slots < 1 || !Array.isArray(j.batch)) return { ...unmeasured, line: out.includes(PLAN_UNMEASURED) || !out.trim() ? PLAN_UNMEASURED : `${PLAN_UNMEASURED} (the wrapper printed no plan)` };
  const l1 = {}; for (const x of j.batch) if (x && x.id) l1[x.id] = x.l1 ?? null;
  const ids = j.batch.map((x) => x.id);
  return { slots: j.slots, batch: ids, l1, queue: j.queue || [], why: j.why || {}, line: `steer-plan: ${j.slots} slot${j.slots === 1 ? '' : 's'} (pmu-onchip, ${j.metric || 'l1'}) · batch ${ids.join(' ') || 'none'}` };
}

// ── C186a THE LOOP'S OWN RECEIPT — what the ⚡ Run Headless pill reads (steer-ui.mjs is another worker's; this is only the row):
//   .thetacog/steer-loop.json    the CURRENT state, overwritten on every change: { at, live, pid, startedAt, cycle, open, clear,
//                                running:[id…], slots, stuck, needs, spent, ceiling, last:{id,verdict}|null, face }
//   .thetacog/steer-loop.ndjson  the same row appended on every change — the history
// `face` is the pill's exact text: `/steer · open <n> · clear <c> · running <r>/<slots> · stuck <s> · needs you <u> · $<spent>/<ceiling>`,
// and `/steer · not running` once live is false. A dry-run writes nothing — it is not a live loop.
export const LOOP_JSON = process.env.VNA_STEER_LOOP_JSON || resolve(REPO, '.thetacog/steer-loop.json');
export const LOOP_NDJSON = process.env.VNA_STEER_LOOP_NDJSON || LOOP_JSON.replace(/\.json$/, '.ndjson');
export function loopFace(st) { return st.live ? `/steer · open ${st.open} · clear ${st.clear} · running ${st.running.length}/${st.slots} · stuck ${st.stuck} · needs you ${st.needs} · $${Number(st.spent).toFixed(2)}/${st.ceiling}` : '/steer · not running'; }
export function writeLoopState(st, { json = LOOP_JSON, ndjson = LOOP_NDJSON } = {}) {
  const row = { at: new Date().toISOString(), pid: process.pid, ...st }; row.face = loopFace(row);
  try { mkdirSync(dirname(json), { recursive: true }); writeFileSync(json, JSON.stringify(row, null, 2) + '\n'); appendFileSync(ndjson, JSON.stringify(row) + '\n'); } catch {}
  return row;
}

// ── THE LOOP — GREEDY (C186a): every free slot is filled with the nearest CLEAR rows, and the moment ONE verdict lands its slot is
// refilled from the re-derived queue (work-conserving, never batch-synchronous); a row declared mid-run is in the next refill.
// Every collaborator is injected so the guards run it over a fixture spec with a stub dispatcher — no claude, no network.
export async function runUntil({
  specPath = SPEC_MD, scope = null, dryRun = false, ceiling = DEFAULT_CEILING_USD, startedAt = new Date().toISOString(),
  dispatch = (row, o) => dispatchRow(row, o), spend = (since) => spendSince(since), order = (rows) => orderByWalk(rows),
  classify = (md) => classifySpec(md, { scope }), mem = memGate, quiet = quietGate, meter = () => meterLine(), wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  plan = (rows, o) => planSlots(rows, o), quietPollMs = 60000, maxQuietWaitMs = 600000, say = console.log, ndjson = RUNNER_NDJSON, maxCycles = Infinity,
  loopState = (st) => writeLoopState(st),
  triageFn = (o) => triage(o),   // C278: the catch before a retry
  stopRequested = () => false,   // C273: the lock's stop_after_row — read at the row boundary, never a kill
  repo = REPO, dozenNdjson = DOZEN_NDJSON, dozen = null,   // C242b: the dozen's reader over the worker's range (a test hands its own floors)
  longOnShort = (r) => longOnShortDefault(r), cockpitPath = DEFAULT_COCKPIT_JSON,   // C312: the long×short drift reading + where it reads from (a test hands its own of each)
} = {}) {
  const attempts = new Map(); const stuck = new Map(); const deferred = new Map(); const planned = new Set(); const running = new Map(); const runRows = new Map(); const log = []; const l1 = {};
  const driftReran = new Set();   // C312: once per row per run — the rerun is the redirect, never a spin
  let k = 0, paused = null, orderReason = null, planLine = null, slots = 1, quietWaited = 0, deferredThisPass = false;
  const read = () => classify(readFileSync(specPath, 'utf8'));
  const scopeIds = read().rows.map((r) => r.id);
  // the state, derived from the spec every time it is asked — never carried
  const derive = () => {
    const c = read(); const open = c.rows.filter((r) => !c.ticked[r.id]);
    const clear = open.filter((r) => dispatchable(r, { stuck: stuck.has(r.id), deferred: deferred.has(r.id), planned: planned.has(r.id), running: running.has(r.id) }));   // C236 S3: only CLEAR fills a slot
    const o = order(clear); orderReason = o.reason;
    return { c, open, queue: o.rows, origin: o.origin || null, needs: open.filter((r) => r.class !== CLEAR) };
  };
  const counts = (d) => ({ open: d.open.length, clear: d.queue.length, stuck: stuck.size, needs: d.needs.length });
  const receipt = (d, last = null, live = true) => { if (!dryRun) loopState({ live, startedAt, cycle: k, ...counts(d), running: [...running.keys()], slots, spent: Number(spend(startedAt).toFixed(4)), ceiling, last }); };
  // a dry-run reads the meter once; a live loop re-reads it per line (the goal's turns move as workers commit)
  let meterMemo; const meterNow = async () => (dryRun ? (meterMemo === undefined ? (meterMemo = await meter()) : meterMemo) : await meter());
  const gauges = async (sp) => ({ spend: sp, ceiling, meter: await meterNow(), mem: mem().state });

  let d = derive();
  const pl0 = plan(d.queue, { running: [], lastPixel: d.origin ? d.origin.coord : null }); planLine = pl0.line; Object.assign(l1, pl0.l1 || {});
  if (!dryRun) { slots = pl0.slots; say(planLine); } else { slots = 1; say(`${planLine} · dry-run plans one row per cycle`); }
  const dist = (r) => (r ? (l1[r.id] ?? r.d) : null);   // the crate's l1 when it planned the row, else the walk-order distance
  receipt(d);

  while (k < maxCycles) {
    d = derive();
    // FILL every free slot (dry-run: plan one row per cycle so each line reads as one worker's)
    const sp = dryRun ? 0 : spend(startedAt);
    if (!dryRun && sp >= ceiling && !paused) {
      paused = { reason: `spend ceiling $${ceiling} reached at $${sp.toFixed(2)}`, next: d.queue[0] ? d.queue[0].id : null };
      record(ndjson, { kind: 'steer-pause', reason: paused.reason, spend: sp, ceiling, next: paused.next, cycle: k + 1 });
      say(cycleLine({ k: k + 1, ...counts(d), ...await gauges(sp), dispatched: 'none', verdict: `PAUSED — ${paused.reason}; nothing discarded, raise --ceiling to resume`, next: paused.next, nextD: dist(d.queue[0]), quiet: 'n/a' }));
    }
    const stopNow = !dryRun && stopRequested();
    if (!paused && d.queue.length && !stopNow) {
      // WHICH rows fill the free slots is the CRATE's call (C188): the running rows go in first, and new rows are taken only from a
      // batch that still holds every running row — the crate certified them disjoint from what is already running. A batch that
      // evicted a running row adds nothing this pass (the next verdict re-plans). UNMEASURED → one slot → the nearest row.
      let picks;
      if (dryRun) picks = [d.queue[0]];
      else {
        const pl = plan(d.queue, { running: [...runRows.values()], lastPixel: d.origin ? d.origin.coord : null });   // re-planned per pass: memory and the queue move
        slots = pl.slots; Object.assign(l1, pl.l1 || {});
        const free = Math.max(0, slots - running.size);
        if (!pl.batch) picks = d.queue.slice(0, free);
        else if ([...running.keys()].every((id) => pl.batch.includes(id))) picks = pl.batch.filter((id) => !running.has(id)).map((id) => d.queue.find((r) => r.id === id)).filter(Boolean).slice(0, free);
        else picks = [];
        if (!picks.length && !running.size) picks = [d.queue[0]];   // liveness: an idle loop with a CLEAR row always runs one
      }
      for (const head of picks) {
        d.queue = d.queue.filter((r) => r !== head);
        let q = await quiet();
        // C216 — A QUEUE ENDS: said ONCE, re-checked quietly, and after maxQuietWaitMs the row is DEFERRED (named on the close
        // line and the asks ledger, never dispatched, never lost) and the loop moves on — before this it printed the same line
        // every minute forever and the chat's Send stayed disabled behind it (operator 2026-09-23: "cant send to break").
        // C236 S1 (found by the enumeration, 2026-09-24): the hold is the ENGINE's, not the row's — so the wait is one budget per
        // run (quietWaited), and a pass that deferred with nothing running RE-DERIVES instead of falling through to the
        // "WIN CONDITION MET" break. Before this, two CLEAR rows under a held gate ended with R1 DEFERRED and R2 in no end
        // state at all — dropped from the ledger, never named, the exact "never lost" the C216 line promised.
        if (!dryRun && q.state === 'QUEUE') {
          say(`cycle ${k + 1} · QUEUED ${head.id} — ${q.why} · re-checking every ${Math.round(quietPollMs / 1000)} s, deferring after ${Math.round(maxQuietWaitMs / 60000)} min`);
          while (q.state === 'QUEUE' && quietWaited < maxQuietWaitMs) { await wait(quietPollMs); quietWaited += quietPollMs; q = await quiet(); }
          if (q.state === 'QUEUE') { deferred.set(head.id, q.why); deferredThisPass = true; record(ndjson, { kind: 'steer-defer', id: head.id, why: q.why, waitedMs: quietWaited, cycle: k + 1 }); say(`cycle ${k + 1} · DEFERRED ${head.id} — still held after ${Math.round(quietWaited / 60000)} min; nothing dispatched, it stays open`); continue; }
        }
        if (dryRun) {
          k++; planned.add(head.id); const nx = d.queue[0] || null;
          say(cycleLine({ k, ...counts(d), clear: d.queue.length + 1, ...await gauges(0), dispatched: head.id, verdict: 'dry-run (not dispatched)', next: nx ? nx.id : null, nextD: dist(nx), quiet: q.state }));
          log.push({ cycle: k, id: head.id, verdict: 'dry-run' });
          if (k >= maxCycles) break;
          continue;
        }
        const prev = attempts.get(head.id) || [];
        // C278 (U15) — THE CATCH: a retry is triaged first. The host table names the halt; gemma sees only what it cannot name, and her
        // pick is used only once scored (data/vna/triage-score.json). A HOLD class (server down · model missing · budget · host error)
        // is never retried — the row is named STUCK with its class. A retry carries the dial the triage chose, else the rotation (C276).
        let dial;
        if (prev.length && !dryRun) {
          const t = await triageFn({ label: head.id, reason: prev[prev.length - 1] });
          record(ndjson, { kind: 'triage', label: head.id, class: t.class, source: t.source, action: t.action, dial: t.dial || null, proposal: t.proposal || null, ramble: t.ramble || null });
          if (t.action === 'hold') { stuck.set(head.id, [...prev, `HOLD — ${t.class} (triage, C278): a retry cannot fix it`]); log.push({ cycle: k, id: head.id, verdict: `HOLD — ${t.class}` }); say(`cycle ${k + 1} · HOLD ${head.id} — ${t.class}: not retried (C278)`); continue; }
          dial = t.dial;
        }
        const p = Promise.resolve(dispatch(head, { retryReason: prev.length ? prev[prev.length - 1] : null, dial })).then((res) => ({ head, res }), (e) => ({ head, res: { halted: true, reason: String(e && e.message || e) } }));
        running.set(head.id, p); runRows.set(head.id, head);
        receipt(d);
      }
    }
    if (dryRun) { if (!d.queue.length || k >= maxCycles) break; continue; }
    if (stopNow && !running.size) { say(`cycle ${k + 1} · STOPPED — stop after row was asked (C273); ${d.queue.length} clear row${d.queue.length === 1 ? '' : 's'} left for the next start`); record(ndjson, { kind: 'steer-stop', cycle: k + 1, left: d.queue.length }); break; }
    if (deferredThisPass && !running.size) { deferredThisPass = false; continue; }   // C236 S1: the next CLEAR row is picked (and named), never dropped
    if (!running.size) {
      if (!paused) { k++; say(cycleLine({ k, ...counts(d), ...await gauges(sp), dispatched: 'none', verdict: 'WIN CONDITION MET — no clear row left', next: null, quiet: 'n/a' })); }
      break;
    }
    // AWAIT THE FIRST VERDICT — its slot is refilled on the next pass, the others keep running
    const { head, res } = await Promise.race(running.values());
    running.delete(head.id); runRows.delete(head.id); k++;
    const prev = attempts.get(head.id) || [];
    const ticked = read().ticked[head.id] === true;
    // C242b — THE DOZEN READ THE WORKER'S RANGE. Every dispatch's head0..head1 comes off the runner's own JSON (never a sha
    // scraped from prose); each outward-prose file in it is measured at the commit and at its parent (git show, immutable) by
    // scripts/lib/six-percentages.mjs and judged against the floors. A drop is DETECTED (a row on outward-dozen.ndjson and a
    // `dozen` row here) and DISPATCHED (the line rides the ONE retry brief, behind the halt reason). It never touches the verdict:
    // attemptVerdict below reads exactly what it read before, a TICKED row stays TICKED, and the loop never stops on a drop.
    let dozenLine = '';
    if (!dryRun) {
      try {
        const dz = dozenFor(res.raw, { repo, ndjson: dozenNdjson, ...(dozen ? { dozen } : {}) });
        if (dz.read) record(ndjson, { kind: 'dozen', label: head.id, read: dz.read, drops: dz.drops, line: dz.lines.join(' · ') || null, unmeasured: dz.unmeasured });
        dozenLine = dz.lines.join(' · ');
      } catch (e) { record(ndjson, { kind: 'dozen', label: head.id, why: `not run — ${String(e && e.message || e).slice(0, 160)}` }); }
    }
    // C236 S1: the verdict and the STUCK latch are attemptVerdict (steer-rules.mjs) — the function the crystal enumerates
    const av = attemptVerdict({ ticked, halted: !!res.halted, reason: res.reason, prev });
    const verdict = av.verdict;
    if (!ticked) {
      if (dozenLine) av.attempts[av.attempts.length - 1] += ` · ${dozenLine}`;   // C242b: the retry brief carries the drop; the verdict string above does not change
      attempts.set(head.id, av.attempts); if (av.stuck) stuck.set(head.id, av.attempts.slice());
    }
    log.push({ cycle: k, id: head.id, verdict, cost: res.raw && Array.isArray(res.raw.dispatches) ? res.raw.dispatches.reduce((s2, x) => s2 + (x.cost_usd || 0), 0) : null });
    const d2 = derive(); const nx = d2.queue[0] || null;
    say(cycleLine({ k, ...counts(d2), ...await gauges(spend(startedAt)), dispatched: head.id, verdict, next: nx ? nx.id : null, nextD: dist(nx), quiet: (await quiet()).state }));
    receipt(d2, { id: head.id, verdict });
    // C312 — LONG-TERM ON SHORT-TERM ALL RED IS NOT A BREAK, IT'S A RERUN. The loop itself never
    // triggers a walk/render (cockpit.json is written by a separate `/steer` or cockpit.mjs pass), so
    // this reads WHATEVER commit that receipt currently carries — the returned `commit` says exactly
    // which one, so the printed line is honest about what it saw, never implying it re-walked this
    // row's own commit. NOTHING here halts, changes the exit code, or gates: a DRIFT? reading just
    // queues ONE more round on the SAME row (via the existing halt-retry brief door), once per row
    // per run (driftReran), so it can never spin.
    if (!dryRun && !driftReran.has(head.id)) {
      let los = null;
      try { const rcpt = JSON.parse(readFileSync(cockpitPath, 'utf8')); los = await longOnShort(rcpt); } catch { los = null; }
      if (los && los.state === 'DRIFT?' && los.line) {
        driftReran.add(head.id);
        say(los.line);
        record(ndjson, { kind: 'long-on-short-drift', id: head.id, red: los.red, lit: los.lit, reverse: los.reverse, commit: los.commit, cycle: k });
        const p2 = Promise.resolve(dispatch(head, { retryReason: los.line })).then((res2) => ({ head, res: res2 }), (e) => ({ head, res: { halted: true, reason: String(e && e.message || e) } }));
        running.set(head.id, p2); runRows.set(head.id, head);
      }
    }
    if (k >= maxCycles) break;
  }
  if (running.size) await Promise.allSettled(running.values());   // a maxCycles stop never orphans a worker's verdict
  const final = read();
  receipt(derive(), log.length ? { id: log[log.length - 1].id, verdict: log[log.length - 1].verdict } : null, false);
  const openFinal = final.rows.filter((r) => !final.ticked[r.id]);
  return {
    cycles: k, paused, dryRun, orderReason, planLine, slots, scopeIds, log, startedAt,
    ticked: scopeIds.filter((id) => final.ticked[id] === true),
    stuck: [...stuck.entries()].map(([id, reasons]) => ({ id, reasons })),
    deferred: [...deferred.entries()].map(([id, why]) => ({ id, why })),   // C216: held past maxQuietWaitMs — open, never dispatched
    needs: openFinal.filter((r) => r.class === NEEDS).map((r) => ({ id: r.id, missing: r.missing })),
    acts: openFinal.filter((r) => r.class === ACT).map((r) => ({ id: r.id, missing: r.missing })),
    planned: [...planned],
  };
}

// ── the end: the C185 ledger's --note lines, composed from the loop's own result (derived, never prose from a model) ─────
// C186c — A TICK WHOSE GUARD WENT RED IS NAMED AT THE END, NEVER WALKED PAST (2026-09-24: the loop planned 100 dispatches over the
// open rows while 16 ticked rows stood CONTRADICTED on asked-vs-built's receipt, and nothing on the end line said so). Read off
// that door's RECEIPT — never a second guard run — with its age, and only rows the spec still ticks; a missing receipt is
// "not run", never zero. The receipt covers the sidebar/extension-page asks only (C106's scope), and the line says that.
export const ASKED_VS_BUILT = process.env.VNA_ASKED_VS_BUILT || resolve(REPO, '.thetacog/vna-asked-vs-built.json');
const TICKED_ROW = /^\s*-\s*\[[xX]\]\s*(C\d+[a-z]*\d*)(?=\s|$)/;
export function regressedTicks({ file = ASKED_VS_BUILT, md = null, now = Date.now() } = {}) {
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return { state: 'not run', rows: [], line: 'regressed: not run — node scripts/vna/asked-vs-built.mjs --run' }; }
  if (j.mode && j.mode !== 'run') return { state: 'not run', rows: [], line: 'regressed: not run (the receipt is the fast mode — no guard ran) — node scripts/vna/asked-vs-built.mjs --run' };
  const ticked = md == null ? null : new Set(md.split('\n').map((l) => TICKED_ROW.exec(l)?.[1]).filter(Boolean));
  const rows = (j.asks || []).filter((a) => a.state === 'CONTRADICTED' && (!ticked || ticked.has(a.id))).map((a) => ({ id: a.id, guard: a.guard || null }));
  const ageH = j.at ? Math.max(0, (now - Date.parse(j.at)) / 3600e3) : null;
  const age = ageH == null ? 'age unknown' : ageH < 1 ? `${Math.round(ageH * 60)} min old` : `${ageH.toFixed(1)} h old`;
  const line = rows.length
    ? `regressed: ${rows.length} ticked row${rows.length === 1 ? '' : 's'} whose guard was red (asked-vs-built, sidebar/extension asks only, ${age}): ${rows.map((r) => r.id).join(' ')} — refresh: node scripts/vna/asked-vs-built.mjs --run`
    : `regressed: 0 — every ticked sidebar/extension ask's guard was green (asked-vs-built, ${age})`;
  return { state: 'read', at: j.at || null, rows, line };
}

export function ledgerNotes(result, { unquoted = [], regressed = [] } = {}) {
  const n = [];
  for (const r of regressed) n.push(`CORRECTIONS: ${r.id} is ticked but its guard was red${r.guard ? ` (${r.guard})` : ''} — the tick is not backed; fix what it measures, or untick it`);
  for (const a of result.acts) n.push(`ACTS: ${a.id} — ${a.missing.join('; ')}`);
  for (const s of result.stuck) n.push(`QUESTIONS: ${s.id} is STUCK after ${s.reasons.length} dispatches — ${s.reasons[s.reasons.length - 1]}. What unblocks it?`);
  for (const x of result.needs) n.push(`QUESTIONS: ${x.id} needs you — ${x.missing.join('; ')}`);
  if (result.paused) n.push(`QUESTIONS: the loop PAUSED — ${result.paused.reason}; next was ${result.paused.next}. Raise the ceiling?`);
  for (const u of unquoted) n.push(`UNCLEAR: an ask no row quotes (${String(u.at || '').slice(0, 16)}): "${u.text.slice(0, 220).replace(/"/g, "'")}"${u.hint ? ` — nearest ${u.hint}, a hint, not coverage` : ''}`);
  n.push(`ASSUMPTIONS: order — ${result.orderReason}`);
  n.push(`ASSUMPTIONS: clarity path rule — ${pathRule}`);
  n.push('ASSUMPTIONS: a Bridge/Gemini paste quoted on a row counts as the operator span (he chose to paste it)');
  return n;
}
export function writeLedger({ result, notes, repo = REPO, ledgerCli = process.env.STEER_ASKS_LEDGER || ASKS_LEDGER_CLI, open = true } = {}) {
  if (!existsSync(ledgerCli)) return { path: null, why: `asks-ledger not built (${ledgerCli})` };
  const ids = [...new Set([...result.scopeIds])];
  const args = [ledgerCli, '--json', ...(open ? ['--open'] : []), ...(ids.length ? ['--rows', ids.join(',')] : []), ...notes.flatMap((x) => ['--note', x])];
  try { const out = execFileSync('node', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 << 20 }); const j = lastJson(out); return { path: j && j.path || null }; }
  catch (e) { return { path: null, why: String(e.stderr || e.message).slice(0, 200) }; }
}

// D3 (operator 2026-09-25): "Unload Qwen only when the entire loop stops". The worker model named by the one engine knob
// (.thetacog/vna-engine.json — a local preset's subagentModel) is unloaded once, here, never per kill. Cloud presets unload nothing.
export const ENGINE_JSON = process.env.VNA_ENGINE_JSON || resolve(REPO, '.thetacog/vna-engine.json');
export async function unloadAtLoopEnd({ file = ENGINE_JSON, unload = (m) => unloadModel({ model: m, by: 'd3-loop-end' }) } = {}) {
  let e; try { e = JSON.parse(readFileSync(file, 'utf8')); } catch { return { unloaded: null, why: 'engine knob unreadable' }; }
  const local = /goose|ollama|local/i.test(String(e.preset || '')) && e.subagentModel;
  if (!local) return { unloaded: null, why: `preset ${e.preset || '?'} is not local` };
  const u = await unload(e.subagentModel); return { unloaded: u && u.ok ? e.subagentModel : null, why: u && !u.ok ? u.why : null };
}

// C295 — the loop's end names the goal units it closed, every open ask no unit covers (fold it in: goal.mjs set, never drop) and
// the /steergoal file the goal was set from: goal-accounting.mjs over goalStatus (in-process, write:false) — a reader, never a registry
async function goalDone() { try { const { goalStatus } = await import('./goal.mjs'); const st = goalStatus({ write: false }); return st ? new Set(st.units.filter((u) => u.done).map((u) => u.n)) : null; } catch { return null; } }
async function goalEndSegment({ md = null, before = null } = {}) {
  try {
    const { goalStatus, readGoal } = await import('./goal.mjs'); const { goalAccounting } = await import('./goal-accounting.mjs');
    const text = md != null ? md : readFileSync(SPEC_MD, 'utf8');
    const st = goalStatus({ md: text, write: false }); const g = readGoal();
    let pendingMd = null; try { pendingMd = readFileSync(process.env.VNA_SPEC_RENDER || resolve(REPO, 'docs/specs/vna/SPEC-FROM-TREE.md'), 'utf8'); } catch {}
    return goalAccounting({ status: st, md: text, pendingMd, source: g && g.source, before: before || new Set() });
  } catch (e) { return { line: `goal: not run — ${String(e.message || e).slice(0, 100)}` }; }
}
// the whole door: loop → asks audit → ledger → the end line
export async function steerUntil({ dryRun = false, scope = null, ceiling = DEFAULT_CEILING_USD, since = null, say = console.log, openLedger = true, owner = process.env.VNA_STEER_OWNER || 'cli', lockPath = undefined, ...rest } = {}) {
  const startedAt = new Date().toISOString();
  // C273 — ONE OWNER: a live loop holds .thetacog/steer.lock; a second start (skill · box · CLI · chat) names the holder and exits clean
  let held = null;
  if (!dryRun) {
    const L = acquire({ owner, ...(lockPath ? { path: lockPath } : {}) });
    if (!L.ok) { const end = `steer until · not started — the loop is held by ${L.holder.owner} (pid ${L.holder.pid}, since ${L.holder.started_at}); untick ↻ or run: node scripts/vna/steer-lock.mjs stop (C273)`; say(end); return { held: L.holder, cycles: 0, ticked: [], stuck: [], deferred: [], needs: [], acts: [], log: [], end }; }
    held = L;
  }
  try {
  say(`steer until · the win condition is every open spec row in scope${scope ? ` (${scope})` : ''} ticked, STUCK or named for you · ceiling $${ceiling}${dryRun ? ' · DRY-RUN: classify, order, print — nothing dispatched' : ''}`);
  const stopRequested = () => shouldStop(lockPath ? { path: lockPath } : {});   // C273
  const goalBefore = await goalDone();   // C295: the goal units already done before this loop dispatched anything
  const result = await runUntil({ dryRun, scope, ceiling, startedAt, say, stopRequested, ...rest });
  if (!dryRun) { const u = await unloadAtLoopEnd(); if (u.unloaded) say(`⏏ ${u.unloaded} unloaded — the loop stopped (D3)`); }
  const window = since || (dryRun ? new Date(Date.now() - 12 * 3600e3).toISOString() : startedAt);
  const uq = await unquotedAsks({ since: window });
  let specText = null; try { specText = readFileSync(SPEC_MD, 'utf8'); } catch {}
  const reg = regressedTicks({ md: specText });
  const notes = ledgerNotes(result, { unquoted: uq.unquoted, regressed: reg.rows });
  const ledger = dryRun ? { path: null, why: 'dry-run — no ledger written' } : writeLedger({ result, notes, open: openLedger });
  const end = `steer until · ${result.dryRun ? 'planned' : 'ended'} after ${result.cycles} cycle${result.cycles === 1 ? '' : 's'} · ticked ${result.ticked.length} · ${result.dryRun ? `would dispatch ${result.planned.length}` : `stuck ${result.stuck.length}`} · needs-you ${result.needs.length} · your acts ${result.acts.length} · asks since ${window.slice(0, 16)}: ${uq.asks} in ${uq.sessions} session${uq.sessions === 1 ? '' : 's'}, ${uq.unquoted.length} quoted by NO row${result.paused ? ` · PAUSED: ${result.paused.reason}` : ''} · ledger ${ledger.path || ledger.why}`;
  say(end);
  say(`  ${reg.line}`);
  const goalSeg = await goalEndSegment({ md: specText, before: goalBefore });   // C295: goal units closed this run · uncovered open asks · the /steergoal source
  say(`  ${goalSeg.line}`);
  for (const u of uq.unquoted) say(`  UNCLEAR · ${String(u.at || '').slice(0, 16)} "${u.text.slice(0, 120)}${u.text.length > 120 ? '…' : ''}"${u.hint ? ` — nearest ${u.hint} (a hint, not coverage)` : ''}`);
  return { ...result, unquoted: uq, regressed: reg, notes, ledger, end, goalAccounting: goalSeg };
  } finally { if (held) release({ ...(lockPath ? { path: lockPath } : {}) }); }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const json = argv.includes('--json');
  const r = await steerUntil({ dryRun: argv.includes('--dry-run'), scope: arg('--scope'), ceiling: arg('--ceiling') ? Number(arg('--ceiling')) : DEFAULT_CEILING_USD, since: arg('--since'), say: json ? () => {} : console.log, openLedger: !argv.includes('--no-open') });
  if (json) console.log(JSON.stringify(r));
  process.exit(0);
}
