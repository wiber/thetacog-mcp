// packages/thetacog-mcp/scripts/tape/project-panel.mjs — THE PANEL AIMED AT SOMETHING THAT MATTERS.
//
// Operator, 2026-08-20:
//   "The encircled panel should be used everywhere as it already works effectively and we've tested a
//    million different ways. The only question is how do we wire it up? How do we give the process
//    the right context? How do we make sure it's actually aimed at the intent/reality delta of
//    SOMETHING THAT MATTERS — like whether you're closing in on the coordinates of a project."
//
// ── THE PAIR I HAD WRONG ──────────────────────────────────────────────────────────────────────
// Every panel rendered so far was QUOTE vs RULE — one atom against its own extraction. Both sides
// come from the same text, so it is a self-report: the same defect as measuring a commit message
// against its own diff, which momentum.mjs already refuses to average into anything. It answers
// "did the extractor paraphrase faithfully", which is a fidelity check, not a project reading.
//
// ── THE PAIR THAT MATTERS ─────────────────────────────────────────────────────────────────────
//   INTENT  = the accumulated LOCKED COORDINATES — everything the operator has decided this project
//             IS. Authored by a human, before the work, one decision at a time.
//   REALITY = the repo as it now stands, read from the surfaces those coordinates claim to own.
//
// Independent authorship on each side. That is the whole difference between a receipt and testimony,
// and it is the only pairing that answers the question actually being asked: ARE WE CLOSING IN ON
// THE COORDINATES OF THIS PROJECT, or is the built thing wandering away from the decided thing?
//
// The off-lane regions in this panel are not "bad code". They are the parts of the repo doing work
// that no locked coordinate accounts for — which is either scope the operator has not yet decided,
// or drift. The panel cannot tell those apart and does not pretend to; it shows WHERE, and the
// operator reads WHY. Rice forbids the other thing.
//
// ── HOW IT GETS THE RIGHT CONTEXT ─────────────────────────────────────────────────────────────
// Not "the whole repo" — that is unbounded and would place at the collapse magnet. The reality side
// is assembled from the files the coordinates THEMSELVES name via owns[], discovered deterministically
// by git grep at lock time. So the panel reads exactly the surface the project claims, and a file no
// coordinate owns is correctly absent: if nothing you decided points at it, it is not yet part of
// what you said you were building.
//
//   node packages/thetacog-mcp/scripts/tape/project-panel.mjs [--slug s] [--out <png>] [--json]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

