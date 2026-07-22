#!/usr/bin/env node
// scripts/pmu/shortlex-project.mjs — THE REUSABLE SHORTLEX-3 PROJECTION (the three crystals).
// =============================================================================
// Projects a claims corpus onto the NEW three-length ShortLex coordinate system — the 144 axis
// NAMES from data/pmu/shortlex-144-registry.json (A,B,C | A1..C3 | A1A..C3N), NOT the 12×12
// outer-product pair labels. The evidence the operator asked for: three different crystals,
// three squares on the diagonal — the 3×3 ABC corner (almost a dot), the 9×9 A1..C3 (the one we
// normally see), and the 132×132 children added down-to-the-right, shrinking the current one.
// Reach-then-verify gets three levels.
//
// THE SYMMETRY LAW (operator, Jun 11): both axes ALWAYS carry the same 144 labels; only the
// WEIGHTS are asymmetric (cell (i,j) ≠ cell (j,i) because actor→patient ordering differs, but
// the label list is ONE list). shortlexLattice() enforces this by construction — it accepts
// exactly one registry and throws if a caller tries to pass separate row/col axis lists.
//
// THE PROJECTION LAW (reusable at the next expansion, 144 → 20,736):
//   cell (i,j) lights when a claim's HEAD grips axis_i and its TAIL grips axis_j — the same
//   midpoint head/tail decompose commit-triptych's senseDecompose documents (the head is the
//   actor/lens, the tail is the patient/object; actor→patient ordering is what makes the lattice
//   asymmetric, because meaning is). score(i,j) = max over claims of min(sim(head, sig_i),
//   sim(tail, sig_j)); θ from the same density-target approach (sorted scores, take the value at
//   the target rank, floored). NOTHING in the function knows the number 144: it reads
//   registry.entries.length, so handing it the 20,736-entry registry of the next expansion
//   produces the 20,736² lattice under the SAME law (the O(claims·N²) combine will want a top-k
//   prune at that size — an optimization, not a law change).
//
// SIGNATURE SOURCES (CLI wiring; the pure function only sees sigOf):
//   · parents (indices 0–11, A..C3): their CURRENT semantics — the live snippet-library-144.json
//     row snippets joined, exactly the way derive-children.mjs builds parent lexicons.
//   · children (indices 12–143): the candidate dumps in data/pmu/shortlex-children-candidate.json.
//     An empty dump → null signature → that axis never grips (honest: zone 3 is CANDIDATE
//     children, pre-ratchet — sparseness there is reported, never painted over).
//
//   node scripts/pmu/shortlex-project.mjs [--commit <sha>|--repo] [--email]
//     --repo  (default) the 480-claim ingest corpus: intent = docs-side (ingestIntent), reality =
//             code-side (ingestReality), as derive-children.mjs reads the same mass.
//     --commit <sha>  commit-scoped: intent = message + touched docs, reality = added code lines +
//             changed-code semantics (the commit-triptych split, compact form).
//     --email  send the three panels CID-inline (Gmail strips data: URIs — the body uses cid:).
//
// @canonical-algorithm  one registry → both axes (symmetry law); head/tail midpoint decompose →
//   min(head·axis_i, tail·axis_j) per ordered cell; θ by density target; zone boundaries computed
//   from the registry and ALWAYS drawn in this mode (they are the point)
// @forbidden-alternative  two different axis lists (breaks the symmetry law) · hardcoded 144 or
//   hardcoded zone seams (the function must survive 144→20736) · the symmetric outer product
//   lit_i∧lit_j (the symmetric-columns problem) · data:-URI email bodies (Gmail strips them)
// @guard  tests/pmu-simulator/shortlex-project.test.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { simhash, hamming, wordShingles, SIG_BITS } from '../../src/app/pmu-simulator/signature.mjs';
import { claimify, salienceRank, ingestIntent, ingestReality } from './corpus-ingest.mjs';
import { loadRegistry, zoneBoundaries } from './shortlex-registry.mjs';
import { rgbaToPng, shortlexZoneOverlay } from './triptych-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const LIBRARY_PATH = resolve(REPO, 'data/pmu/snippet-library-144.json');
const CANDIDATE_PATH = resolve(REPO, 'data/pmu/shortlex-children-candidate.json');

