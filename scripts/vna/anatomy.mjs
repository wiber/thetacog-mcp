#!/usr/bin/env node
// scripts/vna/anatomy.mjs — C648 THE ANATOMY RIDES WITH THE TAPE — A PANEL HASH IS NOT A RECOMPUTE (operator 2026-10-05, verbatim:
// "to be recomputed you need not just the hashes for the panels, but the full anatomy of the tesseract, that will be what we need to
// place you on the map of maps (competence/dignity pixel) so it is critical").
//
// THE GAP THIS CLOSES. data/vna/aperture-receipt.json holds ONE commit's anatomy — the ω tuple (intent rows, reality rows with blob
// sha + byte spans + chunk_sha, commit, aperture_version) — and aperture-receipt.mjs overwrote it on every walk, so no past commit's
// anatomy was retained. The flight tape signed ω for 1,000+ commits (delta.aperture_omega) whose tuples are gone: a commitment that
// can never be opened. AXIOM 1 W4: retention is PROSPECTIVE-ONLY. This file does not back-fill; the gap is dated by the first row.
//
//   (1) THE TAPE. Every non-preview walk APPENDS its tuple to data/vna/anatomy-tape.ndjson (append-only, hash-chained: prev + row_sha,
//       one row per distinct ω — a re-walk under another aperture is another row, the same ω twice is one). The receipt file stays as
//       the latest view. A row a later tool adds for a past commit is stamped retro: true and walked_at now, and counted apart.
//   (2) THE CARRY. backup.mjs puts the anatomy rows for the commits taped since the last posted backup into the archive. What rides is
//       decided by the holder's SETTING plus a CHECK, never assumed:
//         public   (declared public AND the repo has a remote)  → the tuple only; blob shas resolve against the public git
//         private  carry: "spans"        → the tuple + the used span bytes, so the underwriter recomputes without the repo
//         private  carry: "commitments"  → the tuple only, whose chunk_sha ARE the commitments; the underwriter verifies on reveal
//       No setting, or "public" with no remote to resolve against → private + commitments (nothing beyond hashes leaves the machine).
//   (3) THE RECOMPUTE. `--recompute <sha>|--all` rebuilds ω from the carried rows (+ git when the bytes are reachable) and answers
//       MATCH / MISMATCH / UNMEASURED (bytes not carried and not reachable). "Is the setup configured correctly" is the MATCH share
//       over the tape. Verdicts append to data/vna/anatomy-recompute.ndjson — the ledger competence-pixel.mjs places from.
//   (4) THE PLACEMENT. competence-pixel.mjs's `placement` reads only the commits whose anatomy row recomputes MATCH.
//   (5) THE SIZE. Read off the tape, never typed: per-commit gz bytes median [min,max] for each carry, the per-backup delta at the
//       measured cadence (commits between posted backups), and the all-history projection against receive.mjs MAX_BYTES.
//
// SUFFICIENT FOR: which bytes the walk was fed, from which commit, under which aperture — re-checkable by a party that did not write
// it. NOT SUFFICIENT FOR: whether the walk was right (Rice), and — for the intent side — the intent TEXT (the tuple carries intent rows
// as path + used_bytes; the full re-cut is scripts/vna/recompute-receipt.mjs, which reads the spec and message at the commit).
//
//   node scripts/vna/anatomy.mjs                       setting + size reading
//   node scripts/vna/anatomy.mjs --recompute <sha>     one row's verdict      (--no-git: only what was carried — the underwriter's seat)
//   node scripts/vna/anatomy.mjs --recompute --all     the share over the tape
//   node scripts/vna/anatomy.mjs --append              append the current receipt's row (what the walk does; idempotent)
//   … --json on any of them
// MAXIMISE RUST: this DECIDES (a verdict) — its port row is derived by scripts/vna/engine-map.mjs.
// @guard tests/vna/c648-the-anatomy-rides-with-the-tape.test.mjs
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { canonicalJson, omegaTuple, omegaOf } from './aperture-receipt.mjs';
import { commentProseWithSpans } from '../pmu/corpus-ingest.mjs';
import { MAX_BYTES } from '../../src/lib/backup/receive.mjs';
import { retainLive, storePath as snapshotStorePath, readStore as readSnapshotStore, resolveSnapshots, STATE_REL as TESSERACT_STATE_REL } from './tesseract-snapshots.mjs';   // C667d: the tesseract the walk placed against rides beside its tuple

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const TAPE_REL = 'data/vna/anatomy-tape.ndjson';
export const SETTING_REL = 'data/vna/anatomy-setting.json';
export const VERDICTS_REL = 'data/vna/anatomy-recompute.ndjson';
export const ANATOMY_ENTRY = 'data/vna/anatomy-tape.ndjson';   // the archive entry: the rows since the last posted backup
export const tapePath = (repo = REPO) => process.env.VNA_ANATOMY_TAPE || resolve(repo, TAPE_REL);
export const settingPath = (repo = REPO) => process.env.VNA_ANATOMY_SETTING || resolve(repo, SETTING_REL);
export const verdictsPath = (repo = REPO) => process.env.VNA_ANATOMY_VERDICTS || resolve(repo, VERDICTS_REL);
export const CARRIES = Object.freeze(['tuple', 'spans', 'commitments']);

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const nd = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const git = (args, cwd) => execFileSync('git', args, { cwd, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

// ── (1) the tape ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** the row a walk appends: the ω tuple as omegaTuple builds it (never a second recipe), ω, and the chain */
export function anatomyRow(receipt, { prev = null, at = new Date().toISOString(), retro = false, tesseract_sha = null } = {}) {
  const tuple = omegaTuple(receipt);
  // C667d: tesseract_sha names the state the walk placed against — stamped from the same read the snapshot store retained, outside
  // the tuple so ω does not move; absent (never null) on a row whose walk retained no state, so older rows hash as they always did
  const body = { v: 1, kind: 'anatomy', commit: receipt.commit, aperture_version: receipt.aperture_version ?? null, omega: omegaOf(receipt), ...(tesseract_sha ? { tesseract_sha } : {}),
    walked_at: retro ? at : (receipt.walked_at || receipt.at || at), at, retro: !!retro, engine: receipt.engine || null, tuple, prev };
  return { ...body, row_sha: sha256(canonicalJson(body)) };
}
export const readAnatomy = (tape = tapePath()) => nd(tape);
/** append the receipt's row — refused for a preview (no immutable commit) and skipped when this ω is already on the tape */
// C667d: the live tape's walk also retains the tesseract it placed against (snapshots → the store; a scratch tape retains nothing
// unless a store is named), and the row is stamped with that same sha
export function appendAnatomy(receipt, { tape = tapePath(), retro = false, at, snapshots = tape === tapePath() ? snapshotStorePath(REPO) : null, statePath = resolve(REPO, TESSERACT_STATE_REL) } = {}) {
  if (!receipt || receipt.preview || !receipt.commit || !receipt.reality || !receipt.intent) return { appended: false, why: 'a preview or commit-less receipt names no immutable commit — nothing taped' };
  let kept = null; if (snapshots) { try { kept = retainLive({ statePath, store: snapshots }); } catch (e) { kept = { retained: false, tesseract_sha: null, why: String(e && e.message || e) }; } }
  const rows = readAnatomy(tape);
  const omega = omegaOf(receipt);
  if (rows.some((r) => r.omega === omega)) return { appended: false, why: `ω ${omega.slice(0, 12)} is already on the tape`, omega, tesseract: kept };
  const prev = rows.length ? rows[rows.length - 1].row_sha : null;
  const row = anatomyRow(receipt, { prev, retro, ...(at ? { at } : {}), tesseract_sha: kept && kept.tesseract_sha || null });
  mkdirSync(dirname(tape), { recursive: true });
  appendFileSync(tape, JSON.stringify(row) + '\n');
  return { appended: true, row };
}
/** the chain: every row's row_sha recomputes and points at the row before it — a rewritten or dropped row is a countable gap (W5) */
export function verifyChain(rows) {
  let prev = null; const breaks = [];
  rows.forEach((r, i) => { const { row_sha, ...body } = r; if (sha256(canonicalJson(body)) !== row_sha || (r.prev ?? null) !== prev) breaks.push(i); prev = row_sha; });
  return { ok: breaks.length === 0, rows: rows.length, breaks };
}

// ── (2) the setting + the check ───────────────────────────────────────────────────────────────────────────────────────
export function readSetting(path = settingPath()) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function remotesOf(repo = REPO) { try { return String(git(['remote', '-v'], repo)).split('\n').filter(Boolean).map((l) => l.split(/\s+/)[1]).filter(Boolean); } catch { return []; } }
/** what rides, decided from the declaration plus the check — never from a guess about the repo */
export function resolveCarry({ setting = readSetting(), remotes = [] } = {}) {
  const declared = setting && typeof setting.visibility === 'string' ? setting.visibility : null;
  if (declared === 'public' && remotes.length) return { visibility: 'public', carry: 'tuple', declared, remotes: remotes.length, why: 'declared public and a remote resolves the blob shas — the tuple is enough' };
  const pc = setting && CARRIES.includes(setting.private_carry) && setting.private_carry !== 'tuple' ? setting.private_carry : 'commitments';
  const why = declared === 'public' ? 'declared public but no remote to resolve blobs against — carried as private'
    : declared === 'private' ? `declared private — carry ${pc}${setting.private_carry && pc !== setting.private_carry ? ` (${setting.private_carry} is not a private carry)` : ''}`
    : `no visibility declared in ${SETTING_REL} — private, commitments only (nothing beyond hashes leaves the machine)`;
  return { visibility: 'private', carry: pc, declared, remotes: remotes.length, why };
}
/** the span bytes a walk kept, read the way the walk read them (git at the immutable blob → comment prose for code) */
export function gitSpanReader(repo = REPO) {
  return (path, blob, [s, e]) => { try { const raw = git(['cat-file', 'blob', blob], repo).toString('utf8'); const { text } = commentProseWithSpans(raw, extname(path)); return Buffer.from(text || raw, 'utf8').subarray(s, e); } catch { return null; } };
}
/** a row as the archive carries it — spans add the used bytes (base64) per reality span; tuple/commitments carry the row unchanged */
export function carriedRow(row, carry, readSpan) {
  if (carry !== 'spans') return row;
  const span_bytes = {};
  for (const r of row.tuple.reality) {
    const got = (r.spans || []).map((s) => { const b = readSpan(r.path, r.blob, s.bytes); return b ? Buffer.from(b).toString('base64') : null; });
    span_bytes[r.path] = got;
  }
  return { ...row, span_bytes };
}
/** the anatomy rows for the commits taped since the last posted backup (the posted height the upload receipts name) */
export function rowsSinceBackup({ rows, flight = [], postedHeight = 0 }) {
  const since = new Set(flight.slice(postedHeight).filter((r) => r && r.kind === 'commit' && r.sha).map((r) => String(r.sha)));
  return rows.filter((r) => since.has(String(r.commit)));
}
/** the highest flight-tape height any posted backup holds — upload receipt + its manifest's rows.flight_tape (backup.mjs's own rule) */
export function postedHeights(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.upload.json'))) {
    let up = null; try { up = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; }
    const sha = (up && up.sha) || f.slice(0, -'.upload.json'.length);
    let man = null; try { man = JSON.parse(readFileSync(resolve(dir, `${sha}.manifest.json`), 'utf8')); } catch { man = null; }
    const h = man && man.rows && Number.isFinite(man.rows.flight_tape) ? man.rows.flight_tape : null;
    if (h != null) out.push({ at: up.at || man.at || null, height: h });
  }
  return out.sort((a, b) => a.height - b.height);
}
/** what backup.mjs bundle() writes as the archive entry + the manifest field; null rows → the entry is still written (an empty delta is a measurement) */
export function anatomyCarry({ repo = REPO, flightPath, backupDir, setting = readSetting(settingPath(repo)), remotes = remotesOf(repo), readSpan = gitSpanReader(repo), tape = tapePath(repo) } = {}) {
  const decided = resolveCarry({ setting, remotes });
  const rows = readAnatomy(tape);
  const heights = postedHeights(backupDir);
  const since_height = heights.length ? heights[heights.length - 1].height : 0;
  const delta = rowsSinceBackup({ rows, flight: nd(flightPath), postedHeight: since_height });
  const carried = delta.map((r) => carriedRow(r, decided.carry, readSpan));
  const text = carried.map((r) => JSON.stringify(r)).join('\n') + (carried.length ? '\n' : '');
  return { text, field: { entry: ANATOMY_ENTRY, ...decided, since_height, rows: carried.length, tape_rows: rows.length, bytes: Buffer.byteLength(text), gz_bytes: gzipSync(text).length,
    sufficient_for: decided.carry === 'commitments' ? 'binding: the holder cannot swap the walked bytes later — verified on reveal' : 'a recompute of every reality span without the holder\'s machine',
    not_sufficient_for: decided.carry === 'commitments' ? 'a recompute now — the span bytes are not in the archive and the blobs are private' : 'whether the walk was right (Rice)' } };
}

// ── (3) the recompute ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One row's verdict over what was carried (+ readSpan when the bytes are reachable).
 *   tuple   ω over the row's own tuple equals the row's ω
 *   anchor  ω equals the signed flight tape's delta.aperture_omega for that commit, when the tape signed one
 *   spans   every reality span's bytes (carried, else readSpan) hash to its chunk_sha and measure used_bytes
 * MISMATCH on any failed leg · UNMEASURED when a span's bytes are neither carried nor reachable · else MATCH.
 */
export function recomputeAnatomy(row, { readSpan = null, flightOmega = null, tesseract = null } = {}) {
  const fail = [], missing = [];
  if (!row || !row.tuple || typeof row.omega !== 'string') return { commit: row && row.commit || null, verdict: 'UNMEASURED', why: 'not an anatomy row' };
  const tupleOmega = sha256(canonicalJson(row.tuple));
  if (tupleOmega !== row.omega) fail.push(`tuple: ω over the carried tuple is ${tupleOmega.slice(0, 12)}…, not ${row.omega.slice(0, 12)}…`);
  if (row.tuple.commit !== row.commit) fail.push('tuple: the tuple names another commit');
  const anchor = flightOmega == null ? null : flightOmega === row.omega;
  if (anchor === false) fail.push(`anchor: the signed flight tape holds ω ${String(flightOmega).slice(0, 12)}… for this commit`);
  let spans = 0;
  for (const r of row.tuple.reality || []) {
    (r.spans || []).forEach((s, i) => {
      spans++;
      const carried = row.span_bytes && row.span_bytes[r.path] && row.span_bytes[r.path][i];
      const b = carried ? Buffer.from(carried, 'base64') : (readSpan ? readSpan(r.path, r.blob, s.bytes) : null);
      if (!b) { missing.push(r.path); return; }
      if (sha256(b) !== s.chunk_sha) fail.push(`span: ${r.path} [${s.bytes}] hashes to ${sha256(b).slice(0, 12)}…, not its chunk_sha`);
      else if (Array.isArray(s.bytes) && b.length !== s.bytes[1] - s.bytes[0]) fail.push(`span: ${r.path} is ${b.length} bytes, not the range it names`);
    });
  }
  // C667d THE TESSERACT LEG (only when a snapshot resolver was handed in): the state the row names must be carried and reassemble to
  // that sha. A different sha is MISMATCH; a state not carried is UNMEASURED — unless the walk predates retention (a dated gap, W4)
  if (tesseract && tesseract.leg === 'MISMATCH') fail.push(`tesseract: the carried snapshot reassembles to ${String(tesseract.reassembled).slice(0, 12)}…, not the ${String(tesseract.named).slice(0, 12)}… the walk used`);
  if (tesseract && tesseract.leg === 'NOT_CARRIED') missing.push(`tesseract ${String(tesseract.named).slice(0, 12)}`);
  const verdict = fail.length ? 'MISMATCH' : missing.length ? 'UNMEASURED' : 'MATCH';
  const why = fail.length ? fail.join(' · ') : missing.length ? `${missing.length} of ${spans} span${spans === 1 ? '' : 's'} not carried and not reachable (${[...new Set(missing)].slice(0, 2).join(', ')}) — verified on reveal` : `tuple ω same · ${spans} span${spans === 1 ? '' : 's'} hash to their commitments${anchor ? ' · anchored on the signed flight tape' : ''}`;
  return { commit: row.commit, omega: row.omega, retro: !!row.retro, verdict, why: tesseract ? `${why} · tesseract ${tesseract.leg}${tesseract.named ? ` ${String(tesseract.named).slice(0, 12)}` : ''}` : why, anchor, spans, ...(tesseract ? { tesseract } : {}) };
}
/** the signed ω per commit, off the flight tape (C115: delta.aperture_omega) */
/** C667d: the signed tesseract_sha per commit (proofs.tesseract_sha) — the name a row without its own stamp is checked against */
export function flightTesseracts(flight) { const m = new Map(); for (const r of flight) if (r && r.kind === 'commit' && r.sha && r.proofs && /^[0-9a-f]{64}$/.test(String(r.proofs.tesseract_sha || ''))) m.set(String(r.sha), r.proofs.tesseract_sha); return m; }
export function flightOmegas(flight) { const m = new Map(); for (const r of flight) if (r && r.kind === 'commit' && r.sha && r.delta && /^[0-9a-f]{64}$/.test(String(r.delta.aperture_omega || ''))) m.set(String(r.sha), r.delta.aperture_omega); return m; }
/** the share — "is the setup configured correctly", read over the tape; retro rows counted apart */
export function recomputeShare(rows, opts = {}) {
  const omegas = opts.flightOmegas || new Map();
  const tsha = opts.flightTesseracts || new Map();
  const results = rows.map((r) => recomputeAnatomy(r, { readSpan: opts.readSpan || null, flightOmega: omegas.get(String(r.commit)) ?? null,
    tesseract: opts.snapshots ? opts.snapshots(r.tesseract_sha || tsha.get(String(r.commit)) || null, r.walked_at || r.at || null) : null }));
  const tally = (xs) => { const t = { rows: xs.length, MATCH: 0, MISMATCH: 0, UNMEASURED: 0 }; for (const x of xs) t[x.verdict]++; t.match_share = xs.length ? Math.round((1000 * t.MATCH) / xs.length) / 10 : null; return t; };
  return { original: tally(results.filter((x) => !x.retro)), retro: tally(results.filter((x) => x.retro)), results };
}
/** the verdict ledger competence-pixel places from — latest verdict per commit wins on read */
export function readVerdicts(path = verdictsPath()) { const m = new Map(); for (const r of nd(path)) if (r && r.commit && r.verdict) m.set(String(r.commit), r); return m; }

// ── (5) the size, read off the tape ──────────────────────────────────────────────────────────────────────────────────
const stats = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2); return { median: m, min: s[0], max: s[s.length - 1], n: s.length }; };
/**
 * per-commit gz bytes for each carry (each row gzipped alone — an upper bound on its share of the archive stream), the per-backup
 * delta at the measured cadence (commit rows between consecutive posted backups × the per-commit median), and the all-history
 * projection (every commit row on the flight tape × median and × max) against the archive cap.
 */
