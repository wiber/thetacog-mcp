// src/lib/backup/walk-segment.mjs — C651a BACK UP ALL OF IT: THE WALK TAPE RIDES TOO, INCREMENTALLY (operator 2026-10-05,
// verbatim: "I don't see any reason why we couldn't back up all of it."). The pure half both sides share: what a segment IS,
// how its address is computed, how a segment chains to its predecessor, and what `hashes-only` lets leave the machine.
// scripts/vna/walk-segments.mjs builds and posts the segments; receive.mjs calls acceptWalkSegment before it stores one.
//
// A SEGMENT is one archive carrying two entries: SEGMENT_HEADER_ENTRY (the header below) and SEGMENT_ROWS_ENTRY (the rows,
// one per line). The header names the byte range of .thetacog/walk-tape.ndjson the rows came from [from_offset, to_offset),
// the row range [from_row, to_row), the hash of the last row, the sha256 of the rows entry, and `prev` — the seg_sha of the
// segment before it (null for seq 0). seg_sha = sha256 over the header's HEADER_KEYS in that order, so a segment's address
// commits to its predecessor's address: the chain verifies link by link (verifyLink), and a backup that starts anywhere but
// the last acknowledged to_offset does not verify.
//
// THE ROW HASH is sha256 (hex) of the tape line's raw bytes, newline excluded. A `full` segment carries the raw line (the hash
// is recomputable from it); a `hashes-only` segment carries { h: <row hash>, ...the row's coordinates and gauge numbers }.
//
// HASHES-ONLY IS A SCHEMA, NEVER A DENY-LIST (measured 2026-10-05 over all 302,806 rows of the live tape: no row field holds
// the prompt — the walker writes text_sha + text_chars — but `err` and `attempts[].err` echo argument bytes, `bin` is a path on
// the holder's disk, `sig_why` is prose, and any field a later writer adds is unknown). So a hashes-only row is the ROW_SCHEMA
// projection: a key the schema does not name never leaves; a leaf keeps a number, a boolean or null; a string leaf leaves only
// when it is a TOKEN (no whitespace, no '/', ≤ 64 chars — ids, shas, pixels, lane labels, ISO instants) and is otherwise
// replaced by `sha256:<12 hex>` of itself, so the holder can still prove what it was without sending it.
//
// SUFFICIENT FOR: that the holder's walk tape existed at these byte offsets with these row hashes, in this order, and where
// each row landed (pixel, cells, trajectory, the ratchet's numbers). NOT SUFFICIENT FOR: what the prompt said (hashes-only
// never carries it), nor whether the work was good (Rice, 1953).
// @guard tests/vna/c651a-back-up-all-of-it.test.mjs
import { createHash } from 'node:crypto';

export const WALK_TAPE_REL = '.thetacog/walk-tape.ndjson';
export const SEGMENT_HEADER_ENTRY = 'walk-tape/segment.json';
export const SEGMENT_ROWS_ENTRY = 'walk-tape/rows.ndjson';
export const MODES = Object.freeze(['full', 'hashes-only', 'off']);
export const DEFAULT_MODE = 'hashes-only';   // uploading prompt text is never the silent default
export const HEADER_KEYS = Object.freeze(['v', 'kind', 'tape', 'mode', 'seq', 'prev', 'from_offset', 'to_offset', 'from_row', 'to_row', 'rows', 'first_row_hash', 'last_row_hash', 'payload_sha256', 'payload_bytes']);
export const SEGMENT_ENTRY_CAP = 64 * 1024 * 1024;   // a rows entry over this is refused, never truncated

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const rowHash = (lineBytes) => sha256(lineBytes);
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const isCount = (n) => Number.isInteger(n) && n >= 0;

/** the segment's address: sha256 over HEADER_KEYS in order — commits to prev, so the address is the chain */
export function segmentSha(header) {
  return sha256(JSON.stringify(HEADER_KEYS.map((k) => [k, header[k] === undefined ? null : header[k]])));
}

/** the shape a header must have before any link is read; returns the reason or null */
export function headerFault(h) {
  if (!h || typeof h !== 'object') return 'no header';
  if (h.v !== 1 || h.kind !== 'walk-segment') return 'not a walk-segment header (v 1)';
  if (h.tape !== WALK_TAPE_REL) return `the tape must be ${WALK_TAPE_REL}`;
  if (!MODES.includes(h.mode) || h.mode === 'off') return `mode ${JSON.stringify(h.mode)} is not a carry (full · hashes-only)`;
  for (const k of ['seq', 'from_offset', 'to_offset', 'from_row', 'to_row', 'rows', 'payload_bytes']) if (!isCount(h[k])) return `${k} must be a non-negative integer`;
  if (h.to_offset <= h.from_offset || h.to_row <= h.from_row) return 'an empty segment carries nothing';
  if (h.to_row - h.from_row !== h.rows) return 'to_row − from_row must equal rows';
  for (const k of ['first_row_hash', 'last_row_hash', 'payload_sha256']) if (!isHex64(h[k])) return `${k} must be sha256 hex`;
  if (h.seq === 0 ? h.prev !== null : !isHex64(h.prev)) return h.seq === 0 ? 'seq 0 has no predecessor — prev must be null' : 'prev must be the predecessor seg_sha';
  return null;
}

