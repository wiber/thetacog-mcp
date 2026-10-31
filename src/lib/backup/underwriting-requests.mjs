// src/lib/backup/underwriting-requests.mjs — C508 THE DEPLOYER PICKS WHO TO ASK (operator 2026-10-01, verbatim: "a drop-down
// box for which insurance companies you want to contact about getting I guess Insurance or warranties or us we can start
// with us … we're gonna make the process basically asking people do you want your logo here?").
//
// The handler behind /api/backup/underwriting-request. A licence holder, on /backup/adherence, picks one counterparty from
// data/underwriting/counterparties.json for one tab (coding | deployed) of one manifest they hold. recordRequest APPENDS one
// row { account_id, manifest, counterparty, tab, pseudonym, at } to the underwriting_requests ledger (append-only: no update,
// no delete — migration 20261001_c508_underwriting_requests.sql.txt) and returns the share URL C509 serves, /risk/<pseudonym>.
// IT SENDS NOTHING. An invite to a counterparty is a draft the operator arms; this module imports no mail client, and the
// guard walks the route's whole import closure to prove it.
//
// THE PSEUDONYM (C509): first 12 hex of sha256(account_id + salt). The salt is server-side only (RISK_PSEUDONYM_SALT, or —
// when unset — derived from the service-role key, which never leaves the server; rotating that key re-keys every share URL).
// No salt → 503, never a URL derived from the email alone (an unsalted hash of an email is the email, to anyone with a list).
//
// SUFFICIENT FOR: who this holder asked to see which reading, when — and the link that reading is served at.
// NOT SUFFICIENT FOR: whether the counterparty saw it, agreed, or would cover anything (nothing is sent from here), and
// whether the work in the reading was good (Rice). Port row: none — validation and an append, no decision or mass.
// @guard tests/site/c508-deployer-picks-who-to-ask.test.mjs
//
// C509a SHARED BY DEFAULT IS A HOLDER SETTING (split from C509, 2026-10-01: the operator's "shared or shared by default
// even" needs its own row — C509 only serves a holder who recorded a share). share_default is an append-only history of
// { account_id, pseudonym, share_default, at } — newest row wins, same shape and same two stores as underwriting_requests
// above. A holder with no row ever appended reads OFF (a new account starts off; ours is turned on by the operator, not
// seeded here). When ON, risk-view.mjs's shareOf answers a pseudonym with no request row from that holder's NEWEST backup.
// @guard tests/site/c509a-share-default.test.mjs
//
// C667e PUBLIC BY DEFAULT (operator 2026-10-05, verbatim: "are we thinking properly about the public nature of this? is it public by
// default? likely yes why not.."). Before C667e a holder was private until they pressed the toggle or recorded a request, so the link
// their own landing showed them 404ed. Now the FIRST backup an account uploads appends ONE share_default ON row (recordDefaultAtFirstBackup,
// called by receive.mjs receiveBackup through the authenticated upload door): the default is a dated row in the same append-only history,
// never an implicit "no row means on". That keeps two things true: an account that never backed up still reads OFF (it has nothing to
// share), and a holder who pressed Stop sharing is never turned back on by a later backup — the default is written only when the
// pseudonym has no row at all. What the public reader sees and never sees is holder-landing.mjs SHARE_SEES / SHARE_NEVER.
// @guard tests/vna/c651-the-link-i-send-is-the-landing.test.mjs
import { createHash } from 'node:crypto';
import { UNLISTED, cleanSuggestion } from './suggestion-box.mjs';   // C544: the unlisted request's words

export const TABS = ['coding', 'deployed'];
export const SLOT_LABEL = 'your logo here?';
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9-]{1,48}$/;

/** every problem with a counterparties list, as sentences; [] when it is well-formed (ThetaDriven first, slots after) */
export function checkCounterparties(list) {
  const out = [];
  if (!Array.isArray(list) || !list.length) return ['the list is empty'];
  const first = list[0] || {};
  if (first.id !== 'thetadriven' || typeof first.logo !== 'string') out.push('ThetaDriven, with its logo, is not first');
  const ids = new Set();
  for (const c of list) {
    if (!c || !ID.test(String(c.id))) { out.push(`bad id ${JSON.stringify(c && c.id)}`); continue; }
    if (ids.has(c.id)) out.push(`duplicate id ${c.id}`); ids.add(c.id);
    if (!['insurance', 'warranty'].includes(c.kind)) out.push(`${c.id}: kind is neither insurance nor warranty`);
    if (c.logo === null && c.label !== SLOT_LABEL) out.push(`${c.id}: a slot with no logo must ask "${SLOT_LABEL}"`);
    if (c.logo !== null && typeof c.logo !== 'string') out.push(`${c.id}: logo is neither a path nor null`);
  }
  return out;
}

