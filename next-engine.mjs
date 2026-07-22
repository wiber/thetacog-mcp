#!/usr/bin/env node
// packages/thetacog-mcp/next-engine.mjs — the /next engine (packaged).
// ─────────────────────────────────────────────────────────────────────────
// PREDICTION across the rooms from THREE real sources:
//   1. chat transcripts (~/.claude/projects/<repo>/*.jsonl) — read backwards,
//      bounded (no gulp): what we've actually been working on.
//   2. the repo + git logs — per room, the recent commits touching that room's
//      OWNED file/dir surface (parsed from .workflow/rooms/<card>.html): what is
//      actually going on in the code for that lane.
//   3. the board — data/orthogonal/vectors.json → .thetacog/room-punch-lists.json:
//      the standing directionals per room.
//
// Output (the subdivision substrate the mesh runner uses for inter-room
// contracts + task hand-off): EVERY room is filled with a ≥2-sentence themed
// narrative (the DIRECTION + the actual AREA). The CURRENT room gets the
// exhaustive narrative + an actionable, numbered to-do list.
//
//   node next-engine.mjs --room navigator [--json] [--narration f.txt] [--html f.html]
//   import { runNext } from './next-engine.mjs'  // returns the structured object
//
// Deterministic — no in-script LLM (claude -p is agentic, ollama too weak). The
// signals are real (commits, board, transcript tail); the strong-model layer, if
// present, supplies extra predicted steps via .thetacog/next-state.md.
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRoot(cwd) {
  try { return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim(); }
  catch { return cwd; }
}
function transcriptDirFor(repo) {
  return join(homedir(), '.claude/projects', '-' + repo.replace(/^\//, '').replace(/\//g, '-'));
}

// ── per-room owned-surface globs (from the room card) ──
function ownedGlobs(repo, htmlPath) {
  if (!htmlPath) return [];
  const p = join(repo, htmlPath);
  if (!existsSync(p)) return [];
  const html = readFileSync(p, 'utf8');
  const m = html.match(/Owned file[^<]*surface<\/h3>([\s\S]*?)(<h3>|<h2>|$)/i);
  const block = m ? m[1] : '';
  return [...block.matchAll(/<code>([^<]+)<\/code>/g)].map(x => x[1].trim()).filter(Boolean).slice(0, 12);
}

// ── per-room recent commits over the owned surface (the repo logs) ──
function recentCommits(repo, globs, days = 21, n = 5) {
  if (!globs.length) return [];
  try {
    const out = execSync(
      `git -c core.quotepath=false log --since='${days} days ago' --pretty=format:'%h%x09%ad%x09%s' --date=short -n ${n} -- ${globs.map(g => JSON.stringify(g)).join(' ')}`,
      { cwd: repo, encoding: 'utf8' }).trim();
    return out ? out.split('\n').map(l => { const [h, d, ...s] = l.split('\t'); return { h, d, s: s.join('\t') }; }) : [];
  } catch { return []; }
}

// ── transcript tail (backwards, bounded) — what we've been working on ──
function transcriptTail(repo, budget = 16000, maxFiles = 6, perMsg = 1000) {
  const dir = transcriptDirFor(repo);
  let files = [];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, maxFiles).map(x => x.f);
  } catch { return { ops: [], all: [] }; }
  const textOf = (msg) => { const c = msg?.content; if (typeof c === 'string') return c; if (Array.isArray(c)) return c.filter(p => p?.type === 'text' && p.text).map(p => p.text).join(' '); return ''; };
  const isNoise = (t) => !t || t.startsWith('<system-reminder>') || t.startsWith('Caveat:') || /^\s*(Command |<command-name>|<local-command)/.test(t) || t.includes('SessionStart hook');
  const collected = []; let b = budget;
  for (const file of files) {
    if (b <= 0) break;
    let lines; try { lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean); } catch { continue; }
    const msgs = [];
    for (const line of lines) { let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== 'user' && o.type !== 'assistant') continue;
      let t = textOf(o.message).trim(); if (isNoise(t)) continue;
      t = t.replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim();
      msgs.push({ role: o.type === 'user' ? 'OPERATOR' : 'ASSISTANT', text: t }); }
    for (let i = msgs.length - 1; i >= 0 && b > 0; i--) { const t = msgs[i].text.slice(0, perMsg); collected.push({ ...msgs[i], text: t }); b -= t.length; }
  }
  collected.reverse();
  return { ops: collected.filter(m => m.role === 'OPERATOR'), all: collected };
}