/** C651a THE CHAIN: does `next` follow `prev` (both headers; prev null for the first segment)? { ok, why } */
export function verifyLink(prev, next) {
  const f = headerFault(next); if (f) return { ok: false, why: f };
  if (!prev) {
    if (next.seq !== 0 || next.prev !== null || next.from_offset !== 0 || next.from_row !== 0) return { ok: false, why: 'the first segment must be seq 0, prev null, from byte 0, row 0' };
    return { ok: true };
  }
  const pf = headerFault(prev); if (pf) return { ok: false, why: `predecessor: ${pf}` };
  if (next.seq !== prev.seq + 1) return { ok: false, why: `seq ${next.seq} does not follow ${prev.seq}` };
  if (next.prev !== segmentSha(prev)) return { ok: false, why: `prev ${String(next.prev).slice(0, 12)}… is not the predecessor's address ${segmentSha(prev).slice(0, 12)}…` };
  if (next.from_offset !== prev.to_offset) return { ok: false, why: `from byte ${next.from_offset} ≠ the predecessor's to byte ${prev.to_offset} — a gap or a re-sent row` };
  if (next.from_row !== prev.to_row) return { ok: false, why: `from row ${next.from_row} ≠ the predecessor's to row ${prev.to_row}` };
  return { ok: true };
}

/** the rows entry checked against its header: sha, byte count, row count, last row hash. { ok, why } */
export function verifyRows(header, rowsBytes) {
  const b = Buffer.from(rowsBytes);
  if (b.length !== header.payload_bytes) return { ok: false, why: `rows entry is ${b.length} bytes, header says ${header.payload_bytes}` };
  if (sha256(b) !== header.payload_sha256) return { ok: false, why: 'rows entry sha256 is not the header payload_sha256' };
  const lines = []; let i0 = 0; for (let i = b.indexOf(0x0a); i >= 0; i = b.indexOf(0x0a, i0)) { lines.push(b.subarray(i0, i)); i0 = i + 1; }
  if (i0 !== b.length) return { ok: false, why: 'rows entry does not end on a newline' };
  if (lines.length !== header.rows) return { ok: false, why: `${lines.length} rows carried, header says ${header.rows}` };
  const hashOf = (l) => { if (header.mode === 'full') return rowHash(l); try { const r = JSON.parse(l.toString('utf8')); return r && r.h; } catch { return null; } };
  if (hashOf(lines[0]) !== header.first_row_hash) return { ok: false, why: 'first row hash does not match the header' };
  if (hashOf(lines[lines.length - 1]) !== header.last_row_hash) return { ok: false, why: 'last row hash does not match the header' };
  return { ok: true };
}

// ── hashes-only: the schema projection ──────────────────────────────────────────────────────────────────────────────────
const S = 1;   // a leaf: number · boolean · null · TOKEN string (else hashed)
const PERM = { k: S, null: S, rungs: S, skipped: S };
export const ROW_SCHEMA = Object.freeze({
  ts: S, source: S, ref: S, session: S, room: S, text_sha: S, text_chars: S, bulk_chars: S, context_sha: S, sensor: S, err: S,
  pixel: S, sigma: S, walked: S, in_role: S, out_of_role: S, off_pct: S, hops: S, max_ply: S, ms: S, routed: S, routed_center: S,
  aperture_id: S, admissible: S, cells: [S], trajectory: [S], bin_sha: S, reef_sha: S, axes_sha: S, reef_blob: S, axes_blob: S,
  sig: S, sig_pubkey: S, model: S, leaf: S, leaf_id: S,
  fit: { gain: S, z: S, ok: S },
  aperture: { cap: S, used: S, bulk: S, digest: S, digest_requested: S, ladder: S, thread: S },
  intentSpan: { chars: S, floor: S, gzip: S, prompts: S, session: S, thread: S },
  knobs: { maxDepth: S, topK: S, budget: S, decay: S, raised: [S] },
  ratchet: { admissible: S, admissible_rungs: S, grip: S, guided_passes: S, null: S, raw_admissible: S, rungs: S, steps: S, thread_admissible: S, thread_stages: S, winner: S, z_required: S, worms: { n: S, orthogonal: S, rings: S, seeds: [S] }, perm: PERM, perm_thread: PERM },
  attempts: [{ gain: S, grip: S, hats: S, label: S, mass: S, ok: S, pixel: S, z: S, thread_prompts: S, err: S }],
});
export const TOKEN = /^[A-Za-z0-9_.:,@+=-]{0,64}$/;
const leaf = (v) => {
  if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (typeof v === 'string') return TOKEN.test(v) ? v : `sha256:${sha256(v).slice(0, 12)}`;
  return undefined;   // an object or array where the schema names a leaf never leaves
};
function project(v, schema) {
  if (schema === S) return leaf(v);
  if (Array.isArray(schema)) return Array.isArray(v) ? v.map((x) => project(x, schema[0])).filter((x) => x !== undefined) : (v === null ? null : undefined);
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = {}; for (const k of Object.keys(schema)) if (Object.prototype.hasOwnProperty.call(v, k)) { const p = project(v[k], schema[k]); if (p !== undefined) o[k] = p; }
  return o;
}
/** one tape line (Buffer) → the hashes-only row (a JSON line, Buffer, no newline). An unparseable line carries its hash only. */
export function hashesOnlyLine(lineBytes) {
  const h = rowHash(lineBytes);
  let r = null; try { r = JSON.parse(Buffer.from(lineBytes).toString('utf8')); } catch { r = null; }
  const body = r && typeof r === 'object' && !Array.isArray(r) ? project(r, ROW_SCHEMA) : {};
  return Buffer.from(JSON.stringify({ h, ...body }), 'utf8');
}
/** the line a segment carries for one tape line, by mode */
export function carryLine(lineBytes, mode) {
  if (mode === 'full') return Buffer.from(lineBytes);
  if (mode === 'hashes-only') return hashesOnlyLine(lineBytes);
  throw new Error(`carryLine: mode ${JSON.stringify(mode)} carries nothing`);
}

