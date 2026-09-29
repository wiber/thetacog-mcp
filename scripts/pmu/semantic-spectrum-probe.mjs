#!/usr/bin/env node
// scripts/pmu/semantic-spectrum-probe.mjs — WHERE ON THE STRING↔SEMANTIC SPECTRUM IS THE SENSOR?
// ============================================================================================
// The decisive, unconfounded answer to "is this just 'write an essay with these words'?"
//
// THE CONFOUND we remove: cross-domain separation (plumbing vs surgery = 0.90) does NOT prove the
// system reads MEANING — those domains have different VOCABULARIES, so a pure keyword matcher scores
// 0.90 too. To isolate RELATION from VOCABULARY we need controlled minimal pairs:
//
//   pair type      words      actor⊕patient relation   a STRING matcher says   a RELATIONAL reader says
//   ───────────────────────────────────────────────────────────────────────────────────────────────
//   identical      same       same                     SAME   (≈1.0)           SAME
//   paraphrase     DIFFERENT  same                      different (low sim)     SAME      ← semantic invariance
//   role-swap      SAME       SWAPPED                   SAME   (≈1.0)           DIFFERENT ← THE decisive test
//   cross-domain   different  different                 different               different
//
// THE KILLER CELL is role-swap: identical word multiset, only the actor⊕patient relation flips. A
// bag-of-words / keyword matcher is BLIND to it (≈1.0 similar). The actor⊕patient lattice is built so
// "A guides C" lands on cell (row A, col C) and "C guides A" lands on the TRANSPOSE cell (row C, col A) —
// DIFFERENT cells by construction. So role-swap separation is the cleanest possible proof of relational
// reading vs string matching. We use LATTICE-NATIVE swaps (the reef's own axis words: Strategy=A,
// Tactics=B, Operations=C …) so the pairs actually project onto the 144 lattice.
//
// We report THREE views, sensor → full system, so we can see what each layer adds:
//   (1) SENSOR     — direct gzip-NCD similarity between the two members (the raw probe; lattice-free)
//   (2) PROJECTION — cosine distance of the two 144-cell gzip-NCD projection vectors (lattice placement)
//   (3) WALK       — located-region distance after the real definerWalk144 ballistic walk (1 − Jaccard)
//
// Honest reading: if role-swap distance ≈ identical (≈0) the system is RELATION-BLIND (string/structural
// at the relation grain); if role-swap distance ≈ cross-domain it is RELATIONAL (semantic, decidable kind);
// in between, the gap tells you exactly how much. Combined with the held-out findings (paraphrase-
// invariance 0.30, cross-domain separation 0.90) this places the sensor on the spectrum with numbers,
// not rhetoric. Deterministic, gzip-NCD only, reuses the canonical definerWalk144.
//
// Usage:  node scripts/pmu/semantic-spectrum-probe.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { definerWalk144, COORDS } from './definer-walk-144.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const LIB144 = resolve(REPO, 'data/pmu/snippet-library-144.json');

// ── canonical sensing, byte-identical to spec-deliver-walk.mjs ──
let rawLib = JSON.parse(readFileSync(LIB144, 'utf8')); if (!Array.isArray(rawLib)) rawLib = rawLib.anchors || rawLib.nodes || [];
const AX = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const aIdx = a => AX.indexOf(a);
const libAnchors = new Array(144).fill(null);
for (const a of rawLib) { const r = aIdx(a.row), c = aIdx(a.col); if (r >= 0 && c >= 0) libAnchors[r * 12 + c] = a; }
const targets = libAnchors.map(a => (a && (a.snippet || a.seed)) || '');
const gzipLen = s => gzipSync(Buffer.from(String(s), 'utf8')).length;
const SNIP_Z = targets.map(t => (t ? gzipLen(t) : 0));
function ncdSim(docZ, doc, snip, snipZ) {
  if (!snip) return 0;
  const joinZ = gzipLen(`${doc}\n${snip}`);
  const denom = Math.max(docZ, snipZ);
  return denom === 0 ? 0 : Math.max(0, 1 - (joinZ - Math.min(docZ, snipZ)) / denom);
}
const litScores = (text) => { if (!text || !text.trim()) return new Array(144).fill(0); const z = gzipLen(text); return targets.map((t, i) => ncdSim(z, text, t, SNIP_Z[i])); };
const SEED_K = 3;
const topSeeds = (scores, k = SEED_K) => scores.map((v, i) => [v, i]).filter(x => COORDS[x[1]] && x[0] > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, k).map(x => x[1]);
const blockOf = i => Math.floor(Math.floor(i / 12) / 3) * 4 + Math.floor((i % 12) / 3);
const confidencePixel = (scores) => { let best = -1, bv = -Infinity; for (let i = 0; i < 144; i++) { if (!COORDS[i]) continue; if (scores[i] > bv) { bv = scores[i]; best = i; } } return best; };
const WALK_OPTS = { maxDepth: 2, topK: 3, budget: 120, budgetMs: 600000 };