// ── predicted steps routed by [room] tag (from the cognition layer) ──
function predictedByRoom(repo, themeWords) {
  const sf = join(repo, '.thetacog/next-state.md');
  const out = {};
  if (!existsSync(sf)) return out;
  const md = readFileSync(sf, 'utf8');
  const m = md.match(/PREDICTED NEXT STEPS[^\n]*\n([\s\S]*?)(?=\n[A-Z][A-Z ]{4,}\n|$)/);
  if (!m) return out;
  for (const raw of m[1].split('\n').map(l => l.replace(/^[-*•\d.\s]+/, '').trim()).filter(Boolean)) {
    const tag = raw.match(/^\[([a-z]+)\]\s*/i);
    let room, text;
    if (tag) { room = tag[1].toLowerCase(); text = raw.replace(/^\[[a-z]+\]\s*/i, ''); }
    else { // keyword route
      const toks = raw.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
      let best = null, bs = 0; for (const [k, w] of Object.entries(themeWords)) { let s = 0; for (const t of toks) if (w.has(t)) s++; if (s > bs) { bs = s; best = k; } }
      room = best; text = raw;
    }
    if (room) (out[room] ||= []).push(text);
  }
  return out;
}

// drop near-duplicate to-dos (agent-predicted steps often restate a board item).
function dedupe(items) {
  const out = [], seen = [];
  for (const it of items) {
    if (!it) continue;
    const set = new Set(it.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));
    let dup = false;
    for (const s of seen) { let i = 0; for (const w of set) if (s.has(w)) i++; if (i / Math.max(1, Math.min(set.size, s.size)) > 0.5) { dup = true; break; } }
    if (!dup) { out.push(it.trim()); seen.push(set); }
  }
  return out;
}

