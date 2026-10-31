#!/usr/bin/env node
// C317a — THE LICENCE FUNNEL, ONE LINE. §26's result is 2,000 licences bought through the extension; the straight path
// marks the STEPS, this reads the FLOW through them, so the next unit of work is the step with the worst drop, not the
// loudest paste. Four readings, each MEASURED or UNMEASURED with its reason, never a zero standing in for no data:
//   installs   the VS Code Marketplace gallery's install statistic for thetadriven.thetacog-mcp (C635i: the number its own
//              item page shows — 2 on 2026-10-04). The gallery's downloadCount (216 that day) counts every update download, so
//              it rides beside it as "Marketplace downloads incl. updates", never under the word installs
//   downloads  npm's last-week registry fetches of thetacog-mcp — C635c: NOT people. The 09-29→10-02 spike (646/340/253)
//              tracks the 2.54→2.56 version bumps (mirrors and CI re-fetch every release), and nothing in the funnel
//              installs from the registry, so the figure is printed as fetches and stays UNMEASURED as humans
//   doors      C635c: arrivals through the two doors C635a/b open — ref=ext-statusbar (the extension's buy door) and
//              ref=fwd (iamfim's forward-to-your-engineer link) — counted off the page log in the local mirror
//              (data/central-mirror.db · user_activity_logs + iamfim_activity, page_url). UNMEASURED, never 0, when the
//              mirror or the table is missing or no row has ever carried that ref (the door is not live yet)
//   bought     purchase rows on the credits ledger (straight-path.mjs licenceCount — the one counter, not a second)
//   foreign    of those, rows whose key fingerprint is not this host's. A buy with this host's key is a rehearsal; a
//              foreign row can still be the operator on another machine or tape key, so it is named as not-this-host, never "a stranger"
// Writes data/vna/licence-funnel.json (the milestones market probe reads it). LLM-free.
// Guard: tests/vna/c317-licence-funnel.test.mjs.
import { writeFileSync, mkdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenceCount, openLedger, TARGET } from './straight-path.mjs';
import { GALLERY_URL, galleryRequest, installsFrom } from '../../src/lib/marketplace-badge.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = 'data/vna/licence-funnel.json';
export const EXTENSION = 'thetadriven.thetacog-mcp';
export const PACKAGE = 'thetacog-mcp';

// C635i — one gallery answer, two numbers: installsFrom() (the C635h parser, one rule in one place) reads the install
// statistic; downloadCount is read beside it and labelled as what it is. Each is MEASURED or UNMEASURED with its reason.
export const MARKET_DOWNLOADS_LABEL = 'Marketplace downloads incl. updates';
export async function readGallery(fetchFn = globalThis.fetch) {
  const none = (why) => ({ installs: { status: 'UNMEASURED', why }, marketDownloads: { status: 'UNMEASURED', why } });
  try {
    const json = await (await fetchFn(GALLERY_URL, galleryRequest())).json();
    const ext = json?.results?.[0]?.extensions?.[0];
    if (!ext) return none('gallery has no item ' + EXTENSION);
    const version = ext.versions?.[0]?.version ?? null;
    const n = installsFrom(json);
    const d = ext.statistics?.find((s) => s.statisticName === 'downloadCount')?.value;
    return {
      installs: n == null ? { status: 'UNMEASURED', why: 'no install statistic' } : { status: 'MEASURED', n, version },
      marketDownloads: Number.isFinite(d) ? { status: 'MEASURED', n: d, version } : { status: 'UNMEASURED', why: 'no downloadCount statistic' },
    };
  } catch (e) { return none('gallery unreachable — ' + e.message); }
}
export async function readInstalls(fetchFn = globalThis.fetch) { return (await readGallery(fetchFn)).installs; }
export async function readMarketDownloads(fetchFn = globalThis.fetch) { return (await readGallery(fetchFn)).marketDownloads; }
export async function readDownloads(fetchFn = globalThis.fetch) {
  try {
    const j = await (await fetchFn(`https://api.npmjs.org/downloads/point/last-week/${PACKAGE}`)).json();
    return Number.isFinite(j?.downloads) ? { status: 'MEASURED', n: j.downloads, window: `${j.start}..${j.end}` } : { status: 'UNMEASURED', why: 'npm answered without a count' };
  } catch (e) { return { status: 'UNMEASURED', why: 'npm unreachable — ' + e.message }; }
}
function ownFingerprints() {
  return import('../mesh/mesh-keys.mjs').then((m) => [m.hostIdentity().fingerprint]).catch(() => null);
}