// ── the receive side ─────────────────────────────────────────────────────────────────────────────────────────────────
export const ackKey = (account_id, seq) => `walk-segments/${account_id}/${String(seq).padStart(8, '0')}.json`;
const getAck = async (store, account_id, seq) => {
  let b = null; try { b = await store.getBlob(ackKey(account_id, seq)); } catch { b = null; }
  if (!b) return null; try { return JSON.parse(Buffer.from(b).toString('utf8')); } catch { return null; }
};
/**
 * C651a: called by receiveBackup after the archive's sha is checked and before anything is stored. `read(keep, cap)` is
 * receive.mjs's one untar (readEntries). Not a segment archive (or not an archive at all) → {}. A segment whose rows do not match its header, or whose
 * chain does not verify against the PREVIOUS ACKNOWLEDGED segment of this account → { refuse: { status: 409, body } }.
 * Verified → { segment, commit(receipt) } — commit writes the acknowledgement at ackKey(account, seq) once the archive is stored.
 * The same segment again (same seq, same seg_sha) is a replay: accepted, nothing re-written; a different one at a held seq is a fork, refused.
 */
export async function acceptWalkSegment({ store, account_id, read, now = () => new Date().toISOString() }) {
  let kept;
  try { kept = await read((n) => n === SEGMENT_HEADER_ENTRY || n === SEGMENT_ROWS_ENTRY, SEGMENT_ENTRY_CAP); }
  catch { return {}; }   // bytes the untar cannot open carry no segment — the door's other checks answer for them, as before C651a
  if (!kept.has(SEGMENT_HEADER_ENTRY)) return {};
  const refuse = (why, status = 409) => ({ refuse: { status, body: { why: `walk segment refused — ${why}` } } });
  let header = null; try { header = JSON.parse(kept.get(SEGMENT_HEADER_ENTRY).toString('utf8')); } catch { return refuse('the header is not JSON', 422); }
  const f = headerFault(header); if (f) return refuse(f, 422);
  const seg_sha = segmentSha(header);
  if (header.seg_sha !== undefined && header.seg_sha !== seg_sha) return refuse('the header names a seg_sha its own fields do not hash to', 422);
  if (!kept.has(SEGMENT_ROWS_ENTRY)) return refuse('no rows entry', 422);
  const rows = verifyRows(header, kept.get(SEGMENT_ROWS_ENTRY)); if (!rows.ok) return refuse(rows.why, 422);
  const held = await getAck(store, account_id, header.seq);
  if (held) return held.seg_sha === seg_sha ? { segment: { seq: header.seq, seg_sha, replay: true } } : refuse(`seq ${header.seq} is already acknowledged as ${String(held.seg_sha).slice(0, 12)}… — a fork is never accepted`);
  const prev = header.seq === 0 ? null : await getAck(store, account_id, header.seq - 1);
  if (header.seq > 0 && !prev) return refuse(`no acknowledged segment ${header.seq - 1} to chain to — send the segments in order`);
  const link = verifyLink(prev ? prev.header : null, header); if (!link.ok) return refuse(link.why);
  const ack = { seq: header.seq, seg_sha, header: Object.fromEntries(HEADER_KEYS.map((k) => [k, header[k] === undefined ? null : header[k]])) };
  return {
    segment: { seq: header.seq, seg_sha, replay: false },
    commit: async (receipt) => { await store.putBlob(ackKey(account_id, header.seq), Buffer.from(JSON.stringify({ ...ack, archive: receipt && receipt.sha, acked_at: now() }) + '\n')); },
  };
}
