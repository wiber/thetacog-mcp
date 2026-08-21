#!/usr/bin/env node
/**
 * gmail-sync.js — the SENT-ONLY Gmail → SQLite connector (zero LLM tokens).
 *
 * Why (operator, 2026-06-12): "check there, that cron is not a claude cron — then the
 * checking is near free once asking." The old poller (inbox-reply-poll.sh) burned a full
 * headless Claude session per check. This replaces it: a plain Node script dumps the
 * operator's SENT mail (replying lives in the outbox) into .thetacog/rules.db, and any
 * later "did I reply to X?" is one sqlite query — near free. Sent-only is enough AND is
 * the safer scope: gmail.readonly, never send.
 *
 * Tables (in the package's existing source-of-truth DB, .thetacog/rules.db):
 *   gmail_sent(id PK, thread_id, date_utc, to_addrs, subject, snippet, body_text,
 *              in_reply_to, synced_at)
 *   canonicals(path PK, title, sha, content, indexed_at) + canonicals_fts (FTS5)
 *     — `--index-canon` walks the canon manifest (CLAUDE.md, the ledgers, the Q&A) into
 *       the same DB so the dashboard's localhost server serves rules AND canon from one
 *       place. That is the thetacog bundle boundary: the DB ships, the connector ships,
 *       the credentials never do.
 *
 * Auth: uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from env or <repo>/.env.local.
 *   One-time:  node gmail-sync.js --auth     (loopback consent → refresh token →
 *              .thetacog/gmail-connector.json, chmod 600, gitignored)
 *   Then:      node gmail-sync.js [--days 1] [--q 'extra gmail query']
 *   Canon:     node gmail-sync.js --index-canon
 *   Read:      sqlite3 .thetacog/rules.db "select date_utc,subject from gmail_sent order by date_utc desc limit 10"
 *
 * Scheduling: cron/launchd runs this directly — it must NEVER invoke claude/gemini.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { execSync } from 'child_process';

const REPO = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();
const THETACOG_DIR = path.join(REPO, '.thetacog');
const DB_PATH = process.env.THETACOG_DB || path.join(THETACOG_DIR, 'rules.db');
const CRED_PATH = path.join(THETACOG_DIR, 'gmail-connector.json');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : d; };

// ── env: prefer process env, fall back to .env.local (read-only parse, never sourced) ──
function envLocal(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = fs.readFileSync(path.join(REPO, '.env.local'), 'utf8')
      .match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

// ── schema ──
function openDb() {
  fs.mkdirSync(THETACOG_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gmail_sent (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT,
      date_utc    TEXT,
      to_addrs    TEXT,
      subject     TEXT,
      snippet     TEXT,
      body_text   TEXT,
      in_reply_to TEXT,
      synced_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gmail_sent_date ON gmail_sent(date_utc);
    CREATE TABLE IF NOT EXISTS canonicals (
      path       TEXT PRIMARY KEY,
      title      TEXT,
      sha        TEXT,
      content    TEXT,
      indexed_at TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS canonicals_fts USING fts5(path, title, content);
  `);
  return db;
}

// ── tiny fetch helpers (no deps) ──
async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
async function gapi(pathname, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`gmail ${pathname} → ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// ── --auth: loopback OAuth consent → refresh token on disk ──
async function doAuth(clientId, clientSecret) {
  const port = 8765;
  const redirect = `http://127.0.0.1:${port}/cb`;
  const state = crypto.randomBytes(8).toString('hex');
  const consent = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent', state,
  });
  console.log('\nOpen this URL, approve read-only Gmail access:\n\n' + consent + '\n');
  try { execSync(`open '${consent}'`); } catch { /* headless — paste by hand */ }
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== '/cb') { res.end(); return; }
      res.end('thetacog gmail connector authorized — close this tab.');
      srv.close();
      u.searchParams.get('state') === state
        ? resolve(u.searchParams.get('code'))
        : reject(new Error('state mismatch'));
    }).listen(port, '127.0.0.1');
  });
  const tok = await postForm('https://oauth2.googleapis.com/token', {
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirect, grant_type: 'authorization_code',
  });
  if (!tok.refresh_token) throw new Error('no refresh_token returned — remove prior grant at myaccount.google.com/permissions and retry');
  fs.writeFileSync(CRED_PATH, JSON.stringify({ refresh_token: tok.refresh_token, scope: SCOPE, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`✅ refresh token saved → ${CRED_PATH} (mode 600). Run a sync: node gmail-sync.js`);
}

async function accessToken(clientId, clientSecret) {
  const { refresh_token } = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  const tok = await postForm('https://oauth2.googleapis.com/token', {
    refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
  });
  return tok.access_token;
}

// ── body extraction: prefer text/plain part, strip quoted reply tails ──
function bodyText(payload) {
  const parts = [];
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data) parts.push(p.body.data);
    (p.parts || []).forEach(walk);
  })(payload);
  if (!parts.length && payload?.body?.data) parts.push(payload.body.data);
  const raw = parts.map(d => Buffer.from(d, 'base64url').toString('utf8')).join('\n');
  // keep the NEW text: cut at the standard quote header ("On <date> ... wrote:")
  return raw.split(/\r?\nOn .{10,80} wrote:\r?\n/)[0].trim().slice(0, 20000);
}

