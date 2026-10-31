#!/usr/bin/env node
// scripts/vna/backup.mjs — C71 THE BACKUP AND THE LICENCE DOOR, FROM THE EXTENSION (goal 3 unit 6, 2026-09-18; operator: "you
// just hit a link, you log into our site, you back up the tape, and you buy the licence right there — and that's something
// you can do from the extension"). The tape is the operator's record; sending it anywhere is an OUTBOUND publish, so this
// script does the half that stays on the machine: it bundles the tape (.thetacog/walk-tape.ndjson + its attestation), the
// flight tape and its proofs, and the tesseract state into ONE archive whose NAME is the sha256 of its bytes, writes a
// manifest beside it (sha · rows · chain-verified yes/no · tesseract_sha · every file with its own sha256), and prints the
// one URL the human opens: https://thetadriven.com/backup?manifest=<sha>. Login, upload and the licence purchase happen on
// the site (its own row); nothing here uploads, fetches, or holds a credential.
//
// C532 CADENCE IS PER SHIP (chair decomposition 2026-10-01 of the operator's words): `npm run ship` runs `--upload --tapes`
// after the deploy hook fires, detached (ship.sh). CONTENT-ADDRESSED SO AN UNCHANGED TAPE UPLOADS NOTHING: uploadIfChanged
// bundles first, then checks whether THIS sha already has a `<sha>.upload.json` receipt beside the archive — if so the tape
// has not moved since the last post and nothing goes over the wire; only a sha this machine has never posted reaches fetch.
//
// CONTENT-ADDRESSED MEANS CONTENT → ADDRESS. `tar` on this machine (bsdtar) writes mtimes, uids and a gzip timestamp, so the
// same bytes would bundle to a different sha every minute. The ustar writer below fixes every header field the content does
// not determine (mtime 0, uid/gid 0, mode 0644) and node's zlib writes no gzip timestamp — so the guard can say: same bytes,
// same sha; one changed row, a different sha. The reader is the same format back, streamed, so `--verify` never holds the
// 100+ MB walk tape in memory.
//
//   node scripts/vna/backup.mjs [--json]          bundle, write the manifest, print the URL
//   node scripts/vna/backup.mjs --upload [--json] C102c: bundle, then POST it to /api/backup/upload with NOTARY_BEARER; print the manifest URL
//   node scripts/vna/backup.mjs [--upload] --tapes  C505: bundle ONLY the tapes the viz page reads (TAPE_FILES), refused over the body limit
//   (C651a) --upload --tapes also posts the walk tape's pending segments — scripts/vna/walk-segments.mjs (--dry-run to size them)
//   node scripts/vna/backup.mjs --verify <sha>    recompute the archive to its sha and every entry to its manifest sha256
//   node scripts/vna/backup.mjs --source <log.ndjson> [--spec <rows.md>]   (C73) a foreign actor's log, taped as a batch row
//
// C73 — THE LOG OF A RUNNING AGENT IS THE DEFAULT SUBJECT. `--source` bundles the actor's log + the flight tape (its batch
// rows are on it) + the proof files those rows name + the actor's declared rows (the spec) into the SAME archive format with
// the SAME manifest (v:1, sha, files, chain_verified, url) — the site's /backup door takes a robot's month the way it takes
// this repo's commit. What the underwriter reads is that archive, not our code. Nothing on this path calls git; `head` is
// null when there is no repository, never a fabricated sha, and a row count is omitted rather than printed as 0.
// LLM-FREE.
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, readSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verify as verifyTape, FLIGHT, PROOFS_DIR, licenceOf } from './flight-tape.mjs';   // C111: licenceOf counts the countersigned rows inside a posted height
import { bearerEntitlement } from './machine-store.mjs';
import { tailRowsSince } from './walk-tape-read.mjs';   // C857: the walk tape is read BOUNDED, from its end (the operator's is 1.6 GB)   // C182a: which held licence becomes NOTARY_BEARER — credits left, newest first
import { panelsWithCarry, PANEL_ENTRY } from './panel-carry.mjs';   // C647b: the panel home (panel-home.mjs panelsManifest) + the panel PNGs the archive carries
import { WARRANTY_ENTRY, termsOf } from '../../src/lib/backup/warranty.mjs';   // C896: the terms entry and its one shape check
export const WARRANTY_TERMS_FILE = '.thetacog/warranty-terms.json';
import { PROVIDER_ENTRY, cardOf } from '../../src/lib/backup/provider-card.mjs';   // C903: the provider card entry and its one shape check
export const PROVIDER_CARD_FILE = '.thetacog/provider.json';
import { PANELS_ENTRY, ROWS_CAP, REGRESSED_ENTRY, TOKENS_PER_COG_ENTRY, tokensPerCogInputs, ODOMETER_ENTRY, odometerRowsFor, odometerCrossingsOf } from '../../src/lib/backup/receive.mjs';   // C857: the odometer entry and the one pure reading of the walk tape's crossings   // C506: the one name the archive entry and the reader share   // C506: where the holder's panels are served from, and which tape commits have one in the tree at HEAD
// C182a: the machine store's picked bearer (credits left, newest first) — between the NOTARY_BEARER default below and
// the "no entitlement" refusal; never throws (an absent/unreadable store reads as null).
const storeBearer = () => { try { return (bearerEntitlement() || {}).entitlement || null; } catch { return null; } };
import { anatomyCarry, ANATOMY_ENTRY, tapePath as anatomyTapePath, readAnatomy, postedHeights, readSetting as readAnatomySetting, settingPath as anatomySettingPath } from './anatomy.mjs';
import { retainLive, readStore as readSnapshotStore, storePath as snapshotStorePath, snapshotCarryFor, snapshotWindowHeight, resolveTesseractCarry, SNAPSHOTS_ENTRY } from './tesseract-snapshots.mjs';   // C667d: the tesseract state rides every backup as chained snapshots   // C648: the tesseract anatomy (the ω tuples) rides beside the tape

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SITE = 'https://thetadriven.com/backup';

