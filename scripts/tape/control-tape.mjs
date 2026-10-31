// packages/thetacog-mcp/scripts/tape/control-tape.mjs — THE BUTTONS ARE ON THE TAPE.
//
// Operator, gemini-web:b6afe656c7f414de turn 61, verbatim:
//   "we'll be able to control the HTML page from the code, which is very cool because the tape is a
//    shared state… we should be able to tie the actual buttons, uh, clicks to the state transition
//    that is picked up. So the button presses are in the tape as well. That way the code can do
//    perturbation just by clicking buttons on the page effectively and running itself from there
//    instead of running the direct code."
//
// ── THE TWO HALVES, AND WHY THE SECOND ONE IS THE POINT ───────────────────────────────────────
// RECORD is the easy half: a click appends a row, so the terminal can see what the glass did. Every
// other feed here already works that way (cli-events.ndjson, one act, two readers).
//
// DRIVE is the half the ask is actually about, and it inverts the direction: code appends a
// `click-request`, the page — which is already polling — picks it up and INVOKES THE SAME FUNCTION
// THE HUMAN BUTTON INVOKES, then appends the resulting `click`. The perturbation therefore travels
// the real path: fire() runs, /api/lock is posted, the coordinate lands, the question retires. Code
// that instead posted /api/lock itself would look identical on the ledger and would be measuring a
// DIFFERENT path from the one a human exercises — the proxy standing in for the construct, which is
// exactly the failure class CLAUDE.md prosecutes. The registry (apps/cockpit/src/lib/control-tape.js)
// exists so there is one function per control id and no second implementation to drift.
//
// ── WHY A SEPARATE LEDGER FROM cli-events.ndjson ──────────────────────────────────────────────
// cli-events is a TELEMETRY FEED: append, tail, render, forget. A control tape has to answer a
// different question — "which requests are still outstanding?" — which is a set difference over the
// whole file, not a tail. Mixing an outstanding-work ledger into a feed that everything truncates to
// the last 12 rows is how a request quietly stops existing. The click is ALSO announced onto
// cli-events by the API route, because the operator watching the terminal should see the press.
//
// ── NO SEQUENCE NUMBERS. POSITION IS THE CURSOR. ──────────────────────────────────────────────
// An append-only file already has a total order, so a `seq` field would be a second source of truth
// that two concurrent appends can collide on. Pending-ness is derived instead: a request is pending
// when nothing later in the file resolves its requestId. The tape is the state; nothing caches it.
//
// ── EVERY REQUEST CARRIES A TTL, AND AN EXPIRED ONE IS NEVER FIRED ────────────────────────────
// A page loaded tomorrow must not replay yesterday's queued clicks the moment it mounts. `.thetacog/
// llm-pause` held four stages dark for thirty-six days because a hold had no timer; a queued
// perturbation with no timer is the same defect pointed at the glass. Expiry is reported, never
// silent: `pendingClicks()` returns expired rows separately so a caller can say why nothing fired.
//
// @guard tests/tape/clicks-are-in-the-tape.test.mjs

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');

// READ LAZILY, NEVER AT MODULE LOAD. coordinates.mjs pins TAPE_SESSIONS_DIR into a module constant,
// and tests/tape/lock-and-attest-writes-the-tape.test.mjs records what that costs: busting the outer
// module's specifier does not re-evaluate a transitive import, so a test that sets the env after the
// first import silently writes into the previous test's directory. A function call cannot do that.
function sessionsRoot() {
  return process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');
}
const tapePath = (slug) => resolve(sessionsRoot(), slug, 'controls.ndjson');

/** How long a queued click stays fireable. Long enough for a page reload, short enough that a
 *  request queued before lunch is never the thing that fires after it. */
export const REQUEST_TTL_MS = 2 * 60_000;

