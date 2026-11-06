#!/usr/bin/env node
// scripts/pmu/attest-bundle.mjs — B19, THE PRODUCER: `npx thetacog-mcp attest-bundle <commit-ref> [--out file.json]`.
//
// scripts/pmu/verify-row.mjs (B13) checks ONE signed row against git — it needs our history and our
// reef file. Five gaps followed from shipping only that (operator's own numbering):
//   1. DEMONSTRATION PARADOX — a stranger's `verify` fails at the reef step because the public reef is
//      scrubbed and our git history is private. Fix: the bundle CARRIES the reef and axes bytes the row
//      was walked against, with their blob ids, so nothing outside the bundle is ever read.
//   2. SINGLE ROW vs THE COMMIT UNIT — a per-turn row cannot certify a contract-grade commit; a room could
//      clear any per-turn bound by splitting one turn into many. Fix: the bundle is a COMMIT-RECEIPT
//      ENVELOPE over every constituent turn plus the commit's own two rows (intent, reality), with an
//      aggregate covenant computed by SUMMING across turns (recomputeCommitUnit in verify-row.mjs).
//   3. GIT DEPENDENCY — recompute needs commit text, reef, axes. Fix: pack the walked TEXT (the door's
//      prose projection of the diff, exactly the bytes whose sha256 is text_sha) for commit rows only,
//      plus the reef/axes bytes, each pinned by its git blob id (checked with zero git calls — see
//      gitBlobIdJs in verify-row.mjs).
//   4. PROMPT CONFIDENTIALITY — prompt/turn rows never carry raw text (they never have — text_sha is the
//      only trace on the tape by construction); the verifier reports them at level 1 (signature +
//      commitment) unless an auditor supplies --text-dir.
//   5. PUBLICATION is the operator's act — this script only produces the file; nothing here sends it
//      anywhere.
//
// B21 — THE GATE (spec §8.51, KR38): the bundle above carries the reef/axes (the MAP) and the signed
// rows (the KEY) but never the covenant DEFINITION the claim was evaluated under — a later format
// change (a new tau, a rewritten kr37-covenant.mjs, an edited reef) could retroactively move a past
// strike. `bundle.gate = { collar: {tau_pct, k_calls, breach_max}, covenant_module_blob, lane_paths_sha }`
// fixes that: it sits INSIDE the signed payload (tampering breaks the envelope sig, never a silent
// MISMATCH), and lane_paths_sha is computed by lanePathsFromReefBytes() — the SAME git-free function
// verify-row.mjs's verifyBundle recomputes from the bundle's own packed reef bytes, so producer and
// verifier can never drift from each other.
//
// THE COMMIT UNIT, CONCRETELY: the commit's own two commit-* rows (intent, reality) plus every 'turn' row
// on the walk tape whose OWN room (stamped by prompt-lens.mjs from detectRunningIn(), not guessed here)
// matches the commit's Originating-Terminal room, with ts in (previous same-room commit, this commit].
// Per turn we read off_lane straight off the row (off_pct), and calls/touched_paths from the operator's
// own session transcript (kr33-uptake.mjs's windowCalls/loadTranscriptPaths — the same host-recorded
// tool_use blocks kr37/kr40 already read) when the row names a session; a turn with no session or no
// transcript on this machine gets calls=null (EXCLUDED from the collar, never defaulted to a pass — AXIOM
// 1's W6, a null leg excludes rather than fails). `delivered` (the turn's lane's declared path prefixes,
// from lanePathMap()) rides on EACH per_turn entry precisely so the shipped verifier can recompute breach
// without ever reading a reef file — see breachShareUnion in verify-row.mjs.
//
// A COMMIT ROW IS NEVER TRUSTED STALE: the git-derived text is rebuilt HERE (buildCommitText, imported
// from verify-row.mjs — the identical function the verifier uses) and its sha12 is what the tape is
// searched for; a historical row whose text_sha does not match today's git-derived text (found during
// this build: the walk tape carries rows from at least one other producer whose 'commit-intent' text was
// NOT the commit message) is never packed — a FRESH walk is minted instead (tape: '/dev/null', so this
// producer never writes the shared tape), so every packed row is honestly recomputable on arrival.
//
//   node scripts/pmu/attest-bundle.mjs <commit-ref> [--out file.json] [--repo <path>]
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, sign as edSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildCommitText, canonicalStringify, sha256Hex, breachShareUnion, recomputeCommitUnit, checkRowSignature, gitBlobIdJs, lanePathsFromReefBytes, BUNDLE_SCHEMA } from './verify-row.mjs';
import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';
import { roomFromCommitTrailer, roomKey } from '../../src/lib/pmu/room-key.mjs';
import { lanePathMap } from '../../src/lib/pmu/lane-paths.mjs';
import { loadTranscriptPaths, windowCalls } from './transcript-paths.mjs';   // the LEAF — never kr33-uptake.mjs, whose closure is the reading chain + the prompt corpora
import { roomIdentity } from '../mesh/mesh-keys.mjs';
import { watchlist, ALLOW_EMAIL_DOMAINS } from '../ops/mirror-name-gate.mjs';   // B22 — the SAME watchlist/allowlist the mirror gate uses, never a second definition

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WINDOW_CAP = 60;   // wider than K_CALLS so a breach of the bound is observable, not clipped (kr37's convention)
export const TAU_PCT = 25;      // OFFLANE_KILL_PCT — kr37-covenant.mjs's collar, restated here rather than imported to keep this
export const K_CALLS = 20;      // producer decoupled from the concurrently-edited kr-scripts; both numbers are named IN the covenant object it emits
export const BREACH_MAX = 0;    // kr37-covenant.mjs's BETAS[0] — the strict bound (a lane the turn touched has no path outside its declared prefixes)
export const ANCESTOR_SCAN_CAP = 500;   // how far back `git log` looks for the previous same-room commit before giving up (tsPrev = 0)
const COVENANT_MODULE_PATH = 'scripts/pmu/kr37-covenant.mjs';   // B21 — the file whose blob id names the covenant algorithm's identity

