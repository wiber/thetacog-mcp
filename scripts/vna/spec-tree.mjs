#!/usr/bin/env node
// scripts/vna/spec-tree.mjs — THE SPEC TREE: the steer file as a typed, content-addressed Merkle tree.
//
// OPERATOR ASK (2026-09-17, verbatim): "we need to implement the ast / merkle json which is rendered as
// the spec in the side panel" and, the same night: "we should be able to mine both the clipboard and
// the txt file without double writes to the merkle spec / json? timed decisions in json would prove
// what the latest decision was."
//
// WHAT IT IS. The steer file is a flat .txt that grows by appends — dictation, pastes, clipboard
// drops. Read top to bottom it is a conversation; read as a spec it is a set of typed statements
// (an invariant, a boundary, an interface, a decision, a question, an intent) hanging under the
// headings and the turns that introduced them. This script cuts the text along those semantic
// boundaries into TYPED NODES, hashes every node (sha256), hashes every parent over its own content
// and its children in order, and writes the root — one hash that stands for the whole spec state and
// can be logged as an attestation (data/vna/spec-tree-roots.ndjson, one row per root change).
//
// ONE SOURCE, NO DOUBLE WRITE. The tree ingests ONLY docs/specs/vna/amendments.ndjson rows. The tail
// watcher already turns every append — typed or clipboard-pasted — into exactly one row, so reading
// the .txt or the clip ledger here would be a second reader of the same bytes and the tree would
// carry a node twice. Every node and every revision carries `meta.rowSha` (the row's own sha256), and
// ingestion is idempotent on it: a row already ingested is skipped before it is chunked. A clipboard
// append arrives inside the row as a marker line `<!-- clip · <ISO> · <sha8> -->`; the marker is
// stripped from node text and recorded as `meta.via:'clip'`, so a paste and a typed line of the same
// text are ONE node either way (byte-identical text → the same leaf hash → no new node, no revision).
//
// TIMED DECISIONS. A re-paste of the same topic (gzip-NCD below NCD_REVISION against an existing node
// of the same type) is a REVISION of that node, never a new node: `content` is ALWAYS the latest
// revision by the row's `at`, `decidedAt` is that revision's `at`, `supersedes` is the hash of the
// version before it, and `revisions[]` (ascending by `at`) archives every earlier text WITH its hash.
// "What was the latest decision" is then read from the receipt, never inferred from chat order.
//
// PLACEMENT COMES FROM THE ONE WALK DOOR. `pixel` on a leaf is lensWalk's answer (the same door
// steer-hook.mjs uses, source 'spec-tree', one row on the one tape per walk). It is NEVER a regex or
// a noun count (CLAUDE.md: a lattice reading comes from the one Rust walk). A walk that refuses leaves
// `pixel: null` — UNMEASURED, never a guess — and the pixel is not part of any hash, so a refusal
// never moves the root.
//
// INCREMENTAL. data/vna/spec-tree.json is read back; only rows past the stored watermark are
// chunked; an unchanged node keeps its hash byte for byte; only the touched leaf and its ancestors are
// re-hashed (rehash). The JSON carries no wall-clock stamp — `at` is the newest row's `at` — so a
// re-run with nothing new is byte-identical, which is what makes the root an attestation rather than
// a timestamp.
//
// LLM-FREE end to end: sha256, gzip, one Rust walk. No model in any path.
//
//   node scripts/vna/spec-tree.mjs [--json] [--proof <nodeId>] [--bundle <nodeId>] [--history [N]] [--calibrate] [--ratchet] [--status] [--seed "<prompt>"] [--retract <rowSha> --why "<why>"] [--echoes] [--ungraded [--leaf <id>]] [--grade <nodeId> <hash8> KEPT|CORRECTED|REFUSED --why "…"] [--no-walk] [--no-basins] [--migrate-blobs]
//     --migrate-blobs C165c: ONCE — the legacy one-object <tree>.blobs.json → the append-only .blobs.ndjson + offset index; parity-verified, receipted on the roots ledger, the legacy file left in place
//     --calibrate C52d: ONCE — the starting τ_attach from the shuffled null (the seed 0.55 was typed, never measured); the ratchet only tightens after
//     --status    C52d: the instrument's receipts — source, fold latency, attach/abstain/new, seed abstain rate — refuses "working" without them
//     basins   C52a: the spec's own `- [ ] Cnn` / Tn rows are leaves with stable ids (n_spec_C51), folded BEFORE any tape row;
//              a hand edit to a row is a revision of its basin, never a second leaf; tape chunks of any type may attach into a basin
//     --retract T11: mark every node/revision from a row retracted (hashes untouched); excluded from rail, seed, bundle
//     --seed    T7: the nearest leaves by memoized NCD with the margin; abstains under m_attach or beyond τ_attach
//     --history the last N insertions from the roots ledger: who ran it (VNA_BY), what it added
//
// MASS ON THE NODE (operator 2026-09-17: "versioned json insertions of tesseract snipped gzip sensor l1
// cache … headers of the spec … with char counts, and semantic mass of the snippets"). Every node carries
// `mass: {chars, gzip, ratio, snippets}` — gzip is the canonical sensor (gzipSync level 9, the same bytes
// eighty-twenty.mjs and the NCD above measure; no SimHash), snippets = the raw pastes that fed the node
// (revisions + echoes); a parent sums its own text and its children. Mass sits OUTSIDE the hash, like the
// pixel, so a no-op re-run stays byte-identical. `lanes` is the same mass summed per horizon (A/B/C) and
// per row lane, written HERE so the page paints it and computes nothing. The hat + rules reading lives
// on `reef` (it was `mass` for one commit; the persisted tree migrates on load).
//
// VERSIONED INSERTIONS: every run that adds or revises appends {at, root, rows, nodesAdded[],
// revisionsAdded[], by} to data/vna/spec-tree-roots.ndjson — `by` is VNA_BY (the IDE button sets
// ide:pasteToTree, a section refresh ide:refresh, the CLI is cli) — the "who ran it" the tree JSON
// itself must not carry. A no-op run appends nothing.
//     --proof   prints the Merkle inclusion path (sibling hashes root-ward) and the node's timeline
//     --bundle  C41: the retrograde envelope for one leaf — leaf → parents → root, siblings only over a
//               declared interface edge, hat + rules at its coordinate, raw mass, merkle_path — capped
//
// HAT + RULES AT A COORDINATE come from the lens router's OWN engine (scripts/pmu/mass-collision.mjs,
// injectionPayload with the coordinate → the {rule, hat, code} refs the live lens would inject there) and
// the same two data files prompt-lens.mjs resolves them with (lens-reef.json for rule text + name,
// snippet-library-144.json for the pile's hat name; the rule resolution is copied from its unexported
// renderMassInjection with attribution). Nothing here re-derives a hat or a rule; a coordinate the index
// serves no rules at says `none indexed`, and a leaf with no pixel says `hat: unmeasured`.
//
// @guard tests/vna/spec-tree.test.mjs
// @guard tests/vna/c165c-the-blob-store-is-append-only.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, openSync, readSync, writeSync, closeSync, fstatSync, fsyncSync, statSync } from 'node:fs';
import { tesseractState, atomicWrite, acquireLock, releaseLock, LOCK as STATE_LOCK, STATE as STATE_PATH } from './tesseract-state.mjs';
import { claimFoldLock, releaseFoldLock, foldLockFor, watermarkPath, watermarkJson } from './fold-writer.mjs';   // C170a leg 1: one writer + the watermark sidecar
export { foldLockFor };
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';
import { cellTiebreak } from './tesseract-projection.mjs';   // C64: the route inside a shared cell is the walk's lit-cell vector
import { fullName } from './mesh.mjs';
import { scanLines } from './ndjson-tail.mjs';   // C165b: a whole-file question, answered at flat memory
import { rowPaths, coveredBy } from '../../src/lib/pmu/declared-reading.mjs';   // C92c: the ONE `paths:` parser and the one cover — never a second regex here
import { derivedWhy } from './derived-source.mjs';   // C174: the fold refuses a tree's own outline as its source
export { coveredBy };   // C92c: `coveredBy(changedPaths, rows)` → { byRow: Map<label, paths[]>, uncovered: paths[] } over specRows' output

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
export const POINTER = process.env.VNA_STEER_FILE || resolve(REPO, '.thetacog/vna-steer-file.json');
export const LEDGER = process.env.VNA_AMEND_LEDGER || resolve(REPO, 'docs/specs/vna/amendments.ndjson');
export const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
// C120a — a tree replaced by a pointer move is RETAINED at spec-tree.<sha8 of its source>.json beside the canonical path (never freed)
export const RETAIN_FLOOR = 20;   // nodes; below it the tree is a stub and nothing is lost by replacing it
export const retainedTreePath = (source, treePath = TREE) => resolve(dirname(treePath), `spec-tree.${createHash('sha256').update(String(source)).digest('hex').slice(0, 8)}.json`);
// ── C165 THE BLOB SIDECAR — THE RETAINED PASTE LIVES AT A SIBLING ADDRESS ──────────────────────
// MEASURED 2026-09-22, on the live tree: 254.1 MB of its 303.9 MB was `revisions[].text` — 8,447
// retained pastes over 682 nodes, averaging 30 KB each. The file had gone 3.1 MB → 9.4 → 18 → 304
// in three days. Every steer-hook --emit JSON.parsed the whole thing ONCE PER PROMPT: a 3.3 GB node
// heap, respawning, on a 24 GB machine. The machine was reading 86 MB/s back off swap continuously
// (5,402 swapins/s), load 21 on 10 cores, 14 MB of free RAM. That was the slowness.
//
// NOTHING IS FREED (AXIOM 1 — evict OR retain, never free). The text is RETAINED, content-addressed
// by the sha of its own bytes, at <tree>.blobs.json beside the tree; the revision keeps `tsha` to
// recover it and `excerpt` for the readers that only ever printed a 120–200 char head. The hot file
// keeps hash · chars · gzip, which is what the per-prompt path actually reads.
//
// A DETACHED REVISION HAS NO `text` — deliberately, so a reader that forgot to hydrate throws or
// prints nothing, rather than QUIETLY MEASURING A 400-CHAR EXCERPT AND CALLING IT THE PASTE. A
// truncated corpus fed to the NCD sensor would be the proxy-is-not-the-thing failure, silently.
export const EXCERPT_CHARS = 400;   // ≥ every consumer's own slice (bundle 200 · lineage 120 · directions 140)
// ── C165c THE STORE IS APPEND-ONLY — ONE ROW PER PASTE, AND AN OFFSET INDEX IS ALL A FOLD READS WHOLE ──
// MEASURED 2026-09-23: 1,770 folds in 24 h, and every one JSON.parsed the 317 MB <tree>.blobs.json,
// re-attached all 20,697 revision texts, JSON.stringified the whole store again and compared the two
// 317 MB strings — a 3.6 GB peak per fold, to append a handful of pastes. The store is now
//   <tree>.blobs.ndjson        one {"sha","text"} row per paste, APPENDED for a sha not yet held, never
//                              rewritten (AXIOM 1: retain; a sha is written once, its bytes never move);
//   <tree>.blobs.index.json    {sha: [offset, length]} — byte offset and byte length of the row's JSON,
//                              newline excluded. ~40 bytes a sha; the only thing a fold reads whole.
// The legacy one-object <tree>.blobs.json is read by ONE door only — migrateBlobs (--migrate-blobs, or
// the first writeTree that finds it with no index) — and is left in place; deleting it is the operator's call.
//
// CRASH RECOVERY. writeTree appends the rows (fsync) BEFORE it writes the index (tmp→rename) and the
// index before the tree, so a tsha on disk always has bytes behind it. A crash between the append and the
// index write leaves rows past the index's end: every load compares the store's size with the index's end
// (max offset+length+1) and re-indexes the tail it finds (a row is admitted only when its text hashes to
// its sha). A crash MID-append leaves a torn last line with no newline; it is never indexed, and the next
// append first writes one '\n' so the torn bytes stay a line of their own — nothing before them moves.
// A store SHORTER than its index is a rewritten store, and the load refuses rather than serve wrong bytes.
//
// READS. readTree(text:true) attaches by SEEKING the index (one pread per sha); when more than half of the
// held shas are wanted it streams the file once instead, byte-level, decoding only the rows it wants —
// never one 317 MB string, and never a UTF-8 sequence cut at a chunk edge (each row is decoded whole).
export const blobsPath = (treePath = TREE) => treePath.replace(/\.json$/, '.blobs.json');   // LEGACY (C165) — migrateBlobs is its only reader
export const blobStorePath = (treePath = TREE) => treePath.replace(/\.json$/, '.blobs.ndjson');
export const blobIndexPath = (treePath = TREE) => treePath.replace(/\.json$/, '.blobs.index.json');
const textSha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16);
export { textSha };
// `blobs` is the sink the detached texts go into ({sha: text}); only THIS call's texts land there.
export function detachRevisionText(tree, blobs = {}) {
  let moved = 0, bytes = 0;
  for (const n of Object.values(tree.nodes || {})) for (const r of (n.revisions || [])) {
    if (typeof r.text !== 'string') continue;
    if (r.chars == null) r.chars = r.text.length;
    if (r.gzip == null) r.gzip = gz(r.text);
    const k = textSha(r.text); blobs[k] = r.text; r.tsha = k;
    r.excerpt = r.text.length > EXCERPT_CHARS ? r.text.slice(0, EXCERPT_CHARS) : r.text;
    bytes += r.text.length; delete r.text; moved++;
  }
  return { blobs, moved, bytes };
}
// `blobs` is a {sha: text} object or a Map
export function attachRevisionText(tree, blobs) {
  if (!blobs) return 0;
  const get = blobs instanceof Map ? (k) => blobs.get(k) : (k) => blobs[k];
  let back = 0;
  for (const n of Object.values(tree.nodes || {})) for (const r of (n.revisions || []))
    if (r.tsha && typeof r.text !== 'string') { const t = get(r.tsha); if (t != null) { r.text = t; back++; } }
  return back;
}
// Stream a file from byte `from`, line by line, as BYTES: onLine(offset, length, materialise) where
// materialise() returns the line's Buffer only when the caller wants it. Returns { end, torn }: the byte
// after the last newline, and how many bytes follow it (a torn last line).
function streamLines(path, from, onLine, chunk = 4 << 20) {
  let fd = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    let pos = from, lineStart = from, parts = [], partsLen = 0;
    while (pos < size) {
      const buf = Buffer.allocUnsafe(Math.min(chunk, size - pos));
      const got = readSync(fd, buf, 0, buf.length, pos); if (got <= 0) break;
      const b = got === buf.length ? buf : buf.subarray(0, got);
      let s = 0;
      for (let i = b.indexOf(10, s); i !== -1; i = b.indexOf(10, s)) {
        const piece = b.subarray(s, i), held = parts, heldLen = partsLen;
        const len = heldLen + piece.length;
        if (len > 0) onLine(lineStart, len, () => (held.length ? Buffer.concat([...held, piece], len) : piece));
        parts = []; partsLen = 0; s = i + 1; lineStart = pos + s;
      }
      if (s < b.length) { const rest = b.subarray(s); parts.push(rest); partsLen += rest.length; }
      pos += b.length;
    }
    return { end: lineStart, torn: partsLen };
  } finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
}
const indexEnd = (index) => { let e = 0; for (const k in index) { const [o, l] = index[k]; if (o + l + 1 > e) e = o + l + 1; } return e; };
// The index, recovered against the store's tail (see CRASH RECOVERY). Never writes; writeTree persists.
export function loadBlobIndex(treePath = TREE) {
  const bp = blobStorePath(treePath), ip = blobIndexPath(treePath);
  let index = {}; try { index = JSON.parse(readFileSync(ip, 'utf8')) || {}; } catch {}
  const size = existsSync(bp) ? statSync(bp).size : 0;
  const end = indexEnd(index);
  if (size + 1 < end) throw new Error(`blob store ${bp} is ${size} bytes but its index reaches ${end - 1} — the store was rewritten or truncated (C165c: append-only); refusing to serve bytes from it`);
  let recovered = 0, torn = 0;
  if (size > end) {
    const r = streamLines(bp, end, (off, len, get) => {
      try { const row = JSON.parse(get().toString('utf8')); if (row && typeof row.sha === 'string' && typeof row.text === 'string' && !index[row.sha] && textSha(row.text) === row.sha) { index[row.sha] = [off, len]; recovered++; } } catch {}   // a torn or foreign line is never indexed
    });
    torn = r.torn;
  }
  return { index, size, recovered, torn, exists: existsSync(ip) };
}
const indexJson = (index) => JSON.stringify(index) + '\n';
// Append the rows for [sha, text] entries not yet held; extends `idx.index` in place. Caller holds the lock.
function appendBlobs(treePath, idx, entries) {
  const bp = blobStorePath(treePath); mkdirSync(dirname(bp), { recursive: true });
  const fd = openSync(bp, 'a'); let rows = 0, bytes = 0;
  try {
    let pos = fstatSync(fd).size;
    if (idx.torn) { writeSync(fd, '\n'); pos += 1; idx.torn = 0; }   // the torn line stays its own line; nothing before it moves
    for (const [sha, text] of entries) {
      if (idx.index[sha]) continue;
      const row = Buffer.from(JSON.stringify({ sha, text }), 'utf8');
      writeSync(fd, Buffer.concat([row, Buffer.from('\n')]));
      idx.index[sha] = [pos, row.length]; pos += row.length + 1; rows++; bytes += row.length + 1;
    }
    fsyncSync(fd);   // the rows are durable before the index that points at them
  } finally { closeSync(fd); }
  idx.size += bytes;
  return { rows, bytes };
}
// {sha → text} for the wanted shas: a pread per sha, or one byte-level pass when most of the store is wanted.
// Legacy fallback: a tree whose store has never been migrated (no index, no ndjson) reads the old one-object file.
export function readBlobs(treePath = TREE, shas = []) {
  const out = new Map(); const want = [...new Set(shas)]; if (!want.length) return out;
  const bp = blobStorePath(treePath);
  if (!existsSync(bp) && !existsSync(blobIndexPath(treePath))) {
    let legacy = null; try { legacy = JSON.parse(readFileSync(blobsPath(treePath), 'utf8')); } catch {}
    if (legacy) for (const k of want) if (legacy[k] != null) out.set(k, legacy[k]);
    return out;
  }
  const { index } = loadBlobIndex(treePath);
  const held = want.filter((k) => index[k]);
  const decode = (buf) => { try { const r = JSON.parse(buf.toString('utf8')); return r && typeof r.text === 'string' ? r : null; } catch { return null; } };
  if (held.length * 2 > Object.keys(index).length) {
    const at = new Map(); for (const k of held) at.set(index[k][0], k);
    streamLines(bp, 0, (off, len, get) => { const k = at.get(off); if (k === undefined) return; const r = decode(get()); if (r && r.sha === k) out.set(k, r.text); });
  } else {
    const fd = openSync(bp, 'r');
    try { for (const k of held) { const [o, l] = index[k]; const buf = Buffer.allocUnsafe(l); readSync(fd, buf, 0, l, o); const r = decode(buf); if (r && r.sha === k) out.set(k, r.text); } }
    finally { closeSync(fd); }
  }
  return out;
}
const wantedShas = (tree) => { const s = []; for (const n of Object.values(tree.nodes || {})) for (const r of (n.revisions || [])) if (r.tsha && typeof r.text !== 'string') s.push(r.tsha); return s; };
// THE READ DOOR. text:true (the default) gives back exactly the tree every caller had before C165.
// Only a per-prompt path passes text:false, and it must then read `excerpt`, never `text`.
export function readTree(treePath = TREE, { text = true } = {}) {
  const tree = JSON.parse(readFileSync(treePath, 'utf8'));
  if (text) attachRevisionText(tree, readBlobs(treePath, wantedShas(tree)));
  return tree;
}
// The receipt ledger for a tree: the live tree's roots ledger, a fixture's own sibling (never the live one).
const rootsFor = (treePath) => (resolve(treePath) === resolve(TREE) ? ROOTS : treePath.replace(/\.json$/, '') + '-roots.ndjson');
// PARITY: every tsha the tree holds resolves through the index to bytes whose sha256 is that tsha and
// whose length is the revision's `chars`. One byte-level pass; each row is decoded, checked and dropped.
export function verifyBlobParity(treePath = TREE) {
  let tree = null; try { tree = JSON.parse(readFileSync(treePath, 'utf8')); } catch {}
  if (!tree) return { checked: 0, ok: 0, missing: 0, bad: 0, why: 'no tree' };
  const chars = new Map(); for (const n of Object.values(tree.nodes || {})) for (const r of (n.revisions || [])) if (r.tsha) chars.set(r.tsha, r.chars);
  const { index } = loadBlobIndex(treePath);
  const at = new Map(); let missing = 0; const bad = [];
  for (const k of chars.keys()) { if (index[k]) at.set(index[k][0], k); else missing++; }
  let ok = 0;
  if (at.size) streamLines(blobStorePath(treePath), 0, (off, len, get) => {
    const k = at.get(off); if (k === undefined) return;
    let r = null; try { r = JSON.parse(get().toString('utf8')); } catch {}
    if (r && r.sha === k && typeof r.text === 'string' && textSha(r.text) === k && (chars.get(k) == null || r.text.length === chars.get(k))) ok++; else bad.push(k);
  });
  // tree text inline (never detached) resolves to itself — the pass only counts detached revisions
  return { checked: chars.size, ok, missing, bad: bad.length, badShas: bad.slice(0, 5) };
}
// THE ONE MIGRATION — the only door that JSON.parses the legacy one-object store, once. Holds the fold
// lock (a fold never writes the store under it) and the state lock; appends every legacy sha the ndjson
// does not yet hold; writes the index; verifies parity; receipts {kind:'migrate-blobs'} on the roots
// ledger. Idempotent: a second run appends nothing and re-verifies. The legacy file is left in place.
export function migrateBlobs(treePath = TREE, { roots = rootsFor(treePath), lock = STATE_LOCK, by = process.env.VNA_BY || 'cli', foldWaitMs = 240000 } = {}) {
  const legacyPath = blobsPath(treePath), ip = blobIndexPath(treePath);
  const t0 = Date.now(); let shas = 0, appended = 0, bytes = 0;
  const fl = foldLockFor(treePath); const claim = claimFoldLock(fl, { waitMs: foldWaitMs, by: 'migrate-blobs' });
  if (!claim.ok) throw new Error(`migrate-blobs: ${claim.why}`);
  try {
    if (existsSync(legacyPath)) {
      acquireLock(lock);
      try {
        let legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) || {};   // the ONE whole parse of the legacy store, here only
        const idx = loadBlobIndex(treePath);
        const entries = Object.entries(legacy); shas = entries.length; legacy = null;
        const r = appendBlobs(treePath, idx, entries); appended = r.rows; bytes = r.bytes;
        atomicWrite(ip, indexJson(idx.index));
      } finally { releaseLock(lock); }
    }
  } finally { if (!claim.dispatched) releaseFoldLock(fl); }
  const parity = verifyBlobParity(treePath);
  const row = { at: new Date().toISOString(), kind: 'migrate-blobs', by, legacy: existsSync(legacyPath) ? `kept ${statSync(legacyPath).size} B` : 'absent', shas, appended, bytes,
    storeBytes: existsSync(blobStorePath(treePath)) ? statSync(blobStorePath(treePath)).size : 0, indexed: Object.keys(loadBlobIndex(treePath).index).length, parity, ms: Date.now() - t0 };
  try { mkdirSync(dirname(roots), { recursive: true }); appendFileSync(roots, JSON.stringify(row) + '\n'); } catch {}
  return row;
}

