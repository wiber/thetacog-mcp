// src/lib/backup/warranty.mjs — C896 THE WARRANTY PORTAL, THE ONE READING (operator 2026-10-17: "lets build towards the full warraty
// portal capability sufficiently mapped and ship … we can just build it. Warranties can be used as loss history for insurance later?").
//
// The warranty is on OUR act, never the agent's (C895; N.Y. Ins. Law § 1101(a)(1), DFS OGC 03-09-03). This module is the one pure
// reading every warranty surface draws from — the page, the loss-history export, the dogfood receipt — so a fire is decided once.
//
//   TERMS      the holder's declared terms, carried INSIDE the archive as warranty-terms.json (so they sit under the archive's own
//              sha256) and frozen at the server's received_at for the first archive that carried them — a record the holder did not
//              write (AXIOM 1, W3). No terms in the archive: the page reads PREVIEW at DEFAULT_TERMS, never BOUND.
//   ELIGIBLE   a commit row whose drift walk LANDED, with a finite off-lane share, declaring at least one spec row, every Merkle proof
//              verified: the lane existed before the work, and the reading exists.
//   FIRE       eligible && offPct >= terms.threshold_pct — a predicate over fields the pipeline wrote, no adjuster.
//   OUR MISSES what the warranty pays a service credit on: a fire the trigger did not record as declared, a re-run whose bytes differ,
//              a dispatch outside its window. Each is UNMEASURED here until its ledger exists — named, never a fabricated zero.
//              (A seq gap is NOT a miss: the tape's seq counter is shared across row kinds, so gaps are numbering, not lost writes.)
//   LOSS HISTORY  the exposure (eligible rows and period), the fires, the misses — the packet a contractual-liability carrier reads.
//              Fires before the freeze are the BACKTEST, after it the LIVE record; they are never summed into one rate.
//
// SUFFICIENT FOR: whether the trigger fired on this tape under these terms, recomputable by anyone holding the rows and the terms.
// NOT SUFFICIENT FOR: whether the agent's work was good (Rice, 1953), whether a fire caused a loss, or any price.
// Port row: C896r — the fire predicate decides; it ports into the crate beside the odometer once a second caller exists.
// @guard tests/site/c896-warranty-reading.test.mjs
import { createHash } from 'node:crypto';
import { READINESS_LINE, QUESTIONS } from './standing-answers.mjs';   // C936: the broker draft quotes the one readiness line and the AI-wording question, never its own copy

export const WARRANTY_ENTRY = 'warranty-terms.json';   // where the terms ride inside the archive (scripts/vna/backup.mjs carries it)
export const TERMS_VERSION = 1;
// The default threshold is the writable point on our own backtest (data/vna/parametric-trigger.json: at 60% off lane the event is rare
// enough to price). The window and the remedy are declared, not measured; both read as terms, never as a promise about an agent.
export const DEFAULT_TERMS = Object.freeze({ version: TERMS_VERSION, threshold_pct: 60, dispatch_window_hours: 24, remedy: 'service credit of one licence-month per miss, plus dispatched engineering' });

export const WARRANTED = Object.freeze([
  { id: 'tape', line: 'The tape is written: every row signed and chained on your machine, re-hashed when it reaches us.' },
  { id: 'trigger', line: 'The trigger fires as declared: the predicate below, over fields the pipeline wrote, at the threshold in your terms.' },
  { id: 'rerun', line: 'A re-run gives the same bytes: the placement recomputes from the commit to the same receipt.' },
  { id: 'dispatch', line: 'The dispatch arrives inside the window your terms name, carrying the frozen tape around the fire.' },
]);
export const NOT_WARRANTED = 'Never warranted: what your agent does, whether its work was good (undecidable, Rice 1953), or your own service level. Those stay yours and your carrier\'s.';
export const PREDICATE = ['kind === "commit"', 'delta.status === "landed"', 'Number.isFinite(delta.offPct)', 'proofs.items.length > 0 && every item verified', 'delta.offPct >= terms.threshold_pct'];

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
/** the terms' identity: sha256 over their canonical JSON — the same terms always hash the same */
export const termsSha = (t) => createHash('sha256').update(canon(t)).digest('hex');

/** a shape check on the holder's terms, never a repair: a threshold in (0,100], a window in hours, a remedy in words; else null */
export function termsOf(buf) {
  let t = null; try { t = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!t || typeof t !== 'object' || t.version !== TERMS_VERSION) return null;
  const th = Number(t.threshold_pct); const w = Number(t.dispatch_window_hours);
  if (!(th > 0 && th <= 100) || !(w > 0 && w <= 24 * 30) || typeof t.remedy !== 'string' || !t.remedy.trim()) return null;
  return { version: TERMS_VERSION, threshold_pct: th, dispatch_window_hours: w, remedy: t.remedy.trim().slice(0, 200) };
}