// The file set is DECLARED, not discovered: the tape, the proofs, the tesseract state — what the row names, nothing else.
// C518: the holder's own published semantic vega — the same relative path on every repo (the well-known door), archived
// under its own path when present so tapesFromArchive can hand it to the carrier's view beside panels.json (C509).
export const VEGA_FILE = 'public/.well-known/semantic-vega.json';
export const BACKUP_FILES = Object.freeze({
  fixed: Object.freeze(['.thetacog/walk-tape.ndjson', '.thetacog/walk-tape.attestation.json', 'data/vna/flight-tape.ndjson', 'data/vna/attestations.ndjson', 'data/vna/tesseract-state.json', VEGA_FILE]),
  glob: Object.freeze({ dir: 'data/vna/proofs', ext: '.json' }),
  // C503: the DEPLOYED tapes — every .thetacog/fleet-tape/<job>.ndjson (the C496 robot fleet, and the C504 LLM tape the steer
  // runner writes), archived under the same relative path so /backup/adherence draws one lane per job. The .witness sidecars
  // are not taped rows and stay home (the ext is exact: '<job>.ndjson.witness' does not end in '.ndjson').
  fleet: Object.freeze({ dir: '.thetacog/fleet-tape', ext: '.ndjson' }),
});

export function backupUrl(sha) {
  if (!/^[0-9a-f]{64}$/.test(String(sha))) throw new Error(`backupUrl: the manifest sha must be sha256 hex, got ${JSON.stringify(sha)}`);
  return `${SITE}?manifest=${sha}`;   // the manifest sha and nothing else — no token, no email, no path
}

const backupDir = (repo) => resolve(repo, '.thetacog/backup');

export function fileList(repo = REPO) {
  const out = BACKUP_FILES.fixed.filter((p) => existsSync(resolve(repo, p)));
  const d = resolve(repo, BACKUP_FILES.glob.dir);
  if (existsSync(d)) for (const f of readdirSync(d).filter((f) => f.endsWith(BACKUP_FILES.glob.ext)).sort()) out.push(`${BACKUP_FILES.glob.dir}/${f}`);
  const fl = resolve(repo, BACKUP_FILES.fleet.dir);
  if (existsSync(fl)) for (const f of readdirSync(fl).filter((f) => f.endsWith(BACKUP_FILES.fleet.ext)).sort()) out.push(`${BACKUP_FILES.fleet.dir}/${f}`);
  return out.sort();
}
// C505 THE BACKUP CLEARS (operator 2026-09-30: "ship once you get the backup clear and showing the correct viz on the page you
// open"). Measured: the full archive cannot post — .thetacog/walk-tape.ndjson is 1.1 GB (177 MB at gzip -1) plus 191 MB of
// proofs, over receive.mjs's 200 MB cap and far over the platform's 4.5 MB function body. `--tapes` bundles ONLY the tapes
// the /backup viz page reads — the flight tape (CODING), the attestations, and every fleet tape (DEPLOYED, BACKUP_FILES.fleet,
// C503) — and names everything else as the LOCAL DIARY in the manifest: it stays on this machine, it is not in the archive.
export const TAPE_FILES = Object.freeze({
  fixed: Object.freeze(['data/vna/flight-tape.ndjson', 'data/vna/attestations.ndjson', 'data/vna/steer-ab-tokens.ndjson', 'data/vna/token-savings-daily.ndjson', VEGA_FILE]),   // C519: --tapes carries the token-savings series the viz page reads; C518: and the holder's published vega, when present
  fleet: BACKUP_FILES.fleet,
  // C565k: the holder's regressed rows ride as ids only — { at, regressed: [ids] } read off the asked-vs-built receipt (the ticked
  // rows whose guard is red, state CONTRADICTED), never its headlines or evidence text; written into the archive as `entry`
  regressed: Object.freeze({ entry: REGRESSED_ENTRY, from: '.thetacog/vna-asked-vs-built.json' }),
  // C659: the tokens-per-cog record rides as numbers only (receive.mjs tokensPerCogInputs) — the cog rows, the spend of record, the peg
  tokens_per_cog: Object.freeze({ entry: TOKENS_PER_COG_ENTRY, from: Object.freeze({ cogRows: 'data/vna/cog.ndjson', spendRows: 'data/vna/cog-spend.ndjson', peg: 'data/vna/cog-peg.json' }) }),
  // C857: each commit's odometer reading (c, kE, cell, receipt) rides as ODOMETER_ENTRY, read off the walk tape's commit-reality rows
  // (the lens JSON pmu-onchip wrote, kept verbatim by walk-door.mjs recordWalk) — never re-derived here; a commit with no reading
  // is carried as UNMEASURED with its reason, never 0. The walk tape itself stays the local diary.
  odometer: Object.freeze({ entry: ODOMETER_ENTRY, from: '.thetacog/walk-tape.ndjson' }),
  local_diary: Object.freeze(['.thetacog/walk-tape.ndjson', '.thetacog/walk-tape.attestation.json', 'data/vna/tesseract-state.json', `${BACKUP_FILES.glob.dir}/*${BACKUP_FILES.glob.ext}`]),
});
/** C565k: the ids-only regressed list off an asked-vs-built receipt, or null when there is no receipt to read (never an empty
 *  list standing in for "not read"). @guard tests/site/c565k-public-record-opens-on-the-reader.test.mjs */
export function regressedRows(avb) {
  if (!avb || typeof avb !== 'object' || !Array.isArray(avb.asks)) return null;
  const regressed = avb.asks.filter((a) => a && a.state === 'CONTRADICTED' && typeof a.id === 'string').map((a) => a.id);
  return { at: typeof avb.at === 'string' ? avb.at : null, regressed };
}
export function tapeFileList(repo = REPO) {
  const out = TAPE_FILES.fixed.filter((p) => existsSync(resolve(repo, p)));
  const fl = resolve(repo, TAPE_FILES.fleet.dir);
  if (existsSync(fl)) for (const f of readdirSync(fl).filter((f) => f.endsWith(TAPE_FILES.fleet.ext)).sort()) out.push(`${TAPE_FILES.fleet.dir}/${f}`);
  return out.sort();
}
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
// C73: the declared set for a foreign log — the log, the spec, the tape, and ONLY the proof files the log's batch rows name
export function sourceFileList({ source, spec = null, tape = FLIGHT, proofsDir = PROOFS_DIR }) {
  const bytes = readFileSync(source); const sha = createHash('sha256').update(bytes).digest('hex');
  const rows = nd(tape).filter((r) => r.kind === 'batch' && r.sha === sha);
  const out = [{ path: `source/${basename(source)}`, abs: resolve(source) }];
  if (spec) out.push({ path: `spec/${basename(spec)}`, abs: resolve(spec) });
  if (existsSync(tape)) out.push({ path: 'data/vna/flight-tape.ndjson', abs: resolve(tape) });
  const ids = new Set(); for (const r of rows) for (const it of (r.proofs && r.proofs.items) || []) if (it.proof_id) ids.add(it.proof_id);
  for (const id of [...ids].sort()) { const abs = resolve(proofsDir, `${id}.json`); if (existsSync(abs)) out.push({ path: `data/vna/proofs/${id}.json`, abs }); }
  return { files: out.sort((a, b) => (a.path < b.path ? -1 : 1)), sha, rows: rows.length, actor: rows.length ? rows[rows.length - 1].session : null };
}

