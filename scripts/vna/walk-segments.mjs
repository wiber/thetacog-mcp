#!/usr/bin/env node
// scripts/vna/walk-segments.mjs — C651a BACK UP ALL OF IT: THE WALK TAPE RIDES TOO, INCREMENTALLY (operator 2026-10-05,
// verbatim: "I don't see any reason why we couldn't back up all of it."). Measured by the chair 2026-10-05: the walk tape is
// 1,415,897,583 B raw, 114,054,379 B gzipped, kept local by backup.mjs TAPE_FILES.local_diary; one POST body is 4.5 MB
// (backup.mjs UPLOAD_BODY_LIMIT) and one archive at most 200 MB (receive.mjs MAX_BYTES). So the tape never travels whole:
// it rides as APPEND-ONLY SEGMENTS (src/lib/backup/walk-segment.mjs says what a segment is). Each backup builds segments from
// the LAST ACKNOWLEDGED segment's to_offset — the rows since, and only those — each one content-addressed and chained to the
// previous one's seg_sha, each archive under the POST body cap. The first full upload is simply many segments.
//
// NEVER READ WHOLE. The tape passed Node's string ceiling once (a 547 MB read threw and readers silently returned []). Every
// read here is a bounded readSync of READ_CHUNK bytes at a byte offset (lineSpans); a row is assembled from its own chunks
// only; a segment's rows are Buffers capped at rawCap. The end is backup.mjs frozenSize — the last newline when the build
// starts — so a row being appended mid-build never rides half-written.
//
// THE ACKNOWLEDGEMENT is the server's 200 for that segment's archive (receive.mjs verified the chain against this account's
// previous acknowledged segment before storing it). Each one is appended to ACKS_REL (append-only: the resume point is its
// last row, and the ledger itself must chain). A segment built but never acknowledged is rebuilt byte-identically next time
// (same rows, same mode → same seg_sha, same archive sha), so nothing is lost and nothing acknowledged is ever re-sent.
//
// THE SETTING (the holder's, SETTING_REL — { "carry": "full" | "hashes-only" | "off" }): absent or unreadable → hashes-only
// (row hashes + coordinates + gauge numbers, no text — walk-segment.mjs ROW_SCHEMA). Uploading prompt text is never the
// silent default. The mode rides in every segment header, so the page states what was carried.
//
// COVERAGE (walkCoverage): rows online = the last acknowledged to_row; rows local = rows online + the newlines past its
// to_offset (a bounded scan of the unacknowledged tail only). 100 % only when no byte past the acknowledged offset is a row —
// a segment built and not acknowledged is NOT online. backup-cost.mjs (C647j) takes `online` for the walk tape from
// walkOnline() rather than counting it a second way.
//
//   node scripts/vna/walk-segments.mjs                 # status: setting, acknowledged rows, coverage
//   node scripts/vna/walk-segments.mjs --dry-run [--out <dir>] [--mode full|hashes-only] [--json]
//                                                       # build every pending segment into a scratch dir; posts NOTHING
// Posting rides the ship: `npm run ship` → backup.mjs --upload --tapes → uploadIfChanged → uploadWalkSegments.
// LLM-FREE. Rust port row: C651a.r — the segmenter holds mass (the 1.4 GB tape); it ports with backup.mjs's reader once the
// mechanism has posted a full chain (MAXIMISE RUST: proved here first).
// @guard tests/vna/c651a-back-up-all-of-it.test.mjs
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { frozenSize, tarEntries, UPLOAD_ENDPOINT, UPLOAD_BODY_LIMIT, FORM_HEADROOM, countersignInstant } from './backup.mjs';
import { WALK_TAPE_REL, MODES, DEFAULT_MODE, HEADER_KEYS, SEGMENT_HEADER_ENTRY, SEGMENT_ROWS_ENTRY, segmentSha, verifyLink, rowHash, carryLine } from '../../src/lib/backup/walk-segment.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SETTING_REL = 'data/vna/walk-tape-setting.json';
export const SEGMENTS_REL = '.thetacog/backup/walk-segments';
export const ACKS_REL = `${SEGMENTS_REL}/acks.ndjson`;
export const READ_CHUNK = 64 * 1024;                                   // the most any one read asks for
export const SEGMENT_GZ_CAP = UPLOAD_BODY_LIMIT - FORM_HEADROOM - 64 * 1024;   // one segment archive fits one POST body
export const SEGMENT_RAW_CAP = 32 * 1024 * 1024;                        // rows carried per segment before the gz check
export const MAX_ROW_BYTES = 8 * 1024 * 1024;                           // a single line past this is refused, never assembled
export const MAX_SEGMENTS_PER_RUN = 64;                                 // per ship; the rest ride the next one

