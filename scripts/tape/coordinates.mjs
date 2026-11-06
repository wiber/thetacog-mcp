// packages/thetacog-mcp/scripts/tape/coordinates.mjs — THE TAPE'S ACTUAL PRODUCT.
//
// Operator, 2026-08-20, correcting a session-long misreading:
//   "It's not just retrieving a rule. It might be CREATING a rule for the project. So it's nailing
//    down semantic coordinates. One by one and adding them to the tape in order to figure out what
//    we are building."
//   "The measurement is supposed to be added ON TOP of that afterwards. The measurement only works
//    because this is a version of stringing the past together to predict the future and create one
//    coordinate at a time on the tape, which creates momentum over time."
//   "If the steers are large, it makes a larger cone... you want to create the CENTER POINT through
//    it by repeatedly refining the rules and steers and hats... and by doing that you should be able
//    over time to figure out where the drifts are from the CENTER LINE of that cone."
//
// ── WHAT I HAD WRONG, NAMED SO IT DOES NOT COME BACK ──────────────────────────────────────────
// I treated rules as GUARDRAILS — "never bypass the hook", "always use one door". That is policing,
// and policing is downstream. A rule here is a COORDINATE: it does not constrain the project, it
// DEFINES it. The set of locked coordinates IS the specification, accumulated one decision at a time
// by a human who never had to write a spec up front.
//
// This also explains why the measurement kept feeling hollow. Drift is only measurable FROM a centre
// line, and the centre line is made of locked coordinates. With zero locked coordinates there is
// nothing to drift from — which is exactly what momentum reported when it found 17 testimony pairs
// and 0 authored ones. That was not a plumbing gap. It was a tape with no centre.
//
// THE ORDER IS: steer → coordinate → tape → cone → and ONLY THEN drift from the centre line.
//
// ── THE ANTI-DUPLICATION MECHANISM ────────────────────────────────────────────────────────────
// Operator: "the rules need to have those file paths in their metadata so that you don't reinvent
// something that's already been finished. Like we keep doing that. We keep building new junk when we
// already have a completely fully running rust pipeline."
// So every coordinate carries `owns: [paths]` — DISCOVERED DETERMINISTICALLY, never by a model — and
// the injection regime hands those paths to any agent BEFORE it is told what to build. A rule that
// cannot name what already exists for it is a rule that will cause a rebuild.
//
// @guard tests/tape/coordinates-define-the-cone.test.mjs

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { git, gitUnavailableReason } from './git-bin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const REPO = resolve(PKG, '..', '..');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');

const LEDGER = 'coordinates.ndjson';
const sdir = (slug) => resolve(SESSIONS, slug);