// ── THE CONTROL SURFACE, DECLARED ─────────────────────────────────────────────────────────────
// Named here rather than discovered from the Svelte source, because discovering it would mean
// grepping for `on:click` — a token that usually accompanies a control, which is not the same thing
// as the control. Code asking "what can I click?" reads this list; the browser registry asserts at
// runtime that every id here has a real function bound to it, so the list cannot rot into a menu of
// buttons that do not exist.
export const CONTROLS = [
  { id: 'fire', label: 'fire the chain', effect: 'locks the steer box as a coordinate and dispatches its subagents' },
  { id: 'hardware-receipt', label: 'get hardware receipt', effect: 'runs the pointer-chase and fills the attestation pane' },
  { id: 'select-decision', label: 'select a tape row', effect: 'drives panes 2-4 from that decision', args: { id: 'Decision_ID' } },
];
export const isControl = (id) => CONTROLS.some((c) => c.id === String(id));

function appendRow(slug, row) {
  const out = { ts: new Date().toISOString(), ...row };
  mkdirSync(resolve(sessionsRoot(), slug), { recursive: true });
  appendFileSync(tapePath(slug), JSON.stringify(out) + '\n');
  return out;
}

/** readControls(slug) — the whole tape, oldest first. A missing file is an HONEST EMPTY: a session
 *  nobody has clicked in has no presses, which is a different claim from a broken reader. */