const sig = (s) => simhash(String(s || ''), SIG_BITS, wordShingles);

// ── THE PURE PROJECTION ────────────────────────────────────────────────────────
// registry: { entries: [{ name, ... }] } (or a bare entries array) — ONE list, both axes.
// sigOf(entry, index) → BigInt signature | null (null = axis has no semantics yet, never grips).
// intentClaims / realityClaims: arrays of claim strings (already claimified upstream).
// thetaDensity: lit-cell density target (default = commit-triptych's 900/20736 ≈ 4.3%), scaled to
// the registry's own N² so the SAME density survives 144→20736. thetaFloor keeps junk grips out.
export function shortlexLattice({ registry, sigOf, intentClaims = [], realityClaims = [], thetaDensity = 900 / 20736, thetaFloor = 0.56, ...rest } = {}) {
  if (rest.rowRegistry || rest.colRegistry || rest.rowAxes || rest.colAxes) {
    throw new Error('SYMMETRY LAW: both axes always carry the same registry labels — pass exactly one registry, never separate row/col axis lists');
  }
  const entries = Array.isArray(registry) ? registry : registry.entries;
  if (!Array.isArray(entries) || !entries.length) throw new Error('registry must carry entries');
  const Nn = entries.length, CELLSn = Nn * Nn;
  const axes = entries.map((e) => e.name);
  const axisSigs = entries.map((e, i) => sigOf(e, i));

  const senseSide = (claims) => {
    const score = new Float32Array(CELLSn);
    const headSims = new Float32Array(Nn), tailSims = new Float32Array(Nn);
    for (const claim of claims) {
      const words = String(claim || '').trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      // midpoint head/tail decompose (senseDecompose form): head = actor/lens, tail =
      // patient/object. Claims too short to split meaningfully grip with their whole text on
      // both ends (they can still light the diagonal — self-reference — honestly).
      const mid = words.length >= 4 ? Math.ceil(words.length / 2) : words.length;
      const head = words.slice(0, mid).join(' ');
      const tail = mid < words.length ? words.slice(mid).join(' ') : head;
      const hs = sig(head), ts = sig(tail);
      for (let a = 0; a < Nn; a++) {
        headSims[a] = axisSigs[a] == null ? 0 : 1 - hamming(hs, axisSigs[a]) / SIG_BITS;
        tailSims[a] = axisSigs[a] == null ? 0 : 1 - hamming(ts, axisSigs[a]) / SIG_BITS;
      }
      for (let i = 0; i < Nn; i++) {
        const h = headSims[i];
        if (h <= 0) continue;
        const base = i * Nn;
        for (let j = 0; j < Nn; j++) {
          const v = h < tailSims[j] ? h : tailSims[j];
          if (v > score[base + j]) score[base + j] = v;
        }
      }
    }
    // θ from the density target: the value at the target rank of the sorted scores, floored —
    // sparse + corpus-specific, never flooded (the commit-triptych approach, registry-scaled).
    const sorted = Float32Array.from(score).sort().reverse();
    const targetRank = Math.min(Math.max(1, Math.round(thetaDensity * CELLSn)), sorted.length - 1);
    const theta = Math.max(thetaFloor, sorted[targetRank] || thetaFloor);
    const grid = new Uint8Array(CELLSn);
    let lit = 0;
    for (let k = 0; k < CELLSn; k++) if (score[k] >= theta && score[k] > 0) { grid[k] = 1; lit++; }
    return { grid, theta: +theta.toFixed(4), lit, claims: claims.length };
  };

  const intent = senseSide(intentClaims);
  const reality = senseSide(realityClaims);
  return { axes, n: Nn, intentGrid: intent.grid, realityGrid: reality.grid, intent, reality };
}

