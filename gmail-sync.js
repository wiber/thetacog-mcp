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
 *   Preflight: node gmail-sync.js --preflight   (HEADLESS — everything except the human click)
 *   One-time:  node gmail-sync.js --auth     (loopback consent → refresh token →
 *              .thetacog/gmail-connector.json, chmod 600, gitignored)
 *   Then:      node gmail-sync.js [--days 1] [--q 'extra gmail query']
 *   Canon:     node gmail-sync.js --index-canon
 *   Read:      sqlite3 .thetacog/rules.db "select date_utc,subject from gmail_sent order by date_utc desc limit 10"
 *
 * THE REDIRECT URI IS DISCOVERED, NEVER ASSUMED (bf-5030, 2026-09-04). --auth hardcoded
 * http://127.0.0.1:8765/cb, which is NOT registered on this OAuth client — so the command the
 * blindness verdict told the operator to run opened a browser onto a Google error page and could
 * never have worked, in any session, with or without a human present. Measured that day: the
 * client accepts http://localhost:3000/api/auth/callback/google, https://thetadriven.com/api/auth/
 * callback/google and http://localhost:3000, and rejects both 8765 forms with redirect_uri_mismatch.
 * A port number somebody once picked is a PROXY for "a URI this client accepts"; the construct is
 * answerable — ask Google, which is what probeRedirectUris() now does before the browser opens.
 *
 * Scheduling: cron/launchd runs this directly — it must NEVER invoke claude/gemini.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';

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
    -- INBOUND. Sent-only was "enough" for "did I reply to X?", and it is NOT enough for the
    -- opposite question — "did THEY reply to me?" — which is what every follow-up decision
    -- actually turns on. Without this table an email thread reads 0-in/N-out whether the person
    -- ignored us or answered warmly last Tuesday, and a ranker cannot tell those apart.
    -- Same scope as before: gmail.readonly, never send.
    CREATE TABLE IF NOT EXISTS gmail_inbox (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT,
      date_utc    TEXT,
      from_addr   TEXT,
      to_addrs    TEXT,
      subject     TEXT,
      snippet     TEXT,
      body_text   TEXT,
      in_reply_to TEXT,
      synced_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gmail_inbox_date ON gmail_inbox(date_utc);
    CREATE INDEX IF NOT EXISTS idx_gmail_inbox_from ON gmail_inbox(from_addr);
    CREATE TABLE IF NOT EXISTS canonicals (
      path       TEXT PRIMARY KEY,
      title      TEXT,
      sha        TEXT,
      content    TEXT,
      indexed_at TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS canonicals_fts USING fts5(path, title, content);
  `);
  // message_id (2026-09-11): the RFC Message-ID header of an inbox row. A reply that carries it as
  // In-Reply-To lands IN THE SAME GMAIL THREAD as the mail it answers — which is how the unsubscribe
  // sweep's per-person dossier reaches the operator beside the unsubscribe itself, not in a digest.
  // Additive migration: rows synced before this column exist with message_id NULL (thread by
  // subject, best effort); --force re-fetches them.
  const inboxCols = db.prepare("PRAGMA table_info(gmail_inbox)").all().map((c) => c.name);
  if (!inboxCols.includes('message_id')) db.exec('ALTER TABLE gmail_inbox ADD COLUMN message_id TEXT');
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

// ── redirect-URI discovery: ask the client what it accepts, never assume ──

/**
 * Ordered by preference, not by likelihood. The dedicated 8765 form is FIRST because it collides
 * with nothing; the :3000 forms work today but share a port with the Next dev server, so choosing
 * one silently makes the auth flow fail whenever dev happens to be up. Preferring the quiet port
 * means the moment the operator registers it in Cloud Console the collision disappears for good.
 */
export const REDIRECT_CANDIDATES = [
  'http://127.0.0.1:8765/cb',
  'http://localhost:8765/cb',
  'http://localhost:3000/api/auth/callback/google',
  'http://localhost:3000',
  'http://127.0.0.1:3000/api/auth/callback/google',
];

export function consentUrl(clientId, redirect, state) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent', state,
  });
}

/**
 * Google reports a bad redirect URI as a 302 to /signin/oauth/error carrying a base64url authError
 * blob — NOT as a 4xx, and NOT with the phrase anywhere in the visible body. A status check reads
 * that as success, which is precisely how a URI nobody had registered survived in this file.
 * The construct is "did Google refuse this URI", and the only place that is written is the blob.
 */
export function classifyConsentResponse({ status, location }) {
  const loc = location || '';
  const m = loc.match(/[?&]authError=([^&]+)/);
  if (m) {
    let decoded = '';
    try { decoded = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
    catch { /* undecodable blob is still a refusal */ }
    const err = (decoded.match(/redirect_uri_mismatch|invalid_client|disabled_client|invalid_scope|admin_policy_enforced|access_blocked|org_internal/) || ['unknown_oauth_error'])[0];
    return { ok: false, error: err };
  }
  if (status === 200 || (status >= 300 && status < 400)) return { ok: true, error: null };
  return { ok: false, error: `unexpected_status_${status}` };
}

/**
 * A bogus authorization code separates "these credentials are wrong" from "these credentials are
 * fine and only the human click is missing" — Google validates the CLIENT before it ever looks at
 * the code, so invalid_grant is a pass and invalid_client is the failure.
 */
export function classifyTokenProbe(json) {
  const e = json?.error || '';
  if (e === 'invalid_grant') return { ok: true, error: null };
  if (e) return { ok: false, error: e };
  return { ok: false, error: 'unexpected_token_response' };
}

/** Loopback URIs only — a https:// callback cannot be caught by a CLI on this machine. */
export function loopbackPort(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
    return Number(u.port || 80);
  } catch { return null; }
}

function portHolder(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    return out ? out.split('\n').slice(1).map(l => l.trim().split(/\s+/).slice(0, 2).join(' ')).join(', ') : null;
  } catch { return null; }
}

async function probeRedirectUris(clientId, candidates = REDIRECT_CANDIDATES) {
  const out = [];
  for (const uri of candidates) {
    let verdict;
    try {
      const res = await fetch(consentUrl(clientId, uri, 'preflight'), { redirect: 'manual' });
      verdict = classifyConsentResponse({ status: res.status, location: res.headers.get('location') });
    } catch (e) { verdict = { ok: false, error: `network:${e.message}` }; }
    const port = loopbackPort(uri);
    out.push({ uri, ...verdict, port, heldBy: verdict.ok && port ? portHolder(port) : null });
  }
  return out;
}

/**
 * --preflight: everything the OAuth restore needs EXCEPT the human click, run headlessly, so an
 * unattended fire can say WHY inbound email is blind instead of only that it is. Exit 0 means the
 * only remaining step is a person approving the consent screen.
 */
async function doPreflight(clientId, clientSecret) {
  const problems = [];
  console.log('\n  ── gmail inbound OAuth · preflight ──────────────────────────────');
  console.log(`  credentials file  ${fs.existsSync(CRED_PATH) ? `✓ present  ${CRED_PATH}` : `✗ absent   ${CRED_PATH}`}`);
  if (!clientId || !clientSecret) {
    console.log('  client id/secret  ✗ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found (env or .env.local)');
    problems.push('credentials missing');
  } else {
    const probe = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: 'preflight-bogus', client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code' }).toString(),
    }).then(r => r.json()).catch(e => ({ error: `network:${e.message}` }));
    const v = classifyTokenProbe(probe);
    console.log(`  client id/secret  ${v.ok ? '✓ accepted by Google' : `✗ ${v.error}`}`);
    if (!v.ok) problems.push(`client rejected: ${v.error}`);

    const rows = await probeRedirectUris(clientId);
    console.log('  redirect URIs registered on this client:');
    for (const r of rows) {
      const held = r.heldBy ? `  ⚠ port ${r.port} held by ${r.heldBy}` : '';
      console.log(`    ${r.ok ? '✓ ACCEPTED' : `✗ ${r.error}`.padEnd(26)}  ${r.uri}${held}`);
    }
    const usable = rows.find(r => r.ok && r.port && !r.heldBy);
    if (usable) {
      console.log(`\n  ▶ usable loopback: ${usable.uri}`);
      console.log('  ▶ REMAINING STEP IS HUMAN: node packages/thetacog-mcp/gmail-sync.js --auth');
    } else {
      const acceptedButHeld = rows.filter(r => r.ok && r.port && r.heldBy);
      if (acceptedButHeld.length) problems.push(`every accepted loopback port is occupied (${acceptedButHeld.map(r => r.port).join(', ')}) — stop that listener, or register ${REDIRECT_CANDIDATES[0]} in Google Cloud Console`);
      else problems.push(`no loopback redirect URI is registered — add ${REDIRECT_CANDIDATES[0]} to this OAuth client in Google Cloud Console (APIs & Services → Credentials)`);
    }
  }
  console.log('  ────────────────────────────────────────────────────────────────');
  if (problems.length) { problems.forEach(p => console.log(`  ✗ ${p}`)); return 1; }
  console.log('  ✓ configuration is sound — only the consent click is missing\n');
  return 0;
}

// ── --auth: loopback OAuth consent → refresh token on disk ──
async function doAuth(clientId, clientSecret) {
  const rows = await probeRedirectUris(clientId);
  const chosen = rows.find(r => r.ok && r.port && !r.heldBy);
  if (!chosen) {
    const detail = rows.map(r => `    ${r.ok ? 'ACCEPTED' : r.error}  ${r.uri}${r.heldBy ? ` (port ${r.port} held by ${r.heldBy})` : ''}`).join('\n');
    throw new Error(`no usable loopback redirect URI for this OAuth client:\n${detail}\n  → register ${REDIRECT_CANDIDATES[0]} in Google Cloud Console (APIs & Services → Credentials), or free the held port.\n  → re-check headlessly with: node packages/thetacog-mcp/gmail-sync.js --preflight`);
  }
  const redirect = chosen.uri;
  const port = chosen.port;
  const cbPath = new URL(redirect).pathname || '/';
  const state = crypto.randomBytes(8).toString('hex');
  const consent = consentUrl(clientId, redirect, state);
  console.log(`\nUsing registered redirect: ${redirect}`);
  console.log('\nOpen this URL, approve read-only Gmail access:\n\n' + consent + '\n');
  try { execSync(`open '${consent}'`); } catch { /* headless — paste by hand */ }
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== cbPath) { res.end(); return; }
      res.end('thetacog gmail connector authorized — close this tab.');
      srv.close();
      u.searchParams.get('state') === state
        ? resolve(u.searchParams.get('code'))
        : reject(new Error('state mismatch'));
    }).listen(port, new URL(redirect).hostname === 'localhost' ? '127.0.0.1' : '127.0.0.1');
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

/**
 * One walker, two mailboxes. `sent` answers "did I reply to X?"; `inbox` answers "did X reply to
 * me?" — and only the second one can tell an ignored thread from an answered one, which is the
 * question every follow-up decision actually turns on.
 */
async function syncMailbox(db, token, mailbox, days, extraQ) {
  const isInbox = mailbox === 'inbox';
  const table = isInbox ? 'gmail_inbox' : 'gmail_sent';
  // -category:promotions -category:social keeps the newsletter tide out of the reply signal.
  const q = (isInbox
    ? `in:inbox -in:chats -category:promotions -category:social newer_than:${days}d ${extraQ}`
    : `in:sent newer_than:${days}d ${extraQ}`).trim();

  const cols = isInbox
    ? '(id, thread_id, date_utc, from_addr, to_addrs, subject, snippet, body_text, in_reply_to, message_id, synced_at)'
    : '(id, thread_id, date_utc, to_addrs, subject, snippet, body_text, in_reply_to, synced_at)';
  const vals = isInbox
    ? '(@id,@thread_id,@date_utc,@from_addr,@to_addrs,@subject,@snippet,@body_text,@in_reply_to,@message_id,@synced_at)'
    : '(@id,@thread_id,@date_utc,@to_addrs,@subject,@snippet,@body_text,@in_reply_to,@synced_at)';
  const up = db.prepare(`INSERT INTO ${table} ${cols} VALUES ${vals}
    ON CONFLICT(id) DO UPDATE SET snippet=@snippet, body_text=@body_text, synced_at=@synced_at${isInbox ? ', message_id=COALESCE(@message_id, message_id)' : ''}`);
  const seen = db.prepare(`SELECT synced_at FROM ${table} WHERE id=?`);

  let pageToken, fetched = 0, listed = 0;
  do {
    const list = await gapi(`messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`, token);
    pageToken = list.nextPageToken;
    for (const m of list.messages || []) {
      listed++;
      if (seen.get(m.id) && !flag('force')) continue;   // idempotent: skip already-synced
      const full = await gapi(`messages/${m.id}?format=full`, token);
      const h = Object.fromEntries((full.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
      const row = {
        id: m.id, thread_id: full.threadId,
        date_utc: new Date(Number(full.internalDate)).toISOString(),
        to_addrs: h.to || '', subject: h.subject || '', snippet: full.snippet || '',
        body_text: bodyText(full.payload), in_reply_to: h['in-reply-to'] || '',
        synced_at: new Date().toISOString(),
      };
      if (isInbox) { row.from_addr = h.from || ''; row.message_id = h['message-id'] || null; }
      up.run(row);
      fetched++;
    }
  } while (pageToken);
  console.log(`✅ ${table}: ${listed} listed, ${fetched} new/updated (window ${days}d)`);
  return fetched;
}

async function doSync(clientId, clientSecret) {
  const days = arg('days', '1');
  const extraQ = arg('q', '');
  const token = await accessToken(clientId, clientSecret);
  const db = openDb();
  // Both by default. --sent-only preserves the original behaviour for anything that depended on it.
  await syncMailbox(db, token, 'sent', days, extraQ);
  if (!flag('sent-only')) await syncMailbox(db, token, 'inbox', days, extraQ);
  console.log(`   → ${DB_PATH}`);
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
// Guarded so the classifiers above can be imported by tests without running a sync. A module whose
// top level performs the work cannot be tested at all, and untestable was how the wrong redirect
// URI survived here long enough to blind every reply-check in the repo.
const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const clientId = envLocal('GOOGLE_CLIENT_ID');
  const clientSecret = envLocal('GOOGLE_CLIENT_SECRET');
  try {
    if (flag('index-canon')) { indexCanon(); }
    else if (flag('preflight')) {
      process.exit(await doPreflight(clientId, clientSecret));
    }
    else if (flag('auth')) {
      if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found (env or .env.local)');
      await doAuth(clientId, clientSecret);
    } else {
      if (!fs.existsSync(CRED_PATH)) throw new Error(`no connector credentials — run once: node gmail-sync.js --auth  (check config first: --preflight)`);
      await doSync(clientId, clientSecret);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
