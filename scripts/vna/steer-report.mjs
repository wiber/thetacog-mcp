// scripts/vna/steer-report.mjs — C254 A REPORT ASK IS ANSWERED BY THE HOST, NEVER SENT TO A CODER (operator 2026-09-24, verbatim:
// *"/steer should be able to run the bash open txt"* · *"build both"*). "bash open a txt file with what you can do" (C251) and "the 5
// most important open questions" (C249) were declared as rows and handed to a qwen worker whose only way to finish is a commit that
// names the row and turns its guard red→green. A write-up has no such commit, so the worker sat 14 minutes at 0 calls and would have
// halted "no commit names C251". Everything such an ask needs is already on the record.
//
// So: isReport() reads the dictation — a write-up word (bash open · a txt · what you can do · questions · list · show me · tell me ·
// summary · report) and NO change word (fix · add · build · wire · package …) — and a REPORT row is answered on the host: composeReport
// writes the txt from the record, the door opens it, and the row is ticked through spec-check (its guard is THIS module's guard,
// committed, so the tick is earned). No model, no worker, no Ollama slot. A CHANGE row goes to the worker exactly as before.
// A bare `help` / `usage` is neither: it prints the usage and declares nothing (C253 — the chair's own `steer.mjs help` became a row
// and a paid-for worker).
//
// LLM-free: every section is read off a script's own output or a file. A section whose source fails says UNMEASURED, never blank.
// Port row: none — composition and transport stay node.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySpec, NEEDS, ACT } from './spec-clarity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const REPORT_GUARD = 'tests/vna/c254-report-asks-run-on-the-host.test.mjs';

const REPORT_RE = /\b(bash[- ]?open|open (?:a|the|me a)? ?(?:txt|text|file)|txt file|text file|what (?:can|do) you|what you can|questions?|list (?:all|the|my|every)|show me|tell me|summar(?:y|ise|ize)|report|write (?:up|out|me)|explain)\b/i;
const CHANGE_RE = /\b(fix|add|build|implement|wire|refactor|rename|port|package|ship|deploy|install|delete|remove|migrate|create (?:a|the)? ?(?:script|test|button|page|row)|make (?:it|the|this) (?:work|run))\b/i;
export const isHelp = (text) => /^\s*(help|usage|\?)\s*$/i.test(String(text || ''));
export function isReport(text) { const t = String(text || ''); return REPORT_RE.test(t) && !CHANGE_RE.test(t); }

// the chat's verbs — the same list the 💬 panel's "What you can type" shows (vna-chat.ts)
export const CHAT_VERBS = [
  'ask anything — the chat model answers from the steer state it is handed (no tools, writes nothing)',
  '/steer <what to finish> — declares it as a spec row, verbatim; a CHANGE goes to a worker, a REPORT is written and opened here',
  '/steer status · plan · next · asks — the loop\'s receipts, no model',
  '/workers — the running workers · /end <n|row|all> — end them',
  '/probe — re-read the engine · /clear — empty the chat',
];

const run = (repo, args) => { try { return { ok: true, out: execFileSync('node', args, { cwd: repo, encoding: 'utf8', timeout: 20000, env: { ...process.env, VNA_ASKS_NO_OPEN: '1' } }) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message || '') }; } };
const git = (repo, args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 10000 }).trim(); } catch { return null; } };

/** the txt, composed from the record: the ask verbatim, what can be typed, what is open, what is waiting on the operator, the workers
 *  and engines, the last commits. Pure given its sources (all injectable), so the guard composes it over a fixture. */
