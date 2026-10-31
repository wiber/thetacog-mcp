#!/usr/bin/env node
// scripts/ops/board-comments.mjs — C1020o: THE OPERATOR'S COMMENT ON A BOARD CELL RUNS AS A /steer IN THE ROOM THAT OWNS THE ROW.
// Operator 2026-10-19 (relayed by wo1, bf-6360), verbatim: "what I have not seen yet is the ability to read my comments in the
// spreadsheet and execute them just as if they were a prompt to run steers based on them".
//
// THE DOOR IS AUTHOR-GATED, because a sheet is shareable and a comment is a prompt-injection door:
//   - executed only when the comment's author is the operator's own Google account: Drive API `author.me === true`, or an
//     `author.emailAddress` in OPERATOR_EMAILS. A display name alone is spoofable and never executes;
//   - anyone else's comment is recorded as SHOWN (with why) and never dispatched.
// EXACTLY ONCE: data/vna/board-comments.ndjson carries one row per comment id, written the moment it is decided; a comment id
// already there is skipped. Edits to a comment's text are a new decision only if the operator posts a new comment (a new id).
// THE DISPATCH is the house door, never a direct model call: scripts/bifurcate.mjs --to <room> --action "/steer <comment>" — the
// rooms JSON + signed mesh ASK the room pulls (CLAUDE.md, DELEGATION NEVER GIT-BRANCHES). The room is read off the row the comment
// is anchored to (its OWNER cell on the board), else the architect room (which owns the board).
// THE REPLY ("queued to <room> as <bf-id>", later the sha) is written to data/vna/board-comment-replies.ndjson as PENDING: no tool on
// this machine can post a reply on a Drive comment thread yet (the Drive connector has no comment-write call; the Drive API needs an
// OAuth client this repo does not hold). It posts when a writer exists (C1020a). LLM-FREE.
//
// INPUT is the Drive API v3 comments.list shape — { comments: [{ id, author: { me, emailAddress, displayName }, content,
// quotedFileContent: { value }, anchor, createdTime, resolved }] } — saved to a file by whichever reader has it.
//
//   node scripts/ops/board-comments.mjs ingest <comments.json> --sheet <name> [--dry]
//   node scripts/ops/board-comments.mjs probe                 does the rclone sign-in read comments with their author? (bf-6370)
//   node scripts/ops/board-comments.mjs pull [--dry]          read every board sheet's comments live and ingest them
// THE LIVE READ (wo1, bf-6370): an rclone remote made with scope=drive holds an OAuth token whose scope covers Drive API v3
// comments.list. `rclone about <remote>:` refreshes it, `rclone config dump` yields it, and a fetch of
// files/<id>/comments?fields=* with that bearer returns author.me and author.emailAddress. probe measures exactly that once and
// says UNMEASURED with the reason until it can. The token is held in memory for the request only, never printed or written.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = 'data/vna/board-comments.ndjson';
export const REPLIES = 'data/vna/board-comment-replies.ndjson';
// The operator's own accounts (CLAUDE.md canonical author email + the account that owns the board in Drive).
export const OPERATOR_EMAILS = ['elias@thetadriven.com', 'you@example.com'];
const ROOMS = ['vault', 'architect', 'performer', 'navigator', 'network', 'voice', 'builder', 'laboratory', 'operator'];
const readNd = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// Who may command the board. Identity is the account, never the name shown beside it.
export function authorVerdict(c) {
  const a = (c && c.author) || {};
  if (a.me === true) return { execute: true, why: 'author.me' };
  const email = String(a.emailAddress || '').toLowerCase();
  if (email && OPERATOR_EMAILS.includes(email)) return { execute: true, why: `author ${email}` };
  if (email) return { execute: false, why: `author ${email} is not the operator — shown, never executed` };
  return { execute: false, why: `author identity not verifiable (display name "${a.displayName || ''}" only) — shown, never executed` };
}