// Reality is read as SEMANTIC text, not raw source — comments and identifier words, HTML stripped.
// The house rule (PMU DOGFOOD #4): the reality corpus is ~81% code-as-claim and SimHash grips it
// poorly; the walk wants meaning, not punctuation.
function semanticOf(path, { maxChars = 6000 } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  const lines = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // comments carry the intent of the code; identifiers carry its nouns
    const comment = t.match(/^(?:\/\/|#|\*|\/\*)\s?(.*)$/);
    if (comment && comment[1].length > 12) { lines.push(comment[1]); continue; }
    const idents = t.match(/[A-Za-z][A-Za-z0-9_]{4,}/g);
    if (idents && idents.length >= 2) lines.push(idents.join(' '));
  }
  return lines.join('\n').slice(0, maxChars);
}

export function assembleSides(slug, { perFileChars = 6000, maxFiles = 24 } = {}) {
  const dir = resolve(SESSIONS, slug);
  const led = resolve(dir, 'coordinates.ndjson');
  if (!existsSync(led)) return { ok: false, reason: `no coordinates ledger for '${slug}' — nothing has been decided yet, so there is no intent to measure against` };

  const order = [], latest = new Map();
  for (const l of readFileSync(led, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (!r?.id) continue;
    if (!latest.has(r.id)) order.push(r.id);
    latest.set(r.id, r);
  }
  const coords = order.map((id) => latest.get(id)).filter((c) => c && c.status !== 'retired');
  if (!coords.length) return { ok: false, reason: 'the ledger exists but holds no live coordinate' };

  // INTENT — every locked rule, in lock order. This IS the spec.
  const intentText = coords.map((c) => c.rule).join('\n');

  // REALITY — the surfaces those coordinates claim, deduped, code first, semantic-extracted.
  const claimed = new Map();
  for (const c of coords) {
    for (const o of (c.owns || [])) {
      if (o.kind !== 'code') continue;
      const abs = resolve(REPO, o.file);
      if (!existsSync(abs)) continue;
      const prev = claimed.get(o.file);
      claimed.set(o.file, { file: o.file, abs, score: (prev?.score || 0) + (o.score || 1), byCoords: [...(prev?.byCoords || []), c.id] });
    }
  }
  const files = [...claimed.values()].sort((a, b) => b.score - a.score).slice(0, maxFiles);
  const parts = [], used = [];
  for (const f of files) {
    const sem = semanticOf(f.abs, { maxChars: perFileChars });
    if (!sem || sem.length < 120) { used.push({ ...f, included: false, reason: 'no semantic mass after extraction' }); continue; }
    parts.push(sem);
    used.push({ ...f, included: true, chars: sem.length });
  }
  const realityText = parts.join('\n');

  return {
    ok: true, coords, intentText, realityText,
    files: used,
    intentChars: intentText.length, realityChars: realityText.length,
    unmeasured: realityText.length < 220 ? 'the claimed surface has no semantic mass — reality side is UNMEASURED, not zero' : null,
  };
}

export async function projectPanel(slug, { out = null } = {}) {
  const s = assembleSides(slug);
  if (!s.ok) return s;
  if (s.unmeasured) return { ok: false, reason: s.unmeasured, ...s };

  // THE ONE DOOR. Never composeEncircledPanel directly, never the tesseract wrapper.
  const { panel } = await import(resolve(REPO, 'scripts/pmu/panel-door.mjs'));
  const p = await panel({
    intent: s.intentText,
    reality: s.realityText,
    message: s.intentText,          // the operator's own locked rules, sliced into the rings
    label: 'project',
    sub: `${s.coords.length} locked coordinates vs ${s.files.filter((f) => f.included).length} claimed surfaces`,
  });
  if (!p?.png) return { ok: false, reason: p?.unmeasured || 'renderer returned no png', ...s };

  const dest = out || resolve(SESSIONS, slug, 'html', 'receipts', 'PROJECT.png');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, p.png);
  return { ok: true, png: dest, meta: p.meta, regions: p.regions, ...s };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // ── STDOUT MUST BE BLOCKING BEFORE ANY process.exit() ───────────────────────────────────────
  // MEASURED twice, by two agents, on two different files: a JSON payload piped through execFile()
  // is silently CUT at ~8,188 bytes when the process exits right after logging it. exit() tears the
  // process down before the pipe drains, so the reader gets a PREFIX — and a prefix of valid JSON is
  // invalid JSON, surfacing in the caller as "Unterminated string in JSON at position 8180" with no
  // hint that truncation happened. It is invisible under 8KB, so it ships green and only bites once a
  // session grows.
  //
  // Making stdout blocking is the fix that preserves control flow. Dropping the exit() instead lets
  // the CLI fall through and print its human output after the JSON, which corrupts the payload a
  // different way — tried that first, and the parser said so immediately.
  try { if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true); } catch { /* not a pipe */ }
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const slug = arg('--slug', 'gddadwill');
  const r = await projectPanel(slug, { out: arg('--out', null) });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 2); }
  if (!r.ok) { console.error('✗ ' + r.reason); process.exit(2); }
  const m = r.meta || {};
  console.log(`\n  THE PROJECT PANEL · ${slug}`);
  console.log(`  INTENT  = ${r.coords.length} locked coordinates (${r.intentChars} chars) — what you decided this project IS`);
  console.log(`  REALITY = ${r.files.filter((f) => f.included).length} claimed surfaces (${r.realityChars} chars) — the repo as it stands\n`);
  console.log(`  offPct ${m.offPct ?? 'UNMEASURED'} · green ${m.green ?? '—'} · amber ${m.amber ?? '—'} · red ${m.red ?? '—'}${m.tooMany ? '  (tooMany — aggregate flip)' : ''}`);
  if (m.region) console.log(`  shape: motif ${m.region.motif} · axis ${m.region.axis} · blast ${m.region.blastRadius} · ruling ${m.region.ruling || '—'}`);
  console.log(`\n  the surfaces this project claims:`);
  for (const f of r.files.slice(0, 10)) {
    console.log(`    ${f.included ? '✓' : '·'} ${String(f.file).slice(-58).padEnd(58)} ${f.included ? `${f.chars}ch` : f.reason}  ← ${f.byCoords.join(',')}`);
  }
  console.log(`\n  panel: ${r.png}`);
  console.log(`  READ IT AS: off-lane regions are repo mass that NO locked coordinate accounts for —`);
  console.log(`  either scope you have not decided yet, or drift. The panel shows WHERE; you read WHY.\n`);
}