// C81a THE ONE DOOR — every write of the tree goes through here and carries the tesseract state with it (tesseract-state.mjs
// exports it; flight-tape commit rows sign its sha). Tree · outline · state land tmp→rename while .thetacog/spec-tree.lock is
// held, so a reader never finds a state from one fold beside a tree from the next. The state path follows the tree: the live
// tree writes the live state; any other tree path (a fixture) writes a sibling <tree>.tesseract-state.json — a scratch tree
// can never overwrite the tracked state. An unchanged tree still lands its state when the state on disk is not its own.
const LIVE_TREE = resolve(REPO, 'data/vna/spec-tree.json');
export function writeTree(tree, { treePath = TREE, statePath = null, lock = STATE_LOCK, scanned = null } = {}) {
  const sp = statePath || (resolve(treePath) === LIVE_TREE ? STATE_PATH : treePath.replace(/\.json$/, '.tesseract-state.json'));
  const txt = outline(tree);   // C165: computed while the tree still carries its text
  const { state, sha } = tesseractState(tree); const sjson = JSON.stringify({ tesseract_sha: sha, ...state }, null, 1) + '\n';
  const read = (q) => { try { return readFileSync(q, 'utf8'); } catch { return null; } };
  // C165c: a file whose byte length differs from the new text is different without reading it — the fold that adds a paste
  // never holds the old tree beside the new one (the size check is one stat; equal sizes fall through to the byte compare)
  const same = (q, s) => { let sz = -1; try { sz = statSync(q).size; } catch { return false; } return sz === Buffer.byteLength(s, 'utf8') && read(q) === s; };
  // C165c — a legacy one-object store with no index is migrated ONCE, before anything is appended beside it
  // (otherwise the new store would hold only this fold's pastes and every older tsha would read as missing).
  if (!existsSync(blobIndexPath(treePath)) && !existsSync(blobStorePath(treePath)) && existsSync(blobsPath(treePath))) migrateBlobs(treePath, { lock, by: 'writeTree:auto' });
  // C165c — only THIS call's texts are detached; the store is consulted through its index, never parsed.
  const det = detachRevisionText(tree, {});
  const json = JSON.stringify(tree, null, 1) + '\n';
  // C170a leg 1: the watermark sidecar — the hook and the gauge read THIS (a few hundred bytes), never the tree
  const wp = watermarkPath(treePath), wjson = watermarkJson(tree, scanned);
  let idx = loadBlobIndex(treePath);
  const fresh = () => Object.keys(det.blobs).filter((k) => !idx.index[k]);
  const sameBlobs = fresh().length === 0 && idx.recovered === 0 && (idx.exists || !Object.keys(idx.index).length);
  const sameTree = same(treePath, json), sameTxt = same(treePath.replace(/\.json$/, '.txt'), txt), sameState = same(sp, sjson), sameWm = same(wp, wjson);
  const restore = () => attachRevisionText(tree, det.blobs);   // C165: the caller's tree goes back as it came
  if (sameTree && sameTxt && sameState && sameBlobs && sameWm) { restore(); return { tree: treePath, state: sp, sha, same: true, written: [] }; }
  const took = acquireLock(lock); const written = []; let app = { rows: 0, bytes: 0 };
  try {
    if (!sameBlobs) {   // blobs FIRST — the rows (fsync), then the index, then the tree: never a tsha with no bytes behind it
      idx = loadBlobIndex(treePath);   // re-read under the lock: another writer may have appended since
      app = appendBlobs(treePath, idx, fresh().map((k) => [k, det.blobs[k]]));
      atomicWrite(blobIndexPath(treePath), indexJson(idx.index)); written.push('blobs');
    }
    if (!sameTree) { atomicWrite(treePath, json); written.push('tree'); }
    if (!sameTxt) { atomicWrite(treePath.replace(/\.json$/, '.txt'), txt); written.push('outline'); }
    if (!sameState) { atomicWrite(sp, sjson); written.push('state'); }
    if (!sameWm) { atomicWrite(wp, wjson); written.push('watermark'); }   // AFTER the tree — the sidecar never claims rows the tree does not hold
  } finally { releaseLock(lock); restore(); }
  return { tree: treePath, state: sp, sha, same: false, written, blobs: { moved: det.moved, bytes: det.bytes, appended: app.rows, appendedBytes: app.bytes }, lockWait: took.waited, tookOver: took.over };
}
export const ROOTS = process.env.VNA_SPEC_TREE_ROOTS || resolve(REPO, 'data/vna/spec-tree-roots.ndjson');
// C52a: the spec whose declared rows are the tree's BASINS. Unset in a scratch tree (VNA_SPEC_BASINS=""), the
// live default otherwise; a test sets it to its own fixture. "" (set but empty) means no basins.
export const SPEC_BASINS = process.env.VNA_SPEC_BASINS !== undefined ? (process.env.VNA_SPEC_BASINS || null) : resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
// C52f: the basins rendered as the ONE door's targets library (snippet-library shape) — written after every fold; the
// seed and the slot stage walk the prompt/chunk against THIS with pmu-onchip --lens --targets, so the Rust lens places
// onto the spec's own rows. Node's gzip survives only as the within-cell tiebreak when several basins share a cell.
export const SPEC_TARGETS = process.env.VNA_SPEC_TARGETS || resolve(REPO, 'data/vna/spec-targets.json');
export function renderTargets(tree) {
  const basins = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted && n.pixel && blkOf(n.pixel));
  return basins.map((n) => { const [row, col] = n.pixel.split(','); const live = (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted);
    // C165: the targets library is the sensor's corpus. A detached revision would join as the string
    // "undefined" and the walk would place against bytes nobody pasted — UNMEASURED, not a fallback.
    const missing = live.filter((r) => typeof r.text !== 'string');
    if (missing.length) throw new Error(`renderTargets: ${missing.length} revision(s) on ${n.id} are detached — read the tree with readTree(path, { text: true })`);
    const snips = live.map((r) => r.text).join('\n'); return { coord: n.pixel, row, col, snippet: n.content.text + (snips ? '\n' + snips : ''), hat: n.meta && n.meta.label, id: n.id }; });
}
export function targetsFor(treePath = TREE, out = SPEC_TARGETS) {
  // C165: the sensor reads the full paste, never the excerpt — renderTargets throws on a detached tree
  try { const t = readTree(treePath, { text: true }); const tg = renderTargets(t); if (!tg.length) return null; mkdirSync(dirname(out), { recursive: true }); const json = JSON.stringify(tg); if (!(existsSync(out) && readFileSync(out, 'utf8') === json)) writeFileSync(out, json); return out; } catch { return null; }
}
const TXT = TREE.replace(/\.json$/, '.txt');

// ── the sensor: gzip-NCD, copied verbatim from scripts/spec/eighty-twenty.mjs (that file parses argv
//    at module scope, so it is not importable without side effects). 0 = identical, →1 = unrelated.
export const sensorStats = { gz: 0 };   // counted, so a guard can prove the memo (no re-gzip per candidate)
const gz = (s) => { sensorStats.gz++; return gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length; };
export function ncd(a, b) {
  const [ca, cb] = [gz(a), gz(b)];
  const cab = gz(a + '\n' + b);
  const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca];
  return hi === 0 ? 0 : (cab - lo) / hi;
}

// THE REVISION THRESHOLD, with its argument. gzip-NCD of a paragraph against a light edit of itself
// (a word swapped, a sentence added) sits at 0.1–0.3; against a paraphrase of the same topic 0.3–0.5;
// against an unrelated paragraph of the same length 0.6+. 0.35 admits the re-paste-with-edits and
// refuses the sibling — it is the eighty-twenty.mjs NCD_SAME_COMMITMENT neighbourhood, chosen
// tighter because a false merge here archives a spec statement. The measured NCD is recorded on
// every revision so the threshold can be re-argued from the receipt.
export const NCD_REVISION = 0.35;
// Below this many chars gzip's fixed header (~20 B) dominates the compressed length and NCD is
// length noise, not distance (eighty-twenty.mjs: "NCD on a bare id would be length noise"). Short
// chunks are only ever merged by byte identity.
export const NCD_MIN_CHARS = 120;
// T5 THREE BANDS, ONE MARGIN (§24). For a snip S against same-type leaves L_i, d_i = NCD(S, L_i) with C(L_i)
// from the memo: d_min < τ_rev → REVISION of L_min (content moves); τ_rev ≤ d_min < τ_attach with
// d_second − d_min ≥ m_attach → S ATTACHED to L_min as a versioned snippet (mass and provenance grow, the
// content and the hash do not); the same band with the margin under m_attach → the UNPLACED DRAWER with
// its why — no guess; d_min ≥ τ_attach → a new leaf. The three numbers are NAMED SEEDS here and are moved
// only by the ratchet (T6, data/vna/spec-tree-floors.json) — never re-typed. 0.00928 is the walk's
// placement-margin floor, a different instrument; it is not a clustering knob.
export const TAU_ATTACH = 0.55, M_ATTACH = 0.05;
export const PREFILTER_SLACK = 0.05;   // the bound's tolerance for gzip's header and window effects on short texts
export const FLOORS = process.env.VNA_SPEC_TREE_FLOORS || resolve(REPO, 'data/vna/spec-tree-floors.json');
export function thresholds(path = FLOORS) {
  const seed = { tau_rev: NCD_REVISION, tau_attach: TAU_ATTACH, m_attach: M_ATTACH, from: 'seed' };
  try { const f = JSON.parse(readFileSync(path, 'utf8')); return { ...seed, ...(f.current || {}), from: f.current ? `floor since ${f.current.since || '?'}` : 'seed' }; } catch { return seed; }
}

export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
export const leafHash = (type, text) => sha256(`${type}\n${text}`);
export const parentHash = (own, childHashes) => sha256(`${own}\n${childHashes.join('\n')}`);

// ── TYPING BY CUE. Deterministic, first match wins, the cue recorded so the type is auditable.
// The structural cue (a question ends with ?) is read before the word cues: "Must the buffer always
// be zeroed?" is a question about an invariant, not an invariant.
const CUES = [
  ['invariant', /\b(must not|must|never|always|cannot)\b/i],
  ['boundary', /\b(limit|limits|bound|bounded|bounds|cap|capped|only|within)\b/i],
  ['interface', /\b(API|APIs|schema|JSON|endpoint|endpoints|command|commands|field|fields)\b/i],
  ['decision', /\b(we will|committed|decided|instead of)\b/i],
];
export function typeOf(text) {
  const t = String(text).trim();
  if (/\?\s*$/.test(t)) return { type: 'question', cue: '?' };
  for (const [type, re] of CUES) { const m = re.exec(t); if (m) return { type, cue: m[1] }; }
  return { type: 'intent', cue: null };
}

