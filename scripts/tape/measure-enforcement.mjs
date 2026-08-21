// packages/thetacog-mcp/scripts/tape/measure-enforcement.mjs — THE CLOSING ARROW.
//
// A rule was decided, subagents were dispatched, commits landed. Did the work land WHERE THE RULE
// SAID? (source doc L1355-58: "the distance between the physical rule on the tape and the AI's
// actual output is your quantifiable drift.") This module answers that, and ONLY that.
//
// ── REUSE, NEVER A SECOND GATE ──────────────────────────────────────────────────────────────────
// scripts/pmu/vega-backtest.mjs already does this per commit across a whole git log: the doc/code
// added-line split, buildTriptychInputs, decodeDeltaThreeColourEdges (via renderTriptych), and the
// honest REFUSE on thin commits (excluded from stats, never faked into them). This module points
// that SAME recipe at ONE commit instead of a log — the doc/code split below is copied byte-for-byte
// from vega-backtest.mjs's inline loop (same DOC_EXT/CODE_EXT, same "codeAdd || docAdd" fallback for
// doc-only commits) so a single-atom enforcement reading and a whole-log backtest can never disagree
// about what counts as REALITY. The decode step itself — buildTriptychInputs -> renderTriptych's
// internal decodeDeltaThreeColourEdges — is IMPORTED, never reimplemented. The receipt PNG is
// rendered through regions-chip.mjs:encircledPanel, the same one and only encircle chain every other
// surface (attest-demo, attest-serve, the commit email) uses — no call site re-grows its own chain.
//
// ── WHAT offPct DOES NOT LICENSE ────────────────────────────────────────────────────────────────
// offPct is a decidable WHERE — whether the commit's semantic mass sits in the rule's lane. It is
// NOT a claim the code is correct. A perfectly targeted commit can still be buggy; that is the
// falsifier's job, reported BESIDE offPct in its own field, never summed into one number.
//
// ── REALITY IS READ FROM THE IMMUTABLE COMMIT, NEVER THE WORKING TREE ──────────────────────────
// Every git read here is `git show <sha> ...` against the object store. Reading the checked-out
// tree instead would make the receipt a function of whatever happens to be on disk at measurement
// time — destroying the one property that makes it a receipt (reproducible from the sha alone).
// Guarded by tests/tape/enforcement-reads-the-commit.test.mjs (source inspection + same-sha-twice-
// with-a-dirty-tree-between, byte-identical).
//
// @canonical  git show <sha> only · buildTriptychInputs/renderTriptych imported not reimplemented ·
//             offPct and falsifier reported separately, never merged · thin commits REFUSE honestly
// @guard      tests/tape/enforcement-reads-the-commit.test.mjs

import { execFileSync } from 'node:child_process';
// git via the resolver — a bare 'git' is Apple's licence-gated xcrun stub and dies silently
// in any process without DEVELOPER_DIR (see git-bin.mjs; it cost 17 of 26 coordinates their owns[]).
import { git } from './git-bin.mjs';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');   // packages/thetacog-mcp
// This repo's OWN root — used ONLY as the default target for `git show` (when no repoRoot is
// given) and as the location buildTriptychInputs' pipeline.mjs resolves its own caches from
// internally. It is NEVER assumed to be where a caller-supplied `sha` lives — `repoRoot` always
// wins for the git shell-outs, so a throwaway/test repo works exactly like the real one.
const REPO = resolve(PKG, '..', '..');

// Byte-for-byte the same split vega-backtest.mjs uses on its git log — see header note above.
const DOC_EXT = /\.(md|mdx|txt|html?)$/i;
const CODE_EXT = /\.(m?[jt]sx?|rs|py|go|rb|java|c|cc|cpp|h|sh|sql|css|ya?ml|json)$/i;

function gitShow(args, cwd) {
  const r = git(['show', ...args], { cwd, maxBuffer: 5e7 });
  if (!r.ok) throw new Error(r.reason);   // a dead git must not read as an empty diff
  return r.out;
}