/** the server-side salt: RISK_PSEUDONYM_SALT, else derived from the service-role key; '' when neither is set */
export function shareSaltFromEnv(env = process.env) {
  if (env.RISK_PSEUDONYM_SALT) return String(env.RISK_PSEUDONYM_SALT);
  const k = env.CENTRAL_DB_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return k ? createHash('sha256').update(`c509-risk-pseudonym:${k}`).digest('hex') : '';
}
export const pseudonymOf = (account, salt) => createHash('sha256').update(String(account) + String(salt)).digest('hex').slice(0, 12);
export const shareUrlOf = (origin, pseudonym) => `${String(origin).replace(/\/+$/, '')}/risk/${pseudonym}`;

// ── the ledger: append + two reads, nothing else ─────────────────────────────────────────────────────────────────────────
export function memoryRequestStore() {
  const rows = [];
  return {
    kind: 'memory',
    async append(r) { rows.push({ ...r }); return r; },
    async byAccount(a) { return rows.filter((r) => r.account_id === a).map((r) => ({ ...r })); },
    async byPseudonym(p) { return rows.filter((r) => r.pseudonym === p).map((r) => ({ ...r })); },
  };
}
export function supabaseRequestStore(client, table = 'underwriting_requests') {
  const one = async (q) => { const { data, error } = await q; if (error) throw new Error(`${table}: ${error.message}`); return data; };
  const cols = 'account_id,manifest,counterparty,tab,pseudonym,at';
  return {
    kind: 'postgres',
    async append(r) { await one(client.from(table).insert(r)); return r; },
    async byAccount(a) { return (await one(client.from(table).select(cols).eq('account_id', a).order('at', { ascending: true }))) || []; },
    async byPseudonym(p) { return (await one(client.from(table).select(cols).eq('pseudonym', p).order('at', { ascending: true }))) || []; },
  };
}

/**
 * The POST handler. → { status, body }. 200 body: { row, share_url, sent: false, note }.
 * copyPanels(pseudonym, manifest) — optional; C509's copyPanelsAtShare, bound to the store and a fetch.
 * @param {{ store: ReturnType<typeof memoryRequestStore>, backup: { getReceipt(m: string): Promise<any> }, list: any[],
 *   account: string, manifest: string, counterparty: string, tab: string, salt: string, origin: string, now?: () => number,
 *   copyPanels?: ((pseudonym: string, manifest: string) => Promise<any>) | null, suggestion?: string | null }} a   (C544: suggestion = the typed words of an "unlisted" request)
 */