const HEADLINE_MAX = 80;
const headline = (text) => {
  // C107b: the headline is the first line that carries a letter or a digit — a fence line or a rule is never printed as one (P684.5 printed empty, P564.2 printed a rule)
  const ls = String(text).split('\n'); const first = ls.find((l) => /[\p{L}\p{N}]/u.test(l) && !/^\s*```/.test(l)) || ls.find((l) => l.trim()) || '';
  const bare = first.replace(/^#{1,6}\s+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
  return bare.length > HEADLINE_MAX ? bare.slice(0, HEADLINE_MAX - 1) + '…' : bare;
};

// ── CHUNKING. One row → blocks along the semantic boundaries: markdown headings (# … and a lone
// **bold** line), fenced code, list items (each item its own block, continuation lines kept), and
// blank-line paragraphs. Then the CONVERSATION TURN: a single short line with no terminal stop,
// followed by a long block, is the line that introduced what follows — it becomes a section (level
// 7, below every heading) so the answer hangs under the question rather than beside it.
const CLIP_RE = /^<!--\s*clip\s*·\s*(\S+)\s*·\s*([0-9a-f]{4,})\s*-->\s*$/;
const TURN_MAX_LINE = 90;
const TURN_MIN_ANSWER = 150;
export function chunk(text, base = 0) {
  const lines = String(text).split('\n');
  const blocks = [];
  let via = { via: 'typed', clipAt: null, clipSha: null };
  let pos = 0;           // byte offset of the current line start, relative to the row's own text
  let cur = null;        // the paragraph / list item being accumulated
  const flush = () => { if (cur && cur.text.trim()) blocks.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = pos; pos += Buffer.byteLength(line, 'utf8') + 1;
    const end = start + Buffer.byteLength(line, 'utf8');
    const clip = CLIP_RE.exec(line);
    if (clip) { flush(); via = { via: 'clip', clipAt: clip[1], clipSha: clip[2] }; continue; }
    if (/^\s*```/.test(line)) {                       // fenced code: one block, fence to fence
      flush();
      const b = { kind: 'code', level: null, text: line, from: start, to: end, ...via };
      for (i++; i < lines.length; i++) {
        const l = lines[i]; const s = pos; pos += Buffer.byteLength(l, 'utf8') + 1;
        b.text += '\n' + l; b.to = s + Buffer.byteLength(l, 'utf8');
        if (/^\s*```\s*$/.test(l)) break;
      }
      blocks.push(b); continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) { flush(); blocks.push({ kind: 'heading', level: h[1].length, text: line.trim(), from: start, to: end, ...via }); continue; }
    if (/^\*\*[^*\n]{1,120}\*\*\s*$/.test(line.trim())) { flush(); blocks.push({ kind: 'heading', level: 4, text: line.trim(), from: start, to: end, ...via }); continue; }
    if (!line.trim()) { flush(); continue; }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
    if (li) { flush(); cur = { kind: 'item', level: null, text: line, from: start, to: end, ...via }; continue; }
    if (cur && cur.kind === 'item' && /^\s+\S/.test(line)) { cur.text += '\n' + line; cur.to = end; continue; }
    if (cur && cur.kind === 'item') flush();
    if (!cur) cur = { kind: 'para', level: null, text: line, from: start, to: end, ...via };
    else { cur.text += '\n' + line; cur.to = end; }
  }
  flush();
  // the conversation turn
  for (let i = 0; i + 1 < blocks.length; i++) {
    const b = blocks[i], n = blocks[i + 1];
    if (b.kind === 'heading' || b.kind === 'code') continue;
    const t = b.text.trim();
    if (t.includes('\n') || t.length > TURN_MAX_LINE || /[.,;]$/.test(t)) continue;
    if (n.kind !== 'heading' && n.text.trim().length >= TURN_MIN_ANSWER) { b.kind = 'section'; b.level = 7; }
  }
  for (const b of blocks) { b.from += base; b.to += base; b.text = b.text.replace(/\s+$/, ''); }
  return blocks;
}

// ── MASS: the gzip sensor per node, summed up the tree; and the same mass per lane ────────────────
export const sensorForTest = () => ({ gzipSync: (t) => gzipSync(Buffer.from(String(t), 'utf8'), { level: 9 }) });
// C98i: a grade row ({kind:'grade'}) carries no text and no mass — it is a judgment on a direction, never a version or a snippet;
// every walk that reads a revision's text or bytes skips it (seen red: the first grades on the live tree broke the fold at r.text.length).
const isGrade = (r) => r && r.kind === 'grade';
const snippetsOf = (n) => (n.revisions || []).filter((r) => !isGrade(r)).length + ((n.meta && n.meta.echoes) || []).length;
// THE L1 CACHE IS THE MEMO (operator 2026-09-17): a node's own gzip is written ONCE — at creation, at
// revision — into mass.own and read from there by the NCD screen and by every parent sum. leafMass
// reuses the memo when the text is unchanged (an echo, a re-aggregation); the revision path deletes
// mass first so the new text is measured. provenance = Σ the snippets that fed the node (each revision
// carries its own chars/gzip from the day it was archived; an echo is the contract's own bytes again).
function leafMass(n, { reuseOwn = true } = {}) {
  const own = reuseOwn && n.mass && n.mass.own && n.mass.own.chars === n.content.text.length ? n.mass.own : { chars: n.content.text.length, gzip: gz(n.content.text) };
  const revs = (n.revisions || []).filter((r) => !isGrade(r)), echoes = (n.meta && n.meta.echoes) || [];   // a grade has no bytes to weigh (C98i)
  for (const r of revs) if (r.gzip == null && typeof r.text === 'string') { r.chars = r.text.length; r.gzip = gz(r.text); }   // an older tree pays once; C165: a detached revision already carries both
  const pc = revs.reduce((a, r) => a + r.chars, 0) + echoes.length * own.chars;
  const pg = revs.reduce((a, r) => a + r.gzip, 0) + echoes.length * own.gzip;
  n.mass = { chars: own.chars, gzip: own.gzip, ratio: own.chars ? +(own.gzip / own.chars).toFixed(3) : 0, snippets: revs.length + echoes.length, own, provenance: { chars: pc, gzip: pg, ratio: pc ? +(pg / pc).toFixed(3) : 0 } };
  return n.mass;
}
export function computeMass(tree) {
  const N = tree.nodes;
  const walk = (id) => {
    const n = N[id];
    if (n.id !== 'root' && !(n.mass && n.mass.own)) leafMass(n);
    if (n.id !== 'root' && !n.children.length) return n.mass;
    const own = n.id === 'root' ? { chars: 0, gzip: 0 } : n.mass.own;
    let chars = own.chars, gzipB = own.gzip, snippets = snippetsOf(n);
    for (const c of n.children) { const m = walk(c); chars += m.chars; gzipB += m.gzip; snippets += m.snippets; }
    n.mass = { ...(n.mass || {}), chars, gzip: gzipB, ratio: chars ? +(gzipB / chars).toFixed(3) : 0, snippets, own };
    return n.mass;
  };
  walk('root');
  return N.root.mass;
}
const CARDINALS = ['A', 'B', 'C'];
const ROW_LANES = ['A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2', 'B3', 'C', 'C1', 'C2', 'C3'];
const laneRow = (px) => String(px || '').split(',')[0];
export function laneReceipt(tree) {
  const leaves = Object.values(tree.nodes).filter((n) => n.id !== 'root' && !n.children.length && !n.retracted);
  const sum = (ls) => ({
    nodes: ls.length, inLane: ls.filter((n) => n.walk && n.walk.sensor === 'metal').length, unmeasured: ls.filter((n) => !(n.walk && n.walk.sensor === 'metal')).length,
    revisions: ls.filter((n) => (n.revisions || []).length).length,
    chars: ls.reduce((a, n) => a + (n.mass ? n.mass.chars : 0), 0), gzip: ls.reduce((a, n) => a + (n.mass ? n.mass.gzip : 0), 0), snippets: ls.reduce((a, n) => a + (n.mass ? n.mass.snippets : 0), 0),
  });
  // a BRANCH is a pixel (row × column) under its horizon, in ShortLex order; the reef domain beside it is
  // the one the coordinate reader returned for that pixel — exact only, a borrowed (~) name is omitted
  const ax = (a) => ROW_LANES.indexOf(a);
  const lanes = {};
  for (const c of CARDINALS) {
    const inC = leaves.filter((n) => n.pixel && laneRow(n.pixel)[0] === c);
    const pixels = [...new Set(inC.map((n) => n.pixel))].sort((a, b) => { const [ar, ac] = a.split(','), [br, bc] = b.split(','); return ax(ar) - ax(br) || ax(ac) - ax(bc); });
    const branches = {};
    for (const px of pixels) {
      const ls = inC.filter((n) => n.pixel === px);
      const dom = ls.map((n) => n.reef).find((r) => r && r.domain && !r.guessed);
      branches[px] = { ...sum(ls), pixel: px, row: px.split(',')[0], col: px.split(',')[1] || null, domain: dom ? dom.domain : null };
    }
    lanes[c] = { ...sum(inC), branches };
  }
  tree.lanes = lanes;
  tree.unplaced = sum(leaves.filter((n) => !n.pixel));
  return lanes;
}

// ── THE TREE ─────────────────────────────────────────────────────────────────────────────────────
const nodeId = (source, row, from) => `n_${sha256(`${source}|${row}|${from}`).slice(0, 10)}`;
export function emptyTree(source) {
  const own = sha256(`root\n${source}`);
  return {
    v: 1, source, at: null, root: null, rootSince: null, threshold: NCD_REVISION,
    watermark: -1, ingested: [], open: ['root'], unplacedSnips: [],
    counts: { nodes: 0, leaves: 0, revisions: 0, placed: 0, unmeasured: 0 },
    nodes: { root: { id: 'root', hash: null, own, type: 'root', cue: null, level: 0, parent: null, children: [], content: { text: source, headline: source }, meta: null, pixel: null } },
  };
}

// only the touched leaf and its ancestors are re-hashed; every other hash is untouched bytes
export function rehash(tree, dirtyIds) {
  const changed = new Set();
  const N = tree.nodes;
  // root-ward from each dirty node, every level recomputed over its children's CURRENT hashes; no
  // early exit, because a freshly added leaf already carries its own hash while its parent does not
  const up = (id) => {
    for (let n = N[id]; n; n = n.parent ? N[n.parent] : null) {
      const h = n.children.length ? parentHash(n.own, n.children.map((c) => N[c].hash)) : n.own;
      if (n.hash !== h) { n.hash = h; changed.add(n.id); }
    }
  };
  for (const id of dirtyIds) { const n = N[id]; if (!n) continue; n.own = n.type === 'root' ? sha256(`root\n${tree.source}`) : leafHash(n.type, n.content.text); up(id); }
  tree.root = N.root.hash;
  return changed;
}

// C226a/b: the stamp carries aperture_id beside axes_sha, so a read/write distance can be checked for one instrument (iso-config.mjs)
export function walkPixel(text, ref, walk, { targets = null } = {}) {
  if (!walk) return { pixel: null, sigma: null, sensor: 'not-walked', admissible: false, ms: null };
  try {
    // C226d: session null — the row is placed as the ROW. Measured 2026-09-24 on the live tape: 10,964 of 31,770 spec-tree walks (35 %) had
    // the folding session's prior prompts threaded onto the row text (intentSpan.thread, up to 12 prompts), so a pixel depended on who folded.
    const w = lensWalk(text, { source: 'spec-tree', ref, digest: text.length > 800 ? 'strided' : 'head', timeoutMs: 800, session: null, room: process.env.THETACOG_ROOM || null, ...(targets ? { axesPath: targets } : {}) });
    const r = w.row || {};
    const best = (r.attempts || []).reduce((a, b) => (!a || (b.z ?? -1) > (a.z ?? -1) ? b : a), null);
    return { pixel: r.pixel ?? null, sigma: r.sigma ?? null, sensor: r.sensor ?? 'unmeasured', admissible: !!r.admissible, ms: r.ms ?? null, gain: best ? best.gain ?? null : null, z: best ? best.z ?? null : null, z_required: r.ratchet ? r.ratchet.z_required ?? null : null, cells: Array.isArray(r.cells) ? r.cells : null, trajectory: Array.isArray(r.trajectory) ? r.trajectory : null, axes_sha: r.axes_sha ?? null, aperture_id: r.aperture_id ?? null };   // C63/C64: the lit cells + trajectory are the state the pixel projects from (arrays of pixels, as the tape row carries them)
  } catch (e) { return { pixel: null, sigma: null, sensor: 'unmeasured', admissible: false, ms: null, err: String(e.message || e).slice(0, 80) }; }
}

// Ingest the ledger rows for the tree's source that are past the watermark and not yet ingested by
// rowSha. Returns { tree, added, revised, skipped, echoed }.
const SL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const blkOf = (p) => { const [r, c] = String(p || '').split(','); const i = SL.indexOf(r), j = SL.indexOf(c); return i < 0 || j < 0 ? null : [i, j]; };
const chebOf = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// C62 THE TIEBREAKER IS A DECIDABLE FACT, NEVER A KEYWORD PROXY (2026-09-18): when several basins share a cell and the
// compressor's margin is a tie, the chunk goes to the ONE candidate whose row label (C52b, T11) the chunk's own text names
// — a chunk that says C52b is about C52b, decidably. No label named, or several named → still a tie, still unplaced, said.
// Keyword intersection with the contract was proposed and refused: a token standing in for the construct (CLASS 2).
// C64: what rides on a snippet the lit cells routed — the pick, its overlap, the runner-up, and the null that admitted it
const cellsReceipt = (ct) => ({ label: ct.pick.meta && ct.pick.meta.label, overlap: ct.overlaps[0].overlap, second: ct.overlaps[1] ? { label: ct.overlaps[1].label, overlap: ct.overlaps[1].overlap } : null, K: ct.null.K, exceedance: ct.null.exceedance });
export function labelTiebreak(text, cands) {
  const named = cands.filter((c) => { const l = c.meta && c.meta.label; return l && new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m)}\\b`).test(String(text || '')); });
  return named.length === 1 ? named[0] : null;
}
export function ingest(tree, rows, { walk = true, threshold = null, th = thresholds(), pixelOf = null, reach = 1, corpus = undefined } = {}) {
  const provCorpus = corpus === undefined ? transcriptCorpus() : corpus;   // C107c: who wrote a clip chunk, read off the ledger's transcript rows
  // C52b second half: a tape chunk is walked FIRST; the basins within `reach` blocks of its pixel are the slot. The nearest
  // basin in the tightest non-empty ring that the compressor admits (d < τ_attach) takes the chunk as a snippet — before
  // any tape leaf is considered. No basin in reach, or none admitted → the T5 bands over every leaf, as before.
  const slotTargets = existsSync(SPEC_TARGETS) ? SPEC_TARGETS : null;   // C52f: the one door, against the spec's own rows
  const chunkPixel = (text, ref) => (pixelOf ? pixelOf(text, ref) : walkPixel(text, ref, walk, { targets: slotTargets }));
  const tauRev = threshold ?? th.tau_rev, tauAttach = th.tau_attach, mAttach = th.m_attach;
  const N = tree.nodes;
  const seen = new Set(tree.ingested);
  const dirty = new Set();
  let added = 0, revised = 0, skipped = 0, echoed = 0, attached = 0, abstained = 0, released = 0, byLabelCount = 0, byCellsCount = 0, echoTyped = 0, junkTyped = 0, assistantTyped = 0;
  const addedIds = [], revisedIds = [], attachedIds = [];
  tree.unplacedSnips ||= [];
  const leaves = () => Object.values(N).filter((n) => n.meta && n.type !== 'root');
  for (const r of rows) {
    const i = r._i;
    if (i <= tree.watermark || seen.has(r.sha256)) { skipped++; continue; }
    const at = r.at;
    for (const b of chunk(String(r.text || ''), r.offsetFrom || 0)) {
      const cS = b.text.length >= NCD_MIN_CHARS ? gz(b.text) : null;   // C(S): once per chunk
      const isSection = b.kind === 'heading' || b.kind === 'section';
      // C98k: a clip chunk that BEGINS with a receipt/hook marker is the instrument's own output clipped back in — typed echo,
      // slotted like any chunk (AXIOM 1), never released to PENDING
      const echoMarker = b.via === 'clip' && !isSection ? echoMarkerOf(b.text) : null;
      // C107b: a clip chunk that is a rule, a blank or RTF control words is typed junk — retained, placed, never released
      const junkClass = b.via === 'clip' && !isSection && !echoMarker ? junkClassOf(b.text) : null;
      // C107c: provenance on every clip chunk — an assistant chunk (by record or by stem) is the chair's reflection, typed echo
      const prov = b.via === 'clip' ? provenanceOf(b.text, provCorpus) : null;
      const assistantCue = prov && prov.who === 'assistant' && !isSection && !echoMarker && !junkClass ? `assistant:${prov.via}` : null;
      const { type, cue } = echoMarker ? { type: 'echo', cue: echoMarker } : junkClass ? { type: 'junk', cue: junkClass } : assistantCue ? { type: 'echo', cue: assistantCue } : isSection ? { type: 'section', cue: b.kind === 'heading' ? '#' : 'turn' } : typeOf(b.text);
      if (echoMarker || assistantCue) echoTyped++; if (junkClass) junkTyped++; if (assistantCue) assistantTyped++;
      const hash = leafHash(type, b.text);
      // C72: a transcript row's speaker rides on every leaf it folds into — via 'transcript' outranks the chunk's typed/clip reading
      const meta = { source: tree.source, row: i, rowSha: r.sha256, offsetFrom: b.from, offsetTo: b.to, at, via: r.via === 'transcript' ? 'transcript' : b.via, clipAt: b.clipAt, clipSha: b.clipSha, ...(prov ? { prov } : {}), ...(r.via === 'transcript' ? { who: r.who, session: r.session || null, queued: !!r.queued } : {}) };
      // byte-identical to an existing node of the same type → the same statement, said twice: no node, no revision
      const same = leaves().find((n) => n.type === type && n.hash === hash);
      if (same) { (same.meta.echoes ||= []).push({ at, rowSha: r.sha256, row: i, via: b.via }); leafMass(same); echoed++; continue; }
      if (isSection) {
        // pop the open path to the level above this section, then hang it there
        while (tree.open.length > 1 && N[tree.open[tree.open.length - 1]].level >= b.level) tree.open.pop();
        const parent = tree.open[tree.open.length - 1];
        const id = nodeId(tree.source, i, b.from);
        N[id] = { id, hash, own: hash, type, cue, level: b.level, parent, children: [], content: { text: b.text, headline: headline(b.text) }, meta, at, decidedAt: at, supersedes: null, revisions: [], pixel: null };
        leafMass(N[id]);
        N[parent].children.push(id); tree.open.push(id); dirty.add(id); added++; addedIds.push(id);
        continue;
      }
      // C52b: the slot first — walk the chunk, look for basins around its pixel
      let slotPx = null;
      if (b.text.length >= NCD_MIN_CHARS) {
        const px0 = chunkPixel(b.text, `spec:chunk:${i}:${b.from}`); slotPx = px0;
        const pb = blkOf(px0 && px0.pixel);
        if (pb) {
          let slotted = false;
          for (let ring = 0; ring <= reach && !slotted; ring++) {
            const inRing = Object.values(N).filter((n) => n.basin && !n.retracted && !n.children.length && n.content.text.length >= NCD_MIN_CHARS && blkOf(n.pixel) && chebOf(blkOf(n.pixel), pb) === ring);
            if (!inRing.length) continue;
            const ranked = inRing.map((n) => { const cN = n.mass && n.mass.own ? n.mass.own.gzip : leafMass(n).own.gzip; const cSN = gz(n.content.text + '\n' + b.text); const [lo, hi] = cN < cS ? [cN, cS] : [cS, cN]; return [n, hi === 0 ? 0 : (cSN - lo) / hi]; }).sort((x, y) => x[1] - y[1]);
            const [bn, d] = ranked[0]; const d2 = ranked[1] ? ranked[1][1] : null;
            // C52f: walked against the basins themselves, the walk's admissibility IS the admission (ring 0 only); against the
            // 144-reef (no targets file yet) the compressor must admit, as before
            // C58 (2026-09-18): THE CHUNK IS RELEASED, NEVER REFUSED — the same release as C53b's seed. An unadmitted walk
            // against the targets keeps its pixel; the nearest basin in ring 0 then +1 takes the chunk as a snippet marked
            // released UNMEASURED with the walk's numbers on it — instead of the chunk becoming a loose tape leaf that no
            // seed can roll up (live before this: 58 of 434 admitted on the reslot, 50 of 67 basins holding no chunk).
            // The compressor's within-ring margin still decides between several basins; the leaf's text is retained in
            // full on the snippet (AXIOM 1). Not a placement claim: the row says UNMEASURED and the walk's gain · z.
            const admittedHere = slotTargets ? (ring === 0 && px0.admissible) : d < tauAttach;
            const releasedHere = !admittedHere && !!slotTargets && ring <= 1;
            if (!admittedHere && !releasedHere) continue;
            let byLabel = null, byCells = null;
            if (inRing.length > 1 && (d2 - d) < mAttach) {
              byLabel = labelTiebreak(b.text, inRing);   // several basins, no margin: the label decides (C62) …
              if (!byLabel) { const ct = cellTiebreak(px0.cells, inRing); if (!ct.pick) continue; byCells = ct; }   // … else the lit cells with their null (C64), or it is not this ring
            }
            const target = byLabel || (byCells && byCells.pick) || bn; const dT = target !== bn ? (ranked.find((x) => x[0] === target) || [null, d])[1] : d;
            target.revisions.push({ kind: 'snippet', type, ...(type === 'echo' || type === 'junk' ? { cue } : {}), decision: type === 'decision' || undefined, at, hash, text: b.text, meta: { ...meta, slot: { pixel: px0.pixel, ring, inSlot: inRing.length, ...(byLabel ? { byLabel: byLabel.meta.label } : {}), ...(byCells ? { byCells: cellsReceipt(byCells) } : {}), ...(releasedHere ? { released: 'UNMEASURED', walk: { gain: px0.gain ?? null, z: px0.z ?? null, z_required: px0.z_required ?? null, sensor: px0.sensor } } : {}) } }, released: releasedHere && type !== 'echo' && type !== 'junk' ? 'UNMEASURED' : undefined, ncd: +(+dT).toFixed(4), margin: d2 == null ? null : +(d2 - d).toFixed(4), chars: b.text.length, gzip: cS });
            target.revisions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
            leafMass(target); attached++; attachedIds.push(target.id); if (releasedHere && type !== 'echo' && type !== 'junk') released++; if (byLabel) byLabelCount++; if (byCells) byCellsCount++; slotted = true;
          }
          if (slotted) continue;
        }
      }
      // near-duplicate of an existing leaf of the same type → a timed revision on that node
      // the two nearest same-type leaves by NCD (memoized C(N_i)); the band is read off d_min and the margin
      let best = null, second = null;
      if (b.text.length >= NCD_MIN_CHARS) {
        for (const n of leaves()) {
          if ((n.type !== type && !n.basin) || n.children.length || n.retracted || n.content.text.length < NCD_MIN_CHARS) continue;   // C52a: a basin takes any type
          // THE MEMO: C(N_i) is the node's stored own gzip; only C(S·N_i) is measured per pair
          const cN = n.mass && n.mass.own ? n.mass.own.gzip : leafMass(n).own.gzip;
          const cSN = gz(n.content.text + '\n' + b.text);
          const [lo, hi] = cN < cS ? [cN, cS] : [cS, cN];
          const d = hi === 0 ? 0 : (cSN - lo) / hi;
          if (!best || d < best.d) { second = best; best = { n, d }; } else if (!second || d < second.d) second = { n, d };
        }
      }
      let band = !best ? 'new' : best.d < tauRev ? 'revision' : best.d < tauAttach ? ((second ? second.d - best.d : Infinity) >= mAttach ? 'attach' : 'abstain') : 'new';
      if (band === 'revision' && best.n.basin) band = 'attach';   // C52a: only the spec revises a basin; a near-identical paste is mass in it
      if (band === 'attach') {
        const n = best.n;
        n.revisions.push({ kind: 'snippet', type, ...(type === 'echo' || type === 'junk' ? { cue } : {}), decision: type === 'decision' || undefined, at, hash, text: b.text, meta, ncd: +best.d.toFixed(4), margin: second ? +(second.d - best.d).toFixed(4) : null, chars: b.text.length, gzip: cS });
        n.revisions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
        leafMass(n); attached++; attachedIds.push(n.id);
        continue;
      }
      if (band === 'abstain') {
        const margin = +(second.d - best.d).toFixed(4);
        tree.unplacedSnips.push({ at, rowSha: r.sha256, row: i, via: b.via, hash, text: b.text, chars: b.text.length, gzip: cS, type, cue, offsetFrom: b.from, offsetTo: b.to,
          why: `ambiguous — margin ${margin} under m_attach ${mAttach} between ${best.n.id} and ${second.n.id}`, candidates: [{ id: best.n.id, d: +best.d.toFixed(4) }, { id: second.n.id, d: +second.d.toFixed(4) }] });
        abstained++;
        continue;
      }
      if (band === 'revision') {
        const n = best.n;
        const ownNow = n.mass && n.mass.own ? n.mass.own : { chars: n.content.text.length, gzip: gz(n.content.text) };
        const snippets = n.revisions.filter((x) => x.kind === 'snippet'), grades = n.revisions.filter(isGrade);   // C98i: a grade is never a version — it must not become `latest`
        const versions = [...n.revisions.filter((x) => x.kind !== 'snippet' && !isGrade(x)), { at: n.decidedAt, hash: n.hash, text: n.content.text, meta: n.meta, ncd: n.ncd ?? null, chars: ownNow.chars, gzip: ownNow.gzip }, { at, hash, text: b.text, meta, ncd: +best.d.toFixed(4), chars: b.text.length, gzip: cS }]
          .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
        const latest = versions.pop();
        n.revisions = [...versions, ...snippets, ...grades].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
        n.content = { text: latest.text, headline: headline(latest.text) };
        delete n.mass; n.mass = { own: { chars: latest.chars, gzip: latest.gzip } }; leafMass(n);   // the memo moves with the content, no re-gzip
        n.meta = latest.meta; n.decidedAt = latest.at; n.ncd = latest.ncd; n.supersedes = versions.length ? versions[versions.length - 1].hash : null;   // versions: decisions only
        if (n.hash !== latest.hash) { const px = walkPixel(latest.text, `spec:${n.id}`, walk); n.pixel = px.pixel; n.walk = px; delete n.reef; }
        dirty.add(n.id); revised++; revisedIds.push(n.id);
        continue;
      }
      const parent = tree.open[tree.open.length - 1];
      const id = nodeId(tree.source, i, b.from);
      const px = slotPx || walkPixel(b.text, `spec:${id}`, walk);   // one walk per chunk
      N[id] = { id, hash, own: hash, type, cue, level: null, parent, children: [], content: { text: b.text, headline: headline(b.text) }, meta, at, decidedAt: at, supersedes: null, revisions: [], pixel: px.pixel, walk: px };
      N[id].mass = { own: { chars: b.text.length, gzip: cS ?? gz(b.text) } }; leafMass(N[id]);
      N[parent].children.push(id); dirty.add(id); added++; addedIds.push(id);
    }
    seen.add(r.sha256); tree.ingested.push(r.sha256);
    tree.watermark = Math.max(tree.watermark, i);
    tree.at = at;
  }
  const retyped = retypeEchoes(tree, { at: tree.at || new Date().toISOString() });   // C98k: the live tree's earlier echoes, re-typed once, idempotent
  const retypedJunk = retypeJunk(tree, { at: tree.at || new Date().toISOString() });   // C107b: earlier folds' released rules / RTF control words, re-typed once
  const retypedAssistant = retypeAssistant(tree, provCorpus, { at: tree.at || new Date().toISOString() });   // C107c: prov stamped once on every clip snippet; the chair's own replies re-typed echo
  const before = tree.root;
  if (dirty.size) rehash(tree, [...dirty, 'root']);
  if (tree.root !== before) tree.rootSince = tree.at;
  const all = Object.values(N).filter((n) => n.id !== 'root');
  tree.counts = {
    nodes: all.length, leaves: all.filter((n) => !n.children.length).length,
    revisions: all.reduce((a, n) => a + (n.revisions || []).length, 0),
    placed: all.filter((n) => n.pixel).length, unmeasured: all.filter((n) => !n.children.length && !n.pixel).length,
  };
  computeMass(tree); laneReceipt(tree);
  tree.counts.attached = (tree.counts.attached || 0) + attached; tree.counts.abstained = tree.unplacedSnips.length;
  tree.counts.basins = all.filter((n) => n.basin).length; tree.counts.inBasins = all.filter((n) => n.basin).reduce((a, n) => a + (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length, 0);
  tree.counts.released = all.filter((n) => n.basin).reduce((a, n) => a + (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted && r.released).length, 0);
  tree.counts.echoes = instrumentEchoes(tree).length;
  tree.counts.junk = all.filter((n) => n.basin).reduce((a, n) => a + (n.revisions || []).filter((r) => r.kind === 'snippet' && r.type === 'junk' && !r.retracted).length, 0);
  return { tree, added, revised, skipped, echoed, attached, abstained, released, byLabel: byLabelCount, byCells: byCellsCount, echoTyped, retyped, junkTyped, retypedJunk, assistantTyped, retypedAssistant: retypedAssistant.retyped, provStamped: retypedAssistant.stamped, addedIds, revisedIds, attachedIds };
}

// ── C52a THE BASINS (operator 2026-09-17: "spec should track a json tree with slotted chunks from the pastes"):
// every `- [ ] Cnn` / `- [x] Cnn` / `Tn` row of the spec is a leaf of type contract with a STABLE id from its
// label (n_spec_C51), under one section node n_spec; folded before any tape row so chunks can slot into a
// basin. A row whose text changed is a REVISION of its basin (supersedes · decidedAt), never a second leaf;
// the checkbox lives in meta.done (a tick is a decision, not new text). Pixel from the one Rust walk.
export const BASIN_RE = /^\s*- \[( |x)\] ((?:C\d+[a-z]?|T\d+))\b\s*(.*)$/;
export function specRows(md) {
  const out = [];
  // C92c: `paths` is the optional ` paths: \`glob\`, \`glob\`` list on the row (declared-reading's rowPaths — one parser); [] when the row declares none, and a row with no paths covers nothing
  for (const line of String(md || '').split('\n')) { const m = BASIN_RE.exec(line); if (m) out.push({ label: m[2], done: m[1] === 'x', paths: rowPaths(m[3]), text: `${m[2]} ${m[3]}`.replace(/\s+/g, ' ').trim() }); }
  return out;
}
export function basins(tree, md, { specPath = SPEC_BASINS, at = new Date().toISOString(), walk = true, walkPixelFn = null } = {}) {
  const wp = walkPixelFn ? (text, ref, w) => (w ? walkPixelFn(text, ref) : walkPixel(text, ref, false)) : walkPixel;   // a test hands in the walker; live it is the one Rust walk
  const walkedLate = [];
  const N = tree.nodes; const rows = specRows(md); const dirty = new Set();
  let added = 0, revised = 0, ticked = 0; const addedIds = [], revisedIds = [];
  if (!rows.length) return { added, revised, ticked, addedIds, revisedIds, rows: 0 };
  if (!N.n_spec) {
    const own = leafHash('section', `SPEC — the declared rows of ${specPath}`);
    N.n_spec = { id: 'n_spec', hash: own, own, type: 'section', cue: 'spec', level: 1, parent: 'root', children: [], content: { text: `SPEC — the declared rows of ${specPath}`, headline: 'SPEC — the declared rows (basins)' }, meta: { source: specPath, via: 'spec' }, at, decidedAt: at, supersedes: null, revisions: [], pixel: null, basin: false };
    N.root.children.unshift('n_spec'); dirty.add('n_spec');
  }
  for (const r of rows) {
    const id = `n_spec_${r.label}`; const hash = leafHash('contract', r.text);
    const meta = { source: specPath, via: 'spec', label: r.label, done: r.done, at };
    const n = N[id];
    if (!n) {
      const px = wp(r.text, `spec:${id}`, walk);
      N[id] = { id, hash, own: hash, type: 'contract', cue: r.label, level: null, parent: 'n_spec', children: [], content: { text: r.text, headline: headline(r.text) }, meta, at, decidedAt: at, supersedes: null, revisions: [], pixel: px.pixel, walk: px, basin: true };
      N[id].mass = { own: { chars: r.text.length, gzip: gz(r.text) } }; leafMass(N[id]);
      N.n_spec.children.push(id); dirty.add(id); added++; addedIds.push(id); continue;
    }
    if (n.hash !== hash) {
      // C109f: the previous text is archived as a version — origin 'hand' (the only writer of this row's
      // TEXT is a human editing SPEC-VNA-COCKPIT.md; a tick alone never reaches this branch, see above) and
      // a sha256 of the archived text itself, so a later reader can name which bytes it is looking at without
      // rehashing. The basin keeps its id, its snippets and its place — never a second leaf, never reverted.
      n.revisions.push({ kind: 'revision', origin: 'hand', sha: sha256(n.content.text), at: n.decidedAt, hash: n.hash, text: n.content.text, meta: n.meta, chars: n.content.text.length, gzip: n.mass && n.mass.own ? n.mass.own.gzip : gz(n.content.text) });
      n.revisions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
      n.supersedes = n.hash; n.content = { text: r.text, headline: headline(r.text) }; n.meta = meta; n.decidedAt = at;
      delete n.mass; n.mass = { own: { chars: r.text.length, gzip: gz(r.text) } }; leafMass(n);
      const px = wp(r.text, `spec:${id}`, walk); n.pixel = px.pixel; n.walk = px; delete n.reef;
      dirty.add(id); revised++; revisedIds.push(id); continue;
    }
    if (!!n.meta.done !== r.done) { n.meta.done = r.done; n.meta.doneAt = at; ticked++; }
    // THE LATE WALK (2026-09-18): a basin folded under --no-walk carried sensor 'not-walked' and no pixel until its text moved —
    // six freshly declared rows had no coordinate and goal-write could subdivide onto none of them. A walking fold walks every
    // basin that was never tried; one the walk REFUSED (a real attempt, sensor unmeasured) waits for its text to move.
    if (walk && !n.pixel && (!n.walk || n.walk.sensor === 'not-walked')) { const px = wp(r.text, `spec:${id}`, true); n.pixel = px.pixel; n.walk = px; delete n.reef; walkedLate.push(id); }
  }
  if (dirty.size) rehash(tree, [...dirty, 'root']);
  if (walkedLate.length) rehash(tree, [...walkedLate, "root"]);
  // C109f: recomputed at every fold, never typed — one top-level cell generated from the mass below it.
  tree.conclusion = computeConclusion(tree, at);
  return { added, revised, ticked, addedIds, revisedIds, walked: walkedLate, rows: rows.length, conclusion: tree.conclusion };
}

// ── C109f SPEC ↔ TREE, ONE DECIDABLE ROUND TRIP ────────────────────────────────────────────────────
// The steer sidebar's `📜 spec` door (steer-ui.mjs) tells the operator to hand-edit SPEC-VNA-COCKPIT.md
// and trust the fold to keep the change (C109 row, half-said today). Two things make that true instead
// of a hope: `specFromTree` proves the tree can reproduce the md it was folded from (so `diff` against
// the live file IS the hand's delta — nothing else could have produced it), and `basins()` above proves
// a text change lands as a NEW, ORIGIN-TAGGED revision rather than a silent overwrite. Neither writes
// SPEC-VNA-COCKPIT.md; both only read/derive from the tree the fold already built.
//
// specFromTree(tree): a PURE function of the tree's basin nodes — no wall clock, no random order. Sorted
// by row id (the same key() ordering basins already render in, C→T never first, numeric then a-suffix),
// so two runs over the same tree are byte-identical and a scrambled declaration order in the source md
// still comes back canonical. Each row is exactly `- [ ] C<n> <text>` / `- [x] C<n> <text>` — the same
// shape BASIN_RE parses back out, so specFromTree(tree) is itself a valid spec body.
export function specFromTree(tree) {
  const basinsAll = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted);
  const key = (l) => { const m = /^([CT])(\d+)([a-z]?)$/.exec(l || ''); return m ? [m[1] === 'C' ? 1 : 0, Number(m[2]), m[3] ? m[3].charCodeAt(0) : 0] : [-1, 0, 0]; };
  basinsAll.sort((a, b) => { const ka = key(a.meta.label), kb = key(b.meta.label); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
  return basinsAll.map((n) => `- [${n.meta.done ? 'x' : ' '}] ${n.content.text}`).join('\n') + (basinsAll.length ? '\n' : '');
}

// computeConclusion(tree, at): the top-level cell — basins' headlines weighted by their SLOTTED snippet
// mass (top 3, ties broken by label so the reading is decidable), the open/ticked counts, and the last
// HAND edit's row id and date (the most recently revised basin whose latest archived revision carries
// origin 'hand' — a tick alone never counts as an edit, matching the branch above that never touches
// revisions[] for a done-only change). GENERATED, never typed — there is no field anywhere this writes
// into by hand; it is recomputed by basins() on every fold from the tree it just built.
export function computeConclusion(tree, at = new Date().toISOString()) {
  const basinsAll = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted);
  const open = basinsAll.filter((n) => !n.meta.done).length;
  const ticked = basinsAll.filter((n) => n.meta.done).length;
  const massOf = (n) => (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length;
  const top = basinsAll.slice()
    .filter((n) => massOf(n) > 0)
    .sort((a, b) => massOf(b) - massOf(a) || String(a.meta.label).localeCompare(String(b.meta.label)))
    .slice(0, 3)
    .map((n) => ({ label: n.meta.label, headline: n.content.headline, mass: massOf(n) }));
  let lastHandEdit = null;
  for (const n of basinsAll) {
    const handRevs = (n.revisions || []).filter((r) => r.kind === 'revision' && r.origin === 'hand' && !r.retracted);
    if (!handRevs.length) continue;
    if (!lastHandEdit || n.decidedAt > lastHandEdit.at) lastHandEdit = { row: n.meta.label, at: n.decidedAt };
  }
  return { top, open, ticked, total: basinsAll.length, lastHandEdit, at };
}

// ── THE PROOF: sibling hashes root-ward. Each step carries the parent's own hash and the siblings on
// either side, so hashing up the path from the leaf reproduces the root with nothing else in hand.
export function proof(tree, id) {
  const N = tree.nodes; const n = N[id];
  if (!n) return null;
  const path = [];
  for (let c = n; c.parent; c = N[c.parent]) {
    const p = N[c.parent]; const k = p.children.indexOf(c.id);
    path.push({ parent: p.id, own: p.own, before: p.children.slice(0, k).map((s) => N[s].hash), after: p.children.slice(k + 1).map((s) => N[s].hash) });
  }
  const timeline = [...(n.revisions || []).filter((r) => r.kind !== 'snippet' && r.kind !== 'grade').map((r) => ({ at: r.at, hash: r.hash, ncd: r.ncd ?? null, archived: true })), { at: n.decidedAt, hash: n.hash, ncd: n.ncd ?? null, archived: false }];
  return { id, hash: n.hash, root: tree.root, path, timeline };
}
export function verifyProof(pr) {
  let h = pr.hash;
  for (const s of pr.path) h = parentHash(s.own, [...s.before, h, ...s.after]);
  return h;
}

// ── HAT + RULES AT A COORDINATE — read from the running router, never re-implemented ──────────────
let _engine = null, _reef = null, _pile = null;
async function engine() { if (!_engine) { const m = await import('../pmu/mass-collision.mjs'); _engine = m.loadCollisionEngine(); } return _engine; }
// copied from scripts/pmu/prompt-lens.mjs renderMassInjection (not exported): a rule ref 'reef:<domain>:<n>'
// resolves to the reef domain's rules[n] and its rule_names entry keyed by the text's first 60 chars
function reefRule(src) {
  if (!_reef) {
    _reef = new Map();
    try { for (const d of (JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')).domains || [])) if (d.coord && Array.isArray(d.rules)) _reef.set(String(d.domain), { rules: d.rules, names: d.rule_names || {} }); } catch {}
  }
  const m = /^reef:(.+):(\d+)$/.exec(String(src)); const dom = m && _reef.get(m[1]); const t = dom && dom.rules[+m[2]];
  const text = typeof t === 'string' ? t : (t && (t.rule || t.text));
  if (!text) return null;
  return { name: dom.names[String(text).slice(0, 60)] || null, text: String(text).slice(0, 240), domain: m[1], src };
}
export async function coordinateMass(pixel) {
  if (!pixel) return { hat: null, unmeasured: true, rules: [], rules_from: 'no pixel — the walk refused' };
  const { expandCoordName } = await import('../pmu/reef-coord-name.mjs');
  const x = expandCoordName(pixel);
  if (!_pile) { _pile = new Map(); try { for (const c of JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'))) if (c.hat) _pile.set(String(c.coord), String(c.hat)); } catch {} }
  const hat = _pile.get(pixel) || x.hat || null;
  const base = { hat, coordinate: pixel, canonical: x.canonical, domain: x.domain || null, guessed: !!x.guessed };
  let refs = [], placedBy = null;
  try { const pl = await (await engine()).injectionPayload('', { coord: pixel, maxRefs: 24 }); refs = pl.refs || []; placedBy = pl.placed_by; }
  catch (e) { return { ...base, rules: [], code_refs: 0, rules_from: `engine unavailable — ${String(e.message || e).slice(0, 60)}` }; }
  const rules = refs.filter((r) => r.kind === 'rule').map((r) => reefRule(r.src)).filter(Boolean);
  const code_refs = refs.filter((r) => r.kind === 'code').length;
  return { ...base, rules, code_refs, rules_from: rules.length ? `mass-index @ ${pixel} (${placedBy})` : `none indexed at ${pixel}${x.domain ? ` · nearest reef domain ${x.guessed ? '~' : ''}${x.domain}` : ''}` };
}
// every leaf without a reef reading (hat + rules) gets one; a leaf that has one is untouched (bytes hold on re-run)
export async function reefPass(tree, { reef = coordinateMass } = {}) {
  let n = 0;
  for (const node of Object.values(tree.nodes)) {
    if (node.id === 'root' || node.children.length || node.reef) continue;
    // a leaf with no pixel never reaches the reader: there is no coordinate to read a hat at
    node.reef = node.pixel ? await reef(node.pixel) : await coordinateMass(null); n++;
  }
  return n;
}

// ── C41 THE BUNDLE: the retrograde envelope for one leaf ─────────────────────────────────────────
// Walks leaf → parents → root (structure, never chat order). Siblings ride along ONLY over a declared
// interface edge: a sibling under the same parent whose type is 'interface' — the one type that names a
// boundary other nodes depend on. The cap is 1,500 tokens estimated at 4 chars/token; raw mass is
// dropped oldest-first to hold it and the envelope says how many went; the merkle_path is never cut.
export const BUNDLE_TOKEN_CAP = 1500, CHARS_PER_TOKEN = 4;
// C166d: a dispatch may carry its own cap (runner --cap / VNA_BUNDLE_CAP); the band is the hook's (500–16000), anything else is the constant
export const BUNDLE_CAP_MIN = 500, BUNDLE_CAP_MAX = 16000;
export const bundleCap = (c) => { const n = Number(c); return Number.isFinite(n) && n >= BUNDLE_CAP_MIN && n <= BUNDLE_CAP_MAX ? n : BUNDLE_TOKEN_CAP; };
// ── C59 THE DEFINITIONS LEG (2026-09-18, operator: "how do we know what those terms mean"). The envelope carried the contract,
// its parents, lineage and rules — never the DEFINITIONS of the terms the contract uses. For each backticked term and each
// row label the contract names: (a) the node where the term FIRST appears in the tree (by time, never the leaf itself),
// (b) whether a path-shaped term exists on disk, (c) the resolved rule for it from the rule corpus (rule-grab.mjs's grab():
// LLM-free, idf-overlap, ABSTAINS when no span shares a content word — an abstention is printed as '—', never filled).
// Computed at FOLD time on every basin whose hash changed (grab costs ~120 ms a term; the hook's door is 800 ms) and stored
// on the node as n.defs = { hash, at, terms }; the bundle reads it and computes nothing. Done-when: a cold reader can
// define the leaf's terms from the bundle alone — decidable as: every backticked term in the contract has a defs row.
export const DEFS_MAX_TERMS = 8, DEFS_SPAN_CHARS = 200;
const TERM_RE = /`([^`\n]{2,80})`/g, LABEL_REF_RE = /\b(C\d{1,3}[a-z]?|T\d{1,3})\b/g;
export function termsOf(text, ownLabel = null) {
  const out = []; const seen = new Set();
  for (const m of String(text || '').matchAll(TERM_RE)) { const t = m[1].trim(); if (!seen.has(t)) { seen.add(t); out.push({ term: t, kind: /[\/.]/.test(t) && !/\s/.test(t) ? 'path' : 'term' }); } }
  for (const m of String(text || '').matchAll(LABEL_REF_RE)) { const t = m[1]; if (t !== ownLabel && !seen.has(t)) { seen.add(t); out.push({ term: t, kind: 'label' }); } }
  return out.slice(0, DEFS_MAX_TERMS);
}
export function definitions(tree, id, { grabFn = null, corpus = null, repo = REPO, at = new Date().toISOString() } = {}) {
  const N = tree.nodes; const n = N[id]; if (!n) return null;
  const own = n.meta && n.meta.label || null;
  const terms = termsOf(n.content.text, own);
  const nodes = Object.values(N).filter((x) => x.id !== 'root' && x.id !== id && !x.retracted && x.content && x.content.text).sort((a, b) => String(a.at || '') < String(b.at || '') ? -1 : 1);
  const rows = terms.map(({ term, kind }) => {
    const row = { term, kind, first: null, exists: null, rule: null };
    if (kind === 'label') { const b = N[`n_spec_${term}`]; row.first = b ? { id: b.id, at: b.at, headline: String(b.content.headline || b.content.text).slice(0, 120), done: !!(b.meta && b.meta.done) } : null; return row; }
    const f = nodes.find((x) => x.content.text.includes(term)); if (f) row.first = { id: f.id, at: f.at, type: f.type, headline: String(f.content.headline || f.content.text).replace(/\s+/g, ' ').slice(0, 120) };
    if (kind === 'path') { try { row.exists = existsSync(resolve(repo, term)); } catch { row.exists = null; } }
    // only an identifier-shaped term is grabbed (parens, dashes, dots, slashes, capitals or a space; ≥ 5 chars): a bare
    // English word in backticks (`status`, `content`, `path`) matched CLAUDE.md lines that merely contain the word — not a rule
    if (grabFn && kind === 'term' && term.length >= 5 && /[A-Z_\-().\/]|\s/.test(term)) {
      // the span must CONTAIN the term (rule-grab's own verifier rule: a quote not in the source was written, not grabbed) — an
      // idf-overlap hit on a word the term shares ("ingest" → a guard line about leaf-walk) is not a definition
      try { const g = grabFn(term, { context: n.content.text, corpus, cap: 3 }); const h = g && g.lexicallySupported && (g.hits || []).find((x) => String(x.span).toLowerCase().includes(term.replace(/\(\)$/, '').toLowerCase())); row.rule = h ? { file: h.file, line: h.line, title: h.title || null, span: String(h.span).replace(/\s+/g, ' ').slice(0, DEFS_SPAN_CHARS), overlap: h.overlap || [] } : null; } catch { row.rule = null; }
    }
    return row;
  });
  return { hash: n.hash, at, terms: rows, covered: terms.length ? rows.filter((r) => r.first || r.exists != null || r.rule).length : 0, total: terms.length };
}
// the fold's pass: every basin whose contract changed since its defs were computed; the rule corpus loaded once
// F5 audit 2026-09-22: a definition's disk and row facts were frozen at the fold that computed them and only recomputed when the
// contract's hash changed — 10 of 922 path terms on the live tree read "NOT on disk" for files that existed (C57's own
// .thetacog/vna-active-leaf.json among them), and a label's [x]/[ ] kept the tick state of the day it was first read. These
// two facts are re-read on EVERY fold (a stat per path, a lookup per label — no corpus, no walk); the envelope stays a pure
// function of the tree, and a fact is at most one fold stale.
export function refreshDefs(tree, { repo = REPO } = {}) {
  const N = tree.nodes; let paths = 0, labels = 0;
  for (const n of Object.values(N)) {
    if (!n.basin || n.retracted || !n.defs || !Array.isArray(n.defs.terms)) continue;
    for (const t of n.defs.terms) {
      if (t.kind === 'path') { let e = null; try { e = existsSync(resolve(repo, t.term)); } catch {} if (t.exists !== e) { t.exists = e; paths++; } }
      else if (t.kind === 'label') { const b = N[`n_spec_${t.term}`]; const done = b ? !!(b.meta && b.meta.done) : null; if (b && t.first && t.first.done !== done) { t.first.done = done; labels++; } else if (!b && t.first) { t.first = null; labels++; } }
    }
  }
  return { paths, labels };
}
export async function defsPass(tree, { grab = undefined, repo = REPO } = {}) {
  const refreshed = refreshDefs(tree, { repo });
  const basinsAll = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted && (!n.defs || n.defs.hash !== n.hash));
  if (!basinsAll.length) return { computed: 0, refreshed };
  let grabFn = grab, corpus = null;
  if (grabFn === undefined) { try { const R = await import('../cog/rule-grab.mjs'); corpus = R.loadCorpus(); grabFn = R.grab; } catch { grabFn = null; } }
  const t0 = performance.now();
  for (const n of basinsAll) n.defs = definitions(tree, n.id, { grabFn, corpus, repo });
  return { computed: basinsAll.length, refreshed, ms: +(performance.now() - t0).toFixed(0) };
}

export async function bundle(tree, id, { reef = coordinateMass, capTokens = BUNDLE_TOKEN_CAP } = {}) {
  const capT = bundleCap(capTokens);   // C166d: the dispatch's cap reaches the envelope; the constant is only the default
  const N = tree.nodes; const n = N[id];
  if (!n || n.children.length || n.retracted) return null;   // a retracted leaf is never bundled
  if (!n.reef) n.reef = n.pixel ? await reef(n.pixel) : await coordinateMass(null);
  const parents = [];
  for (let p = n.parent ? N[n.parent] : null; p; p = p.parent ? N[p.parent] : null) parents.push({ id: p.id, type: p.type, headline: p.content.headline, hash8: String(p.hash).slice(0, 8) });
  const sibling_interfaces = n.parent ? N[n.parent].children.filter((c) => c !== id).map((c) => N[c]).filter((s) => s.type === 'interface' && !s.children.length)
    .map((s) => ({ id: s.id, hash8: String(s.hash).slice(0, 8), headline: s.content.headline, text: s.content.text.slice(0, 400) })) : [];
  const pr = proof(tree, id);
  const raw = [
    ...(n.revisions || []).filter((r) => !r.retracted && r.kind !== 'grade').map((r) => ({ at: r.at, kind: r.kind || 'revision', via: (r.meta && r.meta.via) === 'clip' ? 'clip' : 'hand', sha8: String(r.hash).slice(0, 8), text: r.text ?? r.excerpt ?? '' })),   // C165: hydrated when the caller hydrated, the 400-char head otherwise
    ...((n.meta && n.meta.echoes) || []).filter((e) => !e.retracted).map((e) => ({ at: e.at, via: e.via === 'clip' ? 'clip' : 'hand', sha8: String(e.rowSha).slice(0, 8), text: '(echo — the same bytes as the contract, pasted again)' })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const m = n.reef || {};
  const env = {
    hat: n.pixel && m.hat ? `${m.hat} [${n.pixel}]` : 'unmeasured',
    coordinate: n.pixel ? { pixel: n.pixel, name: m.canonical || fullName(n.pixel), domain: m.domain || null, guessed: !!m.guessed, sensor: n.walk ? n.walk.sensor : null } : null,
    active_leaf: { id, hash: n.hash, type: n.type, cue: n.cue, headline: n.content.headline, at: n.at, decidedAt: n.decidedAt, supersedes: n.supersedes, mass: n.mass || null },
    contract: { type: n.type, cue: n.cue, headline: n.content.headline, text: n.content.text },
    repo_rules: (m.rules || []).map((r) => (r.name ? `«${r.name}» ${r.text}` : r.text)),
    rules_from: m.rules_from || null,
    parents, sibling_interfaces,
    attestations: n.basin ? attestationsForLabel(n.meta && n.meta.label) : null,   // C43: the commits that satisfied this row
    // C59: latest / latestDecision carried the row's FULL text twice over (C54: 2,441 chars of a 6,000 cap) — heads only here
    lineage: n.basin ? (({ rows, latest, latestDecision, ...rest }) => { const head = (r) => (r ? { at: r.at, kind: r.kind, sha8: r.sha8, via: r.via, head: String(r.text).replace(/\s+/g, ' ').slice(0, 120) } : null); return { ...rest, latest: head(latest), latestDecision: head(latestDecision), rows: rows.map((r) => ({ at: r.at, kind: r.kind, sha8: r.sha8, via: r.via, retracted: r.retracted, current: !!r.current, head: String(r.text).replace(/\s+/g, ' ').slice(0, 120) })) }; })(lineage(tree, id)) : null,
    raw_semantic_mass: raw,
    directions: n.basin ? directions(tree, id).map(directionLine) : [],   // C98i: each direction under the row, UNGRADED or its grade with the why
    // a COPY: the cap loop cuts rule spans inside this object, and the node's own defs must never change under a bundle call
    // (found by the C42 determinism guard: the second bundle of the same leaf differed from the first)
    definitions: n.defs && n.defs.hash === n.hash ? JSON.parse(JSON.stringify(n.defs)) : (n.basin ? { hash: n.hash, at: null, terms: [], covered: 0, total: termsOf(n.content.text, n.meta && n.meta.label).length, stale: n.defs ? 'contract changed since the last fold' : 'not folded since C59' } : null),
    // C59: the sibling hashes never fit the cap (2 levels, ~119 hashes ≈ 7.6 KB against a 6 KB cap — every bundle said OVER CAP); the
    // proof is recomputable from the tree (proof(tree, id)), so the envelope carries the root, the leaf hash and the proof's id
    root_hash: tree.root, merkle: { leaf_hash: n.hash, path_len: pr.path.length, siblings: pr.path.reduce((a, s) => a + s.before.length + s.after.length, 0), proof_id: createHash('sha256').update(JSON.stringify(pr.path)).digest('hex').slice(0, 16), recompute: `proof(tree, '${id}')` },
    cap: { tokens: capT, chars: capT * CHARS_PER_TOKEN, estimate: `chars / ${CHARS_PER_TOKEN}`, truncated: null, chars_used: null, tokens_est: null },
  };
  const size = () => JSON.stringify(env).length + 200;   // 200 chars reserved for the cap's own message, which is written after the cuts
  const cuts = []; const said = () => { env.cap.truncated = cuts.length ? cuts.join('; ') : null; };
  let dropped = 0;
  while (size() > env.cap.chars && env.raw_semantic_mass.length) { env.raw_semantic_mass.shift(); dropped++; }
  if (dropped) cuts.push(`raw_semantic_mass: ${dropped} oldest entries dropped to hold the ${capT}-token cap`); said();
  // C59 cap order, cheapest loss first: raw mass (oldest) → lineage rows past the latest 3 (the latest decision and version stay;
  // the count says how many more) → definitions' rule spans (file:line kept) → the contract's tail down to a 400-char floor.
  // Before this the sibling hashes alone exceeded the cap and every bundle printed OVER CAP whatever else it cut.
  let lineageCut = 0;
  while (size() > env.cap.chars && env.lineage && env.lineage.rows.length > 3) { const i = env.lineage.rows.findIndex((r) => !r.current); if (i < 0) break; env.lineage.rows.splice(i, 1); lineageCut++; env.lineage.cut = lineageCut; }
  if (lineageCut) cuts.push(`lineage: ${lineageCut} older row${lineageCut === 1 ? '' : 's'} cut (counts kept)`); said();
  // the reef's rules at a crowded coordinate (B,A1 carries 17 voice rules ≈ 3 KB): the heaviest 4 stay, the rest are a count
  let rulesCut = 0; const rulesTotal = env.repo_rules.length;
  while (size() > env.cap.chars && env.repo_rules.length > 4) { env.repo_rules.pop(); rulesCut++; }
  if (rulesCut) { env.rules_from = `${env.rules_from ? env.rules_from + ' · ' : ''}${rulesCut} of ${rulesTotal} rules cut for the cap (the heaviest ${env.repo_rules.length} kept)`; cuts.push(`repo_rules: ${rulesCut} of ${rulesTotal} cut`); } said();
  let attCut = 0;
  while (size() > env.cap.chars && env.attestations && env.attestations.length > 2) { env.attestations.pop(); attCut++; }
  if (attCut) cuts.push(`attestations: ${attCut} older cut (newest 2 kept)`); said();
  let defsCut = 0;
  while (size() > env.cap.chars && env.definitions && env.definitions.terms.some((t) => t.rule && t.rule.span)) { const t = [...env.definitions.terms].reverse().find((x) => x.rule && x.rule.span); t.rule = { ...t.rule, span: null, cut: true }; defsCut++; }
  if (defsCut) cuts.push(`definitions: ${defsCut} rule span${defsCut === 1 ? '' : 's'} cut (file:line kept)`); said();
  // C98i: directions after the defs' spans, oldest first, the ungraded kept longest (they are what the worker must see); a count says what was cut
  let dirCut = 0; const dirTotal = env.directions.length;
  while (size() > env.cap.chars && env.directions.length > 3) { const i = env.directions.findIndex((l) => !l.startsWith('direction · UNGRADED')); env.directions.splice(i >= 0 ? i : 0, 1); dirCut++; }
  if (dirCut) { env.directions.push(`(${dirCut} of ${dirTotal} directions cut for the cap — spec-tree.mjs --ungraded --leaf ${id})`); cuts.push(`directions: ${dirCut} of ${dirTotal} cut`); } said();
  if (size() > env.cap.chars && env.definitions && env.definitions.terms.some((t) => t.first && t.first.headline && t.first.headline.length > 60)) { for (const t of env.definitions.terms) if (t.first && t.first.headline) t.first.headline = t.first.headline.slice(0, 60); cuts.push('definitions: first-appearance headlines cut to 60 chars'); said(); }
  if (size() > env.cap.chars) {
    const over = size() - env.cap.chars;
    const floor = 400;
    if (env.contract.text.length - floor > 40) { const cut = Math.min(over + 40, env.contract.text.length - floor); env.contract.text = env.contract.text.slice(0, env.contract.text.length - cut) + ' …'; cuts.push(`contract.text cut by ${cut} chars`); }
    said();
    // the last resort before saying OVER: rules down to 2, lineage rows down to 2 (the current version and the latest decision)
    let more = 0;
    while (size() > env.cap.chars && env.repo_rules.length > 2) { env.repo_rules.pop(); rulesCut++; more++; }
    while (size() > env.cap.chars && env.lineage && env.lineage.rows.length > 2) { const i = env.lineage.rows.findIndex((r) => !r.current); if (i < 0) break; env.lineage.rows.splice(i, 1); lineageCut++; env.lineage.cut = lineageCut; more++; }
    // C98i: the directions collapse to one count line before the envelope says OVER — the worker still learns how many and the door
    if (size() > env.cap.chars && dirTotal && env.directions.length > 1) { const un = env.directions.filter((l) => l.startsWith('direction · UNGRADED')).length; env.directions = [`(${dirTotal} direction${dirTotal === 1 ? '' : 's'}, ${un} UNGRADED, cut for the cap — spec-tree.mjs --ungraded --leaf ${id})`]; dirCut = dirTotal; cuts.push(`directions: all ${dirTotal} cut to a count`); more++; }
    if (more) { cuts.push(`last resort: rules to ${env.repo_rules.length}, lineage rows to ${env.lineage ? env.lineage.rows.length : '—'}`); said(); }
    if (size() > env.cap.chars) { cuts.push(`OVER CAP by ${size() - env.cap.chars} chars after every cut`); said(); }
  }
  env.cap.chars_used = size(); env.cap.tokens_est = Math.ceil(env.cap.chars_used / CHARS_PER_TOKEN);
  return env;
}

// ── C42 THE INJECTION BOUNDARY (goal unit 3, 2026-09-18). The envelope a builder model receives is the bundle above, and its
// model-agnosticism is a PROPERTY, not a claim: (1) every field is a pure function of (tree, leaf) — the same call twice yields
// the same bytes; (2) no field is drawn from the conversation — no session, transcript, prompt or chat-history key, so a
// lower tier gets exactly the Merkle-derived constraints a frontier model gets and nothing else; (3) the cap is the cap. The
// schema below is the boundary in one place; validateEnvelope() is what a guard and a foreign host call. What stays UNMEASURED
// on the row: the A/B percentage across builder models — that needs model runs, which never ride the interactive path.
export const ENVELOPE_BANNED_KEYS = ['session', 'session_id', 'transcript', 'transcript_path', 'prompt', 'chat', 'history', 'messages', 'turns'];
export const ENVELOPE_SCHEMA = {
  version: 1, cap: { tokens: BUNDLE_TOKEN_CAP, chars: BUNDLE_TOKEN_CAP * CHARS_PER_TOKEN },
  required: ['hat', 'coordinate', 'active_leaf', 'contract', 'repo_rules', 'rules_from', 'parents', 'sibling_interfaces', 'attestations', 'lineage', 'raw_semantic_mass', 'directions', 'definitions', 'root_hash', 'merkle', 'cap'],
  provenance: { hat: 'reef at the leaf pixel (mass-collision)', coordinate: 'the one Rust walk (lensWalk)', active_leaf: 'the tree node', contract: 'the node text', repo_rules: 'the reef at the coordinate', parents: 'parent edges to root', attestations: 'C43 ledger', lineage: 'C52c', raw_semantic_mass: 'slotted snippets + echoes', directions: 'C98i — intent/decision snippets on the basin, UNGRADED or graded by hand', definitions: 'C59 (fold time)', root_hash: 'the tree root', merkle: 'proof(tree, id) — root · leaf hash · proof id' },
  derived_from: ['tree', 'leaf id'], never_from: ENVELOPE_BANNED_KEYS,
};
export function validateEnvelope(env) {
  const errors = [];
  if (!env || typeof env !== 'object') return { ok: false, errors: ['not an object'] };
  for (const k of ENVELOPE_SCHEMA.required) if (!(k in env)) errors.push(`missing ${k}`);
  const walk = (o, path) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (ENVELOPE_BANNED_KEYS.includes(k)) errors.push(`conversational key ${path}${k}`); walk(o[k], `${path}${k}.`); } };
  walk(env, '');
  // C166d: the envelope declares its cap; it must sit in the permitted band and be self-consistent, and the size is held to it
  const capTok = env.cap && env.cap.tokens != null ? env.cap.tokens : BUNDLE_TOKEN_CAP, capChars = capTok * CHARS_PER_TOKEN;
  const size = JSON.stringify(env).length; if (size > capChars) errors.push(`over cap: ${size} > ${capChars}`);
  if (env.merkle && 'merkle_path' in env) errors.push('merkle_path rides — the sibling hashes never fit');
  if (env.cap && (bundleCap(env.cap.tokens) !== env.cap.tokens || env.cap.chars !== env.cap.tokens * CHARS_PER_TOKEN)) errors.push('cap moved');
  return { ok: errors.length === 0, errors, chars: size };
}

// ── T6 THE THRESHOLDS ARE RATCHETED, NEVER TYPED (§24) ───────────────────────────────────────────
// The same rows are replayed as snips: every chunk of every ledger row is read against the leaves that are
// NOT itself (leave-one-out by hash), same-type, with C(L_i) from the memo, and the band is taken under the
// thresholds in force → the REAL rate = (revisions + attachments) / snips. The NULL is the house form
// (grip-meter.mjs nullRate: K = 8 deterministic LCG shuffles): each snip is paired with a SHUFFLED leaf
// instead of its nearest, and the rate of pairs that would revise or attach under the same thresholds is
// the rate the band would show with no structure in it. EXCEEDANCE = shuffles whose rate ≥ the real one.
// The floors (data/vna/spec-tree-floors.json) move ONE WAY — tighter: τ down, m up — and only when the null
// itself says the current band over-admits (null mean above NULL_TOL); a real rate at the null moves
// nothing and is printed as the reading. Every run appends a receipt (data/vna/spec-tree-ratchet.ndjson).
export const RATCHET = process.env.VNA_SPEC_TREE_RATCHET || resolve(REPO, 'data/vna/spec-tree-ratchet.ndjson');
export const K_NULL = 8, NULL_TOL = 0.02, TAU_STEP = 0.05, M_STEP = 0.01;
// copied from scripts/pmu/grip-meter.mjs (not exported there): the deterministic LCG shuffle the meters share
const lcgShuffle = (arr, seed0) => { const a = [...arr]; let seed = seed0 % 233280; for (let i = a.length - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; const j = seed % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dMemo = (leaf, text, cS) => { const cN = leaf.mass && leaf.mass.own ? leaf.mass.own.gzip : leafMass(leaf).own.gzip; const cSN = gz(leaf.content.text + '\n' + text); const [lo, hi] = cN < cS ? [cN, cS] : [cS, cN]; return hi === 0 ? 0 : (cSN - lo) / hi; };
const bandOf = (dMin, dSecond, th) => (dMin == null ? 'new' : dMin < th.tau_rev ? 'revision' : dMin < th.tau_attach ? ((dSecond == null ? Infinity : dSecond - dMin) >= th.m_attach ? 'attach' : 'abstain') : 'new');
export function ratchetStats(tree, rows, { th = thresholds(), K = K_NULL, shuffled = false } = {}) {
  const leaves = Object.values(tree.nodes).filter((n) => n.id !== 'root' && !n.children.length && !n.retracted && n.content.text.length >= NCD_MIN_CHARS);
  const snips = [];
  for (const r of rows) for (const b of chunk(String(r.text || ''), r.offsetFrom || 0)) {
    if (b.kind === 'heading' || b.kind === 'section' || b.text.length < NCD_MIN_CHARS) continue;
    const { type } = typeOf(b.text); const h = leafHash(type, b.text);
    const cands = leaves.filter((n) => n.type === type && n.hash !== h);
    if (!cands.length) continue;
    snips.push({ text: b.text, type, cS: gz(b.text), cands });
  }
  const counts = { revision: 0, attach: 0, abstain: 0, new: 0 };
  // the real read: nearest and second-nearest; under `shuffled` the snip is read against a shuffled partner AS IF it were real (the mutation this row names)
  const readReal = (sn, k) => {
    if (shuffled) { const partner = lcgShuffle(sn.cands, 7 + 97 * (k + 1))[0]; return bandOf(dMemo(partner, sn.text, sn.cS), null, th); }
    let best = null, second = null;
    for (const c of sn.cands) { const d = dMemo(c, sn.text, sn.cS); if (best == null || d < best) { second = best; best = d; } else if (second == null || d < second) second = d; }
    return bandOf(best, second, th);
  };
  snips.forEach((sn, i) => { counts[readReal(sn, i)]++; });
  const n = snips.length;
  const rate = n ? +((counts.revision + counts.attach) / n).toFixed(4) : 0;
  const rates = [];
  for (let k = 1; k <= K; k++) {
    let hit = 0;
    for (const sn of snips) { const partner = lcgShuffle(sn.cands, 7 + 97 * k)[0]; const band = bandOf(dMemo(partner, sn.text, sn.cS), null, th); if (band === 'revision' || band === 'attach') hit++; }
    rates.push(n ? +(hit / n).toFixed(4) : 0);
  }
  const mean = +(rates.reduce((a, x) => a + x, 0) / rates.length).toFixed(4);
  const sd = +Math.sqrt(rates.reduce((a, x) => a + (x - mean) ** 2, 0) / rates.length).toFixed(4);
  const exceedance = rates.filter((x) => x >= rate).length;
  return { K, thresholds: th, real: { n, ...counts, rate }, null: { mean, sd, rates }, exceedance, shuffled };
}
// ── C52d CALIBRATE ONCE (2026-09-17): the seed τ_attach 0.55 was typed, never measured — stamped "from":"seed". On the
// live corpus (867 snips) it admitted 2.3% while the shuffled null admitted 0.01%: two hundred times too tight, and a
// ratchet that only tightens can never say so. The one-time calibration sweeps τ_attach UP from the seed one TAU_STEP at
// a time while the shuffled null stays under NULL_TOL with zero exceedance, and writes the last such τ as the STARTING
// floor. It runs once: a floors file that already carries a calibration refuses a second (the ratchet only tightens from
// here — the monotone history starts at the calibrated value, not the guess). Sufficient for: the loosest τ the null
// refuses. NOT for: whether the attachments are right (undecidable) — only that random partners would not have made them.
export function calibrate(tree, rows, { floorsPath = FLOORS, receipt = RATCHET, by = process.env.VNA_BY || 'cli', now = new Date().toISOString(), K = K_NULL, maxTau = 0.9 } = {}) {
  let floors = null; try { floors = JSON.parse(readFileSync(floorsPath, 'utf8')); } catch {}
  if (floors && (floors.history || []).some((h) => h.kind === 'calibrate')) return { ok: false, why: `already calibrated (${(floors.history.find((h) => h.kind === 'calibrate') || {}).at}) — the ratchet only tightens from here`, floors };
  const seed = { tau_rev: NCD_REVISION, tau_attach: TAU_ATTACH, m_attach: M_ATTACH };
  const sweep = []; let chosen = seed.tau_attach, last = null;
  for (let tau = seed.tau_attach; tau <= maxTau + 1e-9; tau = +(tau + TAU_STEP).toFixed(4)) {
    const st = ratchetStats(tree, rows, { th: { ...seed, tau_attach: tau }, K });
    const ok = st.null.mean <= NULL_TOL && st.exceedance === 0;
    sweep.push({ tau_attach: tau, real: st.real.rate, attach: st.real.attach, abstain: st.real.abstain, new: st.real.new, null: st.null.mean, sd: st.null.sd, exceedance: st.exceedance, ok });
    if (!ok) break;
    chosen = tau; last = st;
  }
  const current = { ...seed, tau_attach: chosen, since: now, from: 'calibrated-null' };
  const next = { current, history: [...((floors && floors.history) || []), { at: now, kind: 'calibrate', by, seed, to: { tau_rev: current.tau_rev, tau_attach: current.tau_attach, m_attach: current.m_attach }, sweep, snips: last ? last.real.n : 0 }] };
  mkdirSync(dirname(floorsPath), { recursive: true }); writeFileSync(floorsPath, JSON.stringify(next, null, 1) + '\n');
  try { mkdirSync(dirname(receipt), { recursive: true }); appendFileSync(receipt, JSON.stringify({ at: now, kind: 'calibrate', by, seed, chosen: current, sweep }) + '\n'); } catch {}
  return { ok: true, chosen: current, sweep, seed, why: null };
}

// ── C52d STATUS: "how would I know?" answered from receipts only — the tree (source, watermark, basins, slotted, attach/
// abstain/new over the ingested rows), the fold latency (roots ledger vs tape rows), the floors (seed or calibrated, and
// when), the last N seeds (the gauge receipt log). It refuses to say the instrument is working: ok is "every receipt
// present", and each line names the file it was read from.
export const SEEDS = process.env.VNA_SEED_LOG || resolve(REPO, '.thetacog/vna-seed.ndjson');
export function status({ treePath = TREE, ledger = LEDGER, pointer = POINTER, roots = ROOTS, floorsPath = FLOORS, seeds = SEEDS, n = 20 } = {}) {
  const lines = []; const missing = [];
  let source = null; try { source = JSON.parse(readFileSync(pointer, 'utf8')).source || null; } catch {} if (!source) missing.push(pointer);
  let tree = null; try { tree = JSON.parse(readFileSync(treePath, 'utf8')); } catch {} if (!tree) missing.push(treePath);
  const rows = source ? loadRows(ledger, source) : [];
  const byI = new Map(rows.map((r) => [r._i, r])); const lastI = rows.length ? rows[rows.length - 1]._i : -1;   // ledger indices are global; this source's rows are a subset
  if (tree) {
    const all = Object.values(tree.nodes).filter((x) => x.id !== 'root' && !x.retracted);
    const basins = all.filter((x) => x.basin); const slotted = basins.reduce((a, x) => a + (x.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length, 0);
    const snips = all.reduce((a, x) => a + (x.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length, 0);
    const revs = all.reduce((a, x) => a + (x.revisions || []).filter((r) => r.kind !== 'snippet' && r.kind !== 'grade' && !r.retracted).length, 0);
    const leaves = all.filter((x) => !x.children.length && !x.basin && x.type !== 'section').length;
    lines.push(`tree · ${treePath} · source ${tree.source} · rows ≤ ${tree.watermark} · tape ends at row ${lastI} (${rows.filter((r) => r._i > tree.watermark).length ? `${rows.filter((r) => r._i > tree.watermark).length} BEHIND` : 'at the tape'}) · root ${String(tree.root).slice(0, 12)}`);
    lines.push(`mass · ${basins.length} basins (${slotted} chunks slotted) · ${leaves} tape leaves · ${snips} snippets attached · ${revs} revisions · drawer ${(tree.unplacedSnips || []).filter((u) => !u.retracted).length}`);
    if (tree.source !== source) lines.push(`⚠ the tree is for ${tree.source}, the pointer says ${source}`);
  }
  let folds = []; try { folds = readFileSync(roots, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((f) => f.kind !== 'retract'); } catch {} if (!folds.length) missing.push(roots);
  if (folds.length && rows.length) {
    // LATENCY IS paste → fold, measured only on folds that INGESTED rows (f.rows > the previous fold's rows). A refold on a spec
    // edit re-reads the same last tape row and, counted, reports that row's AGE — ten such refolds after the tape stopped at row 50
    // read "median 3,186 s" on 2026-09-18 while the engine folds in seconds. Now: no ingesting fold in the window → not a measurement.
    const win = folds.slice(-n); const fed = win.filter((f, i) => { const prev = i ? win[i - 1] : folds[folds.length - n - 1]; return prev ? f.rows > prev.rows : true; });
    const lat = fed.map((f) => { const r = byI.get(f.rows - 1); return r ? (Date.parse(f.at) - Date.parse(r.at)) / 1000 : null; }).filter((x) => x != null && x >= 0);
    const med = lat.length ? lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;
    lines.push(`fold · ${roots} · ${folds.length} folds · last ${String(folds[folds.length - 1].at).slice(0, 19)} by ${folds[folds.length - 1].by || '?'} · latency median ${med == null ? 'UNMEASURED — no fold ingested new rows in the window' : med.toFixed(1) + ' s'} over ${lat.length} ingesting fold${lat.length === 1 ? '' : 's'} of the last ${win.length}`);
  }
  const th = thresholds(floorsPath); let fl = null; try { fl = JSON.parse(readFileSync(floorsPath, 'utf8')); } catch {}
  if (!fl) missing.push(floorsPath);
  lines.push(`floors · ${floorsPath} · τ_rev ${th.tau_rev} · τ_attach ${th.tau_attach} · m_attach ${th.m_attach} · ${th.from}${fl && fl.history ? ` · ${fl.history.length} step${fl.history.length === 1 ? '' : 's'} (${fl.history.map((h) => h.kind || 'ratchet').join(', ')})` : ' · NEVER CALIBRATED, NEVER RATCHETED'}`);
  let sd = []; try { sd = readFileSync(seeds, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-n); } catch {} if (!sd.length) missing.push(seeds);
  if (sd.length) { const ab = sd.filter((x) => x.abstained).length; const rec = sd.filter((x) => x.anchor === 'commit' || x.anchor === 'goal').length; const re = sd.filter((x) => x.reaimed).length; const byStage = {}; for (const x of sd) byStage[x.stage || '?'] = (byStage[x.stage || '?'] || 0) + 1; lines.push(`seed · ${seeds} · last ${sd.length} turns · abstained ${ab} (${(100 * ab / sd.length).toFixed(0)}%) · landed ${sd.length - ab} · anchored from the record ${rec} (C57) · re-aimed by an admitted walk ${re} · stages ${JSON.stringify(byStage)} · median ${sd.map((x) => x.ms || 0).sort((a, b) => a - b)[Math.floor(sd.length / 2)]} ms`); }
  const ok = !missing.length;
  lines.push(ok ? 'every receipt present — the numbers above are what the instrument did, not what it claims' : `NOT VERIFIED — missing receipt${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  return { ok, missing, lines, source, watermark: tree ? tree.watermark : null, rows: rows.length, folds: folds.length, thresholds: th, seeds: sd.length };
}

// floors move one way only: τ down, m up. A proposal in the other direction is refused and recorded as such.
export function applyFloor(floors, proposal, why, at = new Date().toISOString()) {
  const cur = { tau_rev: NCD_REVISION, tau_attach: TAU_ATTACH, m_attach: M_ATTACH, ...((floors && floors.current) || {}) };
  const next = { ...cur };
  let moved = false;
  if (proposal.tau_rev != null && proposal.tau_rev < cur.tau_rev) { next.tau_rev = +proposal.tau_rev.toFixed(4); moved = true; }
  if (proposal.tau_attach != null && proposal.tau_attach < cur.tau_attach && proposal.tau_attach > next.tau_rev) { next.tau_attach = +proposal.tau_attach.toFixed(4); moved = true; }
  if (proposal.m_attach != null && proposal.m_attach > cur.m_attach) { next.m_attach = +proposal.m_attach.toFixed(4); moved = true; }
  if (!moved) return { moved: false, floors: floors || { current: { ...cur, since: at }, history: [] }, why: `refused — a floor only tightens (${JSON.stringify(proposal)} vs ${JSON.stringify(cur)})` };
  next.since = at;
  const history = [...((floors && floors.history) || []), { at, from: { tau_rev: cur.tau_rev, tau_attach: cur.tau_attach, m_attach: cur.m_attach }, to: { tau_rev: next.tau_rev, tau_attach: next.tau_attach, m_attach: next.m_attach }, why }];
  return { moved: true, floors: { current: next, history }, why };
}
export function floorsNeverLoosen(floors) {
  const h = (floors && floors.history) || [];
  for (const step of h) { const f = step.from || {}, t = step.to || {}; if ((t.tau_rev ?? f.tau_rev) > (f.tau_rev ?? Infinity) || (t.tau_attach ?? f.tau_attach) > (f.tau_attach ?? Infinity) || (t.m_attach ?? f.m_attach) < (f.m_attach ?? -Infinity)) return false; }
  return true;
}
export function ratchet(tree, rows, { floorsPath = FLOORS, receipt = RATCHET, by = process.env.VNA_BY || 'cli', now = new Date().toISOString() } = {}) {
  let floors = null; try { floors = JSON.parse(readFileSync(floorsPath, 'utf8')); } catch {}
  const th = thresholds(floorsPath);
  const st = ratchetStats(tree, rows, { th });
  // the proposal comes from the null alone: while random partners would attach above NULL_TOL, tighten τ_attach one step;
  // m_attach rises one step when a draw reaches the real rate (exceedance > 0) on a replay of at least six snips
  const prop = {}; const trial = { ...th }; let guard = 0;
  while (guard++ < 8 && trial.tau_attach - TAU_STEP > trial.tau_rev && ratchetStats(tree, rows, { th: trial }).null.mean > NULL_TOL) { trial.tau_attach = +(trial.tau_attach - TAU_STEP).toFixed(4); prop.tau_attach = trial.tau_attach; }
  if (st.exceedance > 0 && st.real.n >= 6) prop.m_attach = +(th.m_attach + M_STEP).toFixed(4);
  const ap = Object.keys(prop).length ? applyFloor(floors, prop, `null mean ${st.null.mean} over tol ${NULL_TOL} · exceedance ${st.exceedance}/${st.K}`, now) : { moved: false, floors, why: 'the null admits under tolerance — nothing to tighten' };
  if (ap.moved) { mkdirSync(dirname(floorsPath), { recursive: true }); writeFileSync(floorsPath, JSON.stringify(ap.floors, null, 2) + '\n'); }
  const row = { at: now, by, source: tree.source, root: tree.root, K: st.K, thresholds: th, real: st.real, null: st.null, exceedance: st.exceedance, moved: ap.moved, proposal: prop, why: ap.why, floors: ap.moved ? ap.floors.current : (floors ? floors.current : null) };
  try { mkdirSync(dirname(receipt), { recursive: true }); appendFileSync(receipt, JSON.stringify(row) + '\n'); } catch {}
  return { ...st, moved: ap.moved, why: ap.why, receipt: row, floors: ap.floors };
}

// ── T7 SEED FROM THE LEAF (§24) ─────────────────────────────────────────────────────────────────
// A prompt is read against every leaf by NCD with C(L_i) from the memo; the nearest and the second are
// named with their d; the margin decides: under m_attach, or with no leaf inside τ_attach, the seed
// ABSTAINS — leaf null, both candidates named — never the first by index. A named leaf carries its
// coordinate, the hat and the rule names the reef reader stored on it (unmeasured when it has none).
export function seedLeaf(tree, prompt, { th = thresholds() } = {}) {
  const text = String(prompt || '').trim();
  const leaves = Object.values(tree.nodes).filter((n) => n.id !== 'root' && !n.children.length && !n.retracted && !n.slotted && n.content.text.length >= NCD_MIN_CHARS);
  const cS = gz(text);
  let best = null, second = null, read = 0, prefiltered = 0;
  for (const n of leaves) {
    // THE CHEAP BOUND (budget, 2026-09-17: 909 ms on a live turn): C(S·L) is never smaller than the larger of the
    // two, so NCD ≥ 1 − min/max − ε. A pair whose bound already sits beyond τ_attach cannot land inside it and is
    // skipped without a gzip; C(L) is the memo (mass.own.gzip), written once and never re-gzipped here.
    const cN = n.mass && n.mass.own ? n.mass.own.gzip : leafMass(n).own.gzip;
    const lo = Math.min(cS, cN), hi = Math.max(cS, cN);
    if (1 - lo / hi - PREFILTER_SLACK >= th.tau_attach) { prefiltered++; continue; }
    read++;
    const d = dMemo(n, text, cS); if (!best || d < best.d) { second = best; best = { n, d }; } else if (!second || d < second.d) second = { n, d };
  }
  const r4 = (x) => (x == null ? null : +x.toFixed(4));
  const cand = (c) => (c ? { id: c.n.id, d: r4(c.d), headline: c.n.content.headline } : null);
  const margin = best && second ? r4(second.d - best.d) : best ? Infinity : null;
  const base = { prompt_chars: text.length, thresholds: th, best: cand(best), second: cand(second), d_min: best ? r4(best.d) : null, margin, leaves: leaves.length, read, prefiltered };
  if (!best) return { ...base, abstained: true, leaf: null, why: 'no leaves in the tree', coordinate: null, hat: 'unmeasured', rules: [] };
  if (best.d >= th.tau_attach) return { ...base, abstained: true, leaf: null, why: `no leaf within τ_attach ${th.tau_attach} (best ${best.n.id} d=${r4(best.d)}${second ? ` second ${second.n.id} d=${r4(second.d)}` : ''}) — the spec has no mass here yet`, coordinate: null, hat: 'unmeasured', rules: [] };
  if (second && second.d - best.d < th.m_attach) return { ...base, abstained: true, leaf: null, why: `ambiguous — margin ${margin} under m_attach ${th.m_attach} between ${best.n.id} and ${second.n.id}`, coordinate: null, hat: 'unmeasured', rules: [] };
  const n = best.n; const reef = n.reef || null;
  return { ...base, abstained: false, why: null, leaf: { id: n.id, hash: n.hash, type: n.type, cue: n.cue, headline: n.content.headline, text: n.content.text, decidedAt: n.decidedAt, snippets: (n.revisions || []).length },
    coordinate: n.pixel || null, hat: n.pixel && reef && reef.hat ? reef.hat : 'unmeasured', rules: reef && reef.rules ? reef.rules.map((r) => r.name || r.text.slice(0, 40)) : [] };
}

// ── C43: the commits that satisfied a row — read from data/vna/attestations.ndjson (attest-commit.mjs writes it,
// post-commit calls it detached). Inline here rather than imported so spec-tree.mjs stays the root of the module graph.
export const ATTESTATIONS = process.env.VNA_ATTESTATIONS || resolve(REPO, 'data/vna/attestations.ndjson');
export function attestationsForLabel(label, path = ATTESTATIONS, n = 5) {
  if (!label) return [];
  let rows = []; try { rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  return rows.filter((a) => (a.proofs || []).some((p) => p.label === label && p.present)).slice(-n).reverse().map((a) => ({ sha: String(a.sha).slice(0, 10), at: a.at, subject: String(a.subject || '').slice(0, 120), files: (a.files || []).length, verified: !!(a.proofs.find((p) => p.label === label) || {}).verified }));
}

// ── C57 THE ACTIVE LEAF IS THE RECORD'S, NOT THE PROMPT'S (2026-09-18). The seed's DEFAULT anchor is the row the last
// commit attested (C43 ledger: newest row whose proofs hold a present basin — the subject's labels first, an OPEN row among
// them before a ticked one, then the body's), or the row a /goal named (.thetacog/vna-active-leaf.json, written by hand or by
// a future door; it wins while its label is a live basin). The prompt's text RE-AIMS the anchor only when the one door ADMITS
// the walk; a released or abstained seed is printed as an aside and the bundle stays on the record's row. WHY: the prompt-text
// seed released C42 at d 0.86 for a question about C53, C40/C44/C50/C45 for the turns before it — never the row being built;
// those distances sit in the random band (τ_attach calibrated 0.70). Done-when: /clear, then "continue", and the envelope
// names the row of the last commit — the no-context-window test. Sufficient for: "which row is the work on". NOT for: whether
// the prompt is about that row (that is the walk's admission, kept), or whether the commit satisfied it (C43's proof, kept).
export const ACTIVE_LEAF = process.env.VNA_ACTIVE_LEAF || resolve(REPO, '.thetacog/vna-active-leaf.json');
const LABEL_RE_G = /\b(C\d{1,3}[a-z]?|T\d{1,3})\b/g;
export function activeLeaf(tree, { attestations = ATTESTATIONS, override = ACTIVE_LEAF } = {}) {
  const N = tree && tree.nodes || {};
  const basin = (label) => { const n = N[`n_spec_${label}`]; return n && n.basin && !n.retracted ? n : null; };
  const leaf = (n, rest) => ({ id: n.id, label: n.meta && n.meta.label, headline: n.content.headline, text: n.content.text, pixel: n.pixel || null, done: !!(n.meta && n.meta.done), snippets: (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length, ...rest });
  try { const g = JSON.parse(readFileSync(override, 'utf8')); const n = g && g.label ? basin(g.label) : null; if (n) return leaf(n, { source: 'goal', at: g.at || null, by: g.by || null, sha: null, subject: g.note || null }); } catch {}
  let rows = []; try { rows = readFileSync(attestations, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  for (let i = rows.length - 1; i >= 0; i--) {
    const a = rows[i]; const present = (a.proofs || []).filter((p) => p.present && basin(p.label)).map((p) => p.label);
    if (!present.length) continue;
    const subj = [...new Set([...String(a.subject || '').matchAll(LABEL_RE_G)].map((m) => m[1]))].filter((l) => present.includes(l));
    const order = [...subj, ...present.filter((l) => !subj.includes(l))];
    const label = order.find((l) => !basin(l).meta.done) || order[0];
    return leaf(basin(label), { source: 'commit', sha: String(a.sha).slice(0, 10), at: a.at || null, subject: String(a.subject || '').slice(0, 120), named: order, byRecord: subj.length ? 'subject' : 'body' });
  }
  return null;
}
// the anchor decision: an ADMITTED seed re-aims to the prompt's row; anything else keeps the record's row and carries the
// prompt's nearest as an aside. No record and no admitted seed → the released/abstained seed as before (C53b), nothing lost.
export function anchorSeed(seed, active) {
  const admitted = !!(seed && !seed.abstained && !seed.released && seed.leaf);
  // C176a P3 (ADMISSION): a RE-AIM away from the record's active basin needs a FINITE margin against a real competitor.
  // margin === Infinity means the seed's ring/slot held only one basin (no competitor) — confidence about which RING to
  // enter, not confidence to override an existing anchor. Observed 2026-09-22: a licence prompt re-aimed onto C52c at
  // "d 0.9534 · margin ∞" with ONE basin in the bin; ∞ meant no competitor, not certainty, and it should not have
  // displaced the record. Admission with a single-basin ring stays valid when there is NO active record (the design note
  // above this function: "ONE basin in the ring is the walk's decision") — this only guards the RE-AIM path.
  const wouldReaim = admitted && active && active.id !== seed.leaf.id;
  if (wouldReaim && seed.margin === Infinity) return { anchor: active.source, leaf: active, active, reaimed: false,
    aside: { leaf: seed.leaf, released: seed.released || null, abstained: false, walk: seed.walk || null, d: seed.leaf.d ?? null,
      why: `margin ∞ (no competitor in the ${seed.inSlot === 1 ? 'single-basin' : ''} slot) is not grounds to re-aim away from the record's ${active.label || active.id} (C176a P3)` } };
  if (admitted) return { anchor: 'prompt', leaf: seed.leaf, active: active || null, reaimed: !!(active && active.id !== seed.leaf.id), aside: null };
  if (active) return { anchor: active.source, leaf: active, active, reaimed: false, aside: seed && (seed.leaf || seed.best) ? { leaf: seed.leaf || seed.best, released: seed.released || null, abstained: !!seed.abstained, why: seed.why || null, walk: seed.walk || null, d: (seed.leaf || seed.best).d ?? null } : null };
  return { anchor: seed && seed.leaf ? 'prompt-released' : null, leaf: seed && seed.leaf || null, active: null, reaimed: false, aside: null };
}

// ── C52c AGING IN THE SLOT (operator 2026-09-17: "for aging decisions in the same slots by tesseract rust ingest"): a
// basin's lineage is every decision made in its slot, oldest → newest — the spec row's own versions (a hand edit archived
// as kind revision, the current text last) and every chunk typed `decision` that slotted into it — with retracted ones
// marked, never dropped. The LATEST is the last non-retracted entry; "what was the latest decision" is read here, never
// inferred from chat order. A second decision never makes a second leaf: it is one more entry in the same slot.
export function lineage(tree, id) {
  const n = tree.nodes[id]; if (!n || !n.basin) return null;
  const rows = [];
  for (const r of n.revisions || []) {
    if (r.kind === 'revision') rows.push({ at: r.at, kind: 'version', sha8: String(r.hash).slice(0, 8), text: r.text ?? r.excerpt ?? '', retracted: !!r.retracted, via: 'spec' });
    else if (r.kind === 'snippet' && r.decision) rows.push({ at: r.at, kind: 'decision', sha8: String(r.hash).slice(0, 8), text: r.text ?? r.excerpt ?? '', retracted: !!r.retracted, via: r.meta && r.meta.via === 'clip' ? 'clip' : 'hand', slot: r.meta && r.meta.slot || null });
  }
  rows.push({ at: n.decidedAt, kind: 'version', sha8: String(n.hash).slice(0, 8), text: n.content.text, retracted: false, via: 'spec', current: true });
  rows.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  const live = rows.filter((r) => !r.retracted);
  const decisions = live.filter((r) => r.kind === 'decision');
  return { id, label: n.meta && n.meta.label, rows, decisions: decisions.length, versions: live.filter((r) => r.kind === 'version').length, latest: live.length ? live[live.length - 1] : null, latestDecision: decisions.length ? decisions[decisions.length - 1] : null };
}

// ── C52b SPEC-FIRST SEED: the coordinate is the slot, the compressor chooses within it (operator 2026-09-17: "guarantee
// that the snowball starts on the spec and runs backwards into the repo to build mass on every turn"). Candidates are the
// BASINS only (the spec's own rows, ~60), never tape leaves. Stage 1: the basins at the prompt's pixel (the one Rust walk's
// reading of the prompt), widened one block at a time up to `reach`; the nearest by NCD in the tightest non-empty ring is
// the seed — the walk decided the slot, NCD only ordered within it. Stage 2 (no pixel, or no basin within reach): NCD over
// every basin under the T7 bands (τ_attach, m_attach) — an abstention names the two nearest. Sufficient for: "which declared
// row is this turn about". NOT for: whether the turn is right (undecidable) or whether a tape leaf says more (that is the
// bundle's job once the basin is named).
export function seedSpecFirst(tree, prompt, pixelOrWalk, { th = thresholds(), reach = 1, viaTargets = false } = {}) {
  const text = String(prompt || '').trim();
  const walkRow = pixelOrWalk && typeof pixelOrWalk === 'object' ? pixelOrWalk : null;
  const pixel = walkRow ? walkRow.pixel : pixelOrWalk;
  // C52f: walked against the basins as targets, the ring is 0 only (the lens chose among the rows themselves) and the
  // walk's admissibility is the admission — an unadmitted walk abstains here, never a node guess
  // C53b (2026-09-18): an UNADMITTED walk no longer refuses the seed. The walk's line-order null answers "does the prompt's
  // order beat its shuffles"; the seed asks "which basin is nearest, and should the model see it" — a different pair (W6), and
  // THE METER's unadmitted line (C53a, data/vna/seed-release-null.json) read the refused placement predicting the next commit
  // at 0.316 vs 0.213 ± 0.034, z 3.04, while the admitted 16 sat under their own null. So the pixel is kept, the slot is
  // ring 0 then +1, the basins in it are ordered by NCD, and the nearest is RELEASED marked UNMEASURED with the walk's own
  // numbers on the row — context, never a verdict; nothing here is a placement claim and C47's abstention is not imported.
  // Abstains only when the slot holds no basin within one block, or when the walk gave no pixel (then the NCD path below).
  const released = !!(viaTargets && walkRow && !walkRow.admissible);
  const walkNums = walkRow ? (() => { const best = (walkRow.attempts || []).reduce((a, b) => (!a || (b.z ?? -1) > (a.z ?? -1) ? b : a), null); return { gain: best ? best.gain ?? null : null, z: best ? best.z ?? null : null, z_required: walkRow.ratchet ? walkRow.ratchet.z_required ?? null : null, sensor: walkRow.sensor || 'unmeasured' }; })() : null;
  if (viaTargets) reach = released ? 1 : 0;
  const basins = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted && !n.children.length);
  if (!basins.length) return { abstained: true, why: 'no basins in the tree', stage: null, pixel: pixel || null, candidates: 0 };
  const cS = gz(text);
  const dOf = (n) => { const cN = n.mass && n.mass.own ? n.mass.own.gzip : leafMass(n).own.gzip; const cSN = gz(n.content.text + '\n' + text); const [lo, hi] = cN < cS ? [cN, cS] : [cS, cN]; return hi === 0 ? 0 : +((cSN - lo) / hi).toFixed(4); };
  const leaf = (n, d) => ({ id: n.id, label: n.meta && n.meta.label, headline: n.content.headline, text: n.content.text, pixel: n.pixel || null, done: !!(n.meta && n.meta.done), d, snippets: (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length });
  const pb = blkOf(pixel);
  if (pb) {
    for (let ring = 0; ring <= reach; ring++) {
      const inRing = basins.filter((n) => { const b = blkOf(n.pixel); return b && chebOf(b, pb) === ring; });
      if (!inRing.length) continue;
      const ranked = inRing.map((n) => [n, dOf(n)]).sort((x, y) => x[1] - y[1]);
      const [b, d] = ranked[0]; const sec = ranked[1] ? leaf(ranked[1][0], ranked[1][1]) : null;
      const margin = sec ? +(sec.d - d).toFixed(4) : Infinity;
      // ONE basin in the ring is the walk's decision. SEVERAL need the compressor's margin (m_attach) to pick — a 15-basin
      // ring with a 0.02 margin (the live first run, C43 "chosen" for a question about C52) is a guess, and T7 forbids one:
      // the abstention names the ring and the two nearest, and the queue head follows.
      // …and the compressor must still ADMIT the basin (d under τ_attach): the walk naming a slot whose one basin shares no
      // bytes with the prompt (live: C9 [x] at d 0.86 for a question about the snowball) is two sensors disagreeing — an
      // abstention that says both, never a pick.
      if (!viaTargets && d >= th.tau_attach) return { abstained: true, stage: 'coordinate', ring, pixel, inSlot: inRing.length, best: leaf(b, d), second: sec, margin, candidates: basins.length,
        why: `the slot ${pixel}${ring ? ` (+${ring})` : ''} holds ${inRing.length} basin${inRing.length === 1 ? '' : 's'} but the nearest is beyond τ_attach ${th.tau_attach} (d ${d}) — the walk and the compressor disagree` };
      if (released) return { abstained: false, released: 'UNMEASURED', stage: 'released', ring, pixel, inSlot: inRing.length, leaf: leaf(b, d), second: sec, margin, walk: walkNums, candidates: basins.length,
        why: `the one door did not admit the prompt (gain ${walkNums.gain ?? '—'} / z ${walkNums.z ?? '—'}, needs 0.015 / ${walkNums.z_required ?? '—'}) — nearest basin in the slot released as context, UNMEASURED` };
      if (inRing.length === 1 || margin >= th.m_attach) return { abstained: false, stage: viaTargets ? 'targets' : 'coordinate', ring, pixel, inSlot: inRing.length, leaf: leaf(b, d), second: sec, margin, why: null, candidates: basins.length };
      return { abstained: true, stage: 'coordinate', ring, pixel, inSlot: inRing.length, best: leaf(b, d), second: sec, margin, candidates: basins.length,
        why: `${inRing.length} basins within ${ring} block of ${pixel} and the compressor cannot pick (margin ${margin} under m_attach ${th.m_attach})` };
    }
  }
  if (released && pb) return { abstained: true, stage: 'released', pixel, inSlot: 0, walk: walkNums, candidates: basins.length, why: `the slot ${pixel} holds no basin within ${reach} block — nothing to release` };
  const ranked = basins.map((n) => [n, dOf(n)]).sort((x, y) => x[1] - y[1]);
  const [b, d] = ranked[0]; const sec = ranked[1] ? leaf(ranked[1][0], ranked[1][1]) : null;
  const margin = sec ? +(sec.d - d).toFixed(4) : Infinity;
  if (d < th.tau_attach && margin >= th.m_attach) return { abstained: false, stage: 'ncd', ring: null, pixel: pixel || null, inSlot: 0, leaf: leaf(b, d), second: sec, margin, why: null, candidates: basins.length };
  return { abstained: true, stage: 'ncd', ring: null, pixel: pixel || null, inSlot: 0, best: leaf(b, d), second: sec, margin, candidates: basins.length,
    why: pb ? `no basin within ${reach} block of ${pixel}; by NCD ${d >= th.tau_attach ? `beyond τ_attach ${th.tau_attach}` : `margin ${margin} under m_attach ${th.m_attach}`}` : `prompt unplaced; by NCD ${d >= th.tau_attach ? `beyond τ_attach ${th.tau_attach}` : `margin ${margin} under m_attach ${th.m_attach}`}` };
}

// ── C52e-gate RESLOT: the tape leaves that predate the basins, walked by the one door against the basins as targets
// (C52f) and SLOTTED where the door admits them — the leaf stays (its hash, its place, its history: AXIOM 1) and is
// marked `slotted: {basin, at, pixel}`; the basin gains the leaf's text as a snippet marked `reslot: true`. A slotted
// leaf is excluded from seeding and the rail (its mass now reads under its basin). Receipt per run in the roots ledger.
export function reslot(tree, { walk = true, pixelOf = null, targets = SPEC_TARGETS, at = new Date().toISOString(), by = process.env.VNA_BY || 'cli', limit = Infinity } = {}) {
  const N = tree.nodes; const basins = Object.values(N).filter((n) => n.basin && !n.retracted && n.pixel);
  const byCell = new Map(); for (const b of basins) (byCell.get(b.pixel) || byCell.set(b.pixel, []).get(b.pixel)).push(b);
  const leaves = Object.values(N).filter((n) => n.id !== 'root' && !n.basin && !n.retracted && !n.slotted && n.type !== 'section' && !n.children.length && n.content && n.content.text.length >= NCD_MIN_CHARS);
  let walked = 0, admitted = 0, slotted = 0, released = 0, noBasin = 0, noPixel = 0, tie = 0, byLabel = 0, byCells = 0; const into = {};
  for (const n of leaves.slice(0, limit)) {
    const px = pixelOf ? pixelOf(n.content.text, `reslot:${n.id}`) : walkPixel(n.content.text, `reslot:${n.id}`, walk, { targets }); walked++;
    if (!px || !px.pixel || !blkOf(px.pixel)) { noPixel++; continue; }
    // C58: an unadmitted walk keeps its pixel and is RELEASED into the nearest basin in ring 0 then +1, marked UNMEASURED
    // (the same release as C53b / ingest above); an admitted walk stays ring 0, as before
    const rel = !px.admissible; if (!rel) admitted++;
    let cands = byCell.get(px.pixel) || [], ring = 0;
    if (!cands.length && rel) { const pb = blkOf(px.pixel); cands = basins.filter((c) => { const cb = blkOf(c.pixel); return cb && chebOf(cb, pb) === 1; }); ring = 1; }
    if (!cands.length) { noBasin++; continue; }
    // the compressor reads every candidate (one gzip each) so the snippet always carries its d — a released row with no d
    // was a placement with no reading; with several basins in the cell the margin decides, and a thin one is a tie
    const cS = gz(n.content.text); const ranked = cands.map((c) => { const cN = c.mass && c.mass.own ? c.mass.own.gzip : leafMass(c).own.gzip; const cSN = gz(c.content.text + '\n' + n.content.text); const [lo, hi] = cN < cS ? [cN, cS] : [cS, cN]; return [c, hi === 0 ? 0 : (cSN - lo) / hi]; }).sort((x, y) => x[1] - y[1]);
    let b = ranked[0][0], d = +ranked[0][1].toFixed(4), margin = ranked[1] ? +(ranked[1][1] - ranked[0][1]).toFixed(4) : null, viaLabel = null, viaCells = null;
    if (ranked[1] && ranked[1][1] - ranked[0][1] < thresholds().m_attach) {
      viaLabel = labelTiebreak(n.content.text, cands);   // C62: the label the chunk's own text names …
      if (!viaLabel) { const ct = cellTiebreak(px.cells, cands); if (ct.pick) viaCells = ct; else {   // … C64: else the lit cells with their null
        tie++; tree.unplacedSnips ||= []; if (!tree.unplacedSnips.some((u) => u.leaf === n.id)) tree.unplacedSnips.push({ at, leaf: n.id, via: 'reslot', hash: n.hash, chars: n.content.text.length, pixel: px.pixel, ring, why: `tie — margin ${(ranked[1][1] - ranked[0][1]).toFixed(4)} under m_attach ${thresholds().m_attach} among ${cands.length} basins in the cell, none named by label; lit cells: ${ct.why}`, cells: { overlaps: ct.overlaps, null: ct.null }, candidates: ranked.slice(0, 3).map(([c, dd]) => ({ id: c.id, label: c.meta && c.meta.label, d: +dd.toFixed(4) })) }); continue; } }
      b = viaLabel || viaCells.pick; d = +(ranked.find((x) => x[0] === b) || [null, d])[1].toFixed(4); if (viaLabel) byLabel++; else byCells++;
    }
    b.revisions.push({ kind: 'snippet', reslot: true, decision: n.type === 'decision' || undefined, at, hash: n.hash, text: n.content.text, meta: { ...(n.meta || {}), slot: { pixel: px.pixel, ring, inSlot: cands.length, via: 'reslot', ...(viaLabel ? { byLabel: b.meta.label } : {}), ...(viaCells ? { byCells: cellsReceipt(viaCells) } : {}), ...(rel ? { released: 'UNMEASURED', walk: { gain: px.gain ?? null, z: px.z ?? null, z_required: px.z_required ?? null, sensor: px.sensor } } : {}) } }, released: rel ? 'UNMEASURED' : undefined, ncd: d, margin, chars: n.content.text.length, gzip: n.mass && n.mass.own ? n.mass.own.gzip : gz(n.content.text) });
    b.revisions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)); leafMass(b);
    n.slotted = { basin: b.id, label: b.meta && b.meta.label, at, pixel: px.pixel, ring, released: rel ? 'UNMEASURED' : undefined, by }; slotted++; if (rel) released++; into[b.meta.label] = (into[b.meta.label] || 0) + 1;
  }
  computeMass(tree); laneReceipt(tree);
  const all = Object.values(N).filter((n) => n.id !== 'root');
  tree.counts.basins = all.filter((n) => n.basin).length; tree.counts.inBasins = all.filter((n) => n.basin).reduce((a, n) => a + (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted).length, 0);
  tree.counts.released = all.filter((n) => n.basin).reduce((a, n) => a + (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted && r.released).length, 0);
  tree.counts.emptyBasins = all.filter((n) => n.basin && !n.retracted && !(n.revisions || []).some((r) => r.kind === 'snippet' && !r.retracted)).length;
  // C62's finding: "empty" was the wrong sufficiency for "dead" — a basin with no paste but a commit attested to it (C43) is alive
  // by the record. DEAD = no snippet AND no attestation; that is the number the C58 done-when is read against.
  tree.counts.abstained = (tree.unplacedSnips || []).length;
  tree.counts.deadBasins = all.filter((n) => n.basin && !n.retracted && !(n.revisions || []).some((r) => r.kind === 'snippet' && !r.retracted) && !attestationsForLabel(n.meta && n.meta.label, ATTESTATIONS, 1).length).length;
  return { leaves: leaves.length, walked, admitted, released, byLabel, byCells, noPixel, noBasin, tie, slotted, into, emptyBasins: tree.counts.emptyBasins, deadBasins: tree.counts.deadBasins };
}

// ── C64 REWALK THE BASINS: the C63 row found 74 of 75 basins carrying no lit cells (their walk predates `cells` on the
// row). Every basin is walked once more by the one door against the SAME targets the chunks are walked against, and
// its walk (cells · trajectory · pixel · admissibility · axes_sha) is stored on n.walk with rewalkedAt. n.pixel is NEVER
// rewritten here — the projection stays where the spec's walk put it (ShortLex preserved); the re-walk's own pixel sits
// on the walk, said, so a moved one is visible and never silently adopted. A basin already carrying cells is skipped
// unless forced. One walk per basin, bounded by the door's timeout.
export function rewalkBasins(tree, { walk = true, pixelOf = null, targets = SPEC_TARGETS, at = new Date().toISOString(), force = false, limit = Infinity } = {}) {
  const basins = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted);
  let walked = 0, skipped = 0, noCells = 0, moved = 0;
  for (const n of basins.slice(0, limit)) {
    if (!force && n.walk && Array.isArray(n.walk.cells) && n.walk.cells.length) { skipped++; continue; }
    const px = pixelOf ? pixelOf(n.content.text, `rewalk:${n.id}`) : walkPixel(n.content.text, `rewalk:${n.id}`, walk, { targets: existsSync(targets) ? targets : null }); walked++;
    if (!px || !Array.isArray(px.cells) || !px.cells.length) noCells++;
    if (px && px.pixel && n.pixel && px.pixel !== n.pixel) moved++;
    n.walk = { ...px, rewalkedAt: at, projected: n.pixel || null };
    if (!n.pixel && px && px.pixel) n.pixel = px.pixel;   // a basin with no pixel at all takes one; a placed one never moves
  }
  const withCells = basins.filter((n) => n.walk && Array.isArray(n.walk.cells) && n.walk.cells.length).length;
  return { basins: basins.length, walked, skipped, noCells, moved, withCells };
}

// ── C52e RENDER: the spec's declared rows written FROM THE TREE (nodes → md), never md → nodes. One line per basin
// in label order: state · label · text · then the tree's own reading of it — slotted chunks, decisions, versions,
// the commits that satisfied it (C43), the walk's cell. docs/specs/vna/SPEC-FROM-TREE.md. The prose sections of
// SPEC-VNA-COCKPIT.md are not in the tree and are not rendered here — that residual is written on the C52e row.
// ── C53c THE BORNE-OUT COLUMN (operator 2026-09-18: "a way to inspect the specification top-down so you know what's
// actually built, what's working, what's been borne out … whether they beat the null"). One typed state per row, READ FROM
// RECEIPTS, never from the row's prose: the registry (data/vna/borne-out-receipts.json) names the receipt that graded a
// row, the JSON path of its verdict and the verdict→state map; the renderer opens the receipt. Below the registry the state
// is structural: DECLARED (unticked), BUILT (ticked, no guard file on disk), GUARDED (ticked, the row's named guard exists).
// A registry row whose receipt is missing or whose verdict maps to nothing renders UNMEASURED with the path — absence and
// measured-nothing are opposite claims and the column never makes the first look like the second.
export const BORNE_OUT = process.env.VNA_BORNE_OUT || resolve(REPO, 'data/vna/borne-out-receipts.json');
export const BORNE_STATES = ['DECLARED', 'BUILT', 'GUARDED', 'MEASURED', 'MEASURED-HELD', 'MEASURED-BROKEN', 'UNDERPOWERED', 'NOT-WORTH-A-BOUNDARY', 'UNMEASURED'];
export function loadBorneRegistry(path = BORNE_OUT) { try { const j = JSON.parse(readFileSync(path, 'utf8')); delete j._; return j; } catch { return {}; } }
// ONE PARSER: the same regex spec-check.mjs uses (`guard:` or bare `guard` before the backticks) — a stricter copy here read C35
// and C37 as BUILT on the first render when both name a guard that exists (2026-09-18); two parsers for one syntax is the C12 defect.
// Exported (C178) so steer-ui.mjs's HEAD-vs-working-tree painter reads the same guard path off the same row text — a third
// copy of this regex is exactly the C12 defect the comment above names.
export const guardOf = (text) => { const m = /\bguard[:s]?\s*`([^`]+)`/i.exec(String(text || '')); return m ? m[1].trim() : null; };
export function borneOut(label, node, { registry = loadBorneRegistry(), repo = REPO } = {}) {
  const done = !!(node && node.meta && node.meta.done); const text = node && node.content ? node.content.text : '';
  const reg = registry[label];
  if (reg) {
    const rp = resolve(repo, reg.receipt); let j = null; try { j = JSON.parse(readFileSync(rp, 'utf8')); } catch {}
    if (!j) return { state: 'UNMEASURED', receipt: reg.receipt, verdict: null, why: 'receipt missing or unreadable' };
    const v = String(reg.at || 'verdict').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), j);
    if (v == null) return { state: 'UNMEASURED', receipt: reg.receipt, verdict: null, why: `no ${reg.at} in the receipt` };
    if (typeof v === 'object') return { state: 'UNMEASURED', receipt: reg.receipt, verdict: JSON.stringify(v).slice(0, 80), why: `${reg.at} is an object, not a verdict — name a leaf field` };
    for (const [re, st] of reg.map || []) if (new RegExp(re, 'i').test(String(v))) return { state: BORNE_STATES.includes(st) ? st : 'UNMEASURED', receipt: reg.receipt, verdict: String(v).slice(0, 80), why: null };
    return { state: 'UNMEASURED', receipt: reg.receipt, verdict: String(v).slice(0, 80), why: 'verdict maps to no state' };
  }
  if (!done) return { state: 'DECLARED', receipt: null, verdict: null, why: null };
  const g = guardOf(text);
  if (g && existsSync(resolve(repo, g))) return { state: 'GUARDED', receipt: g, verdict: null, why: null };
  return { state: 'BUILT', receipt: null, verdict: null, why: g ? `named guard ${g} not on disk` : 'no guard named' };
}
// ── C98g THE RELEASED ASK IS A PENDING ROW (operator 2026-09-19: "make it happen automatically next time"). Row 307 folded
// six nodes and RELEASED nine of twelve asks (C58) as UNMEASURED snippets on basins by pixel — retained (AXIOM 1) but invisible
// AS ASKS: the spec was not updated by the fold and the basin C98 had to be declared by hand. So every released snippet of a
// CLIP row from the floor row on is DERIVED here as a pending ask `P<row>.<k>` (k = the snippet's order in its row, by byte
// offset; retracted snippets keep their number and are not listed, so an id never moves). Two doors out, both in spec-check.mjs:
// `declare <id> --as <Cn>` writes the snippet text as a sub-row under Cn in SPEC-VNA-COCKPIT.md stamped `from pending <id>` —
// the basin then names the id and it stops pending; `dismiss <id> --why` is a `pending-dismiss` row on the amendments ledger.
// The render below is derived and is the ONLY place the pending list is written; nothing here touches the hand spec.
// THE FLOOR ROW: 307 is the row this rule was declared against; the released mass of the 300-odd rows before it is the C98
// confession, already read on that basin, and re-listing ~2,600 old snippets as asks would be a wall nobody reads. The floor is
// a knob (VNA_PENDING_FROM_ROW) so a fixture can start at 0.
export const PENDING_FROM_ROW = () => { const n = Number(process.env.VNA_PENDING_FROM_ROW); return Number.isFinite(n) ? n : 307; };
// ── C98k THE INSTRUMENT'S OWN OUTPUT IS NEVER A PENDING ASK (2026-09-20: 26 of 190 PENDING rows were the chair's receipt blocks,
// hook lines and grading prose clipped back into the steer file). ONE table, line-start markers: a clip chunk whose text begins
// with one is typed `echo` at the fold — slotted and retained like any chunk (AXIOM 1), placed, but `released` is never set, so
// pendingAsks never lists it and the hook's ⟦ PENDING ⟧ count drops by reading pendingAsks alone. An echo KEEPS its k in the
// row's numbering (an id never moves — P333.7 stays P333.7 when P333.6 is re-typed). Earlier folds' released echoes are re-typed
// by retypeEchoes on the next fold (idempotent; what it was stays on the record). The hook carries no second regex.
export const ECHO_MARKERS = ['─── 🛰️ Lens', '⟦ ', 'Sidecar note', '**Delta:**', '**Landed', '**KEPT', '**CORRECTED', '**REFUSED', '🎩 ', 'Lens: ', 'Fit: ', 'Encircled: ', 'Trajectory:', '📋 GRIP', '⚖️ the', '🧩 TEMPLATE', 'Top N for this turn'];
export const echoMarkerOf = (text) => { const t = String(text || '').replace(/^\s+/, ''); return ECHO_MARKERS.find((m) => t.startsWith(m)) || null; };
export const isEcho = (text) => echoMarkerOf(text) != null;
export function retypeEchoes(tree, { at = new Date().toISOString() } = {}) {
  let n = 0;
  for (const b of Object.values(tree.nodes)) {
    if (!b.basin) continue;
    for (const r of b.revisions || []) {
      if (r.kind !== 'snippet' || r.type === 'echo' || !r.meta || r.meta.via !== 'clip') continue;
      const m = echoMarkerOf(r.text); if (!m) continue;
      r.retyped = { at, was: r.released || null, type: r.type || null, marker: m }; r.type = 'echo'; r.cue = m; delete r.released; delete r.decision; n++;
    }
  }
  return n;
}
// ── C107b A SEPARATOR OR A BLANK IS NOT AN ASK (operator 2026-09-20: "if pastes dont work right that would explain this"). Measured on the
// live PENDING: P564.2 was `------------------------------------------------`, P393.1 `{\rtf1\ansi…`, P393.2 `\f0\fs34 \cf2 That` — a rule
// and RTF control words released as asks, so the human never ran declare. ONE table of deterministic classes beside ECHO_MARKERS:
// `blank` (no letter or digit at all — whitespace, a rule, punctuation), `rtf-control` (an RTF header, or a chunk that opens with a
// control word and carries two or more). A clip chunk in a class is typed `junk` at ingest with the class as its cue — folded and
// retained like any chunk (AXIOM 1), placed, `released` never set, so pendingAsks never lists it; it KEEPS its k (an id never moves).
// retypeJunk re-types earlier folds' released junk on the next fold, idempotent, `retyped` on the record. The hook carries no copy.
export const JUNK_CLASSES = ['blank', 'rtf-control'];
const RTF_CONTROL_WORD = /\\[a-zA-Z]+-?\d*/g;
export function junkClassOf(text) {
  const t = String(text || '');
  if (!/[\p{L}\p{N}]/u.test(t)) return 'blank';
  if (/^\s*\{\\rtf1\b/.test(t)) return 'rtf-control';
  if (/^\s*\\[a-zA-Z]+-?\d*/.test(t) && (t.match(RTF_CONTROL_WORD) || []).length >= 2) return 'rtf-control';
  return null;
}
export const isJunk = (text) => junkClassOf(text) != null;
export function retypeJunk(tree, { at = new Date().toISOString() } = {}) {
  let n = 0;
  for (const b of Object.values(tree.nodes)) {
    if (!b.basin) continue;
    for (const r of b.revisions || []) {
      if (r.kind !== 'snippet' || r.type === 'echo' || r.type === 'junk' || !r.meta || r.meta.via !== 'clip') continue;
      const c = junkClassOf(r.text); if (!c) continue;
      r.retyped = { at, was: r.released || null, type: r.type || null, junk: c }; r.type = 'junk'; r.cue = c; delete r.released; delete r.decision; n++;
    }
  }
  return n;
}
export const NEVER_PENDS = (r) => r.type === 'echo' || r.type === 'junk';   // the two typed classes that hold their k and never list (C98k, C107b)
// ── C107c PROVENANCE ON THE CHUNK (operator 2026-09-20). The clip watcher reads the clipboard and cannot tell who wrote what it
// holds (the clip watcher's own receipt file: source = the steer file, why = clip — no author, and it is not made to pretend). Measured:
// P684.1–13, P685.1–5, P691.2–5 were the chair's own replies pending as asks. WHO wrote a chunk is read off the RECORD: the
// ledger's transcript rows (C72: via transcript, who operator|assistant) are the corpus — a chunk whose folded text sits inside an
// assistant row is `assistant`, inside an operator prompt `operator`, each `via: record`. A chunk that BEGINS with one of the
// chair's reply openers (ASSISTANT_STEMS, one table, line-start like ECHO_MARKERS) is `assistant` `via: stem`, the stem on the
// record so a reader can tell the two readings apart. Anything else is UNMEASURED — never guessed — and stays able to pend.
// An assistant chunk is typed echo (cue `assistant:<via>`), folded and placed, never released. `prov` rides on the snippet's meta.
export const ASSISTANT_STEMS = ["I'll ", "I've ", 'I ran ', 'I read ', 'Short answer:', 'Done, in ', 'Done — ', 'Done.', 'Verified.', 'Committed.', 'Declared and committed', 'One confession:', 'Not done, named', 'Still open, named', 'The snowball says', 'Guard tests/', 'Now the reconciliation', 'Two commits landed', 'Three commits landed', 'Landed:', 'Read receipts first'];
// the chair writes its openers in markdown bold (`**Short answer:**`, `**Not done, named:**`) — the emphasis is dropped before the stem is read
export const assistantStemOf = (text) => { const t = String(text || '').replace(/^\s+/, '').replace(/^(?:\*\*|\*|__|_|#{1,6}\s*)+/, ''); return ASSISTANT_STEMS.find((m) => t.startsWith(m)) || null; };
const foldText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export const PROV_MIN_CHARS = 40;   // under this a substring match is a phrase anyone could have typed
export function transcriptCorpus(ledger = LEDGER) {
  const out = { assistant: [], operator: [], rows: 0 };
  if (!ledger || !existsSync(ledger)) return out;
  scanLines(ledger, (l) => {   // flat read — the ledger is ~400 MB; one string of it per fold was half the fold's peak (2026-09-23)
    let r = null; try { r = JSON.parse(l); } catch { return; }
    if (!r || r.via !== 'transcript' || !r.text) return;
    const t = foldText(r.text); if (!t) return;
    if (r.who === 'assistant') out.assistant.push(t); else if (r.who === 'operator') out.operator.push(t); else return;
    out.rows++;
  });
  return out;
}
export function provenanceOf(text, corpus) {
  const t = foldText(text);
  if (corpus && t.length >= PROV_MIN_CHARS) {
    if ((corpus.assistant || []).some((a) => a.includes(t))) return { who: 'assistant', via: 'record' };
    if ((corpus.operator || []).some((o) => o.includes(t))) return { who: 'operator', via: 'record' };
  }
  const stem = assistantStemOf(text);
  if (stem) return { who: 'assistant', via: 'stem', stem };
  return { who: 'UNMEASURED', via: null };
}
// earlier folds' clip snippets: stamp prov on each once; an assistant one that was released is re-typed echo (idempotent)
export function retypeAssistant(tree, corpus, { at = new Date().toISOString() } = {}) {
  let n = 0, stamped = 0;
  for (const b of Object.values(tree.nodes)) {
    if (!b.basin) continue;
    for (const r of b.revisions || []) {
      if (r.kind !== 'snippet' || !r.meta || r.meta.via !== 'clip' || (r.meta.prov && r.meta.prov.who !== 'UNMEASURED')) continue;   // UNMEASURED is not a decision: re-read on every fold
      const prov = provenanceOf(r.text, corpus); if (!r.meta.prov) stamped++; r.meta.prov = prov;
      if (prov.who !== 'assistant' || r.type === 'echo' || r.type === 'junk') continue;
      r.retyped = { at, was: r.released || null, type: r.type || null, prov }; r.type = 'echo'; r.cue = `assistant:${prov.via}`; delete r.released; delete r.decision; n++;
    }
  }
  return { retyped: n, stamped };
}
// ── C98i THE SNOWBALL GRADES ITS OWN DRIFT (operator 2026-09-19: "there are many directions in the txt files that drift from the
// canonical right decision in the repo, perfect for the snowball sensors to make sense of"). A snippet on a basin whose type is
// intent or decision is a DIRECTION and starts UNGRADED. The bundle prints each under the row (`direction · UNGRADED · <hash8> —
// <headline>`) so a worker booted from the leaf sees the drifting direction beside the decided text; `grade()` writes
// {kind:'grade', at, hash, grade, why, by} onto the node's revisions — retained, never deleted, a REFUSED stays with its why — and a
// `grade` row on the amendments ledger. A grade is a JUDGMENT: the sensor finds the drift, the worker names it; nothing here infers
// one from NCD. An echo (C98k) is never a direction. Older snippets carry no `type`; it is re-read by the same typeOf, so the
// reading is deterministic either way.
export const GRADES = ['KEPT', 'CORRECTED', 'REFUSED'];
export const snippetType = (r) => r.type || (r.decision ? 'decision' : typeOf(r.text ?? r.excerpt ?? '').type);
export const isDirection = (r) => r.kind === 'snippet' && !r.retracted && (r.type === 'intent' || r.type === 'decision' || (!r.type && (r.decision || typeOf(r.text).type === 'intent')));
export function directions(tree, id) {
  const n = tree.nodes[id]; if (!n || !n.basin) return [];
  const revs = n.revisions || [];
  const gradesFor = (hash) => revs.filter((g) => g.kind === 'grade' && g.hash === hash).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return revs.filter(isDirection).map((r) => { const gs = gradesFor(r.hash); const g = gs.length ? gs[gs.length - 1] : null; return { hash: r.hash, hash8: String(r.hash).slice(0, 8), type: snippetType(r), headline: headline(r.text ?? r.excerpt ?? ''), text: r.text ?? r.excerpt ?? '', at: r.at, row: r.meta && r.meta.row, via: r.meta && r.meta.via, released: r.released || null, grade: g ? { grade: g.grade, why: g.why, at: g.at, by: g.by } : null, grades: gs.length }; })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
export const directionLine = (d) => `direction · ${d.grade ? d.grade.grade : 'UNGRADED'} · ${d.hash8} — ${d.headline}${d.grade ? ` — ${d.grade.why}` : ''}`;
export function ungraded(tree, { leaf = null } = {}) {
  const ids = leaf ? [leaf] : Object.values(tree.nodes).filter((n) => n.basin && !n.retracted).map((n) => n.id);
  const byLeaf = [];
  for (const id of ids) { const n = tree.nodes[id]; if (!n) continue; const U = directions(tree, id).filter((d) => !d.grade); if (U.length) byLeaf.push({ id, label: n.meta && n.meta.label, ungraded: U }); }
  return { total: byLeaf.reduce((a, l) => a + l.ungraded.length, 0), byLeaf, leaves: byLeaf.length };
}
export function grade(tree, id, hash8, verdict, { why = '', by = process.env.VNA_BY || 'cli', at = new Date().toISOString(), ledger = LEDGER } = {}) {
  const n = tree.nodes[id];
  if (!n || !n.basin) return { ok: false, why: `no basin ${id} on the tree — name a leaf like n_spec_C98i` };
  if (!GRADES.includes(verdict)) return { ok: false, why: `grade must be one of ${GRADES.join('|')} (got ${JSON.stringify(verdict)})` };
  if (!why || !String(why).trim()) return { ok: false, why: `a grade without --why is a deletion, not a decision (AXIOM 1: the reason is the record) — ${id} ${hash8}` };
  const D = directions(tree, id).filter((d) => d.hash.startsWith(String(hash8 || '')));
  if (!hash8 || !D.length) return { ok: false, why: `no direction ${hash8 || '(none)'} on ${id} — ${directions(tree, id).length} direction(s) there: ${directions(tree, id).map((d) => d.hash8).join(' ') || 'none'}` };
  if (D.length > 1) return { ok: false, why: `ambiguous — ${D.length} directions on ${id} start with ${hash8}: ${D.map((d) => d.hash8).join(' ')}` };
  const d = D[0]; const row = { kind: 'grade', at, hash: d.hash, grade: verdict, why: String(why).trim(), by };
  n.revisions.push(row); n.revisions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  if (ledger) { try { mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify({ at, source: 'grade', status: 'graded', kind: 'grade', node: id, basin: n.meta && n.meta.label, hash: d.hash, grade: verdict, why: row.why, by, was: d.grade ? d.grade.grade : null, text: d.text }) + '\n'); } catch {} }
  return { ok: true, node: id, basin: n.meta && n.meta.label, hash: d.hash, hash8: d.hash8, grade: verdict, why: row.why, at, by, regraded: !!d.grade, headline: d.headline };
}
export function instrumentEchoes(tree) {
  const out = [];
  for (const b of Object.values(tree.nodes)) {
    if (!b.basin || b.retracted) continue;
    for (const r of b.revisions || []) if (r.kind === 'snippet' && r.type === 'echo' && !r.retracted) out.push({ basin: b.meta && b.meta.label, basinId: b.id, row: r.meta && r.meta.row, hash8: String(r.hash).slice(0, 8), marker: (r.retyped && r.retyped.marker) || r.cue || echoMarkerOf(r.text), at: r.at, headline: headline(r.text), retyped: !!r.retyped });
  }
  return out.sort((a, b) => (a.row - b.row) || ((a.at < b.at) ? -1 : a.at > b.at ? 1 : 0));
}
export const PENDING_ID_RE = /\bfrom pending (P\d+\.\d+)\b/g;
// C98i · THE LEDGER IS THE RECORD, THE TREE IS DERIVED: every --grade appends a ledger row AND rewrites spec-tree.json whole, and so
// does every fold and every other grader — two writers on one file lose the later reader's grades (seen 2026-09-20: 140 grade rows
// on the ledger, 106 on the tree, 18 of one grader's lost to a concurrent write). The fold replays every ledger grade row that is not
// on its node — keyed on (node, hash, at), idempotent, so a lost grade heals on the next fold and a replayed one is never doubled.
export function replayGrades(tree, ledger = LEDGER) {
  if (!ledger || !existsSync(ledger)) return { replayed: 0, present: 0, orphan: 0 };
  let replayed = 0, present = 0, orphan = 0;
  scanLines(ledger, (l) => {   // flat read — never the ~400 MB ledger as one string
    let r = null; try { r = JSON.parse(l); } catch { return; }
    if (!r || r.kind !== 'grade' || !r.node || !r.hash || !r.at) return;
    const n = tree.nodes[r.node]; if (!n || !n.basin) { orphan++; return; }
    n.revisions = n.revisions || [];
    if (n.revisions.some((g) => g.kind === 'grade' && g.hash === r.hash && g.at === r.at)) { present++; return; }
    n.revisions.push({ kind: 'grade', at: r.at, hash: r.hash, grade: r.grade, why: r.why, by: r.by, replayed: true });
    n.revisions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)); replayed++;
  });
  return { replayed, present, orphan };
}
// C165b — the ledger is 319 MB and steer-hook asks this question ONCE PER PROMPT. A dismissal can sit
// anywhere in history, so every row must still be read; what must not happen is holding all of them.
// scanLines gives the same answer at flat memory (chunked, one line at a time) — before this, each
// prompt allocated a 319 MB string plus ~1M strings from the split.
export function pendingDismissals(ledger = LEDGER) {
  if (!ledger || !existsSync(ledger)) return [];
  const out = [];
  scanLines(ledger, (l) => {
    if (l.indexOf('"pending-dismiss"') === -1) return;   // a cheap prefilter on the WHOLE line; the parse below is what decides
    let r = null; try { r = JSON.parse(l); } catch { return; }
    if (r && r.kind === 'pending-dismiss' && r.pending) out.push({ id: r.pending, hash: r.hash || null, why: r.why || '', at: r.at });
  });
  return out;
}
// specMd: the hand spec's text, read directly when the caller has it (spec-check, the hook) — a row declared a second ago names its
// pending id before the next fold folds it into a basin; the tree alone would still list it.
export function pendingAsks(tree, { fromRow = PENDING_FROM_ROW(), ledger = LEDGER, specMd = null } = {}) {
  const byRow = new Map();
  const basins = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted);
  const declared = new Set([...String(specMd || '').matchAll(PENDING_ID_RE)].map((m) => m[1]));
  for (const n of basins) {
    for (const m of String(n.content && n.content.text || '').matchAll(PENDING_ID_RE)) declared.add(m[1]);
    for (const r of n.revisions || []) {
      // the numbering: every snippet that IS released, plus an echo/junk that WOULD have been (typed at ingest on an unadmitted walk — meta.slot.released)
      // or WAS (retyped.was) — it holds its k, never lists (C98k, C107b). An admitted attach re-typed later never held a k and never enters (FOUND 2026-09-20:
      // row 674's admitted "Second 0" chunk, re-typed junk, shifted P674.3/.4 by one until this line).
      if (r.kind !== 'snippet' || !r.meta || r.meta.via !== 'clip') continue;
      if (!(r.released || (NEVER_PENDS(r) && ((r.retyped && r.retyped.was) || (r.meta.slot && r.meta.slot.released))))) continue;
      const row = Number(r.meta.row); if (!Number.isFinite(row) || row < fromRow) continue;
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push({ r, basin: n.meta.label, basinId: n.id });
    }
  }
  // a dismissal is matched by the snippet's HASH when the row carries one (the id is an address, the hash is the thing — 16 rows written
  // on 2026-09-20 under a numbering that C107b's retype had shifted by one still land on the snippet they dismissed); by id only when it does not
  const dismissedRows = pendingDismissals(ledger); const dismissed = new Set(dismissedRows.filter((d) => !d.hash).map((d) => d.id)); const dismissedHash = new Set(dismissedRows.filter((d) => d.hash).map((d) => d.hash));
  const pending = [], held = []; const gone = { declared: [], dismissed: [] };
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const list = byRow.get(row).sort((a, b) => (a.r.meta.offsetFrom ?? 0) - (b.r.meta.offsetFrom ?? 0) || String(a.r.hash).localeCompare(String(b.r.hash)));
    list.forEach(({ r, basin, basinId }, i) => {
      const id = `P${row}.${i + 1}`;
      if (declared.has(id)) { gone.declared.push(id); return; }
      if (dismissed.has(id) || dismissedHash.has(r.hash)) { gone.dismissed.push(id); return; }
      if (r.retracted) return;
      // C107d: an echo/junk that an earlier fold RELEASED and a later fold re-typed (C98k/C107b/C107c) holds its k and is listed as held
      // — the class the fold read, so triage --apply can write the decision to the ledger; once dismissed there it is gone.dismissed
      if (NEVER_PENDS(r)) { if (r.retyped && r.retyped.was) held.push({ id, row, k: i + 1, basin, basinId, headline: headline(r.text), text: r.text, hash: r.hash, ncd: r.ncd, at: r.at, cue: r.cue, class: r.type === 'junk' ? (r.cue === 'rtf-control' ? 'rtf-junk' : 'separator') : r.retyped.marker ? 'instrument-echo' : 'assistant-echo', prov: r.meta.prov || null, retyped: r.retyped }); return; }
      pending.push({ id, row, k: i + 1, basin, basinId, headline: headline(r.text), text: r.text, hash: r.hash, ncd: r.ncd, at: r.at, walk: r.meta.slot && r.meta.slot.walk || null, prov: r.meta.prov || { who: 'UNMEASURED', via: null }, ring: r.meta.slot && r.meta.slot.ring, pixel: r.meta.slot && r.meta.slot.pixel || null });
    });
  }
  return { pending, held, declared: gone.declared, dismissed: gone.dismissed, fromRow, rows: [...byRow.keys()].sort((a, b) => a - b) };
}
export function renderPending(tree, opts = {}) {
  const P = pendingAsks(tree, opts);
  const L = ['## PENDING — released asks, not yet rows'];
  const left = `${P.declared.length} declared${P.declared.length ? ` (${P.declared.join(', ')})` : ''} · ${P.dismissed.length} dismissed${P.dismissed.length ? ` (${P.dismissed.join(', ')})` : ''}`;
  if (!P.pending.length) { L.push(`none pending from row ${P.fromRow} on · ${left} · derived by the fold (C98g); a released snippet of a clip row lists here until \`node scripts/vna/spec-check.mjs declare <id> --as <Cn>\` or \`dismiss <id> --why "…"\``); return L.join('\n') + '\n'; }
  L.push(`${P.pending.length} released ask${P.pending.length === 1 ? '' : 's'} from row${P.rows.length === 1 ? '' : 's'} ${[...new Set(P.pending.map((p) => p.row))].join(', ')} · ${left} · each was RELEASED by the fold (C58: nearest basin, UNMEASURED) and is NOT a row of the spec until declared — \`node scripts/vna/spec-check.mjs declare <id> --as <Cn>\` moves its text under that basin in SPEC-VNA-COCKPIT.md; \`dismiss <id> --why "…"\` writes the reason to the amendments ledger. Never edited here (C98g).`);
  for (const p of P.pending) L.push(`- [ ] ${p.id} ${p.headline} · prov ${p.prov.who} · basin ${p.basin} · d ${p.ncd}`);
  return L.join('\n') + '\n';
}
// ── C107d TRIAGE IS A DOOR (operator 2026-09-20: "pastes should be merkle spec snowball looped and run by subagents right?"). The
// C98g loop stopped at a human who never ran declare. The SCRIPT's verdicts are deterministic and LLM-free: `rtf-junk` (C107b's
// rtf-control), `separator` (C107b's blank), `assistant-echo` (C107c's provenance), `duplicate-of-<Cn>` (the fold's OWN d to its
// basin under TAU_DUP — the compressor already read it as the basin's text). Everything else is the RESIDUE: a real sentence with
// no deterministic verdict, printed as a proposal (declare --as the basin the fold computed, d and ring on the line) and as ONE
// brief for a headless worker (steer-runner.mjs --triage) whose only tools are declare|dismiss with --why verbatim from the text.
export const TAU_DUP = 0.70;   // the calibrated τ_attach (data/vna/spec-tree-floors.json, 2026-09-18)
export function triageVerdicts(P, { corpus = null, tau = TAU_DUP, limit = Infinity } = {}) {
  const verdicts = [], residue = []; const counts = { pending: P.pending.length, held: (P.held || []).length, 'rtf-junk': 0, separator: 0, 'assistant-echo': 0, 'instrument-echo': 0, duplicate: 0, residue: 0 };
  // the fold's own re-typings first: released once, re-typed since — the class is what the fold read, the ledger row is the decision
  for (const h of P.held || []) {
    const why = h.class === 'rtf-junk' ? 'rtf-junk: RTF control words, re-typed junk by the fold (C107b; C107a lands RTF as text now)' : h.class === 'separator' ? 'separator: a rule, a blank or punctuation, re-typed junk by the fold (C107b)' : h.class === 'instrument-echo' ? `instrument-echo: the instrument's own output (${h.cue}), re-typed echo by the fold (C98k)` : `assistant-echo: the chair's own reply (${h.cue}), re-typed echo by the fold (C107c)`;
    verdicts.push({ id: h.id, row: h.row, basin: h.basin, headline: h.headline, d: h.ncd, ring: null, pixel: null, prov: h.prov ? h.prov.who : 'UNMEASURED', hash: h.hash, verdict: 'dismiss', class: h.class, why, retyped: true }); counts[h.class]++;
  }
  for (const p of P.pending.slice(0, limit)) {
    const junk = junkClassOf(p.text);
    const prov = p.prov && p.prov.who !== 'UNMEASURED' ? p.prov : provenanceOf(p.text, corpus);
    let cls = null, why = null;
    if (junk === 'rtf-control') { cls = 'rtf-junk'; why = 'rtf-junk: RTF control words, not a sentence (C107a lands RTF as text now)'; }
    else if (junk === 'blank') { cls = 'separator'; why = 'separator: a rule, a blank or punctuation, not an ask (C107b)'; }
    else if (prov.who === 'assistant') { cls = 'assistant-echo'; why = `assistant-echo: the chair's own reply (${prov.via === 'stem' ? `opens with ${JSON.stringify(prov.stem)}` : 'inside an assistant transcript row'}), not an operator ask (C107c)`; }
    else if (typeof p.ncd === 'number' && p.ncd < tau) { cls = `duplicate-of-${p.basin}`; why = `duplicate-of-${p.basin}: the fold read it at d ${p.ncd} < τ ${tau} against that basin's own text`; }
    const base = { id: p.id, row: p.row, basin: p.basin, headline: p.headline, d: p.ncd, ring: p.ring ?? null, pixel: p.pixel || null, prov: prov.who, hash: p.hash };
    if (cls) { verdicts.push({ ...base, verdict: 'dismiss', class: cls, why }); counts[cls.startsWith('duplicate-of-') ? 'duplicate' : cls]++; }
    else { verdicts.push({ ...base, verdict: 'declare', class: null, as: p.basin, why: null, residue: true }); residue.push({ ...base, as: p.basin, text: p.text }); counts.residue++; }
  }
  return { verdicts, residue, counts, tau };
}
export const triageLine = (v) => v.verdict === 'dismiss'
  ? `dismiss ${v.id} --why ${JSON.stringify(v.why)}   # ${v.retyped ? 'held by the fold · ' : ''}${v.headline}`
  : `declare ${v.id} --as ${v.as}   # RESIDUE · d ${v.d} · ring ${v.ring ?? '—'} · prov ${v.prov} · ${v.headline}`;
export function triageBrief(residue, { spec = 'docs/specs/vna/SPEC-VNA-COCKPIT.md' } = {}) {
  const L = [`TRIAGE — ${residue.length} pending ask${residue.length === 1 ? '' : 's'} with no deterministic verdict (C107d). You are a cold worker with two tools and nothing else:`,
    '  node scripts/vna/spec-check.mjs declare <id> --as <Cn>      the text becomes a row under that basin, verbatim',
    '  node scripts/vna/spec-check.mjs dismiss <id> --why "…"      the reason goes to the amendments ledger; quote the ask in its own words',
    `Read each ask below against the basin the fold computed (its d and ring are the fold's own numbers, never a claim). Declare it under the basin`,
    'it belongs to when it is an ask the spec does not yet carry; dismiss it, with --why quoting the ask verbatim, when the spec already carries it',
    `(name the row) or it is not an ask. Never edit ${spec} by hand, never commit, never run anything else. One command per id, every id.`, ''];
  for (const r of residue) L.push(`── ${r.id} · basin ${r.as} · d ${r.d} · ring ${r.ring ?? '—'} · prov ${r.prov}\n${String(r.text).trim()}\n`);
  return L.join('\n');
}
export const SPEC_RENDER = process.env.VNA_SPEC_RENDER || resolve(REPO, 'docs/specs/vna/SPEC-FROM-TREE.md');
export function renderSpec(tree, { attestations = attestationsForLabel, registry = loadBorneRegistry(), pending = {} } = {}) {
  const basins = Object.values(tree.nodes).filter((n) => n.basin && !n.retracted);
  const key = (l) => { const m = /^([CT])(\d+)([a-z]?)$/.exec(l || ''); return m ? [m[1] === 'C' ? 1 : 0, Number(m[2]), m[3] ? m[3].charCodeAt(0) : 0] : [-1, 0, 0]; };
  basins.sort((a, b) => { const ka = key(a.meta.label), kb = key(b.meta.label); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
  const L = [];
  L.push('# SPEC — the declared rows, rendered from the tree (C52e)');
  L.push(`root ${String(tree.root).slice(0, 12)} · rows ≤ ${tree.watermark} · ${basins.length} rows · ${basins.filter((n) => n.meta.done).length} ticked · generated ${new Date().toISOString()} · never edited by hand: edit SPEC-VNA-COCKPIT.md or clip into the steer file; the fold re-renders this`);
  L.push('');
  for (const n of basins) {
    const snips = (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted); const decs = snips.filter((r) => r.decision);
    const versions = (n.revisions || []).filter((r) => r.kind === 'revision' && !r.retracted).length + 1;
    const att = attestations(n.meta.label);
    const sub = /^C\d+[a-z]$/.test(n.meta.label) ? '  ' : '';
    L.push(`${sub}- [${n.meta.done ? 'x' : ' '}] ${n.content.text}`);
    const bo = borneOut(n.meta.label, n, { registry });
    L.push(`${sub}  ↳ ${n.pixel ? `@ ${n.pixel}` : 'unplaced'} · ${snips.length} chunk${snips.length === 1 ? '' : 's'} slotted · ${decs.length} decision${decs.length === 1 ? '' : 's'} · ${versions} version${versions === 1 ? '' : 's'} · decided ${String(n.decidedAt || '').slice(0, 10)}${att.length ? ` · satisfied by ${att.map((a) => a.sha).join(', ')}` : ''} · borne-out: ${bo.state}${bo.receipt ? ` (${bo.receipt}${bo.verdict ? ` → ${bo.verdict}` : ''})` : ''}${bo.why ? ` — ${bo.why}` : ''}`);
  }
  L.push(''); L.push(renderPending(tree, pending).trimEnd());   // C98g: the released asks of clip rows, derived, never written into the hand spec
  return L.join('\n') + '\n';
}

// ── T11 RETRACT (§24): a row folded by mistake is MARKED, never erased ────────────────────────────
// Rows 33 and 35 (2026-09-17) were the spec itself and the old tail document wrapping it, folded before
// the clipboard rules landed: ~400 nodes of the declaration read back in as mass. `--retract <rowSha>`
// marks every node, revision, snippet, echo and drawer snip from that row `retracted: {at, by, why,
// rowSha}`. Hashes and the root are untouched (the Merkle history stays whole); the overview, the rail,
// --seed, --bundle and the ratchet exclude retracted material; the root carries a `retracted` tally.
// The tape row itself is never touched (AXIOM 1) and stays in `ingested`, so it is never re-folded.
export function retract(tree, rowShaOrPrefix, { why = 'retracted', by = process.env.VNA_BY || 'cli', at = new Date().toISOString() } = {}) {
  const pref = String(rowShaOrPrefix || '').trim();
  const matches = (tree.ingested || []).filter((s) => s.startsWith(pref));
  if (!pref || matches.length !== 1) return { ok: false, rowSha: null, nodes: 0, revisions: 0, echoes: 0, snips: 0, why: matches.length ? `ambiguous prefix — ${matches.length} ingested rows match` : 'no ingested row matches that sha' };
  const rowSha = matches[0]; const mark = { at, by, why, rowSha };
  let nodes = 0, revisions = 0, echoes = 0, snips = 0;
  for (const n of Object.values(tree.nodes)) {
    if (n.id === 'root') continue;
    if (n.meta && n.meta.rowSha === rowSha && !n.retracted) { n.retracted = mark; nodes++; }
    for (const r of n.revisions || []) if (r.meta && r.meta.rowSha === rowSha && !r.retracted) { r.retracted = mark; revisions++; }
    for (const e of (n.meta && n.meta.echoes) || []) if (e.rowSha === rowSha && !e.retracted) { e.retracted = mark; echoes++; }
  }
  for (const u of tree.unplacedSnips || []) if (u.rowSha === rowSha && !u.retracted) { u.retracted = mark; snips++; }
  const total = nodes + revisions + echoes + snips;
  tree.retractions ||= [];
  if (total) tree.retractions.push({ ...mark, nodes, revisions, echoes, snips });
  const all = Object.values(tree.nodes).filter((n) => n.id !== 'root');
  tree.retracted = { nodes: all.filter((n) => n.retracted).length, revisions: all.reduce((a, n) => a + (n.revisions || []).filter((r) => r.retracted).length, 0), echoes: all.reduce((a, n) => a + ((n.meta && n.meta.echoes) || []).filter((e) => e.retracted).length, 0), snips: (tree.unplacedSnips || []).filter((u) => u.retracted).length, rows: tree.retractions.map((r) => r.rowSha) };
  laneReceipt(tree);
  return { ok: true, rowSha, nodes, revisions, echoes, snips, why, total };
}

// ── THE OUTLINE the operator reads
export function outline(tree) {
  const N = tree.nodes; const out = [];
  const c = tree.counts;
  out.push(`SPEC TREE · ${tree.source}`);
  out.push(`root ${tree.root || '—'} · ${c.nodes} nodes (${c.leaves} leaves) · ${c.revisions} revisions · ${c.placed} placed · ${c.unmeasured} unmeasured${c.basins ? ` · ${c.basins} basins (${c.inBasins || 0} chunks slotted)` : ''}${tree.retracted && tree.retracted.nodes ? ` · retracted ${tree.retracted.nodes} nodes / ${tree.retracted.revisions} revisions (${tree.retracted.rows.length} rows)` : ''} · root unchanged since ${tree.rootSince || '—'} · rows ≤ ${tree.watermark}`);
  out.push('');
  const walkOut = (id, depth) => {
    const n = N[id];
    if (n.slotted) { out.push(`${'  '.repeat(depth)}${String(n.hash).slice(0, 8)} [slotted → ${n.slotted.label} @ ${n.slotted.pixel}] ${n.content.headline.slice(0, 40)}`); return; }
    if (n.retracted) { out.push(`${'  '.repeat(depth)}${String(n.hash).slice(0, 8)} [retracted ${String(n.retracted.at).slice(0, 10)} · ${n.retracted.why.slice(0, 50)}] ${n.content.headline.slice(0, 40)}`); return; }
    if (n.id !== 'root') {
      const px = n.pixel ? `${n.pixel} ${fullName(n.pixel)}` : (n.children.length ? '' : 'UNMEASURED');
      const lin = n.basin ? lineage(tree, n.id) : null;
      const rev = lin && (lin.decisions || lin.versions > 1) ? ` · ${lin.versions} version${lin.versions === 1 ? '' : 's'} · ${lin.decisions} decision${lin.decisions === 1 ? '' : 's'} in the slot · latest ${String(lin.latest.at).slice(0, 10)}` : n.revisions && n.revisions.length ? ` · rev ${n.revisions.length} (decided ${n.decidedAt})` : '';
      const hat = n.children.length ? '' : (n.reef ? (n.reef.hat ? ` · hat ${n.reef.hat}${n.reef.rules && n.reef.rules.length ? ` · rules ${n.reef.rules.map((r) => `«${r.name || r.text.slice(0, 24)}»`).join(' ')}` : ''}` : ' · hat unmeasured') : '');
      const ms = n.mass ? ` · ${n.mass.chars}→${n.mass.gzip} gz${n.mass.snippets ? ` · ${n.mass.snippets} snip` : ''}` : '';
      out.push(`${'  '.repeat(depth)}${String(n.hash).slice(0, 8)} [${n.type}${n.cue ? `:${n.cue}` : ''}] ${n.content.headline}${ms}${px ? ` · ${px}` : ''}${hat}${rev}${n.meta && n.meta.via === 'clip' ? ' · clip' : ''}`);
    }
    for (const ch of n.children) walkOut(ch, n.id === 'root' ? depth : depth + 1);
  };
  walkOut('root', 0);
  return out.join('\n') + '\n';
}

// ── THE RUN ───────────────────────────────────────────────────────────────────────────────────────
export function loadRows(ledger, source) { return loadRowsScanned(ledger, source).rows; }
// flat memory (scanLines, never one 400 MB string) and the global index it read through — the watermark sidecar's `scanned`.
// A row whose text cannot contain the source string is skipped unparsed; the exact r.source check still decides.
export function loadRowsScanned(ledger, source) {
  if (!existsSync(ledger)) return { rows: [], scanned: -1 };
  const rows = [], needle = JSON.stringify(String(source));
  const n = scanLines(ledger, (l, i) => { if (!l.includes(needle)) return; try { const r = JSON.parse(l); if (r && r.source === source) rows.push({ ...r, _i: i }); } catch {} });
  return { rows, scanned: n - 1 };
}

// C170a leg 1 — ONE WRITER: the fold claims the tree's lock before it reads the tree and releases it after it writes, whichever
// door spawned it (the hook's dispatch, the runner's gate 5, clip-ingest, a hand run). A live foreign fold is waited on for
// foldWaitMs (the CLI default; the hook's dispatch passes 0) and then refused — receipted, never a second writer.
export async function run(opts = {}) {
  const { treePath = TREE, foldLock = foldLockFor(treePath), foldWaitMs = Number(process.env.VNA_FOLD_WAIT_MS) || 0, by = process.env.VNA_BY || 'cli' } = opts;
  const claim = claimFoldLock(foldLock, { waitMs: foldWaitMs, by });
  if (!claim.ok) return { ok: false, held: true, heldBy: claim.heldBy, why: claim.why };
  try { return await runFold(opts); } finally { releaseFoldLock(foldLock); }
}
async function runFold({ pointer = POINTER, ledger = LEDGER, treePath = TREE, roots = ROOTS, spec = SPEC_BASINS, walk = true, reef = coordinateMass, by = process.env.VNA_BY || 'cli' } = {}) {
  let source = null;
  try { source = JSON.parse(readFileSync(pointer, 'utf8')).source || null; } catch {}
  if (!source) return { ok: false, why: 'no steer file set — node scripts/vna/steer-file.mjs set <path>' };
  { const d = derivedWhy(resolve(REPO, source)); if (d) return { ok: false, why: `fold refused: the steer file ${source} — ${d}; the live tree is left as it is (node scripts/vna/steer-file.mjs set <the .txt you write in>)` }; }   // C174: never swap the tree for its own render
  let tree = null;
  try { tree = JSON.parse(readFileSync(treePath, 'utf8')); } catch {}
  // a tree is FOR a source; a pointer that moved starts a fresh tree rather than grafting one file onto another.
  // C120a (2026-09-21, the incident): the IDE's follow-the-active-.txt re-pointed the loop at a blog scratchpad, then at the tree's own
  // .txt export, and this line REPLACED the 508-node, 1006-row tree with an empty one twice in five minutes — no copy anywhere (the
  // tree is gitignored). AXIOM 1: evict OR retain, never free. A tree that holds work is RETAINED beside the new one, named by its
  // source, before the pointer's tree takes the canonical path; pointing back restores it in one read instead of hours of walks.
  const moved = tree && tree.v === 1 && tree.source !== source;
  let retained = null;
  if (moved) {
    const kept = retainedTreePath(tree.source, treePath);
    try { if (Object.keys(tree.nodes || {}).length >= RETAIN_FLOOR) { writeFileSync(kept, JSON.stringify(tree)); retained = { path: kept, source: tree.source, nodes: Object.keys(tree.nodes).length, ingested: (tree.ingested || []).length }; } } catch {}
    let back = null; try { back = JSON.parse(readFileSync(retainedTreePath(source, treePath), 'utf8')); } catch {}
    tree = back && back.v === 1 && back.source === source ? back : null;   // the pointer came back to a source we retained → its tree returns whole
  }
  if (!tree || tree.v !== 1 || tree.source !== source) tree = emptyTree(source);
  // migration (one commit's worth): the hat + rules reading was stored as `mass`; it is `reef` now
  for (const n of Object.values(tree.nodes)) if (n.mass && 'hat' in n.mass) { n.reef = n.mass; delete n.mass; }
  const prevRoot = tree.root;
  const grades = replayGrades(tree, ledger);   // C98i: a grade lost to a concurrent tree write comes back from the ledger, never from memory
  // C52a: the spec's rows are folded FIRST, so this run's tape chunks can slot into a basin
  let bas = { added: 0, revised: 0, ticked: 0, addedIds: [], revisedIds: [], rows: 0 };
  if (spec) { let md = null; try { md = readFileSync(spec, 'utf8'); } catch {} if (md != null) bas = basins(tree, md, { specPath: spec, walk }); }
  const { rows, scanned } = loadRowsScanned(ledger, source);
  const res = ingest(tree, rows, { walk });
  res.addedIds = [...bas.addedIds, ...res.addedIds]; res.revisedIds = [...bas.revisedIds, ...res.revisedIds]; res.basins = bas;
  // hat + rules for every leaf that has none yet (new, revised, or ingested before this reader existed)
  const reefed = await reefPass(tree, { reef });
  const defs = await defsPass(tree);   // C59: definitions for every basin whose contract changed
  const json = JSON.stringify(tree, null, 1) + '\n';
  const txt = outline(tree);
  try { const tg = renderTargets(tree); if (tg.length) { mkdirSync(dirname(SPEC_TARGETS), { recursive: true }); const tj = JSON.stringify(tg); if (!(existsSync(SPEC_TARGETS) && readFileSync(SPEC_TARGETS, 'utf8') === tj)) writeFileSync(SPEC_TARGETS, tj); } } catch {}   // C52f
  try { if (spec && Object.values(tree.nodes).some((n) => n.basin)) { const md = renderSpec(tree); const prev = existsSync(SPEC_RENDER) ? readFileSync(SPEC_RENDER, 'utf8') : ''; if (prev.replace(/generated [^\n]*/, '') !== md.replace(/generated [^\n]*/, '')) writeFileSync(SPEC_RENDER, md); } } catch {}   // C52e
  const door = writeTree(tree, { treePath, scanned });   // C81a: tree · outline · tesseract state, one door
  const txtPath = treePath.replace(/\.json$/, '.txt');
  const same = !door.written.includes('tree');
  // the insertion row: who ran it, what it added. A no-op run appends nothing.
  const inserted = res.addedIds.length || res.revisedIds.length || (tree.root && tree.root !== prevRoot);
  if (inserted) {
    try { mkdirSync(dirname(roots), { recursive: true }); appendFileSync(roots, JSON.stringify({ at: new Date().toISOString(), source, root: tree.root, rows: tree.watermark + 1, nodes: tree.counts.nodes, revisions: tree.counts.revisions, nodesAdded: res.addedIds, revisionsAdded: res.revisedIds, by }) + '\n'); } catch {}
  }
  return { ok: true, source, tree, ...res, reefed, defs, grades, treePath, txtPath, rootChanged: tree.root !== prevRoot, rows: rows.length, by };
}

const tree_abst = (r) => (r.tree.unplacedSnips || []).length;
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await (async () => {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const walk = !argv.includes('--no-walk');
  // C165c: the ONE migration of the legacy one-object store into the append-only ndjson + offset index; receipted on the roots ledger
  if (argv.includes('--migrate-blobs')) {
    const r = migrateBlobs(TREE);
    console.log(asJson ? JSON.stringify(r) : `migrate-blobs · ${r.shas} legacy shas · ${r.appended} rows appended (${r.bytes} B) · store ${r.storeBytes} B · ${r.indexed} indexed · parity ${r.parity.ok}/${r.parity.checked} ok · ${r.parity.missing} missing · ${r.parity.bad} bad · legacy ${r.legacy} · ${r.ms} ms`);
    process.exit(r.parity.missing || r.parity.bad ? 4 : 0);
  }
  const pi = argv.indexOf('--proof');
  if (pi >= 0) {
    const id = argv[pi + 1];
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    const pr = proof(tree, id);
    if (!pr) { console.error(`no node ${id} in the tree`); process.exit(2); }
    const recomputed = verifyProof(pr);
    if (asJson) { console.log(JSON.stringify({ ...pr, recomputed, verified: recomputed === pr.root })); process.exit(recomputed === pr.root ? 0 : 1); }
    console.log(`node ${id} · leaf ${pr.hash}`);
    console.log(`timeline (ascending; the last line is content):`);
    for (const t of pr.timeline) console.log(`  ${t.at} · ${t.hash}${t.ncd != null ? ` · ncd ${t.ncd}` : ''}${t.archived ? ' · archived' : ' · DECIDED'}`);
    console.log(`path root-ward:`);
    for (const s of pr.path) console.log(`  ${s.parent} own ${s.own.slice(0, 12)} · ${s.before.length} before · ${s.after.length} after`);
    console.log(`root ${pr.root}`);
    console.log(`recomputed ${recomputed} · ${recomputed === pr.root ? 'VERIFIED' : 'MISMATCH'}`);
    process.exit(recomputed === pr.root ? 0 : 1);
  }
  if (argv.includes('--render')) {
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE}`); process.exit(2); }
    const md = renderSpec(tree); mkdirSync(dirname(SPEC_RENDER), { recursive: true }); writeFileSync(SPEC_RENDER, md); console.log(md.split('\n').slice(0, 2).join('\n')); console.log(`→ ${SPEC_RENDER}`); process.exit(0);
  }
  if (argv.includes('--rewalk-basins')) {
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE}`); process.exit(2); }
    const li = argv.indexOf('--limit'); const r = rewalkBasins(tree, { walk, force: argv.includes('--force'), limit: li >= 0 ? Number(argv[li + 1]) : Infinity });
    writeTree(tree, { treePath: TREE });
    try { appendFileSync(ROOTS, JSON.stringify({ at: new Date().toISOString(), kind: 'rewalk-basins', by: process.env.VNA_BY || 'cli', root: tree.root, ...r }) + '\n'); } catch {}
    if (asJson) { console.log(JSON.stringify(r)); process.exit(0); }
    console.log(`rewalk-basins (C64) · ${r.basins} basins · walked ${r.walked} · skipped (already lit) ${r.skipped} · no cells back ${r.noCells} · re-walk pixel differs from the projection ${r.moved} (the projection never moves) · with lit cells ${r.withCells}`);
    process.exit(0);
  }
  if (argv.includes('--reslot')) {
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE}`); process.exit(2); }
    const li = argv.indexOf('--limit'); const r = reslot(tree, { walk, limit: li >= 0 ? Number(argv[li + 1]) : Infinity });
    writeTree(tree, { treePath: TREE });
    // C165c: writeTree hands back only the texts it detached; the sensor's corpus is the basins' full pastes, seeked from the store
    try { attachRevisionText(tree, readBlobs(TREE, wantedShas(tree))); const tg = renderTargets(tree); if (tg.length) writeFileSync(SPEC_TARGETS, JSON.stringify(tg)); } catch {}
    try { appendFileSync(ROOTS, JSON.stringify({ at: new Date().toISOString(), kind: 'reslot', by: process.env.VNA_BY || 'cli', root: tree.root, ...r }) + '\n'); } catch {}
    if (asJson) { console.log(JSON.stringify(r)); process.exit(0); }
    console.log(`reslot · ${r.leaves} tape leaves · walked ${r.walked} · admitted by the door ${r.admitted} · released UNMEASURED ${r.released} (C58) · no pixel ${r.noPixel} · no basin within 1 block ${r.noBasin} · tie ${r.tie} · by label (C62) ${r.byLabel} · by lit cells (C64) ${r.byCells} · SLOTTED ${r.slotted} · empty of pastes ${r.emptyBasins} · DEAD (no paste, no attested commit) ${r.deadBasins} · into ${JSON.stringify(r.into)}`);
    process.exit(0);
  }
  if (argv.includes('--calibrate')) {
    let source = null; try { source = JSON.parse(readFileSync(POINTER, 'utf8')).source || null; } catch {}
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree || !source) { console.error('no tree or no steer file — run node scripts/vna/spec-tree.mjs first'); process.exit(2); }
    const c = calibrate(tree, loadRows(LEDGER, source));
    if (asJson) { console.log(JSON.stringify(c)); process.exit(c.ok ? 0 : 2); }
    if (!c.ok) { console.error(`calibrate refused — ${c.why}`); process.exit(2); }
    for (const r of c.sweep) console.log(`  τ ${r.tau_attach} · real ${r.real} (attach ${r.attach} · abstain ${r.abstain} · new ${r.new}) · null ${r.null} ± ${r.sd} · exceed ${r.exceedance} · ${r.ok ? 'admitted' : 'REFUSED by the null'}`);
    console.log(`calibrated · τ_attach ${c.seed.tau_attach} (seed) → ${c.chosen.tau_attach} (the loosest the shuffled null refuses) · ${FLOORS}`);
    process.exit(0);
  }
  if (argv.includes('--status')) {
    // C52d --status: every number from a receipt on disk; a missing receipt is said, never filled
    const st = status();
    if (asJson) { console.log(JSON.stringify(st)); process.exit(st.ok ? 0 : 2); }
    for (const l of st.lines) console.log(l);
    process.exit(st.ok ? 0 : 2);
  }
  if (argv.includes('--ratchet')) {
    let source = null; try { source = JSON.parse(readFileSync(POINTER, 'utf8')).source || null; } catch {}
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree || !source) { console.error('no tree or no steer file — run node scripts/vna/spec-tree.mjs first'); process.exit(2); }
    const r = ratchet(tree, loadRows(LEDGER, source));
    if (asJson) { console.log(JSON.stringify(r)); process.exit(0); }
    console.log(`ratchet · ${r.real.n} snips · real rate ${r.real.rate} (rev ${r.real.revision} · attach ${r.real.attach} · abstain ${r.real.abstain} · new ${r.real.new}) · null ${r.null.mean} ± ${r.null.sd} over K=${r.K} · exceedance ${r.exceedance}/${r.K}`);
    console.log(`  thresholds ${JSON.stringify(r.thresholds)} · ${r.moved ? `MOVED → ${JSON.stringify(r.floors.current)}` : r.why}`);
    process.exit(0);
  }
  const si = argv.indexOf('--seed');
  if (si >= 0) {
    const prompt = argv[si + 1] || '';
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    console.log(JSON.stringify(seedLeaf(tree, prompt)));
    process.exit(0);
  }
  const ri = argv.indexOf('--retract');
  if (ri >= 0) {
    const sha = argv[ri + 1] || ''; const wi = argv.indexOf('--why'); const why = wi >= 0 ? argv[wi + 1] : 'retracted';
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    const by = process.env.VNA_BY || 'cli';
    const r = retract(tree, sha, { why, by });
    if (!r.ok) { console.error(`retract refused — ${r.why}`); process.exit(2); }
    if (r.total) {
      writeTree(tree, { treePath: TREE });
      try { mkdirSync(dirname(ROOTS), { recursive: true }); appendFileSync(ROOTS, JSON.stringify({ at: new Date().toISOString(), kind: 'retract', by, source: tree.source, root: tree.root, rows: tree.watermark + 1, rowSha: r.rowSha, nodes: r.nodes, revisions: r.revisions, echoes: r.echoes, snips: r.snips, why }) + '\n'); } catch {}
    }
    if (asJson) { console.log(JSON.stringify({ ...r, root: tree.root, retracted: tree.retracted })); process.exit(0); }
    console.log(`retract ${r.rowSha.slice(0, 12)} · ${r.nodes} nodes · ${r.revisions} revisions · ${r.echoes} echoes · ${r.snips} drawer snips · ${r.total ? 'MARKED' : 'already retracted — no-op'} · root ${String(tree.root).slice(0, 12)} unchanged · why: ${why}`);
    process.exit(0);
  }
  const hi = argv.indexOf('--history');
  if (hi >= 0) {
    const n = Number(argv[hi + 1]) || 10;
    let ls = []; try { ls = readFileSync(ROOTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
    if (!ls.length) { console.log(`no insertions yet — ${ROOTS}`); process.exit(0); }
    const last = ls.slice(-n);
    if (asJson) { console.log(JSON.stringify(last)); process.exit(0); }
    console.log(`last ${last.length} insertion${last.length === 1 ? '' : 's'} of ${ls.length} · ${ROOTS}`);
    for (const r of last) console.log(r.kind === 'retract' ? `  ${r.at} · ${r.by || '?'} · RETRACT ${String(r.rowSha).slice(0, 12)} · ${r.nodes} nodes · ${r.revisions} revisions · root ${String(r.root).slice(0, 8)} unchanged · ${r.why}` : `  ${r.at} · ${r.by || '?'} · root ${String(r.root).slice(0, 8)} · +${(r.nodesAdded || []).length} nodes · ${(r.revisionsAdded || []).length} revisions · rows ${r.rows} · ${r.nodes} nodes total`);
    process.exit(0);
  }
  const gi = argv.indexOf('--grade');
  if (gi >= 0) {
    const [id, hash8, verdict] = argv.slice(gi + 1, gi + 4); const wi = argv.indexOf('--why'); const why = wi >= 0 ? argv[wi + 1] : '';
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    const r = grade(tree, id, hash8, verdict, { why });
    if (!r.ok) { console.error(`grade refused — ${r.why}`); process.exit(2); }
    writeTree(tree, { treePath: TREE });
    if (asJson) { console.log(JSON.stringify(r)); process.exit(0); }
    console.log(`${r.grade} · ${r.basin} (${r.node}) · ${r.hash8} — ${r.headline}${r.regraded ? ' · re-graded' : ''} · why: ${r.why} · on the node and ${LEDGER.startsWith(REPO) ? LEDGER.slice(REPO.length + 1) : LEDGER}`);
    process.exit(0);
  }
  if (argv.includes('--ungraded')) {
    const li = argv.indexOf('--leaf'); const leaf = li >= 0 ? argv[li + 1] : null;
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    const U = ungraded(tree, { leaf });
    if (asJson) { console.log(JSON.stringify(U)); process.exit(0); }
    console.log(`${U.total} ungraded direction${U.total === 1 ? '' : 's'}${leaf ? ` on ${leaf}` : ` on ${U.leaves} leaves`} (C98i) — a direction is an intent/decision snippet on a basin; grade one: node scripts/vna/spec-tree.mjs --grade <leaf> <hash8> KEPT|CORRECTED|REFUSED --why "…"`);
    for (const l of U.byLeaf) { if (!leaf) console.log(`  ${l.label} (${l.id}) · ${l.ungraded.length}`); if (leaf || U.byLeaf.length === 1) for (const d of l.ungraded) console.log(`    ${d.hash8} · row ${d.row ?? '—'} · ${d.type} — ${d.headline}`); }
    process.exit(0);
  }
  if (argv.includes('--echoes')) {
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    const E = instrumentEchoes(tree);
    if (asJson) { console.log(JSON.stringify(E)); process.exit(0); }
    console.log(`${E.length} echo${E.length === 1 ? '' : 'es'} — the instrument's own output clipped back in, typed echo at the fold (C98k): slotted, retained, never a pending ask · markers: ${ECHO_MARKERS.length} in ECHO_MARKERS`);
    for (const e of E) console.log(`  row ${e.row} · ${e.basin} · ${e.hash8} · ${e.marker}${e.retyped ? ' · re-typed' : ''} — ${e.headline}`);
    process.exit(0);
  }
  const bi = argv.indexOf('--bundle');
  if (bi >= 0) {
    const id = argv[bi + 1];
    let tree = null; try { tree = JSON.parse(readFileSync(TREE, 'utf8')); } catch {}
    if (!tree) { console.error(`no tree at ${TREE} — run node scripts/vna/spec-tree.mjs first`); process.exit(2); }
    const env = await bundle(tree, id);
    if (!env) { console.error(`no leaf ${id} in the tree (a section is not bundled — name one of its leaves)`); process.exit(2); }
    console.log(JSON.stringify(env, null, asJson ? 0 : 1));
    process.exit(0);
  }
  // C170a leg 1: a CLI fold (the runner's gate 5, a hand run) waits up to 4 min for a live fold to finish, then refuses; the hook's dispatch sets 0
  const r = await run({ walk, spec: argv.includes('--no-basins') ? null : SPEC_BASINS, foldWaitMs: process.env.VNA_FOLD_WAIT_MS != null ? Number(process.env.VNA_FOLD_WAIT_MS) : 240000 });
  if (!r.ok) { console.error(r.why); process.exit(3); }
  if (asJson) { console.log(JSON.stringify({ source: r.source, root: r.tree.root, rootSince: r.tree.rootSince, counts: r.tree.counts, mass: r.tree.nodes.root.mass, added: r.added, revised: r.revised, skipped: r.skipped, echoed: r.echoed, rootChanged: r.rootChanged, by: r.by })); }
  else {
    const c = r.tree.counts;
    console.log(`spec tree · ${r.source} · root ${String(r.tree.root || '—').slice(0, 12)} ${r.rootChanged ? '(CHANGED)' : '(unchanged)'} · ${c.nodes} nodes · ${c.revisions} revisions · ${c.placed} placed · ${c.unmeasured} unmeasured`);
    const rm = r.tree.nodes.root.mass || {};
    console.log(`  rows ${r.rows} · +${r.added} nodes · ${r.revised} revised · ${r.attached} attached · ${r.abstained} abstained (drawer ${tree_abst(r)}) · ${r.echoed} echoed · ${r.grades && r.grades.replayed ? `${r.grades.replayed} grades replayed from the ledger · ` : ''} ${r.echoTyped} echo-typed + ${r.retyped} re-typed (C98k, ${r.tree.counts.echoes} on the tree) · ${r.junkTyped} junk-typed + ${r.retypedJunk} re-typed (C107b, ${r.tree.counts.junk} on the tree) · ${r.assistantTyped} assistant + ${r.retypedAssistant} re-typed, prov stamped on ${r.provStamped} (C107c) · ${r.skipped} already ingested · by ${r.by} · mass ${rm.chars} chars → ${rm.gzip} gz (${rm.snippets} snippets)`);
    console.log(`  ${r.treePath}\n  ${r.txtPath}`);
  }
})();
