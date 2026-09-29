#!/usr/bin/env node
// C109j — THE Δ SLACK IS MEASURED, NOT EYEBALLED (operator 2026-09-20, verbatim: "im concerned there should be amber rings
// on the delta in this one, see the reality has a larger red, shape is similar - the amber rights are not where you expect
// to be, so the tolerance may be perfectly set to get the result (but the rings need that much slack in them? maybe"). The
// page already states the rule (scripts/vna/legend.mjs, .claude/skills/steer/SKILL.md): ONLY Δ's rings mean drift — a red
// REALITY ring with a green Δ ring at the same cell is `covered` (legend.mjs's own reading), not a miss. What that rule
// does NOT tell you: whether the aperture in force is so wide that a REALITY-red cell can *never* read Δ amber/red — a
// property of the tolerance, not of any one commit. This door measures it, over the last N cockpit receipts, against a
// shuffled null (the Δ bands permuted among that receipt's own cells, seeded so the output is byte-stable) — and reports
// only. It never re-tunes the aperture; the aperture ratchet (scripts/vna/aperture.mjs) stays the only door for that.
//
// RECEIPT SHAPE (read off data/vna/cockpit.json, the live example, and scripts/vna/legend.mjs's panelKey/bandAt):
// { panels: [ { title: 'INTENT · declared mass', rings_at: [{coord, band, name}] },
//              { title: 'REALITY · performed mass', rings_at: [...] },
//              { title: 'Δ INTENT vs REALITY', rings_at: [...] } ],
//   aperture: { engine: 'rust-aperture', rawRatio, usedRatio, matched, admissible, ... } }
// `aperture` on the receipt has no field literally named `apertureVersion` — that name belongs to a DIFFERENT subsystem
// (scripts/pmu/prompt-lens.mjs's apertureVersion(), the lens/ShortLex-walk aperture, a 12-hex-char id). Printing THAT value
// here would be the token-standing-in-for-construct mistake this repo's rules name explicitly: it is not the tolerance that
// governs this Δ panel. The field the cockpit receipt actually carries for "how wide is the tolerance in force" is
// `aperture.usedRatio` (scripts/vna/aperture.mjs: the cut ratio the Δ panel was rendered against) — that is what is printed.
//
// PAST RECEIPTS (researched before writing this): `.thetacog/walk-tape.ndjson` rows (41,134 of them, checked in full) carry
// `source: commit-intent|commit-reality|turn`, never a `panels` field — that tape is the shallow lensWalk, a different
// instrument. `data/vna/cockpit.json` is gitignored and OVERWRITTEN on every steer/cockpit run (`git log` on it: 0 entries
// — it was never a commit-carried history). `docs/specs/vna/steer/*.html` are rendered pages whose `.panels{...}` hits are a
// CSS class selector, not embedded JSON — no rings_at data recoverable from them. No `data/vna/cockpit-history*` file exists
// anywhere in the tree. THE HONEST FINDING: this repo keeps exactly ONE live cockpit receipt at a time, never a running
// history — so `loadReceipts()` below can only ever find what is on disk right now, and on most days that is one file.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const MIN_RECEIPTS = 20;
const DEFAULT_SEED = 0xC109 ^ 0x6A; // 'j' — fixed so two runs with no explicit rng are byte-identical, never Date.now()-seeded

// mulberry32 — a small, well-known seeded PRNG (public domain); deterministic given the same seed, no external entropy.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const panelKey = (t) => (/^\s*Δ/.test(String(t || '')) ? 'delta' : /^\s*REALITY/i.test(String(t || '')) ? 'reality' : /^\s*INTENT/i.test(String(t || '')) ? 'intent' : null);

function panelsByKind(receipt) {
  const out = { intent: null, reality: null, delta: null };
  for (const p of (receipt && Array.isArray(receipt.panels)) ? receipt.panels : []) {
    const k = panelKey(p && p.title);
    if (k) out[k] = p;
  }
  return out;
}

const zero = () => ({ green: 0, amber: 0, red: 0 });
const add = (t, band) => { if (band === 'green' || band === 'amber' || band === 'red') t[band] += 1; };

// one side's tally (reality-red→Δ or intent-red→Δ) plus its shuffled-within-receipt null, for one receipt
function sideTally(sourcePanel, deltaPanel, rng) {
  const real = zero(); const nullT = zero(); let n = 0;
  if (!sourcePanel || !deltaPanel) return { real, nullT, n };
  const deltaMap = new Map((deltaPanel.rings_at || []).filter((r) => r && r.coord).map((r) => [r.coord, r.band]));
  const coords = [...deltaMap.keys()];
  const bands = coords.map((c) => deltaMap.get(c));
  const shuffledBands = shuffle(bands, rng);
  const shuffledMap = new Map(coords.map((c, i) => [c, shuffledBands[i]]));
  for (const ring of (sourcePanel.rings_at || [])) {
    if (!ring || ring.band !== 'red' || !ring.coord) continue;
    if (!deltaMap.has(ring.coord)) continue; // Δ never charted this cell — unclassifiable, not silently zero
    n += 1;
    add(real, deltaMap.get(ring.coord));
    add(nullT, shuffledMap.get(ring.coord));
  }
  return { real, nullT, n };
}

