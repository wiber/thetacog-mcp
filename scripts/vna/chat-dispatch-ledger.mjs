// scripts/vna/chat-dispatch-ledger.mjs — C559 TWO CHAIRS NEVER BRIEF THE SAME ROW (2026-10-02).
// Operator, verbatim: "check the /steer subagents context caps to make sure we are running them correctly and efficientl..".
// Measured that turn: two chat sessions ran the same goal on one tree; the chat door (`steer.mjs brief`) took no lock and wrote
// no row, so each chair dispatched C544 · C545 · C548 and the second chair's three workers spent ~330k tokens to commit nothing
// (`steer-lock.mjs status` read "free — no loop running" the whole time — the lock covers `until`, never the chat door).
// Now every brief appends one row here (label · session · head · at), and a row another session briefed inside the hold window
// prints HELD instead of a brief. Append-only: a release is never an erase — the window lapses, or `--take` appends a new row
// that names whom it took from. Sufficient for: "has another chair already sent a worker at this row, recently?" Not
// sufficient for: whether that worker will land it (the verify door answers that, after).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEDGER_PATH = resolve(REPO, '.thetacog/chat-dispatch.ndjson');
export const HOLD_MS = 45 * 60 * 1000;   // a chat worker that has not landed in 45 min is past the measured C548/C545 run (~2–4 min) by an order of magnitude

export function sessionId(env = process.env) { return env.CLAUDE_CODE_SESSION_ID || `pid-${process.ppid}`; }

export function readRows(ledgerPath = LEDGER_PATH) {
  if (!existsSync(ledgerPath)) return [];
  const out = [];
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ } }
  return out;
}

/** The newest brief of `label` by a session other than `session`, inside the hold window — or null. */
export function holdFor({ label, session, now = Date.now(), holdMs = HOLD_MS, ledgerPath = LEDGER_PATH, rows = null } = {}) {
  const all = (rows || readRows(ledgerPath)).filter((r) => r.label === label);
  const last = all[all.length - 1];
  if (!last || last.session === session) return null;
  const age = now - Date.parse(last.at);
  return Number.isFinite(age) && age >= 0 && age < holdMs ? { by: last.session, at: last.at, head: last.head || null, age_min: Math.round(age / 60000) } : null;
}

export function recordBrief({ label, session, head = null, at = new Date().toISOString(), took_from = null, ledgerPath = LEDGER_PATH } = {}) {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const row = { kind: 'chat-brief', label, session, head, at, ...(took_from ? { took_from } : {}) };
  appendFileSync(ledgerPath, JSON.stringify(row) + '\n');
  return row;
}

export function heldLine(label, h) { return `HELD ${label}: briefed by session ${h.by} ${h.age_min} min ago (head ${h.head || '?'}) — another chair has a worker on it; verify it with steer.mjs verify ${label} --since ${h.head || '<head>'}, or re-brief with --take`; }
