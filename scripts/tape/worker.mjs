#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/worker.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE MAILBOX WORKER — /tape's engine, detached from any web server, one process
// per SESSION SLUG (forked from scripts/rewrite/worker.mjs, which is one process
// per FILE — same pattern, different key, because /tape's mailbox lives inside
// the session dir: `.thetacog/tape-sessions/<slug>/mailbox/`).
//
//   mailbox/<slug>/          (== .thetacog/tape-sessions/<slug>/mailbox/)
//     worker.json      heartbeat + pid + cursor        (worker writes, API reads)
//     cmd-*.json       commands                        (API writes, worker consumes)
//     res-<id>.json    command results                 (worker writes, API reads)
//   session.json / specs.ndjson / decisions.ndjson / dispatches.ndjson /
//   vega-series.ndjson   (worker writes through store.mjs, API only reads)
//
// A command file is UNLINKED BEFORE it is executed, so a command that throws is
// never silently retried forever — its error lands in the matching res-<id>.json
// instead.
//
// THE WORKER MUST NOT BLOCK COMMAND INTAKE during a long walk or dispatch. A
// 'step'/'walk'/'dispatch' command sets `heavyInFlight` for its own duration;
// the 1s poll interval keeps firing regardless of whether the previous tick's
// async callback has resolved (Node does not serialize setInterval callbacks),
// so a SECOND concurrent drainCommands() call runs while the first is still
// awaiting a long walk — it rejects any NEW heavy command with a clear "try
// again" error but still processes light commands (pick/drop/decide/steer/
// pause/stop/…) that arrived mid-walk. `pause`/`stop` are checked by engine.run()
// itself between turns, so they take effect without waiting for the whole walk.
//
//   node scripts/tape/worker.mjs --slug <slug> [--sources '["/abs/a.txt"]'] [--repo <path>] [--once]
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import * as store from './store.mjs';
import * as engine from './engine.mjs';
import * as physics from './physics.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const SLUG = arg('--slug');
if (!SLUG) { console.error('✗ worker: need --slug <slug>'); process.exit(1); }
const REPO = arg('--repo', process.cwd());

let SOURCES = [];
const srcArg = arg('--sources');
if (srcArg) { try { const p = JSON.parse(srcArg); if (Array.isArray(p)) SOURCES = p; } catch { /* ignore malformed --sources, session may already have some */ } }

const sha256 = (s) => createHash('sha256').update(String(s || '')).digest('hex');

// ── MAILBOX PROBE 1 — a dispatched agent must claim a code surface before it commits ──────────
// The claim ledger is GLOBAL (one file, under the sessions root, not per-slug) because the surface
// being protected — a repo file path — is global; two different tape SESSIONS dispatching against
// the same file are exactly the race this exists to catch, not only two atoms inside one session.
// Same ledger shape/location as apps/cockpit/src/routes/api/lock/+server.js's copy (duplicated, not
// imported — that route runs inside Vite's module graph and must never import an engine module, per
// the "unified-drift" lesson already paid for in that file's own comments).
const CLAIMS_FILE = path.join(store.sessionsDir(), '_claims', 'claims.ndjson');
const CLAIM_TTL_MS = 15 * 60_000; // covers runOneAgent's 10-minute hard ceiling with headroom

/**
 * claimSurface({id, paths}) — the claim is taken by THIS orchestrator, before any child process is
 * spawned, which is strictly earlier than any commit that child could ever make. Scoped to
 * CROSS-atom conflicts only: a fresh claim from the SAME id never conflicts with itself, so firing
 * multiple subagents at one atom (the existing redundancy feature) is untouched — this exists to
 * stop two DIFFERENT atoms racing edits onto the same file, not to serialize an atom against itself.
 */
