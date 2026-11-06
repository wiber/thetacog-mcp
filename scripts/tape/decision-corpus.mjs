// packages/thetacog-mcp/scripts/tape/decision-corpus.mjs — GIVE A DECISION AN INTENT WITH MASS.
//
// ── THE PROBLEM THIS EXISTS TO FIX ────────────────────────────────────────────────────────────
// Operator, looking at the panel on the cockpit: "this clearly is wrong… it was not a panel
// properly made by rust, usually means the aperture is wrong."
//
// He was right, and chasing it down found something worse than a bad render. Every one of the nine
// locked coordinates carries quote: null, steer: null, source: null. Nothing recorded WHICH part of
// the past produced the rule. So the entire intent side of a decision panel is the rule sentence
// itself — 135 to 285 characters, 120 to 204 gzip bytes against a 220-byte entropy floor. All nine
// panels were below the floor, which means all nine were reading LENGTH rather than meaning, which
// is why they rendered as a regular periodic tiling wrapped in giant rings.
//
// You cannot fix that with a re-render. A rule sentence is not an intent; it is the CONCLUSION of
// one. The intent is the stretch of transcript the rule was drawn out of, and that text exists —
// turns.json holds 67 turns and 176,159 characters of it.
//
// ── RECORDED vs RECOVERED, AND WHY THE DIFFERENCE IS STATED ON EVERY ROW ──────────────────────
// Going forward a coordinate should record its evidence at lock time; that is a change to the lock
// path, not to this file. For the nine that already exist there is no recorded link, so this file
// RECOVERS one by matching the rule against the turn corpus with the calibrated sensor — and says
// so, on every row, in the provenance. A recovered link is a measurement with a real error bar: it
// is what the sensor thinks the rule came from, not what anyone wrote down. Presenting the two as
// the same thing would be exactly the quiet substitution this project keeps getting bitten by.
//
// ── THE SENSOR, AND WHY NOT A BARE ncd() ──────────────────────────────────────────────────────
// match(plate, aperture) slides a plate-length window across the aperture, so a 200-char rule is
// compared against 200-char stretches of a 4,000-char turn instead of against the whole turn. Bare
// ncd() would rank the SHORTEST turns first no matter what they say — the same length artifact that
// broke plate ranking and question ranking earlier in this project. Same lesson, third call site:
// MEASURE THROUGH A MATCHED APERTURE.
//
//   node packages/thetacog-mcp/scripts/tape/decision-corpus.mjs --slug gddadwill [--id COORD-004]
//                                                               [--render] [--json]
//
// @guard tests/tape/decision-corpus-clears-the-floor.test.mjs

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
// git via the resolver — a bare 'git' is Apple's licence-gated xcrun stub and dies silently
// in any process without DEVELOPER_DIR (see git-bin.mjs; it cost 17 of 26 coordinates their owns[]).
import { git } from './git-bin.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

export function loadTurns(slug) {
  const p = resolve(SESSIONS, slug, 'turns.json');
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.turns || []);
    return arr.filter((t) => String(t?.text || '').trim().length > 0);
  } catch { return []; }
}

/**
 * Recover which turns a rule most plausibly came from, through a matched aperture.
 * Returns turns ranked closest-first, each carrying its score and the fact it is RECOVERED.
 */
export function recoverEvidence(rule, turns, P, { k = 6 } = {}) {
  const scored = turns.map((t) => {
    const m = P.match(rule, String(t.text));
    return { ...t, score: m.plateMatch, at: m.at, windows: m.windows, lowMass: m.lowMass };
  }).filter((t) => Number.isFinite(t.score));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, k);
}

/** Read the surface the rule claims, from the IMMUTABLE commit — never the mutable working tree. */
export function readSurface(file, ref = 'HEAD') {
  if (!file) return { text: '', reason: 'no Target_Surface named on this coordinate' };
  try {
    const r = git(['show', `${ref}:${file}`], { maxBuffer: 5e7 });
    // A dead git here empties the REALITY side of every panel, which the gate then refuses as a
    // thin pair — the sparse panels the operator kept reporting. Never a silent empty string.
    if (!r.ok) return { text: '', reason: r.reason };
    return { text: r.out, reason: null };
  } catch (e) {
    return { text: '', reason: `git show ${ref}:${file} failed — ${String(e.message).slice(0, 140)}` };
  }
}

/**
 * Build the admissible pair for one decision.
 * INTENT  = the rule plus the evidence it was drawn from, grown ONLY by adding real turns — never
 *           by repetition, which adds length and no entropy (physics.mjs bulkToMatch says so itself).
 * REALITY = the claimed surface, cut to the intent's size-order when it would otherwise dominate.
 */
