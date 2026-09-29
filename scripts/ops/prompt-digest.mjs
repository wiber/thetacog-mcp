#!/usr/bin/env node
// scripts/ops/prompt-digest.mjs
//
// Daily "what did I ask Claude / what did it answer" digest. Scans the Claude Code
// session transcripts (~/.claude/projects/<project>/*.jsonl) for the last 24h, extracts
// each HUMAN typed prompt + the FINAL Claude text reply for that turn, scrubs the
// hook/receipt/system noise, writes a plain .txt, and emails it to the operator as an
// attachment via the canonical email-artifact.mjs sink.
//
// This is OPERATIONAL telemetry to self (like push-digest / calendar-primer / next-briefing) —
// a raw log dump, NOT graded human-facing prose, so it deliberately does NOT route through the
// 6-needs qwen-graded comms pipeline. It sends via email-artifact.mjs directly (same family).
//
// Run from chat / on demand:
//   node scripts/ops/prompt-digest.mjs                 # write + email (last 24h)
//   node scripts/ops/prompt-digest.mjs --dry           # write the .txt only, print path, no email
//   node scripts/ops/prompt-digest.mjs --hours 48      # widen the window
//   node scripts/ops/prompt-digest.mjs --hours 6,24,72 # THREE windows, ONE email, three .txt attached
//
// Scheduled at 18:30 daily by launchd (com.thetacog.prompt-digest.plist) and every 6h by
// com.thetacog.prompt-digest-6h.plist, which fires the 6,24,72 triple (operator 2026-07-28:
// "include 6, 24, and 72 hrs of this instead of the 6") — a 6h window loses the thread a
// long-running piece of work leaves across a day/weekend; the wider windows carry it.

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ── QUIET GATE · ADMISSION (2026-09-16) ────────────────────────────────────────────────────────
// This job reaches a local model. The gate's EVICTION half (quiet-gate-enforce.sh, on the 60s
// pulse) hands the GPU back, but it loses the race against a timer that reloads the model a second
// later — measured: qwen2.5:7b resident at 4.9 GB / 100% GPU while the gate read ACTIVE with 0 of
// 45 idle minutes elapsed. Eviction alone is a mop under a running tap, so a SCHEDULED job that
// reaches a model asks admission first.
//
// WHY A CHILD PROCESS AND NOT AN IMPORT — measured, not preferred. quiet-gate.mjs imports
// lastHumanAt from session-idle.mjs, which imports extractTurns from THIS file. A dynamic import
// inside a top-level await closes that cycle and Node exits 13 (ERR_UNSETTLED_TOP_LEVEL_AWAIT)
// SILENTLY — no stack, no message, and launchd would have read a silent 13 as a job that ran. The
// first version of this preamble did exactly that and was caught by running it. A child process has
// no module graph to close.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    execFileSync('node', [resolve(REPO, 'scripts/ops/quiet-gate.mjs'), '--check'], { stdio: 'ignore', timeout: 30000 });
  } catch (e) {
    if (e?.status === 75) {
      console.error('quiet-gate: session ACTIVE — deferring prompt-digest to the quiet period');
      process.exit(75);   // EX_TEMPFAIL: not now, next tick. The work is idempotent.
    }
    /* any other failure is the gate being unreadable, and an unreadable gate must not block work */
  }
}
const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; };

export const PROJECT_DIR = process.env.CC_PROJECT_DIR
  || join(os.homedir(), '.claude', 'projects', '-Users-thetacoach-GitHub-thetadrivencoach');

