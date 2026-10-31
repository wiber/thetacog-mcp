#!/usr/bin/env node
// scripts/pmu/reef-from-spec.mjs — build a REEF from a real spec, in DETAIL.
// =============================================================================
// THE DESIGN DECISION (operator, 2026-06-22): NOT one reef per requirement — a
// single-requirement reef has nothing to be distinct FROM, so placement has no
// contrast and the walk dies (the reef-shaped version of "a diagonal grid has no
// edges"). Instead: ALL requirements mapped into ONE reef, each carrying its FULL
// PROSE (not keyword extraction). The requirement text IS the anchor. This gives
// the reef real semantic mass and genuine inter-lane contrast (R1 variance-
// measurement vs R6 spec-ingestion vs R7 honest-fences are different concerns),
// which is what lifts σ-separation and the ΔS↔ΔP closeness ρ — the metrics that
// make the reef + spec "more useful and effective."
//
// The reef is the ACTOR's signed INTENT: build it, seal it AS the author/origin
// room (spec frontmatter `from_room`). The patient room then attests its DELIVERED
// WORK against this reef (scripts/pmu/spec-deliver-attest.mjs); the walk measures,
// per requirement, the drift between detailed-intent and delivered-reality.
//
// Same sensors as the 144-lattice (gzip-NCD primary + simhash) — a spec-reef is
// just a different set of anchors (the requirements) under the identical, byte-
// stable placement primitive. Recompute-safe: same spec in → same reef bytes out.
//
// Usage:
//   node scripts/pmu/reef-from-spec.mjs --spec docs/specs/drafts/builder-npx-underwriter-package.md
//   node scripts/pmu/reef-from-spec.mjs --spec <path> --json     # machine-readable to stdout
//   node scripts/pmu/reef-from-spec.mjs --spec <path> --out <path>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { simhash, hamming, wordShingles, SIG_BITS } from '../../src/app/pmu-simulator/signature.mjs';
import { sealReceiptAs, actorIdentity, sha256Hex } from './receipt-crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

// ── gzip-NCD distance (matches src/lib/pmu/compress.mjs ncdSim; distance = 1 - sim) ──
const gz = (s) => gzipSync(Buffer.from(String(s), 'utf8')).length;
function ncdDist(a, b) {
  const za = gz(a), zb = gz(b), zab = gz(`${a}\n${b}`);
  const denom = Math.max(za, zb);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, (zab - Math.min(za, zb)) / denom));
}

// ── spec frontmatter (--- yaml ---) → { spec_id, from_room, to_room, ... } ──
function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

