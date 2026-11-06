// src/lib/notary/grant-link.mjs — THE CLAIM LINK: a comp grant for a person we know only by name (a WhatsApp group hides
// numbers and addresses), bound to WHATEVER email they sign in with.
//
// No new schema. The grant is an ordinary `unclaimed` grant: row (scripts/meetings/grant.mjs grantRow) minted under a
// PLACEHOLDER account derived from the token's hash — claim+<sha256(token)[0:32]>@claim.thetadriven.com — so the plaintext
// token lives only in the link that was sent. Claiming is the MOVE grant.mjs already does (moveRows: 'claim' −N ref
// claim:<g>:out under the placeholder, 'unclaimed' +N ref move:<g>:<email> under the signed-in address), appended :out FIRST
// so the ledger's idempotency on that fixed ref is the single-use latch: a second claimant's :out append comes back
// appended:false and nothing else is written. From there the credits bind on /device exactly as a bought licence does,
// and grant.mjs revoke works on either side of the move (its isGrantRef already reads move:grant:).
//
// BEARER BY DESIGN — unlike /api/license/claim (a private key: link AND mailbox), this link is the whole credential: the
// first signed-in email wins the comp. Acceptable because the value is a comp, single-use, revocable, and every claim is
// receipted on the ledger with the email it went to.
// Guard: tests/meetings/grant-claim-link.test.mjs
import { createHash, randomBytes } from 'node:crypto';

export const LINK_DOMAIN = 'claim.thetadriven.com';
export const LINK_BASE = 'https://thetadriven.com/claim/';
export const EVENT_SOURCE = 'grant_link';   // user_events.source_type — the funnel reader's filter
export const STAGES = Object.freeze(['link_opened', 'signed_in', 'claimed', 'device_bound']);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const newToken = () => randomBytes(18).toString('base64url');   // 24 url-safe chars, 144 bits
export const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(t);
export const tokenHash = (t) => createHash('sha256').update(String(t)).digest('hex');
/** the public handle of a link: the first 32 hex of sha256(token) — safe to log, commit and put in an event row */
export const linkId = (t) => tokenHash(t).slice(0, 32);
export const placeholderFor = (t) => `claim+${linkId(t)}@${LINK_DOMAIN}`;
export const isPlaceholder = (a) => new RegExp(`^claim\\+[0-9a-f]{32}@${LINK_DOMAIN.replace(/\./g, '\\.')}$`).test(String(a || ''));
export const linkUrl = (t) => `${LINK_BASE}${t}`;

// MOVE an UNCLAIMED grant to another address. Two rows under existing kinds, no new schema: (1) 'claim' −N under the old
// account with ref claim:<grantRef>:out — the exact ref the ledger's own claim() writes, so unclaimedOf(old) stops offering
// it; (2) 'unclaimed' +N under the new account, ref move:<grantRef>:<to>. Both refs are fixed, so a re-run appends nothing.
// (Lives here, not in grant.mjs, because the /claim route is the second caller; grant.mjs re-exports it.)
export function moveRows({ grant, to }) {
  const dest = String(to || '').trim().toLowerCase();
  if (!EMAIL.test(dest)) throw new Error(`--to must be an email (got ${to})`);
  if (!grant || grant.kind !== 'unclaimed' || !String(grant.ref).startsWith('grant:')) throw new Error('only an unclaimed grant: row can be moved');
  if (dest === grant.account_id) throw new Error('--to is the account the grant already sits on');
  return [
    { account_id: grant.account_id, pubkey_fingerprint: null, delta: -grant.delta, kind: 'claim', stripe_session: null, ref: `claim:${grant.ref}:out` },
    { account_id: dest, pubkey_fingerprint: null, delta: grant.delta, kind: 'unclaimed', stripe_session: null, ref: `move:${grant.ref}:${dest}` },
  ];
}

// where a link grant went: the move:<g>:<email> row (found by ref prefix), or null
async function movedTo(ledger, grantRef) {
  const s = ledger.store; const prefix = `move:${grantRef}:`;
  const rows = typeof s.byRefPrefix === 'function' ? await s.byRefPrefix(prefix) : (await s.all(null)).filter((r) => String(r.ref).startsWith(prefix));
  const r = rows.find((x) => x.kind === 'unclaimed' && x.delta > 0);
  return r ? r.account_id : null;
}

/** READ-ONLY: what this token points at. status ∈ unknown | open | claimed | revoked; `to` = the email it went to (raw — the page masks) */
export async function linkStatus(ledger, token) {
  if (!isToken(token)) return { status: 'unknown' };
  const acct = placeholderFor(token);
  const rows = await ledger.store.byAccount(acct);
  const grant = rows.find((r) => r.kind === 'unclaimed' && String(r.ref).startsWith('grant:'));
  if (!grant) return { status: 'unknown' };
  const open = (await ledger.unclaimedOf(acct)).filter((r) => r.ref === grant.ref);
  if (open.length) return { status: 'open', credits: grant.delta, ref: grant.ref, placeholder: acct };
  const to = await movedTo(ledger, grant.ref);
  return to ? { status: 'claimed', credits: grant.delta, ref: grant.ref, to, placeholder: acct } : { status: 'revoked', credits: grant.delta, ref: grant.ref, placeholder: acct };
}