export function sizeReading({ rows, readSpan = null, flight = [], heights = [], maxBytes = MAX_BYTES }) {
  const gz = (o) => gzipSync(JSON.stringify(o)).length;
  const per = { tuple: stats(rows.map((r) => gz(r))) };
  per.commitments = per.tuple;   // the tuple's chunk_sha ARE the commitments — the same bytes; the difference is who can resolve the blobs
  per.spans = readSpan ? stats(rows.map((r) => gz(carriedRow(r, 'spans', readSpan)))) : null;
  per.span_bytes_raw = readSpan ? stats(rows.map((r) => r.tuple.reality.reduce((a, x) => a + x.used_bytes, 0))) : null;
  const commitIdx = []; flight.forEach((r, i) => { if (r && r.kind === 'commit') commitIdx.push(i); });
  const commitsBetween = []; for (let k = 1; k < heights.length; k++) commitsBetween.push(commitIdx.filter((i) => i >= heights[k - 1].height && i < heights[k].height).length);
  const cadence = stats(commitsBetween);
  const sinceLast = commitIdx.filter((i) => i >= (heights.length ? heights[heights.length - 1].height : 0)).length;
  const proj = (p) => (p ? { median: commitIdx.length * p.median, max: commitIdx.length * p.max, cap: maxBytes, share_of_cap_pct: Math.round((10000 * commitIdx.length * p.max) / maxBytes) / 100 } : null);
  return {
    unit: 'bytes, each row gzipped alone', rows: rows.length, original: rows.filter((r) => !r.retro).length, retro: rows.filter((r) => r.retro).length,
    per_commit_gz: per,
    per_backup: { cadence_commits: cadence, since_last_backup_commits: sinceLast, delta_gz_tuple: cadence && per.tuple ? cadence.median * per.tuple.median : null, delta_gz_spans: cadence && per.spans ? cadence.median * per.spans.median : null, backups_posted: heights.length },
    all_history: { commits: commitIdx.length, tuple: proj(per.tuple), spans: proj(per.spans) },
  };
}
const fmt = (s) => (s ? `${s.median} B [${s.min}, ${s.max}] (n=${s.n})` : 'UNMEASURED');
export function sizeLines(z, decided) {
  const p = z.per_commit_gz;
  return [
    `ANATOMY · ${z.rows} row${z.rows === 1 ? '' : 's'} on the tape (${z.original} walked, ${z.retro} retro) · setting: ${decided.visibility} → carry ${decided.carry} — ${decided.why}`,
    `  per commit, gz   tuple (public / commitments) ${fmt(p.tuple)} · tuple + spans (private) ${fmt(p.spans)} · used span bytes raw ${fmt(p.span_bytes_raw)}`,
    `  per backup       ${z.per_backup.cadence_commits ? `${z.per_backup.cadence_commits.median} commits [${z.per_backup.cadence_commits.min}, ${z.per_backup.cadence_commits.max}] between ${z.per_backup.backups_posted} posted backups` : 'cadence UNMEASURED (fewer than 2 posted backups)'} · ${z.per_backup.since_last_backup_commits} commits since the last · delta ${z.per_backup.delta_gz_tuple ?? 'UNMEASURED'} B tuple / ${z.per_backup.delta_gz_spans ?? 'UNMEASURED'} B spans`,
    `  all history      ${z.all_history.commits} commits × per-commit → tuple ${z.all_history.tuple ? `${z.all_history.tuple.median} B (max ${z.all_history.tuple.max} B, ${z.all_history.tuple.share_of_cap_pct}% of the ${z.all_history.tuple.cap} B cap)` : 'UNMEASURED'} · spans ${z.all_history.spans ? `${z.all_history.spans.median} B (max ${z.all_history.spans.max} B, ${z.all_history.spans.share_of_cap_pct}% of cap)` : 'UNMEASURED'}`,
  ];
}

