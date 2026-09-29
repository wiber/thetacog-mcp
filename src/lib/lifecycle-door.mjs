// src/lib/lifecycle-door.mjs — C426c THE CLICK IS COUNTED (operator 2026-09-29: "… and prep what is needed (track when people
// click the button)"). ONE place for the lifecycle doors: which button opens which page, the two query keys every opened
// URL carries (`src=<surface>&btn=<door>`), and the landing event a page records when it is reached through one of them.
// A click is counted, a person is not (C426 invariant 5): the event is { btn, src, page, ts } and nothing else — no IP, no
// hostname, no user agent, no email, no key fingerprint. The extension sends no telemetry of its own; the count is the
// site's, written when the browser lands on the page the button opened.
// No node: imports — the site's pages, the /api/track route and scripts/vna all import this file (a Next page cannot import
// scripts/, the C154 rule in notary-seat-checkout.mjs), so the rule lives where every caller can reach it.
// @guard tests/vna/c426c-the-click-is-counted.test.mjs

// THE DOOR TABLE. `cmd` is the extension command the sidebar control runs (the controls manifest, C89a, names it);
// `path` is the page the door lands on; `opens` says whether the button opens that page in a browser. A door that opens no
// page is named with the reason and the stage that counts it instead — never silently left out.
export const LIFECYCLE_DOORS = Object.freeze({
  fund: Object.freeze({ btn: 'fund', cmd: 'vna.notariseTape', path: '/notarise', opens: true, row: 'C102a',
    what: '💳 Fund Autonomy Ledger and 🛒 Buy licences — both run vna.notariseTape; auth-flow.mjs notarise builds the URL' }),
  countersign: Object.freeze({ btn: 'countersign', cmd: 'vna.backupTape', path: '/backup', opens: false, row: 'C102c',
    what: '🔗 Countersign (backup) — a POST to /api/backup/upload, no page opened (C102c); counted at the uploaded stage off backup_receipts' }),
  grant: Object.freeze({ btn: 'grant', cmd: null, path: '/inspect', opens: true, row: 'C426b',
    what: 'the carrier-grant button — C426b builds it; its link is lifecycleHref(\'grant\', …)' }),
  consult: Object.freeze({ btn: 'consult', cmd: null, path: '/adapters', opens: true, row: 'C426d',
    what: '/adapters\' config-consult link — C426d builds it; its link is lifecycleHref(\'consult\', …)' }),
});
// A control whose label names a lifecycle verb but is NOT a lifecycle door, each with the argument — never a silent skip.
export const NOT_A_LIFECYCLE_DOOR = Object.freeze({
  'vna.inspectHalt': 'reads the runner\'s halt reason off the local receipt — "inspect" here is the worker\'s halt, it opens no site page',
  'vna.connect': 'the device sign-in (C75/C84a): it opens the server\'s own verification_uri_complete (/device?user_code=…, pinned by C84a); the signed-in stage is read off device_codes, not a landing',
});
export const DOOR_IDS = Object.freeze(Object.keys(LIFECYCLE_DOORS));
export const SITE = 'https://thetadriven.com';
// the surfaces a door can be pressed on: the IDE sidebar, a terminal run of the script, a receipt/summary line, the site itself
export const SURFACE_RE = /^[a-z][a-z0-9-]{0,23}$/;
export const LIFECYCLE_VERB = /\b(fund|notari[sz]e|buy|countersign|back ?up|grant|inspect|consult)\b/i;

/** the door a sidebar command runs, or null */
export function doorOfCmd(cmd) { return Object.values(LIFECYCLE_DOORS).find((d) => d.cmd && d.cmd === cmd) || null; }

/** THE ONE HELPER: a lifecycle URL with `src=<surface>&btn=<door>` appended. `url` may already carry a query (the notarise
 *  href's fp/h/code) or be a path; with no url, the door's own page on the site. Throws on an unknown door or surface —
 *  a door that is not in the table is not a lifecycle door. */
