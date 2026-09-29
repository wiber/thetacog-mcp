// scripts/pmu/name-the-pile.mjs — NAME the entities in the retrieval pile (operator 2026-08-06:
// "we sqlite / tesseract retrieve rules and roles (hats) from a pile magnetized by the slice through
// the tesseract … so we name the hats and rules we have — the rule has a name and the text content
// of the rule and the hat role as well").
// ============================================================================================
// THE PILE, confirmed by reading the running code (not invented):
//   • CORE rules — data/pmu/lens-reef.json domains[].rules[] (curated, pinned to a coord), re-sorted
//     per prompt by IDF-density against the intent (prompt-lens.mjs retrieveRules).
//   • PERIMETER rules — SQLite .thetacog/transcripts.db `lens_rules(coord, br, bc, rule, weight, src)`,
//     fetched WHERE the block falls inside the walk's Chebyshev fence, ORDER BY squared distance to
//     the placed block — the pile literally magnetized by the slice through the tesseract.
//   • HATS — data/pmu/snippet-library-144.json: 144 {coord,row,col,snippet} payload bodies, injected
//     as COORDINATE MASS when the slice lands on their cell.
// Each entity has a PAYLOAD BODY but no NAME. This migration stamps names ON the stored entities —
// additive, idempotent, deterministic, LLM-free — so every surface can say WHICH rule and WHICH hat,
// not just counts. Placement stays n-dimensional: every named entity keeps its tesseract coord.
//   • reef domains gain rule_names { <rule-text ≤60ch key> : <name> }  (same key convention as
//     derived_statements, so the two sidecars ride the same lookup)
//   • snippet-library entries gain hat (the worn role, from the canonical hat map)
//   • lens_rules gains a name column, backfilled
// Re-run after curating new rules: node scripts/pmu/name-the-pile.mjs --apply
// @guard tests/pmu-simulator/name-the-pile.test.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hatName } from './shortlex-names.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REEF_PATH = resolve(REPO, 'data/pmu/lens-reef.json');
const HATS_PATH = resolve(REPO, 'data/pmu/snippet-library-144.json');
const DB_PATH = process.env.LENS_DB || resolve(REPO, '.thetacog/transcripts.db');

// words too common to carry a rule's identity — deliberately SMALL: never/always/block are load-bearing
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'for', 'and', 'or', 'with', 'on', 'be', 'it', 'its', 'this', 'that', 'from', 'as', 'at', 'by']);

const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s=<>%-]/g, ' ').split(/\s+/)
  .filter((w) => w && w.length > 1 && !STOP.has(w));

// deterministic rule NAME from its text: first clause, 3–5 identity-bearing words, kebab. A clause
// that is just a label ("voice:") spills into the body until ≥3 words — audit 2026-08-06 found 20
// one-word degenerates («voice» ×17) when the namer stopped at the first colon. Same text → same
// name, forever — the name is a handle, the text stays the payload body.
export function ruleName(text, wordCount = 5) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const clause = t.split(/\s+—\s+|\s+·\s+|(?<=\S)[:;.](?=\s|$)|\(/)[0] || t;
  let words = toks(clause).slice(0, wordCount);
  if (words.length < 3) {                       // label-only clause → take identity from the whole text
    const rest = toks(t);
    for (const w of rest) { if (!words.includes(w)) words.push(w); if (words.length >= wordCount) break; }
  }
  return words.join('-') || t.toLowerCase().slice(0, 24).trim().replace(/\s+/g, '-');
}

// the COLLISION-FREE namer for a whole run: identical text shares its name everywhere (the same rule
// living in two lanes is coherence, not collision); different text that generates the same handle
// extends word-by-word (6,7,8…) until unique, then a positional suffix as the deterministic last
// resort. Stable iteration order in nameThePile ⇒ same pile, same names, every run.
export function makeNamer() {
  const byText = new Map(), taken = new Map();   // text → name · name → first text
  return (text) => {
    const t = String(text || '');
    if (byText.has(t)) return byText.get(t);
    let name = ruleName(t);
    for (let k = 6; taken.has(name) && taken.get(name) !== t && k <= 9; k++) name = ruleName(t, k);
    if (taken.has(name) && taken.get(name) !== t) name = `${name}-${byText.size}`;
    byText.set(t, name); if (!taken.has(name)) taken.set(name, t);
    return name;
  };
}

const ruleKey = (r) => String(typeof r === 'string' ? r : (r && (r.rule || r.text)) || '').slice(0, 60);

export function nameThePile({ apply = false } = {}) {
  const report = { reefDomains: 0, reefRulesNamed: 0, standingNamed: 0, hatsNamed: 0, sqliteNamed: 0, applied: apply };
  const nameFor = makeNamer();   // ONE namer across reef + standing + sqlite: identical text = identical name everywhere

  // 1) REEF — rule_names sidecar per domain, keyed like derived_statements (text ≤60ch)
  const reef = JSON.parse(readFileSync(REEF_PATH, 'utf8'));
  for (const d of reef.domains || []) {
    if (!Array.isArray(d.rules) || !d.rules.length) continue;
    d.rule_names = {};
    for (const r of d.rules) {
      const k = ruleKey(r);
      if (k) { d.rule_names[k] = nameFor(typeof r === 'string' ? r : (r.rule || r.text)); report.reefRulesNamed++; }
    }
    report.reefDomains++;
  }
  if (Array.isArray(reef.standing) && reef.standing.length) {
    reef.standing_names = {};
    for (const r of reef.standing) { const k = ruleKey(r); if (k) { reef.standing_names[k] = nameFor(r); report.standingNamed++; } }
  }

  // 2) HATS — the worn role stamped on each of the 144 payload bodies (coord stays the placement)
  const hats = JSON.parse(readFileSync(HATS_PATH, 'utf8'));
  for (const h of hats) { if (h && h.coord) { h.hat = hatName(h.coord); report.hatsNamed++; } }

  // 3) SQLITE — name column on the magnetized perimeter pile
  let sqlStatements = [];
  if (existsSync(DB_PATH)) {
    const cols = execFileSync('sqlite3', [DB_PATH, "PRAGMA table_info(lens_rules);"], { encoding: 'utf8' });
    if (!/\|name\|/.test(cols)) sqlStatements.push('ALTER TABLE lens_rules ADD COLUMN name TEXT;');
    const rows = JSON.parse(execFileSync('sqlite3', ['-json', DB_PATH, 'SELECT rowid, rule FROM lens_rules;'], { encoding: 'utf8' }).trim() || '[]');
    for (const row of rows) {
      const n = nameFor(row.rule).replace(/'/g, "''");
      sqlStatements.push(`UPDATE lens_rules SET name='${n}' WHERE rowid=${row.rowid};`);
      report.sqliteNamed++;
    }
  }

  if (apply) {
    writeFileSync(REEF_PATH, JSON.stringify(reef, null, 2));
    writeFileSync(HATS_PATH, JSON.stringify(hats, null, 2));
    if (sqlStatements.length) execFileSync('sqlite3', [DB_PATH], { input: sqlStatements.join('\n'), encoding: 'utf8' });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes('--apply');
  const r = nameThePile({ apply });
  console.log(`${apply ? 'APPLIED' : 'DRY-RUN (pass --apply to write)'} — reef: ${r.reefRulesNamed} rules named across ${r.reefDomains} domains (+${r.standingNamed} standing) · hats: ${r.hatsNamed}/144 · sqlite: ${r.sqliteNamed} rows`);
}
