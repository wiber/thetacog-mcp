#!/usr/bin/env node
// scripts/pmu/reef-miner.mjs — THE OVERNIGHT MINER (Cycle 2 C3b · spec §9 v8.2).
//
// THE EXTRACTIVE LAW (E1's scar made law): this miner SELECTS real repo passages — it never
// composes cell prose. Synthesis made the blobby well (C=0.825); the repo's own text is
// non-homogeneous by construction.
//
// One nightly run: CRAWL (docs/*.md headers+paragraphs, scripts/pmu comment blocks, recent
// commit subjects+bodies, incident ledgers) → EXTRACT candidates (80-400 ch passages,
// deterministic slicing; optional qwen TRIM only — never rewrite) → PLACE each by the REAL
// walk (walkShape heat argmax; the address is competence, never assignment; the reaching
// walk's provenance is recorded WITH the extract — the context-of-address) → PROPOSE into
// the harvest-agent intake as derived-statement candidates for the placed domain's nearest
// rule → the harvest-agent runs the gauntlet (diversity → harvest-accept → autonomous seal).
//
// BUDGETS (countable quanta, never dribble): MAX_CANDIDATES per run, one intake batch, and
// the harvest-agent's own min-delta acceptance judges whether the batch was worth a cycle.
//
// Run: node scripts/pmu/reef-miner.mjs [--max 40] [--dry]

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflate, recordAttempt } from './burn-mass.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const MAX = parseInt(arg('--max', '40'), 10);
const dry = process.argv.includes('--dry');
const INTAKE = resolve(REPO, 'data/pmu/lens-c1-adjudication.json');

const { walkShape } = await import(resolve(REPO, 'src/lib/pmu/unified-drift.mjs'));
const { COORDS } = await import(resolve(HERE, 'definer-walk-144.mjs'));
const { nearestDomainByCoord } = await import(resolve(HERE, 'lens-convergence-sweep.mjs'));

const reef = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8'));
const DOMAINS = reef.domains || [];
const byName = new Map(DOMAINS.map((d) => [d.domain, d]));
// gradient-trace helpers: the 144 text masses (for per-step grip) + a local NCD
import { gzipSync as _gz } from 'node:zlib';
const _z = (s) => _gz(Buffer.from(String(s), 'utf8')).length;
const ncdOf = (a, b) => { const ga = _z(a), gb = _z(b), gab = _z(`${a}\n${b}`); const d = Math.max(ga, gb); return d === 0 ? 1 : (gab - Math.min(ga, gb)) / d; };
let _well144 = null;
const well144 = () => {
  if (_well144) return _well144;
  try {
    const lib = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/snippet-library-144.json'), 'utf8'));
    const cells = Array.isArray(lib) ? lib : (lib.anchors || lib.nodes || []);
    _well144 = cells.map((x) => [String(x.coord || `${x.row},${x.col}`), String(x.snippet || '')]);
  } catch { _well144 = []; }
  return _well144;
};