// ── scrub: strip the harness/hook/receipt noise so a human prompt or a Claude reply reads clean.
// The transcript embeds: <system-reminder> blocks, <local-command-*> / <command-*> slash-command
// wrappers, the UserPromptSubmit hook's injected PMU-lens receipt directive (⟦ MANDATORY … ⟧ +
// the ─── 🛰️ PMU Lens … ──── block), and Claude's echoed receipt at the top of every reply.
// None of that is what the operator typed or the substance Claude answered — cut it.
export function scrub(text) {
  if (!text) return '';
  let t = String(text);
  // everything the UserPromptSubmit hook appended (receipt directive) lives after this marker
  t = t.replace(/\n?UserPromptSubmit hook additional context:[\s\S]*$/g, '');
  // system reminders + tool/command wrappers
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  t = t.replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, '');
  t = t.replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g, '');
  // harness-injected turns that are NOT anything the operator typed: a background task
  // finishing, or the transcript of a ! bash line. MEASURED 2026-07-28: 70 of 586 turns in a
  // 7-day digest opened with <task-notification> — 12% of the artifact was machine chatter
  // wearing the "── YOU ──" label. A turn that is ONLY this scrubs to '' and extractTurns drops it.
  t = t.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '');
  t = t.replace(/<task-(?:id|use-id|prompt|status)>[\s\S]*?<\/task-(?:id|use-id|prompt|status)>/g, '');
  t = t.replace(/<bash-(?:input|stdout|stderr)>[\s\S]*?<\/bash-(?:input|stdout|stderr)>/g, '');
  // the auto-compaction handoff: the harness writes a summary of the prior context and submits
  // it as a user turn. Nobody typed it. MEASURED 2026-08-24: it was showing up in the off-room
  // bucket as though it were an operator ask.
  t = t.replace(/^This session is being continued from a previous conversation[\s\S]*$/m, '');
  // the echoed / injected PMU-lens receipt block (header rule … closing rule)
  t = t.replace(/─{3,}\s*🛰️[\s\S]*?─{20,}\s*/g, '');
  // any leftover directive brackets from the injected lens
  t = t.replace(/⟦[\s\S]*?⟧/g, '');
  // the trailing self-audit line Claude appends
  t = t.replace(/\n?Sidecar note:.*$/g, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// ── terminalOf: which terminal/room the prompt ran in. The UserPromptSubmit lens receipt on
// every hooked prompt carries "🖥️ running-in 🎤 voice (Apple_Terminal) · QC→ …" — parse it from
// the RAW text BEFORE scrub (scrub deletes the receipt). Deterministic; null when absent.
export function terminalOf(raw) {
  const m = String(raw || '').match(/running-in\s+([^\n·]*?\([^)]+\))/u);
  return m ? m[1].trim() : null;
}
// raw (unscrubbed) text of a user message — the receipt still inside, for terminalOf
function rawText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
}

// pull the human-typed text (skip tool_result-only user turns) from a message.content
function humanText(content) {
  if (typeof content === 'string') return scrub(content);
  if (!Array.isArray(content)) return '';
  const parts = content.filter(b => b && b.type === 'text').map(b => b.text || '');
  return scrub(parts.join('\n'));
}
// pull Claude's reply text (skip tool_use blocks) from a message.content
function assistantText(content) {
  if (typeof content === 'string') return scrub(content);
  if (!Array.isArray(content)) return '';
  const parts = content.filter(b => b && b.type === 'text').map(b => b.text || '');
  return scrub(parts.join('\n'));
}