export function readCoordinates(slug) {
  const f = resolve(sdir(slug), LEDGER);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Live view: append-only ledger, last row per id wins, superseded rows stay readable. */
export function liveCoordinates(slug) {
  const order = [], latest = new Map();
  for (const r of readCoordinates(slug)) {
    if (!r?.id) continue;
    if (!latest.has(r.id)) order.push(r.id);
    latest.set(r.id, r);
  }
  return order.map((id) => latest.get(id)).filter((c) => c.status !== 'retired');
}

// ── OWNS — what already exists for this rule (DETERMINISTIC, no model) ────────────────────────
// A model asked "which files does this touch?" would guess, and a guess here causes the exact
// rebuild the mechanism exists to prevent. So: pull the distinctive terms out of the rule and ask
// git itself. git grep is the running code; it knows what is tracked and it is fast.
const STOP = new Set(['the','a','an','and','or','but','if','then','must','never','always','every','all','any','be','is','are','was','were','to','of','in','on','for','with','from','that','this','it','its','as','at','by','not','no','do','does','so','than','when','which','what','into','out','up','down','over','under','one','two','only','same','each','per','via','use','used','using','make','makes','made','can','cannot','should','would','could','will','shall','may','might','we','you','they','their','our','your','its','has','have','had','been','being','before','after','because','while','through','across','between','without','within','rather','instead','also','still','yet','just','even','more','most','less','least','own','new','old','real','true','false']);
export function distinctiveTerms(rule, { max = 6 } = {}) {
  const words = String(rule || '').toLowerCase().match(/[a-z][a-z0-9_.-]{3,}/g) || [];
  const seen = new Map();
  for (const w of words) {
    if (STOP.has(w)) continue;
    seen.set(w, (seen.get(w) || 0) + 1);
  }
  // Prefer LONGER, RARER-looking tokens — an identifier like `composeEncircledPanel` or a path
  // fragment like `tolerance-panel` is far more discriminating than a common English word.
  return [...seen.keys()]
    .sort((a, b) => (b.includes('-') || b.includes('.') ? 1 : 0) - (a.includes('-') || a.includes('.') ? 1 : 0) || b.length - a.length)
    .slice(0, max);
}

// PERF (2026-08-20): the naive version ran ONE `git grep -l -i -- term` PER TERM (up to 6). MEASURED
// on this repo/machine: a SINGLE `git grep` invocation over the tracked tree costs 50-100s+ by
// itself — even for a term with ZERO matches — because git grep re-walks and re-reads the whole
// 46,680-file / ~5.8GB tracked tree from scratch on every invocation, independent of the pattern.
// So N terms means N full tree walks, and 5 locks x ~6 terms was N=30 walks: the measured 2-minute
// timeout. An OR-combined single `git grep -l -i -e t1 -e t2 ...` call still pays that SAME per-
// invocation tree-walk cost exactly once per LOCK, not once per TERM-across-the-whole-session — it
// does not help a multi-lock batch, and common terms still return huge candidate sets that make a
// second scoped pass expensive too (measured worse in one trial: 103s for a single lock).
//
// THE FIX: replace repeated git-subprocess tree-walks with ONE in-process read of the tracked tree,
// cached for the lifetime of the process, then answer every term for every lock with an in-memory
// substring scan — no further subprocess spawned, no further disk walk, ever, for the rest of the
// run. This is both "one combined pass" (a single walk resolves every term) AND "cached across
// locks in the same process" (the corpus is read once and reused by every subsequent lockCoordinate
// call): MEASURED building the corpus once ~15-30s under this session's own heavy concurrent load
// (see AXIOM 0 for why this repo's wall-clock numbers are reported with load context, not as clean
// points), vs. 50-100s+ PER TERM PER LOCK for the git-grep path it replaces.
//
// Binary media (mp4/mp3/png/…) and outsized dumps are skipped by extension + a per-file size cap —
// matching what git grep's own binary-file heuristic already effectively excludes from a text
// search, not a new omission. No TERM is ever dropped and the real walk (physics.mjs placement) is
// completely untouched — this only changes how "which files already mention this term" is answered.
const IGNORE_PATH = /^(node_modules|\.next|dist|build)\//;
const BINARY_EXT = /\.(mp4|mp3|m4a|wav|mov|webm|avi|mkv|png|jpe?g|gif|webp|svg|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|7z|rar|woff2?|ttf|eot|otf|db|sqlite3?|node|wasm|bin|exe|dylib|so|a|o|class|jar|psd|ai|eps|heic|raw|lock)$/i;
const CORPUS_FILE_CAP = 300 * 1024;   // per-file bytes; source/docs are always far under this
let corpus = null;                    // Map<file, lowercase-content> — built once per process
// A healthy build of this repo reads thousands of files; a count near zero is a contended or
// failed build, never an empty repository. Below this, an empty owns[] is UNMEASURED, not a finding.
const MIN_CORPUS_FILES = 200;
const termFileCache = new Map();      // term -> string[] (files that match this term, memoized)

// ── THE BARE `git` THAT STARVED THE WHOLE LOOP ───────────────────────────────────────────────
// This called execFileSync('git', ['ls-files']) and swallowed the failure with `catch { return c }`
// — an empty corpus, indistinguishable from a repository with no files in it.
//
// On 2026-08-20 git went down machine-wide (Apple's /usr/bin/git is an xcrun stub that refuses to
// run while the Xcode licence is unaccepted). From that moment every lock built a ZERO-FILE corpus.
// The ledger shows the cutover with no ambiguity at all:
//
//   COORD-008  owns 12   2026-08-20T15:15Z
//   COORD-009  owns 12   2026-08-20T16:53Z
//   COORD-010  owns  0   2026-08-20T22:28Z      <- git dies here
//   …every coordinate after it: owns 0. 17 of 26 live coordinates, 65%.
//
// The comment below this function already describes what an empty owns[] does downstream — "the
// agent is told it has no surface, it writes prose instead of code, no commit lands, reality has no
// mass, the panel refuses, and enforcement returns UNMEASURED". That is not a hypothetical; it is
// the operator's entire list of things the cockpit reports as unmeasured, pending or missing, and
// it has one cause. The earlier diagnosis (a contended or partial build under load) was reasonable
// and wrong: the build was not slow, the instrument was dead.
//
// So: resolve git properly, and when it cannot run, say so instead of returning an empty Map that
// reads as a fact about the repository.
function buildCorpus(repo) {
  const c = new Map();
  const r = git(['ls-files'], { cwd: repo, maxBuffer: 32e6 });
  if (!r.ok) {
    c.unavailable = r.reason || gitUnavailableReason();
    return c;
  }
  const files = r.out.split('\n').filter(Boolean);
  for (const f of files) {
    if (IGNORE_PATH.test(f) || BINARY_EXT.test(f)) continue;
    const full = resolve(repo, f);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.size === 0 || st.size > CORPUS_FILE_CAP) continue;
    try { c.set(f, readFileSync(full, 'utf8').toLowerCase()); } catch { /* binary despite extension — skip */ }
  }
  return c;
}