// ── CRAWL + EXTRACT (deterministic slicing — passages, not synthesis) ──────────────────────
const candidates = [];
const push = (text, source) => {
  let t = String(text).replace(/\s+/g, ' ').trim();
  // EXTRACT HYGIENE: strip md emphasis/heading tokens; skip table fragments and path-dominant
  // lines (they place poorly and read as noise in a derived statement).
  t = t.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/`/g, '');
  const pipes = (t.match(/\|/g) || []).length;
  const pathy = (t.match(/[a-z0-9-]+\/[a-z0-9./-]+/gi) || []).join('').length;
  if (pipes >= 3 || pathy > t.length * 0.35) return;
  // LIST-FRAGMENT HYGIENE (wide-intake regression, 2026-07-20): the widened net pulled
  // checklist/table rows — "- [ ] NUCLEAR-OPTION-NOTICE.html - [ ] VIDEO-TRANSCRIPT",
  // "- Brand consistency score: >95%" — which place poorly and read as noise as a derived
  // statement. A derived statement is PROSE: it must have sentence shape, not bullet shape.
  const bullets = (t.match(/(^|\s)[-*•]\s|\[[ x]\]/gi) || []).length;
  if (bullets >= 2) return;                                   // two or more list markers = a list, not a passage
  if (!/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(t)) return;   // no run of three real words = not prose
  const caps = (t.match(/[A-Z]{4,}/g) || []).join('').length;
  if (caps > t.length * 0.25) return;                          // SHOUTING-FILENAME fragments
  if (t.length >= 80 && t.length <= 400) candidates.push({ text: t, source });
};
// ══ STRATIFIED INTAKE (operator 2026-07-20: "how do we get the most out of this process, all
// commits weighted for recent, all on disk?"). MEASURED STARVATION: this repo carries 14,432
// commits · 5,466 tracked .md · 4,511 tracked code files. The prior intake read the last 40
// commits, ≤24 files from two doc dirs (first 40 paragraphs each), and 40 script comment blocks
// (first 16 lines) — the SAME front-truncated ~1% every tick, deterministically. That is not a
// corpus, it is a fixed sample; combined with the forgotten-refusal bug it produced a five-hour
// fixed point. Cost headroom is real: the miner is 6-9s of a ~135s tick.
//
// THE DESIGN — three properties, none of them randomness (the receipt must stay reproducible):
//   (a) WIDE: walk docs/** and scripts/** recursively; no folder allow-list, no file cap.
//   (b) STRATIFIED ROTATION: a persisted cursor picks WHICH window of each file/commit-range
//       this tick reads. Tick N reads a different stratum than tick N-1, so coverage sweeps the
//       whole repo over time instead of re-reading page one. Deterministic given the cursor —
//       the cursor is data (like the skip ledger), not entropy. NEVER randomness — AR: the
//       receipt is a pure function of its inputs).
//   (c) RECENCY-WEIGHTED: commits stay the freshest dialect and keep top rank, but the window
//       is 600 deep with the cursor sliding through it, so foundational commits get sampled too.
const CURSORF = resolve(REPO, 'data/pmu/miner-cursor.json');
const cursorDoc = existsSync(CURSORF) ? JSON.parse(readFileSync(CURSORF, 'utf8')) : { tick: 0 };
const TICK = Number(cursorDoc.tick || 0);
// stratum picker: deterministic, tick-indexed window over any array
const stratum = (arr, size, offsetMul = 1) => {
  if (arr.length <= size) return arr;
  const start = (TICK * size * offsetMul) % arr.length;
  const out = arr.slice(start, start + size);
  return out.length < size ? out.concat(arr.slice(0, size - out.length)) : out;   // wrap
};

// 0. THE OPERATOR CORPUS — the ORIGIN source, ranked above everything (spec §10.5, build 2).
// Every rule in CLAUDE.md began as an operator directive spoken in a session; commits, docs and
// code comments are all DOWNSTREAM of that. mine-operator-prompts.mjs ranks ~4,600 transcript
// turns by CANONICITY (standing-rule markers + corrections + mechanism language + repetition
// weight, minus operational one-offs) and writes the survivors here. Mining the origin corpus
// directly closes the hand-copy loop: a directive no longer has to be manually transcribed into
// prose to reach the reef.
//
// THE MACHINE-VOICE FENCE IS UPSTREAM AND MANDATORY: the ranker drops the loop's OWN self-prompts
// ("You are the overnight Chief-of-Staff worker…", "Autonomous overnight repo-improvement loop"),
// which otherwise dominate the ranking because they are literally written as standing directives.
// Mining them would feed the reef its own output and call it operator canon — the self-reference
// the constitution exists to refuse. Asserted by tests/pmu-simulator/operator-corpus-source.test.mjs.
try {
  const oc = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/operator-corpus.json'), 'utf8'));
  const ranked = (oc.prompts || []);
  // the corpus is pre-ranked by canonicity; take the cursor's stratum so coverage rotates like
  // every other source rather than re-offering the same top-N forever (the fixed-point lesson).
  // SENTENCE-CHUNK the directives. Measured: 22 of 24 sampled directives exceed the 80-400 char
  // extract band — operator directives are DICTATED and multi-clause, unlike the doc paragraphs the
  // band was tuned for. The cap stays (it is what keeps pasted walls out); the operator source is
  // chunked at sentence boundaries instead, so a long directive contributes its clauses rather than
  // being silently dropped whole. Chunks accumulate to ≥80 chars so a fragment never enters alone.
  const chunkDirective = (text) => {
    const out = [];
    let buf = '';
    for (const sent of String(text).split(/(?<=[.!?])\s+/)) {
      buf = buf ? `${buf} ${sent}` : sent;
      if (buf.length >= 120) { out.push(buf.slice(0, 400)); buf = ''; }
    }
    if (buf.length >= 80) out.push(buf.slice(0, 400));
    return out.length ? out : [String(text).slice(0, 400)];
  };
  for (const p of stratum(ranked, 24, 11)) for (const chunk of chunkDirective(p.text)) push(chunk, 'operator-corpus');
  if (ranked.length) console.log(`  operator corpus: ${ranked.length} ranked directives (built ${String(oc.built_at || '').slice(0, 10)}) — origin source, top rank`);
} catch { /* corpus not built yet — run scripts/pmu/mine-operator-prompts.mjs */ }

// 1. commits — recency-weighted, cursor-slid (freshest dialect keeps top rank via `rank()`)
try {
  const log = execFileSync('git', ['log', '--pretty=format:%s%n%b%n---', '-600'], { cwd: REPO, encoding: 'utf8', maxBuffer: 3e7 });
  const chunks = log.split('\n---\n');
  // the newest 40 EVERY tick (recency prior), plus a rotating 60-commit window deeper in
  const recent = chunks.slice(0, 40);
  const deep = stratum(chunks.slice(40), 60);
  for (const chunk of [...recent, ...deep]) for (const para of chunk.split('\n\n')) push(para, 'git-log');
} catch { /* */ }

// recursive on-disk collector (no folder allow-list, no cap — the cursor does the bounding)
const walkDir = (rel, ext, acc = [], depth = 0) => {
  if (depth > 4) return acc;
  let entries = [];
  try { entries = readdirSync(resolve(REPO, rel), { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) walkDir(p, ext, acc, depth + 1);
    else if (ext.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
};

// CURATED TERRITORY (measured lesson, 2026-07-20): the first cut of this widening walked ALL
// of docs/** and the novelty ranker promptly surfaced LinkedIn connection rows and CRM contact
// exports — genuinely the most "distinct" text in the repo, and worthless as reef content.
// The old hard caps were doing TWO jobs: bounding cost (bad, that's what rotation is for) and
// CURATING TOPIC (good — docs/architecture + docs/pmu is where the mechanism lives). Widen the
// coverage, keep the curation: high-signal dirs are included wholesale, data-ish dirs (contact
// records, outreach, CRM) are excluded by name. Novelty ranks WITHIN topical territory, never
// across it — otherwise maximizing distance from the reef just finds the address book.
const SIGNAL_DIRS = ['docs/architecture', 'docs/pmu', 'docs/ops', 'docs/strategy', 'docs/incidents'];
const NOISE_RE = /\/(crm|outreach|comms|leads|contacts|newsletter|book)\//i;
// 2. docs — ALL files in the signal dirs, 20 per tick, rotating paragraph window within each
const docFiles = SIGNAL_DIRS.flatMap((d) => walkDir(d, ['.md'])).filter((f) => !NOISE_RE.test(f)).sort();
for (const f of stratum(docFiles, 20)) {
  try {
    const paras = readFileSync(resolve(REPO, f), 'utf8').split(/\n\n+/);
    for (const para of stratum(paras, 25, 3)) push(para.replace(/^#+\s*/, ''), f);
  } catch { /* */ }
}

// 3. code comment blocks — ALL of scripts/**, 30 files per tick, rotating comment window
const codeFiles = walkDir('scripts', ['.mjs', '.js']).sort();
for (const f of stratum(codeFiles, 30, 7)) {
  try {
    const lines = readFileSync(resolve(REPO, f), 'utf8').split('\n').filter((l) => l.trim().startsWith('//'));
    const win = stratum(lines, 20, 5).map((l) => l.replace(/^\s*\/\/\s?/, ''));
    // chunk the window into paragraph-sized pushes so one file can yield several candidates
    for (let i = 0; i < win.length; i += 5) push(win.slice(i, i + 5).join(' '), f);
  } catch { /* */ }
}
try { writeFileSync(CURSORF, JSON.stringify({ tick: TICK + 1, note: 'stratified-intake rotation cursor — advances every tick so coverage sweeps the repo deterministically (never Math.random)' }, null, 1)); } catch { /* */ }

// RECENCY PRIOR (operator 2026-07-20: "the age of the file means some rules have been
// superseded" — the gate only catches obsolete content that CONTRADICTS the constitution;
// merely-stale noise passes flat. Weight intake by source freshness so the newest dialect
// wins budget, deterministically: git-log extracts rank first (freshest by construction),
// file extracts rank by last-commit epoch of their source file.)
// BATCHED (stratified intake, 2026-07-20): the per-file `git log -1` shelled out ONCE PER
// SOURCE — fine at 40 files, a tick-killer at the hundreds the wide intake now touches. One
// `git log --name-only` pass builds the whole path→epoch map; first sighting wins (git walks
// newest-first), so the value is identical to the per-file query at ~1/300th the cost.
const mtCache = new Map();
try {
  const raw = execFileSync('git', ['log', '--format=@%ct', '--name-only', '-n', '1200'], { cwd: REPO, encoding: 'utf8', maxBuffer: 6e7 });
  let cur = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@')) { cur = parseInt(line.slice(1), 10) * 1000 || 0; continue; }
    const p = line.trim();
    if (p && !mtCache.has(p)) mtCache.set(p, cur);
  }
} catch { /* fall through — unknown sources rank 0, still deterministic */ }
// RANK TIERS: operator directives outrank even the freshest commit — a commit message describes
// what was DONE; an operator directive states what must ALWAYS BE TRUE. The origin outranks the
// echo. (git-log keeps its 9e12 recency-prior slot below it.)
const rank = (src) => (src === 'operator-corpus' ? 9e13 : src === 'git-log' ? 9e12 : (mtCache.get(src) ?? 0));
// THE CURSOR (incident 2026-07-20: 20 consecutive no-op ticks). The already-adjudicated
// filter USED to run at intake — i.e. AFTER this budget slice — so every tick re-mined the
// same 358 raw, re-ranked deterministically, took the IDENTICAL top-MAX, walked and placed
// them, then discovered all MAX were already known and exited `nothing to apply`. The miner
// never saw candidate MAX+1. Deterministic ranking + a post-slice dedupe = a stuck cursor by
// construction. The known-set MUST gate the budget, not the write.
const adjSeed = existsSync(INTAKE) ? JSON.parse(readFileSync(INTAKE, 'utf8')) : { rows: [] };
const adjudicated = new Set((adjSeed.rows || []).map((r) => String(r.prompt).slice(0, 60)));
// THE SKIP LEDGER (same incident, one layer down). The cursor above only advances over
// candidates that PLACE — a candidate walked and honestly skipped (funnel / off-metal) never
// reaches the intake, so the adjudicated set never grows and the next tick re-mines the
// identical budget. Unplaceable candidates must ALSO be remembered, or the cursor re-sticks
// on the first unplaceable run of MAX. Recorded, never silently dropped: the reason rides
// with the key, so "what did the walk refuse, and why" stays answerable off the ledger.
const SKIPPED = resolve(REPO, 'data/pmu/miner-skipped.json');
const skipSeed = existsSync(SKIPPED) ? JSON.parse(readFileSync(SKIPPED, 'utf8')) : { rows: [] };
const skipped = new Set((skipSeed.rows || []).map((r) => String(r.key)));
// dedupe + budget (deterministic order: freshest source first, then text)
// THE REFUSED LEDGER (third cursor set, 2026-07-20): a candidate the CONSTITUTION refused is
// forgotten by the two sets above, because the gate's revert restores lens-c1-adjudication.json
// along with the reef — erasing the very rows that recorded "we tried these". Measured
// consequence: HA-62..HA-67 proposed byte-identical batches, a permanent fixed point. This
// ledger is written by harvest-accept OUTSIDE the reverted paths, so a refusal is remembered.
const REFUSED = resolve(REPO, 'data/pmu/miner-refused.json');
const refusedSeed = existsSync(REFUSED) ? JSON.parse(readFileSync(REFUSED, 'utf8')) : { rows: [] };
const refused = new Set((refusedSeed.rows || []).map((r) => String(r.key)));
const seen = new Set();
const unseen = candidates.filter((c) => {
  const k = c.text.slice(0, 60);
  if (seen.has(k) || adjudicated.has(k) || skipped.has(k) || refused.has(k)) return false;   // ← the cursor
  seen.add(k); return true;
});
// NOVELTY PRE-FILTER (gzip-NCD, the canonical sensor — never SimHash, never an embedding).
// A wide intake surfaces more text, not necessarily more SIGNAL: a passage that compresses
// away against what the reef already holds carries no new information, and spending a walk +
// a gate cycle on it is the expensive way to learn nothing. Measured cheaply here (one gzip
// per candidate against the reef's own vocab+derived text) BEFORE the budget slice, so the
// 15 that survive are the 15 most distinct — not merely the 15 freshest.
// derived_statements is a MAP (rule-key → [statements]), not an array — flatten both shapes
const derivedText = (ds) => {
  if (!ds) return '';
  if (Array.isArray(ds)) return ds.join(' ');
  return Object.entries(ds).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(' ') : String(v)}`).join(' ');
};
// SCALE MATTERS — gzip-NCD is DIMENSION-BLIND and needs comparable byte mass on both sides.
// Measured 2026-07-20: a statement literally IN the reef scores 0.983 against the whole 20k
// reef vs 0.996 for random prose — a 0.013 spread, pure noise. Against its OWN domain (2.9k)
// the same pair reads 0.887 vs 0.975 — 7x the discrimination. So novelty is the MINIMUM NCD
// across per-domain texts: the closest domain is the one that would absorb the candidate, and
// if it absorbs it cheaply the candidate carries no new information.
const domainTexts = (reef.domains || []).map((d) => `${d.vocab || ''} ${derivedText(d.derived_statements)}`).filter((t) => t.trim().length > 200);
// RANK, DON'T THRESHOLD. An absolute novelty floor is a magic constant that silently
// mis-calibrates the moment the reef's byte-mass changes (measured: a 0.90 floor passed
// 244/244 against the whole reef and 0/147 against per-domain texts — the SAME candidates).
// Ranking is scale-free: whatever the distribution, the top-MAX are the most distinct
// candidates available this tick. Recency breaks ties, so the freshest dialect still wins
// among equals — the recency prior is preserved, not replaced.
const novelty = (text) => (domainTexts.length ? Math.min(...domainTexts.map((t) => ncdOf(text, t))) : 1);
const scored = unseen.map((c) => ({ ...c, novelty: novelty(c.text) }));
// NOVELTY FILTERS REDUNDANCY; RECENCY STILL RANKS. Ranking BY novelty maximizes distance from
// the reef, which selects the most off-topic text available (measured: it picked contact rows).
// The honest use is subtractive — drop the most-redundant quartile (restatements of what the
// reef already holds), then let the existing recency prior choose among what remains.
const sortedNv = scored.map((c) => c.novelty).sort((a, b) => a - b);
const redundantCut = sortedNv[Math.floor(sortedNv.length * 0.25)] ?? 0;
const kept = scored.filter((c) => c.novelty > redundantCut);
// ── DEFLATE — the attempt history, UPSTREAM of the recency ranking (spec §3 I2) ──────────────
// THE MINER'S LANE IS 'miner'. Unlike the demand engine, this selector does not know a candidate's
// coordinate until AFTER the walk has placed it — so its attempt history is keyed on the selector
// itself. That is not a weaker form of the primitive: the failure it prevents is the miner
// re-offering text it has already walked, which is a property of the miner, not of any cell. The
// PLACED coordinate is recorded too (below), so the demand engine — which does hunt per-coordinate —
// inherits the miner's attempts and neither selector can hand the other its leftovers.
// COST, measured not assumed: 74 candidates x 80-item bounded mass x 134us = ~0.8s of a ~135s tick.
const memory = deflate(kept.length >= MAX ? kept : scored, 'miner', (c) => c.text);
if (memory.mass_size) console.log(`  burn mass: ${memory.repelled.length} candidates repelled against ${memory.mass_size} prior attempts (deflated BEFORE the ranking, never after)`);
const pool = memory.kept
  .sort((a, b) => rank(b.source) - rank(a.source) || a.text.localeCompare(b.text))
  .slice(0, MAX);
