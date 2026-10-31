// src/lib/backup/receive.mjs — C84b THE /backup DOOR (C71), the server half (goal 11 unit 3, 2026-09-18).
// The IDE bundles the tape + proofs + tesseract state into ONE archive NAMED by the sha256 of its bytes and opens
// https://thetadriven.com/backup?manifest=<sha>. Here the bytes arrive, are hashed again (WebCrypto), and a file whose
// sha256 is not the manifest is refused — the name IS the check. A receipt { sha, bytes, account_id, received_at,
// stored_at } is written once; a replay returns the existing receipt (the first receipt stands). The store is an
// interface: memoryBackupStore() for the guard, supabaseBackupStore(client) for production (storage bucket + table).
//
// C464 THE DRIFT PAGE READS REAL ROWS (operator 2026-09-29: "backing up to tape and seeing the visualizations on our site is
// enough to justify the experience"). store.rowsFor(manifest) opens the stored archive (named by its sha256 — re-hashed at
// read time, a blob that is not its manifest refuses), streams the ustar that scripts/vna/backup.mjs writes, reads ONLY the
// flight-tape entry (data/vna/flight-tape.ndjson; the walk tape, the proofs and every other entry are skipped unread) and
// hands each row on through drift-reading.mjs's receiptOnly — the RECEIPT_FIELDS allowlist — so no file content reaches the
// page. Bounded: ROWS_CAP keeps the newest rows; a tape entry over TAPE_CAP bytes refuses with its size, never truncates.
// @guard tests/vna/c464-backup-store-rows-for.test.mjs
// @guard tests/site/c503-two-tapes-and-the-slider.test.mjs
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { receiptOnly } from './drift-reading.mjs';
import { deployedReceiptOnly } from './deployed-tapes.mjs';
import { acceptWalkSegment } from './walk-segment.mjs';   // C651a: a walk-tape segment verifies its chain before it is stored
import { recordDefaultAtFirstBackup } from './underwriting-requests.mjs';
import { WARRANTY_ENTRY, termsOf } from './warranty.mjs';   // C896: the warranty terms ride inside the archive   // C667e: a new holder's first backup is shared by default
const subtle = globalThis.crypto.subtle;
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
export const isSha = (s) => /^[0-9a-f]{64}$/.test(String(s || ''));
export const MAX_BYTES = 200 * 1024 * 1024;   // an archive over 200 MB is refused with the size, not truncated
export const TAPE_ENTRY = 'data/vna/flight-tape.ndjson';   // the one entry rowsFor reads (backup.mjs BACKUP_FILES.fixed)
export const ROWS_CAP = 2000;                   // the newest rows the drift page draws
export const TAPE_CAP = 32 * 1024 * 1024;       // a flight-tape entry over 32 MB is refused with its size, not truncated

