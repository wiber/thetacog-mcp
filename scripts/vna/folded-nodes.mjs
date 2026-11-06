// scripts/vna/folded-nodes.mjs — C1175: THREE MORE NODE KINDS FOR THE SNOWBALL, EACH CARRYING ITS ORIGIN.
// Operator /tend 2026-10-21 (dictated, chair-decomposed): "Tie the wheels and hats to the sheets as well so that
// we can look at the local files and get all the context … part of the snowball retro walk". The snowball
// (retro-snowball.mjs, C582) grows only over spec-tree CONTRACT rows, so a turn about a Mailbox ticket never
// pulls that ticket's own sheet row, the rules that govern it, or the hat that reads it. This file builds those
// three kinds as ROWS SHAPED LIKE A CONTRACT ROW ({id, text, cells, origin}) so retro-snowball.mjs can grow over
// them unchanged — rowsOf()'s shape, never a parallel structure.
//
// EACH NODE CARRIES ITS ORIGIN so a worker can open the thing itself, not just read the folded text:
//   sheet  { kind: 'sheet', sheet, row }       — one row of one board sheet's local copy (board-generated.json)
//   rule   { kind: 'rule', sheet, code }        — a sheet's own Rules tab line (S1–S5 or a numbered rule)
//   rule   { kind: 'rule', file, section }      — a section of a docs/architecture/claude-rules/*.md file
//   hat    { kind: 'hat', axis, role }          — one of the 12 canonical hat role-nouns (shortlex-names.mjs)
//
// WALKED ONCE, OFFLINE, LIKE A CONTRACT ROW: foldNodes() calls the injected walk() exactly once per node and
// stores the cells beside the text — the same contract rowsOf() rows carry (n.walk.cells), never re-walked
// per turn. Production wires the real walk (lensWalk, src/lib/pmu/walk-door.mjs); the guard passes a fixture.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── SHEET ROWS: group a sheet's flat "<row>\u0000<COLUMN>" map (board-generated.json's own shape, C1035
// derivedCells()) back into one row of text per row id. A column with no text is dropped, never padded. ──
export function sheetRowsOf(sheetData, sheetName) {
  const bySheet = sheetData || {};
  const byRow = new Map();
  for (const [key, val] of Object.entries(bySheet)) {
    const i = key.indexOf('\u0000'); if (i < 0) continue;
    const row = key.slice(0, i), col = key.slice(i + 1);
    const v = String(val ?? '').trim(); if (!v) continue;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(`${col}: ${v}`);
  }
  return [...byRow.entries()].map(([row, parts]) => ({
    id: `sheet:${sheetName}:${row}`,
    text: parts.join(' · '),
    origin: { kind: 'sheet', sheet: sheetName, row },
  }));
}

// ── RULE: a sheet's own Rules tab, from its one source (sheet-tabs.mjs rulesRows — S1–S5 + numbered rules),
// never retyped. Each line (S1..S5, N1..) is its own node, so a turn can carry just the line it needs. ──
export async function sheetRuleNodes(sheetName, opts = {}) {
  const { rulesRows } = await import('../ops/sheet-tabs.mjs');
  const rows = rulesRows(sheetName, opts).slice(1);   // drop the header row (RULE / HOW THIS SHEET WORKS / YOUR NOTE)
  return rows.map(([code, text]) => ({
    id: `rule:${sheetName}:${code}`,
    text: String(text || ''),
    origin: { kind: 'rule', sheet: sheetName, code },
  }));
}

