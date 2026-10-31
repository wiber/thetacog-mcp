#!/usr/bin/env node
// scripts/pmu/reality-slurp.mjs — slurp a room's REAL, time-scoped delivered work.
// =============================================================================
// The reality half of the attestation must be what ACTUALLY HAPPENED, not hand-authored
// claims (those are gameable — you just write text that matches the spec). This slurps a
// room's real activity inside a TIME WINDOW (the /time lens) from three sources, the way
// the rest of the cog already reads reality:
//   · SQLite  — data/thetacoach.db tc_tasks (the delegation mailbox: description + prompt
//               + state + origin_commit), the authoritative record of what was delegated/done.
//   · git     — commits in the window touching the room's owned-surface paths (the delivered
//               CODE), subject+body = the semantic claim of the work (code→reality, semantic).
//   · transcript — the session's ~/.claude/projects/<repo>/*.jsonl edits/commits (optional,
//               heavier; what the room actually did this session).
//
// "matters not if it's inside the computer or across the web" — the slurp produces signed
// fragments; whether the rooms are local processes or web nodes, the mesh ledger carries the
// same receipts. This just sources the reality; spec-deliver-attest walks it against the reef.
//
// Usage / API:
//   node scripts/pmu/reality-slurp.mjs --room builder --since 2026-06-22 [--until ISO] [--json]
//   import { slurpReality } from './reality-slurp.mjs'  → [{ text, ts, src, ref }]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = resolve(REPO, 'data/thetacoach.db');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

// owned-surface globs for a room (from the room card HTML "Owned file/dir surface"); these
// scope the git slurp so a room's reality is its OWN delivered code, not the whole repo.
function ownedPaths(roomKey) {
  try {
    const rooms = (() => { const d = JSON.parse(readFileSync(resolve(REPO, 'data/rooms.json'), 'utf8')); return d.rooms || d; })();
    const room = Array.isArray(rooms) ? rooms.find((r) => r.key === roomKey) : rooms[roomKey];
    const html = room && room.html_path ? resolve(REPO, room.html_path) : null;
    if (!html || !existsSync(html)) return [];
    const sec = readFileSync(html, 'utf8').match(/<h3>Owned file\/dir surface<\/h3>([\s\S]*?)(<h3>|$)/);
    if (!sec) return [];
    return [...sec[1].matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1].trim()).filter(Boolean).slice(0, 16);
  } catch { return []; }
}

function sh(cmd) { try { return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }); } catch { return ''; } }
const esc = (s) => String(s).replace(/'/g, "''");
// git mis-parses a bare YYYY-MM-DD on some builds — pin midnight so --since/--until are reliable.
const normDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? `${d} 00:00:00` : d;

// ── SQLite tc_tasks — the delegation mailbox, time-scoped ──
function slurpSqlite(roomKey, since, until) {
  if (!existsSync(DB)) return [];
  const where = [`room='${esc(roomKey)}'`];
  if (since) where.push(`created_at >= '${esc(since)}'`);
  if (until) where.push(`created_at <= '${esc(until)}'`);
  const out = sh(`sqlite3 -separator '\\x1f' ${JSON.stringify(DB)} "SELECT id, coalesce(description,''), coalesce(prompt_text,''), coalesce(origin_commit,''), created_at FROM tc_tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200;"`);
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const [id, descr, prompt, commit, ts] = line.split('\x1f');
    return { text: [descr, prompt].filter(Boolean).join('. '), ts, src: 'sqlite', ref: id + (commit ? `@${commit}` : '') };
  }).filter((r) => r.text.trim());
}

// ── git — delivered code in the window, scoped to the room's owned surface ──
// `paths` override (--paths "a b c") wins; else the room's owned-surface globs. A
// delegated request can land OUTSIDE a room's default surface (bf-002's package work
// lives in scripts/pmu + packages/), so the override is how a per-delegation reality
// is slurped without mis-attributing it to the room's standing territory.
function slurpGit(roomKey, since, until, pathsOverride) {
  const paths = (pathsOverride && pathsOverride.length) ? pathsOverride : ownedPaths(roomKey);
  const sinceArg = since ? `--since='${esc(normDate(since))}'` : '';
  const untilArg = until ? `--until='${esc(normDate(until))}'` : '';
  const pathArg = paths.length ? '-- ' + paths.map((p) => JSON.stringify(p)).join(' ') : '';
  // subject + body = the semantic claim of the commit (already prose, not raw code)
  const out = sh(`git log ${sinceArg} ${untilArg} --pretty=format:'%H%x1f%cI%x1f%s%x1f%b%x1e' ${pathArg}`.trim());
  return out.split('\x1e').map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [h, ts, subject, body] = rec.split('\x1f');
    return { text: [subject, body].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim(), ts, src: 'git', ref: (h || '').slice(0, 9) };
  }).filter((r) => r.text);
}

// ── transcript — the session's tool activity (edits/commits), optional + heavier ──
function slurpTranscript(since, until, limit = 60) {
  const dir = resolve(homedir(), '.claude/projects/-Users-thetacoach-GitHub-thetadrivencoach');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => resolve(dir, f));
  const items = [];
  for (const f of files) {
    let raw; try { raw = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const ts = ev.timestamp || ev.ts;
      if (since && ts && ts < since) continue;
      if (until && ts && ts > until) continue;
      // capture file-edits + bash commits as semantic work signals
      const m = ev.message || ev;
      const content = Array.isArray(m?.content) ? m.content : [];
      for (const c of content) {
        if (c?.type === 'tool_use' && /Edit|Write|Bash/.test(c.name || '')) {
          const inp = c.input || {};
          const t = inp.description || inp.command?.slice(0, 200) || inp.file_path || '';
          if (t && /commit|spec|reef|attest|deliver|pmu/i.test(t)) items.push({ text: String(t), ts, src: 'transcript', ref: c.name });
        }
      }
    }
  }
  return items.slice(-limit);
}

export function slurpReality({ room, since = null, until = null, sources = ['sqlite', 'git'], paths = null } = {}) {
  const out = [];
  if (sources.includes('sqlite')) out.push(...slurpSqlite(room, since, until));
  if (sources.includes('git')) out.push(...slurpGit(room, since, until, paths));
  if (sources.includes('transcript')) out.push(...slurpTranscript(since, until));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const room = arg('--room', 'builder');
  const since = arg('--since', null);
  const until = arg('--until', null);
  const sources = (arg('--sources', 'sqlite,git')).split(',');
  const paths = arg('--paths', null) ? arg('--paths').split(/\s+/).filter(Boolean) : null;
  const items = slurpReality({ room, since, until, sources, paths });
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(items, null, 2) + '\n'); }
  else {
    const B = '\x1b[1m', D = '\x1b[2m', C = '\x1b[36m', X = '\x1b[0m';
    process.stderr.write(`${B}⬡ REALITY SLURP${X} ${D}— ${room} · ${items.length} items · since ${since || 'all'} · sources ${sources.join('+')}${X}\n`);
    for (const it of items.slice(0, 20)) process.stderr.write(`  ${C}${it.src}${X} ${D}${(it.ts || '').slice(0, 10)} ${it.ref}${X} ${it.text.slice(0, 80)}\n`);
  }
}