/** Resolve every UNCACHED term against the (lazily built, process-lifetime) corpus. */
function resolveTermsFromCorpus(terms, repo) {
  if (!corpus) corpus = buildCorpus(repo);
  const uncached = terms.filter((t) => !termFileCache.has(t));
  for (const t of uncached) {
    const tl = t.toLowerCase();
    const matches = [];
    for (const [file, content] of corpus) if (content.includes(tl)) matches.push(file);
    termFileCache.set(t, matches);
  }
}

export function discoverOwns(rule, { repo = REPO, maxFiles = 12 } = {}) {
  const terms = distinctiveTerms(rule);
  if (!terms.length) return { owns: [], terms, reason: 'no distinctive term in the rule — cannot locate existing work' };
  resolveTermsFromCorpus(terms, repo);
  const hits = new Map();
  for (const t of terms) {
    for (const file of termFileCache.get(t) || []) {
      hits.set(file, (hits.get(file) || 0) + 1);
    }
  }
  // Term-count alone ranks a transcript dump above the code, because a dump mentions everything.
  // MEASURED on the first real lock: turns.json, a CHANGELOG and a blog scratchpad all outranked
  // panel-door.mjs for a rule that is *about* panel-door.mjs. An agent handed that list would go to
  // the wrong place, which is the exact rebuild this mechanism exists to prevent. So weight by what
  // the file IS: running code first, then its tests, then docs, and push the corpora down — a
  // transcript is where a rule was DISCUSSED, never where it is IMPLEMENTED.
  const kindWeight = (f) => {
    if (/^(\.thetacog|data)\/.*\.(ndjson|json)$/.test(f)) return 0.15;   // corpora + telemetry dumps
    if (/(^|\/)(turns|transcript|scratchpad)[^/]*\.(json|txt|md)$/i.test(f)) return 0.15;
    if (/CHANGELOG|\.lock$|package-lock/.test(f)) return 0.2;
    if (/\.(mjs|js|ts|tsx|rs|sh)$/.test(f)) return /(^|\/)tests?\//.test(f) ? 1.6 : 2.0;   // the running code
    if (/\.(md|mdx|html)$/.test(f)) return 0.6;
    return 0.5;
  };
  const owns = [...hits.entries()]
    .map(([file, n]) => ({ file, termHits: n, score: +(n * kindWeight(file)).toFixed(2), kind: kindWeight(file) >= 1.6 ? 'code' : kindWeight(file) >= 0.6 ? 'doc' : 'corpus' }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, maxFiles);
  // ── AN EMPTY RESULT MUST SAY WHICH KIND OF EMPTY IT IS ──────────────────────────────────────
  // Measured 2026-08-20: the same rule returned 12 owned files when called directly and 0 inside a
  // lock, and the ledger recorded "no tracked file matches this rule — it may genuinely be new
  // ground". That reason was false. The corpus build takes ~52 SECONDS on this repo, and under
  // concurrent agent load it can come back short — so a contended or partial build was being
  // reported as a confident statement about the repository.
  //
  // That is the failure this session kept finding in new costumes: an absence of evidence rendered
  // as evidence of absence. It matters more here than anywhere, because an empty owns[] starves
  // everything downstream — the agent is told it has no surface, it writes prose instead of code,
  // no commit lands, reality has no mass, the panel refuses, and enforcement returns UNMEASURED.
  // One mislabelled empty silently disables the whole loop.
  const corpusSize = corpus ? corpus.size : 0;
  const thin = corpusSize < MIN_CORPUS_FILES;
  return {
    owns,
    terms,
    corpusFiles: corpusSize,
    reason: owns.length ? null
      : thin
        ? (corpus?.unavailable
          // A DEAD INSTRUMENT IS NOT A THIN BUILD. Reported separately because the fix is different
          // and because "re-run when the tree is quieter" sent a previous session looking at load.
          ? `owns UNMEASURED — git could not be run, so the tracked-file corpus is EMPTY. This says nothing about the repository. ${String(corpus.unavailable).slice(0, 200)}`
          : `owns UNMEASURED — the file corpus came back with only ${corpusSize} files (expected at least ${MIN_CORPUS_FILES}); this is a contended or partial build, NOT a statement that the repo has no match. Re-run when the tree is quieter.`)
        : `no tracked file matches this rule across ${corpusSize} files — it may genuinely be new ground, or the terms are too generic`,
  };
}

// ── THE CONE ──────────────────────────────────────────────────────────────────────────────────
// The locked coordinates ARE the specification. Their centroid is the CENTRE LINE. Their dispersion
// is the CONE WIDTH: a large steer plants a coordinate far from the others and widens it; refinement
// plants near the centre and narrows it. Momentum is whether the width is shrinking over time.
//
// All of this is arithmetic over placements the real walk produced — no model, and no new sensor.
const SHORTLEX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const IDX = Object.fromEntries(SHORTLEX.map((s, i) => [s, i]));
const NAMES = { A: 'Strategy', B: 'Tactics', C: 'Operations', A1: 'Strategy.Law', A2: 'Strategy.Goal', A3: 'Strategy.Fund', B1: 'Tactics.Speed', B2: 'Tactics.Deal', B3: 'Tactics.Signal', C1: 'Operations.Grid', C2: 'Operations.Loop', C3: 'Operations.Flow' };
export const fullLabel = (c) => {
  if (!c) return 'UNMEASURED';
  const [r, k] = String(c).split(',');
  return `${c} (${NAMES[r] || r} ⊕ ${NAMES[k] || k})`;
};
const cheb = (a, b) => {
  const [ar, ak] = String(a).split(','), [br, bk] = String(b).split(',');
  if (![ar, ak, br, bk].every((s) => Number.isInteger(IDX[s]))) return null;
  return Math.max(Math.abs(IDX[ar] - IDX[br]), Math.abs(IDX[ak] - IDX[bk]));
};

/** The centre line: the locked coordinate with the smallest total distance to all the others. */
export function centerLine(coords) {
  const placed = (coords || []).filter((c) => c.coord);
  if (!placed.length) return { coord: null, reason: 'no coordinate locked yet — the cone has no centre' };
  if (placed.length === 1) return { coord: placed[0].coord, reason: null, n: 1, support: 1, provisional: true };
  let best = null, bestSum = Infinity;
  for (const a of placed) {
    let sum = 0, ok = true;
    for (const b of placed) { const d = cheb(a.coord, b.coord); if (d === null) { ok = false; break; } sum += d; }
    if (!ok) continue;
    if (sum < bestSum || (sum === bestSum && best && a.coord < best)) { best = a.coord; bestSum = sum; }
  }
  return { coord: best, reason: null, n: placed.length, meanDistance: +(bestSum / placed.length).toFixed(2), provisional: placed.length < 4 };
}

/** Cone width: mean king-move distance from the centre line. Bigger = the project is still spreading. */
export function cone(coords) {
  const centre = centerLine(coords);
  if (!centre.coord) return { ...centre, width: null, spread: [] };
  const spread = (coords || []).filter((c) => c.coord).map((c) => ({
    id: c.id, coord: c.coord, label: fullLabel(c.coord), distance: cheb(centre.coord, c.coord), rule: c.rule,
  }));
  const ds = spread.map((s) => s.distance).filter((d) => Number.isFinite(d));
  return {
    centre: centre.coord, centreLabel: fullLabel(centre.coord),
    provisional: centre.provisional, n: ds.length,
    width: ds.length ? +(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2) : null,
    max: ds.length ? Math.max(...ds) : null,
    spread: spread.sort((a, b) => (b.distance ?? -1) - (a.distance ?? -1)),
  };
}

/** Momentum: is the cone narrowing as coordinates accumulate? Compares halves, oldest→newest. */
export function coneMomentum(coords) {
  const placed = (coords || []).filter((c) => c.coord);
  if (placed.length < 4) return { verdict: 'UNMEASURED', reason: `need >= 4 locked coordinates to read a trend; have ${placed.length}` };
  const mid = Math.floor(placed.length / 2);
  const w = (set) => { const c = cone(set); return c.width; };
  const early = w(placed.slice(0, mid)), late = w(placed.slice(mid));
  if (early === null || late === null) return { verdict: 'UNMEASURED', reason: 'a half had no placeable coordinate' };
  const delta = +(late - early).toFixed(2);
  return {
    verdict: delta < -0.25 ? 'NARROWING' : delta > 0.25 ? 'WIDENING' : 'STEADY',
    early, late, delta,
    meaning: delta < -0.25
      ? 'later coordinates are landing closer together — the project is converging on its centre line'
      : delta > 0.25
        ? 'later coordinates are landing further apart — either the scope genuinely widened, or the steers are not refining'
        : 'the cone is holding its width',
  };
}

// ── COLLISION-PROOF ID DERIVATION ────────────────────────────────────────────────────────────
// BUG (2026-08-20): the id was `COORD-${existing.length + 1}` where `existing` is liveCoordinates()
// — the LIVE view, which (a) collapses to last-row-per-id, so it SHRINKS the moment any coordinate
// is retired, meaning the very next lock reuses an id that already exists earlier in the ledger
// (the append-only, last-row-wins contract then silently merges the new coordinate's future edits
// into the OLD retired one's history), and (b) two processes locking concurrently can both read the
// same `existing.length` before either has appended, and both mint the identical id.
//
// FIX: derive from the FULL ledger (readCoordinates — every row ever appended, retired or not),
// take the highest numeric suffix that has EVER been used, +1. That is monotonic for the life of
// the session file regardless of retirements. A short-lived mkdir-lock closes the concurrent-write
// race (this repo runs several agents/rooms against one shared tree — see CLAUDE.md's parallel-
// rooms rule — so the race is not hypothetical here).
const ID_RE = /^COORD-(\d+)$/;
export function nextCoordId(slug) {
  const all = readCoordinates(slug);
  let max = 0;
  for (const r of all) {
    const m = ID_RE.exec(String(r?.id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `COORD-${String(max + 1).padStart(3, '0')}`;
}

function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no SAB — best effort */ }
}

/** Mutual exclusion around "read the ledger to mint an id, then append" — a plain mkdir is atomic
 *  on every filesystem this runs on (POSIX + macOS APFS), so it doubles as the lock primitive. */
function withLedgerLock(slug, fn) {
  const dir = sdir(slug);
  mkdirSync(dir, { recursive: true });
  const lockDir = resolve(dir, '.coordinates.lock');
  const deadline = Date.now() + 5000;
  for (;;) {
    try { mkdirSync(lockDir); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > 10000) { rmdirSync(lockDir); continue; }   // stale — a crashed holder never released it
      } catch { /* raced the rmdir with another locker — just retry */ }
      if (Date.now() > deadline) throw new Error(`coordinate ledger lock timed out for '${slug}' — another process may be stuck`);
      sleepMs(15);
    }
  }
  try { return fn(); } finally { try { rmdirSync(lockDir); } catch { /* already gone */ } }
}