export function lifecycleHref(door, { src, url = null, base = SITE } = {}) {
  const d = LIFECYCLE_DOORS[door];
  if (!d) throw new Error(`lifecycleHref: unknown door ${door} — the doors are ${DOOR_IDS.join(' · ')}`);
  const s = String(src || '');
  if (!SURFACE_RE.test(s)) throw new Error(`lifecycleHref: src must name the surface (lowercase, ≤24): ${JSON.stringify(src)}`);
  const u = String(url || `${base}${d.path}`);
  return `${u}${u.includes('?') ? '&' : '?'}src=${s}&btn=${d.btn}`;
}

// ── the landing event ───────────────────────────────────────────────────────────────────────────────────────────────────
export const LANDING_EVENT = 'lifecycle_door_landing';
export const LANDING_KEYS = Object.freeze(['btn', 'src', 'page', 'ts']);
const first = (v) => (Array.isArray(v) ? v[0] : v);

/** pure: the event for one landing, built from the page's query and its own path — exactly LANDING_KEYS, or null when the
 *  URL carries no known `btn` (a landing that was not a door press is not counted here). Whatever else the caller hands in
 *  (an IP, a host, a fingerprint, a user agent) is never read. */
export function landingEvent({ btn, src, page, ts } = {}, now = () => new Date().toISOString()) {
  const b = String(first(btn) || '').toLowerCase();
  if (!DOOR_IDS.includes(b)) return null;
  const s0 = String(first(src) || '').toLowerCase();
  const s = SURFACE_RE.test(s0) ? s0 : 'unknown';
  const p = String(page || '');
  if (!/^\/[a-z0-9/_-]{0,63}$/i.test(p)) return null;
  return { btn: b, src: s, page: p, ts: ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toISOString() : now() };
}

/** pure: the user_events row the track pipeline stores for a landing. visitor_session_id, user_id null; the metadata is the
 *  event and nothing else — the IP / user-agent / email enrichment /api/track adds to other events is never applied here. */
export function landingRow(ev) {
  if (!ev) return null;
  const metadata = {}; for (const k of LANDING_KEYS) metadata[k] = ev[k];
  return { event_type: LANDING_EVENT, user_id: null, visitor_session_id: null, source_id: ev.btn, source_type: 'lifecycle_door', metadata };
}

/** the default writer: the same user_events table /api/track writes, through a service-role client; absent env → not written */
async function defaultInsert(row) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { written: false, why: 'no track store configured' };
  const { createClient } = await import('@supabase/supabase-js');
  const c = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { error } = await c.from('user_events').insert(row);
  return error ? { written: false, why: error.message } : { written: true };
}

/** one event per landing: a page calls this with its searchParams and its own path. Bounded (a slow store never holds the
 *  render past `timeoutMs`), never throws — a failed count is not a failed page. Returns the event recorded, or null.
 *  @param {{ btn?: unknown, src?: unknown }} searchParams
 *  @param {string} page
 *  @param {{ insert?: (row: object) => unknown, now?: () => string, timeoutMs?: number }} [opts] */
export async function recordLanding(searchParams, page, { insert = defaultInsert, now, timeoutMs = 800 } = {}) {
  const q = searchParams || {};
  const ev = landingEvent({ btn: q.btn, src: q.src, page }, now);
  if (!ev) return null;
  let t = null;
  try { await Promise.race([Promise.resolve(insert(landingRow(ev))), new Promise((r) => { t = setTimeout(r, timeoutMs); })]); } catch { /* the count is best-effort; the page stands */ } finally { clearTimeout(t); }
  return ev;
}

/** /api/track's branch for a client beacon of the same event: the body's btn/src/page only, stripped the same way */
export function landingRowFromBody(body) {
  const m = (body && body.metadata) || {};
  return landingRow(landingEvent({ btn: m.btn ?? body?.source_id, src: m.src, page: m.page, ts: m.ts }));
}