// ── REQUIREMENTS extraction. Canonical spec format (CLAUDE.md / bf-002):
//   ## REQUIREMENTS ...
//   - **R1 — <title>.** <prose, may include *Check:* clause>
// Each requirement bullet is ONE anchor: coord=R1, full prose = snippet.
// Robust to multi-line bullets (a continuation line that isn't a new bullet/heading
// folds into the current requirement).
function extractRequirements(src) {
  const lines = src.split('\n');
  const reqs = [];
  let cur = null;
  const flush = () => { if (cur) { cur.prose = cur.prose.trim(); reqs.push(cur); cur = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    // a requirement bullet: "- **R1 — Title.** body"  (em-dash or hyphen tolerated)
    const head = line.match(/^[-*]\s+\*\*(R\d+)\s*[—–-]\s*([^*]+?)\*\*\s*(.*)$/);
    if (head) {
      flush();
      cur = { id: head[1], title: head[2].replace(/\.\s*$/, '').trim(), prose: head[3].trim() };
      continue;
    }
    if (cur) {
      // stop the current req at the next heading / blank-then-heading; otherwise fold continuation prose
      if (/^#{1,6}\s/.test(line) || /^##\s*ACCEPTANCE/i.test(line)) { flush(); continue; }
      if (/^[-*]\s+\*\*R\d+/.test(line)) { /* handled above */ }
      else if (line.trim()) cur.prose += ' ' + line.trim();
    }
  }
  flush();
  return reqs;
}

// ── reef contrast metrics (same honesty as build-reef.mjs) ──
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
function spearman(xs, ys) {
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  if (n < 2) return 0;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? +(num / Math.sqrt(dx * dy)).toFixed(4) : 0;
}

function buildReef(specPath) {
  const src = readFileSync(specPath, 'utf8');
  const fm = parseFrontmatter(src);
  const reqs = extractRequirements(src);
  if (reqs.length < 2) {
    throw new Error(`reef-from-spec: found ${reqs.length} requirement(s) in ${specPath}; need ≥2 for a reef with contrast. Expected "- **R1 — Title.** ..." bullets under ## REQUIREMENTS.`);
  }

  // each requirement = one anchor; the FULL PROSE is the snippet (detail, not keywords)
  const anchors = reqs.map((r) => ({
    coord: r.id,
    title: r.title,
    snippet: `${r.title}. ${r.prose}`,
    sig: String(simhash(`${r.title}. ${r.prose}`, SIG_BITS, wordShingles)),
  }));

  // pairwise contrast: ΔP = gzip-NCD distance, ΔS = simhash Hamming/bits.
  // collision = pairs that compress too similarly (<0.20 NCD) = not distinct.
  const dP = [], dS = [];
  let collisions = 0;
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const p = ncdDist(anchors[i].snippet, anchors[j].snippet);
    const s = hamming(BigInt(anchors[i].sig), BigInt(anchors[j].sig)) / SIG_BITS;
    dP.push(p); dS.push(s); if (p < 0.20) collisions++;
  }
  const report = {
    requirements: anchors.length,
    collisions,
    collisionRate: +(collisions / (dP.length || 1)).toFixed(4),
    meanPairwiseNCD: +mean(dP).toFixed(4),     // higher = anchors are more distinct (good)
    closeness_rho: spearman(dS, dP),           // ΔS↔ΔP rank-corr — does compression track meaning here
  };

  const spec_id = fm.spec_id || basename(specPath).replace(/\.[^.]+$/, '');
  const reefBody = {
    artifact: 'spec-reef',
    spec_id,
    source: specPath.replace(REPO_ROOT + '/', ''),
    from_room: fm.from_room || 'operator',     // the AUTHOR — whose intent this reef seals
    to_room: fm.to_room || null,               // the patient room expected to deliver
    built_from: 'full-requirement-prose',      // NOT keyword extraction — the design decision
    spec_sha256: sha256Hex(readFileSync(specPath, 'utf8')),
    anchors,
    report,
  };

  // Seal the reef AS the author identity = the signed INTENT half of the GDD loop.
  const author = actorIdentity(reefBody.from_room);
  const sealed = sealReceiptAs(reefBody, author);
  return { sealed, report, spec_id, from_room: reefBody.from_room };
}

function main() {
  const specPath = arg('--spec', null);
  if (!specPath) { console.error('usage: reef-from-spec.mjs --spec <path.md> [--out <path>] [--json]'); process.exit(2); }
  const { sealed, report, spec_id, from_room } = buildReef(resolve(specPath));

  const outPath = arg('--out', resolve(REPO_ROOT, `data/pmu/reef/spec-reef-${spec_id}.json`));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(sealed, null, 2));

  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(sealed, null, 2) + '\n'); return; }
  const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', C = '\x1b[36m', X = '\x1b[0m';
  process.stderr.write(`${B}⬡ REEF FROM SPEC${X} ${D}— ${sealed.source}${X}\n`);
  process.stderr.write(`  ${C}${report.requirements} requirements${X} → one detailed reef (full prose, not keywords)\n`);
  process.stderr.write(`  sealed AS ${G}${from_room}${X} (author intent) · pubkey ${sealed.pubkey_hex.slice(0, 16)}…\n`);
  process.stderr.write(`  ${D}contrast: meanNCD ${report.meanPairwiseNCD} · collisions ${report.collisions}/${report.requirements * (report.requirements - 1) / 2} (${report.collisionRate}) · closeness ρ(ΔS,ΔP) ${report.closeness_rho}${X}\n`);
  for (const a of sealed.anchors) process.stderr.write(`    ${C}${a.coord}${X} ${a.title}\n`);
  process.stderr.write(`  → ${outPath.replace(REPO_ROOT + '/', '')}\n`);
}

export { buildReef, ncdDist, extractRequirements };
if (import.meta.url === `file://${process.argv[1]}`) main();