/** THE CLAIM: token + the signed-in email → the grant moves to that email, once. Returns linkStatus's shape plus `now` (true = this call moved it). */
export async function claimLink(ledger, token, email) {
  const who = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(who) || isPlaceholder(who)) throw new Error('claim needs the signed-in email');
  const st = await linkStatus(ledger, token);
  if (st.status !== 'open') return { ...st, now: false };
  const grant = (await ledger.unclaimedOf(st.placeholder)).find((r) => r.ref === st.ref);
  const [out, into] = moveRows({ grant, to: who });
  const o = await ledger.append(out);
  if (!o.appended) return { ...(await linkStatus(ledger, token)), now: false };   // another claimant's :out won the race
  await ledger.append(into);
  return { status: 'claimed', credits: grant.delta, ref: grant.ref, to: who, placeholder: st.placeholder, now: true };
}

/** refuse to mint a second grant on a link that already has one (the ref carries the date, so a re-run on another day would not collide) */
export async function linkAlreadyMinted(ledger, token) {
  return (await ledger.store.byAccount(placeholderFor(token))).some((r) => String(r.ref).startsWith('grant:'));
}

/** a funnel event row for user_events (the table the site already writes events to); the link is named by its id, never its token */
export function linkEvent(stage, token, meta = {}) {
  if (!STAGES.includes(stage)) throw new Error(`stage must be one of ${STAGES.join(' | ')}`);
  return { event_type: `${EVENT_SOURCE}:${stage}`, source_type: EVENT_SOURCE, source_id: linkId(token), user_id: null, metadata: { stage, link_id: linkId(token), ...meta } };
}

// the server's handles: a service-role credits ledger + an event writer. Refuses honestly when the env is not there.
// GRANT_LINK_STORE=memory arms a per-isolate memory ledger (the guard's; never durable).
const G = globalThis; const KEY = '__grantLinkArmed';
export async function armGrantLink() {
  if (G[KEY]) return G[KEY];
  const { createCreditsLedger, supabaseCreditsStore, memoryCreditsStore } = await import('./credits-ledger.mjs');
  if (process.env.GRANT_LINK_STORE === 'memory') {
    const events = [];
    G[KEY] = { ledger: createCreditsLedger(memoryCreditsStore()), events, async event(row) { events.push(row); } };
    return G[KEY];
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.CENTRAL_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { refuse: 'the credits ledger is not reachable (no supabase service credentials on this deployment)' };
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  G[KEY] = { ledger: createCreditsLedger(supabaseCreditsStore(db)), async event(row) { try { await db.from('user_events').insert(row); } catch { /* an event is a reading, never a gate */ } } };
  return G[KEY];
}
export function disarmGrantLink() { G[KEY] = null; }

// WHO RENDERED THE LINK — so a board can say "opened by someone who is not the operator" (operator 2026-09-27: "see when the
// link is rendered (by not me), clicked, and licenses claimed"). A pasted link is fetched first by the chat app's unfurl bot,
// then by the operator checking it, and only then maybe by the person: three renders that must not read as one "opened".
// Sufficient for WHICH CLASS of client asked; NOT for which human (an anonymous visitor is not proven to be the recipient).
export const PREVIEW_UA = /WhatsApp|facebookexternalhit|Facebot|Slackbot|Twitterbot|TelegramBot|LinkedInBot|Discordbot|SkypeUriPreview|Googlebot|bingbot|redditbot|Applebot|embedly|iMessage|com\.apple\.messages|vkShare|Pinterest/i;
export const BOT_UA = /bot\b|crawler|spider|curl\/|wget|python-requests|node-fetch|axios|HeadlessChrome|Playwright|Puppeteer|undici/i;
export function classifyViewer({ ua = '', host = '', email = null, isAdmin = false } = {}) {
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(String(host))) return 'local';
  if (isAdmin) return 'operator';
  if (PREVIEW_UA.test(ua)) return 'preview';
  if (!ua || BOT_UA.test(ua)) return 'bot';
  return email ? 'signed-in' : 'visitor';
}
/** the viewer classes that count as "someone who is not the operator actually looked" */
export const HUMAN_NOT_ME = Object.freeze(['visitor', 'signed-in']);

/** claimed / bound / revoked for one grant ref, read off the ledger rows (the one place these ref conventions are read). */
export function claimStateOf(rows, grantRef) {
  const moved = rows.find((r) => r.kind === 'unclaimed' && String(r.ref).startsWith(`move:${grantRef}:`)) || null;
  const boundRow = moved ? rows.find((r) => r.kind === 'claim' && Number(r.delta) > 0 && r.ref === `claim:${moved.ref}:in`) : null;
  const bound = !!boundRow;
  const revoked = !moved && rows.some((r) => r.ref === `claim:${grantRef}:out`);
  return { claimed: !!moved, email: moved ? moved.account_id : null, claimedAt: moved?.at || null, bound, boundAt: boundRow?.at || null, revoked };
}