export function eligible(r) {
  if (!r || r.kind !== 'commit' || !r.delta || r.delta.status !== 'landed' || !Number.isFinite(r.delta.offPct)) return false;
  const items = r.proofs && Array.isArray(r.proofs.items) ? r.proofs.items : [];
  return items.length > 0 && items.every((i) => i && i.verified === true);
}
export const fires = (r, terms) => eligible(r) && r.delta.offPct >= terms.threshold_pct;

const fireOf = (r) => ({ seq: r.seq ?? null, ts: r.ts ?? null, sha: r.sha ?? null, row_sha: r.row_sha ?? null, offPct: r.delta.offPct, specs: (r.proofs.items || []).map((i) => i.label).filter(Boolean), pixels: Array.isArray(r.placements) ? r.placements.map((p) => p && p.pixel).filter(Boolean) : [] });

/** the intake bundle a dispatched provider receives for one fire: the fire, its neighbours on the tape, nothing from the code */
export function intakeFor(rows, fire, { around = 5 } = {}) {
  const i = rows.findIndex((r) => r && r.row_sha === fire.row_sha);
  const near = i < 0 ? [] : rows.slice(Math.max(0, i - around), i + around + 1).map((r) => ({ seq: r.seq ?? null, ts: r.ts ?? null, kind: r.kind ?? null, sha: r.sha ?? null, row_sha: r.row_sha ?? null, offPct: r.delta && Number.isFinite(r.delta.offPct) ? r.delta.offPct : null }));
  return { fire, around: near, carries: 'receipt fields only (drift-reading RECEIPT_FIELDS); the code stays on the holder\'s machine' };
}

/**
 * C920: THE DETERMINISTIC TEMPLATE — one intake bundle (intakeFor's shape) becomes one spec row's text: the cell (the
 * fire's own pixel, its ShortLex address), the call (the commit that landed it), the ring (the off-lane share that
 * fired), and the guard name (derived from the fire's row hash, never invented). The same bundle always yields the
 * same text; a fire with no pixel names UNMEASURED rather than guessing a cell.
 */
export function specRowTextFor(intake, { id = 'Cxxx' } = {}) {
  const f = intake && intake.fire;
  if (!f) return null;
  const cell = Array.isArray(f.pixels) && f.pixels[0] ? f.pixels[0] : 'UNMEASURED — no pixel on this fire';
  const call = f.sha ? String(f.sha).slice(0, 10) : String(f.row_sha || '').slice(0, 10);
  const ring = Number.isFinite(f.offPct) ? `${f.offPct}% off lane` : 'UNMEASURED — no off-lane share on this fire';
  const specs = Array.isArray(f.specs) && f.specs.length ? f.specs.join(' ') : 'no spec row declared';
  const guard = `tests/vna/${String(id).toLowerCase()}-fire-${String(f.row_sha || 'unknown').slice(0, 10)}.test.mjs`;
  return `- [ ] ${id} (guard: \`${guard}\`) THE FIRE AT ${cell} — commit ${call} landed ${ring}, declaring ${specs}. Opened from the warranty intake bundle (C897), fire ${f.row_sha}.`;
}

/**
 * The one reading. rows: receipt-only tape rows (time order). terms: from the archive, or null for PREVIEW. frozenAt: the server's
 * received_at of the first archive that carried these terms (null for PREVIEW).
 */
export function warrantyReading({ rows = [], terms = null, frozenAt = null } = {}) {
  const bound = !!(terms && frozenAt && Number.isFinite(Date.parse(frozenAt)));
  const t = bound ? terms : DEFAULT_TERMS;
  const freeze = bound ? Date.parse(frozenAt) : null;
  const el = rows.filter(eligible);
  const ts = el.map((r) => Date.parse(r.ts)).filter(Number.isFinite);
  const isLive = (r) => freeze !== null && Number.isFinite(Date.parse(r.ts)) && Date.parse(r.ts) >= freeze;
  const live = el.filter(isLive); const before = el.filter((r) => !isLive(r));
  const liveFires = live.filter((r) => fires(r, t)).map(fireOf);
  const backtestFires = before.filter((r) => fires(r, t)).map(fireOf);
  const rate = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : null);
  return {
    status: bound ? 'BOUND' : 'PREVIEW',
    terms: t, terms_sha: termsSha(t), frozen_at: bound ? new Date(freeze).toISOString() : null,
    predicate: PREDICATE,
    exposure: { rows: rows.length, commits: rows.filter((r) => r && r.kind === 'commit').length, eligible: el.length, from: ts.length ? new Date(Math.min(...ts)).toISOString() : null, to: ts.length ? new Date(Math.max(...ts)).toISOString() : null },
    live: { eligible: live.length, fires: liveFires, ratePct: rate(liveFires.length, live.length) },
    backtest: { eligible: before.length, fires: backtestFires, ratePct: rate(backtestFires.length, before.length) },
    misses: {
      trigger: { status: 'UNMEASURED', why: 'needs a second recompute of the predicate by someone other than this server; the packet carries row_sha per fire so a carrier can run it' },
      rerun: { status: 'UNMEASURED', why: 'the re-run needs the commit bytes, which stay on the holder\'s machine (npx thetacog-mcp verify <url> runs it there)' },
      dispatch: { status: 'UNMEASURED', why: 'no dispatch ledger was read for this packet (C898): a fire with no recorded dispatch cannot have met or missed its window' },
    },
  };
}