const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const git = (args, opts = {}) => execFileSync('git', args, { cwd: opts.repo || REPO, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

/** the previous commit, in this ref's own ancestry, whose Originating-Terminal trailer names the SAME room.
 *  One `git log` call carries hash+date+body together (record-separated) so this never spends one git
 *  call per candidate ancestor. Returns { ts } or null when none is found within ANCESTOR_SCAN_CAP. */
export function previousSameRoomCommit(sha, room, { repo = REPO, cap = ANCESTOR_SCAN_CAP } = {}) {
  const raw = git(['log', '--format=%H%x1f%aI%x1f%B%x1e', '-n', String(cap), sha], { repo });
  const records = raw.split('\x1e').map((s) => s.replace(/^\n/, '')).filter((s) => s.trim());
  const parsed = records.map((rec) => { const parts = rec.split('\x1f'); const h = parts[0], ts = parts[1], body = parts.slice(2).join('\x1f'); const m = body.match(/^Originating-Terminal:\s*(.+)$/m); return { h, ts, room: m ? roomKey(m[1]) : null }; });
  // parsed[0] is the commit itself (git log <sha> always starts there); every candidate PREVIOUS
  // same-room commit is strictly among its ancestors, i.e. parsed[1..].
  const prev = parsed.slice(1).find((c) => c.room === room);
  return { self: parsed[0] || null, prev: prev || null, scanned: parsed.length };
}

/** every 'turn' tape row belonging to ROOM with ts in (tsPrevExclusive, tsCurInclusive] */
export function windowTurnRows(tapePath, room, tsPrevExclusive, tsCurInclusive) {
  if (!existsSync(tapePath)) return [];
  const out = [];
  for (const l of readFileSync(tapePath, 'utf8').split('\n')) {
    if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.source !== 'turn' || j.room !== room) continue;
    const t = Date.parse(j.ts); if (!Number.isFinite(t) || t <= tsPrevExclusive || t > tsCurInclusive) continue;
    out.push(j);
  }
  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
}

/** one walk-tape 'turn' row → its covenant.per_turn entry (calls/touched_paths from the operator's own
 *  session transcript when the row names one and it exists on this machine; null/[] otherwise — EXCLUDED,
 *  never defaulted to a pass). Exported so the test suite can check it against a synthetic transcript. */
export function perTurnEntry(row, { repo = REPO } = {}) {
  const domain = row.routed || null;
  const delivered = domain ? (lanePathMap({ repo }) [domain] || []) : [];
  let calls = null, touched = [];
  if (row.session) {
    const events = loadTranscriptPaths(row.session, { repo });
    if (events) { const list = windowCalls(events, row.ts, { cap: WINDOW_CAP }); calls = list.length; touched = [...new Set(list.flatMap((c) => c.paths || []))]; }
  }
  const breach = delivered.length ? breachShareUnion(touched, delivered) : null;
  return { ts: row.ts, session: row.session || null, domain, off_lane: typeof row.off_pct === 'number' ? row.off_pct : null, calls, touched_paths: touched, delivered, breach };
}

// The reef/axes paths a signed row's reef_blob/axes_blob actually names — copied from
// src/lib/pmu/walk-door.mjs's own two `resolve(REPO, ...)` call sites (the only two paths lensWalk
// ever hashes), so a bundle for a commit walked against an uncommitted reef edit still packs the
// EXACT bytes the walk used, not whatever git's object store happens to hold.
const REEF_PATH = 'data/pmu/lens-reef.json';
const AXES_PATH = 'data/pmu/snippet-library-144.json';

// ── B22 — THE PUBLICATION SCRUB (2026-09-17 leak remediation) ──────────────────────────────
// demo-attestation-bundle.json shipped the reef as base64 in reef.bytes_b64: decoded, it carried
// correspondents from .thetacog/email-sent.ndjson as bare adjacent tokens (the same shape
// mirror-name-gate.mjs's bigram scan was built for), three non-thetadriven addresses, and
// phone-shaped tokens. Neither scripts/ops/mirror-name-gate.mjs nor scripts/mirror-to-public.sh's
// address scrub decoded base64 fields (fixed in this same commit — see both files), so nothing
// caught it before publication. This function is the CODE fix for the fixture itself: a pure,
// testable scrub over a parsed reef object, never a hand-edited JSON file.
//
// names/addresses are INJECTED, never read by this function: the caller derives the watchlist the
// same way mirror-name-gate.mjs does (watchlist(), from .thetacog/email-sent.ndjson at run time —
// never a committed list of names) and passes the allowlist (ALLOW_EMAIL_DOMAINS, the same list
// scripts/mirror-to-public.sh's address assertion uses). Returns { reef, counts } — counts only,
// NEVER the removed values, so a caller can report "N names removed" without the log itself
// becoming a second leak.
const B64_SCRUB_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// phone-shaped: a run of 10-11 digits (loosely formatted with spaces/dashes/dots/parens), fenced by
// a NOT-a-digit lookaround on both sides so it can never carve a false 10-digit window out of a
// longer numeric id (measured on the real leak: a 20-digit draft id and a byte-count column both
// contain a spurious 10-digit substring and must NOT be flagged).
const PHONE_SHAPED_RE = /(?<!\d)(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scrubReefForPublication(reefJson, { names = new Set(), addresses = ALLOW_EMAIL_DOMAINS } = {}) {
  const nameSet = names instanceof Set ? names : new Set(names);
  const allowDomains = new Set((addresses || []).map((d) => String(d).toLowerCase()));
  const input = typeof reefJson === 'string' ? JSON.parse(reefJson)
    : Buffer.isBuffer(reefJson) ? JSON.parse(reefJson.toString('utf8'))
    : JSON.parse(JSON.stringify(reefJson));   // deep-clone: never mutate the caller's object
  let names_removed = 0, addresses_removed = 0, phones_removed = 0;
  // PRIVATE MARKERS (2026-09-17, second pass): the first rebuild scrubbed names, addresses and phones and the mirror's
  // decode step still refused the push — one marker from data/pmu/private-markers.txt survived twice in the reef. The marker
  // list is the mirror's own abort list (bundle-pmu.mjs scrubs by it too), so the publication scrub applies it as well,
  // read at run time, counted, never echoed.
  let markers_removed = 0;
  const markersPath = new URL('../../data/pmu/private-markers.txt', import.meta.url);
  const markerList = fs.existsSync(markersPath) ? fs.readFileSync(markersPath, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean) : [];

  function scrubString(s) {
    let out = s;
    for (const n of nameSet) {
      const parts = String(n).trim().split(/\s+/);
      if (parts.length < 2) continue;
      const re = new RegExp(`\\b${escapeRegExp(parts[0])}\\s+${escapeRegExp(parts[1])}\\b`, 'gi');
      out = out.replace(re, () => { names_removed++; return 'REDACTED-NAME'; });
    }
    out = out.replace(B64_SCRUB_EMAIL_RE, (m) => {
      const domain = (m.split('@')[1] || '').toLowerCase();
      if (allowDomains.has(domain)) return m;
      addresses_removed++;
      return 'redacted@example.com';
    });
    out = out.replace(PHONE_SHAPED_RE, () => { phones_removed++; return 'REDACTED-PHONE'; });
    for (const m of markerList) { const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c), 'gi'); out = out.replace(re, () => { markers_removed++; return 'REDACTED-MARKER'; }); }
    return out;
  }
  function walk(node) {
    if (typeof node === 'string') return scrubString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') { const out = {}; for (const [k, v] of Object.entries(node)) out[k] = walk(v); return out; }
    return node;
  }

  const reef = walk(input);
  return { reef, counts: { names_removed, addresses_removed, phones_removed, markers_removed } };
}