// ── extractTurns: pure, testable core. Given an array of parsed jsonl records and a
// cutoff (ms epoch), return ordered {ts, session, cwd, human, claude} turns. A turn opens
// on each real human prompt; the LAST assistant text before the next human prompt is the
// "final Claude out" (intermediate tool-call narration is overwritten).
export function extractTurns(records, sinceMs) {
  const turns = [];
  let cur = null;
  // THE TERMINAL MAP (measured on real transcripts 2026-07-24): the UserPromptSubmit hook
  // context that names the terminal ("running-in 🎤 voice (Apple_Terminal)") is NOT inside the
  // user message — it rides separate type:'attachment' records (and Claude's echoed receipt
  // rides assistant records). Harvest it per-session from ANY record; turns inherit it, and a
  // turn that opened before its attachment arrived is backfilled. Honest bucket when a session
  // never carries a receipt: '(unknown terminal)'.
  const termBySession = new Map();
  const lastTurnBySession = new Map();
  const noteTerminal = (sid, raw) => {
    const t = terminalOf(raw);
    if (!t) return;
    termBySession.set(sid, t);
    const lt = lastTurnBySession.get(sid);
    if (lt && lt.terminal === '(unknown terminal)') lt.terminal = t;
  };
  for (const r of records) {
    if (!r || r.isMeta || r.isSidechain) continue;           // skip meta + subagent chatter
    const ts = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    const msg = r.message || {};
    const sid = r.sessionId || '';
    const session = sid.slice(0, 8);
    const cwd = r.cwd || '';
    if (r.type === 'attachment') {
      // hook-context attachments carry the lens receipt — the terminal's authoritative source
      try { noteTerminal(sid, JSON.stringify(r.attachment || '')); } catch { /* best-effort */ }
    } else if (r.type === 'user' && msg.role !== 'assistant') {
      const h = humanText(msg.content);
      if (!h) continue;                                       // tool_result-only / empty → not a prompt
      const terminal = terminalOf(rawText(msg.content)) || termBySession.get(sid) || '(unknown terminal)';
      cur = { ts, session, cwd, terminal, human: h, claude: '' };
      turns.push(cur);
      lastTurnBySession.set(sid, cur);
    } else if (r.type === 'assistant') {
      noteTerminal(sid, rawText(msg.content));                // the echoed receipt is a valid source too
      const a = assistantText(msg.content);
      if (a && cur) cur.claude = a;                           // overwrite → final reply wins
    }
  }
  return turns;
}

function shortCwd(cwd) {
  return cwd.replace(os.homedir(), '~').replace('/GitHub/thetadrivencoach', '/…/thetadrivencoach');
}

export function render(turns, fromMs, toMs) {
  const iso = (ms) => new Date(ms).toISOString();
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const hours = Math.max(1, Math.round((toMs - fromMs) / 3600000));
  const sessions = new Set(turns.map(t => t.session));
  // TITLES PER TERMINAL (operator 2026-07-24): group the turns under the terminal/room each
  // prompt physically ran in (parsed from the lens receipt) — chronological within each group.
  const byTerm = new Map();
  for (const t of turns) {
    const k = t.terminal || '(unknown terminal)';
    if (!byTerm.has(k)) byTerm.set(k, []);
    byTerm.get(k).push(t);
  }
  const lines = [];
  lines.push(`CLAUDE CODE PROMPT DIGEST — last ${hours}h (your prompts + Claude's final replies)`);
  lines.push(`generated: ${iso(toMs)}`);
  lines.push(`window:    ${iso(fromMs)}  →  ${iso(toMs)}`);
  lines.push(`turns:     ${turns.length}   ·   sessions: ${sessions.size}   ·   terminals: ${byTerm.size}`);
  lines.push('note:      hook/receipt/system noise scrubbed; final assistant text per turn.');
  lines.push('note:      LLM-FREE loop — pure extraction from the session transcripts; no model call anywhere.');
  lines.push('');
  for (const [term, list] of byTerm) {
    lines.push('█'.repeat(78));
    lines.push(`█  TERMINAL: ${term}  —  ${list.length} turn(s)`);
    lines.push('█'.repeat(78));
    lines.push('');
    for (const t of list) {
      lines.push('═'.repeat(78));
      lines.push(`[${hhmm(t.ts)}]  session ${t.session || '????????'}${t.cwd ? '  ·  ' + shortCwd(t.cwd) : ''}`);
      lines.push('');
      lines.push('── YOU ──');
      lines.push(t.human || '(empty)');
      lines.push('');
      lines.push('── CLAUDE ──');
      lines.push(t.claude || '(no text reply — tool-only turn)');
      lines.push('');
    }
  }
  if (!turns.length) lines.push('(no human↔Claude turns found in the window)');
  return lines.join('\n');
}

// ── parseHours: "--hours 6,24,72" → [6,24,72]; "--hours 48" → [48]; absent → [24].
// Deduped, ascending, positive-finite only. ONE window is still the common case — the list
// form is what lets a single firing carry the short AND the long view without four launchd jobs.
export function parseHours(spec) {
  const list = String(spec ?? '24').split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);
  return [...new Set(list.length ? list : [24])].sort((a, b) => a - b);
}