/** Our own accounts — the same list the site's admin check uses (ADMIN_EMAILS, else its fallback). A purchase on one is a rehearsal. */
export function ownAccounts(env = process.env) {
  const e = (env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return e.length ? e : ['you@example.com', 'elias@thetadriven.com', 'redacted@example.com'];
}

// C635c — THE TWO DOORS. A door's count is only a measurement once the log has seen that ref at least once: before C635a/b
// ship, "0" would read as "nobody came" when the truth is "there is no door to come through".
export const DOORS = { ext_statusbar: 'ref=ext-statusbar', fwd: 'ref=fwd' };
export const DOOR_TABLES = ['user_activity_logs', 'iamfim_activity'];
/** pure: page_url rows ({page_url, created_at}) → per-door { MEASURED n in window | UNMEASURED why } */
export function doorCounts(rows, { since = null, source = 'page log' } = {}) {
  const out = {};
  for (const [k, ref] of Object.entries(DOORS)) {
    const re = new RegExp('[?&]' + ref.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(?:&|#|$)');
    const hits = rows.filter((r) => re.test(String(r.page_url || '')));
    out[k] = hits.length === 0
      ? { status: 'UNMEASURED', why: `no ${ref} arrival in the ${source} yet — door not live` }
      : { status: 'MEASURED', n: since ? hits.filter((r) => String(r.created_at || '') >= since).length : hits.length, ever: hits.length };
  }
  return out;
}
/** the page log in the local mirror → doorCounts over the last `days`; every failure is UNMEASURED with its reason */
export async function readDoors({ dbPath = process.env.CENTRAL_MIRROR_DB || resolve(REPO, 'data/central-mirror.db'), days = 7, now = Date.now() } = {}) {
  const none = (why) => Object.fromEntries(Object.keys(DOORS).map((k) => [k, { status: 'UNMEASURED', why }]));
  if (!existsSync(dbPath)) return none('no page log — mirror ' + dbPath + ' absent');
  let db;
  try {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = DOOR_TABLES.filter((t) => db.prepare("select 1 from sqlite_master where type='table' and name=?").get(t));
    if (!tables.length) return none('mirror has no page-log table (' + DOOR_TABLES.join(', ') + ')');
    const rows = tables.flatMap((t) => db.prepare(`select page_url, created_at from ${t} where page_url like '%ref=%'`).all());
    return doorCounts(rows, { since: new Date(now - days * 864e5).toISOString(), source: 'page log (' + tables.join(' + ') + ')' });
  } catch (e) { return none('page log unreadable — ' + e.message); } finally { try { db?.close(); } catch {} }
}

const cell = (x) => (x.status === 'MEASURED' ? String(x.n) : `UNMEASURED (${x.why})`);
/** pure: the four readings → one line. The drop is only named between two MEASURED neighbours. */
export const NPM_LABEL = 'npm registry fetches last week (not people — UNMEASURED as humans)';
export function funnelLine({ installs, marketDownloads = null, downloads, bought, foreign, notOurs = null, doors = null }) {
  const b = bought.status === 'MEASURED' ? { status: 'MEASURED', n: bought.purchases } : { status: 'UNMEASURED', why: bought.source || 'ledger unread' };
  const f = foreign == null ? { status: 'UNMEASURED', why: 'own key unread' } : { status: 'MEASURED', n: foreign };
  return `funnel: installs ${cell(installs)} · ${MARKET_DOWNLOADS_LABEL} ${cell(marketDownloads || { status: 'UNMEASURED', why: 'gallery unread' })} · ${NPM_LABEL} ${cell(downloads)} · licences bought ${cell(b)} · by a key not this host's ${cell(f)} · by someone not us ${cell(notOurs == null ? { status: 'UNMEASURED', why: 'own accounts unread' } : { status: 'MEASURED', n: notOurs })} · ${doorCells(doors)} · result ${TARGET}`;
}
const doorCells = (d) => Object.entries(DOORS).map(([k, ref]) => `arrivals ${ref} ${cell(d?.[k] || { status: 'UNMEASURED', why: 'page log unread' })}`).join(' · ');

export async function readFunnel({ fetchFn, ledger = {}, own, accounts = ownAccounts(), mirror } = {}) {
  const [{ installs, marketDownloads }, downloads, doors] = await Promise.all([readGallery(fetchFn), readDownloads(fetchFn), readDoors(mirror ? { dbPath: mirror } : {})]);
  const ownFp = own === undefined ? await ownFingerprints() : own;
  const bought = await licenceCount({ ...ledger, own: ownFp || undefined, ownAccounts: accounts });
  const foreign = ownFp ? bought.foreign ?? 0 : null;
  const notOurs = ownFp ? bought.notOurs ?? null : null;
  const reading = { at: new Date().toISOString(), installs, marketDownloads, market_downloads_label: MARKET_DOWNLOADS_LABEL, downloads, bought: { status: bought.status, purchases: bought.purchases, first: bought.first, source: bought.source }, foreign, notOurs,
    npm_label: NPM_LABEL, doors };
  return { ...reading, line: funnelLine({ installs, marketDownloads, downloads, bought, foreign, notOurs, doors }) };
}

// C413 — THE INSTALL SERIES (operator 2026-09-28, verbatim: *"predict what actually moves the installs - x posting? private
// nudging? less philosphy? (credits emailed, should be followuedp )"* → *"hmm do it"*). The funnel above overwrote one JSON, so
// no one could say which post or follow-up moved a count: a number that is overwritten keeps no record of when it moved
// (AXIOM 1, retain). --series appends one row to SERIES whenever the UTC day or any reading changed; an UNMEASURED reading is
// stored as null with its status, never as 0. It also reads the grant links: minted (ref grant*, kind unclaimed) and bound
// (a grant row with a device key — what grant.mjs calls claimed). LLM-free; the tick runs it once a day (funnel-daily.sh).
export const SERIES = 'data/vna/licence-funnel-series.ndjson';
const num = (x) => (x && x.status === 'MEASURED' && Number.isFinite(x.n) ? x.n : null);
/** pure: the grant links on the ledger rows → { minted, bound } — a claim is a grant row bound to a device key */
export function grantClaims(rows) {
  const grant = (r) => String(r.ref || '').startsWith('grant');
  return { minted: rows.filter((r) => grant(r) && r.kind === 'unclaimed').length, bound: rows.filter((r) => grant(r) && r.pubkey_fingerprint).length };
}
/** pure: one series row from a reading — null where unmeasured, never 0 */
export function seriesRow(r, grants = null) {
  return { day: String(r.at).slice(0, 10), at: r.at, installs: num(r.installs), market_downloads: num(r.marketDownloads), npm_week: num(r.downloads),
    bought: r.bought && r.bought.status === 'MEASURED' ? r.bought.purchases : null, not_ours: Number.isFinite(r.notOurs) ? r.notOurs : null,
    grants_minted: grants ? grants.minted : null, grants_bound: grants ? grants.bound : null };
}
const KEYS = ['installs', 'market_downloads', 'npm_week', 'bought', 'not_ours', 'grants_minted', 'grants_bound'];
/** pure: append when the day changed or any reading moved — a quiet day still leaves one row, a busy one one per change */
export function shouldAppend(last, row) { return !last || last.day !== row.day || KEYS.some((k) => last[k] !== row[k]); }
export async function readGrants() {
  try { const { ledger } = await openLedger(); if (!ledger) return null; return grantClaims(await ledger.rows(null)); } catch { return null; }
}
export function appendSeries(row, path = resolve(REPO, SERIES)) {
  let last = null; try { const ls = readFileSync(path, 'utf8').trim().split('\n'); last = JSON.parse(ls[ls.length - 1]); } catch {}
  if (!shouldAppend(last, row)) return false;
  mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(row) + '\n'); return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await readFunnel();
  mkdirSync(resolve(REPO, 'data/vna'), { recursive: true });
  writeFileSync(resolve(REPO, OUT), JSON.stringify(r, null, 2) + '\n');
  console.log(r.line);
  if (process.argv.includes('--series')) {
    const g = await readGrants(); const row = seriesRow(r, g); const wrote = appendSeries(row);
    console.log(`series: ${wrote ? 'appended' : 'unchanged'} · grants minted ${g ? g.minted : 'UNMEASURED'} · bound to a device ${g ? g.bound : 'UNMEASURED'} → ${SERIES}`);
  }
}