// ── zone occupancy (the evidence numbers): lit cells inside each diagonal square ──────────────
// zone1 = the b1×b1 ABC corner · zone2 = the (b2−b1)² A1..C3 square · zone3 = the children square
// · cross = lit cells outside all three diagonal squares (parent↔child reach). Boundaries are
// COMPUTED from the registry (never hardcoded).
export function zoneOccupancy(grid, registry) {
  const entries = Array.isArray(registry) ? registry : registry.entries;
  const Nn = entries.length;
  const [b1, b2] = zoneBoundaries(Array.isArray(registry) ? { entries } : registry).major;
  let z1 = 0, z2 = 0, z3 = 0, cross = 0;
  for (let i = 0; i < Nn; i++) for (let j = 0; j < Nn; j++) {
    if (!grid[i * Nn + j]) continue;
    if (i < b1 && j < b1) z1++;
    else if (i >= b1 && i < b2 && j >= b1 && j < b2) z2++;
    else if (i >= b2 && j >= b2) z3++;
    else cross++;
  }
  return { z1, z2, z3, cross, b1, b2 };
}

// ── signature sources from the live data (parents = current library rows, children = candidate) ─
export function defaultSigOf({ libraryPath = LIBRARY_PATH, candidatePath = CANDIDATE_PATH } = {}) {
  let lib = JSON.parse(readFileSync(libraryPath, 'utf8'));
  if (!Array.isArray(lib)) lib = lib.anchors || lib.nodes || [];
  const cand = JSON.parse(readFileSync(candidatePath, 'utf8'));
  const rowText = (name) => lib.filter((e) => e.row === name).map((e) => String(e.snippet || '')).join(' ');
  return (entry) => {
    const text = entry.depth === 3
      ? String((cand.children[entry.name] || {}).dump || '')
      : rowText(entry.name);
    return text.trim() ? sig(text) : null;   // empty semantics → the axis never grips (honest)
  };
}

// ── claims corpora ─────────────────────────────────────────────────────────────
function repoClaims() {
  const split = (t) => String(t || '').split('\n\n').map((s) => s.trim()).filter(Boolean);
  return { intentClaims: split(ingestIntent(REPO).text), realityClaims: split(ingestReality(REPO).text), label: 'repo (ingest corpus: intent=docs-side · reality=code-side)' };
}
function commitClaims(sha) {
  const run = (c) => execSync(c, { cwd: REPO, encoding: 'utf8', maxBuffer: 5e7 });
  const msg = run(`git show -s --format=%B ${sha}`);
  const files = run(`git diff-tree --no-commit-id --name-only -r ${sha}`).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const DOC = /\.(md|mdx|txt|html)$/, CODE = /\.(mjs|js|ts|tsx|rs|sh|py)$/;
  const read = (f) => { try { return readFileSync(resolve(REPO, f), 'utf8'); } catch { return ''; } };
  const added = (pred) => {
    const raw = run(`git show --format= --unified=0 ${sha}`);
    const out = []; let cur = '';
    for (const l of raw.split('\n')) {
      if (l.startsWith('diff --git')) { const m = l.match(/ b\/(\S+)/); cur = m ? m[1] : ''; }
      else if (/^\+[^+]/.test(l) && pred(cur)) out.push(l.slice(1).trim());
    }
    return out.filter(Boolean).join('\n');
  };
  const intentText = [msg, ...files.filter((f) => DOC.test(f)).map(read), added((f) => DOC.test(f))].filter(Boolean).join('\n\n');
  const realityText = [added((f) => CODE.test(f)), ...files.filter((f) => CODE.test(f)).map(read)].filter(Boolean).join('\n\n');
  const claimsOf = (t) => salienceRank(claimify(t)).slice(0, 160);
  return { intentClaims: claimsOf(intentText), realityClaims: claimsOf(realityText), label: `commit ${sha}` };
}