export function runNext(opts = {}) {
  const repo = opts.repo || repoRoot(process.cwd());
  const ROOM = opts.room || 'navigator';
  const roomsPath = join(repo, 'data/rooms.json');
  if (!existsSync(roomsPath)) throw new Error(`next-engine: data/rooms.json not found under ${repo} — pass --room-root / repo_root to the repo, or run from inside it.`);
  let rooms;
  try { rooms = JSON.parse(readFileSync(roomsPath, 'utf8')).rooms; }
  catch (e) { throw new Error(`next-engine: data/rooms.json is unreadable/invalid JSON: ${e.message}`); }
  if (!rooms || !Object.keys(rooms).length) throw new Error('next-engine: data/rooms.json has no rooms.');
  let punch = {};
  try { const pp = join(repo, '.thetacog/room-punch-lists.json'); if (existsSync(pp)) punch = JSON.parse(readFileSync(pp, 'utf8')).rooms || {}; }
  catch { punch = {}; /* board optional — every room still fills from git logs + theme */ }

  const themeWords = {};
  for (const [k, r] of Object.entries(rooms)) {
    const w = new Set();
    for (const x of (r.vector_keywords || [])) String(x).toLowerCase().split(/[^a-z0-9]+/).forEach(t => t.length > 2 && w.add(t));
    for (const s of (r.specialties || [])) String(s.axis || '').toLowerCase().split(/[^a-z0-9]+/).forEach(t => t.length > 2 && w.add(t));
    themeWords[k] = w;
  }
  const tail = transcriptTail(repo);
  const predicted = predictedByRoom(repo, themeWords);
  const now = new Date().toISOString();

  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const persona = (r, k) => (r.persona || k).replace(/^The\s+/i, '');
  const themeShort = (r) => (r.vector_keywords || []).slice(0, 4).join(', ');

  const result = { generated_at: now, lead: ROOM, repo, sources: { transcript_messages: tail.all.length }, rooms: {} };

  // strip the conventional-commit prefix + trailing clause → the gist of a commit.
  const gist = (s) => String(s || '').replace(/^[a-z]+(\([^)]*\))?:\s*/i, '').replace(/\s+[—-]\s.*$/, '').trim();

  for (const [k, r] of Object.entries(rooms)) {
    const globs = ownedGlobs(repo, r.html_path);
    const commits = recentCommits(repo, globs, 21, 3);
    const board = ((punch[k]?.items) || []).filter(i => i.status === 'pending');
    // agent-predicted steps first, then board directionals; dedup near-duplicates.
    const todos = dedupe([...(predicted[k] || []), ...board.map(b => b.directional || b.title)]);
    const isLead = ROOM === k;
    const area = globs.length ? globs.slice(0, 3).join(', ') : (r.specialties || []).slice(0, 2).map(s => s.axis).join(' · ');

    // Two tight, researched sentences: DIRECTION (theme + freshest commit) + AREA + the one next move.
    // Terminal-FIRST per the canonical room descriptor (the room IS its terminal): every narrative
    // leads with the terminal name + emoji so the read is anchored to the physical room.
    const lead0 = `${r.emoji || ''} ${r.terminal || k} · ${persona(r, k)}`.trim();
    const s1 = commits.length
      ? `${lead0}: ${themeShort(r)}; active on ${gist(commits[0].s)}.`
      : `${lead0}: ${themeShort(r)}; quiet on its surface this cycle.`;
    const s2 = todos.length
      ? `Area: ${area}. Next: ${todos[0]}`
      : `Area: ${area}. Standing focus: ${(r.specialties || [])[0]?.substance || themeShort(r)}.`;

    result.rooms[k] = {
      terminal: r.terminal || k, emoji: r.emoji || '', persona: persona(r, k),
      coordinate: r.coordinate || '', theme: r.vector_keywords || [],
      owned_surface: globs, recent_commits: commits,
      narrative: `${s1} ${s2}`,
      todos: isLead ? todos.slice(0, 6) : todos.slice(0, 2),
      _s1: s1, _area: area,
    };
  }

  // CURRENT room: exhaustive but tight — fold in what we've been working on.
  const lead = result.rooms[ROOM];
  let lastAsk = (tail.ops.slice(-1)[0]?.text || '').replace(/\s+/g, ' ').trim();
  if (lastAsk.length > 140) lastAsk = lastAsk.slice(0, 140).replace(/\s+\S*$/, '') + '…'; // clean word boundary
  lead.working_on = lastAsk ? [lastAsk] : [];
  lead.narrative_exhaustive = [
    lead._s1,
    `Area: ${lead._area}.`,
    lastAsk ? `Recent focus: ${lastAsk}.` : '',
    lead.todos.length ? `${lead.todos.length} open to-do${lead.todos.length > 1 ? 's' : ''}, in full below.` : '',
  ].filter(Boolean).join(' ');

  // ── HANDOFF — the single next room to OPEN. The Node A→B contract made human-useful: when a thread
  // pauses, this answers "which room do I open to continue?". Grounded in the board's curated
  // priority + also_rooms (the bleed is data, not a guess), and biased toward CONTINUITY with the
  // active thread (lastAsk) so it picks up where you left off, not just the global top priority.
  const pri = (p) => { const m = /P(\d)/.exec(p || ''); return m ? +m[1] : 9; };
  const askW = new Set(String(lastAsk || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 4));
  const ov = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).reduce((n, w) => n + (askW.has(w) ? 1 : 0), 0);
  const items = [];
  for (const k of Object.keys(result.rooms)) for (const it of ((punch[k]?.items) || [])) {
    if (it.status !== 'pending') continue;
    items.push({ room: k, priority: it.priority || '', step: it.directional || it.title || '', also: it.also_rooms || [], refs: (it.refs || []).slice(0, 3) });
  }
  items.sort((a, b) => pri(a.priority) - pri(b.priority) || ov(b.step) - ov(a.step));
  if (items[0]) {
    const h = items[0]; const r = result.rooms[h.room] || {};
    const label = (k) => { const x = result.rooms[k]; return x ? `${x.emoji} ${x.terminal}` : k; };
    result.handoff = {
      from: { room: ROOM, label: `${lead.emoji} ${lead.terminal}`.trim() },
      open: { room: h.room, label: `${r.emoji || ''} ${r.terminal || h.room}`.trim(), persona: r.persona || h.room, priority: h.priority },
      continue: h.step,
      bleeds_into: (h.also || []).filter(k => k !== h.room && result.rooms[k]).map(label),
      refs: h.refs,
      active_thread: lastAsk || '',
      continuity: ov(h.step) > 0, // true = this step overlaps what you were just working on
    };
  }

  return result;
}

