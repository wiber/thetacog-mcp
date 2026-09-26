#!/usr/bin/env node
// scripts/vna/goal.mjs — THE /goal DOOR (operator 2026-09-18: "add a copy of the /goal to the panel basically saying finish
// the spec in 5–10 turns and report what was built and what is left, keep context lean"). A goal typed in chat dies at the
// next /clear; a goal on the record survives every clear and is printed on every turn. data/vna/goal.json holds the text,
// the work units (each a list of spec labels), the turn budget and the HEAD at set time. `status` derives everything else
// from the record: turns used = commits since HEAD-at-set; a unit is DONE when every label it names is ticked in the spec
// or GUARDED/MEASURED in the borne-out column; the current unit is the first not done, and its first open label is written
// to .thetacog/vna-active-leaf.json — C57's override — so the snowball anchors there after a clear. Nothing here is a
// verdict: a unit closes only through a commit that ticks its rows with a guard; this file only says which unit is next.
//   node scripts/vna/goal.mjs set --text "…" --unit "C49" --unit "C58 C62" … [--turns 5-10] [--source <steergoal goal.txt>]
//   node scripts/vna/goal.mjs status [--json]      node scripts/vna/goal.mjs clear
//   node scripts/vna/goal.mjs close [--json]        (C91a: the goal row on the tape — a no-op until every unit is closed)
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { lastRowWhere } from './ndjson-tail.mjs';   // the newest matching row from the tail (2026-09-20)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { append as tapeAppend, FLIGHT, GAUGE as CLEAR_GAUGE } from './flight-tape.mjs';
import { LEDGER as CLEAR_LEDGER, clearDecision } from './clear-gauge.mjs';
import { validate as gateValidate, report as gateReport } from './goal-validate.mjs';   // C81c's gate — the queue's only door in (C91d)
import { roomFromTerminal } from '../../src/lib/pmu/room-key.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const GOAL = process.env.VNA_GOAL || resolve(REPO, 'data/vna/goal.json');
export const ACTIVE_LEAF = process.env.VNA_ACTIVE_LEAF || resolve(REPO, '.thetacog/vna-active-leaf.json');
export const SENT_LOG = process.env.VNA_SENT_LOG || resolve(REPO, '.thetacog/email-sent.ndjson');   // C91c: the send receipt the eviction reads
const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
const ROW_RE = /^\s*- \[( |x)\] ((?:C\d+[a-z]?|T\d+))\b/;

export function readGoal(path = GOAL) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function specTicks(md) { const t = {}; for (const l of String(md || '').split('\n')) { const m = ROW_RE.exec(l); if (m) t[m[2]] = m[1] === 'x'; } return t; }
const gitHead = (repo) => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
const commitsSince = (repo, sha) => { try { return execFileSync('git', ['rev-list', '--no-merges', `${sha}..HEAD`, '--format=%h %s', '--no-walk=unsorted'].filter((a) => a !== '--no-walk=unsorted'), { cwd: repo, encoding: 'utf8' }).split('\n').filter((l) => l && !l.startsWith('commit ')); } catch { return []; } };