async function doSync(clientId, clientSecret) {
  const days = arg('days', '1');
  const extraQ = arg('q', '');
  const token = await accessToken(clientId, clientSecret);
  const q = `in:sent newer_than:${days}d ${extraQ}`.trim();
  const db = openDb();
  const up = db.prepare(`INSERT INTO gmail_sent (id, thread_id, date_utc, to_addrs, subject, snippet, body_text, in_reply_to, synced_at)
    VALUES (@id,@thread_id,@date_utc,@to_addrs,@subject,@snippet,@body_text,@in_reply_to,@synced_at)
    ON CONFLICT(id) DO UPDATE SET snippet=@snippet, body_text=@body_text, synced_at=@synced_at`);
  let pageToken, fetched = 0, listed = 0;
  do {
    const list = await gapi(`messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`, token);
    pageToken = list.nextPageToken;
    for (const m of list.messages || []) {
      listed++;
      const have = db.prepare('SELECT synced_at FROM gmail_sent WHERE id=?').get(m.id);
      if (have && !flag('force')) continue;            // idempotent: skip already-synced
      const full = await gapi(`messages/${m.id}?format=full`, token);
      const h = Object.fromEntries((full.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
      up.run({
        id: m.id, thread_id: full.threadId,
        date_utc: new Date(Number(full.internalDate)).toISOString(),
        to_addrs: h.to || '', subject: h.subject || '', snippet: full.snippet || '',
        body_text: bodyText(full.payload), in_reply_to: h['in-reply-to'] || '',
        synced_at: new Date().toISOString(),
      });
      fetched++;
    }
  } while (pageToken);
  console.log(`✅ gmail_sent: ${listed} listed, ${fetched} new/updated (window ${days}d) → ${DB_PATH}`);
}

// ── --index-canon: the rules/canonicals index the localhost dashboard serves ──
const CANON_MANIFEST = [
  'CLAUDE.md',
  'docs/architecture/anti-rules-ledger.md',
  'docs/architecture/pmu-pipeline-ledger.md',
  'docs/architecture/pmu-architecture-qa.md',
  'docs/architecture/pmu-ideal-case-spec.md',
  'docs/architecture/pmu-dogfood-best-practices.md',
];
function indexCanon() {
  const db = openDb();
  const up = db.prepare(`INSERT INTO canonicals (path,title,sha,content,indexed_at)
    VALUES (@path,@title,@sha,@content,@indexed_at)
    ON CONFLICT(path) DO UPDATE SET title=@title, sha=@sha, content=@content, indexed_at=@indexed_at`);
  db.exec('DELETE FROM canonicals_fts');
  const fts = db.prepare('INSERT INTO canonicals_fts (path,title,content) VALUES (?,?,?)');
  let n = 0;
  for (const rel of CANON_MANIFEST) {
    const fp = path.join(REPO, rel);
    if (!fs.existsSync(fp)) { console.error(`  ⚠ missing: ${rel}`); continue; }
    const content = fs.readFileSync(fp, 'utf8');
    const title = (content.match(/^#\s+(.+)$/m) || [, path.basename(rel)])[1];
    const sha = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    up.run({ path: rel, title, sha, content, indexed_at: new Date().toISOString() });
    fts.run(rel, title, content);
    n++;
  }
  console.log(`✅ canonicals: ${n}/${CANON_MANIFEST.length} indexed (FTS5) → ${DB_PATH}`);
}

// ── main ──
const clientId = envLocal('GOOGLE_CLIENT_ID');
const clientSecret = envLocal('GOOGLE_CLIENT_SECRET');
try {
  if (flag('index-canon')) { indexCanon(); }
  else if (flag('auth')) {
    if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found (env or .env.local)');
    await doAuth(clientId, clientSecret);
  } else {
    if (!fs.existsSync(CRED_PATH)) throw new Error(`no connector credentials — run once: node gmail-sync.js --auth`);
    await doSync(clientId, clientSecret);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
