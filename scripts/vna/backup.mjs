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
// CONTENT-ADDRESSED MEANS CONTENT → ADDRESS. `tar` on this machine (bsdtar) writes mtimes, uids and a gzip timestamp, so the
// same bytes would bundle to a different sha every minute. The ustar writer below fixes every header field the content does
// not determine (mtime 0, uid/gid 0, mode 0644) and node's zlib writes no gzip timestamp — so the guard can say: same bytes,
// same sha; one changed row, a different sha. The reader is the same format back, streamed, so `--verify` never holds the
// 100+ MB walk tape in memory.
//
//   node scripts/vna/backup.mjs [--json]          bundle, write the manifest, print the URL
//   node scripts/vna/backup.mjs --upload [--json] C102c: bundle, then POST it to /api/backup/upload with NOTARY_BEARER; print the manifest URL
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
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verify as verifyTape, FLIGHT, PROOFS_DIR, licenceOf } from './flight-tape.mjs';   // C111: licenceOf counts the countersigned rows inside a posted height

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SITE = 'https://thetadriven.com/backup';

// The file set is DECLARED, not discovered: the tape, the proofs, the tesseract state — what the row names, nothing else.
export const BACKUP_FILES = Object.freeze({
  fixed: Object.freeze(['.thetacog/walk-tape.ndjson', '.thetacog/walk-tape.attestation.json', 'data/vna/flight-tape.ndjson', 'data/vna/attestations.ndjson', 'data/vna/tesseract-state.json']),
  glob: Object.freeze({ dir: 'data/vna/proofs', ext: '.json' }),
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

async function* tarEntries(entries, perFile) {
  for (const { path: p, abs } of entries) {
    const size = statSync(abs).size; const h = createHash('sha256');
    yield tarHeader(p, size);
    for await (const chunk of createReadStream(abs)) { h.update(chunk); yield chunk; }
    yield pad(size);
    perFile.push({ path: p, bytes: size, sha256: h.digest('hex') });
  }
  yield Buffer.alloc(1024);   // end-of-archive
}

const countLines = (abs) => { try { return readFileSync(abs, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

export async function bundle({ repo = REPO, source = null, spec = null, tape = null, proofsDir = null } = {}) {
  const src = source ? sourceFileList({ source, spec, tape: tape || FLIGHT, proofsDir: proofsDir || PROOFS_DIR }) : null;
  const entries = src ? src.files : fileList(repo).map((p) => ({ path: p, abs: resolve(repo, p) })); const perFile = [];
  const dir = backupDir(repo); mkdirSync(dir, { recursive: true });
  const tmp = resolve(dir, `.bundling-${process.pid}.tar.gz`);
  const hash = createHash('sha256'); let bytes = 0;
  const tee = new Transform({ transform(c, _e, cb) { hash.update(c); bytes += c.length; cb(null, c); } });
  await pipeline(Readable.from(tarEntries(entries, perFile)), createGzip(), tee, createWriteStream(tmp));
  const sha = hash.digest('hex');
  renameSync(tmp, resolve(dir, `${sha}.tar.gz`));
  let tesseract_sha = null; try { tesseract_sha = JSON.parse(readFileSync(resolve(repo, 'data/vna/tesseract-state.json'), 'utf8')).tesseract_sha || null; } catch {}
  // C73: a foreign log has no repository — head stays null; the repo path only asks git when there is a repo to ask
  let head = null; if (!src) { try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {} }
  const flight = src ? (tape || FLIGHT) : resolve(repo, 'data/vna/flight-tape.ndjson');
  let chain_verified = false; try { chain_verified = existsSync(flight) ? !!verifyTape(flight).ok : false; } catch { chain_verified = false; }
  const walk = resolve(repo, '.thetacog/walk-tape.ndjson');
  const rows = { ...(existsSync(walk) ? { walk_tape: countLines(walk) } : {}), flight_tape: countLines(flight) };   // absent → omitted, never 0
  const manifest = {
    v: 1, sha, bytes, at: new Date().toISOString(), head,
    ...(src ? { source: { kind: 'batch', actor: src.actor, log: basename(source), sha: src.sha, rows: src.rows } } : {}),
    rows,
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
export async function uploadBackup({ sha, repo = REPO, endpoint = UPLOAD_ENDPOINT, bearer = process.env.NOTARY_BEARER || null, fetch = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(sha))) return { ok: false, sha: null, url: null, receipt: null, why: 'uploadBackup: the manifest sha must be sha256 hex' };
  const archive = resolve(backupDir(repo), `${sha}.tar.gz`);
  if (!existsSync(archive)) return { ok: false, sha, url: null, receipt: null, why: `no archive at .thetacog/backup/${sha}.tar.gz — run the backup first` };
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
    const m = await bundle({}); const u = await uploadBackup({ sha: m.sha });
    if (asJson) console.log(JSON.stringify({ ...u, manifest: m })); else console.log(u.ok ? `backup ${m.sha.slice(0, 12)} posted · ${u.url}` : `backup ${m.sha.slice(0, 12)} NOT posted — ${u.why}`);
    process.exitCode = u.ok ? 0 : 1;
  } else {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const source = arg('--source'), spec = arg('--spec');
  const m = await bundle(source ? { source: resolve(source), spec: spec ? resolve(spec) : null } : {});
  if (asJson) console.log(JSON.stringify(m));
  else console.log(`backup ${m.sha.slice(0, 12)} · ${(m.bytes / 1048576).toFixed(1)} MB · ${m.files.length} files · ${m.source ? `source ${m.source.log} (${m.source.actor || 'untaped'}, ${m.source.rows} batch row${m.source.rows === 1 ? '' : 's'}) · ` : `walk ${m.rows.walk_tape ?? 'UNMEASURED'} rows · `}flight ${m.rows.flight_tape} rows · chain ${m.chain_verified ? 'VERIFIES' : 'BROKEN'} · tesseract ${m.tesseract_sha ? m.tesseract_sha.slice(0, 12) : '—'}\n  archive  .thetacog/backup/${m.sha}.tar.gz\n  open     ${m.url}\n  (login, upload and the licence happen on the site — this script sent nothing)`);
  }
}
