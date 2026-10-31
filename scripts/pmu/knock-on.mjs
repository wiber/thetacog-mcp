#!/usr/bin/env node
// scripts/pmu/knock-on.mjs — THE KNOCK-ON LOOP (STREAMING-SPEC §9, 2026-07-22).
//
// Closed-loop deterministic write-back: a prompt P that returned a weak match + the novel
// payload T the turn produced → spawn a CHILD SHELF (a new work-template; the parent domain's
// vocab is NEVER mutated — the overtraining trap makes a brittle one-key lock out of a broad
// gravity well), then iterate the shelf's `when` bag from P's OWN distinguishing tokens until
// the TOPOLOGY catches P: the same stemmed-overlap scorer prompt-lens.mjs uses for
// pickWorkTemplate must rank the child TOP with margin ≥ MARGIN_LOCK.
//
// THE CUTOFF IS RELATIVE, NEVER ABSOLUTE (operator 2026-07-22: "set the cutoff relevantly —
// the point is the topology fit"): gzip-NCD physics forbids an absolute ≤0.05 for non-literal
// text, so a raw `while (ncd > 0.05)` loop would fracture the grid forever (the asymptotic-split
// trap). The lock is TOPOLOGICAL (child is the pick, with margin); the NCD coherence curve is
// the graded exhaust, measured against the self-distance floor NCD(P,P), with the green line at
// floor + GREEN_EPS and a DERIVATIVE circuit-breaker (stop when improvement flattens).
//
// PLACEMENT, NOT TRUTH (the hallucination-permanence trap): this loop proves WHERE the payload
// ended up and WHAT prompted it — auditable and revertible via the receipt (reef_sha before/
// after + the exact seated entry). It never claims the payload is factually right. LLM-FREE
// end to end: no model call anywhere in this file.
//
// Receipt: one NDJSON row per run → data/pmu/knock-on-convergence.ndjson (append-only, NEW
// file — no shared-file clobber). The `coherence_delta` array drives the demo-page SVG strip.
//
// Usage (C611i: --errata [catalogue] seats one shelf per erratum family — see seatErrataShelves):
//   node scripts/pmu/knock-on.mjs --prompt "<P>" --payload "<T>" --name <slug> [--parent <domain>]
//                                 [--max-iters 12] [--apply] [--json]
//   node scripts/pmu/knock-on.mjs --errata [docs/10-scratchpad/notebooklm-insights-2026-10-03.txt] [--apply] [--json]
// Env (tests): KNOCKON_REEF, KNOCKON_HISTORY override the reef/history paths.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { regrip } from '../lib/grip-word.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
// BOUNDED LOCAL SAFETY NET — never an unbounded write-only pile.
// The reef is a TRACKED file with 1156 revisions in git; git IS the durable backup and always was.
// These copies exist only so an in-flight apply/revert can be undone before the next commit, so
// they are gitignored and pruned to the last KEEP. Left unbounded they reached 361 files / 130MB
// with zero readers (measured 2026-08-23) — a write-only directory every git op had to scan.
export const REEF_BACKUP_KEEP = 20;
// C1378: a caller that works a reef COPY of its own (attest-loop.mjs's user-local rulebook) passes `dir` so the backup sits
// beside that copy, never inside the repo or the installed package; the default is unchanged.
export function backupReef(reefPath, ts, { keep = REEF_BACKUP_KEEP, dir = resolve(REPO, '.thetacog/reef-backups') } = {}) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(reefPath, resolve(dir, `lens-reef-${ts.replace(/[:.]/g, '-')}.json`));
  const olds = readdirSync(dir).filter((f) => f.startsWith('lens-reef-') && f.endsWith('.json')).sort();
  for (const f of olds.slice(0, Math.max(0, olds.length - keep))) {
    try { unlinkSync(resolve(dir, f)); } catch { /* another room already pruned it */ }
  }
  return dir;
}

export const REEF_PATH = process.env.KNOCKON_REEF || resolve(REPO, 'data/pmu/lens-reef.json');
export const HISTORY_PATH = process.env.KNOCKON_HISTORY || resolve(REPO, 'data/pmu/knock-on-convergence.ndjson');
export const ORPHANS_PATH = process.env.KNOCKON_ORPHANS || resolve(REPO, 'data/pmu/knock-on-orphans.ndjson');

export const MAX_ORPHANS = Number(process.env.KNOCKON_ORPHANS_MAX || 10000); // hard ledger cap — a flood must flatline + alert, never eat the disk
export const MARGIN_LOCK = 2;      // child must beat the runner-up by ≥2 stemmed hits — clear of the steering band
// THE CLASS-CLOSURE FLOOR (2026-07-23): the auto miss-gate fires on an ABSOLUTE score (top ≤ MISS_MAX_SCORE),
// so a lock that is merely RELATIVE (margin ≥ 2, e.g. score 2 vs 0) seats a shelf that does NOT retire its
// own firing condition — a near-duplicate of the same prompt class still scores ≤ the gate and fires again
// (sibling-shelf proliferation; hash-dedupe only closes the EXACT prompt). A lock must therefore ALSO clear
// the gate's own threshold: score > MISS_MAX_SCORE. Every seat then provably removes its firing condition —
// the loop closes per-CLASS, not per-hash. Single source of truth: knock-on-auto.mjs imports this constant.
export const MISS_MAX_SCORE = 3;   // top catch at or below this = a MISS worth learning (shared with auto)
export const GREEN_EPS = 0.05;     // the green line sits at floor + eps, floor = NCD(P,P) — relative, never absolute
export const FLAT_DELTA = 0.005;   // derivative circuit-breaker: < this NCD improvement over the window = flattened
export const FLAT_WINDOW = 3;      // ...measured across this many trailing steps
const TOKENS_PER_ITER = 4;         // vocabulary refinement batch per topological tweak