const settingPath = (repo) => process.env.VNA_WALK_SETTING || resolve(repo, SETTING_REL);
/** the holder's setting → { mode, why } — absent or unreadable is hashes-only, never full */
export function resolveMode({ repo = REPO, setting } = {}) {
  let s = setting; if (s === undefined) { try { s = JSON.parse(readFileSync(settingPath(repo), 'utf8')); } catch { s = null; } }
  const declared = s && typeof s.carry === 'string' ? s.carry : null;
  if (declared && MODES.includes(declared)) return { mode: declared, why: `declared in ${SETTING_REL}: ${declared}` };
  return { mode: DEFAULT_MODE, why: declared ? `${JSON.stringify(declared)} is not a carry (${MODES.join(' · ')}) — hashes-only` : `no carry declared in ${SETTING_REL} — hashes-only (row hashes + coordinates, no prompt text)` };
}

const defaultReadAt = (fd, buf, off, len, pos) => readSync(fd, buf, off, len, pos);
/** the tape's lines between two byte offsets, read READ_CHUNK at a time: yields { line: Buffer, start, end } (end past the newline) */
export function* lineSpans(path, start, end, { readAt = defaultReadAt, chunk = READ_CHUNK } = {}) {
  const fd = openSync(path, 'r'); const buf = Buffer.alloc(chunk);
  try {
    let pos = start; let lineStart = start; let carry = []; let carryLen = 0;
    while (pos < end) {
      const n = readAt(fd, buf, 0, Math.min(chunk, end - pos), pos); if (!(n > 0)) break;
      let i0 = 0;
      for (let i = buf.indexOf(0x0a, 0); i >= 0 && i < n; i = buf.indexOf(0x0a, i0)) {
        const piece = buf.subarray(i0, i);
        const line = carryLen ? Buffer.concat([...carry, piece]) : Buffer.from(piece);
        const lineEnd = pos + i + 1; carry = []; carryLen = 0; i0 = i + 1;
        yield { line, start: lineStart, end: lineEnd }; lineStart = lineEnd;
      }
      if (i0 < n) { carry.push(Buffer.from(buf.subarray(i0, n))); carryLen += n - i0; if (carryLen > MAX_ROW_BYTES) throw new Error(`walk tape: a row past byte ${lineStart} is over ${MAX_ROW_BYTES} bytes — refused, never assembled`); }
      pos += n;
    }
  } finally { closeSync(fd); }
}
const countNewlines = (path, start, end, opts) => { let n = 0; for (const _ of lineSpans(path, start, end, opts)) n++; return n; };

const segDir = (repo) => resolve(repo, SEGMENTS_REL);
/** the acknowledgement ledger, oldest first; a ledger whose own rows do not chain is refused (never resumed from) */
export function readAcks({ repo = REPO } = {}) {
  const p = resolve(repo, ACKS_REL); if (!existsSync(p)) return { ok: true, acks: [] };
  const acks = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  if (acks.some((a) => !a || !a.header)) return { ok: false, acks: [], why: `${ACKS_REL} holds a row that is not an acknowledgement` };
  for (let i = 0; i < acks.length; i++) { const v = verifyLink(i ? acks[i - 1].header : null, acks[i].header); if (!v.ok) return { ok: false, acks: [], why: `${ACKS_REL} row ${i}: ${v.why}` }; }
  return { ok: true, acks };
}
/** C647j's walk-tape `online`: the acknowledged rows and bytes, read off the ledger only */
export function walkOnline({ repo = REPO } = {}) {
  const r = readAcks({ repo }); const last = r.acks.length ? r.acks[r.acks.length - 1].header : null;
  return { ok: r.ok, rows: last ? last.to_row : 0, bytes: last ? last.to_offset : 0, segments: r.acks.length, mode: last ? last.mode : null, ...(r.ok ? {} : { why: r.why }) };
}
/** rows local / rows online for the walk tape; pct 100 only when nothing past the acknowledged offset is a row */
export function walkCoverage({ repo = REPO, readAt } = {}) {
  const tape = resolve(repo, WALK_TAPE_REL);
  const on = walkOnline({ repo });
  if (!existsSync(tape)) return { tape: WALK_TAPE_REL, local: null, online: on.rows, pct: null, pending_rows: null, why: 'no walk tape on this machine' };
  const end = frozenSize(tape);
  const pending = end > on.bytes ? countNewlines(tape, on.bytes, end, { readAt }) : 0;
  const local = on.rows + pending;
  return { tape: WALK_TAPE_REL, local, online: on.rows, pending_rows: pending, pct: local ? Math.floor((on.rows / local) * 10000) / 100 : null, segments: on.segments, mode: on.mode };
}

