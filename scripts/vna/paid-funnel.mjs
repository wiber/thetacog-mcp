#!/usr/bin/env node
// scripts/vna/paid-funnel.mjs — C240c PAID-USER GOALS IN THE LEDGER: the funnel to a paid licence, every stage read off a record.
//
// Six stages, one record each — the table or file the site's OWN routes write, never a hand-typed number:
//   signups   supabase newsletter_subscribers    the site form (src/app/api/book-club/subscribe → upsert; has_opted_in, not unsubscribed)
//   replies   supabase inbound_replies           the "yes" to the tester-licence invite (Resend inbound → src/app/api/inbound-reply); the
//                                                invite is a DRAFT (docs/comms/external/drafts/2026-09-24-tester-licence-invite-v1.md), so
//                                                a measured 0 here is the truth until it is armed
//   granted   supabase credits_ledger            grant rows — ref `grant:…` (scripts/meetings/grant.mjs mint writes kind 'unclaimed' with a
//                                                grant ref; kind 'grant' is the bound-at-mint form); distinct account_id
//   claimed   supabase credits_ledger            a key bound — the newest credit-carrying fingerprint row (claim :in, or a purchase/grant
//                                                minted straight onto a waiting device); distinct pubkey_fingerprint
//   stamped   supabase credits_ledger            kind 'witness' (delta −1 per witnessed CAR — the first stamped row is the first spend);
//                                                distinct pubkey_fingerprint, plus notary_witness_ledger's row count beside it when reachable
//   paid      supabase credits_ledger            kind 'purchase' / any row carrying stripe_session — the row the Stripe webhook writes
//                                                (src/app/api/webhooks/stripe-unified); distinct stripe_session. Stripe's own API is NOT read:
//                                                the only key on this machine is the secret (write-capable) key, and this script never calls
//                                                Stripe with one — so the Stripe-side count stays UNMEASURED by construction.
// READ-ONLY: `.select()` only, service-role client from .env.local (the same pair grant.mjs uses), nothing appended, nothing sent. A stage
// whose record is unreachable (no env file, no network, a query error) prints UNMEASURED with its why — never 0.
//   node scripts/vna/paid-funnel.mjs [--json] [--no-write]          writes data/vna/paid-funnel.json unless --no-write
// LLM-FREE.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { claimStateOf } from '../../src/lib/notary/grant-link.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlaceholder, EVENT_SOURCE as LINK_EVENT_SOURCE } from '../../src/lib/notary/grant-link.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const OUT = process.env.VNA_PAID_FUNNEL || resolve(REPO, 'data/vna/paid-funnel.json');
export const ENV_FILE = process.env.VNA_ENV_FILE || resolve(REPO, '.env.local');
export const INVITE_SUBJECT = 'Quick one: do you write code?';   // docs/comms/external/drafts/2026-09-24-tester-licence-invite-v1.md
const PAGE = 1000; const MAX_PAGES = 50;
// the operator's own accounts: his card walk (2026-09-22) and his 5,000,000-credit self-grant are on the ledger and are NOT users —
// every stage counts EXTERNAL bodies as n and carries the self rows in detail, so a funnel of one never reads as a funnel of three
export const SELF_ACCOUNTS = Object.freeze(['you@example.com', 'elias@thetadriven.com']);
// what the SITE FORM writes as source: BlogSubscribe.tsx sends blog:<slug>, the route defaults to book_club, the waitlist book-waitlist
export const SITE_FORM_SOURCE = /^(site|blog:|book_club$|book-waitlist$)/;