// ── LOCKING A COORDINATE ──────────────────────────────────────────────────────────────────────
export async function lockCoordinate(slug, { rule, provenance = null, steer = null, quote = null, source = null, createdBy = 'operator', kind = 'created' }) {
  if (!rule || !String(rule).trim()) return { ok: false, reason: 'a coordinate needs a rule' };
  const dir = sdir(slug);
  mkdirSync(dir, { recursive: true });

  // PLACE IT ON THE REAL WALK — the coordinate's coordinate. LLM-free, same door as everything else.
  let coord = null, sigma = null, sensor = null, placeMs = null, unmeasured = null;
  try {
    const P = await import(resolve(HERE, 'physics.mjs'));
    const p = await P.placeText(String(rule));
    if (p.available) {
      coord = P.representativeCoord(p.coords);
      sigma = p.sigma; sensor = p.sensor; placeMs = p.ms;
    } else unmeasured = p.reason;
  } catch (e) { unmeasured = `placement failed: ${e.message}`; }

  const found = discoverOwns(rule);
  const existing = liveCoordinates(slug);
  // id mint + append is the critical section: locked so two concurrent lockCoordinate() calls
  // (same process or two agents in two processes) can never mint the same id, and so the id is
  // always derived from the ledger state at the moment it is actually written, not a snapshot
  // read before the lock was acquired.
  const row = withLedgerLock(slug, () => {
    const n = readCoordinates(slug).length;
    const r = {
      id: nextCoordId(slug),
      ts: new Date().toISOString(),
      rule: String(rule).trim(),
      kind,                       // 'created' (new ground) | 'inferred' (lifted from the past)
      createdBy,                  // 'operator' | 'taskmaster'
      provenance, steer, quote, source,
      coord, sigma, sensor, placeMs, unmeasured,
      owns: found.owns,           // ← what ALREADY EXISTS for this rule, deterministically discovered
      ownsTerms: found.terms,
      ownsReason: found.reason,
      status: 'locked',
      seq: n,
    };
    appendFileSync(resolve(dir, LEDGER), JSON.stringify(r) + '\n');
    return r;
  });
  return { ok: true, coordinate: row, cone: cone([...existing, row]) };
}

