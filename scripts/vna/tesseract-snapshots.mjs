#!/usr/bin/env node
// scripts/vna/tesseract-snapshots.mjs — C667d WE PUBLISH THE TESSERACT, NOT THE CODE — THE TESSERACT STATE RIDES THE TAPE AT EVERY
// STEP (operator 2026-10-05, verbatim: "we publish the tesseract not the code (confirm the tesseract is on the tape at each step?) how
// else can you recompute the process.. the rust 12x12 n dimensional semantic dumps we worked so hard to auto tick and fill out etc.").
//
// WHAT THE RECORD SAID BEFORE THIS FILE (measured 2026-10-05). The flight tape signs proofs.tesseract_sha on every commit row (3,369
// of 3,445 commit rows; 1,097 distinct states since 2026-09-18). The STATE those hashes name — data/vna/tesseract-state.json, every
// basin's pixel, its lit-cell vector over the 144 cells and its trajectory (the semantic dump the 12×12 pixel projects from) — was
// overwritten in place on every fold, listed in backup.mjs TAPE_FILES.local_diary, and committed to git 7 times. So 1,090 of the
// 1,097 signed states can no longer be opened: a hash with nothing behind it. The anatomy tape (C648) carries the ω tuple per walk,
// which names the bytes walked and the aperture, but not the tesseract the walk placed against. AXIOM 1 W4: retention is
// PROSPECTIVE-ONLY — this file does not pretend to back-fill; the gap is dated by the store's first row.
//
//   (1) THE STORE. retainSnapshot() appends the current state to .thetacog/backup/tesseract-snapshots.ndjson — append-only,
//       hash-chained (prev + row_sha), one row per DISTINCT tesseract_sha (content-addressed: the same state twice is one row). A row
//       carries the basin nodes that changed since the stored state before it (`set`), the ids that left (`drop`), and the header
//       (root, at). Weight, shared cells and counts are derived (tesseract-state.mjs stateFromNodes), so a weight shift caused by one
//       basin's mass does not rewrite 1,288 nodes. Every row is checked at write: the chain up to it reassembles to its own sha, or
//       the row carries the state verbatim (`raw`). Retention happens where the hash is stamped — every non-preview walk
//       (anatomy.mjs appendAnatomy stamps the row's tesseract_sha from the same read) — and at every backup bundle.
//   (2) THE CARRY. carrySnapshots() puts into the archive every snapshot named by the commits taped since the last posted backup: the
//       first one FULL (rebased, so the archive stands alone for a stranger), the rest as deltas against the one before it in the
//       carry. What rides is the holder's setting: text (the nodes) or hashes (tesseract_sha + counts — a commitment). Public → text.
//       Private → text unless the holder declares `tesseract_carry: "hashes"`, because the state holds ids, content hashes, cells and
//       masses — no source bytes. That is the sentence: we publish the tesseract, not the code.
//   (3) THE CHECK. resolveSnapshots() answers, per named sha: carried? reassembles to that sha? (anatomy.mjs --recompute's tesseract
//       leg). A commit with an anatomy row whose named snapshot is not carried is listed by name in the manifest, never dropped.
//   (4) THE SIZE, read off the record: per-row gz from the store, the full-state gz, the distinct states the flight tape signed, the
//       projection against receive.mjs MAX_BYTES and the one-POST body.
//
// SUFFICIENT FOR: re-placing every basin a commit's walk placed against — pixel, lit cells, trajectory, mass — from the archive alone,
// checked by the sha the flight tape signed. NOT SUFFICIENT FOR: the spec text behind each basin (the tree's revisions stay home), and
// whether the placement was right (Rice).
//
//   node scripts/vna/tesseract-snapshots.mjs            store status + the size reading
//   node scripts/vna/tesseract-snapshots.mjs --retain   retain the live state now (idempotent)
//   … --json
// MAXIMISE RUST: this HOLDS MASS (the state history); port row C667d.r, with backup.mjs's reader, once a full chain has posted.
// LLM-FREE.
// @guard tests/vna/c667d-the-tesseract-rides-every-step.test.mjs
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { stateFromNodes, shaOf, canonicalBytes, acquireLock, releaseLock } from './tesseract-state.mjs';
import { MAX_BYTES } from '../../src/lib/backup/receive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const STORE_REL = '.thetacog/backup/tesseract-snapshots.ndjson';
export const STATE_REL = 'data/vna/tesseract-state.json';
export const SNAPSHOTS_ENTRY = 'data/vna/tesseract-snapshots.ndjson';   // the archive entry
export const CARRY_MODES = Object.freeze(['text', 'hashes']);
export const storePath = (repo = REPO) => process.env.VNA_TESSERACT_SNAPSHOTS || resolve(repo, STORE_REL);
const headPath = (store) => `${store}.head.json`;   // derived cache of the chain's last state — rebuilt from the store when it disagrees

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const stripNode = ({ weight, ...n }) => n;   // weight is derived (stateFromNodes) — never stored
const nodeKey = (n) => canonicalBytes(n);
const rowBody = (r) => { const { row_sha, ...body } = r; return body; };
const sealRow = (body) => ({ ...body, row_sha: sha256(canonicalBytes(body)) });

