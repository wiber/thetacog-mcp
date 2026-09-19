// scripts/pmu/verify-row.mjs — B13, THE VERIFIER (spec §8.50).
// Ships in the npm package the same way attest.mjs / prove-rice.mjs / hooper.mjs do: this file
// lives here (repo root, `scripts/pmu/`), server.js dispatches `verify` by spawning it (see the
// `[cmd, rel]` loop in packages/thetacog-mcp/server.js), and `packages/thetacog-mcp/scripts/bundle-pmu.mjs`
// copies it into the tarball at publish time (its ENTRIES list names it explicitly, since it is
// invoked by path, not import). A dev checkout never needs the bundled copy — the dispatch loop
// finds this file directly at the repo root.
// ─────────────────────────────────────────────────────────────────────────────────────
// One command a claims engine runs on one signed tape row, with no MCP server and no
// access to our machine: `npx thetacog-mcp verify <row.json>`. It checks two things and
// nothing else.
//
//   1. SIGNATURE — the row's ed25519 `sig` verifies with its own `sig_pubkey` over the
//      canonical tuple (ts·source·text_sha·pixel·reef_sha·axes_sha·bin_sha). A row with a
//      missing/malformed signature is UNVERIFIABLE, never MISMATCH — MISMATCH is reserved
//      for a row that is honestly signed but whose placement does not recompute.
//   2. PLACEMENT (only once the signature is valid) — the row's `pixel` is reproduced by
//      rebuilding the text from the commit it names, rebuilding the reef/axes from the git
//      blobs it names, and running the SAME walk (the pmu-onchip binary, `--lens`) that
//      produced the row. Equal → MATCH; different → MISMATCH.
//
// This file reproduces the SIGNATURE-CRITICAL logic in full, in the open (the canonical tuple,
// the pubkey-from-hex conversion, the commit-text builders, the aperture digest) — so a stranger
// checking whether a row's signature is honest never has to trust an import they cannot see. The
// one exception is the WALK ITSELF: it imports `resolvePmuBinary` (src/lib/pmu/pmu-binary.mjs) and
// `lensWalk` (src/lib/pmu/walk-door.mjs) — the ONE resolver and the ONE caller of `--lens` in the
// repo (tests/pmu-simulator/one-resolver-for-the-binary.test.mjs, walk-door.test.mjs "no module
// other than the door spawns `--lens`") — rather than a second hand-rolled spawn here. This is safe
// for an auditor for the same reason the copied logic is: `packages/thetacog-mcp/scripts/bundle-pmu.mjs`
// ships both files into the tarball via crossTree (they are already pulled in by commit-triptych.mjs
// / prompt-lens.mjs, which are bundled ENTRIES), so the stranger's `verify` still runs standalone and
// the imported source is sitting right there to read — and a tampered or absent walk can only ever
// produce a wrong `recomputed` pixel, which reads MISMATCH/UNVERIFIABLE, never a false MATCH. Sources,
// named at each function:
//   - SIG_FIELDS / canonicalTuple           — src/lib/pmu/walk-door.mjs
//   - pubKeyFromHex                          — scripts/pmu/receipt-crypto.mjs (pubKeyFromHex)
//   - digestForAperture / proseProjection    — src/lib/pmu/walk-door.mjs
//   - the commit-intent / commit-reality text builders — scripts/pmu/aperture-ab.mjs (corpus())
//   - the walk invocation (flags, knobs, binary resolution) — imported from src/lib/pmu/walk-door.mjs
//     (lensWalk) and src/lib/pmu/pmu-binary.mjs (resolvePmuBinary), not reimplemented here
//
// Exported for tests: verifyRow(row, opts) — opts.walk(text, reefBytes) => pixel and
// opts.readReef(row) => Buffer / opts.readText(row) => string are injectable, so the test
// suite never needs a real git repo, a real binary, or the room's real ed25519 identity.
import { execFileSync } from 'node:child_process';
import { verify as edVerify, createPublicKey, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary } from '../../src/lib/pmu/pmu-binary.mjs';
import { lensWalk } from '../../src/lib/pmu/walk-door.mjs';

// ── THE CANONICAL TUPLE — copied verbatim from src/lib/pmu/walk-door.mjs ───────────────
export const SIG_FIELDS = ['ts', 'source', 'text_sha', 'pixel', 'reef_sha', 'axes_sha', 'bin_sha'];
export const canonicalTuple = (row) => JSON.stringify(Object.fromEntries(SIG_FIELDS.map((k) => [k, row[k] ?? null])));

// ── PUBKEY FROM HEX — copied verbatim from scripts/pmu/receipt-crypto.mjs (pubKeyFromHex) ──
// The row carries its own signer's raw 32-byte ed25519 public key as hex (`sig_pubkey`); a
// stranger reconstructs the KeyObject from THAT, never from a room identity they cannot derive
// (room keys are HKDF-derived from a host secret this package never sees — the point of
// shipping the pubkey ON the row is that nobody needs the secret to check it).
export function pubKeyFromHex(hex) {
  const x = Buffer.from(hex, 'hex').toString('base64url');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
}

// walk-door.mjs uses TWO truncations of the same sha256, and they are not interchangeable:
//   sha12(text)  → 12 hex chars — this is what `text_sha` on every row actually is.
//   fileSha(p)   → 16 hex chars — this is what `bin_sha` / `reef_sha` / `axes_sha` actually are.
const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const sha256Hex16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// ── THE APERTURE DIGEST — copied verbatim from src/lib/pmu/walk-door.mjs (digestForAperture,
// proseProjection). Only needed when a row's aperture.digest is 'strided' or 'prose'; the
// default 'head' is a plain slice and needs neither. `chars` is taken from the row's own
// aperture.used (the exact length the walk was fed), not from a guessed env default — a row
// is self-describing, it never asks the verifier to know what PMU_DIGEST_CHARS was at write time.
export function digestForAperture(text, chars) {
  const s = String(text);
  if (s.length <= chars) return s;
  const lines = s.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length <= 1) {
    const step = Math.max(1, Math.floor(s.length / chars));
    let out = ''; for (let i = 0; i < s.length && out.length < chars; i += step) out += s[i];
    return out;
  }
  const avg = Math.max(1, Math.floor(lines.reduce((a, l) => a + l.length + 1, 0) / lines.length));
  const want = Math.max(2, Math.floor(chars / avg));
  const stride = Math.max(1, lines.length / want);
  const picked = [];
  for (let k = 0; k < want; k++) { const i = Math.min(lines.length - 1, Math.floor(k * stride)); if (picked[picked.length - 1] !== i) picked.push(i); }
  if (picked[picked.length - 1] !== lines.length - 1) picked.push(lines.length - 1);
  const per = Math.max(8, Math.floor((chars - picked.length) / picked.length));
  let out = ''; for (const i of picked) { const l = lines[i].slice(0, per); out += (out ? '\n' : '') + l; }
  return out.slice(0, chars);
}