// The row a comment is anchored to: the first board id in the quoted cell text (a spec row, a decision, a question hash).
export function anchoredRow(c) {
  const t = `${(c.quotedFileContent && c.quotedFileContent.value) || ''} ${c.anchor || ''}`;
  const m = t.match(/\b(C\d{2,4}[a-z]?\d*|D-[a-z0-9-]+|Q-[0-9a-f]{8})\b/);
  return m ? m[1] : null;
}

// The room that owns a row, read off the board's own decisions and Questions rows; else architect (the board's owner).
export function roomFor(rowId, { owners = {} } = {}) {
  const o = String(owners[rowId] || '').replace(/^[^a-z]+/i, '').trim().toLowerCase();
  return ROOMS.includes(o) ? o : 'architect';
}

export function ingest(comments, { sheet = 'board', ledger = resolve(REPO, LEDGER), replies = resolve(REPO, REPLIES), owners = {}, dispatch = bifurcate, dry = false, at = new Date().toISOString() } = {}) {
  const seen = new Set(readNd(ledger).map((r) => r.comment_id));
  const out = [];
  for (const c of comments || []) {
    if (!c || !c.id || seen.has(c.id) || c.resolved) continue;
    const v = authorVerdict(c); const row = anchoredRow(c); const room = roomFor(row, { owners });
    const rec = { at, comment_id: c.id, sheet, row, room, author: (c.author && (c.author.emailAddress || c.author.displayName)) || null, content: String(c.content || '').slice(0, 2000), verdict: v.execute ? 'EXECUTED' : 'SHOWN', why: v.why };
    if (v.execute && !dry) {
      const d = dispatch({ room, action: `/steer ${rec.content}`, context: `the operator's comment ${c.id} on the board sheet "${sheet}"${row ? `, anchored to row ${row}` : ''}; reply on that comment thread with the sha (C1020o)` });
      rec.bf = d.bf || null; rec.dispatch = d.ok ? 'queued' : `not queued — ${d.why}`;
      appendFileSync(replies, JSON.stringify({ at, comment_id: c.id, sheet, reply: d.ok ? `queued to ${room} as ${d.bf} — the sha follows when the room closes it` : `not queued: ${d.why}`, status: 'PENDING — no comment-reply writer on this machine (C1020a)' }) + '\n');
    }
    if (!dry) appendFileSync(ledger, JSON.stringify(rec) + '\n');
    seen.add(c.id); out.push(rec);
  }
  return out;
}

