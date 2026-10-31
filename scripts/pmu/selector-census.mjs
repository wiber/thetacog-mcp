#!/usr/bin/env node
// scripts/pmu/selector-census.mjs — THE SELF-ENUMERATING SENTINEL (spec §3 I3, 2026-07-20).
//
// I2 shipped a guard with a hardcoded list of two selectors. A list is a promise to remember, and
// the whole Self-Observation Law exists because components forget. This module DISCOVERS selectors
// structurally, so a new memoryless one turns the suite red WITHOUT anyone editing the sentinel.
//
// IT WORKED ON ITS FIRST RUN, which is the argument for it: the census immediately surfaced
// reef-crawl.mjs — a selector that picks corpus material into the reef and had no attempt history
// at all. Nobody had listed it, nobody remembered it, and it had been re-crawlable forever.
//
// WHAT MAKES SOMETHING A SELECTOR — two structural properties, both required:
//   (1) IT RANKS CANDIDATES  — a comparator sort. Ranking is the act the attempt history has to
//       reach; a script that merely reads material in order has no ranking to poison.
//   (2) IT COMMITS ITS PICKS — it WRITES candidate material into one of the two shared corpora
//       (the intake lens-c1-adjudication.json, or the reef lens-reef.json). Writing is what makes
//       a pick consequential; a script that computes a ranking and keeps it is nobody's problem.
//   Both, because either alone over-collects: lens-token-baseline.mjs sorts (a median, a file size)
//   without ever writing candidates, and harvest-agent.mjs writes the intake without ranking it.
//
// EXEMPTIONS LIVE AT THE SITE, NEVER IN A LIST HERE. A file that trips the heuristic but genuinely
// is not a selector declares `// NOT-A-SELECTOR: <reason>` in its own header. That keeps the reason
// next to the code it describes, and — the point — a NEW memoryless selector cannot inherit an
// exemption it never wrote. An allowlist inside this file would be the hardcoded list again,
// wearing a different hat.
//
// Usage: node scripts/pmu/selector-census.mjs [--json]

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const RANKS = /\.sort\(\s*\(/;                                     // a comparator sort = a ranking
// A commit is a write to one of the two shared corpora — via a raw writeFileSync/appendFileSync,
// OR via writeJSONAtomic (scripts/pmu/atomic-write.mjs, 2026-09-17): reef-demand.mjs and
// reef-miner.mjs both moved their adjudication write to the atomic helper the same day this
// truncation fix landed, which silently dropped them out of the census (their write site no
// longer matched a bare *FileSync call) — the exact token-vs-construct failure CLAUDE.md warns
// about, this time in the guard itself. Recognizing writeJSONAtomic keeps the construct (a commit
// to the corpus) the thing matched, not the specific function name that happens to do it today.
const COMMITS = /(?:write|append)FileSync\(\s*(?:INTAKE|ADJ|REEF|[^),]*(?:adjudication|lens-reef))|writeJSONAtomic\(\s*(?:INTAKE|ADJ|REEF|[^),]*(?:adjudication|lens-reef))/i;
const HAS_MEMORY = /from '\.\/burn-mass\.mjs'/;
const EXEMPT = /^\s*\/\/\s*NOT-A-SELECTOR:\s*(.+)$/m;
// KNOWN DEBT, declared AT THE SITE. Distinct from an exemption: a debt tag does not say "this is
// fine", it says "this is broken and recorded". It keeps the sentinel from crying wolf over a
// backlog it already knows about, while a NEW memoryless selector — which by construction has no
// tag — still turns the suite red. The count is ratcheted one-way in ratchet-floor.json, so the
// debt can only shrink; the tag must be deleted in the same commit that wires the selector.
const DEBT = /^\s*\/\/\s*@selector:\s*memoryless-debt\s*—\s*(.+)$/m;
// the census must never audit itself or the primitive it audits with
const SKIP = new Set(['selector-census.mjs', 'burn-mass.mjs']);

/** DISCOVER every selector in scripts/pmu, structurally. No list, no memory, no model. */
export function census(dir = resolve(REPO, 'scripts/pmu')) {
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
    if (SKIP.has(f)) continue;
    let src = '';
    try { src = readFileSync(resolve(dir, f), 'utf8'); } catch { continue; }
    if (!RANKS.test(src) || !COMMITS.test(src)) continue;
    const exempt = src.match(EXEMPT);
    const debt = src.match(DEBT);
    rows.push({
      file: `scripts/pmu/${f}`,
      exempt: exempt ? exempt[1].trim() : null,
      debt: debt ? debt[1].trim() : null,
      has_memory: HAS_MEMORY.test(src),
      // UPSTREAM, asserted as DATA FLOW rather than position. I2's guard compared source offsets,
      // which works only when the ranking site is the file's first sort — it is not: reef-demand
      // sorts its demand table long before it hunts, so a position check called both wired
      // selectors after-filters. The honest contract is that deflate's SURVIVING SET is what gets
      // ranked: `kept` must flow into a comparator sort. That cannot be satisfied by an
      // after-filter, and it does not care where the file happens to sort anything else.
      deflates_upstream: HAS_MEMORY.test(src) && /\bdeflate\s*\(/.test(src)
        && /\bkept\b[\s\S]{0,240}?\.sort\(\s*\(/.test(src),
      records: /\brecordAttempt\s*\(/.test(src),
    });
  }
  return rows;
}

/** every selector that ranks without consulting what it already tried — debt or not */
export function memoryless(rows = census()) {
  return rows.filter((r) => !r.exempt && (!r.has_memory || !r.deflates_upstream || !r.records));
}

/**
 * THE VERDICT. UNDECLARED memoryless selectors are INCIDENTS — a new one, or one whose debt tag was
 * deleted without wiring it. Declared debt is an ADVISORY, counted and ratcheted elsewhere.
 * Incidents and advisories must never share an exit code: that is how seven UI guards sat red on
 * correct code until nobody read the suite (spec §6).
 */
export function undeclared(rows = census()) { return memoryless(rows).filter((r) => !r.debt); }
export function declaredDebt(rows = census()) { return memoryless(rows).filter((r) => r.debt); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = census();
  const news = undeclared(rows), debt = declaredDebt(rows);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows, undeclared: news, debt }, null, 1)); process.exit(news.length ? 1 : 0); }
  console.log(`selector census · ${rows.length} discovered · ${rows.filter((r) => r.exempt).length} exempt-at-site · ${debt.length} declared debt · ${news.length} UNDECLARED MEMORYLESS`);
  for (const r of rows) {
    const mark = r.exempt ? 'ⓘ' : r.debt ? '⚠' : news.includes(r) ? '✗' : '✓';
    const why = r.exempt ? `exempt: ${r.exempt}`
      : r.debt ? `known debt — ${r.debt.slice(0, 90)}`
        : [!r.has_memory && 'no burn-mass import', r.has_memory && !r.deflates_upstream && 'deflates AFTER the ranking (an after-filter changes nothing)', !r.records && 'never records what it picks'].filter(Boolean).join(' · ') || 'consults attempt history upstream';
    console.log(`  ${mark} ${r.file.padEnd(34)} ${why}`);
  }
  process.exit(news.length ? 1 : 0);
}