/** the state a row reassembles to, given the nodes map of the row it is a delta against */
function applyRow(row, baseNodes) {
  if (row.raw) { const nodes = new Map(row.raw.nodes.map((n) => [n.id, stripNode(n)])); return { nodes, state: row.raw, sha: shaOf(row.raw) }; }
  const nodes = row.full || !baseNodes ? new Map() : new Map(baseNodes);
  for (const id of row.drop || []) nodes.delete(id);
  for (const n of row.set || []) nodes.set(n.id, n);
  const { state, sha } = stateFromNodes({ root: row.header.root, at: row.header.at, nodes: [...nodes.values()] });
  return { nodes, state, sha };
}
/** a delta row from `prev` (a nodes Map, or null for a full row) to `state` */
function deltaRow(state, tsha, prevNodes, { base = null, prevRow = null, extra = {} } = {}) {
  const set = [], drop = [];
  const now = new Map(state.nodes.map((n) => [n.id, stripNode(n)]));
  if (!prevNodes) set.push(...now.values());
  else {
    for (const [id, n] of now) { const p = prevNodes.get(id); if (!p || nodeKey(p) !== nodeKey(n)) set.push(n); }
    for (const id of prevNodes.keys()) if (!now.has(id)) drop.push(id);
  }
  let body = { v: 1, kind: 'tesseract-snapshot', tesseract_sha: tsha, base: prevNodes ? base : null, full: !prevNodes, header: { root: state.root ?? null, at: state.at ?? null }, set, drop, ...extra, prev: prevRow };
  // the row must reassemble to its own sha, or it carries the state verbatim — a stored row never names a state it cannot rebuild
  if (applyRow(body, prevNodes).sha !== tsha) body = { v: 1, kind: 'tesseract-snapshot', tesseract_sha: tsha, base: null, full: true, header: body.header, raw: state, ...extra, prev: prevRow };
  return { body, nodes: now };
}