const nv = pool.map((c) => c.novelty);
const nvMedian = sortedNv[Math.floor(sortedNv.length / 2)] ?? 0;
console.log(`  novelty (gzip-NCD, min-vs-domain): picked ${nv.length} · range ${Math.min(...nv).toFixed(3)}-${Math.max(...nv).toFixed(3)} from ${scored.length} scored (pool median ${nvMedian.toFixed(3)}, dropped ${scored.length - kept.length} most-redundant)`);
// THE INTAKE RATCHET (operator 2026-07-20: "ratchet it?"). A widened intake that is not
// MEASURED is just a different sample. Every tick appends its intake shape so the floor can
// only rise — same discipline as the picker's F1 ratchet, applied one stage upstream.
try {
  const row = { ts: new Date().toISOString(), raw: candidates.length, scored: scored.length,
    picked: pool.length, novelty_median: +nvMedian.toFixed(4), dropped_redundant: scored.length - kept.length,
    doc_files: docFiles.length, code_files: codeFiles.length, tick: TICK };
  appendFileSync(resolve(REPO, 'data/pmu/miner-intake-history.ndjson'), JSON.stringify(row) + '\n');
} catch { /* non-fatal — the tick never dies for a metrics write */ }
console.log(`miner: ${candidates.length} raw → ${pool.length} candidates (budget ${MAX}, ${adjudicated.size} already on tape, ${skipped.size} previously skipped, ${refused.size} constitution-refused)`);
// CORPUS EXHAUSTED is a real, reportable state — not silence. Spec §12.2 leaves the loop's
// response undefined (idle / widen / halt); until that is decided, say it plainly and exit 0.
if (!pool.length) { console.log(`miner: CORPUS EXHAUSTED — every candidate is already adjudicated (${adjudicated.size} on tape). Widen the crawl or raise --max.`); process.exit(0); }

