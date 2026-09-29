#!/usr/bin/env node
// scripts/vna/goal-validate.mjs — C81c THE GOAL INGEST GATE (goal 8 unit 4, 2026-09-18). A /goal pasted from an external
// model passes here before anything touches data/vna/goal.json. The paste that made this necessary named surfaces the repo
// does not have (sync-notary.mjs, flight-tape.lock, an "MMR root"), re-asked work already closed, and tied no unit to a
// spec row — so goal.mjs could not have derived closure from the ticks. The operator's two questions, "is it a ratchetable
// goal?" and "tied to spec?", are what this file answers mechanically. LLM-FREE: the tree, the disk and a grammar.
//
// validate(md, { tree, repo }) → { ok, errors: [{ line, rule, msg }], units, invariants, turns, setLine, llm: false }
//   NO_INVARIANTS     no "## Invariants…" heading with at least one bullet under it
//   NO_UNITS          no "### Unit n:" heading at all            TOO_MANY_UNITS  more than MAX_UNITS (8)
//   TURN_BOUND        no turn bound, or max > MAX_TURNS (16)     NO_LABEL        a unit heading names no C-row label
//   NOT_A_BASIN       the label is not n_spec_<label> in the tree · BASIN_CLOSED   the row is ticked (nothing to close)
//   BASIN_RETRACTED   the basin carries the --retract mark        PROOF           its inclusion proof does not recompute
//   NO_GUARD          the unit has no "guard:" bullet with a path  FILE_NOT_ON_DISK a scripts/ src/ packages/ hooks/ path the
//                     unit names that is not on disk and not named by the row it binds to (a guard path is exempt — it is
//                     the red witness; .thetacog/ runtime files are never checked)
// The set line compiles only from an accepted paste; goal.mjs `import --validate` prints it and --install runs it.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proof, verifyProof, TREE } from './spec-tree.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const MAX_UNITS = 8, MAX_TURNS = 16;
export const RULES = {
  NO_INVARIANTS: 'an Invariants block with at least one bullet', NO_UNITS: 'at least one "### Unit n:" heading', TOO_MANY_UNITS: `at most ${MAX_UNITS} units`,
  TURN_BOUND: `a turn bound (--turns a-b, "turns a–b" or "a–b turns") with max ≤ ${MAX_TURNS}`, NO_LABEL: 'every unit heading names a spec row label (C12, C12a)',
  NOT_A_BASIN: 'the label is a basin in the tree (n_spec_<label>)', BASIN_CLOSED: 'the row is open (unticked)', BASIN_RETRACTED: 'the basin is not retracted',
  PROOF: 'the basin\'s inclusion proof recomputes to the root', NO_GUARD: 'every unit has a guard: bullet with a path', FILE_NOT_ON_DISK: 'every scripts/ src/ packages/ hooks/ path a unit names is on disk or declared by its row',
};
const LABEL_RE = /\bC\d{1,3}[a-z]?\b/g;
const PATH_RE = /`((?:scripts|src|packages|hooks)\/[^`\s]+\.[a-z]{1,5})`/g;

/** parse the paste into title · invariants · units (heading line, labels, guard, paths) · turn bound */
export function parse(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = { title: null, quote: null, invariants: [], units: [], turns: null, turnsLine: null };
  let section = null, unit = null;
  lines.forEach((raw, i) => {
    const line = raw.trimEnd(), n = i + 1;
    if (!out.title && /^#\s/.test(line)) out.title = line.replace(/^#\s+/, '');
    if (!out.quote && !section && /^>\s*\S/.test(line)) out.quote = line.replace(/^>\s*/, '');   // the C77 shape carries the goal text as a blockquote under the title
    const h2 = /^##\s+(.*)$/.exec(line); if (h2) { section = /invariant/i.test(h2[1]) ? 'invariants' : /unit/i.test(h2[1]) ? 'units' : h2[1].toLowerCase(); unit = null; return; }
    const h3 = /^###\s+Unit\s+(\d+)\s*[:.]\s*(.*)$/i.exec(line);
    if (h3) { unit = { n: Number(h3[1]), line: n, heading: h3[2].trim(), labels: [...new Set((h3[2].match(LABEL_RE) || []))], guard: null, guardLine: null, paths: [], body: [] }; out.units.push(unit); return; }
    if (section === 'invariants' && /^\s*[-*]\s+\S/.test(line)) out.invariants.push({ line: n, text: line.replace(/^\s*[-*]\s+/, '') });
    if (unit) {
      unit.body.push(line);
      const g = /^\s*[-*]\s+guard\s*:\s*`([^`]+)`/i.exec(line); if (g && !unit.guard) { unit.guard = g[1]; unit.guardLine = n; }
      for (const m of line.matchAll(PATH_RE)) unit.paths.push({ line: n, path: m[1] });
    }
    // a BOUND is a-b next to the word turns (--turns 5-10 · turns 5–10 · in 5–10 turns); a sentence ABOUT bounds ("the turn bound N ≤ 16") is not one
    const t = /--turns\s+(\d+)\s*-\s*(\d+)/.exec(line) || /\bturns?\s+(\d+)\s*[–-]\s*(\d+)\b/i.exec(line) || /\b(\d+)\s*[–-]\s*(\d+)\s+turns?\b/i.exec(line);
    if (t && !out.turns) { const a = Number(t[1]), b = Number(t[2]); out.turns = { min: Math.min(a, b), max: Math.max(a, b) }; out.turnsLine = n; }
  });
  return out;
}