export function readControls(slug) {
  const p = tapePath(slug);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

let counter = 0;
/** Unique within a process AND across processes: the CLI and the dev server both mint these. */
export function mintRequestId() {
  return `CLK-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * requestClick — CODE ASKS THE PAGE TO PRESS SOMETHING. This does not perform the transition; it
 * queues it. The distinction is the whole design: a row here is an INTENT, and the matching `click`
 * row is the REALITY, so the tape carries both halves of every perturbation and they can disagree.
 */
export function requestClick(slug, { control, args = null, by = 'code', note = null } = {}) {
  if (!isControl(control)) {
    return { ok: false, reason: `unknown control "${control}" — the glass exposes: ${CONTROLS.map((c) => c.id).join(', ')}` };
  }
  const requestId = mintRequestId();
  const row = appendRow(slug, { kind: 'click-request', control, args, by, note, requestId, ttlMs: REQUEST_TTL_MS });
  return { ok: true, row, requestId };
}

/**
 * recordClick — A PRESS THAT HAPPENED. `source` is the honest provenance: 'human' when a person hit
 * the button, 'code' when the drain fired it for a request. Both are real presses of the same
 * function; conflating them would make a self-driven run indistinguishable from an operator session,
 * which is the one thing this ledger has to keep separable.
 */
export function recordClick(slug, { control, args = null, source = 'human', requestId = null, note = null } = {}) {
  if (!control) return { ok: false, reason: 'a click row needs a control id' };
  return { ok: true, row: appendRow(slug, { kind: 'click', control, args, source, requestId, note }) };
}

/**
 * resolveRequest — the drain reporting back. An UNRESOLVED request must never look the same as a
 * finished one, and a control the page could not find must fail LOUDLY here rather than be dropped:
 * "I did not click" and "I clicked and nothing happened" are different claims.
 */
export function resolveRequest(slug, { requestId, ok = true, error = null, control = null } = {}) {
  if (!requestId) return { ok: false, reason: 'resolveRequest needs the requestId it is answering' };
  return { ok: true, row: appendRow(slug, { kind: 'click-done', requestId, control, ok: !!ok, error }) };
}

/**
 * pendingClicks(slug, {now}) — the set difference that IS the queue.
 *
 * A request is OUTSTANDING when no later row resolves it (`click` carrying its requestId, or
 * `click-done`). It is EXPIRED when it is outstanding but older than its own ttl. Expired rows come
 * back in their own array rather than being filtered away silently, so a caller that fires nothing
 * can say WHY it fired nothing.
 */
export function pendingClicks(slug, { now = Date.now() } = {}) {
  const rows = readControls(slug);
  const resolved = new Set();
  for (const r of rows) {
    if ((r.kind === 'click-done' || r.kind === 'click') && r.requestId) resolved.add(r.requestId);
  }
  const pending = [];
  const expired = [];
  for (const r of rows) {
    if (r.kind !== 'click-request' || !r.requestId || resolved.has(r.requestId)) continue;
    const age = now - new Date(r.ts).getTime();
    const ttl = Number(r.ttlMs) || REQUEST_TTL_MS;
    (age > ttl ? expired : pending).push({ ...r, ageMs: age });
  }
  return { pending, expired, total: rows.length };
}

/**
 * awaitClick(slug, requestId, {timeoutMs, pollMs}) — for a CLI that wants to know whether the glass
 * actually pressed the thing. Resolves with the click-done row, or reports a TIMEOUT that names the
 * likely cause, because "the page is not open" is the overwhelmingly common one and guessing at it
 * costs more than saying it.
 */
export async function awaitClick(slug, requestId, { timeoutMs = 30_000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const done = readControls(slug).find((r) => r.kind === 'click-done' && r.requestId === requestId);
    if (done) return { ok: !!done.ok, row: done, error: done.error || null };
    if (Date.now() >= deadline) {
      return {
        ok: false, row: null, timedOut: true,
        error: `no page picked this up within ${Math.round(timeoutMs / 1000)}s — the request is still on the tape. `
          + 'The drain only runs while the cockpit is open; start it (scripts/dev.sh, then /tape) and it will fire on the next poll.',
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
// The door for "code perturbs by clicking". Deliberately thin: everything above is importable, and
// the CLI is only argv parsing, so the guard tests the functions rather than a subprocess.
function argOf(argv, name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}

async function main(argv) {
  const cmd = argv.find((a) => !a.startsWith('--')) || 'help';
  const slug = argOf(argv, 'slug', 'gddadwill');

  if (cmd === 'controls') {
    for (const c of CONTROLS) console.log(`${c.id.padEnd(20)} ${c.label} — ${c.effect}`);
    return 0;
  }
  if (cmd === 'list') {
    const rows = readControls(slug);
    if (!rows.length) { console.log(`[controls] ${slug}: nothing has been clicked on this session yet`); return 0; }
    for (const r of rows.slice(-Number(argOf(argv, 'limit', '20')))) {
      console.log(`${r.ts}  ${String(r.kind).padEnd(14)} ${String(r.control ?? '').padEnd(18)} ${r.source ? `source=${r.source} ` : ''}${r.requestId ?? ''}${r.ok === false ? `  FAILED: ${r.error}` : ''}`);
    }
    const { pending, expired } = pendingClicks(slug);
    console.log(`\n[controls] ${rows.length} rows · ${pending.length} pending · ${expired.length} expired (never fired — past their ttl)`);
    return 0;
  }
  if (cmd === 'click') {
    const control = argOf(argv, 'control');
    let args = null;
    const rawArgs = argOf(argv, 'args');
    if (rawArgs) { try { args = JSON.parse(rawArgs); } catch { console.error(`--args is not JSON: ${rawArgs}`); return 2; } }
    const q = requestClick(slug, { control, args, by: argOf(argv, 'by', 'cli'), note: argOf(argv, 'note') });
    if (!q.ok) { console.error(q.reason); return 2; }
    console.log(`[controls] queued ${control} on ${slug} → ${q.requestId}`);
    const wait = argOf(argv, 'wait');
    if (wait === null) return 0;
    const res = await awaitClick(slug, q.requestId, { timeoutMs: Number(wait) * 1000 || 30_000 });
    if (!res.ok) { console.error(`[controls] ${res.error}`); return 1; }
    console.log(`[controls] the page pressed ${control}`);
    return 0;
  }
  console.log([
    'control-tape.mjs — the buttons on the glass, as tape rows',
    '',
    '  controls                                  what the page exposes',
    '  list    --slug X [--limit N]              the presses, plus what is still queued',
    '  click   --slug X --control fire           queue a press for the open page to perform',
    '          [--args \'{"id":"D-3"}\'] [--wait 30]',
    '',
    'A queued click only fires while the cockpit page is open — it is the page that clicks,',
    'not this script. That is the point: the perturbation travels the same path a human takes.',
  ].join('\n'));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
}