// ── RULE: one node per section of a claude-rules file (## or ### headings), origin names the file + heading
// so a worker opens the exact section, never the whole doc. ──
export function ruleSectionsOf(filePath, { repo = REPO } = {}) {
  const abs = resolve(repo, filePath);
  let text; try { text = readFileSync(abs, 'utf8'); } catch { return []; }
  const lines = text.split('\n');
  const sections = []; let cur = null;
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.+)$/);
    if (m) { if (cur) sections.push(cur); cur = { heading: m[2].trim(), body: [] }; continue; }
    if (cur) cur.body.push(line);
  }
  if (cur) sections.push(cur);
  return sections.filter((s) => s.body.join(' ').trim()).map((s) => ({
    id: `rule:${filePath}:${s.heading}`,
    text: `${s.heading}\n${s.body.join('\n')}`.trim(),
    origin: { kind: 'rule', file: filePath, section: s.heading },
  }));
}

// ── HAT: the 12 canonical, fixed, LLM-free hat role-nouns (shortlex-names.mjs HATS) — one node per axis. ──
export async function hatTemplateNodes() {
  const { HATS } = await import('../pmu/shortlex-names.mjs');
  return Object.entries(HATS.roles).map(([axis, role]) => ({
    id: `hat:${axis}`,
    text: `${role} wears the ${axis} hat — the role an actor at this axis plays`,
    origin: { kind: 'hat', axis, role },
  }));
}

// a node's origin is COMPLETE when it names enough for a worker to open the thing it came from — the
// mechanical half of "the carry names each node's origin": a kind with a hole never reaches the bundle.
export function originComplete(origin) {
  if (!origin || !origin.kind) return false;
  if (origin.kind === 'sheet') return !!(origin.sheet && origin.row);
  if (origin.kind === 'rule') return !!((origin.sheet && origin.code) || (origin.file && origin.section));
  if (origin.kind === 'hat') return !!(origin.axis && origin.role);
  if (origin.kind === 'contract') return !!origin.node;
  return false;
}

// ── THE MEASURED SWITCH, C582's sibling for the three new kinds: "keep them live only if the answering row
// still ranks no worse on both folds". ncd-only (gzip, LLM-free) — ranking the TRUTH row's text-distance
// position among candidates is what seedSpecFirst/growRead's 'ncd' order already uses, so this reuses the
// same question the live switch answers, never a new metric invented for this check. ──
const median = (xs) => { const a = xs.filter(Number.isFinite).slice().sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export function rankOfTruth(askText, truthId, candidates, ncd) {
  const dTruth = ncd(askText, candidates.find((c) => c.id === truthId)?.text || '');
  let better = 0;
  for (const c of candidates) { if (c.id === truthId) continue; if (ncd(askText, c.text) < dTruth) better++; }
  return better + 1;
}
export function foldedRowsBench(asks, baseRows, extraRows, { ncd }) {
  const merged = [...baseRows, ...extraRows];
  const baseRanks = [], foldedRanks = [];
  for (const ask of asks) {
    if (!baseRows.some((r) => r.id === ask.truth)) continue;
    baseRanks.push(rankOfTruth(ask.text, ask.truth, baseRows, ncd));
    foldedRanks.push(rankOfTruth(ask.text, ask.truth, merged, ncd));
  }
  const baseMedian = median(baseRanks), foldedMedian = median(foldedRanks);
  return { n: baseRanks.length, baseMedian, foldedMedian, noWorse: foldedMedian != null && baseMedian != null && foldedMedian <= baseMedian };
}

// THE LOOP: walk every folded node ONCE with the injected walker (lensWalk in production, a fixture in the
// guard), drop any node whose origin came back incomplete BEFORE it is handed back — never pass a hole on.
export async function foldNodes({ walk, sheets = [], sheetRules = [], ruleFiles = [], includeHats = false } = {}) {
  const built = [];
  for (const { data, name } of sheets) built.push(...sheetRowsOf(data, name));
  for (const name of sheetRules) built.push(...await sheetRuleNodes(name));
  for (const f of ruleFiles) built.push(...ruleSectionsOf(f));
  if (includeHats) built.push(...await hatTemplateNodes());
  const kept = built.filter((n) => originComplete(n.origin));
  return kept.map((n) => {
    const w = walk(n.text) || {};
    return { ...n, pixel: w.pixel || null, cells: w.cells || [] };
  });
}