export function setGoal({ text, units, turns = [5, 10], repo = REPO, path = GOAL, by = process.env.VNA_BY || 'cli', at = new Date().toISOString(), source = null }) {
  const g = { text: String(text || '').trim(), units: units.map((u, i) => ({ n: i + 1, title: u.title || u.labels.join(' '), labels: u.labels })), turns: { min: turns[0], max: turns[1] }, setAt: at, by, headAt: gitHead(repo), source };   // source: the goal file's path on the record (C91d install) — the goal number is read off it, never off the prose
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(g, null, 1) + '\n');
  return g;
}
export function pinnedByDispatch(path = ACTIVE_LEAF) { try { return JSON.parse(readFileSync(path, 'utf8')).by === 'steer-runner'; } catch { return false; } }   // C202
// the row a dispatch pinned (leaf-<label>.json, by: 'steer-runner'), or null — the label the GOAL line must defer to
export function pinnedLeafLabel(path = ACTIVE_LEAF) { try { const j = JSON.parse(readFileSync(path, 'utf8')); return j.by === 'steer-runner' && j.label ? String(j.label) : null; } catch { return null; } }
export function goalStatus({ path = GOAL, repo = REPO, md = null, activeLeafPath = ACTIVE_LEAF, write = true } = {}) {
  const g = readGoal(path); if (!g) return null;
  const spec = md != null ? md : (() => { try { return readFileSync(SPEC_MD, 'utf8'); } catch { return ''; } })();
  const ticks = specTicks(spec);
  const commits = g.headAt ? commitsSince(repo, g.headAt) : [];
  // a chore(commit-page) publish is the page's follow-up to a real commit, never a turn of work
  const work = commits.filter((c) => !/ chore\(commit-page\):/.test(c));
  const units = g.units.map((u) => { const open = u.labels.filter((l) => ticks[l] === false); const unknown = u.labels.filter((l) => !(l in ticks)); const named = work.filter((c) => u.labels.some((l) => new RegExp(`\\b${l}\\b`).test(c))); return { ...u, open, unknown, done: open.length === 0 && unknown.length === 0, commits: named.map((c) => c.slice(0, 10)) }; });
  const current = units.find((u) => !u.done) || null;
  const turnsUsed = work.length;
  const s = { text: g.text, setAt: g.setAt, headAt: g.headAt, turns: { ...g.turns, used: turnsUsed, over: turnsUsed > g.turns.max }, units, current, done: units.filter((u) => u.done).length, left: units.filter((u) => !u.done).length, commits: work.map((c) => c.slice(0, 10)) };
  // C202: a leaf pinned by a dispatch (steer-runner.mjs leafPin, by: 'steer-runner') is the worker's own row — the goal's current
  // unit never overwrites it and never unlinks it; three workers on three rows were all re-aimed at unit 2/3 before this (2026-09-23)
  const pinned = pinnedByDispatch(activeLeafPath);
  s.pinnedLeaf = pinned ? pinnedLeafLabel(activeLeafPath) : null;   // the GOAL line reads it: a dispatched worker's task is its row, never the goal's state
  if (write && current && !pinned) { const label = current.open[0] || current.labels[0]; try { mkdirSync(dirname(activeLeafPath), { recursive: true }); writeFileSync(activeLeafPath, JSON.stringify({ label, at: new Date().toISOString(), by: 'goal', note: `goal unit ${current.n}/${units.length}: ${current.title}` }) + '\n'); } catch {} }
  if (write && !current && !pinned) { try { if (existsSync(activeLeafPath)) unlinkSync(activeLeafPath); } catch {} }
  return s;
}
// A DISPATCHED WORKER'S GOAL LINE NAMES ITS ROW (2026-09-23 14:36Z, runner.ndjson): the worker dispatched on the flying-sentence row
// read "every unit closed — report" here, took "report" as the order, spent 17 turns and $3.92 tidying another row's aftermath, and
// halted "the commit … does not name <row>". C202 pinned the leaf but this line still narrated the closed /goal as the task. When
// the leaf is pinned by steer-runner the line says the row is the contract and the /goal's state is context — never an order.
export function goalLine(s) {
  if (!s) return null;
  const cur = s.current ? `unit ${s.current.n}/${s.units.length} "${s.current.title}" (${s.current.labels.join(' ')}${s.current.open.length ? ` · open ${s.current.open.join(' ')}` : ''})` : 'every unit closed — report';
  if (s.pinnedLeaf) return `⟦ GOAL ⟧ this turn's contract is the dispatched row ${s.pinnedLeaf} (leaf pinned by steer-runner) — build it and nothing else · the /goal on the record is context, not the task: ${s.current ? `unit ${s.current.n}/${s.units.length} open` : 'every unit closed'} · done ${s.done} · left ${s.left}`;
  return `⟦ GOAL ⟧ turn ${s.turns.used + 1} of ${s.turns.min}–${s.turns.max}${s.turns.over ? ' — OVER BUDGET' : ''} · ${cur} · done ${s.done} · left ${s.left} · ${s.text.slice(0, 90)}${s.text.length > 90 ? '…' : ''}`;
}
// C68 THE COPY — what the developer (or a fresh Claude) reads the ORDER OF EXECUTION off: the goal text, every unit in order
// with its labels, tick state and DONE / NEXT / OPEN, then the one command that runs the units left headless, and the chat
// route (the hook seeds the same leaf either way). A read-out of the record, never mass: the extension stamps it on the way out.
export function goalCopy(s) {
  if (!s) return 'no /goal on the record — node scripts/vna/goal.mjs set …';
  const state = (u) => (u.done ? 'DONE' : s.current && u.n === s.current.n ? 'NEXT' : 'OPEN');
  const lines = [`GOAL — ${s.text}`, `turn ${s.turns.used + 1} of ${s.turns.min}–${s.turns.max}${s.turns.over ? ' — OVER BUDGET' : ''} · set ${s.setAt} at HEAD ${String(s.headAt || '').slice(0, 10)} · ${s.done} done · ${s.left} left`, '', 'EXECUTION ORDER — one unit per dispatch, top to bottom; a unit closes only when every label is ticked in the spec by a commit with a guard:'];
  for (const u of s.units) lines.push(`  ${u.n}. ${state(u).padEnd(4)} ${u.title} · ${u.labels.map((l) => `${l} ${u.open.includes(l) ? '☐' : '☑'}`).join(' ')}`);
  lines.push('', 'RUN IT HEADLESS (one ephemeral worker per unit, fail-closed gates, nothing leaks back):', `  node scripts/vna/steer-runner.mjs --max-units ${s.left}`, '', 'OR IN CHAT: type "continue" — the steer hook seeds the same next leaf from the record (C57); one unit, one commit, then /clear.');
  return lines.join('\n');
}
// C91a THE GOAL ROW ON THE TAPE — the orchestrator dies with the goal. When goalStatus() reads every unit closed (every label
// ticked in the spec; an unknown label is OPEN, never closed), append ONE `goal` row through the tape's one door: sha =
// sha256 of goal.json's bytes (the content address of the goal, the way a reading's sha is the policy's bytes), the signed
// proofs carry what the report (C91b) is derived from — the text, each unit with its labels and the commits that named
// them, turns_used, head_at / head_close, context_bytes READ off the clear gauge's ledger (the newest row whose session is
// this one; the live gauge file when the session has not ended yet; otherwise null and the source says UNMEASURED — never
// 0), and report_resend_id null until C91b writes it. A second call for the same goal_sha returns the row already on the
// tape and appends nothing; a unit still open appends nothing and names the label. Nothing here decides the eviction —
// C91c reads this row as one of its three receipts.
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
export function contextBytesFor({ session, ledger = CLEAR_LEDGER, gauge = CLEAR_GAUGE } = {}) {
  if (!session) return { context_bytes: null, context_bytes_source: 'UNMEASURED' };
  const mine = nd(ledger).filter((r) => r.session === session && Number.isFinite(r.contextBytes));
  if (mine.length) return { context_bytes: mine[mine.length - 1].contextBytes, context_bytes_source: 'ledger' };
  try { const g = JSON.parse(readFileSync(gauge, 'utf8')); if (g.session === session && Number.isFinite(g.contextBytes)) return { context_bytes: g.contextBytes, context_bytes_source: 'gauge' }; } catch {}
  return { context_bytes: null, context_bytes_source: 'UNMEASURED' };
}
export function goalClose({ path = GOAL, repo = REPO, md = null, tape = FLIGHT, ledger = CLEAR_LEDGER, gauge = CLEAR_GAUGE, activeLeafPath = ACTIVE_LEAF, session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null, room = null, ts = new Date().toISOString() } = {}) {
  let bytes; try { bytes = readFileSync(path); } catch { return { closed: false, row: null, reason: 'no goal on the record — nothing to close' }; }
  const goal_sha = createHash('sha256').update(bytes).digest('hex');
  const existing = nd(tape).filter((r) => r.kind === 'goal' && r.sha === goal_sha).pop();
  if (existing) return { closed: true, existing: true, row: existing, reason: `goal ${goal_sha.slice(0, 12)} already closed at seq ${existing.seq}` };
  const s = goalStatus({ path, repo, md, activeLeafPath, write: false });
  if (!s) return { closed: false, row: null, reason: 'no goal on the record — nothing to close' };
  if (s.current) { const u = s.current; const open = [...u.open, ...u.unknown.map((l) => `${l} (not in the spec)`)]; return { closed: false, row: null, reason: `unit ${u.n}/${s.units.length} "${u.title}" still open: ${open.join(' ')}` }; }
  const cb = contextBytesFor({ session, ledger, gauge });
  let source = null; try { source = JSON.parse(readFileSync(path, 'utf8')).source ?? null; } catch {}   // the goal file's path, when the install carried it
  const proofs = { goal_sha, source, text: s.text, units: s.units.map((u) => ({ n: u.n, title: u.title, labels: u.labels, commits: u.commits })), turns_used: s.turns.used, turns: { min: s.turns.min, max: s.turns.max }, head_at: s.headAt, head_close: gitHead(repo), ...cb, report_resend_id: null };
  const row = tapeAppend({ kind: 'goal', sha: goal_sha, session, room, proofs, delta: { status: `closed — ${s.units.length} of ${s.units.length} units ticked in the spec` }, seed: { set_at: s.setAt }, ts }, tape);
  return { closed: true, existing: false, row, reason: null };
}
// C91b THE ONE AMENDMENT DOOR — the closed row is signed and chained, so a field on it can never be rewritten (verifyRow would
// fail on the flipped byte; that is the point of the signature). The report's resendId lands as an APPENDED `goal` row for
// the same goal_sha: the closed row's proofs copied through, `report_resend_id` set, `amends` naming the row_sha it amends;
// the newest row for a goal_sha is the goal's current state (goalClose's existing-lookup and goalRowFor both read the
// newest). Idempotent: a row already carrying that id appends nothing. Nothing else on the tape is ever amended this way —
// the id is the one field C91a declared null-until-C91b.
export function goalAmend({ tape = FLIGHT, goal_sha, report_resend_id, room = null, session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null, ts = new Date().toISOString() } = {}) {
  const cur = nd(tape).filter((r) => r.kind === 'goal' && r.sha === goal_sha).pop();
  if (!cur) return { amended: false, row: null, reason: `no goal row on the tape for goal ${String(goal_sha).slice(0, 12)} — close it first` };
  if (!report_resend_id) return { amended: false, row: cur, reason: 'no report_resend_id to write' };
  if (cur.proofs && cur.proofs.report_resend_id === report_resend_id) return { amended: false, row: cur, reason: `goal ${goal_sha.slice(0, 12)} already carries report_resend_id ${report_resend_id} at seq ${cur.seq}` };
  const proofs = { ...cur.proofs, report_resend_id, amends: cur.row_sha };
  const row = tapeAppend({ kind: 'goal', sha: goal_sha, session, room, proofs, delta: { status: `amended — report_resend_id ${report_resend_id} written; amends seq ${cur.seq}` }, seed: cur.seed || null, ts }, tape);
  return { amended: true, row, reason: null };
}
// the newest goal row for the goal file's OWN bytes — a goal edited after its close has a new sha and no row (C91b; here since C91c reads it too)
export function goalRowFor({ goalPath = GOAL, tape = FLIGHT } = {}) {
  let bytes; try { bytes = readFileSync(goalPath); } catch { return null; }
  const sha = createHash('sha256').update(bytes).digest('hex');
  return lastRowWhere(tape, (r) => r.kind === 'goal' && r.sha === sha, { hint: sha });   // newest first hit from the tail, never the whole tape (2026-09-20)
}
// C91c THE EVICTION, read off disk: the goal row (C91a), the send log (C91b's receipt), the gauge receipt (C51) → clearDecision,
// and the verdict is WRITTEN beside the gauge receipt so the extension reads a file and computes nothing. The hook calls this
// right after it writes the gauge, every turn; the decision therefore carries the gauge state the hook just measured.
export function clearDecisionFor({ goalPath = GOAL, tape = FLIGHT, sentLog = SENT_LOG, gaugePath = CLEAR_GAUGE, gauge = null, decisionPath = null, at = new Date().toISOString() } = {}) {
  let g = gauge; if (!g) { try { g = JSON.parse(readFileSync(gaugePath, 'utf8')); } catch { g = null; } }
  // the send log is 32 MB (2026-09-20) and was parsed whole here on EVERY tool call of every session — 1.5 s of a 5 s hook — to answer
  // whether one resendId is on it; now a lookup the decision calls only when a goal row names a report, searched from the tail
  const d = clearDecision({ goal: goalRowFor({ goalPath, tape }), sent: (id) => !!lastRowWhere(sentLog, (r) => String(r.resendId) === id, { hint: id }), gauge: g });
  const out = decisionPath || resolve(dirname(gaugePath), 'vna-clear-decision.json');
  const row = { at, ...d, gauge_state: g && g.state ? g.state : null, session: g && g.session ? g.session : null };
  try { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(row) + '\n'); } catch {}
  // C91f: the JSON receipt is last-writer-wins — the next session's hook overwrites CLEAR with HOLD the moment the next goal
  // installs. A CLEAR is appended ONCE per goal_sha to the sibling ndjson so the eviction stays readable after it happened
  // (AXIOM 1 W2: the falsifier reads a retained record, not the actor's current line).
  if (d.verdict === 'CLEAR') { const log = out.replace(/\.json$/, '.ndjson'); if (!nd(log).some((r) => r.verdict === 'CLEAR' && r.goal_sha === d.goal_sha)) { try { appendFileSync(log, JSON.stringify(row) + '\n'); } catch {} } }
  return row;
}
export function clearGoal({ path = GOAL, activeLeafPath = ACTIVE_LEAF } = {}) { for (const p of [path, activeLeafPath]) { try { if (existsSync(p)) unlinkSync(p); } catch {} } return { cleared: true }; }