/** the row hash of the line that ends exactly at `offset` — a bounded backward read, never the whole tape */
function rowHashEndingAt(path, offset, readAt = defaultReadAt) {
  const fd = openSync(path, 'r'); const parts = []; const buf = Buffer.alloc(READ_CHUNK);
  try {
    let end = offset - 1; let total = 0;   // offset-1 is the newline
    while (end > 0) {
      const start = Math.max(0, end - READ_CHUNK); const n = readAt(fd, buf, 0, end - start, start);
      const i = buf.subarray(0, n).lastIndexOf(0x0a);
      if (i >= 0) { parts.unshift(Buffer.from(buf.subarray(i + 1, n))); break; }
      parts.unshift(Buffer.from(buf.subarray(0, n))); total += n; if (total > MAX_ROW_BYTES) return null; end = start;
    }
  } finally { closeSync(fd); }
  return rowHash(Buffer.concat(parts));
}

async function writeArchive(entries, out) {
  const tmp = `${out}.tmp-${process.pid}`; const h = createHash('sha256'); let bytes = 0;
  const tee = new Transform({ transform(c, _e, cb) { h.update(c); bytes += c.length; cb(null, c); } });
  await pipeline(Readable.from(tarEntries(entries, [])), createGzip(), tee, createWriteStream(tmp));
  const sha = h.digest('hex'); const abs = resolve(dirname(out), `${sha}.tar.gz`); renameSync(tmp, abs);
  return { sha, bytes, abs };
}

/**
 * build the ONE next segment after `after` (the last acknowledged header, or null) → { header, seg_sha, archive: { sha, bytes, abs } }
 * or null when no row is past after.to_offset. Deterministic: same tape bytes + same mode → same seg_sha and archive sha.
 */
export async function buildSegment({ tape, after = null, mode, outDir, rawCap = SEGMENT_RAW_CAP, gzCap = SEGMENT_GZ_CAP, readAt, maxRows = Infinity }) {
  const end = frozenSize(tape); const from = after ? after.to_offset : 0;
  if (end <= from) return null;
  mkdirSync(outDir, { recursive: true });
  const parts = []; let raw = 0; let rows = 0; let first = null; let last = null; let to = from;
  for (const { line, end: e } of lineSpans(tape, from, end, { readAt })) {
    const h = rowHash(line); if (first === null) first = h; last = h;
    const c = carryLine(line, mode); parts.push(c, Buffer.from('\n')); raw += c.length + 1; rows++; to = e;
    if (raw >= rawCap || rows >= maxRows) break;
  }
  if (!rows) return null;
  const payload = Buffer.concat(parts);
  const header = { v: 1, kind: 'walk-segment', tape: WALK_TAPE_REL, mode, seq: after ? after.seq + 1 : 0, prev: after ? segmentSha(after) : null,
    from_offset: from, to_offset: to, from_row: after ? after.to_row : 0, to_row: (after ? after.to_row : 0) + rows, rows,
    first_row_hash: first, last_row_hash: last, payload_sha256: createHash('sha256').update(payload).digest('hex'), payload_bytes: payload.length };
  const seg_sha = segmentSha(header);
  const hTmp = resolve(outDir, `.seg-${process.pid}.json`); const rTmp = resolve(outDir, `.seg-${process.pid}.ndjson`);
  writeFileSync(hTmp, JSON.stringify({ ...Object.fromEntries(HEADER_KEYS.map((k) => [k, header[k]])), seg_sha }) + '\n'); writeFileSync(rTmp, payload);
  let archive;
  try { archive = await writeArchive([{ path: SEGMENT_HEADER_ENTRY, abs: hTmp }, { path: SEGMENT_ROWS_ENTRY, abs: rTmp }], resolve(outDir, 'segment')); }
  finally { try { unlinkSync(hTmp); } catch {} try { unlinkSync(rTmp); } catch {} }
  if (archive.bytes > gzCap) {
    try { unlinkSync(archive.abs); } catch {}
    if (rows === 1) throw new Error(`walk segment: one row at byte ${from} compresses to ${archive.bytes} bytes, over the ${gzCap}-byte segment cap`);
    return buildSegment({ tape, after, mode, outDir, rawCap, gzCap, readAt, maxRows: Math.floor(rows / 2) });   // halve, deterministically
  }
  return { header, seg_sha, archive };
}