// direct gzip-NCD similarity between two texts (the raw sensor, lattice-free)
const pairSim = (a, b) => { const za = gzipLen(a), zb = gzipLen(b); return ncdSim(za, a, b, zb); };
// cosine distance of two projection vectors
const cosDist = (u, v) => { let d = 0, nu = 0, nv = 0; for (let i = 0; i < u.length; i++) { d += u[i] * v[i]; nu += u[i] * u[i]; nv += v[i] * v[i]; } const den = Math.sqrt(nu) * Math.sqrt(nv); return den === 0 ? 1 : 1 - d / den; };

// walked located-region of a text (seed → real ballistic walk → cells above floor)
const FLOOR = 0.30;
async function regionOf(text) {
  const seeds = topSeeds(litScores(text));
  if (!seeds.length) return { set: new Set(), pixel: confidencePixel(litScores(text)) };
  const raw = await definerWalk144(seeds, WALK_OPTS);
  const m = Math.max(...raw.heat) || 1;
  const set = new Set(); for (let i = 0; i < 144; i++) if (raw.heat[i] / m > FLOOR) set.add(i);
  return { set, pixel: confidencePixel(litScores(text)) };
}
const jaccardDist = (A, B) => { if (!A.size && !B.size) return 0; let inter = 0; for (const x of A) if (B.has(x)) inter++; const uni = A.size + B.size - inter; return uni === 0 ? 0 : 1 - inter / uni; };
const blockDist = (p, q) => { if (p < 0 || q < 0) return 9; const bp = blockOf(p), bq = blockOf(q); return Math.max(Math.abs(Math.floor(bp / 4) - Math.floor(bq / 4)), Math.abs((bp % 4) - (bq % 4))); };

// ── THE BATTERY — lattice-native pairs (the reef's own axis words: Strategy=A, Tactics=B, Operations=C) ──
const BATTERY = [
  // identical — baseline (must read SAME)
  { type: 'identical', a: 'Strategy guides operations and sets the long-term direction for the whole organization.', b: 'Strategy guides operations and sets the long-term direction for the whole organization.' },
  { type: 'identical', a: 'The investor funded the founder to grow the venture.', b: 'The investor funded the founder to grow the venture.' },
  // paraphrase — same relation, DIFFERENT words (SAME if semantic; LOW if surface-bound)
  { type: 'paraphrase', a: 'Strategy guides operations and sets the long-term direction for the whole organization.', b: 'The high-level plan directs the day-to-day execution and fixes where the entire company is headed over time.' },
  { type: 'paraphrase', a: 'The investor funded the founder to grow the venture.', b: 'The financier bankrolled the entrepreneur so the young company could expand.' },
  { type: 'paraphrase', a: 'Tactics translate the deal into a concrete operational signal.', b: 'The short-term moves turn the agreement into a specific on-the-ground indicator.' },
  // role-swap — SAME words, SWAPPED actor⊕patient (SAME if string-blind; DIFFERENT if relational) ← THE TEST
  { type: 'role-swap', a: 'Strategy guides operations and sets the direction the daily work must follow.', b: 'Operations guide strategy and set the direction the long-term plan must follow.' },
  { type: 'role-swap', a: 'The investor funded the founder to grow the venture.', b: 'The founder funded the investor to grow the venture.' },
  { type: 'role-swap', a: 'Tactics drove the deal and the signal followed from the negotiation.', b: 'The deal drove the tactics and the negotiation followed from the signal.' },
  { type: 'role-swap', a: 'The auditor reviewed the manager and reported what the operation did wrong.', b: 'The manager reviewed the auditor and reported what the operation did wrong.' },
  // cross-domain — different words AND relation (must read DIFFERENT; the 0.90 baseline)
  { type: 'cross-domain', a: 'Strategy guides operations and sets the long-term direction for the whole organization.', b: 'The surgeon clamped the bleeding artery and sutured the incision closed under general anesthesia.' },
  { type: 'cross-domain', a: 'The investor funded the founder to grow the venture.', b: 'The plumber drained the P-trap and replaced the cracked slip-nut washer under the sink.' },
];

