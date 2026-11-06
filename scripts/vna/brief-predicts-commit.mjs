#!/usr/bin/env node
// C609a — THE BRIEF PREDICTS THE COMMIT IN BITS: the closed loop below the address.
//
// A compressor is a predictor (code length = −log₂ p), and gzip's LZ77 window (windowBits 15 = 32 KiB, the window
// packages/thetacog-mcp/intentguard/src/walk_lens.rs node_gzip_len uses: GZIP_WINDOW_BITS = 15+16, level -1, memLevel 8 —
// node's gzipSync defaults, so the lengths here equal the crate's byte for byte) is a cache of the recent past: a match
// is a hit, a literal is a miss. So C(diff | brief) = C(brief‖diff) − C(brief) is the brief's PREDICTION of the commit,
// scored in bits by a compressor the actor did not author — no walk, no admission step, nothing quantised before it
// is scored (C567 retired the walked scalar; THE METER read the address at the null).
//
//   gain (bits per diff byte) = [ mean_k C(diff | shuffled brief_k) − C(diff | own brief) ] · 8 / |diff|
//
// The shuffled briefs are K briefs of OTHER rows from the same size band (±25 % bytes), drawn with a seeded PRNG and
// recorded. Matched aperture: the diff is capped at DIFF_CAP bytes, and a brief must fit WINDOW − DIFF_CAP so every
// byte of it is still referenceable when the diff is coded. A brief past the window is REPORTED (past_window) and
// never scored, and never drawn into a null either. Halves split by session (transcript id when present, else the
// dispatch day); per-half z is the half's mean gain against the K shuffled-brief draws of that same mean. Pre-registered bar: z ≥ 2 in BOTH halves and
// n ≥ 20 per half, else UNMEASURED with the count. LLM-free. Writes data/vna/brief-predicts-commit.json.
// Line 3 is the CODE-ONLY arm (tests/, docs/, comments, long strings out of the diff): the control for "the diff quoted
// the brief" — pre-registered below at codeOnly(): masked passing while code-only fails reads THE DIFF QUOTED THE BRIEF.
// Line 2 is the MASKED arm (row ids, paths, filenames, hex runs → placeholders): the leak control for "the brief named the files".
//
// Rust port row: declared C609a-port (this decides a verdict — MEASURED/UNMEASURED — so once in use the scoring moves
// into the crate beside node_gzip_len, which already computes the code length; the git/file shuttling stays node).
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeSidecar, readSidecar, listSidecars, sidecarAt } from './runner-sidecars.mjs';   // the chat door's snowball sidecar lives on the day tape, never a loose file

export const WINDOW_BITS = 15;                       // lens.rs GZIP_WINDOW_BITS − 16 (the gzip wrapper flag)
export const WINDOW = (1 << WINDOW_BITS) - 262;      // deflate MAX_DIST = w_size − MIN_LOOKAHEAD: the farthest back a match reaches
export const DIFF_CAP = 8192;                        // the diff aperture, the same for the own brief and every null brief
export const BRIEF_CAP = WINDOW - DIFF_CAP;          // a brief longer than this cannot be referenced in full while the diff is coded
export const BAND = 0.25;                            // the shuffled-brief size band: ±25 % bytes
export const K_DEFAULT = 50;
export const BAR = { z: 2, n: 20 };

const buf = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8'));
// gzip length exactly as lens.rs node_gzip_len computes it (node's gzipSync defaults: level -1, windowBits 15, memLevel 8)
export const C = (x) => gzipSync(buf(x), { windowBits: WINDOW_BITS }).length;
/** C(diff | brief) in BITS: the extra code length the diff costs once the brief is in the window. */
export function condBits(brief, diff) {
  const b = buf(brief), d = buf(diff);
  return (C(Buffer.concat([b, d])) - C(b)) * 8;
}

