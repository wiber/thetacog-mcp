#!/usr/bin/env node
// scripts/milestones/row-join.mjs — C307 THE FOREST AND THE TREES ON ONE PAGE.
//
// Operator 2026-09-25: "make a spec to keep the code in line with /milestones and viceversa so we
// can reason stepwise and holistically, see the forest and the trees at once."
//
// Two ledgers existed side by side and never met: /milestones (data/milestones.json — 75 items in
// 8 tracks, each scored by its own probes) and the steer spec (docs/specs/vna/SPEC-VNA-COCKPIT.md —
// the C-rows the code is built against). Only 3 row ids appeared anywhere on the board.
//
// ONE BINDING, ONE PLACE: a milestone item lists the rows that deliver it (`rows: ["C305b"]`).
// The reverse direction (row → milestone) is COMPUTED here and never typed, so the two can't drift.
//
//   FOREST  per track: items, how many are bound, and bound rows ticked/open (a count, not a grade)
//   TREES   per item: each row with its tick and whether its guard file is on disk
//   SLOGANS milestone items that no row delivers (milestone → code gap)
//   ORPHANS open rows that serve no milestone (code → milestone gap)
//   DANGLING a bound id the spec doesn't declare (a broken strand — the guard's zero)
//   SUGGEST a row whose guard file a milestone probe already checks: derived, never auto-bound
//
// Sufficient for: which rows move which milestone, and where either side has no partner.
// NOT sufficient for: whether a milestone is the right one, or whether a ticked row moved the market —
// the board's own `market` axis probes that, and this join never overrides it.
//
//   node scripts/milestones/row-join.mjs [--json] [--txt <path>] [--open]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MILESTONES = path.join(REPO, 'data', 'milestones.json');
export const SPEC = path.join(REPO, 'docs', 'specs', 'vna', 'SPEC-VNA-COCKPIT.md');
export const FLOOR = path.join(REPO, 'data', 'milestones-row-join-floor.json');
export const TXT = path.join(REPO, '.thetacog', 'milestones-row-join.txt');