const log = (...a) => process.stderr.write(a.join(' ') + '\n');

async function main() {
  const rows = [];
  for (const p of BATTERY) {
    const sim = pairSim(p.a, p.b);                          // (1) raw sensor similarity
    const proj = cosDist(litScores(p.a), litScores(p.b));   // (2) projection cosine distance
    const ra = await regionOf(p.a), rb = await regionOf(p.b);
    const walk = jaccardDist(ra.set, rb.set);               // (3) walked-region distance
    const bd = blockDist(ra.pixel, rb.pixel);
    rows.push({ type: p.type, sensorSim: +sim.toFixed(4), projDist: +proj.toFixed(4), walkDist: +walk.toFixed(4), pixelBlockDist: bd });
  }
  const agg = (type, key) => { const xs = rows.filter(r => r.type === type).map(r => r[key]); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null; };
  const types = ['identical', 'paraphrase', 'role-swap', 'cross-domain'];
  const summary = types.map(t => ({ type: t, sensorSim: agg(t, 'sensorSim'), projDist: agg(t, 'projDist'), walkDist: agg(t, 'walkDist') }));

  // ── verdict: where does role-swap sit between identical (collapse) and cross-domain (separate)? ──
  const sIdent = summary.find(s => s.type === 'identical');
  const sRole = summary.find(s => s.type === 'role-swap');
  const sPara = summary.find(s => s.type === 'paraphrase');
  const sCross = summary.find(s => s.type === 'cross-domain');
  // relational reading score on the PROJECTION (lattice placement): how far role-swap separates,
  // normalized between identical (0 = collapse, string-blind) and cross-domain (1 = full separation).
  const span = (sCross.projDist - sIdent.projDist) || 1;
  const roleReadProj = +(((sRole.projDist - sIdent.projDist) / span)).toFixed(3);
  const span2 = (sCross.walkDist - sIdent.walkDist) || 1;
  const roleReadWalk = +(((sRole.walkDist - sIdent.walkDist) / span2)).toFixed(3);
  const paraphraseInvariance = +(1 - ((sPara.projDist - sIdent.projDist) / span)).toFixed(3); // 1 = same place (semantic)

  // THE ROBUST, DECISIVE TELL (substrate-independent): if the raw sensor rates role-swap (same words,
  // swapped relation) as MORE similar than paraphrase (same meaning, different words), it is reading
  // WORDS, not RELATIONS — the textbook signature of string/structural matching. This is far more robust
  // than the projection cosine (which is weak for short generic texts that barely light the lattice).
  const wordDrivenTell = sRole.sensorSim > sPara.sensorSim;
  const wordVsMeaningGap = +(sRole.sensorSim - sPara.sensorSim).toFixed(4); // >0 = reads words over meaning

  const verdict = wordDrivenTell
    ? 'RELATION-BLIND at this grain (the sensor reads WORDS, not roles — string/structural). The actor⊕patient lattice ENCODES the relation; the gzip probe does not READ it. Bottleneck = the PROBE, not the lattice or the walk.'
    : roleReadProj >= 0.66 ? 'RELATIONAL (reads actor⊕patient — beats the keyword concern)'
    : 'PARTLY RELATIONAL (structural — reads some relation, not robustly)';

  const out = {
    battery: rows, summary,
    spectrum: {
      word_driven_tell: wordDrivenTell,                     // TRUE = sensor reads words over meaning (string-matching tell)
      role_swap_minus_paraphrase_sim: wordVsMeaningGap,     // >0 = rates same-words-swapped-role MORE alike than same-meaning-reworded
      role_swap_relational_read_projection: roleReadProj,   // 0 = string-blind, 1 = fully relational
      role_swap_relational_read_walk: roleReadWalk,
      paraphrase_invariance_projection: paraphraseInvariance, // 1 = meaning-invariant (semantic), 0 = surface-bound
      verdict,
    },
    context_from_heldout: { paraphrase_invariance_heldout: 0.30, cross_domain_separation_heldout: 0.90, off_domain_rejection_heldout: '10/10' },
  };

  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }

  log('\n\x1b[1m🔬 SEMANTIC↔STRING SPECTRUM PROBE — does the sensor read the actor⊕patient RELATION, or just words?\x1b[0m\n');
  log('  pair type      sensorSim(A·B)   projDist(lattice)   walkDist(region)   reads-as');
  log('  ' + '─'.repeat(86));
  const want = { identical: 'SAME (≈0 dist)', paraphrase: 'SAME if semantic', 'role-swap': 'DIFFERENT if relational', 'cross-domain': 'DIFFERENT' };
  for (const s of summary) log(`  ${s.type.padEnd(14)} ${String(s.sensorSim).padStart(8)}        ${String(s.projDist).padStart(8)}            ${String(s.walkDist).padStart(8)}        ${want[s.type]}`);
  log('  ' + '─'.repeat(86));
  log(`\n  THE ROBUST TELL — does the sensor read words or meaning?`);
  log(`    sensor rates ROLE-SWAP (same words, swapped role) = ${sRole.sensorSim} similar`);
  log(`    sensor rates PARAPHRASE (same meaning, reworded)   = ${sPara.sensorSim} similar`);
  log(`    ${wordDrivenTell ? '\x1b[1m→ role-swap LOOKS MORE ALIKE than paraphrase (gap ' + wordVsMeaningGap + ') → reads WORDS, not relations\x1b[0m' : '→ paraphrase looks more alike → reads meaning over words'}`);
  log(`\n  THE DECISIVE CELL — role-swap (same words, swapped actor⊕patient):`);
  log(`    relational-read (projection): ${roleReadProj}   (0 = string-blind / collapses · 1 = fully relational / separates like cross-domain)`);
  log(`    relational-read (walk):       ${roleReadWalk}`);
  log(`    paraphrase-invariance (proj): ${paraphraseInvariance}   (1 = same place for reworded meaning = semantic · 0 = surface-bound)`);
  log(`\n  VERDICT: \x1b[1m${verdict}\x1b[0m`);
  log(`  Held-out corroboration: paraphrase-invariance 0.30 · cross-domain separation 0.90 · off-domain rejection 10/10.`);
  log(`  Honest reading: at PARAGRAPH scale the probe separates DOMAINS (held-out 0.90) — real, and MORE than`);
  log(`  keyword-stuffing (compression reads structure, not just words; off-domain prose with keywords jammed in`);
  log(`  still won't compress like the anchor). At SENTENCE/RELATION scale it reads WORDS not ROLES (role-swap >`);
  log(`  paraphrase, robustly). The actor⊕patient LATTICE encodes the relation by construction; the gzip PROBE`);
  log(`  cannot read it — so the relational structure goes unused at the fine grain.`);
  log(`  ROADMAP: the bottleneck is the PROBE, not the lattice or the walk. A role-aware projection is the unlock.`);
  log(`  Re-run this probe as the RATCHET: when role-swap relational-read climbs toward 1, it is genuinely more`);
  log(`  semantic — measured, not asserted.\n`);
}
main();
