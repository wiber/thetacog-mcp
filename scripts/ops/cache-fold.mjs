// C826c — THE CACHE FOLD: per-run files in .thetacog/cache become one daily tape per family, never a new file per run.
// 2026-10-15: .thetacog/cache held 99,286 loose files (20 GB) in one flat folder: 15,189 post-commit-<sha>, 7,556
// trailer-suggester-<sha>, 7,523 pmu-measure-<sha>, 4,094 envelope-<sha> (11 GB) … every commit wrote ten more and nothing
// ever folded them, so every readdir, Spotlight pass and fseventsd scan paid for the whole pile. A file is folded only
// when ALL hold: it sits at the top of the cache (never a subfolder), its name carries a variable token (a hex sha with
// a digit, or a run of 4+ digits: a pid, a date) so a fixed-name log is never touched, and it is older than MIN_AGE (24 h;
// readers of a per-commit log read it within minutes). The record is RETAINED, never evicted (AXIOM 1): each file is
// appended as one gzip member to folded/<family>-<YYYY-MM-DD>.tape.gz behind a header line, the append is read back,
// and only then is the loose file removed. `--cat <name>` reads one back. Runs from mem.mjs --reap on the 5-minute tick,
// bounded per run by count and by bytes so the first fold of the backlog never becomes the thrash it removes.
import { readdirSync, readFileSync, statSync, rmSync, appendFileSync, mkdirSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = resolve(REPO, '.thetacog/cache');
export const MIN_AGE_MS = 24 * 3600 * 1000;
export const MAX_FILES_PER_RUN = 3000;
export const MAX_BYTES_PER_RUN = 300 * 1024 * 1024;
export const LEDGER = resolve(REPO, '.thetacog/cache-fold.ndjson');

const HEX = /^(?=[0-9a-f]*\d)[0-9a-f]{7,}/;
const DIGITS = /^\d{4,}/;
/** The family a per-run file belongs to: the name up to its first variable token. null = a fixed name, never folded. */
export function familyOf(name) {
  if (name.startsWith('.') || /\.(lock|pid|sock)$/.test(name)) return null;   // a dotfile or a lock can belong to a live process
  const segs = name.split('-');
  for (let i = 1; i < segs.length; i++) if (HEX.test(segs[i]) || DIGITS.test(segs[i])) return segs.slice(0, i).join('-');
  return null;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const header = (name, st) => `\n=== ${name} mtime=${new Date(st.mtimeMs).toISOString()} bytes=${st.size}\n`;

/** Append one member and read the tail back: the member we wrote must be the last bytes of the tape. */
function appendVerified(tape, member) {
  appendFileSync(tape, member);
  const fd = openSync(tape, 'r');
  try {
    const size = fstatSync(fd).size; if (size < member.length) return false;
    const tail = Buffer.alloc(member.length); readSync(fd, tail, 0, member.length, size - member.length);
    return tail.equals(member);
  } finally { closeSync(fd); }
}

/** Append one record to a tape as its own gzip member: the writer side every per-run generator uses instead of a new file. */
export function appendMember(tape, name, body, mtimeMs = Date.now()) {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  mkdirSync(dirname(tape), { recursive: true });
  return appendVerified(tape, gzipSync(Buffer.concat([Buffer.from(header(name, { mtimeMs, size: b.length })), b])));
}

/** Every record on a tape, in write order: { name, mtime, body }. The header carries the length, so a body may hold anything. */
export function* members(tape) {
  let buf; try { buf = gunzipSync(readFileSync(tape)); } catch { return; }
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf(10, i + 1); if (eol < 0) return;
    const m = /^=== (\S+) mtime=(\S+) bytes=(\d+)$/.exec(buf.subarray(i + 1, eol).toString()); if (!m) return;
    const n = Number(m[3]); yield { name: m[1], mtime: m[2], body: buf.subarray(eol + 1, eol + 1 + n) };
    i = eol + 1 + n;
  }
}

export function fold({ dir = CACHE, family = familyOf, now = Date.now(), minAgeMs = MIN_AGE_MS, maxFiles = MAX_FILES_PER_RUN, maxBytes = MAX_BYTES_PER_RUN, dryRun = false, ledger = LEDGER } = {}) {
  const out = { entries: 0, eligible: 0, folded: 0, bytes: 0, families: {}, error: null };
  const tapes = resolve(dir, 'folded');
  let names; try { names = readdirSync(dir, { withFileTypes: true }); } catch (e) { out.error = String(e.message); return out; }
  for (const e of names) {
    out.entries++;
    if (!e.isFile()) continue;
    const fam = family(e.name); if (!fam) continue;
    const p = join(dir, e.name);
    let st; try { st = statSync(p); } catch { continue; }
    if (now - st.mtimeMs < minAgeMs) continue;
    out.eligible++;
    if (dryRun || out.folded >= maxFiles || out.bytes >= maxBytes) continue;
    let body; try { body = readFileSync(p); } catch { continue; }
    const member = gzipSync(Buffer.concat([Buffer.from(header(e.name, st)), body]));
    mkdirSync(tapes, { recursive: true });
    const tape = join(tapes, `${fam}-${day(st.mtimeMs)}.tape.gz`);
    if (!appendVerified(tape, member)) { out.error = `append did not verify on ${tape}; stopped`; break; }
    rmSync(p, { force: true });
    out.folded++; out.bytes += st.size; out.families[fam] = (out.families[fam] || 0) + 1;
  }
  if (!dryRun && out.folded) {
    try { mkdirSync(dirname(ledger), { recursive: true }); appendFileSync(ledger, JSON.stringify({ ts: new Date(now).toISOString(), folded: out.folded, bytes: out.bytes, eligible_left: out.eligible - out.folded, families: out.families }) + '\n'); } catch {}
  }
  return out;
}

/** Read one folded file back by its original name: the record stays reachable after the fold. */
export function cat(name, { dir = CACHE } = {}) {
  const fam = familyOf(name); if (!fam) return null;
  const tapes = resolve(dir, 'folded');
  let list; try { list = readdirSync(tapes).filter((t) => t.startsWith(fam + '-') && t.endsWith('.tape.gz')).sort().reverse(); } catch { return null; }
  const mark = Buffer.from(`\n=== ${name} mtime=`);
  for (const t of list) {
    const buf = gunzipSync(readFileSync(join(tapes, t)));
    const at = buf.lastIndexOf(mark); if (at < 0) continue;
    const eol = buf.indexOf(10, at + 1);
    const n = Number((/bytes=(\d+)$/.exec(buf.subarray(at + 1, eol).toString()) || [])[1]);
    return buf.subarray(eol + 1, eol + 1 + n).toString('utf8');   // the header carries the length: no scan for the next header
  }
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  if (a[0] === '--cat') { const t = cat(a[1]); if (t == null) { console.error(`not folded: ${a[1]}`); process.exit(1); } process.stdout.write(t); }
  else { const r = fold({ dryRun: a.includes('--dry') }); console.log(JSON.stringify(r)); }
}