export const INTAKE_CAP = 20;   // C897: live fires whose intake bundle rides in the packet (newest first kept)
export const FREEZE_WALK_CAP = 12;   // archives read back when finding the first one that carried these terms
/**
 * The freeze point: the server's received_at for the FIRST of this account's archives that carried the same terms, walking back from
 * this manifest through older receipts until the terms differ or stop. Every read re-hashes its archive (store.tapesFor). The walk is
 * capped; a capped walk returns { capped: true } and the page says "at least since". Returns null when this archive carries no terms.
 */
export async function frozenAtFor({ store, account_id, manifest, terms }) {
  if (!terms || !store || typeof store.receiptsByAccount !== 'function') return null;
  const want = termsSha(terms);
  const mine = ((await store.receiptsByAccount(account_id)) || []).filter((r) => r && r.received_at).sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
  const i = mine.findIndex((r) => r.sha === manifest);
  if (i < 0) return null;
  let earliest = mine[i].received_at; let read = 1;
  for (const r of mine.slice(i + 1)) {
    if (read >= FREEZE_WALK_CAP) return { frozen_at: earliest, capped: true, read };
    read++;
    let t = null; try { t = (await store.tapesFor(r.sha)).warrantyTerms; } catch { t = null; }
    if (!t || termsSha(t) !== want) break;
    earliest = r.received_at;
  }
  return { frozen_at: earliest, capped: false, read };
}

/** the packet for one backup, holder only: the route's whole body, so the route decides nothing (the guard drives this in-process) */
export async function warrantyPacketFor({ store, account_id, manifest, dispatches = null, now = Date.now() }) {
  if (!account_id) return { status: 401, body: { why: 'sign in first' } };
  const receipt = await store.getReceipt(manifest);
  if (!receipt || receipt.account_id !== account_id) return { status: 404, body: { why: 'no backup with this manifest is receipted to your account' } };
  const tapes = await store.tapesFor(manifest);
  const terms = tapes.warrantyTerms || null;
  const fz = terms ? await frozenAtFor({ store, account_id, manifest, terms }) : null;
  const reading = warrantyReading({ rows: tapes.coding || [], terms, frozenAt: fz ? fz.frozen_at : null });
  const body = lossHistory(reading, { manifest });
  // C897: each live fire carries its intake bundle — the fire and its neighbouring tape rows, receipt fields only — newest INTAKE_CAP
  body.intake = reading.live.fires.slice(-INTAKE_CAP).map((fire) => intakeFor(tapes.coding || [], fire));
  if (fz && fz.capped) body.frozen_note = `at least since ${fz.frozen_at}: the walk back stopped after ${fz.read} archives`;
  // C898: with the dispatch ledger armed, the dispatch miss turns from UNMEASURED into a count over this account's rows
  if (dispatches && typeof dispatches.rowsFor === 'function') {
    try { body.misses.dispatch = dispatchReading({ fires: reading.live.fires, rows: await dispatches.rowsFor(account_id), terms: reading.terms, now }); }
    catch (e) { body.misses.dispatch = { status: 'UNMEASURED', why: `the dispatch ledger did not answer: ${e.message}` }; }
  }
  return { status: 200, body };
}

/** the loss-history packet: what a contractual-liability carrier reads. Plain data; the page and the export route share it. */
export function lossHistory(reading, { manifest = null, source = 'holder backup' } = {}) {
  return {
    kind: 'thetadriven.warranty.loss-history', version: 1, source, manifest,
    status: reading.status, terms: reading.terms, terms_sha: reading.terms_sha, frozen_at: reading.frozen_at,
    predicate: reading.predicate, exposure: reading.exposure,
    live: { eligible: reading.live.eligible, fires: reading.live.fires.length, rate_pct: reading.live.ratePct, rows: reading.live.fires },
    backtest: { eligible: reading.backtest.eligible, fires: reading.backtest.fires.length, rate_pct: reading.backtest.ratePct, rows: reading.backtest.fires },
    misses: reading.misses,
    warranted: WARRANTED.map((w) => w.line), not_warranted: NOT_WARRANTED,
    sufficient_for: 'whether the trigger fired on this tape under these terms, recomputable from the rows and the terms',
    not_sufficient_for: 'whether the agent\'s work was good (Rice, 1953), whether a fire caused a loss, or any price',
    note: 'backtest and live are separate records and are never summed into one rate',
  };
}