export const SOURCES = Object.freeze({
  signups: 'supabase newsletter_subscribers where has_opted_in and unsubscribed_at is null and source is the site form (blog:<slug> · book_club · book-waitlist; written by src/app/api/book-club/subscribe/route.ts from src/components/blog/BlogSubscribe.tsx) — imports and nominations counted beside it, never as signups',
  replies: `supabase inbound_replies where subject matches "${INVITE_SUBJECT}" (written by src/app/api/inbound-reply/route.ts from Resend inbound)`,
  granted: "supabase credits_ledger where ref like 'grant:%' or 'move:grant:%' or kind = 'grant' — distinct external account_id still holding a positive grant balance (written by scripts/meetings/grant.mjs mint / move); the operator's own accounts in detail.self, never in n",
  claimed: 'supabase credits_ledger — distinct external pubkey_fingerprint with a delta>0 row (claim :in, or a purchase/grant minted onto a waiting device; written by src/lib/auth/device-flow.mjs via /api/auth/device + /api/auth/claim); the operator\'s own device in detail.self',
  stamped: "supabase credits_ledger where kind = 'witness' — distinct pubkey_fingerprint (written by src/lib/notary/gateway.mjs via /api/notary/ingest); notary_witness_ledger row count beside it",
  paid: "supabase credits_ledger where stripe_session is not null or kind = 'purchase' — distinct external stripe_session (written by src/app/api/webhooks/stripe-unified/route.ts on checkout.session.completed); the operator's own card walk in detail.self; Stripe's own API not read (no read-only key)",
});

/** the pure counter: records = { subscribers, replies, ledger, witness } each { rows } or { unreachable: why } → six stage rows */
export function countStages({ subscribers, replies, ledger, witness }) {
  const un = (id, why) => ({ id, status: 'UNMEASURED', n: null, why, source: SOURCES[id] });
  const ok = (id, n, detail) => ({ id, status: 'MEASURED', n, detail, source: SOURCES[id] });
  const out = [];
  // signups
  if (subscribers?.rows) {
    const live = subscribers.rows.filter((r) => r.has_opted_in !== false && !r.unsubscribed_at);
    const bySource = {}; for (const r of live) bySource[r.source || 'null'] = (bySource[r.source || 'null'] || 0) + 1;
    const site = live.filter((r) => SITE_FORM_SOURCE.test(String(r.source || '')));
    out.push(ok('signups', site.length, { site_form_rows: site.length, list_opted_in: live.length, total_rows: subscribers.rows.length, by_source: bySource }));
  } else out.push(un('signups', subscribers?.unreachable || 'no record'));
  // replies
  if (replies?.rows) {
    const sub = INVITE_SUBJECT.toLowerCase();
    const yes = replies.rows.filter((r) => String(r.subject || '').toLowerCase().includes(sub));
    out.push(ok('replies', new Set(yes.map((r) => r.from_addr)).size, { total_inbound_rows: replies.rows.length, invite_reply_rows: yes.length, invite_status: 'DRAFT, not armed (f6d4a13f81)' }));
  } else out.push(un('replies', replies?.unreachable || 'no record'));
  // the ledger stages
  if (ledger?.rows) {
    const rows = ledger.rows;
    const isSelf = (a) => SELF_ACCOUNTS.includes(String(a || '').toLowerCase());
    const selfFps = new Set(rows.filter((r) => r.pubkey_fingerprint && isSelf(r.account_id)).map((r) => r.pubkey_fingerprint));
    // granted: a grant ref (or its move:) minted it; the holder is the account whose grant rows net > 0 (a claim :out or a move :out zeroes the origin)
    const isGrantRef = (ref) => /^(grant:|move:grant:|claim:grant:)/.test(String(ref || ''));
    const grants = rows.filter((r) => r.kind === 'grant' || isGrantRef(r.ref));
    const net = new Map(); for (const r of grants) net.set(r.account_id, (net.get(r.account_id) || 0) + (Number(r.delta) || 0));
    // still granted: holds a positive grant balance, or has already bound it to a device (claim :in under the same account); a
    // move's origin (net 0, no :in) drops out and its target carries the grant on
    const hasIn = new Set(rows.filter((r) => r.kind === 'claim' && Number(r.delta) > 0).map((r) => r.account_id));
    // a claim link's placeholder (claim+<hash>@claim.thetadriven.com) is not a body yet — it counts in links_unclaimed until
    // someone signs in and the move carries the grant onto their address
    const allHolders = [...net].filter(([a, v]) => v > 0 || hasIn.has(a)).map(([a]) => a);
    const holders = allHolders.filter((a) => !isPlaceholder(a));
    const extHolders = holders.filter((a) => !isSelf(a));
    out.push(ok('granted', extHolders.length, { grant_rows: grants.length, holders: extHolders, links_unclaimed: allHolders.filter(isPlaceholder).length, credits_external_unbound: extHolders.reduce((s, a) => s + Math.max(0, net.get(a)), 0), self: holders.filter(isSelf).map((a) => ({ account: a, credits_unbound: net.get(a) })) }));
    const boundAll = new Set(rows.filter((r) => r.pubkey_fingerprint && Number(r.delta) > 0 && r.kind !== 'refusal').map((r) => r.pubkey_fingerprint));
    const bound = [...boundAll].filter((fp) => !selfFps.has(fp));
    const claimIn = rows.filter((r) => r.kind === 'claim' && Number(r.delta) > 0);
    out.push(ok('claimed', bound.length, { claim_in_rows: claimIn.length, accounts: [...new Set(claimIn.map((r) => r.account_id))], self: [...boundAll].filter((fp) => selfFps.has(fp)) }));
    const wit = rows.filter((r) => r.kind === 'witness');
    const witFp = new Set(wit.map((r) => r.pubkey_fingerprint));
    out.push(ok('stamped', [...witFp].filter((fp) => !selfFps.has(fp)).length, { witness_rows: wit.length, self: [...witFp].filter((fp) => selfFps.has(fp)), witness_ledger_rows: witness?.rows ? witness.rows.length : (witness?.count ?? null), witness_ledger: witness?.unreachable ? `UNMEASURED — ${witness.unreachable}` : 'MEASURED' }));
    const paidRows = rows.filter((r) => r.stripe_session || r.kind === 'purchase');
    const sessions = new Map(); for (const r of paidRows) sessions.set(r.stripe_session || r.ref, r.account_id);
    const extSessions = [...sessions].filter(([, a]) => !isSelf(a));
    out.push(ok('paid', extSessions.length, { purchase_rows: paidRows.length, self: [...sessions].filter(([, a]) => isSelf(a)).map(([s, a]) => ({ session: s.slice(0, 24) + '…', account: a })), stripe_api: 'UNMEASURED — not read (only a write-capable key on this machine)' }));
  } else { for (const id of ['granted', 'claimed', 'stamped', 'paid']) out.push(un(id, ledger?.unreachable || 'no record')); }
  return out;
}