/** where the next segment starts, checked: the ledger chains and the tape still holds the acknowledged last row at its offset */
function resumePoint({ repo, tape, readAt }) {
  const r = readAcks({ repo }); if (!r.ok) return { ok: false, why: r.why };
  const after = r.acks.length ? r.acks[r.acks.length - 1].header : null;
  if (after) {
    if (!existsSync(tape) || frozenSize(tape) < after.to_offset) return { ok: false, why: `the walk tape is shorter than the acknowledged ${after.to_offset} bytes — it was rewritten under an acknowledged segment` };
    if (rowHashEndingAt(tape, after.to_offset, readAt) !== after.last_row_hash) return { ok: false, why: `the row ending at byte ${after.to_offset} is not the acknowledged last row — the tape changed under an acknowledged segment` };
  }
  return { ok: true, after };
}

/** the streamed dry run: every pending segment built into outDir (scratch), NOTHING posted → { mode, segments: [...], rows, bytes } */
export async function dryRun({ repo = REPO, outDir = mkdtempSync(join(tmpdir(), 'walk-segments-dry-')), mode = resolveMode({ repo }).mode, rawCap, gzCap, readAt, keep = false } = {}) {
  const tape = resolve(repo, WALK_TAPE_REL); if (!existsSync(tape)) return { mode, segments: [], rows: 0, bytes: 0, why: 'no walk tape' };
  const start = resumePoint({ repo, tape, readAt }); if (!start.ok) return { mode, segments: [], rows: 0, bytes: 0, why: start.why };
  let after = start.after; const segments = [];
  if (mode === 'off') return { mode, segments, rows: 0, bytes: 0, why: 'carry is off — nothing leaves the machine' };
  for (;;) {
    const s = await buildSegment({ tape, after, mode, outDir, rawCap, gzCap, readAt }); if (!s) break;
    segments.push({ seq: s.header.seq, rows: s.header.rows, from_offset: s.header.from_offset, to_offset: s.header.to_offset, payload_bytes: s.header.payload_bytes, archive_bytes: s.archive.bytes, seg_sha: s.seg_sha });
    if (!keep) { try { unlinkSync(s.archive.abs); } catch {} }
    after = s.header;
  }
  return { mode, outDir, segments, rows: segments.reduce((a, s) => a + s.rows, 0), bytes: segments.reduce((a, s) => a + s.archive_bytes, 0), max_archive_bytes: segments.reduce((a, s) => Math.max(a, s.archive_bytes), 0) };
}

async function postArchive({ abs, sha, endpoint, bearer, fetch }) {
  const bytes = readFileSync(abs);   // one segment archive, under SEGMENT_GZ_CAP by construction
  if (bytes.length + FORM_HEADROOM > UPLOAD_BODY_LIMIT) return { ok: false, why: `segment archive is ${bytes.length} bytes, over the upload body limit` };
  const form = new FormData(); form.set('manifest', sha); form.set('file', new Blob([bytes], { type: 'application/gzip' }), `${sha}.tar.gz`);
  let res; try { res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, body: form }); }
  catch (e) { return { ok: false, why: `POST ${endpoint}: ${e && e.message || e}` }; }
  let body = null; try { body = await res.json(); } catch { body = null; }
  if (res.status !== 200 || !body || !body.receipt) return { ok: false, status: res.status, why: (body && body.why) || `the upload answered ${res.status}` };
  return { ok: true, receipt: body.receipt, headers: res.headers, bytes: bytes.length };
}