export function decisionCorpus(coord, turns, P, DOOR, { maxRatio = 20, massFloor = 220 } = {}) {
  // The floor is a PARAMETER, resolved by the caller from physics.mjs (the CLI does this). 220 is the
  // canonical submission mass floor — physics.mjs __internals__.MIN_GZIP_BYTES, and the same number
  // the shipped thetacog-mcp write-lock returns as min_gzip_bytes on a thin pair. It is NOT the
  // per-anchor snippet mass (743, CANONICAL_SENSOR.medianZ) and it is NOT the aperture band
  // ([0.25, 4], a property of the sensor library). Those three got conflated twice; see panel-door.mjs.
  const rule = String(coord.rule || '');
  // RECORDED EVIDENCE IS PREFERRED, NEVER EXCLUSIVE. The first version of this returned early when a
  // coordinate had ANY quote or steer, and four of the nine then stayed below the floor holding a
  // single short recorded line — provenance that is real and still not enough mass to read through.
  // Preferring recorded provenance is right; letting its mere presence block topping up is not.
  const recorded = [coord.quote, coord.steer].filter(Boolean);
  const evidence = recoverEvidence(rule, turns, P);

  // Add evidence a turn at a time and STOP at the floor — never take more mass than the reading needs.
  const parts = [rule, ...recorded];
  let intent = parts.join('\n\n');
  const used = [];
  for (const t of evidence) {
    if (DOOR.admissibility(intent, intent, { massFloor }).intentGzip >= massFloor) break;
    parts.push(String(t.text));
    used.push(t);
    intent = parts.join('\n\n');
  }
  const kind = recorded.length && used.length ? 'RECORDED+RECOVERED' : recorded.length ? 'RECORDED' : used.length ? 'RECOVERED' : 'NONE';
  const provenance = {
    kind,
    note: kind === 'RECORDED'
      ? 'the coordinate carried its own quote/steer, and that alone cleared the floor'
      : kind === 'NONE'
        ? 'nothing was recorded and no turn matched — this decision has no traceable origin'
        : 'turns marked RECOVERED are what the matched-aperture sensor believes the rule was drawn from, not what anyone wrote down; a recovered link is a measurement, not a record',
    recordedChars: recorded.join('\n\n').length,
    turns: used.map((t) => ({ index: t.index, role: t.role, side: t.side, score: t.score, chars: String(t.text).length, origin: 'RECOVERED' })),
  };

  const surfaceFile = coord.target_surface || (coord.owns || []).find((o) => o.kind === 'code')?.file || null;
  const surf = readSurface(surfaceFile);
  let reality = surf.text;
  let cut = null;
  if (reality && intent && reality.length > intent.length * maxRatio) {
    // CUT THE EYE. Keep the window of the surface that actually answers this rule, not the head of
    // the file — the head of a file in this repo is a comment block, and every file would look alike.
    const window = Math.max(intent.length, Math.floor(intent.length * maxRatio));
    const m = P.match(intent.slice(0, window), reality);
    reality = reality.slice(m.at, m.at + window);
    cut = { at: m.at, windows: m.windows, window };
  }

  return {
    id: coord.id, rule, surfaceFile,
    intent, reality,
    provenance, cut,
    surfaceReason: surf.reason,
    admissibility: DOOR.admissibility(intent, reality, { massFloor }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const only = arg('--id', null);
  const doRender = process.argv.includes('--render');

  const P = await import(resolve(HERE, 'physics.mjs'));
  const DOOR = await import(resolve(REPO, 'scripts/pmu/panel-door.mjs'));
  const { liveCoordinates } = await import(resolve(HERE, 'coordinates.mjs'));

  const massFloor = await DOOR.canonicalMassFloor();
  const turns = loadTurns(slug);
  const coords = liveCoordinates(slug).filter((c) => c.rule && (!only || c.id === only));
  if (!coords.length) { console.error(`  nothing to build in "${slug}"`); process.exit(2); }

  console.log(`\n  DECISION CORPUS · ${slug} · ${turns.length} turns available as evidence · mass floor ${massFloor} (physics.mjs)\n`);
  let before = 0, after = 0;
  const out = [];
  for (const c of coords) {
    const b = DOOR.admissibility(c.rule, readSurface(c.target_surface || (c.owns || []).find((o) => o.kind === 'code')?.file).text, { massFloor });
    const d = decisionCorpus(c, turns, P, DOOR, { massFloor });
    if (b.admissible) before++;
    if (d.admissibility.admissible) after++;
    out.push(d);
    console.log(`  ${c.id}  rule-only ${b.admissible ? 'ADMISSIBLE' : `inadmissible (intent gzip ${b.intentGzip})`}  →  with evidence ${d.admissibility.admissible ? `ADMISSIBLE (intent gzip ${d.admissibility.intentGzip}, ratio ${d.admissibility.ratio}x)` : `STILL NOT (${d.admissibility.notAdmissible})`}`);
    console.log(`     ${d.provenance.kind} · ${d.provenance.turns.length} turn(s)${d.provenance.turns.length ? ` [${d.provenance.turns.map((t) => `#${t.index} ${t.side || t.role} ncd ${t.score}`).join(', ')}]` : ''}`);
    if (d.surfaceReason) console.log(`     ⚠ ${d.surfaceReason}`);

    if (doRender && d.admissibility.admissible) {
      const r = await DOOR.panel({ intent: d.intent, reality: d.reality, message: d.rule, label: c.id, sub: d.surfaceFile || '' });
      if (r.png) {
        const dir = resolve(SESSIONS, slug, 'html', 'receipts');
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `${c.id}.png`), r.png);
        const lit = (r.meta.green || 0) + (r.meta.amber || 0) + (r.meta.red || 0);
        console.log(`     → rendered · lit ${lit}/20736 (${(lit / 207.36).toFixed(1)}%) · off ${r.meta.offPct}% · admissible ${r.meta.admissible}`);
      } else {
        console.log(`     → NOT rendered — ${r.unmeasured}`);
      }
    }
  }
  console.log(`\n  ${before}/${coords.length} admissible on the rule alone → ${after}/${coords.length} with the evidence corpus\n`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(out.map((o) => ({ ...o, intent: o.intent.length, reality: o.reality.length })), null, 2));
}