// The commit's added lines, split doc/code — the SAID/DID split the on-commit instrument uses.
export function commitAddedLines(sha, repoRoot) {
  const diff = gitShow(['--format=', '--unified=0', sha], repoRoot);
  let docAdd = '', codeAdd = '', file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    if (DOC_EXT.test(file)) docAdd += text + '\n';
    else if (CODE_EXT.test(file)) codeAdd += text + '\n';
  }
  return { docAdd, codeAdd };
}

export function commitMessage(sha, repoRoot) {
  return gitShow(['-s', '--format=%B', sha], repoRoot);
}

const emptyFalsifier = () => ({ ran: false, exitCode: null, output: null });

// measureEnforcement({atom, sha, repoRoot, slug}) — the closing arrow.
//   atom     — the decided spec atom {id, rule, quote, falsifier?, ...} (specs.ndjson row shape)
//   sha      — the commit to measure back against the atom
//   repoRoot — where `git show` runs AND what buildTriptychInputs is told is its repo (defaults to
//              this repo's own root); pass a different repo for a throwaway/test tree
//   slug     — the tape session slug; when given, the receipt PNG is written to
//              <session>/html/receipts/<atomId>-<sha>.png. Omit it and receiptPng comes back null
//              WITH a reason — never a fake path.
export async function measureEnforcement({ atom, sha, repoRoot, slug } = {}) {
  const t0 = Date.now();
  const base = { offPct: null, sigmaDrift: null, refused: true, reason: null, receiptPng: null, receiptReason: null, falsifier: emptyFalsifier(), ms: 0 };

  if (!atom || !sha) {
    return { ...base, reason: 'measureEnforcement requires {atom, sha}', ms: Date.now() - t0 };
  }
  const gitRoot = repoRoot ? resolve(repoRoot) : REPO;

  // ── 1. reality from the IMMUTABLE commit, never the tree ──────────────────────────────────────
  let msg = '', docAdd = '', codeAdd = '';
  try {
    msg = commitMessage(sha, gitRoot);
    ({ docAdd, codeAdd } = commitAddedLines(sha, gitRoot));
  } catch (e) {
    return { ...base, reason: `git show ${sha} failed: ${String(e.message || e).slice(0, 200)}`, ms: Date.now() - t0 };
  }

  const intentParts = [atom.rule, atom.quote];
  if (atom.falsifier) intentParts.push(`falsifier: ${atom.falsifier}`);
  const intentText = intentParts.filter(Boolean).join('\n').trim();
  // doc-only commits: the doc IS what was done (vega-backtest.mjs's own rule, kept identical here).
  const realityText = (codeAdd || docAdd).trim();
  void msg; // kept for a future intentText+=msg tuning pass; not load-bearing today

  if (!intentText || !realityText) {
    const which = !intentText ? 'atom carries no rule/quote text' : 'commit added no doc or code lines (thin/empty diff)';
    return { ...base, reason: `THIN — ${which}; excluded from stats, never faked into them`, ms: Date.now() - t0 };
  }

  // ── 2. through the SAME gate the battery uses ──────────────────────────────────────────────────
  // Session-scoped axes (DECISION-017, revised 2026-08-20): when this reading is for a tape
  // session that built its own .thetacog/tape-sessions/<slug>/axes-144.json, walk THAT 144-axis
  // library instead of the repo-wide default — the same resolve-and-existsSync check momentum.mjs
  // already runs (packages/thetacog-mcp/scripts/tape/momentum.mjs:136-137), against REPO (this
  // repo's own root — tape session state is never relocated by a caller-supplied repoRoot; see the
  // receiptPng step below, which resolves sessionPath the same way). No slug, or a slug with no
  // axes-144.json yet, leaves axesPath undefined — buildTriptychInputs' own default (the repo-wide
  // library) — so today's behaviour is unchanged in both cases.
  let axesPath;
  if (slug) {
    const p = resolve(REPO, `.thetacog/tape-sessions/${slug}/axes-144.json`);
    if (existsSync(p)) axesPath = p;
  }
  let offPct = null, sigmaDrift = null, refused = false, reason = null, rgbas = null;
  try {
    const { buildTriptychInputs } = await import(resolve(REPO, 'scripts/pmu/triptych-build.mjs'));
    const { renderTriptych } = await import(resolve(REPO, 'scripts/pmu/triptych-render.mjs'));
    const built = await buildTriptychInputs({ intentText, realityText, repoRoot: gitRoot, intentLabel: 'rule', realityLabel: 'commit', killTolerancePct: 25, axesPath });
    const t = renderTriptych({
      ...built.renderArgs, killTolerancePct: 25,
      label: `tape enforcement — ${atom.id || 'atom'} vs ${String(sha).slice(0, 9)}`,
    });
    sigmaDrift = Number.isFinite(built.meta?.matchSigma) ? built.meta.matchSigma : null;
    rgbas = t.rgbas || null;
    if (t.tol?.refused) {
      refused = true;
      reason = t.tol.refusal || 'LIT-MASS FLOOR — too thin to grade; UNMEASURED, never a pass';
    } else if (t.tol && t.tol.offPct != null) {
      offPct = t.tol.offPct;
    } else {
      refused = true;
      reason = 'triptych returned no offPct (degenerate render)';
    }
  } catch (e) {
    refused = true;
    reason = `triptych build/render threw: ${String(e.message || e).slice(0, 200)}`;
  }

  // ── 3. the receipt PNG — encircled INTENT/REALITY/Δ, the one and only encircle chain ────────────
  let receiptPng = null, receiptReason = null;
  if (!refused && rgbas && slug) {
    try {
      const { encircledPanel } = await import(resolve(REPO, 'scripts/pmu/regions-chip.mjs'));
      const { sessionPath } = await import(resolve(PKG, 'scripts/tape/store.mjs'));
      const enc = encircledPanel(rgbas, { scale: 4 });
      if (enc?.dataUri) {
        const dir = resolve(sessionPath(slug), 'html', 'receipts');
        mkdirSync(dir, { recursive: true });
        const shaShort = String(sha).slice(0, 9);
        const atomId = String(atom.id || 'atom').replace(/[^\w-]/g, '_');
        const file = resolve(dir, `${atomId}-${shaShort}.png`);
        const b64 = enc.dataUri.slice(enc.dataUri.indexOf(',') + 1);
        writeFileSync(file, Buffer.from(b64, 'base64'));
        receiptPng = file;
      } else {
        receiptReason = 'encircledPanel produced no panel (no substantial surface to encircle)';
      }
    } catch (e) {
      receiptReason = `receipt render failed: ${String(e.message || e).slice(0, 200)}`;
    }
  } else if (!refused && !slug) {
    receiptReason = 'no slug/session provided — cannot resolve <session>/html/receipts/, so no PNG was written';
  } else if (refused) {
    receiptReason = 'not rendered — the measurement itself refused';
  }

  // ── 4. the falsifier — run BESIDE offPct, its own field, never summed into it ────────────────────
  const falsifier = emptyFalsifier();
  if (atom.falsifier && typeof atom.falsifier === 'string' && atom.falsifier.trim()) {
    falsifier.ran = true;
    try {
      const out = execFileSync('/bin/sh', ['-c', atom.falsifier], { cwd: gitRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 5e6 });
      falsifier.exitCode = 0;
      falsifier.output = String(out).slice(0, 4000);
    } catch (e) {
      falsifier.exitCode = typeof e.status === 'number' ? e.status : (e.signal ? 124 : 1);
      falsifier.output = String(e.stdout || e.stderr || e.message || '').slice(0, 4000);
    }
  }

  return { offPct, sigmaDrift, refused, reason, receiptPng, receiptReason, falsifier, ms: Date.now() - t0 };
}

export const __internals__ = { DOC_EXT, CODE_EXT, REPO };