/** THE CLAIM-LINK FUNNEL, PER PERSON. links = grant-actions.ndjson rows with action 'link' (who ↔ link_id; the token is never
 *  there); events = user_events rows with source_type 'grant_link' (link_opened / signed_in / claimed, written by /claim);
 *  ledger = credits_ledger rows. claimed and device_bound are read off the LEDGER (move:<ref>:<email> and
 *  claim:move:<ref>:<email>:in), the event row is beside it — a missing event never unclaims a grant the ledger moved. */
export function linkFunnel({ links = [], events, ledger }) {
  const evOk = !!events?.rows; const lgOk = !!ledger?.rows;
  return links.filter((l) => l.action === 'link' && l.link_id).map((l) => {
    const ev = evOk ? events.rows.filter((e) => e.source_id === l.link_id) : null;
    const seen = (stage) => (ev ? ev.some((e) => e.metadata?.stage === stage || e.event_type === `${LINK_EVENT_SOURCE}:${stage}`) : null);
    const cs = lgOk ? claimStateOf(ledger.rows, l.ref) : null;
    const moved = cs?.claimed ? { account_id: cs.email } : null; const bound = cs ? cs.bound : false; const revoked = cs ? cs.revoked : null;
    return { who: l.who, link_id: l.link_id, minted: l.at, link_opened: seen('link_opened'), signed_in: seen('signed_in'),
      claimed: lgOk ? !!moved : null, email: moved ? moved.account_id : null, device_bound: lgOk ? bound : null, revoked,
      events: evOk ? 'MEASURED' : `UNMEASURED — ${events?.unreachable || 'no record'}`, ledger: lgOk ? 'MEASURED' : `UNMEASURED — ${ledger?.unreachable || 'no record'}` };
  });
}
export const GRANT_ACTIONS = process.env.VNA_GRANT_ACTIONS || resolve(REPO, 'data/meetings/grant-actions.ndjson');
export function readLinks(file = GRANT_ACTIONS) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.action === 'link');
}