export function composeReport({ text, row, repo = REPO, specText = null, usage = '', engines = null, commits = null, now = new Date() } = {}) {
  const L = [];
  L.push(`${row ? row.id : 'REPORT'} · ${now.toISOString().slice(0, 16).replace('T', ' ')} · composed on the host from the record (no model) · scripts/vna/steer-report.mjs`, '');
  L.push('THE ASK (verbatim)', `  ${String(text).trim()}`, '');
  L.push('WHAT YOU CAN TYPE IN THE 💬 CHAT', ...CHAT_VERBS.map((v) => `  · ${v}`), '');
  if (usage) L.push('THE /steer DOOR FROM A TERMINAL', ...usage.trim().split('\n').map((l) => `  ${l.trim()}`), '');
  let c = null; try { c = classifySpec(specText != null ? specText : readFileSync(resolve(repo, 'docs/specs/vna/SPEC-VNA-COCKPIT.md'), 'utf8')); } catch (e) { L.push(`WHAT IS OPEN — UNMEASURED (${String(e.message || e).slice(0, 120)})`, ''); }
  if (c) {
    L.push(`WHAT IS OPEN — ${c.counts.open} rows · ${c.counts.clear} ready for a worker · ${c.counts.needs} need your answer · ${c.counts.act} are your acts${c.withdrawn ? ` · ${c.withdrawn} withdrawn (kept, not open)` : ''}`);
    const needs = c.rows.filter((r) => r.class === NEEDS); const acts = c.rows.filter((r) => r.class === ACT);
    L.push('', 'QUESTIONS THAT NEED YOUR ANSWER', ...(needs.length ? needs.map((r, i) => `  Q${i + 1}. ${r.id} — ${r.missing.join('; ')} · ${r.headline}`) : ['  (none)']));
    L.push('', 'YOUR ACTS (never dispatched)', ...(acts.length ? acts.map((r) => `  · ${r.id} — ${r.missing.join('; ')} · ${r.headline}`) : ['  (none)']), '');
  }
  L.push('WORKERS AND ENGINES', ...(engines != null ? String(engines).trim().split('\n').map((l) => `  ${l}`) : ['  UNMEASURED — workers.mjs engines did not answer']), '');
  L.push('LAST COMMITS', ...(commits ? commits.split('\n').map((l) => `  ${l}`) : ['  UNMEASURED — git log did not answer']));
  return L.join('\n') + '\n';
}

/** write it under docs/specs/vna/asks/, never overwriting (a same-day second report gets -2, -3 …), and open it unless told not to */
export function writeReport({ text, row, repo = REPO, dir = process.env.VNA_ASKS_DIR || resolve(REPO, 'docs/specs/vna/asks'), open = process.env.VNA_ASKS_NO_OPEN !== '1' } = {}) {
  const usage = run(repo, [resolve(HERE, 'steer.mjs'), '--help']);
  // the two roles' models, off the one resolver (the chat's pick lives in the IDE; the resolver's chat role is its default)
  let roles = {}; try { const st = JSON.parse(run(repo, [resolve(HERE, 'runner-resolver.mjs'), 'status', '--json']).out); roles = { chat: (st.localRoles || {}).chat, sub: st.subagentModel || (st.localRoles || {}).subagent }; } catch {}
  const eng = run(repo, [resolve(HERE, 'workers.mjs'), 'engines', ...(roles.chat ? ['--chat', roles.chat] : []), ...(roles.sub ? ['--sub', roles.sub] : [])]);
  const txt = composeReport({ text, row, repo, usage: usage.ok ? usage.out : '', engines: eng.ok ? eng.out : null, commits: git(repo, ['log', '-10', '--format=%h %ad %s', '--date=format:%m-%d %H:%M']) });
  mkdirSync(dir, { recursive: true });
  const stem = `${new Date().toISOString().slice(0, 10)}-${row ? row.id : 'report'}-report`;
  let path = resolve(dir, `${stem}.txt`); for (let k = 2; existsSync(path); k++) path = resolve(dir, `${stem}-${k}.txt`);
  writeFileSync(path, txt);
  let opened = false; if (open && process.platform === 'darwin') { try { execFileSync('open', [path]); opened = true; } catch {} }
  return { path, opened, bytes: txt.length };
}