export function proseProjection(diffText) {
  const words = [];
  for (const raw of String(diffText).split('\n')) {
    let l = raw.replace(/^[+-]/, '').trim(); if (!l) continue;
    const comment = l.match(/(?:\/\/|#|\/\*|\*|<!--|--)\s*(.+)$/); if (comment && comment[1].length > 8) words.push(comment[1].replace(/[^\w\s'-]/g, ' '));
    const paths = l.match(/[\w./-]+\.(?:mjs|js|ts|tsx|rs|md|mdx|sh|json|html|css)\b/g) || []; for (const p of paths) words.push(p.split('/').pop().replace(/\.[a-z]+$/, '').replace(/[-_.]/g, ' '));
    const idents = l.match(/[A-Za-z][A-Za-z0-9_]{3,}/g) || [];
    for (const id of idents) words.push(id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase());
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

// Rebuild the exact `used` text the door fed the binary, given the row's own aperture record
// { cap, used, digest }. 'head' is a plain slice (the default, and the only mode most rows use);
// 'strided'/'prose' re-run the same deterministic digest, targeted at the row's own recorded length.
function applyAperture(text, aperture) {
  const cap = aperture && Number.isFinite(aperture.cap) ? aperture.cap : String(text).length;
  const mode = (aperture && aperture.digest) || 'head';
  const capped = String(text).slice(0, cap);
  const targetChars = aperture && Number.isFinite(aperture.used) ? aperture.used : 900;
  if (mode === 'strided') return digestForAperture(capped, targetChars);
  if (mode === 'prose') return digestForAperture(proseProjection(capped), targetChars);
  return capped;
}

// ── THE COMMIT TEXT — copied from scripts/pmu/aperture-ab.mjs (corpus()). 'commit-intent' is
// the commit's own message; 'commit-reality' is the diff's added lines only, unified=0, capped
// at 60000 chars — the same LLM-free, git-derivable text anyone can rebuild from the sha alone.
export function buildCommitText(row, repo) {
  const ref = row.ref;
  try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${ref}^{commit}`], { stdio: 'ignore' }); }
  catch { throw new Error(`ref ${ref} not found in --repo ${repo}`); }
  if (row.source === 'commit-intent') {
    return execFileSync('git', ['-C', repo, 'log', '-1', '--format=%B', ref], { encoding: 'utf8', maxBuffer: 64 << 20 });
  }
  if (row.source === 'commit-reality') {
    return execFileSync('git', ['-C', repo, 'show', '--format=', '--unified=0', ref], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n').slice(0, 60000);
  }
  throw new Error(`unrecognized commit source '${row.source}' (expected commit-intent or commit-reality)`);
}

function gitHashObject(file, repo) {
  return execFileSync('git', ['-C', repo, 'hash-object', file], { encoding: 'utf8' }).trim();
}

// Resolve one blob (reef or axes): an injected reader wins (tests), then an explicit local
// file (cross-checked against the blob id with `git hash-object`), then the git blob itself.
function resolveBlob({ blobId, readFn, fileOpt, repo, row, label }) {
  if (readFn) return { bytes: readFn(row), source: `injected (${label})` };
  if (fileOpt) {
    const bytes = readFileSync(fileOpt);
    if (blobId) {
      const got = gitHashObject(fileOpt, repo);
      if (got !== blobId) throw new Error(`${fileOpt} hashes to ${got}, row names ${blobId}`);
    }
    return { bytes, source: fileOpt };
  }
  if (!blobId) throw new Error(`row carries no ${label}_blob`);
  const bytes = execFileSync('git', ['-C', repo, 'cat-file', '-p', blobId], { maxBuffer: 64 << 20 });
  return { bytes, source: `git blob ${blobId}` };
}

// ── THE WALK — the same binary invocation src/lib/pmu/walk-door.mjs makes (--lens), with the
// row's own knobs (maxDepth/topK/budget/decay travel on every row) and the current seed-aperture
// defaults (src/lib/pmu/walk-knobs.mjs SEED_APERTURE — matched-cut, worms 2 orthogonal, perm 8).
// Those seed-aperture flags do NOT ride on the row, so a walk against a row signed under a since-
// changed default recomputes against TODAY's aperture; the bin_sha comparison below is exactly the
// tripwire for that drift — a differing binary is named in the reason rather than silently trusted.
// Resolution goes through the ONE resolver (src/lib/pmu/pmu-binary.mjs) rather than a second
// hand-rolled candidate list — a caller that resolves its own path is a second replicator by
// another name (tests/pmu-simulator/one-resolver-for-the-binary.test.mjs). Like the resolver
// itself, this always returns a path string (honouring PMU_BINARY even when it names nothing,
// since a guard uses exactly that to FORCE the honest fallback) — callers here do their own
// existsSync check before trusting it as a real binary, same as before this change.
function resolveBin(repo) {
  return resolvePmuBinary(repo);
}

// ── B13/B19 §8.58 stub: engine rust-verify — the crate's own --verify-bundle, tried FIRST ────────
// verifyBundle (below) is the JS oracle and the fallback; .thetacog/pmu/src/verify.rs (VB-1..VB-5)
// is the crate's port of the SAME logic (same canonical tuple, same ed25519 verify, same covenant
// recompute, same B21 gate). House rule 11: a reading is the crate's, the JS is a driver and says
// js-fallback when it answers alone. Returns null (never throws) when no capable binary resolves
// or its output cannot be parsed — the caller falls back to the JS path and names why.
export function tryRustVerifyBundle(bundlePath, opts = {}) {
  const bin = resolveBin(opts.repo || process.cwd());
  if (!bin || !existsSync(bin)) return { ok: false, why: 'no --verify-bundle-capable binary resolved (set PMU_BINARY or build .thetacog/pmu)' };
  const args = ['--verify-bundle', bundlePath, '--json'];
  if (opts.textDir) args.push('--text-dir', opts.textDir);
  if (opts.repo) args.push('--repo', opts.repo);
  let raw;
  try { raw = execFileSync(bin, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 }); }
  catch (e) {
    // a non-zero exit (MISMATCH=1, UNVERIFIABLE=2) still carries valid JSON on stdout — only an
    // actual spawn/parse failure (no stdout at all) falls back to the JS path.
    if (e && typeof e.stdout === 'string' && e.stdout.trim()) { raw = e.stdout; }
    else { return { ok: false, why: `rust-verify spawn failed (${e.message})` }; }
  }
  let detail;
  try { detail = JSON.parse(raw); }
  catch (e) { return { ok: false, why: `rust-verify produced unparseable output (${e.message})` }; }
  if (!detail || typeof detail.verdict !== 'string') return { ok: false, why: 'rust-verify produced no verdict' };
  return { ok: true, verdict: detail.verdict, reason: `${detail.reason} · engine: rust-verify`, detail };
}

// Routes through the ONE caller of `--lens` (src/lib/pmu/walk-door.mjs's lensWalk) instead of
// spawning the binary here a second time (tests/pmu-simulator/walk-door.test.mjs "no module other
// than the door spawns `--lens`"). reef/axes are rebuilt from the row's own git blobs — which may
// differ from what is on disk today — so both ride as B21/B22-style path overrides into temp files;
// `source: 'lens-cli'` keeps this off the live turn/commit tape, same convention the test suite
// already uses. maxChars=text.length + digest='head' reproduce the row's own already-aperture'd
// text byte for byte (applyAperture() above already did the one reduction that matters), and
// `knobs` (the row's own recorded knobs) still floors and flags exactly as the direct spawn did.
function defaultWalk(text, reefBytes, axesBytes, { repo, knobs }) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-row-'));
  try {
    const reefFile = join(dir, 'reef.json'); writeFileSync(reefFile, reefBytes);
    const axesFile = join(dir, 'axes.json'); writeFileSync(axesFile, axesBytes);
    const { result } = lensWalk(text, {
      source: 'lens-cli', repoRoot: repo, reefPath: reefFile, axesPath: axesFile,
      maxChars: text.length || 1, digest: 'head', knobs, timeoutMs: 120000,
    });
    if (!result || !result.pixel) throw new Error('binary returned no pixel');
    return result.pixel;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

function base(row) {
  return {
    verdict: null, reason: '',
    signature: { valid: false, over: SIG_FIELDS.join('·'), pubkey: (row && row.sig_pubkey) || null },
    placement: { row: row ? row.pixel ?? null : null, recomputed: null },
    bin_sha: { row: (row && row.bin_sha) || null, here: null },
    reef: { blob: (row && row.reef_blob) || null, source: null },
    text: { sha_row: (row && row.text_sha) || null, sha_recomputed: null, source: null },
  };
}

// verifyRow(row, opts) → { verdict, reason, signature, placement, bin_sha, reef, text }
//   opts.repo      — repo path for --repo (default cwd)
//   opts.walk(text, reefBytes) => pixel   — injectable; skips axes + the real binary when given
//   opts.readReef(row) => Buffer          — injectable reef source
//   opts.readAxes(row) => Buffer          — injectable axes source
//   opts.readText(row) => string          — injectable text source (required for non-commit rows)
//   opts.reefFile / opts.axesFile         — local files, cross-checked against the row's blob ids
// checkRowSignature(row) → { ok: true, pub } | { ok: false, reason } — the signature half of
// verifyRow, factored out so B19's bundle verifier can check EVERY row's signature (commit or
// prompt) without running the placement half (which a prompt row without --text-dir can't do).
export function checkRowSignature(row) {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'signature: row is not a JSON object' };
  for (const f of SIG_FIELDS) {
    if (!(f in row)) return { ok: false, reason: `signature: row is missing field '${f}'` };
  }
  if (!row.sig) return { ok: false, reason: `signature: ${row.sig_why || 'missing sig'}` };
  if (!row.sig_pubkey) return { ok: false, reason: 'signature: missing sig_pubkey' };

  let pub;
  try { pub = pubKeyFromHex(row.sig_pubkey); }
  catch (e) { return { ok: false, reason: `signature: malformed sig_pubkey (${e.message})` }; }

  let sigBuf;
  try { sigBuf = Buffer.from(row.sig, 'hex'); if (sigBuf.length !== 64) throw new Error(`expected 64 bytes, got ${sigBuf.length}`); }
  catch (e) { return { ok: false, reason: `signature: malformed sig (${e.message})` }; }

  let sigValid = false;
  try { sigValid = edVerify(null, Buffer.from(canonicalTuple(row)), pub, sigBuf); }
  catch (e) { return { ok: false, reason: `signature: verify threw (${e.message})` }; }

  if (!sigValid) return { ok: false, reason: `signature: invalid over ${SIG_FIELDS.join('·')}` };
  return { ok: true, pub };
}

export function verifyRow(row, opts = {}) {
  const out = base(row);

  const sigCheck = checkRowSignature(row);
  if (!sigCheck.ok) { out.verdict = 'UNVERIFIABLE'; out.reason = sigCheck.reason; return out; }
  out.signature.valid = true;

  // ── PLACEMENT ────────────────────────────────────────────────────────────────────────
  const repo = opts.repo || process.cwd();
  const source = String(row.source || '');
  const isCommit = source.startsWith('commit');

  let text, textSource;
  try {
    if (opts.readText) { text = opts.readText(row); textSource = 'injected (--text)'; }
    else if (isCommit) {
      if (!row.ref) throw new Error(`commit row missing ref`);
      text = buildCommitText(row, repo); textSource = `commit ${row.ref} (${source})`;
    } else {
      throw new Error(`prompt rows carry text_sha only; supply --text <file>`);
    }
  } catch (e) {
    out.verdict = 'UNVERIFIABLE';
    out.reason = isCommit ? `text: commit ${row.ref} does not reproduce text_sha (${e.message})` : `text: ${e.message}`;
    return out;
  }

  const shaRecomputed = sha12(Buffer.from(text));
  out.text.sha_recomputed = shaRecomputed; out.text.source = textSource;
  if (shaRecomputed !== row.text_sha) {
    out.verdict = 'UNVERIFIABLE';
    out.reason = isCommit ? `text: commit ${row.ref} does not reproduce text_sha` : `text: recomputed sha ${shaRecomputed} does not match text_sha ${row.text_sha}`;
    return out;
  }

  let reefBytes, reefSource;
  try {
    ({ bytes: reefBytes, source: reefSource } = resolveBlob({ blobId: row.reef_blob, readFn: opts.readReef, fileOpt: opts.reefFile, repo, row, label: 'reef' }));
  } catch (e) { out.verdict = 'UNVERIFIABLE'; out.reason = `reef: blob ${row.reef_blob} not available (${e.message})`; return out; }
  out.reef.source = reefSource;

  // The real walk always reads a targets library; the injected test walk does not need it.
  let axesBytes = null;
  if (!opts.walk) {
    try {
      ({ bytes: axesBytes } = resolveBlob({ blobId: row.axes_blob, readFn: opts.readAxes, fileOpt: opts.axesFile, repo, row, label: 'axes' }));
    } catch (e) { out.verdict = 'UNVERIFIABLE'; out.reason = `reef: blob ${row.axes_blob} not available (${e.message})`; return out; }
  }

  const used = applyAperture(text, row.aperture);

  let bin = null;
  if (!opts.walk) {
    bin = resolveBin(repo);
    if (!bin) { out.verdict = 'UNVERIFIABLE'; out.reason = 'placement: pmu-onchip binary not found (set PMU_BINARY or run from the repo)'; return out; }
    // resolveBin only checks existsSync — PMU_BINARY can still name a directory or an unreadable
    // file, which must read UNVERIFIABLE (exit 2), never crash the process (found during B19: a
    // directory here threw EISDIR uncaught).
    try { out.bin_sha.here = sha256Hex16(readFileSync(bin)); }
    catch (e) { out.verdict = 'UNVERIFIABLE'; out.reason = `placement: pmu-onchip binary at ${bin} is not a readable file (${e.message})`; return out; }
  }

  let recomputed;
  try {
    recomputed = opts.walk ? opts.walk(used, reefBytes, row) : defaultWalk(used, reefBytes, axesBytes, { repo, knobs: row.knobs });
  } catch (e) { out.verdict = 'UNVERIFIABLE'; out.reason = `placement: walk failed (${e.message})`; return out; }

  out.placement.recomputed = recomputed;
  const same = recomputed === row.pixel;
  out.verdict = same ? 'MATCH' : 'MISMATCH';
  out.reason = `placement: row ${row.pixel} recomputed ${recomputed}`;
  if (out.bin_sha.here && row.bin_sha && out.bin_sha.here !== row.bin_sha) {
    out.reason += `; binary differs from the row's (${row.bin_sha} vs ${out.bin_sha.here})`;
  }
  return out;
}

export const EXIT_CODE = { MATCH: 0, MISMATCH: 1, UNVERIFIABLE: 2 };

// ═══ B19 — THE ATTESTATION BUNDLE (spec: the five gaps) ═══════════════════════════════════
// A single signed row certifies one PLACEMENT. A commit is a CONTRACT UNIT made of many turns
// (gap 2 — Goodhart by splitting), and a stranger checking it has neither our git history nor
// our reef file (gap 1 — the demonstration paradox), nor should they see raw prompt text (gap
// 4 — confidentiality). The bundle (produced by scripts/pmu/attest-bundle.mjs, never by this
// file) packs everything a git-free machine needs: the signed rows verbatim, the walked TEXT
// for commit rows only (keyed by text_sha, checked before packing), the reef/axes BYTES the
// walk ran against, and a COVENANT — a per-turn ledger plus the commit-unit aggregate computed
// from it — under one ed25519 signature over the whole payload. Everything below is pure
// arithmetic and pure crypto; nothing here shells out to git, so AB-1 (git absent) holds by
// construction, not by care taken at the call site.

// canonicalStringify — deterministic JSON (object keys sorted recursively, arrays keep order),
// so the producer and this verifier hash byte-identical strings over the same structure with no
// whitespace/key-order ambiguity between two independent implementations.
export function canonicalStringify(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v).sort()) out[k] = sort(v[k]); return out; }
    return v;
  };
  return JSON.stringify(sort(value));
}
export function sha256Hex(bufOrStr) { return createHash('sha256').update(Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr))).digest('hex'); }
// git's OWN blob id, computed with zero git calls — sha1("blob <len>\0" + bytes) is the whole
// algorithm — so a stranger with no repository (AB-1) can still prove packed reef/axes bytes
// really are the blob a row names, not merely "some bytes the bundle also happened to carry".
export function gitBlobIdJs(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
}
// underPrefixB19/underAnyB19/breachShareUnion — copied verbatim from scripts/pmu/kr37-covenant.mjs
// (breachShare) and scripts/pmu/kr33-uptake.mjs (underPrefix/underAny), reproduced here so this
// file never imports the private repo's kr-scripts, over an explicit `delivered` path list
// carried ON the bundle's own per_turn rows rather than read from a reef file at verify time.
function underPrefixB19(p, g) { p = String(p).replace(/^\.\//, '').replace(/\/+$/, ''); g = String(g).replace(/^\.\//, '').replace(/\/+$/, ''); return !!g && (p === g || p.startsWith(g + '/')); }
function underAnyB19(p, prefixes) { return (prefixes || []).some((g) => underPrefixB19(p, g)); }
export function breachShareUnion(touched, delivered) {
  const d = [...new Set(delivered || [])]; if (!d.length) return null;
  const distinct = [...new Set(touched || [])]; if (!distinct.length) return 0;
  let out = 0; for (const p of distinct) if (!underAnyB19(p, d)) out++;
  return +(out / distinct.length).toFixed(3);
}
// lanePathsFromReefBytes (B21) — the REEF-BYTES-ONLY half of src/lib/pmu/lane-paths.mjs's
// pathsFromTools: same per-token cleanup (strip `./`, trailing `*`/punctuation, the `blog:`
// convention → src/content/blog), but WITHOUT its existsSync/repo-membership filter — a stranger
// verifying this bundle has no filesystem to check candidate paths against, only the reef bytes
// the bundle itself packs (bundle.reef.bytes_b64). This is deliberately NOT lanePathMap(): that
// function's filesystem check makes it repo-state-dependent (a path declared in an old reef but
// since deleted silently drops out), which would make gate.lane_paths_sha unreproducible by a
// stranger and would drift under us even with no tamper. attest-bundle.mjs (the producer) imports
// THIS function — not lanePathMap() — to compute the gate, so producer and verifier run the
// identical, git-free algorithm over the identical packed bytes.
function pathTokenPure(tok) {
  if (/^blog:?$/.test(tok)) return 'src/content/blog';
  if (tok.startsWith('~') || tok.startsWith('/') || tok.startsWith('-') || !/[\/.]/.test(tok)) return null;
  tok = tok.replace(/^\.\//, '').replace(/\/?\*+$/, '').replace(/[),;:]+$/, '');
  return tok || null;
}
export function lanePathsFromReefBytes(reefBytes) {
  let reef;
  try { reef = JSON.parse(Buffer.isBuffer(reefBytes) ? reefBytes.toString('utf8') : String(reefBytes)); }
  catch (e) { throw new Error(`reef bytes do not parse as JSON (${e.message})`); }
  const domains = Array.isArray(reef.domains) ? reef.domains : [];
  const out = {};
  for (const d of domains) {
    if (!d || !d.domain) continue;
    const set = new Set();
    for (const tok of String(d.tools || '').split(/[,\s]+/)) { if (!tok) continue; const p = pathTokenPure(tok); if (p) set.add(p); }
    out[d.domain] = [...set].sort();
  }
  return out;
}
// B21 THE GATE's collar defaults — the SAME three numbers kr37-covenant.mjs pre-registers
// (TAU_PCT=25, K_CALLS=20, BETAS[0]=0) and attest-bundle.mjs restates for the producer.
// Named here so verifyBundle can (a) fall back for a pre-B21 caller of recomputeCommitUnit/
// turnPass directly (never silently for a B21+ bundle — see the "no gate pinned" refusal below)
// and (b) name a TRIPWIRE when a bundle's own pinned gate differs from what this verifier ships
// with — informational only, since AB-8 requires the bundle's OWN gate to win the recompute.
export const DEFAULT_TAU_PCT = 25;
export const DEFAULT_K_CALLS = 20;
export const DEFAULT_BREACH_MAX = 0;
// turnPass — one turn's own collar check (kr37's TAU_PCT=25 / K_CALLS=20 / breach_max=0 as
// defaults; the bundle stamps whatever tau/k/breach_max it was actually built with — since B21,
// that is its GATE, never this file's defaults — so a later ratchet change never silently
// rewrites a past bundle's verdict). A null leg EXCLUDES the turn, never fails it.
export function turnPass(t, { tau = DEFAULT_TAU_PCT, k = DEFAULT_K_CALLS, breachMax = DEFAULT_BREACH_MAX } = {}) {
  const off_lane_ok = typeof t.off_lane === 'number' ? (t.off_lane <= tau ? 1 : 0) : null;
  const breach_ok = typeof t.breach === 'number' ? (t.breach <= breachMax ? 1 : 0) : null;
  const calls_ok = typeof t.calls === 'number' ? (t.calls <= k ? 1 : 0) : null;
  const anyNull = off_lane_ok == null || breach_ok == null || calls_ok == null;
  return { off_lane_ok, breach_ok, calls_ok, pass: anyNull ? null : (off_lane_ok && breach_ok && calls_ok ? 1 : 0) };
}
// recomputeCommitUnit — THE ONE AGGREGATION, shared verbatim by the producer (which computes it
// once, at bundle-build time) and this verifier (which recomputes it from the bundle's OWN
// per_turn array and diffs it against the bundle's claim). THE GOODHART GUARD lives here: calls
// is a SUM across turns, so three turns of 8 calls each (24 total) clear pass_per_turn_all but
// fail pass_per_commit — splitting one big turn into many small ones cannot buy a pass.
// breachMax (B21): the collar's third bound, pinned in the bundle's `gate.collar.breach_max` —
// this function must NEVER hardcode it, or a bundle pinned looser than this file's default
// (breach_max 0.5, say) would recompute against the WRONG bound (AB-8).
export function recomputeCommitUnit(perTurn, { tau = DEFAULT_TAU_PCT, k = DEFAULT_K_CALLS, breachMax = DEFAULT_BREACH_MAX } = {}) {
  const rows = Array.isArray(perTurn) ? perTurn : [];
  const turns = rows.length;
  const calls = rows.reduce((a, t) => a + (typeof t.calls === 'number' ? t.calls : 0), 0);
  const offVals = rows.map((t) => t.off_lane).filter((v) => typeof v === 'number');
  const off_lane_mean = offVals.length ? +(offVals.reduce((a, b) => a + b, 0) / offVals.length).toFixed(3) : null;
  const touchedUnion = [...new Set(rows.flatMap((t) => t.touched_paths || []))];
  const deliveredUnion = [...new Set(rows.flatMap((t) => t.delivered || []))];
  const distinct_paths = touchedUnion.length;
  const breach = breachShareUnion(touchedUnion, deliveredUnion);
  const perTurnPasses = rows.map((t) => turnPass(t, { tau, k, breachMax }));
  const decidable = perTurnPasses.filter((p) => p.pass != null);
  const pass_per_turn_all = decidable.length ? (decidable.every((p) => p.pass === 1) ? 1 : 0) : null;
  const off_ok = off_lane_mean == null ? null : (off_lane_mean <= tau ? 1 : 0);
  const breach_ok = breach == null ? null : (breach <= breachMax ? 1 : 0);
  const calls_ok = calls <= k ? 1 : 0;
  const anyNull = off_ok == null || breach_ok == null;
  const pass_per_commit = anyNull ? null : (off_ok && breach_ok && calls_ok ? 1 : 0);
  return { turns, calls, distinct_paths, breach, off_lane_mean, pass_per_turn_all, pass_per_commit, tau_pct: tau, k_calls: k, breach_max: breachMax };
}
const COMMIT_UNIT_FIELDS = ['turns', 'calls', 'distinct_paths', 'breach', 'off_lane_mean', 'pass_per_turn_all', 'pass_per_commit'];
/** field-by-field diff of a recomputed commit_unit against the bundle's claim; [] means they agree */
export function diffCommitUnit(claimed, recomputed) {
  const diffs = [];
  for (const f of COMMIT_UNIT_FIELDS) {
    const a = claimed ? claimed[f] : undefined, b = recomputed[f];
    if (a !== b) diffs.push(`commit_unit.${f} claimed ${JSON.stringify(a)}, recomputed ${JSON.stringify(b)}`);
  }
  return diffs;
}

export const BUNDLE_SCHEMA = 'thetacog-attestation-bundle/1';

// verifyBundle(bundle, opts) — the whole envelope, git-free.
//   opts.repo     — passed through to verifyRow's resolveBin fallback chain only (no git call is
//                   ever made against it for text/reef/axes — those always come from the bundle)
//   opts.textDir  — a directory of <text_sha>.txt files; a prompt row recomputes (level 2) only
//                   when its file is present there, else it reads 'committed' (level 1)
//   opts.walk     — injectable, for tests (skips the real binary)
export function verifyBundle(bundle, opts = {}) {
  const out = { verdict: null, reason: '', envelope: { sig_valid: false }, rows: [], covenant: { claimed: null, recomputed: null, diffs: [] }, counts: {} };
  if (!bundle || typeof bundle !== 'object' || bundle.schema !== BUNDLE_SCHEMA) {
    out.verdict = 'UNVERIFIABLE'; out.reason = `schema: not a '${BUNDLE_SCHEMA}' object`; return out;
  }
  const env = bundle.envelope || {};
  if (!env.sig || !env.sig_pubkey) { out.verdict = 'UNVERIFIABLE'; out.reason = 'envelope: missing sig or sig_pubkey'; return out; }
  const payload = { ...bundle }; delete payload.envelope;
  const digest = sha256Hex(canonicalStringify(payload));
  let envValid = false;
  try {
    const envPub = pubKeyFromHex(env.sig_pubkey);
    const envSigBuf = Buffer.from(env.sig, 'hex'); if (envSigBuf.length !== 64) throw new Error(`expected 64 bytes, got ${envSigBuf.length}`);
    envValid = edVerify(null, Buffer.from(digest, 'hex'), envPub, envSigBuf);
  } catch (e) { out.verdict = 'UNVERIFIABLE'; out.reason = `envelope: signature check threw (${e.message})`; return out; }
  out.envelope.sig_valid = !!envValid;
  out.envelope.digest = digest;
  if (!envValid) { out.verdict = 'UNVERIFIABLE'; out.reason = 'envelope: signature invalid over the canonical JSON of the bundle (schema/commit/rows/texts/reef/axes/covenant/bin_sha/aperture)'; return out; }

  // reef/axes bytes must actually hash to the blob id the bundle DECLARES for them — pure JS,
  // no git — before any row is allowed to trust them.
  const reefBytes = bundle.reef && bundle.reef.bytes_b64 ? Buffer.from(bundle.reef.bytes_b64, 'base64') : null;
  const axesBytes = bundle.axes && bundle.axes.bytes_b64 ? Buffer.from(bundle.axes.bytes_b64, 'base64') : null;
  if (bundle.reef && bundle.reef.blob && reefBytes && gitBlobIdJs(reefBytes) !== bundle.reef.blob) { out.verdict = 'UNVERIFIABLE'; out.reason = `reef: packed bytes do not hash to the declared blob ${bundle.reef.blob}`; return out; }
  if (bundle.axes && bundle.axes.blob && axesBytes && gitBlobIdJs(axesBytes) !== bundle.axes.blob) { out.verdict = 'UNVERIFIABLE'; out.reason = `axes: packed bytes do not hash to the declared blob ${bundle.axes.blob}`; return out; }

  // ── B21 THE GATE (KR38/§8.51) ─────────────────────────────────────────────────────────
  // `gate` is a field of `bundle` like any other above — it was hashed into `digest` and checked
  // by the envelope signature already verified above, so tampering with ANY one of its three
  // fields (collar, covenant_module_blob, lane_paths_sha) invalidates the signature and this
  // function never reaches here: UNVERIFIABLE, never a silent MISMATCH (AB-7). A bundle with no
  // gate at all is a pre-B21 bundle and reads UNVERIFIABLE rather than falling back to this
  // verifier's own defaults — the exact retroactive strike-move KR38 forbids.
  const gate = bundle.gate;
  const gateOk = gate && gate.collar
    && typeof gate.collar.tau_pct === 'number' && typeof gate.collar.k_calls === 'number' && typeof gate.collar.breach_max === 'number'
    && typeof gate.covenant_module_blob === 'string' && gate.covenant_module_blob
    && typeof gate.lane_paths_sha === 'string' && gate.lane_paths_sha;
  if (!gateOk) { out.verdict = 'UNVERIFIABLE'; out.reason = 'gate: no gate pinned (pre-B21 bundle)'; return out; }
  let gateNote;
  if (reefBytes) {
    let recomputedLanePathsSha;
    try { recomputedLanePathsSha = sha256Hex(canonicalStringify(lanePathsFromReefBytes(reefBytes))); }
    catch (e) { out.verdict = 'UNVERIFIABLE'; out.reason = `gate: lane_paths_sha could not be recomputed (${e.message})`; return out; }
    if (recomputedLanePathsSha !== gate.lane_paths_sha) {
      out.gate = { pinned: true, match: false, collar: gate.collar, covenant_module_blob: gate.covenant_module_blob, lane_paths_sha: gate.lane_paths_sha, lane_paths_sha_recomputed: recomputedLanePathsSha };
      out.verdict = 'MISMATCH';
      out.reason = `gate drift: lane_paths_sha — the bundle's gate names ${gate.lane_paths_sha}, recomputed from its own packed reef ${recomputedLanePathsSha}`;
      return out;
    }
  }
  // the structural + lane_paths_sha checks passed; a differing collar from THIS verifier's own
  // defaults is informational only (the bundle's gate ALWAYS wins the recompute below, per AB-8),
  // named in the reason as a tripwire exactly as a differing bin_sha is today.
  const driftNotes = [];
  if (gate.collar.tau_pct !== DEFAULT_TAU_PCT) driftNotes.push(`collar tau ${gate.collar.tau_pct} vs this verifier's ${DEFAULT_TAU_PCT}`);
  if (gate.collar.k_calls !== DEFAULT_K_CALLS) driftNotes.push(`collar k ${gate.collar.k_calls} vs this verifier's ${DEFAULT_K_CALLS}`);
  if (gate.collar.breach_max !== DEFAULT_BREACH_MAX) driftNotes.push(`collar breach_max ${gate.collar.breach_max} vs this verifier's ${DEFAULT_BREACH_MAX}`);
  gateNote = driftNotes.length ? `gate drift: the bundle's ${driftNotes.join('; ')}` : 'gate: MATCH';
  out.gate = { pinned: true, match: true, collar: gate.collar, covenant_module_blob: gate.covenant_module_blob, lane_paths_sha: gate.lane_paths_sha };

  const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
  const repo = opts.repo || process.cwd();
  let sigInvalid = 0, commitTotal = 0, commitMatched = 0, commitMismatched = 0, commitUnverifiable = 0;
  let promptTotal = 0, promptCommitted = 0, promptRecomputed = 0, promptMismatched = 0, promptUnverifiable = 0;
  const rowResults = [];

  for (const row of rows) {
    const sigCheck = checkRowSignature(row);
    if (!sigCheck.ok) { sigInvalid++; rowResults.push({ ref: row && row.ref, source: row && row.source, status: 'unverifiable', reason: sigCheck.reason }); continue; }
    const isCommit = String(row.source || '').startsWith('commit');

    if (isCommit) {
      commitTotal++;
      if (row.reef_blob && bundle.reef && row.reef_blob !== bundle.reef.blob) { commitUnverifiable++; rowResults.push({ ref: row.ref, source: row.source, status: 'unverifiable', reason: `reef_blob ${row.reef_blob} differs from the bundle's packed reef ${bundle.reef.blob}` }); continue; }
      if (row.axes_blob && bundle.axes && row.axes_blob !== bundle.axes.blob) { commitUnverifiable++; rowResults.push({ ref: row.ref, source: row.source, status: 'unverifiable', reason: `axes_blob ${row.axes_blob} differs from the bundle's packed axes ${bundle.axes.blob}` }); continue; }
      const bundledText = bundle.texts ? bundle.texts[row.text_sha] : undefined;
      const rOpts = { repo, readText: () => { if (bundledText == null) throw new Error(`no bundled text for text_sha ${row.text_sha}`); return bundledText; } };
      if (reefBytes) rOpts.readReef = () => reefBytes;
      if (axesBytes) rOpts.readAxes = () => axesBytes;
      if (opts.walk) rOpts.walk = opts.walk;
      const r = verifyRow(row, rOpts);
      if (r.verdict === 'MATCH') commitMatched++; else if (r.verdict === 'MISMATCH') commitMismatched++; else commitUnverifiable++;
      rowResults.push({ ref: row.ref, source: row.source, status: r.verdict.toLowerCase(), reason: r.reason });
    } else {
      promptTotal++;
      const textFile = opts.textDir ? resolve(opts.textDir, `${row.text_sha}.txt`) : null;
      if (textFile && existsSync(textFile)) {
        const rOpts = { repo, readText: () => readFileSync(textFile, 'utf8') };
        if (reefBytes) rOpts.readReef = () => reefBytes;
        if (axesBytes) rOpts.readAxes = () => axesBytes;
        if (opts.walk) rOpts.walk = opts.walk;
        const r = verifyRow(row, rOpts);
        promptRecomputed++;
        if (r.verdict === 'MISMATCH') promptMismatched++; else if (r.verdict === 'UNVERIFIABLE') promptUnverifiable++;
        rowResults.push({ ref: row.ref || null, source: row.source, status: r.verdict.toLowerCase(), level: 2, reason: r.reason });
      } else {
        promptCommitted++;
        rowResults.push({ ref: row.ref || null, source: row.source, status: 'committed', level: 1, reason: `signature valid; text_sha ${row.text_sha} committed, not recomputed (supply --text-dir to recompute)` });
      }
    }
  }
  out.rows = rowResults;
  out.counts = { rows: rows.length, sig_invalid: sigInvalid, commit_rows: commitTotal, commit_matched: commitMatched, commit_mismatched: commitMismatched, commit_unverifiable: commitUnverifiable, prompt_rows: promptTotal, prompt_committed: promptCommitted, prompt_recomputed: promptRecomputed, prompt_mismatched: promptMismatched, prompt_unverifiable: promptUnverifiable };

  // the commit-unit covenant: recompute from the bundle's OWN per_turn array and diff against its
  // claim — using the bundle's OWN GATE (tau/k/breach_max), never this file's defaults (AB-8): a
  // bundle pinned looser (breach_max 0.5, say) must recompute against 0.5, not this verifier's 0.
  const covenant = bundle.covenant || {};
  const perTurn = Array.isArray(covenant.per_turn) ? covenant.per_turn : [];
  const tau = gate.collar.tau_pct;
  const k = gate.collar.k_calls;
  const breachMax = gate.collar.breach_max;
  const recomputed = recomputeCommitUnit(perTurn, { tau, k, breachMax });
  const diffs = covenant.commit_unit ? diffCommitUnit(covenant.commit_unit, recomputed) : ['covenant.commit_unit is absent from the bundle'];
  out.covenant = { claimed: covenant.commit_unit || null, recomputed, diffs };

  const anyUnverifiable = sigInvalid > 0 || commitUnverifiable > 0 || promptUnverifiable > 0;
  const anyMismatch = commitMismatched > 0 || promptMismatched > 0 || diffs.length > 0;
  out.verdict = anyUnverifiable ? 'UNVERIFIABLE' : anyMismatch ? 'MISMATCH' : 'MATCH';
  out.reason = `rows ${rows.length} · commit rows ${commitTotal} (${commitMatched} matched / ${commitMismatched} mismatched${commitUnverifiable ? ` / ${commitUnverifiable} unverifiable` : ''}) · `
    + `prompt rows ${promptTotal} committed (${promptCommitted}) / recomputed (${promptRecomputed}${promptMismatched || promptUnverifiable ? `, ${promptMismatched} mismatched, ${promptUnverifiable} unverifiable` : ''}) · `
    + `covenant claim recomputed: ${diffs.length === 0 ? 'yes' : 'no' + (diffs.length ? ' — ' + diffs.join('; ') : '')} · `
    + `envelope sig ${envValid ? 'valid' : 'invalid'}`
    + (sigInvalid ? ` · ${sigInvalid} row(s) failed signature verification` : '')
    + ` · ${gateNote}`;
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────
// npx thetacog-mcp verify <row.json> [--repo <path>] [--text <file>] [--reef <file>]
//                                    [--targets <file>] [--json]
// npx thetacog-mcp verify <bundle.json> [--repo <path>] [--text-dir <dir>] [--json]
// npx thetacog-mcp verify --demo   (verifies the shipped fixture; needs no repo, no --text)
const VALUED_FLAGS = new Set(['--repo', '--text', '--reef', '--targets', '--text-dir']);
function demoFixturePath() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    resolve(here, '..', '..', 'fixtures', 'demo-attestation-bundle.json'),                       // packaged: packages/thetacog-mcp/scripts/pmu/ → ../../fixtures
    resolve(here, '..', '..', 'packages', 'thetacog-mcp', 'fixtures', 'demo-attestation-bundle.json'), // dev checkout: scripts/pmu/ → ../../packages/thetacog-mcp/fixtures
  ]) if (existsSync(rel)) return rel;
  return null;
}
export function runCli(argv) {
  const flags = {}; let rowPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUED_FLAGS.has(a)) { flags[a] = argv[++i]; continue; }
    if (a === '--json') { flags['--json'] = true; continue; }
    if (a === '--demo') { flags['--demo'] = true; continue; }
    if (!a.startsWith('--') && !rowPath) rowPath = a;
  }
  const flag = (name) => flags[name] ?? null;

  if (flags['--demo']) {
    const fixture = demoFixturePath();
    if (!fixture) { console.log('UNVERIFIABLE'); console.log('reason: schema: no shipped demo fixture found (fixtures/demo-attestation-bundle.json)'); return 2; }
    rowPath = fixture;
  }

  if (!rowPath) {
    console.log('UNVERIFIABLE');
    console.log('reason: usage: npx thetacog-mcp verify <row.json|bundle.json> [--repo <path>] [--text <file>] [--reef <file>] [--targets <file>] [--text-dir <dir>] [--json] | verify --demo');
    return 2;
  }
  let parsed;
  try { parsed = JSON.parse(readFileSync(rowPath, 'utf8')); }
  catch (e) { console.log('UNVERIFIABLE'); console.log(`reason: signature: could not read/parse ${rowPath} (${e.message})`); return 2; }

  if (parsed && parsed.schema === BUNDLE_SCHEMA) {
    const opts = { repo: flag('--repo') || process.cwd() };
    const textDir = flag('--text-dir'); if (textDir) opts.textDir = textDir;
    const rust = tryRustVerifyBundle(rowPath, opts);
    if (rust.ok) {
      if (flags['--json']) console.log(JSON.stringify({ ...rust.detail, reason: rust.reason, engine: 'rust-verify' }, null, 2));
      else { console.log(rust.verdict); console.log(`reason: ${rust.reason}`); }
      return EXIT_CODE[rust.verdict] ?? 2;
    }
    const result = verifyBundle(parsed, opts);
    result.reason = `${result.reason} · engine: js-fallback (${rust.why})`;
    if (flags['--json']) console.log(JSON.stringify({ ...result, engine: 'js-fallback', engine_why: rust.why }, null, 2));
    else { console.log(result.verdict); console.log(`reason: ${result.reason}`); }
    return EXIT_CODE[result.verdict] ?? 2;
  }

  const row = parsed;
  const opts = { repo: flag('--repo') || process.cwd() };
  const textFile = flag('--text'); if (textFile) opts.readText = () => readFileSync(textFile, 'utf8');
  const reefFile = flag('--reef'); if (reefFile) opts.reefFile = reefFile;
  const targetsFile = flag('--targets'); if (targetsFile) opts.axesFile = targetsFile;

  const result = verifyRow(row, opts);
  if (flags['--json']) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.verdict);
    console.log(`reason: ${result.reason}`);
  }
  return EXIT_CODE[result.verdict] ?? 2;
}

// Only run the CLI when this file is the entry point (server.js dispatches into it as an import).
if (process.argv[1] && process.argv[1].endsWith('verify-row.mjs')) {
  process.exit(runCli(process.argv.slice(2)));
}