// ── loadRecords: read + parse every session jsonl once, ordered. Shared across all windows
// (re-reading 100+ MB of transcript per window would be the naive shape).
function loadRecords() {
  const files = readdirSync(PROJECT_DIR).filter(f => f.endsWith('.jsonl'));
  const records = [];
  for (const f of files) {
    let raw;
    try { raw = readFileSync(join(PROJECT_DIR, f), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip partial line */ }
    }
  }
  records.sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0));
  return records;
}

// ── buildWindow: one window → the written .txt + its counts. Pure of email concerns.
function buildWindow(records, hours, now) {
  const sinceMs = now - hours * 3600 * 1000;
  let turns = extractTurns(records, sinceMs);
  // dedupe exact repeats (resumed sessions replay lines)
  const seen = new Set();
  turns = turns.filter(t => { const k = t.ts + '|' + t.human.slice(0, 100); if (seen.has(k)) return false; seen.add(k); return true; });

  const txt = render(turns, sinceMs, now);
  const stamp = new Date(now).toISOString().slice(0, 10);
  // non-24h runs get an hour-stamped filename so four-a-day never overwrite each other
  const hh = new Date(now).toISOString().slice(11, 13);
  const fileStem = hours === 24 ? `prompt-digest-${stamp}` : `prompt-digest-${stamp}-${hh}00-${hours}h`;
  const outPath = join(REPO, '.thetacog', 'cache', `${fileStem}.txt`);
  writeFileSync(outPath, txt);
  console.log(`📝 wrote ${turns.length} turns (${hours}h) → ${outPath}`);
  return {
    hours, txt, outPath, fileStem, stamp, hh,
    turns: turns.length,
    sessions: new Set(turns.map(t => t.session)).size,
    terminals: new Set(turns.map(t => t.terminal || '(unknown terminal)')).size,
  };
}