// C503 THE DEPLOYED TAPES (operator 2026-09-30: "seeing both your llm wrapper workloads visualised as tapes … you know where
// your money went"). scripts/vna/backup.mjs now archives every .thetacog/fleet-tape/<job>.ndjson (the C496 robot fleet and the
// C504 LLM tape). tapesFromArchive() is the ONE untar: a single streamed pass keeps the flight-tape entry AND every fleet-tape
// entry, and skips every other entry unread. rowsFromArchive (CODING) and deployedRowsFromArchive (DEPLOYED) are its two
// halves — never a second parse path. Each deployed row goes through deployed-tapes.mjs's deployedReceiptOnly allowlist,
// tagged with the job its entry is named for; the row's action text never leaves this module.
export const PANELS_ENTRY = 'panels.json';   // C506: where the holder's panels are served — written by backup.mjs bundle(), inside the archive's sha
// a shape check on the COPY, never a repair: an https base, a pattern with the {sha10} slot, present = 10-hex shas; else null
export function panelsOf(buf) {
  let p = null; try { p = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  const base = typeof p.base === 'string' && /^https:\/\/[^\s"'<>]+\/$/.test(p.base) ? p.base : null;
  const pattern = typeof p.pattern === 'string' && p.pattern.includes('{sha10}') && !/[\s"'<>]/.test(p.pattern) ? p.pattern : null;
  const present = Array.isArray(p.present) ? p.present.filter((s) => typeof s === 'string' && /^[0-9a-f]{10}$/.test(s)) : [];
  // C647b: carried = the commits whose panel PNG rides inside this archive (panels/<sha10>.png); of = the counts the page names
  // when a frame has none — numbers only, anything else dropped
  const carried = Array.isArray(p.carried) ? p.carried.filter((s) => typeof s === 'string' && /^[0-9a-f]{10}$/.test(s)).slice(0, 1000) : [];
  const of = p.of && typeof p.of === 'object' ? Object.fromEntries(['commits', 'in_repo', 'carried', 'cap_bytes', 'cap_count'].filter((k) => Number.isFinite(p.of[k])).map((k) => [k, p.of[k]])) : null;
  return { base, pattern, source: typeof p.source === 'string' ? p.source.slice(0, 64) : null, present, carried, ...(of ? { of } : {}), ...(typeof p.why === 'string' ? { why: p.why.slice(0, 300) } : {}) };
}
// C647b THE PANEL TRAVELS WITH THE BACKUP: each carried panel is an archive entry panels/<sha10>.png (scripts/vna/panel-carry.mjs).
// receiveBackup copies them into the store at panelBlobKey(manifest, sha10) — keyed by the archive's sha, never the account —
// and /api/backup/panel/<manifest>/<sha10> serves them from there (servePanelBlob). A non-PNG entry is never stored.
// @guard tests/vna/c647b-the-panel-travels-with-the-backup.test.mjs
export const PANEL_FILE = /^panels\/([0-9a-f]{10})\.png$/;
export const PANEL_ENTRY_CAP = 256 * 1024;   // one carried panel over this is refused (the carrier side caps at 64 KB)
export const panelBlobKey = (manifest, sha10) => `panels/${manifest}/${sha10}.png`;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b) => !!b && b.length >= 8 && PNG_MAGIC.every((x, i) => b[i] === x);
export const FLEET_DIR = '.thetacog/fleet-tape/';   // backup.mjs BACKUP_FILES.fleet
// C519: the per-tick token record (C510 units) and the per-day crossing counts — backup.mjs TAPE_FILES.fixed; the viz page draws
// the % savings from the backed-up series with the one pure reading (scripts/vna/steer-ab-rules.mjs savingsReading)
export const TICKS_ENTRY = 'data/vna/steer-ab-tokens.ndjson';
export const SAVINGS_DAYS_ENTRY = 'data/vna/token-savings-daily.ndjson';
// C518: the holder's own published semantic vega — backup.mjs BACKUP_FILES/TAPE_FILES VEGA_FILE, archived under its own
// path (public/.well-known/semantic-vega.json), absent whenever the holder never published one.
export const VEGA_ENTRY = 'public/.well-known/semantic-vega.json';
// a shape check on the COPY, never a repair: state, the vega number, the series row count, when it was generated, and the
// recompute command the carrier can run themselves — null for anything that does not carry a numeric vega and a state
export function vegaOf(buf) {
  let v = null; try { v = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const state = typeof v.state === 'string' ? v.state : null;
  const vega = v.measured && Number.isFinite(v.measured.vega) ? v.measured.vega : null;
  if (!state || vega === null) return null;
  const rows = v.series && Number.isFinite(v.series.rows) ? v.series.rows : null;
  const generatedAt = typeof v.generatedAt === 'string' ? v.generatedAt : null;
  const recompute = Array.isArray(v.recompute) ? v.recompute.filter((s) => typeof s === 'string').slice(0, 4) : [];
  return { state, vega, rows, generatedAt, recompute };
}
// C565k: the holder's own regressed rows — ticked spec rows whose guard is red right now, as IDS ONLY ({ at, regressed: [ids] }),
// written by backup.mjs from .thetacog/vna-asked-vs-built.json; no headline, no evidence text. public-record.mjs redRows counts it;
// absent → null (UNMEASURED on the page), never an empty list standing in for "not carried".
// C652a: the commit anatomies the backup carried (C648 anatomy.mjs anatomyCarry) — read as NUMBERS ONLY for the holder landing: how
// many rows, whether they carry span bytes (tuple + spans) or not (tuple only), and the bytes per row. The span bytes are source text
// and never leave this function; the recompute itself runs where the bytes are (node scripts/vna/anatomy.mjs --recompute).
// @guard tests/vna/c652a-the-underwriter-landing.test.mjs
export const ANATOMY_ENTRY = 'data/vna/anatomy-tape.ndjson';
export function anatomyOf(buf) {
  const rows = [];
  for (const l of Buffer.from(buf).toString('utf8').split('\n')) {
    if (!l) continue;
    try { const r = JSON.parse(l); if (r && r.kind === 'anatomy' && /^[0-9a-f]{40}$/.test(String(r.commit))) rows.push({ bytes: Buffer.byteLength(l), spans: !!(r.span_bytes && typeof r.span_bytes === 'object') }); } catch { /* a torn line is not a row */ }
  }
  if (!rows.length) return { rows: 0, carry: null, bytes: null };
  const b = rows.map((r) => r.bytes).sort((x, y) => x - y);
  return { rows: rows.length, carry: rows.every((r) => r.spans) ? 'spans' : rows.some((r) => r.spans) ? 'mixed' : 'tuple', bytes: { median: b[Math.floor((b.length - 1) / 2)], min: b[0], max: b.at(-1), total: b.reduce((x, y) => x + y, 0) } };
}
export const REGRESSED_ENTRY = 'data/vna/regressed-rows.json';
const ROW_ID = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;
// C659: the holder's tokens-per-cog record — cog rows, the spend of record and the peg, NUMBERS ONLY (no subject, no path), written by
// backup.mjs from data/vna/cog.ndjson + cog-spend.ndjson + cog-peg.json; the page reads it through tokens-per-cog.mjs, the
// function the sidebar reads too. Absent → null (UNMEASURED on the page). @guard tests/vna/c659-tokens-per-cog-is-a-graph-that-makes-sense.test.mjs
export const TOKENS_PER_COG_ENTRY = 'data/vna/tokens-per-cog.json';
const fin = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const shaOk = (x) => typeof x === 'string' && /^[0-9a-f]{7,40}$/.test(x);
const atOk = (x) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const bandOk = (x) => (typeof x === 'string' && /^[a-z]{1,4}$/.test(x) ? x : null);
export function tokensPerCogInputs({ cogRows = [], spendRows = [], peg = null } = {}) {
  return {
    cogRows: (cogRows || []).filter((c) => c && shaOk(c.sha)).map((c) => ({ sha: c.sha, at: atOk(c.at), cog: fin(c.cog), band: bandOk(c.band), minted: !!c.minted, partial: !!c.partial })),
    spendRows: (spendRows || []).filter((r) => r && shaOk(r.sha) && r.status !== 'UNMEASURED' && fin(r.total) > 0).map((r) => ({ sha: r.sha, total: fin(r.total), route: r.route === 'runner' ? 'runner' : 'chair' })),
    peg: peg && peg.bands ? { bands: Object.fromEntries(Object.entries(peg.bands).filter(([b]) => bandOk(b)).map(([b, v]) => [b, { peg: fin(v && v.peg), legacy: !!(v && v.legacy) }])) } : null,
  };
}
export function tokensPerCogOf(buf) {
  let v = null; try { v = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!v || typeof v !== 'object' || !Array.isArray(v.cogRows) || !Array.isArray(v.spendRows)) return null;
  return tokensPerCogInputs(v);
}
// C857 KE COUNT RIDES THE BACKUP (operator 2026-10-15: "research how to integrate the yardstick for drift directly here … ke .003
// vs on chip"). The archive entry data/vna/odometer-tape.ndjson carries ONE ROW PER COMMIT of the backup's range, read off the walk
// tape's commit-reality rows (src/lib/pmu/walk-door.mjs recordWalk keeps `crossings` verbatim from the lens JSON pmu-onchip
// wrote) — never re-derived in JS. The count is the walk's own integer (odometer.rs, Tier 1); k_e_tally is copied byte for byte.
//   odometerRowsFor(tapeRows, refs) → rows, the ONE pure reading (no binary, no file): backup.mjs writes it, the guard and the
//   pages (C858, C861) call it. tapeRows = walk-tape rows (any source; only commit-reality rows with crossings count); refs =
//   the commits of the range (40-hex, or the tape's 10-hex short ref). Row shape, one per ref, in refs order:
//     MEASURED   { ref, status: 'MEASURED', at, c, k_e_milli, k_e_tally, cell, receipt, source_row: { ts, text_sha }, walks }
//                  at = the walk row's ts · cell = the walk's pixel · receipt = the row's signature (sig) else its text_sha ·
//                  walks = how many commit-reality rows carried crossings for this ref (a re-walked commit reads its NEWEST walk)
//     UNMEASURED { ref, status: 'UNMEASURED', why } — no commit-reality row carries crossings for this ref; NEVER c: 0
//   odometerOf(buf) reads the entry back on the server with the same shape check; tapesFor exposes it as `odometer` (null when
//   the archive carries none — UNMEASURED on the page). The entry rides in a --tapes archive only when the walk tape carries an odometer
//   at all (backup.mjs odometerCarry readings > 0); a tape walked before the odometer rides no entry and the manifest field says why.
//   @guard tests/vna/ke-count-rides-the-backup.test.mjs
export const ODOMETER_ENTRY = 'data/vna/odometer-tape.ndjson';
const K_E_MILLI = 3;   // k_E = 0.003 per crossing — CLAUDE.md CANONICAL NUMBERS, restated (a shape admission, the count itself is never computed here)
const refOk = (x) => typeof x === 'string' && /^[0-9a-f]{7,40}$/.test(x);
const refMatches = (full, short) => refOk(full) && refOk(short) && (full.startsWith(short) || short.startsWith(full));
/** the crate's integer shape, or null — mirrors scripts/lib/boundary-odometer.mjs crossingsFromReceipt without its binary imports */
export function odometerCrossingsOf(od) {
  if (!od || typeof od !== 'object') return null;
  if (!Number.isInteger(od.c) || od.c < 0 || !Number.isInteger(od.k_e_milli) || od.k_e_milli !== K_E_MILLI * od.c) return null;
  if (typeof od.k_e_tally !== 'string' || !/^\d+\.\d{3}$/.test(od.k_e_tally)) return null;
  return od;
}
// 2026-10-15 (operator: "lets add the ke boundary crossings in and out of lane metrics here additively"): exits (in lane → out) and
// entries (out → in) ride beside c ONLY when both are integers summing to c — the crate's own split, never inferred; else neither rides.
export const splitOf = (o) => (o && Number.isInteger(o.exits) && Number.isInteger(o.entries) && o.exits >= 0 && o.entries >= 0 && o.exits + o.entries === o.c) ? { exits: o.exits, entries: o.entries } : {};
export const ODOMETER_UNMEASURED_WHY = 'no commit-reality row carries crossings for this ref';
export function odometerRowsFor(tapeRows, refs) {
  const walks = [];
  for (const r of tapeRows || []) {
    if (!r || r.source !== 'commit-reality' || !refOk(r.ref)) continue;
    const od = odometerCrossingsOf(r.crossings); if (!od) continue;
    walks.push({ ref: r.ref, ts: typeof r.ts === 'string' ? r.ts : null, od, pixel: typeof r.pixel === 'string' ? r.pixel : null, sig: typeof r.sig === 'string' && r.sig ? r.sig : null, text_sha: typeof r.text_sha === 'string' ? r.text_sha : null });
  }
  const out = []; const seen = new Set();
  for (const ref of refs || []) {
    if (!refOk(ref) || seen.has(ref)) continue; seen.add(ref);
    const mine = walks.filter((w) => refMatches(ref, w.ref)).sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0));
    if (!mine.length) { out.push({ ref, status: 'UNMEASURED', why: ODOMETER_UNMEASURED_WHY }); continue; }
    const w = mine[mine.length - 1];
    out.push({ ref, status: 'MEASURED', at: w.ts, c: w.od.c, ...splitOf(w.od), k_e_milli: w.od.k_e_milli, k_e_tally: w.od.k_e_tally, cell: w.pixel, receipt: w.sig || w.text_sha, source_row: { ts: w.ts, text_sha: w.text_sha }, walks: mine.length });
  }
  return out;
}
/** the odometer entry read back: rows in the shape above, a MEASURED row whose count is not the crate's integer shape is dropped (never repaired) */
export function odometerOf(buf) {
  const out = [];
  for (const l of Buffer.from(buf).toString('utf8').split('\n')) {
    if (!l) continue; let r = null; try { r = JSON.parse(l); } catch { continue; }
    if (!r || typeof r !== 'object' || !refOk(r.ref)) continue;
    if (r.status === 'UNMEASURED') { out.push({ ref: r.ref, status: 'UNMEASURED', why: typeof r.why === 'string' ? r.why.slice(0, 300) : ODOMETER_UNMEASURED_WHY }); continue; }
    if (r.status !== 'MEASURED' || !odometerCrossingsOf(r)) continue;
    out.push({ ref: r.ref, status: 'MEASURED', at: typeof r.at === 'string' ? r.at : null, c: r.c, ...splitOf(r), k_e_milli: r.k_e_milli, k_e_tally: r.k_e_tally, cell: typeof r.cell === 'string' ? r.cell : null, receipt: typeof r.receipt === 'string' ? r.receipt.slice(0, 128) : null,
      source_row: r.source_row && typeof r.source_row === 'object' ? { ts: typeof r.source_row.ts === 'string' ? r.source_row.ts : null, text_sha: typeof r.source_row.text_sha === 'string' ? r.source_row.text_sha : null } : null, walks: Number.isInteger(r.walks) ? r.walks : null });
  }
  return out;
}
export function regressedOf(buf) {
  let v = null; try { v = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!v || typeof v !== 'object' || !Array.isArray(v.regressed)) return null;
  return { at: typeof v.at === 'string' && Number.isFinite(Date.parse(v.at)) ? v.at : null, regressed: v.regressed.filter((x) => typeof x === 'string' && ROW_ID.test(x)).slice(0, 2000) };
}
const TICK_KEEP = ['amend', 'at', 'sha', 'session', 'route', 'label', 'opened_at', 'closed_at', 'prompts', 'inherited', 'calls', 'calls_source', 'input', 'cache_create', 'cache_read', 'output', 'total', 'complexity', 'inputs', 'lattice', 'model', 'version', 'subject', 'row_label', 'cost_usd', 'cost_source', 'snowball_cap', 'steering'];   // C519: the amend rows ride too (folded by the one reading), the steering ledger reading, the runner's cap and cost — numbers and words, never a path on the holder's disk
/** a tick row with its local paths and prompt hash dropped — the numbers and the commit, nothing that names a file on the holder's disk */
export function tickReceiptOnly(r) { const o = {}; for (const k of TICK_KEEP) if (r && r[k] !== undefined) o[k] = r[k]; return o; }
const FLEET_ENTRY = /^\.thetacog\/fleet-tape\/([A-Za-z0-9._-]{1,64})\.ndjson$/;
export const jobOfEntry = (name) => { const m = FLEET_ENTRY.exec(String(name || '')); return m ? m[1] : null; };

async function readEntries(bytes, manifest, keepName, maxTapeBytes) {
  if (!isSha(manifest)) throw new Error('rowsFor: manifest must be the sha256 (64 hex) the archive is named by');
  if (!bytes || !bytes.byteLength) throw new Error('rowsFor: the store holds no bytes for this manifest');
  if (bytes.byteLength > MAX_BYTES) throw new Error(`rowsFor: archive is ${bytes.byteLength} bytes, over the ${MAX_BYTES} cap`);
  const sha = hex(await subtle.digest('SHA-256', bytes));
  if (sha !== manifest) throw new Error(`rowsFor: the stored archive's sha256 is ${sha.slice(0, 12)}…, not the manifest ${manifest.slice(0, 12)}… — refused`);
  let buf = Buffer.alloc(0); let want = null; let lastName = null;   // want: { name, left, keep, parts } while inside an entry's body
  const kept = new Map();
  const cstr = (b, o, n) => { const x = b.subarray(o, o + n); const z = x.indexOf(0); return x.subarray(0, z < 0 ? n : z).toString('utf8'); };
  outer: for await (const chunk of Readable.from([Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]).pipe(createGunzip())) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (want) {
        const take = Math.min(want.left, buf.length);
        if (want.keep) want.parts.push(Buffer.from(buf.subarray(0, take)));
        want.left -= take; buf = buf.subarray(take);
        if (want.left > 0) break;
        if (want.keep) { kept.set(want.name, Buffer.concat(want.parts)); if (want.pad) { want = { left: want.pad, keep: false }; continue; } }
        want = null; continue;
      }
      if (buf.length < 512) break;
      const h = buf.subarray(0, 512);
      if (h.every((b) => b === 0)) break outer;   // end-of-archive
      // a header whose checksum fails is a TORN archive (2026-10-02: a live tape grew mid-bundle and every header after it
      // misaligned, so the page drew coding 0 · ticks none) — refuse with where it tore, never read on as empty tapes
      const ck = parseInt(cstr(h, 148, 8).trim() || 'x', 8); let sum = 0; for (let k = 0; k < 512; k++) sum += k >= 148 && k < 156 ? 32 : h[k];
      if (ck !== sum) throw new Error(`rowsFor: the archive is torn after ${lastName ? `the ${lastName} entry` : 'its start'} — a header checksum fails, so no tape after it can be read; re-bundle it (node scripts/vna/backup.mjs --upload --tapes)`);
      const prefix = cstr(h, 345, 155); const base = cstr(h, 0, 100);
      const name = prefix ? `${prefix}/${base}` : base; lastName = name;
      const size = parseInt(cstr(h, 124, 12).trim() || '0', 8) || 0;
      const type = String.fromCharCode(h[156] || 48);
      const keep = keepName(name) && (type === '0' || type === '\0');
      if (keep && size > maxTapeBytes) throw new Error(`rowsFor: the ${name === TAPE_ENTRY ? 'flight-tape' : name} entry is ${size} bytes, over the ${maxTapeBytes} cap — refused, not truncated`);
      buf = buf.subarray(512);
      const padLen = (512 - (size % 512)) % 512;
      want = keep ? { name, left: size, keep: true, parts: [], pad: padLen } : { left: size + padLen, keep: false };
      if (keep && size === 0) { kept.set(name, Buffer.alloc(0)); want = padLen ? { left: padLen, keep: false } : null; }
    }
  }
  return kept;
}

