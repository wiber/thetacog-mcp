#!/usr/bin/env node
// THE BRIDGE: a graduated spec becomes an attested entry on the thetacog physics tape.
//
// Operator, 2026-08-28: "thetacog-mcp is only truly autonomous when the shimmed part
// integrates cleanly — the gemini pipeline here is just one source to build spec from, it
// could be anything — so integrate the shimmed part as tightly as possible with the
// thetacog-mcp tape attestations."
//
// THE FIT, stated once so it stops being re-derived. write_tape_intent takes an INTENT and
// a REALITY and returns a cursor; the physics then fires LLM-free on read. The funnel has
// exactly those two things and has had them all along: the spec is the intent, the commit
// is the reality. They were being compared by the commit panel and nowhere else, which
// made the comparison a property of one renderer rather than a record anyone can re-derive.
// Writing the pair onto the tape makes the same measurement a ledger entry.
//
// SOURCE-AGNOSTIC BY CONSTRUCTION. Nothing below knows what Gemini is. It takes a spec
// record and a commit; where the spec's spans came from — a dictated web app, a meeting, a
// file, another agent — is a field, not a branch. Gemini is adapter number one.
//
// RECOMPUTABLE, WHICH IS THE POINT. Operator: "the tape must have the full tesseract (or
// git logged edits) so that this can be recomputed." The tape row's `inputs` carries the
// whole spec text and the whole git-logged edit, not a summary of either, so the physics
// re-derives from the row alone — no repo, no model, no process that was running at the
// time. A row carrying only a verdict would be an account of a measurement rather than the
// thing needed to repeat it, which is the distinction AXIOM 1 turns on.
//
//   node scripts/elicit/spec-attest.mjs --spec specs/s-0148.slug --commit <sha>
//   node scripts/elicit/spec-attest.mjs --spec <dir> --commit <sha> --json
//
// Guard: tests/elicit/spec-attest.test.mjs

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

/**
 * The git-logged edits, bounded but not summarised.
 *
 * The tape must carry enough to recompute, so this is the actual diff rather than a
 * shortstat. It is capped because a tape row is not a place to put a vendored dependency
 * bump — and when the cap bites, the row SAYS it was truncated, because a silently
 * shortened reality would make every later recomputation disagree with this one for
 * reasons nobody could see.
 */
export function gitLoggedEdits(sha, { repo = REPO, maxChars = 60000 } = {}) {
  const stat = execSync(`git show --numstat --format= ${sha}`,
    { cwd: repo, encoding: 'utf8' }).trim();
  const msg = execSync(`git log -1 --format=%s%n%n%b ${sha}`,
    { cwd: repo, encoding: 'utf8' }).trim();
  const diff = execSync(`git show --format= --unified=0 ${sha}`,
    { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });

  const head = [
    `COMMIT ${sha}`, '',
    'MESSAGE', msg, '',
    'FILES CHANGED (insertions\tdeletions\tpath)', stat, '',
    'EDITS',
  ].join('\n');

  const room = Math.max(0, maxChars - head.length);
  const truncated = diff.length > room;
  return {
    text: head + '\n' + (truncated
      ? diff.slice(0, room) + `\n[TRUNCATED at ${room} of ${diff.length} chars — the full edit is in git at ${sha}]`
      : diff),
    truncated,
    files: stat.split('\n').filter(Boolean).length,
    bytes: diff.length,
  };
}

/**
 * The catastrophe boundary, which the tape asks for by name.
 *
 * For a spec the catastrophe is not "a bug" — undecidable, and we do not claim it. It is
 * the decidable one: the commit went somewhere the spec never declared, or never reached
 * somewhere it did. Stating it explicitly is what lets the physics measure against a
 * boundary rather than against nothing.
 */