/** the bytes a row's `${label}_blob` names: git's own object store when the blob was actually
 *  committed, else the current working file (gitBlob() in walk-door.mjs hashes with `git
 *  hash-object` — NO `-w` — so a walk against an uncommitted edit produces a real blob id that git
 *  cat-file can never resolve; the file on disk is where those bytes actually live). Either way the
 *  bytes are cross-checked against the declared blob id with gitBlobIdJs (zero git calls) before
 *  they are trusted, so a stale/wrong working file fails loudly rather than silently packing junk. */
function readBlobBytes(blobId, workingRelPath, { repo = REPO, label } = {}) {
  try { return execFileSync('git', ['-C', repo, 'cat-file', '-p', blobId], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch {
    const bytes = readFileSync(resolve(repo, workingRelPath));
    if (gitBlobIdJs(bytes) !== blobId) throw new Error(`${label}: blob ${blobId} is in neither git's object store nor ${workingRelPath} at its current content (working-file hash ${gitBlobIdJs(bytes)})`);
    return bytes;
  }
}

/** for one commit-* source, find an EXISTING signed tape row whose git-rebuilt text still matches its
 *  own text_sha (never trust a stale/mismatched historical row — see the header note), else mint a
 *  fresh, correctly-signed one with the real walk. Never writes the shared tape (tape: '/dev/null'). */
function commitRowFor(source, sha, shortRef, room, { repo = REPO, tapePath, reefPath, forceFresh = false } = {}) {
  const text = buildCommitText({ source, ref: sha }, repo);
  const wantSha = sha12(Buffer.from(text));
  let found = null;
  // forceFresh (B22, --scrub-for-publication) skips tape-reuse outright: a reused row was walked
  // against the REAL private reef, so its reef_blob could never match a scrubbed reef packed beside it.
  if (!forceFresh && existsSync(tapePath)) {
    for (const l of readFileSync(tapePath, 'utf8').split('\n')) {
      if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; }
      if (j.source !== source) continue;
      if (j.ref !== shortRef && !String(sha).startsWith(String(j.ref || ' '))) continue;
      if (j.text_sha !== wantSha) continue;
      if (!checkRowSignature(j).ok) continue;
      if (!found || Date.parse(j.ts) > Date.parse(found.ts)) found = j;
    }
  }
  if (found) return { row: found, text, minted: false };
  // reefPath (B22) walks against a scrubbed reef file rather than the tracked one, so a
  // publication fixture's rows are minted against the SAME bytes the bundle ships.
  const { row } = lensWalk(text, { source, ref: shortRef, room, tape: '/dev/null', ...(reefPath ? { reefPath } : {}) });
  return { row, text, minted: true };
}

/** build the whole bundle for one room-trailered commit. Throws when the commit carries no
 *  Originating-Terminal room (an attestation needs an identity to sign with — B19's spec: "sign the
 *  envelope with the room's key").
 *  opts.scrubForPublication (B22, fixtures ONLY — see runCli's --scrub-for-publication) forces the
 *  commit-intent/commit-reality rows to be MINTED FRESH (never reused from the tape) against a
 *  SCRUBBED copy of the reef, so the bundle's packed reef.bytes_b64 and every row's reef_blob/reef_sha
 *  agree on the same scrubbed bytes. opts.names is the watchlist (derived by the caller via
 *  watchlist(), never invented here); opts.addresses defaults to ALLOW_EMAIL_DOMAINS. Turn rows are
 *  NEVER re-walked — see the header note: they carry no packed text (prompt confidentiality, gap 4),
 *  so their own reef_blob is verified at level 1 (signature only) and is not a base64-decodable leak
 *  vector by construction — only the COMMIT rows' reef is ever packed as bytes_b64. */
export function buildBundle(ref, { repo = REPO, tapePath, scrubForPublication = false, names, addresses } = {}) {
  tapePath = tapePath || process.env.PMU_WALK_TAPE || resolve(repo, '.thetacog/walk-tape.ndjson');
  const sha = git(['rev-parse', ref], { repo }).trim();
  const shortRef = sha.slice(0, 10);
  const room = roomFromCommitTrailer(sha, repo);
  if (!room) throw new Error(`commit ${sha} carries no (recognised) Originating-Terminal room — nothing to sign the envelope with`);
  const curTs = git(['log', '-1', '--format=%aI', sha], { repo }).trim();
  const tsCur = Date.parse(curTs);
  const { prev } = previousSameRoomCommit(sha, room, { repo });
  const tsPrev = prev ? Date.parse(prev.ts) : 0;

  let scrubDir = null, scrubReefPath = null, scrubReefJson = null, scrubCounts = null;
  const commitOpts = { repo, tapePath };
  if (scrubForPublication) {
    const rawReefBytes = readFileSync(resolve(repo, REEF_PATH));
    const scrubbed = scrubReefForPublication(rawReefBytes, { names: names || new Set(), addresses: addresses || ALLOW_EMAIL_DOMAINS });
    scrubCounts = scrubbed.counts;
    scrubReefJson = JSON.stringify(scrubbed.reef);
    scrubDir = mkdtempSync(join(tmpdir(), 'attest-bundle-scrub-'));
    scrubReefPath = join(scrubDir, 'lens-reef.scrubbed.json');
    writeFileSync(scrubReefPath, scrubReefJson);
    Object.assign(commitOpts, { reefPath: scrubReefPath, forceFresh: true });
  }

  let intent, reality, commitRows, texts, turnTapeRows, perTurn, commit_unit, reefBlob, axesBlob, reefBytes, axesBytes;
  try {
    intent = commitRowFor('commit-intent', sha, shortRef, room, commitOpts);
    reality = commitRowFor('commit-reality', sha, shortRef, room, commitOpts);
    commitRows = [intent.row, reality.row];
    texts = { [intent.row.text_sha]: intent.text, [reality.row.text_sha]: reality.text };

    turnTapeRows = windowTurnRows(tapePath, room, tsPrev, tsCur);
    perTurn = turnTapeRows.map((r) => perTurnEntry(r, { repo }));
    commit_unit = recomputeCommitUnit(perTurn, { tau: TAU_PCT, k: K_CALLS, breachMax: BREACH_MAX });

    // reef/axes: read straight from git (the commit's own blob ids), preferring the reality row's
    // names. Under scrubForPublication the rows were minted against scrubReefPath (a temp file,
    // never committed) — reefBytes is the EXACT in-memory string written there, so no re-read of a
    // temp path that this function is about to delete.
    reefBlob = reality.row.reef_blob || intent.row.reef_blob;
    axesBlob = reality.row.axes_blob || intent.row.axes_blob;
    reefBytes = scrubForPublication ? Buffer.from(scrubReefJson, 'utf8') : readBlobBytes(reefBlob, REEF_PATH, { repo, label: 'reef' });
    axesBytes = readBlobBytes(axesBlob, AXES_PATH, { repo, label: 'axes' });
  } finally {
    if (scrubDir) { try { rmSync(scrubDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ } }
  }

  // B21 THE GATE — the covenant's own DEFINITION, pinned so a later ratchet change (a new tau, a
  // rewritten kr37-covenant.mjs, an edited reef) can never retroactively move this bundle's strike
  // (KR38/§8.51). All three fields are computed with ZERO git calls, over bytes the bundle already
  // packs or reads: lane_paths_sha runs the SAME lanePathsFromReefBytes() the verifier recomputes
  // against the bundle's own reef.bytes_b64, so producer and verifier never drift from each other.
  const covenantModuleBytes = readFileSync(resolve(repo, COVENANT_MODULE_PATH));
  const gate = {
    collar: { tau_pct: TAU_PCT, k_calls: K_CALLS, breach_max: BREACH_MAX },
    covenant_module_blob: gitBlobIdJs(covenantModuleBytes),
    lane_paths_sha: sha256Hex(canonicalStringify(lanePathsFromReefBytes(reefBytes))),
  };

  const bundle = {
    schema: BUNDLE_SCHEMA,
    commit: { ref: shortRef, full_sha: sha, room, ts: curTs, window_from: prev ? prev.ts : null, turns_in_window: perTurn.length },
    rows: [...commitRows, ...turnTapeRows],
    texts,
    reef: { blob: reefBlob, bytes_b64: reefBytes.toString('base64') },
    axes: { blob: axesBlob, bytes_b64: axesBytes.toString('base64') },
    covenant: { per_turn: perTurn, commit_unit },
    gate,
    bin_sha: reality.row.bin_sha || intent.row.bin_sha || null,
    aperture: { knobs: reality.row.knobs || intent.row.knobs || null, aperture_id: reality.row.aperture_id || intent.row.aperture_id || null },
  };

  const digest = sha256Hex(canonicalStringify(bundle));
  const id = roomIdentity(room);
  const sig = edSign(null, Buffer.from(digest, 'hex'), id.privateKey).toString('hex');
  bundle.envelope = { sig, sig_pubkey: id.pubkey_hex, sig_over: 'sha256 of the canonical JSON of everything above (schema/commit/rows/texts/reef/axes/covenant/gate/bin_sha/aperture)' };
  // scrubCounts is COUNTS ONLY (names_removed/addresses_removed/phones_removed), never the removed
  // values — reported by the CLI under --scrub-for-publication, never packed into the signed bundle.
  return { bundle, scrubCounts };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────
export async function runCli(argv) {
  const args = argv.slice();
  let ref = null; const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') { flags.out = args[++i]; continue; }
    if (a === '--repo') { flags.repo = args[++i]; continue; }
    // B22 — FIXTURES ONLY. This scrubs the reef the bundle packs so a demo/fixture never ships a
    // real correspondent's name, address or phone (2026-09-17 leak). It is NEVER for a production
    // bundle: a production attestation's whole point is the REAL reef the REAL commit walked
    // against — scrubbing it would make the bundle attest to a reef that never actually ran.
    if (a === '--scrub-for-publication') { flags.scrub = true; continue; }
    if (!a.startsWith('--') && !ref) ref = a;
  }
  if (!ref) {
    console.error('usage: npx thetacog-mcp attest-bundle <commit-ref> [--out file.json] [--repo <path>] [--scrub-for-publication]');
    console.error('  --scrub-for-publication : FIXTURES ONLY. Strips the packed reef of every correspondent name');
    console.error('                            (from .thetacog/email-sent.ndjson), every address outside');
    console.error('                            ALLOW_EMAIL_DOMAINS, and every phone-shaped token, then re-walks');
    console.error('                            the commit rows fresh against the scrubbed reef. NEVER use this');
    console.error('                            for a real attestation — it would ship a bundle that attests to a');
    console.error('                            reef different from the one the commit actually ran against.');
    return 2;
  }
  const repo = flags.repo || REPO;
  const buildOpts = { repo };
  if (flags.scrub) { buildOpts.scrubForPublication = true; buildOpts.names = await watchlist(); buildOpts.addresses = ALLOW_EMAIL_DOMAINS; }
  const { bundle, scrubCounts } = buildBundle(ref, buildOpts);
  const json = JSON.stringify(bundle, null, 1);
  if (flags.out) {
    writeFileSync(flags.out, json);
    const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
    console.log(`attest-bundle: ${bundle.commit.ref} (room ${bundle.commit.room}) → ${flags.out} (${kb} KB, ${bundle.rows.length} rows, ${bundle.covenant.per_turn.length} turns in window)`);
  } else {
    console.log(json);
  }
  if (scrubCounts) console.log(`   scrub-for-publication: ${scrubCounts.names_removed} name(s), ${scrubCounts.addresses_removed} address(es), ${scrubCounts.phones_removed} phone-shaped token(s) removed from the packed reef (values never logged)`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('attest-bundle.mjs')) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