/**
 * THE DOOR. Pure: reads nothing from disk, ever — every receipt it needs is handed to it. Over the last N cockpit receipts
 * (`receipts`, oldest-first or newest-first, order does not matter to the tally — only the LAST receipt with a readable
 * aperture is named as "current"), for every cell red on REALITY, counts how often Δ read green/amber/red at that same
 * cell, and the same for INTENT, each against a shuffled null (Δ bands permuted among that receipt's own cells). Never
 * re-tunes the aperture — reports only.
 * @param {Array} receipts - cockpit-receipt-shaped objects (see file header)
 * @param {{ rng?: () => number, minReceipts?: number }} opts - rng defaults to a fixed-seed mulberry32 so two calls with no
 *   explicit rng are byte-identical; minReceipts defaults to 20 (below it the door reports UNMEASURED, never a guess)
 */
export function deltaSlack(receipts, { rng, minReceipts = MIN_RECEIPTS } = {}) {
  const list = Array.isArray(receipts) ? receipts : [];
  const found = list.length;
  if (found < minReceipts) return { state: 'UNMEASURED', found, of: minReceipts, n: 0, green: 0, amber: 0, red: 0, null: zero(), aperture: null, intent: null };

  const prng = rng || mulberry32(DEFAULT_SEED);
  const reality = { real: zero(), nullT: zero(), n: 0 };
  const intent = { real: zero(), nullT: zero(), n: 0 };
  let apertureVals = [];
  let usable = 0;

  for (const receipt of list) {
    if (!receipt || !Array.isArray(receipt.panels)) continue;
    const { intent: iPanel, reality: rPanel, delta: dPanel } = panelsByKind(receipt);
    if (!dPanel) continue;
    usable += 1;
    const r1 = sideTally(rPanel, dPanel, prng);
    reality.n += r1.n; for (const k of ['green', 'amber', 'red']) { reality.real[k] += r1.real[k]; reality.nullT[k] += r1.nullT[k]; }
    const r2 = sideTally(iPanel, dPanel, prng);
    intent.n += r2.n; for (const k of ['green', 'amber', 'red']) { intent.real[k] += r2.real[k]; intent.nullT[k] += r2.nullT[k]; }
    const av = receipt.aperture && typeof receipt.aperture.usedRatio === 'number' ? receipt.aperture.usedRatio : null;
    if (av != null) apertureVals.push(av);
  }

  const apertureLabel = (() => {
    if (!apertureVals.length) return 'UNMEASURED';
    const last = apertureVals[apertureVals.length - 1];
    const allSame = apertureVals.every((v) => v === apertureVals[0]);
    return allSame ? String(last) : `${last} (varies over window)`;
  })();

  return {
    state: 'MEASURED', found, of: minReceipts, usable,
    n: reality.n, green: reality.real.green, amber: reality.real.amber, red: reality.real.red,
    null: reality.nullT,
    aperture: apertureLabel,
    intent: { n: intent.n, green: intent.real.green, amber: intent.real.amber, red: intent.real.red, null: intent.nullT },
  };
}

export function deltaSlackLine(result) {
  if (!result || result.state !== 'MEASURED') {
    const found = result && typeof result.found === 'number' ? result.found : 0;
    const of = result && typeof result.of === 'number' ? result.of : MIN_RECEIPTS;
    return `delta-slack: UNMEASURED — ${found} of ${of} cockpit receipts found`;
  }
  return `delta-slack: ${result.n} R-red cells · Δ green ${result.green} · amber ${result.amber} · red ${result.red} · null green ${result.null.green} · aperture ${result.aperture}`;
}

// ---- the CLI's disk side. Everything above this line is pure; only loadReceipts() below touches a filesystem. ----
export function loadReceipts({ repo = REPO } = {}) {
  // THE HONEST INVENTORY (see file header): this repo has no history store for cockpit receipts — only the single live
  // file, overwritten per run. loadReceipts() names every readable, panels-shaped candidate it can find on disk today;
  // it never fabricates a series and never counts a preview render (a working-tree reading, not a commit receipt) toward
  // the "N cockpit receipts" the door needs — a preview is `source: 'tree'`-flavoured and would silently inflate N with a
  // reading of uncommitted work, the exact thing AXIOM 1's W6 warns against (a projection sufficient for one question used
  // to answer a different one).
  const candidates = [resolve(repo, 'data/vna/cockpit.json')];
  const receipts = [];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (j && Array.isArray(j.panels)) receipts.push(j);
    } catch { /* unreadable — not counted, never guessed at */ }
  }
  return receipts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const receipts = loadReceipts();
  const result = deltaSlack(receipts);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 1));
  else console.log(deltaSlackLine(result));
}