/** conversions between consecutive MEASURED stages; UNMEASURED when either side is */
export function conversions(stages) {
  const out = [];
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1], b = stages[i];
    if (a.status !== 'MEASURED' || b.status !== 'MEASURED') { out.push({ from: a.id, to: b.id, status: 'UNMEASURED', rate: null, why: `${a.status !== 'MEASURED' ? a.id : b.id} is UNMEASURED` }); continue; }
    out.push({ from: a.id, to: b.id, status: 'MEASURED', rate: a.n > 0 ? Number((b.n / a.n).toFixed(4)) : null, lost: a.n - b.n });
  }
  return out;
}

/** the biggest drop: the measured conversion that loses the most bodies (absolute), ties to the lowest rate */
export function biggestDrop(convs) {
  const m = convs.filter((c) => c.status === 'MEASURED');
  if (!m.length) return null;
  return m.slice().sort((x, y) => (y.lost - x.lost) || ((x.rate ?? 1) - (y.rate ?? 1)))[0];
}

// ── the reads (service-role, select only) ────────────────────────────────────────────────────────────────────────────
function readEnv(file = ENV_FILE) {
  if (!existsSync(file)) return null;
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
}
async function client() {
  if (process.env.VNA_NO_NETWORK) return { unreachable: 'VNA_NO_NETWORK set — no network read attempted' };
  // C2305: the npx door hands .env.local through as env, so the environment is the fallback when the file is not beside the record
  const env = readEnv() || (process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env : null);
  if (!env) return { unreachable: `no env file at ${ENV_FILE} — no credentials, nothing read` };
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { unreachable: 'env file carries no NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — no credentials' };
  try { const { createClient } = await import('@supabase/supabase-js'); return { db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) }; }
  catch (e) { return { unreachable: `supabase client unavailable: ${e.message}` }; }
}
async function selectAll(db, table, cols, shape = (q) => q) {
  const rows = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await shape(db.from(table).select(cols)).range(p * PAGE, (p + 1) * PAGE - 1);
    if (error) return { unreachable: `${table}: ${error.message}` };
    rows.push(...(data || [])); if (!data || data.length < PAGE) break;
  }
  return { rows };
}
async function countOnly(db, table) {
  const { count, error } = await db.from(table).select('seq', { count: 'exact', head: true });
  return error ? { unreachable: `${table}: ${error.message}` } : { count };
}
export async function readRecords() {
  const c = await client();
  if (c.unreachable) { const u = { unreachable: c.unreachable }; return { subscribers: u, replies: u, ledger: u, witness: u, linkEvents: u }; }
  const t = (ms, p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ unreachable: `network: no answer in ${ms} ms` }), ms))]);
  const [subscribers, replies, ledger, witness, linkEvents] = await Promise.all([
    t(20000, selectAll(c.db, 'newsletter_subscribers', 'email,source,has_opted_in,unsubscribed_at')),
    t(20000, selectAll(c.db, 'inbound_replies', 'from_addr,subject,processed')),
    t(20000, selectAll(c.db, 'credits_ledger', 'account_id,pubkey_fingerprint,delta,ref,kind,stripe_session,at', (q) => q.order('id', { ascending: true }))),
    t(20000, countOnly(c.db, 'notary_witness_ledger')),
    t(20000, selectAll(c.db, 'user_events', 'event_type,source_id,metadata,created_at', (q) => q.eq('source_type', LINK_EVENT_SOURCE).order('id', { ascending: true }))),
  ]);
  return { subscribers, replies, ledger, witness, linkEvents };
}