function claimSurface({ id, paths }) {
  const norm = (p) => String(p).replace(/\\/g, '/').trim();
  const mine = [...new Set((paths || []).filter(Boolean).map(norm))];
  if (!mine.length) return { ok: true, row: null }; // nothing to claim — never a false conflict
  fs.mkdirSync(path.dirname(CLAIMS_FILE), { recursive: true });
  const now = Date.now();
  let rows = [];
  try {
    rows = fs.readFileSync(CLAIMS_FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* no ledger yet — first claim */ }
  const fresh = rows.filter((r) => new Date(r.expiresAt || 0).getTime() > now);
  const conflict = fresh.find((r) => r.id !== id && (r.paths || []).some((p) => mine.includes(norm(p))));
  if (conflict) return { ok: false, conflict };
  const row = { ts: new Date(now).toISOString(), id, paths: mine, claimedBy: 'worker.mjs', expiresAt: new Date(now + CLAIM_TTL_MS).toISOString() };
  fs.appendFileSync(CLAIMS_FILE, JSON.stringify(row) + '\n');
  return { ok: true, row };
}

let session = store.createSession({ slug: SLUG, sources: SOURCES });
const SESSION_DIR = store.sessionPath(SLUG);
const BOX = path.join(SESSION_DIR, 'mailbox');
fs.mkdirSync(BOX, { recursive: true });
fs.mkdirSync(path.join(SESSION_DIR, 'html'), { recursive: true });

const WORKER_JSON = path.join(BOX, 'worker.json');

// ── single-writer lock (same discipline as scripts/rewrite/worker.mjs) ─────────
function existingWorker() {
  try {
    const w = JSON.parse(fs.readFileSync(WORKER_JSON, 'utf8'));
    if (!w?.pid) return null;
    const fresh = Date.now() - new Date(w.heartbeat || 0).getTime() < 90_000;
    if (!fresh) return null;
    try { process.kill(w.pid, 0); } catch { return null; }
    return w;
  } catch { return null; }
}
const prior = existingWorker();
if (prior && prior.pid !== process.pid) {
  console.log(JSON.stringify({ ok: true, alreadyRunning: true, pid: prior.pid, slug: SLUG }));
  process.exit(0);
}

let lastError = null;
let stopping = false;
let heavyInFlight = false;
const START = new Date().toISOString();

/**
 * THE LOCK IS RE-ASSERTED EVERY BEAT, NOT ONLY AT STARTUP.
 * The startup check above closes the ordinary race, but worker.json can vanish or be
 * replaced while this process lives (a session dir recreated, a stale file cleaned up),
 * and the API's spawn path keys off that file alone — so it happily starts a SECOND
 * worker on the same slug. Two workers draining one mailbox is not a slow console, it is
 * two state writers on an append-only ledger, which is precisely what "the worker is the
 * SINGLE state writer" exists to forbid.
 * OBSERVED LIVE 2026-08-20: pids 54854 and 54879 both ran slug 'gdd-real'; one consumed
 * the walk command while the other reported heavyInFlight:false, and the walk appeared to
 * die at cursor 1 with no error anywhere.
 * Resolution rule: the OLDER worker (earliest startedAt) keeps the slug; a younger one
 * that finds a live older owner stands down. Deterministic, so both sides never yield.
 */
function yieldIfSupplanted() {
  let w = null;
  try { w = JSON.parse(fs.readFileSync(WORKER_JSON, 'utf8')); } catch { return false; }
  if (!w?.pid || w.pid === process.pid) return false;
  const fresh = Date.now() - new Date(w.heartbeat || 0).getTime() < 90_000;
  if (!fresh) return false;
  try { process.kill(w.pid, 0); } catch { return false; }   // owner is gone — this process keeps the slug
  const ownerOlder = String(w.startedAt || '') < START;
  if (!ownerOlder) return false;                            // we are older: reclaim on the next write
  console.log(JSON.stringify({ ok: true, stoodDown: true, slug: SLUG, pid: process.pid, ownerPid: w.pid }));
  process.exit(0);
}

function heartbeat(extra = {}) {
  yieldIfSupplanted();
  session = store.loadSession(SLUG) || session;
  fs.writeFileSync(WORKER_JSON, JSON.stringify({
    pid: process.pid, slug: SLUG, heartbeat: new Date().toISOString(), startedAt: START,
    cursor: session.cursor ?? 0, totalTurns: session.totalTurns ?? null,
    paused: !!session.paused, heavyInFlight, lastError,
    ...extra,
  }, null, 2));
}

// Prime asynchronously — never block the mailbox loop on the first ingest, which
// for a large Lane-B transcript can take real (if sub-second) time.
(async () => {
  try { const r = await engine.open({ slug: SLUG, sources: session.sources }); session = r.session; }
  catch (e) { lastError = `open failed: ${e.message}`; }
  heartbeat();
})();
console.log(JSON.stringify({ ok: true, pid: process.pid, slug: SLUG, mailbox: BOX }));

// ── lazy loaders for the two other-builder modules this worker's dispatch path needs ──
let _measureMod;
async function loadMeasure() {
  if (_measureMod !== undefined) return _measureMod;
  try { _measureMod = await import(new URL('./measure-enforcement.mjs', import.meta.url)); }
  catch { _measureMod = null; }
  return _measureMod;
}

// THE STDOUT-CARRIES-THE-ERROR FINDING (2026-08-20): `claude -p ... --output-format json` reports
// its own fatal errors (bad model, api_error, hitting a stop condition) as a JSON envelope ON
// STDOUT — `{"is_error":true,"result":"...","terminal_reason":"...","api_error_status":...}` —
// with a NON-ZERO exit code and STDERR OFTEN COMPLETELY EMPTY. Measured directly: `claude -p
// "..." --model totally-bogus-model-xyz --output-format json` exits 1, stderr carries only a
// terse tag, and the actual diagnostic ("There's an issue with the selected model...") sits in
// stdout's `result` field. The prior code below only ever looked at `err` on a non-zero exit and
// threw `out` away entirely — so a real diagnostic that DID exist was discarded, and the dispatch
// row could only ever say "claude exit 1: " with nothing after the colon. The spawn shape itself
// (env-stripped argv, prompt-as-argv-element) is NOT the bug — reproduced standalone against the
// real stored DECISION-017 prompt (2279 chars) and it returned exit 0 in ~152s, and again 3x
// concurrently with no contention. Root cause of any given failure lives in the CLI's own
// api_error/terminal_reason, which is exactly why it must be captured and persisted, not guessed.
function extractDiagnostic(out, err, code) {
  let fromJson = null;
  try {
    const parsed = JSON.parse(out);
    if (parsed && typeof parsed === 'object') {
      const bits = [];
      if (parsed.terminal_reason) bits.push(`terminal_reason=${parsed.terminal_reason}`);
      if (parsed.api_error_status != null) bits.push(`api_error_status=${parsed.api_error_status}`);
      if (parsed.result) bits.push(String(parsed.result));
      if (bits.length) fromJson = bits.join(' — ');
    }
  } catch { /* stdout wasn't JSON (crash before the envelope was ever written) — fall through */ }
  const stderrTrimmed = String(err || '').trim();
  const message = fromJson || (stderrTrimmed ? stderrTrimmed.slice(0, 500) : null)
    || (out ? `(no stderr; unparsed stdout) ${out.slice(0, 500)}` : '(no stdout, no stderr — process produced zero output)');
  return `claude exit ${code}: ${message}`;
}

// ── firing subagents — bounded-concurrent Promise.all, NEVER a sequential await-loop ──
function runOneAgent(prompt) {
  return new Promise((resolvePromise) => {
    const t0 = Date.now();
    const child = spawn('env', [
      '-u', 'CLAUDECODE', '-u', 'CLAUDE_CODE_ENTRYPOINT',
      '-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_AUTH_TOKEN', '-u', 'ANTHROPIC_BASE_URL',
      'claude', '-p', prompt, '--model', 'sonnet', '--output-format', 'json',
      // THE SECOND FINDING (2026-08-20, from a live dispatch's own diagnostics): headless `-p` mode
      // with no permission flag denies Edit/Write outright — this repo's .claude/settings.json has
      // no Edit allowlist (only specific Bash(...) patterns), so a dispatched agent whose work order
      // requires an actual code change gets `permission_denials:[{tool_name:"Edit",...}]` and
      // completes exit 0 having done NOTHING, asking the (absent) human for access. That is why the
      // round trip never landed a commit even on a run that "succeeded." Verified fix, standalone:
      // `claude -p "Edit /tmp/x" --permission-mode bypassPermissions` — permission_denials:[], file
      // actually changed. These are trusted, repo-scoped work orders (house rules already baked
      // into the prompt: no branch, no amend, commit --only <exact paths>) dispatched from the same
      // machine already running this session in bypass mode — bypassPermissions here is the same
      // trust boundary, not a widening of it.
      '--permission-mode', 'bypassPermissions',
    ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    let settled = false;
    // TRUNCATED TAILS — persisted onto the dispatch row on EVERY path (ok, failed, timeout, spawn
    // error) so the ledger alone is diagnosable without re-running anything. 4000 chars is enough
    // to carry a full JSON error envelope; never the whole multi-KB success payload.
    const tails = () => ({ stdoutTail: out.slice(-4000), stderrTail: err.slice(-4000) });
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      try { child.kill('SIGKILL'); } catch {}
      resolvePromise({ ok: false, error: `timeout after ${Date.now() - t0}ms`, commits: [], ...tails() });
    }, 600_000); // 10 min ceiling for a real enforcement subagent
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise({ ok: false, error: String(e.message), commits: [], ...tails() }); });
    child.on('close', (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) return resolvePromise({ ok: false, error: extractDiagnostic(out, err, code), commits: [], ...tails() });
      let text = out;
      try { const parsed = JSON.parse(out); text = String(parsed.result || out); } catch { /* fall back to raw stdout */ }
      const commits = [...new Set([...text.matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]).filter((h) => /^[0-9a-f]{7,40}$/.test(h)))];
      resolvePromise({ ok: true, text, ms: Date.now() - t0, commits, ...tails() });
    });
  });
}