// ── (1) the store ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const readStore = (store = storePath()) => nd(store);
/** the chain: every row_sha recomputes and points at the row before it (W5: a dropped row is a countable gap) */
export function verifyStoreChain(rows) {
  let prev = null; const breaks = [];
  rows.forEach((r, i) => { if (sha256(canonicalBytes(rowBody(r))) !== r.row_sha || (r.prev ?? null) !== prev) breaks.push(i); prev = r.row_sha; });
  return { ok: breaks.length === 0, rows: rows.length, breaks };
}
/** replay a row sequence → for each row, its reassembled sha (checked only for the shas in `want`, or all when want is null) */
export function replay(rows, { want = null, onState = null } = {}) {
  let nodes = null; const out = new Map();
  for (const r of rows) {
    if (r.mode === 'hashes') { out.set(r.tesseract_sha, { carried: 'hashes', sha: null }); nodes = null; continue; }
    const needSha = !want || want.has(r.tesseract_sha);
    if (r.raw) { nodes = new Map(r.raw.nodes.map((n) => [n.id, stripNode(n)])); if (needSha) { const sha = shaOf(r.raw); out.set(r.tesseract_sha, { carried: 'text', sha }); if (onState) onState(r, r.raw, sha); } continue; }
    const next = r.full || !nodes ? new Map() : new Map(nodes);
    for (const id of r.drop || []) next.delete(id);
    for (const n of r.set || []) next.set(n.id, n);
    nodes = next;
    if (needSha) { const { state, sha } = stateFromNodes({ root: r.header.root, at: r.header.at, nodes: [...nodes.values()] }); out.set(r.tesseract_sha, { carried: 'text', sha }); if (onState) onState(r, state, sha); }
  }
  return out;
}
function readHead(store, rows) {
  const last = rows.length ? rows[rows.length - 1] : null;
  try { const h = JSON.parse(readFileSync(headPath(store), 'utf8')); if (h && last && h.row_sha === last.row_sha && Array.isArray(h.nodes)) return { last, nodes: new Map(h.nodes.map((n) => [n.id, n])), known: new Set(rows.map((r) => r.tesseract_sha)) }; } catch { /* rebuilt below */ }
  if (!last) return { last: null, nodes: null, known: new Set() };
  let nodes = null;
  for (const r of rows) { if (r.raw) { nodes = new Map(r.raw.nodes.map((n) => [n.id, stripNode(n)])); continue; } const nx = r.full || !nodes ? new Map() : new Map(nodes); for (const id of r.drop || []) nx.delete(id); for (const n of r.set || []) nx.set(n.id, n); nodes = nx; }
  return { last, nodes, known: new Set(rows.map((r) => r.tesseract_sha)) };
}
/** read a state file as the walk reads it: the body must hash to the sha it names, or it is not retained (a torn file names nothing) */
export function readStateFile(path) {
  let j = null; try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ok: false, why: `no readable state at ${path}` }; }
  const { tesseract_sha, ...state } = j || {};
  if (!/^[0-9a-f]{64}$/.test(String(tesseract_sha || ''))) return { ok: false, why: 'the state names no tesseract_sha' };
  if (shaOf(state) !== tesseract_sha) return { ok: false, why: 'the state does not hash to its own tesseract_sha — not retained' };
  return { ok: true, tesseract_sha, state };
}
/** append the state unless its sha is already stored — idempotent; returns { retained, tesseract_sha, row? , why } */
export function retainSnapshot({ state, tesseract_sha, store = storePath(), at = new Date().toISOString(), retro = false } = {}) {
  if (!state || !tesseract_sha) return { retained: false, why: 'no state to retain' };
  mkdirSync(dirname(store), { recursive: true });
  const lock = `${store}.lock`; acquireLock(lock);
  try {
    const rows = readStore(store); const head = readHead(store, rows);
    if (head.known.has(tesseract_sha)) return { retained: false, tesseract_sha, why: `tesseract ${tesseract_sha.slice(0, 12)} is already stored` };
    const { body, nodes } = deltaRow(state, tesseract_sha, head.nodes, { base: head.last ? head.last.tesseract_sha : null, prevRow: head.last ? head.last.row_sha : null, extra: { retained_at: at, retro: !!retro } });
    const row = sealRow(body);
    appendFileSync(store, JSON.stringify(row) + '\n');
    const tmp = `${headPath(store)}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ row_sha: row.row_sha, tesseract_sha, nodes: [...nodes.values()] })); renameSync(tmp, headPath(store));
    return { retained: true, tesseract_sha, row, why: `retained ${tesseract_sha.slice(0, 12)} (${row.full ? 'full' : `${row.set ? row.set.length : 0} nodes changed, ${row.drop ? row.drop.length : 0} left`})` };
  } finally { releaseLock(lock); }
}
/** retain the live state file — what a walk and a bundle call */
export function retainLive({ repo = REPO, statePath = resolve(repo, STATE_REL), store = storePath(repo) } = {}) {
  const s = readStateFile(statePath);
  if (!s.ok) return { retained: false, tesseract_sha: null, why: s.why };
  return retainSnapshot({ state: s.state, tesseract_sha: s.tesseract_sha, store });
}

// ── (2) the setting + the carry ───────────────────────────────────────────────────────────────────────────────────────
/** text or hashes, from the anatomy setting (data/vna/anatomy-setting.json) — the tesseract is not the code, so private still carries
 *  text unless the holder declares `tesseract_carry: "hashes"` */
export function resolveTesseractCarry({ setting = null, visibility = null } = {}) {
  const declared = setting && CARRY_MODES.includes(setting.tesseract_carry) ? setting.tesseract_carry : null;
  if (visibility === 'public') return { mode: 'text', why: 'public — the tesseract rides as text' };
  if (declared === 'hashes') return { mode: 'hashes', why: 'private, tesseract_carry: "hashes" declared — the sha and counts ride, the nodes stay home (verified on reveal)' };
  return { mode: 'text', why: `${visibility || 'private'} — the tesseract rides as text: it holds ids, content hashes, cells and masses, not source bytes (we publish the tesseract, not the code)${declared ? '' : '; set tesseract_carry: "hashes" to carry commitments only'}` };
}
/** the shas the delta commits name: the anatomy row's own stamp first (the walk's read), else the flight tape's signed proofs.tesseract_sha */
export function namedShas({ commits, anatomyRows = [], flight = [] }) {
  const byAnatomy = new Map(); for (const r of anatomyRows) if (r && r.commit && /^[0-9a-f]{64}$/.test(String(r.tesseract_sha || ''))) byAnatomy.set(String(r.commit), r.tesseract_sha);
  const byFlight = new Map(); for (const r of flight) if (r && r.kind === 'commit' && r.sha && r.proofs && /^[0-9a-f]{64}$/.test(String(r.proofs.tesseract_sha || ''))) byFlight.set(String(r.sha), r.proofs.tesseract_sha);
  return commits.map((c) => ({ commit: String(c), tesseract_sha: byAnatomy.get(String(c)) || byFlight.get(String(c)) || null, from: byAnatomy.has(String(c)) ? 'anatomy' : byFlight.has(String(c)) ? 'flight' : null }));
}
/**
 * The archive entry for the named shas: every stored snapshot they name, in store order — the first FULL, each next one a delta
 * against the one before it in THIS carry (so the archive stands alone), chained by prev/row_sha. hashes mode carries the sha +
 * counts only. Returns { text, rows, field } — field lists `missing`: each named sha (and the commits naming it) not in the store.
 */
export function carrySnapshots({ named, rows = readStore(), mode = 'text' }) {
  const want = new Set(named.map((n) => n.tesseract_sha).filter(Boolean));
  const out = []; let prevNodes = null; let prevSha = null; let prevRow = null;
  replay(rows, { want, onState: (r, state, sha) => {
    if (sha !== r.tesseract_sha) return;   // a stored row that no longer reassembles is not carried as if it did — it lands in missing
    let body;
    if (mode === 'hashes') { body = { v: 1, kind: 'tesseract-snapshot', mode: 'hashes', tesseract_sha: sha, header: { root: state.root ?? null, at: state.at ?? null }, counts: state.counts, prev: prevRow }; }
    else { const d = deltaRow(state, sha, prevNodes, { base: prevSha, prevRow, extra: { mode: 'text' } }); body = d.body; prevNodes = d.nodes; }
    const row = sealRow(body); out.push(row); prevSha = sha; prevRow = row.row_sha;
  } });
  const carried = new Set(out.map((r) => r.tesseract_sha));
  const missing = []; const unnamed = [];
  for (const n of named) { if (!n.tesseract_sha) unnamed.push(n.commit); else if (!carried.has(n.tesseract_sha)) missing.push(n); }
  const text = out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : '');
  return { text, rows: out, field: { entry: SNAPSHOTS_ENTRY, mode, commits: named.length, named: want.size, carried: out.length, missing: missing.map((m) => ({ commit: m.commit, tesseract_sha: m.tesseract_sha })), unnamed: unnamed.length, store_rows: rows.length, store_first_at: rows.length ? rows[0].retained_at || null : null, bytes: Buffer.byteLength(text), gz_bytes: gzipSync(text).length,
    sufficient_for: mode === 'text' ? 're-placing every basin each named commit placed against, from this archive alone, checked by the sha the walk stamped' : 'binding: the holder cannot swap the tesseract later — verified on reveal',
    not_sufficient_for: mode === 'text' ? 'the spec text behind each basin, and whether the placement was right (Rice)' : 'a recompute now — the nodes stay on the holder\'s machine' } };
}

/** the flight height the snapshot window starts at: the newest POSTED backup whose manifest carried snapshots (not deferred) — so a
 *  carry that was deferred (or a backup from before C667d) never advances the window, and its states ride the next archive */
export function snapshotWindowHeight(dir) {
  if (!dir || !existsSync(dir)) return 0;
  let h = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.upload.json'))) {
    let up = null; try { up = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; }
    const sha = (up && up.sha) || f.slice(0, -'.upload.json'.length);
    let man = null; try { man = JSON.parse(readFileSync(resolve(dir, `${sha}.manifest.json`), 'utf8')); } catch { continue; }
    const t = man && man.tesseract_snapshots;
    if (t && Number.isFinite(t.carried) && !t.deferred && man.rows && Number.isFinite(man.rows.flight_tape)) h = Math.max(h, man.rows.flight_tape);
  }
  return h;
}
/**
 * What backup.mjs bundle() writes: the commits taped since the window height (deduplicated — the flight tape holds a commit more than
 * once), the shas they name, the carry, and the field. missing_with_anatomy is the guard's set: a commit with an anatomy row walked
 * AFTER retention began whose named state is not carried. before_retention counts the named states from before the store's first row.
 */
export function snapshotCarryFor({ flightRows = [], anatomyRows = [], since = 0, rows = readStore(), mode = 'text' }) {
  const seen = new Set(); const commits = [];
  for (const r of flightRows.slice(since)) if (r && r.kind === 'commit' && r.sha && !seen.has(String(r.sha))) { seen.add(String(r.sha)); commits.push(String(r.sha)); }
  const named = namedShas({ commits, anatomyRows, flight: flightRows });
  const c = carrySnapshots({ named, rows, mode });
  const firstAt = rows.length ? rows[0].retained_at || null : null;
  const walked = new Map(); for (const a of anatomyRows) if (a && a.commit) { const w = a.walked_at || a.at || null; const k = String(a.commit); if (!walked.has(k) || String(w) > String(walked.get(k))) walked.set(k, w); }
  const { missing, ...rest } = c.field;
  const after = (m) => walked.has(m.commit) && firstAt && String(walked.get(m.commit)) >= String(firstAt);
  const missingWithAnatomy = missing.filter(after);
  const beforeShas = new Set(missing.filter((m) => !after(m)).map((m) => m.tesseract_sha));
  return { text: c.text, rows: c.rows, field: { ...rest, since_height: since, missing_count: missing.length, missing_states: new Set(missing.map((m) => m.tesseract_sha)).size, before_retention_states: beforeShas.size, missing_with_anatomy: missingWithAnatomy } };
}

// ── (3) the check ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** per named sha: carried as text and reassembles to it (MATCH) · reassembles to another sha (MISMATCH) · hashes only (COMMITTED) ·
 *  absent (NOT_CARRIED, or BEFORE_RETENTION when the commit was walked before the store's first row) */
export function resolveSnapshots(rows) {
  const firstAt = rows.length ? rows[0].retained_at || null : null;
  const want = new Set(rows.map((r) => r.tesseract_sha));
  const got = replay(rows, { want });
  return (named, walkedAt = null) => {
    if (!named) return { leg: 'UNNAMED', named: null };
    const g = got.get(named);
    if (!g) return { leg: firstAt && walkedAt && String(walkedAt) < String(firstAt) ? 'BEFORE_RETENTION' : 'NOT_CARRIED', named, first_retained_at: firstAt };
    if (g.carried === 'hashes') return { leg: 'COMMITTED', named };
    return { leg: g.sha === named ? 'MATCH' : 'MISMATCH', named, reassembled: g.sha };
  };
}

// ── (4) the size, read off the record ────────────────────────────────────────────────────────────────────────────────
const stats = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2); return { median: m, min: s[0], max: s[s.length - 1], n: s.length }; };
export function sizeReading({ rows, flight = [], liveState = null, bodyLimit = null, maxBytes = MAX_BYTES }) {
  const gz = (o) => gzipSync(JSON.stringify(o)).length;
  const full = liveState ? gz(liveState) : null;
  const deltas = stats(rows.filter((r) => !r.full).map(gz));
  const commits = flight.filter((r) => r && r.kind === 'commit');
  const signed = commits.map((r) => r.proofs && r.proofs.tesseract_sha).filter(Boolean);
  const distinct = new Set(signed).size;
  const perChange = deltas ? deltas.max : full;   // until the store holds deltas, every change is priced as a full state
  return { unit: 'bytes gz', store_rows: rows.length, full_state_gz: full, delta_gz: deltas, flight_commits: commits.length, signed: signed.length, distinct_signed: distinct,
    all_history_if_retained: full != null ? { bytes: full + Math.max(0, distinct - 1) * (perChange || 0), basis: deltas ? 'one full + each distinct state at the measured delta max' : 'every distinct state priced as a full state (no delta measured yet)', cap: maxBytes, share_of_cap_pct: Math.round((10000 * (full + Math.max(0, distinct - 1) * (perChange || 0))) / maxBytes) / 100 } : null,
    one_post_body: bodyLimit, full_states_per_post: bodyLimit && full ? Math.floor(bodyLimit / full) : null };
}

function main() {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
  const store = storePath();
  if (argv.includes('--retain')) { const r = retainLive({ repo: REPO, store }); console.log(asJson ? JSON.stringify({ retained: r.retained, tesseract_sha: r.tesseract_sha, why: r.why }) : r.why); return; }
  const rows = readStore(store); const chain = verifyStoreChain(rows);
  const flight = nd(process.env.VNA_FLIGHT_TAPE_READ || resolve(REPO, 'data/vna/flight-tape.ndjson'));
  const live = readStateFile(resolve(REPO, STATE_REL));
  const z = sizeReading({ rows, flight, liveState: live.ok ? { tesseract_sha: live.tesseract_sha, ...live.state } : null, bodyLimit: 4.5 * 1024 * 1024 });
  if (asJson) { console.log(JSON.stringify({ store: STORE_REL, chain, size: z })); return; }
  const d = z.delta_gz;
  console.log([
    `TESSERACT SNAPSHOTS · ${rows.length} stored (${STORE_REL}) · chain ${chain.ok ? 'VERIFIES' : `BROKEN at ${chain.breaks.join(',')}`} · retention began ${rows.length ? rows[0].retained_at : 'not yet'}`,
    `  the flight tape signed ${z.signed} of ${z.flight_commits} commit rows with a tesseract_sha — ${z.distinct_signed} distinct states; ${rows.length} of them are openable from the store`,
    `  per state gz   full ${z.full_state_gz ?? 'UNMEASURED'} B · delta ${d ? `${d.median} B [${d.min}, ${d.max}] (n=${d.n})` : 'UNMEASURED (fewer than 2 stored)'}`,
    `  all history    ${z.all_history_if_retained ? `${z.all_history_if_retained.bytes} B (${z.all_history_if_retained.share_of_cap_pct}% of the ${z.all_history_if_retained.cap} B cap) — ${z.all_history_if_retained.basis}` : 'UNMEASURED'} · one POST holds ${z.full_states_per_post ?? '—'} full states`,
  ].join('\n'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