export function bifurcate({ room, action, context }) {
  const r = spawnSync(process.execPath, [resolve(REPO, 'scripts/bifurcate.mjs'), '--to', room, '--from', 'architect', '--action', action, '--context', context, '--no-fire'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  const bf = ((r.stdout || '').match(/\bbf-\d+\b/) || [])[0] || null;
  return r.status === 0 ? { ok: true, bf } : { ok: false, why: (r.stderr || r.stdout || '').trim().split('\n').pop() || `bifurcate exit ${r.status}` };
}

const REMOTE = process.env.BOARD_REMOTE || 'gdrive';
// The rclone remote's access token, refreshed; or { why } when there is none. Never logged.
export function rcloneToken({ run = (args) => spawnSync('rclone', args, { encoding: 'utf8', timeout: 60_000 }) } = {}) {
  const ls = run(['listremotes']);
  if (ls.error) return { why: 'rclone is not installed' };
  if (!String(ls.stdout || '').split('\n').includes(`${REMOTE}:`)) return { why: `no rclone remote "${REMOTE}:" — rclone config create ${REMOTE} drive scope=drive (row D-rclone-gdrive)` };
  run(['about', `${REMOTE}:`]);
  let conf = {}; try { conf = JSON.parse(run(['config', 'dump']).stdout || '{}'); } catch { return { why: 'rclone config dump did not parse' }; }
  const r = conf[REMOTE] || {};
  if (r.scope && r.scope !== 'drive') return { why: `the remote's scope is "${r.scope}" — drive.file cannot read a sheet rclone did not create; remake it with scope=drive` };
  let tok = {}; try { tok = JSON.parse(r.token || '{}'); } catch { /* fall through */ }
  return tok.access_token ? { token: tok.access_token } : { why: 'the remote holds no access token' };
}
// Drive caps requests per minute; a pull over ~100 sheets ran into it and read every later sheet as a 403 (2026-10-30: 34 of
// the sheets UNMEASURED, rateLimitExceeded). A rate-limit 403 or a 429 is a wait, never an answer: back off and retry.
export async function fetchComments(fileId, token, { fetchImpl = fetch, tries = 6, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${fileId}/comments?fields=*&includeDeleted=false&pageSize=100`, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return { comments: (await res.json()).comments || [] };
    let reason = '';
    if (res.status === 403 || res.status === 429) { try { const j = await res.json(); reason = j?.error?.errors?.[0]?.reason || ''; } catch { /* body unreadable */ } }
    const limited = res.status === 429 || /rateLimitExceeded|userRateLimitExceeded/.test(reason);
    if (!limited || i + 1 >= tries) return { why: `Drive API ${res.status}${reason ? ` (${reason})` : ''} on comments.list` };
    await wait(Math.min(64000, 2000 * 2 ** i));
  }
}
const boardSheets = () => { const f = resolve(REPO, 'data/vna/board-drive.json'); return existsSync(f) ? Object.entries(JSON.parse(readFileSync(f, 'utf8')).sheets || {}) : []; };
const ownersMap = () => { const o = {}; const df = resolve(REPO, 'data/vna/board-decisions.json'); if (existsSync(df)) for (const d of JSON.parse(readFileSync(df, 'utf8')).decisions || []) o[d.id] = d.owner; return o; };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, file, ...a] = process.argv.slice(2); const arg = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (cmd === 'probe' || cmd === 'pull') {
    const t = rcloneToken();
    if (!t.token) { console.log(`comments ${cmd}: UNMEASURED — ${t.why}`); process.exit(0); }
    const sheets = boardSheets(); let n = 0; let ex = 0;
    for (const [name, id] of cmd === 'probe' ? sheets.slice(0, 1) : sheets) {
      const r = await fetchComments(id, t.token);
      if (r.why) { console.log(`comments ${cmd} · ${name}: UNMEASURED — ${r.why}`); continue; }
      if (cmd === 'probe') { const c = r.comments[0]; console.log(`comments probe · ${name}: ${r.comments.length} comment(s) read · author fields present: ${c ? ['me', 'emailAddress'].filter((k) => k in (c.author || {})).join(', ') || 'none' : 'no comment to inspect'}`); continue; }
      const out = ingest(r.comments, { sheet: name, owners: ownersMap(), dry: process.argv.includes('--dry') }); n += out.length; ex += out.filter((x) => x.verdict === 'EXECUTED').length;
    }
    if (cmd === 'pull') console.log(`comments pull · ${n} new · ${ex} executed`);
    process.exit(0);
  }
  if (cmd !== 'ingest' || !file) { console.error('usage: board-comments.mjs ingest <comments.json> --sheet <name> [--dry] | probe | pull [--dry]'); process.exit(2); }
  const j = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const out = ingest(j.comments || j, { sheet: arg('--sheet') || 'board', owners: ownersMap(), dry: a.includes('--dry') });
  console.log(`${out.length} new comment(s) · ${out.filter((r) => r.verdict === 'EXECUTED').length} executed · ${out.filter((r) => r.verdict === 'SHOWN').length} shown only`);
  for (const r of out) console.log(`  ${r.verdict} ${r.comment_id} · ${r.row || 'no row'} → ${r.room}${r.bf ? ` · ${r.bf}` : ''} · ${r.why}`);
}