async function fireDispatch(atomId) {
  const atoms = store.resolveAtoms(SLUG);
  const atom = atoms.find((a) => a.id === atomId);
  if (!atom) return { ok: false, error: `no atom ${atomId} in ${SLUG}` };
  const decision = store.readDecisions(SLUG).filter((d) => d.atomId === atomId).at(-1);
  const dispatchRow = store.readDispatches(SLUG).filter((d) => d.atomId === atomId).at(-1);
  if (!dispatchRow?.prompt) return { ok: false, error: `no dispatch prompt recorded for ${atomId} — decide it first, or set one with editPrompt` };

  const n = Math.max(0, parseInt(decision?.subagents ?? dispatchRow.agents ?? 0, 10) || 0);
  if (n === 0) {
    store.updateDispatch(SLUG, atomId, { status: 'done', resultSummary: '0 subagents requested — no artifact produced by this dispatch.' });
    return { ok: true, atomId, agents: 0, resultSummary: '0 subagents requested' };
  }

  // MAILBOX PROBE — claim the atom's surface BEFORE any subagent is spawned, i.e. strictly before
  // any commit that subagent could make. target_surface is a single LLM-named path and is usually
  // null; owns[] (discoverOwns()'s git-grep result, the SAME boundary the dispatch prompt hands the
  // agent as "you may ONLY create or modify these exact paths") is the common case — COORD-028 itself
  // has target_surface: null and a 12-file owns[], so target_surface-only would claim NOTHING for the
  // coordinate this rule was written for. Mirrors decision-corpus.mjs's own fallback convention
  // (`c.target_surface || (c.owns || []).find(o => o.kind === 'code')?.file`), extended to every
  // owned code file rather than just the first, and apps/cockpit's lock/+server.js claimPaths, which
  // already claims the full owns[] list.
  const claimPaths = atom.target_surface
    ? [String(atom.target_surface)]
    : (atom.owns || []).filter((o) => o.kind === 'code').map((o) => o.file);
  if (claimPaths.length) {
    const claim = claimSurface({ id: atomId, paths: claimPaths });
    if (!claim.ok) {
      const reason = `surface [${claimPaths.join(', ')}] claimed by ${claim.conflict.id} until ${claim.conflict.expiresAt}`;
      store.updateDispatch(SLUG, atomId, { status: 'blocked', resultSummary: `dispatch refused — ${reason}`, enforcementReason: reason });
      return { ok: false, atomId, error: reason };
    }
  }

  store.updateDispatch(SLUG, atomId, { status: 'running' });
  const results = await Promise.all(Array.from({ length: n }, () => runOneAgent(dispatchRow.prompt)));
  const commits = [...new Set(results.flatMap((r) => r.commits || []))];
  const failed = results.filter((r) => !r.ok);
  const summary = results.map((r, i) => `agent ${i + 1}: ${r.ok ? 'ok' : 'FAILED'}${r.error ? ' — ' + r.error : ''}`).join(' · ');
  // diagnostics — persisted onto the row for EVERY agent, ok or failed, so a failure is
  // diagnosable straight from dispatches.ndjson without re-running anything (SELF-IMPROVING FIRES:
  // ship the prevention, not just the retry). Truncated stdout/stderr tails, per agent.
  const diagnostics = results.map((r, i) => ({
    agent: i + 1, ok: r.ok, error: r.error || null, ms: r.ms ?? null,
    stdoutTail: r.stdoutTail || '', stderrTail: r.stderrTail || '',
  }));
  store.updateDispatch(SLUG, atomId, { status: failed.length === results.length ? 'failed' : 'running', resultSummary: summary, commits, diagnostics });

  // ── THE CLOSING ARROW — every landed commit is measured back against the atom that ordered it ──
  // (design doc §A11 step 11: "the distance between the physical rule on the tape and the AI's
  // actual output is your quantifiable drift"). measureEnforcement's own signature is a SINGLE
  // destructured object — {atom, sha, repoRoot, slug} — never positional args; a positional call
  // silently destructures the wrong thing and always returns the "requires {atom,sha}" refusal.
  const measure = await loadMeasure();
  const measureFn = typeof measure?.measureEnforcement === 'function' ? measure.measureEnforcement : null;
  const enforcement = commits.length
    ? await Promise.all(commits.map(async (sha) => {
        if (!measureFn) {
          return { sha, offPct: null, sigmaDrift: null, refused: true, reason: 'measure-enforcement.mjs not available — enforcement fidelity was not built at the time this ran', receiptPng: null, receiptReason: null, falsifier: { ran: false, exitCode: null, output: null } };
        }
        try {
          const reading = await measureFn({ atom, sha, repoRoot: REPO, slug: SLUG });
          return { sha, ...reading };
        } catch (e) {
          return { sha, offPct: null, sigmaDrift: null, refused: true, reason: `measureEnforcement threw: ${String(e?.message || e).slice(0, 300)}`, receiptPng: null, receiptReason: null, falsifier: { ran: false, exitCode: null, output: null } };
        }
      }))
    : [];

  // vega-series.ndjson — its own kind, its own field name. `laneDrift` is B3 (placement vs home,
  // pure arithmetic over the walk); this is B4 (did the landed commit hit the rule) and MUST NOT
  // share that name — TAPE-CONTRACT.md's names are load-bearing, not decoration.
  enforcement.forEach((e, i) => {
    store.appendVega(SLUG, {
      atomId, pos: i, kind: 'enforcement', coord: atom.coord ?? null, sha: e.sha,
      enforcementDrift: e.offPct, sigmaDrift: e.sigmaDrift,
      refused: e.refused, reason: e.reason,
      falsifierRan: e.falsifier?.ran ?? false, falsifierExit: e.falsifier?.exitCode ?? null,
    });
  });

  // ── the dual-key lock (design doc §A11 point 11, GDD L1386-91) ──────────────────────────────────
  // 'done' requires BOTH keys on the reading for the LAST landed commit: a non-refused receipt AND
  // (when the atom carries one) a falsifier that exited 0. Anything short of that stays 'dispatched'
  // — visibly stuck, WITH a reason on the row, never silently promoted to done.
  const lastReading = enforcement[enforcement.length - 1] || null;
  const dispatchLanded = commits.length > 0 && failed.length < results.length;
  const hasFalsifier = !!(atom.falsifier && String(atom.falsifier).trim());
  const enforcementPassed = !!lastReading && lastReading.refused !== true
    && (!hasFalsifier || lastReading.falsifier?.exitCode === 0);

  const finalStatus = dispatchLanded && enforcementPassed ? 'done'
    : (failed.length === results.length ? 'failed' : 'dispatched');

  const enforcementReason = finalStatus === 'done' ? null
    : !dispatchLanded ? 'dispatch produced no clean commit — nothing to measure yet'
    : !lastReading ? 'no commit to measure — enforcement was not run'
    : lastReading.refused ? `enforcement receipt refused: ${lastReading.reason || 'unspecified'}`
    : `falsifier failed (exit ${lastReading.falsifier?.exitCode}): ${String(lastReading.falsifier?.output || '').slice(0, 300)}`;

  store.updateDispatch(SLUG, atomId, {
    status: finalStatus,
    receiptPng: lastReading?.receiptPng ?? null,
    enforcement, enforcementReason,
  });
  if (finalStatus === 'done') store.setAtomStatus(SLUG, atomId, 'done');
  return { ok: true, atomId, agents: n, commits, resultSummary: summary, enforcement, finalStatus, enforcementReason };
}