// ── renderers ──
// The JSON `narrative` now leads terminal-first ("📐 VS Code · Architect: …"); the audio/HTML
// renderers carry their own terminal header, so strip the leading descriptor there to avoid
// saying/showing the terminal twice.
const stripLead = (s) => String(s || '').replace(/^.*?:\s/, '');
function renderNarration(R) {
  const say = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/https?:\/\/[^\s]+/g, ' a link ').replace(/`([^`]*)`/g, '$1')
    .replace(/[*_>|#•]+/g, ' ').replace(/[—–]/g, ', ').replace(/[·]/g, ' ').replace(/≥/g, ' at least ').replace(/σ/g, ' sigma ')
    .replace(/×/g, ' times ').replace(/≡/g, ' equals ').replace(/→/g, ' to ').replace(/\bP0\b/g, 'priority zero').replace(/\bP1\b/g, 'priority one').replace(/\s+/g, ' ').trim();
  const lead = R.rooms[R.lead];
  const N = [];
  if (R.handoff) {
    const h = R.handoff;
    N.push(`Open next, ${say(h.open.label)}, the ${say(h.open.persona)} room${h.continuity ? ', which continues what you were just on' : ''}. Continue, ${say(h.continue)}.${h.bleeds_into.length ? ` This bleeds into ${say(h.bleeds_into.join(', '))}.` : ''}\n`);
  }
  N.push(`This is the ${say(lead.terminal)} room, the ${say(lead.persona)}. ${say(stripLead(lead.narrative_exhaustive || lead.narrative))}`);
  if (lead.todos.length) { N.push(`\nTop to-dos for ${say(lead.persona)}.`); lead.todos.slice(0, 5).forEach((t, i) => N.push(`${i + 1}. ${say(t)}`)); }
  N.push(`\nThe other rooms, direction and next move.`);
  for (const k of Object.keys(R.rooms)) { if (k === R.lead) continue; const r = R.rooms[k]; N.push(`${say(r.terminal)}, ${say(r.persona)}. ${say(stripLead(r.narrative))}`); }
  N.push(`\nThat is the read across the rooms, from the transcripts, the repo logs, and the board. Run next again as the work moves.`);
  return N.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function renderHtml(R) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lead = R.rooms[R.lead];
  const todoRows = lead.todos.map((t, i) => `<div style="padding:5px 0;border-top:1px solid #eee;font-size:13px;border-left:3px solid #b91c1c;padding-left:10px;margin:3px 0"><b>${i + 1}.</b> ${esc(t)}</div>`).join('');
  const others = Object.keys(R.rooms).filter(k => k !== R.lead);
  const card = (k) => { const r = R.rooms[k]; return `<div style="background:#fff;border:1px solid #e3e3e3;border-radius:9px;padding:11px 13px;margin:8px 0">
    <div style="font-size:14px;font-weight:700">${r.emoji} ${esc(r.terminal)} <span style="font-size:11px;color:#999;font-weight:400">· ${esc(r.persona)} · ${esc(r.coordinate)}</span></div>
    <div style="font-size:12px;color:#444;margin-top:4px;line-height:1.5">${esc(stripLead(r.narrative))}</div></div>`; };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f2f2ee;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#13161b">
<div style="max-width:720px;margin:0 auto;padding:22px 16px 44px">
  <div style="font-size:11px;font-family:ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#b91c1c">🧭 /next · prediction across the rooms · transcripts + repo + logs + board</div>
  <h1 style="font-size:22px;margin:5px 0 4px">${lead.emoji} ${esc(lead.terminal)} — ${esc(lead.persona)} leads</h1>
  <div style="background:#fff;border:1px solid #ddd;border-left:5px solid #b91c1c;border-radius:11px;padding:14px 16px;margin:12px 0">
    <div style="font-size:13px;color:#333;line-height:1.6">${esc(stripLead(lead.narrative_exhaustive || lead.narrative))}</div>
    ${todoRows ? `<div style="font-size:11px;font-family:ui-monospace,monospace;text-transform:uppercase;color:#b91c1c;margin:12px 0 2px">To-do, in full</div>${todoRows}` : ''}
  </div>
  <div style="font-size:11px;font-family:ui-monospace,monospace;text-transform:uppercase;color:#888;margin:16px 0 2px">The other rooms · direction + area</div>
  ${others.map(card).join('')}
  <div style="font-size:11px;color:#a8a29e;margin-top:18px;text-align:center;font-family:ui-monospace,monospace">sources: chat transcripts + repo git-logs + board · led from ${esc(lead.terminal)} · local node → global mesh contract</div>
</div></body></html>`;
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
  let R;
  try { R = runNext({ room: arg('--room', 'navigator'), repo: arg('--repo-root', null) || arg('--repo', null) }); }
  catch (e) { console.error(String(e.message || e)); process.exit(1); }
  // Persist the subdivision the mesh runner reads (inter-room contracts + task
  // hand-off). This is "where the task list lives" — one canonical file.
  if (!process.argv.includes('--no-write')) {
    try {
      const routed = join(R.repo, '.thetacog/next-routed.json');
      mkdirSync(dirname(routed), { recursive: true });
      writeFileSync(routed, JSON.stringify(R, null, 2) + '\n');
    } catch { /* best-effort */ }
  }
  const np = arg('--narration'), hp = arg('--html');
  if (np) writeFileSync(np, renderNarration(R));
  if (hp) writeFileSync(hp, renderHtml(R));
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(R, null, 2) + '\n');
  else {
    const lead = R.rooms[R.lead];
    process.stdout.write(`${lead.emoji} ${lead.terminal} (${lead.persona}) leads · ${lead.todos.length} to-dos · ${Object.keys(R.rooms).length} rooms filled\n`);
    if (R.handoff) {
      const h = R.handoff;
      process.stdout.write(`\n  ▶ OPEN NEXT → ${h.open.label} (${h.open.persona})${h.open.priority ? ` · ${h.open.priority}` : ''}${h.continuity ? ' · continues your thread' : ''}\n`);
      process.stdout.write(`     continue: ${h.continue}\n`);
      if (h.bleeds_into.length) process.stdout.write(`     bleeds into: ${h.bleeds_into.join(', ')}\n`);
      if (h.refs.length) process.stdout.write(`     files: ${h.refs.join(', ')}\n`);
      process.stdout.write('\n');
    }
    process.stdout.write(renderNarration(R));
  }
}

export { renderNarration, renderHtml };