// ── render: three pre-walk panels (no point of view, no crosshair), zones ALWAYS ──────────────
const CYAN = [0, 212, 255], AMBER = [251, 191, 36], GREEN = [46, 207, 111], CMP_CYAN = [0, 180, 220], CMP_AMBER = [230, 160, 40];
function gridRgba(grid, rgb, Nn) {
  const r = new Uint8Array(Nn * Nn * 4);
  for (let i = 0; i < Nn * Nn; i++) { const o = i * 4; if (grid[i]) { r[o] = rgb[0]; r[o + 1] = rgb[1]; r[o + 2] = rgb[2]; } else { r[o] = 5; r[o + 1] = 5; r[o + 2] = 5; } r[o + 3] = 255; }
  return r;
}
function compareRgba(gi, gr, Nn) {
  const r = new Uint8Array(Nn * Nn * 4);
  for (let i = 0; i < Nn * Nn; i++) {
    const o = i * 4; let col = null;
    if (gi[i] && gr[i]) col = GREEN; else if (gi[i]) col = CMP_CYAN; else if (gr[i]) col = CMP_AMBER;
    if (col) { r[o] = col[0]; r[o + 1] = col[1]; r[o + 2] = col[2]; } else { r[o] = 5; r[o + 1] = 5; r[o + 2] = 5; }
    r[o + 3] = 255;
  }
  return r;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv;
  const ci = argv.indexOf('--commit');
  const registry = loadRegistry();
  const sigOf = defaultSigOf();
  const corpus = ci >= 0 ? commitClaims(argv[ci + 1]) : repoClaims();

  const t0 = Date.now();
  const lat = shortlexLattice({ registry, sigOf, intentClaims: corpus.intentClaims, realityClaims: corpus.realityClaims });
  const ms = Date.now() - t0;
  const zi = zoneOccupancy(lat.intentGrid, registry);
  const zr = zoneOccupancy(lat.realityGrid, registry);

  console.log(`shortlex-3 projection · ${corpus.label} · ${lat.n}×${lat.n} · ${ms}ms`);
  console.log(`  intent : ${lat.intent.claims} claims · θ ${lat.intent.theta} · ${lat.intent.lit} lit — zones ${zi.z1}/${zi.z2}/${zi.z3} (3×3 / 9×9 / ${lat.n - zi.b2}×${lat.n - zi.b2}) · ${zi.cross} cross-zone`);
  console.log(`  reality: ${lat.reality.claims} claims · θ ${lat.reality.theta} · ${lat.reality.lit} lit — zones ${zr.z1}/${zr.z2}/${zr.z3} · ${zr.cross} cross-zone`);

  // three crystals, zone boundaries ALWAYS drawn (they are the point of this mode) — gain 3 so
  // the three diagonal squares stay visibly distinct even where occupancy is dense or empty
  const overlay = (rgba) => shortlexZoneOverlay(rgba, registry, { gain: 3 });
  const sfx = `${Date.now().toString(36)}`;   // unique CID names (Gmail dedupes by Content-ID)
  const panels = [
    { name: `shortlex-intent-${sfx}.png`, lbl: 'INTENT · head→axis_i, tail→axis_j (cyan)', color: '#00d4ff', rgba: overlay(gridRgba(lat.intentGrid, CYAN, lat.n)) },
    { name: `shortlex-reality-${sfx}.png`, lbl: 'REALITY · same projection law (amber)', color: '#fbbf24', rgba: overlay(gridRgba(lat.realityGrid, AMBER, lat.n)) },
    { name: `shortlex-compare-${sfx}.png`, lbl: 'STRAIGHT COMPARISON · green both · cyan intent-only · amber reality-only', color: '#2ecf6f', rgba: overlay(compareRgba(lat.intentGrid, lat.realityGrid, lat.n)) },
  ];
  const files = panels.map((p) => { const fp = `/tmp/${p.name}`; writeFileSync(fp, rgbaToPng(p.rgba)); return fp; });
  console.log(`  panels → ${files.join(' · ')}`);

  if (argv.includes('--email')) {
    const z = zoneBoundaries(registry);
    const occLine = (side, o) => `<b>${side}</b>: <b>${o.z1}</b> lit in the 3×3 ABC corner · <b>${o.z2}</b> in the 9×9 A1..C3 square · <b>${o.z3}</b> in the ${144 - o.b2}×${144 - o.b2} children square · ${o.cross} cross-zone (parent↔child reach)`;
    const panelHtml = panels.map((p) => `<div style="text-align:center;margin:0 0 18px">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:${p.color};margin-bottom:2px">${p.lbl}</div>
<div style="font-size:10.5px;color:#5a6673;margin-bottom:4px">three crystals on the diagonal: 3×3 ABC · 9×9 A1..C3 · 132×132 (zone 3 = candidate children, pre-ratchet)</div>
<img src="cid:${p.name}" width="300" height="300" alt="${p.lbl}" style="image-rendering:pixelated;background:#000;border-radius:4px;border:1px solid #1a2230;max-width:100%"/>
</div>`).join('');
    const body = `<!doctype html><meta charset="utf-8"><div style="max-width:700px;margin:0 auto;padding:16px;background:#05070d;color:#c9d1d9;font-family:-apple-system,system-ui,sans-serif">
<div style="font-family:ui-monospace,monospace;font-size:.7em;letter-spacing:.2em;color:#45a29e;text-transform:uppercase">PMU · the ShortLex-3 projection · three crystals on the diagonal</div>
<p style="font-size:13.5px;line-height:1.65">The axes are the <b>144 ShortLex-3 names</b> — first the tiny <b>ABC</b> (3×3 corner, almost a dot), then <b>A1..C3</b> (the 9×9 we normally see), then the <b>132 children</b> added down-to-the-right, shrinking the current one. The grey boundary lines at <b>${z.major.join(' and ')}</b> (and each child-block start) are computed from the registry, never hardcoded. <b>Zone 3 = candidate children, pre-ratchet</b> — the child axes grip via repo-derived candidate dumps that have not yet beaten the perturbation-probe BEFORE record; whatever its occupancy reads below is the honest measurement (dense here because the dumps were derived from this same corpus — they grip what built them). Zones 1–2 read sparser: the parents' row-lexicon signatures grip the corpus less tightly under the one shared θ.</p>
${panelHtml}
<div style="font-size:12.5px;line-height:1.7;padding:10px 13px;background:#0a0f17;border-left:3px solid #45a29e;border-radius:6px">
<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;color:#45a29e;text-transform:uppercase;margin-bottom:6px">zone occupancy (lit cells per diagonal square)</div>
${occLine('INTENT', zi)}<br>${occLine('REALITY', zr)}<br>
<span style="color:#5a6673">corpus: ${corpus.label} · intent ${lat.intent.claims} claims @ θ ${lat.intent.theta} · reality ${lat.reality.claims} claims @ θ ${lat.reality.theta} · projection ${ms}ms</span>
</div>
<p style="font-size:12px;color:#8b98a5;line-height:1.6"><b>Reusable:</b> the projection law is parameterized by the registry — cell (i,j) = claim head grips axis_i, tail grips axis_j, θ by density target — so the SAME function (<code>shortlexLattice</code>, scripts/pmu/shortlex-project.mjs) produces the next expansion's 20,736×20,736 lattice when handed the 20,736-entry registry. The symmetry law is enforced by construction: one registry, both axes; only the weights are asymmetric.</p>
<p style="font-size:11px;color:#5a6673">Recompute: <code>node scripts/pmu/shortlex-project.mjs --repo</code></p>
</div>`;
    const tmp = `/tmp/shortlex-project-email-${sfx}.html`;
    writeFileSync(tmp, body);
    const inlineArgs = files.map((f) => `--inline ${f}`).join(' ');
    const subject = '🔮 THREE CRYSTALS — the ShortLex-3 projection: ABC · A1..C3 · the 132 children (evidence)';
    execSync(`node ${resolve(REPO, 'scripts/email-artifact.mjs')} --html ${tmp} --no-attach ${inlineArgs} --to you@example.com --to elias@thetadriven.com --subject ${JSON.stringify(subject)} --from ${JSON.stringify('🧪 Cursor Laboratory · ThetaDriven <laboratory@thetadriven.com>')}`, { cwd: REPO, stdio: 'inherit' });
  }
}