/**
 * C651a, the ship's rider: build and POST the pending segments in order, appending one acknowledgement per 200. Stops at the
 * first refusal (the next ship resumes from the last acknowledgement). A missing tape or carry `off` posts nothing.
 */
export async function uploadWalkSegments({ repo = REPO, bearer = null, fetch = globalThis.fetch, endpoint = UPLOAD_ENDPOINT, now = () => new Date().toISOString(), maxSegments = MAX_SEGMENTS_PER_RUN, rawCap, gzCap, readAt, setting } = {}) {
  const { mode, why: setting_why } = resolveMode({ repo, setting });
  const tape = resolve(repo, WALK_TAPE_REL);
  const base = { mode, setting_why, posted: 0, rows_posted: 0, bytes_posted: 0 };
  if (!existsSync(tape)) return { ...base, ok: true, why: 'no walk tape on this machine' };
  if (mode === 'off') return { ...base, ok: true, why: 'carry is off — the walk tape stays the local diary', coverage: walkCoverage({ repo, readAt }) };
  if (!bearer) return { ...base, ok: false, why: 'no entitlement — a segment is receipted to an account; 💳 first (C102a)' };
  const start = resumePoint({ repo, tape, readAt }); if (!start.ok) return { ...base, ok: false, why: start.why };
  let after = start.after; const out = { ...base, ok: true, segments: [] };
  const dir = segDir(repo);
  for (let i = 0; i < maxSegments; i++) {
    const s = await buildSegment({ tape, after, mode, outDir: dir, rawCap, gzCap, readAt }); if (!s) break;
    const r = await postArchive({ abs: s.archive.abs, sha: s.archive.sha, endpoint, bearer, fetch });
    try { unlinkSync(s.archive.abs); } catch {}   // recomputable from the tape, byte-identical; the acknowledgement is the record
    if (!r.ok) { out.ok = false; out.why = `segment ${s.header.seq} NOT acknowledged — ${r.why}`; break; }
    const ack = { seq: s.header.seq, seg_sha: s.seg_sha, archive: s.archive.sha, header: s.header, receipt: r.receipt, acked_at: now(), ...countersignInstant({ receipt: r.receipt, headers: r.headers, now }) };
    appendFileSync(resolve(repo, ACKS_REL), JSON.stringify(ack) + '\n');
    out.posted++; out.rows_posted += s.header.rows; out.bytes_posted += r.bytes; out.segments.push({ seq: s.header.seq, rows: s.header.rows, seg_sha: s.seg_sha, archive: s.archive.sha });
    after = s.header;
  }
  out.coverage = walkCoverage({ repo, readAt });
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json'); const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  if (argv.includes('--dry-run')) {
    const r = await dryRun({ ...(arg('--out') ? { outDir: resolve(arg('--out')), keep: true } : {}), ...(arg('--mode') ? { mode: arg('--mode') } : {}) });
    if (asJson) console.log(JSON.stringify(r));
    else console.log(`walk tape DRY RUN (nothing posted) · carry ${r.mode} · ${r.segments.length} segment${r.segments.length === 1 ? '' : 's'} · ${r.rows.toLocaleString('en-US')} rows · ${(r.bytes / 1e6).toFixed(1)} MB gz · largest ${((r.max_archive_bytes || 0) / 1e6).toFixed(2)} MB (cap ${(SEGMENT_GZ_CAP / 1e6).toFixed(2)} MB)${r.why ? ` · ${r.why}` : ''}`);
  } else {
    const m = resolveMode(); const c = walkCoverage();
    if (asJson) console.log(JSON.stringify({ setting: m, coverage: c }));
    else console.log(`walk tape · carry ${m.mode} (${m.why}) · rows local ${c.local ?? '—'} · online ${c.online} · ${c.pct ?? '—'} % · ${c.segments || 0} segments acknowledged`);
  }
}