const ndjsonRows = (buf, maxRows) => {
  const lines = buf.toString('utf8').split('\n').filter(Boolean); const out = [];
  for (const l of lines.slice(-maxRows)) { try { const r = JSON.parse(l); if (r && typeof r === 'object') out.push(r); } catch {} }
  return out;
};

/** ONE untar of a backup archive: the flight tape (CODING, receipt-only) and every fleet tape (DEPLOYED, one list per job) */
export async function tapesFromArchive(bytes, manifest, { maxRows = ROWS_CAP, maxTapeBytes = TAPE_CAP } = {}) {
  const kept = await readEntries(bytes, manifest, (n) => n === TAPE_ENTRY || n === PANELS_ENTRY || n === TICKS_ENTRY || n === SAVINGS_DAYS_ENTRY || n === VEGA_ENTRY || n === REGRESSED_ENTRY || n === TOKENS_PER_COG_ENTRY || n === ANATOMY_ENTRY || n === ODOMETER_ENTRY || n === WARRANTY_ENTRY || jobOfEntry(n) !== null, maxTapeBytes);
  const coding = kept.has(TAPE_ENTRY) ? ndjsonRows(kept.get(TAPE_ENTRY), maxRows).map(receiptOnly) : [];
  const deployed = [];
  for (const [name, buf] of [...kept.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const job = jobOfEntry(name); if (!job) continue;
    for (const r of ndjsonRows(buf, maxRows)) deployed.push(deployedReceiptOnly(r, job));
  }
  const ticks = kept.has(TICKS_ENTRY) ? ndjsonRows(kept.get(TICKS_ENTRY), maxRows).map(tickReceiptOnly) : null;   // null: the archive carries no tick record (UNMEASURED on the page)
  const savingsDays = kept.has(SAVINGS_DAYS_ENTRY) ? ndjsonRows(kept.get(SAVINGS_DAYS_ENTRY), maxRows) : null;
  const vega = kept.has(VEGA_ENTRY) ? vegaOf(kept.get(VEGA_ENTRY)) : null;   // null: the holder published none (UNMEASURED on the page)
  const askedVsBuilt = kept.has(REGRESSED_ENTRY) ? regressedOf(kept.get(REGRESSED_ENTRY)) : null;   // C565k: null — the archive carries no regressed list (UNMEASURED on the page)
  const tokensPerCog = kept.has(TOKENS_PER_COG_ENTRY) ? tokensPerCogOf(kept.get(TOKENS_PER_COG_ENTRY)) : null;   // C659: null — the archive carries no cog record (UNMEASURED on the page)
  const panels = kept.has(PANELS_ENTRY) ? panelsOf(kept.get(PANELS_ENTRY)) : null;
  if (panels) panels.manifest = manifest;   // C647b: panelSrc builds the carried panel's store route from the archive's own sha
  const anatomy = kept.has(ANATOMY_ENTRY) ? anatomyOf(kept.get(ANATOMY_ENTRY)) : null;   // C652a: null — the archive carries no anatomy rows (UNMEASURED on the page)
  const odometer = kept.has(ODOMETER_ENTRY) ? odometerOf(kept.get(ODOMETER_ENTRY)) : null;   // C857: null — the archive carries no odometer tape (UNMEASURED on the page)
  const warrantyTerms = kept.has(WARRANTY_ENTRY) ? termsOf(kept.get(WARRANTY_ENTRY)) : null;   // C896: null — no terms in the archive (the warranty page reads PREVIEW)
  return { coding, deployed, panels, ticks, savingsDays, vega, askedVsBuilt, tokensPerCog , anatomy, odometer, warrantyTerms };
}

/** C647b: the carried panel PNGs inside a backup archive → Map<sha10, bytes>; refuses bytes that are not the manifest */
export async function panelsFromArchive(bytes, manifest) {
  const kept = await readEntries(bytes, manifest, (n) => PANEL_FILE.test(n), PANEL_ENTRY_CAP);
  const out = new Map();
  for (const [name, buf] of kept) { const m = PANEL_FILE.exec(name); if (m && isPng(buf)) out.set(m[1], new Uint8Array(buf)); }
  return out;
}
/** C647b: the panel route — the stored PNG for (manifest, sha10), or 404 with the reason; never a fetch, never a neighbour's panel */
export async function servePanelBlob({ store, manifest, sha10 }) {
  if (!isSha(manifest) || !/^[0-9a-f]{10}$/.test(String(sha10 || ''))) return { status: 404, body: { why: 'a panel is addressed by the archive sha (64 hex) and the commit sha10' } };
  const bytes = await store.getBlob(panelBlobKey(manifest, sha10)).catch(() => null);
  if (!bytes || !isPng(bytes)) return { status: 404, body: { why: `this backup carries no panel for ${sha10}` } };
  return { status: 200, bytes };
}

/** the receipt rows of the flight tape inside a backup archive — refuses bytes that are not the manifest */
export async function rowsFromArchive(bytes, manifest, opts = {}) { return (await tapesFromArchive(bytes, manifest, opts)).coding; }
/** C503: the deployed-tape rows (fleet + LLM) inside the same archive, each tagged with its job — the same one untar */
export async function deployedRowsFromArchive(bytes, manifest, opts = {}) { return (await tapesFromArchive(bytes, manifest, opts)).deployed; }

// the receipt names where the archive was stored; no receipt → no rows (the page says UNMEASURED), a bad blob refuses.
// C503: tapesFor(manifest) is the one call a page makes for both tapes — one download, one re-hash, one untar. rowsFor and
// deployedRowsFor are its halves for a caller that needs only one; nothing is cached, so every read re-hashes the stored blob.
async function storedTapes(store, manifest) {
  if (!isSha(manifest)) return { coding: [], deployed: [] };
  const receipt = await store.getReceipt(manifest);
  if (!receipt || !receipt.stored_at) return { coding: [], deployed: [] };
  return tapesFromArchive(await store.getBlob(receipt.stored_at), manifest);
}

export function memoryBackupStore() {
  const receipts = new Map(); const blobs = new Map();
  const store = {
    kind: 'memory',
    async getReceipt(sha) { return receipts.get(sha) || null; },
    async putBlob(path, bytes) { blobs.set(path, bytes); return path; },
    async putReceipt(r) { receipts.set(r.sha, r); return r; },
    async getBlob(path) { return blobs.get(path) || null; },
    // C509a: every receipt this account holds, so a holder with share_default ON can be answered from their NEWEST backup
    async receiptsByAccount(account_id) { return [...receipts.values()].filter((r) => r.account_id === account_id); },
    async rowsFor(manifest) { return (await storedTapes(store, manifest)).coding; },   // closes over the store: a detached rowsFor still reads it
    async deployedRowsFor(manifest) { return (await storedTapes(store, manifest)).deployed; },   // C503: the deployed half
    async tapesFor(manifest) { return storedTapes(store, manifest); },   // C503: both tapes, one untar
    blobs,
  };
  return store;
}

// Storage egress, 2026-10-19: every force-dynamic render of /backup, /backup/adherence, the warranty, archive and panel routes
// downloaded the whole ~3 MB archive again — 152,869 receipt lookups ≈ hundreds of GB against the org's egress quota. Blob paths are
// content-addressed (the sha is in the path, putBlob never upserts), so a warm instance keeps the bytes it already fetched; the
// re-hash in tapesFromArchive still runs on every read. Bounded by bytes, oldest out first. A miss (null) is never cached.
const BLOB_CACHE_BYTES = 96 * 1024 * 1024;
const blobCache = new Map();
let blobCacheSize = 0;
export function blobCacheGet(path) {
  const b = blobCache.get(path); if (!b) return null;
  blobCache.delete(path); blobCache.set(path, b); return b;
}
export function blobCachePut(path, bytes) {
  if (!bytes || bytes.byteLength > BLOB_CACHE_BYTES) return;
  if (blobCache.has(path)) { blobCacheSize -= blobCache.get(path).byteLength; blobCache.delete(path); }
  blobCache.set(path, bytes); blobCacheSize += bytes.byteLength;
  for (const [k, v] of blobCache) { if (blobCacheSize <= BLOB_CACHE_BYTES) break; blobCache.delete(k); blobCacheSize -= v.byteLength; }
}
export function blobCacheClear() { blobCache.clear(); blobCacheSize = 0; }

export function supabaseBackupStore(client, { bucket = 'backups', table = 'backup_receipts' } = {}) {
  const one = async (q, what) => { const { data, error } = await q; if (error) throw new Error(`${what}: ${error.message}`); return data || null; };
  const store = {
    kind: 'supabase',
    async getReceipt(sha) { return one(client.from(table).select('*').eq('sha', sha).maybeSingle(), table); },
    async putBlob(path, bytes) { await one(client.storage.from(bucket).upload(path, bytes, { contentType: 'application/gzip', upsert: false }), `storage/${bucket}`); return path; },
    async putReceipt(r) { await one(client.from(table).insert(r), table); return r; },
    async getBlob(path) {
      const hit = blobCacheGet(path); if (hit) return hit;
      const blob = await one(client.storage.from(bucket).download(path), `storage/${bucket}`);
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      if (bytes) blobCachePut(path, bytes);
      return bytes;
    },
    async rowsFor(manifest) { return (await storedTapes(store, manifest)).coding; },
    async deployedRowsFor(manifest) { return (await storedTapes(store, manifest)).deployed; },
    async tapesFor(manifest) { return storedTapes(store, manifest); },
    // C509a: every receipt this account holds, newest-first is left to the caller (shareOf picks the max received_at)
    async receiptsByAccount(account_id) { return (await one(client.from(table).select('*').eq('account_id', account_id), table)) || []; },
  };
  return store;
}

// C667e PUBLIC BY DEFAULT: with a share-defaults store and the pseudonym salt on hand, a fresh receipt records the default (one ON row)
// when this account has never had a share_default row — never over a holder's own choice. A store that fails never un-receipts the backup.
// @guard tests/vna/c651-the-link-i-send-is-the-landing.test.mjs
export async function receiveBackup({ store, account_id, manifest, bytes, now = () => new Date().toISOString(), shareDefaults = null, salt = '' }) {
  if (!account_id) return { status: 401, body: { why: 'sign in first — a backup is receipted to an account' } };
  if (!isSha(manifest)) return { status: 400, body: { why: 'manifest must be the sha256 (64 hex) the archive is named by' } };
  if (!bytes || !bytes.byteLength) return { status: 400, body: { why: 'no file — attach .thetacog/backup/<sha>.tar.gz' } };
  if (bytes.byteLength > MAX_BYTES) return { status: 413, body: { why: `archive is ${bytes.byteLength} bytes; the door takes up to ${MAX_BYTES}` } };
  const sha = hex(await subtle.digest('SHA-256', bytes));
  if (sha !== manifest) return { status: 422, body: { why: `the file's sha256 is ${sha.slice(0, 12)}…, not the manifest ${manifest.slice(0, 12)}… — the archive is named by its bytes; re-run the backup and upload that file`, sha } };
  // C651a THE WALK TAPE RIDES AS SEGMENTS: a segment archive (walk-segment.mjs) is refused unless its rows match its header and
  // its chain verifies against this account's previous ACKNOWLEDGED segment; the acknowledgement is written once the archive is stored
  const seg = await acceptWalkSegment({ store, account_id, read: (keep, cap) => readEntries(bytes, sha, keep, cap), now });
  if (seg.refuse) return seg.refuse;
  const existing = await store.getReceipt(sha);
  if (existing) { if (seg.commit) await seg.commit(existing); return { status: 200, body: { receipt: existing, replay: true } }; }
  const stored_at = await store.putBlob(`${account_id}/${sha}.tar.gz`, bytes);
  const receipt = { sha, bytes: bytes.byteLength, account_id, received_at: now(), stored_at };
  await store.putReceipt(receipt);
  if (seg.commit) await seg.commit(receipt);   // C651a: the segment is acknowledged only once its archive and receipt are stored
  // C647b: the carried panels go into the store beside the archive; a panel that fails to store is not counted, never fatal
  let panels_stored = 0;
  try { for (const [s10, png] of await panelsFromArchive(bytes, sha)) { try { await store.putBlob(panelBlobKey(sha, s10), png); panels_stored++; } catch { /* already stored */ } } } catch { /* an archive whose panels cannot be read still has its receipt */ }
  let shared_by_default = null;
  if (shareDefaults && salt) { try { shared_by_default = !!(await recordDefaultAtFirstBackup({ store: shareDefaults, account: account_id, salt })); } catch { shared_by_default = null; } }
  return { status: 200, body: { receipt, replay: false, panels_stored, ...(shared_by_default === null ? {} : { shared_by_default }) } };
}