const WORDING_QUESTION = QUESTIONS.find((q) => q.id === 'wording');

/** C936: a mailto draft beside the loss-history download — subject, the packet's link, the readiness line, the AI-wording
 * question (CG 40 47, CG 40 48, CG 35 08). Opens in the HOLDER'S OWN mail client with an empty To; nothing is sent by us. */
export function brokerMailto({ manifest, origin = 'https://thetadriven.com' } = {}) {
  if (!manifest) return null;
  const packetUrl = `${origin}/api/backup/warranty/${manifest}`;
  const subject = 'Loss history for our AI agent, for your warranty review';
  const body = [
    `The loss-history packet for the agent we run: ${packetUrl}`,
    'A carrier recomputes this from the archive without trusting us.',
    '',
    READINESS_LINE,
    '',
    WORDING_QUESTION.ask,
  ].join('\n');
  const q = new URLSearchParams({ subject, body });
  return `mailto:?${q.toString().replace(/\+/g, '%20')}`;
}

// ── C898 THE DISPATCH LEDGER ──────────────────────────────────────────────────────────────────────────────────────────────────────
// public.warranty_dispatches (supabase/migrations/20261017_c898_warranty_dispatches.sql.txt): append-only rows, event opened |
// arrived | closed, keyed by (account_id, fire_row_sha). The window runs from the server-written 'opened' row: MET when 'arrived' lands
// inside it, MISSED when it lands after or the window passed with no arrival, OPEN while it is still running. A live fire with no
// 'opened' row is UNDISPATCHED — named, never counted as met. A miss is ours: the warranty's credit is owed on it.
export const DISPATCH_EVENTS = ['opened', 'arrived', 'closed'];
export function dispatchReading({ fires = [], rows = [], terms = DEFAULT_TERMS, now = Date.now() } = {}) {
  const win = terms.dispatch_window_hours * 3600 * 1000;
  const by = new Map();
  for (const r of rows) { if (!r || !DISPATCH_EVENTS.includes(r.event)) continue; const k = r.fire_row_sha; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const per = fires.map((f) => {
    const rs = (by.get(f.row_sha) || []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
    const opened = rs.find((r) => r.event === 'opened'); const arrived = rs.find((r) => r.event === 'arrived');
    if (!opened) return { row_sha: f.row_sha, state: 'UNDISPATCHED' };
    const t0 = Date.parse(opened.at); const t1 = arrived ? Date.parse(arrived.at) : null;
    const state = t1 !== null ? (t1 - t0 <= win ? 'MET' : 'MISSED') : (now - t0 > win ? 'MISSED' : 'OPEN');
    return { row_sha: f.row_sha, state, provider: opened.provider || null, opened_at: opened.at, arrived_at: arrived ? arrived.at : null };
  });
  const n = (k) => per.filter((p) => p.state === k).length;
  return { status: 'MEASURED', window_hours: terms.dispatch_window_hours, fires: fires.length, met: n('MET'), missed: n('MISSED'), open: n('OPEN'), undispatched: n('UNDISPATCHED'), rows: per };
}
export function memoryDispatchStore() {
  const rows = [];
  return { kind: 'memory', rows, async rowsFor(account_id) { return rows.filter((r) => r.account_id === account_id); },
    async append(r) { if (!DISPATCH_EVENTS.includes(r.event)) throw new Error(`event must be one of ${DISPATCH_EVENTS.join(' | ')}`); const row = { ...r, at: r.at || new Date().toISOString() }; rows.push(row); return row; } };
}
export function supabaseDispatchStore(client, table = 'warranty_dispatches') {
  const one = async (q) => { const { data, error } = await q; if (error) throw new Error(`${table}: ${error.message}`); return data || []; };
  return { kind: 'supabase',
    async rowsFor(account_id) { return one(client.from(table).select('manifest,account_id,fire_row_sha,terms_sha,event,provider,at').eq('account_id', account_id)); },
    async append(r) { if (!DISPATCH_EVENTS.includes(r.event)) throw new Error(`event must be one of ${DISPATCH_EVENTS.join(' | ')}`); await one(client.from(table).insert({ manifest: r.manifest, account_id: r.account_id, fire_row_sha: r.fire_row_sha, terms_sha: r.terms_sha, event: r.event, provider: r.provider || null })); return r; } };
}