export async function recordRequest({ store, backup, list, account, manifest, counterparty, tab, salt, origin, now = Date.now, copyPanels = null, suggestion = null }) {
  const m = String(manifest || '').toLowerCase();
  if (!SHA.test(m)) return { status: 400, body: { why: 'manifest is the 64-hex name of an archive you backed up' } };
  if (!TABS.includes(tab)) return { status: 400, body: { why: `tab is one of ${TABS.join(' | ')}` } };
  // C544: "drop a suggestion" — a counterparty not on the list, recorded in the visitor's own words (capped, never a status)
  const words = counterparty === UNLISTED ? cleanSuggestion(suggestion) : '';
  if (counterparty === UNLISTED && !words) return { status: 400, body: { why: 'an unlisted request carries the name, domain or email you typed' } };
  const cp = counterparty === UNLISTED ? { id: UNLISTED, name: words, logo: null, unlisted: true } : (Array.isArray(list) ? list : []).find((c) => c && c.id === counterparty);
  if (!cp) return { status: 400, body: { why: `${JSON.stringify(counterparty)} is not on the counterparties list` } };
  if (!salt) return { status: 503, body: { why: 'no server-side salt is set (RISK_PSEUDONYM_SALT), so no share URL can be minted without exposing the account' } };
  const receipt = await backup.getReceipt(m);
  if (!receipt || receipt.account_id !== account) return { status: 404, body: { why: 'no backup with this manifest is receipted to your account' } };
  const pseudonym = pseudonymOf(account, salt);
  const row = { account_id: account, manifest: m, counterparty: cp.id, tab, pseudonym, at: new Date(now()).toISOString() };
  if (cp.unlisted) row.suggestion = words;   // C544: the visitor's words, stored as typed (migration 20261001_c544_underwriting_suggestion.sql.txt)
  await store.append(row);
  // C509: the panels are copied into the store NOW, at share time (risk-view.mjs copyPanelsAtShare); a failed copy never un-records the request
  let panels_copied = null;
  if (typeof copyPanels === 'function') { try { panels_copied = await copyPanels(pseudonym, m); } catch (e) { panels_copied = { copied: 0, of: 0, why: `the copy did not finish: ${e.message}` }; } }
  return { status: 200, body: { row: { manifest: m, counterparty: cp.id, tab, at: row.at, ...(cp.unlisted ? { suggestion: words } : {}) }, share_url: shareUrlOf(origin, pseudonym), sent: false, ...(panels_copied ? { panels_copied } : {}),
    note: cp.unlisted ? `Recorded your suggestion as you typed it. No message went out; a person reads it before anyone is asked.` : cp.logo === null ? `Recorded. No message went out. "${cp.name}" is an open slot — we ask insurers and warrantors whether they want it.` : `Recorded. No message went out; ${cp.name} reads the request from the ledger.` } };
}

// ── C509a: share_default, an append-only history { account_id, pseudonym, share_default, at } — newest row wins ──────────
export function memoryShareDefaultStore() {
  const rows = [];
  return {
    kind: 'memory',
    async append(r) { rows.push({ ...r }); return r; },
    async byAccount(a) { return rows.filter((r) => r.account_id === a).map((r) => ({ ...r })); },
    async byPseudonym(p) { return rows.filter((r) => r.pseudonym === p).map((r) => ({ ...r })); },
  };
}
export function supabaseShareDefaultStore(client, table = 'share_defaults') {
  const one = async (q) => { const { data, error } = await q; if (error) throw new Error(`${table}: ${error.message}`); return data; };
  const cols = 'account_id,pseudonym,share_default,at';
  return {
    kind: 'postgres',
    async append(r) { await one(client.from(table).insert(r)); return r; },
    async byAccount(a) { return (await one(client.from(table).select(cols).eq('account_id', a).order('at', { ascending: true }))) || []; },
    async byPseudonym(p) { return (await one(client.from(table).select(cols).eq('pseudonym', p).order('at', { ascending: true }))) || []; },
  };
}

/** append one { account_id, pseudonym, share_default, at } row — the holder's own act, from /backup/adherence */
export async function recordShareDefault({ store, account, salt, share_default, now = Date.now }) {
  const pseudonym = pseudonymOf(account, salt);
  const row = { account_id: account, pseudonym, share_default: !!share_default, at: new Date(now()).toISOString() };
  await store.append(row);
  return row;
}

/** the newest share_default setting for a pseudonym — false (off) when no row was ever appended (a new account's default) */
export async function shareDefaultOf(store, pseudonym) {
  const rows = await store.byPseudonym(pseudonym);
  if (!rows || !rows.length) return false;
  const last = rows.reduce((a, b) => (String(b.at) > String(a.at) ? b : a));
  return !!last.share_default;
}

/** C667e: what a new holder's backup starts as — shared. Stop sharing is the holder's own act (POST /api/backup/share-default off). */
export const SHARE_DEFAULT_FOR_NEW = true;

/**
 * C667e: on an account's first backup, record the default — one ON row — unless the pseudonym already has any row (a holder who
 * chose, either way, keeps their choice). → the appended row, or null when a choice was already on record.
 */
export async function recordDefaultAtFirstBackup({ store, account, salt, now = Date.now }) {
  if (!store || !account || !salt) return null;
  const rows = await store.byPseudonym(pseudonymOf(account, salt));
  if (rows && rows.length) return null;
  return recordShareDefault({ store, account, salt, share_default: SHARE_DEFAULT_FOR_NEW, now });
}