// ── the SAME stem + tokenizer prompt-lens.mjs pickWorkTemplate uses (parity guarded by test) ──
const stem = (w) => (/ss$/.test(w) ? w : w.replace(/s$/, ''));
export const tokensOf = (text) =>
  String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map(stem);
// score one template against a prompt exactly the way the lens does
export function scoreTemplate(promptToks, tpl) {
  const toks = promptToks instanceof Set ? promptToks : new Set(promptToks);
  return String(tpl.when).split(/\s+/).map(stem).filter((w) => toks.has(w)).length;
}
export function rankTemplates(prompt, templates) {
  const toks = new Set(tokensOf(prompt));
  // a tombstoned shelf has when='' — it scores 0 by construction and can never be picked again
  const scored = templates.map((t) => ({ name: t.name, n: scoreTemplate(toks, t) }));
  scored.sort((a, b) => b.n - a.n);
  return scored;
}

export function ncd(a, b) {
  const ca = gzipSync(Buffer.from(String(a))).length;
  const cb = gzipSync(Buffer.from(String(b))).length;
  const cab = gzipSync(Buffer.from(String(a) + String(b))).length;
  return (cab - Math.min(ca, cb)) / Math.max(ca, cb);
}

const sha12 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const reefSha = (path) => { try { return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16); } catch { return null; } };

