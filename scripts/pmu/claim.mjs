#!/usr/bin/env node
// scripts/pmu/claim.mjs — C1158, THE HOLDER'S SIDE OF A CLAIM: `npx thetacog-mcp claim <commit-ref> [--out file.json]`.
//
// The paste asked for a "doctor replay exporter". The gap it names is the holder's side of a claim —
// a stranger holding a warranty needs one pack, built from one command, that carries three things:
//   1. the commit's ATTEST-BUNDLE (B19, scripts/pmu/attest-bundle.mjs) — the signed rows, the walked
//      commit text, the reef/axes bytes, the commit-unit covenant;
//   2. the SPEC DECLARED BEFORE THE COMMIT RAN (`git show <parent>:<specPath>`, never the spec at the
//      commit's own height — a commit that edits its own bound could otherwise widen the row it is
//      judged against);
//   3. the RECOMPUTE LINE that shows the miss — walkRepo's `reading` (WITHIN / OUTSIDE(guard …) /
//      UNDECLARED / UNMEASURED), run against exactly the spec text in (2).
//
// No PMU hardware-counter field: the PMU is a software walk against a 144-cell lattice, never the CPU's
// performance-monitoring unit (AXIOM 0's homonym warning) — nothing here claims the counter is shipped.
//
// NOTHING BUT THE WALKED TEXT LEAVES THE MACHINE: a claim pack carries no file content beyond what the
// bundle already packs (its walked commit text, reef bytes, axes bytes — each already scrubbed/pinned
// by attest-bundle.mjs) plus the spec text read in (2). contentFieldsOutsideAllowed() is the mechanical
// check; the CLI REFUSES to emit (exit 2) rather than ship a pack that failed it — AXIOM 1's rule that a
// generator refuses rather than emit a misleading artifact.
//
//   node scripts/pmu/claim.mjs <commit-ref> [--out file.json] [--repo <path>]
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from './attest-bundle.mjs';
import { findSpec, walkRepo } from './walk.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLAIM_SCHEMA = 'thetacog-claim-v1';

const git = (args, opts = {}) => { try { return execFileSync('git', args, { cwd: opts.repo || REPO, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

// the ONLY json-paths inside a claim pack allowed to carry raw file content: the bundle's own walked
// commit text (bundle.texts.<sha12>, governed by attest-bundle's leak scrub, B22), the reef/axes bytes
// it packs, and the spec text read at the PARENT height. Any OTHER string in the pack must stay short
// — see contentFieldsOutsideAllowed. A regex path, not a literal list, because bundle.texts is keyed
// by a text_sha that differs per commit.
export const ALLOWED_CONTENT_PATHS = [/^bundle\.texts\./, /^bundle\.reef\.bytes_b64$/, /^bundle\.axes\.bytes_b64$/, /^spec\.text$/];
export const BENIGN_STRING_MAX = 400; // a status line, a path, a sha, a reason string — never a file's worth of bytes

/** walk a claim pack's JSON and report every string value over `max` chars whose path matches none of
 *  `allowed` — file content that slipped in somewhere other than the bundle's own walked text / reef /
 *  axes bytes or the spec text read before the commit ran. Pure, no I/O — the CLI's refuse gate below
 *  is this function plus one exit-code decision; the guard test calls it directly on hand-built packs. */
export function contentFieldsOutsideAllowed(claim, { allowed = ALLOWED_CONTENT_PATHS, max = BENIGN_STRING_MAX } = {}) {
  const hits = [];
  (function walk(node, path) {
    if (typeof node === 'string') { if (node.length > max && !allowed.some((re) => re.test(path))) hits.push({ path, length: node.length }); return; }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (node && typeof node === 'object') { for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k); }
  })(claim, '');
  return hits;
}

/** the holder's side of a claim, in one pack. Throws on the same conditions buildBundle() throws on
 *  (no Originating-Terminal room on the commit) — this never swallows that; the CLI below reports it. */
export function buildClaim(ref, { repo = REPO, tapePath, specPath } = {}) {
  const sha = (git(['rev-parse', ref], { repo }) || '').trim();
  if (!sha) throw new Error(`${ref} does not resolve to a commit in ${repo}`);
  const parent = (git(['rev-parse', '--verify', '--quiet', `${sha}~1`], { repo }) || '').trim() || null;
  const { bundle } = buildBundle(sha, { repo, tapePath });

  const sp = findSpec(repo, specPath);
  const specRel = relative(repo, sp.path).split(sep).join('/');
  // the spec DECLARED BEFORE the commit ran — read at the PARENT's height, never the commit's own
  // (which could have edited the very row it is meant to bound). A root commit (no parent) or a spec
  // that did not yet exist at the parent both read exists_before_run: false, text: null — never UNDECLARED
  // silently mistaken for a missing read.
  let specText = null, existsBeforeRun = false;
  if (parent) { const out = git(['show', `${parent}:${specRel}`], { repo }); if (out != null) { specText = out; existsBeforeRun = true; } }

  // the RECOMPUTE LINE — walkRepo's own reading, run against exactly the spec text above (never the
  // file on disk at the commit's own height) and the commit's own changed paths since its parent.
  const { reading } = walkRepo({ repo, at: sha, specText: existsBeforeRun ? specText : null, guards: true });

  return {
    schema: CLAIM_SCHEMA,
    commit: { ref: sha.slice(0, 10), full_sha: sha, parent },
    spec: { path: specRel, exists_before_run: existsBeforeRun, text: existsBeforeRun ? specText : null },
    bundle,
    reading,
    sufficientFor: 'the spec declared before this commit ran, and whether the commit recomputes WITHIN, OUTSIDE, or UNDECLARED against it',
    notFor: 'whether the commit is bug-free (Rice) — not claimed',
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────
export async function runCli(argv) {
  const args = argv.slice();
  let ref = null; const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') { flags.out = args[++i]; continue; }
    if (a === '--repo') { flags.repo = args[++i]; continue; }
    if (!a.startsWith('--') && !ref) ref = a;
  }
  if (!ref) {
    console.error('usage: npx thetacog-mcp claim <commit-ref> [--out file.json] [--repo <path>]');
    console.error('  packs the holder\'s side of a claim: the commit\'s attest-bundle (B19), the spec text');
    console.error('  declared BEFORE the commit ran, and the recompute line (WITHIN / OUTSIDE(guard …) /');
    console.error('  UNDECLARED / UNMEASURED) that shows whether it landed inside that bound. Nothing but');
    console.error('  the bundle\'s own walked text leaves this machine.');
    return 2;
  }
  const repo = flags.repo || REPO;
  let claim;
  try { claim = buildClaim(ref, { repo }); }
  catch (e) { console.error(`claim: ${String(e && e.message || e).split('\n')[0]}`); return 2; }

  const leaks = contentFieldsOutsideAllowed(claim);
  if (leaks.length) {
    // AXIOM 1 — a generator refuses rather than emit a misleading artifact: never ship a pack that
    // failed its own no-extra-file-content check.
    console.error(`claim: refused — ${leaks.length} field(s) carry content outside the bundle's walked text: ${leaks.map((l) => `${l.path} (${l.length} chars)`).join(', ')}`);
    return 2;
  }

  const json = JSON.stringify(claim, null, 1);
  if (flags.out) {
    writeFileSync(flags.out, json);
    const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
    console.log(`claim: ${claim.commit.ref} → ${flags.out} (${kb} KB) · spec ${claim.spec.exists_before_run ? 'declared before run' : 'none declared before run'} · reading ${claim.reading.word}`);
  } else {
    console.log(json);
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('claim.mjs')) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