/** Refine an existing coordinate — appends, never mutates; the superseded row stays readable. */
export async function refineCoordinate(slug, id, { rule, steer = null }) {
  const live = liveCoordinates(slug).find((c) => c.id === id);
  if (!live) return { ok: false, reason: `no coordinate '${id}'` };
  const next = await lockCoordinate(slug, { rule: rule || live.rule, steer, provenance: `refines ${id}`, createdBy: 'operator', kind: 'refined' });
  if (!next.ok) return next;
  // the refined row keeps the ORIGINAL id so the ledger resolves to one live coordinate
  const dir = sdir(slug);
  const row = { ...next.coordinate, id, parent_id: id };
  appendFileSync(resolve(dir, LEDGER), JSON.stringify(row) + '\n');
  return { ok: true, coordinate: row, cone: cone(liveCoordinates(slug)) };
}

// ══ GRADUATION — how a locked coordinate actually reaches a future prompt ═════════════════════
//
// I checked the running code instead of assuming, and it inverted the design. Rules are NOT injected
// into the walk. From prompt-lens.mjs's own header (lines 7-21):
//   1. buildStubSpec(prompt)      the prompt IS the intent — deterministic, no model
//   2. boundaryFromStubSpec(stub) placed by gzip-NCD, expanded by the REAL ballistic walk; the
//                                 Chebyshev hull of the walked region IS the fence
//   3. retrieveRules(boundary)    the fence queries SQLite lens_rules for rules whose coord falls
//                                 INSIDE it — merciless MAX_RULES cutoff
//   4. assembleInjection(...)     those few rules are prepended to the prompt
// So the walk makes a FENCE and the fence RETRIEVES rules by coordinate. A rule never enters the pump.
//
// AND THE TABLE IS DERIVED. seedRules() runs `DELETE FROM lens_rules` then re-INSERTs from
// **CLAUDE.md**, placing each rule-line with placePixel. Writing a coordinate straight into
// lens_rules would be wiped by the very next reseed with no diff explaining it — the derived-artifact
// incident, repeated. (prompt-lens.mjs even carries that scar in a comment, dated 2026-08-06.)
//
// THEREFORE the only honest graduation path is: locked coordinate → a rule LINE IN CLAUDE.md →
// seedRules places it → the fence retrieves it for every future prompt whose meaning contains it.
//
// The filter in seedRules is real and unforgiving, so we validate against it here rather than
// discovering at reseed time that a coordinate was silently dropped.
const GRAD_MIN = 30, GRAD_MAX = 240;
const gradIsNoise = (l) =>
  /^\d+\.\s/.test(l) || /\|/.test(l) || /^`?[A-Z][\w-]*`?\s*:\s*`?</.test(l)
  || /^`?[A-Z]{2,}\b\s*—/.test(l) || /^`[^`]+`\s*(—|reads|=)/.test(l) || /^[!`]/.test(l);