// ── THE ADDRESS CORPUS (tree-topological addressing, 2026-07-22) ─────────────────────────────
// The scorer's tokenizer DROPS tokens ≤3 chars, so bare rank labels (A1, C1, B) are physically
// invisible to routing — a breadcrumb-laden prompt contributes nothing unless the FULL ShortLex
// names are in the shelf corpus (ALWAYS EXPAND COORDINATE LABELS, CLAUDE.md 2026-07-15). A
// child shelf therefore inherits its parent's lattice coord and seeds its when-bag with the
// actor ⊕ patient expansion: "B,C1" → "tactics operations grid" — the words the tokenizer keeps.
const AXIS_NAMES = (() => {
  const m = {};
  try {
    const raw = JSON.parse(readFileSync(resolve(REPO, 'docs/architecture/axis-library-v1.json'), 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.axes || Object.values(raw));
    for (const a of arr) m[a.rank] = String(a.name || a.rank);
  } catch { /* addressing degrades gracefully to no expansion */ }
  return m;
})();
export function coordCorpus(coord) {
  if (!coord) return '';
  const parts = String(coord).split(',');
  const words = new Set();
  for (const p of parts) {
    const name = AXIS_NAMES[p.trim()];
    if (name) for (const w of name.toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 3) words.add(w);
  }
  return [...words].join(' ');
}
export function expandCoord(coord) {
  if (!coord) return '';
  const [r, c] = String(coord).split(',');
  const rn = AXIS_NAMES[r?.trim()] || r, cn = AXIS_NAMES[c?.trim()] || c;
  return `${coord} (${rn} ⊕ ${cn})`;
}

// distinguishing tokens of P, deterministic order: frequency desc, then first appearance
function distinguishingTokens(prompt, alreadyIn) {
  const seen = new Map();
  const order = [];
  for (const t of tokensOf(prompt)) {
    if (!seen.has(t)) { seen.set(t, 0); order.push(t); }
    seen.set(t, seen.get(t) + 1);
  }
  const taken = new Set(alreadyIn.map(stem));
  return order
    .filter((t) => !taken.has(t))
    .sort((a, b) => (seen.get(b) - seen.get(a)) || (order.indexOf(a) - order.indexOf(b)));
}

/**
 * The closed loop, pure/in-memory: never touches disk unless {apply} — and even then the
 * parent domains array is byte-untouched; ONLY reef.templates grows by exactly one entry.
 */
export function runKnockOn({ prompt, payload, name, parent = null, maxIters = 12, apply = false,
                             context = null, contextCells = null,
                             reefPath = REEF_PATH, historyPath = HISTORY_PATH,
                             orphansPath = ORPHANS_PATH, orphansMax = MAX_ORPHANS, verifyLens = true,
                             backupDir = null } = {}) {   // C1378: backupDir — where the pre-apply copy of a caller's OWN reef goes (default: the repo's bounded dir)
  if (!prompt || !payload || !name) throw new Error('knock-on needs --prompt, --payload, --name');
  const reef = JSON.parse(readFileSync(reefPath, 'utf8'));
  const templates = Array.isArray(reef.templates) ? reef.templates : [];
  const floor = ncd(prompt, prompt);            // the gzip self-distance — the physical floor
  const green = +(floor + GREEN_EPS).toFixed(4); // the RELATIVE lock line the graph draws

  // iter 0 — THE MISS: how the existing topology catches P today (before any injection)
  const before = rankTemplates(prompt, templates);
  const missTpl = templates.find((t) => t.name === before[0]?.name);
  const missText = missTpl ? `${missTpl.when} ${missTpl.skeleton}` : '';
  const steps = [{
    iter: 0, action: 'miss',
    ncd: +(missText ? ncd(prompt, missText) : 1).toFixed(4),
    score: before[0]?.n || 0, margin: 0, top: false,
  }];

  // THE INJECTION: the child shelf, seeded from the PAYLOAD's own vocabulary (Reality) PLUS its
  // tree-topological ADDRESS: the parent domain's lattice coord expanded to the full ShortLex
  // words (bare ranks are invisible to the tokenizer — only the names carry routing mass).
  const parentDomain = parent ? (reef.domains || []).find((d) => d.domain === parent) : null;
  const coord = parentDomain?.coord || null;
  const addressWords = coordCorpus(coord);
  const child = {
    name,
    when: [...new Set([...tokensOf(payload), ...addressWords.split(/\s+/).filter(Boolean)])].slice(0, 12).join(' '),
    // the seated template teaches the next session its words — "determinism" names the chaos, never us
    skeleton: regrip(String(payload).replace(/\s+/g, ' ').trim()).slice(0, 400),
    parent: parent || undefined,
    coord: coord || undefined,
    born_of: sha12(prompt),
    seated: new Date().toISOString(),
  };

  // THE TOPOLOGICAL TWEAK, iterated — refine child.when from P's distinguishing tokens
  let locked = false, stopReason = 'ceiling';
  for (let iter = 1; iter <= maxIters; iter++) {
    if (iter > 1) { // iter 1 measures the raw injection before any refinement
      const pool = distinguishingTokens(prompt, child.when.split(/\s+/));
      if (!pool.length) { stopReason = locked ? 'lock' : 'exhausted-tokens'; break; }
      child.when = child.when + ' ' + pool.slice(0, TOKENS_PER_ITER).join(' ');
    }
    const ranked = rankTemplates(prompt, [...templates, child]);
    const mine = ranked.find((r) => r.name === child.name)?.n || 0;
    const bestOther = ranked.filter((r) => r.name !== child.name)[0]?.n || 0;
    const margin = mine - bestOther;
    const top = margin > 0;
    const d = +ncd(prompt, `${child.when} ${child.skeleton}`).toFixed(4);
    steps.push({ iter, action: iter === 1 ? 'inject' : 'vocab', ncd: d, score: mine, margin, top });

    locked = top && margin >= MARGIN_LOCK && mine > MISS_MAX_SCORE; // class-closure: the lock must clear the miss-gate it was born from
    const tail = steps.slice(-FLAT_WINDOW).map((s) => s.ncd);
    const flattened = steps.length > FLAT_WINDOW && (tail[0] - tail[tail.length - 1]) < FLAT_DELTA;
    if (locked && (d <= green || flattened)) { stopReason = 'lock'; break; }
    if (flattened) { stopReason = locked ? 'lock' : 'local-max'; break; } // honest non-lock — never faked
  }

  const last = steps[steps.length - 1];
  const row = {
    ts: new Date().toISOString(),
    prompt_hash: sha12(prompt), prompt_head: String(prompt).slice(0, 96),
    payload_head: String(payload).slice(0, 96),
    child_name: child.name, parent: parent || (missTpl?.name ?? null),
    coord: coord || null, coord_full: coord ? expandCoord(coord) : null,
    // FULL-DUMP CONTEXT (operator 2026-07-22: the auto-tick must measure with the addressed
    // self-definitions in play). Recorded evidence, never a lock input — the lock stays
    // topological; this proves the activation definitions were present at measurement time.
    context_bytes: context ? Buffer.byteLength(String(context), 'utf8') : 0,
    context_cells: contextCells || (context ? null : 0),
    context_ncd: context ? +ncd(prompt, context).toFixed(4) : null,
    reef_sha_before: reefSha(reefPath), reef_sha_after: null,
    floor: +floor.toFixed(4), green,
    coherence_delta: steps.map((s) => s.ncd),  // the step-down array — drives the demo SVG
    steps,
    iterations: last.iter,
    locked, coherence_locked: last.ncd <= green, stop_reason: stopReason,
    applied: false, verify: null,
  };

  // THE APPLY — atomic, validated, revertible; parent domains byte-untouched
  if (apply && locked) {
    backupReef(reefPath, row.ts, backupDir ? { dir: backupDir } : {});
    const fresh = JSON.parse(readFileSync(reefPath, 'utf8')); // re-read fresh: never write a stale copy
    row.vocab_sha_before = parentVocabSha(fresh); // C611i: the receipt PROVES the parent vocabulary was left alone
    fresh.templates = [...(fresh.templates || []), child];
    const tmp = reefPath + '.knock-on.tmp';
    writeFileSync(tmp, JSON.stringify(fresh, null, 2));
    JSON.parse(readFileSync(tmp, 'utf8'));                    // must re-parse before it may land
    renameSync(tmp, reefPath);
    row.applied = true;
    row.reef_sha_after = reefSha(reefPath);
    row.vocab_sha_after = parentVocabSha(JSON.parse(readFileSync(reefPath, 'utf8')));
    // verifyLens=false: a scratch reef (a test) — the live lens reads data/pmu/lens-reef.json, so a fresh-lens run would
    // measure the wrong reef. Recorded as skipped, never as a pass.
    if (!verifyLens) row.verify = { skipped: 'verifyLens=false' };
    else {
    // THE VERIFICATION (the knock-on): a FRESH lens process re-runs the ORIGINAL prompt against
    // the mutated reef — the authoritative topology-fit check, immune to in-process caching.
    const parseLens = (out) => {
      try { const j = JSON.parse(out.slice(out.indexOf('{'))); const b = j?.boundary || {};
        return { coord: b.center || b.coord || null, sigma: (typeof b.sigma === 'number') ? +b.sigma.toFixed(3) : null }; }
      catch { return { coord: null, sigma: null }; }
    };
    let intentPlace = { coord: null, sigma: null };
    try {
      const out = execFileSync('node', [resolve(HERE, 'prompt-lens.mjs'), '--prompt', String(prompt).slice(0, 2000), '--json'],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env } });
      row.verify = { fresh_lens_picked_child: out.includes(child.name) };
      intentPlace = parseLens(out);
    } catch (e) { row.verify = { error: String(e).slice(0, 200) }; }
    // THE DEPOSIT RECEIPT (2026-07-23, the negative-friction measurement): walk the PAYLOAD —
    // Reality, the mass just seated into the tile — through the SAME fresh-lens instrument and
    // record where it lands vs where the INTENT struck. This is the per-seat evidence for "the
    // bank got heavier and pulled the water tighter": hit = same coordinate; dsigma = the σ
    // delta between the two placements. Recorded evidence, NEVER a lock/apply input — and the
    // direction of dsigma is DATA, not asserted (measure before claiming). Nulls stay honest
    // when a lens run fails: the structure is always present on an applied row, values null.
    let payloadPlace = { coord: null, sigma: null };
    try {
      const outT = execFileSync('node', [resolve(HERE, 'prompt-lens.mjs'), '--prompt', String(payload).slice(0, 2000), '--json'],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env } });
      payloadPlace = parseLens(outT);
    } catch { /* deposit measurement is best-effort evidence — recorded as nulls, never faked */ }
    row.deposit = {
      intent_coord: intentPlace.coord, intent_sigma: intentPlace.sigma,
      payload_coord: payloadPlace.coord, payload_sigma: payloadPlace.sigma,
      hit: !!(intentPlace.coord && intentPlace.coord === payloadPlace.coord),
      dsigma: (intentPlace.sigma != null && payloadPlace.sigma != null)
        ? +(payloadPlace.sigma - intentPlace.sigma).toFixed(3) : null,
    };
    }
  }

  // THE ORPHAN LEDGER (§9a): a non-lock must never silently drop the payload. Quarantine the
  // FULL T — prompt-hash, trajectory, stop reason — append-only. Nothing ever evaporates; the
  // machine proves exactly what it failed to map, queued for a human or a future model.
  // THE SIPHON CAP (§9d gotcha 2): in a high-volume stream a hallucination flood could balloon
  // this ledger into gigabytes and choke the aggregator. Hard count cap: at MAX_ORPHANS the
  // ledger flatlines, the overflow is REJECTED (counted, alerted — never silently eaten), and
  // .thetacog/knock-on-orphans.ALERT carries the hard system alert.
  if (!locked) {
    const cap = orphansMax;
    let count = 0;
    try { const b = readFileSync(orphansPath, 'utf8'); for (let i = 0; i < b.length; i++) if (b[i] === '\n') count++; } catch { /* new ledger */ }
    if (count >= cap) {
      row.orphaned = false; row.orphan_capped = true;
      try {
        const alertPath = resolve(REPO, '.thetacog/knock-on-orphans.ALERT');
        mkdirSync(dirname(alertPath), { recursive: true });
        appendFileSync(alertPath, `${row.ts} ORPHAN CAP HIT (${count}/${cap}) — payload ${row.prompt_hash} REJECTED, ledger flatlined\n`);
      } catch { /* alert best-effort, rejection is not */ }
    } else {
      mkdirSync(dirname(orphansPath), { recursive: true });
      appendFileSync(orphansPath, JSON.stringify({
        ts: row.ts, action: 'orphan', prompt_hash: row.prompt_hash, prompt_head: row.prompt_head,
        payload: String(payload), child_name: name, stop_reason: stopReason,
        coherence_delta: row.coherence_delta, floor: row.floor, green: row.green,
      }) + '\n');
      row.orphaned = true;
    }
  }

  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, JSON.stringify(row) + '\n');
  return row;
}