// ── the goals: a hurdle on a stage, the surface that moves it, the falsifier ────────────────────────────────────────
export const GOALS = Object.freeze([
  { id: 'G1', stage: 'replies', metric: 'distinct addresses that replied "yes" to the tester-licence invite', hurdle: 10, surface: 'docs/comms/external/drafts/2026-09-24-tester-licence-invite-v1.md (armed by the operator, C240d) + src/app/api/inbound-reply/route.ts', falsifier: 'a "yes" in the inbox with no inbound_replies row, or a granted account with no reply row before it' },
  { id: 'G2', stage: 'claimed', metric: 'distinct device keys bound to granted credits (claim :in rows)', hurdle: 10, surface: 'packages/thetacog-mcp-vscode/src/auth-manager.ts (the paste-the-token / device flow) + src/app/api/auth/claim/route.ts', falsifier: 'a granted account older than 7 days with no claim :in row — the install path lost them, not the invite' },
  { id: 'G3', stage: 'stamped', metric: 'distinct keys with at least one witness row (the first stamped row = the first credit spent)', hurdle: 5, surface: 'packages/thetacog-mcp-vscode/src/extension.ts (the 💳 / stamp door) + src/app/api/notary/ingest/route.ts', falsifier: 'a claimed key older than 7 days with no witness row — the extension never reached the notary from their machine' },
  { id: 'G4', stage: 'paid', metric: 'distinct Stripe sessions on credits_ledger (a purchase row, never a grant)', hurdle: 1, surface: 'src/app/api/create-checkout-session/notary-seat/route.ts + src/app/api/webhooks/stripe-unified/route.ts', falsifier: 'a Stripe checkout.session.completed with no credits_ledger row carrying its session id' },
]);

export function funnel(records, at = new Date().toISOString()) {
  const stages = countStages(records); const convs = conversions(stages); const drop = biggestDrop(convs);
  const owner = { signups: 'the site form (src/app/api/book-club/subscribe) and the landing copy that feeds it', replies: 'the invite (docs/comms/external/drafts/2026-09-24-tester-licence-invite-v1.md) — its one question and its arming (C240d)', granted: 'scripts/meetings/grant.mjs mint — the operator act after a yes', claimed: 'the extension install + token paste (packages/thetacog-mcp-vscode/src/auth-manager.ts, /api/auth/claim)', stamped: 'the extension stamp door (packages/thetacog-mcp-vscode/src/extension.ts → /api/notary/ingest)', paid: 'the checkout (src/app/api/create-checkout-session/notary-seat) and the paid page' };
  const links = linkFunnel({ links: records.links || [], events: records.linkEvents, ledger: records.ledger });
  return { at, links, sufficientFor: 'how many bodies stand at each stage of the funnel to a paid licence, read off the record each stage writes; NOT sufficient for why any one of them stopped (that is a conversation, not a row)', stages, conversions: convs, biggestDrop: drop ? { ...drop, owner: owner[drop.to] } : null, goals: GOALS.map((g) => ({ ...g, current: stages.find((s) => s.id === g.stage)?.n ?? null, status: stages.find((s) => s.id === g.stage)?.status })), owners: owner };
}

if (process.argv[1] && /paid-funnel\.mjs$/.test(process.argv[1])) {
  const args = process.argv.slice(2); const json = args.includes('--json'); const noWrite = args.includes('--no-write');
  const f = funnel({ ...(await readRecords()), links: readLinks() });
  if (!noWrite) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(f, null, 2) + '\n'); }
  if (json) { console.log(JSON.stringify(f, null, 2)); }
  else {
    console.log(`paid funnel · ${f.at}${noWrite ? '' : ` → ${OUT}`}`);
    for (const s of f.stages) console.log(`  ${s.id.padEnd(8)} ${s.status === 'MEASURED' ? `n=${s.n}` : 'UNMEASURED'}  ${s.status === 'MEASURED' ? JSON.stringify(s.detail) : `why: ${s.why}`}\n           source: ${s.source}`);
    for (const c of f.conversions) console.log(`  ${c.from} → ${c.to}: ${c.status === 'MEASURED' ? `${c.rate === null ? 'n/a' : (c.rate * 100).toFixed(1) + '%'} (lost ${c.lost})` : `UNMEASURED — ${c.why}`}`);
    console.log(f.biggestDrop ? `  biggest drop: ${f.biggestDrop.from} → ${f.biggestDrop.to} (lost ${f.biggestDrop.lost}) · owner: ${f.biggestDrop.owner}` : '  biggest drop: UNMEASURED');
    for (const l of f.links) console.log(`  link · ${l.who} · opened ${l.link_opened} · signed in ${l.signed_in} · claimed ${l.claimed}${l.email ? ` (${l.email})` : ''} · device bound ${l.device_bound}${l.revoked ? ' · REVOKED' : ''}`);
    for (const g of f.goals) console.log(`  ${g.id} ${g.stage}: ${g.status === 'MEASURED' ? g.current : 'UNMEASURED'} / ${g.hurdle} — ${g.metric}`);
  }
}