// ── ustar, fixed fields ─────────────────────────────────────────────────────────────────────────────────────────────
const octal = (n, w) => n.toString(8).padStart(w - 1, '0') + '\0';
function tarHeader(name, size) {
  let prefix = '', base = name;
  if (Buffer.byteLength(name) > 100) { const i = name.lastIndexOf('/', 155); if (i < 1 || Buffer.byteLength(name.slice(i + 1)) > 100) throw new Error(`tar: path too long for ustar: ${name}`); prefix = name.slice(0, i); base = name.slice(i + 1); }
  const h = Buffer.alloc(512);
  h.write(base, 0, 100); h.write(octal(0o644, 8), 100, 8); h.write(octal(0, 8), 108, 8); h.write(octal(0, 8), 116, 8);
  h.write(octal(size, 12), 124, 12); h.write(octal(0, 12), 136, 12); h.write('        ', 148, 8); h.write('0', 156, 1);
  h.write('ustar\0', 257, 6); h.write('00', 263, 2); h.write(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
const pad = (size) => Buffer.alloc((512 - (size % 512)) % 512);

// THE ENTRY IS FROZEN AT ITS HEADER'S SIZE (2026-10-02 incident): the fleet tapes are appended to live (controller-tick every
// few minutes). The header took statSync's size and the body streamed to EOF, so a row landing mid-bundle wrote 3,282 bytes past
// the declared size; every header after it misaligned, and the archive the site held (b61747ab12) read as controller-tick only:
// no flight tape, no tick record, no panels. The body is now read for exactly the declared bytes, cut back to the last newline
// for an .ndjson so a half-written row never rides. @guard tests/vna/backup-tar-frozen-at-stat.test.mjs
export function frozenSize(abs) {
  const size = statSync(abs).size;
  if (!size || !abs.endsWith('.ndjson')) return size;
  const fd = openSync(abs, 'r');
  try {
    const W = 64 * 1024; const buf = Buffer.alloc(W);
    for (let end = size; end > 0; end -= W) {
      const start = Math.max(0, end - W); const n = readSync(fd, buf, 0, end - start, start);
      const i = buf.subarray(0, n).lastIndexOf(0x0a); if (i >= 0) return start + i + 1;
    }
    return 0;
  } finally { closeSync(fd); }
}
export async function* tarEntries(entries, perFile) {
  for (const { path: p, abs } of entries) {
    const size = frozenSize(abs); const h = createHash('sha256');
    yield tarHeader(p, size);
    if (size > 0) for await (const chunk of createReadStream(abs, { start: 0, end: size - 1 })) { h.update(chunk); yield chunk; }
    yield pad(size);
    perFile.push({ path: p, bytes: size, sha256: h.digest('hex') });
  }
  yield Buffer.alloc(1024);   // end-of-archive
}

const countLines = (abs) => { try { return readFileSync(abs, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

/** C857: the odometer rows for the commits whose flight rows ride in this archive, read off the walk tape's tail (bounded by the oldest
 *  flight row's ts less an hour of slack — a walk is stamped at or after its commit) · { rows, text, field } · the field says what was
 *  read and how much tape it cost; no walk tape on disk → every commit UNMEASURED and the field says why */
export const ODOMETER_TAPE_SLACK_MS = 60 * 60 * 1000;
export const ODOMETER_TAPE_MAX_BYTES = 256 * 1024 * 1024;
export function odometerCarry({ flightRows = [], walkTape = null, maxBytes = ODOMETER_TAPE_MAX_BYTES } = {}) {
  const commits = flightRows.filter((r) => r && r.kind === 'commit' && typeof r.sha === 'string' && /^[0-9a-f]{7,40}$/.test(r.sha));
  const refs = [...new Set(commits.map((r) => r.sha))];
  const oldest = commits.map((r) => Date.parse(r.ts)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  let read = { rows: [], bytesRead: 0, complete: false, size: null }, why = null;
  if (!walkTape || !existsSync(walkTape)) why = `no walk tape at ${walkTape || '(unset)'} — every commit reads UNMEASURED`;
  else if (!refs.length) why = 'the flight tape names no commit in this archive';
  else { try { read = tailRowsSince(walkTape, Number.isFinite(oldest) ? oldest - ODOMETER_TAPE_SLACK_MS : 0, { maxBytes, filter: (r) => r && r.source === 'commit-reality' && r.crossings && typeof r.crossings === 'object' }); } catch (e) { why = `the walk tape could not be read: ${String(e && e.message || e)}`; } }
  const rows = odometerRowsFor(read.rows, refs);
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  const measured = rows.filter((r) => r.status === 'MEASURED').length;
  // readings: the commit-reality rows in the window that carry the crate's integer odometer, in OR out of this range. None at all is a
  // different claim from "these commits have no reading" — the instrument never ran on this tape (walked before the odometer, or a
  // fixture) — so no entry rides and the field says so; the page reads odometer: null (UNMEASURED), never an all-UNMEASURED list that
  // looks like a measurement of each commit.
  const readings = read.rows.filter((r) => r && r.source === 'commit-reality' && odometerCrossingsOf(r.crossings)).length;
  if (!why && refs.length && !readings) why = 'the walk tape carries no commit-reality row with crossings in the window read — no odometer tape rides; every commit reads UNMEASURED';
  return { rows, text, readings, field: { entry: ODOMETER_ENTRY, commits: rows.length, measured, unmeasured: rows.length - measured, readings, tape_bytes_read: read.bytesRead, tape_bytes: read.size, window_complete: !!read.complete, ...(why ? { why } : {}),
    sufficient_for: 'the integer count c of followed steps that crossed the declared lane, per commit, as the one Rust walk emitted it (kE = 3·c milli-units)',
    not_sufficient_for: 'whether a crossing was warranted (Rice); the edges and lane mask themselves stay in the lens JSON on the holder\'s machine' } };
}

export async function bundle({ repo = REPO, source = null, spec = null, tape = null, proofsDir = null, tapes = false, deferSnapshots = null, walkTape = null } = {}) {
  const src = source ? sourceFileList({ source, spec, tape: tape || FLIGHT, proofsDir: proofsDir || PROOFS_DIR }) : null;
  const entries = src ? src.files : (tapes ? tapeFileList(repo) : fileList(repo)).map((p) => ({ path: p, abs: resolve(repo, p) })); const perFile = [];
  const dir = backupDir(repo); mkdirSync(dir, { recursive: true });
  // C506: the panel home rides INSIDE the archive (panels.json, under its sha) — the server only ever sees the archive, so a
  // field kept in the local manifest sidecar alone would never reach the page; a foreign log has no repository, so no entry
  const flightFor = src ? (tape || FLIGHT) : resolve(repo, 'data/vna/flight-tape.ndjson');
  // C647b: the archive also CARRIES the tape commits' panel PNGs (panels/<sha10>.png, read from the git tree at HEAD, newest first
  // under panel-carry.mjs's byte budget and count cap) — the server stores them beside the archive and the slider reads them from
  // there, so a frame never depends on a third party serving the holder's panels, and never on our domain
  const carry = src ? null : (() => { try { return panelsWithCarry({ repo, tape: flightFor }); } catch (e) { return { panels: { base: null, pattern: null, source: null, present: [], carried: [], why: String(e && e.message || e) }, files: [] }; } })();
  const panels = carry ? carry.panels : null;
  const panelsTmp = panels ? resolve(dir, `.panels-${process.pid}.json`) : null;
  if (panelsTmp) { writeFileSync(panelsTmp, JSON.stringify(panels) + '\n'); entries.push({ path: PANELS_ENTRY, abs: panelsTmp }); }
  const carryTmps = [];
  for (const f of carry ? carry.files : []) { const t = resolve(dir, `.panel-${process.pid}-${f.sha10}.png`); writeFileSync(t, f.bytes); carryTmps.push(t); entries.push({ path: PANEL_ENTRY(f.sha10), abs: t }); }
  // THE FLEET TAPES RIDE AS THE TAIL THE PAGE READS (2026-10-02): controller-tick is appended to every few minutes and reached
  // 20.9 MB, which put the --tapes archive at 4.83 MB, over the 4.5 MB upload body, so nothing posted. The reader keeps only the
  // newest ROWS_CAP rows of each tape (receive.mjs), so a --tapes archive carries each fleet tape's last ROWS_CAP rows — sufficient
  // for the page, NOT for the whole fleet history (that stays the local diary) — and the manifest names the cut per tape.
  // @guard tests/vna/backup-tar-frozen-at-stat.test.mjs
  // C565k: the regressed-rows entry (ids only) rides in a --tapes archive when the repo holds an asked-vs-built receipt
  let regressedTmp = null;
  if (tapes && !src) {
    let avb = null; try { avb = JSON.parse(readFileSync(resolve(repo, TAPE_FILES.regressed.from), 'utf8')); } catch { avb = null; }
    const rr = regressedRows(avb);
    if (rr) { regressedTmp = resolve(dir, `.regressed-${process.pid}.json`); writeFileSync(regressedTmp, JSON.stringify(rr) + '\n'); entries.push({ path: TAPE_FILES.regressed.entry, abs: regressedTmp }); }
  }
  // C659: the tokens-per-cog record (numbers only) rides in a --tapes archive when the repo holds a cog ledger
  let tpcTmp = null;
  if (tapes && !src && existsSync(resolve(repo, TAPE_FILES.tokens_per_cog.from.cogRows))) {
    const nd = (rel) => { try { return readFileSync(resolve(repo, rel), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
    let pegJ = null; try { pegJ = JSON.parse(readFileSync(resolve(repo, TAPE_FILES.tokens_per_cog.from.peg), 'utf8')); } catch { pegJ = null; }
    const tpc = tokensPerCogInputs({ cogRows: nd(TAPE_FILES.tokens_per_cog.from.cogRows), spendRows: nd(TAPE_FILES.tokens_per_cog.from.spendRows), peg: pegJ });
    tpcTmp = resolve(dir, `.tokens-per-cog-${process.pid}.json`); writeFileSync(tpcTmp, JSON.stringify(tpc) + '\n'); entries.push({ path: TAPE_FILES.tokens_per_cog.entry, abs: tpcTmp });
  }
  // C896 THE WARRANTY TERMS RIDE INSIDE THE ARCHIVE: .thetacog/warranty-terms.json (written by scripts/vna/warranty.mjs terms) is
  // carried as WARRANTY_ENTRY, under the archive's own sha, when it passes termsOf's shape check — never repaired; a file that fails
  // stays home and the page reads PREVIEW. The server freezes the terms at its own received_at (src/lib/backup/warranty.mjs).
  if (!src) {
    const wt = resolve(repo, WARRANTY_TERMS_FILE);
    if (existsSync(wt) && termsOf(readFileSync(wt))) entries.push({ path: WARRANTY_ENTRY, abs: wt });
  }
  // C903 THE PROVIDER CARD RIDES INSIDE THE ARCHIVE the same way the warranty terms do: .thetacog/provider.json, carried as
  // PROVIDER_ENTRY, under the archive's own sha, when it passes cardOf's shape check — never repaired; a file that fails the
  // check stays home and no card rides (src/lib/backup/provider-card.mjs).
  if (!src) {
    const pc = resolve(repo, PROVIDER_CARD_FILE);
    if (existsSync(pc) && cardOf(readFileSync(pc))) entries.push({ path: PROVIDER_ENTRY, abs: pc });
  }
  // C648 THE ANATOMY RIDES WITH THE TAPE: the ω-tuple rows for the commits taped since the last posted backup ride as ANATOMY_ENTRY.
  // What rides — tuple (public) · tuple + span bytes · commitments only (private) — is the holder's setting plus a check (anatomy.mjs
  // resolveCarry); the manifest prints the setting and its cost. No anatomy tape on disk → no entry and no field (nothing was retained).
  let anatomyTmp = null, anatomy = null;
  if (!src && existsSync(anatomyTapePath(repo))) {
    try { const a = anatomyCarry({ repo, flightPath: flightFor, backupDir: dir }); anatomy = a.field; anatomyTmp = resolve(dir, `.anatomy-${process.pid}.ndjson`); writeFileSync(anatomyTmp, a.text); entries.push({ path: ANATOMY_ENTRY, abs: anatomyTmp }); }
    catch (e) { anatomy = { entry: ANATOMY_ENTRY, rows: null, why: String(e && e.message || e) }; }
  }
  // C667d THE TESSERACT RIDES EVERY STEP: retain the live state (content-addressed, idempotent), then carry every snapshot the commits
  // taped since the last posted backup name — the anatomy row's own stamp first, else the flight tape's signed proofs.tesseract_sha —
  // first one full, the rest as deltas, text or hashes by the holder's setting. A named state the store does not hold is LISTED
  // (missing_with_anatomy is the guard's set), never silently dropped. @guard tests/vna/c667d-the-tesseract-rides-every-step.test.mjs
  let snapTmp = null, tesseract_snapshots = null;
  if (!src) {
    try {
      const store = snapshotStorePath(repo);
      if (existsSync(resolve(repo, 'data/vna/tesseract-state.json'))) retainLive({ repo, store });
      const since = snapshotWindowHeight(dir);
      const aRows = existsSync(anatomyTapePath(repo)) ? readAnatomy(anatomyTapePath(repo)) : [];
      const setting = readAnatomySetting(anatomySettingPath(repo));
      const decided = resolveTesseractCarry({ setting, visibility: anatomy && anatomy.visibility || (setting && setting.visibility) || null });
      const c = snapshotCarryFor({ flightRows: nd(flightFor), anatomyRows: aRows, since, rows: readSnapshotStore(store), mode: decided.mode });
      if (deferSnapshots) tesseract_snapshots = { ...c.field, carried: 0, deferred: true, why: deferSnapshots };
      else { tesseract_snapshots = { ...c.field, why: decided.why }; if (c.rows.length) { snapTmp = resolve(dir, `.tesseract-snapshots-${process.pid}.ndjson`); writeFileSync(snapTmp, c.text); entries.push({ path: SNAPSHOTS_ENTRY, abs: snapTmp }); } }   // no named state held → no entry (the field still says what was named)
    } catch (e) { tesseract_snapshots = { entry: SNAPSHOTS_ENTRY, carried: null, why: String(e && e.message || e) }; }
  }
  // C857 THE KE COUNT RIDES THE BACKUP: in a --tapes archive (the one that ships; the walk tape stays the local diary there) one odometer
  // row per commit whose flight row rides — the newest ROWS_CAP, the rows the page reads — read off the walk tape's tail. The entry rides
  // only when the tape carries an odometer at all (odometerCarry readings > 0); the manifest field rides either way and says why.
  // @guard tests/vna/ke-count-rides-the-backup.test.mjs
  let odoTmp = null, odometer = null;
  if (tapes && !src) {
    try {
      const o = odometerCarry({ flightRows: nd(flightFor).slice(-ROWS_CAP), walkTape: walkTape || process.env.PMU_WALK_TAPE || resolve(repo, TAPE_FILES.odometer.from) });
      odometer = o.field;
      if (o.readings > 0) { odoTmp = resolve(dir, `.odometer-${process.pid}.ndjson`); writeFileSync(odoTmp, o.text); entries.push({ path: TAPE_FILES.odometer.entry, abs: odoTmp }); }
    } catch (e) { odometer = { entry: ODOMETER_ENTRY, commits: null, why: String(e && e.message || e) }; }
  }
  // C705f (2026-10-09): the flight tape (18.9 MB) and the attestations (3.6 MB) put the --tapes archive at 5.23 MB, over the
  // 4.5 MB upload body, so every ship since 10-05 posted nothing and the public /tail froze on a six-day-old backup. The
  // reader keeps the newest ROWS_CAP flight-tape rows (receive.mjs) and no page reads the attestations, so both ride as their
  // tail like the fleet tapes. steer-ab-tokens (the tick record the exceedance graph reads WHOLE) is never tailed.
  // @guard tests/vna/c705f-tapes-archive-fits-the-upload.test.mjs
  const tails = []; const tailTmps = [];
  if (tapes && !src) for (const e of entries) {
    if (!(e.path.startsWith(`${TAPE_FILES.fleet.dir}/`) || TAILED_TAPES.includes(e.path))) continue;
    const size = frozenSize(e.abs); if (!size) continue;
    const fd = openSync(e.abs, 'r'); const buf = Buffer.alloc(size); try { readSync(fd, buf, 0, size, 0); } finally { closeSync(fd); }
    const lines = buf.toString('utf8').split('\n').filter(Boolean); if (lines.length <= ROWS_CAP) continue;
    const t = resolve(dir, `.tail-${process.pid}-${basename(e.abs)}`); writeFileSync(t, lines.slice(-ROWS_CAP).join('\n') + '\n');
    tailTmps.push(t); tails.push({ path: e.path, rows_kept: ROWS_CAP, rows_total: lines.length }); e.abs = t;
  }
  const tmp = resolve(dir, `.bundling-${process.pid}.tar.gz`);
  const hash = createHash('sha256'); let bytes = 0;
  const tee = new Transform({ transform(c, _e, cb) { hash.update(c); bytes += c.length; cb(null, c); } });
  await pipeline(Readable.from(tarEntries(entries, perFile)), createGzip(), tee, createWriteStream(tmp));
  const sha = hash.digest('hex');
  renameSync(tmp, resolve(dir, `${sha}.tar.gz`));
  if (panelsTmp) { try { unlinkSync(panelsTmp); } catch {} }
  for (const t of carryTmps) { try { unlinkSync(t); } catch {} }
  if (regressedTmp) { try { unlinkSync(regressedTmp); } catch {} }
  if (tpcTmp) { try { unlinkSync(tpcTmp); } catch {} }
  for (const t of tailTmps) { try { unlinkSync(t); } catch {} }
  if (anatomyTmp) { try { unlinkSync(anatomyTmp); } catch {} }
  if (snapTmp) { try { unlinkSync(snapTmp); } catch {} }
  if (odoTmp) { try { unlinkSync(odoTmp); } catch {} }
  // C667d: a --tapes archive must fit one POST body. When the snapshot entry is what pushes it over, the archive is rebuilt without
  // it and the manifest says deferred — the window does not advance (snapshotWindowHeight), so the states ride the next archive
  if (tapes && snapTmp && bytes + FORM_HEADROOM > UPLOAD_BODY_LIMIT) {
    try { unlinkSync(resolve(dir, `${sha}.tar.gz`)); } catch {}
    return bundle({ repo, source, spec, tape, proofsDir, tapes, walkTape, deferSnapshots: `the archive with the snapshots is ${bytes} bytes, over the ${UPLOAD_BODY_LIMIT}-byte body less ${FORM_HEADROOM} — deferred to the next archive (the window does not advance)` });
  }
  let tesseract_sha = null; try { tesseract_sha = JSON.parse(readFileSync(resolve(repo, 'data/vna/tesseract-state.json'), 'utf8')).tesseract_sha || null; } catch {}
  // C73: a foreign log has no repository — head stays null; the repo path only asks git when there is a repo to ask
  let head = null; if (!src) { try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {} }
  const flight = src ? (tape || FLIGHT) : resolve(repo, 'data/vna/flight-tape.ndjson');
  let chain_verified = false; try { chain_verified = existsSync(flight) ? !!verifyTape(flight).ok : false; } catch { chain_verified = false; }
  const walk = resolve(repo, '.thetacog/walk-tape.ndjson');
  const rows = { ...(existsSync(walk) && !tapes && !src ? { walk_tape: countLines(walk) } : {}), flight_tape: countLines(flight) };   // C505: a --tapes archive does not hold the walk tape, so it carries no walk count   // absent → omitted, never 0
  const manifest = {
    v: 1, sha, bytes, at: new Date().toISOString(), head,
    ...(src ? { source: { kind: 'batch', actor: src.actor, log: basename(source), sha: src.sha, rows: src.rows } } : {}),
    rows,
    ...(tapes && !src ? { scope: 'tapes', local_diary: { files: [...TAPE_FILES.local_diary], why: 'the walk tape, its attestation, the tesseract state and the proofs stay on this machine as the local diary — not in this archive' } } : {}),
    // C506: the panels live where the HOLDER publishes them (their repository, never our domain) — base + pattern from
    // panel-home.mjs, present = the tape's commit rows whose panel file is in the git tree at HEAD; a foreign log has no repo
    ...(panels ? { panels } : {}),
    ...(tails.length ? { tails: { files: tails, why: `each fleet tape, the flight tape and the attestations ride as their newest ${ROWS_CAP} rows, the rows the page reads; the whole tape stays the local diary` } } : {}),
    ...(anatomy ? { anatomy } : {}),   // C648: the setting, the delta it carried, and its bytes
    ...(tesseract_snapshots ? { tesseract_snapshots } : {}),   // C667d: the states carried, the setting, what was named and not held
    ...(odometer ? { odometer } : {}),   // C857: the commits carried with a count, the ones UNMEASURED, and what the tape read cost
    chain_verified, tesseract_sha, files: perFile, url: backupUrl(sha),
    site: 'login, upload against this sha, and the licence (measurement free, underwriting paid) happen on the site — never in the extension',
  };
  writeFileSync(resolve(dir, `${sha}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// ── C102c THE BACKUP IS A POST FROM THE EXTENSION (operator 2026-09-20: "when you say back this off you don't upload a file which
// you won't even be able to find when you open the Finder — it has to be a post from the extension that posts to our site, and if
// it uploads a compressed file we have a bucket set up for that"). The archive bundle() wrote under .thetacog/backup/ is POSTed
// as the same multipart the /backup form sends ({ manifest, file }) with the entitlement as the bearer; the site answers JSON
// with the receipt and the manifest URL, which is written beside the archive (<sha>.upload.json — the card reads it). No save
// dialog, no path shown, nothing written outside .thetacog/. `fetch` is injected so the guard drives the real route in-process.
export const UPLOAD_ENDPOINT = process.env.VNA_BACKUP_UPLOAD || 'https://thetadriven.com/api/backup/upload';
// C135 — THE TIMESTAMP OF THE HANDSHAKE (operator 2026-09-21: "flash the exact timestamp of the cryptographic lock on the UI").
// The upload receipt carries `countersigned_at` — the ISO instant of the lock — and `at_source` says where it came from:
// 'server' = the site's receipt.received_at (the store's own clock, the instant the receipt was written); 'header' = the
// response's Date header, normalised to ISO, when the body carries no received_at; 'local' = this machine's clock at receipt
// time when neither answered. Named so a card can print "countersigned <at> (<source>)" and never pass a local clock off as
// the server's. The status line (vna-steer.ts backupTape) and the card both read these two names.
export const COUNTERSIGN_FIELDS = Object.freeze({ at: 'countersigned_at', source: 'at_source' });
const isoOrNull = (v) => { if (!v) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
export function countersignInstant({ receipt = null, headers = null, now = () => new Date().toISOString() } = {}) {
  const server = isoOrNull(receipt && receipt.received_at); if (server) return { countersigned_at: server, at_source: 'server' };
  let date = null; try { date = headers && typeof headers.get === 'function' ? isoOrNull(headers.get('date')) : null; } catch { date = null; }
  if (date) return { countersigned_at: date, at_source: 'header' };
  return { countersigned_at: now(), at_source: 'local' };
}
// C505: the platform refuses a function body over 4.5 MB with a bare 413. The archive is measured BEFORE the POST and refused
// here with its byte count; FORM_HEADROOM is room for the multipart envelope (boundary, field headers, the manifest field).
export const UPLOAD_BODY_LIMIT = 4_500_000;
export const TAILED_TAPES = Object.freeze(['data/vna/flight-tape.ndjson', 'data/vna/attestations.ndjson']);   // C705f: ride as their newest ROWS_CAP rows
export const FORM_HEADROOM = 8 * 1024;
export async function uploadBackup({ sha, repo = REPO, endpoint = UPLOAD_ENDPOINT, bearer = process.env.NOTARY_BEARER || storeBearer() || null, fetch = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(sha))) return { ok: false, sha: null, url: null, receipt: null, why: 'uploadBackup: the manifest sha must be sha256 hex' };
  const archive = resolve(backupDir(repo), `${sha}.tar.gz`);
  if (!existsSync(archive)) return { ok: false, sha, url: null, receipt: null, why: `no archive at .thetacog/backup/${sha}.tar.gz — run the backup first` };
  const size = statSync(archive).size;
  if (size + FORM_HEADROOM > UPLOAD_BODY_LIMIT) return { ok: false, sha, url: null, receipt: null, bytes: size, why: `the archive is ${size} bytes — over the ${UPLOAD_BODY_LIMIT}-byte upload body limit (less ${FORM_HEADROOM} for the form); nothing posted — \`--tapes\` bundles only the tapes the page reads` };
  if (!bearer) return { ok: false, sha, url: null, receipt: null, why: 'no entitlement — the backup is receipted to an account; 💳 first (C102a)' };
  const bytes = readFileSync(archive);
  const form = new FormData(); form.set('manifest', sha); form.set('file', new Blob([bytes], { type: 'application/gzip' }), `${sha}.tar.gz`);
  let res; try { res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, body: form }); }
  catch (e) { return { ok: false, sha, url: null, receipt: null, why: `POST ${endpoint}: ${e && e.message || e}` }; }
  let body = null; try { body = await res.json(); } catch { body = null; }
  if (res.status !== 200 || !body || !body.receipt) return { ok: false, sha, url: null, receipt: null, status: res.status, why: (body && body.why) || `the upload answered ${res.status}` };
  const url = body.url || `/backup?manifest=${sha}`;
  const out = { ok: true, sha, url, receipt: body.receipt, replay: !!body.replay, bytes: bytes.length, at: now(), endpoint, ...countersignInstant({ receipt: body.receipt, headers: res.headers, now }) };   // C135: the lock's instant and its source
  writeFileSync(resolve(backupDir(repo), `${sha}.upload.json`), JSON.stringify(out, null, 2) + '\n');   // beside the archive, inside .thetacog/
  return out;
}
// C532 CADENCE IS PER SHIP: bundle, then upload ONLY IF this sha has never been posted. The receipt file is named by the sha
// (<sha>.upload.json, written by uploadBackup) — its existence beside the archive IS the content-addressed check: the same
// tape bundles to the same sha, so a ship run back-to-back with no new flight-tape rows finds its own prior receipt and never
// calls fetch. A changed tape bundles to a new sha, which has no receipt yet, and posts.
// C651a THE WALK TAPE RIDES TOO: a --tapes ship also posts the walk tape's pending SEGMENTS (walk-segments.mjs) — only the rows
// past the last acknowledged segment, each chained to the one before, each under the POST body cap, carried as the holder's
// setting says (default hashes-only, never prompt text silently). They ride whether or not the tapes archive changed.
export async function uploadIfChanged({ repo = REPO, tapes = false, bearer = process.env.NOTARY_BEARER || storeBearer() || null, fetch = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const manifest = await bundle({ repo, tapes });
  const receiptPath = resolve(backupDir(repo), `${manifest.sha}.upload.json`);
  const walk = async () => { if (!tapes) return {}; const { uploadWalkSegments } = await import('./walk-segments.mjs'); return { walk_segments: await uploadWalkSegments({ repo, bearer, fetch, now }) }; };
  if (existsSync(receiptPath)) {
    const prior = JSON.parse(readFileSync(receiptPath, 'utf8'));
    return { ...prior, skipped: true, manifest, why: 'unchanged tape — this sha was already posted, content-addressed, nothing uploaded', ...(await walk()) };
  }
  const uploaded = await uploadBackup({ sha: manifest.sha, repo, bearer, fetch, now });
  return { ...uploaded, skipped: false, manifest, ...(await walk()) };
}

// C109o — the 3rd-party-backups count for the 💳 metric (C113h: `<n> countersigned receipts · <n> 3rd-party backups`): the
// posted upload receipts under the backup dir, read, never typed; null (UNMEASURED) when the dir does not exist — never a
// zero for an absence
export function backupsPosted({ repo = REPO, dir = backupDir(repo) } = {}) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter((f) => f.endsWith('.upload.json')).length;
}
// C113h — THE 💳 IS THREE PARTS: label · <n> countersigned receipts · <n> 3rd-party backups, read off the upload receipts
// (operator 2026-09-20: "0 countersigned receipts - 0 3rd party backups — they are two numbers, local backup is the diary,
// 3rd party is obviously backed up"). Superseded C111's single-number "<n> countersigned receipts backed up". The two counts
// below are already this pair: backedUp is the countersigned-receipts number (the local diary, licensed rows within the
// posted prefix), backups is the 3rd-party-backups number (posted upload receipts). Each posted `<sha>.upload.json` names
// its manifest; the manifest's `rows.flight_tape` is the tape height that
// archive holds — the tape is append-only and chain-verified at bundle time, so an archive at height N holds rows 1..N and the
// highest posted height is the prefix a lead can fetch. backedUp = the LICENSED rows (licenceOf, C90) among that prefix.
// Nothing posted → a measured 0 (the tape is on disk, the upload set is empty — not an absence of measurement); no tape → null.
export function countersignedBackedUp({ repo = REPO, dir = backupDir(repo), tape = FLIGHT } = {}) {
  if (!existsSync(tape)) return null;
  const rows = nd(tape);
  let backups = 0, height = 0;
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.upload.json'))) {
      let up = null; try { up = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; }
      const sha = up && up.sha ? String(up.sha) : f.slice(0, -'.upload.json'.length);
      let man = null; try { man = JSON.parse(readFileSync(resolve(dir, `${sha}.manifest.json`), 'utf8')); } catch { man = null; }
      backups += 1;
      const h = man && man.rows && Number.isFinite(man.rows.flight_tape) ? man.rows.flight_tape : 0;   // a receipt with no manifest beside it covers no height — never a guess
      if (h > height) height = h;
    }
  }
  const backedUp = rows.slice(0, height).filter((r) => { try { return licenceOf(r).status === 'LICENSED'; } catch { return false; } }).length;
  return { backedUp, backups, height };
}
// the card's line (C102c): the newest upload receipt's URL, else what is bundled and not yet posted — read, never typed
export function backupCardLine({ repo = REPO } = {}) {
  const dir = backupDir(repo); if (!existsSync(dir)) return 'no backup yet — 🔗 posts the tape to the third party';
  const files = readdirSync(dir); const ups = files.filter((f) => f.endsWith('.upload.json')).map((f) => { try { return JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { return null; } }).filter((u) => u && u.url).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (ups.length) return `${ups[ups.length - 1].url} · ${ups.length} posted`;
  const bundled = files.filter((f) => f.endsWith('.tar.gz')).length;
  return `no backup posted yet — ${bundled} bundled`;
}

// ── the same format back, streamed ──────────────────────────────────────────────────────────────────────────────────
async function readTar(archive, onEntry) {
  let buf = Buffer.alloc(0); let cur = null;   // cur = { path, size, left, hash }
  const parse = () => {
    for (;;) {
      if (cur) {
        if (cur.left > 0) { const take = Math.min(cur.left, buf.length); if (!take) return; cur.hash.update(buf.subarray(0, take)); cur.left -= take; buf = buf.subarray(take); if (cur.left > 0) return; }
        const padLen = (512 - (cur.size % 512)) % 512; if (buf.length < padLen) return; buf = buf.subarray(padLen);
        onEntry({ path: cur.path, bytes: cur.size, sha256: cur.hash.digest('hex') }); cur = null;
      }
      if (buf.length < 512) return;
      const h = buf.subarray(0, 512); buf = buf.subarray(512);
      if (h.every((b) => b === 0)) return;   // end-of-archive
      const str = (o, n) => h.toString('utf8', o, o + n).replace(/\0.*$/s, '');
      const prefix = str(345, 155); const name = (prefix ? prefix + '/' : '') + str(0, 100);
      cur = { path: name, size: parseInt(str(124, 12), 8) || 0, left: parseInt(str(124, 12), 8) || 0, hash: createHash('sha256') };
    }
  };
  const sink = new Transform({ transform(c, _e, cb) { buf = buf.length ? Buffer.concat([buf, c]) : c; parse(); cb(); } });
  await pipeline(createReadStream(archive), createGunzip(), sink);
}

export async function verifyBackup(sha, { repo = REPO } = {}) {
  const dir = backupDir(repo); const archive = resolve(dir, `${sha}.tar.gz`); const mpath = resolve(dir, `${sha}.manifest.json`);
  if (!existsSync(archive) || !existsSync(mpath)) return { ok: false, why: 'no archive or manifest for that sha', archive_sha_ok: false, files: [] };
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'));
  const h = createHash('sha256'); for await (const c of createReadStream(archive)) h.update(c);
  const archive_sha_ok = h.digest('hex') === sha && manifest.sha === sha;
  const seen = new Map(); let readErr = null;
  try { await readTar(archive, (e) => seen.set(e.path, e)); } catch (e) { readErr = e.message; }
  const files = manifest.files.map((f) => { const s = seen.get(f.path); return { path: f.path, ok: !!s && s.sha256 === f.sha256 && s.bytes === f.bytes, why: !s ? 'missing from the archive' : s.sha256 !== f.sha256 ? 'sha256 differs' : null }; });
  const ok = archive_sha_ok && !readErr && files.every((f) => f.ok) && seen.size === files.length;
  return { ok, sha, archive_sha_ok, files, extra: [...seen.keys()].filter((p) => !manifest.files.some((f) => f.path === p)), readErr, manifest: { rows: manifest.rows, chain_verified: manifest.chain_verified, tesseract_sha: manifest.tesseract_sha, at: manifest.at, head: manifest.head } };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
  if (argv.includes('--verify')) {
    const sha = argv[argv.indexOf('--verify') + 1];
    const v = await verifyBackup(sha);
    if (asJson) console.log(JSON.stringify(v)); else console.log(v.ok ? `backup ${sha.slice(0, 12)} · archive recomputes to its sha · ${v.files.length} entries verify · chain ${v.manifest.chain_verified ? 'VERIFIES' : 'BROKEN'}` : `backup ${String(sha).slice(0, 12)} FAILS: ${v.why || (!v.archive_sha_ok ? 'archive bytes do not hash to the sha' : v.readErr || v.files.filter((f) => !f.ok).map((f) => `${f.path}: ${f.why}`).join(' · ') || `${v.extra.length} entries not on the manifest`)}`);
    process.exitCode = v.ok ? 0 : 1;   // set, never exit — a piped stdout drains after the write
  } else if (argv.includes('--upload')) {
    // C102c: bundle, then POST — one door; the bearer rides the environment (NOTARY_BEARER), never argv
    // C532: uploadIfChanged skips the POST entirely when this sha was already posted — an unchanged tape uploads nothing
    const r = await uploadIfChanged({ tapes: argv.includes('--tapes') });
    if (asJson) console.log(JSON.stringify(r));
    else console.log(r.skipped ? `backup ${r.manifest.sha.slice(0, 12)} unchanged — already posted · ${r.url}` : r.ok ? `backup ${r.manifest.sha.slice(0, 12)} posted · ${r.url}` : `backup ${r.manifest.sha.slice(0, 12)} NOT posted — ${r.why}`);
    process.exitCode = r.ok === false ? 1 : 0;
  } else {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const source = arg('--source'), spec = arg('--spec');
  const m = await bundle(source ? { source: resolve(source), spec: spec ? resolve(spec) : null } : { tapes: argv.includes('--tapes') });
  if (asJson) console.log(JSON.stringify(m));
  else console.log(`backup ${m.sha.slice(0, 12)} · ${(m.bytes / 1048576).toFixed(1)} MB · ${m.files.length} files · ${m.source ? `source ${m.source.log} (${m.source.actor || 'untaped'}, ${m.source.rows} batch row${m.source.rows === 1 ? '' : 's'}) · ` : m.scope === 'tapes' ? `tapes only (walk tape + proofs stay the local diary) · ` : `walk ${m.rows.walk_tape ?? 'UNMEASURED'} rows · `}flight ${m.rows.flight_tape} rows · chain ${m.chain_verified ? 'VERIFIES' : 'BROKEN'} · tesseract ${m.tesseract_sha ? m.tesseract_sha.slice(0, 12) : '—'}\n  archive  .thetacog/backup/${m.sha}.tar.gz\n  open     ${m.url}\n  (login, upload and the licence happen on the site — this script sent nothing)`);
  }
}