// seeded PRNG (mulberry32) keyed on the row label, so every draw is re-runnable and recorded
function hash32(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

/**
 * Score pairs. pairs: [{ label, brief, diff, session }]. Returns { scored, past_window, no_null, halves, line }.
 * A pair whose brief is past the window is listed in past_window and contributes NOTHING to any number.
 */
function scoreArm(pairs, { K = K_DEFAULT, seed = 'C609a', xf = (b) => b, xd = null, tag = 'C609a' } = {}) {
  const past_window = [], no_null = [], no_code = [], scored = [];
  const ok = pairs.filter((p) => {
    if (buf(p.brief).length > BRIEF_CAP) { past_window.push({ label: p.label, brief_bytes: buf(p.brief).length, cap: BRIEF_CAP }); return false; }
    return buf(p.diff).length > 0;
  });
  for (const p of ok) {
    const brief = buf(p.brief), diff = (xd ? xd(buf(p.diff)) : buf(p.diff)).subarray(0, DIFF_CAP);
    const bx = xf(brief), dx = xf(diff);   // the arm's view; the band and the draws stay keyed on the RAW sizes, so both arms share them
    const lo = brief.length * (1 - BAND), hi = brief.length * (1 + BAND);
    const band = ok.filter((q) => q.label !== p.label && buf(q.brief).length >= lo && buf(q.brief).length <= hi);
    if (band.length < 2) { no_null.push({ label: p.label, brief_bytes: brief.length, band_n: band.length }); continue; }
    if (!dx.length) { no_code.push({ label: p.label, why: 'no code hunk left (only tests/, docs/, comments or long strings)' }); continue; }   // draws are keyed per label, so skipping never moves another pair's draws
    const rnd = mulberry32(hash32(`${seed}:${p.label}`));
    const draws = Array.from({ length: K }, () => band[Math.floor(rnd() * band.length)]);
    const cache = new Map();
    const nullBits = draws.map((q) => { if (!cache.has(q.label)) cache.set(q.label, condBits(xf(buf(q.brief)), dx)); return cache.get(q.label); });
    const own = condBits(bx, dx);
    const mN = mean(nullBits), sN = sd(nullBits);
    scored.push({
      label: p.label, session: p.session ?? null, sha: p.sha ?? null, sha_source: p.sha_source ?? null,
      brief_bytes: bx.length, diff_bytes: dx.length, diff_capped: buf(p.diff).length > DIFF_CAP,
      own_bits: own, null_mean_bits: mN, null_sd_bits: sN,
      gain: ((mN - own) / dx.length),                      // bits per diff byte (own/null already in bits)
      s: sN > 0 ? (mN - own) / sN : 0,                       // the pair's standardised gain against its own null band
      null_draws: draws.map((q) => q.label), null_bits: nullBits, band_n: band.length,
    });
  }
  // halves split by session: sessions in time order, each to the half that is currently smaller (re-runnable)
  const sessions = [...new Set(scored.map((r) => r.session ?? r.label))].sort();
  const half = new Map(); const cnt = [0, 0];
  for (const s of sessions) { const n = scored.filter((r) => (r.session ?? r.label) === s).length; const h = cnt[0] <= cnt[1] ? 0 : 1; half.set(s, h); cnt[h] += n; }
  const halves = [0, 1].map((h) => {
    const rows = scored.filter((r) => half.get(r.session ?? r.label) === h);
    // z against the shuffled-brief null of the HALF statistic: draw j stands in for every pair's own brief at once, so the
    // null mean gain and its spread come from the same K draws the pairs were scored against (exchangeable by construction)
    if (!rows.length) return { n: 0, z: null, gain_mean: null, sessions: sessions.filter((s) => half.get(s) === h) };
    const obs = mean(rows.map((r) => r.gain));
    const nullG = Array.from({ length: K }, (_, j) => mean(rows.map((r) => (r.null_mean_bits - r.null_bits[j]) / r.diff_bytes)));
    const sG = sd(nullG);
    return { n: rows.length, z: sG > 0 ? (obs - mean(nullG)) / sG : null, gain_mean: obs, null_gain_mean: mean(nullG), null_gain_sd: sG, sessions: sessions.filter((s) => half.get(s) === h) };
  });
  for (const r of scored) r.half = half.get(r.session ?? r.label) === 0 ? 'a' : 'b';
  const gains = scored.map((r) => r.gain);
  const why = [];
  for (const [i, h] of halves.entries()) {
    if (h.n < BAR.n) why.push(`n ${h.n} < ${BAR.n} in half ${'ab'[i]}`);
    else if (!(h.z >= BAR.z)) why.push(`z ${h.z.toFixed(2)} < ${BAR.z} in half ${'ab'[i]}`);
  }
  const verdict = why.length ? 'UNMEASURED' : 'MEASURED';
  const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
  const line = `${tag}: gain ${f(median(gains))} median [${f(gains.length ? Math.min(...gains) : null)},${f(gains.length ? Math.max(...gains) : null)}] · ` +
    `z ${f(halves[0].z, 2)}|${f(halves[1].z, 2)} · n ${halves[0].n}|${halves[1].n} per half · ` +
    (verdict === 'MEASURED' ? 'MEASURED' : `UNMEASURED — ${why.join('; ')}`) +
    (past_window.length ? ` · ${past_window.length} brief(s) past the window, not scored` : '') +
    (no_null.length ? ` · ${no_null.length} with no size-band null` : '');
  return { verdict, why, line, gain_median: median(gains), halves, scored, past_window, no_null, no_code, K, seed, window: WINDOW, diff_cap: DIFF_CAP, brief_cap: BRIEF_CAP, band: BAND, bar: BAR };
}

// ── the MASKED arm (chair, after verify): each brief names its own row id, guard path and target paths, and the diff
// creates exactly those paths and repeats the row id — long shared strings gzip codes almost free. The masked arm replaces,
// in BOTH brief and diff, every path-like token, bare filename with an extension, 7–40 hex run and row id with one fixed
// 2-byte placeholder per class (never longer than what it replaces, so a brief that fit the window still fits), and is
// scored on the SAME pairs with the SAME null draws. Pre-registered: raw z ≥ 2 in both halves while masked z < 2 in either
// half reads "the brief named the files", and line 1 says so.
export const MASKS = [
  [/[\w.-]+\/[\w./-]+/g, '#P'],                       // path-like: a/b, scripts/vna/x.mjs, .thetacog/runner/
  [/\b[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g, '#F'],     // bare filename with an extension
  [/\b[0-9a-f]{7,40}\b/g, '#H'],                        // a sha (or any 7–40 hex run)
  [/\bC\d+[a-z]?\b/g, '#R'],                           // a row id
];
export function mask(x) { let s = buf(x).toString('utf8'); for (const [re, ph] of MASKS) s = s.replace(re, ph); return Buffer.from(s, 'utf8'); }

// ── the CODE-ONLY arm (chair, second leak control): workers copy the row's own sentences into the diff — test names,
// "// C565a THE …" comment headers, assertion messages. That is the diff QUOTING the brief. The code-only arm keeps only
// the hunks of files under src/, scripts/, packages/ (never tests/, docs/, a /tests/ segment or a *.test.* file), strips
// every comment (// … · /* … */ · # … in shell/python/yaml/toml · <!-- … -->) and every string literal longer than 24
// chars, then masks as the masked arm does. A pair with no code hunk left is reported (no_code), never scored.
// PRE-REGISTERED: masked z ≥ 2 in both halves while code-only z < 2 in either half → line 1 adds
// "· THE DIFF QUOTED THE BRIEF — code-only z a|b < 2" and never reads MEASURED; code-only z ≥ 2 in both halves → line 1
// adds "· survives quoting".
export const CODE_ROOTS = /^(src|scripts|packages)\//;
const NOT_CODE = /(^|\/)(tests?|__tests__|docs)\/|\.test\.|\.spec\./;
const HASH_COMMENT = /\.(sh|bash|zsh|py|ya?ml|toml|rb|pl|mk)$|(^|\/)(Makefile|Dockerfile)$|(^|\/)[^./]+$/;
export function codeOnly(diff) {
  const out = [];
  const sections = buf(diff).toString('utf8').split(/^(?=diff --git )/m);
  for (const sec of sections) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(sec);
    if (!m) continue;
    const path = m[2];
    if (!CODE_ROOTS.test(path) || NOT_CODE.test(path)) continue;
    const body = sec.split('\n').filter((l) => /^[+\- ]/.test(l) && !/^(\+\+\+|---) /.test(l)).map((l) => l.slice(1)).join('\n');
    let c = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    c = c.replace(/(['"`])((?:\\.|(?!\1)[^\\\n]){25,})\1/g, '$1$1');                 // string literals longer than 24 chars → empty
    c = c.replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');                                     // // line comments (never the // of a URL)
    if (HASH_COMMENT.test(path)) c = c.replace(/(^|\s)#(?!!).*$/gm, '$1');
    c = c.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).join('\n');
    if (c) out.push(c);
  }
  return Buffer.from(out.join('\n'), 'utf8');
}

/** Both arms on the same pairs and draws. The raw arm's fields stay top-level (line 1); the masked arm rides in .masked (line 2). */
export function scorePairs(pairs, { K = K_DEFAULT, seed = 'C609a' } = {}) {
  const raw = scoreArm(pairs, { K, seed });
  const masked = scoreArm(pairs, { K, seed, xf: mask, tag: 'C609a masked' });
  const code = scoreArm(pairs, { K, seed, xf: mask, xd: codeOnly, tag: 'C609a code-only' });
  const pass = (arm) => arm.halves.every((h) => h.z != null && h.z >= BAR.z);
  const rawPass = raw.halves.every((h) => h.z != null && h.z >= BAR.z);
  const maskFail = masked.halves.some((h) => !(h.z != null && h.z >= BAR.z));
  const named_files = rawPass && maskFail;
  const quoted = !named_files && pass(masked) && !pass(code);
  const survives_quoting = pass(code);
  const share = (m, r) => (r != null && m != null && Math.abs(r) > 1e-12 ? m / r : null);
  const survives = {
    median: share(masked.gain_median, raw.gain_median),
    halves: raw.halves.map((h, i) => share(masked.halves[i].gain_mean, h.gain_mean)),
    what: 'masked gain / raw gain — the share of the raw gain left once row ids, paths, filenames and hex runs are one placeholder each',
  };
  const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
  let { line, verdict } = raw;
  if (named_files) {
    verdict = 'UNMEASURED';
    line = line.replace(/· MEASURED/, '· UNMEASURED');
    line += ` · THE BRIEF NAMED THE FILES — masked z ${f(masked.halves[0].z)}|${f(masked.halves[1].z)} < ${BAR.z}`;
  } else if (verdict === 'MEASURED' && masked.verdict !== 'MEASURED') {
    verdict = 'UNMEASURED'; line = line.replace(/· MEASURED/, `· UNMEASURED — masked arm ${masked.why.join('; ')}`);
  }
  if (quoted) {
    verdict = 'UNMEASURED';
    line = line.replace(/· MEASURED/, '· UNMEASURED');
    line += ` · THE DIFF QUOTED THE BRIEF — code-only z ${f(code.halves[0].z)}|${f(code.halves[1].z)} < ${BAR.z}`;
  } else if (survives_quoting) {
    line += ' · survives quoting';
    if (verdict === 'MEASURED' && code.verdict !== 'MEASURED') { verdict = 'UNMEASURED'; line = line.replace(/· MEASURED/, `· UNMEASURED — code-only arm ${code.why.join('; ')}`); }
  }
  const codeSurv = share(code.gain_median, raw.gain_median);
  const line3 = `C609a code-only: gain ${f(code.gain_median, 3)} · z ${f(code.halves[0].z)}|${f(code.halves[1].z)} · n ${code.halves[0].n}|${code.halves[1].n} · survives ${codeSurv == null ? '—' : Math.round(codeSurv * 100) + ' %'} of raw` + (code.no_code.length ? ` · ${code.no_code.length} with no code hunk, not scored` : '');
  const line2 = `C609a masked: gain ${f(masked.gain_median, 3)} median [${f(masked.scored.length ? Math.min(...masked.scored.map((r) => r.gain)) : null, 3)},${f(masked.scored.length ? Math.max(...masked.scored.map((r) => r.gain)) : null, 3)}] · ` +
    `z ${f(masked.halves[0].z)}|${f(masked.halves[1].z)} · n ${masked.halves[0].n}|${masked.halves[1].n} · survives ${survives.median == null ? '—' : Math.round(survives.median * 100) + ' %'} of the raw gain`;
  survives.code_only = { median: codeSurv, halves: raw.halves.map((h, i) => share(code.halves[i].gain_mean, h.gain_mean)), what: 'code-only gain / raw gain — what is left once tests/, docs/, comments and long strings leave the diff' };
  return { ...raw, verdict, line, line2, line3, named_files, quoted, survives_quoting, survives, masked: { ...masked, line: line2 }, code_only: { ...code, line: line3 }, raw_verdict: raw.verdict };
}

// ── the live record ────────────────────────────────────────────────────────────────────────────────────────────────
const git = (repo, args, max = 64 * 1024 * 1024) => execFileSync('git', args, { cwd: repo, encoding: 'buffer', maxBuffer: max, stdio: ['ignore', 'pipe', 'ignore'] });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Collect (brief, ticking commit) pairs from the record: briefs = .thetacog/runner/*.snowball.txt (NOW on the day
 *  tape — scripts/vna/runner-sidecars.mjs — once the dispatch that wrote them is over; listSidecars/readSidecar see
 *  a folded one exactly like a still-loose one, so this reads either without caring which); commit = the ledger's ok
 *  verdict/audit `work` sha, else the first commit after dispatch whose SUBJECT leads with the row label
 *  (`<type>(<scope>): <Cn> …`, the worker contract's form). The diff is read off the immutable commit. */
export function collectLive(repo) {
  const dir = join(repo, '.thetacog/runner');
  const rows = existsSync(join(repo, '.thetacog/runner.ndjson'))
    ? readFileSync(join(repo, '.thetacog/runner.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const pairs = [], unpaired = [];
  const seen = new Set();
  if (!existsSync(dir)) return { pairs, unpaired };
  for (const f of listSidecars({ dir }).filter((x) => x.endsWith('.snowball.txt')).sort()) {
    const label = f.replace(/^\d+-/, '').replace(/\.snowball\.txt$/, '');
    if (seen.has(label)) { unpaired.push({ label, file: f, why: 'the row already has a scored brief — one pair per row' }); continue; }
    const brief = readSidecar({ dir, name: f });
    if (brief == null) { unpaired.push({ label, file: f, why: 'listed but unreadable (tape row and loose file both absent)' }); continue; }
    const mine = rows.filter((r) => r.label === label);
    // C612l: a dispatch row that NAMES this file fences it alone (the chat door names its file); a row naming no file is the
    // legacy runner row and fences every file of its label, as before
    const allD = mine.filter((r) => r.kind === 'dispatch');
    const named = allD.filter((r) => r.snowball && typeof r.snowball.path === 'string' && basename(r.snowball.path) === f);
    const dRows = (named.length ? named : allD).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const disp = dRows[0]?.at ?? null;
    const backfilled = dRows.length > 0 && dRows[0].backfilled === true;
    let sha = null, sha_source = null;
    const okRow = mine.filter((r) => (r.kind === 'verdict' || r.kind === 'audit') && r.ok === true && typeof r.work === 'string' && /^[0-9a-f]{7,40}$/.test(r.work)).pop();
    if (okRow) { sha = okRow.work; sha_source = `runner.ndjson ${okRow.kind} ok`; }
    let hits = [];
    if (!sha) {
      const fc = fenceCommit(repo, label, disp); hits = fc.hits;
      if (fc.sha) { sha = fc.sha; sha_source = 'git subject leads with the row'; }
    }
    if (!sha) { unpaired.push({ label, why: hits.length ? 'every commit naming the row predates its dispatch (a brief written after its commit could quote it)' : 'no ok ledger sha and no commit subject leads with the row' }); continue; }
    let diff;
    try { diff = git(repo, ['show', sha, '--format=', '-U3']); } catch { unpaired.push({ label, sha, why: 'git show failed' }); continue; }
    if (!diff.length) { unpaired.push({ label, sha, why: 'empty diff' }); continue; }
    const transcript = mine.find((r) => r.transcript_id)?.transcript_id;
    // the session date, when neither a transcript id nor a dispatch row names one: the loose file's mtime (the drain), else
    // the tape row's own `at` (once folded, the file has no mtime of its own — the tape timestamp is the only record left)
    const fallbackDate = () => { try { return new Date(statSync(join(dir, f)).mtimeMs).toISOString(); } catch { return sidecarAt({ dir, name: f }) || new Date().toISOString(); } };
    const session = transcript ?? (disp ? disp.slice(0, 10) : fallbackDate().slice(0, 10));
    seen.add(label);
    pairs.push({ label, brief, diff, session, sha, sha_source, ...(backfilled ? { backfilled: true } : {}), door: dRows[0]?.door ?? null });
  }
  return { pairs, unpaired };
}

/** THE FENCE (one home — collectLive and the backfill both read it): the commit a pair scores is the oldest commit whose
 *  SUBJECT leads with the row label and whose committer instant is at or after the dispatch. A brief written after every such
 *  commit could quote it, so it scores nothing. */
export function fenceCommit(repo, label, disp) {
  const log = git(repo, ['log', '--format=%H%x09%cI%x09%s', '-E', `--grep=(^|[^A-Za-z0-9])${esc(label)}([^A-Za-z0-9]|$)`]).toString('utf8').split('\n').filter(Boolean);
  const lead = new RegExp(`^[a-z]+\\([^)]*\\): ${esc(label)}(?![A-Za-z0-9])`);
  const hits = log.map((l) => l.split('\t')).filter(([, , s]) => lead.test(s)).reverse();   // oldest first
  const hit = hits.find(([, at]) => !disp || Date.parse(at) >= Date.parse(disp)) ?? null;   // instants, never strings: %cI carries the committer's offset
  return { sha: hit ? hit[0] : null, at: hit ? hit[1] : null, hits };
}

// ── C612l — THE CHAT DOOR LEAVES A PAIR. `steer.mjs brief <Cn>` (the chat door) used to write neither a snowball file nor a
// dispatch row, so ~20 chat dispatches on 2026-10-03 left C609a at n 16|21. stampChatBrief writes the exact brief the door
// printed as a row on the day tape (scripts/vna/runner-sidecars.mjs — named <n>-<Cn>.snowball.txt, never-overwrite by
// construction, the module's own stand-in for the loose file's old 0444) and appends a kind:'dispatch', door:'chat' row
// naming it, before the door returns. A label that already has a snowball sidecar gets the next free n, never an overwrite:
// an earlier dispatch's brief is that dispatch's record. The chat door has no external process reading this path (unlike
// the local-engine snowball steer-runner.mjs writes, which a shelled-out binary must read as a real file) — nothing here
// ever needs a loose file, so none is written.
export function stampChatBrief({ repo, label, brief, n = 1, at = null, head0 = null, backfilled = false, source = null } = {}) {
  const dir = join(repo, '.thetacog/runner'), nd = join(repo, '.thetacog/runner.ndjson');
  const re = new RegExp(`^(\\d+)-${esc(label)}\\.snowball\\.txt$`);
  const taken = listSidecars({ dir }).map((f) => re.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  let k = n; while (taken.includes(k)) k++;
  const name = `${k}-${label}.snowball.txt`, bytes = buf(brief);
  const w = writeSidecar({ dir, name, body: bytes.toString('utf8') });
  const row = { at: at || new Date().toISOString(), kind: 'dispatch', door: 'chat', n: k, label, engine: 'chat subagent', preset: 'chat', head0,
    snowball: { path: `.thetacog/runner/${name}` }, snowball_sha256: w.sha256,
    ...(backfilled ? { backfilled: true, backfill_source: source } : {}) };
  appendFileSync(nd, JSON.stringify(row) + '\n');
  return { path: join(dir, name), tape: w.tape, row };
}

/** The one-time backfill: every <dir>/brief-<Cn>.txt the chair saved is stamped with at = its mtime and backfilled: true —
 *  ONLY where the fence finds a commit at or after that mtime (the commit the pair would score). A refused brief writes nothing.
 *  Idempotent: a label that already has a chat dispatch row with the same brief sha is skipped. */
export function backfillChat({ repo, dir, exclude = [] } = {}) {
  const nd = join(repo, '.thetacog/runner.ndjson');
  const rows = existsSync(nd) ? readFileSync(nd, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const stamped = [], refused = [], skipped = [];
  for (const f of readdirSync(dir).filter((x) => /^brief-(C\d+[a-z]?\d*|T\d+)\.txt$/.test(x)).sort()) {
    const label = f.replace(/^brief-/, '').replace(/\.txt$/, '');
    if (exclude.includes(label)) { skipped.push({ label, why: 'excluded by the caller' }); continue; }
    const bytes = readFileSync(join(dir, f));
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (rows.some((r) => r.kind === 'dispatch' && r.label === label && r.snowball_sha256 === sha)) { skipped.push({ label, why: 'already stamped' }); continue; }
    const at = new Date(statSync(join(dir, f)).mtimeMs).toISOString();
    const fc = fenceCommit(repo, label, at);
    if (!fc.sha) { refused.push({ label, at, why: fc.hits.length ? 'every commit naming the row predates the saved brief' : 'no commit subject leads with the row yet' }); continue; }
    const { path, row } = stampChatBrief({ repo, label, brief: bytes, at, backfilled: true, source: join(dir, f) });
    stamped.push({ label, at, commit: fc.sha, commit_at: fc.at, path, row });
  }
  return { stamped, refused, skipped };
}

/** The C609a receipt split (C612l): the reading WITH backfilled pairs and WITHOUT them, on separate lines, so the bar is never
 *  met by a backfill alone going unseen. */
export function bothReadings(pairs, { K = K_DEFAULT, seed = 'C609a' } = {}) {
  const live = pairs.filter((p) => p.backfilled !== true), nb = pairs.length - live.length;
  const all = scorePairs(pairs, { K, seed }), lv = scorePairs(live, { K, seed });
  const strip = (l) => l.replace(/^C609a: /, '');
  const onlyWith = all.verdict === 'MEASURED' && lv.verdict !== 'MEASURED';
  return {
    with: `C609a WITH backfilled (${nb} of ${pairs.length} pairs): ${strip(all.line)}` + (onlyWith ? ` · MEASURED ONLY WITH THE ${nb} BACKFILLED PAIRS` : ''),
    without: `C609a WITHOUT backfilled (${live.length} pairs): ${strip(lv.line)}`,
    all, live: lv, backfilled_n: nb, only_with_backfill: onlyWith,
  };
}

export function runLive(repo, { K = K_DEFAULT, out = join(repo, 'data/vna/brief-predicts-commit.json') } = {}) {
  const { pairs, unpaired } = collectLive(repo);
  const r = scorePairs(pairs, { K });
  const b = bothReadings(pairs, { K });
  const doc = { at: new Date().toISOString(), row: 'C609a', llm: false, unpaired, ...r, line_with_backfill: b.with, line_without_backfill: b.without,
    backfilled_n: b.backfilled_n, only_with_backfill: b.only_with_backfill, without_backfill: { verdict: b.live.verdict, halves: b.live.halves, n: b.live.scored.length } };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); }
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const bfArg = process.argv.indexOf('--backfill-chat');
  if (bfArg > 0) {   // C612l: the one-time backfill of saved chat-door briefs — then the receipt as usual
    const ex = process.argv.indexOf('--exclude'); const exclude = ex > 0 ? process.argv[ex + 1].split(',') : [];
    const res = backfillChat({ repo, dir: resolve(process.argv[bfArg + 1]), exclude });
    for (const s of res.stamped) console.log(`backfilled ${s.label} · brief ${s.at} precedes ${s.commit.slice(0, 10)} ${s.commit_at}`);
    for (const s of res.refused) console.log(`refused ${s.label} · brief ${s.at} — ${s.why}`);
    for (const s of res.skipped) console.log(`skipped ${s.label} — ${s.why}`);
  }
  const kArg = process.argv.indexOf('--k');
  const doc = runLive(repo, { K: kArg > 0 ? Number(process.argv[kArg + 1]) : K_DEFAULT });
  console.log(doc.line);
  console.log(doc.line2);
  console.log(doc.line3);
  console.log(doc.line_with_backfill);
  console.log(doc.line_without_backfill);
  console.log(`pairs scored ${doc.scored.length} · unpaired ${doc.unpaired.length} · K ${doc.K} · window ${doc.window} B (diff cap ${doc.diff_cap}, brief cap ${doc.brief_cap}) · → data/vna/brief-predicts-commit.json`);
}