/**
 * THE TOMBSTONE (STREAMING-SPEC §9a, hallucination permanence): revert does NOT rewrite history
 * or delete physical topology — a shelf that lived for days may have magnetized legitimate
 * downstream children, and deleting the parent would orphan valid structure. We append a
 * correction: zero the entry's vocabulary (`when` → '' — the scorer can never pick it again),
 * flag the payload with its reverted_hash, keep the structural mass intact. O(1), receipted.
 */
export function revertKnockOn({ name, reefPath = REEF_PATH, historyPath = HISTORY_PATH } = {}) {
  if (!name) throw new Error('revert needs --revert <child_name>');
  const shaBefore = reefSha(reefPath);
  const reef = JSON.parse(readFileSync(reefPath, 'utf8'));
  const hits = (reef.templates || []).filter((t) => t.name === name && !t.tombstone);
  if (hits.length !== 1) throw new Error(`revert refused: ${hits.length} live entries named "${name}" (need exactly 1 — never amputate blind)`);
  const ts = new Date().toISOString();
  backupReef(reefPath, ts);
  const entry = reef.templates.find((t) => t.name === name && !t.tombstone);
  const revertedHash = sha12(`${entry.when} ${entry.skeleton}`);
  entry.tombstone = { ts, reverted_hash: revertedHash, when_tombstoned: entry.when };
  entry.when = '';                                   // zeroed from the semantic vocabulary
  entry.skeleton = `[REVERTED_${revertedHash}] ${entry.skeleton}`; // flagged, mass intact
  const tmp = reefPath + '.knock-on.tmp';
  writeFileSync(tmp, JSON.stringify(reef, null, 2));
  JSON.parse(readFileSync(tmp, 'utf8'));
  renameSync(tmp, reefPath);
  const row = { ts, action: 'tombstone', child_name: name, reverted_hash: revertedHash,
    reef_sha_before: shaBefore, reef_sha_after: reefSha(reefPath) };
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, JSON.stringify(row) + '\n');
  // THE AMPUTATED-PATHS FEED (backlog #1, 2026-07-22): the demo page's revert ledger ships DARK
  // and lights ONLY from real revert receipts — this is that emitter. Refs-only: the tombstoned
  // vocabulary itself never leaves the reef file; the ledger carries name + hash + an 80ch stem.
  try {
    appendFileSync(resolve(REPO, 'data/pmu/reverted-receipts.ndjson'), JSON.stringify({
      ts, coord: 'template', what: `knock-on tombstone: ${name} — vocabulary zeroed, mass intact («${String(entry.when_tombstoned || (entry.tombstone && entry.tombstone.when_tombstoned) || '').slice(0, 80)}»)`,
      sha: revertedHash, kind: 'knock-on-tombstone',
    }) + '\n');
  } catch { /* ledger feed is best-effort — the revert itself already receipted above */ }
  return row;
}