// ── PLACE by the real walk + PROPOSE ────────────────────────────────────────────────────────
const proposals = [];
const skips = [];   // walked-and-refused, with the reason — feeds the skip ledger (the cursor)
for (const c of pool) {
  const key = c.text.slice(0, 60);
  const w = await walkShape(c.text, { timeoutMs: 4000 });
  if (!w || w.sensor !== 'metal') { skips.push({ key, reason: 'off-metal', source: c.source }); continue; }
  let best = -1, bi = -1;
  for (let i = 0; i < 144; i++) if (w.heat[i] > best) { best = w.heat[i]; bi = i; }
  const coord = bi >= 0 ? COORDS[bi] : null;
  if (!coord || coord === 'C,C') { skips.push({ key, reason: 'funnel', source: c.source }); continue; }
  const domName = nearestDomainByCoord(coord, DOMAINS, null);
  const d = domName && byName.get(domName);
  if (!d || !(d.rules || []).length) { skips.push({ key, reason: 'no-domain-rules', coord, source: c.source }); continue; }
  // nearest rule by shared stems (deterministic; the harvest-agent's caps apply on intake)
  const stems = new Set(c.text.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3));
  let rule = d.rules[0], scoreBest = -1;
  for (const r of d.rules) {
    const rs = String(r).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3);
    const s = rs.reduce((n, x) => n + (stems.has(x) ? 1 : 0), 0);
    if (s > scoreBest) { scoreBest = s; rule = r; }
  }
  // THE LINEAGE (operator 2026-07-20: "the categories you traverse and the content of the
  // cells getting there is critical"): not just the destination — the per-ply traversal,
  // derived from the walk's own ply array (seeds at ply 0, followed cells by depth). This
  // rides WITH the extract forever: the context-of-address as an actual path, readable by
  // qwen and human alike.
  // THE GRADIENT TRACE (operator 2026-07-20, ratified: "for every jump you should be able to
  // backtrack where you came from — that track record gives qwen an extremely precise spatial
  // view of the compression space"): each lineage step carries the payload's GRIP at that cell
  // (1−NCD vs the cell's text mass) and the Δ from the previous step. Ply order IS the
  // backtrack (each ply's cells were reached from the prior ply). Knock-on reading surface
  // for qwen — never in any deterministic verdict.
  const lineage = [];
  if (w.raw && w.raw.ply) {
    const byCoordDump = new Map(well144());
    let prevBest = null;
    for (let ply = 0; ply <= (w.plies || 0) && ply < 4; ply++) {
      const cellsAt = [];
      for (let i = 0; i < 144; i++) if (w.raw.ply[i] === ply) cellsAt.push(i);
      if (!cellsAt.length) continue;
      const graded = cellsAt.slice(0, 6).map((i) => {
        const dump = byCoordDump.get(COORDS[i]) || '';
        const s = dump.length >= 80 ? +(1 - ncdOf(c.text, dump)).toFixed(3) : null;
        return { coord: COORDS[i], s };
      });
      const best = graded.reduce((m, x) => (x.s != null && (m == null || x.s > m) ? x.s : m), null);
      const delta = (best != null && prevBest != null) ? +(best - prevBest).toFixed(3) : null;
      prevBest = best ?? prevBest;
      lineage.push(`ply${ply}: ${graded.map((g) => `${g.coord}${g.s != null ? `(${g.s})` : ''}`).join(' ')}${cellsAt.length > 6 ? ` +${cellsAt.length - 6}` : ''}${delta != null ? ` Δ${delta >= 0 ? '+' : ''}${delta}` : ''}`);
    }
  }
  // ── N2a: THE WALK DESCENDS (cb1-split-chain-spec §2.1) — a placement on a SPLIT cell recurses
  // one level down (same daemon, same grid construction, the E1-proven slice walk) and the
  // breadcrumb gains the L1 line. A null descent (no daemon / starved slice) records nothing —
  // a missing walk is never simulated.
  let childCoord = null;
  try {
    const { hasSubWell, descend } = await import(resolve(HERE, 'slice-descent.mjs'));
    if (hasSubWell(coord)) {
      const dsc = await descend(c.text, coord);
      if (dsc) { lineage.push(dsc.lineageLine); childCoord = dsc.child_coord; }
    }
  } catch { /* descent optional — depth-0 lineage stands alone */ }
  proposals.push({
    kind: 'must-fire', domain: domName, rule_key: String(rule).slice(0, 60), prompt: c.text,
    miss_reason: 'mined', verdict: 'reef-missing',
    proposal: { vocab_stems: [], derived_statement: c.text },
    ...(childCoord ? { child_coord: childCoord } : {}),
    why: `mined from ${c.source}; placed by walk at ${coord} (heat argmax, ${w.hops} hops — the context-of-address)`,
    provenance: { source: c.source, placed_coord: coord, walk_hops: w.hops, walk_plies: w.plies, lineage },
  });
}
console.log(`placed by walk: ${proposals.length}/${pool.length} (funnel/off-metal skipped honestly)`);
// ── RECORD THE ATTEMPTS ──────────────────────────────────────────────────────────────────────
// EVERY candidate in the pool was ATTEMPTED — walked, and either placed or refused. Recording only
// the placed ones would rebuild the exact blindness this iteration removes: the miner's cursor
// already forgets a refusal whenever the constitution's revert restores the intake file, which is
// how HA-62..HA-67 proposed byte-identical batches. Placed material is ALSO recorded at its
// coordinate, so the demand engine's per-coordinate hunt inherits it.
if (!dry) {
  let mine = 0, cell = 0;
  for (const c of pool) if (recordAttempt(c.text, 'miner', { source: c.source, novelty: +c.novelty.toFixed(4) })) mine++;
  for (const p of proposals) if (recordAttempt(p.prompt, p.provenance.placed_coord, { by: 'reef-miner', source: p.provenance.source })) cell++;
  console.log(`burn mass: +${mine} attempts at lane 'miner' · +${cell} at placed coordinates — next tick cannot re-offer this material`);
}
// PERSIST THE SKIPS — this is what advances the cursor past unplaceable ground. Without it a
// budget of MAX unplaceable candidates re-mines identically forever (the second layer of the
// 2026-07-20 no-op-tick defect). Capped + append-only; the reason rides with the key.
if (!dry && skips.length) {
  const sl = existsSync(SKIPPED) ? JSON.parse(readFileSync(SKIPPED, 'utf8')) : { rows: [] };
  sl.rows = (sl.rows || []).concat(skips.map((s) => ({ ...s, at: new Date().toISOString() }))).slice(-20000);
  sl.updated_at = new Date().toISOString();
  writeFileSync(SKIPPED, JSON.stringify(sl, null, 1));
  const byReason = skips.reduce((m, s) => ({ ...m, [s.reason]: (m[s.reason] || 0) + 1 }), {});
  console.log(`skip ledger: +${skips.length} (${Object.entries(byReason).map(([r, n]) => `${r} ${n}`).join(' · ')}) → cursor advances past unplaceable ground`);
}
if (dry) { for (const p of proposals.slice(0, 6)) console.log(`  ${p.provenance.placed_coord} → ${p.domain} · ${p.prompt.slice(0, 70)}…`); process.exit(0); }

// append into the harvest-agent intake (single-writer: the miner owns this file section)
const adj = existsSync(INTAKE) ? JSON.parse(readFileSync(INTAKE, 'utf8')) : { built_at: null, rows: [], summary: {} };
adj.rows = adj.rows || [];
// TICK DEDUPE (loop mode): a proposal whose prompt already exists in the intake (consumed or
// not) is never re-added — repeated ticks propose only NEW extracts, so cycles stay quanta.
const known = new Set(adj.rows.map((r) => String(r.prompt).slice(0, 60)));
const fresh = proposals.filter((p) => !known.has(String(p.prompt).slice(0, 60)));
for (const p of fresh) adj.rows.push(p);
adj.mined_at = new Date().toISOString();
adj.mined_count = (adj.mined_count || 0) + fresh.length;
writeFileSync(INTAKE, JSON.stringify(adj, null, 1));
console.log(`intake: +${fresh.length} NEW mined proposals (${proposals.length - fresh.length} already known) → ${INTAKE} · next: HARVEST_AGENT=1 node scripts/pmu/harvest-agent.mjs (the gauntlet judges)`);