function main() {
  const argv = process.argv.slice(2); const asJson = argv.includes('--json');
  const tape = tapePath(); const flight = nd(process.env.VNA_FLIGHT_TAPE || resolve(REPO, 'data/vna/flight-tape.ndjson'));
  if (argv.includes('--append')) {
    let receipt = null; try { receipt = JSON.parse(readFileSync(resolve(REPO, 'data/vna/aperture-receipt.json'), 'utf8')); } catch { /* below */ }
    if (!receipt) { console.log('not run — node scripts/vna/aperture-receipt.mjs'); process.exitCode = 1; return; }
    const r = appendAnatomy(receipt, { tape });
    console.log(asJson ? JSON.stringify(r) : r.appended ? `taped ${r.row.commit.slice(0, 10)} ω ${r.row.omega.slice(0, 12)}` : r.why);
    return;
  }
  const rows = readAnatomy(tape);
  const readSpan = argv.includes('--no-git') ? null : gitSpanReader(REPO);
  if (argv.includes('--recompute')) {
    const i = argv.indexOf('--recompute'); const target = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
    const pick = argv.includes('--all') || !target ? rows : rows.filter((r) => String(r.commit).startsWith(target));
    if (!pick.length) { console.log(`UNMEASURED — no anatomy row for ${target || 'any commit'} on ${TAPE_REL} (retention began with the first row; an earlier commit was never retained)`); process.exitCode = 2; return; }
    const share = recomputeShare(pick, { readSpan, flightOmegas: flightOmegas(flight), flightTesseracts: flightTesseracts(flight), snapshots: resolveSnapshots(readSnapshotStore(snapshotStorePath(REPO))) });
    const at = new Date().toISOString();
    try { mkdirSync(dirname(verdictsPath()), { recursive: true }); appendFileSync(verdictsPath(), share.results.map((x) => JSON.stringify({ at, ...x, with_git: !!readSpan })).join('\n') + '\n'); } catch { /* the ledger is the placement source; a failed write is printed below */ }
    const chain = verifyChain(rows);
    if (asJson) { console.log(JSON.stringify({ ...share, chain })); } else {
      for (const x of share.results) console.log(`${x.verdict.padEnd(10)} ${String(x.commit).slice(0, 10)} ω ${String(x.omega).slice(0, 12)}${x.retro ? ' (retro)' : ''} — ${x.why}`);
      const tl = {}; for (const x of share.results) if (x.tesseract) tl[x.tesseract.leg] = (tl[x.tesseract.leg] || 0) + 1;
      console.log(`TESSERACT · ${Object.entries(tl).map(([k, v]) => `${v} ${k}`).join(' · ') || 'no rows'} — the snapshot each row names, carried and reassembled (BEFORE_RETENTION: walked before the store's first row)`);
      const o = share.original; console.log(`SETUP · ${o.MATCH}/${o.rows} walked rows recompute MATCH (${o.match_share ?? '—'}%) · ${o.MISMATCH} MISMATCH · ${o.UNMEASURED} UNMEASURED${share.retro.rows ? ` · retro apart: ${share.retro.MATCH}/${share.retro.rows}` : ''} · chain ${chain.ok ? 'VERIFIES' : `BROKEN at ${chain.breaks.join(',')}`}`);
    }
    process.exitCode = share.results.some((x) => x.verdict === 'MISMATCH') ? 1 : 0;
    return;
  }
  const decided = resolveCarry({ setting: readSetting(), remotes: remotesOf(REPO) });
  const z = sizeReading({ rows, readSpan, flight, heights: postedHeights(resolve(REPO, '.thetacog/backup')) });
  if (asJson) console.log(JSON.stringify({ setting: decided, size: z })); else console.log(sizeLines(z, decided).join('\n'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