// ── the demo-page strip: receipts-only inline SVG, zero page-JS (milestonesSection pattern) ──
export function knockOnSection({ historyPath = HISTORY_PATH, last = 3 } = {}) {
  let rows = []; let corrupted = 0;
  try {
    const lines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean);
    const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { corrupted++; return null; } });
    rows = parsed.filter((r) => r && Array.isArray(r.coherence_delta) && r.coherence_delta.length).slice(-last);
  } catch { return ''; } // draws-nothing-until-run discipline (MISSING file = honest silence)
  // ANTI-FORGERY, LOUD (spec area 1): a receipt file that EXISTS but holds unparseable rows is
  // not silence — it is damage, and damage renders as FAILED, never as a quiet filter.
  const corruptChip = corrupted > 0
    ? '<div class="whychip" style="border-color:#d33"><b style="color:#d33">RECEIPT CORRUPTED — ' + corrupted + ' unparseable row(s) in knock-on-convergence.ndjson</b> · the strip below renders only verified rows; a corrupted receipt is a finding, not a display bug</div>'
    : '';
  if (!rows.length) return corruptChip;
  const strips = rows.map((r) => {
    const W = 380, H = 96, PX = 34, PY = 10;
    const xs = (i) => PX + (i / Math.max(1, r.coherence_delta.length - 1)) * (W - PX - 8);
    // y-axis: NCD 1.0 (total miss) at TOP, 0.0 (perfect lock) at BOTTOM
    const Y = (v) => PY + (1 - Math.min(1, Math.max(0, v))) * (H - PY - 16);
    const pts = r.coherence_delta.map((v, i) => `${xs(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const gy = Y(r.green).toFixed(1);
    const [x0, y0] = [xs(0).toFixed(1), Y(r.coherence_delta[0]).toFixed(1)];
    const lockLabel = r.locked ? `LOCK in ${r.iterations} iters (${r.stop_reason})` : `no lock — ${r.stop_reason} (honest)`;
    return `<div style="margin-top:8px"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="coherence convergence ${r.child_name}">`
      + `<text x="2" y="${(Y(1) + 4).toFixed(1)}" font-size="9" fill="#888">1.0</text>`
      + `<text x="2" y="${(Y(0) + 4).toFixed(1)}" font-size="9" fill="#888">0.0</text>`
      + `<line x1="${PX}" y1="${gy}" x2="${W - 8}" y2="${gy}" stroke="#19c37d" stroke-width="1.5" stroke-dasharray="4 3"/>`
      + `<text x="${W - 8}" y="${(+gy - 3).toFixed(1)}" font-size="8" fill="#19c37d" text-anchor="end">green = floor ${r.floor} + ${GREEN_EPS}</text>`
      + `<polyline points="${pts}" fill="none" stroke="#e0b400" stroke-width="2"/>`
      + `<circle cx="${x0}" cy="${y0}" r="3.5" fill="#d33"/>`
      // THE HONEST-LIMIT BADGE (underwriter UX, 2026-07-22): a flatline above the green line
      // reads as "the AI gave up" without context. The badge names the recorded mechanism at
      // the exact stop point: the derivative circuit-breaker proved further iterations would
      // not improve structural fit — the system locked its honest limit instead of
      // hallucinating a score. Text comes from stop_reason on the receipt, never invented.
      + (() => {
          const li = r.coherence_delta.length - 1;
          const [lx, ly] = [xs(li), +Y(r.coherence_delta[li])];
          const badge = r.stop_reason === 'flat' ? 'derivative circuit-breaker: honest local maximum'
            : r.stop_reason === 'lock' ? 'locked at the green line'
            : r.stop_reason ? `stopped: ${r.stop_reason}` : '';
          if (!badge) return '';
          const anchor = lx > W * 0.55 ? 'end' : 'start';
          const tx = anchor === 'end' ? lx - 6 : lx + 6;
          const ty = Math.max(PY + 8, ly - 6);
          return `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="none" stroke="#66fcf1" stroke-width="1.5"/>`
            + `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="8" fill="#66fcf1" text-anchor="${anchor}">${badge}</text>`;
        })()
      + `</svg><br><span style="font-size:11px">↳ <b>${r.child_name}</b> · ${lockLabel} · NCD ${r.coherence_delta[0]} → ${r.coherence_delta[r.coherence_delta.length - 1]} · reef ${r.reef_sha_before || '?'} → ${r.reef_sha_after || '(not applied)'}`
      // THE DEPOSIT LINE (receipts-only): intent-strike vs payload-landing, straight off the row.
      + (r.deposit ? ` · deposit ${r.deposit.intent_coord || '?'}→${r.deposit.payload_coord || '?'}${r.deposit.hit ? ' <b>HIT</b>' : ''}${r.deposit.dsigma != null ? ` Δσ ${r.deposit.dsigma}` : ''}` : '')
      + ` · placement, not truth — recompute from ${'data/pmu/knock-on-convergence.ndjson'}</span></div>`;
  }).join('');
  return corruptChip + `<div class="whychip" style="margin:14px 0"><b>KNOCK-ON · coherence convergence</b> — the grid mutates until the topology catches the prompt that spawned it; every step a receipt, LLM-free${strips}</div>`;
}

// ── C611i THE ERRATA RESET THE L1 (operator 2026-10-03: "we can correct the errata with ncd sensor associations etc
// and resetting the l1 to maximise the value from that grounding to drive clarity on our dev here") ──────────────
// The NotebookLM overviews retold the record and landed wrong exactly where the canon has hard rules; C611c catalogued
// every ERRATUM line (docs/10-scratchpad/notebooklm-insights-2026-10-03.txt). This seats ONE child shelf per erratum
// FAMILY through runKnockOn — the same door, the same lock, the same receipt — so the next prompt or draft of ours that
// restates the register lands on that shelf and the lens serves the CORRECTED form as the template for the turn.
//   P (the prompt the topology must catch) = the family's own register: every catalogued quote it carries.
//   T (the payload the shelf serves)       = the family's corrected form + its gzip-NCD nearest book section
//                                            (C611a's association: book sections as the bank, relative to the mean
//                                            over this query set — a distance is a property of the pair).
// The detectors are IMPORTED (notebook-index EXTRA_FAMILIES · behavior-promise BRAKE_CLAIM / MATHEMATICAL_GUARANTEE ·
// grip-word DETERMINISM_RE). The `also` matchers below exist only for third-person phrasings the catalogue shows those
// detectors miss by construction (they were built for OUR first-person prose); invented precision has no house detector.
// SUFFICIENT FOR: which register a line restates, and which shelf the lens serves for it. NOT SUFFICIENT FOR: whether a
// line is false in context (the catalogue's human read decided that), nor whether the corrected form is obeyed.
// Port row: C611i rides C170a's punch list with knock-on itself (the scorer is the lens's pickWorkTemplate parity).
export const ERRATA_CATALOGUE = resolve(REPO, 'docs/10-scratchpad/notebooklm-insights-2026-10-03.txt');
const DPPP = 'the deviation is DETECTED · PLACED · PRICED · DISPATCHED against the lane declared before the work ran; the halt is the buyer\'s to wire';
export const ERRATA_FAMILIES = [
  { key: 'prevents-as-ours', from: 'extra',
    also: /\b(?:physically|mathematically|structurally|topologically|flatly|literally) impossible\b|\bunbreakable\b|\bstop(?:s|ping)? (?:the )?(?:AI|agent|model)\b/i,
    corrected: `prevents-as-ours: never "physically prevents", "impossible", "zero drift", "unbreakable" as our act. Say: ${DPPP}.` },
  { key: 'negated-guarantee', from: 'extra',
    also: /\b(?:cannot|can'?t|can never|will not|incapable of)\s+(?:be\s+)?(?:break\w*|lie|lying|betray\w*|drift|deviate|hallucinat\w+|misbehav\w+|spoof\w*|mutate|execute|corrupted|compute)\b/i,
    corrected: `negated guarantee: an AI that "cannot break promises / cannot lie" is a behaviour guarantee in the negative. Whether it was good is undecidable (Rice). Say: ${DPPP}.` },
  { key: 'hardware-fixes', from: 'extra',
    also: /\bhardware[- ](?:enforced|proof|fault|itself)\b|\bphysical hardware fault\b/i,
    corrected: 'hardware-fixes: silicon, physics or geometry never FIXES or STOPS the model. Hardware means spatial position: definitions resolve to addresses in a 144x144 lattice (Grip). Cache latency is rung 2/3 evidence, never the definition. We place the work; the receipt says WHERE, never that it is correct.' },
  { key: 'software-cannot', from: 'extra',
    also: /\b(?:software (?:literally )?(?:cannot|can'?t)|unprovable software rules|software guardrail)\b/i,
    corrected: 'software-cannot: never argue from software\'s impotence ("software cannot fix AI", "below the ALU"). Argue from grounding: a record the actor did not write, read off an immutable commit, re-runnable, same bytes same hash. Our receipt is software, LLM-free.' },
  { key: 'brake', from: 'brake',
    also: /\bkill[- ]switch(?:es)?\b|\bemergency brake\b|\bcircuit (?:breaks|breaker)\b|\bdead[- ]?man'?s switch\b/i,
    corrected: 'brake: a kill switch / emergency brake is never ours. Tape, not brake, not engine: the tape is the position, the halt is the buyer\'s to wire on their own machine, the hand on the switch is theirs and the sovereign\'s.' },
  { key: 'invented-precision', from: null,
    also: /\b(?:invent\w*|fabricat\w*|made-up)\b|\b\d[\d,.]*\s*(?:×|x|times)\s+(?:faster|more|cheaper)\b|\b\d+(?:\.\d+)?\s*(?:σ|sigma)\b/i,
    corrected: 'invented precision: never quote a multiplier, sigma or dollar figure the receipt did not compute. Restate canonical numbers verbatim (k_E = 0.003, half-life 231 boundary crossings, Rc toward 1.00) and mark anything else UNMEASURED with its falsifier.' },
  { key: 'the-chaos-word', from: 'chaos-word',
    corrected: 'the chaos word: the word overviews use for our walk names undecidable chaos (Rice, halting are theorems about such machines). Our side is Grip: a placement at an address, re-runnable from the commit, recomputable, same bytes same hash.' },
  { key: 'constants', from: 'extra',
    also: /\bk_?E\b[^.|]{0,60}\b(?:percent|%)|\d(?:\.\d+)?\s*%\s+trust debt\b/i,
    corrected: 'constants: k_E = 0.003, 0.3 bits per boundary crossing, never a percent, never per day. Trust half-life = ln(2)/k_E, about 231 boundary crossings, never days. Trust Debt = (c/t)^n. Rc toward 1.00. Restate verbatim, never re-derive.' },
];

/** Every `- [ERRATUM] …` line of the catalogue, with the overview it came from. */
export function parseErrata(text) {
  const out = []; let source = null;
  for (const line of String(text).split('\n')) {
    const h = /^### (.+?)\s*$/.exec(line); if (h) { source = h[1]; continue; }
    if (!line.startsWith('- [ERRATUM] ')) continue;
    const body = line.slice('- [ERRATUM] '.length);
    const quote = (/\|\s*"([^"]+)"/.exec(body) || /^"([^"]+)"/.exec(body) || [])[1] || '';
    const correction = (/\|\s*house terms:\s*(.+)$/.exec(body) || /→\s*(?:correct(?:ion)?(?: to)?:?\s*)?(.+)$/.exec(body) || [])[1] || '';
    const claim = body.split(' | ')[0];
    out.push({ source, claim, quote, correction, line: body });
  }
  return out;
}

// the imported detectors, resolved once per call (dynamic: knock-on-auto must not pay for them on every miss)
async function familyDetectors() {
  const { EXTRA_FAMILIES } = await import('../blog/notebook-index.mjs');
  const { BRAKE_CLAIM, MATHEMATICAL_GUARANTEE } = await import('../voice/behavior-promise.mjs');
  const { DETERMINISM_RE } = await import('../lib/grip-word.mjs');
  const flat = (re) => new RegExp(re.source, re.flags.replace('g', ''));
  return ERRATA_FAMILIES.map((f) => {
    const res = [];
    if (f.from === 'extra') res.push(EXTRA_FAMILIES.find((x) => x.key === f.key).re);
    if (f.from === 'brake') res.push(BRAKE_CLAIM);
    if (f.key === 'prevents-as-ours') res.push(MATHEMATICAL_GUARANTEE);
    if (f.from === 'chaos-word') res.push(DETERMINISM_RE);
    if (f.also) res.push(f.also);
    return { ...f, res: res.map(flat) };
  });
}

/** The families a text restates (an erratum's quote, or one of our drafts). */
export async function classifyErratum(text, dets = null) {
  dets = dets || await familyDetectors();
  return dets.filter((f) => f.res.some((re) => re.test(String(text)))).map((f) => f.key);
}

export const REGISTER_PAD = 40; // chars of context kept either side of a detector match
export function registerWindow(text, res, pad = REGISTER_PAD) {
  const s = String(text); const spans = [];
  for (const re of res) {
    for (const m of s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      spans.push([Math.max(0, m.index - pad), Math.min(s.length, m.index + m[0].length + pad)]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const sp of spans) { const l = merged[merged.length - 1]; if (l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else merged.push(sp); }
  return merged.map(([a, b]) => s.slice(a, b)).join(' … ') || s;
}

// the parent vocabulary: every domain and the standing band — knock-on must leave it byte-identical
export function parentVocabSha(reef) {
  return createHash('sha256').update(JSON.stringify({ domains: reef.domains || [], standing: reef.standing || [] })).digest('hex').slice(0, 16);
}

/**
 * Seat one shelf per erratum family that the catalogue carries. Each family's register (P) is every catalogued quote
 * the family's detectors match; its payload (T) is the corrected form + the nearest book section. Idempotent by name:
 * a family already seated live is reported, never re-seated (tombstone it with --revert to reseat).
 */
export async function seatErrataShelves({ catalogue = ERRATA_CATALOGUE, apply = false, reefPath = REEF_PATH,
  historyPath = HISTORY_PATH, orphansPath = ORPHANS_PATH, bookDir = resolve(REPO, 'books/tesseract/chapters'), verifyLens = true } = {}) {
  const errata = parseErrata(readFileSync(catalogue, 'utf8'));
  const dets = await familyDetectors();
  const fams = dets.map((f) => ({ key: f.key, corrected: f.corrected, res: f.res,
    lines: errata.filter((e) => e.quote && f.res.some((re) => re.test(e.quote))) })).filter((f) => f.lines.length);
  const { bookSections, distances, relNearest } = await import('../blog/notebook-index.mjs');
  const book = bookSections(bookDir);
  // the register is the WINDOW around each detector match, never the whole quote: one quote often restates two
  // families, and its other family's words would otherwise pull that family's prompts onto this shelf.
  const regs = fams.map((f) => f.lines.map((e) => registerWindow(e.quote, f.res)).join(' · '));
  // the grounding query is the CORRECTION (where the book says it right), never the register (where the overview said it wrong)
  const fixes = fams.map((f) => [f.corrected, ...f.lines.map((e) => e.correction)].join(' '));
  const dist = fixes.map((r) => distances(r, book));
  const mean = book.map((_, i) => dist.reduce((a, d) => a + d[i], 0) / dist.length);
  const vocabBefore = parentVocabSha(JSON.parse(readFileSync(reefPath, 'utf8')));
  const out = [];
  fams.forEach((f, i) => {
    const name = `erratum-${f.key}`;
    const grounding = relNearest(dist[i], book, mean, 1)[0];
    const live = (JSON.parse(readFileSync(reefPath, 'utf8')).templates || []).some((t) => t.name === name && !t.tombstone);
    if (live) { out.push({ family: f.key, name, lines: f.lines.length, grounding: grounding.id, status: 'already-seated' }); return; }
    const payload = `ERRATUM ${f.corrected} Grounding: book ${grounding.id}.`;
    const row = runKnockOn({ prompt: regs[i], payload, name, apply, reefPath, historyPath, orphansPath, verifyLens });
    out.push({ family: f.key, name, lines: f.lines.length, grounding: grounding.id, status: row.locked ? (row.applied ? 'seated' : 'locked') : 'orphaned',
      stop: row.stop_reason, verify: row.verify });
  });
  const vocabAfter = parentVocabSha(JSON.parse(readFileSync(reefPath, 'utf8')));
  return { errata: errata.length, families: out, vocab_before: vocabBefore, vocab_after: vocabAfter };
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
  if (process.argv.includes('--errata')) {
    const r = await seatErrataShelves({ catalogue: arg('--errata') && !arg('--errata').startsWith('--') ? resolve(arg('--errata')) : ERRATA_CATALOGUE,
      apply: process.argv.includes('--apply') });
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`knock-on errata: ${r.errata} catalogued lines · parent vocab ${r.vocab_before} → ${r.vocab_after}${r.vocab_before === r.vocab_after ? ' (untouched)' : ' ⚠ CHANGED'}`);
      for (const f of r.families) console.log(`  ${f.name.padEnd(30)} ${String(f.lines).padStart(3)} lines · ${f.status}${f.stop ? ` (${f.stop})` : ''} · grounding ${f.grounding}`);
    }
    process.exit(r.vocab_before === r.vocab_after ? 0 : 1);
  }
  if (arg('--revert')) {
    const r = revertKnockOn({ name: arg('--revert') });
    console.log(`knock-on revert: amputated "${r.child_name}" · reef ${r.reef_sha_before} → ${r.reef_sha_after}`);
    process.exit(0);
  }
  const row = runKnockOn({
    prompt: arg('--prompt'), payload: arg('--payload'), name: arg('--name'),
    parent: arg('--parent'), maxIters: Number(arg('--max-iters') || 12),
    apply: process.argv.includes('--apply'),
  });
  if (process.argv.includes('--json')) console.log(JSON.stringify(row, null, 2));
  else console.log(`knock-on ${row.child_name}: ${row.locked ? 'LOCK' : 'no lock'} (${row.stop_reason}) in ${row.iterations} iters · NCD ${row.coherence_delta[0]} → ${row.coherence_delta[row.coherence_delta.length - 1]} (floor ${row.floor}, green ${row.green}) · applied=${row.applied}${row.verify ? ` · fresh-lens=${JSON.stringify(row.verify)}` : ''}`);
}
