#!/usr/bin/env node
/**
 * gmail-send.js — the SEND half of the Gmail connector, deliberately kept in its own file with
 * its own credential, because the read half promises something this one cannot keep.
 *
 * WHY A SECOND FILE AND A SECOND TOKEN. gmail-sync.js is scoped gmail.readonly and says so in
 * its header: "sent-only is enough AND is the safer scope: gmail.readonly, never send." That
 * promise is worth keeping. Widening ITS token to include send would silently convert every
 * scheduled read into a process holding send authority. So send gets a separate grant, a
 * separate file on disk (.thetacog/gmail-sender.json), and a separate blast radius.
 *
 * WHAT IT DOES, AND THE ONE THING IT REFUSES TO DO. It sends a Gmail DRAFT that already exists,
 * by id, exactly as written (gmail.send + drafts scope). It does NOT compose, does not edit,
 * does not re-thread, and has no model in it. The draft was written and graded elsewhere; this
 * file's entire job is to put it on the wire at a scheduled moment. That separation is what lets
 * the scheduler be dumb: a queue that could rewrite its payload at send time would be a second,
 * ungraded author.
 *
 * Auth: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from env or <repo>/.env.local — the same OAuth
 * client the read connector uses.
 *   One-time:  node packages/thetacog-mcp/gmail-send.js --auth
 *   Probe:     node packages/thetacog-mcp/gmail-send.js --check      (exit 0 = send scope live)
 *   Send:      node packages/thetacog-mcp/gmail-send.js --draft r123456
 *
 * Scheduling: scripts/controller/outbox-send.sh calls this. It must NEVER invoke claude/gemini.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const REPO = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();
const CRED_PATH = path.join(REPO, '.thetacog/gmail-sender.json');
// drafts.send needs BOTH: gmail.send to put mail on the wire, and gmail.compose to read the
// draft back out of the mailbox. Neither alone is sufficient; asking for gmail.modify instead
// would hand this token delete authority it has no use for.
const SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : d; };

function env(name) {
  if (process.env[name]) return process.env[name];
  const f = path.join(REPO, '.env.local');
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

async function postForm(url, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

async function doAuth(clientId, clientSecret) {
  const port = 8766;                       // NOT 8765 — the read connector owns that one
  const redirect = `http://127.0.0.1:${port}/cb`;
  const state = crypto.randomBytes(8).toString('hex');
  const consent = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent', state,
  });
  console.log('\nOpen this URL and approve Gmail SEND access:\n\n' + consent + '\n');
  try { execSync(`open '${consent}'`); } catch { /* headless — paste by hand */ }
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== '/cb') { res.end(); return; }
      res.end('thetacog gmail SENDER authorized — close this tab.');
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
  if (!tok.refresh_token) throw new Error('no refresh_token returned — remove the prior grant at myaccount.google.com/permissions and retry');
  fs.writeFileSync(CRED_PATH, JSON.stringify({ refresh_token: tok.refresh_token, scope: SCOPE, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`✅ send token saved → ${CRED_PATH} (mode 600). Probe it: node packages/thetacog-mcp/gmail-send.js --check`);
}

async function accessToken(clientId, clientSecret) {
  const { refresh_token } = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  const tok = await postForm('https://oauth2.googleapis.com/token', {
    refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
  });
  return tok.access_token;
}

export function hasSendScope() {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
    return typeof c.refresh_token === 'string' && /gmail\.send/.test(c.scope || '');
  } catch { return false; }
}

async function sendDraft(token, draftId) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: draftId }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`drafts.send ${draftId} → ${r.status} ${JSON.stringify(j)}`);
  return j;                                 // { id, threadId, labelIds:[SENT] }
}

async function main() {
  const clientId = env('GOOGLE_CLIENT_ID');
  const clientSecret = env('GOOGLE_CLIENT_SECRET');
  if (flag('check')) {
    if (!hasSendScope()) {
      console.error(`❌ no send scope · ${CRED_PATH} absent or readonly.\n   Grant once: node packages/thetacog-mcp/gmail-send.js --auth`);
      process.exit(1);
    }
    console.log(`✅ send scope present → ${CRED_PATH}`);
    process.exit(0);
  }
  if (!clientId || !clientSecret) {
    console.error('❌ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing (env or .env.local)');
    process.exit(2);
  }
  if (flag('auth')) { await doAuth(clientId, clientSecret); process.exit(0); }
  const draftId = arg('draft');
  if (!draftId) { console.error('usage: --auth | --check | --draft <id>'); process.exit(2); }
  const token = await accessToken(clientId, clientSecret);
  const res = await sendDraft(token, draftId);
  console.log(`✅ sent draft ${draftId} → message ${res.id} (thread ${res.threadId})`);
}

if (process.argv[1] && process.argv[1].endsWith('gmail-send.js')) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