// C91d THE NEXT GOAL FROM THE TREE — chat never sets the goal after an eviction; the queue does. data/vna/goal-queue.ndjson is a
// SEQUENCE: `queued` rows (seq · path · sha of the fixture bytes · the gate's units and turns) appended only when C81c's gate
// accepts, and `installed` rows naming the seq they consumed. The head is the first queued seq with no installed row. `goalNext`
// installs the head only when the goal on the record is CLOSED (a goal row on the tape for goal.json's own bytes, C91a) or
// there is no goal; an open goal installs nothing. The gate runs AGAIN at install time against the live tree — a label ticked
// since the fixture was queued is BASIN_CLOSED now — and a refused head STAYS the head (W5: a gap in a sequence is a
// displacement; the next valid row is never skipped to; fix the fixture and the same seq installs). The install is setGoal —
// a FRESH headAt, so turns count from the install and never from the goal that closed — then the active leaf (C57) through
// goalStatus. The steer hook calls this on the first prompt turn of a session, the turn after a /clear.
export const QUEUE = process.env.VNA_GOAL_QUEUE || resolve(REPO, 'data/vna/goal-queue.ndjson');
export const NEXT_RECEIPT = process.env.VNA_GOAL_NEXT || resolve(REPO, '.thetacog/vna-goal-next.json');
export const NO_HEAD = 'no goal queued — the tree is the only source';
const relTo = (repo, p) => { const a = resolve(p); const r = resolve(repo) + '/'; return a.startsWith(r) ? a.slice(r.length) : a; };
export function queueHead({ queue = QUEUE } = {}) {
  const rows = nd(queue); const done = new Set(rows.filter((r) => r.kind === 'installed').map((r) => r.seq));
  return rows.find((r) => r.kind === 'queued' && !done.has(r.seq)) || null;
}
export function queueGoal({ path, queue = QUEUE, repo = REPO, treePath = undefined, by = process.env.VNA_BY || 'cli', at = new Date().toISOString() } = {}) {
  let md; try { md = readFileSync(resolve(repo, path)); } catch { return { queued: false, row: null, verdict: null, report: `REJECTED · ${path} is not on disk` }; }
  const v = gateValidate(md.toString('utf8'), { repo, ...(treePath ? { treePath } : {}) });
  if (!v.ok) return { queued: false, row: null, verdict: v, report: gateReport(v) };
  const seq = nd(queue).filter((r) => r.kind === 'queued').length + 1;
  const row = { kind: 'queued', seq, at, by, path: relTo(repo, resolve(repo, path)), sha: createHash('sha256').update(md).digest('hex'), text: v.text, labels: v.units.map((u) => u.labels), turns: v.turns };
  mkdirSync(dirname(queue), { recursive: true }); appendFileSync(queue, JSON.stringify(row) + '\n');
  return { queued: true, row, verdict: v, report: gateReport(v) };
}
export function goalNext({ goalPath = GOAL, queue = QUEUE, tape = FLIGHT, repo = REPO, treePath = undefined, activeLeafPath = ACTIVE_LEAF, md = null, receiptPath = NEXT_RECEIPT, session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null, by = process.env.VNA_BY || 'cli', at = new Date().toISOString() } = {}) {
  const receipt = (r) => { try { mkdirSync(dirname(receiptPath), { recursive: true }); writeFileSync(receiptPath, JSON.stringify({ at, session, by, ...r }) + '\n'); } catch {} return r; };
  const cur = readGoal(goalPath); const curRow = cur ? goalRowFor({ goalPath, tape }) : null;
  if (cur && !curRow) return receipt({ installed: false, state: 'open', reason: `a goal is open on the record — "${String(cur.text).slice(0, 60)}" has no closed row on the tape; nothing installed`, line: null });
  const head = queueHead({ queue });
  if (!head) return receipt({ installed: false, state: 'empty', reason: NO_HEAD, line: null });
  let bytes; try { bytes = readFileSync(resolve(repo, head.path)); } catch { const rep = `REJECTED · seq ${head.seq} names ${head.path} — not on disk`; return receipt({ installed: false, state: 'refused', head, report: rep, reason: rep, line: `⟦ NEXT GOAL ⟧ refused seq ${head.seq} (${head.path}) · not on disk — the queue is a sequence, nothing skipped` }); }
  const v = gateValidate(bytes.toString('utf8'), { repo, ...(treePath ? { treePath } : {}) });
  if (!v.ok) { const rules = [...new Set(v.errors.map((e) => e.rule))].join(' '); return receipt({ installed: false, state: 'refused', head, verdict: v, report: gateReport(v), reason: `seq ${head.seq} refused by the gate: ${rules}`, line: `⟦ NEXT GOAL ⟧ refused seq ${head.seq} (${head.path}) · ${rules} — the queue is a sequence, nothing skipped` }); }
  const prev_goal_sha = curRow ? curRow.sha : null;
  const g = setGoal({ text: v.text, units: v.units.map((u) => ({ labels: u.labels, title: u.title })), turns: [v.turns.min, v.turns.max], repo, path: goalPath, by, at, source: head.path });
  const goal_sha = createHash('sha256').update(readFileSync(goalPath)).digest('hex');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const row = { kind: 'installed', seq: head.seq, at, by, session, path: head.path, sha, edited_since_queued: sha !== head.sha, goal_sha, prev_goal_sha, head_at: g.headAt, units: g.units.length, turns: g.turns };
  appendFileSync(queue, JSON.stringify(row) + '\n');
  const status = goalStatus({ path: goalPath, repo, md, activeLeafPath });
  return receipt({ installed: true, state: 'installed', head, row, goal: g, status, prev_goal_sha, reason: null, line: `⟦ NEXT GOAL ⟧ installed seq ${head.seq} · ${g.text.slice(0, 80)} · ${g.units.length} units · turns ${g.turns.min}–${g.turns.max} · head ${String(g.headAt).slice(0, 10)}${prev_goal_sha ? ` · after goal ${prev_goal_sha.slice(0, 12)}` : ''}` });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const cmd = argv[0]; const asJson = argv.includes('--json');
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (cmd === 'set') {
    const units = []; for (let i = 0; i < argv.length; i++) if (argv[i] === '--unit') { const [labels, ...title] = argv[i + 1].split('::'); units.push({ labels: labels.trim().split(/\s+/), title: title.join('::').trim() || undefined }); }
    const tr = (arg('--turns') || '5-10').split('-').map(Number);
    const g = setGoal({ text: arg('--text') || '', units, turns: tr, source: arg('--source') || null });   // C294: --source names the /steergoal file the goal was set from; /steer's close line reads it (C295)
    const s = goalStatus(); console.log(asJson ? JSON.stringify(s) : `goal set · ${g.units.length} units · turns ${g.turns.min}–${g.turns.max} · head ${String(g.headAt).slice(0, 10)}\n${goalLine(s)}`); process.exit(0);
  }
  if (cmd === 'import') {   // C81c: an external model's /goal passes the ingest gate before anything is written
    const { validate, report } = await import('./goal-validate.mjs');
    const src = arg('--validate') || argv[2]; if (!src) { console.error('node scripts/vna/goal.mjs import --validate <path|-> [--install] [--json]'); process.exit(2); }
    const md = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8');
    const v = validate(md, {});
    if (asJson) console.log(JSON.stringify(v)); else console.log(report(v));
    if (!v.ok) process.exit(2);
    if (argv.includes('--install')) { const g = setGoal({ text: v.text, units: v.units.map((u) => ({ labels: u.labels, title: u.title })), turns: [v.turns.min, v.turns.max] }); const s = goalStatus(); console.log(`goal set · ${g.units.length} units · turns ${g.turns.min}–${g.turns.max} · head ${String(g.headAt).slice(0, 10)}\n${goalLine(s)}`); }
    process.exit(0);
  }
  if (cmd === 'queue') {   // C91d: a fixture onto the sequence, only through the gate
    const src = argv[1]; if (!src || src.startsWith('--')) { console.error('node scripts/vna/goal.mjs queue <path> [--json]'); process.exit(2); }
    const r = queueGoal({ path: src });
    if (asJson) console.log(JSON.stringify(r)); else console.log(r.queued ? `queued seq ${r.row.seq} · ${r.row.path} · ${r.row.labels.length} units · turns ${r.row.turns.min}–${r.row.turns.max} · ${r.row.sha.slice(0, 12)}` : r.report);
    process.exit(r.queued ? 0 : 2);
  }
  if (cmd === 'next') {   // C91d: install the head when the goal on the record is closed or absent; the hook calls the same function on the first turn after a clear
    const r = goalNext({});
    if (asJson) console.log(JSON.stringify(r)); else console.log(r.line || r.reason + (r.report ? '\n' + r.report : ''));
    process.exit(r.installed ? 0 : 1);
  }
  if (cmd === 'clear') { console.log(JSON.stringify(clearGoal())); process.exit(0); }
  if (cmd === 'close') {
    const r = goalClose({ room: roomFromTerminal() || null });
    if (asJson) console.log(JSON.stringify(r)); else console.log(r.closed ? `goal row #${r.row.seq} ${r.existing ? '(already on the tape)' : 'appended'} · ${r.row.sha.slice(0, 12)} · turns ${r.row.proofs.turns_used} · context ${r.row.proofs.context_bytes ?? 'UNMEASURED'} · ${r.row.sig ? 'signed' : 'unsigned: ' + r.row.sig_why}` : `not closed — ${r.reason}`);
    process.exit(r.closed ? 0 : 1);
  }
  if (cmd === 'copy') { console.log(goalCopy(goalStatus({ write: false }))); process.exit(0); }
  const s = goalStatus(); if (!s) { console.log('no goal set — node scripts/vna/goal.mjs set --text "…" --unit "C49::Close C49" …'); process.exit(0); }
  if (asJson) console.log(JSON.stringify(s)); else { console.log(goalLine(s)); for (const u of s.units) console.log(`  ${u.done ? '[x]' : u === s.current ? '[>]' : '[ ]'} ${u.n}. ${u.title} — ${u.labels.join(' ')}${u.open.length ? ` · open ${u.open.join(' ')}` : ''}${u.commits.length ? ` · commits ${u.commits.join(', ')}` : ''}`); }
}