// ── command drain ────────────────────────────────────────────────────────────
const HEAVY = new Set(['step', 'walk', 'dispatch']);

async function drainCommands() {
  let files;
  try { files = fs.readdirSync(BOX).filter((f) => f.startsWith('cmd-') && f.endsWith('.json')); }
  catch { return; }
  files.sort();

  for (const f of files) {
    const p = path.join(BOX, f);
    let cmd;
    try { cmd = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { try { fs.unlinkSync(p); } catch {} continue; }
    try { fs.unlinkSync(p); } catch {}   // consume BEFORE executing — a throwing command is never retried forever

    const id = cmd.id || f.replace(/^cmd-|\.json$/g, '');
    let result;
    try {
      if (HEAVY.has(cmd.action) && heavyInFlight) {
        result = { ok: false, error: `a walk/step/dispatch is already running for '${SLUG}' — try again after it completes` };
      } else {
        switch (cmd.action) {
          // `paste` — THE FRONT DOOR. The operator pastes a document and hits Enter instead of
          // supplying a path. The Next route materialises the bytes as a real file under the session
          // and then sends `open`, so that path worked by accident; the CLI/serve path would have
          // handed the worker a verb with no case and died silently. S5 caught it:
          // "verb 'paste' is accepted by the API but the worker has no case for it."
          // Handled HERE so every door behaves identically: write the file, then open it. Once the
          // paste is a real file on disk, every downstream invariant holds unchanged — the atom's
          // source points at something a human can open and the verbatim quote stays checkable.
          case 'paste': {
            const text = String(cmd.text || '');
            if (!text.trim()) { result = { ok: false, reason: 'nothing pasted' }; break; }
            const name = String(cmd.name || 'pasted').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60) || 'pasted';
            const file = path.join(SESSION_DIR, `${name}.txt`);
            fs.mkdirSync(SESSION_DIR, { recursive: true });
            fs.writeFileSync(file, text, 'utf8');
            const r = await engine.open({ slug: SLUG, sources: [file] });
            session = r.session;
            result = { ...r, pastedTo: file, bytes: Buffer.byteLength(text, 'utf8') };
            break;
          }
          case 'open': {
            const r = await engine.open({ slug: SLUG, sources: cmd.sources && cmd.sources.length ? cmd.sources : session.sources });
            session = r.session;
            result = r;
            break;
          }
          case 'step':
            heavyInFlight = true;
            try { result = await engine.step(SLUG); } finally { heavyInFlight = false; }
            break;
          case 'walk':
            heavyInFlight = true;
            try { result = await engine.run(SLUG, { maxTurns: Number(cmd.maxTurns) || Infinity, shouldStop: () => stopping }); }
            finally { heavyInFlight = false; }
            break;
          case 'pick': case 'drop': case 'reintroduce': {
            const status = cmd.action === 'pick' ? 'picked' : cmd.action === 'drop' ? 'dropped' : 'reintroduced';
            const row = store.setAtomStatus(SLUG, cmd.atomId, status, 'operator');
            result = row ? { ok: true, row } : { ok: false, error: `no atom ${cmd.atomId}` };
            break;
          }
          case 'editAtom': {
            const before = store.resolveAtoms(SLUG).find((a) => a.id === cmd.atomId);
            if (!before) { result = { ok: false, error: `no atom ${cmd.atomId}` }; break; }
            const patch = { picked_by: 'operator' };
            for (const k of ['rule', 'priority', 'type', 'target_surface', 'falsifier']) if (cmd[k] !== undefined) patch[k] = cmd[k];
            let row = store.editAtom(SLUG, cmd.atomId, patch);
            // A rule edit invalidates its physics reading — re-place and re-shortlist (TAPE-CONTRACT.md §D).
            if (row && cmd.rule !== undefined) {
              const tapePath = path.join(SESSION_DIR, 'flight-tape.json');
              const p = await physics.placeAtom({ quote: row.quote, rule: row.rule, tapePath, withFidelity: false });
              const laneDrift = session?.home?.coord ? physics.driftFrom(session.home.coord, p.coord) : null;
              row = store.editAtom(SLUG, cmd.atomId, { coord: p.coord, placement: p.placement, sigma: p.sigma, sensor: p.sensor, apertureFidelity: p.apertureFidelity, laneDrift });
              const prior = store.resolveAtoms(SLUG).filter((a) => a.id !== cmd.atomId);
              const shortlist = physics.ncdShortlist(row.rule, prior.map((a) => ({ id: a.id, rule: a.rule })));
              row = store.editAtom(SLUG, cmd.atomId, { contradicts: shortlist.map((s) => s.id), contradictShortlist: shortlist });
            }
            result = { ok: true, row };
            break;
          }
          case 'decide': {
            const atom = store.resolveAtoms(SLUG).find((a) => a.id === cmd.atomId);
            if (!atom) { result = { ok: false, error: `no atom ${cmd.atomId}` }; break; }
            if (!['accept', 'reject', 'defer'].includes(cmd.verdict)) { result = { ok: false, error: `verdict must be accept|reject|defer` }; break; }
            const decisionRow = store.appendDecision(SLUG, {
              atomId: cmd.atomId, verdict: cmd.verdict, reply: cmd.reply || '',
              spoken: !!cmd.spoken, subagents: parseInt(cmd.subagents, 10) || 0, commit: null,
            });
            store.setAtomStatus(SLUG, cmd.atomId, 'decided', 'operator');
            let dispatchRow = null;
            if (cmd.verdict === 'accept') {
              const prompt = engine.generateDispatchPrompt(atom, { repoRoot: REPO });
              dispatchRow = store.appendDispatch(SLUG, {
                atomId: cmd.atomId, prompt, promptSha: sha256(prompt),
                agents: parseInt(cmd.subagents, 10) || 0, agentType: 'claude', status: 'queued',
                resultSummary: '', commits: [], receiptPng: null,
              });
            }
            if (cmd.speak !== false && atom.rule) execFile('say', ['-v', 'Ava (Premium)', atom.rule], () => {}); // detached, never blocks
            result = { ok: true, decision: decisionRow, dispatch: dispatchRow };
            break;
          }
          case 'editPrompt': {
            const cur = store.readDispatches(SLUG).filter((d) => d.atomId === cmd.atomId).at(-1);
            const row = store.appendDispatch(SLUG, {
              atomId: cmd.atomId, prompt: cmd.prompt, promptSha: sha256(cmd.prompt),
              agents: cur?.agents ?? 0, agentType: 'claude', status: cur?.status || 'queued',
              resultSummary: cur?.resultSummary || '', commits: cur?.commits || [], receiptPng: cur?.receiptPng ?? null,
            });
            result = { ok: true, dispatch: row };
            break;
          }
          case 'dispatch':
            heavyInFlight = true;
            try { result = await fireDispatch(cmd.atomId); } finally { heavyInFlight = false; }
            break;
          case 'steer':
            result = await engine.applySteer(SLUG, { kind: cmd.kind, value: cmd.value });
            break;
          case 'speak': {
            const atom = store.resolveAtoms(SLUG).find((a) => a.id === cmd.atomId);
            const say = (atom?.rule || cmd.text || '').trim();
            if (say) execFile('say', ['-v', 'Ava (Premium)', say], () => {}); // detached — never blocks the mailbox
            result = { ok: true, spoke: !!say };
            break;
          }
          case 'pause':
            session = store.loadSession(SLUG) || session;
            session.paused = true;
            store.saveSession(SLUG, session);
            result = { ok: true, paused: true };
            break;
          case 'resume':
            session = store.loadSession(SLUG) || session;
            session.paused = false;
            store.saveSession(SLUG, session);
            result = { ok: true, paused: false };
            break;
          case 'stop':
            stopping = true;
            result = { ok: true, stopping: true };
            break;
          case 'report': {
            const { generateReports } = await import('./html-report.mjs');
            // html-report.mjs's own default ignores TAPE_SESSIONS_DIR (it hardcodes
            // <repo>/.thetacog/tape-sessions) — pass store's resolved dir explicitly so a
            // test run under TAPE_SESSIONS_DIR never spills reports into the real repo tree.
            result = { ok: true, files: generateReports(SLUG, { sessionsDir: store.sessionsDir() }) };
            break;
          }
          default:
            result = { ok: false, error: `unknown action ${cmd.action}` };
        }
      }
    } catch (err) {
      result = { ok: false, error: String(err?.message || err) };
      lastError = result.error;
    }
    try { fs.writeFileSync(path.join(BOX, `res-${id}.json`), JSON.stringify({ id, ts: new Date().toISOString(), ...result })); } catch {}
  }
}

/** Delete result files nobody collected, so the mailbox does not grow forever. */
function sweepResults() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(BOX)) {
      if (!f.startsWith('res-')) continue;
      const p = path.join(BOX, f);
      if (now - fs.statSync(p).mtimeMs > 10 * 60_000) fs.unlinkSync(p);
    }
  } catch {}
}

const ONCE = has('--once');
let ticks = 0;
const loop = setInterval(async () => {
  await drainCommands();
  heartbeat();
  if (++ticks % 30 === 0) sweepResults();
  if (stopping || (ONCE && (store.loadSession(SLUG)?.cursor ?? 0) > 0 && !heavyInFlight)) {
    clearInterval(loop);
    heartbeat({ stopped: true });
    process.exit(0);
  }
}, 1000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { heartbeat({ stopped: true }); } catch {}
    process.exit(0);
  });
}
// Detached from a terminal that later closes — do not die with it.
process.on('SIGHUP', () => {});