// ── main: scan → extract → write one .txt per window → ONE email carrying them all ──────
async function main() {
  const windows = parseHours(arg('--hours', '24'));
  const dry = process.argv.includes('--dry');
  const now = Date.now();

  if (!existsSync(PROJECT_DIR)) { console.error(`❌ project dir not found: ${PROJECT_DIR}`); process.exit(1); }

  const records = loadRecords();
  const built = windows.map(h => buildWindow(records, h, now));

  if (dry) { console.log('DRY — no email sent. Preview:\n' + built[0].txt.slice(0, 1200)); return; }

  // email body (small HTML) + one .txt per window attached; email-artifact auto-embeds the
  // current commit's encircled receipt + /commit link (the universal choke point).
  const { stamp, hh } = built[0];
  const only24 = built.length === 1 && built[0].hours === 24;
  const bodyPath = join(REPO, '.thetacog', 'cache', `prompt-digest-body.html`);
  const rows = built.map(b =>
    `<li><b>last ${b.hours}h</b> — ${b.turns} turns · ${b.sessions} sessions · ${b.terminals} terminal(s) · <code>${b.fileStem}.txt</code></li>`
  ).join('');
  // WHAT IS WHERE (operator 2026-08-06): every digest carries the 9-room overview — live context
  // per terminal + per-room metrics — and refreshes the room pages, so the digest cron IS the
  // overview's pulse. Best-effort: an overview failure must never cost the digest send.
  // The overview's two halves (2026-08-24): buildRoomOverview EXTRACTS (deterministic, exactly
  // as before) and annotateOverview INTERPRETS (local qwen — names each strand and says what is
  // going on, because a 170-char slice of a prompt is a quote, not a summary). The naming pass
  // is best-effort inside the best-effort block: no ollama, no budget, no parse → the cards fall
  // back to the raw asks and the footer says so, and the digest still sends either way.
  let overviewHtml = '';
  let naming = null;
  try {
    const rc = await import('./room-context.mjs');
    const ov = rc.buildRoomOverview(records, now);
    try { await rc.annotateOverview(ov); } catch (e) { console.error('⚠ naming skipped:', String(e.message).slice(0, 160)); }
    naming = ov.naming || null;
    overviewHtml = rc.renderOverviewHtml(ov);
    writeFileSync(join(REPO, '.thetacog', 'cache', 'room-overview.json'), JSON.stringify(ov, null, 1));
    writeFileSync(join(REPO, '.thetacog', 'cache', 'room-overview.html'),
      `<!doctype html><meta charset="utf-8"><title>Room overview</title><body style="max-width:900px;margin:24px auto">${overviewHtml}</body>`);
    const n = rc.injectIntoRoomPages(overviewHtml);
    console.log(`🗺️ room-overview refreshed → ${n} room page(s) + cache json/html`);
    if (naming) console.log(`🏷️ ${naming.line}`);
  } catch (e) { console.error('⚠ room-overview skipped:', String(e.message).slice(0, 200)); }
  // THE CANARY VERDICT RIDES THE UNCONDITIONAL SEND (hop 14). The ingest mail only fires when
  // the tape grows, so a dead loop sends nothing — the one day the assertion matters most is
  // the day it would be silent. This digest fires daily regardless, so the page rides here.
  // Best-effort import: a verdict failure must never cost the digest, but a failure to LOOK is
  // reported as its own loud line rather than an absent one.
  let canaryHtml = '';
  try {
    const { canaryVerdict } = await import('../elicit/canary-verdict.mjs');
    const v = canaryVerdict();
    canaryHtml = `<p style="padding:8px 12px;border-left:4px solid ${v.page ? '#c0392b' : '#27ae60'};background:${v.page ? '#fdf0ef' : '#f0f9f2'}"><b>${v.page ? 'LOOP UNPROVEN' : 'LOOP PROVEN'}</b> — ${v.line}</p>`;
  } catch (e) {
    canaryHtml = `<p style="padding:8px 12px;border-left:4px solid #c0392b;background:#fdf0ef"><b>CANARY VERDICT UNAVAILABLE</b> — could not compute (${String(e.message).slice(0, 120)}). "Did not look" is not "looked and saw nothing".</p>`;
  }
  writeFileSync(bodyPath,
    canaryHtml +
    `<p>Your Claude Code ${only24 ? 'day' : `${built.length === 1 ? `last ${built[0].hours}h` : 'short + long view'}`}, condensed — prompts you typed + Claude's final reply per turn, grouped under a title per terminal. Attached:</p>` +
    `<ul>${rows}</ul>` +
    overviewHtml +
    `<p style="color:#666;font-size:12px">The attached .txt files are RAW — every turn verbatim, hook/receipt/system noise scrubbed, no model anywhere in that path. The room cards above are the READING of the same material: ${naming?.line || 'extraction only — no reading in this run'}.</p>`);

  const label = only24 ? '' : ` ${hh}:00 (${built.map(b => `${b.hours}h`).join(' · ')})`;
  const counts = built.map(b => `${b.turns}`).join('/');
  const to = ['elias@thetadriven.com', 'you@example.com'];
  const args = ['scripts/email-artifact.mjs', '--html', bodyPath, '--subject',
    // GMAIL THREADS ON THE SUBJECT STRING, so anything that varies per send opens a new
      // conversation. The stamp carried a TIME and the subject carried counts, which scattered 28
      // digests across 28 threads in a fortnight. Date only in the subject; everything that moves
      // goes to the preheader, which Gmail shows beside it in the list.
      `🗒️ Claude prompt digest — ${String(stamp).slice(0, 10)}`,
      '--preheader', `${label ? label.trim() + ' · ' : ''}${counts} turns`, '--no-attach'];
  for (const b of built) { args.push('--attach', b.outPath); }
  for (const t of to) { args.push('--to', t); }
  try {
    const out = execFileSync('node', args, { cwd: REPO, encoding: 'utf8' });
    console.log(out.trim());
  } catch (e) {
    console.error('❌ email send failed:', String(e.stdout || e.message).slice(0, 400)); process.exit(1);
  }
}

// run main only when invoked directly (not when imported by the test)
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