/** every declared row: id → { ticked, guard, top } */
export function parseSpecRows(md) {
  const rows = new Map();
  for (const line of md.split('\n')) {
    const m = line.match(/^(\s*)- \[([ xX])\] (C\d+[a-z]*\d*(?:\.\d+)?)\b(.*)$/);
    if (!m) continue;
    const guard = (m[4].match(/guard:\s*`([^`]+)`/) || [])[1] || null;
    const cites = [...m[4].matchAll(/`([\w.\/-]+\/[\w.-]+\.\w+)`/g)].map((x) => x[1]).filter((c) => !c.includes('SPEC-VNA-COCKPIT'));
    rows.set(m[3], { ticked: m[2].toLowerCase() === 'x', guard, cites, top: m[1].length === 0 });
  }
  return rows;
}

/** the pure join — the guard drives it with fixtures */
export function join(milestones, specRows, { exists = () => false } = {}) {
  const items = milestones.items;
  const byRow = new Map(); // row → [item words]
  const dangling = [];
  const trees = items.map((it) => {
    const rows = (it.rows || []).map((id) => {
      const r = specRows.get(id);
      if (!r) { dangling.push({ item: it.words, row: id }); return { id, declared: false }; }
      (byRow.get(id) || byRow.set(id, []).get(id)).push(it.words);
      return { id, declared: true, ticked: r.ticked, guard: r.guard, guardOnDisk: r.guard ? exists(r.guard) : false };
    });
    return { track: it.track, phase: it.phase, words: it.words, rows };
  });

  const tracks = [...new Set(items.map((i) => i.track))];
  const forest = tracks.map((t) => {
    const ts = trees.filter((x) => x.track === t);
    const rs = ts.flatMap((x) => x.rows.filter((r) => r.declared));
    return { track: t, items: ts.length, bound: ts.filter((x) => x.rows.length).length, rowsTicked: rs.filter((r) => r.ticked).length, rowsOpen: rs.filter((r) => !r.ticked).length };
  });

  const slogans = trees.filter((x) => !x.rows.length).map((x) => x.words);
  const orphans = [...specRows].filter(([id, r]) => !r.ticked && !byRow.has(id)).map(([id]) => id);

  // SUGGEST: a milestone probe already checks a file the row names (its guard or a cited path) →
  // the pair is probably one strand. Derived for a human to confirm; binding stays in milestones.json.
  const suggest = [];
  const fileToRows = new Map();
  for (const [id, r] of specRows) for (const f of [r.guard, ...(r.cites || [])].filter(Boolean)) (fileToRows.get(f) || fileToRows.set(f, new Set()).get(f)).add(id);
  const checksOf = (it) => Object.values(it.evidence || {}).flat().map((p) => String(p.check || ''));
  // a HUB file (a shared ledger many rows cite or many milestones probe) names no pair: skip it
  const HUB = 3;
  const probedBy = new Map();
  for (const [f] of fileToRows) probedBy.set(f, items.filter((it) => checksOf(it).some((c) => c.includes(f))).length);
  for (const it of items) {
    const checks = checksOf(it);
    const seen = new Set();
    for (const c of checks) for (const [f, ids] of fileToRows) {
      if (!c.includes(f) || ids.size > HUB || probedBy.get(f) > HUB) continue;
      for (const id of ids) if (!seen.has(id) && !(it.rows || []).includes(id)) { seen.add(id); suggest.push({ item: it.words, row: id, via: f }); }
    }
  }
  return { forest, trees, slogans, orphans, dangling, suggest, rowToItems: Object.fromEntries(byRow) };
}

export function render(j) {
  const L = [];
  const pad = (s, n) => String(s).padEnd(n);
  L.push('MILESTONES ⇄ SPEC ROWS — the forest and the trees (C307)');
  L.push(`items ${j.trees.length} · bound ${j.trees.length - j.slogans.length} · slogans ${j.slogans.length} · open rows serving no milestone ${j.orphans.length} · dangling ${j.dangling.length}`);
  L.push('');
  L.push('FOREST — per track (counts, not grades)');
  for (const f of j.forest) L.push(`  ${pad(f.track, 11)} items ${pad(f.items, 3)} bound ${pad(f.bound, 3)} rows ✓ ${pad(f.rowsTicked, 3)} ☐ ${f.rowsOpen}`);
  L.push('');
  L.push('TREES — each bound item, its rows (✓ ticked · ☐ open · guard on disk ● / not written ○)');
  for (const t of j.trees.filter((x) => x.rows.length)) {
    L.push(`  ${t.phase} ${pad(t.track, 11)} ${t.words}`);
    for (const r of t.rows) L.push(r.declared ? `      ${r.ticked ? '✓' : '☐'} ${pad(r.id, 7)} ${r.guardOnDisk ? '●' : '○'} ${r.guard || '(no guard named)'}` : `      ✗ ${r.id} — NOT DECLARED in the spec`);
  }
  L.push('');
  L.push(`SLOGANS — milestones no row delivers (${j.slogans.length}): bind a row, or say it is a market act`);
  for (const s of j.slogans) L.push(`  · ${s}`);
  L.push('');
  L.push(`ORPHANS — open rows serving no milestone (${j.orphans.length}): name the milestone, or it is plumbing`);
  L.push('  ' + j.orphans.join(' '));
  if (j.suggest.length) {
    L.push('');
    L.push(`SUGGESTED — a milestone probe already checks a file the row names (${j.suggest.length}; derived, never auto-bound)`);
    for (const s of j.suggest) L.push(`  · ${s.item} ⇐ ${s.row}  via ${s.via}`);
  }
  if (j.dangling.length) {
    L.push('');
    L.push('DANGLING — bound but not declared');
    for (const d of j.dangling) L.push(`  ✗ ${d.item} → ${d.row}`);
  }
  return L.join('\n') + '\n';
}

export function run() {
  const ms = JSON.parse(fs.readFileSync(MILESTONES, 'utf8'));
  const rows = parseSpecRows(fs.readFileSync(SPEC, 'utf8'));
  return join(ms, rows, { exists: (p) => fs.existsSync(path.join(REPO, p)) });
}

// C307d — A NEW ROW NAMES ITS MILESTONE AT DECLARATION. Before this, a row was declared and only bound to a
// milestone (or left an orphan) whenever someone next ran the join above by hand — the pairing was made cold,
// long after the ask that motivated it. `nearestMilestone` is the best guess at declaration time: the milestone
// whose own `words` share the most ≥4-letter tokens with the fresh ask. It is a SUGGESTION, never a bind — the
// only place a row actually joins a milestone stays `rows` in data/milestones.json (join() above) — and it is
// NEVER floored: a floor here would go red on every dictation, before a human ever looked at the pairing.
export function nearestMilestone(ask, { items } = JSON.parse(fs.readFileSync(MILESTONES, 'utf8'))) {
  const tokens = (s) => (String(s).toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  const askWords = new Set(tokens(ask));
  if (!askWords.size) return null;
  let best = null;
  let bestScore = 0;
  for (const it of items) {
    const score = tokens(it.words).filter((w) => askWords.has(w)).length;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return best ? { track: best.track, words: best.words, score: bestScore } : null;
}

/** the one line steer.mjs prints per freshly declared row (never a follow-up bind, never a floor) */
export function nearestMilestoneLine(ask, opts) {
  const m = nearestMilestone(ask, opts);
  return m
    ? `⇢ nearest milestone: ${m.words} (${m.track}, shared words ${m.score}) — bind it in data/milestones.json \`rows\`, or say it is plumbing`
    : '⇢ nearest milestone: none scored — orphan until named, never floored';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const j = run();
  if (a.includes('--json')) { process.stdout.write(JSON.stringify(j, null, 1) + '\n'); process.exit(0); }
  const txt = render(j);
  const out = a.includes('--txt') ? path.resolve(a[a.indexOf('--txt') + 1]) : TXT;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, txt);
  process.stdout.write(txt.split('\n').slice(0, 14).join('\n') + `\n… full: ${path.relative(REPO, out)}\n`);
  if (a.includes('--open')) try { execFileSync('open', [out]); } catch { /* no GUI */ }
}
