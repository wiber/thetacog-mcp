// packages/thetacog-mcp/scripts/tape/cc-session.mjs — A CLAUDE CODE SESSION AS A TAPE SOURCE.
//
// Operator: "sync to cc cli sessions like this one".
//
// /tape has always been aimed at a file — a dictated transcript, a chat export. The session you are
// actually working in is a transcript too, and it is the one whose decisions have not been written
// down anywhere yet. This resolves it and renders it into the plain-turn form the walk expects.
//
// ── THE FILTER IS THE WHOLE JOB, AND IT IS MEASURED ───────────────────────────────────────────
// A Claude Code .jsonl is not a conversation, it is an event log. Measured on this repo's live
// session (6,664 lines):
//
//   user messages          1,084
//   actually operator prose    99      <- what a tape should walk
//   tool_result carriers      974      <- the assistant's own tool output, wearing role:"user"
//   slash-command envelopes    11
//
// Ninety percent of the "user" turns were never typed by a person. Walking them would place the
// assistant's own grep output as operator intent, which is not a noisy tape — it is a tape that
// says the wrong thing with full confidence.
//
// The injected blocks are stripped too: <system-reminder>, the PMU lens receipt, and the ⟦…⟧
// directive envelope are appended to the user's message by hooks, and at ~2KB per turn they would
// outweigh the prose they surround. After filtering: 271,821 chars at 98% signal.
//
// NEVER GUESS WHICH SESSION. The newest file by mtime is the running one only by coincidence, and
// picking wrong silently walks somebody else's work. `--session <id>` is exact; `latest` is
// explicit about being a guess and says which file it took.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';

/** Claude Code encodes the project cwd by replacing every non-alphanumeric run with a dash. */
export const projectDir = (repoRoot) =>
  join(homedir(), '.claude', 'projects', String(repoRoot).replace(/[^a-zA-Z0-9]/g, '-'));

/** Sessions for this repo, newest first, with the numbers needed to choose between them. */
export function listSessions(repoRoot) {
  const dir = projectDir(repoRoot);
  if (!existsSync(dir)) return { dir, sessions: [], reason: `no Claude Code project dir at ${dir}` };
  const sessions = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const p = join(dir, f);
      const st = statSync(p);
      return { id: basename(f, '.jsonl'), path: p, bytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { dir, sessions, reason: sessions.length ? null : `no .jsonl sessions in ${dir}` };
}

const INJECTED = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  // the PMU lens receipt the UserPromptSubmit hook prepends
  /─── 🛰️ PMU Lens[\s\S]*?────────────────────────────────────────────────────────/g,
  // the ⟦ DIRECTIVE LENS ⟧ / ⟦ CORE TASK ⟧ / ⟦ OUTPUT CONTRACT ⟧ envelope
  /⟦[\s\S]*?⟧[^\n]*\n?/g,
  /^📋 GRIP LEDGER POSTER[\s\S]*$/m,
];

/** The turns a human actually typed. Everything else is the harness talking to itself. */
export function operatorTurns(sessionPath) {
  const lines = readFileSync(sessionPath, 'utf8').split('\n').filter(Boolean);
  const turns = [];
  const dropped = { tool_result: 0, slash_command: 0, injected_only: 0, empty: 0 };
  for (const line of lines) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'user' || j.message?.role !== 'user') continue;
    const c = j.message.content;
    // role:"user" is the transport for tool results too — those are the assistant's own output
    // coming back, and placing them as operator intent is the failure this filter exists to stop.
    if (Array.isArray(c) && c.some((x) => x.type === 'tool_result')) { dropped.tool_result++; continue; }
    let text = Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : String(c || '');
    if (!text.trim()) { dropped.empty++; continue; }
    if (/^<local-command-caveat>|^<command-name>|^<command-message>/.test(text.trim())) { dropped.slash_command++; continue; }
    for (const re of INJECTED) text = text.replace(re, '');
    text = text.trim();
    if (!text) { dropped.injected_only++; continue; }
    turns.push({ ts: j.timestamp || null, text });
  }
  return { turns, dropped };
}

/** Render to the plain-turn text the walk expects, and report what it is made of. */
export function renderSource(turns) {
  return turns.map((t, i) => `--- turn ${i + 1}${t.ts ? ` · ${t.ts}` : ''} ---\n${t.text}`).join('\n\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const repo = arg('--repo', process.cwd());
  const { dir, sessions, reason } = listSessions(repo);

  if (process.argv.includes('--list')) {
    if (!sessions.length) { console.error(`✗ ${reason}`); process.exit(2); }
    console.log(`\n  CLAUDE CODE SESSIONS · ${dir}\n`);
    for (const s of sessions.slice(0, 12)) {
      const { turns, dropped } = operatorTurns(s.path);
      console.log(`  ${s.id.slice(0, 8)}  ${String(turns.length).padStart(4)} operator turn(s)  ${String(Math.round(s.bytes / 1024)).padStart(6)}KB  ${new Date(s.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')}  (dropped ${dropped.tool_result} tool-result)`);
    }
    console.log('');
    process.exit(0);
  }

  const want = arg('--session', 'latest');
  const picked = want === 'latest' ? sessions[0] : sessions.find((s) => s.id === want || s.id.startsWith(want));
  if (!picked) { console.error(`✗ no session matching "${want}" in ${dir}`); process.exit(2); }
  const { turns, dropped } = operatorTurns(picked.path);
  if (!turns.length) { console.error(`✗ session ${picked.id.slice(0, 8)} has no operator turns after filtering`); process.exit(2); }

  const out = arg('--out', resolve(repo, '.thetacog/cc-sources', `${picked.id}.txt`));
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, renderSource(turns));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ id: picked.id, path: picked.path, out, turns: turns.length, dropped, chars: renderSource(turns).length }));
  } else {
    console.error(`  session ${picked.id.slice(0, 8)}${want === 'latest' ? ' (NEWEST BY MTIME — pass --session <id> to be exact)' : ''}`);
    console.error(`  ${turns.length} operator turn(s) · dropped ${dropped.tool_result} tool-result, ${dropped.slash_command} slash-command, ${dropped.injected_only} injected-only`);
    console.log(out);
  }
  process.exit(0);
}