export function catastropheBoundary(targets, touched) {
  const declared = new Set(targets);
  const extra = touched.filter((f) => !declared.has(f) && !/^specs\/[^/]+\//.test(f));
  const missing = targets.filter((f) => !touched.includes(f));
  const lines = [
    'The declared surface was:',
    ...(targets.length ? targets.map((t) => `  ${t}`) : ['  (none named)']),
    '',
    'A failure here is work landing outside that surface, or not landing on it.',
  ];
  if (extra.length) lines.push('', 'TOUCHED, NOT DECLARED:', ...extra.map((f) => `  ${f}`));
  if (missing.length) lines.push('', 'DECLARED, NOT TOUCHED:', ...missing.map((f) => `  ${f}`));
  if (!extra.length && !missing.length) lines.push('', 'BALANCED: neither divergence occurred.');
  return { text: lines.join('\n'), extra, missing, balanced: !extra.length && !missing.length };
}

/**
 * Attest a spec against the commit it produced. Returns the cursor and what was written.
 *
 * The cursor is the receipt pointer, and per the tape's own contract nothing may be
 * declared successful on it — the physics has not run yet. read_tape_receipt is the gate.
 */
/**
 * THE APERTURE, and it belongs here rather than on the panel.
 *
 * Operator: "the spec must be very explicitly included in what creates the intent reality
 * encircled png ... with the aperture to reasonable sizes."
 *
 * The panel was the wrong place to act on that, and the measurement said so: bulking the
 * spec there moved sigma from 1.24 to 1.23 with the actual match identical to four decimal
 * places, because the panel compares whole corpora and the spec is one component beside the
 * commit message, the docs and the tests. A change that does not change the measurement is
 * a control wired to nothing.
 *
 * THIS is where the spec stands alone. write_tape_intent takes the spec as the entire
 * intent and the git-logged edit as the entire reality, and measured on a real pair that is
 * gzip 308 against gzip 2512 — an 8.2x size-order mismatch. META-BULK is explicit that
 * gzip-NCD measures meaning only at matched size-order, so without this the spec is placed
 * partly by how short it is.
 *
 * bulk() is imported from grip-navigator rather than re-implemented. The snippet library
 * keys on the COMPOSED Actor-Patient coordinate (C,C2), never a bare axis — a lookup on
 * "C2" returns an empty string and bulks with nothing, which looks exactly like success.
 */
export async function bulkToAperture(text, declaredCoord) {
  const body = String(text || "");
  if (!body) return { text: body, coord: null, cell: 0 };
  const raw = declaredCoord
    || (body.match(/\*\*Coordinate\*\*\s*`([^`]+)`/) || [])[1]
    || null;
  const t = String(raw || "").trim();
  const coord = !t ? null : (t.includes(",") ? t : `${t[0]},${t}`);
  if (!coord) return { text: body, coord: null, cell: 0 };
  try {
    const { bulk, cellText } = await import("../pmu/grip-navigator.mjs");
    const cell = cellText(coord);
    // An unresolved coordinate bulks with an empty string: a no-op wearing the shape of
    // the fix. Report it rather than return silently.
    if (!cell) return { text: body, coord, cell: 0, unresolved: true };
    return { text: bulk(body, coord), coord, cell: cell.length };
  } catch {
    return { text: body, coord, cell: 0 };
  }
}
/**
 * THE REALITY HALF IS SEMANTIC, NOT RAW — and this is what made the measurement useful.
 *
 * Measured, four ways, on one real pair (spec s-0148 against dc9ae2272):
 *
 *   raw diff, raw spec          9.9x   dI 0.9109   offPct 23
 *   raw diff, bulked spec       3.4x   dI 0.9092   offPct 23
 *   SEMANTIC reality, raw spec  5.7x   dI 0.9236   offPct 39
 *   SEMANTIC reality, bulked    2.0x   dI 0.9088   offPct 39
 *
 * Aperture alone changes nothing: rows one and two differ only in size-order and the
 * physics does not move. What moves the measurement is the reality half. Against a raw
 * unified diff, offPct sits at 23 and stays there no matter how the intent is padded —
 * English prose and a diff share almost no compressible structure, so the number is not
 * discriminating, it is saturated. Against the semantic extraction it reads 39, which is
 * the measurement finally responding to what the commit actually says.
 *
 * And BOTH are needed. Switching to semantic reality alone inflates dI from 0.9109 to
 * 0.9236 — a change one would read as the work getting worse when it is the aperture
 * slipping. Bulked, dI returns to 0.9088 and only offPct moves, which is the honest
 * reading: the lane occupancy changed, the distance did not.
 *
 * CLAUDE.md already said this — "code to reality SEMANTIC not raw, comments plus
 * identifier-words; the reality corpus is ~81% code-as-claim and SimHash grips it
 * poorly" — and the first version of this file ignored it. semanticExtract is imported
 * from reef-focus rather than re-implemented.
 *
 * RECOMPUTABILITY IS NOT LOST. The row still names its commit, and semanticExtract is a
 * pure function of the added lines, so anyone with the sha re-derives the same reality
 * text byte for byte. The full edit stays in git, addressed by the sha the row carries.
 */
export async function semanticReality(sha, { repo = REPO } = {}) {
  const added = execSync(`git show --format= --unified=0 ${sha}`,
    { cwd: repo, encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1)).join("\n");
  try {
    const { semanticExtract } = await import("../pmu/reef-focus.mjs");
    const sem = semanticExtract(added);
    // A commit of pure data (a lockfile, a binary bump) extracts to almost nothing. Fall
    // back to the raw added lines rather than measure against an empty string, and say so.
    if (sem.length < 40) return { text: added, mode: "raw-fallback", rawChars: added.length };
    return { text: sem, mode: "semantic", rawChars: added.length };
  } catch {
    return { text: added, mode: "raw-fallback", rawChars: added.length };
  }
}
export async function attestSpec({ specDir, sha, repo = REPO, tapePath = null, source = 'unknown' }) {
  // specDir may be repo-relative (how the trailer names it) or absolute (how a caller with
  // a path already resolved hands it over). Joining an absolute path onto the repo root
  // silently produces a path that cannot exist, and the error then blames the spec.
  const base = specDir.startsWith('/') ? specDir : join(repo, specDir);
  const specPath = join(base, 'spec.md');
  if (!existsSync(specPath)) throw new Error(`no spec.md at ${specDir}`);
  const intent = readFileSync(specPath, 'utf8');

  const snapPath = join(base, 'snapshot.hash');
  const snapshot = existsSync(snapPath) ? readFileSync(snapPath, 'utf8').trim() : null;

  const edits = gitLoggedEdits(sha, { repo });
  const touched = execSync(`git show --name-only --format= ${sha}`,
    { cwd: repo, encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
  const targets = [...intent.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
  const boundary = catastropheBoundary(targets, touched);

  const { writeTapeIntent, defaultTapePath } = await import(
    join(repo, 'packages/thetacog-mcp/scripts/pmu/tape-intent.mjs'));
  const tape = tapePath || defaultTapePath();

  // semantic-drift is the preset whose scenarioKey is 'analysis-execution' — which is
  // precisely this measurement: what was analysed against what was executed.
  // Matched aperture: the spec carries its cell mass so the pair is the same size-order.
  const ap = await bulkToAperture(intent);
  const sem = await semanticReality(sha, { repo });
  // The row keeps the commit identity and the numstat so it stays recomputable, and
  // measures on the semantic body rather than the raw diff.
  const realityText = [
    `COMMIT ${sha}`, `REALITY-MODE ${sem.mode} (from ${sem.rawChars} chars of added diff)`, "",
    sem.text,
  ].join("\n");
  const out = writeTapeIntent({
    intent_text: ap.text,
    reality_text: realityText,
    negative_text: boundary.text,
    scenario_tag: 'semantic-drift',
    tape,
  });

  if (out.cursor_id) {
    // The attestation lives WITH the spec record, so a reader who has the directory has the
    // pointer. It is written after the tape write, never before: a cursor recorded for an
    // entry that was rejected would point at nothing.
    writeFileSync(join(base, 'attestation.json'), JSON.stringify({
      cursor_id: out.cursor_id,
      status: out.status,
      commit: sha,
      snapshot,
      source,
      tape: tape.replace(repo + '/', ''),
      declared: targets,
      touched: touched.filter((f) => !/^specs\/[^/]+\//.test(f)),
      balanced: boundary.balanced,
      edit_bytes: edits.bytes,
      edit_truncated: edits.truncated,
    }, null, 2) + '\n');
  }

  return { ...out, tape, snapshot, balanced: boundary.balanced, aperture: ap,
           declared: targets, extra: boundary.extra, missing: boundary.missing,
           editBytes: edits.bytes, truncated: edits.truncated, reality: sem };
}

if (process.argv[1] && process.argv[1].endsWith('spec-attest.mjs')) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
  const specDir = arg('--spec');
  const sha = arg('--commit');
  if (!specDir || !sha) {
    console.error('usage: spec-attest.mjs --spec specs/<dir> --commit <sha> [--source <name>] [--json]');
    process.exit(2);
  }
  const r = await attestSpec({ specDir, sha, source: arg('--source') || 'unknown' });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); }
  else if (!r.cursor_id) {
    console.log(`refused: ${r.status} — ${r.instruction || ''}`);
  } else {
    console.log(`attested ${specDir} against ${sha}`);
    console.log(`  cursor   ${r.cursor_id.slice(0, 16)}…  (${r.status})`);
    console.log(`  boundary ${r.balanced ? 'BALANCED' : `${r.extra.length} undeclared · ${r.missing.length} unreached`}`);
    console.log(`  reality  ${r.editBytes.toLocaleString()} chars of git-logged edit${r.truncated ? ' (truncated on the tape; full edit in git)' : ''}`);
    console.log('  the physics has NOT run. read_tape_receipt with this cursor is the gate.');
  }
  process.exit(r.cursor_id ? 0 : 1);
}