const GRAD_KEYWORD = /(never|always|must|do not|don.t|rule|only|every|hard rule|gate|—|:)/i;

/** Would this coordinate survive seedRules' filter and reach lens_rules? Checked, not assumed. */
export function graduationCheck(rule) {
  const line = String(rule || '').replace(/^[\s>#*-]+/, '').replace(/\*\*/g, '').trim();
  const problems = [];
  if (line.length < GRAD_MIN) problems.push(`too short (${line.length} < ${GRAD_MIN}) — seedRules drops it`);
  if (line.length > GRAD_MAX) problems.push(`too long (${line.length} > ${GRAD_MAX}) — seedRules drops it; split it into two coordinates`);
  if (!/[a-z]/.test(line)) problems.push('no lowercase — reads as a heading, not a rule');
  if (!GRAD_KEYWORD.test(line)) problems.push('no imperative marker (never/always/must/only/every/rule/gate/— /:) — seedRules will not recognise it as a rule');
  if (gradIsNoise(line)) problems.push('matches the structural-noise filter (numbered step, table row, trailer def, backticked path)');
  return { ok: problems.length === 0, line, chars: line.length, problems };
}

/** The exact markdown line to paste into CLAUDE.md, with its owned paths as the follow-on. */
export function graduationLine(c) {
  const check = graduationCheck(c.rule);
  const owns = (c.owns || []).filter((o) => o.kind === 'code').slice(0, 3).map((o) => o.file);
  return {
    ...check,
    markdown: `- **${check.line}**${owns.length ? `\n  - Already implemented in: ${owns.map((f) => `\`${f}\``).join(' · ')}` : ''}`,
    owns,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const cmd = process.argv[2];
  const slug = arg('--slug', 'gddadwill');

  if (cmd === 'lock') {
    const r = await lockCoordinate(slug, { rule: arg('--rule', ''), steer: arg('--steer', null), createdBy: 'operator' });
    if (!r.ok) { console.error('✗ ' + r.reason); process.exit(2); }
    const c = r.coordinate;
    console.log(`\n  ✓ ${c.id} locked — ${fullLabel(c.coord)}  σ ${c.sigma ?? 'UNMEASURED'}  sensor ${c.sensor || '—'}`);
    console.log(`    ${c.rule}`);
    console.log(`\n    ALREADY EXISTS for this rule (${c.owns.length} file(s), terms: ${c.ownsTerms.join(', ')}):`);
    if (!c.owns.length) console.log(`      — ${c.ownsReason}`);
    for (const o of c.owns.slice(0, 8)) console.log(`      ${o.kind.padEnd(6)} ${String(o.score).padStart(5)}  ${o.file}`);
    const k = r.cone;
    console.log(`\n    cone: centre ${k.centreLabel || '—'}${k.provisional ? ' (provisional)' : ''} · width ${k.width ?? 'UNMEASURED'} · n ${k.n}\n`);
    process.exit(0);
  }

  if (cmd === 'cone' || !cmd) {
    const coords = liveCoordinates(slug);
    const k = cone(coords), m = coneMomentum(coords);
    console.log(`\n  THE CONE · ${slug}`);
    if (!k.centre) { console.log(`  ${k.reason}\n`); process.exit(0); }
    console.log(`  centre line : ${k.centreLabel}${k.provisional ? '  (provisional — under 4 coordinates)' : ''}`);
    console.log(`  width       : ${k.width}  (mean king-move from centre; max ${k.max})`);
    console.log(`  momentum    : ${m.verdict}${m.delta !== undefined ? `  ${m.early} → ${m.late}  (Δ ${m.delta})` : ''}`);
    console.log(`                ${m.meaning || m.reason}`);
    console.log(`\n  coordinates, furthest from centre first:`);
    for (const s of k.spread) {
      console.log(`    ${s.id}  d${s.distance}  ${s.label.padEnd(42)} ${String(s.rule).slice(0, 60)}`);
    }
    console.log('');
    process.exit(0);
  }

  if (cmd === 'graduate') {
    const coords = liveCoordinates(slug);
    if (!coords.length) { console.log(`\n  no coordinates locked in ${slug}\n`); process.exit(0); }
    console.log(`\n  GRADUATION · ${slug}`);
    console.log(`  A coordinate reaches a future prompt ONLY through CLAUDE.md. The chain, from the code:`);
    console.log(`    CLAUDE.md → seedRules() → lens_rules (DERIVED, wiped each reseed) → the walk's fence`);
    console.log(`    retrieves by coord → assembleInjection prepends it. Rules never enter the walk itself.\n`);
    let ready = 0;
    for (const c of coords) {
      const g = graduationLine(c);
      if (g.ok) ready++;
      console.log(`  ${g.ok ? '✓' : '✗'} ${c.id}  ${fullLabel(c.coord)}  ${g.chars}ch`);
      if (!g.ok) for (const pr of g.problems) console.log(`       ! ${pr}`);
      else console.log(`       ${g.markdown.split('\n').join('\n       ')}`);
    }
    console.log(`\n  ${ready}/${coords.length} would survive the seedRules filter and become retrievable.\n`);
    process.exit(0);
  }

  console.error('usage: coordinates.mjs lock --rule "..." [--steer "..."] | cone | graduate  [--slug s]');
  process.exit(2);
}