export function validate(md, { tree = null, repo = REPO, treePath = TREE } = {}) {
  const t = tree || JSON.parse(readFileSync(treePath, 'utf8'));
  const p = parse(md); const errors = []; const err = (line, rule, msg) => errors.push({ line, rule, msg });
  if (!p.invariants.length) err(1, 'NO_INVARIANTS', 'no "## Invariants" block with a bullet under it — the paste declares nothing it must not break');
  if (!p.units.length) err(1, 'NO_UNITS', 'no "### Unit n:" heading — nothing to work');
  if (p.units.length > MAX_UNITS) err(p.units[MAX_UNITS].line, 'TOO_MANY_UNITS', `${p.units.length} units — at most ${MAX_UNITS}; the ${MAX_UNITS + 1}th starts here`);
  if (!p.turns) err(1, 'TURN_BOUND', `no turn bound — say --turns a-b (max ≤ ${MAX_TURNS}); a goal with no bound never reports`);
  else if (p.turns.max > MAX_TURNS) err(p.turnsLine, 'TURN_BOUND', `turn bound ${p.turns.min}–${p.turns.max} — max ${p.turns.max} exceeds ${MAX_TURNS}`);
  for (const u of p.units) {
    if (!u.labels.length) err(u.line, 'NO_LABEL', `unit ${u.n} "${u.heading}" names no spec row — a unit is tied to a C-label, never to a file name`);
    const rowText = [];
    for (const l of u.labels) {
      const n = t.nodes && t.nodes[`n_spec_${l}`];
      if (!n) { err(u.line, 'NOT_A_BASIN', `unit ${u.n}: ${l} is not a basin in the tree — declare the row in the spec and fold before it can be a unit`); continue; }
      rowText.push(String((n.content && n.content.text) || ''));
      if (n.retracted) err(u.line, 'BASIN_RETRACTED', `unit ${u.n}: ${l} is retracted (${(n.retracted && n.retracted.why) || 'no why'})`);
      if (n.meta && n.meta.done === true) err(u.line, 'BASIN_CLOSED', `unit ${u.n}: ${l} is already ticked — nothing left for a unit to close`);
      try { const pr = proof(t, n.id); if (!pr || verifyProof(pr) !== t.root) err(u.line, 'PROOF', `unit ${u.n}: the inclusion proof for ${l} does not recompute to the root`); } catch (e) { err(u.line, 'PROOF', `unit ${u.n}: no proof for ${l} — ${e.message}`); }
    }
    if (!u.guard) err(u.line, 'NO_GUARD', `unit ${u.n} has no "- guard: \`path\`" bullet — no red witness, not done`);
    const declared = rowText.join('\n');
    for (const { line, path } of u.paths) {
      if (path === u.guard || /\.test\.mjs$/.test(path)) continue;
      if (!existsSync(resolve(repo, path)) && !declared.includes(path)) err(line, 'FILE_NOT_ON_DISK', `unit ${u.n} names \`${path}\` — not on disk and not declared by ${u.labels.join(' ') || 'any row'}; a name the repo does not have is a rejection, never a silent pass`);
    }
  }
  const ok = errors.length === 0;
  const text = (p.quote || p.title || 'goal').replace(/^\/goal\s*[:—-]?\s*/i, '').replace(/^\/goal\b/i, '').trim();
  const units = p.units.map((u) => ({ n: u.n, labels: u.labels, title: u.heading.replace(/^C\d{1,3}[a-z]?\s*[—:-]\s*/, '').replace(/\s*\(`[^`]*`\)\s*$/, '').trim(), guard: u.guard, line: u.line }));
  const setLine = ok ? `node scripts/vna/goal.mjs set --text ${JSON.stringify(text)} ${units.map((u) => `--unit "${u.labels.join(' ')}::${u.title.replace(/"/g, '\'')}"`).join(' ')} --turns ${p.turns.min}-${p.turns.max}` : null;
  return { ok, llm: false, errors, units, invariants: p.invariants, turns: p.turns, title: p.title, text, setLine };
}

export function report(v) {
  if (v.ok) return `ACCEPTED · ${v.units.length} units · turns ${v.turns.min}–${v.turns.max} · ${v.units.map((u) => u.labels.join(' ')).join(' · ')}\n${v.setLine}`;
  return `REJECTED · ${v.errors.length} error${v.errors.length === 1 ? '' : 's'} · ${v.units.length} unit${v.units.length === 1 ? '' : 's'} read\n${v.errors.map((e) => `  L${e.line} ${e.rule} — ${e.msg}`).join('\n')}\nrules: ${[...new Set(v.errors.map((e) => e.rule))].map((r) => `${r} = ${RULES[r]}`).join(' · ')}`;
}
